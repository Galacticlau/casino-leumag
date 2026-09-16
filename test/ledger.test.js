const test = require('node:test');
const assert = require('node:assert/strict');
const { validateAmount } = require('../src/services/ledger');

test('acepta montos enteros dentro del rango', () => {
  assert.equal(validateAmount('50', 10, 500), 50);
  assert.equal(validateAmount('-500', 10, 500), -500);
});

test('rechaza cero, decimales y texto', () => {
  assert.throws(() => validateAmount(0), /distinto de cero/);
  assert.throws(() => validateAmount(10.5), /entero/);
  assert.throws(() => validateAmount('hola'), /entero/);
});

test('rechaza montos fuera del rango del juego', () => {
  assert.throws(() => validateAmount(5, 10, 500), /entre 10 y 500/);
  assert.throws(() => validateAmount(-501, 10, 500), /entre 10 y 500/);
});
