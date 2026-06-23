function rodarAnalitico() {
  const iniStr = document.getElementById('an-dt-ini')?.value;
  const fimStr = document.getElementById('an-dt-fim')?.value;
  if (!iniStr || !fimStr) return;

  const dtIni = new Date(iniStr + 'T00:00:00');
  const dtFim = new Date(fimStr + 'T23:59:59');
  if (isNaN(dtIni) || isNaN(dtFim) || dtIni > dtFim) {
    toast('Período inválido', 'error');
    return;
  }

  if (typeof showLoadingOverlay === 'function') showLoadingOverlay('Analisando período', 'Processando lançamentos e variações...');
  if (typeof loadingShowSteps === 'function') loadingShowSteps([
    { id: 'an-centrais', icon: 'ti-building-warehouse', label: 'Coletando centrais e materiais' },
    { id: 'an-calc',     icon: 'ti-calculator',         label: 'Calculando variações por central' },
    { id: 'an-saude',    icon: 'ti-heartbeat',           label: 'Calculando saúde e criticidade' },
    { id: 'an-render',   icon: 'ti-layout',              label: 'Renderizando resultados' },
  ]);
  requestAnimationFrame(() => setTimeout(() => _rodarAnaliticoCore(dtIni, dtFim), 0));
}

function _rodarAnaliticoCore(dtIni, dtFim) {

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
    toast('Nenhum dado para o período selecionado', 'error');
    if (typeof hideLoadingOverlay === 'function') hideLoadingOverlay('Sem dados');
    if (typeof loadingHideSteps === 'function') loadingHideSteps();
    return;
  }

  if (typeof _lstepSet === 'function') { _lstepSet('an-centrais', 'done'); _lstepSet('an-calc', 'running'); _lbarSet(30); }

  // ── Per-central analysis ──────────────────────────────────
  const results = [];

  allCentrals.forEach(central => {

    // ── Lançamentos desta central dentro do período — via índice ──
    const lancsNoPeriodo = getLancsByCentralInPeriod(central, dtIni, dtFim)
      .slice() // não muta o array do índice
      .sort((a, b) => {
        const da = parseDate(a.dtLanc), db = parseDate(b.dtLanc);
        return dateCmp(da ?? new Date(0), db ?? new Date(0));
      });

    // ── SAP desta central dentro do período — via índice ──
    const sapNoPeriodo = getSapByCentralInPeriod(central, dtIni, dtFim);

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
    const _prePeriodoStockByMat = {};
    allMats.forEach(mat => {
      const prev = getPrePeriodLaunchStock({ central, material: mat, dtIni, dtFim });
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

    // ── Produção do período (match por mês dentro do range) ──
    // Filtra apenas os registros desta central (produção é pequena, sem índice dedicado)
    const prodNoPeriodo = state.producao.filter(r => {
      if (r.central !== central) return false;
      const mesMatch = r.mes ? parseMes(r.mes) : null;
      if (!mesMatch) return false;
      const firstDay = new Date(mesMatch.y, mesMatch.m - 1, 1);
      const lastDay  = new Date(mesMatch.y, mesMatch.m, 0);
      return firstDay <= dtFim && lastDay >= dtIni;
    });

    // ── Saídas (módulo Saídas) desta central no período ──
    // Custo médio ponderado por material: R$/kg → usado no badge de custo da variação
    // Usa índice de saídas pré-computado se disponível, senão linear (saídas é menor)
    const _saidasIdx = _saidasByCentral.size > 0 ? _saidasByCentral : null;
    const saidasNoPeriodo = _saidasIdx
      ? (_saidasIdx.get(central) || []).filter(s => {
          const d = parseDate(s.dtEmissao);
          return d && d >= dtIni && d <= dtFim;
        })
      : state.saidas.filter(s => s.central === central && inPeriod(s.dtEmissao));
    const _custoPorMat = {};
    const _pesoPorMat  = {};
    saidasNoPeriodo.forEach(s => {
      const mat = s.material || '—';
      _custoPorMat[mat] = (_custoPorMat[mat] || 0) + num(s.valorTotal);
      _pesoPorMat[mat]  = (_pesoPorMat[mat]  || 0) + Math.abs(num(s.peso));
    });
    const custoMedioPorMat      = {};
    const custoMedioFontePorMat  = {};  // 'saidas' | 'lancamentos' | 'sap'

    // ── 1ª prioridade: Módulo Saídas ──────────────────────────────────
    Object.keys(_custoPorMat).forEach(mat => {
      if (_pesoPorMat[mat] > 0 && _custoPorMat[mat] > 0) {
        custoMedioPorMat[mat]      = _custoPorMat[mat] / _pesoPorMat[mat];
        custoMedioFontePorMat[mat] = 'saidas';
      }
    });

    // ── 2ª prioridade: Módulo Lançamentos ─────────────────────────────
    // Lançamentos da central no período com campo custo preenchido
    const lancsNoPeriodoCusto = lancsNoPeriodo.filter(l => {
      const c = num(l.custo); return c > 0;
    });
    const _lCusto = {}, _lPeso = {};
    lancsNoPeriodoCusto.forEach(l => {
      const mat = l.material || '—';
      const p   = Math.abs(num(l.peso));
      const vt  = num(l.valorTotal);
      const c   = num(l.custo);
      const valor = vt > 0 ? vt : c * p;
      if (!valor || !p) return;
      _lCusto[mat] = (_lCusto[mat] || 0) + valor;
      _lPeso[mat]  = (_lPeso[mat]  || 0) + p;
    });
    Object.keys(_lCusto).forEach(mat => {
      if (custoMedioPorMat[mat]) return;  // já tem pelas Saídas
      if (_lPeso[mat] > 0 && _lCusto[mat] > 0) {
        custoMedioPorMat[mat]      = _lCusto[mat] / _lPeso[mat];
        custoMedioFontePorMat[mat] = 'lancamentos';
      }
    });

    // ── 3ª prioridade: SAP ─────────────────────────────────────────────
    sapNoPeriodo.forEach(s => {
      const mat = s.material || '—';
      if (custoMedioPorMat[mat]) return;  // já tem pelas Saídas ou Lançamentos
      const p  = Math.abs(num(s.peso));
      if (!p) return;
      const vt = num(s.valorTotal);
      const cu = num(s.custoUnit);
      const valor = vt !== 0 ? Math.abs(vt) : (cu !== 0 ? Math.abs(cu) * p : 0);
      if (!valor) return;
      const key = '_sap_' + mat;
      if (!_custoPorMat[key]) { _custoPorMat[key] = 0; _pesoPorMat[key] = 0; }
      _custoPorMat[key] += valor;
      _pesoPorMat[key]  += p;
    });
    Object.keys(_custoPorMat).forEach(key => {
      if (!key.startsWith('_sap_')) return;
      const mat = key.slice(5);
      if (custoMedioPorMat[mat]) return;
      if (_pesoPorMat[key] > 0 && _custoPorMat[key] > 0) {
        custoMedioPorMat[mat]      = _custoPorMat[key] / _pesoPorMat[key];
        custoMedioFontePorMat[mat] = 'sap';
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
      prodNoPeriodo,
      custoMedioPorMat,
      custoMedioFontePorMat
    });
  });

  // Sort by central name
  results.sort((a, b) => String(a.central).localeCompare(String(b.central), 'pt-BR'));

  renderAnaliticoMicro(results, dtIni, dtFim);

  document.getElementById('an-empty').style.display = 'none';
  document.getElementById('an-content').style.display = '';
  if (window.updatePeriodFab) updatePeriodFab();
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



function renderAnaliticoMicro(results, dtIni, dtFim) {
  const container = document.getElementById('an-micro-container');
  if (!container) return;
  container.innerHTML = '';
  window.__analiticoDetailCache = new Map();

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
      const prev = getPrePeriodLaunchStock({ central: r.central, material: mat, dtIni, dtFim });
      return acc + buildSnapshot({
        lancs: lancsByMat.get(mat) || [],
        sap:   sapByMat.get(mat)   || [],
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

  results.forEach((r, idx) => {
    const prodHtml = r.prodNoPeriodo.length
      ? r.prodNoPeriodo.map(p => `
          <span class="prod-badge">
            <i class="ti ti-building-factory"></i>
            ${p.mes} · ${fmtKg(p.producao, 2)} m³ ·
            Preço Médio: ${money(p.precoMedio)} ·
            Custo Médio: ${money(p.custoMedio)} ·
            Faturamento: ${money(p.totalVendas)}
          </span>`).join('')
      : `<span class="prod-badge" style="color:var(--text3);background:var(--bg3)">
           <i class="ti ti-info-circle"></i> Sem produção no período
         </span>`;

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

    let matRowsHtml = '';
    let variacaoCentralMicro = 0;
    let custoVariacaoTotal = 0;  // R$ implicados pela variação de estoque

    // Ordena materiais: maior desfalque (diff mais negativo) → maior sobra (diff mais positivo)
    const allMatsSorted = [...r.allMats].sort((a, b) => {
      const prevA = getPrePeriodLaunchStock({ central: r.central, material: a, dtIni, dtFim });
      const prevB = getPrePeriodLaunchStock({ central: r.central, material: b, dtIni, dtFim });
      const diffA = buildSnapshot({ lancs: lancsByMat.get(a) || [], sap: sapByMat.get(a) || [], initialStockOverride: prevA?.value ?? null }).diff;
      const diffB = buildSnapshot({ lancs: lancsByMat.get(b) || [], sap: sapByMat.get(b) || [], initialStockOverride: prevB?.value ?? null }).diff;
      return diffA - diffB;
    });

    allMatsSorted.forEach((mat, matIdx) => {
      const lancsMat = lancsByMat.get(mat) || [];
      const sapMat = sapByMat.get(mat) || [];
      const prev = getPrePeriodLaunchStock({ central: r.central, material: mat, dtIni, dtFim });
      const fim  = getLastPeriodLaunchStockWithFallback({ central: r.central, material: mat, dtIni, dtFim });
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
      const custoMedMat = (r.custoMedioPorMat || {})[mat] || 0;
      if (custoMedMat > 0) custoVariacaoTotal += snapshot.diff * custoMedMat;

      const dCls = varClass(snapshot.diff);
              const toEntry = s => {
        const ref = (s.ref && String(s.ref).trim()) ? String(s.ref).trim()
                  : (s.documento && String(s.documento).trim()) ? String(s.documento).trim() : '';
        return [normMov(s.movimento), num(s.peso), ref, String(s.usuario || '').trim(), String(s.dtLanc || s.dtDoc || '').trim()];
      };
      const entEntries = snapshot.entRecords.map(toEntry);
      const saiEntries = snapshot.saiRecords.map(toEntry);

      // ── Classificação de categoria do material ──────────────────────────
      // Categorias de lançamento SEMANAL: AGREGADO (toda terça-feira)
      // Usa detectCatKey + detectCatFromMat — mesma lógica do resto do sistema
      const matCategoria = (lancsMat[0]?.categoria || sapMat[0]?.categoria || '').trim().toUpperCase();
      const matCatKey    = detectCatKey(matCategoria) || detectCatFromMat(mat);
      const isSemanal    = matCatKey === 'agregado';

      // ── Est. Inicial do primeiro dia: usa getPrePeriodLaunchStock ────
      // Mesma lógica do card de resumo: prioriza o último dia do mês anterior,
      // sem fallback para dentro do período.
      const preCarry = getPrePeriodLaunchStock({ central: r.central, material: mat, dtIni, dtFim });

      // ── Carry entre períodos (diário ou semanal) ─────────────────────
      // carry.date = data do último lançamento real, usada para delimitar o SAP
      // acumulado desde aquele dia até o próximo lançamento (em vez de janela fixa de 6 dias).
      //   carry = { value, isEstimated, date }
      //   isEstimated = true quando o saldo veio do Est. Teórico (sem lançamento)
      let carry = preCarry
        ? { value: preCarry.value, isEstimated: false, date: new Date(dtIni.getFullYear(), dtIni.getMonth(), 0) }
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
          const ref = (s.ref && String(s.ref).trim()) ? String(s.ref).trim()
                    : (s.documento && String(s.documento).trim()) ? String(s.documento).trim() : '';
          return [normMov(s.movimento), num(s.peso), ref, String(s.usuario || '').trim(), String(s.dtLanc || s.dtDoc || '').trim()];
        };
        const dayEntEntries = daySnap.entRecords.map(toDayEntry);
        const daySaiEntries = daySnap.saiRecords.map(toDayEntry);

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
              totalEnt: daySnap.totalEnt,
              totalSai: daySnap.totalSai,
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
            totalEnt: daySnap.totalEnt,
            totalSai: daySnap.totalSai,
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
            totalEnt: daySnap.totalEnt,
            totalSai: daySnap.totalSai,
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
        central: r.central,
        material: mat,
        periodLabel: `${fmtPtDate(dtIni)} a ${fmtPtDate(dtFim)}`,
        isSemanal,
        catKey: detectCatKey(matCategoria) || detectCatFromMat(mat),
        summary: {
          pesoIni: snapshot.pesoIni,
          dtIniLabel: snapshot.dtIniLabel,
          totalEnt: snapshot.totalEnt,
          entLabel: (() => { const uCods = [...new Set(entEntries.map(([cod]) => cod))]; return uCods.length ? `${uCods.length} código${uCods.length !== 1 ? 's' : ''} · ${uCods.join(', ')}` : 'Sem entradas no período'; })(),
          totalSai: snapshot.totalSai,
          saiLabel: (() => { const uCods = [...new Set(saiEntries.map(([cod]) => cod))]; return uCods.length ? `${uCods.length} código${uCods.length !== 1 ? 's' : ''} · ${uCods.join(', ')}` : 'Sem saídas no período'; })(),
          estTeorico: snapshot.estTeorico,
          pesoFim: snapshot.pesoFim,
          dtFimLabel: snapshot.dtFimLabel,
          fimFallback: fim?.fallback ?? false,
          diff: snapshot.diff
        },
        days: dailyRows
      });

      const _rowCustoMed   = (r.custoMedioPorMat      || {})[mat] || 0;
      const _rowCustoFonte = (r.custoMedioFontePorMat || {})[mat] || null;
      const _rowCustoVar   = _rowCustoMed > 0 ? snapshot.diff * _rowCustoMed : null;
      const _rowVarCls     = _rowCustoVar === null ? '' : varClass(_rowCustoVar);
      // Tooltip: custo médio + fonte
      const _custoMedLabel  = _rowCustoMed > 0 ? escapeHtml(money(_rowCustoMed) + '/kg') : '—';
      const _custoMedFonte  = _rowCustoFonte === 'saidas' ? 'Módulo Saídas' : _rowCustoFonte === 'lancamentos' ? 'Módulo Lançamentos' : _rowCustoFonte === 'sap' ? 'Fallback SAP' : '—';
      const custoVarCell = _rowCustoVar !== null
        ? `<span
            class="td-mono ${_rowVarCls}"
            style="font-size:11.5px;white-space:nowrap;cursor:default;border-bottom:1px dashed currentColor"
            onmouseenter="showCustoMedTip(event,'${_custoMedLabel}','${escapeHtml(_custoMedFonte)}')"
            onmousemove="moveCustoMedTip(event)"
            onmouseleave="hideCustoMedTip()"
          >${varSymbol(_rowCustoVar)} ${money(Math.abs(_rowCustoVar))}</span>`
        : `<span style="color:var(--text3);font-size:11px">—</span>`;

      matRowsHtml += `
        <tr class="material-row" data-detail-key="${detailKey}" data-diff="${snapshot.diff}" data-peso-fim="${snapshot.pesoFim}" data-categoria="${escapeHtml(matCategoria)}" onclick="toggleMaterialDetail(this, event)">
          <td class="td-mono" style="font-weight:600">
            <span class="material-row-title">
              <i class="ti ti-eye-search material-row-chev"></i>
              ${escapeHtml(mat)}
            </span>
          </td>
          <td class="td-mono" style="color:var(--text2);font-size:11px">${snapshot.pesoIniAusente ? '<span class="absent-badge" title="Sem lançamento no dia anterior ao período">ausente</span>' : snapshot.dtIniLabel}</td>
          <td class="td-mono" style="color:${snapshot.pesoIniAusente ? 'var(--text3)' : 'var(--text)'}">${snapshot.pesoIniAusente ? '—' : fmtKg(snapshot.pesoIni)}</td>
          <td>${buildAnaliticoDetailBreakdown(entEntries, snapshot.totalEnt, 'var(--green)', 'Entradas')}</td>
          <td>${buildAnaliticoDetailBreakdown(saiEntries, snapshot.totalSai, 'var(--red)', 'Saídas')}</td>
          <td class="td-mono" style="color:var(--text2);font-size:11px">${
            snapshot.pesoFimAusente
              ? '<span class="absent-badge" title="Sem lançamento no período">ausente</span>'
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
    const totalMats = allMatsSorted.length;

    // Build categoria lookup for this central
    const categoriaByMat = new Map();
    allMatsSorted.forEach(mat => {
      const lancs = lancsByMat.get(mat) || [];
      const saps  = sapByMat.get(mat) || [];
      const cat = (lancs[0]?.categoria || saps[0]?.categoria || '');
      categoriaByMat.set(mat, cat);
    });

    // Health score + counts for the header badges
    // Usa getLastPeriodLaunchStockWithFallback — mesma lógica do painel interno
    // e da tabela de materiais, para garantir consistência
    const thresholds = getHealthThresholds();
    const matDiffs = allMatsSorted.map(mat => {
      const prev = getPrePeriodLaunchStock({ central: r.central, material: mat, dtIni, dtFim });
      const fim  = getLastPeriodLaunchStockWithFallback({ central: r.central, material: mat, dtIni, dtFim });
      const snap = buildSnapshot({
        lancs: lancsByMat.get(mat) || [],
        sap:   sapByMat.get(mat)   || [],
        initialStockOverride:     prev?.value  ?? null,
        initialDateLabelOverride: prev?.dtLabel ?? null,
        finalStockOverride:       fim && !fim.missing ? fim.value : null,
        finalDateLabelOverride:   fim && !fim.missing ? fim.dtLabel : null
      });
      const rawCat = categoriaByMat.get(mat) || '';
      const catKey = detectCatKey(rawCat) || detectCatFromMat(mat);
      return { mat, diff: snap.diff, catKey };
    });
    const healthResult = calcHealthScore(matDiffs, lancsByMat, sapByMat, thresholds);
    const allNeutral = totalMats > 0 && matDiffs.every(m => Math.abs(m.diff) <= 0.0001);
    const hLevel = (totalMats === 0 || allNeutral) ? 'sem_saude' : healthResult.level;
    const hScore = (totalMats === 0 || allNeutral) ? null        : healthResult.score;
    const hCounts = healthResult.counts || { bom: 0, atencao: 0, urgente: 0, critico: 0, neutro: 0 };
    const hLabelMap  = { ok: 'SAUDÁVEL', atencao: 'ATENÇÃO', urgente: 'URGENTE', critico: 'CRÍTICO', sem_saude: 'SEM SAÚDE' };
    const hIconMap   = { ok: 'ti-heartbeat', atencao: 'ti-alert-triangle', urgente: 'ti-alert-circle', critico: 'ti-flame', sem_saude: 'ti-heart-off' };
    const hStyleMap  = {
      ok:        'background:var(--green-bg);color:var(--green);border:1px solid var(--green-border)',
      atencao:   'background:var(--amber-bg);color:var(--amber);border:1px solid var(--amber-border)',
      urgente:   'background:rgba(249,115,22,0.10);color:#f97316;border:1px solid rgba(249,115,22,0.22)',
      critico:   'background:var(--red-bg);color:var(--red);border:1px solid var(--red-border)',
      sem_saude: 'background:var(--bg3);color:var(--text3);border:1px solid var(--border2)'
    };

    if (totalMats > 0) {
      healthCountsHtml = `<div class="micro-health-counts">
        <span class="micro-health-count-chip hcc-critico"><i class="ti ti-flame"></i> ${hCounts.critico} crítico</span>
        <span class="micro-health-count-chip hcc-urgente"><i class="ti ti-alert-circle"></i> ${hCounts.urgente} urgente</span>
        <span class="micro-health-count-chip hcc-atencao"><i class="ti ti-alert-triangle"></i> ${hCounts.atencao} atenção</span>
        <span class="micro-health-count-chip hcc-bom"><i class="ti ti-circle-check"></i> ${hCounts.bom} bom</span>
      </div>`;
    }

    healthBadge = `<span style="display:inline-flex;align-items:center;gap:5px;${hStyleMap[hLevel]};border-radius:6px;padding:2px 9px;font-family:var(--mono);font-size:10.5px;font-weight:700;white-space:nowrap">
      <i class="ti ${hIconMap[hLevel]}" style="font-size:12px"></i>
      ${hLevel === 'sem_saude' ? 'SEM SAÚDE' : `Saúde: ${hScore}% · ${hLabelMap[hLevel]}`}
    </span>`;

    if (totalMats >= 5) {
      divPanelHtml = buildHealthPanel(r.central, dtIni, allMatsSorted, lancsByMat, sapByMat, categoriaByMat, dtFim);
    }

    const card = document.createElement('div');
    card.className = 'micro-filial-card';
    card.dataset.central = r.central || '';
    card.dataset.centralDiff = varCentralMicro;
    card.dataset.diff = varCentralMicro;   // for tipo-var filter
    card.dataset.custoVariacao = custoVariacaoTotal;
    card.dataset.healthLevel = healthBadge ? (hLevel === 'sem_saude' ? 'none' : hLevel) : 'none';
    card.dataset.healthScore = healthBadge && hScore !== null ? hScore : '';
    // ── Badge de custo da variação ──────────────────────────────────────────
    let custoBadge = '';
    if (custoVariacaoTotal !== 0) {
      const hasCustos = Object.keys(r.custoMedioPorMat || {}).length > 0;
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
      <div class="micro-filial-header" onclick="toggleMicro(this)">
        <div class="micro-filial-name">
          <i class="ti ti-building-warehouse"></i>
          ${escapeHtml(r.central)}
        </div>
        <div class="micro-filial-summary">
          <span class="${varCls}">
            ${varIcon(varCentralMicro)} ${varLabel(varCentralMicro)}: ${fmtKg(Math.abs(varCentralMicro))}
          </span>
          ${custoBadge}
          ${prodBadge}
          ${healthCountsHtml}
          ${healthBadge}
        </div>
        <button class="trend-btn" onclick="event.stopPropagation();openTrendModal('central','${escapeHtml(r.central)}')" title="Ver tendência de variação">
          <i class="ti ti-chart-line"></i>
        </button>
        <button class="trend-btn" onclick="event.stopPropagation();abrirModalRelatorioCentral('${escapeHtml(r.central)}')" title="Gerar relatório desta central" style="background:linear-gradient(135deg,rgba(29,78,216,0.18),rgba(37,99,235,0.12));border:1px solid rgba(37,99,235,0.3);color:#60a5fa">
          <i class="ti ti-file-analytics"></i>
        </button>
        <i class="ti ti-chevron-down" style="color:var(--text3);font-size:16px;flex-shrink:0;transition:transform 0.2s" id="chev-${idx}"></i>
      </div>

      <div class="micro-filial-body" id="micro-body-${idx}">
        ${divPanelHtml}

        ${buildPendIntegSection({ central: r.central, dtIni, dtFim, sapNoPeriodo: r.sapNoPeriodo || [] })}

        <div class="micro-body-section">
          <div class="micro-section-title"><i class="ti ti-box"></i> Análise por Material</div>
        </div>

        <div class="micro-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Material</th>
                <th>Dt. 1º Lançamento</th>
                <th>Est. Inicial<br><span style="font-size:9px;font-weight:400;opacity:.7">(1º Lançamento)</span></th>
                <th>Entradas<br><span style="font-size:9px;font-weight:400;opacity:.7">(por código)</span></th>
                <th>Saídas<br><span style="font-size:9px;font-weight:400;opacity:.7">(por código)</span></th>
                <th>Dt. Últ. Lançamento</th>
                <th>Est. Final<br><span style="font-size:9px;font-weight:400;opacity:.7">(Últ. Lançamento)</span></th>
                <th>Est. Teórico<br><span style="font-size:9px;font-weight:400;opacity:.7">(Ini+Ent+Sai)</span></th>
                <th>Variação<br><span style="font-size:9px;font-weight:400;opacity:.7">(Real − Teórico)</span></th>
                <th style="text-align:right">Custo Variação<br><span style="font-size:9px;font-weight:400;opacity:.7">(Var. × C. Médio)</span></th>
              </tr>
            </thead>
            <tbody>${matRowsHtml || '<tr><td colspan="10"><div class="empty-state" style="padding:24px"><i class="ti ti-box-off"></i><p>Nenhum material encontrado.</p></div></td></tr>'}</tbody>
          </table>
        </div>
      </div>`;

    // Lookup regional for this central
    const filialIdx = getFilialLookupIndex();
    const filialRec = filialIdx.exact.get(normalizeText(r.central));
    card.dataset.regional = (filialRec?.regional || '').trim();

    card.querySelectorAll('.micro-table-wrap table').forEach(makeResizable);

    // Store card for grouping below
    _cardBuffer.push(card);
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

    // ── Aggregate data from all cards in the group ──────────────────────────
    let totalDiff = 0;
    let totalCusto = 0;
    const agg = { critico: 0, urgente: 0, atencao: 0, bom: 0 };
    const levelPriority = { critico: 4, urgente: 3, atencao: 2, ok: 1, none: 0 };
    let scoreSum = 0, scoreCount = 0;

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
    const diffBadge = `<span class="${diffCls}" style="display:inline-flex;align-items:center;gap:4px;font-family:var(--mono);font-size:10.5px;font-weight:700;white-space:nowrap">
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
      agg.critico ? `<span class="micro-health-count-chip hcc-critico"><i class="ti ti-flame"></i> ${agg.critico} crítico</span>` : '',
      agg.urgente ? `<span class="micro-health-count-chip hcc-urgente"><i class="ti ti-alert-circle"></i> ${agg.urgente} urgente</span>` : '',
      agg.atencao ? `<span class="micro-health-count-chip hcc-atencao"><i class="ti ti-alert-triangle"></i> ${agg.atencao} atenção</span>` : '',
      agg.bom     ? `<span class="micro-health-count-chip hcc-bom"><i class="ti ti-circle-check"></i> ${agg.bom} bom</span>` : '',
    ].filter(Boolean).join('');

    // ── Dominant health badge ────────────────────────────────────────────────
    const hStyleMap = {
      ok:      'background:var(--green-bg);color:var(--green);border:1px solid var(--green-border)',
      atencao: 'background:var(--amber-bg);color:var(--amber);border:1px solid var(--amber-border)',
      urgente: 'background:rgba(249,115,22,0.10);color:#f97316;border:1px solid rgba(249,115,22,0.22)',
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

    const isSemRegional = !regional;
    const group = document.createElement('div');
    group.className = 'regional-group' + (isSemRegional ? ' sem-regional' : '');
    group.dataset.regional = regional;
    group.innerHTML = `
      <div class="regional-group-header" onclick="toggleRegional(this)">
        <div class="regional-group-icon"><i class="ti ${isSemRegional ? 'ti-map-pin-off' : 'ti-users-group'}"></i></div>
        <span class="regional-group-name">${isSemRegional ? 'Sem regional' : escapeHtml(regional)}</span>
        <div class="regional-group-summary">
          ${diffBadge}
          ${custoBadgeGrp}
          <span class="regional-group-chips">${aggChips}</span>
          ${healthBadgeGrp}
        </div>
        <span class="regional-group-count">${cards.length} ${cards.length !== 1 ? 'centrais' : 'central'}</span>
        <button class="trend-btn" onclick="event.stopPropagation();openTrendModal('regional','${escapeHtml(regional || '')}')" title="Ver tendência de variação">
          <i class="ti ti-chart-line"></i>
        </button>
        ${!isSemRegional ? `<button class="trend-btn" onclick="event.stopPropagation();gerarRelatorioRegional('${escapeHtml(regional || '')}')" title="Gerar relatório deste regional" style="background:linear-gradient(135deg,rgba(29,78,216,0.18),rgba(37,99,235,0.12));border:1px solid rgba(37,99,235,0.3);color:#60a5fa">
          <i class="ti ti-file-analytics"></i>
        </button>` : ''}
        <i class="ti ti-chevron-down regional-group-chev" id="rchev-${encodeURIComponent(regional || '_sem')}"></i>
      </div>
      <div class="regional-group-body open"></div>`;

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


  // Populate filter dropdowns with available centrais e materiais
  populateMicroFilterOptions(results);
  // Reset applied filters whenever a new analysis runs
  if (typeof _lstepSet === 'function') { _lstepSet('an-calc', 'done'); _lstepSet('an-saude', 'running'); _lbarSet(65); }

  clearAllMicroFilters();
  if (typeof initHelpBadges === 'function') initHelpBadges();

  // Renderiza painéis Macro (crank + donut) — macro.js
  if (typeof renderMacroPanels === 'function') {
    const th = typeof getHealthThresholds === 'function' ? getHealthThresholds() : {};
    renderMacroPanels(results, th, dtIni, dtFim);
  }

  if (typeof _lstepSet === 'function') { _lstepSet('an-saude', 'done'); _lstepSet('an-render', 'running'); _lbarSet(85); }

  if (typeof hideLoadingOverlay === 'function') hideLoadingOverlay('Análise concluída');
  if (typeof loadingHideSteps === 'function') loadingHideSteps();
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

  // Fixa a altura mínima do container no estado sem filtro
  container.style.minHeight = '';
  requestAnimationFrame(() => {
    container.style.minHeight = container.offsetHeight + 'px';
  });
}  // end _rodarAnaliticoCore




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


function toggleMicro(header) {
  const body = header.nextElementSibling;
  const chev = header.querySelector('[id^="chev-"]');
  if (!body) return;
  const open = body.classList.toggle('open');
  if (chev) chev.style.transform = open ? 'rotate(180deg)' : '';
}

function toggleRegional(header) {
  const group = header.closest('.regional-group');
  const body  = group.querySelector('.regional-group-body');
  const chev  = header.querySelector('.regional-group-chev');
  if (!body) return;
  const open = body.classList.toggle('open');
  group.classList.toggle('collapsed', !open);
  if (chev) chev.style.transform = open ? '' : 'rotate(-90deg)';
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

function _microFilterBar() { return document.getElementById('micro-filter-bar'); }

/** Populate filter options from the rendered results data */
function populateMicroFilterOptions(results) {
  const centrais = [...new Set(results.map(r => r.central).filter(Boolean))].sort();
  const mats = [...new Set(results.flatMap(r => r.allMats || []).filter(Boolean))].sort();
  // Regionais: lookup each central in state.filiais by alias or origem
  const idx = getFilialLookupIndex();
  const regionais = [...new Set(results.map(r => {
    const key = normalizeText(r.central);
    const found = idx.exact.get(key);
    return (found?.regional || '').trim();
  }).filter(Boolean))].sort();
  // Categorias: extract from lancamentos and sap records
  const categorias = [...new Set(results.flatMap(r => [
    ...(r.lancsNoPeriodo || []).map(l => (l.categoria || '').trim().toUpperCase()),
    ...(r.sapNoPeriodo   || []).map(s => (s.categoria || '').trim().toUpperCase()),
  ]).filter(Boolean))].sort();
  _microFilter.options.central   = centrais;
  _microFilter.options.material  = mats;
  _microFilter.options.regional  = regionais;
  _microFilter.options.categoria = categorias;
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
  const allKeys = ['regional', 'central', 'categoria', 'material', 'variacao', 'tipo-var'];
  // Close all other dropdowns first
  allKeys.filter(k => k !== key).forEach(otherKey => {
    const otherDd = document.getElementById(`mfd-${otherKey}`);
    const otherChev = document.getElementById(`mfc-${otherKey}`);
    if (otherDd?.classList.contains('open')) {
      otherDd.classList.remove('open');
      otherChev?.classList.remove('open');
      if (otherKey === 'variacao') {
        _varFilter.pending.levels = new Set(_varFilter.applied.levels);
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
    } else {
      _microFilter.pending[key] = new Set(_microFilter.applied[key]);
      // Reset search
      const searchEl = document.getElementById(`mfs-${key}`);
      if (searchEl) searchEl.value = '';
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
  const keyLabels = { regional: 'Regional', central: 'Central', categoria: 'Categoria', material: 'Material', variacao: 'Saúde' };
  const keyLabel = keyLabels[key] || key;

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
  const hasAny = _microFilter.applied.regional.size || _microFilter.applied.central.size || _microFilter.applied.categoria.size || _microFilter.applied.material.size || _varFilterIsActive(_varFilter.applied) || _tipoVarIsActive();
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
  _syncTriggerLabel('regional');
  _syncTriggerLabel('central');
  _syncTriggerLabel('categoria');
  _syncTriggerLabel('material');
  _syncTriggerLabel('variacao');
  _syncClearBtn();
  _tipoVarFilter.applied      = new Set();
  _tipoVarFilter.pending      = new Set();
  _tipoVarFilter.nivelApplied = new Set(['regional','central','material']);
  _tipoVarFilter.nivelPending = new Set(['regional','central','material']);
  _tipoVarSyncToState(new Set());
  _tipoVarSyncNivelToState(new Set(['regional','central','material']));
  _tipoVarUpdateTrigger();
  _applyMicroVisibility();
  // Ao limpar filtros, remove min-height para o container voltar à altura natural
  const container = document.getElementById('an-micro-container');
  if (container) container.style.minHeight = '';
}

// ── Saúde filter state (replaces old variação % filter) ──
const _varFilter = {
  pending:  { levels: new Set() },
  applied:  { levels: new Set() },
};

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
}

function _updateToggleCentralisBtn() {
  const chev = document.getElementById('chev-toggle-centrais');
  const btn  = document.getElementById('btn-toggle-centrais');
  const lbl  = document.getElementById('label-toggle-centrais');
  if (chev) chev.style.transform = _centraisExpanded ? '' : 'rotate(-90deg)';
  if (btn)  btn.classList.toggle('active', !_centraisExpanded);
  if (lbl)  lbl.textContent = _centraisExpanded ? 'Recolher Centrais' : 'Expandir Centrais';
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
  _buildVariacaoOptions, _varFilterChange, _tipoVarChange, _tipoVarSyncToState, _tipoVarIsActive });

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
  salvarProducao,
  salvarConfig,
  salvarFiliais,
  salvarMateriais,
  renderConfigs,
  renderFiliais,
  renderMateriais,
  renderImports,
  excluirImportacao,
  excluirProducao,
  removerConfig,
  editConfig,
  deleteConfig,
  saveResponsavel,
  updateParamGerais,
  applyColFilter,
  clearColFilter,
  clearAllColFilters,
  filtrarTabela,
  filtrarProducao,
  filtrarLista,
  irParaPagina,
  paginaAnterior,
  proximaPagina,
  irParaUltima,
  primeiraPaginaProducao,
  paginaAnteriorProducao,
  proximaPaginaProducao,
  ultimaPaginaProducao,
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
// ── Próxima terça de conferência ─────────────────────────────────────────
function _nextTuesday() {
  const now = new Date();
  const dow = now.getDay(); // 0=dom ... 2=ter ... 6=sab
  const daysUntil = dow === 2 ? 7 : (2 - dow + 7) % 7;
  const next = new Date(now);
  next.setDate(now.getDate() + daysUntil);
  next.setHours(0, 0, 0, 0);
  return next;
}

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
  'Produção':   { bg: 'var(--purple-bg)',  color: 'var(--purple)', icon: 'ti-chart-bar',      nav: 'producao'   },
  'Central':    { bg: 'var(--teal-bg)',    color: 'var(--teal)',   icon: 'ti-building-warehouse', nav: 'filiais'},
  'Material':   { bg: 'var(--bg3)',        color: 'var(--text2)',  icon: 'ti-box',            nav: 'materiais'  },
};

// Debounce para não buscar a cada tecla
let _gsTimer = null;

function handleGlobalSearch(query) {
  clearTimeout(_gsTimer);
  const dropdown = document.getElementById('global-search-dropdown');
  if (!dropdown) return;
  const q = query.trim();
  if (!q || q.length < 2) { dropdown.classList.remove('open'); return; }

  // Mostrar spinner imediatamente
  dropdown.innerHTML = `<div class="search-no-results"><i class="ti ti-loader" style="margin-right:6px"></i>Buscando...</div>`;
  dropdown.classList.add('open');

  _gsTimer = setTimeout(() => _runGlobalSearch(q, dropdown), 120);
}

function _runGlobalSearch(q, dropdown) {
  const ql = q.toLowerCase();
  const tokens = ql.split(/\s+/).filter(Boolean);

  // Agrupa resultados por módulo: { label, sub, secondary, navKey, modKey }
  const groups = {};
  const addGroup = (modKey, label, sub, record=null) => {
    if (!groups[modKey]) groups[modKey] = { items: [], modKey };
    if (groups[modKey].items.length < 5) {
      const idx = groups[modKey].items.length;
      if (!window._gsRecords) window._gsRecords = {};
      const key = modKey + '_' + Object.keys(groups).length + '_' + idx;
      window._gsRecords[key] = record;
      groups[modKey].items.push({ label, sub, recordKey: key });
    }
  };

  // ── Usa índice invertido para módulos com muitos registros ──────────
  const searchMod = (scope, modKey, getLabel, getSub) => {
    const records = state[scope] || [];
    if (!records.length) return;
    const fields  = getSearchableFields(scope);
    const index   = _getOrBuildIndex(scope, records, fields);
    for (let i = 0; i < index.length; i++) {
      const s = index[i];
      if (tokens.every(t => s.includes(t))) {
        addGroup(modKey, getLabel(records[i]), getSub(records[i]), records[i]);
        if ((groups[modKey]?.items.length || 0) >= 5) break;
      }
    }
  };

  searchMod('entradas',    'Entrada',    r => r.material || r.nf || '—',       r => [r.centralCompra, r.dtEmissao].filter(Boolean).join(' · '));
  searchMod('saidas',      'Saída',      r => r.material || r.os || '—',       r => [r.central, r.dtEmissao].filter(Boolean).join(' · '));
  searchMod('lancamentos', 'Lançamento', r => r.material || '—',               r => [r.central, r.dtLanc].filter(Boolean).join(' · '));
  searchMod('sap',         'SAP',        r => r.material || r.documento || '—',r => [r.central, r.movimento, r.dtLanc].filter(Boolean).join(' · '));
  searchMod('producao',    'Produção',   r => r.central || '—',                r => r.mes || '');

  // ── Filiais e Materiais (cadastros — sem índice necessário, são pequenos) ──
  (state.filiais || []).forEach(r => {
    const s = [r.origem, r.alias, r.regional, r.cnpj].join(' ').toLowerCase();
    if (tokens.every(t => s.includes(t))) addGroup('Central', r.alias || r.origem || '—', r.regional || '', r);
  });
  (state.materiais || []).forEach(r => {
    const s = [r.origem, r.alias, r.desc].join(' ').toLowerCase();
    if (tokens.every(t => s.includes(t))) addGroup('Material', r.alias || r.origem || '—', r.desc || '', r);
  });

  // ── Render ──────────────────────────────────────────────────────────
  const totalGroups = Object.keys(groups).length;
  const totalItems  = Object.values(groups).reduce((s, g) => s + g.items.length, 0);

  if (!totalItems) {
    dropdown.innerHTML = `
      <div class="search-no-results">
        <i class="ti ti-search-off"></i>
        Nenhum resultado para <strong>"${escapeHtml(q)}"</strong>
      </div>`;
    return;
  }

  const html = Object.entries(groups).map(([modKey, group]) => {
    const cfg = moduleColors[modKey] || {};
    const rows = group.items.map(item => `
      <div class="search-result-item" onclick="closeGlobalSearch();_gsShowDetail('${modKey}', window._gsRecords && window._gsRecords['${item.recordKey}'])">
        <div class="search-result-main">${_gsHighlight(escapeHtml(item.label), tokens)}</div>
        <div class="search-result-sub">${escapeHtml(item.sub)}</div>
      </div>`).join('');

    const count = group.items.length;
    return `
      <div class="search-group">
        <div class="search-group-header" style="color:${cfg.color||'var(--text3)'}">
          <i class="ti ${cfg.icon||'ti-circle'}" style="font-size:11px"></i>
          ${modKey}
          <span class="search-group-count">${count}${count >= 5 ? '+' : ''}</span>
        </div>
        ${rows}
      </div>`;
  }).join('');

  dropdown.innerHTML = `
    ${html}
    <div class="search-footer">
      <span>${totalItems}${totalItems >= Object.keys(groups).length * 5 ? '+' : ''} resultado${totalItems !== 1 ? 's' : ''}</span>
      <span>Clique para ver detalhes completos</span>
    </div>`;
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
    'SAP':        [['Usuário','usuario'],['Movimento','movimento'],['Ref.','ref'],['Documento','documento'],['Central','central'],['Depósito','deposito'],['Material','material'],['Peso','peso'],['UM','um'],['Custo Unit.','custoUnit'],['Valor Total','valorTotal'],['Dt. Doc.','dtDoc'],['Dt. Lançamento','dtLanc'],['Dt. Registro','dtReg']],
    'Produção':   [['Central','central'],['Mês','mes'],['Produção','producao'],['UM','um'],['Preço Médio','precoMedio'],['Custo Médio','custoMedio'],['Margem','margem'],['Total Vendas','totalVendas']],
    'Central':    [['Sigla','alias'],['Nome Original','origem'],['CNPJ','cnpj'],['Regional','regional'],['Cadastrado em','created']],
    'Material':   [['Grupo SAP','alias'],['Material Original','origem'],['Descrição','desc'],['Cadastrado em','created']],
  };

  const fields = fieldMap[modKey] || Object.keys(record).filter(k => !k.startsWith('_') && k !== 'importId').map(k => [k, k]);

  const _moneyFields = new Set(['custo','custoUnit','valorTotal','precoMedio','custoMedio','totalVendas','margem','valor']);
  const _kgFields    = new Set(['peso','producao']);

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
      closeModal('modal-search-detail');
      if (typeof navigate === 'function') navigate(cfg.nav);
    });
  }

  openModal('modal-search-detail');
}

function openGlobalSearch() {
  const input = document.getElementById('global-search-input');
  if (input && input.value.trim().length >= 2) handleGlobalSearch(input.value);
}

function closeGlobalSearch() {
  const dropdown = document.getElementById('global-search-dropdown');
  if (dropdown) dropdown.classList.remove('open');
  clearTimeout(_gsTimer);
}

// Fechar ao clicar fora
document.addEventListener('click', e => {
  const wrap = document.querySelector('.topbar-search');
  if (wrap && !wrap.contains(e.target)) closeGlobalSearch();
});

// Enter para confirmar o primeiro resultado
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeGlobalSearch();
  if (e.key === 'Enter') {
    const first = document.querySelector('#global-search-dropdown .search-result-item');
    if (first) first.click();
  }
});

Object.assign(window, { handleGlobalSearch, openGlobalSearch, closeGlobalSearch, _gsShowDetail });

// ═══════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════════════════
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Dynamic shortcuts from registry
    if (e.key === 'Escape') {
      if (document.getElementById('modal-search-global')?.classList.contains('open')) {
        closeSearchModal(); return;
      }
      closeGlobalSearch();
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
      if (document.getElementById('modal-search-global')?.classList.contains('open')) return;
      e.preventDefault();
      const pages  = ['dashboard','analitico','entradas','saidas','lancamentos','sap','producao','inventario','ocorrencias','importar','configuracoes'];
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

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    const search = document.querySelector('.topbar-search');
    if (search && !search.contains(e.target)) closeGlobalSearch();
  });
}

// IDs of modals that should NOT close on backdrop click
const _MODAL_NO_BACKDROP_CLOSE = new Set([
  'modal-fechamento',  // fechamento editor — only closes via Fechar button
]);

function setupModalCloseOnBackdrop() {
  qsa('.modal-overlay').forEach(m => {
    m.addEventListener('click', e => {
      if (e.target !== m) return;
      if (_MODAL_NO_BACKDROP_CLOSE.has(m.id)) return; // blocked
      if (m.id === 'analitico-detail-overlay') {
        closeAnaliticoDetailModal();
      } else if (m.id === 'startup-restore-overlay') {
        decideStartupRestore(false);
      } else {
        m.classList.remove('open');
      }
    });
  });
}

async function startupRestoreFlow() {
  // O modal de restauração só faz sentido quando há dados de importação
  // (entradas, saídas, SAP, etc.) salvos no storage. Se só existirem dados
  // de cadastro (configs, filiais, materiais), eles são carregados
  // silenciosamente sem interromper o usuário.
  const hasImported = await storageHasImportedData();
  const shouldRestore = hasImported ? await openStartupRestoreModal() : true;
  if (shouldRestore) {
    await restoreAndRender();
    return;
  }

  // O usuário optou por NÃO restaurar os dados importados (entradas, saídas,
  // SAP, lançamentos, etc.), mas as CONFIGURAÇÕES, PADRONIZAÇÃO DE CENTRAIS e
  // PADRONIZAÇÃO DE MATERIAIS são independentes disso: pertencem ao sistema,
  // não a uma importação, e jamais devem ser descartadas sem ação explícita
  // do usuário na tela de Configurações.
  //
  // Por isso, mesmo no caminho "não carregar", lemos o storage para extrair
  // configs, filiais e materiais salvos e os mantemos em memória. Os demais
  // módulos permanecem com o estado vazio, respeitando a escolha do usuário.
  try {
    const db = await openDb();
    let savedConfigs    = null;
    let savedFiliais    = null;
    let savedMateriais  = null;
    let savedOcorrencias= null;
    let savedAcoesRelatorio = null;
    const savedManuais  = {}; // { modulo: [registros manuais] }

    if (db) {
      // Tenta primeiro as chaves individuais (mais eficiente)
      savedConfigs    = await idbGet(db, 'configs').catch(() => null);
      savedFiliais    = await idbGet(db, 'filiais').catch(() => null);
      savedMateriais  = await idbGet(db, 'materiais').catch(() => null);
      savedOcorrencias= await idbGet(db, 'ocorrencias').catch(() => null);
      savedAcoesRelatorio = await idbGet(db, 'acoesRelatorio').catch(() => null);

      // Para registros manuais: lê todos os módulos e filtra só os manuais
      const modulosComManuais = ['entradas','saidas','lancamentos','producao'];
      for (const mod of modulosComManuais) {
        const arr = await idbGet(db, mod).catch(() => null);
        if (Array.isArray(arr)) {
          const manuais = arr.filter(r => r.fonte === 'manual');
          if (manuais.length) savedManuais[mod] = manuais;
        }
      }
      // SAP usa chunks — carregar via loadSapChunks e filtrar manuais
      try {
        const sapAll = await loadSapChunks(db);
        const sapManuais = sapAll.filter(r => r.fonte === 'manual');
        if (sapManuais.length) savedManuais['sap'] = sapManuais;
      } catch(e) {
        console.warn('[Startup] Erro ao carregar manuais SAP dos chunks:', e);
      }

      // Fallback: lê o snapshot completo e extrai as chaves necessárias
      const needsSnapshot = !Array.isArray(savedConfigs) || !Array.isArray(savedFiliais) || !Array.isArray(savedMateriais);
      if (needsSnapshot) {
        const snapshot = await idbGet(db, IDB_STATE_KEY).catch(() => null);
        if (snapshot && typeof snapshot === 'object') {
          if (!Array.isArray(savedConfigs)    && Array.isArray(snapshot.configs))    savedConfigs    = snapshot.configs;
          if (!Array.isArray(savedFiliais)    && Array.isArray(snapshot.filiais))    savedFiliais    = snapshot.filiais;
          if (!Array.isArray(savedMateriais)  && Array.isArray(snapshot.materiais))  savedMateriais  = snapshot.materiais;
          if (!Array.isArray(savedOcorrencias)&& Array.isArray(snapshot.ocorrencias))savedOcorrencias= snapshot.ocorrencias;
          if (!Array.isArray(savedAcoesRelatorio) && Array.isArray(snapshot.acoesRelatorio)) savedAcoesRelatorio = snapshot.acoesRelatorio;
          // Manuais do snapshot (exceto SAP — está em chunks, já tratado acima)
          for (const mod of modulosComManuais) {
            if (!savedManuais[mod] && Array.isArray(snapshot[mod])) {
              const manuais = snapshot[mod].filter(r => r.fonte === 'manual');
              if (manuais.length) savedManuais[mod] = manuais;
            }
          }
        }
      }
    }

    // Fallback final: localStorage legado
    const needsLegacy = (!Array.isArray(savedConfigs)   || savedConfigs.length   === 0) ||
                        (!Array.isArray(savedFiliais)   || savedFiliais.length   === 0) ||
                        (!Array.isArray(savedMateriais) || savedMateriais.length === 0);
    if (needsLegacy) {
      try {
        const raw = localStorage.getItem(legacyStateKey);
        if (raw) {
          const parsed = safeJSONParse(raw, {});
          if ((!Array.isArray(savedConfigs)   || !savedConfigs.length)   && Array.isArray(parsed.configs))   savedConfigs   = parsed.configs;
          if ((!Array.isArray(savedFiliais)   || !savedFiliais.length)   && Array.isArray(parsed.filiais))   savedFiliais   = parsed.filiais;
          if ((!Array.isArray(savedMateriais) || !savedMateriais.length) && Array.isArray(parsed.materiais)) savedMateriais = parsed.materiais;
          if ((!Array.isArray(savedOcorrencias)|| !savedOcorrencias.length) && Array.isArray(parsed.ocorrencias)) savedOcorrencias = parsed.ocorrencias;
          if ((!Array.isArray(savedAcoesRelatorio) || !savedAcoesRelatorio.length) && Array.isArray(parsed.acoesRelatorio)) savedAcoesRelatorio = parsed.acoesRelatorio;
        }
      } catch (_) {}
    }

    if (Array.isArray(savedConfigs) && savedConfigs.length > 0) {
      state.configs = mergePersistentConfigs(state.configs, savedConfigs);
    }
    if (Array.isArray(savedFiliais) && savedFiliais.length > 0) {
      state.filiais = savedFiliais;
      invalidateFilialLookup();
    }
    if (Array.isArray(savedMateriais) && savedMateriais.length > 0) {
      state.materiais = savedMateriais.map(item => ({
        id: item?.id || makeMaterialId(),
        ...item
      }));
      invalidateMaterialLookup();
      reaplicarPadronizacaoMateriais();
    }
    if (Array.isArray(savedOcorrencias) && savedOcorrencias.length > 0) {
      state.ocorrencias = savedOcorrencias;
    }
    if (Array.isArray(savedAcoesRelatorio) && savedAcoesRelatorio.length > 0) {
      state.acoesRelatorio = savedAcoesRelatorio;
    }
    // Restaura registros manuais nos módulos correspondentes
    const modStateMap = { entradas:'entradas', saidas:'saidas', lancamentos:'lancamentos', sap:'sap', producao:'producao' };
    for (const [mod, stateKey] of Object.entries(modStateMap)) {
      if (savedManuais[mod] && savedManuais[mod].length > 0) {
        state[stateKey] = savedManuais[mod];
        console.info(`[Startup] ${savedManuais[mod].length} registro(s) manual(is) restaurado(s) em ${mod}`);
      }
    }
    if (Object.keys(savedManuais).length > 0) {
      invalidateLancIndex();
      invalidateSapIndex();
      invalidateSaidasIndex();
    }
  } catch (err) {
    console.warn('[startupRestoreFlow] Não foi possível recuperar configs/filiais/materiais do storage:', err);
  }

  stateHydrated = true;
  updateImportPrereqUI();

  // Persiste imediatamente para garantir que os configs recuperados acima
  // sejam regravados no storage junto ao estado limpo dos demais módulos,
  // evitando que um persist() posterior sobrescreva com um snapshot vazio.
  await persistStateNow();

  const activePage = document.querySelector('.page.active')?.id?.replace('page-', '') || 'importar';
  updateDashboard();
  updateParamGerais();
  renderFiliais();
  renderMateriais();
  renderAcoesRelatorio();
  renderPage(activePage);
  initResizable();
}

async function init() {
  applyTheme(getSavedTheme());
  setTimeout(updateToolsTheme, 0); // sync theme buttons in dropdown
  restoreSidebarState();
  setupModalCloseOnBackdrop();
  setupKeyboardShortcuts();
  initDropZones();

  const startupNoBtn = document.getElementById('startup-restore-no');
  const startupYesBtn = document.getElementById('startup-restore-yes');
  startupNoBtn?.addEventListener('click', () => decideStartupRestore(false));
  startupYesBtn?.addEventListener('click', () => decideStartupRestore(true));

  await startupRestoreFlow();
  updateImportPrereqUI();
  // updateDashboard já foi chamado dentro de restoreAndRender/startupRestoreFlow — não chamar novamente

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
      if (document.getElementById('startup-restore-overlay')?.classList.contains('open')) {
        decideStartupRestore(false);
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

  // Calcula custo médio ponderado por material para uma central/período,
  // usando EXATAMENTE a mesma lógica do Analítico:
  //   1ª fonte: Saídas (Σ valorTotal / Σ peso) no período
  //   fallback: SAP no período
  // Retorna um objeto { [material]: custoMedio }
  getCustoMedioPorMat(central, dtIni, dtFim) {
    ensureSaidasIndex();
    if (!_sapIndexBuilt) _buildSapIndex();
    const parseD = window._inv_helpers.parseDate;
    const toNum  = window._inv_helpers.num;

    // ── 1. Saídas ──────────────────────────────────────────
    const saidasDaCentral = (_saidasByCentral.get(central) || [])
      .filter(s => { const d = parseD(s.dtEmissao); return d && d >= dtIni && d <= dtFim; });

    const _custoPorMat = {};
    const _pesoPorMat  = {};
    saidasDaCentral.forEach(s => {
      const mat = s.material || '—';
      _custoPorMat[mat] = (_custoPorMat[mat] || 0) + toNum(s.valorTotal);
      _pesoPorMat[mat]  = (_pesoPorMat[mat]  || 0) + Math.abs(toNum(s.peso));
    });

    const custoMedioPorMat = {};
    Object.keys(_custoPorMat).forEach(mat => {
      custoMedioPorMat[mat] = _pesoPorMat[mat] > 0 ? _custoPorMat[mat] / _pesoPorMat[mat] : 0;
    });

    // ── 2. Fallback: SAP (materiais sem custo nas Saídas) ──
    const sapDaCentral = (_sapByCentral.get(central) || [])
      .filter(r => { const d = parseD(r.dtLanc); return d && d >= dtIni && d <= dtFim; });

    sapDaCentral.forEach(s => {
      const mat = s.material || '—';
      if (custoMedioPorMat[mat]) return; // já coberto pelas Saídas
      const p  = Math.abs(toNum(s.peso));
      if (!p) return;
      const vt = toNum(s.valorTotal);
      const cu = toNum(s.custoUnit);
      const valor = vt !== 0 ? Math.abs(vt) : (cu !== 0 ? Math.abs(cu) * p : 0);
      if (!valor) return;
      const key = '_sap_' + mat;
      if (!_custoPorMat[key]) { _custoPorMat[key] = 0; _pesoPorMat[key] = 0; }
      _custoPorMat[key] += valor;
      _pesoPorMat[key]  += p;
    });
    Object.keys(_custoPorMat).forEach(key => {
      if (!key.startsWith('_sap_')) return;
      const mat = key.slice(5);
      if (custoMedioPorMat[mat]) return;
      custoMedioPorMat[mat] = _pesoPorMat[key] > 0 ? _custoPorMat[key] / _pesoPorMat[key] : 0;
    });

    return custoMedioPorMat;
  }
};
