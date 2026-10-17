import { createApp } from '../src/app.js';
import { createAuth } from '../src/auth.js';
import { createCloudStore } from '../src/store-libsql.js';
import { createServerlessCollector } from '../src/serverless-collector.js';
import { collectLibraryCount } from '../src/library.js';

let appPromise;
export default async function handler(req, res) {
  try {
    if (!appPromise) appPromise = (async () => {
      const auth = createAuth({ required: true });
      const store = await createCloudStore();
      const collector = createServerlessCollector(store, collectLibraryCount);
      return createApp(store, collector, { auth, staticFiles: false, platform: 'vercel' });
    })().catch(error => { appPromise = undefined; throw error; });
    const app = await appPromise;
    await new Promise((resolve, reject) => {
      res.once('finish', resolve);
      res.once('close', resolve);
      try { app(req, res); } catch (error) { reject(error); }
    });
  } catch {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: 'O ambiente de produção ainda não está configurado. Confira as variáveis e a conexão com o Turso.' }));
  }
}
