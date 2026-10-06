(function (root) {
  function parseNames(text, givenNames = 'auto') {
    text = String(text).replace(/^\uFEFF/, '');
    if (text.length > 100000) throw new Error('El CSV supera el tamaño permitido (100 KB).');
    const delimiter = text.split(/\r?\n/)[0].includes(';') ? ';' : ',';
    const rows = []; let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
        else if (quoted || !cell) quoted = !quoted;
        else throw new Error('Comillas inválidas en el CSV.');
      } else if (!quoted && (c === delimiter || c === '\n' || c === '\r')) {
        row.push(cell.trim()); cell = '';
        if (c !== delimiter) { if (row.some(Boolean)) rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
      } else cell += c;
    }
    if (quoted) throw new Error('Hay comillas sin cerrar en el CSV.');
    row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
    const normalize = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const headers = (rows[0] || []).map((s) => normalize(s).replace(/[_ ]/g, ''));
    const full = headers.findIndex((s) => ['nombrecompleto', 'nombre', 'nombres'].includes(s));
    const explicitSurname = headers.indexOf('primerapellido');
    const surname = explicitSurname >= 0 ? explicitSurname : headers.findIndex((s) => ['apellido', 'apellidos'].includes(s));
    const hasHeader = full >= 0;
    const data = hasHeader ? rows.slice(1) : rows;
    if (!data.length || data.length > 200) throw new Error('Carga entre 1 y 200 personas.');
    return data.map((fields, i) => {
      const name = fields[hasHeader ? full : 0] || '';
      const parts = name.trim().split(/\s+/);
      const offset = givenNames === 'auto' ? (parts.length >= 4 ? 2 : 1) : Number(givenNames);
      const lastName = surname >= 0 ? (explicitSurname >= 0 ? fields[surname] : (fields[surname] || '').split(/\s+/)[0]) : parts[offset];
      const displayName = surname >= 0 ? `${name} ${fields[surname] || ''}`.trim() : name;
      if (!lastName || !name || displayName.length > 80 || !/^[\p{L}\p{M} '\-]+$/u.test(displayName)) throw new Error(`Revisa el nombre de la fila ${i + 1}: debe incluir nombre y apellido, hasta 80 caracteres.`);
      const clean = (s) => normalize(s).replace(/[^a-z]/g, '');
      const base = `${clean(parts[0]).slice(0, 18)}.${clean(lastName).slice(0, 18)}`;
      if (!/^[a-z]+\.[a-z]+$/.test(base)) throw new Error(`Nombre no válido en la fila ${i + 1}.`);
      return { displayName, base };
    });
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { parseNames };
  else root.CasinoCSV = { parseNames };
})(typeof window !== 'undefined' ? window : globalThis);
