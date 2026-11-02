import {EXPENSE_CATEGORIES} from './finance-math.js';
const asOptions=labels=>Object.fromEntries(labels.map(label=>[label,label]));
export const OPTION_DEFINITIONS={
  expense_category:{title:'categoria de despesa',max:80,values:EXPENSE_CATEGORIES},
  niche:{title:'nicho',max:80,values:asOptions(['Renda extra','Emagrecimento','Saúde e bem-estar','Beleza','Relacionamentos','Finanças','Desenvolvimento pessoal','Educação','Pets','Casa e decoração','Tecnologia','Moda','Espiritualidade','Prosperidade','Outros'])},
  angle:{title:'ângulo',max:120,values:asOptions(['Dor e solução','Desejo','Curiosidade','Prova social','Quebra de objeção','Autoridade','Comparação','História pessoal'])},
  format:{title:'formato',max:80,values:asOptions(['UGC','Depoimento','Demonstração','Tutorial','Storytelling','Imagem estática','Carrossel','React','Podcast','Review'])}
};
export const normalizeOption=label=>label.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export const builtinOptions=kind=>Object.entries(OPTION_DEFINITIONS[kind].values).map(([value,label])=>({value,label,custom:false}));
