const { pool } = require('../db');
const { validateAmount } = require('./ledger');

function normalizeRequestIds(rawIds) {
  const values = Array.isArray(rawIds) ? rawIds : [rawIds];
  const ids = [...new Set(values.map(Number))];
  if (!ids.length || ids.some((id) => !Number.isSafeInteger(id) || id < 1)) {
    throw new Error('Selecciona al menos un participante válido.');
  }
  if (ids.length > 10) throw new Error('Una ronda admite como máximo 10 participantes.');
  return ids;
}

function placeholders(values, startAt = 1) {
  return values.map((_, index) => `$${startAt + index}`).join(', ');
}

async function startRound({ gameId, requestIds, createdBy }) {
  const ids = normalizeRequestIds(requestIds);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const gameResult = await client.query(
      `SELECT id, max_players, active FROM games WHERE id = $1 FOR UPDATE`,
      [gameId]
    );
    const game = gameResult.rows[0];
    if (!game || !game.active) throw new Error('El juego no está activo.');
    if (ids.length > Number(game.max_players)) {
      throw new Error(`Este juego admite como máximo ${game.max_players} participantes por ronda.`);
    }

    const existing = await client.query(
      `SELECT id FROM game_rounds WHERE game_id = $1 AND status = 'active' FOR UPDATE`,
      [gameId]
    );
    if (existing.rowCount) throw new Error('Ya existe una ronda activa en este juego.');

    const participantResult = await client.query(
      `SELECT id, user_id
       FROM join_requests
       WHERE game_id = $1 AND status = 'pending' AND expires_at > NOW()
         AND id IN (${placeholders(ids, 2)})
       ORDER BY created_at ASC
       FOR UPDATE`,
      [gameId, ...ids]
    );
    if (participantResult.rowCount !== ids.length) {
      throw new Error('Uno o más participantes ya no están disponibles en la fila.');
    }

    const roundResult = await client.query(
      `INSERT INTO game_rounds (game_id, created_by)
       VALUES ($1, $2) RETURNING id, game_id, status, created_at`,
      [gameId, createdBy]
    );
    const round = roundResult.rows[0];
    await client.query(
      `UPDATE join_requests
       SET status = 'playing', round_id = $1
       WHERE id IN (${placeholders(ids, 2)})`,
      [round.id, ...ids]
    );
    await client.query('COMMIT');
    return round;
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') throw new Error('Ya existe una ronda activa en este juego.');
    throw error;
  } finally {
    client.release();
  }
}

async function cancelRound({ gameId, roundId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const roundResult = await client.query(
      `SELECT id FROM game_rounds
       WHERE id = $1 AND game_id = $2 AND status = 'active'
       FOR UPDATE`,
      [roundId, gameId]
    );
    if (!roundResult.rowCount) throw new Error('La ronda ya fue cerrada o no existe.');
    await client.query(
      `UPDATE join_requests
       SET status = 'pending', round_id = NULL, expires_at = NOW() + INTERVAL '15 minutes'
       WHERE round_id = $1 AND status = 'playing'`,
      [roundId]
    );
    await client.query(
      `UPDATE game_rounds SET status = 'cancelled', finished_at = NOW() WHERE id = $1`,
      [roundId]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function completeRound({ gameId, roundId, results, createdBy }) {
  if (!Array.isArray(results) || !results.length || results.length > 10) {
    throw new Error('Los resultados de la ronda no son válidos.');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const roundResult = await client.query(
      `SELECT gr.id, g.min_amount, g.max_amount
       FROM game_rounds gr JOIN games g ON g.id = gr.game_id
       WHERE gr.id = $1 AND gr.game_id = $2 AND gr.status = 'active'
       FOR UPDATE`,
      [roundId, gameId]
    );
    const round = roundResult.rows[0];
    if (!round) throw new Error('La ronda ya fue procesada o no existe.');

    const participantResult = await client.query(
      `SELECT r.id AS request_id, r.user_id, r.status, u.balance, u.active
       FROM join_requests r JOIN users u ON u.id = r.user_id
       WHERE r.round_id = $1
       ORDER BY r.created_at ASC
       FOR UPDATE OF r, u`,
      [roundId]
    );
    const participants = participantResult.rows;
    if (!participants.length || participants.some((item) => item.status !== 'playing')) {
      throw new Error('La ronda no tiene participantes disponibles para procesar.');
    }

    const resultByRequest = new Map();
    for (const item of results) {
      const requestId = Number(item.requestId);
      if (!Number.isSafeInteger(requestId) || resultByRequest.has(requestId)) {
        throw new Error('Los resultados contienen participantes repetidos o inválidos.');
      }
      if (!['win', 'loss'].includes(item.outcome)) throw new Error('Selecciona si cada participante ganó o perdió.');
      const direction = item.outcome === 'loss' ? -1 : 1;
      const amount = validateAmount(direction * Math.abs(Number(item.amount)), round.min_amount, round.max_amount);
      resultByRequest.set(requestId, { amount, note: String(item.note || '').trim().slice(0, 180) });
    }
    if (resultByRequest.size !== participants.length
      || participants.some((item) => !resultByRequest.has(Number(item.request_id)))) {
      throw new Error('Debes registrar el resultado de todos los participantes de la ronda.');
    }

    const settingsResult = await client.query('SELECT allow_negative FROM app_settings WHERE id = 1');
    const allowNegative = settingsResult.rows[0].allow_negative;
    const transactions = [];
    for (const participant of participants) {
      if (!participant.active) throw new Error('Una de las cuentas participantes está desactivada.');
      const result = resultByRequest.get(Number(participant.request_id));
      const balanceBefore = Number(participant.balance);
      const balanceAfter = balanceBefore + result.amount;
      if (!allowNegative && balanceAfter < 0) {
        throw new Error('Uno de los participantes no tiene saldo suficiente para registrar esa pérdida.');
      }
      const transactionResult = await client.query(
        `INSERT INTO transactions
         (user_id, game_id, amount, balance_before, balance_after, type, note, created_by)
         VALUES ($1, $2, $3, $4, $5, 'game_result', $6, $7)
         RETURNING *`,
        [participant.user_id, gameId, result.amount, balanceBefore, balanceAfter, result.note, createdBy]
      );
      const transaction = transactionResult.rows[0];
      await client.query(
        `UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2`,
        [balanceAfter, participant.user_id]
      );
      await client.query(
        `UPDATE join_requests SET status = 'used', transaction_id = $1 WHERE id = $2`,
        [transaction.id, participant.request_id]
      );
      transactions.push(transaction);
    }
    await client.query(
      `UPDATE game_rounds SET status = 'completed', finished_at = NOW() WHERE id = $1`,
      [roundId]
    );
    await client.query('COMMIT');
    return transactions;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { normalizeRequestIds, startRound, cancelRound, completeRound };
