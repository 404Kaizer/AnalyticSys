'use strict';

// ═══════════════════════════════════════════════════════════
// SOLICITAÇÕES — tela do analista para o formulário público
// ═══════════════════════════════════════════════════════════
// Cada envio de solicitacao.html vira registros em public.solicitacoes
// (um por categoria de material, user_id = analista da categoria — ver a
// Edge Function solicitacao-dai). RLS: o analista vê os seus, o ADM vê
// todos. O analista só altera o andamento (status/observação) — o
// conteúdo declarado é imutável (grant de UPDATE só nessas colunas).
//
// Também publica, a partir das Entradas do ADM (que vivem só no
// IndexedDB dele), a lista de fornecedores de agregados usada pela
// cubagem no formulário (tabela solicitacao_fornecedores).
// ═══════════════════════════════════════════════════════════

const SOL_STATUS = {
  pendente:   { label: 'Pendente',   badge: 'badge-amber' },
  em_analise: { label: 'Em análise', badge: 'badge-blue' },
  concluida:  { label: 'Concluída',  badge: 'badge-green' },
  recusada:   { label: 'Recusada',   badge: 'badge-red' },   // legado (Recusar saiu em 13/11/2026)
  excluida:   { label: 'Excluído',   badge: 'badge-red' },
};
// Cubagem é só registro: sem status nem andamento (13/11/2026). O banco
// grava 'pendente' por padrão — a tela ignora.
const SOL_CUBAGEM = 'Cubagem de agregados';
const _solSemStatus = (s) => s.categoria_situacao === SOL_CUBAGEM;
const _solAtivo = (s) => s.status !== 'excluida';
const _solAberta = (s) => !_solSemStatus(s) && (s.status === 'pendente' || s.status === 'em_analise');
const SOL_FILTROS = [
  ['abertas', 'Abertas', _solAberta],
  ['pendente', 'Pendentes', (s) => s.status === 'pendente'],
  ['em_analise', 'Em análise', (s) => s.status === 'em_analise'],
  ['concluida', 'Concluídas', (s) => s.status === 'concluida'],
  ['todas', 'Todas', _solAtivo],
  ['excluida', 'Excluídos', (s) => s.status === 'excluida'],
];
const SOL_FILTROS_CUBAGEM = [
  ['todas', 'Registros', _solAtivo],
  ['excluida', 'Excluídos', (s) => s.status === 'excluida'],
];
const SOL_CATEGORIAS_AGREGADO = ['Agregado Graúdo', 'Agregado Miúdo'];

const _sol = {
  lista: [], tipo: 'procedimento', proc: 'cubagem', filtro: 'abertas', busca: '', carregando: false, erro: '', abertaId: null,
};

const _solEsc = (s) => escapeHtml(String(s ?? ''));
const _solNum = (n, casas = 2) => (n === null || n === undefined || !Number.isFinite(Number(n)))
  ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: casas });
const _solKg = (n) => (n === null || n === undefined) ? '—' : _solNum(n) + ' kg';
const _solData = (v) => {
  if (!v) return '—';
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? fmtDateBR(s.slice(0, 10)) : s;
};
const _solDataHora = (v) => v ? new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const _solNorm = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
const _solNfKey = (v) => String(v ?? '').replace(/\D/g, '').replace(/^0+/, '');
const _solVar = (kg, pct, unidade) => {
  if (kg === null || kg === undefined || pct === null || pct === undefined) return '—';
  const sinal = kg >= 0 ? '+' : '';
  const cor = Math.abs(pct) >= 1 ? 'var(--amber)' : 'var(--text)';
  return `<span style="color:${cor}">${sinal}${_solNum(pct)}% (${sinal}${_solNum(kg)} ${unidade || 'kg'})</span>`;
};

// ── Tipos e colunas ──────────────────────────────────────────────────
// Colunas: [título, (solicitação, item) => html, alinhar à direita?, nível].
// Coluna com nível some quando o valor já está fixo (caminho da lista ou
// filtro da barra com um valor só) — ver solRender.
// Nos procedimentos a tabela tem uma linha por item (carreta, teste…).
const _SOL_C = {
  protocolo: ['Protocolo', (s) => `<span style="font-family:var(--mono);font-size:11.5px">${_solEsc(s.protocolo)}</span>`],
  recebida: ['Recebida', (s) => _solDataHora(s.created_at)],
  ocorrido: ['Ocorrido', (s) => _solData(s.data_ocorrido)],
  central: ['Central', (s) => _solEsc(s.central), false, 'central'],
  analista: ['Analista', (s) => _solEsc(_solAnalista(s))],
  status: ['Status', (s) => {
    const st = SOL_STATUS[s.status] || SOL_STATUS.pendente;
    return `<span class="badge ${st.badge}">${st.label}</span>${s.sem_comprovante ? ' <i class="ti ti-paperclip-off" style="color:var(--amber)" title="Sem comprovante anexado"></i>' : ''}`;
  }],
};
const { protocolo: _cP, recebida: _cR, ocorrido: _cO, central: _cC, analista: _cA, status: _cS } = _SOL_C;
// Procedimentos operacionais: [chave, rótulo, situação, ícone, colunas].
// Mesma divisão dos <optgroup> de solicitacao.html; o resto é movimentação.
// ponytail: tipo derivado do texto da situação no cliente (sem coluna no
// banco) — se precisar de filtro no servidor, vira coluna `tipo`.
const SOL_PROC = [
  ['cubagem', 'Cubagem', 'Cubagem de agregados', 'ti-box', [_cP, _cR, _cC,
    ['Material', (s, i) => _solEsc(i.grupoMaterial), false, 'material'],
    ['Fornecedor', (s, i) => _solEsc(i.fornecedor), false, 'fornecedor'],
    ['Documento', (s, i) => i.nf ? `${i.docTipo === 'TICKET' ? 'Ticket' : 'NF'} ${_solEsc(i.nf)}` : '—'],
    ['Recebimento', (s, i) => _solData(i.dataRecebimento)],
    ['Documento (kg)', (s, i) => _solNum(i.nfKg), true],
    ['Aferido (kg)', (s, i) => _solNum(i.aferidoKg), true],
    ['Variação', (s, i) => _solVar(i.variacaoKg, i.variacaoPct), true],
    _cA]],
  ['canto', 'Teste de canto', 'Teste de canto', 'ti-scale', [_cP, _cR, _cO, _cC,
    ['Categoria', (s, i) => _solEsc(i.categoriaMaterial)],
    ['Referência', (s, i) => `${_solNum(i.referencia)} ${_solEsc(i.unidade)}`, true],
    ['Média', (s, i) => `${_solNum(i.media)} ${_solEsc(i.unidade)}`, true],
    ['Variação', (s, i) => _solVar(i.variacaoAbs, i.variacaoPct, i.unidade), true],
    _cA, _cS]],
  ['pesagem', 'Pesagem manual', 'Pesagem manual (fora da automação)', 'ti-weight', [_cP, _cR, _cO, _cC,
    ['Material', (s, i) => _solEsc(i.grupoMaterial), false, 'material'],
    ['Quantidade', (s, i) => `${_solNum(i.peso)} ${_solEsc(i.unidade || 'kg')}`, true],
    _cA, _cS]],
];
const SOL_COLS_MOV = [_cP, _cR, _cO, _cC,
  ['Situação', (s) => _solEsc(s.categoria_situacao) + (s.motivo ? ` <span style="color:var(--text3)">· ${_solEsc(s.motivo)}</span>` : '')],
  ['Categoria', (s) => _solEsc(s.categoria)],
  _cA, _cS];
const SOL_PROCEDIMENTOS = new Set(SOL_PROC.map((p) => p[2]));
const SOL_TIPOS = [
  ['procedimento', 'Procedimentos operacionais', 'ti-clipboard-check', (s) => SOL_PROCEDIMENTOS.has(s.categoria_situacao)],
  ['movimentacao', 'Movimentações de estoque', 'ti-arrows-exchange', (s) => !SOL_PROCEDIMENTOS.has(s.categoria_situacao)],
];
const _solProcAtual = () => SOL_PROC.find(([k]) => k === _sol.proc) || SOL_PROC[0];

// ── Carga ────────────────────────────────────────────────────────────
// Carga completa ao abrir a página; depois disso, solRealtimeInit mantém a
// lista viva (INSERT/UPDATE chegam sem recarregar — RLS filtra o que cada
// um recebe, igual ao SELECT).
// Reaproveita a carga em andamento (solAbrir vindo do sininho espera por ela).
function solCarregar() {
  if (!window.supabaseClient) return Promise.resolve();
  return _sol.carga || (_sol.carga = _solCarregar().finally(() => { _sol.carga = null; }));
}
async function _solCarregar() {
  _sol.carregando = true;
  _sol.erro = '';
  solRender();
  const { data, error } = await window.supabaseClient.from('solicitacoes')
    .select('*').order('created_at', { ascending: false }).limit(1000);
  _sol.carregando = false;
  if (error) {
    console.error('[Solicitações] Falha ao carregar:', error);
    _sol.erro = error.message || 'Falha ao carregar.';
  } else {
    _sol.lista = data || [];
    // analista_nome guarda o pedaço do e-mail (ver adminSalvarAnalistaCategoria)
    // — mostra o nome de exibição do perfil, quando houver.
    await _solCarregarNomes(_sol.lista.map((s) => s.user_id));
  }
  solRender();
  _solAtualizarBadge();
}

// Bolinha na aba Registros = registros pendentes (ainda não iniciados) que
// este usuário enxerga (RLS). Contagem sem trazer linhas.
async function _solAtualizarBadge() {
  const el = document.getElementById('sol-tab-badge');
  if (!el || !window.supabaseClient) return;
  const { count, error } = await window.supabaseClient.from('solicitacoes')
    .select('id', { count: 'exact', head: true }).eq('status', 'pendente').neq('categoria_situacao', SOL_CUBAGEM);
  if (error) return;
  el.textContent = count > 99 ? '99+' : String(count || 0);
  el.style.display = count ? '' : 'none';
}

async function _solCarregarNomes(userIds) {
  if (!_sol.nomes) _sol.nomes = new Map();
  const ids = [...new Set(userIds)].filter((id) => id && !_sol.nomes.has(id));
  if (!ids.length) return;
  const { data: perfis } = await window.supabaseClient.from('profiles').select('id, nome_exibicao').in('id', ids);
  (perfis || []).forEach((p) => _sol.nomes.set(p.id, p.nome_exibicao || ''));
}

const _solAnalista = (s) => _sol.nomes?.get(s.user_id) || s.analista_nome || '—';
window.solCarregar = solCarregar;

// ── Tempo real ───────────────────────────────────────────────────────
// Assinado no boot (analitico.js), então a lista já está viva quando a
// página abre. Exige a tabela na publicação supabase_realtime (migração
// 20261113_solicitacoes_realtime.sql).
let _solChannel = null;
function solRealtimeInit() {
  if (!window.supabaseClient || !window.currentUser || _solChannel) return;
  _solAtualizarBadge();
  const handle = async (row, tipo) => {
    if (!row?.id) return;
    await _solCarregarNomes([row.user_id]);
    const idx = _sol.lista.findIndex((s) => s.id === row.id);
    if (idx >= 0) _sol.lista[idx] = row;
    else _sol.lista.unshift(row);
    _sol.lista.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    solRender();
    _solAtualizarBadge();
    if (tipo === 'INSERT') {
      if (typeof notifPushRegistro === 'function') notifPushRegistro(row);
      else if (typeof toast === 'function') toast(`Novo registro ${row.protocolo} — ${row.categoria_situacao}.`, 'success');
    }
    // Detalhe aberto da mesma solicitação: atualiza só o selo de status
    // (re-renderizar o modal apagaria a observação sendo digitada).
    if (tipo === 'UPDATE' && _sol.abertaId === row.id) {
      const st = SOL_STATUS[row.status] || SOL_STATUS.pendente;
      const badge = document.querySelector('#sol-modal-title .badge');
      if (badge) { badge.className = 'badge ' + st.badge; badge.textContent = st.label; }
    }
  };
  _solChannel = window.supabaseClient
    .channel('solicitacoes_realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'solicitacoes' }, (p) => handle(p.new, 'INSERT'))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'solicitacoes' }, (p) => handle(p.new, 'UPDATE'))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'solicitacoes' }, (p) => {
      _sol.lista = _sol.lista.filter((s) => s.id !== p.old?.id); // "Apagar excluídos de vez" em outra sessão
      solRender();
    })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.warn('[Solicitações] Canal Realtime com problema:', status);
    });
}
window.solRealtimeInit = solRealtimeInit;

pageRenderers.solicitacoes = () => { solCarregar(); };

// Ferramentas ▸ Link do Registro Operacional: o formulário fica na mesma
// pasta do app — resolve relativo à URL atual, sem host fixo.
function solCopiarLinkFormulario() {
  const link = new URL('solicitacao.html', window.location.href).href;
  navigator.clipboard?.writeText(link)
    .then(() => toast('Link do Registro Operacional copiado.', 'success'))
    .catch(() => toast('Não foi possível copiar — link: ' + link, 'error'));
}
window.solCopiarLinkFormulario = solCopiarLinkFormulario;

function solFiltro(k) { _sol.filtro = k; _solFecharStatus(); solRender(); }
window.solFiltro = solFiltro;

// Trocar de tipo volta para "Abertas" (a cubagem cai em "Registros" sozinha)
// e limpa a seleção da lista.
function solTipo(k) { _sol.tipo = k; _sol.filtro = 'abertas'; _sol.sel = []; solRender(); }
window.solTipo = solTipo;

function solProc(k) { _sol.proc = k; _sol.filtro = 'abertas'; _sol.sel = []; solRender(); }
window.solProc = solProc;

// A busca fica no topo da lista, que é redesenhada a cada render — devolve o foco.
function solBuscar(v) {
  _sol.busca = v;
  solRender();
  const i = document.getElementById('sol-busca');
  if (i) { i.focus(); i.setSelectionRange(v.length, v.length); }
}
window.solBuscar = solBuscar;

// ── Lista à esquerda (mesmo padrão das Operações, mural-painel.js) ───
// Árvore aninhada conforme a visão; clicar num nível filtra a tabela da
// direita. Cubagem tem o nível Fornecedor antes de Material.
const SOL_NIVEIS = {
  regional: { rot: 'Regional', icon: 'ti-users-group', val: (s) => s.regional_central || '—' },
  central: { rot: 'Central', icon: 'ti-building-warehouse', val: (s) => s.central || '—' },
  fornecedor: { rot: 'Fornecedor', icon: 'ti-truck', val: (s, i) => i.fornecedor || '—' },
  material: { rot: 'Material', icon: 'ti-box', val: (s, i) => i.grupoMaterial || i.categoriaMaterial || '—' },
};
const SOL_VISOES = {
  regional: ['regional', 'central', 'fornecedor', 'material'],
  central: ['central', 'fornecedor', 'material'],
  material: ['material', 'fornecedor', 'central'],
  fornecedor: ['fornecedor', 'central', 'material'],
};
Object.assign(_sol, {
  visao: 'regional',
  sel: [], // caminho escolhido na árvore (valores, na ordem dos níveis da visão)
  listaRecolhida: (() => { try { return localStorage.getItem('sol.listaRecolhida') === '1'; } catch (_) { return false; } })(),
});
const _solEhCubagem = () => _sol.tipo === 'procedimento' && _sol.proc === 'cubagem';
const _solVisoesDoTipo = () => Object.keys(SOL_VISOES).filter((v) => v !== 'fornecedor' || _solEhCubagem());
const _solNiveis = () => {
  if (!_solVisoesDoTipo().includes(_sol.visao)) _sol.visao = 'regional';
  return SOL_VISOES[_sol.visao].filter((n) => n !== 'fornecedor' || _solEhCubagem());
};

function solVisao(v) { _sol.visao = v; _sol.sel = []; solRender(); }
window.solVisao = solVisao;
// Clicar no nível escolhido recolhe para o pai; em outro, desce até ele.
function solSel(el) {
  const d = Number(el.dataset.d), v = el.dataset.v;
  _sol.sel = (d >= 0 && _sol.sel[d] === v && _sol.sel.length === d + 1) ? _sol.sel.slice(0, d) : d < 0 ? [] : [..._sol.sel.slice(0, d), v];
  solRender();
}
window.solSel = solSel;
function solListaRecolher() {
  _sol.listaRecolhida = !_sol.listaRecolhida;
  try { localStorage.setItem('sol.listaRecolhida', _sol.listaRecolhida ? '1' : '0'); } catch (_) { /* sem storage */ }
  solRender();
}
window.solListaRecolher = solListaRecolher;

// Pares (registro, item) depois de tipo/status/busca/período e dos filtros
// da barra — base da árvore e da tabela. Registro sem item vira um par com
// item vazio. Os filtros valem por item (material/fornecedor de cada carreta).
const _solPares = () => _solFiltradas().flatMap((s) => (s.itens?.length ? s.itens : [{}]).map((i) => [s, i]))
  .filter(([s, i]) => SOL_MF.every(([k]) => !_solMF.applied[k].size || _solMF.applied[k].has(_solMFVal(k, s, i))));
const _solNoCaminho = (pares, niveis, caminho) => pares.filter(([s, i]) => caminho.every((v, d) => SOL_NIVEIS[niveis[d]].val(s, i) === v));

function _solArvoreHtml(pares, niveis, d = 0) {
  const nivel = niveis[d];
  if (!nivel) return '';
  const grupos = new Map();
  pares.forEach((p) => { const k = SOL_NIVEIS[nivel].val(...p); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(p); });
  const cub = _solEhCubagem();
  return [...grupos].sort((a, b) => b[1].length - a[1].length || String(a[0]).localeCompare(String(b[0]), 'pt-BR')).map(([valor, ps]) => {
    const aberto = _sol.sel[d] === valor;
    const sel = aberto && _sol.sel.length === d + 1;
    const apagado = _sol.sel.length > d && !aberto;
    const regs = new Set(ps.map(([s]) => s.id)).size;
    const kg = cub ? ps.reduce((t, [, i]) => t + (Number(i.variacaoKg) || 0), 0) : null;
    const filho = niveis[d + 1];
    const sub = filho
      ? `${new Set(ps.map((p) => SOL_NIVEIS[filho].val(...p))).size} ${SOL_NIVEIS[filho].rot.toLowerCase()}(s) · ${regs} registro(s)`
      : `${regs} registro(s)`;
    return `<div class="${aberto && filho ? 'mp-bloco aberto' : ''}"><button class="mp-row${sel ? ' sel' : apagado ? ' apagado' : ''}" style="padding-left:${14 + d * 16}px" data-d="${d}" data-v="${_solEsc(valor)}" onclick="solSel(this)">
      <i class="ti ti-chevron-${filho ? (aberto ? 'down' : 'right') : 'right'} mp-chev"${filho ? '' : ' style="visibility:hidden"'}></i>
      <i class="ti ${SOL_NIVEIS[nivel].icon}" style="color:var(--text3)"></i>
      <span class="mp-nome"><b>${_solEsc(valor)}</b><small>${sub}</small></span>
      ${cub ? `<span class="mp-v" style="color:${Math.abs(kg) >= 1 ? (kg < 0 ? 'var(--red)' : 'var(--amber)') : 'var(--text2)'}" title="Variação somada (aferido − documento)">${kg >= 0 ? '+' : ''}${_solNum(kg, 0)} kg</span>` : ''}
    </button>${aberto ? _solArvoreHtml(ps, niveis, d + 1) : ''}</div>`;
  }).join('');
}

function _solListaHtml(pares, niveis) {
  if (_sol.listaRecolhida) {
    return `<button class="mp-lista-abrir" onclick="solListaRecolher()" title="Mostrar a lista" aria-expanded="false">
      <i class="ti ti-layout-sidebar-left-expand"></i><span>Lista · ${new Set(pares.map(([s]) => s.id)).size} registro(s)</span></button>`;
  }
  const abertas = (fn) => _sol.lista.filter((s) => fn(s) && _solAberta(s)).length;
  const tipos = SOL_TIPOS.map(([k, rot, icon, fn]) =>
    `<button class="mo-aba${k === _sol.tipo ? ' on' : ''}" onclick="solTipo('${k}')" title="O número é de registros em aberto"><i class="ti ${icon}"></i>${rot.split(' ')[0]} <b>${abertas(fn)}</b></button>`).join('');
  const procs = _sol.tipo !== 'procedimento' ? '' : `<div class="mo-abas" role="tablist">${SOL_PROC.map(([k, rot, sit, icon]) =>
    `<button class="mo-aba${k === _sol.proc ? ' on' : ''}" onclick="solProc('${k}')"><i class="ti ${icon}"></i>${rot}${sit === SOL_CUBAGEM ? '' : ` <b>${abertas((s) => s.categoria_situacao === sit)}</b>`}</button>`).join('')}</div>`;
  const total = new Set(pares.map(([s]) => s.id)).size;
  // Como nas Operações: abas no topo; embaixo, busca + recolher.
  return `<div class="mp-lista-head">
      <div class="mo-abas" role="tablist">${tipos}</div>
      ${procs}
      <div class="mp-lista-linha">
        <label class="mp-busca"><i class="ti ti-search"></i><input id="sol-busca" type="text" placeholder="Buscar: protocolo, NF, informante…" value="${_solEsc(_sol.busca)}" oninput="solBuscar(this.value)" aria-label="Buscar registros"></label>
        <button class="mp-lista-recolher" onclick="solListaRecolher()" title="Recolher a lista para a lateral" aria-label="Recolher a lista" aria-expanded="true"><i class="ti ti-layout-sidebar-left-collapse"></i></button>
      </div>
    </div>
    <div class="mp-lista-corpo">
      <button class="mp-row${_sol.sel.length ? ' apagado' : ' sel'}" data-d="-1" data-v="" onclick="solSel(this)">
        <i class="ti ti-list mp-chev"></i><span class="mp-nome"><b>Todos</b><small>${total} registro(s) · por ${SOL_NIVEIS[niveis[0]].rot.toLowerCase()}</small></span></button>
      ${_solArvoreHtml(pares, niveis) || '<div class="empty-state" style="padding:24px"><p>Nada com esses filtros.</p></div>'}
    </div>`;
}

// ── Barra de filtros (largura toda, como nas Operações) ──────────────
// Visões · Regional · Central · Categoria · Fornecedor (cubagem) · Material ·
// Status · Período. Mesmo componente da Visão Micro / Operações / Ocorrências.
// Montada UMA vez (_solMontarEstrutura) — só lista, visões e tabela são
// redesenhadas, senão o dropdown/calendário aberto fecharia a cada render.
const SOL_MF = [
  ['regional', 'Regional', 'ti-users-group'],
  ['central', 'Central', 'ti-building-warehouse'],
  ['categoria', 'Categoria', 'ti-category'],
  ['fornecedor', 'Fornecedor', 'ti-truck'],
  ['material', 'Material', 'ti-box'],
];
const _solMFVal = (k, s, i) => k === 'categoria' ? (s.categoria || '—') : SOL_NIVEIS[k].val(s, i);
const _solMF = {
  applied: Object.fromEntries(SOL_MF.map(([k]) => [k, new Set()])),
  pending: Object.fromEntries(SOL_MF.map(([k]) => [k, new Set()])),
};

function _solMFOpcoes(k, busca = '') {
  const el = document.getElementById(`solmfo-${k}`);
  if (!el) return;
  // Opções = valores dos registros do tipo atual (antes dos filtros da barra).
  const base = _solFiltradas().flatMap((s) => (s.itens?.length ? s.itens : [{}]).map((i) => _solMFVal(k, s, i)));
  const valores = [...new Set([...base, ..._solMF.applied[k]])].sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
  const q = _solNorm(busca);
  const lista = q ? valores.filter((v) => _solNorm(v).includes(q)) : valores;
  el.innerHTML = lista.length ? lista.map((v) => `<label class="micro-filter-option">
      <input type="checkbox" value="${_solEsc(v)}" ${_solMF.pending[k].has(v) ? 'checked' : ''} onchange="_solMFMarcar('${k}', this)">
      <span class="micro-filter-option-label" title="${_solEsc(v)}">${_solEsc(v)}</span></label>`).join('')
    : '<div style="padding:12px 10px;color:var(--text3);font-size:12px;text-align:center">Nenhum resultado</div>';
}
function _solMFMarcar(k, cb) { cb.checked ? _solMF.pending[k].add(cb.value) : _solMF.pending[k].delete(cb.value); }
Object.assign(window, { _solMFOpcoes, _solMFMarcar });

function _solMFFechar(k) {
  document.getElementById(`solmfd-${k}`)?.classList.remove('open');
  document.getElementById(`solmfc-${k}`)?.classList.remove('open');
}
const _solFecharStatus = () => _solMFFechar('status');
function _solFecharTodos(exceto) {
  SOL_MF.forEach(([k]) => { if (k !== exceto) { _solMF.pending[k] = new Set(_solMF.applied[k]); _solMFFechar(k); } });
  if (exceto !== 'status') _solFecharStatus();
}
function solMFToggle(k) {
  _solFecharTodos(k);
  const aberto = document.getElementById(`solmfd-${k}`).classList.toggle('open');
  document.getElementById(`solmfc-${k}`).classList.toggle('open', aberto);
  if (aberto) {
    _solMF.pending[k] = new Set(_solMF.applied[k]);
    const busca = document.getElementById(`solmfs-${k}`);
    busca.value = '';
    _solMFOpcoes(k);
    setTimeout(() => busca.focus(), 50);
  }
}
function _solMFRotulo(k) {
  const [, rot] = SOL_MF.find(([key]) => key === k);
  const sel = _solMF.applied[k], label = document.getElementById(`solmft-${k}-label`);
  if (!label) return;
  const um = [...sel][0] || '';
  label.innerHTML = !sel.size ? rot
    : sel.size === 1 ? `${rot}: <strong>${_solEsc(um.length > 18 ? um.slice(0, 18) + '…' : um)}</strong>`
    : `${rot} <span class="micro-filter-badge">${sel.size}</span>`;
  document.getElementById(`solmft-${k}`).classList.toggle('active', sel.size > 0);
}
function solMFAplicar(k) { _solMF.applied[k] = new Set(_solMF.pending[k]); _solMFFechar(k); _solMFRotulo(k); _sol.sel = []; solRender(); }
function solMFCancelar(k) { _solMF.pending[k] = new Set(_solMF.applied[k]); _solMFFechar(k); }
function solMFLimpar(k) { _solMF.applied[k] = new Set(); _solMF.pending[k] = new Set(); _solMFFechar(k); _solMFRotulo(k); solRender(); }
function solStatusToggle() {
  _solFecharTodos('status');
  const aberto = document.getElementById('solmfd-status').classList.toggle('open');
  document.getElementById('solmfc-status').classList.toggle('open', aberto);
}
Object.assign(window, { solMFToggle, solMFAplicar, solMFCancelar, solMFLimpar, solStatusToggle });

// Clique fora fecha o dropdown aberto, descartando o que não foi aplicado.
document.addEventListener('click', (e) => {
  SOL_MF.forEach(([k]) => {
    if (document.getElementById(`solmfd-${k}`)?.classList.contains('open') && !document.getElementById(`solmfg-${k}`)?.contains(e.target)) solMFCancelar(k);
  });
  if (!document.getElementById('solmfg-status')?.contains(e.target)) _solFecharStatus();
});

function solLimparFiltros() {
  SOL_MF.forEach(([k]) => { _solMF.applied[k] = new Set(); _solMF.pending[k] = new Set(); _solMFRotulo(k); });
  if (typeof calClearRange === 'function') calClearRange('sol');
  _sol.sel = [];
  solRender();
}
window.solLimparFiltros = solLimparFiltros;

function _solMontarEstrutura(el) {
  if (document.getElementById('sol-mf-bar')) return;
  const grupo = ([k, rot, icon]) => `
    <div class="micro-filter-group" id="solmfg-${k}">
      <button class="micro-filter-trigger" id="solmft-${k}" onclick="solMFToggle('${k}')">
        <i class="ti ${icon}"></i><span id="solmft-${k}-label">${rot}</span><i class="ti ti-chevron-down micro-filter-chev" id="solmfc-${k}"></i>
      </button>
      <div class="micro-filter-dropdown" id="solmfd-${k}">
        <div class="micro-filter-search-wrap"><i class="ti ti-search"></i>
          <input class="micro-filter-search" id="solmfs-${k}" type="text" placeholder="Buscar ${rot.toLowerCase()}…" oninput="_solMFOpcoes('${k}', this.value)">
        </div>
        <div class="micro-filter-options" id="solmfo-${k}"></div>
        <div class="micro-filter-footer">
          <button class="btn btn-filter-clear" onclick="solMFLimpar('${k}')"><i class="ti ti-filter-off"></i> Limpar</button>
          <button class="btn" onclick="solMFCancelar('${k}')"><i class="ti ti-x"></i> Cancelar</button>
          <button class="btn btn-primary" onclick="solMFAplicar('${k}')"><i class="ti ti-check"></i> Aplicar</button>
        </div>
      </div>
    </div>`;
  el.innerHTML = `<div class="oc-toolbar">
      <div class="micro-filter-bar" id="sol-mf-bar" style="flex:1">
          <div class="micro-group-mode" id="sol-visoes" role="group" aria-label="Visão da lista"></div>
          <div class="micro-filter-divider"></div>
          ${SOL_MF.map(grupo).join('')}
          <div class="micro-filter-group" id="solmfg-status">
            <button class="micro-filter-trigger" id="solmft-status" onclick="solStatusToggle()">
              <i class="ti ti-flag"></i><span id="solmft-status-label">Status</span><i class="ti ti-chevron-down micro-filter-chev" id="solmfc-status"></i>
            </button>
            <div class="micro-filter-dropdown" id="solmfd-status"><div class="micro-filter-options" id="solmfo-status"></div></div>
          </div>
          <div class="cal-picker-wrap" id="sol-cal-wrap">
            <button class="cal-picker-trigger" id="sol-cal-trigger" onclick="toggleCalPicker('sol')" type="button" style="min-width:0" title="Data do ocorrido">
              <i class="ti ti-calendar-event"></i><span id="sol-cal-label">Período</span><i class="ti ti-chevron-down cal-chev" id="sol-cal-chev"></i>
            </button>
            <input type="hidden" id="sol-dt-ini"><input type="hidden" id="sol-dt-fim">
            <div class="cal-picker-dropdown" id="sol-cal-dropdown"><div class="cal-picker-inner" id="sol-cal-inner" data-pfx="sol"></div></div>
          </div>
          <button class="btn micro-filter-clear" id="sol-mf-clear-btn" onclick="solLimparFiltros()" style="display:none"><i class="ti ti-filter-off"></i> Limpar filtros</button>
      </div>
    </div>
    <div class="mp sol-mp">
      <section class="mp-lista" id="sol-lista"></section>
      <section class="mp-painel" id="sol-tabela"></section>
    </div>`;
  // calendar.js só liga isto nos calendários que existem no carregamento
  // da página — sem isto, cada clique num dia fecharia o calendário.
  document.getElementById('sol-cal-dropdown').addEventListener('click', (e) => e.stopPropagation());
}

// ── Lista ────────────────────────────────────────────────────────────
const _solNoPeriodo = (s) => {
  const de = document.getElementById('sol-dt-ini')?.value;
  const ate = document.getElementById('sol-dt-fim')?.value;
  return (!de || String(s.data_ocorrido) >= de) && (!ate || String(s.data_ocorrido) <= ate);
};
const _solDoTipo = () => (_sol.tipo === 'procedimento'
  ? _sol.lista.filter((s) => s.categoria_situacao === _solProcAtual()[2])
  : _sol.lista.filter(SOL_TIPOS[1][3])).filter(_solNoPeriodo);
const _solFiltrosStatus = () => (_solEhCubagem() ? SOL_FILTROS_CUBAGEM : SOL_FILTROS);

function _solFiltradas() {
  const lista = _solFiltrosStatus();
  const [, , fn] = lista.find(([k]) => k === _sol.filtro) || lista[0];
  const q = _solNorm(_sol.busca);
  return _solDoTipo().filter((s) => fn(s) && (!q || _solNorm([
    s.protocolo, s.central, s.categoria_situacao, s.motivo, s.categoria, _solAnalista(s),
    ...(s.informantes || []).map((i) => i.nome),
    ...(s.itens || []).map((i) => [i.grupoMaterial, i.fornecedor, i.nf].join(' ')),
  ].join(' ')).includes(q)));
}

function solRender() {
  const el = document.getElementById('sol-page-body');
  if (!el) return;
  _solMontarEstrutura(el);
  if (!_solEhCubagem() && _solMF.applied.fornecedor.size) { _solMF.applied.fornecedor = new Set(); _solMFRotulo('fornecedor'); }
  const filtros = _solFiltrosStatus();
  if (!filtros.some(([k]) => k === _sol.filtro)) _sol.filtro = filtros[0][0];
  const doTipo = _solDoTipo();

  // Status: dropdown de seleção única (mesmo padrão do "Ordenar" de Ocorrências).
  document.getElementById('solmfo-status').innerHTML = filtros.map(([k, rot, fn]) =>
    `<div class="micro-filter-option micro-filter-option--radio${k === _sol.filtro ? ' selected' : ''}" onclick="solFiltro('${k}')">
      <span class="micro-filter-option-label">${rot} <span style="color:var(--text3)">(${doTipo.filter(fn).length})</span></span><i class="ti ti-check micro-filter-option-check"></i></div>`).join('');
  const [, rotStatus, fnStatus] = filtros.find(([k]) => k === _sol.filtro);
  document.getElementById('solmft-status-label').innerHTML = `${rotStatus} <span class="micro-filter-badge">${doTipo.filter(fnStatus).length}</span>`;
  document.getElementById('solmft-status').classList.toggle('active', _sol.filtro !== filtros[0][0]);

  // Visões (botões só com ícone, como na Micro/Operações).
  const niveis = _solNiveis();
  document.getElementById('sol-visoes').innerHTML = _solVisoesDoTipo().map((v) => {
    const t = `Por ${SOL_NIVEIS[v].rot} — ${SOL_VISOES[v].filter((n) => n !== 'fornecedor' || _solEhCubagem()).map((n) => SOL_NIVEIS[n].rot.toLowerCase()).join(' → ')}`;
    return `<button class="${v === _sol.visao ? 'active' : ''}" onclick="solVisao('${v}')" title="${t}" aria-label="${t}" aria-pressed="${v === _sol.visao}"><i class="ti ${SOL_NIVEIS[v].icon}"></i></button>`;
  }).join('');

  // Lista (árvore) e o que está dentro do nível escolhido.
  const pares = _solPares();
  const noCaminho = _solNoCaminho(pares, niveis, _sol.sel);
  if (_sol.sel.length && !noCaminho.length) _sol.sel = []; // o nível sumiu (filtro/exclusão)
  const lista = document.getElementById('sol-lista');
  lista.classList.toggle('recolhida', _sol.listaRecolhida);
  lista.innerHTML = _solListaHtml(pares, niveis);

  const proc = _sol.tipo === 'procedimento';
  const excluidos = _sol.filtro === 'excluida';
  // Última coluna: excluir (ou restaurar, na lista de excluídos).
  // Central/fornecedor/material já fixados pela lista ou pela barra não se repetem na tabela.
  const fixos = new Set([...niveis.slice(0, _sol.sel.length), ...SOL_MF.filter(([k]) => _solMF.applied[k].size === 1).map(([k]) => k)]);
  const cols = [...(proc ? _solProcAtual()[4] : SOL_COLS_MOV).filter((c) => !fixos.has(c[3])), ['', (s) => excluidos
    ? `<button class="btn btn-sm" title="Restaurar" onclick="event.stopPropagation();solRestaurar('${s.id}')"><i class="ti ti-arrow-back-up"></i></button>`
    : `<button class="btn btn-sm sol-btn-excluir" title="Excluir" onclick="event.stopPropagation();solExcluir('${s.id}')"><i class="ti ti-trash"></i></button>`, true]];
  const td = (dir) => dir ? ' style="text-align:right"' : '';

  // Procedimentos: uma linha por item (carreta, teste…); movimentações: uma por registro.
  const vistos = new Set();
  const rows = (_sol.sel.length ? noCaminho : pares).filter(([s]) => proc || (!vistos.has(s.id) && vistos.add(s.id)));
  const vazio = (icon, txt) => `<tr><td colspan="${cols.length}"><div class="empty-state"><i class="ti ${icon}"></i><p>${txt}</p></div></td></tr>`;
  const corpo = _sol.carregando && !_sol.lista.length ? vazio('ti-loader', 'Carregando…')
    : _sol.erro ? vazio('ti-alert-triangle', 'Falha ao carregar: ' + _solEsc(_sol.erro))
    : !rows.length ? vazio('ti-inbox', 'Nenhum registro neste filtro.')
    : rows.map(([s, i]) => `<tr style="cursor:pointer" onclick="solAbrir('${s.id}')"${excluidos && s.status_obs ? ` title="Excluído por ${_solEsc(s.status_por || '—')}: ${_solEsc(s.status_obs)}"` : ''}>
        ${cols.map(([, fn, dir]) => `<td${td(dir)}>${fn(s, i)}</td>`).join('')}
      </tr>`).join('');

  // Fornecedor só existe na cubagem (fora dela, o filtro esvazia).
  document.getElementById('solmfg-fornecedor').style.display = _solEhCubagem() ? '' : 'none';
  const algumFiltro = SOL_MF.some(([k]) => _solMF.applied[k].size) || !!document.getElementById('sol-dt-ini')?.value;
  document.getElementById('sol-mf-clear-btn').style.display = algumFiltro ? '' : 'none';

  const titulo = proc ? _solProcAtual()[1] : 'Movimentações de estoque';
  const migalhas = [titulo, ..._sol.sel].map(_solEsc).join(' <span style="color:var(--text3)">›</span> ');
  document.getElementById('sol-tabela').innerHTML = `<div class="table-card">
    <div class="table-header">
      <span class="table-title"><i class="ti ti-inbox"></i> ${migalhas}</span>
      <div class="table-toolbar">
        ${excluidos && rows.length ? '<button class="btn btn-sm sol-btn-excluir" onclick="solLimparExcluidos()"><i class="ti ti-trash-x"></i> Apagar excluídos de vez</button>' : ''}
      </div>
    </div>
    <div class="table-scroll" style="max-height:calc(100vh - 220px)"><table>
      <thead><tr>${cols.map(([rot, , dir]) => `<th${td(dir)}>${rot}</th>`).join('')}</tr></thead>
      <tbody>${corpo}</tbody>
    </table></div></div>`;
}

// ── Vínculo da NF da cubagem com as Entradas deste navegador ─────────
// Entradas vivem no IndexedDB de cada analista (state.entradas) — o
// vínculo é feito aqui, no cliente, e não fica gravado.
function _solVinculoNf(it) {
  const entradas = state.entradas || [];
  if (!entradas.length) {
    return '<div class="sol-nf-alerta"><i class="ti ti-database-off"></i> Entradas não carregadas neste navegador — não foi possível verificar a NF.</div>';
  }
  const nfKey = _solNfKey(it.nf);
  const forn = _solNorm(it.fornecedor);
  const achadas = nfKey ? entradas.filter((e) => {
    if (_solNfKey(e.nf) !== nfKey) return false;
    const f = _solNorm(e.fornecedor);
    return !forn || !f || f.includes(forn) || forn.includes(f);
  }) : [];
  if (!achadas.length) {
    return `<div class="sol-nf-alerta"><i class="ti ti-alert-triangle"></i> A NF ${_solEsc(it.nf)} de ${_solEsc(it.fornecedor)} não existe nas Entradas.</div>`;
  }
  return `<div class="sol-nf-ok"><i class="ti ti-link"></i> Vinculada às Entradas:
    ${achadas.slice(0, 5).map((e) => `<div>NF ${_solEsc(e.nf)} · emissão ${_solData(e.dtEmissao)} · ${_solEsc(e.material)} · ${_solNum(e.peso)} ${_solEsc(e.um || '')} · destino ${_solEsc(e.centralDestino || e.centralCompra || '—')}</div>`).join('')}
    ${achadas.length > 5 ? `<div>+ ${achadas.length - 5} linha(s)</div>` : ''}</div>`;
}

// ── Detalhe ──────────────────────────────────────────────────────────
function _solCampo(rot, val) {
  return `<div><div class="sol-det-rot">${rot}</div><div class="sol-det-val">${val}</div></div>`;
}

// Números-chave em destaque: [rótulo, valor, subtexto, classe].
function _solKpis(lista) {
  return `<div class="sol-det-kpis">${lista.map(([rot, val, sub, cls]) => `
    <div class="sol-det-kpi ${cls || ''}"><div class="sol-det-rot">${rot}</div><div class="sol-det-kpi-val">${val}</div>${sub ? `<div class="sol-det-kpi-sub">${sub}</div>` : ''}</div>`).join('')}</div>`;
}
// Variação: ±1% ou mais em âmbar, abaixo disso em verde.
function _solKpiVar(abs, pct, unidade) {
  if (abs === null || abs === undefined || pct === null || pct === undefined) return ['Variação', '—', 'sem conversão para kg', ''];
  const sinal = abs >= 0 ? '+' : '';
  return ['Variação', `${sinal}${_solNum(pct)}%`, `${sinal}${_solNum(abs)} ${unidade || 'kg'}`, Math.abs(pct) >= 1 ? 'alerta' : 'ok'];
}
function _solGrupo(titulo, campos) {
  return `<div class="sol-det-grupo"><div class="sol-det-grupo-tit">${titulo}</div><div class="sol-det-grupo-campos">${campos}</div></div>`;
}

function _solItensHtml(s) {
  const itens = s.itens || [];
  if (!itens.length) return '<p class="sol-det-vazio">Nenhum item.</p>';

  if (itens[0].tipo === 'material' || !itens[0].tipo) {
    return `<div class="sol-det-item" style="padding:0;overflow:hidden"><table class="sol-det-tabela"><thead><tr><th>Material</th><th style="text-align:right">Quantidade</th></tr></thead><tbody>
      ${itens.map((i) => `<tr><td>${_solEsc(i.grupoMaterial)}</td><td style="text-align:right;font-weight:600">${_solNum(i.peso)} ${_solEsc(i.unidade || 'kg')}</td></tr>`).join('')}
    </tbody></table></div>`;
  }

  if (itens[0].tipo === 'teste_canto') {
    return itens.map((i) => `<div class="sol-det-item">
      <div class="sol-det-item-tit">${_solEsc(i.categoriaMaterial)}</div>
      ${_solKpis([
        ['Referência', `${_solNum(i.referencia)} ${_solEsc(i.unidade)}`],
        ['Média lida', `${_solNum(i.media)} ${_solEsc(i.unidade)}`],
        _solKpiVar(i.variacaoAbs, i.variacaoPct, i.unidade),
      ])}
      <div class="sol-det-grupos">${_solGrupo('Leituras', (i.cantos || []).map((c, idx) => _solCampo(`Canto ${idx + 1}`, `${_solNum(c)} ${_solEsc(i.unidade)}`)).join(''))}</div>
    </div>`).join('');
  }

  // cubagem
  return itens.map((i) => {
    const doc = i.docTipo === 'TICKET' ? 'Ticket' : 'NF';
    const volume = i.volumeM3 !== null && i.volumeM3 !== undefined ? _solCampo('Volume', `${_solNum(i.volumeM3, 3)} m³`) : '';
    const medidas = i.metodo === 'pesagem'
      ? _solCampo('Pesagens', (i.pesagens || []).map((p) => _solNum(p)).join(' + ') + ' kg')
      : i.metodo === 'cone'
      ? _solCampo('Cones (raio × altura)', (i.cones || []).map((c) => `${_solNum(c.raio)} × ${_solNum(c.altura)} m`).join('<br>')) + volume
      : _solCampo('Caçamba', `${_solNum(i.comprimento)} × ${_solNum(i.largura)} m`) + _solCampo('Alturas dos furos', (i.alturas || []).map((a) => _solNum(a)).join(' / ') + ' m') + volume;
    const semFator = (i.umNf === 'M3' || i.metodo !== 'pesagem') && !i.fator;
    return `<div class="sol-det-item">
      <div class="sol-det-item-tit">${_solEsc(i.grupoMaterial)} <span>· ${_solEsc(i.fornecedor)}</span></div>
      ${_solKpis([
        [`${doc} em kg`, _solKg(i.nfKg), `${_solNum(i.pesoNf)} ${_solEsc(i.umNf)} declarado`],
        ['Total aferido', _solKg(i.aferidoKg), { pesagem: 'por pesagem', cone: 'por cone', volume: 'por volume (furos)' }[i.metodo] || ''],
        _solKpiVar(i.variacaoKg, i.variacaoPct),
      ])}
      <div class="sol-det-grupos">
        ${_solGrupo('Documento', `
          ${_solCampo(doc, _solEsc(i.nf))}
          ${_solCampo('Emissão', _solData(i.dataEmissao))}
          ${_solCampo('Recebimento', _solData(i.dataRecebimento))}
          ${_solCampo('Fator M³→KG', i.fator ? _solNum(i.fator, 4) : '—')}`)}
        ${_solGrupo('Medição', medidas)}
      </div>
      ${semFator ? '<div class="sol-nf-alerta"><i class="ti ti-scale"></i> Sem fator de densidade no envio — converta m³ para kg manualmente.</div>' : ''}
      ${i.docTipo === 'TICKET' ? '' : _solVinculoNf(i)}
    </div>`;
  }).join('');
}

// Contato que parece telefone vira link do WhatsApp.
function _solContato(c) {
  const dig = String(c || '').replace(/\D/g, '');
  if (dig.length < 10 || dig.length > 13) return _solEsc(c);
  const num = dig.length <= 11 ? '55' + dig : dig;
  return `<a href="https://wa.me/${num}" target="_blank" rel="noopener"><i class="ti ti-brand-whatsapp"></i> ${_solEsc(c)}</a>`;
}

async function solAbrir(id) {
  let s = _sol.lista.find((x) => x.id === id);
  if (!s) { await solCarregar(); s = _sol.lista.find((x) => x.id === id); } // ex.: clique no sininho logo após abrir o app
  if (!s) return;
  _sol.abertaId = id;
  const st = SOL_STATUS[s.status] || SOL_STATUS.pendente;
  const semStatus = _solSemStatus(s) && s.status !== 'excluida'; // cubagem: só registro

  document.getElementById('sol-modal-title').innerHTML = `<i class="ti ti-inbox"></i> ${_solEsc(s.protocolo)}${semStatus ? '' : ` <span class="badge ${st.badge}" style="margin-left:8px">${st.label}</span>`}`;
  document.getElementById('sol-modal-sub').textContent = `${s.categoria_situacao}${s.motivo ? ' · ' + s.motivo : ''} · ${s.categoria} · recebida em ${_solDataHora(s.created_at)}`;

  const informantes = s.informantes || [];
  const anexos = s.anexos || [];
  const inf0 = informantes[0] || {};

  // Topo: quem preencheu (1º informante) + onde/quando, lado a lado.
  document.getElementById('sol-modal-body').innerHTML = `
    <div class="sol-det-top">
      <div class="sol-det-pessoa">
        <div class="sol-det-pessoa-ico"><i class="ti ti-user"></i></div>
        <div style="min-width:0">
          <div class="sol-det-rot">Informado por</div>
          <div class="sol-det-pessoa-nome">${_solEsc(inf0.nome || '—')}</div>
          <div class="sol-det-pessoa-sub">${_solEsc(inf0.cargo || '')}${inf0.contato ? ' · ' + _solContato(inf0.contato) : ''}</div>
          ${informantes.length > 1 ? `<div class="sol-det-pessoa-sub">+ ${informantes.length - 1} informante(s): ${informantes.slice(1).map((i) => _solEsc(i.nome)).join(', ')}</div>` : ''}
        </div>
      </div>
      <div class="sol-det-onde">
        ${_solCampo('Central', _solEsc(s.central))}
        ${_solCampo('Data do ocorrido', _solData(s.data_ocorrido))}
        ${_solCampo('Regional', _solEsc(s.regional_central || '—'))}
        ${_solCampo('Analista', _solEsc(_solAnalista(s)))}
        ${s.filial_destino ? _solCampo('Filial de destino', _solEsc(s.filial_destino)) : ''}
        ${s.motivo ? _solCampo('Motivo', _solEsc(s.motivo)) : ''}
        ${s.cnpj_central ? _solCampo('CNPJ', _solEsc(s.cnpj_central)) : ''}
      </div>
    </div>
    <div class="sol-det-sec">${(s.itens || []).length > 1 ? `Itens (${s.itens.length})` : 'Item'}</div>
    ${_solItensHtml(s)}
    ${s.descricao ? `<div class="sol-det-sec">Descrição do ocorrido</div><div class="sol-det-desc">${_solEsc(s.descricao)}</div>` : ''}
    <div class="sol-det-sec">Assinaturas</div>
    <div class="sol-det-assin">${informantes.map((inf, idx) => `
      <div class="sol-det-assin-card">
        <div class="sol-det-assin-img" id="sol-assin-${idx}">${inf.assinatura ? '<i class="ti ti-loader"></i>' : 'Sem assinatura'}</div>
        <div style="font-weight:600;margin-top:6px">${_solEsc(inf.nome)}</div>
        <div style="font-size:11.5px;color:var(--text2)">${_solEsc(inf.cargo)}</div>
      </div>`).join('')}</div>
    <div class="sol-det-sec">Comprovantes</div>
    <div id="sol-det-anexos">${anexos.length
      ? anexos.map((a, idx) => `<div class="dai-anexo-chip"><i class="ti ti-paperclip"></i><span class="dai-anexo-chip-nome" id="sol-anexo-${idx}">${_solEsc(a.nome)}</span><span class="dai-anexo-chip-tam">${formatBytes(a.tamanho)}</span></div>`).join('')
      : '<div class="sol-nf-alerta"><i class="ti ti-paperclip-off"></i> Nenhum comprovante anexado — o informante declarou se responsabilizar pela falta de prova.</div>'}</div>
    ${semStatus ? '' : `<div class="sol-det-sec">Andamento</div>
    ${s.status_em ? `<div style="font-size:12px;color:var(--text2);margin-bottom:8px">${st.label} por ${_solEsc(s.status_por || '—')} em ${_solDataHora(s.status_em)}${s.status_obs ? `<div class="sol-det-desc" style="margin-top:6px">${_solEsc(s.status_obs)}</div>` : ''}</div>` : ''}
    ${s.status === 'excluida' ? '' : '<textarea class="form-input" id="sol-modal-obs" rows="2" placeholder="Observação do analista (opcional)" style="width:100%;resize:vertical"></textarea>'}`}`;

  // Pendente → Iniciar análise → Concluir (abre a DAI preenchida). Cubagem e
  // excluídos não têm ações aqui (excluir/restaurar ficam na linha da tabela).
  const btn = (onclick, icon, rot, cls) => `<button class="btn ${cls || ''}" onclick="${onclick}"><i class="ti ${icon}"></i> ${rot}</button>`;
  const ativo = !semStatus && s.status !== 'excluida';
  const fechado = s.status === 'concluida' || s.status === 'recusada';
  document.getElementById('sol-modal-actions').innerHTML = `
    <button class="btn" style="margin-right:auto" onclick="closeModal('sol-modal')">Fechar</button>
    ${ativo && s.status === 'pendente' ? btn("solMudarStatus('em_analise')", 'ti-player-play', 'Iniciar análise') : ''}
    ${ativo && fechado ? btn("solMudarStatus('em_analise')", 'ti-arrow-back-up', 'Reabrir') : ''}
    ${ativo && !fechado ? btn('solConcluirComDai()', 'ti-file-text', 'Concluir com DAI', 'btn-primary') : ''}`;

  openModal('sol-modal');

  // Links assinados (bucket privado) — assinaturas viram <img>, anexos viram link.
  const paths = [...informantes.map((i) => i.assinatura).filter(Boolean), ...anexos.map((a) => a.path)];
  if (!paths.length) return;
  const { data, error } = await window.supabaseClient.storage.from('solicitacoes-anexos').createSignedUrls(paths, 3600);
  if (error || _sol.abertaId !== id) { if (error) console.warn('[Solicitações] Falha ao gerar links:', error); return; }
  const url = new Map((data || []).map((d) => [d.path, d.signedUrl]));
  informantes.forEach((inf, idx) => {
    const el = document.getElementById('sol-assin-' + idx);
    if (el && inf.assinatura) el.innerHTML = url.get(inf.assinatura) ? `<img src="${url.get(inf.assinatura)}" alt="Assinatura de ${_solEsc(inf.nome)}">` : 'Assinatura indisponível';
  });
  anexos.forEach((a, idx) => {
    const el = document.getElementById('sol-anexo-' + idx);
    if (el && url.get(a.path)) el.innerHTML = `<a href="${url.get(a.path)}" target="_blank" rel="noopener">${_solEsc(a.nome)}</a>`;
  });
}
window.solAbrir = solAbrir;

// Grava o andamento (só colunas de status — o resto é imutável para o analista).
async function _solSalvarStatus(s, status, obs) {
  const patch = {
    status,
    status_obs: obs || null,
    status_por: window.currentUser?.nome_exibicao || window.currentUser?.email || '',
    status_em: new Date().toISOString(),
  };
  const { error } = await window.supabaseClient.from('solicitacoes').update(patch).eq('id', s.id);
  if (error) { toast('Falha ao salvar: ' + error.message, 'error'); return false; }
  Object.assign(s, patch);
  solRender();
  _solAtualizarBadge();
  return true;
}

async function solMudarStatus(status) {
  const s = _sol.lista.find((x) => x.id === _sol.abertaId);
  if (!s) return;
  const obs = (document.getElementById('sol-modal-obs')?.value || '').trim();
  if (!await _solSalvarStatus(s, status, obs)) return;
  toast(`Registro ${s.protocolo}: ${SOL_STATUS[status].label}.`, 'success');
  solAbrir(s.id);
}
window.solMudarStatus = solMudarStatus;

// ── Excluir / restaurar / apagar de vez ──────────────────────────────
function solExcluir(id) {
  const s = _sol.lista.find((x) => x.id === id);
  if (!s) return;
  confirmarDestrutivo({
    title: `Excluir ${s.protocolo}?`,
    sub: `${s.categoria_situacao} · ${s.central}`,
    body: `O registro sai das listas e vai para "Excluídos", de onde pode ser restaurado.
      <textarea class="form-input" id="sol-excluir-obs" rows="3" placeholder="Motivo da exclusão (obrigatório)" style="width:100%;margin-top:10px;resize:vertical"></textarea>`,
    confirmLabel: 'Excluir',
    onConfirm: async () => {
      const obs = (document.getElementById('sol-excluir-obs')?.value || '').trim();
      if (!obs) { toast('Informe o motivo da exclusão.', 'error'); return; }
      if (await _solSalvarStatus(s, 'excluida', obs)) toast(`Registro ${s.protocolo} excluído.`, 'success');
    },
  });
}
window.solExcluir = solExcluir;

// ponytail: restaura como "pendente" (o status anterior não é guardado).
async function solRestaurar(id) {
  const s = _sol.lista.find((x) => x.id === id);
  if (s && await _solSalvarStatus(s, 'pendente', null)) toast(`Registro ${s.protocolo} restaurado.`, 'success');
}
window.solRestaurar = solRestaurar;

function solLimparExcluidos() {
  const n = _sol.lista.filter((s) => s.status === 'excluida').length;
  confirmarDestrutivo({
    title: 'Apagar excluídos de vez?',
    sub: `${n} registro(s) na lista de excluídos`,
    body: 'Os registros excluídos que você pode ver serão apagados do banco. <strong>Não tem como desfazer.</strong>',
    confirmLabel: 'Apagar de vez',
    requireConsent: true,
    consentLabel: 'Entendo que os registros serão apagados permanentemente.',
    onConfirm: async () => {
      const { data, error } = await window.supabaseClient.rpc('solicitacoes_limpar_excluidas');
      if (error) { toast('Falha ao apagar: ' + error.message, 'error'); return; }
      _sol.lista = _sol.lista.filter((s) => s.status !== 'excluida');
      solRender();
      toast(`${data ?? n} registro(s) apagado(s) de vez.`, 'success');
    },
  });
}
window.solLimparExcluidos = solLimparExcluidos;

// ── Concluir com DAI ─────────────────────────────────────────────────
// Abre o modal de DAI (dai.js) já preenchido com o registro. Quando a DAI é
// gerada, gerarDocumentoAjuste chama window._daiAoGerar → o registro vira
// "Concluída" com o número da DAI na observação.
function solConcluirComDai() {
  const s = _sol.lista.find((x) => x.id === _sol.abertaId);
  if (!s || typeof abrirModalDai !== 'function') return;
  const obs = (document.getElementById('sol-modal-obs')?.value || '').trim();
  closeModal('sol-modal');
  abrirModalDai();

  const set = (el, v) => { if (el && v !== undefined && v !== null) el.value = v; };
  const central = document.getElementById('dai-form-central');
  if (central && s.central && ![...central.options].some((o) => o.value === s.central)) central.add(new Option(s.central, s.central));
  set(central, s.central);
  if (typeof _daiAtualizarCnpjPreview === 'function') _daiAtualizarCnpjPreview();
  set(document.getElementById('dai-form-data-ocorrido'), s.data_ocorrido);

  // Informantes (nome + cargo) — a 1ª linha já existe.
  (s.informantes || []).forEach((inf, idx) => {
    if (idx > 0) _daiAddInformanteRow();
    const row = document.querySelector('#dai-informantes-rows .reg-individual-row:last-child');
    set(row?.querySelector('[data-field="nome"]'), inf.nome);
    set(row?.querySelector('[data-field="cargo"]'), inf.cargo);
  });

  // Itens: material + quantidade. Teste de canto não tem material/peso a
  // ajustar definidos — o analista calcula (os dados vão na descrição).
  const itens = (s.itens || []).filter((i) => i.tipo !== 'teste_canto');
  itens.forEach((it, idx) => {
    if (idx > 0) _daiAddItemRow();
    const card = document.querySelector('#dai-itens-rows .dai-item-card:last-child');
    const mat = card?.querySelector('[data-field="material"]');
    if (mat && [...mat.options].some((o) => o.value === it.grupoMaterial)) mat.value = it.grupoMaterial;
    set(card?.querySelector('[data-field="peso"]'), it.peso);
  });

  const linhas = [`${s.categoria_situacao}${s.motivo ? ` (${s.motivo})` : ''} — Registro Operacional ${s.protocolo}.`];
  if (s.filial_destino) linhas.push(`Filial de destino: ${s.filial_destino}.`);
  (s.itens || []).forEach((i) => {
    if (i.tipo === 'teste_canto') linhas.push(`Teste de canto ${i.categoriaMaterial}: referência ${_solNum(i.referencia)} ${i.unidade}, média lida ${_solNum(i.media)} ${i.unidade} (${_solNum(i.variacaoPct)}%).`);
    else if (i.unidade === 'L') linhas.push(`${i.grupoMaterial}: ${_solNum(i.peso)} L informados pelo operador.`);
  });
  if (s.descricao) linhas.push(s.descricao);
  if ((s.anexos || []).length) linhas.push(`Comprovantes anexados no registro ${s.protocolo}.`);
  set(document.getElementById('dai-form-descricao'), linhas.join('\n'));

  window._daiAoGerar = async (dai) => {
    if (await _solSalvarStatus(s, 'concluida', `Concluído com a ${dai.numero}${obs ? ` — ${obs}` : ''}`)) {
      toast(`Registro ${s.protocolo} concluído com a ${dai.numero}.`, 'success');
    }
  };
}
window.solConcluirComDai = solConcluirComDai;

// ── Entregas de agregados → formulário público (só ADM) ──────────────
// Publica quem entregou qual material (grupo SAP) em qual central, a
// partir das Entradas do ADM — o formulário filtra o fornecedor da
// cubagem por central + material. Chamado no boot e ao fim de cada
// importação de Entradas; só envia quando mudou desde a última vez.
async function solPublicarFornecedores() {
  if (window.currentUser?.role !== 'admin' || !window.supabaseClient) return;
  // Entradas guardam a central pelo alias da filial; o formulário mostra
  // origem || alias (ver acaoCatalogo na Edge Function).
  const nomeCentral = new Map((state.filiais || []).map((f) => [f.alias, f.origem || f.alias]));
  const linhas = new Map();
  for (const e of (state.entradas || [])) {
    if (!SOL_CATEGORIAS_AGREGADO.includes(e.categoria)) continue;
    const f = String(e.fornecedor || '').trim();
    const cAlias = String(e.centralDestino || e.centralCompra || '').trim();
    const m = String(e.material || '').trim();
    if (!f || f === '—' || !cAlias || cAlias === '—' || !m) continue;
    const c = nomeCentral.get(cAlias) || cAlias;
    linhas.set(f + '\u0001' + c + '\u0001' + m, { f, c, m });
  }
  if (!linhas.size) return; // Entradas vazias/não carregadas: não apaga o que já foi publicado
  const lista = [...linhas.values()].sort((a, b) => (a.f + a.c + a.m).localeCompare(b.f + b.c + b.m, 'pt-BR'));
  const assinatura = JSON.stringify(lista);
  let anterior = null;
  try { anterior = localStorage.getItem('solEntregasPublicadas'); } catch { /* sem storage */ }
  if (anterior === assinatura) return;
  const { error } = await window.supabaseClient.rpc('solicitacao_entregas_substituir', { p_linhas: lista });
  if (error) { console.warn('[Solicitações] Falha ao publicar entregas:', error); return; }
  try { localStorage.setItem('solEntregasPublicadas', assinatura); } catch { /* sem storage */ }
}
window.solPublicarFornecedores = solPublicarFornecedores;
