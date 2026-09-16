(() => {
  const app = document.querySelector('#queue-app');
  if (!app) return;
  const gameId = app.dataset.gameId;
  const minimum = Number(app.dataset.min);
  const maximum = Number(app.dataset.max);
  const maxPlayers = Number(app.dataset.maxPlayers);
  const csrf = app.dataset.csrf;
  const currency = app.dataset.currency;
  const activeRoot = document.querySelector('#active-round');
  const queueRoot = document.querySelector('#waiting-queue');
  let lastRoundSignature = '';
  let lastQueueSignature = '';

  const format = (value) => new Intl.NumberFormat('es-CL').format(Number(value));

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function hidden(name, value) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    return input;
  }

  function playerIdentity(item, number) {
    const head = element('div', 'queue-head');
    head.append(element('span', 'queue-number', String(number)));
    const identity = element('div');
    identity.append(element('h2', '', item.display_name), element('small', '', `@${item.username}`));
    const balance = element('div', 'queue-balance');
    balance.append(element('span', '', 'Saldo'), element('strong', '', format(item.balance)));
    head.append(identity, balance);
    return head;
  }

  function outcomeSelect() {
    const select = document.createElement('select');
    select.className = 'round-outcome';
    const win = document.createElement('option');
    win.value = 'win'; win.textContent = 'Ganó';
    const loss = document.createElement('option');
    loss.value = 'loss'; loss.textContent = 'Perdió';
    select.append(win, loss);
    return select;
  }

  function amountInput() {
    const input = document.createElement('input');
    input.className = 'round-amount';
    input.type = 'number';
    input.min = minimum;
    input.max = maximum;
    input.value = minimum;
    input.inputMode = 'numeric';
    input.required = true;
    return input;
  }

  function renderActiveRound(round) {
    activeRoot.replaceChildren();
    if (!round) {
      const empty = element('div', 'empty-state round-empty');
      empty.append(element('strong', '', 'No hay una ronda en juego'), element('span', '', 'Selecciona participantes de la fila para comenzar.'));
      activeRoot.append(empty);
      return;
    }

    const section = element('section', 'panel active-round-panel');
    const heading = element('div', 'section-title');
    const title = element('div');
    title.append(element('span', 'eyebrow', 'Ronda en juego'), element('h2', '', `Ronda #${round.id}`));
    heading.append(title, element('span', 'badge badge-success', `${round.participants.length} participante(s)`));
    section.append(heading);

    const bulk = element('div', 'bulk-result');
    const bulkOutcomeLabel = element('label', '', 'Resultado para todos');
    const bulkOutcome = outcomeSelect();
    bulkOutcomeLabel.append(bulkOutcome);
    const bulkAmountLabel = element('label', '', `Cantidad de ${currency}`);
    const bulkAmount = amountInput();
    bulkAmountLabel.append(bulkAmount);
    const apply = element('button', 'button button-secondary', 'Aplicar a todos');
    apply.type = 'button';
    bulk.append(bulkOutcomeLabel, bulkAmountLabel, apply);
    section.append(bulk);

    const form = document.createElement('form');
    form.method = 'post';
    form.action = `/admin/game/${gameId}/rounds/${round.id}/finish`;
    form.className = 'round-result-form';
    const resultsInput = hidden('results', '[]');
    form.append(hidden('_csrf', csrf), resultsInput);
    const grid = element('div', 'queue-grid active-round-grid');
    round.participants.forEach((item, index) => {
      const card = element('article', 'queue-card round-participant');
      card.dataset.requestId = item.request_id;
      card.append(playerIdentity(item, index + 1));
      const fields = element('div', 'round-fields');
      const outcomeLabel = element('label', '', 'Resultado');
      const outcome = outcomeSelect();
      outcomeLabel.append(outcome);
      const amountLabel = element('label', '', `Cantidad de ${currency}`);
      const amount = amountInput();
      amountLabel.append(amount);
      fields.append(outcomeLabel, amountLabel);
      card.append(fields);
      grid.append(card);
    });
    form.append(grid);
    const actions = element('div', 'round-main-actions');
    const finish = element('button', 'button button-primary button-large', 'Cerrar ronda y registrar resultados');
    finish.type = 'submit';
    actions.append(finish);
    form.append(actions);
    form.addEventListener('submit', () => {
      const results = [...form.querySelectorAll('.round-participant')].map((card) => ({
        requestId: Number(card.dataset.requestId),
        outcome: card.querySelector('.round-outcome').value,
        amount: Number(card.querySelector('.round-amount').value)
      }));
      resultsInput.value = JSON.stringify(results);
      finish.disabled = true;
      finish.textContent = 'Registrando…';
    });
    apply.addEventListener('click', () => {
      form.querySelectorAll('.round-outcome').forEach((field) => { field.value = bulkOutcome.value; });
      form.querySelectorAll('.round-amount').forEach((field) => { field.value = bulkAmount.value; });
    });
    section.append(form);

    const cancelForm = document.createElement('form');
    cancelForm.method = 'post';
    cancelForm.action = `/admin/game/${gameId}/rounds/${round.id}/cancel`;
    cancelForm.className = 'cancel-round-form';
    cancelForm.append(hidden('_csrf', csrf));
    const cancel = element('button', 'button button-danger button-small', 'Cancelar ronda y devolver a la fila');
    cancel.type = 'submit';
    cancelForm.append(cancel);
    cancelForm.addEventListener('submit', (event) => {
      if (!window.confirm('¿Cancelar esta ronda y devolver a sus participantes a la fila?')) event.preventDefault();
    });
    section.append(cancelForm);
    activeRoot.append(section);
  }

  function renderQueue(requests, hasActiveRound) {
    queueRoot.replaceChildren();
    if (!requests.length) {
      const empty = element('div', 'empty-state waiting-empty');
      empty.append(element('strong', '', 'No hay participantes esperando'), element('span', '', 'Cuando alguien escanee el QR aparecerá automáticamente aquí.'));
      queueRoot.append(empty);
      return;
    }

    const form = document.createElement('form');
    form.method = 'post';
    form.action = `/admin/game/${gameId}/rounds/start`;
    form.className = 'start-round-form';
    form.append(hidden('_csrf', csrf));
    const grid = element('div', 'queue-grid');
    const selectedCount = element('strong', 'selection-count');
    const start = element('button', 'button button-primary button-large', 'Iniciar ronda');
    start.type = 'submit';

    function updateSelection() {
      const checked = [...form.querySelectorAll('input[name="requestIds"]:checked')];
      selectedCount.textContent = `${checked.length} de ${maxPlayers} seleccionado(s)`;
      start.disabled = hasActiveRound || checked.length === 0;
    }

    requests.forEach((item, index) => {
      const card = element('label', 'queue-card selectable-player');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.name = 'requestIds';
      checkbox.value = item.id;
      checkbox.checked = !hasActiveRound && index < maxPlayers;
      checkbox.disabled = hasActiveRound;
      checkbox.addEventListener('change', () => {
        const checked = [...form.querySelectorAll('input[name="requestIds"]:checked')];
        if (checked.length > maxPlayers) {
          checkbox.checked = false;
          window.alert(`Este juego admite como máximo ${maxPlayers} participantes por ronda.`);
        }
        updateSelection();
      });
      card.append(checkbox, playerIdentity(item, index + 1));
      grid.append(card);
    });
    form.append(grid);
    const footer = element('div', 'start-round-footer');
    footer.append(selectedCount, start);
    if (hasActiveRound) footer.prepend(element('span', 'muted', 'Finaliza la ronda actual para iniciar otra.'));
    form.append(footer);
    updateSelection();
    form.addEventListener('submit', () => {
      start.disabled = true;
      start.textContent = 'Iniciando…';
    });
    queueRoot.append(form);
  }

  async function refresh() {
    try {
      const response = await fetch(`/api/admin/game/${gameId}/queue`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      if (!response.ok) throw new Error('No se pudo actualizar');
      const data = await response.json();
      const roundSignature = JSON.stringify(data.activeRound
        ? [data.activeRound.id, data.activeRound.participants.map((item) => [item.request_id, item.balance])]
        : null);
      const queueSignature = JSON.stringify([
        Boolean(data.activeRound),
        data.requests.map((item) => [item.id, item.balance])
      ]);
      if (roundSignature !== lastRoundSignature) {
        lastRoundSignature = roundSignature;
        renderActiveRound(data.activeRound);
      }
      if (queueSignature !== lastQueueSignature) {
        lastQueueSignature = queueSignature;
        renderQueue(data.requests, Boolean(data.activeRound));
      }
    } catch (_) {
      if (!activeRoot.querySelector('.active-round-panel')) {
        activeRoot.replaceChildren(element('div', 'notice', 'No fue posible actualizar la mesa. Revisa la conexión.'));
      }
    }
  }

  refresh();
  window.setInterval(refresh, 3000);
})();
