// Teste do menu "···" dos cards (31/07, pedido do usuário): com o
// crescimento de ações (DAI já tinha 7 botões), o rodapé cortava botão.
// Regra combinada: fica visível só a ação principal do fluxo (Editar Nº
// SAP/Preencher Nº SAP na DAI; Concluir/Reabrir/Reabrir concluída na
// comum) + Editar/Gerar Termo + Excluir; o resto (Atribuir, Reimprimir,
// Baixar ZIP, Anexar, Inconclusiva, Escalonar) entra no menu único
// compartilhado (#oc-card-menu), populado a cada abertura.
//
// Rode com: node tests/oc-card-menu.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonteOcorrencias = readFileSync(join(raiz, 'js', 'ocorrencias.js'), 'utf8');

function montar({ role = 'user' } = {}) {
  const menuEl = { innerHTML: '', style: {}, dataset: {}, classList: { _open: false, add(c) { if (c === 'open') this._open = true; }, remove(c) { if (c === 'open') this._open = false; }, contains(c) { return c === 'open' && this._open; } } };
  const ctx = {
    console: { info() {}, warn() {}, error() {} },
    state: { ocorrencias: [] },
    window: { innerWidth: 1200 },
    document: {
      addEventListener() {},
      getElementById: (id) => id === 'oc-card-menu' ? menuEl : null,
    },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.currentUser = { id: 'u-1', role };
  vm.createContext(ctx);
  vm.runInContext(fonteOcorrencias, ctx);
  return { ctx, menuEl };
}

function fakeEvent() {
  return { stopPropagation() {}, currentTarget: { getBoundingClientRect: () => ({ bottom: 100, right: 200 }) } };
}

const casos = [];
const teste = (nome, fn) => casos.push({ nome, fn });

teste('ocorrência comum, usuário sem admin: menu tem só Inconclusiva/Escalonar (sem Atribuir)', () => {
  const { ctx, menuEl } = montar({ role: 'user' });
  ctx.state.ocorrencias = [{ id: 'oc_1', concluida: false, inconclusiva: false, hierarquia: [] }];
  ctx._ocAbrirMenuCard(fakeEvent(), 'oc_1');
  assert.ok(menuEl.innerHTML.includes('Marcar como inconclusiva'));
  assert.ok(menuEl.innerHTML.includes('Escalonar'));
  assert.ok(!menuEl.innerHTML.includes('Atribuir'));
});

teste('ocorrência comum, ADM: menu ganha "Atribuir a outro usuário" também', () => {
  const { ctx, menuEl } = montar({ role: 'admin' });
  ctx.state.ocorrencias = [{ id: 'oc_1', concluida: false, inconclusiva: false, hierarquia: [] }];
  ctx._ocAbrirMenuCard(fakeEvent(), 'oc_1');
  assert.ok(menuEl.innerHTML.includes('Atribuir a outro usuário'));
});

teste('ocorrência concluída: sem "Marcar como inconclusiva" nem "Escalonar" no menu (nenhuma ação extra além de Atribuir)', () => {
  const { ctx, menuEl } = montar({ role: 'admin' });
  ctx.state.ocorrencias = [{ id: 'oc_1', concluida: true, inconclusiva: false, hierarquia: [] }];
  ctx._ocAbrirMenuCard(fakeEvent(), 'oc_1');
  assert.ok(!menuEl.innerHTML.includes('inconclusiva'));
  assert.ok(!menuEl.innerHTML.includes('Escalonar'));
});

teste('DAI: menu tem Reimprimir/Baixar ZIP/Anexar — NÃO tem Inconclusiva/Escalonar (não fazem sentido pra DAI)', () => {
  const { ctx, menuEl } = montar({ role: 'user' });
  ctx.state.ocorrencias = [{ id: 'oc_1', origemAjusteSistemico: true, daiId: 'dai_1', concluida: false }];
  ctx._ocAbrirMenuCard(fakeEvent(), 'oc_1');
  assert.ok(menuEl.innerHTML.includes('Reimprimir Documento'));
  assert.ok(menuEl.innerHTML.includes('Baixar ZIP'));
  assert.ok(menuEl.innerHTML.includes('Anexar Arquivo'));
  assert.ok(!menuEl.innerHTML.includes('inconclusiva'));
  assert.ok(!menuEl.innerHTML.includes('Escalonar'));
});

teste('clicar de novo no mesmo gatilho fecha o menu (toggle), não reabre igual', () => {
  const { ctx, menuEl } = montar({ role: 'user' });
  ctx.state.ocorrencias = [{ id: 'oc_1', concluida: false, inconclusiva: false, hierarquia: [] }];
  ctx._ocAbrirMenuCard(fakeEvent(), 'oc_1');
  assert.equal(menuEl.classList.contains('open'), true);
  ctx._ocAbrirMenuCard(fakeEvent(), 'oc_1');
  assert.equal(menuEl.classList.contains('open'), false);
});

teste('_ocFecharMenuCard: fecha sem quebrar mesmo se já estiver fechado', () => {
  const { ctx, menuEl } = montar();
  ctx._ocFecharMenuCard();
  assert.equal(menuEl.classList.contains('open'), false);
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
