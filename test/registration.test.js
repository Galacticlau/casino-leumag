const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
process.env.PGLITE_DATA_DIR = 'memory://';
process.env.ADMIN_PASSWORD = 'Testing123!';
const { pool, initializeDatabase } = require('../src/db');
const { registrationFields, registerPlayer } = require('../src/services/registration');
test.before(async () => initializeDatabase());
test.after(async () => pool.end());
const fields = { displayName: 'Ana Pérez', username: 'ana.perez', password: '123' };
test('acepta claves sencillas y normaliza nombre.apellido', () => {
  for (const password of ['1','123','a','🔑']) assert.equal(registrationFields({...fields,password}).password,password);
  assert.equal(registrationFields({...fields,username:' ANA.PÉREZ '}).username,'ana.perez');
  assert.throws(()=>registrationFields({...fields,password:''}),/clave/);
  assert.throws(()=>registrationFields({...fields,username:'ana perez'}),/nombre.apellido/);
});
test('inscripción cerrada impide crear usuarios', async () => {
  await assert.rejects(()=>registerPlayer(fields),/cerrada/);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS total FROM users WHERE username='ana.perez'")).rows[0].total,0);
});
test('cuenta con clave 123 tiene 10000 y solo rol participante, con movimiento único', async () => {
  await pool.query('UPDATE app_settings SET registration_open=TRUE');
  const user=await registerPlayer({...fields,role:'superadmin',balance:999999});
  const saved=(await pool.query('SELECT * FROM users WHERE id=$1',[user.id])).rows[0];
  assert.equal(saved.role,'player');assert.equal(saved.balance,10000);assert.equal(saved.must_change_password,false);
  assert.equal(await bcrypt.compare('123',saved.password_hash),true);
  const tx=(await pool.query('SELECT * FROM transactions WHERE user_id=$1',[user.id])).rows;
  assert.equal(tx.length,1);assert.equal(tx[0].amount,10000);assert.equal(tx[0].balance_after,10000);
});
test('usuario duplicado no acredita saldo adicional ni agrega movimientos', async () => {
  await assert.rejects(()=>registerPlayer(fields),/ya existe/);
  const tx=(await pool.query("SELECT t.* FROM transactions t JOIN users u ON u.id=t.user_id WHERE u.username='ana.perez'")).rows;
  assert.equal(tx.length,1);
});
test('dos registros concurrentes con igual usuario crean una sola cuenta', async () => {
  const outcomes=await Promise.allSettled([1,2].map(()=>registerPlayer({...fields,username:'ana.perez2',password:'1'})));
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
});
test('cerrar nuevamente la inscripción conserva las cuentas y rechaza altas nuevas', async () => {
  await pool.query('UPDATE app_settings SET registration_open=FALSE');
  await assert.rejects(()=>registerPlayer({...fields,username:'ana.perez3'}),/cerrada/);
  assert.equal((await pool.query("SELECT balance FROM users WHERE username='ana.perez'")).rows[0].balance,10000);
});
