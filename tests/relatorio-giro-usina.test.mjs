// Teste do Relatório de Fornecimento (Giro por Usina) — js/relatorio.js.
//
// Gera o HTML de ponta a ponta num sandbox (dados de giro fingidos, o cálculo
// real tem teste próprio em giro-por-central-material.test.mjs) e cobre:
//  1. o contrato de marcação de que os filtros dependem (data-central na
//     seção, data-material/data-nivel só nas linhas de material);
//  2. a LÓGICA dos filtros, rodando o <script> que o próprio relatório embute
//     contra um DOM falso montado a partir do HTML gerado;
//  3. as decisões visuais que já quebraram uma vez: kg por extenso, cabeçalho
//     da central visível na impressão, colunas centralizadas menos a 1ª.
//
// Rode com: node tests/relatorio-giro-usina.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── 1. Gera o relatório num sandbox ────────────────────────────────────────
const nivel = (level, label, pontos) => ({ level, label, pontos });
const centralFalsa = (nome) => ({
  name: nome, entradas: 1200, saidas: 800, estMedio: 250,
  giro: 3.2, cobertura: 9.375, variacao: -30, nivel: nivel('urgente', 'Urgente', 2),
  mats: [
    { name: 'AREIA MEDIA LAVADA <script>', entradas: 200, saidas: 0, estMedio: 50,
      giro: 0, cobertura: null, variacao: 20, nivel: nivel('critico', 'Crítico', 3) },
    { name: 'CIMENTO CP II', entradas: 1000, saidas: 800, estMedio: 200,
      giro: 4, cobertura: 7.5, variacao: -50, nivel: nivel('urgente', 'Urgente', 2) },
  ],
});

const erros = [];
const escritas = [];
const progresso = { textContent: '' };
let etapas = [];
let htmlGerado = null;
const ctx = {
  // console.error capturado, não silenciado: sem isso uma falha na geração
  // some e o teste quebra lá na frente com erro sem relação.
  console: { info() {}, warn() {}, error: (...a) => erros.push(a.join(' ')) },
  // O laço de meses cede a thread entre um mês e outro; sem setTimeout no
  // sandbox a geração estoura e nada é escrito na aba.
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  MESES_ABREV_DG: ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'],
  MESES_NOME_DG: ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'],
  _dgMonthState: { selectedYear: 2026, selectedMonth: 7 },
  fmtKg: (v, d = 2) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' kg',
  fmtKgShort: (v) => (v / 1000).toFixed(1) + ' K kg',
  money: (v) => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
  varSymbol: () => '<i class="ti ti-circle-arrow-up"></i>',
  toast: () => {},
  // Uma central diferente por mês — dá pra testar o filtro de central de verdade.
  buildGiroPorCentralMaterial: (dtIni) => ({ periodoEstimado: 30, centrais: [centralFalsa('CENTRAL ' + dtIni.getMonth())] }),
  // Guarda TUDO que foi escrito na aba: a 1ª escrita é a tela de progresso,
  // a última é o relatório.
  open: () => ({
    document: {
      write(h) { escritas.push(h); }, open() {}, close() {},
      getElementById: () => progresso,
    },
    focus() {}, close() {},
  }),
  showLoadingOverlay: () => {}, hideLoadingOverlay: () => {},
  loadingShowSteps: (st) => { etapas = st.map(x => x.id); }, loadingHideSteps: () => {},
  _lstepSet: () => {}, _lbarSet: () => {},
};
ctx.window = ctx;
ctx.globalThis = ctx;
ctx.document = {
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  addEventListener: () => {}, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, addEventListener() {} }),
  head: { appendChild() {} }, body: { appendChild() {} },
};
vm.createContext(ctx);
vm.runInContext(readFileSync(join(raiz, 'js', 'relatorio.js'), 'utf8'), ctx);

// Dois meses selecionados → barra de abas + filtros cobrindo os dois.
vm.runInContext("_dgmState.selecionados.add('2026-6'); _dgmState.selecionados.add('2026-7');", ctx);
await ctx.gerarRelatorioGiroUsina();
htmlGerado = escritas[escritas.length - 1];

const casos = [];
const teste = (nome, fn) => casos.push({ nome, fn });

teste('abre a aba ANTES do cálculo, com tela de progresso', () => {
  // window.open só é liberado dentro dos ~5s de ativação transitória do
  // clique, e esse relógio corre mesmo com a thread ocupada: abrir a aba no
  // fim dava "Popups bloqueados" assim que a geração passava desse orçamento.
  assert.ok(escritas.length >= 2, 'esperava a tela de progresso e depois o relatório');
  assert.ok(escritas[0].includes('Gerando relatório'), escritas[0].slice(0, 200));
  assert.ok(escritas[0].includes('id="rel-progresso"'));
  // Nenhuma dependência de rede na tela de progresso — ela tem que aparecer já.
  assert.ok(!escritas[0].includes('http'), 'tela de progresso não pode buscar nada na rede');
  // E o progresso realmente andou durante a geração.
  assert.equal(progresso.textContent, 'Montando o relatório…');
  assert.equal(etapas.join(','), 'giro-usina-2026-6,giro-usina-2026-7,giro-usina-montar');
});

teste('geração não engoliu nenhum erro', () => {
  assert.deepEqual([...erros], [], 'console.error durante a geração');
});

teste('a última escrita na aba é o relatório pronto', () => {
  assert.ok(htmlGerado && htmlGerado.length > 1000);
  assert.ok(htmlGerado.includes('Giro &amp; Cobertura por Usina') || htmlGerado.includes('Giro & Cobertura por Usina'));
  assert.ok(htmlGerado.includes('Relatório de Fornecimento'));
});

teste('uma aba por mês, a primeira já ativa', () => {
  assert.equal((htmlGerado.match(/class="rel-aba-pane/g) || []).length, 2);
  assert.equal((htmlGerado.match(/class="rel-aba-pane rel-aba-ativa/g) || []).length, 1);
  assert.ok(htmlGerado.includes('Jul/2026') && htmlGerado.includes('Ago/2026'));
  assert.ok(htmlGerado.includes('_dgrSwitchAba'));
});

teste('nome de material é escapado (não vira tag)', () => {
  assert.ok(htmlGerado.includes('&lt;script&gt;'));
  assert.ok(!htmlGerado.includes('LAVADA <script>'));
});

teste('kg por extenso, sem abreviação', () => {
  assert.ok(htmlGerado.includes('nowrap">1.000,00</span> kg'));
  assert.ok(!/[0-9] [KMG] kg/.test(htmlGerado), 'não pode sobrar "1,2 K kg"');
});

teste('sem coluna de custo de variação', () => {
  assert.ok(!htmlGerado.includes('Custo variação'));
  assert.ok(!htmlGerado.includes('class="rk-sub"'));
});

teste('colunas centralizadas, só a primeira à esquerda', () => {
  assert.ok(htmlGerado.includes('.dgm-tabela th, .dgm-tabela td { text-align:center; }'));
  assert.ok(htmlGerado.includes('.dgm-tabela th:first-child, .dgm-tabela td:first-child { text-align:left; }'));
  assert.ok(!/<t[hd] style="[^"]*text-align:right/.test(htmlGerado), 'inline text-align:right sobrando');
});

teste('cabeçalho da central sobrevive à impressão', () => {
  // O shell esconde .dgr-collapse-toggle no print; sem este override a tabela
  // sairia no papel sem dizer de que central ela é.
  assert.ok(htmlGerado.includes('.dgm-central-head { display:flex !important; }'));
});

teste('cabeçalho traz os chips no padrão da Visão Micro', () => {
  assert.ok((htmlGerado.match(/class="dgm-chip"/g) || []).length >= 5);
  assert.ok(htmlGerado.includes('Desfalque: '));
  assert.ok(htmlGerado.includes('1 crítico') && htmlGerado.includes('1 urgente') && htmlGerado.includes('0 bom'));
  assert.ok(htmlGerado.includes('data-zero="1"'), 'chip zerado precisa ficar esmaecido, não sumir');
});

teste('central é um bloco só, envolvendo os materiais dela', () => {
  // Cabeçalho colado no corpo (arredondado só nas pontas de fora) e a tabela
  // de dentro sem visual de card próprio — senão vira card dentro de card.
  assert.ok(htmlGerado.includes('border-bottom:none; border-radius:12px 12px 0 0;'));
  assert.ok(htmlGerado.includes('border-top:none; border-radius:0 0 12px 12px;'));
  assert.ok(htmlGerado.includes('.dgm-secao .dgr-table-wrap {'));
});

teste('ao recolher, só a seta gira — os ícones dos chips ficam parados', () => {
  // O shell gira qualquer <i> dentro de .dgr-collapse-toggle; como o cabeçalho
  // leva os chips dentro do botão, todos giravam junto.
  assert.ok(htmlGerado.includes('.dgm-central-head[aria-expanded="false"] i { transform:none; }'));
  assert.ok(htmlGerado.includes('.dgm-central-head[aria-expanded="false"] .dgm-chev { transform:rotate(-90deg); }'));
  // A ordem importa: o reset genérico tem que vir ANTES da regra da seta.
  assert.ok(htmlGerado.indexOf('[aria-expanded="false"] i { transform:none; }')
          < htmlGerado.indexOf('[aria-expanded="false"] .dgm-chev'));
  assert.ok(htmlGerado.includes('dgm-chev'), 'a seta precisa da classe pra ser alvo');
});

teste('as 4 colunas qualitativas saem como badge', () => {
  // Nível, Abast., Giro e Cobertura — todas no mesmo .dgm-chip. As colunas de
  // grandeza (Entradas/Saídas/Est.Médio/Variação) seguem número puro.
  const linha = htmlGerado.match(/<tr data-material="CIMENTO CP II"[\s\S]*?<\/tr>/)[0];
  assert.equal((linha.match(/class="dgm-chip"/g) || []).length, 4, linha);
  assert.equal((linha.match(/class="rk-num"/g) || []).length, 4, linha);
  // Giro e Cobertura levam a cor do próprio indicador, não a do nível.
  assert.ok(linha.includes('#10b981'), 'giro 4,00× é verde');   // _dgrGiroCor(4)
  assert.ok(linha.includes('ti-alert-triangle'), 'cobertura 7.5d é urgente');
});

teste('cobertura sem consumo vira badge neutro, sem ícone', () => {
  const linha = htmlGerado.match(/<tr data-material="AREIA[\s\S]*?<\/tr>/)[0];
  assert.match(linha, /class="dgm-chip"[^>]*#64748b[^>]*>sem consumo</);
});

teste('corpo maior que o padrão do shell, sem quebrar número', () => {
  // _dgrEstilos usa 7,5px (calibrado pras 4 tabelas por página do Gerencial);
  // aqui é uma tabela por central em paisagem, então sobra largura.
  assert.ok(htmlGerado.includes('.dgm-secao .dgm-tabela td { font-size:11px'));
  assert.ok(htmlGerado.includes('.dgm-secao .dgm-tabela th { font-size:9.5px'));
  // nowrap: senão "1.234.567,00 kg" larga o "kg" na linha de baixo.
  assert.ok(htmlGerado.includes('.dgm-secao .dgm-tabela .rk-num { white-space:nowrap; }'));
  // Larguras têm que continuar somando 100% depois de qualquer rebalanceamento.
  const larguras = [...htmlGerado.matchAll(/<th style="width:(\d+)%">/g)].map(m => Number(m[1]));
  assert.equal(larguras.length % 9, 0, 'esperava 9 colunas por tabela');
  assert.equal(larguras.slice(0, 9).reduce((a, b) => a + b, 0), 100);
});

teste('zebra do shell desligada; linhas separadas por borda', () => {
  // :nth-child alterna errado quando um filtro esconde linha, e o <tr> pintado
  // brigava de camada com o <td> destacado da central.
  assert.ok(htmlGerado.includes('.dgm-secao tbody tr:nth-child(even) { background:none; }'));
  assert.ok(htmlGerado.includes('.dgm-secao tbody td { background:none; }'));
});

teste('corpo do bloco usa o mesmo fundo do cabeçalho', () => {
  // No tema claro --dgr-card-bg é branco puro e --dgr-row-alt é cinza; com os
  // dois trocados, o bloco saía com o miolo mais escuro que a borda de cima.
  const corpo = htmlGerado.match(/\.dgm-secao \.dgr-collapse-body \{[^}]*\}/)[0];
  assert.ok(corpo.includes('background:var(--dgr-card-bg'), corpo);
});

teste('ícone de criticidade na frente do nome do material', () => {
  // Crítico = chama, Urgente = alerta — mesmo par ícone/cor da Visão Micro.
  assert.match(htmlGerado, /ti-flame dgm-nome-icone" style="color:#f43f5e"><\/i>AREIA/);
  assert.match(htmlGerado, /ti-alert-circle dgm-nome-icone" style="color:#f97316"><\/i>CIMENTO/);
});

teste('tabela só tem material — a central não vira linha', () => {
  // O retrato da central vive nos chips do cabeçalho; uma linha de total ali
  // dentro fazia a central parecer mais um item da própria lista.
  assert.ok(!htmlGerado.includes('Total da central'));
  assert.ok(!htmlGerado.includes('dgm-row-central'));
  assert.ok(!htmlGerado.includes('title="CENTRAL 6">'), 'central não pode ter célula de nome');
  assert.match(htmlGerado, /<th style="width:\d+%">Material<\/th>/);
});

teste('sem undefined/NaN vazando no corpo', () => {
  const corpo = htmlGerado.slice(htmlGerado.indexOf('<body'));
  assert.ok(!corpo.includes('undefined'));
  assert.ok(!corpo.includes('NaN'));
});

// ── 2. Contrato de marcação que os filtros consomem ────────────────────────
const secoesHtml = htmlGerado.split('<section ').slice(1).filter(b => b.includes('dgm-secao'));

teste('cada seção declara sua central; toda linha é material filtrável', () => {
  assert.equal(secoesHtml.length, 2);
  secoesHtml.forEach(b => {
    assert.match(b, /data-central="CENTRAL [67]"/);
    // 2 materiais, 2 linhas — nenhuma linha extra sem marcação de filtro
    assert.equal((b.match(/data-material="/g) || []).length, 2);
    assert.equal((b.match(/<tr /g) || []).length, 2);
  });
});

teste('filtros gerais existem com as opções dos dois meses', () => {
  assert.ok(htmlGerado.includes('id="dgm-f-central"'));
  assert.ok(htmlGerado.includes('id="dgm-f-material"'));
  assert.ok(htmlGerado.includes('id="dgm-f-nivel"'));
  assert.ok(htmlGerado.includes('<option value="CENTRAL 6">') && htmlGerado.includes('<option value="CENTRAL 7">'));
  assert.ok(htmlGerado.includes('<option value="CIMENTO CP II">'));
});

// ── 3. Lógica dos filtros, contra um DOM falso feito do HTML real ──────────
const secoes = secoesHtml.map(bloco => {
  const linhas = [...bloco.matchAll(/data-material="([^"]*)" data-nivel="([^"]*)"/g)]
    .map(([, material, nivel]) => ({ dataset: { material, nivel }, style: {} }));
  return { dataset: { central: bloco.match(/data-central="([^"]*)"/)[1] }, style: {}, querySelectorAll: () => linhas, _linhas: linhas };
});

const selects = { 'dgm-f-central': { value: '' }, 'dgm-f-material': { value: '' }, 'dgm-f-nivel': { value: '' } };
const resumo = { textContent: '' };
const ctxF = {
  document: {
    getElementById: id => (id === 'dgm-f-resumo' ? resumo : selects[id]),
    querySelectorAll: sel => (sel === '.dgm-secao' ? secoes : []),
  },
};
ctxF.window = ctxF;
vm.createContext(ctxF);
vm.runInContext(htmlGerado.match(/<script>\s*(function _dgmAplicarFiltros[\s\S]*?)<\/script>/)[1], ctxF);

const visivel = el => el.style.display !== 'none';
const aplicar = (central = '', material = '', nivelSel = '') => {
  selects['dgm-f-central'].value = central;
  selects['dgm-f-material'].value = material;
  selects['dgm-f-nivel'].value = nivelSel;
  ctxF._dgmAplicarFiltros();
};

teste('sem filtro: tudo visível, resumo vazio', () => {
  aplicar();
  assert.ok(secoes.every(visivel));
  assert.ok(secoes.every(s => s._linhas.every(visivel)));
  assert.equal(resumo.textContent, '');
});

teste('filtro de central esconde as outras seções', () => {
  aplicar('CENTRAL 6');
  secoes.forEach(s => assert.equal(visivel(s), s.dataset.central === 'CENTRAL 6', s.dataset.central));
});

teste('filtro de nível deixa só as linhas daquele nível', () => {
  aplicar('', '', 'critico');
  const vis = secoes.filter(visivel);
  assert.ok(vis.length > 0);
  vis.forEach(s => {
    const linhas = s._linhas.filter(visivel);
    assert.ok(linhas.length > 0, 'seção visível não pode ficar sem linhas');
    assert.ok(linhas.every(l => l.dataset.nivel === 'critico'));
  });
});

teste('seção sem nenhuma linha no filtro some inteira', () => {
  aplicar('', '', 'bom'); // nenhum material "bom" nos dados de teste
  assert.equal(secoes.filter(visivel).length, 0);
});

teste('central + nível se combinam com E, não OU', () => {
  aplicar('CENTRAL 6', '', 'critico');
  const vis = secoes.filter(visivel);
  assert.equal(vis.length, 1);
  assert.equal(vis[0].dataset.central, 'CENTRAL 6');
  assert.ok(vis[0]._linhas.filter(visivel).every(l => l.dataset.nivel === 'critico'));
});

teste('resumo conta centrais e materiais visíveis', () => {
  aplicar('', 'CIMENTO CP II');
  assert.equal(resumo.textContent, '2 centrais · 2 materiais');
});

teste('limpar devolve tudo', () => {
  aplicar('', '', 'critico');
  ctxF._dgmLimparFiltros();
  assert.ok(secoes.every(visivel));
  assert.ok(secoes.every(s => s._linhas.every(visivel)));
  assert.equal(resumo.textContent, '');
});

let falhou = 0;
for (const c of casos) {
  try { c.fn(); console.log(`  ok  ${c.nome}`); }
  catch (e) { falhou++; console.log(`FALHOU  ${c.nome}\n        ${e.message}`); }
}
console.log(falhou ? `\n${falhou} falha(s)` : `\n${casos.length} testes ok`);
process.exit(falhou ? 1 : 0);
