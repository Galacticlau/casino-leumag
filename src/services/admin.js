const { pool } = require('../db');

async function gameCards() {
  const result = await pool.query(`SELECT g.*,
    COALESCE(m.gains,0)::bigint AS gains, COALESCE(m.losses,0)::bigint AS losses,
    (g.initial_bankroll + COALESCE(m.gains,0) - COALESCE(m.losses,0))::bigint AS table_balance,
    (SELECT COUNT(*)::int FROM join_requests r WHERE r.game_id=g.id AND r.status='pending' AND r.expires_at>NOW()) AS waiting_count,
    (SELECT COUNT(*)::int FROM join_requests r WHERE r.game_id=g.id AND r.status='playing') AS playing_count
    FROM games g LEFT JOIN (
      SELECT t.game_id, SUM(CASE WHEN t.amount<0 THEN -t.amount ELSE 0 END) AS gains,
        SUM(CASE WHEN t.amount>0 THEN t.amount ELSE 0 END) AS losses
      FROM transactions t WHERE t.type='game_result'
        AND NOT EXISTS(SELECT 1 FROM transactions reversal WHERE reversal.reversal_of=t.id)
      GROUP BY t.game_id
    ) m ON m.game_id=g.id ORDER BY g.active DESC,g.name`);
  return result.rows;
}

function selectedAdmins(raw) {
  const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const ids = [...new Set(values.map(Number))];
  if (ids.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error('Selecciona encargados válidos.');
  return ids;
}
async function createGame({name, slug, description, minAmount, maxAmount, maxPlayers, adminIds}) {
  const minimum=Number(minAmount), maximum=Number(maxAmount), capacity=Number(maxPlayers || 1);
  name=String(name||'').trim(); slug=String(slug||'').trim();
  if (!name || name.length>80 || !slug || slug.length>90 || !Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || minimum<1 || maximum<minimum || maximum>2147483647 || !Number.isSafeInteger(capacity) || capacity<1 || capacity>10) throw new Error('Revisa el nombre, el rango de apuestas y la capacidad (1 a 10).');
  const ids=selectedAdmins(adminIds);
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    for(const id of [...ids].sort((a,b)=>a-b)) {
      const user=await client.query("SELECT id FROM users WHERE id=$1 AND role='game_admin' AND active=TRUE AND archived_at IS NULL FOR SHARE",[id]);
      if(!user.rowCount) throw new Error('Uno de los encargados no está disponible.');
    }
    const result=await client.query(`INSERT INTO games(name,slug,description,min_amount,max_amount,max_players,initial_bankroll)
      VALUES($1,$2,$3,$4,$5,$6,30000) RETURNING *`,[name,slug,String(description||'').trim().slice(0,500),minimum,maximum,capacity]);
    const game=result.rows[0];
    for(const id of ids) await client.query('INSERT INTO game_admins(user_id,game_id) VALUES($1,$2)',[id,game.id]);
    await client.query('COMMIT'); return game;
  } catch(error) { await client.query('ROLLBACK'); if(error.code==='23505')throw new Error('Ya existe un juego con ese enlace.'); throw error; }
  finally {client.release();}
}
async function archiveUser({userId, actorId}) {
  const id=Number(userId);
  if(!Number.isSafeInteger(id)||id<1)throw new Error('Cuenta inválida.');
  if(id===Number(actorId))throw new Error('No puedes eliminar tu propia cuenta.');
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const user=await client.query('SELECT id FROM users WHERE id=$1 AND archived_at IS NULL FOR UPDATE',[id]);
    if(!user.rowCount)throw new Error('La cuenta no existe.');
    const requests=await client.query("SELECT id,status FROM join_requests WHERE user_id=$1 AND status IN ('pending','playing') FOR UPDATE",[id]);
    if(requests.rows.some(r=>r.status==='playing'))throw new Error('Finaliza la ronda del participante antes de eliminar su cuenta.');
    await client.query("UPDATE join_requests SET status='cancelled' WHERE user_id=$1 AND status='pending'",[id]);
    await client.query('DELETE FROM game_admins WHERE user_id=$1',[id]);
    await client.query('UPDATE users SET active=FALSE,archived_at=NOW(),updated_at=NOW() WHERE id=$1',[id]);
    await client.query('COMMIT');
  } catch(error){await client.query('ROLLBACK');throw error;}
  finally{client.release();}
}
module.exports={ gameCards, createGame, archiveUser, selectedAdmins };
