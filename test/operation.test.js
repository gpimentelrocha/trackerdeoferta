import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { createStore } from '../src/store.js';
import { createCloudStore } from '../src/store-libsql.js';
import { importLocalData } from '../src/import-data.js';
import { createApp } from '../src/app.js';

const library='https://www.facebook.com/ads/library/?country=BR&view_all_page_id=123456';
for (const cloud of [false,true]) test(`${cloud?'Turso':'SQLite'}: operação persiste, reabre e exclui materiais sem alterar ofertas monitoradas`,async()=>{
  const directory=mkdtempSync(join(tmpdir(),'operation-'));
  const path=join(directory,'db.sqlite');
  const open=()=>cloud ? createCloudStore({client:createClient({url:'file:'+path})}) : createStore(path);
  let store;
  try {
    store=await open();
    const tracked=await store.create('Oferta monitorada',library);
    const own=await store.operation.create({name:'Minha oferta',niche:'Beleza',notes:'Minha promessa\nMeu mecanismo',status:'production'});
    const other=await store.operation.create({name:'Outra oferta'});
    for (const title of ['Material 1','Material 2','Material 3']) {
      await store.operation.createMaterial(own.id,{title,kind:'copy',content:'Texto original\n'.repeat(1300),angle:'Prova social',format:'UGC',url:'https://example.com/video',status:'ready'});
    }
    const material=(await store.operation.materials(own.id)).find(item=>item.kind==='copy');
    assert.equal(await store.operation.updateMaterial(other.id,material.id,{title:'Troca indevida'}),null);
    assert.equal(await store.operation.removeMaterial(other.id,material.id),false);
    await store.operation.updateMaterial(own.id,material.id,{content:'Nova versão',script:'Gancho\n  Cena 1\n',status:'winner'});
    await store.operation.update(own.id,{sales_url:'https://example.com/vendas'});
    // Os três tipos retirados continuam visíveis e editáveis como copys.
    const original=await store.operation.materials(own.id);
    for (const [index,legacyKind] of ['script','creative','angle'].entries()) {
      if (cloud) await store.client.execute({sql:'UPDATE own_materials SET kind=? WHERE id=?',args:[legacyKind,original[index].id]});
      else store.db.prepare('UPDATE own_materials SET kind=? WHERE id=?').run(legacyKind,original[index].id);
    }
    store.close(); store=await open();
    assert.equal((await store.get(tracked.id)).name,'Oferta monitorada');
    assert.equal((await store.get(tracked.id)).history.length,0);
    const persisted=await store.operation.get(own.id);
    assert.equal(persisted.notes,'Minha promessa\nMeu mecanismo');
    assert.equal(persisted.sales_url,'https://example.com/vendas');
    const materials=await store.operation.materials(own.id);
    assert.equal(materials.length,3);
    assert.equal(materials.find(item=>item.id===material.id).content,'Nova versão');
    assert.equal(materials.find(item=>item.id===material.id).kind,'copy');
    assert.equal(materials.find(item=>item.id===material.id).script,'Gancho\n  Cena 1\n');
    const summary=(await store.operation.list()).find(item=>item.id===own.id);
    assert.equal(summary.material_count,3);
    assert.ok(materials.every(item=>item.kind==='copy'));
    assert.ok(materials.every(item=>item.angle==='Prova social' && item.format==='UGC' && item.url==='https://example.com/video'));
    await store.operation.remove(own.id);
    assert.equal((await store.operation.materials(own.id)).length,0);
    assert.ok(await store.operation.get(other.id));
    assert.ok(await store.get(tracked.id));
  } finally {store?.close();rmSync(directory,{recursive:true,force:true});}
});

test('API: ofertas próprias não consultam Facebook; valida entradas, preserva textos longos e isola materiais',async()=>{
  const store=await createCloudStore({client:createClient({url:'file::memory:'})});
  let collected=0;
  const collector={initial:()=>{collected++;},enqueue:()=>{},tick:()=>0};
  const server=createApp(store,collector).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(path,method='GET',body)=>fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  try {
    const created=await request('/api/my-offers','POST',{name:'Minha oferta',niche:'Renda extra'});
    assert.equal(created.status,201);
    const own=await created.json(), path='/api/my-offers/'+own.id;
    for (let i=0;i<11;i++) assert.equal((await request('/api/my-offers','POST',{name:'Oferta '+i})).status,201);
    assert.equal((await (await request('/api/my-offers')).json()).offers.length,12);
    const text='Copy com acentuação e quebras de linha.\n'.repeat(600);
    const response=await request(path+'/materials','POST',{title:'Copy principal',content:text,kind:'copy',url:'https://example.com/file?a=1&b=2'});
    assert.equal(response.status,201);
    const material=await response.json();
    assert.equal(material.content,text);
    assert.equal(material.script,'');
    assert.equal((await request(path+'/materials/'+material.id,'PATCH',{script:'  Gancho\nCena 1\n'})).status,200);
    assert.equal((await request(path+'/materials/'+material.id,'PATCH',{format:'Imagem estática',angle:'Curiosidade'})).status,200);
    for (const invalid of [{name:''},{name:'x'.repeat(101)},{status:'unknown'},{sales_url:'javascript:alert(1)'},{notes:{html:'<b>x</b>'}}]) assert.equal((await request(path,'PATCH',invalid)).status,400);
    for (const invalid of [{title:''},{kind:'invalid'},{kind:'script'},{kind:'creative'},{kind:'angle'},{status:'unknown'},{content:'x'.repeat(30001)},{script:'x'.repeat(30001)},{script:{}},{url:'data:text/html,hi'},{url:'https://user:pass@example.com'}]) assert.equal((await request(path+'/materials/'+material.id,'PATCH',invalid)).status,400);
    assert.equal((await request('/api/my-offers/missing/materials','POST',{title:'Orfão'})).status,404);
    assert.equal((await request('/api/my-offers/missing/materials/'+material.id,'PATCH',{title:'Outra oferta'})).status,404);
    assert.equal((await request('/api/my-offers/missing/materials/'+material.id,'DELETE',{})).status,404);
    const detail=await (await request(path)).json();
    assert.equal(detail.materials[0].content,text);
    assert.equal(detail.materials[0].angle,'Curiosidade');
    assert.equal(detail.materials[0].script,'  Gancho\nCena 1\n');
    const cleared=await request(path+'/materials/'+material.id,'PATCH',{script:''});
    assert.equal(cleared.status,200);
    assert.equal((await cleared.json()).script,'');
    const large=await request(path+'/materials','POST',{title:'Copy e roteiro longos',content:'漢'.repeat(30000),script:'字'.repeat(30000)});
    assert.equal(large.status,201);
    const both=await large.json();
    assert.equal(both.script,'字'.repeat(30000));
    assert.equal(both.content,'漢'.repeat(30000));
    assert.equal((await request(path+'/materials/'+both.id,'DELETE',{})).status,204);
    assert.equal(collected,0);
    assert.equal((await store.list()).length,0);
    assert.equal((await request(path+'/materials/'+material.id,'DELETE',{})).status,204);
    assert.equal((await (await request(path)).json()).materials.length,0);
    assert.equal((await request(path,'DELETE',{})).status,204);
    assert.equal((await request(path)).status,404);
  } finally {await new Promise(resolve=>server.close(resolve));store.close();}
});


for (const cloud of [false,true]) test(`${cloud?'Turso':'SQLite'}: migra materiais antigos com roteiro opcional e preserva a copy`,async()=>{
  const directory=mkdtempSync(join(tmpdir(),'script-migration-'));
  const path=join(directory,'old.sqlite');
  let store=createStore(path);
  let imported;
  try {
    const own=await store.operation.create({name:'Oferta existente'});
    const old=await store.operation.createMaterial(own.id,{title:'Copy existente',content:'Minha copy antiga\nSem alterações'});
    // Reproduz o banco da versão anterior, que ainda não tinha a coluna.
    store.db.exec('ALTER TABLE own_materials DROP COLUMN script');
    store.close(); store=null;
    if (cloud) {
      imported=await createCloudStore({client:createClient({url:'file::memory:'})});
      await importLocalData(imported,path);
      assert.equal((await imported.operation.materials(own.id))[0].script,'');
      assert.equal((await imported.operation.materials(own.id))[0].content,old.content);
    }
    const open=()=>cloud ? createCloudStore({client:createClient({url:'file:'+path})}) : createStore(path);
    store=await open();
    const migrated=(await store.operation.materials(own.id))[0];
    assert.equal(migrated.script,'');
    assert.equal(migrated.content,old.content);
    await store.operation.updateMaterial(own.id,old.id,{script:'Meu roteiro\n  Cena 1\n'});
    store.close(); store=await open();
    const saved=(await store.operation.materials(own.id))[0];
    assert.equal(saved.script,'Meu roteiro\n  Cena 1\n');
    assert.equal(saved.content,old.content);
  } finally {store?.close();imported?.close();rmSync(directory,{recursive:true,force:true});}
});
