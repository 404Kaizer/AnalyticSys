// ── Indicador leve de carregamento (spinner de botão) ──────────────────
// Usado em ações rápidas (salvar/excluir cadastro individual), em vez do
// overlay cheio de tela (reservado para operações longas como importação
// de arquivo grande). Guarda o HTML original no dataset para restaurar
// depois, sem precisar duplicar o markup do botão em cada chamador.
function _setBtnLoading(btn, loading, loadingLabel) {
  if (!btn) return;
  if (loading) {
    if (btn.dataset.origHtml === undefined) btn.dataset.origHtml = btn.innerHTML;
    btn.innerHTML = `<span class="btn-spinner"></span> ${escapeHtml(loadingLabel || 'Processando...')}`;
    btn.disabled = true;
    btn.classList.add('is-loading');
  } else {
    if (btn.dataset.origHtml !== undefined) { btn.innerHTML = btn.dataset.origHtml; delete btn.dataset.origHtml; }
    btn.disabled = false;
    btn.classList.remove('is-loading');
  }
}

// ── Sincronização de configs com Supabase (Fase 2) ─────────────────────
// "key" é a identidade natural aqui (não o id gerado pelo banco) — por
// isso o upsert usa onConflict:'user_id,key' (restrição adicionada via
// migração). Reaproveita mergePersistentConfigs para não perder defaults
// locais que ainda não tenham sido sincronizados.
//
// CORREÇÃO: o objeto local usa os campos 'desc' e 'created' (nomes de
// exibição/UI), mas a tabela no Supabase tem as colunas 'descricao' e
// 'created_at' — enviar 'rec' direto pro upsert (como estava antes) batia
// num erro "column configs.desc does not exist" a cada tentativa, sempre
// silencioso (só console.warn + toast). 'created' também não é enviado:
// é uma string de exibição em pt-BR ("26/07/2026"), incompatível com o
// tipo timestamptz de created_at — deixamos o default now() do banco
// cuidar disso na criação, sem tocar nela nas atualizações seguintes.
async function _configsSyncUpsert(rec) {
  const row = { key: rec.key, value: rec.value, descricao: rec.desc || null };
  const { error } = await window.supabaseClient
    .from('configs')
    .upsert(row, { onConflict: 'user_id,key' });
  if (error) {
    console.warn('[Supabase] Falha ao sincronizar config:', error);
    toast('⚠ Salvo nesta sessão, mas não foi possível sincronizar com a nuvem.', 'error');
  }
}

async function _configsSyncDelete(key) {
  const { error } = await window.supabaseClient
    .from('configs')
    .delete()
    .eq('key', key)
    .eq('user_id', window.currentUser?.id);
  if (error) {
    console.warn('[Supabase] Falha ao excluir config na nuvem:', error);
    toast('⚠ Removida nesta sessão, mas não foi possível sincronizar com a nuvem.', 'error');
  }
}

async function syncConfigsFromSupabase() {
  try {
    const data = await fetchAllRows('configs', 'key, value, descricao, created_at, user_id');
    // BUG (achado em 14/08/2026): a policy configs_select libera o ADM a ler
    // as configs de TODO MUNDO (`... OR is_admin()`), e esta busca não
    // filtrava por dono — então o ADM baixava as linhas dos outros usuários e
    // o merge abaixo, que deduplica por chave, ficava com uma linha
    // arbitrária. Na prática o "responsável padrão" do ADM já vinha sendo
    // substituído pelo de outra pessoa (4 usuários têm essa chave).
    // A leitura ampla continua valendo pro que é global de fato — hoje as
    // chaves saude_*, que não têm dono útil.
    const meuId = window.currentUser?.id || null;
    const doDono = (data || []).filter(r =>
      String(r.key || '').startsWith('saude_') || !meuId || r.user_id === meuId);
    // O BANCO MANDA (30/07) — o self-heal daqui reenviava config apagada.
    // Traduz de volta pro formato local (desc/created) esperado pela UI.
    const remoto = doDono
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
      .map(r => ({
        key: r.key,
        value: r.value,
        desc: r.descricao,
        created: r.created_at ? new Date(r.created_at).toLocaleDateString('pt-BR') : new Date().toLocaleDateString('pt-BR'),
      }));
    // Passa [] como "existente": nada do local sobrevive, a nuvem é a
    // verdade. mergePersistentConfigs segue no caminho só pelo que ela faz
    // de útil aqui — normalizar a chave (normalizeConfigKey) e remover
    // duplicata de chave equivalente. Não há config padrão de fábrica a
    // preservar: state.configs nasce [] (state.js:24).
    state.configs = mergePersistentConfigs([], remoto);
  } catch (err) {
    console.warn('[Supabase] Falha ao buscar configs — mantendo dados locais.', err);
  }
}

// Grupos de materiais e Regionais são catálogos simples (só nome).
// O BANCO MANDA (30/07): antes o merge unia local ∪ nuvem e reenviava os
// nomes que só existiam localmente — então apagar um grupo pelo painel de
// Supervisão era desfeito pelo próprio navegador no boot seguinte. Agora a
// nuvem substitui; erro de busca cai no catch e preserva o local.
async function syncCatalogosFromSupabase() {
  try {
    // fetchAllRows pagina por cursor (sem teto de 10k do PostgREST) —
    // antes era um .select() cru, sem paginação nem ordenação.
    const [gruposData, regionaisData] = await Promise.all([
      fetchAllRows('grupos_materiais', 'nome'),
      fetchAllRows('regionais_centrais', 'nome'),
    ]);

    // Dedup por nome normalizado continua necessário: a mesma central pode
    // estar cadastrada por mais de um usuário com grafia diferente.
    const dedup = (rows) => {
      const vistos = new Map();
      (rows || []).forEach(r => { const k = normalizeText(r.nome); if (k && !vistos.has(k)) vistos.set(k, r.nome); });
      return [...vistos.values()];
    };

    state.gruposMateriais = dedup(gruposData);
    state.regionaisCentrais = dedup(regionaisData);
  } catch (err) {
    console.warn('[Supabase] Falha ao buscar grupos/regionais — mantendo dados locais.', err);
  }
}

// Chaves saude_* viraram globais e só o ADM pode criar/editar/excluir
// (decisão 28/07, mesma trava de ui.js/salvarHealthConfig) — mesmo que o
// usuário chegue nelas por aqui (tela genérica de Configurações) em vez
// da tela dedicada de Saúde. A RLS de configs já bloqueia a escrita no
// banco; isto só evita mexer no estado local e dar uma mensagem confusa.
function _configEhChaveSaude(key) {
  return typeof key === 'string' && key.toLowerCase().startsWith('saude_');
}

function salvarConfig() {
  const key = val('cfg-key');
  const value = val('cfg-val-input');
  const desc = val('cfg-desc');
  if (!key) { toast('Informe a chave', 'error'); return; }
  if (_configEhChaveSaude(key) && window.currentUser?.role !== 'admin') {
    toast('Somente o administrador pode alterar limites de saúde (chaves saude_*).', 'error');
    return;
  }

  const existing = state.configs.findIndex(c => normalizeText(c.key) === normalizeText(key));
  const rec = { key, value, desc, created: new Date().toLocaleDateString('pt-BR') };
  if (existing >= 0) state.configs[existing] = rec; else state.configs.unshift(rec);

  persist();
  renderConfigs();
  toast('Configuração salva');
  closeModal('modal-config');
  _configsSyncUpsert(rec);
}

function removerConfig(pagedIndex) {
  const { data } = getListPageData('configs');
  const rec = data[pagedIndex];
  if (!rec) return;
  if (_configEhChaveSaude(rec.key) && window.currentUser?.role !== 'admin') {
    toast('Somente o administrador pode remover limites de saúde (chaves saude_*).', 'error');
    return;
  }
  const idx = state.configs.indexOf(rec);
  if (idx < 0) return;
  state.configs.splice(idx, 1);
  persist();
  renderConfigs();
  toast('Configuração removida', 'error');
  _configsSyncDelete(rec.key);
}

function editConfig(key) {
  const item = state.configs.find(c => normalizeText(c.key) === normalizeText(key));
  if (!item) { toast('Configuração não encontrada', 'error'); return; }
  setVal('cfg-key', item.key);
  setVal('cfg-val-input', item.value);
  setVal('cfg-desc', item.desc || '');
  openModal('modal-config');
}

function deleteConfig(key) {
  const idx = state.configs.findIndex(c => normalizeText(c.key) === normalizeText(key));
  if (idx < 0) { toast('Configuração não encontrada', 'error'); return; }
  if (_configEhChaveSaude(key) && window.currentUser?.role !== 'admin') {
    toast('Somente o administrador pode excluir limites de saúde (chaves saude_*).', 'error');
    return;
  }
  if (!confirm(`Excluir configuração "${key}"?`)) return;
  state.configs.splice(idx, 1);
  persist();
  renderConfigs();
  toast('Configuração excluída', 'error');
  _configsSyncDelete(key);
}


// ═══════════════════════════════════════════════════════════
// ATUALIZAR CADASTROS — botão em Padronização de Centrais/Materiais
// ═══════════════════════════════════════════════════════════
// Reaplica o cadastro ATUAL de Centrais e Materiais sobre os registros já
// importados/lançados (Entradas, Saídas, Lançamentos, SAP), sem precisar
// reimportar nada. Útil quando o cadastro é editado/completado DEPOIS que
// os dados já entraram no sistema — ex.: categoria adicionada a um material
// que antes estava sem, ou um alias corrigido que agora bate com nomes que
// antes ficavam sem padronização.
//
// Isso é exatamente o que já acontece automaticamente ao salvar/importar um
// novo cadastro (ver salvarMateriais/handleMateriaisImport/salvarFiliais/
// handleFiliaisImport, que chamam reaplicarPadronizacaoMateriais/Centrais
// + renderAll). Este botão expõe a mesma reaplicação sob demanda, para os
// casos em que o cadastro foi editado de outra forma e as telas antigas
// ficaram desatualizadas.
//
// Depois de reaplicar, atualiza TODAS as telas que dependem desses
// cadastros: as tabelas de Entradas/Saídas/Lançamentos/SAP/Custos SAP e o
// Dashboard Gerencial (via renderAll), o Dashboard Analítico — Visão Micro/
// Regional (via rodarAnalitico, que já se auto-protege se não houver
// período selecionado) e o Inventário, se já tiver sido gerado na sessão.
async function atualizarCadastros() {
  const btns = document.querySelectorAll('.js-atualizar-cadastros');
  btns.forEach(b => {
    b.disabled = true;
    b.dataset.origHtml = b.dataset.origHtml || b.innerHTML;
    b.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .7s linear infinite"></i> Atualizando...';
  });

  try {
    // 1) Reaplica a padronização usando o cadastro atual de Centrais/Materiais
    //    sobre entradas/saidas/lancamentos/sap (materialOriginal/centralOriginal
    //    já salvos em cada registro são a fonte — nada é perdido nem reimportado).
    if (typeof reaplicarPadronizacaoCentrais === 'function')  reaplicarPadronizacaoCentrais();
    if (typeof reaplicarPadronizacaoMateriais === 'function') reaplicarPadronizacaoMateriais();

    // 2) Invalida todos os índices derivados — sem isso, telas com cache
    //    (Lançamentos/SAP/Saídas/busca global) continuam mostrando os
    //    valores antigos mesmo com o state já atualizado.
    if (typeof invalidateMaterialLookup === 'function')   invalidateMaterialLookup();
    if (typeof invalidateFilialLookup === 'function')     invalidateFilialLookup();
    if (typeof invalidateLancIndex === 'function')        invalidateLancIndex();
    if (typeof invalidateSapIndex === 'function')         invalidateSapIndex();
    if (typeof invalidateSaidasIndex === 'function')      invalidateSaidasIndex();
    if (typeof invalidateAllSearchIndexes === 'function') invalidateAllSearchIndexes();
    if (typeof capInvalidarCache === 'function')          capInvalidarCache();

    // 3) Salva o resultado.
    if (typeof persistStateNow === 'function') await persistStateNow();
    else persist();

    // 4) Tabelas/telas "de base": Entradas/Saídas/Lançamentos/SAP/Custos SAP/
    //    Imports/Configs/Ações/Filiais/Materiais + Dashboard Gerencial —
    //    o mesmo conjunto já usado após importar um cadastro novo.
    renderAll();

    // 5) Dashboard Analítico (Visão Micro/Regional): rodarAnalitico() sem
    //    argumentos usa o período já selecionado na tela; se nenhum período
    //    foi selecionado ainda, ela mesma não faz nada (mesmo comportamento
    //    usado em ui.js após excluir/editar lançamentos).
    if (typeof rodarAnalitico === 'function') rodarAnalitico();

    // 6) Inventário: só regenera se a tela já tiver conteúdo gerado nesta
    //    sessão — evita disparar "Nenhum dado encontrado" para quem nunca
    //    abriu o Inventário. O critério espelha o usado internamente por
    //    invGerar/renderInventario (inv-content visível = já gerado).
    const invJaGerado = document.getElementById('inv-content')?.style.display === '';
    if (invJaGerado && typeof window.invGerar === 'function') window.invGerar();

    toast('Cadastros reaplicados — Entradas, Saídas, Lançamentos, SAP e demais telas foram atualizados.');
  } catch (err) {
    console.error('[AtualizarCadastros] Falha ao reaplicar cadastros:', err);
    toast('Falha ao atualizar cadastros. Veja o console para detalhes.', 'error');
  } finally {
    btns.forEach(b => {
      b.disabled = false;
      if (b.dataset.origHtml) { b.innerHTML = b.dataset.origHtml; delete b.dataset.origHtml; }
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// CADASTRO INDIVIDUAL DE MATERIAIS — campos digitados, múltiplas linhas
// ═══════════════════════════════════════════════════════════════════════
let _matIndivRowSeq = 0;

// Abre o modal de Cadastro Individual de Materiais. Aceita um objeto de
// pré-preenchimento opcional — { origem, alias, categoria, focus } — usado
// pelos atalhos de "material sem cadastro/categoria" espalhados pelo
// sistema (Dashboard, Analítico, Inventário, duplicidade de cadastro).
// Alterna título/botão do modal de cadastro entre "criar" e "editar" — o
// mesmo modal (Materiais ou Filiais) é reaproveitado nos dois fluxos, então
// só o texto muda, nunca a estrutura.
function _setModalCadastroModo({ modalId, btnId, icone, singular, plural, editando, qtd }) {
  const titleEl = document.querySelector(`#${modalId} .modal-title`);
  if (titleEl) {
    const label = editando ? (qtd > 1 ? `Editar ${qtd} ${plural}` : `Editar ${singular}`) : `Cadastro Individual de ${plural}`;
    titleEl.innerHTML = `<i class="ti ${icone}"></i> ${label}`;
  }
  const btnEl = document.getElementById(btnId);
  if (btnEl) btnEl.innerHTML = editando ? '<i class="ti ti-check"></i> Salvar Alterações' : '<i class="ti ti-check"></i> Cadastrar';
}

// ═══════════════════════════════════════════════════════════════════════
// "IMPORTAR DE" — só ADM (04/08). Configurações agora mostra só o cadastro
// do próprio dono (ver syncMateriaisFromSupabase/syncFiliaisFromSupabase);
// pra ver o de outro usuário, o ADM importa explicitamente — cria uma
// CÓPIA independente (dono = o próprio ADM), nunca visibilidade
// automática, e nunca escreve na conta do usuário original (só SELECT lá).
// Compartilhado entre Materiais, Filiais e Capacidades via _IMPORTAR_DE_CFG.
//
// Capacidades entrou aqui em 25/08/2026, quando a tabela deixou de ser
// global e passou a ter dono (ver o bloco ARMAZENAMENTO em capacidades.js):
// o ADM precisava continuar enxergando o cadastro dos outros, mas SEM que
// cada edição alheia reescrevesse a tela dele por Realtime.
//
// `upsert` e `chave` vão embrulhados em arrow: config.js carrega ANTES de
// capacidades.js (ver a ordem dos <script> em index.html), então referenciar
// upsertCapacidades/capRowKey direto aqui quebraria no load.
// ═══════════════════════════════════════════════════════════════════════
const _IMPORTAR_DE_CFG = {
  materiais: {
    table: 'materiais',
    lista: () => state.materiais,
    chave: materialMatchKey,
    upsert: upsertMateriais,
    campos: 'origem, alias, cod_sap, categoria, import_id',
    normalizar: r => ({ origem: r.origem, alias: r.alias, codSap: r.cod_sap || '', categoria: r.categoria || '' }),
    singular: 'material', plural: 'materiais',
    novosLabel: n => n === 1 ? 'material novo' : 'materiais novos',
    rotulo: it => `${escapeHtml(it.origem)} <span style="color:var(--text3)">— ${escapeHtml(it.alias)}</span>`,
    ordenar: (a, b) => String(a.origem).localeCompare(String(b.origem)),
    render: () => { if (typeof renderMateriais === 'function') renderMateriais(); },
    // Cadastro importado só passa a valer depois que os registros já
    // existentes são reprocessados com ele. Capacidades não tem equivalente
    // (a tabela é derivada dos lançamentos na hora do render), então lá a
    // chave é ausente e o passo some do overlay.
    reaplicar: () => { if (typeof reaplicarPadronizacaoMateriais === 'function') reaplicarPadronizacaoMateriais(); },
    reaplicarLabel: 'Repadronizando materiais já lançados',
    concluidoLabel: 'Materiais importados',
    boxId: 'novos-materiais-box',
  },
  filiais: {
    table: 'filiais',
    lista: () => state.filiais,
    chave: filialMatchKey,
    upsert: upsertFiliais,
    campos: 'origem, alias, cnpj, regional, import_id',
    normalizar: r => ({ origem: r.origem, alias: r.alias, cnpj: r.cnpj || '', regional: r.regional || '' }),
    singular: 'central', plural: 'centrais',
    novosLabel: n => n === 1 ? 'central nova' : 'centrais novas',
    rotulo: it => `${escapeHtml(it.origem)} <span style="color:var(--text3)">— ${escapeHtml(it.alias)}</span>`,
    ordenar: (a, b) => String(a.origem).localeCompare(String(b.origem)),
    render: () => { if (typeof renderFiliais === 'function') renderFiliais(); },
    reaplicar: () => { if (typeof reaplicarPadronizacaoCentrais === 'function') reaplicarPadronizacaoCentrais(); },
    reaplicarLabel: 'Repadronizando centrais já lançadas',
    concluidoLabel: 'Centrais importadas',
    boxId: 'novos-filiais-box',
  },
  capacidades: {
    table: 'capacidades',
    lista: () => state.capacidades || [],
    chave: r => `${String(r.central || '').trim()}|||${String(r.grupo || '').trim()}`,
    upsert: novos => upsertCapacidades(novos),
    campos: 'central, grupo, capacidade, seguranca, unidades',
    normalizar: r => ({
      central: r.central, grupo: r.grupo,
      capacidade: r.capacidade, seguranca: r.seguranca,
      unidades: Array.isArray(r.unidades) ? r.unidades : null
    }),
    singular: 'capacidade', plural: 'capacidades',
    novosLabel: n => n === 1 ? 'capacidade nova' : 'capacidades novas',
    rotulo: it => `${escapeHtml(it.central)} <span style="color:var(--text3)">— ${escapeHtml(it.grupo)}</span>`,
    ordenar: (a, b) => String(a.central).localeCompare(String(b.central)) || String(a.grupo).localeCompare(String(b.grupo)),
    render: () => { if (typeof renderCapacidades === 'function') renderCapacidades(); },
    concluidoLabel: 'Capacidades importadas',
    boxId: 'novos-capacidades-box',
  },
  // Fatores de Conversão entrou aqui em 03/09/2026, mesmo dia em que o
  // cadastro em si foi criado — mesma razão de Capacidades ter entrado em
  // 25/08: a tabela tem dono (RLS por user_id), então o ADM precisa deste
  // fluxo pra enxergar densidade cadastrada por outro analista.
  //
  // `chave`/`upsert` referenciam funções DESTE MESMO arquivo (config.js),
  // então dispensam o embrulho em arrow que upsertCapacidades precisa (essa
  // vive em capacidades.js, carregado DEPOIS — ver o comentário no topo
  // deste objeto).
  fatoresConversao: {
    table: 'fatores_conversao',
    lista: () => state.fatoresConversao || [],
    chave: _fatorConversaoMatchKey,
    upsert: upsertFatoresConversao,
    // SEM `id` de propósito — mesmo motivo de materiais/filiais omitirem:
    // upsertFatoresConversao precisa gerar um id NOVO pra cada cópia (ver o
    // comentário lá), e um `id` vazando aqui criaria a tentação de reusá-lo.
    campos: 'grupo, fornecedor, um_origem, um_destino, fator',
    normalizar: r => ({
      grupo: r.grupo, fornecedor: r.fornecedor || '',
      umOrigem: r.um_origem, umDestino: r.um_destino || 'KG',
      fator: Number(r.fator)
    }),
    singular: 'fator', plural: 'fatores de conversão',
    novosLabel: n => n === 1 ? 'fator de conversão novo' : 'fatores de conversão novos',
    rotulo: it => `${escapeHtml(it.grupo)}${it.fornecedor ? ` <span style="color:var(--text3)">— ${escapeHtml(it.fornecedor)}</span>` : ' <span style="color:var(--text3)">(padrão do grupo)</span>'} <span style="color:var(--text3)">— 1 ${escapeHtml(it.umOrigem)} = ${escapeHtml(String(it.fator))} ${escapeHtml(it.umDestino || 'KG')}</span>`,
    ordenar: (a, b) => String(a.grupo).localeCompare(String(b.grupo)) || String(a.fornecedor || '').localeCompare(String(b.fornecedor || '')),
    render: () => { if (typeof renderFatoresConversao === 'function') renderFatoresConversao(); },
    // Sem `reaplicar`: ao contrário de Materiais/Filiais, não existe um
    // "reprocessar lançamentos antigos" aqui — um fator importado passa a
    // valer no próximo cálculo naturalmente (_lookupFatorConversao consulta
    // state.fatoresConversao a cada chamada, não guarda resultado velho pra
    // reprocessar). Mesmo motivo de Capacidades não ter.
    concluidoLabel: 'Fatores de conversão importados',
    boxId: 'novos-fatores-conversao-box',
  },
};

// Lista achatada de pendentes por tipo — preenchida por
// _checarNovosParaImportar, lida pelo modal e pelo box de alerta
// (_renderNovosPendentesBox, dashboard.js).
const _NOVOS_PENDENTES = { materiais: [], filiais: [], capacidades: [], fatoresConversao: [] };
function _itensNovosDe(tipo) { return _NOVOS_PENDENTES[tipo] || []; }

// Cache leve de perfis (id -> email) pro seletor de usuários e pra resolver
// a coluna "Dono" — buscado uma vez por sessão, RLS já libera admin ler
// todos os profiles.
let _perfisCache = null;
async function _carregarPerfis() {
  if (_perfisCache) return _perfisCache;
  if (!window.supabaseClient) return {};
  const { data, error } = await window.supabaseClient.from('profiles').select('id, email');
  if (error) { console.warn('[ImportarDe] Falha ao buscar usuários:', error); return {}; }
  _perfisCache = Object.fromEntries((data || []).map(p => [p.id, p.email]));
  return _perfisCache;
}

let _importarDeTipoAtual = null;
// 'registros' (sino — checkbox por registro individual, abrirNovosPendentesDetalhe)
// ou 'usuarios' (toolbar "Importar de" — checkbox por usuário, abrirImportarDe).
// confirmarImportarDe usa isto pra saber como interpretar os checkboxes marcados.
let _importarDeModoAtual = null;
// Os itens pendentes (não os usuários) vivem em _NOVOS_PENDENTES, acima —
// cada item já tem os dados completos do registro + de quem é, pra render
// revisável no modal (04/08: antes importava tudo do usuário de uma vez sem
// o ADM ver o que estava vindo; agora ele marca registro por registro).

// Botão do toolbar "Importar de" — escolhe USUÁRIOS pra importar tudo que
// eles têm pendente de uma vez (ver confirmarImportarDe). Diferente do
// alerta do sino (abrirNovosPendentesDetalhe), que seleciona por REGISTRO
// individual em vez de por usuário.
async function abrirImportarDe(tipo) {
  const cfg = _IMPORTAR_DE_CFG[tipo];
  if (!cfg || window.currentUser?.role !== 'admin') return;
  _importarDeTipoAtual = tipo;
  _importarDeModoAtual = 'usuarios';
  const wrap = document.getElementById('importar-de-usuarios');
  const titleEl = document.getElementById('importar-de-title');
  const subEl = document.getElementById('importar-de-sub');
  const footerBtn = document.getElementById('btn-confirmar-importar-de');
  if (titleEl) titleEl.textContent = `Importar ${cfg.plural} de outros usuários`;
  if (subEl) subEl.textContent = 'Cria uma cópia própria do cadastro selecionado — não altera nada do lado do usuário original.';
  if (footerBtn) footerBtn.style.display = '';
  if (wrap) wrap.innerHTML = '<span style="font-size:12px;color:var(--text3)">Verificando registros disponíveis...</span>';
  openModal('modal-importar-de');

  // Reconsulta na hora de abrir — cobre tanto o clique no alerta (lista já
  // pronta) quanto o botão do toolbar (pode ser a primeira vez, sem
  // nenhuma checagem prévia nesta sessão).
  await _checarNovosParaImportar(tipo);
  const itens = _itensNovosDe(tipo);
  if (!wrap) return;
  if (!itens.length) {
    wrap.innerHTML = `<span style="font-size:12px;color:var(--text3);padding:4px 6px">Nenhum registro novo — todo o cadastro dos outros usuários já foi importado (ou não há outro usuário com cadastro).</span>`;
    return;
  }
  const porUsuario = new Map(); // userId -> { email, count }
  itens.forEach(it => {
    const cur = porUsuario.get(it.userId) || { email: it.email, count: 0 };
    cur.count++;
    porUsuario.set(it.userId, cur);
  });
  const usuarios = [...porUsuario.entries()].sort((a, b) => a[1].email.localeCompare(b[1].email));
  wrap.innerHTML = `
    <label class="micro-filter-option" style="border-bottom:1px solid var(--border2);padding-bottom:6px;margin-bottom:4px">
      <input type="checkbox" onchange="document.querySelectorAll('.chk-importar-de-item').forEach(c => c.checked = this.checked)">
      <span class="micro-filter-option-label"><b>Selecionar todos (${usuarios.length})</b></span>
    </label>` +
    usuarios.map(([userId, u]) => `<label class="micro-filter-option">
        <input type="checkbox" class="chk-importar-de-item" value="${escapeHtml(userId)}">
        <span class="micro-filter-option-label">${escapeHtml(u.email)} <span style="font-size:10px;color:var(--text3)">— ${u.count} ${u.count === 1 ? cfg.singular : cfg.plural}</span></span>
      </label>`).join('');
}

// Clique no alerta do sino (dashboard.js/_renderNovosPendentesBox) — lista
// cada registro novo individualmente (qual central/material, de quem), com
// checkbox por registro + "selecionar todos", pra importar um, vários ou
// todos de uma vez. Diferente do modal do botão "Importar de" da toolbar
// (abrirImportarDe), que seleciona por USUÁRIO em vez de por registro.
async function abrirNovosPendentesDetalhe(tipo) {
  const cfg = _IMPORTAR_DE_CFG[tipo];
  if (!cfg || window.currentUser?.role !== 'admin') return;
  _importarDeTipoAtual = tipo;
  _importarDeModoAtual = 'registros';
  const wrap = document.getElementById('importar-de-usuarios');
  const titleEl = document.getElementById('importar-de-title');
  const subEl = document.getElementById('importar-de-sub');
  const footerBtn = document.getElementById('btn-confirmar-importar-de');
  if (titleEl) titleEl.textContent = `${cfg.plural[0].toUpperCase()}${cfg.plural.slice(1)} novos para importar`;
  if (subEl) subEl.textContent = 'Selecione os registros que quer importar — cria uma cópia própria, não altera nada do lado do usuário original.';
  if (footerBtn) footerBtn.style.display = '';
  if (wrap) wrap.innerHTML = '<span style="font-size:12px;color:var(--text3)">Verificando registros disponíveis...</span>';
  openModal('modal-importar-de');

  await _checarNovosParaImportar(tipo);
  const itens = _itensNovosDe(tipo);
  if (!wrap) return;
  if (!itens.length) {
    wrap.innerHTML = `<span style="font-size:12px;color:var(--text3);padding:4px 6px">Nenhum registro novo — todo o cadastro dos outros usuários já foi importado (ou não há outro usuário com cadastro).</span>`;
    return;
  }
  wrap.innerHTML = `
    <label class="micro-filter-option" style="border-bottom:1px solid var(--border2);padding-bottom:6px;margin-bottom:4px">
      <input type="checkbox" onchange="document.querySelectorAll('.chk-importar-de-item').forEach(c => c.checked = this.checked)">
      <span class="micro-filter-option-label"><b>Selecionar todos (${itens.length})</b></span>
    </label>` +
    itens.map((it, i) => `<label class="micro-filter-option">
        <input type="checkbox" class="chk-importar-de-item" value="${i}">
        <span class="micro-filter-option-label">${cfg.rotulo(it)} <span style="font-size:10px;color:var(--accent)">de ${escapeHtml(it.email)}</span></span>
      </label>`).join('');
}

async function confirmarImportarDe(btn) {
  const tipo = _importarDeTipoAtual;
  const cfg = tipo && _IMPORTAR_DE_CFG[tipo];
  if (!cfg) return;
  const itens = _itensNovosDe(tipo);
  const checked = [...document.querySelectorAll('.chk-importar-de-item:checked')].map(el => el.value);
  if (!checked.length) {
    toast(_importarDeModoAtual === 'usuarios' ? 'Selecione ao menos um usuário' : 'Selecione ao menos um registro', 'error');
    return;
  }

  _setBtnLoading(btn, true, 'Importando...');
  const selecionados = _importarDeModoAtual === 'usuarios'
    ? itens.filter(it => checked.includes(it.userId))
    : checked.map(i => itens[Number(i)]).filter(Boolean);
  const usuariosCount = new Set(selecionados.map(it => it.userId)).size;
  const novos = selecionados.map(it => {
    const { userId, email, ...campos } = it;
    return { ...campos, importadoDeId: userId, created: new Date().toLocaleDateString('pt-BR') };
  });

  // Overlay antes de qualquer trabalho pesado: importar o cadastro inteiro de
  // um usuário reprocessa a base toda (repadronização + persistStateNow +
  // renderAll) e trava a interface por segundos. Sem ele o clique parecia não
  // ter feito nada. Fecha o modal primeiro pra não empilhar duas camadas.
  closeModal('modal-importar-de');
  _setBtnLoading(btn, false);

  showLoadingOverlay(`Importando ${cfg.plural}`, `Trazendo ${novos.length} cadastro(s) de ${usuariosCount} usuário(s)...`);
  if (typeof loadingShowSteps === 'function') loadingShowSteps([
    { id: 'impde-copiar', icon: 'ti-copy',          label: `Copiando ${novos.length} ${novos.length === 1 ? cfg.singular : cfg.plural}` },
    ...(cfg.reaplicar ? [{ id: 'impde-reaplicar', icon: 'ti-adjustments', label: cfg.reaplicarLabel }] : []),
    { id: 'impde-salvar', icon: 'ti-device-floppy', label: 'Salvando no banco local' },
    { id: 'impde-telas',  icon: 'ti-refresh',       label: 'Atualizando as telas' },
  ]);

  try {
    // nextFrame entre os passos: sem ceder o thread, tudo rodaria num bloco
    // síncrono e o overlay só apareceria pintado no fim, já pronto pra sumir.
    _lstepSet('impde-copiar', 'running'); _lbarSet(10);
    await nextFrame();
    cfg.upsert(novos);
    _lstepSet('impde-copiar', 'done'); _lbarSet(35);

    if (cfg.reaplicar) {
      _lstepSet('impde-reaplicar', 'running');
      updateLoadingOverlay(cfg.reaplicarLabel + '...');
      await nextFrame();
      cfg.reaplicar();
      _lstepSet('impde-reaplicar', 'done');
    }
    _lbarSet(60);

    _lstepSet('impde-salvar', 'running');
    updateLoadingOverlay('Salvando no banco local...');
    await nextFrame();
    await persistStateNow();
    _lstepSet('impde-salvar', 'done'); _lbarSet(85);

    _lstepSet('impde-telas', 'running');
    updateLoadingOverlay('Atualizando as telas...');
    await nextFrame();
    // Poda local dos pendentes ANTES do render: o que acabou de ser copiado
    // já está em cfg.lista(). Sem isto o alerta continuaria anunciando os
    // mesmos registros até a recontagem no servidor responder — o usuário
    // importa 75 capacidades e o sino segue dizendo "75 capacidades novas".
    const chavesAgora = new Set(cfg.lista().map(cfg.chave));
    _NOVOS_PENDENTES[tipo] = _itensNovosDe(tipo).filter(it => !chavesAgora.has(cfg.chave(it)));
    renderAll();
    updateImportPrereqUI();
    _lstepSet('impde-telas', 'done'); _lbarSet(100);

    hideLoadingOverlay(cfg.concluidoLabel);
    toast(`${novos.length} ${cfg.plural} importado(s) de ${usuariosCount} usuário(s)`);
  } catch (err) {
    console.error(`[ImportarDe] Falha ao importar ${cfg.plural}:`, err);
    ['impde-copiar', 'impde-reaplicar', 'impde-salvar', 'impde-telas'].forEach(id => {
      const el = document.getElementById('lstep-' + id);
      if (el?.querySelector('.lstep-running')) _lstepSet(id, 'error');
    });
    hideLoadingOverlay('Falha na importação');
    toast('Falha ao importar: ' + (err?.message || 'erro desconhecido'), 'error');
  } finally {
    // Limpeza dos steps DEPOIS do fade do overlay (hideLoadingOverlay só
    // fecha 220ms depois): limpar na hora apagaria os ✓ com o card ainda
    // na tela.
    setTimeout(() => { if (typeof loadingHideSteps === 'function') loadingHideSteps(); }, 300);
    // Recontagem dos pendentes fora do overlay: é uma ida ao servidor e não
    // deve segurar a tela — o alerta se atualiza sozinho quando responder.
    _checarNovosParaImportar(tipo);
  }
}

// Roda no boot (admin-only, chamado a partir de syncMateriaisFromSupabase/
// syncFiliaisFromSupabase/syncCapacidadesFromSupabase), depois de importar,
// e toda vez que o modal "Importar de" abre — compara o que existe pra TODOS
// os usuários contra o que o ADM já tem e guarda a lista achatada dos que
// ainda não foram trazidos (não só a contagem). Alimenta o box de alerta E o
// modal de revisão (renderMateriais/renderFiliais/renderCapacidades).
async function _checarNovosParaImportar(tipo) {
  const cfg = _IMPORTAR_DE_CFG[tipo];
  if (!cfg || !window.supabaseClient || window.currentUser?.role !== 'admin') return;
  const meuId = window.currentUser?.id;
  const { data, error } = await window.supabaseClient.from(cfg.table).select(`user_id, ${cfg.campos}`).neq('user_id', meuId);
  if (error) { console.warn(`[ImportarDe] Falha ao checar novos ${cfg.table}:`, error); return; }

  const chavesExistentes = new Set(cfg.lista().map(cfg.chave));
  const pendentes = (data || []).filter(r => !chavesExistentes.has(cfg.chave(r)));

  // _carregarPerfis SEMPRE (não só quando há pendente) — a coluna "Dono"
  // (_donoDisplay, dashboard.js) depende de _perfisCache pra mostrar o
  // e-mail de quem um registro já importado veio; se só rodasse aqui dentro
  // do "if (pendentes.length)", um ADM que já importou tudo (0 pendentes)
  // nunca populava o cache e a coluna ficava mostrando o UUID cru.
  const perfis = await _carregarPerfis();
  let itens = [];
  if (pendentes.length) {
    itens = pendentes
      .map(r => ({ userId: r.user_id, email: perfis[r.user_id] || r.user_id, ...cfg.normalizar(r) }))
      .sort((a, b) => a.email.localeCompare(b.email) || cfg.ordenar(a, b));
  }
  _NOVOS_PENDENTES[tipo] = itens;
  cfg.render();
}

function abrirCadastroMaterialIndividual(prefill) {
  const container = document.getElementById('mat-indiv-rows');
  if (!container) return;
  container.innerHTML = '';
  _matIndivRowSeq = 0;
  _addMaterialIndivRow();
  _setModalCadastroModo({ modalId: 'modal-materiais-individual', btnId: 'btn-salvar-material-indiv', icone: 'ti-stack-2', singular: 'Material', plural: 'Materiais', editando: false });
  openModal('modal-materiais-individual');

  const row = container.querySelector('.reg-individual-row');
  if (prefill && row) {
    const origemInput = row.querySelector('[data-field="origem"]');
    const aliasInput = row.querySelector('[data-field="alias"]');
    const codSapInput = row.querySelector('[data-field="codSap"]');
    const categoriaSelect = row.querySelector('[data-field="categoria"]');
    if (origemInput) origemInput.value = prefill.origem || '';
    if (aliasInput) aliasInput.value = prefill.alias || '';
    if (codSapInput) codSapInput.value = prefill.codSap || '';
    if (categoriaSelect && prefill.categoria) categoriaSelect.value = prefill.categoria;
  }

  setTimeout(() => {
    const focusField = prefill?.focus || 'origem';
    (row?.querySelector(`[data-field="${focusField}"]`) || container.querySelector('input'))?.focus();
  }, 50);
}

// Mesmo modal, mas com uma linha por pendência (botão "Cadastrar Todos" do
// alerta de padronização, dashboard.js) — poupa o analista de abrir/fechar
// o modal um material de cada vez. "sem_categoria" entra com Original/Grupo
// SAP já preenchidos (mesmo cadastro existente), faltando só a Categoria;
// "não cadastrado" entra só com o Original, faltando Grupo SAP.
function abrirCadastroMateriaisEmLote(itens) {
  const container = document.getElementById('mat-indiv-rows');
  if (!container || !itens?.length) return;
  container.innerHTML = '';
  _matIndivRowSeq = 0;
  itens.forEach(item => {
    _addMaterialIndivRow();
    const row = container.lastElementChild;
    const semCategoria = item.motivo === 'sem_categoria';
    row.querySelector('[data-field="origem"]').value = semCategoria ? (item.origemCadastro || item.nome) : item.nome;
    if (semCategoria) row.querySelector('[data-field="alias"]').value = item.aliasPadronizado || '';
  });
  _setModalCadastroModo({ modalId: 'modal-materiais-individual', btnId: 'btn-salvar-material-indiv', icone: 'ti-stack-2', singular: 'Material', plural: 'Materiais', editando: false });
  openModal('modal-materiais-individual');
  const focusField = itens[0]?.motivo === 'sem_categoria' ? 'categoria' : 'alias';
  setTimeout(() => container.querySelector(`.reg-individual-row [data-field="${focusField}"]`)?.focus(), 50);
}

// ── Edição (individual e em massa) — reaproveita o mesmo modal de cadastro,
// marcando cada linha com a chave original (origem+alias) do registro que
// ela representa. salvarMateriaisIndividual() usa essa marca pra decidir
// entre criar (sem marca) ou atualizar em vez de duplicar.
function abrirEdicaoMaterial(id) {
  const rec = state.materiais.find(m => m.id === id);
  if (!rec) { toast('Material não encontrado', 'error'); return; }
  abrirEdicaoMateriaisEmLote([rec]);
}

function abrirEdicaoMateriaisSelecionados() {
  const ids = [...document.querySelectorAll('#tb-materiais .chk-materiais-row:checked')].map(el => el.value);
  if (!ids.length) { toast('Selecione ao menos um material para editar', 'error'); return; }
  const recs = state.materiais.filter(m => ids.includes(m.id));
  abrirEdicaoMateriaisEmLote(recs);
}

function abrirEdicaoMateriaisEmLote(recs) {
  const container = document.getElementById('mat-indiv-rows');
  if (!container || !recs?.length) return;
  container.innerHTML = '';
  _matIndivRowSeq = 0;
  recs.forEach(rec => {
    _addMaterialIndivRow();
    const row = container.lastElementChild;
    row.dataset.editOrigemOrig = rec.origem || '';
    row.dataset.editAliasOrig = rec.alias || '';
    row.querySelector('[data-field="origem"]').value = rec.origem || '';
    row.querySelector('[data-field="alias"]').value = rec.alias || '';
    row.querySelector('[data-field="codSap"]').value = rec.codSap || '';
    if (rec.categoria) row.querySelector('[data-field="categoria"]').value = rec.categoria;
  });
  _setModalCadastroModo({ modalId: 'modal-materiais-individual', btnId: 'btn-salvar-material-indiv', icone: 'ti-stack-2', singular: 'Material', plural: 'Materiais', editando: true, qtd: recs.length });
  openModal('modal-materiais-individual');
  setTimeout(() => container.querySelector('input')?.focus(), 50);
}

function toggleSelecionarTodosMateriais(checked) {
  document.querySelectorAll('#tb-materiais .chk-materiais-row').forEach(el => { el.checked = checked; });
}

// ═══════════════════════════════════════════════════════════════════════
// CATÁLOGO DE GRUPOS SAP — usado no dropdown "Grupo SAP" do cadastro de
// Materiais. Combina os grupos cadastrados manualmente (state.gruposMateriais,
// persistente — ver defaultState em state.js) com os grupos já em uso em
// state.materiais, para que a lista sempre reflita "todos os grupos já
// cadastrados" mesmo antes desta funcionalidade existir.
// ═══════════════════════════════════════════════════════════════════════

// Garante que um nome de grupo esteja no catálogo persistente. Chamado
// sempre que um material é salvo (upsertMateriais) e ao cadastrar um grupo
// novo "avulso" pelo botão "+" — idempotente, não duplica (comparação
// insensível a maiúsculas/acentos via normalizeText).
function registrarGrupoMaterial(nome) {
  const grupo = String(nome || '').trim();
  if (!grupo) return;
  if (!Array.isArray(state.gruposMateriais)) state.gruposMateriais = [];
  const key = normalizeText(grupo);
  const jaExiste = state.gruposMateriais.some(g => normalizeText(g) === key);
  if (!jaExiste) {
    state.gruposMateriais.push(grupo);
    if (window.supabaseClient) {
      window.supabaseClient.from('grupos_materiais').upsert({ nome: grupo }, { onConflict: 'user_id,nome' })
        .then(({ error }) => { if (error) console.warn('[Supabase] Falha ao sincronizar grupo de material:', error); });
    }
  }
}

// Lista ordenada e sem duplicatas de todos os grupos disponíveis para o
// dropdown: catálogo persistente + grupos em uso nos materiais cadastrados.
function getGruposMateriaisDisponiveis() {
  const vistos = new Map(); // normalizado -> primeira grafia encontrada
  const add = nome => {
    const grupo = String(nome || '').trim();
    if (!grupo) return;
    const key = normalizeText(grupo);
    if (!vistos.has(key)) vistos.set(key, grupo);
  };
  (state.gruposMateriais || []).forEach(add);
  (state.materiais || []).forEach(m => add(m?.alias));
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

// Reconstrói as <option> de um <select> de Grupo SAP preservando o valor
// selecionado (ou aplicando um novo valor, se informado).
function _rebuildGrupoMateriaisOptions(selectEl, novoValor) {
  if (!selectEl) return;
  const valorAtual = novoValor !== undefined ? novoValor : selectEl.value;
  const options = getGruposMateriaisDisponiveis()
    .map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
  selectEl.innerHTML = `<option value="">—</option>${options}`;
  selectEl.value = valorAtual;
}

// Atualiza todos os dropdowns de Grupo SAP abertos no modal (pode haver
// várias linhas simultâneas, via "+ Adicionar linha").
function _refreshGrupoMateriaisSelects() {
  document.querySelectorAll('#mat-indiv-rows [data-field="alias"]').forEach(sel => _rebuildGrupoMateriaisOptions(sel));
}

// ═══════════════════════════════════════════════════════════════════════
// FATORES DE CONVERSÃO — Configurações → Fatores de Conversão (Hugo,
// 02/09/2026). Cadastro do analista para densidades/fatores de conversão
// de unidade → kg, por Grupo SAP (padrão) e opcionalmente por Fornecedor ×
// Grupo (override) — ver o motor que CONSOME esta tabela em ui.js
// (_lookupFatorConversao/_convertNfPesoToKg/_nfNeedsConversionWarning).
// Modelo de dados e o CRITÉRIO DE CASAMENTO (substring, mais específico
// vence) estão documentados no comentário de state.fatoresConversao,
// state.js — não duplicado aqui.
//
// Padrão de CRUD: modal de UMA linha por vez (como "Nova Configuração",
// modal-config), não o formulário multi-linha de Materiais — o volume
// esperado aqui é dezenas de linhas, não centenas, e editar uma densidade
// de cada vez é o caso de uso real (corrigir UM fornecedor errado).
// ═══════════════════════════════════════════════════════════════════════

// Lista de fornecedores únicos vistos em Entradas — pedido do Hugo,
// 03/09/2026 (o campo Fornecedor deixou de ser texto livre e virou
// dropdown). Só Entradas, não Saídas/Lançamentos: é lá que o campo
// Fornecedor tem sentido de fato (quem vendeu a NF), e é o fornecedor da NF
// que _lookupFatorConversao (ui.js) casa contra este cadastro.
function getFornecedoresDisponiveis() {
  const vistos = new Map(); // normalizado -> primeira grafia encontrada
  (state.entradas || []).forEach(e => {
    const f = String(e?.fornecedor || '').trim();
    if (!f) return;
    const key = normalizeText(f);
    if (!vistos.has(key)) vistos.set(key, f);
  });
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

// Reconstrói as <option> do <select> de Fornecedor, preservando (ou
// aplicando) o valor selecionado — mesmo formato de
// _rebuildGrupoMateriaisOptions, com UMA diferença: Grupo SAP garante que
// todo valor já cadastrado está no catálogo (registrarGrupoMaterial roda
// em todo save); Fornecedor não tem esse registro — um fator antigo pode
// citar um fornecedor cuja grafia não bate 100% com nada em Entradas hoje
// (ou que nunca teve NF importada). Sem tratar isso, abrir pra EDITAR
// aquele fator mostraria o <select> em branco (nenhuma <option> bate) e
// salvar de novo apagaria o fornecedor sem o analista perceber — por isso
// o valor atual é inserido como opção extra quando não está na lista.
function _rebuildFornecedorOptions(selectEl, novoValor) {
  if (!selectEl) return;
  const valorAtual = novoValor !== undefined ? novoValor : selectEl.value;
  let lista = getFornecedoresDisponiveis();
  if (valorAtual && !lista.some(f => normalizeText(f) === normalizeText(valorAtual))) {
    lista = [valorAtual, ...lista];
  }
  const options = lista.map(f => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('');
  selectEl.innerHTML = `<option value="">— padrão do grupo —</option>${options}`;
  selectEl.value = valorAtual || '';
}

// Abre o modal em modo CRIAR (id vazio) ou EDITAR (id preenchido).
function abrirFatorConversao(id) {
  const item = id ? (state.fatoresConversao || []).find(f => f.id === id) : null;
  document.getElementById('fc-modal-title').textContent = item ? 'Editar Fator de Conversão' : 'Novo Fator de Conversão';
  setVal('fc-edit-id', item ? item.id : '');
  _rebuildGrupoMateriaisOptions(document.getElementById('fc-grupo'), item ? item.grupo : '');
  _rebuildFornecedorOptions(document.getElementById('fc-fornecedor'), item ? (item.fornecedor || '') : '');
  setVal('fc-um-origem', item ? item.umOrigem : '');
  setVal('fc-um-destino', item ? (item.umDestino || 'KG') : 'KG');
  setVal('fc-fator', item ? item.fator : '');
  openModal('modal-fator-conversao');
  setTimeout(() => document.getElementById('fc-grupo')?.focus(), 50);
}

// Abre o mini modal "Novo Grupo SAP" apontando para O SELECT DESTE
// cadastro — ver o comentário de _novoGrupoMaterialTarget, mais acima
// neste arquivo, sobre por que isto é seguro reaproveitar.
function abrirNovoGrupoMaterialParaFator() {
  _novoGrupoMaterialTarget = document.getElementById('fc-grupo');
  setVal('novo-grupo-material-nome', '');
  openModal('modal-novo-grupo-material');
  setTimeout(() => document.getElementById('novo-grupo-material-nome')?.focus(), 50);
}

// Pré-preenche Unidade de Origem ao trocar o Grupo — ATALHO de digitação,
// não regra imposta (o analista pode trocar à vontade depois). Só age
// quando o campo de origem ainda está vazio: reabrir para EDITAR uma linha
// já preenchida não deve pisar no valor cadastrado. Ver UM_PADRAO_POR_
// CATEGORIA (ui.js) — agregados → M3, aditivos/adições → L.
function _fcAoTrocarGrupo() {
  const grupo = val('fc-grupo');
  const umAtual = val('fc-um-origem');
  if (!grupo || umAtual) return;
  const categoria = typeof getCategoriaPorGrupo === 'function' ? getCategoriaPorGrupo(grupo) : '';
  const padrao = (typeof UM_PADRAO_POR_CATEGORIA !== 'undefined' && UM_PADRAO_POR_CATEGORIA[categoria]) || '';
  if (padrao) setVal('fc-um-origem', padrao);
}

// Chave de negócio de um Fator de Conversão — grupo+fornecedor+unidade de
// origem, normalizados. Usada em TRÊS lugares que precisam concordar sobre
// "é o mesmo caso": a checagem de duplicata em salvarFatorConversao, o
// "chave" de _IMPORTAR_DE_CFG.fatoresConversao (o que decide se um fator de
// outro usuário já existe aqui) e upsertFatoresConversao (o merge do
// próprio import). Uma cópia inline em cada um divergiria cedo ou tarde —
// mesmo raciocínio de materialMatchKey (compartilhada por Materiais).
//
// Aceita as DUAS grafias de unidade de origem: `umOrigem` (formato local,
// como state.fatoresConversao guarda) e `um_origem` (formato cru vindo do
// Supabase em _checarNovosParaImportar, ANTES de cfg.normalizar rodar) —
// diferente de materialMatchKey, que não precisa disso porque as colunas
// de materiais têm o MESMO nome dos dois lados (origem/alias).
function _fatorConversaoMatchKey(r) {
  const grupo = String(r?.grupo || '').trim().toUpperCase();
  const fornecedor = String(r?.fornecedor || '').trim().toUpperCase();
  const umOrigem = r?.umOrigem || r?.um_origem || '';
  return `${grupo}|${fornecedor}|${umOrigem}`;
}

async function salvarFatorConversao(btn) {
  const id = val('fc-edit-id');
  const grupo = val('fc-grupo').trim();
  const fornecedor = val('fc-fornecedor').trim();
  const umOrigem = val('fc-um-origem');
  const umDestino = val('fc-um-destino') || 'KG';
  const fator = parseFloat(String(val('fc-fator')).replace(',', '.'));

  if (!grupo)     { toast('Selecione o Grupo SAP', 'error'); return; }
  if (!umOrigem)  { toast('Selecione a unidade de origem', 'error'); return; }
  if (!Number.isFinite(fator) || fator <= 0) { toast('Informe um fator válido (maior que zero)', 'error'); return; }

  if (!Array.isArray(state.fatoresConversao)) state.fatoresConversao = [];

  // Duplicata: mesma combinação grupo+fornecedor+umOrigem já cadastrada.
  // Duas linhas para o MESMO caso (ex.: duas linhas "AREIA NATURAL" sem
  // fornecedor, ambas M3) tornariam _lookupFatorConversao ambíguo — ele
  // pegaria uma das duas por ordem de array, escondendo a outra em
  // silêncio. Bloqueia na entrada em vez de deixar essa ambiguidade se
  // formar. Ver _fatorConversaoMatchKey pra por que a chave é uma função
  // compartilhada, não inline.
  const novaChave = _fatorConversaoMatchKey({ grupo, fornecedor, umOrigem });
  const conflito = state.fatoresConversao.find(f => f.id !== id && _fatorConversaoMatchKey(f) === novaChave);
  if (conflito) {
    toast(`Já existe um fator para "${grupo}"${fornecedor ? ` · ${fornecedor}` : ' (padrão)'} em ${umOrigem} — edite aquele em vez de duplicar`, 'error');
    return;
  }

  _setBtnLoading(btn, true, 'Salvando...');

  const idx = id ? state.fatoresConversao.findIndex(f => f.id === id) : -1;
  const rec = {
    // gerarIdRegistro() (normalize.js), não um id ad-hoc: precisa ser um
    // UUID de verdade para casar com a coluna `id uuid` do Supabase e
    // permitir upsert direto por id (ver _fatoresConversaoSyncUpsert) — o
    // mesmo motivo pelo qual Entradas/Saídas/Lançamentos/SAP usam esta
    // função em vez de um id caseiro.
    id: id || gerarIdRegistro(),
    grupo, fornecedor, umOrigem, umDestino, fator,
    created: idx >= 0 ? state.fatoresConversao[idx].created : new Date().toLocaleDateString('pt-BR')
  };
  if (idx >= 0) state.fatoresConversao[idx] = rec; else state.fatoresConversao.unshift(rec);

  await persistStateNow();
  renderFatoresConversao();
  // Reaplica o cadastro sobre os registros já importados: um fator novo
  // (ou corrigido) muda o peso convertido de NFs que já existem no
  // sistema, e as telas que dependem disso (Analítico, Pendências) só
  // refletem a mudança depois de um novo render — mesmo botão que
  // "Atualizar Cadastros" aciona manualmente pra Central/Material.
  if (typeof renderAll === 'function') renderAll();
  _setBtnLoading(btn, false);
  closeModal('modal-fator-conversao');
  toast(idx >= 0 ? 'Fator de conversão atualizado' : 'Fator de conversão cadastrado');
  _fatoresConversaoSyncUpsert(rec);
}

async function removerFatorConversao(id) {
  const idx = (state.fatoresConversao || []).findIndex(f => f.id === id);
  if (idx < 0) return;
  const item = state.fatoresConversao[idx];
  if (!confirm(`Excluir o fator de "${item.grupo}"${item.fornecedor ? ` · ${item.fornecedor}` : ' (padrão)'}?`)) return;
  state.fatoresConversao.splice(idx, 1);
  await persistStateNow();
  renderFatoresConversao();
  if (typeof renderAll === 'function') renderAll();
  toast('Fator de conversão excluído', 'error');
  _fatoresConversaoSyncDelete(id);
}

// ── "Importar de" — o ADM traz o cadastro de outro usuário para dentro
// do seu — chamado por confirmarImportarDe (via _IMPORTAR_DE_CFG.
// fatoresConversao.upsert, mais abaixo) com uma lista já normalizada
// ({ grupo, fornecedor, umOrigem, umDestino, fator, importadoDeId,
// created }). Cria uma CÓPIA com dono = o próprio ADM; a linha do usuário
// de origem não é tocada (a RLS de UPDATE só permite user_id = auth.uid()).
//
// id SEMPRE novo (nunca o da origem, que nem chega até aqui — ver
// _IMPORTAR_DE_CFG.fatoresConversao.campos, que omite `id` de propósito):
// _fatoresConversaoSyncUpsert faz upsert por `onConflict: 'id'`, e reusar o
// id de origem faria esse upsert COLIDIR com a linha do usuário original —
// que a RLS de UPDATE permite pro ADM — sobrescrevendo o cadastro alheio
// em vez de criar uma cópia independente. Mesmo raciocínio de
// upsertMateriais (makeMaterialId sempre novo pra item sem id).
//
// importadoDeId chega no objeto mas não é listado abaixo de propósito —
// esta tabela não tem coluna "Dono" (ao contrário de Materiais/Filiais, ver
// _donoDisplay em dashboard.js); guardar um campo que ninguém lê e que o
// próximo boot descartaria (syncFatoresConversaoFromSupabase não o busca)
// só criaria estado enganoso. Mesma decisão de upsertCapacidades.
function upsertFatoresConversao(items) {
  if (!Array.isArray(state.fatoresConversao)) state.fatoresConversao = [];
  (items || []).forEach(item => {
    const src = item && typeof item === 'object' ? item : {};
    if (!src.grupo || !src.umOrigem) return; // linha sem os dois campos-chave não é um fator válido
    const rec = {
      id: src.id || gerarIdRegistro(),
      grupo: src.grupo, fornecedor: src.fornecedor || '',
      umOrigem: src.umOrigem, umDestino: src.umDestino || 'KG',
      fator: Number(src.fator),
      created: src.created || new Date().toLocaleDateString('pt-BR')
    };
    if (!Number.isFinite(rec.fator) || rec.fator <= 0) return; // mesma validação de salvarFatorConversao

    const key = _fatorConversaoMatchKey(rec);
    const idx = state.fatoresConversao.findIndex(f => _fatorConversaoMatchKey(f) === key);
    if (idx >= 0) state.fatoresConversao[idx] = { ...state.fatoresConversao[idx], ...rec };
    else state.fatoresConversao.unshift(rec);
    _fatoresConversaoSyncUpsert(rec);
  });
  // Sem cache/índice a invalidar aqui: _lookupFatorConversao (ui.js)
  // filtra state.fatoresConversao direto a cada chamada — a lista é
  // pequena (dezenas de linhas), não precisa da otimização de índice que
  // materiais/filiais têm pros milhares de registros deles.
}

// ── Sincronização com o Supabase ─────────────────────────────────────────
// Tabela public.fatores_conversao (migração criada em 03/09/2026): mesma
// estrutura de RLS de materiais/grupos_materiais/filiais (dono OU
// is_admin()), mas SEM a visibilidade cruzada por padrão — cada usuário só
// enxerga/gerencia o PRÓPRIO cadastro aqui (mesmo motivo de
// syncMateriaisFromSupabase: two-of-us-have-the-same-Grupo-with-different-
// fator não deve se resolver sozinho). ADM pode ver todos os fatores via a
// policy de SELECT, mas esta tela não pede isso — se um dia quiser um fluxo
// "Importar de" como Materiais tem, é aditivo a partir daqui.
//
// id gerado localmente via gerarIdRegistro() (ver salvarFatorConversao) é
// um UUID de verdade, então o upsert usa a PRÓPRIA coluna id como chave de
// conflito — mais simples que a chave natural usada por materiais (que
// precisa suportar renomear origem/alias), e este cadastro não tem esse
// caso: editar um fator não muda a identidade da linha.
function _fatoresConversaoSyncUpsert(rec) {
  if (!window.supabaseClient) return;
  window.supabaseClient.from('fatores_conversao')
    .upsert({
      id: rec.id, grupo: rec.grupo, fornecedor: rec.fornecedor || '',
      um_origem: rec.umOrigem, um_destino: rec.umDestino || 'KG', fator: rec.fator
    }, { onConflict: 'id' })
    .then(({ error }) => { if (error) console.warn('[Supabase] Falha ao sincronizar fator de conversão:', error); });
}

function _fatoresConversaoSyncDelete(id) {
  if (!window.supabaseClient) return;
  window.supabaseClient.from('fatores_conversao')
    .delete()
    .eq('id', id)
    .eq('user_id', window.currentUser?.id)
    .then(({ error }) => {
      if (error) {
        console.warn('[Supabase] Falha ao excluir fator de conversão na nuvem:', error);
        toast('⚠ Removido nesta sessão, mas não foi possível sincronizar com a nuvem.', 'error');
      }
    });
}

// Busca no boot — registrado em SUPABASE_BOOT_SYNCS (dashboard.js). Mesmo
// "O BANCO MANDA" de syncMateriaisFromSupabase para o CONTEÚDO das linhas
// que já existem nos dois lados (uma exclusão feita em outro dispositivo
// não pode "ressuscitar" aqui). A diferença é o AUTO-UPLOAD do que só
// existe localmente: materiais removeu esse self-heal porque tinha um
// painel de Supervisão apagando linhas por fora — aqui não existe nada
// assim, o único jeito de uma linha sumir é removerFatorConversao (que já
// apaga na nuvem também), então subir o que falta é seguro e necessário —
// é o que faz o cadastro migrado de _seedFatoresConversaoLegado (a
// primeira vez que este dispositivo carrega com o recurso) chegar na
// nuvem, em vez de morrer aqui no próximo boot só porque ele ainda não
// tinha sido enviado.
async function syncFatoresConversaoFromSupabase() {
  if (!window.supabaseClient) return;
  try {
    const { data, error } = await window.supabaseClient.from('fatores_conversao')
      .select('id, grupo, fornecedor, um_origem, um_destino, fator, created_at')
      .eq('user_id', window.currentUser?.id);
    if (error) throw error;

    const remoto = (data || []).map(r => ({
      id: r.id, grupo: r.grupo, fornecedor: r.fornecedor || '',
      umOrigem: r.um_origem, umDestino: r.um_destino || 'KG', fator: Number(r.fator),
      created: r.created_at ? new Date(r.created_at).toLocaleDateString('pt-BR') : new Date().toLocaleDateString('pt-BR')
    }));

    const idsRemotos = new Set(remoto.map(r => r.id));
    const local = Array.isArray(state.fatoresConversao) ? state.fatoresConversao : [];
    const faltamNaNuvem = local.filter(f => f && f.id && !idsRemotos.has(f.id));

    state.fatoresConversao = [...remoto, ...faltamNaNuvem];
    faltamNaNuvem.forEach(f => _fatoresConversaoSyncUpsert(f));

    if (typeof renderFatoresConversao === 'function') renderFatoresConversao();
    // Só ADM, e só depois que este fetch já tem os dados atuais — mesmo
    // ponto de disparo de syncMateriaisFromSupabase/syncFiliaisFromSupabase
    // (alimenta o box de alerta + o modal "Importar de").
    if (window.currentUser?.role === 'admin') await _checarNovosParaImportar('fatoresConversao');
  } catch (err) {
    console.warn('[Supabase] Falha ao buscar fatores de conversão — mantendo dados locais.', err);
  }
}

// ── Render ────────────────────────────────────────────────────────────
// Sem paginação/listPages, ao contrário de Materiais/Filiais/Configs: o
// volume esperado (grupos × fornecedores com fator próprio) fica na casa
// de dezenas, não milhares — a maquinaria de paginação genérica existe
// pros módulos de importação em massa, não pra este cadastro. Um campo de
// busca simples já resolve.
let _fcFiltro = '';
function fcFiltrar(termo) { _fcFiltro = String(termo || ''); renderFatoresConversao(); }

function renderFatoresConversao() {
  const tb = document.getElementById('tb-fatores-conversao');
  if (!tb) return;
  const termo = normalizeText(_fcFiltro.trim());
  const linhas = (state.fatoresConversao || []).filter(f => !termo ||
    normalizeText(`${f.grupo} ${f.fornecedor || ''} ${f.umOrigem} ${f.fator}`).includes(termo)
  );
  // Ordena por Grupo, e dentro do grupo o PADRÃO (fornecedor vazio)
  // primeiro — é a leitura natural: "eis a regra geral, e as exceções
  // dela logo abaixo".
  linhas.sort((a, b) =>
    String(a.grupo).localeCompare(String(b.grupo), 'pt-BR') ||
    String(a.fornecedor || '').localeCompare(String(b.fornecedor || ''), 'pt-BR')
  );

  const info = document.getElementById('pi-fatores-conversao');
  if (info) info.textContent = `${linhas.length} registro${linhas.length === 1 ? '' : 's'}`;

  if (!linhas.length) {
    tb.innerHTML = `<tr><td colspan="7"><div class="empty-state"><i class="ti ti-scale"></i><p>${
      _fcFiltro ? 'Nenhum resultado para este filtro.' : 'Nenhum fator de conversão cadastrado — os fatores legados (areia/brita) foram migrados automaticamente na primeira vez que este dispositivo carregou com este recurso.'
    }</p></div></td></tr>`;
    // O box de "N fatores novos pra importar" não depende da tabela local
    // ter linhas — cadastro vazio é justamente quando importar de outro
    // usuário é mais útil. Chamado nos dois caminhos de saída (aqui e no
    // fim da função), não só no "tem linhas".
    if (typeof _renderNovosPendentesBox === 'function') _renderNovosPendentesBox('fatoresConversao');
    return;
  }

  const umLabel = cod => ((typeof UM_CANONICAS !== 'undefined' ? UM_CANONICAS : []).find(u => u.cod === cod) || {}).label || cod;
  // "1 M3 = X KG" / "1 L = X KG" — o FATOR já É essa equivalência (é
  // literalmente quantos kg cabem numa unidade de origem), mas exibido cru
  // ("1.440") o analista precisa lembrar de cabeça o que aquele número
  // significa. Escrito por extenso a linha se lê sozinha, sem precisar
  // olhar a coluna Unidade ao lado pra saber de qual lado da conta é o 1.
  const equivalencia = f => `1 ${escapeHtml(f.umOrigem)} = ${Number(f.fator).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 })} ${escapeHtml(f.umDestino || 'KG')}`;

  tb.innerHTML = linhas.map(f => `
    <tr>
      <td class="td-mono" style="font-weight:600">${escapeHtml(f.grupo)}</td>
      <td class="td-muted">${f.fornecedor ? escapeHtml(f.fornecedor) : '<span style="color:var(--text3);font-style:italic">padrão do grupo</span>'}</td>
      <td class="td-mono" style="text-align:center" title="${escapeHtml(umLabel(f.umOrigem))} → ${escapeHtml(umLabel(f.umDestino || 'KG'))}">${escapeHtml(f.umOrigem)} → ${escapeHtml(f.umDestino || 'KG')}</td>
      <td class="td-mono" style="text-align:right">${Number(f.fator).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 })}</td>
      <td class="td-mono" style="color:var(--text2)">${equivalencia(f)}</td>
      <td class="td-muted">${f.created || '—'}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn-icon" onclick="abrirFatorConversao('${escapeHtml(f.id)}')" title="Editar"><i class="ti ti-pencil"></i></button>
          <button class="btn-icon danger" onclick="removerFatorConversao('${escapeHtml(f.id)}')" title="Excluir"><i class="ti ti-trash"></i></button>
        </div>
      </td>
    </tr>
  `).join('');
  if (typeof _renderNovosPendentesBox === 'function') _renderNovosPendentesBox('fatoresConversao');
}

// ═══════════════════════════════════════════════════════════════════════
// CATÁLOGO DE CÓD SAP — usado no dropdown "Cód SAP" do cadastro de
// Materiais. Ao contrário de Grupo SAP, não tem tabela própria no Supabase:
// a lista é os códigos já em uso em state.materiais + os adicionados nesta
// sessão via "+" (_codigosSapSessionExtras, some ao recarregar a página —
// assim que o material com esse código é salvo, ele passa a vir de
// state.materiais normalmente).
// ═══════════════════════════════════════════════════════════════════════
let _codigosSapSessionExtras = [];

function getCodigosSapDisponiveis() {
  const vistos = new Map();
  const add = cod => {
    const codigo = String(cod || '').trim();
    if (!codigo) return;
    if (!vistos.has(codigo)) vistos.set(codigo, codigo);
  };
  _codigosSapSessionExtras.forEach(add);
  (state.materiais || []).forEach(m => add(m?.codSap));
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
}

function _rebuildCodigosSapOptions(selectEl, novoValor) {
  if (!selectEl) return;
  const valorAtual = novoValor !== undefined ? novoValor : selectEl.value;
  const options = getCodigosSapDisponiveis()
    .map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  selectEl.innerHTML = `<option value="">—</option>${options}`;
  selectEl.value = valorAtual;
}

function _refreshCodigosSapSelects() {
  document.querySelectorAll('#mat-indiv-rows [data-field="codSap"]').forEach(sel => _rebuildCodigosSapOptions(sel));
}

// ── Mini modal "Novo Cód SAP" ───────────────────────────────────────────
let _novoCodSapTarget = null; // <select> da linha que abriu o mini modal

function abrirNovoCodSap(btn) {
  const row = btn.closest('.reg-individual-row');
  _novoCodSapTarget = row?.querySelector('[data-field="codSap"]') || null;
  setVal('novo-cod-sap-valor', '');
  openModal('modal-novo-cod-sap');
  setTimeout(() => document.getElementById('novo-cod-sap-valor')?.focus(), 50);
}

function salvarNovoCodSap() {
  const codigo = val('novo-cod-sap-valor').trim();
  if (!codigo) { toast('Informe o Cód SAP', 'error'); return; }

  const jaExiste = getCodigosSapDisponiveis().includes(codigo);
  if (!jaExiste) _codigosSapSessionExtras.push(codigo);
  _refreshCodigosSapSelects();
  if (_novoCodSapTarget) _novoCodSapTarget.value = codigo;
  _novoCodSapTarget = null;
  closeModal('modal-novo-cod-sap');
  toast(jaExiste ? `Cód SAP "${codigo}" já disponível — selecionado` : `Cód SAP "${codigo}" adicionado`);
}

// ── Mini modal "Novo Grupo SAP" ─────────────────────────────────────────
// Compartilhado por QUALQUER select de Grupo SAP no sistema — não só as
// linhas do cadastro de Materiais. `_novoGrupoMaterialTarget` é o único
// select que este mini modal preenche ao salvar; quem abre o modal decide
// qual é (abrirNovoGrupoMaterial para as linhas de Materiais,
// abrirNovoGrupoMaterialParaFator para o cadastro de Fatores de Conversão
// — config.js, mais abaixo — ambos só apontam o alvo e abrem o mesmo modal).
let _novoGrupoMaterialTarget = null; // <select> que abriu o mini modal

function abrirNovoGrupoMaterial(btn) {
  const row = btn.closest('.reg-individual-row');
  _novoGrupoMaterialTarget = row?.querySelector('[data-field="alias"]') || null;
  setVal('novo-grupo-material-nome', '');
  openModal('modal-novo-grupo-material');
  setTimeout(() => document.getElementById('novo-grupo-material-nome')?.focus(), 50);
}

async function salvarNovoGrupoMaterial(btn) {
  const nomeDigitado = val('novo-grupo-material-nome').trim();
  if (!nomeDigitado) { toast('Informe o nome do grupo', 'error'); return; }

  const key = normalizeText(nomeDigitado);
  const existente = getGruposMateriaisDisponiveis().find(g => normalizeText(g) === key);
  const nomeFinal = existente || nomeDigitado;

  _setBtnLoading(btn, true, 'Salvando...');
  if (!existente) {
    registrarGrupoMaterial(nomeDigitado);
    await persistStateNow();
  }
  _refreshGrupoMateriaisSelects();
  // _rebuildGrupoMateriaisOptions, não só `.value =`: um select de FORA de
  // #mat-indiv-rows (ex.: o de Fatores de Conversão) não foi tocado pelo
  // _refreshGrupoMateriaisSelects() acima, então ainda não tem a <option>
  // do grupo recém-criado — setar .value sem essa option deixaria o select
  // em branco. Para o caso ORIGINAL (select dentro de #mat-indiv-rows,
  // já reconstruído na linha de cima) isto é só um segundo rebuild
  // idempotente — mesmo resultado, sem custo real.
  if (_novoGrupoMaterialTarget) _rebuildGrupoMateriaisOptions(_novoGrupoMaterialTarget, nomeFinal);
  _novoGrupoMaterialTarget = null;
  _setBtnLoading(btn, false);
  closeModal('modal-novo-grupo-material');
  toast(existente ? `Grupo "${nomeFinal}" já existia — selecionado` : `Grupo "${nomeFinal}" cadastrado`);
}

function _addMaterialIndivRow() {
  const container = document.getElementById('mat-indiv-rows');
  if (!container) return;
  const id = _matIndivRowSeq++;
  const catOptions = (typeof CATEGORIAS_MATERIAL !== 'undefined' ? CATEGORIAS_MATERIAL : [])
    .map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  const grupoOptions = getGruposMateriaisDisponiveis()
    .map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
  const codSapOptions = getCodigosSapDisponiveis()
    .map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  const row = document.createElement('div');
  row.className = 'reg-individual-row reg-row-materiais';
  row.dataset.rowId = id;
  row.innerHTML = `
    <div class="form-group">
      <label class="form-label">Original</label>
      <input type="text" class="form-input" data-field="origem" placeholder="Nome bruto (como vem na importação)">
    </div>
    <div class="form-group">
      <label class="form-label">Grupo SAP</label>
      <div style="display:flex; gap:6px">
        <select class="form-select" data-field="alias" style="flex:1; min-width:0">
          <option value="">—</option>
          ${grupoOptions}
        </select>
        <button type="button" class="btn" title="Cadastrar novo Grupo SAP" onclick="abrirNovoGrupoMaterial(this)" style="flex:0 0 auto; padding:0 12px"><i class="ti ti-plus"></i></button>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Cód SAP</label>
      <div style="display:flex; gap:6px">
        <select class="form-select" data-field="codSap" style="flex:1; min-width:0">
          <option value="">—</option>
          ${codSapOptions}
        </select>
        <button type="button" class="btn" title="Cadastrar novo Cód SAP" onclick="abrirNovoCodSap(this)" style="flex:0 0 auto; padding:0 12px"><i class="ti ti-plus"></i></button>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Categoria</label>
      <select class="form-select" data-field="categoria">
        <option value="">—</option>
        ${catOptions}
      </select>
    </div>
    <div class="reg-row-remove" title="Remover esta linha" onclick="_removeIndivRow(this)"><i class="ti ti-x"></i></div>
  `;
  container.appendChild(row);
}

// Compartilhado entre Materiais e Filiais — remove a linha clicada, mas
// mantém sempre pelo menos 1 linha visível no formulário (limpa em vez de
// remover, se for a última).
function _removeIndivRow(el) {
  const row = el.closest('.reg-individual-row');
  if (!row) return;
  const container = row.parentElement;
  if (container.children.length <= 1) {
    row.querySelectorAll('input, select').forEach(i => { i.value = ''; });
    return;
  }
  row.remove();
}

async function salvarMateriaisIndividual(btn) {
  const container = document.getElementById('mat-indiv-rows');
  if (!container) return;
  const rows = [...container.querySelectorAll('.reg-individual-row')];
  const toCreate = [];
  const toEdit = [];
  rows.forEach(row => {
    const origem = row.querySelector('[data-field="origem"]')?.value.trim() || '';
    const alias  = row.querySelector('[data-field="alias"]')?.value.trim()  || '';
    const codSap = row.querySelector('[data-field="codSap"]')?.value.trim() || '';
    const categoriaRaw = row.querySelector('[data-field="categoria"]')?.value.trim() || '';
    if (!origem || !alias) return; // linha em branco ou incompleta — ignora silenciosamente
    const categoria = normalizeCategoriaMaterial(categoriaRaw);
    if (row.dataset.editOrigemOrig !== undefined) {
      toEdit.push({ origem, alias, codSap, categoria, origemOriginal: row.dataset.editOrigemOrig, aliasOriginal: row.dataset.editAliasOrig });
    } else {
      toCreate.push({ origem, alias, codSap, categoria, created: new Date().toLocaleDateString('pt-BR') });
    }
  });

  if (!toCreate.length && !toEdit.length) { toast('Preencha ao menos um cadastro completo (Original + Grupo SAP)', 'error'); return; }

  _setBtnLoading(btn, true, 'Salvando...');
  if (toCreate.length) upsertMateriais(toCreate);
  if (toEdit.length) editarMateriais(toEdit);
  listPages.materiais = 0;
  closeModal('modal-materiais-individual');
  _setBtnLoading(btn, false);
  reaplicarPadronizacaoMateriais();
  await persistStateNow();
  renderAll();
  updateImportPrereqUI();
  const msg = toEdit.length && !toCreate.length ? `${toEdit.length} material(is) atualizado(s)`
    : toCreate.length && !toEdit.length ? `${toCreate.length} material(is) cadastrado(s)`
    : `${toCreate.length + toEdit.length} material(is) salvo(s)`;
  toast(msg);
}

// Atualiza cadastros existentes EM PLACE (localiza pela chave original
// origem+alias, preserva id/created/importId). Diferente de upsertMateriais:
// aquele sempre trata a chave atual como identidade e criaria um registro
// novo (duplicado) se Original ou Grupo SAP mudou — aqui a identidade é a
// chave ANTES da edição.
function editarMateriais(items) {
  (items || []).forEach(item => {
    const keyOrig = [normalizeText(item.origemOriginal), normalizeText(item.aliasOriginal)].join('||');
    const idx = state.materiais.findIndex(m => materialMatchKey(m) === keyOrig);
    if (idx < 0) return;
    const rec = { ...state.materiais[idx], origem: item.origem, alias: item.alias, codSap: item.codSap, categoria: item.categoria };
    state.materiais[idx] = rec;
    registrarGrupoMaterial(rec.alias);
    _materiaisSyncUpdate(item.origemOriginal, item.aliasOriginal, rec);
  });
  invalidateMaterialLookup();
}

// Sincroniza uma edição com o Supabase via UPDATE (não upsert). Dois
// motivos pra não reaproveitar _materiaisSyncUpsert aqui:
// 1) o onConflict do upsert usa a chave ATUAL (user_id,origem,alias) — se
//    Original/Grupo SAP mudou, ela não bate mais com a linha antiga e cria
//    um registro duplicado (linha velha órfã + linha nova).
// 2) CRÍTICO pro Supervisor editando cadastro de outro usuário: a policy de
//    INSERT de materiais/filiais exige user_id = auth.uid() SEM exceção
//    pra is_admin() (só UPDATE tem esse bypass) — um upsert tentando
//    inserir/conflitar uma linha com user_id de outro dono é rejeitado pela
//    RLS. UPDATE não tem esse problema: dá pra mudar QUALQUER coluna,
//    inclusive origem/alias, de uma linha que já existe, sem precisar
//    inserir nada — só precisa ownerId correto no WHERE.
function _materiaisSyncUpdate(oldOrigem, oldAlias, rec) {
  if (!window.supabaseClient) return;
  const ownerId = rec.donoId || window.currentUser?.id;
  if (!ownerId) return;
  window.supabaseClient.from('materiais')
    .update({ origem: rec.origem, alias: rec.alias, cod_sap: rec.codSap || null, categoria: rec.categoria || null })
    .eq('user_id', ownerId).eq('origem', oldOrigem).eq('alias', oldAlias)
    .then(({ error }) => { if (error) console.warn('[Supabase] Falha ao atualizar material:', error); });
}

function materialMatchKey(item) {
  return [
    normalizeText(item?.origem),
    normalizeText(item?.alias)
  ].join('||');
}

function makeMaterialId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return 'mat_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

function normalizeImportedMaterial(item, importId) {
  const src = item && typeof item === 'object' ? item : {};
  return {
    id: src.id || makeMaterialId(),
    origem: String(src.origem || '').trim(),
    alias: String(src.alias || '').trim(),
    codSap: String(src.codSap || '').trim(),
    categoria: normalizeCategoriaMaterial(src.categoria),
    created: src.created || new Date().toLocaleDateString('pt-BR'),
    importId
  };
}

function normalizeImportedFilial(item, importId) {
  const src = item && typeof item === 'object' ? item : {};
  return {
    origem: String(src.origem || '').trim(),
    alias: String(src.alias || '').trim(),
    cnpj: String(src.cnpj || '').trim(),
    regional: String(src.regional || '').trim(),
    created: src.created || new Date().toLocaleDateString('pt-BR'),
    importId
  };
}

// Sincroniza com Supabase TODO cadastro de material — manual ou importado
// em lote (Fase 4, Etapa 2; até aqui só o manual sincronizava). Guarda
// import_id na nuvem para a futura etapa de exclusão em cascata (Fase 4,
// Etapa 7) saber o que apagar lá também. Falha não bloqueia a UI.
//
// CORREÇÃO: a coluna real na tabela é 'created_at' (timestamptz, default
// now()), não 'created' — enviar 'created' (string pt-BR de exibição, ex.
// "26/07/2026") batia num erro "column materiais.created does not exist",
// sempre silencioso. Não enviamos created_at no upsert: o default do banco
// cuida da criação, e não queremos sobrescrever com uma string incompatível
// nas atualizações seguintes.
function _materiaisSyncUpsert(rec) {
  if (!window.supabaseClient) return;
  window.supabaseClient.from('materiais')
    .upsert({ origem: rec.origem, alias: rec.alias, cod_sap: rec.codSap || null, categoria: rec.categoria || null, import_id: rec.importId || null, origem_usuario_id: rec.importadoDeId || null }, { onConflict: 'user_id,origem,alias' })
    .then(({ error }) => { if (error) console.warn('[Supabase] Falha ao sincronizar material:', error); });
}

// Upsert em lote — usado na sincronização inicial (registros locais
// pré-existentes que ainda não subiram pra nuvem, tipicamente uma base já
// importada antes desta atualização). Quebrado em blocos, mesmo padrão de
// _lancSyncUpsertBatch (import.js).
const CADASTRO_SYNC_BATCH_SIZE = 500;
async function _materiaisSyncUpsertBatch(recs) {
  if (!window.supabaseClient || !recs || !recs.length) return;
  const rows = recs.map(rec => ({ origem: rec.origem, alias: rec.alias, cod_sap: rec.codSap || null, categoria: rec.categoria || null, import_id: rec.importId || null, origem_usuario_id: rec.importadoDeId || null }));
  for (let i = 0; i < rows.length; i += CADASTRO_SYNC_BATCH_SIZE) {
    const { error } = await window.supabaseClient.from('materiais').upsert(rows.slice(i, i + CADASTRO_SYNC_BATCH_SIZE), { onConflict: 'user_id,origem,alias' });
    if (error) { console.warn('[Supabase] Falha ao sincronizar lote de materiais:', error); break; }
  }
}

// Busca no boot — mescla por chave natural (origem+alias), NUNCA substitui
// a lista local inteira. Antes desta correção (Fase 4), a nuvem só tinha o
// cadastro manual, então o merge era "nuvem + tudo que for importado local"
// (union simples). Agora que a nuvem também recebe cadastro importado, um
// union simples duplicaria registros recém-sincronizados — o merge precisa
// ser por chave, nuvem tem prioridade em conflito. Depois do merge, sobe
// pra nuvem qualquer material local que ainda não esteja lá (self-heal da
// base já existente, mesmo padrão usado em Lançamentos).
async function syncMateriaisFromSupabase() {
  try {
    // BUG REAL (04/08): antes buscava a tabela inteira (fetchAllRows, sem
    // filtro) — pra usuário comum a RLS já restringia ao próprio, mas pro
    // ADM (is_admin() libera SELECT de tudo) isso trazia o cadastro de
    // TODOS os usuários pra tela de Configurações sem pedir. Decisão nova:
    // Configurações mostra só o que é do próprio dono; ver o de outro
    // usuário agora é opt-in via "Importar de" (abrirImportarDe) — cria uma
    // CÓPIA independente, nunca visibilidade automática. Supervisão →
    // Dados por módulo continua vendo tudo (consulta direto, não passa
    // por aqui). Consulta simples (sem paginação por cursor): o total é
    // sempre um catálogo de UM usuário, bem abaixo do teto de 1000 linhas.
    const { data, error } = await window.supabaseClient.from('materiais')
      .select('user_id, origem, alias, cod_sap, categoria, import_id, created_at, origem_usuario_id')
      .eq('user_id', window.currentUser?.id);
    if (error) throw error;
    // O BANCO MANDA (30/07): o self-heal que existia aqui reenviava todo
    // material local ausente da nuvem, o que desfazia qualquer exclusão
    // feita pelo painel de Supervisão no boot seguinte. A nuvem substitui.
    // Erro de busca cai no catch e preserva o local.
    const local = Array.isArray(state.materiais) ? state.materiais : [];
    const porChaveLocal = new Map(local.map(m => [materialMatchKey(m), m]));
    state.materiais = (data || []).map(r => {
      // Preserva o id local quando o material já era conhecido — evita
      // "churn" de id a cada boot (o resto do estado referencia esse id).
      const existenteLocal = porChaveLocal.get(materialMatchKey(r));
      return {
        id: existenteLocal?.id || makeMaterialId(),
        donoId: r.user_id,
        // Preenchido só quando o registro veio de "Importar de" — de qual
        // usuário a cópia foi tirada (ver abrirImportarDe/confirmarImportarDe).
        importadoDeId: r.origem_usuario_id || undefined,
        origem: r.origem, alias: r.alias, codSap: r.cod_sap || '', categoria: r.categoria,
        importId: r.import_id || undefined,
        created: r.created_at ? new Date(r.created_at).toLocaleDateString('pt-BR') : (existenteLocal?.created || new Date().toLocaleDateString('pt-BR')),
      };
    });
    invalidateMaterialLookup();
    if (window.currentUser?.role === 'admin') await _checarNovosParaImportar('materiais');
  } catch (err) {
    console.warn('[Supabase] Falha ao buscar materiais — mantendo dados locais.', err);
  }
}

function upsertMateriais(items) {
  (items || []).forEach(item => {
    const src = item && typeof item === 'object' ? item : {};
    const rec = {
      id: src.id || makeMaterialId(),
      donoId: src.donoId || window.currentUser?.id,
      ...src,
      created: src.created || new Date().toLocaleDateString('pt-BR')
    };

    const key = materialMatchKey(rec);
    const idx = state.materiais.findIndex(f => materialMatchKey(f) === key);
    if (idx >= 0) state.materiais[idx] = { ...state.materiais[idx], ...rec };
    else state.materiais.unshift(rec);
    // Mantém o catálogo de Grupos SAP em sincronia — cobre tanto o cadastro
    // guiado quanto a importação por arquivo (handleMateriaisImport), já
    // que ambos passam por aqui.
    registrarGrupoMaterial(rec.alias);
    _materiaisSyncUpsert(rec);
  });
  invalidateMaterialLookup();
}

function parseMateriaisRows(rows) {
  const cleaned = (rows || []).filter(row => Array.isArray(row) && row.some(c => c !== '' && c !== null && c !== undefined));
  if (!cleaned.length) return [];

  const norm = v => normalizeText(v);
  const header = cleaned[0].map(norm);

  const findIdx = (...names) => {
    for (const name of names) {
      const idx = header.findIndex(h => h === norm(name));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const headerLooksLikeMeta = header.some(h => [
    'ORIGEM', 'ORIGINAL', 'MATERIAL', 'MATERIAL ORIGINAL', 'GRUPO', 'GRUPO SAP', 'SAP', 'CATEGORIA', 'DESCRICAO', 'DESCRIÇÃO'
  ].includes(h));

  let startRow = 0;
  let origemIdx = 0;
  let aliasIdx = 1;
  let codSapIdx = -1;
  let categoriaIdx = -1;

  if (headerLooksLikeMeta) {
    startRow = 1;
    origemIdx = findIdx('origem', 'original', 'material', 'material original', 'nome');
    aliasIdx = findIdx('grupo', 'grupo sap', 'sap', 'padronizada', 'padronizado', 'padronizacao', 'padronização');
    codSapIdx = findIdx('cod sap', 'cod. sap', 'codigo sap', 'código sap', 'cod_sap');
    // "Descrição"/"Observação" entram como aliases de Categoria: essa era a
    // convenção usada para anotar a categoria antes de existir uma coluna
    // dedicada, e o cadastro de Materiais não tem mais um campo de descrição.
    categoriaIdx = findIdx('categoria', 'categoria material', 'category', 'cat', 'cat.', 'descricao', 'descrição', 'descricao do material', 'observacao', 'observação');
    if (origemIdx < 0) origemIdx = 0;
    if (aliasIdx < 0) aliasIdx = 1;
  }
  // Sem cabeçalho reconhecido, não há como adivinhar com segurança em qual
  // coluna posicional estaria a categoria — fica de fora nesse caso (o
  // analista pode completar depois pelo cadastro manual ou reimportar com
  // um cabeçalho "CATEGORIA" explícito).

  return cleaned.slice(startRow).map(row => ({
    origem: String(row[origemIdx] || '').trim(),
    alias: String(row[aliasIdx] || '').trim(),
    codSap: codSapIdx >= 0 ? String(row[codSapIdx] || '').trim() : '',
    categoria: categoriaIdx >= 0 ? normalizeCategoriaMaterial(row[categoriaIdx]) : '',
    created: new Date().toLocaleDateString('pt-BR')
  })).filter(r => r.origem && r.alias);
}

async function handleMateriaisImport(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (typeof XLSX === 'undefined') {
    toast('Biblioteca XLSX não carregada.', 'error');
    return;
  }

  showLoadingOverlay('Importando materiais', 'Lendo o arquivo de materiais...');
  if (typeof loadingShowSteps === 'function') loadingShowSteps([
    { id: 'mat-read',  icon: 'ti-file-spreadsheet', label: 'Lendo o arquivo' },
    { id: 'mat-parse', icon: 'ti-transform',         label: 'Processando cadastros' },
    { id: 'mat-norm',  icon: 'ti-adjustments',       label: 'Padronizando materiais' },
    { id: 'mat-save',  icon: 'ti-device-floppy',     label: 'Salvando no banco local' },
  ]);

  const fileName = file.name.toLowerCase();
  const reader = new FileReader();

  reader.onload = async function(e) {
    try {
      _lstepSet('mat-read', 'running'); _lbarSet(10);
      updateLoadingOverlay('Separando os registros de materiais...', 'Importando materiais');
      let rows = [];

      if (fileName.endsWith('.csv')) {
        const wb = XLSX.read(String(e.target.result || ''), { type: 'string', raw: true });
        // BLINDAGEM (28/07): mesma proteção aplicada na importação dos 5
        // módulos grandes (dashboard.js) — ver comentário lá para o
        // contexto completo do problema real que motivou isto.
        if (!wb.Sheets[wb.SheetNames[0]]) {
          throw new Error('Não foi possível localizar os dados da planilha neste arquivo. Tente reexportar e importar de novo.');
        }
        const ws = sanitizeWorksheet(wb.Sheets[wb.SheetNames[0]]);
        rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      } else {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: false });
        if (!wb.Sheets[wb.SheetNames[0]]) {
          throw new Error('Não foi possível localizar os dados da planilha neste arquivo. Tente reexportar e importar de novo.');
        }
        const ws = sanitizeWorksheet(wb.Sheets[wb.SheetNames[0]]);
        rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      }

      _lstepSet('mat-read', 'done'); _lstepSet('mat-parse', 'running'); _lbarSet(35);
      const items = parseMateriaisRows(rows);

      if (!items.length) {
        toast('Arquivo sem cadastros válidos', 'error');
        hideLoadingOverlay('Falha');
        if (typeof loadingHideSteps === 'function') loadingHideSteps();
        return;
      }

      const importId = `cad_materiais_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

      _lstepSet('mat-parse', 'done'); _lstepSet('mat-norm', 'running'); _lbarSet(60);
      updateLoadingOverlay('Atualizando cadastros salvos...', 'Importando materiais');
      upsertMateriais(items.map(item => normalizeImportedMaterial(item, importId)));
      state.imports.unshift({
        id: importId, arquivo: file.name, modulo: 'Materiais',
        registros: items.length, dataHora: new Date().toLocaleString('pt-BR'),
        status: 'Importado', createdAt: Date.now()
      });
      listPages.materiais = 0;
      reaplicarPadronizacaoMateriais();
      _lstepSet('mat-norm', 'done'); _lstepSet('mat-save', 'running'); _lbarSet(85);
      await persistStateNow();
      _lstepSet('mat-save', 'done'); _lbarSet(100);
      renderAll();
      updateImportPrereqUI();
      closeModal('modal-materiais-individual');
      hideLoadingOverlay('Materiais importados');
      if (typeof loadingHideSteps === 'function') loadingHideSteps();
      toast(`${items.length} material(is) importado(s)`);
      event.target.value = '';
    } catch (err) {
      console.error(err);
      toast('Falha ao importar materiais: ' + (err?.message || 'erro desconhecido'), 'error');
    } finally {
      hideLoadingOverlay('Importação concluída');
    }
  };

  reader.onerror = () => {
    toast('Não foi possível ler o arquivo selecionado', 'error');
    hideLoadingOverlay('Falha na importação');
  };

  if (fileName.endsWith('.csv')) reader.readAsText(file, 'utf-8');
  else reader.readAsArrayBuffer(file);
}

function focusMaterialImport() {
  document.getElementById('file-materiais')?.click();
}

async function removerMaterial(id, btn) {
  const idx = state.materiais.findIndex(m => m.id === id);
  if (idx < 0) {
    toast('Material não encontrado', 'error');
    return;
  }
  const rec = state.materiais[idx];

  confirmarDestrutivo({
    title: 'Excluir cadastro de material',
    sub: rec.origem,
    body: `
      <div style="display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;gap:8px;align-items:center">
          <span style="color:var(--text3);min-width:80px;font-size:12px">Original</span>
          <strong>${escapeHtml(rec.origem)}</strong>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span style="color:var(--text3);min-width:80px;font-size:12px">Grupo SAP</span>
          <span>${escapeHtml(rec.alias)}</span>
        </div>
        <div style="margin-top:8px;padding:10px 12px;background:var(--red-bg);border:1px solid var(--red-border);border-radius:6px;font-size:12px;color:var(--red)">
          <i class="ti ti-alert-triangle"></i>
          Registros já importados que usam este nome original deixarão de ser padronizados e passarão a aparecer como "sem cadastro" até serem recadastrados.
        </div>
      </div>`,
    confirmLabel: 'Excluir material',
    onConfirm: async () => {
      _setBtnLoading(btn, true);
      const curIdx = state.materiais.findIndex(m => m.id === id);
      if (curIdx < 0) { _setBtnLoading(btn, false); return; }
      state.materiais.splice(curIdx, 1);
      invalidateMaterialLookup();
      reaplicarPadronizacaoMateriais();
      await persistStateNow();
      renderAll();
      updateImportPrereqUI();
      toast('Material removido');
      // Delete no Supabase é inofensivo mesmo se o registro nunca tiver
      // sido sincronizado (veio de importação em lote) — não acha nada.
      // Escopado ao próprio user_id (ver _supaDeleteOwned, normalize.js):
      // origem+alias sozinhos colidem entre contas (ex.: duas centrais
      // chamadas "MATRIZ" em usuários diferentes).
      _supaDeleteOwned('materiais', { origem: rec.origem, alias: rec.alias })
        .then(({ error }) => { if (error) console.warn('[Supabase] Falha ao excluir material na nuvem:', error); });
      // Não precisa _setBtnLoading(false) aqui — o botão em si some do DOM
      // no próximo renderAll()/renderMateriais(), que redesenha a tabela.
    }
  });
}

async function limparMateriais() {
  if (!state.materiais.length) return toast('Nenhum material cadastrado', 'error');
  if (!confirm('Excluir todos os materiais cadastrados?')) return;
  state.materiais = [];
  invalidateMaterialLookup();
  reaplicarPadronizacaoMateriais();
  await persistStateNow();
  renderAll();
  updateImportPrereqUI();
  toast('Todos os materiais foram excluídos', 'error');
  window.supabaseClient?.from('materiais').delete().eq('user_id', window.currentUser?.id)
    .then(({ error }) => { if (error) console.warn('[Supabase] Falha ao limpar materiais na nuvem:', error); });
}

// Exporta a Padronização de Materiais para uma planilha Excel (.xlsx),
// somente com as colunas usadas na reimportação (ver parseMateriaisRows) —
// "Criado em" e campos internos (id/importId) ficam de fora de propósito,
// já que são regenerados automaticamente ao reimportar.
function exportarMateriaisExcel() {
  if (!state.materiais.length) { toast('Nenhum material cadastrado para exportar', 'error'); return; }
  if (typeof XLSX === 'undefined') { toast('Biblioteca XLSX não carregada.', 'error'); return; }

  const rows = state.materiais.map(m => ({
    'Origem': m.origem || '',
    'Grupo SAP': m.alias || '',
    'Cód SAP': m.codSap || '',
    'Categoria': m.categoria || ''
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Materiais');
  XLSX.writeFile(wb, `padronizacao_materiais_${new Date().toISOString().slice(0, 10)}.xlsx`);
  toast(`${rows.length} material(is) exportado(s)`);
}


// ═══════════════════════════════════════════════════════════════════════
// CADASTRO INDIVIDUAL DE CENTRAIS — campos digitados, múltiplas linhas
// ═══════════════════════════════════════════════════════════════════════
let _filIndivRowSeq = 0;

// Abre o modal de Cadastro Individual de Centrais. Aceita um objeto de
// pré-preenchimento opcional — { origem, alias, cnpj, regional, focus } —
// usado pelo atalho de "central sem cadastro" no painel de pendências de
// padronização (Dashboard).
function abrirCadastroFilialIndividual(prefill) {
  const container = document.getElementById('filial-indiv-rows');
  if (!container) return;
  container.innerHTML = '';
  _filIndivRowSeq = 0;
  _addFilialIndivRow();
  _setModalCadastroModo({ modalId: 'modal-filiais-individual', btnId: 'btn-salvar-filial-indiv', icone: 'ti-map-pin', singular: 'Central', plural: 'Centrais', editando: false });
  openModal('modal-filiais-individual');

  const row = container.querySelector('.reg-individual-row');
  if (prefill && row) {
    const origemInput   = row.querySelector('[data-field="origem"]');
    const aliasInput    = row.querySelector('[data-field="alias"]');
    const cnpjInput     = row.querySelector('[data-field="cnpj"]');
    const regionalInput = row.querySelector('[data-field="regional"]');
    if (origemInput)   origemInput.value   = prefill.origem   || '';
    if (aliasInput)    aliasInput.value    = prefill.alias    || '';
    if (cnpjInput)     cnpjInput.value     = prefill.cnpj     || '';
    if (regionalInput) regionalInput.value = prefill.regional || '';
  }

  setTimeout(() => {
    const focusField = prefill?.focus || 'origem';
    (row?.querySelector(`[data-field="${focusField}"]`) || container.querySelector('input'))?.focus();
  }, 50);
}

// Mesmo modal, mas com uma linha por pendência (botão "Cadastrar Todos" do
// alerta de padronização, dashboard.js) — poupa o analista de abrir/fechar
// o modal uma central de cada vez; só falta digitar a Sigla de cada linha.
function abrirCadastroFiliaisEmLote(nomes) {
  const container = document.getElementById('filial-indiv-rows');
  if (!container || !nomes?.length) return;
  container.innerHTML = '';
  _filIndivRowSeq = 0;
  nomes.forEach(nome => {
    _addFilialIndivRow();
    container.lastElementChild.querySelector('[data-field="origem"]').value = nome;
  });
  _setModalCadastroModo({ modalId: 'modal-filiais-individual', btnId: 'btn-salvar-filial-indiv', icone: 'ti-map-pin', singular: 'Central', plural: 'Centrais', editando: false });
  openModal('modal-filiais-individual');
  setTimeout(() => container.querySelector('.reg-individual-row [data-field="alias"]')?.focus(), 50);
}

// ── Edição (individual e em massa) — mesmo padrão de abrirEdicaoMateriais*
// (ver comentário lá). Filiais não têm id local estável, então a linha
// carrega a chave original (origem+alias) direto do registro.
function abrirEdicaoFilial(pagedIndex) {
  const { data } = getListPageData('filiais');
  const rec = data[pagedIndex];
  if (!rec) { toast('Central não encontrada', 'error'); return; }
  abrirEdicaoFiliaisEmLote([rec]);
}

function abrirEdicaoFiliaisSelecionados() {
  const chaves = new Set([...document.querySelectorAll('#tb-filiais .chk-filiais-row:checked')].map(el => el.value));
  if (!chaves.size) { toast('Selecione ao menos uma central para editar', 'error'); return; }
  const recs = state.filiais.filter(f => chaves.has(filialMatchKey(f)));
  abrirEdicaoFiliaisEmLote(recs);
}

function abrirEdicaoFiliaisEmLote(recs) {
  const container = document.getElementById('filial-indiv-rows');
  if (!container || !recs?.length) return;
  container.innerHTML = '';
  _filIndivRowSeq = 0;
  recs.forEach(rec => {
    _addFilialIndivRow();
    const row = container.lastElementChild;
    row.dataset.editOrigemOrig = rec.origem || '';
    row.dataset.editAliasOrig = rec.alias || '';
    row.querySelector('[data-field="origem"]').value = rec.origem || '';
    row.querySelector('[data-field="alias"]').value = rec.alias || '';
    row.querySelector('[data-field="cnpj"]').value = rec.cnpj || '';
    if (rec.regional) row.querySelector('[data-field="regional"]').value = rec.regional;
  });
  _setModalCadastroModo({ modalId: 'modal-filiais-individual', btnId: 'btn-salvar-filial-indiv', icone: 'ti-map-pin', singular: 'Central', plural: 'Centrais', editando: true, qtd: recs.length });
  openModal('modal-filiais-individual');
  setTimeout(() => container.querySelector('input')?.focus(), 50);
}

function toggleSelecionarTodosFiliais(checked) {
  document.querySelectorAll('#tb-filiais .chk-filiais-row').forEach(el => { el.checked = checked; });
}

// ═══════════════════════════════════════════════════════════════════════
// CATÁLOGO DE REGIONAIS — usado no dropdown "Regional" do cadastro de
// Centrais. Mesmo padrão do catálogo de Grupos SAP (ver acima): combina os
// regionais cadastrados manualmente (state.regionaisCentrais, persistente)
// com os regionais já em uso em state.filiais.
// ═══════════════════════════════════════════════════════════════════════

function registrarRegionalCentral(nome) {
  const regional = String(nome || '').trim();
  if (!regional) return;
  if (!Array.isArray(state.regionaisCentrais)) state.regionaisCentrais = [];
  const key = normalizeText(regional);
  const jaExiste = state.regionaisCentrais.some(r => normalizeText(r) === key);
  if (!jaExiste) {
    state.regionaisCentrais.push(regional);
    if (window.supabaseClient) {
      window.supabaseClient.from('regionais_centrais').upsert({ nome: regional }, { onConflict: 'user_id,nome' })
        .then(({ error }) => { if (error) console.warn('[Supabase] Falha ao sincronizar regional:', error); });
    }
  }
}

function getRegionaisCentraisDisponiveis() {
  const vistos = new Map();
  const add = nome => {
    const regional = String(nome || '').trim();
    if (!regional) return;
    const key = normalizeText(regional);
    if (!vistos.has(key)) vistos.set(key, regional);
  };
  (state.regionaisCentrais || []).forEach(add);
  (state.filiais || []).forEach(f => add(f?.regional));
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function _rebuildRegionaisCentraisOptions(selectEl, novoValor) {
  if (!selectEl) return;
  const valorAtual = novoValor !== undefined ? novoValor : selectEl.value;
  const options = getRegionaisCentraisDisponiveis()
    .map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');
  selectEl.innerHTML = `<option value="">—</option>${options}`;
  selectEl.value = valorAtual;
}

function _refreshRegionaisCentraisSelects() {
  document.querySelectorAll('#filial-indiv-rows [data-field="regional"]').forEach(sel => _rebuildRegionaisCentraisOptions(sel));
}

// ── Mini modal "Novo Regional" ──────────────────────────────────────────
let _novoRegionalCentralTarget = null; // <select> da linha que abriu o mini modal

function abrirNovoRegionalCentral(btn) {
  const row = btn.closest('.reg-individual-row');
  _novoRegionalCentralTarget = row?.querySelector('[data-field="regional"]') || null;
  setVal('novo-regional-central-nome', '');
  openModal('modal-novo-regional-central');
  setTimeout(() => document.getElementById('novo-regional-central-nome')?.focus(), 50);
}

async function salvarNovoRegionalCentral(btn) {
  const nomeDigitado = val('novo-regional-central-nome').trim();
  if (!nomeDigitado) { toast('Informe o nome do regional', 'error'); return; }

  const key = normalizeText(nomeDigitado);
  const existente = getRegionaisCentraisDisponiveis().find(r => normalizeText(r) === key);
  const nomeFinal = existente || nomeDigitado;

  _setBtnLoading(btn, true, 'Salvando...');
  if (!existente) {
    registrarRegionalCentral(nomeDigitado);
    await persistStateNow();
  }
  _refreshRegionaisCentraisSelects();
  if (_novoRegionalCentralTarget) _novoRegionalCentralTarget.value = nomeFinal;
  _novoRegionalCentralTarget = null;
  _setBtnLoading(btn, false);
  closeModal('modal-novo-regional-central');
  toast(existente ? `Regional "${nomeFinal}" já existia — selecionado` : `Regional "${nomeFinal}" cadastrado`);
}

function _addFilialIndivRow() {
  const container = document.getElementById('filial-indiv-rows');
  if (!container) return;
  const id = _filIndivRowSeq++;
  const regionalOptions = getRegionaisCentraisDisponiveis()
    .map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');
  const row = document.createElement('div');
  row.className = 'reg-individual-row reg-row-filiais';
  row.dataset.rowId = id;
  row.innerHTML = `
    <div class="form-group">
      <label class="form-label">Original</label>
      <input type="text" class="form-input" data-field="origem" placeholder="Nome bruto (como vem na importação)">
    </div>
    <div class="form-group">
      <label class="form-label">Sigla</label>
      <input type="text" class="form-input" data-field="alias" placeholder="SET1">
    </div>
    <div class="form-group">
      <label class="form-label">CNPJ</label>
      <input type="text" class="form-input" data-field="cnpj" placeholder="00.000.000/0000-00">
    </div>
    <div class="form-group">
      <label class="form-label">Regional</label>
      <div style="display:flex; gap:6px">
        <select class="form-select" data-field="regional" style="flex:1; min-width:0">
          <option value="">—</option>
          ${regionalOptions}
        </select>
        <button type="button" class="btn" title="Cadastrar novo Regional" onclick="abrirNovoRegionalCentral(this)" style="flex:0 0 auto; padding:0 12px"><i class="ti ti-plus"></i></button>
      </div>
    </div>
    <div class="reg-row-remove" title="Remover esta linha" onclick="_removeIndivRow(this)"><i class="ti ti-x"></i></div>
  `;
  container.appendChild(row);
}

async function salvarFiliaisIndividual(btn) {
  const container = document.getElementById('filial-indiv-rows');
  if (!container) return;
  const rows = [...container.querySelectorAll('.reg-individual-row')];
  const toCreate = [];
  const toEdit = [];
  rows.forEach(row => {
    const origem   = row.querySelector('[data-field="origem"]')?.value.trim()   || '';
    const alias    = row.querySelector('[data-field="alias"]')?.value.trim()    || '';
    const cnpj     = row.querySelector('[data-field="cnpj"]')?.value.trim()     || '';
    const regional = row.querySelector('[data-field="regional"]')?.value.trim() || '';
    if (!origem || !alias) return; // linha em branco ou incompleta — ignora silenciosamente
    if (row.dataset.editOrigemOrig !== undefined) {
      toEdit.push({ origem, alias, cnpj, regional, origemOriginal: row.dataset.editOrigemOrig, aliasOriginal: row.dataset.editAliasOrig });
    } else {
      toCreate.push({ origem, alias, cnpj, regional, created: new Date().toLocaleDateString('pt-BR') });
    }
  });

  if (!toCreate.length && !toEdit.length) { toast('Preencha ao menos um cadastro completo (Original + Sigla)', 'error'); return; }

  _setBtnLoading(btn, true, 'Salvando...');
  if (toCreate.length) upsertFiliais(toCreate);
  if (toEdit.length) editarFiliais(toEdit);
  closeModal('modal-filiais-individual');
  _setBtnLoading(btn, false);
  reaplicarPadronizacaoCentrais();
  await persistStateNow();
  renderAll();
  updateImportPrereqUI();
  const msg = toEdit.length && !toCreate.length ? `${toEdit.length} filial(is) atualizada(s)`
    : toCreate.length && !toEdit.length ? `${toCreate.length} filial(is) cadastrada(s)`
    : `${toCreate.length + toEdit.length} filial(is) salva(s)`;
  toast(msg);
}

// Atualiza cadastros existentes EM PLACE — mesmo motivo de editarMateriais:
// upsertFiliais trata a chave ATUAL como identidade e duplicaria o registro
// se Original ou Sigla mudou; aqui a identidade é a chave ANTES da edição.
function editarFiliais(items) {
  (items || []).forEach(item => {
    const idx = state.filiais.findIndex(f => normalizeText(f.origem) === normalizeText(item.origemOriginal) && normalizeText(f.alias) === normalizeText(item.aliasOriginal));
    if (idx < 0) return;
    const rec = { ...state.filiais[idx], origem: item.origem, alias: item.alias, cnpj: item.cnpj, regional: item.regional };
    state.filiais[idx] = rec;
    registrarRegionalCentral(rec.regional);
    _filiaisSyncUpdate(item.origemOriginal, item.aliasOriginal, rec);
  });
  invalidateFilialLookup();
}

// UPDATE em vez de upsert — mesmo motivo de _materiaisSyncUpdate: o
// onConflict do upsert usa a chave ATUAL e cria duplicata se Original/Sigla
// mudou, e a policy de INSERT de filiais exige user_id = auth.uid() sem
// bypass de admin (só UPDATE tem), então um Supervisor editando a central
// de outro usuário não conseguiria inserir/conflitar — só atualizar.
function _filiaisSyncUpdate(oldOrigem, oldAlias, rec) {
  if (!window.supabaseClient) return;
  const ownerId = rec.donoId || window.currentUser?.id;
  if (!ownerId) return;
  window.supabaseClient.from('filiais')
    .update({ origem: rec.origem, alias: rec.alias, cnpj: rec.cnpj || null, regional: rec.regional || null })
    .eq('user_id', ownerId).eq('origem', oldOrigem).eq('alias', oldAlias)
    .then(({ error }) => { if (error) console.warn('[Supabase] Falha ao atualizar filial:', error); });
}

// Chave natural de filial — mesma composição do onConflict do Supabase
// (user_id, origem, alias) — usada tanto pro upsert quanto pro merge no
// boot (ver syncFiliaisFromSupabase).
function filialMatchKey(item) {
  return [normalizeText(item?.origem), normalizeText(item?.alias)].join('||');
}

// Sincroniza com Supabase TODO cadastro de filial — manual ou importado em
// lote (Fase 4, Etapa 2; até aqui só o manual sincronizava). Guarda
// import_id na nuvem para a futura etapa de exclusão em cascata (Fase 4,
// Etapa 7). Falha não bloqueia a UI.
function _filiaisSyncUpsert(rec) {
  if (!window.supabaseClient) return;
  window.supabaseClient.from('filiais')
    .upsert({ origem: rec.origem, alias: rec.alias, cnpj: rec.cnpj || null, regional: rec.regional || null, import_id: rec.importId || null, origem_usuario_id: rec.importadoDeId || null }, { onConflict: 'user_id,origem,alias' })
    .then(({ error }) => { if (error) console.warn('[Supabase] Falha ao sincronizar filial:', error); });
}

// Upsert em lote — sincronização inicial dos registros locais que ainda não
// subiram pra nuvem. Mesmo padrão de _materiaisSyncUpsertBatch.
async function _filiaisSyncUpsertBatch(recs) {
  if (!window.supabaseClient || !recs || !recs.length) return;
  const rows = recs.map(rec => ({ origem: rec.origem, alias: rec.alias, cnpj: rec.cnpj || null, regional: rec.regional || null, import_id: rec.importId || null, origem_usuario_id: rec.importadoDeId || null }));
  for (let i = 0; i < rows.length; i += CADASTRO_SYNC_BATCH_SIZE) {
    const { error } = await window.supabaseClient.from('filiais').upsert(rows.slice(i, i + CADASTRO_SYNC_BATCH_SIZE), { onConflict: 'user_id,origem,alias' });
    if (error) { console.warn('[Supabase] Falha ao sincronizar lote de filiais:', error); break; }
  }
}

// Busca no boot — mescla por chave natural (origem+alias), nuvem tem
// prioridade em conflito (mesmo motivo de syncMateriaisFromSupabase: um
// union simples duplicaria registros recém-sincronizados agora que a nuvem
// também recebe cadastro importado). Depois do merge, sobe pra nuvem
// qualquer filial local ainda não sincronizada (self-heal da base já
// existente).
//
// CORREÇÃO: mesma causa raiz de Materiais/Configs — coluna real é
// created_at, não created (erro "column filiais.created does not exist").
async function syncFiliaisFromSupabase() {
  try {
    // BUG REAL (04/08) — ver syncMateriaisFromSupabase pro mesmo motivo:
    // Configurações agora mostra só o cadastro do próprio dono; ver o de
    // outro usuário é opt-in via "Importar de". Supervisão continua
    // irrestrita (não passa por aqui).
    const { data, error } = await window.supabaseClient.from('filiais')
      .select('user_id, origem, alias, cnpj, regional, import_id, created_at, origem_usuario_id')
      .eq('user_id', window.currentUser?.id);
    if (error) throw error;
    // O BANCO MANDA (30/07) — ver syncMateriaisFromSupabase pro mesmo motivo:
    // o self-heal daqui desfazia exclusão feita pelo painel de Supervisão.
    const local = Array.isArray(state.filiais) ? state.filiais : [];
    const porChaveLocal = new Map(local.map(f => [filialMatchKey(f), f]));
    state.filiais = (data || []).map(r => {
      const existenteLocal = porChaveLocal.get(filialMatchKey(r));
      return {
        // donoId: mesmo motivo de syncMateriaisFromSupabase — usado por
        // _filiaisSyncUpdate() quando o Supervisor edita a central de outro.
        donoId: r.user_id,
        importadoDeId: r.origem_usuario_id || undefined,
        origem: r.origem, alias: r.alias, cnpj: r.cnpj, regional: r.regional,
        importId: r.import_id || undefined,
        created: r.created_at ? new Date(r.created_at).toLocaleDateString('pt-BR') : (existenteLocal?.created || new Date().toLocaleDateString('pt-BR')),
      };
    });
    invalidateFilialLookup();
    if (window.currentUser?.role === 'admin') await _checarNovosParaImportar('filiais');
  } catch (err) {
    console.warn('[Supabase] Falha ao buscar filiais — mantendo dados locais.', err);
  }
}

function upsertFiliais(items) {
  (items || []).forEach(item => {
    const src = item && typeof item === 'object' ? item : {};
    const key = normalizeText(src.origem);
    const aliasKey = normalizeText(src.alias);
    const idx = state.filiais.findIndex(f => normalizeText(f.origem) === key || normalizeText(f.alias) === aliasKey);
    const rec = {
      donoId: src.donoId || window.currentUser?.id,
      ...src,
      created: src.created || new Date().toLocaleDateString('pt-BR')
    };
    if (idx >= 0) state.filiais[idx] = rec; else state.filiais.unshift(rec);
    // Mantém o catálogo de Regionais em sincronia — cobre tanto o cadastro
    // guiado quanto a importação por arquivo (handleFiliaisImport).
    registrarRegionalCentral(rec.regional);
    _filiaisSyncUpsert(rec);
  });
  invalidateFilialLookup();
}

function parseFiliaisRows(rows) {
  const cleaned = (rows || []).filter(row => Array.isArray(row) && row.some(c => c !== '' && c !== null && c !== undefined));
  if (!cleaned.length) return [];

  const norm = v => normalizeText(v);
  const header = cleaned[0].map(norm);

  const findIdx = (...names) => {
    for (const name of names) {
      const idx = header.findIndex(h => h === norm(name));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const headerLooksLikeMeta = header.some(h => [
    'ORIGEM', 'ORIGINAL', 'ALIAS', 'SIGLA', 'DESCRICAO', 'DESCRIÇÃO', 'FILIAL', 'CENTRAL', 'CNPJ', 'REGIONAL'
  ].includes(h));

  let startRow = 0;
  let origemIdx = 0;
  let aliasIdx = 1;
  let cnpjIdx = 2;
  let regionalIdx = 3;

  if (headerLooksLikeMeta) {
    startRow = 1;
    origemIdx   = findIdx('origem', 'original', 'central', 'filial', 'central origem', 'central original');
    aliasIdx    = findIdx('alias', 'sigla', 'padronizada', 'central padrão', 'central padrao');
    cnpjIdx     = findIdx('cnpj', 'cpf cnpj', 'documento');
    regionalIdx = findIdx('regional', 'regiao', 'região', 'responsavel', 'responsável', 'gestor');
    if (origemIdx < 0) origemIdx = 0;
    if (aliasIdx < 0) aliasIdx = 1;
    if (cnpjIdx < 0) cnpjIdx = 2;
    if (regionalIdx < 0) regionalIdx = 3;
  }

  return cleaned.slice(startRow).map(row => ({
    origem:   String(row[origemIdx]   || '').trim(),
    alias:    String(row[aliasIdx]    || '').trim(),
    cnpj:     String(row[cnpjIdx]     || '').trim(),
    regional: String(row[regionalIdx] || '').trim(),
    created: new Date().toLocaleDateString('pt-BR')
  })).filter(r => r.origem && r.alias);
}

async function handleFiliaisImport(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (typeof XLSX === 'undefined') {
    toast('Biblioteca XLSX não carregada.', 'error');
    return;
  }

  showLoadingOverlay('Importando centrais', 'Lendo o arquivo de filiais...');
  if (typeof loadingShowSteps === 'function') loadingShowSteps([
    { id: 'fil-read',  icon: 'ti-file-spreadsheet', label: 'Lendo o arquivo' },
    { id: 'fil-parse', icon: 'ti-transform',         label: 'Processando cadastros' },
    { id: 'fil-save',  icon: 'ti-device-floppy',     label: 'Salvando no banco local' },
  ]);

  const fileName = file.name.toLowerCase();
  const reader = new FileReader();

  reader.onload = async function(e) {
    try {
      _lstepSet('fil-read', 'running'); _lbarSet(15);
      updateLoadingOverlay('Separando os registros de centrais...', 'Importando centrais');
      let rows = [];

      if (fileName.endsWith('.csv')) {
        const wb = XLSX.read(String(e.target.result || ''), { type: 'string', raw: true });
        // BLINDAGEM (28/07): mesma proteção aplicada na importação dos 5
        // módulos grandes (dashboard.js) — ver comentário lá para o
        // contexto completo do problema real que motivou isto.
        if (!wb.Sheets[wb.SheetNames[0]]) {
          throw new Error('Não foi possível localizar os dados da planilha neste arquivo. Tente reexportar e importar de novo.');
        }
        const ws = sanitizeWorksheet(wb.Sheets[wb.SheetNames[0]]);
        rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      } else {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: false });
        if (!wb.Sheets[wb.SheetNames[0]]) {
          throw new Error('Não foi possível localizar os dados da planilha neste arquivo. Tente reexportar e importar de novo.');
        }
        const ws = sanitizeWorksheet(wb.Sheets[wb.SheetNames[0]]);
        rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      }

      _lstepSet('fil-read', 'done'); _lstepSet('fil-parse', 'running'); _lbarSet(45);
      const items = parseFiliaisRows(rows);

      if (!items.length) {
        toast('Arquivo sem cadastros válidos', 'error');
        hideLoadingOverlay('Falha');
        if (typeof loadingHideSteps === 'function') loadingHideSteps();
        return;
      }

      const importId = `cad_centrais_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

      _lstepSet('fil-parse', 'done'); _lstepSet('fil-save', 'running'); _lbarSet(75);
      updateLoadingOverlay('Atualizando cadastros salvos...', 'Importando centrais');
      upsertFiliais(items.map(item => normalizeImportedFilial(item, importId)));
      state.imports.unshift({
        id: importId, arquivo: file.name, modulo: 'Centrais',
        registros: items.length, dataHora: new Date().toLocaleString('pt-BR'),
        status: 'Importado', createdAt: Date.now()
      });
      reaplicarPadronizacaoCentrais();
      await persistStateNow();
      _lstepSet('fil-save', 'done'); _lbarSet(100);
      renderAll();
      closeModal('modal-filiais-individual');
      hideLoadingOverlay('Centrais importadas');
      if (typeof loadingHideSteps === 'function') loadingHideSteps();
      toast(`${items.length} filial(is) importada(s)`);
      event.target.value = '';
    } catch (err) {
      console.error(err);
      toast('Falha ao importar filiais: ' + (err?.message || 'erro desconhecido'), 'error');
    } finally {
      if (typeof loadingHideSteps === 'function') loadingHideSteps();
      hideLoadingOverlay('Importação concluída');
    }
  };

  reader.onerror = () => {
    toast('Não foi possível ler o arquivo selecionado', 'error');
    hideLoadingOverlay('Falha na importação');
  };

  if (fileName.endsWith('.csv')) reader.readAsText(file, 'utf-8');
  else reader.readAsArrayBuffer(file);
}

function focusFilialImport() {
  document.getElementById('file-filiais')?.click();
}

async function removerFilial(pagedIndex) {
  const { data } = getListPageData('filiais');
  const rec = data[pagedIndex];
  if (!rec) return;
  const idx = state.filiais.indexOf(rec);
  if (idx < 0) return;

  if (!confirm(`Excluir a central "${rec.origem}"?`)) return;

  const snapshot = { ...rec };
  const originalIndex = idx;

  confirmarComUndo({
    message: `Central "${rec.origem}" excluída`,
    action: () => {
      const curIdx = state.filiais.indexOf(rec);
      if (curIdx >= 0) state.filiais.splice(curIdx, 1);
      invalidateFilialLookup();
      reaplicarPadronizacaoCentrais();
      persist();
      renderAll();
      updateImportPrereqUI();
      // Delete no Supabase é inofensivo mesmo se o registro nunca tiver
      // sido sincronizado (veio de importação em lote) — não acha nada.
      // Escopado ao próprio user_id (ver _supaDeleteOwned, normalize.js):
      // origem+alias sozinhos colidem entre contas.
      _supaDeleteOwned('filiais', { origem: snapshot.origem, alias: snapshot.alias })
        .then(({ error }) => { if (error) console.warn('[Supabase] Falha ao excluir filial na nuvem:', error); });
    },
    undo: () => {
      const insertAt = originalIndex >= 0 && originalIndex <= state.filiais.length
        ? originalIndex
        : 0;
      state.filiais.splice(insertAt, 0, snapshot);
      invalidateFilialLookup();
      reaplicarPadronizacaoCentrais();
      persist();
      renderAll();
      updateImportPrereqUI();
      _filiaisSyncUpsert(snapshot);
    },
  });
}

async function limparFiliais() {
  if (!state.filiais.length) return toast('Nenhuma filial cadastrada', 'error');
  if (!confirm('Excluir todas as filiais cadastradas?')) return;
  state.filiais = [];
  invalidateFilialLookup();
  reaplicarPadronizacaoCentrais();
  await persistStateNow();
  renderAll();
  updateImportPrereqUI();
  toast('Todas as filiais foram excluídas', 'error');
  window.supabaseClient?.from('filiais').delete().eq('user_id', window.currentUser?.id)
    .then(({ error }) => { if (error) console.warn('[Supabase] Falha ao limpar filiais na nuvem:', error); });
}

// Exporta a Padronização de Centrais para uma planilha Excel (.xlsx),
// somente com as colunas usadas na reimportação (ver parseFiliaisRows) —
// "Criado em" e campos internos (importId) ficam de fora de propósito, já
// que são regenerados automaticamente ao reimportar.
function exportarFiliaisExcel() {
  if (!state.filiais.length) { toast('Nenhuma central cadastrada para exportar', 'error'); return; }
  if (typeof XLSX === 'undefined') { toast('Biblioteca XLSX não carregada.', 'error'); return; }

  const rows = state.filiais.map(f => ({
    'Origem': f.origem || '',
    'Sigla': f.alias || '',
    'CNPJ': f.cnpj || '',
    'Regional': f.regional || ''
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Centrais');
  XLSX.writeFile(wb, `padronizacao_centrais_${new Date().toISOString().slice(0, 10)}.xlsx`);
  toast(`${rows.length} central(is) exportada(s)`);
}

// ═══════════════════════════════════════════════════════════
// AÇÕES DE RELATÓRIO — regras para o Relatório com Ações
// ═══════════════════════════════════════════════════════════

function makeAcaoId() {
  return 'AR-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

// Busca as ações de relatório do Supabase e substitui state.acoesRelatorio —
// chamada no boot (ver restoreAndRender em dashboard.js, dentro do STEP 1).
// Em caso de falha de rede, mantém o que já foi carregado do IndexedDB local
// como fallback, em vez de zerar a lista.
async function syncAcoesRelatorioFromSupabase() {
  try {
    const { data, error } = await window.supabaseClient
      .from('acoes_relatorio')
      .select('id, user_id, categorias, nivel, acoes, created')
      .order('created', { ascending: false });
    if (error) throw error;

    // O BANCO MANDA — mesmo padrão já aplicado nos outros módulos em 30/07.
    // O self-heal que existia aqui (mesclar local ∪ nuvem e reenviar o que
    // sobrasse só local) reenviava pro banco uma ação de relatório que
    // tivesse sido apagada pelo painel de Supervisão. Erro de busca cai no
    // catch e preserva o que já foi carregado do IndexedDB.
    state.acoesRelatorio = data || [];
  } catch (err) {
    console.warn('[Supabase] Falha ao buscar acoesRelatorio — mantendo dados locais.', err);
  }
}

function abrirModalAcaoRelatorio(id) {
  const item = id ? (state.acoesRelatorio || []).find(a => a.id === id) : null;

  let modal = document.getElementById('modal-acoes-relatorio');
  if (!modal) return;

  // Reseta checkboxes
  modal.querySelectorAll('.ar-cat-cb').forEach(cb => { cb.checked = false; });

  // Preenche campos se for edição
  document.getElementById('ar-id').value    = item?.id || '';
  document.getElementById('ar-nivel').value = item?.nivel || '';
  document.getElementById('ar-acoes').value = item?.acoes || '';

  // Marca categorias salvas
  if (item?.categorias && Array.isArray(item.categorias)) {
    item.categorias.forEach(cat => {
      const cb = modal.querySelector(`.ar-cat-cb[value="${cat}"]`);
      if (cb) cb.checked = true;
    });
  }

  document.getElementById('ar-modal-title').textContent = item ? 'Editar Ação' : 'Nova Ação de Relatório';

  openModal('modal-acoes-relatorio');
}

async function salvarAcaoRelatorio() {
  const id    = val('ar-id');
  const nivel = val('ar-nivel');
  const acoes = val('ar-acoes').trim();

  // Lê categorias marcadas
  const categorias = [...document.querySelectorAll('.ar-cat-cb:checked')].map(cb => cb.value);

  if (!categorias.length) { toast('Selecione ao menos uma categoria', 'error'); return; }
  if (!nivel)             { toast('Selecione o nível de criticidade', 'error'); return; }
  if (!acoes)             { toast('Informe as ações propostas', 'error'); return; }

  const rec = {
    id:         id || makeAcaoId(),
    categorias,
    nivel,
    acoes,
    created: new Date().toLocaleDateString('pt-BR')
  };

  if (!Array.isArray(state.acoesRelatorio)) state.acoesRelatorio = [];
  const idx = state.acoesRelatorio.findIndex(a => a.id === rec.id);
  if (idx >= 0) state.acoesRelatorio[idx] = rec;
  else state.acoesRelatorio.unshift(rec);

  renderAcoesRelatorio();
  toast(idx >= 0 ? 'Ação atualizada' : 'Ação cadastrada');
  closeModal('modal-acoes-relatorio');
  persist(); // fallback local (IndexedDB) — mantém funcionamento offline

  const { error } = await window.supabaseClient.from('acoes_relatorio').upsert(rec);
  if (error) {
    console.warn('[Supabase] Falha ao salvar ação de relatório:', error);
    toast('⚠ Salvo nesta sessão, mas não foi possível sincronizar com a nuvem.', 'error');
  }
}

function editarAcaoRelatorio(id) {
  abrirModalAcaoRelatorio(id);
}

async function removerAcaoRelatorio(id) {
  if (!confirm('Excluir esta ação de relatório?')) return;
  if (!Array.isArray(state.acoesRelatorio)) return;
  const idx = state.acoesRelatorio.findIndex(a => a.id === id);
  if (idx < 0) return;
  state.acoesRelatorio.splice(idx, 1);
  renderAcoesRelatorio();
  toast('Ação removida', 'error');
  persist(); // fallback local (IndexedDB)

  // id é gerado por timestamp+random (não UUID) — escopado ao próprio
  // user_id (ver _supaDeleteOwned, normalize.js) por segurança.
  const { error } = await _supaDeleteOwned('acoes_relatorio', { id });
  if (error) {
    console.warn('[Supabase] Falha ao excluir ação de relatório:', error);
    toast('⚠ Removida nesta sessão, mas não foi possível sincronizar com a nuvem.', 'error');
  }
}

async function limparAcoesRelatorio() {
  if (!(state.acoesRelatorio || []).length) return toast('Nenhuma ação cadastrada', 'error');
  if (!confirm('Excluir todas as ações de relatório?')) return;
  state.acoesRelatorio = [];
  renderAcoesRelatorio();
  toast('Todas as ações foram excluídas', 'error');
  persist(); // fallback local (IndexedDB)

  const { error } = await window.supabaseClient.from('acoes_relatorio').delete().eq('user_id', window.currentUser?.id);
  if (error) {
    console.warn('[Supabase] Falha ao limpar ações de relatório:', error);
    toast('⚠ Removidas nesta sessão, mas não foi possível sincronizar com a nuvem.', 'error');
  }
}

// ═══════════════════════════════════════════════════════════
// DASHBOARD GERENCIAL — strip KPI analítico (sem filtro de período)
// ═══════════════════════════════════════════════════════════
