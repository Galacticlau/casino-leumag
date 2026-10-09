(() => {
  const form = document.querySelector('#bet-form');
  const input = form?.querySelector('#bet-amount');
  if (!input || form.dataset.mobileRoulette === 'true') return;
  const chips = [...form.querySelectorAll('[data-bet-amount]')];
  const summary = form.querySelector('#bet-summary');
  const format = (value) => new Intl.NumberFormat('es-CL').format(value);
  function update() {
    chips.forEach((chip) => chip.setAttribute('aria-pressed', String(Number(input.value) === Number(chip.dataset.betAmount))));
    const option = form.querySelector('[name=betOption]:checked') || (form.querySelector('#roulette-bet-option')?.value ? form.querySelector('#roulette-bet-option') : null);
    summary.textContent = option && input.value && input.checkValidity() ? `Tu apuesta: ${(option.tagName === 'SELECT' ? option.selectedOptions[0].textContent : option.value)} · $${format(Number(input.value))}` : 'Elige una opción y un monto dentro de tu saldo.';
  }
  chips.forEach((chip) => chip.addEventListener('click', () => { input.value = chip.dataset.betAmount; update(); }));
  input.addEventListener('input', update);
  form.addEventListener('change', update);
  form.addEventListener('submit', () => { const submit = form.querySelector('[type=submit]'); submit.disabled = true; submit.textContent = 'Confirmando apuesta…'; });
})();
