// ═══════════════════════════════════════════════════════════
// CACHE DE ESTOQUE POR PERÍODO (Est. Inicial / Est. Final) — escopo local
// ═══════════════════════════════════════════════════════════
// Dentro de uma única execução do Analítico, o mesmo par (central,
// material) tem seu "Est. Inicial"/"Est. Final" recalculado várias vezes
// em pontos diferentes (_rodarAnaliticoCore, comparador de ordenação por
// central, comparador de ordenação por material, tabela principal do
// card, painel de saúde) — sempre com os MESMOS argumentos, já que o
// período (dtIni/dtFim) não muda durante uma análise. Medido via
// Playwright: com 300 combinações central×material, isso gerava mais de
// 3.300 chamadas reais para apenas 300 resultados distintos possíveis.
//
// IMPORTANTE — por que o cache não fica dentro de getPrePeriodLaunchStock/
// getPrevDayLaunchStock/getLastPeriodLaunchStockWithFallback (ui.js):
// essas funções também são usadas por Dashboard Gerencial, Inventário,
// Macro, Notificações e o Assistente de IA — cada um com seu próprio
// período e seu próprio momento de execução. Um cache dentro delas correria
// o risco de devolver valor desatualizado para um desses outros módulos
// caso os dados mudem entre uma execução do Analítico e a próxima consulta
// de outro módulo. Por isso o cache abaixo é 100% local a este arquivo,
// usado só pelos pontos de chamada do próprio Analítico — os demais
// módulos continuam chamando as funções originais em ui.js, sem nenhuma
// mudança de comportamento para eles.
//
// Limpo no início de cada _rodarAnaliticoCore (nova análise = cache novo).
// Reaproveitado também pelo refresh avulso de um único card
// (refreshCentralCard, ao ligar/desligar "considerar pendentes") — seguro,
// porque essa ação não altera lançamentos/cadastro, só um filtro de
// exibição, então o cache da última análise continua válido.
const _anStockCache = new Map();
let _anCustosSapIdx = null;
function _anClearStockCache() { _anStockCache.clear(); _anCustosSapIdx = null; }
function _anGetCustosSapIdx() {
  if (!_anCustosSapIdx) _anCustosSapIdx = buildCustosSapIndex();
  return _anCustosSapIdx;
}

// ═══════════════════════════════════════════════════════════
// EST. INICIAL DO MÊS — SALDO TEÓRICO DO SAP (Hugo, 13/08/2026)
// ═══════════════════════════════════════════════════════════
// Antes, o Est. Inicial da Visão Micro vinha de getPrePeriodLaunchStock —
// ou seja, do LANÇAMENTO do operador no dia anterior ao período (saldo
// REAL contado). Decisão do Hugo: como analista, a base de comparação tem
// que ser o que o SAP diz, não o que o operador contou. Com a base real, se
// o saldo do SAP divergir do físico a variação nasce medida contra o número
// errado; com a base do SAP, a Variação da tela passa a ser exatamente
// "quanto o físico está distante do livro do SAP".
//
// ATENÇÃO — isso muda o SIGNIFICADO da Variação: ela deixa de medir só a
// divergência gerada DENTRO do período e passa a medir a divergência
// ACUMULADA contra o SAP. Se o fechamento mensal ajusta o SAP (Y11/Y12), as
// duas leituras convergem; se um mês não for ajustado, aquela diferença
// reaparece nos meses seguintes até alguém ajustar. É o efeito desejado.
//
// COMO O SALDO É MONTADO (âncora + movimentações):
//   1. Âncora  = registro de Custos SAP (estoque da MARDH desde 14/08; antes,
//                LBKUM da MBEWH) mais recente que EXISTIR até
//                o mês anterior a dtIni — cascateando pra trás, ver
//                getEstoqueSapCustosSap (normalize.js).
//   2. Delta   = soma de TODAS as movimentações SAP do par central+material
//                entre o fechamento da âncora e dtIni−1.
//
// Isso torna o desenho imune aos buracos da tabela de histórico: onde não houve
// movimentação, o delta dá zero e a âncora antiga já está certa por
// construção; onde houve, o delta reconstrói a diferença. Nos dois casos
// fecha — sem exigir nenhuma importação nova (usa Custos SAP e o módulo SAP,
// ambos já alimentados hoje).
//
// PREMISSA A VALIDAR: o estoque da tabela de histórico do período N é o saldo no FECHAMENTO
// do mês N (por isso o delta começa no 1º dia do mês N+1). Se na prática for
// o saldo de ABERTURA, é só recuar `desde` um mês.
//
// Y11/Y12 ENTRAM SEMPRE aqui, de propósito — isSapExcluidoPorFechamento NÃO
// é aplicado. Esses ajustes são justamente a reconciliação do fechamento
// entre o SAP e o físico; deixá-los de fora faria o saldo acumulado nunca
// bater com o SAP de verdade. O filtro de fechamento continua valendo
// normalmente para as colunas Entradas/Saídas do período (ver sapNoPeriodo
// em _rodarAnaliticoCore) — só o acumulado histórico ignora ele.
//
// Sem Cód SAP cadastrado, ou sem NENHUMA âncora em mês nenhum → retorna null
// (a UI mostra AUSENTE, sem cair silenciosamente pro lançamento real).
function _anGetSapTheoreticalStock({ central, material, dtIni }) {
  const codSap = getCodSapPorGrupo(material);
  if (!codSap) return null;

  const d = dtIni instanceof Date ? new Date(dtIni) : new Date(dtIni);
  if (isNaN(d)) return null;

  // Mês anterior a dtIni em base 1 — getMonth() é 0-based, então ele já É o
  // número do mês anterior (jan → 0, que vira dezembro do ano anterior).
  const ancAno = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear();
  const ancMes = d.getMonth() === 0 ? 12 : d.getMonth();

  const anc = getEstoqueSapCustosSap(central, codSap, ancAno, ancMes, _anGetCustosSapIdx());
  if (!anc) return null;

  // anc.mes é 1-based, então new Date(ano, anc.mes, 1) já é o 1º dia do mês
  // SEGUINTE ao da âncora — o primeiro dia ainda não refletido no saldo dela.
  const desde = new Date(anc.ano, anc.mes, 1);
  desde.setHours(0, 0, 0, 0);
  const ate = new Date(d);
  ate.setDate(ate.getDate() - 1);
  ate.setHours(23, 59, 59, 999);

  let delta = 0;
  const { byCentralMat } = getSapIndex();
  const arr = byCentralMat.get(central)?.get(material || '—') || [];
  for (const rec of arr) {
    const dl = parseDate(rec.dtLanc);
    if (!dl || dl < desde || dl > ate) continue;
    delta += num(rec.peso);
  }

  const dtRef = new Date(d);
  dtRef.setDate(dtRef.getDate() - 1);
  return {
    value:       anc.valor + delta,
    // `date` = dtIni−1, a data A QUE o saldo se refere (não a data da âncora).
    // O carry da tabela de dias usa ela como sapFrom−1: o saldo já embute
    // tudo até dtIni−1, então a acumulação diária tem que começar em dtIni.
    date:        dtRef,
    dtLabel:     fmtPtDate(dtRef),
    ancoraLabel: `${String(anc.mes).padStart(2, '0')}/${anc.ano}`,
    ancoraValor: anc.valor,
    mesesAtras:  anc.mesesAtras,
    delta
  };
}

function _anGetSapStock(args) {
  const k = 'sapteo|' + args.central + '|' + args.material + '|' + String(args.dtIni);
  if (_anStockCache.has(k)) return _anStockCache.get(k);
  const v = _anGetSapTheoreticalStock(args);
  _anStockCache.set(k, v);
  return v;
}
function _anGetPrevDayStock(args) {
  const k = 'day|' + args.central + '|' + args.material + '|' + String(args.dtIni) + '|' + (args.catKey || '');
  if (_anStockCache.has(k)) return _anStockCache.get(k);
  const v = getPrevDayLaunchStock(args);
  _anStockCache.set(k, v);
  return v;
}
function _anGetLastPeriodStockFallback(args) {
  const k = 'fim|' + args.central + '|' + args.material + '|' + String(args.dtIni) + '|' + String(args.dtFim);
  if (_anStockCache.has(k)) return _anStockCache.get(k);
  const v = getLastPeriodLaunchStockWithFallback(args);
  _anStockCache.set(k, v);
  return v;
}
// ═══════════════════════════════════════════════════════════
// ALTERNÂNCIA DE VISÃO — Visão Micro ↔ Visão Inventário
// (o Inventário vive como uma segunda "lente" dentro do Dashboard
// Analítico, com seletor de MÊS próprio — sincronizado automaticamente
// com o mês da data inicial do período livre da Visão Micro toda vez que
// "Analisar" roda, ver invSyncMonthFromPeriod em inventario.js. Fora
// disso, o usuário pode trocar o mês do Inventário manualmente e essa
// escolha prevalece até a próxima análise.)
// ═══════════════════════════════════════════════════════════
// Trava/atualiza a altura mínima do container da Visão Micro para que os
// filtros (aplicar, limpar, etc.) nunca encolham o elemento — a altura só
// pode crescer (ex.: ao expandir um card) ou ser redefinida numa análise
// nova (reset=true). Se o container estiver oculto no momento da medição
// (offsetHeight 0, ex.: aba "Visão Inventário" ativa), a leitura é
// ignorada para não travar a altura em 0.
function _updateMicroContainerHeightLock(reset) {
  const container = document.getElementById('an-micro-container');
  if (!container) return;
  if (reset) container.style.minHeight = '';
  requestAnimationFrame(() => {
    const h = container.offsetHeight;
    if (h <= 0) return;
    const currentLock = parseFloat(container.style.minHeight) || 0;
    if (reset || h > currentLock) container.style.minHeight = h + 'px';
  });
}

// ═══════════════════════════════════════════════════════════
// AGRUPAMENTO DA VISÃO MICRO — Por Regional × Por Material
// ═══════════════════════════════════════════════════════════
// 'regional' (padrão): regionais → cards de central → linhas de material.
// 'material':          cards de material → linhas de central. Mesma
//                      anatomia de card (donut, maiores variações,
//                      capacidade, integração SAP, tabela) — o que muda é
//                      qual dos dois lados do par (central, material) é
//                      fixo no card. Ver buildCentralCard.
//
// Não é persistido: toda análise nova (ou reload) volta pro agrupamento por
// regional, que é a leitura padrão do analista.
let _anGroupMode = 'regional';

// ── Overlay das trocas de visão (#view-loading) ──────────────────────────
// Overlay PRÓPRIO, separado do #loading-overlay do boot (showLoadingOverlay/
// hideLoadingOverlay, em format.js). Trocar de visão não tem etapas, não
// inicializa sessão nenhuma e dura segundos — reaproveitar o do boot fazia
// a tela mostrar a lista de steps e a barra de progresso da inicialização,
// que não têm relação com esta ação.
function _anShowViewLoading(titulo, status) {
  const ov = document.getElementById('view-loading');
  if (!ov) return;
  const t = document.getElementById('view-loading-title');
  const s = document.getElementById('view-loading-sub');
  if (t) t.textContent = titulo;
  if (s) s.textContent = status;
  ov.classList.add('open');
  ov.setAttribute('aria-hidden', 'false');
  // Trava scroll/clique/teclado enquanto o re-render acontece (format.js).
  if (typeof travarInteracao === 'function') travarInteracao('view-loading');
}

function _anHideViewLoading() {
  const ov = document.getElementById('view-loading');
  if (!ov) return;
  ov.classList.remove('open');
  ov.setAttribute('aria-hidden', 'true');
  if (typeof destravarInteracao === 'function') destravarInteracao('view-loading');
}

// Roda um trabalho de re-render pesado e SÍNCRONO atrás desse overlay. O par
// requestAnimationFrame+setTimeout não é firula: sem ceder um frame ao
// navegador, o overlay só seria pintado DEPOIS que a tarefa já tivesse
// terminado. try/finally garante que uma exceção na tarefa não deixe a tela
// travada atrás dele.
function _anComOverlay(titulo, status, tarefa) {
  _anShowViewLoading(titulo, status);
  requestAnimationFrame(() => setTimeout(() => {
    try { tarefa(); }
    finally { _anHideViewLoading(); }
  }, 0));
}

/**
 * Troca o agrupamento da Visão Micro.
 *
 * @param {'regional'|'material'} mode
 * @param {function} [onDone] - roda DEPOIS do re-render (e ainda atrás do
 *        overlay). Necessário porque o render é assíncrono agora: quem
 *        precisa mexer no DOM recém-criado — como microFocusFromMacro, que
 *        aplica um filtro logo em seguida — não pode simplesmente continuar
 *        na linha de baixo. Chamado mesmo quando não há re-render (modo já
 *        ativo ou sem análise carregada).
 */
function anSetGroupMode(mode, onDone) {
  const novo = mode === 'material' ? 'material' : 'regional';
  const temDados = !!(window.__analiticoResults && window.__analiticoDtIni && window.__analiticoDtFim);

  if (novo === _anGroupMode || !temDados) {
    if (novo !== _anGroupMode) { _anGroupMode = novo; _anSyncGroupModeUI(); }
    if (typeof onDone === 'function') onDone();
    return;
  }

  _anGroupMode = novo;
  _anSyncGroupModeUI();

  const isMat = novo === 'material';
  _anComOverlay(
    isMat ? 'Agrupando por material' : 'Agrupando por regional',
    isMat ? 'Montando os cards de material e suas centrais...'
          : 'Remontando os cards de central por regional...',
    () => {
      // silent: quem controla o overlay aqui é _anComOverlay.
      // skipMacro: os donuts da Visão Macro NÃO podem se mexer aqui. Eles são
      // sempre por central × material (independem do agrupamento da Micro) e
      // têm filtros próprios de regional/categoria — redesenhá-los zeraria
      // esses filtros e reanimaria os gráficos sem nenhum dado ter mudado.
      renderAnaliticoMicro(window.__analiticoResults, window.__analiticoDtIni, window.__analiticoDtFim, true, { skipMacro: true });
      if (typeof onDone === 'function') onDone();
    }
  );
}
window.anSetGroupMode = anSetGroupMode;

// Sincroniza a barra de filtros com o agrupamento ativo: botões, legenda e
// os controles que perdem o sentido em um dos modos.
function _anSyncGroupModeUI() {
  const isMat = _anGroupMode === 'material';
  document.getElementById('mgm-btn-regional')?.classList.toggle('active', !isMat);
  document.getElementById('mgm-btn-material')?.classList.toggle('active',  isMat);

  // Capacidade filtra por situação de estoque × capacidade da CENTRAL —
  // no agrupamento por material o card não é uma central, então o filtro
  // perde o alvo e sai de cena (a seção de Capacidade dentro do card
  // continua, por central).
  const capGrp = document.getElementById('mfg-capacidade');
  if (capGrp) capGrp.style.display = isMat ? 'none' : '';
  // Sem grupos de regional em tela, o botão de expandir/recolher regionais
  // não tem o que abrir — e o nível "Regionais" do filtro de tipo de
  // variação fica sem alvo (ver _applyMicroVisibility).
  const regBtn = document.getElementById('btn-toggle-regionais');
  if (regBtn) regBtn.style.display = isMat ? 'none' : '';
  const nivelReg = document.querySelector('#mfo-tipo-var-nivel input[value="regional"]')?.closest('.micro-filter-option');
  if (nivelReg) nivelReg.style.display = isMat ? 'none' : '';

  // O filtro de Saúde continua valendo, mas o que ele filtra troca de nome:
  // no agrupamento por material o nível é o do CARD do material (calculado
  // sobre as centrais dele).
  const saudeTitle = document.querySelector('#mfd-variacao .mfr-title');
  const saudeDesc  = document.querySelector('#mfd-variacao .mfr-desc');
  if (saudeTitle) saudeTitle.innerHTML = `<i class="ti ti-heartbeat"></i> Nível de saúde ${isMat ? 'do material' : 'da central'}`;
  if (saudeDesc)  saudeDesc.textContent = isMat
    ? 'Filtra materiais pelo nível calculado no painel de saúde do card (criticidade das centrais daquele material).'
    : 'Filtra centrais pelo nível calculado no painel de saúde (requer ≥ 5 materiais).';

  const caption = document.getElementById('an-view-caption');
  const paneMicro = document.getElementById('an-view-pane-micro');
  if (caption && paneMicro && paneMicro.style.display !== 'none') {
    caption.textContent = isMat
      ? 'Saúde e criticidade por material e central'
      : 'Saúde e criticidade por filial e material';
  }
  _updateToggleCentralisBtn();
}

function anSwitchView(view) {
  const btnMicro  = document.getElementById('an-view-btn-micro');
  const btnInv    = document.getElementById('an-view-btn-inventario');
  const paneMicro = document.getElementById('an-view-pane-micro');
  const paneInv   = document.getElementById('an-view-pane-inventario');
  const caption   = document.getElementById('an-view-caption');
  if (!btnMicro || !btnInv || !paneMicro || !paneInv) return;

  // Terceira visão (Pendências) é opcional no DOM — se o pane não existir,
  // o switch continua funcionando exatamente como antes (micro/inventário).
  const btnPend  = document.getElementById('an-view-btn-pendencias');
  const panePend = document.getElementById('an-view-pane-pendencias');

  const isInv  = view === 'inventario';
  const isPend = view === 'pendencias' && !!panePend;
  const isMicro = !isInv && !isPend;

  btnMicro.classList.toggle('active', isMicro);
  btnInv.classList.toggle('active', isInv);
  if (btnPend) btnPend.classList.toggle('active', isPend);
  paneMicro.style.display = isMicro ? '' : 'none';
  paneInv.style.display   = isInv   ? '' : 'none';
  if (panePend) panePend.style.display = isPend ? '' : 'none';

  // Ao voltar para a Visão Micro, garante que o piso de altura esteja
  // correto — cobre o caso em que uma análise rodou enquanto esta aba
  // estava oculta (offsetHeight 0 na hora da travinha original).
  if (isMicro) _updateMicroContainerHeightLock(false);

  // Legenda ao lado das abas substitui o título repetido que existia em
  // cada visão (ex.: "Visão Micro — Por Filial e Material"), já que a
  // própria aba selecionada acima já indica isso.
  if (caption) {
    caption.textContent = isInv
      ? 'Fechamento de estoque por central e material'
      : isPend
        ? 'OS, NFs e lançamentos pendentes por central e material'
        : _anGroupMode === 'material'
          ? 'Saúde e criticidade por material e central'
          : 'Saúde e criticidade por filial e material';
  }

  // Visão Pendências: renderiza sob demanda (o cálculo de ausências de
  // lançamento é pesado e a aba não é aberta em toda análise) — mesma
  // filosofia do Inventário logo abaixo.
  // Overlay: o levantamento de dias sem lançamento é a parte cara daqui, e
  // sem ele a aba fica em branco por alguns segundos sem explicação.
  // (A Visão Inventário logo abaixo não ganha overlay porque renderInventario
  // é idempotente e não recalcula nada — o cálculo pesado de lá só roda no
  // botão "Atualizar" do próprio módulo, que já tem o seu.)
  if (isPend && typeof renderPendenciasView === 'function') {
    _anComOverlay(
      'Carregando pendências',
      'Levantando OS, NFs e lançamentos em falta...',
      () => renderPendenciasView()
    );
  }

  // Ao entrar na Visão Inventário pela primeira vez na sessão, gera
  // automaticamente o inventário do mês já selecionado por padrão no
  // seletor de mês do próprio módulo (mês atual, ver inventario.js).
  // Ao entrar na Visão Inventário, só garante que o estado correto (empty
  // state ou conteúdo já existente) esteja visível — renderInventario() é
  // idempotente e não recalcula nada, só sincroniza a UI. A geração em si
  // (invGerar) NÃO roda mais automaticamente aqui — decisão (Hugo,
  // jul/2026): Inventário só é recalculado quando o usuário clica no
  // próprio botão "Atualizar" do módulo. É uma tela que o analista não
  // olha todo dia; abrir a aba sozinha não deve disparar o cálculo pesado.
  if (isInv) {
    if (typeof renderInventario === 'function') renderInventario();
  }
}
window.anSwitchView = anSwitchView;

// Recolhe/expande a Visão Macro (donuts + rankings de criticidade) — útil
// para reduzir a densidade da tela quando o foco é a Visão Inventário.
function anToggleMacro() {
  const body  = document.getElementById('an-macro-body');
  const btn   = document.getElementById('an-macro-toggle-btn');
  const label = document.getElementById('an-macro-toggle-label');
  if (!body) return;
  const collapsing = body.style.display !== 'none';
  body.style.display = collapsing ? 'none' : '';
  btn?.classList.toggle('collapsed', collapsing);
  if (label) label.textContent = collapsing ? 'Expandir' : 'Recolher';
}
window.anToggleMacro = anToggleMacro;

// iniOverride/fimOverride ('YYYY-MM-DD') e onDone são opcionais — usados
// pelo Assistente (chat) para rodar a análise com um período escolhido
// pelo próprio usuário ali dentro, sem depender de ele navegar até aqui.
// Chamada sem argumentos (clique no botão) mantém o comportamento original.
function rodarAnalitico(iniOverride, fimOverride, onDone) {
  const iniEl = document.getElementById('an-dt-ini');
  const fimEl = document.getElementById('an-dt-fim');

  // Se veio de fora (chat), sincroniza os campos da tela também, para que
  // o Dashboard Analítico mostre o mesmo período que foi de fato analisado.
  if (iniOverride && fimOverride) {
    if (iniEl) iniEl.value = iniOverride;
    if (fimEl) fimEl.value = fimOverride;
  }

  const iniStr = iniOverride || iniEl?.value;
  const fimStr = fimOverride || fimEl?.value;
  if (!iniStr || !fimStr) { if (typeof onDone === 'function') onDone({ ok: false, reason: 'periodo-ausente' }); return; }

  const dtIni = new Date(iniStr + 'T00:00:00');
  const dtFim = new Date(fimStr + 'T23:59:59');
  if (isNaN(dtIni) || isNaN(dtFim) || dtIni > dtFim) {
    toast('Período inválido', 'error');
    if (typeof onDone === 'function') onDone({ ok: false, reason: 'periodo-invalido' });
    return;
  }

  if (typeof showLoadingOverlay === 'function') showLoadingOverlay('Analisando período', 'Processando lançamentos e variações...');
  if (typeof loadingShowSteps === 'function') loadingShowSteps([
    { id: 'an-centrais', icon: 'ti-building-warehouse', label: 'Coletando centrais e materiais' },
    { id: 'an-calc',     icon: 'ti-calculator',         label: 'Calculando variações por central' },
    { id: 'an-saude',    icon: 'ti-heartbeat',           label: 'Calculando saúde e criticidade' },
    { id: 'an-render',   icon: 'ti-layout',              label: 'Renderizando resultados' },
  ]);
  requestAnimationFrame(() => setTimeout(() => _rodarAnaliticoCore(dtIni, dtFim, onDone), 0));
}

// silent (opcional): quando true, suprime toast de "sem dados" e NÃO
// mecha no overlay/steps de loading (nem abre nem fecha) — usado pela
// pré-carga automática no boot (restoreAndRender, em dashboard.js), que
// já controla seu próprio overlay único durante toda a inicialização.
// Chamada normal (clique em "Analisar") não passa esse parâmetro e
// mantém o comportamento original.
function _rodarAnaliticoCore(dtIni, dtFim, onDone, silent) {

  _anClearStockCache();

  // Limpa estado de pendentes considerados — cada nova análise começa do zero
  if (window._pendConsiderados) window._pendConsiderados = {};
  if (window._pendCache)        window._pendCache        = {};
  // Visão Pendências: derruba o cache dela também (período novo = dados novos)
  if (typeof _pendViewInvalidate === 'function') _pendViewInvalidate();

  // ── Build date-bound helpers ──────────────────────────────
  function inPeriod(dateStr) {
    const d = parseDate(dateStr);
    if (!d) return false;
    return d >= dtIni && d <= dtFim;
  }

  if (typeof _lstepSet === 'function') { _lstepSet('an-centrais', 'running'); _lbarSet(10); }

  // ── Collect all central keys ──────────────────────────────
  const lancIdx = getLancIndex();
  const sapIdx  = getSapIndex();
  ensureSaidasIndex();
  const allCentrals = new Set([
    ...lancIdx.byCentral.keys(),
    ...sapIdx.byCentral.keys()
  ]);

  if (!allCentrals.size) {
    if (!silent) {
      toast('Nenhum dado para o período selecionado', 'error');
      if (typeof hideLoadingOverlay === 'function') hideLoadingOverlay('Sem dados');
      if (typeof loadingHideSteps === 'function') loadingHideSteps();
    }
    if (typeof onDone === 'function') onDone({ ok: false, reason: 'sem-dados' });
    return;
  }

  if (typeof _lstepSet === 'function') { _lstepSet('an-centrais', 'done'); _lstepSet('an-calc', 'running'); _lbarSet(30); }

  // ── Per-central analysis ──────────────────────────────────
  const results = [];

  // Custo médio da Visão Micro: SÓ Custos SAP (central+Cód SAP+mês final do
  // período), sem cascata Saídas/Lançamentos/SAP (decisão do Hugo, 05/08) —
  // ver getCustoMedioCustosSap/buildCustosSapIndex (normalize.js), mesma
  // fonte usada pelo Inventário.
  const _custosSapIdx = buildCustosSapIndex();
  const _custosSapAno = dtFim.getFullYear();
  const _custosSapMes = dtFim.getMonth() + 1;

  allCentrals.forEach(central => {

    // ── Lançamentos desta central dentro do período — via índice ──
    const lancsNoPeriodoRaw = getLancsByCentralInPeriod(central, dtIni, dtFim)
      .slice() // não muta o array do índice
      .sort((a, b) => {
        const da = parseDate(a.dtLanc), db = parseDate(b.dtLanc);
        return dateCmp(da ?? new Date(0), db ?? new Date(0));
      });

    // ── SAP desta central dentro do período — via índice ──
    const sapNoPeriodoRaw = getSapByCentralInPeriod(central, dtIni, dtFim);

    // ── Filtragem na origem: materiais sem cadastro (ou cadastrados sem
    //    categoria) são separados AQUI, antes de qualquer agregação por
    //    material. Busca SEMPRE via materialOriginal — nunca via .material
    //    (nome já resolvido), que pode coincidir por acaso com o alias/
    //    origem de outro cadastro não relacionado (ambiguidade do caso
    //    XYPEX). Dessa forma, todo o código abaixo (somas, macro, health
    //    score, custo médio) já opera só sobre dados cadastrados — decisão
    //    confirmada: exclusão total até serem cadastrados, sem contar em
    //    nenhuma soma/gráfico/indicador, mas visível no indicador próprio.
    //    materialCatKeyMap: nome resolvido → catKey, construído SÓ a partir
    //    de registros já confirmados cadastrados — seguro reutilizar esse
    //    mapa nos cálculos abaixo em vez de re-derivar catKey pelo nome
    //    resolvido (que teria o mesmo risco de ambiguidade).
    const materialCatKeyMap = new Map();
    const matsSemCadastroSet = new Set(); // materialOriginal (texto exato)

    const lancsNoPeriodo = lancsNoPeriodoRaw.filter(r => {
      const catKey = getCatKeyDoCadastro(r.materialOriginal);
      if (!catKey) { matsSemCadastroSet.add(r.materialOriginal || '—'); return false; }
      materialCatKeyMap.set(r.material || '—', catKey);
      return true;
    });
    // Ajustes de Fechamento Mensal (Y11/Y12) detectados e não reincluídos
    // manualmente — coletados por material para exibir no popover de
    // breakdown (ver buildAnaliticoDetailBreakdown) com soma de peso/custo.
    // Excluídos do cálculo de Entradas/Saídas/Variação abaixo, mas o dado
    // bruto nunca é alterado — segue disponível na tela de Movimentações SAP.
    const sapFechExcluidosByMat = new Map();

    const sapNoPeriodo = sapNoPeriodoRaw.filter(r => {
      const catKey = getCatKeyDoCadastro(r.materialOriginal);
      if (!catKey) { matsSemCadastroSet.add(r.materialOriginal || '—'); return false; }
      materialCatKeyMap.set(r.material || '—', catKey);
      if (isSapExcluidoPorFechamento(r)) {
        const mat = r.material || '—';
        if (!sapFechExcluidosByMat.has(mat)) sapFechExcluidosByMat.set(mat, []);
        sapFechExcluidosByMat.get(mat).push(r);
        return false;
      }
      return true;
    });

    // ── SAP: entradas = tudo positivo, saídas = tudo negativo ──
    // Breakdown por código para cada tipo
    const entradasPorCod = {};   // cod → soma positiva
    const saidasPorCod   = {};   // cod → soma negativa

    sapNoPeriodo.forEach(r => {
      const cod = normMov(r.movimento);
      const p   = num(r.peso);
      if (p > 0) {
        entradasPorCod[cod] = (entradasPorCod[cod] || 0) + p;
      } else if (p < 0) {
        saidasPorCod[cod] = (saidasPorCod[cod] || 0) + p;
      }
    });

    const totalEntradas = Object.values(entradasPorCod).reduce((s, v) => s + v, 0);
    const totalSaidas   = Object.values(saidasPorCod).reduce((s, v) => s + v, 0);

    // ── Primeiro lançamento do período (mais antigo) ──
    // Agrupado por material → pega a versão mais antiga de cada material
    const materiaisLancPrimeiro = {};
    lancsNoPeriodo.forEach(r => {
      const mat = r.material || '—';
      if (!materiaisLancPrimeiro[mat]) materiaisLancPrimeiro[mat] = r;
    });

    // Soma todos os lançamentos do primeiro dia por material (caso haja múltiplos)
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

    // ── Último lançamento do período (mais recente) ──
    const lancsDesc = [...lancsNoPeriodo].sort((a, b) => {
      const da = parseDate(a.dtLanc), db = parseDate(b.dtLanc);
      return dateCmp(db ?? new Date(0), da ?? new Date(0));
    });
    const materiaisLancUltimo = {};
    lancsDesc.forEach(r => {
      const mat = r.material || '—';
      if (!materiaisLancUltimo[mat]) materiaisLancUltimo[mat] = r;
    });

    // ── All materials seen in this central ──
    const allMats = new Set([
      ...Object.keys(materiaisLancPrimeiro),
      ...Object.keys(materiaisLancUltimo),
      ...sapNoPeriodo.map(r => r.material || '—')
    ]);

    // ── Macro: sum across all materials ──
    // Para o Est. Final de cada material, soma todos os lançamentos
    // da data mais recente (consistente com buildSnapshot e modal diário)
    const _macroUltDayKey = {};
    lancsDesc.forEach(r => {
      const mat = r.material || '—';
      if (!_macroUltDayKey[mat]) {
        const d = parseDate(r.dtLanc);
        _macroUltDayKey[mat] = d ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : null;
      }
    });
    const _macroPesoFimSoma = {};
    lancsNoPeriodo.forEach(r => {
      const mat = r.material || '—';
      const d = parseDate(r.dtLanc);
      const dk = d ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : null;
      if (dk && dk === _macroUltDayKey[mat]) {
        _macroPesoFimSoma[mat] = (_macroPesoFimSoma[mat] || 0) + num(r.peso);
      }
    });
    // Est. Inicial do total da central: saldo teórico do SAP em dtIni−1, o
    // mesmo de cada linha de material (ver _anGetSapTheoreticalStock). O
    // lookup de catKey que existia aqui saiu junto: ele só servia pra regra
    // de Agregado do getPrePeriodLaunchStock, que não é mais a fonte.
    //
    // ponytail: a cascata de fallback do somaPrimeiro abaixo (?? lançamento
    // do 1º dia ?? peso do 1º lançamento) foi mantida como estava. Ela só
    // dispara quando NÃO há âncora de Custos SAP, e nesse caso o total da
    // central passa a misturar base do SAP com base de lançamento em
    // silêncio. Teto aceito por ora pra não mudar o comportamento do card
    // junto com a troca de fonte; upgrade = propagar o AUSENTE das linhas
    // para o total (decidir o que o card mostra quando falta âncora).
    const _prePeriodoStockByMat = {};
    allMats.forEach(mat => {
      const prev = _anGetSapStock({ central, material: mat, dtIni });
      if (prev) _prePeriodoStockByMat[mat] = prev.value;
    });

    let somaPrimeiro = 0;
    let somaUltimo   = 0;
    allMats.forEach(mat => {
      somaPrimeiro += (_prePeriodoStockByMat[mat] ?? _macroPesoIniSoma[mat] ?? num(materiaisLancPrimeiro[mat]?.peso));
      somaUltimo   += (_macroPesoFimSoma[mat] ?? num(materiaisLancUltimo[mat]?.peso));
    });

    // Teórico = 1º lançamento + entradas SAP + saídas SAP
    const estoqueTeoricoMacro = somaPrimeiro + totalEntradas + totalSaidas;
    const variacaoEstoque = somaUltimo - estoqueTeoricoMacro;

    // ── SAP breakdown by movement code ──
    const movBreakdown = {};
    sapNoPeriodo.forEach(r => {
      const cod = normMov(r.movimento);
      if (!movBreakdown[cod]) movBreakdown[cod] = 0;
      movBreakdown[cod] += num(r.peso);
    });

    // ── Custo médio por material: SÓ Custos SAP (central + Cód SAP + mês
    // final do período), sem cascata — ver índice _custosSapIdx acima.
    // 'sem_codigo': material sem Cód SAP cadastrado (nem dá pra buscar).
    // 'ausente': tem Cód SAP, mas não achou registro em Custos SAP pro
    // central/mês. Nenhum dos dois casos cai num valor silencioso — ambos
    // ficam visíveis como badge na tabela (ver buildCentralCard).
    const custoMedioPorMat           = {};
    const custoMedioFontePorMat      = {};  // 'custos_sap' | 'sem_codigo' | 'ausente'
    const custoMedioMesesAtrasPorMat = {};  // 0 = mês exato; >0 = veio de cascata (getCustoMedioCustosSap, normalize.js)
    allMats.forEach(mat => {
      const codSap = getCodSapPorGrupo(mat);
      if (!codSap) { custoMedioFontePorMat[mat] = 'sem_codigo'; return; }
      const custo = getCustoMedioCustosSap(central, codSap, _custosSapAno, _custosSapMes, _custosSapIdx);
      if (custo) {
        custoMedioPorMat[mat]           = custo.valor;
        custoMedioFontePorMat[mat]      = 'custos_sap';
        custoMedioMesesAtrasPorMat[mat] = custo.mesesAtras;
      } else {
        custoMedioFontePorMat[mat] = 'ausente';
      }
    });

    results.push({
      central,
      totalEntradas,
      totalSaidas,
      entradasPorCod,
      saidasPorCod,
      estoqueTeoricoMacro,
      somaPrimeiro,
      somaUltimo,
      variacaoEstoque,
      movBreakdown,
      allMats: [...allMats].sort(),
      materiaisLancPrimeiro,
      materiaisLancUltimo,
      sapNoPeriodo,
      lancsNoPeriodo,
      custoMedioPorMat,
      custoMedioFontePorMat,
      custoMedioMesesAtrasPorMat,
      matsSemCadastro: [...matsSemCadastroSet].sort(),
      materialCatKeyMap,
      sapFechExcluidosByMat
    });
  });

  // Sort by central name
  results.sort((a, b) => String(a.central).localeCompare(String(b.central), 'pt-BR'));

  renderAnaliticoMicro(results, dtIni, dtFim, silent);

  // Armazena para permitir re-render parcial via togglePendConsiderados
  window.__analiticoResults = results;
  window.__analiticoDtIni   = dtIni;
  window.__analiticoDtFim   = dtFim;

  document.getElementById('an-empty').style.display = 'none';
  document.getElementById('an-content').style.display = '';
  if (window.updatePeriodFab) updatePeriodFab();
  if (typeof onDone === 'function') onDone({ ok: true, dtIni, dtFim });
}

function parseMes(str) {
  // "Janeiro/2026" → {m:1, y:2026}
  if (!str) return null;
  const meses = {
    janeiro:1, fevereiro:2, março:3, marco:3, abril:4, maio:5, junho:6,
    julho:7, agosto:8, setembro:9, outubro:10, novembro:11, dezembro:12
  };
  const parts = str.toLowerCase().replace('ç','c').split(/[\s\/\-]+/);
  let m = null, y = null;
  parts.forEach(p => {
    const n = Number(p);
    if (!isNaN(n) && n > 1900) { y = n; }
    else if (meses[p]) { m = meses[p]; }
    // Handle "01/2026" style
    else if (/^\d{1,2}$/.test(p) && !m) { m = Number(p); }
  });
  return m && y ? { m, y } : null;
}

// ── Breakdown popover: portal pattern ──────────────────────
// A single floating popover node is reused for all breakdown triggers.
// It lives directly on <body> so position:fixed is never offset by
// any CSS transform / overflow:hidden ancestor inside the table.
let _bdPortal = null;
let _bdActiveTrigger = null;

function _ensureBdPortal() {
  if (_bdPortal) return _bdPortal;
  _bdPortal = document.createElement('div');
  _bdPortal.className = 'breakdown-popover';
  _bdPortal.addEventListener('click', e => e.stopPropagation());
  document.body.appendChild(_bdPortal);
  return _bdPortal;
}

function _closeBdPortal() {
  if (!_bdPortal) return;
  _bdPortal.classList.remove('open');
  if (_bdActiveTrigger) {
    const c = _bdActiveTrigger.querySelector('.breakdown-chev');
    if (c) c.style.transform = '';
    _bdActiveTrigger = null;
  }
}

function toggleBreakdown(trigger) {
  const portal = _ensureBdPortal();
  const inlinePopover = trigger.nextElementSibling;
  if (!inlinePopover || !inlinePopover.classList.contains('breakdown-popover')) return;
  const chev = trigger.querySelector('.breakdown-chev');

  // Clicking the same trigger again → close
  if (_bdActiveTrigger === trigger && portal.classList.contains('open')) {
    _closeBdPortal();
    return;
  }

  // Close previous popover (resets old chev) before populating the new one
  _closeBdPortal();

  // Copy content from the inline template into the portal
  portal.innerHTML = inlinePopover.innerHTML;

  // Position: measure BEFORE making visible so we get real viewport coords
  const rect = trigger.getBoundingClientRect();
  const popW = 220;
  const spaceRight = window.innerWidth - rect.left;
  const spaceBelow = window.innerHeight - rect.bottom;

  portal.style.width   = popW + 'px';
  portal.style.left    = (spaceRight >= popW ? rect.left : Math.max(4, rect.right - popW)) + 'px';
  portal.style.top     = (spaceBelow >= 180 ? rect.bottom + 6 : rect.top - 6) + 'px';
  portal.style.transform = spaceBelow >= 180 ? '' : 'translateY(-100%)';

  _bdActiveTrigger = trigger;
  portal.classList.add('open');
  if (chev) chev.style.transform = 'rotate(180deg)';
}

// Close breakdown portal when clicking outside
document.addEventListener('click', e => {
  if (!_bdPortal) return;
  if (!e.target.closest('.breakdown-trigger') && !e.target.closest('.breakdown-popover')) {
    _closeBdPortal();
  }
}, true);



// ═══════════════════════════════════════════════════════════
// ORDENAÇÃO DAS TABELAS DOS CARDS DA VISÃO MICRO
// ═══════════════════════════════════════════════════════════
// Serve as DUAS tabelas do card, nos dois agrupamentos:
//   • Análise por Material / por Central  (aqui, buildCentralCard)
//   • Capacidade e Estoque de Segurança   (buildCapacidadeSection, capacidades.js)
//
// Contrato do markup — nada é fixo no JS, tudo vem da própria tabela:
//   <th data-sort-col="N" data-sort-type="text|date|num|abs" onclick="sortMicroTable(this,event)">
//   <tr data-sort-0="..." data-sort-1="..." ...>   ← valor CRU de cada coluna
// Linhas sem data-sort-0 (ex.: a linha de estado vazio com colspan) ficam
// paradas onde estão.
//
// A ordenação é feita no DOM, reordenando os <tr> — não re-renderiza nada.
// Isso mantém intactos o breakdown de Entradas/Saídas/Ajustes, os tooltips
// e o estado de filtro de cada linha (linha escondida por filtro segue
// escondida no lugar novo).
//
// Ícone/estilo vêm do padrão já usado nas tabelas de módulo
// (th[data-sort-col] + .mod-sort-icon, ver components.css) — nada de CSS novo.
const _SORT_ICO = '<i class="ti ti-selector mod-sort-icon"></i>';

// "31/07/2026" → "2026-07-31" (ordenável como texto). Deriva do MESMO rótulo
// que a célula exibe, então nunca diverge do que está na tela.
function _sortDateKey(label) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(label || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

function sortMicroTable(th, event) {
  // Clique no punho de redimensionar coluna (ou logo depois de arrastá-lo)
  // não pode virar ordenação — ver makeResizable em ui.js.
  if (event && event.target.closest && event.target.closest('.col-resizer')) return;
  if (th.dataset.justResized) return;

  const col   = parseInt(th.dataset.sortCol, 10);
  const table = th.closest('table');
  const tbody = table?.querySelector('tbody');
  if (isNaN(col) || !tbody) return;

  const rows = [...tbody.querySelectorAll('tr')].filter(r => r.hasAttribute('data-sort-0'));
  if (rows.length < 2) return;

  // Tipos: 'text' alfabético (numeric:true resolve "10" vs "9" em Cód SAP),
  // 'date' chave AAAA-MM-DD comparada como texto, 'num' numérico com sinal,
  // 'abs' numérico pelo MÓDULO (pedido do Hugo) — num ranking de variação,
  // desfalque de 500 kg e sobra de 500 kg são o mesmo tamanho de problema, e
  // ordenar pelo sinal jogaria metade deles pro fim.
  const tipo    = th.dataset.sortType || 'text';
  const isTexto = tipo === 'text' || tipo === 'date';
  // 1º clique: crescente em texto/data, DECRESCENTE em número — quem abre
  // uma coluna de variação ou estoque quer o maior no topo, não o zero.
  const dir = th.classList.contains('sort-asc')  ? 'desc'
            : th.classList.contains('sort-desc') ? 'asc'
            : isTexto ? 'asc' : 'desc';

  const chave = (row) => {
    // getAttribute, e não dataset: em "data-sort-0" o traço NÃO é convertido
    // (a regra do dataset só junta o que vem depois de "-" quando é letra),
    // então a chave em dataset seria "sort-0" e "row.dataset.sort0" leria
    // undefined em toda coluna.
    const raw = row.getAttribute('data-sort-' + col) ?? '';
    if (raw === '') return null;              // AUSENTE / sem cadastro
    if (isTexto) return raw;
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) return null;
    return tipo === 'abs' ? Math.abs(n) : n;
  };

  const mult = dir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    const va = chave(a), vb = chave(b);
    // Sem valor sempre no fim, nas duas direções.
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return (isTexto ? String(va).localeCompare(String(vb), 'pt-BR', { numeric: true }) : va - vb) * mult;
  });
  rows.forEach(row => tbody.appendChild(row));

  // Uma coluna ordenada por tabela — o estado visual vive nas classes
  // sort-asc/sort-desc, que também trocam o glifo do ícone via CSS.
  table.querySelectorAll('thead th').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
  th.classList.add(dir === 'asc' ? 'sort-asc' : 'sort-desc');
}
window.sortMicroTable = sortMicroTable;

/**
 * Monta UM card da Visão Micro (header + cpanel + tabela). Extraida de
 * renderAnaliticoMicro para ser reaproveitavel tanto no render completo
 * quanto no refresh cirurgico de um card isolado (ver refreshCentralCard /
 * refreshMaterialCard, chamadas pelos toggles de pendentes em ui.js).
 *
 * Dois modos, mesma anatomia (donut de saúde, maiores variações,
 * capacidade, integração SAP e a tabela de linhas):
 *
 *   opts.mode = 'central' (padrão) → card = uma CENTRAL, linhas = materiais.
 *       `r` é um resultado de _rodarAnaliticoCore.
 *   opts.mode = 'material'         → card = um MATERIAL, linhas = centrais.
 *       `r` é { material, centrais: [...], byCentral: Map<central, resultado> },
 *       montado por _buildMatGroups (ver renderAnaliticoMicro).
 *
 * Em ambos os modos cada LINHA continua sendo o par (central, material) — o
 * que muda é qual dos dois é fixo no card e qual varia nas linhas. Por isso
 * todo o miolo (Est. Inicial/Final, snapshot, breakdown diário, custo médio,
 * modal de detalhamento) é literalmente o mesmo código: só a resolução de
 * `central`/`mat` a partir do item da linha é que difere.
 *
 * @param {object} r       - resultado da central, ou grupo do material
 * @param {number} idx     - indice estavel usado nos ids de DOM (chev-N, micro-body-N etc.)
 * @param {Date}   dtIni
 * @param {Date}   dtFim
 * @param {object} [opts]
 * @param {'central'|'material'} [opts.mode='central']
 * @returns {HTMLElement} o elemento .micro-filial-card pronto para inserir no DOM
 */
function buildCentralCard(r, idx, dtIni, dtFim, opts = {}) {
  // Defensivo: garante o índice de Saídas por central construído mesmo no
  // caminho de refresh avulso de um único card (refreshCentralCard), que
  // não passa por _rodarAnaliticoCore (onde isso já é garantido no topo).
  // Custo desprezível quando já construído (ensureSaidasIndex só reconstrói
  // se necessário).
  if (typeof ensureSaidasIndex === 'function') ensureSaidasIndex();

  const isMat = opts.mode === 'material';
  // Nome/ícone do card e resolução de (central, material) por item da linha.
  const cardName  = isMat ? (r.material || '—') : (r.central || '—');
  const itemLabel = isMat ? 'Central' : 'Material';
  const _itemSing = isMat ? 'central'  : 'material';
  const _itemPlur = isMat ? 'centrais' : 'materiais';
  const centralOf = (item) => isMat ? item : r.central;
  const matOf     = (item) => isMat ? r.material : item;
  // Resultado (_rodarAnaliticoCore) da central de uma linha — no modo
  // central é sempre o mesmo `r`; no modo material vem do índice do grupo.
  const resOf     = (central) => isMat ? r.byCentral.get(central) : r;

  const start = new Date(dtIni);
  start.setHours(0, 0, 0, 0);
  const end = new Date(dtFim);
  end.setHours(0, 0, 0, 0);

  const dateKey = (d) => {
    const dt = d instanceof Date ? d : parseDate(d);
    if (!dt) return '';
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  };

  const buildDayList = () => {
    const days = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      days.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  };

  const dayList = buildDayList();

    // Chave dos dois mapas = o ITEM da linha (material no modo central,
    // central no modo material) — ver o cabeçalho da função.
    const lancsByItem = new Map();
    const sapByItem   = new Map();
    const _pushItem = (map, item, rec) => {
      if (!map.has(item)) map.set(item, []);
      map.get(item).push(rec);
    };

    if (isMat) {
      (r.centrais || []).forEach(central => {
        const rc = r.byCentral.get(central);
        if (!rc) return;
        (rc.lancsNoPeriodo || []).forEach(rec => { if ((rec.material || '—') === r.material) _pushItem(lancsByItem, central, rec); });
        (rc.sapNoPeriodo   || []).forEach(rec => { if ((rec.material || '—') === r.material) _pushItem(sapByItem,   central, rec); });
      });
    } else {
      (r.lancsNoPeriodo || []).forEach(rec => _pushItem(lancsByItem, rec.material || '—', rec));
      (r.sapNoPeriodo   || []).forEach(rec => _pushItem(sapByItem,   rec.material || '—', rec));
    }

    // ── Injeção de pendentes considerados ────────────────────────────────
    // Quando o analista ativa "Considerar NFs/OS pendentes", registros SAP
    // sintéticos são injetados em sapByMat para refletir o impacto no cálculo.
    // Os dados vêm de _pendCache, populado por buildPendIntegSection no render anterior.
    //
    // Por decisão explícita do usuário, essa injeção agora se propaga para
    // TUDO que deriva de sapByMat — inclusive o detalhamento por dia (Est.
    // Inicial/Final, variação e saúde do dia), não só o resumo da linha do
    // material. Antes existia uma cópia "limpa" separada (sapByMatClean)
    // mantida deliberadamente imune ao toggle só para o breakdown diário;
    // essa separação foi removida a pedido — agora um único sapByMat (já
    // com os sintéticos, quando o toggle está ativo) alimenta tanto o
    // resumo quanto o breakdown diário.
    //
    // No modo material o escopo do toggle muda: o estado é por MATERIAL
    // (_pendConsideradosMat, ver togglePendConsideradosMat em ui.js) e as
    // pendentes injetadas são as daquele material em todas as centrais.
    // Os pendentes em si saem do mesmo _pendCache (por central) nos dois
    // modos — só o recorte e a chave do item mudam.
    const _pendState = isMat
      ? ((window._pendConsideradosMat || {})[r.material] || {})
      : ((window._pendConsiderados    || {})[r.central]  || {});
    // Pendentes deste card, já com a central de origem de cada um.
    const _pendListas = (() => {
      const cache = window._pendCache || {};
      if (!isMat) {
        const c = cache[r.central] || {};
        return {
          nf: (c.pendNF || []).map(e => ({ e, central: r.central })),
          os: (c.pendOS || []).map(e => ({ e, central: r.central }))
        };
      }
      const nf = [], os = [];
      (r.centrais || []).forEach(central => {
        const c = cache[central] || {};
        (c.pendNF || []).forEach(e => { if ((e.material || '—') === r.material) nf.push({ e, central }); });
        (c.pendOS || []).forEach(e => { if ((e.material || '—') === r.material) os.push({ e, central }); });
      });
      return { nf, os };
    })();
    const _itensComPendNF = new Set();
    const _itensComPendOS = new Set();
    if (_pendState.nf) {
      _pendListas.nf.forEach(({ e, central }) => {
        const mat  = e.material || '—';
        const item = isMat ? central : mat;
        _pushItem(sapByItem, item, {
          movimento: '101',
          peso:      _convertNfPesoToKg(e.peso, e.um, e.material),
          ref:       String(e.nf || ''),
          documento: '',
          material:  mat,
          dtLanc:    e.dtDescarga || e.dtEmissao || '',
          _sintetico: true
        });
        _itensComPendNF.add(item);
      });
    }
    if (_pendState.os) {
      _pendListas.os.forEach(({ e, central }) => {
        const mat  = e.material || '—';
        const item = isMat ? central : mat;
        _pushItem(sapByItem, item, {
          movimento: '201',
          peso:      -Math.abs(num(e.peso)),
          ref:       String(e.os || ''),
          documento: '',
          material:  mat,
          dtLanc:    e.dtEmissao || '',
          _sintetico: true
        });
        _itensComPendOS.add(item);
      });
    }

    let matRowsHtml = '';
    let variacaoCentralMicro = 0;
    let custoVariacaoTotal = 0;  // R$ implicados pela variação de estoque
    // Alimenta a seção "Capacidade e Estoque de Segurança" do card — usa o
    // MESMO Est. Final da tabela (snapshot.pesoFim), pra os dois nunca
    // divergirem. Ver buildCapacidadeSection em capacidades.js.
    const capMatsInfo = [];

    // ── Criticidade por material (badge ao lado do nome) ─────────────────
    // Reaproveita os mesmos thresholds/classificação usados no painel de
    // saúde (donut/chips) para garantir consistência entre a linha da
    // tabela e os contadores agregados do card.
    const thresholds = getHealthThresholds();
    const MAT_LEVEL_ICON  = { bom: 'ti-circle-check', atencao: 'ti-alert-triangle', urgente: 'ti-alert-circle', critico: 'ti-flame', sem_cadastro: 'ti-help-circle' };
    const MAT_LEVEL_LABEL = { bom: 'Bom', atencao: 'Atenção', urgente: 'Urgente', critico: 'Crítico', sem_cadastro: 'Sem cadastro' };
    const MAT_LEVEL_COLOR = { bom: 'var(--green)', atencao: 'var(--amber)', urgente: 'var(--urgente)', critico: 'var(--red)', sem_cadastro: 'var(--text3)' };

    // Lookup de catKey por material — reaproveita r.materialCatKeyMap
    // (construído a partir de materialOriginal na filtragem de origem em
    // _rodarAnaliticoCore). r.allMats já só contém materiais cadastrados
    // — este é um lookup seguro, não uma re-derivação por nome resolvido.
    const _catKeyOf = (rc, mat) => (rc?.materialCatKeyMap || new Map()).get(mat) || null;

    // Lista de materiais sem cadastro nesta central — vem direto de
    // r.matsSemCadastro (materialOriginal dos registros já excluídos na
    // filtragem de origem), não de r.allMats (que não os contém mais).
    // Alimenta o chip "sem cadastro" do painel de saúde.
    //
    // No modo material o chip não faz sentido (o card É um material, e só
    // materiais cadastrados viram card) — fica vazio.
    const _matsSemCadastroCentral = isMat ? [] : (r.matsSemCadastro || []);
    if (!window.__analiticoSemCadastroCache) window.__analiticoSemCadastroCache = new Map();
    if (!isMat) window.__analiticoSemCadastroCache.set(idx, { central: r.central, materiais: _matsSemCadastroCentral });

    // Ordem padrão das linhas: PIOR SAÚDE primeiro (decisão do Hugo) —
    // crítico → urgente → atenção → bom, o mesmo nível do ícone de
    // criticidade que a linha exibe. Empate dentro do nível cai para a
    // MAGNITUDE da variação (maior primeiro): dentro de "crítico", quem
    // está 5 t fora vem antes de quem está 1 t fora, seja desfalque ou
    // sobra. Antes a ordem era pelo diff com sinal, o que empurrava as
    // maiores sobras para o fim da tabela mesmo sendo tão graves quanto os
    // maiores desfalques.
    //
    // A chave é calculada uma única vez por item (transformada de
    // Schwartzian, mesmo padrão da ordenação dos cards em
    // renderAnaliticoMicro) — o comparador antigo rodava
    // getPrePeriodLaunchStock + buildSnapshot O(n log n) vezes.
    const _NIVEL_ORDEM = { critico: 0, urgente: 1, atencao: 2, bom: 3, sem_cadastro: 4 };
    const _itemSortKey = (item) => {
      const itemCentral = centralOf(item);
      const itemMat     = matOf(item);
      const prev = _anGetSapStock({ central: itemCentral, material: itemMat, dtIni });
      const diff = buildSnapshot({ lancs: lancsByItem.get(item) || [], sap: sapByItem.get(item) || [], initialStockOverride: prev?.value ?? null }).diff;
      const nivel = classifyVariation(Math.abs(diff), _catKeyOf(resOf(itemCentral) || {}, itemMat), thresholds);
      return { ordem: _NIVEL_ORDEM[nivel] ?? 9, magnitude: Math.abs(diff) };
    };
    const allItemsSorted = (isMat ? (r.centrais || []) : r.allMats)
      .map(item => ({ item, k: _itemSortKey(item) }))
      .sort((a, b) => (a.k.ordem - b.k.ordem) || (b.k.magnitude - a.k.magnitude))
      .map(entry => entry.item);

    allItemsSorted.forEach((item, matIdx) => {
      const central  = centralOf(item);
      const mat      = matOf(item);
      const rc       = resOf(central) || {};
      const lancsMat = lancsByItem.get(item) || [];
      const sapMat   = sapByItem.get(item)   || [];

      // ── Classificação de categoria do material ──────────────────────────
      // Calculado antes do buildSnapshot para poder usar matCatKey no preCarry.
      // mat aqui já é garantidamente cadastrado — allItemsSorted vem de
      // r.allMats, pré-filtrado na origem (_rodarAnaliticoCore) via
      // materialOriginal. catKey vem do materialCatKeyMap já validado, sem
      // re-derivação por nome resolvido. matSemCadastro fica só como
      // segurança defensiva (não deve mais disparar na prática).
      const matCategoria    = getCategoriaPorGrupo(mat);
      const matCatKey       = _catKeyOf(rc, mat);
      const matSemCadastro  = !matCatKey;
      const isSemanal       = matCatKey === 'agregado';

      // ── Est. Inicial do card de resumo ──────────────────────────────────
      // Saldo TEÓRICO do SAP em dtIni−1 (âncora Custos SAP + movimentações),
      // não mais o lançamento do operador — ver _anGetSapTheoreticalStock no
      // topo do arquivo. Sem catKey: a regra de Agregado (recuar até a última
      // terça) era necessária quando a fonte era lançamento, que só existe em
      // dias de conferência; o saldo do SAP existe em qualquer data.
      const prev = _anGetSapStock({ central, material: mat, dtIni });

      // ── Est. Inicial do carry da tabela de dias ──────────────────────────
      // getPrevDayLaunchStock: busca usando regras por categoria
      // (agregado → última terça, 1º do mês → último dia do mês anterior, demais → dia anterior).
      const preCarryLanc = _anGetPrevDayStock({ central, material: mat, dtIni, catKey: matCatKey });

      // Regra do Hugo (13/08/2026): o carry só arranca do saldo do SAP quando
      // o período analisado COMEÇA NO DIA 1 — aí "Est. Inicial do carry" e
      // "Est. Inicial do mês" são a mesma coisa, e não faz sentido a primeira
      // linha da tabela discordar do card logo acima dela.
      //
      // Período no meio do mês (ex.: 11/08 a 20/08) continua puxando o
      // LANÇAMENTO do dia anterior, como sempre: ali o analista está olhando
      // uma janela dentro do mês, e o que interessa como ponto de partida é o
      // que o operador contou na véspera, não o livro do SAP.
      //
      // prev.date = dtIni−1, então o sapFrom da primeira linha cai exatamente
      // em dtIni — o saldo do SAP já embute tudo até a véspera, sem contar
      // movimentação duas vezes.
      const preCarry = (dtIni.getDate() === 1)
        ? (prev ? { value: prev.value, date: prev.date } : null)
        : preCarryLanc;
      const fim  = _anGetLastPeriodStockFallback({ central, material: mat, dtIni, dtFim });
      const snapshot = buildSnapshot({
        lancs: lancsMat,
        sap: sapMat,
        initialStockOverride:     prev?.value  ?? null,
        initialDateLabelOverride: prev?.dtLabel ?? null,
        finalStockOverride:       fim && !fim.missing ? fim.value : null,
        finalDateLabelOverride:   fim && !fim.missing ? fim.dtLabel : null
      });
      variacaoCentralMicro += snapshot.diff;
      // acumula custo implicado: diff (kg) × custo médio do material (R$/kg)
      const custoMedMat = (rc.custoMedioPorMat || {})[mat] || 0;
      if (custoMedMat > 0) custoVariacaoTotal += snapshot.diff * custoMedMat;

      // Nível de criticidade do material (mesma regra do painel de saúde)
      const matLevel = classifyVariation(Math.abs(snapshot.diff), matCatKey, thresholds);

      const dCls = varClass(snapshot.diff);
              const toEntry = s => {
        // ref "efetivo" (com fallback pra documento quando vem vazio do SAP)
        // — usado só internamente pro pareamento de transferência 861/862
        // (findTransferPairCentral, ui.js), que já indexa por esse mesmo
        // fallback. NÃO é o que aparece na coluna Ref. (ver refRaw abaixo).
        const ref = (s.ref && String(s.ref).trim()) ? String(s.ref).trim()
                  : (s.documento && String(s.documento).trim()) ? String(s.documento).trim() : '';
        // extra: campos crus. refRaw/pedido/documento alimentam as colunas
        // Ref./Pedido/Doc MIGO (separadas) do modal e dtDoc/dtLanc/dtReg as
        // colunas de data. Os mesmos campos servem ao pareamento das
        // transferências, cada uma com sua chave (ambas em ui.js): 861/862
        // casa por pedido + material + ref + |peso| (findTransferPairCentral);
        // 309, que não tem ref compartilhada, casa por central + depósito +
        // usuário + as 3 datas + |peso| (findMaterialTransferPair).
        const extra = {
          deposito:  String(s.deposito  || '').trim(),
          refRaw:    String(s.ref       || '').trim(),
          pedido:    String(s.pedido    || '').trim(),
          documento: String(s.documento || '').trim(),
          dtDoc:     String(s.dtDoc     || '').trim(),
          dtLanc:    String(s.dtLanc    || '').trim(),
          dtReg:     String(s.dtReg     || '').trim()
        };
        return [normMov(s.movimento), num(s.peso), ref, String(s.usuario || '').trim(), String(s.dtLanc || s.dtDoc || '').trim(), extra];
      };
      // Rateio por NATUREZA do código (ENTRADAS/SAÍDAS/AJUSTES) em vez do
      // sinal do peso — ver repartirSapPorNatureza em ui.js. Reparte o MESMO
      // conjunto que alimentou o buildSnapshot, então a soma dos três baldes
      // é idêntica a snapshot.totalEnt + snapshot.totalSai: Est. Teórico e
      // Variação seguem vindo do snapshot, intactos. Muda só a apresentação.
      const natureza   = repartirSapPorNatureza(sapMat);
      const entEntries = natureza.entRecords.map(toEntry);
      const saiEntries = natureza.saiRecords.map(toEntry);
      const ajuEntries = natureza.ajuRecords.map(toEntry);

      // ── Contagem de registros locais (páginas Entradas/Saídas) ──────────
      // Mesmo escopo do modal de Movimentações SAP (este material + esta
      // central + este período) — permite comparar "quantos registros
      // existem no SAP" vs "quantos existem cadastrados localmente".
      // Prioridade de central para Entradas: centralDestino primeiro,
      // fallback centralCompra (a pedido do Hugo, 06/08) — INVERSA da usada
      // por calcPendentesIntegracao/NFs Pendentes (ui.js), por isso usa o
      // índice dedicado opts.entradasByCentralDestino em vez do
      // opts.entradasByCentral compartilhado com aquela feature.
      // Reaproveita o pré-agrupamento por central (ver renderAnaliticoMicro)
      // e o índice _saidasByCentral já mantido em ui.js — em vez de varrer
      // state.entradas/state.saidas inteiros a cada material de cada central.
      const _entradasDestaCentral = opts.entradasByCentralDestino
        ? (opts.entradasByCentralDestino.get(central) || [])
        : (state.entradas || []).filter(e => (e.centralDestino || e.centralCompra || '') === central);
      const _entradasFiltradas = _entradasDestaCentral.filter(e => {
        if (e.material !== mat) return false;
        const d = parseDate(e.dtDescarga || e.dtEmissao);
        return d && d >= start && d <= end;
      });
      const localEntCount = _entradasFiltradas.length;
      // Total em kg dos mesmos registros — usado na comparação SAP × página
      // Entradas/Saídas no rodapé do modal de Movimentações (ver
      // buildAnaliticoDetailBreakdown/openBreakdownModal em ui.js). Peso da
      // NF pode vir em TO/M³ (campo `um`) — mesma conversão usada por
      // NFs Pendentes (_convertNfPesoToKg, ver ui.js), não é seguro somar
      // e.peso bruto.
      const localEntTotal = _entradasFiltradas.reduce((sum, e) => sum + _convertNfPesoToKg(e.peso, e.um, e.material), 0);
      const _saidasDestaCentral = _saidasByCentral.get(central) || [];
      const _saidasFiltradas = _saidasDestaCentral.filter(s => {
        if (s.material !== mat) return false;
        const d = parseDate(s.dtEmissao);
        return d && d >= start && d <= end;
      });
      const localSaiCount = _saidasFiltradas.length;
      const localSaiTotal = _saidasFiltradas.reduce((sum, s) => sum + _convertNfPesoToKg(s.peso, s.um, s.material), 0);

      // Quando AUSENTE: busca os dois lançamentos mais próximos para tooltip
      // informativo. Continua ancorado em preCarryLanc, NÃO em preCarry: o
      // tooltip fala de lançamentos (alimenta o AUSENTE do Est. Final), então
      // ele não pode sumir só porque o carry do dia 1 passou a vir do SAP.
      const absentNearest = preCarryLanc ? null
        : getNearestLancsForAbsent({ central, material: mat, dtIni, dtFim });

      // ── Carry entre períodos (diário ou semanal) ─────────────────────
      // carry.date = data do último lançamento real, usada para delimitar o SAP
      // acumulado desde aquele dia até o próximo lançamento (em vez de janela fixa de 6 dias).
      //   carry = { value, isEstimated, date }
      //   isEstimated = true quando o saldo veio do Est. Teórico (sem lançamento)
      // carry.date = data real do lançamento encontrado (usada para sapFrom no próximo lançamento)
      let carry = preCarry
        ? { value: preCarry.value, isEstimated: false, date: preCarry.date }
        : null; // null = sem histórico anterior conhecido

      // Para semanais: rastreia se a semana corrente já teve lançamento
      let semanaComLanc = false;
      let semanaAtualLunes = null; // segunda-feira da semana corrente

      const getSegundaFeira = (d) => {
        const dt = new Date(d);
        const dow = dt.getDay(); // 0=Dom
        const diff = (dow === 0) ? -6 : 1 - dow; // volta até segunda
        dt.setDate(dt.getDate() + diff);
        dt.setHours(0,0,0,0);
        return localISODate(dt);
      };

      const firstDayKey = dateKey(dayList[0]);

      const dailyRows = dayList.map(day => {
        const key = dateKey(day);
        const isFirstDay = key === firstDayKey;
        const dayLancs = lancsMat.filter(rec => dateKey(parseDate(rec.dtLanc)) === key);
        const daySap   = sapMat.filter(rec => dateKey(parseDate(rec.dtLanc)) === key);
        const daySnap  = buildSnapshot({ lancs: dayLancs, sap: daySap });

        const toDayEntry = s => {
          // ref efetivo (fallback pra documento) — mesmo papel de toEntry
          // (linha ~833): só pro pareamento de transferência, não pra exibição.
          const ref = (s.ref && String(s.ref).trim()) ? String(s.ref).trim()
                    : (s.documento && String(s.documento).trim()) ? String(s.documento).trim() : '';
          // extra: mesmos campos crus de toEntry — refRaw/documento pras
          // colunas Ref./Documento (separadas), depósito e as 3 datas cruas
          // pelas colunas Dt. Documento/Dt. Registro e pelo pareamento de
          // transferências 861/862/309 no modal.
          const extra = {
            deposito:  String(s.deposito  || '').trim(),
            refRaw:    String(s.ref       || '').trim(),
            pedido:    String(s.pedido    || '').trim(),
            documento: String(s.documento || '').trim(),
            dtDoc:     String(s.dtDoc     || '').trim(),
            dtLanc:    String(s.dtLanc    || '').trim(),
            dtReg:     String(s.dtReg    || '').trim()
          };
          return [normMov(s.movimento), num(s.peso), ref, String(s.usuario || '').trim(), String(s.dtLanc || s.dtDoc || '').trim(), extra];
        };
        // Mesmo rateio por natureza da linha do material (ver natureza acima),
        // aplicado ao SAP deste dia — sem isso o modal contradiria a tabela
        // que o abriu. Os totais de estoque continuam vindo do daySnap/
        // snapSemana (soma idêntica), só a exibição muda de balde.
        const dayNat        = repartirSapPorNatureza(daySap);
        const dayEntEntries = dayNat.entRecords.map(toDayEntry);
        const daySaiEntries = dayNat.saiRecords.map(toDayEntry);
        const dayAjuEntries = dayNat.ajuRecords.map(toDayEntry);

        const hasLanc = dayLancs.length > 0;
        const isTerca = day.getDay() === 2; // 2 = terça-feira

        if (isSemanal) {
          // ── LÓGICA SEMANAL ───────────────────────────────────────────
          // Controle de semana: ao entrar numa nova semana, verifica se
          // a semana anterior teve lançamento.
          const semanaKey = getSegundaFeira(day);
          if (semanaKey !== semanaAtualLunes) {
            // Nova semana: se a semana anterior não teve lançamento,
            // o carry passa a ser estimado (Est. Teórico da semana anterior)
            if (semanaAtualLunes !== null && !semanaComLanc) {
              // carry já foi propagado como estimado ao longo dos dias
              // não precisa fazer nada aqui
            }
            semanaAtualLunes = semanaKey;
            semanaComLanc = false;
          }

          if (hasLanc) semanaComLanc = true;

          // Dias não-terça sem lançamento: carry.value e carry.date não mudam.
          // O SAP deste dia será absorvido pelo próximo lançamento (sapFrom = carry.date + 1).
          if (!isTerca && !hasLanc) {
            const initialStock = carry ? carry.value : 0;
            const initialIsEstimated = carry ? carry.isEstimated : false;
            const estTeorico = initialStock + daySnap.totalEnt + daySnap.totalSai;
            // carry permanece inalterado intencionalmente
            return {
              dateLabel: fmtPtDate(day),
              lancCount: 0,
              initialStock,
              initialIsEstimated,
              entEntries: dayEntEntries,
              saiEntries: daySaiEntries,
              ajuEntries: dayAjuEntries,
              totalEnt: dayNat.totalEnt,
              totalSai: dayNat.totalSai,
              totalAju: dayNat.totalAju,
              theoreticalStock: estTeorico,
              finalStock: estTeorico,
              finalIsEstimated: true,
              hasLanc: false,
              precisaLanc: false,
              isSemanalNaoConferencia: true,
              diff: 0
            };
          }

          // Terça OU dia com lançamento:
          // Est. Inicial = carry atual (último lançamento real ou teórico anterior)
          const initialStock = carry ? carry.value : 0;
          const initialIsEstimated = carry ? carry.isEstimated : false;

          // SAP acumulado desde o dia seguinte ao último lançamento (carry.date) até hoje.
          // Isso garante que todo SAP entre dois lançamentos consecutivos seja absorvido,
          // independente de quantos dias se passaram ou se o lançamento é numa terça ou não.
          const sapFrom = carry && carry.date
            ? (() => { const d = new Date(carry.date); d.setDate(d.getDate() + 1); d.setHours(0,0,0,0); return d; })()
            : new Date(0);
          const sapSemana = sapMat.filter(rec => {
            const d = parseDate(rec.dtLanc);
            return d && d >= sapFrom && d <= day;
          });
          const snapSemana = buildSnapshot({ lancs: [], sap: sapSemana });
          const estTeorico = initialStock + snapSemana.totalEnt + snapSemana.totalSai;

          const hasConflict = dayLancs.length > 1;
          let finalStock, finalIsEstimated;
          if (hasLanc) {
            // Com conflito: usa o maior peso como estimativa conservadora até o usuário resolver
            finalStock = hasConflict
              ? Math.max(...dayLancs.map(l => num(l.peso)))
              : daySnap.pesoFim;
            finalIsEstimated = false;
            carry = { value: finalStock, isEstimated: false, date: day };
          } else {
            // Terça sem lançamento: Est. Final = Est. Teórico (estimado)
            finalStock = estTeorico;
            finalIsEstimated = true;
            carry = { value: estTeorico, isEstimated: true, date: day };
          }

          // Variação sempre calculada: EST FINAL − EST TEÓRICO.
          // Dias sem lançamento: finalStock = estTeorico → diff = 0 por definição.
          const diff = finalStock - estTeorico;

          return {
            dateLabel: fmtPtDate(day),
            lancCount: dayLancs.length,
            hasConflict,
            lancamentos: dayLancs,
            initialStock,
            initialIsEstimated,
            entEntries: dayEntEntries,
            saiEntries: daySaiEntries,
            ajuEntries: dayAjuEntries,
            totalEnt: dayNat.totalEnt,
            totalSai: dayNat.totalSai,
            totalAju: dayNat.totalAju,
            theoreticalStock: estTeorico,
            finalStock,
            finalIsEstimated,
            hasLanc,
            precisaLanc: true,
            isSemanalNaoConferencia: false,
            isTercaConferencia: isTerca,   // terça = dia de conferência obrigatória
            diff
          };

        } else {
          // ── LÓGICA DIÁRIA ────────────────────────────────────────────
          // Est. Inicial = carry (último lançamento real ou teórico anterior)
          const initialStock = carry ? carry.value : 0;
          const initialIsEstimated = carry ? carry.isEstimated : false;

          const estTeorico = initialStock + daySnap.totalEnt + daySnap.totalSai;

          const hasConflict = dayLancs.length > 1;
          let finalStock, finalIsEstimated;
          if (hasLanc) {
            finalStock = hasConflict
              ? dayLancs.reduce((acc, l) => acc + num(l.peso), 0)
              : daySnap.pesoFim;
            finalIsEstimated = false;
            carry = { value: finalStock, isEstimated: false };
          } else {
            finalStock = estTeorico;
            finalIsEstimated = true;
            carry = { value: estTeorico, isEstimated: true };
          }

          // Variação sempre calculada: EST FINAL − EST TEÓRICO.
          // Dias sem lançamento: finalStock = estTeorico → diff = 0 por definição.
          const diff = finalStock - estTeorico;

          return {
            dateLabel: fmtPtDate(day),
            lancCount: dayLancs.length,
            hasConflict,
            lancamentos: dayLancs,
            initialStock,
            initialIsEstimated,
            entEntries: dayEntEntries,
            saiEntries: daySaiEntries,
            ajuEntries: dayAjuEntries,
            totalEnt: dayNat.totalEnt,
            totalSai: dayNat.totalSai,
            totalAju: dayNat.totalAju,
            theoreticalStock: estTeorico,
            finalStock,
            finalIsEstimated,
            hasLanc,
            precisaLanc: true,
            isSemanalNaoConferencia: false,
            diff
          };
        }
      });

      const detailKey = `${idx}-${matIdx}-${String(mat).replace(/[^a-zA-Z0-9_-]+/g, '_')}`;
      window.__analiticoDetailCache.set(detailKey, {
        key: detailKey,
        central,
        material: mat,
        periodLabel: `${fmtPtDate(dtIni)} a ${fmtPtDate(dtFim)}`,
        isSemanal,
        catKey: matCatKey,
        semCadastro: matSemCadastro,
        summary: {
          pesoIni: snapshot.pesoIni,
          dtIniLabel: snapshot.dtIniLabel,
          totalEnt: natureza.totalEnt,
          entLabel: _codsLabel(entEntries, 'Sem entradas no período'),
          totalSai: natureza.totalSai,
          saiLabel: _codsLabel(saiEntries, 'Sem saídas no período'),
          totalAju: natureza.totalAju,
          ajuLabel: _codsLabel(ajuEntries, 'Sem ajustes no período'),
          estTeorico: snapshot.estTeorico,
          pesoFim: snapshot.pesoFim,
          dtFimLabel: snapshot.dtFimLabel,
          fimFallback: fim?.fallback ?? false,
          diff: snapshot.diff,
          absentNearest
        },
        days: dailyRows
      });

      const _matCodSap     = getCodSapPorGrupo(mat);
      const _rowCustoMed   = (rc.custoMedioPorMat           || {})[mat] || 0;
      const _rowCustoFonte = (rc.custoMedioFontePorMat      || {})[mat] || null;
      const _rowMesesAtras = (rc.custoMedioMesesAtrasPorMat || {})[mat] || 0;
      const _rowCustoVar   = _rowCustoMed > 0 ? snapshot.diff * _rowCustoMed : null;
      const _rowVarCls     = _rowCustoVar === null ? '' : varClass(_rowCustoVar);
      // Tooltip: custo médio + fonte (Custos SAP — central+Cód SAP+mês, com
      // cascata pra mês anterior quando o mês pedido não tem registro, ver
      // getCustoMedioCustosSap em normalize.js). Mês de origem derivado
      // aqui a partir de dtFim − mesesAtras (evita carregar mais um mapa
      // "mês encontrado" pela função inteira só pra isso).
      const _custoMedLabel = _rowCustoMed > 0 ? escapeHtml(money(_rowCustoMed) + '/kg') : '—';
      const _custoMedMesAno = `${String(dtFim.getMonth() + 1).padStart(2, '0')}/${dtFim.getFullYear()}`;
      const _custoMedNivel = _rowMesesAtras === 0 ? 'ok' : _rowMesesAtras === 1 ? 'mes_anterior' : 'desatualizado';
      const _custoMedFonte = _rowMesesAtras > 0
        ? (() => {
            const _d = new Date(dtFim.getFullYear(), dtFim.getMonth() - _rowMesesAtras, 1);
            const _mesRef = `${String(_d.getMonth() + 1).padStart(2, '0')}/${_d.getFullYear()}`;
            return `Custos SAP — ${_mesRef} (${_rowMesesAtras === 1 ? 'mês anterior' : 'desatualizado há ' + _rowMesesAtras + ' meses'})`;
          })()
        : `Custos SAP — ${_custoMedMesAno}`;
      const custoVarCell = _rowCustoVar !== null
        ? `<span
            class="td-mono ${_rowVarCls}"
            style="font-size:11.5px;white-space:nowrap;cursor:default;border-bottom:1px dashed currentColor"
            onmouseenter="showCustoMedTip(event,'${_custoMedLabel}','${escapeHtml(_custoMedFonte)}','${_custoMedNivel}')"
            onmousemove="moveCustoMedTip(event)"
            onmouseleave="hideCustoMedTip()"
          >${varSymbol(_rowCustoVar)} ${money(Math.abs(_rowCustoVar))}</span>`
        : _rowCustoFonte === 'sem_codigo'
          ? `<span class="absent-badge" style="background:var(--bg4);color:var(--text3);border-color:var(--border2)" title="Material sem Cód SAP cadastrado — não é possível buscar o custo em Custos SAP">SEM CÓD SAP</span>`
          : `<span class="absent-badge" title="Nenhum custo cadastrado em Custos SAP para ${escapeHtml(central)} / Cód SAP ${escapeHtml(_matCodSap)} / ${_custoMedMesAno}">AUSENTE</span>`;

      // ── Coluna "Dt. Est. Inicial" ────────────────────────────────────────
      // A causa de um AUSENTE aqui mudou junto com a fonte: não é mais "não
      // achei lançamento do operador", e sim "não achei âncora de saldo em
      // Custos SAP" (ou o material não tem Cód SAP cadastrado). Por isso o
      // tooltip de lançamentos próximos (buildAbsentTooltip) saiu DESTA
      // coluna — ele continua valendo na de Est. Final, que segue vindo de
      // lançamento real. Quando há saldo, o tooltip abre a conta: de qual mês
      // veio a âncora e quanto de movimentação SAP foi somado em cima dela.
      const _iniCell = (() => {
        if (matSemCadastro) {
          return `<span class="absent-badge" style="background:var(--bg4);color:var(--text3);border-color:var(--border2)" title="Material sem cadastro — sem Cód SAP para buscar o saldo em Custos SAP">SEM CADASTRO</span>`;
        }
        if (snapshot.pesoIniAusente || !prev) {
          const motivo = _matCodSap
            ? `Nenhum registro em Custos SAP para ${central} / Cód SAP ${_matCodSap} em mês nenhum até o mês anterior ao período`
            : 'Material sem Cód SAP cadastrado — não é possível buscar o saldo em Custos SAP';
          return `<span class="absent-badge" style="cursor:help" title="${escapeHtml(motivo)}">AUSENTE</span>`;
        }
        const atraso = prev.mesesAtras > 0
          ? ` (${prev.mesesAtras} ${prev.mesesAtras === 1 ? 'mês' : 'meses'} atrás)`
          : '';
        const tip = `Saldo teórico do SAP em ${snapshot.dtIniLabel}\n`
                  + `Âncora: Custos SAP ${prev.ancoraLabel}${atraso} = ${fmtKg(prev.ancoraValor)}\n`
                  + `Movimentações SAP desde então: ${prev.delta >= 0 ? '+' : '−'}${fmtKg(Math.abs(prev.delta))}`;
        return `<span style="cursor:help;border-bottom:1px dashed currentColor" title="${escapeHtml(tip)}">${snapshot.dtIniLabel}${
          prev.mesesAtras > 0 ? ` <i class="ti ti-clock-hour-4" style="font-size:9px;color:var(--amber)"></i>` : ''
        }</span>`;
      })();

      capMatsInfo.push({
        central,
        mat,
        // No modo material a coluna da seção de capacidade é a CENTRAL.
        label: isMat ? central : mat,
        estoque: snapshot.pesoFim,
        ausente: !!(snapshot.pesoFimAusente || matSemCadastro)
      });

      // Ajustes de Fechamento desconsiderados (Y11/Y12): antes eram partidos
      // por sinal entre as colunas Entradas e Saídas. Y11/Y12 são AJUSTES por
      // natureza, então agora vão inteiros para a coluna Ajustes — é lá que o
      // analista procura por eles.
      const _matFechExcluidos = (rc.sapFechExcluidosByMat && rc.sapFechExcluidosByMat.get(mat)) || [];

      // Regional da linha — só é usado no modo material (lá a linha é uma
      // central e o filtro de Regional atua sobre as linhas). No modo
      // central o regional já vive no dataset do card.
      const _rowRegional = isMat
        ? ((getFilialLookupIndex().exact.get(normalizeText(central))?.regional || '').trim())
        : '';

      // ── Chaves de ordenação das colunas (data-sort-N) ────────────────────
      // Uma por coluna, na MESMA ordem do <thead>. Guardamos o valor CRU
      // porque a célula renderizada não serve para comparar: ela traz número
      // formatado ("1,2 M kg"), badge de AUSENTE, tooltip e popover de
      // breakdown. Vazio ('') = sem valor → sempre no fim da ordenação,
      // independente da direção (ver sortMicroTable).
      const _sortVals = [
        isMat ? central : mat,                                                    //  0 Central/Material
        matSemCadastro ? '' : (_matCodSap || ''),                                 //  1 Cód SAP
        (matSemCadastro || snapshot.pesoIniAusente || !prev) ? '' : _sortDateKey(snapshot.dtIniLabel), //  2 Dt. Est. Inicial
        (matSemCadastro || snapshot.pesoIniAusente) ? '' : snapshot.pesoIni,      //  3 Est. Inicial
        natureza.totalEnt,                                                        //  4 Entradas
        natureza.totalSai,                                                        //  5 Saídas
        natureza.totalAju,                                                        //  6 Ajustes
        snapshot.pesoFimAusente ? '' : _sortDateKey(snapshot.dtFimLabel),         //  7 Dt. Est. Final
        snapshot.pesoFimAusente ? '' : snapshot.pesoFim,                          //  8 Est. Final
        snapshot.estTeorico,                                                      //  9 Est. Teórico
        snapshot.diff,                                                            // 10 Variação
        _rowCustoVar === null ? '' : _rowCustoVar                                 // 11 Custo Variação
      ].map((v, i) => `data-sort-${i}="${escapeHtml(String(v))}"`).join(' ');

      matRowsHtml += `
        <tr class="material-row${
          (_itensComPendNF.has(item) && _itensComPendOS.has(item)) ? ' pend-injetado-ambos'
          : _itensComPendNF.has(item) ? ' pend-injetado-nf'
          : _itensComPendOS.has(item) ? ' pend-injetado-os'
          : ''
        }" data-detail-key="${detailKey}" data-diff="${snapshot.diff}" data-peso-fim="${snapshot.pesoFim}" data-categoria="${escapeHtml(matCategoria)}" data-central="${escapeHtml(central)}" data-regional="${escapeHtml(_rowRegional)}" data-material="${escapeHtml(mat)}" ${_sortVals} onclick="toggleMaterialDetail(this, event)">
          <td class="td-mono" style="font-weight:600">
            <span class="material-row-title">
              <i class="ti ${MAT_LEVEL_ICON[matLevel]} material-row-crit-icon" style="color:${MAT_LEVEL_COLOR[matLevel]}${(matSemCadastro && !isMat) ? ';cursor:pointer' : ''}"
                title="${(matSemCadastro && !isMat) ? 'Material sem cadastro — clique para cadastrar' : `Criticidade: ${MAT_LEVEL_LABEL[matLevel]}`}"
                ${(matSemCadastro && !isMat) ? `onclick="analiticoCadastrarMaterial('${escapeHtml(mat)}', event)"` : ''}></i>
              ${escapeHtml(isMat ? central : mat)}
            </span>
          </td>
          <td class="td-mono" style="font-size:11px">${matSemCadastro ? '—' : (escapeHtml(_matCodSap) || '—')}</td>
          <td class="td-mono" style="color:var(--text2);font-size:11px">${_iniCell}</td>
          <td class="td-mono" style="color:${(matSemCadastro || snapshot.pesoIniAusente) ? 'var(--text3)' : 'var(--text)'}">${(matSemCadastro || snapshot.pesoIniAusente) ? '—' : fmtKg(snapshot.pesoIni)}</td>
          <td>${buildAnaliticoDetailBreakdown(entEntries, natureza.totalEnt, 'var(--green)', 'Entradas', localEntCount, mat, central, [], localEntTotal)}</td>
          <td>${buildAnaliticoDetailBreakdown(saiEntries, natureza.totalSai, 'var(--red)', 'Saídas', localSaiCount, mat, central, [], localSaiTotal)}</td>
          <td>${buildAnaliticoDetailBreakdown(ajuEntries, natureza.totalAju, movValorCor(natureza.totalAju, 'var(--amber)'), 'Ajustes', null, mat, central, _matFechExcluidos)}</td>
          <td class="td-mono" style="color:var(--text2);font-size:11px">${
            snapshot.pesoFimAusente
              ? `<span class='absent-badge' data-absent-tooltip='${buildAbsentTooltip(absentNearest)}' style='cursor:help'>AUSENTE</span>`
              : (fim?.fallback
                  ? `<span style="color:var(--amber)" title="Lançamento mais recente encontrado no período (não é o último dia)">${snapshot.dtFimLabel} <i class='ti ti-clock-hour-4' style='font-size:9px'></i></span>`
                  : snapshot.dtFimLabel)
          }</td>
          <td class="td-mono" style="color:${snapshot.pesoFimAusente ? 'var(--text3)' : 'var(--text)'}">${snapshot.pesoFimAusente ? '—' : fmtKg(snapshot.pesoFim)}</td>
          <td class="td-mono" style="color:var(--purple)">${fmtKg(snapshot.estTeorico)}</td>
          <td class="td-mono ${dCls}" style="white-space:nowrap">${varSymbol(snapshot.diff)} ${fmtKg(Math.abs(snapshot.diff))}</td>
          <td style="text-align:right">${custoVarCell}</td>
        </tr>`;
    });

          const varCentralMicro = variacaoCentralMicro;
    const varCls = varClass(varCentralMicro);

    // ── Produção badge removido ──────────────────────────────────────────
    const prodBadge = '';

    // ── Health panel (body, only when >= 5 materials) ────────────────────
    let divPanelHtml = '';
    let healthBadge  = '';
    let healthCountsHtml = '';
    const totalMats = allItemsSorted.length;

    // Health score + counts for the header badges
    // Usa getLastPeriodLaunchStockWithFallback — mesma lógica do painel interno
    // e da tabela de materiais, para garantir consistência
    // Usa sapByMat (com pendentes injetados quando ativo) — badge/donut/chips/
    // "Maiores Variações" DEVEM refletir o toggle "Considerar NFs/OS pendentes"
    // (decisão confirmada: somente o breakdown diário — Est. Inicial por dia —
    // deve permanecer imune, não a saúde/donut/ranking).
    // catKey busca SEMPRE no cadastro atual de Materiais — materiais sem
    // cadastro (catKey null) são excluídos do cálculo de saúde por
    // calcHealthScore (contados à parte em counts.sem_cadastro).
    // catKey vem de r.materialCatKeyMap (validado via materialOriginal na
    // filtragem de origem) — allItemsSorted já só contém materiais
    // cadastrados, então este é um lookup seguro, não uma re-derivação.
    //
    // No modo material cada entrada de matDiffs é uma CENTRAL (com o catKey
    // do material do card, que é o mesmo em todas): o donut passa a mostrar
    // criticidade por central, sem mudar uma linha da regra de saúde.
    const matDiffs = allItemsSorted.map(item => {
      const central = centralOf(item);
      const mat     = matOf(item);
      const catKey  = _catKeyOf(resOf(central) || {}, mat);
      const prev = _anGetSapStock({ central, material: mat, dtIni });
      const fim  = _anGetLastPeriodStockFallback({ central, material: mat, dtIni, dtFim });
      const snap = buildSnapshot({
        lancs: lancsByItem.get(item) || [],
        sap:   sapByItem.get(item) || [],
        initialStockOverride:     prev?.value  ?? null,
        initialDateLabelOverride: prev?.dtLabel ?? null,
        finalStockOverride:       fim && !fim.missing ? fim.value : null,
        finalDateLabelOverride:   fim && !fim.missing ? fim.dtLabel : null
      });
      return { mat: item, diff: snap.diff, catKey };
    });
    const healthResult = calcHealthScore(matDiffs, lancsByItem, sapByItem, thresholds);
    // allNeutral considera só materiais COM cadastro — consistente com o
    // escopo de calcHealthScore, que já exclui sem_cadastro do cálculo.
    const _matDiffsComCadastro = matDiffs.filter(m => m.catKey);
    const allNeutral = _matDiffsComCadastro.length > 0 && _matDiffsComCadastro.every(m => Math.abs(m.diff) <= 0.0001);
    const hLevel = (totalMats === 0 || allNeutral) ? 'sem_saude' : healthResult.level;
    const hScore = (totalMats === 0 || allNeutral) ? null        : healthResult.score;
    const hCounts = healthResult.counts || { bom: 0, atencao: 0, urgente: 0, critico: 0, neutro: 0, sem_cadastro: 0 };
    const hLabelMap  = { ok: 'SAUDÁVEL', atencao: 'ATENÇÃO', urgente: 'URGENTE', critico: 'CRÍTICO', sem_saude: 'SEM SAÚDE' };
    const hIconMap   = { ok: 'ti-heartbeat', atencao: 'ti-alert-triangle', urgente: 'ti-alert-circle', critico: 'ti-flame', sem_saude: 'ti-heart-off' };
    const hStyleMap  = {
      ok:        'background:var(--green-bg);color:var(--green);border:1px solid var(--green-border)',
      atencao:   'background:var(--amber-bg);color:var(--amber);border:1px solid var(--amber-border)',
      urgente:   'background:var(--urgente-bg);color:var(--urgente);border:1px solid var(--urgente-border)',
      critico:   'background:var(--red-bg);color:var(--red);border:1px solid var(--red-border)',
      sem_saude: 'background:var(--bg3);color:var(--text3);border:1px solid var(--border2)'
    };

    if (totalMats > 0) {
      healthCountsHtml = `<div class="micro-health-counts">
        <span class="micro-health-count-chip hcc-critico${hCounts.critico === 0 ? ' hcc-zero' : ''}"><i class="ti ti-flame"></i> ${hCounts.critico} crítico</span>
        <span class="micro-health-count-chip hcc-urgente${hCounts.urgente === 0 ? ' hcc-zero' : ''}"><i class="ti ti-alert-circle"></i> ${hCounts.urgente} urgente</span>
        <span class="micro-health-count-chip hcc-atencao${hCounts.atencao === 0 ? ' hcc-zero' : ''}"><i class="ti ti-alert-triangle"></i> ${hCounts.atencao} atenção</span>
        <span class="micro-health-count-chip hcc-bom${hCounts.bom === 0 ? ' hcc-zero' : ''}"><i class="ti ti-circle-check"></i> ${hCounts.bom} bom</span>
        ${_matsSemCadastroCentral.length > 0 ? `<span class="micro-health-count-chip hcc-sem-cadastro" title="Excluídos da análise até serem cadastrados — clique para ver e cadastrar" onclick="analiticoAbrirSemCadastroModal(${idx}, event)"><i class="ti ti-help-circle"></i> ${_matsSemCadastroCentral.length} sem cadastro</span>` : ''}
      </div>`;
    } else {
      healthCountsHtml = `<div class="micro-health-counts">
        <span class="micro-health-count-chip hcc-critico hcc-zero"><i class="ti ti-flame"></i> 0 crítico</span>
        <span class="micro-health-count-chip hcc-urgente hcc-zero"><i class="ti ti-alert-circle"></i> 0 urgente</span>
        <span class="micro-health-count-chip hcc-atencao hcc-zero"><i class="ti ti-alert-triangle"></i> 0 atenção</span>
        <span class="micro-health-count-chip hcc-bom hcc-zero"><i class="ti ti-circle-check"></i> 0 bom</span>
        ${_matsSemCadastroCentral.length > 0 ? `<span class="micro-health-count-chip hcc-sem-cadastro" title="Excluídos da análise até serem cadastrados — clique para ver e cadastrar" onclick="analiticoAbrirSemCadastroModal(${idx}, event)"><i class="ti ti-help-circle"></i> ${_matsSemCadastroCentral.length} sem cadastro</span>` : ''}
      </div>`;
    }

    healthBadge = `<span style="display:inline-flex;align-items:center;gap:5px;${hStyleMap[hLevel]};border-radius:6px;padding:2px 9px;font-family:var(--mono);font-size:10.5px;font-weight:700;white-space:nowrap">
      <i class="ti ${hIconMap[hLevel]}" style="font-size:12px"></i>
      ${hLevel === 'sem_saude' ? 'SEM SAÚDE' : `Saúde: ${hScore}% · ${hLabelMap[hLevel]}`}
    </span>`;

    // ── Painel compacto: donut de saúde + top materiais ────────────────────
    {
      // Top 5 materiais por pior variação (excluindo neutros)
      // Ordena por MAGNITUDE (módulo), não por sinal — sobra grande é tão
      // ruim quanto desfalque grande do mesmo tamanho.
      const topMats = matDiffs
        .filter(m => Math.abs(m.diff) > 0.0001)
        .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
        .slice(0, 5);

      const _maxAbs = topMats.length ? Math.max(...topMats.map(m => Math.abs(m.diff))) : 1;

      const _fmtK = v => {
        const a = Math.abs(v);
        if (a >= 1e6) return (v/1e6).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'M';
        if (a >= 1e3) return (v/1e3).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'K';
        return v.toLocaleString('pt-BR',{maximumFractionDigits:0});
      };

      const topRows = topMats.map(m => {
        const pct = Math.round(Math.abs(m.diff) / _maxAbs * 100);
        const col = m.diff < 0 ? 'var(--red)' : 'var(--amber)';
        const bg  = m.diff < 0 ? 'var(--red-bg)' : 'var(--amber-bg)';
        return `<div class="cpanel-mat-row">
          <span class="cpanel-mat-name">${escapeHtml(m.mat)}</span>
          <div class="cpanel-mat-bar-wrap">
            <div class="cpanel-mat-bar" style="width:${pct}%;background:${col};opacity:0.7"></div>
          </div>
          <span class="cpanel-mat-val" style="color:${col}">${varSymbol(m.diff)} ${_fmtK(Math.abs(m.diff))} kg</span>
        </div>`;
      }).join('');

      // ── Donut de saúde (mesmo estilo visual do donut "Centrais mais
      //    críticas" em macro.js — fatias em path com gap entre elas,
      //    mais o aro fino de score dentro do buraco — adaptado em escala
      //    menor para caber no card. Dados: hCounts/hScore já calculados
      //    acima, sem cálculo novo.) ──
      const _donutColors = { critico: '#f43f5e', urgente: '#f97316', atencao: '#f59e0b', bom: '#10b981' };
      const _donutOrder   = ['critico', 'urgente', 'atencao', 'bom'];
      const _ringTotal    = _donutOrder.reduce((s, k) => s + (hCounts[k] || 0), 0);

      const _R = 44, _RI = 29;       // raio externo / raio interno (limite do buraco) do anel principal
      const _GAP = 0.06;             // espaço (radianos) entre fatias
      let _donutAngle = -Math.PI / 2; // começa no topo, igual ao original

      const donutSlices = _ringTotal === 0 ? '' : _donutOrder.map(lvl => {
        const n = hCounts[lvl] || 0;
        if (!n) return '';
        const pct   = n / _ringTotal;
        const sweep = Math.max(pct * 2 * Math.PI - _GAP, 0.01);
        const col   = _donutColors[lvl];

        const a0 = _donutAngle + _GAP / 2;
        const ae = a0 + sweep;
        const x1 = 46 + _R  * Math.cos(a0), y1 = 46 + _R  * Math.sin(a0);
        const x2 = 46 + _R  * Math.cos(ae), y2 = 46 + _R  * Math.sin(ae);
        const x3 = 46 + _RI * Math.cos(ae), y3 = 46 + _RI * Math.sin(ae);
        const x4 = 46 + _RI * Math.cos(a0), y4 = 46 + _RI * Math.sin(a0);
        const large = sweep > Math.PI ? 1 : 0;

        _donutAngle += pct * 2 * Math.PI;

        return `<path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${_R} ${_R} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${x3.toFixed(2)} ${y3.toFixed(2)} A ${_RI} ${_RI} 0 ${large} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z" fill="${col}"/>`;
      }).join('');

      const donutScoreLabel = hLevel === 'sem_saude' ? '—' : `${hScore}%`;
      const donutScoreColor = hLevel === 'sem_saude' ? 'var(--text3)' : hStyleMap[hLevel].match(/color:([^;]+)/)[1];
      const donutLevelLabel = hLevel === 'sem_saude' ? 'SEM SAÚDE' : hLabelMap[hLevel];

      // Aro fino de score dentro do buraco (fundo cinza + progresso colorido)
      const _SR = _RI - 6, _SCIRC = 2 * Math.PI * _SR;
      const _scorePct  = hLevel === 'sem_saude' ? 0 : (hScore || 0) / 100;
      const _scoreDash = _scorePct * _SCIRC;

      divPanelHtml = `
        <div class="cpanel" data-${isMat ? 'material' : 'central'}="${escapeHtml(cardName)}" data-idx="${idx}">
          <div class="cpanel-health">
            <svg width="128" height="128" viewBox="0 0 92 92" class="cpanel-donut" role="img" aria-label="Saúde ${isMat ? 'do material' : 'da central'}: ${escapeHtml(donutScoreLabel)}, ${escapeHtml(donutLevelLabel)}">
              <circle cx="46" cy="46" r="${(_R + _RI) / 2}" fill="none" stroke="var(--border)" stroke-width="${_R - _RI}" opacity="0.4"/>
              ${donutSlices}
              <circle cx="46" cy="46" r="${_SR}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="3"/>
              <circle cx="46" cy="46" r="${_SR}" fill="none" stroke="${donutScoreColor}" stroke-width="3"
                stroke-dasharray="${_scoreDash.toFixed(1)} ${_SCIRC.toFixed(1)}"
                stroke-dashoffset="${(_SCIRC / 4).toFixed(1)}"
                stroke-linecap="round" opacity="0.6"/>
              <text x="46" y="42" text-anchor="middle" font-size="17" font-weight="700" fill="${donutScoreColor}" font-family="var(--mono)">${escapeHtml(donutScoreLabel)}</text>
              <text x="46" y="52" text-anchor="middle" font-size="7" font-weight="700" fill="${donutScoreColor}" font-family="var(--mono)" letter-spacing="0.06em" opacity="0.85">${escapeHtml(donutLevelLabel)}</text>
            </svg>
          </div>
          <div class="cpanel-health-counts">
            <div class="cpanel-health-count">
              <span class="cpanel-health-count-label" style="color:${_donutColors.critico}">CRÍTICO</span>
              <span class="cpanel-health-count-val" style="color:${_donutColors.critico}"><span class="cpanel-health-count-num">${hCounts.critico || 0}</span> ${(hCounts.critico || 0) === 1 ? _itemSing : _itemPlur}</span>
            </div>
            <div class="cpanel-health-count">
              <span class="cpanel-health-count-label" style="color:${_donutColors.urgente}">URGENTE</span>
              <span class="cpanel-health-count-val" style="color:${_donutColors.urgente}"><span class="cpanel-health-count-num">${hCounts.urgente || 0}</span> ${(hCounts.urgente || 0) === 1 ? _itemSing : _itemPlur}</span>
            </div>
            <div class="cpanel-health-count">
              <span class="cpanel-health-count-label" style="color:${_donutColors.atencao}">ATENÇÃO</span>
              <span class="cpanel-health-count-val" style="color:${_donutColors.atencao}"><span class="cpanel-health-count-num">${hCounts.atencao || 0}</span> ${(hCounts.atencao || 0) === 1 ? _itemSing : _itemPlur}</span>
            </div>
            <div class="cpanel-health-count">
              <span class="cpanel-health-count-label" style="color:${_donutColors.bom}">BOM</span>
              <span class="cpanel-health-count-val" style="color:${_donutColors.bom}"><span class="cpanel-health-count-num">${hCounts.bom || 0}</span> ${(hCounts.bom || 0) === 1 ? _itemSing : _itemPlur}</span>
            </div>
          </div>
          <div class="cpanel-mats">
            <div class="cpanel-mats-title"><i class="ti ti-arrow-narrow-down"></i> MAIORES VARIAÇÕES</div>
            ${topRows || '<span class="cpanel-mats-empty">Sem variações no período</span>'}
          </div>
        </div>`;
    }

    const card = document.createElement('div');
    const _pendCardClass = (_pendState.nf && _pendState.os) ? ' pend-considerado-ambos'
                         : _pendState.nf ? ' pend-considerado-nf'
                         : _pendState.os ? ' pend-considerado-os'
                         : '';
    card.className = 'micro-filial-card' + (isMat ? ' micro-material-card' : '') + _pendCardClass;
    if (isMat) {
      card.dataset.material  = r.material || '';
      card.dataset.categoria = String(getCategoriaPorGrupo(r.material) || '').toUpperCase();
    } else {
      card.dataset.central = r.central || '';
    }
    card.dataset.centralDiff = varCentralMicro;
    card.dataset.diff = varCentralMicro;   // for tipo-var filter
    card.dataset.custoVariacao = custoVariacaoTotal;
    card.dataset.healthLevel = healthBadge ? (hLevel === 'sem_saude' ? 'none' : hLevel) : 'none';
    // Faixas de capacidade presentes no card — alimenta o filtro
    // "Capacidade" da barra (ver _cardPassesCapFilter). Cada item já carrega
    // sua própria central, então a união funciona nos dois modos.
    card.dataset.capFaixas = (typeof capFaixasDaCentral === 'function')
      ? [...new Set(capMatsInfo.flatMap(m => capFaixasDaCentral(m.central, [m])))].join(',')
      : '';
    card.dataset.healthScore = healthBadge && hScore !== null ? hScore : '';
    // ── Badge de custo da variação ──────────────────────────────────────────
    let custoBadge = '';
    if (custoVariacaoTotal !== 0) {
      const hasCustos = isMat
        ? (r.centrais || []).some(c => Object.keys(r.byCentral.get(c)?.custoMedioPorMat || {}).length > 0)
        : Object.keys(r.custoMedioPorMat || {}).length > 0;
      if (hasCustos) {
        const isNeg = custoVariacaoTotal < 0;
        const isPos = custoVariacaoTotal > 0;
        // Segue o padrão de cores de desfalque/sobra:
        // desfalque (custo < 0) → vermelho | sobra (custo > 0) → âmbar
        const custoStyle = isNeg
          ? 'background:var(--red-bg);color:var(--red);border:1px solid var(--red-border)'
          : 'background:var(--amber-bg);color:var(--amber);border:1px solid var(--amber-border)';
        const custoIcon = isNeg ? 'ti-trending-down' : 'ti-trending-up';
        custoBadge = `<span style="display:inline-flex;align-items:center;gap:5px;${custoStyle};border-radius:6px;padding:2px 9px;font-family:var(--mono);font-size:10.5px;font-weight:700;white-space:nowrap">
          <i class="ti ${custoIcon}" style="font-size:12px"></i>
          Custo variação: ${money(Math.abs(custoVariacaoTotal))}
        </span>`;
      }
    }

    card.innerHTML = `
      <div class="micro-filial-header-wrap">
        <div class="micro-filial-header" onclick="toggleMicro(this.closest('.micro-filial-header-wrap'))">
          <div class="micro-filial-name">
            <i class="ti ${isMat ? 'ti-box' : 'ti-building-warehouse'}"></i>
            ${escapeHtml(cardName)}
          </div>
          <div class="micro-filial-summary">
            <span style="display:inline-flex;align-items:center;gap:5px;${varCentralMicro < 0 ? 'background:var(--red-bg);color:var(--red);border:1px solid var(--red-border)' : varCentralMicro > 0 ? 'background:var(--amber-bg);color:var(--amber);border:1px solid var(--amber-border)' : 'background:var(--bg3);color:var(--text3);border:1px solid var(--border)'};border-radius:6px;padding:2px 9px;font-family:var(--mono);font-size:10.5px;font-weight:700;white-space:nowrap">
              ${varIcon(varCentralMicro)} ${varLabel(varCentralMicro)}: ${fmtKg(Math.abs(varCentralMicro))}
            </span>
            ${custoBadge}
            ${prodBadge}
            <span class="summary-sep"></span>
            ${healthCountsHtml}
            ${healthBadge}
            <span id="pend-header-badge-${idx}"></span>
          </div>
        </div>
        <div class="micro-filial-actions">
          ${isMat ? '' : `<button class="trend-btn" onclick="event.stopPropagation();openTrendModal('central','${escapeHtml(r.central)}')" title="Ver tendência de variação">
            <i class="ti ti-chart-line"></i>
          </button>
          <button class="trend-btn" onclick="event.stopPropagation();abrirModalRelatorioCentral('${escapeHtml(r.central)}')" title="Gerar relatório desta central" style="background:linear-gradient(135deg,rgba(29,78,216,0.18),rgba(37,99,235,0.12));border:1px solid rgba(37,99,235,0.3);color:#60a5fa">
            <i class="ti ti-file-analytics"></i>
          </button>`}
          <i class="ti ti-chevron-down micro-filial-chev" style="color:var(--text3);font-size:16px;flex-shrink:0;transition:transform 0.2s;cursor:pointer" id="chev-${idx}" onclick="event.stopPropagation();toggleMicro(this.closest('.micro-filial-header-wrap'))"></i>
        </div>
      </div>

      <div class="micro-filial-body" id="micro-body-${idx}">
        ${divPanelHtml}

        ${typeof buildCapacidadeSection === 'function'
          ? (isMat
              ? buildCapacidadeSection({ pares: capMatsInfo, colLabel: 'Central' })
              : buildCapacidadeSection({ central: r.central, materiais: capMatsInfo }))
          : ''}

        ${isMat
          ? buildPendIntegSectionMaterial({ material: r.material, pendNF: _pendListas.nf, pendOS: _pendListas.os })
          : buildPendIntegSection({ central: r.central, dtIni, dtFim, sapNoPeriodo: r.sapNoPeriodo || [], entradasDaCentral: opts.entradasByCentral ? (opts.entradasByCentral.get(r.central) || []) : undefined })}

        <div class="micro-body-section">
          <div class="micro-section-title"><i class="ti ${isMat ? 'ti-building-warehouse' : 'ti-box'}"></i> Análise por ${itemLabel}</div>
        </div>

        <div class="micro-table-wrap">
          <table>
            <thead>
              <tr>
                <th data-sort-col="0" data-sort-type="text" onclick="sortMicroTable(this,event)">${itemLabel} ${_SORT_ICO}</th>
                <th data-sort-col="1" data-sort-type="text" onclick="sortMicroTable(this,event)">Cód SAP ${_SORT_ICO}</th>
                <th data-sort-col="2" data-sort-type="date" onclick="sortMicroTable(this,event)">Dt. Est. Inicial ${_SORT_ICO}</th>
                <th data-sort-col="3" data-sort-type="num" onclick="sortMicroTable(this,event)">Est. Inicial ${_SORT_ICO}<br><span style="font-size:9px;font-weight:400;opacity:.7">(Saldo SAP)</span></th>
                <th data-sort-col="4" data-sort-type="num" onclick="sortMicroTable(this,event)" title="Compra/recebimento e transferência entre centros (101, 801, 861/862, 301–306) — LÍQUIDO: estornos e transferências para fora entram como negativo e anulam o positivo que os originou">Entradas ${_SORT_ICO}<br><span style="font-size:9px;font-weight:400;opacity:.7">(líq. por código)</span></th>
                <th data-sort-col="5" data-sort-type="num" onclick="sortMicroTable(this,event)" title="Consumo e seu estorno (201, 202)">Saídas ${_SORT_ICO}<br><span style="font-size:9px;font-weight:400;opacity:.7">(por código)</span></th>
                <th data-sort-col="6" data-sort-type="num" onclick="sortMicroTable(this,event)" title="Fechamento mensal (Y11/Y12), sucateamento (551/552), transferência entre materiais/depósitos (309/310, 311/312) e qualquer código não classificado">Ajustes ${_SORT_ICO}<br><span style="font-size:9px;font-weight:400;opacity:.7">(líq. por código)</span></th>
                <th data-sort-col="7" data-sort-type="date" onclick="sortMicroTable(this,event)">Dt. Est. Final ${_SORT_ICO}</th>
                <th data-sort-col="8" data-sort-type="num" onclick="sortMicroTable(this,event)">Est. Final ${_SORT_ICO}<br><span style="font-size:9px;font-weight:400;opacity:.7">(Últ. Lançamento)</span></th>
                <th data-sort-col="9" data-sort-type="num" onclick="sortMicroTable(this,event)">Est. Teórico ${_SORT_ICO}<br><span style="font-size:9px;font-weight:400;opacity:.7">(Ini+Ent+Sai+Aju)</span></th>
                <th data-sort-col="10" data-sort-type="abs" onclick="sortMicroTable(this,event)" title="Ordena pelo valor ABSOLUTO: um desfalque e uma sobra do mesmo tamanho pesam igual">Variação ${_SORT_ICO}<br><span style="font-size:9px;font-weight:400;opacity:.7">(Real − Teórico)</span></th>
                <th data-sort-col="11" data-sort-type="abs" onclick="sortMicroTable(this,event)" style="text-align:right" title="Ordena pelo valor ABSOLUTO: um desfalque e uma sobra do mesmo tamanho pesam igual">Custo Variação ${_SORT_ICO}<br><span style="font-size:9px;font-weight:400;opacity:.7">(Var. × C. Médio)</span></th>
              </tr>
            </thead>
            <tbody>${matRowsHtml || `<tr><td colspan="12"><div class="empty-state" style="padding:24px"><i class="ti ti-box-off"></i><p>Nenhum${isMat ? 'a central' : ' material'} encontrad${isMat ? 'a' : 'o'}.</p></div></td></tr>`}</tbody>
          </table>
        </div>
      </div>`;

    // ── Badge de pendentes SAP no header (preenchido após buildPendIntegSection popular _pendCache) ──
    const _phBadge = card.querySelector(`#pend-header-badge-${idx}`);
    if (_phBadge) {
      // No modo material as contagens já vêm recortadas pelo material
      // (_pendListas); no modo central, do cache da própria central — que
      // buildPendIntegSection acabou de popular no innerHTML acima.
      const _pc  = isMat ? {} : (window._pendCache[r.central] || {});
      const _nfC = isMat ? _pendListas.nf.length : (_pc.pendNF || []).length;
      const _osC = isMat ? _pendListas.os.length : (_pc.pendOS || []).length;
      let _badgeHtml = '';
      _badgeHtml = `<span class="summary-sep"></span>` +
        `<span class="pend-header-pill pend-header-pill-nf${_nfC === 0 ? ' pend-header-pill-zero' : ''}" title="${_nfC === 0 ? 'Nenhuma NF pendente' : `${_nfC} NF${_nfC > 1 ? 's' : ''} pendente${_nfC > 1 ? 's' : ''} de integração SAP`}">
          <i class="ti ti-file-invoice"></i> NF <span class="pend-header-pill-count">${_nfC}</span>
        </span>` +
        `<span class="pend-header-pill pend-header-pill-os${_osC === 0 ? ' pend-header-pill-zero' : ''}" title="${_osC === 0 ? 'Nenhuma OS pendente' : `${_osC} OS pendente${_osC > 1 ? 's' : ''} de integração SAP`}">
          <i class="ti ti-clipboard-list"></i> OS <span class="pend-header-pill-count">${_osC}</span>
        </span>`;
      _phBadge.innerHTML = _badgeHtml;
    }

    // Lookup regional for this central (só no modo central — no modo
    // material o regional vive em cada LINHA, ver _rowRegional).
    if (!isMat) {
      const filialIdx = getFilialLookupIndex();
      const filialRec = filialIdx.exact.get(normalizeText(r.central));
      card.dataset.regional = (filialRec?.regional || '').trim();
    }

    card.querySelectorAll('.micro-table-wrap table').forEach(makeResizable);
    if (typeof initAbsentTooltips === 'function') initAbsentTooltips(card);

  return card;
}

/**
 * Atualiza cirurgicamente o card de UMA central após o toggle de
 * "Considerar/Desconsiderar" NF/OS pendente, sem reconstruir o dashboard
 * inteiro. Atualiza também o cabeçalho agregado do regional ao qual essa
 * central pertence. Não reordena cards nem grupos regionais — decisão
 * deliberada: o toggle é paliativo para a análise, não uma mudança de dado
 * concreta, então a ordem permanece estável até a próxima execução
 * completa de "Rodar Análise" (que recalcula tudo do zero normalmente).
 *
 * Pré-requisito: window.__analiticoResults / __analiticoDtIni / __analiticoDtFim
 * precisam estar populados (preenchidos ao fim de _rodarAnaliticoCore).
 *
 * @param {string} central - nome da central a atualizar
 * @param {object} [opts]
 * @param {boolean} [opts.skipMacro] - não re-renderiza os painéis Macro
 *        (donuts + rankings). Usado pelo "Considerar todas" da Visão
 *        Pendências, que atualiza N centrais em sequência e chama
 *        renderMacroPanels UMA vez no fim — sem isso o donut seria
 *        redesenhado uma vez por central.
 * @returns {boolean} true se conseguiu atualizar cirurgicamente; false se
 *          algum pré-requisito não foi encontrado (o chamador deve então
 *          cair para o render completo como fallback de segurança).
 */
function refreshCentralCard(central, opts = {}) {
  if (!window.__analiticoResults || !window.__analiticoDtIni || !window.__analiticoDtFim) return false;

  const r = window.__analiticoResults.find(item => item.central === central);
  if (!r) return false;

  const oldCard = Array.from(document.querySelectorAll('#an-micro-container .micro-filial-card'))
    .find(c => c.dataset.central === central);
  if (!oldCard) return false;

  const oldCpanel = oldCard.querySelector('.cpanel');
  const idx = oldCpanel ? parseInt(oldCpanel.dataset.idx, 10) : NaN;
  if (isNaN(idx)) return false;

  // O donut de saúde é calculado de forma síncrona, direto de hCounts/hScore
  // (mesmos dados já usados no badge/chips do cabeçalho) — não depende de
  // nenhum cálculo assíncrono, então basta reconstruir o card normalmente.
  const wasOpen = oldCard.querySelector('.micro-filial-body')?.classList.contains('open') || false;

  const newCard = buildCentralCard(r, idx, window.__analiticoDtIni, window.__analiticoDtFim);

  // Restaura o estado aberto/fechado do card (na prática, sempre aberto —
  // o botão de toggle só é alcançável com o card expandido — mas tratamos
  // o caso fechado por robustez)
  if (wasOpen) {
    const newBody = newCard.querySelector('.micro-filial-body');
    const newChev = newCard.querySelector(`#chev-${idx}`);
    if (newBody) newBody.classList.add('open');
    if (newChev) newChev.style.transform = 'rotate(180deg)';
  }

  // Substitui o card antigo pelo novo na MESMA posição do DOM (sem reordenar)
  oldCard.replaceWith(newCard);
  // O card novo traz badges "?" (ex.: faixas de capacidade) que precisam ser
  // religados — o initHelpBadges do fim de rodarAnalitico não roda aqui.
  if (typeof initHelpBadges === 'function') initHelpBadges();

  // Atualiza só o cabeçalho agregado do regional ao qual essa central pertence
  const group = newCard.closest('.regional-group');
  if (group) {
    const summaryEl = group.querySelector('.regional-group-summary');
    const groupCards = Array.from(group.querySelectorAll('.micro-filial-card'));
    if (summaryEl) summaryEl.innerHTML = buildRegionalSummaryHtml(groupCards);

    // Atualiza o highlight de borda do regional (verde/vermelho/azul)
    _applyGroupPendHighlight(group, groupCards);
  }

  // Recalcula window._rankByLevel (e demais dados consumidos pelos relatórios)
  // com o estado atualizado de pendentes considerados — sem isso, os
  // relatórios continuariam exibindo os valores anteriores ao toggle.
  if (!opts.skipMacro && typeof renderMacroPanels === 'function') {
    const th = typeof getHealthThresholds === 'function' ? getHealthThresholds() : {};
    renderMacroPanels(window.__analiticoResults, th, window.__analiticoDtIni, window.__analiticoDtFim);
  }

  return true;
}

/**
 * Equivalente de refreshCentralCard para o agrupamento por MATERIAL: troca
 * cirurgicamente o card de um material após o toggle "Considerar NFs/OS"
 * daquele material (ver togglePendConsideradosMat em ui.js), sem reconstruir
 * a visão inteira nem reordenar os cards.
 *
 * @param {string} material
 * @returns {boolean} false se algum pré-requisito faltar (o chamador cai
 *          para o render completo).
 */
function refreshMaterialCard(material) {
  if (_anGroupMode !== 'material') return false;
  if (!window.__analiticoResults || !window.__analiticoDtIni || !window.__analiticoDtFim) return false;

  const oldCard = Array.from(document.querySelectorAll('#an-micro-container .micro-filial-card'))
    .find(c => c.dataset.material === material);
  if (!oldCard) return false;

  const oldCpanel = oldCard.querySelector('.cpanel');
  const idx = oldCpanel ? parseInt(oldCpanel.dataset.idx, 10) : NaN;
  if (isNaN(idx)) return false;

  const g = _buildMatGroups(window.__analiticoResults).find(x => x.material === material);
  if (!g) return false;

  const wasOpen = oldCard.querySelector('.micro-filial-body')?.classList.contains('open') || false;
  const newCard = buildCentralCard(g, idx, window.__analiticoDtIni, window.__analiticoDtFim, { mode: 'material' });

  if (wasOpen) {
    const newBody = newCard.querySelector('.micro-filial-body');
    const newChev = newCard.querySelector(`#chev-${idx}`);
    if (newBody) newBody.classList.add('open');
    if (newChev) newChev.style.transform = 'rotate(180deg)';
  }

  oldCard.replaceWith(newCard);
  if (typeof initHelpBadges === 'function') initHelpBadges();
  // Reaplica os filtros ativos ao card recém-criado (linhas/visibilidade).
  _applyMicroVisibility();
  return true;
}
window.refreshMaterialCard = refreshMaterialCard;

/**
 * Aplica o highlight de borda do grupo regional a partir do estado de
 * pendentes considerados das centrais que o compõem — mesma semântica do
 * highlight individual do card (verde=NF, vermelho=OS, azul=ambos), mas
 * agregada: se QUALQUER central do regional tem NF ativo, conta como NF; se
 * QUALQUER uma tem OS ativo, conta como OS; se há as duas condições no
 * regional (mesma central ou centrais diferentes), conta como ambos.
 *
 * Aplica tanto a classe (semântica/consistência) quanto a cor diretamente via
 * style inline em .regional-group-header-wrap/.regional-group-body — o
 * inline garante a exibição independente de qualquer regra externa que possa
 * ter prioridade igual ou conflitante na cascata.
 *
 * @param {HTMLElement} group - elemento .regional-group
 * @param {HTMLElement[]} cards - cards .micro-filial-card deste regional
 */
function _applyGroupPendHighlight(group, cards) {
  const pend = window._pendConsiderados || {};
  let hasNF = false, hasOS = false;
  cards.forEach(c => {
    const st = pend[c.dataset.central] || {};
    if (st.nf) hasNF = true;
    if (st.os) hasOS = true;
  });

  group.classList.remove('pend-considerado-nf', 'pend-considerado-os', 'pend-considerado-ambos');

  let borderColor = '', boxShadow = '';
  if (hasNF && hasOS) {
    group.classList.add('pend-considerado-ambos');
    borderColor = 'var(--accent)'; boxShadow = '0 0 0 1px var(--accent-glow)';
  } else if (hasNF) {
    group.classList.add('pend-considerado-nf');
    borderColor = 'var(--green)'; boxShadow = '0 0 0 1px var(--green-border)';
  } else if (hasOS) {
    group.classList.add('pend-considerado-os');
    borderColor = 'var(--red)'; boxShadow = '0 0 0 1px var(--red-border)';
  }

  const headerWrap = group.querySelector('.regional-group-header-wrap');
  const bodyEl      = group.querySelector('.regional-group-body');
  if (headerWrap) { headerWrap.style.borderColor = borderColor; headerWrap.style.boxShadow = boxShadow; }
  if (bodyEl)      { bodyEl.style.borderColor = borderColor; }
}

/**
 * Calcula e monta o HTML do resumo agregado (badges de variacao, custo,
 * saude e pendentes NF/OS) exibido no cabecalho de um grupo regional.
 * Extraida de renderAnaliticoMicro para poder ser chamada tambem em um
 * refresh cirurgico (atualizar so o cabecalho de UM regional, sem
 * reconstruir os cards filhos) -- ver refreshCentralCard em ui.js.
 *
 * @param {HTMLElement[]} cards - cards .micro-filial-card deste regional
 *        (le os valores ja calculados via dataset de cada card)
 * @returns {string} HTML a inserir dentro de .regional-group-summary
 */
function buildRegionalSummaryHtml(cards) {
    // ── Aggregate data from all cards in the group ──────────────────────────
    let totalDiff = 0;
    let totalCusto = 0;
    const agg = { critico: 0, urgente: 0, atencao: 0, bom: 0 };
    const levelPriority = { critico: 4, urgente: 3, atencao: 2, ok: 1, none: 0 };
    let scoreSum = 0, scoreCount = 0;

    let totalPendNF = 0, totalPendOS = 0;
    cards.forEach(c => {
      totalDiff  += parseFloat(c.dataset.centralDiff  || 0);
      totalCusto += parseFloat(c.dataset.custoVariacao || 0);
      const lvl = c.dataset.healthLevel;
      if      (lvl === 'critico') agg.critico++;
      else if (lvl === 'urgente') agg.urgente++;
      else if (lvl === 'atencao') agg.atencao++;
      else if (lvl === 'ok')      agg.bom++;
      const sc = parseFloat(c.dataset.healthScore);
      if (!isNaN(sc)) { scoreSum += sc; scoreCount++; }
      const pc = window._pendCache[c.dataset.central] || {};
      totalPendNF += (pc.pendNF || []).length;
      totalPendOS += (pc.pendOS || []).length;
    });

    // Média de saúde das centrais do regional
    const avgScore = scoreCount > 0 ? Math.round(scoreSum / scoreCount) : null;

    // Dominant health level = worst present
    const domLevel = agg.critico ? 'critico'
                   : agg.urgente ? 'urgente'
                   : agg.atencao ? 'atencao'
                   : agg.bom     ? 'ok'
                   : 'none';

    // ── Variação badge (segue padrão diff-pos/diff-neg: sobra=âmbar, desfalque=vermelho) ──
    const diffCls   = totalDiff < 0 ? 'diff-neg' : totalDiff > 0 ? 'diff-pos' : 'diff-zero';
    const diffIcon  = totalDiff < 0
      ? '<i class="ti ti-trending-down" style="font-size:11px;color:var(--red)"></i>'
      : totalDiff > 0
        ? '<i class="ti ti-trending-up" style="font-size:11px;color:var(--amber)"></i>'
        : '<i class="ti ti-minus" style="font-size:11px;color:var(--text3)"></i>';
    const diffLabel = totalDiff < 0 ? 'Desfalque' : totalDiff > 0 ? 'Sobra' : 'Neutro';
    const diffStyle = totalDiff < 0
      ? 'background:var(--red-bg);color:var(--red);border:1px solid var(--red-border)'
      : totalDiff > 0
        ? 'background:var(--amber-bg);color:var(--amber);border:1px solid var(--amber-border)'
        : 'background:var(--bg3);color:var(--text3);border:1px solid var(--border)';
    const diffBadge = `<span style="display:inline-flex;align-items:center;gap:5px;${diffStyle};border-radius:6px;padding:2px 9px;font-family:var(--mono);font-size:10.5px;font-weight:700;white-space:nowrap">
      ${diffIcon} ${diffLabel}: ${fmtKg(Math.abs(totalDiff))}
    </span>`;

    // ── Custo badge ──────────────────────────────────────────────────────────
    let custoBadgeGrp = '';
    if (totalCusto !== 0) {
      const isNeg = totalCusto < 0;
      // Segue o padrão de cores de desfalque/sobra:
      // desfalque (custo < 0) → vermelho | sobra (custo > 0) → âmbar
      const custoStyle = isNeg
        ? 'background:var(--red-bg);color:var(--red);border:1px solid var(--red-border)'
        : 'background:var(--amber-bg);color:var(--amber);border:1px solid var(--amber-border)';
      const custoIcon = isNeg ? 'ti-trending-down' : 'ti-trending-up';
      custoBadgeGrp = `<span style="display:inline-flex;align-items:center;gap:4px;${custoStyle};border-radius:6px;padding:2px 9px;font-family:var(--mono);font-size:10.5px;font-weight:700;white-space:nowrap">
        <i class="ti ${custoIcon}" style="font-size:11px"></i> Custo variação: ${money(Math.abs(totalCusto))}
      </span>`;
    }

    // ── Health count chips ───────────────────────────────────────────────────
    const aggChips = [
      `<span class="micro-health-count-chip hcc-critico${agg.critico === 0 ? ' hcc-zero' : ''}"><i class="ti ti-flame"></i> ${agg.critico} crítico</span>`,
      `<span class="micro-health-count-chip hcc-urgente${agg.urgente === 0 ? ' hcc-zero' : ''}"><i class="ti ti-alert-circle"></i> ${agg.urgente} urgente</span>`,
      `<span class="micro-health-count-chip hcc-atencao${agg.atencao === 0 ? ' hcc-zero' : ''}"><i class="ti ti-alert-triangle"></i> ${agg.atencao} atenção</span>`,
      `<span class="micro-health-count-chip hcc-bom${agg.bom === 0 ? ' hcc-zero' : ''}"><i class="ti ti-circle-check"></i> ${agg.bom} bom</span>`,
    ].join('');

    // ── Dominant health badge ────────────────────────────────────────────────
    const hStyleMap = {
      ok:      'background:var(--green-bg);color:var(--green);border:1px solid var(--green-border)',
      atencao: 'background:var(--amber-bg);color:var(--amber);border:1px solid var(--amber-border)',
      urgente: 'background:var(--urgente-bg);color:var(--urgente);border:1px solid var(--urgente-border)',
      critico: 'background:var(--red-bg);color:var(--red);border:1px solid var(--red-border)',
      none:    'background:var(--bg3);color:var(--text3);border:1px solid var(--border2)',
    };
    const hIconMap  = { ok: 'ti-heartbeat', atencao: 'ti-alert-triangle', urgente: 'ti-alert-circle', critico: 'ti-flame', none: 'ti-minus' };
    const hLabelMap = { ok: 'SAUDÁVEL', atencao: 'ATENÇÃO', urgente: 'URGENTE', critico: 'CRÍTICO', none: 'SEM DADOS' };
    const healthBadgeGrp = domLevel !== 'none'
      ? `<span style="display:inline-flex;align-items:center;gap:5px;${hStyleMap[domLevel]};border-radius:6px;padding:2px 9px;font-family:var(--mono);font-size:10.5px;font-weight:700;white-space:nowrap" title="Média da saúde das centrais deste regional">
          <i class="ti ${hIconMap[domLevel]}" style="font-size:12px"></i> Saúde: ${avgScore !== null ? avgScore + '%' : '—'} · ${hLabelMap[domLevel]}
        </span>`
      : '';

  return `
    ${diffBadge}
    ${custoBadgeGrp}
    <span class="summary-sep"></span>
    <span class="regional-group-chips">${aggChips}</span>
    ${healthBadgeGrp}
    <span class="summary-sep"></span>
    <span class="pend-header-pill pend-header-pill-nf${totalPendNF === 0 ? ' pend-header-pill-zero' : ''}" title="${totalPendNF === 0 ? 'Nenhuma NF pendente neste regional' : `${totalPendNF} NF${totalPendNF > 1 ? 's' : ''} pendente${totalPendNF > 1 ? 's' : ''} de integração SAP neste regional`}"><i class="ti ti-file-invoice"></i> NF <span class="pend-header-pill-count">${totalPendNF}</span></span>
    <span class="pend-header-pill pend-header-pill-os${totalPendOS === 0 ? ' pend-header-pill-zero' : ''}" title="${totalPendOS === 0 ? 'Nenhuma OS pendente neste regional' : `${totalPendOS} OS pendente${totalPendOS > 1 ? 's' : ''} de integração SAP neste regional`}"><i class="ti ti-clipboard-list"></i> OS <span class="pend-header-pill-count">${totalPendOS}</span></span>
  `;
}

/**
 * Transpõe os resultados por central em grupos por material — a estrutura
 * que buildCentralCard consome no modo 'material'.
 *
 * Não recalcula nada: cada grupo só guarda quais centrais têm aquele
 * material e uma referência ao resultado original de cada uma (de onde o
 * card puxa lançamentos, SAP, custo médio e catKey daquele par).
 *
 * @returns {{material:string, centrais:string[], byCentral:Map}[]}
 */
function _buildMatGroups(results) {
  const map = new Map();
  results.forEach(r => {
    (r.allMats || []).forEach(mat => {
      let g = map.get(mat);
      if (!g) { g = { material: mat, centrais: [], byCentral: new Map() }; map.set(mat, g); }
      if (!g.byCentral.has(r.central)) { g.centrais.push(r.central); g.byCentral.set(r.central, r); }
    });
  });
  return [...map.values()];
}

/** Variação total (kg) de um material somando todas as suas centrais —
 *  usada só para ordenar os cards (pior desfalque primeiro), espelhando
 *  calcVariacaoCentral do agrupamento por regional. */
function _matGroupDiff(g, dtIni) {
  return g.centrais.reduce((acc, central) => {
    const rc = g.byCentral.get(central) || {};
    const lancs = (rc.lancsNoPeriodo || []).filter(x => (x.material || '—') === g.material);
    const sap   = (rc.sapNoPeriodo   || []).filter(x => (x.material || '—') === g.material);
    const prev  = _anGetSapStock({ central, material: g.material, dtIni });
    return acc + buildSnapshot({ lancs, sap, initialStockOverride: prev?.value ?? null }).diff;
  }, 0);
}

// silent (opcional): ver _rodarAnaliticoCore acima — quando true, não
// fecha o overlay/steps de loading ao final (quem chamou está no controle).
// Outros chamadores (ex.: re-render em ui.js) não passam esse parâmetro e
// mantêm o comportamento original.
//
// opts.skipMacro (opcional): não redesenha os painéis da Visão Macro. Usado
// pelos re-renders que NÃO mudam dado nenhum (troca do agrupamento da Micro,
// toggle de pendentes no escopo material) — a Macro é sempre por central ×
// material e tem filtros próprios, então redesenhá-la ali só zeraria esses
// filtros e reanimaria os donuts à toa.
function renderAnaliticoMicro(results, dtIni, dtFim, silent, opts = {}) {
  const container = document.getElementById('an-micro-container');
  if (!container) return;
  container.innerHTML = '';
  window.__analiticoDetailCache = new Map();
  // Cache de materiais sem cadastro por central (chave: idx da central),
  // alimenta o modal aberto pelo chip "sem cadastro" do painel de saúde.
  window.__analiticoSemCadastroCache = new Map();


  // Ordena centrais: maior desfalque (variação mais negativa) → maior sobra (mais positiva)
  const calcVariacaoCentral = (r) => {
    const lancsByMat = new Map();
    const sapByMat = new Map();
    (r.lancsNoPeriodo || []).forEach(rec => {
      const mat = rec.material || '—';
      if (!lancsByMat.has(mat)) lancsByMat.set(mat, []);
      lancsByMat.get(mat).push(rec);
    });
    (r.sapNoPeriodo || []).forEach(rec => {
      const mat = rec.material || '—';
      if (!sapByMat.has(mat)) sapByMat.set(mat, []);
      sapByMat.get(mat).push(rec);
    });
    return [...(r.allMats || [])].reduce((acc, mat) => {
      const lm = lancsByMat.get(mat) || [];
      const sm = sapByMat.get(mat)   || [];
      const prev = _anGetSapStock({ central: r.central, material: mat, dtIni });
      return acc + buildSnapshot({
        lancs: lm,
        sap:   sm,
        initialStockOverride: prev?.value ?? null,
      }).diff;
    }, 0);
  };

      const variacaoCentralCache = new Map();
  const getVariacaoCentral = (item) => {
    if (variacaoCentralCache.has(item)) return variacaoCentralCache.get(item);
    const value = calcVariacaoCentral(item);
    variacaoCentralCache.set(item, value);
    return value;
  };

  results = [...results]
    .map(item => ({ item, score: getVariacaoCentral(item) }))
    .sort((a, b) => a.score - b.score)
    .map(entry => entry.item);

  const _cardBuffer = []; // collects cards before grouping

  // Pré-agrupa Entradas por central (mesma chave usada em
  // calcPendentesIntegracao: centralCompra com fallback para
  // centralDestino) — evita que cada card refaça uma varredura completa de
  // state.entradas (ver buildPendIntegSection/calcPendentesIntegracao em
  // ui.js). Construído do zero a cada render, direto do state atual — não
  // é um cache persistente entre renders, então não há risco de ficar
  // desatualizado entre um "Analisar" e outro.
  const _entradasByCentralMicro = new Map();
  (state.entradas || []).forEach(e => {
    const c = e.centralCompra || e.centralDestino || '';
    if (!_entradasByCentralMicro.has(c)) _entradasByCentralMicro.set(c, []);
    _entradasByCentralMicro.get(c).push(e);
  });

  // Segundo agrupamento, SÓ para a comparação SAP × página no rodapé do
  // modal de Movimentações (ver localEntTotal/localEntCount em
  // buildCentralCard) — prioridade INVERSA da acima (centralDestino
  // primeiro, fallback centralCompra), a pedido do Hugo (06/08). Não dá
  // pra reaproveitar _entradasByCentralMicro porque aquele índice também
  // alimenta buildPendIntegSection/NFs Pendentes, que continua usando a
  // prioridade original.
  const _entradasByCentralMicroDestino = new Map();
  (state.entradas || []).forEach(e => {
    const c = e.centralDestino || e.centralCompra || '';
    if (!_entradasByCentralMicroDestino.has(c)) _entradasByCentralMicroDestino.set(c, []);
    _entradasByCentralMicroDestino.get(c).push(e);
  });

  if (_anGroupMode === 'material') {
    // ═══ AGRUPAMENTO POR MATERIAL ═══════════════════════════════════════
    // Um card por material, sem regional nem central acima — as centrais
    // viram as LINHAS da tabela de cada card (ver buildCentralCard).
    //
    // Pré-passada de pendências: no agrupamento por regional quem popula
    // window._pendCache é o próprio buildPendIntegSection, card a card
    // (card = central). Aqui o card é um material e precisa recortar as
    // pendências de VÁRIAS centrais, então elas têm que estar prontas
    // antes. É a mesma conta, feita uma vez por central — não é trabalho a
    // mais, só antecipado.
    results.forEach(r => {
      window._pendCache[r.central] = calcPendentesIntegracao({
        central: r.central, dtIni, dtFim,
        sapNoPeriodo: r.sapNoPeriodo || [],
        entradasDaCentral: _entradasByCentralMicro.get(r.central) || []
      });
    });

    const grupos = _buildMatGroups(results);
    // Mesma regra de ordenação das centrais: maior desfalque primeiro.
    const _gScore = new Map();
    grupos.forEach(g => _gScore.set(g, _matGroupDiff(g, dtIni)));
    grupos.sort((a, b) => _gScore.get(a) - _gScore.get(b));

    grupos.forEach((g, idx) => {
      const card = buildCentralCard(g, idx, dtIni, dtFim, {
        mode: 'material',
        entradasByCentral: _entradasByCentralMicro,
        entradasByCentralDestino: _entradasByCentralMicroDestino
      });
      _cardBuffer.push(card);
      container.appendChild(card);
    });

    // ponytail: window._anResumoCentraisData (widget "Saúde geral" da
    // topbar) NÃO é recalculado aqui — ele é por central e este render não
    // monta cards de central. Continua valendo o da última análise
    // agrupada por regional. Teto aceito: é indicador de topo, não muda
    // nenhuma decisão dentro da visão. Upgrade = extrair o cálculo de saúde
    // por central de buildCentralCard e alimentá-lo nos dois modos.
  } else {

  results.forEach((r, idx) => {
    _cardBuffer.push(buildCentralCard(r, idx, dtIni, dtFim, { entradasByCentral: _entradasByCentralMicro, entradasByCentralDestino: _entradasByCentralMicroDestino }));
  });

  // ── Group cards by regional ──────────────────────────────────────────────
  // Preserve the sorted order within each group (by worst variação first)
  const groupOrder = [];
  const groupMap   = new Map(); // regional → { cards: [], hCounts: aggregate }

  _cardBuffer.forEach(card => {
    const reg = card.dataset.regional || '';
    if (!groupMap.has(reg)) {
      groupOrder.push(reg);
      groupMap.set(reg, []);
    }
    groupMap.get(reg).push(card);
  });

  // Sort groups: maior desfalque (diff mais negativo) primeiro → maior sobra por último; sem regional sempre no fim
  const groupDiff = new Map();
  groupOrder.forEach(reg => {
    const diff = groupMap.get(reg).reduce((s, c) => s + parseFloat(c.dataset.centralDiff || 0), 0);
    groupDiff.set(reg, diff);
  });
  groupOrder.sort((a, b) => {
    if (!a && b)  return 1;   // sem regional sempre no fim
    if (a && !b)  return -1;
    return groupDiff.get(a) - groupDiff.get(b); // mais negativo (desfalque) primeiro
  });
  groupOrder.forEach(regional => {
    const cards = groupMap.get(regional);


    const isSemRegional = !regional;
    const group = document.createElement('div');
    group.className = 'regional-group' + (isSemRegional ? ' sem-regional' : '');
    group.dataset.regional = regional;
    group.innerHTML = `
      <div class="regional-group-header-wrap">
        <div class="regional-group-header" onclick="toggleRegional(this.closest('.regional-group'))">
          <div class="regional-group-icon">
            ${!isSemRegional ? `<span class="regional-group-icon-count">${cards.length}</span>` : ''}
            <i class="ti ${isSemRegional ? 'ti-map-pin-off' : 'ti-users-group'}"></i>
          </div>
          <span class="regional-group-name">${isSemRegional ? 'Sem regional' : escapeHtml(regional)}</span>
          <div class="regional-group-summary">${buildRegionalSummaryHtml(cards)}</div>
        </div>
        <div class="regional-group-actions">
          <button class="trend-btn" onclick="event.stopPropagation();openTrendModal('regional','${escapeHtml(regional || '')}')" title="Ver tendência de variação">
            <i class="ti ti-chart-line"></i>
          </button>
          ${!isSemRegional ? `<button class="trend-btn" onclick="event.stopPropagation();abrirModalRelatorioRegional('${escapeHtml(regional || '')}')" title="Gerar relatório deste regional" style="background:linear-gradient(135deg,rgba(29,78,216,0.18),rgba(37,99,235,0.12));border:1px solid rgba(37,99,235,0.3);color:#60a5fa">
            <i class="ti ti-file-analytics"></i>
          </button>` : ''}
          <i class="ti ti-chevron-down regional-group-chev" id="rchev-${encodeURIComponent(regional || '_sem')}" onclick="event.stopPropagation();toggleRegional(this.closest('.regional-group'))" style="cursor:pointer"></i>
        </div>
      </div>
      <div class="regional-group-body open"></div>`;

    // Highlight de pendentes considerados — depois do innerHTML, pois depende
    // de querySelector encontrar .regional-group-header-wrap/.regional-group-body
    _applyGroupPendHighlight(group, cards);

    const body = group.querySelector('.regional-group-body');
    cards.forEach(c => body.appendChild(c));
    container.appendChild(group);
  });

  // ─── RESUMO POR CENTRAL (dados do card) ─────────────────────────────
  window._anResumoCentraisData = _cardBuffer.map(card => ({
    central:      card.dataset.central     || '—',
    regional:     card.dataset.regional    || '—',
    variacaoKg:   card.dataset.centralDiff || '0',
    custoVar:     card.dataset.custoVariacao || '0',
    saude:        card.dataset.healthScore != null && card.dataset.healthScore !== ''
                    ? card.dataset.healthScore + '% · ' + (card.dataset.healthLevel || '—').toUpperCase()
                    : '—',
    healthLevel:  card.dataset.healthLevel || 'none',
    healthScore:  card.dataset.healthScore || ''
  }));

  }  // fim do agrupamento por regional


  // Populate filter dropdowns with available centrais e materiais
  populateMicroFilterOptions(results);
  // Reset applied filters whenever a new analysis runs
  if (typeof _lstepSet === 'function') { _lstepSet('an-calc', 'done'); _lstepSet('an-saude', 'running'); _lbarSet(65); }

  clearAllMicroFilters();
  if (typeof initHelpBadges === 'function') initHelpBadges();

  // Renderiza painéis Macro (crank + donut) — macro.js. Ver opts.skipMacro
  // no cabeçalho: re-renders que não mudam dado não podem mexer neles.
  if (!opts.skipMacro && typeof renderMacroPanels === 'function') {
    const th = typeof getHealthThresholds === 'function' ? getHealthThresholds() : {};
    renderMacroPanels(results, th, dtIni, dtFim);
  }

  if (typeof _lstepSet === 'function') { _lstepSet('an-saude', 'done'); _lstepSet('an-render', 'running'); _lbarSet(85); }

  // Sincroniza o mês selecionado do Inventário com o mês da data INICIAL do
  // período recém-analisado (mesmo se o usuário não estiver na aba
  // Inventário agora — assim, ao entrar nela depois, já está no mês certo).
  // Se o usuário trocar o mês manualmente no seletor do Inventário depois
  // disso, essa escolha prevalece até o próximo "Analisar".
  //
  // Decisão (Hugo, jul/2026): o Inventário NÃO é mais recalculado
  // automaticamente aqui — só o mês pré-selecionado é sincronizado (custo
  // desprezível, é só um valor de UI). invGerar() (o cálculo pesado de
  // fechamento) só roda quando o usuário clica no botão "Atualizar" do
  // próprio Inventário — ou, ao entrar na aba pela primeira vez na sessão,
  // via anSwitchView (ver comentário lá, mantido de propósito: é uma ação
  // do usuário, não um efeito colateral do "Analisar"). É um módulo que o
  // analista não olha todo dia; não fazia sentido recalculá-lo em toda
  // análise — inclusive na pré-carga silenciosa do boot.
  if (typeof window.invSyncMonthFromPeriod === 'function') {
    window.invSyncMonthFromPeriod(dtIni);
  }

  // Visão Pendências. O contador da aba é atualizado SEMPRE: ele conta só
  // OS+NF, que já estão prontas em _pendCache (populado logo acima, por
  // buildPendIntegSection em cada card) — custo desprezível.
  // A visão inteira, essa sim, só é re-renderizada se a aba estiver ABERTA
  // agora: o levantamento de dias sem lançamento é pesado e não deve rodar em
  // toda análise para uma aba que ninguém está olhando. Fechada, ela se monta
  // sozinha na próxima vez que o usuário entrar (ver anSwitchView).
  const _panePend = document.getElementById('an-view-pane-pendencias');
  if (_panePend && _panePend.style.display !== 'none' && typeof renderPendenciasView === 'function') {
    renderPendenciasView();
  } else if (typeof pendAtualizarContadorAba === 'function') {
    pendAtualizarContadorAba();
  }
  if (typeof _lstepSet === 'function') { _lstepSet('an-render', 'done'); }
  if (typeof _lbarSet === 'function') { _lbarSet(100); }

  if (!silent) {
    if (typeof hideLoadingOverlay === 'function') hideLoadingOverlay('Análise concluída');
    if (typeof loadingHideSteps === 'function') loadingHideSteps();
  }
  updateClock();

  // Ao analisar: recolhe regionais e centrais por padrão
  _regionaisExpanded = false;
  _centraisExpanded  = false;

  document.querySelectorAll('#an-micro-container .regional-group').forEach(group => {
    const body = group.querySelector('.regional-group-body');
    const chev = group.querySelector('.regional-group-chev');
    if (body) body.classList.remove('open');
    group.classList.add('collapsed');
    if (chev) chev.style.transform = 'rotate(-90deg)';
  });

  // Centrais já renderizam sem a classe 'open' por padrão — garante que estão fechadas
  document.querySelectorAll('#an-micro-container .micro-filial-card').forEach(card => {
    const body = card.querySelector('.micro-filial-body');
    const chev = card.querySelector('[id^="chev-"]');
    if (body) body.classList.remove('open');
    if (chev) chev.style.transform = '';
  });

  // Atualiza visual dos botões
  _updateToggleRegionaisBtn();
  _updateToggleCentralisBtn();

  // Fixa a altura mínima do container no estado sem filtro (nova análise
  // = reset legítimo, já que o conjunto de dados mudou por completo)
  _updateMicroContainerHeightLock(true);
}  // end _rodarAnaliticoCore

// Abre modal listando os materiais sem cadastro de uma central específica
// (chip "sem cadastro" do painel de saúde). Reaproveita o padrão visual
// alert-modal-* já usado em Conflitos/Inventário/Pendências de padronização.
function analiticoAbrirSemCadastroModal(idx, event) {
  if (event) event.stopPropagation();
  document.getElementById('alert-modal-an-sem-cad')?.remove();
  const entry = window.__analiticoSemCadastroCache?.get(idx);
  if (!entry || !entry.materiais.length) return;

  const rows = entry.materiais.map(m => `
    <div class="dup-cad-row">
      <span class="dup-cad-alias" title="${escapeHtml(m)}">${escapeHtml(m)}</span>
      <button class="btn-icon" type="button" title="Cadastrar agora" onclick="analiticoCadastrarMaterial('${escapeHtml(m)}', event)">
        <i class="ti ti-plus"></i>
      </button>
    </div>`).join('');

  const overlay = document.createElement('div');
  overlay.id = 'alert-modal-an-sem-cad';
  overlay.className = 'alert-modal-overlay';
  const _escAnSemCad = (e) => {
    if (!document.body.contains(overlay)) { document.removeEventListener('keydown', _escAnSemCad); return; }
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', _escAnSemCad); }
  };
  document.addEventListener('keydown', _escAnSemCad);
  overlay.innerHTML = `
    <div class="alert-modal-card">
      <div class="alert-modal-header">
        <div>
          <div class="alert-modal-title is-amber"><i class="ti ti-help-circle"></i> Materiais sem cadastro — ${escapeHtml(entry.central)}</div>
          <div class="alert-modal-sub">${entry.materiais.length} ${entry.materiais.length === 1 ? 'material' : 'materiais'} excluíd${entry.materiais.length === 1 ? 'o' : 'os'} da análise desta central (não contam em nenhuma soma/gráfico/indicador) até serem cadastrados</div>
        </div>
        <button class="alert-modal-close" onclick="document.getElementById('alert-modal-an-sem-cad').remove()"><i class="ti ti-x"></i></button>
      </div>
      <div class="alert-modal-body"><div class="dup-cad-group">${rows}</div></div>
    </div>`;
  document.body.appendChild(overlay);
}
window.analiticoAbrirSemCadastroModal = analiticoAbrirSemCadastroModal;

// Abre o modal de cadastro de Materiais já pré-preenchido com o nome,
// acionado pelo selo "sem cadastro" na linha do material (Visão Micro).
// Mesmo padrão de _invCadastrarMaterial (inventario.js) / _pendPadronizacaoAbrirCadastro
// (dashboard.js) para material não cadastrado.
function analiticoCadastrarMaterial(nome, event) {
  if (event) event.stopPropagation(); // não abre/fecha o detalhe da linha
  // Fecha qualquer modal de alerta "sem cadastro" aberto — esta função é
  // reutilizada por vários painéis (Analítico, Dashboard Gerencial, Custos,
  // Entradas/Saídas/Lançamentos/SAP), cada um com seu próprio id de modal.
  document.querySelectorAll('.alert-modal-overlay').forEach(el => el.remove());
  abrirCadastroMaterialIndividual({ origem: nome, focus: 'alias' });
}
window.analiticoCadastrarMaterial = analiticoCadastrarMaterial;


function toggleMaterialDetail(row, event) {
  if (event && (
    event.target.closest('.breakdown-trigger') ||
    event.target.closest('.breakdown-popover') ||
    event.target.closest('button, a, input, select, label')
  )) {
    return;
  }

  const key = row?.dataset?.detailKey;
  if (!key) return;
  openAnaliticoDetailModal(key);
}


function toggleMicro(wrap) {
  // wrap = .micro-filial-header-wrap
  const body = wrap.nextElementSibling;
  const chev = wrap.querySelector('[id^="chev-"]');
  if (!body) return;
  const open = body.classList.toggle('open');
  wrap.classList.toggle('open', open);
  if (chev) chev.style.transform = open ? 'rotate(180deg)' : '';
  _updateCentralFocus(wrap.closest('.regional-group'));
}

function toggleRegional(group) {
  const body  = group.querySelector('.regional-group-body');
  const chev  = group.querySelector('.regional-group-chev');
  if (!body) return;
  const open = body.classList.toggle('open');
  group.classList.toggle('collapsed', !open);
  if (chev) chev.style.transform = open ? '' : 'rotate(-90deg)';
  _updateRegionalFocus();
}

/**
 * Focus mode — regionais: quando 1+ regional está expandido, os demais
 * regionais recolhidos recebem opacidade reduzida (dimmed), dando foco
 * visual aos expandidos. Cumulativo: múltiplos expandidos ficam todos em
 * destaque. O dimming só é removido quando nenhum regional está expandido.
 */
function _updateRegionalFocus() {
  const groups = document.querySelectorAll('#an-micro-container .regional-group');
  const anyOpen = Array.from(groups).some(g => g.querySelector('.regional-group-body')?.classList.contains('open'));
  groups.forEach(g => {
    const isOpen = g.querySelector('.regional-group-body')?.classList.contains('open');
    g.classList.toggle('regional-dimmed', anyOpen && !isOpen);
  });
}

/**
 * Focus mode — centrais: dentro de um regional, quando 1+ card de central
 * está expandido, os demais cards de central irmãos (mesmo regional)
 * recebem opacidade reduzida. Escopo limitado ao regional em questão.
 */
function _updateCentralFocus(group) {
  // Sem grupo (agrupamento por material): o escopo é o container inteiro,
  // que ali já é a lista plana de cards.
  const scope = group || document.getElementById('an-micro-container');
  if (!scope) return;
  const cards = scope.querySelectorAll('.micro-filial-card');
  const anyOpen = Array.from(cards).some(c => c.querySelector('.micro-filial-body')?.classList.contains('open'));
  cards.forEach(c => {
    const isOpen = c.querySelector('.micro-filial-body')?.classList.contains('open');
    c.classList.toggle('central-dimmed', anyOpen && !isOpen);
  });
}

function limparAnalitico() {
  document.getElementById('an-dt-ini').value = '';
  document.getElementById('an-dt-fim').value = '';
  document.getElementById('an-empty').style.display = '';
  document.getElementById('an-content').style.display = 'none';
  if (window.updatePeriodFab) updatePeriodFab();
}

// ═══════════════════════════════════════════════════════════
// MICRO FILTER BAR
// ═══════════════════════════════════════════════════════════
const _microFilter = {
  // Pending selections (while dropdown is open)
  pending: { central: new Set(), material: new Set(), regional: new Set(), categoria: new Set() },
  // Applied selections
  applied: { central: new Set(), material: new Set(), regional: new Set(), categoria: new Set() },
  // All available options extracted from last renderAnaliticoMicro call
  options: { central: [], material: [], regional: [], categoria: [] },
  // variação data keyed by "central|||material" for row-level filtering
  variacaoData: new Map()
};

// Guarda o último "results" completo (sem filtro), usado apenas para saber
// se há dados (mostrar/ocultar a barra de filtros).
let _microFilterResults = [];

function _microFilterBar() { return document.getElementById('micro-filter-bar'); }

// Recalcula as opções de UMA chave (regional/central/categoria/material)
// direto do DOM já renderizado (#an-micro-container), aplicando a MESMA
// combinação de filtros que _applyMicroVisibility usa para mostrar/ocultar
// linhas — ou seja, considera TODOS os filtros já aplicados: os outros 3
// dropdowns de dimensão E também Saúde (variação) e Tipo de Variação
// (desfalque/sobra). A chave da própria coluna sendo aberta é ignorada
// (senão marcar um valor faria os demais valores da mesma coluna sumirem
// do próprio dropdown). Se um material/central/regional não sobra em pé
// depois de aplicar todos os outros filtros, ele não aparece como opção.
function _microRecomputeOptions(key) {
  const appliedRegionals  = key === 'regional'  ? new Set() : _microFilter.applied.regional;
  const appliedCentrals   = key === 'central'   ? new Set() : _microFilter.applied.central;
  const appliedCategorias = key === 'categoria' ? new Set() : _microFilter.applied.categoria;
  const appliedMaterials  = key === 'material'  ? new Set() : _microFilter.applied.material;
  const varState   = _varFilter.applied;
  const varActive  = _varFilterIsActive(varState);
  const tipoActive = _tipoVarIsActive();
  const tipoFilter = _tipoVarFilter.applied;
  const tipoNivel  = _tipoVarFilter.nivelApplied;

  const passesTipo = (diff, level) => {
    if (!tipoActive) return true;
    if (!tipoNivel.has(level)) return true;
    const isDesfalque = diff < 0;
    const isSobra     = diff > 0;
    if (tipoFilter.has('desfalque') && tipoFilter.has('sobra')) return true;
    if (tipoFilter.has('desfalque')) return isDesfalque;
    if (tipoFilter.has('sobra'))     return isSobra;
    return true;
  };

  const regionais  = new Set();
  const centrais   = new Set();
  const categorias = new Set();
  const materiais  = new Set();

  // ── Agrupamento por MATERIAL ──────────────────────────────────────────
  // Mesma varredura, um nível a menos (não há grupo de regional) e com os
  // papéis invertidos: o CARD é o material (filtros Material/Categoria/
  // Saúde) e a LINHA é a central (filtros Central/Regional).
  if (_anGroupMode === 'material') {
    document.querySelectorAll('#an-micro-container .micro-filial-card').forEach(card => {
      const matName = card.dataset.material || '';
      const matCat  = (card.dataset.categoria || '').trim().toUpperCase();
      if (appliedMaterials.size  && !appliedMaterials.has(matName)) return;
      if (appliedCategorias.size && !appliedCategorias.has(matCat))  return;
      if (varActive && !varState.levels.has(card.dataset.healthLevel || 'none')) return;
      if (tipoActive && !passesTipo(parseFloat(card.dataset.diff || '0'), 'material')) return;

      let anyRowMatches = false;
      card.querySelectorAll('tbody tr.material-row').forEach(row => {
        const centralName  = row.dataset.central  || '';
        const regionalName = row.dataset.regional || '';
        if (appliedCentrals.size  && !appliedCentrals.has(centralName))   return;
        if (appliedRegionals.size && !appliedRegionals.has(regionalName)) return;
        if (!passesTipo(parseFloat(row.dataset.diff || '0'), 'central'))  return;
        if (centralName)  centrais.add(centralName);
        if (regionalName) regionais.add(regionalName);
        anyRowMatches = true;
      });
      if (!anyRowMatches) return;
      if (matName) materiais.add(matName);
      if (matCat)  categorias.add(matCat);
    });
    _microFilter.options[key] = [...({ regional: regionais, central: centrais, categoria: categorias, material: materiais }[key])].sort();
    return;
  }

  document.querySelectorAll('#an-micro-container .regional-group').forEach(group => {
    const groupRegional = group.dataset.regional || '';
    if (appliedRegionals.size && !appliedRegionals.has(groupRegional)) return;
    if (tipoActive) {
      const groupDiff = parseFloat(group.dataset.diff || '0');
      if (!passesTipo(groupDiff, 'regional')) return;
    }

    let anyCardMatches = false;
    group.querySelectorAll('.micro-filial-card').forEach(card => {
      const header = card.querySelector('.micro-filial-name');
      const centralName = header ? header.textContent.trim() : '';
      if (appliedCentrals.size && !appliedCentrals.has(centralName)) return;
      if (varActive) {
        const cardLevel = card.dataset.healthLevel || 'none';
        if (!varState.levels.has(cardLevel)) return;
      }
      if (!_cardPassesCapFilter(card, _capFilter.applied)) return;
      if (tipoActive) {
        const cardDiff = parseFloat(card.dataset.diff || '0');
        if (!passesTipo(cardDiff, 'central')) return;
      }

      let anyRowMatches = false;
      card.querySelectorAll('tbody tr.material-row').forEach(row => {
        const matCell = row.querySelector('td:first-child');
        const matName = matCell ? matCell.textContent.trim() : '';
        const matDiff = parseFloat(row.dataset.diff || '0');
        const matCat  = (row.dataset.categoria || '').trim().toUpperCase();
        if (appliedMaterials.size  && !appliedMaterials.has(matName)) return;
        if (appliedCategorias.size && !appliedCategorias.has(matCat)) return;
        if (!passesTipo(matDiff, 'material')) return;
        if (matName) materiais.add(matName);
        if (matCat)  categorias.add(matCat);
        anyRowMatches = true;
      });
      if (!anyRowMatches) return;
      if (centralName) centrais.add(centralName);
      anyCardMatches = true;
    });
    if (!anyCardMatches) return;
    if (groupRegional) regionais.add(groupRegional);
  });

  const result = { regional: regionais, central: centrais, categoria: categorias, material: materiais }[key];
  _microFilter.options[key] = [...result].sort();
}

/** Populate filter options from the rendered results data */
function populateMicroFilterOptions(results) {
  _microFilterResults = results;
  ['regional', 'central', 'categoria', 'material'].forEach(key => _microRecomputeOptions(key));
  _buildOptionsList('regional');
  _buildOptionsList('central');
  _buildOptionsList('categoria');
  _buildOptionsList('material');
  _syncTriggerLabel('regional');
  _syncTriggerLabel('central');
  _syncTriggerLabel('categoria');
  _syncTriggerLabel('material');
  _syncTriggerLabel('variacao');
  _syncClearBtn();
  // Show bar only when there is data
  const bar = _microFilterBar();
  if (bar) bar.style.display = results.length ? 'flex' : 'none';
}

function _buildOptionsList(key, query = '') {
  const container = document.getElementById(`mfo-${key}`);
  if (!container) return;
  const opts = _microFilter.options[key];
  const q = query.toLowerCase().trim();
  const filtered = q ? opts.filter(o => o.toLowerCase().includes(q)) : opts;
  const applied = _microFilter.applied[key];
  const pending = _microFilter.pending[key];

  if (!filtered.length) {
    container.innerHTML = `<div style="padding:12px 10px;color:var(--text3);font-size:12px;text-align:center">Nenhum resultado</div>`;
    return;
  }
  container.innerHTML = filtered.map(opt => {
    const checked = pending.size ? pending.has(opt) : applied.has(opt);
    const id = `mfopt-${key}-${opt.replace(/[^a-z0-9]/gi,'_')}`;
    return `<label class="micro-filter-option" for="${id}">
      <input type="checkbox" id="${id}" value="${escapeHtml(opt)}" ${checked ? 'checked' : ''}
        onchange="_microFilterCheckChange('${key}', this)">
      <span class="micro-filter-option-label" title="${escapeHtml(opt)}">${escapeHtml(opt)}</span>
    </label>`;
  }).join('');
}

function _microFilterCheckChange(key, checkbox) {
  const val = checkbox.value;
  const pending = _microFilter.pending[key];
  if (checkbox.checked) pending.add(val);
  else pending.delete(val);
}

function toggleMicroFilter(key) {
  const dd = document.getElementById(`mfd-${key}`);
  const chev = document.getElementById(`mfc-${key}`);
  const allKeys = ['regional', 'central', 'categoria', 'material', 'variacao', 'tipo-var', 'capacidade'];
  // Close all other dropdowns first
  allKeys.filter(k => k !== key).forEach(otherKey => {
    const otherDd = document.getElementById(`mfd-${otherKey}`);
    const otherChev = document.getElementById(`mfc-${otherKey}`);
    if (otherDd?.classList.contains('open')) {
      otherDd.classList.remove('open');
      otherChev?.classList.remove('open');
      if (otherKey === 'variacao') {
        _varFilter.pending.levels = new Set(_varFilter.applied.levels);
      } else if (otherKey === 'capacidade') {
        _capFilter.pending.faixas = new Set(_capFilter.applied.faixas);
      } else if (otherKey === 'tipo-var') {
        _tipoVarFilter.pending = new Set(_tipoVarFilter.applied);
      } else {
        _microFilter.pending[otherKey] = new Set(_microFilter.applied[otherKey]);
      }
    }
  });
  const isOpen = dd.classList.toggle('open');
  chev.classList.toggle('open', isOpen);
  if (isOpen) {
    // Sync pending with applied when opening
    if (key === 'variacao') {
      _varFilter.pending.levels = new Set(_varFilter.applied.levels);
      _buildVariacaoOptions();
    } else if (key === 'capacidade') {
      _capFilter.pending.faixas = new Set(_capFilter.applied.faixas);
      _buildCapacidadeOptions();
    } else {
      _microFilter.pending[key] = new Set(_microFilter.applied[key]);
      // Reset search
      const searchEl = document.getElementById(`mfs-${key}`);
      if (searchEl) searchEl.value = '';
      _microRecomputeOptions(key);
      _buildOptionsList(key);
      // Focus search
      setTimeout(() => searchEl?.focus(), 50);
    }
  }
}

function filterMicroOptions(key, query) {
  _buildOptionsList(key, query);
}

function applyMicroFilter(key) {
  if (key === 'tipo-var') {
    _tipoVarReadPending();
    _tipoVarFilter.applied       = new Set(_tipoVarFilter.pending);
    _tipoVarFilter.nivelApplied  = new Set(_tipoVarFilter.nivelPending);
    _tipoVarUpdateTrigger();
    _applyMicroVisibility();
    document.getElementById('mfd-tipo-var')?.classList.remove('open');
    document.getElementById('mfc-tipo-var')?.classList.remove('open');
    _updateMicroFilterClearBtn();
    return;
  }
  if (key === 'variacao') {
    _readVarPending();
    _varFilter.applied.levels = new Set(_varFilter.pending.levels);
  } else if (key === 'capacidade') {
    _readCapPending();
    _capFilter.applied.faixas = new Set(_capFilter.pending.faixas);
  } else {
    _microFilter.applied[key] = new Set(_microFilter.pending[key]);
  }
  _closeMicroFilterDropdown(key);
  _syncTriggerLabel(key);
  _syncClearBtn();
  _applyMicroVisibility();
}

function cancelMicroFilter(key) {
  if (key === 'tipo-var') {
    _tipoVarFilter.pending       = new Set(_tipoVarFilter.applied);
    _tipoVarFilter.nivelPending  = new Set(_tipoVarFilter.nivelApplied);
    _tipoVarSyncToState(_tipoVarFilter.pending);
    _tipoVarSyncNivelToState(_tipoVarFilter.nivelPending);
    document.getElementById('mfd-tipo-var')?.classList.remove('open');
    document.getElementById('mfc-tipo-var')?.classList.remove('open');
    return;
  }
  if (key === 'variacao') {
    _varFilter.pending.levels = new Set(_varFilter.applied.levels);
  } else if (key === 'capacidade') {
    _capFilter.pending.faixas = new Set(_capFilter.applied.faixas);
    _syncCapDropdownToState(_capFilter.pending);
  } else {
    _microFilter.pending[key] = new Set(_microFilter.applied[key]);
  }
  _closeMicroFilterDropdown(key);
}

function clearMicroFilter(key) {
  if (key === 'tipo-var') {
    _tipoVarFilter.pending      = new Set();
    _tipoVarFilter.nivelPending = new Set(['regional','central','material']);
    _tipoVarFilter.applied      = new Set();
    _tipoVarFilter.nivelApplied = new Set(['regional','central','material']);
    _tipoVarSyncToState(new Set());
    _tipoVarSyncNivelToState(new Set(['regional','central','material']));
    _tipoVarUpdateTrigger();
    _applyMicroVisibility();
    document.getElementById('mfd-tipo-var')?.classList.remove('open');
    document.getElementById('mfc-tipo-var')?.classList.remove('open');
    _updateMicroFilterClearBtn();
    return;
  }
  if (key === 'variacao') {
    _varFilter.pending.levels = new Set();
    _varFilter.applied.levels = new Set();
  } else if (key === 'capacidade') {
    _capFilter.pending.faixas = new Set();
    _capFilter.applied.faixas = new Set();
    _syncCapDropdownToState(_capFilter.pending);
  } else {
    _microFilter.pending[key] = new Set();
    _microFilter.applied[key] = new Set();
  }
  _closeMicroFilterDropdown(key);
  _syncTriggerLabel(key);
  _syncClearBtn();
  _applyMicroVisibility();
}

function _closeMicroFilterDropdown(key) {
  document.getElementById(`mfd-${key}`)?.classList.remove('open');
  document.getElementById(`mfc-${key}`)?.classList.remove('open');
}

function _syncTriggerLabel(key) {
  const btn = document.getElementById(`mft-${key}`);
  const label = document.getElementById(`mft-${key}-label`);
  if (!label || !btn) return;
  const keyLabels = { regional: 'Regional', central: 'Central', categoria: 'Categoria', material: 'Material', variacao: 'Saúde', capacidade: 'Capacidade' };
  const keyLabel = keyLabels[key] || key;

  if (key === 'capacidade') {
    const st = _capFilter.applied;
    if (!_capFilterIsActive(st)) {
      label.innerHTML = keyLabel;
      btn.classList.remove('active');
    } else {
      const labelMap = (typeof CAP_FAIXAS !== 'undefined')
        ? Object.fromEntries(Object.entries(CAP_FAIXAS).map(([k, v]) => [k, v.label]))
        : {};
      label.innerHTML = st.faixas.size === 1
        ? `${keyLabel}: <strong>${escapeHtml(labelMap[[...st.faixas][0]] || [...st.faixas][0])}</strong>`
        : `${keyLabel} <span class="micro-filter-badge">${st.faixas.size}</span>`;
      btn.classList.add('active');
    }
    return;
  }

  if (key === 'variacao') {
    const st = _varFilter.applied;
    if (!_varFilterIsActive(st)) {
      label.innerHTML = keyLabel;
      btn.classList.remove('active');
    } else {
      const labelMap = { ok: 'Saudável', atencao: 'Atenção', urgente: 'Urgente', critico: 'Crítico', none: 'Sem saúde' };
      const summary = [...st.levels].map(l => labelMap[l] || l).join(', ');
      label.innerHTML = st.levels.size === 1
        ? `${keyLabel}: <strong>${summary}</strong>`
        : `${keyLabel} <span class="micro-filter-badge">${st.levels.size}</span>`;
      btn.classList.add('active');
    }
    return;
  }

  const applied = _microFilter.applied[key];
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

function _syncClearBtn() {
  const btn = document.getElementById('micro-filter-clear-btn');
  if (!btn) return;
  const hasAny = _microFilter.applied.regional.size || _microFilter.applied.central.size || _microFilter.applied.categoria.size || _microFilter.applied.material.size || _varFilterIsActive(_varFilter.applied) || _capFilterIsActive(_capFilter.applied) || _tipoVarIsActive();
  btn.style.display = hasAny ? '' : 'none';
}

function clearAllMicroFilters() {
  _microFilter.applied.regional  = new Set();
  _microFilter.applied.central   = new Set();
  _microFilter.applied.categoria = new Set();
  _microFilter.applied.material  = new Set();
  _microFilter.pending.regional  = new Set();
  _microFilter.pending.central   = new Set();
  _microFilter.pending.categoria = new Set();
  _microFilter.pending.material  = new Set();
  _varFilter.applied  = { levels: new Set() };
  _varFilter.pending  = { levels: new Set() };
  _capFilter.applied  = { faixas: new Set() };
  _capFilter.pending  = { faixas: new Set() };
  _syncCapDropdownToState(_capFilter.pending);
  _syncTriggerLabel('regional');
  _syncTriggerLabel('central');
  _syncTriggerLabel('categoria');
  _syncTriggerLabel('material');
  _syncTriggerLabel('variacao');
  _syncTriggerLabel('capacidade');
  _syncClearBtn();
  _tipoVarFilter.applied      = new Set();
  _tipoVarFilter.pending      = new Set();
  _tipoVarFilter.nivelApplied = new Set(['regional','central','material']);
  _tipoVarFilter.nivelPending = new Set(['regional','central','material']);
  _tipoVarSyncToState(new Set());
  _tipoVarSyncNivelToState(new Set(['regional','central','material']));
  _tipoVarUpdateTrigger();
  _applyMicroVisibility();
  // Ao limpar filtros, NÃO removemos a trava de altura — isso é o que
  // causava o container encolher/pular depois de "Limpar Filtros" (o
  // piso ficava vazio e nunca era recalculado até a próxima análise).
  // Aqui só atualizamos a trava para cima, se o conteúdo agora visível
  // for maior que o piso atual — a altura nunca encolhe.
  _updateMicroContainerHeightLock(false);
}

// ── Foco vindo da Visão Macro ────────────────────────────────────────────
// Clique numa linha dos rankings "Piores centrais/materiais por criticidade"
// (macro.js) → aplica na Visão Micro o filtro da dimensão clicada, garante
// que a aba Micro esteja ativa e rola até ela.
//
// Zera os demais filtros de propósito: se um filtro anterior (Regional,
// Saúde, Capacidade…) continuasse valendo, o item clicado poderia
// simplesmente não passar por ele e o clique pareceria não ter funcionado.
function microFocusFromMacro(key, value) {
  if (key !== 'central' && key !== 'material') return;
  const val = (value || '').trim();
  if (!val) return;

  const aplicarFoco = () => {
    clearAllMicroFilters();
    _microFilter.applied[key] = new Set([val]);
    _microFilter.pending[key] = new Set([val]);
    _syncTriggerLabel(key);
    _syncClearBtn();
    _applyMicroVisibility();

    if (typeof anSwitchView === 'function') anSwitchView('micro');
    _expandMicroAfterFocus();

    _updateMicroContainerHeightLock(false);
    requestAnimationFrame(_scrollToMicroView);
  };

  // Cada ranking leva ao agrupamento que responde a pergunta dele:
  //   "Piores materiais"  → agrupamento por MATERIAL (o card já é o material
  //                         clicado, com as centrais dele dentro).
  //   "Piores centrais"   → agrupamento por regional, como sempre.
  // Quando o agrupamento muda, anSetGroupMode reconstrói a visão inteira
  // atrás do overlay — por isso o foco vai como callback, e não na linha de
  // baixo: ele precisa do DOM novo. Se o modo já for o certo, o callback
  // roda na hora e nada disso aparece pro usuário.
  if (typeof anSetGroupMode === 'function') {
    anSetGroupMode(key === 'material' ? 'material' : 'regional', aplicarFoco);
  } else {
    aplicarFoco();
  }
}

// Toda análise deixa regionais e centrais recolhidos (ver fim de
// _rodarAnaliticoCore). Depois de um foco vindo da Macro isso deixaria a
// tela rolar até um bloco fechado, então aqui abrimos o que sobrou visível:
// todos os regionais, e os cards de central só quando são poucos — clicar
// num material pode deixar dezenas de centrais em pé, e abrir todas de uma
// vez trava a rolagem sem ajudar ninguém.
const _FOCUS_MAX_CARDS_EXPAND = 15;

function _expandMicroAfterFocus() {
  const groups = [...document.querySelectorAll('#an-micro-container .regional-group')]
    .filter(g => g.style.display !== 'none');
  groups.forEach(group => {
    const body = group.querySelector('.regional-group-body');
    const chev = group.querySelector('.regional-group-chev');
    if (body) body.classList.add('open');
    group.classList.remove('collapsed');
    if (chev) chev.style.transform = '';
  });
  if (groups.length) {
    _regionaisExpanded = true;
    _updateToggleRegionaisBtn();
    _updateRegionalFocus();
  }

  const cards = [...document.querySelectorAll('#an-micro-container .micro-filial-card')]
    .filter(c => c.style.display !== 'none');
  if (!cards.length || cards.length > _FOCUS_MAX_CARDS_EXPAND) return;
  cards.forEach(card => {
    const body = card.querySelector('.micro-filial-body');
    const wrap = card.querySelector('.micro-filial-header-wrap');
    if (body && wrap && !body.classList.contains('open')) toggleMicro(wrap);
  });
  _centraisExpanded = true;
  _updateToggleCentralisBtn();
}

// Rola suavemente até o seletor de visões, descontando a topbar fixa para
// que as abas e a barra de filtros não fiquem escondidas embaixo dela.
function _scrollToMicroView() {
  const anchor = document.querySelector('#an-content .an-view-switch')
              || document.getElementById('an-view-pane-micro');
  if (!anchor) return;
  const topbarH = document.querySelector('.topbar')?.offsetHeight || 0;
  const y = anchor.getBoundingClientRect().top + window.pageYOffset - topbarH - 12;
  window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
}

// ── Saúde filter state (replaces old variação % filter) ──
const _varFilter = {
  pending:  { levels: new Set() },
  applied:  { levels: new Set() },
};

// ── Filtro de capacidade (estoque × capacidade/estoque de segurança) ─────
// Mesma mecânica do filtro de Saúde acima: um Set de faixas marcadas. A
// central passa quando tem AO MENOS UM material na faixa marcada — o alvo é
// "me mostre quem tem problema de capacidade", não "quem só tem isso".
const _capFilter = {
  pending: { faixas: new Set() },
  applied: { faixas: new Set() },
};

function _capFilterChange() {
  document.querySelectorAll('#mfr-cap-faixas .mfr-chip').forEach(chip => {
    const cb = chip.querySelector('input[type="checkbox"]');
    chip.classList.toggle('checked', cb.checked);
  });
  _updateCapHint();
}

function _updateCapHint() {
  const hint = document.getElementById('mfr-cap-hint');
  if (!hint) return;
  const faixas = [...document.querySelectorAll('#mfr-cap-faixas input:checked')].map(i => i.value);
  if (!faixas.length) {
    hint.textContent = 'Nenhum filtro definido.';
    hint.className = 'mfr-hint';
    return;
  }
  const labelMap = (typeof CAP_FAIXAS !== 'undefined')
    ? Object.fromEntries(Object.entries(CAP_FAIXAS).map(([k, v]) => [k, v.label]))
    : {};
  hint.textContent = 'Exibindo centrais com: ' + faixas.map(f => labelMap[f] || f).join(', ');
  hint.className = 'mfr-hint active';
}

function _syncCapDropdownToState(state) {
  document.querySelectorAll('#mfr-cap-faixas input[type="checkbox"]').forEach(cb => {
    cb.checked = state.faixas.has(cb.value);
    cb.closest('.mfr-chip').classList.toggle('checked', cb.checked);
  });
  _updateCapHint();
}

function _readCapPending() {
  _capFilter.pending.faixas = new Set([...document.querySelectorAll('#mfr-cap-faixas input:checked')].map(i => i.value));
}

function _capFilterIsActive(state) {
  return state.faixas.size > 0;
}

function _buildCapacidadeOptions() {
  _syncCapDropdownToState(_capFilter.pending);
}

// Faixas presentes no card. Card sem nenhuma (central sem lançamento no
// período) conta como "sem base", pra não sumir silenciosamente do filtro.
function _cardCapFaixas(card) {
  const raw = (card.dataset.capFaixas || '').split(',').map(s => s.trim()).filter(Boolean);
  return raw.length ? raw : ['sem_base'];
}

function _cardPassesCapFilter(card, state) {
  if (!_capFilterIsActive(state)) return true;
  return _cardCapFaixas(card).some(f => state.faixas.has(f));
}

// ── Filtro de tipo de variação (desfalque/sobra) ─────────
const _tipoVarFilter = {
  applied:      new Set(),       // 'desfalque', 'sobra'
  pending:      new Set(),
  nivelApplied: new Set(['regional','central','material']), // default: all levels
  nivelPending: new Set(['regional','central','material']),
};

function _tipoVarChange() {
  document.querySelectorAll('#mfo-tipo-var .micro-filter-option').forEach(opt => {
    const cb = opt.querySelector('input[type=checkbox]');
    opt.classList.toggle('checked', cb?.checked);
  });
}

function _tipoVarIsActive() { return _tipoVarFilter.applied.size > 0; }

function _tipoVarSyncToState(state) {
  document.querySelectorAll('#mfo-tipo-var input[type=checkbox]').forEach(cb => {
    cb.checked = state.has(cb.value);
    cb.closest('.micro-filter-option').classList.toggle('checked', cb.checked);
  });
  // Also sync nivel to current applied state
  _tipoVarSyncNivelToState(_tipoVarFilter.nivelPending);
}

function _tipoVarReadPending() {
  _tipoVarFilter.pending = new Set(
    [...document.querySelectorAll('#mfo-tipo-var input:checked')].map(i => i.value)
  );
  _tipoVarFilter.nivelPending = new Set(
    [...document.querySelectorAll('#mfo-tipo-var-nivel input:checked')].map(i => i.value)
  );
}

function _tipoVarSyncNivelToState(state) {
  document.querySelectorAll('#mfo-tipo-var-nivel input[type=checkbox]').forEach(cb => {
    cb.checked = state.has(cb.value);
    cb.closest('.micro-filter-option').classList.toggle('checked', cb.checked);
  });
}

function _tipoVarUpdateTrigger() {
  const lbl  = document.getElementById('mft-tipo-var-label');
  const btn  = document.getElementById('mft-tipo-var');
  const sel  = _tipoVarFilter.applied;
  const nivel = _tipoVarFilter.nivelApplied;
  if (!lbl) return;
  if (sel.size === 0) {
    lbl.textContent = 'Variação';
    btn?.classList.remove('active');
    return;
  }
  const typeParts = [];
  if (sel.has('desfalque')) typeParts.push('Desfalque');
  if (sel.has('sobra'))     typeParts.push('Sobra');
  // Nivel hint: show only if not all selected
  const allNivel = nivel.has('regional') && nivel.has('central') && nivel.has('material');
  const nivelParts = [];
  if (!allNivel) {
    if (nivel.has('regional')) nivelParts.push('Reg.');
    if (nivel.has('central'))  nivelParts.push('Cen.');
    if (nivel.has('material')) nivelParts.push('Mat.');
  }
  lbl.textContent = typeParts.join('+') + (nivelParts.length ? ` · ${nivelParts.join('+')}` : '');
  btn?.classList.add('active');
}

function _varFilterChange() {
  // Sync chip visual state
  document.querySelectorAll('#mfr-health-levels .mfr-chip').forEach(chip => {
    const cb = chip.querySelector('input[type="checkbox"]');
    chip.classList.toggle('checked', cb.checked);
  });
  _updateVarHint();
}

function _updateVarHint() {
  const hint = document.getElementById('mfr-hint');
  if (!hint) return;
  const levels = [...document.querySelectorAll('#mfr-health-levels input:checked')].map(i => i.value);
  if (!levels.length) {
    hint.textContent = 'Nenhum filtro definido.';
    hint.className = 'mfr-hint';
    return;
  }
  const labelMap = { ok: 'Saudável', atencao: 'Atenção', urgente: 'Urgente', critico: 'Crítico', none: 'Sem saúde' };
  hint.textContent = 'Exibindo: ' + levels.map(l => labelMap[l] || l).join(', ');
  hint.className = 'mfr-hint active';
}

function _syncVarDropdownToState(state) {
  document.querySelectorAll('#mfr-health-levels input[type="checkbox"]').forEach(cb => {
    cb.checked = state.levels.has(cb.value);
    cb.closest('.mfr-chip').classList.toggle('checked', cb.checked);
  });
  _updateVarHint();
}

function _readVarPending() {
  const levels = new Set([...document.querySelectorAll('#mfr-health-levels input:checked')].map(i => i.value));
  _varFilter.pending.levels = levels;
}

function _varFilterIsActive(state) {
  return state.levels.size > 0;
}

function _buildVariacaoOptions() {
  _syncVarDropdownToState(_varFilter.pending);
}

function _applyMicroVisibility() {
  const appliedRegionals  = _microFilter.applied.regional;
  const appliedCentrals   = _microFilter.applied.central;
  const appliedCategorias = _microFilter.applied.categoria;
  const appliedMaterials  = _microFilter.applied.material;
  const varState    = _varFilter.applied;
  const varActive   = _varFilterIsActive(varState);
  const tipoActive  = _tipoVarIsActive();
  const tipoFilter  = _tipoVarFilter.applied; // Set: 'desfalque', 'sobra'

  const tipoNivel = _tipoVarFilter.nivelApplied;

  // Helper: check if a diff passes tipo-var filter at a given level
  const passesTipo = (diff, level) => {
    if (!tipoActive) return true;
    if (!tipoNivel.has(level)) return true;  // level not being filtered
    const isDesfalque = diff < 0;
    const isSobra     = diff > 0;
    if (tipoFilter.has('desfalque') && tipoFilter.has('sobra')) return true;
    if (tipoFilter.has('desfalque')) return isDesfalque;
    if (tipoFilter.has('sobra'))     return isSobra;
    return true;
  };

  // ── Agrupamento por MATERIAL ──────────────────────────────────────────
  // Card = material (Material/Categoria/Saúde e o nível "material" do
  // filtro de tipo de variação); linha = central (Central/Regional e o
  // nível "central"). O nível "regional" fica sem alvo aqui — a opção é
  // escondida da barra por _anSyncGroupModeUI.
  if (_anGroupMode === 'material') {
    document.querySelectorAll('#an-micro-container .micro-filial-card').forEach(card => {
      const matName = card.dataset.material || '';
      const matCat  = (card.dataset.categoria || '').trim().toUpperCase();
      if (appliedMaterials.size  && !appliedMaterials.has(matName)) { card.style.display = 'none'; return; }
      if (appliedCategorias.size && !appliedCategorias.has(matCat))  { card.style.display = 'none'; return; }
      if (varActive && !varState.levels.has(card.dataset.healthLevel || 'none')) { card.style.display = 'none'; return; }
      if (tipoActive && !passesTipo(parseFloat(card.dataset.diff || '0'), 'material')) { card.style.display = 'none'; return; }

      let visibleRows = 0;
      card.querySelectorAll('tbody tr.material-row').forEach(row => {
        const show = (!appliedCentrals.size  || appliedCentrals.has(row.dataset.central  || ''))
                  && (!appliedRegionals.size || appliedRegionals.has(row.dataset.regional || ''))
                  && passesTipo(parseFloat(row.dataset.diff || '0'), 'central');
        row.style.display = show ? '' : 'none';
        if (show) visibleRows++;
      });
      card.style.display = visibleRows === 0 ? 'none' : '';
    });
    return;
  }

  // Handle regional groups
  document.querySelectorAll('#an-micro-container .regional-group').forEach(group => {
    const groupRegional = group.dataset.regional || '';
    if (appliedRegionals.size && !appliedRegionals.has(groupRegional)) {
      group.style.display = 'none'; return;
    }

    // Regional tipo-var: check sum of all cards in group
    if (tipoActive) {
      const groupDiff = parseFloat(group.dataset.diff || '0');
      if (!passesTipo(groupDiff, 'regional')) { group.style.display = 'none'; return; }
    }

    group.style.display = '';

    let anyCardVisible = false;
    group.querySelectorAll('.micro-filial-card').forEach(card => {
      const header = card.querySelector('.micro-filial-name');
      const centralName = header ? header.textContent.trim() : '';

      if (appliedCentrals.size && !appliedCentrals.has(centralName)) {
        card.style.display = 'none'; return;
      }
      if (varActive) {
        const cardLevel = card.dataset.healthLevel || 'none';
        if (!varState.levels.has(cardLevel)) {
          card.style.display = 'none'; return;
        }
      }
      if (!_cardPassesCapFilter(card, _capFilter.applied)) { card.style.display = 'none'; return; }
      // Central tipo-var: check card's diff
      if (tipoActive) {
        const cardDiff = parseFloat(card.dataset.diff || '0');
        if (!passesTipo(cardDiff, 'central')) { card.style.display = 'none'; return; }
      }

      const rows = card.querySelectorAll('tbody tr.material-row');
      if (appliedMaterials.size || appliedCategorias.size || tipoActive) {
        let visibleRows = 0;
        rows.forEach(row => {
          const matCell = row.querySelector('td:first-child');
          const matName = matCell ? matCell.textContent.trim() : '';
          const matDiff = parseFloat(row.dataset.diff || '0');
          const matCat  = (row.dataset.categoria || '').trim().toUpperCase();
          const showMat  = !appliedMaterials.size  || appliedMaterials.has(matName);
          const showCat  = !appliedCategorias.size || appliedCategorias.has(matCat);
          const showTipo = passesTipo(matDiff, 'material');
          const show = showMat && showCat && showTipo;
          row.style.display = show ? '' : 'none';
          if (show) visibleRows++;
        });
        if (visibleRows === 0) { card.style.display = 'none'; return; }
        card.style.display = '';
      } else {
        rows.forEach(r => r.style.display = '');
        card.style.display = '';
      }
      anyCardVisible = true;
    });

    if (!anyCardVisible) group.style.display = 'none';
  });
}

// ── Toggle Regionais ─────────────────────────────────────────────────────
let _regionaisExpanded = true;   // estado atual dos grupos regionais

function toggleAllRegionais() {
  _regionaisExpanded = !_regionaisExpanded;
  document.querySelectorAll('#an-micro-container .regional-group').forEach(group => {
    const body = group.querySelector('.regional-group-body');
    const chev = group.querySelector('.regional-group-chev');
    if (_regionaisExpanded) {
      if (body) body.classList.add('open');
      group.classList.remove('collapsed');
      if (chev) chev.style.transform = '';
    } else {
      if (body) body.classList.remove('open');
      group.classList.add('collapsed');
      if (chev) chev.style.transform = 'rotate(-90deg)';
    }
  });
  _updateToggleRegionaisBtn();
  _updateRegionalFocus();
}

function _updateToggleRegionaisBtn() {
  const chev = document.getElementById('chev-toggle-regionais');
  const btn  = document.getElementById('btn-toggle-regionais');
  const lbl  = document.getElementById('label-toggle-regionais');
  if (chev) chev.style.transform = _regionaisExpanded ? '' : 'rotate(-90deg)';
  if (btn)  btn.classList.toggle('active', !_regionaisExpanded);
  if (lbl)  lbl.textContent = _regionaisExpanded ? 'Recolher Regionais' : 'Expandir Regionais';
}

// ── Toggle Centrais ───────────────────────────────────────────────────────
let _centraisExpanded = true;    // estado atual dos cards de central

function toggleAllCentralis() {
  _centraisExpanded = !_centraisExpanded;
  document.querySelectorAll('#an-micro-container .micro-filial-card').forEach(card => {
    const body = card.querySelector('.micro-filial-body');
    const chev = card.querySelector('[id^="chev-"]');
    if (_centraisExpanded) {
      if (body) body.classList.add('open');
      if (chev) chev.style.transform = 'rotate(180deg)';
    } else {
      if (body) body.classList.remove('open');
      if (chev) chev.style.transform = '';
    }
  });
  _updateToggleCentralisBtn();
  if (_anGroupMode === 'material') _updateCentralFocus(null);
  else document.querySelectorAll('#an-micro-container .regional-group').forEach(_updateCentralFocus);
}

function _updateToggleCentralisBtn() {
  const chev = document.getElementById('chev-toggle-centrais');
  const btn  = document.getElementById('btn-toggle-centrais');
  const lbl  = document.getElementById('label-toggle-centrais');
  if (chev) chev.style.transform = _centraisExpanded ? '' : 'rotate(-90deg)';
  if (btn)  btn.classList.toggle('active', !_centraisExpanded);
  // Este botão sempre abre/fecha os CARDS — que são centrais no agrupamento
  // por regional e materiais no agrupamento por material.
  const alvo = _anGroupMode === 'material' ? 'Materiais' : 'Centrais';
  if (lbl)  lbl.textContent = (_centraisExpanded ? 'Recolher ' : 'Expandir ') + alvo;
}

// Mantém compatibilidade com chamadas legadas
function expandAllMicro()   { if (!_regionaisExpanded) toggleAllRegionais(); if (!_centraisExpanded) toggleAllCentralis(); }
function collapseAllMicro() { if (_regionaisExpanded)  toggleAllRegionais(); if (_centraisExpanded)  toggleAllCentralis(); }

// Close dropdowns when clicking outside
document.addEventListener('click', e => {
  ['regional','central','categoria','material','variacao'].forEach(key => {
    const group = document.getElementById(`mfg-${key}`);
    if (group && !group.contains(e.target)) {
      const dd = document.getElementById(`mfd-${key}`);
      if (dd?.classList.contains('open')) {
        // Cancel pending on outside click
        if (key === 'variacao') {
          _varFilter.pending.levels = new Set(_varFilter.applied.levels);
        } else {
          _microFilter.pending[key] = new Set(_microFilter.applied[key]);
        }
        _closeMicroFilterDropdown(key);
      }
    }
  });
});

Object.assign(window, { _microFilterCheckChange, toggleMicroFilter, filterMicroOptions,
  applyMicroFilter, cancelMicroFilter, clearMicroFilter, clearAllMicroFilters,
  expandAllMicro, collapseAllMicro, toggleAllRegionais, toggleAllCentralis, populateMicroFilterOptions,
  _buildVariacaoOptions, _varFilterChange, _tipoVarChange, _tipoVarSyncToState, _tipoVarIsActive,
  _buildCapacidadeOptions, _capFilterChange, microFocusFromMacro });

// ═══════════════════════════════════════════════════════════

Object.assign(window, {
  toggleSidebar,
  closeSidebar,
  navigate,
  openModal,
  closeModal,
  setTab,
  setModulo,
  exportarDados,
  restaurarBackup,
  toast,
  handleImport,
  handleFiliaisImport,
  salvarEntrada,
  salvarSaida,
  salvarLancamento,
  salvarSAP,
  salvarConfig,
  renderConfigs,
  renderFiliais,
  renderMateriais,
  renderImports,
  excluirImportacao,
  excluirCustosSap,
  removerConfig,
  editConfig,
  deleteConfig,
  saveResponsavel,
  updateParamGerais,
  applyColFilter,
  clearColFilter,
  clearAllColFilters,
  filtrarTabela,
  filtrarCustosSap,
  filtrarLista,
  irParaPagina,
  paginaAnterior,
  proximaPagina,
  irParaUltima,
  primeiraPaginaCustosSap,
  paginaAnteriorCustosSap,
  proximaPaginaCustosSap,
  ultimaPaginaCustosSap,
  removerRegistro,
  removerFilial,
  removerMaterial,
  limparFiliais,
  limparMateriais,
  focusFilialImport,
  focusMaterialImport,
  handleMateriaisImport,
  rodarAnalitico,
  limparAnalitico,
  setTheme,
  applyTheme,
  getSavedTheme,
  openAnaliticoDetailModal,
  closeAnaliticoDetailModal,
  toggleAnaliticoDetailFullscreen,
  toggleMicro,
  toggleRegional,
  toggleMaterialDetail,
  toggleBreakdown,
  expandAllMicro,
  collapseAllMicro,
  toggleAllRegionais,
  toggleAllCentralis,
  toggleMicroFilter,
  filterMicroOptions,
  applyMicroFilter,
  cancelMicroFilter,
  clearAllMicroFilters
});

// ═══════════════════════════════════════════════════════════
// CLOCK
// ═══════════════════════════════════════════════════════════
// _nextTuesday() removida daqui (28/07) — usa a versão global definida em
// notifications.js, que carrega DEPOIS deste arquivo no index.html. Isso é
// seguro porque _nextLancLabel() só é chamada em tempo de renderização
// (nunca no topo do script), quando notifications.js já terminou de
// carregar. O motivo de remover e não manter as duas: essa cópia daqui
// nunca devolvia "hoje" mesmo quando hoje é terça — sempre pulava pra
// semana seguinte —, o que é inconsistente com o diff===0 tratado logo
// abaixo em _nextLancLabel(). A versão de notifications.js trata "hoje é
// terça" corretamente; é ela quem deve ser a única fonte da verdade.
function _nextLancLabel() {
  const next  = _nextTuesday();
  const now   = new Date(); now.setHours(0,0,0,0);
  const diff  = Math.round((next - now) / 86400000);
  const dd    = String(next.getDate()).padStart(2,'0');
  const mo    = String(next.getMonth()+1).padStart(2,'0');
  const days  = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][next.getDay()];
  if (diff === 0) return { text: 'Hoje · ' + days, cls: 'danger' };
  if (diff === 1) return { text: 'Amanhã · ' + days, cls: 'warn' };
  return { text: `${dd}/${mo} · ${days} · ${diff}d`, cls: diff <= 3 ? 'warn' : '' };
}

// ── Score médio de saúde (usa _anResumoCentraisData se disponível) ────────
function _saudeGeralLabel() {
  const data = window._anResumoCentraisData;
  if (!data || !data.length) return { text: 'Sem dados', cls: 'muted', icon: 'ti-heartbeat' };
  const scores = data
    .map(c => parseFloat(c.healthScore))
    .filter(s => Number.isFinite(s));
  if (!scores.length) return { text: 'Sem dados', cls: 'muted', icon: 'ti-heartbeat' };
  const avg   = Math.round(scores.reduce((a,b)=>a+b,0) / scores.length);
  const criticos = data.filter(c => c.healthLevel === 'critico').length;
  const urgentes = data.filter(c => c.healthLevel === 'urgente').length;
  let cls  = avg >= 80 ? 'ok' : avg >= 55 ? 'warn' : 'danger';
  let icon = avg >= 80 ? 'ti-heartbeat' : avg >= 55 ? 'ti-alert-triangle' : 'ti-flame';
  let extra = criticos > 0 ? ` · ${criticos} crít.` : urgentes > 0 ? ` · ${urgentes} urg.` : '';
  return { text: `${avg}%${extra}`, cls, icon };
}

// ── Alertas ativos (ocorrências abertas + vencidas) ───────────────────────
function _alertasLabel() {
  const ocs = (typeof state !== 'undefined' && state.ocorrencias) ? state.ocorrencias : [];
  if (!ocs.length) return { text: 'Nenhum', cls: 'muted', icon: 'ti-bell' };
  const hoje   = new Date(); hoje.setHours(0,0,0,0);
  const abertas = ocs.filter(o => !o.concluida);
  const vencidas = abertas.filter(o => {
    if (!o.dataLimite) return false;
    return new Date(o.dataLimite + 'T00:00:00') < hoje;
  });
  const urgentes = abertas.filter(o => {
    if (!o.dataLimite) return false;
    const lim = new Date(o.dataLimite + 'T00:00:00');
    const d = Math.round((lim - hoje) / 86400000);
    return d >= 0 && d <= 2;
  });
  if (!abertas.length) return { text: 'Nenhum', cls: 'ok', icon: 'ti-bell' };
  const cls  = vencidas.length > 0 ? 'danger' : urgentes.length > 0 ? 'warn' : 'muted';
  const icon = vencidas.length > 0 ? 'ti-bell-ringing' : 'ti-bell';
  let text = `${abertas.length} aberta${abertas.length !== 1 ? 's' : ''}`;
  if (vencidas.length) text += ` · ${vencidas.length} venc.`;
  else if (urgentes.length) text += ` · ${urgentes.length} urg.`;
  return { text, cls, icon };
}

// ── Atualiza os 3 widgets do topbar ──────────────────────────────────────
function updateClock() {
  // Próx. lançamento
  const lanc = _nextLancLabel();
  const lancEl = document.getElementById('next-lanc-val');
  if (lancEl) {
    lancEl.textContent = lanc.text;
    lancEl.className   = 'topbar-stat-val' + (lanc.cls ? ' ' + lanc.cls : '');
  }

  // Saúde geral
  const saude = _saudeGeralLabel();
  const saudeEl   = document.getElementById('saude-val');
  const saudeIcon = document.getElementById('saude-icon');
  if (saudeEl) {
    saudeEl.textContent = saude.text;
    saudeEl.className   = 'topbar-stat-val' + (saude.cls ? ' ' + saude.cls : '');
  }
  if (saudeIcon) saudeIcon.className = `ti ${saude.icon} topbar-stat-icon`;

  // Alertas
  const alertas = _alertasLabel();
  const alertasEl   = document.getElementById('alertas-val');
  const alertasIcon = document.getElementById('alertas-icon');
  if (alertasEl) {
    alertasEl.textContent = alertas.text;
    alertasEl.className   = 'topbar-stat-val' + (alertas.cls ? ' ' + alertas.cls : '');
  }
  if (alertasIcon) alertasIcon.className = `ti ${alertas.icon} topbar-stat-icon`;
}

// ═══════════════════════════════════════════════════════════
// SIDEBAR COLLAPSE
// ═══════════════════════════════════════════════════════════
// Sidebar sempre recolhida; expande via CSS :hover — sem estado salvo.

function toggleSidebarCollapse() { /* no-op: comportamento via CSS :hover */ }
function restoreSidebarState()   { /* no-op: sidebar sempre recolhida por padrão */ }

Object.assign(window, { toggleSidebarCollapse, toggleSidebar, closeSidebar });

// ═══════════════════════════════════════════════════════════
// QUICK PERIOD SHORTCUTS
// ═══════════════════════════════════════════════════════════
function toISODate(d) {
  return localISODate(d);
}

function setQuickPeriod(days) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - days + 1);
  const ini = document.getElementById('an-dt-ini');
  const fim = document.getElementById('an-dt-fim');
  if (ini) ini.value = toISODate(start);
  if (fim) fim.value = toISODate(end);
  document.querySelectorAll('.qp-btn').forEach(b => b.classList.remove('active'));
  event?.target?.classList.add('active');
  rodarAnalitico();
}

function setQuickPeriodCurrentMonth() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const ini = document.getElementById('an-dt-ini');
  const fim = document.getElementById('an-dt-fim');
  if (ini) ini.value = toISODate(start);
  if (fim) fim.value = toISODate(end);
  document.querySelectorAll('.qp-btn').forEach(b => b.classList.remove('active'));
  event?.target?.classList.add('active');
  rodarAnalitico();
}

function setQuickPeriodCurrentYear() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const end = new Date(now.getFullYear(), 11, 31);
  const ini = document.getElementById('an-dt-ini');
  const fim = document.getElementById('an-dt-fim');
  if (ini) ini.value = toISODate(start);
  if (fim) fim.value = toISODate(end);
  document.querySelectorAll('.qp-btn').forEach(b => b.classList.remove('active'));
  event?.target?.classList.add('active');
  rodarAnalitico();
}

Object.assign(window, { setQuickPeriod, setQuickPeriodCurrentMonth, setQuickPeriodCurrentYear });

// ═══════════════════════════════════════════════════════════
// GLOBAL SEARCH
// ═══════════════════════════════════════════════════════════
const moduleColors = {
  'Entrada':    { bg: 'var(--green-bg)',   color: 'var(--green)',  icon: 'ti-package-import', nav: 'entradas'   },
  'Saída':      { bg: 'var(--red-bg)',     color: 'var(--red)',    icon: 'ti-package-export', nav: 'saidas'     },
  'Lançamento': { bg: 'var(--amber-bg)',   color: 'var(--amber)',  icon: 'ti-clipboard-list', nav: 'lancamentos'},
  'SAP':        { bg: 'var(--accent-dim)', color: 'var(--accent)', icon: 'ti-database',       nav: 'sap'        },
  'Custos SAP': { bg: 'var(--purple-bg)',  color: 'var(--purple)', icon: 'ti-chart-bar',      nav: 'custosSap'  },
  'Central':    { bg: 'var(--teal-bg)',    color: 'var(--teal)',   icon: 'ti-building-warehouse', nav: 'filiais'},
  'Material':   { bg: 'var(--bg3)',        color: 'var(--text2)',  icon: 'ti-box',            nav: 'materiais'  },
};

// Escopo do state → rótulo do módulo (chave de moduleColors e do fieldMap
// de _gsShowDetail). A ordem aqui é a ordem dos chips no modal.
const _GS_SCOPES = [
  { scope: 'entradas',    modKey: 'Entrada'    },
  { scope: 'saidas',      modKey: 'Saída'      },
  { scope: 'lancamentos', modKey: 'Lançamento' },
  { scope: 'sap',         modKey: 'SAP'        },
  { scope: 'custosSap',   modKey: 'Custos SAP' },
  { scope: 'filiais',     modKey: 'Central'    },
  { scope: 'materiais',   modKey: 'Material'   },
];

// Colunas da tabela de resultados por módulo: [rótulo, campo, tipo?].
// tipo 'num' formata em kg, 'money' em R$; sem tipo é texto (e leva o
// destaque do termo buscado).
const _GS_COLS = {
  'Entrada':    [['Central Compra','centralCompra'],['Central Destino','centralDestino'],['NF','nf'],['Fornecedor','fornecedor'],['Categoria','categoria'],['Material','material'],['Dt. Emissão','dtEmissao'],['Peso','peso','num'],['Valor Total','valorTotal','money']],
  'Saída':      [['Central','central'],['OS','os'],['Fornecedor','fornecedor'],['Categoria','categoria'],['Material','material'],['Dt. Emissão','dtEmissao'],['Peso','peso','num'],['Valor Total','valorTotal','money']],
  'Lançamento': [['Central','central'],['Dt. Lançamento','dtLanc'],['Fornecedor','fornecedor'],['Categoria','categoria'],['Material','material'],['Peso','peso','num'],['Valor Total','valorTotal','money']],
  'SAP':        [['Movimento','movimento'],['Usuário','usuario'],['Ref.','ref'],['Pedido','pedido'],['Doc MIGO','documento'],['Central','central'],['Material','material'],['Dt. Lançamento','dtLanc'],['Peso','peso','num'],['Valor Total','valorTotal','money']],
  'Custos SAP': [['Material','material'],['Central','central'],['Ano','ano'],['Mês','mes'],['Estoque Total','estoqueTotal','num'],['Custo','custo','money'],['Valor Total','valorTotal','money']],
  'Central':    [['Sigla','alias'],['Nome Original','origem'],['CNPJ','cnpj'],['Regional','regional'],['Cadastrado em','created']],
  'Material':   [['Grupo SAP','alias'],['Cód SAP','codSap'],['Material Original','origem'],['Descrição','desc'],['Cadastrado em','created']],
};

// Visão "Todos": os módulos têm colunas diferentes demais para uma tabela
// só, então essa visão usa um denominador comum derivado de cada registro
// (ver _gsUnificado). Para ver as colunas completas de um módulo, basta
// clicar no chip dele no topo do modal.
const _GS_COLS_TODOS = [['Módulo','_mod'],['Central','_central'],['Material','_material'],['Documento','_doc'],['Data','_data'],['Peso','_peso','num'],['Valor','_valor','money']];

function _gsUnificado(modKey, r) {
  return {
    _mod:      modKey,
    _central:  r.central || r.centralCompra || r.alias || '',
    _material: r.material || r.origem || '',
    _doc:      r.documento || r.nf || r.os || r.codSap || r.cnpj || '',
    _data:     r.dtLanc || r.dtEmissao || r.dtDoc || r.created || '',
    _peso:     r.peso != null && r.peso !== '' ? r.peso : (r.estoqueTotal ?? ''),
    _valor:    r.valorTotal != null && r.valorTotal !== '' ? r.valorTotal : (r.custo ?? ''),
  };
}

// Estado do modal de resultados. `hits` guarda TODAS as ocorrências (sem
// teto); `limite` é só quanto disso já foi pintado na tela — a busca
// devolve tudo, o DOM é que cresce sob demanda (ver gsrMostrarMais).
const _GSR_PAGINA = 300;
const _gsr = {
  termo: '', escopo: 'todos', tokens: [], hits: [],
  view: 'todos', sortCol: null, sortDir: 'asc', refine: '', limite: _GSR_PAGINA,
};

function _gsScopeModKey(scope) {
  return (_GS_SCOPES.find(s => s.scope === scope) || {}).modKey || 'todos';
}

// Placeholder acompanha o módulo escolhido — deixa explícito onde o Enter
// vai buscar, sem precisar olhar o select de novo.
function _gsSyncPlaceholder() {
  const sel   = document.getElementById('global-search-scope');
  const input = document.getElementById('global-search-input');
  if (!sel || !input) return;
  const nome = sel.options[sel.selectedIndex]?.text || 'Todos';
  input.placeholder = `Buscar em ${nome} + Enter…`;
}

function runGlobalSearch() {
  const input = document.getElementById('global-search-input');
  const sel   = document.getElementById('global-search-scope');
  const q     = (input?.value || '').trim();
  if (q.length < 2) { toast('Digite ao menos 2 caracteres para buscar', 'error'); return; }
  _gsrBuscar(q, sel?.value || 'todos');
}

function _gsrBuscar(q, escopo) {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const alvos  = escopo === 'todos' ? _GS_SCOPES : _GS_SCOPES.filter(s => s.scope === escopo);

  // Índice invertido por módulo (lookup.js) — uma string lowercase por
  // registro com todos os campos buscáveis concatenados. Sem teto de
  // resultados: o modal existe justamente para mostrar tudo.
  const hits = [];
  alvos.forEach(({ scope, modKey }) => {
    const records = state[scope] || [];
    if (!records.length) return;
    const index = _getOrBuildIndex(scope, records, getSearchableFields(scope));
    for (let i = 0; i < records.length; i++) {
      const s = index[i] || '';
      if (tokens.every(t => s.includes(t))) hits.push({ modKey, r: records[i], txt: s });
    }
  });

  Object.assign(_gsr, {
    termo: q, escopo, tokens, hits,
    view: escopo === 'todos' ? 'todos' : _gsScopeModKey(escopo),
    sortCol: null, sortDir: 'asc', refine: '', limite: _GSR_PAGINA,
  });

  const overlay = document.getElementById('gsr-overlay');
  const refine  = document.getElementById('gsr-refine');
  if (refine) refine.value = '';
  if (overlay) {
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
  }
  _gsrRender();
}

function closeGlobalResults() {
  const overlay = document.getElementById('gsr-overlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
}

function gsrRefine(v)     { _gsr.refine = v || ''; _gsr.limite = _GSR_PAGINA; _gsrRenderTabela(); }
function gsrSetView(view) { _gsr.view = view; _gsr.sortCol = null; _gsr.limite = _GSR_PAGINA; _gsrRender(); }
function gsrMostrarMais() { _gsr.limite += _GSR_PAGINA; _gsrRenderTabela(); }

function _gsrCols() {
  return _gsr.view === 'todos' ? _GS_COLS_TODOS : (_GS_COLS[_gsr.view] || _GS_COLS_TODOS);
}

function _gsrVal(hit, key) {
  return key.charAt(0) === '_' ? _gsUnificado(hit.modKey, hit.r)[key] : hit.r[key];
}

function _gsrFmt(val, tipo) {
  if (val == null || val === '') return '—';
  const n = num(val);
  if (tipo === 'money') return Number.isFinite(n) ? money(n) : String(val);
  if (tipo === 'num')   return Number.isFinite(n) ? fmtKg(n)  : String(val);
  return String(val);
}

// Cabeçalho + chips por módulo. A tabela em si sai em _gsrRenderTabela,
// que é o que reage a refino/ordenação/"mostrar mais".
function _gsrRender() {
  const titleEl = document.getElementById('gsr-title');
  const modsEl  = document.getElementById('gsr-mods');

  const porMod = new Map();
  _gsr.hits.forEach(h => porMod.set(h.modKey, (porMod.get(h.modKey) || 0) + 1));

  if (titleEl) {
    const escopoNome = _gsr.escopo === 'todos' ? 'todos os módulos' : _gsr.view;
    titleEl.innerHTML = `&ldquo;${escapeHtml(_gsr.termo)}&rdquo; <span style="color:var(--text3);font-weight:500">em ${escapeHtml(escopoNome)}</span>`;
  }

  // Chips só quando há mais de um módulo com resultado — com um só, a
  // barra seria uma linha decorativa sem função.
  if (modsEl) {
    const comHits = _GS_SCOPES.filter(s => porMod.has(s.modKey));
    if (comHits.length > 1) {
      modsEl.style.display = '';
      modsEl.innerHTML = [
        `<button class="pim-month-pill${_gsr.view === 'todos' ? ' active' : ''}" type="button" onclick="gsrSetView('todos')">Todos <b>${_gsr.hits.length}</b></button>`,
        ...comHits.map(({ modKey }) => {
          const cfg = moduleColors[modKey] || {};
          return `<button class="pim-month-pill${_gsr.view === modKey ? ' active' : ''}" type="button" onclick="gsrSetView(&quot;${modKey}&quot;)"><i class="ti ${cfg.icon || 'ti-circle'}" style="font-size:11px"></i> ${escapeHtml(modKey)} <b>${porMod.get(modKey)}</b></button>`;
        }),
      ].join('');
    } else {
      modsEl.style.display = 'none';
      modsEl.innerHTML = '';
    }
  }

  // Cabeçalho da tabela (clicável para ordenar) — refeito a cada troca de
  // visão porque as colunas mudam com o módulo.
  const theadEl = document.getElementById('gsr-thead');
  if (theadEl) {
    theadEl.innerHTML = `<tr>${_gsrCols().map(([rot, key, tipo]) =>
      `<th data-sort-col="${key}" style="text-align:${tipo ? 'right' : 'left'}">${escapeHtml(rot)} <i class="ti ti-selector mod-sort-icon"></i></th>`).join('')}</tr>`;
    // Atribuição em vez de addEventListener: o modal reabre várias vezes na
    // mesma sessão e o handler tem que ser substituído, não empilhado.
    theadEl.onclick = (ev) => {
      const th = ev.target.closest('th[data-sort-col]');
      if (!th || !theadEl.contains(th)) return;
      const col = th.dataset.sortCol;
      if (_gsr.sortCol === col) _gsr.sortDir = _gsr.sortDir === 'asc' ? 'desc' : 'asc';
      else { _gsr.sortCol = col; _gsr.sortDir = 'asc'; }
      _gsrSyncSortHeaders();
      _gsrRenderTabela();
    };
    _gsrSyncSortHeaders();
  }

  _gsrRenderTabela();
}

function _gsrSyncSortHeaders() {
  const theadEl = document.getElementById('gsr-thead');
  if (!theadEl) return;
  theadEl.querySelectorAll('th[data-sort-col]').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sortCol === _gsr.sortCol) th.classList.add(_gsr.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
  });
}

function _gsrLinhas() {
  let base = _gsr.view === 'todos' ? _gsr.hits : _gsr.hits.filter(h => h.modKey === _gsr.view);

  const t = _gsr.refine.trim().toLowerCase();
  if (t) {
    const ws = t.split(/\s+/).filter(Boolean);
    base = base.filter(h => ws.every(w => h.txt.includes(w)));
  }

  if (_gsr.sortCol) {
    const mul = _gsr.sortDir === 'asc' ? 1 : -1;
    const soNumero = v => /^-?[\d.,\s]+$/.test(String(v).trim());
    base = [...base].sort((a, b) => {
      const av = _gsrVal(a, _gsr.sortCol), bv = _gsrVal(b, _gsr.sortCol);
      // Vazio sempre no FIM, nas duas direções — mesmo critério do modal de
      // Movimentações (registro incompleto disputando o topo só atrapalha).
      const aVazio = av == null || av === '', bVazio = bv == null || bv === '';
      if (aVazio || bVazio) return (aVazio && bVazio) ? 0 : (aVazio ? 1 : -1);
      if (soNumero(av) && soNumero(bv)) {
        const an = num(av), bn = num(bv);
        if (Number.isFinite(an) && Number.isFinite(bn)) return (an - bn) * mul;
      }
      return String(av).localeCompare(String(bv), 'pt-BR', { numeric: true, sensitivity: 'base' }) * mul;
    });
  }
  return base;
}

function _gsrRenderTabela() {
  const tbody   = document.getElementById('gsr-tbody');
  const totalEl = document.getElementById('gsr-total');
  const labelEl = document.getElementById('gsr-footer-label');
  const moreEl  = document.getElementById('gsr-more');
  if (!tbody) return;

  const cols    = _gsrCols();
  const linhas  = _gsrLinhas();
  const visivel = linhas.slice(0, _gsr.limite);

  if (!linhas.length) {
    tbody.innerHTML = `<tr><td colspan="${cols.length}">
      <div class="empty-state"><i class="ti ti-search-off"></i>
        <p>Nenhuma ocorrência${_gsr.refine.trim() ? ` para o refino &ldquo;${escapeHtml(_gsr.refine.trim())}&rdquo;` : ''}.</p>
      </div></td></tr>`;
  } else {
    // Guarda os registros visíveis para o clique abrir o detalhe
    // sem serializar o objeto inteiro no atributo onclick.
    window._gsrVisiveis = visivel;
    tbody.innerHTML = visivel.map((h, i) => {
      const tds = cols.map(([, key, tipo]) => {
        const val = _gsrVal(h, key);
        const txt = escapeHtml(_gsrFmt(val, tipo));
        return tipo
          ? `<td class="td-mono" style="text-align:right">${txt}</td>`
          : `<td>${_gsHighlight(txt, _gsr.tokens)}</td>`;
      }).join('');
      return `<tr style="cursor:pointer" onclick="_gsrAbrirDetalhe(${i})">${tds}</tr>`;
    }).join('');
  }

  if (labelEl) labelEl.textContent = linhas.length === 1 ? 'Ocorrência' : 'Ocorrências';
  if (totalEl) {
    totalEl.textContent = visivel.length < linhas.length
      ? `${visivel.length} de ${linhas.length}`
      : String(linhas.length);
  }
  if (moreEl) moreEl.style.display = visivel.length < linhas.length ? '' : 'none';
}

function _gsrAbrirDetalhe(i) {
  const hit = (window._gsrVisiveis || [])[i];
  if (!hit) return;
  // O detalhe é .modal-overlay (z 200) e o de resultados é .bdm-overlay
  // (z 600) — a classe sobe a família do detalhe por cima, mesmo truque já
  // usado pelo modal de Movimentações (ver css/modules.css).
  document.body.classList.add('bdm-modal-acima');
  _gsShowDetail(hit.modKey, hit.r);
}

function _gsCloseDetail() {
  closeModal('modal-search-detail');
  document.body.classList.remove('bdm-modal-acima');
}

function _gsHighlight(text, tokens) {
  let result = text;
  tokens.forEach(t => {
    const re = new RegExp('(' + t.replace(/[.*+?^${}()|\[\]\\]/g, '\\$&') + ')', 'gi');
    result = result.replace(re, '<mark class="search-highlight">$1</mark>');
  });
  return result;
}

function _gsShowDetail(modKey, record) {
  if (!record) return;

  const cfg    = moduleColors[modKey] || {};
  const titleEl = document.getElementById('msd-title');
  const subEl   = document.getElementById('msd-sub');
  const bodyEl  = document.getElementById('msd-body');
  const navBtn  = document.getElementById('msd-nav-btn');
  if (!bodyEl) return;

  // Título com badge do módulo
  if (titleEl) titleEl.innerHTML = `
    <span style="display:inline-flex;align-items:center;gap:8px">
      <span style="background:${cfg.bg||'var(--bg3)'};color:${cfg.color||'var(--text2)'};
        border-radius:5px;padding:2px 10px;font-size:11px;font-weight:700;font-family:var(--mono)">
        <i class="ti ${cfg.icon||'ti-circle'}" style="font-size:10px"></i> ${modKey}
      </span>
      Registro encontrado
    </span>`;

  // Subtítulo
  const label = record.material || record.nf || record.documento || record.arquivo || record.alias || record.origem || '—';
  if (subEl) subEl.textContent = label;

  // Campos a exibir por módulo
  const fieldMap = {
    'Entrada':    [['Central Compra','centralCompra'],['Central Destino','centralDestino'],['NF','nf'],['Fornecedor','fornecedor'],['Categoria','categoria'],['Material','material'],['Peso','peso'],['UM','um'],['Custo Unit.','custo'],['Valor Total','valorTotal'],['Dt. Emissão','dtEmissao'],['Dt. Descarga','dtDescarga']],
    'Saída':      [['Central','central'],['OS','os'],['Categoria','categoria'],['Fornecedor','fornecedor'],['Material','material'],['Peso','peso'],['UM','um'],['Custo Unit.','custo'],['Valor Total','valorTotal'],['Dt. Emissão','dtEmissao']],
    'Lançamento': [['Central','central'],['Dt. Lançamento','dtLanc'],['Fornecedor','fornecedor'],['Categoria','categoria'],['Material','material'],['Peso','peso'],['UM','um'],['Custo Unit.','custo'],['Valor Total','valorTotal']],
    'SAP':        [['Usuário','usuario'],['Movimento','movimento'],['Ref.','ref'],['Pedido','pedido'],['Doc MIGO','documento'],['Central','central'],['Depósito','deposito'],['Material','material'],['Peso','peso'],['UM','um'],['Custo Unit.','custoUnit'],['Valor Total','valorTotal'],['Dt. Doc.','dtDoc'],['Dt. Lançamento','dtLanc'],['Dt. Registro','dtReg']],
    'Custos SAP': [['Material','material'],['Central','central'],['Ano','ano'],['Mês','mes'],['Estoque Total','estoqueTotal'],['Valor Total','valorTotal'],['Custo','custo']],
    'Central':    [['Sigla','alias'],['Nome Original','origem'],['CNPJ','cnpj'],['Regional','regional'],['Cadastrado em','created']],
    'Material':   [['Grupo SAP','alias'],['Cód SAP','codSap'],['Material Original','origem'],['Descrição','desc'],['Cadastrado em','created']],
  };

  const fields = fieldMap[modKey] || Object.keys(record).filter(k => !k.startsWith('_') && k !== 'importId').map(k => [k, k]);

  const _moneyFields = new Set(['custo','custoUnit','valorTotal','precoMedio','custoMedio','totalVendas','margem','valor']);
  const _kgFields    = new Set(['peso']);

  const _fmtVal = (key, val) => {
    const n = typeof val === 'number' ? val : parseFloat(String(val).replace(',','.'));
    if (_moneyFields.has(key) && Number.isFinite(n)) {
      return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (_kgFields.has(key) && Number.isFinite(n)) {
      return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kg';
    }
    return String(val);
  };

  const rows = fields.map(([label, key]) => {
    const val = record[key];
    if (val == null || val === '' || val === '—') return '';
    const isNum = typeof val === 'number' || (typeof val === 'string' && /^[\d.,]+$/.test(val.replace(/\s/g,'')));
    const formatted = _fmtVal(key, val);
    return `
      <div style="display:flex;align-items:baseline;gap:0;padding:6px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:11px;color:var(--text3);min-width:130px;flex-shrink:0">${escapeHtml(label)}</span>
        <span style="font-size:12.5px;color:var(--text);font-family:${isNum ? 'var(--mono)' : 'inherit'};word-break:break-word">${escapeHtml(formatted)}</span>
      </div>`;
  }).filter(Boolean).join('');

  bodyEl.innerHTML = `<div style="display:flex;flex-direction:column">${rows || '<div style="color:var(--text3);font-size:12px">Sem campos para exibir.</div>'}</div>`;

  // Botão de navegação
  if (navBtn && cfg.nav) {
    navBtn.style.display = '';
    const newBtn = navBtn.cloneNode(true);
    navBtn.parentNode.replaceChild(newBtn, navBtn);
    newBtn.addEventListener('click', () => {
      // Ir para a aba fecha os DOIS modais — o detalhe e o de resultados
      // por baixo; ficar com a busca aberta em cima da aba de destino
      // esconderia justamente o que o analista quis olhar.
      _gsCloseDetail();
      closeGlobalResults();
      if (typeof navigate === 'function') navigate(cfg.nav);
    });
  }

  openModal('modal-search-detail');
}

// Atalho de busca (Ctrl+3): leva o foco pro campo da topbar. Com texto
// selecionado na tela, já busca por ele direto — o resultado é o mesmo
// modal do Enter, não existe mais um segundo caminho de busca no sistema.
function openSearchModal(prefill = '') {
  const input = document.getElementById('global-search-input');
  if (!input) return;
  input.focus();
  if (prefill) {
    input.value = prefill;
    runGlobalSearch();
  }
  input.select();
}

Object.assign(window, {
  runGlobalSearch, closeGlobalResults, gsrRefine, gsrSetView, gsrMostrarMais,
  _gsSyncPlaceholder, _gsrAbrirDetalhe, _gsCloseDetail, _gsShowDetail, openSearchModal,
});

// ═══════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════════════════
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Dynamic shortcuts from registry
    if (e.key === 'Escape') {
      // O modal de resultados da busca tem ESC próprio e sai antes dos
      // demais — fechá-lo não deve fechar o que estava aberto por baixo.
      if (document.getElementById('gsr-overlay')?.classList.contains('open')) {
        closeGlobalResults(); return;
      }
      closeBreakdownModal();
      closeAnaliticoDetailModal();
    }

    // Search modal
    const scSearch = getShortcut('search');
    if (scSearch && _shortcutMatch(e, scSearch)) {
      e.preventDefault();
      const selected = window.getSelection()?.toString().trim() || '';
      openSearchModal(selected);
      return;
    }

    // Nav up/down
    const scNavUp   = getShortcut('nav_up');
    const scNavDown = getShortcut('nav_down');
    const isNavUp   = scNavUp   && _shortcutMatch(e, scNavUp);
    const isNavDown = scNavDown && _shortcutMatch(e, scNavDown);
    if (isNavUp || isNavDown) {
      if (document.getElementById('gsr-overlay')?.classList.contains('open')) return;
      e.preventDefault();
      const pages  = ['dashboard','analitico','entradas','saidas','lancamentos','sap','custosSap','ocorrencias','importar','configuracoes'];
      const current = document.querySelector('.page.active')?.id?.replace('page-','') || pages[0];
      const idx     = pages.indexOf(current);
      const next    = isNavDown
        ? pages[Math.min(idx + 1, pages.length - 1)]
        : pages[Math.max(idx - 1, 0)];
      if (next !== current) navigate(next);
      return;
    }

    // Calculator
    const scCalc = getShortcut('calc');
    if (scCalc && _shortcutMatch(e, scCalc)) {
      e.preventDefault(); toggleCalc(); return;
    }

    // Notes
    const scNotes = getShortcut('notes');
    if (scNotes && _shortcutMatch(e, scNotes)) {
      e.preventDefault();
      if (_openTools.has('notes')) closeTool('notes');
      else openTool('notes');
      return;
    }

    // Mensagens
    const scMensagens = getShortcut('mensagens');
    if (scMensagens && _shortcutMatch(e, scMensagens)) {
      e.preventDefault();
      if (_openTools.has('mensagens')) closeTool('mensagens');
      else openTool('mensagens');
      return;
    }

    // Novo Registro Manual
    const scNovoReg = getShortcut('novo_reg');
    if (scNovoReg && _shortcutMatch(e, scNovoReg)) {
      e.preventDefault();
      if (typeof openModal === 'function') openModal('modal-manual');
      return;
    }

    // Nova Ocorrência
    const scNovaOc = getShortcut('nova_oc');
    if (scNovaOc && _shortcutMatch(e, scNovaOc)) {
      e.preventDefault();
      if (typeof openOcorrenciaModal === 'function') openOcorrenciaModal();
      return;
    }
  });

}

// IDs de modais que já têm tratamento de ESC próprio e dedicado em
// outro ponto do sistema (com limpeza de estado extra além de só
// remover a classe 'open') — evitamos tratá-los de novo aqui para
// não duplicar lógica.
const _MODAL_ESC_JA_TRATADO = new Set([
  'analitico-detail-overlay', // fechado via closeAnaliticoDetailModal() no listener de Escape logo abaixo
]);

// Fecha modais (.modal-overlay) apenas via ESC — clique fora foi
// removido propositalmente em todo o sistema; cada modal só fecha
// pelo seu próprio botão (×/Cancelar/Fechar) ou pressionando ESC.
function setupModalCloseOnEscape() {
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const abertos = qsa('.modal-overlay.open').filter(m => !_MODAL_ESC_JA_TRATADO.has(m.id));
    if (!abertos.length) return;
    // Se houver mais de um aberto (empilhado), fecha o de maior z-index (o "de cima")
    let top = abertos[0], topZ = -Infinity;
    abertos.forEach(m => {
      const z = parseFloat(getComputedStyle(m).zIndex) || 0;
      if (z >= topZ) { topZ = z; top = m; }
    });
    top.classList.remove('open');
    // O detalhe da busca pode ter sido aberto POR CIMA do modal de
    // resultados (.bdm-overlay) — desfaz a elevação ao sair pelo ESC,
    // senão a classe fica grudada no body e eleva modais alheios.
    if (top.id === 'modal-search-detail') document.body.classList.remove('bdm-modal-acima');
  });
}

// BUG CORRIGIDO: init() podia rodar DUAS VEZES na mesma aba sempre que a
// sessão já existia no carregamento da página. Isso acontecia porque
// auth.js assina onAuthStateChange logo no DOMContentLoaded, e essa
// assinatura dispara automaticamente um evento inicial (INITIAL_SESSION)
// com a sessão atual — chamando bootApp() → window.init(). Em paralelo, o
// próprio `document.addEventListener('DOMContentLoaded', init)' abaixo
// também chama init() diretamente, que por sua vez chama ensureSession() →
// bootApp() → window.init() de novo. O `appBooted` em auth.js impede que
// bootApp() faça seu próprio setup duas vezes, mas NÃO impede que
// window.init() seja disparado duas vezes a partir desses dois caminhos —
// resultando em todo o boot (restoreAndRender, listeners, etc.) rodando
// duas vezes na mesma aba.
// Correção: trava simples de idempotência — a partir daqui, o boot
// completo só executa uma vez por aba, não importa quantas vezes init()
// seja chamado.
let _appBootExecuted = false;

async function init() {
  // Fase 1 — Autenticação: só prossegue com sessão válida. Sem sessão,
  // AuthGate mostra a tela de login e devolve null aqui — o próprio submit
  // do formulário de login rechama init() depois de autenticar (ver
  // js/auth.js). Cadastro de usuário é feito só pelo ADM, fora do app.
  if (typeof window.AuthGate !== 'undefined') {
    const session = await window.AuthGate.ensureSession();
    if (!session) return;
  }

  // Ver comentário acima de _appBootExecuted: impede o boot duplicado.
  if (_appBootExecuted) return;
  _appBootExecuted = true;

  applyTheme(getSavedTheme());
  setTimeout(updateToolsTheme, 0); // sync theme buttons in dropdown
  restoreSidebarState();
  setupModalCloseOnEscape();
  setupKeyboardShortcuts();
  initDropZones();

  await restoreAndRender();
  updateImportPrereqUI();
  // updateDashboard já foi chamado dentro de restoreAndRender — não chamar novamente

  // Start clock
  updateClock();
  setInterval(updateClock, 30000); // 30s para alertas mais responsivos

  // Theme switcher moved into Ferramentas dropdown (no separate close handler needed)

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (document.getElementById('pim-overlay')?.classList.contains('open')) {
        closePendIntegModal();
        return;
      }
      if (document.getElementById('lrc-overlay')?.classList.contains('open')) {
        closeLancConflictModal();
        return;
      }
      if (document.getElementById('breakdown-modal-overlay')?.classList.contains('open')) {
        closeBreakdownModal();
        return;
      }
      closeAnaliticoDetailModal();
    }
  });
}

document.addEventListener('DOMContentLoaded', init);

// Função auxiliar: retorna o índice de saídas por central (lazy-built)
function getSaidasIndex() {
  ensureSaidasIndex();
  return { byCentral: _saidasByCentral };
}

// Expõe helpers internos para módulos externos (ex: Inventário)
window._inv_helpers = {
  getLancIndex,
  getSapIndex,
  getSaidasIndex,
  getPrePeriodLaunchStock,
  getLastPeriodLaunchStock,
  // Est. Final com fallback retroativo (recua dia a dia dentro do período
  // até achar lançamento) — mesma função usada pela Visão Micro. Agora
  // também usada pelo Inventário (ver window.invGerar em inventario.js).
  getLastPeriodLaunchStockWithFallback,
  getNearestLancsForAbsent,
  getFilialLookupIndex,
  normalizeText,
  parseDate,
  localISODate,
  dateCmp,
  num,
  state: () => state,

  // Funções de formatação e UI partilhadas com o módulo Inventário
  fmtKg,
  varClass,
  varSymbol,
  money,
  escapeHtml,
  buildAnaliticoDetailBreakdown,

  // Fonte única de verdade para categoria/classificação de material —
  // busca sempre no cadastro atual de Materiais (normalize.js), nunca em
  // registro bruto nem por heurística de nome. getCatKeyDoCadastro retorna
  // null quando o material não está cadastrado (ou cadastrado sem
  // categoria) — call sites devem tratar isso como "sem cadastro" visível,
  // nunca como uma categoria padrão silenciosa.
  getCategoriaPorGrupo,
  getCatKeyDoCadastro,
  getCodSapPorGrupo,
  getCustoMedioCustosSap,
  buildCustosSapIndex,

  // Ajustes de Fechamento Mensal (Y11/Y12) — detecção/exclusão do cálculo
  // de variação (ver ui.js). Expostos aqui para o Inventário poder filtrar
  // seus próprios agrupamentos de SAP por central/material da mesma forma
  // que Analítico/Dashboard Gerencial/Trend, e montar o badge por linha.
  isSapExcluidoPorFechamento,
  somarPesoCustoSap,
};
// Subtítulo dos cards do modal de detalhe: "N códigos · 101, 862, ...".
// Recebe as entries já no formato do toEntry (cod na posição 0).
function _codsLabel(entries, vazio) {
  const uCods = [...new Set((entries || []).map(([cod]) => cod))];
  if (!uCods.length) return vazio;
  return `${uCods.length} código${uCods.length !== 1 ? 's' : ''} · ${uCods.join(', ')}`;
}

// Monta o texto do tooltip para badges AUSENTE na tabela de materiais
function buildAbsentTooltip(nearest) {
  const before = nearest?.before
    ? `Último antes do período: ${nearest.before.dtLabel} — ${fmtKg(nearest.before.value)}`
    : `Último antes do período: não encontrado`;
  const after = nearest?.after
    ? `Primeiro no período: ${nearest.after.dtLabel} — ${fmtKg(nearest.after.value)}`
    : `Primeiro no período: não encontrado`;
  return `${before}|${after}`;
}


