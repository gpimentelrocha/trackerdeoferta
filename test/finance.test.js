import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createClient} from '@libsql/client';
import {createStore} from '../src/store.js';
import {createCloudStore} from '../src/store-libsql.js';
import {importLocalData} from '../src/import-data.js';
import {createApp} from '../src/app.js';
import {parseMoney,summarizeEntries,periodRange} from '../public/finance-math.js';

test('financeiro: centavos exatos, valor brasileiro e americano, prejuízo e margem sem faturamento',()=>{
  for(const [input,cents] of [['1.234,56',123456],['1234.56',123456],['R$ 1.234,5',123450],['0,10',10],['1.234',123400]])assert.equal(parseMoney(input),cents);
  for(const input of ['','-1','0','1,234','1.2345','1e3','Infinity','1.000.000.000,01'])assert.throws(()=>parseMoney(input));
  const entries=[{type:'revenue',amount_cents:30,day:'2026-10-31',category:'sales'},{type:'expense',amount_cents:10,day:'2026-10-31',category:'ads'},{type:'expense',amount_cents:20,day:'2026-10-31',category:'proxy'}];
  const result=summarizeEntries(entries);
  assert.equal(result.profit,0);assert.equal(result.margin,0);assert.equal(result.expense,30);assert.equal(result.days.length,1);
  const negative=summarizeEntries(entries.slice(1));assert.equal(negative.profit,-30);assert.equal(negative.margin,null);
  assert.deepEqual(periodRange('month','2026-10-31'),{from:'2026-10-01',to:'2026-10-31'});
  assert.deepEqual(periodRange('7','2026-03-02'),{from:'2026-02-24',to:'2026-03-02'});
  assert.throws(()=>periodRange('custom','2026-10-31','2026-02-30','2026-10-31'));
  assert.throws(()=>periodRange('custom','2026-10-31','2026-11-01','2026-10-31'));
});
for(const cloud of [false,true])test(`${cloud?'Turso':'SQLite'}: financeiro persiste, filtra por data e preserva histórico quando uma oferta é removida`,async()=>{
  const dir=mkdtempSync(join(tmpdir(),'finance-')),path=join(dir,'db.sqlite');
  const open=()=>cloud?createCloudStore({client:createClient({url:'file:'+path})}):createStore(path);
  let store=await open();
  try{
    const own=await store.operation.create({name:'Oferta A'});
    const other=await store.operation.create({name:'Oferta B'});
    const sale=await store.finance.create({offer_id:own.id,type:'revenue',category:'sales',day:'2026-10-31',amount_cents:100000,description:'Vendas'});
    await store.finance.create({offer_id:own.id,type:'expense',category:'ads',day:'2026-10-31',amount_cents:25000});
    await store.finance.create({type:'expense',category:'proxy',day:'2026-10-31',amount_cents:5000});
    await store.finance.create({offer_id:other.id,type:'revenue',category:'sales',day:'2026-09-30',amount_cents:50000});
    store.close();store=await open();
    const all=await store.finance.list(),oct=await store.finance.list({from:'2026-10-01',to:'2026-10-31'});
    assert.equal(all.length,4);assert.equal(oct.length,3);assert.equal(summarizeEntries(oct).profit,70000);
    assert.equal(summarizeEntries(oct.filter(item=>item.offer_id===own.id)).profit,75000);
    await store.operation.update(own.id,{name:'Oferta A editada'});
    assert.equal((await store.finance.list()).find(item=>item.id===sale.id).current_offer_name,'Oferta A editada');
    await store.operation.remove(own.id);
    const preserved=(await store.finance.list()).find(item=>item.id===sale.id);
    assert.equal(preserved.offer_id,null);assert.equal(preserved.offer_name,'Oferta A editada');
    assert.equal(summarizeEntries(await store.finance.list({from:'2026-10-01',to:'2026-10-31'})).profit,70000);
    await store.finance.update(sale.id,{amount_cents:110000});
    assert.equal((await store.finance.get(sale.id)).offer_name,'Oferta A editada');
    assert.equal(await store.finance.remove(sale.id),true);assert.equal(await store.finance.remove(sale.id),false);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('API financeiro: valida valores, categorias, datas, referências e edição parcial sem consultar o Facebook',async()=>{
  const store=await createCloudStore({client:createClient({url:'file::memory:'})});
  const own=await store.operation.create({name:'Oferta'});
  const server=createApp(store,{initial:()=>{throw new Error('Não deve coletar');}}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(path,method='GET',body)=>fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const value={offer_id:own.id,type:'expense',category:'bm',day:'2026-10-31',amount_cents:12345,description:'BM mensal'};
  try{
    for(const bad of [{amount_cents:0},{amount_cents:-1},{amount_cents:1.5},{amount_cents:'100'},{amount_cents:100000000001},{day:'2026-02-30'},{category:'invalid'},{type:'revenue'},{description:[]},{offer_id:{id:'x'}}])assert.equal((await request('/api/finance/entries','POST',{...value,...bad})).status,400);
    assert.equal((await request('/api/finance/entries','POST',{...value,offer_id:'missing'})).status,404);
    const response=await request('/api/finance/entries','POST',value);assert.equal(response.status,201);const created=await response.json();
    const changed=await request('/api/finance/entries/'+created.id,'PATCH',{amount_cents:12346});assert.equal(changed.status,200);assert.equal((await changed.json()).category,'bm');
    assert.equal((await request('/api/finance/entries/'+created.id,'PATCH',{amount_cents:-5})).status,400);
    assert.equal((await request('/api/finance/entries/'+created.id,'PATCH',null)).status,400);
    assert.equal((await request('/api/finance?from=2026-10-31&to=2026-10-01')).status,400);
    assert.equal((await request('/api/finance?from=2026-02-30')).status,400);
    assert.equal((await (await request('/api/finance?from=2026-11-01')).json()).entries.length,0);
    assert.equal((await (await request('/api/finance?from=2026-10-31&to=2026-10-31')).json()).entries[0].amount_cents,12346);
    assert.equal((await request('/api/finance/entries/missing','PATCH',{amount_cents:1})).status,404);
    assert.equal((await request('/api/finance/entries/'+created.id,'DELETE',{})).status,204);
    assert.equal((await request('/api/finance/entries/'+created.id,'DELETE',{})).status,404);
  }finally{await new Promise(resolve=>server.close(resolve));store.close();}
});


test('importação não sobrescreve um destino que tem apenas lançamentos gerais',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'finance-import-')),path=join(dir,'source.sqlite');
  const source=createStore(path);source.close();
  const target=await createCloudStore({client:createClient({url:'file::memory:'})});
  try {
    await target.finance.create({type:'expense',category:'bm',day:'2026-10-31',amount_cents:5000});
    await assert.rejects(importLocalData(target,path),/destino deve estar vazio/);
    assert.equal((await target.finance.list())[0].amount_cents,5000);
  }finally{target.close();rmSync(dir,{recursive:true,force:true});}
});
