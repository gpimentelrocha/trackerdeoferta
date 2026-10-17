import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, localDate } from '../src/store.js';
import { createCollector } from '../src/collector.js';
import { createApp } from '../src/app.js';
import { parseCount, validateLibraryUrl } from '../src/library.js';

const url = 'https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&view_all_page_id=982937401569675';
const result = count => ({ count, precision: 'exact', label: `${count} resultados` });

test('reconhece os totais publicados sem contar cartões nem inventar zero', () => {
  for (const [text, count, precision] of [
    ['~1.234 resultados', 1234, 'approximate'], ['About 2,300 results', 2300, 'approximate'],
    ['Mais de 50.000 anúncios', 50000, 'lower_bound'], ['0 resultados', 0, 'exact'],
    ['Nenhum anúncio encontrado.', 0, 'exact'], ['No results found', 0, 'exact'],
    ['Facebook\n238 results\nBiblioteca', 238, 'exact'], ['1 234 anúncios', 1234, 'exact']
  ]) assert.deepEqual(parseCount(text), { count, precision, label: text.split('\n').find(line => /results$/.test(line)) || text });
  for (const text of ['Login', 'Biblioteca de anúncios', '12 anúncios por página', '1.2K results', '1.2 results', 'ID da biblioteca: 1234']) assert.equal(parseCount(text), null);
});

test('valida a origem e remove o anúncio individual, preservando filtros', () => {
  const normalized = new URL(validateLibraryUrl(url + '&id=123&sort_data[direction]=desc'));
  assert.equal(normalized.searchParams.get('id'), null);
  assert.equal(normalized.searchParams.get('active_status'), 'active');
  assert.equal(normalized.searchParams.get('sort_data[direction]'), 'desc');
  for (const invalid of ['http://facebook.com/ads/library/?q=x', 'https://facebook.com.evil.test/ads/library/?q=x', 'https://user:pass@facebook.com/ads/library/?q=x', 'https://facebook.com:8080/ads/library/?q=x', 'https://facebook.com/ads/library/?id=123', 'https://127.0.0.1/ads/library/?q=x']) assert.throws(() => validateLibraryUrl(invalid));
});

test('persiste dados, substitui somente o mesmo dia e preserva histórico após falha', () => {
  const path = mkdtempSync(join(tmpdir(), 'tracker-db-'));
  let store;
  try {
    store = createStore(join(path, 'tracker.sqlite'));
    const offer = store.create('Oferta real', url);
    store.db.prepare('INSERT INTO snapshots(offer_id,day,count,precision,label,collected_at) VALUES(?,?,?,?,?,?)').run(offer.id, '2025-01-01', 10, 'exact', '10 resultados', '2025-01-01T12:00:00Z');
    store.success(offer.id, result(25));
    store.success(offer.id, result(30));
    assert.equal(store.get(offer.id).history.length, 2);
    assert.equal(store.get(offer.id).delta, 20);
    store.fail(offer.id, 'Bloqueado pelo Facebook');
    assert.equal(store.get(offer.id).latest.count, 30);
    assert.equal(store.get(offer.id).state, 'error');
    store.close();
    store = createStore(join(path, 'tracker.sqlite'));
    assert.equal(store.get(offer.id).latest.count, 30);
    assert.equal(store.get(offer.id).history.length, 2);
    assert.equal(store.remove(offer.id), true);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM snapshots').get().n, 0);
  } finally { store?.close(); rmSync(path, { recursive: true, force: true }); }
});

test('agenda uma consulta diária após 09h e não repete após reinício', async () => {
  const path = mkdtempSync(join(tmpdir(), 'tracker-schedule-'));
  let store = createStore(join(path, 'tracker.sqlite'));
  let calls = 0;
  let collector = createCollector(store, async () => { calls++; return result(20); });
  const offer = store.create('Agendada', url);
  collector.tick(new Date('2026-10-17T11:59:00Z'));
  assert.equal(calls, 0);
  collector.tick(new Date('2026-10-17T12:00:00Z'));
  collector.tick(new Date('2026-10-17T12:01:00Z'));
  await collector.idle();
  assert.equal(calls, 1);
  await collector.close(); store.close();
  store = createStore(join(path, 'tracker.sqlite'));
  collector = createCollector(store, async () => { calls++; return result(30); });
  collector.tick(new Date('2026-10-17T20:00:00Z'));
  await collector.idle();
  assert.equal(calls, 1);
  collector.tick(new Date('2026-10-18T20:00:00Z'));
  await collector.idle();
  assert.equal(calls, 2);
  assert.equal(store.get(offer.id).scheduled_day, '2026-10-18');
  await collector.close(); store.close(); rmSync(path, { recursive: true, force: true });
});

test('fila deduplica consultas e falhas não sobrescrevem a contagem', async () => {
  const store = createStore(':memory:');
  let release;
  const collector = createCollector(store, () => new Promise(resolve => { release = resolve; }));
  const offer = store.create('Fila', url);
  assert.equal(collector.enqueue(offer.id), true);
  assert.equal(collector.enqueue(offer.id), false);
  release(result(123));
  await collector.idle();
  assert.equal(store.get(offer.id).latest.count, 123);
  await collector.close();
  const failed = createCollector(store, async () => { throw new Error('Login necessário'); });
  failed.enqueue(offer.id);
  await failed.idle();
  assert.equal(store.get(offer.id).latest.count, 123);
  assert.equal(store.get(offer.id).last_error, 'Login necessário');
  await failed.close(); store.close();
});

test('não salva valores inválidos retornados pela coleta', async () => {
  const store = createStore(':memory:');
  const collector = createCollector(store, async () => result(-1));
  const offer = store.create('Inválida', url);
  collector.enqueue(offer.id);
  await collector.idle();
  assert.equal(store.get(offer.id).latest, null);
  assert.equal(store.get(offer.id).state, 'error');
  await collector.close(); store.close();
});

test('API cadastra, consulta, renomeia e exclui; rejeita links e requisições externas', async () => {
  const store = createStore(':memory:');
  const collector = createCollector(store, async () => result(42));
  const server = createApp(store, collector).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = 'GET', body, headers = {}) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    let response = await request('/api/offers', 'POST', { name: '  Derrete gordura insulina  ', url });
    assert.equal(response.status, 201);
    const created = await response.json();
    assert.equal(created.name, 'Derrete gordura insulina');
    await collector.idle();
    response = await request('/api/offers');
    const data = await response.json();
    assert.equal(data.offers[0].latest.count, 42);
    assert.equal(data.offers[0].history[0].day, localDate());
    assert.equal(data.schedule.hour, 9);
    assert.equal((await request(`/api/offers/${created.id}`, 'PATCH', { name: 'Novo nome' })).status, 200);
    assert.equal(store.get(created.id).name, 'Novo nome');
    assert.equal((await request('/api/offers', 'POST', { name: '', url })).status, 400);
    assert.equal((await request('/api/offers', 'POST', { name: 'Teste', url: 'https://evil.test' })).status, 400);
    assert.equal((await request('/api/offers', 'POST', { name: 'Teste', url }, { Origin: 'https://evil.test' })).status, 403);
    assert.equal((await request('/api/offers/inexistente/refresh', 'POST', {})).status, 404);
    assert.equal((await request(`/api/offers/${created.id}/refresh`, 'POST', {})).status, 202);
    await collector.idle();
    assert.equal(store.get(created.id).history.length, 1);
    assert.equal((await request(`/api/offers/${created.id}`, 'DELETE', {})).status, 204);
    assert.equal(store.list().length, 0);
  } finally { await collector.close(); await new Promise(resolve => server.close(resolve)); store.close(); }
});
