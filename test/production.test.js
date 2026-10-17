import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createClient } from '@libsql/client';
import { createCloudStore } from '../src/store-libsql.js';
import { createProductionHandler, configurationIssues } from '../src/production.js';

function settings() {
  return { TURSO_DATABASE_URL: 'libsql://test-database.turso.io', TURSO_AUTH_TOKEN: randomBytes(32).toString('hex'), TRACKER_PASSWORD: randomBytes(20).toString('hex'), SESSION_SECRET: randomBytes(32).toString('hex'), CRON_SECRET: randomBytes(32).toString('hex') };
}
async function serve(handler, run) {
  const server = createServer(handler).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('inicialização informa todas as variáveis ausentes sem tentar abrir o banco', async () => {
  let opened = false;
  const handler = createProductionHandler({ getEnvironment: () => ({}), openStore: async () => { opened = true; throw new Error('não deve executar'); } });
  await serve(handler, async base => {
    const response = await fetch(base + '/api/offers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 503);
    const result = await response.json();
    assert.equal(result.code, 'CONFIGURATION_REQUIRED');
    assert.deepEqual(result.issues.map(issue => issue.name), ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'TRACKER_PASSWORD', 'SESSION_SECRET', 'CRON_SECRET']);
    assert.match(result.error, /Redeploy/);
    assert.equal(opened, false);
  });
});

test('valida cada segredo, URL e escopo sem retornar seus valores', () => {
  const environment = settings();
  environment.TRACKER_PASSWORD = 'curta';
  environment.SESSION_SECRET = 'curto';
  environment.CRON_SECRET = 'curto';
  environment.TURSO_DATABASE_URL = 'https://user:private@database.turso.io/?token=private';
  const issues = configurationIssues(environment);
  assert.deepEqual(issues.map(issue => issue.name), ['TRACKER_PASSWORD', 'SESSION_SECRET', 'CRON_SECRET', 'TURSO_DATABASE_URL']);
  assert.equal(JSON.stringify(issues).includes('private'), false);
  assert.deepEqual(configurationIssues(settings()), []);
});

test('recusa de autenticação do Turso tem mensagem específica e não expõe credenciais', async () => {
  const environment = settings();
  const handler = createProductionHandler({ getEnvironment: () => environment, openStore: async () => { throw Object.assign(new Error('private: ' + environment.TURSO_AUTH_TOKEN), { code: 'UNAUTHORIZED' }); } });
  await serve(handler, async base => {
    const response = await fetch(base + '/api/offers');
    const text = await response.text();
    assert.equal(response.status, 503);
    assert.equal(JSON.parse(text).code, 'DATABASE_AUTH_FAILED');
    assert.equal(text.includes(environment.TURSO_AUTH_TOKEN), false);
    assert.match(text, /token válido/);
  });
});

test('falha inicial de conexão permite nova tentativa e entrega API quando o banco responde', async () => {
  const environment = settings();
  let calls = 0, store;
  const handler = createProductionHandler({ getEnvironment: () => environment, openStore: async () => {
    calls++;
    if (calls === 1) throw new Error('untrusted raw connection details');
    store = await createCloudStore({ client: createClient({ url: 'file::memory:' }) });
    return store;
  } });
  try {
    await serve(handler, async base => {
      const first = await fetch(base + '/api/health');
      const body = await first.json();
      assert.equal(first.status, 503);
      assert.equal(body.code, 'DATABASE_UNAVAILABLE');
      assert.equal(body.error.includes('untrusted'), false);
      const second = await fetch(base + '/api/health');
      assert.equal(second.status, 200);
      assert.equal((await second.json()).status, 'ok');
      assert.equal((await fetch(base + '/api/offers')).status, 401);
      assert.equal(calls, 2);
    });
  } finally { store?.close(); }
});
