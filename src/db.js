const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');

let database;
let initializationPromise;
let mutexTail = Promise.resolve();
const usesExternalPostgres = Boolean(String(process.env.DATABASE_URL || '').trim());

function normalizeResult(result) {
  const returnedRows = result.rows?.length || 0;
  return {
    ...result,
    rowCount: Number.isInteger(result.rowCount)
      ? result.rowCount
      : returnedRows > 0
        ? returnedRows
        : Number.isInteger(result.affectedRows)
        ? result.affectedRows
        : 0
  };
}

async function acquireLock() {
  const previous = mutexTail;
  let releaseLock;
  mutexTail = new Promise((resolve) => { releaseLock = resolve; });
  await previous;
  return releaseLock;
}

async function ensureDatabase() {
  if (database) return database;
  if (!initializationPromise) {
    initializationPromise = (async () => {
      if (usesExternalPostgres) {
        const { Pool } = require('pg');
        database = new Pool({
          connectionString: process.env.DATABASE_URL,
          ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
          max: Number(process.env.DATABASE_POOL_SIZE || 12),
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 10_000
        });
        return database;
      }
      const { PGlite } = await import('@electric-sql/pglite');
      const configuredDirectory = String(process.env.PGLITE_DATA_DIR || '').trim();
      const dataDirectory = configuredDirectory || path.join(__dirname, '..', 'data', 'casino-db');
      if (dataDirectory !== 'memory://') fs.mkdirSync(path.dirname(dataDirectory), { recursive: true });
      database = await PGlite.create(dataDirectory);
      return database;
    })();
  }
  return initializationPromise;
}

const pool = {
  async query(sql, parameters = []) {
    const db = await ensureDatabase();
    if (usesExternalPostgres) return normalizeResult(await db.query(sql, parameters));
    const releaseLock = await acquireLock();
    try {
      return normalizeResult(await db.query(sql, parameters));
    } finally {
      releaseLock();
    }
  },

  async connect() {
    const db = await ensureDatabase();
    if (usesExternalPostgres) return db.connect();
    const releaseLock = await acquireLock();
    let released = false;
    return {
      query(sql, parameters = []) {
        return db.query(sql, parameters).then(normalizeResult);
      },
      release() {
        if (!released) {
          released = true;
          releaseLock();
        }
      }
    };
  },

  async end() {
    if (!database) return;
    if (usesExternalPostgres) await database.end();
    else await database.close();
  }
};

async function initializeDatabase() {
  const db = await ensureDatabase();
  const schemaPath = path.join(__dirname, '..', 'sql', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  if (usesExternalPostgres) {
    await db.query(schema);
  } else {
    const releaseLock = await acquireLock();
    try {
      await db.exec(schema);
    } finally {
      releaseLock();
    }
  }

  const { rows } = await pool.query('SELECT COUNT(*)::int AS total FROM users');
  if (rows[0].total === 0) {
    if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_PASSWORD) {
      throw new Error('Define ADMIN_PASSWORD antes de iniciar la aplicación en producción.');
    }
    const username = (process.env.ADMIN_USER || 'admin').trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD || 'Admin2026!';
    const displayName = process.env.ADMIN_NAME || 'Administración';
    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query(
      `INSERT INTO users (username, display_name, password_hash, role, balance, must_change_password)
       VALUES ($1, $2, $3, 'superadmin', 0, TRUE)`,
      [username, displayName, passwordHash]
    );
    console.log(`Cuenta administradora inicial creada: ${username}`);
  }
}

async function getSettings() {
  const { rows } = await pool.query('SELECT * FROM app_settings WHERE id = 1');
  return rows[0];
}

module.exports = { pool, initializeDatabase, getSettings, usesExternalPostgres };
