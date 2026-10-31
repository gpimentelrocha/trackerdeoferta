import {initOperationFinance} from './operation-finance.js';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const kinds = {copy:'Copy'};
const pluralKinds = {copy:'Copys'};
const offerStatuses = {idea:'Ideia',production:'Em produção',testing:'Em teste',scaling:'Escalando',paused:'Pausada'};
const statuses = {draft:'Rascunho',ready:'Pronto',testing:'Em teste',winner:'Vencedor',archived:'Arquivado'};
const offerFields = ['name','niche','status','sales_url','notes'];
const materialFields = ['kind','title','status','angle','format','url','content','script'];

export function initMyOffers({api,toast}) {
  let offers = [], offer = null, filter = 'all', request = 0, activeTab = 'finance';
  let editingOfferId = null, editingMaterialId = null, materialOfferId = null, deleting = null, reading = null;
  const errorAt = (id,error) => { $(id).textContent = error.message; $(id).hidden = false; };
  const selectedPath = id => '#minhas-ofertas' + (id ? '/'+id+(activeTab === 'materials' ? '/materiais' : '') : '');
  const ownUrl = id => '/api/my-offers/'+encodeURIComponent(id);
  const materialUrl = (offerId,id) => ownUrl(offerId)+'/materials'+(id ? '/'+encodeURIComponent(id) : '');
  const values = form => Object.fromEntries(new FormData(form));
  const fill = (form,fields,data) => { form.reset(); for (const field of fields) if (data && data[field] !== undefined) form.elements[field].value = data[field]; };
  const totals = () => {
    $('#my-nav-count').textContent = offers.length;
    $('#my-total-offers').textContent = offers.length;
    $('#my-total-materials').textContent = offer ? offer.materials.length : offers.reduce((sum,item)=>sum+Number(item.material_count),0);
  };
  function renderOffers() {
    const query = $('#my-search').value.trim().toLocaleLowerCase('pt-BR');
    const visible = offers.filter(item=>[item.name,item.niche].some(text=>text.toLocaleLowerCase('pt-BR').includes(query)));
    $('#my-offer-list').innerHTML = visible.length ? `<a class="operation-all-offers ${!offer ? 'selected' : ''}" href="#minhas-ofertas"><span aria-hidden="true">▦</span><strong>Toda a operação</strong><small>Ofertas + custos gerais</small></a>`+visible.map(item=>`<a class="operation-offer ${offer?.id === item.id ? 'selected' : ''}" href="${selectedPath(item.id)}" ${offer?.id === item.id ? 'aria-current="true"' : ''}><div class="operation-offer-top"><span class="offer-avatar">${esc(item.name[0])}</span><span class="operation-offer-name">${esc(item.name)}<small>${esc(item.niche || 'Sem nicho informado')}</small></span></div><div class="operation-offer-bottom"><span class="operation-status status-${item.status}">${offerStatuses[item.status]}</span><span>${item.material_count} ${Number(item.material_count)===1?'material':'materiais'}</span></div></a>`).join('') : `<p class="operation-list-empty">${offers.length ? 'Nenhuma oferta corresponde à busca.' : 'Suas ofertas aparecerão aqui.'}</p>`;
  }
  function renderMaterials() {
    if (!offer) return;
    const query = $('#material-search').value.trim().toLocaleLowerCase('pt-BR');
    const result = offer.materials.filter(item=>(filter === 'all' || item.kind === filter) && [item.title,item.content,item.script || '',item.angle,item.format].some(text=>text.toLocaleLowerCase('pt-BR').includes(query)));
    for (const button of document.querySelectorAll('[data-material-filter]')) {
      const kind = button.dataset.materialFilter;
      button.classList.toggle('selected',kind === filter);
      button.setAttribute('aria-pressed',String(kind === filter));
      button.querySelector('span').textContent = kind === 'all' ? offer.materials.length : offer.materials.filter(item=>item.kind === kind).length;
    }
    $('#material-list').innerHTML = result.length ? result.map(item=>`<article class="material-card" data-material-id="${item.id}"><div class="material-card-heading"><span class="material-kind">${kinds[item.kind]}</span><span class="operation-status status-${item.status}">${statuses[item.status]}</span></div><h3>${esc(item.title)}</h3>${item.content || item.script ? `<p class="material-preview">${esc(item.content || item.script)}</p>` : '<p class="material-preview material-muted">Sem texto. Adicione a copy, o roteiro ou suas observações.</p>'}<div class="offer-tags">${item.script ? '<span>Roteiro salvo</span>' : ''}${[item.angle,item.format].filter(Boolean).map(tag=>`<span>${esc(tag)}</span>`).join('')}</div>${item.url ? `<a class="material-file" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Abrir arquivo / referência ↗</a>` : ''}<div class="material-actions"><button class="text-button" data-material-action="read">Ler material</button>${item.content ? '<button class="text-button" data-material-action="copy">Copiar texto</button>' : ''}<button class="text-button" data-material-action="edit">Editar material</button><button class="text-button delete" data-material-action="delete" aria-label="Excluir ${esc(item.title)}">Excluir</button></div></article>`).join('') : `<div class="operation-empty material-empty"><span class="operation-empty-icon" aria-hidden="true">✎</span><h3>${query ? 'Nenhum material corresponde à busca.' : 'Comece com uma ideia.'}</h3><p>${query ? 'Tente outro título, ângulo ou formato.' : 'Guarde sua próxima copy, roteiro, criativo ou ângulo nesta oferta.'}</p>${query ? '' : '<button class="button secondary" data-operation-action="new-material">＋ Adicionar material</button>'}</div>`;
    $('#material-results').textContent = `${result.length} ${result.length === 1 ? 'material' : 'materiais'}`;
  }
  function renderWorkspace() {
    if (!offer) {
      $('#my-workspace').innerHTML = '<div class="operation-empty"><span class="operation-empty-icon" aria-hidden="true">✎</span><h2>Um lugar para cada ideia.</h2><p>Crie uma oferta para reunir suas copys, roteiros, criativos e ângulos.</p><button class="button primary" data-operation-action="new-offer">＋ Criar primeira oferta</button></div>';
      return;
    }
    $('#my-workspace').innerHTML = `<div class="operation-detail-heading"><div><div class="eyebrow">CRIAÇÃO E CONTEÚDO</div><h2>${esc(offer.name)}</h2><div class="operation-detail-meta"><span class="operation-status status-${offer.status}">${offerStatuses[offer.status]}</span>${offer.niche ? `<span>${esc(offer.niche)}</span>` : ''}</div></div><div class="operation-offer-actions"><button class="text-button" data-operation-action="edit-offer">Editar oferta</button><button class="text-button delete" data-operation-action="delete-offer">Excluir oferta</button></div></div>${offer.sales_url ? `<a class="operation-sales-link" href="${esc(offer.sales_url)}" target="_blank" rel="noopener noreferrer">Página de vendas ↗</a>` : ''}${offer.notes ? `<details class="operation-notes"><summary>Notas e contexto da oferta</summary><p>${esc(offer.notes)}</p></details>` : ''}<div class="material-toolbar"><h3>Biblioteca de materiais</h3><button class="button primary" data-operation-action="new-material">＋ Adicionar material</button></div><div class="material-filters" role="group" aria-label="Filtrar materiais por tipo"><button data-material-filter="all" aria-pressed="true" class="selected">Todos <span></span></button>${Object.entries(pluralKinds).map(([key,label])=>`<button data-material-filter="${key}" aria-pressed="false">${label} <span></span></button>`).join('')}</div><div class="material-search-row"><label class="search-box"><input id="material-search" type="search" placeholder="Buscar copy, roteiro, ângulo ou formato…" aria-label="Buscar materiais"></label><span id="material-results"></span></div><div id="material-list" class="material-grid"></div>`;
    $('#material-search').addEventListener('input',renderMaterials);
    renderMaterials();
  }
  const finance = initOperationFinance({api,toast,onOfferChange:id=>{location.hash=selectedPath(id);}});
  function renderTab() {
    const materialTab=activeTab==='materials' && Boolean(offer);
    $('#finance-workspace').hidden=materialTab;
    $('#my-workspace').hidden=!materialTab;
    $('#my-tab-finance').classList.toggle('selected',!materialTab);
    $('#my-tab-materials').classList.toggle('selected',materialTab);
    $('#my-tab-finance').setAttribute('aria-pressed',String(!materialTab));
    $('#my-tab-materials').setAttribute('aria-pressed',String(materialTab));
    $('#my-tab-materials').disabled=!offer;
    $('#my-tab-materials').title=offer ? '' : 'Selecione uma oferta para abrir suas copys e roteiros.';
    $('#operation-scope-label').textContent=offer?.name || 'Toda a operação';
    $('#operation-scope-note').textContent=offer ? offerStatuses[offer.status]+(offer.niche ? ' · '+offer.niche : '') : 'Resultados de todas as ofertas e custos gerais';
  }
  function setTab(tab) {
    activeTab=tab;
    history.replaceState(null,'',selectedPath(offer?.id));
    renderTab(); renderOffers();
  }
  $('#my-tab-finance').addEventListener('click',()=>setTab('finance'));
  $('#my-tab-materials').addEventListener('click',()=>setTab('materials'));
  async function reload(id = offer?.id) {
    const ticket = ++request;
    $('#my-error').hidden = true;
    $('#my-workspace').setAttribute('aria-busy','true');
    try {
      const data = await api('/api/my-offers');
      if (ticket !== request) return;
      offers = data.offers;
      const selected = offers.find(item=>item.id === id);
      let detail = selected ? await api(ownUrl(selected.id)) : null;
      if (ticket !== request) return;
      offer = detail;
      history.replaceState(null,'',selectedPath(offer?.id));
      totals(); renderOffers(); renderWorkspace(); renderTab();
      await finance.setContext(offers,offer);
    } catch(error) { if (ticket === request) errorAt('#my-error',error); }
    finally { if (ticket === request) $('#my-workspace').removeAttribute('aria-busy'); }
  }
  function openOffer(data = null) {
    editingOfferId = data?.id || null;
    fill($('#my-offer-form'),offerFields,data);
    $('#my-offer-dialog-title').textContent = data ? 'Editar minha oferta' : 'Criar minha oferta';
    $('#my-offer-error').hidden = true;
    $('#my-offer-dialog').showModal();
  }
  function openMaterial(data = null) {
    if (!offer) return;
    materialOfferId = offer.id; editingMaterialId = data?.id || null;
    fill($('#my-material-form'),materialFields,data);
    if (!data && filter !== 'all') $('#my-material-form').elements.kind.value = filter;
    $('#my-material-dialog-title').textContent = data ? 'Editar material' : 'Adicionar material';
    $('#my-material-error').hidden = true;
    $('#my-material-dialog').showModal();
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('Texto copiado.'); }
    catch { toast('Não foi possível copiar automaticamente. Abra o material para selecionar o texto.'); }
  }
  function confirmDelete(material = null) {
    deleting = {offerId:offer.id,materialId:material?.id};
    $('#my-delete-title').textContent = material ? 'Excluir material?' : 'Excluir minha oferta?';
    $('#my-delete-description').textContent = material ? `“${material.title}” será excluído desta oferta.` : `“${offer.name}” e seus materiais serão excluídos. Os lançamentos financeiros serão mantidos no total da operação. Essa ação não pode ser desfeita.`;
    $('#my-delete-error').hidden = true;
    $('#my-delete-dialog').showModal();
  }
  $('#my-new-offer').addEventListener('click',()=>openOffer());
  $('#my-empty-create')?.addEventListener('click',()=>openOffer());
  $('#my-search').addEventListener('input',renderOffers);
  for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click',()=>$('#'+button.dataset.close).close());
  $('#my-workspace').addEventListener('click',event=>{
    const tab = event.target.closest('[data-material-filter]');
    if (tab) { filter = tab.dataset.materialFilter; renderMaterials(); return; }
    const action = event.target.closest('[data-operation-action]')?.dataset.operationAction;
    if (action === 'new-offer') openOffer();
    if (action === 'new-material') openMaterial();
    if (action === 'edit-offer') openOffer(offer);
    if (action === 'delete-offer') confirmDelete();
    const button = event.target.closest('[data-material-action]');
    const material = button && offer?.materials.find(item=>item.id === button.closest('[data-material-id]').dataset.materialId);
    if (!material) return;
    if (button.dataset.materialAction === 'edit') openMaterial(material);
    if (button.dataset.materialAction === 'copy') copyText(material.content);
    if (button.dataset.materialAction === 'delete') confirmDelete(material);
    if (button.dataset.materialAction === 'read') {
      reading = material;
      $('#my-read-kind').textContent = kinds[material.kind];
      $('#my-read-title').textContent = material.title;
      $('#my-read-content').textContent = material.content || 'Nenhum texto salvo neste material.';
      $('#my-read-copy-section').hidden = !material.content && Boolean(material.script);
      $('#my-read-script-section').hidden = !material.script;
      $('#my-read-script').textContent = material.script || '';
      $('#my-read-script-copy').hidden = !material.script;
      $('#my-read-tags').innerHTML = [statuses[material.status],material.angle,material.format].filter(Boolean).map(text=>`<span>${esc(text)}</span>`).join('');
      $('#my-read-link').hidden = !material.url;
      if (material.url) $('#my-read-link').href = material.url; else $('#my-read-link').removeAttribute('href');
      $('#my-read-copy').hidden = !material.content;
      $('#my-read-dialog').showModal();
    }
  });
  $('#my-read-copy').addEventListener('click',()=>reading && copyText(reading.content));
  $('#my-read-script-copy').addEventListener('click',()=>reading && copyText(reading.script));
  function handleSave(formId,errorId,save) {
    $(formId).addEventListener('submit',async event=>{
      event.preventDefault();
      const form = event.currentTarget, button = form.querySelector('[type=submit]');
      button.disabled = true; $(errorId).hidden = true;
      try { await save(values(form)); }
      catch(error) { errorAt(errorId,error); }
      finally { button.disabled = false; }
    });
  }
  handleSave('#my-offer-form','#my-offer-error',async data=>{
    const saved = await api(editingOfferId ? ownUrl(editingOfferId) : '/api/my-offers',{method:editingOfferId ? 'PATCH' : 'POST',body:JSON.stringify(data)});
    $('#my-offer-dialog').close(); filter = 'all'; activeTab='materials'; await reload(saved.id); toast('Sua oferta foi salva.');
  });
  handleSave('#my-material-form','#my-material-error',async data=>{
    await api(materialUrl(materialOfferId,editingMaterialId),{method:editingMaterialId ? 'PATCH' : 'POST',body:JSON.stringify(data)});
    $('#my-material-dialog').close(); filter = 'all'; await reload(materialOfferId); toast('Material salvo na oferta.');
  });
  $('#my-confirm-delete').addEventListener('click',async event=>{
    const button = event.currentTarget; button.disabled = true;
    try {
      await api(deleting.materialId ? materialUrl(deleting.offerId,deleting.materialId) : ownUrl(deleting.offerId),{method:'DELETE',body:'{}'});
      $('#my-delete-dialog').close(); await reload(); toast('Excluído.');
    } catch(error) { errorAt('#my-delete-error',error); }
    finally { button.disabled = false; }
  });
  return {
    show(id,view) { filter = 'all'; activeTab=view === 'materiais' ? 'materials' : 'finance'; return reload(id ?? null); },
    hide() { request++; finance.cancel(); $('#my-workspace').removeAttribute('aria-busy'); },
    async refreshCount() { try { const data = await api('/api/my-offers'); $('#my-nav-count').textContent = data.offers.length; } catch {} }
  };
}
