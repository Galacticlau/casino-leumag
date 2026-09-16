(() => {
  const card = document.querySelector('[data-wait-request]');
  if (!card || !document.querySelector('#wait-message')) return;
  const requestId = card.dataset.waitRequest;
  const message = document.querySelector('#wait-message');
  const balance = document.querySelector('#current-balance');

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
        window.setTimeout(() => { window.location.href = '/player'; }, 2200);
      } else if (data.status !== 'pending') {
        message.textContent = 'Esta participación ya no está activa.';
        window.setTimeout(() => { window.location.href = '/player'; }, 1800);
      }
    } catch (_) {
      message.textContent = 'Esperando conexión…';
    }
  }
  window.setInterval(check, 2000);
})();
