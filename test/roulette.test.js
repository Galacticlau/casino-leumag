const test=require('node:test'),assert=require('node:assert/strict');
const rules=require('../src/public/roulette-rules');
test('pagos completos y cero excluido de apuestas externas',()=>{
 for(const b of rules.bets){assert.equal(rules.settle(b.id,100,b.numbers[0]).payout,100*b.multiplier);assert.equal(rules.settle(b.id,100,b.numbers[0]).net,100*(b.multiplier-1));}
 for(const id of ['rojo','negro','par','impar','bajo','alto','docena1','columna3'])assert.equal(rules.settle(id,100,0).net,-100);
 assert.equal(rules.settle('pleno-0',800,0).net,28000);
 for(const args of [['pleno-1',801,1],['rojo',1501,1],['rojo',99,1],['rojo',100,37],['rojo',100,''],['fake',100,1]])assert.throws(()=>rules.settle(...args));
});
process.env.PGLITE_DATA_DIR='memory://';process.env.ADMIN_PASSWORD='Testing123!';
const {pool,initializeDatabase}=require('../src/db');const {joinGame}=require('../src/services/bets');const {startRound,completeRound}=require('../src/services/rounds');
test.after(async()=>pool.end());
test('ruleta liquida apuestas guardadas, ignora montos enviados y no duplica el cierre',async()=>{
 await initializeDatabase();const admin=(await pool.query("SELECT id FROM users WHERE role='superadmin'")).rows[0].id;
 const game=(await pool.query("INSERT INTO games(name,slug,max_players) VALUES('Ruleta','ruleta',2) RETURNING id")).rows[0].id;
 const ids=[];for(const [name,option] of [['a','pleno-17'],['b','rojo']]){const u=(await pool.query("INSERT INTO users(username,display_name,password_hash,role,balance) VALUES($1,$1,'hash','player',10000) RETURNING id",[name])).rows[0].id;ids.push(await joinGame({slug:'ruleta',userId:u,amount:100,option}));}
 const round=await startRound({gameId:game,requestIds:ids,createdBy:admin});
 const args={gameId:game,roundId:round.id,winningNumber:17,createdBy:admin,results:ids.map(requestId=>({requestId,amount:999999,stake:999999,betId:'fake'}))};
 const tx=await completeRound(args);assert.deepEqual(tx.map(t=>t.amount),[3500,-100]);assert.ok(tx.every(t=>t.note.includes('salió 17')));await assert.rejects(()=>completeRound(args),/procesada/);
});
