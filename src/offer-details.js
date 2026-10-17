export const OFFER_DETAIL_COLUMNS = ['offer_type', 'niche', 'funnel'];
const types = ['info', 'drop'];
const funnels = ['TSL', 'VSL', 'QUIZ', 'QUIZ + VSL'];
function invalid(message) { const error = new Error(message); error.status = 400; throw error; }

// Valores ausentes ficam vazios para manter compatibilidade com ofertas antigas.
export function offerDetails(input = {}, { partial = false } = {}) {
  const result = {};
  for (const key of OFFER_DETAIL_COLUMNS) {
    if (partial && !Object.hasOwn(input, key)) continue;
    const value = input[key];
    if (value === undefined || value === null || value === '') { result[key] = null; continue; }
    if (typeof value !== 'string') invalid('Tipo, nicho e formato devem ser textos.');
    const text = value.trim();
    if (!text) { result[key] = null; continue; }
    if (key === 'offer_type') {
      const type = text.toLowerCase();
      if (!types.includes(type)) invalid('Escolha Info ou Drop para o tipo da oferta.');
      result[key] = type;
    } else if (key === 'funnel') {
      const funnel = text.toUpperCase().replace(/\s*\+\s*/g, ' + ');
      if (!funnels.includes(funnel)) invalid('Escolha TSL, VSL, QUIZ ou QUIZ + VSL para o formato.');
      result[key] = funnel;
    } else {
      if (text.length > 80) invalid('O nicho deve ter até 80 caracteres.');
      result[key] = text;
    }
  }
  return result;
}
