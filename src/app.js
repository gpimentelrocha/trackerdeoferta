import express from 'express';
import { registerFinanceRoutes } from './finance.js';
import { registerOperationRoutes } from './operation-routes.js';
import { fileURLToPath } from 'node:url';
import { validateLibraryUrl } from './library.js';
import { TIME_ZONE } from './time.js';
import { createPersonalAccess } from './auth.js';
import { offerDetails } from './offer-details.js';

export function createApp(store, collector, { auth = createPersonalAccess(), staticFiles = true, platform = 'local' } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      let foreign = false;
      try { foreign = origin && new URL(origin).host !== req.get('host'); } catch { foreign = true; }
      if (foreign || req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'Origem não permitida.' });
      if (!req.is('application/json')) return res.status(415).json({ error: 'Envie JSON.' });
    }
    next();
  });
  app.use(express.json({ limit: '256kb' }));
  app.use(auth);
  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/api/offers', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ offers: await store.list(), schedule: { hour: 9, timeZone: TIME_ZONE, platform }, limits: { maxOffers: store.limit || null } });
  });
  function nameFrom(req) {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 100) { const error = new Error('O nome deve ter entre 1 e 100 caracteres.'); error.status = 400; throw error; }
    return name;
  }
  app.post('/api/offers', async (req, res) => {
    let name, url, details;
    try { name = nameFrom(req); url = validateLibraryUrl(req.body?.url); details = offerDetails(req.body); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    const offer = await store.create(name, url, details);
    await collector.initial(offer.id);
    res.status(201).json(await store.get(offer.id));
  });
  app.post('/api/refresh', async (req, res) => {
    let queued = 0;
    if (collector.refreshAll) queued = await collector.refreshAll();
    else for (const offer of await store.list()) if (await collector.enqueue(offer.id)) queued++;
    res.status(collector.blocking ? 200 : 202).json({ queued, completed: Boolean(collector.blocking) });
  });
  app.post('/api/offers/:id/refresh', async (req, res) => {
    if (!await store.get(req.params.id)) return res.status(404).json({ error: 'Oferta não encontrada.' });
    const queued = await collector.enqueue(req.params.id);
    res.status(collector.blocking ? 200 : 202).json({ queued, completed: Boolean(collector.blocking), offer: await store.get(req.params.id) });
  });
  app.get('/api/cron', async (req, res) => {
    const processed = await collector.tick();
    const offers = await store.list();
    res.json({ processed: processed ?? null, failed: offers.filter(offer => offer.state === 'error').length });
  });
  app.patch('/api/offers/:id', async (req, res) => {
    if (!await store.get(req.params.id)) return res.status(404).json({ error: 'Oferta não encontrada.' });
    let updates;
    try {
      updates = offerDetails(req.body || {}, { partial: true });
      if (Object.hasOwn(req.body || {}, 'name')) updates.name = nameFrom(req);
      if (!Object.keys(updates).length) return res.status(400).json({ error: 'Informe os dados da oferta ou os links do funil que deseja editar.' });
    } catch (error) { return res.status(400).json({ error: error.message }); }
    res.json(await store.update(req.params.id, updates));
  });
  app.delete('/api/offers/:id', async (req, res) => {
    if (!await store.remove(req.params.id)) return res.status(404).json({ error: 'Oferta não encontrada.' });
    res.status(204).end();
  });
  registerOperationRoutes(app, store.operation);
  registerFinanceRoutes(app, store.finance);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
  if (staticFiles) app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    res.status(status).json({ error: status === 400 ? 'Requisição inválida.' : status === 409 ? err.message : 'Não foi possível concluir a operação.' });
  });
  return app;
}
