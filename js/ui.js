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
  // Inventário foi movido para uma "Visão" dentro do Dashboard Analítico
  // (alterna com a Visão Micro, compartilhando o mesmo período/toolbar).
  if (page === 'inventario') {
    navigate('analitico');
    setTimeout(() => { if (typeof anSwitchView === 'function') anSwitchView('inventario'); }, 50);
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

  // Os gráficos Chart.js do Dashboard Gerencial (Visão Geral) podem ter
  // sido pré-calculados pela carga automática do boot enquanto a página
  // ainda estava oculta (ver STEP 6.5 em restoreAndRender, dashboard.js).
  // Um canvas criado com container display:none nasce com dimensão zero,
  // então é preciso forçar um resize agora que a página está visível.
  // Idempotente e barato — seguro chamar em toda navegação para cá.
  if (page === 'dashboard' && typeof _dgResizeCharts === 'function') {
    requestAnimationFrame(() => _dgResizeCharts());
  }

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

// ── Cache de duplicatas — Lançamentos ─────────────────────────────────────
// Critério pedido: mesma central + mesma data (dtLanc) + mesmo material.
// Mais simples que o do SAP — lançamentos de saldo real são inserções
// diretas (não movimentações), então não existe conceito de estorno/anulação
// aqui: qualquer repetição da tripla é considerada duplicata.
let _lancDupCache = null;
let _lancDupCacheVersion = -1; // compara com state.lancamentos.length para invalidar

function _invalidateLancDupCache() {
  _lancDupCache = null;
  _lancDupCacheVersion = -1;
}

function getLancamentoRecordKey(r) {
  return [
    (r.central  || '').trim(),
    (r.dtLanc   || '').trim(),
    (r.material || r.materialOriginal || '').trim()
  ].join('||');
}
window.getLancamentoRecordKey = getLancamentoRecordKey;

function getLancamentoDuplicateKeys() {
  const currentVersion = (state.lancamentos || []).length;
  if (_lancDupCache && _lancDupCacheVersion === currentVersion) {
    return _lancDupCache;
  }

  const counts = {};
  (state.lancamentos || []).forEach(r => {
    counts[getLancamentoRecordKey(r)] = (counts[getLancamentoRecordKey(r)] || 0) + 1;
  });

  const dupKeys = new Set();
  Object.keys(counts).forEach(key => {
    if (counts[key] > 1) dupKeys.add(key);
  });

  _lancDupCache = dupKeys;
  _lancDupCacheVersion = currentVersion;
  return dupKeys;
}
window.getLancamentoDuplicateKeys = getLancamentoDuplicateKeys;

// ── Filtro "Somente duplicatas" — Lançamentos ─────────────────────────────
let _somenteDuplicatasLanc = false;

function toggleSomenteDuplicatasLanc() {
  _somenteDuplicatasLanc = !_somenteDuplicatasLanc;
  const btn = document.getElementById('btn-duplicatas-lancamentos');
  if (btn) {
    btn.classList.toggle('active', _somenteDuplicatasLanc);
    btn.title = _somenteDuplicatasLanc
      ? 'Exibindo somente duplicatas — clique para voltar'
      : 'Filtrar somente lançamentos duplicados (mesma central, data e material)';
  }
  renderLancamentos?.() || renderModule?.('lancamentos');
}
window.toggleSomenteDuplicatasLanc = toggleSomenteDuplicatasLanc;

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
  const textFiltered = _getModuleTextFilteredData(module);
  // Apply column filters
  let result;
  if (moduleHasColFilter(module)) {
    result = textFiltered.filter(r => recordPassesColFilters(module, r));
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
  } else {
    data = _getScopeTextFilteredData(scope);
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
  materiais:   { tbodyId: 'tb-materiais',   fields: ['origem','alias','categoria','created',null] },
};

// Returns true if a record passes ALL active column filters for a module
function recordPassesColFilters(module, record) {
  return recordPassesColFiltersExcept(module, record, null);
}

// Returns true if a record passes all active column filters for a module,
// exceto o da própria coluna informada em excludeColIdx (usado para montar
// as opções do dropdown daquela coluna sem que ela filtre a si mesma)
function recordPassesColFiltersExcept(module, record, excludeColIdx) {
  const cf = colFilters[module];
  if (!cf) return true;
  const meta = colFilterMeta[module];
  if (!meta) return true;
  for (const [colIdx, activeSet] of Object.entries(cf)) {
    if (excludeColIdx !== null && Number(colIdx) === Number(excludeColIdx)) continue;
    if (!activeSet || !activeSet.size) continue;
    const field = meta.fields[Number(colIdx)];
    if (!field) continue;
    const cellVal = normalizeText(String(record[field] ?? '—'));
    if (!activeSet.has(cellVal)) return false;
  }
  return true;
}

// Reaproveita a lógica de filtro de TEXTO/BUSCA (+ toggles "somente manuais"
// / "somente duplicatas") de getFilteredData, sem aplicar os colFilters —
// usado como base para montar as opções dos dropdowns de coluna, já que a
// regra é: se o registro nem passa no filtro de texto ativo, o valor dele
// não deve aparecer como opção em NENHUM dropdown.
function _getModuleTextFilteredData(module) {
  let data = state[module] || [];
  if (_somenteManuais[module]) data = data.filter(r => r.fonte === 'manual' || r.editado);
  if (module === 'sap' && _somenteDuplicatas) {
    const { cancelled, real } = getSapDuplicateKeys();
    data = data.filter(r => { const k = getSapRecordKey(r); return cancelled.has(k) || real.has(k); });
  }
  if (module === 'lancamentos' && _somenteDuplicatasLanc) {
    const dupKeys = getLancamentoDuplicateKeys();
    data = data.filter(r => dupKeys.has(getLancamentoRecordKey(r)));
  }
  const f = module === 'producao' ? filtroProducao : filters[module];
  return filterRecords(data, f, getSearchableFields(module), module);
}

// Mesma ideia de _getModuleTextFilteredData, mas para os "scopes" de lista
// (imports, configs, filiais, materiais), que usam listFilters em vez de
// filters/filtroProducao.
function _getScopeTextFilteredData(scope) {
  if (scope === 'imports') {
    return filterRecords(
      state.imports.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
      listFilters.imports,
      getSearchableFields('imports'),
      'imports'
    );
  }
  return filterRecords(state[scope] || [], listFilters[scope], getSearchableFields(scope), scope);
}

const _COLFILTER_LIST_SCOPES = ['imports', 'configs', 'filiais', 'materiais'];

// Collect unique display values for a column, considerando QUALQUER outro
// filtro já aplicado na tabela — texto/busca, "somente manuais", "somente
// duplicatas" e os demais dropdowns de coluna (exceto o da própria coluna).
// Regra: se um registro não passa em algum desses filtros, o valor dele não
// deve aparecer como opção em nenhum dropdown, mesmo que "exista" na base.
function getColUniqueValues(module, colIdx) {
  const meta = colFilterMeta[module];
  if (!meta) return [];
  const field = meta.fields[colIdx];
  if (!field) return [];

  const baseData = _COLFILTER_LIST_SCOPES.includes(module)
    ? _getScopeTextFilteredData(module)
    : _getModuleTextFilteredData(module);

  const data = baseData.filter(r => recordPassesColFiltersExcept(module, r, colIdx));

  const seen = new Set();
  for (let i = 0; i < data.length; i++) {
    seen.add(normalizeText(String(data[i][field] ?? '—')));
  }
  return [...seen].sort((a, b) => a.localeCompare(b, 'pt-BR'));
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

// ── Badge colorido por código de MOVIMENTO ───────────────────────────────
// Usado no modal "Movimentações SAP" (openBreakdownModal): cada código tem
// sempre a mesma cor em qualquer lugar do sistema, pra o usuário bater o
// olho e já reconhecer o código sem precisar ler o resumo toda vez.
// 101/801 (entrada) e 201 (saída) têm cor semântica fixa; qualquer outro
// código (estorno, ajuste, etc.) cai numa cor da paleta reserva, escolhida
// por hash do próprio código — sempre a mesma cor pro mesmo código.
const MOV_BADGE_CLASS = { '101': 'mv-badge-green', '801': 'mv-badge-teal', '201': 'mv-badge-red' };
const MOV_BADGE_FALLBACK_CLASSES = ['mv-badge-purple', 'mv-badge-amber'];
function movBadgeClass(cod) {
  const c = String(cod || '').trim();
  if (MOV_BADGE_CLASS[c]) return MOV_BADGE_CLASS[c];
  let h = 0;
  for (let i = 0; i < c.length; i++) h = (h * 31 + c.charCodeAt(i)) >>> 0;
  return MOV_BADGE_FALLBACK_CLASSES[h % MOV_BADGE_FALLBACK_CLASSES.length];
}
function movBadgeHtml(cod, size) {
  const sizeClass = size === 'sm' ? ' mv-badge-sm' : '';
  return `<span class="mv-badge ${movBadgeClass(cod)}${sizeClass}">${escapeHtml(cod || '—')}</span>`;
}
function movSummaryChipHtml(cod, count) {
  return `<span class="mv-badge mv-badge-chip ${movBadgeClass(cod)}">${escapeHtml(cod || '—')} <b>${count}</b></span>`;
}

const analiticoDetailState = {
  key: null,
  fullscreen: false
};

window.__analiticoDetailCache = new Map();

function buildAnaliticoDetailBreakdown(entries, total, colorVar, title, localCount = null, mat = '', central = '', fechExcluidos = []) {
  if (!entries.length && !(fechExcluidos && fechExcluidos.length)) {
    return `<span class="analitico-detail-empty">—</span>`;
  }

  // Serialise entries into a data attribute so the modal can read them on click
  const encoded = encodeURIComponent(JSON.stringify(entries));
  const encodedFech = (fechExcluidos && fechExcluidos.length)
    ? encodeURIComponent(JSON.stringify(fechExcluidos))
    : '';

  return `
    <button class="bdm-trigger" style="color:${colorVar}"
      onclick="event.stopPropagation(); openBreakdownModal(event.currentTarget)"
      data-entries="${encoded}"
      data-fech-excluidos="${encodedFech}"
      data-title="${escapeHtml(title)}"
      data-color="${escapeHtml(colorVar)}"
      data-local-count="${localCount === null ? '' : localCount}"
      data-mat="${escapeHtml(mat)}"
      data-central="${escapeHtml(central)}"
      title="Clique para ver detalhes">
      <span class="bdm-total">${fmtKg(total)}</span>
      <i class="ti ti-table-options bdm-icon"></i>
    </button>`;
}

// ── Breakdown Modal ─────────────────────────────────────────
// ── Transferência entre centros (861/862): índice de pares ──────────────
// 862 (saída no centro de compra) e 861 (entrada no centro destino) são
// gerados juntos pelo SAP, com a MESMA referência (a NF de transferência
// gerada pelo 862), mesmo usuário, mesma data de lançamento e mesmo peso —
// só mudam a central e o sinal do peso. Dado um registro 861 ou 862,
// localizamos o registro do código complementar com a mesma referência +
// material, pra exibir "qual é o movimento relacionado" na mesma linha do
// modal de Movimentações SAP.
//
// state.sap pode ter 600k+ registros (ver getSapDuplicateKeys) — nada de
// .find() linear a cada linha do modal. Constrói uma vez um Map de
// "código-alvo|material|referência" → central, com cache invalidado junto
// com o resto do índice SAP (invalidateSapIndex, abaixo).
let _transferPairCache = null;
let _transferPairCacheVersion = -1;

function _invalidateTransferPairCache() {
  _transferPairCache = null;
  _transferPairCacheVersion = -1;
}

function getTransferPairIndex() {
  const currentVersion = (state.sap || []).length;
  if (_transferPairCache && _transferPairCacheVersion === currentVersion) {
    return _transferPairCache;
  }
  const idx = new Map();
  (state.sap || []).forEach(s => {
    const cod = normMov(s.movimento);
    if (cod !== '861' && cod !== '862') return;
    const ref = (s.ref && String(s.ref).trim()) ? String(s.ref).trim() : String(s.documento || '').trim();
    if (!ref) return;
    const key = `${cod}|${s.material || ''}|${ref.toUpperCase()}`;
    // Referência de transferência é única — em tese só existe 1 registro
    // por chave. Mantém o primeiro em caso de dado inesperado.
    if (!idx.has(key)) idx.set(key, s.central || '—');
  });
  _transferPairCache = idx;
  _transferPairCacheVersion = currentVersion;
  return _transferPairCache;
}

/**
 * Dado um registro 861 ou 862 (código + referência + material), retorna o
 * código complementar e a central onde ele foi lançado — ou null se não
 * houver correspondência (dado incompleto/fora do que foi importado).
 */
function findTransferPairCentral(cod, ref, mat) {
  const targetCod = cod === '861' ? '862' : cod === '862' ? '861' : null;
  if (!targetCod || !ref) return null;
  const idx = getTransferPairIndex();
  const key = `${targetCod}|${mat || ''}|${String(ref).trim().toUpperCase()}`;
  const central = idx.get(key);
  return central ? { cod: targetCod, central } : null;
}

// ── Transferência entre materiais (309) ──────────────────────────────────
// Diferente do 861/862, os DOIS lados usam o MESMO código (309) — só o
// sinal do peso distingue quem é o material DE (saída, peso negativo) e
// quem é o PARA (entrada, peso positivo). Não há referência compartilhada
// pra usar como chave, então o par é localizado por: mesma central + mesmo
// depósito + mesmo usuário + TODAS as datas (documento, lançamento,
// registro) + mesmo |peso| — com sinal OPOSTO (o material, por definição,
// é diferente entre os dois lados, então nunca entra na chave de busca).
let _matTransferPairCache = null;
let _matTransferPairCacheVersion = -1;

function _invalidateMatTransferPairCache() {
  _matTransferPairCache = null;
  _matTransferPairCacheVersion = -1;
}

function _matTransferPairKey(central, deposito, usuario, dtDoc, dtLanc, dtReg, absPeso, sign) {
  return [
    String(central  || '').trim().toUpperCase(),
    String(deposito || '').trim().toUpperCase(),
    String(usuario  || '').trim().toUpperCase(),
    String(dtDoc    || '').trim(),
    String(dtLanc   || '').trim(),
    String(dtReg    || '').trim(),
    absPeso.toFixed(3),
    sign
  ].join('||');
}

function getMatTransferPairIndex() {
  const currentVersion = (state.sap || []).length;
  if (_matTransferPairCache && _matTransferPairCacheVersion === currentVersion) {
    return _matTransferPairCache;
  }
  const idx = new Map();
  (state.sap || []).forEach(s => {
    if (normMov(s.movimento) !== '309') return;
    const peso = num(s.peso);
    if (!peso) return;
    const key = _matTransferPairKey(
      s.central, s.deposito, s.usuario, s.dtDoc, s.dtLanc, s.dtReg,
      Math.abs(peso), peso > 0 ? '+' : '-'
    );
    // Em tese só existe 1 registro por chave (mesma central/depósito/
    // usuário/datas/peso só deveria repetir numa transferência real).
    // Mantém o primeiro em caso de dado inesperado.
    if (!idx.has(key)) idx.set(key, s.material || '—');
  });
  _matTransferPairCache = idx;
  _matTransferPairCacheVersion = currentVersion;
  return _matTransferPairCache;
}

/**
 * Dado um registro 309 (central + campos extra do toEntry + peso com
 * sinal), retorna o material do lado complementar da transferência — ou
 * null se não houver correspondência.
 */
function findMaterialTransferPair(central, usuario, extra, peso) {
  if (!peso || !extra) return null;
  const targetSign = peso > 0 ? '-' : '+'; // procura sempre o lado OPOSTO
  const idx = getMatTransferPairIndex();
  const key = _matTransferPairKey(
    central, extra.deposito, usuario, extra.dtDoc, extra.dtLanc, extra.dtReg,
    Math.abs(peso), targetSign
  );
  const material = idx.get(key);
  return material ? { material } : null;
}

// Renderiza o bloco de "Ajustes de Fechamento Mensal desconsiderados" no
// resumo do modal de breakdown (Entradas/Saídas por material) — mostra a
// soma de Peso e Custo Total, e uma lista expansível com cada registro
// individual (para o Hugo poder ver exatamente quais foram excluídos).
function _bdmFechExcluidosHtml(fechExcluidos) {
  if (!fechExcluidos || !fechExcluidos.length) return '';
  const { peso, custo } = (typeof somarPesoCustoSap === 'function')
    ? somarPesoCustoSap(fechExcluidos)
    : { peso: 0, custo: 0 };
  const itensHtml = fechExcluidos.map(r => `
    <div class="bdm-fech-item">
      <span class="td-mono" style="color:${num(r.peso) < 0 ? '#ef4444' : '#22c55e'}">${r.movimento || '—'}</span>
      <span class="td-muted">${r.documento || '—'}</span>
      <span class="td-muted">${r.dtLanc || '—'}</span>
      <span class="td-mono">${fmtKg(num(r.peso))}</span>
      <span class="td-mono">${money(r.valorTotal || (num(r.custoUnit) * Math.abs(num(r.peso))))}</span>
    </div>`).join('');

  return `
    <div class="bdm-summary-row bdm-fech-row">
      <span class="bdm-summary-label">
        <i class="ti ti-calendar-check" style="color:var(--purple)"></i>
        Ajustes de Fechamento desconsiderados
      </span>
      <span class="bdm-summary-compare">
        <b>${fechExcluidos.length}</b> registro(s) &nbsp;·&nbsp;
        Peso: <b>${fmtKg(peso)}</b> &nbsp;·&nbsp;
        Custo Total: <b>${money(custo)}</b>
      </span>
    </div>
    <details class="bdm-fech-details">
      <summary>Ver registros desconsiderados</summary>
      <div class="bdm-fech-list">
        <div class="bdm-fech-item bdm-fech-item--head">
          <span>Mov.</span><span>Documento</span><span>Dt. Lanç.</span><span>Peso</span><span>Custo Total</span>
        </div>
        ${itensHtml}
      </div>
    </details>`;
}

function openBreakdownModal(trigger) {
  const overlay   = document.getElementById('breakdown-modal-overlay');
  const titleEl   = document.getElementById('bdm-title');
  const summaryEl = document.getElementById('bdm-summary');
  const searchEl  = document.getElementById('bdm-search-input');
  const tbody     = document.getElementById('bdm-tbody');
  const totalEl   = document.getElementById('bdm-total-val');
  const labelEl   = document.getElementById('bdm-footer-label');
  if (!overlay || !titleEl || !tbody || !totalEl) return;

  let entries = [];
  try { entries = JSON.parse(decodeURIComponent(trigger.dataset.entries || '[]')); } catch(e) {}
  let fechExcluidos = [];
  try { fechExcluidos = JSON.parse(decodeURIComponent(trigger.dataset.fechExcluidos || '[]')); } catch(e) {}
  const title      = trigger.dataset.title  || '';
  const colorVar   = trigger.dataset.color  || 'var(--text)';
  const localCountRaw = trigger.dataset.localCount;
  const localCount = localCountRaw === '' || localCountRaw == null ? null : Number(localCountRaw);
  const mat        = trigger.dataset.mat    || '';
  const central    = trigger.dataset.central || '';

  titleEl.textContent = title + ' — Movimentações';

  // ── Ordena por Dt. Lançamento, mais recente primeiro ─────────────────────
  // Registros sem data parseável (raro — dado incompleto) vão pro final,
  // não interferem na ordenação dos que têm data.
  entries.sort((a, b) => {
    const dtA = parseDate((a[5] && a[5].dtLanc) || a[4] || '');
    const dtB = parseDate((b[5] && b[5].dtLanc) || b[4] || '');
    if (!dtA && !dtB) return 0;
    if (!dtA) return 1;
    if (!dtB) return -1;
    return dtB - dtA;
  });

  // ── Resumo fixo (sempre visível, abaixo do título) ───────────────────────
  // 1) Quais códigos de MOVIMENTO compõem o total e quantos registros cada
  //    um contribui — visão rápida do que está sendo contabilizado.
  // 2) Comparação entre a quantidade de registros SAP mostrados aqui e a
  //    quantidade de registros cadastrados na página local (Entradas/Saídas)
  //    para o MESMO material + central + período — ajuda a identificar
  //    divergência de cadastro sem precisar abrir a página separadamente.
  //    Quando o chamador não tem esse dado (localCount === null — caso do
  //    Inventário e do detalhamento por dia), a comparação é omitida em vez
  //    de mostrar um "0 registros" enganoso. Sempre reflete o TOTAL real
  //    (não muda com a busca abaixo).
  if (summaryEl) {
    const codCounts = new Map();
    entries.forEach(([cod]) => codCounts.set(cod, (codCounts.get(cod) || 0) + 1));
    const codeChips = [...codCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([cod, n]) => movSummaryChipHtml(cod, n))
      .join('');

    const sapCount = entries.length;
    const localLabel = title === 'Saídas' ? 'registro(s) na página Saídas' : 'registro(s) na página Entradas';
    const registrosHtml = localCount === null
      ? `<b>${sapCount}</b> no SAP`
      : (() => {
          const bateComLocal = sapCount === localCount;
          const compareIcon  = bateComLocal
            ? '<i class="ti ti-circle-check" style="color:var(--green)" title="Contagens batem"></i>'
            : '<i class="ti ti-alert-triangle" style="color:var(--amber)" title="Contagens divergem"></i>';
          return `<b>${sapCount}</b> no SAP &nbsp;·&nbsp; <b>${localCount}</b> ${localLabel} ${compareIcon}`;
        })();

    summaryEl.innerHTML = `
      <div class="bdm-summary-row">
        <span class="bdm-summary-label">Movimentos considerados</span>
        <div class="bdm-summary-codes">${codeChips || '<span style="color:var(--text3);font-size:11.5px">—</span>'}</div>
      </div>
      <div class="bdm-summary-row">
        <span class="bdm-summary-label">Registros</span>
        <span class="bdm-summary-compare">${registrosHtml}</span>
      </div>${_bdmFechExcluidosHtml(fechExcluidos)}`;
  }

  // ── Pré-computa HTML + texto de busca de cada linha, uma vez ─────────────
  // (inclui o par 861/862/309 relacionado no texto de busca, já que ele
  // aparece visualmente na linha — buscar "AAA1" deve achar a linha cujo
  // par de transferência está lançado lá, por exemplo)
  const rows = entries.map(([cod, value, ref, usuario, dtLanc, extra]) => {
    const dtDoc     = (extra && extra.dtDoc)  || '';
    const dtLancRaw = (extra && extra.dtLanc) || dtLanc || '';
    const dtReg     = (extra && extra.dtReg)  || '';

    // Transferência entre centros (861/862): mostra na mesma linha qual é
    // o movimento relacionado (código complementar) e em qual central ele
    // está lançado — ver findTransferPairCentral.
    // Transferência entre materiais (309): mostra na mesma linha qual é o
    // material relacionado (mesmo código, sinal oposto) — ver
    // findMaterialTransferPair.
    let pairHtml = '';
    let pairSearchText = '';
    if (cod === '861' || cod === '862') {
      const pair = findTransferPairCentral(cod, ref, mat);
      if (pair) {
        const direcao = cod === '861' ? 'de' : 'para';
        pairHtml = `<div class="mv-pair-note" title="Movimento relacionado desta transferência">
          <i class="ti ti-arrows-right-left"></i>
          ${movBadgeHtml(pair.cod, 'sm')}
          <span class="mv-pair-value">${direcao} ${escapeHtml(pair.central)}</span>
        </div>`;
        pairSearchText = `${pair.cod} ${pair.central}`;
      } else {
        pairHtml = `<div class="mv-pair-note mv-pair-note-missing" title="Nenhum movimento complementar encontrado no SAP importado">
          <i class="ti ti-help-circle"></i> sem par encontrado
        </div>`;
      }
    } else if (cod === '309') {
      const pair = findMaterialTransferPair(central, usuario, extra, value);
      if (pair) {
        const direcao = value >= 0 ? 'de' : 'para'; // entrada: veio "de"; saída: foi "para"
        pairHtml = `<div class="mv-pair-note" title="Material relacionado desta transferência">
          <i class="ti ti-replace"></i>
          <span class="mv-pair-value">${direcao} ${escapeHtml(pair.material)}</span>
        </div>`;
        pairSearchText = pair.material;
      } else {
        pairHtml = `<div class="mv-pair-note mv-pair-note-missing" title="Nenhum material complementar encontrado no SAP importado">
          <i class="ti ti-help-circle"></i> sem par encontrado
        </div>`;
      }
    }

    const signIcon = value >= 0
      ? '<i class="ti ti-circle-arrow-up" title="Sobra" style="font-size:11px;vertical-align:middle;margin-right:2px"></i>'
      : '<i class="ti ti-circle-arrow-down" title="Desfalque" style="font-size:11px;vertical-align:middle;margin-right:2px"></i>';

    const html = `<tr>
      <td>${movBadgeHtml(cod)}</td>
      <td class="td-muted">${escapeHtml(usuario || '—')}</td>
      <td class="td-muted">${escapeHtml(ref || '—')}${pairHtml}</td>
      <td class="td-muted">${escapeHtml(dtDoc || '—')}</td>
      <td class="td-muted">${escapeHtml(dtLancRaw || '—')}</td>
      <td class="td-muted">${escapeHtml(dtReg || '—')}</td>
      <td class="td-mono" style="color:${colorVar};text-align:right;font-weight:600">${signIcon}${fmtKg(Math.abs(value))}</td>
    </tr>`;

    const searchText = [cod, ref, usuario, dtDoc, dtLancRaw, dtReg, pairSearchText]
      .filter(Boolean).join(' ').toLowerCase();

    return { value, html, searchText };
  });

  // ── Renderiza a tabela + total, filtrando pela busca (se houver) ─────────
  function renderRows(term) {
    const t = (term || '').trim().toLowerCase();
    const filtered = t ? rows.filter(r => r.searchText.includes(t)) : rows;

    tbody.innerHTML = filtered.length
      ? filtered.map(r => r.html).join('')
      : `<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:22px 16px">
           Nenhum registro encontrado${t ? ` para "${escapeHtml(term.trim())}"` : ''}
         </td></tr>`;

    const subtotal = filtered.reduce((sum, r) => sum + r.value, 0);
    const totalIcon = subtotal >= 0
      ? '<i class="ti ti-circle-arrow-up" title="Sobra" style="font-size:12px;vertical-align:middle;margin-right:3px"></i>'
      : '<i class="ti ti-circle-arrow-down" title="Desfalque" style="font-size:12px;vertical-align:middle;margin-right:3px"></i>';
    totalEl.innerHTML = totalIcon + fmtKg(Math.abs(subtotal));
    totalEl.style.color = colorVar;
    if (labelEl) {
      labelEl.textContent = t
        ? `Total (${filtered.length} filtrado${filtered.length === 1 ? '' : 's'})`
        : 'Total';
    }
  }

  renderRows('');

  // Reseta o campo e reatribui o listener (clona o nó pra descartar
  // listeners de aberturas anteriores do modal, sem precisar guardar
  // referência externa).
  if (searchEl) {
    searchEl.value = '';
    const freshSearchEl = searchEl.cloneNode(true);
    searchEl.parentNode.replaceChild(freshSearchEl, searchEl);
    freshSearchEl.addEventListener('input', () => renderRows(freshSearchEl.value));
  }

  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
}

function closeBreakdownModal() {
  const overlay = document.getElementById('breakdown-modal-overlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
}

// ── Modal de Ajustes de Fechamento Mensal desconsiderados (Y11/Y12) ──────
// Reutilizado pelo badge da Visão Geral (Dashboard Gerencial) e pelo badge
// por linha do Inventário — recebe o array de registros SAP brutos já
// filtrados (isSapExcluidoPorFechamento) e um rótulo de contexto (ex: nome
// da central/material ou "Período selecionado").
function openFechModal(records, contextLabel) {
  const overlay  = document.getElementById('fech-modal-overlay');
  const titleEl  = document.getElementById('fech-modal-title');
  const summaryEl = document.getElementById('fech-modal-summary');
  const tbody    = document.getElementById('fech-modal-tbody');
  const pesoEl   = document.getElementById('fech-modal-total-peso');
  const custoEl  = document.getElementById('fech-modal-total-custo');
  if (!overlay || !tbody) return;

  const recs = Array.isArray(records) ? records : [];
  titleEl.textContent = contextLabel ? `Registros desconsiderados — ${contextLabel}` : 'Registros desconsiderados';

  const { peso, custo } = somarPesoCustoSap(recs);
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="bdm-summary-row">
        <span class="bdm-summary-label">Motivo</span>
        <span class="bdm-summary-compare">Ajuste de saldo de fechamento mensal de inventário (Y11/Y12) — não entra no cálculo de variação para não mascarar o resultado do mês.</span>
      </div>
      <div class="bdm-summary-row">
        <span class="bdm-summary-label">Registros</span>
        <span class="bdm-summary-compare"><b>${recs.length}</b> registro(s)</span>
      </div>`;
  }

  const sorted = recs.slice().sort((a, b) => {
    const da = parseDate(a.dtLanc), db = parseDate(b.dtLanc);
    return dateCmp(db ?? new Date(0), da ?? new Date(0));
  });

  tbody.innerHTML = sorted.length ? sorted.map(r => {
    const neg = num(r.peso) < 0;
    const custoLinha = num(r.valorTotal) !== 0 ? num(r.valorTotal) : (num(r.custoUnit) * Math.abs(num(r.peso)));
    return `
    <tr>
      <td class="td-mono" style="color:${neg ? '#ef4444' : '#22c55e'}">${r.movimento || '—'}</td>
      <td class="td-mono">${r.central || '—'}</td>
      <td class="td-mono">${r.material || r.materialOriginal || '—'}</td>
      <td class="td-mono">${r.documento || '—'}</td>
      <td class="td-muted">${r.dtLanc || '—'}</td>
      <td class="td-muted">${r.dtReg || '—'}</td>
      <td class="td-mono" style="text-align:right">${fmtKg(num(r.peso))}</td>
      <td class="td-mono" style="text-align:right">${money(custoLinha)}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="8"><div class="empty-state"><i class="ti ti-calendar-check"></i><p>Nenhum registro.</p></div></td></tr>';

  if (pesoEl)  pesoEl.textContent  = 'Peso: ' + fmtKg(peso);
  if (custoEl) custoEl.textContent = 'Custo Total: ' + money(custo);

  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
}
window.openFechModal = openFechModal;

function closeFechModal() {
  const overlay = document.getElementById('fech-modal-overlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
}
window.closeFechModal = closeFechModal;

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

/**
 * Converte o peso de uma NF para KG, aplicando o fator de conversão
 * correto conforme a unidade de medida e o material.
 *
 * Regras:
 *  TO / T        → × 1000
 *  M3 / M³ / M   → fator por material:
 *    AREIA NATURAL FINA   → × 1400
 *    AREIA NATURAL        → × 1300
 *    BRITA 0 / BRITA 1    → × 1400
 *    AREIA ARTIFICIAL*    → × 1500
 *    (outros)             → sem conversão (retorna peso bruto)
 *  KG / outros   → sem conversão
 *
 * @param {number|string} peso
 * @param {string} um - unidade de medida do registro
 * @param {string} material - nome do material
 * @returns {number} peso em KG
 */
function _convertNfPesoToKg(peso, um, material) {
  const p = Math.abs(num(peso));
  const u = String(um       || '').trim().toUpperCase();
  const m = String(material || '').trim().toUpperCase();

  // ── Toneladas: T, TO, TON, TL, TN ────────────────────────────────────
  if (/^(T|TO|TON|TL|TN)$/.test(u)) return p * 1000;

  // ── Volumétrico: M, M3, MT, M³, METRO, CBM ───────────────────────────
  if (/^(M|M3|MT|M3|CBM|METRO)$/.test(u) || u === 'M\u00B3') {
    if (m.includes('AREIA NATURAL FINA'))  return p * 1400;
    if (m.includes('AREIA NATURAL'))       return p * 1300;
    if (m.includes('BRITA'))               return p * 1400;
    if (m.includes('AREIA ARTIFICIAL'))    return p * 1500;
    return p; // unidade volumétrica sem fator conhecido — retorna bruto
  }

  return p; // KG ou unidade não reconhecida
}

/**
 * Retorna true se uma NF precisa de fator de conversão volumétrico mas
 * nenhum está cadastrado para o material informado — sinaliza que o peso
 * injetado no cálculo está bruto e pode estar errado.
 *
 * Exceções: adições e aditivos são excluídos do aviso (tipicamente
 * comercializados em unidades pequenas, sem fator volumétrico).
 *
 * @param {string} um       - unidade de medida
 * @param {string} material - nome do material
 * @returns {boolean}
 */
function _nfNeedsConversionWarning(um, material) {
  const u = String(um       || '').trim().toUpperCase();
  const m = String(material || '').trim().toUpperCase()
              .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // strip acentos

  // Só unidades volumétricas disparam o aviso
  if (!/^(M|M3|MT|CBM|METRO)$/.test(u) && u !== 'M\u00B3') return false;

  // Materiais com fator conhecido → sem aviso
  if (m.includes('AREIA NATURAL FINA')) return false;
  if (m.includes('AREIA NATURAL'))      return false;
  if (m.includes('BRITA'))              return false;
  if (m.includes('AREIA ARTIFICIAL'))   return false;

  // Adições e aditivos → excluídos do aviso (pedido explícito)
  if (/ADITIV/.test(m))          return false;
  if (/ADIC[AO]O?/.test(m))      return false;
  if (m.includes('CINZA'))       return false;
  if (m.includes('SILICA'))      return false;
  if (m.includes('METACAOLIN'))  return false;

  // Unidade volumétrica sem fator → aviso
  return true;
}

function calcPendentesIntegracao({ central, dtIni, dtFim, sapNoPeriodo, entradasDaCentral }) {

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
  //
  // Prioridade de central: centralCompra, com fallback para centralDestino.
  // Motivo: em NF de TRANSFERÊNCIA (centralCompra ≠ centralDestino), o SAP
  // gera uma REF. própria para o movimento de transferência na central de
  // destino — essa REF. não é a mesma da NF original, então a checagem pelo
  // lado do destino nunca bate e a NF fica pendente "para sempre". Checando
  // pelo lado da centralCompra (onde a REF. da NF original de fato aparece
  // no SAP) evita esse falso-positivo. Fallback para centralDestino cobre
  // os registros sem centralCompra preenchida (comportamento antigo).
  // Fonte das entradas desta central: se o chamador já pré-agrupou
  // state.entradas por central (ver renderAnaliticoMicro em analitico.js),
  // usa o array pronto — evita repetir a varredura completa de
  // state.entradas uma vez por central (O(centrais × registros)). Sem o
  // pré-agrupamento (ex.: refresh avulso de um único card), cai no filtro
  // original — sempre correto, só não é o caminho rápido.
  const entradasBase = entradasDaCentral || (state.entradas || []).filter(r =>
    (r.centralCompra || r.centralDestino || '') === central
  );
  const pendNF = entradasBase.filter(r => {
    if (!inPeriodLocal(r.dtDescarga || r.dtEmissao)) return false;
    if (!r.nf) return false; // sem NF cadastrada — ignorar
    const nfNorm = normNF(r.nf);
    return !sapNFRefs.has(nfNorm);
  });

  // OS pendentes: saídas desta central no período cujo OS não aparece no SAP.
  // SAP stores the OS reference as "I004-NNNN"; the local Saídas module stores
  // just the number (e.g. "6047"). We match on the numeric part only.
  //
  // Reaproveita o índice _saidasByCentral já mantido em ui.js (o mesmo usado
  // pelo restante do Analítico/Dashboard Gerencial, com invalidação própria
  // em todos os pontos onde state.saidas muda) em vez de filtrar
  // state.saidas inteiro a cada central.
  ensureSaidasIndex();
  const saidasBase = _saidasByCentral.get(central) || [];
  const pendOS = saidasBase.filter(r => {
    if (!inPeriodLocal(r.dtEmissao)) return false;
    if (!r.os) return false; // sem OS cadastrada — ignorar
    if (!num(r.peso)) return false; // peso 0 — ignorar
    const osNorm = normOS(r.os);
    return !sapOSRefs.has(osNorm);
  });

  return { pendNF, pendOS };
}

/**
 * Builds the "Pendentes de Integração SAP" section HTML for a central card.
 */
function buildPendIntegSection({ central, dtIni, dtFim, sapNoPeriodo, entradasDaCentral }) {
  const { pendNF, pendOS } = calcPendentesIntegracao({ central, dtIni, dtFim, sapNoPeriodo, entradasDaCentral });
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

// ── Estado compartilhado do modal de pendentes ───────────────────────────
// Permite que o filtro de mês funcione tanto no modal por central quanto
// no modal global, sem duplicar a lógica de renderização da tabela.
// ── Cache SAP global para o modal de pendentes ───────────────────────────
// Construído uma única vez por sessão (ou até que os dados SAP mudem via
// importação). Evita rebuildar os Sets de referências a cada abertura do modal.
let _pimGlobalSapCache = null;

/** Funções de normalização — espelham as de calcPendentesIntegracao. */
const _pimNormNF = raw => {
  const s = String(raw || '').trim().toUpperCase();
  const dash = s.lastIndexOf('-');
  return (dash > 0 ? s.slice(0, dash) : s).replace(/^0+/, '') || '0';
};
const _pimNormOS       = raw => String(raw || '').trim().toUpperCase().replace(/^0+/, '') || '0';
const _pimNormSapRefOS = raw => {
  const s = String(raw || '').trim().toUpperCase();
  const dash = s.lastIndexOf('-');
  return (dash >= 0 ? s.slice(dash + 1) : s).replace(/^0+/, '') || '0';
};

/**
 * Constrói (ou retorna em cache) os Sets de NF/OS já integradas por central,
 * varrendo todo o histórico SAP sem filtro de período.
 * @returns {{ nfRefs: Map<string, Set>, osRefs: Map<string, Set> }}
 */
function _pimGetSapCache() {
  if (_pimGlobalSapCache) return _pimGlobalSapCache;
  const { byCentral } = getSapIndex();
  const nfRefs = new Map();
  const osRefs = new Map();
  byCentral.forEach((records, central) => {
    const nfSet = new Set(), osSet = new Set();
    records.forEach(s => {
      const cod = String(s.movimento || '').trim().toUpperCase();
      const ref = String(s.ref       || '').trim().toUpperCase();
      const doc = String(s.documento || '').trim().toUpperCase();
      if (cod === '101' || cod === '801') {
        if (ref) nfSet.add(_pimNormNF(ref));
        if (doc) nfSet.add(_pimNormNF(doc));
      } else if (cod === '201') {
        if (ref) osSet.add(_pimNormSapRefOS(ref));
        if (doc) osSet.add(_pimNormSapRefOS(doc));
      }
    });
    nfRefs.set(central, nfSet);
    osRefs.set(central, osSet);
  });
  _pimGlobalSapCache = { nfRefs, osRefs };
  return _pimGlobalSapCache;
}

/** Invalida o cache (chamar após importação de dados SAP). */
function _pimClearSapCache() { _pimGlobalSapCache = null; }

const _pimState = {
  allItems:    [],     // todos os itens sem filtro de mês/busca
  filtered:    [],     // itens após filtro de mês + busca
  tipo:        'NF',   // 'NF' | 'OS'
  isGlobal:    false,  // true = exibe coluna Central
  activeMonth: 'all',  // 'all' | 'YYYY-MM'
  search:      '',     // texto de busca livre (Material, Fornecedor, NF/OS, Datas)
  centralLabel:'',     // texto exibido no sub-título (modal por central)
  page:        0,      // página atual (0-indexed)
  totalPages:  1,      // calculado em _pimRender
  PAGE_SIZE:   100,    // linhas por página
};

const _PIM_MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

/** Extrai 'YYYY-MM' de uma string de data (DD/MM/AAAA ou YYYY-MM-DD). */
function _pimMonthKey(dateStr) {
  if (!dateStr || dateStr === '—') return null;
  const s = String(dateStr);
  const m1 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m1) return `${m1[3]}-${m1[2]}`;
  const m2 = s.match(/^(\d{4})-(\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}`;
  return null;
}

/** Retorna a data relevante de um item para fins de filtro de mês. */
function _pimItemDate(it, tipo) {
  return tipo === 'NF' ? (it.dtDescarga || it.dtEmissao) : it.dtEmissao;
}

/**
 * Verifica se um item bate com o texto de busca livre.
 * Campos considerados: Material, Fornecedor, NF/OS e Datas (Emissão + Descarga
 * quando aplicável). Comparação insensível a maiúsculas/acentos via normalizeText().
 */
function _pimMatchesSearch(it, tipo, normQuery) {
  if (!normQuery) return true;
  const haystack = [
    it.material,
    it.fornecedor,
    tipo === 'NF' ? it.nf : it.os,
    it.dtEmissao,
    tipo === 'NF' ? it.dtDescarga : null
  ];
  return haystack.some(v => v != null && normalizeText(String(v)).includes(normQuery));
}

/**
 * Reaplica o filtro de mês + busca sobre allItems e reseta para a primeira
 * página. Chamada tanto por pimSetMonth quanto por pimSetSearch — mantém os
 * dois filtros combinados (AND) sem duplicar a lógica de filtragem.
 */
function _pimApplyFilters() {
  const { allItems, tipo, activeMonth, search } = _pimState;
  const normQuery = normalizeText(search || '');
  _pimState.filtered = allItems.filter(it => {
    if (activeMonth !== 'all' && _pimMonthKey(_pimItemDate(it, tipo)) !== activeMonth) return false;
    return _pimMatchesSearch(it, tipo, normQuery);
  });
  _pimState.page = 0;
}

/** Renderiza thead + tbody + count + pills + paginação com o estado atual. */
function _pimRender() {
  const { filtered, tipo, isGlobal, allItems, activeMonth, PAGE_SIZE } = _pimState;
  const _num = v => { const n = parseFloat(String(v ?? 0).replace(',','.')); return Number.isFinite(n) ? n : 0; };
  const _fmt = n => isNaN(n) ? '—' : Math.abs(n).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});

  // ── Paginação ────────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  _pimState.totalPages = totalPages;
  const page = Math.min(_pimState.page, totalPages - 1);
  _pimState.page = page;
  const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // ── Sub-título ───────────────────────────────────────────────────────────
  const subTotal = filtered.length;
  const subSuffix = `${subTotal} registro${subTotal !== 1 ? 's' : ''} pendente${subTotal !== 1 ? 's' : ''}`;
  const subEl = document.getElementById('pim-sub');
  if (subEl) {
    subEl.textContent = isGlobal
      ? `${subSuffix} em todas as centrais`
      : `Central: ${_pimState.centralLabel} · ${subSuffix}`;
  }

  // ── Resumo por material (topo do modal) ─────────────────────────────────
  // Soma a quantidade pendente de cada material dentro do recorte ATUAL
  // (mês + busca já aplicados em `filtered`) — dinâmico, some/reaparece
  // conforme o usuário filtra. NF é sempre somado já convertido para KG
  // (mesmo valor exibido na coluna Quantidade); OS agrupa por material+UM
  // pra nunca somar unidades diferentes sob o mesmo total.
  const summaryEl = document.getElementById('pim-material-summary');
  if (summaryEl) {
    if (!filtered.length) {
      summaryEl.innerHTML = '';
      summaryEl.style.display = 'none';
    } else {
      const totalsByKey = new Map(); // key -> { mat, um, qty }
      filtered.forEach(it => {
        const mat = it.material || '—';
        if (tipo === 'NF') {
          const qty = _convertNfPesoToKg(it.peso, it.um, it.material);
          const cur = totalsByKey.get(mat) || { mat, um: 'KG', qty: 0 };
          cur.qty += qty;
          totalsByKey.set(mat, cur);
        } else {
          const um = String(it.um || 'kg').toUpperCase();
          const key = mat + '|' + um;
          const cur = totalsByKey.get(key) || { mat, um, qty: 0 };
          cur.qty += _num(it.peso);
          totalsByKey.set(key, cur);
        }
      });
      const sortedTotals = [...totalsByKey.values()].sort((a, b) => b.qty - a.qty);
      const MAX_CELLS = 24;
      const shown = sortedTotals.slice(0, MAX_CELLS);
      const rest  = sortedTotals.length - shown.length;
      const chipColor = tipo === 'NF' ? 'var(--green)' : 'var(--red)';
      const cellsHtml = shown.map(t => `
        <div class="pim-material-cell" title="${escapeHtml(t.mat)}">
          <div class="pim-material-cell-name">Total ${escapeHtml(t.mat)}</div>
          <div class="pim-material-cell-qty" style="color:${chipColor}">${_fmt(t.qty)} ${escapeHtml(t.um)}</div>
        </div>`).join('');
      const moreHtml = rest > 0
        ? `<div class="pim-material-cell pim-material-cell-more">+${rest} material${rest > 1 ? 'is' : ''}</div>`
        : '';
      summaryEl.innerHTML = `<div class="pim-material-grid">${cellsHtml}${moreHtml}</div>`;
      summaryEl.style.display = '';
    }
  }

  // ── Filter bar (pills de mês) ─────────────────────────────────────────────
  const filterBar = document.getElementById('pim-filter-bar');
  if (filterBar) {
    const monthKeys = [...new Set(
      allItems.map(it => _pimMonthKey(_pimItemDate(it, tipo))).filter(Boolean)
    )].sort();
    if (monthKeys.length > 1) {
      filterBar.innerHTML = [
        `<button class="pim-month-pill${activeMonth === 'all' ? ' active' : ''}" onclick="pimSetMonth('all')">Todos</button>`,
        ...monthKeys.map(key => {
          const [yyyy, mm] = key.split('-');
          const label = `${_PIM_MESES[parseInt(mm,10)-1]}/${yyyy}`;
          return `<button class="pim-month-pill${activeMonth === key ? ' active' : ''}" onclick="pimSetMonth('${key}')">${label}</button>`;
        })
      ].join('');
      filterBar.style.display = '';
    } else {
      filterBar.innerHTML = '';
      filterBar.style.display = 'none';
    }
  }

  // ── Thead ─────────────────────────────────────────────────────────────────
  const thead = document.getElementById('pim-thead');
  if (thead) {
    thead.innerHTML = tipo === 'NF'
      ? `<tr>${isGlobal ? '<th>Central</th>' : ''}<th>NF</th><th>Material</th><th>Fornecedor</th><th>Dt. Emissão</th><th>Dt. Descarga</th><th style="text-align:right">Quantidade</th></tr>`
      : `<tr>${isGlobal ? '<th>Central</th>' : ''}<th>OS</th><th>Material</th><th>Fornecedor</th><th>Dt. Emissão</th><th style="text-align:right">Quantidade</th></tr>`;
  }

  // ── Tbody (apenas a página atual) ─────────────────────────────────────────
  const tbody = document.getElementById('pim-tbody');
  if (tbody) {
    const colSpan = tipo === 'NF' ? (isGlobal ? 7 : 6) : (isGlobal ? 6 : 5);
    if (!pageItems.length) {
      tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align:center;color:var(--text3);padding:24px">Nenhum registro pendente encontrado</td></tr>`;
    } else if (tipo === 'NF') {
      tbody.innerHTML = pageItems.map(it => {
        const noConv = _nfNeedsConversionWarning(it.um, it.material);
        const convertedPeso = _convertNfPesoToKg(it.peso, it.um, it.material);
        const qtdCell = noConv
          ? `<td class="td-mono" style="text-align:right;color:var(--amber)" title="Sem fator de conversão cadastrado para ${escapeHtml(String(it.um||''))} — valor exibido sem conversão">
               <i class="ti ti-alert-triangle" style="font-size:11px;margin-right:3px;vertical-align:middle"></i>${_fmt(convertedPeso)} ${escapeHtml(String(it.um||'kg'))}
             </td>`
          : `<td class="td-mono" style="text-align:right;color:var(--green)">${_fmt(convertedPeso)} KG</td>`;
        return `<tr${noConv ? ' class="pim-row-no-conv"' : ''}>
          ${isGlobal ? `<td class="td-muted">${escapeHtml(it.central||'—')}</td>` : ''}
          <td class="td-mono" style="font-weight:600;color:var(--green)">${escapeHtml(String(it.nf||'—'))}</td>
          <td>${escapeHtml(String(it.material||'—'))}</td>
          <td class="td-muted">${escapeHtml(String(it.fornecedor||'—'))}</td>
          <td class="td-muted">${escapeHtml(String(it.dtEmissao||'—'))}</td>
          <td class="td-muted">${escapeHtml(String(it.dtDescarga||'—'))}</td>
          ${qtdCell}
        </tr>`;
      }).join('');
    } else {
      tbody.innerHTML = pageItems.map(it => `<tr>
        ${isGlobal ? `<td class="td-muted">${escapeHtml(it.central||'—')}</td>` : ''}
        <td class="td-mono" style="font-weight:600;color:var(--red)">${escapeHtml(String(it.os||'—'))}</td>
        <td>${escapeHtml(String(it.material||'—'))}</td>
        <td class="td-muted">${escapeHtml(String(it.fornecedor||'—'))}</td>
        <td class="td-muted">${escapeHtml(String(it.dtEmissao||'—'))}</td>
        <td class="td-mono" style="text-align:right;color:var(--red)">${_fmt(_num(it.peso))} ${escapeHtml(String(it.um||'kg'))}</td>
      </tr>`).join('');
    }
  }

  // ── Rodapé: contagem + paginação ──────────────────────────────────────────
  const countEl = document.getElementById('pim-count');
  if (countEl) {
    if (totalPages > 1) {
      const start = page * PAGE_SIZE + 1;
      const end   = Math.min((page + 1) * PAGE_SIZE, filtered.length);
      countEl.textContent = `${start}–${end} de ${subTotal} registro${subTotal !== 1 ? 's' : ''}`;
    } else {
      countEl.textContent = `${subTotal} registro${subTotal !== 1 ? 's' : ''} pendente${subTotal !== 1 ? 's' : ''}`;
    }
  }

  const pgEl = document.getElementById('pim-pagination');
  if (pgEl) {
    if (totalPages > 1) {
      pgEl.style.display = '';
      const pgInfo = document.getElementById('pim-pg-info');
      if (pgInfo) pgInfo.textContent = `${page + 1} / ${totalPages}`;
      const first = document.getElementById('pim-pg-first');
      const prev  = document.getElementById('pim-pg-prev');
      const next  = document.getElementById('pim-pg-next');
      const last  = document.getElementById('pim-pg-last');
      if (first) first.disabled = page === 0;
      if (prev)  prev.disabled  = page === 0;
      if (next)  next.disabled  = page >= totalPages - 1;
      if (last)  last.disabled  = page >= totalPages - 1;
    } else {
      pgEl.style.display = 'none';
    }
  }
}

/** Aplica filtro de mês (combinado com a busca ativa), reseta página e re-renderiza. */
function pimSetMonth(monthKey) {
  _pimState.activeMonth = monthKey;
  _pimApplyFilters();
  _pimRender();
}

// Pequeno debounce evita re-renderizar a tabela inteira a cada tecla digitada
// (a paginação/thead/tbody são recriados via innerHTML) — 120ms é imperceptível
// pro usuário mas poupa DOM churn em buscas rápidas.
let _pimSearchDebounce = null;

/** Aplica busca livre (combinada com o filtro de mês ativo), reseta página e re-renderiza. */
function pimSetSearch(value) {
  _pimState.search = value || '';
  clearTimeout(_pimSearchDebounce);
  _pimSearchDebounce = setTimeout(() => {
    _pimApplyFilters();
    _pimRender();
  }, 120);
}

/** Navega para uma página específica da tabela. */
function pimGoToPage(n) {
  const total = _pimState.totalPages || 1;
  _pimState.page = Math.max(0, Math.min(n, total - 1));
  _pimRender();
}

function openPendIntegModal(trigger) {
  const overlay = document.getElementById('pim-overlay');
  if (!overlay) return;

  const tipo    = trigger.dataset.tipo || '?';
  const central = trigger.dataset.central || '—';
  let items = [];
  try { items = JSON.parse(decodeURIComponent(trigger.dataset.items || '[]')); } catch(e) {}

  document.getElementById('pim-title').textContent =
    tipo === 'NF' ? 'NFs sem integração SAP' : 'OS sem integração SAP';

  // Inicializa estado compartilhado
  _pimState.allItems    = items;
  _pimState.filtered    = items;
  _pimState.tipo        = tipo;
  _pimState.isGlobal    = false;
  _pimState.activeMonth = 'all';
  _pimState.search      = '';
  _pimState.centralLabel = central;
  const pimSearchEl = document.getElementById('pim-search');
  if (pimSearchEl) pimSearchEl.value = '';

  _pimRender();
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
 * Exibe TODAS as NFs ou OS pendentes de integração SAP, sem filtro de
 * período ou central. Chamado pelos botões globais nas páginas Entradas/Saídas.
 *
 * Lógica:
 *  • NFs: varre state.entradas inteiro; considera pendente qualquer registro
 *    com campo `nf` que não tenha correspondência no SAP (mov 101/801) da
 *    central de destino/compra daquela entrada, usando toda a história SAP
 *    (sem filtro de período).
 *  • OS: varre state.saidas inteiro; considera pendente qualquer registro com
 *    campo `os` que não tenha correspondência no SAP (mov 201) da central,
 *    usando toda a história SAP.
 *
 * @param {'NF'|'OS'} tipo
 */
function openPendIntegGlobalModal(tipo) {
  const overlay = document.getElementById('pim-overlay');
  if (!overlay) return;

  // ── Abre o modal imediatamente com spinner ───────────────────────────────
  // O cálculo pesado acontece após o browser pintar o estado de carregamento,
  // eliminando a sensação de "travamento" ao clicar no botão.
  document.getElementById('pim-title').textContent =
    tipo === 'NF' ? 'NFs sem integração SAP — Todas as Centrais'
                  : 'OS sem integração SAP — Todas as Centrais';
  document.getElementById('pim-sub').textContent = 'Calculando...';
  const filterBarEl = document.getElementById('pim-filter-bar');
  if (filterBarEl) { filterBarEl.innerHTML = ''; filterBarEl.style.display = 'none'; }
  const summaryElInit = document.getElementById('pim-material-summary');
  if (summaryElInit) { summaryElInit.innerHTML = ''; summaryElInit.style.display = 'none'; }
  const pimSearchElInit = document.getElementById('pim-search');
  if (pimSearchElInit) pimSearchElInit.value = '';
  _pimState.search = '';
  const theadEl = document.getElementById('pim-thead');
  const tbodyEl = document.getElementById('pim-tbody');
  const colSpan = tipo === 'NF' ? 7 : 6;
  if (theadEl) theadEl.innerHTML = '';
  if (tbodyEl) tbodyEl.innerHTML = `<tr><td colspan="${colSpan}" style="text-align:center;padding:36px;color:var(--text3)">
    <i class="ti ti-loader-2" style="font-size:22px;display:block;margin:0 auto 10px;animation:spin 1s linear infinite"></i>
    Calculando pendentes de todas as centrais...
  </td></tr>`;
  const pgEl = document.getElementById('pim-pagination');
  if (pgEl) pgEl.style.display = 'none';
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');

  // ── Computa após o browser pintar o spinner ──────────────────────────────
  setTimeout(() => {
    const { nfRefs, osRefs } = _pimGetSapCache(); // cache SAP — O(1) após primeira chamada
    let items = [];

    if (tipo === 'NF') {
      (state.entradas || []).forEach(r => {
        if (!r.nf) return;
        // Mesma prioridade de calcPendentesIntegracao: centralCompra primeiro,
        // fallback centralDestino — evita falso-positivo em NF de
        // transferência (REF. gerada pelo SAP na central de destino não bate
        // com a REF. da NF original).
        const central = r.centralCompra || r.centralDestino || '';
        if (!central) return;
        const centralNFRefs = nfRefs.get(central) || new Set();
        if (!centralNFRefs.has(_pimNormNF(r.nf))) {
          items.push({
            central, nf: r.nf,
            material:  r.material   || '—',
            fornecedor:r.fornecedor  || '—',
            dtEmissao: r.dtEmissao  || '—',
            dtDescarga:r.dtDescarga || '—',
            peso: r.peso || 0, um: r.um || 'kg'
          });
        }
      });
      items.sort((a, b) =>
        a.central.localeCompare(b.central, 'pt-BR') ||
        (a.dtDescarga || a.dtEmissao).localeCompare(b.dtDescarga || b.dtEmissao) ||
        String(a.nf).localeCompare(String(b.nf), 'pt-BR')
      );
    } else {
      (state.saidas || []).forEach(r => {
        if (!r.os) return;
        if (!num(r.peso)) return; // peso 0 — ignorar
        const central = r.central || '';
        if (!central) return;
        const centralOSRefs = osRefs.get(central) || new Set();
        if (!centralOSRefs.has(_pimNormOS(r.os))) {
          items.push({
            central, os: r.os,
            material:  r.material   || '—',
            fornecedor:r.fornecedor  || '—',
            dtEmissao: r.dtEmissao  || '—',
            peso: r.peso || 0, um: r.um || 'kg'
          });
        }
      });
      items.sort((a, b) =>
        a.central.localeCompare(b.central, 'pt-BR') ||
        a.dtEmissao.localeCompare(b.dtEmissao) ||
        String(a.os).localeCompare(String(b.os), 'pt-BR')
      );
    }

    // Atualiza contadores nos botões globais
    const nfCountEl = document.getElementById('pend-global-nf-count');
    const osCountEl = document.getElementById('pend-global-os-count');
    if (tipo === 'NF' && nfCountEl) nfCountEl.textContent = items.length;
    if (tipo === 'OS' && osCountEl) osCountEl.textContent = items.length;

    // Popula _pimState e renderiza (somente a primeira página)
    _pimState.allItems    = items;
    _pimState.filtered    = items;
    _pimState.tipo        = tipo;
    _pimState.isGlobal    = true;
    _pimState.activeMonth = 'all';
    _pimState.search      = '';
    _pimState.centralLabel = '';
    _pimState.page        = 0;

    _pimRender();
  }, 0);
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

Object.assign(window, { openBreakdownModal, closeBreakdownModal, openPendIntegModal, closePendIntegModal, openPendIntegGlobalModal, pimSetMonth, pimGoToPage, _pimClearSapCache, togglePendConsiderados });

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
          <td data-col="ent">${temSap ? buildAnaliticoDetailBreakdown(day.entEntries, day.totalEnt, 'var(--green)', 'Entradas', null, payload.material, payload.central) : emptyCell()}</td>
          <td data-col="sai">${temSap ? buildAnaliticoDetailBreakdown(day.saiEntries, day.totalSai, 'var(--red)', 'Saídas', null, payload.material, payload.central) : emptyCell()}</td>
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
        <td data-col="ent">${buildAnaliticoDetailBreakdown(day.entEntries, day.totalEnt, 'var(--green)', 'Entradas', null, payload.material, payload.central)}</td>
        <td data-col="sai">${buildAnaliticoDetailBreakdown(day.saiEntries, day.totalSai, 'var(--red)', 'Saídas', null, payload.material, payload.central)}</td>
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
              <i class="ti ti-stack-2" style="font-size:9px;opacity:.65;margin-left:3px"></i>
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
  _invalidateLancDupCache();        // invalida cache de duplicatas
  invalidateSearchIndex('lancamentos');
  if (typeof _ausInvalidateCache === 'function') _ausInvalidateCache();
}

function invalidateSapIndex() {
  _sapIndexBuilt = false;
  _sapByCentralMat.clear();
  _sapByCentral.clear();
  _invalidateSapDupCache();        // invalida cache de duplicatas
  _invalidateTransferPairCache();  // invalida cache de pares 861/862
  _invalidateMatTransferPairCache(); // invalida cache de pares 309
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
// AJUSTES DE FECHAMENTO MENSAL DE INVENTÁRIO (Y11/Y12) ────────────────────
// ═══════════════════════════════════════════════════════════
// Contexto: todo fim de mês a central consolida estoque e faz ajustes de
// saldo (movimentos SAP Y11 negativo / Y12 positivo) para bater o físico.
// Esses ajustes são LANÇADOS NO SISTEMA e, se entrassem no cálculo de
// variação (buildSnapshot), zerariam artificialmente a divergência que o
// fechamento acabou de corrigir — mascarando o histórico de variação real
// do mês. Precisam ser desconsiderados do cálculo em TODO o sistema
// (Inventário, Dashboard Gerencial, Analítico, Trend, Macro, Assistente),
// mas SEM alterar o dado bruto — a página SAP continua mostrando o
// registro original, sempre, para auditoria.
//
// Critério de detecção (definido com o usuário em 22/07/2026 — substitui a
// versão anterior baseada em "último dia útil do mês" + janela de dias):
// DT DOCUMENTO e DT LANÇAMENTO caem no mesmo mês/ano (o "mês anterior"), e
// DT REGISTRO cai exatamente no mês/ano seguinte (o "mês atual"). Não
// exige mais que DT DOCUMENTO === DT LANÇAMENTO no mesmo DIA, nem que a
// DT LANÇAMENTO seja o último dia útil — só que ambas estejam no mesmo mês,
// um mês antes do registro. Não existe nenhum outro campo no SAP (usuário,
// texto, motivo) que diferencie um ajuste de fechamento de um ajuste feito
// durante o mês — por isso a exclusão é automática por padrão de data, com
// uma via de escape manual (override) para o caso raro de falso positivo,
// controlada na própria página SAP (checkbox + ação em lote).

// Retorna um índice numérico crescente pro mês/ano de uma data, útil pra
// comparar "mesmo mês" ou "mês seguinte" sem se importar com o dia.
function _fechMesIndice(date) {
  return date.getFullYear() * 12 + date.getMonth();
}

// Detecta se um registro SAP bate no padrão de Ajuste de Fechamento Mensal.
// Pura — não considera overrides manuais (ver isSapExcluidoPorFechamento).
function isSapFechamentoPattern(r) {
  if (!r) return false;
  const mov = normMov(r.movimento);
  if (mov !== 'Y11' && mov !== 'Y12') return false;

  const dtDoc  = parseDate(r.dtDoc);
  const dtLanc = parseDate(r.dtLanc);
  const dtReg  = parseDate(r.dtReg);
  if (!dtDoc || !dtLanc || !dtReg) return false;

  const mesDoc  = _fechMesIndice(dtDoc);
  const mesLanc = _fechMesIndice(dtLanc);
  const mesReg  = _fechMesIndice(dtReg);

  // DT DOCUMENTO e DT LANÇAMENTO no mesmo mês/ano (o "mês anterior")
  if (mesDoc !== mesLanc) return false;

  // DT REGISTRO exatamente um mês/ano depois (o "mês atual")
  if (mesReg !== mesLanc + 1) return false;

  return true;
}

// Chave única de um registro SAP para fins de override manual — usa o
// número do documento (único por transação no SAP), diferente de
// getSapRecordKey (usada para duplicatas), que NÃO inclui documento e por
// isso não é precisa o bastante aqui: o Hugo confirmou que pode haver
// vários Y11 independentes para o mesmo material/central no mesmo mês
// (não vêm em pares), então cada um precisa de identidade própria.
function getSapFechKey(r) {
  return [
    (r.documento || '').trim(),
    (r.movimento || '').trim(),
    (r.central   || '').trim(),
    (r.deposito  || '').trim(),
    (r.material  || r.materialOriginal || '').trim(),
    (r.dtLanc    || '').trim(),
    String(num(r.peso))
  ].join('||');
}

// ── Cache do Set de overrides (reincluídos manualmente no cálculo) ───────
let _fechOverrideSetCache = null;
let _fechOverrideSetSig = null;

function _getFechOverrideSet() {
  const list = state.sapFechamentoOverrides || [];
  const sig = list.length + '|' + (list.length ? list[list.length - 1] : '');
  if (_fechOverrideSetCache && _fechOverrideSetSig === sig) return _fechOverrideSetCache;
  _fechOverrideSetCache = new Set(list);
  _fechOverrideSetSig = sig;
  return _fechOverrideSetCache;
}

function invalidateFechOverrideCache() {
  _fechOverrideSetCache = null;
  _fechOverrideSetSig = null;
}

// Conjunto de números de Documento SAP preenchidos em QUALQUER justificativa
// do Inventário (campo "Documento SAP" do fechamento de inventário — ver
// invJustificativas em inventario.js/state.js). Documentos aqui são
// SEMPRE desconsiderados do cálculo (ver isSapExcluidoPorFechamento
// abaixo), mesmo que reincluídos manualmente via override no modal de
// Fechamento — trava real, não um valor-padrão reversível por ali.
//
// Propositalmente SEM CACHE (diferente de _getFechOverrideSet): a lista
// de justificativas do Inventário é pequena (uma linha por central×
// material×mês justificado, nunca a escala de 600k do SAP) e precisa
// refletir o estado ATUAL a cada chamada — o Hugo confirmou que apagar o
// campo Documento SAP de uma justificativa deve destravar aquele
// documento imediatamente, sem nenhuma ação de "sincronizar". Cachear
// aqui reintroduziria o mesmo risco de staleness entre módulos já
// evitado de propósito em _anStockCache (ver notas de analitico.js).
function _getInvJustDocSet() {
  // Map em vez de Set: guarda o valor ORIGINAL (como foi digitado) junto
  // com a chave normalizada, só para poder mostrar no tooltip do cadeado
  // qual documento específico está causando o travamento — a comparação
  // em si continua sendo pela chave normalizada, sem mudança de lógica.
  const map = new Map();
  (state.invJustificativas || []).forEach(j => {
    const doc = j && j.documentoSap;
    if (doc && String(doc).trim()) map.set(_fechImportNormDoc(doc), String(doc).trim());
  });
  return map;
}

// Um registro SAP tem seu Documento "justificado no Inventário" quando
// (a) bate no padrão Y11/Y12 de fechamento E (b) o número do documento
// aparece em alguma justificativa do Inventário. Escopo intencionalmente
// restrito a (a) — por decisão do Hugo, isto NÃO é um mecanismo de
// exclusão genérico por documento, só uma trava adicional sobre o mesmo
// universo de candidatos já coberto por isSapFechamentoPattern.
function isSapDocJustificadoInventario(r) {
  if (!isSapFechamentoPattern(r)) return false;
  return _getInvJustDocSet().has(_fechImportNormDoc(r.documento));
}

// Verdadeira função de decisão usada por TODO o sistema: um registro deve
// ser desconsiderado do cálculo de variação/entradas/saídas se:
//   (1) o Documento SAP está justificado em alguma linha do Inventário —
//       trava incondicional, verificada ANTES do override manual, então
//       nenhum "Considerar Ajuste" no modal de Fechamento consegue
//       reincluir esse registro enquanto o campo continuar preenchido; OU
//   (2) bate no padrão de fechamento E não foi reincluído manualmente
//       pelo analista (comportamento original, automático por data).
function isSapExcluidoPorFechamento(r) {
  if (!isSapFechamentoPattern(r)) return false;
  if (isSapDocJustificadoInventario(r)) return true;
  return !_getFechOverrideSet().has(getSapFechKey(r));
}

// Soma Peso (kg) e Custo Total (R$) de um conjunto de registros SAP —
// usada nos rodapés dos modais/popovers de Ajustes desconsiderados.
// Custo Total: usa valorTotal quando disponível; senão custoUnit × |peso|.
function somarPesoCustoSap(records) {
  let peso = 0, custo = 0;
  (records || []).forEach(r => {
    peso += num(r.peso);
    const vt = num(r.valorTotal);
    custo += vt !== 0 ? vt : (num(r.custoUnit) * Math.abs(num(r.peso)));
  });
  return { peso, custo };
}

// Mesma ideia de somarPesoCustoSap, mas para Entradas/Saídas — nesses dois
// módulos o campo de custo unitário se chama `custo` (não `custoUnit` como
// no SAP). Usada pelos cards-resumo das páginas Entradas/Saídas.
function somarPesoValor(records) {
  let peso = 0, valor = 0;
  (records || []).forEach(r => {
    peso += num(r.peso);
    const vt = num(r.valorTotal);
    valor += vt !== 0 ? vt : (num(r.custo) * Math.abs(num(r.peso)));
  });
  return { peso, valor };
}

// Mesma ideia de somarPesoValor, mas específica de ENTRADAS — aplica a MESMA
// conversão de unidade de medida já usada no modal "Pendentes de Integração
// SAP" (_convertNfPesoToKg, definida acima): o peso de uma NF pode vir em
// TO ou M³ (fator dependente do material), não só em KG. Sem essa conversão,
// os cards por central somariam grandezas de unidades diferentes juntas.
// O CUSTO (fallback custoUnit×peso) continua usando o peso BRUTO — o custo
// unitário cadastrado é sempre relativo à unidade original do registro
// (ex.: R$/TO), não ao kg já convertido. Saídas NÃO usa esta função: o
// sistema trata OS de propósito com peso bruto, sem conversão (ver
// calcPendentesIntegracao/comentário de _convertNfPesoToKg acima).
function somarPesoValorEntradas(records) {
  let peso = 0, valor = 0;
  (records || []).forEach(r => {
    peso += _convertNfPesoToKg(r.peso, r.um, r.material);
    const vt = num(r.valorTotal);
    valor += vt !== 0 ? vt : (num(r.custo) * Math.abs(num(r.peso)));
  });
  return { peso, valor };
}

// ═══════════════════════════════════════════════════════════
// CARDS-RESUMO — ENTRADAS / SAÍDAS / SAP
// Reaproveitam o componente .inv-kpi-card (mesmo usado no Inventário/
// Dashboard/Fechamento) — total geral em destaque + grid por grupo
// (central pra Entradas/Saídas, código de movimento pro SAP). Sempre
// reativos ao filtro atual da tabela (getFilteredData), sem duplicar
// lógica de filtro. Estado de "ver todas" é mantido por containerId e
// resetado ao trocar de página (não precisa persistir entre sessões).
// ═══════════════════════════════════════════════════════════
const _modSummaryExpandState = {};

function _toggleModSummaryExpand(containerId) {
  _modSummaryExpandState[containerId] = !_modSummaryExpandState[containerId];
  if (containerId === 'ent-summary-cards') renderEntradasSummary();
  else if (containerId === 'sai-summary-cards') renderSaidasSummary();
  else if (containerId === 'sap-summary-cards') renderSapSummary();
  else if (containerId === 'lanc-summary-cards') renderLancamentosSummary();
}
window._toggleModSummaryExpand = _toggleModSummaryExpand;

// Monta o HTML de 1 card de destaque "extra" no bloco hero — usado pelo SAP
// pros cards de Total de Entradas/Total de Saídas (por sinal do peso).
// Reaproveita o MESMO template dos cards de grupo (valor=peso, unit=custo
// + contagem opcional), só que na área de destaque (.inv-kpi-card-featured).
function _heroSubCardHtml({ icon, iconBg, iconColor, label, unitLabel, peso, custo, count, title }) {
  return `
      <div class="inv-kpi-card inv-kpi-card-featured"${title ? ` title="${escapeHtml(title)}"` : ''}>
        <div class="inv-kpi-icon" style="background:${iconBg};color:${iconColor}"><i class="ti ${icon}"></i></div>
        <div class="inv-kpi-body">
          <div class="inv-kpi-label">${escapeHtml(label)}</div>
          <div class="inv-kpi-value">${fmtKg(peso)}</div>
          <div class="inv-kpi-unit">${money(custo)}${count !== undefined ? ` · ${count.toLocaleString('pt-BR')} registro(s)` : ''}</div>
        </div>
      </div>`;
}

// Monta o HTML do bloco: cards de total geral (Peso/Custo, + Registros se
// totalCount for informado, + cards extras se extraHeroCards for informado)
// em destaque + grid de cards por grupo, ordenados por peso absoluto desc,
// limitados a topN até o usuário clicar em "ver todas". grupoLabelFn permite
// customizar o rótulo do card (ex.: badge colorido de código de movimento
// no SAP); por padrão usa o texto simples do grupo (ex.: nome da central).
// totalCount/g.count/extraHeroCards são OPCIONAIS — só aparecem quando o
// chamador informa (Entradas e SAP usam totalCount/count; só SAP usa
// extraHeroCards; Saídas não usa nenhum dos dois).
function _buildResumoCardsHtml({ totalLabel, totalPeso, totalValor, totalCount, grupos, grupoNomePlural, topN, containerId, grupoLabelFn, extraHeroCards, pesoLabel, sortMode, modulo, grupoTituloFn }) {
  if (!grupos.length) {
    return `<div class="mod-summary-empty">Nenhum registro no filtro atual.</div>`;
  }

  const expandido = !!_modSummaryExpandState[containerId];
  // sortMode: 'alfabetica' (Entradas/Saídas/Lançamentos — cards de central)
  // ordena pelo rótulo (A-Z, pt-BR). Padrão ('peso', usado pelo SAP — cards
  // de código de movimento) mantém a ordenação por peso absoluto desc.
  const ordenados = grupos.slice().sort((a, b) =>
    sortMode === 'alfabetica'
      ? String(a.label).localeCompare(String(b.label), 'pt-BR', { sensitivity: 'base' })
      : Math.abs(b.peso) - Math.abs(a.peso)
  );
  const visiveis = expandido ? ordenados : ordenados.slice(0, topN);
  const restantes = ordenados.length - visiveis.length;
  const _pesoLabel = pesoLabel || 'Peso Total';

  const countCardHtml = totalCount !== undefined ? `
      <div class="inv-kpi-card inv-kpi-card-featured">
        <div class="inv-kpi-icon" style="background:var(--bg3);color:var(--text2)"><i class="ti ti-list-numbers"></i></div>
        <div class="inv-kpi-body">
          <div class="inv-kpi-label">${escapeHtml(totalLabel)} · Registros</div>
          <div class="inv-kpi-value">${totalCount.toLocaleString('pt-BR')}</div>
          <div class="inv-kpi-unit">registro(s) no filtro atual</div>
        </div>
      </div>` : '';

  const extraHtml = (extraHeroCards || []).join('');

  const heroHtml = `
    <div class="mod-summary-hero">
      <div class="inv-kpi-card inv-kpi-card-featured">
        <div class="inv-kpi-icon" style="background:var(--accent-dim);color:var(--accent)"><i class="ti ti-scale"></i></div>
        <div class="inv-kpi-body">
          <div class="inv-kpi-label">${escapeHtml(totalLabel)} · ${escapeHtml(_pesoLabel)}</div>
          <div class="inv-kpi-value">${fmtKg(totalPeso)}</div>
          <div class="inv-kpi-unit">kg — soma do filtro atual</div>
        </div>
      </div>
      <div class="inv-kpi-card inv-kpi-card-featured">
        <div class="inv-kpi-icon" style="background:var(--green-bg);color:var(--green)"><i class="ti ti-currency-dollar"></i></div>
        <div class="inv-kpi-body">
          <div class="inv-kpi-label">${escapeHtml(totalLabel)} · Custo Total</div>
          <div class="inv-kpi-value">${money(totalValor)}</div>
          <div class="inv-kpi-unit">soma do filtro atual</div>
        </div>
      </div>${countCardHtml}${extraHtml}
    </div>`;

  // Cards de GRUPO (não os de total geral) são clicáveis quando `modulo` é
  // informado — abrem o modal de detalhamento por material (ver
  // _abrirModalDetalheMaterial). Usa data-attributes em vez de interpolar
  // o valor direto no onclick pra não quebrar com nomes de central/material
  // que tenham aspas simples (escapeHtml não trata aspas simples, só é
  // seguro pra atributos, não pra dentro de uma string JS de onclick).
  const gridHtml = `
    <div class="mod-summary-grid">
      ${visiveis.map(g => {
        const clicavel = modulo ? ` onclick="_abrirModalDetalheMaterialFromEl(this)" data-modulo="${escapeHtml(modulo)}" data-grupo="${escapeHtml(g.label)}" data-titulo="${escapeHtml(grupoTituloFn ? grupoTituloFn(g) : g.label)}" title="Ver detalhamento por material"` : '';
        return `
        <div class="inv-kpi-card"${clicavel}>
          <div class="inv-kpi-body">
            <div class="inv-kpi-label">${grupoLabelFn ? grupoLabelFn(g) : escapeHtml(g.label)}</div>
            <div class="inv-kpi-value">${fmtKg(g.peso)}</div>
            <div class="inv-kpi-unit">${money(g.valor)}</div>
            ${g.count !== undefined ? `<div class="inv-kpi-unit">${g.count.toLocaleString('pt-BR')} registro(s)</div>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>`;

  const toggleHtml = ordenados.length > topN
    ? `<button class="mod-summary-toggle" onclick="_toggleModSummaryExpand('${containerId}')">
         <i class="ti ti-chevron-${expandido ? 'up' : 'down'}"></i>
         ${expandido ? 'Ver menos' : `Ver todas as ${escapeHtml(grupoNomePlural)} (+${restantes})`}
       </button>`
    : '';

  return heroHtml + gridHtml + toggleHtml;
}

// Agrupa um array de registros por uma chave (função ou nome de campo) e
// retorna [{ key, records }], sem depender de agregações prévias — reaproveitável
// pelos 3 renders abaixo.
function _agruparRegistros(records, keyFn) {
  const map = new Map();
  (records || []).forEach(r => {
    const key = keyFn(r) || '—';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  });
  return map;
}

// Soma peso/custo de um conjunto de registros, unificando o formato de
// retorno ({peso, valor}) independente do módulo — Entradas usa
// somarPesoValorEntradas (com conversão de unidade), Saídas usa
// somarPesoValor (sem conversão), Lançamentos/SAP usam somarPesoCustoSap
// (retorna {peso, custo} em vez de {peso, valor} — normalizado aqui).
function _somaGenericaPorModulo(modulo, records) {
  if (modulo === 'entradas') return somarPesoValorEntradas(records);
  if (modulo === 'saidas') return somarPesoValor(records);
  const { peso, custo } = somarPesoCustoSap(records);
  return { peso, valor: custo };
}

// ═══════════════════════════════════════════════════════════
// MODAL — Detalhamento por Material (clique num card de grupo)
// Reaproveita o mesmo padrão de modal dinâmico já usado no Inventário
// (.modal-overlay > .modal-card com .modal-header/.modal-body/.modal-footer,
// injetado via JS, ESC fecha + botão explícito — NUNCA fecha ao clicar
// fora). A tabela usa <table>/<thead>/<tbody> puro: o CSS global de
// thead th/tbody tr já estiliza automaticamente, sem precisar de classe.
// ═══════════════════════════════════════════════════════════
function _abrirModalDetalheMaterialFromEl(el) {
  _abrirModalDetalheMaterial(el.dataset.modulo, el.dataset.grupo, el.dataset.titulo);
}
window._abrirModalDetalheMaterialFromEl = _abrirModalDetalheMaterialFromEl;

function _abrirModalDetalheMaterial(modulo, grupoValor, grupoTitulo) {
  const data = getFilteredData(modulo);
  let recsDoGrupo, tituloModulo;
  if (modulo === 'entradas') {
    recsDoGrupo = data.filter(r => (r.centralDestino || '—') === grupoValor);
    tituloModulo = 'Entradas';
  } else if (modulo === 'saidas') {
    recsDoGrupo = data.filter(r => (r.central || '—') === grupoValor);
    tituloModulo = 'Saídas';
  } else if (modulo === 'lancamentos') {
    recsDoGrupo = data.filter(r => (r.central || '—') === grupoValor);
    tituloModulo = 'Lançamentos';
  } else if (modulo === 'sap') {
    recsDoGrupo = data.filter(r => normMov(r.movimento) === grupoValor);
    tituloModulo = 'SAP';
  } else {
    return;
  }

  const porMaterial = _agruparRegistros(recsDoGrupo, r => r.material);
  const linhas = [...porMaterial.entries()].map(([material, recs]) => {
    const { peso, valor } = _somaGenericaPorModulo(modulo, recs);
    return { material, peso, valor, count: recs.length };
  }).sort((a, b) => Math.abs(b.peso) - Math.abs(a.peso));
  const totais = _somaGenericaPorModulo(modulo, recsDoGrupo);

  let modal = document.getElementById('mod-material-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'mod-material-modal';
    modal.className = 'modal-overlay';
    modal.style.cssText = 'position:fixed;z-index:9999';
    document.body.appendChild(modal);
  }

  const linhasHtml = linhas.length ? linhas.map(l => `
    <tr>
      <td>${escapeHtml(l.material || '—')}</td>
      <td style="text-align:right">${fmtKg(l.peso)}</td>
      <td style="text-align:right">${money(l.valor)}</td>
      <td style="text-align:right;color:var(--text3)">${l.count}</td>
    </tr>`).join('') : `
    <tr><td colspan="4" style="text-align:center;padding:28px;color:var(--text3)">Nenhum material encontrado no filtro atual.</td></tr>`;

  modal.innerHTML = `
    <div class="modal-card" style="max-width:640px;width:94vw">
      <div class="modal-header">
        <div>
          <span class="modal-title"><i class="ti ti-list-details"></i> ${escapeHtml(tituloModulo)} · ${escapeHtml(grupoTitulo)}</span>
          <div style="font-size:11px;color:var(--text2);margin-top:3px">Total por material — respeitando o filtro atual da tabela</div>
        </div>
        <button class="modal-close" onclick="_fecharModalDetalheMaterial()"><i class="ti ti-x"></i></button>
      </div>
      <div class="modal-body" style="max-height:60vh;overflow-y:auto;padding:0">
        <table style="width:100%">
          <thead>
            <tr>
              <th>Material</th>
              <th style="text-align:right">Peso</th>
              <th style="text-align:right">Custo</th>
              <th style="text-align:right">Registros</th>
            </tr>
          </thead>
          <tbody>${linhasHtml}</tbody>
        </table>
      </div>
      <div class="modal-footer" style="justify-content:space-between">
        <span style="font-size:12px;color:var(--text3)">${linhas.length} material${linhas.length === 1 ? '' : 'is'}</span>
        <div style="display:flex;gap:16px;font-size:12px;font-weight:700">
          <span>${fmtKg(totais.peso)}</span>
          <span style="color:var(--green)">${money(totais.valor)}</span>
        </div>
      </div>
    </div>`;
  modal.classList.add('open');

  const _escModMaterial = e => {
    if (!document.body.contains(modal)) { document.removeEventListener('keydown', _escModMaterial); return; }
    if (e.key === 'Escape') window._fecharModalDetalheMaterial();
  };
  document.addEventListener('keydown', _escModMaterial);
}
window._abrirModalDetalheMaterial = _abrirModalDetalheMaterial;

function _fecharModalDetalheMaterial() {
  document.getElementById('mod-material-modal')?.classList.remove('open');
}
window._fecharModalDetalheMaterial = _fecharModalDetalheMaterial;

function renderEntradasSummary() {
  const el = document.getElementById('ent-summary-cards');
  if (!el) return;
  const data = getFilteredData('entradas');
  const { peso: totalPeso, valor: totalValor } = somarPesoValorEntradas(data);
  const porCentral = _agruparRegistros(data, r => r.centralDestino);
  const grupos = [...porCentral.entries()].map(([label, recs]) => {
    const { peso, valor } = somarPesoValorEntradas(recs);
    return { label, peso, valor, count: recs.length };
  });
  el.innerHTML = _buildResumoCardsHtml({
    totalLabel: 'Entradas', totalPeso, totalValor, totalCount: data.length, grupos,
    grupoNomePlural: 'centrais', topN: 6, containerId: 'ent-summary-cards', sortMode: 'alfabetica', modulo: 'entradas'
  });
}
window.renderEntradasSummary = renderEntradasSummary;

function renderSaidasSummary() {
  const el = document.getElementById('sai-summary-cards');
  if (!el) return;
  const data = getFilteredData('saidas');
  const { peso: totalPeso, valor: totalValor } = somarPesoValor(data);
  const porCentral = _agruparRegistros(data, r => r.central);
  const grupos = [...porCentral.entries()].map(([label, recs]) => {
    const { peso, valor } = somarPesoValor(recs);
    return { label, peso, valor };
  });
  el.innerHTML = _buildResumoCardsHtml({
    totalLabel: 'Saídas', totalPeso, totalValor, grupos,
    grupoNomePlural: 'centrais', topN: 6, containerId: 'sai-summary-cards', sortMode: 'alfabetica', modulo: 'saidas'
  });
}
window.renderSaidasSummary = renderSaidasSummary;

function renderSapSummary() {
  const el = document.getElementById('sap-summary-cards');
  if (!el) return;
  const data = getFilteredData('sap');
  const { peso: totalPeso, custo: totalValor } = somarPesoCustoSap(data);
  const porMov = _agruparRegistros(data, r => normMov(r.movimento));
  const grupos = [...porMov.entries()].map(([cod, recs]) => {
    const { peso, custo } = somarPesoCustoSap(recs);
    return { label: cod, cod, peso, valor: custo, count: recs.length };
  });

  // Total de Entradas/Saídas — pelo SINAL do peso (decisão do Hugo), cobre
  // 100% dos registros do filtro (inclusive códigos de transferência/
  // fechamento), diferente do critério por CÓDIGO (101/801/201) usado no
  // Dashboard Gerencial. peso===0 não entra em nenhum dos dois.
  const recsEntrada = data.filter(r => num(r.peso) > 0);
  const recsSaida   = data.filter(r => num(r.peso) < 0);
  const { peso: pesoEnt, custo: custoEnt } = somarPesoCustoSap(recsEntrada);
  const { peso: pesoSai, custo: custoSai } = somarPesoCustoSap(recsSaida);

  el.innerHTML = _buildResumoCardsHtml({
    totalLabel: 'SAP', totalPeso, totalValor, totalCount: data.length, grupos,
    grupoNomePlural: 'movimentações', topN: 8, containerId: 'sap-summary-cards',
    grupoLabelFn: g => movBadgeHtml(g.cod),
    modulo: 'sap', grupoTituloFn: g => 'Movimento ' + g.cod,
    extraHeroCards: [
      _heroSubCardHtml({
        icon: 'ti-package-import', iconBg: 'var(--green-bg)', iconColor: 'var(--green)',
        label: 'SAP · Total de Entradas', peso: pesoEnt, custo: custoEnt, count: recsEntrada.length,
        title: 'Todos os registros com peso positivo no filtro atual'
      }),
      _heroSubCardHtml({
        icon: 'ti-package-export', iconBg: 'var(--red-bg)', iconColor: 'var(--red)',
        label: 'SAP · Total de Saídas', peso: Math.abs(pesoSai), custo: Math.abs(custoSai), count: recsSaida.length,
        title: 'Todos os registros com peso negativo no filtro atual'
      })
    ]
  });
}
window.renderSapSummary = renderSapSummary;

// LANÇAMENTOS — "Est. Total" (peso) e "Custo Total", somando tudo que está
// na tabela FILTRADA agora (sem lógica de período/Est. Inicial-Final — isso
// fica pra quando retomarmos aquela discussão). Usa somarPesoCustoSap
// direto porque os registros de Lançamentos usam os MESMOS nomes de campo
// do SAP (custoUnit/valorTotal), não custo/valorTotal como Entradas/Saídas.
function renderLancamentosSummary() {
  const el = document.getElementById('lanc-summary-cards');
  if (!el) return;
  const data = getFilteredData('lancamentos');
  const { peso: totalPeso, custo: totalValor } = somarPesoCustoSap(data);
  const porCentral = _agruparRegistros(data, r => r.central);
  const grupos = [...porCentral.entries()].map(([label, recs]) => {
    const { peso, custo } = somarPesoCustoSap(recs);
    return { label, peso, valor: custo, count: recs.length };
  });
  el.innerHTML = _buildResumoCardsHtml({
    totalLabel: 'Lançamentos', totalPeso, totalValor, totalCount: data.length, grupos,
    grupoNomePlural: 'centrais', topN: 6, containerId: 'lanc-summary-cards',
    pesoLabel: 'Est. Total', sortMode: 'alfabetica', modulo: 'lancamentos'
  });
}
window.renderLancamentosSummary = renderLancamentosSummary;

// ── Override manual (reincluir/reexcluir do cálculo) ──────────────────────
// incluir=true: registro passa a contar no cálculo mesmo batendo no padrão.
// incluir=false: remove o override (volta ao comportamento automático).
function setSapFechOverrideEmLote(chaves, incluir) {
  if (!Array.isArray(chaves) || !chaves.length) return;
  const set = new Set(state.sapFechamentoOverrides || []);
  chaves.forEach(k => { if (incluir) set.add(k); else set.delete(k); });
  state.sapFechamentoOverrides = [...set];
  invalidateFechOverrideCache();
  if (typeof persist === 'function') persist();

  if (!window.supabaseClient) return;
  if (incluir) {
    const rows = chaves.map(chave => ({ chave }));
    window.supabaseClient.from('sap_fechamento_overrides').upsert(rows, { onConflict: 'user_id,chave' })
      .then(({ error }) => { if (error) console.warn('[Supabase] Falha ao sincronizar override de fechamento:', error); });
  } else {
    window.supabaseClient.from('sap_fechamento_overrides').delete().in('chave', chaves)
      .then(({ error }) => { if (error) console.warn('[Supabase] Falha ao remover override de fechamento na nuvem:', error); });
  }
}

async function syncSapFechamentoOverridesFromSupabase() {
  try {
    const { data, error } = await window.supabaseClient.from('sap_fechamento_overrides').select('chave');
    if (error) throw error;
    const set = new Set(state.sapFechamentoOverrides || []);
    (data || []).forEach(r => set.add(r.chave));
    state.sapFechamentoOverrides = [...set];
    invalidateFechOverrideCache();
  } catch (err) {
    console.warn('[Supabase] Falha ao buscar overrides de fechamento — mantendo dados locais.', err);
  }
}

// ═══════════════════════════════════════════════════════════
// MODAL: GERENCIAR AJUSTES DE FECHAMENTO MENSAL (Y11/Y12)
// ═══════════════════════════════════════════════════════════
// Ferramenta de gestão GLOBAL (não escopada a central/período) dos Ajustes
// de Fechamento detectados em todo o state.sap — agrupados por mês, com
// seleção em massa/individual e filtro por coluna. Aberta pelo botão
// "Fechamento" da página Movimentações SAP (ver abrirFechManager). Toda a
// decisão de incluir/desconsiderar acontece aqui — a tabela SAP em si só
// mostra o destaque visual passivo (linha + badge), sem interação.
//
// O filtro por coluna replica visualmente o "COLUMN FILTER ENGINE" usado
// no resto do sistema (mesmas classes .cf-popover/.cf-row/.cf-list etc,
// reaproveitando buildColFilterHTML), mas com estado e wiring PRÓPRIOS
// (_fechMgrColFilters, _fechMgrPopover...) — não usa colFilters[module]
// nem _cfPopover porque este modal não é um "módulo" da paginação genérica
// (pages/renderModuleByName), e sim uma lista computada (candidatos Y11/Y12
// de todo o SAP), então integrá-lo ao motor genérico exigiria alterar
// funções centrais usadas por todas as outras tabelas — risco desnecessário
// para uma tela com volume de dados tipicamente pequeno (dezenas/centenas
// de registros por mês, nunca a escala de 600k do SAP completo).

const _fechMgrColFilters   = {};        // { colIdx: Set<string valor normalizado> }
const _fechMgrSelecionados = new Set(); // Set<chave (getSapFechKey)>
let _fechMgrPopover     = null;
let _fechMgrPopColIdx   = null;
let _fechMgrPage        = 0;    // página atual (0-based) — evita renderizar milhares de linhas de uma vez
let _fechMgrLastFiltrados = [];  // cache do resultado filtrado+ordenado do último render — reaproveitado
                                  // pra não recalcular tudo de novo a cada clique de checkbox individual

// Índice da coluna (na <thead> do modal) → campo do registro. null = sem
// filtro discreto nessa coluna (checkbox, Peso e Custo Total são valores
// contínuos — não fazem sentido como lista de valores únicos, mesmo padrão
// já usado nas colunas de valor das outras tabelas do sistema).
const _FECHMGR_COLS = [null, 'usuario', 'movimento', 'central', 'deposito', 'material', 'documento', 'dtLanc', 'dtReg', null, null, '_statusLabel'];

// Cache dos registros SAP BRUTOS que batem no padrão de fechamento — a
// varredura de isSapFechamentoPattern acontece sobre TODO o state.sap
// (600k+ registros), então é recalculada uma única vez por abertura do
// modal (ver abrirFechManager, que zera este cache) em vez de a cada
// clique num filtro de coluna. O que muda a cada render (status
// desconsiderado/incluído) é barato de recalcular por registro.
let _fechMgrCandidatosRawCache = null;

// Todos os candidatos de TODO o state.sap (não filtrado por período/central
// — é uma ferramenta de gestão global), já enriquecidos com os campos
// computados usados pela tabela/filtros do modal.
//
// Otimização: como _fechMgrCandidatosRawCache já contém SÓ registros que
// bateram isSapFechamentoPattern, não precisamos checar de novo aqui — só
// precisamos saber se cada um está no Set de overrides (reincluído
// manualmente). Chamar isSapExcluidoPorFechamento(r) de novo repetiria o
// isSapFechamentoPattern (já sabido) E getSapFechKey (já calculado abaixo)
// à toa — em 3-4 mil registros isso soma bastante trabalho redundante toda
// vez que o modal renderiza.
function _fechMgrGetTodosCandidatos() {
  if (!_fechMgrCandidatosRawCache) {
    _fechMgrCandidatosRawCache = (state.sap || []).filter(isSapFechamentoPattern);
  }
  const overrideSet = _getFechOverrideSet();
  const invDocMap = _getInvJustDocSet(); // sem cache, de propósito — ver _getInvJustDocSet
  return _fechMgrCandidatosRawCache.map(r => {
    const chave = getSapFechKey(r);
    // Documento justificado no Inventário tem prioridade: trava a exclusão
    // independente do override manual (mesma regra de isSapExcluidoPorFechamento,
    // reaplicada aqui pra exibir o motivo certo em vez de só o resultado).
    const docNorm = _fechImportNormDoc(r.documento);
    const travadoPorInventario = invDocMap.has(docNorm);
    const excluido = travadoPorInventario ? true : !overrideSet.has(chave);
    let statusLabel;
    if (travadoPorInventario) statusLabel = 'Justificado no Inventário';
    else if (excluido)        statusLabel = 'Desconsiderado';
    else                      statusLabel = 'Incluído manualmente';
    return {
      ...r,
      _chave: chave,
      _statusLabel: statusLabel,
      _statusExcluido: excluido,
      // Valores crus pro diagnóstico no tooltip do cadeado — mostra lado a
      // lado o que veio do SAP e o que está salvo no Inventário, mesmo que
      // pareçam "iguais" a olho nu (ajuda a pegar espaço/zero à esquerda
      // escondido, formatação diferente, etc.).
      _travadoDocSap: r.documento,
      _travadoDocInvOriginal: invDocMap.get(docNorm) || '',
      _travadoPorInventario: travadoPorInventario
    };
  });
}

// Aplica os filtros de coluna ativos sobre a lista de candidatos.
function _fechMgrAplicarFiltros(lista, { excludeColIdx = null } = {}) {
  const entries = Object.entries(_fechMgrColFilters).filter(([, s]) => s && s.size > 0);
  if (!entries.length) return lista;
  return lista.filter(r => {
    for (const [colIdx, activeSet] of entries) {
      if (excludeColIdx !== null && Number(colIdx) === Number(excludeColIdx)) continue;
      const field = _FECHMGR_COLS[Number(colIdx)];
      if (!field) continue;
      const cellVal = normalizeText(String(r[field] ?? '—'));
      if (!activeSet.has(cellVal)) return false;
    }
    return true;
  });
}

// Valores únicos disponíveis para o dropdown de uma coluna — respeita os
// DEMAIS filtros ativos (estilo Excel: a lista de opções reflete o que
// ainda é alcançável), exceto o da própria coluna.
function _fechMgrGetColUniqueValues(colIdx) {
  const field = _FECHMGR_COLS[colIdx];
  if (!field) return [];
  const base = _fechMgrAplicarFiltros(_fechMgrGetTodosCandidatos(), { excludeColIdx: colIdx });
  const set = new Set();
  base.forEach(r => set.add(normalizeText(String(r[field] ?? '—'))));
  return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function abrirFechManager() {
  const overlay = document.getElementById('fech-manager-overlay');
  if (!overlay) return;
  _fechMgrSelecionados.clear();
  _fechMgrPage = 0;
  _fechMgrCandidatosRawCache = null; // força reler o state.sap atual
  Object.keys(_fechMgrColFilters).forEach(k => delete _fechMgrColFilters[k]);
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  _fechMgrInjectColFilterButtons();
  _fechMgrRender();
}
window.abrirFechManager = abrirFechManager;

function fecharFechManager() {
  _fechMgrClosePopover();
  const overlay = document.getElementById('fech-manager-overlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
}
window.fecharFechManager = fecharFechManager;

function _fechMgrRender() {
  const tbody = document.getElementById('fechmgr-tbody');
  const cardsEl = document.getElementById('fechmgr-cards');
  const subEl = document.getElementById('fechmgr-sub');
  if (!tbody) return;

  const todos = _fechMgrGetTodosCandidatos();
  const filtrados = _fechMgrAplicarFiltros(todos);

  // Resumo em cards agora reflete o FILTRO ATUAL da tabela (não mais
  // sempre o total geral) — pedido explícito: os KPIs devem responder
  // aos filtros de coluna aplicados, servindo como um "subtotal" do que
  // está sendo exibido. Sem filtro ativo, filtrados === todos e o
  // comportamento não muda.
  // Peso/Custo somam TODOS os registros filtrados, independente do status
  // (desconsiderado ou incluído manualmente) — só as contagens abaixo
  // (Desconsiderados/Incluídos manualmente) continuam segmentadas por
  // status, já que é essa a razão de existir delas.
  const desconsiderados = filtrados.filter(r => r._statusExcluido);
  const incluidosManual = filtrados.filter(r => !r._statusExcluido);
  const travadosPorInventario = filtrados.filter(r => r._travadoPorInventario).length;
  const { peso: pesoFiltro, custo: custoFiltro } = somarPesoCustoSap(filtrados);
  const filtroAtivo = filtrados.length !== todos.length;

  if (subEl) {
    subEl.textContent = filtroAtivo
      ? `${todos.length} registro(s) detectado(s) — exibindo ${filtrados.length} com o filtro atual`
      : `${todos.length} registro(s) detectado(s) em todo o histórico`;
  }

  // Resumo em cards — mesmo componente visual usado no Inventário/Dashboard
  // (.inv-kpi-card), pra manter consistência com o resto do sistema.
  if (cardsEl) {
    cardsEl.innerHTML = `
      <div class="inv-kpi-card">
        <div class="inv-kpi-icon" style="background:var(--purple-bg);color:var(--purple)"><i class="ti ti-calendar-check"></i></div>
        <div class="inv-kpi-body">
          <div class="inv-kpi-label">Desconsiderados</div>
          <div class="inv-kpi-value">${desconsiderados.length}</div>
          <div class="inv-kpi-unit">${filtroAtivo ? `de ${filtrados.length} exibido(s) no filtro` : `de ${todos.length} detectado(s)`}${travadosPorInventario ? ` · ${travadosPorInventario} via Inventário` : ''}</div>
        </div>
      </div>
      <div class="inv-kpi-card">
        <div class="inv-kpi-icon" style="background:var(--bg3);color:var(--text2)"><i class="ti ti-scale"></i></div>
        <div class="inv-kpi-body">
          <div class="inv-kpi-label">Peso total filtrado</div>
          <div class="inv-kpi-value">${fmtKg(pesoFiltro)}</div>
          <div class="inv-kpi-unit">kg, soma bruta — considerados + desconsiderados</div>
        </div>
      </div>
      <div class="inv-kpi-card">
        <div class="inv-kpi-icon" style="background:var(--bg3);color:var(--text2)"><i class="ti ti-currency-dollar"></i></div>
        <div class="inv-kpi-body">
          <div class="inv-kpi-label">Custo total filtrado</div>
          <div class="inv-kpi-value">${money(custoFiltro)}</div>
          <div class="inv-kpi-unit">custo total — considerados + desconsiderados</div>
        </div>
      </div>
      <div class="inv-kpi-card">
        <div class="inv-kpi-icon" style="background:var(--accent-dim);color:var(--accent)"><i class="ti ti-hand-click"></i></div>
        <div class="inv-kpi-body">
          <div class="inv-kpi-label">Incluídos manualmente</div>
          <div class="inv-kpi-value">${incluidosManual.length}</div>
          <div class="inv-kpi-unit">reincluídos no cálculo</div>
        </div>
      </div>`;
  }

  // Ordena uma vez e guarda em cache — reaproveitado por _fechMgrAtualizarBarraLote
  // e pela navegação de página, pra não repetir filtro+sort a cada clique.
  const ordenados = filtrados.slice().sort((a, b) => dateCmp(parseDate(b.dtLanc) || new Date(0), parseDate(a.dtLanc) || new Date(0)));
  _fechMgrLastFiltrados = ordenados;

  if (!ordenados.length) {
    tbody.innerHTML = `<tr><td colspan="12"><div class="empty-state"><i class="ti ti-calendar-check"></i><p>${todos.length ? 'Nenhum registro corresponde ao filtro.' : 'Nenhum Ajuste de Fechamento Mensal detectado.'}</p></div></td></tr>`;
    _fechMgrRenderPaginacao(0, 0);
    _fechMgrAtualizarBarraLote();
    _fechMgrUpdateColFilterIcons();
    return;
  }

  // ── Paginação: só monta o HTML da página atual, não da lista inteira —
  // é o que evita travar a UI com milhares de linhas de uma vez. ──────────
  const totalPaginas = Math.max(1, Math.ceil(ordenados.length / PAGE_SIZE));
  _fechMgrPage = Math.min(Math.max(0, _fechMgrPage), totalPaginas - 1);
  const inicio = _fechMgrPage * PAGE_SIZE;
  const pagina = ordenados.slice(inicio, inicio + PAGE_SIZE);

  tbody.innerHTML = pagina.map(r => {
    const neg = num(r.peso) < 0;
    const custoLinha = num(r.valorTotal) !== 0 ? num(r.valorTotal) : (num(r.custoUnit) * Math.abs(num(r.peso)));
    const checked = _fechMgrSelecionados.has(r._chave);
    // Status como indicador compacto (bolinha colorida + tooltip) em vez de
    // badge de texto — libera espaço horizontal pra material/valores, que
    // são as colunas que realmente importam pra decisão. Cadeado (teal) tem
    // prioridade sobre os outros dois — trava real, não reversível aqui.
    const statusDot = r._travadoPorInventario
      ? `<i class="ti ti-lock fechmgr-status-icon fechmgr-status-icon--travado" title="Travado — Documento SAP desta linha: '${escapeHtml(r._travadoDocSap)}'. Encontrado na justificativa do Inventário como: '${escapeHtml(r._travadoDocInvOriginal)}'. Para reverter, apague o campo Documento SAP NAQUELA justificativa e verifique se não sobrou outra igual."></i>`
      : r._statusExcluido
        ? `<i class="ti ti-circle-x fechmgr-status-icon fechmgr-status-icon--desc" title="Desconsiderado do cálculo de variação"></i>`
        : `<i class="ti ti-circle-check fechmgr-status-icon fechmgr-status-icon--inc" title="Incluído manualmente no cálculo (considerado)"></i>`;
    // Escapa uma vez e reaproveita no title + conteúdo visível — antes só o
    // title era escapado; o texto exibido ia direto sem escapeHtml, então
    // um material/usuário/documento com "<", ">" ou "&" (comum em specs
    // técnicas, ex: "Ø<25mm") quebrava o HTML da linha.
    const usuarioSafe   = escapeHtml(r.usuario || '—');
    const movimentoSafe = escapeHtml(r.movimento || '—');
    const centralSafe   = escapeHtml(r.central || '—');
    const depositoSafe  = escapeHtml(r.deposito || '—');
    const materialSafe  = escapeHtml(r.material || r.materialOriginal || '—');
    const documentoSafe = escapeHtml(r.documento || '—');
    const dtLancSafe    = escapeHtml(r.dtLanc || '—');
    const dtRegSafe     = escapeHtml(r.dtReg || '—');
    const rowClass = r._travadoPorInventario ? 'fechmgr-row-travado' : (r._statusExcluido ? '' : 'fechmgr-row-incluido');
    const checkboxHtml = r._travadoPorInventario
      ? `<input type="checkbox" disabled title="Travado — Documento justificado no Inventário, não pode ser incluído/excluído em lote aqui.">`
      : `<input type="checkbox" ${checked ? 'checked' : ''} onchange="_fechMgrToggleSelecao('${r._chave.replace(/'/g,"\\'")}', this.checked)">`;
    return `
    <tr class="${rowClass}">
      <td class="th-checkbox">${checkboxHtml}</td>
      <td class="td-mono" title="${usuarioSafe}">${usuarioSafe}</td>
      <td class="td-mono" style="color:${neg ? '#ef4444' : '#22c55e'};font-weight:600" title="${movimentoSafe}">${movimentoSafe}</td>
      <td class="td-mono" title="${centralSafe}">${centralSafe}</td>
      <td class="td-muted" title="${depositoSafe}">${depositoSafe}</td>
      <td class="td-mono fechmgr-td-material" title="${materialSafe}">${materialSafe}</td>
      <td class="td-mono" title="${documentoSafe}">${documentoSafe}</td>
      <td class="td-muted" title="${dtLancSafe}">${dtLancSafe}</td>
      <td class="td-muted" title="${dtRegSafe}">${dtRegSafe}</td>
      <td class="td-mono" style="text-align:right">${fmtKg(num(r.peso))}</td>
      <td class="td-mono" style="text-align:right">${money(custoLinha)}</td>
      <td style="text-align:center">${statusDot}</td>
    </tr>`;
  }).join('');

  _fechMgrRenderPaginacao(ordenados.length, totalPaginas);
  _fechMgrAtualizarBarraLote();
  _fechMgrUpdateColFilterIcons();
}

function _fechMgrRenderPaginacao(total, totalPaginas) {
  const infoEl = document.getElementById('fechmgr-page-info');
  if (infoEl) {
    if (!total) {
      infoEl.textContent = '0 registros';
    } else {
      const inicio = _fechMgrPage * PAGE_SIZE + 1;
      const fim = Math.min((_fechMgrPage + 1) * PAGE_SIZE, total);
      infoEl.textContent = `${inicio}-${fim} de ${total} registro(s) (pág. ${_fechMgrPage + 1}/${totalPaginas})`;
    }
  }
}

function _fechMgrIrParaPagina(p) {
  _fechMgrPage = Math.max(0, p);
  _fechMgrRender();
}
window._fechMgrIrParaPagina = _fechMgrIrParaPagina;

function _fechMgrPaginaAnterior() {
  _fechMgrPage = Math.max(0, _fechMgrPage - 1);
  _fechMgrRender();
}
window._fechMgrPaginaAnterior = _fechMgrPaginaAnterior;

function _fechMgrProximaPagina() {
  const totalPaginas = Math.max(1, Math.ceil(_fechMgrLastFiltrados.length / PAGE_SIZE));
  _fechMgrPage = Math.min(totalPaginas - 1, _fechMgrPage + 1);
  _fechMgrRender();
}
window._fechMgrProximaPagina = _fechMgrProximaPagina;

function _fechMgrIrParaUltima() {
  _fechMgrPage = Math.max(0, Math.ceil(_fechMgrLastFiltrados.length / PAGE_SIZE) - 1);
  _fechMgrRender();
}
window._fechMgrIrParaUltima = _fechMgrIrParaUltima;

function _fechMgrToggleSelecao(chave, checked) {
  if (checked) _fechMgrSelecionados.add(chave);
  else _fechMgrSelecionados.delete(chave);
  _fechMgrAtualizarBarraLote();
}
window._fechMgrToggleSelecao = _fechMgrToggleSelecao;

// Seleciona/deseleciona os registros da PÁGINA ATUAL (checkbox no cabeçalho
// da tabela) — usa o cache _fechMgrLastFiltrados, sem recalcular filtro.
function _fechMgrToggleSelecionarTudo(checked) {
  const inicio = _fechMgrPage * PAGE_SIZE;
  const pagina = _fechMgrLastFiltrados.slice(inicio, inicio + PAGE_SIZE);
  pagina.forEach(r => {
    if (r._travadoPorInventario) return; // checkbox desabilitado — nunca entra na seleção
    if (checked) _fechMgrSelecionados.add(r._chave);
    else _fechMgrSelecionados.delete(r._chave);
  });
  _fechMgrAtualizarBarraLote();
  // Só precisa re-renderizar as linhas (os checkboxes) — reaproveita a
  // mesma página já calculada, sem refazer filtro/paginação do zero.
  document.querySelectorAll('#fechmgr-tbody input[type="checkbox"]').forEach((cb, i) => {
    if (pagina[i]) cb.checked = _fechMgrSelecionados.has(pagina[i]._chave);
  });
}
window._fechMgrToggleSelecionarTudo = _fechMgrToggleSelecionarTudo;

function _fechMgrAtualizarBarraLote() {
  const bar = document.getElementById('fechmgr-lote-bar');
  const countEl = document.getElementById('fechmgr-lote-count');
  const checkAllEl = document.getElementById('fechmgr-check-all');
  const n = _fechMgrSelecionados.size;
  if (bar) bar.style.display = n > 0 ? 'flex' : 'none';
  if (countEl) countEl.textContent = n === 1 ? '1 registro selecionado' : `${n} registros selecionados`;

  // Reaproveita o cache da última renderização (não recalcula o filtro
  // inteiro só pra saber o estado do checkbox "selecionar tudo").
  const inicio = _fechMgrPage * PAGE_SIZE;
  const pagina = _fechMgrLastFiltrados.slice(inicio, inicio + PAGE_SIZE);
  // Linhas travadas por Inventário nunca entram em _fechMgrSelecionados (o
  // checkbox delas é disabled) — exclui do cálculo de "página inteira
  // selecionada", senão uma página com pelo menos 1 linha travada nunca
  // marcaria o checkbox de cabeçalho como completo.
  const paginaSelecionavel = pagina.filter(r => !r._travadoPorInventario);
  const todosPaginaSelecionados = paginaSelecionavel.length > 0 && paginaSelecionavel.every(r => _fechMgrSelecionados.has(r._chave));
  if (checkAllEl) {
    checkAllEl.checked = todosPaginaSelecionados;
    checkAllEl.indeterminate = !todosPaginaSelecionados && paginaSelecionavel.some(r => _fechMgrSelecionados.has(r._chave));
  }

  // ── Banner "selecionar todos os N filtrados" (padrão Gmail) ────────────
  // Só aparece quando a página inteira já está marcada E ainda existe mais
  // registro no filtro atual do que o já selecionado — senão não haveria
  // nada a mais pra oferecer.
  const banner = document.getElementById('fechmgr-selectall-banner');
  if (banner) {
    const totalFiltrado = _fechMgrLastFiltrados.length;
    const mostrar = todosPaginaSelecionados && n < totalFiltrado;
    banner.style.display = mostrar ? 'flex' : 'none';
    if (mostrar) {
      banner.innerHTML = `
        <span><i class="ti ti-info-circle"></i> Todos os ${pagina.length} registros desta página estão selecionados.</span>
        <button type="button" class="fechmgr-selectall-link" onclick="_fechMgrSelecionarTodosFiltrados()">Selecionar todos os ${totalFiltrado.toLocaleString('pt-BR')} que batem no filtro atual</button>
      `;
    }
  }
}

// Marca TODOS os registros que batem no filtro atual (não só a página
// visível) — ação deliberada de 2º clique (banner só aparece depois que a
// página inteira já foi selecionada), evitando selecionar milhares de
// registros sem querer.
function _fechMgrSelecionarTodosFiltrados() {
  _fechMgrLastFiltrados.forEach(r => { if (!r._travadoPorInventario) _fechMgrSelecionados.add(r._chave); });
  _fechMgrAtualizarBarraLote();
  document.querySelectorAll('#fechmgr-tbody input[type="checkbox"]:not(:disabled)').forEach(cb => { cb.checked = true; });
  toast(`${_fechMgrSelecionados.size.toLocaleString('pt-BR')} registro(s) selecionado(s).`);
}
window._fechMgrSelecionarTodosFiltrados = _fechMgrSelecionarTodosFiltrados;

function _fechMgrAplicarLote(incluir) {
  if (!_fechMgrSelecionados.size) return;
  const chaves = [..._fechMgrSelecionados];
  // Confirmação extra pra lotes grandes — "selecionar tudo o que bate no
  // filtro" tornou possível marcar milhares de registros em 2 cliques, e
  // Considerar/Desconsiderar afeta o cálculo de estoque em TODO o sistema
  // (Dashboard, Analítico, Inventário, Trend, Assistente) — vale um
  // freio antes de aplicar em massa. Mesmo padrão de confirm() já usado
  // em outras ações destrutivas/grandes do sistema (ver restaurar backup).
  const LIMITE_CONFIRMACAO_LOTE = 200;
  if (chaves.length > LIMITE_CONFIRMACAO_LOTE) {
    const acao = incluir ? 'considerar' : 'desconsiderar';
    const msg = `Você está prestes a ${acao} ${chaves.length.toLocaleString('pt-BR')} registros no cálculo de estoque. Isso afeta Dashboard, Analítico, Inventário e Trend. Confirmar?`;
    if (!confirm(msg)) return;
  }
  setSapFechOverrideEmLote(chaves, incluir);
  _fechMgrSelecionados.clear();
  toast(incluir
    ? `${chaves.length} registro(s) considerado(s) no cálculo de estoque.`
    : `${chaves.length} registro(s) desconsiderado(s) do cálculo de estoque.`);
  _fechMgrRender();
  // Recalcula qualquer análise já aberta pra refletir a mudança imediatamente
  if (typeof updateDashboard === 'function') updateDashboard();
  if (typeof renderModule === 'function' && document.getElementById('page-sap')?.classList.contains('active')) renderModule('sap');
}
window._fechMgrAplicarLote = _fechMgrAplicarLote;

function _fechMgrLimparSelecao() {
  _fechMgrSelecionados.clear();
  _fechMgrRender();
}
window._fechMgrLimparSelecao = _fechMgrLimparSelecao;

// ═══════════════════════════════════════════════════════════
// MODAL: IMPORTAR DOCUMENTOS PARA DESCONSIDERAR (atalho em lote)
// ═══════════════════════════════════════════════════════════
// Atalho de entrada pro mecanismo de override JÁ EXISTENTE
// (setSapFechOverrideEmLote) — não é um mecanismo de exclusão novo/
// paralelo. O usuário cola uma lista de números de Documento SAP; o
// sistema casa cada um contra os candidatos Y11/Y12 já detectados
// (_fechMgrGetTodosCandidatos, mesmo universo do modal principal) e
// aplica "voltar ao automático" (incluir=false) nos que baterem — único
// sentido suportado, por decisão explícita (não existe importação pra
// "considerar"). Pensado pra corrigir em massa registros reincluídos
// manualmente por engano, sem precisar filtrar/selecionar linha a linha.

// Normaliza um número de documento pra comparação: trim + maiúsculas +
// remove zeros à esquerda — mesmo padrão de normNF/normOS
// (calcPendentesIntegracao, acima) — evita que "00123" colado no import
// não bata com um documento salvo como "123", ou vice-versa.
function _fechImportNormDoc(raw) {
  return String(raw || '').trim().toUpperCase().replace(/^0+/, '') || '0';
}

// Guarda o resultado da última pré-visualização — usado por _fechImportAplicar
// pra não precisar refazer o parsing/matching no momento de aplicar.
let _fechImportUltimoResultado = null;

function abrirFechImportModal() {
  const overlay = document.getElementById('fech-import-overlay');
  if (!overlay) return;
  const textarea = document.getElementById('fech-import-textarea');
  const resultEl = document.getElementById('fech-import-resultado');
  if (textarea) textarea.value = '';
  if (resultEl) resultEl.innerHTML = '';
  _fechImportUltimoResultado = null;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  if (textarea) setTimeout(() => textarea.focus(), 50);
}
window.abrirFechImportModal = abrirFechImportModal;

function fecharFechImportModal() {
  const overlay = document.getElementById('fech-import-overlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
}
window.fecharFechImportModal = fecharFechImportModal;

// Faz o parsing da lista colada + o matching contra os candidatos Y11/Y12
// já detectados, e mostra a pré-visualização — NÃO aplica nada ainda
// (aplicação só acontece em _fechImportAplicar, com confirmação se o lote
// afetado for grande).
function _fechImportPreVisualizar() {
  const textarea = document.getElementById('fech-import-textarea');
  const resultEl = document.getElementById('fech-import-resultado');
  if (!textarea || !resultEl) return;

  // Aceita colagem direta de uma coluna do Excel (quebra de linha) ou lista
  // separada por vírgula/ponto-e-vírgula/tab.
  const bruto = textarea.value.split(/[\r\n,;\t]+/).map(s => s.trim()).filter(Boolean);
  const docsUnicos = [...new Set(bruto.map(_fechImportNormDoc))];

  if (!docsUnicos.length) {
    resultEl.innerHTML = `<div class="fechimp-vazio"><i class="ti ti-info-circle"></i> Cole ao menos um número de documento.</div>`;
    _fechImportUltimoResultado = null;
    return;
  }

  // Candidatos Y11/Y12 já detectados — mesmo universo do modal principal
  // (_fechMgrGetTodosCandidatos já traz _statusExcluido e _chave prontos).
  const candidatos = _fechMgrGetTodosCandidatos();
  const porDocNorm = new Map(); // docNorm -> [candidatos]
  candidatos.forEach(r => {
    const key = _fechImportNormDoc(r.documento);
    if (!porDocNorm.has(key)) porDocNorm.set(key, []);
    porDocNorm.get(key).push(r);
  });

  const encontrados = [];      // registros que serão desconsiderados (hoje incluídos manualmente)
  const jaDesconsiderado = []; // registros encontrados mas já no padrão automático (no-op)
  const naoEncontrados = [];   // documentos importados sem candidato correspondente (typo ou não é Y11/Y12)

  docsUnicos.forEach(doc => {
    const matches = porDocNorm.get(doc) || [];
    if (!matches.length) { naoEncontrados.push(doc); return; }
    matches.forEach(r => {
      if (r._statusExcluido) jaDesconsiderado.push(r);
      else encontrados.push(r);
    });
  });

  _fechImportUltimoResultado = { encontrados, jaDesconsiderado, naoEncontrados };

  const { peso, custo } = somarPesoCustoSap(encontrados);
  const docsAfetados = new Set(encontrados.map(r => _fechImportNormDoc(r.documento))).size;

  resultEl.innerHTML = `
    <div class="fechimp-resumo">
      <div class="fechimp-linha fechimp-ok">
        <i class="ti ti-circle-check"></i>
        <span><b>${encontrados.length}</b> registro(s) em <b>${docsAfetados}</b> documento(s) serão desconsiderados
        ${encontrados.length ? `— Peso: <b>${fmtKg(peso)}</b> · Custo: <b>${money(custo)}</b>` : ''}</span>
      </div>
      ${jaDesconsiderado.length ? `
      <div class="fechimp-linha fechimp-neutro">
        <i class="ti ti-minus"></i>
        <span><b>${jaDesconsiderado.length}</b> registro(s) já estavam desconsiderados (nenhuma mudança)</span>
      </div>` : ''}
      ${naoEncontrados.length ? `
      <div class="fechimp-linha fechimp-erro">
        <i class="ti ti-alert-triangle"></i>
        <span><b>${naoEncontrados.length}</b> documento(s) não encontrados entre os Ajustes de Fechamento detectados nesta tela:
        <div class="fechimp-nao-encontrados">${naoEncontrados.map(d => escapeHtml(d)).join(', ')}</div></span>
      </div>` : ''}
    </div>
    <button class="btn btn-primary" type="button" onclick="_fechImportAplicar()" ${encontrados.length ? '' : 'disabled'}>
      <i class="ti ti-check"></i> Aplicar — Desconsiderar ${encontrados.length} registro(s)
    </button>`;
}
window._fechImportPreVisualizar = _fechImportPreVisualizar;

function _fechImportAplicar() {
  const resultado = _fechImportUltimoResultado;
  if (!resultado || !resultado.encontrados.length) return;

  const encontrados = resultado.encontrados;
  const docsAfetados = new Set(encontrados.map(r => _fechImportNormDoc(r.documento))).size;

  const aplicar = () => {
    const chaves = encontrados.map(r => r._chave);
    setSapFechOverrideEmLote(chaves, false);
    fecharFechImportModal();
    toast(`${chaves.length} registro(s) voltaram a ser desconsiderados do cálculo (${docsAfetados} documento(s)).`);
    _fechMgrRender();
    // Recalcula qualquer análise já aberta pra refletir a mudança imediatamente
    // — mesmo padrão de _fechMgrAplicarLote.
    if (typeof updateDashboard === 'function') updateDashboard();
    if (typeof renderModule === 'function' && document.getElementById('page-sap')?.classList.contains('active')) renderModule('sap');
  };

  // Mesmo limiar de confirmação extra já usado em _fechMgrAplicarLote —
  // lotes grandes merecem uma pausa antes de aplicar. Aqui usamos
  // confirmarDestrutivo (em vez do confirm() simples) porque já temos um
  // resumo rico (peso/custo/documentos) pra mostrar, o que ajuda a
  // confirmar que a lista colada é mesmo a pretendida antes de aplicar.
  const LIMITE_CONFIRMACAO_LOTE = 200;
  if (encontrados.length > LIMITE_CONFIRMACAO_LOTE) {
    confirmarDestrutivo({
      title: 'Desconsiderar em massa via importação',
      sub: `${encontrados.length} registro(s) — ${docsAfetados} documento(s)`,
      body: `
        <div style="font-size:12px;color:var(--text2);line-height:1.6">
          Isso afeta o cálculo de variação em Dashboard, Analítico, Inventário e Trend.
          Os registros voltam ao comportamento automático (desconsiderados) — nenhum dado bruto é alterado.
        </div>`,
      confirmLabel: `Desconsiderar ${encontrados.length} registro(s)`,
      onConfirm: aplicar
    });
    return;
  }

  aplicar();
}
window._fechImportAplicar = _fechImportAplicar;

// ── Filtro por coluna (réplica isolada do COLUMN FILTER ENGINE) ──────────
function _fechMgrInjectColFilterButtons() {
  const headRow = document.getElementById('fechmgr-thead-row');
  if (!headRow) return;
  const ths = headRow.querySelectorAll('th');
  ths.forEach((th, idx) => {
    if (!_FECHMGR_COLS[idx]) return;
    if (th.querySelector('.cf-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'cf-btn';
    btn.innerHTML = '<i class="ti ti-filter"></i>';
    btn.title = 'Filtrar coluna';
    btn.setAttribute('aria-label', 'Filtrar coluna');
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (_fechMgrPopover && _fechMgrPopColIdx === idx) { _fechMgrClosePopover(); return; }
      _fechMgrOpenColFilterPopover(th, idx);
    });
    th.appendChild(btn);
  });
  _fechMgrUpdateColFilterIcons();
}

function _fechMgrUpdateColFilterIcons() {
  const headRow = document.getElementById('fechmgr-thead-row');
  if (!headRow) return;
  headRow.querySelectorAll('th').forEach((th, idx) => {
    const btn = th.querySelector('.cf-btn');
    if (!btn) return;
    const active = _fechMgrColFilters[idx] && _fechMgrColFilters[idx].size > 0;
    btn.classList.toggle('cf-btn--active', !!active);
  });
  // Mostra a barra "Limpar filtros" só quando algum filtro de coluna
  // está de fato ativo — mesma lógica do badge genérico (updateAllColFilterIcons).
  const bar = document.getElementById('fechmgr-filter-bar');
  if (bar) {
    const qtdAtivos = Object.values(_fechMgrColFilters).filter(s => s && s.size > 0).length;
    bar.style.display = qtdAtivos > 0 ? 'flex' : 'none';
    const countEl = document.getElementById('fechmgr-filter-count');
    if (countEl) {
      countEl.innerHTML = `<i class="ti ti-filter"></i> ${qtdAtivos} filtro(s) de coluna ativo(s)`;
    }
  }
}

function _fechMgrLimparTodosFiltros() {
  Object.keys(_fechMgrColFilters).forEach(k => delete _fechMgrColFilters[k]);
  _fechMgrClosePopover();
  _fechMgrPage = 0;
  _fechMgrRender();
}
window._fechMgrLimparTodosFiltros = _fechMgrLimparTodosFiltros;

// Cache dos valores únicos da coluna ATUALMENTE aberta no popover — evita
// recalcular _fechMgrGetTodosCandidatos() (map + getSapFechKey por
// registro) e reaplicar os outros filtros do zero a cada tecla digitada
// na busca do popover. Só é recalculado quando o popover abre/reabre.
let _fechMgrPopoverAllVals = [];

function _fechMgrOpenColFilterPopover(thEl, colIdx) {
  _fechMgrClosePopover();
  _fechMgrPopColIdx = colIdx;

  const activeSet = _fechMgrColFilters[colIdx] || new Set();
  const allVals = _fechMgrGetColUniqueValues(colIdx);
  _fechMgrPopoverAllVals = allVals;
  if (!allVals.length) return;

  const pop = document.createElement('div');
  pop.className = 'cf-popover';
  pop.setAttribute('role', 'dialog');
  pop.innerHTML = buildColFilterHTML(allVals, activeSet, '');
  document.body.appendChild(pop);
  _fechMgrPopover = pop;

  const rect = thEl.getBoundingClientRect();
  const popW = 240, popH = 340;
  let left = rect.left;
  if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
  left = Math.max(4, left);
  let top = rect.bottom + 4;
  if (top + popH > window.innerHeight - 8) top = rect.top - popH - 4;
  top = Math.max(4, top);
  pop.style.left = left + 'px';
  pop.style.top  = top  + 'px';
  pop.style.width = popW + 'px';

  const searchEl = pop.querySelector('.cf-search');
  if (searchEl) {
    searchEl.addEventListener('input', () => _fechMgrRefreshPopoverList(searchEl.value));
  }
  const checkAll = pop.querySelector('.cf-check-all');
  if (checkAll) {
    checkAll.addEventListener('change', () => {
      pop.querySelectorAll('.cf-check').forEach(c => { c.checked = checkAll.checked; });
    });
  }
  pop.querySelector('[data-cf-action="apply"]')?.addEventListener('click', e => { e.stopPropagation(); _fechMgrApplyColFilter(); });
  pop.querySelector('[data-cf-action="clear"]')?.addEventListener('click', e => { e.stopPropagation(); _fechMgrClearColFilter(); });

  pop.querySelector('.cf-search')?.focus();
  pop.addEventListener('mousedown', e => e.stopPropagation());
}

function _fechMgrRefreshPopoverList(query) {
  if (!_fechMgrPopover || _fechMgrPopColIdx === null) return;
  const currentChecked = new Set();
  _fechMgrPopover.querySelectorAll('.cf-check:checked').forEach(c => currentChecked.add(c.value));
  const saved = _fechMgrColFilters[_fechMgrPopColIdx] || new Set();
  const merged = new Set([...saved, ...currentChecked]);

  const allVals = _fechMgrPopoverAllVals;
  const q = normalizeText(query || '');
  const filtered = q ? allVals.filter(v => v.includes(q)) : allVals;
  const allChecked = filtered.length > 0 && filtered.every(v => merged.has(v));
  const someChecked = filtered.some(v => merged.has(v));

  const list = _fechMgrPopover.querySelector('.cf-list');
  const checkAll = _fechMgrPopover.querySelector('.cf-check-all');
  if (checkAll) { checkAll.checked = allChecked; checkAll.indeterminate = !allChecked && someChecked; }
  if (list) {
    list.innerHTML = filtered.length ? filtered.map(v => {
      const checked = merged.has(v) ? 'checked' : '';
      const label = v === '' || v === '—' ? '<em style="opacity:.5">vazio</em>' : escapeHtml(v);
      return `<label class="cf-row"><input type="checkbox" class="cf-check" value="${escapeHtml(v)}" ${checked}><span class="cf-label">${label}</span></label>`;
    }).join('') : `<div class="cf-empty">Nenhum valor encontrado</div>`;
  }
}

function _fechMgrApplyColFilter() {
  if (!_fechMgrPopover || _fechMgrPopColIdx === null) return;
  const checked = new Set();
  _fechMgrPopover.querySelectorAll('.cf-check:checked').forEach(c => checked.add(c.value));
  _fechMgrColFilters[_fechMgrPopColIdx] = checked;
  _fechMgrClosePopover();
  _fechMgrPage = 0;
  _fechMgrRender();
}

function _fechMgrClearColFilter() {
  if (_fechMgrPopColIdx === null) return;
  delete _fechMgrColFilters[_fechMgrPopColIdx];
  _fechMgrClosePopover();
  _fechMgrPage = 0;
  _fechMgrRender();
}

function _fechMgrClosePopover() {
  if (_fechMgrPopover) _fechMgrPopover.remove();
  _fechMgrPopover = null;
  _fechMgrPopColIdx = null;
  _fechMgrPopoverAllVals = [];
}

document.addEventListener('mousedown', e => {
  if (_fechMgrPopover && !_fechMgrPopover.contains(e.target)) _fechMgrClosePopover();
});
document.addEventListener('scroll', e => {
  if (!_fechMgrPopover) return;
  if (_fechMgrPopover.contains(e.target)) return;
  _fechMgrClosePopover();
}, true);

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

// Classifica a variação (bom/atenção/urgente/crítico) usando os limites da
// categoria do material. Se catKey vier null/undefined — material sem
// cadastro ou cadastrado sem categoria — NÃO cai mais silenciosamente nos
// limites de Aglomerante (bug anterior). Retorna 'sem_cadastro', um nível
// distinto que os chamadores devem tratar explicitamente (nunca combinar
// com bom/atencao/urgente/critico como se fosse uma classificação real).
function classifyVariation(absVal, catKey, thresholds) {
  if (!catKey) return 'sem_cadastro';
  const t = thresholds[catKey] || thresholds.aglomerante;
  if (absVal <= t.bom)     return 'bom';
  if (absVal <= t.atencao) return 'atencao';
  if (absVal <= t.urgente) return 'urgente';
  return 'critico';
}

// Penalty weights per level
const HEALTH_PENALTIES = { bom: 0, atencao: 1, urgente: 3, critico: 6 };

function calcHealthScore(matDiffs, lancsByMat, sapByMat, thresholds) {
  // matDiffs: array of { mat, diff, catKey }
  // Materiais sem cadastro (catKey null) são excluídos do cálculo de saúde
  // por completo — não contam pontos bons nem ruins, para não contaminar
  // o score/donut com uma classificação que não existe. Ficam isolados em
  // counts.sem_cadastro, contados à parte (decisão: cadastro pendente não
  // deve influenciar a nota de saúde da central).
  const semCadastro = matDiffs.filter(m => !m.catKey);
  const comCadastro = matDiffs.filter(m => m.catKey);
  const nonNeutral = comCadastro.filter(m => Math.abs(m.diff) > 0.0001);
  if (!nonNeutral.length) {
    return {
      score: 100,
      level: 'ok',
      counts: { bom: 0, atencao: 0, urgente: 0, critico: 0, neutro: comCadastro.length, sem_cadastro: semCadastro.length }
    };
  }

  let totalPenalty = 0;
  const counts = { bom: 0, atencao: 0, urgente: 0, critico: 0, neutro: comCadastro.length - nonNeutral.length, sem_cadastro: semCadastro.length };

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

  // Helper: busca total + registros de lançamentos em uma data ISO exata.
  // `records` (aditivo) = registros brutos que casaram naquela data — usado
  // pelo Inventário nos indicadores de Divergências (fonte==='manual',
  // cruzamento com getLancamentoDuplicateKeys); demais consumidores desta
  // função seguem usando só value/dtLabel/date, sem impacto.
  const findByISO = (iso) => {
    let total = 0, found = false;
    const recs = [];
    for (const rec of arr) {
      const d = parseDate(rec.dtLanc);
      if (!d) continue;
      if (localISODate(d) === iso) { total += num(rec.peso); found = true; recs.push(rec); }
    }
    return found ? { total, recs } : null;
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
      const res = findByISO(bestPostISO);
      if (res) return { value: res.total, dtLabel: fmtPtDate(bestPost), date: bestPost, records: res.recs };
    }

    // Usa lançamento da última terça
    const tercaRes = findByISO(lastTercaISO);
    if (tercaRes) return { value: tercaRes.total, dtLabel: fmtPtDate(lastTerca), date: lastTerca, records: tercaRes.recs };
    return null;

  } else if (isPrimeiroDiaMes) {
    // 1º do mês: busca exata no último dia do mês anterior (recuando domingo → sábado)
    const targetDate = new Date(dtIniDate.getFullYear(), dtIniDate.getMonth(), 0);
    targetDate.setHours(0, 0, 0, 0);
    if (targetDate.getDay() === 0) targetDate.setDate(targetDate.getDate() - 1);
    const res = findByISO(localISODate(targetDate));
    if (res) return { value: res.total, dtLabel: fmtPtDate(targetDate), date: targetDate, records: res.recs };
    return null;

  } else {
    // Outro dia: dia anterior; se domingo → sábado
    const targetDate = new Date(dtIniDate);
    targetDate.setDate(targetDate.getDate() - 1);
    targetDate.setHours(0, 0, 0, 0);
    if (targetDate.getDay() === 0) targetDate.setDate(targetDate.getDate() - 1);
    const res = findByISO(localISODate(targetDate));
    if (res) return { value: res.total, dtLabel: fmtPtDate(targetDate), date: targetDate, records: res.recs };
    return null;
  }
}

// getPrePeriodLaunchStock: mesma lógica de getPrevDayLaunchStock
// Ambos usam a mesma regra — mantido por compatibilidade com chamadas existentes.
// catKey é OPCIONAL: quando omitido, mantém o comportamento legado (regra "diária",
// sem considerar Agregado/lançamento semanal) — não altera call sites existentes
// que não passarem catKey explicitamente.
function getPrePeriodLaunchStock({ central, material, dtIni, dtFim, catKey }) {
  return getPrevDayLaunchStock({ central, material, dtIni, catKey });
}

// ── EST. FINAL: soma todos os lançamentos do último dia não-domingo do período.
//    Retorna { value, dtLabel, missing } onde missing=true indica dado ausente.
// ALTERADO: busca SOMENTE a data esperada (último não-domingo do período —
// se cair domingo, recua exatamente 1 dia pro sábado, nunca mais que isso).
// NÃO recua mais dia a dia procurando qualquer lançamento no período — se
// não achar exatamente na data esperada, é AUSENTE. Mesmo critério de
// getLastPeriodLaunchStock (ui.js), mantido aqui como função separada por
// compatibilidade de assinatura/retorno com os call sites existentes
// (Inventário, Dashboard Gerencial Visão Geral/Saúde, Analítico Visão Micro).
// `fallback` é mantido no retorno por compatibilidade, mas agora é sempre
// false — não há mais cenário em que o valor usado seja de uma data
// diferente da esperada, então o badge "retroativo" nunca mais é exibido.
// Usado na visão micro do Analítico (EST. FINAL).
function getLastPeriodLaunchStockWithFallback({ central, material, dtIni, dtFim }) {
  const dtFimDate = dtFim instanceof Date ? dtFim : new Date(dtFim);
  const dtIniDate = dtIni instanceof Date ? dtIni : new Date(dtIni);
  if (isNaN(dtFimDate) || isNaN(dtIniDate)) return null;

  const materialKey = material || '—';
  const { byCentralMat } = getLancIndex();
  const arr = byCentralMat.get(central)?.get(materialKey) || [];

  // Último dia útil esperado: último não-domingo do período (recua no
  // máximo 1 dia — só pula domingo). Calculado ANTES do early-return de
  // array vazio pra expectedLabel vir preenchido em todo caminho (usado
  // pelo Inventário na mensagem "cobrar lançamento de X").
  const expectedDate = new Date(dtFimDate);
  expectedDate.setHours(0, 0, 0, 0);
  if (expectedDate.getDay() === 0) {
    expectedDate.setDate(expectedDate.getDate() - 1);
  }
  const expectedISO   = localISODate(expectedDate);
  const expectedLabel = fmtPtDate(expectedDate);

  if (!arr.length) return { value: null, dtLabel: '—', missing: true, expectedLabel };

  // Busca SOMENTE na data esperada exata — sem recuo adicional.
  let total = 0;
  let found = false;
  const recs = [];
  for (const rec of arr) {
    const d = parseDate(rec.dtLanc);
    if (!d) continue;
    if (localISODate(d) === expectedISO) {
      total += num(rec.peso);
      found = true;
      recs.push(rec);
    }
  }

  if (!found) return { value: null, dtLabel: '—', missing: true, expectedLabel };

  return {
    value:    total,
    dtLabel:  expectedLabel,
    missing:  false,
    fallback: false,
    records:  recs,
    expectedLabel
  };
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
  const recsParaSincronizar = [];
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
      recsParaSincronizar.push(rec);
      saved++;
    });
  });
  persistStateNow();
  renderConfigs();
  updateImportPrereqUI();
  toast(saved > 0 ? `${saved} limite(s) salvo(s)` : 'Nenhum valor preenchido', saved > 0 ? 'success' : 'error');
  if (recsParaSincronizar.length && window.supabaseClient) {
    window.supabaseClient.from('configs').upsert(recsParaSincronizar, { onConflict: 'user_id,key' })
      .then(({ error }) => {
        if (error) {
          console.warn('[Supabase] Falha ao sincronizar limites de saúde:', error);
          toast('⚠ Salvo nesta sessão, mas não foi possível sincronizar com a nuvem.', 'error');
        }
      });
  }
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
  { key: 'invJustificativas', label: 'Inventário — Justificativas', icon: 'ti-clipboard-check', color: 'var(--amber)' },
  { key: 'sapFechamentoOverrides', label: 'SAP — Overrides de Fechamento', icon: 'ti-calendar-check', color: 'var(--purple)' },
  { key: 'ajustesSistemicos', label: 'Documentos de Ajuste (DAI)', icon: 'ti-rubber-stamp', color: 'var(--gold)' },
  { key: 'ajustesExcluidos', label: 'DAI — Log de Exclusões', icon: 'ti-history', color: 'var(--gold)' },
  { key: 'notasAjuste', label: 'Notas de Crédito/Débito', icon: 'ti-receipt', color: 'var(--teal)' },
];

// Módulos selecionados para exportar (persiste durante a sessão do modal)
let _bkpSelected = new Set(_BKP_MODULES.map(m => m.key));
let _bkpMode = 'exportar'; // 'exportar' | 'restaurar'

// ── Leitura em streaming do backup ──────────────────────────────────────────
// Chaves que podem conter arrays muito grandes (um por registro). Para essas,
// os elementos são lidos e processados um a um (em lotes pequenos), nunca
// como uma string única. 'acoesRelatorio' é mantido por compatibilidade com
// formatos de backup mais antigos que podiam incluir esse campo.
const _BKP_BIG_KEYS = new Set([..._BKP_MODULES.map(m => m.key), 'acoesRelatorio']);

/**
 * Faz uma única passada pelo arquivo de backup usando file.stream(), sem
 * nunca acumular o conteúdo inteiro numa string só — isso é o que evita o
 * erro "JSON inválido ou corrompido" em arquivos grandes (o motor JS tem um
 * limite de ~512 milhões de caracteres por string).
 *
 * Campos de cabeçalho (pequenos: _version, _exportedAt, _notas, etc.) são
 * sempre lidos por completo. Para os campos "grandes" (listas de registros
 * por módulo, ver _BKP_BIG_KEYS):
 *   - se a chave estiver em `wantedBigKeys`, cada registro é convertido em
 *     objeto JS (em lotes, para reduzir overhead) e empilhado no resultado;
 *   - caso contrário, os registros são apenas contados, sem alocar objetos
 *     (usado na pré-visualização, que só precisa mostrar quantidades).
 *
 * @param {File} file
 * @param {{wantedBigKeys?: Set<string>, onProgress?: (frac:number)=>void}} opts
 * @returns {Promise<{header: object, counts: Record<string, number>, data: Record<string, any[]>}>}
 */
async function _bkpParseStreaming(file, opts = {}) {
  const wantedBigKeys = opts.wantedBigKeys || new Set();
  const onProgress = opts.onProgress;

  if (typeof file.stream !== 'function') {
    throw new Error('Este navegador não suporta leitura em streaming de arquivos (file.stream indisponível).');
  }

  const reader = file.stream().getReader();
  const decoder = new TextDecoder('utf-8');

  let buffer = '';
  let pos = 0;
  let bytesRead = 0;
  const totalBytes = file.size || 0;

  const header = {};
  const counts = {};
  const data = {};

  const BATCH_COUNT = 2000;      // nº de registros por lote antes de fazer JSON.parse
  const BATCH_BYTES  = 500000;   // ~500 KB de texto acumulado antes de forçar o parse do lote
  let pendingTexts = [];
  let pendingLen = 0;
  let currentArrBuf = null;
  let currentWantsData = false;

  function flushBatch() {
    if (pendingTexts.length === 0) return;
    const arrText = '[' + pendingTexts.join(',') + ']';
    const parsedBatch = JSON.parse(arrText);
    if (currentArrBuf) for (let i = 0; i < parsedBatch.length; i++) currentArrBuf.push(parsedBatch[i]);
    pendingTexts = [];
    pendingLen = 0;
  }

  const WS = new Set([' ', '\n', '\r', '\t']);
  const DELIMS = new Set([',', '}', ']', ' ', '\n', '\r', '\t']);

  function skipWs() { while (pos < buffer.length && WS.has(buffer[pos])) pos++; }

  // Retorna o índice logo após o fim do valor JSON que começa em `start`
  // (string, número/literal, objeto ou array). Retorna -1 se o buffer
  // terminar antes do valor estar completo (é preciso esperar mais dados).
  function findValueEnd(start) {
    if (start >= buffer.length) return -1;
    const c = buffer[start];

    if (c === '"') {
      let i = start + 1;
      while (i < buffer.length) {
        const ch = buffer[i];
        if (ch === '\\') { i += 2; continue; }
        if (ch === '"') return i + 1;
        i++;
      }
      return -1;
    }

    if (c === '{' || c === '[') {
      let depth = 0, i = start, inStr = false;
      while (i < buffer.length) {
        const ch = buffer[i];
        if (inStr) {
          if (ch === '\\') { i += 2; continue; }
          if (ch === '"') inStr = false;
          i++;
          continue;
        }
        if (ch === '"') { inStr = true; i++; continue; }
        if (ch === '{' || ch === '[') depth++;
        else if (ch === '}' || ch === ']') { depth--; if (depth === 0) return i + 1; }
        i++;
      }
      return -1;
    }

    // número, true, false ou null — vai até o primeiro delimitador
    let i = start;
    while (i < buffer.length && !DELIMS.has(buffer[i])) i++;
    if (i >= buffer.length) return -1;
    return i;
  }

  let topState = 'open'; // open | key-or-close | colon | value | in-array | comma-or-close | done
  let currentKey = null;

  // Tenta avançar o máximo possível dentro do buffer atual.
  // Retorna true quando o objeto raiz é fechado.
  function advance() {
    while (true) {
      skipWs();
      if (pos >= buffer.length) return false;

      if (topState === 'open') {
        if (buffer[pos] !== '{') throw new Error('O arquivo não começa com um objeto JSON válido.');
        pos++; topState = 'key-or-close'; continue;
      }

      if (topState === 'key-or-close') {
        if (buffer[pos] === '}') { pos++; topState = 'done'; return true; }
        const end = findValueEnd(pos);
        if (end === -1) return false;
        currentKey = JSON.parse(buffer.slice(pos, end));
        pos = end; topState = 'colon'; continue;
      }

      if (topState === 'colon') {
        if (buffer[pos] !== ':') throw new Error('JSON malformado (esperava ":" após uma chave).');
        pos++; topState = 'value'; continue;
      }

      if (topState === 'value') {
        if (_BKP_BIG_KEYS.has(currentKey)) {
          if (buffer[pos] !== '[') throw new Error(`Campo "${currentKey}" deveria ser uma lista.`);
          pos++;
          counts[currentKey] = 0;
          currentWantsData = wantedBigKeys.has(currentKey);
          currentArrBuf = currentWantsData ? (data[currentKey] = []) : null;
          pendingTexts = []; pendingLen = 0;
          topState = 'array-elem';
          continue;
        }
        const end = findValueEnd(pos);
        if (end === -1) return false;
        header[currentKey] = JSON.parse(buffer.slice(pos, end));
        pos = end; topState = 'comma-or-close'; continue;
      }

      // 'array-elem': espera ']' (fim da lista) ou o início de um novo registro.
      // 'array-sep': espera ',' (mais um registro) ou ']' (fim da lista) — estado
      // separado do anterior para que, se faltar dado bem depois de já termos
      // consumido um registro, a retomada saiba que o próximo caractere
      // esperado é um separador, e não tente reinterpretar uma ',' como se
      // fosse o início de um valor (isso causava registros vazios/corrompidos
      // quando um chunk terminava exatamente entre um registro e a vírgula
      // seguinte).
      if (topState === 'array-elem') {
        if (buffer[pos] === ']') { pos++; flushBatch(); topState = 'comma-or-close'; continue; }
        const end = findValueEnd(pos);
        if (end === -1) return false;
        counts[currentKey]++;
        if (currentWantsData) {
          const text = buffer.slice(pos, end);
          pendingTexts.push(text);
          pendingLen += text.length;
          if (pendingTexts.length >= BATCH_COUNT || pendingLen >= BATCH_BYTES) flushBatch();
        }
        pos = end;
        topState = 'array-sep';
        continue;
      }

      if (topState === 'array-sep') {
        if (buffer[pos] === ',') { pos++; topState = 'array-elem'; continue; }
        if (buffer[pos] === ']') { pos++; flushBatch(); topState = 'comma-or-close'; continue; }
        throw new Error(`JSON malformado dentro da lista "${currentKey}".`);
      }

      if (topState === 'comma-or-close') {
        if (buffer[pos] === ',') { pos++; topState = 'key-or-close'; continue; }
        if (buffer[pos] === '}') { pos++; topState = 'done'; return true; }
        throw new Error('JSON malformado (esperava "," ou "}").');
      }

      return true; // topState === 'done'
    }
  }

  while (true) {
    const { value: chunk, done } = await reader.read();
    if (done) break;
    bytesRead += chunk.byteLength;
    buffer += decoder.decode(chunk, { stream: true });

    let finished;
    try { finished = advance(); }
    catch (err) { try { reader.cancel(); } catch(e){} throw err; }

    if (pos > 0) { buffer = buffer.slice(pos); pos = 0; }
    if (onProgress) onProgress(totalBytes ? Math.min(1, bytesRead / totalBytes) : 0);
    if (finished) { try { reader.cancel(); } catch(e){} break; }
  }

  if (topState !== 'done') {
    buffer += decoder.decode(); // flush final do decodificador
    let finished;
    try { finished = advance(); }
    catch (err) { throw err; }
    if (pos > 0) buffer = buffer.slice(pos);
    if (!finished) throw new Error('O arquivo terminou de forma inesperada (JSON incompleto).');
  }

  if (onProgress) onProgress(1);
  return { header, counts, data };
}

// ── Estado do arquivo de restauração ────────────────────────────────────────
// IMPORTANTE: o arquivo NUNCA é lido inteiro para uma string única (isso é o
// que causava "JSON inválido ou corrompido" em backups grandes — o motor JS
// tem um limite de ~512 milhões de caracteres por string, e um backup
// "Completo" facilmente ultrapassa isso). Guardamos apenas a referência ao
// File e metadados leves; a leitura real acontece em streaming (ver
// _bkpParseStreaming), tanto na pré-visualização quanto na restauração.
let _bkpPendingFile   = null; // File selecionado, ainda não processado
let _bkpPendingHeader = null; // metadados (_version, _exportedAt, _notas, _atalhos, _fechamento...)
let _bkpPendingCounts = null; // contagem de registros por módulo, obtida na pré-visualização

function abrirModalBackup(modo) {
  _bkpMode = modo || 'exportar';
  _bkpPendingFile = null;
  _bkpPendingHeader = null;
  _bkpPendingCounts = null;
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

    // Filtra dados de um módulo antes de exportar/contar. Hoje só afeta
    // invJustificativas: uma justificativa "vazia" (registrada em branco,
    // ver modal em lote/individual — campos deixaram de ser obrigatórios)
    // não tem nenhuma informação real e não deveria ir pro backup — se
    // for restaurada depois, uma entrada vazia pode SOBRESCREVER uma
    // justificativa de verdade que exista nesse meio-tempo.
    const _bkpFiltrarModulo = (key, arr) => {
      if (key !== 'invJustificativas') return arr;
      return (arr || []).filter(rec => !!(rec && (rec.op || rec.fiscal || rec.saldo || rec.custoMedioSap || rec.documentoSap)));
    };

    // Metadados do arquivo
    const selectedKeys = [..._bkpSelected];
    const header = {
      _version:    'analyticsys_backup_v3',
      _exportedAt: now.toLocaleString('pt-BR'),
      _modules:    selectedKeys,
      _counts:     {},
    };
    selectedKeys.forEach(k => { header._counts[k] = _bkpFiltrarModulo(k, state[k]).length; });

    // Inclui dados auxiliares sempre
    header._notas      = lsGet('analyticsys_notes_v2');
    header._atalhos    = lsGet('analyticsys_shortcuts_v1');
    header._fechamento = lsGet('analyticsys_fech_v1');

    // Constrói JSON em partes (evita limite de string)
    const parts = [];
    parts.push(JSON.stringify(header).slice(0, -1)); // remove }

    for (const key of selectedKeys) {
      const arr = _bkpFiltrarModulo(key, state[key]);
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
    const total = selectedKeys.reduce((s, k) => s + _bkpFiltrarModulo(k, state[k]).length, 0);
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

async function _bkpCarregarArquivo(file) {
  if (!file) return;

  const previewEl = document.getElementById('bkp-preview');
  if (previewEl) previewEl.style.display = 'none';

  const sizeMB = file.size / (1024 * 1024);
  const isBig = file.size > 20 * 1024 * 1024; // acima de ~20MB, mostra overlay com progresso

  if (isBig) {
    showLoadingOverlay('Lendo backup', 'Analisando o arquivo selecionado...');
    if (typeof loadingShowSteps === 'function') loadingShowSteps([
      { id: 'bkp-scan', icon: 'ti-file-search', label: 'Lendo cabeçalho e contando registros' },
    ]);
    await nextFrame();
  }

  try {
    const result = await _bkpParseStreaming(file, {
      wantedBigKeys: new Set(), // pré-visualização: só contar, sem materializar os registros
      onProgress: (frac) => {
        if (!isBig) return;
        _lbarSet(Math.round(frac * 100));
        updateLoadingOverlay(`Analisando... ${(frac * 100).toFixed(0)}% (${(sizeMB * frac).toFixed(0)} MB de ${sizeMB.toFixed(0)} MB)`);
      }
    });

    const { header, counts } = result;

    if (typeof header !== 'object' || header === null) {
      toast('Arquivo inválido — não é um backup AnalyticSys', 'error');
      return;
    }

    // Detecta módulos disponíveis no arquivo (com base no que foi de fato encontrado)
    const available = _BKP_MODULES.filter(m => counts[m.key] !== undefined);
    if (available.length === 0) {
      toast('Arquivo não contém dados reconhecíveis', 'error');
      return;
    }

    _bkpPendingFile   = file;
    _bkpPendingHeader = header;
    _bkpPendingCounts = counts;

    if (isBig) { _lstepSet('bkp-scan', 'done'); _lbarSet(100); }

    // Garante que o modal está no modo restaurar
    if (_bkpMode !== 'restaurar') bkpSwitchTab('restaurar');

    // Renderiza preview com checkboxes dos módulos disponíveis
    const listEl = document.getElementById('bkp-preview-list');
    if (!previewEl || !listEl) return;

    const expAt = header._exportedAt ? `Exportado em: ${header._exportedAt}` : '';
    const version = header._version || 'v1';

    listEl.innerHTML = `
      <div style="padding:8px 12px;background:var(--surface3);border-radius:8px;font-size:11px;
        color:var(--text3);display:flex;gap:16px;flex-wrap:wrap;margin-bottom:4px">
        <span><i class="ti ti-tag" style="margin-right:3px"></i>${version}</span>
        ${expAt ? `<span><i class="ti ti-clock" style="margin-right:3px"></i>${expAt}</span>` : ''}
        <span><i class="ti ti-database" style="margin-right:3px"></i>${available.length} módulo(s) no arquivo</span>
        <span><i class="ti ti-file" style="margin-right:3px"></i>${sizeMB.toFixed(sizeMB < 10 ? 1 : 0)} MB</span>
      </div>
      ${available.map(m => {
        const count = counts[m.key] || 0;
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

  } catch (err) {
    console.error('[Backup] Erro ao ler arquivo para restauração:', err);
    toast('Falha ao ler o arquivo: JSON inválido ou corrompido', 'error');
  } finally {
    if (isBig) {
      hideLoadingOverlay('Leitura concluída');
      if (typeof loadingHideSteps === 'function') loadingHideSteps();
    }
  }
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
  if (!_bkpPendingFile) {
    toast('Nenhum arquivo carregado. Selecione um backup primeiro.', 'error');
    return;
  }

  const file   = _bkpPendingFile;
  const counts = _bkpPendingCounts || {};

  // Coleta módulos marcados para restaurar
  const toRestore = _BKP_MODULES.filter(m => {
    const chk = document.getElementById('bkp-rst-chk-' + m.key);
    return chk && chk.checked && counts[m.key] !== undefined;
  });

  if (toRestore.length === 0) {
    toast('Selecione ao menos um módulo para restaurar', 'error');
    return;
  }

  const totalNovo   = toRestore.reduce((s, m) => s + (counts[m.key] || 0), 0);
  const totalAtual  = toRestore.reduce((s, m) => s + (state[m.key] || []).length, 0);
  const moduloNomes = toRestore.map(m => m.label).join(', ');

  const msg = totalAtual > 0
    ? `Restaurar ${toRestore.length} módulo(s): ${moduloNomes}?\n\nIsso substituirá ${totalAtual.toLocaleString('pt-BR')} registros atuais por ${totalNovo.toLocaleString('pt-BR')} do backup. Esta ação não pode ser desfeita.`
    : `Restaurar ${toRestore.length} módulo(s): ${moduloNomes}?\n\n${totalNovo.toLocaleString('pt-BR')} registros serão carregados.`;

  if (!confirm(msg)) return;

  closeModal('modal-backup');

  const sizeMB = file.size / (1024 * 1024);

  showLoadingOverlay('Restaurando backup', 'Lendo e processando o arquivo...');
  if (typeof loadingShowSteps === 'function') loadingShowSteps([
    { id: 'bkp-restore', icon: 'ti-database-import', label: `Lendo e restaurando ${toRestore.length} módulo(s)` },
    { id: 'bkp-index',   icon: 'ti-list-search',     label: 'Reconstruindo índices' },
    { id: 'bkp-save',    icon: 'ti-device-floppy',   label: 'Salvando estado' },
    { id: 'bkp-render',  icon: 'ti-layout',          label: 'Atualizando interface' },
  ]);
  await nextFrame();

  try {
    _lstepSet('bkp-restore', 'running'); _lbarSet(0);

    // Lê o arquivo em streaming, materializando apenas os módulos selecionados
    // (mais 'acoesRelatorio', mantido por compatibilidade com backups antigos).
    // Os módulos não selecionados são apenas percorridos/contados — nunca
    // convertidos em objetos — o que também acelera restaurações parciais.
    const wantedBigKeys = new Set([...toRestore.map(m => m.key), 'acoesRelatorio']);
    const { header, data } = await _bkpParseStreaming(file, {
      wantedBigKeys,
      onProgress: (frac) => {
        // Reserva os últimos ~30% da barra para índices/salvamento/render abaixo
        _lbarSet(Math.round(frac * 65));
        updateLoadingOverlay(`Lendo backup... ${(frac * 100).toFixed(0)}% (${(sizeMB * frac).toFixed(0)} MB de ${sizeMB.toFixed(0)} MB)`);
      }
    });

    // Aplica os módulos selecionados
    toRestore.forEach(m => {
      if (!Array.isArray(data[m.key])) return;
      if (m.key === 'invJustificativas') {
        // Restaura só as justificativas PREENCHIDAS do backup (defensivo —
        // backups antigos, de antes desse filtro existir na exportação,
        // ainda podem ter entradas vazias), e MESCLA por chave em cima do
        // que já existe hoje — nunca substitui a lista inteira. Uma
        // justificativa que existe agora mas não está no backup (feita
        // DEPOIS que o backup foi tirado) continua intacta; uma que existe
        // nos dois lugares é sobrescrita pelo valor do backup, que é
        // literalmente o que "restaurar aquele módulo" pede pra fazer.
        // Isso evita o cenário que já aconteceu: restaurar um backup
        // antigo apagando justificativas feitas depois dele.
        const atual = new Map((state.invJustificativas || []).map(r => [r.k, r]));
        data.invJustificativas
          .filter(rec => !!(rec && (rec.op || rec.fiscal || rec.saldo || rec.custoMedioSap || rec.documentoSap)))
          .forEach(rec => { if (rec && rec.k) atual.set(rec.k, rec); });
        state.invJustificativas = [...atual.values()];
      } else {
        state[m.key] = data[m.key];
      }
    });

    // Restaura acoesRelatorio se presente no arquivo (compatibilidade com backups antigos)
    if (Array.isArray(data.acoesRelatorio)) {
      state.acoesRelatorio = data.acoesRelatorio;
    }
    _lstepSet('bkp-restore', 'done'); _lbarSet(70);

    // Reprocessa índices
    _lstepSet('bkp-index', 'running');
    invalidateMaterialLookup();
    invalidateFilialLookup();
    invalidateLancIndex();
    invalidateSapIndex();
    invalidateSaidasIndex();
    if (typeof invalidateAllSearchIndexes === 'function') invalidateAllSearchIndexes();
    if (typeof reaplicarPadronizacaoMateriais === 'function') reaplicarPadronizacaoMateriais();
    // Se os overrides de Ajuste de Fechamento Mensal foram restaurados, o
    // cache (Set derivado) precisa ser invalidado — senão o sistema continua
    // aplicando as decisões antigas até a próxima mutação.
    if (typeof invalidateFechOverrideCache === 'function') invalidateFechOverrideCache();
    _lstepSet('bkp-index', 'done'); _lbarSet(80);

    // Se as justificativas do Inventário foram restauradas, força o módulo a
    // re-hidratar seu mapa em memória a partir do novo state — senão o
    // próximo salvamento (_invSyncJustificativasToState) sobrescreveria os
    // dados recém-restaurados. Fica após o rebuild de índices para que a
    // eventual regeneração da tabela use os índices já atualizados.
    if (toRestore.some(m => m.key === 'invJustificativas') && typeof window._invReloadJustificativas === 'function') {
      window._invReloadJustificativas();
    }

    // Restaura dados auxiliares do localStorage
    const lsSet = (key, val) => { try { if (val !== null && val !== undefined) localStorage.setItem(key, JSON.stringify(val)); } catch(e) {} };
    lsSet('analyticsys_notes_v2',     header._notas);
    lsSet('analyticsys_shortcuts_v1', header._atalhos);
    lsSet('analyticsys_fech_v1',      header._fechamento);

    _lstepSet('bkp-save', 'running'); _lbarSet(90);
    await persistStateNow();
    _lstepSet('bkp-save', 'done');

    _lstepSet('bkp-render', 'running'); _lbarSet(97);
    if (typeof renderAll === 'function') renderAll();
    if (typeof updateImportPrereqUI === 'function') updateImportPrereqUI();
    _lstepSet('bkp-render', 'done'); _lbarSet(100);

    const info = header._exportedAt ? ` (exportado em ${header._exportedAt})` : '';
    setTimeout(() => toast(`${toRestore.length} módulo(s) restaurado(s)${info} — ${totalNovo.toLocaleString('pt-BR')} registros`), 300);

    _bkpPendingFile   = null;
    _bkpPendingHeader = null;
    _bkpPendingCounts = null;

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
