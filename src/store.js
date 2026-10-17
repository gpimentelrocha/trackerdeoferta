import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

import { localDate } from './time.js';
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
  db.prepare("UPDATE offers SET state='error', last_error='A consulta foi interrompida. Atualize novamente.' WHERE state IN ('queued', 'updating')").run();
  function get(id) {
    const offer = db.prepare('SELECT * FROM offers WHERE id=?').get(id);
    if (!offer) return null;
    const history = db.prepare('SELECT day, count, precision, label, collected_at FROM snapshots WHERE offer_id=? ORDER BY day ASC').all(id);
    const latest = history.at(-1) || null;
    const previous = history.at(-2) || null;
    return { ...offer, history, latest, previous, delta: latest && previous ? latest.count - previous.count : null };
  }
  return {
    db, get,
    list: () => db.prepare('SELECT id FROM offers ORDER BY created_at DESC').all().map(row => get(row.id)),
    create(name, url) {
      const id = randomUUID();
      db.prepare('INSERT INTO offers(id,name,url,created_at) VALUES(?,?,?,?)').run(id, name, url, new Date().toISOString());
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
        db.prepare(`INSERT INTO snapshots(offer_id,day,count,precision,label,collected_at) VALUES(?,?,?,?,?,?)
          ON CONFLICT(offer_id,day) DO UPDATE SET count=excluded.count,precision=excluded.precision,label=excluded.label,collected_at=excluded.collected_at`)
          .run(id, localDate(now), result.count, result.precision, result.label, now.toISOString());
        db.prepare("UPDATE offers SET state='ok', last_error=NULL WHERE id=?").run(id);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    fail(id, message) { db.prepare("UPDATE offers SET state='error', last_error=? WHERE id=?").run(message, id); },
    close() { db.close(); }
  };
}
