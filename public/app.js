import { createDailyChart, valueLabel, fullDate } from './daily-chart.js';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const number = value => new Intl.NumberFormat('pt-BR').format(value);
const signed = value => `${value > 0 ? '+' : ''}${number(value)}`;
let timeZone = 'America/Fortaleza';
let offers = [];
let selection = null;
let toastTimer;
let loading = false;
let authenticated = false;
let chartDays = 30;
let chartOffer = '';
let chartSignature = '';
let chartRecords = [];
function todayInZone() { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function showLogin() { authenticated = false; if (!$('#login-dialog').open) $('#login-dialog').showModal(); }
function setDetail(record) { $('#chart-detail').textContent = record ? `${fullDate(record.day)} · ${valueLabel(record)} anúncios` : 'Sem contagem neste período.'; }
function renderEvolution(force = false) {
  if (!offers.some(offer => offer.id === chartOffer)) chartOffer = offers[0]?.id || '';
  const select = $('#chart-offer');
  const optionsKey = JSON.stringify(offers.map(offer => [offer.id, offer.name]));
  if (select.dataset.key !== optionsKey) {
    select.innerHTML = offers.length ? offers.map(offer => `<option value="${offer.id}">${esc(offer.name)}</option>`).join('') : '<option value="">Nenhuma oferta cadastrada</option>';
    select.dataset.key = optionsKey;
  }
  select.value = chartOffer;
  select.disabled = !offers.length;
  const offer = offers.find(offer => offer.id === chartOffer);
  const signature = JSON.stringify([chartOffer, chartDays, offer?.history, todayInZone()]);
  if (!force && chartSignature === signature) return;
  chartSignature = signature;
  const result = createDailyChart(offer?.history || [], { days: chartDays, today: todayInZone(), width: $('#daily-chart').clientWidth || 760, id: 'evolution' });
  chartRecords = result.records;
  $('#daily-chart').innerHTML = result.html;
  setDetail(result.records.at(-1));
  $('#chart-summary').textContent = result.delta === null ? `${result.records.length} dia registrado` : `${signed(result.delta)} anúncios no período · ${result.records.length} dias registrados`;
  $('#chart-footnote').textContent = offer?.history.length === 1 ? 'Primeiro dia registrado. As próximas coletas formarão a curva; não criamos dados de dias anteriores.' : 'Uma contagem por dia. Dias sem consulta aparecem como lacunas, nunca como zero. Contagens da Meta podem ser aproximadas.';
}
$('#chart-offer').addEventListener('change', event => { chartOffer = event.target.value; renderEvolution(); });
for (const button of document.querySelectorAll('[data-days]')) button.addEventListener('click', () => {
  chartDays = Number(button.dataset.days);
  for (const item of document.querySelectorAll('[data-days]')) { item.classList.toggle('selected', item === button); item.setAttribute('aria-pressed', String(item === button)); }
  renderEvolution();
});
for (const type of ['mouseover', 'focusin', 'click']) $('#daily-chart').addEventListener(type, event => {
  const point = event.target.closest('[data-chart-index]');
  if (point) setDetail(chartRecords[Number(point.dataset.chartIndex)]);
});
$('#daily-chart').addEventListener('keydown', event => {
  if (['Enter', ' '].includes(event.key) && event.target.matches('[data-chart-index]')) { event.preventDefault(); setDetail(chartRecords[Number(event.target.dataset.chartIndex)]); }
});
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => renderEvolution(true), 150); });
function dateTime(value) { return new Intl.DateTimeFormat('pt-BR', { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); }
function day(value) { return value.split('-').reverse().join('/'); }
function countLabel(snapshot) {
  return snapshot ? `${snapshot.precision === 'approximate' ? '≈ ' : snapshot.precision === 'lower_bound' ? '≥ ' : ''}${number(snapshot.count)}` : '—';
}
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5000);
}
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  if (response.status === 401 && path !== '/api/login') showLogin();
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
  return data;
}
function chart(history, id) {
  if (history.length < 2) return '<div class="chart-empty">O gráfico aparece a partir de dois dias registrados.</div>';
  const width = 500, height = 100, pad = 7;
  const times = history.map(item => Date.parse(item.day + 'T12:00:00Z'));
  const counts = history.map(item => item.count);
  const min = Math.min(...counts), max = Math.max(...counts);
  const points = counts.map((count, index) => [pad + ((times[index] - times[0]) / (times.at(-1) - times[0])) * (width - pad * 2), max === min ? height / 2 : height - pad - ((count - min) / (max - min)) * (height - pad * 2)]);
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return `<svg class="sparkline" viewBox="0 0 ${width} ${height}" role="img" aria-label="Histórico: ${esc(history.map(item => `${day(item.day)}: ${countLabel(item)}`).join('; '))}" preserveAspectRatio="none"><defs><linearGradient id="g-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#e8c83f" stop-opacity=".15"/><stop offset="100%" stop-color="#e8c83f" stop-opacity="0"/></linearGradient></defs><polygon points="${pad},${height} ${line} ${width-pad},${height}" fill="url(#g-${id})"/><polyline points="${line}" stroke="#e8c83f" stroke-width="2" fill="none" vector-effect="non-scaling-stroke"/>${points.map(([x, y], index) => `<circle cx="${x}" cy="${y}" r="2.5" fill="#e8c83f"><title>${day(history[index].day)}: ${countLabel(history[index])}</title></circle>`).join('')}</svg>`;
}
function card(offer) {
  const busy = ['queued', 'updating'].includes(offer.state);
  const statusText = { ok: 'Atualizada', pending: 'Aguardando', queued: 'Na fila', updating: 'Consultando…', error: 'Verificar acesso' }[offer.state];
  const filters = new URL(offer.url).searchParams;
  const statusFilter = { active: 'Ativos', inactive: 'Inativos', all: 'Todos os status' }[filters.get('active_status')] || 'Filtros do link';
  const delta = offer.delta === null ? '' : `<span class="delta ${offer.delta > 0 ? 'up' : offer.delta < 0 ? 'down' : ''}">${signed(offer.delta)} entre dias</span>`;
  return `<article class="offer-card" data-id="${offer.id}"><div class="card-heading"><div class="offer-avatar">${esc(offer.name[0].toLocaleUpperCase('pt-BR'))}</div><div class="card-title"><h3 title="${esc(offer.name)}">${esc(offer.name)}</h3><a href="${esc(offer.url)}" target="_blank" rel="noopener noreferrer">Abrir na biblioteca ↗</a></div><span class="status ${offer.state}">${statusText}</span></div><div class="card-value"><strong>${countLabel(offer.latest)}</strong><small>anúncios</small>${delta}</div><div class="card-context">${esc(statusFilter)} · ${esc(filters.get('country') || 'País do link')}${offer.latest ? ` · ${dateTime(offer.latest.collected_at)}` : ' · Ainda sem contagem'}</div>${chart(offer.history, offer.id)}${offer.last_error ? `<div class="card-error">${esc(offer.last_error)}${offer.last_attempt ? `<br>Última tentativa: ${dateTime(offer.last_attempt)}` : ''}</div>` : ''}<div class="card-footer"><button class="text-button" data-action="history">↗ Ver histórico</button><div><button class="text-button" data-action="refresh" ${busy ? 'disabled' : ''}>↻ ${busy ? 'Consultando' : 'Atualizar'}</button><button class="text-button" data-action="rename" aria-label="Renomear ${esc(offer.name)}">Editar</button><button class="text-button delete" data-action="delete" aria-label="Excluir ${esc(offer.name)}">Excluir</button></div></div></article>`;
}
function render() {
  const search = $('#search').value.toLocaleLowerCase('pt-BR').trim();
  const filtered = offers.filter(offer => offer.name.toLocaleLowerCase('pt-BR').includes(search));
  $('#metric-offers').textContent = number(offers.length);
  $('#nav-count').textContent = offers.length;
  $('#offer-count').textContent = offers.length;
  const counted = offers.filter(offer => offer.latest);
  const approximate = counted.some(offer => offer.latest.precision !== 'exact');
  $('#metric-ads').textContent = counted.length ? `${approximate ? '≈ ' : ''}${number(counted.reduce((sum, offer) => sum + offer.latest.count, 0))}` : '—';
  $('#metric-ads').title = `${counted.length} de ${offers.length} ofertas com contagem. As datas da última consulta podem variar.`;
  const comparable = offers.filter(offer => offer.delta !== null);
  $('#metric-delta').textContent = comparable.length ? signed(comparable.reduce((sum, offer) => sum + offer.delta, 0)) : '—';
  $('#metric-delta').title = `${comparable.length} ofertas com pelo menos dois dias registrados. Mudanças nas contagens aproximadas também são estimativas.`;
  $('#empty').hidden = offers.length > 0;
  $('#no-results').hidden = !(offers.length && !filtered.length);
  $('#offer-list').innerHTML = filtered.map(card).join('');
  $('#refresh-all').disabled = !offers.length || offers.every(offer => ['queued', 'updating'].includes(offer.state));
  renderEvolution();
  if ($('#history-dialog').open && selection) renderHistory();
}
async function load() {
  if (loading || !authenticated) return;
  loading = true;
  try {
    const data = await api('/api/offers');
    offers = data.offers;
    timeZone = data.schedule.timeZone;
    $('#schedule-zone').textContent = `${timeZone === 'America/Fortaleza' ? 'Horário de Fortaleza' : timeZone}${data.schedule.platform === 'vercel' ? ' · Vercel Cron' : ' · servidor ativo'}`;
    $('#schedule-time').textContent = data.schedule.platform === 'vercel' ? '~09:00' : '09:00';
    $('#schedule-zone').title = data.schedule.platform === 'vercel' ? 'No plano Hobby, a Vercel pode executar o cron entre 09h e 10h de Fortaleza.' : '';
    $('#connection-error').hidden = true;
    render();
  } catch (error) {
    $('#connection-error').textContent = `Não foi possível carregar as ofertas. ${error.message}`;
    $('#connection-error').hidden = false;
  } finally { loading = false; }
}
function openCreate() {
  $('#offer-form').reset();
  $('#form-error').hidden = true;
  $('#offer-dialog').showModal();
}
$('#new-offer').addEventListener('click', openCreate);
$('#empty-add').addEventListener('click', openCreate);
for (const button of document.querySelectorAll('.close-dialog')) button.addEventListener('click', () => $('#offer-dialog').close());
$('#search').addEventListener('input', render);
$('#offer-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type=submit]');
  button.disabled = true;
  $('#form-error').hidden = true;
  try {
    const created = await api('/api/offers', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    $('#offer-dialog').close();
    toast(created.last_error || (created.latest ? 'Oferta cadastrada e primeira contagem salva.' : 'Oferta cadastrada. A primeira consulta está na fila.'));
    await load();
  } catch (error) { $('#form-error').textContent = error.message; $('#form-error').hidden = false; }
  finally { button.disabled = false; }
});
$('#refresh-all').addEventListener('click', async () => {
  $('#refresh-all').disabled = true;
  try { const { queued, completed } = await api('/api/refresh', { method: 'POST', body: '{}' }); toast(completed ? `Consulta de ${queued} oferta(s) finalizada. Confira os resultados.` : `${queued} oferta(s) adicionada(s) à fila de atualização.`); }
  catch (error) { toast(error.message); }
  await load();
});
function renderHistory() {
  const offer = offers.find(item => item.id === selection);
  if (!offer) { $('#history-dialog').close(); return; }
  $('#history-title').textContent = offer.name;
  $('#history-chart').innerHTML = createDailyChart(offer.history, { days: 0, today: todayInZone(), width: Math.min(650, innerWidth - 80), id: 'history' }).html;
  $('#history-body').innerHTML = offer.history.length ? [...offer.history].reverse().map((snapshot, index, array) => {
    const previous = array[index + 1];
    return `<tr><td>${day(snapshot.day)}</td><td title="${esc(snapshot.label)}">${countLabel(snapshot)}</td><td>${previous ? signed(snapshot.count - previous.count) : '—'}</td><td>${dateTime(snapshot.collected_at)}</td></tr>`;
  }).join('') : '<tr><td colspan="4">Nenhuma consulta bem-sucedida ainda.</td></tr>';
}
$('#offer-list').addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const offer = offers.find(item => item.id === button.closest('[data-id]').dataset.id);
  if (!offer) return;
  selection = offer.id;
  if (button.dataset.action === 'history') { renderHistory(); $('#history-dialog').showModal(); }
  if (button.dataset.action === 'refresh') {
    button.disabled = true;
    try { const result = await api(`/api/offers/${offer.id}/refresh`, { method: 'POST', body: '{}' }); toast(result.completed ? (result.offer?.last_error || 'Contagem atualizada e salva no histórico.') : 'Consulta adicionada à fila.'); } catch (error) { toast(error.message); }
    await load();
  }
  if (button.dataset.action === 'rename') {
    $('#rename-form').elements.name.value = offer.name;
    $('#rename-error').hidden = true;
    $('#rename-dialog').showModal();
  }
  if (button.dataset.action === 'delete') {
    $('#delete-description').textContent = `Você vai excluir “${offer.name}”.`;
    $('#delete-dialog').showModal();
  }
});
$('#close-history').addEventListener('click', () => $('#history-dialog').close());
$('#close-rename').addEventListener('click', () => $('#rename-dialog').close());
$('#rename-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('[type=submit]');
  button.disabled = true;
  try {
    await api(`/api/offers/${selection}`, { method: 'PATCH', body: JSON.stringify({ name: event.currentTarget.elements.name.value }) });
    $('#rename-dialog').close();
    await load();
  } catch (error) { $('#rename-error').textContent = error.message; $('#rename-error').hidden = false; }
  finally { button.disabled = false; }
});
for (const id of ['#close-delete', '#cancel-delete']) $(id).addEventListener('click', () => $('#delete-dialog').close());
$('#confirm-delete').addEventListener('click', async () => {
  $('#confirm-delete').disabled = true;
  try { await api(`/api/offers/${selection}`, { method: 'DELETE', body: '{}' }); $('#delete-dialog').close(); toast('Oferta excluída.'); await load(); }
  catch (error) { toast(error.message); }
  finally { $('#confirm-delete').disabled = false; }
});
$('#today').textContent = new Intl.DateTimeFormat('pt-BR', { timeZone, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
$('#login-dialog').addEventListener('cancel', event => event.preventDefault());
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  const password = event.currentTarget.elements.password.value;
  button.disabled = true;
  $('#login-error').hidden = true;
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ password }) });
    event.target.reset();
    authenticated = true;
    $('#logout').hidden = false;
    $('#login-dialog').close();
    await load();
  } catch (error) { $('#login-error').textContent = error.message; $('#login-error').hidden = false; }
  finally { button.disabled = false; }
});
$('#logout').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST', body: '{}' }); offers = []; render(); showLogin(); }
  catch (error) { toast(error.message); }
});
try {
  const session = await api('/api/session');
  authenticated = session.authenticated;
  $('#logout').hidden = !session.required;
  if (authenticated) await load(); else showLogin();
} catch (error) { $('#connection-error').textContent = error.message; $('#connection-error').hidden = false; }
setInterval(load, 5000);
