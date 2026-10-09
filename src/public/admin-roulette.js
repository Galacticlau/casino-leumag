window.renderRouletteRound = ({round,activeRoot,gameId,csrf}) => {
  const rules=window.RouletteRules;
  const node=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n;};
  const hidden=(name,value)=>{const n=node('input');n.type='hidden';n.name=name;n.value=value;return n;};
  const money=n=>'$'+Number(n).toLocaleString('es-CL');
  const panel=node('section','panel active-round-panel roulette-panel');
  panel.append(node('span','eyebrow','Mesa de ruleta'),node('h2','',`Ronda #${round.id}`),node('p','muted','Una apuesta por jugador · mínimo $100 · máximo $1.500 · pleno hasta $800.'));
  const form=node('form','roulette-layout');form.method='post';form.action=`/admin/game/${gameId}/rounds/${round.id}/finish`;
  const payload=hidden('results','[]'),winning=hidden('winningNumber','');form.append(hidden('_csrf',csrf),payload,winning);
  const left=node('div','roulette-result');const ball=node('div','roulette-ball','?');left.append(node('h3','','Ingresa el número ganador'),ball);
  const grid=node('div','roulette-numbers');left.append(grid);
  const right=node('div','roulette-players');right.append(node('h3','','Jugadores en esta ronda'));
  const entries=[];
  for(const item of round.participants){
    const card=node('article','queue-card');card.append(node('h3','',item.display_name),node('small','',`@${item.username} · saldo ${money(item.balance)}`));
    const bet=rules.bets.find(b=>b.id===item.bet_option);
    card.append(node('p','player-bet-badge',bet ? `${bet.label} · ${money(item.bet_amount)} · pago ×${bet.multiplier}` : 'Sin apuesta confirmada: debe cancelar y volver a entrar.'));
    const preview=node('p','roulette-preview','Selecciona el resultado para ver el pago.');card.append(preview);right.append(card);entries.push({item,preview});
  }
  const summary=node('p','notice','');const confirm=node('button','button button-primary button-wide','Confirmar resultado y repartir pagos');confirm.type='submit';confirm.disabled=true;left.append(summary,confirm);form.append(left,right);panel.append(form);
  function update(){let valid=winning.value!=='';let stakes=0,payouts=0,winners=0;
    for(const e of entries){try{const r=rules.settle(e.item.bet_option,e.item.bet_amount,winning.value);if(r.stake>Number(e.item.balance))throw Error('Saldo insuficiente.');e.preview.textContent=`${r.won?'Ganó':'Perdió'} · pago total ${money(r.payout)} · cambio de saldo ${r.net>0?'+':''}${money(r.net)}`;e.preview.className='roulette-preview '+(r.won?'positive':'negative');stakes+=r.stake;payouts+=r.payout;winners+=Number(r.won);}catch(err){valid=false;e.preview.textContent=err.message;}}
    summary.textContent=valid?`${winners} ganadores · ${entries.length-winners} perdedores · apostado ${money(stakes)} · pagos ${money(payouts)} · resultado de mesa ${money(stakes-payouts)}`:'Completa todas las apuestas y selecciona el número real que salió.';confirm.disabled=!valid||!entries.length;
  }
  for(let number=0;number<=36;number++){const color=number===0?'green':rules.red.includes(number)?'red':'black';const button=node('button','roulette-number '+color,String(number));button.type='button';button.setAttribute('aria-pressed','false');button.addEventListener('click',()=>{winning.value=number;ball.textContent=number;ball.className='roulette-ball '+color;grid.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));update();});grid.append(button);}
  form.addEventListener('submit',event=>{update();if(confirm.disabled){event.preventDefault();return;}if(!window.confirm(`¿Confirmar que salió el ${winning.value} y cerrar la ronda?`)){event.preventDefault();return;}payload.value=JSON.stringify(entries.map(e=>({requestId:Number(e.item.request_id)})));confirm.disabled=true;confirm.textContent='Registrando pagos…';});
  const cancel=node('form');cancel.method='post';cancel.action=`/admin/game/${gameId}/rounds/${round.id}/cancel`;cancel.append(hidden('_csrf',csrf));const button=node('button','button button-danger button-small','Cancelar ronda y devolver a la fila');button.type='submit';cancel.append(button);cancel.addEventListener('submit',e=>{if(!window.confirm('¿Cancelar la ronda?'))e.preventDefault();});panel.append(cancel);activeRoot.append(panel);update();
};
