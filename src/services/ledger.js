const { pool } = require('../db');

function validateAmount(rawAmount, min = 1, max = 1_000_000) {
  const amount = Number(rawAmount);
  if (!Number.isSafeInteger(amount) || amount === 0) {
    throw new Error('El monto debe ser un número entero distinto de cero.');
  }
  const absolute = Math.abs(amount);
  if (absolute < min || absolute > max) {
    throw new Error(`El monto debe estar entre ${min} y ${max}.`);
  }
  return amount;
}

async function applyTransaction({ userId, gameId = null, rawAmount, createdBy, type, note = '', requestId = null, min = 1, max = 1_000_000 }) {
  const amount = validateAmount(rawAmount, min, max);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const settingsResult = await client.query('SELECT allow_negative FROM app_settings WHERE id = 1');
    const allowNegative = settingsResult.rows[0].allow_negative;

    const userResult = await client.query(
      `SELECT id, balance, active FROM users WHERE id = $1 FOR UPDATE`,
      [userId]
    );
    const user = userResult.rows[0];
    if (!user || !user.active) throw new Error('La cuenta del jugador no está disponible.');

    if (requestId) {
      const requestResult = await client.query(
        `SELECT id, user_id, game_id, status, expires_at
         FROM join_requests WHERE id = $1 FOR UPDATE`,
        [requestId]
      );
      const joinRequest = requestResult.rows[0];
      if (!joinRequest || joinRequest.status !== 'pending') throw new Error('Esta participación ya fue procesada o no existe.');
      if (Number(joinRequest.user_id) !== Number(userId) || Number(joinRequest.game_id) !== Number(gameId)) {
        throw new Error('La participación no corresponde a este jugador o juego.');
      }
      if (new Date(joinRequest.expires_at) < new Date()) {
        await client.query(`UPDATE join_requests SET status = 'expired' WHERE id = $1`, [requestId]);
        throw new Error('La solicitud venció. El jugador debe volver a escanear el QR.');
      }
    }

    const balanceAfter = user.balance + amount;
    if (!allowNegative && balanceAfter < 0) throw new Error('El jugador no tiene saldo suficiente para registrar esa pérdida.');

    const transactionResult = await client.query(
      `INSERT INTO transactions
       (user_id, game_id, amount, balance_before, balance_after, type, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [userId, gameId, amount, user.balance, balanceAfter, type, note.trim().slice(0, 180), createdBy]
    );

    await client.query(`UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2`, [balanceAfter, userId]);
    if (requestId) {
      await client.query(
        `UPDATE join_requests SET status = 'used', transaction_id = $1 WHERE id = $2`,
        [transactionResult.rows[0].id, requestId]
      );
    }
    await client.query('COMMIT');
    return transactionResult.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function reverseTransaction({ transactionId, createdBy }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const originalResult = await client.query(
      `SELECT t.*, u.balance, u.active, s.allow_negative
       FROM transactions t
       JOIN users u ON u.id = t.user_id
       CROSS JOIN app_settings s
       WHERE t.id = $1
       FOR UPDATE OF t, u`,
      [transactionId]
    );
    const original = originalResult.rows[0];
    if (!original) throw new Error('La transacción no existe.');
    if (original.type === 'reversal') throw new Error('No se puede revertir una reversa.');
    const existing = await client.query('SELECT id FROM transactions WHERE reversal_of = $1', [transactionId]);
    if (existing.rowCount) throw new Error('La transacción ya fue revertida.');

    const amount = -original.amount;
    const balanceAfter = original.balance + amount;
    if (!original.allow_negative && balanceAfter < 0) {
      throw new Error('No puede revertirse porque la cuenta quedaría con saldo negativo.');
    }

    const result = await client.query(
      `INSERT INTO transactions
       (user_id, game_id, amount, balance_before, balance_after, type, note, created_by, reversal_of)
       VALUES ($1, $2, $3, $4, $5, 'reversal', $6, $7, $8)
       RETURNING *`,
      [original.user_id, original.game_id, amount, original.balance, balanceAfter,
        `Reversa de la transacción #${transactionId}`, createdBy, transactionId]
    );
    await client.query('UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2', [balanceAfter, original.user_id]);
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { validateAmount, applyTransaction, reverseTransaction };
