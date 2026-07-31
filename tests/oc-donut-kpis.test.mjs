// Teste do donut "Status das ocorrências" reduzido a 3 categorias + a
// sublegenda nova (31/07, pedido do usuário): o gráfico/legenda principal
// passa a mostrar só Em aberto/Concluída/Inconclusiva (vencida/urgente
// somam dentro de "Em aberto", mas continuam existindo como dado em
// outros lugares da tela). Abaixo, uma sublegenda de texto com
// escalonamento por nível (só ocorrências ainda ABERTAS), atraso na
// conclusão e total de DAIs geradas (documentos únicos, não ocorrências).
//
// Rode com: node tests/oc-donut-kpis.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonteOcorrencias = readFileSync(join(raiz, 'js', 'ocorrencias.js'), 'utf8');

function montar() {
  const ctx = {
    console: { info() {}, warn() {}, error() {} },
    state: { ocorrencias: [], filiais: [] },
    document: {
      addEventListener() {},
      getElementById() { return null; },
    },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.currentUser = { id: 'u-1', role: 'user' };
  ctx._integracoesDoAdmin = async () => new Set();
  vm.createContext(ctx);
  vm.runInContext(fonteOcorrencias, ctx);
  return ctx;
}

const casos = [];
const teste = (nome, fn) => casos.push({ nome, fn });

// ── buildOcKPIs: escalonadas/concluidasAtraso/daisCriadas ──────────────

teste('escalonadas: só conta ocorrência ABERTA (não concluída/inconclusiva) no nível atual', () => {
  const ctx = montar();
  const lista = [
    { id: 'a', hierarquia: [{ nivel: 1 }], concluida: false, inconclusiva: false },
    { id: 'b', hierarquia: [{ nivel: 2 }], concluida: false, inconclusiva: false },
    { id: 'c', hierarquia: [{ nivel: 3 }], concluida: false, inconclusiva: false },
    { id: 'd', hierarquia: [{ nivel: 2 }], concluida: true,  inconclusiva: false }, // concluída — não conta
    { id: 'e', hierarquia: [{ nivel: 2 }], concluida: false, inconclusiva: true },  // inconclusiva — não conta
  ];
  const kpis = ctx.buildOcKPIs(lista);
  // JSON round-trip: o objeto foi criado DENTRO do vm (outro realm) —
  // deepEqual cru reclama de "mesma estrutura mas não é a mesma referência
  // de Object" (mesmo padrão já usado em ocorrencias-supervisor.test.mjs).
  assert.deepEqual(JSON.parse(JSON.stringify(kpis.escalonadas)), { regional: 1, supervisor: 1, gerencia: 1 });
});

teste('concluidasAtraso: só quando dataConclusao é depois de dataLimite', () => {
  const ctx = montar();
  const lista = [
    { id: 'a', concluida: true, dataLimite: '2026-07-01', dataConclusao: '2026-07-05' }, // atraso
    { id: 'b', concluida: true, dataLimite: '2026-07-10', dataConclusao: '2026-07-08' }, // no prazo
    { id: 'c', concluida: true, dataLimite: '2026-07-01', dataConclusao: '2026-07-01' }, // no dia — não é atraso
    { id: 'd', concluida: false, dataLimite: '2026-07-01', dataConclusao: null },
  ];
  const kpis = ctx.buildOcKPIs(lista);
  assert.equal(kpis.concluidasAtraso, 1);
});

teste('daisCriadas: conta daiId ÚNICOS, não ocorrências (1 DAI pode gerar várias)', () => {
  const ctx = montar();
  const lista = [
    { id: 'a', origemAjusteSistemico: true, daiId: 'dai_1' },
    { id: 'b', origemAjusteSistemico: true, daiId: 'dai_1' }, // mesmo DAI, item diferente
    { id: 'c', origemAjusteSistemico: true, daiId: 'dai_2' },
    { id: 'd', origemAjusteSistemico: false, daiId: null },
  ];
  const kpis = ctx.buildOcKPIs(lista);
  assert.equal(kpis.daisCriadas, 2);
});

// ── _buildOcDonut: só 3 categorias no gráfico/legenda principal ────────

teste('_buildOcDonut: mostra só Em aberto/Inconclusiva/Concluída — sem Vencida/Urgente separadas', () => {
  const ctx = montar();
  const lista = [
    { id: 'a', concluida: false, inconclusiva: false, dataLimite: '2020-01-01' }, // vencida
    { id: 'b', concluida: false, inconclusiva: false, dataLimite: null },         // normal
    { id: 'c', concluida: true,  inconclusiva: false },
    { id: 'd', concluida: false, inconclusiva: true },
  ];
  const kpis = ctx.buildOcKPIs(lista);
  const html = ctx._buildOcDonut(kpis);
  assert.ok(html.includes('Em aberto'));
  assert.ok(html.includes('Concluída'));
  assert.ok(html.includes('Inconclusiva'));
  assert.ok(!html.includes('data-label="Vencida"'));
  assert.ok(!html.includes('data-label="Urgente"'));
  // "Em aberto" soma vencida+urgente+normal — as 2 abertas da lista (a, b)
  assert.ok(html.includes('data-count="2"'));
});

teste('_buildOcDonut: inclui a sublegenda (escalonadas/atraso/DAIs) abaixo da legenda', () => {
  const ctx = montar();
  const lista = [
    { id: 'a', concluida: false, inconclusiva: false, hierarquia: [{ nivel: 2 }] },
    { id: 'b', concluida: true, dataLimite: '2026-01-01', dataConclusao: '2026-01-10', origemAjusteSistemico: true, daiId: 'dai_1' },
  ];
  const kpis = ctx.buildOcKPIs(lista);
  const html = ctx._buildOcDonut(kpis);
  assert.ok(html.includes('Escalonadas ao Supervisor do Setor'));
  assert.ok(html.includes('Concluídas em atraso'));
  assert.ok(html.includes('DAIs criadas'));
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
