// Teste de buildGiroPorCentralMaterial (js/dashboard.js) — a agregação que
// alimenta o relatório "Giro por Usina": giro/cobertura/nível por material E o
// total da central, mais a Variação (conta da Visão Micro).
//
// Trava as duas coisas que dão errado em silêncio se alguém mexer:
//  1. o total da central é a soma dos materiais (e não uma média);
//  2. o Est. Médio parte do EST. INICIAL do SAP — sem ele buildSnapshot assume
//     pesoIni = 0, o Est. Médio vira metade do estoque final, e giro/cobertura
//     saem inflados pra qualquer material que já comece o mês com estoque.
//
// Rode com: node tests/giro-por-central-material.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const raiz  = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonte = readFileSync(join(raiz, 'js', 'dashboard.js'), 'utf8');

// Movimentação de cada material no período — o que os lançamentos SAP somam.
const MOV = {
  CIMENTO: { totalEnt: 1000, totalSai: -800, diff: -50 },
  AREIA:   { totalEnt:  200, totalSai:    0, diff:  20 },
};
// Est. Inicial (saldo teórico do SAP em dtIni−1) e Est. Final (último
// lançamento do período) — as duas pontas que o Est. Médio usa.
const EST_INI = { CIMENTO: 100, AREIA: 40 };
const EST_FIM = { CIMENTO: 400, AREIA: 100 };

let nSnapshots = 0;

const ctx = {
  console: { info() {}, warn() {}, error() {} },
  document: { getElementById() { return null; }, querySelector() { return null; }, addEventListener() {} },
  // Stub fiel no que importa: honra os overrides, como o buildSnapshot real.
  // Sem isso o teste passaria mesmo se o código parasse de passar o Est.
  // Inicial — que é justamente o bug que estamos travando.
  buildSnapshot({ lancs, sap, initialStockOverride, finalStockOverride }) {
    nSnapshots++;
    const mat = (lancs[0] || sap[0]).material;
    return {
      ...MOV[mat],
      pesoIni: Number.isFinite(initialStockOverride) ? initialStockOverride : 0,
      pesoFim: Number.isFinite(finalStockOverride)   ? finalStockOverride   : 0,
    };
  },
  _anGetSapStock: ({ material }) => ({ value: EST_INI[material], dtLabel: '31/07/2026' }),
  _anGetLastPeriodStockFallback: ({ material }) => ({ missing: false, value: EST_FIM[material], dtLabel: '31/08/2026' }),
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
  assert.equal(c.estMedio, 250);    // (Est. Inicial 100 + Est. Final 400) / 2
  assert.equal(c.giro, 3.2);        // 800 / 250
  assert.equal(c.cobertura, 9.375); // (250 / 800) × 30
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
  assert.equal(central.estMedio, 320);  // 250 (cimento) + 70 (areia)
  assert.equal(central.giro, 2.5);      // 800 / 320
  assert.equal(central.cobertura, 12);  // (320 / 800) × 30
  assert.equal(central.nivel.level, 'atencao');
});

teste('variação usa a conta da Visão Micro e a da central é a soma dos materiais', () => {
  assert.equal(porNome.CIMENTO.variacao, -50);
  assert.equal(porNome.AREIA.variacao, 20);
  assert.equal(central.variacao, -30);
});

teste('um snapshot por material — giro e variação saem da mesma base', () => {
  // Com dois snapshots (um sem Est. Inicial pro giro, outro com ele pra
  // variação), o Est. Médio exibido não batia com a Variação da mesma linha.
  assert.equal(nSnapshots, 2); // 2 materiais
});

teste('sem Est. Inicial o giro sairia inflado — cenário do Hugo (ago/2026)', () => {
  // Central com 100 no início, entrou 50, saiu 100: consumiu exatamente o que
  // tinha mais o que recebeu. Est.Médio = (100 + 50) / 2 = 75 → giro 1,33×,
  // saudável. Ignorando o Est. Inicial daria Est.Médio 25 → giro 4,00×,
  // "muito alto, risco de ruptura", e o nível iria junto pro vermelho.
  MOV.BRITA     = { totalEnt: 50, totalSai: -100, diff: 0 };
  EST_INI.BRITA = 100;
  EST_FIM.BRITA = 50;

  const d = ctx.buildGiroPorCentralMaterial(new Date(2026, 7, 1), new Date(2026, 7, 31), [{
    central: 'CENTRAL B',
    allMats: ['BRITA'],
    lancsNoPeriodo: [{ material: 'BRITA', dtLanc: '2026-08-01' }, { material: 'BRITA', dtLanc: '2026-08-30' }],
    sapNoPeriodo: [],
    custoMedioPorMat: {},
  }]);

  const brita = d.centrais[0].mats[0];
  assert.equal(brita.estMedio, 75);
  assert.equal(Number(brita.giro.toFixed(2)), 1.33);   // era 4,00× ignorando o inicial
  assert.equal(Number(brita.cobertura.toFixed(1)), 22.5); // era 7,5d
});

teste('com abastecimento em dia, o nível deixa de ser vermelho', () => {
  // Complemento do caso acima: lá o nível continua crítico, mas por OUTRO
  // eixo — repor 50 pra consumir 100 é 50% de abastecimento, e com giro ≥ 1
  // isso é risco de ruptura de verdade. Aqui a reposição cobre o consumo, e
  // aí sim o material sai da faixa vermelha — prova de que o eixo do giro
  // parou de puxar o diagnóstico sozinho.
  MOV.BRITA2     = { totalEnt: 100, totalSai: -100, diff: 0 };
  EST_INI.BRITA2 = 100;
  EST_FIM.BRITA2 = 100;

  const d = ctx.buildGiroPorCentralMaterial(new Date(2026, 7, 1), new Date(2026, 7, 31), [{
    central: 'CENTRAL C',
    allMats: ['BRITA2'],
    lancsNoPeriodo: [{ material: 'BRITA2', dtLanc: '2026-08-01' }, { material: 'BRITA2', dtLanc: '2026-08-30' }],
    sapNoPeriodo: [],
    custoMedioPorMat: {},
  }]);

  const b2 = d.centrais[0].mats[0];
  assert.equal(b2.estMedio, 100);
  assert.equal(b2.giro, 1);
  assert.equal(b2.cobertura, 30);
  assert.equal(b2.nivel.level, 'atencao');
});

let falhou = 0;
for (const c of casos) {
  try { c.fn(); console.log(`  ok  ${c.nome}`); }
  catch (e) { falhou++; console.log(`FALHOU  ${c.nome}\n        ${e.message}`); }
}
console.log(falhou ? `\n${falhou} falha(s)` : `\n${casos.length} testes ok`);
process.exit(falhou ? 1 : 0);
