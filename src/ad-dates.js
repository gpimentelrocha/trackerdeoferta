const DAY = 86400000;
const months = {
  jan: 1, janeiro: 1, january: 1, fev: 2, fevereiro: 2, feb: 2, february: 2,
  mar: 3, marco: 3, march: 3, abr: 4, abril: 4, apr: 4, april: 4,
  mai: 5, maio: 5, may: 5, jun: 6, junho: 6, june: 6,
  jul: 7, julho: 7, july: 7, ago: 8, agosto: 8, aug: 8, august: 8,
  set: 9, setembro: 9, sep: 9, sept: 9, september: 9,
  out: 10, outubro: 10, oct: 10, october: 10, nov: 11, novembro: 11, november: 11,
  dez: 12, dezembro: 12, dec: 12, december: 12
};
function validDate(year, month, day) {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return date.toISOString().slice(0, 10);
}
export function parseAdStartDate(text) {
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replaceAll('.', '').trim();
  let match = normalized.match(/^(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})$/);
  if (match) return months[match[2]] ? validDate(match[3], months[match[2]], match[1]) : null;
  match = normalized.match(/^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (match) return months[match[1]] ? validDate(match[3], months[match[1]], match[2]) : null;
  match = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match ? validDate(match[3], match[2], match[1]) : null;
}
export function daysBetween(start, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || '')) return null;
  if (validDate(...start.split('-')) !== start || validDate(...end.split('-')) !== end) return null;
  return Math.round((Date.parse(end + 'T12:00:00Z') - Date.parse(start + 'T12:00:00Z')) / DAY);
}

export function parseObservedAds(text, observedOn) {
  const clean = text.replace(/[\u200b\u200e\u200f\ufeff]/g, '').replaceAll('\u00a0', ' ');
  const matches = [...clean.matchAll(/^(?:Identificação da biblioteca|Library ID):\s*(\d+)\s*$/gmi)];
  const ads = new Map();
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    const before = clean.slice(Math.max(0, match.index - 180), match.index).trim().split('\n').at(-1)?.trim();
    if (!/^(Ativo|Ativa|Active)$/i.test(before || '')) continue;
    const block = clean.slice(match.index + match[0].length, matches[index + 1]?.index || clean.length);
    const header = block.split(/\n(?:Plataformas|Platforms|Ver detalhes do anúncio|See ad details)\b/i)[0].split('\n').slice(0, 8);
    const dateLine = header.map(line => line.trim()).find(line => /^(Veiculação iniciada em|Started running on)\s+/i.test(line));
    if (!dateLine) continue;
    const start = parseAdStartDate(dateLine.replace(/^(Veiculação iniciada em|Started running on)\s+/i, ''));
    const age = start ? daysBetween(start, observedOn) : null;
    if (age === null || age < 0) continue;
    ads.set(match[1], { id: match[1], start_date: start });
  }
  return [...ads.values()];
}

export function normalizeAdSample(input) {
  if (!input || !Array.isArray(input.ads)) return null;
  const seen = new Set();
  const ads = [];
  for (const ad of input.ads.slice(0, 40)) {
    if (!/^\d{1,30}$/.test(ad?.id || '') || seen.has(ad.id) || daysBetween(ad.start_date, ad.start_date) !== 0) continue;
    seen.add(ad.id);
    ads.push({ id: ad.id, start_date: ad.start_date });
  }
  return { version: 1, scope: 'loaded_active_ads', ads };
}
export function serializeAdSample(input) {
  const sample = normalizeAdSample(input);
  return sample ? JSON.stringify(sample) : null;
}
export function decodeAdSample(value) {
  if (!value) return null;
  try { return normalizeAdSample(typeof value === 'string' ? JSON.parse(value) : value); }
  catch { return null; }
}
