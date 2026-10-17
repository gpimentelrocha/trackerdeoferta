import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { createStore } from '../src/store.js';
import { createCloudStore } from '../src/store-libsql.js';
import { parseAdStartDate, parseObservedAds, daysBetween, serializeAdSample } from '../src/ad-dates.js';
import { analyzeOffer } from '../src/offer-analysis.js';
import { localDate } from '../src/time.js';

const active = { url:'https://www.facebook.com/ads/library/?active_status=active&country=BR&q=test',state:'ok',created_at:'2020-01-01T00:00:00Z' };
const history = (count=100) => [{day:'2026-10-17',count,precision:'exact',label:`${count} resultados`,collected_at:'2026-10-17T12:00:00Z'}];
const sample = dates => ({ ads:dates.map((start_date,index)=>({id:String(1000+index),start_date})) });
const assess = (ads, rows=history(), offer=active, today='2026-10-17')=>analyzeOffer(offer, rows, sample(ads),today);

test('datas públicas em português e inglês são validadas sem depender do fuso do servidor',()=>{
  for(const [input,expected] of [['11 de set de 2026','2026-09-11'],['27 de maio de 2026','2026-05-27'],['1 de março de 2026','2026-03-01'],['Sep 18, 2026','2026-09-18'],['October 1, 2026','2026-10-01'],['29/02/2024','2024-02-29']]) assert.equal(parseAdStartDate(input),expected);
  assert.equal(parseAdStartDate('31 de fevereiro de 2026'),null);
  assert.equal(parseAdStartDate('29/02/2026'),null);
  assert.equal(daysBetween('2026-10-17','2026-10-17'),0);
  assert.equal(daysBetween('2026-05-27','2026-10-17'),143);
  assert.equal(daysBetween('2026-02-31','2026-10-17'),null);
});

test('extrai só anúncios ativos com cabeçalho de início e deduplica IDs, ignorando copy e datas futuras',()=>{
  const text = `Ativo\nIdentificação da biblioteca: 123\nVeiculação iniciada em 27 de mai de 2026\nPlataformas\nVeiculação iniciada em 1 de jan de 2020\nInativo\nIdentificação da biblioteca: 456\nVeiculação iniciada em 1 de jan de 2020\nPlataformas\nActive\nLibrary ID: 789\nStarted running on Oct 1, 2026\nPlatforms\nAtivo\nIdentificação da biblioteca: 123\nVeiculação iniciada em 27 de mai de 2026\nPlataformas\nAtivo\nIdentificação da biblioteca: 999\nVeiculação iniciada em 1 de nov de 2026\nPlataformas`;
  assert.deepEqual(parseObservedAds(text,'2026-10-17'),[{id:'123',start_date:'2026-05-27'},{id:'789',start_date:'2026-10-01'}]);
  assert.deepEqual(parseObservedAds('Identificação da biblioteca: 1\nVeiculação iniciada em 1 de jan de 2026','2026-10-17'),[]);
});

test('não inventa idade ou nota usando o dia do cadastro ou somente a contagem',()=>{
  const assessment=assess([]);
  assert.equal(assessment.score,null);
  assert.equal(assessment.oldest_days,null);
  assert.equal(assessment.median_days,null);
  assert.match(assessment.reason,/não há datas/);
  assert.equal(analyzeOffer(active,history(),null,'2026-10-17').score,null);
});

test('idade é medida na data da coleta; períodos longos pesam mais que volume isolado',()=>{
  const young=assess(['2026-10-16','2026-10-17'],history(500));
  const mature=assess(['2026-08-01','2026-08-02'],history(10));
  assert.ok(mature.score>young.score);
  assert.equal(mature.oldest_days,77);
  assert.equal(mature.median_days,76);
  assert.equal(mature.ads[0].days_running,77);
  assert.equal(mature.provisional,true);
  assert.equal(mature.criteria.length,3);
  assert.ok(mature.score>=0&&mature.score<=10);
});

test('histórico semanal permite avaliar crescimento; não pontua dias inventados ou limites inferiores como tendência exata',()=>{
  const dates=Array(5).fill('2026-08-01');
  const growing=assess(dates,[{...history(100)[0],day:'2026-10-10'},...history(150)]);
  assert.equal(growing.criteria.length,4);
  assert.equal(growing.provisional,false);
  const falling=assess(dates,[{...history(200)[0],day:'2026-10-10'},...history(100)]);
  assert.ok(growing.score>falling.score);
  const lowerBound=assess(dates,[{...history(100)[0],day:'2026-10-10',precision:'lower_bound'},...history(150)]);
  assert.equal(lowerBound.criteria.length,3);
  assert.equal(lowerBound.provisional,true);
});

test('zero ativo confirmado vale zero; filtros mistos, dados antigos e falha de consulta não recebem nota atual',()=>{
  assert.equal(assess([],history(0)).score,0);
  assert.equal(assess(['2026-08-01'],history(),{...active,url:active.url.replace('active_status=active','active_status=all')}).score,null);
  const stale=assess(['2026-08-01'],history(),active,'2026-10-20');
  assert.equal(stale.score,null);
  assert.equal(stale.oldest_days,77,'não extrapola a idade enquanto não coleta novamente');
  assert.equal(assess(['2026-08-01'],history(),{...active,state:'error'}).score,null);
});

test('amostras inválidas são descartadas e limitadas a 40 anúncios',()=>{
  assert.equal(JSON.parse(serializeAdSample(sample(Array(100).fill('2026-09-01')))).ads.length,40);
  assert.equal(serializeAdSample(undefined),null);
});

for(const backend of ['sqlite','libsql']) test(`${backend}: persiste amostra com a contagem, preserva em falha e não expõe JSON no histórico`,async()=>{
  const store=backend==='sqlite'?createStore(':memory:'):await createCloudStore({client:createClient({url:'file::memory:'})});
  const today=localDate();
  const start=localDate(new Date(Date.now()-20*86400000));
  const offer=await store.create('Oferta com datas',active.url);
  try{
    let token;
    if(backend==='libsql') token=await store.claim(offer.id);
    const result={count:80,precision:'approximate',label:'~80 resultados',ad_sample:sample([start])};
    if(backend==='sqlite') store.success(offer.id,result);else await store.success(offer.id,token,result);
    let updated=await store.get(offer.id);
    assert.equal(updated.analysis.sampled_ads,1);
    assert.equal(updated.analysis.oldest_days,20);
    assert.equal(updated.analysis.observed_on,today);
    assert.equal(typeof updated.analysis.score,'number');
    assert.equal('ad_sample' in updated.latest,false);
    assert.equal('ad_sample' in updated.history[0],false);
    assert.equal((await store.list())[0].analysis.ads[0].start_date,start);
    if(backend==='sqlite') store.fail(offer.id,'Falha');else {token=await store.claim(offer.id);await store.fail(offer.id,token,'Falha');}
    updated=await store.get(offer.id);
    assert.equal(updated.analysis.score,null);
    assert.equal(updated.analysis.oldest_days,20);
    assert.equal(updated.latest.count,80);
    const withoutDates={count:75,precision:'exact',label:'75 resultados'};
    if(backend==='sqlite') store.success(offer.id,withoutDates);else {token=await store.claim(offer.id);await store.success(offer.id,token,withoutDates);}
    updated=await store.get(offer.id);
    assert.equal(updated.latest.count,75);
    assert.equal(updated.analysis.score,null);
    assert.equal(updated.analysis.sampled_ads,0);
    assert.equal(updated.history.length,1);
  }finally{store.close();}
});
