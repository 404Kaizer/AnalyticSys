// Teste do filtro de período em Ocorrências (31/07, pedido do usuário:
// "crie um filtro de seleção de período... meu sistema já tem um padrão
// que você pode replicar") — reaproveita o componente de calendário já
// usado em Analítico/Dashboard Gerencial/Ausências (js/calendar.js), só
// com pfx="oc" novo. Cobre especificamente o que foi adicionado a
// calendar.js: calClearRange (contraparte de calSetRange, usada pelo
// "Limpar Filtros" de Ocorrências — ver ocClearAllMicroFilters,
// ocorrencias.js). O resto do calendário (grid de dias, navegação de
// mês/ano) já é código existente, não tocado aqui.
//
// Rode com: node tests/calendar-oc.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonteCalendar = readFileSync(join(raiz, 'js', 'calendar.js'), 'utf8');

function fakeEl(overrides = {}) {
  return { value: '', textContent: '', classList: { _set: new Set(), add(c) { this._set.add(c); }, remove(c) { this._set.delete(c); }, contains(c) { return this._set.has(c); } }, ...overrides };
}

function montar() {
  const els = {
    'oc-dt-ini': fakeEl(),
    'oc-dt-fim': fakeEl(),
    'oc-cal-label': fakeEl(),
    'oc-cal-trigger': fakeEl(),
    'oc-cal-dropdown': fakeEl(), // fechado por padrão (classList sem 'open')
  };
  const ctx = {
    console: { info() {}, warn() {}, error() {} },
    document: {
      addEventListener() {},
      getElementById: (id) => els[id] || null,
      querySelectorAll: () => [],
    },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fonteCalendar, ctx);
  return { ctx, els };
}

const casos = [];
const teste = (nome, fn) => casos.push({ nome, fn });

teste('calSetRange + calClearRange: define o período e depois limpa os hidden inputs', () => {
  const { ctx, els } = montar();
  ctx.calSetRange('oc', '2026-08-01', '2026-08-31');
  assert.equal(els['oc-dt-ini'].value, '2026-08-01');
  assert.equal(els['oc-dt-fim'].value, '2026-08-31');
  assert.equal(els['oc-cal-label'].textContent, '01/08/2026 → 31/08/2026');

  ctx.calClearRange('oc');
  assert.equal(els['oc-dt-ini'].value, '');
  assert.equal(els['oc-dt-fim'].value, '');
  assert.equal(els['oc-cal-label'].textContent, 'Selecionar período');
});

teste('calClearRange: tira a classe "has-value" do gatilho', () => {
  const { ctx, els } = montar();
  ctx.calSetRange('oc', '2026-08-01', '2026-08-31');
  assert.equal(els['oc-cal-trigger'].classList.contains('has-value'), true);
  ctx.calClearRange('oc');
  assert.equal(els['oc-cal-trigger'].classList.contains('has-value'), false);
});

teste('calClearRange: chamado sem nenhum período definido antes, não quebra', () => {
  const { ctx, els } = montar();
  ctx.calClearRange('oc');
  assert.equal(els['oc-dt-ini'].value, '');
});

// BUG REAL (31/07, achado do usuário): "toda vez que clico em algo no
// filtro, o menu fecha sozinho". Causa: calDayClick → renderCal
// reconstrói o grid de dias (o <button> clicado é removido e um novo é
// criado no lugar); quando o clique original termina de borbulhar até o
// document, o alvo agora é um nó DESANEXADO — o listener "fechar ao
// clicar fora" (mais abaixo em calendar.js) não acha mais esse nó dentro
// de .cal-picker-wrap e fecha o dropdown a cada clique. O fix de verdade
// (stopPropagation num listener preso no próprio .cal-picker-dropdown)
// já existia, mas só pra 3 dos pickers (lista fixa de ids 'an'/'aus'/
// 'trend' — 'dg' e 'inv' já tinham esse bug antes até, e o 'oc' novo
// caiu no mesmo buraco). Trocado por querySelectorAll('.cal-picker-
// dropdown') — cobre todo mundo, atual ou futuro, sem lista pra manter.
teste('DOMContentLoaded: registra stopPropagation em TODO .cal-picker-dropdown, não só numa lista fixa de 3 ids', () => {
  const registrados = [];
  const fakeDropdowns = ['an-cal-dropdown', 'dg-cal-dropdown', 'inv-month-dropdown', 'oc-cal-dropdown'].map(id => ({
    id,
    addEventListener(evt, cb) { if (evt === 'click') registrados.push(id); },
  }));
  let dclCallback = null;
  const ctx = {
    console: { info() {}, warn() {}, error() {} },
    document: {
      addEventListener(evt, cb) { if (evt === 'DOMContentLoaded') dclCallback = cb; },
      getElementById() { return null; },
      querySelectorAll: (sel) => sel === '.cal-picker-dropdown' ? fakeDropdowns : [],
    },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fonteCalendar, ctx);

  assert.ok(dclCallback, 'deveria ter registrado um handler de DOMContentLoaded');
  dclCallback(); // simula o evento disparando
  assert.deepEqual(registrados.sort(), ['an-cal-dropdown', 'dg-cal-dropdown', 'inv-month-dropdown', 'oc-cal-dropdown']);
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
