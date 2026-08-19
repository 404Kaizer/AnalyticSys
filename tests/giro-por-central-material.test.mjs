// Teste de buildGiroPorCentralMaterial (js/dashboard.js) — a agregação que
// alimenta o relatório "Giro por Usina": giro/cobertura/nível por material E o
// total da central, mais a Variação (conta da Visão Micro).
//
// Trava as duas coisas que dão errado em silêncio se alguém mexer:
//  1. o total da central é a soma dos materiais (e não uma média);
//  2. os DOIS buildSnapshot por material — o do giro é SEM override (senão
//     estMedio/giro/cobertura mudam e divergem do modal de Giro & Cobertura),
//     o da variação é COM override de Est. Inicial/Final.
//
// Rode com: node tests/giro-por-central-material.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const raiz  = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonte = readFileSync(join(raiz, 'js', 'dashboard.js'), 'utf8');

// Snapshots fixos por material — o que buildSnapshot (ui.js) devolveria.
const SNAPS = {
  CIMENTO: { totalEnt: 1000, totalSai: -800, pesoIni: 0, pesoFim: 400, diff: -50 },
  AREIA:   { totalEnt:  200, totalSai:    0, pesoIni: 0, pesoFim: 100, diff:  20 },
};

const chamadas = { semOverride: 0, comOverride: 0 };

const ctx = {
  console: { info() {}, warn() {}, error() {} },
  document: { getElementById() { return null; }, querySelector() { return null; }, addEventListener() {} },
  buildSnapshot({ lancs, sap, initialStockOverride }) {
    const mat = (lancs[0] || sap[0]).material;
    if (initialStockOverride === undefined || initialStockOverride === null) chamadas.semOverride++;
    else chamadas.comOverride++;
    return { ...SNAPS[mat] };
  },
  _anGetSapStock: ({ material }) => ({ value: 123, dtLabel: '31/07/2026' }),
  _anGetLastPeriodStockFallback: () => ({ missing: false, value: 456, dtLabel: '31/08/2026' }),
};
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fonte, ctx);

const results = [{
  central: 'CENTRAL A',
  allMats: ['CIMENTO', 'AREIA'],
  // 01/08 → 30/08 = 30 dias de período estimado (é o divisor da cobertura)
  lancsNoPeriodo: [
    { material: 'CIMENTO', dtLanc: '2026-08-01' },
    { material: 'AREIA',   dtLanc: '2026-08-30' },
  ],
  sapNoPeriodo: [],
  custoMedioPorMat: { CIMENTO: 2, AREIA: 1 },
}];

const casos = [];
const teste = (nome, fn) => casos.push({ nome, fn });

const dados = ctx.buildGiroPorCentralMaterial(new Date(2026, 7, 1), new Date(2026, 7, 31), results);
const central = dados.centrais[0];
const porNome = Object.fromEntries(central.mats.map(m => [m.name, m]));

teste('período estimado sai do intervalo entre o primeiro e o último lançamento', () => {
  assert.equal(dados.periodoEstimado, 30);
});

teste('material com consumo: giro = saídas ÷ est.médio, cobertura em dias', () => {
  const c = porNome.CIMENTO;
  assert.equal(c.entradas, 1000);
  assert.equal(c.saidas, 800);      // valor absoluto de totalSai
  assert.equal(c.estMedio, 200);    // (pesoIni 0 + pesoFim 400) / 2
  assert.equal(c.giro, 4);
  assert.equal(c.cobertura, 7.5);   // (200 / 800) × 30
  assert.equal(c.nivel.level, 'urgente');
});

teste('material sem saída: cobertura nula e nível crítico', () => {
  const a = porNome.AREIA;
  assert.equal(a.saidas, 0);
  assert.equal(a.cobertura, null);
  assert.equal(a.giro, 0);
  assert.equal(a.nivel.level, 'critico');
});

teste('materiais vêm do pior nível pro melhor', () => {
  assert.deepEqual(central.mats.map(m => m.name), ['AREIA', 'CIMENTO']);
});

teste('total da central é a SOMA dos materiais, com giro recalculado sobre o total', () => {
  assert.equal(central.entradas, 1200);
  assert.equal(central.saidas, 800);
  assert.equal(central.estMedio, 250);
  assert.equal(central.giro, 3.2);
  assert.equal(central.cobertura, 9.375);
  assert.equal(central.nivel.level, 'urgente');
});

teste('variação usa a conta da Visão Micro e soma na central; custo = variação × custo médio', () => {
  assert.equal(porNome.CIMENTO.variacao, -50);
  assert.equal(porNome.AREIA.variacao, 20);
  assert.equal(central.variacao, -30);
  assert.equal(porNome.CIMENTO.custoVariacao, -100); // -50 kg × R$ 2/kg
  assert.equal(central.custoVariacao, -80);          // -100 + 20
});

teste('dois snapshots por material: giro sem override, variação com override', () => {
  assert.equal(chamadas.semOverride, 2); // 1 por material — base do giro
  assert.equal(chamadas.comOverride, 2); // 1 por material — base da variação
});

let falhou = 0;
for (const c of casos) {
  try { c.fn(); console.log(`  ok  ${c.nome}`); }
  catch (e) { falhou++; console.log(`FALHOU  ${c.nome}\n        ${e.message}`); }
}
console.log(falhou ? `\n${falhou} falha(s)` : `\n${casos.length} testes ok`);
process.exit(falhou ? 1 : 0);
