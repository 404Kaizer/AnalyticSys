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

function montar({ role = 'admin', motivo = null } = {}) {
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
    // Stub de ocorrencias.js (fora do escopo deste arquivo) — só o
    // suficiente pra _activityEhOcorrenciaPrioritariaParaMim funcionar
    // isolado, sem carregar o módulo inteiro de Ocorrências.
    _ocMotivoRelevancia: async () => motivo,
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
