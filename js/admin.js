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
// "Dados por módulo" lista só as tabelas que já têm sincronização ativa
// (ocorrencias, acoes_relatorio) — os cadastros (configs/filiais/
// materiais/grupos_materiais/regionais_centrais) têm tabela no Supabase
// desde a Fase 0, mas as funções de escrita ainda não foram migradas;
// vão aparecer aqui assim que isso acontecer.

const ADMIN_MODULOS = {
  ocorrencias:     { label: 'Ocorrências',         cols: ['central', 'material', 'motivo', 'concluida', 'data_abertura'] },
  acoes_relatorio: { label: 'Ações de Relatório',  cols: ['nivel', 'categorias', 'acoes', 'created'] },
};

let _adminProfiles = [];        // cache do último fetch de profiles (email por user_id)
let _adminCurrentRows = [];     // linhas do módulo atualmente exibido em "Dados"
let _adminEditContext = null;   // { modulo, id } do registro em edição
let _adminPresenceInterval = null; // atualização automática enquanto a seção Usuários está visível

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
async function adminLoadModulo() {
  const select = document.getElementById('admin-modulo-select');
  const modulo = select?.value;
  const cfg = ADMIN_MODULOS[modulo];
  const thead = document.getElementById('admin-dados-thead');
  const tbody = document.getElementById('admin-dados-tbody');
  if (!cfg || !thead || !tbody) return;

  thead.innerHTML = `<tr><th>Dono</th>${cfg.cols.map(c => `<th>${_adminEsc(c)}</th>`).join('')}<th></th></tr>`;
  const colspan = cfg.cols.length + 2;
  tbody.innerHTML = `<tr><td colspan="${colspan}"><div class="empty-state"><i class="ti ti-loader"></i><p>Carregando...</p></div></td></tr>`;

  if (!_adminProfiles.length) {
    const { data } = await window.supabaseClient.from('profiles').select('id, email');
    _adminProfiles = data || [];
  }
  const emailPorId = Object.fromEntries(_adminProfiles.map(p => [p.id, p.email]));

  const { data, error } = await window.supabaseClient.from(modulo).select('*').limit(500);
  if (error) {
    tbody.innerHTML = `<tr><td colspan="${colspan}"><div class="empty-state"><i class="ti ti-alert-triangle"></i><p>Falha ao carregar: ${_adminEsc(error.message)}</p></div></td></tr>`;
    return;
  }

  _adminCurrentRows = data || [];

  if (!_adminCurrentRows.length) {
    tbody.innerHTML = `<tr><td colspan="${colspan}"><div class="empty-state"><i class="ti ti-database-off"></i><p>Nenhum registro nesta tabela.</p></div></td></tr>`;
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
    return `<tr>
      <td style="font-size:11px;color:var(--text3)">${_adminEsc(dono)}</td>
      ${cells}
      <td style="white-space:nowrap">
        <button class="btn-icon" title="Editar" onclick="adminAbrirEdicao('${modulo}','${row.id}')"><i class="ti ti-edit"></i></button>
        <button class="btn-icon danger" title="Excluir" onclick="adminExcluirRegistro('${modulo}','${row.id}')"><i class="ti ti-trash"></i></button>
      </td>
    </tr>`;
  }).join('');
}

async function adminExcluirRegistro(modulo, id) {
  if (!confirm('Excluir este registro definitivamente? Esta ação não pode ser desfeita.')) return;
  const { error } = await window.supabaseClient.from(modulo).delete().eq('id', id);
  if (error) { toast('Falha ao excluir: ' + error.message, 'error'); return; }
  toast('Registro excluído.', 'success');
  adminLoadModulo();
}

// ── Edição (JSON genérico — funciona igual pra qualquer módulo) ────────
function adminAbrirEdicao(modulo, id) {
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
  adminExcluirRegistro,
  adminAbrirEdicao,
  adminSalvarEdicao,
});
