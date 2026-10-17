import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

export class CollectionError extends Error {}
let serverlessBinaryPromise;

export function validateLibraryUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('Informe um link válido da Biblioteca de Anúncios.'); }
  if (url.protocol !== 'https:' || !['facebook.com', 'www.facebook.com'].includes(url.hostname) || url.port || url.username || url.password || !/^\/ads\/library\/?$/.test(url.pathname)) {
    throw new Error('Use um link HTTPS de facebook.com/ads/library/.');
  }
  if (!url.searchParams.get('q')?.trim() && !/^\d+$/.test(url.searchParams.get('view_all_page_id') || '')) {
    throw new Error('Copie o link de uma busca ou da página do anunciante, com os filtros desejados.');
  }
  // A página da oferta deve abrir a listagem, sem o modal de um anúncio individual.
  if (url.searchParams.has('view_all_page_id')) url.searchParams.delete('id');
  url.hash = '';
  return url.href;
}

export function parseCount(text) {
  const lines = text.replaceAll('\u00a0', ' ').split(/\n/).map(line => line.trim());
  for (const line of lines) {
    const match = line.match(/^(?:(~|≈|cerca de|aproximadamente|about|mais de|more than|over|pelo menos|at least)\s*)?([\d][\d.,\s]*?)\s+(resultados?|results?|anúncios?|ads)(?:\s+(encontrados|found))?\.?$/i);
    if (match) {
      const rawNumber = match[2].trim();
      if (!/^\d+$/.test(rawNumber) && !/^\d{1,3}([., ]\d{3})+$/.test(rawNumber)) continue;
      const count = Number(rawNumber.replace(/[.,\s]/g, ''));
      if (!Number.isSafeInteger(count)) continue;
      const qualifier = match[1] || '';
      return { count, precision: /mais de|more than|over|pelo menos|at least/i.test(qualifier) ? 'lower_bound' : qualifier ? 'approximate' : 'exact', label: line };
    }
    if (/^(nenhum resultado encontrado|nenhum anúncio encontrado|no results found|no ads found)[.!]?$/i.test(line)) return { count: 0, precision: 'exact', label: line };
  }
  return null;
}

export function browserExecutable() {
  const candidates = [process.env.CHROMIUM_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  return candidates.find(path => path && existsSync(path));
}

// Um 403 inicial pode ser uma página intermediária que recarrega sozinha.
// Aguarde apenas a navegação normal; não resolva CAPTCHA nem contorne login.
export async function readLibraryCount(page, { timeout = 45000, status = () => 200 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    let text;
    try {
      text = await page.locator('body').innerText({ timeout: Math.max(1, Math.min(1500, deadline - Date.now())) });
    } catch (error) {
      if (page.isClosed()) throw error;
      // O documento pode ser substituído durante o recarregamento normal.
      await page.waitForTimeout(100);
      continue;
    }
    const header = text.split(/(?:Identificação da biblioteca|Library ID):/i)[0].slice(0, 18000);
    if (/temporarily blocked|temporariamente bloquead|captcha|confirme que você é humano|log in to continue|entre para continuar|you must log in|você precisa entrar/i.test(header)) {
      throw new CollectionError('O Facebook solicitou login ou bloqueou a consulta automática. Abra a biblioteca para conferir; a última contagem foi preservada.');
    }
    if (status() >= 200 && status() < 300) {
      const result = parseCount(header);
      if (result) return { ...result, source: 'facebook_library' };
    }
    for (const name of [/permitir todos os cookies/i, /allow all cookies/i, /aceitar todos/i]) {
      const button = page.getByRole('button', { name }).first();
      if (await button.isVisible().catch(() => false)) await button.click({ timeout: 1000 }).catch(() => {});
    }
    if (Date.now() < deadline) await page.waitForTimeout(Math.min(500, deadline - Date.now()));
  }
  if (status() >= 400) throw new CollectionError(`Facebook retornou HTTP ${status()} e não concluiu o carregamento. A contagem não foi alterada.`);
  throw new CollectionError('O Facebook não exibiu uma contagem reconhecível. A consulta pode exigir login ou estar indisponível. A última contagem foi preservada.');
}

export async function collectLibraryCount(input, { timeout = 45000 } = {}) {
  const url = validateLibraryUrl(input);
  let browser;
  try {
    let options;
    if (process.env.VERCEL) {
      const { default: serverlessChromium } = await import('@sparticuz/chromium');
      serverlessBinaryPromise ||= serverlessChromium.executablePath().catch(error => { serverlessBinaryPromise = undefined; throw error; });
      options = { executablePath: await serverlessBinaryPromise, args: serverlessChromium.args, headless: true };
    } else {
      const executablePath = browserExecutable();
      if (!executablePath) throw new CollectionError('Chromium não instalado. Consulte as instruções de instalação.');
      options = { executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] };
    }
    browser = await chromium.launch(options);
    const context = await browser.newContext({ locale: 'pt-BR', viewport: { width: 1365, height: 900 } });
    await context.route('**/*', route => {
      const target = new URL(route.request().url());
      const allowed = target.protocol === 'https:' && ['facebook.com', 'fbcdn.net'].some(host => target.hostname === host || target.hostname.endsWith('.' + host));
      return allowed ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    let mainStatus = 0;
    page.on('response', response => {
      if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) mainStatus = response.status();
    });
    const deadline = Date.now() + timeout;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    return await readLibraryCount(page, { timeout: Math.max(1, deadline - Date.now()), status: () => mainStatus });
  } catch (error) {
    if (error instanceof CollectionError) throw error;
    throw new CollectionError('Não foi possível acessar a Biblioteca de Anúncios. Verifique a conexão, a permissão de rede e a disponibilidade do Facebook.');
  } finally {
    await browser?.close();
  }
}
