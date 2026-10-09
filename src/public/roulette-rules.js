(function(root) {
  const red=[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
  const bets=[];
  function add(id,label,numbers,multiplier){bets.push({id,label,numbers,multiplier,max:multiplier===36?800:1500});}
  add('rojo','Rojo',red,2);add('negro','Negro',Array.from({length:36},(_,i)=>i+1).filter(n=>!red.includes(n)),2);
  for(const [id,label,fn] of [['par','Par',n=>n%2===0],['impar','Impar',n=>n%2===1],['bajo','1–18',n=>n<=18],['alto','19–36',n=>n>=19]])add(id,label,Array.from({length:36},(_,i)=>i+1).filter(fn),2);
  for(let i=0;i<3;i++){add('docena'+(i+1),'Docena '+(i+1),Array.from({length:12},(_,j)=>i*12+j+1),3);add('columna'+(i+1),'Columna '+(i+1),Array.from({length:12},(_,j)=>j*3+i+1),3);}
  for(let n=0;n<=36;n++)add('pleno-'+n,'Pleno '+n,[n],36);
  for(let n=1;n<=36;n++){
    if(n%3!==0)add('caballo-'+n+'-'+(n+1),'Caballo '+n+' / '+(n+1),[n,n+1],18);
    if(n<=33)add('caballo-'+n+'-'+(n+3),'Caballo '+n+' / '+(n+3),[n,n+3],18);
    if(n%3===1){add('transversal-'+n,'Transversal '+n+'–'+(n+2),[n,n+1,n+2],12);if(n<=31)add('seisena-'+n,'Seisena '+n+'–'+(n+5),Array.from({length:6},(_,i)=>n+i),6);}
    if(n<=32&&n%3!==0)add('cuadro-'+n,'Cuadro '+[n,n+1,n+3,n+4].join('/'),[n,n+1,n+3,n+4],9);
  }
  for(const n of [1,2,3])add('caballo-0-'+n,'Caballo 0 / '+n,[0,n],18);
  function settle(id,amount,number){
    const bet=bets.find(b=>b.id===id);const stake=Number(amount),winner=Number(number);
    if(number===null||number===undefined||number===''||!Number.isInteger(winner)||winner<0||winner>36)throw Error('Selecciona un resultado entre 0 y 36.');
    if(!bet||!Number.isSafeInteger(stake)||stake<100||stake>bet.max)throw Error('Apuesta inválida: mínimo $100, máximo $1.500 ($800 para pleno).');
    const won=bet.numbers.includes(winner);const payout=won?stake*bet.multiplier:0;
    return {bet,stake,won,payout,net:payout-stake};
  }
  const api={bets,red,settle,isRoulette:game=>/ruleta/i.test(`${game.name||''} ${game.slug||''}`)};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RouletteRules=api;
})(typeof window!=='undefined'?window:globalThis);
