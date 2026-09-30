// ═══════════════════════════════════════════════════════════
// CONSTRUTOR DE INFORMATIVOS — cartões livres (blocos) com modelos nomeados
// Reaproveita a estrutura visual .fech-card do modal de Fechamento, mas as
// cores vêm de variáveis CSS (--inf-*) definidas por modelo.
// ═══════════════════════════════════════════════════════════

const _INF_KEY  = 'analyticsys_informativos_v1';
const _INF_LOGO = 'https://concrelagos.com.br/wp-content/uploads/2021/10/Ativo-3.svg';

// Ícones sugeridos para o selo (Tabler). O campo aceita qualquer nome Tabler ou um emoji.
const _INF_ICONES = ['calendar-week', 'calendar-month', 'box', 'target-arrow', 'cube', 'alert-triangle',
  'info-circle', 'speakerphone', 'clipboard-check', 'checklist', 'truck', 'building-factory-2',
  'shield-check', 'bell-ringing', 'flame', 'star'];

// Paletas prontas — as 4 dos fechamentos + extras. Só preenchem as cores; tudo continua editável.
const _INF_PALETAS = {
  azul:    { accent: '#3b82f6', bg: '#0d141f', fg: '#cbd5e1', alert: '#fbbf24', stripe: 'solida' },
  vermelho:{ accent: '#ef4444', bg: '#1a0f0f', fg: '#e7d5d5', alert: '#fbbf24', stripe: 'listrada' },
  roxo:    { accent: '#8b5cf6', bg: '#170f1e', fg: '#d9d2e8', alert: '#fbbf24', stripe: 'solida' },
  dourado: { accent: '#f5c542', bg: '#0e0b04', fg: '#e8dfc4', alert: '#f87171', stripe: 'gradiente' },
  verde:   { accent: '#22c55e', bg: '#0b1510', fg: '#cfe3d6', alert: '#fbbf24', stripe: 'solida' },
  grafite: { accent: '#94a3b8', bg: '#111318', fg: '#d4d7de', alert: '#fbbf24', stripe: 'solida' },
  claro:   { accent: '#2563eb', bg: '#ffffff', fg: '#1f2937', alert: '#d97706', stripe: 'solida' },
};

const _INF_BLOCOS = {
  texto:    { label: 'Texto',            icon: 'align-left' },
  titulo:   { label: 'Título de seção',  icon: 'heading' },
  lista:    { label: 'Lista',            icon: 'list-numbers' },
  alerta:   { label: 'Alerta',           icon: 'alert-triangle' },
  destaque: { label: 'Destaque (valor)', icon: 'number' },
  divisoria:{ label: 'Divisória',        icon: 'separator' },
  espaco:   { label: 'Espaço',           icon: 'space' },
};

function _infNovoBloco(tipo) {
  switch (tipo) {
    case 'texto':    return { tipo, texto: 'Novo texto.', estilo: 'destaque' };
    case 'titulo':   return { tipo, texto: 'NOVA SEÇÃO:' };
    case 'lista':    return { tipo, itens: ['Item 1', 'Item 2'], estilo: 'numerada' };
    case 'alerta':   return { tipo, texto: 'Novo alerta importante.', tom: 'atencao' };
    case 'destaque': return { tipo, valor: '100%', legenda: 'Legenda do destaque' };
    default:         return { tipo };
  }
}

function _infId() { return 'inf' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function _infModeloBase(nome) {
  return {
    id: _infId(), nome: nome || 'Novo informativo',
    cores: { ..._INF_PALETAS.azul },
    selo: { mostrar: true, texto: 'Informativo', icone: 'speakerphone' },
    titulo: 'Título do informativo', alinhamento: 'center',
    contexto: { mostrar: true, texto: 'Hoje · {hoje}' },
    logo: true,
    blocos: [
      { tipo: 'texto', texto: 'Escreva aqui a mensagem principal.', estilo: 'destaque' },
      { tipo: 'espaco' },
      { tipo: 'titulo', texto: 'O QUE DEVE SER FEITO:' },
      { tipo: 'lista', itens: ['Primeiro ponto', 'Segundo ponto'], estilo: 'numerada' },
      { tipo: 'espaco' },
      { tipo: 'alerta', texto: 'Qualquer dúvida, avisem com antecedência.', tom: 'atencao' },
    ],
    rodape: { mostrar: true, rotulo: 'Estoque / Insumos', prioridade: '', data: true },
  };
}

// Converte um fechamento de texto (semanal/mensal/metas) num modelo editável.
function _infModeloDeFechamento(tipo) {
  const f = _fechGetFields(tipo);
  const pal  = { semanal: 'azul', mensal: 'vermelho', metas: 'roxo' }[tipo];
  const icon = { semanal: 'calendar-week', mensal: 'box', metas: 'target-arrow' }[tipo];
  const m = _infModeloBase(f.badge);
  m.cores = { ..._INF_PALETAS[pal] };
  m.selo = { mostrar: true, texto: f.badge, icone: icon };
  m.titulo = f.title;
  m.contexto = { mostrar: true, texto: f.meta };
  m.blocos = [
    { tipo: 'texto', texto: f.intro, estilo: 'destaque' }, { tipo: 'espaco' },
    { tipo: 'titulo', texto: f.listlabel },
    { tipo: 'lista', itens: [...f.items], estilo: 'numerada' }, { tipo: 'espaco' },
    ...f.alerts.map(a => ({ tipo: 'alerta', texto: a, tom: 'atencao' })),
  ];
  m.rodape = { mostrar: true, rotulo: 'Estoque / Insumos', prioridade: _fechConfig[tipo].priority, data: true };
  return m;
}

// ── Estado + persistência (localStorage, como os fechamentos) ──
let _inf = null; // { modelos: [], atual: id }

function _infLoad() {
  if (_inf) return _inf;
  try { _inf = JSON.parse(localStorage.getItem(_INF_KEY) || 'null'); } catch (e) { _inf = null; }
  if (!_inf || !Array.isArray(_inf.modelos) || !_inf.modelos.length) {
    const m = _infModeloBase('Meu primeiro informativo');
    _inf = { modelos: [m], atual: m.id };
  }
  return _inf;
}

let _infSaveTimer = null;
function _infSave() {
  clearTimeout(_infSaveTimer);
  _infSaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(_INF_KEY, JSON.stringify(_inf));
      const ind = document.getElementById('inf-saved-indicator');
      if (ind) { ind.style.opacity = '1'; setTimeout(() => ind.style.opacity = '0', 1500); }
    } catch (e) {}
  }, 400);
}

function _infAtual() {
  const s = _infLoad();
  return s.modelos.find(m => m.id === s.atual) || s.modelos[0];
}

// ── Tokens de data: {hoje} {mes} {Mes} {ano} {corte} ──
function _infTokens(txt) {
  if (!txt) return '';
  const now = new Date();
  const corte = _fechLastWorkdayOfMonth(now.getFullYear(), now.getMonth());
  return String(txt)
    .replace(/\{hoje\}/g, _fechFmtDate(now))
    .replace(/\{mes\}/g, _fechNomeMes(now))
    .replace(/\{Mes\}/g, _fechNomeMesTitulo(now))
    .replace(/\{ano\}/g, now.getFullYear())
    .replace(/\{corte\}/g, _fechFmtDate(corte));
}
const _infT = txt => escapeHtml(_infTokens(txt));

// Ícone: nome Tabler (a-z, 0-9, -) vira <i class="ti">; qualquer outra coisa é tratada como emoji/texto.
function _infIconeHtml(icone) {
  const v = (icone || '').trim();
  if (!v) return '';
  return /^[a-z0-9-]+$/.test(v) ? `<i class="ti ti-${v}"></i>` : `<span class="inf-emoji">${escapeHtml(v)}</span>`;
}

function _infEhClaro(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return false;
  const n = parseInt(m[1], 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 150;
}

const _INF_TONS = { atencao: null, perigo: '#ef4444', info: 'accent', sucesso: '#22c55e' };

// ── HTML do cartão (usado no preview e na impressão) ──
function _infCardHtml(m) {
  const c = m.cores;
  const stripe = { listrada: 'is-listrada', gradiente: 'is-gradiente' }[c.stripe] || '';
  const style = `--inf-accent:${c.accent};--inf-bg:${c.bg};--inf-fg:${c.fg};--inf-alert:${c.alert};--inf-on-accent:${_infEhClaro(c.accent) ? '#1a1305' : '#fff'}`;

  const blocos = m.blocos.map(b => {
    switch (b.tipo) {
      case 'texto':
        return (b.texto || '').trim() ? `<div class="${b.estilo === 'simples' ? 'inf-p' : 'ln'}">${_infT(b.texto)}</div>` : '';
      case 'titulo':
        return (b.texto || '').trim() ? `<div><div class="caps">${_infT(b.texto)}</div></div>` : '';
      case 'lista': {
        const itens = (b.itens || []).filter(i => i.trim());
        if (!itens.length) return '';
        const marca = (i) => b.estilo === 'numerada' ? String(i + 1).padStart(2, '0')
          : b.estilo === 'check' ? '<i class="ti ti-check"></i>' : '<i class="ti ti-point-filled"></i>';
        return `<div class="fech-items-list">${itens.map((it, i) =>
          `<div class="bullet"><span class="dot">${marca(i)}</span><span>${_infT(it)}</span></div>`).join('')}</div>`;
      }
      case 'alerta': {
        if (!(b.texto || '').trim()) return '';
        const tom = _INF_TONS[b.tom];
        const cor = tom === 'accent' ? 'var(--inf-accent)' : (tom || 'var(--inf-alert)');
        const ic = { perigo: 'alert-octagon', info: 'info-circle', sucesso: 'circle-check' }[b.tom] || 'alert-triangle';
        return `<div class="stop-box inf-alert" style="--inf-tone:${cor}"><i class="ti ti-${ic}"></i><span>${_infT(b.texto)}</span></div>`;
      }
      case 'destaque':
        return `<div class="inf-destaque"><div class="inf-destaque-valor">${_infT(b.valor)}</div>${(b.legenda || '').trim() ? `<div class="inf-destaque-legenda">${_infT(b.legenda)}</div>` : ''}</div>`;
      case 'divisoria': return '<div class="inf-hr"></div>';
      case 'espaco':    return '<div class="spacer"></div>';
      default: return '';
    }
  }).join('');

  const r = m.rodape;
  return `<div class="fech-card inf-card ${_infEhClaro(c.bg) ? 'is-claro' : ''}" style="${style}">
    <div class="fech-card-stripe ${stripe}"></div>
    ${m.logo ? `<div class="fech-card-logo-strip"><img src="${_INF_LOGO}" alt="Concrelagos Concreto"></div>` : ''}
    <div class="fech-card-head" style="text-align:${m.alinhamento === 'left' ? 'left' : 'center'}">
      ${m.selo.mostrar ? `<div class="fech-card-badge"><span class="fech-card-badge-icon">${_infIconeHtml(m.selo.icone)}</span><span>${_infT(m.selo.texto)}</span></div>` : ''}
      ${(m.titulo || '').trim() ? `<div class="fech-card-title">${_infT(m.titulo)}</div>` : ''}
    </div>
    ${m.contexto.mostrar && (m.contexto.texto || '').trim() ? `<div class="fech-card-meta">${_infT(m.contexto.texto)}</div>` : ''}
    <div class="fech-card-divider"></div>
    <div class="fech-card-body inf-body">${blocos}</div>
    ${r.mostrar ? `<div class="fech-card-foot">
      <span class="fech-foot-label">${_infT(r.rotulo)}</span>
      ${(r.prioridade || '').trim() ? `<span class="fech-foot-priority"><i class="ti ti-plus"></i>${_infT(r.prioridade)}</span>` : ''}
      ${r.data ? `<span class="fech-foot-date">${_fechFmtDate(new Date())}</span>` : ''}
    </div>` : ''}
  </div>`;
}

function _infRenderPreview() {
  const wrap = document.getElementById('inf-preview');
  if (wrap) wrap.innerHTML = _infCardHtml(_infAtual());
}

// Mudança de conteúdo: repinta o preview e salva (sem redesenhar o formulário → não perde o foco).
function _infChanged() { _infRenderPreview(); _infSave(); }

// ── Formulário ──────────────────────────────────────────────
const _infA = s => escapeHtml(s == null ? '' : String(s)); // atributo/valor

function _infRenderModelos() {
  const s = _infLoad();
  const sel = document.getElementById('inf-modelo-sel');
  if (sel) sel.innerHTML = s.modelos.map(m =>
    `<option value="${m.id}" ${m.id === s.atual ? 'selected' : ''}>${_infA(m.nome)}</option>`).join('');
}

function _infRenderForm() {
  const m = _infAtual();
  const c = m.cores;
  const el = document.getElementById('inf-form');
  if (!el) return;

  const paletas = Object.entries(_INF_PALETAS).map(([k, p]) =>
    `<button class="inf-paleta" title="${k}" style="background:${p.bg};border-color:${p.accent}" onclick="infAplicarPaleta('${k}')"><span style="background:${p.accent}"></span></button>`).join('');
  const icones = _INF_ICONES.map(i =>
    `<button class="fech-icon-btn ${m.selo.icone === i ? 'is-on' : ''}" title="${i}" onclick="infSet('selo.icone','${i}');_infRenderForm()"><i class="ti ti-${i}"></i></button>`).join('');
  const cor = (k, label) => `<label class="inf-cor"><input type="color" value="${_infA(c[k])}" oninput="infSet('cores.${k}', this.value)"><span>${label}</span></label>`;
  const chk = (path, val, label) => `<label class="inf-chk"><input type="checkbox" ${val ? 'checked' : ''} onchange="infSet('${path}', this.checked);_infRenderForm()"> ${label}</label>`;
  const txt = (path, val, ph = '') => `<input type="text" value="${_infA(val)}" placeholder="${_infA(ph)}" oninput="infSet('${path}', this.value)">`;
  const opt = (path, val, opts) => `<select class="cub-select" onchange="infSet('${path}', this.value)">${opts.map(([v, l]) => `<option value="${v}" ${val === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;

  el.innerHTML = `
    <div class="inf-sec-title"><span><i class="ti ti-palette"></i> Visual</span></div>
    <div class="fech-field"><label>Paletas prontas</label><div class="inf-paletas">${paletas}</div></div>
    <div class="fech-field"><label>Cores</label><div class="inf-cores">
      ${cor('accent', 'Destaque')}${cor('bg', 'Fundo')}${cor('fg', 'Texto')}${cor('alert', 'Alerta')}
    </div></div>
    <div class="fech-field"><label>Faixa do topo</label>${opt('cores.stripe', c.stripe, [['solida', 'Sólida'], ['listrada', 'Listrada'], ['gradiente', 'Gradiente']])}</div>

    <div class="fech-field-divider"></div>
    <div class="inf-sec-title"><span><i class="ti ti-layout-navbar"></i> Cabeçalho</span></div>
    <div class="fech-field">${chk('logo', m.logo, 'Mostrar logo')}</div>
    <div class="fech-field">
      <div class="inf-field-head"><label>Selo</label>${chk('selo.mostrar', m.selo.mostrar, 'mostrar')}</div>
      ${m.selo.mostrar ? `${txt('selo.texto', m.selo.texto, 'Texto do selo')}
      <div class="inf-icones">${icones}</div>
      <input type="text" value="${_infA(m.selo.icone)}" placeholder="Nome Tabler (ex: truck) ou emoji 🚚" onchange="infSet('selo.icone', this.value.trim());_infRenderForm()">
      <div class="fech-field-hint">Qualquer ícone de tabler.io/icons (só o nome) ou um emoji.</div>` : ''}
    </div>
    <div class="fech-field"><label>Título</label>${txt('titulo', m.titulo)}</div>
    <div class="fech-field"><label>Alinhamento do cabeçalho</label>${opt('alinhamento', m.alinhamento, [['center', 'Centralizado'], ['left', 'À esquerda']])}</div>
    <div class="fech-field">
      <div class="inf-field-head"><label>Linha de contexto</label>${chk('contexto.mostrar', m.contexto.mostrar, 'mostrar')}</div>
      ${m.contexto.mostrar ? txt('contexto.texto', m.contexto.texto) : ''}
    </div>

    <div class="fech-field-divider"></div>
    <div class="inf-sec-title"><span><i class="ti ti-stack-2"></i> Blocos</span></div>
    <div class="inf-blocos">${m.blocos.map((b, i) => _infBlocoForm(b, i, m.blocos.length)).join('')}</div>
    <div class="inf-add-grid">${Object.entries(_INF_BLOCOS).map(([k, d]) =>
      `<button class="fech-add-btn" onclick="infAddBloco('${k}')"><i class="ti ti-${d.icon}"></i> ${d.label}</button>`).join('')}</div>
    <div class="fech-field-hint">Atalhos de data em qualquer texto: <code>{hoje}</code> <code>{mes}</code> <code>{Mes}</code> <code>{ano}</code> <code>{corte}</code> (último dia útil do mês).</div>

    <div class="fech-field-divider"></div>
    <div class="inf-sec-title"><span><i class="ti ti-layout-bottombar"></i> Rodapé</span>${chk('rodape.mostrar', m.rodape.mostrar, 'mostrar')}</div>
    ${m.rodape.mostrar ? `
    <div class="fech-field"><label>Rótulo</label>${txt('rodape.rotulo', m.rodape.rotulo)}</div>
    <div class="fech-field"><label>Prioridade (opcional)</label>${txt('rodape.prioridade', m.rodape.prioridade, 'Ex: Prioridade máxima')}</div>
    <div class="fech-field">${chk('rodape.data', m.rodape.data, 'Mostrar data de hoje')}</div>` : ''}
  `;
}

function _infBlocoForm(b, i, total) {
  const d = _INF_BLOCOS[b.tipo];
  const set = (k) => `infSetBloco(${i}, '${k}', this.value)`;
  let corpo = '';
  if (b.tipo === 'texto') corpo = `
    <textarea oninput="${set('texto')}">${_infA(b.texto)}</textarea>
    <select class="cub-select" onchange="${set('estilo')}">
      <option value="destaque" ${b.estilo !== 'simples' ? 'selected' : ''}>Com barra de destaque</option>
      <option value="simples" ${b.estilo === 'simples' ? 'selected' : ''}>Parágrafo simples</option>
    </select>`;
  else if (b.tipo === 'titulo') corpo = `<input type="text" value="${_infA(b.texto)}" oninput="${set('texto')}">`;
  else if (b.tipo === 'alerta') corpo = `
    <textarea oninput="${set('texto')}">${_infA(b.texto)}</textarea>
    <select class="cub-select" onchange="${set('tom')}">
      ${[['atencao', 'Atenção (cor de alerta)'], ['perigo', 'Perigo (vermelho)'], ['info', 'Informação (cor de destaque)'], ['sucesso', 'Sucesso (verde)']]
        .map(([v, l]) => `<option value="${v}" ${b.tom === v ? 'selected' : ''}>${l}</option>`).join('')}
    </select>`;
  else if (b.tipo === 'destaque') corpo = `
    <input type="text" value="${_infA(b.valor)}" placeholder="Valor (ex: 95%)" oninput="${set('valor')}">
    <input type="text" value="${_infA(b.legenda)}" placeholder="Legenda" oninput="${set('legenda')}">`;
  else if (b.tipo === 'lista') corpo = `
    <select class="cub-select" onchange="${set('estilo')}">
      ${[['numerada', 'Numerada'], ['marcador', 'Marcadores'], ['check', 'Check']]
        .map(([v, l]) => `<option value="${v}" ${b.estilo === v ? 'selected' : ''}>${l}</option>`).join('')}
    </select>
    ${(b.itens || []).map((it, j) => `<div class="fech-list-row">
      <input type="text" value="${_infA(it)}" oninput="infSetItem(${i}, ${j}, this.value)">
      <button class="fech-icon-btn" onclick="infRemItem(${i}, ${j})" title="Remover item"><i class="ti ti-x"></i></button>
    </div>`).join('')}
    <button class="fech-add-btn" onclick="infAddItem(${i})"><i class="ti ti-plus"></i> Item</button>`;

  return `<div class="inf-bloco">
    <div class="inf-bloco-head">
      <span><i class="ti ti-${d.icon}"></i> ${d.label}</span>
      <span class="inf-bloco-acoes">
        <button class="fech-icon-btn" ${i === 0 ? 'disabled' : ''} onclick="infMoverBloco(${i}, -1)" title="Subir"><i class="ti ti-arrow-up"></i></button>
        <button class="fech-icon-btn" ${i === total - 1 ? 'disabled' : ''} onclick="infMoverBloco(${i}, 1)" title="Descer"><i class="ti ti-arrow-down"></i></button>
        <button class="fech-icon-btn" onclick="infDuplicarBloco(${i})" title="Duplicar"><i class="ti ti-copy"></i></button>
        <button class="fech-icon-btn" onclick="infRemBloco(${i})" title="Remover"><i class="ti ti-trash"></i></button>
      </span>
    </div>
    ${corpo ? `<div class="inf-bloco-body">${corpo}</div>` : ''}
  </div>`;
}

function _infRenderTudo() { _infRenderModelos(); _infRenderForm(); _infRenderPreview(); }

// ── Ações: campos ───────────────────────────────────────────
function infSet(path, val) {
  const ks = path.split('.');
  let o = _infAtual();
  ks.slice(0, -1).forEach(k => { o = o[k]; });
  o[ks[ks.length - 1]] = val;
  _infChanged();
}
function infAplicarPaleta(k) { _infAtual().cores = { ..._INF_PALETAS[k] }; _infRenderForm(); _infChanged(); }

// ── Ações: blocos ───────────────────────────────────────────
const _infBlocos = () => _infAtual().blocos;
function _infEstrutura() { _infRenderForm(); _infChanged(); }
function infSetBloco(i, k, v) { _infBlocos()[i][k] = v; _infChanged(); }
function infAddBloco(tipo) { _infBlocos().push(_infNovoBloco(tipo)); _infEstrutura(); }
function infRemBloco(i) { _infBlocos().splice(i, 1); _infEstrutura(); }
function infDuplicarBloco(i) { const bs = _infBlocos(); bs.splice(i + 1, 0, JSON.parse(JSON.stringify(bs[i]))); _infEstrutura(); }
function infMoverBloco(i, d) {
  const bs = _infBlocos(), j = i + d;
  if (j < 0 || j >= bs.length) return;
  [bs[i], bs[j]] = [bs[j], bs[i]];
  _infEstrutura();
}
function infSetItem(i, j, v) { _infBlocos()[i].itens[j] = v; _infChanged(); }
function infAddItem(i) { _infBlocos()[i].itens.push('Novo item'); _infEstrutura(); }
function infRemItem(i, j) { _infBlocos()[i].itens.splice(j, 1); _infEstrutura(); }

// ── Ações: modelos ──────────────────────────────────────────
function infSelecionarModelo(id) { _infLoad().atual = id; _infSave(); _infRenderTudo(); }

function infNovoModelo(origem) {
  const s = _infLoad();
  const m = origem && origem !== 'branco' ? _infModeloDeFechamento(origem) : _infModeloBase();
  const nome = prompt('Nome do novo informativo:', m.nome);
  if (nome === null) return;
  m.nome = nome.trim() || m.nome;
  s.modelos.push(m);
  s.atual = m.id;
  _infSave(); _infRenderTudo();
}
function infDuplicarModelo() {
  const s = _infLoad();
  const m = JSON.parse(JSON.stringify(_infAtual()));
  m.id = _infId(); m.nome += ' (cópia)';
  s.modelos.push(m); s.atual = m.id;
  _infSave(); _infRenderTudo();
}
function infRenomearModelo() {
  const m = _infAtual();
  const nome = prompt('Novo nome:', m.nome);
  if (!nome || !nome.trim()) return;
  m.nome = nome.trim();
  _infSave(); _infRenderModelos();
}
function infExcluirModelo() {
  const s = _infLoad();
  const m = _infAtual();
  if (!confirm(`Excluir o informativo "${m.nome}"?`)) return;
  s.modelos = s.modelos.filter(x => x.id !== m.id);
  if (!s.modelos.length) s.modelos.push(_infModeloBase());
  s.atual = s.modelos[0].id;
  _infSave(); _infRenderTudo();
}

// ── Abrir ───────────────────────────────────────────────────
function abrirInformativos() {
  closeToolsMenu();
  requestAnimationFrame(() => { openModal('modal-informativo'); _infRenderTudo(); });
}

// ── Exportações ─────────────────────────────────────────────
// WhatsApp: *negrito* nos títulos, • nos itens, ⚠️ nos alertas.
function _infTextoPlano(m) {
  const out = [];
  if (m.selo.mostrar && m.selo.texto.trim()) out.push(`*${_infTokens(m.selo.texto).toUpperCase()}*`);
  if (m.titulo.trim()) out.push(`*${_infTokens(m.titulo)}*`);
  if (m.contexto.mostrar && m.contexto.texto.trim()) out.push(`_${_infTokens(m.contexto.texto)}_`);
  const partes = [out.join('\n')];
  m.blocos.forEach(b => {
    if (b.tipo === 'texto' && b.texto.trim()) partes.push(_infTokens(b.texto.trim()));
    else if (b.tipo === 'titulo' && b.texto.trim()) partes.push(`*${_infTokens(b.texto.trim())}*`);
    else if (b.tipo === 'lista') {
      const it = b.itens.filter(x => x.trim());
      if (it.length) partes.push(it.map((x, i) => (b.estilo === 'numerada' ? `${i + 1}. ` : b.estilo === 'check' ? '✅ ' : '• ') + _infTokens(x.trim())).join('\n'));
    }
    else if (b.tipo === 'alerta' && b.texto.trim()) partes.push(({ perigo: '🛑 ', info: 'ℹ️ ', sucesso: '✅ ' }[b.tom] || '⚠️ ') + `*${_infTokens(b.texto.trim())}*`);
    else if (b.tipo === 'destaque') partes.push(`*${_infTokens(b.valor)}*${b.legenda.trim() ? ' — ' + _infTokens(b.legenda) : ''}`);
    else if (b.tipo === 'divisoria') partes.push('───────────');
  });
  return partes.filter(p => p.trim()).join('\n\n');
}

function infCopiarWhatsapp() {
  const text = _infTextoPlano(_infAtual());
  navigator.clipboard?.writeText(text)
    .then(() => toast('Texto copiado! Cole direto no WhatsApp.'))
    .catch(() => toast('Não foi possível copiar', 'error'));
}

// Impressão: abre o cartão numa janela com as mesmas folhas de estilo da aplicação.
function infImprimir() {
  const m = _infAtual();
  const css = [...document.querySelectorAll('link[rel="stylesheet"]')].map(l => `<link rel="stylesheet" href="${l.href}">`).join('');
  const w = window.open('', '_blank');
  if (!w) { toast('Permita pop-ups para imprimir', 'error'); return; }
  w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${escapeHtml(m.nome)}</title>${css}
    <style>body{background:#fff;display:flex;justify-content:center;padding:24px;margin:0}
    .fech-card{box-shadow:none;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    @media print{body{padding:0}}</style></head>
    <body>${_infCardHtml(m)}<script>window.onload=()=>setTimeout(()=>window.print(),400)<\/script></body></html>`);
  w.document.close();
}

// Imagem: DOM → PNG via html-to-image (carregado sob demanda, só nesta ação).
// ponytail: depende do CDN e de CORS do logo; se o logo falhar, sai sem logo (placeholder transparente).
let _infH2I = null;
function _infCarregarH2I() {
  if (window.htmlToImage) return Promise.resolve(window.htmlToImage);
  if (_infH2I) return _infH2I;
  _infH2I = new Promise((ok, err) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/dist/html-to-image.js';
    s.onload = () => ok(window.htmlToImage);
    s.onerror = () => { _infH2I = null; err(new Error('Falha ao carregar gerador de imagem')); };
    document.head.appendChild(s);
  });
  return _infH2I;
}

async function infGerarImagem() {
  const card = document.querySelector('#inf-preview .fech-card');
  if (!card) return;
  toast('Gerando imagem…');
  try {
    const h2i = await _infCarregarH2I();
    const url = await h2i.toPng(card, {
      pixelRatio: 2, cacheBust: true,
      imagePlaceholder: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
    });
    const a = document.createElement('a');
    a.download = (_infAtual().nome || 'informativo').replace(/[^\w\-À-ú ]+/g, '').trim() + '.png';
    a.href = url;
    a.click();
    toast('Imagem gerada!');
  } catch (e) {
    console.error(e);
    toast('Não foi possível gerar a imagem', 'error');
  }
}

Object.assign(window, {
  abrirInformativos, infSet, infAplicarPaleta, infSetBloco, infAddBloco, infRemBloco, infDuplicarBloco,
  infMoverBloco, infSetItem, infAddItem, infRemItem, infSelecionarModelo, infNovoModelo, infDuplicarModelo,
  infRenomearModelo, infExcluirModelo, infCopiarWhatsapp, infImprimir, infGerarImagem, _infRenderForm,
});
