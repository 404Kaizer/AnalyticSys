// ═══════════════════════════════════════════════════════════
// E-MAIL DOS RELATÓRIOS DE REGIONAL (Hugo, 18/11/2026)
// Sem servidor de e-mail: gera um .eml com "X-Unsent: 1" — o Outlook clássico
// (Windows) abre como e-mail NOVO, já com destinatários, assunto, resumo no
// corpo e o HTML do painel anexado; o analista revisa e envia.
//   Para: contato(s) da regional · Cc: contatos fixos (Configurações).
//   Único: a regional selecionada · Em massa: um .eml por regional da lista
//   (com os filtros da tela). Cada preparo vai para relatorio_envios.
// ═══════════════════════════════════════════════════════════

const _re = { contatos: null, envios: null, ocupado: false };
const RE_COR = { critico: '#ef4444', urgente: '#f97316', atencao: '#f59e0b', bom: '#22c55e' };
const _reAdm = () => document.body.classList.contains('role-admin');
const _reNorm = (t) => (typeof normalizeText === 'function' ? normalizeText(t) : String(t || '').trim().toLowerCase());

async function _reCarregar(forcar) {
  if (_re.contatos && !forcar) return _re.contatos;
  const { data, error } = await window.supabaseClient.from('relatorio_contatos')
    .select('id, nome, email, tipo, regional, ativo').order('tipo').order('regional').order('nome');
  if (error) throw error;
  return (_re.contatos = data || []);
}

function _reDestinatarios(regional) {
  const at = (_re.contatos || []).filter(c => c.ativo);
  return {
    para: at.filter(c => c.tipo === 'regional' && _reNorm(c.regional) === _reNorm(regional)).map(c => c.email),
    cc: at.filter(c => c.tipo === 'fixo').map(c => c.email)
  };
}

// ── Botões (barra de filtros do painel de Operações) ──────────────────────
function reEmailBtnsHtml() {
  const unico = _mp.sel?.tipo === 'regional'
    ? `<button class="btn btn-sm" onclick="reEmailRegional(this)" title="Abre no Outlook um e-mail novo para os contatos desta regional, com o resumo e o relatório anexado"><i class="ti ti-mail"></i> Preparar e-mail</button>` : '';
  return `${unico}<button class="btn btn-sm" onclick="reEmailTodas(this)" title="Um e-mail (.eml) por regional da lista, com os filtros da tela"><i class="ti ti-mails"></i> E-mails de todas as regionais</button>`;
}

// ── MIME ──────────────────────────────────────────────────────────────────
function _reB64(str) {
  const b = new TextEncoder().encode(str);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
const _reLinhas = (b64) => b64.replace(/.{1,76}/g, '$&\r\n');
// ponytail: assunto em uma palavra codificada só (passa de 75 caracteres); o
// Outlook aceita — dividir em várias se algum cliente reclamar.
const _reCab = (t) => /^[\x20-\x7e]*$/.test(t) ? t : `=?UTF-8?B?${_reB64(t)}?=`;

function _reEml({ para, cc, assunto, corpo, anexo, nomeAnexo }) {
  const b = 'reb-' + Date.now().toString(36);
  return [
    'X-Unsent: 1',
    `To: ${para.join(', ')}`,
    cc.length ? `Cc: ${cc.join(', ')}` : null,
    `Subject: ${_reCab(assunto)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${b}"`,
    '',
    `--${b}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    _reLinhas(_reB64(corpo)),
    `--${b}`,
    `Content-Type: text/html; charset=UTF-8; name="${nomeAnexo}"`,
    `Content-Disposition: attachment; filename="${nomeAnexo}"`,
    'Content-Transfer-Encoding: base64',
    '',
    _reLinhas(_reB64(anexo)),
    `--${b}--`,
    ''
  ].filter(l => l !== null).join('\r\n');
}

// ── Resumo do corpo (tabelas com estilo inline: é o que o Outlook respeita) ─
function _reCorpoHtml(regional, ps, periodo, quem) {
  const v = ps.reduce((t, p) => t + p.v, 0), rs = ps.reduce((t, p) => t + (p.rs || 0), 0);
  const sd = _mpSaude(ps);
  const cor = (x) => x < 0 ? '#ef4444' : x > 0 ? '#f59e0b' : '#475569';
  const top = [...ps].sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 5);
  const td = 'padding:6px 10px;border-bottom:1px solid #e2e8f0;font-size:13px';
  const niveis = MP_NIVEIS.map(([l, rot]) => {
    const n = ps.filter(p => p.nivel === l).length;
    return `<td style="${td};text-align:center"><div style="font-size:18px;font-weight:700;color:${RE_COR[l]}">${n}</div><div style="font-size:11px;color:#64748b">${rot}</div></td>`;
  }).join('');
  return `<!doctype html><html><body style="margin:0;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
<div style="max-width:640px;padding:16px">
<p style="font-size:14px">Olá,</p>
<p style="font-size:14px">Segue o relatório de Operações da regional <b>${_moEsc(regional)}</b>, período de ${_moEsc(periodo)}.</p>
<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;margin:12px 0;border:1px solid #e2e8f0">
  <tr><td style="${td};color:#64748b">Saúde da regional</td><td style="${td};font-weight:700;color:${RE_COR[sd.nivel] || '#0f172a'}">${Math.round(sd.score)} · ${MP_NIVEL_NOME[sd.nivel] || ''}</td></tr>
  <tr><td style="${td};color:#64748b">Variação do período</td><td style="${td};font-weight:700;color:${cor(v)}">${_moPesoSinal(v)}${rs ? ` · ${_moRs(rs)}` : ''}</td></tr>
  <tr><td style="${td};color:#64748b">Pares central × material</td><td style="${td}">${ps.length}</td></tr>
</table>
<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;margin:12px 0;border:1px solid #e2e8f0"><tr>${niveis}</tr></table>
${top.length ? `<p style="font-size:13px;font-weight:700;margin:16px 0 4px">Piores variações</p>
<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;border:1px solid #e2e8f0">${top.map(p => `<tr>
  <td style="${td}"><b>${_moEsc(p.central)}</b> · ${_moEsc(p.material)}</td><td style="${td};text-align:right;white-space:nowrap;font-weight:700;color:${cor(p.v)}">${_moPesoSinal(p.v)}</td></tr>`).join('')}</table>` : ''}
<p style="font-size:13px;margin-top:16px">O relatório completo, com gráficos e filtros, está no arquivo HTML anexo — abra no navegador (também funciona no celular).</p>
${quem ? `<p style="font-size:13px;color:#64748b">${_moEsc(quem)}</p>` : ''}
</div></body></html>`;
}

// ── Preparo ───────────────────────────────────────────────────────────────
// Espera o painel da regional terminar (acumulado, gráficos, linha do tempo e
// saúde no período) — o anexo sai igual ao Exportar HTML.
async function _reAguardarPainel() {
  for (let t = 0; t < 1200; t++) {
    const e = _mp._esc, tend = document.getElementById('mp-tend');
    if (e && e.s === _mp.sel && !(tend && /calculando/i.test(tend.textContent))) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

async function _rePrepararAtual(modo) {
  const s = _mp.sel, regional = s.regional;
  const ps = (_mp._esc?.ps) || [];
  const r = await _mpGerarHtml();
  if (!r) throw new Error('painel indisponível');
  const P = muralPeriodo(), periodo = `${fmtPtDate(P.ini)} a ${fmtPtDate(P.fim)}`;
  const quem = window.currentUser?.nome_exibicao || window.currentUser?.nome_completo || '';
  const { para, cc } = _reDestinatarios(regional);
  const assunto = `Relatório de Operações · Regional ${regional} · ${periodo}`;
  const eml = _reEml({ para, cc, assunto, corpo: _reCorpoHtml(regional, ps, periodo, quem), anexo: r.html, nomeAnexo: r.nome });
  _mpBaixar(eml, r.nome.replace(/\.html$/, '.eml'), 'message/rfc822');
  return { user_nome: quem || window.currentUser?.email || null, regional, para, cc, assunto, modo };
}

async function _reRegistrar(linhas) {
  if (!linhas.length) return;
  const { error } = await window.supabaseClient.from('relatorio_envios').insert(linhas);
  if (error) console.warn('[E-mail] Falha ao registrar o preparo:', error);
  _re.envios = null;
}

async function _rePreparar() {
  await _reCarregar();
  // Registros na linha do tempo: carrega antes, para entrarem no anexo.
  if (typeof solCarregar === 'function' && typeof _sol !== 'undefined' && !_sol.lista.length) {
    try { await solCarregar(); _mp._tlSolPedido = true; } catch (_) { /* sem Registros */ }
  }
}

async function reEmailRegional(btn) {
  if (_re.ocupado) return;
  _re.ocupado = true; if (btn) btn.disabled = true;
  try {
    await _rePreparar();
    if (_mp._esc) _mpTlAtualizar(_mp._esc.ps, _mp._esc.s);
    if (!await _reAguardarPainel()) throw new Error('o painel não terminou de calcular');
    const linha = await _rePrepararAtual('unico');
    await _reRegistrar([linha]);
    toast(linha.para.length ? `E-mail da regional ${linha.regional} baixado — abra o .eml para revisar e enviar no Outlook.`
      : `E-mail baixado, mas a regional ${linha.regional} não tem contato cadastrado (Configurações → Contatos dos relatórios).`, linha.para.length ? 'success' : 'error');
  } catch (err) {
    console.error('[E-mail] Erro ao preparar:', err);
    toast('Não foi possível preparar o e-mail: ' + (err.message || err), 'error');
  } finally {
    _re.ocupado = false; if (btn) btn.disabled = false;
  }
}

async function reEmailTodas(btn) {
  if (_re.ocupado) return;
  const regionais = [...new Set((_mp._todos || []).map(p => p.regional))].filter(r => r && r !== '—').sort((a, b) => a.localeCompare(b, 'pt-BR'));
  if (!regionais.length) { toast('Nenhuma regional na lista com os filtros atuais.', 'error'); return; }
  if (!confirm(`Preparar ${regionais.length} e-mail(s), um por regional, com os filtros da tela?\n\n${regionais.join(', ')}\n\nO navegador pode pedir permissão para baixar vários arquivos.`)) return;
  _re.ocupado = true;
  const antes = _mp.sel, linhas = [], semContato = [];
  try {
    await _rePreparar();
    for (let i = 0; i < regionais.length; i++) {
      _mp.sel = { tipo: 'regional', regional: regionais[i], via: 'reg' };
      muralRender();
      const b = document.querySelector('.mp-exp-btn [onclick^="reEmailTodas"]'); // a barra é redesenhada
      if (b) { b.disabled = true; b.innerHTML = `<i class="ti ti-loader-2"></i> ${i + 1}/${regionais.length} · ${_moEsc(regionais[i])}`; }
      if (!await _reAguardarPainel()) throw new Error(`a regional ${regionais[i]} não terminou de calcular`);
      const linha = await _rePrepararAtual('massa');
      linhas.push(linha);
      if (!linha.para.length) semContato.push(linha.regional);
      await new Promise(r => setTimeout(r, 400)); // downloads espaçados
    }
    toast(`${linhas.length} e-mail(s) baixado(s).` + (semContato.length ? ` Sem contato cadastrado: ${semContato.join(', ')}.` : ''), semContato.length ? 'error' : 'success');
  } catch (err) {
    console.error('[E-mail] Erro no envio em massa:', err);
    toast(`Parou em ${linhas.length}/${regionais.length}: ` + (err.message || err), 'error');
  } finally {
    await _reRegistrar(linhas);
    _re.ocupado = false;
    _mp.sel = antes; muralRender(); // redesenha a barra com o botão no estado normal
  }
}

// ── Configurações → Contatos dos relatórios ───────────────────────────────
async function reConfigRender() {
  const box = document.getElementById('re-config');
  if (!box) return;
  const adm = _reAdm();
  let contatos = [], envios = [];
  try {
    contatos = await _reCarregar(true);
    if (!_re.envios) {
      const { data, error } = await window.supabaseClient.from('relatorio_envios')
        .select('created_at, user_nome, regional, para, cc, modo').order('created_at', { ascending: false }).limit(15);
      if (error) throw error;
      _re.envios = data || [];
    }
    envios = _re.envios;
  } catch (err) {
    console.warn('[E-mail] Falha ao carregar contatos/histórico:', err);
    box.innerHTML = `<div class="section-title">Contatos dos Relatórios</div><p class="td-muted" style="margin-bottom:24px">Não foi possível carregar: ${escapeHtml(err.message || String(err))}</p>`;
    return;
  }
  const linhas = contatos.map(c => `<tr>
      <td><span class="re-tipo ${c.tipo}">${c.tipo === 'fixo' ? 'Fixo (Cc)' : 'Regional (Para)'}</span></td>
      <td>${c.tipo === 'fixo' ? '<span class="td-muted">todas</span>' : escapeHtml(c.regional || '')}</td>
      <td>${escapeHtml(c.nome || '')}</td>
      <td class="td-mono">${escapeHtml(c.email)}</td>
      <td>${c.ativo ? 'Ativo' : '<span class="td-muted">Inativo</span>'}</td>
      <td>${adm ? `<div style="display:flex;gap:6px">
        <button class="btn-icon" onclick="reContatoAbrir('${c.id}')" title="Editar"><i class="ti ti-pencil"></i></button>
        <button class="btn-icon danger" onclick="reContatoRemover('${c.id}')" title="Excluir"><i class="ti ti-trash"></i></button></div>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="6"><div class="empty-state"><i class="ti ti-address-book"></i><p>Nenhum contato cadastrado.</p></div></td></tr>';
  const hist = envios.map(e => `<tr>
      <td class="td-muted" style="white-space:nowrap">${new Date(e.created_at).toLocaleString('pt-BR')}</td>
      <td>${escapeHtml(e.regional)}</td>
      <td>${escapeHtml(e.user_nome || '')}</td>
      <td style="max-width:340px">${escapeHtml((e.para || []).join(', ') || '—')}${(e.cc || []).length ? `<div class="td-muted" style="font-size:11px">Cc: ${escapeHtml(e.cc.join(', '))}</div>` : ''}</td>
      <td>${e.modo === 'massa' ? 'Em massa' : 'Único'}</td>
    </tr>`).join('') || '<tr><td colspan="5"><div class="empty-state"><i class="ti ti-mail"></i><p>Nenhum e-mail preparado ainda.</p></div></td></tr>';
  box.innerHTML = `<div class="section-title">Contatos dos Relatórios</div>
    <div class="table-card" style="margin-bottom:24px">
      <div class="table-header">
        <div style="display:flex;flex-direction:column;gap:2px">
          <span class="table-title"><i class="ti ti-address-book"></i> E-mails do relatório de regional</span>
          <span style="font-size:11px;color:var(--text3)">Operações → <strong style="color:var(--text2)">Preparar e-mail</strong>: Para = contato da regional · Cc = contatos fixos</span>
        </div>
        <div class="table-toolbar">${adm ? '<button class="btn btn-primary" onclick="reContatoAbrir()"><i class="ti ti-plus"></i> Novo contato</button>' : ''}</div>
      </div>
      <div class="table-scroll"><table>
        <thead><tr><th>Tipo</th><th>Regional</th><th>Nome</th><th>E-mail</th><th>Situação</th><th></th></tr></thead>
        <tbody>${linhas}</tbody></table></div>
    </div>
    <div class="table-card" style="margin-bottom:24px">
      <div class="table-header"><span class="table-title"><i class="ti ti-history"></i> Últimos e-mails preparados</span></div>
      <div class="table-scroll"><table>
        <thead><tr><th>Quando</th><th>Regional</th><th>Quem preparou</th><th>Destinatários</th><th>Modo</th></tr></thead>
        <tbody>${hist}</tbody></table></div>
    </div>`;
}

function _reRegionaisCadastro() {
  return [...new Set((state.filiais || []).map(f => (f.regional || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function reContatoAbrir(id) {
  if (!_reAdm()) return;
  const c = id ? (_re.contatos || []).find(x => x.id === id) : null;
  let m = document.getElementById('modal-re-contato');
  if (!m) {
    m = document.createElement('div');
    m.className = 'modal-overlay'; m.id = 'modal-re-contato';
    document.body.appendChild(m);
  }
  const regs = _reRegionaisCadastro();
  if (c?.regional && !regs.includes(c.regional)) regs.push(c.regional);
  m.innerHTML = `<div class="modal" style="max-width:460px;width:94vw">
    <div class="modal-title"><i class="ti ti-address-book"></i> ${c ? 'Editar contato' : 'Novo contato'}</div>
    <div class="modal-sub">destinatário do e-mail do relatório de regional</div>
    <input type="hidden" id="re-id" value="${c ? escapeHtml(c.id) : ''}">
    <div class="form-grid" style="grid-template-columns:1fr">
      <div class="form-group"><label class="form-label">Tipo <span style="color:var(--red)">*</span></label>
        <select class="form-input" id="re-tipo" onchange="document.getElementById('re-reg-g').style.display = this.value === 'regional' ? '' : 'none'">
          <option value="regional"${c?.tipo !== 'fixo' ? ' selected' : ''}>Regional — vai no Para da sua regional</option>
          <option value="fixo"${c?.tipo === 'fixo' ? ' selected' : ''}>Fixo — vai em Cópia (Cc) de todas</option>
        </select></div>
      <div class="form-group" id="re-reg-g"${c?.tipo === 'fixo' ? ' style="display:none"' : ''}><label class="form-label">Regional <span style="color:var(--red)">*</span></label>
        <select class="form-input" id="re-regional"><option value="">Selecione a regional</option>${regs.map(r => `<option${c?.regional === r ? ' selected' : ''}>${escapeHtml(r)}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Nome</label><input class="form-input" id="re-nome" value="${escapeHtml(c?.nome || '')}"></div>
      <div class="form-group"><label class="form-label">E-mail <span style="color:var(--red)">*</span></label><input class="form-input" id="re-email" type="email" value="${escapeHtml(c?.email || '')}"></div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer"><input type="checkbox" id="re-ativo"${!c || c.ativo ? ' checked' : ''} style="accent-color:var(--accent)"> Ativo</label>
    </div>
    <div class="modal-actions" style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
      <button class="btn" onclick="closeModal('modal-re-contato')">Cancelar</button>
      <button class="btn btn-primary" onclick="reContatoSalvar()"><i class="ti ti-check"></i> Salvar</button>
    </div></div>`;
  openModal('modal-re-contato');
}

async function reContatoSalvar() {
  const tipo = document.getElementById('re-tipo').value;
  const rec = {
    tipo,
    regional: tipo === 'regional' ? document.getElementById('re-regional').value : null,
    nome: document.getElementById('re-nome').value.trim(),
    email: document.getElementById('re-email').value.trim(),
    ativo: document.getElementById('re-ativo').checked,
    updated_at: new Date().toISOString()
  };
  if (tipo === 'regional' && !rec.regional) { toast('Selecione a regional', 'error'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rec.email)) { toast('Informe um e-mail válido', 'error'); return; }
  const id = document.getElementById('re-id').value;
  const q = window.supabaseClient.from('relatorio_contatos');
  const { error } = id ? await q.update(rec).eq('id', id) : await q.insert(rec);
  if (error) { console.warn('[E-mail] Falha ao salvar contato:', error); toast('Não foi possível salvar: ' + error.message, 'error'); return; }
  closeModal('modal-re-contato');
  toast(id ? 'Contato atualizado' : 'Contato cadastrado');
  reConfigRender();
}

async function reContatoRemover(id) {
  if (!_reAdm() || !confirm('Excluir este contato?')) return;
  const { error } = await window.supabaseClient.from('relatorio_contatos').delete().eq('id', id);
  if (error) { toast('Não foi possível excluir: ' + error.message, 'error'); return; }
  toast('Contato removido', 'error');
  reConfigRender();
}
