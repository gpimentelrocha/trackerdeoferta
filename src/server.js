import { resolve } from 'node:path';
import { createStore } from './store.js';
import { createCollector } from './collector.js';
import { collectLibraryCount } from './library.js';
import { createApp } from './app.js';

const store = createStore(resolve(process.env.TRACKER_DATA_DIR || 'data', 'tracker.sqlite'));
const collector = createCollector(store, collectLibraryCount);
const app = createApp(store, collector);
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, process.env.HOST || '0.0.0.0', () => {
  console.log(`Tracker de Ofertas iniciado na porta ${port}.`);
  collector.tick();
});
const interval = setInterval(() => collector.tick(), 60_000);
async function stop() {
  clearInterval(interval);
  server.close();
  await collector.close();
  store.close();
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
