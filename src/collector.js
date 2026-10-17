import { localDate, localHour } from './store.js';

export function createCollector(store, collect) {
  const pending = new Set();
  const queue = [];
  let running = false;
  let closed = false;
  let idleResolve;
  async function drain() {
    if (running || closed) return;
    running = true;
    try {
      while (queue.length && !closed) {
        const id = queue.shift();
        const offer = store.get(id);
        if (offer) {
          store.attempt(id);
          try {
            const result = await collect(offer.url);
            if (!Number.isSafeInteger(result.count) || result.count < 0 || !['exact', 'approximate', 'lower_bound'].includes(result.precision) || typeof result.label !== 'string') throw new Error('A fonte retornou uma contagem inválida.');
            store.success(id, result);
          } catch (error) { store.fail(id, error.message || 'Falha na consulta.'); }
        }
        pending.delete(id);
      }
    } finally { running = false; idleResolve?.(); idleResolve = undefined; }
  }
  function enqueue(id) {
    if (closed || pending.has(id) || !store.get(id)) return false;
    pending.add(id);
    queue.push(id);
    store.state(id, 'queued');
    void drain();
    return true;
  }
  function tick(date = new Date()) {
    if (closed || localHour(date) < 9) return;
    const day = localDate(date);
    for (const offer of store.list()) {
      if (pending.has(offer.id)) continue;
      if (store.claimDay(offer.id, day)) enqueue(offer.id);
    }
  }
  return {
    enqueue, tick,
    initial(id) { store.claimDay(id, localDate()); return enqueue(id); },
    async idle() { if (running) await new Promise(resolve => { idleResolve = resolve; }); },
    async close() { closed = true; for (const id of queue.splice(0)) { pending.delete(id); store.fail(id, 'A consulta foi interrompida. Atualize novamente.'); } if (running) await new Promise(resolve => { idleResolve = resolve; }); }
  };
}
