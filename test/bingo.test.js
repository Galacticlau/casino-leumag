const test=require('node:test');const assert=require('node:assert/strict');
process.env.PGLITE_DATA_DIR='memory://';process.env.ADMIN_PASSWORD='Testing123!';
const {pool,initializeDatabase}=require('../src/db');const {joinGame,validateBet}=require('../src/services/bets');const {startRound,completeRound}=require('../src/services/rounds');
test.after(async()=>pool.end());
test('bingo: apuesta confirmada, premio triple o pérdida total y cierre único',async()=>{
 await initializeDatabase();const admin=(await pool.query("SELECT id FROM users WHERE role='superadmin'")).rows[0].id;
 const game=(await pool.query("INSERT INTO games(name,slug,min_amount,max_amount) VALUES('Bingo','bingo',1000,1000) RETURNING *")).rows[0];
 assert.throws(()=>validateBet(game,500,'Participar',10000),/rango/);
 assert.deepEqual(validateBet({name:'Bingo',slug:'bingo',min_amount:500,max_amount:5000},500,'Participar',10000),{amount:500,option:'Participar'});
 for(const [index,outcome,delta] of [[0,'win',2000],[1,'loss',-1000]]) {
  const user=(await pool.query("INSERT INTO users(username,display_name,password_hash,role,balance) VALUES($1,'Prueba','hash','player',10000) RETURNING id",['key'+index])).rows[0].id;
  const request=await joinGame({slug:game.slug,userId:user,amount:1000,option:'Participar'});
  const round=await startRound({gameId:game.id,requestIds:[request],createdBy:admin});
  const args={gameId:game.id,roundId:round.id,createdBy:admin,results:[{requestId:request,outcome,amount:999999}]};
  const tx=await completeRound(args);assert.equal(tx[0].amount,delta);
  assert.equal((await pool.query('SELECT balance FROM users WHERE id=$1',[user])).rows[0].balance,10000+delta);
  await assert.rejects(()=>completeRound(args),/procesada/);
 }
});
