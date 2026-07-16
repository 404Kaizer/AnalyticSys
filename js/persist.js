const STATE_VERSION = 5;
const IDB_DB_NAME = 'central_analise_db_v1';
const IDB_STORE = 'kv';
const IDB_STATE_KEY = 'appState';
const legacyStateKey = STORAGE_KEY;
// 'sap' é excluído do snapshot unificado — salvo em chunks separados
const saveSnapshotKeys = ['configs', 'filiais', 'materiais', 'gruposMateriais', 'regionaisCentrais', 'entradas', 'saidas', 'lancamentos', 'sap', 'producao', 'imports', 'ocorrencias', 'acoesRelatorio', 'notifications', 'invJustificativas', 'sapFechamentoOverrides'];
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
    if (state.imports.length !== beforeImports) touched = true;
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

// ── Controle de aba única ativa (Web Locks API) ───────────────────────────
// Problema: com duas abas abertas, cada uma mantém seu próprio `state` em
// memória. Como persistStateNow() sempre grava o snapshot COMPLETO (não é
// incremental), a última aba a gravar sobrescreve por completo o que a
// outra salvou — mesmo que a outra tivesse dados mais novos. Sem nenhuma
// coordenação entre abas, isso é inevitável.
// Solução: apenas a aba que detém o "lock" pode gravar. As demais entram em
// modo somente-leitura (bloqueio visual) até a aba ativa ser fechada, quando
// então uma delas é promovida automaticamente — recarregando o estado mais
// recente do IndexedDB antes de liberar a edição.
const TAB_LOCK_NAME = 'central_analise_tab_lock_v1';
let isActiveTab = false;      // true = esta aba pode gravar
let tabWasPassive = false;    // true = esta aba já esteve em modo leitura (usado para saber se precisa recarregar ao ser promovida)

// ── Verificação de conflito antes de gravar (rede de segurança) ──────────
// Mesmo com o lock acima, mantemos esta checagem como segunda camada: cobre
// navegadores sem suporte a Web Locks (fallback abaixo assume "ativo" para
// não travar o uso) e qualquer cenário inesperado. Compara o savedAt que
// esta aba sabe ser o mais recente com o que está de fato no IDB — se
// alguém gravou depois, aborta em vez de sobrescrever silenciosamente.
let lastKnownSavedAt = 0;
function _updateLastKnownSavedAt(ts) {
  if (typeof ts === 'number' && ts > lastKnownSavedAt) lastKnownSavedAt = ts;
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
    invJustificativas: state.invJustificativas || [],
    sapFechamentoOverrides: state.sapFechamentoOverrides || []
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

  // Migra IDs de ocorrências do formato OC-timestamp para OC-N sequencial
  if (Array.isArray(state.ocorrencias)) {
    let counter = 1;
    const idMap = {};
    // Ordena por criadoEm para manter ordem cronológica
    const sorted = [...state.ocorrencias].sort((a, b) => (a.criadoEm || 0) - (b.criadoEm || 0));
    sorted.forEach(o => {
      const isLegacy = /^OC-\d{10,}$/.test(String(o.id));
      if (isLegacy) {
        idMap[o.id] = 'OC-' + counter++;
      }
    });
    if (Object.keys(idMap).length > 0) {
      state.ocorrencias = state.ocorrencias.map(o => ({
        ...o,
        id: idMap[o.id] || o.id,
      }));
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
  // ── Opção A: só a aba ativa pode gravar ──────────────────────────────
  // Evita que uma aba em segundo plano, com dados desatualizados em
  // memória, sobrescreva o que a aba ativa já salvou.
  if (!isActiveTab) {
    console.warn('[Persist] Gravação bloqueada — esta aba não é a aba ativa (outra aba está aberta).');
    return false;
  }

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
      // ── Opção C: checagem de conflito (rede de segurança) ───────────────
      // Compara o savedAt mais recente que esta aba conhece com o que está
      // de fato gravado agora no IDB. Se forem diferentes, outra aba/sessão
      // gravou nesse meio-tempo (ex.: fallback sem suporte a Web Locks) —
      // aborta em vez de sobrescrever silenciosamente.
      const currentMeta = await idbGet(db, 'meta').catch(() => null);
      if (currentMeta && typeof currentMeta.savedAt === 'number' && currentMeta.savedAt > lastKnownSavedAt) {
        console.warn('[Persist] Conflito detectado — os dados foram alterados por outra aba/sessão desde o último carregamento desta aba.');
        toast('⚠ Os dados foram alterados em outra aba. Recarregue a página para continuar sem risco de perder informações.', 'error');
        return false;
      }

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
      _updateLastKnownSavedAt(snapshot.savedAt);

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
    _updateLastKnownSavedAt(snapshot.savedAt);
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
  // Aba passiva: não há o que fazer aqui — evita agendar trabalho inútil.
  if (!isActiveTab) { persistQueued = false; return; }

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
  // Aba passiva: flushPersistQueue() já bloqueia a gravação, mas evitamos
  // até agendar o timer aqui.
  if (!isActiveTab) return;
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
      _updateLastKnownSavedAt(meta?.savedAt || 0);
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
      _updateLastKnownSavedAt(saved?.savedAt || 0);
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
        _updateLastKnownSavedAt(parsed?.savedAt || 0);
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

// ── Aba única ativa (Web Locks API) ───────────────────────────────────────
// Chamada uma vez no boot (ver init() em analitico.js). Não bloqueia o
// carregamento normal da página — apenas decide, em paralelo, se esta aba
// pode gravar ou deve entrar em modo somente-leitura.
function requestTabLock() {
  if (!('locks' in navigator)) {
    // Navegador sem suporte a Web Locks (raro em 2026, mas possível em
    // versões muito antigas): assume "ativo" para não travar o uso — a
    // checagem de conflito (Opção C) em persistStateNow() continua ativa
    // como rede de segurança nesse caso.
    console.warn('[TabLock] Navegador sem suporte a Web Locks API — modo ativo assumido, protegido apenas pela checagem de conflito.');
    _onBecomeActiveTab();
    return;
  }

  let settled = false;
  // Se o lock não for concedido quase instantaneamente, é porque outra aba
  // já o detém — mostra o aviso de somente-leitura enquanto aguardamos.
  const waitTimer = setTimeout(() => {
    if (!settled) _onPassiveTab();
  }, 250);

  navigator.locks.request(TAB_LOCK_NAME, { mode: 'exclusive' }, () => {
    return new Promise((resolve) => {
      settled = true;
      clearTimeout(waitTimer);
      _onBecomeActiveTab();
      // Mantém o lock retido enquanto a aba estiver aberta. Ele é liberado
      // automaticamente pelo navegador no fechamento/crash da aba, mesmo
      // que este listener não chegue a rodar — não há risco de "lock preso".
      window.addEventListener('pagehide', () => resolve(), { once: true });
    });
  }).catch(err => {
    console.warn('[TabLock] Falha ao solicitar o lock — assumindo modo ativo.', err);
    if (!settled) { settled = true; clearTimeout(waitTimer); _onBecomeActiveTab(); }
  });
}

async function _onBecomeActiveTab() {
  const wasPromoted = tabWasPassive;
  isActiveTab = true;
  _hideTabLockOverlay();
  if (wasPromoted) {
    // Esta aba estava em modo leitura e a aba ativa anterior foi fechada.
    // O estado em memória aqui pode estar desatualizado — recarrega do
    // IndexedDB antes de liberar a edição, para não repetir o mesmo
    // problema por outra via.
    console.info('[TabLock] Aba promovida a ativa — recarregando o estado mais recente antes de liberar a edição.');
    try {
      await loadState();
      if (typeof renderAll === 'function') renderAll();
      if (typeof updateDashboard === 'function') updateDashboard();
      toast('Esta aba está ativa agora. Os dados foram atualizados.', 'success');
    } catch (err) {
      console.warn('[TabLock] Falha ao recarregar estado após promoção:', err);
    }
  }
}

function _onPassiveTab() {
  isActiveTab = false;
  tabWasPassive = true;
  _showTabLockOverlay();
}

function _showTabLockOverlay() {
  const el = document.getElementById('tab-lock-overlay');
  if (el) el.classList.add('open');
}

function _hideTabLockOverlay() {
  const el = document.getElementById('tab-lock-overlay');
  if (el) el.classList.remove('open');
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
  // Aba passiva: não grava — evitaria reintroduzir dados desatualizados
  // no próximo boot através do próprio mecanismo de emergency save.
  if (!isActiveTab) return;
  try {
    const snapshot = {
      version:           STATE_VERSION,
      savedAt:           Date.now(),
      configs:           state.configs,
      filiais:           state.filiais,
      materiais:         state.materiais,
      entradas:          state.entradas,
      saidas:            state.saidas,
      lancamentos:       state.lancamentos,
      sap:               [],  // excluído — chunks IDB são a fonte autoritativa
      producao:          state.producao,
      imports:           state.imports,
      ocorrencias:       state.ocorrencias      || [],
      acoesRelatorio:    state.acoesRelatorio   || [],
      // Corrigido: estes dois campos faziam parte de saveSnapshotKeys mas
      // não eram capturados aqui — ficavam vulneráveis a perda quando este
      // snapshot de emergência era aplicado por cima do save do IDB.
      notifications:     state.notifications    || [],
      invJustificativas: state.invJustificativas || []
    };
    localStorage.setItem(legacyStateKey, JSON.stringify(snapshot));
    console.info('[Persist] Emergency save executado.');
  } catch (e) {
    console.warn('[Persist] Emergency save falhou:', e);
  }
}
window.addEventListener('pagehide',     _emergencySave);
window.addEventListener('beforeunload', _emergencySave);
