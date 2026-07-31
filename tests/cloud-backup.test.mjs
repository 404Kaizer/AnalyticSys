// Teste da guarda de encolhimento e do gatilho de restauração do backup
// condensado (js/cloud-backup.js). Sem framework — rode com:
//
//     node tests/cloud-backup.test.mjs
//
// Por que este arquivo existe: pro volume importado (Entradas/Saídas/SAP/
// Produção/Lançamentos) o backup condensado é a ÚNICA cópia. Um erro aqui
// não dá erro na tela — apaga silenciosamente centenas de milhares de
// linhas. É a rota que mais precisa de verificação automática do sistema.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonte = readFileSync(join(raiz, 'js', 'cloud-backup.js'), 'utf8');

const sha256 = (txt) => createHash('sha256').update(txt, 'utf8').digest('hex');

// Monta um ambiente de navegador mínimo e carrega o arquivo real (nada de
// cópia da lógica no teste — se o código mudar, o teste acompanha).
//
// registrosNuvem: quando informado, o storage falso devolve chunks gzipados
// DE VERDADE com hash correto — sem isso a restauração falharia no gunzip e
// o teste passaria mesmo com a lógica quebrada (foi o que aconteceu na
// primeira versão deste arquivo).
function montar({ registros = [], manifestRemoto = null, registrosNuvem = null, comLocks = false } = {}) {
  const enviados = [];
  const removidos = [];
  const toasts = [];

  let manifest = manifestRemoto;
  const chunksGz = {};
  if (registrosNuvem) {
    const json = JSON.stringify(registrosNuvem);
    chunksGz['chunk_0.json.gz'] = gzipSync(Buffer.from(json, 'utf8'));
    manifest = {
      version: 1, modulo: 'saidas',
      totalRecords: registrosNuvem.length,
      totalChunks: 1,
      chunkHashes: [sha256(json)],
      savedAt: Date.now(),
    };
  }

  const copiados = [];
  const storage = {
    download: async (caminho) => {
      const arquivo = caminho.split('/').pop();
      if (arquivo === 'manifest.json') {
        return manifest
          ? { data: { text: async () => JSON.stringify(manifest) }, error: null }
          : { data: null, error: { message: 'not found' } };
      }
      if (chunksGz[arquivo]) return { data: new Blob([chunksGz[arquivo]]), error: null };
      return { data: null, error: { message: 'not found' } };
    },
    upload: async (caminho) => { enviados.push(caminho); return { error: null }; },
    remove: async (caminhos) => { removidos.push(...caminhos); return { error: null }; },
    copy: async (de, para) => { copiados.push({ de, para }); return { error: null }; },
  };

  const ctx = {
    console: { info() {}, warn() {}, error() {} },
    state: { saidas: registros },
    toast: (msg, tipo) => toasts.push({ msg, tipo }),
    persist: () => {},
    yieldToUI: async () => {},
    setInterval: () => 0,
    navigator: comLocks
      ? { locks: { request: (_nome, fn) => fn() } }
      : {},
    window: { currentUser: { id: 'user-teste' }, supabaseClient: { storage: { from: () => storage } } },
    // APIs nativas que o cloud-backup.js usa — o Node 20 tem todas.
    CompressionStream, DecompressionStream, crypto, TextEncoder, TextDecoder,
    Response, Blob,
  };
  ctx.globalThis = ctx;
  ctx.confirm = () => true;
  vm.createContext(ctx);
  vm.runInContext(fonte, ctx);
  return { ctx, enviados, removidos, toasts, copiados };
}

const casos = [];
const teste = (nome, fn) => casos.push({ nome, fn });

// ── F1: guarda de encolhimento ─────────────────────────────────────────

teste('BLOQUEIA quando o local tem menos registros que a nuvem', async () => {
  const { ctx, enviados, removidos, toasts } = montar({
    registros: Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, importId: 'imp1' })),
    manifestRemoto: { totalRecords: 500000, totalChunks: 25, chunkHashes: [] },
  });
  const ok = await ctx.window._cbUploadModulo('saidas');
  assert.equal(ok, false, 'deveria recusar o envio');
  assert.equal(enviados.length, 0, 'não pode enviar chunk nenhum');
  assert.equal(removidos.length, 0, 'não pode apagar chunk nenhum');
  assert.equal(toasts.filter(t => t.tipo === 'error').length, 1, 'deve avisar o usuário');
});

teste('PERMITE encolher quando a exclusão foi deliberada (permitirReducao)', async () => {
  const { ctx, enviados } = montar({
    registros: Array.from({ length: 5 }, (_, i) => ({ id: `r${i}` })),
    manifestRemoto: { totalRecords: 500000, totalChunks: 25, chunkHashes: [] },
  });
  const ok = await ctx.window._cbUploadModulo('saidas', { permitirReducao: true });
  assert.equal(ok, true, 'exclusão deliberada precisa passar');
  assert.ok(enviados.some(p => p.includes('manifest.json')), 'deve gravar o manifest novo');
});

teste('PERMITE crescer sem flag nenhuma', async () => {
  const { ctx, enviados } = montar({
    registros: Array.from({ length: 200 }, (_, i) => ({ id: `r${i}` })),
    manifestRemoto: { totalRecords: 100, totalChunks: 1, chunkHashes: [] },
  });
  assert.equal(await ctx.window._cbUploadModulo('saidas'), true);
  assert.ok(enviados.some(p => p.includes('manifest.json')));
});

teste('PERMITE o primeiro backup (não existe manifest ainda)', async () => {
  const { ctx, enviados } = montar({
    registros: Array.from({ length: 10 }, (_, i) => ({ id: `r${i}` })),
    manifestRemoto: null,
  });
  assert.equal(await ctx.window._cbUploadModulo('saidas'), true);
  assert.ok(enviados.some(p => p.includes('manifest.json')));
});

teste('PERMITE contagem igual (nada mudou)', async () => {
  const { ctx } = montar({
    registros: Array.from({ length: 100 }, (_, i) => ({ id: `r${i}` })),
    manifestRemoto: { totalRecords: 100, totalChunks: 1, chunkHashes: [] },
  });
  assert.equal(await ctx.window._cbUploadModulo('saidas'), true);
});

// ── F5: trava entre abas ───────────────────────────────────────────────

teste('usa navigator.locks quando disponível', async () => {
  let usouLock = false;
  const { ctx } = montar({
    registros: [{ id: 'r1' }],
    manifestRemoto: null,
    comLocks: true,
  });
  ctx.navigator.locks.request = (nome, fn) => { usouLock = nome === 'cloudbackup-saidas'; return fn(); };
  await ctx.window._cbUploadModulo('saidas');
  assert.equal(usouLock, true, 'deve serializar pelo nome do módulo');
});

teste('funciona sem navigator.locks (navegador antigo)', async () => {
  const { ctx } = montar({ registros: [{ id: 'r1' }], manifestRemoto: null, comLocks: false });
  assert.equal(await ctx.window._cbUploadModulo('saidas'), true, 'degradar, nunca ficar sem backup');
});

// ── F3: gatilho da restauração automática ──────────────────────────────

teste('restauração automática NÃO age se já existe volume importado', async () => {
  // Cenário do bug: o usuário apagou um lote (local ficou com 2), a nuvem
  // ainda tem 5. A regra antiga (por contagem) restauraria e ressuscitaria
  // o que ele acabou de excluir.
  const { ctx } = montar({
    registros: [{ id: 'r1', importId: 'imp1' }, { id: 'r2', importId: 'imp1' }],
    registrosNuvem: Array.from({ length: 5 }, (_, i) => ({ id: `nuvem${i}`, importId: 'imp1' })),
  });
  await ctx.window.restaurarBackupCondensadoSeNecessario();
  assert.equal(ctx.state.saidas.length, 2, 'não pode substituir o dado do usuário');
  assert.equal(ctx.state.saidas[0].id, 'r1', 'o conteúdo local tem que continuar intacto');
});

teste('restauração automática AGE em dispositivo cru (só manuais, nenhum importado)', async () => {
  // Array não está vazio (2 manuais já vieram do Postgres), mas não há NADA
  // importado — é o caso que a regra "só se vazio" deixava passar batido.
  const { ctx } = montar({
    registros: [{ id: 'm1' }, { id: 'm2' }],
    registrosNuvem: Array.from({ length: 5 }, (_, i) => ({ id: `nuvem${i}`, importId: 'imp1' })),
  });
  await ctx.window.restaurarBackupCondensadoSeNecessario();
  assert.equal(ctx.state.saidas.length, 5, 'dispositivo cru precisa receber o volume da nuvem');
  assert.equal(ctx.state.saidas[0].id, 'nuvem0');
});

teste('restauração ABORTA se o hash não bater — nunca deixa estado pela metade', async () => {
  const { ctx } = montar({
    registros: [{ id: 'm1' }],
    registrosNuvem: Array.from({ length: 5 }, (_, i) => ({ id: `nuvem${i}` })),
  });
  // Corrompe o hash esperado depois de montado: o chunk baixa e descomprime
  // certo, mas não confere — tem que abortar sem tocar em state.
  const orig = ctx.window.supabaseClient.storage.from().download;
  ctx.window.supabaseClient.storage.from = () => ({
    download: async (caminho) => {
      const r = await orig(caminho);
      if (caminho.endsWith('manifest.json')) {
        const m = JSON.parse(await r.data.text());
        m.chunkHashes = ['0'.repeat(64)];
        return { data: { text: async () => JSON.stringify(m) }, error: null };
      }
      return r;
    },
    upload: async () => ({ error: null }),
    remove: async () => ({ error: null }),
  });
  await ctx.window.restaurarBackupCondensadoSeNecessario();
  assert.equal(ctx.state.saidas.length, 1, 'hash ruim não pode alterar o estado');
});

// ── F4: geração anterior antes de encolher ─────────────────────────────

teste('GUARDA a geração anterior antes de uma exclusão encolher o backup', async () => {
  const { ctx, copiados } = montar({
    registros: Array.from({ length: 5 }, (_, i) => ({ id: `r${i}` })),
    manifestRemoto: { totalRecords: 100, totalChunks: 2, chunkHashes: ['a', 'b'], savedAt: Date.now() },
  });
  await ctx.window._cbUploadModulo('saidas', { permitirReducao: true });
  assert.ok(copiados.some(c => c.para.includes('anterior/manifest.json')), 'manifest tem que ser copiado');
  assert.equal(copiados.filter(c => c.para.includes('anterior/chunk_')).length, 2, 'os 2 chunks têm que ser copiados');
});

teste('NÃO paga custo de cópia quando o backup só cresce', async () => {
  const { ctx, copiados } = montar({
    registros: Array.from({ length: 200 }, (_, i) => ({ id: `r${i}` })),
    manifestRemoto: { totalRecords: 100, totalChunks: 1, chunkHashes: ['a'], savedAt: Date.now() },
  });
  await ctx.window._cbUploadModulo('saidas');
  assert.equal(copiados.length, 0, 'crescimento normal não deve copiar nada');
});

teste('exclusão NÃO é bloqueada se a cópia anterior falhar', async () => {
  const { ctx, enviados, toasts } = montar({
    registros: Array.from({ length: 5 }, (_, i) => ({ id: `r${i}` })),
    manifestRemoto: { totalRecords: 100, totalChunks: 2, chunkHashes: ['a', 'b'], savedAt: Date.now() },
  });
  const from = ctx.window.supabaseClient.storage.from();
  from.copy = async () => ({ error: { message: 'falha simulada' } });
  const ok = await ctx.window._cbUploadModulo('saidas', { permitirReducao: true });
  assert.equal(ok, true, 'a exclusão pedida pelo usuário não pode travar por causa do snapshot');
  assert.ok(enviados.some(p => p.includes('manifest.json')), 'o backup novo tem que subir mesmo assim');
  assert.ok(toasts.some(t => t.tipo === 'error'), 'mas o usuário precisa ser avisado que não há volta');
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
    console.log(`         ${err.message}`);
  }
}
console.log(`\n${casos.length - falhas}/${casos.length} passaram`);
process.exit(falhas ? 1 : 0);
