function buildDashboardGerencialResults(dtIni, dtFim) {
  // Se dtIni/dtFim fornecidos, filtra por período; caso contrário usa todos os dados
  function inPeriod(dateStr) {
    if (!dtIni || !dtFim) return true;
    const d = parseDate(dateStr);
    if (!d) return false;
    return d >= dtIni && d <= dtFim;
  }

  const _dgLancIdx = getLancIndex();
  const _dgSapIdx  = getSapIndex();
  ensureSaidasIndex();
  const allCentrals = new Set([
    ..._dgLancIdx.byCentral.keys(),
    ..._dgSapIdx.byCentral.keys()
  ]);

  const results = [];

  allCentrals.forEach(central => {
    const lancsNoPeriodoRaw = (dtIni && dtFim)
      ? getLancsByCentralInPeriod(central, dtIni, dtFim).slice().sort((a, b) => {
          const da = parseDate(a.dtLanc), db = parseDate(b.dtLanc);
          return dateCmp(da ?? new Date(0), db ?? new Date(0));
        })
      : (_dgLancIdx.byCentral.get(central) || []).slice();

    const sapNoPeriodoRaw = (dtIni && dtFim)
      ? getSapByCentralInPeriod(central, dtIni, dtFim)
      : (_dgSapIdx.byCentral.get(central) || []);

    // ── Filtragem na origem: materiais sem cadastro (ou cadastrados sem
    //    categoria) são separados AQUI, antes de qualquer agregação por
    //    material. Busca SEMPRE via materialOriginal — nunca via .material
    //    (nome já resolvido, que pode coincidir por acaso com o alias/
    //    origem de outro cadastro não relacionado). Mesmo padrão de
    //    analitico.js — decisão confirmada: exclusão total até serem
    //    cadastrados, sem contar em nenhuma soma/gráfico/indicador.
    const materialCatKeyMap = new Map();
    const materialCatSubKeyMap = new Map();
    const matsSemCadastroSet = new Set();
    const lancsNoPeriodo = lancsNoPeriodoRaw.filter(r => {
      const catKey = getCatKeyDoCadastro(r.materialOriginal);
      if (!catKey) { matsSemCadastroSet.add(r.materialOriginal || '—'); return false; }
      materialCatKeyMap.set(r.material || '—', catKey);
      materialCatSubKeyMap.set(r.material || '—', getCatSubKeyDoCadastro(r.materialOriginal));
      return true;
    });
    // Ajustes de Fechamento Mensal (Y11/Y12) — desconsiderados do cálculo,
    // coletados (globalmente e por material) para o badge/modal de
    // "Ajustes desconsiderados" na Visão Geral do Dashboard Gerencial.
    const sapFechExcluidos = [];
    const sapFechExcluidosByMat = new Map();
    const sapNoPeriodo = sapNoPeriodoRaw.filter(r => {
      const catKey = getCatKeyDoCadastro(r.materialOriginal);
      if (!catKey) { matsSemCadastroSet.add(r.materialOriginal || '—'); return false; }
      materialCatKeyMap.set(r.material || '—', catKey);
      materialCatSubKeyMap.set(r.material || '—', getCatSubKeyDoCadastro(r.materialOriginal));
      if (isSapExcluidoPorFechamento(r)) {
        sapFechExcluidos.push(r);
        const mat = r.material || '—';
        if (!sapFechExcluidosByMat.has(mat)) sapFechExcluidosByMat.set(mat, []);
        sapFechExcluidosByMat.get(mat).push(r);
        return false;
      }
      return true;
    });

    const entradasPorCod = {};
    const saidasPorCod   = {};
    sapNoPeriodo.forEach(r => {
      const cod = normMov(r.movimento);
      const p   = num(r.peso);
      if (p > 0) entradasPorCod[cod] = (entradasPorCod[cod] || 0) + p;
      else if (p < 0) saidasPorCod[cod] = (saidasPorCod[cod] || 0) + p;
    });

    const totalEntradas = Object.values(entradasPorCod).reduce((s, v) => s + v, 0);
    const totalSaidas   = Object.values(saidasPorCod).reduce((s, v) => s + v, 0);

    // Pré-agrupa lançamentos por material — elimina O(n×m) filter por material
    const lancsByMat = new Map();
    lancsNoPeriodo.forEach(r => {
      const mat = r.material || '—';
      if (!lancsByMat.has(mat)) lancsByMat.set(mat, []);
      lancsByMat.get(mat).push(r);
    });

    const materiaisLancPrimeiro = {};
    lancsNoPeriodo.forEach(r => {
      const mat = r.material || '—';
      if (!materiaisLancPrimeiro[mat]) materiaisLancPrimeiro[mat] = r;
    });

    const _macroIniDayKey = {};
    lancsNoPeriodo.forEach(r => {
      const mat = r.material || '—';
      if (!_macroIniDayKey[mat]) {
        const d = parseDate(r.dtLanc);
        _macroIniDayKey[mat] = d ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : null;
      }
    });
    const _macroPesoIniSoma = {};
    lancsNoPeriodo.forEach(r => {
      const mat = r.material || '—';
      const d = parseDate(r.dtLanc);
      const dk = d ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : null;
      if (dk && dk === _macroIniDayKey[mat]) {
        _macroPesoIniSoma[mat] = (_macroPesoIniSoma[mat] || 0) + num(r.peso);
      }
    });

    const lancsDesc = [...lancsNoPeriodo].sort((a, b) => {
      const da = parseDate(a.dtLanc), db = parseDate(b.dtLanc);
      return dateCmp(db ?? new Date(0), da ?? new Date(0));
    });
    const materiaisLancUltimo = {};
    lancsDesc.forEach(r => {
      const mat = r.material || '—';
      if (!materiaisLancUltimo[mat]) materiaisLancUltimo[mat] = r;
    });

    const allMats = new Set([
      ...Object.keys(materiaisLancPrimeiro),
      ...Object.keys(materiaisLancUltimo),
      ...sapNoPeriodo.map(r => r.material || '—')
    ]);

    // Agrupa por material usando o índice pré-construído — O(1) por material
    const _macroPesoFimSoma = {};
    allMats.forEach(mat => {
      const lancsMat = lancsByMat.get(mat) || [];
      if (!lancsMat.length) return;
      const lastD = parseDate(lancsMat[lancsMat.length - 1].dtLanc);
      if (!lastD) return;
      const lastISO = lastD.toISOString().substring(0, 10);
      let tot = 0;
      for (let i = lancsMat.length - 1; i >= 0; i--) {
        const d = parseDate(lancsMat[i].dtLanc);
        if (d && d.toISOString().substring(0, 10) === lastISO) tot += num(lancsMat[i].peso);
        else break;
      }
      _macroPesoFimSoma[mat] = tot;
    });

    let somaPrimeiro = 0, somaUltimo = 0;
    const missingIniMats = [], missingFimMats = [];
    allMats.forEach(mat => {
      const prev = dtIni ? getPrePeriodLaunchStock({ central, material: mat, dtIni, dtFim }) : null;
      if (prev != null) {
        somaPrimeiro += prev.value;
      } else {
        missingIniMats.push(mat);
      }

      const fim = dtFim ? getLastPeriodLaunchStock({ central, material: mat, dtFim }) : null;
      if (fim && !fim.missing) {
        somaUltimo += fim.value;
      } else {
        missingFimMats.push(mat);
      }
    });

    const estoqueTeoricoMacro = somaPrimeiro + totalEntradas + totalSaidas;
    const variacaoEstoque     = somaUltimo - estoqueTeoricoMacro;

    const saidasCentralRaw = _saidasByCentral.size > 0
      ? (_saidasByCentral.get(central) || []).filter(s => {
          if (!dtIni || !dtFim) return true;
          const d = parseDate(s.dtEmissao);
          return d && d >= dtIni && d <= dtFim;
        })
      : state.saidas.filter(s => s.central === central && inPeriod(s.dtEmissao));
    // Mesma filtragem por materialOriginal — custo médio não deve incluir
    // materiais sem cadastro.
    const saidasCentral = saidasCentralRaw.filter(s => !!getCatKeyDoCadastro(s.materialOriginal));
    const _custoPorMat  = {};
    const _pesoPorMat   = {};
    saidasCentral.forEach(s => {
      const mat = s.material || '—';
      _custoPorMat[mat] = (_custoPorMat[mat] || 0) + num(s.valorTotal);
      _pesoPorMat[mat]  = (_pesoPorMat[mat]  || 0) + Math.abs(num(s.peso));
    });
    const custoMedioPorMat = {};
    Object.keys(_custoPorMat).forEach(mat => {
      custoMedioPorMat[mat] = _pesoPorMat[mat] > 0 ? _custoPorMat[mat] / _pesoPorMat[mat] : 0;
    });
    // Fallback: materiais sem custo nas Saídas usam custoUnit/valorTotal do SAP
    sapNoPeriodo.forEach(s => {
      const mat = s.material || '—';
      if (custoMedioPorMat[mat]) return;
      const p  = Math.abs(num(s.peso));
      if (!p) return;
      const vt = num(s.valorTotal);
      const cu = num(s.custoUnit);
      const valor = vt !== 0 ? Math.abs(vt) : (cu !== 0 ? Math.abs(cu) * p : 0);
      if (!valor) return;
      if (!_custoPorMat['_sap_' + mat]) { _custoPorMat['_sap_' + mat] = 0; _pesoPorMat['_sap_' + mat] = 0; }
      _custoPorMat['_sap_' + mat] += valor;
      _pesoPorMat['_sap_' + mat]  += p;
    });
    Object.keys(_custoPorMat).forEach(key => {
      if (!key.startsWith('_sap_')) return;
      const mat = key.slice(5);
      if (custoMedioPorMat[mat]) return;
      custoMedioPorMat[mat] = _pesoPorMat[key] > 0 ? _custoPorMat[key] / _pesoPorMat[key] : 0;
    });

    results.push({
      central, totalEntradas, totalSaidas,
      estoqueTeoricoMacro, somaPrimeiro, somaUltimo, variacaoEstoque,
      missingIniMats, missingFimMats,
      allMats: [...allMats].sort(),
      materiaisLancPrimeiro, materiaisLancUltimo,
      sapNoPeriodo, lancsNoPeriodo, lancsByMat, custoMedioPorMat,
      matsSemCadastro: [...matsSemCadastroSet].sort(),
      materialCatKeyMap,
      materialCatSubKeyMap,
      sapFechExcluidos, sapFechExcluidosByMat
    });
  });

  return results;
}

// ── Funções de controle do filtro de período do Dashboard Gerencial ──
// Período agora é SEMPRE um mês inteiro (ver _dgMonthState, mais abaixo) —
// dtIni/dtFim são derivados do mês selecionado, não mais de um range livre.
// Os hidden inputs dg-dt-ini/dg-dt-fim continuam sendo preenchidos (1º e
// último dia do mês) por compatibilidade com dgSwitchTab('corte'), que lê
// esses ids diretamente pra sincronizar o Controle de Corte.
function rodarDashboardGerencial() {
  const dtIni = new Date(_dgMonthState.selectedYear, _dgMonthState.selectedMonth, 1);
  const dtFim = new Date(_dgMonthState.selectedYear, _dgMonthState.selectedMonth + 1, 0, 23, 59, 59);
  const iniEl = document.getElementById('dg-dt-ini');
  const fimEl = document.getElementById('dg-dt-fim');
  if (iniEl) iniEl.value = toISODate(dtIni);
  if (fimEl) fimEl.value = toISODate(dtFim);
  if (typeof showLoadingOverlay === 'function') showLoadingOverlay('Carregando dashboard', 'Calculando métricas consolidadas...');
  if (typeof loadingShowSteps === 'function') loadingShowSteps([
    { id: 'dg-calc',   icon: 'ti-calculator', label: 'Calculando variações e estoques' },
    { id: 'dg-render', icon: 'ti-layout',      label: 'Renderizando abas e gráficos' },
  ]);
  if (typeof _lbarSet === 'function') _lbarSet(10);
  requestAnimationFrame(() => setTimeout(() => {
    if (typeof _lstepSet === 'function') { _lstepSet('dg-calc', 'running'); _lbarSet(20); }
    const emptyEl   = document.getElementById('dg-empty-state');
    const contentEl = document.getElementById('dg-content');
    if (emptyEl)   emptyEl.style.display   = 'none';
    if (contentEl) contentEl.style.display = '';
    _renderDashboardConteudo(dtIni, dtFim);
    const relBtn = document.getElementById('dg-btn-relatorio-gerencial');
    if (relBtn) relBtn.disabled = !window._dgVgLastData;
    if (typeof _lstepSet === 'function') { _lstepSet('dg-calc', 'done'); _lstepSet('dg-render', 'running'); _lbarSet(75); }
    if (document.getElementById('dg-tab-btn-corte')?.classList.contains('active')) {
      if (typeof rodarControleAgregadosPorPeriodo === 'function' && dtIni && dtFim) {
        rodarControleAgregadosPorPeriodo(dtIni, dtFim);
      }
    }
    if (window.updatePeriodFab) updatePeriodFab();
    if (typeof _lstepSet === 'function') { _lstepSet('dg-render', 'done'); _lbarSet(100); }
    if (typeof hideLoadingOverlay === 'function') hideLoadingOverlay('Dashboard atualizado');
    if (typeof loadingHideSteps === 'function') loadingHideSteps();
  }, 0));
}

function limparDashboardGerencial() {
  // O mês selecionado no seletor (_dgMonthState) permanece como está —
  // mesmo padrão do Inventário, que não tem um estado "vazio" de período.
  // Limpar só reseta o conteúdo renderizado, não a seleção de mês.
  // Voltar ao estado vazio
  const emptyEl   = document.getElementById('dg-empty-state');
  const contentEl = document.getElementById('dg-content');
  if (emptyEl)   emptyEl.style.display   = 'flex';
  if (contentEl) contentEl.style.display = 'none';
  window._dgVgLastData = null;
  const relBtn = document.getElementById('dg-btn-relatorio-gerencial');
  if (relBtn) relBtn.disabled = true;
  if (window.updatePeriodFab) updatePeriodFab();
}

// ── Seletor de MÊS do Dashboard Gerencial ───────────────────────────────
// Substitui o antigo seletor de range de dias (calendar.js/toggleCalPicker)
// por um componente próprio, só de meses — mesmo padrão já usado no
// Inventário (_invMonthState / invToggleMonthPicker, em inventario.js).
// Motivo: o componente genérico de calendar.js foi feito pra seleção de
// range de dias; aqui o período agora é sempre um mês inteiro.
const MESES_ABREV_DG = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const MESES_NOME_DG  = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

const _dgMonthState = {
  viewYear:      new Date().getFullYear(),  // ano exibido no grid (navegação)
  selectedYear:  new Date().getFullYear(),  // ano efetivamente selecionado
  selectedMonth: new Date().getMonth()      // mês efetivamente selecionado (0-based)
};

function _dgUpdateMonthTriggerLabel() {
  const label = document.getElementById('dg-month-label');
  if (label) label.textContent = MESES_NOME_DG[_dgMonthState.selectedMonth] + ' de ' + _dgMonthState.selectedYear;
  const trigger = document.getElementById('dg-month-trigger');
  if (trigger) trigger.classList.add('has-value');
}

function _dgRenderMonthGrid() {
  const container = document.getElementById('dg-month-inner');
  if (!container) return;
  const y = _dgMonthState.viewYear;
  const items = MESES_ABREV_DG.map((name, i) => {
    const active = (i === _dgMonthState.selectedMonth && y === _dgMonthState.selectedYear) ? ' active' : '';
    return `<button class="cal-grid-item${active}" onclick="dgSelectMonth(${i})" type="button">${name}</button>`;
  }).join('');
  container.innerHTML = `
    <div class="cal-header">
      <button class="cal-nav-btn" onclick="dgNavMonthYear(-1)" type="button"><i class="ti ti-chevron-left"></i></button>
      <span class="cal-header-center" style="cursor:default">${y}</span>
      <button class="cal-nav-btn" onclick="dgNavMonthYear(1)" type="button"><i class="ti ti-chevron-right"></i></button>
    </div>
    <div class="cal-month-grid">${items}</div>`;
}

window.dgNavMonthYear = function(dir) {
  _dgMonthState.viewYear += dir;
  _dgRenderMonthGrid();
};

window.dgSelectMonth = function(month) {
  _dgMonthState.selectedYear  = _dgMonthState.viewYear;
  _dgMonthState.selectedMonth = month;
  _dgUpdateMonthTriggerLabel();
  _dgCloseMonthPicker();
  // Troca de mês: gera (ou regenera) o dashboard desse mês imediatamente.
  rodarDashboardGerencial();
};

function _dgCloseMonthPicker() {
  document.getElementById('dg-month-dropdown')?.classList.remove('open');
  document.getElementById('dg-month-trigger')?.classList.remove('open');
}

window.dgToggleMonthPicker = function() {
  const dropdown = document.getElementById('dg-month-dropdown');
  const trigger  = document.getElementById('dg-month-trigger');
  if (!dropdown) return;
  const isOpen = dropdown.classList.contains('open');
  // Fecha outros pickers de calendário abertos na página (mesmo padrão do calendar.js)
  document.querySelectorAll('.cal-picker-dropdown.open').forEach(el => {
    if (el !== dropdown) {
      el.classList.remove('open');
      document.getElementById(el.id.replace('-dropdown', '-trigger'))?.classList.remove('open');
    }
  });
  if (isOpen) {
    _dgCloseMonthPicker();
  } else {
    _dgMonthState.viewYear = _dgMonthState.selectedYear; // sempre abre focado no ano selecionado
    dropdown.classList.add('open');
    trigger?.classList.add('open');
    _dgRenderMonthGrid();
  }
};

// Fecha ao clicar fora (mesmo padrão usado pelos outros dropdowns do sistema)
document.addEventListener('click', e => {
  const wrap = document.getElementById('dg-month-wrap');
  const dropdown = document.getElementById('dg-month-dropdown');
  if (wrap && dropdown?.classList.contains('open') && !wrap.contains(e.target)) {
    _dgCloseMonthPicker();
  }
});
// Evita que cliques dentro do dropdown fechem ele mesmo (bubbling), e
// inicializa o rótulo do trigger com o mês atual assim que o DOM carregar.
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('dg-month-dropdown')?.addEventListener('click', e => e.stopPropagation());
  _dgUpdateMonthTriggerLabel();
});

Object.assign(window, {
  rodarDashboardGerencial, limparDashboardGerencial,
  dgToggleMonthPicker: window.dgToggleMonthPicker,
  dgSelectMonth: window.dgSelectMonth,
  dgNavMonthYear: window.dgNavMonthYear
});

function updateDashboard() {
  // O Dashboard Gerencial só é gerado quando o usuário clica em "Analisar".
  // Esta função é mantida para compatibilidade com chamadas legadas (importação,
  // deleção de registros, etc.) mas não dispara render automático.
  // Sincronizar configurações se ativa
  if (document.getElementById('page-configuracoes')?.classList.contains('active')) {
    updateParamGerais();
  }
}

function _renderDashboardConteudo(dtIni, dtFim) {
  // ── Build base results (reuse) ──
  const results = buildDashboardGerencialResults(dtIni, dtFim);
  const thresholds = getHealthThresholds();

  // ── 1. Visão Geral — KPIs executivos + gráficos consolidados (reformulada) ──
  renderDgVisaoGeralPdf(results, thresholds, dtIni, dtFim);

  // ── 2. Visão de Consumo — KPIs com comparativo automático vs. período
  // anterior equivalente (mesma duração, encostado antes de dtIni) +
  // rankings de Saídas + Giro & Cobertura (migrado da Visão Geral, agora
  // renderizado só a partir daqui — ver renderDgConsumo). ──
  const { dtIniAnt, dtFimAnt } = getPeriodoAnteriorEquivalente(dtIni, dtFim);
  const resultsAnt = (dtIniAnt && dtFimAnt) ? buildDashboardGerencialResults(dtIniAnt, dtFimAnt) : [];
  renderDgConsumo(results, resultsAnt, dtIni, dtFim);
}

// ═══════════════════════════════════════════════════════════
// VISÃO GERAL — reformulada (KPIs executivos + gráficos consolidados)
//
// Layout baseado em referência fornecida pelo analista (export de
// Google Planilhas usado pela diretoria). Substitui integralmente os
// KPIs de Est.Inicial/Final, "Riscos Operacionais" e "Top 5 Centrais"
// que existiam antes nesta aba por:
//   1. KPIs de topo: Variação Total / Custo Total / Recorrentes
//   2. Saúde geral: contagem de materiais Crítico/Urgente/Atenção + gauge
//   3. Variação Física por Categoria de Material (Agregado/Aglomerante/
//      Aditivo/Adição)
//   4. Regional/Central com maior desfalque e maior sobra
//   5-6. Variação de Custo por Regional e por Central
//   7. Custo Absoluto por Grupo de Material (combinado)
//   8. Custo Absoluto por categoria (4 donuts: Agregado, Aglomerante,
//      Aditivo, Adição)
//
// Notas de metodologia (decisões tomadas para reformular esta aba):
//  • "Regional" = campo cadastrado em Configurações → Filiais (neste
//    cliente, guarda o nome do gestor responsável, não uma região
//    geográfica).
//  • Crítico/Urgente/Atenção e o score do gauge usam a MESMA
//    metodologia de Est. Inicial/Final (com fallback retroativo) e a
//    mesma fórmula de pontuação (calcHealthScore/HEALTH_PENALTIES) já
//    usadas nos cards de saúde do Dashboard Analítico — os números
//    batem com o "Saúde Geral" do topbar.
//  • "Recorrentes" = pares Central×Material críticos/urgentes que já
//    estavam críticos/urgentes no período equivalente imediatamente
//    anterior (mesma duração, encostado antes de dtIni).
//  • "Custo Absoluto" (donuts) = gasto real registrado nas Saídas
//    (valorTotal) no período, com fallback ao SAP — é um valor
//    diferente de "Custo Total implicado" (que reflete o impacto
//    financeiro da variação/desfalque-sobra).
// ═══════════════════════════════════════════════════════════

const DG_VG_CAT_LABELS = { agregado: 'Agregado', aglomerante: 'Aglomerante', aditivo: 'Aditivo', adicao: 'Adição' };
const DG_VG_CAT_COLORS = { agregado: '#8b5cf6', aglomerante: '#3b82f6', aditivo: '#f59e0b', adicao: '#10b981' };
const DG_VG_CAT_ORDER  = ['agregado', 'aglomerante', 'aditivo', 'adicao'];

// Rótulos de subcategoria de Agregado (Graúdo/Miúdo) — usados só pelo
// Ranking de Categoria do Detalhado Analítico (jul/2026, a pedido do
// Hugo). O restante da Visão Geral (KPIs, donuts, gráficos de saúde)
// continua tratando Agregado como categoria única — só esse ranking abre
// a distinção.
const DG_VG_CATSUB_LABELS = { agregado_graudo: 'Agregado Graúdo', agregado_miudo: 'Agregado Miúdo' };

let _dgVgCharts = {};
function _dgVgDestroyChart(key) {
  if (_dgVgCharts[key]) {
    try { _dgVgCharts[key].destroy(); } catch (e) { /* noop */ }
    _dgVgCharts[key] = null;
  }
}

// Os 3 gráficos Chart.js da Visão Geral (categoria física, custo por
// regional, custo por central) podem ter sido criados enquanto a página
// #page-dashboard ainda estava oculta (display:none) — cenário possível
// sempre que _renderDashboardConteudo rodar com a aba não visível.
// Um <canvas> com container display:none reporta dimensão zero no
// momento da criação, então o Chart.js nasce com o gráfico "quebrado"
// visualmente. Chamada por navigate() (ui.js) sempre que o usuário entra
// na página Dashboard Gerencial, para forçar o Chart.js a reler as
// dimensões reais do canvas agora que ele está visível. Não faz nada se
// os gráficos ainda não existirem (ex.: antes do primeiro "Atualizar").
function _dgResizeCharts() {
  Object.values(_dgVgCharts).forEach(c => {
    if (!c) return;
    try { c.resize(); } catch (e) { /* noop */ }
  });
}

function _dgVgTheme() {
  const isDark = !document.body.dataset.theme || document.body.dataset.theme !== 'light';
  return {
    textCol:  isDark ? 'rgba(123,133,160,0.9)' : 'rgba(61,79,110,0.9)',
    gridCol:  isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)',
    tickFont: { family: "'DM Mono', monospace", size: 10 }
  };
}

// Chart.js desenha em <canvas> (bitmap), então NÃO entende "var(--x)" —
// isso só é resolvido pelo motor de CSS em elementos reais do DOM. Sem
// isso, backgroundColor recebe a string literal "var(--accent)" e o
// Canvas cai no preto padrão (bug reportado: "barras pretas ao invés de
// coloridas"). Resolve o valor REAL da variável (já considerando o tema
// claro/escuro ativo) antes de repassar pro Chart.js.
function _dgResolveCssColor(varName, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return v || fallback;
  } catch (e) {
    return fallback;
  }
}

// ── Constrói os pares Central×Material com diff (variação), categoria,
//    nível de saúde e custo implicado. Usa a MESMA metodologia de
//    Est. Inicial/Final (com fallback retroativo) já usada nos cards de
//    saúde do Dashboard Analítico, garantindo que os números batam com
//    o "Saúde Geral" exibido no restante do sistema.
function _dgVgBuildPares(results, thresholds, dtIni, dtFim) {
  const pares = [];
  const filIdx = getFilialLookupIndex();

  results.forEach(r => {
    const lancsByMat = new Map();
    const sapByMat   = new Map();
    r.lancsNoPeriodo.forEach(l => { const m = l.material || '—'; if (!lancsByMat.has(m)) lancsByMat.set(m, []); lancsByMat.get(m).push(l); });
    r.sapNoPeriodo.forEach(s   => { const m = s.material  || '—'; if (!sapByMat.has(m))   sapByMat.set(m, []);   sapByMat.get(m).push(s); });

    const filRec   = filIdx.exact.get(normalizeText(r.central));
    const regional = (filRec?.regional || '').trim() || '—';

    r.allMats.forEach(mat => {
      const lancs  = lancsByMat.get(mat) || [];
      const sap    = sapByMat.get(mat)   || [];
      // catKey vem de r.materialCatKeyMap (validado via materialOriginal na
      // filtragem de origem em buildDashboardGerencialResults) — r.allMats
      // já só contém materiais cadastrados, então isto é um lookup seguro,
      // não uma re-derivação por nome resolvido (que poderia colidir com
      // outro cadastro não relacionado).
      const catKey = (r.materialCatKeyMap && r.materialCatKeyMap.get(mat)) || null;
      // catSubKey distingue Agregado Graúdo/Miúdo (usado só pelo Ranking de
      // Categoria) — mesmo lookup seguro via materialCatSubKeyMap, sem
      // re-derivar por nome. null pra qualquer categoria que não seja
      // Agregado (Aglomerante/Aditivo/Adição não têm subcategoria).
      const catSubKey = (r.materialCatSubKeyMap && r.materialCatSubKeyMap.get(mat)) || null;

      let diff, estoqueIni = 0, estoqueFim = 0, entKg = 0, saiKg = 0;
      if (dtIni && dtFim) {
        const prev = getPrePeriodLaunchStock({ central: r.central, material: mat, dtIni, dtFim, catKey });
        const fim  = getLastPeriodLaunchStockWithFallback({ central: r.central, material: mat, dtIni, dtFim });
        // Captura os mesmos valores já resolvidos pra calcular o diff —
        // usados pelos cards "Est. Inicial/Final Total" do resumo do
        // período (ver _dgVgEstoqueTotais). Ausente fica 0 (sem aviso,
        // diferente do Inventário — decisão confirmada com o Hugo).
        estoqueIni = prev?.value ?? 0;
        estoqueFim = (fim && !fim.missing) ? fim.value : 0;
        const snap = buildSnapshot({
          lancs, sap,
          initialStockOverride: prev?.value ?? null,
          finalStockOverride:   (fim && !fim.missing) ? fim.value : null
        });
        diff  = snap.diff;
        // totalEnt/totalSai já vêm calculados pelo buildSnapshot (saiKg
        // sai negativo de lá — normalizamos aqui pra magnitude positiva,
        // mesma convenção usada em _dgVgMovimentacaoTotais/movTotais.totalSai
        // no resto da Visão Geral) — usados pela tabela de Detalhamento
        // por Material (Detalhado Analítico), sem custo extra: só passamos
        // a guardar um valor que antes era descartado.
        entKg = snap.totalEnt || 0;
        saiKg = Math.abs(snap.totalSai || 0);
      } else {
        const snap = buildSnapshot({ lancs, sap });
        diff  = snap.diff;
        entKg = snap.totalEnt || 0;
        saiKg = Math.abs(snap.totalSai || 0);
      }

      const neutro = Math.abs(diff) <= 0.0001;
      // Sem cadastro tem prioridade sobre "neutro" — mesmo com variação
      // próxima de zero, não deve ser contado como 'bom' silenciosamente
      // (decisão: excluído do cálculo de saúde até ser cadastrado).
      const level    = !catKey ? 'sem_cadastro' : (neutro ? 'bom' : classifyVariation(Math.abs(diff), catKey, thresholds));
      const custoMed = (r.custoMedioPorMat || {})[mat] || 0;

      // custoIni/custoFim: custo do SALDO de estoque (kg × custo médio do
      // material) — usados pelos cards "Est. Inicial/Final Total" do resumo
      // do período (ver _dgVgEstoqueTotais). Diferente de custoImplicado
      // (custo da VARIAÇÃO, diff × custoMed) — aqui é o custo do saldo em
      // si, não da diferença. Decisão confirmada com o Hugo.
      pares.push({
        central: r.central, regional, mat, catKey, catSubKey, diff, level, neutro,
        custoImplicado: diff * custoMed, estoqueIni, estoqueFim,
        custoIni: estoqueIni * custoMed, custoFim: estoqueFim * custoMed,
        entKg, saiKg, custoMed
      });
    });
  });

  return pares;
}

// Est. Inicial / Est. Final Total — soma o estoqueIni/estoqueFim que
// _dgVgBuildPares já resolve por par (mesma função usada no Inventário:
// getPrePeriodLaunchStock / getLastPeriodLaunchStockWithFallback, em
// ui.js) — sem custo extra de performance, só captura um valor que já
// era calculado e descartado. Ausente conta como 0, sem aviso (decisão
// confirmada: diferente do Inventário, que mostra "X ausentes").
function _dgVgEstoqueTotais(pares) {
  let totalIni = 0, totalFim = 0, custoIni = 0, custoFim = 0;
  pares.forEach(p => {
    totalIni += p.estoqueIni || 0;
    totalFim += p.estoqueFim || 0;
    custoIni += p.custoIni || 0;
    custoFim += p.custoFim || 0;
  });
  return { totalIni, totalFim, custoIni, custoFim };
}

// Entradas / Saídas Total — soma dos totais já calculados por central em
// buildDashboardGerencialResults (mesma exclusão de "sem cadastro" já
// aplicada na origem, antes mesmo de chegar em pares). Saídas vira
// positivo pra bater com a convenção do Inventário (lá soma Math.abs(p);
// aqui totalSaidas por central já vem negativo).
function _dgVgMovimentacaoTotais(results) {
  let totalEnt = 0, totalSai = 0;
  results.forEach(r => { totalEnt += r.totalEntradas || 0; totalSai += Math.abs(r.totalSaidas || 0); });
  return { totalEnt, totalSai };
}

// Custo de uma movimentação SAP individual — valorTotal do registro, com
// fallback custoUnit × peso (MESMO padrão já usado no cálculo de
// custoMedioPorMat, em buildDashboardGerencialResults/getCustoMedioPorMat).
function _dgVgValorCustoSap(s) {
  const p = Math.abs(num(s.peso));
  if (!p) return 0;
  const vt = num(s.valorTotal);
  const cu = num(s.custoUnit);
  return vt !== 0 ? Math.abs(vt) : (cu !== 0 ? Math.abs(cu) * p : 0);
}

// Custo de Entradas/Saídas — soma o custo de cada registro SAP do período,
// filtrando pelo SINAL do peso (positivo = entrada, negativo = saída),
// MESMO critério do kg (_dgVgMovimentacaoTotais, acima) — decisão do Hugo:
// captura todo registro positivo/negativo do SAP, independente do código
// de movimento (101/801/201/Y11/Y12/etc.). Fonte é o próprio registro SAP
// (valorTotal/custoUnit), não o custo médio por material. Ajustes de
// Fechamento Mensal (Y11/Y12) continuam de fora: já são filtrados antes,
// em sapNoPeriodo (ver isSapExcluidoPorFechamento, buildDashboardGerencialResults).
function _dgVgCustoMovimentacaoTotais(results) {
  let custoEnt = 0, custoSai = 0;
  results.forEach(r => {
    (r.sapNoPeriodo || []).forEach(s => {
      const p = num(s.peso);
      if (p > 0)      custoEnt += _dgVgValorCustoSap(s);
      else if (p < 0) custoSai += _dgVgValorCustoSap(s);
    });
  });
  return { custoEnt, custoSai };
}

// Tally de pares Central×Material por nível — MESMO critério usado em
// macro.js (matItems/matCounts): todos os materiais entram, inclusive os
// com variação zero (classificados 'bom'), sem exclusão de "neutros".
function _dgVgCounts(pares) {
  // sem_cadastro rastreado à parte — nunca soma em critico/urgente/atencao/bom
  // (excluído do cálculo de saúde, decisão já aplicada em calcHealthScore).
  const counts = { critico: 0, urgente: 0, atencao: 0, bom: 0, sem_cadastro: 0 };
  pares.forEach(p => { counts[p.level] = (counts[p.level] || 0) + 1; });
  return counts;
}

// Score agregado exibido nos donuts — MESMA fórmula usada pelo Dashboard
// Analítico (macro.js: _scoreFromCounts, dentro de macroApplyFilter):
// penalidade = atenção×0,2 + urgente×0,5 + crítico×1,0, sobre o total de
// itens (não é a mesma fórmula do calcHealthScore individual de central).
function _dgVgScoreFromCounts(counts) {
  const total = (counts.critico || 0) + (counts.urgente || 0) + (counts.atencao || 0) + (counts.bom || 0);
  if (!total) return { score: 100, level: 'bom' };
  const penalty = (counts.atencao || 0) * 0.2 + (counts.urgente || 0) * 0.5 + (counts.critico || 0) * 1.0;
  const score = Math.max(0, Math.round((1 - penalty / total) * 100));
  const level = score >= 80 ? 'bom' : score >= 55 ? 'atencao' : score >= 30 ? 'urgente' : 'critico';
  return { score, level };
}

// Saúde geral por CENTRAL — classifica cada central individualmente com
// calcHealthScore (a MESMA função usada nos cards de saúde do Dashboard
// Analítico, buildCentralCard), agregando os materiais daquela central.
// O resultado (nível por central) alimenta o segundo donut, réplica do
// donut "Centrais" do painel macro.
function _dgVgBuildCentralHealthData(pares, thresholds) {
  const byCentral = new Map(); // central -> { matDiffs:[], custo:0, diff:0 }
  pares.forEach(p => {
    if (!byCentral.has(p.central)) byCentral.set(p.central, { matDiffs: [], custo: 0, diff: 0 });
    const rec = byCentral.get(p.central);
    rec.matDiffs.push({ mat: p.mat, diff: p.diff, catKey: p.catKey });
    rec.custo += Math.abs(p.custoImplicado);
    rec.diff  += p.diff;
  });

  const counts      = { critico: 0, urgente: 0, atencao: 0, bom: 0 };
  const levelMeta    = { critico: { diff: 0, custo: 0 }, urgente: { diff: 0, custo: 0 }, atencao: { diff: 0, custo: 0 }, bom: { diff: 0, custo: 0 } };

  byCentral.forEach(rec => {
    const { level: rawLevel } = calcHealthScore(rec.matDiffs, null, null, thresholds);
    const level = (!rawLevel || rawLevel === 'none' || rawLevel === 'ok') ? 'bom' : rawLevel;
    counts[level]++;
    levelMeta[level].diff  += rec.diff;
    levelMeta[level].custo += rec.custo;
  });

  return { counts, levelMeta, total: byCentral.size };
}

function _dgVgAggPorChave(pares, keyFn) {
  const map = new Map();
  pares.forEach(p => {
    const k = keyFn(p);
    if (!k || k === '—') return;
    map.set(k, (map.get(k) || 0) + p.custoImplicado);
  });
  return map;
}

// Mesma agregação por chave (Regional/Central), mas somando o SALDO da
// variação (kg, p.diff) em vez do custo implicado — usado só pra anexar
// o kg correspondente ao vencedor de cada extremo (ver _dgVgExtremos).
// Mantido separado de _dgVgAggPorChave porque esse mapa de custo também
// alimenta os gráficos de barra (chart Regional/Usina) e o Top 8, que
// esperam valor numérico simples — não dá pra misturar sem quebrar esses
// outros usos.
function _dgVgAggKgPorChave(pares, keyFn) {
  const map = new Map();
  pares.forEach(p => {
    const k = keyFn(p);
    if (!k || k === '—') return;
    map.set(k, (map.get(k) || 0) + p.diff);
  });
  return map;
}

function _dgVgExtremos(map, kgMap = null) {
  let min = null, max = null;
  map.forEach((v, k) => {
    if (!min || v < min.v) min = { k, v };
    if (!max || v > max.v) max = { k, v };
  });
  // kgMap opcional: anexa o saldo da variação (kg) da MESMA chave
  // vencedora (mesmo regional/central que já venceu por custo) — não
  // recalcula o extremo por kg, só decora o resultado já decidido por custo.
  if (kgMap) {
    if (min) min.kg = kgMap.get(min.k) || 0;
    if (max) max.kg = kgMap.get(max.k) || 0;
  }
  return { min, max };
}

function _dgVgVariacaoFisicaPorCategoria(pares) {
  const out = { agregado: 0, aglomerante: 0, aditivo: 0, adicao: 0 };
  // Materiais sem cadastro (catKey null) ficam de fora — sem categoria
  // conhecida, não há bucket correto para somar; evita criar uma chave
  // fantasma "null" no objeto de saída.
  pares.forEach(p => { if (!p.catKey) return; out[p.catKey] = (out[p.catKey] || 0) + p.diff; });
  return out;
}

// Mesma agregação por categoria acima, mas SEM nettar desfalque contra
// sobra — retorna os dois totais separados por categoria. Decisão: a
// versão líquida (_dgVgVariacaoFisicaPorCategoria) esconde o tamanho real
// de cada lado quando um compensa o outro (ex: -5,0 M kg de desfalque e
// +2,0 M kg de sobra dentro do Agregado apareceriam como -3,0 M kg só).
// Usada pelo gráfico "Variação Física por Categoria de Material", que
// precisa mostrar os dois lados para a diretoria.
function _dgVgVariacaoFisicaPorCategoriaSplit(pares) {
  const out = {
    agregado:    { desfalque: 0, sobra: 0 },
    aglomerante: { desfalque: 0, sobra: 0 },
    aditivo:     { desfalque: 0, sobra: 0 },
    adicao:      { desfalque: 0, sobra: 0 }
  };
  pares.forEach(p => {
    if (!p.catKey || !out[p.catKey]) return;
    if (p.diff < 0)      out[p.catKey].desfalque += p.diff;
    else if (p.diff > 0) out[p.catKey].sobra += p.diff;
  });
  return out;
}

// Volume total movimentado (entradas + saídas SAP, em módulo) por
// categoria no período — usado como base para normalizar o desfalque/
// sobra em percentual. Decisão: comparar categorias direto em kg é
// injusto (Agregado pesa milhões de kg, Aditivo pesa centenas) — usando
// o volume movimentado da PRÓPRIA categoria como denominador, cada
// categoria é julgada só contra ela mesma (ex: 3.000 kg de desfalque em
// Aditivo pode ser 6% do que se movimenta dele, enquanto 30.000 kg em
// Agregado pode ser 0,2% do que se movimenta dele — o gráfico passa a
// refletir isso).
function _dgVgVolumeMovimentadoPorCategoria(results) {
  const out = { agregado: 0, aglomerante: 0, aditivo: 0, adicao: 0 };
  results.forEach(r => {
    const catMap = r.materialCatKeyMap;
    if (!catMap) return;
    (r.sapNoPeriodo || []).forEach(s => {
      const catKey = catMap.get(s.material || '—');
      if (!catKey || !(catKey in out)) return;
      out[catKey] += Math.abs(num(s.peso));
    });
  });
  return out;
}

// Junta o split de desfalque/sobra em kg com o volume movimentado por
// categoria, retornando os dois lados já em percentual (pra tamanho da
// barra) e mantendo o kg original (pra rótulo/tooltip). Categoria sem
// nenhum volume movimentado no período fica com percentual 0 (evita
// divisão por zero) — nesse caso não deveria haver diff de qualquer
// forma, mas o fallback protege contra dado inconsistente.
function _dgVgVariacaoFisicaPercentualPorCategoria(catFisicaSplit, volumePorCategoria) {
  const out = {};
  DG_VG_CAT_ORDER.forEach(k => {
    const vol = volumePorCategoria[k] || 0;
    const kg  = catFisicaSplit[k] || { desfalque: 0, sobra: 0 };
    out[k] = {
      desfalqueKg:  kg.desfalque,
      sobraKg:      kg.sobra,
      desfalquePct: vol > 0 ? (kg.desfalque / vol) * 100 : 0,
      sobraPct:     vol > 0 ? (kg.sobra     / vol) * 100 : 0
    };
  });
  return out;
}

// ── Custo da variação (não o gasto efetivo) por material — soma do valor
//    absoluto do custo implicado (diff × custo médio) de cada par
//    Central×Material, agregado por material. Reflete o impacto
//    financeiro do desfalque/sobra, não o quanto foi de fato gasto/
//    consumido no período.
function _dgVgCustoVariacaoPorMaterial(pares) {
  const map = new Map(); // mat -> { catKey, total }
  pares.forEach(p => {
    const v = Math.abs(p.custoImplicado);
    if (!v) return;
    if (!map.has(p.mat)) map.set(p.mat, { catKey: p.catKey, total: 0 });
    map.get(p.mat).total += v;
  });
  return map;
}

function _dgVgAgruparCustoVariacaoPorCategoria(map) {
  const cats = { agregado: [], aglomerante: [], aditivo: [], adicao: [] };
  map.forEach(({ catKey, total }, mat) => {
    if (!(total > 0)) return;
    // Sem cadastro (catKey null): fora da agregação por categoria — não
    // há categoria conhecida para colocar, evita bucket fantasma "null".
    if (!catKey) return;
    if (!cats[catKey]) cats[catKey] = [];
    cats[catKey].push({ mat, total });
  });
  Object.values(cats).forEach(arr => arr.sort((a, b) => b.total - a.total));
  return cats;
}

// Clareia (factor>0) ou escurece (factor<0) uma cor hex — usado para dar
// tons diferentes a materiais dentro da mesma categoria nos donuts.
function _dgVgShade(hex, factor) {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16), g = parseInt(c.substring(2, 4), 16), b = parseInt(c.substring(4, 6), 16);
  const adj = ch => {
    const v = factor >= 0 ? ch + (255 - ch) * factor : ch + ch * factor;
    return Math.max(0, Math.min(255, Math.round(v)));
  };
  return `rgb(${adj(r)},${adj(g)},${adj(b)})`;
}

// ═══════════════════════════════════════════════════════════
// DONUTS SVG — mesmo design visual do gráfico donut do Dashboard
// Analítico (macro.js: _renderDonut): arcos com pequeno gap entre
// fatias, glow ao passar o mouse, linhas de chamada (callout) para as
// maiores fatias, tooltip rico reaproveitando o sistema de tooltip
// já existente (_showTip/_moveTip/_hideTip) e anel de destaque + texto
// central. Usado tanto no gauge de Saúde Geral quanto nos donuts de
// Custo Absoluto.
// ═══════════════════════════════════════════════════════════

let _dgVgDonutUid = 0;

// slices: [{ value, color, tipHtml, label(já escapado, opcional) }]
// centerSvgFn(CX, CY, ri): retorna string SVG extra desenhada no centro
// (anel + textos) — cada chamador desenha seu próprio conteúdo central.
function _dgVgDrawDonutSvg(svgEl, slices, centerSvgFn, maxCallouts = 6, sizeOverride = null) {
  if (!svgEl) return;
  const total = slices.reduce((s, x) => s + x.value, 0);
  // Tamanho padrão (donuts de custo: Grupo de Material + 4 categorias) —
  // sizeOverride permite outro tamanho sem afetar quem não passar nada
  // (ex: os gauges de Saúde Geral, ajustados pro mesmo tamanho do
  // Dashboard Analítico — ver _dgVgRenderHealthDonutSvg).
  const sz = sizeOverride || { vbW: 340, vbH: 220, CX: 170, CY: 108, R: 74, ri: 44, calloutOffset: 14, elbowOffset: 28, tickLen: 15, calloutPctFontSize: 10, calloutLabelFontSize: 8 };
  svgEl.setAttribute('viewBox', `0 0 ${sz.vbW} ${sz.vbH}`);

  if (!slices.length || total <= 0) {
    svgEl.innerHTML = `<text x="${sz.vbW / 2}" y="${sz.vbH / 2}" text-anchor="middle" font-size="12" fill="var(--text3)" font-family="var(--mono)">Sem dados</text>`;
    return;
  }

  const uid = 'dgvg' + (_dgVgDonutUid++);
  // Anel no tamanho original (R:74 / ri:44). O corte de texto é resolvido
  // alargando o viewBox (300→340, CX 150→170) em vez de aproximar o rótulo
  // do anel — dá margem horizontal extra pro texto sem espremer o callout
  // nem diminuir o donut. CALLOUT_R/ELBOW_R/TICK_LEN voltam à distância
  // confortável original.
  const CX = sz.CX, CY = sz.CY, R = sz.R, ri = sz.ri;
  const CALLOUT_R = R + sz.calloutOffset, ELBOW_R = R + sz.elbowOffset, TICK_LEN = sz.tickLen;
  const gap = slices.length > 1 ? 0.022 : 0;
  let angle = -Math.PI / 2;

  let svg = `<defs>
    <filter id="mglow-${uid}" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="3.5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <style>
      .dvslice-${uid} { cursor:pointer; transition:opacity .15s; transform-origin:${CX}px ${CY}px; }
      .dvslice-${uid}:hover { opacity:1 !important; filter:url(#mglow-${uid}); }
      .dvslice-${uid}.m-dimmed { opacity:0.32; }
      .dvcallout-${uid} { pointer-events:none; transition:opacity .15s; }
      .dvcallout-${uid}.m-dimmed { opacity:0.18; }
    </style>
  </defs>`;

  const built = [];
  slices.forEach((sl, i) => {
    const pct   = sl.value / total;
    const sweep = Math.max(pct * 2 * Math.PI - gap, 0.01);
    const a0 = angle + gap / 2, ae = a0 + sweep, midA = a0 + sweep / 2;

    const x1 = CX + R * Math.cos(a0),  y1 = CY + R * Math.sin(a0);
    const x2 = CX + R * Math.cos(ae),  y2 = CY + R * Math.sin(ae);
    const x3 = CX + ri * Math.cos(ae), y3 = CY + ri * Math.sin(ae);
    const x4 = CX + ri * Math.cos(a0), y4 = CY + ri * Math.sin(a0);
    const large = sweep > Math.PI ? 1 : 0;
    const pctStr = Math.round(pct * 100);

    svg += `<path class="dvslice-${uid}" data-idx="${i}" data-tip="${encodeURIComponent(sl.tipHtml)}" data-col="${sl.color}"
      d="M${x1.toFixed(1)},${y1.toFixed(1)} A${R},${R} 0 ${large},1 ${x2.toFixed(1)},${y2.toFixed(1)} L${x3.toFixed(1)},${y3.toFixed(1)} A${ri},${ri} 0 ${large},0 ${x4.toFixed(1)},${y4.toFixed(1)} Z"
      fill="${sl.color}" opacity="0.88"/>`;

    built.push({ idx: i, midA, pct, pctStr, col: sl.color, label: sl.label });
    angle += sweep + gap;
  });

  // Callouts apenas para as fatias mais relevantes (evita poluição visual
  // quando há muitos materiais — diferente do caso original de 4 níveis).
  built.filter(b => b.pct >= 0.05).sort((a, b) => b.pct - a.pct).slice(0, maxCallouts).forEach(({ idx, midA, pctStr, col, label }) => {
    const ex = CX + ELBOW_R * Math.cos(midA), ey = CY + ELBOW_R * Math.sin(midA);
    const sx = CX + CALLOUT_R * Math.cos(midA), sy = CY + CALLOUT_R * Math.sin(midA);
    const onRight = Math.cos(midA) >= 0;
    const tx = ex + (onRight ? TICK_LEN : -TICK_LEN), ty = ey;
    const labelX = tx + (onRight ? 4 : -4);
    const labelAnchor = onRight ? 'start' : 'end';

    svg += `<g class="dvcallout-${uid}" data-callout-idx="${idx}">
      <polyline points="${sx.toFixed(1)},${sy.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)} ${tx.toFixed(1)},${ty.toFixed(1)}"
        fill="none" stroke="${col}" stroke-width="1.1" stroke-opacity="0.7" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="1.8" fill="${col}" opacity="0.7"/>
      <text x="${labelX.toFixed(1)}" y="${(ty - 3).toFixed(1)}" text-anchor="${labelAnchor}"
        font-size="${sz.calloutPctFontSize}" font-weight="700" font-family="var(--mono)" fill="${col}">${pctStr}%</text>
      ${label ? `<text x="${labelX.toFixed(1)}" y="${(ty + 9).toFixed(1)}" text-anchor="${labelAnchor}"
        font-size="${sz.calloutLabelFontSize}" font-family="var(--mono)" fill="${col}" opacity="0.7">${label}</text>` : ''}
    </g>`;
  });

  if (typeof centerSvgFn === 'function') svg += centerSvgFn(CX, CY, ri);

  svgEl.innerHTML = svg;

  // Auto-ajuste do texto central: mede a largura REAL renderizada (evita
  // depender de estimativa por nº de caracteres, que varia por fonte/
  // navegador) e encolhe a fonte proporcionalmente se ultrapassar o
  // espaço seguro dentro do furo do donut.
  svgEl.querySelectorAll('.dv-fit-text').forEach(t => {
    const maxW = parseFloat(t.dataset.maxWidth || '58');
    try {
      const len = t.getComputedTextLength();
      if (len > maxW) {
        const curSize = parseFloat(t.getAttribute('font-size')) || 16;
        t.setAttribute('font-size', Math.max(8, curSize * (maxW / len)).toFixed(1));
      }
    } catch (e) { /* getComputedTextLength pode falhar antes do layout — ignora */ }
  });

  svgEl.querySelectorAll(`.dvslice-${uid}`).forEach(path => {
    const col = path.dataset.col;
    const tip = decodeURIComponent(path.dataset.tip);
    const idx = path.dataset.idx;
    const allSlices   = svgEl.querySelectorAll(`.dvslice-${uid}`);
    const allCallouts = svgEl.querySelectorAll(`.dvcallout-${uid}`);
    path.addEventListener('mouseenter', e => {
      allSlices.forEach(s => s.classList.toggle('m-dimmed', s !== path));
      allCallouts.forEach(c => c.classList.toggle('m-dimmed', c.dataset.calloutIdx !== idx));
      _showTip(e, tip, col);
    });
    path.addEventListener('mousemove', _moveTip);
    path.addEventListener('mouseleave', () => {
      allSlices.forEach(s => s.classList.remove('m-dimmed'));
      allCallouts.forEach(c => c.classList.remove('m-dimmed'));
      _hideTip();
    });
  });
}

// ── Tooltip do gauge de Saúde (por nível: crítico/urgente/atenção/bom) ──
function _dgVgHealthTipHtml(lvl, n, total, meta) {
  const col   = { critico: '#f43f5e', urgente: '#f97316', atencao: '#f59e0b', bom: '#10b981' }[lvl];
  const label = { critico: 'CRÍTICO', urgente: 'URGENTE', atencao: 'ATENÇÃO', bom: 'BOM' }[lvl];
  const pct   = total > 0 ? Math.round(n / total * 100) : 0;
  const diff  = meta?.diff  || 0;
  const custo = meta?.custo || 0;
  const custoColor = diff < 0 ? '#f43f5e' : '#10b981';
  const custoLabel = diff < 0 ? 'Custo estimado (perda)' : 'Custo estimado (sobra)';
  return `<div style="display:flex;align-items:center;gap:7px;margin-bottom:8px">
      <span style="width:10px;height:10px;border-radius:3px;background:${col};display:inline-block;flex-shrink:0"></span>
      <span style="font-weight:700;font-size:13px;color:var(--text)">${label}</span>
      <span style="margin-left:auto;font-family:var(--mono);font-size:11px;color:${col};font-weight:700">${n} (${pct}%)</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;font-family:var(--mono);font-size:10.5px">
      <div style="color:var(--text3)">Variação total</div>
      <div style="font-weight:600">${varSymbol(diff)} ${fmtKgShort(Math.abs(diff))}</div>
      ${custo > 0 ? `<div style="color:var(--text3)">${custoLabel}</div><div style="color:${custoColor};font-weight:600">${money(custo)}</div>` : ''}
      <div style="color:var(--text3)">% do total</div>
      <div style="color:var(--text)">${pct}%</div>
    </div>`;
}

// ── Tooltip dos donuts de Custo Absoluto (por material) ──
function _dgVgMaterialTipHtml(label, value, pct, color) {
  return `<div style="display:flex;align-items:center;gap:7px;margin-bottom:6px">
      <span style="width:10px;height:10px;border-radius:3px;background:${color};display:inline-block;flex-shrink:0"></span>
      <span style="font-weight:700;font-size:12.5px;color:var(--text)">${escapeHtml(label)}</span>
    </div>
    <div style="font-family:var(--mono);font-size:11px;color:var(--text2)">
      ${money(value)} <span style="color:var(--text3)">(${pct}%)</span>
    </div>`;
}

// Agrupa pares (não-neutros) por nível para alimentar o tooltip do gauge:
// itemsByLevel (lista "mat — central") e levelMeta (diff/custo agregados).
function _dgVgBuildHealthDonutData(pares) {
  const levelMeta = { critico: { diff: 0, custo: 0 }, urgente: { diff: 0, custo: 0 }, atencao: { diff: 0, custo: 0 }, bom: { diff: 0, custo: 0 } };
  pares.forEach(p => {
    // Sem cadastro é excluído do donut de saúde (mesma exclusão do score) —
    // sem essa guarda, levelMeta['sem_cadastro'] é undefined e quebra aqui.
    if (!levelMeta[p.level]) return;
    levelMeta[p.level].diff  += p.diff;
    levelMeta[p.level].custo += Math.abs(p.custoImplicado);
  });
  return { levelMeta };
}

// svgId: id do <svg>. unitLabel: texto exibido sob o score (ex: "pares Central × Material", "centrais analisadas").
function _dgVgRenderHealthDonutSvg(svgId, counts, scoreInfo, levelMeta, unitLabel, subtitleId, summaryId) {
  const svgEl = document.getElementById(svgId);
  if (!svgEl) return;

  const total = counts.critico + counts.urgente + counts.atencao + counts.bom;
  const colorMap = { critico: '#f43f5e', urgente: '#f97316', atencao: '#f59e0b', bom: '#10b981' };
  const labelMap = { critico: 'CRÍTICO', urgente: 'URGENTE', atencao: 'ATENÇÃO', bom: 'BOM' };

  const slices = ['critico', 'urgente', 'atencao', 'bom'].filter(l => counts[l] > 0).map(l => ({
    value: counts[l], color: colorMap[l], label: labelMap[l],
    tipHtml: _dgVgHealthTipHtml(l, counts[l], total, levelMeta[l])
  }));

  const scoreColor = { bom: '#10b981', atencao: '#f59e0b', urgente: '#f97316', critico: '#f43f5e' }[scoreInfo.level] || '#10b981';
  const scoreLabelTxt = { bom: 'SAUDÁVEL', atencao: 'ATENÇÃO', urgente: 'URGENTE', critico: 'CRÍTICO' }[scoreInfo.level] || '';

  // A contagem (não redundante com o título do card) vai pro cabeçalho;
  // o nível de criticidade CONTINUA no centro do donut, junto da %.
  if (subtitleId) {
    const subEl = document.getElementById(subtitleId);
    if (subEl) subEl.textContent = `${total} ${unitLabel || ''}`.trim();
  }

  // Badges com a contagem por nível (Crítico/Urgente/Atenção/Bom) — mesmo
  // padrão visual do Dashboard Analítico (macro.js: _renderDonut, seção
  // "Summary badges"), pra manter os dois dashboards consistentes.
  if (summaryId) {
    const summEl = document.getElementById(summaryId);
    if (summEl) {
      summEl.innerHTML = ['critico', 'urgente', 'atencao', 'bom'].filter(l => counts[l] > 0).map(l => {
        const col = colorMap[l];
        return `<span style="
          display:inline-flex;align-items:center;gap:5px;
          background:${col}18;color:${col};
          border:1px solid ${col}35;
          padding:3px 10px;border-radius:5px;
          font-size:10px;font-weight:700;font-family:var(--mono);
          letter-spacing:.04em;white-space:nowrap;cursor:default">
          <span style="width:6px;height:6px;border-radius:50%;background:${col};display:inline-block;flex-shrink:0"></span>
          ${counts[l]} ${labelMap[l]}
        </span>`;
      }).join('');
    }
  }

  // Tamanho igual ao dos donuts do Dashboard Analítico (macro.js:
  // _renderDonut) — viewBox 420×300, R:104/ri:60, mesmos offsets de
  // callout, mesmas fontes de callout (12/9,5) e do texto central
  // (34/9). Posição Y do texto recalculada pra centralizar de verdade:
  // no Analítico o bloco central tem 3 linhas (score + nível + "N
  // centrais"), e as posições Y de lá foram pensadas pra esse bloco de
  // 3. Aqui a 3ª linha vai pro cabeçalho do card (não fica dentro do
  // donut), então com só 2 linhas nas MESMAS posições Y de lá, o bloco
  // sobrava espaço embaixo e ficava puxado pra cima — CY/CY+21 centraliza
  // o bloco de 2 linhas no anel.
  _dgVgDrawDonutSvg(svgEl, slices, (CX, CY, ri) => {
    const SR = ri - 8, sCirc = 2 * Math.PI * SR, sDash = (scoreInfo.score / 100) * sCirc;
    return `<circle cx="${CX}" cy="${CY}" r="${SR}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="5" style="pointer-events:none"/>
      <circle cx="${CX}" cy="${CY}" r="${SR}" fill="none" stroke="${scoreColor}" stroke-width="5"
        stroke-dasharray="${sDash.toFixed(1)} ${sCirc.toFixed(1)}" stroke-dashoffset="${(sCirc / 4).toFixed(1)}"
        stroke-linecap="round" opacity="0.55" style="pointer-events:none"/>
      <text class="dv-fit-text" data-max-width="92" x="${CX}" y="${CY + 4}" text-anchor="middle" font-size="34" font-weight="700" font-family="var(--mono)" fill="${scoreColor}" style="pointer-events:none">${scoreInfo.score}%</text>
      <text x="${CX}" y="${CY + 25}" text-anchor="middle" font-size="9" font-weight="700" font-family="var(--mono)" fill="${scoreColor}" letter-spacing=".07em" opacity="0.9" style="pointer-events:none">${scoreLabelTxt}</text>`;
  }, 6, { vbW: 420, vbH: 300, CX: 210, CY: 148, R: 104, ri: 60, calloutOffset: 22, elbowOffset: 44, tickLen: 22, calloutPctFontSize: 12, calloutLabelFontSize: 9.5 });
}

// ── Donut de Custo Absoluto (por material) — usado nas 4 categorias e no
//    combinado "Grupo de Material". items: [{ mat, total, color }]
// sizeOverride: mesmo mecanismo de _dgVgDrawDonutSvg — null usa o tamanho
// padrão (donuts de categoria); o combinado "Grupo de Material" passa um
// maior, porque o card dele é proporcionalmente mais alto que largo (ao
// contrário dos 4 pequenos, cujo card já bate certinho com o viewBox
// padrão) — sem isso, o anel ficava "sobrando" espaço vazio acima/abaixo
// dentro do card (letterboxing), parecendo pequeno demais pro tamanho do
// próprio card.
function _dgVgRenderCustoDonutSvg(svgId, items, centerTop, centerBottom, maxCallouts = 6, subtitleId, sizeOverride = null) {
  const svgEl = document.getElementById(svgId);
  if (!svgEl) return;

  const total = items.reduce((s, i) => s + i.total, 0);

  // Só a contagem de materiais vai pro subtítulo do cabeçalho — o rótulo
  // de categoria (ex: "AGREGADO") já está no título do card, seria redundante.
  if (subtitleId) {
    const subEl = document.getElementById(subtitleId);
    if (subEl) subEl.textContent = (!items.length || total <= 0) ? '' : (centerBottom || '');
  }

  if (!items.length || total <= 0) { _dgVgDrawDonutSvg(svgEl, [], null, maxCallouts, sizeOverride); return; }

  const slices = items.map(it => ({
    value: it.total, color: it.color,
    label: escapeHtml(it.mat.length > 11 ? it.mat.slice(0, 9) + '…' : it.mat),
    tipHtml: _dgVgMaterialTipHtml(it.mat, it.total, Math.round(it.total / total * 100), it.color)
  }));

  _dgVgDrawDonutSvg(svgEl, slices, (CX, CY, ri) => {
    const valStr = moneyShort(total);
    // Fonte proporcional ao raio interno (base: 17px pro ri:44 padrão) —
    // escala automaticamente pro tamanho maior do combinado, sem precisar
    // de mais um campo no sizeOverride.
    const fontSize = Math.round(17 * (ri / 44));
    return `<text class="dv-fit-text" data-max-width="${(2 * (ri - 8)).toFixed(0)}" x="${CX}" y="${CY + 6}" text-anchor="middle" font-size="${fontSize}" font-weight="700" font-family="var(--mono)" fill="var(--text)" style="pointer-events:none">${valStr}</text>`;
  }, maxCallouts, sizeOverride);
}

// ────────────────────────────────────────────
// ENTRADA — orquestra o render completo da Visão Geral
// ────────────────────────────────────────────
function renderDgVisaoGeralPdf(results, thresholds, dtIni, dtFim) {
  const topoEl = document.getElementById('dg-vg-kpis-hero');
  if (!topoEl) return; // HTML não presente (defensivo)

  if (!results.length) {
    const msg = '<div class="dg-empty-riscos"><i class="ti ti-database-off"></i><span>Sem dados no período.</span></div>';
    ['dg-vg-kpis-hero', 'dg-vg-extremos', 'dg-da-material', 'dg-da-rank-regional', 'dg-da-rank-central', 'dg-da-rank-material', 'dg-da-rank-categoria'].forEach(id => {
      const e = document.getElementById(id); if (e) e.innerHTML = msg;
    });
    ['categoria', 'chartRegional', 'chartUsina'].forEach(k => _dgVgDestroyChart(k));
    ['dg-vg-gauge-chart-svg', 'dg-vg-gauge-central-svg', 'dg-vg-chart-grupo', 'dg-vg-donut-agregado', 'dg-vg-donut-aglomerante', 'dg-vg-donut-aditivo', 'dg-vg-donut-adicao']
      .forEach(id => { const svgEl = document.getElementById(id); if (svgEl) svgEl.innerHTML = ''; });
    ['dg-vg-health-central-summary', 'dg-vg-health-materiais-summary']
      .forEach(id => { const e = document.getElementById(id); if (e) e.innerHTML = ''; });
    window._dgVgLastData = null;
    return;
  }

  const pares       = _dgVgBuildPares(results, thresholds, dtIni, dtFim);
  const counts      = _dgVgCounts(pares);
  const scoreInfo   = _dgVgScoreFromCounts(counts);

  const catFisica      = _dgVgVariacaoFisicaPorCategoria(pares);
  const catFisicaSplit = _dgVgVariacaoFisicaPorCategoriaSplit(pares);
  const volumePorCategoria = _dgVgVolumeMovimentadoPorCategoria(results);
  const catFisicaPct       = _dgVgVariacaoFisicaPercentualPorCategoria(catFisicaSplit, volumePorCategoria);
  const varTotalFisica = Object.values(catFisica).reduce((a, b) => a + b, 0);
  const custoTotal     = pares.reduce((s, p) => s + p.custoImplicado, 0);

  const porRegional = _dgVgAggPorChave(pares, p => p.regional);
  const porCentral  = _dgVgAggPorChave(pares, p => p.central);
  const porRegionalKg = _dgVgAggKgPorChave(pares, p => p.regional);
  const porCentralKg  = _dgVgAggKgPorChave(pares, p => p.central);
  const extRegional = _dgVgExtremos(porRegional, porRegionalKg);
  const extCentral  = _dgVgExtremos(porCentral, porCentralKg);

  const custoVarMap    = _dgVgCustoVariacaoPorMaterial(pares);
  const custoAbsPorCat = _dgVgAgruparCustoVariacaoPorCategoria(custoVarMap);

  const estTotais      = _dgVgEstoqueTotais(pares);
  const movTotais      = _dgVgMovimentacaoTotais(results);
  const custoMovTotais = _dgVgCustoMovimentacaoTotais(results);

  // Est. Teórico total (mesma conta do card "Variação Total" do KPI hero) —
  // usado tanto como denominador comum da % Variação de cada linha dos 4
  // rankings (_daBuildRanking) quanto, aqui, só como argumento formal pro
  // cálculo abaixo (que só precisa de Caminhões/Carretas/IBCs, não da %).
  const totalEstTeoricoKpi = estTotais.totalIni + movTotais.totalEnt - movTotais.totalSai;

  // Caminhões/Carretas/IBCs da empresa inteira, pro card "Variação" do KPI
  // hero — mesma metodologia (e mesmas funções) já usadas nos 4 rankings
  // do Detalhado Analítico: chamar _daBuildRanking com uma chave constante
  // agrupa TODOS os pares numa linha só, sem duplicar nenhum cálculo.
  const entradasFlatKpi = _daBuildEntradasFlat(results);
  const pesoMedioKpi     = _daPesoMedioPorTipo(entradasFlatKpi);
  const veiculosTotalKpi = _daBuildRanking(pares, pesoMedioKpi, () => 'total', totalEstTeoricoKpi).total;

  // Ajustes de Fechamento Mensal desconsiderados — agregados de todas as
  // centrais do período selecionado, para o badge/modal do card Variação.
  const sapFechExcluidosPeriodo = results.reduce((acc, r) => acc.concat(r.sapFechExcluidos || []), []);

  _dgVgRenderKpisHero(varTotalFisica, custoTotal, estTotais, movTotais, sapFechExcluidosPeriodo, custoMovTotais, veiculosTotalKpi);
  _dgVgRenderHealthDonuts(pares, counts, scoreInfo, thresholds);
  _dgVgRenderChartCategoriaFisica(catFisicaPct);
  _dgVgRenderExtremos(extRegional, extCentral);
  const entriesRegional = _dgVgTop8SobraDesfalque(porRegional);
  const entriesCentral  = _dgVgTop8SobraDesfalque(porCentral);

  _dgVgRenderChartCustoPorChave('dg-vg-chart-regional', entriesRegional, 'chartRegional');
  _dgVgRenderChartCustoPorChave('dg-vg-chart-usina',    entriesCentral,  'chartUsina');
  _dgVgRenderChartGrupoMaterial(custoAbsPorCat);
  DG_VG_CAT_ORDER.forEach(catKey => {
    _dgVgRenderDonutCategoria(`dg-vg-donut-${catKey}`, custoAbsPorCat[catKey] || [], catKey);
  });
  // Est. Teórico total já calculado mais acima (totalEstTeoricoKpi) —
  // reaproveitado aqui como denominador comum da % Variação de cada linha
  // dos 4 rankings (ver nota em _daBuildRanking).
  _daRenderDetalhadoAnalitico(results, pares, totalEstTeoricoKpi);

  // Cache de tudo o que já foi calculado nesta renderização — usado pelo
  // botão "Relatório Gerencial" (ver relatorio.js, função
  // gerarRelatorioGerencialDashboard) pra montar o PDF sem recalcular nada
  // e sem risco de os números do relatório divergirem do que está na tela.
  // Guarda também o necessário pras próximas fases do relatório (gráficos
  // de categoria/regional/central, custo por grupo, detalhado analítico),
  // pra não precisar tocar aqui de novo a cada fase. Invalidado (null) em
  // limparDashboardGerencial() e quando o período não tem dados, acima.
  window._dgVgLastData = {
    dtIni, dtFim, results, pares, counts, scoreInfo, thresholds,
    varTotalFisica, custoTotal, catFisicaPct,
    estTotais, movTotais, custoMovTotais, totalEstTeoricoKpi,
    extRegional, extCentral, entriesRegional, entriesCentral,
    custoAbsPorCat, veiculosTotalKpi, fechExcluidos: sapFechExcluidosPeriodo
  };
}

// ── 1. Resumo do Período: DOIS níveis — Variação Total + Custo Total
//    maiores, em cima (.inv-kpi-featured-row); Est. Inicial/Entradas/
//    Saídas/Est. Final Total menores, embaixo (.inv-kpi-secondary). Sem
//    o wrapper "Destaque do Período" (removido — não fazia sentido), mas
//    MANTENDO os 2 níveis de tamanho/agrupamento. Valores por extenso,
//    sem abreviação M/K (fmtKg/money em vez de fmtKgShort/moneyShort).
function _dgVgRenderKpisHero(varTotalFisica, custoTotal, estTotais, movTotais, fechExcluidos = [], custoMovTotais = {}, veiculos = {}) {
  const el = document.getElementById('dg-vg-kpis-hero');
  if (!el) return;

  const colorFor = v => v < -0.0001 ? 'var(--red)'    : v > 0.0001 ? 'var(--amber)'    : 'var(--teal)';
  const varCol = colorFor(varTotalFisica);
  const cstCol = colorFor(custoTotal);

  // Ícone remete a desfalque/sobra FÍSICA (caixa vazia vs. caixa cheia) e
  // desfalque/sobra MONETÁRIA (moeda única vs. pilha de moedas) — mesmo
  // critério de sinal usado em toda a Visão Geral (negativo=desfalque,
  // vermelho / positivo=sobra, âmbar), aplicado também na faixa de
  // destaque no topo do card, no estilo dos cards de resumo do período.
  const varIcon = varTotalFisica < -0.0001 ? 'ti-box-off' : varTotalFisica > 0.0001 ? 'ti-box'  : 'ti-scale';
  const cstIcon = custoTotal     < -0.0001 ? 'ti-coin'    : custoTotal     > 0.0001 ? 'ti-coins' : 'ti-currency-dollar';
  const featTopStyle = col => `border-top:3px solid ${col};border-top-left-radius:var(--radius-lg);border-top-right-radius:var(--radius-lg)`;

  // % da Variação sobre o Est. Teórico Total (Ini + Ent − Saí) — "o real
  // contra o esperado". Saídas aqui é movTotais.totalSai, que já vem em
  // magnitude positiva (ver _dgVgMovimentacaoTotais), por isso subtrai em
  // vez de somar. Base 0 → '—' em vez de dividir por zero (decisão: uma
  // "porcentagem sobre nada" não tem significado, não é 0%).
  const totalEstTeorico = estTotais.totalIni + movTotais.totalEnt - movTotais.totalSai;
  const pctVariacao = Math.abs(totalEstTeorico) > 0.0001 ? (varTotalFisica / totalEstTeorico) * 100 : null;

  // % do Custo Var. sobre o Custo Teórico Total — mesma convenção da %
  // física acima, só que com os totais de custo (custoIni do custo médio
  // do material; custoEnt/custoSai do valor real registrado no SAP).
  const custoEstTeorico = (estTotais.custoIni || 0) + (custoMovTotais.custoEnt || 0) - (custoMovTotais.custoSai || 0);
  const pctCusto = Math.abs(custoEstTeorico) > 0.0001 ? (custoTotal / custoEstTeorico) * 100 : null;

  // Evolução Estoque — Est. Final Total vs. Est. Inicial Total (kg/custo/%).
  // Diferente da Variação: aqui é a mudança BRUTA do saldo entre início e
  // fim do período, sem descontar entradas/saídas — mistura movimentação
  // real com desfalque/sobra. custoIni/custoFim já vêm calculados em
  // _dgVgEstoqueTotais (kg × custo médio do material).
  const kgEvolucao    = estTotais.totalFim - estTotais.totalIni;
  const custoEvolucao = (estTotais.custoFim || 0) - (estTotais.custoIni || 0);
  const pctEvolucao   = Math.abs(estTotais.totalIni) > 0.0001 ? (kgEvolucao / estTotais.totalIni) * 100 : null;
  const evoCol = colorFor(kgEvolucao);
  const evoIconCls = kgEvolucao < -0.0001 ? 'ti-trending-down' : kgEvolucao > 0.0001 ? 'ti-trending-up' : 'ti-minus';

  // Badge de Ajustes de Fechamento Mensal desconsiderados — guarda os
  // registros em variável global (evita serializar potencialmente
  // centenas de registros num atributo HTML) para o modal reaproveitável
  // (openFechModal, em ui.js) ler ao clicar. Compacto (ícone + contagem,
  // sem frase) e embutido na linha do rótulo do próprio card "Variação"
  // do KPI hero — ver .dg-fech-badge-compact em modules.css.
  window._dgVgFechExcluidosAtual = fechExcluidos;
  const fechBadgeCompactHtml = fechExcluidos.length
    ? `<button class="dg-fech-badge-compact" onclick="openFechModal(window._dgVgFechExcluidosAtual, 'Período selecionado')" title="${fechExcluidos.length} ajuste(s) de fechamento desconsiderado(s) neste período — clique para ver">
        <i class="ti ti-calendar-check"></i>${fechExcluidos.length}
      </button>`
    : '';

  // Caminhões/Carretas/IBCs — equivalente em veículos da variação física
  // total (mesma metodologia dos rankings do Detalhado Analítico: peso da
  // variação de cada categoria ÷ peso médio observado por entrega).
  // Ícone representa o tipo de veículo/contêiner de cada categoria:
  // Agregado→caminhão, Aglomerante→carreta, Aditivo+Adição→IBC.
  const veiculosRowHtml = `
    <div class="da-veiculos-row">
      <span class="da-veiculo-stat" style="color:${_daColorFor(veiculos.caminhoes)}" title="Caminhões — equivalente da variação de Agregado">
        <i class="ti ti-truck"></i>${_daFmtCountSigned(veiculos.caminhoes)}
      </span>
      <span class="da-veiculo-stat" style="color:${_daColorFor(veiculos.carretas)}" title="Carretas — equivalente da variação de Aglomerante">
        <i class="ti ti-container"></i>${_daFmtCountSigned(veiculos.carretas)}
      </span>
      <span class="da-veiculo-stat" style="color:${_daColorFor(veiculos.ibcs)}" title="IBCs — equivalente da variação de Aditivo + Adição">
        <i class="ti ti-box"></i>${_daFmtCountSigned(veiculos.ibcs)}
      </span>
    </div>`;

  // Magnitude do percentual, sem sinal — o sinal de sobra/desfalque já vem
  // do varSymbol() (ícone padrão do sistema), então não repetimos "+ "/"− "
  // em texto aqui (evita redundância símbolo + sinal).
  const pctAbsStr = p => Math.abs(p).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
  // Largura da barra de magnitude (0-100%, "cheia" a partir de 100% de
  // desvio) — só um indicador visual rápido de tamanho, não uma escala
  // precisa. null (sem Est./Custo Teórico pra comparar) vira barra vazia.
  const pctBarWidth = p => p === null ? 0 : Math.min(100, Math.abs(p));

  el.innerHTML = `
    <div class="inv-kpi-featured-row">
      <div class="inv-kpi-card inv-kpi-card-featured" style="${featTopStyle(varCol)}">
        <div class="inv-kpi-body">
          <div class="inv-kpi-label"><i class="ti ${varIcon}" style="color:${varCol}"></i>Variação${fechBadgeCompactHtml}</div>
          <div class="inv-kpi-value" style="color:${varCol}">${varSymbol(varTotalFisica)} ${fmtKg(Math.abs(varTotalFisica))}</div>
          <div class="inv-kpi-unit">kg bruto</div>
          ${veiculosRowHtml}
        </div>
        <div class="da-pct-zone">
          <div class="da-pct-value" style="color:${varCol}">${pctVariacao === null ? '—' : varSymbol(varTotalFisica) + ' ' + pctAbsStr(pctVariacao)}</div>
          <div class="da-pct-bar"><div class="da-pct-bar-fill" style="width:${pctBarWidth(pctVariacao)}%;background:${varCol}"></div></div>
          <div class="da-pct-caption">do Est. Teórico</div>
        </div>
      </div>
      <div class="inv-kpi-card inv-kpi-card-featured" style="${featTopStyle(cstCol)}">
        <div class="inv-kpi-body">
          <div class="inv-kpi-label"><i class="ti ${cstIcon}" style="color:${cstCol}"></i>Custo Var.</div>
          <div class="inv-kpi-value" style="color:${cstCol}">${varSymbol(custoTotal)} ${money(Math.abs(custoTotal))}</div>
          <div class="inv-kpi-unit">R$ bruto</div>
        </div>
        <div class="da-pct-zone">
          <div class="da-pct-value" style="color:${cstCol}">${pctCusto === null ? '—' : varSymbol(custoTotal) + ' ' + pctAbsStr(pctCusto)}</div>
          <div class="da-pct-bar"><div class="da-pct-bar-fill" style="width:${pctBarWidth(pctCusto)}%;background:${cstCol}"></div></div>
          <div class="da-pct-caption">do Custo Teórico</div>
        </div>
      </div>
    </div>
    <div class="inv-kpi-secondary">
      <div class="inv-kpi-card">
        <div class="inv-kpi-body">
          <div class="inv-kpi-label"><i class="ti ti-archive" style="color:var(--accent)"></i>Est. Inicial Total</div>
          <div class="inv-kpi-value">${money(estTotais.custoIni || 0)}</div>
          <div class="inv-kpi-unit">${fmtKg(estTotais.totalIni)}</div>
        </div>
      </div>
      <div class="inv-kpi-card">
        <div class="inv-kpi-body">
          <div class="inv-kpi-label"><i class="ti ti-arrow-bar-to-down" style="color:var(--green)"></i>Entradas</div>
          <div class="inv-kpi-value">${money(custoMovTotais.custoEnt || 0)}</div>
          <div class="inv-kpi-unit">${fmtKg(movTotais.totalEnt)}</div>
        </div>
      </div>
      <div class="inv-kpi-card">
        <div class="inv-kpi-body">
          <div class="inv-kpi-label"><i class="ti ti-arrow-bar-up" style="color:var(--red)"></i>Saídas</div>
          <div class="inv-kpi-value">${money(custoMovTotais.custoSai || 0)}</div>
          <div class="inv-kpi-unit">${fmtKg(movTotais.totalSai)}</div>
        </div>
      </div>
      <div class="inv-kpi-card">
        <div class="inv-kpi-body">
          <div class="inv-kpi-label"><i class="ti ti-box" style="color:var(--purple)"></i>Est. Final Total</div>
          <div class="inv-kpi-value">${money(estTotais.custoFim || 0)}</div>
          <div class="inv-kpi-unit">${fmtKg(estTotais.totalFim)}</div>
        </div>
      </div>
      <div class="inv-kpi-card">
        <div class="inv-kpi-body">
          <div class="inv-kpi-label"><i class="ti ${evoIconCls}" style="color:${evoCol}"></i>Evolução Estoque</div>
          <div class="inv-kpi-value" style="color:${evoCol}">${pctEvolucao === null ? '—' : varSymbol(kgEvolucao) + ' ' + pctAbsStr(pctEvolucao)}</div>
          <div class="inv-kpi-unit">${varSymbol(kgEvolucao)} ${money(Math.abs(custoEvolucao))}</div>
          <div class="inv-kpi-unit">${varSymbol(kgEvolucao)} ${fmtKg(Math.abs(kgEvolucao))}</div>
        </div>
      </div>
    </div>`;
}

// Abre modal listando os materiais sem cadastro da Visão Geral (Dashboard
// Gerencial) — mesmo padrão visual alert-modal-* já usado em
// ═══════════════════════════════════════════════════════════════════════
// MATERIAIS SEM CADASTRO — Entradas / Saídas / Lançamentos / SAP
// ═══════════════════════════════════════════════════════════════════════
// Mesmo princípio já aplicado em Materiais/Inventário/Analítico/Dashboard
// Gerencial: busca SEMPRE via materialOriginal (nunca material resolvido),
// contra o cadastro atual. Aqui, adicionalmente: botão pulsante no topo de
// cada tela de listagem bruta + selo "Sem cadastro" clicável na própria
// linha, consistente com o padrão alert-pulse-btn/dup-cad-badge já usado
// em todo o sistema.
const SEM_CADASTRO_MODULO_LABEL = {
  entradas: 'Entradas', saidas: 'Saídas', lancamentos: 'Lançamentos', sap: 'SAP'
};

// Lista de materiais sem cadastro (materialOriginal, texto exato, únicos)
// dentro de um módulo — varre o dataset COMPLETO (não só a página/filtro
// atual), mesmo critério de escopo já usado nos outros indicadores.
function getMateriaisSemCadastroDoModulo(modulo) {
  const set = new Set();
  (state[modulo] || []).forEach(r => {
    const raw = String(r.materialOriginal ?? '').trim();
    if (!raw) return;
    if (!getCatKeyDoCadastro(raw)) set.add(raw);
  });
  return [...set].sort();
}

// Renderiza o botão pulsante no container do módulo (chamado ao final de
// cada renderXxx() da lista bruta). Cacheia a lista em window para o modal
// reaproveitar sem recalcular.
function renderSemCadastroModuloBox(modulo) {
  const el = document.getElementById(`pend-cad-${modulo}-box`);
  if (!el) return;
  const lista = getMateriaisSemCadastroDoModulo(modulo);
  window[`__semCadLista_${modulo}`] = lista;

  if (!lista.length) {
    el.innerHTML = `
      <button type="button" class="alert-pulse-btn is-ok" disabled>
        <i class="ti ti-circle-check"></i> Materiais OK
      </button>`;
    return;
  }
  el.innerHTML = `
    <button type="button" class="alert-pulse-btn is-amber" onclick="abrirSemCadastroModuloModal('${modulo}')">
      <i class="ti ti-alert-triangle"></i>
      Há ${lista.length} ${lista.length === 1 ? 'material' : 'materiais'} sem cadastro
    </button>`;
}

function abrirSemCadastroModuloModal(modulo) {
  const lista = window[`__semCadLista_${modulo}`] || [];
  const label = SEM_CADASTRO_MODULO_LABEL[modulo] || modulo;
  const sub = `${lista.length} ${lista.length === 1 ? 'material' : 'materiais'} sem cadastro em ${label} — não contam em nenhuma análise/soma até serem cadastrados`;
  dgAbrirSemCadastroModalGenerico(`alert-modal-semcad-${modulo}`, lista, sub);
}
window.abrirSemCadastroModuloModal = abrirSemCadastroModuloModal;

// Selo "Sem cadastro" clicável, para uso inline na célula de Categoria
// (Entradas/Saídas/Lançamentos) ou junto ao Material (SAP, que não tem
// coluna Categoria). Mesmo visual do badge já usado em Inventário.
function semCadastroBadgeHtml(materialOriginal) {
  return `<span class="dup-cad-badge dup-cad-badge-morto" style="cursor:pointer" title="Material sem cadastro — clique para cadastrar" onclick="event.stopPropagation();analiticoCadastrarMaterial('${escapeHtml(materialOriginal)}', event)"><i class="ti ti-alert-triangle" style="font-size:9px"></i> Sem cadastro</span>`;
}

// Modal genérico de materiais sem cadastro — reaproveitado por qualquer
// painel que precise listar materiais excluídos por falta de cadastro,
// com atalho de cadastro rápido por item. Mesmo padrão visual
// alert-modal-* já usado em Conflitos/Inventário/Pendências/Analítico.
function dgAbrirSemCadastroModalGenerico(modalId, lista, subtitulo) {
  document.getElementById(modalId)?.remove();
  if (!lista || !lista.length) return;

  const rows = lista.map(m => `
    <div class="dup-cad-row">
      <span class="dup-cad-alias" title="${escapeHtml(m)}">${escapeHtml(m)}</span>
      <button class="btn-icon" type="button" title="Cadastrar agora" onclick="analiticoCadastrarMaterial('${escapeHtml(m)}', event)">
        <i class="ti ti-plus"></i>
      </button>
    </div>`).join('');

  const overlay = document.createElement('div');
  overlay.id = modalId;
  overlay.className = 'alert-modal-overlay';
  const _escDgSemCad = (e) => {
    if (!document.body.contains(overlay)) { document.removeEventListener('keydown', _escDgSemCad); return; }
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', _escDgSemCad); }
  };
  document.addEventListener('keydown', _escDgSemCad);
  overlay.innerHTML = `
    <div class="alert-modal-card">
      <div class="alert-modal-header">
        <div>
          <div class="alert-modal-title is-amber"><i class="ti ti-help-circle"></i> Materiais sem cadastro</div>
          <div class="alert-modal-sub">${subtitulo}</div>
        </div>
        <button class="alert-modal-close" onclick="document.getElementById('${modalId}').remove()"><i class="ti ti-x"></i></button>
      </div>
      <div class="alert-modal-body"><div class="dup-cad-group">${rows}</div></div>
    </div>`;
  document.body.appendChild(overlay);
}

// ── 3. Os dois donuts de saúde — réplica dos donuts "Materiais" e
//    "Centrais" do Dashboard Analítico, com o mesmo cálculo de percentual.
function _dgVgRenderHealthDonuts(pares, countsMat, scoreMat, thresholds) {
  const { levelMeta: levelMetaMat } = _dgVgBuildHealthDonutData(pares);
  _dgVgRenderHealthDonutSvg('dg-vg-gauge-chart-svg', countsMat, scoreMat, levelMetaMat, 'pares Central × Material', 'dg-vg-health-materiais-subtitle', 'dg-vg-health-materiais-summary');

  const { counts: countsCen, levelMeta: levelMetaCen, total: totalCen } = _dgVgBuildCentralHealthData(pares, thresholds);
  const scoreCen = _dgVgScoreFromCounts(countsCen);
  _dgVgRenderHealthDonutSvg('dg-vg-gauge-central-svg', countsCen, scoreCen, levelMetaCen, totalCen === 1 ? 'central analisada' : 'centrais analisadas', 'dg-vg-health-central-subtitle', 'dg-vg-health-central-summary');
}

function _dgVgRenderExtremos(extRegional, extCentral) {
  const el = document.getElementById('dg-vg-extremos');
  if (!el) return;

  const box = (label, ext) => {
    if (!ext) return `<div class="dg-vg-extremo-box dg-vg-extremo-empty">
      <span class="dg-vg-extremo-label">${label}</span>
      <span class="dg-vg-extremo-value">—</span>
      <span class="dg-vg-extremo-name">Sem dados no período</span>
    </div>`;
    const cls = ext.v < 0 ? 'dg-vg-extremo-neg' : 'dg-vg-extremo-pos';
    return `<div class="dg-vg-extremo-box ${cls}">
      <span class="dg-vg-extremo-label">${label}</span>
      <span class="dg-vg-extremo-value">${varSymbol(ext.v)} ${money(Math.abs(ext.v))}</span>
      <span class="dg-vg-extremo-kg">${varSymbol(ext.kg || 0)} ${fmtKg(Math.abs(ext.kg || 0))}</span>
      <span class="dg-vg-extremo-name" title="${escapeHtml(ext.k)}">${escapeHtml(ext.k)}</span>
    </div>`;
  };

  el.innerHTML =
    box('Regional · Maior Desfalque', extRegional.min && extRegional.min.v < 0 ? extRegional.min : null) +
    box('Regional · Maior Sobra',     extRegional.max && extRegional.max.v > 0 ? extRegional.max : null) +
    box('Central · Maior Desfalque',  extCentral.min  && extCentral.min.v  < 0 ? extCentral.min  : null) +
    box('Central · Maior Sobra',      extCentral.max  && extCentral.max.v  > 0 ? extCentral.max  : null);
}

// Plugin customizado (sem dependência externa — mantém o app 100%
// client-side/offline) que escreve o valor de cada barra logo fora da
// ponta dela. O comprimento da barra reflete o percentual (dataset.data),
// mas o rótulo mostra o kg real (dataset.kgValues, array paralelo) — é o
// kg que importa pra ação, o percentual é só pra dar tamanho justo à
// barra entre categorias de porte muito diferente.
const _dgVgBarValueLabelsPlugin = {
  id: 'dgVgBarValueLabels',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const fontSize = chart.options.plugins?.dgVgBarValueLabels?.fontSize || 10;
    chart.data.datasets.forEach((dataset, dsIndex) => {
      const meta = chart.getDatasetMeta(dsIndex);
      if (meta.hidden) return;
      meta.data.forEach((bar, i) => {
        const pctValue = dataset.data[i];
        const kgValue  = (dataset.kgValues && dataset.kgValues[i]) || 0;
        if (!pctValue || !kgValue) return; // sem barra, sem rótulo
        const { x, y, base } = bar.getProps(['x', 'y', 'base'], true);
        const negative = pctValue < 0;
        const texto = fmtKgShort(Math.abs(kgValue));
        ctx.save();
        ctx.font = `600 ${fontSize}px 'DM Mono', monospace`;
        ctx.textBaseline = 'middle';

        // SEMPRE prefere desenhar DENTRO da barra quando ela tiver espaço
        // pro texto — o texto fica então inteiramente contido dentro dos
        // próprios limites da barra (base↔x), sem depender em nada da
        // posição do rótulo do eixo Y (à esquerda) nem da coluna Δ
        // desenhada por outro plugin (à direita). Isso elimina de vez o
        // risco de colidir com qualquer um dos dois, pra qualquer
        // combinação de dados/fonte. Só cai pra fora (comportamento
        // antigo) quando a própria barra é curta demais pro texto caber
        // dentro dela — nesse caso a barra também está longe das bordas
        // (é a categoria menos grave), então sobra espaço de sobra fora.
        const largura = ctx.measureText(texto).width;
        const larguraBarra = Math.abs(base - x);
        const MARGEM = 14;
        const desenharDentro = larguraBarra >= largura + MARGEM;

        if (desenharDentro) {
          ctx.fillStyle = '#fff';
          ctx.textAlign = negative ? 'left' : 'right';
          ctx.fillText(texto, x + (negative ? 6 : -6), y);
        } else {
          ctx.fillStyle = negative ? '#f43f5e' : '#f59e0b';
          ctx.textAlign = negative ? 'right' : 'left';
          ctx.fillText(texto, x + (negative ? -6 : 6), y);
        }
        ctx.restore();
      });
    });
  }
};

// Segundo plugin: desenha o total líquido (Δ = desfalque + sobra) de cada
// categoria numa coluna fixa à direita do gráfico — sempre na mesma
// posição X, alinhado pela linha (posição Y) de cada categoria via
// chart.scales.y. Ficou numa coluna fixa em vez de embutido no nome da
// categoria (eixo Y) porque nomes de tamanhos diferentes (Adição vs.
// Aglomerante) desalinhavam visualmente as duas linhas empilhadas.
const _dgVgCategoryTotalsPlugin = {
  id: 'dgVgCategoryTotals',
  afterDatasetsDraw(chart) {
    const totals = chart.options.plugins?.dgVgCategoryTotals?.totals;
    if (!totals || !totals.length) return;
    const fontSize = chart.options.plugins?.dgVgCategoryTotals?.fontSize || 10;
    const { ctx, width } = chart;
    ctx.save();
    ctx.font = `600 ${fontSize}px 'DM Mono', monospace`;
    ctx.fillStyle = '#7b85a0';
    ctx.textBaseline = 'middle';
    // Ancorado pela BORDA DIREITA do canvas (textAlign:'right', x fixo
    // perto do fim), não por um X fixo à esquerda crescendo pra direita
    // (versão anterior) — dessa forma o texto NUNCA passa da borda do
    // canvas, não importa o tamanho (ex.: "Δ +123,6 K kg" cortado com
    // fonte maior). O texto cresce "pra dentro" a partir da borda.
    ctx.textAlign = 'right';
    totals.forEach((totalKg, i) => {
      const y = chart.scales.y.getPixelForTick(i);
      if (y == null) return;
      const sign = totalKg > 0.0001 ? '+' : '';
      ctx.fillText(`Δ ${sign}${fmtKgShort(totalKg)}`, width - 8, y);
    });
    ctx.restore();
  }
};

function _dgVgRenderChartCategoriaFisica(catFisicaPct) {
  const ctx = document.getElementById('dg-vg-chart-categoria');
  if (!ctx) return;
  _dgVgDestroyChart('categoria');
  const { textCol, gridCol, tickFont } = _dgVgTheme();

  // Reordena as categorias da pior pra melhor — "pior" = maior desvio
  // percentual total (|desfalque%| + |sobra%|, somados) sobre o volume
  // da própria categoria. A categoria com o problema proporcionalmente
  // mais grave sempre aparece no topo do gráfico, não importa a ordem
  // fixa de DG_VG_CAT_ORDER.
  const catOrdenadaPorSeveridade = [...DG_VG_CAT_ORDER].sort((a, b) => {
    const sevA = Math.abs(catFisicaPct[a]?.desfalquePct || 0) + Math.abs(catFisicaPct[a]?.sobraPct || 0);
    const sevB = Math.abs(catFisicaPct[b]?.desfalquePct || 0) + Math.abs(catFisicaPct[b]?.sobraPct || 0);
    return sevB - sevA;
  });

  const labels        = catOrdenadaPorSeveridade.map(k => DG_VG_CAT_LABELS[k]);
  const desfalquesPct = catOrdenadaPorSeveridade.map(k => catFisicaPct[k]?.desfalquePct || 0);
  const sobrasPct     = catOrdenadaPorSeveridade.map(k => catFisicaPct[k]?.sobraPct || 0);
  const desfalquesKg  = catOrdenadaPorSeveridade.map(k => catFisicaPct[k]?.desfalqueKg || 0);
  const sobrasKg      = catOrdenadaPorSeveridade.map(k => catFisicaPct[k]?.sobraKg || 0);
  // Total líquido por categoria (desfalque + sobra, em kg) — vira a
  // coluna fixa "Δ" à direita do gráfico (ver _dgVgCategoryTotalsPlugin).
  const totaisKg      = catOrdenadaPorSeveridade.map((_, i) => desfalquesKg[i] + sobrasKg[i]);
  const fmtPct        = v => Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';

  _dgVgCharts.categoria = new Chart(ctx, {
    type: 'bar',
    plugins: [_dgVgBarValueLabelsPlugin, _dgVgCategoryTotalsPlugin],
    data: {
      labels,
      datasets: [
        { label: 'Desfalque', data: desfalquesPct, kgValues: desfalquesKg, backgroundColor: '#f43f5e', borderRadius: 3, borderSkipped: false, stack: 'variacao' },
        { label: 'Sobra',     data: sobrasPct,     kgValues: sobrasKg,     backgroundColor: '#f59e0b', borderRadius: 3, borderSkipped: false, stack: 'variacao' }
      ]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      layout: { padding: { left: 46, right: 118 } },
      plugins: {
        legend: {
          display: true, position: 'top', align: 'end',
          labels: { color: textCol, font: tickFont, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rect' }
        },
        tooltip: {
          callbacks: {
            label: c => {
              const kgValue = (c.dataset.kgValues && c.dataset.kgValues[c.dataIndex]) || 0;
              return `${c.dataset.label} · ${fmtPct(c.raw)} do volume movimentado · ${fmtKgShort(Math.abs(kgValue))}`;
            }
          }
        },
        dgVgCategoryTotals: { totals: totaisKg, fontSize: 10 },
        dgVgBarValueLabels: { fontSize: 10 }
      },
      scales: {
        x: { stacked: true, grace: '15%', grid: { color: gridCol }, ticks: { color: textCol, font: tickFont, callback: v => fmtPct(v) } },
        y: {
          stacked: true, grid: { display: false },
          ticks: { color: textCol, font: { ...tickFont, size: 11.5 } }
        }
      }
    }
  });
}

// Seleciona no máximo 4 maiores sobras + 4 maiores desfalques (top 8 total),
// ordenados de forma decrescente para exibição (maior sobra → maior desfalque),
// igual ao padrão do PDF de referência.
function _dgVgTop8SobraDesfalque(map) {
  const entries = [...map.entries()].sort((a, b) => b[1] - a[1]);
  if (entries.length <= 8) return entries;
  const top4Sobra     = entries.slice(0, 4);
  const top4Desfalque = entries.slice(-4);
  const dedup = new Map([...top4Sobra, ...top4Desfalque]); // evita duplicar se houver sobreposição
  return [...dedup.entries()].sort((a, b) => b[1] - a[1]);
}

// entries: array [ [label, valor], ... ] já ordenado como deve aparecer no eixo X.
function _dgVgRenderChartCustoPorChave(canvasId, entries, chartKey) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  _dgVgDestroyChart(chartKey);
  const { textCol, gridCol, tickFont } = _dgVgTheme();

  const inner = ctx.parentElement; // .dg-vg-bar-inner — sempre ocupa 100% do card, sem scroll horizontal

  if (!entries.length) {
    if (inner) inner.style.width = '100%';
    const c2d = ctx.getContext('2d');
    c2d.clearRect(0, 0, ctx.width, ctx.height);
    c2d.fillStyle = textCol;
    c2d.font = "11px 'DM Mono', monospace";
    c2d.textAlign = 'center';
    c2d.fillText('Sem dados no período.', ctx.width / 2, 40);
    return;
  }

  if (inner) inner.style.width = '100%';

  const labels = entries.map(([k]) => k);
  const data   = entries.map(([, v]) => v);
  const colors = data.map(v => v < -0.0001 ? '#f43f5e' : v > 0.0001 ? '#f59e0b' : '#6b7280');

  _dgVgCharts[chartKey] = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 3, borderSkipped: false }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => `${varLabel(c.raw)} · ${money(Math.abs(c.raw))}` } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: textCol, font: { ...tickFont, size: 9.5 }, maxRotation: 55, minRotation: 35, autoSkip: false } },
        y: { grid: { color: gridCol }, ticks: { color: textCol, font: tickFont, callback: v => moneyShort(v) } }
      }
    }
  });
}

// Agrupa itens com participação abaixo do limite (padrão 5%) numa única
// fatia "Outros" — evita poluir o donut com fatias minúsculas demais para
// ter um callout ou até mesmo um clique confiável. O total geral não muda:
// "Outros" apenas absorve visualmente a soma dos pequenos.
function _dgVgAgruparOutros(items, threshold = 0.05) {
  const totalGeral = items.reduce((s, it) => s + it.total, 0);
  if (totalGeral <= 0) return items;

  const grandes  = items.filter(it => it.total / totalGeral >= threshold);
  const pequenos = items.filter(it => it.total / totalGeral <  threshold);
  if (!pequenos.length) return items;

  const somaPequenos = pequenos.reduce((s, it) => s + it.total, 0);
  return [...grandes, { mat: 'Outros', total: somaPequenos, catKey: null, color: '#6b7280' }]
    .sort((a, b) => b.total - a.total);
}

function _dgVgRenderChartGrupoMaterial(custoAbsPorCat) {
  const flatRaw = [];
  DG_VG_CAT_ORDER.forEach(catKey => {
    const arr = custoAbsPorCat[catKey] || [];
    arr.forEach((item, i) => {
      const factor = arr.length > 1 ? (i / (arr.length - 1)) * 0.6 - 0.2 : 0;
      flatRaw.push({ mat: item.mat, total: item.total, catKey, color: _dgVgShade(DG_VG_CAT_COLORS[catKey], factor) });
    });
  });
  flatRaw.sort((a, b) => b.total - a.total);

  // Tamanho maior que os 4 donuts de categoria e que os gauges de Saúde
  // Geral (R:104, ver _dgVgRenderHealthDonutSvg) — mas moderadamente maior,
  // não discrepante como antes (era R:115 contra categorias em R:74; agora
  // as categorias sobem pro mesmo R:104 da Saúde Geral, então o hero só
  // precisa de uma folga pequena pra continuar lendo como "o principal").
  // vbW/vbH/CX/CY continuam os mesmos: o card do hero é proporcionalmente
  // mais alto que largo (ocupa a altura inteira da grade 2×2 ao lado), e
  // esse viewBox 440×361 já bate certo com essa proporção — só R/ri e os
  // offsets de callout (que dependem de R) encolheram.
  const sizeOverrideGrupo = {
    vbW: 440, vbH: 361, CX: 220, CY: 180, R: 100, ri: 59,
    calloutOffset: 16, elbowOffset: 33, tickLen: 17,
    calloutPctFontSize: 11, calloutLabelFontSize: 9
  };

  if (!flatRaw.length) {
    _dgVgRenderCustoDonutSvg('dg-vg-chart-grupo', [], null, null, 6, 'dg-vg-grupo-subtitle', sizeOverrideGrupo);
    return;
  }

  // Materiais com menos de 5% de participação no total viram uma única
  // fatia "Outros" — evita poluir o anel com dezenas de fatias minúsculas.
  const flat = _dgVgAgruparOutros(flatRaw);
  _dgVgRenderCustoDonutSvg('dg-vg-chart-grupo', flat, 'CUSTO VARIAÇÃO', `${flatRaw.length} materiais`, 6, 'dg-vg-grupo-subtitle', sizeOverrideGrupo);
}

function _dgVgRenderDonutCategoria(svgId, items, catKey) {
  const subtitleId = `${svgId}-subtitle`;
  // Mesmo tamanho dos donuts de Saúde Geral (ver _dgVgRenderHealthDonutSvg)
  // — antes usavam o tamanho padrão de _dgVgDrawDonutSvg (R:74), bem menor
  // que os outros donuts da página, o que deixava a grade 2×2 desproporcional
  // perto do hero "Grupo de Material" e da própria Saúde Geral.
  const sizeOverrideCategoria = { vbW: 420, vbH: 300, CX: 210, CY: 148, R: 104, ri: 60, calloutOffset: 22, elbowOffset: 44, tickLen: 22, calloutPctFontSize: 12, calloutLabelFontSize: 9.5 };
  if (!items.length) {
    _dgVgRenderCustoDonutSvg(svgId, [], null, null, 3, subtitleId, sizeOverrideCategoria);
    return;
  }

  const baseColor = DG_VG_CAT_COLORS[catKey] || '#64748b';
  const flatRaw = items.map((it, i) => ({
    mat: it.mat, total: it.total,
    color: _dgVgShade(baseColor, items.length > 1 ? (i / (items.length - 1)) * 0.6 - 0.2 : 0)
  }));

  // Mesmo agrupamento em "Outros" usado no donut combinado, para materiais
  // com menos de 5% de participação dentro da categoria.
  const flat = _dgVgAgruparOutros(flatRaw);
  _dgVgRenderCustoDonutSvg(svgId, flat, (DG_VG_CAT_LABELS[catKey] || '').toUpperCase(), `${items.length} materiais`, 3, subtitleId, sizeOverrideCategoria);
}

// ────────────────────────────────────────────
// DETALHADO ANALÍTICO — última seção da Visão Geral: tabela de
// detalhamento por material (Grupo SAP) + 4 rankings (Regional, Central,
// Material, Categoria). Reaproveita 100% os "pares" (Central×Material) já
// construídos por _dgVgBuildPares — nenhum recálculo de estoque/variação/
// custo, só agregação em cima do que já existe.
//
// Caminhões/Carretas/IBCs — metodologia confirmada com o Hugo (jul/2026):
// peso total de ENTRADAS SAP (cód. 101/801) da categoria, dividido pelo
// peso médio observado por entrega da MESMA categoria — mesmo princípio
// já usado em agregados.js (Controle de Corte, _avgTruckWeight), mas aqui
// o peso médio é calculado uma única vez, GLOBALMENTE, sobre TODO o
// período/todas as centrais (não recalculado por regional/central/
// material) — decisão deliberada: garante que a coluna seja aditiva (a
// soma das linhas bate com o total geral), já que "Total = soma" foi a
// escolha confirmada pro rodapé dessas colunas.
//   • Agregado              → "Caminhões"
//   • Aglomerante           → "Carretas"
//   • Aditivo + Adição      → "IBCs"
// ────────────────────────────────────────────

// Lista achatada de entradas SAP (só cód. 101/801, peso > 0, com cadastro
// válido) já marcadas com regional/central/material/categoria/"tipo"
// (caminhoes/carretas/ibcs) — fonte única reaproveitada tanto pro peso
// médio global quanto pelas somas por escopo de cada ranking.
function _daBuildEntradasFlat(results) {
  const filIdx = getFilialLookupIndex();
  const flat = [];
  results.forEach(r => {
    const filRec   = filIdx.exact.get(normalizeText(r.central));
    const regional = (filRec?.regional || '').trim() || '—';
    (r.sapNoPeriodo || []).forEach(s => {
      const cod = normMov(s.movimento);
      if (!CODIGOS_ENTRADA.has(cod)) return;
      const peso = num(s.peso);
      if (peso <= 0) return;
      const mat = s.material || '—';
      const catKey = (r.materialCatKeyMap && r.materialCatKeyMap.get(mat)) || null;
      if (!catKey) return; // sem cadastro — mesmo critério do resto da Visão Geral
      const tipo = catKey === 'agregado'    ? 'caminhoes'
                 : catKey === 'aglomerante' ? 'carretas'
                 : (catKey === 'aditivo' || catKey === 'adicao') ? 'ibcs'
                 : null;
      if (!tipo) return;
      flat.push({ regional, central: r.central, mat, catKey, tipo, peso });
    });
  });
  return flat;
}

// Peso médio global de UMA entrega, por tipo (caminhões/carretas/IBCs) —
// calculado uma vez sobre TODO o período/todas as centrais (ver nota de
// metodologia acima).
function _daPesoMedioPorTipo(entradasFlat) {
  const acc = { caminhoes: { soma: 0, n: 0 }, carretas: { soma: 0, n: 0 }, ibcs: { soma: 0, n: 0 } };
  entradasFlat.forEach(e => { const a = acc[e.tipo]; if (a) { a.soma += e.peso; a.n++; } });
  return {
    caminhoes: acc.caminhoes.n ? acc.caminhoes.soma / acc.caminhoes.n : 0,
    carretas:  acc.carretas.n  ? acc.carretas.soma  / acc.carretas.n  : 0,
    ibcs:      acc.ibcs.n      ? acc.ibcs.soma      / acc.ibcs.n      : 0,
  };
}

// ── 1. Detalhamento por Material (Grupo SAP) ──────────────────────────
// Uma linha por material, agregando TODAS as centrais do período — mesmo
// nível de resumo já usado em "Custo Médio por Material" (aba Custos),
// com o detalhamento completo de estoque/variação/custo por cima.
// "Sem variação relevante" — mesmo critério já usado no Inventário
// (_invVarIrrelevante, ±0.01 kg, arredondado pra 2 casas pra evitar ruído
// de ponto flutuante). Sem essa tolerância, uma variação praticamente nula
// dividida por um Est. Teórico também pequeno gerava percentuais
// instáveis/absurdos (ex: 100%) mesmo quando, na prática, não houve
// variação real — daí a % ser forçada a 0 nesse caso, independente do
// tamanho do denominador. Reimplementada localmente (em vez de reusar
// window._inv_helpers.varIrrelevante) pra não criar dependência de o
// módulo Inventário já ter sido inicializado.
function _daVarIrrelevante(kg) {
  return Math.round(Math.abs(kg) * 100) / 100 <= 0.01;
}

function _daBuildTabelaMaterial(pares) {
  const map = new Map(); // mat -> acumulador
  pares.forEach(p => {
    if (!map.has(p.mat)) map.set(p.mat, {
      mat: p.mat, catKey: p.catKey, catSubKey: p.catSubKey,
      estIni: 0, entKg: 0, saiKg: 0, estFim: 0, custoAjuste: 0,
      somaValorPond: 0, somaPesoPond: 0
    });
    const m = map.get(p.mat);
    m.estIni      += p.estoqueIni || 0;
    m.entKg       += p.entKg || 0;
    m.saiKg       += p.saiKg || 0;
    m.estFim      += p.estoqueFim || 0;
    m.custoAjuste += p.custoImplicado || 0;
    // Custo médio ponderado — pondera pelo peso de Saídas SAP do material naquela central,
    // fallback 1 quando não há saída (evita descartar o custo médio de
    // materiais sem consumo no período).
    const peso = p.saiKg || 1;
    m.somaValorPond += (p.custoMed || 0) * peso;
    m.somaPesoPond  += peso;
  });

  const linhas = [...map.values()].map(m => {
    const estTeorico  = m.estIni + m.entKg - m.saiKg;
    const custoMedio  = m.somaPesoPond > 0 ? m.somaValorPond / m.somaPesoPond : 0;
    const diffTotal   = m.estFim - estTeorico;
    const pctVariacao = _daVarIrrelevante(diffTotal) ? 0
                       : (Math.abs(estTeorico) > 0.0001 ? (diffTotal / estTeorico) * 100 : null);
    return { ...m, estTeorico, custoMedio, pctVariacao };
  }).sort((a, b) => a.custoAjuste - b.custoAjuste); // maior desfalque (mais negativo) primeiro

  // Linha de total — Est Inicial/Entradas/Saídas/Est Final são SOMADOS
  // normalmente (são aditivos de verdade). Est Teórico do Total é
  // RECALCULADO a partir dessas somas (Ini+Ent-Sai), e a % Variação do
  // Total é recalculada em cima do Est Teórico e Est Final somados — nunca
  // é a soma nem a média das % de cada linha (percentual não é aditivo).
  // Custo Médio também é recalculado (ponderado), pelo mesmo motivo.
  const totEstIni = linhas.reduce((s, l) => s + l.estIni, 0);
  const totEntKg  = linhas.reduce((s, l) => s + l.entKg, 0);
  const totSaiKg  = linhas.reduce((s, l) => s + l.saiKg, 0);
  const totEstFim = linhas.reduce((s, l) => s + l.estFim, 0);
  const totAjuste = linhas.reduce((s, l) => s + l.custoAjuste, 0);
  const totEstTeorico    = totEstIni + totEntKg - totSaiKg;
  const totDiff           = totEstFim - totEstTeorico;
  const totPctVariacao    = _daVarIrrelevante(totDiff) ? 0
                           : (Math.abs(totEstTeorico) > 0.0001 ? (totDiff / totEstTeorico) * 100 : null);
  const totSomaPondValor  = linhas.reduce((s, l) => s + (l.somaValorPond || 0), 0);
  const totSomaPondPeso   = linhas.reduce((s, l) => s + (l.somaPesoPond || 0), 0);
  const totCustoMedio     = totSomaPondPeso > 0 ? totSomaPondValor / totSomaPondPeso : 0;

  return {
    linhas,
    total: {
      estIni: totEstIni, entKg: totEntKg, saiKg: totSaiKg,
      estTeorico: totEstTeorico, estFim: totEstFim,
      pctVariacao: totPctVariacao, custoMedio: totCustoMedio, custoAjuste: totAjuste
    }
  };
}


// ── 2-5. Rankings (Regional / Central / Material / Categoria) ─────────
// Função genérica reaproveitada pelos 4 rankings — só muda a chave de
// agrupamento (keyFn) e, opcionalmente, o rótulo de exibição (labelFn,
// usado pra Categoria e pra "Sem regional").
//
// % Variação (ajuste confirmado com o Hugo, jul/2026): cada linha passa a
// representar a REPRESENTATIVIDADE daquele escopo na variação TOTAL do
// período, não mais a variação percentual local do próprio escopo. Ou
// seja: % da linha = diff do escopo (Est.Final - Est.Teórico DO ESCOPO) /
// Est.Teórico TOTAL do período (totalEstTeoricoKpi, mesmo denominador do
// card "Variação Total" do KPI hero, recebido como parâmetro) — o mesmo
// denominador em TODAS as linhas, nunca o Est.Teórico individual de cada
// escopo. É essa igualdade de denominador que garante, por construção
// matemática (decomposição linear), que a SOMA das % de todas as linhas
// reproduza EXATAMENTE a % do card do topo — por isso o Total volta a ser
// a soma literal das linhas (não uma reconta separada).
//
// Caminhões/Carretas/IBCs (ajuste confirmado com o Hugo, jul/2026): a base
// passou a ser a VARIAÇÃO (diff) do escopo, não mais o total de entradas
// SAP do período — usar o total de entradas gerava números irreais (ex:
// "500 caminhões" mesmo com variação baixa), já que não tinha relação
// nenhuma com o tamanho do desfalque/sobra. Dentro de cada tipo
// (Agregado→Caminhões / Aglomerante→Carretas / Aditivo+Adição→IBCs), o
// diff é somado COM SINAL (soma líquida — sobra e desfalque do mesmo tipo
// se cancelam) — e o resultado final MANTÉM o sinal (positivo = sobra,
// negativo = desfalque), sem Math.abs(): é a formatação
// (_daFmtCountSigned) que cuida do símbolo/cor, não o cálculo.
function _daBuildRanking(pares, pesoMedio, keyFn, totalEstTeoricoKpi, labelFn) {
  const map = new Map(); // key -> acumulador
  pares.forEach(p => {
    const k = keyFn(p);
    if (k === null || k === undefined || k === '') return;
    if (!map.has(k)) map.set(k, {
      key: k, estIni: 0, entKg: 0, saiKg: 0, estFim: 0, custoTotal: 0,
      caminhoesDiffKg: 0, carretasDiffKg: 0, ibcsDiffKg: 0
    });
    const m = map.get(k);
    m.estIni     += p.estoqueIni || 0;
    m.entKg      += p.entKg || 0;
    m.saiKg      += p.saiKg || 0;
    m.estFim     += p.estoqueFim || 0;
    m.custoTotal += p.custoImplicado || 0;

    const tipoField = p.catKey === 'agregado'    ? 'caminhoesDiffKg'
                     : p.catKey === 'aglomerante' ? 'carretasDiffKg'
                     : (p.catKey === 'aditivo' || p.catKey === 'adicao') ? 'ibcsDiffKg'
                     : null;
    if (tipoField) m[tipoField] += p.diff || 0;
  });

  const linhas = [...map.values()].map(m => {
    const estTeorico = m.estIni + m.entKg - m.saiKg; // teórico DO ESCOPO — só pra achar o diff do escopo
    const diff        = m.estFim - estTeorico;         // desfalque/sobra em kg DO ESCOPO
    return {
      nome: labelFn ? labelFn(m.key) : m.key,
      caminhoes: pesoMedio.caminhoes ? m.caminhoesDiffKg / pesoMedio.caminhoes : 0,
      carretas:  pesoMedio.carretas  ? m.carretasDiffKg  / pesoMedio.carretas  : 0,
      ibcs:      pesoMedio.ibcs      ? m.ibcsDiffKg      / pesoMedio.ibcs      : 0,
      // % = fatia desse escopo na variação total — denominador é o
      // Est.Teórico TOTAL do período, igual em toda linha.
      pctVariacao: _daVarIrrelevante(diff) ? 0
                 : (Math.abs(totalEstTeoricoKpi) > 0.0001 ? (diff / totalEstTeoricoKpi) * 100 : null),
      custoTotal: m.custoTotal
    };
  }).sort((a, b) => a.custoTotal - b.custoTotal); // maior desfalque primeiro

  // Linha de total — Caminhões/Carretas/IBCs/Custo continuam soma literal
  // (aditivos de verdade). % Variação também volta a ser soma literal das
  // linhas: como todas usam o mesmo denominador (totalEstTeoricoKpi), essa
  // soma reproduz exatamente a % Variação Total do KPI hero.
  const total = linhas.reduce((t, l) => ({
    caminhoes:   t.caminhoes   + (l.caminhoes   || 0),
    carretas:    t.carretas    + (l.carretas    || 0),
    ibcs:        t.ibcs        + (l.ibcs        || 0),
    pctVariacao: t.pctVariacao + (l.pctVariacao || 0),
    custoTotal:  t.custoTotal  + (l.custoTotal  || 0)
  }), { caminhoes: 0, carretas: 0, ibcs: 0, pctVariacao: 0, custoTotal: 0 });

  return { linhas, total };
}

// ── Helpers de formatação/cor — mesmo padrão de sinal (varSymbol) e cor
//    (vermelho=desfalque, âmbar=sobra) já padronizado no resto da Visão
//    Geral nesta conversa. ──
function _daColorFor(v) {
  return v < -0.0001 ? 'var(--red)' : v > 0.0001 ? 'var(--amber)' : 'var(--text3)';
}
function _daFmtPctSigned(pct) {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return '—';
  return `${varSymbol(pct)} ${Math.abs(pct).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}
function _daFmtMoneySigned(v) {
  return `${varSymbol(v)} ${money(Math.abs(v))}`;
}
function _daFmtCountSigned(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${varSymbol(n)} ${Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
}

// ── Render: 1. Tabela de Detalhamento por Material ─────────────────────
function _daRenderTabelaMaterial(containerId, dados) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!dados.linhas.length) {
    el.innerHTML = '<div class="dg-empty-riscos"><i class="ti ti-database-off"></i><span>Sem dados no período.</span></div>';
    return;
  }
  const rowsHtml = dados.linhas.map(l => `
    <tr>
      <td>
        <span class="da-mat-name">${escapeHtml(l.mat)}</span>
        ${l.catKey ? `<span class="da-mat-cat">${escapeHtml(DG_VG_CATSUB_LABELS[l.catSubKey] || DG_VG_CAT_LABELS[l.catKey] || l.catKey)}</span>` : ''}
      </td>
      <td class="da-num" style="color:var(--teal)">${fmtKg(l.estIni)}</td>
      <td class="da-num" style="color:var(--green)">${fmtKg(l.entKg)}</td>
      <td class="da-num" style="color:var(--red)">${fmtKg(l.saiKg)}</td>
      <td class="da-num" style="color:var(--teal)">${fmtKg(l.estTeorico)}</td>
      <td class="da-num" style="color:var(--teal)">${fmtKg(l.estFim)}</td>
      <td class="da-num" style="color:${_daColorFor(l.pctVariacao)}">${_daFmtPctSigned(l.pctVariacao)}</td>
      <td class="da-num">${money(l.custoMedio)}/kg</td>
      <td class="da-num" style="color:${_daColorFor(l.custoAjuste)}">${_daFmtMoneySigned(l.custoAjuste)}</td>
    </tr>`).join('');

  const t = dados.total;
  const totalHtml = `
    <tr class="da-total-row">
      <td>Total</td>
      <td class="da-num" style="color:var(--teal)">${fmtKg(t.estIni)}</td>
      <td class="da-num" style="color:var(--green)">${fmtKg(t.entKg)}</td>
      <td class="da-num" style="color:var(--red)">${fmtKg(t.saiKg)}</td>
      <td class="da-num" style="color:var(--teal)">${fmtKg(t.estTeorico)}</td>
      <td class="da-num" style="color:var(--teal)">${fmtKg(t.estFim)}</td>
      <td class="da-num" style="color:${_daColorFor(t.pctVariacao)}">${_daFmtPctSigned(t.pctVariacao)}</td>
      <td class="da-num">${money(t.custoMedio)}/kg</td>
      <td class="da-num" style="color:${_daColorFor(t.custoAjuste)}">${_daFmtMoneySigned(t.custoAjuste)}</td>
    </tr>`;

  el.innerHTML = `
    <div class="da-table-wrap">
      <table class="da-table">
        <thead>
          <tr>
            <th>Grupo SAP</th>
            <th class="da-num">Est. Inicial</th>
            <th class="da-num">Entradas</th>
            <th class="da-num">Saídas</th>
            <th class="da-num">Est. Teórico</th>
            <th class="da-num">Est. Final</th>
            <th class="da-num">% Variação</th>
            <th class="da-num">Custo Médio</th>
            <th class="da-num">Custo Ajuste</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot>${totalHtml}</tfoot>
      </table>
    </div>`;
}

// Qual das 3 colunas (Caminhões/Carretas/IBCs) teve o MAIOR impacto
// (maior valor absoluto) nessa linha — usado só pra destacar visualmente
// a célula correspondente no ranking. Em empate, ou quando as 3 são ~0,
// não destaca nenhuma (destacar uma das empatadas seria arbitrário).
function _daMaiorImpacto(l) {
  const abs = {
    caminhoes: Math.abs(l.caminhoes || 0),
    carretas:  Math.abs(l.carretas  || 0),
    ibcs:      Math.abs(l.ibcs      || 0)
  };
  const max = Math.max(abs.caminhoes, abs.carretas, abs.ibcs);
  if (max <= 0.0001) return null;
  const empatados = Object.keys(abs).filter(k => Math.abs(abs[k] - max) <= 0.0001);
  return empatados.length === 1 ? empatados[0] : null;
}

// ── Render: 2-5. Rankings (mesma estrutura de colunas nos 4) ───────────
function _daRenderRanking(containerId, dados, colNomeLabel) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!dados.linhas.length) {
    el.innerHTML = '<div class="dg-empty-riscos"><i class="ti ti-database-off"></i><span>Sem dados no período.</span></div>';
    return;
  }
  const rowsHtml = dados.linhas.map(l => {
    const imp = _daMaiorImpacto(l);
    const cell = (campo, valor) => imp === campo
      ? `<span class="da-impacto">${_daFmtCountSigned(valor)}</span>`
      : _daFmtCountSigned(valor);
    return `
    <tr>
      <td>${escapeHtml(l.nome)}</td>
      <td class="da-num" style="color:${_daColorFor(l.caminhoes)}">${cell('caminhoes', l.caminhoes)}</td>
      <td class="da-num" style="color:${_daColorFor(l.carretas)}">${cell('carretas', l.carretas)}</td>
      <td class="da-num" style="color:${_daColorFor(l.ibcs)}">${cell('ibcs', l.ibcs)}</td>
      <td class="da-num" style="color:${_daColorFor(l.pctVariacao)}">${_daFmtPctSigned(l.pctVariacao)}</td>
      <td class="da-num" style="color:${_daColorFor(l.custoTotal)}">${_daFmtMoneySigned(l.custoTotal)}</td>
    </tr>`;
  }).join('');

  const t = dados.total;
  const totalHtml = `
    <tr class="da-total-row">
      <td>Total</td>
      <td class="da-num" style="color:${_daColorFor(t.caminhoes)}">${_daFmtCountSigned(t.caminhoes)}</td>
      <td class="da-num" style="color:${_daColorFor(t.carretas)}">${_daFmtCountSigned(t.carretas)}</td>
      <td class="da-num" style="color:${_daColorFor(t.ibcs)}">${_daFmtCountSigned(t.ibcs)}</td>
      <td class="da-num" style="color:${_daColorFor(t.pctVariacao)}">${_daFmtPctSigned(t.pctVariacao)}</td>
      <td class="da-num" style="color:${_daColorFor(t.custoTotal)}">${_daFmtMoneySigned(t.custoTotal)}</td>
    </tr>`;

  el.innerHTML = `
    <div class="da-table-wrap">
      <table class="da-table">
        <thead>
          <tr>
            <th>${escapeHtml(colNomeLabel)}</th>
            <th class="da-num">Caminhões</th>
            <th class="da-num">Carretas</th>
            <th class="da-num">IBCs</th>
            <th class="da-num">Variação</th>
            <th class="da-num">Custo Total</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot>${totalHtml}</tfoot>
      </table>
    </div>`;
}

// ── Entrada — orquestra o Detalhado Analítico inteiro (1 tabela + 4 rankings) ──
// totalEstTeoricoKpi: Est. Teórico total do período (mesma conta do KPI
// hero) — denominador comum usado pela % Variação nos 4 rankings.
function _daRenderDetalhadoAnalitico(results, pares, totalEstTeoricoKpi) {
  const el = document.getElementById('dg-da-material');
  if (!el) return; // HTML não presente (defensivo)

  const ids = ['dg-da-material', 'dg-da-rank-regional', 'dg-da-rank-central', 'dg-da-rank-material', 'dg-da-rank-categoria'];
  if (!results.length) {
    ids.forEach(id => {
      const e = document.getElementById(id);
      if (e) e.innerHTML = '<div class="dg-empty-riscos"><i class="ti ti-database-off"></i><span>Sem dados no período.</span></div>';
    });
    return;
  }

  const entradasFlat = _daBuildEntradasFlat(results);
  const pesoMedio     = _daPesoMedioPorTipo(entradasFlat);

  _daRenderTabelaMaterial('dg-da-material', _daBuildTabelaMaterial(pares));

  const rankRegional  = _daBuildRanking(pares, pesoMedio, p => p.regional, totalEstTeoricoKpi, k => k === '—' ? 'Sem regional' : k);
  const rankCentral   = _daBuildRanking(pares, pesoMedio, p => p.central,  totalEstTeoricoKpi);
  const rankMaterial  = _daBuildRanking(pares, pesoMedio, p => p.mat,      totalEstTeoricoKpi);
  // Categoria: Agregado é dividido em Graúdo/Miúdo (catSubKey) — as outras
  // 3 categorias (Aglomerante/Aditivo/Adição) continuam agrupadas normal,
  // por catKey. "agregado_sem_subcategoria" é um fallback defensivo (não
  // deve ocorrer na prática: o cadastro exige Graúdo ou Miúdo explícito
  // pra qualquer material marcado como Agregado).
  const rankCategoria = _daBuildRanking(
    pares, pesoMedio,
    p => p.catKey === 'agregado' ? (p.catSubKey || 'agregado_sem_subcategoria') : p.catKey,
    totalEstTeoricoKpi,
    k => DG_VG_CATSUB_LABELS[k] || DG_VG_CAT_LABELS[k] || (k === 'agregado_sem_subcategoria' ? 'Agregado (sem subcategoria)' : k)
  );

  _daRenderRanking('dg-da-rank-regional',  rankRegional,  'Regional');
  _daRenderRanking('dg-da-rank-central',   rankCentral,   'Central');
  _daRenderRanking('dg-da-rank-material',  rankMaterial,  'Material');
  _daRenderRanking('dg-da-rank-categoria', rankCategoria, 'Categoria');
}

// ────────────────────────────────────────────
// 5 & 6. GIRO DE ESTOQUE
// ────────────────────────────────────────────
function renderDgGiro(results, dtIni, dtFim) {
  const kpiEl = document.getElementById('dg-giro-kpi-inner');
  if (!kpiEl) return;

  // Cabeçalho do modal de detalhe (padrão "Detalhamento do Material") — central(is) + período
  const _dgGiroSubEl = document.getElementById('dg-giro-modal-sub');
  if (_dgGiroSubEl) {
    const nCentrais = results.length;
    const periodoLabel = (dtIni && dtFim) ? `${fmtPtDate(dtIni)} a ${fmtPtDate(dtFim)}` : 'período analisado';
    _dgGiroSubEl.textContent = `${nCentrais} ${nCentrais !== 1 ? 'centrais' : 'central'} · ${periodoLabel}`;
  }

  // Alvos no DOM: aba Materiais/Centrais do modal de detalhe + blocos condensados na Visão Geral
  const _dgGiroTargets = [
    'dg-giro-central-body', 'dg-giro-mat-todos-body',
    'dg-vg-giro-central-alto-body', 'dg-vg-giro-central-baixo-body',
    'dg-vg-giro-mat-alto-body', 'dg-vg-giro-mat-baixo-body'
  ];

  if (!results.length) {
    kpiEl.innerHTML = '<div class="dg-empty-riscos" style="padding:12px 0"><i class="ti ti-database-off"></i><span>Sem dados.</span></div>';
    _dgGiroTargets.forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = '<div class="dg-empty-riscos"><i class="ti ti-database-off"></i><span>Sem dados.</span></div>'; });
    return;
  }

  // Aggregate giro across all centrals
  let totalSaidasKg = 0;
  let totalEstMedioKg = 0;
  const matGiroMap = new Map(); // mat → { saidas, estMedio }

  const now = new Date();
  const dias30 = 30;
  const cutoff30 = new Date(now); cutoff30.setDate(now.getDate() - dias30);

  let totalSaidas30 = 0;
  let totalEstMedio30 = 0;

  results.forEach(r => {
    const lancsByMat = new Map();
    const sapByMat   = new Map();
    r.lancsNoPeriodo.forEach(l => { const m=l.material||'—'; if(!lancsByMat.has(m)) lancsByMat.set(m,[]); lancsByMat.get(m).push(l); });
    r.sapNoPeriodo.forEach(s => { const m=s.material||'—'; if(!sapByMat.has(m)) sapByMat.set(m,[]); sapByMat.get(m).push(s); });

    r.allMats.forEach(mat => {
      const lancs = lancsByMat.get(mat)||[];
      const sap   = sapByMat.get(mat)||[];
      const snap  = buildSnapshot({ lancs, sap });

      const saidas    = Math.abs(snap.totalSai);
      const estMedio  = (snap.pesoIni + snap.pesoFim) / 2;

      totalSaidasKg  += saidas;
      totalEstMedioKg += estMedio;

      // 30-day saídas
      const sap30 = sap.filter(s => {
        const d = parseDate(s.dtLanc);
        return d && d >= cutoff30;
      });
      const saidas30 = sap30.filter(s=>num(s.peso)<0).reduce((a,s)=>a+Math.abs(num(s.peso)),0);
      totalSaidas30  += saidas30;
      totalEstMedio30 += estMedio;

      // Per material
      if (!matGiroMap.has(mat)) matGiroMap.set(mat, { saidas:0, estMedio:0 });
      const mg = matGiroMap.get(mat);
      mg.saidas  += saidas;
      mg.estMedio += estMedio;
      mg.entradas  = (mg.entradas||0) + snap.totalEnt;
    });
  });

  const giroGeral = totalEstMedioKg > 0 ? totalSaidasKg / totalEstMedioKg : 0;
  const giro30    = totalEstMedio30  > 0 ? totalSaidas30  / totalEstMedio30  : 0;
  // Estimate period length from data
  const periodoEstimado = results.length > 0 ? (() => {
    let minDate = null, maxDate = null;
    results.forEach(r => {
      r.lancsNoPeriodo.forEach(l => {
        const d = parseDate(l.dtLanc);
        if (!d) return;
        if (!minDate || d < minDate) minDate = d;
        if (!maxDate || d > maxDate) maxDate = d;
      });
    });
    if (!minDate || !maxDate) return 30;
    return Math.max(1, Math.round((maxDate-minDate)/86400000) + 1);
  })() : 30;
  const giroDia = periodoEstimado > 0 ? giroGeral / periodoEstimado : 0;

  // ── Thresholds calibrados para concreteira ──────────────
  function classificarGiro(g) {
    if (g > 4.0)  return { cls:'muito-alto', label:'Muito Alto — Risco Ruptura' };
    if (g >= 2.0) return { cls:'alto',        label:'Alto — Operação Enxuta' };
    if (g >= 1.0) return { cls:'normal',      label:'Saudável' };
    if (g >= 0.5) return { cls:'baixo',       label:'Baixo — Atenção Excesso' };
    if (g >= 0.2) return { cls:'muito-baixo', label:'Muito Baixo — Estoque Elevado' };
    return { cls:'parado', label:'Parado — Capital Imobilizado' };
  }

  // Cobertura média geral (dias) = (Est.Médio / totalSaídas) × periodoEstimado
  const coberturaGeral = totalSaidasKg > 0
    ? (totalEstMedioKg / totalSaidasKg) * periodoEstimado
    : null;

  function coberturaClass(dias) {
    if (dias === null || dias === undefined) return 'neutro';
    if (dias < 5)   return 'critico';
    if (dias < 10)  return 'urgente';
    if (dias < 20)  return 'ok';
    if (dias <= 40) return 'atencao';
    return 'excesso';
  }
  function coberturaLabel(dias) {
    if (dias === null) return '—';
    if (dias < 5)   return 'Crítico';
    if (dias < 10)  return 'Urgente';
    if (dias < 20)  return 'Saudável';
    if (dias <= 40) return 'Atenção';
    return 'Excesso';
  }
  const { cls, label } = classificarGiro(giroGeral);

  const giroValColor = { 'muito-alto':'c-red', 'alto':'c-green', 'normal':'c-teal', 'baixo':'c-amber', 'muito-baixo':'c-amber', 'parado':'c-red' }[cls] || '';

  // Cobertura: cor neutra informativa — sem semáforo consolidado
  // (thresholds fazem sentido por material, não por média de todos os materiais)
  kpiEl.innerHTML = `
    <div class="analitico-detail-summary" style="margin-bottom:0;width:100%">
      <div class="analitico-detail-card">
        <div class="analitico-detail-card-label"><i class="ti ti-calendar-time" style="font-size:11px;margin-right:4px"></i>Cobertura Média <span class="macro-help-badge" data-help="giro-cobertura-media">?</span></div>
        <div class="analitico-detail-card-value c-teal">${coberturaGeral !== null ? coberturaGeral.toFixed(1) + 'd' : '—'}</div>
        <div class="analitico-detail-card-sub">Est.Médio ÷ consumo diário</div>
      </div>
      <div class="analitico-detail-card">
        <div class="analitico-detail-card-label">Giro Geral <span class="macro-help-badge" data-help="giro-geral">?</span></div>
        <div class="analitico-detail-card-value ${giroValColor}">${giroGeral.toFixed(2)}×</div>
        <div class="analitico-detail-card-sub">${label}</div>
      </div>
      <div class="analitico-detail-card">
        <div class="analitico-detail-card-label">Giro 30 dias <span class="macro-help-badge" data-help="giro-30dias">?</span></div>
        <div class="analitico-detail-card-value">${giro30.toFixed(2)}×</div>
        <div class="analitico-detail-card-sub">Est. Médio: ${fmtKgShort(totalEstMedioKg)}</div>
      </div>
      <div class="analitico-detail-card">
        <div class="analitico-detail-card-label">Período · Saídas Totais <span class="macro-help-badge" data-help="giro-periodo-saidas">?</span></div>
        <div class="analitico-detail-card-value" style="font-size:16px">${periodoEstimado}d <span style="font-size:12.5px;color:var(--text2);font-weight:600">${fmtKgShort(totalSaidasKg)}</span></div>
        <div class="analitico-detail-card-sub">dias analisados · consumo total</div>
      </div>
    </div>`;

  // ── Cálculo agregado por Central (Giro, Cobertura, Entradas, Saídas, Est.Médio) ──
  const centralArr = results.map(r => {
    const lancsByMat = new Map();
    const sapByMat   = new Map();
    r.lancsNoPeriodo.forEach(l => { const m=l.material||'—'; if(!lancsByMat.has(m)) lancsByMat.set(m,[]); lancsByMat.get(m).push(l); });
    r.sapNoPeriodo.forEach(s => { const m=s.material||'—'; if(!sapByMat.has(m)) sapByMat.set(m,[]); sapByMat.get(m).push(s); });

    let saidasTotal = 0, estMedioTotal = 0, entradasTotal = 0;
    r.allMats.forEach(mat => {
      const snap = buildSnapshot({ lancs: lancsByMat.get(mat)||[], sap: sapByMat.get(mat)||[] });
      saidasTotal   += Math.abs(snap.totalSai);
      estMedioTotal += (snap.pesoIni + snap.pesoFim) / 2;
      entradasTotal += snap.totalEnt;
    });

    const giro      = estMedioTotal > 0 ? saidasTotal / estMedioTotal : 0;
    const cobertura = saidasTotal > 0 ? (estMedioTotal / saidasTotal) * periodoEstimado : null;
    return { name: r.central, giro, cobertura, saidas: saidasTotal, entradas: entradasTotal, estMedio: estMedioTotal };
  });

  // ── Cálculo agregado por Material (Giro, Cobertura, Entradas, Saídas, Est.Médio) ──
  const matArr = [...matGiroMap.entries()].map(([mat, d]) => ({
    name: mat,
    giro: d.estMedio > 0 ? d.saidas / d.estMedio : 0,
    saidas: d.saidas,
    entradas: d.entradas||0,
    estMedio: d.estMedio,
    cobertura: d.saidas > 0 ? (d.estMedio / d.saidas) * periodoEstimado : null,
  })).filter(m => m.estMedio > 0); // só materiais com estoque real

  // ── Nível de criticidade combinado — correlaciona Cobertura + Giro +
  //    Abastecimento num único nível (bom/atenção/urgente/crítico). Usa o
  //    PIOR dos 3 eixos como base (o elo mais fraco decide o risco geral),
  //    com reforço de +1 quando 2 ou mais eixos já estão ruins ao mesmo
  //    tempo (problema correlacionado, não isolado num único indicador).
  function _giroNivelPontos(item) {
    let pCob;
    if (item.cobertura === null)   pCob = 3; // sem consumo — pode ser capital parado, tratado como sinal máximo
    else if (item.cobertura < 5)   pCob = 3;
    else if (item.cobertura < 10)  pCob = 2;
    else if (item.cobertura < 20)  pCob = 0;
    else if (item.cobertura <= 40) pCob = 1;
    else                            pCob = 2; // excesso — capital parado

    let pGiro;
    if (item.giro > 4.0)       pGiro = 3;
    else if (item.giro >= 2.0) pGiro = 1;
    else if (item.giro >= 1.0) pGiro = 0;
    else if (item.giro >= 0.5) pGiro = 1;
    else if (item.giro >= 0.2) pGiro = 2;
    else                        pGiro = 3;

    let pAbast = null;
    if (!(item.saidas < 0.001 && item.entradas < 0.001)) {
      if (item.saidas < 0.001) {
        pAbast = 2; // entradas sem consumo — acúmulo
      } else {
        const ratio = (item.entradas / item.saidas) * 100;
        pAbast = item.giro >= 1
          ? (ratio >= 100 ? 0 : ratio >= 80 ? 1 : 3)
          : (ratio > 150 ? 2 : ratio >= 100 ? 1 : ratio >= 80 ? 0 : 2);
      }
    }

    const eixos = [pCob, pGiro, pAbast].filter(p => p !== null);
    const pior  = Math.max(...eixos);
    const ruins = eixos.filter(p => p >= 2).length;
    return Math.min(3, pior + (ruins >= 2 ? 1 : 0));
  }

  const _NIVEL_DEFS = [
    { level: 'bom',     label: 'Bom',     style: 'background:var(--green-bg);color:var(--green);border:1px solid var(--green-border)' },
    { level: 'atencao', label: 'Atenção', style: 'background:var(--amber-bg);color:var(--amber);border:1px solid var(--amber-border)' },
    { level: 'urgente', label: 'Urgente', style: 'background:rgba(249,115,22,0.10);color:#f97316;border:1px solid rgba(249,115,22,0.22)' },
    { level: 'critico', label: 'Crítico', style: 'background:var(--red-bg);color:var(--red);border:1px solid var(--red-border)' },
  ];
  function _giroNivelInfo(item) {
    const pontos = _giroNivelPontos(item);
    return { pontos, ..._NIVEL_DEFS[pontos] };
  }
  centralArr.forEach(c => { c.nivel = _giroNivelInfo(c); });
  matArr.forEach(m => { m.nivel = _giroNivelInfo(m); });

  // ── Helpers visuais compartilhados — Central e Material usam exatamente o mesmo padrão visual ──
  function giroColor(g) {
    if (g > 4.0)  return 'var(--red)';
    if (g >= 2.0) return 'var(--green)';
    if (g >= 1.0) return 'var(--teal)';
    if (g >= 0.5) return 'var(--amber)';
    if (g >= 0.2) return '#f97316';
    return 'var(--red)';
  }

  function giroTag(g) {
    if (g > 4.0)  return { label:'Muito Alto',   style:'background:var(--red-bg);color:var(--red);border:1px solid var(--red-border)' };
    if (g >= 2.0) return { label:'Alto',          style:'background:var(--green-bg);color:var(--green);border:1px solid var(--green-border)' };
    if (g >= 1.0) return { label:'Saudável',      style:'background:var(--teal-bg);color:var(--teal);border:1px solid var(--teal-border)' };
    if (g >= 0.5) return { label:'Baixo',         style:'background:var(--amber-bg);color:var(--amber);border:1px solid var(--amber-border)' };
    if (g >= 0.2) return { label:'Muito Baixo',   style:'background:rgba(249,115,22,0.10);color:#f97316;border:1px solid rgba(249,115,22,0.22)' };
    return { label:'Parado', style:'background:var(--red-bg);color:var(--red);border:1px solid var(--red-border)' };
  }

  function buildCoberturaCell(dias) {
    if (dias === null) {
      return `<span style="font-size:11px;font-family:var(--mono);color:var(--text3);text-align:center">sem consumo</span>`;
    }
    const d = dias.toFixed(1);
    if (dias < 5)   return `<span class="dg-giro-abast risk"    title="Crítico — menos de 5 dias de cobertura"><i class="ti ti-flame" style="font-size:10px"></i> ${d}d</span>`;
    if (dias < 10)  return `<span class="dg-giro-abast warn"    title="Urgente — 5 a 10 dias de cobertura"><i class="ti ti-alert-triangle" style="font-size:10px"></i> ${d}d</span>`;
    if (dias < 20)  return `<span class="dg-giro-abast ok"      title="Saudável — 10 a 20 dias de cobertura"><i class="ti ti-circle-check" style="font-size:10px"></i> ${d}d</span>`;
    if (dias <= 40) return `<span class="dg-giro-abast warn"    title="Atenção — 20 a 40 dias, possível excesso"><i class="ti ti-clock" style="font-size:10px"></i> ${d}d</span>`;
    return              `<span class="dg-giro-abast excess"  title="Excesso — mais de 40 dias parado"><i class="ti ti-lock" style="font-size:10px"></i> ${d}d</span>`;
  }

  function buildAbastCell(entradas, saidas, panel) {
    // panel: 'alto' (alto giro — risco de ruptura) ou 'baixo' (baixo giro — capital parado)
    if (saidas < 0.001 && entradas < 0.001) {
      return `<span class="dg-giro-abast neutral" title="Sem movimentação">—</span>`;
    }
    if (saidas < 0.001) {
      return `<span class="dg-giro-abast excess" title="Entradas sem consumo registrado">↑ acúmulo</span>`;
    }
    const ratio = (entradas / saidas) * 100;
    const ratioLabel = ratio.toFixed(0) + '%';
    if (panel === 'alto') {
      if (ratio >= 100) return `<span class="dg-giro-abast ok"    title="Abastecimento cobre o consumo (${ratioLabel})"><i class="ti ti-circle-check" style="font-size:10px"></i> ${ratioLabel}</span>`;
      if (ratio >= 80)  return `<span class="dg-giro-abast warn"  title="Abastecimento próximo do limite (${ratioLabel})"><i class="ti ti-alert-triangle" style="font-size:10px"></i> ${ratioLabel}</span>`;
      return             `<span class="dg-giro-abast risk"  title="Risco de ruptura — abastecimento insuficiente (${ratioLabel})"><i class="ti ti-flame" style="font-size:10px"></i> ${ratioLabel}</span>`;
    } else {
      if (ratio > 150) return `<span class="dg-giro-abast excess"  title="Excesso de abastecimento — capital imobilizado (${ratioLabel})"><i class="ti ti-currency-dollar" style="font-size:10px"></i> ${ratioLabel}</span>`;
      if (ratio >= 100) return `<span class="dg-giro-abast warn"   title="Abastecimento acima do consumo (${ratioLabel})"><i class="ti ti-arrow-up" style="font-size:10px"></i> ${ratioLabel}</span>`;
      if (ratio >= 80)  return `<span class="dg-giro-abast ok"     title="Abastecimento equilibrado (${ratioLabel})"><i class="ti ti-equal" style="font-size:10px"></i> ${ratioLabel}</span>`;
      return             `<span class="dg-giro-abast risk"   title="Consumo supera o abastecimento (${ratioLabel})"><i class="ti ti-trending-down" style="font-size:10px"></i> ${ratioLabel}</span>`;
    }
  }

  function buildGiroHead(nameLabel) {
    const withBadge = (label, helpKey, align) => `
      <span style="text-align:${align};display:inline-flex;align-items:center;gap:3px;${align === 'right' ? 'justify-content:flex-end' : align === 'center' ? 'justify-content:center' : ''}">
        ${label}<span class="macro-help-badge" data-help="${helpKey}" style="width:12px;height:12px;font-size:8px">?</span>
      </span>`;
    return `
    <div class="dg-giro-mat-head-row">
      <span>${nameLabel}</span>
      ${withBadge('Nível', 'giro-tabela-nivel', 'center')}
      ${withBadge('Cobertura', 'giro-tabela-cobertura', 'center')}
      ${withBadge('Giro×', 'giro-tabela-giro', 'right')}
      <span style="text-align:right">Entradas</span>
      <span style="text-align:right">Saídas</span>
      <span style="text-align:right">Est.Médio</span>
      ${withBadge('Abast.', 'giro-tabela-abast', 'center')}
    </div>`;
  }

  function buildGiroRow(item, panel) {
    const col = giroColor(item.giro);
    const tag = giroTag(item.giro);
    const nv  = item.nivel || _giroNivelInfo(item);
    return `<div class="dg-giro-mat-row" title="Nível: ${nv.label} — correlaciona Cobertura, Giro e Abastecimento&#10;Cobertura: ${item.cobertura !== null ? item.cobertura.toFixed(1)+'d' : '—'}&#10;Giro: ${item.giro.toFixed(4)}× — ${tag.label}&#10;Entradas: ${fmtKg(item.entradas)}&#10;Saídas: ${fmtKg(item.saidas)}&#10;Est.Médio: ${fmtKg(item.estMedio)}">
      <span class="dg-giro-mat-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
      <span class="dg-giro-abast" style="${nv.style}">${nv.label}</span>
      ${buildCoberturaCell(item.cobertura)}
      <span class="dg-giro-mat-num" style="color:${col};text-align:right">${item.giro.toFixed(2)}×</span>
      <span class="dg-giro-mat-num" style="color:var(--green)" title="${fmtKg(item.entradas)}">${fmtKgShort(item.entradas)}</span>
      <span class="dg-giro-mat-num" style="color:var(--red)" title="${fmtKg(item.saidas)}">${fmtKgShort(item.saidas)}</span>
      <span class="dg-giro-mat-num" style="color:var(--text2)" title="${fmtKg(item.estMedio)}">${fmtKgShort(item.estMedio)}</span>
      ${buildAbastCell(item.entradas, item.saidas, panel)}
    </div>`;
  }

  function buildBaixoFooter(arr) {
    const parados   = arr.filter(m => m.giro < 0.1).length;
    const baixoGiro = arr.filter(m => m.giro >= 0.1 && m.giro < 1).length;
    const estTotal  = arr.reduce((s, m) => s + m.estMedio, 0);
    return `
      <div style="display:flex;gap:12px;padding:10px 0 2px;border-top:1px solid var(--border);margin-top:8px;flex-wrap:wrap">
        <span style="font-size:10.5px;font-family:var(--mono);color:var(--red);display:flex;align-items:center;gap:5px">
          <i class="ti ti-lock" style="font-size:12px"></i> ${parados} parado${parados!==1?'s':''}
        </span>
        <span style="font-size:10.5px;font-family:var(--mono);color:var(--amber);display:flex;align-items:center;gap:5px">
          <i class="ti ti-alert-triangle" style="font-size:12px"></i> ${baixoGiro} baixo giro
        </span>
        <span style="font-size:10.5px;font-family:var(--mono);color:var(--text3);margin-left:auto" title="${fmtKg(estTotal)}">
          Est. total parado: ${fmtKgShort(estTotal)}
        </span>
      </div>`;
  }

  function renderPanel(id, arr, panel, nameLabel, withFooter) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!arr.length) {
      el.innerHTML = '<div class="dg-empty-riscos"><i class="ti ti-database-off"></i><span>Sem dados de giro.</span></div>';
      return;
    }
    const footer = withFooter ? buildBaixoFooter(arr) : '';
    el.innerHTML = buildGiroHead(nameLabel) + arr.map(item => buildGiroRow(item, panel)).join('') + footer;
  }

  // ── Materiais: Top 5 mais saudáveis / mais críticos na Visão Geral condensada
  //    (lista completa fica no modal) — ordenado pelo Nível combinado, giro como desempate.
  const matPorNivelAsc  = [...matArr].sort((a,b) => a.nivel.pontos - b.nivel.pontos || b.giro - a.giro); // bom primeiro
  const matPorNivelDesc = [...matArr].sort((a,b) => b.nivel.pontos - a.nivel.pontos || a.giro - b.giro); // crítico primeiro

  renderPanel('dg-vg-giro-mat-alto-body',  matPorNivelAsc.slice(0, 5),  'alto',  'Material', false);
  renderPanel('dg-vg-giro-mat-baixo-body', matPorNivelDesc.slice(0, 5), 'baixo', 'Material', true);

  // Modal: TODOS os materiais, do pior nível pro melhor (giro como desempate dentro do mesmo nível).
  const matPorGiro = [...matArr].sort((a,b) => b.nivel.pontos - a.nivel.pontos || a.giro - b.giro);
  const matModalEl = document.getElementById('dg-giro-mat-todos-body');
  if (matModalEl) {
    if (!matPorGiro.length) {
      matModalEl.innerHTML = '<div class="dg-empty-riscos"><i class="ti ti-database-off"></i><span>Sem dados de giro.</span></div>';
    } else {
      matModalEl.innerHTML = buildGiroHead('Material') + matPorGiro.map(m => buildGiroRow(m, m.giro >= 1 ? 'alto' : 'baixo')).join('');
    }
  }

  // ── Centrais: lista completa do pior nível pro melhor no modal de detalhe,
  //    Top 5 mais saudáveis/críticas na Visão Geral, tudo pelo mesmo Nível combinado.
  const centralPorGiro   = [...centralArr].sort((a,b) => b.nivel.pontos - a.nivel.pontos || a.giro - b.giro);
  const top5CentralAlto  = [...centralArr].sort((a,b) => a.nivel.pontos - b.nivel.pontos || b.giro - a.giro).slice(0, 5);
  const top5CentralBaixo = [...centralArr].sort((a,b) => b.nivel.pontos - a.nivel.pontos || a.giro - b.giro).slice(0, 5);

  const centralModalEl = document.getElementById('dg-giro-central-body');
  if (centralModalEl) {
    if (!centralPorGiro.length) {
      centralModalEl.innerHTML = '<div class="dg-empty-riscos"><i class="ti ti-database-off"></i><span>Sem dados de giro.</span></div>';
    } else {
      // Lista única, sem corte — classificação de painel (alto/baixo) decidida por linha
      // conforme o próprio giro da central, já que aqui não há separação melhor/pior.
      centralModalEl.innerHTML = buildGiroHead('Central') + centralPorGiro.map(c => buildGiroRow(c, c.giro >= 1 ? 'alto' : 'baixo')).join('');
    }
  }
  renderPanel('dg-vg-giro-central-alto-body',  top5CentralAlto,  'alto',  'Central', false);
  renderPanel('dg-vg-giro-central-baixo-body', top5CentralBaixo, 'baixo', 'Central', false);

  // Cache pro botão "Relatório Gerencial" (ver relatorio.js) — mesmos Top 5
  // já calculados/ordenados aqui, sem duplicar a lógica de classificação de
  // giro/nível. window._dgVgLastData já existe neste ponto: renderDgGiro é
  // sempre chamada logo depois de renderDgVisaoGeralPdf, na mesma
  // _renderDashboardConteudo (ver rodarDashboardGerencial).
  if (window._dgVgLastData) {
    window._dgVgLastData.giro = {
      matAlto: matPorNivelAsc.slice(0, 5),
      matBaixo: matPorNivelDesc.slice(0, 5),
      centralAlto: top5CentralAlto,
      centralBaixo: top5CentralBaixo,
      // Array completo (não só o Top 5) — necessário pro rodapé de resumo
      // "X parados / Y baixo giro / Est. total parado" do painel Materiais
      // Mais Críticos no relatório (ver buildBaixoFooter acima, que soma
      // sobre o array inteiro, não só os 5 exibidos).
      matArrFull: matArr
    };
  }

  // Ativa os badges "?" injetados dinamicamente acima (KPIs + cabeçalhos de
  // tabela) — initHelpBadges() é idempotente, pula quem já foi ligado.
  if (typeof initHelpBadges === 'function') initHelpBadges();
}


  function renderEntradas() {
  const tb = document.getElementById('tb-entradas');
  if (!tb) return;
  const data = pageSlice('entradas');
  updatePageInfo('entradas');
  renderSemCadastroModuloBox('entradas');
  if (typeof renderEntradasSummary === 'function') renderEntradasSummary();

  if (!getFilteredData('entradas').length) {
    tb.innerHTML = '<tr><td colspan="13"><div class="empty-state"><i class="ti ti-package"></i><p>Nenhuma entrada cadastrada.</p></div></td></tr>';
    return;
  }

  tb.innerHTML = data.map((r, i) => `
    <tr>
      <td class="td-mono">${r.fonte === 'manual' ? '<span class="badge-manual" title="Registro inserido manualmente"><i class="ti ti-pencil"></i></span>' : ''}${r.centralCompra || '—'}</td>
      <td class="td-mono">${r.centralDestino || '—'}</td>
      <td class="td-mono">${r.nf || '—'}</td>
      <td class="td-muted">${r.dtEmissao || '—'}</td>
      <td class="td-muted">${r.dtDescarga || '—'}</td>
      <td>${r.fornecedor || '—'}</td>
      <td class="td-muted">${getCatKeyDoCadastro(r.materialOriginal) ? (r.categoria || '—') : semCadastroBadgeHtml(r.materialOriginal)}</td>
      <td class="td-mono">${r.material || r.materialOriginal || '—'}</td>
      <td class="td-mono" style="color:var(--teal)">${num(r.peso) || 0}</td>
      <td>${r.um || '—'}</td>
      <td class="td-mono">${money(r.custo)}</td>
      <td class="td-mono" style="color:var(--green)">${money(r.valorTotal)}</td>
      <td><button class="btn-icon danger" onclick="removerRegistro('entradas', ${i})"><i class="ti ti-trash"></i></button></td>
    </tr>
  `).join('');
  makeResizable(tb.closest('table'));
  injectColFilterButtons(tb.closest('table'), 'entradas');
}

// ═══════════════════════════════════════════════════════════
// VISÃO DE CONSUMO (Saídas) — Fase 1 das 3 abas novas do Gerencial
// (Fornecimento/Consumo/Custos). KPIs de topo com comparativo automático
// vs. período anterior equivalente (mesma duração, encostado antes de
// dtIni — decisão confirmada com o Hugo), rankings de Centrais/Materiais
// por consumo e a seção Giro & Cobertura migrada da Visão Geral (deixou
// de existir lá pra não duplicar conteúdo entre abas).
// ═══════════════════════════════════════════════════════════

// Período anterior equivalente — mesma duração do período selecionado,
// encostado imediatamente antes de dtIni. Reaproveitado por Fornecimento
// e Custos nas próximas fases, não só por Consumo.
function getPeriodoAnteriorEquivalente(dtIni, dtFim) {
  if (!dtIni || !dtFim) return { dtIniAnt: null, dtFimAnt: null };
  const duracaoMs = dtFim.getTime() - dtIni.getTime();
  const dtFimAnt = new Date(dtIni.getTime() - 1);
  const dtIniAnt = new Date(dtFimAnt.getTime() - duracaoMs);
  return { dtIniAnt, dtFimAnt };
}

// Badge de comparativo (▲/▼/estável) — atual vs. período anterior
// equivalente. Sem juízo de valor sobre alta/baixa (verde=alta,
// vermelho=baixa, sempre) — o significado de "bom"/"ruim" depende do
// KPI e fica a cargo de quem lê o card, não da cor do badge.
function _dgDeltaBadgeHtml(atual, anterior) {
  if (anterior === null || anterior === undefined || Math.abs(anterior) < 0.0001) {
    if (Math.abs(atual) < 0.0001) return '';
    return `<span class="macro-kpi-delta flat"><i class="ti ti-minus"></i> sem base no período anterior</span>`;
  }
  const pct = ((atual - anterior) / Math.abs(anterior)) * 100;
  if (Math.abs(pct) < 0.05) return `<span class="macro-kpi-delta flat"><i class="ti ti-minus"></i> estável</span>`;
  const isUp = pct > 0;
  const cls  = isUp ? 'up' : 'down';
  const icon = isUp ? 'ti-trending-up' : 'ti-trending-down';
  return `<span class="macro-kpi-delta ${cls}"><i class="ti ${icon}"></i> ${isUp ? '+' : ''}${pct.toFixed(1)}%</span>`;
}

// Giro Geral / Cobertura Geral agregados — MESMA metodologia já usada em
// renderDgGiro (KPI do modal detalhado, acima), replicada aqui de forma
// independente pra não alterar uma função já validada. Usada pelos KPIs
// de topo da Visão de Consumo (e pelo comparativo vs. período anterior).
function _dcCalcGiroCoberturaGeral(results) {
  let totalSaidasKg = 0, totalEstMedioKg = 0;
  results.forEach(r => {
    const lancsByMat = new Map(), sapByMat = new Map();
    r.lancsNoPeriodo.forEach(l => { const m = l.material || '—'; if (!lancsByMat.has(m)) lancsByMat.set(m, []); lancsByMat.get(m).push(l); });
    r.sapNoPeriodo.forEach(s   => { const m = s.material  || '—'; if (!sapByMat.has(m))   sapByMat.set(m, []);   sapByMat.get(m).push(s); });
    (r.allMats || []).forEach(mat => {
      const snap = buildSnapshot({ lancs: lancsByMat.get(mat) || [], sap: sapByMat.get(mat) || [] });
      totalSaidasKg   += Math.abs(snap.totalSai);
      totalEstMedioKg += (snap.pesoIni + snap.pesoFim) / 2;
    });
  });
  const periodoEstimado = results.length ? (() => {
    let minDate = null, maxDate = null;
    results.forEach(r => r.lancsNoPeriodo.forEach(l => {
      const d = parseDate(l.dtLanc); if (!d) return;
      if (!minDate || d < minDate) minDate = d;
      if (!maxDate || d > maxDate) maxDate = d;
    }));
    return (minDate && maxDate) ? Math.max(1, Math.round((maxDate - minDate) / 86400000) + 1) : 30;
  })() : 30;
  const giroGeral      = totalEstMedioKg > 0 ? totalSaidasKg / totalEstMedioKg : 0;
  const coberturaGeral = totalSaidasKg   > 0 ? (totalEstMedioKg / totalSaidasKg) * periodoEstimado : null;
  return { giroGeral, coberturaGeral, totalSaidasKg, totalEstMedioKg };
}

// Ranking Centrais com Maior Consumo — agrupa os pares Central×Material
// (já resolvidos por _dgVgBuildPares, mesma fonte usada em toda a Visão
// Geral) por central, somando saiKg e o custo de saída (saiKg × custo
// médio ponderado do material naquela central — mesma base de custo já
// usada no resto do Gerencial, não o valorTotal registrado no SAP).
function _dcBuildRankingCentrais(pares) {
  const map = new Map();
  pares.forEach(p => {
    if (!map.has(p.central)) map.set(p.central, { nome: p.central, sub: p.regional || '—', saiKg: 0, custoSaida: 0 });
    const m = map.get(p.central);
    m.saiKg      += p.saiKg || 0;
    m.custoSaida += (p.saiKg || 0) * (p.custoMed || 0);
  });
  return [...map.values()].filter(m => m.saiKg > 0.0001).sort((a, b) => b.saiKg - a.saiKg);
}

// Ranking Materiais Mais Consumidos — mesma fonte (pares), agrupado por
// material em vez de central.
function _dcBuildRankingMateriais(pares) {
  const map = new Map();
  pares.forEach(p => {
    if (!map.has(p.mat)) map.set(p.mat, { nome: p.mat, sub: DG_VG_CAT_LABELS[p.catKey] || '—', saiKg: 0, custoSaida: 0 });
    const m = map.get(p.mat);
    m.saiKg      += p.saiKg || 0;
    m.custoSaida += (p.saiKg || 0) * (p.custoMed || 0);
  });
  return [...map.values()].filter(m => m.saiKg > 0.0001).sort((a, b) => b.saiKg - a.saiKg);
}

// Renderiza um card de ranking genérico (.dg-rank-card) — reaproveitado
// pelas 3 abas novas do Gerencial (Consumo agora; Fornecimento/Custos
// nas próximas fases), não só por esta lista de centrais/materiais.
function _dgRankCardHtml(rows, opts = {}) {
  if (!rows.length) {
    return '<div class="dg-empty-riscos" style="padding:16px"><i class="ti ti-database-off"></i><span>Sem dados no período.</span></div>';
  }
  const nameLabel = opts.nameLabel || 'Nome';
  const subLabel  = opts.subLabel  || '';
  const valLabel  = opts.valLabel  || 'Valor';
  const color     = opts.color     || 'var(--accent)';
  const valFmt    = opts.valFmt    || (r => fmtKgShort(r.saiKg));
  const subFmt    = opts.subFmt    || (r => escapeHtml(r.sub || '—'));
  const max = Math.max(...rows.map(r => r.saiKg), 0.0001);
  const head = `<div class="dg-rank-head2"><span>${nameLabel}${subLabel ? ' · ' + subLabel : ''}</span><span>${valLabel}</span></div>`;
  const body = rows.map(r => {
    const pct = Math.min(100, (r.saiKg / max) * 100);
    return `<div class="dg-rank-item">
      <div class="dg-rank-item-top">
        <span class="dg-rank-item-name" title="${escapeHtml(r.nome)}">${escapeHtml(r.nome)}<span class="dg-rank-item-sub"> · ${subFmt(r)}</span></span>
        <span class="dg-rank-item-val">${valFmt(r)}</span>
      </div>
      <div class="dg-rank-item-bar-track"><div class="dg-rank-item-bar-fill" style="width:${pct}%;background:${color}"></div></div>
    </div>`;
  }).join('');
  return `${head}<div class="dg-rank-list">${body}</div>`;
}

// Gráfico de barras (Chart.js) — MESMO padrão visual/tema já usado nos
// gráficos de custo da Visão Geral (_dgVgRenderChartCustoPorChave),
// reaproveitando o registro global _dgVgCharts pra destruir/recriar sem
// vazar instâncias antigas do Chart.js entre re-renderizações.
function _dcRenderChartRanking(canvasId, chartKey, rows, color) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  _dgVgDestroyChart(chartKey);
  const { textCol, gridCol, tickFont } = _dgVgTheme();
  const inner = ctx.parentElement;
  if (inner) inner.style.width = '100%';

  if (!rows.length) {
    const c2d = ctx.getContext('2d');
    c2d.clearRect(0, 0, ctx.width, ctx.height);
    c2d.fillStyle = textCol;
    c2d.font = "11px 'DM Mono', monospace";
    c2d.textAlign = 'center';
    c2d.fillText('Sem dados no período.', ctx.width / 2, 40);
    return;
  }

  const top = rows.slice(0, 10);
  const labels = top.map(r => r.nome);
  const data   = top.map(r => r.saiKg);

  _dgVgCharts[chartKey] = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: color, borderRadius: 3, borderSkipped: false }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => fmtKg(c.raw) + ' kg' } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: textCol, font: { ...tickFont, size: 9.5 }, maxRotation: 55, minRotation: 35, autoSkip: false } },
        y: { grid: { color: gridCol }, ticks: { color: textCol, font: tickFont, callback: v => fmtKgShort(v) } }
      }
    }
  });
}

// KPIs de topo da Visão de Consumo, com badge de comparativo automático
// vs. período anterior equivalente.
function _dcRenderKpiStrip(results, resultsAnt, ranking) {
  const el = document.getElementById('dg-cons-kpi-strip');
  if (!el) return;

  const movAtual = _dgVgMovimentacaoTotais(results);
  const movAnt   = resultsAnt.length ? _dgVgMovimentacaoTotais(resultsAnt) : { totalSai: 0 };
  const custoAtual = _dgVgCustoMovimentacaoTotais(results);
  const custoAnt   = resultsAnt.length ? _dgVgCustoMovimentacaoTotais(resultsAnt) : { custoSai: 0 };
  const giroAtual = _dcCalcGiroCoberturaGeral(results);
  const giroAnt   = resultsAnt.length ? _dcCalcGiroCoberturaGeral(resultsAnt) : { giroGeral: 0, coberturaGeral: null };
  const destaque = ranking[0] || null;

  el.innerHTML = `
    <div class="macro-kpi-card kc-blue">
      <div class="macro-kpi-label"><i class="ti ti-scale"></i> Volume Consumido</div>
      <div class="macro-kpi-cost">${fmtKgShort(movAtual.totalSai)} kg</div>
      <div class="macro-kpi-delta-row">
        <span class="macro-kpi-delta-label">vs. período anterior</span>
        ${_dgDeltaBadgeHtml(movAtual.totalSai, movAnt.totalSai)}
      </div>
    </div>
    <div class="macro-kpi-card kc-amber">
      <div class="macro-kpi-label"><i class="ti ti-coin"></i> Custo Total de Saídas</div>
      <div class="macro-kpi-cost">${money(custoAtual.custoSai || 0)}</div>
      <div class="macro-kpi-delta-row">
        <span class="macro-kpi-delta-label">vs. período anterior</span>
        ${_dgDeltaBadgeHtml(custoAtual.custoSai || 0, custoAnt.custoSai || 0)}
      </div>
    </div>
    <div class="macro-kpi-card kc-teal">
      <div class="macro-kpi-label"><i class="ti ti-refresh"></i> Giro Geral</div>
      <div class="macro-kpi-cost">${giroAtual.giroGeral.toFixed(2)}x</div>
      <div class="macro-kpi-delta-row">
        <span class="macro-kpi-delta-label">vs. período anterior</span>
        ${_dgDeltaBadgeHtml(giroAtual.giroGeral, giroAnt.giroGeral)}
      </div>
    </div>
    <div class="macro-kpi-card kc-purple">
      <div class="macro-kpi-label"><i class="ti ti-calendar-time"></i> Cobertura Geral</div>
      <div class="macro-kpi-cost">${giroAtual.coberturaGeral !== null ? Math.round(giroAtual.coberturaGeral) + ' dias' : '—'}</div>
      <div class="macro-kpi-delta-row">
        <span class="macro-kpi-delta-label">vs. período anterior</span>
        ${_dgDeltaBadgeHtml(giroAtual.coberturaGeral || 0, giroAnt.coberturaGeral || 0)}
      </div>
    </div>
    <div class="macro-kpi-card kc-green">
      <div class="macro-kpi-label"><i class="ti ti-building-factory-2"></i> Central com Maior Consumo</div>
      <div class="macro-kpi-cost" style="font-size:clamp(13px,1.6vw,17px)">${destaque ? escapeHtml(destaque.nome) : '—'}</div>
      <div class="macro-kpi-sub">${destaque ? fmtKgShort(destaque.saiKg) + ' kg no período' : 'Sem dados'}</div>
    </div>`;
}

// Orquestra a Visão de Consumo inteira — chamada por _renderDashboardConteudo
// toda vez que o usuário clica "Analisar". resultsAnt vem do período
// anterior equivalente (getPeriodoAnteriorEquivalente), calculado uma
// única vez ali e repassado pra cá (evita recalcular duas vezes por
// render caso outras seções também precisem do período anterior no
// futuro — Fornecimento e Custos, nas próximas fases).
function renderDgConsumo(results, resultsAnt, dtIni, dtFim) {
  const kpiEl = document.getElementById('dg-cons-kpi-strip');
  if (!kpiEl) return;

  const rankCentraisEl  = document.getElementById('dg-cons-rank-centrais');
  const rankMateriaisEl = document.getElementById('dg-cons-rank-materiais');

  if (!results.length) {
    kpiEl.innerHTML = '<div class="dg-empty-riscos" style="padding:16px"><i class="ti ti-database-off"></i><span>Sem dados no período.</span></div>';
    if (rankCentraisEl)  rankCentraisEl.innerHTML  = '';
    if (rankMateriaisEl) rankMateriaisEl.innerHTML = '';
    _dgVgDestroyChart('consCentrais');
    _dgVgDestroyChart('consMateriais');
    return;
  }

  const thresholds = getHealthThresholds();
  const pares = _dgVgBuildPares(results, thresholds, null, null);

  const rankingCentrais  = _dcBuildRankingCentrais(pares);
  const rankingMateriais = _dcBuildRankingMateriais(pares);

  _dcRenderKpiStrip(results, resultsAnt, rankingCentrais);

  if (rankCentraisEl) {
    rankCentraisEl.innerHTML = _dgRankCardHtml(rankingCentrais, {
      nameLabel: 'Central', subLabel: 'Regional', valLabel: 'Consumo (kg)',
      color: 'var(--accent)',
      valFmt: r => fmtKgShort(r.saiKg),
      subFmt: r => escapeHtml(r.sub)
    });
  }
  if (rankMateriaisEl) {
    rankMateriaisEl.innerHTML = _dgRankCardHtml(rankingMateriais, {
      nameLabel: 'Material', subLabel: 'Categoria', valLabel: 'Consumo (kg)',
      color: 'var(--purple)',
      valFmt: r => fmtKgShort(r.saiKg),
      subFmt: r => escapeHtml(r.sub)
    });
  }

  _dcRenderChartRanking('dg-cons-chart-centrais',  'consCentrais',  rankingCentrais,  _dgResolveCssColor('--accent', '#3b82f6'));
  _dcRenderChartRanking('dg-cons-chart-materiais', 'consMateriais', rankingMateriais, _dgResolveCssColor('--purple', '#8b5cf6'));

  // Giro & Cobertura — migrado da Visão Geral, mesma função/ids de antes.
  renderDgGiro(results, dtIni, dtFim);
}

function renderSaidas() {
  const tb = document.getElementById('tb-saidas');
  if (!tb) return;
  const data = pageSlice('saidas');
  updatePageInfo('saidas');
  renderSemCadastroModuloBox('saidas');
  if (typeof renderSaidasSummary === 'function') renderSaidasSummary();

  if (!getFilteredData('saidas').length) {
    tb.innerHTML = '<tr><td colspan="12"><div class="empty-state"><i class="ti ti-truck"></i><p>Nenhuma saída cadastrada.</p></div></td></tr>';
    return;
  }

  tb.innerHTML = data.map((r, i) => `
    <tr>
      <td class="td-mono">${r.fonte === 'manual' ? '<span class="badge-manual" title="Registro inserido manualmente"><i class="ti ti-pencil"></i></span>' : ''}${r.central || '—'}</td>
      <td class="td-muted">${r.dtEmissao || '—'}</td>
      <td class="td-mono">${r.os || '—'}</td>
      <td class="td-muted">${r.contrato || '—'}</td>
      <td class="td-muted">${getCatKeyDoCadastro(r.materialOriginal) ? (r.categoria || '—') : semCadastroBadgeHtml(r.materialOriginal)}</td>
      <td>${r.fornecedor || '—'}</td>
      <td class="td-mono">${r.material || r.materialOriginal || '—'}</td>
      <td class="td-mono" style="color:var(--teal)">${num(r.peso) || 0}</td>
      <td>${r.um || '—'}</td>
      <td class="td-mono">${money(r.custo)}</td>
      <td class="td-mono" style="color:var(--green)">${money(r.valorTotal)}</td>
      <td><button class="btn-icon danger" onclick="removerRegistro('saidas', ${i})"><i class="ti ti-trash"></i></button></td>
    </tr>
  `).join('');
  makeResizable(tb.closest('table'));
  injectColFilterButtons(tb.closest('table'), 'saidas');
}

function renderLancamentos() {
  const tb = document.getElementById('tb-lancamentos');
  if (!tb) return;
  // Inicializa painel de ausências na primeira abertura
  if (typeof initAusencias === 'function') initAusencias();
  const data = pageSlice('lancamentos');
  updatePageInfo('lancamentos');
  renderSemCadastroModuloBox('lancamentos');
  if (typeof renderLancamentosSummary === 'function') renderLancamentosSummary();

  if (!getFilteredData('lancamentos').length) {
    tb.innerHTML = '<tr><td colspan="10"><div class="empty-state"><i class="ti ti-clipboard"></i><p>Nenhum lançamento de saldo real.</p></div></td></tr>';
    return;
  }

  // Mapa de índice de página → objeto real no state (para edição inline)
  window._lancPageData = data;

  const _lancDupKeys = getLancamentoDuplicateKeys();

  tb.innerHTML = data.map((r, i) => {
  const isDup = _lancDupKeys.has(getLancamentoRecordKey(r));
  const trClass = isDup ? ' class="lanc-duplicata"' : '';
  const trTitle = isDup ? ' title="Lançamento duplicado: mesma central, data e material"' : '';
  const _lancSemCad = !getCatKeyDoCadastro(r.materialOriginal);
  const _lancCatCell = _lancSemCad
    ? `<td class="td-muted">${semCadastroBadgeHtml(r.materialOriginal)}</td>`
    : `<td class="td-muted td-editable"
        contenteditable="true" spellcheck="false"
        data-lanc-idx="${i}" data-lanc-field="categoria"
        onkeydown="lancEditKeydown(event)"
        onblur="lancEditSave(this)">${escapeHtml(r.categoria || '—')}</td>`;
  return `
    <tr${trClass}${trTitle}>
      <td class="td-mono" style="display:flex;align-items:center;">
        ${r.fonte === 'manual' ? '<span class="badge-manual" title="Registro inserido manualmente"><i class="ti ti-pencil"></i></span>' : ''}
        ${r.editado ? '<span class="badge-editado" title="Registro editado manualmente"><i class="ti ti-pencil"></i></span>' : ''}
        <span class="lanc-central-edit" contenteditable="true" spellcheck="false"
          data-lanc-idx="${i}" data-lanc-field="central"
          onkeydown="lancEditKeydown(event)"
          onblur="lancEditSave(this)">${escapeHtml(r.central || '—')}</span>
      </td>
      <td class="td-muted td-editable"
        contenteditable="true" spellcheck="false"
        data-lanc-idx="${i}" data-lanc-field="dtLanc"
        onkeydown="lancEditKeydown(event)"
        onblur="lancEditSave(this)">${r.dtLanc || '—'}</td>
      <td class="td-editable"
        contenteditable="true" spellcheck="false"
        data-lanc-idx="${i}" data-lanc-field="fornecedor"
        onkeydown="lancEditKeydown(event)"
        onblur="lancEditSave(this)">${escapeHtml(r.fornecedor || '—')}</td>
      ${_lancCatCell}
      <td class="td-mono td-editable"
        contenteditable="true" spellcheck="false"
        data-lanc-idx="${i}" data-lanc-field="material"
        onkeydown="lancEditKeydown(event)"
        onblur="lancEditSave(this)">${escapeHtml(r.material || r.materialOriginal || '—')}</td>
      <td class="td-mono td-editable" style="color:var(--teal)"
        contenteditable="true" spellcheck="false"
        data-lanc-idx="${i}" data-lanc-field="peso"
        onkeydown="lancEditKeydown(event)"
        onblur="lancEditSave(this)">${num(r.peso) || 0}</td>
      <td class="td-editable"
        contenteditable="true" spellcheck="false"
        data-lanc-idx="${i}" data-lanc-field="um"
        onkeydown="lancEditKeydown(event)"
        onblur="lancEditSave(this)">${escapeHtml(r.um || '—')}</td>
      <td class="td-mono td-editable"
        contenteditable="true" spellcheck="false"
        data-lanc-idx="${i}" data-lanc-field="custo"
        onkeydown="lancEditKeydown(event)"
        onblur="lancEditSave(this)">${money(r.custo)}</td>
      <td class="td-mono td-editable"
        contenteditable="true" spellcheck="false"
        data-lanc-idx="${i}" data-lanc-field="valorTotal"
        onkeydown="lancEditKeydown(event)"
        onblur="lancEditSave(this)">${money(r.valorTotal)}</td>
      <td><button class="btn-icon danger" onclick="removerRegistro('lancamentos', ${i})"><i class="ti ti-trash"></i></button></td>
    </tr>
  `;
  }).join('');
  makeResizable(tb.closest('table'));
  injectColFilterButtons(tb.closest('table'), 'lancamentos');
}


// ── Edição inline — todos os campos dos lançamentos ─────────

// Retorna o valor de exibição correto para cada campo (usado no Escape e pós-save)
function _lancFieldDisplay(r, field) {
  switch (field) {
    case 'peso':       return num(r.peso) || 0;
    case 'custo':      return money(r.custo);
    case 'valorTotal': return money(r.valorTotal);
    case 'central':    return r.central || '—';
    case 'dtLanc':     return r.dtLanc || '—';
    case 'fornecedor': return r.fornecedor || '—';
    case 'categoria':  return r.categoria || '—';
    case 'material':   return r.material || r.materialOriginal || '—';
    case 'um':         return r.um || '—';
    default:           return r[field] ?? '—';
  }
}

function lancEditKeydown(e) {
  // Enter confirma (blur), Escape cancela e restaura valor original
  if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  if (e.key === 'Escape') {
    const cell  = e.target;
    const idx   = parseInt(cell.dataset.lancIdx);
    const field = cell.dataset.lancField;
    const r = window._lancPageData?.[idx];
    if (!r) return;
    cell.textContent = _lancFieldDisplay(r, field);
    cell.blur();
  }
}

function lancEditSave(cell) {
  const idx   = parseInt(cell.dataset.lancIdx);
  const field = cell.dataset.lancField;
  const r = window._lancPageData?.[idx];
  if (!r) return;

  const numericFields = ['peso', 'custo', 'valorTotal'];

  if (numericFields.includes(field)) {
    // Parse: aceita vírgula como decimal e ignora R$, pontos de milhar
    const raw = cell.textContent.replace(/R\$\s*/g, '').replace(/\./g, '').replace(',', '.').trim();
    const val = parseFloat(raw);
    if (isNaN(val)) {
      cell.textContent = _lancFieldDisplay(r, field);
      toast('Valor inválido — alteração descartada', 'error');
      return;
    }
    const oldVal = num(r[field]);
    if (Math.abs(val - oldVal) < 0.001) return; // sem mudança
    r[field] = val;
    // Recalcular valorTotal quando peso ou custo mudam
    if (field === 'peso' && num(r.custo) > 0) r.valorTotal = val * num(r.custo);
    if (field === 'custo' && num(r.peso) > 0) r.valorTotal = num(r.peso) * val;
  } else {
    const newVal = cell.textContent.trim();
    // Guard primário: texto visível idêntico ao renderizado → sem mudança
    if (newVal === String(_lancFieldDisplay(r, field))) return;
    if (field === 'central') {
      r.centralOriginal = newVal;
      r.central = normalizarCentral(newVal) || newVal;
    } else if (field === 'material') {
      r.materialOriginal = newVal;
      r.material = normalizarMaterial(newVal) || newVal;
    } else {
      r[field] = newVal || '—';
    }
  }

  // Marca como editado e injeta badge azul se ainda não existir
  if (!r.editado) {
    r.editado = true;
    const row     = cell.closest('tr');
    const firstTd = row?.querySelector('td:first-child');
    if (firstTd && !firstTd.querySelector('.badge-editado')) {
      const badge = document.createElement('span');
      badge.className = 'badge-editado';
      badge.title     = 'Registro editado manualmente';
      badge.innerHTML = '<i class="ti ti-pencil"></i>';
      // Insere após badge-manual (se houver), senão no início da célula
      const manualBadge = firstTd.querySelector('.badge-manual');
      if (manualBadge) manualBadge.after(badge);
      else firstTd.prepend(badge);
    }
  }

  invalidateLancIndex();
  persistStateNow().catch(e => console.warn('Falha ao salvar lançamento:', e));
  toast('Lançamento atualizado');

  // Atualiza célula com formato correto
  cell.textContent = _lancFieldDisplay(r, field);

  // Se peso ou custo mudaram, atualizar célula valorTotal
  if (field === 'peso' || field === 'custo') {
    const row    = cell.closest('tr');
    const vtCell = row?.querySelector('[data-lanc-field="valorTotal"]');
    if (vtCell) vtCell.textContent = money(r.valorTotal);
  }
}

Object.assign(window, { _lancFieldDisplay, lancEditKeydown, lancEditSave });

// ═══════════════════════════════════════════════════════════
// AUSÊNCIAS DE LANÇAMENTO
// ═══════════════════════════════════════════════════════════

function toggleAusencias() {
  const body    = document.getElementById('ausencias-body');
  const chevron = document.getElementById('ausencias-chevron');
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : '';
  chevron?.classList.toggle('open', !isOpen);
}

function _ausDateStr(d) {
  // dd/mm/yyyy
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

// Calcula quais dias de um intervalo esperavam lançamento para
// um material de tipo isSemanal (terça) ou diário (seg-sáb)
function _diasEsperados(dtIni, dtFim, isSemanal) {
  const dias = [];
  const cur  = new Date(dtIni);
  cur.setHours(0, 0, 0, 0);
  const fim  = new Date(dtFim);
  fim.setHours(23, 59, 59, 999);

  while (cur <= fim) {
    const dow = cur.getDay(); // 0=dom, 2=ter, 6=sab
    if (isSemanal) {
      if (dow === 2) dias.push(new Date(cur)); // só terça
    } else {
      if (dow !== 0) dias.push(new Date(cur)); // seg-sab
    }
    cur.setDate(cur.getDate() + 1);
  }
  return dias;
}

// ── Cache de ausências computadas (período atual) ────────────────────────
let _ausCache = null;  // Array completo de ausências do período atual
let _ausCachePeriod = '';  // 'dtIni|dtFim' para invalidar se período mudar

function _ausInvalidateCache() {
  _ausCache = null;
  _ausCachePeriod = '';
  _ausInvalidateEntSaiIdx();
}

// Chamada quando período muda — recalcula tudo e guarda no cache
function _ausComputar(dtIni, dtFim) {
  _ausInvalidateEntSaiIdx(); // garante índices frescos

  // ── Monta índice de dias lançados no período ──
  // parseDate necessário pois dtLanc é dd/mm/yyyy, não ISO
  const lancIndex = new Map();
  (state.lancamentos || []).forEach(r => {
    const d = parseDate(r.dtLanc);
    if (!d || d < dtIni || d > dtFim) return;
    const dk = localISODate(d);
    const key = normalizeText(r.central) + '|' + normalizeText(r.material || '—');
    if (!lancIndex.has(key)) lancIndex.set(key, new Set());
    lancIndex.get(key).add(dk);
  });

  // ── Pares candidatos: união de SAP histórico + Lançamentos históricos ──
  // Varre os índices completos para encontrar todos os pares conhecidos.
  // A elegibilidade real (ativo/inativo) é decidida pelo estoque teórico
  // calculado dia a dia — não por heurísticas de código de movimento.
  const { byCentralMat: lancIdxAll } = getLancIndex();
  const { byCentralMat: sapIdxAll  } = getSapIndex();

  const paresInfo = new Map(); // normKey → { central, mat, materialOriginal }
  sapIdxAll.forEach((matMap, central) => {
    matMap.forEach((arr, mat) => {
      if (!arr.length || !central || !mat || mat === '—') return;
      const key = normalizeText(central) + '|' + normalizeText(mat);
      if (!paresInfo.has(key))
        paresInfo.set(key, { central, mat, materialOriginal: arr[0]?.materialOriginal || mat });
    });
  });
  lancIdxAll.forEach((matMap, central) => {
    matMap.forEach((arr, mat) => {
      if (!arr.length || !central || !mat || mat === '—') return;
      const key = normalizeText(central) + '|' + normalizeText(mat);
      // Lançamentos têm prioridade como fonte do materialOriginal
      // representativo (mesmo critério de prioridade que já existia p/
      // categoria).
      paresInfo.set(key, { central, mat, materialOriginal: arr[0]?.materialOriginal || mat });
    });
  });

  // ── Dias do período (ISO strings) ─────────────────────────────────────
  const diasPeriodoISO = [];
  { const cur = new Date(dtIni); cur.setHours(0,0,0,0);
    const fim = new Date(dtFim); fim.setHours(0,0,0,0);
    while (cur <= fim) { diasPeriodoISO.push(localISODate(cur)); cur.setDate(cur.getDate()+1); }
  }

  // ── SAP acumulado por dia: Map<normKey, Map<ISO, deltaSAP>> ───────────
  // delta = soma de todos os pesos SAP até e incluindo aquele dia
  // Construído uma única vez para todo o período
  // sapDeltaByPar: só SAP do período selecionado, dia a dia
  // pesoIni (lançamento anterior ao período) já resume o histórico completo
  const sapDeltaByPar = new Map(); // normKey → Map<isoDay, somaDoDia>
  const dkIni = diasPeriodoISO[0];
  const dkFim = diasPeriodoISO[diasPeriodoISO.length - 1];
  sapIdxAll.forEach((matMap, central) => {
    matMap.forEach((sapArr, mat) => {
      if (!central || !mat || mat === '—') return;
      const key = normalizeText(central) + '|' + normalizeText(mat);
      const deltaByDay = new Map();
      sapArr.forEach(r => {
        const d = parseDate(r.dtLanc);
        if (!d) return;
        const dk = localISODate(d);
        if (dk >= dkIni && dk <= dkFim)
          deltaByDay.set(dk, (deltaByDay.get(dk) || 0) + num(r.peso));
      });
      if (deltaByDay.size) sapDeltaByPar.set(key, deltaByDay);
    });
  });

  // ── Pré-computa dia-da-semana de cada ISO uma única vez ──────────────────
  const dowByISO = new Map(); // isoDay → 0..6
  diasPeriodoISO.forEach(dk => {
    const [y,m,d] = dk.split('-').map(Number);
    dowByISO.set(dk, new Date(y, m-1, d).getDay());
  });
  const esperadosDiario  = diasPeriodoISO.filter(dk => dowByISO.get(dk) !== 0);
  const esperadosSemanal = diasPeriodoISO.filter(dk => dowByISO.get(dk) === 2);

  // ── Calcula ausências ─────────────────────────────────────────────────
  const limiteInatividade = new Date(dtIni);
  limiteInatividade.setDate(limiteInatividade.getDate() - 30);

  const filIdx = getFilialLookupIndex();
  const getRegional = c => {
    const f = filIdx.exact.get(normalizeText(c));
    return (f?.regional || '').trim() || 'Sem regional';
  };

  const ausencias = [];
  paresInfo.forEach(({ central, mat, materialOriginal }, key) => {
    // catKey busca SEMPRE via materialOriginal — nunca via mat (nome já
    // resolvido, que pode coincidir por acaso com o alias/origem de outro
    // cadastro não relacionado). Sem cadastro: mantém a regra diária
    // (padrão seguro já existente), mas fica marcado como semCadastro=true
    // para o resultado exibir isso visivelmente (decisão confirmada).
    const catKey      = getCatKeyDoCadastro(materialOriginal);
    const semCadastro = !catKey;
    const isSemanal    = catKey === 'agregado';
    const esperadosISO = isSemanal ? esperadosSemanal : esperadosDiario;
    if (!esperadosISO.length) return;

    const lancados = lancIndex.get(key) || new Set();

    // ── Estoque teórico acumulado dia a dia ──────────────────────────────
    const deltaByDay = sapDeltaByPar.get(key) || new Map();

    // lancValByDay: lançamentos do período para este par (isoDay → peso total)
    // Usa o bucket do lancIdxAll com a chave normalizada para evitar mismatch
    const lancValByDay = new Map();
    let   lastLancBeforePeriod = null; // para derivar pesoIni sem chamada extra

    // Iterar o bucket de lançamentos históricos uma única vez:
    // – antes do período: guarda o mais recente (pesoIni)
    // – durante o período: acumula por dia
    const lancBucket = lancIndex.get(key); // lancIndex já usa chaves normalizadas
    // lancIndex só tem lançamentos DO período; precisamos dos anteriores via lancIdxAll
    // Busca o bucket pelo par original (central/mat vêm de paresInfo, valores originais)
    const lancBucketAll = lancIdxAll.get(central)?.get(mat) || [];
    lancBucketAll.forEach(r => {
      const d = parseDate(r.dtLanc);
      if (!d) return;
      const dk = localISODate(d);
      if (dk < dkIni) {
        // Antes do período: guarda o mais recente como pesoIni
        if (!lastLancBeforePeriod || d > lastLancBeforePeriod.d)
          lastLancBeforePeriod = { d, peso: num(r.peso) };
      } else if (dk <= dkFim) {
        lancValByDay.set(dk, (lancValByDay.get(dk) || 0) + num(r.peso));
      }
    });

    // Se não encontrou lançamento anterior via lancIdxAll, tenta normalizado
    // (fallback para cobrir variações de capitalização entre fontes)
    if (!lastLancBeforePeriod) {
      const prev = getPrePeriodLaunchStock({ central, material: mat, dtIni });
      lastLancBeforePeriod = prev?.missing === false ? { d: dtIni, peso: prev.value } : null;
    }

    // Limiar de "zerado": valores <= 0.01 kg são considerados estoque zero
    const LIMIAR_ZERO = 0.01;

    let baseEstoque      = lastLancBeforePeriod?.peso ?? null; // null = nunca houve lançamento
    let baseZerada       = lastLancBeforePeriod !== null && (lastLancBeforePeriod.peso <= LIMIAR_ZERO);
    let sapAcumDesdeBase = 0;

    const diasAusentesISO = [];
    for (const dk of diasPeriodoISO) {
      // 1. Acumula SAP do dia
      sapAcumDesdeBase += deltaByDay.get(dk) || 0;

      // 2. Se houve lançamento nesse dia → atualiza base e reseta SAP acumulado
      if (lancValByDay.has(dk)) {
        const pesoLanc   = lancValByDay.get(dk);
        baseEstoque      = pesoLanc;
        baseZerada       = pesoLanc <= LIMIAR_ZERO;
        sapAcumDesdeBase = 0;
        continue; // dia com lançamento nunca é ausência
      }

      // 3. Dia sem lançamento: verifica se é dia esperado (usa dow pré-computado)
      const dow = dowByISO.get(dk);
      const ehEsperado = isSemanal ? dow === 2 : dow !== 0;
      if (!ehEsperado) continue;

      // 4. Teórico = base (último lançamento) + SAP acumulado desde então
      const teorAcum = (baseEstoque ?? 0) + sapAcumDesdeBase;

      // 5. Decide se cobra ausência:
      //    a) Nunca houve lançamento (baseEstoque === null) E teórico <= limiar → inativo
      if (baseEstoque === null && teorAcum <= LIMIAR_ZERO) continue;
      //    b) Lançamento zerado (baseZerada) → cobra como ausência zerada
      //    c) Teórico > limiar → material ativo → cobra ausência normalmente
      if (!baseZerada && teorAcum <= LIMIAR_ZERO) continue;

      // 6. Ausência confirmada
      diasAusentesISO.push(dk);
    }
    if (!diasAusentesISO.length) return;

    const diasAusentes = diasAusentesISO.map(dk => new Date(dk + 'T12:00:00'));

    const ctx = _ausContextoMaterial(central, mat);
    const ultimaData = ctx.ultimoLanc?.d ?? null;
    const zeradoPorPeso        = ctx.ultimoLanc !== null && ctx.ultimoLanc.peso <= 0.01;
    const zeradoPorInatividade = ultimaData !== null && ultimaData < limiteInatividade;
    const estoqueZerado = zeradoPorPeso || zeradoPorInatividade;
    const motivoZerado  = zeradoPorPeso ? 'peso_zero' : zeradoPorInatividade ? 'inatividade' : null;

    ausencias.push({
      central, mat, isSemanal, semCadastro, categoria: getCategoriaPorGrupo(mat) || '—', diasAusentes,
      estoqueZerado, motivoZerado,
      ultimoPeso:    ctx.ultimoLanc?.peso    ?? null,
      ultimaData,
      ultimaEntrada: ctx.ultimaEntrada?.d    ?? null,
      ultimaSaida:   ctx.ultimaSaida?.d      ?? null,
      ultimoSap:     ctx.ultimoSap?.d        ?? null,
      totalLancs:    ctx.totalLancs,
      regional:      getRegional(central),
    });
  });

  // ── Sort: regional maior→menor, central maior→menor ──
  const totReg = new Map(), totCen = new Map();
  ausencias.forEach(a => {
    totReg.set(a.regional, (totReg.get(a.regional) || 0) + a.diasAusentes.length);
    totCen.set(a.central,  (totCen.get(a.central)  || 0) + a.diasAusentes.length);
  });
  ausencias.sort((a, b) =>
    (totReg.get(b.regional) - totReg.get(a.regional)) ||
    a.regional.localeCompare(b.regional) ||
    (totCen.get(b.central) - totCen.get(a.central)) ||
    a.central.localeCompare(b.central)
  );

  return ausencias;
}

// Chamada em toda interação de filtro — usa o cache, só re-renderiza
function renderAusencias() {
  const iniEl   = document.getElementById('aus-dt-ini');
  const fimEl   = document.getElementById('aus-dt-fim');
  const content  = document.getElementById('ausencias-content');
  const subtitle = document.getElementById('ausencias-subtitle');
  const card     = document.getElementById('ausencias-card');
  if (!content) return;

  const iniStr = iniEl?.value || '';
  const fimStr = fimEl?.value || '';
  if (!iniStr || !fimStr) {
    subtitle.textContent = 'Selecione um período para analisar';
    content.innerHTML = `
      <div class="ausencias-empty" style="color:var(--text3)">
        <i class="ti ti-calendar-search" style="font-size:20px"></i>
        Selecione um período acima para identificar ausências de lançamento.
      </div>`;
    return;
  }

  const dtIni = new Date(iniStr + 'T00:00:00');
  const dtFim = new Date(fimStr + 'T23:59:59');
  if (isNaN(dtIni) || isNaN(dtFim) || dtIni > dtFim) {
    subtitle.textContent = 'Período inválido';
    return;
  }

  // Recomputa apenas se o período mudou
  const periodKey = iniStr + '|' + fimStr;
  if (_ausCache === null || _ausCachePeriod !== periodKey) {
    _ausCachePeriod = periodKey;
    _ausCache = _ausComputar(dtIni, dtFim);
  }

  // ── Usa cache — popula opções dos filtros ──
  const ausencias = _ausCache;

  const allRegionais = [...new Set(ausencias.map(a => a.regional))].sort();
  const allCentrals  = [...new Set(ausencias.map(a => a.central))].sort();
  const allCategorias = [...new Set(ausencias.map(a => a.categoria))].sort();
  const allMats      = [...new Set(ausencias.map(a => a.mat))].sort();
  _ausFilter.options.regional = allRegionais;
  _ausFilter.options.central  = allCentrals;
  _ausFilter.options.categoria = allCategorias;
  _ausFilter.options.mat      = allMats;
  _ausFilterBuildOptions('regional');
  _ausFilterBuildOptions('central');
  _ausFilterBuildOptions('categoria');
  _ausFilterBuildOptions('mat');
  _ausFilterSyncLabel('regional');
  _ausFilterSyncLabel('central');
  _ausFilterSyncLabel('categoria');
  _ausFilterSyncLabel('mat');
  _ausFilterSyncClear();

  // ── Aplica filtros ──
  const filtered = ausencias.filter(a =>
    (!_ausFilter.applied.regional.size || _ausFilter.applied.regional.has(a.regional)) &&
    (!_ausFilter.applied.central.size  || _ausFilter.applied.central.has(a.central))   &&
    (!_ausFilter.applied.categoria.size || _ausFilter.applied.categoria.has(a.categoria)) &&
    (!_ausFilter.applied.mat.size      || _ausFilter.applied.mat.has(a.mat))            &&
    (!_ausFilter.ocultarZerados        || !a.estoqueZerado)
  );

  // ── Atualiza header summary (sobre os dados filtrados) ──
  const lancAusentes = filtered.length;
  const matsUnicos   = new Set(filtered.map(a => a.mat)).size;
  const centrais     = new Set(filtered.map(a => a.central)).size;

  card?.classList.toggle('has-ausencias', ausencias.length > 0);
  // Expõe para gerarRelatorioAusencias*
  window._ausenciasData = filtered;

  if (!filtered.length) {
    const msg = ausencias.length > 0
      ? 'Nenhuma ausência para os filtros selecionados.'
      : 'Nenhuma ausência no período — todos os lançamentos presentes.';
    content.innerHTML = `
      <div class="ausencias-empty">
        <i class="ti ti-circle-check"></i>
        ${msg}
      </div>`;
    return;
  }

  const regionaisCount = new Set(filtered.map(a => a.regional)).size;
  const semCadastroCount = new Set(filtered.filter(a => a.semCadastro).map(a => a.mat)).size;
  subtitle.innerHTML = `
    <span class="aus-summary-chips">
      <span class="aus-chip red">${lancAusentes} ausência${lancAusentes !== 1 ? 's' : ''}</span>
      <span class="aus-chip amber">${matsUnicos} ${matsUnicos !== 1 ? 'materiais' : 'material'}</span>
      <span class="aus-chip teal">${centrais} ${centrais !== 1 ? 'centrais' : 'central'}</span>
      <span class="aus-chip purple">${regionaisCount} ${regionaisCount !== 1 ? 'regionais' : 'regional'}</span>
      ${semCadastroCount > 0 ? `<span class="aus-chip amber" style="opacity:.85" title="Cadência assumida como diária por falta de cadastro"><i class="ti ti-help-circle" style="font-size:10px"></i> ${semCadastroCount} sem cadastro</span>` : ''}
    </span>`;

    // ── Render agrupado por regional → central ──
  const byRegional = new Map();
  filtered.forEach(a => {
    if (!byRegional.has(a.regional)) byRegional.set(a.regional, new Map());
    const byCentral = byRegional.get(a.regional);
    if (!byCentral.has(a.central)) byCentral.set(a.central, []);
    byCentral.get(a.central).push(a);
  });

  // Reset estado dos toggles a cada render (DOM reconstruído)
  _ausRegionaisExpanded = true;
  _ausCentralisExpanded = true;

  content.innerHTML = [...byRegional.entries()].map(([regional, byCentral]) => {
    const totalRegional = [...byCentral.values()].reduce((s, rows) => s + rows.length, 0);
    const nCentrals = byCentral.size;

    const centraisHtml = [...byCentral.entries()].map(([central, rows]) => {
      const totalAus = rows.length;
      const matRows = rows.map(r => {
        const chips = r.diasAusentes
          .map(d => `<span class="aus-dia-chip">${_ausDateStr(d)}</span>`)
          .join('');
        const typeLabel = r.isSemanal ? 'Semanal' : (r.semCadastro ? 'Diário (sem cadastro)' : 'Diário');
        const zeroClass = r.estoqueZerado ? ' aus-mat-row--zerado' : '';
        const _fmtD = d => d ? d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' }) : '—';
        const _buildZeroTipHtml = () => {
          const isInativ = r.motivoZerado === 'inatividade';
          const col = isInativ ? 'var(--amber)' : 'var(--red)';
          const icon = isInativ ? 'ti-clock-stop' : 'ti-circle-x';
          const titulo = isInativ ? 'Sem Movimentação' : 'Estoque Zerado';
          const motivo = isInativ
            ? 'Sem lançamento há mais de 30 dias antes do período'
            : 'Último lançamento registrou <strong>0 kg</strong>';
          const row = (label, val, color) => val
            ? `<div style="display:flex;justify-content:space-between;gap:16px;padding:3px 0;border-bottom:1px solid var(--border)">
                 <span style="color:var(--text3);font-size:11px">${label}</span>
                 <span style="color:${color||'var(--text)'};font-size:11px;font-family:var(--mono);font-weight:600">${val}</span>
               </div>`
            : '';
          return `
            <div style="min-width:230px">
              <div style="display:flex;align-items:center;gap:7px;margin-bottom:9px;padding-bottom:8px;border-bottom:1px solid var(--border2)">
                <i class="ti ${icon}" style="color:${col};font-size:14px"></i>
                <span style="font-weight:700;font-size:13px;color:${col}">${titulo}</span>
              </div>
              <div style="font-size:11px;color:var(--text2);margin-bottom:9px">${motivo}</div>
              <div style="display:flex;flex-direction:column;gap:0">
                ${row('Últ. estoque lançado', _fmtD(r.ultimaData) + (r.ultimoPeso != null ? ' · ' + num(r.ultimoPeso).toLocaleString('pt-BR') + ' kg' : ''), r.motivoZerado === 'peso_zero' ? 'var(--red)' : 'var(--text)')}
                ${row('Últ. entrada (NF)', r.ultimaEntrada ? _fmtD(r.ultimaEntrada) : null, 'var(--green)')}
                ${row('Últ. saída (OS)', r.ultimaSaida ? _fmtD(r.ultimaSaida) : null, 'var(--red)')}
                ${row('Últ. mov. SAP', r.ultimoSap ? _fmtD(r.ultimoSap) : null, 'var(--accent)')}
                ${row('Total lançamentos', r.totalLancs != null ? r.totalLancs + ' registros' : null, 'var(--text2)')}
              </div>
            </div>`;
        };
        const zeroBadge = r.estoqueZerado
          ? `<span class="aus-zero-badge aus-zero-badge--tip"
               data-tip-col="${r.motivoZerado === 'inatividade' ? '#f59e0b' : '#e8666a'}"
               data-tip-html="${encodeURIComponent(_buildZeroTipHtml())}">
               <i class="ti ti-circle-x"></i> ${r.motivoZerado === 'inatividade' ? 'SEM MOVIMENTAÇÃO' : 'ESTOQUE ZERADO'}
             </span>`
          : '';
        return `
          <div class="aus-mat-row${zeroClass}">
            <span class="aus-mat-name">${escapeHtml(r.mat)}</span>
            <span class="aus-mat-type${r.semCadastro ? ' aus-mat-type--sem-cadastro' : ''}"
              ${r.semCadastro ? `title="Cadência assumida como diária por falta de cadastro — clique para cadastrar" onclick="event.stopPropagation();analiticoCadastrarMaterial('${escapeHtml(r.mat)}', event)"` : ''}
            >${typeLabel}</span>
            <div class="aus-dias-wrap">${chips}${zeroBadge}</div>
          </div>`;
      }).join('');

      const centId = (regional + '_' + central).replace(/[^\w]/g, '_');
      const centCollapsed = _ausCollapsed.central.has(centId);
      return `
        <div class="aus-central-group${centCollapsed ? ' collapsed' : ''}" data-id="${escapeHtml(centId)}">
          <div class="aus-central-label" onclick="event.stopPropagation();ausToggleCentral('${escapeHtml(centId)}')" style="cursor:pointer">
            <i class="ti ti-chevron-down aus-central-chev" style="font-size:12px;transition:transform .18s${centCollapsed ? ';transform:rotate(-90deg)' : ''}"></i>
            <i class="ti ti-building-factory-2"></i>
            ${escapeHtml(central)}
            <span class="aus-central-badge">${totalAus} ausência${totalAus !== 1 ? "s" : ""}</span>
            <button onclick="event.stopPropagation();gerarRelatorioAusenciasCentral('${escapeHtml(central).replace(/'/g, "\x27")}')"
              style="margin-left:auto;display:inline-flex;align-items:center;gap:4px;background:transparent;
                border:1px solid var(--border2);border-radius:4px;padding:1px 8px;font-size:9.5px;
                font-family:var(--mono);font-weight:600;color:var(--text3);cursor:pointer;
                transition:border-color .15s,color .15s" title="Gerar relatório desta central"
              onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--accent)'"
              onmouseout="this.style.borderColor='var(--border2)';this.style.color='var(--text3)'">
              <i class="ti ti-file-report" style="font-size:10px"></i> Relatório
            </button>
          </div>
          <div class="aus-central-body">
            ${matRows}
          </div>
        </div>`;
    }).join('');

    const regId = regional.replace(/[^\w]/g, '_');
    const regCollapsed = _ausCollapsed.regional.has(regId);
    return `
      <div class="aus-regional-group${regCollapsed ? ' collapsed' : ''}" data-id="${escapeHtml(regId)}">
        <div class="aus-regional-label" onclick="ausToggleRegional('${escapeHtml(regId)}')" style="cursor:pointer">
          <i class="ti ti-chevron-down aus-regional-chev" style="font-size:13px;transition:transform .18s${regCollapsed ? ';transform:rotate(-90deg)' : ''}"></i>
          <i class="ti ti-users-group"></i>
          ${escapeHtml(regional)}
          <span class="aus-regional-badge">${totalRegional} ausência${totalRegional !== 1 ? "s" : ""}</span>
          <span class="aus-regional-sub">${nCentrals} ${nCentrals !== 1 ? "centrais" : "central"}</span>
          <button onclick="event.stopPropagation();gerarRelatorioAusenciasRegional('${escapeHtml(regional).replace(/'/g, "\x27")}')"
            style="margin-left:auto;display:inline-flex;align-items:center;gap:4px;background:transparent;
              border:1px solid var(--border2);border-radius:4px;padding:1px 8px;font-size:9.5px;
              font-family:var(--mono);font-weight:600;color:var(--text3);cursor:pointer;
              transition:border-color .15s,color .15s" title="Gerar relatório desta regional"
            onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--accent)'"
            onmouseout="this.style.borderColor='var(--border2)';this.style.color='var(--text3)'">
            <i class="ti ti-file-report" style="font-size:10px"></i> Relatório
          </button>
        </div>
        <div class="aus-regional-body">
          ${centraisHtml}
        </div>
      </div>`;
  }).join('');

  // Sincronizar labels dos botões após render
  _ausUpdateToggleRegionaisBtn();
  _ausUpdateToggleCentralisBtn();
  // Ativa delegação de tooltips (safe to call multiple times)
  _initAusTooltipDelegation();
}
// ── Event delegation para tooltips dos badges de ausência ─────────────────
function _initAusTooltipDelegation() {
  const container = document.getElementById('ausencias-content');
  if (!container || container._ausTipBound) return;
  container._ausTipBound = true;

  container.addEventListener('mouseenter', e => {
    const badge = e.target.closest('.aus-zero-badge--tip');
    if (!badge) return;
    if (!window._showTip) return;
    const html = decodeURIComponent(badge.dataset.tipHtml || '');
    const col  = badge.dataset.tipCol || 'var(--red)';
    _showTip(e, html, col);
  }, true);

  container.addEventListener('mousemove', e => {
    if (!e.target.closest('.aus-zero-badge--tip')) return;
    if (window._moveTip) _moveTip(e);
  }, true);

  container.addEventListener('mouseleave', e => {
    if (!e.target.closest('.aus-zero-badge--tip')) return;
    if (window._hideTip) _hideTip();
  }, true);
}

function initAusencias() {
  // Só inicializa uma vez por sessão; re-render é feito via callbacks do cal-picker
  const iniEl = document.getElementById('aus-dt-ini');
  const fimEl = document.getElementById('aus-dt-fim');
  if (!iniEl) return;

  // Já tem período definido — só re-renderiza
  if (iniEl.value && fimEl?.value) {
    renderAusencias();
    return;
  }

  // Sem período ainda — mostrar empty state sem processar dados
  const subtitle = document.getElementById('ausencias-subtitle');
  const content  = document.getElementById('ausencias-content');
  if (subtitle) subtitle.textContent = 'Selecione um período para analisar';
  if (content)  content.innerHTML = `
    <div class="ausencias-empty" style="color:var(--text3)">
      <i class="ti ti-calendar-search" style="font-size:20px"></i>
      Selecione um período acima para identificar ausências de lançamento.
    </div>`;
}

// ── Aus filter state (pending/applied pattern) ──────────────
const _ausFilter = {
  options: { regional: [], central: [], categoria: [], mat: [] },
  applied: { regional: new Set(), central: new Set(), categoria: new Set(), mat: new Set() },
  pending: { regional: new Set(), central: new Set(), categoria: new Set(), mat: new Set() },
  ocultarZerados: false
};

function ausToggleOcultarZerados() {
  _ausFilter.ocultarZerados = !_ausFilter.ocultarZerados;
  const btn = document.getElementById('aus-ft-ocultar-zerados');
  if (btn) btn.classList.toggle('active', _ausFilter.ocultarZerados);
  _ausFilterSyncClear();
  renderAusencias();
}

// ── Índices de entradas/saídas por 'CENTRAL_NORM|MAT_NORM' ──────────────
// Construídos uma única vez, reutilizados em todos os _ausContextoMaterial.
let _ausEntIdx = null;  // Map<key, { d, peso }>  — última entrada
let _ausSaiIdx = null;  // Map<key, { d, peso }>  — última saída

function _ausEnsureEntSaiIdx() {
  if (_ausEntIdx) return;
  _ausEntIdx = new Map();
  _ausSaiIdx = new Map();

  (state.entradas || []).forEach(r => {
    const central_ = r.centralDestino || r.centralCompra || '';
    if (!central_ || !r.material) return;
    const key = normalizeText(central_) + '|' + normalizeText(r.material);
    const d = parseDate(r.dtEmissao || r.dtDescarga);
    if (!d) return;
    const cur = _ausEntIdx.get(key);
    if (!cur || d > cur.d) _ausEntIdx.set(key, { d, peso: num(r.peso) });
  });

  (state.saidas || []).forEach(r => {
    if (!r.central || !r.material) return;
    const key = normalizeText(r.central) + '|' + normalizeText(r.material);
    const d = parseDate(r.dtEmissao);
    if (!d) return;
    const cur = _ausSaiIdx.get(key);
    if (!cur || d > cur.d) _ausSaiIdx.set(key, { d, peso: num(r.peso) });
  });
}

function _ausInvalidateEntSaiIdx() {
  _ausEntIdx = null;
  _ausSaiIdx = null;
}

// ── Contexto completo de um par central × material ────────────────────────
// O(1) após índices construídos — sem scan linear de entradas/saídas.
function _ausContextoMaterial(central, mat) {
  _ausEnsureEntSaiIdx();

  // Lançamentos: bucket já ordenado ASC — pegar o último (index -1)
  const { byCentralMat: lancIdx } = getLancIndex();
  const lancsArr = lancIdx.get(central)?.get(mat) || [];
  let ultimoLanc = null;
  if (lancsArr.length) {
    // Bucket ordenado ASC — iterar do fim até achar com data válida
    for (let i = lancsArr.length - 1; i >= 0; i--) {
      const d = parseDate(lancsArr[i].dtLanc);
      if (d) { ultimoLanc = { peso: num(lancsArr[i].peso), d }; break; }
    }
  }

  // Entradas/saídas: O(1) via índice pré-computado
  const eKey = normalizeText(central) + '|' + normalizeText(mat);
  const ultimaEntrada = _ausEntIdx.get(eKey) || null;
  const ultimaSaida   = _ausSaiIdx.get(eKey) || null;

  // SAP: bucket do índice global — sem re-sort (pegar mais recente)
  const { byCentralMat: sapIdx } = getSapIndex();
  const sapArr = sapIdx.get(central)?.get(mat) || [];
  let ultimoSap = null;
  for (let i = sapArr.length - 1; i >= 0; i--) {
    const d = parseDate(sapArr[i].dtLanc);
    if (d) { ultimoSap = { d, peso: num(sapArr[i].peso) }; break; }
  }

  return { ultimoLanc, ultimaEntrada, ultimaSaida, ultimoSap, totalLancs: lancsArr.length };
}

// Compat
function _ausUltimoLanc(central, mat) {
  return _ausContextoMaterial(central, mat).ultimoLanc;
}

// ── Estado de collapse (regional e central) ──────────────────────────────
// Set de IDs colapsados — persiste entre renders via referência (não localStorage,
// pois o render reconstrói o DOM a cada vez)
const _ausCollapsed = {
  regional: new Set(), // armazena normalizeText(regional)
  central:  new Set(), // armazena normalizeText(central)
};

// ── Estado dos toggles globais ───────────────────────────────────────────
let _ausRegionaisExpanded = true;
let _ausCentralisExpanded = true;

function ausToggleRegional(id) {
  if (_ausCollapsed.regional.has(id)) _ausCollapsed.regional.delete(id);
  else _ausCollapsed.regional.add(id);
  const group = document.querySelector(`.aus-regional-group[data-id="${CSS.escape(id)}"]`);
  if (!group) return;
  const collapsed = _ausCollapsed.regional.has(id);
  group.classList.toggle('collapsed', collapsed);
  const chev = group.querySelector('.aus-regional-chev');
  if (chev) chev.style.transform = collapsed ? 'rotate(-90deg)' : '';
  // Recalcula estado global baseado no que está na tela
  const total     = document.querySelectorAll('.aus-regional-group').length;
  const colapsed  = document.querySelectorAll('.aus-regional-group.collapsed').length;
  _ausRegionaisExpanded = colapsed < total;
  _ausUpdateToggleRegionaisBtn();
}

function ausToggleCentral(id) {
  if (_ausCollapsed.central.has(id)) _ausCollapsed.central.delete(id);
  else _ausCollapsed.central.add(id);
  const group = document.querySelector(`.aus-central-group[data-id="${CSS.escape(id)}"]`);
  if (!group) return;
  const collapsed = _ausCollapsed.central.has(id);
  group.classList.toggle('collapsed', collapsed);
  const chev = group.querySelector('.aus-central-chev');
  if (chev) chev.style.transform = collapsed ? 'rotate(-90deg)' : '';
  const total    = document.querySelectorAll('.aus-central-group').length;
  const colapsed = document.querySelectorAll('.aus-central-group.collapsed').length;
  _ausCentralisExpanded = colapsed < total;
  _ausUpdateToggleCentralisBtn();
}

function ausToggleAllRegionais() {
  _ausRegionaisExpanded = !_ausRegionaisExpanded;
  document.querySelectorAll('.aus-regional-group').forEach(el => {
    const id = el.dataset.id;
    if (!id) return;
    el.classList.toggle('collapsed', !_ausRegionaisExpanded);
    if (_ausRegionaisExpanded) _ausCollapsed.regional.delete(id);
    else _ausCollapsed.regional.add(id);
    const chev = el.querySelector('.aus-regional-chev');
    if (chev) chev.style.transform = _ausRegionaisExpanded ? '' : 'rotate(-90deg)';
  });
  _ausUpdateToggleRegionaisBtn();
}

function ausToggleAllCentralis() {
  _ausCentralisExpanded = !_ausCentralisExpanded;
  document.querySelectorAll('.aus-central-group').forEach(el => {
    const id = el.dataset.id;
    if (!id) return;
    el.classList.toggle('collapsed', !_ausCentralisExpanded);
    if (_ausCentralisExpanded) _ausCollapsed.central.delete(id);
    else _ausCollapsed.central.add(id);
    const chev = el.querySelector('.aus-central-chev');
    if (chev) chev.style.transform = _ausCentralisExpanded ? '' : 'rotate(-90deg)';
  });
  _ausUpdateToggleCentralisBtn();
}

function _ausUpdateToggleRegionaisBtn() {
  const btn  = document.getElementById('aus-btn-toggle-regionais');
  const lbl  = document.getElementById('aus-label-toggle-regionais');
  const chev = document.getElementById('aus-chev-toggle-regionais');
  if (lbl)  lbl.textContent = _ausRegionaisExpanded ? 'Recolher Regionais' : 'Expandir Regionais';
  if (chev) chev.style.transform = _ausRegionaisExpanded ? '' : 'rotate(-90deg)';
  if (btn)  btn.classList.toggle('active', !_ausRegionaisExpanded);
}

function _ausUpdateToggleCentralisBtn() {
  const btn  = document.getElementById('aus-btn-toggle-centrais');
  const lbl  = document.getElementById('aus-label-toggle-centrais');
  const chev = document.getElementById('aus-chev-toggle-centrais');
  if (lbl)  lbl.textContent = _ausCentralisExpanded ? 'Recolher Centrais' : 'Expandir Centrais';
  if (chev) chev.style.transform = _ausCentralisExpanded ? '' : 'rotate(-90deg)';
  if (btn)  btn.classList.toggle('active', !_ausCentralisExpanded);
}

function ausExpandAll()   {
  if (!_ausRegionaisExpanded) ausToggleAllRegionais();
  if (!_ausCentralisExpanded) ausToggleAllCentralis();
}
function ausCollapseAll() {
  if (_ausRegionaisExpanded)  ausToggleAllRegionais();
  if (_ausCentralisExpanded)  ausToggleAllCentralis();
}

function _ausFilterBuildOptions(key, query = '') {
  const container = document.getElementById(`aus-fo-${key}`);
  if (!container) return;
  const opts = _ausFilter.options[key];
  const q = query.toLowerCase().trim();
  const filtered = q ? opts.filter(o => o.toLowerCase().includes(q)) : opts;
  const pending  = _ausFilter.pending[key];
  const applied  = _ausFilter.applied[key];
  if (!filtered.length) {
    container.innerHTML = `<div style="padding:12px 10px;color:var(--text3);font-size:12px;text-align:center">Nenhum resultado</div>`;
    return;
  }
  container.innerHTML = filtered.map(opt => {
    const checked = pending.size ? pending.has(opt) : applied.has(opt);
    const id = `aus-fopt-${key}-${opt.replace(/[^a-z0-9]/gi,'_')}`;
    return `<label class="micro-filter-option" for="${id}">
      <input type="checkbox" id="${id}" value="${escapeHtml(opt)}" ${checked ? 'checked' : ''}
        onchange="_ausFilterCheck('${key}', this)">
      <span class="micro-filter-option-label" title="${escapeHtml(opt)}">${escapeHtml(opt)}</span>
    </label>`;
  }).join('');
}

function _ausFilterCheck(key, checkbox) {
  const pending = _ausFilter.pending[key];
  if (checkbox.checked) pending.add(checkbox.value);
  else pending.delete(checkbox.value);
}

function _ausFilterSyncLabel(key) {
  const btn   = document.getElementById(`aus-ft-${key}`);
  const label = document.getElementById(`aus-ft-${key}-label`);
  if (!label || !btn) return;
  const keyLabel = key === 'regional' ? 'Regional' : key === 'central' ? 'Central' : key === 'categoria' ? 'Categoria' : 'Material';
  const applied  = _ausFilter.applied[key];
  if (!applied.size) {
    label.innerHTML = keyLabel;
    btn.classList.remove('active');
  } else if (applied.size === 1) {
    const val = [...applied][0];
    label.innerHTML = `${keyLabel}: <strong>${escapeHtml(val.length > 18 ? val.slice(0,18)+'…' : val)}</strong>`;
    btn.classList.add('active');
  } else {
    label.innerHTML = `${keyLabel} <span class="micro-filter-badge">${applied.size}</span>`;
    btn.classList.add('active');
  }
}

function _ausFilterSyncClear() {
  const btn = document.getElementById('aus-filter-clear-btn');
  if (!btn) return;
  const hasFilter = _ausFilter.applied.regional.size || _ausFilter.applied.central.size || _ausFilter.applied.categoria.size || _ausFilter.applied.mat.size || _ausFilter.ocultarZerados;
  btn.disabled = !hasFilter;
  btn.classList.toggle('active', !!hasFilter);
}

function toggleAusFilter(key) {
  const dd   = document.getElementById(`aus-fd-${key}`);
  const chev = document.getElementById(`aus-fc-${key}`);
  const keys = ['regional', 'central', 'categoria', 'mat'];
  // Close others
  keys.filter(k => k !== key).forEach(k => {
    document.getElementById(`aus-fd-${k}`)?.classList.remove('open');
    document.getElementById(`aus-fc-${k}`)?.classList.remove('open');
    _ausFilter.pending[k] = new Set(_ausFilter.applied[k]);
  });
  const isOpen = dd.classList.toggle('open');
  chev.classList.toggle('open', isOpen);
  if (isOpen) {
    _ausFilter.pending[key] = new Set(_ausFilter.applied[key]);
    const searchEl = document.getElementById(`aus-fs-${key}`);
    if (searchEl) searchEl.value = '';
    _ausFilterBuildOptions(key);
    setTimeout(() => searchEl?.focus(), 50);
  }
}

function filterAusOptions(key, query) { _ausFilterBuildOptions(key, query); }

function applyAusFilter(key) {
  _ausFilter.applied[key] = new Set(_ausFilter.pending[key]);
  document.getElementById(`aus-fd-${key}`)?.classList.remove('open');
  document.getElementById(`aus-fc-${key}`)?.classList.remove('open');
  _ausFilterSyncLabel(key);
  _ausFilterSyncClear();
  renderAusencias();
}

function cancelAusFilter(key) {
  _ausFilter.pending[key] = new Set(_ausFilter.applied[key]);
  document.getElementById(`aus-fd-${key}`)?.classList.remove('open');
  document.getElementById(`aus-fc-${key}`)?.classList.remove('open');
}

function clearAusFilterSingle(key) {
  _ausFilter.pending[key] = new Set();
  _ausFilter.applied[key] = new Set();
  document.getElementById(`aus-fd-${key}`)?.classList.remove('open');
  document.getElementById(`aus-fc-${key}`)?.classList.remove('open');
  _ausFilterSyncLabel(key);
  _ausFilterSyncClear();
  renderAusencias();
}

function clearAusFilters() {
  _ausFilter.applied.regional = new Set();
  _ausFilter.applied.central  = new Set();
  _ausFilter.applied.categoria = new Set();
  _ausFilter.applied.mat      = new Set();
  _ausFilter.pending.regional = new Set();
  _ausFilter.pending.central  = new Set();
  _ausFilter.pending.categoria = new Set();
  _ausFilter.pending.mat      = new Set();
  _ausFilter.ocultarZerados   = false;
  const btnZ = document.getElementById('aus-ft-ocultar-zerados');
  if (btnZ) btnZ.classList.remove('active');
  ['regional','central','categoria','mat'].forEach(k => _ausFilterSyncLabel(k));
  _ausFilterSyncClear();
  renderAusencias();
}

function ausQuickOntem() {
  const d = new Date();
  d.setHours(12, 0, 0, 0); // meio-dia para evitar problemas de fuso/DST
  d.setDate(d.getDate() - 1);
  if (typeof calSetRange === 'function') calSetRange('aus', localISODate(d), localISODate(d));
}

function ausQuickTercaAnterior() {
  const today = new Date();
  today.setHours(12, 0, 0, 0); // meio-dia para evitar problemas de DST
  const dow = today.getDay(); // 0=dom, 2=ter
  // Voltar até a última terça — se hoje já é terça, pega a terça da semana passada
  const daysBack = dow === 2 ? 7 : (dow > 2 ? dow - 2 : dow + 5);
  const terca = new Date(today);
  terca.setDate(today.getDate() - daysBack);
  if (typeof calSetRange === 'function') calSetRange('aus', localISODate(terca), localISODate(terca));
}

Object.assign(window, {
  toggleAusencias, renderAusencias, initAusencias,
  ausQuickOntem, ausQuickTercaAnterior,
  toggleAusFilter, filterAusOptions, applyAusFilter, cancelAusFilter, clearAusFilterSingle,
  clearAusFilters, _ausFilterCheck
});

function renderSAP() {
  const tb = document.getElementById('tb-sap');
  if (!tb) return;
  const data = pageSlice('sap');
  updatePageInfo('sap');
  renderSemCadastroModuloBox('sap');
  if (typeof renderSapSummary === 'function') renderSapSummary();

  if (!getFilteredData('sap').length) {
    tb.innerHTML = '<tr><td colspan="15"><div class="empty-state"><i class="ti ti-database"></i><p>Nenhuma movimentação SAP importada.</p></div></td></tr>';
    return;
  }

  const _sapDupKeys = getSapDuplicateKeys();

  tb.innerHTML = data.map((r, i) => {
    const neg = num(r.peso) < 0;
    const red = '#ef4444';
    const green = '#22c55e';
    const text = 'inherit';
    const rKey = getSapRecordKey(r);
    const isDupReal      = _sapDupKeys.real.has(rKey);
    const isDupCancelled = !isDupReal && _sapDupKeys.cancelled.has(rKey);
    const isFechPattern  = typeof isSapFechamentoPattern === 'function' && isSapFechamentoPattern(r);
    // Documento justificado no Inventário tem prioridade sobre o resultado
    // padrão de isSapExcluidoPorFechamento — mesma trava, só que aqui
    // precisamos saber o MOTIVO específico pra escolher o badge certo
    // (ver isSapDocJustificadoInventario, ui.js).
    const isFechTravadoInv = isFechPattern && typeof isSapDocJustificadoInventario === 'function' && isSapDocJustificadoInventario(r);
    const isFechExcluido = isFechPattern && typeof isSapExcluidoPorFechamento === 'function' && isSapExcluidoPorFechamento(r);
    const trClass = isDupReal ? ' class="sap-duplicata"' : isDupCancelled ? ' class="sap-duplicata-anulada"' : isFechPattern ? ' class="sap-fechamento"' : '';
    const trTitle = isDupReal ? ' title="Integração duplicada sem estorno correspondente"' : isDupCancelled ? ' title="Duplicata anulada por estorno"' : '';
    const _sapSemCad = !getCatKeyDoCadastro(r.materialOriginal);
    const fechBadgeHtml = isFechPattern
      ? (isFechTravadoInv
          ? '<span class="badge-fechamento badge-fechamento--inventario" title="Documento SAP preenchido em uma justificativa do Inventário — sempre desconsiderado do cálculo de variação. Para reverter, apague o campo Documento SAP naquela justificativa.">Justificado no Inventário</span>'
          : isFechExcluido
            ? '<span class="badge-fechamento" title="Ajuste de Fechamento Mensal — desconsiderado do cálculo de variação. Gerencie em Movimentações SAP → botão Fechamento.">Fechamento</span>'
            : '<span class="badge-fechamento badge-fechamento--incluido" title="Ajuste de Fechamento Mensal — reincluído manualmente no cálculo. Gerencie em Movimentações SAP → botão Fechamento.">Fechamento · incluído</span>')
      : '';
    return `
    <tr${trClass}${trTitle}>
      <td class="td-mono">${r.fonte === 'manual' ? '<span class="badge-manual" title="Registro inserido manualmente"><i class="ti ti-pencil"></i></span>' : ''}${r.usuario || '—'}</td>
      <td class="td-mono" style="color:${neg ? red : green}">${r.movimento || '—'}${fechBadgeHtml}</td>
      <td class="td-muted">${r.ref || '—'}</td>
      <td class="td-mono">${r.documento || '—'}</td>
      <td class="td-mono">${r.central || '—'}</td>
      <td class="td-muted">${r.deposito || '—'}</td>
      <td class="td-muted">${r.dtDoc || '—'}</td>
      <td class="td-muted">${r.dtLanc || '—'}</td>
      <td class="td-muted">${r.dtReg || '—'}</td>
      <td class="td-mono">${r.material || r.materialOriginal || '—'}${_sapSemCad ? ' ' + semCadastroBadgeHtml(r.materialOriginal) : ''}</td>
      <td class="td-mono" style="color:${neg ? red : green}">${num(r.peso).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      <td>${r.um || '—'}</td>
      <td class="td-mono" style="color:${neg ? red : text}">${money(r.custoUnit, 4)}</td>
      <td class="td-mono" style="color:#60a5fa">${money(r.valorTotal, 2)}</td>
      <td><button class="btn-icon danger" onclick="removerRegistro('sap', ${i})"><i class="ti ti-trash"></i></button></td>
    </tr>`;
  }).join('');
  makeResizable(tb.closest('table'));
  injectColFilterButtons(tb.closest('table'), 'sap');
}

function renderProducao() {
  const tb = document.getElementById('tb-producao');
  if (!tb) return;

  const data = getFilteredData('producao');
  const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
  if (currentPageProducao >= totalPages) currentPageProducao = totalPages - 1;
  if (currentPageProducao < 0) currentPageProducao = 0;

  const pageData = data.slice(currentPageProducao * PAGE_SIZE, (currentPageProducao + 1) * PAGE_SIZE);
  updatePageInfo('producao');

  const centrais = new Set(state.producao.map(r => r.central).filter(Boolean));
  const prodTotal = state.producao.reduce((a, b) => a + num(b.producao), 0);
  const vendasTotal = state.producao.reduce((a, b) => a + num(b.totalVendas), 0);
  const custoMedio = state.producao.length ? state.producao.reduce((a, b) => a + num(b.custoMedio), 0) / state.producao.length : 0;

  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  set('prod-centrais', centrais.size);
  set('prod-total', prodTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  set('prod-vendas', money(vendasTotal));
  set('prod-custo', money(custoMedio));
  set('prod-margem', state.producao.length ? '—' : '—');

  if (!data.length) {
    tb.innerHTML = '<tr><td colspan="9"><div class="empty-state"><i class="ti ti-chart-bar"></i><p>Nenhum registro de produção importado.</p></div></td></tr>';
    return;
  }

  tb.innerHTML = pageData.map((r, i) => `
    <tr>
      <td class="td-mono">${r.fonte === 'manual' ? '<span class="badge-manual" title="Registro inserido manualmente"><i class="ti ti-pencil"></i></span>' : ''}${r.mes || '—'}</td>
      <td class="td-mono">${r.central || '—'}</td>
      <td class="td-mono" style="color:var(--teal)">${num(r.producao).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      <td>${r.um || 'm³'}</td>
      <td class="td-mono">${money(r.precoMedio)}</td>
      <td class="td-mono">${money(r.custoMedio)}</td>
      <td class="td-mono">${r.margem || '—'}</td>
      <td class="td-mono" style="color:#f59e0b">${money(r.totalVendas)}</td>
      <td><button class="btn-icon danger" onclick="excluirProducao(${currentPageProducao * PAGE_SIZE + i})"><i class="ti ti-trash"></i></button></td>
    </tr>
  `).join('');
  makeResizable(tb.closest('table'));
  injectColFilterButtons(tb.closest('table'), 'producao');
}

function renderConfigs() {
  if (typeof shortcutsRender === 'function') shortcutsRender();
  const tb = document.getElementById('tb-configs');
  if (!tb) return;
  const { data, pageData } = getListPageData('configs');
  updateListPageInfo('configs');
  if (!data.length) {
    tb.innerHTML = '<tr><td colspan="5"><div class="empty-state"><i class="ti ti-adjustments"></i><p>Nenhuma configuração personalizada.</p></div></td></tr>';
    return;
  }
  tb.innerHTML = pageData.map((c, i) => `
    <tr>
      <td class="td-mono">${c.key}</td>
      <td>${c.value}</td>
      <td class="td-muted">${c.desc || '—'}</td>
      <td class="td-muted">${c.created || '—'}</td>
      <td><button class="btn-icon danger" onclick="removerConfig(${listPages.configs * PAGE_SIZE + i})"><i class="ti ti-trash"></i></button></td>
    </tr>
  `).join('');
  const _tbl_configs = document.getElementById('tb-configs')?.closest('table');
  if (_tbl_configs) injectColFilterButtons(_tbl_configs, 'configs');
  updateImportPrereqUI();
}

function updateParamGerais() {
  // centrais_ativas — unique centrals from SAP module
  const centraisSap = new Set(state.sap.map(r => r.central).filter(Boolean));
  const cfgCentrais = document.getElementById('cfg-centrais');
  if (cfgCentrais) {
    const count = centraisSap.size;
    cfgCentrais.textContent = count > 0 ? count : '—';
    cfgCentrais.style.color = count > 0 ? 'var(--accent)' : '';
    cfgCentrais.title = count > 0 ? [...centraisSap].sort().join(', ') : '';
  }

  // responsavel_padrao — load from configs state
  const respInput = document.getElementById('cfg-resp-input');
  if (respInput) {
    const saved = (state.configs.find(c => c.key === '__responsavel_padrao__') || {}).value || '';
    respInput.value = saved;
  }
}

function saveResponsavel(value) {
  const trimmed = value.trim();
  const existing = state.configs.findIndex(c => c.key === '__responsavel_padrao__');
  const rec = { key: '__responsavel_padrao__', value: trimmed, desc: 'Analista responsável padrão', created: new Date().toLocaleDateString('pt-BR') };
  if (existing >= 0) state.configs[existing] = rec;
  else state.configs.unshift(rec);
  persist();
  updateImportPrereqUI();
  if (typeof _configsSyncUpsert === 'function') _configsSyncUpsert(rec);
}

// ═══════════════════════════════════════════════════════════
// INDICADOR DE PENDÊNCIAS DE PADRONIZAÇÃO — Configurações
// ═══════════════════════════════════════════════════════════
// Preenche #pend-centrais-box e #pend-materiais-box (logo acima de cada
// tabela de cadastro) com um botão pulsante que abre um modal sob demanda
// com o resultado de getPendenciasPadronizacao() (normalize.js). Chamado
// ao final de renderFiliais()/renderMateriais(), então se atualiza
// sozinho sempre que essas tabelas são redesenhadas — cadastro novo,
// exclusão, importação em lote, "Atualizar Cadastros" etc. — sem precisar
// espalhar chamadas extras pelo código.
function _pendPadrItemMaterialHtml(item) {
  const semCategoria = item.motivo === 'sem_categoria';
  const motivoLabel  = semCategoria ? 'sem categoria' : 'não cadastrado';
  const info = semCategoria
    ? `<span class="pend-padr-info">→ já padronizado como "${escapeHtml(item.aliasPadronizado)}"</span>`
    : '';
  return `
    <div class="pend-padr-item">
      <div class="pend-padr-main">
        <span class="pend-padr-nome" title="${escapeHtml(item.nome)}">${escapeHtml(item.nome)}</span>
        <span class="pend-padr-motivo pend-padr-motivo-${item.motivo}">${motivoLabel}</span>
        ${info}
      </div>
      <span class="pend-padr-count">${item.count} registro(s)</span>
      <button class="btn-icon pend-padr-add" type="button" title="${semCategoria ? 'Completar categoria no cadastro' : 'Cadastrar agora'}"
        data-tipo="material" data-motivo="${item.motivo}"
        data-nome="${escapeHtml(item.nome)}"
        data-origem="${escapeHtml(item.origemCadastro || item.nome)}"
        data-alias="${escapeHtml(item.aliasPadronizado || '')}">
        <i class="ti ${semCategoria ? 'ti-edit' : 'ti-plus'}"></i>
      </button>
    </div>`;
}

function _pendPadrItemCentralHtml(item) {
  return `
    <div class="pend-padr-item">
      <div class="pend-padr-main">
        <span class="pend-padr-nome" title="${escapeHtml(item.nome)}">${escapeHtml(item.nome)}</span>
        <span class="pend-padr-motivo pend-padr-motivo-nao_cadastrado">não cadastrada</span>
      </div>
      <span class="pend-padr-count">${item.count} registro(s)</span>
      <button class="btn-icon pend-padr-add" type="button" title="Cadastrar agora"
        data-tipo="central" data-motivo="nao_cadastrado" data-nome="${escapeHtml(item.nome)}">
        <i class="ti ti-plus"></i>
      </button>
    </div>`;
}

// Foca o textarea de cadastro em lote com o cursor no final do texto
// pré-preenchido, pra o analista só completar o que falta.
function _pendPadronizacaoFocarFinal(id) {
  setTimeout(() => {
    const el = document.getElementById(id);
    if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; }
  }, 50);
}

// Ação do botão "cadastrar/completar" de cada item pendente:
//   - central / material não cadastrado → abre o modal já com "NOME = "
//     pronto pro analista completar o alias (e a categoria, se material).
//   - material sem categoria → usa origem/alias EXATOS do cadastro já
//     existente ("ORIGEM = ALIAS = "), pra reimportar como UPDATE
//     (upsertMateriais casa por origem+alias) em vez de criar duplicata.
function _pendPadronizacaoAbrirCadastro(btn) {
  const { tipo, motivo, nome, origem, alias } = btn.dataset;
  document.getElementById('alert-modal-pend-material')?.remove();
  document.getElementById('alert-modal-pend-central')?.remove();
  if (tipo === 'central') {
    abrirCadastroFilialIndividual({ origem: nome, focus: 'alias' });
    return;
  }
  if (motivo === 'sem_categoria') {
    // Origem/alias exatos do cadastro já existente — o analista só precisa
    // completar a categoria (upsertMateriais casa por origem+alias, então
    // isso atualiza o registro em vez de criar duplicata).
    abrirCadastroMaterialIndividual({ origem, alias, focus: 'categoria' });
  } else {
    abrirCadastroMaterialIndividual({ origem: nome, focus: 'alias' });
  }
}

document.addEventListener('click', e => {
  const btn = e.target.closest('.pend-padr-add');
  if (btn) _pendPadronizacaoAbrirCadastro(btn);
});

// Abre o modal com a lista completa de pendências (material ou central) —
// scroll interno, sem paginação "ver mais".
function _pendPadronizacaoAbrirModal(tipo) {
  const modalId = `alert-modal-pend-${tipo}`;
  document.getElementById(modalId)?.remove();
  if (typeof getPendenciasPadronizacao !== 'function') return;

  const { materiais, centrais } = getPendenciasPadronizacao();
  const isMaterial = tipo === 'material';
  const lista   = isMaterial ? materiais : centrais;
  const itemFn  = isMaterial ? _pendPadrItemMaterialHtml : _pendPadrItemCentralHtml;
  const singular = isMaterial ? 'material' : 'central';
  const plural   = isMaterial ? 'materiais' : 'centrais';
  const fontes   = isMaterial ? 'Entradas/Saídas/Lançamentos/SAP' : 'Entradas/Saídas/Lançamentos/SAP/Produção';
  const criterio = isMaterial ? 'sem cadastro ou cadastrado sem categoria' : 'sem cadastro';
  if (!lista.length) return;

  const total = lista.length;
  const overlay = document.createElement('div');
  overlay.id = modalId;
  overlay.className = 'alert-modal-overlay';
  const _escPendPadr = (e) => {
    if (!document.body.contains(overlay)) { document.removeEventListener('keydown', _escPendPadr); return; }
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', _escPendPadr); }
  };
  document.addEventListener('keydown', _escPendPadr);
  overlay.innerHTML = `
    <div class="alert-modal-card">
      <div class="alert-modal-header">
        <div>
          <div class="alert-modal-title is-amber"><i class="ti ti-alert-triangle"></i> Há ${plural} pendentes de padronização</div>
          <div class="alert-modal-sub">${total} ${total === 1 ? singular : plural} vist${isMaterial ? (total === 1 ? 'o' : 'os') : (total === 1 ? 'a' : 'as')} em ${fontes}, ${criterio}</div>
        </div>
        <button class="alert-modal-close" onclick="document.getElementById('${modalId}').remove()"><i class="ti ti-x"></i></button>
      </div>
      <div class="alert-modal-body"><div class="pend-padr-list">${lista.map(itemFn).join('')}</div></div>
    </div>`;
  document.body.appendChild(overlay);
}
window._pendPadronizacaoAbrirModal = _pendPadronizacaoAbrirModal;

// Renderiza o botão pulsante para materiais OU centrais, conforme total.
function _pendPadronizacaoBtnHtml(tipo, total) {
  const isMaterial = tipo === 'material';
  const singular = isMaterial ? 'material' : 'central';
  const plural   = isMaterial ? 'materiais' : 'centrais';

  if (!total) {
    return `
      <button type="button" class="alert-pulse-btn is-ok" disabled>
        <i class="ti ti-circle-check"></i>
        ${isMaterial ? 'Materiais' : 'Centrais'} padronizad${isMaterial ? 'os' : 'as'} OK
      </button>`;
  }

  return `
    <button type="button" class="alert-pulse-btn is-amber" onclick="_pendPadronizacaoAbrirModal('${tipo}')">
      <i class="ti ti-alert-triangle"></i>
      Há ${total} ${total === 1 ? singular : plural} pendente${total === 1 ? '' : 's'} de padronização
    </button>`;
}

function renderPendenciasPadronizacao() {
  const elMat = document.getElementById('pend-materiais-box');
  const elCen = document.getElementById('pend-centrais-box');
  if ((!elMat && !elCen) || typeof getPendenciasPadronizacao !== 'function') return;

  const { materiais, centrais } = getPendenciasPadronizacao();
  if (elMat) elMat.innerHTML = _pendPadronizacaoBtnHtml('material', materiais.length);
  if (elCen) elCen.innerHTML = _pendPadronizacaoBtnHtml('central', centrais.length);
}

// ═══════════════════════════════════════════════════════════
// INDICADOR DE CADASTROS DUPLICADOS/CONFLITANTES — Configurações → Materiais
// ═══════════════════════════════════════════════════════════
// Botão pulsante (#dup-materiais-box) que abre um modal sob demanda com o
// resultado de getDuplicatasCadastroMateriais() (normalize.js). Mesmo
// padrão de chamada de renderPendenciasPadronizacao: acionado ao final de
// renderMateriais(), se atualiza sozinho a cada redesenho da tabela.
function _dupCadGroupHtml(grupo) {
  const rows = grupo.registros.map(r => `
    <div class="dup-cad-row">
      <span class="dup-cad-alias" title="${escapeHtml(r.alias)}">${escapeHtml(r.alias)}</span>
      ${r.categoria ? `<span style="font-size:10px;color:var(--text3)">${escapeHtml(r.categoria)}</span>` : ''}
      <span class="dup-cad-badge ${r.vencendo ? 'dup-cad-badge-venc' : 'dup-cad-badge-morto'}">
        ${r.vencendo ? 'aplicado hoje' : 'ignorado'}
      </span>
      <button class="btn-icon" type="button" title="Editar este cadastro"
        onclick="_dupCadEditar('${escapeHtml(r.id)}')">
        <i class="ti ti-edit"></i>
      </button>
    </div>`).join('');

  return `
    <div class="dup-cad-group">
      <div class="dup-cad-origem"><i class="ti ti-git-branch"></i> Origem: <b title="${escapeHtml(grupo.origem)}">${escapeHtml(grupo.origem)}</b></div>
      ${rows}
    </div>`;
}

function _dupCadEditar(id) {
  const item = (state.materiais || []).find(m => m.id === id);
  if (!item) return;
  document.getElementById('alert-modal-dup-cad')?.remove();
  abrirCadastroMaterialIndividual({ origem: item.origem, alias: item.alias, categoria: item.categoria, focus: 'alias' });
}
window._dupCadEditar = _dupCadEditar;

// Abre o modal com a lista completa de conflitos (scroll interno — sem
// paginação "ver mais", já que o modal comporta a lista inteira).
function _dupCadAbrirModal() {
  document.getElementById('alert-modal-dup-cad')?.remove();
  if (typeof getDuplicatasCadastroMateriais !== 'function') return;
  const conflitos = getDuplicatasCadastroMateriais();
  if (!conflitos.length) return;

  const overlay = document.createElement('div');
  overlay.id = 'alert-modal-dup-cad';
  overlay.className = 'alert-modal-overlay';
  const _escDupCad = (e) => {
    if (!document.body.contains(overlay)) { document.removeEventListener('keydown', _escDupCad); return; }
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', _escDupCad); }
  };
  document.addEventListener('keydown', _escDupCad);
  overlay.innerHTML = `
    <div class="alert-modal-card">
      <div class="alert-modal-header">
        <div>
          <div class="alert-modal-title is-red"><i class="ti ti-alert-octagon"></i> Há cadastro de materiais conflitantes</div>
          <div class="alert-modal-sub">${conflitos.length} origem${conflitos.length === 1 ? '' : 's'} com o mesmo nome apontando para Grupos SAP diferentes — apenas um cadastro é aplicado, o(s) outro(s) fica(m) ignorado(s) silenciosamente</div>
        </div>
        <button class="alert-modal-close" onclick="document.getElementById('alert-modal-dup-cad').remove()"><i class="ti ti-x"></i></button>
      </div>
      <div class="alert-modal-body">${conflitos.map(_dupCadGroupHtml).join('')}</div>
    </div>`;
  document.body.appendChild(overlay);
}
window._dupCadAbrirModal = _dupCadAbrirModal;

function renderDuplicatasCadastroMateriais() {
  const el = document.getElementById('dup-materiais-box');
  if (!el || typeof getDuplicatasCadastroMateriais !== 'function') return;

  const conflitos = getDuplicatasCadastroMateriais();
  const total = conflitos.length;

  if (!total) {
    el.innerHTML = `
      <button type="button" class="alert-pulse-btn is-ok" disabled>
        <i class="ti ti-circle-check"></i>
        Cadastros de materiais OK
      </button>`;
    return;
  }

  el.innerHTML = `
    <button type="button" class="alert-pulse-btn is-red" onclick="_dupCadAbrirModal()">
      <i class="ti ti-alert-octagon"></i>
      Há ${total} cadastro${total === 1 ? '' : 's'} de materiais conflitante${total === 1 ? '' : 's'}
    </button>`;
}

function renderFiliais() {
  const tb = document.getElementById('tb-filiais');
  if (!tb) return;
  const { data, pageData } = getListPageData('filiais');
  updateListPageInfo('filiais');
  if (!data.length) {
    tb.innerHTML = '<tr><td colspan="5"><div class="empty-state"><i class="ti ti-map-pin"></i><p>Nenhuma filial cadastrada.</p></div></td></tr>';
    renderPendenciasPadronizacao();
    return;
  }
  tb.innerHTML = pageData.map((f, i) => `
    <tr>
      <td class="td-mono">${f.origem}</td>
      <td class="td-mono">${f.alias}</td>
      <td class="td-muted">${f.cnpj || '—'}</td>
      <td class="td-muted">${f.regional || '—'}</td>
      <td class="td-muted">${f.created || '—'}</td>
      <td><button class="btn-icon danger" onclick="removerFilial(${listPages.filiais * PAGE_SIZE + i})"><i class="ti ti-trash"></i></button></td>
    </tr>
  `).join('');
  const _tbl_filiais = document.getElementById('tb-filiais')?.closest('table');
  if (_tbl_filiais) injectColFilterButtons(_tbl_filiais, 'filiais');
  updateImportPrereqUI();
  renderPendenciasPadronizacao();
}

function renderMateriais() {
  const tb = document.getElementById('tb-materiais');
  if (!tb) return;
  if (typeof migrarCategoriaLegadaMateriais === 'function' && migrarCategoriaLegadaMateriais()) {
    persistStateNow().catch(e => console.warn('Falha ao salvar migração de categoria de materiais:', e));
  }
  const { data, pageData } = getListPageData('materiais');
  updateListPageInfo('materiais');
  if (!data.length) {
    tb.innerHTML = '<tr><td colspan="5"><div class="empty-state"><i class="ti ti-stack-2"></i><p>Nenhum material cadastrado.</p></div></td></tr>';
    renderDuplicatasCadastroMateriais();
    renderPendenciasPadronizacao();
    return;
  }
  tb.innerHTML = pageData.map((m, i) => `
    <tr>
      <td class="td-mono">${m.origem}</td>
      <td class="td-mono">${m.alias}</td>
      <td class="td-muted">${m.categoria ? `<span style="font-size:10px;background:var(--bg4);border:1px solid var(--border2);border-radius:20px;padding:2px 8px;color:var(--text2);white-space:nowrap">${escapeHtml(m.categoria)}</span>` : '—'}</td>
      <td class="td-muted">${m.created || '—'}</td>
      <td><button class="btn-icon danger" onclick="removerMaterial('${m.id}', this)"><i class="ti ti-trash"></i></button></td>
    </tr>
  `).join('');
  const _tbl_materiais = document.getElementById('tb-materiais')?.closest('table');
  if (_tbl_materiais) injectColFilterButtons(_tbl_materiais, 'materiais');
  updateImportPrereqUI();
  renderDuplicatasCadastroMateriais();
  renderPendenciasPadronizacao();
}

function renderAcoesRelatorio() {
  const tb = document.getElementById('tb-acoes-relatorio');
  if (!tb) return;
  const { data, pageData } = getListPageData('acoesRelatorio');
  updateListPageInfo('acoesRelatorio');
  if (!data.length) {
    tb.innerHTML = '<tr><td colspan="5"><div class="empty-state"><i class="ti ti-list-check"></i><p>Nenhuma ação cadastrada.</p></div></td></tr>';
    return;
  }
  const nivelLabel = {
    'bom':     '<span style="color:#22c55e;font-weight:700">🟢 BOM</span>',
    'atencao': '<span style="color:#f59e0b;font-weight:700">⚠️ ATENÇÃO</span>',
    'urgente': '<span style="color:#f97316;font-weight:700">🟠 URGENTE</span>',
    'critico': '<span style="color:#ef4444;font-weight:700">🔴 CRÍTICO</span>',
  };
  const catLabel = {
    'AGREGADOS MIUDOS':   'Agr. Miúdos',
    'AGREGADOS GRAUDOS':  'Agr. Graúdos',
    'AGLOMERANTES':       'Aglomerantes',
    'ADITIVOS E ADICOES': 'Aditivos e Adições',
  };
  tb.innerHTML = pageData.map((a, i) => {
    const cats = (Array.isArray(a.categorias) ? a.categorias : (a.material ? [a.material] : []));
    const catsHtml = cats.map(c => `<span style="display:inline-block;padding:1px 7px;border-radius:10px;font-size:10px;background:var(--bg3);border:1px solid var(--border);color:var(--text2);margin:1px 2px 1px 0">${escapeHtml(catLabel[c] || c)}</span>`).join('');
    const nivel = a.nivel || (a.operador ? 'legado' : '');
    return `
    <tr>
      <td style="min-width:160px">${catsHtml}</td>
      <td class="td-mono" style="white-space:nowrap">${nivelLabel[nivel] || escapeHtml(nivel)}</td>
      <td style="max-width:340px;line-height:1.5">${escapeHtml(a.acoes)}</td>
      <td class="td-muted">${a.created || '—'}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn-icon" onclick="editarAcaoRelatorio('${escapeHtml(a.id)}')" title="Editar"><i class="ti ti-pencil"></i></button>
          <button class="btn-icon danger" onclick="removerAcaoRelatorio('${escapeHtml(a.id)}')" title="Excluir"><i class="ti ti-trash"></i></button>
        </div>
      </td>
    </tr>
  `}).join('');
  const _tbl = document.getElementById('tb-acoes-relatorio')?.closest('table');
  if (_tbl) injectColFilterButtons(_tbl, 'acoesRelatorio');
}


function pageFromModulo(modulo) {
  const map = {
    'Entrada': 'entradas',
    'Saída': 'saidas',
    'Lançamento': 'lancamentos',
    'SAP': 'sap',
    'Produção': 'producao'
  };
  return map[modulo] || 'dashboard';
}

function renderModule(module) {
  switch (module) {
    case 'dashboard': return updateDashboard();
    case 'entradas': return renderEntradas();
    case 'saidas': return renderSaidas();
    case 'lancamentos': return renderLancamentos();
    case 'sap': return renderSAP();
    case 'producao': return renderProducao();
    case 'importar': return renderImports();
    case 'configuracoes': renderConfigs(); renderAcoesRelatorio(); loadHealthConfigInputs(); updateParamGerais(); return;
    case 'filiais': return renderFiliais();
    case 'materiais': return renderMateriais();
    default: return;
  }
}

function removerRegistro(module, index) {
  const data = getFilteredData(module);
  const actual = data[(module === 'producao' ? currentPageProducao : pages[module]) * PAGE_SIZE + index];
  if (!actual) return;
  if (!confirm('Deseja realmente excluir este registro?')) return;

  state[module] = state[module].filter(r => r !== actual);

  // Invalida índices do módulo removido
  if (module === 'lancamentos') invalidateLancIndex();
  else if (module === 'sap')    invalidateSapIndex();
  else if (module === 'saidas') invalidateSaidasIndex();
  else invalidateSearchIndex(module);

  persist();
  renderModule(module);
  updateDashboard();
  toast('Registro excluído com sucesso');

  // Sincroniza a exclusão com o Supabase — só os módulos já migrados na
  // Fase 4 têm função aqui; os demais simplesmente não entram no mapa.
  // Só dispara pra registros manuais (sem importId) — os importados nunca
  // foram sincronizados (decisão de 27/07), então não há o que excluir lá.
  const syncDeleteByModule = {
    lancamentos: (typeof _lancSyncDelete === 'function') ? _lancSyncDelete : null,
    entradas:    (typeof _entradasSyncDelete === 'function') ? _entradasSyncDelete : null,
  };
  const syncDelete = syncDeleteByModule[module];
  if (syncDelete && actual.id && !actual.importId) syncDelete(actual.id);
}


// ── Detecção de conflitos entre registros manuais e importação ──────────────
// Um conflito ocorre quando um registro importado tem a mesma "identidade base"
// que um registro manual, mas com dados diferentes (ex: peso diferente).
// A "identidade base" exclui o peso do fingerprint para detectar registros
// do mesmo evento com valores distintos.

function _fpBaseEntrada(r) {
  return [normalizeText(r.centralDestino || r.centralCompra || ''), normalizeText(r.material || ''), r.nf || '', r.dtEmissao || ''].join('|');
}
function _fpBaseSaida(r) {
  return [normalizeText(r.central || ''), normalizeText(r.material || ''), r.os || '', r.dtEmissao || ''].join('|');
}
function _fpBaseLancamento(r) {
  return [normalizeText(r.central || ''), normalizeText(r.material || ''), r.dtLanc || ''].join('|');
}
function _fpBaseSap(r) {
  return [normalizeText(r.central || ''), normalizeText(r.material || ''), r.documento || '', r.movimento || '', r.dtLanc || ''].join('|');
}
function _fpBaseProducao(r) {
  return [normalizeText(r.central || ''), r.mes || ''].join('|');
}

const _fpBaseFns = {
  'Entrada': _fpBaseEntrada, 'Saída': _fpBaseSaida,
  'Lançamento': _fpBaseLancamento, 'SAP': _fpBaseSap, 'Produção': _fpBaseProducao
};
const _fpFns = {
  'Entrada': _fpEntrada, 'Saída': _fpSaida,
  'Lançamento': _fpLancamento, 'SAP': _fpSap, 'Produção': _fpProducao
};
const _stateArrays = () => ({
  'Entrada': state.entradas, 'Saída': state.saidas,
  'Lançamento': state.lancamentos, 'SAP': state.sap, 'Produção': state.producao
});

function _detectConflicts(modulo, incoming) {
  const fpBase = _fpBaseFns[modulo];
  const fp     = _fpFns[modulo];
  if (!fpBase || !fp) return [];

  const existing = _stateArrays()[modulo] || [];
  const manuais  = existing.filter(r => r.fonte === 'manual');
  if (!manuais.length) return [];

  // Índice dos manuais por base-fingerprint
  const manualByBase = new Map();
  manuais.forEach(r => {
    const b = fpBase(r);
    if (!manualByBase.has(b)) manualByBase.set(b, []);
    manualByBase.get(b).push(r);
  });

  const conflicts = [];
  incoming.forEach(rec => {
    const b  = fpBase(rec);
    const f  = fp(rec);
    const ms = manualByBase.get(b);
    if (!ms) return;
    ms.forEach(manual => {
      // Mesmo evento base mas fingerprint completo diferente = dados divergem
      if (fp(manual) !== f) {
        conflicts.push({ manual, importado: rec });
      }
    });
  });

  // Deduplicar conflitos (mesmo par pode aparecer várias vezes)
  const seen = new Set();
  return conflicts.filter(c => {
    const k = fp(c.manual) + '|||' + fp(c.importado);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

// Resolução dos conflitos — chamada pelo modal
// decisions: Map<idx, 'manual'|'importado'|'ambos'>
let _pendingMerge = null;
function _resolveConflicts(decisions) {
  if (!_pendingMerge) return;
  const { modulo, incoming, conflicts, resolve } = _pendingMerge;
  _pendingMerge = null;

  const fp       = _fpFns[modulo];
  const toRemove = new Set(); // fps de manuais a remover
  const toSkip   = new Set(); // fps de importados a não inserir

  conflicts.forEach((c, idx) => {
    const dec = decisions.get(idx) || 'importado';
    if (dec === 'manual') {
      // Mantém manual — ignora importado com mesmo base
      toSkip.add(fp(c.importado));
    } else if (dec === 'importado') {
      // Usa importado — remove manual
      toRemove.add(fp(c.manual));
    }
    // 'ambos': não faz nada — mantém os dois
  });

  // Aplica remoções de manuais
  const arr = _stateArrays();
  if (toRemove.size) {
    const stateKey = { 'Entrada': 'entradas', 'Saída': 'saidas', 'Lançamento': 'lancamentos', 'SAP': 'sap', 'Produção': 'producao' }[modulo];
    if (stateKey) {
      // Fase 4: registros já sincronizados com a nuvem precisam ser
      // removidos lá também — senão, no próximo boot, o sync mescla
      // local ∪ nuvem por id e o registro que você descartou aqui
      // "ressuscita" porque ainda existe do lado da nuvem. Mapa de função
      // de exclusão por módulo — só os módulos já migrados na Fase 4 têm
      // uma função aqui; os demais (Entrada/Saída/SAP ainda não
      // sincronizados) simplesmente não entram no mapa.
      const syncDeleteByModulo = {
        'Lançamento': (typeof _lancSyncDelete === 'function') ? _lancSyncDelete : null,
        'Produção':   (typeof _producaoSyncDelete === 'function') ? _producaoSyncDelete : null,
        'Entrada':    (typeof _entradasSyncDelete === 'function') ? _entradasSyncDelete : null,
      };
      const syncDelete = syncDeleteByModulo[modulo];
      if (syncDelete) {
        conflicts.forEach(c => {
          if (toRemove.has(fp(c.manual)) && c.manual.id) syncDelete(c.manual.id);
        });
      }
      state[stateKey] = state[stateKey].filter(r => !toRemove.has(fp(r)));
    }
  }

  // Filtra importados conforme decisão
  const filteredIncoming = incoming.filter(r => !toSkip.has(fp(r)));
  resolve(filteredIncoming);
}
window._resolveConflicts = _resolveConflicts;

function _showConflictModal(modulo, conflicts) {
  const sub  = document.getElementById('conflict-modal-sub');
  const list = document.getElementById('conflict-list');
  if (!sub || !list) return;

  // Esconde o loading overlay temporariamente para que o modal de conflito
  // fique visível sem sobreposição. O overlay é restaurado em conflictConfirm()
  // logo antes de o processamento retomar.
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.classList.remove('open');

  sub.textContent = `${conflicts.length} conflito${conflicts.length !== 1 ? 's' : ''} encontrado${conflicts.length !== 1 ? 's' : ''} em ${modulo}`;

  const fmtVal = (r, modulo) => {
    if (modulo === 'Lançamento' || modulo === 'SAP') return `${num(r.peso).toLocaleString('pt-BR')} kg · ${r.dtLanc || '—'}`;
    if (modulo === 'Entrada')  return `${num(r.peso).toLocaleString('pt-BR')} kg · NF ${r.nf || '—'} · ${r.dtEmissao || '—'}`;
    if (modulo === 'Saída')    return `${num(r.peso).toLocaleString('pt-BR')} kg · OS ${r.os || '—'} · ${r.dtEmissao || '—'}`;
    if (modulo === 'Produção') return `${num(r.producao).toLocaleString('pt-BR')} m³ · ${r.mes || '—'}`;
    return JSON.stringify(r).slice(0, 80);
  };

  list.innerHTML = conflicts.map((c, idx) => `
    <div class="conflict-row" id="conflict-row-${idx}">
      <div class="conflict-row-header">
        <span class="conflict-idx">#${idx + 1}</span>
        <span class="conflict-entity">${escapeHtml(c.manual.central || c.manual.centralDestino || '—')} · ${escapeHtml(c.manual.material || '—')}</span>
      </div>
      <div class="conflict-cols">
        <label class="conflict-option" id="conflict-opt-${idx}-manual">
          <input type="radio" name="conflict-${idx}" value="manual" onchange="conflictMark(${idx},'manual')">
          <div class="conflict-option-body conflict-manual">
            <div class="conflict-option-label"><i class="ti ti-hand-stop"></i> Manual</div>
            <div class="conflict-option-val">${escapeHtml(fmtVal(c.manual, modulo))}</div>
          </div>
        </label>
        <label class="conflict-option" id="conflict-opt-${idx}-importado">
          <input type="radio" name="conflict-${idx}" value="importado" checked onchange="conflictMark(${idx},'importado')">
          <div class="conflict-option-body conflict-importado">
            <div class="conflict-option-label"><i class="ti ti-file-import"></i> Arquivo</div>
            <div class="conflict-option-val">${escapeHtml(fmtVal(c.importado, modulo))}</div>
          </div>
        </label>
        <label class="conflict-option" id="conflict-opt-${idx}-ambos">
          <input type="radio" name="conflict-${idx}" value="ambos" onchange="conflictMark(${idx},'ambos')">
          <div class="conflict-option-body conflict-ambos">
            <div class="conflict-option-label"><i class="ti ti-copy-plus"></i> Manter ambos</div>
            <div class="conflict-option-val" style="color:var(--text3)">Insere os dois registros</div>
          </div>
        </label>
      </div>
    </div>`).join('');

  openModal('modal-import-conflicts');
}

function conflictMark(idx, val) {
  ['manual','importado','ambos'].forEach(v => {
    const opt = document.getElementById(`conflict-opt-${idx}-${v}`);
    if (opt) opt.classList.toggle('selected', v === val);
  });
}

function conflictSelectAll(val) {
  const rows = document.querySelectorAll('#conflict-list .conflict-row');
  rows.forEach((row, idx) => {
    const radio = row.querySelector(`input[value="${val}"]`);
    if (radio) { radio.checked = true; conflictMark(idx, val); }
  });
}

function conflictConfirm() {
  const rows = document.querySelectorAll('#conflict-list .conflict-row');
  const decisions = new Map();
  rows.forEach((_, idx) => {
    const checked = document.querySelector(`input[name="conflict-${idx}"]:checked`);
    decisions.set(idx, checked ? checked.value : 'importado');
  });
  closeModal('modal-import-conflicts');
  // Restaura o loading overlay antes de retomar o processamento da importação,
  // que ainda pode ter batches restantes para executar após a resolução do conflito.
  const overlay = document.getElementById('loading-overlay');
  if (overlay && loadingOverlayState.visible) overlay.classList.add('open');
  _resolveConflicts(decisions);
}

Object.assign(window, { conflictMark, conflictSelectAll, conflictConfirm });

// ── Merge com verificação de conflitos ───────────────────────────────────────
// _importAddedCount acumula os registros realmente adicionados na importação atual
let _importAddedCount = 0;

async function _mergeWithConflictCheck(modulo, incoming) {
  const fp = _fpFns[modulo];
  if (!fp || !incoming.length) return _stateArrays()[modulo] || [];

  const conflicts = _detectConflicts(modulo, incoming);

  let resolvedIncoming = incoming;
  if (conflicts.length) {
    resolvedIncoming = await new Promise(resolve => {
      _pendingMerge = { modulo, incoming, conflicts, resolve };
      _showConflictModal(modulo, conflicts);
    });
  }

  const stateKey = { 'Entrada': 'entradas', 'Saída': 'saidas', 'Lançamento': 'lancamentos', 'SAP': 'sap', 'Produção': 'producao' }[modulo];
  const existingCount = (state[stateKey] || []).length;
  const incomingCount = resolvedIncoming.length;

  // Feedback visual: informa que o merge está em andamento.
  // Em arquivos grandes (centenas de milhares de registros) esse passo pode
  // levar vários segundos — sem esse aviso a barra de progresso ficaria parada
  // em 100% dando impressão de travamento.
  if (isLoadingOverlayVisible()) {
    updateLoadingOverlay(
      `Consolidando ${incomingCount.toLocaleString('pt-BR')} registros novos com ${existingCount.toLocaleString('pt-BR')} existentes…`,
      `Importando ${modulo}`,
      'Removendo duplicatas e mesclando os dados. Isso pode levar alguns instantes em arquivos grandes…'
    );
    await nextFrame(); // garante que o browser pinta a mensagem antes de bloquear no merge
  }

  // Melhoria 2: para o módulo SAP, usa uma cópia compactada do existing no _mergeDedup.
  // A compactação (que remove campos extras não persistidos como createdAt) reduz o
  // volume de dados percorridos pelo merge em memória, tornando-o mais rápido em
  // arquivos grandes. O state.sap em memória NÃO é alterado aqui — a cópia compactada
  // é usada apenas como entrada do merge; o resultado retornado ainda contém os campos
  // completos dos registros do incoming (que chegam com createdAt do stamp()).
  const existingForMerge = (modulo === 'SAP')
    ? compactSapRecords(state[stateKey] || [])
    : (state[stateKey] || []);

  const { result, added } = _mergeDedup(existingForMerge, resolvedIncoming, fp);
  _importAddedCount += added;

  // Feedback pós-merge
  if (isLoadingOverlayVisible()) {
    updateLoadingOverlay(
      `Mesclagem concluída — ${added.toLocaleString('pt-BR')} registro${added !== 1 ? 's' : ''} novo${added !== 1 ? 's' : ''} adicionado${added !== 1 ? 's' : ''}`,
      `Importando ${modulo}`,
      'Salvando e atualizando os painéis…'
    );
  }

  return result;
}

// ── Fingerprints de deduplicação por módulo ──────────────────────────────
// Garante que reimportar o mesmo arquivo não duplica registros.
// Chave escolhida para ser estável entre importações do mesmo dado.

function _fpEntrada(r) {
  return [
    normalizeText(r.centralDestino || r.centralCompra || ''),
    normalizeText(r.material || ''),
    r.nf || '',
    r.dtEmissao || '',
    String(num(r.peso))
  ].join('|');
}

function _fpSaida(r) {
  return [
    normalizeText(r.central || ''),
    normalizeText(r.material || ''),
    r.os || '',
    r.dtEmissao || '',
    String(num(r.peso))
  ].join('|');
}

function _fpLancamento(r) {
  return [
    normalizeText(r.central || ''),
    normalizeText(r.material || ''),
    r.dtLanc || '',
    String(num(r.peso))
  ].join('|');
}

function _fpSap(r) {
  return [
    normalizeText(r.central || ''),
    normalizeText(r.material || ''),
    r.documento || '',
    r.movimento || '',
    r.dtLanc || '',
    String(num(r.peso))
  ].join('|');
}

function _fpProducao(r) {
  return [
    normalizeText(r.central || ''),
    r.mes || ''
  ].join('|');
}

// Merge deduplicado: mantém registros existentes que não conflitem com os novos,
// depois adiciona os novos. Novos têm prioridade (substituem o existente se mesma chave).
// Retorna { result, added } onde added = quantos registros foram de fato inseridos.
function _mergeDedup(existing, incoming, fpFn) {
  if (!incoming.length) return { result: existing, added: 0 };
  const incomingFps = new Set(incoming.map(fpFn));
  // Monta mapa de fingerprint → registro existente para recuperar o importId original
  const existingByFp = new Map(existing.map(r => [fpFn(r), r]));
  // Novos registros que não existem no state atual — entram com o importId da importação atual
  const trulyNew = incoming.filter(r => !existingByFp.has(fpFn(r)));
  // Registros que já existiam — são atualizados com os dados novos MAS preservam
  // o importId original, evitando que uma reimportação parcial "sequestre" registros
  // de importações anteriores e os remova junto ao excluir a importação nova.
  // Preserva também o id original (Fase 4 — Supabase) pela mesma razão: sem
  // isso, uma reimportação geraria um id novo a cada vez (stamp() sempre gera
  // um id novo no momento do parse) e cada reimportação criaria uma linha
  // duplicada na nuvem em vez de atualizar a existente.
  const updatedExisting = incoming
    .filter(r => existingByFp.has(fpFn(r)))
    .map(r => {
      const original = existingByFp.get(fpFn(r));
      return { ...r, importId: original.importId, id: original.id };
    });
  // Registros que existem e não colidiram com nenhum incoming — mantidos intactos
  const kept = existing.filter(r => !incomingFps.has(fpFn(r)));
  return { result: [...updatedExisting, ...trulyNew, ...kept], added: trulyNew.length };
}

// ── Controle de abort de importação ─────────────────────────────────────────
let _importAborted = false;

function abortImport() {
  _importAborted = true;
  const btn = document.getElementById('loading-abort-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="ti ti-loader"></i> Abortando...';
  }
  updateLoadingOverlay('Abortando importação...', 'Importação', 'Aguarde a operação atual terminar o lote...');
}
window.abortImport = abortImport;

async function processImportedRows(modulo, rows, fileName, extra = {}) {
  // Ativa modo batch: desabilita fuzzy matching em normalizarMaterial
  // para evitar Maximum call stack size exceeded com arquivos grandes.
  _batchImportMode = true;
  // Declarados fora do try para ficarem acessíveis no catch (abort e erros)
  _importAddedCount = 0;
  _importAborted = false;
  const importId = `imp_${modulo}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const parsed = [];
  const total = rows.length || 0;
  // _mergedResult acumula o resultado do merge ANTES de ser atribuído ao state.
  // Só é aplicado ao state após todos os batches concluírem sem abort,
  // evitando que um abort tardio deixe o state com dados parciais.
  let _mergedResult = null;
  try {
  // Mostra botão abortar no loading overlay
  const _abortRow = document.getElementById('loading-abort-row');
  if (_abortRow) _abortRow.style.display = 'flex';
  const batchSize = Math.max(200, Math.min(700, Math.floor(total / 8) || 300));

  const updateStep = (message) => {
    if (isLoadingOverlayVisible()) {
      updateLoadingOverlay(message, `Importando ${modulo}`, message);
    }
  };

  const processSlice = async (start, end, handler) => {
    if (_importAborted) return; // pula o slice se abortado
    for (let i = start; i < end; i++) {
      const item = handler(rows[i]);
      if (item) parsed.push(item);
    }
    if (isLoadingOverlayVisible()) {
      updateLoadingOverlay(`Lidos ${Math.min(end, total)} de ${total} registros`, `Importando ${modulo}`, 'Convertendo lotes para o armazenamento local...');
    }
    await nextFrame();
    if (_importAborted) throw new Error('__IMPORT_ABORTED__'); // sinaliza abort ao loop pai
  };

  if (modulo === 'Entrada') {
    const cm = extra.colMap || {};
    const usedIdx = cm.__usedIdx || new Set();
    // O fallback posicional só é usado se o índice não pertencer a outro campo já
    // reconhecido pelo cabeçalho — evita que um campo não reconhecido "roube" por
    // coincidência de posição a coluna correta de outro campo (ex.: CNPJ vazando
    // para Central Destino quando o cabeçalho de destino não é reconhecido).
    const ci = (field, fallback) => {
      if (cm[field] !== undefined) return cm[field];
      if (usedIdx.has(fallback)) return -1;
      return fallback;
    };
    for (let i = 0; i < total; i += batchSize) {
      updateStep('Lendo entradas e normalizando materiais...');
      await processSlice(i, Math.min(i + batchSize, total), (r) => {
        const materialOriginal = String(r[ci('material', 10)] || '').trim();
        if (!materialOriginal) return null;
        registrarNomeOriginalMaterial('entradas', materialOriginal);
        const categoriaOriginal = String(r[ci('categoria', 9)] || '').trim();
        return stamp(normalizarCentraisRecord({
          importId,
          centralCompra:    String(r[ci('centralCompra',  0)] || ''),
          centralDestino:   String(r[ci('centralDestino', 1)] || ''),
          nf:               String(r[ci('nf',             11)] || ''),
          dtEmissao:        fmtDate(r[ci('dtEmissao',     13)]),
          dtDescarga:       fmtDate(r[ci('dtDescarga',     3)]),
          fornecedor:       String(r[ci('fornecedor',      4)] || ''),
          categoriaOriginal,
          categoria:        getCategoriaPorGrupo(materialOriginal) || categoriaOriginal,
          materialOriginal,
          material:         normalizarMaterial(materialOriginal),
          peso:             num(r[ci('peso',              18)]),
          um:               String(r[ci('um',             17)] || 'KG'),
          custo:            num(r[ci('custo',             19)]),
          valorTotal:       num(r[ci('valorTotal',        20)])
        }, ['centralCompra','centralDestino']));
      });
    }
    _mergedResult = await _mergeWithConflictCheck('Entrada', parsed.filter(r => r.material || r.nf));
  } else if (modulo === 'Saída') {
    const cm = extra.colMap || {};
    const ci = (field, fallback) => cm[field] !== undefined ? cm[field] : fallback;
    for (let i = 0; i < total; i += batchSize) {
      updateStep('Lendo saídas e conferindo saldos...');
      await processSlice(i, Math.min(i + batchSize, total), (r) => {
        const materialOriginal = String(r[ci('material', 6)] || '').trim();
        if (!materialOriginal) return null;
        registrarNomeOriginalMaterial('saidas', materialOriginal);
        const peso = num(r[ci('peso', 9)]);
        const custo = num(r[ci('custo', 10)]);
        const categoriaOriginal = String(r[ci('categoria', 4)] || '').trim();
        return stamp(normalizarCentraisRecord({
          importId,
          central:          String(r[ci('central',    0)] || ''),
          dtEmissao:        fmtDate(r[ci('dtEmissao', 1)]),
          os:               String(r[ci('os',         2)] || ''),
          contrato:         String(r[ci('contrato',   3)] || ''),
          categoriaOriginal,
          categoria:        getCategoriaPorGrupo(materialOriginal) || categoriaOriginal,
          fornecedor:       String(r[ci('fornecedor', 5)] || ''),
          materialOriginal,
          material:         normalizarMaterial(materialOriginal),
          peso,
          um:               String(r[ci('um', -1)] || 'KG'),
          custo,
          valorTotal:       num(r[ci('valorTotal', -1)]) || (peso * custo)
        }, ['central']));
      });
    }
    _mergedResult = await _mergeWithConflictCheck('Saída', parsed.filter(r => r.material || r.os));
  } else if (modulo === 'Lançamento') {
    const cm = extra.colMap || {};
    const ci = (field, fallback) => cm[field] !== undefined ? cm[field] : fallback;
    // isCsv determina a função de conversão numérica:
    // - XLSX pt-BR: numXls() trata ponto de milhar e formato contábil (ex: "55.000", "R$ 0,37")
    // - CSV: numCsv() trata vírgula decimal (ex: "55000,00")
    // - fallback: num() para casos já numéricos
    const toNum = extra.isCsv ? numCsv : numXls;
    for (let i = 0; i < total; i += batchSize) {
      updateStep('Consolidando lançamentos...');
      await processSlice(i, Math.min(i + batchSize, total), (r) => {
        // O campo material pode vir combinado "Material | Fornecedor | Municipio"
        // ou em coluna separada dependendo do layout
        const matRaw = String(r[ci('material', 2)] || '').trim();
        const partes = matRaw.split(/\s*\|\s*/).map(v => v.trim()).filter(Boolean);
        const materialOriginal = partes[0] || '';
        const fornecedor = partes.length > 1 ? partes[1] : String(r[ci('fornecedor', -1)] || '');
        const municipio  = partes.length > 2 ? partes[2] : '';
        if (!materialOriginal) return null;
        registrarNomeOriginalMaterial('lancamentos', materialOriginal);

        const peso  = toNum(r[ci('peso',  4)]);
        const custo = toNum(r[ci('custo', 5)]);
        const categoriaOriginal = String(r[ci('categoria', 3)] || '').trim();
        return stamp(normalizarCentraisRecord({
          importId,
          dtLanc:          fmtDate(r[ci('dtLanc',   0)]),
          central:         String(r[ci('central',    1)] || ''),
          fornecedor,
          municipio,
          categoriaOriginal,
          categoria:       getCategoriaPorGrupo(materialOriginal) || categoriaOriginal,
          materialOriginal,
          material:        normalizarMaterial(materialOriginal),
          peso,
          um:              'KG',
          custo,
          valorTotal:      toNum(r[ci('valorTotal', -1)]) || (peso * custo)
        }, ['central']));
      });
    }
    _mergedResult = await _mergeWithConflictCheck('Lançamento', parsed.filter(r => r.material));
  } else if (modulo === 'SAP') {
    // Usa mapeamento dinâmico de colunas (passado via extra.sapColMap) quando disponível.
    // Fallback para índices fixos do layout padrão MB51 caso o mapa não seja fornecido.
    const cm = extra.sapColMap || {};
    const ci = (field, fallback) => cm[field] !== undefined ? cm[field] : fallback;


    for (let i = 0; i < total; i += batchSize) {
      updateStep('Lendo banco de dados SAP...');
      await processSlice(i, Math.min(i + batchSize, total), (r) => {
        if (!r || !Array.isArray(r)) return null;

        // ── Detectar e descartar linhas de SUBTOTAL do MB51 ──────────────
        // Subtotais têm movimento vazio E data vazia — nunca têm dtLanc preenchido.
        // Critério anterior (!usuario && !mov && !doc) era muito agressivo:
        // arquivos com colunas em ordem diferente do esperado resultavam em
        // todos os campos em branco → tudo descartado como "subtotal".
        const movRaw      = String(r[ci('movimento', 1)] ?? '').trim();
        const dtLancRaw   = String(r[ci('dtLanc',    8)] ?? '').trim();
        const docRaw      = String(r[ci('documento', 4)] ?? '').trim();
        const usuarioRaw  = String(r[ci('usuario',   0)] ?? '').trim();

        // É subtotal se: sem movimento E sem data de lançamento
        // (mesmo que tenha material e quantidade — que são os totais agregados)
        const isSubtotal = !movRaw && !dtLancRaw;
        if (isSubtotal) return null;

        // CSV exportado pelo SAP usa formato pt-BR ("1.234,56") — usar numCsv
        const _num = extra.isCsv ? numCsv : num;
        const peso = _num(r[ci('peso', 11)]);
        const valorTotal = _num(r[ci('valorTotal', 13)]);
        const materialOriginal = String(r[ci('material', 10)] || '').trim();

        // Descarta linhas realmente vazias (sem material e sem documento)
        if (!materialOriginal && !docRaw && !movRaw) return null;

        return stamp(normalizarCentraisRecord({
          importId,
          usuario:    usuarioRaw,
          movimento:  movRaw,
          txtMov:     String(r[ci('txtMov',     2)] || ''),
          ref:        String(r[ci('ref',         3)] || ''),
          documento:  docRaw,
          central:    String(r[ci('central',    5)] || ''),
          deposito:   String(r[ci('deposito',   6)] || ''),
          dtDoc:      fmtDate(r[ci('dtDoc',     7)]),
          dtLanc:     fmtDate(r[ci('dtLanc',    8)]),
          dtReg:      fmtDate(r[ci('dtReg',     9)]),
          materialOriginal,
          material: normalizarMaterial(materialOriginal),
          peso,
          um:         'KG',
          custoUnit:  peso !== 0 ? valorTotal / peso : 0,
          valorTotal
        }, ['central']));
      });
    }
    _mergedResult = await _mergeWithConflictCheck('SAP', parsed.filter(r => r.material || r.documento));
  } else if (modulo === 'Produção') {
    const mes = extra.mes || prompt('Informe o mês da produção importada:');
    if (!mes || !String(mes).trim()) {
      toast('Importação cancelada: mês não informado', 'error');
      return;
    }

    for (let i = 0; i < total; i += batchSize) {
      updateStep('Organizando produção importada...');
      await processSlice(i, Math.min(i + batchSize, total), (r) => stamp(normalizarCentraisRecord({
        importId,
        mes: String(mes).trim(),
        central: String(r[0] || ''),
        producao: num(r[1]),
        um: 'm³',
        precoMedio: num(r[5]),
        margem: String(r[6] || '').trim() || '—',
        custoMedio: num(r[7]),
        totalVendas: num(r[8])
      }, ['central'])));
    }
    _mergedResult = await _mergeWithConflictCheck('Produção', parsed.filter(r => r.central || r.producao));
  }

  // Aplica o resultado do merge ao state somente aqui, após todos os batches
  // concluírem sem abort. Desta forma, se o usuário abortar durante o processamento,
  // o state permanece intacto com os dados anteriores à importação.
  if (_mergedResult !== null) {
    const stateKeyMap = {
      'Entrada':    'entradas',
      'Saída':      'saidas',
      'Lançamento': 'lancamentos',
      'SAP':        'sap',
      'Produção':   'producao',
    };
    const stateKey = stateKeyMap[modulo];
    if (stateKey) state[stateKey] = _mergedResult;

    // Decisão de 27/07: Entradas/Saídas/Lançamentos/SAP/Produção NÃO
    // sincronizam importação em lote com a nuvem — só registros manuais.
    // Motivo: volume de importação é ordens de grandeza maior que manual
    // (ex.: 813k importados vs. 31 manuais em Lançamentos), o plano gratuito
    // do Supabase (500MB) não tem opção de upgrade, e os arquivos originais
    // já são a cópia de segurança (o Hugo mantém localmente e reimporta se
    // precisar). Por isso NÃO existe mais nenhum push pós-importação em
    // lote aqui — a sincronização desses módulos acontece só na criação/
    // edição/exclusão manual (ver import.js, funções _*SyncUpsert).
  }

  if (!parsed.length) {
    toast('Nenhum registro válido encontrado', 'error');
    return;
  }

  // Calcula quantos registros foram de fato adicionados (não duplicados)
  const fpFnByModulo = {
    'Entrada':    _fpEntrada,
    'Saída':      _fpSaida,
    'Lançamento': _fpLancamento,
    'SAP':        _fpSap,
    'Produção':   _fpProducao,
  };
  const fpFn = fpFnByModulo[modulo];
  const stateArrayByModulo = {
    'Entrada':    state.entradas,
    'Saída':      state.saidas,
    'Lançamento': state.lancamentos,
    'SAP':        state.sap,
    'Produção':   state.producao,
  };
  // parsed contém os registros novos — contar quantos já existiam no state anterior
  // (state já foi atualizado, então comparamos com os parsed)
  const totalNovos   = parsed.length;
  const _incomingFps = fpFn ? new Set(parsed.map(fpFn)) : new Set();
  const _stateArr    = stateArrayByModulo[modulo] || [];
  // Registros novos = os que estão no state E cujo fp está nos incoming
  // (todos os incoming que passaram pelo filter)
  // Simplificado: mostrar total importado e deixar o sistema de dedup cuidar do resto
  extra._totalImportado = totalNovos;

  updateStep('Salvando e atualizando os painéis...');
  _lstepSet('imp-convert', 'done'); _lstepSet('imp-validate', 'done'); _lstepSet('imp-save', 'running'); _lbarSet(75);

  const _novosStr = extra._totalImportado !== undefined
    ? `${extra._totalImportado.toLocaleString('pt-BR')} registros processados`
    : 'Importação concluída';

  // Invalida os índices dos módulos que foram alterados
  if (modulo === 'Entrada')     invalidateSearchIndex('entradas');
  if (modulo === 'Saída')       { invalidateSaidasIndex(); }
  if (modulo === 'Lançamento')  invalidateLancIndex();
  if (modulo === 'SAP')         invalidateSapIndex();

  const novosAdicionados = _importAddedCount;

  const importRecord = {
    id: importId, arquivo: fileName, modulo,
    registros: novosAdicionados, totalArquivo: parsed.length,
    dataHora: new Date().toLocaleString('pt-BR'),
    status: 'Processando', statusTip: 'Salvando no banco local...', createdAt: Date.now()
  };
  state.imports.unshift(importRecord);

  _lstepSet('imp-index', 'running'); _lbarSet(88);
  renderImports();
  renderModule(pageFromModulo(modulo));
  updateDashboard();
  await nextFrame();
  initResizable();
  _lstepSet('imp-save', 'done'); _lstepSet('imp-index', 'done'); _lbarSet(100);

  hideLoadingOverlay('Importação concluída');
  if (typeof loadingHideSteps === 'function') loadingHideSteps();

  if (novosAdicionados > 0) {
    toast(`${novosAdicionados.toLocaleString('pt-BR')} novo${novosAdicionados !== 1 ? 's' : ''} registro${novosAdicionados !== 1 ? 's' : ''} importado${novosAdicionados !== 1 ? 's' : ''} de "${fileName}"`);
  } else {
    toast(`Nenhum registro novo encontrado em "${fileName}" — todos já estavam no sistema`, 'info');
  }

  // Persiste em background e atualiza status sem bloquear a UI
  persistStateNow().then(ok => {
    const rec = state.imports.find(r => r.id === importId);
    if (!rec) return;
    if (novosAdicionados === 0) {
      rec.status = 'Já existia';
      rec.statusTip = 'Todos os registros já estavam no sistema';
    } else if (ok !== false) {
      rec.status = 'Salvo';
      rec.statusTip = `${novosAdicionados.toLocaleString('pt-BR')} registros salvos com sucesso`;
    } else {
      rec.status = 'Sem persistência';
      rec.statusTip = 'Não foi possível salvar no banco local. Os dados existem nesta sessão mas serão perdidos ao recarregar.';
    }
    renderImports();
    // Fase 4 — Etapa 3: sincroniza o log já com o status definitivo.
    if (typeof _importsSyncUpsert === 'function') _importsSyncUpsert(rec);
  }).catch(() => {
    const rec = state.imports.find(r => r.id === importId);
    if (rec) {
      rec.status = 'Sem persistência';
      rec.statusTip = 'Falha ao salvar no banco local.';
      renderImports();
      if (typeof _importsSyncUpsert === 'function') _importsSyncUpsert(rec);
    }
  });
  } catch(outerErr) {
    if (outerErr?.message === '__IMPORT_ABORTED__') {
      hideLoadingOverlay('Importação abortada');
      toast(`Importação de "${fileName}" abortada pelo usuário.`, 'info');
      state.imports.unshift({
        id: importId,
        arquivo: fileName,
        modulo,
        registros: 0,
        totalArquivo: rows.length,
        dataHora: new Date().toLocaleString('pt-BR'),
        status: 'Abortado',
        statusTip: `Abortado — nenhum dado foi importado (arquivo continha ${rows.length.toLocaleString('pt-BR')} registros)`,
        createdAt: Date.now()
      });
      persist();
      renderImports();
    } else {
      throw outerErr;
    }
  } finally {
    // Durante o batch, o fuzzy match ficava desligado (_batchImportMode) —
    // textos brutos que não bateram exato com o cadastro de Materiais
    // ficaram gravados sem padronização. Agora que o batch terminou,
    // reaplica a padronização completa (fuzzy incluso) sobre os módulos
    // recém-importados, para não depender da próxima edição manual do
    // cadastro de Materiais para corrigir isso. Roda ANTES de zerar
    // _batchImportMode ser observável por outros fluxos concorrentes, mas
    // findMaterialMatch já checa _batchImportMode a cada chamada, então
    // precisamos desligar a flag primeiro para o fuzzy scan funcionar.
    _batchImportMode = false;
    if (typeof reaplicarPadronizacaoMateriais === 'function') {
      try {
        const _stateModulo = pageFromModulo(modulo); // 'Entrada' -> 'entradas', etc.
        if (['entradas', 'saidas', 'lancamentos', 'sap'].includes(_stateModulo)) {
          reaplicarPadronizacaoMateriais([_stateModulo]);
        }
      } catch (err) {
        console.warn('[Importação] Falha ao reaplicar padronização de materiais pós-batch:', err);
      }
    }
    _importAborted = false;
    const _abortRowEnd = document.getElementById('loading-abort-row');
    if (_abortRowEnd) _abortRowEnd.style.display = 'none';
    const _abortBtn = document.getElementById('loading-abort-btn');
    if (_abortBtn) { _abortBtn.disabled = false; _abortBtn.innerHTML = '<i class="ti ti-x"></i> Abortar importação'; }
  }
}

// ─── Detecção automática da linha de cabeçalho para o MB51 do SAP ───────────
// O relatório MB51 exportado do SAP costuma ter linhas de título/metadados
// ANTES da linha de cabeçalho real das colunas. Esta função varre as primeiras
// linhas em busca de palavras-chave típicas do cabeçalho do MB51.
function detectSapHeaderRow(rows) {
  // Palavras-chave que tipicamente aparecem no cabeçalho real do MB51
  const SAP_HEADER_KEYWORDS = [
    // Nomes exatos mais comuns no MB51
    'nome do usuario', 'nome do usuário', 'usuario', 'usuário', 'user',
    'tipo de movimento', 'tp.mv', 'tp. mv', 'tipo', 'movimento',
    'texto breve material', 'texto breve', 'material',
    'quantidade', 'qtde', 'qtd.',
    'montante em mi', 'montante', 'valor',
    'centro', 'deposito', 'depósito',
    'data do documento', 'data de lancamento', 'data de lançamento', 'data de entrada',
    'data', 'date', 'dt.',
    'doc.material', 'referencia', 'referência'
  ];

  const normalize = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

  // Testa se uma linha parece ser cabeçalho: ≥3 colunas contendo keywords
  const looksLikeHeader = (row) => {
    const cells = row.map(normalize).filter(Boolean);
    if (cells.length < 3) return false;
    let hits = 0;
    for (const cell of cells) {
      if (SAP_HEADER_KEYWORDS.some(kw => cell.includes(kw))) hits++;
    }
    return hits >= 2;
  };

  // Varre as primeiras 20 linhas
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    if (looksLikeHeader(rows[i])) return i;
  }
  // Fallback: linha 0 (comportamento anterior)
  return 0;
}

// ─── Mapeia índices de coluna do MB51 por nome ────────────────────────────
// Permite que a importação SAP funcione independentemente da ordem das colunas
// ou de colunas extras presentes no arquivo exportado.
function buildSapColumnMap(headerRow) {
  const normalize = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const map = {};

  // Cada campo possui duas listas de aliases:
  //   exact  → o cabeçalho normalizado deve ser IGUAL ao alias (match exato)
  //   starts → o cabeçalho normalizado deve COMEÇAR com o alias
  //            (nunca "includes" puro para evitar que "doc.material" capture "material")
  // A resolução é feita em dois passos: primeiro todos os exatos, depois todos os starts.
  // Isso garante que "texto breve material" (exato) seja mapeado para `material` antes de
  // qualquer tentativa de match parcial, e que "doc.material" nunca seja confundido com
  // a descrição do material.
  const COL_DEFS = {
    usuario:   {
      exact:  ['nome do usuario', 'nome do usuário', 'usuario', 'usuário', 'user', 'nome usuario'],
      starts: ['nome do usu', 'nome usu']
    },
    movimento: {
      exact:  ['tipo de movimento', 'tp.mv', 'tp. mv', 'tpmv', 't.mv', 'movimento', 'mov', 'mvt',
               'tipo mov', 'tipo mvt'],
      starts: ['tipo de mov', 'tipo mov', 'tp.mv', 'tp. mv']
    },
    txtMov:    {
      exact:  ['txt.tipo movimento', 'txt. tipo movimento', 'texto tipo movimento', 'descricao movimento',
               'descrição movimento', 'texto movimento', 'txt movimento'],
      starts: ['txt.tipo mov', 'txt. tipo mov', 'texto tipo mov', 'texto mov']
    },
    ref:       {
      exact:  ['referencia', 'referência', 'ref.doc.', 'ref. doc.', 'ref doc', 'nro.ref.', 'nro. ref.', 'ref'],
      starts: ['referenc', 'ref.doc', 'ref. doc', 'nro.ref', 'nro. ref']
    },
    documento: {
      exact:  ['doc.material', 'doc. material', 'documento', 'doc.mat.', 'doc. mat.',
               'num.doc.mat.', 'num doc mat', 'doc material'],
      starts: ['doc.mat', 'doc. mat', 'num.doc.mat', 'doc material']
    },
    central:   {
      exact:  ['centro', 'central', 'plant', 'filial', 'unidade'],
      starts: ['centro', 'plant']
    },
    deposito:  {
      exact:  ['deposito', 'depósito', 'dep', 'almoxarifado', 'sloc', 'estoque', 'storage location'],
      starts: ['deposito', 'depósito', 'almox', 'storage loc']
    },
    dtDoc:     {
      exact:  ['data do documento', 'dt.doc.', 'dt. doc.', 'data doc', 'data documento', 'posting date'],
      starts: ['data do doc', 'dt.doc', 'dt. doc', 'data doc']
    },
    dtLanc:    {
      exact:  ['data de lancamento', 'data de lançamento', 'dt.lancamento', 'dt. lancamento',
               'data lancamento', 'data lançamento', 'dt.lanc.', 'dt. lanç.', 'entry date'],
      starts: ['data de lanc', 'data de lança', 'dt.lanc', 'dt. lanc', 'data lanc', 'data lança']
    },
    dtReg:     {
      exact:  ['data de entrada', 'dt.registro', 'dt. registro', 'data registro',
               'dt.reg.', 'dt. reg.', 'creation date'],
      starts: ['data de entrada', 'dt.reg', 'dt. reg', 'data reg', 'creation date']
    },
    material:  {
      exact:  ['texto breve material', 'texto breve do material', 'texto breve',
               'descricao material', 'descrição material', 'short text',
               'material description', 'material text'],
      starts: ['texto breve', 'descricao material', 'descrição material', 'short text',
               'material desc', 'material text']
    },
    peso:      {
      exact:  ['quantidade', 'qtde', 'qtd.', 'qtd', 'qty', 'quantidade em um.',
               'quant.', 'quantidade em um'],
      starts: ['quantidade', 'qtde', 'qtd', 'qty', 'quant']
    },
    um:        {
      exact:  ['umb', 'u.m.b.', 'um base', 'um', 'u.m.', 'unid.', 'unidade', 'unit'],
      starts: ['u.m.b', 'u.m.', 'unid']
    },
    valorTotal:{
      exact:  ['montante em mi', 'montante em moeda interna', 'montante em moeda local',
               'montante', 'val.em mo.co.', 'val. em mo.co.',
               'valor total', 'valor', 'amount in lc', 'val.mo.co.', 'total'],
      starts: ['montante em mi', 'montante em mo', 'montante', 'val.em mo', 'val. em mo',
               'valor total', 'amount in lc', 'val.mo.co']
    }
  };

  // Passo 1 — match exato para todos os campos
  headerRow.forEach((cell, idx) => {
    const norm = normalize(cell);
    for (const [field, { exact }] of Object.entries(COL_DEFS)) {
      if (map[field] !== undefined) continue;
      if (exact.some(a => norm === a)) {
        map[field] = idx;
      }
    }
  });

  // Passo 2 — match startsWith apenas para campos ainda não mapeados
  headerRow.forEach((cell, idx) => {
    const norm = normalize(cell);
    for (const [field, { starts }] of Object.entries(COL_DEFS)) {
      if (map[field] !== undefined) continue;
      if (starts.some(a => norm.startsWith(a))) {
        map[field] = idx;
      }
    }
  });

  return map;
}

// ─── Mapeamento de colunas para Entradas ────────────────────────────────────
// Cada campo pode ter várias "camadas" (tiers) de sinônimos. A camada 0 de TODOS os campos
// é testada, em todas as colunas do arquivo, antes de qualquer campo avançar para a camada 1.
// Isso garante prioridade real (ex.: CNPJ Comprador sempre vence Central Compradora) independente
// da ordem física das colunas no arquivo — e não apenas "primeira coluna que aparecer".
function buildEntradaColumnMap(headerRow) {
  const n = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const norms = headerRow.map(n);
  const map = {};
  const usedIdx = new Set();

  const defs = {
    centralCompra:  [
      ['cnpj comprador','cnpj do comprador','cnpj compra','cnpj da compra','cnpj central compra','cnpj filial compra'],
      ['central compra','central de compra','central compradora','c. compra','compra','centro compra'],
    ],
    centralDestino: [
      ['central destino','central de destino','central descarga','central de descarga','central entrada','c. destino','c. descarga','destino','centro destino'],
    ],
    nf:             [['nf','nota fiscal','n.f.','numero nf','nro. nf','nro nf','num. nf','num nf','documento']],
    dtEmissao:      [['dt emissao','dt. emissao','data emissao','data de emissão','dt emissão','data emissão','emissao','emissão']],
    dtDescarga:     [['dt descarga','dt. descarga','data descarga','data de descarga','descarga','dt.descarga']],
    fornecedor:     [['fornecedor','supplier','forn.','forn']],
    categoria:      [['categoria','category','cat.','cat']],
    material:       [['material','descricao material','descrição material','produto','item','mat.']],
    peso:           [['peso','quantidade','qtde','qtd','weight','qty','peso (kg)','quant.']],
    um:             [['um','u.m.','unidade','unit','und']],
    custo:          [['custo','custo unit','custo unitario','custo unitário','preco','preço','unit price','valor unit']],
    valorTotal:     [['valor total','total','valor','amount','montante','vl total','vl. total']],
  };

  const maxTiers = Math.max(...Object.values(defs).map(t => t.length));

  for (let tier = 0; tier < maxTiers; tier++) {
    for (const [field, tiers] of Object.entries(defs)) {
      if (map[field] !== undefined) continue;
      const synonyms = tiers[tier];
      if (!synonyms) continue;
      for (let idx = 0; idx < norms.length; idx++) {
        if (usedIdx.has(idx)) continue;
        const norm = norms[idx];
        if (synonyms.some(a => norm === a || norm.startsWith(a))) {
          map[field] = idx;
          usedIdx.add(idx);
          break;
        }
      }
    }
  }

  // Índices já reconhecidos ficam disponíveis para o import.js/dashboard.js evitar
  // que um fallback fixo (posicional) roube uma coluna que já pertence a outro campo.
  map.__usedIdx = usedIdx;
  return map;
}


function buildSaidaColumnMap(headerRow) {
  const n = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const map = {};
  const defs = {
    central:    { exact: ['central','centro','filial','unidade','plant'] },
    dtEmissao:  { exact: ['dt emissao','dt. emissao','data emissao','data emissão','dt emissão','emissao','emissão','data','dt.','dt'] },
    os:         { exact: ['os','ordem de servico','ordem de serviço','ordem serv','o.s.','num os','nro os','nr os'] },
    contrato:   { exact: ['contrato','contract','num contrato','nro contrato'] },
    categoria:  { exact: ['categoria','category','cat'] },
    fornecedor: { exact: ['fornecedor','cliente','supplier','customer'] },
    material:   { exact: ['material','produto','item','descricao','descrição','mat.'] },
    peso:       { exact: ['peso','quantidade','qtde','qtd','weight','qty','quant.'] },
    um:         { exact: ['um','u.m.','unidade','unit'] },
    custo:      { exact: ['custo','custo unit','custo unitario','custo unitário','preco','preço','valor unit'] },
    valorTotal: { exact: ['valor total','total','valor','amount','montante'] },
  };
  headerRow.forEach((cell, idx) => {
    const norm = n(cell);
    for (const [field, { exact }] of Object.entries(defs)) {
      if (map[field] !== undefined) continue;
      if (exact.some(a => norm === a || norm.startsWith(a))) map[field] = idx;
    }
  });
  return map;
}

function buildLancamentoColumnMap(headerRow) {
  const n = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const map = {};
  const defs = {
    dtLanc:     { exact: ['data','data lancamento','data lançamento','dt lancamento','dt lançamento','dt.','dt lanc','dt. lanc','data lanc'],
                  starts: ['data'] },
    central:    { exact: ['central','centro','filial','unidade','plant'] },
    material:   { exact: ['material','produto','item','descricao','descrição','mat.','material | fornecedor',
                          'mcc','cod material','codigo material','código material','cod. material'] },
    categoria:  { exact: ['categoria','category','cat'] },
    peso:       { exact: ['peso','estoque','saldo','quantidade','qtde','weight','qty'],
                  starts: ['estoque','peso','saldo','quant'] },
    custo:      { exact: ['custo','custo unit','custo unitario','preco','preço','valor unit',
                          'preco medio','preço medio','preco medio (kg)','preço médio (kg)',
                          'custo medio','custo médio'],
                  starts: ['custo','preco','preço'] },
    valorTotal: { exact: ['valor total','total','valor','amount','montante'] },
  };
  headerRow.forEach((cell, idx) => {
    const norm = n(cell);
    for (const [field, { exact, starts = [] }] of Object.entries(defs)) {
      if (map[field] !== undefined) continue;
      if (exact.some(a => norm === a) || starts.some(a => norm.startsWith(a))) map[field] = idx;
    }
  });
  return map;
}

// Helper: detecta linha de cabeçalho nas primeiras 15 linhas
function detectModuleHeaderRow(rows, requiredFields, minHits = 2) {
  const n = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = (rows[i] || []).map(n).filter(Boolean);
    let hits = 0;
    for (const cell of cells) {
      if (requiredFields.some(f => cell.includes(f))) hits++;
    }
    if (hits >= minHits) return i;
  }
  return 0;
}

// ── Parser CSV nativo — sem XLSX, suporta milhões de linhas ─────────────
// Suporta delimitadores , e ; e campos com aspas duplas.
// Retorna array de arrays (mesmo formato do sheet_to_json header:1).
function _parseCsvToRows(text) {
  const lines = text.split(/\r?\n/);
  if (!lines.length) return [];

  // Detecta delimitador: conta ocorrências de , e ; na primeira linha
  const first = lines[0] || '';
  const delim = (first.split(';').length > first.split(',').length) ? ';' : ',';

  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    rows.push(_parseCsvLine(line, delim));
  }
  return rows;
}

function _parseCsvLine(line, delim) {
  const cells = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i+1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === delim && !inQuote) {
      cells.push(_csvCellValue(cur));
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(_csvCellValue(cur));
  return cells;
}

function _csvCellValue(s) {
  const t = s.trim();
  if (t === '') return '';
  // Retorna como string — num() no processamento já trata a conversão
  // Tentar converter aqui causa erros com datas e códigos numéricos
  return t;
}

async function handleImport(event, modulo) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (typeof XLSX === 'undefined') {
    toast('Biblioteca XLSX não carregada. Verifique a conexão.', 'error');
    return;
  }

  if (!hasRequiredReferenceData()) {
    showImportPrereqMessage();
    return;
  }

  showLoadingOverlay(`Importando ${modulo}`, 'Lendo o arquivo selecionado...');
  if (typeof loadingShowSteps === 'function') loadingShowSteps([
    { id: 'imp-read',    icon: 'ti-file-spreadsheet', label: 'Lendo o arquivo' },
    { id: 'imp-header',  icon: 'ti-table',            label: 'Detectando cabeçalho' },
    { id: 'imp-convert', icon: 'ti-transform',        label: 'Convertendo registros' },
    { id: 'imp-validate',icon: 'ti-shield-check',     label: 'Validando dados' },
    { id: 'imp-save',    icon: 'ti-device-floppy',    label: 'Salvando no banco local' },
    { id: 'imp-index',   icon: 'ti-list-search',      label: 'Atualizando índices' },
  ]);

  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      _lstepSet('imp-read', 'running'); _lbarSet(5);
      updateLoadingOverlay('Lendo planilha e extraindo linhas...', `Importando ${modulo}`, 'Interpretando a estrutura do arquivo...');

      const isCsv = file.name.toLowerCase().endsWith('.csv');
      let rows;
      let sheetUsed = isCsv ? 'CSV' : '—'; // disponível para logs fora do bloco else

      if (isCsv) {
        // ── CSV: lido como texto diretamente (readAsText já decodificou o encoding) ──
        updateLoadingOverlay('Lendo CSV...', `Importando ${modulo}`, 'Processando linhas...');
        const text = typeof e.target.result === 'string'
          ? e.target.result
          : new TextDecoder('windows-1252').decode(e.target.result);
        rows = _parseCsvToRows(text);
        console.info('[Import] CSV lido. Linhas:', rows.length, '| Amostra linha 0:', rows[0]);
      } else {
        // ── XLSX: leitura completa ──────────────────────────────────────────
        let wb;
        try {
          wb = XLSX.read(e.target.result, { type: 'array', cellDates: false, dense: false });
          console.info('[Import] Workbook lido. Abas:', wb.SheetNames);
        } catch (readErr) {
          console.error('[Import] Erro na leitura do arquivo:', readErr);
          throw new Error('Não foi possível ler o arquivo Excel: ' + (readErr.message || String(readErr)));
        }

        if (!wb || !wb.SheetNames || wb.SheetNames.length === 0) {
          toast('Arquivo inválido ou corrompido: nenhuma planilha encontrada.', 'error');
          hideLoadingOverlay('Falha na importação');
          event.target.value = '';
          return;
        }

        // ── Seleção da aba ──────────────────────────────────────────────────
        let sheetName = wb.SheetNames[0];
        if (modulo === 'SAP' && wb.SheetNames.length > 1) {
          const sapSheetHints = ['mb51', 'sap', 'movimentacao', 'movimentações', 'dados', 'data', 'sheet1', 'planilha1'];
          const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
          const found = wb.SheetNames.find(n => sapSheetHints.some(h => norm(n).includes(h)));
          if (found) sheetName = found;
        }

        // Usar chave real de wb.Sheets (encoding pode divergir de SheetNames)
        const realKey = Object.keys(wb.Sheets).find(k => !k.startsWith('!') && k.trim() === sheetName.trim())
                     || Object.keys(wb.Sheets).find(k => !k.startsWith('!'))
                     || sheetName;
        sheetUsed = realKey;
        console.info('[Import] Aba:', realKey);

        const ws = sanitizeWorksheet(wb.Sheets[realKey]);
        rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      }

      if (!rows || rows.length < 2) {
        toast('O arquivo parece estar vazio ou não contém linhas de dados.', 'error');
        hideLoadingOverlay('Falha na importação');
        if (typeof loadingHideSteps === 'function') loadingHideSteps();
        event.target.value = '';
        return;
      }

      _lstepSet('imp-read', 'done'); _lstepSet('imp-header', 'running'); _lbarSet(20);

      let data;
      let extra = {};

      if (modulo === 'SAP') {
        // Detecta automaticamente onde está a linha de cabeçalho real
        const headerIdx = detectSapHeaderRow(rows);
        const headerRow = rows[headerIdx] || [];
        const colMap = buildSapColumnMap(headerRow);
        // Dados começam na linha seguinte ao cabeçalho
        data = rows.slice(headerIdx + 1).filter(r => r.some(c => c !== '' && c !== null && c !== undefined));
        extra = { sapColMap: colMap, sapHeaderFound: headerIdx, isCsv };

        // Log diagnóstico no console — abra o DevTools (F12) para ver detalhes
        console.info('[SAP Import] ✓ Fonte:', sheetUsed);
        console.info('[SAP Import] ✓ Cabeçalho detectado na linha:', headerIdx, '| Conteúdo:', rows[headerIdx]);
        console.info('[SAP Import] ✓ Mapeamento de colunas:', colMap);
        console.info('[SAP Import] ✓ Total de linhas de dados (após cabeçalho):', data.length);
        console.info('[SAP Import] ✓ Amostra da 1ª linha de dados:', data[0]);

        if (data.length === 0) {
          toast('Nenhuma linha de dados encontrada. Verifique se o arquivo é o MB51 correto.', 'error');
          hideLoadingOverlay('Falha na importação');
          event.target.value = '';
          return;
        }
      } else if (modulo === 'Lançamento') {
        // ── Etapa 1: detecção automática do cabeçalho ──────────────────────
        // O arquivo de Lançamentos pode vir com N linhas de metadados antes do
        // cabeçalho real (ex: período, responsável, central…). Reutilizamos
        // detectModuleHeaderRow — a mesma lógica já usada no SAP — para varrer
        // as primeiras 15 linhas e encontrar onde começa o cabeçalho real.
        const lancHeaderFields = ['data', 'central', 'material', 'mcc', 'categoria', 'estoque', 'preco', 'preço'];
        const headerIdx = detectModuleHeaderRow(rows, lancHeaderFields, 2);
        const headerRow = rows[headerIdx] || [];
        const colMap    = buildLancamentoColumnMap(headerRow);

        data  = rows.slice(headerIdx + 1).filter(r => r.some(c => c !== '' && c !== null && c !== undefined));
        extra = { colMap, lancHeaderFound: headerIdx, isCsv };

        console.info('[Lançamento Import] ✓ Cabeçalho detectado na linha:', headerIdx, '| Conteúdo:', headerRow);
        console.info('[Lançamento Import] ✓ Mapeamento de colunas:', colMap);
        console.info('[Lançamento Import] ✓ Total de linhas de dados:', data.length);
        console.info('[Lançamento Import] ✓ Amostra da 1ª linha:', data[0]);

        if (data.length === 0) {
          toast('Nenhuma linha de dados encontrada no arquivo de Lançamentos.', 'error');
          hideLoadingOverlay('Falha na importação');
          event.target.value = '';
          return;
        }
      } else if (modulo === 'Entrada') {
        // O cabeçalho de Entradas é sempre a primeira linha (sem metadados antes).
        const headerRow = rows[0] || [];
        const colMap    = buildEntradaColumnMap(headerRow);

        data  = rows.slice(1).filter(r => r.some(c => c !== '' && c !== null && c !== undefined));
        extra = { colMap, isCsv };

        console.info('[Entrada Import] ✓ Cabeçalho:', headerRow);
        console.info('[Entrada Import] ✓ Mapeamento de colunas:', colMap);
        console.info('[Entrada Import] ✓ Total de linhas de dados:', data.length);
        console.info('[Entrada Import] ✓ Amostra da 1ª linha:', data[0]);
      } else {
        data = rows.slice(1).filter(r => r.some(c => c !== '' && c !== null && c !== undefined));
      }

      _lstepSet('imp-header', 'done'); _lstepSet('imp-convert', 'running'); _lbarSet(35);
      updateLoadingOverlay('Aplicando a importação no sistema...', `Importando ${modulo}`, 'Gravando dados no armazenamento local...');
      await processImportedRows(modulo, data, file.name, extra);
      event.target.value = '';
    } catch (err) {
      if (err?.message === '__IMPORT_ABORTED__') {
        // Abort tratado silenciosamente
      } else {
        console.error('[Import Error]', modulo, err);
        const msg = (err && err.message) ? err.message : String(err);
        const shortMsg = msg.length > 100 ? msg.slice(0, 100) + '…' : msg;
        toast('Erro ao processar: ' + shortMsg, 'error');
      }
    } finally {
      hideLoadingOverlay('Importação concluída');
      if (typeof loadingHideSteps === 'function') loadingHideSteps();
    }
  };
  reader.onerror = () => {
    toast('Não foi possível ler o arquivo selecionado', 'error');
    hideLoadingOverlay('Falha na importação');
  };

  // CSV: tenta latin-1 primeiro (encoding padrão de exports SAP em PT-BR)
  // XLSX: ArrayBuffer
  if (file.name.toLowerCase().endsWith('.csv')) {
    // Lê duas vezes se necessário: latin-1 para SAP BR, fallback UTF-8
    reader.readAsText(file, 'windows-1252');
  } else {
    reader.readAsArrayBuffer(file);
  }
}

function dgSwitchTab(tab) {
  document.querySelectorAll('.dg-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.dg-tab-pane').forEach(p => p.classList.remove('active'));
  const btn  = document.getElementById('dg-tab-btn-' + tab);
  const pane = document.getElementById('dg-pane-' + tab);
  if (btn)  btn.classList.add('active');
  if (pane) pane.classList.add('active');

  // Controle de Corte usa o período do cabeçalho unificado do DG
  if (tab === 'corte') {
    const iniStr = document.getElementById('dg-dt-ini')?.value;
    const fimStr = document.getElementById('dg-dt-fim')?.value;
    if (iniStr && fimStr && typeof rodarControleAgregadosPorPeriodo === 'function') {
      const dtIni = new Date(iniStr + 'T00:00:00');
      const dtFim = new Date(fimStr + 'T23:59:59');
      if (!isNaN(dtIni) && !isNaN(dtFim)) rodarControleAgregadosPorPeriodo(dtIni, dtFim);
    }
  }
}
window.dgSwitchTab = dgSwitchTab;

// ── Modal: Giro & Cobertura — Detalhado (Centrais / Materiais) ─────────────
function dgGiroModalSwitchTab(tab) {
  const isCentrais = tab === 'centrais';
  document.getElementById('dg-giro-modal-panel-centrais').style.display  = isCentrais ? '' : 'none';
  document.getElementById('dg-giro-modal-panel-materiais').style.display = isCentrais ? 'none' : '';

  const btnCentrais  = document.getElementById('dg-giro-modal-tab-centrais');
  const btnMateriais = document.getElementById('dg-giro-modal-tab-materiais');
  if (btnCentrais)  btnCentrais.classList.toggle('btn-primary', isCentrais);
  if (btnMateriais) btnMateriais.classList.toggle('btn-primary', !isCentrais);

  // Busca é por aba — limpa e ajusta o placeholder ao trocar, evita filtro
  // "fantasma" aplicado num painel que o usuário nem está vendo mais.
  const searchEl = document.getElementById('dg-giro-modal-search');
  if (searchEl) {
    searchEl.value = '';
    searchEl.placeholder = isCentrais ? 'Buscar central...' : 'Buscar material...';
  }
  dgGiroModalFilter('');
}
window.dgGiroModalSwitchTab = dgGiroModalSwitchTab;

function dgGiroModalFilter(value) {
  const isCentrais = document.getElementById('dg-giro-modal-panel-centrais')?.style.display !== 'none';
  const panel = document.getElementById(isCentrais ? 'dg-giro-central-body' : 'dg-giro-mat-todos-body');
  if (!panel) return;

  const q = normalizeText((value || '').trim());
  let visibleCount = 0;
  panel.querySelectorAll('.dg-giro-mat-row').forEach(row => {
    const name = row.querySelector('.dg-giro-mat-name')?.textContent || '';
    const match = !q || normalizeText(name).includes(q);
    row.style.display = match ? '' : 'none';
    if (match) visibleCount++;
  });

  let emptyMsg = panel.querySelector('.dg-giro-search-empty');
  if (q && !visibleCount) {
    if (!emptyMsg) {
      emptyMsg = document.createElement('div');
      emptyMsg.className = 'dg-giro-search-empty dg-empty-riscos';
      emptyMsg.innerHTML = '<i class="ti ti-search-off"></i><span>Nenhum resultado para essa busca.</span>';
      panel.appendChild(emptyMsg);
    }
    emptyMsg.style.display = '';
  } else if (emptyMsg) {
    emptyMsg.style.display = 'none';
  }
}
window.dgGiroModalFilter = dgGiroModalFilter;

function _escDgGiroModal(e) {
  if (e.key === 'Escape') dgFecharGiroDetalhe();
}

function dgAbrirGiroDetalhe() {
  dgGiroModalSwitchTab('centrais');
  openModal('modal-giro-detalhe');
  document.addEventListener('keydown', _escDgGiroModal);
}
window.dgAbrirGiroDetalhe = dgAbrirGiroDetalhe;

function dgFecharGiroDetalhe() {
  closeModal('modal-giro-detalhe');
  document.removeEventListener('keydown', _escDgGiroModal);
}
window.dgFecharGiroDetalhe = dgFecharGiroDetalhe;


function renderAll() {
  renderEntradas();
  renderSaidas();
  renderLancamentos();
  renderSAP();
  renderProducao();
  renderImports();
  renderConfigs();
  renderAcoesRelatorio();
  renderFiliais();
  renderMateriais();
  updateImportPrereqUI();
  updateDashboard();
  initResizable();
}


const pageRenderers = {
  dashboard: () => updateDashboard(),
  entradas: () => renderEntradas(),
  saidas: () => renderSaidas(),
  lancamentos: () => renderLancamentos(),
  sap: () => renderSAP(),
  producao: () => renderProducao(),
  importar: () => renderImports(),
  configuracoes: () => { renderConfigs(); renderAcoesRelatorio(); loadHealthConfigInputs(); updateParamGerais(); },
  filiais: () => renderFiliais(),
  materiais: () => renderMateriais(),
  ocorrencias: () => renderOcorrenciasPage(),
  admin: () => { if (typeof renderAdminPage === 'function') renderAdminPage(); }
};

// Páginas que são estáticas após o primeiro render (sem dados que mudam externamente)
const _staticPages = new Set(['filiais', 'materiais']);
const _renderedPages = new Set();

function renderPage(page) {
  // Páginas estáticas: renderizar só uma vez
  if (_staticPages.has(page) && _renderedPages.has(page)) return;
  const fn = pageRenderers[page];
  if (fn) {
    fn();
    _renderedPages.add(page);
  }
}

// Invalida o cache de uma página (chamar quando os dados dessa página mudam)
function invalidatePageCache(page) {
  _renderedPages.delete(page);
}



function initDropZones() {
  qsa('.drop-zone').forEach(zone => {
    zone.addEventListener('dragover', e => {
      e.preventDefault();
      zone.style.borderColor = 'var(--accent)';
    });
    zone.addEventListener('dragleave', () => zone.style.borderColor = '');
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.style.borderColor = '';
      toast('Arraste e solte: use o botão para selecionar o arquivo.', 'error');
    });
  });
}

// ── Helpers de loading steps ─────────────────────────────────────────────
function _lstepSet(id, state) {
  const el = document.getElementById('lstep-' + id);
  if (!el) return;
  const stateEl = el.querySelector('.lstep-state');
  if (!stateEl) return;
  if (state === 'running') {
    stateEl.className = 'lstep-state lstep-running';
    stateEl.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .7s linear infinite"></i>';
  } else if (state === 'done') {
    stateEl.className = 'lstep-state lstep-done';
    stateEl.innerHTML = '<i class="ti ti-circle-check"></i>';
  } else if (state === 'skip') {
    stateEl.className = 'lstep-state lstep-skip';
    stateEl.innerHTML = '<i class="ti ti-minus"></i>';
  }
}

function _lbarSet(pct) {
  const fill = document.getElementById('loading-bar-fill');
  if (!fill) return;
  fill.style.animation = 'none';
  fill.style.width = pct + '%';
  fill.style.transform = 'none';
  fill.style.opacity = '1';
}

async function restoreAndRender() {
  showLoadingOverlay('Inicializando o sistema', 'Preparando para carregar os dados...');

  // Mostra os steps
  const stepsEl = document.getElementById('loading-steps');
  if (stepsEl) stepsEl.style.display = '';

  _lbarSet(0);
  await nextFrame();

  try {
    // ── STEP 1: Ler banco de dados ────────────────────────────────────────
    _lstepSet('idb', 'running');
    updateLoadingOverlay('Lendo o banco de dados local...', 'Inicializando o sistema');
    await nextFrame();
    await loadState();

    // Sincronização com o Supabase no boot — registro em vez de repetir o
    // mesmo bloco "if (typeof X === 'function') await X()" onze vezes
    // (facilita adicionar os módulos da Fase 4 aqui depois). Rodam em
    // PARALELO (Promise.all), não uma esperando a outra: são buscas
    // totalmente independentes entre si (cada uma só lê/mescla o seu
    // próprio state.X), e cada função já trata o próprio erro
    // internamente — uma falhar não derruba as demais nem quebra o boot.
    // Cada uma mantém os dados locais como fallback se a rede falhar.
    const SUPABASE_BOOT_SYNCS = [
      'syncAcoesRelatorioFromSupabase',
      'syncOcorrenciasFromSupabase',
      'syncConfigsFromSupabase',
      'syncCatalogosFromSupabase',
      'syncFiliaisFromSupabase',
      'syncMateriaisFromSupabase',
      'syncInvJustificativasFromSupabase',
      'syncSapFechamentoOverridesFromSupabase',
      'syncAjustesSistemicosFromSupabase',
      'syncAjustesExcluidosFromSupabase',
      'syncNotasAjusteFromSupabase',
      'syncLancamentosFromSupabase', // Fase 4 — Etapa 1 (módulos grandes)
      'syncImportsFromSupabase', // Fase 4 — Etapa 3 (log de importações)
      'syncProducaoFromSupabase', // Fase 4 — Etapa 4
      'syncEntradasFromSupabase', // Fase 4 — Etapa 5
    ];
    await Promise.all(
      SUPABASE_BOOT_SYNCS.map(fnName => {
        const fn = window[fnName];
        return typeof fn === 'function' ? fn() : Promise.resolve();
      })
    );

    _lstepSet('idb', 'done');
    _lbarSet(15);
    await nextFrame();

    // ── STEP 2: Estado já foi aplicado em loadState (applySavedState) ────
    _lstepSet('state', 'running');
    updateLoadingOverlay('Restaurando estado da sessão anterior...', 'Inicializando o sistema');
    await yieldToUI();
    // Corrige status de importações pendentes (já feito em applySavedState, confirma)
    if (Array.isArray(state.imports)) {
      state.imports.forEach(rec => {
        if (rec.status === 'Processando') { rec.status = 'Salvo'; rec.statusTip = 'Registros salvos com sucesso'; }
      });
    }
    _lstepSet('state', 'done');
    _lbarSet(30);
    await nextFrame();

    // ── STEP 3: Padronizar materiais ─────────────────────────────────────
    const totalRecs = (state.entradas?.length || 0) + (state.saidas?.length || 0) +
                      (state.lancamentos?.length || 0) + (state.sap?.length || 0);
    if (typeof migrarCategoriaLegadaMateriais === 'function') migrarCategoriaLegadaMateriais();
    if (totalRecs > 0) {
      _lstepSet('norm', 'running');
      updateLoadingOverlay(`Padronizando materiais — ${totalRecs.toLocaleString('pt-BR')} registros...`, 'Inicializando o sistema');
      await nextFrame();
      if (typeof reaplicarPadronizacaoMateriais === 'function') {
        reaplicarPadronizacaoMateriais();
      }
      _lstepSet('norm', 'done');
    } else {
      _lstepSet('norm', 'skip');
    }
    _lbarSet(50);
    await nextFrame();

    // ── STEP 4: Construir índices de busca ───────────────────────────────
    _lstepSet('index', 'running');
    updateLoadingOverlay('Construindo índices de busca e navegação...', 'Inicializando o sistema');
    await yieldToUI();
    invalidateLancIndex();
    invalidateSapIndex();
    invalidateSaidasIndex();
    invalidateAllSearchIndexes();
    // Pré-aquece os índices mais pesados para que a primeira interação seja rápida
    if (typeof getLancIndex === 'function') getLancIndex();
    if (typeof getSapIndex === 'function') getSapIndex();
    _lstepSet('index', 'done');
    _lbarSet(65);
    await nextFrame();

    // ── STEP 5: Alertas e ocorrências ────────────────────────────────────
    _lstepSet('notif', 'running');
    updateLoadingOverlay('Verificando alertas e ocorrências...', 'Inicializando o sistema');
    await yieldToUI();
    if (typeof notifSync === 'function') notifSync(null);
    _lstepSet('notif', 'done');
    _lbarSet(70);
    await nextFrame();

    // ── STEP 6: Saúde do estoque ──────────────────────────────────────────
    _lstepSet('health', 'running');
    updateLoadingOverlay('Calculando saúde do estoque...', 'Inicializando o sistema');
    await yieldToUI();
    if (typeof notifSilentHealthCheck === 'function') {
      await notifSilentHealthCheck();
    }
    _lstepSet('health', 'done');
    _lbarSet(75);
    await nextFrame();

    // ── STEP 6.5: Pré-carregar Dashboard Analítico com o filtro "Mês atual"
    // ────────────────────────────────────────────────────────────────────
    // Roda a mesma lógica de cálculo usada pelo botão "Analisar" (Dashboard
    // Analítico), mas de forma síncrona e "silenciosa" (silent=true), sem
    // abrir um novo overlay — o overlay de boot já está aberto e cobre esta
    // etapa. Assim, ao navegar para o Dashboard Analítico logo após a carga
    // inicial, os dados do mês atual já estão prontos, sem precisar clicar
    // em Analisar.
    //
    // Decisão (Hugo, jul/2026): o Dashboard Gerencial NÃO é mais pré-
    // calculado aqui — seu motor (_renderDashboardConteudo) permanece
    // disponível via botão "Atualizar" na própria tela, calculado sob
    // demanda. Isso reduz o tempo de boot, ao custo de exigir um clique
    // extra ao abrir o Gerencial pela primeira vez na sessão.
    _lstepSet('dash', 'running');
    updateLoadingOverlay('Pré-carregando Dashboard Analítico do mês atual...', 'Inicializando o sistema');
    await yieldToUI();
    try {
      // Define o período "Mês atual" nos dois seletores de calendário
      // (mesma função usada pelo chip "Mês atual" da interface) — isso
      // também deixa o chip já marcado como ativo quando o usuário abrir
      // qualquer um dos dois dashboards. Operação leve (só preenche os
      // campos de data), mantida para os dois mesmo com a pré-carga
      // restrita ao Analítico — evita que o Gerencial abra sem período
      // selecionado.
      if (typeof calQuickMesAtual === 'function') {
        calQuickMesAtual('an');
        calQuickMesAtual('dg');
      }

      // Dashboard Analítico — reaproveita o mesmo motor de cálculo do botão
      // "Analisar" (_rodarAnaliticoCore), chamando direto (sem passar pelo
      // wrapper rodarAnalitico, que abriria seu próprio overlay).
      const anIniStr = document.getElementById('an-dt-ini')?.value;
      const anFimStr = document.getElementById('an-dt-fim')?.value;
      if (anIniStr && anFimStr && typeof _rodarAnaliticoCore === 'function') {
        const anDtIni = new Date(anIniStr + 'T00:00:00');
        const anDtFim = new Date(anFimStr + 'T23:59:59');
        if (!isNaN(anDtIni) && !isNaN(anDtFim)) {
          _rodarAnaliticoCore(anDtIni, anDtFim, null, /* silent */ true);
        }
      }
    } catch (e) {
      // Falha na pré-carga não deve interromper o boot — o Dashboard
      // Analítico continua disponível manualmente via botão Analisar.
      console.warn('[Boot] Pré-carga do Dashboard Analítico (mês atual):', e);
    }
    // Restaura o progresso do overlay de boot (a pré-carga acima mexe
    // internamente na barra de progresso para os próprios steps dela,
    // que não existem durante o boot — como tudo roda de forma síncrona,
    // isso nunca chega a ser pintado na tela antes deste ajuste).
    _lstepSet('dash', 'done');
    _lbarSet(80);
    await nextFrame();

    // ── STEP 7: Montar interface ──────────────────────────────────────────
    _lstepSet('ui', 'running');
    updateLoadingOverlay('Montando a interface...', 'Inicializando o sistema');
    await yieldToUI();
    updateDashboard();
    updateParamGerais();
    await yieldToUI();
    renderFiliais();
    renderMateriais();
    await yieldToUI();
    const activePage = document.querySelector('.page.active')?.id?.replace('page-', '') || 'importar';
    renderPage(activePage);
    await yieldToUI();
    initResizable();
    if (!Array.isArray(state.notifications)) state.notifications = [];
    if (typeof _notifRenderBadge === 'function') _notifRenderBadge();
    _lstepSet('ui', 'done');
    _lbarSet(88);
    await nextFrame();

    // ── STEP 8: Salvar estado ─────────────────────────────────────────────
    _lstepSet('save', 'running');
    updateLoadingOverlay('Salvando estado no banco local...', 'Inicializando o sistema');
    await yieldToUI();
    if (typeof persistStateNow === 'function') {
      try { await persistStateNow(); } catch(e) { console.warn('[Boot] persist:', e); }
    }
    _lstepSet('save', 'done');
    _lbarSet(100);
    await nextFrame();

  } catch (err) {
    // Captura exceções inesperadas que escaparam dos try/catch individuais de cada step.
    // O finally abaixo garante que o overlay será fechado independentemente.
    // O toast é atrasado para aparecer após o overlay terminar de fechar.
    console.error('[Boot] Erro inesperado durante o carregamento:', err);
    setTimeout(() => {
      if (typeof toast === 'function') {
        toast('⚠ Ocorreu um erro durante o carregamento. Alguns dados podem não ter sido processados corretamente.', 'error');
      }
    }, 400);
  } finally {
    hideLoadingOverlay('Sistema pronto');
  }
}




// ═══════════════════════════════════════════════════════════
// DASHBOARD ANALÍTICO

// ═══════════════════════════════════════════════════════════
// DASHBOARD ANALÍTICO
// ═══════════════════════════════════════════════════════════

/**
 * Parse a date string "DD/MM/AAAA" → Date (midnight local).
 * Returns null for invalid strings.
 */
function parseDate(str) {
  if (!str || str === '—') return null;
  // Accept DD/MM/AAAA or AAAA-MM-DD
  let d, m, y;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
    [d, m, y] = str.split('/').map(Number);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    [y, m, d] = str.split('-').map(Number);
  } else {
    return null;
  }
  const dt = new Date(y, m - 1, d);
  return isNaN(dt) ? null : dt;
}

function dateCmp(a, b) { return a - b; }

function localISODate(d) {
  const dt = d instanceof Date ? new Date(d.getTime()) : new Date(d);
  if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) return '';
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function fmtPtDate(d) {
  if (!d) return '—';
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

function fmtKg(v, decimals = 2) {
  const n = num(v);
  return n.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + ' kg';
}

// Compact kg formatter for tight table cells — e.g. 33.5 M kg / 1,2 K kg
function fmtKgShort(v) {
  const n = num(v);
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9) return sign + (abs / 1e9).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' G kg';
  if (abs >= 1e6) return sign + (abs / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' M kg';
  if (abs >= 1e3) return sign + (abs / 1e3).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' K kg';
  return sign + abs.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 }) + ' kg';
}

function varClass(v) {
  if (v > 0.0001)  return 'diff-pos';
  if (v < -0.0001) return 'diff-neg';
  return 'diff-zero';
}
function varIcon(v) {
  if (v > 0.0001)  return '<i class="ti ti-trending-up" style="color:var(--amber)"></i>';
  if (v < -0.0001) return '<i class="ti ti-trending-down" style="color:var(--red)"></i>';
  return '<i class="ti ti-minus" style="color:var(--text3)"></i>';
}
function varSymbol(v) {
  if (v > 0.0001)  return '<i class="ti ti-circle-arrow-up" title="Sobra" style="font-size:11px;vertical-align:middle"></i>';
  if (v < -0.0001) return '<i class="ti ti-circle-arrow-down" title="Desfalque" style="font-size:11px;vertical-align:middle"></i>';
  return '<i class="ti ti-circle-check" title="Equilibrado" style="font-size:11px;vertical-align:middle"></i>';
}
function varLabel(v) {
  if (v > 0.0001)  return 'Sobra';
  if (v < -0.0001) return 'Desfalque';
  return 'Equilibrado';
}

/**
 * Normalise a movement code: trim, uppercase, strip leading zeros.
 * "101" → "101", " 101 " → "101", "0101" → "101"
 */
function normMov(v) {
  return String(v ?? '').trim().toUpperCase().replace(/^0+/, '') || '0';
}

const CODIGOS_ENTRADA = new Set(['101', '801']);
const CODIGOS_SAIDA   = new Set(['201']);

// Expor funções de collapse para o HTML
if (typeof window !== 'undefined') {
  window.ausToggleRegional       = ausToggleRegional;
  window.ausToggleCentral        = ausToggleCentral;
  window.ausToggleAllRegionais   = ausToggleAllRegionais;
  window.ausToggleAllCentralis   = ausToggleAllCentralis;
  window.ausExpandAll            = ausExpandAll;
  window.ausCollapseAll          = ausCollapseAll;
  window.ausToggleOcultarZerados = ausToggleOcultarZerados;
  window.ausInvalidateCache      = _ausInvalidateCache;
}
