import { createApp } from './app.js';
import { createPersonalAccess } from './auth.js';
import { createCloudStore } from './store-libsql.js';
import { createServerlessCollector } from './serverless-collector.js';
import { collectLibraryCount } from './library.js';

const requirements = ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN'];

export function configurationIssues(environment) {
  const issues = [];
  for (const name of requirements) {
    const value = environment[name];
    if (typeof value !== 'string' || !value.trim()) issues.push({ name, reason: 'missing' });
  }
  const input = environment.TURSO_DATABASE_URL;
  if (typeof input === 'string' && input.trim()) {
    let valid = false;
    try {
      const url = new URL(input);
      valid = input === input.trim() && ['libsql:', 'https:'].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password && !url.search && !url.hash && ['', '/'].includes(url.pathname);
    } catch {}
    if (!valid) issues.push({ name: 'TURSO_DATABASE_URL', reason: 'invalid_url' });
  }
  return issues;
}

function configurationMessage(issues) {
  const parts = [];
  const missing = issues.filter(issue => issue.reason === 'missing').map(issue => issue.name);
  if (missing.length) parts.push(`Adicione na Vercel → Settings → Environment Variables: ${missing.join(', ')}.`);
  for (const issue of issues) {
    if (issue.reason === 'invalid_url') parts.push('TURSO_DATABASE_URL deve ser a URL libsql:// ou HTTPS do banco, sem espaços, usuário, senha ou parâmetros.');
  }
  parts.push('Habilite as variáveis para Production (e Preview se estiver usando um link de teste). Depois de salvar, faça Redeploy.');
  return parts.join(' ');
}

function sendUnavailable(res, body) {
  if (res.headersSent) { res.end(); return; }
  res.statusCode = 503;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function createProductionHandler({ getEnvironment = () => process.env, openStore = createCloudStore, collect = collectLibraryCount } = {}) {
  let appPromise;
  return async function handler(req, res) {
    const environment = getEnvironment();
    const issues = configurationIssues(environment);
    if (issues.length) return sendUnavailable(res, { code: 'CONFIGURATION_REQUIRED', issues, error: configurationMessage(issues) });
    try {
      if (!appPromise) appPromise = (async () => {
        const auth = createPersonalAccess();
        const store = await openStore({ url: environment.TURSO_DATABASE_URL, authToken: environment.TURSO_AUTH_TOKEN });
        const collector = createServerlessCollector(store, collect);
        return createApp(store, collector, { auth, staticFiles: false, platform: 'vercel' });
      })().catch(error => { appPromise = undefined; throw error; });
      const app = await appPromise;
      await new Promise((resolve, reject) => {
        res.once('finish', resolve);
        res.once('close', resolve);
        try { app(req, res); } catch (error) { reject(error); }
      });
    } catch (error) {
      // Nunca devolva mensagens brutas do cliente SQL: podem incluir a URL ou o token.
      const denied = ['UNAUTHORIZED', 'FORBIDDEN', 'AUTHENTICATION_FAILED', 'AUTH_EXPIRED', 'HTTP_UNAUTHORIZED', 'HTTP_FORBIDDEN'].includes(error?.code) || [401, 403].includes(error?.status);
      sendUnavailable(res, {
        code: denied ? 'DATABASE_AUTH_FAILED' : 'DATABASE_UNAVAILABLE',
        error: denied
          ? 'O Turso recusou o acesso. Confira TURSO_DATABASE_URL e substitua TURSO_AUTH_TOKEN por um token válido, com leitura e escrita. Salve na Vercel para o ambiente correto e faça Redeploy.'
          : 'As variáveis obrigatórias estão preenchidas, mas não foi possível conectar ou preparar o banco Turso. Confira se o banco está ativo, se TURSO_DATABASE_URL é a URL correta e se TURSO_AUTH_TOKEN permite leitura, escrita e criação de tabelas. Depois de corrigir na Vercel, faça Redeploy.'
      });
    }
  };
}
