// O Relatório Gerencial não remonta mais o HTML à mão: clona as seções vivas
// do Dashboard Gerencial marcadas com data-rel-secao no index.html
// (_dgrClonarSecaoDom em js/relatorio.js). O que quebra em silêncio é o
// contrato entre os dois arquivos — renomear/mover uma seção no index.html
// deixa o relatório com um bloco "Seção indisponível" e ninguém percebe até
// gerar. Este teste trava esse contrato + a ordem das abas/seções.
//
// Rode com: node tests/relatorio-gerencial-clone.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const raiz  = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonte = readFileSync(join(raiz, 'js', 'relatorio.js'), 'utf8');
const html  = readFileSync(join(raiz, 'index.html'), 'utf8');

// DOM mínimo: só o que _dgrClonarSecaoDom encosta.
const noFalso = (innerHTML, canvases = []) => ({
  innerHTML,
  querySelectorAll: sel => (sel === 'canvas' ? canvases : []),
  cloneNode: () => noFalso(innerHTML, canvases)
});

const ctx = {
  console: { info() {}, warn() {}, error() {} },
  document: {
    _secoes: {},
    querySelector(sel) {
      const m = /^\[data-rel-secao="(.+)"\]$/.exec(sel);
      return m ? (this._secoes[m[1]] || null) : null;
    },
    querySelectorAll() { return []; },
    getElementById() { return null; },
    createElement: () => ({ style: { cssText: '' }, replaceWith() {} }),
    addEventListener() {},
    head: { appendChild() {} }
  }
};
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fonte, ctx);

const casos = [];
const teste = (nome, fn) => casos.push({ nome, fn });

teste('o relatório tem duas abas: Dashboard e Detalhado Analítico', () => {
  assert.equal(ctx._RELATORIO_ABAS_REGISTRY.map(a => a.id).join(','), 'dashboard,detalhado');
  assert.equal(ctx._RELATORIO_ABAS_REGISTRY.map(a => a.label).join(' | '), 'Dashboard | Detalhado Analítico');
});

teste('cada seção do registro está marcada com data-rel-secao no index.html', () => {
  const marcados  = [...html.matchAll(/data-rel-secao="([^"]+)"/g)].map(m => m[1]);
  const registro  = ctx._RELATORIO_ABAS_REGISTRY.flatMap(a => a.secoes.map(s => s.id));
  const faltando  = registro.filter(id => !marcados.includes(id));
  const orfaos    = marcados.filter(id => !registro.includes(id));
  assert.equal(faltando.join(','), '', 'seções do registro sem marcação no index.html: ' + faltando);
  assert.equal(orfaos.join(','), '',   'marcações no index.html fora do registro: ' + orfaos);
  // e cada marcação aparece UMA vez só (querySelector pega a primeira)
  assert.equal(new Set(marcados).size, marcados.length, 'data-rel-secao duplicado');
});

teste('as tabelas do Detalhado paginam livremente; o Dashboard, uma por página', () => {
  const [dash, det] = ctx._RELATORIO_ABAS_REGISTRY;
  assert.ok(dash.secoes.every(s => !s.natural), 'seção do Dashboard não deveria ser natural');
  assert.ok(det.secoes.every(s => s.natural),   'tabela do Detalhado precisa ser natural');
});

teste('seleção padrão é um array ordenado (a ordem é o que vira o relatório)', () => {
  ctx._dgVgLastData = {};
  const sel = ctx._dgrSelecaoCompleta();
  assert.ok(Array.isArray(sel));
  assert.equal(sel.map(s => s.aba).join(','), 'dashboard,detalhado');
  assert.equal(sel[0].secoes[0], 'resumo-periodo');
  assert.equal(sel[1].secoes.length, 5);
});

teste('seção sem cache de dados não entra na seleção', () => {
  ctx._dgVgLastData = null;
  assert.equal(ctx._dgrSelecaoCompleta().length, 0);
  ctx._dgVgLastData = {};
});

teste('clonar traz o HTML vivo da seção', () => {
  ctx.document._secoes['resumo-periodo'] = noFalso('<div class="kpi">42</div>');
  assert.equal(ctx._dgrClonarSecaoDom('resumo-periodo'), '<div class="kpi">42</div>');
});

teste('seção ausente na tela vira aviso, não quebra o relatório', () => {
  const out = ctx._dgrClonarSecaoDom('secao-que-nao-existe');
  assert.match(out, /indispon/i);
});

let falhas = 0;
for (const { nome, fn } of casos) {
  try { fn(); console.log('  ok  ' + nome); }
  catch (err) { falhas++; console.log('FAIL  ' + nome + '\n      ' + err.message); }
}
console.log(`\n${casos.length - falhas}/${casos.length} passaram`);
process.exit(falhas ? 1 : 0);
