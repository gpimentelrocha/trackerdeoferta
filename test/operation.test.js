import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { createStore } from '../src/store.js';
import { createCloudStore } from '../src/store-libsql.js';
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
    for (const kind of ['copy','script','creative','angle']) {
      await store.operation.createMaterial(own.id,{title:'Material '+kind,kind,content:'Texto original\n'.repeat(1300),angle:'Prova social',format:'UGC',url:'https://example.com/video',status:'ready'});
    }
    const material=(await store.operation.materials(own.id))[0];
    assert.equal(await store.operation.updateMaterial(other.id,material.id,{title:'Troca indevida'}),null);
    assert.equal(await store.operation.removeMaterial(other.id,material.id),false);
    await store.operation.updateMaterial(own.id,material.id,{content:'Nova versão',status:'winner'});
    await store.operation.update(own.id,{sales_url:'https://example.com/vendas'});
    store.close(); store=await open();
    assert.equal((await store.get(tracked.id)).name,'Oferta monitorada');
    assert.equal((await store.get(tracked.id)).history.length,0);
    const persisted=await store.operation.get(own.id);
    assert.equal(persisted.notes,'Minha promessa\nMeu mecanismo');
    assert.equal(persisted.sales_url,'https://example.com/vendas');
    const materials=await store.operation.materials(own.id);
    assert.equal(materials.length,4);
    assert.equal(materials.find(item=>item.id===material.id).content,'Nova versão');
    const summary=(await store.operation.list()).find(item=>item.id===own.id);
    assert.equal(summary.material_count,4);
    assert.equal(summary.creative_count,1);
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
    assert.equal((await request(path+'/materials/'+material.id,'PATCH',{format:'Imagem estática',angle:'Curiosidade'})).status,200);
    for (const invalid of [{name:''},{name:'x'.repeat(101)},{status:'unknown'},{sales_url:'javascript:alert(1)'},{notes:{html:'<b>x</b>'}}]) assert.equal((await request(path,'PATCH',invalid)).status,400);
    for (const invalid of [{title:''},{kind:'invalid'},{status:'unknown'},{content:'x'.repeat(30001)},{url:'data:text/html,hi'},{url:'https://user:pass@example.com'}]) assert.equal((await request(path+'/materials/'+material.id,'PATCH',invalid)).status,400);
    assert.equal((await request('/api/my-offers/missing/materials','POST',{title:'Orfão'})).status,404);
    assert.equal((await request('/api/my-offers/missing/materials/'+material.id,'PATCH',{title:'Outra oferta'})).status,404);
    assert.equal((await request('/api/my-offers/missing/materials/'+material.id,'DELETE',{})).status,404);
    const detail=await (await request(path)).json();
    assert.equal(detail.materials[0].content,text);
    assert.equal(detail.materials[0].angle,'Curiosidade');
    assert.equal(collected,0);
    assert.equal((await store.list()).length,0);
    assert.equal((await request(path+'/materials/'+material.id,'DELETE',{})).status,204);
    assert.equal((await (await request(path)).json()).materials.length,0);
    assert.equal((await request(path,'DELETE',{})).status,204);
    assert.equal((await request(path)).status,404);
  } finally {await new Promise(resolve=>server.close(resolve));store.close();}
});
