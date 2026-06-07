function fmtDate(v) {
  if (v === '' || v === null || v === undefined) return '—';
  if (typeof v === 'object') return '—'; // objeto de erro XLSX {t:'e', v:n}
  const s = String(v).trim();
  if (/^#/.test(s)) return '—'; // strings de erro Excel (#VALUE!, #N/A, etc.)
  if (typeof v === 'number' && window.XLSX?.SSF) {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${String(d.d).padStart(2, '0')}/${String(d.m).padStart(2, '0')}/${d.y}`;
  }
  return s || '—';
}

function num(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'object') return 0; // cobre objetos de erro XLSX {t:'e', v:n}
  const s = String(v).trim();
  if (/^#/.test(s)) return 0; // strings de erro Excel: #VALUE!, #N/A, etc.
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Sanitiza um worksheet XLSX antes do sheet_to_json.
 * Células com erro (type 'e') são substituídas por células vazias,
 * evitando que #VALUE!, #DIV/0!, #N/A, etc. corrompam a importação.
 * Também converte valores de texto que sejam strings de erro Excel.
 */
function sanitizeWorksheet(ws) {
  const EXCEL_ERR_RE = /^#(VALUE|DIV\/0|N\/A|REF|NAME\?|NUM|NULL|CALC|SPILL|FIELD|BLOCKED|CONNECT)!?$/i;
  Object.keys(ws).forEach(addr => {
    if (addr.startsWith('!')) return; // metadata da planilha — não tocar
    const cell = ws[addr];
    if (!cell) return;
    // Célula com tipo erro (e = error no formato XLSX)
    if (cell.t === 'e') {
      ws[addr] = { t: 's', v: '', w: '' };
      return;
    }
    // String que contém um erro Excel (pode ocorrer em CSV ou planilhas mistas)
    if (cell.t === 's' && typeof cell.v === 'string' && EXCEL_ERR_RE.test(cell.v.trim())) {
      ws[addr] = { t: 's', v: '', w: '' };
    }
  });
  return ws;
}

function money(v, decimals = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// Abbreviated monetary value: R$ 1,2 M / R$ 544,3 M / R$ 10,5 B
function moneyShort(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9) return sign + 'R$ ' + (abs / 1e9).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' Bi';
  if (abs >= 1e6) return sign + 'R$ ' + (abs / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' M';
  if (abs >= 1e3) return sign + 'R$ ' + (abs / 1e3).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' K';
  return sign + 'R$ ' + abs.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function signedKg(v, decimals = 2) {
  const n = num(v);
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0.0001 ? '+ ' : n < -0.0001 ? '− ' : '';
  return sign + fmtKg(Math.abs(n), decimals);
}

function signedMoneyShort(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0.0001 ? '+ ' : n < -0.0001 ? '− ' : '';
  return sign + moneyShort(Math.abs(n));
}

function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  const icon = el?.querySelector('i');
  const msgEl = document.getElementById('toast-msg');
  if (!el || !icon || !msgEl) return;
  msgEl.textContent = msg;
  el.className = 'toast ' + type;
  icon.className = type === 'success' ? 'ti ti-circle-check' : 'ti ti-circle-x';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}

function confirmarComUndo({ message, action, undo, delay = 5000 }) {
  action();

  const id = 'undo-toast-' + Date.now();
  const el = document.createElement('div');
  el.id = id;
  el.className = 'toast error show';
  el.style.cssText = 'display:flex;align-items:center;gap:12px;min-width:280px;justify-content:space-between;pointer-events:all';
  el.innerHTML = `
    <span style="flex:1;font-size:13px">${escapeHtml(message)}</span>
    <button id="${id}-btn" class="undo-toast-btn">Desfazer</button>
  `;

  const container = document.getElementById('toast')?.parentElement ?? document.body;
  container.appendChild(el);

  let undone = false;
  const timer = setTimeout(() => { if (!undone) el.remove(); }, delay);

  document.getElementById(`${id}-btn`)?.addEventListener('click', () => {
    if (undone) return;
    undone = true;
    clearTimeout(timer);
    el.remove();
    undo();
    toast('Ação desfeita', 'success');
  });
}

// Modal de confirmação para ações destrutivas
function confirmarDestrutivo({ title = 'Confirmar exclusão', sub = '', body = '', confirmLabel = 'Excluir', onConfirm }) {
  document.getElementById('mcd-title').textContent         = title;
  document.getElementById('mcd-sub').textContent           = sub;
  document.getElementById('mcd-body').innerHTML            = body;
  document.getElementById('mcd-confirm-label').textContent = confirmLabel;

  const btn = document.getElementById('mcd-confirm-btn');
  // Remove previous listener
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.addEventListener('click', () => {
    closeModal('modal-confirm-destrutivo');
    onConfirm();
  });

  openModal('modal-confirm-destrutivo');
}

Object.assign(window, { confirmarDestrutivo });

const loadingOverlayState = {
  visible: false,
  startedAt: 0,
  timer: null,
  hintTimer: null,
  closeTimer: null,
  hintIndex: 0
};

const loadingHints = [
  'Lendo banco de dados',
  'Atualizando os dados',
  'Convertendo valores',
  'Normalizando centrais',
  'Organizando materiais',
  'Sincronizando registros',
  'Aplicando filtros e índices',
  'Montando a interface'
];

function formatLoadingElapsed(ms) {
  const safeMs = Math.max(0, ms);
  if (safeMs < 10000) {
    return `${(safeMs / 1000).toFixed(1)}s`;
  }
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0
    ? `${minutes}m ${String(seconds).padStart(2, '0')}s`
    : `${totalSeconds}s`;
}

function syncLoadingElapsed() {
  const timeEl = document.getElementById('loading-time');
  if (!timeEl || !loadingOverlayState.visible) return;
  timeEl.textContent = formatLoadingElapsed(performance.now() - loadingOverlayState.startedAt);
}

function syncLoadingHint() {
  const hintEl = document.getElementById('loading-hint');
  if (!hintEl || !loadingOverlayState.visible) return;
  const hint = loadingHints[loadingOverlayState.hintIndex % loadingHints.length];
  hintEl.textContent = hint;
  loadingOverlayState.hintIndex += 1;
}

function isLoadingOverlayVisible() {
  return loadingOverlayState.visible;
}

function showLoadingOverlay(title = 'Carregando', status = 'Processando dados...') {
  const overlay = document.getElementById('loading-overlay');
  const titleEl = document.getElementById('loading-title');
  const statusEl = document.getElementById('loading-status');
  const hintEl = document.getElementById('loading-hint');
  const badgeEl = document.getElementById('loading-badge');
  const timeEl = document.getElementById('loading-time');
  if (!overlay || !titleEl || !statusEl || !hintEl || !badgeEl || !timeEl) return;

  clearTimeout(loadingOverlayState.closeTimer);
  clearInterval(loadingOverlayState.timer);
  clearInterval(loadingOverlayState.hintTimer);

  loadingOverlayState.visible = true;
  loadingOverlayState.startedAt = performance.now();
  loadingOverlayState.hintIndex = 0;

  document.body.classList.add('loading-active');
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');

  titleEl.textContent = title;
  statusEl.textContent = status;
  hintEl.textContent = loadingHints[0];
  badgeEl.textContent = 'Processando';
  timeEl.textContent = '0.0s';

  syncLoadingElapsed();
  syncLoadingHint();
  loadingOverlayState.timer = setInterval(syncLoadingElapsed, 100);
  loadingOverlayState.hintTimer = setInterval(syncLoadingHint, 2600);
}

function updateLoadingOverlay(status, title, hint) {
  if (!loadingOverlayState.visible) return;
  const titleEl = document.getElementById('loading-title');
  const statusEl = document.getElementById('loading-status');
  const hintEl = document.getElementById('loading-hint');
  const badgeEl = document.getElementById('loading-badge');
  if (title && titleEl) titleEl.textContent = title;
  if (status && statusEl) statusEl.textContent = status;
  if (hint && hintEl) hintEl.textContent = hint;
  if (badgeEl) badgeEl.textContent = 'Processando';
  syncLoadingElapsed();
}

function hideLoadingOverlay(status = 'Concluído', delay = 220) {
  const overlay = document.getElementById('loading-overlay');
  const statusEl = document.getElementById('loading-status');
  const hintEl = document.getElementById('loading-hint');
  const badgeEl = document.getElementById('loading-badge');
  if (!overlay || !statusEl || !hintEl || !badgeEl) return;
  if (!loadingOverlayState.visible) return;

  if (status) statusEl.textContent = status;
  hintEl.textContent = 'Finalizando a sessão local...';
  badgeEl.textContent = 'Finalizado';
  syncLoadingElapsed();

  clearInterval(loadingOverlayState.timer);
  clearInterval(loadingOverlayState.hintTimer);
  loadingOverlayState.timer = null;
  loadingOverlayState.hintTimer = null;

  loadingOverlayState.closeTimer = setTimeout(() => {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('loading-active');
    loadingOverlayState.visible = false;
  }, delay);
}


function nextFrame() {
  // Double-defer: rAF agenda o próximo frame, setTimeout(0) garante que o browser pintou
  return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

function openModal(id) {
  document.getElementById(id)?.classList.add('open');
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
}

let startupRestoreResolver = null;

// Verifica se há dados de importação no storage (entradas, saídas, SAP,
// lançamentos, produção ou imports). configs/filiais/materiais são dados
// de cadastro do sistema e nunca disparam o modal.
async function storageHasImportedData() {
  const importKeys = ['entradas', 'saidas', 'lancamentos', 'sap', 'producao', 'imports'];
  try {
    const db = await openDb();
    if (db) {
      for (const key of importKeys) {
        const val = await idbGet(db, key).catch(() => null);
        if (Array.isArray(val) && val.length > 0) return true;
      }
      const snapshot = await idbGet(db, IDB_STATE_KEY).catch(() => null);
      if (snapshot && typeof snapshot === 'object') {
        for (const key of importKeys) {
          if (Array.isArray(snapshot[key]) && snapshot[key].length > 0) return true;
        }
      }
    }
  } catch (_) {}
  try {
    const raw = localStorage.getItem(legacyStateKey);
    if (raw) {
      const parsed = safeJSONParse(raw, {});
      if (parsed && typeof parsed === 'object') {
        for (const key of importKeys) {
          if (Array.isArray(parsed[key]) && parsed[key].length > 0) return true;
        }
      }
    }
  } catch (_) {}
  return false;
}

function openStartupRestoreModal() {
  return new Promise(resolve => {
    startupRestoreResolver = resolve;
    openModal('startup-restore-overlay');
  });
}

function decideStartupRestore(shouldRestore) {
  if (startupRestoreResolver) {
    const resolve = startupRestoreResolver;
    startupRestoreResolver = null;
    resolve(shouldRestore);
  }
  closeModal('startup-restore-overlay');
}

function toggleSidebar() {
  document.querySelector('.sidebar')?.classList.toggle('open');
  document.getElementById('nav-overlay')?.classList.toggle('open');
}

// ═══════════════════════════════════════════════════════════
// CALCULADORA FLUTUANTE
// ═══════════════════════════════════════════════════════════
const _calc = {
  display: '0',
  history: '',
  operand: null,
  operator: null,
  waitingForOperand: false,
  justCalc: false
};

function toggleCalc() {
  const pop = document.getElementById('calc-popover');
  const btn = document.getElementById('calc-trigger-btn');
  if (!pop) return;
  const open = pop.style.display !== 'none';
  pop.style.display = open ? 'none' : '';
  btn?.classList.toggle('active', !open);
}

function setCalcTab(tab) {
  document.getElementById('calc-tab-basica').style.display    = tab === 'basica'    ? '' : 'none';
  document.getElementById('calc-tab-analitica').style.display = tab === 'analitica' ? '' : 'none';
  document.getElementById('calct-basica').classList.toggle('active',    tab === 'basica');
  document.getElementById('calct-analitica').classList.toggle('active', tab === 'analitica');
}

function _calcUpdateDisplay() {
  const d = document.getElementById('calc-display');
  const h = document.getElementById('calc-history');
  if (d) d.textContent = _calc.display;
  if (h) h.textContent = _calc.history;
}

function _calcFmt(n) {
  if (!Number.isFinite(n)) return 'Erro';
  // Mostra até 10 dígitos significativos, sem notação científica para números grandes comuns
  const s = parseFloat(n.toPrecision(10)).toString();
  return s;
}

function calcAction(type, val) {
  switch (type) {
    case 'num': {
      if (_calc.waitingForOperand || _calc.justCalc) {
        _calc.display = val;
        _calc.waitingForOperand = false;
        _calc.justCalc = false;
      } else {
        _calc.display = _calc.display === '0' ? val : _calc.display + val;
      }
      break;
    }
    case 'dot': {
      if (_calc.waitingForOperand || _calc.justCalc) { _calc.display = '0.'; _calc.waitingForOperand = false; _calc.justCalc = false; break; }
      if (!_calc.display.includes('.')) _calc.display += '.';
      break;
    }
    case 'op': {
      const current = parseFloat(_calc.display);
      if (_calc.operand !== null && !_calc.waitingForOperand) {
        const result = _calcCompute(_calc.operand, current, _calc.operator);
        _calc.display = _calcFmt(result);
        _calc.operand = result;
      } else {
        _calc.operand = current;
      }
      _calc.operator = val;
      _calc.history = _calc.display + ' ' + { '+':'+', '-':'−', '*':'×', '/':'÷' }[val];
      _calc.waitingForOperand = true;
      _calc.justCalc = false;
      break;
    }
    case 'eq': {
      if (_calc.operator === null) break;
      const a = _calc.operand;
      const b = parseFloat(_calc.display);
      const result = _calcCompute(a, b, _calc.operator);
      _calc.history = _calcFmt(a) + ' ' + { '+':'+', '-':'−', '*':'×', '/':'÷' }[_calc.operator] + ' ' + _calcFmt(b) + ' =';
      _calc.display = _calcFmt(result);
      _calc.operand = null;
      _calc.operator = null;
      _calc.waitingForOperand = false;
      _calc.justCalc = true;
      break;
    }
    case 'clear': {
      _calc.display = '0'; _calc.history = ''; _calc.operand = null;
      _calc.operator = null; _calc.waitingForOperand = false; _calc.justCalc = false;
      break;
    }
    case 'sign': {
      _calc.display = _calcFmt(-parseFloat(_calc.display));
      break;
    }
    case 'pct': {
      _calc.display = _calcFmt(parseFloat(_calc.display) / 100);
      break;
    }
  }
  _calcUpdateDisplay();
}

function _calcCompute(a, b, op) {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return b !== 0 ? a / b : NaN;
  }
  return b;
}

// Keyboard support
document.addEventListener('keydown', function(e) {
  const pop = document.getElementById('calc-popover');
  if (!pop || pop.style.display === 'none') return;
  // Don't capture if user is typing in an input inside the calc
  if (e.target.tagName === 'INPUT') return;
  const tab = document.getElementById('calc-tab-basica');
  if (!tab || tab.style.display === 'none') return;

  if (e.key >= '0' && e.key <= '9') { calcAction('num', e.key); e.preventDefault(); }
  else if (e.key === '.') { calcAction('dot'); e.preventDefault(); }
  else if (e.key === '+') { calcAction('op', '+'); e.preventDefault(); }
  else if (e.key === '-') { calcAction('op', '-'); e.preventDefault(); }
  else if (e.key === '*') { calcAction('op', '*'); e.preventDefault(); }
  else if (e.key === '/') { calcAction('op', '/'); e.preventDefault(); }
  else if (e.key === 'Enter' || e.key === '=') { calcAction('eq'); e.preventDefault(); }
  else if (e.key === 'Escape') { toggleCalc(); }
  else if (e.key === 'Backspace') {
    if (_calc.display.length > 1) _calc.display = _calc.display.slice(0, -1);
    else _calc.display = '0';
    _calcUpdateDisplay();
    e.preventDefault();
  }
  else if (e.key === 'c' || e.key === 'C') { calcAction('clear'); e.preventDefault(); }
});

// Analytic calculators
function calcAnalitica() {
  const n = id => { const v = parseFloat(document.getElementById(id)?.value); return Number.isFinite(v) ? v : null; };
  const fmtKgC = v => v == null ? '—' : v.toLocaleString('pt-BR', {minimumFractionDigits:2,maximumFractionDigits:2}) + ' kg';
  const fmtPct = v => v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(2) + '%';
  const fmtBRL = v => v == null ? '—' : 'R$ ' + v.toLocaleString('pt-BR', {minimumFractionDigits:2,maximumFractionDigits:2});
  const setVal = (id, text, cls) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = 'calc-result-val' + (cls ? ' ' + cls : '');
  };

  // Variação
  const real    = n('ca-real');
  const teorico = n('ca-teorico');
  if (real != null && teorico != null) {
    const varKg  = real - teorico;
    const varPct = teorico !== 0 ? (varKg / Math.abs(teorico)) * 100 : null;
    const cls    = varKg < -0.001 ? 'neg' : varKg > 0.001 ? 'pos' : '';
    setVal('ca-var-val',    fmtKgC(varKg), cls);
    setVal('ca-varpct-val', fmtPct(varPct), cls);
  } else {
    setVal('ca-var-val', '—'); setVal('ca-varpct-val', '—');
  }

  // Custo implicado
  const varkg = n('ca-varkg');
  const custo = n('ca-custo');
  if (varkg != null && custo != null) {
    const custoTotal = varkg * custo;
    setVal('ca-custo-val', fmtBRL(custoTotal), custoTotal < 0 ? 'neg' : custoTotal > 0 ? 'pos' : '');
  } else {
    setVal('ca-custo-val', '—');
  }

  // Estoque teórico
  const ini = n('ca-ini');
  const ent = n('ca-ent');
  const sai = n('ca-sai');
  if (ini != null || ent != null || sai != null) {
    const t = (ini || 0) + (ent || 0) - (sai || 0);
    setVal('ca-teorico-val', fmtKgC(t), '');
  } else {
    setVal('ca-teorico-val', '—');
  }
}

function calcCopy(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const text = el.textContent.replace(/[^\d.,\-+%RS$ ]/g, '').trim();
  navigator.clipboard?.writeText(text).then(() => toast('Copiado!'));
}

// Close on outside click
document.addEventListener('click', function(e) {
  const wrap = document.getElementById('calc-wrap');
  const pop  = document.getElementById('calc-popover');
  if (pop && pop.style.display !== 'none' && wrap && !wrap.contains(e.target)) {
    pop.style.display = 'none';
    document.getElementById('calc-trigger-btn')?.classList.remove('active');
  }
});

Object.assign(window, { toggleCalc, setCalcTab, calcAction, calcAnalitica, calcCopy });

// ═══════════════════════════════════════════════════════════
// MODAL DE BUSCA GLOBAL (Ctrl+K)
// ═══════════════════════════════════════════════════════════
let _smTimer  = null;
let _smFocusIdx = -1;
let _smItems  = []; // flat list of { modKey, record } for keyboard nav

function openSearchModal(prefill = '') {
  const modal = document.getElementById('modal-search-global');
  const input = document.getElementById('search-modal-input');
  if (!modal) return;
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  _smFocusIdx = -1;
  _smItems = [];
  if (input) {
    input.value = prefill;
    input.focus();
    // Seleciona o texto pré-preenchido para facilitar substituição
    if (prefill) {
      input.select();
      handleSearchModal(prefill);
    }
  }
  if (!prefill) _renderSmHint();
}

function closeSearchModal() {
  const modal = document.getElementById('modal-search-global');
  if (!modal) return;
  modal.classList.remove('open');
  document.body.style.overflow = '';
  clearTimeout(_smTimer);
}

function _renderSmHint() {
  const el = document.getElementById('search-modal-results');
  if (!el) return;
  el.innerHTML = `
    <div class="sm-hint">
      <i class="ti ti-search"></i>
      Digite para buscar em lançamentos, SAP, entradas, saídas, centrais e materiais
    </div>`;
}

function handleSearchModal(query) {
  clearTimeout(_smTimer);
  const el = document.getElementById('search-modal-results');
  if (!el) return;
  const q = query.trim();
  if (!q || q.length < 2) { _renderSmHint(); return; }

  el.innerHTML = `<div class="sm-empty"><i class="ti ti-loader"></i>Buscando...</div>`;
  _smTimer = setTimeout(() => _runSearchModal(q, el), 120);
}

function _runSearchModal(q, el) {
  const ql     = q.toLowerCase();
  const tokens = ql.split(/\s+/).filter(Boolean);

  const moduleColors = window._moduleColors || {
    'Entrada':    { bg: 'var(--green-bg)',   color: 'var(--green)',  icon: 'ti-package-import', nav: 'entradas'   },
    'Saída':      { bg: 'var(--red-bg)',     color: 'var(--red)',    icon: 'ti-package-export', nav: 'saidas'     },
    'Lançamento': { bg: 'var(--amber-bg)',   color: 'var(--amber)',  icon: 'ti-clipboard-list', nav: 'lancamentos'},
    'SAP':        { bg: 'var(--accent-dim)', color: 'var(--accent)', icon: 'ti-database',       nav: 'sap'        },
    'Produção':   { bg: 'var(--purple-bg)',  color: 'var(--purple)', icon: 'ti-chart-bar',      nav: 'producao'   },
    'Central':    { bg: 'var(--teal-bg)',    color: 'var(--teal)',   icon: 'ti-building-warehouse', nav: 'filiais'},
    'Material':   { bg: 'var(--bg3)',        color: 'var(--text2)',  icon: 'ti-box',            nav: 'materiais'  },
  };

  const groups = {};
  const allItems = [];

  const addItem = (modKey, label, sub, record) => {
    if (!groups[modKey]) groups[modKey] = [];
    if (groups[modKey].length < 6) {
      groups[modKey].push({ label, sub, record, modKey });
      allItems.push({ label, sub, record, modKey });
    }
  };

  const searchMod = (scope, modKey, getLabel, getSub) => {
    const records = (typeof state !== 'undefined' ? state[scope] : []) || [];
    if (!records.length) return;
    const fields = typeof getSearchableFields === 'function' ? getSearchableFields(scope) : [];
    const index  = typeof _getOrBuildIndex   === 'function' ? _getOrBuildIndex(scope, records, fields) : [];
    for (let i = 0; i < index.length; i++) {
      if (tokens.every(t => index[i].includes(t))) {
        addItem(modKey, getLabel(records[i]), getSub(records[i]), records[i]);
        if ((groups[modKey]?.length || 0) >= 6) break;
      }
    }
  };

  searchMod('entradas',    'Entrada',    r => r.material || r.nf || '—',       r => [r.centralCompra, r.dtEmissao].filter(Boolean).join(' · '));
  searchMod('saidas',      'Saída',      r => r.material || r.os || '—',       r => [r.central, r.dtEmissao].filter(Boolean).join(' · '));
  searchMod('lancamentos', 'Lançamento', r => r.material || '—',               r => [r.central, r.dtLanc].filter(Boolean).join(' · '));
  searchMod('sap',         'SAP',        r => r.material || r.documento || '—',r => [r.central, r.movimento, r.dtLanc].filter(Boolean).join(' · '));
  searchMod('producao',    'Produção',   r => r.central || '—',                r => r.mes || '');

  ((typeof state !== 'undefined' ? state.filiais : []) || []).forEach(r => {
    if (tokens.every(t => [r.origem,r.alias,r.regional,r.cnpj].join(' ').toLowerCase().includes(t)))
      addItem('Central', r.alias||r.origem||'—', r.regional||'', r);
  });
  ((typeof state !== 'undefined' ? state.materiais : []) || []).forEach(r => {
    if (tokens.every(t => [r.origem,r.alias,r.desc].join(' ').toLowerCase().includes(t)))
      addItem('Material', r.alias||r.origem||'—', r.desc||'', r);
  });

  _smItems = allItems;
  _smFocusIdx = -1;

  const totalItems = allItems.length;
  if (!totalItems) {
    el.innerHTML = `
      <div class="sm-empty">
        <i class="ti ti-search-off"></i>
        Nenhum resultado para <strong>"${escapeHtml(q)}"</strong>
      </div>`;
    return;
  }

  let flatIdx = 0;
  const html = Object.entries(groups).map(([modKey, items]) => {
    const cfg = moduleColors[modKey] || {};
    const rows = items.map(item => {
      const idx = flatIdx++;
      const labelHl = _smHighlight(escapeHtml(item.label), tokens);
      return `
        <div class="sm-item" data-sm-idx="${idx}"
          onclick="_smSelectIdx(${idx})"
          onmouseenter="_smHoverIdx(${idx})">
          <div class="sm-item-icon" style="background:${cfg.bg||'var(--bg3)'};color:${cfg.color||'var(--text2)'}">
            <i class="ti ${cfg.icon||'ti-circle'}"></i>
          </div>
          <div class="sm-item-body">
            <div class="sm-item-label">${labelHl}</div>
            <div class="sm-item-sub">${escapeHtml(item.sub)}</div>
          </div>
          <i class="ti ti-chevron-right sm-item-arrow"></i>
        </div>`;
    }).join('');

    return `
      <div class="sm-group">
        <div class="sm-group-header" style="color:${moduleColors[modKey]?.color||'var(--text3)'}">
          <i class="ti ${moduleColors[modKey]?.icon||'ti-circle'}" style="font-size:11px"></i>
          ${modKey}
          <span class="sm-group-count">${items.length}${items.length >= 6 ? '+' : ''}</span>
        </div>
        ${rows}
      </div>`;
  }).join('');

  el.innerHTML = html;
}

function _smHighlight(text, tokens) {
  let result = text;
  tokens.forEach(t => {
    const re = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    result = result.replace(re, '<mark class="search-highlight">$1</mark>');
  });
  return result;
}

function _smSetFocus(idx) {
  const items = document.querySelectorAll('#search-modal-results .sm-item');
  items.forEach((el, i) => el.classList.toggle('focused', i === idx));
  if (items[idx]) items[idx].scrollIntoView({ block: 'nearest' });
  _smFocusIdx = idx;
}

function _smHoverIdx(idx) { _smSetFocus(idx); }

function _smSelectIdx(idx) {
  const item = _smItems[idx];
  if (!item) return;
  closeSearchModal();
  if (typeof _gsShowDetail === 'function') _gsShowDetail(item.modKey, item.record);
}

// Keyboard navigation inside modal
document.addEventListener('keydown', function(e) {
  const modal = document.getElementById('modal-search-global');
  if (!modal?.classList.contains('open')) return;

  const items = document.querySelectorAll('#search-modal-results .sm-item');
  if (!items.length) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _smSetFocus(Math.min(_smFocusIdx + 1, items.length - 1));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _smSetFocus(Math.max(_smFocusIdx - 1, 0));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const idx = _smFocusIdx >= 0 ? _smFocusIdx : 0;
    _smSelectIdx(idx);
  }
});

// Store moduleColors globally for access from format.js
window._moduleColors = {
  'Entrada':    { bg: 'var(--green-bg)',   color: 'var(--green)',  icon: 'ti-package-import', nav: 'entradas'   },
  'Saída':      { bg: 'var(--red-bg)',     color: 'var(--red)',    icon: 'ti-package-export', nav: 'saidas'     },
  'Lançamento': { bg: 'var(--amber-bg)',   color: 'var(--amber)',  icon: 'ti-clipboard-list', nav: 'lancamentos'},
  'SAP':        { bg: 'var(--accent-dim)', color: 'var(--accent)', icon: 'ti-database',       nav: 'sap'        },
  'Produção':   { bg: 'var(--purple-bg)',  color: 'var(--purple)', icon: 'ti-chart-bar',      nav: 'producao'   },
  'Central':    { bg: 'var(--teal-bg)',    color: 'var(--teal)',   icon: 'ti-building-warehouse', nav: 'filiais'},
  'Material':   { bg: 'var(--bg3)',        color: 'var(--text2)',  icon: 'ti-box',            nav: 'materiais'  },
};

Object.assign(window, { openSearchModal, closeSearchModal, handleSearchModal, _smSelectIdx, _smHoverIdx });
