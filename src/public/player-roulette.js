(() => {
 const select=document.querySelector('#roulette-bet-option');if(!select)return;
 const amount=document.querySelector('#bet-amount');const balanceMax=Number(amount.max);
 for(const b of window.RouletteRules.bets)select.append(new Option(`${b.label} · pago total ×${b.multiplier}`,b.id));
 select.addEventListener('change',()=>{const bet=window.RouletteRules.bets.find(b=>b.id===select.value);amount.max=Math.min(balanceMax,bet?.max||1500);document.querySelectorAll('[data-bet-amount]').forEach(button=>{button.disabled=Number(button.dataset.betAmount)>Number(amount.max);});});
})();
