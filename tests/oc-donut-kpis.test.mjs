// Teste do donut "Status das ocorrências" (31/07, pedido do usuário):
// gráfico/legenda principal com 4 categorias — Em aberto/Inconclusiva/
// Concluída/DAI (vencida/urgente somam dentro de "Em aberto", mas
// continuam existindo como dado em outros lugares da tela). DAI é
// categoria PRÓPRIA e EXCLUSIVA das outras 3 — uma ocorrência de DAI
// concluída conta em "DAI", não em "Concluída" (mesmo critério do badge
// dourado "Ajuste Sistêmico" que o card já usa, ver ocStatusLabel).
// Abaixo do donut, uma sublegenda de texto com escalonamento por nível
// (só ocorrências ainda ABERTAS) e atraso na conclusão — DAI NÃO entra
// mais aqui, virou fatia do gráfico.
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

// ── buildOcKPIs: escalonadas/concluidasAtraso/daiOcorrencias ───────────

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

teste('daiOcorrencias: conta OCORRÊNCIAS de DAI (não documentos únicos) — 1 DAI pode gerar várias', () => {
  const ctx = montar();
  const lista = [
    { id: 'a', origemAjusteSistemico: true, daiId: 'dai_1' },
    { id: 'b', origemAjusteSistemico: true, daiId: 'dai_1' }, // mesmo DAI, item diferente — conta as 2
    { id: 'c', origemAjusteSistemico: true, daiId: 'dai_2' },
    { id: 'd', origemAjusteSistemico: false, daiId: null },
  ];
  const kpis = ctx.buildOcKPIs(lista);
  assert.equal(kpis.daiOcorrencias, 3);
});

teste('DAI é exclusiva das outras 3 categorias: concluída/inconclusiva/aberta NUNCA contam uma ocorrência de DAI', () => {
  const ctx = montar();
  const lista = [
    { id: 'a', origemAjusteSistemico: true, concluida: true },  // DAI concluída — não é "Concluída"
    { id: 'b', origemAjusteSistemico: true, concluida: false, inconclusiva: false }, // DAI pendente — não é "Em aberto"
    { id: 'c', origemAjusteSistemico: false, concluida: true },
  ];
  const kpis = ctx.buildOcKPIs(lista);
  assert.equal(kpis.daiOcorrencias, 2);
  assert.equal(kpis.concluidas, 1); // só a "c", não a "a"
  assert.equal(kpis.abertas, 0);    // "b" não conta como aberta, virou DAI
  assert.equal(kpis.total, 3);      // total continua contando todo mundo
});

// BUG REAL (31/07): renderOcorrencias mandava listaOperacional (DAI já
// excluída ANTES de chegar em buildOcKPIs) pro donut — a fatia "DAI" (e a
// extinta sublegenda "DAIs criadas") nunca tinham o que contar, mesmo com
// DAIs de verdade na tela (usuário reportou "21 DAIs na tela, não estão
// sendo contabilizadas"). Corrigido passando o `lista` cheio pra
// buildOcKPIs, que agora decide a exclusão de DAI internamente, métrica
// por métrica: total/donut contam TUDO, tempo médio/ranking (que não
// fazem sentido pra um registro sem prazo real) excluem DAI só ali dentro.
teste('buildOcKPIs: total/daiOcorrencias contam DAI mesmo que o CALLER não tenha pré-filtrado nada (lista cheia)', () => {
  const ctx = montar();
  const lista = [
    { id: 'a', origemAjusteSistemico: true, central: 'ABA1', concluida: true, dataAbertura: '2026-07-01', dataConclusao: '2026-07-01' },
    { id: 'b', concluida: false, inconclusiva: false, central: 'ABA2' },
  ];
  const kpis = ctx.buildOcKPIs(lista);
  assert.equal(kpis.total, 2);
  assert.equal(kpis.daiOcorrencias, 1);
});

teste('buildOcKPIs: tempo médio/ranking de central continuam SEM DAI (nasce já concluído no mesmo dia, sem prazo real)', () => {
  const ctx = montar();
  const lista = [
    // DAI: "concluída" no mesmo dia do prazo — se entrasse no tempo médio, puxaria a média pra baixo artificialmente
    { id: 'a', origemAjusteSistemico: true, central: 'DAI-CENTRAL', concluida: true, dataLimite: '2026-07-01', dataConclusao: '2026-07-01' },
    { id: 'b', concluida: true, central: 'ABA2', dataLimite: '2026-07-01', dataConclusao: '2026-07-11' }, // 10 dias
  ];
  const kpis = ctx.buildOcKPIs(lista);
  assert.equal(kpis.tempoMedioMin, 10); // só a "b" — se a DAI entrasse, seria (0+10)/2=5
  assert.ok(!kpis.topCentrals.some(([central]) => central === 'DAI-CENTRAL'));
});

// ── _buildOcDonut: 4 categorias no gráfico/legenda principal ───────────

teste('_buildOcDonut: mostra Em aberto/Inconclusiva/Concluída — sem Vencida/Urgente separadas', () => {
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
  // sem nenhuma ocorrência de DAI na lista, a fatia "DAI" nem aparece
  assert.ok(!html.includes('data-label="DAI"'));
});

teste('_buildOcDonut: com ocorrência de DAI, mostra a fatia "DAI" em amarelo (#eab308)', () => {
  const ctx = montar();
  const lista = [
    { id: 'a', origemAjusteSistemico: true, concluida: true },
    { id: 'b', concluida: false, inconclusiva: false, dataLimite: null },
  ];
  const kpis = ctx.buildOcKPIs(lista);
  const html = ctx._buildOcDonut(kpis);
  assert.ok(html.includes('data-label="DAI"'));
  assert.ok(html.includes('data-count="1"'));
  assert.ok(html.includes('#eab308'));
});

function amanha(dias) {
  const d = new Date(); d.setDate(d.getDate() + dias);
  return d.toISOString().split('T')[0];
}

teste('vencidas (sublegenda "Vencidas em aberto"): só ocorrência ABERTA com prazo no passado', () => {
  const ctx = montar();
  const lista = [
    { id: 'a', concluida: false, inconclusiva: false, dataLimite: amanha(-3) }, // vencida em aberto
    { id: 'b', concluida: true,  inconclusiva: false, dataLimite: amanha(-3) }, // vencida mas já concluída — não conta
    { id: 'c', concluida: false, inconclusiva: false, dataLimite: amanha(5) },  // no prazo
    { id: 'd', origemAjusteSistemico: true, concluida: false, dataLimite: null }, // DAI nunca tem dataLimite
  ];
  const kpis = ctx.buildOcKPIs(lista);
  assert.equal(kpis.vencidas, 1);
});

teste('_buildOcDonut: sublegenda mostra "Vencidas em aberto"', () => {
  const ctx = montar();
  const lista = [
    { id: 'a', concluida: false, inconclusiva: false, dataLimite: amanha(-3) },
  ];
  const kpis = ctx.buildOcKPIs(lista);
  const html = ctx._buildOcDonut(kpis);
  assert.match(html, /Vencidas em aberto[\s\S]*?>1</);
});

teste('_buildOcDonut: sublegenda mostra escalonadas/atraso mas NÃO mostra mais "DAIs criadas"', () => {
  const ctx = montar();
  const lista = [
    { id: 'a', concluida: false, inconclusiva: false, hierarquia: [{ nivel: 2 }] },
    { id: 'b', concluida: true, dataLimite: '2026-01-01', dataConclusao: '2026-01-10' },
    { id: 'c', origemAjusteSistemico: true, daiId: 'dai_1' },
  ];
  const kpis = ctx.buildOcKPIs(lista);
  const html = ctx._buildOcDonut(kpis);
  assert.ok(html.includes('Escalonadas ao Supervisor do Setor'));
  assert.ok(html.includes('Concluídas em atraso'));
  assert.ok(!html.includes('DAIs criadas'));
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
