// Teste da notificação de prioridade do Supervisor (escalonamento/DAI, ver
// notifPushOcorrenciaSupervisor/notifAbrirOcorrenciaPrioritaria em
// notifications.js, disparada por ocorrencias.js/_ocRealtimeInit). Cobre
// os dois requisitos: (1) não duplicar a mesma ocorrência na lista de
// notificações e (2) o clique abrir o modal PADRÃO de Ocorrências
// (openOcDetailModal), não o modal genérico de detalhe de atividade.
//
// Rode com: node tests/notif-supervisor.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonte = readFileSync(join(raiz, 'js', 'notifications.js'), 'utf8');

function montar({ role = 'admin', motivo = null, mudanca = null } = {}) {
  const chamadas = { navigate: [], openOcDetailModal: [], persist: 0 };
  const ctx = {
    console: { info() {}, warn() {}, error() {} },
    state: { notifications: [] },
    // notifications.js registra um listener de click no document já no
    // carregamento (fora de qualquer função) — precisa existir pra
    // vm.runInContext não quebrar.
    document: {
      addEventListener() {},
      getElementById() { return null; },
    },
    persist: () => { chamadas.persist++; },
    navigate: (page) => { chamadas.navigate.push(page); },
    openOcDetailModal: (id) => { chamadas.openOcDetailModal.push(id); },
    // Stubs de ocorrencias.js (fora do escopo deste arquivo) — só o
    // suficiente pra _activityEhOcorrenciaPrioritariaParaMim/
    // _activityNotificarMudancaOcorrencia funcionarem isolados, sem
    // carregar o módulo inteiro de Ocorrências.
    _ocMotivoRelevancia: async () => motivo,
    _ocDetectarMudancaPrioritaria: () => mudanca,
  };
  ctx.window = ctx; // window === global, mesmo motivo do teste de ocorrencias.js
  ctx.globalThis = ctx;
  ctx.currentUser = { id: 'u-adm', role };
  vm.createContext(ctx);
  vm.runInContext(fonte, ctx);
  return { ctx, chamadas };
}

const casos = [];
const teste = (nome, fn) => casos.push({ nome, fn });

teste('cria notificação de escalonamento com id previsível e level crítico', () => {
  const { ctx } = montar();
  ctx.notifPushOcorrenciaSupervisor({ ocorrenciaId: 'oc_1', tipo: 'escalonamento', titulo: 'Ocorrência escalonada', corpo: 'ABA1' });
  assert.equal(ctx.state.notifications.length, 1);
  const n = ctx.state.notifications[0];
  assert.equal(n.id, 'escalonamento-oc-oc_1');
  assert.equal(n.type, 'escalonamento');
  assert.equal(n.level, 'critico');
  assert.equal(n.ocorrenciaId, 'oc_1');
  assert.equal(n.read, false);
});

teste('não duplica ao chamar de novo pra mesma ocorrência/motivo', () => {
  const { ctx } = montar();
  ctx.notifPushOcorrenciaSupervisor({ ocorrenciaId: 'oc_1', tipo: 'dai', titulo: 'Nova DAI', corpo: 'ABA1' });
  ctx.notifPushOcorrenciaSupervisor({ ocorrenciaId: 'oc_1', tipo: 'dai', titulo: 'Nova DAI (de novo)', corpo: 'ABA1' });
  assert.equal(ctx.state.notifications.length, 1);
  assert.equal(ctx.state.notifications[0].title, 'Nova DAI'); // a primeira, não sobrescrita
});

teste('escalonamento e dai da MESMA ocorrência são entradas distintas (ids diferentes)', () => {
  const { ctx } = montar();
  ctx.notifPushOcorrenciaSupervisor({ ocorrenciaId: 'oc_1', tipo: 'escalonamento', titulo: 'Escalonada', corpo: '' });
  ctx.notifPushOcorrenciaSupervisor({ ocorrenciaId: 'oc_1', tipo: 'dai', titulo: 'Nova DAI', corpo: '' });
  assert.equal(ctx.state.notifications.length, 2);
});

teste('clicar na notificação abre o modal PADRÃO de Ocorrências (não o genérico de atividade)', () => {
  const { ctx, chamadas } = montar();
  ctx.notifPushOcorrenciaSupervisor({ ocorrenciaId: 'oc_42', tipo: 'escalonamento', titulo: 'x', corpo: '' });
  ctx.notifAbrirOcorrenciaPrioritaria('escalonamento-oc-oc_42');
  assert.deepEqual(chamadas.navigate, ['ocorrencias']);
  assert.deepEqual(chamadas.openOcDetailModal, ['oc_42']);
  assert.equal(ctx.state.notifications[0].read, true);
});

teste('clicar numa notificação inexistente não quebra e não navega', () => {
  const { ctx, chamadas } = montar();
  ctx.notifAbrirOcorrenciaPrioritaria('escalonamento-oc-nao-existe');
  assert.deepEqual(chamadas.navigate, []);
  assert.deepEqual(chamadas.openOcDetailModal, []);
});

// ── _activityEhOcorrenciaPrioritariaParaMim (31/07) ────────────────────
// Achado do usuário: a mesma ocorrência escalonada gerava DUAS notificações
// — a genérica de atividade ("fulano criou um registro") E a dedicada
// ("Ocorrência escalonada"). Esta função corta a genérica quando (e só
// quando) a dedicada já cobre o caso — reusa _ocMotivoRelevancia pra nunca
// dessincronizar dos dois motivos ('escalonamento'/'dai') que a dedicada
// realmente dispara.

const activityRowOc = { table_name: 'ocorrencias', operation: 'INSERT', new_data: { id: 'oc_1' } };

teste('corta a genérica quando o motivo é "escalonamento"', async () => {
  const { ctx } = montar({ motivo: 'escalonamento' });
  assert.equal(await ctx._activityEhOcorrenciaPrioritariaParaMim(activityRowOc), true);
});

teste('corta a genérica quando o motivo é "dai"', async () => {
  const { ctx } = montar({ motivo: 'dai' });
  assert.equal(await ctx._activityEhOcorrenciaPrioritariaParaMim(activityRowOc), true);
});

teste('NÃO corta quando o motivo é "proprio" — a dedicada nunca dispara pra ocorrência do próprio ADM', async () => {
  const { ctx } = montar({ motivo: 'proprio' });
  assert.equal(await ctx._activityEhOcorrenciaPrioritariaParaMim(activityRowOc), false);
});

teste('NÃO corta quando o motivo é "integrado" — a dedicada não cobre integração manual', async () => {
  const { ctx } = montar({ motivo: 'integrado' });
  assert.equal(await ctx._activityEhOcorrenciaPrioritariaParaMim(activityRowOc), false);
});

teste('NÃO corta quando não há motivo nenhum (null)', async () => {
  const { ctx } = montar({ motivo: null });
  assert.equal(await ctx._activityEhOcorrenciaPrioritariaParaMim(activityRowOc), false);
});

teste('NÃO corta pra usuário comum (a dedicada só existe pro Supervisor)', async () => {
  const { ctx } = montar({ role: 'user', motivo: 'escalonamento' });
  assert.equal(await ctx._activityEhOcorrenciaPrioritariaParaMim(activityRowOc), false);
});

teste('NÃO corta atividade de outra tabela, mesmo com motivo "escalonamento" (não faz sentido fora de ocorrencias)', async () => {
  const { ctx } = montar({ motivo: 'escalonamento' });
  const row = { ...activityRowOc, table_name: 'lancamentos' };
  assert.equal(await ctx._activityEhOcorrenciaPrioritariaParaMim(row), false);
});

teste('DELETE usa old_data, não new_data', async () => {
  const { ctx } = montar({ motivo: 'dai' });
  const row = { table_name: 'ocorrencias', operation: 'DELETE', old_data: { id: 'oc_1' }, new_data: null };
  assert.equal(await ctx._activityEhOcorrenciaPrioritariaParaMim(row), true);
});

// ── _activityNotificarMudancaOcorrencia / notifPushMudancaOcorrencia ──
// Lado do DONO: quando o Supervisor escalona/conclui/etc. a ocorrência de
// outra pessoa, o dono recebe uma notificação ESPECÍFICA (não a genérica).

const activityRowUpdate = { id: 'log_1', row_id: 'oc_1', table_name: 'ocorrencias', operation: 'UPDATE', old_data: {}, new_data: {} };

teste('dispara e cria a notificação quando há mudança de prioridade', () => {
  const { ctx } = montar({ role: 'user', mudanca: { tipo: 'escalonada', titulo: 'O Supervisor escalonou sua ocorrência para Gerência', corpo: 'ABA1' } });
  const disparou = ctx._activityNotificarMudancaOcorrencia(activityRowUpdate);
  assert.equal(disparou, true);
  assert.equal(ctx.state.notifications.length, 1);
  const n = ctx.state.notifications[0];
  assert.equal(n.type, 'acao-supervisor');
  assert.equal(n.ocorrenciaId, 'oc_1');
  assert.equal(n.id, 'acao-supervisor-log_1');
  assert.equal(n.level, 'critico');
});

teste('não dispara quando não há mudança de prioridade (edição de campo)', () => {
  const { ctx } = montar({ role: 'user', mudanca: null });
  assert.equal(ctx._activityNotificarMudancaOcorrencia(activityRowUpdate), false);
  assert.equal(ctx.state.notifications.length, 0);
});

teste('não dispara pro próprio Supervisor (essa notificação é pro DONO)', () => {
  const { ctx } = montar({ role: 'admin', mudanca: { tipo: 'concluida', titulo: 'x', corpo: '' } });
  assert.equal(ctx._activityNotificarMudancaOcorrencia(activityRowUpdate), false);
  assert.equal(ctx.state.notifications.length, 0);
});

teste('não dispara pra outra tabela nem pra INSERT/DELETE', () => {
  const { ctx } = montar({ role: 'user', mudanca: { tipo: 'concluida', titulo: 'x', corpo: '' } });
  assert.equal(ctx._activityNotificarMudancaOcorrencia({ ...activityRowUpdate, table_name: 'lancamentos' }), false);
  assert.equal(ctx._activityNotificarMudancaOcorrencia({ ...activityRowUpdate, operation: 'INSERT' }), false);
});

teste('clicar na notificação de mudança abre o modal padrão de Ocorrências', () => {
  const { ctx, chamadas } = montar({ role: 'user', mudanca: { tipo: 'inconclusiva', titulo: 'x', corpo: '' } });
  ctx._activityNotificarMudancaOcorrencia(activityRowUpdate);
  ctx.notifAbrirOcorrenciaPrioritaria('acao-supervisor-log_1');
  assert.deepEqual(chamadas.navigate, ['ocorrencias']);
  assert.deepEqual(chamadas.openOcDetailModal, ['oc_1']);
});

// ── _activityShouldNotify: LOGIN não notifica mais (31/07) ─────────────
// Achado do usuário: LOGIN de qualquer usuário pousava no sino do
// Supervisor toda vez — virou ruído puro. O corte é só da NOTIFICAÇÃO
// (activity_log continua gravando tudo, auditoria intacta).

teste('LOGIN de outro usuário não notifica o admin (antes notificava)', () => {
  const { ctx } = montar({ role: 'admin' });
  const row = { table_name: 'auth', operation: 'LOGIN', actor_id: 'outro-usuario' };
  assert.equal(ctx._activityShouldNotify(row), false);
});

teste('LOGOUT de outro usuário continua notificando o admin normalmente', () => {
  const { ctx } = montar({ role: 'admin' });
  const row = { table_name: 'auth', operation: 'LOGOUT', actor_id: 'outro-usuario' };
  assert.equal(ctx._activityShouldNotify(row), true);
});

teste('PASSWORD_CHANGE de outro usuário continua notificando o admin normalmente', () => {
  const { ctx } = montar({ role: 'admin' });
  const row = { table_name: 'auth', operation: 'PASSWORD_CHANGE', actor_id: 'outro-usuario' };
  assert.equal(ctx._activityShouldNotify(row), true);
});

teste('atividade normal (não-auth) continua notificando o admin normalmente', () => {
  const { ctx } = montar({ role: 'admin' });
  const row = { table_name: 'ocorrencias', operation: 'UPDATE', actor_id: 'outro-usuario' };
  assert.equal(ctx._activityShouldNotify(row), true);
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
