export const EXPENSE_CATEGORIES = { ads:'Anúncios', bm:'BM', proxy:'Proxy', tax:'Impostos', fees:'Taxas', tools:'Ferramentas', team:'Equipe e serviços', product:'Produto e logística', refunds:'Reembolsos', other:'Outros' };
export const MAX_AMOUNT_CENTS = 100_000_000_000;
export function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value+'T12:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0,10) === value && value >= '2000-01-01' && value <= '2100-12-31';
}
export function parseMoney(input) {
  if (typeof input !== 'string') throw new Error('Informe um valor em reais.');
  let text = input.trim().replace(/^R\$\s*/,'').replace(/\s/g,'');
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(text)) text=text.replaceAll('.','');
  if (!/^\d+([,.]\d{1,2})?$/.test(text)) throw new Error('Use um valor como 1.234,56, com até duas casas decimais.');
  const [whole,fraction=''] = text.replace(',','.').split('.');
  const cents = Number(whole)*100 + Number(fraction.padEnd(2,'0'));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_AMOUNT_CENTS) throw new Error('Informe um valor maior que zero e de até R$ 1 bilhão.');
  return cents;
}
export const money = cents => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
export const todayInBrazil = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Fortaleza',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function periodRange(period,today=todayInBrazil(),from='',to='') {
  if (period === 'all') return {from:'',to:''};
  if (period === 'custom') {
    if (!validDay(from) || !validDay(to) || from > to) throw new Error('Escolha um período válido; o início deve vir antes do fim.');
    return {from,to};
  }
  if (period === 'month') return {from:today.slice(0,7)+'-01',to:today};
  const date=new Date(today+'T12:00:00Z');
  date.setUTCDate(date.getUTCDate()-(period === '7' ? 6 : 29));
  return {from:date.toISOString().slice(0,10),to:today};
}
export function summarizeEntries(entries) {
  let revenue=0,expense=0;
  const categories={}, days=new Map();
  for (const entry of entries) {
    const value=entry.amount_cents;
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Valor financeiro inválido.');
    const daily=days.get(entry.day) || {day:entry.day,revenue:0,expense:0};
    if (entry.type === 'revenue') {revenue+=value;daily.revenue+=value;}
    else if (entry.type === 'expense') {expense+=value;daily.expense+=value;categories[entry.category]=(categories[entry.category]||0)+value;}
    else throw new Error('Tipo de lançamento inválido.');
    if (!Number.isSafeInteger(revenue) || !Number.isSafeInteger(expense)) throw new Error('O total excede o limite de cálculo.');
    days.set(entry.day,daily);
  }
  return {revenue,expense,profit:revenue-expense,margin:revenue ? (revenue-expense)/revenue*100 : null,categories,days:[...days.values()].sort((a,b)=>a.day.localeCompare(b.day))};
}
