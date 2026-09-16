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
const EmbeddedSessionStore = require('./session-store');

const app = express();
const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';
const usesHttps = String(process.env.PUBLIC_URL || '').startsWith('https://');

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
  const configured = String(process.env.PUBLIC_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
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
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.json({ limit: '20kb' }));
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

app.get('/game/:slug', requireRole('player'), asyncRoute(async (req, res) => {
  const gameResult = await pool.query('SELECT * FROM games WHERE slug = $1 AND active = TRUE', [req.params.slug]);
  if (!gameResult.rowCount) return res.status(404).render('error', { title: 'Juego no disponible', message: 'El QR no corresponde a un juego activo.' });
  const [userResult, settings] = await Promise.all([
    pool.query('SELECT balance FROM users WHERE id = $1', [req.session.user.id]),
    getSettings()
  ]);
  res.render('game', { title: gameResult.rows[0].name, game: gameResult.rows[0], balance: userResult.rows[0].balance, settings });
}));

app.post('/game/:slug/join', requireRole('player'), asyncRoute(async (req, res) => {
  const gameResult = await pool.query('SELECT id FROM games WHERE slug = $1 AND active = TRUE', [req.params.slug]);
  if (!gameResult.rowCount) throw new Error('El juego no está disponible.');
  const gameId = gameResult.rows[0].id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE join_requests SET status = 'expired'
       WHERE user_id = $1 AND status = 'pending' AND expires_at <= NOW()`,
      [req.session.user.id]
    );
    const existing = await client.query(
      `SELECT r.id, r.game_id, r.status, g.name AS game_name
       FROM join_requests r JOIN games g ON g.id = r.game_id
       WHERE r.user_id = $1 AND r.status IN ('pending', 'playing')
       FOR UPDATE OF r`,
      [req.session.user.id]
    );
    if (existing.rowCount) {
      const request = existing.rows[0];
      if (Number(request.game_id) === Number(gameId) && request.status === 'pending') {
        await client.query(
          `UPDATE join_requests SET expires_at = NOW() + INTERVAL '15 minutes' WHERE id = $1`,
          [request.id]
        );
      } else if (Number(request.game_id) !== Number(gameId)) {
        setFlash(req, 'error', `Ya estás participando en ${request.game_name}. Finaliza esa participación antes de entrar a otro juego.`);
      }
      await client.query('COMMIT');
      return res.redirect(`/player/wait/${request.id}`);
    }
    const requestResult = await client.query(
      'INSERT INTO join_requests (user_id, game_id) VALUES ($1, $2) RETURNING id',
      [req.session.user.id, gameId]
    );
    await client.query('COMMIT');
    return res.redirect(`/player/wait/${requestResult.rows[0].id}`);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      const existing = await pool.query(
        `SELECT id FROM join_requests
         WHERE user_id = $1 AND status IN ('pending', 'playing') LIMIT 1`,
        [req.session.user.id]
      );
      if (existing.rowCount) return res.redirect(`/player/wait/${existing.rows[0].id}`);
    }
    throw error;
  } finally {
    client.release();
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
  const query = req.session.user.role === 'superadmin'
    ? `SELECT g.*, COUNT(r.id) FILTER (WHERE r.status = 'pending' AND r.expires_at > NOW())::int AS pending_count,
       COUNT(r.id) FILTER (WHERE r.status = 'playing')::int AS playing_count
       FROM games g LEFT JOIN join_requests r ON r.game_id = g.id GROUP BY g.id ORDER BY g.name`
    : `SELECT g.*, COUNT(r.id) FILTER (WHERE r.status = 'pending' AND r.expires_at > NOW())::int AS pending_count,
       COUNT(r.id) FILTER (WHERE r.status = 'playing')::int AS playing_count
       FROM games g JOIN game_admins ga ON ga.game_id = g.id
       LEFT JOIN join_requests r ON r.game_id = g.id
       WHERE ga.user_id = $1 GROUP BY g.id ORDER BY g.name`;
  const games = await pool.query(query, req.session.user.role === 'superadmin' ? [] : [req.session.user.id]);
  res.render('admin-index', { title: 'Mis juegos', games: games.rows });
}));

app.get('/admin/game/:id', requireRole('game_admin', 'superadmin'), asyncRoute(async (req, res) => {
  if (!(await canManageGame(req.session.user, req.params.id))) return res.status(403).render('error', { title: 'Acceso restringido', message: 'Este juego no está asignado a tu cuenta.' });
  const gameResult = await pool.query('SELECT * FROM games WHERE id = $1', [req.params.id]);
  if (!gameResult.rowCount) return res.status(404).render('error', { title: 'Juego no encontrado', message: 'El juego solicitado no existe.' });
  const settings = await getSettings();
  res.render('admin-game', { title: gameResult.rows[0].name, game: gameResult.rows[0], settings });
}));

app.get('/api/admin/game/:id/queue', requireRole('game_admin', 'superadmin'), asyncRoute(async (req, res) => {
  if (!(await canManageGame(req.session.user, req.params.id))) return res.status(403).json({ error: 'Sin permiso' });
  await pool.query(`UPDATE join_requests SET status = 'expired' WHERE game_id = $1 AND status = 'pending' AND expires_at <= NOW()`, [req.params.id]);
  const [queueResult, roundResult] = await Promise.all([
    pool.query(
      `SELECT r.id, r.created_at, r.expires_at, u.id AS user_id, u.display_name, u.username, u.balance
       FROM join_requests r JOIN users u ON u.id = r.user_id
       WHERE r.game_id = $1 AND r.status = 'pending' AND r.expires_at > NOW()
       ORDER BY r.created_at ASC`,
      [req.params.id]
    ),
    pool.query(
      `SELECT gr.id, gr.created_at, r.id AS request_id, u.id AS user_id,
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
        balance: row.balance
      }))
    };
  }
  res.json({ requests: queueResult.rows, activeRound });
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
  const [users, games, assignments, transactions, settings, totals] = await Promise.all([
    pool.query(`SELECT id, username, display_name, role, balance, active, must_change_password FROM users ORDER BY role, display_name`),
    pool.query(`SELECT g.*, COUNT(ga.user_id)::int AS admin_count FROM games g LEFT JOIN game_admins ga ON ga.game_id = g.id GROUP BY g.id ORDER BY g.name`),
    pool.query(`SELECT ga.user_id, ga.game_id, u.display_name, g.name AS game_name FROM game_admins ga JOIN users u ON u.id = ga.user_id JOIN games g ON g.id = ga.game_id ORDER BY g.name, u.display_name`),
    pool.query(`SELECT t.*, p.display_name AS player_name, a.display_name AS admin_name, g.name AS game_name,
       EXISTS(SELECT 1 FROM transactions r WHERE r.reversal_of = t.id) AS reversed
       FROM transactions t JOIN users p ON p.id = t.user_id JOIN users a ON a.id = t.created_by
       LEFT JOIN games g ON g.id = t.game_id ORDER BY t.created_at DESC LIMIT 60`),
    getSettings(),
    pool.query(`SELECT COUNT(*) FILTER (WHERE role = 'player')::int AS players,
       COALESCE(SUM(balance) FILTER (WHERE role = 'player'), 0)::int AS circulating,
       (SELECT COUNT(*)::int FROM transactions) AS transaction_count FROM users`)
  ]);
  res.render('super', {
    title: 'Administración general', users: users.rows, games: games.rows,
    assignments: assignments.rows, transactions: transactions.rows,
    settings, totals: totals.rows[0]
  });
}));

app.post('/super/users', requireRole('superadmin'), asyncRoute(async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const displayName = String(req.body.displayName || '').trim();
  const password = String(req.body.password || '');
  const role = ['player', 'game_admin', 'superadmin'].includes(req.body.role) ? req.body.role : 'player';
  if (!/^[a-z0-9._-]{3,40}$/.test(username) || !displayName || password.length < 6) {
    setFlash(req, 'error', 'Revisa los datos: usuario de 3 a 40 caracteres y clave de al menos 6 caracteres.');
    return res.redirect('/super#usuarios');
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
  res.redirect('/super#usuarios');
}));

app.post('/super/users/generate', requireRole('superadmin'), asyncRoute(async (req, res) => {
  const prefix = String(req.body.prefix || 'jugador').trim().toLowerCase();
  const namePrefix = String(req.body.namePrefix || 'Participante').trim();
  const count = Number(req.body.count);
  const start = Number(req.body.start || 1);
  if (!/^[a-z][a-z0-9_-]{1,20}$/.test(prefix) || !namePrefix || !Number.isSafeInteger(count) || count < 1 || count > 200 || !Number.isSafeInteger(start) || start < 1) {
    setFlash(req, 'error', 'Para generar el lote, usa un prefijo válido y una cantidad entre 1 y 200.');
    return res.redirect('/super#usuarios');
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
      return res.redirect('/super#usuarios');
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

app.post('/super/users/:id/toggle', requireRole('superadmin'), asyncRoute(async (req, res) => {
  if (Number(req.params.id) === req.session.user.id) {
    setFlash(req, 'error', 'No puedes desactivar tu propia cuenta.');
  } else {
    await pool.query('UPDATE users SET active = NOT active, updated_at = NOW() WHERE id = $1', [req.params.id]);
    setFlash(req, 'success', 'Estado de la cuenta actualizado.');
  }
  res.redirect('/super#usuarios');
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
  res.redirect('/super#usuarios');
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
  res.redirect('/super#usuarios');
}));

app.post('/super/games', requireRole('superadmin'), asyncRoute(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const slug = slugify(req.body.slug || name);
  const minAmount = Number(req.body.minAmount);
  const maxAmount = Number(req.body.maxAmount);
  const maxPlayers = Number(req.body.maxPlayers || 1);
  if (!name || !slug || !Number.isSafeInteger(minAmount) || !Number.isSafeInteger(maxAmount)
    || minAmount <= 0 || maxAmount < minAmount || !Number.isSafeInteger(maxPlayers)
    || maxPlayers < 1 || maxPlayers > 10) {
    setFlash(req, 'error', 'Revisa el nombre, los montos y la capacidad de 1 a 10 participantes.');
    return res.redirect('/super#juegos');
  }
  try {
    await pool.query(
      `INSERT INTO games (name, slug, description, min_amount, max_amount, max_players)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [name, slug, String(req.body.description || '').trim(), minAmount, maxAmount, maxPlayers]
    );
    setFlash(req, 'success', 'Juego creado.');
  } catch (error) {
    if (error.code === '23505') setFlash(req, 'error', 'Ya existe un juego con ese enlace.');
    else throw error;
  }
  res.redirect('/super#juegos');
}));

app.post('/super/games/:id/toggle', requireRole('superadmin'), asyncRoute(async (req, res) => {
  await pool.query('UPDATE games SET active = NOT active WHERE id = $1', [req.params.id]);
  setFlash(req, 'success', 'Estado del juego actualizado.');
  res.redirect('/super#juegos');
}));

app.post('/super/games/:id/capacity', requireRole('superadmin'), asyncRoute(async (req, res) => {
  const maxPlayers = Number(req.body.maxPlayers);
  if (!Number.isSafeInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 10) {
    setFlash(req, 'error', 'La capacidad debe estar entre 1 y 10 participantes.');
  } else {
    await pool.query('UPDATE games SET max_players = $1 WHERE id = $2', [maxPlayers, req.params.id]);
    setFlash(req, 'success', 'Capacidad del juego actualizada.');
  }
  res.redirect('/super#juegos');
}));

app.post('/super/assignments', requireRole('superadmin'), asyncRoute(async (req, res) => {
  await pool.query(
    `INSERT INTO game_admins (user_id, game_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [req.body.userId, req.body.gameId]
  );
  setFlash(req, 'success', 'Encargado asignado.');
  res.redirect('/super#juegos');
}));

app.post('/super/assignments/remove', requireRole('superadmin'), asyncRoute(async (req, res) => {
  await pool.query('DELETE FROM game_admins WHERE user_id = $1 AND game_id = $2', [req.body.userId, req.body.gameId]);
  setFlash(req, 'success', 'Asignación eliminada.');
  res.redirect('/super#juegos');
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
    pool.query('SELECT * FROM games WHERE active = TRUE ORDER BY name'), getSettings()
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
