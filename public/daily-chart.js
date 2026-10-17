const DAY = 86400000;
const number = value => new Intl.NumberFormat('pt-BR').format(value);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const stamp = day => Date.parse(day + 'T12:00:00Z');
const isoDay = time => new Date(time).toISOString().slice(0, 10);
const dateLabel = day => day.slice(5).split('-').reverse().join('/');
export const fullDate = day => day.split('-').reverse().join('/');
export const valueLabel = snapshot => `${snapshot.precision === 'approximate' ? '≈ ' : snapshot.precision === 'lower_bound' ? '≥ ' : ''}${number(snapshot.count)}`;

export function dailySeries(history, { days = 30, today } = {}) {
  const sorted = [...history].sort((a, b) => a.day.localeCompare(b.day));
  const end = stamp(today || isoDay(Date.now()));
  const start = days ? end - (days - 1) * DAY : Math.min(stamp(sorted[0]?.day || isoDay(end - 6 * DAY)), end - DAY);
  const byDay = new Map(sorted.filter(item => stamp(item.day) <= end).map(item => [item.day, item]));
  const series = [];
  for (let time = start; time <= end; time += DAY) {
    const day = isoDay(time);
    series.push({ day, snapshot: byDay.get(day) || null });
  }
  return series;
}

export function createDailyChart(history, { days = 30, today, width = 760, id = 'daily' } = {}) {
  const series = dailySeries(history, { days, today });
  const records = series.filter(item => item.snapshot).map(item => item.snapshot);
  if (!records.length) return { html: '<div class="daily-chart-empty">Ainda não há contagens neste período.<small>As consultas bem-sucedidas aparecerão aqui, uma por dia.</small></div>', records, series, delta: null };
  width = Math.max(290, width);
  const height = 250, left = 48, right = 18, top = 20, bottom = 38;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const maxCount = Math.max(1, ...records.map(item => item.count));
  const unit = 10 ** Math.floor(Math.log10(maxCount));
  const ceiling = Math.max(4, Math.ceil(maxCount / unit) * unit);
  const x = index => left + (index / Math.max(1, series.length - 1)) * plotWidth;
  const y = count => top + plotHeight - (count / ceiling) * plotHeight;
  const chunks = [];
  let chunk = [];
  const points = [];
  series.forEach((item, index) => {
    if (!item.snapshot) { if (chunk.length) chunks.push(chunk); chunk = []; return; }
    const point = { x: x(index), y: y(item.snapshot.count), snapshot: item.snapshot };
    chunk.push(point);
    points.push(point);
  });
  if (chunk.length) chunks.push(chunk);
  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = Math.round(ceiling * index / 4);
    const at = y(value);
    return `<line x1="${left}" y1="${at}" x2="${width-right}" y2="${at}" class="daily-grid"/><text x="${left-10}" y="${at+4}" text-anchor="end" class="daily-tick">${number(value)}</text>`;
  }).join('');
  const tickCount = Math.min(width < 450 ? 4 : 7, series.length);
  const dates = Array.from({ length: tickCount }, (_, index) => {
    const at = Math.round(index * (series.length-1) / Math.max(1, tickCount-1));
    return `<text x="${x(at)}" y="${height-12}" text-anchor="${index===0?'start':index===tickCount-1?'end':'middle'}" class="daily-tick">${dateLabel(series[at].day)}</text>`;
  }).join('');
  const paths = chunks.map(segment => {
    if (segment.length < 2) return '';
    const line = segment.map(point => `${point.x},${point.y}`).join(' ');
    return `<polygon points="${segment[0].x},${height-bottom} ${line} ${segment.at(-1).x},${height-bottom}" fill="url(#area-${id})"/><polyline points="${line}" class="daily-line"/>`;
  }).join('');
  const dots = points.map(({x,y,snapshot}, index) => `<g class="daily-point" tabindex="0" role="button" aria-label="${fullDate(snapshot.day)}: ${valueLabel(snapshot)} anúncios" data-chart-index="${index}"><circle cx="${x}" cy="${y}" r="12" fill="transparent"/><circle cx="${x}" cy="${y}" r="${points.length===1?5:3.5}" class="daily-dot"/><title>${fullDate(snapshot.day)} · ${escape(valueLabel(snapshot))} anúncios</title></g>`).join('');
  const html = `<svg class="daily-svg" viewBox="0 0 ${width} ${height}" role="group" aria-label="Quantidade de anúncios por dia. ${records.length} dias com contagem. Dias sem consulta aparecem como lacunas."><defs><linearGradient id="area-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#efce45" stop-opacity=".18"/><stop offset="100%" stop-color="#efce45" stop-opacity=".01"/></linearGradient></defs>${grid}${dates}${paths}${dots}</svg>`;
  return { html, records, series, delta: records.length > 1 ? records.at(-1).count - records[0].count : null };
}
