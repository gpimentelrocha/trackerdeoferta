import { randomUUID } from 'node:crypto';
import { EXPENSE_CATEGORIES, MAX_AMOUNT_CENTS, validDay } from '../public/finance-math.js';
export const FINANCE_COLUMNS = ['id','offer_id','offer_name','type','category','day','amount_cents','description','created_at','updated_at'];
export const FINANCE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS own_finance (
    id TEXT PRIMARY KEY, offer_id TEXT REFERENCES own_offers(id) ON DELETE SET NULL,
    offer_name TEXT NOT NULL DEFAULT '', type TEXT NOT NULL CHECK(type IN ('revenue','expense')),
    category TEXT NOT NULL, day TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
    description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS own_finance_day ON own_finance(day,offer_id)'
];
function fail(message,status=400) {const error=new Error(message);error.status=status;throw error;}
export function financeInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Informe os dados do lançamento.');
  const {type,category,day,amount_cents}=input;
  if (!['revenue','expense'].includes(type)) fail('Escolha faturamento ou despesa.');
  if ((type==='revenue' && category!=='sales') || (type==='expense' && !Object.hasOwn(EXPENSE_CATEGORIES,category))) fail('Escolha uma categoria válida.');
  if (!validDay(day)) fail('Informe uma data válida entre 2000 e 2100.');
  if (!Number.isSafeInteger(amount_cents) || amount_cents <= 0 || amount_cents > MAX_AMOUNT_CENTS) fail('Informe um valor positivo em centavos, de até R$ 1 bilhão.');
  const offer_id=input.offer_id === undefined || input.offer_id === '' ? null : input.offer_id;
  if (offer_id !== null && (typeof offer_id !== 'string' || offer_id.length > 100)) fail('Escolha uma oferta válida.');
  const description=input.description ?? '';
  if (typeof description !== 'string' || description.length>500) fail('A descrição deve ter até 500 caracteres.');
  return {offer_id,type,category,day,amount_cents,description:description.trim()};
}
export function financeRange(query) {
  const from=query.from ?? '',to=query.to ?? '';
  if ((from && !validDay(from)) || (to && !validDay(to)) || (from && to && from>to)) fail('Informe um período válido.');
  return {from,to};
}
export function createFinanceStore(execute) {
  const sql=(sql,args=[])=>({sql,args});
  const get=async id=>(await execute(sql('SELECT * FROM own_finance WHERE id=?',[id]))).rows[0] || null;
  async function offerName(id) {
    if (!id) return '';
    const offer=(await execute(sql('SELECT name FROM own_offers WHERE id=?',[id]))).rows[0];
    if (!offer) fail('Oferta não encontrada.',404);
    return offer.name;
  }
  return {
    get,
    async list({from='',to=''}={}) {
      return (await execute(sql(`SELECT f.*,o.name AS current_offer_name FROM own_finance f LEFT JOIN own_offers o ON o.id=f.offer_id
        WHERE (?='' OR f.day>=?) AND (?='' OR f.day<=?) ORDER BY f.day DESC,f.created_at DESC,f.id`,[from,from,to,to]))).rows;
    },
    async create(input) {
      const values=financeInput(input), id=randomUUID(), now=new Date().toISOString();
      const offer_name=await offerName(values.offer_id);
      // SELECT não insere se a oferta for removida entre a validação e a escrita.
      const result=await execute(sql(`INSERT INTO own_finance(id,offer_id,offer_name,type,category,day,amount_cents,description,created_at,updated_at)
        SELECT ?,?,?,?,?,?,?,?,?,? WHERE ? IS NULL OR EXISTS(SELECT 1 FROM own_offers WHERE id=?)`,[id,values.offer_id,offer_name,values.type,values.category,values.day,values.amount_cents,values.description,now,now,values.offer_id,values.offer_id]));
      if (!result.rowsAffected) fail('Oferta não encontrada.',404);
      return get(id);
    },
    async update(id,input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Informe os dados do lançamento.');
      const old=await get(id);
      if (!old) return null;
      const values=financeInput({...old,...input});
      const offer_name=Object.hasOwn(input,'offer_id') ? await offerName(values.offer_id) : values.offer_id ? await offerName(values.offer_id) : old.offer_name;
      const result=await execute(sql(`UPDATE own_finance SET offer_id=?,offer_name=?,type=?,category=?,day=?,amount_cents=?,description=?,updated_at=? WHERE id=?
        AND (? IS NULL OR EXISTS(SELECT 1 FROM own_offers WHERE id=?))`,[values.offer_id,offer_name,values.type,values.category,values.day,values.amount_cents,values.description,new Date().toISOString(),id,values.offer_id,values.offer_id]));
      if (!result.rowsAffected) return null;
      return get(id);
    },
    async remove(id) {return (await execute(sql('DELETE FROM own_finance WHERE id=?',[id]))).rowsAffected>0;}
  };
}
export function registerFinanceRoutes(app,finance) {
  const route=handler=>async(req,res,next)=>{try{await handler(req,res);}catch(error){if([400,404].includes(error.status))res.status(error.status).json({error:error.message});else next(error);}};
  app.get('/api/finance',route(async(req,res)=>res.json({entries:await finance.list(financeRange(req.query))})));
  app.post('/api/finance/entries',route(async(req,res)=>res.status(201).json(await finance.create(req.body))));
  app.patch('/api/finance/entries/:id',route(async(req,res)=>{
    const entry=await finance.update(req.params.id,req.body);
    if(!entry)return res.status(404).json({error:'Lançamento não encontrado.'});
    res.json(entry);
  }));
  app.delete('/api/finance/entries/:id',route(async(req,res)=>{
    if(!await finance.remove(req.params.id))return res.status(404).json({error:'Lançamento não encontrado.'});
    res.status(204).end();
  }));
}
