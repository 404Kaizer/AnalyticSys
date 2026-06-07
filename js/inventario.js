// ═══════════════════════════════════════════════════════════
// MÓDULO: INVENTÁRIO
// ═══════════════════════════════════════════════════════════
(function() {
  let invRows = [];
  let invFiltered = [];
  let invJustificativas = {};

  function fmt(n, dec=0) {
    if (n == null || isNaN(n)) return '—';
    return n.toLocaleString('pt-BR', {minimumFractionDigits:dec, maximumFractionDigits:dec});
  }
  function fmtR(n) {
    if (n == null || isNaN(n)) return '—';
    return 'R$ ' + n.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
  }

  // ── Sorting state ─────────────────────────────────────────
  let invSortCol = 'custo', invSortDir = 'desc';

  window.invSortBy = function(col) {
    if (invSortCol === col) {
      invSortDir = invSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      invSortCol = col;
      invSortDir = 'desc';
    }
    document.querySelectorAll('.inv-data-table th').forEach(th => {
      th.classList.remove('sort-asc','sort-desc');
      if (th.dataset.col === col) th.classList.add(invSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
    });
    invFiltered.sort((a,b) => {
      const av = a[col] ?? '', bv = b[col] ?? '';
      const cmp = typeof av === 'string' ? av.localeCompare(bv,'pt-BR') : (Number(av)||0)-(Number(bv)||0);
      return invSortDir === 'asc' ? cmp : -cmp;
    });
    invRenderTabela();
  };

  window.invQuickSemana = function() {
    const hoje = new Date();
    const dow = hoje.getDay();
    const diff = dow === 0 ? 6 : dow - 1;
    const ini = new Date(hoje); ini.setDate(hoje.getDate() - diff);
    const fim = new Date(ini); fim.setDate(ini.getDate() + 6);
    const toISO = d => d.toISOString().substring(0,10);
    // Update hidden inputs directly (cal-picker reads from them for display)
    const iniEl = document.getElementById('inv-dt-ini');
    const fimEl = document.getElementById('inv-dt-fim');
    if (iniEl) iniEl.value = toISO(ini);
    if (fimEl) fimEl.value = toISO(fim);
    // Update label on trigger button
    const label = document.getElementById('inv-cal-label');
    if (label) {
      const fmtD = d => d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
      label.textContent = fmtD(ini) + ' — ' + fmtD(fim);
    }
    const trigger = document.getElementById('inv-cal-trigger');
    if (trigger) trigger.classList.add('has-value');
    document.querySelectorAll('[onclick^="calQuick"][onclick*="\'inv\'"]').forEach(b=>b.classList.remove('active'));
    document.getElementById('inv-chip-semana')?.classList.add('active');
  };

  window.invSetPeriodoType = function() {
    const tipo = document.getElementById('inv-tipo-periodo')?.value;
    if (tipo === 'mensal') { if(window.calQuickMesAtual) window.calQuickMesAtual('inv'); }
    else { window.invQuickSemana(); }
  };

  window.invSetPeriodo = function() {
    window.invSetPeriodoType?.();
  };

  window.invGerar = function() {
    const iniVal = document.getElementById('inv-dt-ini')?.value;
    const fimVal = document.getElementById('inv-dt-fim')?.value;
    if (!iniVal || !fimVal) { toast('Defina o período antes de gerar.', 'error'); return; }

    const h = window._inv_helpers;
    if (!h) { toast('Sistema não iniciado. Aguarde e tente novamente.', 'error'); return; }

    const { getLancIndex, getSapIndex, getCustoMedioPorMat, getPrePeriodLaunchStock, getLastPeriodLaunchStock, getFilialLookupIndex, normalizeText, parseDate, localISODate, dateCmp, num, state: getState } = h;
    const state = getState();

    const dtIni = new Date(iniVal + 'T00:00:00');
    const dtFim = new Date(fimVal + 'T23:59:59');

    const { byCentral: lancByCentral } = getLancIndex();
    const { byCentral: sapByCentral }  = getSapIndex();
    const fIdx = getFilialLookupIndex();

    const allCentrals = new Set([...lancByCentral.keys(), ...sapByCentral.keys()]);

    if (!allCentrals.size) {
      toast('Nenhum dado encontrado. Importe Lançamentos e/ou SAP primeiro.', 'error');
      return;
    }

    const rowMap = new Map();

    allCentrals.forEach(central => {
      const fRec    = fIdx.exact.get(normalizeText(central));
      const regional = (fRec?.regional || '').trim() || '—';

      const lancAll = lancByCentral.get(central) || [];
      const byMat = new Map();
      lancAll.forEach(r => {
        const mat = r.material || '—';
        if (!byMat.has(mat)) byMat.set(mat, []);
        byMat.get(mat).push(r);
      });

      const sapAll = sapByCentral.get(central) || [];
      const sapPer = sapAll.filter(r => {
        const d = parseDate(r.dtLanc);
        return d && d >= dtIni && d <= dtFim;
      });
      const sapByMat = new Map();
      sapPer.forEach(r => {
        const mat = r.material || '—';
        if (!sapByMat.has(mat)) sapByMat.set(mat, []);
        sapByMat.get(mat).push(r);
      });

      const mats = new Set([...byMat.keys(), ...sapByMat.keys()]);

      // Custo médio por material usando EXATAMENTE a mesma lógica do Analítico:
      // Saídas primeiro (Σ valorTotal / Σ peso), fallback SAP.
      // Calculado uma única vez por central para eficiência.
      const custoMedioPorMat = getCustoMedioPorMat(central, dtIni, dtFim);

      mats.forEach(mat => {
        const k = central + '|||' + mat;
        const lancArr = (byMat.get(mat) || []).slice().sort((a,b) => {
          const da = parseDate(a.dtLanc), db = parseDate(b.dtLanc);
          return ((da||new Date(0)) - (db||new Date(0)));
        });
        const sapArr = sapByMat.get(mat) || [];

        // EST. INICIAL: dia anterior ao período (pula domingo). Sem fallback.
        const preRes = getPrePeriodLaunchStock({ central, material: mat, dtIni });
        const estoqueIni = preRes != null ? preRes.value : 0;
        const estoqueIniMissing = preRes == null;

        // EST. FINAL: último dia não-domingo do período. missing=true se sem lançamento.
        const fimRes = getLastPeriodLaunchStock({ central, material: mat, dtFim });
        const estoqueFimReal = fimRes ? fimRes.value : 0;
        const estoqueFimMissing = !fimRes || fimRes.missing;

        // Volumes de entradas/saídas ainda vêm do SAP (movimentos físicos).
        let entradasKg = 0, saidasKg = 0;
        const entEntries = [], saiEntries = [];
        sapArr.forEach(r => {
          const p = num(r.peso);
          const cod = String(r.movimento || '—').trim();
          const ref = String(r.ref || r.documento || '—').trim();
          const usr = String(r.usuario || '—').trim();
          if (p >= 0) {
            entradasKg += p;
            entEntries.push([cod, p, ref, usr]);
          } else {
            saidasKg += Math.abs(p);
            saiEntries.push([cod, p, ref, usr]);
          }
        });

        // Custo médio alinhado com o Analítico (Saídas → fallback SAP).
        const custoMedio = custoMedioPorMat[mat] || 0;

        const sample = lancArr[0] || sapArr[0] || {};
        const categoria = sample.categoria || '—';

        rowMap.set(k, { k, central, material: mat, categoria, regional, estoqueIni, estoqueIniMissing, entradasKg, saidasKg, estoqueFimReal, estoqueFimMissing, custoMedio, entEntries, saiEntries });
      });
    });

    invRows = [];
    rowMap.forEach(row => {
      const estTeor   = row.estoqueIni + row.entradasKg - row.saidasKg;
      const varKg     = row.estoqueFimReal - estTeor;
      const varPct    = estTeor !== 0 ? (varKg / Math.abs(estTeor)) * 100 : 0;
      const just      = invJustificativas[row.k] || {};
      const saldoJust = parseFloat(just.saldo || 0) || 0;
      const varAdj    = varKg - saldoJust;
      const custo     = varAdj * row.custoMedio;
      invRows.push({ ...row, estTeor, varKg, varPct, saldoJust, varAdj, custo });
    });

    invRows.sort((a,b) => Math.abs(b.custo) - Math.abs(a.custo));

    const cats = [...new Set(invRows.map(r => r.categoria).filter(Boolean))].sort();
    const regs = [...new Set(invRows.map(r => r.regional).filter(Boolean))].sort();
    const mats = [...new Set(invRows.map(r => r.material).filter(Boolean))].sort();
    const catSel = document.getElementById('inv-filtro-cat');
    const regSel = document.getElementById('inv-filtro-regional');
    const matSel = document.getElementById('inv-filtro-material');
    if (catSel) catSel.innerHTML = '<option value="">Todas as categorias</option>' + cats.map(c=>`<option>${c}</option>`).join('');
    if (regSel) regSel.innerHTML = '<option value="">Todas as regionais</option>' + regs.map(r=>`<option>${r}</option>`).join('');
    if (matSel) matSel.innerHTML = '<option value="">Todos os materiais</option>' + mats.map(m=>`<option>${m}</option>`).join('');

    document.getElementById('inv-empty-state').style.display = 'none';
    document.getElementById('inv-content').style.display = '';

    invFiltrar();
    invAtualizarKpis();
    invAtualizarAlertas();
    toast('Inventário gerado: ' + invRows.length + ' itens.', 'success');
  };

  // ── Filtrar ──────────────────────────────────────────────
  window.invFiltrar = function() {
    const txt  = (document.getElementById('inv-filtro')?.value || '').toLowerCase();
    const cat  = document.getElementById('inv-filtro-cat')?.value || '';
    const reg  = document.getElementById('inv-filtro-regional')?.value || '';
    const mat  = document.getElementById('inv-filtro-material')?.value || '';
    const soV  = document.getElementById('inv-filtro-sovar')?.checked;
    invFiltered = invRows.filter(r => {
      if (soV && Math.abs(r.varKg) < 0.01) return false;
      if (cat && r.categoria !== cat) return false;
      if (reg && r.regional !== reg) return false;
      if (mat && r.material !== mat) return false;
      if (txt && !(r.central+r.material+r.regional+r.categoria).toLowerCase().includes(txt)) return false;
      return true;
    });
    // apply current sort
    if (invSortCol) {
      invFiltered.sort((a,b) => {
        const av = a[invSortCol] ?? '', bv = b[invSortCol] ?? '';
        const cmp = typeof av === 'string' ? av.localeCompare(bv,'pt-BR') : (Number(av)||0)-(Number(bv)||0);
        return invSortDir === 'asc' ? cmp : -cmp;
      });
    }
    const lbl = document.getElementById('inv-count-label');
    if (lbl) lbl.textContent = invFiltered.length + ' de ' + invRows.length + ' itens';
    invRenderTabela();
  };

  // ── Renderiza tabela ─────────────────────────────────────
  function invRenderTabela() {
    const tbody = document.getElementById('inv-tbody');
    const empty = document.getElementById('inv-empty');
    if (!tbody) return;
    if (!invFiltered.length) {
      tbody.innerHTML = '';
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';
    const just = invJustificativas;

    // Reutiliza helpers do módulo principal via _inv_helpers
    const h = window._inv_helpers;
    const _fmtKg    = h ? h.fmtKg    : (v) => fmt(v) + ' kg';
    const _varClass  = h ? h.varClass  : (v) => v < 0 ? 'diff-neg' : v > 0 ? 'diff-pos' : 'diff-zero';
    const _varSymbol = h ? h.varSymbol : (v) => '';
    const _money     = h ? h.money     : fmtR;
    const _escape    = h ? h.escapeHtml: (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const _bdm       = h ? h.buildAnaliticoDetailBreakdown : null;

    tbody.innerHTML = invFiltered.map(r => {
      const j = just[r.k] || {};
      const hasJust = j.op || j.fiscal;
      const alertBadge = (!hasJust && Math.abs(r.varKg) > 0.01)
        ? '<span style="display:inline-block;width:6px;height:6px;background:var(--amber);border-radius:50%;margin-right:5px;vertical-align:middle;flex-shrink:0" title="Sem justificativa"></span>'
        : '';

      // ── Est. Inicial: teal igual ao analítico ──────────────
      const iniCell = r.estoqueIniMissing
        ? `<span class="td-mono" style="color:var(--text3);font-style:italic">—</span>`
        : `<span class="td-mono" style="color:var(--teal)">${_fmtKg(r.estoqueIni)}</span>`;

      // ── Entradas / Saídas: bdm-trigger igual ao analítico ──
      const entCell = _bdm
        ? _bdm(r.entEntries || [], r.entradasKg, 'var(--green)', 'Entradas')
        : `<span class="td-mono" style="color:var(--green);font-weight:600">${_fmtKg(r.entradasKg)}</span>`;
      const saiCell = _bdm
        ? _bdm(r.saiEntries || [], r.saidasKg, 'var(--red)', 'Saídas')
        : `<span class="td-mono" style="color:var(--red);font-weight:600">${_fmtKg(r.saidasKg)}</span>`;

      // ── Est. Final: teal igual ao analítico ────────────────
      const finCell = r.estoqueFimMissing
        ? `<span class="td-mono" style="color:var(--text3);font-style:italic" title="Sem lançamento no último dia útil do período">—</span>`
        : `<span class="td-mono" style="color:var(--teal)">${_fmtKg(r.estoqueFimReal)}</span>`;

      // ── Est. Teórico: purple igual ao analítico ────────────
      const teorCell = `<span class="td-mono" style="color:var(--purple)">${_fmtKg(r.estTeor)}</span>`;

      // ── Variação (kg): diff-pos/neg/zero + varSymbol ───────
      const dCls  = _varClass(r.varKg);
      const varCell = Math.abs(r.varKg) < 0.005
        ? `<span class="td-mono diff-zero">${_varSymbol(0)} ${_fmtKg(0)}</span>`
        : `<span class="td-mono ${dCls}" style="white-space:nowrap">${_varSymbol(r.varKg)} ${_fmtKg(Math.abs(r.varKg))}</span>`;

      // ── Var. Ajust. (kg): mesmo padrão ─────────────────────
      const dClsAdj = _varClass(r.varAdj);
      const varAdjCell = Math.abs(r.varAdj) < 0.005
        ? `<span class="td-mono diff-zero">${_varSymbol(0)} ${_fmtKg(0)}</span>`
        : `<span class="td-mono ${dClsAdj}" style="white-space:nowrap">${_varSymbol(r.varAdj)} ${_fmtKg(Math.abs(r.varAdj))}</span>`;

      // ── Custo Médio (R$/kg): igual ao analítico ────────────
      const custoMedCell = r.custoMedio > 0
        ? `<span class="td-mono" style="color:var(--text2);font-size:11.5px">${_money(r.custoMedio)}<span style="font-size:9.5px;opacity:.6">/kg</span></span>`
        : `<span style="color:var(--text3);font-size:11px">—</span>`;

      // ── Custo Variação (R$): igual ao analítico ────────────
      const _custoVarVal = r.custoMedio > 0 ? r.custo : null;
      const _custoVarCls = _custoVarVal !== null ? _varClass(_custoVarVal) : '';
      const custoVarCell = _custoVarVal !== null
        ? `<span class="td-mono ${_custoVarCls}" style="font-size:11.5px;white-space:nowrap">${_varSymbol(_custoVarVal)} ${_money(Math.abs(_custoVarVal))}</span>`
        : `<span style="color:var(--text3);font-size:11px">—</span>`;

      // ── Saldo justificado ──────────────────────────────────
      const saldoCell = j.saldo
        ? `<span class="td-mono" style="color:var(--text2)">${_fmtKg(parseFloat(j.saldo))}</span>`
        : '<span style="color:var(--text3);font-size:11px">—</span>';

      return `<tr>
        <td style="font-size:11px;color:var(--text2);white-space:nowrap">${r.regional}</td>
        <td style="font-family:var(--mono);font-size:11px;font-weight:600;white-space:nowrap">${r.central}</td>
        <td style="font-weight:600;max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${_escape(r.material)}">${alertBadge}${_escape(r.material)}</td>
        <td><span style="font-size:10px;background:var(--bg4);border:1px solid var(--border2);border-radius:20px;padding:2px 8px;color:var(--text2);white-space:nowrap">${_escape(r.categoria)}</span></td>
        <td style="text-align:right;white-space:nowrap">${iniCell}</td>
        <td style="text-align:right;white-space:nowrap">${entCell}</td>
        <td style="text-align:right;white-space:nowrap">${saiCell}</td>
        <td style="text-align:right;white-space:nowrap">${finCell}</td>
        <td style="text-align:right;white-space:nowrap">${teorCell}</td>
        <td style="text-align:right;white-space:nowrap">${varCell}</td>
        <td style="text-align:right;white-space:nowrap">${saldoCell}</td>
        <td style="text-align:right;white-space:nowrap">${varAdjCell}</td>
        <td style="text-align:right;white-space:nowrap">${custoMedCell}</td>
        <td style="text-align:right;white-space:nowrap">${custoVarCell}</td>
        <td style="text-align:center">
          <button onclick="invAbrirJust('${r.k}')" style="background:${hasJust?'var(--green-bg)':'var(--bg4)'};border:1px solid ${hasJust?'var(--green-border)':'var(--border2)'};color:${hasJust?'var(--green)':'var(--text2)'};border-radius:6px;padding:4px 10px;font-size:10px;cursor:pointer;white-space:nowrap;font-family:var(--font);transition:all .13s">
            <i class="ti ${hasJust?'ti-check':'ti-pencil'}" style="font-size:10px"></i> ${hasJust?'Ver/Editar':'Justificar'}
          </button>
        </td>
      </tr>`;
    }).join('');
  }

  // ── KPIs ─────────────────────────────────────────────────
  function invAtualizarKpis() {
    const totalIni = invRows.reduce((s,r)=>s+r.estoqueIni,0);
    const totalEnt = invRows.reduce((s,r)=>s+r.entradasKg,0);
    const totalSai = invRows.reduce((s,r)=>s+r.saidasKg,0);
    const totalFin = invRows.reduce((s,r)=>s+r.estoqueFimReal,0);

    // Variação BRUTA: varKg sem desconto de justificativas
    const totalVarBruto = invRows.reduce((s,r)=>s+r.varKg,0);
    // Variação AJUSTADA: varAdj após descontar saldo justificado
    const totalVarAdj   = invRows.reduce((s,r)=>s+r.varAdj,0);

    // Custo BRUTO: varKg × custoMedio (independente de justificativas)
    const totalCstBruto = invRows.reduce((s,r)=>s+(r.varKg * r.custoMedio),0);
    // Custo AJUSTADO: varAdj × custoMedio
    const totalCstAdj   = invRows.reduce((s,r)=>s+r.custo,0);

    const set = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
    set('inv-kpi-ini-v', fmt(totalIni));
    set('inv-kpi-ent-v', fmt(totalEnt));
    set('inv-kpi-sai-v', fmt(totalSai));
    set('inv-kpi-fin-v', fmt(totalFin));

    // Badges de ausentes nos KPIs
    const _invMissingBadge = (containerId, list, label) => {
      const el = document.getElementById(containerId);
      if (!el) return;
      if (!list.length) { el.innerHTML = ''; return; }
      const MAX = 5;
      const shown = list.slice(0, MAX).map(s => `<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;color:var(--text2);font-size:10px;font-family:var(--mono)">${s}</div>`).join('');
      const more  = list.length > MAX ? `<div style="color:var(--text3);font-size:9.5px;font-family:var(--mono)">+ ${list.length - MAX} mais</div>` : '';
      el.innerHTML = `<details style="margin-top:5px">
        <summary style="cursor:pointer;list-style:none;display:inline-flex;align-items:center;gap:4px;font-family:var(--mono);font-size:9px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--amber);padding:2px 7px;background:var(--amber-bg);border:1px solid var(--amber-border);border-radius:4px;user-select:none">
          <i class="ti ti-alert-triangle" style="font-size:10px"></i> ${list.length} sem ${label}
        </summary>
        <div style="margin-top:5px;padding:7px 9px;background:var(--bg4);border:1px solid var(--border2);border-radius:5px;display:flex;flex-direction:column;gap:2px">
          ${shown}${more}
        </div>
      </details>`;
    };
    const missingIniRows = invRows.filter(r => r.estoqueIniMissing).map(r => `${r.central} · ${r.material}`);
    const missingFimRows = invRows.filter(r => r.estoqueFimMissing).map(r => `${r.central} · ${r.material}`);
    _invMissingBadge('inv-kpi-ini-missing', missingIniRows, 'Est. Ini.');
    _invMissingBadge('inv-kpi-fin-missing', missingFimRows, 'Est. Fim');

    // Variação: principal = bruto, secundário = ajustado (só se diferente)
    set('inv-kpi-var-v', fmt(totalVarBruto));
    const varEl = document.getElementById('inv-kpi-var');
    if (varEl) varEl.style.borderTop = totalVarBruto < 0 ? '3px solid var(--red)' : totalVarBruto > 0 ? '3px solid var(--green)' : '';
    const varAdjWrap = document.getElementById('inv-kpi-var-adj-wrap');
    const varAdjVal  = document.getElementById('inv-kpi-var-adj-v');
    const varTemAdj  = Math.abs(totalVarBruto - totalVarAdj) > 0.01;
    if (varAdjWrap) varAdjWrap.style.display = varTemAdj ? '' : 'none';
    if (varAdjVal && varTemAdj) varAdjVal.textContent = fmt(totalVarAdj) + ' kg';

    // Custo Var.: principal = bruto, secundário = ajustado (só se diferente)
    set('inv-kpi-cst-v', fmtR(totalCstBruto));
    const cstEl = document.getElementById('inv-kpi-cst');
    if (cstEl) cstEl.style.borderTop = totalCstBruto < 0 ? '3px solid var(--red)' : totalCstBruto > 0 ? '3px solid var(--green)' : '';
    const cstAdjWrap = document.getElementById('inv-kpi-cst-adj-wrap');
    const cstAdjVal  = document.getElementById('inv-kpi-cst-adj-v');
    const cstTemAdj  = Math.abs(totalCstBruto - totalCstAdj) > 0.01;
    if (cstAdjWrap) cstAdjWrap.style.display = cstTemAdj ? '' : 'none';
    if (cstAdjVal && cstTemAdj) cstAdjVal.textContent = fmtR(totalCstAdj);
  }

  // ── Alertas pendentes ─────────────────────────────────────
  function invAtualizarAlertas() {
    const pendentes = invRows.filter(r => Math.abs(r.varKg) > 0.01 && !(invJustificativas[r.k]?.op || invJustificativas[r.k]?.fiscal));
    const btn = document.getElementById('inv-alertas-count');
    if (btn) btn.textContent = pendentes.length;
    const btnWrap = document.getElementById('inv-btn-alertas');
    if (btnWrap) btnWrap.style.color = pendentes.length ? 'var(--amber)' : '';
    const list = document.getElementById('inv-alertas-list');
    if (list) list.innerHTML = pendentes.slice(0,30).map(r=>`<div style="padding:2px 0;border-bottom:1px solid var(--border)">${r.central} · ${r.material} · var. <strong>${fmt(r.varKg)} kg</strong> · custo <strong>${fmtR(r.custo)}</strong></div>`).join('') + (pendentes.length>30?`<div style="padding:4px 0;font-style:italic">... e mais ${pendentes.length-30} itens</div>`:'');
  }

  window.invAbrirAlertasPendentes = function() {
    const panel = document.getElementById('inv-alertas-panel');
    if (panel) panel.style.display = panel.style.display === 'none' ? '' : 'none';
  };

  // ── Modal de justificativa ───────────────────────────────
  window.invAbrirJust = function(k) {
    const row = invRows.find(r => r.k === k);
    if (!row) return;
    const j = invJustificativas[k] || {};
    // Remove modal anterior se existir
    document.getElementById('inv-modal')?.remove();
    const h = window._inv_helpers;
    const _fmtKg    = h ? h.fmtKg    : (v) => fmt(v) + ' kg';
    const _varClass  = h ? h.varClass  : (v) => v < 0 ? 'diff-neg' : v > 0 ? 'diff-pos' : 'diff-zero';
    const _varSymbol = h ? h.varSymbol : () => '';
    const _money     = h ? h.money     : fmtR;
    const vkCls   = _varClass(row.varKg);
    const cstCls  = _varClass(row.custo);
    const modal = document.createElement('div');
    modal.id = 'inv-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:20px';
    modal.innerHTML = `
      <div style="background:var(--bg2);border:1px solid var(--border2);border-radius:14px;padding:0;width:100%;max-width:560px;box-shadow:0 24px 64px rgba(0,0,0,.5);overflow:hidden">
        <div style="background:var(--bg3);padding:16px 20px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border)">
          <div>
            <div style="font-weight:700;font-size:14px">${row.central} · ${row.material}</div>
            <div style="font-size:11px;color:var(--text2);margin-top:2px">${row.regional} · ${row.categoria}</div>
          </div>
          <button onclick="document.getElementById('inv-modal').remove()" style="background:none;border:none;color:var(--text2);cursor:pointer;font-size:18px"><i class="ti ti-x"></i></button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:16px 20px;border-bottom:1px solid var(--border)">
          <div style="text-align:center">
            <div style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Variação (kg)</div>
            <span class="td-mono ${vkCls}" style="font-size:17px;white-space:nowrap">${_varSymbol(row.varKg)} ${_fmtKg(Math.abs(row.varKg))}</span>
          </div>
          <div style="text-align:center">
            <div style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Custo Var. (R$)</div>
            <span class="td-mono ${cstCls}" style="font-size:17px;white-space:nowrap">${_varSymbol(row.custo)} ${_money(Math.abs(row.custo))}</span>
          </div>
        </div>
        <div style="padding:16px 20px;display:flex;flex-direction:column;gap:12px">
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:5px">Justificativa Operacional</label>
            <textarea id="inv-j-op" rows="2" placeholder="Ex: falha no medidor da brita, perda por chuva..." style="width:100%;background:var(--bg3);border:1px solid var(--border2);color:var(--text);border-radius:8px;padding:8px 10px;font-size:12px;resize:vertical">${j.op||''}</textarea>
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:5px">Justificativa Fiscal <span style="font-weight:400;font-size:10px;color:var(--text3)">(para inspeção)</span></label>
            <div style="display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap">
              ${['Falha operacional - erro de medição','Variação natural de umidade','Perda operacional no processo','Divergência de fornecedor'].map(t=>`<button onclick="document.getElementById('inv-j-fiscal').value='${t}'" style="background:var(--bg4);border:1px solid var(--border2);color:var(--text2);border-radius:20px;padding:3px 9px;font-size:10px;cursor:pointer;white-space:nowrap">${t}</button>`).join('')}
            </div>
            <textarea id="inv-j-fiscal" rows="2" placeholder="Motivo genérico para fins fiscais..." style="width:100%;background:var(--bg3);border:1px solid var(--border2);color:var(--text);border-radius:8px;padding:8px 10px;font-size:12px;resize:vertical">${j.fiscal||''}</textarea>
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:5px">Saldo Justificado (kg) <span style="font-weight:400;font-size:10px;color:var(--text3)">parte ou total da variação com causa identificada</span></label>
            <input id="inv-j-saldo" type="number" placeholder="0" value="${j.saldo||''}" style="width:180px;background:var(--bg3);border:1px solid var(--border2);color:var(--text);border-radius:8px;padding:7px 10px;font-size:12px">
          </div>
        </div>
        <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px">
          <button onclick="document.getElementById('inv-modal').remove()" class="btn">Cancelar</button>
          <button onclick="invSalvarJust('${k}')" class="btn btn-primary"><i class="ti ti-device-floppy"></i> Salvar</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  };

  window.invSalvarJust = function(k) {
    const op     = document.getElementById('inv-j-op')?.value.trim();
    const fiscal = document.getElementById('inv-j-fiscal')?.value.trim();
    const saldo  = document.getElementById('inv-j-saldo')?.value;
    invJustificativas[k] = { op, fiscal, saldo };
    // Recalcula linha
    const row = invRows.find(r => r.k === k);
    if (row) {
      const saldoJust = parseFloat(saldo||0)||0;
      row.saldoJust = saldoJust;
      row.varAdj = row.varKg - saldoJust;
      row.custo  = row.varAdj * row.custoMedio;
    }
    document.getElementById('inv-modal')?.remove();
    invFiltrar();
    invAtualizarKpis();
    invAtualizarAlertas();
    toast('Justificativa salva.', 'success');
  };

  // ── Exportar CSV ─────────────────────────────────────────
  window.invExportar = function() {
    if (!invRows.length) { toast('Gere o inventário antes de exportar.', 'error'); return; }
    const header = ['Regional','Filial','Cod','Material','Categoria','Est.Ini.(kg)','Entradas(kg)','Saídas(kg)','Est.Teórico(kg)','Est.Real(kg)','Var.(kg)','Var.(%)','Custo Médio','Custo Variação (R$)','Saldo Justificado','Var.Ajustada','Just.Operacional','Just.Fiscal'];
    const rows = invRows.map(r => {
      const j = invJustificativas[r.k]||{};
      return [r.regional, r.central, r.material, r.categoria, r.estoqueIni, r.entradasKg, r.saidasKg, r.estTeor, r.estoqueFimReal, r.varKg, r.varPct.toFixed(2), r.custoMedio, r.custo.toFixed(2), j.saldo||'', r.varAdj, j.op||'', j.fiscal||''].map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(';');
    });
    const csv = [header.join(';'), ...rows].join('\n');
    const blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8'});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'inventario_' + new Date().toISOString().substring(0,10) + '.csv';
    a.click(); URL.revokeObjectURL(url);
  };

  // ── renderInventario (chamado pelo navigate) ─────────────
  let invIniciado = false;
  window.renderInventario = function() {
    if (!invIniciado) {
      const defaultTh = document.querySelector('.inv-data-table th[data-col="custo"]');
      if (defaultTh) defaultTh.classList.add('sort-desc');
      invIniciado = true;
    }
    // Se já tem dados, mantém o conteúdo visível
    if (invRows.length) {
      document.getElementById('inv-empty-state').style.display = 'none';
      document.getElementById('inv-content').style.display = '';
      invFiltrar(); invAtualizarKpis(); invAtualizarAlertas();
    }
  };
})();
