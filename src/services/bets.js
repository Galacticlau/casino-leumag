const { pool } = require('../db');
function isGoldenKey(game) {
  return /(?:^|\s|-)llave(?:\s|-)magica(?:$|\s|-)/.test(`${game.name || ''} ${game.slug || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
}
function isBingo(game) { return /bingo/i.test(`${game.name || ''} ${game.slug || ''}`); }
function betOptions(game) {
  if (isBingo(game)) return ['Participar'];
  if (isGoldenKey(game)) return ['Participar'];
  const name = `${game.name || ''} ${game.slug || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/ruleta/.test(name)) return [];
  let options = game.bet_options;
  if (typeof options === 'string') {
    try { options = JSON.parse(options); } catch { options = null; }
  }
  if (!Array.isArray(options)) return ['Participar'];
  const normalized = [...new Set(options.filter(option => typeof option === 'string').map(option => option.trim()).filter(option => option && option.length <= 60))].slice(0, 12);
  return normalized.length ? normalized : ['Participar'];
}
function parseOptions(text) {
  const options = String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!options.length || options.length > 12 || options.some((s) => s.length > 60) || new Set(options.map(s => s.toLowerCase())).size !== options.length) {
    throw new Error('Escribe entre 1 y 12 opciones distintas, una por línea, de hasta 60 caracteres.');
  }
  return options;
}
function validateBet(game, amount, option, balance) {
  const options = betOptions(game);
  if (!options.length) return { amount: null, option: null };
  const stake = Number(amount);
  if (isGoldenKey(game) && stake !== 1000) throw new Error('La llave mágica tiene una apuesta fija de $1.000.');
  if (!Number.isSafeInteger(stake) || (!isGoldenKey(game) && (stake < Number(game.min_amount) || stake > Number(game.max_amount)))) throw new Error('Selecciona un monto de apuesta dentro del rango del juego.');
  if (stake > Number(balance)) throw new Error('No tienes saldo suficiente para esa apuesta.');
  if (!options.includes(option)) throw new Error('Selecciona una de las opciones de este juego.');
  return { amount: stake, option };
}
async function joinGame({ slug, userId, amount, option }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const gameResult = await client.query('SELECT * FROM games WHERE slug = $1 AND active = TRUE FOR SHARE', [slug]);
    const game = gameResult.rows[0];
    if (!game) throw new Error('El juego no está disponible.');
    const userResult = await client.query('SELECT balance, active FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const user = userResult.rows[0];
    if (!user?.active) throw new Error('La cuenta no está activa.');
    await client.query("UPDATE join_requests SET status = 'expired' WHERE user_id = $1 AND status = 'pending' AND expires_at <= NOW()", [userId]);
    const existing = await client.query("SELECT id, game_id FROM join_requests WHERE user_id = $1 AND status IN ('pending', 'playing')", [userId]);
    if (existing.rowCount) {
      const request = existing.rows[0];
      if (Number(request.game_id) !== Number(game.id)) throw new Error('Ya tienes una participación activa en otro juego.');
      await client.query('COMMIT');
      return request.id;
    }
    const bet = validateBet(game, amount, String(option || ''), user.balance);
    const result = await client.query(
      'INSERT INTO join_requests (user_id, game_id, bet_amount, bet_option) VALUES ($1, $2, $3, $4) RETURNING id',
      [userId, game.id, bet.amount, bet.option]);
    await client.query('COMMIT');
    return result.rows[0].id;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
module.exports = { isBingo, isGoldenKey, betOptions, parseOptions, validateBet, joinGame };
