import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { browserExecutable, readLibraryCount, collectAdSample } from '../src/library.js';

async function fixture(run, handler) {
  const browser = await chromium.launch({ executablePath: browserExecutable(), args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    let status = 0;
    page.on('response', response => {
      if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) status = response.status();
    });
    await page.route('https://www.facebook.com/**', handler);
    await page.goto('https://www.facebook.com/ads/library/?q=fixture', { waitUntil: 'domcontentloaded' });
    await run(page, () => status);
  } finally { await browser.close(); }
}

test('coleta aguarda uma página 403 que recarrega normalmente para a biblioteca 200', async () => {
  const statuses = [];
  await fixture(async (page, status) => {
    const result = await readLibraryCount(page, { timeout: 5000, status });
    assert.deepEqual(result, { count: 37, precision: 'approximate', label: '~37 resultados', source: 'facebook_library' });
    assert.deepEqual(statuses, [403, 200]);
  }, route => {
    const loaded = new URL(route.request().url()).searchParams.has('ready');
    statuses.push(loaded ? 200 : 403);
    return route.fulfill({ status: loaded ? 200 : 403, contentType: 'text/html; charset=utf-8', body: loaded
      ? '<html><body><h1>Biblioteca de Anúncios</h1><div>~37 resultados</div></body></html>'
      : '<html><body><script>setTimeout(() => location.replace(location.href + "&ready=1"), 100)</script></body></html>' });
  });
});

test('403 persistente não vira sucesso nem zero, mesmo com números no corpo', async () => {
  await fixture(async (page, status) => {
    await assert.rejects(readLibraryCount(page, { timeout: 300, status }), /HTTP 403.*não concluiu/);
  }, route => route.fulfill({ status: 403, contentType: 'text/html; charset=utf-8', body: '<html><body>999 resultados</body></html>' }));
});

test('pedido de login encerra a consulta sem produzir contagem', async () => {
  await fixture(async (page, status) => {
    await assert.rejects(readLibraryCount(page, { timeout: 500, status }), /solicitou login/);
  }, route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<html><body>Entre para continuar</body></html>' }));
});

test('texto de anúncio não é confundido com o total da busca', async () => {
  await fixture(async (page, status) => {
    await assert.rejects(readLibraryCount(page, { timeout: 300, status }), /contagem reconhecível/);
  }, route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<html><body><h1>Biblioteca de Anúncios</h1><p>Identificação da biblioteca: 12345</p><div>500 resultados</div></body></html>' }));
});


test('coleta datas que carregam depois da contagem e mantém o total independente da amostra', async () => {
  await fixture(async (page,status) => {
    const count=await readLibraryCount(page,{timeout:1000,status});
    assert.equal(count.count,37);
    const sample=await collectAdSample(page,{deadline:Date.now()+3000,maxAds:1});
    assert.equal(sample.ads.length,1);
    assert.equal(sample.ads[0].start_date,'2026-09-11');
    assert.equal(sample.ads[0].id,'123456');
    assert.equal(count.count,37);
  },route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:'<html><body><div>~37 resultados</div><script>setTimeout(()=>{const card=document.createElement("div");card.innerText="Ativo\\nIdentificação da biblioteca: 123456\\nVeiculação iniciada em 11 de set de 2026\\nPlataformas";document.body.append(card)},300)</script></body></html>'}));
});
