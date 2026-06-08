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

// ── Tools menu ──────────────────────────────────────────
function toggleToolsMenu() {
  const dd  = document.getElementById('tools-dropdown');
  const btn = document.getElementById('tools-trigger-btn');
  if (!dd) return;
  const open = dd.classList.contains('open');
  dd.classList.toggle('open', !open);
  btn?.classList.toggle('active', !open);
}

function closeToolsMenu() {
  document.getElementById('tools-dropdown')?.classList.remove('open');
  document.getElementById('tools-trigger-btn')?.classList.remove('active');
}

// Close tools dropdown when clicking outside
document.addEventListener('click', e => {
  const wrap = document.getElementById('tools-wrap');
  if (wrap && !wrap.contains(e.target)) closeToolsMenu();
});

// ── Tool popovers ────────────────────────────────────────
const _openTools = new Set();

function openTool(name) {
  const el = document.getElementById('tool-' + name);
  if (!el) return;
  // If already open, just bring to front
  if (_openTools.has(name)) {
    el.style.zIndex = _nextToolZ();
    return;
  }
  // Show first (off-screen) so we can measure actual width, then position
  el.style.visibility = 'hidden';
  el.style.display    = 'flex';
  el.style.left       = '0px';
  el.style.top        = '0px';
  el.style.right      = 'auto';

  const topbarH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 56;
  const offset  = _openTools.size * 20;
  const elW     = el.offsetWidth || 300;
  el.style.left       = Math.max(8, window.innerWidth - elW - 20 - offset) + 'px';
  el.style.top        = (topbarH + 10 + offset) + 'px';
  el.style.zIndex     = _nextToolZ();
  el.style.visibility = '';

  _openTools.add(name);
  _makeDraggable(el);
  if (name === 'notes') _notesLoad();
}

function closeTool(name) {
  const el = document.getElementById('tool-' + name);
  if (!el) return;
  el.style.display = 'none';
  _openTools.delete(name);
}

let _toolZBase = 490;
function _nextToolZ() { return ++_toolZBase; }

// Legacy: keep toggleCalc working (mapped to tool system)
function toggleCalc() {
  if (_openTools.has('calc')) closeTool('calc');
  else openTool('calc');
}

// ── Drag & Resize logic ──────────────────────────────────
const _MIN_W = 260, _MIN_H = 200;

function _makeDraggable(popover) {
  const header = popover.querySelector('.tool-popover-header');
  if (!header || header._dragInit) return;
  header._dragInit = true;

  header.addEventListener('mousedown', e => {
    if (e.target.closest('.tool-popover-close')) return;
    e.preventDefault();

    const rect   = popover.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const startL = rect.left,  startT = rect.top;
    let   moved  = false;

    popover.style.left   = startL + 'px';
    popover.style.right  = 'auto';
    popover.style.top    = startT + 'px';
    popover.style.zIndex = _nextToolZ();

    const onMove = e => {
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (!moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return; // dead zone
      if (!moved) { moved = true; popover.classList.add('dragging'); }
      const maxL = window.innerWidth  - popover.offsetWidth;
      const maxT = window.innerHeight - 60;
      popover.style.left = Math.max(0, Math.min(startL + dx, maxL)) + 'px';
      popover.style.top  = Math.max(0, Math.min(startT + dy, maxT)) + 'px';
    };
    const onUp = () => {
      if (moved) {
        // Brief settle class to suppress any re-animation
        popover.classList.add('settled');
        setTimeout(() => popover.classList.remove('settled'), 50);
      }
      popover.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Inject resize handles (once)
  if (!popover.querySelector('.tool-resize-handle')) {
    ['n','s','e','w','nw','ne','sw','se'].forEach(dir => {
      const h = document.createElement('div');
      h.className = 'tool-resize-handle ' + dir;
      h.dataset.dir = dir;
      popover.appendChild(h);
    });
    _makeResizable(popover);
  }
}

function _makeResizable(popover) {
  popover.addEventListener('mousedown', e => {
    const handle = e.target.closest('.tool-resize-handle');
    if (!handle) return;
    e.preventDefault();

    const dir  = handle.dataset.dir;
    const rect = popover.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const startL = rect.left, startT = rect.top;
    const startW = rect.width, startH = rect.height;

    popover.style.left      = startL + 'px';
    popover.style.right     = 'auto';
    popover.style.top       = startT + 'px';
    popover.style.width     = startW + 'px';
    popover.style.height    = startH + 'px';
    popover.style.maxHeight = 'none';
    popover.style.minHeight = 'none';
    popover.style.zIndex    = _nextToolZ();
    popover.classList.add('resizing');

    const onMove = e => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      let newW = startW, newH = startH, newL = startL, newT = startT;

      if (dir.includes('e')) newW = Math.max(_MIN_W, startW + dx);
      if (dir.includes('w')) { newW = Math.max(_MIN_W, startW - dx); newL = startL + (startW - newW); }
      if (dir.includes('s')) newH = Math.max(_MIN_H, startH + dy);
      if (dir.includes('n')) { newH = Math.max(_MIN_H, startH - dy); newT = startT + (startH - newH); }

      // Clamp to viewport
      newL = Math.max(0, Math.min(newL, window.innerWidth  - _MIN_W));
      newT = Math.max(0, Math.min(newT, window.innerHeight - _MIN_H));

      popover.style.width  = newW + 'px';
      popover.style.height = newH + 'px';
      popover.style.left   = newL + 'px';
      popover.style.top    = newT + 'px';
    };

    const onUp = () => {
      popover.classList.remove('resizing');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
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

// ═══════════════════════════════════════════════════════════
// BLOCO DE NOTAS — Multi-card system
// ═══════════════════════════════════════════════════════════
const _NOTES_KEY  = 'analyticsys_notes_v2';
let _notesCards   = [];   // array of note objects
let _notesActive  = null; // id of currently edited card
let _notesSaveTimer = null;
let _notesPreviewOn = false;

// ── Persistence ─────────────────────────────────────────
function _notesLoad() {
  try {
    const raw = localStorage.getItem(_NOTES_KEY);
    _notesCards = raw ? JSON.parse(raw) : [];
  } catch(e) { _notesCards = []; }
  notesRender();
}

function _notesPersist() {
  try { localStorage.setItem(_NOTES_KEY, JSON.stringify(_notesCards)); } catch(e) {}
  const ind = document.getElementById('notes-saved-indicator');
  if (ind) { ind.textContent = 'salvo'; ind.classList.add('show'); setTimeout(() => ind.classList.remove('show'), 1800); }
}

// ── Card CRUD ────────────────────────────────────────────
function notesNewCard() {
  const card = {
    id:       Date.now().toString(36),
    title:    '',
    body:     '',
    color:    'none',
    priority: 'none',
    created:  Date.now(),
    modified: Date.now(),
  };
  _notesCards.unshift(card);
  _notesPersist();
  notesRender();
  notesOpenEditor(card.id);
}

function notesDeleteCurrent() {
  if (!_notesActive) return;
  if (!confirm('Excluir esta nota?')) return;
  _notesCards = _notesCards.filter(c => c.id !== _notesActive);
  _notesPersist();
  notesCloseEditor();
  notesRender();
}

function notesDeleteCard(id, e) {
  e.stopPropagation();
  if (!confirm('Excluir esta nota?')) return;
  _notesCards = _notesCards.filter(c => c.id !== id);
  if (_notesActive === id) notesCloseEditor();
  _notesPersist();
  notesRender();
}

// ── Render list ──────────────────────────────────────────
const _PRIORITY_ORDER = { high: 0, medium: 1, low: 2, none: 3 };
const _PRIORITY_LABELS = { high: '↑ Alta', medium: '→ Média', low: '↓ Baixa', none: '' };
const _COLOR_MAP = {
  none: '', blue: 'var(--accent)', green: 'var(--green)',
  amber: 'var(--amber)', red: 'var(--red)', purple: 'var(--purple)', teal: 'var(--teal)'
};

function notesRender() {
  const list  = document.getElementById('notes-cards-list');
  if (!list) return;
  const sort  = document.getElementById('notes-sort-select')?.value || 'modified';
  const cards = [..._notesCards].sort((a, b) => {
    if (sort === 'priority') return (_PRIORITY_ORDER[a.priority] ?? 3) - (_PRIORITY_ORDER[b.priority] ?? 3) || b.modified - a.modified;
    if (sort === 'title')    return (a.title||'').localeCompare(b.title||'');
    return b.modified - a.modified;
  });

  if (!cards.length) {
    list.innerHTML = `<div class="notes-empty-state"><i class="ti ti-notebook" style="font-size:28px;opacity:.3"></i><span>Nenhuma nota ainda.<br>Crie sua primeira nota.</span></div>`;
    return;
  }

  list.innerHTML = cards.map(card => {
    const colorBar = _COLOR_MAP[card.color] ? `background:${_COLOR_MAP[card.color]}` : 'background:var(--border)';
    const preview  = (card.body || '').replace(/[#*_~`[\]]/g, '').replace(/\n/g, ' ').slice(0, 80) || '\u2014';
    const dateStr  = new Date(card.modified).toLocaleDateString('pt-BR', {day:'2-digit',month:'2-digit'});
    const priHtml  = card.priority !== 'none'
      ? `<span class="note-priority-badge ${card.priority}">${_PRIORITY_LABELS[card.priority]}</span>` : '';
    const active   = _notesActive === card.id ? ' active' : '';
    return `
      <div class="note-card-item${active}" onclick="notesOpenEditor('${card.id}')">
        <div class="note-card-color-bar" style="${colorBar}"></div>
        <div class="note-card-body">
          <div class="note-card-title">${escapeHtml(card.title || 'Sem título')}</div>
          <div class="note-card-preview">${escapeHtml(preview)}</div>
          <div class="note-card-meta">
            ${priHtml}
            <span class="note-card-date">${dateStr}</span>
          </div>
        </div>
        <div class="note-card-actions">
          <button class="notes-toolbar-btn" onclick="notesDeleteCard('${card.id}',event)" title="Excluir" style="color:var(--red)">
            <i class="ti ti-trash"></i>
          </button>
        </div>
      </div>`;
  }).join('');
}

// ── Editor ───────────────────────────────────────────────
function notesOpenEditor(id) {
  const card = _notesCards.find(c => c.id === id);
  if (!card) return;
  _notesActive = id;

  document.getElementById('notes-title-input').value    = card.title;
  document.getElementById('notes-textarea-md').value    = card.body;
  document.getElementById('notes-priority-select').value = card.priority;
  _notesSetColorDot(card.color);

  const listPane   = document.getElementById('notes-list-pane');
  const editorPane = document.getElementById('notes-editor-pane');
  if (listPane)   listPane.style.display   = 'none';
  if (editorPane) editorPane.style.display = 'flex';

  // Hide preview, show editor
  _notesPreviewOn = false;
  document.getElementById('notes-preview-btn')?.classList.remove('active');
  document.getElementById('notes-textarea-md').style.display = '';
  document.getElementById('notes-preview-md').style.display  = 'none';

  document.getElementById('notes-textarea-md').focus();
  notesRender(); // update active state in list
}

function notesCloseEditor() {
  _notesActive = null;
  document.getElementById('notes-list-pane').style.display   = '';
  document.getElementById('notes-editor-pane').style.display = 'none';
  notesRender();
}

function notesAutoSave() {
  if (!_notesActive) return;
  const card = _notesCards.find(c => c.id === _notesActive);
  if (!card) return;
  card.title    = document.getElementById('notes-title-input').value;
  card.body     = document.getElementById('notes-textarea-md').value;
  card.priority = document.getElementById('notes-priority-select').value;
  card.modified = Date.now();
  clearTimeout(_notesSaveTimer);
  _notesSaveTimer = setTimeout(() => { _notesPersist(); notesRender(); }, 700);
}

// ── Color ────────────────────────────────────────────────
function notesToggleColors() {
  document.getElementById('notes-color-menu')?.classList.toggle('open');
}
function notesSetColor(color) {
  if (!_notesActive) return;
  const card = _notesCards.find(c => c.id === _notesActive);
  if (!card) return;
  card.color    = color;
  card.modified = Date.now();
  _notesPersist();
  _notesSetColorDot(color);
  document.getElementById('notes-color-menu')?.classList.remove('open');
  notesRender();
}
function _notesSetColorDot(color) {
  const dot = document.getElementById('notes-color-dot');
  if (!dot) return;
  dot.className = 'notes-color-dot nc-dot-' + color;
}

// Close color menu on outside click
document.addEventListener('click', e => {
  const picker = document.getElementById('notes-color-picker');
  if (picker && !picker.contains(e.target)) {
    document.getElementById('notes-color-menu')?.classList.remove('open');
  }
});

// ── Markdown toolbar ─────────────────────────────────────
function notesMdWrap(before, after) {
  const ta  = document.getElementById('notes-textarea-md');
  if (!ta) return;
  const s   = ta.selectionStart, e = ta.selectionEnd;
  const sel = ta.value.slice(s, e);
  ta.value  = ta.value.slice(0, s) + before + sel + after + ta.value.slice(e);
  ta.selectionStart = s + before.length;
  ta.selectionEnd   = s + before.length + sel.length;
  ta.focus();
  notesAutoSave();
}
function notesMdLine(prefix) {
  const ta  = document.getElementById('notes-textarea-md');
  if (!ta) return;
  const s   = ta.selectionStart;
  const lineStart = ta.value.lastIndexOf('\n', s - 1) + 1;
  ta.value  = ta.value.slice(0, lineStart) + prefix + ta.value.slice(lineStart);
  ta.selectionStart = ta.selectionEnd = s + prefix.length;
  ta.focus();
  notesAutoSave();
}

// ── Preview ──────────────────────────────────────────────
function notesTogglePreview() {
  _notesPreviewOn = !_notesPreviewOn;
  document.getElementById('notes-preview-btn')?.classList.toggle('active', _notesPreviewOn);
  document.getElementById('notes-textarea-md').style.display = _notesPreviewOn ? 'none' : '';
  const prev = document.getElementById('notes-preview-md');
  prev.style.display = _notesPreviewOn ? '' : 'none';
  if (_notesPreviewOn) notesUpdatePreview();
}

function notesUpdatePreview() {
  if (!_notesPreviewOn) return;
  const text = document.getElementById('notes-textarea-md').value;
  document.getElementById('notes-preview-md').innerHTML = _notesMarkdownToHtml(text);
}

function _notesMarkdownToHtml(md) {
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Headings
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm,  '<h2>$1</h2>')
    .replace(/^# (.+)$/gm,   '<h1>$1</h1>')
    // Bold / italic / strikethrough
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/~~(.+?)~~/g,     '<del>$1</del>')
    // Inline code
    .replace(/`(.+?)`/g, '<code>$1</code>')
    // Checklist
    .replace(/^- \[x\] (.+)$/gm, '<li><input type="checkbox" checked disabled> $1</li>')
    .replace(/^- \[ \] (.+)$/gm, '<li><input type="checkbox" disabled> $1</li>')
    // Unordered list
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Wrap consecutive <li> in <ul>
    .replace(/(<li>.*<\/li>\n?)+/g, s => `<ul>${s}</ul>`)
    // HR
    .replace(/^---$/gm, '<hr>')
    // Paragraphs
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/^(?!<[a-z])(.+)$/gm, '$1')
    .replace(/^(.+)$/, '<p>$1</p>');
}

Object.assign(window, {
  toggleToolsMenu, closeToolsMenu, openTool, closeTool, toggleCalc,
  notesNewCard, notesDeleteCurrent, notesDeleteCard, notesRender,
  notesOpenEditor, notesCloseEditor, notesAutoSave,
  notesToggleColors, notesSetColor,
  notesMdWrap, notesMdLine, notesTogglePreview, notesUpdatePreview,
});

// ═══════════════════════════════════════════════════════════
// ATALHOS DE TECLADO — Registry & Remap
// ═══════════════════════════════════════════════════════════
const _SHORTCUTS_KEY = 'analyticsys_shortcuts_v1';

// Default shortcut definitions
const _SHORTCUT_DEFAULTS = [
  // Navegação
  { id: 'nav_up',     group: 'Navegação',   desc: 'Aba anterior',          sub: 'Navega para a aba acima na sidebar',      mods: ['Ctrl'], key: 'ArrowUp'   },
  { id: 'nav_down',   group: 'Navegação',   desc: 'Próxima aba',           sub: 'Navega para a aba abaixo na sidebar',     mods: ['Ctrl'], key: 'ArrowDown' },
  // Busca
  { id: 'search',     group: 'Busca',       desc: 'Abrir busca global',    sub: 'Abre o modal de pesquisa rápida',         mods: ['Ctrl'], key: '3'         },
  // Ferramentas
  { id: 'calc',       group: 'Ferramentas', desc: 'Abrir calculadora',     sub: 'Abre/fecha o popover da calculadora',     mods: ['Ctrl'], key: '1'         },
  { id: 'notes',      group: 'Ferramentas', desc: 'Abrir bloco de notas',  sub: 'Abre/fecha o popover de notas',           mods: ['Ctrl'], key: '2'         },
];

// Runtime registry — merged defaults + user overrides
let _shortcuts = [];

function _shortcutsLoad() {
  try {
    const saved = JSON.parse(localStorage.getItem(_SHORTCUTS_KEY) || '{}');
    _shortcuts = _SHORTCUT_DEFAULTS.map(def => ({
      ...def,
      mods: saved[def.id]?.mods ?? def.mods,
      key:  saved[def.id]?.key  ?? def.key,
      modified: !!(saved[def.id]),
    }));
  } catch(e) {
    _shortcuts = _SHORTCUT_DEFAULTS.map(d => ({ ...d, modified: false }));
  }
}

function _shortcutsUpdateUI() {
  // Update topbar search kbd indicator
  const sc = _shortcuts.find(s => s.id === 'search');
  if (sc) {
    const el = document.getElementById('topbar-search-kbd');
    if (el) {
      const parts = [...sc.mods.map(m => m), _shortcutKeyLabel(sc.key)];
      el.textContent = parts.join('+');
    }
  }
}

function _shortcutsSave() {
  const overrides = {};
  _shortcuts.forEach(s => {
    const def = _SHORTCUT_DEFAULTS.find(d => d.id === s.id);
    if (s.key !== def.key || JSON.stringify(s.mods) !== JSON.stringify(def.mods)) {
      overrides[s.id] = { mods: s.mods, key: s.key };
    }
  });
  try { localStorage.setItem(_SHORTCUTS_KEY, JSON.stringify(overrides)); } catch(e) {}
}

// ── Render the shortcuts list ─────────────────────────────
function shortcutsRender() {
  const el = document.getElementById('shortcuts-list');
  if (!el) return;
  if (!_shortcuts.length) _shortcutsLoad();

  const groups = {};
  _shortcuts.forEach(s => {
    if (!groups[s.group]) groups[s.group] = [];
    groups[s.group].push(s);
  });

  el.innerHTML = Object.entries(groups).map(([group, items]) => `
    <div class="shortcuts-group">
      <div class="shortcuts-group-label">${group}</div>
      ${items.map(s => {
        const keysHtml = [
          ...s.mods.map(m => `<span class="shortcut-key">${m}</span>`),
          '<span class="shortcut-key-sep">+</span>',
          `<span class="shortcut-key">${_shortcutKeyLabel(s.key)}</span>`,
        ].join('');
        const modBadge = s.modified ? '<span class="shortcut-modified">modificado</span>' : '';
        return `
          <div class="shortcut-row">
            <div class="shortcut-desc">
              ${escapeHtml(s.desc)}
              <div class="shortcut-desc-sub">${escapeHtml(s.sub)}</div>
            </div>
            <div class="shortcut-keys">${keysHtml} ${modBadge}</div>
            <button class="shortcut-edit-btn" onclick="shortcutStartRemap('${s.id}')">
              <i class="ti ti-pencil"></i> Alterar
            </button>
          </div>`;
      }).join('')}
    </div>`
  ).join('');
}

function _shortcutKeyLabel(key) {
  const map = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', ' ': 'Space' };
  return map[key] || key.toUpperCase();
}

// ── Remap modal ───────────────────────────────────────────
let _remapTargetId   = null;
let _remapPending    = null; // { mods, key }

function shortcutStartRemap(id) {
  const s = _shortcuts.find(x => x.id === id);
  if (!s) return;
  _remapTargetId = id;
  _remapPending  = null;

  document.getElementById('sremap-action-label').textContent = s.desc;
  document.getElementById('sremap-hint').style.display = '';
  document.getElementById('sremap-keys').innerHTML = '';
  document.getElementById('sremap-conflict').style.display = 'none';
  document.getElementById('sremap-save-btn').disabled = true;

  openModal('modal-shortcut-remap');

  // Auto-focus the capture area
  setTimeout(() => {
    const area = document.getElementById('sremap-capture-area');
    if (area) { area.focus(); area.classList.add('listening'); }
  }, 100);
}

// Listen for keydown inside the capture area
document.addEventListener('keydown', e => {
  const area = document.getElementById('sremap-capture-area');
  if (!area || document.activeElement !== area) return;
  if (!document.getElementById('modal-shortcut-remap')?.classList.contains('open')) return;

  // Ignore modifier-only keypresses
  if (['Control','Meta','Shift','Alt'].includes(e.key)) return;
  e.preventDefault();

  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
  if (e.shiftKey) mods.push('Shift');
  if (e.altKey)   mods.push('Alt');

  // Must have at least one modifier
  if (!mods.length) {
    document.getElementById('sremap-hint').style.display = 'none';
    document.getElementById('sremap-keys').innerHTML = `<span class="shortcut-key" style="color:var(--red)">Use ao menos um modificador (Ctrl, Alt)</span>`;
    document.getElementById('sremap-save-btn').disabled = true;
    return;
  }

  _remapPending = { mods, key: e.key };

  // Render the captured keys
  const keysHtml = [
    ...mods.map(m => `<span class="shortcut-key">${m}</span>`),
    '<span class="shortcut-key-sep">+</span>',
    `<span class="shortcut-key">${_shortcutKeyLabel(e.key)}</span>`,
  ].join('');
  document.getElementById('sremap-hint').style.display = 'none';
  document.getElementById('sremap-keys').innerHTML = keysHtml;

  // Check for conflict
  const conflict = _shortcuts.find(s =>
    s.id !== _remapTargetId &&
    s.key === e.key &&
    JSON.stringify(s.mods) === JSON.stringify(mods)
  );

  const conflictEl = document.getElementById('sremap-conflict');
  const conflictMsg = document.getElementById('sremap-conflict-msg');
  if (conflict) {
    conflictEl.style.display = 'flex';
    conflictMsg.textContent = `Conflito com "${conflict.desc}" — salvar irá sobrescrever.`;
  } else {
    conflictEl.style.display = 'none';
  }

  document.getElementById('sremap-save-btn').disabled = false;
});

function shortcutRemapSave() {
  if (!_remapTargetId || !_remapPending) return;

  // Remove conflict if any
  _shortcuts.forEach(s => {
    if (s.id !== _remapTargetId &&
        s.key === _remapPending.key &&
        JSON.stringify(s.mods) === JSON.stringify(_remapPending.mods)) {
      const def = _SHORTCUT_DEFAULTS.find(d => d.id === s.id);
      s.key  = def.key;
      s.mods = def.mods;
      s.modified = false;
    }
  });

  const target = _shortcuts.find(s => s.id === _remapTargetId);
  if (target) {
    target.mods     = _remapPending.mods;
    target.key      = _remapPending.key;
    target.modified = true;
  }

  _shortcutsSave();
  _shortcutsUpdateUI();
  closeModal('modal-shortcut-remap');
  shortcutsRender();
  toast('Atalho atualizado');
}

function shortcutsReset() {
  if (!confirm('Restaurar todos os atalhos para os valores padrão?')) return;
  try { localStorage.removeItem(_SHORTCUTS_KEY); } catch(e) {}
  _shortcutsLoad();
  _shortcutsUpdateUI();
  shortcutsRender();
  toast('Atalhos restaurados');
}

// ── Runtime handler — intercepts global keys using registry ──
function _shortcutMatch(e, s) {
  const ctrl  = e.ctrlKey || e.metaKey;
  const shift = e.shiftKey;
  const alt   = e.altKey;
  const needCtrl  = s.mods.includes('Ctrl');
  const needShift = s.mods.includes('Shift');
  const needAlt   = s.mods.includes('Alt');
  return ctrl === needCtrl && shift === needShift && alt === needAlt &&
         e.key.toUpperCase() === s.key.toUpperCase();
}

function getShortcut(id) {
  if (!_shortcuts.length) _shortcutsLoad();
  return _shortcuts.find(s => s.id === id);
}

// Initialize
_shortcutsLoad();
// Sync UI indicators after DOM ready
document.addEventListener('DOMContentLoaded', _shortcutsUpdateUI);
// Also call directly in case DOM is already ready
setTimeout(_shortcutsUpdateUI, 0);

Object.assign(window, {
  shortcutsRender, shortcutStartRemap, shortcutRemapSave, shortcutsReset, getShortcut, _shortcutMatch
});
