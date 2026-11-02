import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createClient} from '@libsql/client';
import {createStore} from '../src/store.js';
import {createCloudStore} from '../src/store-libsql.js';
import {createApp} from '../src/app.js';
import {importLocalData} from '../src/import-data.js';

for(const cloud of [false,true])test(`${cloud?'Turso':'SQLite'}: opções personalizadas persistem e categorias de despesa funcionam nos lançamentos`,async()=>{
  const dir=mkdtempSync(join(tmpdir(),'custom-options-')),path=join(dir,'db.sqlite');
  const open=()=>cloud?createCloudStore({client:createClient({url:'file:'+path})}):createStore(path);
  let store=await open();
  try{
    const expense=await store.options.create({kind:'expense_category',label:'Pró-labore'});
    const duplicate=await store.options.create({kind:'expense_category',label:' PRO LABORE '});
    assert.equal(expense.value,duplicate.value);
    assert.equal((await store.options.create({kind:'expense_category',label:'anuncios'})).value,'ads');
    for(const [kind,label] of [['niche','Horticultura'],['angle','Um novo começo'],['format','Entrevista de rua']])assert.equal((await store.options.create({kind,label})).value,label);
    const entry=await store.finance.create({type:'expense',category:expense.value,amount_cents:45000,day:'2026-11-02'});
    assert.equal(entry.category,expense.value);
    await store.finance.update(entry.id,{description:'Pró-labore mensal'});
    await assert.rejects(store.finance.create({type:'revenue',category:expense.value,amount_cents:1,day:'2026-11-02'}),{status:400});
    await assert.rejects(store.finance.create({type:'expense',category:'custom_00000000-0000-4000-8000-000000000000',amount_cents:1,day:'2026-11-02'}),{status:400});
    store.close();store=await open();
    const options=await store.options.list();
    assert.equal(options.expense_category.filter(item=>item.custom).length,1);
    assert.equal(options.expense_category.find(item=>item.value===expense.value).label,'Pró-labore');
    assert.ok(options.niche.some(item=>item.value==='Horticultura'));
    assert.ok(options.angle.some(item=>item.value==='Um novo começo'));
    assert.ok(options.format.some(item=>item.value==='Entrevista de rua'));
    assert.equal((await store.finance.list())[0].amount_cents,45000);
    assert.equal((await store.finance.list())[0].category,expense.value);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('API de opções valida grupos e nomes, deduplica gravações concorrentes e mantém as listas atuais',async()=>{
  const store=await createCloudStore({client:createClient({url:'file::memory:'})});
  const server=createApp(store,{}).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=body=>fetch(base+'/api/options',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  try{
    for(const body of [null,{kind:'material_kind',label:'Criativo'},{kind:'expense_category',label:''},{kind:'niche',label:12},{kind:'format',label:'x'.repeat(81)},{kind:'angle',label:'!!!'}])assert.equal((await post(body)).status,400);
    const responses=await Promise.all([post({kind:'expense_category',label:'Contabilidade'}),post({kind:'expense_category',label:'CONTABILIDADE'})]);
    const saved=await Promise.all(responses.map(async response=>{assert.equal(response.status,201);return response.json();}));
    assert.equal(saved[0].value,saved[1].value);
    const response=await fetch(base+'/api/options');assert.equal(response.status,200);
    const {options}=await response.json();
    assert.ok(options.expense_category.some(item=>item.value==='bm'));
    assert.ok(options.niche.some(item=>item.label==='Prosperidade'));
    assert.equal(options.expense_category.filter(item=>item.custom).length,1);
    assert.equal(Object.hasOwn(options,'material_kind'),false);
  }finally{await new Promise(resolve=>server.close(resolve));store.close();}
});
test('importação preserva opções e suas despesas e recusa sobrescrever listas já cadastradas',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'options-import-')),path=join(dir,'source.sqlite');
  const source=createStore(path),target=await createCloudStore({client:createClient({url:'file::memory:'})});
  try{
    const category=await source.options.create({kind:'expense_category',label:'Contabilidade'});
    await source.options.create({kind:'format',label:'Entrevista de rua'});
    await source.finance.create({type:'expense',category:category.value,amount_cents:12345,day:'2026-11-02'});
    await importLocalData(target,path);
    assert.equal((await target.options.list()).expense_category.find(item=>item.value===category.value).label,'Contabilidade');
    assert.equal((await target.finance.list())[0].category,category.value);
    const onlyOptions=await createCloudStore({client:createClient({url:'file::memory:'})});
    try{await onlyOptions.options.create({kind:'niche',label:'Consultoria'});await assert.rejects(importLocalData(onlyOptions,path),/destino deve estar vazio/);}
    finally{onlyOptions.close();}
  }finally{source.close();target.close();rmSync(dir,{recursive:true,force:true});}
});
