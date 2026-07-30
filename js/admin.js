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
// `cols` lista TODAS as colunas de cada tabela (exceto id/user_id, que já
// têm tratamento próprio — id no modal de edição, user_id na coluna
// "Dono") — conferido contra o schema real em 30/07. Antes só listava um
// subconjunto "principal" por módulo, o que deixava campo de verdade
// (ex.: hierarquia/itens/anexos em jsonb, todo "_original", created_at)
// invisível e não-editável no admin sem motivo — só corrigido aqui.
const ADMIN_MODULOS = {
  // Cadastro / configuração
  configs:                  { label: 'Configurações',              cols: ['key', 'value', 'descricao', 'created_at'] },
  filiais:                  { label: 'Filiais',                    cols: ['origem', 'alias', 'cnpj', 'regional', 'import_id', 'created_at'] },
  materiais:                { label: 'Materiais',                  cols: ['origem', 'alias', 'categoria', 'import_id', 'created_at'] },
  grupos_materiais:         { label: 'Grupos de Materiais',        cols: ['nome', 'created_at'] },
  regionais_centrais:       { label: 'Regionais',                  cols: ['nome', 'created_at'] },
  imports:                  { label: 'Log de Importações',         cols: ['arquivo', 'modulo', 'registros', 'total_arquivo', 'data_hora', 'status', 'status_tip', 'created_at'] },
  // Operacional
  ocorrencias:              { label: 'Ocorrências',                cols: ['data_abertura', 'motivo', 'data_limite', 'central', 'material', 'operador', 'contato', 'descricao', 'concluida', 'data_conclusao', 'desc_conclusao', 'inconclusiva', 'data_inconclusiva', 'motivo_inconclusiva', 'hierarquia', 'criado_em', 'origem_ajuste_sistemico', 'dai_id', 'dai_numero', 'dai_tag', 'dai_item_id', 'numero', 'co_owners'] },
  acoes_relatorio:          { label: 'Ações de Relatório',         cols: ['nivel', 'categorias', 'acoes', 'created'] },
  inv_justificativas:       { label: 'Justificativas de Inventário', cols: ['k', 'op', 'fiscal', 'saldo', 'custo_medio_sap', 'documento_sap'] },
  sap_fechamento_overrides: { label: 'Overrides de Fechamento SAP', cols: ['chave'] },
  ajustes_sistemicos:       { label: 'DAI / Ajuste Sistêmico',     cols: ['tag', 'numero', 'data_geracao', 'data_geracao_key', 'data_ocorrido', 'central', 'cnpj_central', 'regional_central', 'descricao', 'informantes', 'itens', 'analista', 'atestado_manual', 'ocorrencia_por_item', 'ocorrencia_ids', 'anexos', 'material', 'tipo_movimento_sap', 'objetivo', 'operador', 'sap_documento', 'origem', 'categoria_situacao', 'filial_destino'] },
  ajustes_excluidos:        { label: 'Log de Exclusão de DAI',     cols: ['dai_tag', 'dai_numero', 'central', 'data_geracao', 'excluido_por', 'excluido_em'], readOnly: true },
  notas_ajuste:             { label: 'Notas de Crédito/Débito',    cols: ['numero', 'tipo', 'central', 'cnpj_central', 'data_key', 'data_geracao', 'valor_total', 'responsavel_nome', 'responsavel_cpf', 'responsavel_email', 'itens'], readOnly: true },
  // Módulos grandes (Fase 4)
  lancamentos:              { label: 'Lançamentos',                cols: ['fonte', 'central_original', 'central', 'dt_lanc', 'fornecedor', 'categoria_original', 'categoria', 'material_original', 'material', 'peso', 'um', 'custo', 'valor_total', 'import_id', 'created_at', 'criado_em', 'editado'] },
  producao:                 { label: 'Produção',                   cols: ['fonte', 'mes', 'central_original', 'central', 'producao', 'um', 'preco_medio', 'custo_medio', 'margem', 'total_vendas', 'import_id', 'created_at'] },
  entradas:                 { label: 'Entradas',                   cols: ['fonte', 'central_compra_original', 'central_compra', 'central_destino_original', 'central_destino', 'nf', 'dt_emissao', 'dt_descarga', 'fornecedor', 'categoria_original', 'categoria', 'material_original', 'material', 'peso', 'um', 'custo', 'valor_total', 'import_id', 'created_at'] },
  saidas:                   { label: 'Saídas',                     cols: ['fonte', 'central_original', 'central', 'dt_emissao', 'os', 'contrato', 'categoria_original', 'categoria', 'fornecedor', 'material_original', 'material', 'peso', 'um', 'custo', 'valor_total', 'import_id', 'created_at'] },
  sap:                      { label: 'SAP',                        cols: ['fonte', 'usuario', 'movimento', 'ref', 'documento', 'central_original', 'central', 'deposito', 'dt_doc', 'dt_lanc', 'dt_reg', 'material_original', 'material', 'peso', 'um', 'custo_unit', 'valor_total', 'import_id', 'created_at'] },
};

let _adminProfiles = [];        // cache do último fetch de profiles (email por user_id)
let _adminAuthInfo = {};        // cache de admin_list_auth_users(), por user_id — confirmação, último login, suspensão
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
  imports:                  { registros: 'number', total_arquivo: 'number', created_at: 'number' },
  ocorrencias:              { concluida: 'boolean', inconclusiva: 'boolean', origem_ajuste_sistemico: 'boolean', criado_em: 'number', hierarquia: 'json', co_owners: 'user_multi' },
  acoes_relatorio:          { categorias: 'array' },
  ajustes_sistemicos:       { data_geracao: 'number', atestado_manual: 'boolean', ocorrencia_por_item: 'boolean', informantes: 'json', itens: 'json', ocorrencia_ids: 'json', anexos: 'json' },
  ajustes_excluidos:        { data_geracao: 'number', excluido_em: 'number' },
  notas_ajuste:             { data_geracao: 'number', valor_total: 'number', itens: 'json' },
  lancamentos:              { peso: 'number', valor_total: 'number', custo: 'number', created_at: 'number', editado: 'boolean' },
  producao:                 { producao: 'number', custo_medio: 'number', preco_medio: 'number', total_vendas: 'number', created_at: 'number' },
  entradas:                 { peso: 'number', valor_total: 'number', custo: 'number', created_at: 'number' },
  saidas:                   { peso: 'number', valor_total: 'number', custo: 'number', created_at: 'number' },
  sap:                      { peso: 'number', valor_total: 'number', custo_unit: 'number', created_at: 'number' },
};
function _adminFieldType(modulo, col) {
  return _ADMIN_COL_TYPES[modulo]?.[col] || 'text';
}

// ═══════════════════════════════════════════════════════════
// PENDENTES DE INTEGRAÇÃO — registros de outros usuários que o ADM ainda
// não aceitou (record_integrations). Complementa a notificação em tempo
// real (js/notifications.js): a notificação só dispara pra um INSERT novo
// via Realtime, não recria eventos passados — esta lista cobre o que já
// existia antes do fluxo de aceite existir, ou que passou despercebido.
// Lista simples (sem paginação por cursor como "Dados por módulo") porque
// esta é uma fila de revisão, não um navegador de dados completo — teto de
// _ADMIN_PENDENTES_CAP por módulo é suficiente pro uso real do sistema.
// ═══════════════════════════════════════════════════════════
const _ADMIN_PENDENTES_CAP = 300;
let _adminPendentesAtual = []; // linhas pendentes carregadas do módulo selecionado

function adminModulosIntegracao() {
  return (typeof RECORD_INTEGRATION_TABLES !== 'undefined' ? RECORD_INTEGRATION_TABLES : [])
    .filter(t => ADMIN_MODULOS[t]);
}

function _adminPendentesResumoLinha(modulo, row) {
  const cols = ADMIN_MODULOS[modulo]?.cols || [];
  return cols.map(c => row[c]).filter(v => v !== null && v !== undefined && v !== '')
    .slice(0, 3).join(' · ') || '—';
}

async function adminLoadPendentes() {
  const sel = document.getElementById('admin-pendentes-modulo-select');
  const modulo = sel?.value || adminModulosIntegracao()[0];
  if (!modulo) return;
  const listEl = document.getElementById('admin-pendentes-list');
  const countEl = document.getElementById('admin-pendentes-count');
  if (listEl) listEl.innerHTML = `<div class="empty-state"><i class="ti ti-loader"></i><p>Carregando...</p></div>`;

  const meuId = window.currentUser?.id;
  const [{ data: rows, error: rowsErr }, { data: integrados, error: intErr }, { data: perfis }] = await Promise.all([
    window.supabaseClient.from(modulo).select('*').neq('user_id', meuId).limit(_ADMIN_PENDENTES_CAP),
    window.supabaseClient.from('record_integrations').select('row_id').eq('table_name', modulo).eq('integrated_by', meuId),
    window.supabaseClient.from('profiles').select('id, email'),
  ]);
  if (rowsErr || intErr) {
    if (listEl) listEl.innerHTML = `<div class="empty-state"><i class="ti ti-alert-triangle"></i><p>Falha ao carregar: ${_adminEsc((rowsErr||intErr).message)}</p></div>`;
    return;
  }
  const jaIntegrados = new Set((integrados||[]).map(r => r.row_id));
  const emailPorId = new Map((perfis||[]).map(p => [p.id, p.email]));
  _adminPendentesAtual = (rows||[]).filter(r => !jaIntegrados.has(String(r.id)));

  if (countEl) countEl.textContent = `${_adminPendentesAtual.length} pendente(s)`;
  if (!listEl) return;
  if (!_adminPendentesAtual.length) {
    listEl.innerHTML = `<div class="empty-state"><i class="ti ti-circle-check"></i><p>Nada pendente neste módulo.</p></div>`;
    return;
  }
  listEl.innerHTML = _adminPendentesAtual.map(r => `
    <div class="admin-pendente-item" data-row-id="${_adminEsc(r.id)}">
      <div class="admin-pendente-info">
        <div class="admin-pendente-resumo">${_adminEsc(_adminPendentesResumoLinha(modulo, r))}</div>
        <div class="admin-pendente-dono">${_adminEsc(emailPorId.get(r.user_id) || r.user_id)}</div>
      </div>
      <button class="btn btn-sm" onclick="adminAceitarPendente('${_adminEsc(modulo)}','${_adminEsc(r.id)}')"><i class="ti ti-download"></i> Aceitar</button>
    </div>`).join('');
}

async function adminAceitarPendente(modulo, rowId) {
  const ok = await integrarRegistro(modulo, rowId);
  if (!ok) { toast('Falha ao aceitar registro.', 'error'); return; }
  _adminPendentesAtual = _adminPendentesAtual.filter(r => String(r.id) !== String(rowId));
  adminLoadPendentes();
}

async function adminAceitarTodosPendentes() {
  const sel = document.getElementById('admin-pendentes-modulo-select');
  const modulo = sel?.value;
  if (!modulo || !_adminPendentesAtual.length) return;
  if (!confirm(`Aceitar todos os ${_adminPendentesAtual.length} registros pendentes listados?`)) return;
  for (const r of _adminPendentesAtual) await integrarRegistro(modulo, r.id);
  toast('Registros integrados.', 'success');
  adminLoadPendentes();
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

// ── Filtro por dono — "Dados por módulo" (30/07) ────────────
// Clicar no e-mail da coluna "Dono" filtra a tabela só pros registros
// daquele usuário, no mesmo espírito de navegar pra dentro de uma pasta
// no navegador de Storage (aba Servidor). Diferente da busca por texto,
// PERSISTE ao trocar de módulo — user_id é a mesma coluna em toda
// tabela, então "ver só os dados deste usuário" continua fazendo
// sentido ao ir de um módulo pro outro; só "Limpar filtro" tira.
let _adminDonoFiltro = null; // { id, email } | null

function _adminBuildSearchOr(modulo, cfg) {
  if (!_adminSearchTerm) return null;
  const textCols = (cfg.cols || []).filter(c => _adminFieldType(modulo, c) === 'text');
  if (!textCols.length) return null;
  // remove % e vírgula — quebrariam a sintaxe do .ilike()/.or() do PostgREST
  const term = _adminSearchTerm.replace(/[%,]/g, '').trim();
  if (!term) return null;
  return textCols.map(c => `${c}.ilike.%${term}%`).join(',');
}

// Compõe o filtro de dono (.eq) + busca de texto (.or) num query builder
// só — usado na contagem, na busca de linhas e nas ações em lote "todos
// os N do filtro", pra garantir que a mesma combinação de filtros vista
// na tela é exatamente a aplicada na ação.
function _adminAplicarFiltros(query, modulo, cfg) {
  if (_adminDonoFiltro) query = query.eq('user_id', _adminDonoFiltro.id);
  const orClause = _adminBuildSearchOr(modulo, cfg);
  if (orClause) query = query.or(orClause);
  return query;
}

function _adminTemFiltroAtivo() {
  return !!_adminSearchTerm || !!_adminDonoFiltro;
}

// Ocorrências vinculadas a um DAI (origem_ajuste_sistemico=true) têm um
// fluxo de exclusão próprio e obrigatório (checkbox de ciência + log
// permanente em ajustes_excluidos — ver confirmarExcluirAjusteSistemico,
// ocorrencias.js) porque representam um documento fiscal já emitido.
// Ações EM MASSA daqui (checkbox ou "todos os N do filtro") nunca devem
// tocar essas linhas — só o clique individual (que abre o modal de
// verdade, ver ADMIN_MODAL_PROPRIO) passa por esse cuidado. .or() em vez
// de .eq()/.neq() sozinho pra não excluir por engano uma linha antiga
// com a coluna NULL (NULL = false é NULL em SQL, não true).
function _adminExcluirDaiDoLote(query, modulo) {
  if (modulo !== 'ocorrencias') return query;
  return query.or('origem_ajuste_sistemico.is.null,origem_ajuste_sistemico.eq.false');
}

// Descreve em texto os filtros ativos (dono + busca) pra usar nas frases
// de confirmação das ações em lote — combina os dois quando ambos estão
// ativos, ex.: "do usuário fulano@x.com que batem na busca "abc"".
function _adminDescricaoFiltroAtivo() {
  const partes = [];
  if (_adminDonoFiltro) partes.push(`do usuário ${_adminDonoFiltro.email}`);
  if (_adminSearchTerm) partes.push(`que batem na busca "${_adminEsc(_adminSearchTerm)}"`);
  return partes.join(' ');
}

function adminFiltrarPorDono(userId) {
  if (!userId) return;
  const email = _adminProfiles.find(p => p.id === userId)?.email || userId;
  _adminDonoFiltro = { id: userId, email };
  _adminLimparSelecaoInterno(); // novo filtro — seleção do filtro anterior não vale mais
  adminLoadModulo('first');
}

function adminLimparFiltroDono() {
  _adminDonoFiltro = null;
  _adminLimparSelecaoInterno();
  adminLoadModulo('first');
}

// Handler do <select id="admin-dono-select"> — via dropdown, não precisa
// mais caçar o usuário clicando numa linha da tabela (útil quando a
// lista já tem muitos registros do usuário errado antes do certo).
function adminSelecionarDono(userId) {
  if (!userId) { adminLimparFiltroDono(); return; }
  adminFiltrarPorDono(userId);
}

// Popula o <select id="admin-dono-select"> com os usuários de _adminProfiles
// (já carregado nesse ponto por adminLoadModulo) e mantém a opção
// selecionada em sincronia com _adminDonoFiltro — chamada em toda carga
// de "Dados por módulo", inclusive quando o filtro muda por outro
// caminho (clique na coluna "Dono").
function _adminPopularSelectDono() {
  const select = document.getElementById('admin-dono-select');
  if (!select) return;
  const usuarios = _adminProfiles.slice().sort((a, b) => (a.email || '').localeCompare(b.email || ''));
  const atualId = _adminDonoFiltro?.id || '';
  select.innerHTML = `<option value="">Todos os usuários</option>` +
    usuarios.map(u => `<option value="${u.id}" ${u.id === atualId ? 'selected' : ''}>${_adminEsc(u.email)}</option>`).join('');
}

function _adminAtualizarBannerDono(cfg) {
  const banner = document.getElementById('admin-dono-filtro-banner');
  const label = document.getElementById('admin-dono-filtro-label');
  const btnExcluir = document.getElementById('admin-dono-filtro-excluir');
  if (!banner) return;
  if (!_adminDonoFiltro) { banner.style.display = 'none'; return; }
  banner.style.display = 'flex';
  if (label) label.textContent = `Filtrando por usuário: ${_adminDonoFiltro.email}`;
  if (btnExcluir) btnExcluir.style.display = cfg?.readOnly ? 'none' : '';
}

// "Excluir tudo deste usuário neste módulo" — equivalente ao "excluir
// pasta inteira" do navegador de Storage: apaga de uma vez TODOS os
// registros que batem no filtro por dono atual (+ busca de texto, se
// houver alguma combinada), sem precisar selecionar linha por linha.
function adminExcluirTudoDono() {
  const modulo = document.getElementById('admin-modulo-select')?.value;
  const cfg = ADMIN_MODULOS[modulo];
  if (!cfg || cfg.readOnly || !_adminDonoFiltro) return;

  const totalTxt = _adminPageTotal !== null ? `${_adminPageTotal.toLocaleString('pt-BR')} ` : '';
  const buscaTxt = _adminSearchTerm ? ` que batem na busca "${_adminEsc(_adminSearchTerm)}"` : '';

  confirmarDestrutivo({
    title: 'Confirmar exclusão por usuário',
    sub: cfg.label,
    body: `Você está prestes a excluir permanentemente ${totalTxt}registro(s) de <strong>${_adminEsc(_adminDonoFiltro.email)}</strong> na tabela <strong>${_adminEsc(cfg.label)}</strong>${buscaTxt}. Esta ação não pode ser desfeita.`,
    confirmLabel: 'Excluir tudo deste usuário',
    requireConsent: true,
    consentLabel: `Entendo que isso apaga permanentemente os registros de ${_adminDonoFiltro.email} nesta tabela.`,
    onConfirm: async () => {
      let query = window.supabaseClient.from(modulo).delete();
      query = _adminAplicarFiltros(query, modulo, cfg);
      query = _adminExcluirDaiDoLote(query, modulo);
      const { error } = await query;
      if (error) { toast('Falha ao excluir: ' + _adminErroDetalhe(error), 'error'); return; }
      toast('Registros excluídos.', 'success');
      adminLimparSelecao();
      adminLoadModulo();
    },
  });
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

// Troca de módulo — limpa a busca de texto (os campos mudam de um
// módulo pro outro, buscar pelo termo antigo não faria sentido no
// novo), mas MANTÉM o filtro por dono (ver comentário de _adminDonoFiltro).
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
    tbody.innerHTML = `<tr><td colspan="3"><div class="empty-state"><i class="ti ti-alert-triangle"></i><p>Falha ao carregar: ${_adminErroDetalhe(error)}</p></div></td></tr>`;
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
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><i class="ti ti-alert-triangle"></i><p>Falha ao carregar: ${_adminErroDetalhe(error)}</p></div></td></tr>`;
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

// ── "Resumo por Usuário" (29/07, refundida em 30/07) ─────────
// Fundiu duas tabelas que mostravam a mesma matriz linhas-por-tabela em
// orientações diferentes ("Linhas por usuário, por tabela" e "Resumo por
// Usuário") — mantido só esta, com tabela nas LINHAS e usuário nas
// COLUNAS (orientação da que foi removida), mas com os bytes que só a
// outra tinha. Combina TRÊS fontes:
//   1) admin_user_table_counts() — linhas por tabela
//   2) admin_user_table_sizes()  — bytes por tabela no Postgres, por linha
//   3) admin_storage_stats()     — bytes no Storage, por usuário+módulo
//      (é onde Entradas/Saídas/Lançamentos/SAP realmente guardam o
//      volume grande, como arquivos .json.gz, não como linhas — ver
//      cloud-backup.js. Por isso vira uma linha própria "Storage
//      (backups)" no rodapé, não uma coluna por tabela.)
// admin_storage_stats() identifica o usuário por E-MAIL (não por
// user_id, ver a própria função) — por isso o cruzamento com o banco
// (que usa user_id) é feito via u.email, não via id.
async function adminLoadUserSummary() {
  const thead = document.getElementById('admin-user-summary-thead');
  const tbody = document.getElementById('admin-user-summary-tbody');
  if (!thead || !tbody) return;

  tbody.innerHTML = `<tr><td><div class="empty-state"><i class="ti ti-loader"></i><p>Carregando...</p></div></td></tr>`;

  if (!_adminProfiles.length) {
    const { data } = await window.supabaseClient.from('profiles').select('id, email');
    _adminProfiles = data || [];
  }
  const usuarios = _adminProfiles.slice().sort((a, b) => (a.email || '').localeCompare(b.email || ''));

  const [countsRes, sizesRes, storageRes] = await Promise.all([
    window.supabaseClient.rpc('admin_user_table_counts'),
    window.supabaseClient.rpc('admin_user_table_sizes'),
    window.supabaseClient.rpc('admin_storage_stats'),
  ]);

  const erro = countsRes.error || sizesRes.error || storageRes.error;
  if (erro) {
    tbody.innerHTML = `<tr><td><div class="empty-state"><i class="ti ti-alert-triangle"></i><p>Falha ao carregar: ${_adminEsc(erro.message)}</p></div></td></tr>`;
    return;
  }

  // linhasPorTabela[tabela][user_id] = contagem
  const linhasPorTabela = {};
  (countsRes.data || []).forEach(c => {
    if (!linhasPorTabela[c.table_name]) linhasPorTabela[c.table_name] = {};
    linhasPorTabela[c.table_name][c.user_id] = Number(c.row_count) || 0;
  });

  // bytesBancoPorTabela[tabela][user_id] = bytes (só as 18 tabelas do Postgres)
  const bytesBancoPorTabela = {};
  (sizesRes.data || []).forEach(s => {
    if (!bytesBancoPorTabela[s.table_name]) bytesBancoPorTabela[s.table_name] = {};
    bytesBancoPorTabela[s.table_name][s.user_id] = Number(s.total_bytes) || 0;
  });

  // bytesStoragePorEmail[email] = soma de todos os módulos daquele usuário
  // no Storage (Entradas/Saídas/Lançamentos/SAP entram aqui, não em linhas)
  const storageStats = Array.isArray(storageRes.data) ? storageRes.data[0] : storageRes.data;
  const bytesStoragePorEmail = {};
  (storageStats?.pastas || []).forEach(p => {
    bytesStoragePorEmail[p.usuario] = (bytesStoragePorEmail[p.usuario] || 0) + Number(p.bytes || 0);
  });

  const tabelas = Object.keys(ADMIN_MODULOS);

  if (!usuarios.length) {
    thead.innerHTML = '';
    tbody.innerHTML = `<tr><td><div class="empty-state"><i class="ti ti-database-off"></i><p>Sem usuários.</p></div></td></tr>`;
    return;
  }

  thead.innerHTML = `<tr><th>Tabela</th>${usuarios.map(u => `<th style="text-align:center" title="${_adminEsc(u.email)}">${_adminEsc((u.email || '').split('@')[0])}</th>`).join('')}<th style="text-align:center">Tamanho (banco)</th></tr>`;

  const totalLinhasPorUsuario = usuarios.map(() => 0);
  const totalBytesBancoPorUsuario = usuarios.map(() => 0);
  let totalBytesBancoGeral = 0;

  const linhasTabelas = tabelas.map(t => {
    let bytesTabela = 0;
    const cells = usuarios.map((u, i) => {
      const n = linhasPorTabela[t]?.[u.id] || 0;
      const bytes = bytesBancoPorTabela[t]?.[u.id] || 0;
      totalLinhasPorUsuario[i] += n;
      totalBytesBancoPorUsuario[i] += bytes;
      bytesTabela += bytes;
      return `<td style="text-align:center;${n === 0 ? 'color:var(--text3)' : ''}">${n.toLocaleString('pt-BR')}</td>`;
    }).join('');
    totalBytesBancoGeral += bytesTabela;
    return `<tr><td>${_adminEsc(ADMIN_MODULOS[t]?.label || t)}</td>${cells}<td style="text-align:center;color:var(--text2)">${formatBytes(bytesTabela)}</td></tr>`;
  }).join('');

  const linhaTotalBanco = `<tr style="font-weight:600;border-top:2px solid var(--border2)">
    <td>Total (banco)</td>
    ${totalLinhasPorUsuario.map(n => `<td style="text-align:center">${n.toLocaleString('pt-BR')}</td>`).join('')}
    <td style="text-align:center">${formatBytes(totalBytesBancoGeral)}</td>
  </tr>`;

  let totalBytesStorageGeral = 0;
  const linhaStorage = `<tr style="color:var(--text2)">
    <td>Storage (backups)</td>
    ${usuarios.map(u => {
      const b = bytesStoragePorEmail[u.email] || 0;
      totalBytesStorageGeral += b;
      return `<td style="text-align:center">${b ? formatBytes(b) : '—'}</td>`;
    }).join('')}
    <td style="text-align:center">${formatBytes(totalBytesStorageGeral)}</td>
  </tr>`;

  const linhaTotalGeral = `<tr style="font-weight:700;border-top:2px solid var(--border2)">
    <td>Tamanho total</td>
    ${usuarios.map((u, i) => `<td style="text-align:center">${formatBytes(totalBytesBancoPorUsuario[i] + (bytesStoragePorEmail[u.email] || 0))}</td>`).join('')}
    <td style="text-align:center">${formatBytes(totalBytesBancoGeral + totalBytesStorageGeral)}</td>
  </tr>`;

  tbody.innerHTML = linhasTabelas + linhaTotalBanco + linhaStorage + linhaTotalGeral;
}

// Escapa os 5 caracteres com significado em HTML. As aspas faltavam e este
// helper é usado dentro de atributos (title="...", data-id="..."), onde a
// ausência delas permitia fechar o atributo e injetar outro.
function _adminEsc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Mensagem de erro segura para exibir. O texto cru do Postgres (nome de
// tabela, coluna, constraint violada) ia direto para a tela e entregava a
// estrutura do banco de graça a quem estivesse olhando. O detalhe técnico
// continua disponível — só que no console, para quem está depurando.
function _adminErroDetalhe(error) {
  console.error('[Admin] Falha na operação:', error);
  return 'tente novamente ou contate o suporte.';
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
  const elPendentes = document.getElementById('admin-section-pendentes');
  const elFormPublico = document.getElementById('admin-section-formpublico');
  const elServidor = document.getElementById('admin-section-servidor');
  if (elUsuarios) elUsuarios.style.display = section === 'usuarios' ? '' : 'none';
  if (elDados)    elDados.style.display    = section === 'dados' ? '' : 'none';
  if (elPendentes) elPendentes.style.display = section === 'pendentes' ? '' : 'none';
  if (elFormPublico) elFormPublico.style.display = section === 'formpublico' ? '' : 'none';
  if (elServidor) elServidor.style.display = section === 'servidor' ? '' : 'none';
  document.getElementById('admin-subnav-usuarios')?.classList.toggle('active', section === 'usuarios');
  document.getElementById('admin-subnav-dados')?.classList.toggle('active', section === 'dados');
  document.getElementById('admin-subnav-pendentes')?.classList.toggle('active', section === 'pendentes');
  document.getElementById('admin-subnav-formpublico')?.classList.toggle('active', section === 'formpublico');
  document.getElementById('admin-subnav-servidor')?.classList.toggle('active', section === 'servidor');

  if (section === 'usuarios') { adminLoadUsuarios(); adminLoadDbStats(); }
  if (section === 'dados') adminLoadModulo();
  if (section === 'pendentes') adminLoadPendentes();
  if (section === 'formpublico') adminLoadFormPublico();
  if (section === 'servidor') adminServidorListar();

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
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><i class="ti ti-loader"></i><p>Carregando...</p></div></td></tr>';
  }

  const [profilesRes, authRes] = await Promise.all([
    window.supabaseClient.from('profiles').select('id, email, role, created_at, last_seen').order('created_at', { ascending: true }),
    window.supabaseClient.rpc('admin_list_auth_users'),
  ]);

  if (profilesRes.error) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><i class="ti ti-alert-triangle"></i><p>Falha ao carregar: ${_adminErroDetalhe(profilesRes.error)}</p></div></td></tr>`;
    return;
  }

  _adminProfiles = profilesRes.data || [];
  _adminAuthInfo = Object.fromEntries((authRes.data || []).map(a => [a.id, a]));

  if (!_adminProfiles.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><i class="ti ti-users"></i><p>Nenhum usuário encontrado.</p></div></td></tr>';
    return;
  }

  tbody.innerHTML = _adminProfiles.map(u => {
    const isSelf = u.id === window.currentUser?.id;
    const criadoEm = u.created_at ? new Date(u.created_at).toLocaleDateString('pt-BR') : '—';
    const status = _adminStatusInfo(u.last_seen);
    const auth = _adminAuthInfo[u.id] || {};
    const confirmadoIcon = auth.email_confirmed_at
      ? `<i class="ti ti-rosette-discount-check" style="color:var(--green)" title="E-mail confirmado em ${new Date(auth.email_confirmed_at).toLocaleDateString('pt-BR')}"></i>`
      : `<i class="ti ti-alert-circle" style="color:var(--amber)" title="E-mail ainda não confirmado"></i>`;
    const ultimoLogin = auth.last_sign_in_at ? new Date(auth.last_sign_in_at).toLocaleString('pt-BR') : '—';
    const suspenso = !!auth.banned_until;
    return `<tr>
      <td>${_adminEsc(u.email)} ${confirmadoIcon}${isSelf ? ' <span style="color:var(--text3);font-size:11px">(você)</span>' : ''}</td>
      <td>
        <span style="display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;color:${status.color};background:${status.bg};border-radius:999px;padding:3px 10px">
          <span style="width:7px;height:7px;border-radius:50%;background:${status.color};display:inline-block"></span>
          ${status.label}
        </span>
      </td>
      <td>
        <span style="display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;color:${suspenso ? 'var(--red)' : 'var(--green)'};background:${suspenso ? 'var(--red-bg)' : 'var(--green-bg)'};border-radius:999px;padding:3px 10px">
          <i class="ti ti-${suspenso ? 'lock' : 'lock-open'}"></i> ${suspenso ? 'Suspenso' : 'Ativo'}
        </span>
      </td>
      <td style="color:var(--text2);font-size:12px">${ultimoLogin}</td>
      <td>
        <select class="form-select" style="font-size:12px;padding:4px 8px;width:auto"
          onchange="adminAlterarPapel('${u.id}', this.value)"
          ${isSelf ? 'disabled title="Não é possível alterar o próprio papel por aqui — peça a outro admin, se precisar."' : ''}>
          <option value="user" ${u.role === 'user' ? 'selected' : ''}>Usuário</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Supervisor</option>
        </select>
      </td>
      <td style="color:var(--text2)">${criadoEm}</td>
      <td style="white-space:nowrap">
        ${isSelf ? '' : `
          <button class="btn-icon" title="${suspenso ? 'Reativar acesso' : 'Suspender acesso'}" onclick="adminSuspenderUsuario('${u.id}', ${suspenso ? 'false' : 'true'})"><i class="ti ti-${suspenso ? 'lock-open' : 'lock'}"></i></button>
          <button class="btn-icon danger" title="Resetar dados deste usuário" onclick="adminResetarUsuario('${u.id}')"><i class="ti ti-eraser"></i></button>
        `}
      </td>
    </tr>`;
  }).join('');
}

async function adminAlterarPapel(userId, novoPapel) {
  const label = novoPapel === 'admin' ? 'Supervisor' : 'Usuário';
  if (!confirm(`Confirma alterar o papel deste usuário para "${label}"?`)) {
    adminLoadUsuarios(); // desfaz a troca visual do <select>
    return;
  }
  const { error } = await window.supabaseClient.from('profiles').update({ role: novoPapel }).eq('id', userId);
  if (error) {
    toast('Falha ao alterar o papel: ' + _adminErroDetalhe(error), 'error');
    adminLoadUsuarios();
    return;
  }
  toast('Papel atualizado.', 'success');
  adminLoadUsuarios();
}

// ── Suspender / reativar acesso ─────────────────────────────
// Usa admin_set_user_banned() (RPC, só-admin) — seta/limpa banned_until
// no auth.users. Reversível (por isso sem consentLabel/checkbox extra,
// diferente do reset). Sessão já aberta do usuário continua valendo até
// expirar/renovar — o bloqueio vale a partir do próximo login.
function adminSuspenderUsuario(userId, suspender) {
  const email = _adminProfiles.find(p => p.id === userId)?.email || userId;
  confirmarDestrutivo({
    title: suspender ? 'Confirmar suspensão de acesso' : 'Confirmar reativação de acesso',
    sub: email,
    body: suspender
      ? `O usuário <strong>${_adminEsc(email)}</strong> não vai mais conseguir entrar no sistema. Sessões já abertas continuam válidas até expirarem — o bloqueio vale a partir do próximo login.`
      : `O usuário <strong>${_adminEsc(email)}</strong> volta a conseguir entrar no sistema normalmente.`,
    confirmLabel: suspender ? 'Suspender acesso' : 'Reativar acesso',
    onConfirm: async () => {
      const { error } = await window.supabaseClient.rpc('admin_set_user_banned', { target_user_id: userId, banned: suspender });
      if (error) { toast(`Falha ao ${suspender ? 'suspender' : 'reativar'}: ` + _adminErroDetalhe(error), 'error'); return; }
      toast(suspender ? 'Acesso suspenso.' : 'Acesso reativado.', 'success');
      adminLoadUsuarios();
    },
  });
}

// ── Resetar usuário ──────────────────────────────────────────
// Apaga TODOS os dados operacionais do usuário (19 tabelas com user_id,
// via admin_reset_user() RPC — só-admin) + a pasta dele no bucket
// backups-condensados. NÃO mexe em login/senha (auth.users) nem no
// registro de profiles (papel/e-mail continuam intactos) — "reset" aqui
// é "esvaziar o que a conta produziu", não "apagar a conta".
// A limpeza do Storage é feita aqui no cliente (não na RPC) porque
// apagar a linha de storage.objects via SQL só remove metadado, não o
// blob de verdade — isso exige passar pela Storage API (.remove()).
function adminResetarUsuario(userId) {
  const email = _adminProfiles.find(p => p.id === userId)?.email || userId;
  confirmarDestrutivo({
    title: 'Confirmar reset de usuário',
    sub: email,
    body: `Isso apaga <strong>permanentemente</strong> todos os dados operacionais de <strong>${_adminEsc(email)}</strong> — ocorrências, lançamentos, entradas/saídas, DAIs, notas, importações, backups no Storage etc. — nas 19 tabelas do sistema. O login, a senha e o cadastro (papel/e-mail) NÃO são afetados; a conta continua existindo, só some o que foi produzido com ela. Esta ação não pode ser desfeita.`,
    confirmLabel: 'Resetar usuário',
    requireConsent: true,
    consentLabel: `Entendo que isso apaga permanentemente todos os dados de ${email}.`,
    onConfirm: () => _adminExecutarResetUsuario(userId),
  });
}

async function _adminExecutarResetUsuario(userId) {
  const { data, error } = await window.supabaseClient.rpc('admin_reset_user', { target_user_id: userId });
  if (error) { toast('Falha ao resetar: ' + _adminErroDetalhe(error), 'error'); return; }

  const totalLinhas = Object.values(data || {}).reduce((soma, n) => soma + Number(n || 0), 0);

  let arquivosRemovidos = 0;
  const paths = await _adminListStorageRecursivo('backups-condensados', userId);
  if (paths.length) {
    const { error: storageError } = await window.supabaseClient.storage.from('backups-condensados').remove(paths);
    if (!storageError) arquivosRemovidos = paths.length;
  }

  toast(`Usuário resetado: ${totalLinhas.toLocaleString('pt-BR')} registro(s) e ${arquivosRemovidos} arquivo(s) removidos.`, 'success');
  adminLoadUsuarios();
  adminLoadDbStats();
  adminLoadUserSummary();
  if (_adminStorageLoadedOnce) adminLoadStorageStats();
}

// Lista recursivamente todos os ARQUIVOS (não pastas) sob um prefixo de
// um bucket — a Storage API só lista um nível por vez (pastas vêm com
// id:null), então desce nível por nível. Usada pelo reset de usuário
// acima e pelo navegador de Storage (seção Servidor) abaixo.
async function _adminListStorageRecursivo(bucket, prefix) {
  const { data, error } = await window.supabaseClient.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error || !data) return [];
  let paths = [];
  for (const item of data) {
    if (item.name === '.emptyFolderPlaceholder') continue;
    const full = `${prefix}/${item.name}`;
    if (item.id === null) paths = paths.concat(await _adminListStorageRecursivo(bucket, full));
    else paths.push(full);
  }
  return paths;
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
  thead.innerHTML = `<tr>${checkboxTh}<th>Dono</th>${cfg.cols.map(c => `<th>${_adminEsc(c)}</th>`).join('')}</tr>`;
  const colspan = cfg.cols.length + 1 + (cfg.readOnly ? 0 : 1);
  tbody.innerHTML = `<tr><td colspan="${colspan}"><div class="empty-state"><i class="ti ti-loader"></i><p>Carregando...</p></div></td></tr>`;
  _adminSetPageInfo('Carregando...');

  if (!_adminProfiles.length) {
    const { data } = await window.supabaseClient.from('profiles').select('id, email');
    _adminProfiles = data || [];
  }
  const emailPorId = Object.fromEntries(_adminProfiles.map(p => [p.id, p.email]));
  _adminPopularSelectDono();
  _adminAtualizarBannerDono(cfg);

  // Contagem exata — só busca de novo quando a paginação reinicia (troca
  // de módulo/Atualizar/nova busca), não a cada Próxima/Anterior.
  if (_adminPageTotal === null) {
    let countQuery = window.supabaseClient.from(modulo).select('*', { count: 'exact', head: true });
    countQuery = _adminAplicarFiltros(countQuery, modulo, cfg);
    countQuery.then(({ count }) => { _adminPageTotal = count ?? null; _adminSetPageInfo(); _adminAtualizarBarraLote(); });
  }

  const asc = direction !== 'prev' && direction !== 'last'; // prev/last buscam em DESC pra pegar o "lado de baixo"
  let query = window.supabaseClient.from(modulo).select('*').order('id', { ascending: asc }).limit(ADMIN_PAGE_SIZE + 1);
  query = _adminAplicarFiltros(query, modulo, cfg);
  if (direction === 'next')  query = query.gt('id', _adminPageLastId);
  if (direction === 'prev')  query = query.lt('id', _adminPageFirstId);

  const { data, error } = await query;
  if (error) {
    tbody.innerHTML = `<tr><td colspan="${colspan}"><div class="empty-state"><i class="ti ti-alert-triangle"></i><p>Falha ao carregar: ${_adminErroDetalhe(error)}</p></div></td></tr>`;
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
    const msg = _adminTemFiltroAtivo()
      ? 'Nenhum registro encontrado para este filtro.'
      : 'Nenhum registro nesta tabela.';
    tbody.innerHTML = `<tr><td colspan="${colspan}"><div class="empty-state"><i class="ti ti-database-off"></i><p>${msg}</p></div></td></tr>`;
    _adminSetPageInfo();
    _adminAtualizarBarraLote();
    return;
  }

  tbody.innerHTML = _adminCurrentRows.map(row => {
    const idStr = String(row.id);
    const dono = emailPorId[row.user_id] || '—';
    const donoTd = row.user_id
      ? `<a href="#" data-dono="${_adminEsc(row.user_id)}" onclick="event.stopPropagation();adminFiltrarPorDono(this.dataset.dono);return false" style="color:var(--text3)" title="Filtrar por este usuário"><i class="ti ti-filter" style="font-size:10px"></i> ${_adminEsc(dono)}</a>`
      : _adminEsc(dono);
    const cells = cfg.cols.map(c => {
      let v = row[c];
      if (Array.isArray(v)) v = _adminFieldType(modulo, c) === 'user_multi' ? v.map(id => emailPorId[id] || id).join(', ') : v.join(', ');
      else if (v && typeof v === 'object') v = JSON.stringify(v); // jsonb não-array (hierarquia, itens, etc.)
      if (typeof v === 'boolean') v = v ? 'Sim' : 'Não';
      if (v && String(v).length > 60) v = String(v).slice(0, 60) + '…';
      return `<td>${_adminEsc(v ?? '—')}</td>`;
    }).join('');
    // Ocorrência de DAI (documento fiscal já emitido) — exclusão/edição
    // em massa fica bloqueada pra essas linhas (ver _adminExcluirDaiDoLote
    // e o comentário em ADMIN_MODAL_PROPRIO); sem checkbox, só cadeado.
    const ehDai = modulo === 'ocorrencias' && row.origem_ajuste_sistemico === true;
    // Linha inteira clicável abre o modal de edição (que também tem o
    // botão Excluir agora) — ver adminAbrirEdicao. stopPropagation no
    // checkbox e no link "Dono" pra esses cliques não abrirem o modal
    // junto.
    const checkboxTd = cfg.readOnly ? '' : ehDai
      ? `<td class="th-checkbox" onclick="event.stopPropagation()" title="Vinculado a um DAI (documento fiscal) — sem exclusão/edição em massa; abra o registro pra excluir individualmente"><i class="ti ti-lock" style="color:var(--text3);font-size:12px"></i></td>`
      : `<td class="th-checkbox" onclick="event.stopPropagation()"><input type="checkbox" ${(_adminSelecaoTodosFiltro || _adminSelectedIds.has(idStr)) ? 'checked' : ''} ${_adminSelecaoTodosFiltro ? 'disabled' : ''} onchange="adminToggleSelecaoLinha(this.closest('tr').dataset.id, this.checked)"></td>`;
    // id/módulo vão por data-* e são lidos com this.dataset — NUNCA
    // interpolados dentro do onclick. O id destas tabelas é PK de texto
    // vinda do cliente; interpolado no handler, um id com aspa fechava a
    // string e executava JS arbitrário no navegador do ADM (esta tabela
    // renderiza linhas de TODOS os usuários). Escapar HTML não resolveria:
    // o atributo é decodificado antes de o JS ser interpretado.
    return `<tr data-id="${_adminEsc(idStr)}" data-modulo="${_adminEsc(modulo)}" onclick="adminAbrirEdicao(this.dataset.modulo, this.dataset.id)" style="cursor:pointer">
      ${checkboxTd}
      <td style="font-size:11px">${donoTd}</td>
      ${cells}
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
  const modulo = document.getElementById('admin-modulo-select')?.value;
  _adminCurrentRows.forEach(r => {
    if (modulo === 'ocorrencias' && r.origem_ajuste_sistemico === true) return; // sem checkbox — nunca entra na seleção
    const id = String(r.id);
    if (checked) _adminSelectedIds.add(id);
    else _adminSelectedIds.delete(id);
  });
  // Casa pelo data-id da <tr>, não por índice posicional — linhas de DAI
  // não têm checkbox, então a posição do <input> na lista diverge da
  // posição da linha em _adminCurrentRows.
  document.querySelectorAll('#admin-dados-tbody tr[data-id]').forEach(tr => {
    const cb = tr.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = _adminSelectedIds.has(tr.dataset.id);
  });
  _adminAtualizarBarraLote();
}

// Ativa o modo "todos os N registros do filtro" — só alcançável a partir
// do banner (2º clique, depois que a página inteira já foi marcada), e
// SÓ com busca de texto e/ou filtro por dono ativos (ver
// _adminTemFiltroAtivo). Essa exigência é proposital: sem ela, "todos"
// numa tabela sem filtro poderia significar literalmente a tabela
// inteira (ex.: 600 mil linhas em `sap`/`lancamentos`) selecionada em 2
// cliques — risco grande demais pra uma ação que alimenta exclusão/edição
// em massa. Com filtro obrigatório, a ação em lote sempre tem uma
// cláusula WHERE de verdade por trás (ver _adminExecutar* abaixo).
function adminSelecionarTodosFiltro() {
  if (!_adminTemFiltroAtivo() || _adminPageTotal === null) return;
  _adminSelecaoTodosFiltro = true;
  _adminSelectedIds.clear(); // o modo "todos" substitui qualquer seleção manual anterior
  document.querySelectorAll('#admin-dados-tbody input[type="checkbox"]').forEach(cb => { cb.checked = true; cb.disabled = true; });
  const checkAll = document.getElementById('admin-check-all');
  if (checkAll) { checkAll.checked = true; checkAll.indeterminate = false; checkAll.disabled = true; }
  _adminAtualizarBarraLote();
  toast(`Todos os ${_adminPageTotal.toLocaleString('pt-BR')} registros que batem no filtro atual foram selecionados.`, 'success');
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

  // Exclui linhas de DAI da contagem "página inteira selecionada" — elas
  // nunca têm checkbox (ver adminLoadModulo), então nunca deveriam contar
  // contra o "selecionou tudo".
  const moduloAtual = document.getElementById('admin-modulo-select')?.value;
  const idsPagina = _adminCurrentRows
    .filter(r => !(moduloAtual === 'ocorrencias' && r.origem_ajuste_sistemico === true))
    .map(r => String(r.id));
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
        banner.innerHTML = _adminTemFiltroAtivo()
          ? `<span><i class="ti ti-info-circle"></i> Todos os ${idsPagina.length} registros desta página estão selecionados.</span>
             <button type="button" class="admin-selectall-link" onclick="adminSelecionarTodosFiltro()">Selecionar todos os ${totalFiltro.toLocaleString('pt-BR')} que batem no filtro atual</button>`
          : `<span><i class="ti ti-info-circle"></i> Todos os ${idsPagina.length} registros desta página estão selecionados. Pra selecionar mais que isso de uma vez, aplique uma busca ou clique no "Dono" de uma linha primeiro — seleção de "todos" sem filtro ativo não é permitida, por segurança.</span>`;
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
    ? `TODOS os ${n.toLocaleString('pt-BR')} registros ${_adminDescricaoFiltroAtivo()} — não só os visíveis nesta página`
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
    // de UI inesperado chegasse aqui sem filtro ativo, a ação é bloqueada
    // antes de qualquer chamada ao banco. Nunca um DELETE sem filtro.
    if (!_adminTemFiltroAtivo()) {
      toast('Ação bloqueada: exclusão de "todos os registros do filtro" exige uma busca ou filtro de dono ativo.', 'error');
      return;
    }
    query = _adminAplicarFiltros(query, modulo, cfg);
    query = _adminExcluirDaiDoLote(query, modulo);
  } else {
    const ids = [..._adminSelectedIds];
    if (!ids.length) return;
    query = query.in('id', ids);
    query = _adminExcluirDaiDoLote(query, modulo); // defesa em profundidade — checkbox já vem oculto pra linha de DAI
  }

  const { error } = await query;
  if (error) { toast('Falha ao excluir em massa: ' + _adminErroDetalhe(error), 'error'); return; }
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
    ? (_adminFieldType(modulo, col) === 'user_multi'
        ? (parsed.value.map(id => _adminProfiles.find(p => p.id === id)?.email || id).join(', ') || '(nenhum usuário)')
        : (parsed.value.join(', ') || '(lista vazia)'))
    : (typeof parsed.value === 'boolean' ? (parsed.value ? 'Sim' : 'Não') : (parsed.value === null || parsed.value === '' ? '(vazio)' : parsed.value));

  const escopoTexto = _adminSelecaoTodosFiltro
    ? `TODOS os ${n.toLocaleString('pt-BR')} registros ${_adminDescricaoFiltroAtivo()} — não só os visíveis nesta página`
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
    if (!_adminTemFiltroAtivo()) {
      toast('Ação bloqueada: edição de "todos os registros do filtro" exige uma busca ou filtro de dono ativo.', 'error');
      return;
    }
    query = _adminAplicarFiltros(query, modulo, cfg);
    query = _adminExcluirDaiDoLote(query, modulo);
  } else {
    const ids = [..._adminSelectedIds];
    if (!ids.length) return;
    query = query.in('id', ids);
    query = _adminExcluirDaiDoLote(query, modulo); // defesa em profundidade — checkbox já vem oculto pra linha de DAI
  }

  const { error } = await query;
  if (error) { toast('Falha ao editar em massa: ' + _adminErroDetalhe(error), 'error'); return; }
  toast('Registros atualizados.', 'success');
  adminLimparSelecao();
  adminLoadModulo();
}

async function adminExcluirRegistro(modulo, id) {
  if (ADMIN_MODULOS[modulo]?.readOnly) return; // append-only — RLS bloquearia mesmo assim
  if (!confirm('Excluir este registro definitivamente? Esta ação não pode ser desfeita.')) return;
  const { error } = await window.supabaseClient.from(modulo).delete().eq('id', id);
  if (error) { toast('Falha ao excluir: ' + _adminErroDetalhe(error), 'error'); return; }
  toast('Registro excluído.', 'success');
  closeModal('admin-edit-modal'); // no-op se não estiver aberto (chamada também vem do botão dentro do modal)
  adminLoadModulo();
}

// Botão "Excluir" de dentro do modal de edição — único caminho de
// exclusão individual agora (30/07: linha da tabela não tem mais os dois
// botões de ícone, clicar na linha abre o modal e a exclusão sai daqui).
function adminExcluirRegistroModal() {
  const { modulo, id } = _adminEditContext || {};
  if (!modulo || !id) return;
  adminExcluirRegistro(modulo, id);
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
    // Pill Sim/Não (mesma linguagem visual do badge Ativo/Suspenso da
    // aba Usuários) em vez de um checkbox nu — valor real fica em
    // data-value, lido por _adminParseFieldValue.
    return `<div class="admin-bool-toggle" id="${inputId}" data-value="${val ? 'true' : 'false'}">
      <button type="button" class="admin-bool-btn ${val ? 'admin-bool-active-sim' : ''}" onclick="_adminToggleBool('${inputId}', true)">Sim</button>
      <button type="button" class="admin-bool-btn ${!val ? 'admin-bool-active-nao' : ''}" onclick="_adminToggleBool('${inputId}', false)">Não</button>
    </div>`;
  } else if (type === 'number') {
    return `<input type="number" step="any" class="form-input" id="${inputId}" value="${val ?? ''}">`;
  } else if (type === 'array') {
    const joined = Array.isArray(val) ? val.join(', ') : '';
    return `<input type="text" class="form-input" id="${inputId}" value="${_adminEsc(joined)}" placeholder="separado por vírgula">`;
  } else if (type === 'user_multi') {
    // Co-donos (ver ocorrencias_co_owners) — checkbox por usuário em vez
    // de UUID cru, reaproveitando _adminProfiles já carregado.
    const selecionados = new Set(Array.isArray(val) ? val : []);
    const usuarios = _adminProfiles.slice().sort((a, b) => (a.email || '').localeCompare(b.email || ''));
    const opcoes = usuarios.map(u => `<label style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer">
      <input type="checkbox" value="${u.id}" ${selecionados.has(u.id) ? 'checked' : ''} style="width:15px;height:15px">
      <span style="font-size:12.5px">${_adminEsc(u.email)}</span>
    </label>`).join('') || `<span style="font-size:12px;color:var(--text3)">Nenhum usuário cadastrado.</span>`;
    return `<div id="${inputId}" style="max-height:160px;overflow-y:auto;border:1px solid var(--border2);border-radius:var(--radius);padding:8px 10px">${opcoes}</div>`;
  } else if (type === 'json') {
    // Colunas jsonb (itens, anexos, hierarquia etc.) — sem editor
    // estruturado próprio, mas visível e editável como JSON bruto em vez
    // de completamente invisível/read-only.
    const texto = val != null ? JSON.stringify(val, null, 2) : '';
    return `<textarea class="form-input admin-field-json" id="${inputId}" rows="6" style="font-family:var(--mono);font-size:11.5px;min-height:120px">${_adminEsc(texto)}</textarea>`;
  }
  return `<input type="text" class="form-input" id="${inputId}" value="${_adminEsc(val ?? '')}">`;
}

// Clique num dos dois botões do pill Sim/Não — só troca a classe ativa e
// o data-value, não dispara nenhuma leitura/gravação (isso só acontece
// quando o formulário é salvo, via _adminParseFieldValue).
function _adminToggleBool(inputId, valor) {
  const el = document.getElementById(inputId);
  if (!el) return;
  el.dataset.value = valor ? 'true' : 'false';
  const [btnSim, btnNao] = el.querySelectorAll('.admin-bool-btn');
  btnSim?.classList.toggle('admin-bool-active-sim', valor);
  btnNao?.classList.toggle('admin-bool-active-nao', !valor);
}

// Valida e converte o valor bruto de um <input> pro tipo esperado da
// coluna. Retorna { ok:true, value } ou { ok:false, error } — nunca
// lança exceção, pra quem chama só precisar checar `.ok`.
function _adminParseFieldValue(modulo, col, inputEl) {
  const type = _adminFieldType(modulo, col);
  if (type === 'boolean') return { ok: true, value: inputEl.dataset.value === 'true' };
  if (type === 'number') {
    const raw = inputEl.value.trim();
    if (raw === '') return { ok: true, value: null };
    const n = Number(raw);
    if (!Number.isFinite(n)) return { ok: false, error: `Valor inválido em "${col}" — informe um número.` };
    return { ok: true, value: n };
  }
  if (type === 'array') return { ok: true, value: inputEl.value.split(',').map(s => s.trim()).filter(Boolean) };
  if (type === 'user_multi') return { ok: true, value: [...inputEl.querySelectorAll('input[type="checkbox"]:checked')].map(cb => cb.value) };
  if (type === 'json') {
    const raw = inputEl.value.trim();
    if (raw === '') return { ok: true, value: null };
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch {
      return { ok: false, error: `JSON inválido em "${col}" — corrija a sintaxe antes de salvar.` };
    }
  }
  return { ok: true, value: inputEl.value };
}

// Módulos que já têm um modal de visualização/edição de verdade no resto
// do app (não o formulário genérico campo-a-campo) — mapeados por
// investigação em 30/07. Só ocorrencias qualificou: o modal lê de
// state.ocorrencias, que pra uma conta admin já vem com os registros de
// TODOS os usuários (sync sem filtro por dono — ver
// syncOcorrenciasFromSupabase em ocorrencias.js), então funciona pra
// qualquer linha clicada aqui, não só as do próprio admin. Os outros
// candidatos óbvios NÃO qualificaram:
//  - ajustes_sistemicos (DAI): o único modal existente (editarSapDai) só
//    edita o Nº de documento SAP por item, não a linha inteira — mais
//    estreito que o formulário genérico, que já cobre isso e todo o
//    resto (itens/informantes/anexos em JSON).
//  - notas_ajuste: não existe modal de abrir um registro já gerado — o
//    ncd-modal é um assistente de GERAÇÃO em lote, não um viewer por id.
//  - inv_justificativas: o modal (_invRenderJustModal) depende de
//    invRows/invFiltered, variáveis privadas só populadas depois de
//    rodar o relatório de Inventário inteiro pra uma central/período —
//    não dá pra abrir a partir de um id isolado sem essa página inteira
//    carregada antes.
const ADMIN_MODAL_PROPRIO = {
  ocorrencias: (id) => {
    if (typeof openOcDetailModal !== 'function') return false;
    if (!(state.ocorrencias || []).some(o => o.id === id)) return false; // ainda não sincronizado — cai no genérico
    openOcDetailModal(id);
    return true;
  },
};

// Abre o modal de edição. Módulos em ADMIN_MODAL_PROPRIO abrem o modal
// de verdade do app (com escalonamento, conclusão, DAI etc.) em vez do
// formulário genérico abaixo. Pra tabelas append-only (readOnly), abre
// no modo SÓ VISUALIZAÇÃO (campos desabilitados, sem Salvar/Excluir): a
// linha inteira é clicável em toda tabela, então precisa de algum lugar
// pra ir quando não dá pra editar. RLS bloquearia a escrita mesmo se os
// botões estivessem visíveis; escondê-los aqui é só sobre a UI.
function adminAbrirEdicao(modulo, id) {
  if (ADMIN_MODAL_PROPRIO[modulo]?.(id)) return;

  const cfg = ADMIN_MODULOS[modulo];
  const row = _adminCurrentRows.find(r => String(r.id) === String(id));
  if (!row || !cfg) return;
  _adminEditContext = { modulo, id };

  const readOnly = !!cfg.readOnly;
  document.getElementById('admin-edit-sub').textContent = `${cfg.label || modulo} — ${id}`;

  const cols = cfg.cols || [];
  const fieldsEl = document.getElementById('admin-edit-fields');
  if (fieldsEl) {
    let divisorPosto = false;
    fieldsEl.innerHTML = cols.map(col => {
      const inputId = `admin-edit-field-${col}`;
      const inputHtml = _adminRenderFieldInput(modulo, col, row[col], inputId);
      const largo = ['json', 'user_multi'].includes(_adminFieldType(modulo, col));
      // Divisor uma única vez, antes do 1º campo largo — separa visualmente
      // os campos simples (grade) dos estruturados (JSON/lista de co-donos),
      // sem precisar de nenhum conhecimento do domínio de cada tabela.
      const divisor = (largo && !divisorPosto) ? (divisorPosto = true, '<div class="admin-field-divider">Dados estruturados</div>') : '';
      return `${divisor}<div class="form-group" style="margin-bottom:0${largo ? ';grid-column:1/-1' : ''}">
        <label class="form-label">${_adminEsc(col)}</label>
        ${inputHtml}
      </div>`;
    }).join('');
    if (readOnly) fieldsEl.querySelectorAll('input, textarea, .admin-bool-btn').forEach(el => { el.disabled = true; });
  }

  const errEl = document.getElementById('admin-edit-error');
  if (errEl) errEl.style.display = 'none';
  const notaEl = document.getElementById('admin-edit-readonly-note');
  if (notaEl) notaEl.style.display = readOnly ? '' : 'none';
  const btnSalvar = document.getElementById('admin-edit-btn-salvar');
  if (btnSalvar) btnSalvar.style.display = readOnly ? 'none' : '';
  const btnExcluir = document.getElementById('admin-edit-btn-excluir');
  if (btnExcluir) btnExcluir.style.display = readOnly ? 'none' : '';

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
    errEl.textContent = 'Falha ao salvar: ' + _adminErroDetalhe(error);
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
    if (error) { toast('Falha ao remover: ' + _adminErroDetalhe(error), 'error'); return; }
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

  if (error) { toast('Falha ao salvar: ' + _adminErroDetalhe(error), 'error'); return; }
  toast(`Categoria "${categoria}" atribuída a ${email}.`, 'success');
}

// ── Seção: Servidor (navegador de Storage) ──────────────────
// Complementa o resumo agregado de "Saúde do Storage" (na aba Usuários)
// com controle arquivo-a-arquivo: navega pasta por pasta em qualquer
// bucket e apaga arquivo individual, seleção múltipla ou pasta inteira.
// Existe pra cobrir o caso que o resumo não cobre — "esse arquivo
// específico está estranho, quero ver e apagar só ele" — sem precisar
// abrir o dashboard do Supabase numa aba separada.
let _srvBucket = 'backups-condensados';
let _srvPath = [];           // array de segmentos do caminho atual
let _srvSelected = new Set(); // paths completos dos arquivos marcados (só arquivos, pastas não entram aqui)

function adminServidorTrocarBucket() {
  const sel = document.getElementById('admin-srv-bucket-select');
  _srvBucket = sel?.value || 'backups-condensados';
  _srvPath = [];
  adminServidorListar();
}

function _srvPrefixAtual() { return _srvPath.join('/'); }

async function adminServidorListar() {
  const tbody = document.getElementById('admin-srv-tbody');
  const breadcrumb = document.getElementById('admin-srv-breadcrumb');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><i class="ti ti-loader"></i><p>Carregando...</p></div></td></tr>`;
  _srvSelected.clear();
  _adminSrvAtualizarBarra();

  const prefix = _srvPrefixAtual();
  const { data, error } = await window.supabaseClient.storage.from(_srvBucket).list(prefix, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });

  if (breadcrumb) {
    const partes = [`<a href="#" onclick="adminServidorIrPara(0);return false">${_adminEsc(_srvBucket)}</a>`]
      .concat(_srvPath.map((p, i) => `<a href="#" onclick="adminServidorIrPara(${i + 1});return false">${_adminEsc(p)}</a>`));
    breadcrumb.innerHTML = partes.join(' <span style="color:var(--text3)">/</span> ');
  }

  if (error) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><i class="ti ti-alert-triangle"></i><p>Falha ao listar: ${_adminErroDetalhe(error)}</p></div></td></tr>`;
    return;
  }

  const entradas = (data || []).filter(e => e.name !== '.emptyFolderPlaceholder');
  if (!entradas.length) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><i class="ti ti-folder-open"></i><p>Pasta vazia.</p></div></td></tr>`;
    return;
  }

  // Na raiz do bucket, cada pasta é o id do dono (padrão usado em todos os
  // buckets do sistema) — busca email/nome pra mostrar em vez do UUID cru.
  let donoPorId = {};
  if (!prefix) {
    const ids = entradas.filter(e => e.id === null).map(e => e.name);
    if (ids.length) {
      const { data: profiles } = await window.supabaseClient
        .from('profiles').select('id, email, nome_exibicao').in('id', ids);
      (profiles || []).forEach(p => { donoPorId[p.id] = p.nome_exibicao?.trim() || p.email || p.id; });
    }
  }

  tbody.innerHTML = entradas.map(e => {
    const isFolder = e.id === null; // pastas não têm id de objeto no Storage
    const fullPath = prefix ? `${prefix}/${e.name}` : e.name;
    if (isFolder) {
      const dono = donoPorId[e.name];
      const rotulo = dono
        ? `${_adminEsc(dono)} <span style="color:var(--text3);font-size:10px;font-family:var(--mono)">(${_adminEsc(e.name)})</span>`
        : _adminEsc(e.name);
      return `<tr>
        <td></td>
        <td><a href="#" onclick="adminServidorAbrirPasta('${_adminEsc(e.name)}');return false"><i class="ti ti-folder"></i> ${rotulo}</a></td>
        <td>—</td>
        <td><button class="btn-icon danger" title="Excluir pasta inteira" onclick="adminServidorExcluirPasta('${_adminEsc(fullPath)}')"><i class="ti ti-trash"></i></button></td>
      </tr>`;
    }
    const tamanho = e.metadata?.size ? formatBytes(e.metadata.size) : '—';
    return `<tr>
      <td><input type="checkbox" onchange="adminServidorToggleSelecao('${_adminEsc(fullPath)}', this.checked)"></td>
      <td><i class="ti ti-file"></i> ${_adminEsc(e.name)}</td>
      <td>${tamanho}</td>
      <td><button class="btn-icon danger" title="Excluir arquivo" onclick="adminServidorExcluirArquivo('${_adminEsc(fullPath)}')"><i class="ti ti-trash"></i></button></td>
    </tr>`;
  }).join('');
}

function adminServidorAbrirPasta(nome) {
  _srvPath.push(nome);
  adminServidorListar();
}

function adminServidorIrPara(nivel) {
  _srvPath = _srvPath.slice(0, nivel);
  adminServidorListar();
}

function adminServidorToggleSelecao(path, checked) {
  if (checked) _srvSelected.add(path);
  else _srvSelected.delete(path);
  _adminSrvAtualizarBarra();
}

function _adminSrvAtualizarBarra() {
  const bar = document.getElementById('admin-srv-lote-bar');
  const count = document.getElementById('admin-srv-lote-count');
  if (count) count.textContent = `${_srvSelected.size} arquivo(s) selecionado(s)`;
  if (bar) bar.style.display = _srvSelected.size > 0 ? 'flex' : 'none';
}

function adminServidorExcluirSelecionados() {
  const n = _srvSelected.size;
  if (!n) return;
  const paths = [..._srvSelected];
  confirmarDestrutivo({
    title: 'Confirmar exclusão de arquivos',
    sub: _srvBucket,
    body: `Você está prestes a excluir permanentemente ${n} arquivo(s) do Storage. Esta ação não pode ser desfeita.`,
    confirmLabel: 'Excluir arquivos',
    onConfirm: async () => {
      const { error } = await window.supabaseClient.storage.from(_srvBucket).remove(paths);
      if (error) { toast('Falha ao excluir: ' + _adminErroDetalhe(error), 'error'); return; }
      toast(`${n} arquivo(s) excluído(s).`, 'success');
      adminServidorListar();
    },
  });
}

function adminServidorExcluirArquivo(path) {
  confirmarDestrutivo({
    title: 'Confirmar exclusão',
    sub: path,
    body: `Excluir permanentemente o arquivo <strong>${_adminEsc(path)}</strong>? Esta ação não pode ser desfeita.`,
    confirmLabel: 'Excluir',
    onConfirm: async () => {
      const { error } = await window.supabaseClient.storage.from(_srvBucket).remove([path]);
      if (error) { toast('Falha ao excluir: ' + _adminErroDetalhe(error), 'error'); return; }
      toast('Arquivo excluído.', 'success');
      adminServidorListar();
    },
  });
}

function adminServidorExcluirPasta(path) {
  confirmarDestrutivo({
    title: 'Confirmar exclusão de pasta',
    sub: path,
    body: `Excluir permanentemente a pasta <strong>${_adminEsc(path)}</strong> e TODO o conteúdo dentro dela? Esta ação não pode ser desfeita.`,
    confirmLabel: 'Excluir pasta',
    requireConsent: true,
    consentLabel: 'Entendo que isso apaga todos os arquivos dentro desta pasta permanentemente.',
    onConfirm: async () => {
      const paths = await _adminListStorageRecursivo(_srvBucket, path);
      if (!paths.length) { toast('Pasta já está vazia.', 'success'); adminServidorListar(); return; }
      const { error } = await window.supabaseClient.storage.from(_srvBucket).remove(paths);
      if (error) { toast('Falha ao excluir: ' + _adminErroDetalhe(error), 'error'); return; }
      toast(`${paths.length} arquivo(s) excluído(s).`, 'success');
      adminServidorListar();
    },
  });
}

function adminServidorCopiar(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  const valor = el.value ?? el.textContent;
  navigator.clipboard?.writeText(valor)
    .then(() => toast('Copiado.', 'success'))
    .catch(() => toast('Não foi possível copiar automaticamente — selecione e copie manualmente.', 'error'));
}

Object.assign(window, {
  renderAdminPage,
  adminLoadFormPublico,
  adminSalvarAnalistaCategoria,
  adminCopiarLinkFormPublico,
  adminShowSection,
  adminLoadUsuarios,
  adminAlterarPapel,
  adminSuspenderUsuario,
  adminResetarUsuario,
  adminServidorTrocarBucket,
  adminServidorListar,
  adminServidorAbrirPasta,
  adminServidorIrPara,
  adminServidorToggleSelecao,
  adminServidorExcluirSelecionados,
  adminServidorExcluirArquivo,
  adminServidorExcluirPasta,
  adminServidorCopiar,
  adminLoadDbStats,
  adminLoadStorageStats,
  adminHealthShowTab,
  adminLoadUserSummary,
  adminLoadModulo,
  adminTrocarModulo,
  adminBuscarModulo,
  adminLimparBuscaModulo,
  adminFiltrarPorDono,
  adminLimparFiltroDono,
  adminExcluirTudoDono,
  adminSelecionarDono,
  adminModuloPrimeiraPagina,
  adminModuloPaginaAnterior,
  adminModuloProximaPagina,
  adminModuloUltimaPagina,
  adminExcluirRegistro,
  adminExcluirRegistroModal,
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
  _adminToggleBool,
  adminLoadPendentes,
  adminAceitarPendente,
  adminAceitarTodosPendentes,
});
