import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createCloudStore, MAX_OFFERS } from '../src/store-libsql.js';
import { createStore } from '../src/store.js';
import { importLocalData } from '../src/import-data.js';
import { createServerlessCollector } from '../src/serverless-collector.js';
import { createAuth } from '../src/auth.js';
import { createApp } from '../src/app.js';
const url = 'https://www.facebook.com/ads/library/?country=BR&active_status=active&view_all_page_id=982937401569675';
const result = count => ({ count, precision: 'approximate', label: `~${count} resultados` });
async function database() { return createCloudStore({ client: createClient({ url: 'file::memory:' }) }); }

test('Turso adapter: histórico por dia, atualização e fencing de consultas vencidas', async () => {
  const store = await database();
  try {
    const offer = await store.create('Oferta', url);
    const yesterday = new Date('2026-10-16T15:00:00Z');
    const today = new Date('2026-10-17T15:00:00Z');
    const oldToken = await store.claim(offer.id, { now: yesterday });
    assert.equal(await store.claim(offer.id, { now: yesterday }), null);
    const newToken = await store.claim(offer.id, { now: today });
    assert.ok(newToken);
    assert.equal(await store.success(offer.id, oldToken, result(999), yesterday), false);
    assert.equal(await store.success(offer.id, newToken, result(30), today), true);
    let token = await store.claim(offer.id, { now: new Date('2026-10-18T15:00:00Z') });
    await store.success(offer.id, token, result(40), new Date('2026-10-18T15:00:00Z'));
    token = await store.claim(offer.id);
    await store.fail(offer.id, token, 'Acesso negado');
    const updated = await store.get(offer.id);
    assert.equal(updated.history.length, 2);
    assert.equal(updated.latest.count, 40);
    assert.equal(updated.delta, 10);
    assert.equal(updated.last_error, 'Acesso negado');
    assert.equal('lease_token' in updated, false);
    await store.remove(offer.id);
    assert.equal((await store.client.execute('SELECT COUNT(*) AS n FROM snapshots')).rows[0].n, 0);
  } finally { store.close(); }
});

test('instâncias serverless compartilham lease e cron não duplica a mesma data', async () => {
  const store = await database();
  const offer = await store.create('Cron', url);
  let calls = 0, release;
  const a = createServerlessCollector(store, async () => { calls++; await new Promise(resolve => { release = resolve; }); return result(72); });
  const b = createServerlessCollector(store, async () => { calls++; return result(99); });
  try {
    const running = a.enqueue(offer.id);
    while (!release) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(await b.enqueue(offer.id), false);
    release();
    await running;
    assert.equal(calls, 1);
    const date = new Date('2026-10-17T12:00:00Z');
    assert.equal(await b.tick(new Date('2026-10-17T11:59:00Z')), 0);
    assert.equal(await b.tick(date), 1);
    assert.equal(await a.tick(date), 0);
    assert.equal(calls, 2);
  } finally { store.close(); }
});

test('teto de ofertas garante o orçamento da função cron e não remove dados', async () => {
  const store = await database();
  try {
    for (let i=0;i<MAX_OFFERS;i++) await store.create('Oferta '+i, url);
    await assert.rejects(store.create('Excedente', url), /até 10 ofertas/);
    assert.equal((await store.list()).length, MAX_OFFERS);
  } finally { store.close(); }
});

test('importação preserva histórico original e recusa sobrescrever Turso com dados', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tracker-import-'));
  const path = join(directory, 'source.sqlite');
  const source = createStore(path);
  const offer = source.create('Original', url, {offer_type:'info',niche:'Prosperidade',funnel:'X1',market:'EUA',sales_url:'https://example.com/vendas',checkout_url:'https://example.com/checkout',backredirect_url:'https://example.com/voltar',upsell_url:'https://example.com/upsell'});
  source.success(offer.id, result(290));
  const own = await source.operation.create({name:'Minha operação',notes:'Notas da oferta'});
  await source.operation.createMaterial(own.id,{kind:'script',title:'Roteiro original',content:'Gancho e cenas',script:'Roteiro separado\nCena 1',angle:'Curiosidade'});
  source.close();
  const destination = await database();
  try {
    assert.deepEqual(await importLocalData(destination, path), { offers: 1, snapshots: 1, ownOffers:1, materials:1 });
    assert.equal((await destination.get(offer.id)).latest.count, 290);
    assert.equal((await destination.operation.get(own.id)).notes,'Notas da oferta');
    assert.equal((await destination.operation.materials(own.id))[0].content,'Gancho e cenas');
    assert.equal((await destination.operation.materials(own.id))[0].script,'Roteiro separado\nCena 1');
    assert.equal((await destination.get(offer.id)).offer_type, 'info');
    assert.equal((await destination.get(offer.id)).niche, 'Prosperidade');
    assert.equal((await destination.get(offer.id)).funnel, 'X1');
    assert.equal((await destination.get(offer.id)).market, 'EUA');
    for (const key of ['sales_url','checkout_url','backredirect_url','upsell_url']) assert.equal((await destination.get(offer.id))[key], offer[key]);
    await assert.rejects(importLocalData(destination, path), /deve estar vazio/);
    assert.equal((await destination.list()).length, 1);
    const verify = createStore(path);
    assert.equal(verify.get(offer.id).latest.count, 290);
    verify.close();
  } finally { destination.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('API serverless aguarda a coleta, protege histórico e exige token separado para o cron', async () => {
  const store = await database();
  const collector = createServerlessCollector(store, async () => result(57));
  const password = randomBytes(20).toString('hex');
  const cronSecret = randomBytes(32).toString('hex');
  const auth = createAuth({ password, cronSecret, sessionSecret: randomBytes(32).toString('hex'), required: true, secure: false });
  const server = createApp(store, collector, { auth, platform: 'vercel' }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, { method='GET', body, headers={} }={}) => fetch(base+path, { method, headers:{ 'Content-Type':'application/json', ...headers }, body:body === undefined ? undefined : JSON.stringify(body) });
  try {
    assert.equal((await request('/api/offers')).status, 401);
    assert.equal((await request('/api/session')).status, 200);
    assert.equal((await request('/api/login', {method:'POST', body:{password:'errada'}})).status,401);
    const login = await request('/api/login', {method:'POST', body:{password}});
    assert.equal(login.status,200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    const created = await request('/api/offers',{method:'POST',body:{name:'Na nuvem',url},headers:{Cookie:cookie}});
    assert.equal(created.status,201);
    const offer = await created.json();
    assert.equal(offer.state,'ok');
    assert.equal(offer.latest.count,57);
    const refresh = await request(`/api/offers/${offer.id}/refresh`,{method:'POST',body:{},headers:{Cookie:cookie}});
    assert.equal(refresh.status,200);
    assert.equal((await refresh.json()).completed,true);
    assert.equal((await request('/api/cron',{headers:{Cookie:cookie}})).status,401);
    assert.equal((await request('/api/cron',{headers:{Authorization:'Bearer '+cronSecret}})).status,200);
    assert.equal((await request('/api/offers',{headers:{Cookie:cookie+'forged'}})).status,401);
    assert.equal((await request('/api/logout',{method:'POST',body:{},headers:{Cookie:cookie}})).status,204);
  } finally { await new Promise(resolve => server.close(resolve)); store.close(); }
});
