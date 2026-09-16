require('dotenv').config();
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { pool, initializeDatabase, getSettings } = require('../src/db');

async function upsertUser({ username, name, password, role, balance = 0 }) {
  const hash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    `INSERT INTO users (username, display_name, password_hash, role, balance, must_change_password)
     VALUES ($1, $2, $3, $4, $5, FALSE)
     ON CONFLICT (username) DO UPDATE SET display_name = EXCLUDED.display_name,
       password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, must_change_password = FALSE
     RETURNING id`,
    [username, name, hash, role, balance]
  );
  return result.rows[0].id;
}

async function upsertGame(name, slug, description) {
  const result = await pool.query(
    `INSERT INTO games (name, slug, description, min_amount, max_amount, max_players)
     VALUES ($1, $2, $3, 10, 500, 4)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
       max_players = EXCLUDED.max_players
     RETURNING id`,
    [name, slug, description]
  );
  return result.rows[0].id;
}

async function seed() {
  await initializeDatabase();
  const settings = await getSettings();
  const adminPassword = `Mesa-${crypto.randomBytes(7).toString('base64url')}`;
  const playerPassword = `Juega-${crypto.randomBytes(7).toString('base64url')}`;
  const adminId = await upsertUser({ username: 'mesa1', name: 'Encargado Mesa 1', password: adminPassword, role: 'game_admin' });
  const playerId = await upsertUser({ username: 'jugador1', name: 'Jugador de prueba', password: playerPassword, role: 'player', balance: settings.initial_balance });
  const gameId = await upsertGame('Ruleta de prueba', 'ruleta-prueba', 'Juego de demostración para comprobar el circuito completo.');
  await pool.query('INSERT INTO game_admins (user_id, game_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [adminId, gameId]);

  const existing = await pool.query(`SELECT 1 FROM transactions WHERE user_id = $1 AND note = 'Saldo inicial de demostración'`, [playerId]);
  if (!existing.rowCount && settings.initial_balance > 0) {
    const superadmin = await pool.query(`SELECT id FROM users WHERE role = 'superadmin' ORDER BY id LIMIT 1`);
    await pool.query(
      `INSERT INTO transactions (user_id, amount, balance_before, balance_after, type, note, created_by)
       VALUES ($1, $2, 0, $2, 'adjustment', 'Saldo inicial de demostración', $3)`,
      [playerId, settings.initial_balance, superadmin.rows[0].id]
    );
  }
  console.log('Datos de demostración creados.');
  console.log(`Encargado: mesa1 / ${adminPassword}`);
  console.log(`Jugador: jugador1 / ${playerPassword}`);
}

seed().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => pool.end());
