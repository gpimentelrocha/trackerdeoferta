import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

import { localDate } from './time.js';
import { OFFER_DETAIL_COLUMNS, offerDetails } from './offer-details.js';
import { serializeAdSample } from './ad-dates.js';
import { attachOfferAnalysis, SNAPSHOT_FIELDS } from './offer-analysis.js';
export { TIME_ZONE, localDate, localHour } from './time.js';
export function createStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS offers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, created_at TEXT NOT NULL,
      last_attempt TEXT, last_error TEXT, state TEXT NOT NULL DEFAULT 'pending', scheduled_day TEXT
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY, offer_id TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
      day TEXT NOT NULL, count INTEGER NOT NULL CHECK(count >= 0), precision TEXT NOT NULL,
      label TEXT NOT NULL, collected_at TEXT NOT NULL, UNIQUE(offer_id, day)
    );`);
  db.exec('BEGIN IMMEDIATE');
  try {
    const columns = new Set(db.prepare('PRAGMA table_info(offers)').all().map(column => column.name));
    for (const column of OFFER_DETAIL_COLUMNS) if (!columns.has(column)) db.exec(`ALTER TABLE offers ADD COLUMN ${column} TEXT`);
    const snapshotColumns = new Set(db.prepare('PRAGMA table_info(snapshots)').all().map(column => column.name));
    if (!snapshotColumns.has('ad_sample')) db.exec('ALTER TABLE snapshots ADD COLUMN ad_sample TEXT');
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  db.prepare("UPDATE offers SET state='error', last_error='A consulta foi interrompida. Atualize novamente.' WHERE state IN ('queued', 'updating')").run();
  function get(id) {
    const offer = db.prepare('SELECT * FROM offers WHERE id=?').get(id);
    if (!offer) return null;
    const history = db.prepare(`SELECT ${SNAPSHOT_FIELDS} FROM snapshots s WHERE s.offer_id=? ORDER BY s.day ASC`).all(id);
    return attachOfferAnalysis(offer, history);
  }
  return {
    db, get,
    list: () => db.prepare('SELECT id FROM offers ORDER BY created_at DESC').all().map(row => get(row.id)),
    create(name, url, details = {}) {
      const id = randomUUID();
      const values = offerDetails(details);
      db.prepare('INSERT INTO offers(id,name,url,created_at,offer_type,niche,funnel) VALUES(?,?,?,?,?,?,?)').run(id, name, url, new Date().toISOString(), values.offer_type, values.niche, values.funnel);
      return get(id);
    },
    update(id, input) {
      const values = offerDetails(input, { partial: true });
      if (Object.hasOwn(input, 'name')) values.name = input.name;
      const entries = Object.entries(values);
      if (entries.length) db.prepare(`UPDATE offers SET ${entries.map(([key]) => key + '=?').join(',')} WHERE id=?`).run(...entries.map(([, value]) => value), id);
      return get(id);
    },
    rename(id, name) { db.prepare('UPDATE offers SET name=? WHERE id=?').run(name, id); return get(id); },
    remove(id) { return db.prepare('DELETE FROM offers WHERE id=?').run(id).changes > 0; },
    claimDay(id, day) { return db.prepare('UPDATE offers SET scheduled_day=? WHERE id=? AND (scheduled_day IS NULL OR scheduled_day < ?)').run(day, id, day).changes > 0; },
    state(id, state) { db.prepare('UPDATE offers SET state=? WHERE id=?').run(state, id); },
    attempt(id) { db.prepare("UPDATE offers SET state='updating', last_attempt=?, last_error=NULL WHERE id=?").run(new Date().toISOString(), id); },
    success(id, result) {
      const now = new Date();
      db.exec('BEGIN');
      try {
        if (!get(id)) { db.exec('ROLLBACK'); return; }
        db.prepare(`INSERT INTO snapshots(offer_id,day,count,precision,label,collected_at,ad_sample) VALUES(?,?,?,?,?,?,?)
          ON CONFLICT(offer_id,day) DO UPDATE SET count=excluded.count,precision=excluded.precision,label=excluded.label,collected_at=excluded.collected_at,ad_sample=excluded.ad_sample`)
          .run(id, localDate(now), result.count, result.precision, result.label, now.toISOString(), serializeAdSample(result.ad_sample));
        db.prepare("UPDATE offers SET state='ok', last_error=NULL WHERE id=?").run(id);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    fail(id, message) { db.prepare("UPDATE offers SET state='error', last_error=? WHERE id=?").run(message, id); },
    close() { db.close(); }
  };
}
