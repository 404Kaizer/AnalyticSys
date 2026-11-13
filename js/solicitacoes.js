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
  recusada:   { label: 'Recusada',   badge: 'badge-red' },
};
const SOL_FILTROS = [
  ['abertas', 'Abertas', (s) => s.status === 'pendente' || s.status === 'em_analise'],
  ['pendente', 'Pendentes', (s) => s.status === 'pendente'],
  ['em_analise', 'Em análise', (s) => s.status === 'em_analise'],
  ['concluida', 'Concluídas', (s) => s.status === 'concluida'],
  ['recusada', 'Recusadas', (s) => s.status === 'recusada'],
  ['todas', 'Todas', () => true],
];
const SOL_CATEGORIAS_AGREGADO = ['Agregado Graúdo', 'Agregado Miúdo'];

const _sol = { lista: [], tipo: 'procedimento', proc: 'cubagem', filtro: 'abertas', busca: '', carregando: false, erro: '', abertaId: null };

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
// Colunas: [título, (solicitação, item) => html, alinhar à direita?].
// Nos procedimentos a tabela tem uma linha por item (carreta, teste…).
const _SOL_C = {
  protocolo: ['Protocolo', (s) => `<span style="font-family:var(--mono);font-size:11.5px">${_solEsc(s.protocolo)}</span>`],
  recebida: ['Recebida', (s) => _solDataHora(s.created_at)],
  ocorrido: ['Ocorrido', (s) => _solData(s.data_ocorrido)],
  central: ['Central', (s) => _solEsc(s.central)],
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
    ['Material', (s, i) => _solEsc(i.grupoMaterial)],
    ['Fornecedor', (s, i) => _solEsc(i.fornecedor)],
    ['Documento', (s, i) => i.nf ? `${i.docTipo === 'TICKET' ? 'Ticket' : 'NF'} ${_solEsc(i.nf)}` : '—'],
    ['Recebimento', (s, i) => _solData(i.dataRecebimento)],
    ['Documento (kg)', (s, i) => _solNum(i.nfKg), true],
    ['Aferido (kg)', (s, i) => _solNum(i.aferidoKg), true],
    ['Variação', (s, i) => _solVar(i.variacaoKg, i.variacaoPct), true],
    _cA, _cS]],
  ['canto', 'Teste de canto', 'Teste de canto', 'ti-scale', [_cP, _cR, _cO, _cC,
    ['Categoria', (s, i) => _solEsc(i.categoriaMaterial)],
    ['Referência', (s, i) => `${_solNum(i.referencia)} ${_solEsc(i.unidade)}`, true],
    ['Média', (s, i) => `${_solNum(i.media)} ${_solEsc(i.unidade)}`, true],
    ['Variação', (s, i) => _solVar(i.variacaoAbs, i.variacaoPct, i.unidade), true],
    _cA, _cS]],
  ['pesagem', 'Pesagem manual', 'Pesagem manual (fora da automação)', 'ti-weight', [_cP, _cR, _cO, _cC,
    ['Material', (s, i) => _solEsc(i.grupoMaterial)],
    ['Peso (kg)', (s, i) => _solNum(i.peso), true],
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
async function solCarregar() {
  if (!window.supabaseClient || _sol.carregando) return;
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
  const handle = async (row, tipo) => {
    if (!row?.id) return;
    await _solCarregarNomes([row.user_id]);
    const idx = _sol.lista.findIndex((s) => s.id === row.id);
    if (idx >= 0) _sol.lista[idx] = row;
    else _sol.lista.unshift(row);
    _sol.lista.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    solRender();
    if (tipo === 'INSERT' && typeof toast === 'function') toast(`Novo registro ${row.protocolo} — ${row.categoria_situacao}.`, 'success');
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
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.warn('[Solicitações] Canal Realtime com problema:', status);
    });
}
window.solRealtimeInit = solRealtimeInit;

pageRenderers.solicitacoes = () => { solCarregar(); };

function solFiltro(k) { _sol.filtro = k; solRender(); }
window.solFiltro = solFiltro;

function solTipo(k) { _sol.tipo = k; solRender(); }
window.solTipo = solTipo;

function solProc(k) { _sol.proc = k; solRender(); }
window.solProc = solProc;

function solBuscar(v) { _sol.busca = v; solRender(); }
window.solBuscar = solBuscar;

// ── Lista ────────────────────────────────────────────────────────────
const _solDoTipo = () => _sol.tipo === 'procedimento'
  ? _sol.lista.filter((s) => s.categoria_situacao === _solProcAtual()[2])
  : _sol.lista.filter(SOL_TIPOS[1][3]);

function _solFiltradas() {
  const [, , fn] = SOL_FILTROS.find(([k]) => k === _sol.filtro) || SOL_FILTROS[0];
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
  const doTipo = _solDoTipo();
  const pills = SOL_FILTROS.map(([k, rot, fn]) =>
    `<button class="pim-month-pill${k === _sol.filtro ? ' active' : ''}" type="button" onclick="solFiltro('${k}')">${rot} <b>${doTipo.filter(fn).length}</b></button>`).join('');
  // Contador da aba = solicitações em aberto (pendente/em análise) daquele tipo.
  const abertas = SOL_FILTROS[0][2];
  const abas = SOL_TIPOS.map(([k, rot, icon, fn]) =>
    `<button class="tab-btn${k === _sol.tipo ? ' active' : ''}" type="button" onclick="solTipo('${k}')"><i class="ti ${icon}"></i> ${rot} <b>${_sol.lista.filter((s) => fn(s) && abertas(s)).length}</b></button>`).join('');

  const proc = _sol.tipo === 'procedimento';
  const subAbas = proc ? `<div class="tabs" style="margin-bottom:12px">${SOL_PROC.map(([k, rot, sit, icon]) =>
    `<button class="tab-btn${k === _sol.proc ? ' active' : ''}" type="button" onclick="solProc('${k}')"><i class="ti ${icon}"></i> ${rot} <b>${_sol.lista.filter((s) => s.categoria_situacao === sit && abertas(s)).length}</b></button>`).join('')}</div>` : '';
  const cols = proc ? _solProcAtual()[4] : SOL_COLS_MOV;
  const td = (dir) => dir ? ' style="text-align:right"' : '';

  // Procedimentos: uma linha por item (carreta, teste…); movimentações: uma por solicitação.
  const rows = _solFiltradas().flatMap((s) => (proc && s.itens?.length ? s.itens : [{}]).map((i) => [s, i]));
  const vazio = (icon, txt) => `<tr><td colspan="${cols.length}"><div class="empty-state"><i class="ti ${icon}"></i><p>${txt}</p></div></td></tr>`;
  const corpo = _sol.carregando && !_sol.lista.length ? vazio('ti-loader', 'Carregando…')
    : _sol.erro ? vazio('ti-alert-triangle', 'Falha ao carregar: ' + _solEsc(_sol.erro))
    : !rows.length ? vazio('ti-inbox', 'Nenhum registro neste filtro.')
    : rows.map(([s, i]) => `<tr style="cursor:pointer" onclick="solAbrir('${s.id}')">
        ${cols.map(([, fn, dir]) => `<td${td(dir)}>${fn(s, i)}</td>`).join('')}
      </tr>`).join('');

  el.innerHTML = `<div class="tabs" style="margin-bottom:12px" title="O número é de registros em aberto">${abas}</div>${subAbas}
  <div class="table-card">
    <div class="table-header">
      <span class="table-title"><i class="ti ti-inbox"></i> Registros do formulário público</span>
      <div class="table-toolbar">
        ${pills}
        <input class="form-input" style="width:220px" type="text" placeholder="Buscar protocolo, central, NF…" value="${_solEsc(_sol.busca)}" oninput="solBuscar(this.value)">
        <button class="btn" onclick="solCarregar()" title="Recarregar"><i class="ti ti-refresh"></i></button>
      </div>
    </div>
    <div class="table-scroll" style="max-height:calc(100vh - 200px)"><table>
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

function _solItensHtml(s) {
  const itens = s.itens || [];
  if (!itens.length) return '<p class="sol-det-vazio">Nenhum item.</p>';

  if (itens[0].tipo === 'material' || !itens[0].tipo) {
    return `<table><thead><tr><th>Material</th><th style="text-align:right">Peso (kg)</th></tr></thead><tbody>
      ${itens.map((i) => `<tr><td>${_solEsc(i.grupoMaterial)}</td><td style="text-align:right">${_solNum(i.peso)}</td></tr>`).join('')}
    </tbody></table>`;
  }

  if (itens[0].tipo === 'teste_canto') {
    return itens.map((i) => `<div class="sol-det-item">
      <div class="sol-det-grid">
        ${_solCampo('Categoria', _solEsc(i.categoriaMaterial))}
        ${_solCampo('Referência', `${_solNum(i.referencia)} ${_solEsc(i.unidade)}`)}
        ${_solCampo('Leituras', (i.cantos || []).map((c, idx) => `C${idx + 1}: ${_solNum(c)}`).join(' · '))}
        ${_solCampo('Média', `${_solNum(i.media)} ${_solEsc(i.unidade)}`)}
        ${_solCampo('Variação', _solVar(i.variacaoAbs, i.variacaoPct, i.unidade))}
      </div></div>`).join('');
  }

  // cubagem
  return itens.map((i) => {
    const volume = _solCampo('Volume', i.volumeM3 !== null ? `${_solNum(i.volumeM3, 3)} m³` : '—');
    const metodo = i.metodo === 'pesagem'
      ? _solCampo('Pesagens (kg)', (i.pesagens || []).map((p) => _solNum(p)).join(' + '))
      : i.metodo === 'cone'
      ? _solCampo('Cones (raio × altura)', (i.cones || []).map((c) => `${_solNum(c.raio)} × ${_solNum(c.altura)} m`).join(' · ')) + volume
      : _solCampo('Caçamba', `${_solNum(i.comprimento)} m × ${_solNum(i.largura)} m · alturas ${(i.alturas || []).map((a) => _solNum(a)).join(' / ')} m`) + volume;
    const semFator = (i.umNf === 'M3' || i.metodo !== 'pesagem') && !i.fator;
    return `<div class="sol-det-item">
      <div class="sol-det-grid">
        ${_solCampo('Material', _solEsc(i.grupoMaterial))}
        ${_solCampo('Fornecedor', _solEsc(i.fornecedor))}
        ${_solCampo(i.docTipo === 'TICKET' ? 'Ticket' : 'NF', _solEsc(i.nf))}
        ${_solCampo('Emissão / Recebimento', `${_solData(i.dataEmissao)} / ${_solData(i.dataRecebimento)}`)}
        ${_solCampo('Peso na NF', `${_solNum(i.pesoNf)} ${_solEsc(i.umNf)}`)}
        ${_solCampo('Método', { pesagem: 'Pesagem', cone: 'Cone', volume: 'Volume (furos)' }[i.metodo] || '—')}
        ${metodo}
        ${_solCampo('Fator M³→KG', i.fator ? _solNum(i.fator, 4) : '—')}
        ${_solCampo('NF em kg', _solKg(i.nfKg))}
        ${_solCampo('Total aferido', _solKg(i.aferidoKg))}
        ${_solCampo('Variação', _solVar(i.variacaoKg, i.variacaoPct))}
      </div>
      ${semFator ? '<div class="sol-nf-alerta"><i class="ti ti-scale"></i> Sem fator de densidade no envio — converta m³ para kg manualmente.</div>' : ''}
      ${i.docTipo === 'TICKET' ? '' : _solVinculoNf(i)}
    </div>`;
  }).join('');
}

async function solAbrir(id) {
  const s = _sol.lista.find((x) => x.id === id);
  if (!s) return;
  _sol.abertaId = id;
  const st = SOL_STATUS[s.status] || SOL_STATUS.pendente;

  document.getElementById('sol-modal-title').innerHTML = `<i class="ti ti-inbox"></i> ${_solEsc(s.protocolo)} <span class="badge ${st.badge}" style="margin-left:8px">${st.label}</span>`;
  document.getElementById('sol-modal-sub').textContent = `${s.categoria_situacao} · ${s.categoria} · recebida em ${_solDataHora(s.created_at)}`;

  const informantes = s.informantes || [];
  const anexos = s.anexos || [];

  document.getElementById('sol-modal-body').innerHTML = `
    <div class="sol-det-sec">Onde e quando</div>
    <div class="sol-det-grid">
      ${_solCampo('Central', _solEsc(s.central))}
      ${_solCampo('CNPJ', _solEsc(s.cnpj_central || '—'))}
      ${_solCampo('Regional', _solEsc(s.regional_central || '—'))}
      ${_solCampo('Data do ocorrido', _solData(s.data_ocorrido))}
      ${s.filial_destino ? _solCampo('Filial de destino', _solEsc(s.filial_destino)) : ''}
      ${s.motivo ? _solCampo('Motivo da coleta', _solEsc(s.motivo)) : ''}
      ${_solCampo('Analista', _solEsc(_solAnalista(s)))}
    </div>
    <div class="sol-det-sec">Itens</div>
    ${_solItensHtml(s)}
    <div class="sol-det-sec">Descrição do ocorrido</div>
    <div class="sol-det-desc">${_solEsc(s.descricao) || "—"}</div>
    <div class="sol-det-sec">Informantes e assinaturas</div>
    <div class="sol-det-assin">${informantes.map((inf, idx) => `
      <div class="sol-det-assin-card">
        <div style="font-weight:600">${_solEsc(inf.nome)}</div>
        <div style="font-size:11.5px;color:var(--text2)">${_solEsc(inf.cargo)}${inf.contato ? ' · ' + _solEsc(inf.contato) : ''}</div>
        <div class="sol-det-assin-img" id="sol-assin-${idx}">${inf.assinatura ? '<i class="ti ti-loader"></i>' : 'Sem assinatura'}</div>
      </div>`).join('')}</div>
    <div class="sol-det-sec">Comprovantes</div>
    <div id="sol-det-anexos">${anexos.length
      ? anexos.map((a, idx) => `<div class="dai-anexo-chip"><i class="ti ti-paperclip"></i><span class="dai-anexo-chip-nome" id="sol-anexo-${idx}">${_solEsc(a.nome)}</span><span class="dai-anexo-chip-tam">${formatBytes(a.tamanho)}</span></div>`).join('')
      : '<div class="sol-nf-alerta"><i class="ti ti-paperclip-off"></i> Nenhum comprovante anexado — o informante declarou se responsabilizar pela falta de prova.</div>'}</div>
    <div class="sol-det-sec">Andamento</div>
    ${s.status_em ? `<div style="font-size:12px;color:var(--text2);margin-bottom:8px">${st.label} por ${_solEsc(s.status_por || '—')} em ${_solDataHora(s.status_em)}${s.status_obs ? `<div class="sol-det-desc" style="margin-top:6px">${_solEsc(s.status_obs)}</div>` : ''}</div>` : ''}
    <textarea class="form-input" id="sol-modal-obs" rows="3" placeholder="Observação do analista (obrigatória para concluir ou recusar)" style="width:100%;resize:vertical"></textarea>`;

  const btn = (status, icon, rot, cls) => `<button class="btn ${cls || ''}" onclick="solMudarStatus('${status}')"><i class="ti ${icon}"></i> ${rot}</button>`;
  const fechado = s.status === 'concluida' || s.status === 'recusada';
  document.getElementById('sol-modal-actions').innerHTML = `
    <button class="btn" style="margin-right:auto" onclick="closeModal('sol-modal')">Fechar</button>
    ${s.status === 'pendente' ? btn('em_analise', 'ti-player-play', 'Iniciar análise') : ''}
    ${fechado ? btn('em_analise', 'ti-arrow-back-up', 'Reabrir') : ''}
    ${!fechado ? btn('recusada', 'ti-x', 'Recusar', 'admin-btn-danger') : ''}
    ${!fechado ? btn('concluida', 'ti-check', 'Concluir', 'btn-primary') : ''}`;

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

async function solMudarStatus(status) {
  const s = _sol.lista.find((x) => x.id === _sol.abertaId);
  if (!s) return;
  const obs = (document.getElementById('sol-modal-obs')?.value || '').trim();
  if ((status === 'concluida' || status === 'recusada') && !obs) {
    toast('Escreva uma observação para concluir ou recusar.', 'error');
    return;
  }
  const patch = {
    status,
    status_obs: obs || null,
    status_por: window.currentUser?.nome_exibicao || window.currentUser?.email || '',
    status_em: new Date().toISOString(),
  };
  const { error } = await window.supabaseClient.from('solicitacoes').update(patch).eq('id', s.id);
  if (error) { toast('Falha ao salvar: ' + error.message, 'error'); return; }
  Object.assign(s, patch);
  toast(`Registro ${s.protocolo}: ${SOL_STATUS[status].label}.`, 'success');
  solRender();
  solAbrir(s.id);
}
window.solMudarStatus = solMudarStatus;

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
