import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createStore } from '../src/store.js';
import { createCloudStore } from '../src/store-libsql.js';
import { createProductionHandler } from '../src/production.js';

const url = 'https://www.facebook.com/ads/library/?country=BR&view_all_page_id=982937401569675';
const legacySchema = [
  "CREATE TABLE offers(id TEXT PRIMARY KEY,name TEXT NOT NULL,url TEXT NOT NULL,created_at TEXT NOT NULL,last_attempt TEXT,last_error TEXT,state TEXT NOT NULL DEFAULT 'pending',scheduled_day TEXT,lease_token TEXT,lease_until TEXT)",
  'CREATE TABLE snapshots(id INTEGER PRIMARY KEY,offer_id TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,day TEXT NOT NULL,count INTEGER NOT NULL,precision TEXT NOT NULL,label TEXT NOT NULL,collected_at TEXT NOT NULL,UNIQUE(offer_id,day))'
];
const legacyOffer = { sql: 'INSERT INTO offers(id,name,url,created_at,state) VALUES(?,?,?,?,?)', args: ['legacy', 'Oferta já cadastrada', url, '2026-10-15T12:00:00Z', 'ok'] };
const legacySnapshot = { sql: 'INSERT INTO snapshots(offer_id,day,count,precision,label,collected_at) VALUES(?,?,?,?,?,?)', args: ['legacy', '2026-10-15', 123, 'approximate', '~123 resultados', '2026-10-15T12:00:00Z'] };

test('SQLite existente recebe novos campos sem perder ofertas ou histórico; reabrir é idempotente', () => {
  const directory = mkdtempSync(join(tmpdir(), 'offer-migration-'));
  const path = join(directory, 'old.sqlite');
  const raw = new DatabaseSync(path);
  for (const statement of legacySchema) raw.exec(statement);
  raw.prepare(legacyOffer.sql).run(...legacyOffer.args);
  raw.prepare(legacySnapshot.sql).run(...legacySnapshot.args);
  raw.close();
  let store;
  try {
    store = createStore(path);
    const old = store.get('legacy');
    assert.equal(old.name, 'Oferta já cadastrada');
    assert.equal(old.latest.count, 123);
    assert.equal(old.history[0].day, '2026-10-15');
    assert.equal(old.offer_type, null);
    assert.equal(old.niche, null);
    assert.equal(old.funnel, null);
    assert.equal(old.market, null);
    store.update('legacy', { offer_type: 'info', niche: 'Emagrecimento', funnel: 'X1', market: 'BR' });
    store.close();
    store = createStore(path);
    const updated = store.get('legacy');
    assert.equal(updated.offer_type, 'info');
    assert.equal(updated.niche, 'Emagrecimento');
    assert.equal(updated.funnel, 'X1');
    assert.equal(updated.market, 'BR');
    assert.equal(updated.latest.count, 123);
    assert.equal(updated.history.length, 1);
  } finally { store?.close(); rmSync(directory, {recursive:true,force:true}); }
});

test('libSQL migra banco antigo, persiste classificação e mantém histórico em inicializações seguintes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cloud-offer-migration-'));
  const databaseUrl = 'file:' + join(directory, 'cloud.sqlite');
  let client = createClient({ url: databaseUrl });
  await client.batch([...legacySchema,legacyOffer,legacySnapshot,
    'ALTER TABLE offers ADD COLUMN offer_type TEXT',
    'ALTER TABLE offers ADD COLUMN niche TEXT',
    'ALTER TABLE offers ADD COLUMN funnel TEXT',
    "UPDATE offers SET offer_type='info', niche='Renda extra', funnel='VSL'"
  ], 'write');
  let store;
  try {
    store = await createCloudStore({ client });
    const migrated = await store.get('legacy');
    assert.equal(migrated.funnel, 'VSL');
    assert.equal(migrated.niche, 'Renda extra');
    assert.equal(migrated.offer_type, 'info');
    assert.equal(migrated.market, null);
    await store.update('legacy', {offer_type:'drop', niche:'Prosperidade', funnel:'X1', market:'LATAM'});
    store.close();
    client = createClient({url:databaseUrl});
    store = await createCloudStore({client});
    const old = (await store.list())[0];
    assert.equal(old.offer_type, 'drop');
    assert.equal(old.niche, 'Prosperidade');
    assert.equal(old.funnel, 'X1');
    assert.equal(old.market, 'LATAM');
    assert.equal(old.latest.count, 123);
    assert.equal(old.history.length, 1);
  } finally { store?.close(); rmSync(directory, {recursive:true,force:true}); }
});

test('API de produção cadastra e edita tipo, nicho personalizado, mercados e todos os formatos sem refazer histórico', async () => {
  let store, collected = 0;
  const handler = createProductionHandler({
    getEnvironment:()=>({TURSO_DATABASE_URL:'libsql://test.turso.io',TURSO_AUTH_TOKEN:'test-only'}),
    openStore:async()=>{ store=await createCloudStore({client:createClient({url:'file::memory:'})}); return store; },
    collect:async()=>{collected++;return {count:55,precision:'exact',label:'55 resultados'};}
  });
  const server = createServer(handler).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method, body)=>fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  try {
    const response = await request('/api/offers','POST',{name:'Oferta classificada',url,offer_type:'info',niche:' Renda extra ',funnel:'QUIZ + VSL',market:' br '});
    assert.equal(response.status,201);
    const created = await response.json();
    assert.equal(created.offer_type,'info');
    assert.equal(created.niche,'Renda extra');
    assert.equal(created.funnel,'QUIZ + VSL');
    assert.equal(created.market,'BR');
    assert.equal(created.url,url);
    assert.equal(created.latest.count,55);
    for(const funnel of ['TSL','VSL','QUIZ','QUIZ + VSL','X1']) {
      const changed = await request('/api/offers/'+created.id,'PATCH',{offer_type:'drop',niche:'Um nicho personalizado & específico',funnel});
      assert.equal(changed.status,200);
      const data = await changed.json();
      assert.equal(data.funnel,funnel);
      assert.equal(data.offer_type,'drop');
      assert.equal(data.niche,'Um nicho personalizado & específico');
      assert.equal(data.history.length,1);
      assert.equal(data.latest.count,55);
    }
    for (const market of ['BR', 'LATAM', 'EUA']) {
      const changed = await request('/api/offers/'+created.id,'PATCH',{market});
      assert.equal(changed.status,200);
      const data = await changed.json();
      assert.equal(data.market,market);
      assert.equal(data.url,url);
      assert.equal(data.history.length,1);
      assert.equal(data.latest.count,55);
    }
    assert.equal(collected,1);
    for(const bad of [{offer_type:'affiliate'},{funnel:'INVALID'},{market:'DE'},{market:['BR']},{niche:'x'.repeat(81)},{offer_type:{value:'info'}}]) {
      assert.equal((await request('/api/offers','POST',{name:'Inválida',url,...bad})).status,400);
      assert.equal((await request('/api/offers/'+created.id,'PATCH',bad)).status,400);
    }
    assert.equal((await store.list()).length,1);
    const renamed = await request('/api/offers/'+created.id,'PATCH',{name:'Mesmo histórico'});
    assert.equal(renamed.status,200);
    const preserved = await renamed.json();
    assert.equal(preserved.funnel,'X1');
    assert.equal(preserved.market,'EUA');
    assert.equal(collected,1);
  } finally { await new Promise(resolve=>server.close(resolve));store?.close(); }
});
