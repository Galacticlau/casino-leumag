const test = require('node:test');
const assert = require('node:assert/strict');
const { parseNames } = require('../src/public/csv-users');
test('CSV de Excel con BOM, punto y coma y tildes', () => {
  assert.deepEqual(parseNames('\uFEFFNombres;Apellidos\r\nMaría José;Pérez González'), [{ displayName: 'María José Pérez González', base: 'maria.perez' }]);
});
test('nombres completos y elección de primer apellido', () => {
  assert.equal(parseNames('Nombre completo\nAna María Pérez González')[0].base, 'ana.perez');
  assert.equal(parseNames('Ana María Pérez', '2')[0].base, 'ana.perez');
  assert.equal(parseNames('Nombres,Primer apellido\nAna,De la Cruz')[0].base, 'ana.delacruz');
});
test('rechaza filas incompletas, fórmulas, comillas sin cerrar y lotes excesivos', () => {
  for (const text of ['Ana', '"Ana Pérez', '=SUM(A1) Pérez', Array(201).fill('Ana Pérez').join('\n')]) assert.throws(() => parseNames(text));
});
