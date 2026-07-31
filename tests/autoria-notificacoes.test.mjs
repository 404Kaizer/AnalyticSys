// Teste da autoria em notificações/hierarquia (31/07, pedido do usuário):
// "hoje eu não sei quem que escalonou a ocorrência". Antes, `responsavel`
// (texto livre, "responsável por aquele nível") era o único campo — vazio
// na maioria dos casos e, mesmo preenchido, não confiável como "quem
// clicou". Agora todo evento (escalonar/concluir/reabrir/inconclusiva/
// descalonar) grava automaticamente quem executou a ação
// (_ocNomeAtor/acionadoPor/ultimaAcaoPorNome), e os textos de notificação
// e hierarquia passam a citar esse nome em vez de "o Supervisor" genérico.
//
// Rode com: node tests/autoria-notificacoes.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonteOcorrencias = readFileSync(join(raiz, 'js', 'ocorrencias.js'), 'utf8');

function montar({ nomeCompleto = 'Marlon Coelho', email = 'marlon@x.com' } = {}) {
  const ctx = {
    console: { info() {}, warn() {}, error() {} },
    state: { ocorrencias: [] },
    document: {
      addEventListener() {},
      getElementById() { return null; },
    },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.currentUser = { id: 'u-1', role: 'user', nome_completo: nomeCompleto, email };
  ctx.escapeHtml = (s) => String(s ?? '');
  ctx.fmtDateBR = (s) => s || '';
  vm.createContext(ctx);
  vm.runInContext(fonteOcorrencias, ctx);
  return ctx;
}

const casos = [];
const teste = (nome, fn) => casos.push({ nome, fn });

// ── _ocNomeAtor ──────────────────────────────────────────────────────

teste('_ocNomeAtor: usa nome_completo do usuário logado', () => {
  const ctx = montar({ nomeCompleto: 'Marlon Coelho' });
  assert.equal(ctx._ocNomeAtor(), 'Marlon Coelho');
});

teste('_ocNomeAtor: sem nome_completo, cai no e-mail', () => {
  const ctx = montar({ nomeCompleto: '', email: 'x@x.com' });
  assert.equal(ctx._ocNomeAtor(), 'x@x.com');
});

// ── submitEscalonar: grava acionadoPor no item de hierarquia ──────────

teste('submitEscalonar: grava acionadoPor (quem clicou), separado de responsavel (texto livre)', () => {
  const ctx = montar({ nomeCompleto: 'Marlon Coelho' });
  ctx.state.ocorrencias = [{ id: 'oc_1', hierarquia: [] }];
  ctx.document.getElementById = (id) => ({
    'oc-escalonar-id': { value: 'oc_1' },
    'oc-escalonar-nivel': { value: '2' },
    'oc-escalonar-motivo': { value: 'Sem resposta da usina' },
    'oc-escalonar-responsavel': { value: 'Gerência Regional' }, // texto livre, destinatário
    'oc-escalonar-data': { value: '2026-07-31' },
    'oc-escalonar-contato': { value: '' },
  }[id] || null);
  ctx.persist = () => {};
  ctx.renderOcorrencias = () => {};
  ctx.closeEscalonarModal = () => {};
  ctx.toast = () => {};
  ctx._ocSyncUpsert = () => {};
  ctx.submitEscalonar();
  const entrada = ctx.state.ocorrencias[0].hierarquia[0];
  assert.equal(entrada.responsavel, 'Gerência Regional');
  assert.equal(entrada.acionadoPor, 'Marlon Coelho');
});

// ── submitConcluir/reabrir/inconclusiva/descalonar: ultimaAcaoPorNome ──

teste('submitConcluir: grava ultimaAcaoTipo/ultimaAcaoPorNome', () => {
  const ctx = montar({ nomeCompleto: 'Hugo Rios' });
  ctx.state.ocorrencias = [{ id: 'oc_1', concluida: false }];
  ctx.document.getElementById = (id) => ({
    'oc-concluir-id': { value: 'oc_1' },
    'oc-concluir-data': { value: '2026-07-31' },
    'oc-concluir-desc': { value: 'Ajuste finalizado' },
  }[id] || null);
  ctx.persist = () => {};
  ctx.renderOcorrencias = () => {};
  ctx.closeConcluirModal = () => {};
  ctx.toast = () => {};
  ctx._ocSyncUpsert = () => {};
  ctx.submitConcluir();
  assert.equal(ctx.state.ocorrencias[0].ultimaAcaoTipo, 'concluida');
  assert.equal(ctx.state.ocorrencias[0].ultimaAcaoPorNome, 'Hugo Rios');
});

// ── _ocDetectarMudancaPrioritaria: título cita o nome, não "o Supervisor" ──

teste('_ocDetectarMudancaPrioritaria: concluida cita ultima_acao_por_nome no título', () => {
  const ctx = montar();
  const base = { central: 'ABA1', numero: 'OC-1', concluida: false, inconclusiva: false, hierarquia: [] };
  const r = ctx._ocDetectarMudancaPrioritaria(base, { ...base, concluida: true, ultima_acao_por_nome: 'Hugo Rios' });
  assert.equal(r.titulo, 'Hugo Rios concluiu sua ocorrência');
});

teste('_ocDetectarMudancaPrioritaria: sem nome resolvido, cai no genérico "O Supervisor" (comportamento antigo preservado)', () => {
  const ctx = montar();
  const base = { central: 'ABA1', numero: 'OC-1', concluida: false, inconclusiva: false, hierarquia: [] };
  const r = ctx._ocDetectarMudancaPrioritaria(base, { ...base, concluida: true });
  assert.equal(r.titulo, 'O Supervisor concluiu sua ocorrência');
});

teste('_ocDetectarMudancaPrioritaria: escalonada cita acionadoPor do ÚLTIMO item de hierarquia, não ultima_acao_por_nome', () => {
  const ctx = montar();
  const base = { central: 'ABA1', numero: 'OC-1', concluida: false, inconclusiva: false, hierarquia: [{ nivel: 2 }] };
  const newData = { ...base, hierarquia: [{ nivel: 2 }, { nivel: 3, acionadoPor: 'Claudir Souza' }] };
  const r = ctx._ocDetectarMudancaPrioritaria(base, newData);
  assert.equal(r.tipo, 'escalonada');
  assert.match(r.titulo, /^Claudir Souza escalonou sua ocorrência para/);
});

// ── _ocMontarTituloNotificacaoSupervisor ───────────────────────────────

teste('_ocMontarTituloNotificacaoSupervisor: DAI cita o dono (criado_por_nome)', () => {
  const ctx = montar();
  const row = { id: 'oc_1', dai_tag: 'DAI-HUGO-9', criado_por_nome: 'Hugo Rios' };
  assert.equal(ctx._ocMontarTituloNotificacaoSupervisor(row, 'dai'), 'Nova DAI de Hugo Rios — DAI-HUGO-9');
});

teste('_ocMontarTituloNotificacaoSupervisor: escalonamento cita dono e quem escalonou', () => {
  const ctx = montar();
  const row = {
    id: 'oc_1', criado_por_nome: 'Marlon Coelho',
    hierarquia: [{ nivel: 1 }, { nivel: 2, acionadoPor: 'Hugo Rios' }],
  };
  const titulo = ctx._ocMontarTituloNotificacaoSupervisor(row, 'escalonamento');
  assert.match(titulo, /^Ocorrência de Marlon Coelho escalonada \(por Hugo Rios\) —/);
});

teste('_ocMontarTituloNotificacaoSupervisor: sem dono/ator resolvidos, cai nos genéricos (não quebra)', () => {
  const ctx = montar();
  const titulo = ctx._ocMontarTituloNotificacaoSupervisor({ id: 'oc_1', hierarquia: [] }, 'escalonamento');
  assert.match(titulo, /^Ocorrência de usuário escalonada —/);
  assert.ok(!titulo.includes('por'));
});

// ── _ocHierMetaTexto ─────────────────────────────────────────────────

teste('_ocHierMetaTexto: mostra responsavel E acionadoPor quando os dois existem', () => {
  const ctx = montar();
  assert.equal(ctx._ocHierMetaTexto({ responsavel: 'Gerência Regional', acionadoPor: 'Marlon Coelho' }), ' · Gerência Regional · escalonado por Marlon Coelho');
});

teste('_ocHierMetaTexto: só acionadoPor, sem responsavel', () => {
  const ctx = montar();
  assert.equal(ctx._ocHierMetaTexto({ acionadoPor: 'Marlon Coelho' }), ' · escalonado por Marlon Coelho');
});

teste('_ocHierMetaTexto: entrada vazia/nula não quebra', () => {
  const ctx = montar();
  assert.equal(ctx._ocHierMetaTexto(null), '');
  assert.equal(ctx._ocHierMetaTexto({}), '');
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
