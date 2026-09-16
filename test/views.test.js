const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');

const views = path.join(__dirname, '..', 'src', 'views');
const now = new Date();
const common = {
  title: 'Prueba', csrfToken: 'token', flash: null,
  currentUser: { id: 1, displayName: 'Admin', role: 'superadmin', mustChangePassword: false },
  formatNumber: (value) => String(value), formatDate: () => 'fecha'
};
const settings = { event_name: 'Casino Escolar', currency_name: 'fichas', initial_balance: 1000, allow_negative: false };
const game = { id: 1, name: 'Ruleta', slug: 'ruleta', description: 'Descripción', min_amount: 10, max_amount: 500, active: true, pending_count: 0, admin_count: 1 };
const user = { id: 2, username: 'jugador1', display_name: 'Jugador', role: 'player', balance: 1000, active: true, must_change_password: false };

const cases = [
  ['login.ejs', { settings, currentUser: null }],
  ['password.ejs', {}],
  ['player.ejs', { player: user, transactions: [], settings, currentUser: { ...common.currentUser, role: 'player' } }],
  ['game.ejs', { game, balance: 1000, settings, currentUser: { ...common.currentUser, role: 'player' } }],
  ['wait.ejs', { joinRequest: { id: 1, game_name: 'Ruleta', status: 'pending', balance: 1000 }, settings, currentUser: { ...common.currentUser, role: 'player' } }],
  ['admin-index.ejs', { games: [game], currentUser: { ...common.currentUser, role: 'game_admin' } }],
  ['admin-game.ejs', { game, settings, currentUser: { ...common.currentUser, role: 'game_admin' } }],
  ['qr-sheet.ejs', { games: [game], settings }],
  ['error.ejs', { message: 'Mensaje' }],
  ['super.ejs', {
    users: [user], games: [game], assignments: [], settings,
    transactions: [{ id: 1, created_at: now, player_name: 'Jugador', admin_name: 'Admin', game_name: 'Ruleta', amount: 50, type: 'game_result', reversed: false }],
    totals: { players: 1, circulating: 1000, transaction_count: 1 }
  }]
];

for (const [file, locals] of cases) {
  test(`renderiza ${file}`, async () => {
    const html = await ejs.renderFile(path.join(views, file), { ...common, ...locals });
    assert.match(html, /<!doctype html>/i);
    assert.match(html, /<\/html>/i);
  });
}
