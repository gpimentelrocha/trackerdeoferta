import {randomUUID} from 'node:crypto';
import {OPTION_DEFINITIONS,normalizeOption,builtinOptions} from '../public/option-definitions.js';
export const CUSTOM_OPTIONS_COLUMNS=['id','kind','label','normalized','created_at'];
export const CUSTOM_OPTIONS_SCHEMA=[`CREATE TABLE IF NOT EXISTS custom_options (
  id TEXT PRIMARY KEY,kind TEXT NOT NULL,label TEXT NOT NULL,normalized TEXT NOT NULL,
  created_at TEXT NOT NULL,UNIQUE(kind,normalized)
)`];
const fail=message=>{const error=new Error(message);error.status=400;throw error;};
const financeKind=kind=>kind==='expense_category';
const view=row=>({value:financeKind(row.kind)?row.id:row.label,label:row.label,custom:true});
export function createCustomOptionsStore(execute){
  const sql=(sql,args=[])=>({sql,args});
  return {
    async list(){
      const result=Object.fromEntries(Object.keys(OPTION_DEFINITIONS).map(kind=>[kind,builtinOptions(kind)]));
      const custom=(await execute('SELECT * FROM custom_options ORDER BY created_at,id')).rows;
      for(const row of custom)if(Object.hasOwn(result,row.kind))result[row.kind].push(view(row));
      return result;
    },
    async has(kind,value){
      if(Object.hasOwn(OPTION_DEFINITIONS[kind].values,value))return true;
      return Boolean((await execute(sql('SELECT id FROM custom_options WHERE kind=? AND id=?',[kind,value]))).rows[0]);
    },
    async create(input){
      const kind=input?.kind;
      if(typeof kind!=='string'||!Object.hasOwn(OPTION_DEFINITIONS,kind))fail('Escolha uma lista válida.');
      if(typeof input?.label!=='string')fail('Informe o nome da opção.');
      const label=input.label.trim().replace(/\s+/g,' '),normalized=normalizeOption(label),max=OPTION_DEFINITIONS[kind].max;
      if(!normalized||label.length>max)fail(`O nome deve ter entre 1 e ${max} caracteres e conter uma letra ou número.`);
      const builtin=builtinOptions(kind).find(option=>normalizeOption(option.label)===normalized);
      if(builtin)return builtin;
      await execute(sql('INSERT INTO custom_options(id,kind,label,normalized,created_at) VALUES(?,?,?,?,?) ON CONFLICT(kind,normalized) DO NOTHING',['custom_'+randomUUID(),kind,label,normalized,new Date().toISOString()]));
      return view((await execute(sql('SELECT * FROM custom_options WHERE kind=? AND normalized=?',[kind,normalized]))).rows[0]);
    }
  };
}
export function registerCustomOptionsRoutes(app,options){
  app.get('/api/options',async(req,res,next)=>{try{res.json({options:await options.list()});}catch(error){next(error);}});
  app.post('/api/options',async(req,res,next)=>{
    try{res.status(201).json(await options.create(req.body));}
    catch(error){if(error.status===400)res.status(400).json({error:error.message});else next(error);}
  });
}
