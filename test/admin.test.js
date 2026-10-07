const test=require('node:test');
const assert=require('node:assert/strict');
process.env.PGLITE_DATA_DIR='memory://';process.env.ADMIN_PASSWORD='Testing123!';
const {pool,initializeDatabase}=require('../src/db');
const {createGame,gameCards,archiveUser}=require('../src/services/admin');
const {applyTransaction,reverseTransaction}=require('../src/services/ledger');
let actor,manager,player,game;
test.before(async()=>{
 await initializeDatabase();actor=(await pool.query("SELECT id FROM users WHERE role='superadmin'")).rows[0].id;
 manager=(await pool.query("INSERT INTO users(username,display_name,password_hash,role) VALUES('encargado','Encargado','hash','game_admin') RETURNING id")).rows[0].id;
 player=(await pool.query("INSERT INTO users(username,display_name,password_hash,role,balance) VALUES('jugador','Jugador','hash','player',10000) RETURNING id")).rows[0].id;
});
test.after(async()=>pool.end());
test('crea juego y encargados en una sola operación con caja fija de 30000',async()=>{
 game=await createGame({name:'Mano Dorada',slug:'mano-dorada',minAmount:500,maxAmount:5000,maxPlayers:2,adminIds:[manager,manager],initialBankroll:99999});
 assert.equal(game.initial_bankroll,30000);
 assert.equal((await pool.query('SELECT * FROM game_admins WHERE game_id=$1',[game.id])).rowCount,1);
});
test('asignación inválida revierte todo y no crea el juego',async()=>{
 await assert.rejects(()=>createGame({name:'Inválido',slug:'invalido',minAmount:500,maxAmount:5000,adminIds:[player]}),/encargados/);
 assert.equal((await pool.query("SELECT id FROM games WHERE slug='invalido'")).rowCount,0);
 await assert.rejects(()=>createGame({name:'Rango',slug:'rango',minAmount:5000,maxAmount:500}),/rango/);
});
test('ganancias y pérdidas calculan caja desde la perspectiva de la mesa',async()=>{
 await applyTransaction({userId:player,gameId:game.id,rawAmount:-500,createdBy:actor,type:'game_result'});
 const prize=await applyTransaction({userId:player,gameId:game.id,rawAmount:1000,createdBy:actor,type:'game_result'});
 let card=(await gameCards()).find(g=>Number(g.id)===Number(game.id));
 assert.equal(Number(card.gains),500);assert.equal(Number(card.losses),1000);assert.equal(Number(card.table_balance),29500);
 await reverseTransaction({transactionId:prize.id,createdBy:actor});
 card=(await gameCards()).find(g=>Number(g.id)===Number(game.id));
 assert.equal(Number(card.gains),500);assert.equal(Number(card.losses),0);assert.equal(Number(card.table_balance),30500);
});
test('no elimina a la administración actual ni jugadores en una ronda',async()=>{
 await assert.rejects(()=>archiveUser({userId:actor,actorId:actor}),/propia/);
 const round=(await pool.query('INSERT INTO game_rounds(game_id,created_by) VALUES($1,$2) RETURNING id',[game.id,actor])).rows[0].id;
 const request=(await pool.query("INSERT INTO join_requests(user_id,game_id,status,round_id) VALUES($1,$2,'playing',$3) RETURNING id",[player,game.id,round])).rows[0].id;
 await assert.rejects(()=>archiveUser({userId:player,actorId:actor}),/ronda/);
 await pool.query("UPDATE join_requests SET status='cancelled' WHERE id=$1",[request]);
});
test('elimina del listado, conserva movimientos y retira acceso y asignaciones',async()=>{
 const before=(await pool.query('SELECT COUNT(*)::int AS total FROM transactions WHERE user_id=$1',[player])).rows[0].total;
 await archiveUser({userId:player,actorId:actor});
 const user=(await pool.query('SELECT * FROM users WHERE id=$1',[player])).rows[0];assert.equal(user.active,false);assert.ok(user.archived_at);
 assert.equal((await pool.query('SELECT COUNT(*)::int AS total FROM transactions WHERE user_id=$1',[player])).rows[0].total,before);
 await archiveUser({userId:manager,actorId:actor});assert.equal((await pool.query('SELECT * FROM game_admins WHERE user_id=$1',[manager])).rowCount,0);
});
