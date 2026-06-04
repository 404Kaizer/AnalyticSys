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
    <button id="${id}-btn" style="background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.28);border-radius:5px;color:#fff;font-size:11.5px;font-weight:600;font-family:var(--font);padding:3px 10px;cursor:pointer;white-space:nowrap;flex-shrink:0;letter-spacing:0.01em">Desfazer</button>
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
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
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
