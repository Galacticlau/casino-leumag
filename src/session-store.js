const session = require('express-session');

class EmbeddedSessionStore extends session.Store {
  constructor(pool) {
    super();
    this.pool = pool;
  }

  get(sid, callback) {
    this.pool.query(
      'SELECT sess FROM app_sessions WHERE sid = $1 AND expires_at > NOW()',
      [sid]
    ).then((result) => {
      callback(null, result.rows[0] ? JSON.parse(result.rows[0].sess) : null);
    }).catch(callback);
  }

  set(sid, value, callback = () => {}) {
    const expiresAt = value.cookie?.expires
      ? new Date(value.cookie.expires)
      : new Date(Date.now() + 10 * 60 * 60 * 1000);
    this.pool.query(
      `INSERT INTO app_sessions (sid, sess, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expires_at = EXCLUDED.expires_at`,
      [sid, JSON.stringify(value), expiresAt]
    ).then(() => callback()).catch(callback);
  }

  destroy(sid, callback = () => {}) {
    this.pool.query('DELETE FROM app_sessions WHERE sid = $1', [sid])
      .then(() => callback()).catch(callback);
  }

  touch(sid, value, callback = () => {}) {
    const expiresAt = value.cookie?.expires
      ? new Date(value.cookie.expires)
      : new Date(Date.now() + 10 * 60 * 60 * 1000);
    this.pool.query('UPDATE app_sessions SET expires_at = $1 WHERE sid = $2', [expiresAt, sid])
      .then(() => callback()).catch(callback);
  }
}

module.exports = EmbeddedSessionStore;
