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

    // Correção 2: Est. Final — itera de trás para frente acumulando o último dia,
    // igual ao Inventário, garantindo ordem correta independente da posição nos dados.
    const _macroPesoFimSoma = {};
    allMats.forEach(mat => {
      const lancAteFimMat = lancsNoPeriodo.filter(r => {
        const d = parseDate(r.dtLanc);
        return (r.material || '—') === mat && d && d <= (dtFim || new Date(8640000000000000));
      });
      if (!lancAteFimMat.length) return;
      const lastD = parseDate(lancAteFimMat[lancAteFimMat.length - 1].dtLanc);
      if (!lastD) return;
      const lastISO = lastD.toISOString().substring(0, 10);
      let tot = 0;
      for (let i = lancAteFimMat.length - 1; i >= 0; i--) {
        const d = parseDate(lancAteFimMat[i].dtLanc);
        if (d && d.toISOString().substring(0, 10) === lastISO) tot += num(lancAteFimMat[i].peso);
        else break;
      }
      _macroPesoFimSoma[mat] = tot;
    });

    // Correção 1: usa getPrePeriodLaunchStock como prioridade para Est. Inicial,
    // igual ao Analítico — garante consistência quando há lançamentos antes do período.
    let somaPrimeiro = 0, somaUltimo = 0;
    allMats.forEach(mat => {
      const prev = dtIni ? getPrePeriodLaunchStock({ central, material: mat, dtIni }) : null;
      somaPrimeiro += (prev != null ? prev.value : (_macroPesoIniSoma[mat] ?? num(materiaisLancPrimeiro[mat]?.peso)));
      somaUltimo   += (_macroPesoFimSoma[mat] ?? num(materiaisLancUltimo[mat]?.peso));
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
      allMats: [...allMats].sort(),
      materiaisLancPrimeiro, materiaisLancUltimo,
      sapNoPeriodo, lancsNoPeriodo, custoMedioPorMat
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
  // Mostrar conteúdo, esconder empty state
  const emptyEl   = document.getElementById('dg-empty-state');
  const contentEl = document.getElementById('dg-content');
  if (emptyEl)   emptyEl.style.display   = 'none';
  if (contentEl) contentEl.style.display = '';
  _renderDashboardConteudo(dtIni, dtFim);
  if (window.updatePeriodFab) updatePeriodFab();
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
      // Est. Inicial por material: getPrePeriodLaunchStock (dia anterior ao período)
      // com fallback para primeiro dia dentro do período — mesmo que buildDashboardGerencialResults
      const prevStock = dtIni ? getPrePeriodLaunchStock({ central: r.central, material: mat, dtIni }) : null;
      const lancsMat = lancsByMat.get(mat) || [];
      let iniVol = 0;
      if (prevStock != null) {
        iniVol = prevStock.value;
      } else if (lancsMat.length) {
        // fallback: soma do primeiro dia dentro do período
        const lancsAsc = [...lancsMat].sort((a, b) => {
          const da = parseDate(a.dtLanc), db = parseDate(b.dtLanc);
          return dateCmp(da ?? new Date(0), db ?? new Date(0));
        });
        const firstDKey = localISODate(parseDate(lancsAsc[0].dtLanc));
        iniVol = lancsAsc
          .filter(l => localISODate(parseDate(l.dtLanc)) === firstDKey)
          .reduce((s, l) => s + num(l.peso), 0);
      }
      // Est. Final por material: soma do último dia dentro do período
      let fimVol = 0;
      if (lancsMat.length) {
        const lancsDesc = [...lancsMat].sort((a, b) => {
          const da = parseDate(a.dtLanc), db = parseDate(b.dtLanc);
          return dateCmp(db ?? new Date(0), da ?? new Date(0));
        });
        const lastDKey = localISODate(parseDate(lancsDesc[0].dtLanc));
        fimVol = lancsDesc
          .filter(l => localISODate(parseDate(l.dtLanc)) === lastDKey)
          .reduce((s, l) => s + num(l.peso), 0);
      }
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

  // Custo variação: para cada material, variação (diff) × custo médio.
  // Usa initialStockOverride (getPrePeriodLaunchStock) para garantir que o
  // diff seja idêntico ao calculado no Dashboard Analítico para o mesmo período.
  let totalCustoVar = 0;
  results.forEach(r => {
    const cmp        = r.custoMedioPorMat || {};
    const lancsByMat = new Map();
    const sapByMat   = new Map();
    r.lancsNoPeriodo.forEach(l => { const m = l.material||'—'; if(!lancsByMat.has(m)) lancsByMat.set(m,[]); lancsByMat.get(m).push(l); });
    r.sapNoPeriodo.forEach(s => { const m = s.material||'—'; if(!sapByMat.has(m)) sapByMat.set(m,[]); sapByMat.get(m).push(s); });
    (r.allMats||[]).forEach(mat => {
      const prev    = dtIni ? getPrePeriodLaunchStock({ central: r.central, material: mat, dtIni }) : null;
      const snap    = buildSnapshot({
        lancs: lancsByMat.get(mat)||[],
        sap:   sapByMat.get(mat)||[],
        initialStockOverride: prev?.value ?? null,
        initialDateLabelOverride: prev?.dtLabel ?? null
      });
      const custMed = cmp[mat] || 0;
      if (custMed > 0) totalCustoVar += snap.diff * custMed;
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

  const risks = [];

  const badgeHtml = (lvl, txt) => {
    const styles = {
      critico: 'background:var(--red-bg);color:var(--red);border:1px solid var(--red-border)',
      urgente: 'background:rgba(249,115,22,0.10);color:#f97316;border:1px solid rgba(249,115,22,0.22)',
      atencao: 'background:var(--amber-bg);color:var(--amber);border:1px solid var(--amber-border)',
      info:    'background:var(--accent-dim);color:var(--accent);border:1px solid var(--accent-glow)',
    };
    return `<span class="dg-risco-badge" style="${styles[lvl]||styles.info}">${txt}</span>`;
  };

  results.forEach(r => {
    const lancsByMat = new Map();
    const sapByMat   = new Map();
    r.lancsNoPeriodo.forEach(l => { const m=l.material||'—'; if(!lancsByMat.has(m)) lancsByMat.set(m,[]); lancsByMat.get(m).push(l); });
    r.sapNoPeriodo.forEach(s => { const m=s.material||'—'; if(!sapByMat.has(m)) sapByMat.set(m,[]); sapByMat.get(m).push(s); });

    const matDiffs = r.allMats.map(mat => {
      const snap = buildSnapshot({ lancs: lancsByMat.get(mat)||[], sap: sapByMat.get(mat)||[] });
      const rawCat = (lancsByMat.get(mat)||[])[0]?.categoria || '';
      const catKey = detectCatKey(rawCat) || detectCatFromMat(mat);
      return { mat, diff: snap.diff, catKey, snap };
    });

    const { level, counts } = calcHealthScore(matDiffs, lancsByMat, sapByMat, thresholds);

    // Risk 1: Central crítica
    if (level === 'critico') {
      risks.push({ severity: 'critico', icon: 'ti-flame', desc: `Central <strong>${escapeHtml(r.central)}</strong> em estado CRÍTICO`, meta: `${counts.critico} mat. crítico(s) · ${counts.urgente} urgente(s)`, badge: badgeHtml('critico','CRÍTICO') });
    }

    // Risk 2: Central urgente
    if (level === 'urgente') {
      risks.push({ severity: 'urgente', icon: 'ti-alert-circle', desc: `Central <strong>${escapeHtml(r.central)}</strong> em estado URGENTE`, meta: `${counts.urgente} mat. urgente(s) · ${counts.atencao} em atenção`, badge: badgeHtml('urgente','URGENTE') });
    }

    // Risk 3: Material migrando para pior estado (high diff materials)
    const criticos = matDiffs.filter(m => classifyVariation(Math.abs(m.diff), m.catKey, thresholds) === 'critico');
    if (criticos.length) {
      const worst = criticos.sort((a,b) => Math.abs(b.diff)-Math.abs(a.diff))[0];
      risks.push({ severity: 'critico', icon: 'ti-trending-up', desc: `Material <strong>${escapeHtml(worst.mat)}</strong> com variação crítica em <strong>${escapeHtml(r.central)}</strong>`, meta: `Variação: ${varSymbol(worst.diff)} ${fmtKg(Math.abs(worst.diff))}`, badge: badgeHtml('critico','CRÍTICO') });
    }

    // Risk 4: Crescimento acelerado do desfalque
    const totalDiff = matDiffs.reduce((s,m)=>s+m.diff,0);
    if (totalDiff < -500) {
      risks.push({ severity: 'urgente', icon: 'ti-trending-down', desc: `Crescimento acelerado do desfalque em <strong>${escapeHtml(r.central)}</strong>`, meta: `Déficit acumulado: ${fmtKg(Math.abs(totalDiff))}`, badge: badgeHtml('urgente','DESFALQUE') });
    }

    // Risk 5: Custo médio elevado
    const custos = Object.values(r.custoMedioPorMat).filter(v=>v>0);
    if (custos.length) {
      const maxCusto = Math.max(...custos);
      if (maxCusto > 1000) {
        const matMaxCusto = Object.keys(r.custoMedioPorMat).find(k=>r.custoMedioPorMat[k]===maxCusto);
        risks.push({ severity: 'atencao', icon: 'ti-currency-dollar', desc: `Alto custo médio unitário: <strong>${escapeHtml(matMaxCusto||'—')}</strong> em <strong>${escapeHtml(r.central)}</strong>`, meta: `Custo médio: ${money(maxCusto)}/KG`, badge: badgeHtml('atencao','CUSTO ALTO') });
      }
    }

    // Risk 6: Material em atenção com tendência (diff negativo)
    const emAtencao = matDiffs.filter(m => classifyVariation(Math.abs(m.diff), m.catKey, thresholds) === 'atencao' && m.diff < 0);
    if (emAtencao.length >= 2) {
      risks.push({ severity: 'atencao', icon: 'ti-alert-triangle', desc: `${emAtencao.length} materiais em ATENÇÃO com tendência negativa em <strong>${escapeHtml(r.central)}</strong>`, meta: `Monitorar: ${emAtencao.slice(0,3).map(m=>m.mat).join(', ')}`, badge: badgeHtml('atencao','ATENÇÃO') });
    }
  });

  // Risk: Sem lançamentos
  const semLanc = results.filter(r => !r.lancsNoPeriodo.length);
  if (semLanc.length) {
    risks.push({ severity: 'atencao', icon: 'ti-clipboard-off', desc: `${semLanc.length} central(is) sem lançamentos no período`, meta: semLanc.slice(0,3).map(r=>r.central).join(', '), badge: badgeHtml('atencao','SEM DADOS') });
  }

  // Sort: critico > urgente > atencao
  const order = { critico:0, urgente:1, atencao:2, info:3 };
  risks.sort((a,b) => (order[a.severity]||3) - (order[b.severity]||3));

  const top10 = risks.slice(0,10);

  if (!top10.length) {
    el.innerHTML = '<div class="dg-empty-riscos"><i class="ti ti-shield-check" style="color:var(--green)"></i><span style="color:var(--green)">Nenhum risco emergente identificado. Operação dentro dos parâmetros.</span></div>';
    return;
  }

  el.innerHTML = top10.map(r => `
    <div class="dg-risco-item">
      <div class="dg-risco-icon ${r.severity}"><i class="ti ${r.icon}"></i></div>
      <div class="dg-risco-content">
        <div class="dg-risco-desc">${r.desc}</div>
        <div class="dg-risco-meta">${r.meta}</div>
      </div>
      ${r.badge}
    </div>`).join('');
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
      <td class="td-mono">${r.centralCompra || '—'}</td>
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
      <td class="td-mono">${r.central || '—'}</td>
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
  const data = pageSlice('lancamentos');
  updatePageInfo('lancamentos');

  if (!getFilteredData('lancamentos').length) {
    tb.innerHTML = '<tr><td colspan="10"><div class="empty-state"><i class="ti ti-clipboard"></i><p>Nenhum lançamento de saldo real.</p></div></td></tr>';
    return;
  }

  tb.innerHTML = data.map((r, i) => `
    <tr>
      <td class="td-mono">${r.central || '—'}</td>
      <td class="td-muted">${r.dtLanc || '—'}</td>
      <td>${r.fornecedor || '—'}</td>
      <td class="td-muted">${r.categoria || '—'}</td>
      <td class="td-mono">${r.material || r.materialOriginal || '—'}</td>
      <td class="td-mono" style="color:var(--teal)">${num(r.peso) || 0}</td>
      <td>${r.um || '—'}</td>
      <td class="td-mono">${money(r.custo)}</td>
      <td class="td-mono">${money(r.valorTotal)}</td>
      <td><button class="btn-icon danger" onclick="removerRegistro('lancamentos', ${i})"><i class="ti ti-trash"></i></button></td>
    </tr>
  `).join('');
  makeResizable(tb.closest('table'));
  injectColFilterButtons(tb.closest('table'), 'lancamentos');
}

function renderSAP() {
  const tb = document.getElementById('tb-sap');
  if (!tb) return;
  const data = pageSlice('sap');
  updatePageInfo('sap');

  if (!getFilteredData('sap').length) {
    tb.innerHTML = '<tr><td colspan="15"><div class="empty-state"><i class="ti ti-database"></i><p>Nenhuma movimentação SAP importada.</p></div></td></tr>';
    return;
  }

  tb.innerHTML = data.map((r, i) => {
    const neg = num(r.peso) < 0;
    const red = '#ef4444';
    const green = '#22c55e';
    const text = 'inherit';
    return `
    <tr>
      <td class="td-mono">${r.usuario || '—'}</td>
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
      <td class="td-mono">${r.mes || '—'}</td>
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
    case 'configuracoes': renderConfigs(); loadHealthConfigInputs(); updateParamGerais(); return;
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

function removerImportById(importId) {
  const removeFrom = key => { state[key] = state[key].filter(r => r.importId !== importId); };
  ['entradas','saidas','lancamentos','sap','producao','filiais','materiais'].forEach(removeFrom);
  state.imports = state.imports.filter(r => r.id !== importId);
  // Invalida todos os índices ao remover uma importação inteira
  invalidateLancIndex();
  invalidateSapIndex();
  invalidateSaidasIndex();
  invalidateAllSearchIndexes();
}

async function processImportedRows(modulo, rows, fileName, extra = {}) {
  // Ativa modo batch: desabilita fuzzy matching em normalizarMaterial
  // para evitar Maximum call stack size exceeded com arquivos grandes.
  _batchImportMode = true;
  try {
  const importId = `imp_${modulo}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const parsed = [];
  const total = rows.length || 0;
  const batchSize = Math.max(200, Math.min(700, Math.floor(total / 8) || 300));

  const updateStep = (message) => {
    if (isLoadingOverlayVisible()) {
      updateLoadingOverlay(message, `Importando ${modulo}`, message);
    }
  };

  const processSlice = async (start, end, handler) => {
    for (let i = start; i < end; i++) {
      const item = handler(rows[i]);
      if (item) parsed.push(item);
    }
    if (isLoadingOverlayVisible()) {
      updateLoadingOverlay(`Lidos ${Math.min(end, total)} de ${total} registros`, `Importando ${modulo}`, 'Convertendo lotes para o armazenamento local...');
    }
    await nextFrame();
  };

  if (modulo === 'Entrada') {
    for (let i = 0; i < total; i += batchSize) {
      updateStep('Lendo entradas e normalizando materiais...');
      await processSlice(i, Math.min(i + batchSize, total), (r) => {
        const materialOriginal = String(r[10] || '').trim();
        return stamp(normalizarCentraisRecord({
          importId,
          centralCompra: String(r[0] || ''),
          centralDestino: String(r[1] || ''),
          nf: String(r[11] || ''),
          dtEmissao: fmtDate(r[13]),
          dtDescarga: fmtDate(r[3]),
          fornecedor: String(r[4] || ''),
          categoria: String(r[9] || ''),
          materialOriginal,
          material: normalizarMaterial(materialOriginal),
          peso: num(r[18]),
          um: String(r[17] || ''),
          custo: num(r[19]),
          valorTotal: num(r[20])
        }, ['centralCompra','centralDestino']));
      });
    }
    state.entradas = [...parsed.filter(r => r.material || r.nf), ...state.entradas];
  } else if (modulo === 'Saída') {
    for (let i = 0; i < total; i += batchSize) {
      updateStep('Lendo saídas e conferindo saldos...');
      await processSlice(i, Math.min(i + batchSize, total), (r) => {
        const materialOriginal = String(r[6] || '').trim();
        return stamp(normalizarCentraisRecord({
          importId,
          central: String(r[0] || ''),
          dtEmissao: fmtDate(r[1]),
          os: String(r[2] || ''),
          contrato: String(r[3] || ''),
          categoria: String(r[4] || ''),
          fornecedor: String(r[5] || ''),
          materialOriginal,
          material: normalizarMaterial(materialOriginal),
          peso: num(r[9]),
          um: 'KG',
          custo: num(r[10]),
          valorTotal: num(r[9]) * num(r[10])
        }, ['central']));
      });
    }
    state.saidas = [...parsed.filter(r => r.material || r.os), ...state.saidas];
  } else if (modulo === 'Lançamento') {
    for (let i = 0; i < total; i += batchSize) {
      updateStep('Consolidando lançamentos...');
      await processSlice(i, Math.min(i + batchSize, total), (r) => {
        const partes = String(r[2] || '')
          .split(/\s*\|\s*/)
          .map(v => v.trim())
          .filter(Boolean);

        const materialOriginal = partes[0] || '';
        const fornecedor = partes[1] || '';
        const municipio = partes[2] || '';
        const material = normalizarMaterial(materialOriginal);

        return stamp(normalizarCentraisRecord({
          importId,
          dtLanc: fmtDate(r[0]),
          central: String(r[1] || ''),
          fornecedor,
          municipio,
          categoria: String(r[3] || ''),
          materialOriginal,
          material,
          peso: num(r[4]),
          um: 'KG',
          custo: num(r[5]),
          valorTotal: num(r[4]) * num(r[5])
        }, ['central']));
      });
    }
    state.lancamentos = [...parsed.filter(r => r.material), ...state.lancamentos];
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
        // O MB51 insere 1 linha de total por material ao final de cada grupo.
        // Essas linhas têm: usuário='', tipo_movimento='', documento='', datas=''
        // mas TÊM material e quantidade preenchidos (totais agregados).
        // Se entrassem como dados, corromperiam todos os cálculos de estoque.
        const usuarioRaw  = String(r[ci('usuario',   0)] ?? '').trim();
        const movRaw      = String(r[ci('movimento', 1)] ?? '').trim();
        const docRaw      = String(r[ci('documento', 4)] ?? '').trim();
        const isSubtotal  = !usuarioRaw && !movRaw && !docRaw;
        if (isSubtotal) return null;

        const peso = num(r[ci('peso', 11)]);
        const valorTotal = num(r[ci('valorTotal', 13)]);
        const materialOriginal = String(r[ci('material', 10)] || '').trim();

        // Descarta linhas completamente vazias
        if (!materialOriginal && !docRaw) return null;

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
    state.sap = [...parsed.filter(r => r.material || r.documento), ...state.sap];
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
    state.producao = [...parsed.filter(r => r.central || r.producao), ...state.producao];
  }

  if (!parsed.length) {
    toast('Nenhum registro válido encontrado', 'error');
    return;
  }

  updateStep('Salvando e atualizando os painéis...');

  // Invalida os índices dos módulos que foram alterados para forçar reconstrução
  if (modulo === 'Entrada')     invalidateSearchIndex('entradas');
  if (modulo === 'Saída')       { invalidateSaidasIndex(); }
  if (modulo === 'Lançamento')  invalidateLancIndex();
  if (modulo === 'SAP')         invalidateSapIndex();

  state.imports.unshift({
    id: importId,
    arquivo: fileName,
    modulo,
    registros: parsed.length,
    dataHora: new Date().toLocaleString('pt-BR'),
    status: 'Importado',
    createdAt: Date.now()
  });

  persist();
  renderImports();
  renderModule(pageFromModulo(modulo));
  updateDashboard();
  await nextFrame();
  initResizable();
  toast(`${parsed.length} registros importados de "${fileName}"`);
  } finally {
    // Desativa modo batch — fuzzy matching volta a funcionar normalmente
    _batchImportMode = false;
  }
}

// ─── Detecção automática da linha de cabeçalho para o MB51 do SAP ───────────
// O relatório MB51 exportado do SAP costuma ter linhas de título/metadados
// ANTES da linha de cabeçalho real das colunas. Esta função varre as primeiras
// linhas em busca de palavras-chave típicas do cabeçalho do MB51.
function detectSapHeaderRow(rows) {
  // Palavras-chave que tipicamente aparecem no cabeçalho real do MB51
  const SAP_HEADER_KEYWORDS = [
    'usuario', 'usuário', 'user', 'nome do usuario',
    'tp.mv', 'tp. mv', 'tipo', 'movimento', 'tpmv', 't.mv',
    'material', 'cod.', 'código',
    'quantidade', 'qtde', 'qtd.', 'amount',
    'valor', 'value',
    'centro', 'depot', 'deposito', 'depósito',
    'data', 'date', 'dt.'
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
      exact:  ['usuario', 'nome do usuario', 'user', 'nome usuario', 'nome do usuário', 'usuário'],
      starts: ['nome do usu']
    },
    movimento: {
      exact:  ['tp.mv', 'tp. mv', 'tpmv', 't.mv', 'tipo de movimento', 'movimento', 'mov', 'mvt', 'tipo mov', 'tipo mvt'],
      starts: ['tp.mv', 'tp. mv', 'tipo de mov', 'tipo mov']
    },
    ref:       {
      exact:  ['ref.doc.', 'ref. doc.', 'ref doc', 'referencia', 'referência', 'nro.ref.', 'nro. ref.', 'ref'],
      starts: ['ref.doc', 'ref. doc', 'nro.ref', 'nro. ref']
    },
    documento: {
      // "doc.material" é o número do documento SAP — NÃO é a descrição do material.
      exact:  ['doc.material', 'doc. material', 'documento', 'doc.mat.', 'doc. mat.', 'num.doc.mat.', 'num doc mat', 'doc material'],
      starts: ['doc.mat', 'num.doc.mat', 'doc.material', 'doc. material']
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
      starts: ['dt.doc', 'dt. doc', 'data doc', 'data do doc']
    },
    dtLanc:    {
      exact:  ['dt.lancamento', 'dt. lancamento', 'data lancamento', 'data lançamento', 'dt.lanc.', 'dt. lanç.', 'entry date', 'data entrada'],
      starts: ['dt.lanc', 'dt. lanc', 'data lanc', 'data lança', 'entry date']
    },
    dtReg:     {
      exact:  ['dt.registro', 'dt. registro', 'data registro', 'dt.reg.', 'dt. reg.', 'creation date'],
      starts: ['dt.reg', 'dt. reg', 'data reg', 'creation date']
    },
    material:  {
      // SOMENTE aliases que identificam inequivocamente a descrição do material.
      // "material" sozinho foi REMOVIDO: "doc.material" contém essa string e seria
      // capturado erroneamente. O campo correto no MB51 é "Texto breve material".
      exact:  ['texto breve material', 'texto breve do material', 'texto breve', 'descricao material',
               'descrição material', 'texto breve de material', 'short text', 'material description', 'material text'],
      starts: ['texto breve', 'descricao material', 'descrição material', 'short text', 'material desc', 'material text']
    },
    peso:      {
      exact:  ['quantidade', 'qtde', 'qtd.', 'qtd', 'qty', 'amount', 'quantidade em um.', 'quant.', 'quantidade em um'],
      starts: ['quantidade', 'qtde', 'qtd', 'qty', 'quant']
    },
    um:        {
      exact:  ['umb', 'um', 'u.m.', 'unid.', 'unidade', 'unit', 'u.m.b.', 'um base'],
      starts: ['u.m.', 'u.m.b', 'unid']
    },
    valorTotal:{
      exact:  ['montante em mi', 'montante em moeda interna', 'montante', 'val.em mo.co.', 'val. em mo.co.',
               'valor', 'valor total', 'amount in lc', 'val.mo.co.', 'valor mo local', 'total'],
      starts: ['montante', 'val.em mo', 'val. em mo', 'valor total', 'amount in lc', 'val.mo.co']
    },
    txtMov:    {
      exact:  ['txt.tipo movimento', 'txt. tipo movimento', 'texto tipo movimento', 'descricao movimento',
               'descrição movimento', 'texto movimento', 'txt movimento'],
      starts: ['txt.tipo mov', 'txt. tipo mov', 'texto tipo mov', 'texto mov']
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

  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      updateLoadingOverlay('Lendo planilha e extraindo linhas...', `Importando ${modulo}`, 'Interpretando a estrutura do arquivo...');

      // ── Leitura do workbook ──────────────────────────────────────────────
      let wb;
      try {
        // Para arquivos SAP/MB51 potencialmente grandes, usa sheetRows limitado
        // na leitura inicial para evitar stack overflow no parser XLSX
        const xlsxOpts = { type: 'array', cellDates: false, dense: false };
        wb = XLSX.read(e.target.result, xlsxOpts);
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

      updateLoadingOverlay('Separando os registros válidos...', `Importando ${modulo}`, 'Convertendo valores e limpando vazios...');

      // ── Seleção da aba ───────────────────────────────────────────────────
      // Para o SAP, tenta encontrar a aba mais relevante (pode se chamar "MB51",
      // "Sheet1", "Planilha1", etc.) — usa a primeira aba disponível como fallback
      let sheetName = wb.SheetNames[0];
      if (modulo === 'SAP' && wb.SheetNames.length > 1) {
        const sapSheetHints = ['mb51', 'sap', 'movimentacao', 'movimentações', 'dados', 'data', 'sheet1', 'planilha1'];
        const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        const found = wb.SheetNames.find(n => sapSheetHints.some(h => norm(n).includes(h)));
        if (found) sheetName = found;
      }

      const ws = sanitizeWorksheet(wb.Sheets[sheetName]);
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });

      if (!rows || rows.length < 2) {
        toast('O arquivo parece estar vazio ou não contém linhas de dados.', 'error');
        hideLoadingOverlay('Falha na importação');
        event.target.value = '';
        return;
      }

      let data;
      let extra = {};

      if (modulo === 'SAP') {
        // Detecta automaticamente onde está a linha de cabeçalho real
        const headerIdx = detectSapHeaderRow(rows);
        const headerRow = rows[headerIdx] || [];
        const colMap = buildSapColumnMap(headerRow);
        // Dados começam na linha seguinte ao cabeçalho
        data = rows.slice(headerIdx + 1).filter(r => r.some(c => c !== '' && c !== null && c !== undefined));
        extra = { sapColMap: colMap, sapHeaderFound: headerIdx };

        // Log diagnóstico no console — abra o DevTools (F12) para ver detalhes
        console.info('[SAP Import] ✓ Aba usada:', sheetName);
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
      } else {
        data = rows.slice(1).filter(r => r.some(c => c !== '' && c !== null && c !== undefined));
      }

      updateLoadingOverlay('Aplicando a importação no sistema...', `Importando ${modulo}`, 'Gravando dados no armazenamento local...');
      await processImportedRows(modulo, data, file.name, extra);
      event.target.value = '';
    } catch (err) {
      console.error('[Import Error]', modulo, err);
      // Mostra a mensagem real do erro para facilitar o diagnóstico
      const msg = (err && err.message) ? err.message : String(err);
      const shortMsg = msg.length > 100 ? msg.slice(0, 100) + '…' : msg;
      toast('Erro ao processar: ' + shortMsg, 'error');
    } finally {
      hideLoadingOverlay('Importação concluída');
    }
  };
  reader.onerror = () => {
    toast('Não foi possível ler o arquivo selecionado', 'error');
    hideLoadingOverlay('Falha na importação');
  };
  reader.readAsArrayBuffer(file);
}



function renderAll() {
  renderEntradas();
  renderSaidas();
  renderLancamentos();
  renderSAP();
  renderProducao();
  renderImports();
  renderConfigs();
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
  configuracoes: () => { renderConfigs(); loadHealthConfigInputs(); updateParamGerais(); },
  filiais: () => renderFiliais(),
  materiais: () => renderMateriais()
};

// Páginas que são estáticas após o primeiro render (sem dados que mudam externamente)
const _staticPages = new Set(['configuracoes', 'filiais', 'materiais']);
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

async function restoreAndRender() {
  showLoadingOverlay('Carregando informações salvas', 'Restaurando os dados persistidos no navegador...');
  try {
    await loadState();
    if (isLoadingOverlayVisible()) updateLoadingOverlay('Montando a interface...', 'Carregando informações salvas', 'Ajustando métricas e listas...');
    await nextFrame();
    updateDashboard();
    updateParamGerais();
    renderFiliais();
    renderMateriais();
    const activePage = document.querySelector('.page.active')?.id?.replace('page-', '') || 'importar';
    renderPage(activePage);
    if (isLoadingOverlayVisible()) updateLoadingOverlay('Finalizando o carregamento...', 'Carregando informações salvas', 'Quase pronto...');
    await nextFrame();
    initResizable();
  } finally {
    hideLoadingOverlay('Dados carregados');
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
