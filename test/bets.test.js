const test = require('node:test');
const assert = require('node:assert/strict');
process.env.PGLITE_DATA_DIR = 'memory://';
process.env.ADMIN_PASSWORD = 'TestingCasino123!';
const { pool, initializeDatabase } = require('../src/db');
const { betOptions, parseOptions, validateBet, joinGame } = require('../src/services/bets');
const { startRound, cancelRound, completeRound } = require('../src/services/rounds');
let userId, adminId, gameId;
const game = { name:'Bacará', slug:'bacara', min_amount:100, max_amount:1000, bet_options:['Jugador','Banca','Empate'] };
test.before(async () => {
  await initializeDatabase();
  adminId = (await pool.query("SELECT id FROM users WHERE username='admin'")).rows[0].id;
  userId = (await pool.query("INSERT INTO users (username,display_name,password_hash,role,balance) VALUES ('ana.perez','Ana Pérez','hash','player',10000) RETURNING id")).rows[0].id;
  gameId = (await pool.query("INSERT INTO games (name,slug,min_amount,max_amount,bet_options) VALUES ('Bacará','bacara',100,1000,$1::jsonb) RETURNING id",[JSON.stringify(game.bet_options)])).rows[0].id;
});
test.after(async () => pool.end());
test('opciones editables y excepción para bingo y ruleta', () => {
  assert.deepEqual(parseOptions('Jugador\nBanca\nEmpate'),game.bet_options);
  assert.throws(()=>parseOptions('Banca\nbanca'));
  assert.throws(()=>parseOptions(''));
  for(const name of ['Bingo musical','Ruleta matemática']) assert.deepEqual(betOptions({...game,name}),[]);
});
test('Mano Dorada siempre exige apuesta aunque falten opciones o lleguen como JSON de texto', () => {
  for (const options of [undefined, null, [], '', '[]', 'incorrecto', {}, [null, '']]) {
    const mano = {...game, name:'Mano Dorada', slug:'mano-dorada', bet_options: options};
    assert.deepEqual(betOptions(mano), ['Participar']);
    assert.throws(() => validateBet(mano, undefined, '', 12000), /monto/);
  }
  assert.deepEqual(betOptions({...game, bet_options:'["Banca","Jugador"]'}), ['Banca','Jugador']);
  assert.deepEqual(betOptions({...game, name:'Bingo', bet_options:null}), []);
});
test('rechaza montos y opciones inválidos o apuestas que exceden el saldo', () => {
  for (const amount of [0,99,1001,1.5,NaN]) assert.throws(()=>validateBet(game,amount,'Jugador',10000));
  assert.throws(()=>validateBet(game,500,'Jugador',200),/saldo/);
  assert.throws(()=>validateBet(game,100,'Opción inventada',10000),/opciones/);
});
test('confirma una sola apuesta concurrente, la conserva al reenviar y bloquea entrada a otro juego', async () => {
  const ids=await Promise.all([1,2].map(()=>joinGame({slug:'bacara',userId,amount:500,option:'Banca'})));
  assert.equal(ids[0],ids[1]);
  assert.equal(await joinGame({slug:'bacara',userId,amount:100,option:'Jugador'}),ids[0]);
  const request=(await pool.query('SELECT * FROM join_requests WHERE id=$1',[ids[0]])).rows[0];
  assert.equal(request.bet_amount,500); assert.equal(request.bet_option,'Banca');
  assert.equal((await pool.query('SELECT balance FROM users WHERE id=$1',[userId])).rows[0].balance,10000);
  await pool.query("INSERT INTO games(name,slug) VALUES('Blackjack','blackjack')");
  await assert.rejects(()=>joinGame({slug:'blackjack',userId,amount:100,option:'Participar'}),/otro juego/);
  const round=await startRound({gameId,requestIds:[ids[0]],createdBy:adminId});
  assert.equal(await joinGame({slug:'bacara',userId,amount:100,option:'Jugador'}),ids[0]);
  await completeRound({gameId,roundId:round.id,createdBy:adminId,results:[{requestId:ids[0],outcome:'loss',amount:100}]});
  assert.equal((await pool.query('SELECT balance FROM users WHERE id=$1',[userId])).rows[0].balance,9500);
  await assert.rejects(()=>completeRound({gameId,roundId:round.id,createdBy:adminId,results:[{requestId:ids[0],outcome:'loss',amount:500}]}),/procesada/);
});
test('verifica saldo al iniciar, cancelar conserva apuesta y ganar registra solo ganancia neta', async () => {
  const requestId=await joinGame({slug:'bacara',userId,amount:1000,option:'Empate'});
  await pool.query('UPDATE users SET balance=500 WHERE id=$1',[userId]);
  await assert.rejects(()=>startRound({gameId,requestIds:[requestId],createdBy:adminId}),/saldo/);
  await pool.query('UPDATE users SET balance=9500 WHERE id=$1',[userId]);
  const round=await startRound({gameId,requestIds:[requestId],createdBy:adminId});
  await cancelRound({gameId,roundId:round.id});
  const request=(await pool.query('SELECT * FROM join_requests WHERE id=$1',[requestId])).rows[0];
  assert.equal(request.bet_amount,1000); assert.equal(request.status,'pending');
  const next=await startRound({gameId,requestIds:[requestId],createdBy:adminId});
  await completeRound({gameId,roundId:next.id,createdBy:adminId,results:[{requestId,outcome:'win',amount:200}]});
  assert.equal((await pool.query('SELECT balance FROM users WHERE id=$1',[userId])).rows[0].balance,9700);
});
test('no inicia una participación antigua sin apuesta confirmada', async () => {
  const id = (await pool.query('INSERT INTO join_requests(user_id,game_id) VALUES($1,$2) RETURNING id', [userId,gameId])).rows[0].id;
  await assert.rejects(() => startRound({gameId,requestIds:[id],createdBy:adminId}), /confirmar su apuesta/);
  await pool.query("UPDATE join_requests SET status='cancelled' WHERE id=$1", [id]);
});
test('bingo y ruleta admiten entrada sin apuesta y no guardan montos enviados', async () => {
  for (const slug of ['bingo','ruleta']) {
    await pool.query('INSERT INTO games(name,slug) VALUES($1,$2)',[slug,slug]);
    const id=await joinGame({slug,userId,amount:99999,option:'inventada'});
    const request=(await pool.query('SELECT * FROM join_requests WHERE id=$1',[id])).rows[0];
    assert.equal(request.bet_amount,null); assert.equal(request.bet_option,null);
    await pool.query("UPDATE join_requests SET status='cancelled' WHERE id=$1",[id]);
  }
});
