import { randomUUID } from 'node:crypto';

export const OPERATION_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS own_offers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, niche TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'idea', sales_url TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS own_materials (
    id TEXT PRIMARY KEY, offer_id TEXT NOT NULL REFERENCES own_offers(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
    angle TEXT NOT NULL DEFAULT '', format TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft', url TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS own_materials_offer ON own_materials(offer_id, updated_at)'
];
const offerRules = { name:100, niche:80, status:['idea','production','testing','scaling','paused'], sales_url:'url', notes:10000 };
const materialRules = { title:120, kind:['copy','script','creative','angle'], content:30000, angle:120, format:80, status:['draft','ready','testing','winner','archived'], url:'url' };
export const OPERATION_TABLE_COLUMNS = {
  own_offers:['id',...Object.keys(offerRules),'created_at','updated_at'],
  own_materials:['id','offer_id',...Object.keys(materialRules),'created_at','updated_at']
};
function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
export function operationInput(input, { material = false, partial = false } = {}) {
  const rules = material ? materialRules : offerRules;
  const values = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Envie os dados do cadastro.');
  for (const [key, rule] of Object.entries(rules)) {
    if (partial && !Object.hasOwn(input, key)) continue;
    let value = input[key];
    if (value === undefined && !partial) value = key === 'status' ? (material ? 'draft' : 'idea') : key === 'kind' ? 'copy' : '';
    if (typeof value !== 'string') fail('Preencha os campos com textos válidos.');
    if (!['content','notes'].includes(key)) value = value.trim();
    if ((key === 'name' || key === 'title') && !value) fail('Preencha o nome ou título.');
    if (Array.isArray(rule) && !rule.includes(value)) fail('Escolha uma opção válida para o tipo ou status.');
    if (typeof rule === 'number' && value.length > rule) fail(`O campo ${key} deve ter até ${rule.toLocaleString('pt-BR')} caracteres.`);
    if (rule === 'url' && value) {
      let url;
      try { url = new URL(value); } catch { fail('Use um link completo começando com https:// ou http://.'); }
      if (value.length > 2048 || !/^https?:\/\//i.test(value) || !['http:','https:'].includes(url.protocol) || url.username || url.password) fail('Use um link válido, com até 2.048 caracteres e sem usuário ou senha.');
      value = url.href;
    }
    values[key] = value;
  }
  if (!Object.keys(values).length) fail('Informe os campos que deseja alterar.');
  return values;
}

export function createOperationStore(execute, batch) {
  const statement = (sql, args = []) => ({ sql, args });
  const get = async id => (await execute(statement('SELECT * FROM own_offers WHERE id=?', [id]))).rows[0] || null;
  const getMaterial = async (offerId, id) => (await execute(statement('SELECT * FROM own_materials WHERE offer_id=? AND id=?', [offerId,id]))).rows[0] || null;
  return {
    get,
    async list() {
      return (await execute(`SELECT o.*, COUNT(m.id) AS material_count,
        SUM(CASE WHEN m.kind='creative' THEN 1 ELSE 0 END) AS creative_count
        FROM own_offers o LEFT JOIN own_materials m ON m.offer_id=o.id
        GROUP BY o.id ORDER BY o.updated_at DESC, o.id`)).rows;
    },
    async create(input) {
      const values = operationInput(input), id = randomUUID(), now = new Date().toISOString();
      const columns = Object.keys(values);
      await execute(statement(`INSERT INTO own_offers(id,${columns.join(',')},created_at,updated_at) VALUES(?,${columns.map(()=>'?').join(',')},?,?)`, [id,...Object.values(values),now,now]));
      return get(id);
    },
    async update(id, input) {
      const values = operationInput(input, { partial:true });
      await execute(statement(`UPDATE own_offers SET ${Object.keys(values).map(key=>key+'=?').join(',')},updated_at=? WHERE id=?`, [...Object.values(values),new Date().toISOString(),id]));
      return get(id);
    },
    async remove(id) {
      const results = await batch([
        statement('DELETE FROM own_materials WHERE offer_id=?',[id]),
        statement('DELETE FROM own_offers WHERE id=?',[id])
      ], 'write');
      return results[1].rowsAffected > 0;
    },
    async materials(offerId) {
      return (await execute(statement('SELECT * FROM own_materials WHERE offer_id=? ORDER BY updated_at DESC, id',[offerId]))).rows;
    },
    async createMaterial(offerId, input) {
      const values = operationInput(input, { material:true }), id = randomUUID(), now = new Date().toISOString();
      const columns = Object.keys(values);
      const inserted = await execute(statement(`INSERT INTO own_materials(id,offer_id,${columns.join(',')},created_at,updated_at) SELECT ?,id,${columns.map(()=>'?').join(',')},?,? FROM own_offers WHERE id=?`, [id,...Object.values(values),now,now,offerId]));
      if (!inserted.rowsAffected) fail('Oferta não encontrada.',404);
      return getMaterial(offerId,id);
    },
    async updateMaterial(offerId, id, input) {
      const values = operationInput(input, { material:true, partial:true });
      await execute(statement(`UPDATE own_materials SET ${Object.keys(values).map(key=>key+'=?').join(',')},updated_at=? WHERE offer_id=? AND id=?`, [...Object.values(values),new Date().toISOString(),offerId,id]));
      return getMaterial(offerId,id);
    },
    async removeMaterial(offerId, id) {
      return (await execute(statement('DELETE FROM own_materials WHERE offer_id=? AND id=?',[offerId,id]))).rowsAffected > 0;
    }
  };
}
