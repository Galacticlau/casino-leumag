const test = require('node:test');
const assert = require('node:assert/strict');

process.env.PGLITE_DATA_DIR = 'memory://';
process.env.ADMIN_PASSWORD = 'PruebaSegura2026!';

const { pool, initializeDatabase } = require('../src/db');
const { normalizeRequestIds, startRound, cancelRound, completeRound } = require('../src/services/rounds');

let gameId;
let secondGameId;
let administratorIds;
let playerIds;
let requestIds;
let completedRoundId;
let completedResults;

async function insertUser(username, role, balance = 0) {
  const result = await pool.query(
    `INSERT INTO users (username, display_name, password_hash, role, balance, must_change_password)
     VALUES ($1, $2, 'hash-prueba', $3, $4, FALSE) RETURNING id`,
    [username, username, role, balance]
  );
  return result.rows[0].id;
}

async function addRequest(userId, targetGame = gameId) {
  const result = await pool.query(
    `INSERT INTO join_requests (user_id, game_id) VALUES ($1, $2) RETURNING id`,
    [userId, targetGame]
  );
  return result.rows[0].id;
}

test.before(async () => {
  await initializeDatabase();
  const game = await pool.query(
    `INSERT INTO games (name, slug, min_amount, max_amount, max_players)
     VALUES ('Juego grupal', 'juego-grupal', 10, 500, 10) RETURNING id`
  );
  gameId = game.rows[0].id;
  const secondGame = await pool.query(
    `INSERT INTO games (name, slug, min_amount, max_amount, max_players)
     VALUES ('Segundo juego', 'segundo-juego', 10, 500, 2) RETURNING id`
  );
  secondGameId = secondGame.rows[0].id;
  administratorIds = [];
  playerIds = [];
  requestIds = [];
  for (let index = 1; index <= 10; index += 1) {
    administratorIds.push(await insertUser(`admin${index}`, 'game_admin'));
    const playerId = await insertUser(`player${index}`, 'player', 1000);
    playerIds.push(playerId);
    requestIds.push(await addRequest(playerId));
  }
});

test.after(async () => {
  await pool.end();
});

test('valida el máximo absoluto de 10 participantes', () => {
  assert.equal(normalizeRequestIds(requestIds).length, 10);
  assert.throws(() => normalizeRequestIds([...requestIds, 99999]), /máximo 10/);
  assert.throws(() => normalizeRequestIds([]), /al menos un participante/);
});

test('solo uno de 10 administradores puede iniciar la misma ronda', async () => {
  const attempts = await Promise.allSettled(administratorIds.map((createdBy) => startRound({
    gameId,
    requestIds,
    createdBy
  })));
  assert.equal(attempts.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter((item) => item.status === 'rejected').length, 9);
  const active = await pool.query(
    `SELECT id FROM game_rounds WHERE game_id = $1 AND status = 'active'`,
    [gameId]
  );
  assert.equal(active.rowCount, 1);
});

test('cancelar una ronda devuelve a todos a la fila', async () => {
  const active = await pool.query(
    `SELECT id FROM game_rounds WHERE game_id = $1 AND status = 'active'`,
    [gameId]
  );
  await cancelRound({ gameId, roundId: active.rows[0].id });
  const pending = await pool.query(
    `SELECT id, round_id FROM join_requests WHERE game_id = $1 AND status = 'pending'`,
    [gameId]
  );
  assert.equal(pending.rowCount, 10);
  assert.ok(pending.rows.every((item) => item.round_id === null));
});

test('un participante no puede estar activo en dos juegos', async () => {
  await assert.rejects(
    () => addRequest(playerIds[0], secondGameId),
    (error) => error.code === '23505'
  );
});

test('registra resultados individuales de 10 personas en una sola operación', async () => {
  const round = await startRound({ gameId, requestIds, createdBy: administratorIds[0] });
  const results = requestIds.map((requestId, index) => ({
    requestId,
    outcome: index === 0 ? 'loss' : 'win',
    amount: index === 0 ? 100 : 50
  }));
  const transactions = await completeRound({
    gameId,
    roundId: round.id,
    results,
    createdBy: administratorIds[0]
  });
  assert.equal(transactions.length, 10);
  completedRoundId = round.id;
  completedResults = results;
  const balances = await pool.query(
    `SELECT id, balance FROM users WHERE id IN (${playerIds.map((_, index) => `$${index + 1}`).join(', ')}) ORDER BY id`,
    playerIds
  );
  assert.equal(Number(balances.rows[0].balance), 900);
  assert.ok(balances.rows.slice(1).every((item) => Number(item.balance) === 1050));
});

test('un segundo cierre no duplica transacciones', async () => {
  await assert.rejects(
    () => completeRound({
      gameId,
      roundId: completedRoundId,
      results: completedResults,
      createdBy: administratorIds[0]
    }),
    /procesada|no existe/
  );
  const transactions = await pool.query(
    `SELECT COUNT(*)::int AS total FROM transactions WHERE game_id = $1 AND type = 'game_result'`,
    [gameId]
  );
  assert.equal(transactions.rows[0].total, 10);
});

test('un error de saldo revierte todos los resultados de la ronda', async () => {
  await pool.query('UPDATE users SET balance = 20 WHERE id = $1', [playerIds[0]]);
  const firstRequest = await addRequest(playerIds[0]);
  const secondRequest = await addRequest(playerIds[1]);
  const round = await startRound({
    gameId,
    requestIds: [firstRequest, secondRequest],
    createdBy: administratorIds[0]
  });
  const beforeSecond = await pool.query('SELECT balance FROM users WHERE id = $1', [playerIds[1]]);
  await assert.rejects(
    () => completeRound({
      gameId,
      roundId: round.id,
      createdBy: administratorIds[0],
      results: [
        { requestId: firstRequest, outcome: 'loss', amount: 50 },
        { requestId: secondRequest, outcome: 'win', amount: 50 }
      ]
    }),
    /saldo suficiente/
  );
  const after = await pool.query(
    `SELECT id, balance FROM users WHERE id IN ($1, $2) ORDER BY id`,
    [playerIds[0], playerIds[1]]
  );
  assert.equal(Number(after.rows[0].balance), 20);
  assert.equal(Number(after.rows[1].balance), Number(beforeSecond.rows[0].balance));
  const requests = await pool.query(
    `SELECT status, transaction_id FROM join_requests WHERE round_id = $1`,
    [round.id]
  );
  assert.ok(requests.rows.every((item) => item.status === 'playing' && item.transaction_id === null));
  await cancelRound({ gameId, roundId: round.id });
});

test('respeta la capacidad particular configurada para cada juego', async () => {
  const extraPlayers = [];
  const extraRequests = [];
  for (let index = 1; index <= 3; index += 1) {
    const player = await insertUser(`extra${index}`, 'player', 1000);
    extraPlayers.push(player);
    extraRequests.push(await addRequest(player, secondGameId));
  }
  await assert.rejects(
    () => startRound({
      gameId: secondGameId,
      requestIds: extraRequests,
      createdBy: administratorIds[0]
    }),
    /máximo 2/
  );
});
