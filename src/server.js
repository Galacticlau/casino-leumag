require('dotenv').config();

const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const QRCode = require('qrcode');

const { pool, initializeDatabase, getSettings } = require('./db');
const { requireLogin, requireRole, redirectByRole } = require('./auth');
const { applyTransaction, reverseTransaction } = require('./services/ledger');
const { startRound, cancelRound, completeRound } = require('./services/rounds');
const { parseNames } = require('./public/csv-users');
const { betOptions, parseOptions, joinGame } = require('./services/bets');
const { registerPlayer } = require('./services/registration');
const { gameCards, createGame, archiveUser } = require('./services/admin');
const EmbeddedSessionStore = require('./session-store');

const app = express();
const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

function configuredPublicBaseUrl() {
  const explicitUrl = String(process.env.PUBLIC_URL || '').trim().replace(/\/$/, '');
  if (explicitUrl) return explicitUrl;

  const railwayDomain = String(process.env.RAILWAY_PUBLIC_DOMAIN || '')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
  return railwayDomain ? `https://${railwayDomain}` : '';
}

const configuredPublicUrl = configuredPublicBaseUrl();
const usesHttps = configuredPublicUrl.startsWith('https://');

if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error('Define SESSION_SECRET antes de iniciar la aplicación en producción.');
}

function findLocalAddress() {
  try {
    const addresses = Object.values(os.networkInterfaces()).flat().filter((item) =>
      item && item.family === 'IPv4' && !item.internal
    );
    return addresses.find((item) => item.address.startsWith('192.168.'))?.address
      || addresses.find((item) => item.address.startsWith('10.'))?.address
      || addresses.find((item) => /^172\.(1[6-9]|2\d|3[01])\./.test(item.address))?.address
      || addresses[0]?.address
      || 'localhost';
  } catch (_error) {
    return 'localhost';
  }
}

function publicBaseUrl(req) {
  if (configuredPublicUrl) return configuredPublicUrl;
  const requestedHost = req.get('host') || '';
  if (requestedHost && !requestedHost.startsWith('localhost') && !requestedHost.startsWith('127.0.0.1')) {
    return `${req.protocol}://${requestedHost}`;
  }
  return `http://${findLocalAddress()}:${port}`;
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
if (isProduction) app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"]
    }
  }
}));
app.use(express.urlencoded({ extended: false, limit: '150kb' }));
app.use(express.json({ limit: '150kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: isProduction ? '1h' : 0 }));
app.use(session({
  store: new EmbeddedSessionStore(pool),
  secret: process.env.SESSION_SECRET || 'solo-desarrollo-cambiar-esta-clave',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: usesHttps,
    maxAge: 1000 * 60 * 60 * 10
  }
}));

app.use((req, res, next) => {
  if (!req.session.user) return next();
  pool.query('SELECT id,username,display_name,role,active,archived_at FROM users WHERE id=$1', [req.session.user.id])
    .then(result => {
      const user=result.rows[0];
      if (!user || !user.active || user.archived_at) return req.session.destroy(() => {
        if (req.path.startsWith('/api/')) return res.status(401).json({ error:'La cuenta no está disponible.' });
        res.redirect('/login');
      });
      Object.assign(req.session.user, { username:user.username, displayName:user.display_name, role:user.role });
      next();
    }).catch(next);
});

app.use((req, res, next) => {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;
  res.locals.currentUser = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.formatNumber = (value) => new Intl.NumberFormat('es-CL').format(Number(value || 0));
  res.locals.formatDate = (value) => new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Punta_Arenas'
  }).format(new Date(value));
  next();
});

app.use((req, res, next) => {
  if (req.method !== 'POST') return next();
  if (!req.body || req.body._csrf !== req.session.csrfToken) {
    return res.status(403).render('error', {
      title: 'Solicitud vencida',
      message: 'Actualiza la página e intenta nuevamente.'
    });
  }
  next();
});

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function slugify(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 90);
}

async function canManageGame(user, gameId) {
  if (user.role === 'superadmin') return true;
  const result = await pool.query(
    'SELECT 1 FROM game_admins WHERE user_id = $1 AND game_id = $2',
    [user.id, gameId]
  );
  return result.rowCount > 0;
}

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  return res.redirect(redirectByRole(req.session.user));
});

app.get('/login', asyncRoute(async (req, res) => {
  if (req.session.user) return res.redirect(redirectByRole(req.session.user));
  const settings = await getSettings();
  return res.render('login', { title: 'Ingresar', settings });
}));

app.get('/register', asyncRoute(async (req, res) => {
  const settings = await getSettings();
  res.setHeader('Cache-Control', 'no-store');
  res.render('register', { title: 'Crear cuenta', settings, fields: {} });
}));

const registrationLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 200, standardHeaders: true, legacyHeaders: false });
app.post('/register', registrationLimiter, asyncRoute(async (req, res) => {
  if (req.session.user) return res.redirect('/');
  let user;
  try { user = await registerPlayer(req.body); }
  catch (error) {
    const settings = await getSettings();
    res.locals.flash = { type: 'error', message: error.message };
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).render('register', { title: 'Crear cuenta', settings, fields: {
      displayName: String(req.body.displayName || '').slice(0, 80), username: String(req.body.username || '').slice(0, 40)
    } });
  }
  await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
  req.session.user = { id: Number(user.id), username: user.username, displayName: user.display_name, role: 'player', mustChangePassword: false };
  return req.session.save(() => res.redirect('/player'));
}));

app.get('/super/registration', requireRole('superadmin'), asyncRoute(async (req, res) => {
  const settings = await getSettings();
  res.setHeader('Cache-Control', 'no-store');
  res.render('registration-qr', { title: 'QR de inscripción', settings, registrationUrl: `${publicBaseUrl(req)}/register` });
}));

app.post('/super/registration', requireRole('superadmin'), asyncRoute(async (req, res) => {
  await pool.query('UPDATE app_settings SET registration_open = $1, updated_at = NOW() WHERE id = 1', [req.body.open === 'true']);
  res.redirect('/super/registration');
}));

app.get('/super/registration/qr.png', requireRole('superadmin'), asyncRoute(async (req, res) => {
  const settings = await getSettings();
  if (!settings.registration_open) return res.sendStatus(404);
  const png = await QRCode.toBuffer(`${publicBaseUrl(req)}/register`, { width: 600, margin: 2, errorCorrectionLevel: 'H' });
  res.setHeader('Cache-Control', 'no-store');
  res.type('png').send(png);
}));

const loginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
app.post('/login', loginLimiter, asyncRoute(async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const result = await pool.query(
    'SELECT id, username, display_name, password_hash, role, active, must_change_password FROM users WHERE username = $1',
    [username]
  );
  const user = result.rows[0];
  if (!user || !user.active || !(await bcrypt.compare(password, user.password_hash))) {
    setFlash(req, 'error', 'Usuario o clave incorrectos.');
    return res.redirect('/login');
  }

  req.session.user = {
    id: Number(user.id), username: user.username, displayName: user.display_name,
    role: user.role, mustChangePassword: user.must_change_password
  };
  const destination = user.must_change_password ? '/account/password' : (req.session.returnTo || redirectByRole(user));
  if (!user.must_change_password) delete req.session.returnTo;
  return req.session.save(() => res.redirect(destination));
}));

app.post('/logout', requireLogin, (req, res) => req.session.destroy(() => res.redirect('/login')));

app.get('/account/password', requireLogin, (req, res) => {
  res.render('password', { title: 'Cambiar clave' });
});

app.post('/account/password', requireLogin, asyncRoute(async (req, res) => {
  const current = String(req.body.currentPassword || '');
  const password = String(req.body.newPassword || '');
  const confirmation = String(req.body.confirmation || '');
  if (password.length < 6 || password !== confirmation) {
    setFlash(req, 'error', 'La nueva clave debe tener al menos 6 caracteres y ambas copias deben coincidir.');
    return res.redirect('/account/password');
  }
  const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.session.user.id]);
  if (!(await bcrypt.compare(current, result.rows[0].password_hash))) {
    setFlash(req, 'error', 'La clave actual no es correcta.');
    return res.redirect('/account/password');
  }
  const hash = await bcrypt.hash(password, 12);
  await pool.query('UPDATE users SET password_hash = $1, must_change_password = FALSE, updated_at = NOW() WHERE id = $2', [hash, req.session.user.id]);
  req.session.user.mustChangePassword = false;
  setFlash(req, 'success', 'Tu clave fue actualizada.');
  const destination = req.session.returnTo || redirectByRole(req.session.user);
  delete req.session.returnTo;
  return res.redirect(destination);
}));

// ---------- Jugadores ----------

app.get('/player', requireRole('player'), asyncRoute(async (req, res) => {
  const [userResult, transactionsResult, settings] = await Promise.all([
    pool.query('SELECT id, display_name, username, balance FROM users WHERE id = $1', [req.session.user.id]),
    pool.query(
      `SELECT t.*, g.name AS game_name, a.display_name AS admin_name
       FROM transactions t
       LEFT JOIN games g ON g.id = t.game_id
       JOIN users a ON a.id = t.created_by
       WHERE t.user_id = $1 ORDER BY t.created_at DESC LIMIT 30`,
      [req.session.user.id]
    ),
    getSettings()
  ]);
  res.render('player', {
    title: 'Mi cuenta', player: userResult.rows[0], transactions: transactionsResult.rows, settings
  });
}));

app.post('/player/profile', requireRole('player'), asyncRoute(async (req, res) => {
  const displayName = String(req.body.displayName || '').trim();
  const username = String(req.body.username || '').trim().toLowerCase();
  const currentPassword = String(req.body.currentPassword || '');

  if (!displayName || displayName.length > 80) {
    setFlash(req, 'error', 'Escribe tu nombre y apellido.');
    return res.redirect('/player');
  }
  if (!/^[a-z0-9]+\.[a-z0-9._-]+$/.test(username) || username.length < 5 || username.length > 40) {
    setFlash(req, 'error', 'El usuario debe seguir el formato nombre.apellido, sin espacios ni tildes.');
    return res.redirect('/player');
  }

  const currentResult = await pool.query(
    'SELECT password_hash FROM users WHERE id = $1',
    [req.session.user.id]
  );
  if (!currentResult.rowCount || !(await bcrypt.compare(currentPassword, currentResult.rows[0].password_hash))) {
    setFlash(req, 'error', 'La clave actual no es correcta.');
    return res.redirect('/player');
  }

  try {
    await pool.query(
      `UPDATE users SET display_name = $1, username = $2, updated_at = NOW() WHERE id = $3`,
      [displayName, username, req.session.user.id]
    );
    req.session.user.displayName = displayName;
    req.session.user.username = username;
    setFlash(req, 'success', 'Tu cuenta fue personalizada correctamente.');
  } catch (error) {
    if (error.code === '23505') setFlash(req, 'error', 'Ese nombre de usuario ya está siendo utilizado. Prueba con otro.');
    else throw error;
  }
  return res.redirect('/player');
}));

app.get('/game/:slug', requireRole('player'), asyncRoute(async (req, res) => {
  const gameResult = await pool.query('SELECT * FROM games WHERE slug = $1 AND active = TRUE', [req.params.slug]);
  if (!gameResult.rowCount) return res.status(404).render('error', { title: 'Juego no disponible', message: 'El QR no corresponde a un juego activo.' });
  const [userResult, settings] = await Promise.all([
    pool.query('SELECT balance FROM users WHERE id = $1', [req.session.user.id]),
    getSettings()
  ]);
  res.render('game', { title: gameResult.rows[0].name, game: gameResult.rows[0], balance: userResult.rows[0].balance, settings, betOptions: betOptions(gameResult.rows[0]) });
}));

app.post('/game/:slug/join', requireRole('player'), asyncRoute(async (req, res) => {
  try {
    const id = await joinGame({ slug: req.params.slug, userId: req.session.user.id, amount: req.body.betAmount, option: req.body.betOption });
    return res.redirect(`/player/wait/${id}`);
  } catch (error) {
    setFlash(req, 'error', error.message);
    return res.redirect(`/game/${encodeURIComponent(req.params.slug)}`);
  }
}));

app.get('/player/wait/:id', requireRole('player'), asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT r.*, g.name AS game_name, u.balance
     FROM join_requests r JOIN games g ON g.id = r.game_id JOIN users u ON u.id = r.user_id
     WHERE r.id = $1 AND r.user_id = $2`,
    [req.params.id, req.session.user.id]
  );
  if (!result.rowCount) return res.status(404).render('error', { title: 'Participación no encontrada', message: 'Esta solicitud no existe.' });
  const settings = await getSettings();
  res.render('wait', { title: 'Esperando resultado', joinRequest: result.rows[0], settings });
}));

app.get('/api/player/request/:id', requireRole('player'), asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT r.status, r.transaction_id, u.balance, t.amount
     FROM join_requests r JOIN users u ON u.id = r.user_id
     LEFT JOIN transactions t ON t.id = r.transaction_id
     WHERE r.id = $1 AND r.user_id = $2`,
    [req.params.id, req.session.user.id]
  );
  if (!result.rowCount) return res.status(404).json({ error: 'No encontrada' });
  res.json(result.rows[0]);
}));

app.post('/player/request/:id/cancel', requireRole('player'), asyncRoute(async (req, res) => {
  await pool.query(
    `UPDATE join_requests SET status = 'cancelled' WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
    [req.params.id, req.session.user.id]
  );
  res.redirect('/player');
}));

// ---------- Encargados de juego ----------

app.get('/admin', requireRole('game_admin', 'superadmin'), asyncRoute(async (req, res) => {
  const games = await gameCards(req.session.user.role === 'superadmin' ? null : req.session.user.id);
  res.render('admin-index', { title: 'Mis juegos', games });
}));

app.get('/admin/game/:id', requireRole('game_admin', 'superadmin'), asyncRoute(async (req, res) => {
  if (!(await canManageGame(req.session.user, req.params.id))) return res.status(403).render('error', { title: 'Acceso restringido', message: 'Este juego no está asignado a tu cuenta.' });
  const games = await gameCards(null, req.params.id);
  if (!games.length) return res.status(404).render('error', { title: 'Juego no encontrado', message: 'El juego solicitado no existe.' });
  const settings = await getSettings();
  res.render('admin-game', { title: games[0].name, game: games[0], settings });
}));

app.get('/api/admin/game/:id/queue', requireRole('game_admin', 'superadmin'), asyncRoute(async (req, res) => {
  if (!(await canManageGame(req.session.user, req.params.id))) return res.status(403).json({ error: 'Sin permiso' });
  await pool.query(`UPDATE join_requests SET status = 'expired' WHERE game_id = $1 AND status = 'pending' AND expires_at <= NOW()`, [req.params.id]);
  const [queueResult, roundResult] = await Promise.all([
    pool.query(
      `SELECT r.id, r.created_at, r.expires_at, r.bet_amount, r.bet_option, u.id AS user_id, u.display_name, u.username, u.balance
       FROM join_requests r JOIN users u ON u.id = r.user_id
       WHERE r.game_id = $1 AND r.status = 'pending' AND r.expires_at > NOW()
       ORDER BY r.created_at ASC`,
      [req.params.id]
    ),
    pool.query(
      `SELECT gr.id, gr.created_at, r.id AS request_id, r.bet_amount, r.bet_option, u.id AS user_id,
        u.display_name, u.username, u.balance
       FROM game_rounds gr
       LEFT JOIN join_requests r ON r.round_id = gr.id AND r.status = 'playing'
       LEFT JOIN users u ON u.id = r.user_id
       WHERE gr.game_id = $1 AND gr.status = 'active'
       ORDER BY r.created_at ASC`,
      [req.params.id]
    )
  ]);
  let activeRound = null;
  if (roundResult.rowCount) {
    activeRound = {
      id: roundResult.rows[0].id,
      created_at: roundResult.rows[0].created_at,
      participants: roundResult.rows.filter((row) => row.request_id).map((row) => ({
        request_id: row.request_id,
        user_id: row.user_id,
        display_name: row.display_name,
        username: row.username,
        balance: row.balance, bet_amount: row.bet_amount, bet_option: row.bet_option
      }))
    };
  }
  const [finance] = await gameCards(null, req.params.id);
  res.json({ requests: queueResult.rows, activeRound, finance: finance ? { initial_bankroll: finance.initial_bankroll, table_balance: finance.table_balance, gains: finance.gains, losses: finance.losses } : null });
}));

app.post('/admin/game/:id/rounds/start', requireRole('game_admin', 'superadmin'), asyncRoute(async (req, res) => {
  if (!(await canManageGame(req.session.user, req.params.id))) throw new Error('No tienes permiso para administrar este juego.');
  try {
    await startRound({
      gameId: req.params.id,
      requestIds: req.body.requestIds,
      createdBy: req.session.user.id
    });
    setFlash(req, 'success', 'Ronda iniciada correctamente.');
  } catch (error) {
    setFlash(req, 'error', error.message);
  }
  res.redirect(`/admin/game/${req.params.id}`);
}));

app.post('/admin/game/:id/rounds/:roundId/finish', requireRole('game_admin', 'superadmin'), asyncRoute(async (req, res) => {
  if (!(await canManageGame(req.session.user, req.params.id))) throw new Error('No tienes permiso para administrar este juego.');
  try {
    const results = JSON.parse(String(req.body.results || '[]'));
    await completeRound({
      gameId: req.params.id,
      roundId: req.params.roundId,
      results,
      createdBy: req.session.user.id
    });
    setFlash(req, 'success', 'Ronda cerrada y saldos actualizados.');
  } catch (error) {
    setFlash(req, 'error', error instanceof SyntaxError ? 'Los resultados enviados no son válidos.' : error.message);
  }
  res.redirect(`/admin/game/${req.params.id}`);
}));

app.post('/admin/game/:id/rounds/:roundId/cancel', requireRole('game_admin', 'superadmin'), asyncRoute(async (req, res) => {
  if (!(await canManageGame(req.session.user, req.params.id))) throw new Error('No tienes permiso para administrar este juego.');
  try {
    await cancelRound({ gameId: req.params.id, roundId: req.params.roundId });
    setFlash(req, 'success', 'Ronda cancelada. Los participantes volvieron a la fila.');
  } catch (error) {
    setFlash(req, 'error', error.message);
  }
  res.redirect(`/admin/game/${req.params.id}`);
}));

// ---------- Administración general ----------

app.get('/super', requireRole('superadmin'), asyncRoute(async (req, res) => {
  const [users,games,assignments,transactions,settings]=await Promise.all([
    pool.query("SELECT id,username,display_name,role,balance,active FROM users WHERE archived_at IS NULL ORDER BY display_name"),
    gameCards(),
    pool.query(`SELECT ga.user_id,ga.game_id,u.display_name,u.active FROM game_admins ga JOIN users u ON u.id=ga.user_id WHERE u.archived_at IS NULL ORDER BY u.display_name`),
    pool.query(`SELECT t.*,p.display_name AS player_name,a.display_name AS admin_name,g.name AS game_name,
      EXISTS(SELECT 1 FROM transactions r WHERE r.reversal_of=t.id) AS reversed
      FROM transactions t JOIN users p ON p.id=t.user_id JOIN users a ON a.id=t.created_by
      LEFT JOIN games g ON g.id=t.game_id ORDER BY t.created_at DESC LIMIT 60`),getSettings()
  ]);
  res.render('super',{ title:'Juegos',users:users.rows,games:games.map(game=>({...game,availableBetOptions:betOptions(game)})),assignments:assignments.rows,transactions:transactions.rows,settings });
}));

app.get('/super/users', requireRole('superadmin'), asyncRoute(async (req,res)=>{
  const [users,settings]=await Promise.all([pool.query('SELECT id,username,display_name,role,balance,active FROM users WHERE archived_at IS NULL ORDER BY display_name'),getSettings()]);
  res.render('super-users',{title:'Usuarios',users:users.rows,settings});
}));

app.post('/super/users/:id/edit',requireRole('superadmin'),asyncRoute(async(req,res)=>{
  const name=String(req.body.displayName||'').trim(), username=String(req.body.username||'').trim().toLowerCase();
  if(!name || name.length>80 || !/^[a-z0-9._-]{3,40}$/.test(username)) { setFlash(req,'error','Revisa el nombre y el usuario (3 a 40 caracteres).'); return res.redirect('/super/users'); }
  try {
    const result=await pool.query('UPDATE users SET display_name=$1,username=$2,updated_at=NOW() WHERE id=$3 AND archived_at IS NULL',[name,username,req.params.id]);
    setFlash(req,result.rowCount?'success':'error',result.rowCount?'Datos actualizados.':'La cuenta no existe.');
  } catch(error){if(error.code==='23505')setFlash(req,'error','Ese usuario ya existe.');else throw error;}
  res.redirect('/super/users');
}));

app.post('/super/users/:id/delete',requireRole('superadmin'),asyncRoute(async(req,res)=>{
  try{await archiveUser({userId:req.params.id,actorId:req.session.user.id});setFlash(req,'success','Usuario eliminado del listado. Su historial de movimientos se conserva.');}
  catch(error){setFlash(req,'error',error.message);}
  res.redirect('/super/users');
}));

app.post('/super/users', requireRole('superadmin'), asyncRoute(async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const displayName = String(req.body.displayName || '').trim();
  const password = String(req.body.password || '');
  const role = ['player', 'game_admin', 'superadmin'].includes(req.body.role) ? req.body.role : 'player';
  if (!/^[a-z0-9._-]{3,40}$/.test(username) || !displayName || password.length < 6) {
    setFlash(req, 'error', 'Revisa los datos: usuario de 3 a 40 caracteres y clave de al menos 6 caracteres.');
    return res.redirect('/super/users');
  }
  const settings = await getSettings();
  const startingBalance = role === 'player' ? settings.initial_balance : 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const hash = await bcrypt.hash(password, 12);
    const result = await client.query(
      `INSERT INTO users (username, display_name, password_hash, role, balance)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [username, displayName, hash, role, startingBalance]
    );
    if (startingBalance > 0) {
      await client.query(
        `INSERT INTO transactions (user_id, amount, balance_before, balance_after, type, note, created_by)
         VALUES ($1, $2, 0, $2, 'adjustment', 'Saldo inicial', $3)`,
        [result.rows[0].id, startingBalance, req.session.user.id]
      );
    }
    await client.query('COMMIT');
    setFlash(req, 'success', `Cuenta ${username} creada.`);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') setFlash(req, 'error', 'Ese nombre de usuario ya existe.');
    else throw error;
  } finally {
    client.release();
  }
  res.redirect('/super/users');
}));

app.post('/super/users/generate', requireRole('superadmin'), asyncRoute(async (req, res) => {
  const prefix = String(req.body.prefix || 'jugador').trim().toLowerCase();
  const namePrefix = String(req.body.namePrefix || 'Participante').trim();
  const count = Number(req.body.count);
  const start = Number(req.body.start || 1);
  if (!/^[a-z][a-z0-9_-]{1,20}$/.test(prefix) || !namePrefix || !Number.isSafeInteger(count) || count < 1 || count > 200 || !Number.isSafeInteger(start) || start < 1) {
    setFlash(req, 'error', 'Para generar el lote, usa un prefijo válido y una cantidad entre 1 y 200.');
    return res.redirect('/super/users');
  }

  const settings = await getSettings();
  const client = await pool.connect();
  const created = [];
  try {
    await client.query('BEGIN');
    for (let index = 0; index < count; index += 1) {
      const number = start + index;
      const username = `${prefix}${String(number).padStart(3, '0')}`;
      const password = String(crypto.randomInt(100000, 1000000));
      const hash = await bcrypt.hash(password, 10);
      const userResult = await client.query(
        `INSERT INTO users (username, display_name, password_hash, role, balance, must_change_password)
         VALUES ($1, $2, $3, 'player', $4, FALSE) RETURNING id`,
        [username, `${namePrefix} ${number}`, hash, settings.initial_balance]
      );
      if (settings.initial_balance > 0) {
        await client.query(
          `INSERT INTO transactions (user_id, amount, balance_before, balance_after, type, note, created_by)
           VALUES ($1, $2, 0, $2, 'adjustment', 'Saldo inicial', $3)`,
          [userResult.rows[0].id, settings.initial_balance, req.session.user.id]
        );
      }
      created.push({ displayName: `${namePrefix} ${number}`, username, password });
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      setFlash(req, 'error', 'El lote coincide con cuentas existentes. Cambia el prefijo o el número inicial.');
      return res.redirect('/super/users');
    }
    throw error;
  } finally {
    client.release();
  }

  const escapeCsv = (value) => `"${String(value).replace(/"/g, '""')}"`;
  const csv = ['Nombre,Usuario,Clave', ...created.map((item) => [item.displayName, item.username, item.password].map(escapeCsv).join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="cuentas-participantes.csv"');
  res.send(`\uFEFF${csv}`);
}));

app.post('/super/users/import', requireRole('superadmin'), asyncRoute(async (req, res) => {
  let names;
  try {
    const mode = String(req.body.givenNames || 'auto');
    if (!['auto', '1', '2'].includes(mode)) throw new Error('Selecciona cómo están escritos los nombres.');
    names = parseNames(req.body.csv || '', mode);
  } catch (error) {
    setFlash(req, 'error', error.message);
    return res.redirect('/super/users');
  }
  const client = await pool.connect();
  const created = [];
  try {
    await client.query('BEGIN');
    // Serializa importaciones concurrentes para asignar sufijos únicos.
    await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
    const existing = await client.query('SELECT username FROM users');
    const used = new Set(existing.rows.map((row) => row.username));
    for (const item of names) {
      let username = item.base, suffix = 2;
      while (used.has(username)) username = `${item.base}${suffix++}`;
      used.add(username);
      const password = crypto.randomBytes(9).toString('base64url');
      const hash = await bcrypt.hash(password, 10);
      const result = await client.query(
        `INSERT INTO users (username, display_name, password_hash, role, balance, must_change_password)
         VALUES ($1, $2, $3, 'player', 10000, TRUE) RETURNING id`, [username, item.displayName, hash]);
      await client.query(
        `INSERT INTO transactions (user_id, amount, balance_before, balance_after, type, note, created_by)
         VALUES ($1, 10000, 0, 10000, 'adjustment', 'Saldo inicial', $2)`, [result.rows[0].id, req.session.user.id]);
      created.push([item.displayName, username, password]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
  const escapeCsv = (value) => `"${String(value).replace(/"/g, '""')}"`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Disposition', 'attachment; filename="accesos-participantes.csv"');
  res.send('\uFEFF' + ['Nombre,Usuario,Clave', ...created.map((row) => row.map(escapeCsv).join(','))].join('\r\n'));
}));

app.post('/super/users/:id/role', requireRole('superadmin'), asyncRoute(async (req, res) => {
  const userId = Number(req.params.id);
  const role = String(req.body.role || '');
  const allowedRoles = ['player', 'game_admin', 'superadmin'];

  if (!Number.isSafeInteger(userId) || !allowedRoles.includes(role)) {
    setFlash(req, 'error', 'El rol seleccionado no es válido.');
    return res.redirect('/super/users');
  }
  if (userId === req.session.user.id) {
    setFlash(req, 'error', 'No puedes cambiar el rol de tu propia cuenta mientras estás usando la administración.');
    return res.redirect('/super/users');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT role FROM users WHERE id = $1 AND archived_at IS NULL FOR UPDATE', [userId]);
    if (!current.rowCount) {
      await client.query('ROLLBACK');
      setFlash(req, 'error', 'La cuenta seleccionada no existe.');
      return res.redirect('/super/users');
    }

    await client.query('UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2', [role, userId]);
    if (role !== 'game_admin') {
      await client.query('DELETE FROM game_admins WHERE user_id = $1', [userId]);
    }
    await client.query('COMMIT');
    setFlash(req, 'success', 'Rol de la cuenta actualizado.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return res.redirect('/super/users');
}));

app.post('/super/users/:id/toggle', requireRole('superadmin'), asyncRoute(async (req, res) => {
  if (Number(req.params.id) === req.session.user.id) {
    setFlash(req, 'error', 'No puedes desactivar tu propia cuenta.');
  } else {
    await pool.query('UPDATE users SET active = NOT active, updated_at = NOW() WHERE id = $1 AND archived_at IS NULL', [req.params.id]);
    setFlash(req, 'success', 'Estado de la cuenta actualizado.');
  }
  res.redirect('/super/users');
}));

app.post('/super/users/:id/reset-password', requireRole('superadmin'), asyncRoute(async (req, res) => {
  const password = String(req.body.password || '');
  if (password.length < 6) {
    setFlash(req, 'error', 'La nueva clave debe tener al menos 6 caracteres.');
  } else {
    const hash = await bcrypt.hash(password, 12);
    await pool.query('UPDATE users SET password_hash = $1, must_change_password = TRUE, updated_at = NOW() WHERE id = $2', [hash, req.params.id]);
    setFlash(req, 'success', 'Clave restablecida.');
  }
  res.redirect('/super/users');
}));

app.post('/super/users/:id/adjust', requireRole('superadmin'), asyncRoute(async (req, res) => {
  try {
    await applyTransaction({
      userId: req.params.id, rawAmount: req.body.amount, createdBy: req.session.user.id,
      type: 'adjustment', note: req.body.note || 'Ajuste administrativo'
    });
    setFlash(req, 'success', 'Saldo ajustado.');
  } catch (error) {
    setFlash(req, 'error', error.message);
  }
  res.redirect('/super/users');
}));

app.post('/super/games',requireRole('superadmin'),asyncRoute(async(req,res)=>{
  try {
    await createGame({name:req.body.name,slug:slugify(req.body.slug||req.body.name||''),description:req.body.description,minAmount:req.body.minAmount,maxAmount:req.body.maxAmount,maxPlayers:req.body.maxPlayers,adminIds:req.body.adminIds});
    setFlash(req,'success','Juego creado con $30.000 de caja inicial y sus encargados asignados.');
  }catch(error){setFlash(req,'error',error.message);}
  res.redirect('/super');
}));

app.post('/super/games/:id/bet-options', requireRole('superadmin'), asyncRoute(async (req, res) => {
  try {
    const options = parseOptions(req.body.options);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const gameResult = await client.query('SELECT * FROM games WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!gameResult.rowCount || !betOptions(gameResult.rows[0]).length) throw new Error('Bingo y ruleta se configuran por separado.');
      const active = await client.query("SELECT id FROM join_requests WHERE game_id = $1 AND (status = 'playing' OR (status = 'pending' AND expires_at > NOW())) LIMIT 1", [req.params.id]);
      if (active.rowCount) throw new Error('Espera a que terminen las participaciones activas antes de cambiar las opciones.');
      await client.query('UPDATE games SET bet_options = $1::jsonb WHERE id = $2', [JSON.stringify(options), req.params.id]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    setFlash(req, 'success', 'Botonera de apuestas actualizada.');
  } catch (error) { setFlash(req, 'error', error.message); }
  res.redirect('/super');
}));

app.post('/super/games/:id/toggle', requireRole('superadmin'), asyncRoute(async (req, res) => {
  await pool.query('UPDATE games SET active = NOT active WHERE id = $1', [req.params.id]);
  setFlash(req, 'success', 'Estado del juego actualizado.');
  res.redirect('/super');
}));

app.post('/super/games/:id/capacity', requireRole('superadmin'), asyncRoute(async (req, res) => {
  const maxPlayers = Number(req.body.maxPlayers);
  if (!Number.isSafeInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 10) {
    setFlash(req, 'error', 'La capacidad debe estar entre 1 y 10 participantes.');
  } else {
    await pool.query('UPDATE games SET max_players = $1 WHERE id = $2', [maxPlayers, req.params.id]);
    setFlash(req, 'success', 'Capacidad del juego actualizada.');
  }
  res.redirect('/super');
}));

app.post('/super/assignments',requireRole('superadmin'),asyncRoute(async(req,res)=>{
  const result=await pool.query(`INSERT INTO game_admins(user_id,game_id)
    SELECT u.id,g.id FROM users u CROSS JOIN games g WHERE u.id=$1 AND g.id=$2
    AND u.role='game_admin' AND u.active=TRUE AND u.archived_at IS NULL ON CONFLICT DO NOTHING`,[req.body.userId,req.body.gameId]);
  setFlash(req,result.rowCount?'success':'error',result.rowCount?'Encargado asignado.':'Selecciona un encargado activo y un juego válido; la asignación puede existir ya.');
  res.redirect('/super');
}));

app.post('/super/assignments/remove', requireRole('superadmin'), asyncRoute(async (req, res) => {
  await pool.query('DELETE FROM game_admins WHERE user_id = $1 AND game_id = $2', [req.body.userId, req.body.gameId]);
  setFlash(req, 'success', 'Asignación eliminada.');
  res.redirect('/super');
}));

app.post('/super/transactions/:id/reverse', requireRole('superadmin'), asyncRoute(async (req, res) => {
  try {
    await reverseTransaction({ transactionId: req.params.id, createdBy: req.session.user.id });
    setFlash(req, 'success', 'Transacción revertida.');
  } catch (error) {
    setFlash(req, 'error', error.message);
  }
  res.redirect('/super#movimientos');
}));

app.post('/super/settings', requireRole('superadmin'), asyncRoute(async (req, res) => {
  const initialBalance = Number(req.body.initialBalance);
  if (!Number.isSafeInteger(initialBalance) || initialBalance < 0) {
    setFlash(req, 'error', 'El saldo inicial debe ser un entero mayor o igual que cero.');
  } else {
    await pool.query(
      `UPDATE app_settings SET event_name = $1, currency_name = $2, initial_balance = $3,
       allow_negative = $4, updated_at = NOW() WHERE id = 1`,
      [String(req.body.eventName || 'Casino Escolar').trim().slice(0, 80),
        String(req.body.currencyName || 'fichas').trim().slice(0, 30), initialBalance,
        req.body.allowNegative === 'on']
    );
    setFlash(req, 'success', 'Configuración guardada.');
  }
  res.redirect('/super#configuracion');
}));

app.get('/super/qrs', requireRole('superadmin'), asyncRoute(async (req, res) => {
  const [games, settings] = await Promise.all([
    pool.query('SELECT * FROM games ORDER BY active DESC, name'), getSettings()
  ]);
  res.render('qr-sheet', { title: 'Códigos QR', games: games.rows, settings });
}));

app.get('/qr/:id.png', requireLogin, asyncRoute(async (req, res) => {
  const result = await pool.query('SELECT slug FROM games WHERE id = $1', [req.params.id]);
  if (!result.rowCount) return res.sendStatus(404);
  const baseUrl = publicBaseUrl(req);
  const png = await QRCode.toBuffer(`${baseUrl}/game/${result.rows[0].slug}`, { width: 600, margin: 2, errorCorrectionLevel: 'H' });
  res.type('png').send(png);
}));

app.use((req, res) => res.status(404).render('error', { title: 'Página no encontrada', message: 'La dirección solicitada no existe.' }));

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).render('error', {
    title: 'No se pudo completar la operación',
    message: isProduction ? 'Intenta nuevamente. Si el problema continúa, avisa a la administración.' : error.message
  });
});

initializeDatabase()
  .then(() => app.listen(port, () => {
    console.log(`Casino Escolar disponible en http://localhost:${port}`);
    console.log(`Desde otros equipos de la red: http://${findLocalAddress()}:${port}`);
  }))
  .catch((error) => {
    console.error('No se pudo iniciar la aplicación:', error);
    process.exit(1);
  });

module.exports = app;
