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
    const lancsNoPeriodo = (dtIni && dtFim)
      ? getLancsByCentralInPeriod(central, dtIni, dtFim).slice().sort((a, b) => {
          const da = parseDate(a.dtLanc), db = parseDate(b.dtLanc);
          return dateCmp(da ?? new Date(0), db ?? new Date(0));
        })
      : (_dgLancIdx.byCentral.get(central) || []).slice();

    const sapNoPeriodo = (dtIni && dtFim)
      ? getSapByCentralInPeriod(central, dtIni, dtFim)
      : (_dgSapIdx.byCentral.get(central) || []);

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

    const saidasCentral = _saidasByCentral.size > 0
      ? (_saidasByCentral.get(central) || []).filter(s => {
          if (!dtIni || !dtFim) return true;
          const d = parseDate(s.dtEmissao);
          return d && d >= dtIni && d <= dtFim;
        })
      : state.saidas.filter(s => s.central === central && inPeriod(s.dtEmissao));
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
      sapNoPeriodo, lancsNoPeriodo, lancsByMat, custoMedioPorMat
    });
  });

  return results;
}

// ── Funções de controle do filtro de período do Dashboard Gerencial ──
function rodarDashboardGerencial() {
  const iniStr = document.getElementById('dg-dt-ini')?.value;
  const fimStr = document.getElementById('dg-dt-fim')?.value;
  let dtIni = null, dtFim = null;
  if (iniStr && fimStr) {
    dtIni = new Date(iniStr + 'T00:00:00');
    dtFim = new Date(fimStr + 'T23:59:59');
    if (isNaN(dtIni) || isNaN(dtFim) || dtIni > dtFim) {
      toast('Período inválido', 'error');
      return;
    }
  }
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
  const ini = document.getElementById('dg-dt-ini');
  const fim = document.getElementById('dg-dt-fim');
  if (ini) ini.value = '';
  if (fim) fim.value = '';
  document.querySelectorAll('#dg-toolbar .qp-btn').forEach(b => b.classList.remove('active'));
  // Voltar ao estado vazio
  const emptyEl   = document.getElementById('dg-empty-state');
  const contentEl = document.getElementById('dg-content');
  if (emptyEl)   emptyEl.style.display   = 'flex';
  if (contentEl) contentEl.style.display = 'none';
  if (window.updatePeriodFab) updatePeriodFab();
}

function setDgQuickPeriod(days) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - days + 1);
  const ini = document.getElementById('dg-dt-ini');
  const fim = document.getElementById('dg-dt-fim');
  if (ini) ini.value = toISODate(start);
  if (fim) fim.value = toISODate(end);
  document.querySelectorAll('#dg-toolbar .qp-btn').forEach(b => b.classList.remove('active'));
  event?.target?.classList.add('active');
  rodarDashboardGerencial();
}

function setDgQuickPeriodMes() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const ini = document.getElementById('dg-dt-ini');
  const fim = document.getElementById('dg-dt-fim');
  if (ini) ini.value = toISODate(start);
  if (fim) fim.value = toISODate(end);
  document.querySelectorAll('#dg-toolbar .qp-btn').forEach(b => b.classList.remove('active'));
  event?.target?.classList.add('active');
  rodarDashboardGerencial();
}

function setDgQuickPeriodAno() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const end   = new Date(now.getFullYear(), 11, 31);
  const ini = document.getElementById('dg-dt-ini');
  const fim = document.getElementById('dg-dt-fim');
  if (ini) ini.value = toISODate(start);
  if (fim) fim.value = toISODate(end);
  document.querySelectorAll('#dg-toolbar .qp-btn').forEach(b => b.classList.remove('active'));
  event?.target?.classList.add('active');
  rodarDashboardGerencial();
}

Object.assign(window, { rodarDashboardGerencial, limparDashboardGerencial, setDgQuickPeriod, setDgQuickPeriodMes, setDgQuickPeriodAno });

function renderDashboardGerencialKpis(dtIni, dtFim) {
  const kpis = document.getElementById('dg-macro-kpis');
  if (!kpis) return;

  if (!state.lancamentos.length && !state.sap.length) {
    kpis.innerHTML = '';
    return;
  }

  const results = buildDashboardGerencialResults(dtIni, dtFim);
  if (!results.length) { kpis.innerHTML = ''; return; }

  const totalEstIni   = results.reduce((s, r) => s + r.somaPrimeiro, 0);
  const totalEntradas = results.reduce((s, r) => s + r.totalEntradas, 0);
  const totalSaidas   = results.reduce((s, r) => s + r.totalSaidas, 0);
  const totalEstFim   = results.reduce((s, r) => s + r.somaUltimo, 0);
  const totalVarEst   = results.reduce((s, r) => s + r.variacaoEstoque, 0);

  // Coleta ausentes por campo (central + material)
  const missingIniList = [];
  const missingFimList = [];
  results.forEach(r => {
    (r.missingIniMats || []).forEach(m => missingIniList.push(`${r.central} · ${m}`));
    (r.missingFimMats || []).forEach(m => missingFimList.push(`${r.central} · ${m}`));
  });
  const _missingBadge = (list, label) => {
    if (!list.length) return '';
    const MAX = 5;
    const shown = list.slice(0, MAX).map(s => `<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;color:var(--text2);font-size:10.5px;font-family:var(--mono)">${escapeHtml(s)}</div>`).join('');
    const more  = list.length > MAX ? `<div style="color:var(--text3);font-size:10px;font-family:var(--mono)">+ ${list.length - MAX} mais</div>` : '';
    return `<details class="kpi-missing-details" style="margin-top:6px">
      <summary style="cursor:pointer;list-style:none;display:inline-flex;align-items:center;gap:5px;font-family:var(--mono);font-size:9.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--amber);padding:3px 8px;background:var(--amber-bg);border:1px solid var(--amber-border);border-radius:5px;user-select:none">
        <i class="ti ti-alert-triangle" style="font-size:11px"></i> ${list.length} sem ${label}
      </summary>
      <div style="margin-top:6px;padding:8px 10px;background:var(--bg4);border:1px solid var(--border2);border-radius:6px;display:flex;flex-direction:column;gap:3px">
        ${shown}${more}
      </div>
    </details>`;
  };

  // Custo por período
  // Est. Inicial e Est. Final: usa os volumes já calculados corretamente em
  // buildDashboardGerencialResults (somaPrimeiro / somaUltimo por material),
  // que respeitam getPrePeriodLaunchStock e a soma do último dia do período.
  let custoEstIni = 0, custoEntradas = 0, custoSaidas = 0, custoEstFim = 0;
  results.forEach(r => {
    const cmp = r.custoMedioPorMat || {};
    // Para Est. Ini e Est. Fim, recalcula por material usando os mesmos volumes
    // que buildDashboardGerencialResults usa para somaPrimeiro/somaUltimo,
    // garantindo consistência com os valores exibidos nas colunas de volume.
    const lancsByMat = new Map();
    r.lancsNoPeriodo.forEach(l => {
      const m = l.material || '—'; if (!lancsByMat.has(m)) lancsByMat.set(m, []); lancsByMat.get(m).push(l);
    });
    (r.allMats || []).forEach(mat => {
      const cm = cmp[mat] || 0; if (!cm) return;
      // Est. Inicial: dia anterior ao período (pula domingo), sem fallback
      const prevStock = dtIni ? getPrePeriodLaunchStock({ central: r.central, material: mat, dtIni }) : null;
      const iniVol = prevStock != null ? prevStock.value : 0;

      // Est. Final: último dia não-domingo do período, sem fallback
      const fimStock = dtFim ? getLastPeriodLaunchStock({ central: r.central, material: mat, dtFim }) : null;
      const fimVol = fimStock ? fimStock.value : 0;
      custoEstIni += iniVol * cm;
      custoEstFim += fimVol * cm;
    });
    // Entradas e Saídas SAP: custo por movimento × custo médio do material
    r.sapNoPeriodo.forEach(s => {
      const mat = s.material || '—';
      const cm  = cmp[mat] || 0;
      if (!cm) return;
      const p = num(s.peso);
      if (p > 0) custoEntradas += p * cm;
      else if (p < 0) custoSaidas += Math.abs(p) * cm;
    });
  });

  // Custo variação: (EST. FINAL - EST. TEÓRICO) × custo médio por material.
  // Usa os mesmos valores de getPrePeriodLaunchStock e getLastPeriodLaunchStock
  // que o Inventário usa, garantindo consistência entre os dois módulos.
  let totalCustoVar = 0;
  results.forEach(r => {
    const cmp        = r.custoMedioPorMat || {};
    const lancsByMat = new Map();
    const sapByMat   = new Map();
    r.lancsNoPeriodo.forEach(l => { const m = l.material||'—'; if(!lancsByMat.has(m)) lancsByMat.set(m,[]); lancsByMat.get(m).push(l); });
    r.sapNoPeriodo.forEach(s => { const m = s.material||'—'; if(!sapByMat.has(m)) sapByMat.set(m,[]); sapByMat.get(m).push(s); });
    (r.allMats||[]).forEach(mat => {
      const custMed = cmp[mat] || 0;
      if (!custMed) return;

      // EST. INICIAL: mesmo que inventário
      const prev   = dtIni ? getPrePeriodLaunchStock({ central: r.central, material: mat, dtIni }) : null;
      const estIni = prev != null ? prev.value : 0;

      // EST. FINAL: mesmo que inventário
      const fim    = dtFim ? getLastPeriodLaunchStock({ central: r.central, material: mat, dtFim }) : null;
      const estFim = (fim && !fim.missing) ? fim.value : 0;

      // Entradas/Saídas SAP: mesmo que inventário
      const sapMat = sapByMat.get(mat) || [];
      let entKg = 0, saiKg = 0;
      sapMat.forEach(s => {
        const p = num(s.peso);
        if (p > 0) entKg += p;
        else saiKg += Math.abs(p);
      });

      const estTeor = estIni + entKg - saiKg;
      const varKg   = estFim - estTeor;
      totalCustoVar += varKg * custMed;
    });
  });

  const cvCls = totalCustoVar > 0.001 ? 'kc-amber' : totalCustoVar < -0.001 ? 'kc-red' : 'kc-teal';

  const pctVarCusto    = custoEstFim > 0 ? Math.abs(totalCustoVar) / custoEstFim * 100 : 0;
  const pctVarEst      = totalEstFim  > 0 ? Math.abs(totalVarEst)  / totalEstFim  * 100 : 0;
  const pctVarCustoStr = pctVarCusto.toLocaleString('pt-BR', {minimumFractionDigits:1,maximumFractionDigits:1}) + '%';
  const pctVarEstStr   = pctVarEst.toLocaleString('pt-BR',  {minimumFractionDigits:1,maximumFractionDigits:1}) + '%';
  const reprCustoCls   = totalCustoVar > 0 ? 'v-pos' : totalCustoVar < 0 ? 'v-neg' : 'v-zero';
  const reprEstCls     = totalVarEst   > 0 ? 'v-pos' : totalVarEst   < 0 ? 'v-neg' : 'v-zero';
  const reprCustoBarBg = totalCustoVar > 0 ? 'var(--amber)' : totalCustoVar < 0 ? 'var(--red)' : 'var(--teal)';
  const reprEstBarBg   = totalVarEst   > 0 ? 'var(--amber)' : totalVarEst   < 0 ? 'var(--red)' : 'var(--teal)';
  const veValCls       = totalVarEst   > 0.001 ? 'v-pos' : totalVarEst   < -0.001 ? 'v-neg' : 'v-zero';

  kpis.innerHTML = `
    <div class="macro-kpi-card kc-teal">
      <div class="macro-kpi-label"><i class="ti ti-package-import"></i> Est. Inicial</div>
      <div class="macro-kpi-cost" title="${custoEstIni > 0 ? money(custoEstIni) : '—'}">${custoEstIni > 0 ? moneyShort(custoEstIni) : '—'}</div>
      <div class="macro-kpi-sub">Custo total — 1º lançamento</div>
      <div class="macro-kpi-saldo-row">
        <span class="macro-kpi-saldo-label">Volume</span>
        <span class="macro-kpi-saldo-val">${fmtKg(totalEstIni)}</span>
      </div>
      ${_missingBadge(missingIniList, 'Est. Ini.')}
    </div>
    <div class="macro-kpi-card kc-green">
      <div class="macro-kpi-label"><i class="ti ti-arrow-bar-to-down"></i> Entradas SAP</div>
      <div class="macro-kpi-cost" title="${custoEntradas > 0 ? money(custoEntradas) : '—'}">${custoEntradas > 0 ? moneyShort(custoEntradas) : '—'}</div>
      <div class="macro-kpi-sub">Custo total — cód. 101 + 801</div>
      <div class="macro-kpi-saldo-row">
        <span class="macro-kpi-saldo-label">Volume</span>
        <span class="macro-kpi-saldo-val">${fmtKg(totalEntradas)}</span>
      </div>
    </div>
    <div class="macro-kpi-card kc-red">
      <div class="macro-kpi-label"><i class="ti ti-arrow-bar-up"></i> Saídas SAP</div>
      <div class="macro-kpi-cost" title="${custoSaidas > 0 ? money(custoSaidas) : '—'}">${custoSaidas > 0 ? moneyShort(custoSaidas) : '—'}</div>
      <div class="macro-kpi-sub">Custo total — cód. 201</div>
      <div class="macro-kpi-saldo-row">
        <span class="macro-kpi-saldo-label">Volume</span>
        <span class="macro-kpi-saldo-val">${fmtKg(Math.abs(totalSaidas))}</span>
      </div>
    </div>
    <div class="macro-kpi-card kc-blue">
      <div class="macro-kpi-label"><i class="ti ti-package-export"></i> Est. Final</div>
      <div class="macro-kpi-cost" title="${custoEstFim > 0 ? money(custoEstFim) : '—'}">${custoEstFim > 0 ? moneyShort(custoEstFim) : '—'}</div>
      <div class="macro-kpi-sub">Custo total — últ. lançamento</div>
      <div class="macro-kpi-saldo-row">
        <span class="macro-kpi-saldo-label">Volume</span>
        <span class="macro-kpi-saldo-val">${fmtKg(totalEstFim)}</span>
      </div>
      ${_missingBadge(missingFimList, 'Est. Fim')}
    </div>
    <div class="macro-kpi-card ${cvCls}">
      <div class="macro-kpi-label"><i class="ti ti-arrows-diff"></i> Var. Custo &amp; Estoque</div>
      <div class="macro-kpi-cost" title="${money(Math.abs(totalCustoVar))}">${varSymbol(totalCustoVar)} ${moneyShort(Math.abs(totalCustoVar))}</div>
      <div class="macro-kpi-sub">${varLabel(totalCustoVar)} — custo implicado</div>
      <div class="macro-kpi-var-group">
        <div class="macro-kpi-var-row">
          <span class="macro-kpi-var-tag">Vol.</span>
          <span class="macro-kpi-var-val ${veValCls}">${varSymbol(totalVarEst)} ${fmtKg(Math.abs(totalVarEst))}</span>
        </div>
      </div>
    </div>
    <div class="macro-kpi-card kc-amber">
      <div class="macro-kpi-label"><i class="ti ti-percent"></i> Representatividade</div>
      <div class="macro-kpi-cost" style="font-size:clamp(13px,1.5vw,16px);color:var(--amber)">Var. vs Est. Final</div>
      <div class="macro-kpi-repr-row">
        <div class="macro-kpi-repr-item">
          <div class="macro-kpi-repr-head">
            <span class="macro-kpi-repr-lbl">Var. Custo / Custo Final</span>
            <span class="macro-kpi-repr-pct ${reprCustoCls}">${pctVarCustoStr}</span>
          </div>
          <div class="macro-kpi-repr-bar"><div class="macro-kpi-repr-fill" style="width:${Math.min(pctVarCusto,100)}%;background:${reprCustoBarBg}"></div></div>
        </div>
        <div class="macro-kpi-repr-item">
          <div class="macro-kpi-repr-head">
            <span class="macro-kpi-repr-lbl">Var. Estoque / Est. Final</span>
            <span class="macro-kpi-repr-pct ${reprEstCls}">${pctVarEstStr}</span>
          </div>
          <div class="macro-kpi-repr-bar"><div class="macro-kpi-repr-fill" style="width:${Math.min(pctVarEst,100)}%;background:${reprEstBarBg}"></div></div>
        </div>
      </div>
    </div>`;
}

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
  // ── 1. KPI Gerencial strip ──
  renderDashboardGerencialKpis(dtIni, dtFim);

  // ── Build base results (reuse) ──
  const results = buildDashboardGerencialResults(dtIni, dtFim);
  const thresholds = getHealthThresholds();

  // ── 2. Saúde Global ──
  renderDgSaudeGlobal(results, thresholds);

  // ── 3. Riscos Operacionais ──
  renderDgRiscos(results, thresholds);

  // ── 4. Top 5 Centrais por Custo Médio ──
  renderDgTop5CustoMedio(results, thresholds);

  // ── 5 & 6. Giro de Estoque ──
  renderDgGiro(results);

  // ── 7. Custos ──
  renderDgCustos(results, dtIni, dtFim);
}

// ────────────────────────────────────────────
// 2. SAÚDE GLOBAL DA OPERAÇÃO
// ────────────────────────────────────────────
function renderDgSaudeGlobal(results, thresholds) {
  const matEl     = document.getElementById('dg-saude-mat-body');
  const centralEl = document.getElementById('dg-saude-central-body');
  const matTotEl  = document.getElementById('dg-saude-mat-total');
  const cenTotEl  = document.getElementById('dg-saude-central-total');
  if (!matEl || !centralEl) return;

  if (!results.length) {
    matEl.innerHTML = centralEl.innerHTML = '<div class="dg-empty-riscos"><i class="ti ti-database-off"></i><span>Sem dados no período.</span></div>';
    return;
  }

  // Aggregate material health across all centrals
  const matCounts   = { critico:0, urgente:0, atencao:0, bom:0 };
  const cenCounts   = { critico:0, urgente:0, atencao:0, bom:0 };

  results.forEach(r => {
    // Build matDiffs for this central
    const lancsByMat = new Map();
    const sapByMat   = new Map();
    r.lancsNoPeriodo.forEach(l => {
      const m = l.material||'—';
      if (!lancsByMat.has(m)) lancsByMat.set(m, []);
      lancsByMat.get(m).push(l);
    });
    r.sapNoPeriodo.forEach(s => {
      const m = s.material||'—';
      if (!sapByMat.has(m)) sapByMat.set(m, []);
      sapByMat.get(m).push(s);
    });

    const matDiffs = r.allMats.map(mat => {
      const snap = buildSnapshot({ lancs: lancsByMat.get(mat)||[], sap: sapByMat.get(mat)||[] });
      const rawCat = (lancsByMat.get(mat)||[])[0]?.categoria || '';
      const catKey = detectCatKey(rawCat) || detectCatFromMat(mat);
      return { mat, diff: snap.diff, catKey };
    });

    const nonNeutral = matDiffs.filter(m => Math.abs(m.diff) > 0.0001);
    nonNeutral.forEach(m => {
      const lvl = classifyVariation(Math.abs(m.diff), m.catKey, thresholds);
      matCounts[lvl]++;
    });

    // Central-level health
    const { level } = calcHealthScore(matDiffs, lancsByMat, sapByMat, thresholds);
    const cenLvl = level === 'ok' ? 'bom' : level;
    if (cenCounts[cenLvl] !== undefined) cenCounts[cenLvl]++;
  });

  const totalMats = Object.values(matCounts).reduce((a,b)=>a+b,0);
  const totalCens = results.length;

  if (matTotEl) matTotEl.textContent = `${totalMats} materiais`;
  if (cenTotEl) cenTotEl.textContent = `${totalCens} centrais`;

  function buildBars(counts, total) {
    const items = [
      { key:'critico', label:'Crítico',  color:'var(--red)',    icon:'ti-flame' },
      { key:'urgente', label:'Urgente',  color:'#f97316',       icon:'ti-alert-circle' },
      { key:'atencao', label:'Atenção',  color:'var(--amber)',  icon:'ti-alert-triangle' },
      { key:'bom',     label:'Bom',      color:'var(--green)',  icon:'ti-circle-check' },
    ];
    if (!total) return '<div class="dg-empty-riscos" style="padding:12px 0"><i class="ti ti-database-off"></i><span>Sem dados.</span></div>';
    return items.map(({ key, label, color, icon }) => {
      const cnt = counts[key] || 0;
      const pct = total > 0 ? (cnt / total * 100) : 0;
      return `<div class="dg-saude-bar-row">
        <span class="dg-saude-bar-label">
          <span class="dg-saude-dot" style="background:${color}"></span>
          <span style="color:${color}">${label}</span>
        </span>
        <div class="dg-saude-bar-track">
          <div class="dg-saude-bar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
        <span class="dg-saude-bar-count">${cnt}</span>
        <span class="dg-saude-bar-pct">${pct.toFixed(1)}%</span>
      </div>`;
    }).join('');
  }

  matEl.innerHTML    = buildBars(matCounts, totalMats);
  centralEl.innerHTML = buildBars(cenCounts, totalCens);
}

// ────────────────────────────────────────────
// 3. RISCOS OPERACIONAIS EMERGENTES
// ────────────────────────────────────────────
function renderDgRiscos(results, thresholds) {
  const el = document.getElementById('dg-riscos-body');
  if (!el) return;

  if (!results.length) {
    el.innerHTML = '<div class="dg-empty-riscos"><i class="ti ti-shield-check"></i><span>Nenhum dado para analisar.</span></div>';
    return;
  }

  // ── Helpers ──────────────────────────────────────────────
  const SEV = { critico: 0, urgente: 1, atencao: 2, info: 3 };
  const SEV_LABEL  = { critico: 'CRÍTICO', urgente: 'URGENTE', atencao: 'ATENÇÃO', info: 'INFO' };
  const SEV_COLOR  = { critico: 'var(--red)', urgente: '#f97316', atencao: 'var(--amber)', info: 'var(--accent)' };
  const SEV_BG     = { critico: 'var(--red-bg)', urgente: 'rgba(249,115,22,.10)', atencao: 'var(--amber-bg)', info: 'var(--accent-dim)' };
  const SEV_BORDER = { critico: 'var(--red-border)', urgente: 'rgba(249,115,22,.25)', atencao: 'var(--amber-border)', info: 'var(--accent-glow)' };

  const risks = [];

  const push = (sev, headline, body, pills=[]) => {
    risks.push({ sev, headline, body, pills });
  };

  results.forEach(r => {
    const lancsByMat = new Map();
    const sapByMat   = new Map();
    r.lancsNoPeriodo.forEach(l => { const m=l.material||'—'; if(!lancsByMat.has(m)) lancsByMat.set(m,[]); lancsByMat.get(m).push(l); });
    r.sapNoPeriodo.forEach(s => { const m=s.material||'—'; if(!sapByMat.has(m)) sapByMat.set(m,[]); sapByMat.get(m).push(s); });

    const matDiffs = r.allMats.map(mat => {
      const prev = typeof getPrePeriodLaunchStock === 'function'
        ? getPrePeriodLaunchStock({ central: r.central, material: mat, dtIni: r._dtIni })
        : null;
      const snap = buildSnapshot({ lancs: lancsByMat.get(mat)||[], sap: sapByMat.get(mat)||[], initialStockOverride: prev?.value ?? null });
      const rawCat = (lancsByMat.get(mat)||[])[0]?.categoria || '';
      const catKey = detectCatKey(rawCat) || detectCatFromMat(mat);
      return { mat, diff: snap.diff, catKey, snap };
    });

    const { level, counts } = calcHealthScore(matDiffs, lancsByMat, sapByMat, thresholds);
    const totalDiff = matDiffs.reduce((s,m)=>s+m.diff, 0);
    const custoMeds = Object.entries(r.custoMedioPorMat).filter(([,v])=>v>0);
    const maxCustoEntry = custoMeds.sort((a,b)=>b[1]-a[1])[0];

    // ── Manchete 1: Central em estado crítico ──
    if (level === 'critico') {
      const topMats = matDiffs
        .filter(m => classifyVariation(Math.abs(m.diff), m.catKey, thresholds) === 'critico')
        .sort((a,b) => Math.abs(b.diff)-Math.abs(a.diff))
        .slice(0,2);
      const custoImpacto = topMats.reduce((s,m) => s + Math.abs(m.diff) * (r.custoMedioPorMat[m.mat]||0), 0);
      push('critico',
        `🔴 ${escapeHtml(r.central)} — ${counts.critico} material${counts.critico!==1?'is':''} em nível CRÍTICO`,
        `Variação acumulada de <strong>${fmtKg(Math.abs(totalDiff))}</strong> no período${custoImpacto>0?' · impacto financeiro estimado de <strong>'+money(custoImpacto)+'</strong>':''}.${topMats.length?' Piores: '+topMats.map(m=>`<strong>${escapeHtml(m.mat)}</strong> (${varSymbol(m.diff)}${fmtKg(Math.abs(m.diff))})`).join(', ')+'.':''}`,
        [{ label: `${counts.urgente} urgente${counts.urgente!==1?'s':''}`, sev: 'urgente' }, { label: `${counts.atencao} atenção`, sev: 'atencao' }].filter(p=>p.label[0]!=='0')
      );
    }

    // ── Manchete 2: Central em estado urgente ──
    else if (level === 'urgente') {
      const topUrg = matDiffs
        .filter(m => classifyVariation(Math.abs(m.diff), m.catKey, thresholds) === 'urgente')
        .sort((a,b) => Math.abs(b.diff)-Math.abs(a.diff))
        .slice(0,2);
      push('urgente',
        `🟠 ${escapeHtml(r.central)} — ${counts.urgente} material${counts.urgente!==1?'is':''} em nível URGENTE`,
        `Déficit de <strong>${fmtKg(Math.abs(totalDiff))}</strong> no período. ${counts.atencao>0?counts.atencao+' material(is) adicionais em atenção — risco de escalada se não corrigido.':''}${topUrg.length?' Materiais: '+topUrg.map(m=>`<strong>${escapeHtml(m.mat)}</strong>`).join(', ')+'.':''}`,
        []
      );
    }

    // ── Manchete 3: Material crítico específico ──
    const criticos = matDiffs.filter(m => classifyVariation(Math.abs(m.diff), m.catKey, thresholds) === 'critico');
    if (criticos.length) {
      const worst = criticos.sort((a,b) => Math.abs(b.diff)-Math.abs(a.diff))[0];
      const custoMat = r.custoMedioPorMat[worst.mat] || 0;
      const impacto  = Math.abs(worst.diff) * custoMat;
      const direcao  = worst.diff < 0 ? 'Desfalque' : 'Sobra';
      push('critico',
        `🔴 ${escapeHtml(worst.mat)} em ${escapeHtml(r.central)} — ${direcao} crítico`,
        `Variação de <strong>${varSymbol(worst.diff)}${fmtKg(Math.abs(worst.diff))}</strong>${custoMat>0?' · custo implicado de <strong>'+money(impacto)+'</strong>':''}.${worst.diff<0?' Estoque real abaixo do teórico — requer conferência imediata.':' Estoque real acima do esperado — verificar entradas não registradas.'}`,
        [{ label: direcao.toUpperCase(), sev: 'critico' }]
      );
    }

    // ── Manchete 4: Desfalque acumulado expressivo ──
    if (totalDiff < -1000 && level !== 'critico') {
      const custoTotal = Math.abs(totalDiff) * ((custoMeds[0]?.[1]) || 0);
      push('urgente',
        `🟠 ${escapeHtml(r.central)} — Desfalque acumulado de ${fmtKg(Math.abs(totalDiff))}`,
        `O estoque real da central está <strong>${fmtKg(Math.abs(totalDiff))}</strong> abaixo do esperado${custoTotal>0?' — impacto financeiro de <strong>'+money(custoTotal)+'</strong>':''}.${counts.atencao>0?' '+counts.atencao+' material(is) em atenção contribuindo para o déficit.':''}`,
        [{ label: 'DESFALQUE', sev: 'urgente' }]
      );
    }

    // ── Manchete 5: Escalada de atenção ──
    const emAtencao = matDiffs.filter(m => classifyVariation(Math.abs(m.diff), m.catKey, thresholds) === 'atencao' && m.diff < 0);
    if (emAtencao.length >= 2) {
      const impTotal = emAtencao.reduce((s,m)=>s+Math.abs(m.diff)*(r.custoMedioPorMat[m.mat]||0),0);
      push('atencao',
        `⚠️ ${escapeHtml(r.central)} — ${emAtencao.length} materiais em atenção com variação negativa`,
        `Risco de escalada para URGENTE se a tendência continuar. Materiais afetados: <strong>${emAtencao.slice(0,3).map(m=>escapeHtml(m.mat)).join(', ')}</strong>${emAtencao.length>3?' e mais '+(emAtencao.length-3)+'':''}.${impTotal>0?' Custo implicado combinado: <strong>'+money(impTotal)+'</strong>.':''}`,
        [{ label: emAtencao.length + ' em atenção', sev: 'atencao' }]
      );
    }
  });

  // ── Manchete global: Sem lançamentos ──
  const semLanc = results.filter(r => !r.lancsNoPeriodo.length);
  if (semLanc.length) {
    push('atencao',
      `⚠️ ${semLanc.length} central${semLanc.length!==1?'is':''} sem lançamentos no período`,
      `Sem lançamentos: <strong>${semLanc.slice(0,4).map(r=>escapeHtml(r.central)).join(', ')}${semLanc.length>4?' e mais '+(semLanc.length-4):''}</strong>. Os cálculos de variação destas centrais podem estar incompletos.`,
      [{ label: 'SEM DADOS', sev: 'atencao' }]
    );
  }

  // Sort: critico > urgente > atencao
  risks.sort((a,b) => (SEV[a.sev]||3) - (SEV[b.sev]||3));
  const top10 = risks.slice(0,10);

  if (!top10.length) {
    el.innerHTML = '<div class="dg-empty-riscos"><i class="ti ti-shield-check" style="color:var(--green)"></i><span style="color:var(--green)">Nenhum risco emergente identificado. Operação dentro dos parâmetros.</span></div>';
    return;
  }

  el.innerHTML = top10.map((r, idx) => {
    const pillsHtml = r.pills.map(p =>
      `<span class="dg-risco-pill" style="background:${SEV_BG[p.sev]};color:${SEV_COLOR[p.sev]};border:1px solid ${SEV_BORDER[p.sev]}">${p.label}</span>`
    ).join('');

    return `
      <div class="dg-risco-item dg-risco-item--news dg-risco-item--${r.sev}">
        <div class="dg-risco-news-bar" style="background:${SEV_COLOR[r.sev]}"></div>
        <div class="dg-risco-news-body">
          <div class="dg-risco-news-headline">${r.headline}</div>
          <div class="dg-risco-news-text">${r.body}</div>
          ${pillsHtml ? `<div class="dg-risco-news-pills">${pillsHtml}</div>` : ''}
        </div>
        <div class="dg-risco-news-num">${String(idx+1).padStart(2,'0')}</div>
      </div>`;
  }).join('');
}

// ────────────────────────────────────────────
// 4. TOP 5 CENTRAIS POR CUSTO MÉDIO
// ────────────────────────────────────────────
function renderDgTop5CustoMedio(results, thresholds) {
  const el = document.getElementById('dg-top5-body');
  if (!el) return;

  if (!results.length) {
    el.innerHTML = '<div class="dg-empty-riscos"><i class="ti ti-database-off"></i><span>Sem dados no período.</span></div>';
    return;
  }

  const centraisData = results.map(r => {
    const lancsByMat = new Map();
    const sapByMat   = new Map();
    r.lancsNoPeriodo.forEach(l => { const m=l.material||'—'; if(!lancsByMat.has(m)) lancsByMat.set(m,[]); lancsByMat.get(m).push(l); });
    r.sapNoPeriodo.forEach(s => { const m=s.material||'—'; if(!sapByMat.has(m)) sapByMat.set(m,[]); sapByMat.get(m).push(s); });

    const matDiffs = r.allMats.map(mat => {
      const snap = buildSnapshot({ lancs: lancsByMat.get(mat)||[], sap: sapByMat.get(mat)||[] });
      const rawCat = (lancsByMat.get(mat)||[])[0]?.categoria || '';
      const catKey = detectCatKey(rawCat) || detectCatFromMat(mat);
      return { mat, diff: snap.diff, catKey };
    });

    const { level, counts } = calcHealthScore(matDiffs, lancsByMat, sapByMat, thresholds);

    // Custo médio = soma dos custos médios por mat / qtd mats
    const custos = Object.values(r.custoMedioPorMat).filter(v=>v>0);
    const custoMedio = custos.length ? custos.reduce((a,b)=>a+b,0)/custos.length : 0;

    return {
      central: r.central,
      custoMedio,
      level,
      criticos: counts.critico || 0,
      nMats: r.allMats.length
    };
  }).filter(r => r.custoMedio > 0).sort((a,b)=>b.custoMedio-a.custoMedio).slice(0,5);

  if (!centraisData.length) {
    el.innerHTML = '<div class="dg-empty-riscos"><i class="ti ti-database-off"></i><span>Sem dados de custo no período.</span></div>';
    return;
  }

  const maxCusto = centraisData[0].custoMedio;
  const levelStyle = {
    ok:      'background:var(--green-bg);color:var(--green);border:1px solid var(--green-border)',
    atencao: 'background:var(--amber-bg);color:var(--amber);border:1px solid var(--amber-border)',
    urgente: 'background:rgba(249,115,22,0.10);color:#f97316;border:1px solid rgba(249,115,22,0.22)',
    critico: 'background:var(--red-bg);color:var(--red);border:1px solid var(--red-border)',
  };
  const levelLabel = { ok:'BOM', atencao:'ATENÇÃO', urgente:'URGENTE', critico:'CRÍTICO' };

  el.innerHTML = centraisData.map((c, i) => {
    const pct = maxCusto > 0 ? (c.custoMedio / maxCusto * 100) : 0;
    return `<div class="dg-top5-row">
      <div class="dg-top5-rank">
        <span class="dg-top5-rank-num">#${i+1}</span>
        <span class="dg-top5-central" title="${escapeHtml(c.central)}">${escapeHtml(c.central)}</span>
      </div>
      <div class="dg-top5-bar-wrap">
        <div class="dg-top5-bar-track"><div class="dg-top5-bar-fill" style="width:${pct}%"></div></div>
      </div>
      <span class="dg-top5-cost">${money(c.custoMedio)}</span>
      <div class="dg-top5-health">
        <span style="font-size:9.5px;font-family:var(--mono);font-weight:700;padding:2px 7px;border-radius:4px;${levelStyle[c.level]||levelStyle.ok}">${levelLabel[c.level]||'—'}</span>
      </div>
      <span class="dg-top5-criticos">${c.criticos > 0 ? `<i class="ti ti-flame" style="font-size:11px;margin-right:3px"></i>${c.criticos}` : '<span style="color:var(--text3)">—</span>'}</span>
    </div>`;
  }).join('');
}

// ────────────────────────────────────────────
// 5 & 6. GIRO DE ESTOQUE
// ────────────────────────────────────────────
function renderDgGiro(results) {
  const kpiEl = document.getElementById('dg-giro-kpi-inner');
  const matEl = document.getElementById('dg-giro-mat-body');
  if (!kpiEl) return;

  if (!results.length) {
    kpiEl.innerHTML = '<div class="dg-empty-riscos" style="padding:12px 0"><i class="ti ti-database-off"></i><span>Sem dados.</span></div>';
    if (matEl) matEl.innerHTML = kpiEl.innerHTML;
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

  // Cobertura: cor neutra informativa — sem semáforo consolidado
  // (thresholds fazem sentido por material, não por média de todos os materiais)
  kpiEl.innerHTML = `
    <div class="dg-giro-main">
      <div class="dg-giro-label"><i class="ti ti-calendar-time" style="font-size:13px"></i> Cobertura Média</div>
      <div class="dg-giro-value" style="color:var(--teal)">${coberturaGeral !== null ? coberturaGeral.toFixed(1) + 'd' : '—'}</div>
      <div class="dg-giro-sub-hint" style="margin-top:2px">Est.Médio ÷ consumo diário</div>
    </div>
    <div class="dg-giro-divider"></div>
    <div class="dg-giro-sub-item">
      <div class="dg-giro-sub-label">Giro Geral</div>
      <div class="dg-giro-sub-value">${giroGeral.toFixed(2)}×</div>
      <div class="dg-giro-sub-hint">${label}</div>
    </div>
    <div class="dg-giro-divider"></div>
    <div class="dg-giro-sub-item">
      <div class="dg-giro-sub-label">Giro 30 dias</div>
      <div class="dg-giro-sub-value">${giro30.toFixed(2)}×</div>
      <div class="dg-giro-sub-hint">Est. Médio: ${fmtKgShort(totalEstMedioKg)}</div>
    </div>
    <div class="dg-giro-divider"></div>
    <div class="dg-giro-sub-item">
      <div class="dg-giro-sub-label">Período · Saídas Totais</div>
      <div class="dg-giro-sub-value">${periodoEstimado}d &nbsp;<span style="font-size:14px;color:var(--text2)">${fmtKgShort(totalSaidasKg)}</span></div>
      <div class="dg-giro-sub-hint">dias analisados · consumo total</div>
    </div>`;

  // ── Giro & Cobertura por Central ─────────────────────────────────────────
  const centralEl = document.getElementById('dg-giro-central-body');
  if (centralEl) {
    const centralArr = results.map(r => {
      const lancsByMat = new Map();
      const sapByMat   = new Map();
      r.lancsNoPeriodo.forEach(l => { const m=l.material||'—'; if(!lancsByMat.has(m)) lancsByMat.set(m,[]); lancsByMat.get(m).push(l); });
      r.sapNoPeriodo.forEach(s => { const m=s.material||'—'; if(!sapByMat.has(m)) sapByMat.set(m,[]); sapByMat.get(m).push(s); });

      let saidasTotal = 0, estMedioTotal = 0;
      r.allMats.forEach(mat => {
        const snap = buildSnapshot({ lancs: lancsByMat.get(mat)||[], sap: sapByMat.get(mat)||[] });
        saidasTotal  += Math.abs(snap.totalSai);
        estMedioTotal += (snap.pesoIni + snap.pesoFim) / 2;
      });

      const giro      = estMedioTotal > 0 ? saidasTotal / estMedioTotal : 0;
      const cobertura = saidasTotal > 0 ? (estMedioTotal / saidasTotal) * periodoEstimado : null;
      const { cls: gCls, label: gLabel } = classificarGiro(giro);
      return { central: r.central, giro, cobertura, saidasTotal, estMedioTotal, gCls, gLabel, nMats: r.allMats.length };
    }).sort((a, b) => b.giro - a.giro);

    const giroCorCentral = g => g > 4 ? 'var(--red)' : g >= 2 ? 'var(--green)' : g >= 1 ? 'var(--teal)' : g >= 0.5 ? 'var(--amber)' : 'var(--red)';

    centralEl.innerHTML = `
      <div class="dg-giro-central-grid">
        <div class="dg-giro-central-head">
          <span>Central</span>
          <span style="text-align:center">Cobertura</span>
          <span style="text-align:right">Giro</span>
          <span style="text-align:right">Saídas</span>
          <span style="text-align:right">Est.Médio</span>
          <span style="text-align:center">Classificação</span>
        </div>
        ${centralArr.map(c => `
        <div class="dg-giro-central-row">
          <span class="dg-giro-central-name">${escapeHtml(c.central)}</span>
          <span style="text-align:center">${buildCoberturaCell(c.cobertura)}</span>
          <span class="dg-giro-mat-num" style="color:${giroCorCentral(c.giro)};text-align:right">${c.giro.toFixed(2)}×</span>
          <span class="dg-giro-mat-num" style="text-align:right;color:var(--text2)">${fmtKgShort(c.saidasTotal)}</span>
          <span class="dg-giro-mat-num" style="text-align:right;color:var(--text2)">${fmtKgShort(c.estMedioTotal)}</span>
          <span style="text-align:center;font-size:10px;font-family:var(--mono);color:var(--text3)">${c.gLabel}</span>
        </div>`).join('')}
      </div>`;
  }

  // Mat giro — build sorted array (only mats with real estMedio > 0)
  if (!matEl && !document.getElementById('dg-giro-mat-alto-body')) return;

  const matArr = [...matGiroMap.entries()].map(([mat, d]) => ({
    mat,
    giro: d.estMedio > 0 ? d.saidas / d.estMedio : 0,
    saidas: d.saidas,
    entradas: d.entradas||0,
    estMedio: d.estMedio,
    cobertura: d.saidas > 0 ? (d.estMedio / d.saidas) * periodoEstimado : null,
    temMovimento: d.saidas > 0 || d.entradas > 0
  })).filter(m => m.estMedio > 0); // only mats with real stock

  const altoEl  = document.getElementById('dg-giro-mat-alto-body');
  const baixoEl = document.getElementById('dg-giro-mat-baixo-body');

  if (!matArr.length) {
    const msg = '<div class="dg-empty-riscos"><i class="ti ti-database-off"></i><span>Sem dados de giro.</span></div>';
    if (altoEl)  altoEl.innerHTML  = msg;
    if (baixoEl) baixoEl.innerHTML = msg;
    if (matEl)   matEl.innerHTML   = msg;
    return;
  }

  const top10Alto  = [...matArr].sort((a,b) => b.giro - a.giro).slice(0, 10);
  const top10Baixo = [...matArr].sort((a,b) => a.giro - b.giro).slice(0, 10);

  const maxGiroAlto  = top10Alto[0]?.giro  || 1;
  const maxGiroBaixo = top10Baixo[0]?.giro > 0 ? top10Baixo[top10Baixo.length-1]?.giro || 1 : 1;

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

  const headHtml = `
    <div class="dg-giro-mat-head-row">
      <span>Material</span>
      <span style="text-align:center" title="Dias de cobertura = Est.Médio ÷ (Saídas ÷ Período)">Cobertura</span>
      <span style="text-align:right" title="Índice de giro do período">Giro×</span>
      <span style="text-align:right">Entradas</span>
      <span style="text-align:right">Saídas</span>
      <span style="text-align:right">Est.Médio</span>
      <span style="text-align:center" title="Entradas ÷ Saídas — abastecimento vs consumo">Abast.</span>
    </div>`;

  function buildAbastCell(entradas, saidas, panel) {
    // panel: 'alto' (high turnover) or 'baixo' (low/parado)
    if (saidas < 0.001 && entradas < 0.001) {
      return `<span class="dg-giro-abast neutral" title="Sem movimentação">—</span>`;
    }
    if (saidas < 0.001) {
      // Entradas sem saídas — acúmulo / excesso de estoque
      return `<span class="dg-giro-abast excess" title="Entradas sem consumo registrado">↑ acúmulo</span>`;
    }
    const ratio = (entradas / saidas) * 100;
    const ratioLabel = ratio.toFixed(0) + '%';
    if (panel === 'alto') {
      // High turnover: low ratio = rupture risk
      if (ratio >= 100) return `<span class="dg-giro-abast ok"    title="Abastecimento cobre o consumo (${ratioLabel})"><i class="ti ti-circle-check" style="font-size:10px"></i> ${ratioLabel}</span>`;
      if (ratio >= 80)  return `<span class="dg-giro-abast warn"  title="Abastecimento próximo do limite (${ratioLabel})"><i class="ti ti-alert-triangle" style="font-size:10px"></i> ${ratioLabel}</span>`;
      return             `<span class="dg-giro-abast risk"  title="Risco de ruptura — abastecimento insuficiente (${ratioLabel})"><i class="ti ti-flame" style="font-size:10px"></i> ${ratioLabel}</span>`;
    } else {
      // Low turnover: high ratio = excess supply (capital parado)
      if (ratio > 150) return `<span class="dg-giro-abast excess"  title="Excesso de abastecimento — capital imobilizado (${ratioLabel})"><i class="ti ti-currency-dollar" style="font-size:10px"></i> ${ratioLabel}</span>`;
      if (ratio >= 100) return `<span class="dg-giro-abast warn"   title="Abastecimento acima do consumo (${ratioLabel})"><i class="ti ti-arrow-up" style="font-size:10px"></i> ${ratioLabel}</span>`;
      if (ratio >= 80)  return `<span class="dg-giro-abast ok"     title="Abastecimento equilibrado (${ratioLabel})"><i class="ti ti-equal" style="font-size:10px"></i> ${ratioLabel}</span>`;
      return             `<span class="dg-giro-abast risk"   title="Consumo supera o abastecimento (${ratioLabel})"><i class="ti ti-trending-down" style="font-size:10px"></i> ${ratioLabel}</span>`;
    }
  }

  function buildMatRow(m, refGiro) {
    const col  = giroColor(m.giro);
    const tag  = giroTag(m.giro);
    return `<div class="dg-giro-mat-row" title="Cobertura: ${m.cobertura !== null ? m.cobertura.toFixed(1)+'d' : '—'}&#10;Giro: ${m.giro.toFixed(4)}× — ${tag.label}&#10;Entradas: ${fmtKg(m.entradas)}&#10;Saídas: ${fmtKg(m.saidas)}&#10;Est.Médio: ${fmtKg(m.estMedio)}">
      <span class="dg-giro-mat-name" title="${escapeHtml(m.mat)}">${escapeHtml(m.mat)}</span>
      ${buildCoberturaCell(m.cobertura)}
      <span class="dg-giro-mat-num" style="color:${col};text-align:right">${m.giro.toFixed(2)}×</span>
      <span class="dg-giro-mat-num" style="color:var(--green)" title="${fmtKg(m.entradas)}">${fmtKgShort(m.entradas)}</span>
      <span class="dg-giro-mat-num" style="color:var(--red)" title="${fmtKg(m.saidas)}">${fmtKgShort(m.saidas)}</span>
      <span class="dg-giro-mat-num" style="color:var(--text2)" title="${fmtKg(m.estMedio)}">${fmtKgShort(m.estMedio)}</span>
      ${buildAbastCell(m.entradas, m.saidas, 'alto')}
    </div>`;
  }

  if (altoEl) {
    altoEl.innerHTML = headHtml + top10Alto.map(m => buildMatRow(m, maxGiroAlto)).join('');
  }

  if (baixoEl) {
    // For the baixo panel, invert bars: worst (lowest giro) gets fullest bar, to visually highlight the problem
    const refBaixo = top10Baixo[0]?.giro || 0; // lowest giro value (first after asc sort)
    // Use the max giro of the bottom-10 as reference so bars span the panel properly
    const maxOfBottom = Math.max(...top10Baixo.map(m=>m.giro), 0.001);

    // Add alert icons / tags for parado / baixo materials
    const baixoRows = top10Baixo.map(m => {
      const pct = maxOfBottom > 0 ? Math.min((m.giro / maxOfBottom) * 100, 100) : 0;
      const col  = giroColor(m.giro);
      const tag  = giroTag(m.giro);
      // Severity indicator for low-giro panel
      const alertIcon = m.giro < 0.1
        ? `<i class="ti ti-lock" style="font-size:11px;color:var(--red);margin-right:4px" title="Capital imobilizado"></i>`
        : m.giro < 1
        ? `<i class="ti ti-alert-triangle" style="font-size:11px;color:var(--amber);margin-right:4px" title="Baixo giro"></i>`
        : '';
      return `<div class="dg-giro-mat-row">
        <span class="dg-giro-mat-name" title="${escapeHtml(m.mat)}">${alertIcon}${escapeHtml(m.mat)}</span>
        ${buildCoberturaCell(m.cobertura)}
        <span class="dg-giro-mat-num" style="color:${col};text-align:right">${m.giro.toFixed(2)}×</span>
        <span class="dg-giro-mat-num" style="color:var(--green)" title="${fmtKg(m.entradas)}">${fmtKgShort(m.entradas)}</span>
        <span class="dg-giro-mat-num" style="color:var(--red)" title="${fmtKg(m.saidas)}">${fmtKgShort(m.saidas)}</span>
        <span class="dg-giro-mat-num" style="color:var(--text2)" title="${fmtKg(m.estMedio)}">${fmtKgShort(m.estMedio)}</span>
        ${buildAbastCell(m.entradas, m.saidas, 'baixo')}
      </div>`;
    }).join('');

    // Footer summary for the baixo panel
    const parados  = top10Baixo.filter(m => m.giro < 0.1).length;
    const baixoGiro = top10Baixo.filter(m => m.giro >= 0.1 && m.giro < 1).length;
    const capitalParado = top10Baixo.reduce((s, m) => {
      // Estimate capital = estMedio × avg custo (not available here, use 0 as fallback)
      return s + m.estMedio;
    }, 0);

    const footerHtml = `
      <div style="display:flex;gap:12px;padding:10px 0 2px;border-top:1px solid var(--border);margin-top:8px;flex-wrap:wrap">
        <span style="font-size:10.5px;font-family:var(--mono);color:var(--red);display:flex;align-items:center;gap:5px">
          <i class="ti ti-lock" style="font-size:12px"></i> ${parados} parado${parados!==1?'s':''}
        </span>
        <span style="font-size:10.5px;font-family:var(--mono);color:var(--amber);display:flex;align-items:center;gap:5px">
          <i class="ti ti-alert-triangle" style="font-size:12px"></i> ${baixoGiro} baixo giro
        </span>
        <span style="font-size:10.5px;font-family:var(--mono);color:var(--text3);margin-left:auto" title="${fmtKg(capitalParado)}">
          Est. total parado: ${fmtKgShort(capitalParado)}
        </span>
      </div>`;

    baixoEl.innerHTML = headHtml + baixoRows + footerHtml;
  }

  // Legacy single-panel fallback (if element still exists)
  if (matEl) {
    matEl.innerHTML = headHtml + top10Alto.map(m => buildMatRow(m, maxGiroAlto)).join('');
  }
}


  function renderEntradas() {
  const tb = document.getElementById('tb-entradas');
  if (!tb) return;
  const data = pageSlice('entradas');
  updatePageInfo('entradas');

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
      <td class="td-muted">${r.categoria || '—'}</td>
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

function renderSaidas() {
  const tb = document.getElementById('tb-saidas');
  if (!tb) return;
  const data = pageSlice('saidas');
  updatePageInfo('saidas');

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
      <td class="td-muted">${r.categoria || '—'}</td>
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

  if (!getFilteredData('lancamentos').length) {
    tb.innerHTML = '<tr><td colspan="10"><div class="empty-state"><i class="ti ti-clipboard"></i><p>Nenhum lançamento de saldo real.</p></div></td></tr>';
    return;
  }

  // Mapa de índice de página → objeto real no state (para edição inline)
  window._lancPageData = data;

  tb.innerHTML = data.map((r, i) => `
    <tr>
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
      <td class="td-muted td-editable"
        contenteditable="true" spellcheck="false"
        data-lanc-idx="${i}" data-lanc-field="categoria"
        onkeydown="lancEditKeydown(event)"
        onblur="lancEditSave(this)">${escapeHtml(r.categoria || '—')}</td>
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
  `).join('');
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

  const paresInfo = new Map(); // normKey → { central, mat, categoria }
  sapIdxAll.forEach((matMap, central) => {
    matMap.forEach((arr, mat) => {
      if (!arr.length || !central || !mat || mat === '—') return;
      const key = normalizeText(central) + '|' + normalizeText(mat);
      if (!paresInfo.has(key))
        paresInfo.set(key, { central, mat, categoria: arr[0]?.categoria || '' });
    });
  });
  lancIdxAll.forEach((matMap, central) => {
    matMap.forEach((arr, mat) => {
      if (!arr.length || !central || !mat || mat === '—') return;
      const key = normalizeText(central) + '|' + normalizeText(mat);
      const existing = paresInfo.get(key);
      // Lançamentos têm prioridade de categoria
      paresInfo.set(key, { central, mat,
        categoria: arr[0]?.categoria || existing?.categoria || '' });
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
  paresInfo.forEach(({ central, mat, categoria }, key) => {
    const catKey    = detectCatKey(String(categoria).trim().toUpperCase()) || detectCatFromMat(mat);
    const isSemanal = catKey === 'agregado';
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
      central, mat, isSemanal, categoria: categoria || '—', diasAusentes,
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
  const allMats      = [...new Set(ausencias.map(a => a.mat))].sort();
  _ausFilter.options.regional = allRegionais;
  _ausFilter.options.central  = allCentrals;
  _ausFilter.options.mat      = allMats;
  _ausFilterBuildOptions('regional');
  _ausFilterBuildOptions('central');
  _ausFilterBuildOptions('mat');
  _ausFilterSyncLabel('regional');
  _ausFilterSyncLabel('central');
  _ausFilterSyncLabel('mat');
  _ausFilterSyncClear();

  // ── Aplica filtros ──
  const filtered = ausencias.filter(a =>
    (!_ausFilter.applied.regional.size || _ausFilter.applied.regional.has(a.regional)) &&
    (!_ausFilter.applied.central.size  || _ausFilter.applied.central.has(a.central))   &&
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
  subtitle.innerHTML = `
    <span class="aus-summary-chips">
      <span class="aus-chip red">${lancAusentes} ausência${lancAusentes !== 1 ? 's' : ''}</span>
      <span class="aus-chip amber">${matsUnicos} ${matsUnicos !== 1 ? 'materiais' : 'material'}</span>
      <span class="aus-chip teal">${centrais} ${centrais !== 1 ? 'centrais' : 'central'}</span>
      <span class="aus-chip purple">${regionaisCount} ${regionaisCount !== 1 ? 'regionais' : 'regional'}</span>
      <button onclick="event.stopPropagation();gerarRelatorioAusenciasGeral()"
        style="margin-left:6px;display:inline-flex;align-items:center;gap:5px;background:transparent;
          border:1px solid var(--border2);border-radius:5px;padding:2px 10px;font-size:10.5px;
          font-family:var(--mono);font-weight:600;color:var(--text2);cursor:pointer;
          transition:border-color .15s,color .15s" title="Gerar relatório geral de ausências"
        onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--accent)'"
        onmouseout="this.style.borderColor='var(--border2)';this.style.color='var(--text2)'">
        <i class="ti ti-file-report" style="font-size:12px"></i> Relatório Geral
      </button>
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
        const typeLabel = r.isSemanal ? 'Semanal' : 'Diário';
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
            <span class="aus-mat-type">${typeLabel}</span>
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
  options: { regional: [], central: [], mat: [] },
  applied: { regional: new Set(), central: new Set(), mat: new Set() },
  pending: { regional: new Set(), central: new Set(), mat: new Set() },
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
  const keyLabel = key === 'regional' ? 'Regional' : key === 'central' ? 'Central' : 'Material';
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
  const hasFilter = _ausFilter.applied.regional.size || _ausFilter.applied.central.size || _ausFilter.applied.mat.size || _ausFilter.ocultarZerados;
  btn.disabled = !hasFilter;
  btn.classList.toggle('active', !!hasFilter);
}

function toggleAusFilter(key) {
  const dd   = document.getElementById(`aus-fd-${key}`);
  const chev = document.getElementById(`aus-fc-${key}`);
  const keys = ['regional', 'central', 'mat'];
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
  _ausFilter.applied.mat      = new Set();
  _ausFilter.pending.regional = new Set();
  _ausFilter.pending.central  = new Set();
  _ausFilter.pending.mat      = new Set();
  _ausFilter.ocultarZerados   = false;
  const btnZ = document.getElementById('aus-ft-ocultar-zerados');
  if (btnZ) btnZ.classList.remove('active');
  ['regional','central','mat'].forEach(k => _ausFilterSyncLabel(k));
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
    const trClass = isDupReal ? ' class="sap-duplicata"' : isDupCancelled ? ' class="sap-duplicata-anulada"' : '';
    const trTitle = isDupReal ? ' title="Integração duplicada sem estorno correspondente"' : isDupCancelled ? ' title="Duplicata anulada por estorno"' : '';
    return `
    <tr${trClass}${trTitle}>
      <td class="td-mono">${r.fonte === 'manual' ? '<span class="badge-manual" title="Registro inserido manualmente"><i class="ti ti-pencil"></i></span>' : ''}${r.usuario || '—'}</td>
      <td class="td-mono" style="color:${neg ? red : green}">${r.movimento || '—'}</td>
      <td class="td-muted">${r.ref || '—'}</td>
      <td class="td-mono">${r.documento || '—'}</td>
      <td class="td-mono">${r.central || '—'}</td>
      <td class="td-muted">${r.deposito || '—'}</td>
      <td class="td-muted">${r.dtDoc || '—'}</td>
      <td class="td-muted">${r.dtLanc || '—'}</td>
      <td class="td-muted">${r.dtReg || '—'}</td>
      <td class="td-mono">${r.material || r.materialOriginal || '—'}</td>
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
}

function renderFiliais() {
  const tb = document.getElementById('tb-filiais');
  if (!tb) return;
  const { data, pageData } = getListPageData('filiais');
  updateListPageInfo('filiais');
  if (!data.length) {
    tb.innerHTML = '<tr><td colspan="5"><div class="empty-state"><i class="ti ti-map-pin"></i><p>Nenhuma filial cadastrada.</p></div></td></tr>';
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
}

function renderMateriais() {
  const tb = document.getElementById('tb-materiais');
  if (!tb) return;
  const { data, pageData } = getListPageData('materiais');
  updateListPageInfo('materiais');
  if (!data.length) {
    tb.innerHTML = '<tr><td colspan="5"><div class="empty-state"><i class="ti ti-stack-2"></i><p>Nenhum material cadastrado.</p></div></td></tr>';
    return;
  }
  tb.innerHTML = pageData.map((m, i) => `
    <tr>
      <td class="td-mono">${m.origem}</td>
      <td class="td-mono">${m.alias}</td>
      <td class="td-muted">${m.desc || '—'}</td>
      <td class="td-muted">${m.created || '—'}</td>
      <td><button class="btn-icon danger" onclick="removerMaterial('${m.id}')"><i class="ti ti-trash"></i></button></td>
    </tr>
  `).join('');
  const _tbl_materiais = document.getElementById('tb-materiais')?.closest('table');
  if (_tbl_materiais) injectColFilterButtons(_tbl_materiais, 'materiais');
  updateImportPrereqUI();
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
    if (stateKey) state[stateKey] = state[stateKey].filter(r => !toRemove.has(fp(r)));
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
  const updatedExisting = incoming
    .filter(r => existingByFp.has(fpFn(r)))
    .map(r => {
      const original = existingByFp.get(fpFn(r));
      return { ...r, importId: original.importId };
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
    const ci = (field, fallback) => cm[field] !== undefined ? cm[field] : fallback;
    for (let i = 0; i < total; i += batchSize) {
      updateStep('Lendo entradas e normalizando materiais...');
      await processSlice(i, Math.min(i + batchSize, total), (r) => {
        const materialOriginal = String(r[ci('material', 10)] || '').trim();
        if (!materialOriginal) return null;
        return stamp(normalizarCentraisRecord({
          importId,
          centralCompra:    String(r[ci('centralCompra',  0)] || ''),
          centralDestino:   String(r[ci('centralDestino', 1)] || ''),
          nf:               String(r[ci('nf',             11)] || ''),
          dtEmissao:        fmtDate(r[ci('dtEmissao',     13)]),
          dtDescarga:       fmtDate(r[ci('dtDescarga',     3)]),
          fornecedor:       String(r[ci('fornecedor',      4)] || ''),
          categoria:        String(r[ci('categoria',       9)] || ''),
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
        const peso = num(r[ci('peso', 9)]);
        const custo = num(r[ci('custo', 10)]);
        return stamp(normalizarCentraisRecord({
          importId,
          central:          String(r[ci('central',    0)] || ''),
          dtEmissao:        fmtDate(r[ci('dtEmissao', 1)]),
          os:               String(r[ci('os',         2)] || ''),
          contrato:         String(r[ci('contrato',   3)] || ''),
          categoria:        String(r[ci('categoria',  4)] || ''),
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

        const peso  = toNum(r[ci('peso',  4)]);
        const custo = toNum(r[ci('custo', 5)]);
        return stamp(normalizarCentraisRecord({
          importId,
          dtLanc:          fmtDate(r[ci('dtLanc',   0)]),
          central:         String(r[ci('central',    1)] || ''),
          fornecedor,
          municipio,
          categoria:       String(r[ci('categoria',  3)] || ''),
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
  }).catch(() => {
    const rec = state.imports.find(r => r.id === importId);
    if (rec) {
      rec.status = 'Sem persistência';
      rec.statusTip = 'Falha ao salvar no banco local.';
      renderImports();
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
    _batchImportMode = false;
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
function buildEntradaColumnMap(headerRow) {
  const n = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const map = {};
  const defs = {
    centralCompra:    { exact: ['central compra','central de compra','c. compra','compra','centro compra'] },
    centralDestino:   { exact: ['central destino','central de destino','c. destino','destino','centro destino'] },
    nf:               { exact: ['nf','nota fiscal','n.f.','numero nf','nro. nf','nro nf','num. nf','num nf','documento'] },
    dtEmissao:        { exact: ['dt emissao','dt. emissao','data emissao','data de emissão','dt emissão','data emissão','emissao','emissão'] },
    dtDescarga:       { exact: ['dt descarga','dt. descarga','data descarga','data de descarga','descarga','dt.descarga'] },
    fornecedor:       { exact: ['fornecedor','supplier','forn.','forn'] },
    categoria:        { exact: ['categoria','category','cat.','cat'] },
    material:         { exact: ['material','descricao material','descrição material','produto','item','mat.'] },
    peso:             { exact: ['peso','quantidade','qtde','qtd','weight','qty','peso (kg)','quant.'] },
    um:               { exact: ['um','u.m.','unidade','unit','und'] },
    custo:            { exact: ['custo','custo unit','custo unitario','custo unitário','preco','preço','unit price','valor unit'] },
    valorTotal:       { exact: ['valor total','total','valor','amount','montante','vl total','vl. total'] },
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



// ── Comparativo de períodos ───────────────────────────────────────────────
function _buildCompKpisFromPeriod(dtIni, dtFim) {
  if (!dtIni || !dtFim) return null;
  const results = buildDashboardGerencialResults(dtIni, dtFim);
  if (!results.length) return null;

  // KPIs principais
  const totalEstIni   = results.reduce((s,r) => s + r.somaPrimeiro,    0);
  const totalEntradas = results.reduce((s,r) => s + r.totalEntradas,   0);
  const totalSaidas   = results.reduce((s,r) => s + r.totalSaidas,     0);
  const totalEstFim   = results.reduce((s,r) => s + r.somaUltimo,      0);
  const totalVarEst   = results.reduce((s,r) => s + r.variacaoEstoque, 0);

  let totalCustoVar = 0;
  results.forEach(r => {
    const cmp = r.custoMedioPorMat || {};
    const lancsByMat = new Map(), sapByMat = new Map();
    r.lancsNoPeriodo.forEach(l => { const m=l.material||'—'; if(!lancsByMat.has(m)) lancsByMat.set(m,[]); lancsByMat.get(m).push(l); });
    r.sapNoPeriodo.forEach(s   => { const m=s.material||'—'; if(!sapByMat.has(m))   sapByMat.set(m,[]);   sapByMat.get(m).push(s); });
    (r.allMats||[]).forEach(mat => {
      const cm = cmp[mat] || 0; if (!cm) return;
      const prev   = getPrePeriodLaunchStock({ central: r.central, material: mat, dtIni });
      const fim    = getLastPeriodLaunchStock({ central: r.central, material: mat, dtFim });
      const estIni = prev?.value ?? 0;
      const estFim = (fim && !fim.missing) ? fim.value : 0;
      const sapMat = sapByMat.get(mat) || [];
      let entKg=0, saiKg=0;
      sapMat.forEach(s => { const p=num(s.peso); if(p>0) entKg+=p; else saiKg+=Math.abs(p); });
      totalCustoVar += (estFim - (estIni + entKg - saiKg)) * cm;
    });
  });

  // Giro geral
  let totalSaidasKg=0, totalEstMedioKg=0;
  const periodoEstimado = (() => {
    let mn=null, mx=null;
    results.forEach(r => r.lancsNoPeriodo.forEach(l => {
      const d=parseDate(l.dtLanc); if(!d) return;
      if(!mn||d<mn) mn=d; if(!mx||d>mx) mx=d;
    }));
    return mn&&mx ? Math.max(1, Math.round((mx-mn)/86400000)+1) : 30;
  })();
  results.forEach(r => {
    const lancsByMat=new Map(), sapByMat=new Map();
    r.lancsNoPeriodo.forEach(l=>{const m=l.material||'—';if(!lancsByMat.has(m))lancsByMat.set(m,[]);lancsByMat.get(m).push(l);});
    r.sapNoPeriodo.forEach(s=>{const m=s.material||'—';if(!sapByMat.has(m))sapByMat.set(m,[]);sapByMat.get(m).push(s);});
    r.allMats.forEach(mat=>{
      const snap=buildSnapshot({lancs:lancsByMat.get(mat)||[],sap:sapByMat.get(mat)||[]});
      totalSaidasKg  += Math.abs(snap.totalSai);
      totalEstMedioKg += (snap.pesoIni+snap.pesoFim)/2;
    });
  });
  const giroGeral     = totalEstMedioKg > 0 ? totalSaidasKg/totalEstMedioKg : 0;
  const coberturaGeral= totalSaidasKg   > 0 ? (totalEstMedioKg/totalSaidasKg)*periodoEstimado : null;

  // Saúde centrais
  const thresholds = getHealthThresholds();
  let nCritico=0, nUrgente=0, nAtencao=0, nBom=0;
  results.forEach(r => {
    const lancsByMat=new Map(), sapByMat=new Map(), catByMat=new Map();
    r.lancsNoPeriodo.forEach(l=>{const m=l.material||'—';if(!lancsByMat.has(m))lancsByMat.set(m,[]);lancsByMat.get(m).push(l);});
    r.sapNoPeriodo.forEach(s=>{const m=s.material||'—';if(!sapByMat.has(m))sapByMat.set(m,[]);sapByMat.get(m).push(s);catByMat.set(m,s.categoria||'');});
    const matDiffs=(r.allMats||[]).map(mat=>{
      const prev=getPrePeriodLaunchStock({central:r.central,material:mat,dtIni});
      const fim=getLastPeriodLaunchStockWithFallback({central:r.central,material:mat,dtIni,dtFim});
      const snap=buildSnapshot({lancs:lancsByMat.get(mat)||[],sap:sapByMat.get(mat)||[],
        initialStockOverride:prev?.value??null,initialDateLabelOverride:prev?.dtLabel??null,
        finalStockOverride:fim&&!fim.missing?fim.value:null,finalDateLabelOverride:fim&&!fim.missing?fim.dtLabel:null});
      const rawCat=catByMat.get(mat)||''; const catKey=detectCatKey(rawCat)||detectCatFromMat(mat);
      return {mat,diff:snap.diff,catKey};
    });
    const {hLevel}=calcHealthScore(matDiffs,lancsByMat,sapByMat,thresholds);
    if(hLevel==='critico') nCritico++;
    else if(hLevel==='urgente') nUrgente++;
    else if(hLevel==='atencao') nAtencao++;
    else nBom++;
  });
  const totalCentrals = results.length;
  const pctSaudavel   = totalCentrals > 0 ? Math.round((nBom/totalCentrals)*100) : 0;

  return { totalEstIni, totalEntradas, totalSaidas, totalEstFim, totalVarEst,
           totalCustoVar, giroGeral, coberturaGeral, periodoEstimado,
           totalSaidasKg, totalEstMedioKg,
           nCritico, nUrgente, nAtencao, nBom, totalCentrals, pctSaudavel };
}

function renderDgCustos(results, dtIni, dtFim) {
  const emptyEl   = document.getElementById('custos-empty');
  const contentEl = document.getElementById('custos-content');
  if (!emptyEl || !contentEl) return;
  if (!results || !results.length) {
    emptyEl.style.display   = 'flex';
    contentEl.style.display = 'none';
    return;
  }
  emptyEl.style.display   = 'none';
  contentEl.style.display = 'block';

  // ── Helpers ──────────────────────────────────────────────────────────────
  const filIdx    = getFilialLookupIndex();
  const getRegional = c => (filIdx.exact.get(normalizeText(c))?.regional || '').trim() || 'Sem regional';

  // ── Acumular custo médio por material (média ponderada entre centrais) ───
  const matCusto = new Map(); // mat → { somaValor, somaPeso }
  const matCat   = new Map(); // mat → categoria
  results.forEach(r => {
    const cmp = r.custoMedioPorMat || {};
    r.allMats.forEach(mat => {
      const cm = cmp[mat]; if (!cm) return;
      // Peso para ponderação = saídas SAP do material na central
      const pesoSai = r.sapNoPeriodo
        .filter(s => (s.material||'—') === mat && num(s.peso) < 0)
        .reduce((a,s) => a + Math.abs(num(s.peso)), 0);
      const peso = pesoSai || 1; // fallback 1 para materiais sem saída
      if (!matCusto.has(mat)) matCusto.set(mat, { somaValor:0, somaPeso:0 });
      const mc = matCusto.get(mat);
      mc.somaValor += cm * peso;
      mc.somaPeso  += peso;
      // Categoria: pega do SAP
      if (!matCat.has(mat)) {
        const sRec = r.sapNoPeriodo.find(s => (s.material||'—') === mat);
        const cat  = sRec?.categoria || '';
        const catKey = detectCatKey(cat) || detectCatFromMat(mat) || 'outros';
        matCat.set(mat, { raw: cat, key: catKey });
      }
    });
  });
  const matArr = [...matCusto.entries()]
    .map(([mat, d]) => ({ mat, cm: d.somaPeso > 0 ? d.somaValor/d.somaPeso : 0, ...matCat.get(mat)||{key:'outros',raw:''} }))
    .filter(d => d.cm > 0)
    .sort((a,b) => b.cm - a.cm);

  // ── Custo por categoria ──────────────────────────────────────────────────
  const catMap = new Map();
  matArr.forEach(d => {
    const k = d.key || 'outros';
    if (!catMap.has(k)) catMap.set(k, { mats:[], somaValor:0, somaPeso:0 });
    const c = catMap.get(k);
    c.mats.push(d);
    const mc = matCusto.get(d.mat);
    c.somaValor += mc.somaValor; c.somaPeso += mc.somaPeso;
  });
  const catArr = [...catMap.entries()]
    .map(([k, d]) => ({ key:k, cm: d.somaPeso > 0 ? d.somaValor/d.somaPeso : 0, n: d.mats.length }))
    .sort((a,b) => b.cm - a.cm);
  const maxCatCm = catArr[0]?.cm || 1;

  const catLabel = {aglutinante:'Aglutinante',agregado:'Agregado',aditivo:'Aditivo',fibra:'Fibra',pozolana:'Pozolana',outros:'Outros'};
  const catCor   = {aglutinante:'var(--accent)',agregado:'var(--teal)',aditivo:'var(--purple)',fibra:'var(--green)',pozolana:'var(--amber)',outros:'var(--text3)'};

  document.getElementById('custos-categoria').innerHTML = `
    <div class="custos-grid-card">
      <div class="custos-grid-head">
        <span>Categoria</span><span>Materiais</span><span style="text-align:right">Custo Médio</span><span style="text-align:right">R$/kg</span>
      </div>
      ${catArr.map(d => {
        const cor = catCor[d.key] || 'var(--text3)';
        const pct = (d.cm/maxCatCm*100).toFixed(1);
        return `<div class="custos-grid-row">
          <span class="custos-cat-name" style="color:${cor}">${catLabel[d.key]||d.key}</span>
          <span style="font-size:11px;color:var(--text3);font-family:var(--mono)">${d.n} mat.</span>
          <div style="display:flex;align-items:center;gap:8px;justify-content:flex-end">
            <div class="custos-bar-track"><div class="custos-bar-fill" style="width:${pct}%;background:${cor}"></div></div>
          </div>
          <span class="custos-val">${money(d.cm)}/kg</span>
        </div>`;
      }).join('')}
    </div>`;

  // ── Custo por material ───────────────────────────────────────────────────
  const maxMatCm = matArr[0]?.cm || 1;
  document.getElementById('custos-material').innerHTML = `
    <div class="custos-grid-card">
      <div class="custos-grid-head">
        <span>Material</span><span>Categoria</span><span style="text-align:right">Barra relativa</span><span style="text-align:right">R$/kg</span>
      </div>
      ${matArr.slice(0, 30).map(d => {
        const cor = catCor[d.key] || 'var(--text3)';
        const pct = (d.cm/maxMatCm*100).toFixed(1);
        return `<div class="custos-grid-row">
          <span class="custos-mat-name">${escapeHtml(d.mat)}</span>
          <span style="font-size:10px;color:${cor};font-family:var(--mono)">${catLabel[d.key]||d.key}</span>
          <div style="display:flex;align-items:center;gap:8px;justify-content:flex-end">
            <div class="custos-bar-track"><div class="custos-bar-fill" style="width:${pct}%;background:${cor}"></div></div>
          </div>
          <span class="custos-val">${money(d.cm)}/kg</span>
        </div>`;
      }).join('')}
      ${matArr.length > 30 ? `<div style="padding:8px 14px;font-size:10px;color:var(--text3);font-family:var(--mono)">+ ${matArr.length-30} materiais omitidos</div>` : ''}
    </div>`;

  // ── Custo por regional e central ─────────────────────────────────────────
  const regMap = new Map();
  results.forEach(r => {
    const reg = getRegional(r.central);
    if (!regMap.has(reg)) regMap.set(reg, []);
    const cmp = r.custoMedioPorMat || {};
    const cms = Object.values(cmp).filter(v => v > 0);
    const cmMedia = cms.length ? cms.reduce((a,v)=>a+v,0)/cms.length : 0;
    // Custo total do estoque final × custo médio
    let custoEstFim = 0;
    r.allMats.forEach(mat => {
      const cm = cmp[mat]; if (!cm) return;
      const fim = dtFim ? getLastPeriodLaunchStock({ central: r.central, material: mat, dtFim }) : null;
      custoEstFim += (fim && !fim.missing ? fim.value : 0) * cm;
    });
    regMap.get(reg).push({ central: r.central, cmMedia, custoEstFim, nMats: r.allMats.length });
  });

  const regHtml = [...regMap.entries()].sort((a,b) => a[0].localeCompare(b[0])).map(([reg, centrais]) => {
    const cmRegMedia = centrais.length ? centrais.reduce((a,c)=>a+c.cmMedia,0)/centrais.length : 0;
    const custoRegTotal = centrais.reduce((a,c)=>a+c.custoEstFim,0);
    return `
      <div class="custos-regional-block">
        <div class="custos-regional-header">
          <span class="custos-regional-name"><i class="ti ti-map-pin" style="font-size:11px"></i> ${escapeHtml(reg)}</span>
          <span style="font-size:10px;font-family:var(--mono);color:var(--text3)">${centrais.length} central${centrais.length>1?'is':''}</span>
          <span class="custos-regional-kpi">R$/kg médio: <strong>${money(cmRegMedia)}</strong></span>
          <span class="custos-regional-kpi">Est. Final: <strong>${moneyShort(custoRegTotal)}</strong></span>
        </div>
        <div class="custos-grid-card" style="border-radius:0 0 var(--radius) var(--radius);border-top:none">
          <div class="custos-grid-head">
            <span>Central</span><span>Materiais</span><span style="text-align:right">C. Médio (média)</span><span style="text-align:right">Est. Final (custo)</span>
          </div>
          ${centrais.sort((a,b)=>b.custoEstFim-a.custoEstFim).map(c => `
          <div class="custos-grid-row">
            <span class="custos-mat-name">${escapeHtml(c.central)}</span>
            <span style="font-size:10px;color:var(--text3);font-family:var(--mono)">${c.nMats} mat.</span>
            <span class="custos-val" style="text-align:right">${money(c.cmMedia)}/kg</span>
            <span class="custos-val" style="text-align:right;color:var(--amber)">${moneyShort(c.custoEstFim)}</span>
          </div>`).join('')}
        </div>
      </div>`;
  }).join('');

  document.getElementById('custos-central').innerHTML = regHtml || '<div class="dg-empty-riscos">Sem dados de filial.</div>';

  // ── KPI strip topo ────────────────────────────────────────────────────────
  const totalMats    = matArr.length;
  const cmGeral      = matArr.length ? matArr.reduce((a,d)=>a+d.cm,0)/matArr.length : 0;
  const cmMaior      = matArr[0];
  const cmMenor      = [...matArr].sort((a,b)=>a.cm-b.cm)[0];
  const totalEstFimCusto = results.reduce((tot, r) => {
    const cmp = r.custoMedioPorMat || {};
    let v = 0;
    r.allMats.forEach(mat => {
      const cm = cmp[mat]; if (!cm) return;
      const fim = dtFim ? getLastPeriodLaunchStock({ central: r.central, material: mat, dtFim }) : null;
      v += (fim && !fim.missing ? fim.value : 0) * cm;
    });
    return tot + v;
  }, 0);

  document.getElementById('custos-kpi-strip').innerHTML = `
    <div class="macro-kpi-card kc-amber">
      <div class="macro-kpi-label"><i class="ti ti-coins"></i> Est. Final (custo total)</div>
      <div class="macro-kpi-cost">${moneyShort(totalEstFimCusto)}</div>
      <div class="macro-kpi-sub">Capital imobilizado no estoque</div>
    </div>
    <div class="macro-kpi-card kc-teal">
      <div class="macro-kpi-label"><i class="ti ti-calculator"></i> C. Médio Geral</div>
      <div class="macro-kpi-cost">${money(cmGeral)}/kg</div>
      <div class="macro-kpi-sub">Média aritmética dos materiais</div>
    </div>
    <div class="macro-kpi-card kc-red">
      <div class="macro-kpi-label"><i class="ti ti-trending-up"></i> Material mais caro</div>
      <div class="macro-kpi-cost">${cmMaior ? money(cmMaior.cm)+'/kg' : '—'}</div>
      <div class="macro-kpi-sub">${cmMaior ? escapeHtml(cmMaior.mat) : '—'}</div>
    </div>
    <div class="macro-kpi-card kc-green">
      <div class="macro-kpi-label"><i class="ti ti-trending-down"></i> Material mais barato</div>
      <div class="macro-kpi-cost">${cmMenor ? money(cmMenor.cm)+'/kg' : '—'}</div>
      <div class="macro-kpi-sub">${cmMenor ? escapeHtml(cmMenor.mat) : '—'}</div>
    </div>
    <div class="macro-kpi-card kc-blue">
      <div class="macro-kpi-label"><i class="ti ti-box"></i> Materiais analisados</div>
      <div class="macro-kpi-cost" style="font-size:clamp(18px,2vw,28px)">${totalMats}</div>
      <div class="macro-kpi-sub">Com custo médio calculado</div>
    </div>`;
}
window.renderDgCustos = renderDgCustos;

function rodarComparativo() {
  const iniA = document.getElementById('comp-a-dt-ini')?.value;
  const fimA = document.getElementById('comp-a-dt-fim')?.value;
  const iniB = document.getElementById('comp-b-dt-ini')?.value;
  const fimB = document.getElementById('comp-b-dt-fim')?.value;

  if (!iniA || !fimA || !iniB || !fimB) {
    toast('Selecione os dois períodos para comparar.', 'error');
    return;
  }

  const dtIniA = new Date(iniA + 'T00:00:00'), dtFimA = new Date(fimA + 'T23:59:59');
  const dtIniB = new Date(iniB + 'T00:00:00'), dtFimB = new Date(fimB + 'T23:59:59');

  const kA = _buildCompKpisFromPeriod(dtIniA, dtFimA);
  const kB = _buildCompKpisFromPeriod(dtIniB, dtFimB);

  if (!kA || !kB) { toast('Sem dados para um dos períodos.', 'error'); return; }

  const labelA = `${iniA.slice(8,10)}/${iniA.slice(5,7)} → ${fimA.slice(8,10)}/${fimA.slice(5,7)}/${fimA.slice(0,4)}`;
  const labelB = `${iniB.slice(8,10)}/${iniB.slice(5,7)} → ${fimB.slice(8,10)}/${fimB.slice(5,7)}/${fimB.slice(0,4)}`;

  document.getElementById('comp-label-a').textContent  = labelA;
  document.getElementById('comp-label-b').textContent  = labelB;
  document.getElementById('comp-giro-label-a').textContent = labelA;
  document.getElementById('comp-giro-label-b').textContent = labelB;

  // Delta helpers
  const delta = (a, b) => {
    if (!b || b === 0) return null;
    return ((a - b) / Math.abs(b)) * 100;
  };
  const deltaHtml = (a, b, inverso = false) => {
    const d = delta(a, b);
    if (d === null) return '<span style="color:var(--text3)">—</span>';
    const bom   = inverso ? d < 0 : d > 0;
    const ruim  = inverso ? d > 0 : d < 0;
    const cor   = bom ? 'var(--green)' : ruim ? 'var(--red)' : 'var(--text3)';
    const icon  = bom ? 'ti-trending-up' : ruim ? 'ti-trending-down' : 'ti-minus';
    const sinal = d > 0 ? '+' : '';
    return `<span style="color:${cor};font-family:var(--mono);font-size:11px;display:inline-flex;align-items:center;gap:3px">
      <i class="ti ${icon}" style="font-size:10px"></i>${sinal}${d.toFixed(1)}%</span>`;
  };

  // KPIs comparativos
  const kpiRows = [
    { label:'Est. Inicial (vol.)',   a: fmtKg(kA.totalEstIni),       b: fmtKg(kB.totalEstIni),       dh: deltaHtml(kA.totalEstIni,    kB.totalEstIni)    },
    { label:'Entradas SAP (vol.)',   a: fmtKg(kA.totalEntradas),     b: fmtKg(kB.totalEntradas),     dh: deltaHtml(kA.totalEntradas,  kB.totalEntradas)  },
    { label:'Saídas SAP (vol.)',     a: fmtKg(Math.abs(kA.totalSaidas)),   b: fmtKg(Math.abs(kB.totalSaidas)),   dh: deltaHtml(Math.abs(kA.totalSaidas),  Math.abs(kB.totalSaidas))  },
    { label:'Est. Final (vol.)',     a: fmtKg(kA.totalEstFim),       b: fmtKg(kB.totalEstFim),       dh: deltaHtml(kA.totalEstFim,    kB.totalEstFim)    },
    { label:'Variação (vol.)',       a: fmtKg(kA.totalVarEst),       b: fmtKg(kB.totalVarEst),       dh: deltaHtml(kA.totalVarEst,    kB.totalVarEst,    true) },
    { label:'Custo variação',        a: money(Math.abs(kA.totalCustoVar)), b: money(Math.abs(kB.totalCustoVar)), dh: deltaHtml(Math.abs(kA.totalCustoVar), Math.abs(kB.totalCustoVar), true) },
    { label:'Giro geral',            a: kA.giroGeral.toFixed(2)+'×', b: kB.giroGeral.toFixed(2)+'×', dh: deltaHtml(kA.giroGeral,      kB.giroGeral)      },
    { label:'Cobertura média',       a: kA.coberturaGeral ? kA.coberturaGeral.toFixed(1)+'d' : '—', b: kB.coberturaGeral ? kB.coberturaGeral.toFixed(1)+'d' : '—', dh: deltaHtml(kA.coberturaGeral, kB.coberturaGeral) },
    { label:'Centrais saudáveis',    a: kA.pctSaudavel+'%',          b: kB.pctSaudavel+'%',          dh: deltaHtml(kA.pctSaudavel,    kB.pctSaudavel)    },
    { label:'Período (dias)',        a: kA.periodoEstimado+'d',       b: kB.periodoEstimado+'d',      dh: '—' },
  ];

  document.getElementById('comp-kpis-body').innerHTML = kpiRows.map(r => `
    <div class="comp-kpi-row">
      <div class="comp-kpi-label-col">${r.label}</div>
      <div class="comp-kpi-val-a">${r.a}</div>
      <div class="comp-kpi-val-delta">${r.dh}</div>
      <div class="comp-kpi-val-b">${r.b}</div>
    </div>`).join('');

  // Giro por central comparativo
  const _giroCentralHtml = (k, dtIni, dtFim) => {
    const results2 = buildDashboardGerencialResults(dtIni, dtFim);
    if (!results2.length) return '<div class="dg-empty-riscos">Sem dados.</div>';
    const periodoEst = k.periodoEstimado;
    const rows = results2.map(r => {
      const lancsByMat=new Map(), sapByMat=new Map();
      r.lancsNoPeriodo.forEach(l=>{const m=l.material||'—';if(!lancsByMat.has(m))lancsByMat.set(m,[]);lancsByMat.get(m).push(l);});
      r.sapNoPeriodo.forEach(s=>{const m=s.material||'—';if(!sapByMat.has(m))sapByMat.set(m,[]);sapByMat.get(m).push(s);});
      let sai=0, estM=0;
      r.allMats.forEach(mat=>{
        const snap=buildSnapshot({lancs:lancsByMat.get(mat)||[],sap:sapByMat.get(mat)||[]});
        sai+=Math.abs(snap.totalSai); estM+=(snap.pesoIni+snap.pesoFim)/2;
      });
      const giro=estM>0?sai/estM:0;
      const cob =sai>0?(estM/sai)*periodoEst:null;
      const cor = giro>4?'var(--red)':giro>=2?'var(--green)':giro>=1?'var(--teal)':'var(--amber)';
      return `<div class="comp-giro-row">
        <span class="comp-giro-central">${escapeHtml(r.central)}</span>
        <span style="color:${cor};font-family:var(--mono);font-size:12px;font-weight:700">${giro.toFixed(2)}×</span>
        <span style="font-family:var(--mono);font-size:11px;color:var(--text3)">${cob?cob.toFixed(1)+'d':'—'}</span>
      </div>`;
    }).sort((a,b)=>0).join('');
    return `<div class="comp-giro-grid">
      <div class="comp-giro-head"><span>Central</span><span>Giro</span><span>Cobertura</span></div>
      ${rows}
    </div>`;
  };

  document.getElementById('comp-giro-a').innerHTML = _giroCentralHtml(kA, dtIniA, dtFimA);
  document.getElementById('comp-giro-b').innerHTML = _giroCentralHtml(kB, dtIniB, dtFimB);

  // Saúde
  const _saudeHtml = (k, label, cor) => `
    <div class="comp-saude-card">
      <div class="comp-col-header" style="color:${cor}"><i class="ti ti-heart-rate-monitor"></i> ${label}</div>
      <div class="comp-saude-score" style="color:${k.pctSaudavel>=80?'var(--green)':k.pctSaudavel>=60?'var(--amber)':'var(--red)'}">${k.pctSaudavel}% saudável</div>
      <div class="comp-saude-counts">
        <span style="color:var(--red)"><i class="ti ti-flame"></i> ${k.nCritico} crítico</span>
        <span style="color:#f97316"><i class="ti ti-alert-circle"></i> ${k.nUrgente} urgente</span>
        <span style="color:var(--amber)"><i class="ti ti-alert-triangle"></i> ${k.nAtencao} atenção</span>
        <span style="color:var(--green)"><i class="ti ti-circle-check"></i> ${k.nBom} bom</span>
      </div>
    </div>`;

  document.getElementById('comp-saude-a').innerHTML = _saudeHtml(kA, labelA, 'var(--accent)');
  document.getElementById('comp-saude-b').innerHTML = _saudeHtml(kB, labelB, 'var(--amber)');

  document.getElementById('comp-empty').style.display   = 'none';
  document.getElementById('comp-content').style.display = 'block';
}
window.rodarComparativo = rodarComparativo;

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
  inventario: () => renderInventario(),
  importar: () => renderImports(),
  configuracoes: () => { renderConfigs(); renderAcoesRelatorio(); loadHealthConfigInputs(); updateParamGerais(); },
  filiais: () => renderFiliais(),
  materiais: () => renderMateriais(),
  ocorrencias: () => renderOcorrenciasPage()
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
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

  try {
    // ── STEP 1: Ler banco de dados ────────────────────────────────────────
    _lstepSet('idb', 'running');
    updateLoadingOverlay('Lendo o banco de dados local...', 'Inicializando o sistema');
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
    await loadState();
    _lstepSet('idb', 'done');
    _lbarSet(15);
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

    // ── STEP 2: Estado já foi aplicado em loadState (applySavedState) ────
    _lstepSet('state', 'running');
    updateLoadingOverlay('Restaurando estado da sessão anterior...', 'Inicializando o sistema');
    await new Promise(r => setTimeout(r, 0));
    // Corrige status de importações pendentes (já feito em applySavedState, confirma)
    if (Array.isArray(state.imports)) {
      state.imports.forEach(rec => {
        if (rec.status === 'Processando') { rec.status = 'Salvo'; rec.statusTip = 'Registros salvos com sucesso'; }
      });
    }
    _lstepSet('state', 'done');
    _lbarSet(30);
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

    // ── STEP 3: Padronizar materiais ─────────────────────────────────────
    const totalRecs = (state.entradas?.length || 0) + (state.saidas?.length || 0) +
                      (state.lancamentos?.length || 0) + (state.sap?.length || 0);
    if (totalRecs > 0) {
      _lstepSet('norm', 'running');
      updateLoadingOverlay(`Padronizando materiais — ${totalRecs.toLocaleString('pt-BR')} registros...`, 'Inicializando o sistema');
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
      if (typeof reaplicarPadronizacaoMateriais === 'function') {
        reaplicarPadronizacaoMateriais();
      }
      _lstepSet('norm', 'done');
    } else {
      _lstepSet('norm', 'skip');
    }
    _lbarSet(50);
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

    // ── STEP 4: Construir índices de busca ───────────────────────────────
    _lstepSet('index', 'running');
    updateLoadingOverlay('Construindo índices de busca e navegação...', 'Inicializando o sistema');
    await new Promise(r => setTimeout(r, 0));
    invalidateLancIndex();
    invalidateSapIndex();
    invalidateSaidasIndex();
    invalidateAllSearchIndexes();
    // Pré-aquece os índices mais pesados para que a primeira interação seja rápida
    if (typeof getLancIndex === 'function') getLancIndex();
    if (typeof getSapIndex === 'function') getSapIndex();
    _lstepSet('index', 'done');
    _lbarSet(65);
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

    // ── STEP 5: Alertas e ocorrências ────────────────────────────────────
    _lstepSet('notif', 'running');
    updateLoadingOverlay('Verificando alertas e ocorrências...', 'Inicializando o sistema');
    await new Promise(r => setTimeout(r, 0));
    if (typeof notifSync === 'function') notifSync(null);
    _lstepSet('notif', 'done');
    _lbarSet(70);
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

    // ── STEP 6: Saúde do estoque ──────────────────────────────────────────
    _lstepSet('health', 'running');
    updateLoadingOverlay('Calculando saúde do estoque...', 'Inicializando o sistema');
    await new Promise(r => setTimeout(r, 0));
    if (typeof notifSilentHealthCheck === 'function') {
      await notifSilentHealthCheck();
    }
    _lstepSet('health', 'done');
    _lbarSet(75);
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

    // ── STEP 7: Montar interface ──────────────────────────────────────────
    _lstepSet('ui', 'running');
    updateLoadingOverlay('Montando a interface...', 'Inicializando o sistema');
    await new Promise(r => setTimeout(r, 0));
    updateDashboard();
    updateParamGerais();
    await new Promise(r => setTimeout(r, 0));
    renderFiliais();
    renderMateriais();
    await new Promise(r => setTimeout(r, 0));
    const activePage = document.querySelector('.page.active')?.id?.replace('page-', '') || 'importar';
    renderPage(activePage);
    await new Promise(r => setTimeout(r, 0));
    initResizable();
    if (!Array.isArray(state.notifications)) state.notifications = [];
    if (typeof _notifRenderBadge === 'function') _notifRenderBadge();
    _lstepSet('ui', 'done');
    _lbarSet(88);
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

    // ── STEP 8: Salvar estado ─────────────────────────────────────────────
    _lstepSet('save', 'running');
    updateLoadingOverlay('Salvando estado no banco local...', 'Inicializando o sistema');
    await new Promise(r => setTimeout(r, 0));
    if (typeof persistStateNow === 'function') {
      try { await persistStateNow(); } catch(e) { console.warn('[Boot] persist:', e); }
    }
    _lstepSet('save', 'done');
    _lbarSet(100);
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

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
