import {EXPENSE_CATEGORIES,parseMoney,money,todayInBrazil,periodRange,summarizeEntries} from './finance-math.js';
const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const dayLabel=day=>day.split('-').reverse().join('/');
const category=entry=>entry.type==='revenue' ? 'Faturamento' : EXPENSE_CATEGORIES[entry.category];
const entryName=entry=>entry.current_offer_name || (entry.offer_name ? entry.offer_name+' (oferta excluída)' : 'Operação geral');
function chart(summary) {
  if (!summary.days.length) return '<div class="finance-chart-empty"><span aria-hidden="true">↗</span><strong>O próximo resultado começa aqui.</strong><p>Adicione seu faturamento e suas despesas para acompanhar a evolução.</p></div>';
  let rows=summary.days;
  if (rows.length>62) {
    const months=new Map();
    for (const row of rows) {const key=row.day.slice(0,7);const item=months.get(key)||{day:key,revenue:0,expense:0};item.revenue+=row.revenue;item.expense+=row.expense;months.set(key,item);}
    rows=[...months.values()];
    if (rows.length>24) {
      const years=new Map();
      for (const row of rows) {const key=row.day.slice(0,4);const item=years.get(key)||{day:key,revenue:0,expense:0};item.revenue+=row.revenue;item.expense+=row.expense;years.set(key,item);}
      rows=[...years.values()];
    }
  }
  const mobile=innerWidth<=700,w=mobile?Math.max(270,innerWidth-80):760,h=240,left=mobile?53:70,right=15,top=14,bottom=37,plotH=h-top-bottom;
  const maximum=Math.max(...rows.flatMap(row=>[row.revenue,row.expense]),1)*1.15;
  const step=(w-left-right)/rows.length,bar=Math.min(24,step*.3),base=h-bottom;
  const compact=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',notation:'compact',maximumFractionDigits:1}).format(value/100);
  const grid=Array.from({length:4},(_,i)=>{const value=maximum*i/3,y=base-value/maximum*plotH;return `<line x1="${left}" y1="${y}" x2="${w-right}" y2="${y}" class="finance-grid-line"/><text x="${left-12}" y="${y+4}" text-anchor="end" class="finance-axis">${esc(compact(value))}</text>`;}).join('');
  const bars=rows.map((row,index)=>{
    const x=left+step*(index+.5),rh=row.revenue/maximum*plotH,eh=row.expense/maximum*plotH;
    const label=row.day.length===10 ? row.day.slice(8)+'/'+row.day.slice(5,7) : row.day.length===7 ? row.day.slice(5)+'/'+row.day.slice(0,4) : row.day;
    return `<g tabindex="0" role="img" aria-label="${esc(label+': faturamento '+money(row.revenue)+', despesas '+money(row.expense))}"><title>${esc(label)} · Faturamento: ${esc(money(row.revenue))} · Despesas: ${esc(money(row.expense))}</title><rect x="${x-bar-2}" y="${base-rh}" width="${bar}" height="${rh}" rx="3" class="finance-revenue-bar"/><rect x="${x+2}" y="${base-eh}" width="${bar}" height="${eh}" rx="3" class="finance-expense-bar"/>${index%Math.max(1,Math.ceil(rows.length/(mobile?4:8)))===0 ? `<text x="${x}" y="${base+24}" text-anchor="middle" class="finance-axis">${label}</text>` : ''}</g>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Faturamento e despesas por ${rows[0].day.length===10?'dia':rows[0].day.length===7?'mês':'ano'}" class="finance-svg">${grid}${bars}</svg><p class="finance-chart-note">Barras com os totais dos períodos que têm lançamentos. Passe o cursor ou use Tab para consultar os valores.</p>`;
}
export function initOperationFinance({api,toast,onOfferChange}) {
  let offers=[],selected=null,entries=[],editing=null,deleting=null,ticket=0,range=periodRange('month');
  const form=$('#finance-entry-form');
  form.elements.category.innerHTML=Object.entries(EXPENSE_CATEGORIES).map(([key,label])=>`<option value="${key}">${label}</option>`).join('');
  $('#finance-from').value=range.from;$('#finance-to').value=range.to;
  const showError=(id,error)=>{$(id).textContent=error.message;$(id).hidden=false;};
  const scoped=()=>selected ? entries.filter(entry=>entry.offer_id===selected.id) : entries;
  function renderEntries() {
    const query=$('#finance-search').value.toLocaleLowerCase('pt-BR').trim(),type=$('#finance-type-filter').value;
    const rows=scoped().filter(entry=>(type==='all'||entry.type===type)&&[entry.description,category(entry),entryName(entry)].some(value=>value.toLocaleLowerCase('pt-BR').includes(query)));
    $('#finance-entry-count').textContent=`${rows.length} ${rows.length===1?'lançamento':'lançamentos'}`;
    $('#finance-entries').innerHTML=rows.length ? `<div class="finance-table-wrap"><table class="finance-table"><thead><tr><th>Data</th><th>Descrição / categoria</th><th>Oferta</th><th>Valor</th><th><span class="sr-only">Ações</span></th></tr></thead><tbody>${rows.map(entry=>`<tr data-entry-id="${entry.id}"><td>${dayLabel(entry.day)}</td><td><strong>${esc(entry.description||category(entry))}</strong><span class="finance-category-tag ${entry.type}">${category(entry)}</span></td><td>${esc(entryName(entry))}</td><td class="finance-entry-amount ${entry.type}">${entry.type==='expense'?'−':'+'} ${money(entry.amount_cents)}</td><td><div class="finance-row-actions"><button class="text-button" data-finance-action="edit" aria-label="Editar lançamento ${esc(entry.description||category(entry))}">Editar</button><button class="text-button delete" data-finance-action="delete" aria-label="Excluir lançamento ${esc(entry.description||category(entry))}">Excluir</button></div></td></tr>`).join('')}</tbody></table></div>` : `<div class="finance-ledger-empty"><strong>${query||type!=='all'?'Nenhum lançamento corresponde aos filtros.':'Nenhum lançamento neste período.'}</strong><p>${query||type!=='all'?'Ajuste a busca ou o tipo de movimentação.':'Registre uma despesa ou o faturamento para começar a acompanhar seu lucro.'}</p></div>`;
  }
  function render() {
    const summary=summarizeEntries(scoped());
    $('#finance-revenue').textContent=money(summary.revenue);
    $('#finance-expense').textContent=money(summary.expense);
    $('#finance-profit').textContent=money(summary.profit);
    $('#finance-profit').closest('article').classList.toggle('is-negative',summary.profit<0);
    $('#finance-margin').textContent=summary.margin===null ? '—' : new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(summary.margin)+'%';
    $('#finance-chart').innerHTML=chart(summary);
    $('#finance-chart-total').textContent=`${scoped().length} lançamentos`;
    const categories=Object.entries(summary.categories).sort((a,b)=>b[1]-a[1]);
    $('#finance-breakdown').innerHTML=categories.length ? categories.map(([key,value])=>`<div class="finance-category-row"><div><span>${EXPENSE_CATEGORIES[key]}</span><strong>${money(value)}</strong></div><div class="finance-category-track"><svg viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true"><rect width="${Math.round(value/summary.expense*100)}" height="4" rx="2"/></svg></div></div>`).join('') : '<div class="finance-breakdown-empty"><span aria-hidden="true">◎</span><p>Suas despesas por categoria aparecerão aqui.</p></div>';
    $('#finance-scope-hint').textContent=selected ? 'Despesas gerais da operação ficam fora do resultado desta oferta.' : 'Custos gerais entram no total da operação e não são rateados entre ofertas.';
    renderEntries();
  }
  async function load() {
    const current=++ticket;
    $('#finance-error').hidden=true;
    $('#finance-summary').setAttribute('aria-busy','true');
    for(const id of ['finance-revenue','finance-expense','finance-profit','finance-margin']) $('#'+id).textContent='—';
    try {
      range=periodRange($('#finance-period').value,todayInBrazil(),$('#finance-from').value,$('#finance-to').value);
      const query=new URLSearchParams();if(range.from)query.set('from',range.from);if(range.to)query.set('to',range.to);
      const data=await api('/api/finance?'+query);
      if(current!==ticket)return;
      entries=data.entries;render();
    } catch(error) {
      if(current===ticket){entries=[];$('#finance-entries').innerHTML='';$('#finance-chart').innerHTML='<div class="finance-chart-empty">Não foi possível carregar os valores.</div>';$('#finance-breakdown').innerHTML='';showError('#finance-error',error);}
    } finally {if(current===ticket)$('#finance-summary').removeAttribute('aria-busy');}
  }
  function updateType() {$('#finance-category-field').hidden=form.elements.type.value==='revenue';}
  function open(type='expense',entry=null) {
    editing=entry?.id||null;form.reset();
    form.elements.type.value=entry?.type||type;
    form.elements.day.value=entry?.day||todayInBrazil();
    form.elements.amount.value=entry ? (entry.amount_cents/100).toFixed(2).replace('.',',') : '';
    form.elements.offer_id.innerHTML='<option value="">Operação geral</option>'+offers.map(item=>`<option value="${item.id}">${esc(item.name)}</option>`).join('');
    form.elements.offer_id.value=entry ? entry.offer_id||'' : selected?.id||'';
    form.elements.category.value=entry?.type==='expense'?entry.category:'ads';
    form.elements.description.value=entry?.description||'';
    $('#finance-entry-title').textContent=entry ? 'Editar lançamento' : 'Novo lançamento';
    $('#finance-form-error').hidden=true;updateType();$('#finance-entry-dialog').showModal();
  }
  let resizeTimer;
  window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(!$('#finance-summary').hasAttribute('aria-busy')&&$('#finance-error').hidden)$('#finance-chart').innerHTML=chart(summarizeEntries(scoped()));},120);});
  $('#finance-new-entry').addEventListener('click',()=>open());
  $('#finance-add-expense').addEventListener('click',()=>open('expense'));
  $('#finance-add-revenue').addEventListener('click',()=>open('revenue'));
  form.elements.type.addEventListener('change',updateType);
  $('#finance-offer').addEventListener('change',event=>onOfferChange(event.target.value));
  $('#finance-period').addEventListener('change',()=>{$('#finance-custom-range').hidden=$('#finance-period').value!=='custom';if($('#finance-period').value!=='custom')load();});
  $('#finance-apply').addEventListener('click',load);
  $('#finance-search').addEventListener('input',renderEntries);
  $('#finance-type-filter').addEventListener('change',renderEntries);
  $('#finance-entries').addEventListener('click',event=>{
    const button=event.target.closest('[data-finance-action]');if(!button)return;
    const entry=entries.find(item=>item.id===button.closest('[data-entry-id]').dataset.entryId);if(!entry)return;
    if(button.dataset.financeAction==='edit')open(entry.type,entry);
    else{deleting=entry.id;$('#finance-delete-description').textContent=`${entry.description||category(entry)} · ${money(entry.amount_cents)}. O valor será removido dos cálculos.`;$('#finance-delete-error').hidden=true;$('#finance-delete-dialog').showModal();}
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;$('#finance-form-error').hidden=true;
    try {
      const data=Object.fromEntries(new FormData(form));data.amount_cents=parseMoney(data.amount);delete data.amount;data.offer_id=data.offer_id||null;
      if(data.type==='revenue')data.category='sales';
      await api('/api/finance/entries'+(editing?'/'+editing:''),{method:editing?'PATCH':'POST',body:JSON.stringify(data)});
      $('#finance-entry-dialog').close();await load();
      toast((range.from&&data.day<range.from)||(range.to&&data.day>range.to)?'Lançamento salvo fora do período exibido. Ajuste o filtro para vê-lo.':selected&&data.offer_id!==selected.id?'Lançamento salvo. Ajuste o filtro de oferta para vê-lo.':'Lançamento salvo.');
    }catch(error){showError('#finance-form-error',error);}finally{button.disabled=false;}
  });
  $('#finance-confirm-delete').addEventListener('click',async event=>{
    const button=event.currentTarget;button.disabled=true;
    try{await api('/api/finance/entries/'+deleting,{method:'DELETE',body:'{}'});$('#finance-delete-dialog').close();await load();toast('Lançamento excluído. Resultado recalculado.');}
    catch(error){showError('#finance-delete-error',error);}finally{button.disabled=false;}
  });
  return {
    setContext(items,offer) {offers=items;selected=offer;$('#finance-offer').innerHTML='<option value="">Toda a operação</option>'+offers.map(item=>`<option value="${item.id}">${esc(item.name)}</option>`).join('');$('#finance-offer').value=selected?.id||'';return load();},
    cancel(){ticket++;$('#finance-summary').removeAttribute('aria-busy');}
  };
}
