function closeSidebar() {
  document.querySelector('.sidebar')?.classList.remove('open');
  document.getElementById('nav-overlay')?.classList.remove('open');
}

// Cache de referências DOM para o navigate (populado no primeiro uso)
let _navCache = null;
function _buildNavCache() {
  const navItems = qsa('.tab-item');
  const pages = qsa('.page');
  // Mapeia page-key → tab-item element
  const navByPage = {};
  navItems.forEach(n => {
    const key = n.getAttribute('data-page');
    if (key) navByPage[key] = n;
  });
  // Mapeia page-key → page element
  const pageById = {};
  pages.forEach(p => {
    const key = p.id?.replace('page-', '');
    if (key) pageById[key] = p;
  });
  return { navItems, pages, navByPage, pageById };
}

// Salva posição de scroll por página
const _pageScrollPos = {};

function navigate(page) {
  // Inventário foi movido para aba do Dashboard Gerencial
  if (page === 'inventario') {
    navigate('dashboard');
    setTimeout(() => { if (typeof dgSwitchTab === 'function') dgSwitchTab('inventario'); }, 50);
    return;
  }
  // FAB will update itself via setTimeout after DOM settles
  if (!_navCache) _navCache = _buildNavCache();
  const { navItems, pages, navByPage, pageById } = _navCache;

  const currentPage = document.querySelector('.page.active')?.id?.replace('page-', '');
  const alreadyActive = currentPage === page;

  // Salva scroll da página atual antes de sair
  if (currentPage && !alreadyActive) {
    _pageScrollPos[currentPage] = window.scrollY;
  }

  // Remover active da página atual (sem varrer todas)
  if (currentPage && pageById[currentPage]) pageById[currentPage].classList.remove('active');
  else pages.forEach(p => p.classList.remove('active'));

  // Ativar a nova página
  const newPage = pageById[page] || document.getElementById('page-' + page);
  if (newPage) newPage.classList.add('active');

  // Remover active do tab-item atual e ativar o novo
  if (currentPage && navByPage[currentPage]) navByPage[currentPage].classList.remove('active');
  else navItems.forEach(n => n.classList.remove('active'));
  if (navByPage[page]) navByPage[page].classList.add('active');

  const info = pageTitleMap[page] || { title: page, sub: '' };
  const title = document.getElementById('page-title');
  const sub = document.getElementById('page-sub');
  if (title) title.textContent = info.title;
  if (sub) sub.textContent = info.sub;

  if (!alreadyActive) renderPage(page);
  closeSidebar();

  // Restaura scroll da página destino (após render)
  setTimeout(function(){
    window.scrollTo({ top: _pageScrollPos[page] ?? 0, behavior: 'instant' });
    if(window.updatePeriodFab) updatePeriodFab();
  }, 30);
}

function setTab(tabId, btn) {
  ['tab-entrada', 'tab-saida', 'tab-lancamento', 'tab-sap'].forEach(t => {
    const el = document.getElementById(t);
    if (el) el.style.display = 'none';
  });
  const activeTab = document.getElementById(tabId);
  if (activeTab) activeTab.style.display = '';
  qsa('.tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function setModulo(mod) {
  const map = {
    'Entrada': 'tab-entrada',
    'Saída': 'tab-saida',
    'Lançamento': 'tab-lancamento',
    'SAP': 'tab-sap'
  };
  const tabId = map[mod];
  if (!tabId) return;
  const btn = qs(`.tab-btn[onclick*="${tabId}"]`);
  if (btn) setTab(tabId, btn);
}

function exportarDados() {
  try {
    const now   = new Date();
    const stamp = localISODate(now) + '_'
      + String(now.getHours()).padStart(2,'0')
      + String(now.getMinutes()).padStart(2,'0');

    const lsGet = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch(e) { return null; } };

    // Build backup object — use Blob streaming to avoid 512MB string limit
    const header = JSON.stringify({
      _version:    'analyticsys_backup_v2',
      _exportedAt: now.toLocaleString('pt-BR'),
      _notas:      lsGet('analyticsys_notes_v2'),
      _atalhos:    lsGet('analyticsys_shortcuts_v1'),
      _fechamento: lsGet('analyticsys_fech_v1'),
    });

    // Serialize each large array as a Blob chunk to avoid single-string limits
    const fields = ['entradas','saidas','lancamentos','sap','producao','imports','configs','filiais','materiais','ocorrencias'];

    // Build JSON manually in parts
    const parts = [];
    // Open object, add header fields (without closing brace)
    parts.push(header.slice(0, -1)); // remove trailing }

    for (const field of fields) {
      const arr = state[field] || [];
      parts.push(',"' + field + '":');
      // Serialize in 10k-item chunks to avoid huge strings
      if (arr.length === 0) {
        parts.push('[]');
      } else {
        parts.push('[');
        const CHUNK = 5000;
        for (let i = 0; i < arr.length; i += CHUNK) {
          const slice = arr.slice(i, i + CHUNK);
          if (i > 0) parts.push(',');
          // JSON.stringify an array slice is safe — each slice is small
          const sliceJson = JSON.stringify(slice);
          parts.push(sliceJson.slice(1, -1)); // strip [ and ]
        }
        parts.push(']');
      }
    }

    parts.push('}'); // close object

    const blob = new Blob(parts, { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'analyticsys_backup_' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Backup exportado com sucesso');
  } catch(err) {
    console.error('Erro ao exportar backup:', err);
    toast('Erro ao gerar backup: ' + err.message, 'error');
  }
}

function restaurarBackup(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const parsed = JSON.parse(e.target.result);

      // Validação mínima
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        toast('Arquivo inválido — não é um backup AnalyticSys', 'error');
        return;
      }

      const temDados = ['entradas','saidas','lancamentos','sap','filiais','materiais']
        .some(k => Array.isArray(parsed[k]) && parsed[k].length > 0);
      if (!temDados) {
        toast('Arquivo não contém dados reconhecíveis', 'error');
        return;
      }

      const totalAtual = (state.entradas?.length||0) + (state.lancamentos?.length||0) + (state.sap?.length||0);
      const msg = totalAtual > 0
        ? `Restaurar este backup substituirá TODOS os dados atuais (${totalAtual.toLocaleString('pt-BR')} registros). Esta ação não pode ser desfeita. Confirmar?`
        : 'Restaurar backup? Os dados serão carregados no sistema.';

      if (!confirm(msg)) return;

      showLoadingOverlay('Restaurando backup', 'Carregando dados do arquivo...');
      if (typeof loadingShowSteps === 'function') loadingShowSteps([
        { id: 'bkp-parse',   icon: 'ti-file-import',     label: 'Lendo arquivo de backup' },
        { id: 'bkp-restore', icon: 'ti-database-import',  label: 'Restaurando dados no sistema' },
        { id: 'bkp-index',   icon: 'ti-list-search',      label: 'Reconstruindo índices' },
        { id: 'bkp-save',    icon: 'ti-device-floppy',    label: 'Salvando estado' },
        { id: 'bkp-render',  icon: 'ti-layout',           label: 'Atualizando interface' },
      ]);
      await nextFrame();

      _lstepSet('bkp-parse', 'done'); _lbarSet(20);

      // Restaura cada campo, com fallback para array vazio
      _lstepSet('bkp-restore', 'running'); _lbarSet(35);
      const fields = ['entradas','saidas','lancamentos','sap','producao','imports','configs','filiais','materiais','ocorrencias'];
      fields.forEach(f => {
        state[f] = Array.isArray(parsed[f]) ? parsed[f] : (state[f] || []);
      });
      _lstepSet('bkp-restore', 'done'); _lbarSet(50);

      // Reprocessa índices e normalizações
      _lstepSet('bkp-index', 'running');
      invalidateMaterialLookup();
      invalidateFilialLookup();
      invalidateLancIndex();
      invalidateSapIndex();
      invalidateSaidasIndex();
      if (typeof invalidateAllSearchIndexes === 'function') invalidateAllSearchIndexes();
      if (typeof reaplicarPadronizacaoMateriais === 'function') reaplicarPadronizacaoMateriais();
      _lstepSet('bkp-index', 'done'); _lbarSet(70);

      // Restaura dados do localStorage (notas, atalhos, fechamento)
      const lsSet = (key, val) => { try { if (val !== null && val !== undefined) localStorage.setItem(key, JSON.stringify(val)); } catch(e) {} };
      lsSet('analyticsys_notes_v2',    parsed._notas);
      lsSet('analyticsys_shortcuts_v1', parsed._atalhos);
      lsSet('analyticsys_fech_v1',     parsed._fechamento);

      _lstepSet('bkp-save', 'running'); _lbarSet(85);
      await persistStateNow();
      _lstepSet('bkp-save', 'done');

      _lstepSet('bkp-render', 'running'); _lbarSet(95);
      if (typeof renderAll === 'function') renderAll();
      if (typeof updateImportPrereqUI === 'function') updateImportPrereqUI();
      _lstepSet('bkp-render', 'done'); _lbarSet(100);

      hideLoadingOverlay('Backup restaurado');
      if (typeof loadingHideSteps === 'function') loadingHideSteps();

      const info = parsed._exportedAt ? ` (exportado em ${parsed._exportedAt})` : '';
      toast('Backup restaurado com sucesso' + info);

    } catch (err) {
      console.error(err);
      hideLoadingOverlay('Erro');
      toast('Falha ao restaurar: arquivo corrompido ou inválido', 'error');
    }
  };
  reader.onerror = () => toast('Não foi possível ler o arquivo', 'error');
  reader.readAsText(file, 'utf-8');
}

function updatePageInfo(module) {
  const data = getFilteredData(module);
  const total = data.length;
  const page = module === 'producao' ? currentPageProducao : pages[module];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = total === 0 ? 0 : (page * PAGE_SIZE) + 1;
  const end = Math.min((page + 1) * PAGE_SIZE, total);
  const el = document.getElementById('pi-' + module);
  if (el) {
    el.textContent = total === 0
      ? '0 registros'
      : `${start}-${end} de ${total} registros (pág. ${page + 1}/${totalPages})`;
  }
}

// ── Filtro "Somente manuais" por módulo ──────────────────────────────────────
const _somenteManuais = { entradas: false, saidas: false, lancamentos: false, sap: false };
let _somenteDuplicatas = false;

function toggleSomenteDuplicatas() {
  _somenteDuplicatas = !_somenteDuplicatas;
  const btn = document.getElementById('btn-duplicatas-sap');
  if (btn) {
    btn.classList.toggle('active', _somenteDuplicatas);
    btn.title = _somenteDuplicatas ? 'Exibindo somente duplicatas — clique para voltar' : 'Filtrar somente integrações duplicadas';
  }
  renderSAP?.() || renderModule?.('sap');
}
window.toggleSomenteDuplicatas = toggleSomenteDuplicatas;

const _SAP_REVERSE_MOVS = new Set(['102','864','863','552','802']);

// ── Cache de duplicatas SAP ───────────────────────────────────────────────
// getSapDuplicateKeys faz 3 varreduras sobre state.sap (600k+ registros).
// Cacheia o resultado — só recalcula quando state.sap muda.
let _sapDupCache = null;
let _sapDupCacheVersion = -1; // compara com state.sap.length para invalidar

function _invalidateSapDupCache() {
  _sapDupCache = null;
  _sapDupCacheVersion = -1;
}

function getSapDuplicateKeys() {
  const currentVersion = (state.sap || []).length;
  if (_sapDupCache && _sapDupCacheVersion === currentVersion) {
    return _sapDupCache;
  }

  const normMov = m => String(m || '').trim().toUpperCase();

  const cancelledKeys = new Set(); // pares anulados por estorno → amarelo
  const realDupKeys   = new Set(); // duplicatas reais            → vermelho

  // ── PASSO 1: duplicatas reais ────────────────────────────────────────────
  // Mesmo movimento + ref + central + depósito + material + peso + dtLanc
  // aparecendo mais de uma vez = integração enviada em duplicidade.
  // Documento é excluído pois o estorno gera documento próprio.
  const exactCounts = {};
  (state.sap || []).forEach(r => {
    const key = [
      normMov(r.movimento),
      (r.ref      || '').trim(),
      (r.central  || '').trim(),
      (r.deposito || '').trim(),
      (r.material || r.materialOriginal || '').trim(),
      String(num(r.peso)),
      (r.dtLanc   || '').trim()
    ].join('||');
    exactCounts[key] = (exactCounts[key] || 0) + 1;
  });
  (state.sap || []).forEach(r => {
    const key = [
      normMov(r.movimento),
      (r.ref      || '').trim(),
      (r.central  || '').trim(),
      (r.deposito || '').trim(),
      (r.material || r.materialOriginal || '').trim(),
      String(num(r.peso)),
      (r.dtLanc   || '').trim()
    ].join('||');
    if (exactCounts[key] > 1) realDupKeys.add(getSapRecordKey(r));
  });

  // ── PASSO 2: pares que se anulam ────────────────────────────────────────
  // Agrupa por ref + central + depósito + material + |peso| (sem movimento,
  // sem documento, sem data) para casar originais com seus estornos.
  const groups = {};
  (state.sap || []).forEach(r => {
    const mv      = normMov(r.movimento);
    const pesoVal = num(r.peso);
    const baseKey = [
      (r.ref      || '').trim(),
      (r.central  || '').trim(),
      (r.deposito || '').trim(),
      (r.material || r.materialOriginal || '').trim(),
      Math.abs(pesoVal)
    ].join('||');
    if (!groups[baseKey]) groups[baseKey] = [];
    groups[baseKey].push({ r, mv, pesoVal, used: false });
  });

  const consumePair = (entries, negTest, posTest) => {
    const negEntry = entries.find(e => !e.used && negTest(e));
    if (!negEntry) return false;
    const posEntry = entries.find(e => !e.used && e !== negEntry && posTest(e));
    if (!posEntry) return false;
    negEntry.used = true;
    posEntry.used = true;
    [negEntry.r, posEntry.r].forEach(r => {
      // Só marca como anulado se não é já uma duplicata real
      if (!realDupKeys.has(getSapRecordKey(r)))
        cancelledKeys.add(getSapRecordKey(r));
    });
    return true;
  };

  Object.values(groups).forEach(entries => {
    if (entries.length < 2) return;

    // Consome pares estorno (102/864/863/552/802 negativo) + original positivo
    let found = true;
    while (found) found = consumePair(
      entries,
      e => _SAP_REVERSE_MOVS.has(e.mv) && e.pesoVal < 0,
      e => !_SAP_REVERSE_MOVS.has(e.mv) && e.pesoVal > 0
    );

    // Consome pares Y11 (negativo) + Y12 (positivo)
    found = true;
    while (found) found = consumePair(
      entries,
      e => e.mv === 'Y11' && e.pesoVal < 0,
      e => e.mv === 'Y12' && e.pesoVal > 0
    );
  });

  const result = { cancelled: cancelledKeys, real: realDupKeys };
  _sapDupCache = result;
  _sapDupCacheVersion = currentVersion;
  return result;
}
window.getSapDuplicateKeys = getSapDuplicateKeys;

function getSapRecordKey(r) {
  return [
    (r.movimento || '').trim(),
    (r.ref       || '').trim(),
    (r.central   || '').trim(),
    (r.deposito  || '').trim(),
    (r.dtLanc    || '').trim(),
    (r.material  || r.materialOriginal || '').trim(),
    String(num(r.peso))
  ].join('||');
}

function toggleSomenteManuais(module) {
  _somenteManuais[module] = !_somenteManuais[module];
  // Atualiza visual do botão
  const btn = document.getElementById(`btn-manuais-${module}`);
  if (btn) {
    btn.classList.toggle('active', _somenteManuais[module]);
    btn.title = _somenteManuais[module] ? 'Exibindo somente registros manuais — clique para voltar' : 'Filtrar somente registros manuais';
  }
  // Re-renderiza
  if (module === 'entradas')    renderEntradas?.() || renderModule?.('entradas');
  if (module === 'saidas')      renderSaidas?.()   || renderModule?.('saidas');
  if (module === 'lancamentos') renderLancamentos?.() || renderModule?.('lancamentos');
  if (module === 'sap')         renderSAP?.()      || renderModule?.('sap');
}
window.toggleSomenteManuais = toggleSomenteManuais;

// ── Ordenação das tabelas de módulo ──────────────────────────────────────────
const _moduleSortState = {
  entradas:    { col: null, dir: 'asc' },
  saidas:      { col: null, dir: 'asc' },
  lancamentos: { col: null, dir: 'asc' },
  sap:         { col: null, dir: 'asc' },
};

function moduleSortBy(module, col) {
  const s = _moduleSortState[module];
  if (!s) return;
  if (s.col === col) {
    s.dir = s.dir === 'asc' ? 'desc' : 'asc';
  } else {
    s.col = col;
    s.dir = 'asc';
  }
  // Atualiza visual dos headers
  const table = document.getElementById(`tb-${module}`)?.closest('table');
  if (table) {
    table.querySelectorAll('thead th[data-sort-col]').forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.sortCol === col)
        th.classList.add(s.dir === 'asc' ? 'sort-asc' : 'sort-desc');
    });
  }
  pages[module] = 0;
  renderModule?.(module);
}
window.moduleSortBy = moduleSortBy;

function _applyModuleSort(module, data) {
  const s = _moduleSortState[module];
  if (!s || !s.col) return data;
  const col = s.col;
  const dir = s.dir === 'asc' ? 1 : -1;
  return [...data].sort((a, b) => {
    let av = a[col] ?? '';
    let bv = b[col] ?? '';
    // Comparação numérica para peso/custo/valor
    const an = parseFloat(String(av).replace(/\./g,'').replace(',','.').replace(/[^\d.-]/g,''));
    const bn = parseFloat(String(bv).replace(/\./g,'').replace(',','.').replace(/[^\d.-]/g,''));
    if (!isNaN(an) && !isNaN(bn)) return (an - bn) * dir;
    // Datas dd/mm/aaaa → aaaa/mm/dd para comparação lexicográfica correta
    const toISO = v => { const p = String(v).split('/'); return p.length === 3 ? `${p[2]}${p[1]}${p[0]}` : String(v); };
    return toISO(av).localeCompare(toISO(bv), 'pt-BR', { numeric: true }) * dir;
  });
}

// ── Cache de índices que passam os filtros de coluna ─────────────────────
// Pre-computa quais registros passam nos colFilters ativos, evitando
// recomputar a cada render. Invalidado ao mudar colFilters ou dados.
const _colFilterPassCache = {};

function _invalidateColFilterPassCache(module) {
  delete _colFilterPassCache[module];
}

function _getColFilterPassSet(module, data) {
  const cf = colFilters[module];
  const meta = colFilterMeta[module];
  if (!cf || !meta) return null;
  const activeEntries = Object.entries(cf).filter(([, s]) => s && s.size > 0);
  if (!activeEntries.length) return null;

  // Chave de cache: combina tamanho dos dados + filtros ativos
  const filterSig = activeEntries.map(([ci, s]) => ci + ':' + [...s].sort().join(','))
                                  .sort().join('|');
  const cacheKey = module;
  const cached = _colFilterPassCache[cacheKey];
  if (cached && cached.version === data.length && cached.sig === filterSig) {
    return cached.passSet;
  }

  // Computa o Set de índices que passam
  const passSet = new Set();
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    let pass = true;
    for (const [colIdx, activeSet] of activeEntries) {
      const field = meta.fields[Number(colIdx)];
      if (!field) continue;
      const cellVal = normalizeText(String(r[field] ?? '—'));
      if (!activeSet.has(cellVal)) { pass = false; break; }
    }
    if (pass) passSet.add(i);
  }

  _colFilterPassCache[cacheKey] = { version: data.length, sig: filterSig, passSet };
  return passSet;
}

function getFilteredData(module) {
  let data = state[module] || [];
  // Aplica filtro de manuais antes dos demais
  if (_somenteManuais[module]) data = data.filter(r => r.fonte === 'manual' || r.editado);
  // Aplica filtro de duplicatas (somente SAP)
  if (module === 'sap' && _somenteDuplicatas) {
    const { cancelled, real } = getSapDuplicateKeys();
    data = data.filter(r => { const k = getSapRecordKey(r); return cancelled.has(k) || real.has(k); });
  }
  const f = module === 'producao' ? filtroProducao : filters[module];
  // Passa o scope para que filterRecords use o índice invertido quando possível
  const textFiltered = filterRecords(data, f, getSearchableFields(module), module);
  // Apply column filters usando cache pre-computado
  let result;
  if (moduleHasColFilter(module)) {
    // Tenta usar o passSet pré-computado sobre o data original para mapear índices
    const passSet = _getColFilterPassSet(module, state[module] || []);
    if (passSet) {
      // Re-filtra textFiltered mantendo só os que estão no passSet do data original
      const originalData = state[module] || [];
      // Cria mapa rápido de objeto → índice original (via índice de posição)
      result = textFiltered.filter(r => {
        // recordPassesColFilters é O(colunas), não O(n) — ok para 50 registros por página
        return recordPassesColFilters(module, r);
      });
    } else {
      result = textFiltered;
    }
  } else {
    result = textFiltered;
  }
  // Aplica ordenação por coluna se ativa
  return _applyModuleSort(module, result);
}

function pageSlice(module) {
  const data = getFilteredData(module);
  const page = module === 'producao' ? currentPageProducao : pages[module];
  const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  if (module === 'producao') currentPageProducao = safePage;
  else pages[module] = safePage;
  return data.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
}

function getListFilteredData(scope) {
  let data;
  if (scope === 'dashboard') {
    const feed = [
      ...state.entradas.map(r => ({ modulo: 'Entrada', material: r.material, central: r.centralDestino || r.centralCompra, valor: money(r.valorTotal), data: r.createdAt || 0, status: 'badge-green' })),
      ...state.saidas.map(r => ({ modulo: 'Saída', material: r.material, central: r.central, valor: money(r.valorTotal), data: r.createdAt || 0, status: 'badge-red' })),
      ...state.lancamentos.map(r => ({ modulo: 'Lançamento', material: r.material, central: r.central, valor: `${num(r.peso)} KG`, data: r.createdAt || 0, status: 'badge-amber' })),
      ...state.sap.map(r => ({ modulo: 'SAP', material: r.material, central: r.central, valor: money(r.valorTotal), data: r.createdAt || 0, status: 'badge-blue' })),
      ...state.producao.map(r => ({ modulo: 'Produção', material: 'Produção', central: r.central, valor: `${num(r.producao)} m³`, data: r.createdAt || 0, status: 'badge-purple' }))
    ].sort((a, b) => (b.data || 0) - (a.data || 0));
    // Feed do dashboard é recriado a cada chamada — não tem scope fixo para indexar
    data = filterRecords(feed, listFilters.dashboard, getSearchableFields('dashboard'));
  } else if (scope === 'imports') {
    data = filterRecords(
      state.imports.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
      listFilters.imports,
      getSearchableFields('imports'),
      'imports'
    );
  } else {
    data = filterRecords(state[scope] || [], listFilters[scope], getSearchableFields(scope), scope);
  }
  // Apply column filters usando recordPassesColFilters (O(colunas) por registro — ok)
  // O cache _colFilterPassCache não é aplicado aqui pois o data já é pré-filtrado por texto,
  // tornando-o pequeno o suficiente para a varredura linear ser rápida.
  if (moduleHasColFilter(scope)) {
    data = data.filter(r => recordPassesColFilters(scope, r));
  }
  return data;
}

function getListPageData(scope) {
  const data = getListFilteredData(scope);
  const page = Math.max(0, listPages[scope] || 0);
  const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  listPages[scope] = safePage;
  return {
    data,
    page: safePage,
    totalPages,
    pageData: data.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)
  };
}

function updateListPageInfo(scope) {
  const { data, page, totalPages } = getListPageData(scope);
  const el = document.getElementById('pi-' + scope);
  if (!el) return;
  el.textContent = data.length === 0
    ? '0 registros'
    : `${Math.min(page * PAGE_SIZE + 1, data.length)}-${Math.min((page + 1) * PAGE_SIZE, data.length)} de ${data.length} registros (pág. ${page + 1}/${totalPages})`;
}

function renderScope(scope) {
  if (scope in pages || scope === 'producao') return renderModule(scope);

  if (scope === 'imports') return renderImports();
  if (scope === 'configs') return renderConfigs();
  if (scope === 'filiais') return renderFiliais();
  if (scope === 'materiais') return renderMateriais();
  if (scope === 'acoesRelatorio') return renderAcoesRelatorio();
}

function irParaPagina(module, page) {
  if (module in pages) {
    pages[module] = Math.max(0, page);
    renderModule(module);
    return;
  }
  if (module in listPages) {
    listPages[module] = Math.max(0, page);
    renderScope(module);
  }
}

function paginaAnterior(module) {
  if (module in pages) {
    pages[module] = Math.max(0, pages[module] - 1);
    renderModule(module);
    return;
  }
  if (module in listPages) {
    listPages[module] = Math.max(0, listPages[module] - 1);
    renderScope(module);
  }
}

function proximaPagina(module) {
  if (module in pages) {
    const total = Math.ceil(getFilteredData(module).length / PAGE_SIZE);
    if (pages[module] < Math.max(total - 1, 0)) pages[module]++;
    renderModule(module);
    return;
  }
  if (module in listPages) {
    const total = Math.ceil(getListFilteredData(module).length / PAGE_SIZE);
    if (listPages[module] < Math.max(total - 1, 0)) listPages[module]++;
    renderScope(module);
  }
}

function irParaUltima(module) {
  if (module in pages) {
    pages[module] = Math.max(Math.ceil(getFilteredData(module).length / PAGE_SIZE) - 1, 0);
    renderModule(module);
    return;
  }
  if (module in listPages) {
    listPages[module] = Math.max(Math.ceil(getListFilteredData(module).length / PAGE_SIZE) - 1, 0);
    renderScope(module);
  }
}

function primeiraPaginaProducao() { currentPageProducao = 0; renderProducao(); }
function paginaAnteriorProducao() { currentPageProducao = Math.max(0, currentPageProducao - 1); renderProducao(); }
function proximaPaginaProducao() {
  const total = Math.ceil(getFilteredData('producao').length / PAGE_SIZE);
  currentPageProducao = Math.min(Math.max(total - 1, 0), currentPageProducao + 1);
  renderProducao();
}
function ultimaPaginaProducao() {
  currentPageProducao = Math.max(Math.ceil(getFilteredData('producao').length / PAGE_SIZE) - 1, 0);
  renderProducao();
}

// ═══════════════════════════════════════════════════════════
// COLUMN FILTER ENGINE — estilo Excel/Google Sheets
// ═══════════════════════════════════════════════════════════

// colFilters[module] = { colIndex: Set<string> }
// An empty Set or missing entry = no filter on that column
const colFilters = {};

// Map each module to its tbody id and the data-field for each column index
// (same order as the thead <th> elements)
const colFilterMeta = {
  entradas:    { tbodyId: 'tb-entradas',    fields: ['centralCompra','centralDestino','nf','dtEmissao','dtDescarga','fornecedor','categoria','material','peso','um','custo','valorTotal',null] },
  saidas:      { tbodyId: 'tb-saidas',      fields: ['central','dtEmissao','os','contrato','categoria','fornecedor','material','peso','um','custo','valorTotal',null] },
  lancamentos: { tbodyId: 'tb-lancamentos', fields: ['central','dtLanc','fornecedor','categoria','material','peso','um','custo','valorTotal',null] },
  sap:         { tbodyId: 'tb-sap',         fields: ['usuario','movimento','ref','documento','central','deposito','dtDoc','dtLanc','dtReg','material','peso','um','custoUnit','valorTotal',null] },
  producao:    { tbodyId: 'tb-producao',    fields: ['mes','central','producao','um','precoMedio','custoMedio','margem','totalVendas',null] },
  imports:     { tbodyId: 'tb-imports',     fields: ['arquivo','modulo','registros','dataHora','status',null] },
  configs:     { tbodyId: 'tb-configs',     fields: ['key','value','desc','created',null] },
  filiais:     { tbodyId: 'tb-filiais',     fields: ['origem','alias','cnpj','regional','created',null] },
  materiais:   { tbodyId: 'tb-materiais',   fields: ['origem','alias','desc','created',null] },
};

// Returns true if a record passes all active column filters for a module
function recordPassesColFilters(module, record) {
  const cf = colFilters[module];
  if (!cf) return true;
  const meta = colFilterMeta[module];
  if (!meta) return true;
  for (const [colIdx, activeSet] of Object.entries(cf)) {
    if (!activeSet || !activeSet.size) continue;
    const field = meta.fields[Number(colIdx)];
    if (!field) continue;
    const cellVal = normalizeText(String(record[field] ?? '—'));
    if (!activeSet.has(cellVal)) return false;
  }
  return true;
}

// Global cache for summary table data (populated by renderAnaliticoMacro)

// ── Cache de valores únicos por coluna de filtro ─────────────────────────
// Evita recomputar getColUniqueValues a cada abertura do popover.
// Invalidado quando o searchIndex do módulo é invalidado.
const _colUniqueCache = {};

function _invalidateColUniqueCache(module) {
  delete _colUniqueCache[module];
}
function _invalidateAllColUniqueCaches() {
  for (const k of Object.keys(_colUniqueCache)) delete _colUniqueCache[k];
}

// Collect unique display values for a column from the FULL (unfiltered) dataset
function getColUniqueValues(module, colIdx) {
  const meta = colFilterMeta[module];
  if (!meta) return [];
  const field = meta.fields[colIdx];
  if (!field) return [];
  const data = module === 'producao' ? state.producao
               : (module in state) ? state[module] : [];

  // Usa cache: chave = module+colIdx, versão = tamanho do array
  const cacheKey = module + ':' + colIdx;
  const cached = _colUniqueCache[cacheKey];
  if (cached && cached.version === data.length) return cached.values;

  const seen = new Set();
  for (let i = 0; i < data.length; i++) {
    seen.add(normalizeText(String(data[i][field] ?? '—')));
  }
  const values = [...seen].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  _colUniqueCache[cacheKey] = { version: data.length, values };
  return values;
}

// Initialise colFilters for a module if needed
function ensureColFilters(module) {
  if (!colFilters[module]) colFilters[module] = {};
}

// Check if a column has any active filter
function colHasFilter(module, colIdx) {
  const cf = colFilters[module];
  return cf && cf[colIdx] && cf[colIdx].size > 0;
}

// Check if module has ANY active column filter
function moduleHasColFilter(module) {
  const cf = colFilters[module];
  if (!cf) return false;
  return Object.values(cf).some(s => s && s.size > 0);
}

// ── Popover state ──────────────────────────────────────────
let _cfPopover      = null;   // current open popover element
let _cfModule       = null;
let _cfColIdx       = null;
let _cfSearchQuery  = '';

function openColFilterPopover(thEl, module, colIdx) {
  closeColFilterPopover();
  _cfModule  = module;
  _cfColIdx  = colIdx;
  _cfSearchQuery = '';

  ensureColFilters(module);
  const activeSet = colFilters[module][colIdx] || new Set();
  const allVals   = getColUniqueValues(module, colIdx);

  if (!allVals.length) return;

  const pop = document.createElement('div');
  pop.className = 'cf-popover';
  pop.setAttribute('role', 'dialog');
  pop.innerHTML = buildColFilterHTML(allVals, activeSet, '');
  document.body.appendChild(pop);
  _cfPopover = pop;

  positionColFilterPopover(thEl, pop);

  pop.querySelector('.cf-search')?.focus();
  pop.addEventListener('mousedown', e => e.stopPropagation());
}

function buildColFilterHTML(allVals, activeSet, query) {
  const q = normalizeText(query);
  const filtered = q ? allVals.filter(v => v.includes(q)) : allVals;
  const allChecked = filtered.length > 0 && filtered.every(v => activeSet.has(v));
  const someChecked = filtered.some(v => activeSet.has(v));

  const rows = filtered.map(v => {
    const checked = activeSet.has(v) ? 'checked' : '';
    const label = v === '' || v === '—' ? '<em style="opacity:.5">vazio</em>' : escapeHtml(v);
    return `<label class="cf-row">
      <input type="checkbox" class="cf-check" value="${escapeHtml(v)}" ${checked}>
      <span class="cf-label">${label}</span>
    </label>`;
  }).join('');

  const noResults = !filtered.length
    ? `<div class="cf-empty">Nenhum valor encontrado</div>` : '';

  return `
    <div class="cf-header">
      <div class="cf-search-wrap">
        <i class="ti ti-search" style="font-size:12px;color:var(--text3)"></i>
        <input class="cf-search" type="text" placeholder="Buscar valores…" value="${escapeHtml(query)}" autocomplete="off">
      </div>
    </div>
    <label class="cf-row cf-select-all" style="border-bottom:1px solid var(--border);margin-bottom:4px;padding-bottom:6px">
      <input type="checkbox" class="cf-check-all" data-indeterminate="${someChecked && !allChecked}" ${allChecked ? 'checked' : ''}>
      <span class="cf-label" style="font-weight:600">Selecionar tudo</span>
    </label>
    <div class="cf-list">${rows}${noResults}</div>
    <div class="cf-footer">
      <button class="btn cf-btn-clear" data-cf-action="clear">Limpar</button>
      <button class="btn btn-primary cf-btn-apply" data-cf-action="apply">Aplicar</button>
    </div>`;
}

function positionColFilterPopover(thEl, pop) {
  const rect = thEl.getBoundingClientRect();
  const popW = 240;
  const popH = 340;

  let left = rect.left;
  if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
  left = Math.max(4, left);

  let top = rect.bottom + 4;
  if (top + popH > window.innerHeight - 8) top = rect.top - popH - 4;
  top = Math.max(4, top);

  pop.style.left = left + 'px';
  pop.style.top  = top  + 'px';
  pop.style.width = popW + 'px';

  // Wire up events
  const searchEl = pop.querySelector('.cf-search');
  if (searchEl) {
    searchEl.addEventListener('input', () => {
      _cfSearchQuery = searchEl.value;
      refreshColFilterList();
    });
  }

  const checkAll = pop.querySelector('.cf-check-all');
  if (checkAll) {
    checkAll.indeterminate = checkAll.dataset.indeterminate === 'true';
    checkAll.addEventListener('change', () => {
      pop.querySelectorAll('.cf-check').forEach(c => { c.checked = checkAll.checked; });
    });
  }

  pop.querySelector('[data-cf-action="apply"]')?.addEventListener('click', e => {
    e.stopPropagation();
    applyColFilter();
  });
  pop.querySelector('[data-cf-action="clear"]')?.addEventListener('click', e => {
    e.stopPropagation();
    clearColFilter();
  });
}

function refreshColFilterList() {
  if (!_cfPopover || _cfModule === null || _cfColIdx === null) return;
  ensureColFilters(_cfModule);

  // Save current checked state
  const currentChecked = new Set();
  _cfPopover.querySelectorAll('.cf-check:checked').forEach(c => currentChecked.add(c.value));

  // Merge with saved active set
  const saved = colFilters[_cfModule][_cfColIdx] || new Set();
  const merged = new Set([...saved, ...currentChecked]);

  const allVals = getColUniqueValues(_cfModule, _cfColIdx);
  const q = normalizeText(_cfSearchQuery);
  const filtered = q ? allVals.filter(v => v.includes(q)) : allVals;
  const allChecked = filtered.length > 0 && filtered.every(v => merged.has(v));
  const someChecked = filtered.some(v => merged.has(v));

  const list = _cfPopover.querySelector('.cf-list');
  const checkAll = _cfPopover.querySelector('.cf-check-all');
  if (checkAll) {
    checkAll.checked = allChecked;
    checkAll.indeterminate = !allChecked && someChecked;
  }

  if (list) {
    list.innerHTML = filtered.length ? filtered.map(v => {
      const checked = merged.has(v) ? 'checked' : '';
      const label = v === '' || v === '—' ? '<em style="opacity:.5">vazio</em>' : escapeHtml(v);
      return `<label class="cf-row">
        <input type="checkbox" class="cf-check" value="${escapeHtml(v)}" ${checked}>
        <span class="cf-label">${label}</span>
      </label>`;
    }).join('') : `<div class="cf-empty">Nenhum valor encontrado</div>`;
  }
}

function applyColFilter() {
  if (!_cfPopover || _cfModule === null || _cfColIdx === null) return;
  ensureColFilters(_cfModule);

  const checked = new Set();
  _cfPopover.querySelectorAll('.cf-check:checked').forEach(c => checked.add(c.value));
  colFilters[_cfModule][_cfColIdx] = checked;

  // Capture before closeColFilterPopover() nulls them
  const module = _cfModule;
  const colIdx = _cfColIdx;

  closeColFilterPopover();
  _invalidateColFilterPassCache(module);
  resetPageForModule(module);
  renderModuleByName(module);
  updateAllColFilterIcons(module);
}

function clearColFilter() {
  if (_cfModule === null || _cfColIdx === null) return;
  ensureColFilters(_cfModule);
  colFilters[_cfModule][_cfColIdx] = new Set();

  // Capture before closeColFilterPopover() nulls them
  const module = _cfModule;

  closeColFilterPopover();
  _invalidateColFilterPassCache(module);
  resetPageForModule(module);
  renderModuleByName(module);
  updateAllColFilterIcons(module);
}

function clearAllColFilters(module) {
  colFilters[module] = {};
  _invalidateColFilterPassCache(module);
  resetPageForModule(module);
  renderModuleByName(module);
  updateAllColFilterIcons(module);
}

function closeColFilterPopover() {
  if (_cfPopover) {
    _cfPopover.remove();
    _cfPopover = null;
  }
  _cfModule = null;
  _cfColIdx = null;
  _cfSearchQuery = '';
}

function resetPageForModule(module) {
  if (module in pages) pages[module] = 0;
  else if (module in listPages) listPages[module] = 0;
  else if (module === 'producao') currentPageProducao = 0;
}

function renderModuleByName(module) {
  const map = {
    entradas: renderEntradas,
    saidas: renderSaidas,
    lancamentos: renderLancamentos,
    sap: renderSAP,
    producao: renderProducao,
    imports: renderImports,
    configs: renderConfigs,
    filiais: renderFiliais,
    materiais: renderMateriais,
  };
  if (map[module]) map[module]();
}

// Update filter icon indicators on all ths of a table
function updateAllColFilterIcons(module) {
  const meta = colFilterMeta[module];
  if (!meta) return;
  const tbody = document.getElementById(meta.tbodyId);
  if (!tbody) return;
  const table = tbody.closest('table');
  if (!table) return;
  const ths = table.querySelectorAll('thead th');
  ths.forEach((th, idx) => {
    const btn = th.querySelector('.cf-btn');
    if (!btn) return;
    const active = colHasFilter(module, idx);
    btn.classList.toggle('cf-btn--active', active);
    btn.title = active ? 'Filtro ativo — clique para editar' : 'Filtrar coluna';
  });
  // Show/hide "clear all" badge
  const card = tbody.closest('.table-card');
  if (card) {
    let badge = card.querySelector('.cf-active-badge');
    if (moduleHasColFilter(module)) {
      if (!badge) {
        badge = document.createElement('button');
        badge.className = 'cf-active-badge';
        badge.innerHTML = '<i class="ti ti-filter-off"></i> Limpar filtros';
        badge.onclick = () => clearAllColFilters(module);
        const header = card.querySelector('.table-header');
        if (header) header.appendChild(badge);
      }
    } else {
      badge?.remove();
    }
  }
}

// Inject filter buttons into all <th> of a table after render
function injectColFilterButtons(table, module) {
  if (!table || !module) return;
  const meta = colFilterMeta[module];
  if (!meta) return;
  const ths = table.querySelectorAll('thead th');
  ths.forEach((th, idx) => {
    if (meta.fields[idx] === null) return; // action column
    if (th.querySelector('.cf-btn')) return; // already injected
    const btn = document.createElement('button');
    btn.className = 'cf-btn';
    btn.innerHTML = '<i class="ti ti-filter"></i>';
    btn.title = 'Filtrar coluna';
    btn.setAttribute('aria-label', 'Filtrar coluna');
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (_cfPopover && _cfModule === module && _cfColIdx === idx) {
        closeColFilterPopover();
        return;
      }
      openColFilterPopover(th, module, idx);
    });
    if (colHasFilter(module, idx)) btn.classList.add('cf-btn--active');
    th.appendChild(btn);
  });
}

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const analiticoDetailState = {
  key: null,
  fullscreen: false
};

window.__analiticoDetailCache = new Map();

function buildAnaliticoDetailBreakdown(entries, total, colorVar, title) {
  if (!entries.length) {
    return `<span class="analitico-detail-empty">—</span>`;
  }

  // Serialise entries into a data attribute so the modal can read them on click
  const encoded = encodeURIComponent(JSON.stringify(entries));

  return `
    <button class="bdm-trigger" style="color:${colorVar}"
      onclick="event.stopPropagation(); openBreakdownModal(event.currentTarget)"
      data-entries="${encoded}"
      data-title="${escapeHtml(title)}"
      data-color="${escapeHtml(colorVar)}"
      title="Clique para ver detalhes">
      <span class="bdm-total">${fmtKg(total)}</span>
      <i class="ti ti-table-options bdm-icon"></i>
    </button>`;
}

// ── Breakdown Modal ─────────────────────────────────────────
function openBreakdownModal(trigger) {
  const overlay = document.getElementById('breakdown-modal-overlay');
  const titleEl = document.getElementById('bdm-title');
  const tbody   = document.getElementById('bdm-tbody');
  const totalEl = document.getElementById('bdm-total-val');
  if (!overlay || !titleEl || !tbody || !totalEl) return;

  let entries = [];
  try { entries = JSON.parse(decodeURIComponent(trigger.dataset.entries || '[]')); } catch(e) {}
  const title    = trigger.dataset.title  || '';
  const colorVar = trigger.dataset.color  || 'var(--text)';

  titleEl.textContent = title + ' — Movimentações';

  let grandTotal = 0;
  tbody.innerHTML = entries.map(([cod, value, ref, usuario, dtLanc]) => {
    grandTotal += value;
    const signIcon = value >= 0
      ? '<i class="ti ti-circle-arrow-up" title="Sobra" style="font-size:11px;vertical-align:middle;margin-right:2px"></i>'
      : '<i class="ti ti-circle-arrow-down" title="Desfalque" style="font-size:11px;vertical-align:middle;margin-right:2px"></i>';
    return `<tr>
      <td class="td-mono" style="color:var(--text2)">${escapeHtml(cod)}</td>
      <td class="td-muted">${escapeHtml(ref || '—')}</td>
      <td class="td-muted">${escapeHtml(dtLanc || '—')}</td>
      <td class="td-muted">${escapeHtml(usuario || '—')}</td>
      <td class="td-mono" style="color:${colorVar};text-align:right;font-weight:600">${signIcon}${fmtKg(Math.abs(value))}</td>
    </tr>`;
  }).join('');

  const totalIcon = grandTotal >= 0
    ? '<i class="ti ti-circle-arrow-up" title="Sobra" style="font-size:12px;vertical-align:middle;margin-right:3px"></i>'
    : '<i class="ti ti-circle-arrow-down" title="Desfalque" style="font-size:12px;vertical-align:middle;margin-right:3px"></i>';
  totalEl.innerHTML = totalIcon + fmtKg(Math.abs(grandTotal));
  totalEl.style.color = colorVar;

  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
}

function closeBreakdownModal() {
  const overlay = document.getElementById('breakdown-modal-overlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
}

// ── Pendentes de Integração SAP ──────────────────────────────────────────
/**
 * Given a central's entradas/saidas in the period and the sapNoPeriodo,
 * returns { pendNF: [...], pendOS: [...] } — records NOT matched in SAP.
 *
 * Matching logic:
 *   NF  (mov 101/801) → entrada.nf matched against sap.ref OR sap.documento.
 *       Normalisation: strip leading zeros from the numeric part before the
 *       last "-N" suffix so that "000642190-1" matches "642190-1" in SAP.
 *       Format: both sides are reduced to "<digits>-<suffix>" e.g. "642190-1".
 *
 *   OS  (mov 201) → saida.os (plain number, e.g. "6047") matched against
 *       sap.ref which the SAP exports as "I004-6047" (prefix-NNNN).
 *       Normalisation: from the SAP ref, extract only the numeric part after
 *       the last "-" and compare against the OS number (also stripped of
 *       leading zeros), so "I004-6047" → "6047" matches os "6047".
 */
// ── Estado global: pendentes considerados no analítico ──────────────────
// _pendConsiderados: { [central]: { nf: bool, os: bool } }
// _pendCache:        { [central]: { pendNF: [...], pendOS: [...] } }
// Populados por buildPendIntegSection; consumidos por renderAnaliticoMicro.
window._pendConsiderados = window._pendConsiderados || {};
window._pendCache        = window._pendCache        || {};

function calcPendentesIntegracao({ central, dtIni, dtFim, sapNoPeriodo }) {

  /**
   * Normalise a NF number for matching.
   *
   * The local system stores only the numeric part, e.g. "15464", "5151".
   * SAP stores it with a check-digit suffix, e.g. "15464-2", "0005151-7".
   *
   * Strategy: always reduce to just the numeric base (strip leading zeros,
   * discard the "-suffix" check digit entirely), so both sides compare equal.
   *
   * Examples:
   *   Local "15464"      → "15464"
   *   SAP   "15464-2"    → "15464"
   *   SAP   "0005151-7"  → "5151"
   *   Local "555555"     → "555555"
   *   SAP   "555555-2"   → "555555"
   */
  function normNF(raw) {
    const s = String(raw || '').trim().toUpperCase();
    const dashIdx = s.lastIndexOf('-');
    // Drop the check-digit suffix (everything after the last dash)
    const base = dashIdx > 0 ? s.slice(0, dashIdx) : s;
    return base.replace(/^0+/, '') || '0';
  }

  /**
   * Normalise a SAP ref for OS matching: extract the numeric portion after
   * the last "-". "I004-6047" → "6047", "6047" → "6047".
   * Leading zeros are stripped so "I004-00123" → "123".
   */
  function normSapRefOS(raw) {
    const s = String(raw || '').trim().toUpperCase();
    const dashIdx = s.lastIndexOf('-');
    if (dashIdx >= 0) {
      return s.slice(dashIdx + 1).replace(/^0+/, '') || '0';
    }
    return s.replace(/^0+/, '') || '0';
  }

  /**
   * Normalise an OS number from the Saídas module: strip leading zeros.
   * "06047" → "6047", "6047" → "6047".
   */
  function normOS(raw) {
    return String(raw || '').trim().toUpperCase().replace(/^0+/, '') || '0';
  }

  // Build lookup sets from SAP records for this central+period.
  // Two sets: one for NF matching (normalised NF format),
  //           one for OS matching (numeric part of ref only).
  const sapNFRefs  = new Set(); // normalised NF values
  const sapOSRefs  = new Set(); // numeric part of SAP ref (for OS lookup)

  sapNoPeriodo.forEach(s => {
    const cod = normMov(s.movimento);
    const ref = String(s.ref       || '').trim().toUpperCase();
    const doc = String(s.documento || '').trim().toUpperCase();

    if (CODIGOS_ENTRADA.has(cod)) {
      // Entradas SAP (101/801) → used for NF matching
      if (ref) sapNFRefs.add(normNF(ref));
      if (doc) sapNFRefs.add(normNF(doc));
    } else if (cod === '201') {
      // Saídas SAP mov 201 ONLY → used for OS matching (numeric part of ref)
      if (ref) sapOSRefs.add(normSapRefOS(ref));
      if (doc) sapOSRefs.add(normSapRefOS(doc));
    }
  });

  const inPeriodLocal = (dateStr) => {
    const d = parseDate(dateStr);
    return d && d >= dtIni && d <= dtFim;
  };

  // NFs pendentes: entradas desta central no período cujo NF não aparece no SAP
  // Only check mov 101 and 801 (CODIGOS_ENTRADA).
  // Usa dtDescarga para o filtro de período (data relevante para o período de análise);
  // fallback para dtEmissao caso dtDescarga não esteja preenchida.
  const pendNF = (state.entradas || []).filter(r => {
    const cent = (r.centralDestino || r.centralCompra || '');
    if (cent !== central) return false;
    if (!inPeriodLocal(r.dtDescarga || r.dtEmissao)) return false;
    if (!r.nf) return false; // sem NF cadastrada — ignorar
    const nfNorm = normNF(r.nf);
    return !sapNFRefs.has(nfNorm);
  });

  // OS pendentes: saídas desta central no período cujo OS não aparece no SAP.
  // SAP stores the OS reference as "I004-NNNN"; the local Saídas module stores
  // just the number (e.g. "6047"). We match on the numeric part only.
  const pendOS = (state.saidas || []).filter(r => {
    if (r.central !== central) return false;
    if (!inPeriodLocal(r.dtEmissao)) return false;
    if (!r.os) return false; // sem OS cadastrada — ignorar
    const osNorm = normOS(r.os);
    return !sapOSRefs.has(osNorm);
  });

  return { pendNF, pendOS };
}

/**
 * Builds the "Pendentes de Integração SAP" section HTML for a central card.
 */
function buildPendIntegSection({ central, dtIni, dtFim, sapNoPeriodo }) {
  const { pendNF, pendOS } = calcPendentesIntegracao({ central, dtIni, dtFim, sapNoPeriodo });
  const nfCount = pendNF.length;
  const osCount = pendOS.length;

  // Salva no cache global — consumido por renderAnaliticoMicro ao injetar sintéticos
  window._pendCache[central] = { pendNF, pendOS };
  const pendState = window._pendConsiderados[central] || {};

  let chipsHtml = '';

  if (nfCount === 0 && osCount === 0) {
    chipsHtml = `<span class="pend-integ-chip pend-integ-chip-ok">
      <i class="ti ti-circle-check" style="font-size:13px"></i>
      Todas NFs e OS integradas
    </span>`;
  } else {
    if (nfCount > 0) {
      const encoded = encodeURIComponent(JSON.stringify(pendNF.map(r => ({
        nf: r.nf, material: r.material || '—', peso: r.peso || 0,
        um: r.um || 'kg', dtEmissao: r.dtEmissao || '—', dtDescarga: r.dtDescarga || '—', fornecedor: r.fornecedor || '—'
      }))));
      const nfAtivo = !!pendState.nf;
      chipsHtml += `<button class="pend-integ-chip pend-integ-chip-nf"
        onclick="event.stopPropagation(); openPendIntegModal(event.currentTarget)"
        data-tipo="NF" data-central="${escapeHtml(central)}" data-items="${encoded}"
        title="Ver NFs não integradas no SAP">
        <i class="ti ti-file-invoice" style="font-size:13px"></i>
        NFs pendentes SAP
        <span class="pend-count-badge">${nfCount}</span>
      </button>
      <button class="pend-integ-chip pend-integ-chip-nf pend-considerar-btn${nfAtivo ? ' pend-considerar-ativo' : ''}"
        onclick="event.stopPropagation(); togglePendConsiderados('${escapeHtml(central)}','nf')"
        title="${nfAtivo ? 'Clique para desconsiderar as NFs pendentes do cálculo' : 'Clique para incluir as NFs pendentes no cálculo'}">
        <i class="ti ${nfAtivo ? 'ti-eye-off' : 'ti-eye-plus'}" style="font-size:13px"></i>
        ${nfAtivo ? 'Desconsiderar NFs' : 'Considerar NFs'}
      </button>`;
    }
    if (osCount > 0) {
      const encoded = encodeURIComponent(JSON.stringify(pendOS.map(r => ({
        os: r.os, material: r.material || '—', peso: r.peso || 0,
        um: r.um || 'kg', dtEmissao: r.dtEmissao || '—', fornecedor: r.fornecedor || '—'
      }))));
      const osAtivo = !!pendState.os;
      chipsHtml += `<button class="pend-integ-chip pend-integ-chip-os"
        onclick="event.stopPropagation(); openPendIntegModal(event.currentTarget)"
        data-tipo="OS" data-central="${escapeHtml(central)}" data-items="${encoded}"
        title="Ver OS não integradas no SAP">
        <i class="ti ti-clipboard-list" style="font-size:13px"></i>
        OS pendentes SAP
        <span class="pend-count-badge">${osCount}</span>
      </button>
      <button class="pend-integ-chip pend-integ-chip-os pend-considerar-btn${osAtivo ? ' pend-considerar-ativo' : ''}"
        onclick="event.stopPropagation(); togglePendConsiderados('${escapeHtml(central)}','os')"
        title="${osAtivo ? 'Clique para desconsiderar as OS pendentes do cálculo' : 'Clique para incluir as OS pendentes no cálculo'}">
        <i class="ti ${osAtivo ? 'ti-eye-off' : 'ti-eye-plus'}" style="font-size:13px"></i>
        ${osAtivo ? 'Desconsiderar OS' : 'Considerar OS'}
      </button>`;
    }
  }

  return `
    <div class="pend-integ-section">
      <div class="micro-section-title">
        <i class="ti ti-cloud-off"></i>
        Integração SAP
      </div>
      <div class="pend-integ-chips">${chipsHtml}</div>
    </div>`;
}

function openPendIntegModal(trigger) {
  const overlay = document.getElementById('pim-overlay');
  if (!overlay) return;

  // helpers locais independentes de escopo externo
  const _num = v => { const n = parseFloat(String(v ?? 0).replace(',','.')); return Number.isFinite(n) ? n : 0; };
  const _fmt = n => isNaN(n) ? '—' : Math.abs(n).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});

  const tipo    = trigger.dataset.tipo || '?';
  const central = trigger.dataset.central || '—';
  let items = [];
  try { items = JSON.parse(decodeURIComponent(trigger.dataset.items || '[]')); } catch(e) {}

  // Title/sub
  document.getElementById('pim-title').textContent =
    tipo === 'NF' ? 'NFs sem integração SAP' : 'OS sem integração SAP';
  document.getElementById('pim-sub').textContent =
    `Central: ${central} · ${items.length} registro${items.length !== 1 ? 's' : ''} pendente${items.length !== 1 ? 's' : ''}`;

  const tbody = document.getElementById('pim-tbody');
  const thead = document.getElementById('pim-thead');

  if (tipo === 'NF') {
    thead.innerHTML = `<tr>
      <th>NF</th>
      <th>Material</th>
      <th>Fornecedor</th>
      <th>Dt. Emissão</th>
      <th>Dt. Descarga</th>
      <th style="text-align:right">Quantidade</th>
    </tr>`;
    tbody.innerHTML = items.map(it => `<tr>
      <td class="td-mono" style="font-weight:600;color:var(--green)">${escapeHtml(String(it.nf || '—'))}</td>
      <td>${escapeHtml(String(it.material || '—'))}</td>
      <td class="td-muted">${escapeHtml(String(it.fornecedor || '—'))}</td>
      <td class="td-muted">${escapeHtml(String(it.dtEmissao || '—'))}</td>
      <td class="td-muted">${escapeHtml(String(it.dtDescarga || '—'))}</td>
      <td class="td-mono" style="text-align:right;color:var(--green)">${_fmt(_num(it.peso))} ${escapeHtml(String(it.um || 'kg'))}</td>
    </tr>`).join('');
  } else {
    thead.innerHTML = `<tr>
      <th>OS</th>
      <th>Material</th>
      <th>Fornecedor</th>
      <th>Dt. Emissão</th>
      <th style="text-align:right">Quantidade</th>
    </tr>`;
    tbody.innerHTML = items.map(it => `<tr>
      <td class="td-mono" style="font-weight:600;color:var(--red)">${escapeHtml(String(it.os || '—'))}</td>
      <td>${escapeHtml(String(it.material || '—'))}</td>
      <td class="td-muted">${escapeHtml(String(it.fornecedor || '—'))}</td>
      <td class="td-muted">${escapeHtml(String(it.dtEmissao || '—'))}</td>
      <td class="td-mono" style="text-align:right;color:var(--red)">${_fmt(_num(it.peso))} ${escapeHtml(String(it.um || 'kg'))}</td>
    </tr>`).join('');
  }

  document.getElementById('pim-count').textContent =
    `${items.length} registro${items.length !== 1 ? 's' : ''} pendente${items.length !== 1 ? 's' : ''}`;

  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
}

function closePendIntegModal() {
  const overlay = document.getElementById('pim-overlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
}

/**
 * Ativa/desativa a consideração de pendentes (NF ou OS) no cálculo do analítico.
 * Chamado pelos botões "Considerar NFs / OS" nos cards de integração SAP.
 * @param {string} central - Nome da central
 * @param {'nf'|'os'} tipo - Tipo de pendente a alternar
 */
function togglePendConsiderados(central, tipo) {
  if (!window._pendConsiderados[central]) {
    window._pendConsiderados[central] = { nf: false, os: false };
  }
  window._pendConsiderados[central][tipo] = !window._pendConsiderados[central][tipo];

  // Refresh cirúrgico: atualiza só o card desta central + o cabeçalho do
  // regional ao qual ela pertence, sem tocar nas demais centrais nem
  // reordenar nada (decisão deliberada — ver refreshCentralCard em
  // analitico.js). Se der certo, encerra aqui.
  if (typeof refreshCentralCard === 'function' && refreshCentralCard(central)) {
    return;
  }

  // ── Fallback de segurança ────────────────────────────────────────────
  // Só chega aqui se o refresh cirúrgico não foi possível (ex: estado
  // global ausente, card não encontrado em tela). Mantém o comportamento
  // antigo — render completo com restauração manual do que estava aberto —
  // para o toggle nunca ficar "travado" sem efeito visível.
  if (window.__analiticoResults && window.__analiticoDtIni && window.__analiticoDtFim) {
    // Salva estado aberto/fechado dos regionais (chave: id do chevron rchev-*)
    const regionaisAbertos = new Set();
    document.querySelectorAll('#an-micro-container .regional-group').forEach(group => {
      const body = group.querySelector('.regional-group-body');
      const chev = group.querySelector('[id^="rchev-"]');
      if (body && body.classList.contains('open') && chev) regionaisAbertos.add(chev.id);
    });

    // Salva estado aberto/fechado dos cards de central (chave: data-central)
    const cardsAbertos = new Set();
    document.querySelectorAll('#an-micro-container .micro-filial-card').forEach(card => {
      const body = card.querySelector('.micro-filial-body');
      if (body && body.classList.contains('open')) cardsAbertos.add(card.dataset.central);
    });

    renderAnaliticoMicro(window.__analiticoResults, window.__analiticoDtIni, window.__analiticoDtFim);

    // Restaura regionais
    document.querySelectorAll('#an-micro-container .regional-group').forEach(group => {
      const body = group.querySelector('.regional-group-body');
      const chev = group.querySelector('[id^="rchev-"]');
      if (chev && regionaisAbertos.has(chev.id)) {
        if (body) body.classList.add('open');
        group.classList.remove('collapsed');
        chev.style.transform = '';
      }
    });

    // Restaura cards de central
    document.querySelectorAll('#an-micro-container .micro-filial-card').forEach(card => {
      if (!cardsAbertos.has(card.dataset.central)) return;
      const body = card.querySelector('.micro-filial-body');
      const chev = card.querySelector('[id^="chev-"]');
      if (body) body.classList.add('open');
      if (chev) chev.style.transform = 'rotate(180deg)';
    });
  }
}

Object.assign(window, { openBreakdownModal, closeBreakdownModal, openPendIntegModal, closePendIntegModal, togglePendConsiderados });

// ── Conflict Resolution Modal ───────────────────────────────
let _lrcDetailKey = null;
let _lrcChecked   = new Set();

function _lrcFingerprint(l) {
  return [l.central, l.dtLanc, l.material, String(num(l.peso)), l.fornecedor, l.um].join('|');
}

function _lrcRefreshDetailModal(key) {
  if (!key) return;
  const overlay = document.getElementById('analitico-detail-overlay');
  if (!overlay || !overlay.classList.contains('open')) return;
  // rodarAnalitico é síncrono — cache já está atualizado aqui
  const payload = window.__analiticoDetailCache?.get(String(key));
  if (!payload) return;
  const body = document.getElementById('analitico-detail-body');
  if (body) {
    body.innerHTML = buildAnaliticoDetailHtml(payload);
    if (typeof initHelpBadges === 'function') initHelpBadges();
  }
}

function _lrcRenderCards() {
  const overlay = document.getElementById('lrc-overlay');
  if (!overlay) return;
  const lancs = overlay._lancs || [];

  const checkedTotal = lancs.reduce((sum, l, i) =>
    _lrcChecked.has(i) ? sum + num(l.peso) : sum, 0);

  const estEl = document.getElementById('lrc-est-inicial');
  if (estEl) estEl.textContent = fmtKg(checkedTotal);

  const body = document.getElementById('lrc-body');
  body.innerHTML = lancs.map((l, i) => {
    const checked = _lrcChecked.has(i);
    return `
    <div class="lrc-card${checked ? ' selected' : ''}" onclick="lrcToggle(${i})">
      <div class="lrc-card-top">
        <div class="lrc-checkbox${checked ? ' checked' : ''}">
          <i class="ti ti-check" style="font-size:11px;color:#fff;opacity:${checked ? 1 : 0}"></i>
        </div>
        <span class="lrc-peso">${fmtKg(num(l.peso))}</span>
        <button class="lrc-delete-btn" onclick="event.stopPropagation(); lrcDelete(${i})"
          title="Excluir permanentemente do módulo Lançamentos">
          <i class="ti ti-trash"></i> Excluir
        </button>
      </div>
      <div class="lrc-card-meta">
        <div class="lrc-meta-item">
          <span class="lrc-meta-label">Fornecedor</span>
          <span class="lrc-meta-val">${escapeHtml(l.fornecedor || '—')}</span>
        </div>
        <div class="lrc-meta-item">
          <span class="lrc-meta-label">Categoria</span>
          <span class="lrc-meta-val">${escapeHtml(l.categoria || '—')}</span>
        </div>
        <div class="lrc-meta-item">
          <span class="lrc-meta-label">Un. Medida</span>
          <span class="lrc-meta-val">${escapeHtml(l.um || '—')}</span>
        </div>
        <div class="lrc-meta-item">
          <span class="lrc-meta-label">Custo Unit.</span>
          <span class="lrc-meta-val">${money(l.custo)}</span>
        </div>
      </div>
    </div>`;
  }).join('') +
  `<p class="lrc-hint">Marque os lançamentos a incluir no Est. Inicial. Use a lixeira para excluir permanentemente.</p>`;
}

function openLancConflictModal(trigger) {
  const overlay = document.getElementById('lrc-overlay');
  if (!overlay) return;

  let lancs = [];
  try { lancs = JSON.parse(decodeURIComponent(trigger.dataset.lancs || '[]')); } catch(e) {}
  const date    = trigger.dataset.date      || '';
  _lrcDetailKey = trigger.dataset.detailKey || null;
  _lrcChecked   = new Set(lancs.map((_, i) => i));

  document.getElementById('lrc-date').textContent  = date;
  document.getElementById('lrc-count').textContent = lancs.length + ' lançamento' + (lancs.length !== 1 ? 's' : '');

  overlay._lancs = lancs;
  _lrcRenderCards();
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
}

function closeLancConflictModal() {
  const overlay = document.getElementById('lrc-overlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  _lrcDetailKey = null;
  _lrcChecked   = new Set();
}

function lrcToggle(idx) {
  if (_lrcChecked.has(idx)) _lrcChecked.delete(idx);
  else _lrcChecked.add(idx);
  _lrcRenderCards();
}

function lrcSelect(card, idx) { lrcToggle(idx); }

async function lrcConfirm() {
  // Desmarcar = excluir os desmarcados do state
  const overlay = document.getElementById('lrc-overlay');
  if (!overlay) return;
  const lancs = overlay._lancs || [];
  if (!lancs.length) return;

  const toRemove = lancs.filter((_, i) => !_lrcChecked.has(i));
  if (toRemove.length) {
    if (typeof showLoadingOverlay === 'function') showLoadingOverlay('Resolvendo conflito', 'Excluindo lançamentos selecionados...');
    if (typeof loadingShowSteps === 'function') loadingShowSteps([
      { id: 'lrc-remove', icon: 'ti-trash',          label: 'Excluindo lançamentos' },
      { id: 'lrc-save',   icon: 'ti-device-floppy',  label: 'Salvando alterações' },
    ]);
    await nextFrame();
    _lstepSet('lrc-remove', 'running'); _lbarSet(30);
    toRemove.forEach(l => {
      const fp = _lrcFingerprint(l);
      state.lancamentos = state.lancamentos.filter(r => _lrcFingerprint(r) !== fp);
    });
    invalidateLancIndex();
    _lstepSet('lrc-remove', 'done'); _lstepSet('lrc-save', 'running'); _lbarSet(70);
    await persistStateNow();
    _lstepSet('lrc-save', 'done'); _lbarSet(100);
    hideLoadingOverlay('Conflito resolvido');
    if (typeof loadingHideSteps === 'function') loadingHideSteps();
  }

  const key = _lrcDetailKey;
  closeLancConflictModal();

  rodarAnalitico();
  _lrcRefreshDetailModal(key);

  if (toRemove.length) toast(toRemove.length + ' lançamento(s) excluído(s) — conflito resolvido');
}

async function lrcDelete(idx) {
  const overlay = document.getElementById('lrc-overlay');
  if (!overlay) return;
  const lancs = overlay._lancs || [];
  const target = lancs[idx];
  if (!target) return;

  const confirmed = await new Promise(resolve => {
    document.getElementById('lrc-confirm-inline')?.remove();
    const mini = document.createElement('div');
    mini.id = 'lrc-confirm-inline';
    mini.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.55);backdrop-filter:blur(2px);border-radius:var(--radius-xl);display:flex;align-items:center;justify-content:center;z-index:10;padding:24px';
    mini.innerHTML = `
      <div style="background:var(--bg2);border:1px solid var(--border2);border-radius:var(--radius-lg);padding:20px 24px;max-width:320px;width:100%;box-shadow:0 12px 40px rgba(0,0,0,0.45)">
        <div style="font-size:13.5px;font-weight:600;color:var(--text);margin-bottom:6px;display:flex;align-items:center;gap:8px">
          <i class="ti ti-trash" style="color:var(--red);font-size:16px"></i> Excluir lançamento?
        </div>
        <p style="font-size:12px;color:var(--text2);margin:0 0 6px;line-height:1.5">
          <strong style="color:var(--text);font-family:var(--mono)">${fmtKg(num(target.peso))}</strong>
          — ${escapeHtml(target.fornecedor || '—')} · ${escapeHtml(target.dtLanc || '—')}
        </p>
        <p style="font-size:12px;color:var(--text2);margin:0 0 18px;line-height:1.5">
          Removido permanentemente da aba <strong>Lançamentos</strong>. Não pode ser desfeito.
        </p>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button id="lrc-confirm-cancel" class="btn" style="font-size:12px">Cancelar</button>
          <button id="lrc-confirm-ok" class="btn" style="font-size:12px;background:var(--red);border-color:var(--red);color:#fff;font-weight:600">
            <i class="ti ti-trash"></i> Excluir permanentemente
          </button>
        </div>
      </div>`;
    const dialog = overlay.querySelector('.lrc-dialog') ?? overlay.firstElementChild;
    if (dialog) { dialog.style.position = 'relative'; dialog.appendChild(mini); }
    else overlay.appendChild(mini);
    document.getElementById('lrc-confirm-ok')?.addEventListener('click', () => { mini.remove(); resolve(true); });
    document.getElementById('lrc-confirm-cancel')?.addEventListener('click', () => { mini.remove(); resolve(false); });
    const onKey = e => { if (e.key === 'Escape') { mini.remove(); resolve(false); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
  });

  if (!confirmed) return;

  // Salvar key ANTES de qualquer close
  const key = _lrcDetailKey;

  if (typeof showLoadingOverlay === 'function') showLoadingOverlay('Excluindo lançamento', 'Removendo da base de dados...');
  if (typeof loadingShowSteps === 'function') loadingShowSteps([
    { id: 'del-remove', icon: 'ti-trash',         label: 'Removendo lançamento' },
    { id: 'del-save',   icon: 'ti-device-floppy', label: 'Salvando alterações' },
  ]);
  await nextFrame();
  _lstepSet('del-remove', 'running'); _lbarSet(30);
  const fp = _lrcFingerprint(target);
  const before = state.lancamentos.length;
  state.lancamentos = state.lancamentos.filter(r => _lrcFingerprint(r) !== fp);
  const removed = before - state.lancamentos.length;
  invalidateLancIndex();
  _lstepSet('del-remove', 'done'); _lstepSet('del-save', 'running'); _lbarSet(70);
  await persistStateNow();
  _lstepSet('del-save', 'done'); _lbarSet(100);
  hideLoadingOverlay('Lançamento excluído');
  if (typeof loadingHideSteps === 'function') loadingHideSteps();

  const newLancs = lancs.filter((_, i) => i !== idx);
  overlay._lancs = newLancs;

  const newChecked = new Set();
  _lrcChecked.forEach(ci => {
    if (ci < idx) newChecked.add(ci);
    else if (ci > idx) newChecked.add(ci - 1);
  });
  _lrcChecked = newChecked;

  toast(removed + ' lançamento(s) excluído(s) permanentemente');

  // Sempre recalcular e atualizar o modal do material
  rodarAnalitico();
  _lrcRefreshDetailModal(key);

  if (newLancs.length <= 1) {
    closeLancConflictModal();
    return;
  }

  document.getElementById('lrc-count').textContent = newLancs.length + ' lançamento' + (newLancs.length !== 1 ? 's' : '');
  _lrcRenderCards();
}

Object.assign(window, { openLancConflictModal, closeLancConflictModal, lrcSelect, lrcToggle, lrcConfirm, lrcDelete });

function buildAnaliticoDetailHtml(payload) {
  const s = payload.summary;

  // Helper: célula de saldo real (Est. Inicial ou Est. Final confirmado)
  const realSaldoCell = (value, title = '') =>
    `<span class="td-mono stock-real" title="${title}">${fmtKg(value)}</span>`;

  // Helper: célula de saldo estimado (sem lançamento real)
  const estimatedSaldoCell = (value, title = '') => `
    <span class="estimated-stock-cell" title="${title || 'Saldo estimado — sem lançamento no período esperado'}">
      <i class="ti ti-alert-triangle" style="font-size:11px;margin-right:3px;opacity:.9"></i>${fmtKg(value)}
      <span class="estimated-badge">Est.</span>
    </span>`;

  // Helper: célula vazia (não aplicável)
  const emptyCell = () => `<span class="td-mono" style="color:var(--text3)">—</span>`;

  // Helper: célula AUSENTE com tooltip mostrando lançamentos mais próximos
  const absentSaldoCell = (nearest) => {
    const beforeTxt = nearest?.before
      ? `Último antes do período: ${nearest.before.dtLabel} — ${fmtKg(nearest.before.value)}`
      : `Último antes do período: não encontrado`;
    const afterTxt = nearest?.after
      ? `Primeiro no período: ${nearest.after.dtLabel} — ${fmtKg(nearest.after.value)}`
      : `Primeiro no período: não encontrado`;
    const tooltip = `${beforeTxt}|${afterTxt}`;
    return `<span class='absent-badge' data-absent-tooltip='${tooltip}' style='cursor:help'>AUSENTE</span>`;
  };

  const saldoCell = (value, isEstimated, realTitle, estTitle) => {
    if (value === null || value === undefined) return emptyCell();
    return isEstimated ? estimatedSaldoCell(value, estTitle) : realSaldoCell(value, realTitle);
  };

  // Var. Acumulada: soma contínua do diff de todos os dias (incluindo semanais não-terça).
  let _accum = 0;
  const dayAccum = payload.days.map(day => {
    _accum += (day.diff ?? 0);
    return _accum;
  });

  const rows = payload.days.map((day, _di) => {
    const accumVal = dayAccum[_di];
    const accumCls = accumVal === null ? '' : varClass(accumVal);
    const accumCell = accumVal === null
      ? `<span class="td-mono" style="color:var(--text3)">—</span>`
      : `<span class="td-mono ${accumCls}" style="white-space:nowrap">${varSymbol(accumVal)} ${fmtKg(Math.abs(accumVal))}</span>`;

    // Dias não-terça de agregados: fundo apagado (opacity reduzida) para focar o analista
    // nas terças que são os dias de conferência real. Exibe SAP + variação/acumulada normalmente.
    if (day.isSemanalNaoConferencia) {
      const temSap = day.totalEnt !== 0 || day.totalSai !== 0;
      const dClsSem = varClass(day.diff);
      const varCellSem = `<span class="td-mono ${dClsSem}" style="white-space:nowrap">${varSymbol(day.diff)} ${fmtKg(Math.abs(day.diff))}</span>`;
      return `
        <tr class="row-sem-conferencia" data-no-lanc="1">
          <td class="day-col" style="color:var(--text3)">${escapeHtml(day.dateLabel)}</td>
          <td>${emptyCell()}</td>
          <td>${saldoCell(day.initialStock, day.initialIsEstimated, 'Est. Inicial', 'Est. Inicial estimado')}</td>
          <td data-col="ent">${temSap ? buildAnaliticoDetailBreakdown(day.entEntries, day.totalEnt, 'var(--green)', 'Entradas') : emptyCell()}</td>
          <td data-col="sai">${temSap ? buildAnaliticoDetailBreakdown(day.saiEntries, day.totalSai, 'var(--red)', 'Saídas') : emptyCell()}</td>
          <td>${saldoCell(day.finalStock, day.finalIsEstimated, 'Est. Final', 'Est. Final estimado')}</td>
          <td><span class="td-mono" style="color:var(--purple)">${fmtKg(day.theoreticalStock ?? 0)}</span></td>
          <td>${varCellSem}</td>
          <td>${accumCell}</td>
        </tr>`;
    }

    const dCls = varClass(day.diff);

    // Linha sem lançamento quando era esperado → fundo âmbar suave
    // Terça de agregado → fundo sutil indicando dia de conferência
    const rowClasses = [];
    if (!day.hasLanc && day.precisaLanc) rowClasses.push('row-no-lanc');
    if (day.isTercaConferencia) rowClasses.push('row-terca-conferencia');
    const rowStyle = rowClasses.length ? ` class="${rowClasses.join(' ')}"` : '';
    // data-no-lanc marks rows that have no launch (hidden when filter is active)
    const noLancAttr = (!day.hasLanc) ? ' data-no-lanc="1"' : '';

    // iniCell: AUSENTE (com tooltip) apenas no primeiro dia sem carry; estimado nos demais
    const iniCell = (day.initialStock === null || day.initialStock === undefined)
      ? absentSaldoCell(payload.summary.absentNearest)
      : saldoCell(
          day.initialStock,
          day.initialIsEstimated,
          'Est. Inicial — saldo real do último lançamento anterior',
          'Est. Inicial estimado — herdado do Est. Teórico anterior (sem lançamento real)'
        );

    const realCell = saldoCell(
      day.finalStock,
      day.finalIsEstimated,
      'Est. Final — confirmado por lançamento',
      'Est. Final estimado — sem lançamento nesta data'
    );

    const varCell = (day.diff === null)
      ? emptyCell()
      : `<span class="td-mono ${dCls}" style="white-space:nowrap">${varSymbol(day.diff)} ${fmtKg(Math.abs(day.diff))}</span>`;

    const lancCell = day.hasLanc
      ? (day.hasConflict
          ? `<button class="lanc-conflict-badge"
              onclick="event.stopPropagation(); openLancConflictModal(event.currentTarget)"
              data-lancs="${encodeURIComponent(JSON.stringify(day.lancamentos))}"
              data-date="${escapeHtml(day.dateLabel)}"
              data-detail-key="${escapeHtml(payload.key)}"
              title="Múltiplos lançamentos no mesmo dia — clique para resolver">
              <i class="ti ti-alert-triangle"></i>
              ${day.lancCount} lançamentos
            </button>`
          : `<span class="lanc-count-badge">${day.lancCount} lançamento${day.lancCount !== 1 ? 's' : ''}</span>`)
      : (day.precisaLanc
          ? `<span class="lanc-missing-badge"><i class="ti ti-alert-circle"></i> Sem lançamento</span>`
          : emptyCell());

    const teoCell = (day.theoreticalStock === null)
      ? emptyCell()
      : `<span class="td-mono" style="color:var(--purple)">${fmtKg(day.theoreticalStock)}</span>`;

    return `
      <tr${rowStyle}${noLancAttr}>
        <td class="day-col">${escapeHtml(day.dateLabel)}</td>
        <td>${lancCell}</td>
        <td>${iniCell}</td>
        <td data-col="ent">${buildAnaliticoDetailBreakdown(day.entEntries, day.totalEnt, 'var(--green)', 'Entradas')}</td>
        <td data-col="sai">${buildAnaliticoDetailBreakdown(day.saiEntries, day.totalSai, 'var(--red)', 'Saídas')}</td>
        <td>${realCell}</td>
        <td>${teoCell}</td>
        <td>${varCell}</td>
        <td>${accumCell}</td>
      </tr>`;
  }).join('');

  // Legenda: só aparece se houver algum dia estimado no período
  const temEstimado = payload.days.some(d => d.initialIsEstimated || d.finalIsEstimated);
  const legendaHtml = temEstimado ? `
    <div class="estimated-legend">
      <i class="ti ti-alert-triangle"></i>
      <span>Saldos marcados com <strong>Est.</strong> são estimados — não houve lançamento real nesta data. O sistema utilizou o Est. Teórico do período anterior como base.</span>
    </div>` : '';

  return `
    <div class="analitico-detail-summary">
      <div class="analitico-detail-card${s.pesoIniAusente ? ' detail-card-absent' : ''}">
        <div class="analitico-detail-card-label">Est. Inicial${s.pesoIniAusente ? ` ${absentSaldoCell(s.absentNearest)}` : ''}</div>
        <div class="analitico-detail-card-value ${s.pesoIniAusente ? 'c-absent' : 'c-teal'}">${s.pesoIniAusente ? '—' : fmtKg(s.pesoIni)}</div>
        <div class="analitico-detail-card-sub">${escapeHtml(s.dtIniLabel)}</div>
      </div>
      <div class="analitico-detail-card">
        <div class="analitico-detail-card-label">Entradas SAP</div>
        <div class="analitico-detail-card-value c-green">${fmtKg(s.totalEnt)}</div>
        <div class="analitico-detail-card-sub">${escapeHtml(s.entLabel)}</div>
      </div>
      <div class="analitico-detail-card">
        <div class="analitico-detail-card-label">Saídas SAP</div>
        <div class="analitico-detail-card-value c-red">${fmtKg(s.totalSai)}</div>
        <div class="analitico-detail-card-sub">${escapeHtml(s.saiLabel)}</div>
      </div>
      <div class="analitico-detail-card${s.pesoFimAusente ? ' detail-card-absent' : ''}">
        <div class="analitico-detail-card-label">Est. Final${
          s.pesoFimAusente
            ? ' <span class="absent-badge" title="Sem lançamento no período">ausente</span>'
            : (s.fimFallback ? ' <span class="absent-badge" style="background:var(--amber-bg);color:var(--amber);border-color:var(--amber-border)" title="Lançamento mais recente encontrado no período — não é o último dia">retroativo</span>' : '')
        }</div>
        <div class="analitico-detail-card-value ${s.pesoFimAusente ? 'c-absent' : 'c-teal'}">${s.pesoFimAusente ? '—' : fmtKg(s.pesoFim)}</div>
        <div class="analitico-detail-card-sub">${escapeHtml(s.dtFimLabel)}</div>
      </div>
      <div class="analitico-detail-card">
        <div class="analitico-detail-card-label">Est. Teórico</div>
        <div class="analitico-detail-card-value c-blue">${fmtKg(s.estTeorico)}</div>
        <div class="analitico-detail-card-sub">Ini + Entradas + Saídas</div>
      </div>
      <div class="analitico-detail-card">
        <div class="analitico-detail-card-label">Variação</div>
        <div class="analitico-detail-card-value ${varClass(s.diff)}">${varSymbol(s.diff)} ${fmtKg(Math.abs(s.diff))}</div>
        <div class="analitico-detail-card-sub">Últ. lançamento − Teórico total</div>
      </div>
    </div>

    ${legendaHtml}

    <div class="analitico-detail-table-toolbar">
      <button class="btn btn-sm detail-filter-btn" id="detail-filter-btn-${payload.key}" onclick="toggleDetailFilter(this)" data-active="0">
        <i class="ti ti-eye-off"></i>
        <span>Ocultar dias sem dados</span>
      </button>
    </div>

    <div class="analitico-detail-table-shell">
      <table class="analitico-detail-table" id="detail-table-${payload.key}">
        <thead>
          <tr>
            <th>Data</th>
            <th>Lançamentos</th>
            <th>Est. Inicial<br><span style="font-size:9px;font-weight:400;opacity:.7">(Saldo Anterior)</span></th>
            <th>Entradas<br><span style="font-size:9px;font-weight:400;opacity:.7">(por código)</span></th>
            <th>Saídas<br><span style="font-size:9px;font-weight:400;opacity:.7">(por código)</span></th>
            <th>Est. Final<br><span style="font-size:9px;font-weight:400;opacity:.7">(Últ. Lançamento)</span></th>
            <th>Est. Teórico<br><span style="font-size:9px;font-weight:400;opacity:.7">(Ini+Ent+Sai)</span></th>
            <th>Variação<br><span style="font-size:9px;font-weight:400;opacity:.7">(Real − Teórico)</span></th>
            <th>Var. Acumulada<br><span style="font-size:9px;font-weight:400;opacity:.7">(Σ diffs diários)</span></th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="9"><div class="analitico-detail-empty"><i class="ti ti-calendar-off"></i> Sem dados para o período.</div></td></tr>'}
        </tbody>
      </table>
    </div>`;
}

function toggleDetailFilter(btn) {
  const active = btn.dataset.active === '1';
  const newActive = !active;
  btn.dataset.active = newActive ? '1' : '0';

  const body = btn.closest('.analitico-detail-body') || document.getElementById('analitico-detail-body');
  if (!body) return;

  const allRows = Array.from(body.querySelectorAll('tbody tr'));

  if (newActive) {
    // ── OCULTAR: acumula entradas/saídas dos dias ocultos no próximo visível ──
    let pendingEntEnt = [];   // entries de entrada acumuladas
    let pendingEntSai = [];   // entries de saída acumuladas
    let pendingTotalEnt = 0;
    let pendingTotalSai = 0;

    allRows.forEach(tr => {
      const isHidden = tr.dataset.noLanc === '1';

      if (isHidden) {
        // Coleta entradas/saídas usando data-col para seleção robusta
        const entTd = tr.querySelector('td[data-col="ent"]');
        const saiTd = tr.querySelector('td[data-col="sai"]');
        const entBtn = entTd?.querySelector('.bdm-trigger');
        const saiBtn = saiTd?.querySelector('.bdm-trigger');
        if (entBtn) {
          try {
            const e = JSON.parse(decodeURIComponent(entBtn.dataset.entries || '[]'));
            pendingEntEnt.push(...e);
            pendingTotalEnt += e.reduce((s, [,v]) => s + v, 0);
          } catch(_) {}
        }
        if (saiBtn) {
          try {
            const e = JSON.parse(decodeURIComponent(saiBtn.dataset.entries || '[]'));
            pendingEntSai.push(...e);
            pendingTotalSai += e.reduce((s, [,v]) => s + v, 0);
          } catch(_) {}
        }
        tr.style.display = 'none';

      } else if (pendingEntEnt.length || pendingEntSai.length || pendingTotalEnt || pendingTotalSai) {
        // Primeiro dia visível após dias ocultos: mescla os pendentes

        const _mergeTd = (col, pendingEntries, pendingTotal, color, title) => {
          if (!pendingEntries.length && !pendingTotal) return;
          const td = tr.querySelector(`td[data-col="${col}"]`);
          if (!td) return;
          const existing = td.querySelector('.bdm-trigger');
          if (existing) {
            // Mescla nos dados existentes
            existing.dataset.origEntries = existing.dataset.entries;
            existing.dataset.origTotal   = existing.querySelector('.bdm-total')?.textContent || '';
            existing.dataset.origTitle   = existing.dataset.title || '';
            let existingEntries = [];
            try { existingEntries = JSON.parse(decodeURIComponent(existing.dataset.entries || '[]')); } catch(_) {}
            const merged      = [...pendingEntries, ...existingEntries];
            const mergedTotal = pendingTotal + existingEntries.reduce((s, [,v]) => s + v, 0);
            existing.dataset.entries = encodeURIComponent(JSON.stringify(merged));
            existing.dataset.title   = title;   // atualiza título para refletir consolidação
            existing.dataset.merged  = '1';
            existing.classList.add('merged-from-hidden');  // borda tracejada
            const totalEl = existing.querySelector('.bdm-total');
            if (totalEl) totalEl.textContent = fmtKg(mergedTotal);
          } else {
            // Cria botão novo onde havia —
            const enc = encodeURIComponent(JSON.stringify(pendingEntries));
            td.dataset.origHtml = td.innerHTML;
            td.innerHTML = `<button class="bdm-trigger merged-from-hidden" style="color:${color}"
              onclick="event.stopPropagation();openBreakdownModal(event.currentTarget)"
              data-entries="${enc}" data-title="${title}"
              data-color="${color}" data-merged="1"
              title="Acumulado dos dias anteriores ocultos">
              <span class="bdm-total">${fmtKg(pendingTotal)}</span>
              <i class="ti ti-table-options bdm-icon"></i>
              <i class="ti ti-layers" style="font-size:9px;opacity:.65;margin-left:3px"></i>
            </button>`;
          }
        };

        _mergeTd('ent', pendingEntEnt, pendingTotalEnt, 'var(--green)', 'Entradas (+ dias anteriores)');
        _mergeTd('sai', pendingEntSai, pendingTotalSai, 'var(--red)',   'Saídas (+ dias anteriores)');

        // Reset pending
        pendingEntEnt = []; pendingEntSai = [];
        pendingTotalEnt = 0; pendingTotalSai = 0;
      }
    });

    btn.innerHTML = '<i class="ti ti-eye"></i><span>Mostrar todos os dias</span>';
    btn.classList.add('btn-active');

  } else {
    // ── MOSTRAR: restaura tudo ao estado original ────────────────────
    allRows.forEach(tr => {
      tr.style.display = '';
      // Restaura botões mesclados
      tr.querySelectorAll('.bdm-trigger[data-merged="1"]').forEach(b => {
        if (b.dataset.origEntries !== undefined) {
          b.dataset.entries = b.dataset.origEntries;
          if (b.dataset.origTotal && b.querySelector('.bdm-total')) {
            b.querySelector('.bdm-total').textContent = b.dataset.origTotal;
          }
          b.classList.remove('merged-from-hidden');
          if (b.dataset.origTitle !== undefined) b.dataset.title = b.dataset.origTitle;
          delete b.dataset.merged;
          delete b.dataset.origEntries;
          delete b.dataset.origTotal;
          delete b.dataset.origTitle;
        }
      });
      // Restaura células que tiveram HTML substituído
      [tr.cells[3], tr.cells[4]].forEach(td => {
        if (td?.dataset.origHtml !== undefined) {
          td.innerHTML = td.dataset.origHtml;
          delete td.dataset.origHtml;
        }
      });
    });

    btn.innerHTML = '<i class="ti ti-eye-off"></i><span>Ocultar dias sem dados</span>';
    btn.classList.remove('btn-active');
  }
}
window.toggleDetailFilter = toggleDetailFilter;

// Tooltip flutuante para badges AUSENTE
function initAbsentTooltips(container) {
  let tip = document.getElementById('absent-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'absent-tip';
    tip.style.cssText = [
      'position:fixed',
      'z-index:99999',
      'background:var(--bg2,#1e2130)',
      'border:1px solid var(--border,#2e3347)',
      'border-radius:6px',
      'padding:8px 12px',
      'font-size:12px',
      'color:var(--text,#e2e8f0)',
      'line-height:1.6',
      'pointer-events:none',
      'white-space:pre',
      'box-shadow:0 4px 16px rgba(0,0,0,.4)',
      'display:none',
      'max-width:320px',
    ].join(';');
    document.body.appendChild(tip);
  }

  container.querySelectorAll('[data-absent-tooltip]').forEach(el => {
    el.addEventListener('mouseenter', e => {
      tip.textContent = el.dataset.absentTooltip.split('|').join('\n');
      tip.style.display = 'block';
      positionAbsentTip(tip, e);
    });
    el.addEventListener('mousemove', e => positionAbsentTip(tip, e));
    el.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  });
}

function positionAbsentTip(tip, e) {
  const margin = 12;
  let x = e.clientX + margin;
  let y = e.clientY + margin;
  const tw = tip.offsetWidth  || 260;
  const th = tip.offsetHeight || 48;
  if (x + tw > window.innerWidth  - 8) x = e.clientX - tw - margin;
  if (y + th > window.innerHeight - 8) y = e.clientY - th - margin;
  tip.style.left = x + 'px';
  tip.style.top  = y + 'px';
}

function openAnaliticoDetailModal(detailKey) {
  const payload = window.__analiticoDetailCache?.get(String(detailKey));
  if (!payload) {
    toast('Detalhamento não encontrado.', 'error');
    return;
  }

  const overlay = document.getElementById('analitico-detail-overlay');
  const title = document.getElementById('analitico-detail-title');
  const sub = document.getElementById('analitico-detail-sub');
  const body = document.getElementById('analitico-detail-body');
  const fullBtn = document.getElementById('analitico-detail-fullscreen-btn');
  if (!overlay || !title || !sub || !body || !fullBtn) return;

  analiticoDetailState.key = String(detailKey);
  analiticoDetailState.fullscreen = false;
  overlay.classList.remove('is-fullscreen');
  title.textContent = `${payload.material}`;
  sub.textContent = `${payload.central} · ${payload.periodLabel}`;
  body.innerHTML = buildAnaliticoDetailHtml(payload);
  if (typeof initHelpBadges === 'function') initHelpBadges();
  initAbsentTooltips(body);
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('analitico-modal-open');
  fullBtn.innerHTML = '<i class="ti ti-maximize"></i> <span>Expandir</span>';
}

function closeAnaliticoDetailModal() {
  const overlay = document.getElementById('analitico-detail-overlay');
  if (!overlay) return;
  overlay.classList.remove('open', 'is-fullscreen');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('analitico-modal-open');
  analiticoDetailState.key = null;
  analiticoDetailState.fullscreen = false;
}

function toggleAnaliticoDetailFullscreen() {
  const overlay = document.getElementById('analitico-detail-overlay');
  const fullBtn = document.getElementById('analitico-detail-fullscreen-btn');
  if (!overlay || !fullBtn) return;

  analiticoDetailState.fullscreen = !analiticoDetailState.fullscreen;
  overlay.classList.toggle('is-fullscreen', analiticoDetailState.fullscreen);
  fullBtn.innerHTML = analiticoDetailState.fullscreen
    ? '<i class="ti ti-minimize"></i> <span>Recolher</span>'
    : '<i class="ti ti-maximize"></i> <span>Expandir</span>';
}

// Close popover on outside click
document.addEventListener('mousedown', e => {
  if (_cfPopover && !_cfPopover.contains(e.target)) {
    closeColFilterPopover();
  }
});

// Close popover on scroll OUTSIDE it (not inside .cf-list)
document.addEventListener('scroll', e => {
  if (!_cfPopover) return;
  if (_cfPopover.contains(e.target)) return;   // scrolling inside popover — keep open
  closeColFilterPopover();
}, true);

// ── Patch getFilteredData to also apply colFilters ─────────
// We wrap the existing logic: after the text-search filter,
// also run recordPassesColFilters.
const _origGetFilteredData = getFilteredData;
// (We redefine getFilteredData below after reading it)

// ── Keep old filtrar* functions as stubs (called from window.assign) ──────
function filtrarTabela(tbodyId, value) {
  const module = moduleMap[tbodyId];
  if (!module) return;
  // Atualiza o filtro imediatamente para manter estado correto,
  // mas só dispara o render após o debounce.
  filters[module] = String(value || '').toLowerCase().trim();
  pages[module] = 0;
  debouncedFilter(module, value, () => renderModule(module));
}

function filtrarProducao(value) {
  filtroProducao = String(value || '').trim();
  currentPageProducao = 0;
  debouncedFilter('producao', value, () => renderProducao());
}

function filtrarLista(scope, value) {
  if (!(scope in listFilters)) return;
  listFilters[scope] = String(value || '').trim();
  listPages[scope] = 0;
  debouncedFilter(scope, value, () => renderScope(scope));
}

// ═══════════════════════════════════════════════════════════
// ÍNDICE DE LANÇAMENTOS E SAP POR CENTRAL+MATERIAL
// ═══════════════════════════════════════════════════════════
// Problema original: getPrePeriodLaunchStock e o loop do analítico
// fazem .filter() linear sobre state.lancamentos e state.sap a cada
// chamada — O(n) por material × central. Com 1M de registros isso é
// dezenas de segundos de processamento.
//
// Solução: mantemos dois índices Map-of-Map que agrupam os registros
// por central → material e os ordenam por data de forma lazy.
// O índice é invalidado sempre que os arrays mudam (após import/remoção).
//
// Chave composta: `central\x00material` para evitar colisões.

let _lancIndexBuilt = false;
let _sapIndexBuilt  = false;

// Map<central, Map<material, Record[]>> — ordenado por dtLanc ASC
const _lancByCentralMat = new Map();
// Map<central, Map<material, Record[]>>
const _sapByCentralMat  = new Map();
// Map<central, Record[]> — todos os lançamentos da central (qualquer material), ASC
const _lancByCentral    = new Map();
// Map<central, Record[]> — todos os SAP da central
const _sapByCentral     = new Map();

function _buildLancIndex() {
  _lancByCentralMat.clear();
  _lancByCentral.clear();
  const recs = state.lancamentos;
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    const c = r.central || '';
    const m = r.material || '—';
    if (!_lancByCentralMat.has(c)) _lancByCentralMat.set(c, new Map());
    const matMap = _lancByCentralMat.get(c);
    if (!matMap.has(m)) matMap.set(m, []);
    matMap.get(m).push(r);
    if (!_lancByCentral.has(c)) _lancByCentral.set(c, []);
    _lancByCentral.get(c).push(r);
  }
  // Ordena cada bucket por data ASC (necessário para getPrePeriodLaunchStock)
  _lancByCentralMat.forEach(matMap => {
    matMap.forEach((arr, mat) => {
      arr.sort((a, b) => {
        const da = parseDate(a.dtLanc), db = parseDate(b.dtLanc);
        return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
      });
    });
  });
  _lancByCentral.forEach(arr => {
    arr.sort((a, b) => {
      const da = parseDate(a.dtLanc), db = parseDate(b.dtLanc);
      return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
    });
  });
  _lancIndexBuilt = true;
}

function _buildSapIndex() {
  _sapByCentralMat.clear();
  _sapByCentral.clear();
  const recs = state.sap;
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    const c = r.central || '';
    const m = r.material || '—';
    if (!_sapByCentralMat.has(c)) _sapByCentralMat.set(c, new Map());
    const matMap = _sapByCentralMat.get(c);
    if (!matMap.has(m)) matMap.set(m, []);
    matMap.get(m).push(r);
    if (!_sapByCentral.has(c)) _sapByCentral.set(c, []);
    _sapByCentral.get(c).push(r);
  }
  _sapIndexBuilt = true;
}

function invalidateLancIndex() {
  _lancIndexBuilt = false;
  _lancByCentralMat.clear();
  _lancByCentral.clear();
  invalidateSearchIndex('lancamentos');
  if (typeof _ausInvalidateCache === 'function') _ausInvalidateCache();
}

function invalidateSapIndex() {
  _sapIndexBuilt = false;
  _sapByCentralMat.clear();
  _sapByCentral.clear();
  _invalidateSapDupCache();        // invalida cache de duplicatas
  invalidateSearchIndex('sap');
  if (typeof _ausInvalidateCache === 'function') _ausInvalidateCache();
}

// Índice simples de saídas por central (não precisa de material nem data pré-ordenada)
const _saidasByCentral = new Map();
let _saidasIndexBuilt = false;

function _buildSaidasIndex() {
  _saidasByCentral.clear();
  const recs = state.saidas;
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    const c = r.central || '';
    if (!_saidasByCentral.has(c)) _saidasByCentral.set(c, []);
    _saidasByCentral.get(c).push(r);
  }
  _saidasIndexBuilt = true;
}

function invalidateSaidasIndex() {
  _saidasIndexBuilt = false;
  _saidasByCentral.clear();
  invalidateSearchIndex('saidas');
}

function ensureSaidasIndex() {
  if (!_saidasIndexBuilt) _buildSaidasIndex();
}

function getLancIndex() {
  if (!_lancIndexBuilt) _buildLancIndex();
  return { byCentralMat: _lancByCentralMat, byCentral: _lancByCentral };
}

function getSapIndex() {
  if (!_sapIndexBuilt) _buildSapIndex();
  return { byCentralMat: _sapByCentralMat, byCentral: _sapByCentral };
}




// Retorna todos os lançamentos de uma central dentro de um período.
function getLancsByCentralInPeriod(central, dtIni, dtFim) {
  const { byCentral } = getLancIndex();
  const arr = byCentral.get(central) || [];
  if (!dtIni && !dtFim) return arr;
  return arr.filter(r => {
    const d = parseDate(r.dtLanc);
    if (!d) return false;
    if (dtIni && d < dtIni) return false;
    if (dtFim && d > dtFim) return false;
    return true;
  });
}

// Retorna todos os SAP de uma central dentro de um período.
function getSapByCentralInPeriod(central, dtIni, dtFim) {
  const { byCentral } = getSapIndex();
  const arr = byCentral.get(central) || [];
  if (!dtIni && !dtFim) return arr;
  return arr.filter(r => {
    const d = parseDate(r.dtLanc);
    if (!d) return false;
    if (dtIni && d < dtIni) return false;
    if (dtFim && d > dtFim) return false;
    return true;
  });
}

// ═══════════════════════════════════════════════════════════
// SAÚDE DA CENTRAL
// ═══════════════════════════════════════════════════════════

const HEALTH_DEFAULTS = {
  aglomerante: { bom: 5000,  atencao: 10000, urgente: 15000 },
  agregado:    { bom: 30000, atencao: 45000, urgente: 60000 },
  aditivo:     { bom: 120,   atencao: 250,   urgente: 350   },
  adicao:      { bom: 30,    atencao: 60,    urgente: 90    }
};

// Detect category from categoria field
function detectCatKey(categoria) {
  const c = String(categoria || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
  if (/AGLOMERANTE/.test(c) || /CIMENTO/.test(c) || /POZOLANA/.test(c)) return 'aglomerante';
  if (/AGREGA/.test(c)) return 'agregado';
  if (/ADITIV/.test(c)) return 'aditivo';
  if (/ADIC[AÃ]O/.test(c) || /ADICAO/.test(c) || /ADIC/.test(c)) return 'adicao';
  // fallback: try material name heuristics handled at call site
  return null;
}

function detectCatFromMat(matName) {
  const m = String(matName || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
  if (/CIMENTO|POZOLANA|ESCORIA|CALCARIO/.test(m)) return 'aglomerante';
  if (/BRITA|AREIA|AGREGAD|PEDRISCO|PEDRA/.test(m)) return 'agregado';
  if (/ADITIV|PLASTIF|SUPERPLAST|INCORPOR|POLIFUNC|ESTABILIZ|RETARD|ACELER/.test(m)) return 'aditivo';
  if (/ADIC[AO]|CINZA|SILICA|METACAOLIN/.test(m)) return 'adicao';
  return 'aglomerante'; // safe fallback
}

// Retorna subcategoria de agregado para distinguir miúdo de graúdo.
// Usa o campo rawCat dos dados (ex: "AGREGADO MIUDO", "AGREGADO GRAUDO")
// e como fallback o nome do material (BRITA/BICA = graúdo, AREIA = miúdo).
function detectCatSubKey(rawCat, matName) {
  const c = String(rawCat || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
  const m = String(matName || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
  // Só aplica distinção se for agregado
  if (!/AGREGA/.test(c) && !/BRITA|BICA|AREIA|PEDRISCO|PEDRA/.test(m)) return null;
  // Graúdo: rawCat contém GRAUD ou material é BRITA/BICA/PEDRISCO/PEDRA
  if (/GRAUD/.test(c) || /BRITA|BICA|PEDRISCO|PEDRA(?!ISCA)/.test(m)) return 'agregado_graudo';
  // Miúdo: rawCat contém MIUD ou material é AREIA
  if (/MIUD/.test(c) || /AREIA/.test(m)) return 'agregado_miudo';
  // Agregado sem distinção clara — retorna null (não participa do match fino)
  return null;
}

function getHealthThresholds() {
  const t = JSON.parse(JSON.stringify(HEALTH_DEFAULTS));
  const cfgKey = key => (state.configs.find(c => normalizeText(c.key) === normalizeText(key)) || {}).value;
  const cats = ['aglomerante','agregado','aditivo','adicao'];
  const levels = ['bom','atencao','urgente'];
  cats.forEach(cat => {
    levels.forEach(lvl => {
      const v = parseFloat(cfgKey(`saude_${cat}_${lvl}`));
      if (Number.isFinite(v) && v > 0) t[cat][lvl] = v;
    });
  });
  return t;
}

function classifyVariation(absVal, catKey, thresholds) {
  const t = thresholds[catKey] || thresholds.aglomerante;
  if (absVal <= t.bom)     return 'bom';
  if (absVal <= t.atencao) return 'atencao';
  if (absVal <= t.urgente) return 'urgente';
  return 'critico';
}

// Penalty weights per level
const HEALTH_PENALTIES = { bom: 0, atencao: 1, urgente: 3, critico: 6 };

function calcHealthScore(matDiffs, lancsByMat, sapByMat, thresholds) {
  // matDiffs: array of { mat, diff, categoria }
  const nonNeutral = matDiffs.filter(m => Math.abs(m.diff) > 0.0001);
  if (!nonNeutral.length) return { score: 100, level: 'ok', counts: { bom:0, atencao:0, urgente:0, critico:0, neutro: matDiffs.length } };

  let totalPenalty = 0;
  const counts = { bom:0, atencao:0, urgente:0, critico:0, neutro: matDiffs.length - nonNeutral.length };

  nonNeutral.forEach(m => {
    const catKey = m.catKey;
    const lvl = classifyVariation(Math.abs(m.diff), catKey, thresholds);
    counts[lvl]++;
    totalPenalty += HEALTH_PENALTIES[lvl];
  });

  // Max possible penalty = all critico
  const maxPenalty = nonNeutral.length * HEALTH_PENALTIES.critico;
  const score = maxPenalty === 0 ? 100 : Math.max(0, Math.round((1 - totalPenalty / maxPenalty) * 100));

  let level;
  if (score >= 80)      level = 'ok';
  else if (score >= 55) level = 'atencao';
  else if (score >= 30) level = 'urgente';
  else                  level = 'critico';

  return { score, level, counts };
}


// ── EST. INICIAL: busca o lançamento mais adequado para usar como estoque inicial.
//
// Regra:
//   1. Dia-alvo = último dia do mês anterior a dtIni.
//      Se domingo → recua para sábado.
//   2. Se houver lançamento no dia-alvo → retorna esse valor.
//   3. Se não houver → busca dentro do período (dtIni a dtFim) o lançamento
//      mais ANTIGO (menor data = primeiro registro real disponível).
//   4. Se não encontrar em nenhum dos dois → retorna null.
// Retorna os dois lançamentos mais próximos do início do período quando o Est. Inicial é AUSENTE:
// - before: lançamento mais recente ANTES do dtIni (mês anterior)
// - after:  lançamento mais antigo DENTRO do período (mês atual)
// Usado para exibir tooltip informativo no badge AUSENTE.
function getNearestLancsForAbsent({ central, material, dtIni, dtFim }) {
  const materialKey = material || '—';
  const { byCentralMat } = getLancIndex();
  const arr = byCentralMat.get(central)?.get(materialKey) || [];
  const dtIniDate = dtIni instanceof Date ? dtIni : new Date(dtIni);
  const dtFimDate = dtFim instanceof Date ? dtFim : new Date(dtFim);
  const dtIniISO = localISODate(dtIniDate);
  const dtFimISO = localISODate(dtFimDate);

  let before = null;
  let after  = null;

  const byDay = new Map();
  for (const rec of arr) {
    const d = parseDate(rec.dtLanc);
    if (!d) continue;
    const iso = localISODate(d);
    if (!byDay.has(iso)) byDay.set(iso, { total: 0, date: d });
    byDay.get(iso).total += num(rec.peso);
  }

  let bestBeforeISO = null;
  let bestAfterISO  = null;
  for (const [iso] of byDay) {
    if (iso < dtIniISO) {
      if (!bestBeforeISO || iso > bestBeforeISO) bestBeforeISO = iso;
    } else if (iso >= dtIniISO && iso <= dtFimISO) {
      if (!bestAfterISO || iso < bestAfterISO) bestAfterISO = iso;
    }
  }

  if (bestBeforeISO) {
    const e = byDay.get(bestBeforeISO);
    before = { value: e.total, dtLabel: fmtPtDate(e.date) };
  }
  if (bestAfterISO) {
    const e = byDay.get(bestAfterISO);
    after = { value: e.total, dtLabel: fmtPtDate(e.date) };
  }

  return { before, after };
}

// Busca o lançamento para o carry inicial da TABELA DE DIAS.
// Regra:
//   - 1º do mês → lançamento no último dia do mês anterior (recuando domingo → sábado)
//   - Outro dia  → lançamento mais recente estritamente ANTES de dtIni
// Retorna null se não encontrado.
function getPrevDayLaunchStock({ central, material, dtIni, catKey }) {
  const dtIniDate = dtIni instanceof Date ? new Date(dtIni) : new Date(dtIni);
  if (isNaN(dtIniDate)) return null;

  const materialKey = material || '—';
  const { byCentralMat } = getLancIndex();
  const arr = byCentralMat.get(central)?.get(materialKey) || [];
  if (!arr.length) return null;

  const isAgregado = catKey === 'agregado' || catKey === 'agregado_graudo' || catKey === 'agregado_miudo';
  const isPrimeiroDiaMes = dtIniDate.getDate() === 1;
  const dtIniISO = localISODate(dtIniDate);

  // Helper: busca total de lançamentos em uma data ISO exata
  const findByISO = (iso) => {
    let total = 0, found = false;
    for (const rec of arr) {
      const d = parseDate(rec.dtLanc);
      if (!d) continue;
      if (localISODate(d) === iso) { total += num(rec.peso); found = true; }
    }
    return found ? total : null;
  };

  if (isAgregado) {
    // Agregados: lançamentos ocorrem nas terças-feiras.
    // 1. Encontra a última terça-feira antes de dtIni
    // 2. Se houver lançamento em dia posterior à terça e anterior a dtIni, usa esse
    // 3. Senão usa o da terça; se não houver → AUSENTE
    const lastTerca = new Date(dtIniDate);
    lastTerca.setHours(0, 0, 0, 0);
    // Recua até encontrar uma terça (getDay() === 2)
    do { lastTerca.setDate(lastTerca.getDate() - 1); } while (lastTerca.getDay() !== 2);
    const lastTercaISO = localISODate(lastTerca);

    // Busca lançamento mais recente entre lastTerca+1 e dtIni-1
    let bestPost = null, bestPostISO = null;
    for (const rec of arr) {
      const d = parseDate(rec.dtLanc);
      if (!d) continue;
      const iso = localISODate(d);
      if (iso > lastTercaISO && iso < dtIniISO) {
        if (!bestPostISO || iso > bestPostISO) { bestPostISO = iso; bestPost = d; }
      }
    }
    if (bestPostISO) {
      const total = findByISO(bestPostISO);
      if (total !== null) return { value: total, dtLabel: fmtPtDate(bestPost), date: bestPost };
    }

    // Usa lançamento da última terça
    const tercaTotal = findByISO(lastTercaISO);
    if (tercaTotal !== null) return { value: tercaTotal, dtLabel: fmtPtDate(lastTerca), date: lastTerca };
    return null;

  } else if (isPrimeiroDiaMes) {
    // 1º do mês: busca exata no último dia do mês anterior (recuando domingo → sábado)
    const targetDate = new Date(dtIniDate.getFullYear(), dtIniDate.getMonth(), 0);
    targetDate.setHours(0, 0, 0, 0);
    if (targetDate.getDay() === 0) targetDate.setDate(targetDate.getDate() - 1);
    const total = findByISO(localISODate(targetDate));
    if (total !== null) return { value: total, dtLabel: fmtPtDate(targetDate), date: targetDate };
    return null;

  } else {
    // Outro dia: dia anterior; se domingo → sábado
    const targetDate = new Date(dtIniDate);
    targetDate.setDate(targetDate.getDate() - 1);
    targetDate.setHours(0, 0, 0, 0);
    if (targetDate.getDay() === 0) targetDate.setDate(targetDate.getDate() - 1);
    const total = findByISO(localISODate(targetDate));
    if (total !== null) return { value: total, dtLabel: fmtPtDate(targetDate), date: targetDate };
    return null;
  }
}

// getPrePeriodLaunchStock: mesma lógica de getPrevDayLaunchStock
// Ambos usam a mesma regra — mantido por compatibilidade com chamadas existentes.
function getPrePeriodLaunchStock({ central, material, dtIni, dtFim }) {
  return getPrevDayLaunchStock({ central, material, dtIni });
}

// ── EST. FINAL: soma todos os lançamentos do último dia não-domingo do período.
//    Retorna { value, dtLabel, missing } onde missing=true indica dado ausente.
// Variante com fallback retroativo: se o último dia não-domingo não tiver
// lançamento, recua dia a dia dentro do período até encontrar um.
// Retorna missing:false com o valor e a data real encontrada.
// Usado na visão micro do Analítico (EST. FINAL).
function getLastPeriodLaunchStockWithFallback({ central, material, dtIni, dtFim }) {
  const dtFimDate = dtFim instanceof Date ? dtFim : new Date(dtFim);
  const dtIniDate = dtIni instanceof Date ? dtIni : new Date(dtIni);
  if (isNaN(dtFimDate) || isNaN(dtIniDate)) return null;

  const materialKey = material || '—';
  const { byCentralMat } = getLancIndex();
  const arr = byCentralMat.get(central)?.get(materialKey) || [];
  if (!arr.length) return { value: null, dtLabel: '—', missing: true };

  // Monta lookup de data→peso para O(1) por dia
  const byDay = new Map();
  arr.forEach(rec => {
    const d = parseDate(rec.dtLanc);
    if (!d) return;
    const k = localISODate(d);
    byDay.set(k, (byDay.get(k) || 0) + num(rec.peso));
  });

  // Último dia útil esperado: último não-domingo do período
  // (mesmo critério de getLastPeriodLaunchStock)
  const expectedDate = new Date(dtFimDate);
  expectedDate.setHours(0, 0, 0, 0);
  while (expectedDate.getDay() === 0) {
    expectedDate.setDate(expectedDate.getDate() - 1);
  }
  const expectedISO = localISODate(expectedDate);

  // Retroage do dia esperado até o início, pulando domingos
  const cursor = new Date(expectedDate);
  const floor  = new Date(dtIniDate);
  floor.setHours(0, 0, 0, 0);

  while (cursor >= floor) {
    if (cursor.getDay() !== 0) { // ignora domingo
      const k = localISODate(cursor);
      if (byDay.has(k)) {
        return {
          value:    byDay.get(k),
          dtLabel:  fmtPtDate(cursor),
          missing:  false,
          fallback: k !== expectedISO  // âmbar só se anterior ao dia útil esperado
        };
      }
    }
    cursor.setDate(cursor.getDate() - 1);
  }

  // Nenhum lançamento no período inteiro
  return { value: null, dtLabel: '—', missing: true };
}

function getLastPeriodLaunchStock({ central, material, dtFim }) {
  const dtFimDate = dtFim instanceof Date ? dtFim : new Date(dtFim);
  if (!(dtFimDate instanceof Date) || Number.isNaN(dtFimDate.getTime())) return null;

  // Último dia não-domingo do período
  const targetDate = new Date(dtFimDate);
  // Volta até achar um não-domingo (máx 1 dia — só pula domingo)
  while (targetDate.getDay() === 0) {
    targetDate.setDate(targetDate.getDate() - 1);
  }
  const targetISO = localISODate(targetDate);

  const materialKey = material || '—';
  const { byCentralMat } = getLancIndex();
  const matMap = byCentralMat.get(central);
  if (!matMap) return { value: 0, dtLabel: fmtPtDate(targetDate), missing: true };
  const arr = matMap.get(materialKey) || [];
  if (!arr.length) return { value: 0, dtLabel: fmtPtDate(targetDate), missing: true };

  let total = 0;
  let found = false;
  for (const rec of arr) {
    const d = parseDate(rec.dtLanc);
    if (!d) continue;
    if (localISODate(d) === targetISO) {
      total += num(rec.peso);
      found = true;
    }
  }

  if (!found) return { value: 0, dtLabel: fmtPtDate(targetDate), missing: true };

  return { value: total, dtLabel: fmtPtDate(targetDate), missing: false };
}

// ── buildSnapshot: moved to module scope so buildHealthPanel and
//    renderAnaliticoMicro can both use it ────────────────────────────────
function buildSnapshot({ lancs, sap, initialStockOverride = null, initialDateLabelOverride = null, finalStockOverride = undefined, finalDateLabelOverride = null }) {
    const lancsOrdenados = [...lancs].sort((a, b) => {
      const da = parseDate(a.dtLanc), db = parseDate(b.dtLanc);
      return dateCmp(da ?? new Date(0), db ?? new Date(0));
    });

    const lancIni = lancsOrdenados[0];
    const lancFim = lancsOrdenados[lancsOrdenados.length - 1];

    // Agrupa lançamentos por data para somar corretamente múltiplos no mesmo dia
    const _dtKey = (rec) => {
      const d = parseDate(rec.dtLanc);
      return d ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : null;
    };
    const _dtIniKey = lancIni ? _dtKey(lancIni) : null;
    const _dtFimKey = lancFim ? _dtKey(lancFim) : null;

    // EST. INICIAL: usa o valor do dia anterior ao período (via getPrePeriodLaunchStock).
    // Se não encontrado → 0 kg, sem fallback. Ausência será indicada na UI.
    const pesoIni = Number.isFinite(initialStockOverride) ? num(initialStockOverride) : 0;
    const pesoIniAusente = !Number.isFinite(initialStockOverride);

    // EST. FINAL: usa finalStockOverride quando fornecido (via getLastPeriodLaunchStock).
    // Se não fornecido, calcula a partir dos lancs (comportamento legado para snaps diários).
    // Se finalStockOverride === null explicitamente → ausente (0 kg, sem data).
    let pesoFim = 0;
    let pesoFimAusente = false;
    if (finalStockOverride !== undefined) {
      // Caller forneceu valor explícito (pode ser null = ausente, ou número)
      pesoFim = Number.isFinite(finalStockOverride) ? num(finalStockOverride) : 0;
      pesoFimAusente = !Number.isFinite(finalStockOverride);
    } else {
      // Fallback legado: último dia não-domingo nos lancs passados
      const seen = new Set();
      let targetFimKey = null;
      for (let i = lancsOrdenados.length - 1; i >= 0; i--) {
        const d = parseDate(lancsOrdenados[i].dtLanc);
        if (!d) continue;
        const dk = _dtKey(lancsOrdenados[i]);
        if (!seen.has(dk)) {
          seen.add(dk);
          if (d.getDay() !== 0) {
            targetFimKey = dk;
            break;
          }
        }
      }
      if (targetFimKey) {
        pesoFim = lancsOrdenados
          .filter(l => _dtKey(l) === targetFimKey)
          .reduce((acc, l) => acc + num(l.peso), 0);
      }
    }

    const entCods = {};
    const saiCods = {};
    const entRefs = {};
    const saiRefs = {};
    sap.forEach(s => {
      const cod = normMov(s.movimento);
      const p = num(s.peso);
      const refVal = (s.ref && String(s.ref).trim()) ? String(s.ref).trim()
                   : (s.documento && String(s.documento).trim()) ? String(s.documento).trim()
                   : '';
      if (p > 0) {
        entCods[cod] = (entCods[cod] || 0) + p;
        if (refVal) {
          if (!entRefs[cod]) entRefs[cod] = new Set();
          entRefs[cod].add(refVal);
        }
      } else if (p < 0) {
        saiCods[cod] = (saiCods[cod] || 0) + p;
        if (refVal) {
          if (!saiRefs[cod]) saiRefs[cod] = new Set();
          saiRefs[cod].add(refVal);
        }
      }
    });

    const totalEnt = Object.values(entCods).reduce((a, b) => a + b, 0);
    const totalSai = Object.values(saiCods).reduce((a, b) => a + b, 0);
    const estTeorico = pesoIni + totalEnt + totalSai;
    const diff = pesoFim - estTeorico;

    const entRecords = sap.filter(s => num(s.peso) > 0).sort((a, b) => num(b.peso) - num(a.peso));
    const saiRecords = sap.filter(s => num(s.peso) < 0).sort((a, b) => num(a.peso) - num(b.peso));

    return {
      lancIni, lancFim, pesoIni, pesoFim,
      entCods, saiCods, entRefs, saiRefs,
      entRecords, saiRecords,
      totalEnt, totalSai, estTeorico, diff,
      dtIniLabel: pesoIniAusente ? '—' : (initialDateLabelOverride || (lancIni?.dtLanc ? fmtPtDate(parseDate(lancIni.dtLanc) || new Date(lancIni.dtLanc)) : '—')),
      pesoIniAusente,
      dtFimLabel: pesoFimAusente ? '—' : (finalDateLabelOverride || (lancFim?.dtLanc ? fmtPtDate(parseDate(lancFim.dtLanc) || new Date(lancFim.dtLanc)) : '—')),
      pesoFimAusente
    };
}

function buildHealthPanel(central, dtIni, allMatsSorted, lancsByMat, sapByMat, categoriaByMat, dtFim) {
  const thresholds = getHealthThresholds();

  const prePeriodStockCache = new Map();
  const getPrePeriodStock = (mat) => {
    if (prePeriodStockCache.has(mat)) return prePeriodStockCache.get(mat);
    const stock = getPrePeriodLaunchStock({ central, material: mat, dtIni, dtFim });
    prePeriodStockCache.set(mat, stock);
    return stock;
  };

  const matDiffs = allMatsSorted.map(mat => {
    const prev = getPrePeriodStock(mat);
    const fim  = dtFim
      ? getLastPeriodLaunchStockWithFallback({ central, material: mat, dtIni, dtFim })
      : null;
    const snap = buildSnapshot({
      lancs: lancsByMat.get(mat) || [],
      sap: sapByMat.get(mat) || [],
      initialStockOverride:     prev?.value   ?? null,
      initialDateLabelOverride: prev?.dtLabel ?? null,
      finalStockOverride:       fim && !fim.missing ? fim.value   : null,
      finalDateLabelOverride:   fim && !fim.missing ? fim.dtLabel : null
    });
    const rawCat = categoriaByMat.get(mat) || '';
    const catKey = detectCatKey(rawCat) || detectCatFromMat(mat);
    return { mat, diff: snap.diff, catKey };
  });

  const { score, level, counts } = calcHealthScore(matDiffs, lancsByMat, sapByMat, thresholds);

  const levelLabel = { ok: 'SAUDÁVEL', atencao: 'ATENÇÃO', urgente: 'URGENTE', critico: 'CRÍTICO' };
  const levelCls   = { ok: 'hs-ok', atencao: 'hs-atencao', urgente: 'hs-urgente', critico: 'hs-critico' };

  // Top worst materials (non-neutral, sorted by |diff| desc)
  const nonNeutral = matDiffs.filter(m => Math.abs(m.diff) > 0.0001);
  const sorted = [...nonNeutral].sort((a,b) => Math.abs(b.diff) - Math.abs(a.diff));
  const top3 = sorted.slice(0, 3);

  const badgeStyle = {
    bom:     'background:var(--green-bg);color:var(--green);border:1px solid var(--green-border)',
    atencao: 'background:var(--amber-bg);color:var(--amber);border:1px solid var(--amber-border)',
    urgente: 'background:rgba(249,115,22,0.10);color:#f97316;border:1px solid rgba(249,115,22,0.22)',
    critico: 'background:var(--red-bg);color:var(--red);border:1px solid var(--red-border)'
  };

  const worstRows = top3.map(m => {
    const lvl = classifyVariation(Math.abs(m.diff), m.catKey, thresholds);
    const lvlLabel = { bom:'BOM', atencao:'ATENÇÃO', urgente:'URGENTE', critico:'CRÍTICO' }[lvl];
    const valCls = m.diff < 0 ? 'neg' : 'pos';
    return `<div class="health-worst-row">
      <span class="health-worst-mat" title="${escapeHtml(m.mat)}">${escapeHtml(m.mat)}</span>
      <span class="health-worst-val ${valCls}" style="color:${m.diff < 0 ? 'var(--red)' : 'var(--green)'}">${varSymbol(m.diff)} ${fmtKg(Math.abs(m.diff))}</span>
      <span class="health-worst-badge" style="${badgeStyle[lvl]};border-radius:4px;padding:1px 6px;font-size:9px;font-weight:700;font-family:var(--mono)">${lvlLabel}</span>
    </div>`;
  }).join('');

  return `
    <div class="health-panel">
      <div class="health-top">
        <span class="health-title"><i class="ti ti-heartbeat"></i> Saúde da Central</span>
        <div class="health-score-wrap">
          <div class="health-bar-wrap" style="width:120px">
            <div class="health-bar-fill ${levelCls[level]}" style="width:${score}%"></div>
          </div>
          <span class="health-score-value ${levelCls[level]}">${score}%</span>
          <span style="font-size:10px;font-family:var(--mono);font-weight:700;padding:2px 8px;border-radius:5px;${badgeStyle[level] || ''}">${levelLabel[level]}</span>
        </div>
      </div>
      <div class="health-stats-row">
        <div class="health-stat hs-bom"><i class="ti ti-circle-check"></i><span class="hs-n">${counts.bom}</span><span>bom</span></div>
        <div class="health-stat hs-atencao-chip"><i class="ti ti-alert-triangle"></i><span class="hs-n">${counts.atencao}</span><span>atenção</span></div>
        <div class="health-stat hs-urgente-chip"><i class="ti ti-alert-circle"></i><span class="hs-n">${counts.urgente}</span><span>urgente</span></div>
        <div class="health-stat hs-critico-chip"><i class="ti ti-flame"></i><span class="hs-n">${counts.critico}</span><span>crítico</span></div>
        <div class="health-stat hs-neutro"><i class="ti ti-equal"></i><span class="hs-n">${counts.neutro}</span><span>neutro</span></div>
        ${top3.length ? `
        <div class="health-worst" style="flex:1;min-width:220px">
          <div class="health-worst-title"><i class="ti ti-sort-descending" style="font-size:10px;margin-right:3px"></i>Maiores variações</div>
          ${worstRows}
        </div>` : ''}
      </div>
    </div>`;
}

function salvarHealthConfig() {
  const cats = ['aglomerante','agregado','aditivo','adicao'];
  const levels = ['bom','atencao','urgente'];
  const catLabels = { aglomerante:'Aglomerantes', agregado:'Agregados', aditivo:'Aditivos', adicao:'Adições' };
  const lvlLabels = { bom:'BOM', atencao:'ATENÇÃO', urgente:'URGENTE' };
  let saved = 0;
  cats.forEach(cat => {
    levels.forEach(lvl => {
      const input = document.getElementById(`hcfg-${cat}-${lvl}`);
      if (!input) return;
      const v = input.value.trim();
      if (!v) return;
      const n = parseFloat(v);
      if (!Number.isFinite(n) || n <= 0) return;
      const key = `saude_${cat}_${lvl}`;
      const desc = `Limite ${lvlLabels[lvl]} para ${catLabels[cat]}`;
      const existing = state.configs.findIndex(c => normalizeText(c.key) === normalizeText(key));
      const rec = { key, value: String(n), desc, created: new Date().toLocaleDateString('pt-BR') };
      if (existing >= 0) state.configs[existing] = rec; else state.configs.unshift(rec);
      saved++;
    });
  });
  persistStateNow();
  renderConfigs();
  updateImportPrereqUI();
  toast(saved > 0 ? `${saved} limite(s) salvo(s)` : 'Nenhum valor preenchido', saved > 0 ? 'success' : 'error');
}

function loadHealthConfigInputs() {
  const cats = ['aglomerante','agregado','aditivo','adicao'];
  const levels = ['bom','atencao','urgente'];
  cats.forEach(cat => {
    levels.forEach(lvl => {
      const input = document.getElementById(`hcfg-${cat}-${lvl}`);
      if (!input) return;
      const cfg = state.configs.find(c => normalizeText(c.key) === normalizeText(`saude_${cat}_${lvl}`));
      if (cfg) input.value = cfg.value;
    });
  });
}

Object.assign(window, { salvarHealthConfig, loadHealthConfigInputs });

// ══════════════════════════════════════════════════════════════════════════════
// BACKUP / RESTAURAR POR MÓDULOS
// ══════════════════════════════════════════════════════════════════════════════

const _BKP_MODULES = [
  { key: 'entradas',    label: 'Entradas (NF)',        icon: 'ti-package-import',  color: 'var(--green)'  },
  { key: 'saidas',      label: 'Saídas (OS)',           icon: 'ti-package-export',  color: 'var(--red)'    },
  { key: 'lancamentos', label: 'Lançamentos',           icon: 'ti-clipboard-list',  color: 'var(--teal)'   },
  { key: 'sap',         label: 'SAP',                   icon: 'ti-database',        color: 'var(--purple)' },
  { key: 'producao',    label: 'Produção',              icon: 'ti-building-factory',color: 'var(--amber)'  },
  { key: 'filiais',     label: 'Filiais / Centrais',   icon: 'ti-building',        color: 'var(--accent)' },
  { key: 'materiais',   label: 'Materiais',             icon: 'ti-box',             color: 'var(--blue)'   },
  { key: 'configs',     label: 'Configurações',         icon: 'ti-settings',        color: 'var(--text2)'  },
  { key: 'ocorrencias', label: 'Ocorrências',           icon: 'ti-alert-circle',    color: 'var(--red)'    },
  { key: 'imports',     label: 'Histórico de Importações', icon: 'ti-history',     color: 'var(--text3)'  },
];

// Módulos selecionados para exportar (persiste durante a sessão do modal)
let _bkpSelected = new Set(_BKP_MODULES.map(m => m.key));
let _bkpMode = 'exportar'; // 'exportar' | 'restaurar'
let _bkpParsedFile = null; // arquivo carregado para restaurar

function abrirModalBackup(modo) {
  _bkpMode = modo || 'exportar';
  _bkpParsedFile = null;
  _renderBkpModuleList();
  bkpSwitchTab(_bkpMode);
  document.getElementById('bkp-preview').style.display = 'none';
  openModal('modal-backup');
}

function bkpSwitchTab(modo) {
  _bkpMode = modo;
  const isExportar = modo === 'exportar';

  document.getElementById('bkp-panel-exportar').style.display = isExportar ? '' : 'none';
  document.getElementById('bkp-panel-restaurar').style.display = isExportar ? 'none' : '';

  const btnExp = document.getElementById('bkp-tab-exportar');
  const btnRes = document.getElementById('bkp-tab-restaurar');
  if (btnExp) btnExp.classList.toggle('btn-primary', isExportar);
  if (btnRes) btnRes.classList.toggle('btn-primary', !isExportar);

  const iconEl  = document.getElementById('bkp-btn-icon');
  const labelEl = document.getElementById('bkp-btn-label');
  if (iconEl)  iconEl.className = 'ti ' + (isExportar ? 'ti-download' : 'ti-database-import');
  if (labelEl) labelEl.textContent = isExportar ? 'Exportar selecionados' : 'Restaurar selecionados';

  const subEl = document.getElementById('bkp-modal-sub');
  if (subEl) subEl.textContent = isExportar
    ? 'Selecione os módulos para exportar'
    : 'Carregue um arquivo e escolha o que restaurar';
}

function _renderBkpModuleList() {
  const container = document.getElementById('bkp-module-list');
  if (!container) return;

  container.innerHTML = _BKP_MODULES.map(m => {
    const count = (state[m.key] || []).length;
    const checked = _bkpSelected.has(m.key);
    return `
      <label style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--surface2);
        border-radius:8px;cursor:pointer;border:1.5px solid ${checked ? 'var(--accent)' : 'transparent'};
        transition:border-color .15s" id="bkp-row-${m.key}">
        <input type="checkbox" ${checked ? 'checked' : ''} style="display:none"
          id="bkp-chk-${m.key}" onchange="bkpToggleModule('${m.key}')">
        <span style="width:30px;height:30px;border-radius:7px;display:flex;align-items:center;justify-content:center;
          background:color-mix(in srgb, ${m.color} 15%, transparent);color:${m.color};font-size:15px;flex-shrink:0">
          <i class="ti ${m.icon}"></i>
        </span>
        <span style="flex:1;font-size:13px;font-weight:500;color:var(--text1)">${m.label}</span>
        <span style="font-size:11px;font-family:var(--mono);color:var(--text3);background:var(--surface3);
          padding:2px 7px;border-radius:5px">${count.toLocaleString('pt-BR')} reg.</span>
        <i class="ti ${checked ? 'ti-square-check-filled' : 'ti-square'}" style="color:${checked ? 'var(--accent)' : 'var(--text3)'}"></i>
      </label>`;
  }).join('');
}

function bkpToggleModule(key) {
  if (_bkpSelected.has(key)) {
    _bkpSelected.delete(key);
  } else {
    _bkpSelected.add(key);
  }
  // Re-render somente a linha alterada para melhor performance
  const row = document.getElementById('bkp-row-' + key);
  const mod = _BKP_MODULES.find(m => m.key === key);
  if (row && mod) {
    const checked = _bkpSelected.has(key);
    row.style.borderColor = checked ? 'var(--accent)' : 'transparent';
    const icon = row.querySelector('.ti-square-check-filled, .ti-square');
    if (icon) { icon.className = 'ti ' + (checked ? 'ti-square-check-filled' : 'ti-square'); icon.style.color = checked ? 'var(--accent)' : 'var(--text3)'; }
  }
}

function bkpSelectAll(select) {
  _BKP_MODULES.forEach(m => {
    const chk = document.getElementById('bkp-chk-' + m.key);
    if (chk) chk.checked = select;
    if (select) _bkpSelected.add(m.key); else _bkpSelected.delete(m.key);
  });
  _renderBkpModuleList();
}

function bkpConfirmar() {
  if (_bkpMode === 'exportar') {
    _exportarModulos();
  } else {
    _restaurarModulosConfirmar();
  }
}

// ── EXPORTAR ─────────────────────────────────────────────────────────────────

function _exportarModulos() {
  if (_bkpSelected.size === 0) {
    toast('Selecione ao menos um módulo para exportar', 'error');
    return;
  }

  try {
    const now   = new Date();
    const stamp = localISODate(now) + '_'
      + String(now.getHours()).padStart(2,'0')
      + String(now.getMinutes()).padStart(2,'0');

    const lsGet = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch(e) { return null; } };

    // Metadados do arquivo
    const selectedKeys = [..._bkpSelected];
    const header = {
      _version:    'analyticsys_backup_v3',
      _exportedAt: now.toLocaleString('pt-BR'),
      _modules:    selectedKeys,
      _counts:     {},
    };
    selectedKeys.forEach(k => { header._counts[k] = (state[k] || []).length; });

    // Inclui dados auxiliares sempre
    header._notas      = lsGet('analyticsys_notes_v2');
    header._atalhos    = lsGet('analyticsys_shortcuts_v1');
    header._fechamento = lsGet('analyticsys_fech_v1');

    // Constrói JSON em partes (evita limite de string)
    const parts = [];
    parts.push(JSON.stringify(header).slice(0, -1)); // remove }

    for (const key of selectedKeys) {
      const arr = state[key] || [];
      parts.push(',"' + key + '":');
      if (arr.length === 0) {
        parts.push('[]');
      } else {
        parts.push('[');
        const CHUNK = 5000;
        for (let i = 0; i < arr.length; i += CHUNK) {
          const slice = arr.slice(i, i + CHUNK);
          if (i > 0) parts.push(',');
          parts.push(JSON.stringify(slice).slice(1, -1));
        }
        parts.push(']');
      }
    }

    parts.push('}');

    const blob = new Blob(parts, { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    // Se exportação parcial, inclui nomes dos módulos no nome do arquivo
    const suffix = selectedKeys.length === _BKP_MODULES.length
      ? 'completo'
      : selectedKeys.join('-');
    a.download = `analyticsys_backup_${suffix}_${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);

    closeModal('modal-backup');
    const total = selectedKeys.reduce((s, k) => s + (state[k] || []).length, 0);
    toast(`Backup exportado — ${selectedKeys.length} módulo(s), ${total.toLocaleString('pt-BR')} registros`);
  } catch(err) {
    console.error('Erro ao exportar backup:', err);
    toast('Erro ao gerar backup: ' + err.message, 'error');
  }
}

// ── RESTAURAR ────────────────────────────────────────────────────────────────

function bkpHandleDrop(event) {
  const file = event.dataTransfer?.files?.[0];
  if (file) _bkpCarregarArquivo(file);
}

function restaurarBackupModular(file) {
  if (!file) return;
  const modal = document.getElementById('modal-backup');
  if (!modal || !modal.classList.contains('open')) {
    abrirModalBackup('restaurar');
    setTimeout(() => _bkpCarregarArquivo(file), 100);
  } else {
    _bkpCarregarArquivo(file);
  }
}

function _bkpCarregarArquivo(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const parsed = JSON.parse(e.target.result);

      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        toast('Arquivo inválido — não é um backup AnalyticSys', 'error');
        return;
      }

      // Detecta módulos disponíveis no arquivo
      const available = _BKP_MODULES.filter(m => Array.isArray(parsed[m.key]));
      if (available.length === 0) {
        toast('Arquivo não contém dados reconhecíveis', 'error');
        return;
      }

      _bkpParsedFile = parsed;

      // Garante que o modal está no modo restaurar
      if (_bkpMode !== 'restaurar') bkpSwitchTab('restaurar');

      // Renderiza preview com checkboxes dos módulos disponíveis
      const previewEl = document.getElementById('bkp-preview');
      const listEl    = document.getElementById('bkp-preview-list');
      if (!previewEl || !listEl) return;

      const expAt = parsed._exportedAt ? `Exportado em: ${parsed._exportedAt}` : '';
      const version = parsed._version || 'v1';

      listEl.innerHTML = `
        <div style="padding:8px 12px;background:var(--surface3);border-radius:8px;font-size:11px;
          color:var(--text3);display:flex;gap:16px;flex-wrap:wrap;margin-bottom:4px">
          <span><i class="ti ti-tag" style="margin-right:3px"></i>${version}</span>
          ${expAt ? `<span><i class="ti ti-clock" style="margin-right:3px"></i>${expAt}</span>` : ''}
          <span><i class="ti ti-database" style="margin-right:3px"></i>${available.length} módulo(s) no arquivo</span>
        </div>
        ${available.map(m => {
          const count = parsed[m.key].length;
          const atualCount = (state[m.key] || []).length;
          return `
          <label style="display:flex;align-items:center;gap:10px;padding:7px 12px;background:var(--surface2);
            border-radius:8px;cursor:pointer;border:1.5px solid var(--accent);transition:border-color .15s"
            id="bkp-rst-row-${m.key}">
            <input type="checkbox" checked style="display:none"
              id="bkp-rst-chk-${m.key}" onchange="bkpToggleRestoreModule('${m.key}')">
            <span style="width:28px;height:28px;border-radius:7px;display:flex;align-items:center;justify-content:center;
              background:color-mix(in srgb, ${m.color} 15%, transparent);color:${m.color};font-size:14px;flex-shrink:0">
              <i class="ti ${m.icon}"></i>
            </span>
            <span style="flex:1">
              <span style="font-size:13px;font-weight:500;color:var(--text1);display:block">${m.label}</span>
              <span style="font-size:10px;color:var(--text3);font-family:var(--mono)">
                ${count.toLocaleString('pt-BR')} no backup
                ${atualCount > 0 ? ` · ${atualCount.toLocaleString('pt-BR')} atuais serão substituídos` : '· (módulo vazio)'}
              </span>
            </span>
            <i class="ti ti-square-check-filled" style="color:var(--accent)" id="bkp-rst-icon-${m.key}"></i>
          </label>`;
        }).join('')}
      `;

      previewEl.style.display = '';

    } catch(err) {
      console.error(err);
      toast('Falha ao ler o arquivo: JSON inválido ou corrompido', 'error');
    }
  };
  reader.onerror = () => toast('Não foi possível ler o arquivo', 'error');
  reader.readAsText(file, 'utf-8');
}

function bkpToggleRestoreModule(key) {
  const chk  = document.getElementById('bkp-rst-chk-' + key);
  const row  = document.getElementById('bkp-rst-row-' + key);
  const icon = document.getElementById('bkp-rst-icon-' + key);
  if (!chk) return;
  const checked = chk.checked;
  if (row)  row.style.borderColor  = checked ? 'var(--accent)' : 'transparent';
  if (icon) { icon.className = 'ti ' + (checked ? 'ti-square-check-filled' : 'ti-square'); icon.style.color = checked ? 'var(--accent)' : 'var(--text3)'; }
}

async function _restaurarModulosConfirmar() {
  if (!_bkpParsedFile) {
    toast('Nenhum arquivo carregado. Selecione um backup primeiro.', 'error');
    return;
  }

  const parsed = _bkpParsedFile;

  // Coleta módulos marcados para restaurar
  const toRestore = _BKP_MODULES.filter(m => {
    const chk = document.getElementById('bkp-rst-chk-' + m.key);
    return chk && chk.checked && Array.isArray(parsed[m.key]);
  });

  if (toRestore.length === 0) {
    toast('Selecione ao menos um módulo para restaurar', 'error');
    return;
  }

  const totalNovo   = toRestore.reduce((s, m) => s + parsed[m.key].length, 0);
  const totalAtual  = toRestore.reduce((s, m) => s + (state[m.key] || []).length, 0);
  const moduloNomes = toRestore.map(m => m.label).join(', ');

  const msg = totalAtual > 0
    ? `Restaurar ${toRestore.length} módulo(s): ${moduloNomes}?\n\nIsso substituirá ${totalAtual.toLocaleString('pt-BR')} registros atuais por ${totalNovo.toLocaleString('pt-BR')} do backup. Esta ação não pode ser desfeita.`
    : `Restaurar ${toRestore.length} módulo(s): ${moduloNomes}?\n\n${totalNovo.toLocaleString('pt-BR')} registros serão carregados.`;

  if (!confirm(msg)) return;

  closeModal('modal-backup');

  showLoadingOverlay('Restaurando backup', 'Carregando dados do arquivo...');
  if (typeof loadingShowSteps === 'function') loadingShowSteps([
    { id: 'bkp-parse',   icon: 'ti-file-import',    label: 'Lendo arquivo de backup' },
    { id: 'bkp-restore', icon: 'ti-database-import', label: `Restaurando ${toRestore.length} módulo(s)` },
    { id: 'bkp-index',   icon: 'ti-list-search',     label: 'Reconstruindo índices' },
    { id: 'bkp-save',    icon: 'ti-device-floppy',   label: 'Salvando estado' },
    { id: 'bkp-render',  icon: 'ti-layout',          label: 'Atualizando interface' },
  ]);
  await nextFrame();

  try {
    _lstepSet('bkp-parse', 'done'); _lbarSet(20);

    // Restaura apenas os módulos selecionados
    _lstepSet('bkp-restore', 'running'); _lbarSet(35);
    toRestore.forEach(m => {
      state[m.key] = parsed[m.key];
    });

    // Restaura acoesRelatorio se presente no arquivo
    if (Array.isArray(parsed.acoesRelatorio)) {
      state.acoesRelatorio = parsed.acoesRelatorio;
    }
    _lstepSet('bkp-restore', 'done'); _lbarSet(50);

    // Reprocessa índices
    _lstepSet('bkp-index', 'running');
    invalidateMaterialLookup();
    invalidateFilialLookup();
    invalidateLancIndex();
    invalidateSapIndex();
    invalidateSaidasIndex();
    if (typeof invalidateAllSearchIndexes === 'function') invalidateAllSearchIndexes();
    if (typeof reaplicarPadronizacaoMateriais === 'function') reaplicarPadronizacaoMateriais();
    _lstepSet('bkp-index', 'done'); _lbarSet(70);

    // Restaura dados auxiliares do localStorage
    const lsSet = (key, val) => { try { if (val !== null && val !== undefined) localStorage.setItem(key, JSON.stringify(val)); } catch(e) {} };
    lsSet('analyticsys_notes_v2',     parsed._notas);
    lsSet('analyticsys_shortcuts_v1', parsed._atalhos);
    lsSet('analyticsys_fech_v1',      parsed._fechamento);

    _lstepSet('bkp-save', 'running'); _lbarSet(85);
    await persistStateNow();
    _lstepSet('bkp-save', 'done');

    _lstepSet('bkp-render', 'running'); _lbarSet(95);
    if (typeof renderAll === 'function') renderAll();
    if (typeof updateImportPrereqUI === 'function') updateImportPrereqUI();
    _lstepSet('bkp-render', 'done'); _lbarSet(100);

    const info = parsed._exportedAt ? ` (exportado em ${parsed._exportedAt})` : '';
    setTimeout(() => toast(`${toRestore.length} módulo(s) restaurado(s)${info} — ${totalNovo.toLocaleString('pt-BR')} registros`), 300);
    _bkpParsedFile = null;

  } catch (err) {
    console.error('[Backup] Erro durante a restauração:', err);
    setTimeout(() => toast('Erro durante a restauração. Os dados podem não ter sido salvos corretamente.', 'error'), 300);

  } finally {
    hideLoadingOverlay('Backup restaurado');
    if (typeof loadingHideSteps === 'function') loadingHideSteps();
  }
}

Object.assign(window, {
  abrirModalBackup, bkpSwitchTab, bkpToggleModule, bkpSelectAll, bkpConfirmar,
  bkpHandleDrop, restaurarBackupModular, bkpToggleRestoreModule,
  exportarDados: _exportarModulos // mantém compatibilidade com chamadas externas
});

  function makeResizable(table) {
  if (!table) return;
  const ths = table.querySelectorAll('thead th');
  ths.forEach(th => {
    if (th.querySelector('.col-resizer')) return;
    const resizer = document.createElement('div');
    resizer.className = 'col-resizer';
    th.appendChild(resizer);

    let startX, startW;
    resizer.addEventListener('mousedown', e => {
      startX = e.clientX;
      startW = th.offsetWidth;
      resizer.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      function onMove(ev) {
        const newW = Math.max(60, startW + (ev.clientX - startX));
        th.style.width = newW + 'px';
        th.style.minWidth = newW + 'px';
      }
      function onUp() {
        resizer.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
    });
  });
}

function initResizable() {
  qsa('.table-scroll table').forEach(makeResizable);
  qsa('.micro-table-wrap table').forEach(makeResizable);
}

function _importStatusBadge(r) {
  const s = r.status || 'Importado';
  const tip = r.statusTip ? ` title="${escapeHtml(r.statusTip)}"` : '';
  const cfg = {
    'Salvo':            { cls:'badge-green',  icon:'ti-circle-check',    label:'Salvo'           },
    'Importado':        { cls:'badge-green',  icon:'ti-circle-check',    label:'Importado'       },
    'Sem persistência': { cls:'badge-amber',  icon:'ti-alert-triangle',  label:'Sem persistência'},
    'Parcial':          { cls:'badge-teal',   icon:'ti-adjustments',     label:'Parcial'         },
    'Já existia':       { cls:'badge-teal',   icon:'ti-minus',           label:'Já existia'      },
    'Erro':             { cls:'badge-red',    icon:'ti-circle-x',        label:'Erro'            },
    'Processando':      { cls:'badge-purple', icon:'ti-loader',          label:'Processando'     },
    'Abortado':         { cls:'badge-red',    icon:'ti-player-stop',     label:'Abortado'        },
  };
  const c = cfg[s] || { cls:'badge-green', icon:'ti-circle-check', label: s };
  return `<span class="badge ${c.cls}"${tip} style="display:inline-flex;align-items:center;gap:4px;cursor:${r.statusTip?'help':'default'}">
    <i class="ti ${c.icon}" style="font-size:11px"></i>${c.label}
  </span>`;
}

function renderImports() {
  const tb = document.getElementById('tb-imports');
  if (!tb) return;

  const { data, pageData } = getListPageData('imports');
  updateListPageInfo('imports');

  if (!data.length) {
    tb.innerHTML = '<tr><td colspan="6"><div class="empty-state"><i class="ti ti-file-off"></i><p>Nenhum arquivo importado ainda.</p></div></td></tr>';
    return;
  }

  tb.innerHTML = pageData.map(r => `
      <tr>
        <td>${r.arquivo || '—'}</td>
        <td><span class="badge badge-purple">${r.modulo || '—'}</span></td>
        <td class="td-mono">
          ${r.registros ?? 0}
          ${r.totalArquivo && r.totalArquivo > r.registros
            ? `<span style="font-size:10px;color:var(--text3);font-family:var(--mono);margin-left:4px" title="Arquivo continha ${(r.totalArquivo).toLocaleString('pt-BR')} registros no total">(de ${(r.totalArquivo).toLocaleString('pt-BR')})</span>`
            : ''}
        </td>
        <td class="td-muted">${r.dataHora || '—'}</td>
        <td>${_importStatusBadge(r)}</td>
        <td style="width:56px">
          <button class="btn-icon danger" title="Excluir importação"
            onclick="excluirImportacao('${r.id}')">
            <i class="ti ti-trash"></i>
          </button>
        </td>
      </tr>
    `).join('');
  makeResizable(tb.closest('table'));
  injectColFilterButtons(tb.closest('table'), 'imports');
  updateImportPrereqUI();
}

// Sidebar expand/collapse via hover — controla classe .expanded
(function() {
  function initSidebarHover() {
    const sidebar = document.getElementById('main-sidebar');
    if (!sidebar) return;
    sidebar.addEventListener('mouseenter', function() {
      sidebar.classList.add('expanded');
    });
    sidebar.addEventListener('mouseleave', function() {
      sidebar.classList.remove('expanded');
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSidebarHover);
  } else {
    initSidebarHover();
  }
})();
