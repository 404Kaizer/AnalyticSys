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

const _sol = { lista: [], filtro: 'abertas', busca: '', carregando: false, erro: '', abertaId: null };

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

// ── Carga ────────────────────────────────────────────────────────────
// ponytail: carrega ao abrir a página (sem realtime) — o volume é de
// dezenas por mês e só o analista da categoria mexe. Se virar fila
// disputada, assinar postgres_changes como dai.js faz.
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
  }
  solRender();
}
window.solCarregar = solCarregar;

pageRenderers.solicitacoes = () => { solCarregar(); };

function solFiltro(k) { _sol.filtro = k; solRender(); }
window.solFiltro = solFiltro;

function solBuscar(v) { _sol.busca = v; solRender(); }
window.solBuscar = solBuscar;

// ── Lista ────────────────────────────────────────────────────────────
function _solFiltradas() {
  const [, , fn] = SOL_FILTROS.find(([k]) => k === _sol.filtro) || SOL_FILTROS[0];
  const q = _solNorm(_sol.busca);
  return _sol.lista.filter((s) => fn(s) && (!q || _solNorm([
    s.protocolo, s.central, s.categoria_situacao, s.categoria, s.analista_nome,
    ...(s.informantes || []).map((i) => i.nome),
    ...(s.itens || []).map((i) => [i.grupoMaterial, i.fornecedor, i.nf].join(' ')),
  ].join(' ')).includes(q)));
}

function solRender() {
  const el = document.getElementById('sol-page-body');
  if (!el) return;
  const pills = SOL_FILTROS.map(([k, rot, fn]) =>
    `<button class="pim-month-pill${k === _sol.filtro ? ' active' : ''}" type="button" onclick="solFiltro('${k}')">${rot} <b>${_sol.lista.filter(fn).length}</b></button>`).join('');

  const rows = _solFiltradas();
  const vazio = (icon, txt) => `<tr><td colspan="8"><div class="empty-state"><i class="ti ${icon}"></i><p>${txt}</p></div></td></tr>`;
  const corpo = _sol.carregando && !_sol.lista.length ? vazio('ti-loader', 'Carregando…')
    : _sol.erro ? vazio('ti-alert-triangle', 'Falha ao carregar: ' + _solEsc(_sol.erro))
    : !rows.length ? vazio('ti-inbox', 'Nenhuma solicitação neste filtro.')
    : rows.map((s) => {
      const st = SOL_STATUS[s.status] || SOL_STATUS.pendente;
      return `<tr style="cursor:pointer" onclick="solAbrir('${s.id}')">
        <td style="font-family:var(--mono);font-size:11.5px">${_solEsc(s.protocolo)}</td>
        <td>${_solDataHora(s.created_at)}</td>
        <td>${_solData(s.data_ocorrido)}</td>
        <td>${_solEsc(s.central)}</td>
        <td>${_solEsc(s.categoria_situacao)}</td>
        <td>${_solEsc(s.categoria)}</td>
        <td>${_solEsc(s.analista_nome || '—')}</td>
        <td><span class="badge ${st.badge}">${st.label}</span>${s.sem_comprovante ? ' <i class="ti ti-paperclip-off" style="color:var(--amber)" title="Sem comprovante anexado"></i>' : ''}</td>
      </tr>`;
    }).join('');

  el.innerHTML = `<div class="table-card">
    <div class="table-header">
      <span class="table-title"><i class="ti ti-inbox"></i> Solicitações do formulário público</span>
      <div class="table-toolbar">
        ${pills}
        <input class="form-input" style="width:220px" type="text" placeholder="Buscar protocolo, central, NF…" value="${_solEsc(_sol.busca)}" oninput="solBuscar(this.value)">
        <button class="btn" onclick="solCarregar()" title="Recarregar"><i class="ti ti-refresh"></i></button>
      </div>
    </div>
    <div class="table-scroll" style="max-height:calc(100vh - 200px)"><table>
      <thead><tr><th>Protocolo</th><th>Recebida</th><th>Ocorrido</th><th>Central</th><th>Situação</th><th>Categoria</th><th>Analista</th><th>Status</th></tr></thead>
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
    const metodo = i.metodo === 'pesagem'
      ? _solCampo('Pesagens (kg)', (i.pesagens || []).map((p) => _solNum(p)).join(' + '))
      : _solCampo('Caçamba', `${_solNum(i.comprimento)} m × ${_solNum(i.largura)} m · alturas ${(i.alturas || []).map((a) => _solNum(a)).join(' / ')} m`)
        + _solCampo('Volume', i.volumeM3 !== null ? `${_solNum(i.volumeM3, 3)} m³` : '—');
    const semFator = (i.umNf === 'M3' || i.metodo === 'volume') && !i.fator;
    return `<div class="sol-det-item">
      <div class="sol-det-grid">
        ${_solCampo('Material', _solEsc(i.grupoMaterial))}
        ${_solCampo('Fornecedor', _solEsc(i.fornecedor))}
        ${_solCampo('NF', _solEsc(i.nf))}
        ${_solCampo('Emissão / Recebimento', `${_solData(i.dataEmissao)} / ${_solData(i.dataRecebimento)}`)}
        ${_solCampo('Peso na NF', `${_solNum(i.pesoNf)} ${_solEsc(i.umNf)}`)}
        ${_solCampo('Método', i.metodo === 'pesagem' ? 'Pesagem' : 'Volume (furos)')}
        ${metodo}
        ${_solCampo('Fator M³→KG', i.fator ? _solNum(i.fator, 4) : '—')}
        ${_solCampo('NF em kg', _solKg(i.nfKg))}
        ${_solCampo('Total aferido', _solKg(i.aferidoKg))}
        ${_solCampo('Variação', _solVar(i.variacaoKg, i.variacaoPct))}
      </div>
      ${semFator ? '<div class="sol-nf-alerta"><i class="ti ti-scale"></i> Sem fator de densidade no envio — converta m³ para kg manualmente.</div>' : ''}
      ${_solVinculoNf(i)}
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
      ${_solCampo('Analista', _solEsc(s.analista_nome || '—'))}
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
  toast(`Solicitação ${s.protocolo}: ${SOL_STATUS[status].label}.`, 'success');
  solRender();
  solAbrir(s.id);
}
window.solMudarStatus = solMudarStatus;

// ── Fornecedores de agregados → formulário público (só ADM) ──────────
// Chamado no boot e ao fim de cada importação de Entradas. Só envia
// quando a lista mudou desde a última publicação deste navegador.
async function solPublicarFornecedores() {
  if (window.currentUser?.role !== 'admin' || !window.supabaseClient) return;
  const nomes = new Set();
  for (const e of (state.entradas || [])) {
    if (!SOL_CATEGORIAS_AGREGADO.includes(e.categoria)) continue;
    const f = String(e.fornecedor || '').trim();
    if (f && f !== '—') nomes.add(f);
  }
  if (!nomes.size) return; // Entradas vazias/não carregadas: não apaga a lista publicada
  const lista = [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const assinatura = lista.join('\n');
  let anterior = null;
  try { anterior = localStorage.getItem('solFornecedoresPublicados'); } catch { /* sem storage */ }
  if (anterior === assinatura) return;
  const { error } = await window.supabaseClient.rpc('solicitacao_fornecedores_substituir', { p_nomes: lista });
  if (error) { console.warn('[Solicitações] Falha ao publicar fornecedores:', error); return; }
  try { localStorage.setItem('solFornecedoresPublicados', assinatura); } catch { /* sem storage */ }
}
window.solPublicarFornecedores = solPublicarFornecedores;
