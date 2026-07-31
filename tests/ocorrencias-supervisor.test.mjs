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

// ── _ocMotivoRelevancia (31/07) — o MOTIVO, não só se é relevante. É o que
// decide se a notificação de prioridade do Supervisor dispara: só deve
// disparar pra 'escalonamento'/'dai', nunca pra 'proprio'/'integrado'/'rls'
// (esses já têm seus próprios avisos, ou nem fazem sentido pro usuário
// comum, que nunca entra nesses dois motivos).

teste('motivo: usuário comum é sempre "rls" (confia na RLS)', async () => {
  const ctx = montar({ role: 'user' });
  assert.equal(await ctx._ocMotivoRelevancia({ ...rowBase }), 'rls');
});

teste('motivo: ocorrência própria do admin é "proprio"', async () => {
  const ctx = montar({ role: 'admin' });
  assert.equal(await ctx._ocMotivoRelevancia({ ...rowBase, user_id: 'u-adm' }), 'proprio');
});

teste('motivo: ocorrência integrada manualmente é "integrado", mesmo já escalonada (integração manual tem prioridade)', async () => {
  const ctx = montar({ role: 'admin', integrados: new Set(['oc_1']) });
  const row = { ...rowBase, hierarquia: [{ nivel: 2 }] };
  assert.equal(await ctx._ocMotivoRelevancia(row), 'integrado');
});

teste('motivo: escalonada pro nível do Supervisor, sem DAI, é "escalonamento"', async () => {
  const ctx = montar({ role: 'admin' });
  const row = { ...rowBase, hierarquia: [{ nivel: 2 }] };
  assert.equal(await ctx._ocMotivoRelevancia(row), 'escalonamento');
});

teste('motivo: origem_ajuste_sistemico=true é "dai", mesmo sem nenhum escalonamento', async () => {
  const ctx = montar({ role: 'admin' });
  const row = { ...rowBase, origem_ajuste_sistemico: true };
  assert.equal(await ctx._ocMotivoRelevancia(row), 'dai');
});

teste('motivo: nada disso (nível baixo, sem DAI, não integrada, não própria) é null', async () => {
  const ctx = montar({ role: 'admin' });
  assert.equal(await ctx._ocMotivoRelevancia({ ...rowBase }), null);
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

// BUG REAL (31/07): criei uma ocorrência → entra otimista no state com
// userId ainda vazio (round-trip não terminou) → o INSERT que o próprio
// upsert dispara chega pelo canal Realtime com user_id já resolvido pelo
// banco → _ocUpsertLocal comparava userId==userId sem fallback, não
// achava a entrada local (undefined !== uuid) e duplicava o card.
teste('_ocUpsertLocal não duplica quando o evento Realtime confirma uma ocorrência recém-criada localmente (userId ainda não resolvido)', () => {
  const ctx = montar({ role: 'user' });
  ctx.currentUser = { id: 'dono-a', role: 'user' };
  ctx.state.ocorrencias = [{ id: 'OC-HUGO-1', userId: undefined, motivo: 'criada localmente' }];
  ctx._ocUpsertLocal({ ...rowBase, id: 'OC-HUGO-1', user_id: 'dono-a', motivo: 'criada localmente' });
  assert.equal(ctx.state.ocorrencias.length, 1);
  assert.equal(ctx.state.ocorrencias[0].userId, 'dono-a');
});

// ── _ocToDbRow: user_id explícito (31/07) ──────────────────────────────
// BUG REAL: a coluna ocorrencias.user_id tem `default auth.uid()`. Sem
// mandar user_id explícito no upsert, editar a ocorrência de OUTRO dono
// (Supervisor mexendo em algo escalonado pra ele) caía no default — o
// PRÓPRIO uid de quem editou — e o onConflict:'user_id,id' passava a
// mirar (meu_id, id) em vez de (dono_real, id): sem linha existente ali,
// o upsert INSERIA uma cópia nova em vez de atualizar a original —
// duplicava pro Supervisor e a edição nunca chegava no dono de verdade.

teste('_ocToDbRow manda o user_id do DONO ORIGINAL, não do currentUser', () => {
  const ctx = montar({ role: 'admin' }); // currentUser.id = 'u-adm'
  const row = ctx._ocToDbRow({ id: 'oc_1', userId: 'dono-real' });
  assert.equal(row.user_id, 'dono-real');
});

teste('_ocToDbRow cai no currentUser só quando userId ainda não foi resolvido (criação nova)', () => {
  const ctx = montar({ role: 'admin' });
  const row = ctx._ocToDbRow({ id: 'oc_1', userId: undefined });
  assert.equal(row.user_id, 'u-adm');
});

// ── _ocDetectarMudancaPrioritaria (31/07) ──────────────────────────────
// Notificação pro DONO quando o Supervisor mexe na ocorrência dele —
// precisa acertar exatamente QUAL mudança aconteceu (escalonou/concluiu/
// marcou inconclusiva/reabriu/descalonou), e não disparar nada pra edição
// "de campo" (central, descrição etc.).

const daiBase = { central: 'ABA1', numero: 'OC-HUGO-1', concluida: false, inconclusiva: false, hierarquia: [] };

teste('mudança: concluida false→true é "concluida"', () => {
  const ctx = montar();
  const r = ctx._ocDetectarMudancaPrioritaria(daiBase, { ...daiBase, concluida: true });
  assert.equal(r.tipo, 'concluida');
});

teste('mudança: inconclusiva false→true é "inconclusiva"', () => {
  const ctx = montar();
  const r = ctx._ocDetectarMudancaPrioritaria(daiBase, { ...daiBase, inconclusiva: true });
  assert.equal(r.tipo, 'inconclusiva');
});

teste('mudança: concluida true→false é "reaberta"', () => {
  const ctx = montar();
  const r = ctx._ocDetectarMudancaPrioritaria({ ...daiBase, concluida: true }, { ...daiBase, concluida: false });
  assert.equal(r.tipo, 'reaberta');
});

teste('mudança: inconclusiva true→false é "reaberta"', () => {
  const ctx = montar();
  const r = ctx._ocDetectarMudancaPrioritaria({ ...daiBase, inconclusiva: true }, { ...daiBase, inconclusiva: false });
  assert.equal(r.tipo, 'reaberta');
});

teste('mudança: nível sobe (escalonou pra Gerência) é "escalonada", com o nome do nível no título', () => {
  const ctx = montar();
  const r = ctx._ocDetectarMudancaPrioritaria(
    { ...daiBase, hierarquia: [{ nivel: 2 }] },
    { ...daiBase, hierarquia: [{ nivel: 2 }, { nivel: 3 }] },
  );
  assert.equal(r.tipo, 'escalonada');
  assert.match(r.titulo, /Gerência/);
});

teste('mudança: nível desce é "descalonada"', () => {
  const ctx = montar();
  const r = ctx._ocDetectarMudancaPrioritaria(
    { ...daiBase, hierarquia: [{ nivel: 2 }, { nivel: 3 }] },
    { ...daiBase, hierarquia: [{ nivel: 2 }] },
  );
  assert.equal(r.tipo, 'descalonada');
});

teste('sem mudança de prioridade (só editou central/descrição) devolve null', () => {
  const ctx = montar();
  const r = ctx._ocDetectarMudancaPrioritaria(daiBase, { ...daiBase, central: 'ABA2' });
  assert.equal(r, null);
});

teste('old_data ou new_data ausentes devolve null (não quebra)', () => {
  const ctx = montar();
  assert.equal(ctx._ocDetectarMudancaPrioritaria(null, daiBase), null);
  assert.equal(ctx._ocDetectarMudancaPrioritaria(daiBase, null), null);
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
