// Teste do reset remoto de dados locais (módulos híbridos) e da limpeza de
// anexos de DAI órfãos. Sem framework — rode com:
//
//     node tests/wipe-local.test.mjs
//
// Por que existe: o ADM não alcança o IndexedDB de outro navegador — o
// mecanismo inteiro depende do PRÓPRIO navegador do usuário comparar um
// carimbo remoto (local_wipe_pendencias) contra um carimbo local e se
// limpar sozinho. Um erro na comparação (ex.: usar ">" em vez de ">=", ou
// comparar string em vez de timestamp) faz o wipe nunca aplicar, ou
// aplicar de novo a cada boot — os dois são silenciosos, sem exceção.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const fontePersist = readFileSync(join(raiz, 'js', 'persist.js'), 'utf8');
const fonteNormalize = readFileSync(join(raiz, 'js', 'normalize.js'), 'utf8');

const EU = 'user-analista';

// ── Fake IndexedDB mínimo (in-memory) — só o suficiente pra store 'kv'
// (keyPath 'key') usada por openDb/idbGet/idbPut/getAllKeys. Preserva a
// natureza assíncrona por callback da API real (onsuccess/onerror
// disparados depois que o chamador já anexou os handlers), senão um bug de
// ordenação no código real passaria despercebido pelo teste.
function fakeIndexedDB() {
  const bancos = new Map(); // dbName -> Map(storeName -> Map(key -> record))

  function fakeStore(map) {
    return {
      get(key) {
        const req = {};
        queueMicrotask(() => { req.result = map.get(key); req.onsuccess?.(); });
        return req;
      },
      put(value) {
        const req = {};
        map.set(value.key, value);
        queueMicrotask(() => { req.onsuccess?.(); });
        return req;
      },
      delete(key) {
        map.delete(key);
        return {};
      },
      getAllKeys() {
        const req = {};
        queueMicrotask(() => { req.result = [...map.keys()]; req.onsuccess?.(); });
        return req;
      },
    };
  }

  return {
    open(name) {
      if (!bancos.has(name)) bancos.set(name, new Map());
      const stores = bancos.get(name);
      const request = {};
      const db = {
        objectStoreNames: { contains: (n) => stores.has(n) },
        createObjectStore(n) { stores.set(n, new Map()); },
        transaction(storeName) {
          const map = stores.get(storeName);
          const tx = {};
          tx.objectStore = () => fakeStore(map);
          queueMicrotask(() => { tx.oncomplete?.(); });
          return tx;
        },
      };
      queueMicrotask(() => {
        request.result = db; // onupgradeneeded real lê request.result de dentro do handler
        if (!stores.size) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
}

// Monta o ambiente e carrega persist.js + normalize.js REAIS (mesmo realm
// de vm — como os dois <script> convivem no navegador, sem módulos).
function montar({ ajustesSistemicos = [], estadoInicial = {} } = {}) {
  const toasts = [];
  // Chaves que persistStateNow() (persist.js) lê incondicionalmente
  // (.length) — precisam existir mesmo quando o teste não usa. persistStateNow
  // em si é substituída por um espião abaixo (não é o alvo deste teste).
  const base = {
    configs: [], filiais: [], materiais: [], entradas: [], saidas: [],
    lancamentos: [], sap: [], producao: [], imports: [], ocorrencias: [],
    invJustificativas: [],
  };
  const state = { ...base, ajustesSistemicos, ...estadoInicial };

  // No navegador de verdade, `window` É o objeto global — `indexedDB` bare
  // e `window.indexedDB` são a MESMA referência. openDb() (persist.js) usa
  // as duas formas (checa `'indexedDB' in window`, chama `indexedDB.open`
  // direto) — o fake precisa da mesma instância nos dois lugares.
  const idb = fakeIndexedDB();
  const ctx = {
    console: { info() {}, warn() {}, error() {} },
    STORAGE_KEY: 'central_analise_state_v4', // referenciado por persist.js (legacyStateKey)
    state,
    toast: (msg, tipo) => toasts.push({ msg, tipo }),
    setTimeout, clearTimeout,
    indexedDB: idb,
    window: {
      currentUser: { id: EU, role: 'user' },
      supabaseClient: null, // setado depois por teste, quando precisar
      indexedDB: idb,
      addEventListener() {}, // persist.js registra pagehide/beforeunload no load
      crypto: { randomUUID: () => 'uuid-' + Math.random().toString(36).slice(2) },
    },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fontePersist, ctx);
  vm.runInContext(fonteNormalize, ctx);
  // persistStateNow real depende de todo o pipeline de snapshot/IDB — fora
  // do escopo deste teste (o alvo é a lógica de comparação do wipe, não a
  // gravação em si, já coberta indiretamente pelos idbGet/idbPut reais
  // usados no carimbo). Substituído por um espião leve.
  ctx.persistStateNow = async () => {};
  return { ctx, toasts };
}

const casos = [];
const teste = (nome, fn) => casos.push({ nome, fn });

// ── checarWipePendente ──────────────────────────────────────────────────

teste('tombstone mais novo que o carimbo local esvazia o módulo e grava o carimbo', async () => {
  const { ctx } = montar({ estadoInicial: { sap: [{ id: 1, importId: 'lote1' }] } });
  ctx.window.supabaseClient = {
    from(tabela) {
      assert.equal(tabela, 'local_wipe_pendencias');
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: [{ modulo: 'sap', solicitado_em: '2026-08-01T10:00:00.000Z' }], error: null }),
        }),
      };
    },
  };
  await ctx.checarWipePendente();
  // Array.from: state.sap vem de dentro do vm (outro realm) — deepEqual
  // cru falha a comparação com [] do realm principal por engano.
  assert.deepEqual(Array.from(ctx.state.sap), []);

  const db = await ctx.openDb();
  const acked = await ctx.idbGet(db, '_wipeAcked');
  assert.equal(acked.sap, '2026-08-01T10:00:00.000Z');
});

teste('tombstone igual/mais antigo que o carimbo local não faz nada (idempotente)', async () => {
  const { ctx } = montar({ estadoInicial: { sap: [{ id: 1, importId: 'lote1' }] } });
  const db = await ctx.openDb();
  await ctx.idbPut(db, '_wipeAcked', { sap: '2026-08-01T10:00:00.000Z' });

  ctx.window.supabaseClient = {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: [{ modulo: 'sap', solicitado_em: '2026-08-01T10:00:00.000Z' }], error: null }),
      }),
    }),
  };
  await ctx.checarWipePendente();
  assert.equal(ctx.state.sap.length, 1, 'não pode reaplicar um wipe já processado por este dispositivo');
});

teste('dois dispositivos do mesmo usuário processam o mesmo tombstone de forma independente', async () => {
  const tombstone = { modulo: 'entradas', solicitado_em: '2026-08-01T12:00:00.000Z' };
  const supabaseClient = {
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [tombstone], error: null }) }) }),
  };

  // "Dispositivo A" e "Dispositivo B" — dois contextos vm separados, cada
  // um com seu PRÓPRIO IndexedDB fake (dispositivos diferentes de verdade
  // não compartilham storage) — mas processando o MESMO tombstone remoto.
  const a = montar({ estadoInicial: { entradas: [{ id: 1 }] } });
  const b = montar({ estadoInicial: { entradas: [{ id: 2 }] } });
  a.ctx.window.supabaseClient = supabaseClient;
  b.ctx.window.supabaseClient = supabaseClient;

  await a.ctx.checarWipePendente();
  await b.ctx.checarWipePendente();

  assert.deepEqual(Array.from(a.ctx.state.entradas), []);
  assert.deepEqual(Array.from(b.ctx.state.entradas), []);
});

teste('sem linhas em local_wipe_pendencias, não mexe em nada', async () => {
  const { ctx } = montar({ estadoInicial: { sap: [{ id: 1 }] } });
  ctx.window.supabaseClient = {
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }),
  };
  await ctx.checarWipePendente();
  assert.equal(ctx.state.sap.length, 1);
});

// ── limparAnexosDaiOrfaos ────────────────────────────────────────────────

teste('poda anexos cujo DAI não existe mais, preserva os de DAIs vivos', async () => {
  const { ctx } = montar({ ajustesSistemicos: [{ id: 'dai_111_abc' }] });
  const db = await ctx.openDb();
  await ctx.idbPutAnexoDai('dai_111_abc', 0, 'vivo');
  await ctx.idbPutAnexoDai('dai_999_zzz', 0, 'orfao');
  await ctx.idbPutAnexoDai('dai_999_zzz', 1, 'orfao2');

  await ctx.limparAnexosDaiOrfaos();

  assert.equal(await ctx.idbGetAnexoDai('dai_111_abc', 0), 'vivo');
  assert.equal(await ctx.idbGetAnexoDai('dai_999_zzz', 0), null);
  assert.equal(await ctx.idbGetAnexoDai('dai_999_zzz', 1), null);
});

// ── Execução ───────────────────────────────────────────────────────────
let falhas = 0;
for (const { nome, fn } of casos) {
  try {
    await fn();
    console.log(`  ok   ${nome}`);
  } catch (err) {
    falhas++;
    console.log(`  FALHOU ${nome}`);
    console.log(`         ${err.stack || err.message}`);
  }
}
console.log(`\n${casos.length - falhas}/${casos.length} passaram`);
process.exit(falhas ? 1 : 0);
