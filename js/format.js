function fmtDate(v) {
  if (v === '' || v === null || v === undefined) return '—';
  if (typeof v === 'object') return '—'; // objeto de erro XLSX {t:'e', v:n}
  const s = String(v).trim();
  if (/^#/.test(s)) return '—'; // strings de erro Excel

  // ── Número serial XLSX (ex: 46012) ────────────────────────────────────
  if (typeof v === 'number' && v > 0) {
    // Tenta via XLSX.SSF primeiro
    if (window.XLSX?.SSF) {
      const d = XLSX.SSF.parse_date_code(v);
      if (d && d.y > 1900 && d.m >= 1 && d.m <= 12 && d.d >= 1 && d.d <= 31)
        return `${String(d.d).padStart(2,'0')}/${String(d.m).padStart(2,'0')}/${d.y}`;
    }
    // Fallback manual: serial do Excel (dias desde 30/12/1899)
    const epoch = new Date(Date.UTC(1899, 11, 30));
    epoch.setUTCDate(epoch.getUTCDate() + Math.floor(v));
    const dd = String(epoch.getUTCDate()).padStart(2,'0');
    const mm = String(epoch.getUTCMonth()+1).padStart(2,'0');
    const yy = epoch.getUTCFullYear();
    if (yy > 1900) return `${dd}/${mm}/${yy}`;
  }

  // ── ISO: yyyy-mm-dd ────────────────────────────────────────────────────
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;

  // ── Já está em dd/mm/yyyy ──────────────────────────────────────────────
  if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) return s.slice(0, 10);

  // ── Formato americano mm/dd/yyyy (menos comum, mas ocorre em exports) ──
  const usMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (usMatch) {
    // Heurística: se o primeiro número > 12, é dia (dd/mm); senão retorna bruto
    // para não converter incorretamente
    if (Number(usMatch[1]) > 12)
      return `${String(usMatch[1]).padStart(2,'0')}/${String(usMatch[2]).padStart(2,'0')}/${usMatch[3]}`;
  }

  return s || '—';
}

function num(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'object') return 0; // cobre objetos de erro XLSX {t:'e', v:n}
  const s = String(v).trim();
  if (!s || /^#/.test(s)) return 0;
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

// Versão pt-BR para parsing de CSV — trata "1.234,56" corretamente
function numCsv(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'object') return 0;
  const s = String(v).trim();
  if (!s || /^#/.test(s)) return 0;
  const hasDot = s.includes('.'), hasComma = s.includes(',');
  let n = s;
  if (hasComma && hasDot) {
    // "1.234,56" → pt-BR
    n = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    n = s.replace(',', '.');
  }
  const r = parseFloat(n);
  return Number.isFinite(r) ? r : 0;
}

// Conversão de valores numéricos de planilhas Excel exportadas em pt-BR.
// Trata: números puros (já como number), strings com ponto de milhar "1.234",
// formato contábil "1.234,56", prefixo monetário "R$ 1.234,56", e negativos
// com sinal convencional "-1.234,56" — padrão de células de MOEDA do Excel BR.
// NÃO altera num() nem numCsv() para não impactar outros módulos.
function numXls(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'object') return 0;
  let s = String(v).trim();
  if (!s || /^#/.test(s)) return 0;
  // Preserva sinal negativo convencional antes de qualquer tratamento
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1).trim();
  // Remove prefixo monetário e espaços (ex: "R$ ", "R$", "-R$ ")
  s = s.replace(/^R\$\s*/i, '').trim();
  // Formato pt-BR: ponto como separador de milhar, vírgula como decimal
  // Detecta pelo padrão: tem vírgula → vírgula é decimal, pontos são milhar
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    // Sem vírgula: se o último grupo após ponto tem exatamente 3 dígitos
    // → todos os pontos são milhar ("55.000" → "55000", "1.234.567" → "1234567")
    // Caso contrário mantém o ponto como decimal ("0.37" → 0.37)
    const partes = s.split('.');
    if (partes.length > 1 && partes[partes.length - 1].length === 3) {
      s = s.replace(/\./g, '');
    }
  }
  const r = parseFloat(s);
  if (!Number.isFinite(r)) return 0;
  return neg ? -r : r;
}

/**
 * Sanitiza um worksheet XLSX antes do sheet_to_json.
 * Células com erro (type 'e') são substituídas por células vazias,
 * evitando que #VALUE!, #DIV/0!, #N/A, etc. corrompam a importação.
 * Também converte valores de texto que sejam strings de erro Excel.
 */
function sanitizeWorksheet(ws) {
  // BLINDAGEM (28/07): ws podia chegar undefined/null quando a aba
  // detectada em wb.SheetNames não batia com nenhuma chave real de
  // wb.Sheets (já visto num arquivo real de exportação do SAP — provável
  // diferença de encoding/caractere invisível entre os dois). Sem essa
  // proteção, Object.keys(ws) quebrava com "Cannot convert undefined or
  // null to object", um erro nativo confuso, em vez de deixar o chamador
  // mostrar uma mensagem clara ao analista (ver checagem correspondente
  // logo antes da chamada, em dashboard.js).
  if (!ws || typeof ws !== 'object') return ws;
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

// Forma completa (sem abreviação M/K) — usada nos KPIs do Resumo do
// Período, que deliberadamente não abreviam (ver comentário em
// _dgVgRenderKpisHero, dashboard.js).
function signedMoney(v, decimals = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0.0001 ? '+ ' : n < -0.0001 ? '− ' : '';
  return sign + money(Math.abs(n), decimals);
}

// ── Contador de erros de sincronização na sessão atual ──────────────────
// Toda falha de sync com a nuvem no sistema segue o padrão
// toast('⚠ ...sincronizar...', 'error') — mas nem todo toast com ⚠ é sync
// (tem aviso de IndexedDB indisponível, conflito entre abas, recuperação
// de sessão etc.), então o filtro é por "sincroniz" na mensagem, não só
// pelo emoji. Em vez de instrumentar cada um dos ~13 pontos que já
// emitem esse toast, intercepta aqui, no único lugar por onde todos
// passam. É só um contador da ABA ATUAL (reseta ao recarregar a página)
// — não é histórico persistido nem mostra erros de outros usuários/
// dispositivos. Exibido no badge da aba Usuários da Administração (ver
// admin.js, _syncErrorBadgeUpdate).
let _syncErrorCount = 0;

function toast(msg, type = 'success') {
  if (type === 'error' && typeof msg === 'string' && msg.includes('sincroniz')) {
    _syncErrorCount++;
    if (typeof _syncErrorBadgeUpdate === 'function') _syncErrorBadgeUpdate();
  }
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
// requireConsent/consentLabel: quando informado, acrescenta um checkbox
// obrigatório abaixo do corpo — o botão de confirmar só fica habilitado
// depois de marcado. Usado, por exemplo, na exclusão de uma ocorrência de
// Ajuste Sistêmico vinculada a um DAI já emitido (ver ocorrencias.js).
function confirmarDestrutivo({ title = 'Confirmar exclusão', sub = '', body = '', confirmLabel = 'Excluir', requireConsent = false, consentLabel = '', onConfirm }) {
  document.getElementById('mcd-title').textContent         = title;
  document.getElementById('mcd-sub').textContent           = sub;
  document.getElementById('mcd-body').innerHTML            = body;
  document.getElementById('mcd-confirm-label').textContent = confirmLabel;

  const consentEl = document.getElementById('mcd-consent');
  if (consentEl) {
    if (requireConsent) {
      consentEl.style.display = '';
      consentEl.innerHTML = `
        <div class="dai-consent-box">
          <input type="checkbox" id="mcd-consent-check">
          <label for="mcd-consent-check">${consentLabel}</label>
        </div>`;
    } else {
      consentEl.style.display = 'none';
      consentEl.innerHTML = '';
    }
  }

  const btn = document.getElementById('mcd-confirm-btn');
  // Remove previous listener
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.disabled = requireConsent; // só reabilita quando o checkbox for marcado
  if (requireConsent) {
    newBtn.style.opacity = '.5';
    newBtn.style.cursor = 'not-allowed';
    document.getElementById('mcd-consent-check')?.addEventListener('change', (e) => {
      newBtn.disabled = !e.target.checked;
      newBtn.style.opacity = e.target.checked ? '' : '.5';
      newBtn.style.cursor = e.target.checked ? '' : 'not-allowed';
    });
  } else {
    newBtn.style.opacity = '';
    newBtn.style.cursor = '';
  }
  newBtn.addEventListener('click', () => {
    if (newBtn.disabled) return;
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

// ── Loading steps: barra de progresso determinística e lista de etapas ──────
// Usadas por todos os contextos que chamam showLoadingOverlay.

function _lstepSet(id, stepState) {
  const el = document.getElementById('lstep-' + id);
  if (!el) return;
  const stEl = el.querySelector('.lstep-state');
  if (!stEl) return;
  if (stepState === 'running') {
    stEl.className = 'lstep-state lstep-running';
    stEl.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .7s linear infinite"></i>';
    el.classList.add('lstep-active');
  } else if (stepState === 'done') {
    stEl.className = 'lstep-state lstep-done';
    stEl.innerHTML = '<i class="ti ti-circle-check"></i>';
    el.classList.remove('lstep-active');
  } else if (stepState === 'skip') {
    stEl.className = 'lstep-state lstep-skip';
    stEl.innerHTML = '<i class="ti ti-minus"></i>';
    el.classList.remove('lstep-active');
  } else if (stepState === 'error') {
    stEl.className = 'lstep-state lstep-error';
    stEl.innerHTML = '<i class="ti ti-alert-circle"></i>';
    el.classList.remove('lstep-active');
  }
}

function _lbarSet(pct) {
  const fill = document.getElementById('loading-bar-fill');
  if (!fill) return;
  fill.style.animation = 'none';
  fill.style.width = pct + '%';
  fill.style.transform = 'none';
  fill.style.opacity = '1';
  fill.style.transition = 'width .35s ease';
}

/**
 * Exibe ou substitui os steps dinâmicos no loading overlay.
 * steps: [{ id, icon, label }]
 * Reseta todos para estado 'wait'.
 */
function loadingShowSteps(steps) {
  const container = document.getElementById('loading-steps');
  if (!container) return;

  container.innerHTML = steps.map(s => `
    <div class="loading-step" id="lstep-${s.id}">
      <i class="ti ${s.icon} lstep-icon"></i>
      <span class="lstep-label">${s.label}</span>
      <span class="lstep-state lstep-wait"><i class="ti ti-clock"></i></span>
    </div>`).join('');

  container.style.display = '';
  _lbarSet(0);
}

/** Esconde os steps (para loadings simples sem etapas). */
function loadingHideSteps() {
  const container = document.getElementById('loading-steps');
  if (container) { container.style.display = 'none'; container.innerHTML = ''; }
  // Restaura a animação padrão da barra
  const fill = document.getElementById('loading-bar-fill');
  if (fill) {
    fill.style.animation = '';
    fill.style.width = '40%';
    fill.style.transition = '';
  }
}

Object.assign(window, { _lstepSet, _lbarSet, loadingShowSteps, loadingHideSteps });

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
  // Double-defer: rAF agenda o próximo frame, setTimeout(0) garante que o browser pintou.
  // Em abas ocultas: resolve imediatamente — sem rAF (suspenso pelo browser) e sem
  // setTimeout (throttled a 1-60s em background). O yield existe apenas para pintar
  // a tela; se a tela nao esta visivel, nao ha motivo para esperar.
  return new Promise(resolve => {
    if (document.visibilityState === 'hidden') {
      resolve();
    } else {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    }
  });
}

function yieldToUI() {
  // Yield simples para ceder tempo ao browser pintar entre steps pesados.
  // Em abas ocultas resolve imediatamente — setTimeout em background sofre
  // throttling de 1-60s pelo browser, tornando o loading artificialmente lento.
  return new Promise(resolve => {
    if (document.visibilityState === 'hidden') {
      resolve();
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function openModal(id) {
  document.getElementById(id)?.classList.add('open');
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
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
  if (!open) {
    // Posiciona via fixed usando coordenadas reais do botão
    const rect = btn.getBoundingClientRect();
    dd.style.top   = (rect.bottom + 8) + 'px';
    dd.style.right = (window.innerWidth - rect.right) + 'px';
  }
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
  if (name === 'assistente' && typeof _asstLoadHistory === 'function') _asstLoadHistory();
  // _msgsConversaAtiva é declarada em mensagens.js (carrega depois deste
  // arquivo) — segura por só ser lida aqui dentro, em tempo de clique,
  // nunca no carregamento do script.
  if (name === 'mensagens' && typeof msgsAbrirConversa === 'function') {
    msgsAbrirConversa(_msgsConversaAtiva);
    if (typeof _msgsBadgeZerar === 'function') _msgsBadgeZerar();
  }
}

function closeTool(name) {
  const el = document.getElementById('tool-' + name);
  if (!el) return;
  el.style.display = 'none';
  _openTools.delete(name);
}

let _toolZBase = 5000;
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
  // Suporta tanto o ID legado 'calc-popover' quanto o atual 'tool-calc'
  const pop = document.getElementById('tool-calc') || document.getElementById('calc-popover');
  if (!pop || pop.style.display === 'none') return;
  // Don't capture if user is typing in an input inside the calc
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const tab = document.getElementById('calc-tab-basica');
  if (!tab || tab.style.display === 'none') return;

  // Teclado numérico (numpad)
  const numpadMap = {
    'Numpad0':'0','Numpad1':'1','Numpad2':'2','Numpad3':'3','Numpad4':'4',
    'Numpad5':'5','Numpad6':'6','Numpad7':'7','Numpad8':'8','Numpad9':'9',
  };
  if (numpadMap[e.code]) { calcAction('num', numpadMap[e.code]); e.preventDefault(); return; }
  if (e.code === 'NumpadDecimal')   { calcAction('dot');      e.preventDefault(); return; }
  if (e.code === 'NumpadAdd')       { calcAction('op', '+');  e.preventDefault(); return; }
  if (e.code === 'NumpadSubtract')  { calcAction('op', '-');  e.preventDefault(); return; }
  if (e.code === 'NumpadMultiply')  { calcAction('op', '*');  e.preventDefault(); return; }
  if (e.code === 'NumpadDivide')    { calcAction('op', '/');  e.preventDefault(); return; }
  if (e.code === 'NumpadEnter')     { calcAction('eq');       e.preventDefault(); return; }

  // Teclado alfanumérico
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

// ── Sync com Supabase (pessoal — tabela bloco_notas, RLS por user_id) ────
// localStorage continua sendo a gravação PRINCIPAL (síncrona, nunca falha
// por rede) — isto aqui é só a camada de nuvem por cima, mesmo padrão de
// Ações de Relatório: se a rede falhar, a nota já está salva localmente e
// o próximo boot tenta sincronizar de novo.
function _notesToDbRow(card) {
  return {
    id:            card.id,
    user_id:       window.currentUser?.id,
    title:         card.title || null,
    body:          card.body || null,
    color:         card.color || 'none',
    priority:      card.priority || 'none',
    criado_em:     card.created ?? null,
    modificado_em: card.modified ?? null,
  };
}

function _notesFromDbRow(row) {
  return {
    id:       row.id,
    title:    row.title || '',
    body:     row.body || '',
    color:    row.color || 'none',
    priority: row.priority || 'none',
    created:  row.criado_em ?? Date.now(),
    modified: row.modificado_em ?? Date.now(),
  };
}

// Upsert de uma nota — chamado a cada gravação local (criar, debounce de
// edição, trocar cor). upsert por id é idempotente, então chamadas
// repetidas (ex.: usuário digitando) nunca duplicam linha na nuvem.
function _notesSyncUpsert(card) {
  if (!window.supabaseClient || !card || !window.currentUser?.id) return;
  window.supabaseClient.from('bloco_notas').upsert(_notesToDbRow(card))
    .then(({ error }) => {
      if (error) {
        console.warn('[Supabase] Falha ao sincronizar nota:', error);
        toast('⚠ Nota salva neste dispositivo, mas não foi possível sincronizar com a nuvem.', 'error');
      }
    });
}

const NOTES_SYNC_BATCH_SIZE = 200;
async function _notesSyncUpsertBatch(cards) {
  if (!window.supabaseClient || !cards || !cards.length) return;
  const rows = cards.map(_notesToDbRow);
  for (let i = 0; i < rows.length; i += NOTES_SYNC_BATCH_SIZE) {
    const { error } = await window.supabaseClient.from('bloco_notas').upsert(rows.slice(i, i + NOTES_SYNC_BATCH_SIZE));
    if (error) { console.warn('[Supabase] Falha ao sincronizar lote de notas:', error); break; }
  }
}

function _notesSyncDelete(id) {
  if (!window.supabaseClient || !id) return;
  window.supabaseClient.from('bloco_notas').delete().eq('id', id)
    .then(({ error }) => { if (error) console.warn('[Supabase] Falha ao excluir nota na nuvem:', error); });
}

// Busca no boot (ver SUPABASE_BOOT_SYNCS em dashboard.js). Mescla por id
// (nuvem tem prioridade em conflito) e sobe qualquer nota local que ainda
// não exista na nuvem. Isso cobre dois casos com o MESMO código: a
// sincronização contínua normal E a migração das notas que já existiam no
// localStorage antes desta atualização — na primeira vez que roda pra um
// usuário, a nuvem está vazia, então TUDO que está local sobe aqui, sem
// nenhum passo manual. Lê o localStorage diretamente (não chama
// _notesLoad) porque o painel de Notas pode nunca ter sido aberto nesta
// sessão — _notesCards só é populado ao abrir o popover (ver openTool).
async function syncNotesFromSupabase() {
  if (!window.supabaseClient || !window.currentUser?.id) return;
  try {
    let local;
    try {
      const raw = localStorage.getItem(_NOTES_KEY);
      local = raw ? JSON.parse(raw) : [];
    } catch (e) { local = []; }

    // A policy de SELECT libera admin pra ver notas de todo mundo (mesmo
    // padrão de RLS do resto do sistema — ver ocorrencias, onde isso é
    // proposital). Aqui NÃO é: Bloco de Notas é estritamente pessoal (
    // decisão do usuário), então filtramos por user_id no cliente mesmo
    // que a RLS deixe passar mais linhas — evita que um admin acabe
    // enxergando/misturando notas de outros usuários no seu próprio painel.
    const meuId = window.currentUser.id;
    const data = await fetchAllRows('bloco_notas');
    const remoto = (data || []).filter(r => r.user_id === meuId).map(_notesFromDbRow);
    const idsRemotos = new Set(remoto.map(n => n.id));

    const porId = new Map(local.filter(n => n && n.id).map(n => [n.id, n]));
    remoto.forEach(n => porId.set(n.id, n));
    _notesCards = [...porId.values()];
    _notesPersist();

    const naoSincronizadas = local.filter(n => n && n.id && !idsRemotos.has(n.id));
    if (naoSincronizadas.length) await _notesSyncUpsertBatch(naoSincronizadas);

    notesRender();
  } catch (err) {
    console.warn('[Supabase] Falha ao buscar notas — mantendo dados locais.', err);
  }
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
  _notesSyncUpsert(card);
  notesRender();
  notesOpenEditor(card.id);
}

function notesDeleteCurrent() {
  if (!_notesActive) return;
  if (!confirm('Excluir esta nota?')) return;
  const id = _notesActive;
  _notesCards = _notesCards.filter(c => c.id !== id);
  _notesPersist();
  _notesSyncDelete(id);
  notesCloseEditor();
  notesRender();
}

function notesDeleteCard(id, e) {
  e.stopPropagation();
  if (!confirm('Excluir esta nota?')) return;
  _notesCards = _notesCards.filter(c => c.id !== id);
  if (_notesActive === id) notesCloseEditor();
  _notesPersist();
  _notesSyncDelete(id);
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

  document.getElementById('notes-title-input').value      = card.title;
  document.getElementById('notes-priority-select').value  = card.priority;
  _notesSetColorDot(card.color);

  const editor = document.getElementById('notes-inline-editor');
  if (editor) {
    editor.innerHTML = card.body || '';
    setTimeout(() => { editor.focus(); notesUpdateToolbarState(); }, 0);
  }

  const listPane   = document.getElementById('notes-list-pane');
  const editorPane = document.getElementById('notes-editor-pane');
  if (listPane)   listPane.style.display   = 'none';
  if (editorPane) editorPane.style.display = 'flex';

  notesRender();
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
  const editor  = document.getElementById('notes-inline-editor');
  if (editor) {
    editor.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      if (cb.checked) cb.setAttribute('checked', '');
      else            cb.removeAttribute('checked');
    });
    card.body = editor.innerHTML;
  }
  card.priority = document.getElementById('notes-priority-select').value;
  card.modified = Date.now();
  clearTimeout(_notesSaveTimer);
  _notesSaveTimer = setTimeout(() => { _notesPersist(); _notesSyncUpsert(card); notesRender(); }, 700);
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
  _notesSyncUpsert(card);
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


// ── Toolbar inline ────────────────────────────────────────
function notesExec(cmd, val) {
  document.getElementById('notes-inline-editor')?.focus();
  document.execCommand(cmd, false, val || null);
  notesUpdateToolbarState();
  notesEditorUpdate();
}

function notesSetFontSize(val) {
  if (!val) return;
  document.getElementById('notes-inline-editor')?.focus();
  document.execCommand('fontSize', false, val);
  notesUpdateToolbarState();
  notesEditorUpdate();
}

function notesEditorUpdate() {
  if (!_notesActive) return;
  const card = _notesCards.find(c => c.id === _notesActive);
  if (!card) return;
  card.title    = document.getElementById('notes-title-input').value;
  const editor  = document.getElementById('notes-inline-editor');
  if (editor) {
    editor.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      if (cb.checked) cb.setAttribute('checked', '');
      else            cb.removeAttribute('checked');
    });
    card.body = editor.innerHTML;
  }
  card.priority = document.getElementById('notes-priority-select').value;
  card.modified = Date.now();
  clearTimeout(_notesSaveTimer);
  _notesSaveTimer = setTimeout(() => {
    _notesPersist();
    _notesSyncUpsert(card);
    notesRender();
    const ind = document.getElementById('notes-saved-indicator');
    if (ind) { ind.classList.add('show'); setTimeout(() => ind.classList.remove('show'), 1500); }
  }, 700);
}

function notesUpdateToolbarState() {
  const cmds = ['bold', 'italic', 'underline', 'strikeThrough'];
  const ids  = ['notes-tb-bold', 'notes-tb-italic', 'notes-tb-under', 'notes-tb-strike'];
  cmds.forEach((cmd, i) => {
    const btn = document.getElementById(ids[i]);
    if (btn) btn.classList.toggle('active', document.queryCommandState(cmd));
  });
  const color = document.queryCommandValue('foreColor');
  const ci = document.getElementById('notes-color-input');
  if (ci && color && color !== 'false') {
    const hex = _notesRgbToHex(color);
    if (hex) ci.value = hex;
  }
}

function _notesRgbToHex(color) {
  if (!color || color === 'false') return null;
  if (color.startsWith('#')) return color;
  const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) return null;
  return '#' + [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, '0')).join('');
}

function notesInsertChecklist() {
  const editor = document.getElementById('notes-inline-editor');
  if (!editor) return;
  editor.focus();
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.style.accentColor = 'var(--accent)';
  cb.style.marginRight = '6px';
  cb.style.cursor = 'pointer';
  cb.addEventListener('change', () => {
    if (cb.checked) cb.setAttribute('checked', '');
    else            cb.removeAttribute('checked');
    notesEditorUpdate();
  });
  const span = document.createElement('span');
  span.textContent = '\u00A0';
  span.contentEditable = 'true';
  const li = document.createElement('li');
  li.style.listStyle = 'none';
  li.style.display = 'flex';
  li.style.alignItems = 'baseline';
  li.style.gap = '2px';
  li.appendChild(cb);
  li.appendChild(span);
  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    const range = sel.getRangeAt(0);
    range.collapse(false);
    range.insertNode(li);
    const newRange = document.createRange();
    newRange.setStart(span, 0);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
  } else {
    editor.appendChild(li);
  }
  notesEditorUpdate();
}

Object.assign(window, {
  toggleToolsMenu, closeToolsMenu, openTool, closeTool, toggleCalc,
  notesNewCard, notesDeleteCurrent, notesDeleteCard, notesRender,
  notesOpenEditor, notesCloseEditor, notesAutoSave,
  notesToggleColors, notesSetColor,
  notesExec, notesSetFontSize, notesEditorUpdate, notesUpdateToolbarState,
  notesInsertChecklist,
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
  { id: 'novo_reg',   group: 'Ferramentas', desc: 'Novo Registro Manual',  sub: 'Abre o modal de novo registro manual',    mods: ['Ctrl'], key: '4'         },
  { id: 'nova_oc',    group: 'Ferramentas', desc: 'Nova Ocorrência',        sub: 'Abre o modal de nova ocorrência',         mods: ['Ctrl'], key: '5'         },
  { id: 'mensagens',  group: 'Ferramentas', desc: 'Abrir mensagens',        sub: 'Abre/fecha o popover de mensagens',       mods: ['Ctrl'], key: '6'         },
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

// ═══════════════════════════════════════════════════════════
// MODAL DE FECHAMENTO
// ═══════════════════════════════════════════════════════════
let _fechTipo = 'semanal';

// ── Date helpers ─────────────────────────────────────────
function _fechLastWeekday(date) {
  const d = new Date(date);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d;
}

function _fechLastWorkdayOfMonth(year, month) {
  const last = new Date(year, month + 1, 0);
  return _fechLastWeekday(last);
}

function _fechFmtDate(d) {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function _fechNomeMes(d) {
  return d.toLocaleDateString('pt-BR', { month: 'long' }).toUpperCase();
}

function _fechNomeMesTitulo(d) {
  const m = d.toLocaleDateString('pt-BR', { month: 'long' });
  return m.charAt(0).toUpperCase() + m.slice(1);
}

// ── Ícones próprios (SVG inline) por categoria de fechamento ──
const _FECH_ICON_CALENDAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"/></svg>';
const _FECH_ICON_BOX = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="m3.27 6.96 8.73 5.04 8.73-5.04M12 22.08V12"/></svg>';
const _FECH_ICON_TARGET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>';
const _FECH_ICON_ALERT = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>';

// ── Config visual fixa por tipo (não editável pelo analista) ──
const _fechConfig = {
  semanal: { badgeIcon: _FECH_ICON_CALENDAR, priority: 'Rotina obrigatória' },
  mensal:  { badgeIcon: _FECH_ICON_BOX,      priority: 'Prioridade máxima' },
  metas:   { badgeIcon: _FECH_ICON_TARGET,   priority: 'Acompanhamento mensal' },
};

// ── Campos padrão por tipo — recalculados com a data atual a cada chamada ──
function _fechDefaultFields(tipo) {
  const now       = new Date();
  const today     = _fechFmtDate(now);
  const mes       = _fechNomeMes(now);
  const mesTit    = _fechNomeMesTitulo(now);
  const ano       = now.getFullYear();
  const lastDay   = _fechLastWorkdayOfMonth(now.getFullYear(), now.getMonth());
  const lastDayFmt = _fechFmtDate(lastDay);

  if (tipo === 'semanal') {
    return {
      badge: 'Medição Semanal',
      title: 'Lançamento de Estoque',
      meta: `Hoje · ${today} · Após o fim da produção`,
      intro: `Hoje, ${today}, é dia de lançar o estoque semanal após a produção!`,
      listlabel: 'VERIFIQUEM TODOS OS MATERIAIS:',
      items: ['Agregados (areia, brita, etc...)', 'Aditivos', 'Adições', 'Aglomerantes'],
      alerts: [
        'Não lance o que não viu. Tenha certeza!',
        'Caso não tenha o material, lance ZERADO (0).'
      ],
    };
  }

  if (tipo === 'mensal') {
    return {
      badge: 'Inventário Mensal',
      title: 'Fechamento Obrigatório',
      meta: `${mesTit}/${ano} · Corte ${lastDayFmt} · Fim da produção`,
      intro: `Hoje, ${today}, ao fim da produção, aferir todos os materiais e lançar as quantidades na PUZL para o fechamento do inventário mensal de ${mes}!`,
      listlabel: 'O QUE DEVE SER FEITO:',
      items: [
        'Conferir visualmente TODOS os materiais da usina',
        'Lançar os estoques na PUZL na data de hoje',
        'Materiais parados ou aguardando coleta também devem ser lançados'
      ],
      alerts: [
        'O inventário mensal é obrigatório e indispensável!',
        'Qualquer problema, avisem com antecedência.'
      ],
    };
  }

  if (tipo === 'metas') {
    return {
      badge: 'Metas do Mês',
      title: 'Obrigações de Fechamento',
      meta: `${mesTit}/${ano} · Corte ${lastDayFmt}`,
      intro: `Atenção às metas de fechamento de ${mesTit}/${ano} — todas devem estar cumpridas até a data de corte.`,
      listlabel: 'METAS DO PERÍODO:',
      items: [
        'Estoques de agregados no mínimo, respeitando o limite de segurança.',
        'Notas fiscais — validar 100% e corrigir pendências.',
        `Conferência — ${lastDayFmt}, no final da produção.`
      ],
      alerts: ['Não deixar conferência ou lançamento pendente!'],
    };
  }

  return null;
}

// ── Estado em memória (um objeto de campos por tipo) ──────────
let _fechState = { semanal: null, mensal: null, metas: null };

// ── Persistência (localStorage — mesmo padrão já usado no projeto) ──
const _FECH_KEY = 'analyticsys_fech_v2';
let _fechSaveTimer = null;

function _fechLoadAllSaved() {
  try { return JSON.parse(localStorage.getItem(_FECH_KEY) || '{}'); }
  catch (e) { return {}; }
}

function _fechSaveCurrent() {
  clearTimeout(_fechSaveTimer);
  _fechSaveTimer = setTimeout(() => {
    try {
      const saved = _fechLoadAllSaved();
      saved[_fechTipo] = _fechState[_fechTipo];
      localStorage.setItem(_FECH_KEY, JSON.stringify(saved));
      const ind = document.getElementById('fech-saved-indicator');
      if (ind) { ind.style.opacity = '1'; setTimeout(() => ind.style.opacity = '0', 1500); }
    } catch (e) {}
  }, 500);
}

// Retorna os campos do tipo, hidratando do localStorage na primeira vez.
// Campos salvos sobrescrevem os defaults campo a campo — se o analista nunca
// editou um tipo, ele recebe os defaults computados com a data atual.
function _fechGetFields(tipo) {
  if (_fechState[tipo]) return _fechState[tipo];
  const saved      = _fechLoadAllSaved();
  const persisted   = saved[tipo];
  const defaults    = _fechDefaultFields(tipo);
  const fields = persisted && typeof persisted === 'object'
    ? { ...defaults, ...persisted, items: Array.isArray(persisted.items) ? persisted.items : defaults.items, alerts: Array.isArray(persisted.alerts) ? persisted.alerts : defaults.alerts }
    : defaults;
  _fechState[tipo] = fields;
  return fields;
}

// ── Abrir modal ─────────────────────────────────────────────
function abrirFechamento(tipo) {
  closeToolsMenu();
  requestAnimationFrame(() => {
    openModal('modal-fechamento');
    fechamentoSwitchTipo(tipo || 'semanal');
  });
}

// ── Trocar de aba ───────────────────────────────────────────
function fechamentoSwitchTipo(tipo) {
  _fechTipo = tipo;

  document.querySelectorAll('.fech-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tipo === tipo)
  );

  const card = document.getElementById('fech-card');
  if (card) card.className = 'fech-card fech-theme-' + tipo;

  _fechLoadFormFromState();
  fechRenderFromForm(true); // true = não reagenda salvamento ao só trocar de aba
}

// ── Popula os inputs do formulário a partir do estado ────────
function _fechLoadFormFromState() {
  const f = _fechGetFields(_fechTipo);
  const elTitle = document.getElementById('fech-f-title');
  const elMeta  = document.getElementById('fech-f-meta');
  const elIntro = document.getElementById('fech-f-intro');
  const elList  = document.getElementById('fech-f-listlabel');
  if (elTitle) elTitle.value = f.title;
  if (elMeta)  elMeta.value  = f.meta;
  if (elIntro) elIntro.value = f.intro;
  if (elList)  elList.value  = f.listlabel;
  _fechRenderItemInputs();
  _fechRenderAlertInputs();
}

function _fechRenderItemInputs() {
  const wrap = document.getElementById('fech-f-items');
  if (!wrap) return;
  wrap.innerHTML = '';
  const items = _fechState[_fechTipo].items;
  items.forEach((item, i) => {
    const row = document.createElement('div');
    row.className = 'fech-list-row';
    row.innerHTML = `
      <input type="text" value="${escapeHtml(item)}" oninput="fechUpdateItem(${i}, this.value)">
      <button class="fech-icon-btn" onclick="fechRemoveItem(${i})" title="Remover item"><i class="ti ti-trash"></i></button>`;
    wrap.appendChild(row);
  });
}

function _fechRenderAlertInputs() {
  const wrap = document.getElementById('fech-f-alerts');
  if (!wrap) return;
  wrap.innerHTML = '';
  const alerts = _fechState[_fechTipo].alerts;
  alerts.forEach((al, i) => {
    const row = document.createElement('div');
    row.className = 'fech-list-row is-textarea';
    row.innerHTML = `
      <textarea oninput="fechUpdateAlert(${i}, this.value)">${escapeHtml(al)}</textarea>
      <button class="fech-icon-btn" onclick="fechRemoveAlert(${i})" title="Remover alerta"><i class="ti ti-trash"></i></button>`;
    wrap.appendChild(row);
  });
}

// ── Itens: editar / remover / adicionar ───────────────────────
function fechUpdateItem(i, val) {
  _fechState[_fechTipo].items[i] = val;
  fechRenderFromForm();
}
function fechRemoveItem(i) {
  _fechState[_fechTipo].items.splice(i, 1);
  _fechRenderItemInputs();
  fechRenderFromForm();
}
function fechAddItem() {
  _fechState[_fechTipo].items.push('Novo item');
  _fechRenderItemInputs();
  fechRenderFromForm();
}

// ── Alertas: editar / remover / adicionar ─────────────────────
function fechUpdateAlert(i, val) {
  _fechState[_fechTipo].alerts[i] = val;
  fechRenderFromForm();
}
function fechRemoveAlert(i) {
  _fechState[_fechTipo].alerts.splice(i, 1);
  _fechRenderAlertInputs();
  fechRenderFromForm();
}
function fechAddAlert() {
  _fechState[_fechTipo].alerts.push('Novo alerta importante.');
  _fechRenderAlertInputs();
  fechRenderFromForm();
}

// ── Restaurar texto padrão ─────────────────────────────────────
function fechamentoResetarTexto() {
  if (!confirm('Restaurar o texto padrão? As alterações salvas deste tipo serão perdidas.')) return;
  _fechState[_fechTipo] = _fechDefaultFields(_fechTipo);
  try {
    const saved = _fechLoadAllSaved();
    delete saved[_fechTipo];
    localStorage.setItem(_FECH_KEY, JSON.stringify(saved));
  } catch (e) {}
  _fechLoadFormFromState();
  fechRenderFromForm(true);
  toast('Texto restaurado para o padrão.');
}

// ── Lê os inputs simples, atualiza estado, repinta o card e agenda salvamento ──
function fechRenderFromForm(skipSave) {
  const f = _fechState[_fechTipo];
  const elTitle = document.getElementById('fech-f-title');
  const elMeta  = document.getElementById('fech-f-meta');
  const elIntro = document.getElementById('fech-f-intro');
  const elList  = document.getElementById('fech-f-listlabel');
  if (elTitle) f.title     = elTitle.value;
  if (elMeta)  f.meta      = elMeta.value;
  if (elIntro) f.intro     = elIntro.value;
  if (elList)  f.listlabel = elList.value;

  _fechRenderCard();
  if (!skipSave) _fechSaveCurrent();
}

// ── Repinta o card de preview ao vivo com os campos atuais ────
function _fechRenderCard() {
  const tipo = _fechTipo;
  const f    = _fechState[tipo];
  const cfg  = _fechConfig[tipo];
  const now  = new Date();

  const elBadge = document.getElementById('fech-c-badge');
  if (elBadge) elBadge.innerHTML = `<span class="fech-card-badge-icon">${cfg.badgeIcon}</span><span>${escapeHtml(f.badge)}</span>`;

  const elTitle = document.getElementById('fech-c-title');
  if (elTitle) elTitle.textContent = f.title;

  const elMeta = document.getElementById('fech-c-meta');
  if (elMeta) elMeta.textContent = f.meta;

  const elIntro = document.getElementById('fech-c-intro');
  if (elIntro) {
    elIntro.textContent = f.intro;
    elIntro.style.display = f.intro.trim() ? 'block' : 'none';
  }

  const elList = document.getElementById('fech-c-listlabel');
  if (elList) elList.textContent = f.listlabel;

  const elPriority = document.getElementById('fech-c-priority-text');
  if (elPriority) elPriority.textContent = cfg.priority;

  const elDate = document.getElementById('fech-c-date');
  if (elDate) elDate.textContent = _fechFmtDate(now);

  const elItems = document.getElementById('fech-c-items');
  if (elItems) {
    const itemsHtml = f.items.filter(i => i.trim()).map((item, i) =>
      `<div class="bullet"><span class="dot">${String(i + 1).padStart(2, '0')}</span><span>${escapeHtml(item)}</span></div>`
    ).join('');
    elItems.innerHTML = `<div class="fech-items-list">${itemsHtml}</div>`;
  }

  const elAlerts = document.getElementById('fech-c-alerts');
  if (elAlerts) {
    const alertsHtml = f.alerts.filter(a => a.trim()).map(al => `
      <div class="stop-box">
        ${_FECH_ICON_ALERT}
        <span>${escapeHtml(al)}</span>
      </div>`).join('');
    elAlerts.innerHTML = `<div class="fech-alerts-list">${alertsHtml}</div>`;
  }
}

// ── Reconstrói texto plano a partir dos campos (WhatsApp / imagem) ──
function _fechGetPlainText() {
  const f = _fechState[_fechTipo];
  if (!f) return '';
  const parts = [];
  if (f.intro.trim()) parts.push(f.intro.trim());
  const items = f.items.filter(i => i.trim());
  if (items.length) {
    parts.push((f.listlabel || '').trim());
    items.forEach(i => parts.push('• ' + i.trim()));
  }
  const alerts = f.alerts.filter(a => a.trim());
  alerts.forEach(a => parts.push('⚠️ ' + a.trim()));
  return parts.join('\n\n');
}

// ── Copiar para WhatsApp ──────────────────────────────────
function fechamentoCopiarWhatsapp() {
  const text = _fechGetPlainText();
  if (!text) return;
  navigator.clipboard?.writeText(text).then(() => {
    toast('Texto copiado! Cole direto no WhatsApp.');
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    toast('Texto copiado!');
  });
}

// ── Gerar imagem PNG ──────────────────────────────────────
function fechamentoGerarImagem() {
  const text = _fechGetPlainText();
  if (!text.trim()) { toast('Nenhum texto para gerar imagem', 'error'); return; }
  const cfg = _fechConfig[_fechTipo];
  _fechGerarImagemCanvas(text, cfg);
}

// Canvas-based corporate image generation
function _fechGerarImagemCanvas(text, cfg) {
  const S = 2; // retina scale
  const W = 540;
  const PADX = 40;
  const bodyFont = 14;
  const bodyLineH = 22;

  // ── Wrap text ────────────────────────────────────────────
  const tmp = document.createElement('canvas').getContext('2d');
  const wrapText = (txt, maxW, font) => {
    tmp.font = font;
    const lines = [];
    txt.split('\n').forEach(raw => {
      if (!raw.trim()) { lines.push({ text: '', empty: true }); return; }
      // detect bullet / emoji prefix
      const isPt = raw.startsWith('*') || raw.startsWith('•') || raw.startsWith('👉') || raw.startsWith('✅') || raw.startsWith('🛑') || raw.startsWith('❗') || raw.startsWith('❌') || raw.startsWith('📦') || raw.startsWith('📋') || raw.startsWith('📅') || raw.startsWith('🖥️');
      const words = raw.split(' ');
      let cur = '';
      let first = true;
      words.forEach(w => {
        const test = cur ? cur + ' ' + w : w;
        if (tmp.measureText(test).width <= maxW) { cur = test; }
        else {
          if (cur) lines.push({ text: cur, indent: !first && isPt });
          cur = w; first = false;
        }
      });
      if (cur) lines.push({ text: cur, indent: !first && isPt });
    });
    return lines;
  };

  // ── Theme per tipo ───────────────────────────────────────
  const themes = {
    semanal: {
      bg1: '#0b1929', bg2: '#112240',
      accent: '#2563eb', accentLight: '#3b82f6',
      accentGlow: 'rgba(59,130,246,0.18)',
      stripe: '#1e3a5f',
      badgeText: 'MEDIÇÃO SEMANAL',
      badgeBg: '#1d4ed8', badgeFg: '#ffffff',
      bodyFg: '#cbd5e1',
      footerFg: '#64748b',
      titleFg: '#ffffff',
    },
    mensal: {
      bg1: '#1a0a0a', bg2: '#2d1515',
      accent: '#dc2626', accentLight: '#ef4444',
      accentGlow: 'rgba(239,68,68,0.18)',
      stripe: '#4a1515',
      badgeText: 'INVENTÁRIO MENSAL',
      badgeBg: '#b91c1c', badgeFg: '#ffffff',
      bodyFg: '#fecaca',
      footerFg: '#7f1d1d',
      titleFg: '#ffffff',
    },
    metas: {
      bg1: '#170f1e', bg2: '#241733',
      accent: '#7c3aed', accentLight: '#8b5cf6',
      accentGlow: 'rgba(139,92,246,0.18)',
      stripe: '#3a2a52',
      badgeText: 'METAS DO FECHAMENTO',
      badgeBg: '#6d28d9', badgeFg: '#ffffff',
      bodyFg: '#d9d2e8',
      footerFg: '#4c2f73',
      titleFg: '#ffffff',
    },
  };
  const T = themes[_fechTipo] || themes.semanal;

  // ── Measure body ─────────────────────────────────────────
  const bodyMaxW = W - PADX * 2;
  const bodyLines = wrapText(text, bodyMaxW, `${bodyFont}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`);
  const bodyH = bodyLines.reduce((s, l) => s + (l.empty ? bodyLineH * 0.6 : bodyLineH), 0);

  const HEADER_H = 148; // logo area
  const BADGE_H  = 52;
  const SEP_H    = 24;
  const FOOTER_H = 52;
  const H = HEADER_H + BADGE_H + SEP_H + bodyH + SEP_H + FOOTER_H + 20;

  const cv = document.createElement('canvas');
  cv.width = W * S; cv.height = H * S;
  const ctx = cv.getContext('2d');
  ctx.scale(S, S);

  // ── Background ───────────────────────────────────────────
  // Solid dark bg
  ctx.fillStyle = T.bg1;
  ctx.fillRect(0, 0, W, H);

  // Subtle top panel for logo area
  ctx.fillStyle = T.bg2;
  ctx.fillRect(0, 0, W, HEADER_H);

  // Decorative geometric stripe left side
  ctx.fillStyle = T.accent;
  ctx.fillRect(0, 0, 5, H);

  // Diagonal accent corner (top-right)
  ctx.fillStyle = T.accentGlow;
  ctx.beginPath();
  ctx.moveTo(W - 120, 0);
  ctx.lineTo(W, 0);
  ctx.lineTo(W, 120);
  ctx.closePath();
  ctx.fill();

  // ── Logo image (async, draw rest first, stamp logo after) ──
  const drawRest = (logoImg) => {
    // Logo area
    let y = 26;
    if (logoImg) {
      // Render logo at fixed height, preserve aspect ratio
      const lH = 56;
      const aspect = logoImg.naturalWidth / logoImg.naturalHeight || 3;
      const lW = Math.round(lH * aspect);
      const lX = (W - lW) / 2;
      // White rectangle behind logo so SVG dark parts are visible on dark bg
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      _fechRoundRect(ctx, lX - 16, y - 6, lW + 32, lH + 12, 10);
      ctx.fill();
      // Draw logo at full opacity
      ctx.drawImage(logoImg, lX, y, lW, lH);
      y += lH + 22;
    } else {
      // Logo not available — leave space for branding area only
      y += 20;
    }

    // Horizontal rule under logo
    ctx.strokeStyle = T.accentLight;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PADX, y); ctx.lineTo(W - PADX, y); ctx.stroke();
    y += 16;

    // ── Badge / title block ──────────────────────────────────
    const badgePadX = 20, badgePadY = 9;
    const badgeFont = `700 15px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
    ctx.font = badgeFont;
    const badgeW = ctx.measureText(T.badgeText).width + badgePadX * 2;
    const badgeH2 = 34;
    const badgeX = (W - badgeW) / 2;
    // Badge pill
    ctx.fillStyle = T.badgeBg;
    _fechRoundRect(ctx, badgeX, y, badgeW, badgeH2, badgeH2 / 2);
    ctx.fill();
    ctx.fillStyle = T.badgeFg;
    ctx.textAlign = 'center';
    ctx.fillText(T.badgeText, W / 2, y + badgeH2 / 2 + 5);
    y += badgeH2 + SEP_H;

    // Separator
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.moveTo(PADX, y); ctx.lineTo(W - PADX, y); ctx.stroke();
    ctx.setLineDash([]);
    y += 18;

    // ── Body text ────────────────────────────────────────────
    ctx.textAlign = 'left';
    bodyLines.forEach(line => {
      if (line.empty) { y += bodyLineH * 0.6; return; }
      // First char emphasis (emoji / bullet)
      const txt = line.text;
      const firstChar = txt.charAt(0);
      const isEmoji = firstChar > 'ÿ';
      if (isEmoji) {
        ctx.font = `${bodyFont + 1}px -apple-system, sans-serif`;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(firstChar, PADX + (line.indent ? 14 : 0), y);
        const emojiW = ctx.measureText(firstChar).width + 6;
        ctx.font = `400 ${bodyFont}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
        ctx.fillStyle = T.bodyFg;
        ctx.fillText(txt.slice(firstChar.length), PADX + emojiW + (line.indent ? 14 : 0), y);
      } else if (txt.startsWith('*') || txt.startsWith('•')) {
        // Bullet
        ctx.fillStyle = T.accentLight;
        ctx.fillRect(PADX + (line.indent ? 14 : 0), y - 5, 4, 4);
        ctx.font = `400 ${bodyFont}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
        ctx.fillStyle = T.bodyFg;
        ctx.fillText(txt.replace(/^[•*]\s*/, ''), PADX + 12 + (line.indent ? 14 : 0), y);
      } else {
        // Check for bold-ish ALL CAPS lines (≥4 words all caps = heading)
        const words = txt.split(' ');
        const allCaps = words.length >= 3 && words.every(w => w === w.toUpperCase() && /[A-Z]/.test(w));
        if (allCaps) {
          ctx.font = `700 ${bodyFont}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
          ctx.fillStyle = '#ffffff';
        } else {
          ctx.font = `400 ${bodyFont}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
          ctx.fillStyle = T.bodyFg;
        }
        ctx.fillText(txt, PADX + (line.indent ? 14 : 0), y);
      }
      y += bodyLineH;
    });

    // ── Footer ───────────────────────────────────────────────
    y += 14;
    // Thick accent bar
    ctx.fillStyle = T.accent;
    ctx.fillRect(PADX, y, W - PADX * 2, 3);
    y += 12;

    ctx.fillStyle = T.footerFg;
    ctx.font = `500 11px -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('ESTOQUE  /  INSUMOS  —  CONCRELAGOS CONCRETO', W / 2, y + 14);

    // Watermark date
    const now = new Date();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.font = `400 10px monospace`;
    ctx.textAlign = 'right';
    ctx.fillText(_fechFmtDate(now), W - PADX, y + 14);

    // ── Download ─────────────────────────────────────────────
    const link = document.createElement('a');
    link.download = `fechamento-${_fechTipo}-${new Date().toISOString().slice(0,10)}.png`;
    link.href = cv.toDataURL('image/png');
    link.click();
    if (!logoImg) toast('Imagem gerada! (sem logo — verifique conexão)');
    else toast('Imagem corporativa gerada!');
  };

  // Draw immediately without logo, then overlay logo async if possible
  drawRest(null);

  // Try to load logo and re-draw on top
  const logoUrl = 'https://concrelagos.com.br/wp-content/uploads/2021/10/Ativo-3.svg';
  const logoImg2 = new Image();
  logoImg2.crossOrigin = 'anonymous';
  logoImg2.onload = () => {
    if (logoImg2.naturalWidth > 0) {
      // Redraw with logo
      drawRest(logoImg2);
    }
  };
  logoImg2.src = logoUrl + '?t=' + Date.now(); // bust cache
}

// Helper: rounded rect path
function _fechRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Abrir janela de print ────────────────────────────────
function fechamentoAbrirPrint() {
  const f = _fechState[_fechTipo];
  if (!f) return;
  const cfg = _fechConfig[_fechTipo];

  const themes = {
    semanal: {
      bg: '#0d141f', headGrad: 'linear-gradient(180deg, #16223a 0%, #0d141f 100%)',
      stripe: '#2563eb', badgeGrad: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
      metaFg: '#93c5fd', metaBg: 'rgba(37,99,235,0.16)', metaBorder: 'rgba(37,99,235,0.3)',
      dividerBg: 'rgba(37,99,235,0.2)', bodyFg: '#cbd5e1',
      lnBg: 'rgba(37,99,235,0.08)', lnFg: '#d6e4f7', lnBorder: '#3b82f6',
      capsFg: '#60a5fa', capsBorder: 'rgba(96,165,250,0.4)',
      dotBg: 'rgba(37,99,235,0.18)', dotFg: '#60a5fa', dotBorder: 'rgba(37,99,235,0.35)',
      footLabel: '#2563eb', footPriority: '#60a5fa',
    },
    mensal: {
      bg: '#1a0f0f', headGrad: 'linear-gradient(180deg, #2a1414 0%, #1a0f0f 100%)',
      stripe: 'repeating-linear-gradient(135deg, #dc2626 0px, #dc2626 10px, #b91c1c 10px, #b91c1c 20px)',
      badgeGrad: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)',
      metaFg: '#fca5a5', metaBg: 'rgba(220,38,38,0.16)', metaBorder: 'rgba(220,38,38,0.3)',
      dividerBg: 'rgba(220,38,38,0.2)', bodyFg: '#e7d5d5',
      lnBg: 'rgba(220,38,38,0.08)', lnFg: '#f3d6d6', lnBorder: '#ef4444',
      capsFg: '#f87171', capsBorder: 'rgba(248,113,113,0.4)',
      dotBg: 'rgba(220,38,38,0.18)', dotFg: '#f87171', dotBorder: 'rgba(220,38,38,0.35)',
      footLabel: '#dc2626', footPriority: '#f87171',
    },
    metas: {
      bg: '#170f1e', headGrad: 'linear-gradient(180deg, #241733 0%, #170f1e 100%)',
      stripe: '#7c3aed', badgeGrad: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
      metaFg: '#c4b5fd', metaBg: 'rgba(124,58,237,0.16)', metaBorder: 'rgba(124,58,237,0.3)',
      dividerBg: 'rgba(124,58,237,0.2)', bodyFg: '#d9d2e8',
      lnBg: 'rgba(124,58,237,0.09)', lnFg: '#e3dcf2', lnBorder: '#8b5cf6',
      capsFg: '#a78bfa', capsBorder: 'rgba(167,139,250,0.4)',
      dotBg: 'rgba(124,58,237,0.2)', dotFg: '#a78bfa', dotBorder: 'rgba(124,58,237,0.4)',
      footLabel: '#7c3aed', footPriority: '#a78bfa',
    },
  };
  const T = themes[_fechTipo] || themes.semanal;
  const logoUrl = 'https://concrelagos.com.br/wp-content/uploads/2021/10/Ativo-3.svg';

  const itemsHtml = f.items.filter(i => i.trim()).map((item, i) => `
    <div class="bullet">
      <span class="dot">${String(i + 1).padStart(2, '0')}</span>
      <span>${escapeHtml(item)}</span>
    </div>`).join('');

  const alertsHtml = f.alerts.filter(a => a.trim()).map(al => `
    <div class="stop-box">
      ${_FECH_ICON_ALERT}
      <span>${escapeHtml(al)}</span>
    </div>`).join('');

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Fechamento — ${escapeHtml(f.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Archivo:wght@500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #0d0d0d; display: flex; align-items: center; justify-content: center;
    min-height: 100vh; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    padding: 24px;
  }
  .card {
    background: ${T.bg};
    width: 500px; height: auto;
    border-radius: 14px; overflow: hidden;
    box-shadow: 0 32px 80px rgba(0,0,0,0.7);
    position: relative;
    display: flex; flex-direction: column;
  }
  .card-stripe { height: 6px; width: 100%; background: ${T.stripe}; }
  .logo-strip {
    display: flex; align-items: center; justify-content: center;
    padding: 18px 32px; border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  .logo-strip img { height: 56px; width: auto; display: block; filter: invert(1) hue-rotate(178deg); opacity: .96; }
  .logo-fallback {
    display: none; align-items: center; justify-content: center; gap: 8px;
    font-family: 'Archivo', sans-serif; font-weight: 800; font-size: 17px;
    letter-spacing: .04em; color: #f3f4f6;
  }
  .logo-fallback span { font-weight: 600; font-size: 10px; letter-spacing: .14em; color: #9ca3af; }
  .card-head { padding: 26px 32px 22px; text-align: center; background: ${T.headGrad}; }
  .badge {
    display: inline-flex; align-items: center; gap: 10px;
    padding: 11px 24px 11px 18px; border-radius: 8px;
    font-family: 'Archivo', sans-serif; font-size: 13px; font-weight: 800;
    letter-spacing: .1em; text-transform: uppercase; margin-bottom: 18px;
    background: ${T.badgeGrad}; color: #fff;
    box-shadow: 0 6px 16px -4px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.18);
    position: relative;
  }
  .badge::before {
    content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
    border-radius: 8px 0 0 8px; background: rgba(255,255,255,0.35);
  }
  .badge-icon { width: 24px; height: 24px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
  .badge-icon svg { width: 24px; height: 24px; }
  .card-title {
    font-family: 'Archivo Black', 'Archivo', sans-serif; font-size: 22px; font-weight: 400;
    letter-spacing: -.01em; color: #fff; line-height: 1.25; text-transform: uppercase; word-wrap: break-word;
  }
  .card-meta {
    font-family: 'Archivo', sans-serif; font-size: 11px; font-weight: 700;
    letter-spacing: .05em; text-transform: uppercase; text-align: center;
    padding: 9px 32px; width: 100%;
    color: ${T.metaFg}; background: ${T.metaBg};
    border-top: 1px solid ${T.metaBorder}; border-bottom: 1px solid ${T.metaBorder};
  }
  .card-divider { height: 1px; margin: 0 32px; background: ${T.dividerBg}; }
  .card-body { padding: 26px 32px 28px; color: ${T.bodyFg}; flex: 1; overflow-y: auto; }
  .ln {
    font-size: 13.5px; line-height: 1.7; white-space: pre-wrap; word-wrap: break-word;
    padding: 12px 16px; border-radius: 0 6px 6px 0; font-weight: 500;
    background: ${T.lnBg}; color: ${T.lnFg}; border-left: 3px solid ${T.lnBorder};
  }
  .caps {
    font-family: 'Archivo', sans-serif; font-weight: 800; line-height: 1.4;
    letter-spacing: .07em; font-size: 11.5px; text-transform: uppercase;
    padding-bottom: 8px; border-bottom: 2px solid ${T.capsBorder}; display: inline-block;
    color: ${T.capsFg};
  }
  .spacer { height: 18px; }
  .items-list, .alerts-list { display: flex; flex-direction: column; gap: 7px; }
  .bullet {
    display: flex; align-items: flex-start; gap: 12px;
    font-size: 13.5px; line-height: 1.6; word-wrap: break-word;
    padding: 10px 14px; border-radius: 8px; background: rgba(255,255,255,0.025);
  }
  .dot {
    width: 22px; height: 22px; border-radius: 6px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 10px; font-weight: 800; font-family: 'Courier New', monospace;
    background: ${T.dotBg}; color: ${T.dotFg}; border: 1px solid ${T.dotBorder};
  }
  .stop-box {
    display: flex; align-items: flex-start; gap: 11px;
    font-size: 13px; font-weight: 800; line-height: 1.6;
    padding: 13px 15px; border-radius: 8px; word-wrap: break-word;
    background: rgba(0,0,0,0.45); border: 1.5px solid rgba(251,191,36,0.55);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.04); color: #fcd34d;
  }
  .stop-box svg { width: 17px; height: 17px; flex-shrink: 0; margin-top: 1px; stroke: #fbbf24; }
  .card-foot {
    padding: 16px 32px; display: flex; align-items: center; justify-content: space-between;
    border-top: 1px solid rgba(255,255,255,0.06); flex-wrap: wrap; gap: 6px;
  }
  .foot-label { font-family: 'Archivo', sans-serif; font-size: 9.5px; font-weight: 800; letter-spacing: .15em; text-transform: uppercase; color: ${T.footLabel}; }
  .foot-priority { font-family: 'Archivo', sans-serif; display: flex; align-items: center; gap: 6px; font-size: 9.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: ${T.footPriority}; }
  .foot-priority svg { width: 11px; height: 11px; stroke: ${T.footPriority}; fill: none; }
  .foot-date { font-size: 10px; font-family: 'Courier New', monospace; opacity: .55; color: ${T.bodyFg}; }

  @media print {
    body { background: white; padding: 0; }
    .card { box-shadow: none; border-radius: 0; width: 100%; }
    .no-print { display: none !important; }
  }
  .action-bar { position: fixed; top: 16px; right: 16px; display: flex; gap: 8px; z-index: 100; }
  .action-btn {
    background: rgba(20,20,20,0.82); border: 1px solid rgba(255,255,255,0.18); border-radius: 8px;
    color: #fff; font-size: 12px; font-family: inherit; padding: 7px 14px; cursor: pointer;
    display: flex; align-items: center; gap: 6px; transition: all .15s;
    backdrop-filter: blur(8px); white-space: nowrap;
  }
  .action-btn:hover { background: rgba(40,40,40,0.95); }
  .action-btn.primary { background: ${T.stripe.startsWith('repeating') ? '#dc2626' : T.stripe}cc; }
  .action-btn.primary:hover { background: ${T.stripe.startsWith('repeating') ? '#dc2626' : T.stripe}; }
  @media print { .action-bar { display: none !important; } }
</style>
</head>
<body>

<div class="card">
  <div class="card-stripe"></div>
  <div class="logo-strip">
    <img src="${logoUrl}" alt="Concrelagos Concreto" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
    <div class="logo-fallback">CONCRELAGOS <span>CONCRETO</span></div>
  </div>
  <div class="card-head">
    <div class="badge"><span class="badge-icon">${cfg.badgeIcon}</span><span>${escapeHtml(f.badge)}</span></div>
    <div class="card-title">${escapeHtml(f.title)}</div>
  </div>
  <div class="card-meta">${escapeHtml(f.meta)}</div>
  <div class="card-divider"></div>
  <div class="card-body">
    ${f.intro.trim() ? `<div class="ln">${escapeHtml(f.intro)}</div><div class="spacer"></div>` : ''}
    ${itemsHtml ? `<div class="caps">${escapeHtml(f.listlabel)}</div><div class="items-list">${itemsHtml}</div><div class="spacer"></div>` : ''}
    ${alertsHtml ? `<div class="alerts-list">${alertsHtml}</div>` : ''}
  </div>
  <div class="card-foot">
    <span class="foot-label">Estoque / Insumos</span>
    <span class="foot-priority">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M2 12h20"/></svg>
      ${escapeHtml(cfg.priority)}
    </span>
    <span class="foot-date">${_fechFmtDate(new Date())}</span>
  </div>
</div>

<div class="action-bar no-print">
  <button class="action-btn primary" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button>
</div>

</body>
</html>`;

  const win = window.open('', '_blank', 'width=560,height=800,scrollbars=yes,resizable=yes');
  if (!win) { toast('Popup bloqueado — permita popups para este site.', 'error'); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

Object.assign(window, {
  abrirFechamento, fechamentoSwitchTipo, fechamentoResetarTexto,
  fechUpdateItem, fechRemoveItem, fechAddItem,
  fechUpdateAlert, fechRemoveAlert, fechAddAlert,
  fechRenderFromForm, fechamentoCopiarWhatsapp, fechamentoGerarImagem, fechamentoAbrirPrint
});
