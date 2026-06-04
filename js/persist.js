const STATE_VERSION = 5;
const IDB_DB_NAME = 'central_analise_db_v1';
const IDB_STORE = 'kv';
const IDB_STATE_KEY = 'appState';
const legacyStateKey = STORAGE_KEY;
const saveSnapshotKeys = ['configs', 'filiais', 'materiais', 'entradas', 'saidas', 'lancamentos', 'sap', 'producao', 'imports'];

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

// Mantém os registros SAP completos na persistência.
// O módulo exibe e utiliza campos como ref, depósito e dt. registro.
// Se eles forem descartados no snapshot, reaparecem vazios após o reload.
function compactSapRecords(records) {
  if (!Array.isArray(records) || records.length === 0) return records;
  return records.map(r => ({ ...r }));
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
    imports: state.imports
  };
}

function applySavedState(saved) {
  if (!saved || typeof saved !== 'object') return false;

  const incomingConfigs = Array.isArray(saved.configs) ? saved.configs : [];
  state.configs = mergePersistentConfigs(state.configs, incomingConfigs);

  for (const key of saveSnapshotKeys) {
    if (key === 'configs') continue;
    if (!Array.isArray(saved[key])) continue;
    state[key] = saved[key];
  }

  state.materiais = (state.materiais || []).map(item => ({
    id: item?.id || makeMaterialId(),
    ...item
  }));

  invalidateMaterialLookup();
  invalidateFilialLookup();
  reaplicarPadronizacaoMateriais();
  // Invalida todos os índices de busca e de lançamentos/SAP ao restaurar estado
  invalidateLancIndex();
  invalidateSapIndex();
  invalidateSaidasIndex();
  invalidateAllSearchIndexes();
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
                  state.materiais.length;
  if (!stateHydrated && !hasData) {
    return;
  }

  const snapshot = buildStateSnapshot();

  try {
    const db = await openDb();
    if (db) {
      await idbPut(db, IDB_STATE_KEY, snapshot);
      await Promise.all(saveSnapshotKeys.map(key => idbPut(db, key, snapshot[key])));
      await idbPut(db, 'meta', { version: STATE_VERSION, savedAt: snapshot.savedAt });
      return;
    }
  } catch (err) {
    console.warn('Falha ao salvar no IndexedDB, tentando fallback.', err);
  }

  try {
    localStorage.setItem(legacyStateKey, JSON.stringify(snapshot));
  } catch (err) {
    console.warn('Não foi possível salvar o estado localmente.', err);
  }
}

function flushPersistQueue() {
  if (persistInFlight) {
    persistQueued = true;
    return;
  }

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
}

function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    flushPersistQueue();
  }, 500);
}

async function loadState() {
  let loaded = false;

  if (isLoadingOverlayVisible()) updateLoadingOverlay('Buscando os dados salvos...', 'Carregando informações');

  try {
    const db = await openDb();
    if (db) {
      if (isLoadingOverlayVisible()) updateLoadingOverlay('Lendo o banco local do navegador...', 'Carregando informações');
      let saved = await idbGet(db, IDB_STATE_KEY);

      if (!saved || typeof saved !== 'object') {
        saved = {};
        for (const key of saveSnapshotKeys) {
          const value = await idbGet(db, key);
          if (Array.isArray(value)) saved[key] = value;
        }
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
        loaded = applySavedState(safeJSONParse(raw, {}));
      }
    } catch (err) {
      console.warn('Não foi possível restaurar o estado local.', err);
    }
  }

  if (loaded) {
    persist();
  } else {
    stateHydrated = true;
  }
}
