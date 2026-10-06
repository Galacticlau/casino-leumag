(() => {
  const form = document.querySelector('#csv-import');
  if (!form) return;
  const file = form.querySelector('[type=file]');
  const content = form.querySelector('[name=csv]');
  const mode = form.querySelector('[name=givenNames]');
  const preview = document.querySelector('#csv-preview');
  const submit = form.querySelector('[type=submit]');
  let version = 0;
  async function refresh() {
    const current = ++version;
    submit.disabled = true; content.value = ''; preview.replaceChildren();
    if (!file.files.length) return;
    try {
      if (file.files[0].size > 100000) throw new Error('El archivo debe pesar menos de 100 KB.');
      const text = await file.files[0].text();
      if (current !== version) return;
      const names = window.CasinoCSV.parseNames(text, mode.value);
      const summary = document.createElement('p'); summary.textContent = `${names.length} participantes · $10.000 iniciales por cuenta`; preview.append(summary);
      names.forEach((item) => {
        const line = document.createElement('div'); line.className = 'csv-preview-row';
        const name = document.createElement('span'); name.textContent = item.displayName;
        const username = document.createElement('code'); username.textContent = item.base;
        line.append(name, username); preview.append(line);
      });
      content.value = text; submit.disabled = false;
    } catch (error) { if (current === version) preview.textContent = error.message; }
  }
  file.addEventListener('change', refresh); mode.addEventListener('change', refresh);
  form.addEventListener('submit', () => { submit.disabled = true; submit.textContent = 'Creando cuentas…'; setTimeout(() => { submit.disabled = false; submit.textContent = 'Crear cuentas y descargar claves'; }, 15000); });
})();
