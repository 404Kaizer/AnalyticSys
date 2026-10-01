// O Relatório Gerencial não remonta o HTML à mão. Todas as abas (Evolução,
// Detalhado, Giro) são calculadas mês a mês e embarcam o CÓDIGO REAL do app
// (toString) pra filtrar/recalcular dentro do arquivo. Um símbolo que deixa
// de existir, uma arrow emitida solta ou um `const` duplicado só aparecem no
// clique do usuário final — é isso que este teste trava. (A antiga aba
// Dashboard, clonada da tela, saiu em out/2026: o conteúdo dela vive agora no
// detalhe de cada mês da Evolução.)
//
// Também fixa a ordem das abas/seções e a leitura melhora/piora.
//
// Rode com: node tests/relatorio-gerencial-clone.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const raiz  = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler   = (...p) => readFileSync(join(raiz, ...p), 'utf8');
const fonte = ler('js', 'relatorio.js');

const ctx = {
  console: { info() {}, warn() {}, error() {} },
  // Globais que relatorio.js lê de dashboard.js (mesmo escopo léxico no
  // navegador, dois <script> clássicos na mesma página).
  MESES_ABREV_DG: ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'],
  MESES_NOME_DG:  ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'],
  document: {
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getElementById() { return null; },
    createElement: () => ({ style: { cssText: '' }, replaceWith() {} }),
    addEventListener() {},
    head: { appendChild() {} }
  }
};
// escapeHtml mora em ui.js (que não roda fora do navegador); o resto vem dos
// arquivos de verdade, no MESMO contexto — é assim que o app carrega, e é o
// que faz _dgrExportaveis() resolver os identificadores soltos.
ctx.setTimeout = () => 0;   // format.js agenda um refresh de UI no topo
ctx.escapeHtml = function escapeHtml(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
};
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(ler('js', 'format.js'), ctx);
vm.runInContext(ler('js', 'dashboard.js'), ctx);
vm.runInContext(fonte, ctx);

const casos = [];
const teste = (nome, fn) => casos.push({ nome, fn });

teste('o relatório tem três abas, na ordem de leitura', () => {
  assert.equal(ctx._RELATORIO_ABAS_REGISTRY.map(a => a.id).join(','), 'evolucao,detalhado,giro');
  assert.equal(ctx._RELATORIO_ABAS_REGISTRY.map(a => a.label).join(' | '),
               'Evolução | Detalhado Analítico | Giro por Usina');
});

teste('toda aba é calculada mês a mês e tem render()', () => {
  ctx._RELATORIO_ABAS_REGISTRY.forEach(a => {
    assert.equal(a.tipo, 'gerado', 'aba não gerada: ' + a.id);
    assert.equal(typeof a.render, 'function', 'render() faltando em ' + a.id);
  });
});

teste('as tabelas do Detalhado paginam livremente', () => {
  const aba = id => ctx._RELATORIO_ABAS_REGISTRY.find(a => a.id === id);
  assert.ok(aba('detalhado').secoes.every(s => s.natural),  'tabela do Detalhado precisa ser natural');
  // cada seção do Detalhado aponta pro contêiner que as funções de render do
  // app preenchem — id errado aqui = tabela vazia no relatório, em silêncio
  assert.equal(aba('detalhado').secoes.map(s => s.alvo).join(','),
    'dg-da-material,dg-da-rank-regional,dg-da-rank-central,dg-da-rank-material,dg-da-rank-categoria');
});

teste('seleção padrão é um array ordenado (a ordem é o que vira o relatório)', () => {
  ctx._dgVgLastData = {};
  const sel = ctx._dgrSelecaoCompleta();
  assert.ok(Array.isArray(sel));
  assert.equal(sel.map(s => s.aba).join(','), 'evolucao,detalhado,giro');
  assert.equal(sel[0].secoes.join(','),
    'evo-tabela,evo-resumo,evo-saude,evo-variacao,evo-custo-abs,evo-grafico');
  assert.equal(sel[1].secoes.length, 5);
});

teste('seção sem cache de dados não entra na seleção', () => {
  ctx._dgVgLastData = null;
  assert.equal(ctx._dgrSelecaoCompleta().length, 0);
  ctx._dgVgLastData = {};
});

teste('o relatório leva o código REAL dos gráficos, não uma reescrita', () => {
  // o prelúdio serializa via toString() as funções do dashboard.js — é isso
  // que impede o gráfico do relatório de sair de sincronia com a tela.
  const fonteRel = readFileSync(join(raiz, 'js', 'relatorio.js'), 'utf8');
  for (const nome of ['_dgVgRenderChartCategoriaFisica', '_dgVgRenderChartVariacaoPorChave',
                      '_dgVgTheme', '_dgVgBarValueLabelsPlugin', '_dgVgCategoryTotalsPlugin',
                      'dgFmtPeso', 'dgFmtPesoSigned', 'varLabel', 'fmtKg', 'num']) {
    assert.ok(fonteRel.includes(nome), 'faltou ' + nome + ' no script dos gráficos');
  }
  // e cada um desses precisa existir mesmo no dashboard.js/format.js
  const fonteDash = readFileSync(join(raiz, 'js', 'dashboard.js'), 'utf8');
  const fonteFmt  = readFileSync(join(raiz, 'js', 'format.js'), 'utf8');
  for (const decl of ['function _dgVgRenderChartCategoriaFisica(', 'function _dgVgRenderChartVariacaoPorChave(',
                      'function _dgVgTheme(', 'const _dgVgBarValueLabelsPlugin', 'const _dgVgCategoryTotalsPlugin',
                      'function dgFmtPeso(', 'function dgFmtPesoSigned(', 'function varLabel(', 'function fmtKg(']) {
    assert.ok(fonteDash.includes(decl), 'dashboard.js não declara mais: ' + decl);
  }
  assert.ok(fonteFmt.includes('function num('), 'format.js não declara mais num()');
});

teste('a Geral entra na frente e só quando há mais de um mês', () => {
  const um = ctx._dgrPeriodosDoRelatorio([{ ano: 2026, mes: 6 }]);
  assert.equal(um.length, 1);
  assert.equal(um[0].geral, false);
  const tres = ctx._dgrPeriodosDoRelatorio([{ ano: 2026, mes: 6 }, { ano: 2026, mes: 7 }, { ano: 2026, mes: 8 }]);
  assert.equal(tres.map(p => p.id).join(','), 'geral,mes-2026-6,mes-2026-7,mes-2026-8');
  assert.equal(tres[0].geral, true);
  // a Geral cobre o intervalo inteiro, não só o 1º mês
  assert.equal(tres[0].dtIni.getTime(), tres[1].dtIni.getTime());
  assert.equal(tres[0].dtFim.getTime(), tres[3].dtFim.getTime());
});

teste('a leitura melhora/piora compara com o mês anterior, e a Geral fica fora', () => {
  const p = (id, score, fisica, geral) => ({ id, rotulo: id, geral, kpi: { score, varTotalFisica: fisica } });
  const linhas = ctx._dgrEvolucaoLinhas([
    p('geral', 50, -1000, true),
    p('jul', 60, -900, false),   // base
    p('ago', 70, -500, false),   // saúde sobe, |física| cai  → melhora
    p('set', 55, -800, false),   // saúde cai, |física| sobe  → piora
    p('out', 80, -1200, false)   // saúde sobe, |física| sobe → misto
  ]);
  assert.equal(linhas.length, 4, 'a Geral não é ponto da série temporal');
  assert.equal(linhas.map(l => l.veredito).join(','), ',melhora,piora,misto');
  assert.equal(linhas[0].veredito, null, 'o primeiro mês é a base, não tem com o que comparar');
});

teste('o Detalhado leva os pares e recalcula; o Giro filtra por linha', () => {
  const fonteRel = readFileSync(join(raiz, 'js', 'relatorio.js'), 'utf8');
  // o filtro do Detalhado tem que REAGREGAR (senão mostra número do período
  // inteiro com cara de recorte) — as funções do app vão junto no arquivo
  for (const nome of ['_daBuildTabelaMaterial', '_daBuildRanking', '_daRenderTabelaMaterial', '_daRenderRanking']) {
    assert.ok(fonteRel.includes(`'${nome}'`), 'Detalhado não exporta ' + nome + ' pro relatório');
  }
  // e todo símbolo exportado precisa existir de verdade no app
  const fonteDash = readFileSync(join(raiz, 'js', 'dashboard.js'), 'utf8');
  const fonteFmt  = readFileSync(join(raiz, 'js', 'format.js'), 'utf8');
  const bloco = fonteRel.slice(fonteRel.indexOf('function _dgrExportaveis()'));
  const corpo = bloco.slice(bloco.indexOf('return {') + 8, bloco.indexOf('};'));
  const lista = corpo.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
  const app = fonteDash + fonteFmt + fonteRel;
  lista.filter(n => n.startsWith('_d') || n.startsWith('DG_')).forEach(n => {
    assert.ok(new RegExp('(function|const|let) ' + n + '\\b').test(app), 'símbolo exportado não existe: ' + n);
  });
});

teste('o emissor declara arrow/expressão como const, não como statement solto', () => {
  // toString() de uma arrow é uma EXPRESSÃO: emitida crua vira statement sem
  // efeito e o símbolo nunca existe dentro do relatório (quebra só no clique).
  const original = ctx._dgrExportaveis;
  ctx._dgrExportaveis = () => ({
    arrow: v => v + 1,
    decl: function decl(v) { return v; },
    constante: 42
  });
  const saida = ctx._dgrEmitirCodigo(['arrow', 'decl', 'constante']);
  ctx._dgrExportaveis = original;
  assert.match(saida, /const arrow = /,      'arrow precisa virar const');
  assert.match(saida, /^function decl\(/m,   'declaração continua declaração (hoisting)');
  assert.match(saida, /const constante = 42;/);
  assert.throws(() => ctx._dgrEmitirCodigo(['nao-existe']), /não exportável/);
});

teste('cada símbolo sai UMA vez, no escopo global do arquivo', () => {
  // Emitir por aba duplicaria `const` no topo (SyntaxError) e prenderia o
  // símbolo no IIFE de quem emitiu — foi o bug que deixou a Evolução sem
  // _dgVgTheme. O prelúdio é a união, emitida uma vez.
  const emitido = ctx._dgrScriptPrelude(['detalheDash', 'evolucao', 'detalhado']);
  ['function num(', 'function fmtKg(', 'function _dgVgTheme(', 'function money('].forEach(dec => {
    assert.equal(emitido.split(dec).length - 1, 1, dec + ' emitido mais de uma vez');
  });
  assert.equal(emitido.split('const DG_TON_THRESHOLD_KG').length - 1, 1,
    'const duplicado no topo = SyntaxError dentro do relatório');
  assert.ok(emitido.includes('var _dgVgCharts'), '_dgVgDestroyChart precisa do registro global');
  assert.equal(ctx._dgrScriptPrelude([]), '', 'sem aba gerada, sem prelúdio');

  // e o que o prelúdio emite tem que ser JS válido de verdade — é o teste que
  // pega `const` duplicado, arrow emitida solta e escape de tag quebrado
  const corpo = emitido.slice(emitido.indexOf('>') + 1, emitido.lastIndexOf('<'));
  assert.doesNotThrow(() => new Function(corpo), 'prelúdio não compila');
});

teste('os gráficos são redesenhados ao trocar aba, tema e ao imprimir', () => {
  const fonteRel = readFileSync(join(raiz, 'js', 'relatorio.js'), 'utf8');
  // canvas em painel escondido nasce com dimensão zero; Chart.js pinta em
  // bitmap (não segue CSS); a impressão revela todos os painéis.
  assert.equal((fonteRel.match(/_dgrRedesenharEvoDetalhe/g) || []).length >= 4, true);
  assert.ok(fonteRel.includes("addEventListener('beforeprint'"));
});

let falhas = 0;
for (const { nome, fn } of casos) {
  try { fn(); console.log('  ok  ' + nome); }
  catch (err) { falhas++; console.log('FAIL  ' + nome + '\n      ' + err.message); }
}
console.log(`\n${casos.length - falhas}/${casos.length} passaram`);
process.exit(falhas ? 1 : 0);
