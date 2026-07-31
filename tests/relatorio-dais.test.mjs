// Teste do novo botão "Relatório de DAIs" (31/07, pedido do usuário) —
// gerarRelatorioDAIs() em relatorio.js, mesmo shell dos demais relatórios
// gerenciais (_buildRankingShellHTML). Cobre os cálculos que alimentam o
// dashboard gerencial (KPIs SMART): pendente/concluída por item, tempo
// médio de geração→conclusão, e a tabela completa de DAIs.
//
// Rode com: node tests/relatorio-dais.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonteRelatorio = readFileSync(join(raiz, 'js', 'relatorio.js'), 'utf8');

function montar() {
  const chamadas = { alerts: [], htmlGerado: null };
  const ctx = {
    console: { info() {}, warn() {}, error() {} },
    state: { ajustesSistemicos: [], ocorrencias: [], filiais: [] },
    document: {
      addEventListener() {},
      getElementById() { return null; },
    },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.alert = (msg) => { chamadas.alerts.push(msg); };
  ctx.open = () => ({
    document: { write(html) { chamadas.htmlGerado = html; }, close() {} },
    focus() {},
  });
  vm.createContext(ctx);
  vm.runInContext(fonteRelatorio, ctx);
  return { ctx, chamadas };
}

const casos = [];
const teste = (nome, fn) => casos.push({ nome, fn });

const itemPendente  = { material: 'CIMENTO', sapDocumento: 'PENDENTE' };
const itemConcluido = { material: 'CIMENTO', sapDocumento: '45435' };

teste('lista vazia: mostra alerta e não abre janela nenhuma', () => {
  const { ctx, chamadas } = montar();
  ctx.gerarRelatorioDAIs();
  assert.equal(chamadas.alerts.length, 1);
  assert.equal(chamadas.htmlGerado, null);
});

teste('conta corretamente pendentes (item sem SAP) vs concluídas (todos os itens com SAP)', () => {
  const { ctx, chamadas } = montar();
  ctx.state.ajustesSistemicos = [
    { id: 'dai_1', tag: 'DAI-1', numero: 'N1', central: 'ABA1', analista: 'Fulano', material: 'CIMENTO', dataGeracao: Date.now(), itens: [itemPendente] },
    { id: 'dai_2', tag: 'DAI-2', numero: 'N2', central: 'ABA1', analista: 'Fulano', material: 'CIMENTO', dataGeracao: Date.now(), itens: [itemConcluido] },
  ];
  ctx.gerarRelatorioDAIs();
  const html = chamadas.htmlGerado;
  assert.ok(html, 'deveria ter gerado o HTML do relatório');
  // rk-kpi: total=2, concluídas=1, pendentes=1
  assert.match(html, /<strong>2<\/strong>\s*<span>DAIs criadas<\/span>/);
  assert.match(html, /<strong>1<\/strong>\s*<span>concluídas<\/span>/);
  assert.match(html, /<strong>1<\/strong>\s*<span>pendentes \(SAP\)<\/span>/);
});

teste('tempo médio: dias entre dataGeracao e a MAIOR dataConclusao das ocorrências vinculadas', () => {
  const { ctx, chamadas } = montar();
  const geracao = new Date('2026-07-01T12:00:00').getTime();
  ctx.state.ajustesSistemicos = [
    { id: 'dai_1', tag: 'DAI-1', numero: 'N1', central: 'ABA1', analista: 'Fulano', material: 'CIMENTO', dataGeracao: geracao, itens: [itemConcluido] },
  ];
  ctx.state.ocorrencias = [
    { id: 'oc_1', daiId: 'dai_1', concluida: true, dataConclusao: '2026-07-05' },
    { id: 'oc_2', daiId: 'dai_1', concluida: true, dataConclusao: '2026-07-03' }, // não é a mais recente
  ];
  ctx.gerarRelatorioDAIs();
  const html = chamadas.htmlGerado;
  assert.match(html, /Tempo médio de conclusão[\s\S]*?<div class="oc-highlight-value">4\.0<small>dias<\/small><\/div>/);
});

teste('DAI concluída sem ocorrência com dataConclusao não entra na média (fica de fora, não quebra)', () => {
  const { ctx, chamadas } = montar();
  ctx.state.ajustesSistemicos = [
    { id: 'dai_1', tag: 'DAI-1', numero: 'N1', central: 'ABA1', analista: 'Fulano', material: 'CIMENTO', dataGeracao: Date.now(), itens: [itemConcluido] },
  ];
  ctx.state.ocorrencias = []; // nenhuma ocorrência vinculada sincronizada ainda
  ctx.gerarRelatorioDAIs();
  const html = chamadas.htmlGerado;
  assert.ok(!html.includes('Tempo médio de conclusão'), 'sem nenhuma DAI com tempo calculável, o bloco de destaque não aparece');
});

teste('tabela "Todas as DAIs" traz tag, central, analista e o badge de status certo', () => {
  const { ctx, chamadas } = montar();
  ctx.state.ajustesSistemicos = [
    { id: 'dai_1', tag: 'DAI-9', numero: 'N9', central: 'CAX', regionalCentral: 'Rio', analista: 'Hugo Rios', material: 'CIMENTO PLUS', dataGeracao: Date.now(), itens: [itemPendente] },
  ];
  ctx.gerarRelatorioDAIs();
  const html = chamadas.htmlGerado;
  assert.ok(html.includes('DAI-9'));
  assert.ok(html.includes('CAX'));
  assert.ok(html.includes('Rio'));
  assert.ok(html.includes('Hugo Rios'));
  assert.ok(html.includes('CIMENTO PLUS'));
  assert.ok(html.includes('>Pendente<'));
});

teste('regional cai em "Sem Regional" quando a DAI não tem regionalCentral nem a central está cadastrada', () => {
  const { ctx, chamadas } = montar();
  ctx.state.ajustesSistemicos = [
    { id: 'dai_1', tag: 'DAI-1', numero: 'N1', central: 'CENTRAL-DESCONHECIDA', analista: 'Fulano', material: 'CIMENTO', dataGeracao: Date.now(), itens: [itemConcluido] },
  ];
  ctx.gerarRelatorioDAIs();
  assert.ok(chamadas.htmlGerado.includes('Sem Regional'));
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
