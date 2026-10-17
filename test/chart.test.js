import test from 'node:test';
import assert from 'node:assert/strict';
import { dailySeries, createDailyChart } from '../public/daily-chart.js';
const item = (day, count) => ({ day, count, precision:'exact' });
test('gráfico usa dias reais e diferencia lacunas de uma contagem zero', () => {
  const history = [item('2026-10-15', 10), item('2026-10-17', 0)];
  const series = dailySeries(history,{days:3,today:'2026-10-17'});
  assert.deepEqual(series.map(row=>row.snapshot?.count ?? null),[10,null,0]);
  const graph = createDailyChart(history,{days:3,today:'2026-10-17'});
  assert.equal(graph.delta,-10);
  assert.equal(graph.records.length,2);
  assert.equal(graph.html.includes('<polyline'),false,'Não conecta pontos por cima de um dia sem coleta');
  assert.match(graph.html,/17\/10\/2026: 0 anúncios/);
});
test('filtro de período exclui registros antigos e não cria contagens anteriores', () => {
  const history = [item('2026-09-01',5),item('2026-10-17',290)];
  const graph = createDailyChart(history,{days:7,today:'2026-10-17'});
  assert.equal(graph.records.length,1);
  assert.equal(graph.series.length,7);
  assert.equal(graph.series.filter(row=>row.snapshot).length,1);
  assert.equal(graph.delta,null);
  assert.match(graph.html,/290 anúncios/);
});
test('histórico completo mostra todos os dias; contagens aproximadas continuam sinalizadas', () => {
  const history = [{...item('2026-10-16',270),precision:'approximate'},item('2026-10-17',290)];
  const graph = createDailyChart(history,{days:0,today:'2026-10-17'});
  assert.equal(graph.delta,20);
  assert.match(graph.html,/≈ 270 anúncios/);
  assert.match(graph.html,/<polyline/);
});
