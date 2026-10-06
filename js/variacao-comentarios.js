// ═══════════════════════════════════════════════════════════
// COMENTÁRIOS DE VARIAÇÃO — Visão Micro (Hugo, 06/10/2026)
// ═══════════════════════════════════════════════════════════
// Ícone ao lado do valor da Variação em cada linha da Visão Micro. O clique
// abre um modal onde o analista registra, com data, um ou mais comentários
// sobre o motivo da variação e pode abrir uma ocorrência já preenchida.
// Passar o mouse mostra os comentários e as ocorrências vinculadas.
//
// Vínculo é central × material, SEM período: o mesmo histórico aparece em
// qualquer mês analisado, ordenado pela data que o analista escolheu.
// Compartilhado entre todos os usuários (tabela variacao_comentarios — RLS:
// todo autenticado lê; só o autor ou admin exclui; não há edição).
//
// A ocorrência aberta daqui vira uma linha da MESMA tabela, com oc_id/
// oc_numero e sem texto. Assim o vínculo fica visível pra todos, inclusive
// pra quem a RLS de ocorrencias não deixa ver a ocorrência em si (aí só o
// número aparece, sem status).

let _varComs = [];      // todas as linhas da tabela
let _varComCtx = null;  // { central, material, diff, periodo } do modal aberto

const _VARCOM_OC_STATUS = {
  normal: 'em aberto', urgente: 'em aberto · prazo próximo', vencida: 'vencida',
  'concluída': 'concluída', inconclusiva: 'inconclusiva',
};

function _varComDe(central, material) {
  return _varComs
    .filter(r => r.central === central && r.material === material)
    .sort((a, b) => a.data.localeCompare(b.data) || String(a.created_at).localeCompare(String(b.created_at)));
}

function _varComHoje() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Status só pra quem enxerga a ocorrência (state.ocorrencias segue a RLS
// dela); null = sem acesso, mostra só o número.
function _varComOcStatus(ocId) {
  const o = (state.ocorrencias || []).find(x => x.id === ocId);
  if (!o) return null;
  const st = ocStatusLabel(o);
  return _VARCOM_OC_STATUS[st] || st;
}

// ponytail: sem realtime — comentário de outro analista só chega no boot ou
// ao abrir o modal. Upgrade: canal postgres_changes como _ocRealtimeInit.
async function syncVariacaoComentariosFromSupabase() {
  if (!window.supabaseClient || !window.currentUser) return;
  try {
    _varComs = await fetchAllRows('variacao_comentarios');
    _varComRefreshBtns();
  } catch (err) {
    console.warn('[Supabase] Falha ao buscar comentários de variação:', err);
  }
}

// ── Ícone da linha ──────────────────────────────────────────
// Chamado por buildCentralCard (analitico.js). Central/material vão em
// data-* (lidos via dataset) — nunca interpolados dentro do onclick.
function varComBtnHtml(central, material, periodo) {
  const itens = _varComDe(central, material);
  const nCom  = itens.filter(r => !r.oc_id).length;
  const temOc = itens.some(r => r.oc_id);
  return `<button type="button" class="varcom-btn${nCom ? ' tem-com' : ''}${temOc ? ' tem-oc' : ''}" data-central="${escapeHtml(central)}" data-material="${escapeHtml(material)}" data-periodo="${escapeHtml(periodo || '')}" aria-label="Comentários da variação" onclick="openVarComModal(this)" onmouseenter="showVarComTip(event,this)" onmousemove="_moveHelpTip(event)" onmouseleave="_hideHelpTip()"><i class="ti ${nCom ? 'ti-message-dots' : 'ti-message-plus'}"></i>${nCom ? `<span class="varcom-n">${nCom}</span>` : ''}</button>`;
}

// Troca só os ícones já desenhados (sem re-renderizar o card). Sem
// argumentos = todos.
function _varComRefreshBtns(central, material) {
  document.querySelectorAll('.varcom-btn').forEach(b => {
    if (central != null && (b.dataset.central !== central || b.dataset.material !== material)) return;
    b.outerHTML = varComBtnHtml(b.dataset.central, b.dataset.material, b.dataset.periodo);
  });
}

function showVarComTip(e, btn) {
  const itens = _varComDe(btn.dataset.central, btn.dataset.material);
  const coms  = itens.filter(r => !r.oc_id);
  const ocs   = itens.filter(r => r.oc_id);
  const ult   = coms.slice(-3);
  let html = `<div class="varcom-tip-h">Comentários (${coms.length})</div>`;
  if (!coms.length) html += `<div class="varcom-tip-vazio">Nenhum comentário. Clique para comentar.</div>`;
  if (coms.length > ult.length) html += `<div class="varcom-tip-vazio">+${coms.length - ult.length} anterior(es)</div>`;
  html += ult.map(r => `
    <div class="varcom-tip-item">
      <div class="varcom-item-meta">${fmtDateBR(r.data)} · ${escapeHtml(r.autor_nome || '—')}</div>
      <div class="varcom-tip-txt">${escapeHtml(r.texto)}</div>
    </div>`).join('');
  html += `<div class="varcom-tip-h" style="margin-top:10px">Ocorrências (${ocs.length})</div>`;
  html += ocs.length
    ? ocs.map(r => {
        const st = _varComOcStatus(r.oc_id);
        return `<div class="varcom-tip-item"><i class="ti ti-alert-octagon" style="color:var(--amber)"></i> <strong>${escapeHtml(r.oc_numero || r.oc_id)}</strong> · ${fmtDateBR(r.data)}${st ? ` · ${st}` : ''}</div>`;
      }).join('')
    : `<div class="varcom-tip-vazio">Nenhuma ocorrência vinculada.</div>`;
  _showHelpTip(e, html);
}

// ── Modal ───────────────────────────────────────────────────
function openVarComModal(btn) {
  _hideHelpTip();
  const diff = parseFloat(btn.closest('tr')?.dataset.diff) || 0;
  _varComCtx = { central: btn.dataset.central, material: btn.dataset.material, periodo: btn.dataset.periodo, diff };
  document.getElementById('varcom-sub').textContent = `${_varComCtx.central} · ${_varComCtx.material}`;
  document.getElementById('varcom-var').innerHTML =
    `Variação${_varComCtx.periodo ? ` em ${escapeHtml(_varComCtx.periodo)}` : ''}: <span class="td-mono ${varClass(diff)}">${varSymbol(diff)} ${fmtKg(Math.abs(diff))}</span>`;
  document.getElementById('varcom-data').value  = _varComHoje();
  document.getElementById('varcom-texto').value = '';
  _varComRenderLista();
  document.getElementById('varcom-modal').classList.add('open');
  document.getElementById('varcom-texto').focus();
  // Traz o que outros analistas comentaram desde o boot.
  syncVariacaoComentariosFromSupabase().then(() => { if (_varComCtx) _varComRenderLista(); });
}

function closeVarComModal() {
  document.getElementById('varcom-modal').classList.remove('open');
  _varComCtx = null;
}

function _varComRenderLista() {
  const itens  = _varComDe(_varComCtx.central, _varComCtx.material);
  const meuId  = window.currentUser?.id;
  const admin  = window.currentUser?.role === 'admin';
  document.getElementById('varcom-lista').innerHTML = itens.length ? itens.map(r => {
    const meta    = `<div class="varcom-item-meta">${fmtDateBR(r.data)} · ${escapeHtml(r.autor_nome || '—')}</div>`;
    const excluir = (r.user_id === meuId || admin)
      ? `<button type="button" class="varcom-del" title="${r.oc_id ? 'Desvincular' : 'Excluir'}" onclick="varComExcluir('${r.id}')"><i class="ti ${r.oc_id ? 'ti-unlink' : 'ti-trash'}"></i></button>`
      : '';
    if (r.oc_id) {
      const st  = _varComOcStatus(r.oc_id);
      const ver = st ? `<button type="button" class="btn btn-sm" onclick="closeVarComModal();openOcDetailModal('${r.oc_id}')">Ver</button>` : '';
      return `<div class="varcom-item varcom-item-oc"><i class="ti ti-alert-octagon"></i><div class="varcom-item-body">${meta}<div>Ocorrência <strong>${escapeHtml(r.oc_numero || r.oc_id)}</strong> aberta${st ? ` · ${st}` : ''}</div></div>${ver}${excluir}</div>`;
    }
    return `<div class="varcom-item"><i class="ti ti-message"></i><div class="varcom-item-body">${meta}<div class="varcom-item-txt">${escapeHtml(r.texto)}</div></div>${excluir}</div>`;
  }).join('') : `<div class="varcom-tip-vazio">Nenhum comentário ainda.</div>`;
}

async function _varComInserir(row) {
  if (!window.supabaseClient) { toast('Sem conexão com o Supabase agora.', 'error'); return null; }
  const { data, error } = await window.supabaseClient.from('variacao_comentarios')
    .insert({ ...row, autor_nome: _ocNomeAtor() }).select().single();
  if (error) {
    console.warn('[Supabase] Falha ao salvar comentário de variação:', error);
    toast('Falha ao salvar o comentário.', 'error');
    return null;
  }
  _varComs.push(data);
  _varComRefreshBtns(row.central, row.material);
  if (_varComCtx) _varComRenderLista();
  return data;
}

async function varComAdicionar(btn) {
  const data  = document.getElementById('varcom-data').value;
  const texto = document.getElementById('varcom-texto').value.trim();
  if (!data)  { toast('Informe a data.', 'error'); return false; }
  if (!texto) { toast('Escreva o comentário.', 'error'); return false; }
  if (btn) btn.disabled = true;
  const r = await _varComInserir({ central: _varComCtx.central, material: _varComCtx.material, data, texto });
  if (btn) btn.disabled = false;
  if (!r) return false;
  document.getElementById('varcom-texto').value = '';
  toast('Comentário adicionado.', 'success');
  return true;
}

function varComExcluir(id) {
  const r = _varComs.find(x => x.id === id);
  if (!r) return;
  confirmarDestrutivo({
    title: r.oc_id ? 'Desvincular ocorrência' : 'Excluir comentário',
    sub: `${r.central} · ${r.material}`,
    body: r.oc_id ? 'Remove só o vínculo com a variação. A ocorrência continua existindo.' : 'O comentário será excluído para todos os usuários.',
    confirmLabel: r.oc_id ? 'Desvincular' : 'Excluir',
    onConfirm: async () => {
      const { error } = await window.supabaseClient.from('variacao_comentarios').delete().eq('id', id);
      if (error) { toast('Falha ao excluir.', 'error'); return; }
      _varComs = _varComs.filter(x => x.id !== id);
      _varComRefreshBtns(r.central, r.material);
      if (_varComCtx) _varComRenderLista();
    },
  });
}

// Abre o modal Nova Ocorrência (ocorrencias.js) já preenchido. O vínculo só
// é gravado quando a ocorrência é de fato salva (onCriada).
async function varComAbrirOcorrencia() {
  // Comentário digitado e não adicionado entra antes — é o motivo da
  // ocorrência que o analista acabou de escrever.
  if (document.getElementById('varcom-texto').value.trim() && !(await varComAdicionar())) return;
  const ctx  = _varComCtx;
  const coms = _varComDe(ctx.central, ctx.material).filter(r => !r.oc_id);
  const sinal = ctx.diff > 0 ? '+' : ctx.diff < 0 ? '−' : '';
  const linhas = [`Variação de estoque (Real − Teórico)${ctx.periodo ? ` em ${ctx.periodo}` : ''}: ${sinal}${fmtKg(Math.abs(ctx.diff))} (${varLabel(ctx.diff)}).`];
  if (coms.length) linhas.push('', 'Comentários do analista:', ...coms.map(r => `• ${fmtDateBR(r.data)} (${r.autor_nome || '—'}): ${r.texto}`));
  // A Micro usa a sigla; o select de Central prefere o nome original.
  const filial = getFilialLookupIndex().exact.get(normalizeText(ctx.central));
  closeVarComModal();
  openOcorrenciaModal(null, {
    central:   (filial?.origem || filial?.alias || ctx.central).trim(),
    material:  ctx.material,
    descricao: linhas.join('\n'),
    onCriada:  (oc) => _varComInserir({ central: ctx.central, material: ctx.material, data: oc.dataAbertura, oc_id: oc.id, oc_numero: oc.numero }),
  });
}

// Ocorrência excluída (deleteOcorrencia) — leva o vínculo junto. A RLS só
// deixa o autor do vínculo/admin apagar; pros demais ele fica (o .select()
// devolve só o que saiu de fato). Desfazer a exclusão não recria o vínculo.
async function _varComDesvincularOc(ocId) {
  if (!window.supabaseClient || !_varComs.some(r => r.oc_id === ocId)) return;
  const { data, error } = await window.supabaseClient.from('variacao_comentarios').delete().eq('oc_id', ocId).select('id, central, material');
  if (error || !data?.length) return;
  const ids = new Set(data.map(r => r.id));
  _varComs = _varComs.filter(r => !ids.has(r.id));
  data.forEach(r => _varComRefreshBtns(r.central, r.material));
}

Object.assign(window, {
  syncVariacaoComentariosFromSupabase,
  varComBtnHtml,
  showVarComTip,
  openVarComModal,
  closeVarComModal,
  varComAdicionar,
  varComExcluir,
  varComAbrirOcorrencia,
  _varComDesvincularOc,
});
