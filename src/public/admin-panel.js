document.querySelector('#user-search')?.addEventListener('input',(event)=>{
  const query=event.target.value.trim().toLowerCase();
  document.querySelectorAll('.user-row').forEach(row=>{row.hidden=!row.dataset.search.includes(query);});
});
document.querySelectorAll('.confirm-delete').forEach(form=>form.addEventListener('submit',event=>{
  if(!window.confirm(`¿Eliminar del listado a ${form.dataset.name}? Su historial se conservará.`))event.preventDefault();
}));
