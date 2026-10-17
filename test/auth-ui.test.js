import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright-core';
import { createStore } from '../src/store.js';
import { createCollector } from '../src/collector.js';
import { createApp } from '../src/app.js';
import { createAuth } from '../src/auth.js';
import { browserExecutable } from '../src/library.js';

test('interface exige login, mostra gráfico depois de entrar e encerra sessão ao sair', async () => {
  const store = createStore(':memory:');
  const collector = createCollector(store, async () => ({ count: 23, precision: 'exact', label: '23 resultados' }));
  const password = randomBytes(20).toString('hex');
  const auth = createAuth({ password, sessionSecret: randomBytes(32).toString('hex'), cronSecret: randomBytes(32).toString('hex'), required:true, secure:false });
  const server = createApp(store, collector, {auth}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const browser = await chromium.launch({executablePath:browserExecutable(),args:['--no-sandbox']});
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('#login-dialog[open]').waitFor();
    await page.locator('#login-form [name=password]').fill('senha errada');
    await page.locator('#login-form button').click();
    await page.locator('#login-error:not([hidden])').waitFor();
    assert.match(await page.locator('#login-error').innerText(),/incorreta/);
    await page.locator('#login-form [name=password]').fill(password);
    await page.locator('#login-form button').click();
    await page.locator('#empty:not([hidden])').waitFor();
    assert.equal(await page.locator('#login-dialog').evaluate(element=>element.open),false);
    await page.reload();
    await page.locator('#empty:not([hidden])').waitFor();
    assert.equal(await page.locator('#login-dialog').evaluate(element=>element.open),false);
    await page.locator('#logout').click();
    await page.locator('#login-dialog[open]').waitFor();
    assert.equal((await page.request.get(`http://127.0.0.1:${server.address().port}/api/offers`)).status(),401);
  } finally { await browser.close(); await collector.close(); await new Promise(resolve=>server.close(resolve)); store.close(); }
});
