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

// ── Trava de interação dos overlays de loading ──────────────────────────────
// Enquanto um overlay de loading está na tela, o sistema atrás dele fica
// inerte: sem scroll (roda do mouse, toque, teclas de rolagem), sem clique e
// sem atalho de teclado. Cobrir a tela não bastava — a roda do mouse sobre o
// véu ainda rolava a .page-content de trás, as teclas continuavam chegando
// nos handlers (atalhos Ctrl+1..6, ESC fechando modais) e o Tab passeava
// pelos campos escondidos atrás do véu.
//
// Três liberações, todas necessárias:
//  1. Eventos SINTÉTICOS (e.isTrusted === false) passam sempre. O sistema
//     dispara clique programático por trás do overlay o tempo todo — o
//     a.click() que baixa o arquivo exportado, o dispatchEvent('input').
//     Barrar isso quebraria download/importação, não interação de usuário.
//  2. Eventos nascidos DENTRO do overlay passam. O #loading-overlay tem um
//     controle próprio: o botão "Abortar importação" (#loading-abort-btn).
//  3. Se nenhum overlay registrado está de fato na tela (.open), a trava
//     fica inerte. Isso cobre o modal de conflitos da importação, que tira o
//     .open do overlay para perguntar algo ao usuário no meio do processo e
//     o devolve depois (ver _showConflictModal/conflictConfirm em
//     dashboard.js) — sem essa regra, o modal abriria intocável.
//
// Contagem por dono porque os dois overlays (#loading-overlay do boot e
// #view-loading das trocas de visão) podem se sobrepor: os listeners só saem
// quando o último solta.
const _travaDonos = new Set();

// Ponteiro/toque + área de transferência: barrados por completo.
const _TRAVA_EVENTOS_PONTEIRO = [
  'wheel', 'touchstart', 'touchmove', 'touchend',
  'pointerdown', 'pointerup', 'mousedown', 'mouseup',
  'click', 'dblclick', 'contextmenu', 'submit',
  'paste', 'cut', 'dragstart', 'dragover', 'drop'
];
const _TRAVA_EVENTOS_TECLADO = ['keydown', 'keypress', 'keyup'];

function _travaOverlaysNaTela() {
  const abertos = [];
  _travaDonos.forEach(id => {
    const el = document.getElementById(id);
    if (el && el.classList.contains('open')) abertos.push(el);
  });
  return abertos;
}

function _travaDeixaPassar(e) {
  if (!e.isTrusted) return true;
  const abertos = _travaOverlaysNaTela();
  if (!abertos.length) return true;
  const alvo = e.target instanceof Node ? e.target : null;
  return !!alvo && abertos.some(ov => ov.contains(alvo));
}

function _travaBarraEvento(e) {
  if (_travaDeixaPassar(e)) return;
  e.stopPropagation();
  e.stopImmediatePropagation();
  if (e.cancelable) e.preventDefault();
}

function _travaBarraTecla(e) {
  if (_travaDeixaPassar(e)) return;
  // stopImmediatePropagation sempre: nenhum atalho do sistema roda com o
  // overlay na tela. preventDefault só no que é tecla de página — os atalhos
  // do NAVEGADOR (F5, F12, Ctrl+R, Ctrl+W) continuam valendo de propósito:
  // a trava é do sistema, não da janela, e prender o usuário sem conseguir
  // recarregar se algo travar no meio do carregamento seria pior que o mal
  // que ela evita.
  e.stopPropagation();
  e.stopImmediatePropagation();
  const doNavegador = e.ctrlKey || e.metaKey || e.altKey || /^F\d{1,2}$/.test(e.key);
  if (!doNavegador && e.cancelable) e.preventDefault();
}

/** Trava a interação em nome de um overlay (id do elemento). */
function travarInteracao(donoId) {
  if (_travaDonos.has(donoId)) return;
  const primeiro = _travaDonos.size === 0;
  _travaDonos.add(donoId);
  if (!primeiro) return;
  // capture + passive:false: capture para chegar antes de qualquer handler do
  // sistema; passive:false porque wheel/touchmove são passivos por padrão em
  // listeners de window e passivo não deixa dar preventDefault.
  _TRAVA_EVENTOS_PONTEIRO.forEach(tipo =>
    window.addEventListener(tipo, _travaBarraEvento, { capture: true, passive: false }));
  _TRAVA_EVENTOS_TECLADO.forEach(tipo =>
    window.addEventListener(tipo, _travaBarraTecla, { capture: true, passive: false }));
}

/** Solta a trava em nome de um overlay; só destrava quando o último sai. */
function destravarInteracao(donoId) {
  if (!_travaDonos.delete(donoId)) return;
  if (_travaDonos.size > 0) return;
  _TRAVA_EVENTOS_PONTEIRO.forEach(tipo =>
    window.removeEventListener(tipo, _travaBarraEvento, { capture: true }));
  _TRAVA_EVENTOS_TECLADO.forEach(tipo =>
    window.removeEventListener(tipo, _travaBarraTecla, { capture: true }));
}

Object.assign(window, { travarInteracao, destravarInteracao });

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
  travarInteracao('loading-overlay');

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
    destravarInteracao('loading-overlay');
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
  const elW     = el.offsetWidth  || 300;
  const elH     = el.offsetHeight || 400;
  el.style.left       = Math.max(8, (window.innerWidth  - elW) / 2 + offset) + 'px';
  el.style.top        = Math.max(topbarH + 10, (window.innerHeight - elH) / 2 + offset) + 'px';
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

// Fecha todas as janelas flutuantes abertas de uma vez. Existe por causa
// do logout: elas moraram dentro da .topbar até 03/09/2026 e sumiam junto
// com .layout; agora vivem soltas no body (ver o comentário do bloco no
// index.html), então esconder o layout não as tira mais da tela — quem
// fecha é o showGate() em js/auth.js.
function closeAllTools() {
  // Cópia do Set: closeTool remove de _openTools durante a iteração.
  [..._openTools].forEach(closeTool);
}

// Base da camada das cinco janelas flutuantes — lida do token CSS
// (--z-flutuantes em css/tokens.css) pra não existir o mesmo número em
// dois lugares se um dia ele mudar. Cada abertura/clique soma +1, o que
// traz a janela pra frente das outras sem tirar o grupo da camada:
// a folga até o alerta do ADM (999999) dá ~99 mil aberturas na sessão.
// ponytail: teto suficiente na prática; se um dia estourar, o caminho é
// renumerar as abertas a partir da base em vez de aumentar o teto.
let _toolZBase = null;
function _nextToolZ() {
  if (_toolZBase === null) {
    const v = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--z-flutuantes'), 10);
    _toolZBase = Number.isFinite(v) ? v : 900010;
  }
  return ++_toolZBase;
}

// ESC fecha o popover "de cima" (maior z-index), se houver mais de um
// aberto — mesmo padrão de setupModalCloseOnEscape() (analitico.js), só
// que pra .tool-popover em vez de .modal-overlay.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !_openTools.size) return;
  let top = null, topZ = -Infinity, topName = null;
  _openTools.forEach(name => {
    const el = document.getElementById('tool-' + name);
    if (!el) return;
    const z = parseFloat(el.style.zIndex) || 0;
    if (z >= topZ) { topZ = z; top = el; topName = name; }
  });
  if (topName) closeTool(topName);
});

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
  if (!id) return;
  // PK é composta (user_id, id) — escopado ao próprio user_id (ver
  // _supaDeleteOwned, normalize.js).
  _supaDeleteOwned('bloco_notas', { id })
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
  toggleToolsMenu, closeToolsMenu, openTool, closeTool, closeAllTools, toggleCalc,
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
  cubagens:{ badgeIcon: _FECH_ICON_TARGET,   priority: 'Acompanhamento semanal' },
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

  // Painéis: os três tipos de texto dividem o mesmo builder; Cubagens tem o seu.
  const ehCub     = tipo === 'cubagens';
  const paneTexto = document.getElementById('fech-pane-texto');
  const paneCub   = document.getElementById('fech-pane-cubagens');
  if (paneTexto) paneTexto.style.display = ehCub ? 'none' : '';
  if (paneCub)   paneCub.style.display   = ehCub ? ''     : 'none';
  if (ehCub) { cubRenderTudo(); return; }

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
  if (_fechTipo === 'cubagens') return _cubPlainText();
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
    cubagens: {
      bg1: '#0e0b04', bg2: '#1c1608',
      accent: '#b8860b', accentLight: '#f5c542',
      accentGlow: 'rgba(245,197,66,0.18)',
      stripe: '#3a2d0d',
      badgeText: 'META SEMANAL DE CUBAGEM',
      badgeBg: '#b8860b', badgeFg: '#1a1305',
      bodyFg: '#e8dfc4',
      footerFg: '#7c6420',
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
  // Cubagens tem card próprio (tabela por central) — página de impressão dedicada.
  if (_fechTipo === 'cubagens') { _cubAbrirPrint(); return; }
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

// ═══════════════════════════════════════════════════════════
// CUBAGENS — meta semanal de cubagem de carretas por central
// (4ª aba do modal de Fechamento)
//
// Quantidade a cubar = ABASTECIMENTO modulado pelo GIRO:
//   • base   = carretas recebidas por semana (NFs distintas de agregado
//              na janela das 4 semanas anteriores à semana da meta);
//   • fator  = faixa de giro do material NAQUELA central — giro alto
//              significa material girando bem, exige menos conferência;
//              giro baixo/parado puxa a amostragem pra cima;
//   • piso/teto = 1 a N cubagens; central que praticamente não recebe
//              o material fica com meta 0 (não há carreta pra cubar).
//
// O giro NÃO é recalculado aqui: vem de buildGiroPorCentralMaterial
// (dashboard.js), a mesma fonte do modal Giro & Cobertura, agregado
// por subcategoria (Σ saídas ÷ Σ estoque médio). Assim a meta nunca
// diverge do que o analista vê na tela de giro.
// ═══════════════════════════════════════════════════════════

const _CUB_KEY = 'analyticsys_cubagens_v1';

// Colunas do cartão. "Areia/pó" = agregado miúdo, "britas" = graúdo —
// a subcategoria sai do CADASTRO do material (getCatSubKeyDoCadastro), não
// do nome: "PÓ DE BRITA" cadastrado como Agregado Miúdo tem que cair em
// Areias, e a heurística por nome jogaria em Britas.
const _CUB_SUBS = [
  { key: 'agregado_miudo',  label: 'Areias', plain: 'areias' },
  { key: 'agregado_graudo', label: 'Britas', plain: 'britas' },
];

// Faixas de giro em ordem decrescente. Os limiares são os MESMOS já usados
// por _giroNivelPontos (dashboard.js) — não existe uma segunda régua de
// giro no sistema, só um fator de amostragem por faixa.
const _CUB_FAIXAS = [
  { key: 'muitoAlto',  min: 4.0, label: 'muito alto',  def: 0.6 },
  { key: 'alto',       min: 2.0, label: 'alto',        def: 0.8 },
  { key: 'saudavel',   min: 1.0, label: 'saudável',    def: 1.0 },
  { key: 'baixo',      min: 0.5, label: 'baixo',       def: 1.2 },
  { key: 'muitoBaixo', min: 0.2, label: 'muito baixo', def: 1.4 },
  { key: 'parado',     min: -1,  label: 'parado',      def: 1.6 },
];

const _CUB_SEMANAS_JANELA = 4;

function _cubDefaults() {
  const fatores = {};
  _CUB_FAIXAS.forEach(f => { fatores[f.key] = f.def; });
  return {
    regional: '',
    weekOffset: 0,
    params: { pct: 25, teto: 6, minCarretas: 1, fatores },
    overrides: {},
    orientacao: 'Realize no mínimo a quantidade de cubagens indicadas para cada filial em areias e britas durante o período da semana.',
    alerta: 'A META É MÍNIMA E OBRIGATÓRIA. Não deixe nenhuma filial abaixo da meta.',
  };
}

let _cubState     = null;
let _cubSaveTimer = null;
let _cubCache     = null; // { chave, carretas, giro } — evita refazer o giro a cada tecla
let _cubLast      = null; // último cálculo renderizado (índice usado pelos inputs de ajuste)

function _cubGet() {
  if (_cubState) return _cubState;
  const d = _cubDefaults();
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(_CUB_KEY) || 'null'); } catch (e) {}
  _cubState = (saved && typeof saved === 'object')
    ? {
        ...d, ...saved,
        params: {
          ...d.params, ...(saved.params || {}),
          fatores: { ...d.params.fatores, ...((saved.params || {}).fatores || {}) }
        },
        overrides: (saved.overrides && typeof saved.overrides === 'object') ? saved.overrides : {}
      }
    : d;
  _cubState.weekOffset = 0; // a semana sempre reabre na atual
  return _cubState;
}

function _cubSave() {
  clearTimeout(_cubSaveTimer);
  _cubSaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(_CUB_KEY, JSON.stringify(_cubState));
      const ind = document.getElementById('cub-saved-indicator');
      if (ind) { ind.style.opacity = '1'; setTimeout(() => ind.style.opacity = '0', 1500); }
    } catch (e) {}
  }, 500);
}

// ── Semana da meta (segunda a domingo) e janela de dados ──────────────
function _cubSemana(offset) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const dow  = hoje.getDay();                 // 0 = domingo
  const ini  = new Date(hoje);
  ini.setDate(hoje.getDate() + (dow === 0 ? -6 : 1 - dow) + (offset || 0) * 7);
  const fim = new Date(ini); fim.setDate(ini.getDate() + 6);
  return { ini, fim };
}

// Janela de apuração: as 4 semanas COMPLETAS que antecedem a semana da meta.
// Andar de semana no cartão anda a janela junto — a meta de uma semana
// sempre olha pro ritmo imediatamente anterior a ela.
function _cubJanela(semana) {
  const dtFim = new Date(semana.ini); dtFim.setDate(dtFim.getDate() - 1); dtFim.setHours(23, 59, 59, 999);
  const dtIni = new Date(dtFim);      dtIni.setDate(dtIni.getDate() - (_CUB_SEMANAS_JANELA * 7 - 1)); dtIni.setHours(0, 0, 0, 0);
  return { dtIni, dtFim, semanas: _CUB_SEMANAS_JANELA };
}

function _cubN(v, d) { return (Number(v) || 0).toFixed(d).replace('.', ','); }

function _cubSubDoMaterial(mat, catRaw) {
  const cad = (typeof getCatSubKeyDoCadastro === 'function') ? getCatSubKeyDoCadastro(mat) : null;
  if (cad) return cad;
  return (typeof detectCatSubKey === 'function') ? detectCatSubKey(catRaw || '', mat || '') : null;
}

// ── Coleta bruta da janela: carretas (abastecimento) + giro ───────────
function _cubDados(dtIni, dtFim) {
  const chave = dtIni.getTime() + '|' + dtFim.getTime() + '|' +
                (state.entradas || []).length + '|' + (state.lancamentos || []).length + '|' + (state.sap || []).length;
  if (_cubCache && _cubCache.chave === chave) return _cubCache;

  // Carretas = NFs distintas de agregado recebidas pela central. Mesma
  // contagem de "pedidos" do Controle de Agregados: várias linhas de
  // material na mesma nota são UMA carreta.
  const carretas = new Map();
  (state.entradas || []).forEach((e, idx) => {
    const d = parseDate(e.dtDescarga || e.dtEmissao || '');
    if (!d || d < dtIni || d > dtFim) return;
    const sub = _cubSubDoMaterial(e.material, e.categoria);
    if (!sub) return;
    const central = normalizeText(e.centralDestino || e.centralCompra || '');
    if (!central) return;
    const k = central + '|||' + sub;
    if (!carretas.has(k)) carretas.set(k, new Set());
    const nf = String(e.nf || '').trim();
    // Nota em branco não agrupa: cada linha vale por uma carreta.
    carretas.get(k).add((nf && nf !== '—') ? nf : '#' + idx);
  });

  // Giro por central × subcategoria — Σ saídas ÷ Σ estoque médio dos
  // materiais daquela subcategoria (mesma base do modal Giro & Cobertura).
  const giro = new Map();
  if (typeof buildGiroPorCentralMaterial === 'function') {
    let res = null;
    try { res = buildGiroPorCentralMaterial(dtIni, dtFim); }
    catch (err) { console.warn('[Cubagens] giro indisponível — metas caem só no abastecimento.', err); }
    ((res && res.centrais) || []).forEach(c => {
      const central = normalizeText(c.name || '');
      (c.mats || []).forEach(m => {
        const sub = _cubSubDoMaterial(m.name, '');
        if (!sub) return;
        const k   = central + '|||' + sub;
        const acc = giro.get(k) || { saidas: 0, estMedio: 0 };
        acc.saidas   += m.saidas   || 0;
        acc.estMedio += m.estMedio || 0;
        giro.set(k, acc);
      });
    });
  }

  _cubCache = { chave, carretas, giro };
  return _cubCache;
}

function _cubFaixa(giro) {
  return _CUB_FAIXAS.find(f => giro >= f.min) || _CUB_FAIXAS[_CUB_FAIXAS.length - 1];
}

// Conta de uma célula (uma central × uma subcategoria). Devolve todos os
// passos intermediários — é isso que o tooltip mostra célula a célula.
function _cubCalcCelula(carretas, giro, semanas, p) {
  const carretasSem = semanas > 0 ? carretas / semanas : 0;
  const faixa = _cubFaixa(giro);
  const fator = num(p.fatores[faixa.key]) || 1;
  const bruto = carretasSem * (num(p.pct) / 100) * fator;
  const semAbastecimento = carretasSem < num(p.minCarretas);
  const meta = semAbastecimento
    ? 0
    : Math.min(Math.max(1, Math.round(num(p.teto))), Math.max(1, Math.round(bruto)));
  return { carretas, carretasSem, giro, faixa, fator, bruto, meta, auto: meta, semAbastecimento, override: null };
}

function _cubOvKey(regional, central, subKey) {
  return regional + '|||' + central + '|||' + subKey;
}

// ── Cálculo completo do cartão ────────────────────────────────────────
function cubCalcular() {
  const st     = _cubGet();
  const semana = _cubSemana(st.weekOffset);
  const janela = _cubJanela(semana);
  const dados  = _cubDados(janela.dtIni, janela.dtFim);

  const vistas = new Set();
  const centrais = (state.filiais || [])
    .filter(f => (((f.regional || '').trim()) || 'Sem Regional') === st.regional)
    .map(f => (f.alias || f.origem || '').trim())
    .filter(nome => {
      if (!nome || vistas.has(normalizeText(nome))) return false;
      vistas.add(normalizeText(nome));
      return true;
    })
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const linhas = centrais.map(central => {
    const nk    = normalizeText(central);
    const cells = {};
    _CUB_SUBS.forEach(s => {
      const set = dados.carretas.get(nk + '|||' + s.key);
      const g   = dados.giro.get(nk + '|||' + s.key);
      const cel = _cubCalcCelula(set ? set.size : 0, (g && g.estMedio > 0) ? g.saidas / g.estMedio : 0, janela.semanas, st.params);
      const ov  = st.overrides[_cubOvKey(st.regional, central, s.key)];
      if (Number.isFinite(ov)) { cel.override = ov; cel.meta = ov; }
      cells[s.key] = cel;
    });
    return { central, cells };
  });

  _cubLast = { st, semana, janela, linhas };
  return _cubLast;
}

// ── Memória de cálculo (tooltip personalizado, "|" = quebra de linha) ──
function _cubTooltip(central, sub, cel, janela, p) {
  const L = [];
  L.push(sub.label.toUpperCase() + ' · ' + central);
  L.push('Janela: ' + _fechFmtDate(janela.dtIni) + ' a ' + _fechFmtDate(janela.dtFim) + ' (' + janela.semanas + ' semanas)');
  L.push('Carretas recebidas: ' + cel.carretas + ' → ' + _cubN(cel.carretasSem, 1) + '/semana');
  L.push('Giro no período: ' + _cubN(cel.giro, 2) + '× (' + cel.faixa.label + ') → fator ' + _cubN(cel.fator, 2));
  L.push('Conta: ' + _cubN(cel.carretasSem, 1) + ' × ' + _cubN(num(p.pct), 0) + '% × ' + _cubN(cel.fator, 2) + ' = ' + _cubN(cel.bruto, 2));
  if (cel.semAbastecimento) {
    L.push('Meta 0 — abastecimento abaixo de ' + _cubN(num(p.minCarretas), 1) + ' carreta(s)/semana');
  } else {
    L.push('Meta: arredonda(' + _cubN(cel.bruto, 2) + ') = ' + Math.round(cel.bruto) + ', com piso 1 e teto ' + Math.round(num(p.teto)) + ' → ' + cel.auto);
  }
  if (cel.override !== null) L.push('Ajuste manual: ' + cel.override + ' (calculado: ' + cel.auto + ')');
  return L.join('|');
}

// ── Render: painel de parâmetros + cartão ─────────────────────────────
function cubRenderTudo() {
  const st = _cubGet();

  const sel = document.getElementById('cub-f-regional');
  if (sel) {
    const regionais = [...new Set((state.filiais || []).map(f => ((f.regional || '').trim()) || 'Sem Regional'))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (!regionais.includes(st.regional)) st.regional = regionais[0] || '';
    sel.innerHTML = regionais.length
      ? regionais.map(r => '<option value="' + escapeHtml(r) + '"' + (r === st.regional ? ' selected' : '') + '>' + escapeHtml(r) + '</option>').join('')
      : '<option value="">— nenhuma central cadastrada —</option>';
  }

  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  setVal('cub-f-orientacao', st.orientacao);
  setVal('cub-f-alerta',     st.alerta);
  ['pct', 'teto', 'minCarretas'].forEach(k => setVal('cub-p-' + k, st.params[k]));

  const fw = document.getElementById('cub-p-fatores');
  if (fw) {
    fw.innerHTML = _CUB_FAIXAS.map(f =>
      '<label class="cub-param"><span>' + escapeHtml(f.label) + (f.min >= 0 ? ' (≥' + _cubN(f.min, 1) + '×)' : '') + '</span>' +
      '<input type="number" min="0" max="5" step="0.1" value="' + st.params.fatores[f.key] + '" oninput="cubSetFator(\'' + f.key + '\', this.value)"></label>'
    ).join('');
  }

  cubRenderCartao(true);
}

function cubRenderCartao(rebuildAjustes) {
  const calc = cubCalcular();
  const { st, semana, janela, linhas } = calc;

  const elBadge = document.getElementById('cub-c-badge');
  if (elBadge) elBadge.innerHTML = '<span class="fech-card-badge-icon">' + _FECH_ICON_TARGET + '</span><span>Meta semanal</span>';

  const elRegional = document.getElementById('cub-c-regional');
  if (elRegional) {
    const nome = (st.regional || '').trim();
    elRegional.innerHTML = nome ? '<i class="ti ti-map-pin"></i>' + escapeHtml(nome) : '';
    elRegional.style.display = nome ? 'inline-flex' : 'none';
  }

  const elSemana = document.getElementById('cub-c-semana');
  if (elSemana) elSemana.textContent = 'Semana: ' + _fechFmtDate(semana.ini) + ' a ' + _fechFmtDate(semana.fim);

  const elJanela = document.getElementById('cub-f-janela');
  if (elJanela) elJanela.textContent = 'Base de cálculo: ' + _fechFmtDate(janela.dtIni) + ' a ' + _fechFmtDate(janela.dtFim) + ' (' + janela.semanas + ' semanas antes da meta).';

  const elSemanaForm = document.getElementById('cub-f-semana');
  if (elSemanaForm) elSemanaForm.textContent = _fechFmtDate(semana.ini) + ' a ' + _fechFmtDate(semana.fim);

  const elDate = document.getElementById('cub-c-date');
  if (elDate) elDate.textContent = _fechFmtDate(new Date());

  const elTable = document.getElementById('cub-c-table');
  if (elTable) {
    if (!linhas.length) {
      elTable.innerHTML = '<div class="cub-table-empty">Nenhuma central cadastrada neste regional.<br>Cadastre as filiais em Configurações → Centrais.</div>';
    } else {
      const head = '<tr><th>Filial</th>' + _CUB_SUBS.map(s => '<th>' + escapeHtml(s.label) + '</th>').join('') + '</tr>';
      const body = linhas.map(l => {
        const tds = _CUB_SUBS.map(s => {
          const cel = l.cells[s.key];
          const cls = 'cub-td-num' + (cel.meta === 0 ? ' is-zero' : '') + (cel.override !== null ? ' is-manual' : '');
          return '<td class="' + cls + '" data-absent-tooltip="' + escapeHtml(_cubTooltip(l.central, s, cel, janela, st.params)) + '">' + cel.meta + '</td>';
        }).join('');
        return '<tr><td>' + escapeHtml(l.central) + '</td>' + tds + '</tr>';
      }).join('');
      elTable.innerHTML = '<table class="cub-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
      if (typeof initAbsentTooltips === 'function') initAbsentTooltips(elTable);
    }
  }

  const elOri = document.getElementById('cub-c-orientacao');
  if (elOri) {
    const t = (st.orientacao || '').trim();
    elOri.innerHTML = t ? '<div class="cub-info-box"><i class="ti ti-info-circle"></i><span><b>Orientações</b>' + escapeHtml(t) + '</span></div>' : '';
  }

  const elAlerta = document.getElementById('cub-c-alerta');
  if (elAlerta) {
    const t = (st.alerta || '').trim();
    elAlerta.innerHTML = t ? '<div class="stop-box">' + _FECH_ICON_ALERT + '<span>' + escapeHtml(t) + '</span></div>' : '';
  }

  _cubRenderAjustes(calc, rebuildAjustes);
}

// Lista de ajuste manual. Só é reconstruída quando muda o regional/aba —
// digitar num input repinta apenas o cartão, senão o campo perde o foco.
function _cubRenderAjustes(calc, rebuild) {
  const wrap = document.getElementById('cub-f-ajustes');
  if (!wrap) return;
  const { st, janela, linhas } = calc;

  if (rebuild || wrap.dataset.regional !== st.regional) {
    wrap.dataset.regional = st.regional;
    if (!linhas.length) { wrap.innerHTML = '<div class="fech-field-hint">Nenhuma central neste regional.</div>'; return; }
    const head = '<div class="cub-ajuste-head"><span>Central</span>' +
      _CUB_SUBS.map(s => '<span>' + escapeHtml(s.label) + '</span>').join('') +
      '<span class="cub-ajuste-spacer"></span></div>';
    wrap.innerHTML = head + linhas.map((l, i) => {
      const inputs = _CUB_SUBS.map(s => {
        const cel = l.cells[s.key];
        return '<input type="number" min="0" max="99" step="1" data-cub-idx="' + i + '" data-cub-sub="' + s.key + '"' +
               ' value="' + (cel.override !== null ? cel.override : '') + '" placeholder="' + cel.auto + '"' +
               ' oninput="cubSetOverride(' + i + ', \'' + s.key + '\', this.value)">';
      }).join('');
      return '<div class="cub-ajuste-row">' +
        '<span class="cub-ajuste-nome" data-absent-tooltip="' + escapeHtml(_CUB_SUBS.map(s => _cubTooltip(l.central, s, l.cells[s.key], janela, st.params)).join("| |")) + '">' + escapeHtml(l.central) + '</span>' +
        inputs +
        '<button class="fech-icon-btn" onclick="cubLimparOverride(' + i + ')" title="Voltar ao valor calculado"><i class="ti ti-refresh"></i></button>' +
        '</div>';
    }).join('');
    if (typeof initAbsentTooltips === 'function') initAbsentTooltips(wrap);
    return;
  }

  // Sem rebuild: só atualiza o placeholder (valor calculado) de cada input.
  wrap.querySelectorAll('[data-cub-idx]').forEach(inp => {
    const l = linhas[Number(inp.dataset.cubIdx)];
    const cel = l && l.cells[inp.dataset.cubSub];
    if (cel) inp.placeholder = cel.auto;
  });
}

// ── Handlers do formulário ────────────────────────────────────────────
function cubSetCampo(campo, valor) {
  const st = _cubGet();
  st[campo] = valor;
  _cubSave();
  if (campo === 'regional') cubRenderTudo();
  else cubRenderCartao();
}

function cubSetParam(campo, valor) {
  const st = _cubGet();
  st.params[campo] = num(valor);
  _cubSave();
  cubRenderCartao();
}

function cubSetFator(faixaKey, valor) {
  const st = _cubGet();
  st.params.fatores[faixaKey] = num(valor);
  _cubSave();
  cubRenderCartao();
}

function cubShiftSemana(delta) {
  const st = _cubGet();
  st.weekOffset += delta;
  cubRenderCartao();
}

function cubSetOverride(idx, subKey, valor) {
  const st = _cubGet();
  const l  = _cubLast && _cubLast.linhas[idx];
  if (!l) return;
  const k = _cubOvKey(st.regional, l.central, subKey);
  const v = String(valor).trim();
  if (v === '') delete st.overrides[k];
  else st.overrides[k] = Math.max(0, Math.round(num(v)));
  _cubSave();
  cubRenderCartao();
}

function cubLimparOverride(idx) {
  const st = _cubGet();
  const l  = _cubLast && _cubLast.linhas[idx];
  if (!l) return;
  _CUB_SUBS.forEach(s => { delete st.overrides[_cubOvKey(st.regional, l.central, s.key)]; });
  _cubSave();
  cubRenderTudo();
}

function cubResetar() {
  if (!confirm('Restaurar os parâmetros padrão e apagar todos os ajustes manuais deste regional?')) return;
  const st = _cubGet();
  const d  = _cubDefaults();
  st.params     = d.params;
  st.overrides  = {};
  st.orientacao = d.orientacao;
  st.alerta     = d.alerta;
  _cubSave();
  cubRenderTudo();
  toast('Parâmetros restaurados e ajustes limpos.');
}

// ── Texto plano (WhatsApp / imagem PNG) ───────────────────────────────
function _cubPlainText() {
  const { st, semana, linhas, janela } = cubCalcular();
  if (!linhas.length) return '';
  const p = st.params;
  const partes = [];
  partes.push('META SEMANAL DE CUBAGEM DAS CARRETAS');
  if (st.regional) partes.push('Regional: ' + st.regional);
  partes.push('Semana: ' + _fechFmtDate(semana.ini) + ' a ' + _fechFmtDate(semana.fim));
  partes.push('QUANTIDADE MÍNIMA POR FILIAL:');
  linhas.forEach(l => {
    partes.push('• ' + l.central + ' — ' + _CUB_SUBS.map(s => l.cells[s.key].meta + ' ' + s.plain).join(' / '));
  });
  if ((st.orientacao || '').trim()) partes.push(st.orientacao.trim());
  if ((st.alerta || '').trim())     partes.push('⚠️ ' + st.alerta.trim());
  partes.push('Cálculo: carretas recebidas por semana entre ' + _fechFmtDate(janela.dtIni) + ' e ' + _fechFmtDate(janela.dtFim) +
              ', × ' + _cubN(num(p.pct), 0) + '% de amostragem, ajustado pelo giro do material na central.');
  return partes.join('\n\n');
}

// ── Página de impressão dedicada (mantém o layout do cartão) ──────────
function _cubAbrirPrint() {
  const { st, semana, linhas } = cubCalcular();
  if (!linhas.length) { toast('Nenhuma central neste regional.', 'error'); return; }
  const logoUrl = 'https://concrelagos.com.br/wp-content/uploads/2021/10/Ativo-3.svg';

  const rows = linhas.map(l => {
    const tds = _CUB_SUBS.map(s => {
      const cel = l.cells[s.key];
      return '<td class="num' + (cel.meta === 0 ? ' zero' : '') + '">' + cel.meta + '</td>';
    }).join('');
    return '<tr><td class="filial">' + escapeHtml(l.central) + '</td>' + tds + '</tr>';
  }).join('');

  const html = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<title>Cubagens — ' + escapeHtml(st.regional || '') + '</title>' +
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
    '<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Archivo:wght@500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">' +
    '<style>' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{background:#0d0d0d;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px 12px;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
    '.card{width:100%;max-width:460px;background:#0e0b04;border-radius:14px;overflow:hidden;box-shadow:0 18px 40px rgba(0,0,0,.45)}' +
    '.stripe{height:6px;background:linear-gradient(90deg,#8a6510 0%,#f5c542 50%,#8a6510 100%)}' +
    '.logo{display:flex;align-items:center;justify-content:center;padding:16px 28px;border-bottom:1px solid rgba(255,255,255,.06)}' +
    '.logo img{height:52px;filter:invert(1) hue-rotate(178deg);opacity:.96}' +
    '.head{padding:22px 28px 20px;text-align:center;background:linear-gradient(180deg,#1c1608 0%,#0e0b04 100%)}' +
    '.badge{display:inline-block;padding:10px 20px;border-radius:8px;background:linear-gradient(135deg,#f5c542 0%,#b8860b 100%);color:#1a1305;font-family:Archivo,sans-serif;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;margin-bottom:16px}' +
    '.title{font-family:"Archivo Black",Archivo,sans-serif;font-size:19px;color:#fff;line-height:1.25;text-transform:uppercase}' +
    '.regional{margin-top:10px;font-family:Archivo,sans-serif;font-size:11.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#fcd34d}' +
    '.meta{font-family:Archivo,sans-serif;font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;text-align:center;padding:9px 28px;color:#fcd34d;background:rgba(212,175,55,.14);border-top:1px solid rgba(212,175,55,.3);border-bottom:1px solid rgba(212,175,55,.3)}' +
    '.body{padding:22px 28px 24px;color:#e8dfc4}' +
    'table{width:100%;border-collapse:collapse;font-family:Archivo,sans-serif}' +
    'th{font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#fcd34d;padding:9px 10px;text-align:center;background:rgba(212,175,55,.12);border-bottom:1.5px solid rgba(212,175,55,.35)}' +
    'th:first-child{text-align:left}' +
    'td{padding:8px 10px;text-align:center;border-bottom:1px solid rgba(212,175,55,.12)}' +
    'td.filial{text-align:left;font-weight:700;font-size:11.5px;text-transform:uppercase;color:#e8dfc4}' +
    'td.num{font-family:"Courier New",monospace;font-weight:800;font-size:14px;color:#fff}' +
    'td.num.zero{color:#7c7259}' +
    '.info{display:flex;gap:10px;margin-top:16px;font-size:12px;line-height:1.55;padding:12px 14px;border-radius:8px;background:rgba(212,175,55,.07);border:1px solid rgba(212,175,55,.28)}' +
    '.info b{display:block;font-family:Archivo,sans-serif;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#fcd34d;margin-bottom:3px}' +
    '.stop{display:flex;gap:10px;margin-top:10px;font-size:12.5px;font-weight:800;line-height:1.55;padding:12px 14px;border-radius:8px;background:rgba(0,0,0,.45);border:1.5px solid rgba(251,191,36,.55);color:#fcd34d}' +
    '.foot{padding:14px 28px;display:flex;justify-content:space-between;border-top:1px solid rgba(255,255,255,.06);font-family:Archivo,sans-serif;font-size:9px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#b8860b}' +
    '.foot .dt{font-family:"Courier New",monospace;letter-spacing:0;color:#d6c68a}' +
    '.action-bar{position:fixed;bottom:16px;right:16px}' +
    '.action-bar button{padding:10px 16px;border-radius:8px;border:none;background:#b8860b;color:#1a1305;font-weight:700;cursor:pointer}' +
    '@media print{body{background:#fff;padding:0}.no-print{display:none}.card{box-shadow:none}}' +
    '</style></head><body><div class="card">' +
    '<div class="stripe"></div>' +
    '<div class="logo"><img src="' + logoUrl + '" alt="Concrelagos"></div>' +
    '<div class="head"><div class="badge">Meta semanal</div>' +
    '<div class="title">Cubagem mínima das carretas</div>' +
    (st.regional ? '<div class="regional">' + escapeHtml(st.regional) + '</div>' : '') +
    '</div>' +
    '<div class="meta">Semana: ' + _fechFmtDate(semana.ini) + ' a ' + _fechFmtDate(semana.fim) + '</div>' +
    '<div class="body"><table><thead><tr><th>Filial</th>' +
    _CUB_SUBS.map(s => '<th>' + escapeHtml(s.label) + '</th>').join('') +
    '</tr></thead><tbody>' + rows + '</tbody></table>' +
    ((st.orientacao || '').trim() ? '<div class="info"><span><b>Orientações</b>' + escapeHtml(st.orientacao.trim()) + '</span></div>' : '') +
    ((st.alerta || '').trim() ? '<div class="stop"><span>' + escapeHtml(st.alerta.trim()) + '</span></div>' : '') +
    '</div>' +
    '<div class="foot"><span>Acompanhamento semanal</span><span class="dt">' + _fechFmtDate(new Date()) + '</span></div>' +
    '</div>' +
    '<div class="action-bar no-print"><button onclick="window.print()">Imprimir / Salvar PDF</button></div>' +
    '</body></html>';

  const win = window.open('', '_blank', 'width=560,height=800,scrollbars=yes,resizable=yes');
  if (!win) { toast('Popup bloqueado — permita popups para este site.', 'error'); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

Object.assign(window, {
  cubCalcular, cubRenderTudo, cubRenderCartao,
  cubSetCampo, cubSetParam, cubSetFator, cubShiftSemana,
  cubSetOverride, cubLimparOverride, cubResetar
});
