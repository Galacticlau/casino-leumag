(() => {
  const app = document.querySelector('#queue-app');
  if (!app) return;
  const gameId = app.dataset.gameId;
  const minimum = Number(app.dataset.min);
  const maximum = Number(app.dataset.max);
  const csrf = app.dataset.csrf;
  const currency = app.dataset.currency;
  let lastSignature = '';

  const format = (value) => new Intl.NumberFormat('es-CL').format(Number(value));

  function hidden(name, value) {
    const input = document.createElement('input');
    input.type = 'hidden'; input.name = name; input.value = value;
    return input;
  }

  function makeButton(label, value, input) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'quick-amount'; button.textContent = label;
    button.addEventListener('click', () => { input.value = value; input.focus(); });
    return button;
  }

  function render(requests) {
    app.replaceChildren();
    if (!requests.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state waiting-empty';
      const title = document.createElement('strong'); title.textContent = 'No hay participantes esperando';
      const text = document.createElement('span'); text.textContent = 'Cuando alguien escanee el QR aparecerá automáticamente aquí.';
      empty.append(title, text); app.append(empty); return;
    }

    const grid = document.createElement('div'); grid.className = 'queue-grid';
    requests.forEach((item, index) => {
      const card = document.createElement('article'); card.className = 'queue-card';
      const head = document.createElement('div'); head.className = 'queue-head';
      const number = document.createElement('span'); number.className = 'queue-number'; number.textContent = String(index + 1);
      const identity = document.createElement('div');
      const name = document.createElement('h2'); name.textContent = item.display_name;
      const username = document.createElement('small'); username.textContent = `@${item.username}`;
      identity.append(name, username);
      const balance = document.createElement('div'); balance.className = 'queue-balance';
      const balanceLabel = document.createElement('span'); balanceLabel.textContent = 'Saldo';
      const balanceValue = document.createElement('strong'); balanceValue.textContent = format(item.balance);
      balance.append(balanceLabel, balanceValue);
      head.append(number, identity, balance);

      const form = document.createElement('form'); form.method = 'post'; form.action = `/admin/game/${gameId}/result`; form.className = 'result-form';
      form.append(hidden('_csrf', csrf), hidden('requestId', item.id), hidden('userId', item.user_id));
      const amountLabel = document.createElement('label'); amountLabel.textContent = `Cantidad de ${currency}`;
      const amount = document.createElement('input'); amount.type = 'number'; amount.name = 'amount'; amount.required = true;
      amount.min = minimum; amount.max = maximum; amount.value = minimum; amount.inputMode = 'numeric';
      amountLabel.append(amount);
      const quick = document.createElement('div'); quick.className = 'quick-row';
      const presets = [...new Set([minimum, Math.min(maximum, minimum * 2), Math.min(maximum, minimum * 5), maximum])].sort((a, b) => a - b);
      presets.forEach((value) => quick.append(makeButton(format(value), value, amount)));
      const actions = document.createElement('div'); actions.className = 'result-actions';
      const loss = document.createElement('button'); loss.type = 'submit'; loss.name = 'outcome'; loss.value = 'loss'; loss.className = 'button button-loss'; loss.textContent = 'Perdió';
      const win = document.createElement('button'); win.type = 'submit'; win.name = 'outcome'; win.value = 'win'; win.className = 'button button-win'; win.textContent = 'Ganó';
      actions.append(loss, win); form.append(amountLabel, quick, actions);
      form.addEventListener('submit', () => { loss.disabled = true; win.disabled = true; });
      card.append(head, form); grid.append(card);
    });
    app.append(grid);
  }

  async function refresh() {
    try {
      const response = await fetch(`/api/admin/game/${gameId}/queue`, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('No se pudo actualizar');
      const data = await response.json();
      const signature = JSON.stringify(data.requests.map((item) => [item.id, item.balance]));
      if (signature !== lastSignature) { lastSignature = signature; render(data.requests); }
    } catch (error) {
      if (!app.querySelector('.queue-card')) app.innerHTML = '<div class="notice">No fue posible actualizar la fila. Revisa la conexión.</div>';
    }
  }

  refresh();
  window.setInterval(refresh, 3000);
})();
