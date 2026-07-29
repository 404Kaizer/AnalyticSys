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

// ── Seleção em massa (ações em lote — excluir/editar vários registros) ──
// Dois modos, mutuamente exclusivos:
//  1) Seleção manual — Set de IDs marcados individualmente. SOBREVIVE à
//     paginação de propósito (o Hugo pode marcar itens em páginas
//     diferentes antes de aplicar uma ação), mas é resetada ao trocar de
//     módulo ou de termo de busca (os IDs de um módulo/filtro não fazem
//     sentido no outro).
//  2) "Todos os N do filtro" — flag booleana. Ativada só a partir do
//     banner (2º clique, padrão Gmail — nunca no 1º clique em "selecionar
//     tudo da página"), e só quando existe uma busca ativa (ver
//     adminSelecionarTodosFiltro). Enquanto ativa, os checkboxes ficam
//     travados (checked+disabled) — decisão deliberada pra não ter que
//     lidar com "lista de exclusão dentro do modo todos", que é a fonte
//     clássica de bug de seleção em massa. Sair do modo (Limpar seleção)
//     sempre zera pra um estado limpo, nunca reconstrói um meio-termo.
let _adminSelectedIds = new Set();
let _adminSelecaoTodosFiltro = false;
let _adminLoteEditContext = null; // { modulo } — módulo alvo do modal de edição em massa

// ── Tipos de campo por módulo (conferido no schema real do banco) ──────
// Usado só pelo formulário de edição/busca — decide que tipo de input
// renderizar (number/boolean/array) e quais colunas entram na busca por
// texto (só as que sobraram de fora daqui, ou seja, as de tipo texto).
// Colunas não listadas aqui são tratadas como texto simples.
const _ADMIN_COL_TYPES = {
  imports:         { registros: 'number' },
  ocorrencias:      { concluida: 'boolean' },
  acoes_relatorio:  { categorias: 'array' },
  lancamentos:      { peso: 'number', valor_total: 'number', editado: 'boolean' },
  producao:         { producao: 'number', custo_medio: 'number' },
  entradas:         { peso: 'number', valor_total: 'number' },
  saidas:           { peso: 'number', valor_total: 'number' },
  sap:              { peso: 'number', valor_total: 'number' },
};
function _adminFieldType(modulo, col) {
  return _ADMIN_COL_TYPES[modulo]?.[col] || 'text';
}

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

// ── Busca por texto — "Dados por módulo" ────────────────────
// Client trigger é explícito (Enter/botão), não a cada tecla — a busca
// vai pro banco (.ilike, não é filtro local), então evita bater o
// Supabase a cada caractere digitado.
let _adminSearchTerm = '';

function _adminBuildSearchOr(modulo, cfg) {
  if (!_adminSearchTerm) return null;
  const textCols = (cfg.cols || []).filter(c => _adminFieldType(modulo, c) === 'text');
  if (!textCols.length) return null;
  // remove % e vírgula — quebrariam a sintaxe do .ilike()/.or() do PostgREST
  const term = _adminSearchTerm.replace(/[%,]/g, '').trim();
  if (!term) return null;
  return textCols.map(c => `${c}.ilike.%${term}%`).join(',');
}

function adminBuscarModulo() {
  const input = document.getElementById('admin-search-input');
  _adminSearchTerm = (input?.value || '').trim();
  _adminLimparSelecaoInterno(); // novo filtro — os IDs/modo "todos" do filtro anterior não valem mais
  adminLoadModulo('first');
}

function adminLimparBuscaModulo() {
  _adminSearchTerm = '';
  const input = document.getElementById('admin-search-input');
  if (input) input.value = '';
  _adminLimparSelecaoInterno();
  adminLoadModulo('first');
}

// Troca de módulo — limpa a busca (os campos de texto mudam de um módulo
// pro outro, buscar pelo termo antigo não faria sentido no novo).
function adminTrocarModulo() {
  _adminSearchTerm = '';
  const input = document.getElementById('admin-search-input');
  if (input) input.value = '';
  _adminLimparSelecaoInterno(); // troca de tabela — IDs de um módulo não existem no outro
  adminLoadModulo('first');
}


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

// ── Seção: Saúde do Storage (28/07) ──────────────────────────
// Espelha adminLoadDbStats() acima, mas pra Storage (arquivos do backup
// condensado — ver cloud-backup.js) em vez do banco Postgres. Cota
// separada: 1GB no plano gratuito, contra 500MB do banco. Usa a função
// admin_storage_stats() (RPC, só-admin — mesma proteção is_admin()).
const ADMIN_STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024; // teto do plano gratuito

let _adminHealthTab = 'db'; // 'db' | 'storage' — só cosmético, lembra a aba ativa entre atualizações manuais

function adminHealthShowTab(tab) {
  _adminHealthTab = tab;
  const dbView = document.getElementById('admin-health-db-view');
  const storageView = document.getElementById('admin-health-storage-view');
  const btnDb = document.getElementById('admin-health-tab-db');
  const btnStorage = document.getElementById('admin-health-tab-storage');
  if (dbView) dbView.style.display = tab === 'db' ? '' : 'none';
  if (storageView) storageView.style.display = tab === 'storage' ? '' : 'none';
  if (btnDb) btnDb.classList.toggle('active', tab === 'db');
  if (btnStorage) btnStorage.classList.toggle('active', tab === 'storage');
  // Carrega sob demanda — só busca Storage na 1ª vez que a aba é aberta
  // (Database já carrega de cara, junto com o resto de adminShowSection).
  if (tab === 'storage' && !_adminStorageLoadedOnce) adminLoadStorageStats();
}

let _adminStorageLoadedOnce = false;

async function adminLoadStorageStats() {
  _adminStorageLoadedOnce = true;
  const totalLabel = document.getElementById('admin-storage-total-label');
  const totalPct = document.getElementById('admin-storage-total-pct');
  const bar = document.getElementById('admin-storage-total-bar');
  const tbody = document.getElementById('admin-storage-pastas-tbody');
  if (!totalLabel || !tbody) return;

  totalLabel.textContent = 'Carregando...';
  tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><i class="ti ti-loader"></i><p>Carregando...</p></div></td></tr>`;

  const { data, error } = await window.supabaseClient.rpc('admin_storage_stats');
  if (error) {
    totalLabel.textContent = 'Falha ao carregar estatísticas.';
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><i class="ti ti-alert-triangle"></i><p>${_adminEsc(error.message)}</p></div></td></tr>`;
    return;
  }

  const stats = Array.isArray(data) ? data[0] : data;
  if (!stats) {
    totalLabel.textContent = '—';
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><i class="ti ti-cloud-off"></i><p>Sem dados.</p></div></td></tr>`;
    return;
  }

  const pct = Math.min(100, (stats.total_bytes / ADMIN_STORAGE_LIMIT_BYTES) * 100);
  totalLabel.textContent = `${stats.total_pretty} usados de 1 GB`;
  if (totalPct) totalPct.textContent = `${pct.toFixed(pct < 1 ? 2 : 1)}%`;
  if (bar) {
    bar.style.width = `${Math.max(pct, 0.5)}%`;
    bar.style.background = pct > 85 ? 'var(--red)' : pct > 60 ? 'var(--amber)' : 'var(--green)';
  }

  const pastas = stats.pastas || [];
  if (!pastas.length) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><i class="ti ti-cloud-off"></i><p>Nenhum arquivo no Storage ainda.</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = pastas.map(p => `<tr>
    <td>${_adminEsc(p.usuario)}</td>
    <td>${_adminEsc(p.modulo || '—')}</td>
    <td>${_adminEsc(p.pretty)}</td>
    <td>${Number(p.arquivos || 0).toLocaleString('pt-BR')}</td>
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
  const elFormPublico = document.getElementById('admin-section-formpublico');
  if (elUsuarios) elUsuarios.style.display = section === 'usuarios' ? '' : 'none';
  if (elDados)    elDados.style.display    = section === 'dados' ? '' : 'none';
  if (elFormPublico) elFormPublico.style.display = section === 'formpublico' ? '' : 'none';
  document.getElementById('admin-subnav-usuarios')?.classList.toggle('active', section === 'usuarios');
  document.getElementById('admin-subnav-dados')?.classList.toggle('active', section === 'dados');
  document.getElementById('admin-subnav-formpublico')?.classList.toggle('active', section === 'formpublico');

  if (section === 'usuarios') { adminLoadUsuarios(); adminLoadDbStats(); adminLoadUserTableCounts(); }
  if (section === 'dados') adminLoadModulo();
  if (section === 'formpublico') adminLoadFormPublico();

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

  const checkboxTh = cfg.readOnly ? '' : `<th class="th-checkbox"><input type="checkbox" id="admin-check-all" onchange="adminToggleSelecionarTudoPagina(this.checked)" title="Selecionar todos os registros desta página"></th>`;
  thead.innerHTML = `<tr>${checkboxTh}<th>Dono</th>${cfg.cols.map(c => `<th>${_adminEsc(c)}</th>`).join('')}<th></th></tr>`;
  const colspan = cfg.cols.length + 2 + (cfg.readOnly ? 0 : 1);
  tbody.innerHTML = `<tr><td colspan="${colspan}"><div class="empty-state"><i class="ti ti-loader"></i><p>Carregando...</p></div></td></tr>`;
  _adminSetPageInfo('Carregando...');

  if (!_adminProfiles.length) {
    const { data } = await window.supabaseClient.from('profiles').select('id, email');
    _adminProfiles = data || [];
  }
  const emailPorId = Object.fromEntries(_adminProfiles.map(p => [p.id, p.email]));

  // Contagem exata — só busca de novo quando a paginação reinicia (troca
  // de módulo/Atualizar/nova busca), não a cada Próxima/Anterior.
  if (_adminPageTotal === null) {
    let countQuery = window.supabaseClient.from(modulo).select('*', { count: 'exact', head: true });
    const orCount = _adminBuildSearchOr(modulo, cfg);
    if (orCount) countQuery = countQuery.or(orCount);
    countQuery.then(({ count }) => { _adminPageTotal = count ?? null; _adminSetPageInfo(); _adminAtualizarBarraLote(); });
  }

  const asc = direction !== 'prev' && direction !== 'last'; // prev/last buscam em DESC pra pegar o "lado de baixo"
  let query = window.supabaseClient.from(modulo).select('*').order('id', { ascending: asc }).limit(ADMIN_PAGE_SIZE + 1);
  const orData = _adminBuildSearchOr(modulo, cfg);
  if (orData) query = query.or(orData);
  if (direction === 'next')  query = query.gt('id', _adminPageLastId);
  if (direction === 'prev')  query = query.lt('id', _adminPageFirstId);

  const { data, error } = await query;
  if (error) {
    tbody.innerHTML = `<tr><td colspan="${colspan}"><div class="empty-state"><i class="ti ti-alert-triangle"></i><p>Falha ao carregar: ${_adminEsc(error.message)}</p></div></td></tr>`;
    _adminSetPageInfo('—');
    _adminAtualizarBarraLote();
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
    const msg = _adminSearchTerm
      ? `Nenhum registro encontrado para "${_adminEsc(_adminSearchTerm)}".`
      : 'Nenhum registro nesta tabela.';
    tbody.innerHTML = `<tr><td colspan="${colspan}"><div class="empty-state"><i class="ti ti-database-off"></i><p>${msg}</p></div></td></tr>`;
    _adminSetPageInfo();
    _adminAtualizarBarraLote();
    return;
  }

  tbody.innerHTML = _adminCurrentRows.map(row => {
    const idStr = String(row.id);
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
    const checkboxTd = cfg.readOnly ? '' : `<td class="th-checkbox"><input type="checkbox" ${(_adminSelecaoTodosFiltro || _adminSelectedIds.has(idStr)) ? 'checked' : ''} ${_adminSelecaoTodosFiltro ? 'disabled' : ''} onchange="adminToggleSelecaoLinha('${idStr}', this.checked)"></td>`;
    return `<tr>
      ${checkboxTd}
      <td style="font-size:11px;color:var(--text3)">${_adminEsc(dono)}</td>
      ${cells}
      <td style="white-space:nowrap">
        ${acoes}
      </td>
    </tr>`;
  }).join('');

  _adminSetPageInfo();
  _adminAtualizarBarraLote();
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

// ── Seleção em massa ──────────────────────────────────────────
// Reset "silencioso" (sem re-render de tela) usado só internamente pelos
// pontos que já vão chamar adminLoadModulo('first') logo em seguida
// (busca/limpar busca/trocar módulo) — o próprio reload já reconstrói o
// thead/tbody do zero, então não precisa (nem faz sentido) tocar no DOM
// aqui antes disso.
function _adminLimparSelecaoInterno() {
  _adminSelectedIds.clear();
  _adminSelecaoTodosFiltro = false;
}

function adminToggleSelecaoLinha(id, checked) {
  if (_adminSelecaoTodosFiltro) return; // travado nesse modo — só "Limpar seleção" sai dele
  if (checked) _adminSelectedIds.add(String(id));
  else _adminSelectedIds.delete(String(id));
  _adminAtualizarBarraLote();
}

// Checkbox do cabeçalho — marca/desmarca só os registros da PÁGINA ATUAL
// (⇒ nunca mexe em linhas fora da tela). "Selecionar todos os N do
// filtro" é uma ação deliberada à parte, via banner (ver
// adminSelecionarTodosFiltro), nunca um efeito colateral deste checkbox.
function adminToggleSelecionarTudoPagina(checked) {
  if (_adminSelecaoTodosFiltro) return;
  _adminCurrentRows.forEach(r => {
    const id = String(r.id);
    if (checked) _adminSelectedIds.add(id);
    else _adminSelectedIds.delete(id);
  });
  document.querySelectorAll('#admin-dados-tbody input[type="checkbox"]').forEach((cb, i) => {
    if (_adminCurrentRows[i]) cb.checked = _adminSelectedIds.has(String(_adminCurrentRows[i].id));
  });
  _adminAtualizarBarraLote();
}

// Ativa o modo "todos os N registros do filtro" — só alcançável a partir
// do banner (2º clique, depois que a página inteira já foi marcada), e
// SÓ com uma busca ativa. Essa exigência é proposital: sem ela, "todos"
// numa tabela sem filtro poderia significar literalmente a tabela
// inteira (ex.: 600 mil linhas em `sap`/`lancamentos`) selecionada em 2
// cliques — risco grande demais pra uma ação que alimenta exclusão/edição
// em massa. Com filtro obrigatório, a ação em lote sempre tem uma
// cláusula WHERE de verdade por trás (ver _adminExecutar* abaixo).
function adminSelecionarTodosFiltro() {
  if (!_adminSearchTerm || _adminPageTotal === null) return;
  _adminSelecaoTodosFiltro = true;
  _adminSelectedIds.clear(); // o modo "todos" substitui qualquer seleção manual anterior
  document.querySelectorAll('#admin-dados-tbody input[type="checkbox"]').forEach(cb => { cb.checked = true; cb.disabled = true; });
  const checkAll = document.getElementById('admin-check-all');
  if (checkAll) { checkAll.checked = true; checkAll.indeterminate = false; checkAll.disabled = true; }
  _adminAtualizarBarraLote();
  toast(`Todos os ${_adminPageTotal.toLocaleString('pt-BR')} registros que batem na busca atual foram selecionados.`, 'success');
}

// Sai de qualquer modo de seleção (manual ou "todos do filtro") e volta
// a tela ao estado neutro — sem recarregar do banco, só desmarca/reabilita
// os checkboxes já renderizados na página atual.
function adminLimparSelecao() {
  _adminSelectedIds.clear();
  _adminSelecaoTodosFiltro = false;
  document.querySelectorAll('#admin-dados-tbody input[type="checkbox"]').forEach(cb => { cb.checked = false; cb.disabled = false; });
  const checkAll = document.getElementById('admin-check-all');
  if (checkAll) { checkAll.checked = false; checkAll.indeterminate = false; checkAll.disabled = false; }
  _adminAtualizarBarraLote();
}

function _adminContagemSelecionada() {
  return _adminSelecaoTodosFiltro ? (_adminPageTotal || 0) : _adminSelectedIds.size;
}

// Atualiza a barra de ação em lote, o checkbox "selecionar tudo" do
// cabeçalho (estado marcado/indeterminado) e o banner "selecionar todos
// os N do filtro" — chamada depois de qualquer mudança de seleção ou
// depois que a contagem exata assíncrona chega (ver adminLoadModulo).
function _adminAtualizarBarraLote() {
  const bar = document.getElementById('admin-lote-bar');
  const countEl = document.getElementById('admin-lote-count');
  const checkAllEl = document.getElementById('admin-check-all');
  const banner = document.getElementById('admin-selectall-banner');
  const n = _adminContagemSelecionada();

  if (bar) bar.style.display = n > 0 ? 'flex' : 'none';
  if (countEl) {
    countEl.innerHTML = _adminSelecaoTodosFiltro
      ? `<i class="ti ti-checks"></i> Todos os ${n.toLocaleString('pt-BR')} registros deste filtro selecionados`
      : `<i class="ti ti-checks"></i> ${n === 1 ? '1 registro selecionado' : n.toLocaleString('pt-BR') + ' registros selecionados'}`;
  }

  const idsPagina = _adminCurrentRows.map(r => String(r.id));
  const todosPaginaSelecionados = idsPagina.length > 0 && idsPagina.every(id => _adminSelectedIds.has(id));

  if (checkAllEl && !_adminSelecaoTodosFiltro) {
    checkAllEl.disabled = false;
    checkAllEl.checked = todosPaginaSelecionados;
    checkAllEl.indeterminate = !todosPaginaSelecionados && idsPagina.some(id => _adminSelectedIds.has(id));
  }

  if (banner) {
    if (_adminSelecaoTodosFiltro) {
      banner.style.display = 'none'; // já é "tudo" — nada mais a oferecer
    } else {
      const totalFiltro = _adminPageTotal;
      const haMaisParaSelecionar = totalFiltro !== null && totalFiltro > _adminSelectedIds.size;
      const mostrar = todosPaginaSelecionados && haMaisParaSelecionar;
      banner.style.display = mostrar ? 'flex' : 'none';
      if (mostrar) {
        banner.innerHTML = _adminSearchTerm
          ? `<span><i class="ti ti-info-circle"></i> Todos os ${idsPagina.length} registros desta página estão selecionados.</span>
             <button type="button" class="admin-selectall-link" onclick="adminSelecionarTodosFiltro()">Selecionar todos os ${totalFiltro.toLocaleString('pt-BR')} que batem na busca atual</button>`
          : `<span><i class="ti ti-info-circle"></i> Todos os ${idsPagina.length} registros desta página estão selecionados. Pra selecionar mais que isso de uma vez, aplique uma busca primeiro — seleção de "todos" sem filtro ativo não é permitida, por segurança.</span>`;
      }
    }
  }
}

// ── Exclusão em massa ─────────────────────────────────────────
function adminExcluirLote() {
  const modulo = document.getElementById('admin-modulo-select')?.value;
  const cfg = ADMIN_MODULOS[modulo];
  if (!cfg || cfg.readOnly) return; // append-only — RLS bloquearia mesmo assim
  const n = _adminContagemSelecionada();
  if (!n) return;

  const escopoTexto = _adminSelecaoTodosFiltro
    ? `TODOS os ${n.toLocaleString('pt-BR')} registros que batem na busca "${_adminEsc(_adminSearchTerm)}" — não só os visíveis nesta página`
    : `${n.toLocaleString('pt-BR')} registro(s) selecionado(s) manualmente`;

  confirmarDestrutivo({
    title: 'Confirmar exclusão em massa',
    sub: cfg.label,
    body: `Você está prestes a excluir definitivamente ${escopoTexto}, da tabela <strong>${_adminEsc(cfg.label)}</strong>. Esta ação não pode ser desfeita.`,
    confirmLabel: 'Excluir em massa',
    requireConsent: true,
    consentLabel: `Entendo que isso exclui ${n.toLocaleString('pt-BR')} registro(s) permanentemente.`,
    onConfirm: () => _adminExecutarExclusaoLote(modulo),
  });
}

async function _adminExecutarExclusaoLote(modulo) {
  const cfg = ADMIN_MODULOS[modulo];
  if (!cfg || cfg.readOnly) return;

  let query = window.supabaseClient.from(modulo).delete();
  if (_adminSelecaoTodosFiltro) {
    // Segunda checagem (defesa em profundidade) — mesmo que algum caminho
    // de UI inesperado chegasse aqui sem busca ativa, a ação é bloqueada
    // antes de qualquer chamada ao banco. Nunca um DELETE sem filtro.
    const orClause = _adminBuildSearchOr(modulo, cfg);
    if (!_adminSearchTerm || !orClause) {
      toast('Ação bloqueada: exclusão de "todos os registros do filtro" exige uma busca ativa.', 'error');
      return;
    }
    query = query.or(orClause);
  } else {
    const ids = [..._adminSelectedIds];
    if (!ids.length) return;
    query = query.in('id', ids);
  }

  const { error } = await query;
  if (error) { toast('Falha ao excluir em massa: ' + error.message, 'error'); return; }
  toast('Registros excluídos.', 'success');
  adminLimparSelecao();
  adminLoadModulo();
}

// ── Edição em massa (um campo por vez) ──────────────────────────
function adminAbrirEdicaoLote() {
  const modulo = document.getElementById('admin-modulo-select')?.value;
  const cfg = ADMIN_MODULOS[modulo];
  if (!cfg || cfg.readOnly) return;
  const n = _adminContagemSelecionada();
  if (!n) return;

  _adminLoteEditContext = { modulo };
  const subEl = document.getElementById('admin-lote-edit-sub');
  if (subEl) subEl.textContent = `${cfg.label} — ${n.toLocaleString('pt-BR')} registro(s) selecionado(s)`;

  const campoSelect = document.getElementById('admin-lote-edit-campo');
  if (campoSelect) campoSelect.innerHTML = cfg.cols.map(c => `<option value="${_adminEsc(c)}">${_adminEsc(c)}</option>`).join('');

  _adminLoteEditRenderCampo();
  const errEl = document.getElementById('admin-lote-edit-error');
  if (errEl) errEl.style.display = 'none';
  openModal('admin-lote-edit-modal');
}

// Redesenha o input de valor quando o campo escolhido muda (tipo
// texto/número/sim-não/lista) — reaproveita _adminRenderFieldInput, o
// mesmo helper usado pelo formulário de edição individual.
function _adminLoteEditRenderCampo() {
  const { modulo } = _adminLoteEditContext || {};
  const col = document.getElementById('admin-lote-edit-campo')?.value;
  const wrap = document.getElementById('admin-lote-edit-valor-wrap');
  if (!modulo || !col || !wrap) return;
  wrap.innerHTML = _adminRenderFieldInput(modulo, col, '', 'admin-lote-edit-valor');
}

function adminAplicarEdicaoLote() {
  const { modulo } = _adminLoteEditContext || {};
  const cfg = ADMIN_MODULOS[modulo];
  const errEl = document.getElementById('admin-lote-edit-error');
  if (errEl) errEl.style.display = 'none';
  if (!cfg || cfg.readOnly) return;

  const col = document.getElementById('admin-lote-edit-campo')?.value;
  const input = document.getElementById('admin-lote-edit-valor');
  if (!col || !input) return;

  const parsed = _adminParseFieldValue(modulo, col, input);
  if (!parsed.ok) {
    if (errEl) { errEl.textContent = parsed.error; errEl.style.display = 'block'; }
    return;
  }

  const n = _adminContagemSelecionada();
  if (!n) return;

  const valorExibicao = Array.isArray(parsed.value)
    ? (parsed.value.join(', ') || '(lista vazia)')
    : (typeof parsed.value === 'boolean' ? (parsed.value ? 'Sim' : 'Não') : (parsed.value === null || parsed.value === '' ? '(vazio)' : parsed.value));

  const escopoTexto = _adminSelecaoTodosFiltro
    ? `TODOS os ${n.toLocaleString('pt-BR')} registros que batem na busca "${_adminEsc(_adminSearchTerm)}" — não só os visíveis nesta página`
    : `${n.toLocaleString('pt-BR')} registro(s) selecionado(s) manualmente`;

  closeModal('admin-lote-edit-modal');

  confirmarDestrutivo({
    title: 'Confirmar edição em massa',
    sub: `${cfg.label} — campo "${col}"`,
    body: `Você está prestes a alterar o campo <strong>${_adminEsc(col)}</strong> para <strong>${_adminEsc(String(valorExibicao))}</strong> em ${escopoTexto}. Esta ação não pode ser desfeita.`,
    confirmLabel: 'Aplicar em massa',
    requireConsent: true,
    consentLabel: `Entendo que isso altera ${n.toLocaleString('pt-BR')} registro(s) permanentemente.`,
    onConfirm: () => _adminExecutarEdicaoLote(modulo, col, parsed.value),
  });
}

async function _adminExecutarEdicaoLote(modulo, col, value) {
  const cfg = ADMIN_MODULOS[modulo];
  if (!cfg || cfg.readOnly) return;
  const patch = { [col]: value };

  let query = window.supabaseClient.from(modulo).update(patch);
  if (_adminSelecaoTodosFiltro) {
    // Mesma defesa em profundidade da exclusão em massa — nunca um UPDATE
    // sem filtro de verdade por trás.
    const orClause = _adminBuildSearchOr(modulo, cfg);
    if (!_adminSearchTerm || !orClause) {
      toast('Ação bloqueada: edição de "todos os registros do filtro" exige uma busca ativa.', 'error');
      return;
    }
    query = query.or(orClause);
  } else {
    const ids = [..._adminSelectedIds];
    if (!ids.length) return;
    query = query.in('id', ids);
  }

  const { error } = await query;
  if (error) { toast('Falha ao editar em massa: ' + error.message, 'error'); return; }
  toast('Registros atualizados.', 'success');
  adminLimparSelecao();
  adminLoadModulo();
}

async function adminExcluirRegistro(modulo, id) {
  if (ADMIN_MODULOS[modulo]?.readOnly) return; // append-only — RLS bloquearia mesmo assim
  if (!confirm('Excluir este registro definitivamente? Esta ação não pode ser desfeita.')) return;
  const { error } = await window.supabaseClient.from(modulo).delete().eq('id', id);
  if (error) { toast('Falha ao excluir: ' + error.message, 'error'); return; }
  toast('Registro excluído.', 'success');
  adminLoadModulo();
}

// ── Edição (formulário estruturado — um input por coluna, tipado
// conforme _ADMIN_COL_TYPES: texto, número, sim/não ou lista) ──────────
// _adminRenderFieldInput/_adminParseFieldValue abaixo são compartilhados
// entre o formulário de edição individual (aqui) e o modal de edição em
// massa (adminAbrirEdicaoLote/adminAplicarEdicaoLote, acima) — mesmo
// tipo de campo, mesma validação, um único lugar pra manter.
function _adminRenderFieldInput(modulo, col, val, inputId) {
  const type = _adminFieldType(modulo, col);
  if (type === 'boolean') {
    return `<label style="display:flex;align-items:center;gap:8px;cursor:pointer">
      <input type="checkbox" id="${inputId}" ${val ? 'checked' : ''} style="width:16px;height:16px">
      <span style="font-size:12.5px;color:var(--text2)">${val ? 'Sim' : 'Não'}</span>
    </label>`;
  } else if (type === 'number') {
    return `<input type="number" step="any" class="form-input" id="${inputId}" value="${val ?? ''}">`;
  } else if (type === 'array') {
    const joined = Array.isArray(val) ? val.join(', ') : '';
    return `<input type="text" class="form-input" id="${inputId}" value="${_adminEsc(joined)}" placeholder="separado por vírgula">`;
  }
  return `<input type="text" class="form-input" id="${inputId}" value="${_adminEsc(val ?? '')}">`;
}

// Valida e converte o valor bruto de um <input> pro tipo esperado da
// coluna. Retorna { ok:true, value } ou { ok:false, error } — nunca
// lança exceção, pra quem chama só precisar checar `.ok`.
function _adminParseFieldValue(modulo, col, inputEl) {
  const type = _adminFieldType(modulo, col);
  if (type === 'boolean') return { ok: true, value: inputEl.checked };
  if (type === 'number') {
    const raw = inputEl.value.trim();
    if (raw === '') return { ok: true, value: null };
    const n = Number(raw);
    if (!Number.isFinite(n)) return { ok: false, error: `Valor inválido em "${col}" — informe um número.` };
    return { ok: true, value: n };
  }
  if (type === 'array') return { ok: true, value: inputEl.value.split(',').map(s => s.trim()).filter(Boolean) };
  return { ok: true, value: inputEl.value };
}

function adminAbrirEdicao(modulo, id) {
  if (ADMIN_MODULOS[modulo]?.readOnly) return; // append-only — RLS bloquearia mesmo assim
  const row = _adminCurrentRows.find(r => String(r.id) === String(id));
  if (!row) return;
  _adminEditContext = { modulo, id };
  document.getElementById('admin-edit-sub').textContent = `${ADMIN_MODULOS[modulo]?.label || modulo} — ${id}`;

  const cols = ADMIN_MODULOS[modulo]?.cols || [];
  const fieldsEl = document.getElementById('admin-edit-fields');
  if (fieldsEl) {
    fieldsEl.innerHTML = cols.map(col => {
      const inputId = `admin-edit-field-${col}`;
      const inputHtml = _adminRenderFieldInput(modulo, col, row[col], inputId);
      return `<div class="form-group" style="margin-bottom:0">
        <label class="form-label">${_adminEsc(col)}</label>
        ${inputHtml}
      </div>`;
    }).join('');
  }

  const errEl = document.getElementById('admin-edit-error');
  if (errEl) errEl.style.display = 'none';
  openModal('admin-edit-modal');
}

async function adminSalvarEdicao() {
  const errEl = document.getElementById('admin-edit-error');
  errEl.style.display = 'none';

  const { modulo, id } = _adminEditContext || {};
  if (!modulo || !id) return;

  const cols = ADMIN_MODULOS[modulo]?.cols || [];
  const patch = {};
  for (const col of cols) {
    const input = document.getElementById(`admin-edit-field-${col}`);
    if (!input) continue;
    const parsed = _adminParseFieldValue(modulo, col, input);
    if (!parsed.ok) {
      errEl.textContent = parsed.error;
      errEl.style.display = 'block';
      return;
    }
    patch[col] = parsed.value;
  }

  const { error } = await window.supabaseClient.from(modulo).update(patch).eq('id', id);
  if (error) {
    errEl.textContent = 'Falha ao salvar: ' + error.message;
    errEl.style.display = 'block';
    return;
  }
  toast('Registro atualizado.', 'success');
  closeModal('admin-edit-modal');
  adminLoadModulo();
}

// ── Seção: Formulário Público ────────────────────────────────
// Duas partes: (1) o link fixo e público da página solicitacao.html —
// puramente informativo/copiável, não depende de nenhuma chamada ao
// Supabase; (2) o mapeamento categoria → analista responsável, usado
// pela Edge Function solicitacao-dai para decidir a quem atribuir cada
// nova DAI vinda do formulário. As 5 categorias são sempre as mesmas
// (CATEGORIAS_MATERIAL, definida em normalize.js) — não é uma lista
// livre, então a UI é sempre "1 linha por categoria fixa", nunca
// adicionar/remover linha.
function _adminCategoriasFormPublico() {
  return (typeof CATEGORIAS_MATERIAL !== 'undefined' && CATEGORIAS_MATERIAL.length)
    ? CATEGORIAS_MATERIAL
    : ['Aglomerante', 'Agregado Graúdo', 'Agregado Miúdo', 'Aditivo', 'Adição'];
}

function adminCopiarLinkFormPublico() {
  const input = document.getElementById('admin-formpublico-link');
  if (!input) return;
  input.select();
  input.setSelectionRange(0, 99999);
  navigator.clipboard?.writeText(input.value)
    .then(() => toast('Link copiado.', 'success'))
    .catch(() => toast('Não foi possível copiar automaticamente — selecione e copie manualmente.', 'error'));
}

async function adminLoadFormPublico() {
  // Link — construído a partir da própria URL atual (funciona em
  // qualquer domínio/subpasta onde o sistema esteja publicado, sem
  // precisar hardcodar host nenhum).
  const linkInput = document.getElementById('admin-formpublico-link');
  if (linkInput) {
    const base = window.location.href.replace(/index\.html?(\?.*)?(#.*)?$/, '').replace(/\/?$/, '/');
    linkInput.value = base + 'solicitacao.html';
  }

  const rowsEl = document.getElementById('admin-analistas-categoria-rows');
  if (!rowsEl) return;
  rowsEl.innerHTML = '<div class="empty-state"><i class="ti ti-loader"></i><p>Carregando...</p></div>';

  const [profilesRes, mapaRes] = await Promise.all([
    window.supabaseClient.from('profiles').select('id, email').order('email', { ascending: true }),
    window.supabaseClient.from('analistas_categoria').select('categoria, analista_user_id, analista_nome'),
  ]);

  if (profilesRes.error || mapaRes.error) {
    rowsEl.innerHTML = `<div class="empty-state"><i class="ti ti-alert-triangle"></i><p>Falha ao carregar: ${_adminEsc((profilesRes.error || mapaRes.error).message)}</p></div>`;
    return;
  }

  const usuarios = profilesRes.data || [];
  const mapaAtual = new Map((mapaRes.data || []).map(m => [m.categoria, m.analista_user_id]));

  rowsEl.innerHTML = _adminCategoriasFormPublico().map(categoria => {
    const selectId = `admin-cat-select-${_adminEsc(categoria).replace(/[^a-zA-Z0-9]/g, '_')}`;
    const atualId = mapaAtual.get(categoria) || '';
    const options = usuarios.map(u =>
      `<option value="${_adminEsc(u.id)}" ${u.id === atualId ? 'selected' : ''}>${_adminEsc(u.email)}</option>`
    ).join('');
    return `
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 12px;background:var(--bg3);border:1px solid var(--border2);border-radius:var(--radius)">
        <span style="flex:0 0 160px;font-size:12.5px;font-weight:600">${_adminEsc(categoria)}</span>
        <select class="form-select" id="${selectId}" style="flex:1;min-width:220px">
          <option value="">— Nenhum analista configurado —</option>
          ${options}
        </select>
        <button class="btn" onclick="adminSalvarAnalistaCategoria('${_adminEsc(categoria)}', '${selectId}')"><i class="ti ti-check"></i> Salvar</button>
      </div>`;
  }).join('');
}

async function adminSalvarAnalistaCategoria(categoria, selectId) {
  const select = document.getElementById(selectId);
  const userId = select?.value || '';
  if (!userId) {
    // Sem analista selecionado — remove o mapeamento, se existir (volta
    // pro estado "sem analista configurado" para essa categoria).
    const { error } = await window.supabaseClient.from('analistas_categoria').delete().eq('categoria', categoria);
    if (error) { toast('Falha ao remover: ' + error.message, 'error'); return; }
    toast(`Categoria "${categoria}" ficou sem analista configurado — novas solicitações dessa categoria serão recusadas.`, 'success');
    return;
  }
  const email = select.options[select.selectedIndex]?.textContent || '';
  const nome = email.split('@')[0] || email;

  const { error } = await window.supabaseClient.from('analistas_categoria').upsert({
    categoria,
    analista_user_id: userId,
    analista_nome: nome,
    updated_by: window.currentUser?.id || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'categoria' });

  if (error) { toast('Falha ao salvar: ' + error.message, 'error'); return; }
  toast(`Categoria "${categoria}" atribuída a ${email}.`, 'success');
}

Object.assign(window, {
  renderAdminPage,
  adminLoadFormPublico,
  adminSalvarAnalistaCategoria,
  adminCopiarLinkFormPublico,
  adminShowSection,
  adminLoadUsuarios,
  adminAlterarPapel,
  adminLoadDbStats,
  adminLoadStorageStats,
  adminHealthShowTab,
  adminLoadUserTableCounts,
  adminLoadModulo,
  adminTrocarModulo,
  adminBuscarModulo,
  adminLimparBuscaModulo,
  adminModuloPrimeiraPagina,
  adminModuloPaginaAnterior,
  adminModuloProximaPagina,
  adminModuloUltimaPagina,
  adminExcluirRegistro,
  adminAbrirEdicao,
  adminSalvarEdicao,
  adminToggleSelecaoLinha,
  adminToggleSelecionarTudoPagina,
  adminSelecionarTodosFiltro,
  adminLimparSelecao,
  adminExcluirLote,
  adminAbrirEdicaoLote,
  _adminLoteEditRenderCampo,
  adminAplicarEdicaoLote,
});
