const STATE_VERSION = 5;
const IDB_DB_NAME = 'central_analise_db_v1';
const IDB_STORE = 'kv';
const IDB_STATE_KEY = 'appState';
const legacyStateKey = STORAGE_KEY;
// 'sap' é excluído do snapshot unificado — salvo em chunks separados
const saveSnapshotKeys = ['configs', 'filiais', 'materiais', 'gruposMateriais', 'regionaisCentrais', 'entradas', 'saidas', 'lancamentos', 'sap', 'producao', 'imports', 'ocorrencias', 'acoesRelatorio', 'notifications', 'invJustificativas', 'sapFechamentoOverrides', 'ajustesSistemicos', 'ajustesExcluidos', 'notasAjuste'];
const SAP_CHUNK_SIZE  = 10000;  // registros por chunk
const SAP_CHUNK_KEY   = 'sap_chunk_'; // prefixo das chaves: sap_chunk_0, sap_chunk_1...
const SAP_META_KEY    = 'sap_meta';   // { totalChunks, totalRecords, savedAt }

let idbOpenPromise = null;
let persistTimer = null;
let persistInFlight = false;
let persistQueued = false;
let stateHydrated = false;

// ── Tombstone de exclusões pendentes ──────────────────────────────────────
// Problema: excluirImportacao() atualiza o state em memória e agenda persist()
// (debounce de 1500ms, seguido de uma gravação que pode levar segundos com
// muitos registros SAP). Se a aba fechar/recarregar antes disso completar, a
// exclusão nunca chega a ser gravada no IndexedDB — no próximo boot, os dados
// "excluídos" reaparecem (chunks SAP antigos intactos, entre outros).
// beforeunload/pagehide não resolvem: não disparam em fechamento abrupto
// (crash, encerrar processo) e mesmo quando disparam, o emergency save
// existente exclui o SAP de propósito (ver _emergencySave).
// Solução: grava uma marca SÍNCRONA no localStorage no exato momento da
// exclusão — sobrevive a fechamentos abruptos porque não depende de nenhum
// evento de saída. No próximo boot, reconcilePendingDeletes() confere se os
// dados marcados como excluídos ainda estão presentes no que foi carregado;
// se estiverem, refaz a exclusão em memória e força uma gravação corretiva.
const PENDING_DELETES_KEY = 'central_analise_pending_deletes_v1';

function markImportPendingDelete(importId) {
  if (!importId) return;
  try {
    const raw = localStorage.getItem(PENDING_DELETES_KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (Array.isArray(list) && !list.includes(importId)) {
      list.push(importId);
      localStorage.setItem(PENDING_DELETES_KEY, JSON.stringify(list));
    }
  } catch (err) {
    console.warn('[Persist] Falha ao gravar tombstone de exclusão:', err);
  }
}

function unmarkImportPendingDelete(importId) {
  if (!importId) return;
  try {
    const raw = localStorage.getItem(PENDING_DELETES_KEY);
    if (!raw) return;
    const list = JSON.parse(raw).filter(id => id !== importId);
    if (list.length) localStorage.setItem(PENDING_DELETES_KEY, JSON.stringify(list));
    else localStorage.removeItem(PENDING_DELETES_KEY);
  } catch (err) {
    console.warn('[Persist] Falha ao limpar tombstone de exclusão:', err);
  }
}

// Chamado no boot, depois que o estado salvo foi aplicado. Se algum importId
// marcado como "excluído" ainda aparece nos dados carregados, é sinal de que
// a exclusão não chegou a ser persistida antes do fechamento anterior — refaz
// o filtro em memória (mesma lógica de excluirImportacao) e grava de novo.
async function reconcilePendingDeletes() {
  let list;
  try {
    const raw = localStorage.getItem(PENDING_DELETES_KEY);
    list = raw ? JSON.parse(raw) : [];
  } catch (err) {
    return;
  }
  if (!Array.isArray(list) || !list.length) return;

  const removeByImport = arr => (arr || []).filter(r => r.fonte === 'manual' || !list.includes(r.importId));
  let touched = false;
  ['entradas', 'saidas', 'lancamentos', 'sap', 'producao', 'filiais', 'materiais'].forEach(key => {
    const before = (state[key] || []).length;
    state[key] = removeByImport(state[key]);
    if (state[key].length !== before) touched = true;
  });
  if (Array.isArray(state.imports)) {
    const beforeImports = state.imports.length;
    state.imports = state.imports.filter(r => !list.includes(r.id));
    if (state.imports.length !== beforeImports) {
      touched = true;
      // A exclusão não tinha sido persistida localmente a tempo — também não
      // deve ter sido sincronizada com a nuvem. Reconcilia lá também,
      // incluindo a cascata nas demais tabelas (Fase 4 — Etapa 7).
      if (typeof _importsSyncDelete === 'function') list.forEach(_importsSyncDelete);
      if (typeof _cascadeDeleteCloudByImportId === 'function') list.forEach(_cascadeDeleteCloudByImportId);
    }
  }

  if (!touched) {
    // Nada para corrigir — a exclusão já tinha sido persistida corretamente.
    try { localStorage.removeItem(PENDING_DELETES_KEY); } catch (_) {}
    return;
  }

  console.warn('[Persist] Reconciliando exclusão(ões) que não haviam sido persistidas antes do fechamento anterior:', list);
  if (typeof invalidateMaterialLookup === 'function') invalidateMaterialLookup();
  if (typeof invalidateFilialLookup === 'function') invalidateFilialLookup();
  if (typeof invalidateLancIndex === 'function') invalidateLancIndex();
  if (typeof invalidateSapIndex === 'function') invalidateSapIndex();
  if (typeof invalidateSaidasIndex === 'function') invalidateSaidasIndex();
  if (typeof invalidateAllSearchIndexes === 'function') invalidateAllSearchIndexes();

  const ok = await persistStateNow().catch(() => false);
  if (ok) {
    try { localStorage.removeItem(PENDING_DELETES_KEY); } catch (_) {}
  }
  // Se não conseguiu gravar agora (ex.: aba ainda não promovida a ativa), a
  // marca permanece — o estado em memória desta sessão já está corrigido, e
  // o próximo boot tenta reconciliar (e gravar) de novo.
}

function openDb() {
  if (!('indexedDB' in window)) return Promise.resolve(null);
  if (idbOpenPromise) return idbOpenPromise;

  idbOpenPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => console.warn('IndexedDB bloqueado por outra aba.');
  });

  return idbOpenPromise;
}

function idbGet(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const store = tx.objectStore(IDB_STORE);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result?.value ?? null);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('Falha na transação do IndexedDB.'));
    tx.onabort = () => reject(tx.error || new Error('Transação do IndexedDB abortada.'));

    store.put({
      key,
      value,
      updatedAt: Date.now(),
      version: STATE_VERSION
    });
  });
}

// ── Persistência SAP em chunks ────────────────────────────────────────────────
// O SAP pode ter milhões de registros — gravar tudo num único objeto IndexedDB
// causa falha silenciosa. Salvamos em chunks de SAP_CHUNK_SIZE registros cada.

async function saveSapChunks(db, records) {
  if (!db || !Array.isArray(records)) return;
  const compacted = compactSapRecords(records);
  const totalChunks = Math.ceil(compacted.length / SAP_CHUNK_SIZE) || 1;

  const oldMeta = await idbGet(db, SAP_META_KEY).catch(() => null);
  const oldChunks = oldMeta?.totalChunks || 0;

  // Grava chunks novos em paralelo (batches de 10 para não travar a thread)
  const BATCH = 10;
  for (let b = 0; b < totalChunks; b += BATCH) {
    const writes = [];
    for (let i = b; i < Math.min(b + BATCH, totalChunks); i++) {
      const chunk = compacted.slice(i * SAP_CHUNK_SIZE, (i + 1) * SAP_CHUNK_SIZE);
      writes.push(idbPut(db, SAP_CHUNK_KEY + i, chunk));
    }
    await Promise.all(writes);
  }

  // Grava metadata — SÓ DEPOIS dos chunks novos estarem gravados.
  await idbPut(db, SAP_META_KEY, {
    totalChunks,
    totalRecords: compacted.length,
    savedAt: Date.now(),
    version: STATE_VERSION
  });

  // Apaga chunks antigos que possam ter sobrado de uma importação/exclusão que
  // reduziu o total de registros. Reordenado (jul/2026) para rodar por ÚLTIMO,
  // como limpeza best-effort: antes, isso rodava ANTES da escrita dos chunks
  // novos — uma interrupção nesse meio (fechamento da aba, crash) deixava o
  // meta.totalChunks antigo apontando para chunks já apagados, corrompendo o
  // próximo load ("chunks ausentes"). Agora, na pior hipótese de interrupção
  // (durante esta limpeza), os chunks excedentes antigos ficam apenas órfãos
  // — inofensivos, e limpos automaticamente na próxima gravação bem-sucedida —
  // o dado nunca fica inconsistente.
  if (oldChunks > totalChunks) {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      for (let i = totalChunks; i < oldChunks; i++) {
        store.delete(SAP_CHUNK_KEY + i);
      }
      await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
    } catch (err) {
      // Best-effort: se falhar, os chunks órfãos são limpos na próxima gravação.
      console.warn('[Persist] Falha ao limpar chunks SAP excedentes (não crítico):', err);
    }
  }

  console.info(`[Persist] SAP: ${compacted.length} registros salvos em ${totalChunks} chunk${totalChunks!==1?'s':''}`);
}

async function loadSapChunks(db) {
  if (!db) return [];
  try {
    const meta = await idbGet(db, SAP_META_KEY);
    if (!meta || !meta.totalChunks) return [];

    const chunks = await Promise.all(
      Array.from({ length: meta.totalChunks }, (_, i) => idbGet(db, SAP_CHUNK_KEY + i))
    );
    // Detecta chunks ausentes ou corrompidos (null = falha na leitura ou chave inexistente)
    const missingCount = chunks.filter(c => !Array.isArray(c)).length;
    if (missingCount > 0) {
      console.warn(`[Persist] SAP: ${missingCount} de ${meta.totalChunks} chunk(s) ausentes ou corrompidos. Dados SAP podem estar incompletos.`);
      toast(`⚠ ${missingCount} bloco(s) de dados SAP não puderam ser lidos. Os dados exibidos podem estar incompletos.`, 'error');
    }
    const records = chunks.filter(Array.isArray).flat();
    console.info(`[Persist] SAP carregado: ${records.length} registros de ${meta.totalChunks} chunk${meta.totalChunks!==1?'s':''}`);
    return records;
  } catch (err) {
    console.warn('[Persist] Erro ao carregar chunks SAP:', err);
    return [];
  }
}

// Compacta os registros SAP para persistência — mantém apenas os campos
// usados em cálculos e na UI, descartando campos redundantes ou vazios.
// Com 600k+ registros, cada campo extra pode custar 10-30MB de espaço.
const SAP_PERSIST_FIELDS = [
  'id',
  // BUG REAL (achado em 27/07): 'id' não estava nesta lista. Todo registro
  // SAP perdia o id a cada gravação/reload — o backfill de id (persist.js/
  // ui.js) então gerava um id NOVO e aleatório a cada boot, porque nenhum
  // registro chegava com id do disco. Como syncSAPFromSupabase() decide "já
  // sincronizei isso?" comparando pelo id, o id mudando a cada boot fazia
  // registros manuais já sincronizados serem reenviados como "novos" pra
  // nuvem toda vez que a página recarregava — 4 registros reais viraram
  // 295.200 linhas duplicadas na nuvem (e inflaram activity_log junto, via
  // trigger). Limpo em 27/07 (ver "Bugs corrigidos" no resumo do projeto).
  'movimento','peso','material','central','dtLanc','dtDoc','ref',
  'documento','usuario','deposito','dtReg','valorTotal','custoUnit',
  'categoria','um','importId','fonte',
  // Adicionados: sem esses campos, todo reload perdia materialOriginal/
  // centralOriginal (quebrando lookups de cadastro e reversão) e createdAt/
  // txtMov dos registros SAP persistidos.
  'materialOriginal','centralOriginal','createdAt','txtMov'
];
function compactSapRecords(records) {
  if (!Array.isArray(records) || records.length === 0) return records;
  return records.map(r => {
    const out = {};
    for (const f of SAP_PERSIST_FIELDS) {
      // Só inclui o campo se tiver valor (null/undefined/''/0 são omitidos para peso exceto peso)
      const v = r[f];
      if (f === 'peso') { out[f] = v ?? 0; continue; }
      if (v !== undefined && v !== null && v !== '') out[f] = v;
    }
    return out;
  });
}

// ── Anexos de DAI (Documento de Ajuste de Inventário) ─────────────────────
// Cópia local de CONVENIÊNCIA dos arquivos anexados a um DAI (imagens,
// docx, pdf de comprovação) — guardada em chaves separadas do snapshot
// principal (mesmo padrão dos chunks SAP: ver saveSapChunks acima), para
// não pesar toda gravação normal do sistema por causa de anexos binários
// grandes/antigos. A FONTE DA VERDADE é o ZIP baixado no momento da
// geração do documento (ver dai.js) — esta cópia serve só para reabrir/
// reimprimir o DAI depois, sem depender do ZIP ainda estar disponível na
// máquina do analista. idbPut já usa structured clone (não JSON.stringify),
// então aceita Blob/File nativamente, sem precisar converter para base64.
const DAI_ANEXO_KEY_PREFIX = 'dai_anexo_';

function daiAnexoKey(daiId, idx) {
  return `${DAI_ANEXO_KEY_PREFIX}${daiId}_${idx}`;
}

async function idbPutAnexoDai(daiId, idx, blob) {
  try {
    const db = await openDb();
    if (!db) return false;
    await idbPut(db, daiAnexoKey(daiId, idx), blob);
    return true;
  } catch (err) {
    console.warn('[Persist] Falha ao salvar cópia local do anexo DAI (não crítico — o ZIP baixado continua sendo a fonte oficial):', err);
    return false;
  }
}

async function idbGetAnexoDai(daiId, idx) {
  try {
    const db = await openDb();
    if (!db) return null;
    return await idbGet(db, daiAnexoKey(daiId, idx));
  } catch (err) {
    console.warn('[Persist] Falha ao ler cópia local do anexo DAI:', err);
    return null;
  }
}

// Remove todas as cópias locais de anexos de um DAI (chamado quando a
// ocorrência de Ajuste Sistêmico vinculada é excluída pelo analista — ver
// confirmarExcluirAjusteSistemico em ocorrencias.js). Best-effort: se
// falhar, os Blobs órfãos apenas ocupam espaço, sem causar inconsistência.
async function idbDeleteAnexosDai(daiId, count) {
  if (!daiId || !count) return;
  try {
    const db = await openDb();
    if (!db) return;
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    for (let i = 0; i < count; i++) store.delete(daiAnexoKey(daiId, i));
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  } catch (err) {
    console.warn('[Persist] Falha ao remover cópia(s) local(is) de anexo(s) DAI (não crítico):', err);
  }
}

// Limpeza de órfãos: cópias locais de anexos cujo DAI não existe mais em
// state.ajustesSistemicos (excluído por qualquer caminho — o próprio
// analista, outro admin, ou admin_reset_user). `ajustes_sistemicos` já
// sincroniza por completo com o Postgres (não é módulo híbrido), então a
// ausência do id ali já é o sinal de verdade — sem precisar de tombstone
// nenhum aqui, diferente do reset dos módulos híbridos (ver
// checarWipePendente, normalize.js). Chamada depois que
// syncAjustesSistemicosFromSupabase já rodou (boot e
// sincronizarDadosLocaisAgora, dashboard.js).
async function limparAnexosDaiOrfaos() {
  try {
    const db = await openDb();
    if (!db) return;
    const chaves = await new Promise((res, rej) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).getAllKeys();
      req.onsuccess = () => res(req.result || []);
      req.onerror = () => rej(req.error);
    });

    const idsVivos = new Set((state.ajustesSistemicos || []).map(d => d.id));
    // Chave: `dai_anexo_<daiId>_<idx>` — daiId pode ter underscore (formato
    // "dai_<timestamp>_<random>"), então o daiId é tudo antes do ÚLTIMO
    // underscore (idx é sempre o segmento final, puramente numérico).
    const orfas = chaves.filter(k => {
      if (typeof k !== 'string' || !k.startsWith(DAI_ANEXO_KEY_PREFIX)) return false;
      const resto = k.slice(DAI_ANEXO_KEY_PREFIX.length);
      const daiId = resto.slice(0, resto.lastIndexOf('_'));
      return daiId && !idsVivos.has(daiId);
    });
    if (!orfas.length) return;

    await new Promise((res, rej) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      orfas.forEach(k => tx.objectStore(IDB_STORE).delete(k));
      tx.oncomplete = res;
      tx.onerror = rej;
    });
    console.info(`[Persist] ${orfas.length} cópia(s) local(is) de anexo(s) DAI órfã(s) removida(s).`);
  } catch (err) {
    console.warn('[Persist] Falha ao limpar anexos DAI órfãos (não crítico):', err);
  }
}

function buildStateSnapshot() {
  return {
    version: STATE_VERSION,
    savedAt: Date.now(),
    configs: state.configs,
    filiais: state.filiais,
    materiais: state.materiais,
    gruposMateriais: state.gruposMateriais || [],
    regionaisCentrais: state.regionaisCentrais || [],
    entradas: state.entradas,
    saidas: state.saidas,
    lancamentos: state.lancamentos,
    sap: compactSapRecords(state.sap),
    producao: state.producao,
    imports: state.imports,
    ocorrencias: state.ocorrencias || [],
    acoesRelatorio: state.acoesRelatorio || [],
    notifications: state.notifications || [],
    invJustificativas: state.invJustificativas || [],
    sapFechamentoOverrides: state.sapFechamentoOverrides || [],
    ajustesSistemicos: state.ajustesSistemicos || [],
    ajustesExcluidos: state.ajustesExcluidos || [],
    notasAjuste: state.notasAjuste || []
  };
}

function applySavedState(saved) {
  if (!saved || typeof saved !== 'object') return false;

  const incomingConfigs = Array.isArray(saved.configs) ? saved.configs : [];
  state.configs = mergePersistentConfigs(state.configs, incomingConfigs);

  for (const key of saveSnapshotKeys) {
    if (key === 'configs') continue;
    // _skipSap: sinaliza que o SAP já foi carregado via chunks IDB e não deve
    // ser sobrescrito pelo snapshot legado do localStorage (que contém sap:[]).
    if (key === 'sap' && saved._skipSap) continue;
    if (!Array.isArray(saved[key])) continue;
    state[key] = saved[key];
  }

  state.materiais = (state.materiais || []).map(item => ({
    id: item?.id || makeMaterialId(),
    ...item
  }));

  // Backfill de id nos 5 módulos grandes (Entradas, Saídas, Lançamentos, SAP,
  // Produção) — historicamente esses registros nunca tiveram id (só
  // fingerprint de deduplicação), o que impede sincronizar com o Supabase
  // (upsert/delete exigem chave primária estável). Roda uma vez por registro:
  // só cria objeto novo quando falta o id, preservando a referência original
  // nos demais casos para não pesar em bases grandes (SAP pode ter 600k+
  // registros) em todo boot.
  ['entradas', 'saidas', 'lancamentos', 'sap', 'producao'].forEach(key => {
    if (!Array.isArray(state[key])) return;
    state[key] = state[key].map(item => (item && item.id) ? item : { ...item, id: gerarIdRegistro() });
  });

  // LIMPEZA (27/07): remove localmente os registros SAP de teste que o bug
  // de duplicação por id instável (ver "Bugs corrigidos" no resumo do
  // projeto) já tinha baixado da nuvem pro IndexedDB de qualquer
  // dispositivo que sincronizou antes da correção acima existir. Sem isso,
  // mesmo com o id agora estável, esse volume ainda subiria pra nuvem de
  // novo na próxima sincronização — só que sem crescer mais. Critério
  // idêntico ao já confirmado 100% seguro na limpeza da nuvem em 27/07
  // (usuario='pulzsys', fonte manual, sem importId — nenhum dado real bate
  // com essa combinação). Roda uma vez por dispositivo: depois que os
  // registros somem daqui, o filtro não encontra mais nada nos boots
  // seguintes — inofensivo se este dispositivo nunca teve o problema.
  if (Array.isArray(state.sap) && state.sap.length) {
    const antesLimpeza = state.sap.length;
    state.sap = state.sap.filter(r => !(r.usuario === 'pulzsys' && r.fonte === 'manual' && !r.importId));
    const removidosLimpeza = antesLimpeza - state.sap.length;
    if (removidosLimpeza > 0) {
      console.info(`[Persist] Limpeza SAP: ${removidosLimpeza} registro(s) de teste do bug de duplicação removido(s) localmente.`);
    }
  }

  // CORREÇÃO (28/07) — a migração antiga aqui RENOMEAVA o `id` de
  // ocorrências do formato legado "OC-<timestamp>" pra "OC-N" sequencial,
  // reiniciando o contador em 1 a cada boot sem checar se esse número já
  // estava em uso — por OUTRA CONTA. Como `id` é a chave primária da
  // tabela compartilhada `ocorrencias` (sem escopo por usuário), isso
  // criava colisões novas entre contas a cada boot num dispositivo com
  // ids legados: upload pra nuvem falhando (RLS bloqueia sobrescrever
  // registro de outro dono) e sobrescrita silenciosa em memória no merge
  // por id. Ver "Correção do bug de colisão de ids entre contas" (28/07).
  // Substituído por uma versão que NUNCA toca no `id` real — só preenche
  // o campo `numero` (cosmético). Também tokeniza (ex.: "OC-HUGO-5") pra
  // dar pra distinguir contas diferentes quando o número repete — inclusive
  // retroativamente nos registros que já reaproveitavam o próprio id como
  // "OC-N" puro (sem token), que é exatamente o caso que gerava "N OC-5"
  // indistinguíveis pro ADM. Usa o e-mail de quem está logado pros
  // próprios registros; pra registro de OUTRA conta (só o ADM enxerga
  // isso, já que Ocorrências continua mostrando todo mundo — decisão
  // 28/07), cai num token curto derivado do user_id (sem precisar
  // resolver e-mail de terceiros de forma síncrona no boot).
  if (Array.isArray(state.ocorrencias)) {
    const meuId = window.currentUser?.id;
    const precisaNumero = state.ocorrencias.filter(o => !/^OC-[A-Z0-9]+-\d+$/.test(String(o.numero || '')));
    if (precisaNumero.length && typeof _nextOcId === 'function') {
      const ordenados = [...precisaNumero].sort((a, b) => (a.criadoEm || 0) - (b.criadoEm || 0));
      ordenados.forEach(o => {
        const ehMinha = !o.userId || o.userId === meuId;
        o.numero = ehMinha
          ? _nextOcId()
          : _nextOcId(typeof _ocTokenFromUserId === 'function' ? _ocTokenFromUserId(o.userId) : undefined);
      });
    }
  }

  invalidateMaterialLookup();
  invalidateFilialLookup();
  // Nota: reaplicarPadronizacaoMateriais é executada no restoreAndRender
  // durante o loading (step 3), com feedback visual ao usuário.

  // Invalida todos os índices — serão reconstruídos no step 4 do loading
  if (typeof invalidateLancIndex === 'function') invalidateLancIndex();
  if (typeof invalidateSapIndex === 'function') invalidateSapIndex();
  if (typeof invalidateSaidasIndex === 'function') invalidateSaidasIndex();
  if (typeof invalidateAllSearchIndexes === 'function') invalidateAllSearchIndexes();

  // Importações gravadas com status 'Processando': corrige para 'Salvo'
  if (Array.isArray(state.imports)) {
    state.imports.forEach(rec => {
      if (rec.status === 'Processando') {
        rec.status    = 'Salvo';
        rec.statusTip = 'Registros salvos com sucesso';
      }
    });
  }

  stateHydrated = true;
  return true;
}

async function persistStateNow() {
  const hasData = state.entradas.length  || state.saidas.length     ||
                  state.lancamentos.length || state.sap.length       ||
                  state.producao.length  || state.imports.length     ||
                  state.configs.length   || state.filiais.length     ||
                  state.materiais.length || (state.ocorrencias || []).length ||
                  (state.invJustificativas || []).length;
  if (!stateHydrated && !hasData) return;

  // buildStateSnapshot inclui compactSapRecords — pode ser O(600k).
  // Executa em microtask para ceder ao browser antes de serializar.
  await new Promise(r => setTimeout(r, 0));
  const snapshot = buildStateSnapshot();
  await new Promise(r => setTimeout(r, 0));

  try {
    const db = await openDb();
    if (db) {
      await idbPut(db, 'meta', { version: STATE_VERSION, savedAt: snapshot.savedAt, pendingWrite: true }).catch(() => {});

      // Grava o snapshot principal ANTES dos chunks SAP — garante que
      // IDB_STATE_KEY já contém o estado atual mesmo que o browser feche
      // durante saveSapChunks (que pode ser lento com 600k+ registros).
      const snapshotSemSap = { ...snapshot, sap: [] };
      await idbPut(db, IDB_STATE_KEY, snapshotSemSap);
      await new Promise(r => setTimeout(r, 0));

      // SAP em chunks — mais lento, mas snapshot principal já está seguro
      await saveSapChunks(db, snapshot.sap || []);
      await new Promise(r => setTimeout(r, 0));

      const keysParaSalvar = saveSnapshotKeys.filter(k => k !== 'sap');
      // Grava chaves individuais em batches para não travar
      const BATCH = 4;
      for (let i = 0; i < keysParaSalvar.length; i += BATCH) {
        const batch = keysParaSalvar.slice(i, i + BATCH);
        await Promise.all(batch.map(key => idbPut(db, key, snapshot[key])));
        await new Promise(r => setTimeout(r, 0));
      }

      await idbPut(db, 'meta', { version: STATE_VERSION, savedAt: snapshot.savedAt, pendingWrite: false });

      const sapCount = (snapshot.sap || []).length;
      console.info(`[Persist] ✓ Salvo no IndexedDB | SAP: ${sapCount.toLocaleString('pt-BR')} reg.`);
      return true;
    }
  } catch (err) {
    console.warn('[Persist] Falha ao salvar no IndexedDB:', err);
  }

  // Fallback localStorage — sem SAP (muito grande)
  try {
    const snapshotSemSap = { ...snapshot, sap: [] };
    localStorage.setItem(legacyStateKey, JSON.stringify(snapshotSemSap));
    console.warn('[Persist] Salvo no localStorage SEM dados SAP (IndexedDB indisponível).');
    if ((snapshot.sap || []).length > 0) {
      toast('⚠ Dados SAP não puderam ser salvos permanentemente. Use um navegador que suporte IndexedDB.', 'error');
    }
    return true;
  } catch (err) {
    console.error('[Persist] ✗ FALHA TOTAL:', err);
    toast('⚠ Não foi possível salvar os dados.', 'error');
    return false;
  }
}

function flushPersistQueue() {
  if (persistInFlight) {
    persistQueued = true;
    return;
  }

  const run = () => {
    persistInFlight = true;
    Promise.resolve()
      .then(() => persistStateNow())
      .catch(err => console.warn('Falha na persistência assíncrona.', err))
      .finally(() => {
        persistInFlight = false;
        if (persistQueued) {
          persistQueued = false;
          flushPersistQueue();
        }
      });
  };

  // setTimeout simples — não usa requestIdleCallback para evitar execução forçada
  // pelo timeout mesmo quando o browser está ocupado.
  setTimeout(run, 0);
}

function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    flushPersistQueue();
  }, 1500); // aumentado de 500ms para 1500ms para dar mais espaço à UI
}

async function loadState() {
  let loaded = false;

  if (isLoadingOverlayVisible()) updateLoadingOverlay('Buscando os dados salvos...', 'Carregando informações');

  try {
    const db = await openDb();
    if (db) {
      if (isLoadingOverlayVisible()) updateLoadingOverlay('Lendo o banco local do navegador...', 'Carregando informações');

      // Verifica se a última gravação foi interrompida antes de concluir
      const meta = await idbGet(db, 'meta').catch(() => null);
      if (meta?.pendingWrite === true) {
        console.warn('[Persist] Detectada gravação incompleta na sessão anterior. Os dados podem estar parcialmente desatualizados.');
        // Avisa o usuário de forma não-bloqueante (toast aparece após a UI estar pronta)
        setTimeout(() => toast('⚠ A sessão anterior foi encerrada durante uma gravação. Verifique se os dados estão completos.', 'error'), 3000);
      }

      let saved = await idbGet(db, IDB_STATE_KEY);
      // Rastreia se o snapshot unificado existe — necessário para a comparação
      // com o emergency save (só é significativa quando temos um savedAt confiável).
      const idbSnapshotFound = saved !== null && typeof saved === 'object';

      if (!idbSnapshotFound) {
        saved = {};
        for (const key of saveSnapshotKeys) {
          const value = await idbGet(db, key);
          if (Array.isArray(value)) saved[key] = value;
        }
      }

      // Carrega chunks SAP separadamente e injeta no saved antes de aplicar
      const sapFromChunks = await loadSapChunks(db);
      if (sapFromChunks.length > 0) {
        saved.sap = sapFromChunks;
      } else if (!Array.isArray(saved.sap) || saved.sap.length === 0) {
        // Fallback: tenta a chave legada 'sap' individual
        const sapLegacy = await idbGet(db, 'sap').catch(() => null);
        if (Array.isArray(sapLegacy) && sapLegacy.length > 0) saved.sap = sapLegacy;
      }

      // ── Verifica emergency save no localStorage ────────────────────────
      // O pagehide/beforeunload grava um snapshot síncrono (sem SAP) que pode
      // ser mais recente que o último persist assíncrono completo no IDB —
      // ex: mudanças feitas durante o debounce de 1500ms ou enquanto os chunks
      // SAP ainda estavam sendo gravados.
      // Só compara quando IDB_STATE_KEY existe: garante que saved.savedAt é
      // o timestamp confiável do último persist completo.
      if (idbSnapshotFound) {
        try {
          const lsRaw = localStorage.getItem(legacyStateKey);
          if (lsRaw) {
            const lsParsed = safeJSONParse(lsRaw, null);
            if (lsParsed && typeof lsParsed === 'object' &&
                (lsParsed.savedAt || 0) > (saved.savedAt || 0)) {
              console.info('[Persist] Emergency save mais recente que IDB — aplicando campos não-SAP do localStorage.');
              // SAP permanece dos chunks IDB — fonte mais completa
              // (emergency save sempre tem sap: []).
              // IMPORTANTE: mescla sobre 'saved' em vez de substituí-lo — o
              // snapshot de emergência não contém TODAS as chaves de
              // saveSnapshotKeys (ex.: notifications, invJustificativas), e
              // um `saved = { ...lsParsed, sap: saved.sap }` descartaria essas
              // chaves do IDB mesmo quando elas não mudaram desde o último save.
              saved = { ...saved, ...lsParsed, sap: saved.sap };
            }
          }
        } catch (_) {}
      }

      if (isLoadingOverlayVisible()) updateLoadingOverlay('Aplicando o estado salvo na interface...', 'Carregando informações');
      loaded = applySavedState(saved);
    }
  } catch (err) {
    console.warn('Não foi possível restaurar o estado do IndexedDB.', err);
  }

  if (!loaded) {
    try {
      if (isLoadingOverlayVisible()) updateLoadingOverlay('Restaurando o armazenamento antigo...', 'Carregando informações');
      const raw = localStorage.getItem(legacyStateKey);
      if (raw) {
        const parsed = safeJSONParse(raw, {});
        // Se o SAP já foi carregado via chunks IDB, não deixa o snapshot legado
        // (que tem sap:[]) sobrescrever os dados corretos já em memória.
        // Marca o campo para que applySavedState o ignore na iteração de keys.
        if (Array.isArray(state.sap) && state.sap.length > 0) {
          parsed._skipSap = true;
        }
        loaded = applySavedState(parsed);
      }
    } catch (err) {
      console.warn('Não foi possível restaurar o estado local.', err);
    }
  }

  if (loaded) {
    // Persistência pós-boot é feita pelo restoreAndRender (step 7 do loading).
    // Não agendar nada aqui para evitar travamentos pós-loading.
    stateHydrated = true;
  } else {
    stateHydrated = true;
  }

  // Reconcilia exclusões que ficaram pendentes de um fechamento/crash anterior
  // (ver comentário em reconcilePendingDeletes). Roda sempre, mesmo sem estado
  // carregado, para limpar uma tombstone órfã se for o caso.
  await reconcilePendingDeletes();
}

// ── Emergency save (pagehide / beforeunload) ──────────────────────────────
// Captura mudanças que ainda estão no debounce (1500ms) no momento em que o
// usuário recarrega ou fecha a aba. Usa localStorage síncrono — única opção
// disponível nesses eventos. SAP excluído: os chunks IDB são a fonte
// autoritativa e não cabem no localStorage.
// No próximo boot, loadState() compara o savedAt deste snapshot com o do
// IDB_STATE_KEY e usa o mais recente para os campos não-SAP.
function _emergencySave() {
  clearTimeout(persistTimer); // cancela debounce pendente
  if (!stateHydrated) return;
  try {
    // Derivado de saveSnapshotKeys (fonte única) em vez de listado à mão —
    // esta lista já esqueceu campos novos duas vezes no passado
    // (notifications/invJustificativas, depois ajustesSistemicos/
    // ajustesExcluidos/notasAjuste), cada esquecimento causando perda de
    // dado com validade fiscal/auditoria num fechamento abrupto da aba.
    const snapshot = { version: STATE_VERSION, savedAt: Date.now() };
    for (const key of saveSnapshotKeys) {
      // SAP excluído — chunks IDB são a fonte autoritativa e não cabem no localStorage.
      snapshot[key] = key === 'sap' ? [] : (state[key] || []);
    }
    localStorage.setItem(legacyStateKey, JSON.stringify(snapshot));
    console.info('[Persist] Emergency save executado.');
  } catch (e) {
    console.warn('[Persist] Emergency save falhou:', e);
  }
}
window.addEventListener('pagehide',     _emergencySave);
window.addEventListener('beforeunload', _emergencySave);
