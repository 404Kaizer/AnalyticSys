// Teste do fix (31/07): anexos de DAI criada/anexada manualmente no app
// só existiam no IndexedDB do navegador de quem gerou — outro
// analista/ADM, ou o mesmo analista em outro dispositivo, não conseguia
// recuperá-los (baixarZipDai reportava "faltante", achado real documentado
// no próprio dai.js). Agora sobem pro Supabase Storage (mesmo bucket já
// usado pelo formulário público, "solicitacoes-anexos", sob o prefixo
// "interno/" — ver migration dai_anexos_manuais_insert_policy) e o `path`
// retornado vira a fonte de verdade nos metadados (dai.anexos[].path),
// igual ao que já acontecia com anexos do formulário público.
//
// Rode com: node tests/dai-anexos-storage.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonteDai = readFileSync(join(raiz, 'js', 'dai.js'), 'utf8');

function fakeFile(nome, conteudo = 'x') {
  return {
    name: nome,
    type: 'application/pdf',
    size: conteudo.length,
    arrayBuffer: async () => new TextEncoder().encode(conteudo).buffer,
  };
}

function montar({ uploadError = null } = {}) {
  const chamadas = { uploads: [], toasts: [], persist: 0, render: 0, syncUpsert: [] };
  const ctx = {
    console: { info() {}, warn() {}, error() {} },
    state: { ocorrencias: [], ajustesSistemicos: [] },
    document: {
      addEventListener() {},
      getElementById() { return null; },
    },
    crypto: webcrypto,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.currentUser = { id: 'u-1', role: 'user' };
  ctx.supabaseClient = {
    storage: {
      from(bucket) {
        return {
          upload: async (path, file, opts) => {
            chamadas.uploads.push({ bucket, path, contentType: opts?.contentType });
            return { error: uploadError };
          },
        };
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(fonteDai, ctx);
  // Sobrescreve DEPOIS de carregar o arquivo — _daiSyncUpsert é declarada
  // dentro do próprio dai.js (function declaration no topo), então um
  // stub setado ANTES do vm.runInContext seria sobrescrito pela
  // implementação real ao carregar o script.
  ctx.toast = (msg, tipo) => { chamadas.toasts.push({ msg, tipo }); };
  ctx.persist = () => { chamadas.persist++; };
  ctx.renderOcorrencias = () => { chamadas.render++; };
  ctx._daiSyncUpsert = (dai) => { chamadas.syncUpsert.push(dai.id); };
  return { ctx, chamadas };
}

const casos = [];
const teste = (nome, fn) => casos.push({ nome, fn });

teste('_daiSubirAnexo: sucesso — sobe no bucket solicitacoes-anexos, prefixo interno/{daiId}/, devolve o path', async () => {
  const { ctx, chamadas } = montar();
  const path = await ctx._daiSubirAnexo('dai_1', fakeFile('foto.pdf'));
  assert.equal(chamadas.uploads.length, 1);
  assert.equal(chamadas.uploads[0].bucket, 'solicitacoes-anexos');
  assert.match(chamadas.uploads[0].path, /^interno\/dai_1\/\d+_foto\.pdf$/);
  assert.equal(path, chamadas.uploads[0].path);
});

teste('_daiSubirAnexo: sanitiza nome de arquivo com caracteres especiais', async () => {
  const { ctx, chamadas } = montar();
  await ctx._daiSubirAnexo('dai_1', fakeFile('nota fiscal (1)#2.pdf'));
  assert.match(chamadas.uploads[0].path, /^interno\/dai_1\/\d+_nota_fiscal__1__2\.pdf$/);
});

teste('_daiSubirAnexo: falha no upload devolve null, não lança exceção', async () => {
  const { ctx } = montar({ uploadError: { message: 'RLS' } });
  const path = await ctx._daiSubirAnexo('dai_1', fakeFile('foto.pdf'));
  assert.equal(path, null);
});

teste('_daiAdicionarAnexosPosGeracao: sucesso — grava path no metadado e sincroniza', async () => {
  const { ctx, chamadas } = montar();
  const dai = { id: 'dai_1', anexos: [] };
  await ctx._daiAdicionarAnexosPosGeracao(dai, [fakeFile('termo.pdf')]);
  assert.equal(dai.anexos.length, 1);
  assert.ok(dai.anexos[0].path, 'deveria ter path do Storage');
  assert.equal(dai.anexos[0].nome, 'termo.pdf');
  assert.equal(chamadas.persist, 1);
  assert.deepEqual(chamadas.syncUpsert, ['dai_1']);
});

teste('_daiAdicionarAnexosPosGeracao: upload falho não adiciona o anexo nem sincroniza, e avisa por toast', async () => {
  const { ctx, chamadas } = montar({ uploadError: { message: 'RLS' } });
  const dai = { id: 'dai_1', anexos: [] };
  await ctx._daiAdicionarAnexosPosGeracao(dai, [fakeFile('termo.pdf')]);
  assert.equal(dai.anexos.length, 0);
  assert.equal(chamadas.persist, 0);
  assert.ok(chamadas.toasts.some(t => t.tipo === 'error'));
});

teste('_daiAdicionarAnexosPosGeracao: mistura de sucesso e falha — só o que subiu entra em dai.anexos', async () => {
  let chamada = 0;
  const { ctx, chamadas } = montar();
  // Sobrescreve upload pra falhar só na 2ª chamada
  ctx.supabaseClient.storage.from = () => ({
    upload: async (path) => {
      chamada++;
      chamadas.uploads.push(path);
      return { error: chamada === 2 ? { message: 'RLS' } : null };
    },
  });
  const dai = { id: 'dai_1', anexos: [] };
  await ctx._daiAdicionarAnexosPosGeracao(dai, [fakeFile('ok.pdf'), fakeFile('falha.pdf')]);
  assert.equal(dai.anexos.length, 1);
  assert.equal(dai.anexos[0].nome, 'ok.pdf');
});

let falhou = 0;
for (const { nome, fn } of casos) {
  try {
    await fn();
    console.log(`  ok  ${nome}`);
  } catch (err) {
    falhou++;
    console.error(`FALHA  ${nome}`);
    console.error(err);
  }
}
console.log(`\n${casos.length - falhou}/${casos.length} passaram`);
if (falhou) process.exit(1);
