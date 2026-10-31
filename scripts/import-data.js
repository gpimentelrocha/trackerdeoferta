import { resolve } from 'node:path';
import { createCloudStore } from '../src/store-libsql.js';
import { importLocalData } from '../src/import-data.js';
let store;
try {
  store = await createCloudStore();
  const result = await importLocalData(store, resolve(process.argv[2] || 'data/tracker.sqlite'));
  console.log(`Migração concluída: ${result.offers} oferta(s), ${result.snapshots} contagem(ns), ${result.ownOffers} oferta(s) própria(s) e ${result.materials} material(is) e ${result.finances} lançamento(s). O arquivo de origem foi preservado.`);
} catch (error) {
  // Bibliotecas HTTP podem incluir detalhes da conexão; não exponha credenciais.
  const safe = ['destino deve estar vazio', 'suporta até', 'Configure TURSO'].some(part => error.message.includes(part));
  console.error(safe ? error.message : 'Não foi possível importar. Verifique o arquivo local e as configurações de acesso ao Turso.');
  process.exitCode = 1;
} finally { store?.close(); }
