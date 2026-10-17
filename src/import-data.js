import { DatabaseSync } from 'node:sqlite';
import { MAX_OFFERS } from './store-libsql.js';

export async function importLocalData(store, path) {
  const source = new DatabaseSync(path, { readOnly: true });
  let offers, snapshots;
  try {
    source.exec('BEGIN');
    offers = source.prepare('SELECT * FROM offers ORDER BY created_at').all();
    snapshots = source.prepare('SELECT * FROM snapshots ORDER BY id').all();
    source.exec('COMMIT');
  } finally { source.close(); }
  if (offers.length > MAX_OFFERS) throw new Error(`A versão Vercel suporta até ${MAX_OFFERS} ofertas. A origem não foi alterada.`);
  const tx = await store.client.transaction('write');
  try {
    const a = await tx.execute('SELECT COUNT(*) AS n FROM offers');
    const b = await tx.execute('SELECT COUNT(*) AS n FROM snapshots');
    if (Number(a.rows[0].n) || Number(b.rows[0].n)) throw new Error('O Turso de destino deve estar vazio. Nenhum dado existente foi substituído.');
    for (const offer of offers) {
      const interrupted = ['queued', 'updating'].includes(offer.state);
      await tx.execute({ sql: 'INSERT INTO offers(id,name,url,created_at,last_attempt,last_error,state,scheduled_day,offer_type,niche,funnel) VALUES(?,?,?,?,?,?,?,?,?,?,?)', args: [offer.id, offer.name, offer.url, offer.created_at, offer.last_attempt, interrupted ? 'A consulta foi interrompida na migração. Atualize novamente.' : offer.last_error, interrupted ? 'error' : offer.state, offer.scheduled_day, offer.offer_type ?? null, offer.niche ?? null, offer.funnel ?? null] });
    }
    for (const row of snapshots) await tx.execute({ sql: 'INSERT INTO snapshots(id,offer_id,day,count,precision,label,collected_at) VALUES(?,?,?,?,?,?,?)', args: [row.id, row.offer_id, row.day, row.count, row.precision, row.label, row.collected_at] });
    await tx.commit();
    return { offers: offers.length, snapshots: snapshots.length };
  } catch (error) { await tx.rollback(); throw error; }
  finally { tx.close(); }
}
