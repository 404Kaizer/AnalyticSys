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

  // ── Filtros — mesmo padrão visual/comportamental da Visão Micro
  //    do Dashboard Analítico (chips com dropdown multi-seleção,
  //    busca interna, Aplicar/Cancelar/Limpar). Estado próprio do
  //    módulo (não usa window._microFilter do analitico.js).
  const _invFilter = {
    pending: { regional: new Set(), central: new Set(), categoria: new Set(), material: new Set() },
    applied: { regional: new Set(), central: new Set(), categoria: new Set(), material: new Set() },
    options: { regional: [], central: [], categoria: [], material: [] },
    // Toggle simples (não é dropdown multi-seleção como os demais): oculta
    // linhas cuja Variação (kg) é 0,00 — mesma tolerância usada na célula
    // da tabela para decidir o que conta como "zero" (diff-zero).
    hideVarZero: false,
    // Toggles simples: mostram só as linhas com Est. Inicial / Est. Final
    // AUSENTE (mesmo flag usado nas células da tabela e nos badges dos cards).
    // Combinam em AND com os demais filtros — se ambos ligados, mostra só
    // linhas ausentes nos dois.
    onlyIniAusente: false,
    onlyFimAusente: false,
    // Toggle simples: mostra só itens com variação (>0,01 kg) que ainda não
    // têm justificativa operacional nem fiscal. Substitui o antigo botão
    // "Pendentes" (que abria um painel separado) — agora filtra a própria
    // tabela, igual aos demais toggles.
    onlyPendentes: false
  };


  const _invFilterKeyLabels = { regional: 'Regional', central: 'Central', categoria: 'Categoria', material: 'Material' };

  // Popula as opções de cada filtro a partir das linhas geradas (invRows)
  function invPopulateMicroFilterOptions() {
    _invFilter.options.regional  = [...new Set(invRows.map(r => r.regional).filter(Boolean))].sort();
    _invFilter.options.central   = [...new Set(invRows.map(r => r.central).filter(Boolean))].sort();
    _invFilter.options.categoria = [...new Set(invRows.map(r => r.categoria).filter(Boolean))].sort();
    _invFilter.options.material  = [...new Set(invRows.map(r => r.material).filter(Boolean))].sort();
    ['regional','central','categoria','material'].forEach(key => {
      _invBuildOptionsList(key);
      _invSyncTriggerLabel(key);
    });
    _invSyncClearBtn();
  }

  function _invEscape(s) {
    const h = window._inv_helpers;
    return h ? h.escapeHtml(s) : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function _invBuildOptionsList(key, query = '') {
    const container = document.getElementById(`imfo-${key}`);
    if (!container) return;
    const opts = _invFilter.options[key];
    const q = query.toLowerCase().trim();
    const filtered = q ? opts.filter(o => o.toLowerCase().includes(q)) : opts;
    const applied = _invFilter.applied[key];
    const pending = _invFilter.pending[key];

    if (!filtered.length) {
      container.innerHTML = `<div style="padding:12px 10px;color:var(--text3);font-size:12px;text-align:center">Nenhum resultado</div>`;
      return;
    }
    container.innerHTML = filtered.map(opt => {
      const checked = pending.size ? pending.has(opt) : applied.has(opt);
      const id = `imfopt-${key}-${opt.replace(/[^a-z0-9]/gi,'_')}`;
      return `<label class="micro-filter-option" for="${id}">
        <input type="checkbox" id="${id}" value="${_invEscape(opt)}" ${checked ? 'checked' : ''}
          onchange="_invFilterCheckChange('${key}', this)">
        <span class="micro-filter-option-label" title="${_invEscape(opt)}">${_invEscape(opt)}</span>
      </label>`;
    }).join('');
  }

  window._invFilterCheckChange = function(key, checkbox) {
    const val = checkbox.value;
    const pending = _invFilter.pending[key];
    if (checkbox.checked) pending.add(val);
    else pending.delete(val);
  };

  window.invToggleMicroFilter = function(key) {
    const dd = document.getElementById(`imfd-${key}`);
    const chev = document.getElementById(`imfc-${key}`);
    if (!dd || !chev) return;
    const allKeys = ['regional', 'central', 'categoria', 'material'];
    // Fecha os outros dropdowns primeiro, revertendo pending não aplicado
    allKeys.filter(k => k !== key).forEach(otherKey => {
      const otherDd = document.getElementById(`imfd-${otherKey}`);
      const otherChev = document.getElementById(`imfc-${otherKey}`);
      if (otherDd?.classList.contains('open')) {
        otherDd.classList.remove('open');
        otherChev?.classList.remove('open');
        _invFilter.pending[otherKey] = new Set(_invFilter.applied[otherKey]);
      }
    });
    const isOpen = dd.classList.toggle('open');
    chev.classList.toggle('open', isOpen);
    if (isOpen) {
      _invFilter.pending[key] = new Set(_invFilter.applied[key]);
      const searchEl = document.getElementById(`imfs-${key}`);
      if (searchEl) searchEl.value = '';
      _invBuildOptionsList(key);
      setTimeout(() => searchEl?.focus(), 50);
    }
  };

  window.invFilterMicroOptions = function(key, query) {
    _invBuildOptionsList(key, query);
  };

  function _invCloseDropdown(key) {
    document.getElementById(`imfd-${key}`)?.classList.remove('open');
    document.getElementById(`imfc-${key}`)?.classList.remove('open');
  }

  window.invApplyMicroFilter = function(key) {
    _invFilter.applied[key] = new Set(_invFilter.pending[key]);
    _invCloseDropdown(key);
    _invSyncTriggerLabel(key);
    _invSyncClearBtn();
    invFiltrar();
    invAtualizarKpis();
    invAtualizarAlertas();
  };

  window.invCancelMicroFilter = function(key) {
    _invFilter.pending[key] = new Set(_invFilter.applied[key]);
    _invCloseDropdown(key);
  };

  window.invClearMicroFilter = function(key) {
    _invFilter.pending[key] = new Set();
    _invFilter.applied[key] = new Set();
    _invCloseDropdown(key);
    _invSyncTriggerLabel(key);
    _invSyncClearBtn();
    invFiltrar();
    invAtualizarKpis();
    invAtualizarAlertas();
  };

  window.invClearAllMicroFilters = function() {
    ['regional','central','categoria','material'].forEach(key => {
      _invFilter.pending[key] = new Set();
      _invFilter.applied[key] = new Set();
      _invSyncTriggerLabel(key);
    });
    _invFilter.hideVarZero = false;
    _invFilter.onlyIniAusente = false;
    _invFilter.onlyFimAusente = false;
    _invFilter.onlyPendentes = false;
    _invSyncVarZeroBtn();
    _invSyncAusenteBtns();
    _invSyncPendentesBtn();
    _invSyncClearBtn();
    invFiltrar();
    invAtualizarKpis();
    invAtualizarAlertas();
  };

  window.invToggleHideVarZero = function() {
    _invFilter.hideVarZero = !_invFilter.hideVarZero;
    _invSyncVarZeroBtn();
    _invSyncClearBtn();
    invFiltrar();
    invAtualizarKpis();
    invAtualizarAlertas();
  };

  window.invToggleOnlyIniAusente = function() {
    _invFilter.onlyIniAusente = !_invFilter.onlyIniAusente;
    _invSyncAusenteBtns();
    _invSyncClearBtn();
    invFiltrar();
    invAtualizarKpis();
    invAtualizarAlertas();
  };

  window.invToggleOnlyFimAusente = function() {
    _invFilter.onlyFimAusente = !_invFilter.onlyFimAusente;
    _invSyncAusenteBtns();
    _invSyncClearBtn();
    invFiltrar();
    invAtualizarKpis();
    invAtualizarAlertas();
  };

  // Toggle "Só Pendentes" — mostra só itens com variação sem justificativa.
  // Antes era um botão que abria um painel à parte; agora é mais um filtro
  // da tabela, no mesmo padrão dos demais toggles simples.
  window.invToggleOnlyPendentes = function() {
    _invFilter.onlyPendentes = !_invFilter.onlyPendentes;
    _invSyncPendentesBtn();
    _invSyncClearBtn();
    invFiltrar();
    invAtualizarKpis();
    invAtualizarAlertas();
  };

  function _invSyncVarZeroBtn() {
    const btn = document.getElementById('imft-varzero');
    if (!btn) return;
    btn.classList.toggle('active', _invFilter.hideVarZero);
  }

  function _invSyncAusenteBtns() {
    const iniBtn = document.getElementById('imft-iniausente');
    if (iniBtn) iniBtn.classList.toggle('active', _invFilter.onlyIniAusente);
    const fimBtn = document.getElementById('imft-fimausente');
    if (fimBtn) fimBtn.classList.toggle('active', _invFilter.onlyFimAusente);
  }

  function _invSyncPendentesBtn() {
    const btn = document.getElementById('imft-pendentes');
    if (btn) btn.classList.toggle('active', _invFilter.onlyPendentes);
  }

  function _invSyncTriggerLabel(key) {
    const btn = document.getElementById(`imft-${key}`);
    const label = document.getElementById(`imft-${key}-label`);
    if (!label || !btn) return;
    const keyLabel = _invFilterKeyLabels[key] || key;
    const applied = _invFilter.applied[key];
    if (!applied.size) {
      label.innerHTML = keyLabel;
      btn.classList.remove('active');
    } else if (applied.size === 1) {
      const val = [...applied][0];
      label.innerHTML = `${keyLabel}: <strong>${_invEscape(val.length > 18 ? val.slice(0,18)+'…' : val)}</strong>`;
      btn.classList.add('active');
    } else {
      label.innerHTML = `${keyLabel} <span class="micro-filter-badge">${applied.size}</span>`;
      btn.classList.add('active');
    }
  }

  function _invSyncClearBtn() {
    const btn = document.getElementById('inv-filter-clear-btn');
    if (!btn) return;
    const hasAny = _invFilter.applied.regional.size || _invFilter.applied.central.size || _invFilter.applied.categoria.size || _invFilter.applied.material.size || _invFilter.hideVarZero || _invFilter.onlyIniAusente || _invFilter.onlyFimAusente || _invFilter.onlyPendentes;
    btn.style.display = hasAny ? '' : 'none';
  }

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

  // ═══════════════════════════════════════════════════════════
  // SELETOR DE MÊS DO INVENTÁRIO
  // ═══════════════════════════════════════════════════════════
  // O Inventário é fechado mensalmente e é independente do período livre
  // usado pela Visão Micro (calendário 'an' em calendar.js, que trabalha
  // com range de dias). Aqui é sempre EXATAMENTE um mês calendário.
  //
  // Reaproveita as classes visuais do calendário do sistema (cal-picker-*,
  // cal-header, cal-nav-btn, cal-month-grid, cal-grid-item) para manter a
  // identidade visual, mas com um estado e uma lógica de navegação próprios
  // e mais simples (só grid de meses, nunca cai pra visão de dias) — o
  // componente genérico de calendar.js foi feito pra seleção de range de
  // dias e sempre despenca pra visão de dias após escolher o mês, o que
  // não serve aqui.
  const MESES_ABREV = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const MESES_NOME  = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  const _invMonthState = {
    viewYear:     new Date().getFullYear(),  // ano exibido no grid (navegação)
    selectedYear: new Date().getFullYear(),  // ano efetivamente selecionado
    selectedMonth: new Date().getMonth()     // mês efetivamente selecionado (0-based)
  };

  function invMesKey(year, month) {
    return year + '-' + String(month + 1).padStart(2, '0');
  }

  // Expostos pro restante do módulo (invGerar, invExportar, etc.)
  function invGetSelectedYear()  { return _invMonthState.selectedYear; }
  function invGetSelectedMonth() { return _invMonthState.selectedMonth; }
  function invGetMesKey()        { return invMesKey(_invMonthState.selectedYear, _invMonthState.selectedMonth); }

  // Sincroniza o mês selecionado do Inventário com a data inicial do
  // período livre analisado na Visão Micro (chamado por rodarAnalitico,
  // em analitico.js, toda vez que o usuário clica em "Analisar" — mesmo
  // se ele não estiver na aba Inventário no momento). Usa o mês da data
  // INICIAL do período quando ele abrange mais de um mês. Só atualiza o
  // estado/rótulo aqui; quem decide se regenera os dados é o chamador
  // (evita recalcular o inventário sem necessidade quando o mês não mudou).
  window.invSyncMonthFromPeriod = function(dtIni) {
    if (!(dtIni instanceof Date) || isNaN(dtIni)) return;
    const y = dtIni.getFullYear();
    const m = dtIni.getMonth();
    if (y === _invMonthState.selectedYear && m === _invMonthState.selectedMonth) return; // já está no mês certo
    _invMonthState.selectedYear  = y;
    _invMonthState.selectedMonth = m;
    _invMonthState.viewYear      = y;
    _invUpdateMonthTriggerLabel();
    _invRenderMonthGrid();
  };

  function _invUpdateMonthTriggerLabel() {
    const label = document.getElementById('inv-month-label');
    if (label) label.textContent = MESES_NOME[_invMonthState.selectedMonth] + ' de ' + _invMonthState.selectedYear;
  }

  function _invRenderMonthGrid() {
    const container = document.getElementById('inv-month-inner');
    if (!container) return;
    const y = _invMonthState.viewYear;
    const items = MESES_ABREV.map((name, i) => {
      const active = (i === _invMonthState.selectedMonth && y === _invMonthState.selectedYear) ? ' active' : '';
      return `<button class="cal-grid-item${active}" onclick="invSelectMonth(${i})" type="button">${name}</button>`;
    }).join('');
    container.innerHTML = `
      <div class="cal-header">
        <button class="cal-nav-btn" onclick="invNavMonthYear(-1)" type="button"><i class="ti ti-chevron-left"></i></button>
        <span class="cal-header-center" style="cursor:default">${y}</span>
        <button class="cal-nav-btn" onclick="invNavMonthYear(1)" type="button"><i class="ti ti-chevron-right"></i></button>
      </div>
      <div class="cal-month-grid">${items}</div>`;
  }

  window.invNavMonthYear = function(dir) {
    _invMonthState.viewYear += dir;
    _invRenderMonthGrid();
  };

  window.invSelectMonth = function(month) {
    _invMonthState.selectedYear  = _invMonthState.viewYear;
    _invMonthState.selectedMonth = month;
    _invUpdateMonthTriggerLabel();
    _invCloseMonthPicker();
    // Troca de mês: gera (ou regenera) o inventário desse mês imediatamente.
    window.invGerar();
  };

  function _invCloseMonthPicker() {
    document.getElementById('inv-month-dropdown')?.classList.remove('open');
    document.getElementById('inv-month-trigger')?.classList.remove('open');
  }

  window.invToggleMonthPicker = function() {
    const dropdown = document.getElementById('inv-month-dropdown');
    const trigger  = document.getElementById('inv-month-trigger');
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
      _invCloseMonthPicker();
    } else {
      _invMonthState.viewYear = _invMonthState.selectedYear; // sempre abre focado no ano selecionado
      dropdown.classList.add('open');
      trigger?.classList.add('open');
      _invRenderMonthGrid();
    }
  };

  // Fecha ao clicar fora (mesmo padrão usado pelos outros dropdowns do módulo)
  document.addEventListener('click', e => {
    const wrap = document.getElementById('inv-month-wrap');
    const dropdown = document.getElementById('inv-month-dropdown');
    if (wrap && dropdown?.classList.contains('open') && !wrap.contains(e.target)) {
      _invCloseMonthPicker();
    }
  });
  // Evita que cliques dentro do dropdown fechem ele mesmo (bubbling)
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('inv-month-dropdown')?.addEventListener('click', e => e.stopPropagation());
    _invUpdateMonthTriggerLabel();
  });

  // ── Regra própria do Inventário para Est. Inicial / Est. Final ─────────
  // Mais restrita que o Dashboard Analítico: NÃO usa fallback retroativo
  // no valor, NÃO diferencia categoria de material (mesma regra para todos,
  // inclusive agregados semanais).
  //
  //   EST. INICIAL = lançamento do dia anterior a dtIni.
  //                   Se esse dia anterior for domingo, usa o dia anterior ao domingo (sábado).
  //   EST. FINAL   = lançamento exatamente no último dia do período (dtFim).
  //                   Se dtFim for domingo, usa o dia anterior ao domingo (sábado).
  //
  // Se não houver lançamento na data exata exigida → AUSENTE (valor 0 no
  // cálculo). O tooltip, à parte, busca retroativamente sem limite (ignorando
  // domingos) apenas para informar ao analista qual foi a última data com
  // lançamento encontrada — esse valor NUNCA entra no cálculo da linha.

  // Resolve a data-alvo aplicando a regra do domingo (recua 1 dia se cair num domingo)
  function invResolveTargetDate(baseDate) {
    const d = new Date(baseDate);
    d.setHours(0, 0, 0, 0);
    if (d.getDay() === 0) d.setDate(d.getDate() - 1); // domingo → sábado anterior
    return d;
  }

  // Busca exata: soma todos os lançamentos da central+material na data ISO informada.
  // Retorna { value, dtLabel, missing:false } se achar, ou null se não achar.
  function invFindExactDay(arr, targetISO, targetDate, parseDate, localISODate, num) {
    let total = 0, found = false;
    for (const rec of arr) {
      const d = parseDate(rec.dtLanc);
      if (!d) continue;
      if (localISODate(d) === targetISO) { total += num(rec.peso); found = true; }
    }
    if (!found) return null;
    return { value: total, dtLabel: targetDate.toLocaleDateString('pt-BR'), missing: false };
  }

  // Busca retroativa sem limite (ignorando domingos), só para preencher o
  // tooltip com a última data conhecida com lançamento — não usada no cálculo.
  function invFindLastKnownDate(arr, beforeDate, parseDate, localISODate, num) {
    // Monta lookup de dia → total, uma vez
    const byDay = new Map();
    let minDate = null;
    arr.forEach(rec => {
      const d = parseDate(rec.dtLanc);
      if (!d) return;
      const k = localISODate(d);
      byDay.set(k, (byDay.get(k) || 0) + num(rec.peso));
      if (!minDate || d < minDate) minDate = d;
    });
    if (!byDay.size) return null;

    const cursor = new Date(beforeDate);
    cursor.setHours(0, 0, 0, 0);
    while (cursor >= minDate) {
      if (cursor.getDay() !== 0) { // ignora domingo
        const k = localISODate(cursor);
        if (byDay.has(k)) {
          return { value: byDay.get(k), dtLabel: cursor.toLocaleDateString('pt-BR') };
        }
      }
      cursor.setDate(cursor.getDate() - 1);
    }
    return null;
  }

  window.invGerar = function() {
    // Período próprio do Inventário: sempre um mês calendário completo,
    // selecionado no seletor de mês do módulo (independente do período
    // livre da Visão Micro, que usa o calendário 'an' de calendar.js).
    const selYear  = invGetSelectedYear();
    const selMonth = invGetSelectedMonth(); // 0-based
    const mesKey   = invGetMesKey();

    const h = window._inv_helpers;
    if (!h) { toast('Sistema não iniciado. Aguarde e tente novamente.', 'error'); return; }

    const { getLancIndex, getSapIndex, getCustoMedioPorMat, getFilialLookupIndex, normalizeText, parseDate, localISODate, dateCmp, num, state: getState, getCategoriaPorGrupo, getCatKeyDoCadastro } = h;
    const state = getState();

    const dtIni = new Date(selYear, selMonth, 1, 0, 0, 0);
    const dtFim = new Date(selYear, selMonth + 1, 0, 23, 59, 59);

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
      const byMat = new Map();           // mat (resolvido) -> registros CADASTRADOS
      const semCadLancByOriginal = new Map(); // materialOriginal (texto exato) -> registros SEM cadastro
      lancAll.forEach(r => {
        // catKey/categoria SEMPRE via materialOriginal — nunca via r.material
        // (nome já resolvido), que pode coincidir por acaso com o alias/
        // origem de outro cadastro não relacionado (mesma ambiguidade do
        // caso XYPEX). Revalida contra o cadastro atual a cada análise.
        const catKey = getCatKeyDoCadastro(r.materialOriginal);
        if (!catKey) {
          const key = r.materialOriginal || '—';
          if (!semCadLancByOriginal.has(key)) semCadLancByOriginal.set(key, []);
          semCadLancByOriginal.get(key).push(r);
          return;
        }
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
      const semCadSapByOriginal = new Map();
      sapPer.forEach(r => {
        const catKey = getCatKeyDoCadastro(r.materialOriginal);
        if (!catKey) {
          const key = r.materialOriginal || '—';
          if (!semCadSapByOriginal.has(key)) semCadSapByOriginal.set(key, []);
          semCadSapByOriginal.get(key).push(r);
          return;
        }
        const mat = r.material || '—';
        if (!sapByMat.has(mat)) sapByMat.set(mat, []);
        sapByMat.get(mat).push(r);
      });

      const mats = new Set([...byMat.keys(), ...sapByMat.keys()]);
      const matsSemCadastro = new Set([...semCadLancByOriginal.keys(), ...semCadSapByOriginal.keys()]);

      // Custo médio por material usando EXATAMENTE a mesma lógica do Analítico:
      // Saídas primeiro (Σ valorTotal / Σ peso), fallback SAP.
      // Calculado uma única vez por central para eficiência.
      const custoMedioPorMat = getCustoMedioPorMat(central, dtIni, dtFim);

      mats.forEach(mat => {
        const k = mesKey + '|||' + central + '|||' + mat;
        const lancArr = (byMat.get(mat) || []).slice().sort((a,b) => {
          const da = parseDate(a.dtLanc), db = parseDate(b.dtLanc);
          return ((da||new Date(0)) - (db||new Date(0)));
        });
        const sapArr = sapByMat.get(mat) || [];

        // EST. INICIAL: lançamento exatamente no dia anterior a dtIni.
        // Se esse dia anterior for domingo, usa o dia anterior ao domingo (sábado).
        // Sem fallback no valor — se não achar na data exata, fica AUSENTE (0).
        const iniAlvo = new Date(dtIni); iniAlvo.setDate(iniAlvo.getDate() - 1);
        const iniTargetDate = invResolveTargetDate(iniAlvo);
        const iniTargetISO  = localISODate(iniTargetDate);
        const iniRes = invFindExactDay(lancArr, iniTargetISO, iniTargetDate, parseDate, localISODate, num);
        const estoqueIni = iniRes ? iniRes.value : 0;
        const estoqueIniMissing = !iniRes;
        // Tooltip: só quando ausente, busca retroativa sem limite (não usada no cálculo)
        const estoqueIniLastKnown = estoqueIniMissing
          ? invFindLastKnownDate(lancArr, iniTargetDate, parseDate, localISODate, num)
          : null;

        // EST. FINAL: lançamento exatamente no último dia do período (dtFim).
        // Se dtFim for domingo, usa o dia anterior ao domingo (sábado).
        // Sem fallback no valor — se não achar na data exata, fica AUSENTE (0).
        const fimTargetDate = invResolveTargetDate(dtFim);
        const fimTargetISO  = localISODate(fimTargetDate);
        const fimRes = invFindExactDay(lancArr, fimTargetISO, fimTargetDate, parseDate, localISODate, num);
        const estoqueFimReal = fimRes ? fimRes.value : 0;
        const estoqueFimMissing = !fimRes;
        // Tooltip: só quando ausente, busca retroativa sem limite (não usada no cálculo)
        const estoqueFimLastKnown = estoqueFimMissing
          ? invFindLastKnownDate(lancArr, fimTargetDate, parseDate, localISODate, num)
          : null;

        // Volumes de entradas/saídas vêm do SAP (movimentos físicos).
        let entradasKg = 0, saidasKg = 0;
        const entEntries = [], saiEntries = [];
        sapArr.forEach(r => {
          const p = num(r.peso);
          const cod = String(r.movimento || '—').trim();
          const ref = String(r.ref || r.documento || '—').trim();
          const usr = String(r.usuario || '—').trim();
          // openBreakdownModal (ui.js) espera [cod, value, ref, usuario, dtLanc] —
          // 5 posições. Extração idêntica à usada pelo Analítico (toEntry, analitico.js):
          // string bruta de dtLanc, com fallback para dtDoc, sem reformatar.
          const dtLancFmt = String(r.dtLanc || r.dtDoc || '').trim();
          if (p >= 0) {
            entradasKg += p;
            entEntries.push([cod, p, ref, usr, dtLancFmt]);
          } else {
            saidasKg += Math.abs(p);
            saiEntries.push([cod, p, ref, usr, dtLancFmt]);
          }
        });

        // Custo médio alinhado com o Analítico (Saídas → fallback SAP).
        const custoMedio = custoMedioPorMat[mat] || 0;

        // Chegou até aqui só se getCatKeyDoCadastro(materialOriginal) já
        // confirmou cadastro válido (ver construção de byMat/sapByMat acima)
        // — categoria sempre existe, nunca 'Sem cadastro' neste ramo.
        const categoria = getCategoriaPorGrupo(mat) || '';

        rowMap.set(k, { k, mesKey, central, material: mat, categoria, semCadastro: false, regional, estoqueIni, estoqueIniMissing, estoqueIniLastKnown, entradasKg, saidasKg, estoqueFimReal, estoqueFimMissing, estoqueFimLastKnown, custoMedio, entEntries, saiEntries });
      });

      // ── Materiais SEM cadastro (ou cadastrados sem categoria) ──────────
      // Bloqueados da análise: não entram em nenhuma soma/KPI/gráfico —
      // aparecem na tabela só como registro visível, com valores zerados/
      // traçados e o selo "Sem cadastro" (decisão confirmada: exclusão
      // total, até serem cadastrados). Agrupados por materialOriginal
      // (texto exato), já que não há cadastro para padronizar o nome.
      matsSemCadastro.forEach(matOriginal => {
        const k = mesKey + '|||' + central + '|||__semcad__|||' + matOriginal;
        rowMap.set(k, {
          k, mesKey, central, material: matOriginal, categoria: 'Sem cadastro', semCadastro: true, regional,
          estoqueIni: 0, estoqueIniMissing: true, estoqueIniLastKnown: null,
          entradasKg: 0, saidasKg: 0,
          estoqueFimReal: 0, estoqueFimMissing: true, estoqueFimLastKnown: null,
          custoMedio: 0, entEntries: [], saiEntries: []
        });
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

    invPopulateMicroFilterOptions();

    document.getElementById('inv-empty-state').style.display = 'none';
    document.getElementById('inv-content').style.display = '';

    invFiltrar();
    invAtualizarKpis();
    invAtualizarAlertas();
    toast('Inventário de ' + MESES_NOME[selMonth] + '/' + selYear + ' gerado: ' + invRows.length + ' itens.', 'success');
  };

  // Testa os filtros "base" (Regional/Central/Categoria/Material + toggles
  // de zero/ausência), SEM considerar "Só Pendentes" — usado tanto para
  // montar a tabela quanto para contar o badge de pendentes de forma
  // consistente (o badge não deve "zerar" a própria contagem quando o
  // toggle de pendentes está ligado).
  function _invMatchesBaseFilters(r) {
    const regSet = _invFilter.applied.regional;
    const cenSet = _invFilter.applied.central;
    const catSet = _invFilter.applied.categoria;
    const matSet = _invFilter.applied.material;
    if (regSet.size && !regSet.has(r.regional)) return false;
    if (cenSet.size && !cenSet.has(r.central))  return false;
    if (catSet.size && !catSet.has(r.categoria)) return false;
    if (matSet.size && !matSet.has(r.material))  return false;
    if (_invFilter.hideVarZero && Math.abs(r.varKg) < 0.005) return false;
    if (_invFilter.onlyIniAusente && !r.estoqueIniMissing) return false;
    if (_invFilter.onlyFimAusente && !r.estoqueFimMissing) return false;
    return true;
  }

  function _invIsPendente(r) {
    const j = invJustificativas[r.k] || {};
    return Math.abs(r.varKg) > 0.01 && !(j.op && j.fiscal);
  }

  // ── Filtrar ──────────────────────────────────────────────
  window.invFiltrar = function() {
    invFiltered = invRows.filter(r => {
      if (!_invMatchesBaseFilters(r)) return false;
      if (_invFilter.onlyPendentes && !_invIsPendente(r)) return false;
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
      const hasJust = j.op && j.fiscal;
      const alertBadge = (!hasJust && Math.abs(r.varKg) > 0.01)
        ? '<span style="display:inline-block;width:6px;height:6px;background:var(--amber);border-radius:50%;margin-right:5px;vertical-align:middle;flex-shrink:0" title="Sem justificativa"></span>'
        : '';

      // ── Est. Inicial: teal igual ao analítico; tooltip com última data conhecida ──
      const iniTooltip = r.estoqueIniMissing
        ? (r.estoqueIniLastKnown
            ? `AUSENTE — último lançamento encontrado em ${r.estoqueIniLastKnown.dtLabel} (${_fmtKg(r.estoqueIniLastKnown.value)})`
            : 'AUSENTE — nenhum lançamento anterior encontrado')
        : '';
      const iniCell = r.estoqueIniMissing
        ? `<span class="td-mono" style="color:var(--text3);font-style:italic" title="${_escape(iniTooltip)}">—</span>`
        : `<span class="td-mono" style="color:var(--teal)">${_fmtKg(r.estoqueIni)}</span>`;

      // ── Entradas / Saídas: bdm-trigger igual ao analítico ──
      const entCell = _bdm
        ? _bdm(r.entEntries || [], r.entradasKg, 'var(--green)', 'Entradas')
        : `<span class="td-mono" style="color:var(--green);font-weight:600">${_fmtKg(r.entradasKg)}</span>`;
      const saiCell = _bdm
        ? _bdm(r.saiEntries || [], r.saidasKg, 'var(--red)', 'Saídas')
        : `<span class="td-mono" style="color:var(--red);font-weight:600">${_fmtKg(r.saidasKg)}</span>`;

      // ── Est. Final: teal igual ao analítico; tooltip com última data conhecida ──
      const finTooltip = r.estoqueFimMissing
        ? (r.estoqueFimLastKnown
            ? `AUSENTE — último lançamento encontrado em ${r.estoqueFimLastKnown.dtLabel} (${_fmtKg(r.estoqueFimLastKnown.value)})`
            : 'AUSENTE — nenhum lançamento encontrado no período ou anterior')
        : '';
      const finCell = r.estoqueFimMissing
        ? `<span class="td-mono" style="color:var(--text3);font-style:italic" title="${_escape(finTooltip)}">—</span>`
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
        <td>${r.semCadastro
            ? `<span class="dup-cad-badge dup-cad-badge-morto" style="cursor:pointer" title="Material sem cadastro ou sem categoria preenchida — clique para cadastrar" onclick="_invCadastrarMaterial('${_escape(r.material)}')"><i class="ti ti-alert-triangle" style="font-size:9px"></i> Sem cadastro</span>`
            : `<span style="font-size:10px;background:var(--bg4);border:1px solid var(--border2);border-radius:20px;padding:2px 8px;color:var(--text2);white-space:nowrap">${_escape(r.categoria)}</span>`
          }</td>
        <td style="text-align:right;white-space:nowrap">${iniCell}</td>
        <td style="text-align:right;white-space:nowrap">${entCell}</td>
        <td style="text-align:right;white-space:nowrap">${saiCell}</td>
        <td style="text-align:right;white-space:nowrap">${finCell}</td>
        <td style="text-align:right;white-space:nowrap">${teorCell}</td>
        <td style="text-align:right;white-space:nowrap">${varCell}</td>
        <td style="text-align:right;white-space:nowrap">${custoVarCell}</td>
        <td style="text-align:right;white-space:nowrap">${saldoCell}</td>
        <td style="text-align:right;white-space:nowrap">${varAdjCell}</td>
        <td style="text-align:right;white-space:nowrap">${custoMedCell}</td>
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
    invAtualizarSemCadastro();

    // Usa invRows (total geral do inventário gerado) — os cards NÃO reagem
    // aos filtros de Regional/Central/Categoria/Material/Ocultar Variação 0.
    // Só a tabela (invFiltered) e os Alertas Pendentes seguem o filtro.
    // Materiais SEM cadastro são excluídos de TODAS as somas — decisão
    // confirmada: bloqueados da análise até serem cadastrados, contados
    // à parte só no indicador de pendência (invAtualizarSemCadastro).
    const invRowsCadastrados = invRows.filter(r => !r.semCadastro);
    const totalIni = invRowsCadastrados.reduce((s,r)=>s+r.estoqueIni,0);
    const totalEnt = invRowsCadastrados.reduce((s,r)=>s+r.entradasKg,0);
    const totalSai = invRowsCadastrados.reduce((s,r)=>s+r.saidasKg,0);
    const totalFin = invRowsCadastrados.reduce((s,r)=>s+r.estoqueFimReal,0);

    // Variação BRUTA: varKg sem desconto de justificativas
    const totalVarBruto = invRowsCadastrados.reduce((s,r)=>s+r.varKg,0);
    // Variação AJUSTADA: varAdj após descontar saldo justificado
    const totalVarAdj   = invRowsCadastrados.reduce((s,r)=>s+r.varAdj,0);

    // Custo BRUTO: varKg × custoMedio (independente de justificativas)
    const totalCstBruto = invRowsCadastrados.reduce((s,r)=>s+(r.varKg * r.custoMedio),0);
    // Custo AJUSTADO: varAdj × custoMedio
    const totalCstAdj   = invRowsCadastrados.reduce((s,r)=>s+r.custo,0);

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
    // Ausente aqui é "sem lançamento na data alvo" (material CADASTRADO,
    // problema de dado) — distinto de "sem cadastro" (problema de
    // padronização, já coberto pelo indicador próprio). Por isso usa
    // invRowsCadastrados, não invRows.
    const missingIniRows = invRowsCadastrados.filter(r => r.estoqueIniMissing).map(r => `${r.central} · ${r.material}`);
    const missingFimRows = invRowsCadastrados.filter(r => r.estoqueFimMissing).map(r => `${r.central} · ${r.material}`);
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

  // ── Alertas pendentes (badge do filtro "Só Pendentes") ────
  function invAtualizarAlertas() {
    // Conta sob os filtros "base" (Regional/Central/Categoria/Material +
    // toggles de zero/ausência), mas SEM aplicar o próprio "Só Pendentes"
    // — assim o número no badge não vira sempre igual ao da tabela quando
    // o filtro está ligado; ele mostra quantos itens pendentes existem
    // dentro do recorte atual, ligado ou não.
    const pendentes = invRows.filter(r => _invMatchesBaseFilters(r) && _invIsPendente(r));
    const badge = document.getElementById('inv-alertas-count');
    if (badge) badge.textContent = pendentes.length;
  }

  // ── Botão de alerta: materiais sem cadastro/categoria ──────
  // Mesmo espírito do badge "sem Est. Ini./Est. Fim" já existente nos KPIs,
  // mas em âmbar e via modal sob demanda (não é dado de estoque ausente, é
  // cadastro de padronização ausente — a causa raiz é sempre corrigível em
  // Configurações). Conta sobre invRows (total geral), não invFiltered —
  // mesmo critério dos demais KPIs, que não reagem aos filtros da tabela.
  function invAtualizarSemCadastro() {
    const el = document.getElementById('inv-sem-cadastro-box');
    if (!el) return;
    const materiaisSemCadastro = [...new Set(
      invRows.filter(r => r.semCadastro).map(r => r.material)
    )].sort();

    _invSemCadastroLista = materiaisSemCadastro; // cache p/ o modal

    if (!materiaisSemCadastro.length) {
      el.innerHTML = `
        <button type="button" class="alert-pulse-btn is-ok" disabled style="margin-bottom:14px">
          <i class="ti ti-circle-check"></i>
          Materiais do período OK
        </button>`;
      return;
    }

    el.innerHTML = `
      <button type="button" class="alert-pulse-btn is-amber" onclick="_invSemCadastroAbrirModal()" style="margin-bottom:14px">
        <i class="ti ti-alert-triangle"></i>
        Há ${materiaisSemCadastro.length} ${materiaisSemCadastro.length === 1 ? 'material' : 'materiais'} não cadastrado${materiaisSemCadastro.length === 1 ? '' : 's'}
      </button>`;
  }

  // Cache da última lista calculada — usado pelo modal, para não precisar
  // recalcular nem depender de invRows estar acessível fora deste escopo.
  let _invSemCadastroLista = [];

  // Auxiliar mínimo de escape — usa o helper compartilhado se disponível,
  // senão cai no fallback local (mesmo padrão já usado em invRenderTabela).
  function _invEscape(s) {
    const h = window._inv_helpers;
    return h ? h.escapeHtml(s) : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // Abre o modal com a lista completa de materiais sem cadastro (scroll
  // interno — sem paginação "ver mais").
  window._invSemCadastroAbrirModal = function() {
    document.getElementById('alert-modal-inv-sem-cad')?.remove();
    const lista = _invSemCadastroLista;
    if (!lista.length) return;

    const rows = lista.map(m => `
      <div class="dup-cad-row">
        <span class="dup-cad-alias" title="${_invEscape(m)}">${_invEscape(m)}</span>
        <button class="btn-icon" type="button" title="Cadastrar agora" onclick="_invCadastrarMaterial('${_invEscape(m)}')">
          <i class="ti ti-plus"></i>
        </button>
      </div>`).join('');

    const overlay = document.createElement('div');
    overlay.id = 'alert-modal-inv-sem-cad';
    overlay.className = 'alert-modal-overlay';
    const _escInvSemCad = (e) => {
      if (!document.body.contains(overlay)) { document.removeEventListener('keydown', _escInvSemCad); return; }
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', _escInvSemCad); }
    };
    document.addEventListener('keydown', _escInvSemCad);
    overlay.innerHTML = `
      <div class="alert-modal-card">
        <div class="alert-modal-header">
          <div>
            <div class="alert-modal-title is-amber"><i class="ti ti-alert-octagon"></i> Há materiais não cadastrados</div>
            <div class="alert-modal-sub">${lista.length} ${lista.length === 1 ? 'material' : 'materiais'} sem cadastro/categoria — não é possível classificar nem aplicar corretamente as regras de análise até completar o cadastro em Configurações</div>
          </div>
          <button class="alert-modal-close" onclick="document.getElementById('alert-modal-inv-sem-cad').remove()"><i class="ti ti-x"></i></button>
        </div>
        <div class="alert-modal-body"><div class="dup-cad-group">${rows}</div></div>
      </div>`;
    document.body.appendChild(overlay);
  };

  // Abre o modal de cadastro de Materiais já pré-preenchido com o nome,
  // pronto para o analista completar "= ALIAS = CATEGORIA". Mesmo padrão
  // de _pendPadronizacaoAbrirCadastro (dashboard.js) para material não
  // cadastrado.
  window._invCadastrarMaterial = function(nome) {
    document.getElementById('alert-modal-inv-sem-cad')?.remove();
    openModal('modal-materiais');
    setVal('materiais-text', nome + ' = ');
    setTimeout(() => {
      const el = document.getElementById('materiais-text');
      if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; }
    }, 50);
  };

  // ── Modal de justificativa ───────────────────────────────
  // Navegação Anterior/Próximo: percorre uma "fila" de pendentes (variação
  // >0,01kg e ainda sem justificativa completa) na ordem visual atual da
  // tabela (invFiltered), fixada no momento em que o modal é aberto pela
  // primeira vez — evita que a fila "pule" no meio da revisão por causa de
  // reordenação/recalculo disparado pelo próprio salvamento. Se o registro
  // aberto não for pendente (ex.: "Ver/Editar" de um já justificado), ele
  // é incluído à parte na fila, na posição em que aparece na tabela, só
  // para não quebrar a navegação nesse caso pontual.
  let _invNavQueue = [];
  let _invNavIdx   = -1;

  function _invBuildNavQueue(k) {
    _invNavQueue = invFiltered.filter(r => _invIsPendente(r) || r.k === k).map(r => r.k);
    _invNavIdx = _invNavQueue.indexOf(k);
  }

  // Exige os 3 campos preenchidos (operacional, fiscal e saldo) — sem
  // justificativa parcial. Retorna null se válido, ou mensagem de erro.
  function _invValidarJustForm() {
    const op     = document.getElementById('inv-j-op')?.value.trim();
    const fiscal = document.getElementById('inv-j-fiscal')?.value.trim();
    const saldo  = document.getElementById('inv-j-saldo')?.value;
    if (!op || !fiscal || saldo === '' || saldo == null) {
      return 'Preencha justificativa operacional, justificativa fiscal e saldo justificado antes de salvar.';
    }
    return null;
  }

  // Salva os dados do formulário atual no registro k (sem fechar/navegar).
  function _invSalvarJustCore(k) {
    const op     = document.getElementById('inv-j-op')?.value.trim();
    const fiscal = document.getElementById('inv-j-fiscal')?.value.trim();
    const saldo  = document.getElementById('inv-j-saldo')?.value;
    invJustificativas[k] = { op, fiscal, saldo };
    const row = invRows.find(r => r.k === k);
    if (row) {
      const saldoJust = parseFloat(saldo||0)||0;
      row.saldoJust = saldoJust;
      row.varAdj = row.varKg - saldoJust;
      row.custo  = row.varAdj * row.custoMedio;
    }
    invFiltrar();
    invAtualizarKpis();
    invAtualizarAlertas();
  }

  window.invAbrirJust = function(k) {
    _invBuildNavQueue(k);
    _invRenderJustModal(k);
  };

  // dir: -1 (Anterior) ou +1 (Próximo). Valida e salva o registro atual
  // antes de avançar; se inválido, avisa e permanece no mesmo registro.
  window._invNavJust = function(dir) {
    const kAtual = _invNavQueue[_invNavIdx];
    const erro = _invValidarJustForm();
    if (erro) { toast(erro, 'error'); return; }
    _invSalvarJustCore(kAtual);
    const novoIdx = _invNavIdx + dir;
    if (novoIdx < 0 || novoIdx >= _invNavQueue.length) return; // botão já deveria estar desabilitado
    _invNavIdx = novoIdx;
    _invRenderJustModal(_invNavQueue[_invNavIdx]);
  };

  // ── Opções de Justificativa Fiscal (dropdown) ─────────────
  // Base: lista oficial fornecida pelo usuário (29 itens). Itens marcados
  // com "// NOVO" foram criados para equilibrar as categorias que tinham
  // poucas opções (mín. 6 por categoria, mesmo padrão de nomenclatura
  // "CATEGORIA – Descrição específica").
  const _INV_JUST_FISCAL_OPCOES = {
    'CONTROLE OPERACIONAL': [
      'CONTROLE OPERACIONAL – OSCILAÇÃO OPERACIONAL',
      'CONTROLE OPERACIONAL – REGULARIZAÇÃO DE INVENTÁRIO ANTERIOR',
      'CONTROLE OPERACIONAL – AJUSTE DE CONTAGEM FÍSICA', // NOVO
      'CONTROLE OPERACIONAL – DIVERGÊNCIA DE SALDO INICIAL', // NOVO
      'CONTROLE OPERACIONAL – CONSOLIDAÇÃO DE LANÇAMENTOS DO PERÍODO', // NOVO
      'CONTROLE OPERACIONAL – REVISÃO DE PERÍODO ANTERIOR', // NOVO
    ],
    'EVENTO OPERACIONAL': [
      'EVENTO OPERACIONAL – ALTERAÇÃO OPERACIONAL',
      'EVENTO OPERACIONAL – MATERIAL DETERIORADO',
      'EVENTO OPERACIONAL – MISTURA DE MATERIAIS',
      'EVENTO OPERACIONAL – RECEBIMENTO ADICIONAL',
      'EVENTO OPERACIONAL – TRANSFERÊNCIA SEM REGISTRO',
      'EVENTO OPERACIONAL – TROCA DE MATERIAL',
    ],
    'FALHA OPERACIONAL': [
      'FALHA OPERACIONAL – CONTROLE OPERACIONAL LOCAL',
      'FALHA OPERACIONAL – DESFALQUE OPERACIONAL',
      'FALHA OPERACIONAL – DIVERGÊNCIA EM EQUIPAMENTO DE PESAGEM',
      'FALHA OPERACIONAL – INCONSISTÊNCIA EM CUBAGEM',
      'FALHA OPERACIONAL – MANUSEIO DE MATERIAL',
      'FALHA OPERACIONAL – MEDIÇÃO INCORRETA',
      'FALHA OPERACIONAL – SOLICITAÇÕES NÃO REALIZADAS',
    ],
    'FALHA SISTÊMICA': [
      'FALHA SISTÊMICA – AJUSTE INTERMENSAL',
      'FALHA SISTÊMICA – DENSIDADE INCORRETA',
      'FALHA SISTÊMICA – ERRO NO ESTOQUE FINAL',
      'FALHA SISTÊMICA – ERRO NO ESTOQUE INICIAL',
      'FALHA SISTÊMICA – DUPLICIDADE DE LANÇAMENTOS NO PERÍODO', // NOVO
      'FALHA SISTÊMICA – INSTABILIDADE NO SISTEMA DE GESTÃO', // NOVO
    ],
    'LIMITAÇÃO OPERACIONAL': [
      'LIMITAÇÃO OPERACIONAL – ARMAZENAMENTO IRREGULAR',
      'LIMITAÇÃO OPERACIONAL – AUSÊNCIA DE GRADUAÇÃO EM SILO',
      'LIMITAÇÃO OPERACIONAL – CONDIÇÃO DO EQUIPAMENTO',
      'LIMITAÇÃO OPERACIONAL – DIFICULDADE DE CONFERÊNCIA',
      'LIMITAÇÃO OPERACIONAL – MATERIAL EM MÚLTIPLOS SILOS',
      'LIMITAÇÃO OPERACIONAL – PARALISAÇÃO OPERACIONAL',
    ],
    'VARIAÇÃO OPERACIONAL': [
      'VARIAÇÃO OPERACIONAL – AJUSTE LOCAL',
      'VARIAÇÃO OPERACIONAL – DENTRO DA MARGEM',
      'VARIAÇÃO OPERACIONAL – MATERIAL SEM MOVIMENTAÇÃO',
      'VARIAÇÃO OPERACIONAL – MATERIAL ZERADO',
      'VARIAÇÃO OPERACIONAL – PERDA NATURAL DO PROCESSO', // NOVO
      'VARIAÇÃO OPERACIONAL – CONSUMO ACIMA DO PADRÃO', // NOVO
    ],
  };

  function _invMontarOptionsFiscal(selecionado) {
    return Object.entries(_INV_JUST_FISCAL_OPCOES).map(([categoria, itens]) => `
      <optgroup label="${categoria}">
        ${itens.map(op => `<option value="${op}" ${op === selecionado ? 'selected' : ''}>${op}</option>`).join('')}
      </optgroup>`).join('');
  }

  function _invRenderJustModal(k) {
    const row = invRows.find(r => r.k === k);
    if (!row) return;
    const j = invJustificativas[k] || {};
    document.getElementById('inv-modal')?.remove();
    const h = window._inv_helpers;
    const _fmtKg     = h ? h.fmtKg      : (v) => fmt(v) + ' kg';
    const _varClass  = h ? h.varClass   : (v) => v < 0 ? 'diff-neg' : v > 0 ? 'diff-pos' : 'diff-zero';
    const _money     = h ? h.money      : fmtR;
    const _escape    = h ? h.escapeHtml : (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const vkCls  = _varClass(row.varKg);
    const cstCls = _varClass(row.custo);

    const temFila   = _invNavQueue.length > 1;
    const podeAnt   = _invNavIdx > 0;
    const podeProx  = _invNavIdx >= 0 && _invNavIdx < _invNavQueue.length - 1;
    const posicaoBadge = _invNavIdx >= 0
      ? `<span style="font-size:10.5px;font-weight:700;font-family:var(--mono);color:var(--accent);background:var(--accent-dim);border-radius:20px;padding:3px 10px;white-space:nowrap;flex-shrink:0">${_invNavIdx+1} / ${_invNavQueue.length} pend.</span>`
      : '';

    // Ícone maior e proporcional ao valor (varSymbol tem font-size fixo em
    // 11px — ok em células de tabela, mas pequeno demais junto do número
    // em destaque aqui). Mesma lógica de sinal/cor de varIcon (dashboard.js),
    // só que sem tamanho fixo, herdando o font-size do contêiner pai.
    const _heroIcon = (v) => {
      if (v > 0.0001)  return '<i class="ti ti-trending-up" style="color:var(--amber)"></i>';
      if (v < -0.0001) return '<i class="ti ti-trending-down" style="color:var(--red)"></i>';
      return '<i class="ti ti-minus" style="color:var(--green)"></i>';
    };

    const modal = document.createElement('div');
    modal.id = 'inv-modal';
    modal.className = 'modal-overlay open';
    modal.style.cssText = 'position:fixed;z-index:9999';
    modal.innerHTML = `
      <div class="modal-card" style="max-width:560px;width:100%">
        <div class="modal-header">
          <div>
            <span class="modal-title"><i class="ti ti-clipboard-text"></i> ${_escape(row.central)} · ${_escape(row.material)}</span>
            <div style="font-size:11px;color:var(--text2);margin-top:3px">${_escape(row.regional)} · ${_escape(row.categoria)}</div>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            ${posicaoBadge}
            <button class="modal-close" onclick="document.getElementById('inv-modal').remove()"><i class="ti ti-x"></i></button>
          </div>
        </div>
        <div class="modal-body" style="display:flex;flex-direction:column;gap:14px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div style="background:var(--bg3);border:1px solid var(--border2);border-radius:10px;padding:12px 10px;text-align:center">
              <div class="oc-label" style="margin-bottom:7px">Variação (kg)</div>
              <div class="td-mono ${vkCls}" style="font-size:18px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap">
                ${_heroIcon(row.varKg)} ${_fmtKg(Math.abs(row.varKg))}
              </div>
            </div>
            <div style="background:var(--bg3);border:1px solid var(--border2);border-radius:10px;padding:12px 10px;text-align:center">
              <div class="oc-label" style="margin-bottom:7px">Custo Var. (R$)</div>
              <div class="td-mono ${cstCls}" style="font-size:18px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap">
                ${_heroIcon(row.custo)} ${_money(Math.abs(row.custo))}
              </div>
            </div>
          </div>
          <div class="oc-form-group">
            <label class="oc-label">Justificativa Operacional <span class="oc-required">*</span></label>
            <textarea id="inv-j-op" class="oc-input oc-textarea" rows="2" placeholder="Ex: falha no medidor da brita, perda por chuva...">${_escape(j.op||'')}</textarea>
          </div>
          <div class="oc-form-group">
            <label class="oc-label">Justificativa Fiscal <span class="oc-required">*</span> <span class="oc-hint">(para inspeção)</span></label>
            <select id="inv-j-fiscal" class="oc-input">
              <option value="" ${!j.fiscal ? 'selected' : ''} disabled>Selecione uma justificativa fiscal...</option>
              ${_invMontarOptionsFiscal(j.fiscal||'')}
            </select>
          </div>
          <div class="oc-form-group">
            <label class="oc-label">Saldo Justificado (kg) <span class="oc-required">*</span> <span class="oc-hint">parte/total da variação com causa identificada</span></label>
            <div style="display:flex;gap:8px;align-items:stretch">
              <input id="inv-j-saldo" type="number" class="oc-input" placeholder="0" value="${j.saldo||''}" style="flex:1">
              <button type="button" class="btn" style="white-space:nowrap;flex-shrink:0" onclick="document.getElementById('inv-j-saldo').value='${(Math.round(row.varKg*100)/100)}'" title="Preenche com a variação total, já com o sinal de ${row.varKg < 0 ? 'desfalque (negativo)' : 'sobra (positivo)'}">Variação total</button>
            </div>
          </div>
        </div>
        <div class="modal-footer" style="justify-content:space-between">
          <button class="btn" onclick="document.getElementById('inv-modal').remove()">Cancelar</button>
          <div style="display:flex;gap:8px">
            ${temFila ? `<button class="btn" ${podeAnt?'':'disabled style="opacity:.35;cursor:default;pointer-events:none"'} onclick="_invNavJust(-1)" title="Salva e vai para o pendente anterior"><i class="ti ti-chevron-left"></i> Anterior</button>` : ''}
            ${temFila ? `<button class="btn" ${podeProx?'':'disabled style="opacity:.35;cursor:default;pointer-events:none"'} onclick="_invNavJust(1)" title="Salva e vai para o próximo pendente">Próximo <i class="ti ti-chevron-right"></i></button>` : ''}
            <button class="btn btn-primary" onclick="invSalvarJust('${k}')"><i class="ti ti-device-floppy"></i> Salvar</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const _escInvModal = e => {
      if (!document.body.contains(modal)) { document.removeEventListener('keydown', _escInvModal); return; }
      if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', _escInvModal); }
    };
    document.addEventListener('keydown', _escInvModal);
  }

  window.invSalvarJust = function(k) {
    const erro = _invValidarJustForm();
    if (erro) { toast(erro, 'error'); return; }
    _invSalvarJustCore(k);
    document.getElementById('inv-modal')?.remove();
    toast('Justificativa salva.', 'success');
  };

  // ── Exportar CSV ─────────────────────────────────────────
  // Revisão: o header antigo tinha uma coluna "Cod" sem dado correspondente
  // no array de valores, desalinhando TODAS as colunas seguintes (Material
  // saía embaixo de "Cod", Categoria embaixo de "Material", etc.). Também
  // exportava números com ponto decimal e cauda de ponto-flutuante (ex.:
  // 1234.5600000000004), incoerente com o delimitador ';' de CSV pt-BR, e
  // exportava Est. Inicial/Final AUSENTE como "0", indistinguível de um
  // estoque realmente zerado.
  window.invExportar = function() {
    if (!invRows.length) { toast('Gere o inventário antes de exportar.', 'error'); return; }

    // Formata número no padrão pt-BR (vírgula decimal, 2 casas fixas) —
    // consistente com o resto do app (fmtKg/money) e com o delimitador ';'.
    const _n = (v, dec = 2) => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });

    const header = ['Regional','Filial','Material','Categoria','Est.Ini.(kg)','Est.Ini. Ausente?','Entradas(kg)','Saídas(kg)','Est.Teórico(kg)','Est.Real(kg)','Est.Final Ausente?','Var.(kg)','Var.(%)','Custo Médio (R$/kg)','Custo Variação (R$)','Saldo Justificado (kg)','Var.Ajustada (kg)','Just.Operacional','Just.Fiscal'];
    const rows = invRows.map(r => {
      const j = invJustificativas[r.k] || {};
      return [
        r.regional,
        r.central,
        r.material,
        r.categoria,
        r.estoqueIniMissing ? '' : _n(r.estoqueIni),
        r.estoqueIniMissing ? 'SIM' : 'NÃO',
        _n(r.entradasKg),
        _n(r.saidasKg),
        _n(r.estTeor),
        r.estoqueFimMissing ? '' : _n(r.estoqueFimReal),
        r.estoqueFimMissing ? 'SIM' : 'NÃO',
        _n(r.varKg),
        _n(r.varPct),
        _n(r.custoMedio),
        _n(r.custo),
        j.saldo ? _n(parseFloat(j.saldo)) : '',
        _n(r.varAdj),
        j.op || '',
        j.fiscal || ''
      ].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(';');
    });
    const csv = [header.join(';'), ...rows].join('\n');
    const blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8'});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    // Nome do arquivo reflete o MÊS DO INVENTÁRIO (não a data do export) —
    // essencial pra rastreabilidade quando o inventário é de um mês passado.
    a.href = url; a.download = 'inventario_' + invGetMesKey() + '.csv';
    a.click(); URL.revokeObjectURL(url);
  };

  // ── renderInventario (chamado por anSwitchView ao entrar na Visão Inventário) ──
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

  // Fecha dropdowns dos filtros ao clicar fora (mesmo padrão da Visão Micro)
  document.addEventListener('click', e => {
    ['regional','central','categoria','material'].forEach(key => {
      const group = document.getElementById(`imfg-${key}`);
      if (group && !group.contains(e.target)) {
        const dd = document.getElementById(`imfd-${key}`);
        if (dd?.classList.contains('open')) {
          _invFilter.pending[key] = new Set(_invFilter.applied[key]);
          _invCloseDropdown(key);
        }
      }
    });
  });
})();
