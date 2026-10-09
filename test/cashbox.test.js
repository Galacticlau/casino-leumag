const test=require('node:test'),assert=require('node:assert/strict');
process.env.PGLITE_DATA_DIR='memory://';process.env.ADMIN_PASSWORD='Testing123!';
const {pool,initializeDatabase}=require('../src/db');const {joinGame,betOptions}=require('../src/services/bets');const {startRound,completeRound}=require('../src/services/rounds');
test.after(async()=>pool.end());
test('Caja: entra sin apostar, descuenta el premio y evita sobregiros o cierres repetidos',async()=>{
 await initializeDatabase();const admin=(await pool.query("SELECT id FROM users WHERE role='superadmin'")).rows[0].id;
 const game=(await pool.query("INSERT INTO games(name,slug,min_amount,max_amount) VALUES('Caja','caja',1000,1000) RETURNING *")).rows[0];assert.deepEqual(betOptions(game),[]);
 const user=(await pool.query("INSERT INTO users(username,display_name,password_hash,role,balance) VALUES('canje','Canje','hash','player',10000) RETURNING id")).rows[0].id;
 const request=await joinGame({slug:'caja',userId:user});const round=await startRound({gameId:game.id,requestIds:[request],createdBy:admin});
 const args={gameId:game.id,roundId:round.id,createdBy:admin,results:[{requestId:request,amount:15000,note:'Premio'}]};
 await pool.query('UPDATE app_settings SET allow_negative=TRUE');await assert.rejects(()=>completeRound(args),/saldo/);
 args.results[0].amount=2500;const tx=await completeRound(args);assert.equal(tx[0].amount,-2500);assert.match(tx[0].note,/Canje de premio/);assert.equal((await pool.query('SELECT balance FROM users WHERE id=$1',[user])).rows[0].balance,7500);await assert.rejects(()=>completeRound(args),/procesada/);
});
