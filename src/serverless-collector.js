import { localDate, localHour } from './time.js';

export function createServerlessCollector(store, collect) {
  async function run(id, day = null) {
    const offer = await store.get(id);
    if (!offer) return false;
    const token = await store.claim(id, { day });
    if (!token) return false;
    try {
      const result = await collect(offer.url, { timeout: 45000 });
      if (!Number.isSafeInteger(result.count) || result.count < 0 || !['exact', 'approximate', 'lower_bound'].includes(result.precision) || typeof result.label !== 'string') throw new Error('A fonte retornou uma contagem inválida.');
      await store.success(id, token, result);
    } catch (error) { await store.fail(id, token, error.message || 'Falha na consulta.'); }
    return true;
  }
  async function sweep(day = null) {
    const offers = await store.list();
    let cursor = 0;
    let processed = 0;
    // Duas consultas por vez: até dez ofertas em cinco ondas de no máximo 45s.
    async function worker() {
      while (cursor < offers.length) {
        const offer = offers[cursor++];
        if (await run(offer.id, day)) processed++;
      }
    }
    await Promise.all([worker(), worker()]);
    return processed;
  }
  return {
    blocking: true,
    enqueue: id => run(id),
    initial: id => run(id),
    refreshAll: () => sweep(),
    async tick(now = new Date()) {
      if (localHour(now) < 9) return 0;
      return sweep(localDate(now));
    }
  };
}
