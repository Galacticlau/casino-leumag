const bcrypt = require('bcryptjs');
const { pool } = require('../db');

function registrationFields({ displayName, username, password }) {
  const name = String(displayName || '').trim();
  const login = String(username || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const secret = String(password || '');
  if (!name || name.length > 80) throw new Error('Escribe tu nombre completo (hasta 80 caracteres).');
  if (login.length > 40 || !/^[a-z]+\.[a-z]+[0-9]*$/.test(login)) throw new Error('Usa nombre.apellido, sin espacios. Si ya existe, agrega un número al final.');
  if (!secret.length) throw new Error('Escribe una clave. Puede ser sencilla, como 123.');
  return { displayName: name, username: login, password: secret };
}

async function registerPlayer(rawFields) {
  const fields = registrationFields(rawFields);
  const hash = await bcrypt.hash(fields.password, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const settings = await client.query('SELECT registration_open FROM app_settings WHERE id = 1 FOR SHARE');
    if (!settings.rows[0]?.registration_open) throw new Error('La inscripción está cerrada. Consulta a la administración.');
    const result = await client.query(
      `INSERT INTO users (username, display_name, password_hash, role, balance, must_change_password)
       VALUES ($1, $2, $3, 'player', 10000, FALSE) RETURNING id, username, display_name, role`,
      [fields.username, fields.displayName, hash]);
    const user = result.rows[0];
    await client.query(
      `INSERT INTO transactions (user_id, amount, balance_before, balance_after, type, note, created_by)
       VALUES ($1, 10000, 0, 10000, 'adjustment', 'Saldo inicial · inscripción por QR', $1)`, [user.id]);
    await client.query('COMMIT');
    return user;
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') throw new Error('Ese usuario ya existe. Agrega un número al apellido, por ejemplo ana.perez2, o inicia sesión.');
    throw error;
  } finally { client.release(); }
}
module.exports = { registrationFields, registerPlayer };
