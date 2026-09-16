(() => {
  const card = document.querySelector('[data-wait-request]');
  if (!card || !document.querySelector('#wait-message')) return;
  const requestId = card.dataset.waitRequest;
  const message = document.querySelector('#wait-message');
  const balance = document.querySelector('#current-balance');
  const cancelForm = document.querySelector('#cancel-wait');
  const backAccount = document.querySelector('#back-account');
  let timer;

  function showPlaying() {
    message.textContent = '¡Tu ronda comenzó! Sigue las indicaciones del encargado.';
    card.classList.add('round-playing');
    if (cancelForm) cancelForm.classList.add('hidden');
  }

  function finishWaiting(text) {
    message.textContent = text;
    if (cancelForm) cancelForm.classList.add('hidden');
    if (backAccount) backAccount.classList.remove('hidden');
    if (timer) window.clearInterval(timer);
  }

  async function check() {
    try {
      const response = await fetch(`/api/player/request/${requestId}`, { headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      const data = await response.json();
      if (data.status === 'used') {
        const amount = Number(data.amount);
        balance.textContent = new Intl.NumberFormat('es-CL').format(Number(data.balance));
        message.textContent = amount > 0 ? `¡Ganaste ${new Intl.NumberFormat('es-CL').format(amount)}!` : `Se descontaron ${new Intl.NumberFormat('es-CL').format(Math.abs(amount))}.`;
        card.classList.add(amount > 0 ? 'result-win' : 'result-loss');
        if (cancelForm) cancelForm.classList.add('hidden');
        window.setTimeout(() => { window.location.href = '/player'; }, 2200);
        if (timer) window.clearInterval(timer);
      } else if (data.status === 'playing') {
        showPlaying();
      } else if (data.status === 'pending') {
        message.textContent = 'Estás en la fila. Espera a que el encargado inicie tu ronda.';
      } else {
        finishWaiting('Esta participación ya no está activa.');
      }
    } catch (_) {
      message.textContent = 'Esperando conexión…';
    }
  }
  if (card.dataset.initialStatus === 'playing') showPlaying();
  check();
  timer = window.setInterval(check, 5000);
})();
