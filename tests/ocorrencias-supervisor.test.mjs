// Teste da regra de visão automática do Supervisor em Ocorrências (31/07):
// toda ocorrência escalonada pra nível 2+ (Supervisor do Setor/Gerência) ou
// vinculada a uma DAI (origem_ajuste_sistemico=true) deve entrar
// automaticamente na tela dele — ver ocApareceAutoParaSupervisor() e
// syncOcorrenciasFromSupabase() em ocorrencias.js. Um erro de comparação
// aqui (ex.: usar "nivel > 2" em vez de ">= 2") faria o Supervisor não ver
// ocorrências que já estão no nível dele, ou esconder DAIs — silencioso,
// sem exceção, só "sumindo" da tela.
//
// Também cobre a mesma regra aplicada evento a evento pelo canal Realtime
// (_ocEhRelevantePraMim) e o upsert/remove local (_ocUpsertLocal/
// _ocRemoveLocal) — sem o filtro aqui, o Realtime reviveria a poluição de
// 28/07 (ADM recebendo toda ocorrência de todo mundo, não só a relevante).
//
// Rode com: node tests/ocorrencias-supervisor.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonteOcorrencias = readFileSync(join(raiz, 'js', 'ocorrencias.js'), 'utf8');

function montar({ role = 'admin', integrados = new Set() } = {}) {
  const ctx = {
    console: { info() {}, warn() {}, error() {} },
    state: { ocorrencias: [] },
  };
  // window === global (mesmo objeto), como no navegador de verdade — o
  // arquivo faz `window.foo = function(){}` e depois `Object.assign(window,
  // {foo})` (referência solta) mais embaixo; com um `window` separado do
  // objeto global do vm, a segunda forma quebra com ReferenceError.
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.currentUser = { id: 'u-adm', role };
  // Stub do normalize.js real (fora do escopo deste teste) — só o
  // suficiente pra _ocEhRelevantePraMim funcionar isolado.
  ctx._integracoesDoAdmin = async () => integrados;
  vm.createContext(ctx);
  vm.runInContext(fonteOcorrencias, ctx);
  return ctx;
}

const casos = [];
const teste = (nome, fn) => casos.push({ nome, fn });

const rowBase = { id: 'oc_1', user_id: 'outro-usuario', hierarquia: [], origem_ajuste_sistemico: false };

teste('ocorrência sem escalonamento e sem DAI não aparece pro supervisor', () => {
  const ctx = montar();
  assert.equal(ctx.ocApareceAutoParaSupervisor({ ...rowBase }), false);
});

teste('escalonada até Regional (nível 1) ainda não aparece', () => {
  const ctx = montar();
  const row = { ...rowBase, hierarquia: [{ nivel: 1 }] };
  assert.equal(ctx.ocApareceAutoParaSupervisor(row), false);
});

teste('escalonada até Supervisor do Setor (nível 2) aparece', () => {
  const ctx = montar();
  const row = { ...rowBase, hierarquia: [{ nivel: 1 }, { nivel: 2 }] };
  assert.equal(ctx.ocApareceAutoParaSupervisor(row), true);
});

teste('escalonada até Gerência (nível 3) aparece', () => {
  const ctx = montar();
  const row = { ...rowBase, hierarquia: [{ nivel: 1 }, { nivel: 2 }, { nivel: 3 }] };
  assert.equal(ctx.ocApareceAutoParaSupervisor(row), true);
});

teste('descalonada de volta pra Regional some de novo (usa só o nível ATUAL, não o histórico)', () => {
  const ctx = montar();
  const row = { ...rowBase, hierarquia: [{ nivel: 1 }, { nivel: 2 }, { nivel: 1 }] };
  assert.equal(ctx.ocApareceAutoParaSupervisor(row), false);
});

teste('DAI (origem_ajuste_sistemico=true) aparece mesmo sem nenhum escalonamento', () => {
  const ctx = montar();
  const row = { ...rowBase, origem_ajuste_sistemico: true };
  assert.equal(ctx.ocApareceAutoParaSupervisor(row), true);
});

// ── Realtime: _ocEhRelevantePraMim (31/07) ─────────────────────────────
// Mesma regra do fetch inicial, decidida evento a evento. Sem isto, o
// Realtime reviveria a poluição de 28/07 (ADM recebendo TODA ocorrência
// de TODO usuário) ou, no sentido contrário, esconderia do Supervisor uma
// ocorrência que acabou de ser escalonada/DAI enquanto a sessão dele já
// estava aberta.

teste('usuário comum: sempre relevante (confia na RLS, que já restringiu)', async () => {
  const ctx = montar({ role: 'user' });
  const row = { ...rowBase };
  assert.equal(await ctx._ocEhRelevantePraMim(row), true);
});

teste('admin: ocorrência própria é relevante mesmo sem escalonamento/DAI', async () => {
  const ctx = montar({ role: 'admin' });
  const row = { ...rowBase, user_id: 'u-adm' };
  assert.equal(await ctx._ocEhRelevantePraMim(row), true);
});

teste('admin: ocorrência de outro dono, não integrada, nível baixo, sem DAI — não relevante', async () => {
  const ctx = montar({ role: 'admin' });
  assert.equal(await ctx._ocEhRelevantePraMim({ ...rowBase }), false);
});

teste('admin: ocorrência de outro dono só entra se integrada manualmente', async () => {
  const ctx = montar({ role: 'admin', integrados: new Set(['oc_1']) });
  assert.equal(await ctx._ocEhRelevantePraMim({ ...rowBase }), true);
});

teste('admin: ocorrência escalonada pro nível do Supervisor entra mesmo sem integração manual', async () => {
  const ctx = montar({ role: 'admin' });
  const row = { ...rowBase, hierarquia: [{ nivel: 2 }] };
  assert.equal(await ctx._ocEhRelevantePraMim(row), true);
});

// ── Realtime: upsert/remove local ──────────────────────────────────────

teste('_ocUpsertLocal insere quando não existe e atualiza em vez de duplicar quando já existe', () => {
  const ctx = montar();
  ctx.state.ocorrencias = [];
  ctx._ocUpsertLocal({ ...rowBase, motivo: 'primeira versão' });
  ctx._ocUpsertLocal({ ...rowBase, motivo: 'versão editada' });
  assert.equal(ctx.state.ocorrencias.length, 1);
  assert.equal(ctx.state.ocorrencias[0].motivo, 'versão editada');
});

teste('_ocRemoveLocal remove só o par (id, userId) certo, não mexe em outros donos com o mesmo id', () => {
  const ctx = montar();
  ctx.state.ocorrencias = [];
  ctx._ocUpsertLocal({ ...rowBase, id: 'oc_1', user_id: 'dono-a' });
  ctx._ocUpsertLocal({ ...rowBase, id: 'oc_1', user_id: 'dono-b' });
  ctx._ocRemoveLocal('oc_1', 'dono-a');
  assert.equal(ctx.state.ocorrencias.length, 1);
  assert.equal(ctx.state.ocorrencias[0].userId, 'dono-b');
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
