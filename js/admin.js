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

// ── Paginação de "Dados por módulo" — mesmo padrão visual de Entradas/
// Saídas/Lançamentos/SAP (table-scroll + .pagination com Primeiro/
// Anterior/Próxima/Último), mas por CURSOR — nunca OFFSET (ver "Decisões
// de arquitetura" no handoff). "Último" com cursor simples não dá pra
// pular direto sem saber a página exata; a saída é bidirecional:
// - Próxima:  id > lastId,  ORDER BY id ASC  — igual antes.
// - Anterior: id < firstId, ORDER BY id DESC — resultado invertido pra
//             exibir em ordem ascendente. Simétrico à Próxima.
// - Primeiro: sem filtro, ORDER BY id ASC.
// - Último:   sem filtro, ORDER BY id DESC — resultado invertido. Não
//             precisa saber o total nem iterar página por página.
// Cada busca pede PAGE_SIZE+1 e corta o excedente — assim sabe com
// certeza se existe mais página pra aquele lado, sem query extra.
const ADMIN_PAGE_SIZE = 50; // igual ao PAGE_SIZE do resto do sistema (state.js)
let _adminPageIndex = 0;    // só cosmético, pro rótulo "(pág. X/Y)"
let _adminPageFirstId = null;
let _adminPageLastId = null;
let _adminHasNext = false;
let _adminHasPrev = false;
let _adminPageTotal = null; // contagem exata da tabela atual (null = ainda não buscada)

// ── Seção: Saúde do banco ───────────────────────────────────
// Usa a função admin_db_stats() (RPC, só-admin — SECURITY DEFINER com a
// mesma checagem de is_admin() usada em toda função sensível do
// projeto). "Linhas" é ESTIMATIVA (pg_class.reltuples, do último
// ANALYZE), não COUNT(*) exato — trade-off intencional pra não fazer 19
// varreduras completas de tabela só pra mostrar um número aproximado.
const ADMIN_DB_LIMIT_BYTES = 500 * 1024 * 1024; // teto do plano gratuito

async function adminLoadDbStats() {
  const totalLabel = document.getElementById('admin-db-total-label');
  const totalPct = document.getElementById('admin-db-total-pct');
  const bar = document.getElementById('admin-db-total-bar');
  const tbody = document.getElementById('admin-db-tables-tbody');
  if (!totalLabel || !tbody) return;

  totalLabel.textContent = 'Carregando...';
  tbody.innerHTML = `<tr><td colspan="3"><div class="empty-state"><i class="ti ti-loader"></i><p>Carregando...</p></div></td></tr>`;

  const { data, error } = await window.supabaseClient.rpc('admin_db_stats');
  if (error) {
    totalLabel.textContent = 'Falha ao carregar estatísticas.';
    tbody.innerHTML = `<tr><td colspan="3"><div class="empty-state"><i class="ti ti-alert-triangle"></i><p>${_adminEsc(error.message)}</p></div></td></tr>`;
    return;
  }

  // returns table (...) via RPC vem como array de 1 linha.
  const stats = Array.isArray(data) ? data[0] : data;
  if (!stats) {
    totalLabel.textContent = '—';
    tbody.innerHTML = `<tr><td colspan="3"><div class="empty-state"><i class="ti ti-database-off"></i><p>Sem dados.</p></div></td></tr>`;
    return;
  }

  const pct = Math.min(100, (stats.total_bytes / ADMIN_DB_LIMIT_BYTES) * 100);
  totalLabel.textContent = `${stats.total_pretty} usados de 500 MB`;
  if (totalPct) totalPct.textContent = `${pct.toFixed(pct < 1 ? 2 : 1)}%`;
  if (bar) {
    bar.style.width = `${Math.max(pct, 0.5)}%`; // largura mínima visível mesmo com uso quase zero
    bar.style.background = pct > 85 ? 'var(--red)' : pct > 60 ? 'var(--amber)' : 'var(--green)';
  }

  const tabelas = stats.tables || [];
  if (!tabelas.length) {
    tbody.innerHTML = `<tr><td colspan="3"><div class="empty-state"><i class="ti ti-database-off"></i><p>Nenhuma tabela encontrada.</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = tabelas.map(t => `<tr>
    <td>${_adminEsc(t.table)}</td>
    <td>${_adminEsc(t.pretty)}</td>
    <td>${Number(t.rows_estimadas || 0).toLocaleString('pt-BR')}</td>
  </tr>`).join('');
}

// ── Seção: Linhas por usuário, por tabela ───────────────────
// Usa a função admin_user_table_counts() (RPC, só-admin). Mostra TODOS os
// usuários de profiles como coluna, mesmo os com zero em tudo (é
// informativo por si só — ex.: confirmar que uma conta "fantasma" está
// mesmo zerada, não só "sem aparecer").
async function adminLoadUserTableCounts() {
  const thead = document.getElementById('admin-user-counts-thead');
  const tbody = document.getElementById('admin-user-counts-tbody');
  if (!thead || !tbody) return;

  tbody.innerHTML = `<tr><td><div class="empty-state"><i class="ti ti-loader"></i><p>Carregando...</p></div></td></tr>`;

  if (!_adminProfiles.length) {
    const { data } = await window.supabaseClient.from('profiles').select('id, email');
    _adminProfiles = data || [];
  }
  const usuarios = _adminProfiles.slice().sort((a, b) => (a.email || '').localeCompare(b.email || ''));

  const { data: counts, error } = await window.supabaseClient.rpc('admin_user_table_counts');
  if (error) {
    tbody.innerHTML = `<tr><td><div class="empty-state"><i class="ti ti-alert-triangle"></i><p>Falha ao carregar: ${_adminEsc(error.message)}</p></div></td></tr>`;
    return;
  }

  // matriz[tabela][user_id] = contagem
  const matriz = {};
  (counts || []).forEach(c => {
    if (!matriz[c.table_name]) matriz[c.table_name] = {};
    matriz[c.table_name][c.user_id] = Number(c.row_count) || 0;
  });

  const colspan = usuarios.length + 1;
  thead.innerHTML = `<tr><th>Tabela</th>${usuarios.map(u => `<th style="text-align:center" title="${_adminEsc(u.email)}">${_adminEsc((u.email || '').split('@')[0])}</th>`).join('')}</tr>`;

  const tabelas = Object.keys(ADMIN_MODULOS);
  if (!usuarios.length || !tabelas.length) {
    tbody.innerHTML = `<tr><td colspan="${colspan}"><div class="empty-state"><i class="ti ti-database-off"></i><p>Sem dados.</p></div></td></tr>`;
    return;
  }

  const totalPorUsuario = usuarios.map(() => 0);
  const linhas = tabelas.map(t => {
    const cells = usuarios.map((u, i) => {
      const n = matriz[t]?.[u.id] || 0;
      totalPorUsuario[i] += n;
      return `<td style="text-align:center;${n === 0 ? 'color:var(--text3)' : ''}">${n.toLocaleString('pt-BR')}</td>`;
    }).join('');
    return `<tr><td>${_adminEsc(ADMIN_MODULOS[t]?.label || t)}</td>${cells}</tr>`;
  }).join('');

  const linhaTotal = `<tr style="font-weight:600;border-top:2px solid var(--border2)"><td>Total</td>${totalPorUsuario.map(n => `<td style="text-align:center">${n.toLocaleString('pt-BR')}</td>`).join('')}</tr>`;

  tbody.innerHTML = linhas + linhaTotal;
}

function _adminEsc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Atualiza o badge "N erro(s) de sincronização nesta sessão" na aba
// Usuários — chamada tanto pelo toast() (format.js, toda vez que ocorre
// um novo erro) quanto por adminLoadUsuarios() (garante que o badge já
// apareça certo ao entrar na página, refletindo erros que já tinham
// acontecido antes de abrir a aba Admin). Fica oculto quando o contador
// é zero — sem ruído visual em uso normal.
function _syncErrorBadgeUpdate() {
  const el = document.getElementById('admin-sync-error-badge');
  const countEl = document.getElementById('admin-sync-error-count');
  if (!el || !countEl) return;
  const n = typeof _syncErrorCount === 'number' ? _syncErrorCount : 0;
  countEl.textContent = n;
  el.style.display = n > 0 ? '' : 'none';
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

  if (section === 'usuarios') { adminLoadUsuarios(); adminLoadDbStats(); adminLoadUserTableCounts(); }
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
  _syncErrorBadgeUpdate();

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
// direction: 'first' (padrão — troca de módulo/Atualizar), 'next',
// 'prev' ou 'last'. Cada uma monta a query de forma diferente (ver
// comentário do estado acima), mas todas convergem pro mesmo render.
async function adminLoadModulo(direction = 'first') {
  const select = document.getElementById('admin-modulo-select');
  const modulo = select?.value;
  const cfg = ADMIN_MODULOS[modulo];
  const thead = document.getElementById('admin-dados-thead');
  const tbody = document.getElementById('admin-dados-tbody');
  if (!cfg || !thead || !tbody) return;

  if (direction === 'first') {
    _adminPageIndex = 0;
    _adminPageFirstId = null;
    _adminPageLastId = null;
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

  // Contagem exata — só busca de novo quando a paginação reinicia (troca
  // de módulo/Atualizar), não a cada Próxima/Anterior.
  if (_adminPageTotal === null) {
    window.supabaseClient.from(modulo).select('*', { count: 'exact', head: true })
      .then(({ count }) => { _adminPageTotal = count ?? null; _adminSetPageInfo(); });
  }

  const asc = direction !== 'prev' && direction !== 'last'; // prev/last buscam em DESC pra pegar o "lado de baixo"
  let query = window.supabaseClient.from(modulo).select('*').order('id', { ascending: asc }).limit(ADMIN_PAGE_SIZE + 1);
  if (direction === 'next')  query = query.gt('id', _adminPageLastId);
  if (direction === 'prev')  query = query.lt('id', _adminPageFirstId);

  const { data, error } = await query;
  if (error) {
    tbody.innerHTML = `<tr><td colspan="${colspan}"><div class="empty-state"><i class="ti ti-alert-triangle"></i><p>Falha ao carregar: ${_adminEsc(error.message)}</p></div></td></tr>`;
    _adminSetPageInfo('—');
    return;
  }

  let rows = data || [];
  const veioMais = rows.length > ADMIN_PAGE_SIZE; // existe mais alguma coisa "por baixo" da direção buscada
  if (veioMais) rows = rows.slice(0, ADMIN_PAGE_SIZE);
  if (!asc) rows = rows.slice().reverse(); // prev/last vieram em DESC — mostra sempre em ordem ascendente

  // hasNext/hasPrev: 'first'/'next' sabem hasNext pelo "veio mais"; como
  // vieram avançando, sempre existe "antes" (exceto first). 'prev'/'last'
  // são o espelho disso.
  if (direction === 'first') { _adminHasPrev = false; _adminHasNext = veioMais; }
  if (direction === 'next')  { _adminHasPrev = true;  _adminHasNext = veioMais; }
  if (direction === 'prev')  { _adminHasPrev = veioMais; _adminHasNext = true; }
  if (direction === 'last')  { _adminHasPrev = veioMais; _adminHasNext = false; }

  _adminCurrentRows = rows;
  _adminPageFirstId = rows.length ? rows[0].id : null;
  _adminPageLastId  = rows.length ? rows[rows.length - 1].id : null;

  if (direction === 'next') _adminPageIndex++;
  else if (direction === 'prev') _adminPageIndex = Math.max(0, _adminPageIndex - 1);
  else if (direction === 'first') _adminPageIndex = 0;
  else if (direction === 'last') _adminPageIndex = _adminPageTotal !== null ? Math.max(0, Math.ceil(_adminPageTotal / ADMIN_PAGE_SIZE) - 1) : _adminPageIndex;

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

// Rótulo "X-Y de N registros (pág. P/T)" — mesmo formato usado no resto
// do sistema (ver _pageInfo em ui.js) — + habilita/desabilita os 4
// botões conforme _adminHasPrev/_adminHasNext.
function _adminSetPageInfo(textoFixo) {
  const info = document.getElementById('admin-dados-page-info');
  const btnFirst = document.getElementById('admin-dados-first');
  const btnPrev  = document.getElementById('admin-dados-prev');
  const btnNext  = document.getElementById('admin-dados-next');
  const btnLast  = document.getElementById('admin-dados-last');
  if (info) {
    if (textoFixo) {
      info.textContent = textoFixo;
    } else if (!_adminCurrentRows.length) {
      info.textContent = '0 registros';
    } else {
      // Âncoras confiáveis: quando não há "anterior", com certeza estamos
      // no registro 1; quando não há "próxima", com certeza o último
      // registro mostrado é o último da tabela (fim = total). Só nas
      // páginas do "meio" alcançadas depois de pular pro Último e clicar
      // Anterior (em tabela cujo total não é múltiplo exato de
      // ADMIN_PAGE_SIZE) esse número fica aproximado — os REGISTROS
      // mostrados continuam sempre corretos, sem pular nem duplicar
      // nenhum, só esse rótulo ordinal que não dá pra cravar sem OFFSET.
      let inicio, fim;
      if (!_adminHasPrev) {
        inicio = 1;
        fim = _adminCurrentRows.length;
      } else if (!_adminHasNext && _adminPageTotal !== null) {
        fim = _adminPageTotal;
        inicio = fim - _adminCurrentRows.length + 1;
      } else {
        inicio = _adminPageIndex * ADMIN_PAGE_SIZE + 1;
        fim = inicio + _adminCurrentRows.length - 1;
      }
      if (_adminPageTotal !== null) {
        const totalPages = Math.max(1, Math.ceil(_adminPageTotal / ADMIN_PAGE_SIZE));
        info.textContent = `${inicio}-${fim} de ${_adminPageTotal.toLocaleString('pt-BR')} registros (pág. ${_adminPageIndex + 1}/${totalPages})`;
      } else {
        info.textContent = `${inicio}-${fim} de … registros`;
      }
    }
  }
  if (btnFirst) btnFirst.disabled = !_adminHasPrev;
  if (btnPrev)  btnPrev.disabled  = !_adminHasPrev;
  if (btnNext)  btnNext.disabled  = !_adminHasNext;
  if (btnLast)  btnLast.disabled  = !_adminHasNext;
}

function adminModuloPrimeiraPagina() {
  if (!_adminHasPrev) return;
  adminLoadModulo('first');
}

function adminModuloPaginaAnterior() {
  if (!_adminHasPrev) return;
  adminLoadModulo('prev');
}

function adminModuloProximaPagina() {
  if (!_adminHasNext) return;
  adminLoadModulo('next');
}

function adminModuloUltimaPagina() {
  if (!_adminHasNext) return;
  adminLoadModulo('last');
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
  adminLoadDbStats,
  adminLoadUserTableCounts,
  adminLoadModulo,
  adminModuloPrimeiraPagina,
  adminModuloPaginaAnterior,
  adminModuloProximaPagina,
  adminModuloUltimaPagina,
  adminExcluirRegistro,
  adminAbrirEdicao,
  adminSalvarEdicao,
});
