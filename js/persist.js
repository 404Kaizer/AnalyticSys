const STATE_VERSION = 5;
const IDB_DB_NAME = 'central_analise_db_v1';
const IDB_STORE = 'kv';
const IDB_STATE_KEY = 'appState';
const legacyStateKey = STORAGE_KEY;
// 'sap' é excluído do snapshot unificado — salvo em chunks separados
const saveSnapshotKeys = ['configs', 'filiais', 'materiais', 'entradas', 'saidas', 'lancamentos', 'sap', 'producao', 'imports', 'ocorrencias', 'acoesRelatorio'];
const SAP_CHUNK_SIZE  = 10000;  // registros por chunk
const SAP_CHUNK_KEY   = 'sap_chunk_'; // prefixo das chaves: sap_chunk_0, sap_chunk_1...
const SAP_META_KEY    = 'sap_meta';   // { totalChunks, totalRecords, savedAt }

let idbOpenPromise = null;
let persistTimer = null;
let persistInFlight = false;
let persistQueued = false;
let stateHydrated = false;

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

  // Apaga chunks antigos que possam ter sobrado de uma importação menor
  const oldMeta = await idbGet(db, SAP_META_KEY).catch(() => null);
  const oldChunks = oldMeta?.totalChunks || 0;
  if (oldChunks > totalChunks) {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    for (let i = totalChunks; i < oldChunks; i++) {
      store.delete(SAP_CHUNK_KEY + i);
    }
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  }

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

  // Grava metadata
  await idbPut(db, SAP_META_KEY, {
    totalChunks,
    totalRecords: compacted.length,
    savedAt: Date.now(),
    version: STATE_VERSION
  });

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
  'categoria','um','importId','fonte'
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
    entradas: state.entradas,
    saidas: state.saidas,
    lancamentos: state.lancamentos,
    sap: compactSapRecords(state.sap),
    producao: state.producao,
    imports: state.imports,
    ocorrencias: state.ocorrencias || [],
    acoesRelatorio: state.acoesRelatorio || []
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
  reaplicarPadronizacaoMateriais();
  // Invalida todos os índices de busca e de lançamentos/SAP ao restaurar estado
  invalidateLancIndex();
  invalidateSapIndex();
  invalidateSaidasIndex();
  invalidateAllSearchIndexes();

  // Importações gravadas com status 'Processando' ficaram assim porque o persist
  // ocorre antes do .then() que atualiza o status. Ao recarregar, qualquer import
  // nesse estado já está persistido — portanto seu status correto é 'Salvo'.
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
  // Bail-out de segurança: só pula a gravação se o estado NÃO tiver sido hidratado
  // E todas as coleções estiverem vazias — incluindo configs.
  // configs é verificada separadamente para garantir que configurações salvas pelo
  // usuário nunca sejam descartadas mesmo quando os demais módulos estão vazios.
  const hasData = state.entradas.length  || state.saidas.length     ||
                  state.lancamentos.length || state.sap.length       ||
                  state.producao.length  || state.imports.length     ||
                  state.configs.length   || state.filiais.length     ||
                  state.materiais.length || (state.ocorrencias || []).length;
  if (!stateHydrated && !hasData) {
    return;
  }

  const snapshot = buildStateSnapshot();

  try {
    const db = await openDb();
    if (db) {
      // Sinaliza início de escrita — se o browser fechar no meio, loadState
      // detecta pendingWrite=true e emite aviso de possível inconsistência.
      await idbPut(db, 'meta', { version: STATE_VERSION, savedAt: snapshot.savedAt, pendingWrite: true }).catch(() => {});

      // SAP é salvo em chunks separados — pode ter milhões de registros
      await saveSapChunks(db, snapshot.sap || []);

      // Snapshot sem SAP — muito menor, cabe facilmente
      const snapshotSemSap = { ...snapshot, sap: [] };
      await idbPut(db, IDB_STATE_KEY, snapshotSemSap);

      // Chaves individuais para recuperação parcial (sem SAP — já está nos chunks)
      const keysParaSalvar = saveSnapshotKeys.filter(k => k !== 'sap');
      await Promise.all(keysParaSalvar.map(key => idbPut(db, key, snapshot[key])));

      // Limpa o flag — escrita concluída com sucesso
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
    // Notifica o usuário que os dados SAP não foram salvos permanentemente
    if ((snapshot.sap || []).length > 0) {
      toast('⚠ Dados SAP não puderam ser salvos permanentemente. Use um navegador que suporte IndexedDB.', 'error');
    }
    return true; // localStorage funcionou
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

  // Usa requestIdleCallback quando disponível — roda só quando o browser está ocioso
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 3000 });
  } else {
    run();
  }
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

      if (!saved || typeof saved !== 'object') {
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
    // Não re-persistir imediatamente após restaurar — os dados acabam de ser lidos
    // do storage e não mudaram. Agendar com delay longo para não travar a UI.
    setTimeout(() => flushPersistQueue(), 5000);
  } else {
    stateHydrated = true;
  }
}
