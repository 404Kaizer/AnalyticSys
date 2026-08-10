// ═══════════════════════════════════════════════════════════
// MÓDULO: INVENTÁRIO
// ═══════════════════════════════════════════════════════════
(function() {
  let invRows = [];
  let invFiltered = [];
  let invJustificativas = {};
  let _invHidratado = false; // evita reidratar do state em toda chamada de invGerar

  // ── Seleção múltipla (Justificar em lote) ──────────────────
  // _invSelected guarda as chaves (r.k) marcadas, independente do filtro
  // atual estar escondendo a linha ou não (seleção "gruda" ao trocar
  // filtro; só é limpa ao sair do modo seleção ou gerar um novo período —
  // ver invToggleSelectMode/invGerar).
  let _invSelectMode = false;
  let _invSelected = new Set();

  // ── Toggle global "Considerar NFs/OS pendentes" ─────────────
  // Equivalente ao botão por central da Visão Micro, mas aplicado de uma vez
  // só a TODAS as centrais da tabela do Inventário (não há cards por central
  // aqui). Quando ligado, injeta volumes sintéticos de NFs/OS pendentes de
  // integração SAP em Entradas/Saídas — mesma lógica de buildCentralCard em
  // analitico.js. Estado próprio do módulo (não compartilha com
  // window._pendConsiderados, que é por central e usado só pela Visão
  // Micro) — reseta ao trocar de mês (ver invGerar).
  let _invConsiderarPendentes = false;

  // Reconstrói o objeto-mapa em memória (invJustificativas[k] = {...}) a
  // partir do array persistido em state.invJustificativas. Chamada uma
  // única vez, lazy, na primeira geração — porque na hora em que este
  // arquivo carrega, o state ainda pode não estar restaurado/hidratado.
  function _invHydrateJustificativas() {
    if (_invHidratado) return;
    _invHidratado = true;
    const h = window._inv_helpers;
    const st = h && h.state && h.state();
    const arr = (st && Array.isArray(st.invJustificativas)) ? st.invJustificativas : [];
    invJustificativas = {};
    arr.forEach(rec => {
      if (!rec || !rec.k) return;
      const { k, ...resto } = rec;
      invJustificativas[k] = resto;
    });
  }

  // Espelha o mapa em memória de volta pro state (formato array, mesmo
  // padrão dos outros dados persistidos) e dispara o autosave debounced
  // do sistema (persist(), em persist.js). Chamada depois de toda
  // mutação em invJustificativas (salvar no modal, importar CSV).
  function _invSyncJustificativasToState(keys) {
    const h = window._inv_helpers;
    const st = h && h.state && h.state();
    if (!st) return;
    st.invJustificativas = Object.keys(invJustificativas).map(k => ({ k, ...invJustificativas[k] }));
    if (typeof window.persist === 'function') window.persist();
    if (keys && keys.length) _invSyncToSupabase(keys);
  }

  // Sincroniza só as chaves TOCADAS com o Supabase (upsert) — nunca o mapa
  // inteiro: upar tudo a cada salvamento gerava um UPDATE por linha no
  // activity_log (centenas/milhares) e a notificação de atividade virava
  // ruído tipo "editou 738 registros" pra uma edição de UM campo (achado
  // do usuário, 07/08). Exclusões (invExcluirJust/invExcluirJustLote) têm
  // sua própria chamada de delete, não passam por aqui. Falha não bloqueia
  // a UI (já atualizada localmente).
  function _invSyncToSupabase(keys) {
    if (!window.supabaseClient) return;
    const rows = keys.map(k => {
      const j = invJustificativas[k] || {};
      return {
        k,
        op: j.op || null,
        fiscal: j.fiscal || null,
        saldo: j.saldo != null && j.saldo !== '' ? String(j.saldo) : null,
        custo_medio_sap: j.custoMedioSap != null && j.custoMedioSap !== '' ? String(j.custoMedioSap) : null,
        documento_sap: j.documentoSap || null,
      };
    });
    if (!rows.length) return;
    window.supabaseClient.from('inv_justificativas').upsert(rows, { onConflict: 'user_id,k' })
      .then(({ error }) => {
        if (error) {
          console.warn('[Supabase] Falha ao sincronizar justificativas de inventário:', error);
          if (typeof toast === 'function') toast('⚠ Salvo nesta sessão, mas não foi possível sincronizar com a nuvem.', 'error');
        }
      });
  }

  function _invSyncDeleteFromSupabase(ks) {
    if (!ks || !ks.length) return;
    // Escopado ao próprio user_id (ver _supaDeleteOwned, normalize.js): `k`
    // é uma chave composta de negócio (mês|central|material) que já colide
    // entre contas de usuários diferentes.
    _supaDeleteOwned('inv_justificativas', null, { k: ks })
      .then(({ error }) => {
        if (error) console.warn('[Supabase] Falha ao excluir justificativa(s) na nuvem:', error);
      });
  }

  // Força a re-hidratação do mapa em memória a partir do state. Necessária
  // após um RESTAURAR de backup, que substitui state.invJustificativas por
  // fora do módulo: sem isto, o mapa em memória continuaria com os dados
  // antigos e a próxima _invSyncJustificativasToState() (ao salvar qualquer
  // justificativa) sobrescreveria de volta o que foi restaurado, perdendo o
  // backup silenciosamente. Também regenera a tabela se já houver um
  // resultado do Inventário na tela, para refletir os estados restaurados.
  window._invReloadJustificativas = function() {
    _invHidratado = false;
    _invHydrateJustificativas();
    try {
      // Só regenera se o usuário já tem uma tabela do Inventário aberta
      // (id 'inv-table'); caso contrário, o mapa recém-hidratado já basta e
      // a tabela será montada corretamente na próxima geração.
      if (document.getElementById('inv-table') && typeof window.invGerar === 'function') {
        window.invGerar();
      }
    } catch (err) {
      console.warn('[Inventário] Falha ao regenerar tabela após restore de justificativas:', err);
    }
  };

  // 4 estados do botão/linha de justificativa (ver invRenderTabela):
  // "justificar" (cinza, nada preenchido) → "pendente" (âmbar, algo
  // preenchido mas SEM Operacional e Fiscal) → "justificado" (azul,
  // Operacional+Fiscal preenchidos mas falta o restante) → "ajustado"
  // (verde, tudo preenchido, incluindo Custo Médio SAP e Documento SAP).
  const _INV_ESTADO_STYLE = {
    justificar:  { bg: 'var(--bg4)',       border: 'var(--border2)',      color: 'var(--text2)', icon: 'ti-pencil',         label: 'Justificar'  },
    pendente:    { bg: 'var(--amber-bg)',  border: 'var(--amber-border)', color: 'var(--amber)',  icon: 'ti-alert-triangle', label: 'Pendente'    },
    justificado: { bg: 'var(--accent-dim)',border: 'var(--accent)',       color: 'var(--accent)', icon: 'ti-check',          label: 'Justificado' },
    ajustado:    { bg: 'var(--green-bg)',  border: 'var(--green-border)', color: 'var(--green)',  icon: 'ti-checks',         label: 'Ajustado'    },
  };

  function fmt(n, dec=0) {
    if (n == null || isNaN(n)) return '—';
    return n.toLocaleString('pt-BR', {minimumFractionDigits:dec, maximumFractionDigits:dec});
  }
  function fmtR(n) {
    if (n == null || isNaN(n)) return '—';
    return 'R$ ' + n.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
  }

  // ── Sorting state ─────────────────────────────────────────
  let invSortCol = 'custoSap', invSortDir = 'desc';

  // ── Filtros — mesmo padrão visual/comportamental da Visão Micro
  //    do Dashboard Analítico (chips com dropdown multi-seleção,
  //    busca interna, Aplicar/Cancelar/Limpar). Estado próprio do
  //    módulo (não usa window._microFilter do analitico.js).
  const _invFilter = {
    pending: { regional: new Set(), central: new Set(), categoria: new Set(), material: new Set() },
    applied: { regional: new Set(), central: new Set(), categoria: new Set(), material: new Set() },
    options: { regional: [], central: [], categoria: [], material: [] },
    // Filtro "Margem" — faixa numérica (De/Até) sobre a coluna Variação
    // (kg). null em qualquer um dos dois lados = sem limite naquele lado
    // (ex.: só margemMin preenchido = "≥ margemMin", sem teto). Substitui
    // o antigo toggle booleano "Ocultar Variação 0" — que só escondia a
    // faixa perto de zero; agora o usuário define a faixa exata que quer
    // ver (ex.: DE -5000 ATÉ 20000), incluindo poder isolar só desfalque
    // (ATÉ negativo) ou só sobra (DE positivo). Ver invApplyMargem/
    // _invMatchesMargem.
    margemMin: null,
    margemMax: null,
    // Dropdown de seleção única sobre QUALQUER tipo de ausência da linha,
    // não só Estoque: false (Todos) -> 'ini' (só Est. Inicial AUSENTE) ->
    // 'fim' (só Est. Final AUSENTE) -> 'custo' (só Custo Médio AUSENTE —
    // ver _invCustoAusente) -> 'sem' (só linhas SEM nenhuma ausência,
    // nenhum dos três acima) -> volta pra false. Mesmos flags usados nas
    // células da tabela e nos badges dos cards (estoqueIniMissing/
    // estoqueFimMissing/custoMedioSap).
    ausencia: false,
    // Filtro "Justificativa" — dropdown de seleção única com base no MESMO
    // estado do botão Justificar de cada linha (_invEstadoDaLinha): false
    // (Todos) -> 'justificar' (Não Justificados) -> 'pendente' (Pendentes)
    // -> 'justificado' (Justificados) -> 'ajustado' (Ajustados). Substitui
    // o antigo toggle booleano "Só Pendentes". Ao contrário do antigo
    // _invIsPendente, NÃO considera relevância da variação — segue puro o
    // estado do botão Justificar (ver invSetJustificativa/invFiltrar).
    justificativa: false,
    // Toggle de 3 estados: false (desligado) -> 'com' (só itens com pelo
    // menos 1 categoria de Divergência identificada — registro manual,
    // duplicidade, pendência de integração SAP, ocorrência operacional
    // aberta — ver r.divergencias/r.divCount, calculados em invGerar) ->
    // 'sem' (só itens SEM nenhuma divergência) -> volta pra false. Mesmo
    // padrão do justificativa: fica de FORA de _invMatchesBaseFilters de
    // propósito, pra o badge de contagem (inv-divergencias-count) mostrar
    // quantas linhas TERIAM achados dentro do recorte atual, sem "zerar" a
    // própria contagem quando o toggle já está ligado.
    onlyDivergencias: false
  };


  const _invFilterKeyLabels = { regional: 'Regional', central: 'Central', categoria: 'Categoria', material: 'Material' };

  // Custo Médio "ausente" pro filtro/dropdown de Ausência — MESMA condição
  // que já decide o badge AUSENTE/SEM CÓD SAP nas colunas de custo da
  // tabela (custoMedCell etc.): cobre tanto material sem Cód SAP cadastrado
  // ('sem_codigo') quanto Cód SAP sem custo em Custos SAP pro central/mês
  // ('ausente') — tratados como um só tipo de ausência, sem distinção.
  function _invCustoAusente(r) {
    return !(r.custoMedioSap > 0);
  }

  // Linhas-base para calcular as opções de um filtro: considera TODOS os
  // demais filtros JÁ APLICADOS (dropdowns Regional/Central/Categoria/
  // Material, exceto o da própria chave, + os toggles Margem, Início/Fim
  // Ausente, Justificativa e Só Divergências) — se um registro não passa
  // em algum filtro ativo, o valor dele não aparece como opção em nenhum
  // dropdown, mesmo que "exista" na base bruta.
  function _invOptionsSourceRows(key) {
    const keys = ['regional', 'central', 'categoria', 'material'];
    return invRows.filter(r => {
      for (const k of keys) {
        if (k === key) continue;
        const set = _invFilter.applied[k];
        if (set && set.size && !set.has(r[k])) return false;
      }
      if (!_invMatchesMargem(r)) return false;
      if (_invFilter.ausencia === 'ini' && !r.estoqueIniMissing) return false;
      if (_invFilter.ausencia === 'fim' && !r.estoqueFimMissing) return false;
      if (_invFilter.ausencia === 'custo' && !_invCustoAusente(r)) return false;
      if (_invFilter.ausencia === 'sem' && (r.estoqueIniMissing || r.estoqueFimMissing || _invCustoAusente(r))) return false;
      if (!_invMatchesJustificativa(r)) return false;
      if (_invFilter.onlyDivergencias === 'com' && !(r.divCount > 0)) return false;
      if (_invFilter.onlyDivergencias === 'sem' && !(r.divCount === 0)) return false;
      return true;
    });
  }

  function _invRecomputeOptions(key) {
    _invFilter.options[key] = [...new Set(_invOptionsSourceRows(key).map(r => r[key]).filter(Boolean))].sort();
  }

  // Popula as opções de cada filtro a partir das linhas geradas (invRows)
  function invPopulateMicroFilterOptions() {
    ['regional','central','categoria','material'].forEach(key => {
      _invRecomputeOptions(key);
      _invBuildOptionsList(key);
      _invSyncTriggerLabel(key);
    });
    _invSyncClearBtn();
  }

  function _invEscape(s) {
    const h = window._inv_helpers;
    return h ? h.escapeHtml(s) : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
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
      _invRecomputeOptions(key);
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
    _invFilter.margemMin = null;
    _invFilter.margemMax = null;
    _invFilter.ausencia = false;
    _invFilter.justificativa = false;
    _invFilter.onlyDivergencias = false;
    _invSyncMargemBtn();
    _invSyncAusenteBtns();
    _invSyncJustificativaBtn();
    _invSyncDivergenciasBtn();
    _invSyncClearBtn();
    invFiltrar();
    invAtualizarKpis();
    invAtualizarAlertas();
  };

  // Filtro "Margem" — dropdown com faixa numérica De/Até sobre a coluna
  // Variação (kg), com Aplicar/Cancelar/Limpar (mesmo padrão dos filtros
  // Regional/Central/Categoria/Material, mas com 2 campos numéricos em vez
  // de lista de checkboxes). Substitui o antigo toggle "Ocultar Variação 0".
  window.invToggleMargemDropdown = function() {
    _invCloseOtherSimpleDropdowns('margem');
    const dd = document.getElementById('imfd-margem');
    const chev = document.getElementById('imfc-margem');
    if (!dd) return;
    const isOpen = dd.classList.toggle('open');
    chev?.classList.toggle('open', isOpen);
    if (isOpen) {
      // Repopula os campos com o filtro já aplicado (não com um rascunho
      // anterior não aplicado) toda vez que o dropdown é reaberto.
      const minEl = document.getElementById('imf-margem-min');
      const maxEl = document.getElementById('imf-margem-max');
      if (minEl) minEl.value = _invFilter.margemMin ?? '';
      if (maxEl) maxEl.value = _invFilter.margemMax ?? '';
      setTimeout(() => minEl?.focus(), 50);
    }
  };

  window.invApplyMargem = function() {
    const minEl = document.getElementById('imf-margem-min');
    const maxEl = document.getElementById('imf-margem-max');
    let min = minEl && minEl.value !== '' ? parseFloat(minEl.value) : null;
    let max = maxEl && maxEl.value !== '' ? parseFloat(maxEl.value) : null;
    if (min !== null && isNaN(min)) min = null;
    if (max !== null && isNaN(max)) max = null;
    // DE/ATÉ digitados invertidos (ex.: DE 20000 ATÉ -5000) — troca os dois
    // em vez de aplicar um filtro que zera a tabela por engano de digitação.
    if (min !== null && max !== null && min > max) { const t = min; min = max; max = t; }
    _invFilter.margemMin = min;
    _invFilter.margemMax = max;
    document.getElementById('imfd-margem')?.classList.remove('open');
    document.getElementById('imfc-margem')?.classList.remove('open');
    _invSyncMargemBtn();
    _invSyncClearBtn();
    invFiltrar();
    invAtualizarKpis();
    invAtualizarAlertas();
  };

  window.invCancelMargem = function() {
    // Não reverte nada no estado: os campos só mostram um rascunho até
    // "Aplicar"; ao reabrir, invToggleMargemDropdown repopula com o valor
    // aplicado atual, descartando o rascunho cancelado.
    document.getElementById('imfd-margem')?.classList.remove('open');
    document.getElementById('imfc-margem')?.classList.remove('open');
  };

  window.invClearMargem = function() {
    _invFilter.margemMin = null;
    _invFilter.margemMax = null;
    const minEl = document.getElementById('imf-margem-min');
    const maxEl = document.getElementById('imf-margem-max');
    if (minEl) minEl.value = '';
    if (maxEl) maxEl.value = '';
    document.getElementById('imfd-margem')?.classList.remove('open');
    document.getElementById('imfc-margem')?.classList.remove('open');
    _invSyncMargemBtn();
    _invSyncClearBtn();
    invFiltrar();
    invAtualizarKpis();
    invAtualizarAlertas();
  };

  // Filtro "Ausência" — dropdown com 5 opções (Todos / Só Est. Inicial
  // Ausente / Só Est. Final Ausente / Só Custo Médio Ausente / Sem
  // Ausência). Cobre qualquer tipo de ausência da linha, não só Estoque.
  // Substituiu o antigo botão de toggle alternado (cicla às cegas) por um
  // dropdown, no mesmo padrão dos filtros Regional/Central/Categoria/Material.
  window.invToggleAusenciaDropdown = function() {
    _invCloseOtherSimpleDropdowns('ausencia');
    const dd = document.getElementById('imfd-ausencia');
    const chev = document.getElementById('imfc-ausencia');
    if (!dd) return;
    const isOpen = dd.classList.toggle('open');
    chev?.classList.toggle('open', isOpen);
  };

  window.invSetAusencia = function(state) {
    _invFilter.ausencia = state;
    _invSyncAusenteBtns();
    _invSyncClearBtn();
    _invCloseDropdownSimple('ausencia');
    invFiltrar();
    invAtualizarKpis();
    invAtualizarAlertas();
  };

  // Filtro "Justificativa" — dropdown de seleção única (Todos / Não
  // Justificados / Pendentes / Justificados / Ajustados), com base no MESMO
  // estado do botão Justificar de cada linha (_invEstadoDaLinha). Substitui
  // o antigo botão de toggle booleano "Só Pendentes" — mesmo padrão dos
  // demais dropdowns simples (Ausência, Divergências).
  window.invToggleJustificativaDropdown = function() {
    _invCloseOtherSimpleDropdowns('justificativa');
    const dd = document.getElementById('imfd-justificativa');
    const chev = document.getElementById('imfc-justificativa');
    if (!dd) return;
    const isOpen = dd.classList.toggle('open');
    chev?.classList.toggle('open', isOpen);
  };

  window.invSetJustificativa = function(state) {
    _invFilter.justificativa = state;
    _invSyncJustificativaBtn();
    _invSyncClearBtn();
    _invCloseDropdownSimple('justificativa');
    invFiltrar();
    invAtualizarKpis();
    invAtualizarAlertas();
  };

  // Toggle "Considerar NFs/OS pendentes" — MESMA LÓGICA da Visão Micro
  // (togglePendConsiderados em ui.js), mas global: afeta NF e OS de TODAS as
  // centrais da tabela de uma vez (a Visão Micro liga/desliga por central,
  // porque tem um card por central; o Inventário é uma tabela única). Ao
  // contrário dos demais toggles acima (que só filtram a tabela já gerada),
  // este muda o VALOR de Entradas/Saídas/Variação/Custo — por isso chama
  // invGerar() inteiro, não só invFiltrar().
  window.invToggleConsiderarPendentes = function() {
    _invConsiderarPendentes = !_invConsiderarPendentes;
    _invSyncConsiderarPendentesBtn();
    if (invRows.length || document.getElementById('inv-table')) window.invGerar();
  };

  function _invSyncConsiderarPendentesBtn() {
    const btn = document.getElementById('imft-pend-considerar');
    if (btn) btn.classList.toggle('active', _invConsiderarPendentes);
  }

  // Filtro "Divergências" — dropdown com 3 opções (Todos / Só Divergências
  // [itens COM pelo menos 1 categoria de Divergência identificada] / Só Sem
  // Divergências). Substituiu o antigo botão de toggle alternado.
  window.invToggleDivergenciasDropdown = function() {
    _invCloseOtherSimpleDropdowns('divergencias');
    const dd = document.getElementById('imfd-divergencias');
    const chev = document.getElementById('imfc-divergencias');
    if (!dd) return;
    const isOpen = dd.classList.toggle('open');
    chev?.classList.toggle('open', isOpen);
  };

  window.invSetDivergencias = function(state) {
    _invFilter.onlyDivergencias = state;
    _invSyncDivergenciasBtn();
    _invSyncClearBtn();
    _invCloseDropdownSimple('divergencias');
    invFiltrar();
    invAtualizarKpis();
    invAtualizarAlertas();
  };

  // ── Helpers dos dropdowns simples (seleção única, sem Aplicar/Cancelar) ──
  function _invCloseDropdownSimple(key) {
    document.getElementById(`imfd-${key}`)?.classList.remove('open');
    document.getElementById(`imfc-${key}`)?.classList.remove('open');
  }
  function _invCloseOtherSimpleDropdowns(exceptKey) {
    ['ausencia', 'divergencias', 'justificativa', 'margem'].filter(k => k !== exceptKey).forEach(_invCloseDropdownSimple);
  }

  function _invSyncMargemBtn() {
    const btn = document.getElementById('imft-margem');
    if (!btn) return;
    const { margemMin, margemMax } = _invFilter;
    const active = margemMin !== null || margemMax !== null;
    btn.classList.toggle('active', active);
    const label = document.getElementById('imft-margem-label');
    const fmtNum = v => v.toLocaleString('pt-BR');
    if (label) {
      label.textContent = !active
        ? 'Margem'
        : (margemMin !== null && margemMax !== null) ? `${fmtNum(margemMin)} a ${fmtNum(margemMax)} kg`
        : (margemMin !== null) ? `≥ ${fmtNum(margemMin)} kg`
        : `≤ ${fmtNum(margemMax)} kg`;
    }
    btn.title = active
      ? 'Filtra a coluna Variação (kg) pela faixa definida — clique para ajustar'
      : 'Filtra a coluna Variação (kg) por uma faixa De/Até definida por você';
  }

  function _invSyncAusenteBtns() {
    const btn = document.getElementById('imft-ausencia');
    if (!btn) return;
    const st = _invFilter.ausencia;
    btn.classList.toggle('active', st !== false);
    btn.classList.toggle('inv-div-sem', st === 'sem');
    const label = document.getElementById('imft-ausencia-label');
    const shortLabels = { ini: 'Est. Inicial Ausente', fim: 'Est. Final Ausente', custo: 'Custo Médio Ausente', sem: 'Sem Ausência' };
    if (label) label.textContent = st ? `Ausência: ${shortLabels[st]}` : 'Ausência';
    const titles = {
      ini: 'Mostra só linhas com Est. Inicial AUSENTE',
      fim: 'Mostra só linhas com Est. Final AUSENTE',
      custo: 'Mostra só linhas com Custo Médio AUSENTE (sem Cód SAP cadastrado ou sem custo em Custos SAP pro central/mês)',
      sem: 'Mostra só linhas SEM nenhuma ausência (Est. Inicial, Est. Final e Custo Médio todos preenchidos)'
    };
    btn.title = titles[st] || 'Filtra por qualquer tipo de ausência da linha: Estoque Inicial, Estoque Final ou Custo Médio';
    const icon = document.getElementById('imft-ausencia-icon');
    if (icon) icon.style.color = st === 'sem' ? 'var(--green, #10b981)' : '';
    // Marca a opção ativa dentro do dropdown
    document.querySelectorAll('#imfd-ausencia .micro-filter-option--radio').forEach(opt => {
      const val = opt.dataset.val === 'false' ? false : opt.dataset.val;
      opt.classList.toggle('selected', val === st);
      opt.classList.toggle('inv-div-sem', val === 'sem');
    });
  }

  // Rótulos do dropdown "Justificativa" (plural, voltados a filtro) — os
  // rótulos de _INV_ESTADO_STYLE são no singular e usados no botão de cada
  // linha da tabela ("Justificar", "Pendente" etc.), por isso um mapa à parte aqui.
  const _INV_JUSTIFICATIVA_FILTER_LABELS = {
    justificar: 'Não Justificados',
    pendente: 'Pendentes',
    justificado: 'Justificados',
    ajustado: 'Ajustados'
  };

  function _invSyncJustificativaBtn() {
    const btn = document.getElementById('imft-justificativa');
    if (!btn) return;
    const state = _invFilter.justificativa; // false | 'justificar' | 'pendente' | 'justificado' | 'ajustado'
    btn.classList.toggle('active', state !== false);
    const label = document.getElementById('imft-justificativa-label');
    const icon = document.getElementById('imft-justificativa-icon');
    const st = state && _INV_ESTADO_STYLE[state];
    if (label) label.textContent = st ? _INV_JUSTIFICATIVA_FILTER_LABELS[state] : 'Justificativa';
    if (icon) {
      icon.className = 'ti ' + (st ? st.icon : 'ti-alert-triangle');
      icon.style.color = st ? st.color : 'var(--amber)';
    }
    btn.title = st
      ? `Mostra só itens no estado "${_INV_ESTADO_STYLE[state].label}" do botão Justificar`
      : 'Filtra pelo status do botão Justificar de cada linha (Não Justificados / Pendentes / Justificados / Ajustados)';
    // Marca a opção ativa dentro do dropdown
    document.querySelectorAll('#imfd-justificativa .micro-filter-option--radio').forEach(opt => {
      const val = opt.dataset.val === 'false' ? false : opt.dataset.val;
      opt.classList.toggle('selected', val === state);
    });
  }

  function _invSyncDivergenciasBtn() {
    const btn = document.getElementById('imft-divergencias');
    if (!btn) return;
    const state = _invFilter.onlyDivergencias;
    btn.classList.toggle('active', state !== false);
    btn.classList.toggle('inv-div-sem', state === 'sem');
    const label = document.getElementById('imft-divergencias-label');
    const shortLabels = { com: 'Só Divergências', sem: 'Só Sem Divergências' };
    if (label) label.textContent = state ? shortLabels[state] : 'Divergências';
    btn.title = state === 'sem'
      ? 'Mostra só itens SEM nenhuma causa de variação identificada'
      : 'Filtra por causas da variação identificadas (registro manual, duplicidade, pendência de integração SAP ou ocorrência aberta)';
    const color = state === 'sem' ? 'var(--green, #10b981)' : 'var(--accent)';
    const icon = document.getElementById('imft-divergencias-icon');
    if (icon) icon.style.color = color;
    const badge = document.getElementById('inv-divergencias-count');
    if (badge) badge.style.background = color;
    // Marca a opção ativa dentro do dropdown
    document.querySelectorAll('#imfd-divergencias .micro-filter-option--radio').forEach(opt => {
      const val = opt.dataset.val === 'false' ? false : opt.dataset.val;
      opt.classList.toggle('selected', val === state);
      opt.classList.toggle('inv-div-sem', val === 'sem');
    });
  }

  // ── Modo seleção (checkboxes) — pra "Justificar em lote" ────
  window.invToggleSelectMode = function() {
    _invSelectMode = !_invSelectMode;
    document.getElementById('inv-table')?.classList.toggle('inv-select-mode', _invSelectMode);
    if (!_invSelectMode) _invSelected.clear(); // saiu do modo -> descarta a seleção
    _invSyncSelectModeBtn();
    _invSyncBatchBar();
    invRenderTabela(); // garante que os checkboxes reflitam _invSelected (limpo ou não)
    invAtualizarKpis(); // KPIs/barra seguem a seleção — precisa recalcular ao entrar/sair do modo
  };

  function _invSyncSelectModeBtn() {
    const btn = document.getElementById('imft-selecionar');
    if (btn) btn.classList.toggle('active', _invSelectMode);
    const cb = document.getElementById('inv-select-all-cb');
    if (cb && !_invSelectMode) cb.checked = false;
  }

  function _invSyncBatchBar() {
    const bar = document.getElementById('inv-batch-bar');
    const countEl = document.getElementById('inv-batch-count');
    const btn = document.getElementById('inv-batch-btn');
    const delBtn = document.getElementById('inv-batch-delete-btn');
    const n = _invSelected.size;
    if (bar) bar.style.display = _invSelectMode ? 'flex' : 'none';
    if (countEl) countEl.textContent = n === 1 ? '1 selecionada' : `${n} selecionadas`;
    if (btn) btn.disabled = n < 1;
    if (delBtn) delBtn.disabled = n < 1;
  }

  // Bridge somente-leitura pro módulo de Notas de Crédito/Débito (ncd.js)
  // — evita expor invRows/invFiltered/_invSelected/invJustificativas
  // (todos privados a este IIFE) como variáveis globais soltas. Chamado
  // só sob demanda (clique no botão de gerar notas), nunca em loop —
  // retornar as referências atuais é seguro porque ncd.js só LÊ, nunca
  // muta nada aqui.
  window._invGetDadosParaNotas = function() {
    return {
      invRows,
      invFiltered,
      selecionados: new Set(_invSelected),
      justificativas: invJustificativas,
      varIrrelevante: _invVarIrrelevante,
    };
  };

  // "Selecionar todos" marca/desmarca só as linhas atualmente visíveis
  // (invFiltered) — não mexe em seleções de linhas escondidas por filtro.
  window.invToggleSelectAll = function(checked) {
    invFiltered.forEach(r => {
      if (r.semCadastro) return; // sem cadastro não tem fluxo de justificativa
      if (checked) _invSelected.add(r.k); else _invSelected.delete(r.k);
    });
    invRenderTabela();
    _invSyncBatchBar();
    invAtualizarKpis(); // KPIs/barra seguem a seleção
  };

  window.invToggleRowSelect = function(k, checked) {
    if (checked) _invSelected.add(k); else _invSelected.delete(k);
    _invSyncBatchBar();
    invAtualizarKpis(); // KPIs/barra seguem a seleção
  };

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
    const hasAny = _invFilter.applied.regional.size || _invFilter.applied.central.size || _invFilter.applied.categoria.size || _invFilter.applied.material.size || _invFilter.margemMin !== null || _invFilter.margemMax !== null || _invFilter.ausencia || _invFilter.justificativa || _invFilter.onlyDivergencias;
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

  // ── Tela cheia da tabela ─────────────────────────────────
  // 1ª tentativa usava position:fixed direto no .inv-table-wrap, ainda
  // dentro de .page-content — não funcionou no ambiente real (topbar/
  // sidebar continuavam por cima). Agora usa o mesmo padrão comprovado do
  // analitico-detail-overlay (modal de detalhe da Visão Micro, em
  // ui.js/index.html): um overlay de verdade, elemento de topo no HTML.
  // Ao expandir, o PRÓPRIO .inv-table-wrap é MOVIDO (não clonado) pra
  // dentro do #inv-fullscreen-slot — preserva 100% do JS já ligado aos
  // ids da tabela (tbody, sort, filtros etc.), sem precisar duplicar ou
  // sincronizar nada. Ao fechar, volta pro lugar original marcado por
  // #inv-table-wrap-anchor.
  window.toggleInvTableFullscreen = function() {
    const wrap    = document.querySelector('.inv-table-wrap');
    const overlay = document.getElementById('inv-fullscreen-overlay');
    const slot    = document.getElementById('inv-fullscreen-slot');
    const anchor  = document.getElementById('inv-table-wrap-anchor');
    const btn     = document.getElementById('inv-table-fullscreen-btn');
    if (!wrap || !overlay || !slot || !anchor || !btn) return;

    const isOpen = overlay.classList.contains('open');
    if (!isOpen) {
      slot.appendChild(wrap);
      wrap.classList.add('is-fullscreen');
      overlay.classList.add('open');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.classList.add('inv-fullscreen-open');
      btn.innerHTML = '<i class="ti ti-minimize"></i> <span>Recolher</span>';
    } else {
      anchor.parentNode.insertBefore(wrap, anchor);
      wrap.classList.remove('is-fullscreen');
      overlay.classList.remove('open');
      overlay.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('inv-fullscreen-open');
      btn.innerHTML = '<i class="ti ti-maximize"></i> <span>Expandir</span>';
    }
  };

  // ESC sai do modo tela cheia — mesmo padrão de fechamento usado nos
  // modais do sistema (ex.: modal de justificativa, mais acima neste arquivo).
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('inv-fullscreen-overlay')?.classList.contains('open')) {
      window.toggleInvTableFullscreen();
    }
  });

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

  // ── Est. Inicial / Est. Final do Inventário agora usam EXATAMENTE a mesma
  // lógica da Visão Micro (h.getPrePeriodLaunchStock / h.getLastPeriodLaunchStockWithFallback,
  // ambas em ui.js) — regra por categoria no Est. Inicial e fallback retroativo
  // (dentro do próprio período) no Est. Final. Ver chamadas dentro de
  // window.invGerar, mais abaixo.
  //
  // invFindLastKnownDate abaixo continua existindo só para alimentar o
  // tooltip de "AUSENTE" (busca retroativa sem limite, ignorando domingos) —
  // esse valor nunca entra no cálculo da linha, é só informativo.

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

  // ── Divergências (Registros manuais, Duplicidade, Pendência SAP,
  // Ocorrências) — chama funções globais já existentes no sistema (ui.js/
  // normalize.js/ocorrencias.js, nenhuma delas dentro de IIFE, então ficam
  // disponíveis em window mesmo sem passar por _inv_helpers). Chamada
  // defensiva: se por algum motivo a função não estiver carregada ainda,
  // devolve o fallback vazio em vez de quebrar a geração do inventário.
  function _invSafeCall(fnName, fallback, ...args) {
    const fn = window[fnName];
    if (typeof fn !== 'function') return fallback;
    try { return fn(...args); } catch (e) { return fallback; }
  }

  function _invGerarCore() {
    // Novo período gerado → chaves de linha (mesKey|||central|||material)
    // mudam de mês, então qualquer seleção anterior fica obsoleta. Sai do
    // modo seleção e limpa tudo pra não arrastar estado de um mês pro
    // outro sem perceber.
    _invSelected.clear();
    _invSelectMode = false;
    document.getElementById('inv-table')?.classList.remove('inv-select-mode');
    _invSyncSelectModeBtn();
    _invSyncBatchBar();

    // Período próprio do Inventário: sempre um mês calendário completo,
    // selecionado no seletor de mês do módulo (independente do período
    // livre da Visão Micro, que usa o calendário 'an' de calendar.js).
    const selYear  = invGetSelectedYear();
    const selMonth = invGetSelectedMonth(); // 0-based
    const mesKey   = invGetMesKey();

    const h = window._inv_helpers;
    if (!h) { toast('Sistema não iniciado. Aguarde e tente novamente.', 'error'); return; }
    _invHydrateJustificativas();

    const { getLancIndex, getSapIndex, getSaidasIndex, getCustoMedioCustosSap, buildCustosSapIndex, getFilialLookupIndex, normalizeText, parseDate, localISODate, dateCmp, num, state: getState, getCategoriaPorGrupo, getCatKeyDoCadastro, getCodSapPorGrupo, isSapExcluidoPorFechamento, somarPesoCustoSap } = h;
    const state = getState();
    // Custo médio: SÓ Custos SAP (central + Cód SAP + mês calendário do
    // Inventário), sem cascata — mesma fonte/índice da Visão Micro (ver
    // normalize.js). Construído uma vez por geração.
    const _custosSapIdx = buildCustosSapIndex();

    // ── Fontes de "Divergências" (ver invAbrirDivergencias mais abaixo) ──
    // Duplicidade — mesmas funções/critério já usados nas páginas de
    // Lançamentos e SAP (botão "Somente duplicatas"), garantindo que a
    // definição de "duplicata" nunca diverge entre os módulos.
    const lancDupKeys = _invSafeCall('getLancamentoDuplicateKeys', new Set());
    const sapDupInfo  = _invSafeCall('getSapDuplicateKeys', { real: new Set(), cancelled: new Set() });
    // Ocorrências operacionais ainda abertas (não concluídas/inconclusivas)
    // e com Material preenchido — ocorrências sem material específico não
    // entram aqui (decisão: evitar "poluir" todas as linhas de uma central
    // com uma ocorrência genérica; ver resumo da entrega). Indexadas por
    // central normalizada (mesmo normalizeText usado no resto do módulo)
    // para busca O(1) por central dentro do loop principal.
    const ocByCentralNorm = new Map();
    (state.ocorrencias || []).forEach(o => {
      if (o.concluida || o.inconclusiva || !o.material) return;
      const key = normalizeText(o.central || '');
      if (!ocByCentralNorm.has(key)) ocByCentralNorm.set(key, []);
      ocByCentralNorm.get(key).push(o);
    });

    const dtIni = new Date(selYear, selMonth, 1, 0, 0, 0);
    const dtFim = new Date(selYear, selMonth + 1, 0, 23, 59, 59);

    const { byCentral: lancByCentral } = getLancIndex();
    const { byCentral: sapByCentral }  = getSapIndex();
    const { byCentral: saiByCentral }  = getSaidasIndex();
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
      // Ajustes de Fechamento Mensal (Y11/Y12) — desconsiderados do cálculo
      // de Entradas/Saídas/Variação, coletados por material para o badge
      // por linha (ver invRenderTabela) com soma de peso/custo no modal.
      const sapFechExcluidosByMat = new Map();
      sapPer.forEach(r => {
        const catKey = getCatKeyDoCadastro(r.materialOriginal);
        if (!catKey) {
          const key = r.materialOriginal || '—';
          if (!semCadSapByOriginal.has(key)) semCadSapByOriginal.set(key, []);
          semCadSapByOriginal.get(key).push(r);
          return;
        }
        const mat = r.material || '—';
        if (isSapExcluidoPorFechamento(r)) {
          if (!sapFechExcluidosByMat.has(mat)) sapFechExcluidosByMat.set(mat, []);
          sapFechExcluidosByMat.get(mat).push(r);
          return;
        }
        if (!sapByMat.has(mat)) sapByMat.set(mat, []);
        sapByMat.get(mat).push(r);
      });

      const mats = new Set([...byMat.keys(), ...sapByMat.keys()]);
      const matsSemCadastro = new Set([...semCadLancByOriginal.keys(), ...semCadSapByOriginal.keys()]);


      // NFs/OS pendentes de integração SAP nesta central+período — mesma
      // função usada nos cards do Analítico (calcPendentesIntegracao, em
      // ui.js). Calculado uma vez por central; filtrado por material dentro
      // do loop de materiais logo abaixo.
      const pendCentral = _invSafeCall('calcPendentesIntegracao', { pendNF: [], pendOS: [] }, { central, dtIni, dtFim, sapNoPeriodo: sapPer });
      const ocsCentral  = ocByCentralNorm.get(normalizeText(central)) || [];

      // ── Entradas/Saídas da página (mesma central) — usadas na comparação
      // SAP × página no rodapé do modal de Movimentações (ver localEntTotal/
      // localSaiTotal abaixo e localEntCount/localSaiCount em analitico.js,
      // mesmo critério). Filtrado por material+período dentro do loop de
      // materiais logo abaixo. Prioridade de central para Entradas:
      // centralDestino primeiro, fallback centralCompra (a pedido do Hugo,
      // 06/08) — INVERSA da usada por calcPendentesIntegracao/NFs Pendentes
      // (pendCentral acima), que continua com a prioridade original.
      const entradasDestaCentral = (state.entradas || []).filter(e => (e.centralDestino || e.centralCompra || '') === central);
      const saidasDestaCentral = saiByCentral.get(central) || [];

      mats.forEach(mat => {
        const k = mesKey + '|||' + central + '|||' + mat;
        const lancArr = (byMat.get(mat) || []).slice().sort((a,b) => {
          const da = parseDate(a.dtLanc), db = parseDate(b.dtLanc);
          return ((da||new Date(0)) - (db||new Date(0)));
        });
        const sapArr = sapByMat.get(mat) || [];

        // Categoria/catKey do material — precisa vir ANTES do Est. Inicial,
        // pois a regra de busca depende da categoria (ver getPrevDayLaunchStock
        // em ui.js): Agregado usa regra semanal (última terça), os demais usam
        // regra diária (ou "1º do mês", que busca o último dia do mês anterior).
        // Chegou até aqui só se getCatKeyDoCadastro(materialOriginal) já
        // confirmou cadastro válido (ver construção de byMat/sapByMat acima)
        // — categoria sempre existe, nunca 'Sem cadastro' neste ramo.
        const categoria = getCategoriaPorGrupo(mat) || '';
        const matCatKey = getCatKeyDoCadastro(mat) || null;
        const codSap = getCodSapPorGrupo(mat) || '';

        // EST. INICIAL — MESMA LÓGICA da Visão Micro (getPrevDayLaunchStock,
        // via h.getPrePeriodLaunchStock): regra por categoria do material —
        //   • Agregado (lançamento semanal): última terça-feira antes do
        //     início do período (com fallback pro lançamento mais recente
        //     entre essa terça e o início, se houver).
        //   • Material do 1º dia do mês: último dia do mês anterior.
        //   • Demais materiais: dia anterior ao início (dom→sáb).
        // Sem fallback de VALOR em nenhum dos casos — se não achar na
        // data-alvo da regra, fica AUSENTE (tratado como 0 no cálculo).
        const iniRes = h.getPrePeriodLaunchStock({ central, material: mat, dtIni, dtFim, catKey: matCatKey });
        const estoqueIni = iniRes ? iniRes.value : 0;
        const estoqueIniMissing = !iniRes;
        // Tooltip: só quando ausente, busca retroativa sem limite (não usada no cálculo)
        const estoqueIniLastKnown = estoqueIniMissing
          ? invFindLastKnownDate(lancArr, dtIni, parseDate, localISODate, num)
          : null;

        // EST. FINAL — MESMA LÓGICA da Visão Micro
        // (h.getLastPeriodLaunchStockWithFallback): tenta a data exata (último
        // dia não-domingo do período); se não achar, RECUA dia a dia dentro do
        // próprio período até encontrar um lançamento (fallback retroativo).
        // Só fica AUSENTE se nenhum dia do período tiver lançamento.
        // estoqueFimFallback=true sinaliza pro analista que o valor usado NÃO é
        // do dia de fechamento esperado (estoqueFimEsperado) — ele precisa
        // cobrar/corrigir o lançamento daquele dia (ver badge "retroativo" em
        // invRenderTabela, deixado explícito de propósito pra não passar
        // despercebido como se fosse um Est. Final normal).
        const fimRes = h.getLastPeriodLaunchStockWithFallback({ central, material: mat, dtIni, dtFim });
        const estoqueFimMissing  = !fimRes || fimRes.missing;
        const estoqueFimReal     = estoqueFimMissing ? 0 : fimRes.value;
        const estoqueFimFallback = !estoqueFimMissing && !!fimRes.fallback;
        const estoqueFimEsperado = fimRes ? fimRes.expectedLabel : null;
        // Data real usada (quando não ausente) — igual à esperada em caso
        // normal, ou anterior em caso de fallback retroativo. Usada no
        // badge/tooltip "retroativo" (invRenderTabela) e no KPI de resumo.
        const estoqueFimUsadoLabel = !estoqueFimMissing ? fimRes.dtLabel : null;
        // Tooltip: só quando ausente, busca retroativa sem limite (não usada no cálculo)
        const estoqueFimLastKnown = estoqueFimMissing
          ? invFindLastKnownDate(lancArr, dtFim, parseDate, localISODate, num)
          : null;

        // ── Pendências de integração SAP (NF/OS) desta central+material —
        // usadas tanto pelo badge de Divergências quanto (se o toggle global
        // "Considerar NFs/OS pendentes" estiver ligado) pra injetar volumes
        // sintéticos em Entradas/Saídas — MESMA lógica da Visão Micro
        // (buildCentralCard, analitico.js). Resolve sempre pelo cadastro
        // ATUAL (normalizarMaterial), nunca pelo .material bruto do registro.
        const nfPendMat = (pendCentral.pendNF || []).filter(r => _invSafeCall('normalizarMaterial', r.material || '', r.materialOriginal || r.material) === mat);
        const osPendMat = (pendCentral.pendOS || []).filter(r => _invSafeCall('normalizarMaterial', r.material || '', r.materialOriginal || r.material) === mat);

        // sapArr permanece "limpo" (sem sintéticos) pra Divergências — imune
        // ao toggle, mesmo princípio do sapByMatClean na Visão Micro. Só a
        // cópia usada no cálculo de Entradas/Saídas/Variação/Custo
        // (sapArrCalc) recebe os registros sintéticos das pendências
        // consideradas. pendEntAplicado/pendSaiAplicado marcam, por linha, se
        // Entradas e/ou Saídas foram de fato alteradas pelo toggle — usado
        // pelo selo ao lado das células (ver invRenderTabela) pra deixar
        // explícito o que foi afetado.
        let sapArrCalc = sapArr;
        let pendEntAplicado = false, pendSaiAplicado = false;
        if (_invConsiderarPendentes && (nfPendMat.length || osPendMat.length)) {
          sapArrCalc = sapArr.slice();
          if (nfPendMat.length) {
            nfPendMat.forEach(e => {
              sapArrCalc.push({
                movimento: '101',
                peso:      _invSafeCall('_convertNfPesoToKg', 0, e.peso, e.um, e.material),
                ref:       String(e.nf || ''),
                documento: '',
                material:  mat,
                dtLanc:    e.dtDescarga || e.dtEmissao || '',
                usuario:   '',
                _sintetico: true
              });
            });
            pendEntAplicado = true;
          }
          if (osPendMat.length) {
            osPendMat.forEach(e => {
              sapArrCalc.push({
                movimento: '201',
                peso:      -Math.abs(num(e.peso)),
                ref:       String(e.os || ''),
                documento: '',
                material:  mat,
                dtLanc:    e.dtEmissao || '',
                usuario:   '',
                _sintetico: true
              });
            });
            pendSaiAplicado = true;
          }
        }

        // Volumes de entradas/saídas vêm do SAP (movimentos físicos) — MESMA
        // separação por sinal da Visão Micro (buildSnapshot): peso > 0 entra
        // em Entradas, peso < 0 entra em Saídas, peso === 0 não conta em
        // nenhuma das duas (antes: peso >= 0 jogava o zero pra Entradas).
        let entradasKg = 0, saidasKg = 0;
        const entEntries = [], saiEntries = [];
        sapArrCalc.forEach(r => {
          const p = num(r.peso);
          // openBreakdownModal (ui.js) espera [cod, value, ref, usuario, dtLanc, extra] —
          // extração IDÊNTICA à usada pelo Analítico (toEntry, analitico.js): cod
          // normalizado via normMov (mesma função usada pelos badges e pelo
          // pareamento de transferências 861/862/309), ref com fallback pra
          // documento (só uso interno de pareamento), e um objeto extra com
          // depósito + refRaw/documento (colunas Ref./Documento separadas) +
          // as 3 datas cruas (documento/lançamento/registro).
          const cod = normMov(r.movimento);
          const ref = (r.ref && String(r.ref).trim()) ? String(r.ref).trim()
                    : (r.documento && String(r.documento).trim()) ? String(r.documento).trim() : '';
          const usr = String(r.usuario || '').trim();
          const dtLancFmt = String(r.dtLanc || r.dtDoc || '').trim();
          const extra = {
            deposito:  String(r.deposito  || '').trim(),
            refRaw:    String(r.ref       || '').trim(),
            documento: String(r.documento || '').trim(),
            dtDoc:     String(r.dtDoc     || '').trim(),
            dtLanc:    String(r.dtLanc    || '').trim(),
            dtReg:     String(r.dtReg     || '').trim()
          };
          if (p > 0) {
            entradasKg += p;
            entEntries.push([cod, p, ref, usr, dtLancFmt, extra]);
          } else if (p < 0) {
            saidasKg += Math.abs(p);
            saiEntries.push([cod, p, ref, usr, dtLancFmt, extra]);
          }
        });

        // Totais lançados na página Entradas/Saídas para este material —
        // mesmo escopo do modal (material + central + período) — usados na
        // comparação SAP × página no rodapé do modal de Movimentações (ver
        // localEntTotal/localSaiTotal, mesmo critério de analitico.js). Peso
        // da NF/OS pode vir em TO/M³ (campo `um`) — mesma conversão já usada
        // pelas pendências de integração SAP acima (_convertNfPesoToKg).
        const localEntTotal = entradasDestaCentral.filter(e => {
          if (e.material !== mat) return false;
          const d = parseDate(e.dtDescarga || e.dtEmissao);
          return d && d >= dtIni && d <= dtFim;
        }).reduce((sum, e) => sum + _invSafeCall('_convertNfPesoToKg', 0, e.peso, e.um, e.material), 0);
        const localSaiTotal = saidasDestaCentral.filter(s => {
          if (s.material !== mat) return false;
          const d = parseDate(s.dtEmissao);
          return d && d >= dtIni && d <= dtFim;
        }).reduce((sum, s) => sum + _invSafeCall('_convertNfPesoToKg', 0, s.peso, s.um, s.material), 0);

        // Custo médio: Custos SAP (central + Cód SAP + mês calendário do
        // Inventário), cascateando pra meses anteriores quando o mês não
        // tem registro (getCustoMedioCustosSap, normalize.js — ausência
        // geralmente só significa que não houve movimentação naquele mês).
        // 'sem_codigo': material sem Cód SAP cadastrado. 'ausente': tem Cód
        // SAP, mas não achou custo em NENHUM mês anterior — ambos ficam
        // visíveis como badge (invRenderTabela). custoMedioMesesAtras > 0
        // avisa que o valor veio de um mês anterior ao pedido (badge à
        // parte, não junto de 'ausente' — aqui HÁ valor).
        let custoMedio = 0;
        let custoMedioFonte = 'sem_codigo';
        let custoMedioMesesAtras = 0;
        if (codSap) {
          const _custo = getCustoMedioCustosSap(central, codSap, selYear, selMonth + 1, _custosSapIdx);
          if (_custo) { custoMedio = _custo.valor; custoMedioFonte = 'custos_sap'; custoMedioMesesAtras = _custo.mesesAtras; }
          else { custoMedioFonte = 'ausente'; }
        }

        // ── Divergências: possíveis causas da variação, agrupadas em 4
        // categorias (Registros manuais / Duplicidade / Pendência de
        // integração SAP / Ocorrência operacional aberta). Ver botão ao
        // lado do nome do Material em invRenderTabela e o modal em
        // invAbrirDivergencias mais abaixo. Sempre a partir dos registros
        // REAIS (iniRes/fimRes/sapArr) — nunca dos sintéticos de pendentes.
        const iniRecs = iniRes ? (iniRes.records || []) : [];
        const fimRecs = (fimRes && !fimRes.missing) ? (fimRes.records || []) : [];
        const entRecs = sapArr.filter(r => num(r.peso) > 0);
        const saiRecs = sapArr.filter(r => num(r.peso) < 0);

        const manualIni = iniRecs.some(r => r.fonte === 'manual');
        const manualFim = fimRecs.some(r => r.fonte === 'manual');
        const manualEnt = entRecs.some(r => r.fonte === 'manual');
        const manualSai = saiRecs.some(r => r.fonte === 'manual');

        const dupIni = iniRecs.some(r => lancDupKeys.has(_invSafeCall('getLancamentoRecordKey', '', r)));
        const dupFim = fimRecs.some(r => lancDupKeys.has(_invSafeCall('getLancamentoRecordKey', '', r)));
        const sapDupRecs = sapArr.filter(r => sapDupInfo.real.has(_invSafeCall('getSapRecordKey', '', r)));

        // Ocorrências: campo Material hoje é salvo só como o ALIAS (31/07)
        // — antes vinha "ALIAS: ORIGEM" (formulário em ocorrencias.js).
        // split(':')[0] extrai o ALIAS nos dois formatos: sem ":" (padrão
        // atual) devolve a string inteira, que já É o alias; com ":"
        // (registros antigos) corta antes dele — pra comparar com `mat`,
        // que já é o alias resolvido da linha. Na pior hipótese só deixa
        // de casar (falso negativo), nunca casa errado.
        const ocsMat = ocsCentral.filter(o => {
          const aliasOc = String(o.material || '').split(':')[0].trim();
          return aliasOc === mat;
        });

        const divCatManual = manualIni || manualFim || manualEnt || manualSai;
        const divCatDup     = dupIni || dupFim || sapDupRecs.length > 0;
        const divCatPend    = nfPendMat.length > 0 || osPendMat.length > 0;
        const divCatOc      = ocsMat.length > 0;
        const divCount = [divCatManual, divCatDup, divCatPend, divCatOc].filter(Boolean).length;

        const divergencias = {
          manualIni, manualFim, manualEnt, manualSai,
          dupIni, dupFim, sapDupRecs,
          nfPendentes: nfPendMat, osPendentes: osPendMat,
          ocorrencias: ocsMat,
        };

        rowMap.set(k, {
          k, mesKey, central, material: mat, codSap, categoria, semCadastro: false, regional,
          estoqueIni, estoqueIniMissing, estoqueIniLastKnown,
          entradasKg, saidasKg,
          estoqueFimReal, estoqueFimMissing, estoqueFimLastKnown,
          estoqueFimFallback, estoqueFimEsperado, estoqueFimUsadoLabel,
          pendEntAplicado, pendSaiAplicado,
          custoMedio, custoMedioFonte, custoMedioMesesAtras, entEntries, saiEntries, localEntTotal, localSaiTotal, divergencias, divCount,
          sapFechExcluidos: sapFechExcluidosByMat.get(mat) || []
        });
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
          k, mesKey, central, material: matOriginal, codSap: '', categoria: 'Sem cadastro', semCadastro: true, regional,
          estoqueIni: 0, estoqueIniMissing: true, estoqueIniLastKnown: null,
          entradasKg: 0, saidasKg: 0,
          estoqueFimReal: 0, estoqueFimMissing: true, estoqueFimLastKnown: null,
          estoqueFimFallback: false, estoqueFimEsperado: null, estoqueFimUsadoLabel: null,
          pendEntAplicado: false, pendSaiAplicado: false,
          custoMedio: 0, custoMedioFonte: 'sem_codigo', entEntries: [], saiEntries: [], divergencias: null, divCount: 0,
          sapFechExcluidos: []
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
      // Custo médio SAP: valor salvo na justificativa (manual ou auto
      // confirmado) se existir E for > 0; senão cai pro automático do
      // Custos SAP (row.custoMedio) — é isso que faz a coluna já nascer
      // preenchida mesmo antes de qualquer justificativa ser aberta/salva
      // (decisão do Hugo, 05/08: padronizar o custo médio do sistema todo
      // via Custos SAP). O ">0" é essencial: uma justificativa salva
      // ANTES de existir custo cadastrado (campo destravado e vazio na
      // hora do Salvar) grava custoMedioSap=0 — sem essa checagem, esse 0
      // "gruda" na linha pra sempre, escondendo o valor automático mesmo
      // depois do Custos SAP ser cadastrado (bug real: linha ficava
      // AUSENTE na tabela enquanto o modal de justificativa já achava o
      // custo certo, porque o modal usa custoMedioAuto/row.custoMedio pro
      // texto, mas o campo em si usa este custoMedioSap travado em 0).
      const custoMedioSap = (just.custoMedioSap !== undefined && just.custoMedioSap !== null && just.custoMedioSap !== '' && parseFloat(just.custoMedioSap) > 0)
        ? parseFloat(just.custoMedioSap)
        : row.custoMedio;
      const custo    = varAdj * custoMedioSap;   // Custo Just. (varAdj × custo médio — mesma fonte de Custo Médio/Custo SAP)
      const custoSap = varKg  * custoMedioSap;   // Custo SAP (varKg bruto × custo médio)
      invRows.push({ ...row, estTeor, varKg, varPct, saldoJust, varAdj, custo, custoMedioSap, custoSap });
    });

    invRows.sort((a,b) => Math.abs(b.custoSap) - Math.abs(a.custoSap));

    invPopulateMicroFilterOptions();

    document.getElementById('inv-empty-state').style.display = 'none';
    document.getElementById('inv-content').style.display = '';

    invFiltrar();
    invAtualizarKpis();
    invAtualizarAlertas();
    _invSyncConsiderarPendentesBtn();
    toast('Inventário de ' + MESES_NOME[selMonth] + '/' + selYear + ' gerado: ' + invRows.length + ' itens.', 'success');
  }

  // Wrapper público de invGerar() — mostra o overlay de loading global
  // ANTES de rodar o cálculo pesado (_invGerarCore, que pode envolver
  // centenas/milhares de registros) e garante que ele feche ao final,
  // mesmo em caso de retorno antecipado (ex.: "sistema não iniciado",
  // "nenhum dado encontrado") ou erro — por isso o try/finally.
  // O requestAnimationFrame + setTimeout(0) dá tempo do navegador pintar o
  // overlay na tela ANTES do cálculo síncrono começar a travar a thread
  // principal — mesmo padrão já usado em rodarAnalitico (analitico.js) e
  // no boot (dashboard.js).
  window.invGerar = function() {
    if (typeof showLoadingOverlay === 'function') {
      showLoadingOverlay('Atualizando Inventário', 'Calculando fechamento do mês selecionado...');
    }
    // Esconde qualquer checklist de etapas deixada por um overlay anterior
    // (boot ou "Analisar" usam loadingShowSteps — o container não é limpo
    // sozinho entre um uso e outro). O Inventário usa o overlay simples,
    // sem lista de etapas, só o spinner + barra indeterminada.
    if (typeof loadingHideSteps === 'function') loadingHideSteps();
    requestAnimationFrame(() => setTimeout(() => {
      try {
        _invGerarCore();
      } finally {
        if (typeof hideLoadingOverlay === 'function') hideLoadingOverlay('Inventário atualizado');
      }
    }, 0));
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
    if (!_invMatchesMargem(r)) return false;
    if (_invFilter.ausencia === 'ini' && !r.estoqueIniMissing) return false;
    if (_invFilter.ausencia === 'fim' && !r.estoqueFimMissing) return false;
    if (_invFilter.ausencia === 'custo' && !_invCustoAusente(r)) return false;
    if (_invFilter.ausencia === 'sem' && (r.estoqueIniMissing || r.estoqueFimMissing || _invCustoAusente(r))) return false;
    return true;
  }

  // Filtro "Margem" — faixa numérica (De/Até, em kg) sobre r.varKg (coluna
  // Variação). null em qualquer lado = sem limite naquele lado. Substitui
  // o antigo toggle "Ocultar Variação 0" (ver invApplyMargem/invClearMargem).
  function _invMatchesMargem(r) {
    const { margemMin, margemMax } = _invFilter;
    if (margemMin !== null && r.varKg < margemMin) return false;
    if (margemMax !== null && r.varKg > margemMax) return false;
    return true;
  }

  // "Sem variação relevante" — usado pelo selo de alerta da tabela (ver
  // alertBadge em invRenderTabela) e pelo resumo de progresso
  // (_invAtualizarProgresso), pra não contar como "pendente"/"relevante"
  // linha cuja variação é só ruído. Arredonda pra 2 casas decimais (mesma
  // precisão exibida na coluna Variação) antes de comparar, então qualquer
  // linha cuja variação apareça na tela como 0,01 kg ou menos — sobra
  // (positiva) ou desfalque (negativa) — conta como "sem variação". Sem o
  // arredondamento, ruído de ponto flutuante (ex.: 0.009999999999998 vs
  // 0.010000000000002) fazia valores que pareciam idênticos na tela se
  // comportar de forma inconsistente.
  function _invVarIrrelevante(varKg) {
    return Math.round(Math.abs(varKg) * 100) / 100 <= 0.01;
  }

  // Filtro "Justificativa" — compara o estado PURO do botão Justificar da
  // linha (_invEstadoDaLinha, os mesmos 4 estados usados na tabela) contra
  // o estado selecionado no dropdown. Ao contrário do antigo _invIsPendente,
  // NÃO leva em conta se a variação é relevante ou não — quem quiser ver só
  // linhas com variação pode combinar com o toggle "Ocultar Variação 0".
  function _invMatchesJustificativa(r) {
    const state = _invFilter.justificativa;
    if (!state) return true;
    return _invEstadoDaLinha(invJustificativas[r.k] || {}) === state;
  }

  // Existe algo salvo pra excluir? Usa "qualquer campo preenchido" (não
  // hasJust/estadoJust, que exige os 4 campos obrigatórios) — cobre também
  // justificativas parciais deixadas por uma importação de CSV que só
  // trouxe alguns campos preenchidos. Controla se o botão de excluir
  // (ao lado do botão Justificar/Justificado/Ajustado) fica habilitado.
  function _invTemJustSalva(j) {
    return !!(j && (j.op || j.fiscal || j.saldo || j.custoMedioSap || j.documentoSap));
  }

  // 4 estados (compartilhado entre invRenderTabela e o resumo de progresso
  // em invAtualizarKpis):
  //   "justificar"  — nada preenchido (_invTemJustSalva falso)
  //   "pendente"    — algo preenchido, mas SEM Operacional+Fiscal
  //   "justificado" — Operacional+Fiscal preenchidos, falta o restante
  //                   (Saldo, Custo Médio SAP e/ou Documento SAP)
  //   "ajustado"    — tudo preenchido, incluindo Custo Médio SAP e
  //                   Documento SAP
  function _invEstadoDaLinha(j) {
    if (!_invTemJustSalva(j)) return 'justificar';
    const temNarrativa = !!(j && j.op && j.fiscal);
    if (!temNarrativa) return 'pendente';
    const temTudo = !!(j.saldo && j.custoMedioSap && j.documentoSap && String(j.documentoSap).trim() !== '');
    return temTudo ? 'ajustado' : 'justificado';
  }

  // ── Filtrar ──────────────────────────────────────────────
  window.invFiltrar = function() {
    invFiltered = invRows.filter(r => {
      if (!_invMatchesBaseFilters(r)) return false;
      if (!_invMatchesJustificativa(r)) return false;
      if (_invFilter.onlyDivergencias === 'com' && !(r.divCount > 0)) return false;
      if (_invFilter.onlyDivergencias === 'sem' && !(r.divCount === 0)) return false;
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

    // Poda a seleção em lote: remove chaves que ficaram fora do filtro
    // atual (ex.: usuário selecionou linhas, depois trocou o filtro de
    // Regional/Central/Categoria) — sem isso, o contador "N selecionadas"
    // e o "Justificar em lote" continuavam considerando linhas que não
    // estão mais visíveis na tabela.
    if (_invSelected.size) {
      const visiveis = new Set(invFiltered.map(r => r.k));
      let mudou = false;
      _invSelected.forEach(k => { if (!visiveis.has(k)) { _invSelected.delete(k); mudou = true; } });
      if (mudou) _invSyncBatchBar();
    }

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
    const _num       = h ? h.num : (v) => parseFloat(v) || 0;

    tbody.innerHTML = invFiltered.map(r => {
      const j = just[r.k] || {};
      // 3 estados: "justificar" (nada preenchido) → "justificado" (os 4
      // campos obrigatórios preenchidos, Documento SAP ainda não) →
      // "ajustado" (tudo preenchido, incluindo Documento SAP).
      const estadoJust = _invEstadoDaLinha(j);
      // hasJust agora significa "tem a narrativa completa" (Operacional+
      // Fiscal preenchidos) — ou seja, estadoJust é 'justificado' ou
      // 'ajustado'. Uma linha "pendente" (algo preenchido mas sem a
      // narrativa) ainda conta como SEM justificativa pra esse efeito
      // (badge de alerta, filtro Só Pendentes etc.).
      const hasJust = estadoJust === 'justificado' || estadoJust === 'ajustado';
      const rowClass = estadoJust === 'ajustado' ? 'inv-row-ajustado'
        : estadoJust === 'justificado' ? 'inv-row-justificado'
        : estadoJust === 'pendente' ? 'inv-row-pendente'
        : '';
      // Habilita o botão de excluir mesmo com justificativa PARCIAL (ex.:
      // só op+fiscal preenchidos vindo de importação de CSV) — critério
      // mais abrangente que hasJust, que só considera completa.
      const temJustSalva = _invTemJustSalva(j);
      const alertBadge = (!hasJust && !_invVarIrrelevante(r.varKg))
        ? '<span style="display:inline-block;width:6px;height:6px;background:var(--amber);border-radius:50%;margin-right:5px;vertical-align:middle;flex-shrink:0" title="Sem justificativa"></span>'
        : '';

      // ── Badge de Divergências: possíveis causas da variação (registros
      // manuais, duplicidade, pendência de integração SAP, ocorrência
      // operacional aberta). Só aparece quando há pelo menos 1 achado;
      // clique abre invAbrirDivergencias com o detalhe categorizado. ──
      const divBadge = r.divCount > 0
        ? `<button type="button" class="inv-div-badge" onclick="event.stopPropagation(); invAbrirDivergencias('${r.k}')" title="${r.divCount} possível${r.divCount === 1 ? '' : 'is'} causa${r.divCount === 1 ? '' : 's'} da variação — clique para ver detalhes">
             <i class="ti ti-list-search"></i>${r.divCount}
           </button>`
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

      // ── Entradas / Saídas: bdm-trigger igual ao analítico. Selo "pendente"
      // aparece só quando o toggle "Considerar NFs/OS pendentes" está ligado
      // E este material teve NF (Entradas) e/ou OS (Saídas) pendente
      // efetivamente somada ao valor — deixa explícito o que foi afetado. ──
      const pendBadge = (label) => `<span class="absent-badge" style="background:var(--accent-dim,rgba(99,102,241,.15));color:var(--accent);border-color:var(--accent);margin-left:5px" title="Inclui volume de ${label} pendente de integração SAP (toggle 'Considerar NFs/OS pendentes' ligado)">pendente</span>`;
      const _rowFechExcluidosEnt = (r.sapFechExcluidos || []).filter(x => _num(x.peso) > 0);
      const _rowFechExcluidosSai = (r.sapFechExcluidos || []).filter(x => _num(x.peso) < 0);
      const entCell = (_bdm
        ? _bdm(r.entEntries || [], r.entradasKg, 'var(--green)', 'Entradas', null, r.material, r.central, _rowFechExcluidosEnt, r.localEntTotal ?? null)
        : `<span class="td-mono" style="color:var(--green);font-weight:600">${_fmtKg(r.entradasKg)}</span>`) + (r.pendEntAplicado ? pendBadge('NF') : '');
      const saiCell = (_bdm
        ? _bdm(r.saiEntries || [], r.saidasKg, 'var(--red)', 'Saídas', null, r.material, r.central, _rowFechExcluidosSai, r.localSaiTotal ?? null)
        : `<span class="td-mono" style="color:var(--red);font-weight:600">${_fmtKg(r.saidasKg)}</span>`) + (r.pendSaiAplicado ? pendBadge('OS') : '');

      // ── Est. Final: teal igual ao analítico. 3 estados possíveis:
      //   • normal — achou lançamento exatamente no dia de fechamento esperado.
      //   • "retroativo" (âmbar) — não achou no dia esperado, mas achou em um
      //     dia ANTERIOR dentro do próprio período (fallback da Visão Micro).
      //     Fica bem explícito, de propósito, que o saldo NÃO é do dia de
      //     fechamento — o analista precisa cobrar/corrigir o lançamento
      //     daquele dia, não tratar isso como um Est. Final normal.
      //   • AUSENTE — nenhum lançamento em nenhum dia do período. ──────────
      const finTooltip = r.estoqueFimMissing
        ? (r.estoqueFimLastKnown
            ? `AUSENTE — último lançamento encontrado em ${r.estoqueFimLastKnown.dtLabel} (${_fmtKg(r.estoqueFimLastKnown.value)})`
            : 'AUSENTE — nenhum lançamento encontrado no período ou anterior')
        : (r.estoqueFimFallback
            ? `RETROATIVO — dia de fechamento esperado (${r.estoqueFimEsperado || '—'}) não tem lançamento. Valor usado é de ${r.estoqueFimUsadoLabel || 'um dia anterior'} dentro do período. Cobre/corrija o lançamento de ${r.estoqueFimEsperado || 'fechamento'}.`
            : '');
      const finBadge = r.estoqueFimFallback
        ? ` <span class="absent-badge" style="background:var(--amber-bg);color:var(--amber);border-color:var(--amber-border)" title="${_escape(finTooltip)}">retroativo</span>`
        : '';
      const finCell = r.estoqueFimMissing
        ? `<span class="td-mono" style="color:var(--text3);font-style:italic" title="${_escape(finTooltip)}">—</span>`
        : `<span class="td-mono" style="color:${r.estoqueFimFallback ? 'var(--amber)' : 'var(--teal)'}" title="${_escape(finTooltip)}">${_fmtKg(r.estoqueFimReal)}</span>${finBadge}`;

      // ── Est. Teórico: purple igual ao analítico ────────────
      const teorCell = `<span class="td-mono" style="color:var(--purple)">${_fmtKg(r.estTeor)}</span>`;

      // ── Variação (kg): diff-pos/neg/zero + varSymbol ───────
      const dCls  = _varClass(r.varKg);
      const varCell = Math.abs(r.varKg) < 0.005
        ? `<span class="td-mono diff-zero">${_varSymbol(0)} ${_fmtKg(0)}</span>`
        : `<span class="td-mono ${dCls}" style="white-space:nowrap">${_varSymbol(r.varKg)} ${_fmtKg(Math.abs(r.varKg))}</span>`;

      // ── Var. Just. (kg): só mostra valor quando há justificativa
      // completa (hasJust) — sem isso, varAdj é sempre igual a varKg (o
      // saldo default é 0), o que faria a coluna repetir a Variação bruta
      // e parecer que já foi justificado sem ter sido. ──────────
      const dClsAdj = _varClass(r.varAdj);
      const varAdjCell = !hasJust
        ? `<span style="color:var(--text3);font-size:11px">—</span>`
        : Math.abs(r.varAdj) < 0.005
          ? `<span class="td-mono diff-zero">${_varSymbol(0)} ${_fmtKg(0)}</span>`
          : `<span class="td-mono ${dClsAdj}" style="white-space:nowrap">${_varSymbol(r.varAdj)} ${_fmtKg(Math.abs(r.varAdj))}</span>`;

      // ── Badge de custo ausente/sem código (Custos SAP) — mesmo padrão da
      // Visão Micro (analitico.js): SEM CÓD SAP quando o material não tem
      // Cód SAP cadastrado, AUSENTE quando tem código mas não achou custo
      // em Custos SAP pro central/mês. Reaproveitado nas 3 colunas de custo.
      const _custoAusenteBadge = r.custoMedioFonte === 'sem_codigo'
        ? `<span class="absent-badge" style="background:var(--bg4);color:var(--text3);border-color:var(--border2)" title="Material sem Cód SAP cadastrado — não é possível buscar o custo em Custos SAP">SEM CÓD SAP</span>`
        : `<span class="absent-badge" title="Nenhum custo cadastrado em Custos SAP para ${_escape(r.central)} / Cód SAP ${_escape(r.codSap)} / ${r.mesKey}">AUSENTE</span>`;

      // ── Aviso de custo vindo de mês anterior (cascata em
      // getCustoMedioCustosSap, normalize.js) — só enquanto o valor exibido
      // for o AUTOMÁTICO (sem override manual na justificativa): se o
      // usuário sobrescreveu, o número já não vem do cadastro, então não
      // há "mês de origem" pra avisar. 1 mês atrás = aviso leve (âmbar,
      // mesma cor padrão do .absent-badge); 2+ meses = alerta (vermelho).
      const _custoSobrescrito = j.custoMedioSap !== undefined && j.custoMedioSap !== null && j.custoMedioSap !== '' && parseFloat(j.custoMedioSap) > 0;
      const _custoFallbackBadge = (!_custoSobrescrito && r.custoMedioMesesAtras > 0) ? (() => {
        const [_selY, _selM] = String(r.mesKey).split('-').map(Number);
        const _mesRefDate = new Date(_selY, (_selM - 1) - r.custoMedioMesesAtras, 1);
        const _mesRef = `${String(_mesRefDate.getMonth() + 1).padStart(2, '0')}/${_mesRefDate.getFullYear()}`;
        return r.custoMedioMesesAtras === 1
          ? `<span class="absent-badge" style="margin-left:4px" title="Sem cadastro em Custos SAP para ${r.mesKey} — usando o custo de ${_mesRef} (mês anterior)">MÊS ANT.</span>`
          : `<span class="absent-badge" style="margin-left:4px;background:var(--red-bg);color:var(--red);border-color:var(--red-border)" title="Sem cadastro em Custos SAP há ${r.custoMedioMesesAtras} meses — usando o custo de ${_mesRef}">DESATUALIZADO</span>`;
      })() : '';

      // ── Custo SAP (R$): variação BRUTA × custo médio (Custos SAP, auto ou sobrescrito) ──
      const _custoSapVal = r.custoMedioSap > 0 ? r.custoSap : null;
      const _custoSapCls = _custoSapVal !== null ? _varClass(_custoSapVal) : '';
      const custoSapCell = _custoSapVal !== null
        ? `<span class="td-mono ${_custoSapCls}" style="font-size:11.5px;white-space:nowrap">${_varSymbol(_custoSapVal)} ${_money(Math.abs(_custoSapVal))}</span>${_custoFallbackBadge}`
        : _custoAusenteBadge;

      // ── Custo Just. (R$): variação AJUSTADA × mesmo custo médio — só
      // mostra valor quando há justificativa completa (hasJust), mesmo
      // motivo do Var. Just. acima. ──────────────────────────
      const _custoJustVal = (hasJust && r.custoMedioSap > 0) ? r.custo : null;
      const _custoJustCls = _custoJustVal !== null ? _varClass(_custoJustVal) : '';
      const custoJustCell = _custoJustVal !== null
        ? `<span class="td-mono ${_custoJustCls}" style="font-size:11.5px;white-space:nowrap">${_varSymbol(_custoJustVal)} ${_money(Math.abs(_custoJustVal))}</span>${_custoFallbackBadge}`
        : (hasJust ? _custoAusenteBadge : `<span style="color:var(--text3);font-size:11px">—</span>`);

      // ── Custo Médio (R$/kg): Custos SAP (central+Cód SAP+mês), auto — ou sobrescrito pelo usuário no modal de justificativa ──
      const custoMedCell = r.custoMedioSap > 0
        ? `<span class="td-mono" style="color:var(--text2);font-size:11.5px">${_money(r.custoMedioSap)}<span style="font-size:9.5px;opacity:.6">/kg</span></span>${_custoFallbackBadge}`
        : _custoAusenteBadge;

      // ── Saldo justificado ──────────────────────────────────
      const saldoCell = j.saldo
        ? `<span class="td-mono" style="color:var(--text2)">${_fmtKg(parseFloat(j.saldo))}</span>`
        : '<span style="color:var(--text3);font-size:11px">—</span>';

      const selCell = r.semCadastro
        ? '<td class="inv-select-col"></td>'
        : `<td class="inv-select-col"><input type="checkbox" onchange="invToggleRowSelect('${r.k}', this.checked)" ${_invSelected.has(r.k) ? 'checked' : ''}></td>`;

      return `<tr class="${rowClass}">
        ${selCell}
        <td style="font-size:11px;color:var(--text2);white-space:nowrap">${r.regional}</td>
        <td style="font-family:var(--mono);font-size:11px;font-weight:600;white-space:nowrap">${r.central}</td>
        <td style="font-weight:600;max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${_escape(r.material)}">${alertBadge}${divBadge}${_escape(r.material)}</td>
        <td class="td-mono" style="white-space:nowrap">${r.codSap ? _escape(r.codSap) : '<span style="color:var(--text3)">—</span>'}</td>
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
        <td class="inv-col-adjust inv-col-adjust-start" style="text-align:right;white-space:nowrap">${custoMedCell}</td>
        <td class="inv-col-adjust" style="text-align:right;white-space:nowrap">${custoSapCell}</td>
        <td class="inv-col-adjust" style="text-align:right;white-space:nowrap">${saldoCell}</td>
        <td class="inv-col-adjust" style="text-align:right;white-space:nowrap">${varAdjCell}</td>
        <td class="inv-col-adjust" style="text-align:right;white-space:nowrap">${custoJustCell}</td>
        <td class="inv-col-adjust" style="text-align:center">
          <div style="display:inline-flex;align-items:center;gap:6px">
            <button onclick="invAbrirJust('${r.k}')" style="background:${_INV_ESTADO_STYLE[estadoJust].bg};border:1px solid ${_INV_ESTADO_STYLE[estadoJust].border};color:${_INV_ESTADO_STYLE[estadoJust].color};border-radius:6px;padding:4px 10px;font-size:10px;cursor:pointer;white-space:nowrap;font-family:var(--font);transition:all .13s">
              <i class="ti ${_INV_ESTADO_STYLE[estadoJust].icon}" style="font-size:10px"></i> ${_INV_ESTADO_STYLE[estadoJust].label}
            </button>
            <button type="button" ${temJustSalva ? `onclick="invExcluirJust('${r.k}')"` : 'disabled'} title="${temJustSalva ? 'Excluir justificativa' : 'Nenhuma justificativa para excluir'}" style="background:${temJustSalva ? 'var(--red-bg)' : 'var(--bg4)'};border:1px solid ${temJustSalva ? 'var(--red-border)' : 'var(--border2)'};color:${temJustSalva ? 'var(--red)' : 'var(--text3)'};border-radius:6px;padding:4px 7px;font-size:10px;cursor:${temJustSalva ? 'pointer' : 'default'};opacity:${temJustSalva ? '1' : '.45'};display:inline-flex;align-items:center;justify-content:center;font-family:var(--font);transition:all .13s">
              <i class="ti ti-trash" style="font-size:11px"></i>
            </button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  // ── KPIs ─────────────────────────────────────────────────
  function invAtualizarKpis() {
    invAtualizarSemCadastro();
    _invAtualizarPeriodoFechado();

    // Usa invFiltered (mesmo recorte exibido na tabela) — os cards REAGEM
    // a todos os filtros ativos (Regional/Central/Categoria/Material/Margem/
    // Ausência/Justificativa/Divergências), mantendo os KPIs sempre
    // coerentes com o que o analista está vendo na tabela abaixo.
    // Se houver linhas SELECIONADAS (checkboxes do modo seleção), os KPIs
    // passam a refletir SÓ a seleção — mais específico que o filtro, então
    // tem prioridade. Sem seleção, volta pro recorte filtrado normal.
    // Materiais SEM cadastro são excluídos de TODAS as somas — decisão
    // confirmada: bloqueados da análise até serem cadastrados, contados
    // à parte só no indicador de pendência (invAtualizarSemCadastro).
    const usandoSelecao = _invSelected.size > 0;
    const invRowsBase = usandoSelecao ? invFiltered.filter(r => _invSelected.has(r.k)) : invFiltered;
    const invRowsCadastrados = invRowsBase.filter(r => !r.semCadastro);

    const hintEl = document.getElementById('inv-kpi-selecao-hint');
    if (hintEl) {
      const n = _invSelected.size;
      hintEl.textContent = usandoSelecao ? ` · com base em ${n} linha${n === 1 ? '' : 's'} selecionada${n === 1 ? '' : 's'}` : '';
    }
    const totalIni = invRowsCadastrados.reduce((s,r)=>s+r.estoqueIni,0);
    const totalEnt = invRowsCadastrados.reduce((s,r)=>s+r.entradasKg,0);
    const totalSai = invRowsCadastrados.reduce((s,r)=>s+r.saidasKg,0);
    const totalFin = invRowsCadastrados.reduce((s,r)=>s+r.estoqueFimReal,0);

    // Variação BRUTA: varKg sem desconto de justificativas
    const totalVarBruto = invRowsCadastrados.reduce((s,r)=>s+r.varKg,0);
    // Variação AJUSTADA: varAdj após descontar saldo justificado
    const totalVarAdj   = invRowsCadastrados.reduce((s,r)=>s+r.varAdj,0);

    // Custo BRUTO: mesma fonte da coluna Custo SAP (Custos SAP, central+Cód
    // SAP+mês) — varKg × custo médio efetivo (auto ou sobrescrito)
    const totalCstBruto = invRowsCadastrados.reduce((s,r)=>s+r.custoSap,0);
    // Custo AJUSTADO: varAdj × mesmo custo médio (coluna Custo Just.)
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

    // Badge "retroativo" — mesma estrutura visual do badge de ausência, mas
    // pra Est. Final que veio do fallback da Visão Micro (achou lançamento
    // em dia ANTERIOR ao de fechamento esperado, dentro do período). Cada
    // linha do detalhe já mostra a data usada vs a esperada, pra o analista
    // saber exatamente o que cobrar/corrigir.
    const _invFallbackBadge = (containerId, list) => {
      const el = document.getElementById(containerId);
      if (!el) return;
      if (!list.length) { el.innerHTML = ''; return; }
      const MAX = 5;
      const shown = list.slice(0, MAX).map(s => `<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px;color:var(--text2);font-size:10px;font-family:var(--mono)">${s}</div>`).join('');
      const more  = list.length > MAX ? `<div style="color:var(--text3);font-size:9.5px;font-family:var(--mono)">+ ${list.length - MAX} mais</div>` : '';
      el.innerHTML = `<details style="margin-top:5px">
        <summary style="cursor:pointer;list-style:none;display:inline-flex;align-items:center;gap:4px;font-family:var(--mono);font-size:9px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--amber);padding:2px 7px;background:var(--amber-bg);border:1px solid var(--amber-border);border-radius:4px;user-select:none">
          <i class="ti ti-history" style="font-size:10px"></i> ${list.length} retroativo${list.length === 1 ? '' : 's'}
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

    // Badge "retroativo" — Est. Final que veio do fallback (recuou dentro do
    // período porque não achou lançamento no dia de fechamento esperado).
    // Deixado bem visível de propósito: são linhas que precisam de
    // lançamento cobrado/corrigido, não é um Est. Final "normal". Some com
    // o badge de ausência se ambos estiverem vazios (details HTML separado).
    const fallbackFimRows = invRowsCadastrados
      .filter(r => r.estoqueFimFallback)
      .map(r => `${r.central} · ${r.material} (usado: ${r.estoqueFimUsadoLabel || '—'}, esperado: ${r.estoqueFimEsperado || '—'})`);
    _invFallbackBadge('inv-kpi-fin-fallback', fallbackFimRows);

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

    _invAtualizarProgresso();
  }

  // ── Resumo de progresso do fechamento (Ajustadas · Justificadas ·
  // Pendentes) — mesmo recorte exibido na tabela (invFiltered, já com
  // TODOS os filtros ativos: Regional/Central/Categoria/Material/Margem/
  // Ausência/Justificativa/Divergências), mantendo a barra sempre coerente
  // com o que o analista está vendo na tabela abaixo. Se houver linhas
  // SELECIONADAS (checkboxes do modo seleção), passa a considerar SÓ a
  // seleção — mesma prioridade usada nos KPIs acima (invAtualizarKpis).
  // Só considera linhas com variação relevante — quem não tem nada a
  // justificar não entra na conta (senão o "Pendentes" fica inflado com
  // linha que não precisa de ação nenhuma). Materiais sem cadastro também
  // ficam de fora, mesmo critério dos KPIs acima.
  function _invAtualizarProgresso() {
    const baseRows = _invSelected.size > 0 ? invFiltered.filter(r => _invSelected.has(r.k)) : invFiltered;
    const relevantes = baseRows.filter(r => !r.semCadastro && !_invVarIrrelevante(r.varKg));
    let nAjustado = 0, nJustificado = 0, nPendente = 0;
    relevantes.forEach(r => {
      const estado = _invEstadoDaLinha(invJustificativas[r.k] || {});
      if (estado === 'ajustado') nAjustado++;
      else if (estado === 'justificado') nJustificado++;
      else nPendente++;
    });
    const total = relevantes.length;
    const pct = total ? Math.round(((nAjustado + nJustificado) / total) * 100) : 0;

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('inv-progresso-ajustado-v', nAjustado);
    set('inv-progresso-justificado-v', nJustificado);
    set('inv-progresso-pendente-v', nPendente);
    set('inv-progresso-pct', total ? pct + '%' : '—');
    set('inv-progresso-total', total ? `de ${total} com variação` : 'nenhuma linha com variação neste recorte');

    const fillAdj  = document.getElementById('inv-progresso-fill-ajustado');
    const fillJust = document.getElementById('inv-progresso-fill-justificado');
    if (fillAdj)  fillAdj.style.width  = (total ? (nAjustado / total) * 100 : 0) + '%';
    if (fillJust) fillJust.style.width = (total ? (nJustificado / total) * 100 : 0) + '%';
  }

  // ── Alertas pendentes (badge do filtro "Justificativa") ────
  function invAtualizarAlertas() {
    // Conta sob os filtros "base" (Regional/Central/Categoria/Material +
    // toggles de zero/ausência), mas SEM aplicar o próprio filtro
    // "Justificativa" — assim o número no badge não vira sempre igual ao
    // da tabela quando um status já está selecionado; ele mostra quantos
    // itens existem no estado relevante dentro do recorte atual, com
    // filtro ligado ou não. Mesmo raciocínio pro badge "Só Divergências"
    // logo abaixo.
    //   • Com um status específico selecionado (Não Justificados/
    //     Pendentes/Justificados/Ajustados): conta quantas linhas estão
    //     NAQUELE estado.
    //   • Com "Todos" selecionado (ou nenhum filtro ainda aplicado): conta
    //     linhas "Não Justificados" + "Pendentes" — itens que ainda não
    //     têm a narrativa (Operacional+Fiscal) completa, mesmo espírito do
    //     antigo badge "Só Pendentes".
    const justState = _invFilter.justificativa;
    const pendentes = invRows.filter(r => {
      if (!_invMatchesBaseFilters(r)) return false;
      const estado = _invEstadoDaLinha(invJustificativas[r.k] || {});
      return justState ? estado === justState : (estado === 'justificar' || estado === 'pendente');
    });
    const badge = document.getElementById('inv-alertas-count');
    if (badge) {
      badge.textContent = pendentes.length;
      const st = justState && _INV_ESTADO_STYLE[justState];
      badge.style.background = st ? st.color : 'var(--amber)';
    }

    const divBadge = document.getElementById('inv-divergencias-count');
    if (divBadge) {
      const sem = _invFilter.onlyDivergencias === 'sem';
      const count = invRows.filter(r => _invMatchesBaseFilters(r) && (sem ? r.divCount === 0 : r.divCount > 0)).length;
      divBadge.textContent = count;
    }
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

  // Aviso de Fechamento de Período (mês selecionado no Inventário). A
  // garantia de bloqueio é a RLS (periodo_esta_fechado no Supabase); isto
  // é só o aviso visual — ver guarda em _invApplyJustValues abaixo.
  function _invAtualizarPeriodoFechado() {
    const el = document.getElementById('inv-periodo-fech-box');
    if (!el || typeof isPeriodoFechado !== 'function') return;
    const fechado = isPeriodoFechado(invGetSelectedYear(), invGetSelectedMonth() + 1);
    el.innerHTML = fechado
      ? `<button type="button" class="alert-pulse-btn is-red" disabled style="margin-bottom:14px">
          <i class="ti ti-lock"></i>
          Período fechado pelo administrador — ${window.currentUser?.role === 'admin' ? 'você ainda pode editar' : 'edições bloqueadas'}
        </button>`
      : '';
  }

  // Auxiliar mínimo de escape — usa o helper compartilhado se disponível,
  // senão cai no fallback local (mesmo padrão já usado em invRenderTabela).
  function _invEscape(s) {
    const h = window._inv_helpers;
    return h ? h.escapeHtml(s) : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
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
    abrirCadastroMaterialIndividual({ origem: nome, focus: 'alias' });
  };

  // ── Modal de Divergências (possíveis causas da variação) ───────────
  // Aberto pelo badge ao lado do nome do Material (invRenderTabela).
  // Agrupa em 4 categorias — Registros manuais, Duplicidade, Pendência de
  // integração SAP e Ocorrência operacional aberta — todas calculadas em
  // invGerar (campo r.divergencias) a partir de funções já existentes no
  // resto do sistema (nunca detecção nova): getLancamentoDuplicateKeys/
  // getSapDuplicateKeys (ui.js, mesmo critério das páginas de Lançamentos/
  // SAP), calcPendentesIntegracao (ui.js, mesma função dos cards do
  // Analítico) e state.ocorrencias (ocorrencias.js). Modal só de leitura —
  // não persiste nada, não interfere com invJustificativas.
  function _invDivSectionHtml(icon, titulo, linhasHtml) {
    if (!linhasHtml) return '';
    return `
      <div class="micro-section-title"><i class="ti ${icon}"></i> ${titulo}</div>
      <div style="background:var(--bg3);border:1px solid var(--border2);border-radius:8px;padding:9px 12px;margin-bottom:16px;display:flex;flex-direction:column;gap:2px">
        ${linhasHtml}
      </div>`;
  }
  function _invDivLinha(texto) {
    return `<div style="font-size:12px;color:var(--text2);padding:3px 0;line-height:1.5;display:flex;gap:6px"><span style="color:var(--text3);flex-shrink:0">•</span><span>${texto}</span></div>`;
  }

  window._invAbrirOcorrencia = function(id) {
    document.getElementById('alert-modal-inv-div')?.remove();
    if (typeof openOcDetailModal === 'function') openOcDetailModal(id);
    else toast('Módulo de Ocorrências não carregado.', 'error');
  };

  window.invAbrirDivergencias = function(k) {
    const row = invRows.find(r => r.k === k);
    if (!row || !row.divergencias) return;
    const d = row.divergencias;
    document.getElementById('alert-modal-inv-div')?.remove();

    const h = window._inv_helpers;
    const _fmtKg = h ? h.fmtKg : (v) => fmt(v) + ' kg';
    const _num   = h ? h.num   : (v) => Number(v) || 0;

    // ── Registros manuais ──
    const manualLinhas = [];
    if (d.manualIni) manualLinhas.push(_invDivLinha('Est. Inicial é um lançamento manual (não veio de importação).'));
    if (d.manualFim) manualLinhas.push(_invDivLinha('Est. Final é um lançamento manual (não veio de importação).'));
    if (d.manualEnt) manualLinhas.push(_invDivLinha('Parte das Entradas SAP do período foi lançada manualmente.'));
    if (d.manualSai) manualLinhas.push(_invDivLinha('Parte das Saídas SAP do período foi lançada manualmente.'));

    // ── Duplicidade ──
    const dupLinhas = [];
    if (d.dupIni) dupLinhas.push(_invDivLinha('Est. Inicial: mais de um lançamento na mesma central/data/material — o valor exibido é a SOMA de todos eles.'));
    if (d.dupFim) dupLinhas.push(_invDivLinha('Est. Final: mais de um lançamento na mesma central/data/material — o valor exibido é a SOMA de todos eles.'));
    d.sapDupRecs.forEach(r => {
      dupLinhas.push(_invDivLinha(`Integração SAP duplicada — mov. ${_invEscape(r.movimento||'—')}, ref ${_invEscape(r.ref||r.documento||'—')}, ${_fmtKg(_num(r.peso))} em ${_invEscape(r.dtLanc||'—')}.`));
    });

    // ── Pendência de integração SAP ──
    // Peso da NF (state.entradas) NÃO está necessariamente em kg — pode vir
    // em TO/M³ etc., e o fator de conversão depende do MATERIAL (ex.: Areia
    // Natural Fina, Brita). Usa as MESMAS funções já usadas no modal
    // canônico "Pendentes de Integração SAP" (openPendIntegGlobalModal, em
    // ui.js) — _convertNfPesoToKg faz a conversão; _nfNeedsConversionWarning
    // sinaliza quando a unidade é volumétrica mas não há fator conhecido
    // pro material (nesse caso o valor exibido é o BRUTO, na unidade
    // original, com aviso — nunca convertido "no chute").
    const pendLinhas = [];
    d.nfPendentes.forEach(r => {
      const semFator = _invSafeCall('_nfNeedsConversionWarning', false, r.um, r.material);
      const pesoConv = _invSafeCall('_convertNfPesoToKg', Math.abs(_num(r.peso)), r.peso, r.um, r.material);
      const pesoTxt = semFator
        ? `${fmt(pesoConv, 2)} ${_invEscape(String(r.um || 'kg'))} <i class="ti ti-alert-triangle" style="color:var(--amber);font-size:10px" title="Sem fator de conversão cadastrado para ${_invEscape(String(r.um||''))} — valor exibido sem conversão"></i>`
        : `${_fmtKg(pesoConv)}`;
      pendLinhas.push(_invDivLinha(`NF ${_invEscape(String(r.nf||'—'))} — ${pesoTxt}, emitida em ${_invEscape(r.dtEmissao||'—')} (${_invEscape(r.fornecedor||'—')}) — ainda sem movimento SAP correspondente.`));
    });
    // OS (state.saidas) não passa pela mesma conversão — segue o mesmo
    // tratamento do modal canônico (exibe peso bruto + unidade original,
    // sem tentar converter).
    d.osPendentes.forEach(r => {
      pendLinhas.push(_invDivLinha(`OS ${_invEscape(String(r.os||'—'))} — ${fmt(Math.abs(_num(r.peso)), 2)} ${_invEscape(String(r.um || 'kg'))}, emitida em ${_invEscape(r.dtEmissao||'—')} — ainda sem movimento SAP correspondente.`));
    });

    // ── Ocorrências operacionais abertas ──
    const ocLinhas = d.ocorrencias.map(o => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:3px 0">
        <div style="font-size:12px;color:var(--text2);line-height:1.5;min-width:0">
          <span style="color:var(--text3)">•</span> ${_invEscape(o.descricao || 'Sem descrição')}
          <span style="color:var(--text3);font-size:10.5px"> — aberta em ${_invEscape(o.dataAbertura || '—')}</span>
        </div>
        <button class="btn-icon" type="button" title="Ver ocorrência" onclick="_invAbrirOcorrencia('${_invEscape(o.id)}')" style="flex-shrink:0"><i class="ti ti-external-link"></i></button>
      </div>`);

    const corpo = [
      _invDivSectionHtml('ti-pencil', 'Registros manuais', manualLinhas.join('')),
      _invDivSectionHtml('ti-copy', 'Duplicidade', dupLinhas.join('')),
      _invDivSectionHtml('ti-cloud-off', 'Pendência de integração SAP', pendLinhas.join('')),
      _invDivSectionHtml('ti-alert-circle', 'Ocorrência operacional aberta', ocLinhas.join('')),
    ].join('');

    const overlay = document.createElement('div');
    overlay.id = 'alert-modal-inv-div';
    overlay.className = 'alert-modal-overlay';
    const _escInvDiv = (e) => {
      if (!document.body.contains(overlay)) { document.removeEventListener('keydown', _escInvDiv); return; }
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', _escInvDiv); }
    };
    document.addEventListener('keydown', _escInvDiv);
    overlay.innerHTML = `
      <div class="alert-modal-card">
        <div class="alert-modal-header">
          <div>
            <div class="alert-modal-title"><i class="ti ti-list-search"></i> Possíveis causas da variação</div>
            <div class="alert-modal-sub">${_invEscape(row.central)} · ${_invEscape(row.material)} — ${row.divCount} categoria${row.divCount === 1 ? '' : 's'} com achados</div>
          </div>
          <button class="alert-modal-close" onclick="document.getElementById('alert-modal-inv-div').remove()"><i class="ti ti-x"></i></button>
        </div>
        <div class="alert-modal-body">${corpo}</div>
      </div>`;
    document.body.appendChild(overlay);
  };

  // ── Modal de justificativa ───────────────────────────────
  // Navegação Anterior/Próximo: percorre TODA a lista filtrada/ordenada
  // atual da tabela (invFiltered), fixada no momento em que o modal é
  // aberto pela primeira vez — evita que a fila "pule" no meio da revisão
  // por causa de reordenação/recalculo disparado pelo próprio salvamento.
  // Não se restringe mais só a pendentes — os botões devem aparecer
  // sempre, mesmo abrindo uma linha já justificada/ajustada via
  // "Ver/Editar", pra dar pra navegar pela tabela inteira a partir daqui.
  let _invNavQueue = [];
  let _invNavIdx   = -1;

  function _invBuildNavQueue(k) {
    _invNavQueue = invFiltered.map(r => r.k);
    _invNavIdx = _invNavQueue.indexOf(k);
  }

  // Exige os 3 campos preenchidos (operacional, fiscal e saldo) — sem
  // justificativa parcial. Retorna null se válido, ou mensagem de erro.
  // Recalcula o card "Custo Total SAP" ao vivo, sempre que o usuário digita
  // no campo Custo Médio SAP — sem precisar salvar. varKg vem embutido no
  // próprio onclick/oninput (fixo por modal, não muda durante a edição).
  window._invAtualizarCustoSapCard = function(varKg) {
    const el = document.getElementById('inv-j-custo-sap-card');
    if (!el) return;
    const h = window._inv_helpers;
    const _money = h ? h.money : fmtR;
    const custoMedioSap = parseFloat(document.getElementById('inv-j-custo-sap')?.value || 0) || 0;
    const total = custoMedioSap * varKg;
    const cls = total < -0.0001 ? 'diff-neg' : total > 0.0001 ? 'diff-pos' : 'diff-zero';
    const icon = !custoMedioSap ? '' :
      total > 0.0001  ? '<i class="ti ti-trending-up" style="color:var(--amber)"></i>' :
      total < -0.0001 ? '<i class="ti ti-trending-down" style="color:var(--red)"></i>' :
      '<i class="ti ti-minus" style="color:var(--green)"></i>';
    el.className = 'td-mono ' + cls;
    el.innerHTML = `${icon} ${_money(Math.abs(total))}`;
  };

  // ── Trava do campo Custo Médio SAP: nasce travado com o valor automático
  // do Custos SAP (custoMedioAuto); só destrava quando o usuário confirma
  // via checkbox que quer sobrescrever o padrão. Quando não há valor
  // automático (AUSENTE/SEM CÓD SAP — fonte !== 'custos_sap'), nasce livre
  // pra digitação, sem trava (nada a proteger). Reaproveitado pelo modal
  // individual e pelo de lote — só muda o id do campo/oninput.
  function _invCustoSapCampoHtml({ inputId, valor, custoMedioAuto, fonte, oninput }) {
    const h = window._inv_helpers;
    const _money = h ? h.money : fmtR;
    const travavel = fonte === 'custos_sap';
    return `
      <div style="display:flex;gap:6px;align-items:center">
        <input id="${inputId}" type="number" step="0.01" class="oc-input" style="flex:1" placeholder="0,00"
               value="${valor || ''}" data-auto-valor="${custoMedioAuto || ''}"
               ${travavel ? 'disabled' : ''} oninput="${oninput}">
        ${travavel ? `<button type="button" class="btn" id="${inputId}-unlock-btn" title="Alterar o valor padrão do Custos SAP" onclick="_invAbrirDesbloqueioCustoSap('${inputId}')" style="flex-shrink:0;padding:0 10px"><i class="ti ti-lock"></i></button>` : ''}
      </div>
      ${travavel ? `<label id="${inputId}-confirm-wrap" style="display:none;align-items:flex-start;gap:6px;margin-top:7px;font-size:10.5px;color:var(--text2);cursor:pointer;line-height:1.4;background:var(--amber-bg);border:1px solid var(--amber-border);border-radius:6px;padding:7px 9px">
        <input type="checkbox" id="${inputId}-confirm" style="margin-top:2px;flex-shrink:0" onchange="_invConfirmarDesbloqueioCustoSap('${inputId}', this.checked)">
        <span>Confirmo que quero sobrescrever o valor padrão do Custos SAP (${_money(custoMedioAuto)}/kg)</span>
      </label>` : ''}`;
  }

  window._invAbrirDesbloqueioCustoSap = function(inputId) {
    const btn = document.getElementById(`${inputId}-unlock-btn`);
    if (btn) btn.style.display = 'none';
    const wrap = document.getElementById(`${inputId}-confirm-wrap`);
    if (wrap) wrap.style.display = 'flex';
  };

  window._invConfirmarDesbloqueioCustoSap = function(inputId, confirmado) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.disabled = !confirmado;
    if (confirmado) {
      input.focus();
    } else {
      // Desmarcou: descarta a edição, volta a travar com o valor automático
      input.value = input.dataset.autoValor || '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const wrap = document.getElementById(`${inputId}-confirm-wrap`);
      if (wrap) wrap.style.display = 'none';
      const btn = document.getElementById(`${inputId}-unlock-btn`);
      if (btn) btn.style.display = '';
    }
  };

  // Grava { op, fiscal, saldo, custoSap, docSap } no registro k, recalcula
  // os campos derivados da linha (saldoJust/varAdj/custo/custoMedioSap/
  // custoSap) e persiste. Extraído de _invSalvarJustCore pra ser reaproveitado
  // pelo modal individual E pelo modal "Justificar em lote" (invAbrirJustLote)
  // — a única diferença entre os dois é de ONDE os valores são lidos (um
  // formulário fixo vs. uma linha da grade em lote); a gravação/recálculo é
  // exatamente a mesma. custoSap aqui é sempre o que estava no campo Custo
  // Médio SAP no momento do Salvar — auto (Custos SAP) se o campo continuou
  // travado, ou o valor sobrescrito se o usuário desbloqueou.
  function _invApplyJustValues(k, { op, fiscal, saldo, custoSap, docSap }) {
    // Guarda de UX — a garantia de verdade é a RLS (periodo_esta_fechado no
    // Supabase); isto só evita a mutação local + toast tardio de erro.
    if (window.currentUser?.role !== 'admin' && typeof isPeriodoFechado === 'function') {
      const m = /^(\d{4})-(\d{2})\|/.exec(k);
      if (m && isPeriodoFechado(m[1], m[2])) {
        if (typeof toast === 'function') toast('Período fechado pelo administrador — não é possível editar.', 'error');
        return false;
      }
    }
    invJustificativas[k] = { op, fiscal, saldo, custoMedioSap: custoSap, documentoSap: docSap };
    const row = invRows.find(r => r.k === k);
    if (row) {
      const saldoJust = parseFloat(saldo||0)||0;
      row.saldoJust = saldoJust;
      row.varAdj = row.varKg - saldoJust;
      row.custoMedioSap = parseFloat(custoSap||0)||0;
      row.custo    = row.varAdj * row.custoMedioSap; // Custo Just. (varAdj × custo médio)
      row.custoSap = row.varKg  * row.custoMedioSap; // Custo SAP (varKg bruto × custo médio)
      // documentoSap não entra em nenhum cálculo — é só um campo de
      // referência (número do documento de ajuste no SAP), exportado/
      // importado no CSV mas sem coluna própria na tabela.
    }
    invFiltrar();
    invAtualizarKpis();
    invAtualizarAlertas();
    _invSyncJustificativasToState([k]);
    return true;
  }

  // Salva os dados do formulário atual (modal individual) no registro k.
  // Retorna true/false — chamadores usam isso pra decidir se fecham o
  // modal e mostram "salvo com sucesso" (não faz sentido mostrar isso se
  // a guarda de período fechado, em _invApplyJustValues, bloqueou a gravação).
  function _invSalvarJustCore(k) {
    const op         = document.getElementById('inv-j-op')?.value.trim();
    const fiscal     = document.getElementById('inv-j-fiscal')?.value.trim();
    const saldo      = document.getElementById('inv-j-saldo')?.value;
    const custoSap   = document.getElementById('inv-j-custo-sap')?.value;
    const docSap     = document.getElementById('inv-j-doc-sap')?.value;
    return _invApplyJustValues(k, { op, fiscal, saldo, custoSap, docSap });
  }

  window.invAbrirJust = function(k) {
    _invBuildNavQueue(k);
    _invRenderJustModal(k);
  };

  // dir: -1 (Anterior) ou +1 (Próximo). Salva o registro atual (com o que
  // estiver preenchido, completo ou não) antes de avançar.
  window._invNavJust = function(dir) {
    const kAtual = _invNavQueue[_invNavIdx];
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
    const vkCls    = _varClass(row.varKg);
    const cstSapCls = _varClass(row.custoSap);

    const temFila   = _invNavQueue.length > 1;
    const podeAnt   = _invNavIdx > 0;
    const podeProx  = _invNavIdx >= 0 && _invNavIdx < _invNavQueue.length - 1;
    const posicaoBadge = _invNavIdx >= 0
      ? `<span style="font-size:10.5px;font-weight:700;font-family:var(--mono);color:var(--accent);background:var(--accent-dim);border-radius:20px;padding:3px 10px;white-space:nowrap;flex-shrink:0">${_invNavIdx+1} / ${_invNavQueue.length}</span>`
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
            <div style="background:var(--bg3);border:1px solid var(--border2);border-radius:10px;padding:12px 8px;text-align:center">
              <div class="oc-label" style="margin-bottom:7px">Variação (kg)</div>
              <div class="td-mono" style="font-size:10px;color:var(--text3);margin-bottom:4px;white-space:nowrap" title="Est. Final − Est. Teórico = Variação">
                ${row.estoqueFimMissing ? '—' : _fmtKg(row.estoqueFimReal)} − ${_fmtKg(row.estTeor)}
              </div>
              <div class="td-mono ${vkCls}" style="font-size:16px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:5px;white-space:nowrap">
                ${_heroIcon(row.varKg)} ${_fmtKg(Math.abs(row.varKg))}
              </div>
            </div>
            <div style="background:var(--bg3);border:1px solid var(--border2);border-radius:10px;padding:12px 8px;text-align:center">
              <div class="oc-label" style="margin-bottom:7px">Custo Total SAP</div>
              <div class="td-mono ${cstSapCls}" id="inv-j-custo-sap-card" style="font-size:16px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:5px;white-space:nowrap">
                ${row.custoMedioSap ? _heroIcon(row.custoSap) : ''} ${_money(Math.abs(row.custoSap))}
              </div>
            </div>
          </div>
          <div class="oc-form-group">
            <label class="oc-label">Justificativa Operacional <span class="oc-hint">opcional</span></label>
            <textarea id="inv-j-op" class="oc-input oc-textarea" rows="2" placeholder="Ex: falha no medidor da brita, perda por chuva...">${_escape(j.op||'')}</textarea>
          </div>
          <div class="oc-form-group">
            <label class="oc-label">Justificativa Fiscal <span class="oc-hint">opcional — para inspeção</span></label>
            <select id="inv-j-fiscal" class="oc-input">
              <option value="" ${!j.fiscal ? 'selected' : ''} disabled>Selecione uma justificativa fiscal...</option>
              ${_invMontarOptionsFiscal(j.fiscal||'')}
            </select>
          </div>
          <div class="oc-form-group">
            <label class="oc-label">Saldo Justificado (kg) <span class="oc-hint">opcional — parte/total da variação com causa identificada</span></label>
            <div style="display:flex;gap:8px;align-items:stretch">
              <input id="inv-j-saldo" type="number" class="oc-input" placeholder="0" value="${j.saldo||''}" style="flex:1">
              <button type="button" class="btn" style="white-space:nowrap;flex-shrink:0" onclick="document.getElementById('inv-j-saldo').value='${(Math.round(row.varKg*100)/100)}'" title="Preenche com a variação total, já com o sinal de ${row.varKg < 0 ? 'desfalque (negativo)' : 'sobra (positivo)'}">Variação total</button>
            </div>
          </div>
          <div class="oc-form-group">
            <label class="oc-label">Custo Médio SAP (R$/kg) <span class="oc-hint">${row.custoMedioFonte === 'custos_sap' ? 'preenchido automaticamente pelo Custos SAP — clique no cadeado pra sobrescrever' : 'sem custo cadastrado em Custos SAP pra esse central/mês — digite manualmente'}</span></label>
            ${_invCustoSapCampoHtml({ inputId: 'inv-j-custo-sap', valor: row.custoMedioSap, custoMedioAuto: row.custoMedio, fonte: row.custoMedioFonte, oninput: `_invAtualizarCustoSapCard(${row.varKg})` })}
          </div>
          <div class="oc-form-group">
            <label class="oc-label">Documento SAP <span class="oc-hint">nº do documento de ajuste no SAP (opcional, não aparece como coluna na tabela)</span></label>
            <input id="inv-j-doc-sap" type="number" class="oc-input" placeholder="Ex: 4500123456" value="${j.documentoSap||''}">
          </div>
        </div>
        <div class="modal-footer" style="justify-content:space-between">
          <button class="btn" onclick="document.getElementById('inv-modal').remove()">Cancelar</button>
          <div style="display:flex;gap:8px">
            ${temFila ? `<button class="btn" ${podeAnt?'':'disabled style="opacity:.35;cursor:default;pointer-events:none"'} onclick="_invNavJust(-1)" title="Salva e vai para o registro anterior"><i class="ti ti-chevron-left"></i> Anterior</button>` : ''}
            ${temFila ? `<button class="btn" ${podeProx?'':'disabled style="opacity:.35;cursor:default;pointer-events:none"'} onclick="_invNavJust(1)" title="Salva e vai para o próximo registro">Próximo <i class="ti ti-chevron-right"></i></button>` : ''}
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
    if (!_invSalvarJustCore(k)) return; // bloqueado (período fechado) — toast de erro já mostrado, modal continua aberto
    document.getElementById('inv-modal')?.remove();
    toast('Justificativa salva.', 'success');
  };

  // ── Modal "Justificar em lote" ──────────────────────────────
  // Grade tipo planilha: uma linha por item selecionado (checkboxes da
  // tabela, modo seleção). Cada linha tem seu PRÓPRIO botão "Registrar" —
  // grava só aquela linha, na hora, reaproveitando _invApplyJustValues (a
  // mesma gravação do modal individual). Não existe "Salvar tudo": o
  // modal é só uma tela de trabalho, dá pra fechar a qualquer momento sem
  // perder o que já foi registrado. Cada campo preenchido tem um ícone de
  // "replicar" que copia aquele valor específico pras outras linhas
  // selecionadas que AINDA ESTÃO VAZIAS naquele campo — nunca sobrescreve
  // o que o analista já digitou diferente ali (às vezes o motivo se
  // repete entre linhas, às vezes não).
  let _invLoteKeys = [];
  let _invLoteState = {}; // k -> { registrado: bool, snapshot: {op,fiscal,saldo,custoSap,docSap}|null }

  function _invLoteIdx(k) { return _invLoteKeys.indexOf(k); }

  function _invLoteLerValores(k) {
    const idx = _invLoteIdx(k);
    return {
      op:       (document.getElementById(`lote-op-${idx}`)?.value || '').trim(),
      fiscal:   (document.getElementById(`lote-fiscal-${idx}`)?.value || '').trim(),
      saldo:    document.getElementById(`lote-saldo-${idx}`)?.value ?? '',
      custoSap: document.getElementById(`lote-custosap-${idx}`)?.value ?? '',
      docSap:   document.getElementById(`lote-docsap-${idx}`)?.value ?? '',
    };
  }

  // Atualiza só o badge de status + o habilitado/desabilitado do botão
  // Registrar daquela linha — chamado depois de toda edição ou registro.
  // Também atualiza o contador "X de Y registradas" no topo do modal, pra
  // dar orientação de progresso sem precisar rolar a lista toda.
  function _invLoteAtualizarLinhaVisual(k) {
    const idx = _invLoteIdx(k);
    if (idx < 0) return;
    const st = _invLoteState[k] || { registrado: false };
    const podeRegistrar = !st.registrado;
    const btn = document.getElementById(`lote-btn-${idx}`);
    const badge = document.getElementById(`lote-status-${idx}`);
    if (btn) btn.disabled = !podeRegistrar;
    // 3 estados: Não registrada (cinza) → Pendente (âmbar — já registrada,
    // mas SEM Operacional e Fiscal, já que esses dois deixaram de ser
    // obrigatórios pra registrar) → Registrada (verde — registrada e com
    // as duas justificativas narrativas preenchidas).
    const faltaOpEFiscal = st.registrado && !(st.snapshot?.op && st.snapshot?.fiscal);
    if (badge) {
      badge.innerHTML = !st.registrado
        ? '<span style="color:var(--text3);font-size:11px;white-space:nowrap">Não registrada</span>'
        : faltaOpEFiscal
          ? '<span style="color:var(--amber);font-size:11px;font-weight:700;white-space:nowrap" title="Registrada, mas sem Justificativa Operacional e Fiscal"><i class="ti ti-alert-triangle"></i> Pendente</span>'
          : '<span style="color:var(--green);font-size:11px;font-weight:700;white-space:nowrap"><i class="ti ti-circle-check-filled"></i> Registrada</span>';
    }

    const progresso = document.getElementById('inv-lote-progress');
    const total = _invLoteKeys.length;
    const feitas = _invLoteKeys.filter(kk => _invLoteState[kk]?.registrado).length;
    if (progresso) progresso.textContent = `${feitas} de ${total} registrada${total===1?'':'s'}`;
    const fill = document.getElementById('inv-lote-progress-fill');
    if (fill) fill.style.width = (total ? (feitas / total) * 100 : 0) + '%';

    // Custo Total SAP — recalcula ao vivo (varKg bruto × Custo Médio SAP
    // digitado nesse card), mesmo padrão do modal individual
    // (_invAtualizarCustoSapCard), só que sem precisar de um 3º card
    // separado — aqui vira um valor ao lado do próprio campo de input.
    // Custo Total SAP — recalcula ao vivo (varKg bruto × Custo Médio SAP
    // digitado nesse card), mesmo padrão do modal individual
    // (_invAtualizarCustoSapCard) e mesmo estilo visual do indicador de
    // variação (kg) que já fica no cabeçalho do card, ao lado dele.
    const totalEl = document.getElementById(`lote-custosap-total-${idx}`);
    if (totalEl) {
      const row = invRows.find(r => r.k === k);
      const custoMedioSap = parseFloat(document.getElementById(`lote-custosap-${idx}`)?.value || 0) || 0;
      const totalSap = row ? custoMedioSap * row.varKg : 0;
      const h = window._inv_helpers;
      const _money = h ? h.money : fmtR;
      if (!custoMedioSap) {
        totalEl.className = 'td-mono';
        totalEl.style.color = 'var(--text3)';
        totalEl.textContent = '—';
      } else {
        const cls = totalSap < -0.0001 ? 'diff-neg' : totalSap > 0.0001 ? 'diff-pos' : 'diff-zero';
        totalEl.className = 'td-mono ' + cls;
        totalEl.style.color = '';
        totalEl.textContent = (totalSap < 0 ? '-' : '') + _money(Math.abs(totalSap)).replace('R$ ', 'R$');
      }
    }
  }

  // Chamado a cada edição de qualquer campo (oninput/onchange). Se a linha
  // já estava "Registrada" e o valor mudou em relação ao snapshot salvo,
  // volta pra "Não registrada" (reabilita o botão) — só sinaliza, nunca
  // sobrescreve o que já está persistido em invJustificativas.
  window._invLoteOnInput = function(k) {
    const st = _invLoteState[k];
    if (st && st.registrado) {
      const atual = _invLoteLerValores(k);
      if (JSON.stringify(atual) !== JSON.stringify(st.snapshot)) st.registrado = false;
    }
    _invLoteAtualizarLinhaVisual(k);
  };

  window._invLoteRegistrar = function(k) {
    const vals = _invLoteLerValores(k);
    if (!_invApplyJustValues(k, vals)) return; // bloqueado (período fechado) — toast de erro já mostrado
    _invLoteState[k] = { registrado: true, snapshot: vals };
    _invLoteAtualizarLinhaVisual(k);
    toast('Linha registrada.', 'success');
  };

  // Registra de uma vez toda linha selecionada que ainda não foi
  // registrada, com o que estiver preenchido em cada uma (completo ou não).
  window._invLoteRegistrarTodos = function() {
    let registradas = 0;
    _invLoteKeys.forEach(k => {
      const st = _invLoteState[k] || {};
      if (st.registrado) return;
      const vals = _invLoteLerValores(k);
      if (!_invApplyJustValues(k, vals)) return; // bloqueado (período fechado)
      _invLoteState[k] = { registrado: true, snapshot: vals };
      registradas++;
    });
    _invLoteKeys.forEach(k => _invLoteAtualizarLinhaVisual(k));
    toast(registradas === 0
      ? 'Todas as linhas já estavam registradas.'
      : `${registradas} linha${registradas===1?'':'s'} registrada${registradas===1?'':'s'}.`, 'success');
  };

  // Copia o valor do campo `campo` da linha idxOrigem pras demais linhas
  // selecionadas — só nas que ainda estão vazias nesse campo.
  window._invLoteReplicar = function(campo, idxOrigem) {
    const elOrigem = document.getElementById(`lote-${campo}-${idxOrigem}`);
    const valor = elOrigem ? elOrigem.value : '';
    if (valor === '' || valor == null) { toast('Preencha esse campo antes de replicar.', 'error'); return; }
    let aplicados = 0;
    _invLoteKeys.forEach((k, idx) => {
      if (idx === idxOrigem) return;
      const el = document.getElementById(`lote-${campo}-${idx}`);
      if (!el) return;
      if (el.value === '' || el.value == null) { el.value = valor; window._invLoteOnInput(k); aplicados++; }
    });
    toast(aplicados > 0 ? `Valor copiado para ${aplicados} linha(s).` : 'Nenhuma linha vazia nesse campo — todas já tinham valor.', aplicados > 0 ? 'success' : 'error');
  };

  // Fecha direto se não houver nada digitado-e-não-registrado; senão pede
  // confirmação (mesmo modal de confirmação destrutiva do resto do sistema).
  window._invLoteTentarFechar = function() {
    const pendentes = _invLoteKeys.filter(k => {
      const st = _invLoteState[k] || {};
      if (st.registrado) return false;
      const v = _invLoteLerValores(k);
      return !!(v.op || v.fiscal || v.saldo !== '' || v.custoSap !== '' || v.docSap !== '');
    });
    if (pendentes.length === 0) { document.getElementById('inv-modal-lote')?.remove(); return; }
    confirmarDestrutivo({
      title: 'Sair sem registrar?',
      sub: `${pendentes.length} linha${pendentes.length===1?'':'s'} com alterações não registradas`,
      body: '<div style="font-size:13px;color:var(--text2);line-height:1.6">Os campos preenchidos nessas linhas ainda não foram salvos. Se sair agora, esse preenchimento é perdido — as linhas continuam como estavam antes.</div>',
      confirmLabel: 'Sair mesmo assim',
      onConfirm: () => document.getElementById('inv-modal-lote')?.remove()
    });
  };

  window.invAbrirJustLote = function() {
    if (_invSelected.size === 0) return;
    document.getElementById('inv-modal-lote')?.remove();

    // Defensivo: só considera chaves que ainda existem no recorte
    // FILTRADO atual (invFiltered, não invRows) e que têm cadastro válido
    // (sem cadastro não tem fluxo de justificativa). invFiltrar() já poda
    // _invSelected quando o filtro muda, mas manter essa checagem aqui
    // também garante que o lote nunca inclui linha fora do filtro ativo,
    // mesmo em algum caminho que não passe por invFiltrar() antes.
    _invLoteKeys = invFiltered.filter(r => _invSelected.has(r.k) && !r.semCadastro).map(r => r.k);
    if (_invLoteKeys.length === 0) { toast('Nenhuma linha válida selecionada.', 'error'); return; }
    _invLoteState = {};

    const h = window._inv_helpers;
    const _fmtKg    = h ? h.fmtKg      : (v) => fmt(v) + ' kg';
    const _varClass = h ? h.varClass   : (v) => v < 0 ? 'diff-neg' : v > 0 ? 'diff-pos' : 'diff-zero';
    const _escape   = h ? h.escapeHtml : _invEscape;

    // Campo com rótulo + ícone de replicar alinhados na mesma linha —
    // padrão repetido pelos 5 campos, extraído aqui só pra não repetir a
    // mesma estrutura de div 5 vezes no template abaixo.
    const _campoLabel = (label, campo, idx) => `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <label class="oc-label" style="margin:0">${label}</label>
        <button type="button" class="btn-icon" title="Copiar pras linhas selecionadas ainda vazias nesse campo" onclick="_invLoteReplicar('${campo}', ${idx})"><i class="ti ti-copy"></i></button>
      </div>`;

    const cardsHtml = _invLoteKeys.map((k, idx) => {
      const row = invRows.find(r => r.k === k);
      const j = invJustificativas[k] || {};
      // Linha já tinha justificativa completa salva (de antes de abrir o
      // lote, seja pelo modal individual ou por uma sessão de lote
      // anterior) → começa marcada como "Registrada", com snapshot pra
      // detectar edição a partir daqui.
      const jaCompleta = !!(j.op && j.fiscal && j.saldo !== undefined && j.saldo !== '' && j.custoMedioSap !== undefined && j.custoMedioSap !== '');
      _invLoteState[k] = jaCompleta
        ? { registrado: true, snapshot: { op: j.op||'', fiscal: j.fiscal||'', saldo: String(j.saldo??''), custoSap: String(j.custoMedioSap??''), docSap: String(j.documentoSap??'') } }
        : { registrado: false, snapshot: null };

      const vkCls = _varClass(row.varKg);

      return `
        <div class="inv-lote-card" id="lote-row-${idx}">
          <div class="inv-lote-card-header">
            <div style="min-width:0">
              <div style="font-weight:700;font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_escape(row.material)}</div>
              <div style="font-size:11px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_escape(row.central)} · ${_escape(row.regional)}</div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div class="td-mono" style="font-size:9px;color:var(--text3);white-space:nowrap;line-height:1.3;margin-bottom:1px" title="Est. Final − Est. Teórico = Variação">${row.estoqueFimMissing ? '—' : _fmtKg(row.estoqueFimReal)} − ${_fmtKg(row.estTeor)}</div>
              <div class="td-mono ${vkCls}" style="font-size:14px;font-weight:700;white-space:nowrap">${_fmtKg(row.varKg)}</div>
            </div>
            <div class="td-mono" id="lote-custosap-total-${idx}" style="font-size:14px;font-weight:700;white-space:nowrap;flex-shrink:0" title="Custo Total SAP (Custo Médio SAP × variação)">—</div>
            <div id="lote-status-${idx}" style="flex-shrink:0"></div>
            <button type="button" class="btn btn-primary" id="lote-btn-${idx}" style="flex-shrink:0;white-space:nowrap" onclick="_invLoteRegistrar('${k}')"><i class="ti ti-device-floppy"></i> Registrar</button>
          </div>
          <div class="inv-lote-fields-grid">
            <div style="grid-column:1 / -1">
              ${_campoLabel('Justificativa Operacional', 'op', idx)}
              <textarea id="lote-op-${idx}" class="oc-input oc-textarea" rows="2" style="width:100%" oninput="_invLoteOnInput('${k}')">${_escape(j.op||'')}</textarea>
            </div>
            <div style="grid-column:1 / -1">
              ${_campoLabel('Justificativa Fiscal', 'fiscal', idx)}
              <select id="lote-fiscal-${idx}" class="oc-input" style="width:100%" onchange="_invLoteOnInput('${k}')">
                <option value="" ${!j.fiscal ? 'selected' : ''} disabled>Selecione...</option>
                ${_invMontarOptionsFiscal(j.fiscal||'')}
              </select>
            </div>
            <div>
              ${_campoLabel('Saldo Justificado (kg)', 'saldo', idx)}
              <input id="lote-saldo-${idx}" type="number" class="oc-input" style="width:100%" placeholder="0" value="${j.saldo??''}" oninput="_invLoteOnInput('${k}')">
              <button type="button" class="inv-lote-link-btn" onclick="document.getElementById('lote-saldo-${idx}').value='${Math.round(row.varKg*100)/100}'; _invLoteOnInput('${k}')">Usar variação total</button>
            </div>
            <div>
              ${_campoLabel('Custo Médio SAP (R$/kg)', 'custosap', idx)}
              ${_invCustoSapCampoHtml({ inputId: `lote-custosap-${idx}`, valor: row.custoMedioSap, custoMedioAuto: row.custoMedio, fonte: row.custoMedioFonte, oninput: `_invLoteOnInput('${k}')` })}
            </div>
            <div>
              ${_campoLabel('Documento SAP', 'docsap', idx)}
              <input id="lote-docsap-${idx}" type="number" class="oc-input" style="width:100%" placeholder="Opcional" value="${j.documentoSap??''}" oninput="_invLoteOnInput('${k}')">
            </div>
          </div>
        </div>`;
    }).join('');

    const modal = document.createElement('div');
    modal.id = 'inv-modal-lote';
    modal.className = 'modal-overlay open';
    modal.style.cssText = 'position:fixed;z-index:9999';
    modal.innerHTML = `
      <div class="modal-card" style="max-width:860px;width:92vw">
        <div class="modal-header">
          <div>
            <span class="modal-title"><i class="ti ti-stack-2"></i> Justificar em lote</span>
            <div style="font-size:11px;color:var(--text2);margin-top:3px" id="inv-lote-progress">${_invLoteKeys.length} linha${_invLoteKeys.length===1?'':'s'} selecionada${_invLoteKeys.length===1?'':'s'}</div>
            <div class="inv-lote-progress-track">
              <div class="inv-lote-progress-fill" id="inv-lote-progress-fill" style="width:0%"></div>
            </div>
          </div>
          <button class="modal-close" onclick="_invLoteTentarFechar()"><i class="ti ti-x"></i></button>
        </div>
        <div class="modal-body" style="max-height:70vh;overflow-y:auto;overflow-x:hidden">
          ${cardsHtml}
        </div>
        <div class="modal-footer" style="justify-content:space-between">
          <button class="btn" onclick="_invLoteTentarFechar()">Fechar</button>
          <button class="btn btn-primary" onclick="_invLoteRegistrarTodos()"><i class="ti ti-stack-2"></i> Registrar Todos</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    // Estado visual inicial dos badges/botões (precisa do innerHTML já no DOM).
    _invLoteKeys.forEach(k => _invLoteAtualizarLinhaVisual(k));

    const _escInvLote = e => {
      if (!document.body.contains(modal)) { document.removeEventListener('keydown', _escInvLote); return; }
      if (e.key === 'Escape') window._invLoteTentarFechar();
    };
    document.addEventListener('keydown', _escInvLote);
  };

  // ── Excluir justificativa (botão ao lado de Justificar/Justificado/
  // Ajustado na tabela) — apaga o registro inteiro em invJustificativas[k]
  // e devolve a linha ao estado "sem justificativa" (varAdj volta a ser
  // igual a varKg, Custo Just./Custo SAP somem, o item volta a contar como
  // pendente se a variação for relevante). Mesmo modal de confirmação
  // destrutiva usado em removerMaterial (config.js) e na importação
  // (import.js) — só muda title/sub/body/onConfirm.
  // Reseta os campos derivados de uma linha pro estado "sem justificativa"
  // (mesmo cálculo de quando invGerar roda com just={}) — usado tanto pela
  // exclusão individual (invExcluirJust) quanto pela em massa
  // (invExcluirJustLote).
  function _invResetJustRow(row) {
    row.saldoJust     = 0;
    row.varAdj        = row.varKg;
    // custoMedioSap volta a ser o automático do Custos SAP (row.custoMedio)
    // — excluir a justificativa não deve apagar o custo, só a narrativa/
    // ajuste manual (decisão do Hugo, 05/08).
    row.custoMedioSap = row.custoMedio;
    row.custo         = row.varAdj * row.custoMedioSap;
    row.custoSap      = row.varKg  * row.custoMedioSap;
  }

  window.invExcluirJust = function(k) {
    const row = invRows.find(r => r.k === k);
    if (!row) return;
    const j = invJustificativas[k] || {};
    if (!_invTemJustSalva(j)) return; // guarda extra — botão já vem desabilitado nesse caso

    const campoRow = (label, val) => val
      ? `<div style="display:flex;gap:8px;align-items:flex-start">
           <span style="color:var(--text3);min-width:110px;font-size:12px;flex-shrink:0">${label}</span>
           <span style="font-size:12px">${_invEscape(val)}</span>
         </div>`
      : '';

    confirmarDestrutivo({
      title: 'Excluir justificativa',
      sub: `${row.central} · ${row.material}`,
      body: `
        <div style="display:flex;flex-direction:column;gap:8px">
          ${campoRow('Operacional', j.op)}
          ${campoRow('Fiscal', j.fiscal)}
          ${campoRow('Saldo Just.', j.saldo ? fmt(parseFloat(j.saldo)) + ' kg' : '')}
          ${campoRow('Custo Médio SAP', j.custoMedioSap ? fmtR(parseFloat(j.custoMedioSap)) + '/kg' : '')}
          ${campoRow('Documento SAP', j.documentoSap)}
          <div style="margin-top:8px;padding:10px 12px;background:var(--red-bg);border:1px solid var(--red-border);border-radius:6px;font-size:12px;color:var(--red)">
            <i class="ti ti-alert-triangle"></i>
            A linha volta ao estado "Justificar": Var. Just., Custo Just., Custo SAP, Custo Médio e Documento SAP deixam de aparecer, e o item volta a contar como pendente se a variação for relevante.
          </div>
        </div>`,
      confirmLabel: 'Excluir justificativa',
      onConfirm: () => {
        delete invJustificativas[k];
        _invResetJustRow(row);
        invFiltrar();
        invAtualizarKpis();
        invAtualizarAlertas();
        _invSyncJustificativasToState();
        _invSyncDeleteFromSupabase([k]);
        toast('Justificativa excluída.', 'success');
      }
    });
  };

  // Excluir em massa — reaproveita a MESMA seleção (checkboxes) do
  // "Justificar em lote", na barra que aparece no modo seleção. Só
  // considera, entre as selecionadas, as que TÊM algo salvo pra excluir
  // (_invTemJustSalva) — selecionar 10 linhas em branco e clicar aqui não
  // abre confirmação à toa, só avisa que não há nada a excluir.
  window.invExcluirJustLote = function() {
    if (_invSelected.size === 0) return;
    const alvos = invRows.filter(r => _invSelected.has(r.k) && !r.semCadastro && _invTemJustSalva(invJustificativas[r.k] || {}));
    if (alvos.length === 0) {
      toast('Nenhuma das linhas selecionadas tem justificativa salva pra excluir.', 'error');
      return;
    }

    confirmarDestrutivo({
      title: 'Excluir justificativas em massa',
      sub: `${alvos.length} linha${alvos.length === 1 ? '' : 's'} com justificativa salva`,
      body: `
        <div style="display:flex;flex-direction:column;gap:2px;max-height:220px;overflow:auto">
          ${alvos.map(r => `<div style="font-size:12px;color:var(--text2);padding:4px 0;border-bottom:1px solid var(--border2)">${_invEscape(r.central)} · ${_invEscape(r.material)}</div>`).join('')}
        </div>
        <div style="margin-top:10px;padding:10px 12px;background:var(--red-bg);border:1px solid var(--red-border);border-radius:6px;font-size:12px;color:var(--red)">
          <i class="ti ti-alert-triangle"></i>
          Todas essas linhas voltam ao estado "Justificar" — Var. Just., Custo Just., Custo SAP, Custo Médio e Documento SAP deixam de aparecer nelas, e voltam a contar como pendentes se a variação for relevante.
        </div>`,
      confirmLabel: `Excluir ${alvos.length} justificativa${alvos.length === 1 ? '' : 's'}`,
      onConfirm: () => {
        alvos.forEach(row => {
          delete invJustificativas[row.k];
          _invResetJustRow(row);
        });
        invFiltrar();
        invAtualizarKpis();
        invAtualizarAlertas();
        _invSyncJustificativasToState();
        _invSyncDeleteFromSupabase(alvos.map(row => row.k));
        toast(`${alvos.length} justificativa${alvos.length === 1 ? '' : 's'} excluída${alvos.length === 1 ? '' : 's'}.`, 'success');
      }
    });
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

    // Colunas na MESMA ordem da tabela na tela (Regional→...→Custo Just.),
    // + Just.Operacional/Just.Fiscal/Documento SAP no fim (não são coluna
    // visível na tabela — só o botão "Justificar" aparece — mas são
    // mantidas por serem essenciais pro fechamento fiscal). Sem colunas
    // extras que não existem na tabela (removido: "Ausente?" e "Var.(%)").
    // "Mês" vai em TODA linha (não só no nome do arquivo) — é o que
    // permite à importação verificar se o CSV pertence ao mês certo antes
    // de aplicar qualquer coisa (ver _invHandleImportFile).
    const mesKeyExport = invGetMesKey();
    const header = ['Mês','Regional','Filial','Material','Cód SAP','Categoria','Est.Inicial(kg)','Entradas(kg)','Saídas(kg)','Est.Final(kg)','Est.Teórico(kg)','Var.(kg)','Custo Médio (R$/kg)','Custo SAP (R$)','Saldo Justificado (kg)','Var.Justificada (kg)','Custo Just. (R$)','Just.Operacional','Just.Fiscal','Documento SAP'];
    const rows = invRows.map(r => {
      const j = invJustificativas[r.k] || {};
      const hasJust = j.op && j.fiscal; // Var.Justificada/Custo Just. só preenchem com justificativa completa, mesma regra da tabela
      return [
        mesKeyExport,
        r.regional,
        r.central,
        r.material,
        r.codSap,
        r.categoria,
        r.estoqueIniMissing ? '' : _n(r.estoqueIni),
        _n(r.entradasKg),
        _n(r.saidasKg),
        r.estoqueFimMissing ? '' : _n(r.estoqueFimReal),
        _n(r.estTeor),
        _n(r.varKg),
        r.custoMedioSap > 0 ? _n(r.custoMedioSap) : '',
        r.custoMedioSap > 0 ? _n(r.custoSap) : '',
        j.saldo ? _n(parseFloat(j.saldo)) : '',
        hasJust ? _n(r.varAdj) : '',
        (hasJust && r.custoMedioSap > 0) ? _n(r.custo) : '',
        j.op || '',
        j.fiscal || '',
        j.documentoSap || ''
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

  // ── Importar de outro usuário — traz justificativas do MÊS ATUAL que
  // outros usuários já preencheram e o usuário logado ainda não tem.
  // Mesma ideia do "Importar de" de Centrais/Materiais (config.js), mas
  // escopada ao mês aberto: lá o cadastro não tem conceito de mês, aqui
  // cada chave (k) já carrega o mês, então importar TUDO de uma vez
  // misturaria meses sem necessidade. Só ADM — a RLS também só libera
  // ler `user_id` de outro dono nessa tabela pra admin (ver
  // btn-importar-de-inventario, auth.js). Cria cópia própria (dono = quem
  // importa), nunca escreve na conta do usuário original.
  //
  // MATCH por Central + Cód SAP, não por Central + Material: o "material"
  // dentro de `k` é o ALIAS do cadastro de Materiais de quem preencheu —
  // texto livre, que dois usuários podem grafar diferente pro mesmo
  // material real (ex.: "Cimento CPV" vs "Cimento Portland V"), então
  // bater `k` bruto contra `k` bruto deixa justificativa "órfã" (salva mas
  // nunca aparece em nenhuma linha). Cód SAP é o código do ERP, mais
  // estável entre cadastros diferentes. Por isso: resolve o Cód SAP de
  // cada justificativa importada a partir do cadastro de Materiais do
  // PRÓPRIO usuário de origem (o alias só faz sentido dentro do cadastro
  // dele), depois casa contra as linhas do inventário do usuário logado
  // (já geradas, com Cód SAP resolvido pelo cadastro dele) por
  // Central+Cód SAP — e grava sob o `k` LOCAL (com o material do usuário
  // logado), não sob o `k` de origem.
  let _invNovosParaImportar = []; // achatado: [{ userId, email, kDestino, op, fiscal, saldo, custoMedioSap, documentoSap }]
  let _invImportarDeSemCorrespondencia = 0; // registros de outros usuários sem Central+Cód SAP correspondente no inventário deste mês

  async function _invCarregarNovosParaImportar() {
    _invNovosParaImportar = [];
    _invImportarDeSemCorrespondencia = 0;
    if (!window.supabaseClient || window.currentUser?.role !== 'admin') return;
    const meuId = window.currentUser?.id;
    const mesKey = invGetMesKey();
    const { data, error } = await window.supabaseClient.from('inv_justificativas')
      .select('user_id, k, op, fiscal, saldo, custo_medio_sap, documento_sap')
      .neq('user_id', meuId)
      .like('k', mesKey + '|||%');
    if (error) { console.warn('[ImportarDe] Falha ao checar justificativas de outros usuários:', error); return; }
    const rows = data || [];
    if (!rows.length) return;

    // Central+material (alias de origem) embutidos no k — semCad usa um
    // 4º segmento (__semcad__), mas semCad nunca tem Cód SAP mesmo, então
    // não precisa de tratamento especial: só não vai achar correspondência.
    const porOrigem = rows.map(r => {
      const partes = r.k.split('|||');
      return { ...r, central: partes[1] || '', material: partes.slice(2).join('|||') || '' };
    });

    // Cód SAP de cada material, resolvido pelo cadastro de Materiais do
    // PRÓPRIO usuário de origem (não o do ADM que está importando).
    const userIds = [...new Set(porOrigem.map(r => r.user_id))];
    const { data: matData, error: matError } = await window.supabaseClient.from('materiais')
      .select('user_id, alias, cod_sap').in('user_id', userIds);
    if (matError) { console.warn('[ImportarDe] Falha ao resolver Cód SAP dos usuários de origem:', matError); return; }
    // normalizeText (case/acento/espaço) e normalizarCodSap (zero à esquerda,
    // ".0" de Excel) — sem isso, "GAR1"/"Gar1" ou "51"/"051"/"51.0" contam
    // como divergentes mesmo sendo o mesmo central/código na prática (mesmo
    // problema que normalizarCodSap já resolve entre Materiais e Custos SAP,
    // ver normalize.js).
    const codSapPorOrigem = new Map(); // userId|||NORMALIZETEXT(alias) -> normalizarCodSap(codSap)
    (matData || []).forEach(m => codSapPorOrigem.set(m.user_id + '|||' + normalizeText(m.alias), normalizarCodSap(m.cod_sap)));

    // Índice das linhas do inventário do usuário logado (mês atual) por
    // Central+Cód SAP — já geradas em invRows, com Cód SAP do cadastro dele.
    const localPorCentralCodSap = new Map(); // NORMALIZETEXT(central)|||normalizarCodSap(codSap) -> row.k
    invRows.forEach(row => {
      if (row.semCadastro || !row.codSap) return;
      localPorCentralCodSap.set(normalizeText(row.central) + '|||' + normalizarCodSap(row.codSap), row.k);
    });

    const perfis = (typeof _carregarPerfis === 'function') ? await _carregarPerfis() : {};
    porOrigem.forEach(r => {
      const codSapOrigem = codSapPorOrigem.get(r.user_id + '|||' + normalizeText(r.material)) || '';
      const kDestino = codSapOrigem ? localPorCentralCodSap.get(normalizeText(r.central) + '|||' + codSapOrigem) : null;
      if (!kDestino) { _invImportarDeSemCorrespondencia++; return; }
      // NÃO pula quem já tem justificativa LOCAL parcial/salva (bug real:
      // antes qualquer entrada existente em invJustificativas — mesmo só
      // com Saldo preenchido e Operacional/Fiscal vazios, estado "Pendente"
      // âmbar da tabela — descartava o registro em silêncio, sem contar em
      // lugar nenhum; o match acontecia mas o item nunca chegava a
      // aparecer na lista). Só pula se já estiver TOTALMENTE ajustada —
      // nesse caso não há nada a ganhar importando por cima.
      const jaExistente = invJustificativas[kDestino];
      if (jaExistente && _invEstadoDaLinha(jaExistente) === 'ajustado') return;
      _invNovosParaImportar.push({
        userId: r.user_id, email: perfis[r.user_id] || r.user_id, kDestino,
        op: r.op, fiscal: r.fiscal, saldo: r.saldo,
        custoMedioSap: r.custo_medio_sap, documentoSap: r.documento_sap,
      });
    });
    _invNovosParaImportar.sort((a, b) => a.email.localeCompare(b.email) || a.kDestino.localeCompare(b.kDestino));
  }

  window.invAbrirImportarDe = async function() {
    if (window.currentUser?.role !== 'admin') return;
    if (!invRows.length) { toast('Gere o inventário antes de importar.', 'error'); return; }
    const wrap = document.getElementById('importar-de-inv-usuarios');
    if (wrap) wrap.innerHTML = '<span style="font-size:12px;color:var(--text3)">Verificando registros disponíveis...</span>';
    openModal('modal-importar-de-inv');
    await _invCarregarNovosParaImportar();
    if (!wrap) return;
    if (!_invNovosParaImportar.length) {
      const extra = _invImportarDeSemCorrespondencia
        ? ` (${_invImportarDeSemCorrespondencia} encontrada(s) mas sem Central+Cód SAP correspondente no seu inventário deste mês)`
        : ' (ou ninguém mais preencheu ainda)';
      wrap.innerHTML = `<span style="font-size:12px;color:var(--text3);padding:4px 6px">Nenhuma justificativa nova de outro usuário para o mês ${invGetMesKey()}${extra}.</span>`;
      return;
    }
    const porUsuario = new Map(); // userId -> { email, count }
    _invNovosParaImportar.forEach(it => {
      const cur = porUsuario.get(it.userId) || { email: it.email, count: 0 };
      cur.count++;
      porUsuario.set(it.userId, cur);
    });
    const usuarios = [...porUsuario.entries()].sort((a, b) => a[1].email.localeCompare(b[1].email));
    const aviso = _invImportarDeSemCorrespondencia
      ? `<div style="font-size:11px;color:var(--text3);margin-bottom:6px">${_invImportarDeSemCorrespondencia} registro(s) de outros usuários ignorado(s) — Central+Cód SAP sem correspondência no seu inventário deste mês.</div>`
      : '';
    wrap.innerHTML = aviso + `
      <label class="micro-filter-option" style="border-bottom:1px solid var(--border2);padding-bottom:6px;margin-bottom:4px">
        <input type="checkbox" onchange="document.querySelectorAll('.chk-importar-de-inv-item').forEach(c => c.checked = this.checked)">
        <span class="micro-filter-option-label"><b>Selecionar todos (${usuarios.length})</b></span>
      </label>` +
      usuarios.map(([userId, u]) => `<label class="micro-filter-option">
          <input type="checkbox" class="chk-importar-de-inv-item" value="${escapeHtml(userId)}">
          <span class="micro-filter-option-label">${escapeHtml(u.email)} <span style="font-size:10px;color:var(--text3)">— ${u.count} ${u.count === 1 ? 'justificativa' : 'justificativas'}</span></span>
        </label>`).join('');
  };

  window.invConfirmarImportarDe = function(btn) {
    const checked = [...document.querySelectorAll('.chk-importar-de-inv-item:checked')].map(el => el.value);
    if (!checked.length) { toast('Selecione ao menos um usuário', 'error'); return; }
    _setBtnLoading(btn, true, 'Importando...');
    const selecionados = _invNovosParaImportar.filter(it => checked.includes(it.userId));
    const chavesTocadas = [];
    // Merge, não overwrite — mesmo critério do Importar CSV
    // (_invConfirmarImportCSV): o que já está preenchido localmente NUNCA é
    // apagado pelo import; só entra o que estava em branco.
    selecionados.forEach(it => {
      const atual = invJustificativas[it.kDestino] || {};
      invJustificativas[it.kDestino] = {
        op: atual.op || it.op || '',
        fiscal: atual.fiscal || it.fiscal || '',
        saldo: (atual.saldo != null && atual.saldo !== '') ? atual.saldo : (it.saldo != null ? String(it.saldo) : ''),
        custoMedioSap: (atual.custoMedioSap != null && atual.custoMedioSap !== '') ? atual.custoMedioSap : (it.custoMedioSap != null ? String(it.custoMedioSap) : ''),
        documentoSap: atual.documentoSap || it.documentoSap || '',
      };
      chavesTocadas.push(it.kDestino);
    });
    const usuariosCount = new Set(selecionados.map(it => it.userId)).size;
    _setBtnLoading(btn, false);
    closeModal('modal-importar-de-inv');
    _invSyncJustificativasToState(chavesTocadas);
    window.invGerar();
    toast(`${selecionados.length} justificativa(s) importada(s) de ${usuariosCount} usuário(s)`);
  };

  // ── Importar CSV — preenche em massa as justificativas ──────
  // Lê exatamente o formato gerado por invExportar (';' + campos entre
  // aspas). Casa cada linha com um registro do inventário do mês
  // atualmente carregado por Filial+Material (mesma chave usada em
  // invGerar: mesKey|||central|||material). Depois de ler o arquivo,
  // abre um modal de seleção de categorias — mesmo padrão visual e
  // comportamento do abrirModalCategoriasRelatorio (botão "Visão
  // Diretoria"/"Relatório Detalhado", em relatorio.js): checkboxes por
  // categoria + "Selecionar todas" + contagem de itens.

  window.invAbrirImportCSV = function() {
    if (!invRows.length) { toast('Gere o inventário antes de importar.', 'error'); return; }
    document.getElementById('inv-import-csv-input')?.click();
  };

  // Parser simples de CSV no formato usado por invExportar: delimitador
  // ';', campos sempre entre aspas, aspas internas escapadas como "".
  function _invParseCSV(text) {
    text = text.replace(/^\uFEFF/, ''); // remove BOM se tiver
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else { inQuotes = false; }
        } else {
          field += c;
        }
      } else {
        if (c === '"') { inQuotes = true; }
        else if (c === ';') { row.push(field); field = ''; }
        else if (c === '\r') { /* ignora — tratado no \n */ }
        else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
        else { field += c; }
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => !(r.length === 1 && r[0] === ''));
  }

  // Converte pt-BR ("1.234,56") de volta pra número. Vazio → null (não
  // sobrescreve o que já existe, ver _invConfirmarImportCSV).
  function _invParseNumBR(s) {
    if (s == null || String(s).trim() === '') return null;
    const n = parseFloat(String(s).trim().replace(/\./g, '').replace(',', '.'));
    return isNaN(n) ? null : n;
  }

  let _invImportParsedRows = [];

  window._invHandleImportFile = function(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      input.value = ''; // permite reimportar o mesmo arquivo depois
      const linhas = _invParseCSV(String(reader.result || ''));
      if (linhas.length < 2) { toast('Arquivo CSV vazio ou inválido.', 'error'); return; }
      const header = linhas[0];
      const idx = {};
      header.forEach((h, i) => idx[h.trim()] = i);
      const obrig = ['Filial', 'Material', 'Categoria'];
      if (obrig.some(c => idx[c] === undefined)) {
        toast('CSV inválido — não parece ser um export do Inventário (faltam colunas Filial/Material/Categoria).', 'error');
        return;
      }

      // ── Validação de MÊS — essencial pra não misturar justificativas de
      // meses diferentes (ex.: importar um CSV de Junho em cima do
      // inventário de Julho, que provavelmente tem as MESMAS
      // Central+Material recorrentes todo mês). Bloqueia se:
      // 1) o CSV não tiver a coluna "Mês" (arquivo de antes dessa checagem
      //    existir — pede reexportação, não dá pra confirmar com segurança);
      // 2) o mês do CSV for diferente do mês do inventário aberto agora.
      const mesAtual = invGetMesKey();
      if (idx['Mês'] === undefined) {
        toast('Este CSV não tem a coluna "Mês" (deve ser de uma exportação antiga). Exporte de novo o CSV atual antes de importar, pra garantir que o mês bate certinho.', 'error');
        return;
      }
      const mesesNoArquivo = new Set(linhas.slice(1).map(cols => (cols[idx['Mês']] || '').trim()).filter(Boolean));
      if (mesesNoArquivo.size > 1) {
        toast('Este CSV tem linhas de mais de um mês misturadas — não é possível importar com segurança.', 'error');
        return;
      }
      const mesDoArquivo = [...mesesNoArquivo][0];
      if (mesDoArquivo && mesDoArquivo !== mesAtual) {
        toast(`Este CSV é do mês ${mesDoArquivo}, mas o inventário aberto agora é de ${mesAtual}. Troque para o mês correto antes de importar.`, 'error');
        return;
      }

      _invImportParsedRows = linhas.slice(1).map(cols => ({
        central:       (cols[idx['Filial']] || '').trim(),
        material:      (cols[idx['Material']] || '').trim(),
        categoria:     (cols[idx['Categoria']] || '').trim() || '—',
        op:            idx['Just.Operacional'] !== undefined ? (cols[idx['Just.Operacional']] || '').trim() : '',
        fiscal:        idx['Just.Fiscal'] !== undefined ? (cols[idx['Just.Fiscal']] || '').trim() : '',
        saldo:         idx['Saldo Justificado (kg)'] !== undefined ? _invParseNumBR(cols[idx['Saldo Justificado (kg)']]) : null,
        custoMedioSap: idx['Custo Médio (R$/kg)'] !== undefined ? _invParseNumBR(cols[idx['Custo Médio (R$/kg)']]) : null,
        // Documento SAP é um número de documento (texto puro) — não usa o
        // parser pt-BR de decimais, senão "4500123456" viraria besteira.
        documentoSap:  idx['Documento SAP'] !== undefined ? (cols[idx['Documento SAP']] || '').trim() : '',
      })).filter(r => r.central && r.material);
      if (!_invImportParsedRows.length) { toast('Nenhuma linha válida encontrada no CSV.', 'error'); return; }
      _invAbrirModalImportCategorias();
    };
    reader.onerror = () => toast('Não foi possível ler o arquivo.', 'error');
    reader.readAsText(file, 'utf-8');
  };

  function _invAbrirModalImportCategorias() {
    const counts = {};
    _invImportParsedRows.forEach(r => { counts[r.categoria] = (counts[r.categoria] || 0) + 1; });
    const categorias = Object.keys(counts).sort((a, b) => a.localeCompare(b, 'pt-BR'));

    let modal = document.getElementById('inv-import-categorias-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'inv-import-categorias-modal';
      modal.className = 'modal-overlay';
      modal.style.cssText = 'z-index:3200';
      document.body.appendChild(modal);
    }

    const opcoesHtml = categorias.map(cat => {
      const count = counts[cat];
      return `<label class="inv-import-cat-option" style="display:flex;align-items:center;justify-content:space-between;width:100%;padding:12px 16px;background:var(--bg3);border:1px solid var(--border2);border-radius:8px;cursor:pointer;font-size:13px;font-family:inherit;color:var(--text);font-weight:600;gap:10px">
        <span style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" class="inv-import-cat-checkbox" value="${cat.replace(/"/g,'&quot;')}" checked onchange="_invAtualizaSelecaoTodasCategoriasImport()" style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent)">
          <span>${cat}</span>
        </span>
        <span style="font-size:11px;color:var(--text3);font-family:var(--mono)">${count} ${count === 1 ? 'item' : 'itens'}</span>
      </label>`;
    }).join('');

    modal.innerHTML = `
      <div class="modal" style="max-width:480px;width:94vw">
        <div class="modal-title" style="display:flex;align-items:center;gap:10px">
          <i class="ti ti-filter" style="color:var(--accent)"></i>
          Categorias — Importar CSV
        </div>
        <div class="modal-sub">Selecione as categorias que devem ter as justificativas importadas (linhas com célula em branco não sobrescrevem o que já foi salvo)</div>
        <label style="display:flex;align-items:center;justify-content:space-between;width:100%;padding:12px 16px;background:linear-gradient(135deg,var(--accent-dim),var(--accent));border:none;border-radius:8px;cursor:pointer;font-size:13px;font-family:inherit;color:#fff;font-weight:700;gap:10px;margin-bottom:12px">
          <span style="display:flex;align-items:center;gap:10px">
            <input type="checkbox" id="inv-import-cat-todas" checked onchange="_invToggleTodasCategoriasImport(this)" style="width:16px;height:16px;cursor:pointer">
            <span>Selecionar todas</span>
          </span>
          <span style="font-size:11px;opacity:.75">${_invImportParsedRows.length} itens no total</span>
        </label>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px;max-height:40vh;overflow:auto">
          ${opcoesHtml}
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px">
          <button class="btn" onclick="document.getElementById('inv-import-categorias-modal').classList.remove('open')">Cancelar</button>
          <button class="btn btn-primary" onclick="_invConfirmarImportCSV()"><i class="ti ti-file-upload"></i> Importar</button>
        </div>
      </div>`;
    modal.classList.add('open');
  }

  window._invToggleTodasCategoriasImport = function(checkbox) {
    document.querySelectorAll('.inv-import-cat-checkbox').forEach(cb => { cb.checked = checkbox.checked; });
  };

  window._invAtualizaSelecaoTodasCategoriasImport = function() {
    const all = document.querySelectorAll('.inv-import-cat-checkbox');
    const checked = document.querySelectorAll('.inv-import-cat-checkbox:checked');
    const todasCb = document.getElementById('inv-import-cat-todas');
    if (todasCb) todasCb.checked = all.length === checked.length;
  };

  window._invConfirmarImportCSV = function() {
    const categoriasSelecionadas = new Set(
      Array.from(document.querySelectorAll('.inv-import-cat-checkbox:checked')).map(cb => cb.value)
    );
    if (!categoriasSelecionadas.size) { toast('Selecione ao menos uma categoria.', 'error'); return; }

    const mesKey = invGetMesKey();
    const rowByK = new Map(invRows.map(r => [r.k, r]));

    let atualizados = 0, naoEncontrados = 0, ignoradosCategoria = 0;
    const chavesTocadas = [];
    _invImportParsedRows.forEach(imp => {
      if (!categoriasSelecionadas.has(imp.categoria)) { ignoradosCategoria++; return; }
      const k = mesKey + '|||' + imp.central + '|||' + imp.material;
      const row = rowByK.get(k);
      if (!row) { naoEncontrados++; return; }

      // Merge: só sobrescreve o campo se vier preenchido no CSV — célula
      // em branco não apaga uma justificativa já salva.
      const atual = invJustificativas[k] || {};
      invJustificativas[k] = {
        op:            imp.op || atual.op || '',
        fiscal:        imp.fiscal || atual.fiscal || '',
        saldo:         imp.saldo != null ? String(imp.saldo) : (atual.saldo ?? ''),
        custoMedioSap: imp.custoMedioSap != null ? String(imp.custoMedioSap) : (atual.custoMedioSap ?? ''),
        documentoSap:  imp.documentoSap || atual.documentoSap || '',
      };
      atualizados++;
      chavesTocadas.push(k);
    });

    document.getElementById('inv-import-categorias-modal')?.classList.remove('open');
    _invSyncJustificativasToState(chavesTocadas);
    window.invGerar(); // recalcula custoSap/custo/varAdj com as justificativas novas

    const partes = [`${atualizados} atualizada${atualizados === 1 ? '' : 's'}`];
    if (naoEncontrados)     partes.push(`${naoEncontrados} não encontrada${naoEncontrados === 1 ? '' : 's'} no inventário deste mês`);
    if (ignoradosCategoria) partes.push(`${ignoradosCategoria} ignorada${ignoradosCategoria === 1 ? '' : 's'} (categoria não selecionada)`);
    toast('Importação concluída: ' + partes.join(', ') + '.', naoEncontrados ? 'error' : 'success');
  };

  // ── renderInventario (chamado por anSwitchView ao entrar na Visão Inventário) ──
  let invIniciado = false;
  window.renderInventario = function() {
    if (!invIniciado) {
      const defaultTh = document.querySelector('.inv-data-table th[data-col="custoSap"]');
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
    // Dropdowns simples (seleção única/faixa, sem revert de "pending"):
    // Ausência, Divergências, Justificativa e Margem
    ['ausencia','divergencias','justificativa','margem'].forEach(key => {
      const group = document.getElementById(`imfg-${key}`);
      if (group && !group.contains(e.target)) _invCloseDropdownSimple(key);
    });
  });
})();

// ═══════════════════════════════════════════════════════════
// SYNC DE BOOT — invJustificativas (Fase 2)
// ═══════════════════════════════════════════════════════════
// Fora da IIFE de propósito: só mexe em state.invJustificativas (o array),
// nunca no mapa privado do módulo — o módulo hidrata esse mapa de forma
// lazy, na primeira geração do Inventário (_invHydrateJustificativas), bem
// depois do boot. Por isso basta popular o array aqui, cedo, que a
// hidratação lazy já vai pegar os dados da nuvem quando rodar.
async function syncInvJustificativasFromSupabase() {
  try {
    // fetchMineOrIntegrated pagina por cursor (sem teto de 10k do PostgREST —
    // esta tabela já passou de 1.400 linhas) e já aplica o filtro mine-or-
    // integrated internamente.
    const filtrado = await fetchMineOrIntegrated('inv_justificativas', 'id, user_id, k, op, fiscal, saldo, custo_medio_sap, documento_sap');
    const remoto = filtrado.map(r => ({
      k: r.k, op: r.op, fiscal: r.fiscal, saldo: r.saldo,
      custoMedioSap: r.custo_medio_sap, documentoSap: r.documento_sap
    }));
    // O BANCO MANDA (30/07): o self-heal que existia aqui reenviava
    // justificativa apagada — era o caminho de ressurreição confirmado
    // deste módulo. A nuvem substitui; erro de busca preserva o local.
    state.invJustificativas = remoto;
  } catch (err) {
    console.warn('[Supabase] Falha ao buscar justificativas de inventário — mantendo dados locais.', err);
  }
}
