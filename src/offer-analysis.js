import { daysBetween, decodeAdSample } from './ad-dates.js';
import { localDate } from './time.js';
export const SNAPSHOT_FIELDS = 's.day,s.count,s.precision,s.label,s.collected_at,CASE WHEN s.day=(SELECT MAX(n.day) FROM snapshots n WHERE n.offer_id=s.offer_id) THEN s.ad_sample ELSE NULL END AS ad_sample';
const round = value => Math.round(value * 10) / 10;

export function analyzeOffer(offer, history, sampleValue, today = localDate()) {
  const latest = history.at(-1);
  const sample = decodeAdSample(sampleValue);
  const ads = (sample?.ads || []).map(ad => ({ ...ad, days_running: daysBetween(ad.start_date, latest?.day) }))
    .filter(ad => ad.days_running !== null && ad.days_running >= 0).sort((a, b) => b.days_running - a.days_running);
  const sortedAges = ads.map(ad => ad.days_running).sort((a, b) => a - b);
  const middle = Math.floor(sortedAges.length / 2);
  const median = sortedAges.length ? (sortedAges.length % 2 ? sortedAges[middle] : (sortedAges[middle - 1] + sortedAges[middle]) / 2) : null;
  const base = {
    score: null, label: 'Sem avaliação', provisional: true, criteria: [], ads,
    sampled_ads: ads.length, oldest_days: ads[0]?.days_running ?? null,
    oldest_start_date: ads[0]?.start_date ?? null, median_days: median === null ? null : Math.floor(median),
    observed_at: latest?.collected_at || null, observed_on: latest?.day || null,
    reason: '', disclaimer: 'Triagem por sinais públicos; não comprova vendas, lucro ou retorno.',
    sample_note: 'Amostra dos anúncios ativos carregados. O mais antigo observado pode não ser o mais antigo de toda a oferta. Dias desde o início informado; pausas não são conhecidas.'
  };
  if (!latest) return { ...base, reason: 'Atualize a oferta para coletar contagem e datas de início.' };
  const stale = daysBetween(latest.day, today);
  if (offer.state === 'error' || stale === null || stale > 2) return { ...base, reason: 'Atualize a oferta: a última consulta falhou ou os dados estão desatualizados.' };
  let activeOnly = false;
  try { activeOnly = new URL(offer.url).searchParams.get('active_status') === 'active'; } catch {}
  if (!activeOnly) return { ...base, reason: 'Para calcular a nota, use um link da Biblioteca com o filtro Anúncios ativos.' };
  if (latest.count === 0) return { ...base, score: 0, label: 'Sem anúncios ativos', provisional: false, reason: 'A Biblioteca informou zero resultados nos filtros do link.' };
  if (!ads.length) return { ...base, reason: 'Ainda não há datas de anúncios ativos nesta coleta. Clique em Atualizar para tentar coletá-las.' };
  const longevity = median >= 60 ? 5 : median >= 30 ? 4 : median >= 14 ? 3 : median >= 7 ? 2 : median >= 3 ? 1 : 0.5;
  const mature = ads.filter(ad => ad.days_running >= 14).length;
  const maturity = 1.5 * mature / ads.length;
  const volume = latest.count >= 100 ? 2 : latest.count >= 30 ? 1.5 : latest.count >= 10 ? 1 : latest.count >= 3 ? 0.5 : 0.25;
  const criteria = [
    { label: 'Longevidade', points: longevity, maximum: 5, detail: `Mediana de ${round(median)} dias na amostra. Faixas: 0–2 dias = 0,5; 3–6 = 1; 7–13 = 2; 14–29 = 3; 30–59 = 4; 60+ = 5.` },
    { label: 'Anúncios com 14+ dias', points: round(maturity), maximum: 1.5, detail: `${mature} de ${ads.length} anúncios observados iniciaram há pelo menos 14 dias. Pontos proporcionais a essa fração.` },
    { label: 'Volume ativo', points: volume, maximum: 2, detail: `Contagem publicada: ${latest.label}. Faixas: 1–2 = 0,25; 3–9 = 0,5; 10–29 = 1; 30–99 = 1,5; 100+ = 2.` }
  ];
  const previous = [...history].reverse().find(row => {
    const gap = daysBetween(row.day, latest.day);
    return gap >= 7 && gap <= 14 && row.precision !== 'lower_bound' && latest.precision !== 'lower_bound';
  });
  let trend = null;
  if (previous) {
    const growth = previous.count ? (latest.count - previous.count) / previous.count : latest.count > 0 ? 1 : 0;
    trend = growth >= 0.2 ? 1.5 : growth >= 0 ? 1 : growth >= -0.2 ? 0.5 : 0;
    criteria.push({ label: 'Evolução da contagem', points: trend, maximum: 1.5, detail: `De ${previous.label} em ${previous.day} para ${latest.label} em ${latest.day}. Crescimento de 20%+ = 1,5; estável ou crescimento menor = 1; queda até 20% = 0,5; queda maior = 0.` });
  }
  const total = longevity + maturity + volume + (trend ?? 0);
  const available = 8.5 + (trend === null ? 0 : 1.5);
  const score = Math.min(10, Math.max(0, round(total / available * 10)));
  return { ...base, score, criteria, provisional: trend === null || ads.length < 5,
    label: score >= 8 ? 'Priorizar análise' : score >= 6 ? 'Vale investigar' : score >= 4 ? 'Acompanhar' : 'Poucos sinais',
    reason: trend === null ? 'Nota provisória: ainda falta uma comparação de contagem entre 7 e 14 dias. A nota é proporcional aos critérios disponíveis.' : 'Nota calculada por longevidade, anúncios com 14+ dias, volume e evolução da contagem.',
    approximate_counts: latest.precision !== 'exact' || (previous && previous.precision !== 'exact') || false
  };
}

// O JSON das amostras históricas permanece no banco; a API devolve só a amostra
// mais recente, evitando multiplicar o tamanho da resposta a cada dia.
export function attachOfferAnalysis(offer, rows) {
  const history = rows.map(({ ad_sample, ...row }) => row);
  const latest = history.at(-1) || null;
  const previous = history.at(-2) || null;
  return { ...offer, history, latest, previous, delta: latest && previous ? latest.count - previous.count : null,
    analysis: analyzeOffer(offer, history, rows.at(-1)?.ad_sample) };
}
