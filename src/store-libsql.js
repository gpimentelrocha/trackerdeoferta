import { createClient } from '@libsql/client/web';
import { randomUUID } from 'node:crypto';
import { localDate } from './time.js';
import { OFFER_DETAIL_COLUMNS, offerDetails } from './offer-details.js';
import { serializeAdSample } from './ad-dates.js';
import { attachOfferAnalysis, SNAPSHOT_FIELDS } from './offer-analysis.js';

export const MAX_OFFERS = 10;
const schema = [
  `CREATE TABLE IF NOT EXISTS offers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, created_at TEXT NOT NULL,
    last_attempt TEXT, last_error TEXT, state TEXT NOT NULL DEFAULT 'pending', scheduled_day TEXT,
    lease_token TEXT, lease_until TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY, offer_id TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
    day TEXT NOT NULL, count INTEGER NOT NULL CHECK(count >= 0), precision TEXT NOT NULL,
    label TEXT NOT NULL, collected_at TEXT NOT NULL, UNIQUE(offer_id, day)
  )`,
  `CREATE INDEX IF NOT EXISTS snapshots_offer_day ON snapshots(offer_id, day)`,
  `CREATE TRIGGER IF NOT EXISTS offers_capacity BEFORE INSERT ON offers
    WHEN (SELECT COUNT(*) FROM offers) >= ${MAX_OFFERS}
    BEGIN SELECT RAISE(ABORT, 'TRACKER_OFFERS_LIMIT'); END`
];
const sql = (query, args = []) => ({ sql: query, args });
function hydrate(offer, history) {
  const { lease_token, lease_until, ...publicOffer } = offer;
  // Uma função encerrada por timeout não deixa a interface presa para sempre.
  if (publicOffer.state === 'updating' && lease_until && lease_until < new Date().toISOString()) {
    publicOffer.state = 'error';
    publicOffer.last_error = 'A consulta foi interrompida. Atualize novamente.';
  }
  return attachOfferAnalysis(publicOffer, history);
}

export async function createCloudStore({ client, url = process.env.TURSO_DATABASE_URL, authToken = process.env.TURSO_AUTH_TOKEN } = {}) {
  if (!client) {
    if (!url || !authToken) throw new Error('Configure TURSO_DATABASE_URL e TURSO_AUTH_TOKEN na Vercel.');
    if (!/^libsql:\/\/[^/]+\/?$/.test(url) && !/^https:\/\/[^/]+\/?$/.test(url)) throw new Error('A URL do Turso deve usar libsql:// ou HTTPS.');
    client = createClient({ url, authToken });
  }
  await client.batch(schema, 'write');
  // Leitura do schema e ALTER sob o mesmo bloqueio: cold starts concorrentes
  // não tentam criar a mesma coluna. Nenhum registro existente é reescrito.
  const migration = await client.transaction('write');
  try {
    const info = await migration.execute('PRAGMA table_info(offers)');
    const columns = new Set(info.rows.map(column => column.name));
    for (const column of OFFER_DETAIL_COLUMNS) if (!columns.has(column)) await migration.execute(`ALTER TABLE offers ADD COLUMN ${column} TEXT`);
    const snapshotInfo = await migration.execute('PRAGMA table_info(snapshots)');
    if (!snapshotInfo.rows.some(column => column.name === 'ad_sample')) await migration.execute('ALTER TABLE snapshots ADD COLUMN ad_sample TEXT');
    await migration.commit();
  } catch (error) { await migration.rollback(); throw error; }
  finally { migration.close(); }
  async function get(id) {
    const [offers, snapshots] = await client.batch([
      sql('SELECT * FROM offers WHERE id=?', [id]),
      sql(`SELECT ${SNAPSHOT_FIELDS} FROM snapshots s WHERE s.offer_id=? ORDER BY s.day`, [id])
    ], 'read');
    return offers.rows[0] ? hydrate(offers.rows[0], snapshots.rows) : null;
  }
  return {
    client, get, limit: MAX_OFFERS,
    async list() {
      const [offers, snapshots] = await client.batch([
        'SELECT * FROM offers ORDER BY created_at DESC',
        `SELECT s.offer_id,${SNAPSHOT_FIELDS} FROM snapshots s ORDER BY s.day`
      ], 'read');
      const byOffer = new Map();
      for (const { offer_id, ...snapshot } of snapshots.rows) {
        if (!byOffer.has(offer_id)) byOffer.set(offer_id, []);
        byOffer.get(offer_id).push(snapshot);
      }
      return offers.rows.map(offer => hydrate(offer, byOffer.get(offer.id) || []));
    },
    async create(name, url, details = {}) {
      const id = randomUUID();
      const values = offerDetails(details);
      try { await client.execute(sql(`INSERT INTO offers(id,name,url,created_at,${OFFER_DETAIL_COLUMNS.join(',')}) VALUES(?,?,?,?,${OFFER_DETAIL_COLUMNS.map(() => '?').join(',')})`, [id, name, url, new Date().toISOString(), ...OFFER_DETAIL_COLUMNS.map(key => values[key])])); }
      catch (error) {
        if (error.message.includes('TRACKER_OFFERS_LIMIT')) { const e = new Error(`Este workspace comporta até ${MAX_OFFERS} ofertas para garantir a coleta diária na Vercel.`); e.status = 409; throw e; }
        throw error;
      }
      return get(id);
    },
    async update(id, input) {
      const values = offerDetails(input, { partial: true });
      if (Object.hasOwn(input, 'name')) values.name = input.name;
      const entries = Object.entries(values);
      if (entries.length) await client.execute(sql(`UPDATE offers SET ${entries.map(([key]) => key + '=?').join(',')} WHERE id=?`, [...entries.map(([, value]) => value), id]));
      return get(id);
    },
    async rename(id, name) { await client.execute(sql('UPDATE offers SET name=? WHERE id=?', [name, id])); return get(id); },
    async remove(id) {
      const results = await client.batch([
        sql('DELETE FROM snapshots WHERE offer_id=?', [id]), sql('DELETE FROM offers WHERE id=?', [id])
      ], 'write');
      return results[1].rowsAffected > 0;
    },
    async claim(id, { day = null, now = new Date() } = {}) {
      const token = randomUUID();
      const timestamp = now.toISOString();
      const until = new Date(now.getTime() + 120_000).toISOString();
      const result = await client.execute(sql(`UPDATE offers SET lease_token=?,lease_until=?,state='updating',last_attempt=?,last_error=NULL,
        scheduled_day=CASE WHEN ? IS NULL THEN scheduled_day ELSE ? END
        WHERE id=? AND (lease_until IS NULL OR lease_until < ?)
        AND (? IS NULL OR scheduled_day IS NULL OR scheduled_day < ? OR (state='updating' AND lease_until < ?))`,
        [token, until, timestamp, day, day, id, timestamp, day, day, timestamp]));
      return result.rowsAffected ? token : null;
    },
    async success(id, token, result, now = new Date()) {
      const results = await client.batch([
        sql(`INSERT INTO snapshots(offer_id,day,count,precision,label,collected_at,ad_sample)
          SELECT id,?,?,?,?,?,? FROM offers WHERE id=? AND lease_token=?
          ON CONFLICT(offer_id,day) DO UPDATE SET count=excluded.count,precision=excluded.precision,label=excluded.label,collected_at=excluded.collected_at,ad_sample=excluded.ad_sample`,
          [localDate(now), result.count, result.precision, result.label, now.toISOString(), serializeAdSample(result.ad_sample), id, token]),
        sql("UPDATE offers SET state='ok',last_error=NULL,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?", [id, token])
      ], 'write');
      return results[0].rowsAffected > 0;
    },
    async fail(id, token, message) {
      await client.execute(sql("UPDATE offers SET state='error',last_error=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?", [message, id, token]));
    },
    close() { client.close(); }
  };
}
