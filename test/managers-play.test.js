const test=require('node:test'),assert=require('node:assert/strict');
process.env.PGLITE_DATA_DIR='memory://';process.env.ADMIN_PASSWORD='Testing123!';
const {pool,initializeDatabase}=require('../src/db');const {joinGame}=require('../src/services/bets');const {startRound}=require('../src/services/rounds');test.after(async()=>pool.end());
test('encargados juegan en otras mesas y se bloquea su mesa incluso si se asigna estando en la fila',async()=>{
 await initializeDatabase();const admin=(await pool.query("SELECT id FROM users WHERE role='superadmin'")).rows[0].id;
 const manager=(await pool.query("INSERT INTO users(username,display_name,password_hash,role,balance) VALUES('manager','Encargado','hash','game_admin',10000) RETURNING id")).rows[0].id;
 const games=[];for(const slug of ['mesa-propia','otra-mesa'])games.push((await pool.query("INSERT INTO games(name,slug,min_amount,max_amount) VALUES($1,$1,100,1000) RETURNING id",[slug])).rows[0].id);
 await pool.query('INSERT INTO game_admins(user_id,game_id) VALUES($1,$2)',[manager,games[0]]);
 await assert.rejects(()=>joinGame({slug:'mesa-propia',userId:manager,amount:100,option:'Participar'}),/asignados/);
 const id=await joinGame({slug:'otra-mesa',userId:manager,amount:100,option:'Participar'});assert.ok(id);
 await pool.query('INSERT INTO game_admins(user_id,game_id) VALUES($1,$2)',[manager,games[1]]);
 await assert.rejects(()=>startRound({gameId:games[1],requestIds:[id],createdBy:admin}),/propia mesa/);
});
