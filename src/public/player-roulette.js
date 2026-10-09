(() => {
 const form=document.querySelector('[data-mobile-roulette]');if(!form)return;
 const rules=window.RouletteRules,amount=form.querySelector('#bet-amount'),choice=form.querySelector('#roulette-bet-option'),summary=form.querySelector('#bet-summary'),confirm=form.querySelector('#roulette-confirm'),options=form.querySelector('#roulette-options'),balance=Number(form.dataset.balance),chips=[...form.querySelectorAll('[data-bet-amount]')];
 let selectedType=null;
 const types=[['suerte','Suerte sencilla','18 números · ×2',b=>b.multiplier===2],['columna','Columna','12 números · ×3',b=>b.id.startsWith('columna')],['docena','Docena','12 números · ×3',b=>b.id.startsWith('docena')],['seisena','Seisena','6 números · ×6',b=>b.id.startsWith('seisena-')],['cuadro','Cuadro','4 números · ×9',b=>b.id.startsWith('cuadro-')],['transversal','Transversal','3 números · ×12',b=>b.id.startsWith('transversal-')],['caballo','Caballo / Semipleno','2 números · ×18',b=>b.id.startsWith('caballo-')],['pleno','Pleno','1 número · ×36',b=>b.id.startsWith('pleno-')]];
 const money=n=>'$'+Number(n).toLocaleString('es-CL');
 function button(text,cls){const b=document.createElement('button');b.type='button';b.className=cls;b.textContent=text;b.setAttribute('aria-pressed','false');return b;}
 function update(){const bet=rules.bets.find(b=>b.id===choice.value),max=Math.min(balance,selectedType==='pleno'?800:1500);amount.max=max;
   form.querySelector('#roulette-limit').textContent=`Mínimo $100 · máximo ${money(max)}${selectedType==='pleno'?' para pleno':''}.`;
   chips.forEach(b=>{b.disabled=Number(b.dataset.betAmount)>max;b.setAttribute('aria-pressed',String(Number(amount.value)===Number(b.dataset.betAmount)));});
   let valid=false;try{rules.settle(choice.value,amount.value,0);valid=Number(amount.value)<=balance;}catch(_){}
   confirm.disabled=!valid;
   if(balance<100)summary.textContent='Tu saldo no alcanza para la apuesta mínima de $100.';
   else if(!bet)summary.textContent='Elige un tipo de apuesta y tu jugada.';
   else if(!valid)summary.textContent=`${bet.label}: ingresa un monto entero entre $100 y ${money(max)}.`;
   else summary.textContent=`Tu apuesta: ${bet.label} · ${money(amount.value)}. Pago total si ganas: ${money(Number(amount.value)*bet.multiplier)}.`;
 }
 for(const [id,label,detail,filter] of types){const b=button('', 'roulette-type');const title=document.createElement('strong');title.textContent=label;const small=document.createElement('small');small.textContent=detail;b.append(title,small);b.dataset.type=id;b.addEventListener('click',()=>{selectedType=id;choice.value='';form.querySelectorAll('.roulette-type').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));options.replaceChildren();options.classList.toggle('roulette-plenos',id==='pleno');form.querySelector('#roulette-selection-help').textContent=`Elige tu ${label.toLowerCase()}.`;
   for(const bet of rules.bets.filter(filter)){const text=id==='pleno'?String(bet.numbers[0]):bet.label.replace(/^(Columna|Docena|Seisena|Cuadro|Transversal|Caballo) /,'');const c=button(text,'roulette-choice');if(id==='pleno'){c.classList.add(bet.numbers[0]===0?'green':rules.red.includes(bet.numbers[0])?'red':'black');}else if(bet.id==='rojo'||bet.id==='negro'){c.classList.add(bet.id==='rojo'?'red':'black');}c.setAttribute('aria-label',bet.label);c.addEventListener('click',()=>{choice.value=bet.id;options.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===c)));update();});options.append(c);}update();});form.querySelector('#roulette-types').append(b);}
 chips.forEach(b=>b.addEventListener('click',()=>{amount.value=b.dataset.betAmount;update();}));amount.addEventListener('input',update);
 form.addEventListener('submit',e=>{update();if(confirm.disabled){e.preventDefault();return;}confirm.disabled=true;confirm.textContent='Confirmando apuesta…';});update();
})();
