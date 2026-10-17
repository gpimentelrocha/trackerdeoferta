const linkLabels = {
  sales_url: 'página de vendas', checkout_url: 'checkout',
  backredirect_url: 'backredirect', upsell_url: 'upsell'
};
export const OFFER_DETAIL_COLUMNS = ['offer_type', 'niche', 'funnel', 'market', ...Object.keys(linkLabels)];
const markets = ['BR', 'LATAM', 'EUA'];
const types = ['info', 'drop'];
const funnels = ['TSL', 'VSL', 'QUIZ', 'QUIZ + VSL', 'X1'];
function invalid(message) { const error = new Error(message); error.status = 400; throw error; }

// Valores ausentes ficam vazios para manter compatibilidade com ofertas antigas.
export function offerDetails(input = {}, { partial = false } = {}) {
  const result = {};
  for (const key of OFFER_DETAIL_COLUMNS) {
    if (partial && !Object.hasOwn(input, key)) continue;
    const value = input[key];
    if (value === undefined || value === null || value === '') { result[key] = null; continue; }
    if (typeof value !== 'string') invalid('Os detalhes da oferta devem ser textos.');
    const text = value.trim();
    if (!text) { result[key] = null; continue; }
    if (Object.hasOwn(linkLabels, key)) {
      const message = `Informe um link de ${linkLabels[key]} válido, começando com https:// ou http:// (até 2.048 caracteres).`;
      let url;
      try { url = new URL(text); } catch { invalid(message); }
      if (text.length > 2048 || !/^https?:\/\//i.test(text) || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) invalid(message);
      result[key] = url.href;
    } else if (key === 'offer_type') {
      const type = text.toLowerCase();
      if (!types.includes(type)) invalid('Escolha Info ou Drop para o tipo da oferta.');
      result[key] = type;
    } else if (key === 'funnel') {
      const funnel = text.toUpperCase().replace(/\s*\+\s*/g, ' + ');
      if (!funnels.includes(funnel)) invalid('Escolha TSL, VSL, QUIZ, QUIZ + VSL ou X1 para o formato.');
      result[key] = funnel;
    } else if (key === 'market') {
      const market = text.toUpperCase();
      if (!markets.includes(market)) invalid('Escolha BR, LATAM ou EUA para o país/mercado.');
      result[key] = market;
    } else {
      if (text.length > 80) invalid('O nicho deve ter até 80 caracteres.');
      result[key] = text;
    }
  }
  return result;
}
