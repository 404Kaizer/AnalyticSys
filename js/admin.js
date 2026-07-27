'use strict';

// ═══════════════════════════════════════════════════════════
// ADMINISTRAÇÃO — usuários e dados
// ═══════════════════════════════════════════════════════════
// Visível só para quem tem role 'admin' (o tab #tab-admin é mostrado em
// auth.js/bootApp). A segurança de verdade está nas políticas de RLS de
// cada tabela (is_admin() dá acesso a tudo) — esta tela é só a interface;
// mesmo que alguém force a navegação pra cá sem ser admin, as chamadas ao
// Supabase abaixo voltariam vazias/bloqueadas pelo próprio banco.
//
// "Dados por módulo" cobre as 18 tabelas de dados do sistema (ver
// ADMIN_MODULOS abaixo) — todas exceto `profiles`, que já tem sua própria
// aba "Usuários". Atualizado em 27/07 pra refletir a Fase 4 completa
// (antes só listava ocorrencias/acoes_relatorio, os únicos módulos
// migrados na época em que esta tela foi construída). `readOnly` marca as
// 2 tabelas append-only (ajustes_excluidos, notas_ajuste) que só têm
// policy de INSERT/SELECT no banco — botões de editar/excluir ficam
// ocultos pra essas, porque a tentativa falharia na RLS mesmo assim.
const ADMIN_MODULOS = {
  // Cadastro / configuração
  configs:                  { label: 'Configurações',              cols: ['key', 'value', 'descricao'] },
  filiais:                  { label: 'Filiais',                    cols: ['origem', 'alias', 'cnpj', 'regional'] },
  materiais:                { label: 'Materiais',                  cols: ['origem', 'alias', 'categoria'] },
  grupos_materiais:         { label: 'Grupos de Materiais',        cols: ['nome'] },
  regionais_centrais:       { label: 'Regionais',                  cols: ['nome'] },
  imports:                  { label: 'Log de Importações',         cols: ['arquivo', 'modulo', 'registros', 'status'] },
  // Operacional
  ocorrencias:              { label: 'Ocorrências',                cols: ['central', 'material', 'motivo', 'concluida', 'data_abertura'] },
  acoes_relatorio:          { label: 'Ações de Relatório',         cols: ['nivel', 'categorias', 'acoes', 'created'] },
  inv_justificativas:       { label: 'Justificativas de Inventário', cols: ['k', 'op', 'saldo', 'documento_sap'] },
  sap_fechamento_overrides: { label: 'Overrides de Fechamento SAP', cols: ['chave'] },
  ajustes_sistemicos:       { label: 'DAI / Ajuste Sistêmico',     cols: ['tag', 'numero', 'central', 'analista', 'sap_documento'] },
  ajustes_excluidos:        { label: 'Log de Exclusão de DAI',     cols: ['dai_tag', 'dai_numero', 'central', 'excluido_por'], readOnly: true },
  notas_ajuste:             { label: 'Notas de Crédito/Débito',    cols: ['numero', 'tipo', 'central', 'valor_total', 'responsavel_nome'], readOnly: true },
  // Módulos grandes (Fase 4)
  lancamentos:              { label: 'Lançamentos',                cols: ['central', 'material', 'peso', 'valor_total', 'fonte', 'editado'] },
  producao:                 { label: 'Produção',                   cols: ['central', 'mes', 'producao', 'custo_medio'] },
  entradas:                 { label: 'Entradas',                   cols: ['central_compra', 'material', 'peso', 'valor_total', 'nf'] },
  saidas:                   { label: 'Saídas',                     cols: ['central', 'material', 'peso', 'valor_total', 'os'] },
  sap:                      { label: 'SAP',                        cols: ['central', 'material', 'movimento', 'peso', 'valor_total'] },
};

let _adminProfiles = [];        // cache do último fetch de profiles (email por user_id)
let _adminCurrentRows = [];     // linhas do módulo atualmente exibido em "Dados"
let _adminEditContext = null;   // { modulo, id } do registro em edição
let _adminPresenceInterval = null; // atualização automática enquanto a seção Usuários está visível

// ── Paginação de "Dados por módulo" — sempre por cursor (id > último
// visto), nunca por OFFSET. Mesma convenção usada em fetchAllRows
// (normalize.js) pro resto do sistema — ver "Decisões de arquitetura" no
// documento de handoff. _adminPageCursors[i] guarda o id a partir do qual
// a página i começa (null = do início); a pilha cresce conforme o ADM
// avança, e "Anterior" só recua no que já foi visitado (sem precisar de
// OFFSET pra "voltar").
const ADMIN_PAGE_SIZE = 50;
let _adminPageCursors = [null];
let _adminPageIndex = 0;
let _adminHasNextPage = false;
let _adminPageTotal = null; // contagem aproximada da tabela atual (null = ainda não buscada)

function _adminEsc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Status de presença (Online/Away/Offline) ────────────────
// Calculado no cliente a partir de last_seen — não há assinatura em tempo
// real (isso fica pra Fase 5, com Supabase Realtime); a lista se atualiza
// sozinha a cada 30s enquanto a seção Usuários estiver aberta, o que já dá
// uma visão "quase ao vivo" sem a complexidade de uma conexão persistente.
const PRESENCE_ONLINE_MS = 10 * 60 * 1000;      // ≤10min = online
const PRESENCE_AWAY_MS   = 4 * 60 * 60 * 1000;  // 10min–4h = away · >4h = offline
const PRESENCE_POLL_MS   = 30 * 1000;

function _adminStatusInfo(lastSeen) {
  if (!lastSeen) return { key: 'offline', label: 'Offline', color: 'var(--text3)', bg: 'var(--bg4)' };
  const diff = Date.now() - new Date(lastSeen).getTime();
  if (diff <= PRESENCE_ONLINE_MS) return { key: 'online', label: 'Online', color: 'var(--green)', bg: 'var(--green-bg)' };
  if (diff <= PRESENCE_AWAY_MS)   return { key: 'away',   label: 'Away',   color: 'var(--amber)', bg: 'var(--amber-bg)' };
  return { key: 'offline', label: 'Offline', color: 'var(--text3)', bg: 'var(--bg4)' };
}

// ── Navegação entre as duas seções ─────────────────────────
function adminShowSection(section) {
  const elUsuarios = document.getElementById('admin-section-usuarios');
  const elDados     = document.getElementById('admin-section-dados');
  if (elUsuarios) elUsuarios.style.display = section === 'usuarios' ? '' : 'none';
  if (elDados)    elDados.style.display    = section === 'dados' ? '' : 'none';
  document.getElementById('admin-subnav-usuarios')?.classList.toggle('active', section === 'usuarios');
  document.getElementById('admin-subnav-dados')?.classList.toggle('active', section === 'dados');

  if (section === 'usuarios') adminLoadUsuarios();
  if (section === 'dados') adminLoadModulo();

  // Só mantém o polling de presença rodando enquanto a seção Usuários
  // estiver de fato visível — evita chamadas desnecessárias em segundo plano.
  clearInterval(_adminPresenceInterval);
  if (section === 'usuarios') {
    _adminPresenceInterval = setInterval(() => adminLoadUsuarios(true), PRESENCE_POLL_MS);
  }
}

// Chamada ao entrar na página (ver navigate() em ui.js — ou dispara na
// primeira vez que a página fica visível). Idempotente.
function renderAdminPage() {
  adminShowSection('usuarios');
}

// ── Seção: Usuários ─────────────────────────────────────────
// silent=true é usado só pelo polling automático (a cada 30s) — evita
// piscar "Carregando..." toda hora. Clique manual em "Atualizar" e a
// primeira carga da página sempre mostram o feedback visual normalmente.
async function adminLoadUsuarios(silent) {
  // Segurança extra: se o polling automático continuar rodando depois do
  // ADM ter saído da página (ex.: clicou em outro tab), para sozinho na
  // próxima vez que o intervalo disparar, em vez de ficar chamando o
  // Supabase em segundo plano para sempre.
  const pageEl = document.getElementById('page-admin');
  if (_adminPresenceInterval && pageEl && !pageEl.classList.contains('active')) {
    clearInterval(_adminPresenceInterval);
    _adminPresenceInterval = null;
    return;
  }

  const tbody = document.getElementById('admin-usuarios-tbody');
  if (!tbody) return;
  if (!silent) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><i class="ti ti-loader"></i><p>Carregando...</p></div></td></tr>';
  }

  const { data, error } = await window.supabaseClient
    .from('profiles')
    .select('id, email, role, created_at, last_seen')
    .order('created_at', { ascending: true });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><i class="ti ti-alert-triangle"></i><p>Falha ao carregar: ${_adminEsc(error.message)}</p></div></td></tr>`;
    return;
  }

  _adminProfiles = data || [];

  if (!_adminProfiles.length) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><i class="ti ti-users"></i><p>Nenhum usuário encontrado.</p></div></td></tr>';
    return;
  }

  tbody.innerHTML = _adminProfiles.map(u => {
    const isSelf = u.id === window.currentUser?.id;
    const criadoEm = u.created_at ? new Date(u.created_at).toLocaleDateString('pt-BR') : '—';
    const status = _adminStatusInfo(u.last_seen);
    return `<tr>
      <td>${_adminEsc(u.email)}${isSelf ? ' <span style="color:var(--text3);font-size:11px">(você)</span>' : ''}</td>
      <td>
        <span style="display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;color:${status.color};background:${status.bg};border-radius:999px;padding:3px 10px">
          <span style="width:7px;height:7px;border-radius:50%;background:${status.color};display:inline-block"></span>
          ${status.label}
        </span>
      </td>
      <td>
        <select class="form-select" style="font-size:12px;padding:4px 8px;width:auto"
          onchange="adminAlterarPapel('${u.id}', this.value)"
          ${isSelf ? 'disabled title="Não é possível alterar o próprio papel por aqui — peça a outro admin, se precisar."' : ''}>
          <option value="user" ${u.role === 'user' ? 'selected' : ''}>Usuário</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrador</option>
        </select>
      </td>
      <td style="color:var(--text2)">${criadoEm}</td>
      <td></td>
    </tr>`;
  }).join('');
}

async function adminAlterarPapel(userId, novoPapel) {
  const label = novoPapel === 'admin' ? 'Administrador' : 'Usuário';
  if (!confirm(`Confirma alterar o papel deste usuário para "${label}"?`)) {
    adminLoadUsuarios(); // desfaz a troca visual do <select>
    return;
  }
  const { error } = await window.supabaseClient.from('profiles').update({ role: novoPapel }).eq('id', userId);
  if (error) {
    toast('Falha ao alterar o papel: ' + error.message, 'error');
    adminLoadUsuarios();
    return;
  }
  toast('Papel atualizado.', 'success');
  adminLoadUsuarios();
}

// ── Seção: Dados por módulo ─────────────────────────────────
// resetPaging=true (padrão): troca de módulo ou clique em "Atualizar" —
// sempre volta pra primeira página. resetPaging=false: usado só pelas
// funções de navegação abaixo, que já ajustaram _adminPageIndex antes de
// chamar.
async function adminLoadModulo(resetPaging = true) {
  const select = document.getElementById('admin-modulo-select');
  const modulo = select?.value;
  const cfg = ADMIN_MODULOS[modulo];
  const thead = document.getElementById('admin-dados-thead');
  const tbody = document.getElementById('admin-dados-tbody');
  if (!cfg || !thead || !tbody) return;

  if (resetPaging) {
    _adminPageCursors = [null];
    _adminPageIndex = 0;
    _adminPageTotal = null;
  }

  thead.innerHTML = `<tr><th>Dono</th>${cfg.cols.map(c => `<th>${_adminEsc(c)}</th>`).join('')}<th></th></tr>`;
  const colspan = cfg.cols.length + 2;
  tbody.innerHTML = `<tr><td colspan="${colspan}"><div class="empty-state"><i class="ti ti-loader"></i><p>Carregando...</p></div></td></tr>`;
  _adminSetPageInfo('Carregando...');

  if (!_adminProfiles.length) {
    const { data } = await window.supabaseClient.from('profiles').select('id, email');
    _adminProfiles = data || [];
  }
  const emailPorId = Object.fromEntries(_adminProfiles.map(p => [p.id, p.email]));

  // Busca contagem aproximada só quando a paginação é resetada (troca de
  // módulo/atualizar) — não a cada página, pra não gastar uma query extra
  // em toda virada de página. head:true não traz linhas, só o total.
  if (_adminPageTotal === null) {
    window.supabaseClient.from(modulo).select('*', { count: 'exact', head: true })
      .then(({ count }) => { _adminPageTotal = count ?? null; _adminSetPageInfo(); });
  }

  // Busca PAGE_SIZE + 1 pra saber com certeza se existe próxima página,
  // sem precisar de uma segunda query — depois corta o excedente.
  const cursor = _adminPageCursors[_adminPageIndex];
  let query = window.supabaseClient.from(modulo).select('*').order('id', { ascending: true }).limit(ADMIN_PAGE_SIZE + 1);
  if (cursor !== null) query = query.gt('id', cursor);

  const { data, error } = await query;
  if (error) {
    tbody.innerHTML = `<tr><td colspan="${colspan}"><div class="empty-state"><i class="ti ti-alert-triangle"></i><p>Falha ao carregar: ${_adminEsc(error.message)}</p></div></td></tr>`;
    _adminSetPageInfo('—');
    return;
  }

  const rows = data || [];
  _adminHasNextPage = rows.length > ADMIN_PAGE_SIZE;
  _adminCurrentRows = _adminHasNextPage ? rows.slice(0, ADMIN_PAGE_SIZE) : rows;

  // Registra o cursor da próxima página (se ainda não tiver sido
  // registrado nessa navegação) — permite "Próxima" sem OFFSET.
  if (_adminHasNextPage && _adminCurrentRows.length) {
    _adminPageCursors[_adminPageIndex + 1] = _adminCurrentRows[_adminCurrentRows.length - 1].id;
  }

  if (!_adminCurrentRows.length) {
    tbody.innerHTML = `<tr><td colspan="${colspan}"><div class="empty-state"><i class="ti ti-database-off"></i><p>Nenhum registro nesta tabela.</p></div></td></tr>`;
    _adminSetPageInfo();
    return;
  }

  tbody.innerHTML = _adminCurrentRows.map(row => {
    const dono = emailPorId[row.user_id] || '—';
    const cells = cfg.cols.map(c => {
      let v = row[c];
      if (Array.isArray(v)) v = v.join(', ');
      if (typeof v === 'boolean') v = v ? 'Sim' : 'Não';
      if (v && String(v).length > 60) v = String(v).slice(0, 60) + '…';
      return `<td>${_adminEsc(v ?? '—')}</td>`;
    }).join('');
    const acoes = cfg.readOnly
      ? `<span style="font-size:11px;color:var(--text3)" title="Registro append-only — sem edição/exclusão por design"><i class="ti ti-lock"></i> Somente leitura</span>`
      : `<button class="btn-icon" title="Editar" onclick="adminAbrirEdicao('${modulo}','${row.id}')"><i class="ti ti-edit"></i></button>
      <button class="btn-icon danger" title="Excluir" onclick="adminExcluirRegistro('${modulo}','${row.id}')"><i class="ti ti-trash"></i></button>`;
    return `<tr>
      <td style="font-size:11px;color:var(--text3)">${_adminEsc(dono)}</td>
      ${cells}
      <td style="white-space:nowrap">
        ${acoes}
      </td>
    </tr>`;
  }).join('');

  _adminSetPageInfo();
}

// Atualiza o rótulo "Página X — mostrando N registros (de ~total)" e o
// estado habilitado/desabilitado dos botões Anterior/Próxima. Chamada sem
// argumento usa o estado atual (_adminCurrentRows/_adminPageTotal); o
// argumento string é só pros estados transitórios ("Carregando...", "—").
function _adminSetPageInfo(textoFixo) {
  const info = document.getElementById('admin-dados-page-info');
  const btnPrev = document.getElementById('admin-dados-prev');
  const btnNext = document.getElementById('admin-dados-next');
  if (info) {
    if (textoFixo) {
      info.textContent = textoFixo;
    } else {
      const inicio = _adminPageIndex * ADMIN_PAGE_SIZE + 1;
      const fim = _adminPageIndex * ADMIN_PAGE_SIZE + _adminCurrentRows.length;
      const totalStr = _adminPageTotal !== null ? `${_adminPageTotal.toLocaleString('pt-BR')}` : '…';
      info.textContent = _adminCurrentRows.length
        ? `Página ${_adminPageIndex + 1} — ${inicio}–${fim} de ${totalStr} registros`
        : 'Nenhum registro';
    }
  }
  if (btnPrev) btnPrev.disabled = _adminPageIndex === 0;
  if (btnNext) btnNext.disabled = !_adminHasNextPage;
}

function adminModuloProximaPagina() {
  if (!_adminHasNextPage) return;
  _adminPageIndex++;
  adminLoadModulo(false);
}

function adminModuloPaginaAnterior() {
  if (_adminPageIndex === 0) return;
  _adminPageIndex--;
  adminLoadModulo(false);
}

async function adminExcluirRegistro(modulo, id) {
  if (ADMIN_MODULOS[modulo]?.readOnly) return; // append-only — RLS bloquearia mesmo assim
  if (!confirm('Excluir este registro definitivamente? Esta ação não pode ser desfeita.')) return;
  const { error } = await window.supabaseClient.from(modulo).delete().eq('id', id);
  if (error) { toast('Falha ao excluir: ' + error.message, 'error'); return; }
  toast('Registro excluído.', 'success');
  adminLoadModulo();
}

// ── Edição (JSON genérico — funciona igual pra qualquer módulo) ────────
function adminAbrirEdicao(modulo, id) {
  if (ADMIN_MODULOS[modulo]?.readOnly) return; // append-only — RLS bloquearia mesmo assim
  const row = _adminCurrentRows.find(r => String(r.id) === String(id));
  if (!row) return;
  _adminEditContext = { modulo, id };
  document.getElementById('admin-edit-sub').textContent = `${ADMIN_MODULOS[modulo]?.label || modulo} — ${id}`;
  document.getElementById('admin-edit-json').value = JSON.stringify(row, null, 2);
  const errEl = document.getElementById('admin-edit-error');
  if (errEl) errEl.style.display = 'none';
  openModal('admin-edit-modal');
}

async function adminSalvarEdicao() {
  const errEl = document.getElementById('admin-edit-error');
  errEl.style.display = 'none';

  let parsed;
  try {
    parsed = JSON.parse(document.getElementById('admin-edit-json').value);
  } catch (e) {
    errEl.textContent = 'JSON inválido: ' + e.message;
    errEl.style.display = 'block';
    return;
  }

  const { modulo, id } = _adminEditContext || {};
  if (!modulo || !id) return;

  // Dono do registro não muda por aqui — remove se veio no JSON editado,
  // pra não correr risco de "transferir" o registro sem querer.
  delete parsed.user_id;
  delete parsed.id; // chave primária não é editável

  const { error } = await window.supabaseClient.from(modulo).update(parsed).eq('id', id);
  if (error) {
    errEl.textContent = 'Falha ao salvar: ' + error.message;
    errEl.style.display = 'block';
    return;
  }
  toast('Registro atualizado.', 'success');
  closeModal('admin-edit-modal');
  adminLoadModulo();
}

Object.assign(window, {
  renderAdminPage,
  adminShowSection,
  adminLoadUsuarios,
  adminAlterarPapel,
  adminLoadModulo,
  adminModuloProximaPagina,
  adminModuloPaginaAnterior,
  adminExcluirRegistro,
  adminAbrirEdicao,
  adminSalvarEdicao,
});
