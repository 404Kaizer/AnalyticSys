'use strict';

// ═══════════════════════════════════════════════════════════
// OCORRÊNCIAS — módulo completo
// ═══════════════════════════════════════════════════════════

// ── Estado local (persistido no state global) ─────────────
function getOcorrencias() {
  if (!Array.isArray(state.ocorrencias)) state.ocorrencias = [];
  return state.ocorrencias;
}

// Nome de quem está executando a ação AGORA (31/07) — usado em todo evento
// de hierarquia (escalonar) e mudança de status (concluir/reabrir/marcar
// inconclusiva/descalonar), pra notificação e histórico citarem QUEM fez,
// não só "o Supervisor". Snapshot automático (nunca um campo de
// formulário) — diferente de `responsavel` (texto livre, já existia,
// significa "responsável por aquele nível", não "quem clicou").
function _ocNomeAtor() {
  return window.currentUser?.nome_completo || window.currentUser?.email || null;
}

// Token legível derivado do PRIMEIRO NOME do usuário — usado no número de
// exibição pra dar pra distinguir quem criou o quê quando o mesmo "OC-N"
// existe em mais de uma conta (Ocorrências continua mostrando todo mundo
// junto pro ADM, por decisão de 28/07 — "sem mudança" nos itens
// 11,12,14,15,17). 31/07: trocado de "4 letras do e-mail" (ex. "MAYC")
// pro primeiro nome inteiro (ex. "MAYCON") — mesma normalização (NFD +
// remove acento) já usada no resto do sistema pra nomes de central/material.
function _ocUserToken(nomeCompleto, email) {
  const primeiroNome = String(nomeCompleto || '').trim().split(/\s+/)[0] || '';
  const base = primeiroNome || String(email || '').split('@')[0] || '';
  const clean = base.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return clean || 'USR';
}

// Registros antigos sem `numero`/sem e-mail resolvível (ex.: backfill no
// boot do ADM, olhando ocorrência de outra conta) caem aqui — token
// estável por conta, derivado do próprio user_id, sem precisar resolver
// e-mail de terceiros de forma síncrona.
function _ocTokenFromUserId(userId) {
  return 'U' + String(userId || '').replace(/-/g, '').slice(0, 4).toUpperCase();
}

// CORREÇÃO (28/07) — bug de colisão de ids entre contas: _nextOcId()
// contava só a partir do estado LOCAL de cada dispositivo/conta, então
// contas diferentes geravam o mesmo "OC-N" de forma independente. Como
// `id` é a chave primária da tabela compartilhada `ocorrencias` (sem
// nenhum escopo por usuário), isso causava upsert falhando por RLS
// (upload pra nuvem) e sobrescrita silenciosa em memória durante o merge
// por id (syncOcorrenciasFromSupabase) — ocorrências de contas diferentes
// com o mesmo "OC-N" se substituíam uma à outra.
//
// A partir de agora, _nextOcId() NÃO é mais usado como chave primária —
// vira só o número de exibição (campo `numero`, cosmético). Passou a
// incorporar um token curto do criador (ex.: "OC-HUGO-5") — mesmo que o
// contador em si continue sendo por conta (não precisa mais ser globalmente
// único, já que não é chave), o ADM consegue ver de cara que "OC-HUGO-5" e
// "OC-MAYC-5" são de pessoas diferentes, em vez de dois "OC-5" idênticos.
// A chave real (`id`) vem de _ocGerarIdSeguro() — timestamp + sufixo
// aleatório, mesmo padrão já usado com segurança em ajustesSistemicos.id
// (dai.js), nunca colide. Registros antigos (de antes desta correção) não
// têm `numero` gravado — usam o próprio `id` (que já parecia "OC-N") como
// número de exibição, sem token, até serem editados ou passarem pelo
// preenchimento retroativo em persist.js.
function _nextOcId(tokenOverride) {
  const token = tokenOverride || _ocUserToken(window.currentUser?.nome_completo, window.currentUser?.email);
  const prefix = `OC-${token}-`;
  const lista = getOcorrencias();
  const nums = lista
    .map(o => {
      const label = String(o.numero || o.id || '');
      if (!label.startsWith(prefix)) return 0;
      const n = parseInt(label.slice(prefix.length), 10);
      return Number.isFinite(n) ? n : 0;
    })
    .filter(n => n > 0);
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return prefix + next;
}

function _ocGerarIdSeguro() {
  return 'oc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

// ── Sincronização com Supabase (Fase 2) ────────────────────
// Conversão entre o formato usado em memória (camelCase, igual ao resto do
// sistema) e as colunas da tabela ocorrencias (snake_case).
function _ocToDbRow(o) {
  return {
    id: o.id,
    // BUG REAL (31/07): faltava aqui. A coluna user_id tem
    // `default auth.uid()` — sem mandar explícito, um upsert de UMA
    // ocorrência de outro dono (Supervisor editando algo escalonado pra
    // ele) caía no default (o PRÓPRIO uid do Supervisor), e o
    // onConflict:'user_id,id' passava a mirar (meu_id, id) em vez de
    // (dono_real, id) — sem linha existente com essa combinação, o
    // upsert INSERIA uma cópia nova em vez de atualizar a original:
    // duplicava pro Supervisor e a edição nunca chegava no dono de
    // verdade. Mesmo fallback (o.userId || meuId) usado no resto do
    // arquivo pra ocorrência recém-criada, ainda sem round-trip.
    user_id: o.userId || window.currentUser?.id,
    numero: o.numero || null,
    data_abertura: o.dataAbertura || null,
    motivo: o.motivo || null,
    data_limite: o.dataLimite || null,
    central: o.central || null,
    material: o.material || null,
    operador: o.operador || null,
    contato: o.contato || null,
    descricao: o.descricao || null,
    concluida: !!o.concluida,
    data_conclusao: o.dataConclusao || null,
    desc_conclusao: o.descConclusao || null,
    inconclusiva: !!o.inconclusiva,
    data_inconclusiva: o.dataInconclusiva || null,
    motivo_inconclusiva: o.motivoInconclusiva || null,
    hierarquia: Array.isArray(o.hierarquia) ? o.hierarquia : [],
    ultima_acao_tipo: o.ultimaAcaoTipo || null,
    ultima_acao_por_nome: o.ultimaAcaoPorNome || null,
    criado_em: o.criadoEm || Date.now(),
    origem_ajuste_sistemico: !!o.origemAjusteSistemico,
    dai_id: o.daiId || null,
    dai_numero: o.daiNumero || null,
    dai_tag: o.daiTag || null,
    dai_item_id: o.daiItemId || null,
    criado_por_nome: o.criadoPorNome || null,
  };
}

function _ocFromDbRow(row) {
  return {
    id: row.id,
    numero: row.numero || null,
    userId: row.user_id || null,
    dataAbertura: row.data_abertura,
    motivo: row.motivo,
    dataLimite: row.data_limite,
    central: row.central,
    material: row.material,
    operador: row.operador,
    contato: row.contato,
    descricao: row.descricao,
    concluida: !!row.concluida,
    dataConclusao: row.data_conclusao,
    descConclusao: row.desc_conclusao,
    inconclusiva: !!row.inconclusiva,
    dataInconclusiva: row.data_inconclusiva,
    motivoInconclusiva: row.motivo_inconclusiva,
    hierarquia: Array.isArray(row.hierarquia) ? row.hierarquia : [],
    ultimaAcaoTipo: row.ultima_acao_tipo || null,
    ultimaAcaoPorNome: row.ultima_acao_por_nome || null,
    criadoEm: row.criado_em,
    origemAjusteSistemico: !!row.origem_ajuste_sistemico,
    daiId: row.dai_id,
    daiNumero: row.dai_numero,
    daiTag: row.dai_tag,
    daiItemId: row.dai_item_id,
    criadoPorNome: row.criado_por_nome || null,
  };
}

// Busca as ocorrências do Supabase e substitui state.ocorrencias — chamada
// no boot (ver restoreAndRender em dashboard.js). Mantém os dados locais
// como fallback se a rede falhar, em vez de zerar a lista.
async function syncOcorrenciasFromSupabase() {
  try {
    // fetchAllRows (paginação por cursor de id) — select('*') sem paginação
    // aqui tinha o mesmo risco já corrigido em Lançamentos/Entradas (teto de
    // 1000 linhas do PostgREST). Ordem de chegada não importa: a tela
    // sempre reordena via getOcorrenciasFiltradas() antes de renderizar.
    // FILTRO POR DONO (31/07) — reverte a exceção de 28/07 ("Redefinição da
    // Visão de ADM"), que deixava o ADM puxar as ocorrências de todo mundo
    // pro próprio estado e poluía a conta dele. Agora Ocorrências segue a
    // mesma regra dos demais módulos: as minhas + as que o ADM aceitou
    // integrar (record_integrations).
    // Para o usuário COMUM nada muda: a RLS da tabela já o restringe às
    // dele (user_id OR co_owners OR is_admin) — quem enxergava tudo era só
    // o ADM, via is_admin(). A tela de Supervisão continua vendo tudo, que
    // é o lugar certo pra visão completa.
    const data = await fetchMineOrIntegrated('ocorrencias');

    // Visão do Supervisor (31/07): fora do "própria + integrada" acima, o
    // Supervisor precisa ver automaticamente, sem aceite manual — (1) toda
    // ocorrência já escalonada pra ele ou acima (nível 2 = Supervisor do
    // Setor, 3 = Gerência) e (2) toda ocorrência de DAI, pública ou de
    // usuário autenticado — ambas já chegam aqui com
    // origem_ajuste_sistemico=true (ver dai.js e a Edge Function
    // solicitacao-dai). RLS já deixa o ADM ler a tabela inteira; isto só
    // decide o que entra automaticamente na tela de trabalho dele, sem
    // reviver o "vê tudo" que foi revertido acima.
    let combinadas = data;
    if (window.currentUser?.role === 'admin') {
      const todas = await fetchAllRows('ocorrencias');
      const jaIncluidas = new Set(data.map(r => `${r.user_id}|${r.id}`));
      const extras = todas.filter(r =>
        !jaIncluidas.has(`${r.user_id}|${r.id}`) && ocApareceAutoParaSupervisor(r)
      );
      combinadas = [...data, ...extras];
    }

    // CORREÇÃO (28/07) — bug de colisão de ids entre contas: mesclar só
    // por `id` deixava uma ocorrência de OUTRA conta sobrescrever a minha
    // em memória sempre que o "OC-N" batia (chave primária era só `id`,
    // sem escopo por usuário). Agora casa por (user_id, id) — mesmo escopo
    // da nova chave primária composta do banco — então só uma linha
    // realmente MINHA pode substituir a minha, mesmo o ADM vendo o array
    // inteiro de todo mundo. Registros locais sem `userId` resolvido ainda
    // (recém-criados nesta sessão, antes do primeiro round-trip) contam
    // como meus por padrão.
    const meuId = window.currentUser?.id;
    const chave = o => `${o.userId || meuId}|${o.id}`;

    const local = Array.isArray(state.ocorrencias) ? state.ocorrencias : [];
    const remoto = (combinadas || []).map(_ocFromDbRow);

    // O BANCO MANDA (30/07): antes isto fundia local ∪ nuvem e reenviava as
    // ocorrências que só existiam local, desfazendo exclusão feita em outro
    // dispositivo ou pelo painel de Supervisão.
    // Exceção necessária: ocorrência criada nesta sessão que ainda não
    // completou o round-trip (sem userId resolvido) ainda não está na nuvem
    // — descartá-la apagaria trabalho recém-feito na tela do usuário.
    const chavesRemotas = new Set(remoto.map(chave));
    const aindaSubindo = local.filter(o => o.id && !o.userId && !chavesRemotas.has(chave(o)));
    state.ocorrencias = [...remoto, ...aindaSubindo];
  } catch (err) {
    console.warn('[Supabase] Falha ao buscar ocorrencias — mantendo dados locais.', err);
  }
}

// ── Realtime (31/07) ────────────────────────────────────────────────────
// Mesma regra de relevância do fetch acima (mine + integrada + visão do
// Supervisor via ocApareceAutoParaSupervisor) aplicada evento a evento —
// pro usuário comum a RLS (dono OU co_owner OU is_admin) já restringe o
// que chega nesta subscription; pro ADM, sem este filtro o Realtime
// entregaria TODA ocorrência de TODO usuário (RLS libera is_admin() a ver
// tudo) e reviveria a poluição revertida em 31/07.
// Motivo, não só booleano — a notificação de prioridade (ver mais abaixo)
// só deve disparar quando o motivo for especificamente 'escalonamento' ou
// 'dai' (não 'proprio'/'integrado'/'rls', que já têm seus próprios avisos).
async function _ocMotivoRelevancia(row) {
  if (window.currentUser?.role !== 'admin') return 'rls';
  if (row.user_id === window.currentUser?.id) return 'proprio';
  const integrados = await _integracoesDoAdmin('ocorrencias');
  if (integrados.has(String(row.id))) return 'integrado';
  if (!ocApareceAutoParaSupervisor(row)) return null;
  return row.origem_ajuste_sistemico === true ? 'dai' : 'escalonamento';
}
async function _ocEhRelevantePraMim(row) {
  return (await _ocMotivoRelevancia(row)) !== null;
}
function _ocUpsertLocal(row) {
  if (!Array.isArray(state.ocorrencias)) state.ocorrencias = [];
  const oc = _ocFromDbRow(row);
  const meuId = window.currentUser?.id;
  // (o.userId || meuId): mesmo fallback do merge em syncOcorrenciasFromSupabase
  // — uma ocorrência recém-criada nesta sessão entra otimista no state ANTES
  // do round-trip, com userId ainda vazio. Sem esse fallback aqui, o INSERT
  // que o próprio upsert dispara chega pelo Realtime com user_id já
  // resolvido, não bate com a entrada local (undefined !== uuid) e duplica
  // o card em vez de atualizar no lugar.
  const idx = state.ocorrencias.findIndex(o => o.id === oc.id && (o.userId || meuId) === oc.userId);
  if (idx >= 0) state.ocorrencias[idx] = oc; else state.ocorrencias.push(oc);
}
function _ocRemoveLocal(id, userId) {
  if (!Array.isArray(state.ocorrencias)) return;
  const meuId = window.currentUser?.id;
  state.ocorrencias = state.ocorrencias.filter(o => !(o.id === id && (o.userId || meuId) === userId));
}

// Título do aviso de prioridade pro Supervisor (31/07) — extraído do
// handler do Realtime só pra dar pra testar sem simular a subscription
// inteira (mesmo motivo de _ocDetectarMudancaPrioritaria). Cita de QUEM é
// a ocorrência (criado_por_nome) e, se for escalonamento, quem executou a
// ação (acionadoPor no item mais recente de hierarquia) — antes só tinha
// central+motivo, sem dizer de quem era nem quem escalonou.
function _ocMontarTituloNotificacaoSupervisor(row, motivo) {
  const dono = row.criado_por_nome || 'usuário';
  if (motivo === 'dai') {
    return `Nova DAI de ${dono} — ${row.dai_tag || row.dai_numero || row.numero || row.id}`;
  }
  const ultimaEsc = Array.isArray(row.hierarquia) && row.hierarquia.length ? row.hierarquia[row.hierarquia.length - 1] : null;
  const porQuem = ultimaEsc?.acionadoPor ? ` (por ${ultimaEsc.acionadoPor})` : '';
  return `Ocorrência de ${dono} escalonada${porQuem} — ${ocNivelInfo(ocNivelAtual(row))?.label || 'Supervisor'}`;
}

let _ocChannel = null;
function _ocRealtimeInit() {
  if (!window.supabaseClient || !window.currentUser || _ocChannel) return;
  const handle = async (payload, tipo) => {
    const row = tipo === 'DELETE' ? payload.old : payload.new;
    if (!row) return;
    if (tipo === 'DELETE') { _ocRemoveLocal(row.id, row.user_id); }
    else {
      const meuId = window.currentUser?.id;
      // Só o SUPERVISOR se importa com "já existia" — pra ele decidir se é
      // a PRIMEIRA vez que a ocorrência entra na tela dele (dispara aviso
      // de prioridade) ou só mais uma edição de algo que ele já via.
      const jaExistia = state.ocorrencias.some(o => o.id === row.id && (o.userId || meuId) === row.user_id);
      const motivo = await _ocMotivoRelevancia(row);
      if (motivo) {
        _ocUpsertLocal(row);
        if (!jaExistia && (motivo === 'escalonamento' || motivo === 'dai') && typeof notifPushOcorrenciaSupervisor === 'function') {
          notifPushOcorrenciaSupervisor({
            ocorrenciaId: row.id,
            tipo: motivo,
            titulo: _ocMontarTituloNotificacaoSupervisor(row, motivo),
            corpo: [row.central, motivo === 'dai' ? row.material : row.motivo].filter(Boolean).join(' · '),
          });
        }
      } else {
        _ocRemoveLocal(row.id, row.user_id); // deixou de ser relevante (ex.: descalonada abaixo do nível do Supervisor)
      }
    }
    if (typeof renderOcorrencias === 'function') renderOcorrencias();
  };
  _ocChannel = window.supabaseClient
    .channel('ocorrencias_realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ocorrencias' }, (p) => handle(p, 'INSERT'))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ocorrencias' }, (p) => handle(p, 'UPDATE'))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'ocorrencias' }, (p) => handle(p, 'DELETE'))
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.warn('[Ocorrências] Canal Realtime com problema:', status);
    });
}
function _ocRealtimeStop() {
  if (_ocChannel && window.supabaseClient) window.supabaseClient.removeChannel(_ocChannel);
  _ocChannel = null;
}

// Grava uma ocorrência no Supabase (upsert) — usada por todas as funções
// de escrita abaixo. Falha não bloqueia a UI (já atualizada localmente);
// só avisa por toast. onConflict explícito (28/07) — a chave primária
// agora é composta (user_id, id), mesmo padrão já usado em `configs`.
async function _ocSyncUpsert(o) {
  const { error } = await window.supabaseClient.from('ocorrencias').upsert(_ocToDbRow(o), { onConflict: 'user_id,id' });
  if (error) {
    console.warn('[Supabase] Falha ao sincronizar ocorrência:', error);
    toast('⚠ Salvo nesta sessão, mas não foi possível sincronizar com a nuvem.', 'error');
  }
}

// ownerId — dono real da ocorrência (o.userId). Necessário explícito aqui:
// a PK é composta (user_id, id) porque `id` sozinho colide entre contas
// (ver histórico de correção em persist.js), e quem apaga pode ser um
// co-owner, não necessariamente o dono — por isso não dá pra assumir
// currentUser.id como em _supaDeleteOwned (ver normalize.js).
async function _ocSyncDelete(id, ownerId) {
  const { error } = await _supaDeleteOwned('ocorrencias', { id }, null, ownerId);
  if (error) {
    console.warn('[Supabase] Falha ao excluir ocorrência na nuvem:', error);
    toast('⚠ Removida nesta sessão, mas não foi possível sincronizar com a nuvem.', 'error');
  }
}

// ── Atribuição (31/07) — Supervisor delegando pra um usuário comum ─────
// Transfere o DONO de verdade (user_id), não é co_owner nem integração:
// a ocorrência passa a ser dela, com tudo que isso já implica (RLS,
// visibilidade, sync) — sem tabela/coluna nova.
// user_id é PARTE da PK composta (user_id, id) — upsert mudaria a chave
// e criaria uma linha NOVA em vez de mover a existente (mesma classe do
// bug corrigido em _ocToDbRow). Por isso é um UPDATE explícito, filtrando
// pela chave ANTIGA.
async function _ocSyncReatribuir(id, donoAntigo, donoNovo) {
  const { error } = await window.supabaseClient
    .from('ocorrencias')
    .update({ user_id: donoNovo })
    .eq('user_id', donoAntigo)
    .eq('id', id);
  if (error) {
    console.warn('[Supabase] Falha ao reatribuir ocorrência:', error);
    toast('⚠ Falha ao reatribuir — tente novamente.', 'error');
    return false;
  }
  return true;
}

// Lista de usuários pra atribuir — reaproveita o cache de presença global
// (mensagens.js, roda pra qualquer usuário logado desde o boot) em vez de
// buscar de novo; já tem id/email/nome de todo mundo, sem RPC extra.
function _ocUsuariosParaAtribuir() {
  const meuId = window.currentUser?.id;
  return Object.values(typeof _msgsUsuariosPorId !== 'undefined' ? _msgsUsuariosPorId : {})
    .filter(u => u.id !== meuId)
    .sort((a, b) => (a.nome_exibicao || a.email || '').localeCompare(b.nome_exibicao || b.email || ''));
}

async function reatribuirOcorrencia(id, novoDonoId) {
  const o = (state.ocorrencias || []).find(oc => oc.id === id);
  if (!o || !novoDonoId || o.userId === novoDonoId) return;
  const donoAntigo = o.userId;
  const ok = await _ocSyncReatribuir(id, donoAntigo, novoDonoId);
  if (!ok) return;
  // DAI: o documento (ajustes_sistemicos) nasce com o MESMO dono da
  // ocorrência vinculada (ver dai.js/solicitacao-dai) — reatribui os dois
  // juntos pra não ficar um dono diferente do outro.
  if (o.origemAjusteSistemico && o.daiId && typeof _daiSyncReatribuir === 'function') {
    _daiSyncReatribuir(o.daiId, donoAntigo, novoDonoId);
  }
  o.userId = novoDonoId;
  persist();
  renderOcorrencias();
  toast('Ocorrência atribuída.', 'success');
}

window.openAtribuirModal = function(id) {
  const o = (state.ocorrencias || []).find(oc => oc.id === id);
  if (!o) return;
  const usuarios = _ocUsuariosParaAtribuir();
  const select = document.getElementById('oc-atribuir-select');
  if (!select) return;
  select.innerHTML = usuarios.length
    ? usuarios.map(u => `<option value="${u.id}" ${u.id === o.userId ? 'selected' : ''}>${escapeHtml(u.nome_exibicao || u.email)}</option>`).join('')
    : `<option value="">Nenhum outro usuário cadastrado</option>`;
  document.getElementById('oc-atribuir-id').value = id;
  document.getElementById('oc-atribuir-modal')?.classList.add('open');
};
window.closeAtribuirModal = function() {
  document.getElementById('oc-atribuir-modal')?.classList.remove('open');
};
window.submitAtribuir = function() {
  const id = document.getElementById('oc-atribuir-id').value;
  const novoDonoId = document.getElementById('oc-atribuir-select').value;
  if (!novoDonoId) { toast('Selecione um usuário.', 'error'); return; }
  closeAtribuirModal();
  reatribuirOcorrencia(id, novoDonoId);
};

function saveOcorrencia(ocorrencia) {
  if (!Array.isArray(state.ocorrencias)) state.ocorrencias = [];
  const idx = state.ocorrencias.findIndex(o => o.id === ocorrencia.id);
  if (idx >= 0) state.ocorrencias[idx] = ocorrencia;
  else state.ocorrencias.push(ocorrencia);
  persist(); // fallback local (IndexedDB)
  renderOcorrencias();
  _ocSyncUpsert(ocorrencia);
}

function deleteOcorrencia(id) {
  const rec = (state.ocorrencias || []).find(o => o.id === id);
  state.ocorrencias = (state.ocorrencias || []).filter(o => o.id !== id);
  persist(); // fallback local (IndexedDB)
  renderOcorrencias();
  _ocSyncDelete(id, rec?.userId);
}

// ── Helpers ───────────────────────────────────────────────
function ocDateStatus(dataLimite) {
  if (!dataLimite) return 'normal';
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const limite = new Date(dataLimite + 'T00:00:00');
  const diff = Math.ceil((limite - hoje) / 86400000);
  if (diff < 0) return 'vencida';
  if (diff <= 2) return 'urgente';
  return 'normal';
}

function ocStatusLabel(o) {
  if (o.origemAjusteSistemico) return o.concluida ? 'ajuste_sistemico' : 'ajuste_sistemico_pendente';
  if (o.concluida)     return 'concluída';
  if (o.inconclusiva)  return 'inconclusiva';
  return ocDateStatus(o.dataLimite);
}

function fmtDateBR(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function buildWhatsAppLink(numero, ocorrencia) {
  const clean = (numero || '').replace(/\D/g, '');
  const phone = clean.startsWith('55') ? clean : '55' + clean;
  const central = escapeHtml(ocorrencia.central || '');
  const material = escapeHtml(ocorrencia.material || '');
  const descricao = escapeHtml(ocorrencia.descricao || '');
  const dataLimite = fmtDateBR(ocorrencia.dataLimite);
  const msg = `Olá! Estou entrando em contato referente a uma ocorrência aberta no AnalyticSys.\n\n` +
    `*Central:* ${central}\n` +
    `*Material:* ${material}\n` +
    `*Prazo:* ${dataLimite}\n\n` +
    `*Descrição:*\n${descricao}\n\n` +
    `Por favor, verifique e nos retorne assim que possível. Obrigado!`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

// ── Máscara de telefone ───────────────────────────────────
function fmtPhoneDisplay(raw) {
  if (!raw) return '';
  let v = raw.replace(/\D/g, '').slice(0, 11);
  if (v.length <= 2)        return `(${v}`;
  if (v.length <= 6)        return `(${v.slice(0,2)}) ${v.slice(2)}`;
  if (v.length <= 10)       return `(${v.slice(0,2)}) ${v.slice(2,6)}-${v.slice(6)}`;
  return `(${v.slice(0,2)}) ${v.slice(2,7)}-${v.slice(7)}`;
}

function applyPhoneMask(input) {
  input.addEventListener('input', function() {
    let v = this.value.replace(/\D/g, '').slice(0, 11);
    if (v.length === 0) { this.value = ''; return; }
    if (v.length <= 2)        this.value = `(${v}`;
    else if (v.length <= 6)   this.value = `(${v.slice(0,2)}) ${v.slice(2)}`;
    else if (v.length <= 10)  this.value = `(${v.slice(0,2)}) ${v.slice(2,6)}-${v.slice(6)}`;
    else                      this.value = `(${v.slice(0,2)}) ${v.slice(2,7)}-${v.slice(7)}`;
  });
}

function initPhoneMasks() {
  const ids = ['oc-form-contato', 'oc-escalonar-contato', 'oc-edit-esc-contato'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.dataset.maskApplied) {
      applyPhoneMask(el);
      el.dataset.maskApplied = '1';
    }
  });
}

// ── Hierarquia de Escalonamento ───────────────────────────
const OC_HIERARQUIA = [
  { nivel: 0, key: 'central',    label: 'Central',              icon: 'ti-building-warehouse', color: 'var(--accent)',  colorBg: 'var(--accent-dim)',  colorBorder: 'var(--accent-glow)' },
  { nivel: 1, key: 'regional',   label: 'Regional',             icon: 'ti-map-pin',            color: 'var(--amber)',   colorBg: 'var(--amber-bg)',    colorBorder: 'var(--amber-border)' },
  { nivel: 2, key: 'supervisor', label: 'Supervisor do Setor',  icon: 'ti-user-shield',        color: 'var(--purple)',  colorBg: 'var(--purple-bg)',   colorBorder: 'var(--purple-border)' },
  { nivel: 3, key: 'gerencia',   label: 'Gerência',             icon: 'ti-crown',              color: 'var(--red)',     colorBg: 'var(--red-bg)',      colorBorder: 'var(--red-border)' },
];

function ocNivelAtual(o) {
  const hist = o.hierarquia || [];
  return hist.length > 0 ? hist[hist.length - 1].nivel : 0;
}

function ocNivelInfo(nivel) {
  return OC_HIERARQUIA[Math.min(nivel, OC_HIERARQUIA.length - 1)];
}

// Regra de visão automática do Supervisor (31/07) — ver
// syncOcorrenciasFromSupabase(). Separada em função nomeada só pra dar pra
// testar sem precisar simular o fetch inteiro do Supabase.
function ocApareceAutoParaSupervisor(row) {
  return row.origem_ajuste_sistemico === true || ocNivelAtual(row) >= 2;
}

// Detecta uma mudança de PRIORIDADE feita pelo Supervisor numa ocorrência
// do usuário comum (escalonou/concluiu/marcou inconclusiva/reabriu/
// descalonou) — usada por notifications.js (_activityNotificarMudancaOcorrencia,
// via activity_log, que tem old_data/new_data completos) pra avisar o DONO
// com uma notificação ESPECÍFICA em vez da genérica "o administrador
// editou um registro". Edição "de campo" (central, descrição etc., sem
// mudar concluida/inconclusiva/nível) devolve null — essas continuam só
// na notificação genérica.
function _ocDetectarMudancaPrioritaria(oldData, newData) {
  if (!oldData || !newData) return null;
  const corpo = [newData.central, newData.numero || newData.id].filter(Boolean).join(' · ');
  // 31/07: nome de quem agiu, gravado no próprio evento (ultima_acao_por_nome
  // pra concluir/reabrir/inconclusiva, acionadoPor dentro do item mais
  // recente de hierarquia pra escalonar/descalonar) — antes disso não tinha
  // como saber QUEM, só "o Supervisor" genérico (RLS de profiles impede o
  // dono de resolver o nome de quem tem role=admin).
  const ator = newData.ultima_acao_por_nome ? `${newData.ultima_acao_por_nome} ` : 'O Supervisor ';
  if (!oldData.concluida && newData.concluida) {
    return { tipo: 'concluida', titulo: `${ator}concluiu sua ocorrência`, corpo };
  }
  if (!oldData.inconclusiva && newData.inconclusiva) {
    return { tipo: 'inconclusiva', titulo: `${ator}marcou sua ocorrência como inconclusiva`, corpo };
  }
  if ((oldData.concluida && !newData.concluida) || (oldData.inconclusiva && !newData.inconclusiva)) {
    return { tipo: 'reaberta', titulo: `${ator}reabriu sua ocorrência`, corpo };
  }
  const nivelAntes = ocNivelAtual(oldData);
  const nivelDepois = ocNivelAtual(newData);
  if (nivelDepois > nivelAntes) {
    const ultimaEntrada = (newData.hierarquia || [])[newData.hierarquia.length - 1];
    const atorEsc = ultimaEntrada?.acionadoPor ? `${ultimaEntrada.acionadoPor} ` : 'O Supervisor ';
    return { tipo: 'escalonada', titulo: `${atorEsc}escalonou sua ocorrência para ${ocNivelInfo(nivelDepois)?.label || 'um nível superior'}`, corpo };
  }
  if (nivelDepois < nivelAntes) {
    return { tipo: 'descalonada', titulo: `${ator}descalonou sua ocorrência`, corpo };
  }
  return null;
}

function ocPodeEscalonar(o) {
  if (o.concluida || o.inconclusiva) return false;
  return ocNivelAtual(o) < OC_HIERARQUIA.length - 1;
}

// Modal de escalonamento
window.openEscalonarModal = function(id) {
  const o = (state.ocorrencias || []).find(oc => oc.id === id);
  if (!o || !ocPodeEscalonar(o)) return;
  const nivelAtual = ocNivelAtual(o);
  const el = document.getElementById('oc-escalonar-modal');
  if (!el) return;

  el.querySelector('#oc-escalonar-id').value = id;
  el.querySelector('#oc-escalonar-nivel').value = nivelAtual + 1; // default: próximo nível
  el.querySelector('#oc-escalonar-motivo').value = '';
  el.querySelector('#oc-escalonar-responsavel').value = '';
  el.querySelector('#oc-escalonar-data').value = new Date().toISOString().split('T')[0];
  el.querySelector('#oc-escalonar-contato').value = o.contato ? fmtPhoneDisplay(o.contato) : '';

  // Monta os botões de seleção de nível
  const opcoes = OC_HIERARQUIA.filter(h => h.nivel > nivelAtual);
  const container = el.querySelector('#oc-escalonar-nivel-opcoes');
  if (container) {
    container.innerHTML = opcoes.map((h, i) => `
      <button type="button" class="oc-escalonar-nivel-btn ${i === 0 ? 'oc-escalonar-nivel-ativo' : ''}"
        data-nivel="${h.nivel}"
        style="--nivel-color:${h.color};--nivel-bg:${h.colorBg};--nivel-border:${h.colorBorder}"
        onclick="ocSelecionarNivel(${h.nivel})">
        <i class="ti ${h.icon}"></i>
        <span>${h.label}</span>
      </button>`).join('');
  }

  el.classList.add('open');
  initPhoneMasks();
};

window.ocSelecionarNivel = function(nivel) {
  document.getElementById('oc-escalonar-nivel').value = nivel;
  document.querySelectorAll('.oc-escalonar-nivel-btn').forEach(btn => {
    btn.classList.toggle('oc-escalonar-nivel-ativo', parseInt(btn.dataset.nivel) === nivel);
  });
};

window.closeEscalonarModal = function() {
  document.getElementById('oc-escalonar-modal')?.classList.remove('open');
};

// ── Descalonamento ────────────────────────────────────────
function ocPodeDescalonar(o) {
  if (o.concluida || o.inconclusiva) return false;
  return (o.hierarquia || []).length > 0;
}

window.descalonar = function(id) {
  const o = (state.ocorrencias || []).find(oc => oc.id === id);
  if (!o || !ocPodeDescalonar(o)) return;
  const snapshot = JSON.parse(JSON.stringify(o.hierarquia));
  const removido = o.hierarquia.pop();
  const info = ocNivelInfo(removido.nivel);
  o.ultimaAcaoTipo = 'descalonada';
  o.ultimaAcaoPorNome = _ocNomeAtor();
  persist();
  renderOcorrencias();
  _ocSyncUpsert(o);
  toast(`Descalonado de ${info.label}.`, 'info', 6000, () => {
    o.hierarquia = snapshot;
    persist();
    renderOcorrencias();
    _ocSyncUpsert(o);
  });
};

window.submitEscalonar = function() {
  const id         = document.getElementById('oc-escalonar-id').value;
  const nivel      = parseInt(document.getElementById('oc-escalonar-nivel').value, 10);
  const motivo     = document.getElementById('oc-escalonar-motivo').value.trim();
  const responsavel= document.getElementById('oc-escalonar-responsavel').value.trim();
  const data       = document.getElementById('oc-escalonar-data').value;
  const contatoRaw = document.getElementById('oc-escalonar-contato').value.trim();
  const contato    = contatoRaw.replace(/\D/g, '') || null;
  if (!motivo) { toast('Informe o motivo do escalonamento.', 'error'); return; }
  const o = (state.ocorrencias || []).find(oc => oc.id === id);
  if (!o) return;
  if (!Array.isArray(o.hierarquia)) o.hierarquia = [];
  if (contato !== null) o.contato = contato;
  o.hierarquia.push({ nivel, motivo, responsavel: responsavel || null, data, criadoEm: Date.now(), acionadoPor: _ocNomeAtor() });
  persist();
  renderOcorrencias();
  closeEscalonarModal();
  _ocSyncUpsert(o);
  const info = ocNivelInfo(nivel);
  toast(`Escalonado para ${info.label}.`, 'info');
};

// ── Edição de escalonamento ───────────────────────────────
window.openEditarEscalonamentoModal = function(ocId, nivelEscalonado) {
  const o = (state.ocorrencias || []).find(oc => oc.id === ocId);
  if (!o) return;
  const entrada = (o.hierarquia || []).find(h => h.nivel === nivelEscalonado);
  if (!entrada) return;

  const el = document.getElementById('oc-editar-escalonamento-modal');
  if (!el) return;

  el.querySelector('#oc-edit-esc-oc-id').value    = ocId;
  el.querySelector('#oc-edit-esc-nivel').value     = nivelEscalonado;
  el.querySelector('#oc-edit-esc-motivo').value    = entrada.motivo || '';
  el.querySelector('#oc-edit-esc-responsavel').value = entrada.responsavel || '';
  el.querySelector('#oc-edit-esc-data').value      = entrada.data || '';
  el.querySelector('#oc-edit-esc-contato').value   = o.contato ? fmtPhoneDisplay(o.contato) : '';

  const info = ocNivelInfo(nivelEscalonado);
  el.querySelector('#oc-edit-esc-titulo').textContent = `Editar escalonamento — ${info.label}`;
  el.querySelector('#oc-edit-esc-icone').className  = `ti ${info.icon}`;
  el.querySelector('#oc-edit-esc-icone').style.color = info.color;

  el.classList.add('open');
  initPhoneMasks();
};

window.closeEditarEscalonamentoModal = function() {
  document.getElementById('oc-editar-escalonamento-modal')?.classList.remove('open');
};

window.submitEditarEscalonamento = function() {
  const ocId   = document.getElementById('oc-edit-esc-oc-id').value;
  const nivel  = parseInt(document.getElementById('oc-edit-esc-nivel').value, 10);
  const motivo = document.getElementById('oc-edit-esc-motivo').value.trim();
  const resp   = document.getElementById('oc-edit-esc-responsavel').value.trim();
  const data   = document.getElementById('oc-edit-esc-data').value;
  const contatoRaw = document.getElementById('oc-edit-esc-contato').value.trim();
  const contato    = contatoRaw.replace(/\D/g, '') || null;
  if (!motivo) { toast('Informe o motivo do escalonamento.', 'error'); return; }
  const o = (state.ocorrencias || []).find(oc => oc.id === ocId);
  if (!o || !Array.isArray(o.hierarquia)) return;
  const entrada = o.hierarquia.find(h => h.nivel === nivel);
  if (!entrada) return;
  entrada.motivo      = motivo;
  entrada.responsavel = resp || null;
  entrada.data        = data;
  if (contato !== null) o.contato = contato;
  persist();
  renderOcorrencias();
  closeEditarEscalonamentoModal();
  openOcDetailModal(ocId);
  _ocSyncUpsert(o);
  toast('Escalonamento atualizado.', 'success');
};

// ── KPIs ──────────────────────────────────────────────────
function buildOcKPIs(lista) {
  const total          = lista.length;
  // DAI (31/07) é categoria própria no donut, igual ao badge dourado
  // "Ajuste Sistêmico" que o card já usa (ver ocStatusLabel) — exclusiva
  // das outras 3: uma ocorrência de DAI concluída conta em "DAI", não em
  // "Concluída" (senão o total do gráfico ficaria maior que a soma das
  // fatias visíveis, já que ela apareceria contada duas vezes).
  const daiOcorrencias = lista.filter(o => o.origemAjusteSistemico).length;
  const concluidas     = lista.filter(o => !o.origemAjusteSistemico && o.concluida).length;
  const inconclusivas  = lista.filter(o => !o.origemAjusteSistemico && !o.concluida && o.inconclusiva).length;
  const abertas        = total - daiOcorrencias - concluidas - inconclusivas;
  const vencidas       = lista.filter(o => !o.concluida && !o.inconclusiva && ocDateStatus(o.dataLimite) === 'vencida').length;
  const urgentes       = lista.filter(o => !o.concluida && !o.inconclusiva && ocDateStatus(o.dataLimite) === 'urgente').length;
  const pctConc        = total > 0 ? Math.round(concluidas / total * 100) : 0;

  // Métricas de tempo/ranking abaixo continuam de fora do Ajuste Sistêmico
  // (DAI) — nasce já concluído no mesmo dia, sem prazo/fluxo de resolução
  // real, e distorceria tempo médio/ranking. Só o bloco acima (donut) conta
  // DAI — precisa do `lista` cheio pra isso (ver renderOcorrencias, que
  // agora manda state.ocorrencias inteiro pra cá, não mais pré-filtrado —
  // do contrário a fatia "DAI" do donut nunca teria nada pra contar).
  const operacional = lista.filter(o => !o.origemAjusteSistemico);

  // Contagem por central (top 12)
  const porCentral = {};
  operacional.forEach(o => { const c = o.central || '—'; porCentral[c] = (porCentral[c] || 0) + 1; });
  const topCentrals = Object.entries(porCentral).sort((a, b) => b[1] - a[1]).slice(0, 12);

  // Contagem por motivo
  const porMotivo = {};
  operacional.forEach(o => {
    const m = (o.motivo || '').trim() || 'Sem motivo';
    porMotivo[m] = (porMotivo[m] || 0) + 1;
  });
  const topMotivos = Object.entries(porMotivo).sort((a, b) => b[1] - a[1]);

  // Diferença entre data de conclusão e data prazo (prazo → conclusão), em dias
  // Usamos o desvio absoluto para a média e para as faixas, já que valores
  // negativos (concluída antes do prazo) e positivos (após o prazo) se
  // cancelariam numa média simples, distorcendo o indicador.
  const temposBuckets = { '1d':0, '2-3d':0, '4-7d':0, '8-15d':0, '16-30d':0, '>30d':0 };
  let tempoTotal = 0, tempoCount = 0;
  operacional.forEach(o => {
    if (!o.concluida || !o.dataLimite || !o.dataConclusao) return;
    const ini = new Date(o.dataLimite + 'T00:00:00'), fim = new Date(o.dataConclusao + 'T00:00:00');
    if (isNaN(ini) || isNaN(fim)) return;
    const days = (fim - ini) / 86400000;
    const absDays = Math.abs(days);
    tempoTotal += absDays; tempoCount++;
    if      (absDays <= 1)  temposBuckets['1d']++;
    else if (absDays <= 3)  temposBuckets['2-3d']++;
    else if (absDays <= 7)  temposBuckets['4-7d']++;
    else if (absDays <= 15) temposBuckets['8-15d']++;
    else if (absDays <= 30) temposBuckets['16-30d']++;
    else                    temposBuckets['>30d']++;
  });
  const tempoMedioMin = tempoCount > 0 ? tempoTotal / tempoCount : null;

  // Tempo médio de conclusão por regional
  // Mapeia central → regional via state.filiais
  const _centralToRegional = {};
  (state.filiais || []).forEach(f => {
    const key = (f.alias || f.origem || '').trim().toLowerCase();
    if (key) _centralToRegional[key] = (f.regional || '').trim() || 'Sem Regional';
  });

  const regionalTempos = {}; // regional → { total: dias, count: n }
  operacional.forEach(o => {
    if (!o.concluida || !o.dataAbertura || !o.dataConclusao) return;
    const ini = new Date(o.dataAbertura + 'T00:00:00'), fim = new Date(o.dataConclusao + 'T00:00:00');
    if (isNaN(ini) || isNaN(fim)) return;
    const days = Math.abs((fim - ini) / 86400000);
    const centralKey = (o.central || '').trim().toLowerCase();
    const regional = _centralToRegional[centralKey] || 'Sem Regional';
    if (!regionalTempos[regional]) regionalTempos[regional] = { total: 0, count: 0 };
    regionalTempos[regional].total += days;
    regionalTempos[regional].count++;
  });

  const tempoMedioRegional = Object.entries(regionalTempos)
    .map(([reg, { total, count }]) => [reg, count > 0 ? total / count : 0, count])
    .sort((a, b) => b[1] - a[1]); // ordena do maior tempo para o menor

  // Sublegenda do donut (31/07) — métricas extra fora das fatias do
  // gráfico: escalonadas por nível (só as ainda ABERTAS, no nível atual —
  // mesma leitura de ocNivelAtual/OC_HIERARQUIA usada no resto da tela) e
  // concluídas em atraso (conclusão depois do prazo). DAI saiu daqui —
  // agora é fatia própria do donut (daiOcorrencias, calculado acima).
  const escalonadas = { regional: 0, supervisor: 0, gerencia: 0 };
  operacional.forEach(o => {
    if (o.concluida || o.inconclusiva) return;
    const nivel = ocNivelAtual(o);
    if (nivel === 1) escalonadas.regional++;
    else if (nivel === 2) escalonadas.supervisor++;
    else if (nivel === 3) escalonadas.gerencia++;
  });

  const concluidasAtraso = operacional.filter(o =>
    o.concluida && o.dataLimite && o.dataConclusao && o.dataConclusao > o.dataLimite
  ).length;

  return { total, concluidas, inconclusivas, abertas, vencidas, urgentes, pctConc,
           daiOcorrencias,
           topCentrals, porCentral, topMotivos, porMotivo,
           temposBuckets, tempoMedioMin, tempoCount,
           tempoMedioRegional,
           escalonadas, concluidasAtraso,
           _lista: lista };
}

// ── Render KPIs ───────────────────────────────────────────
let _ocChartRegional = null;
let _ocChartCentral  = null;
let _ocChartMotivo   = null;
let _ocChartTempo    = null;

function _destroyOcCharts() {
  [_ocChartRegional, _ocChartCentral, _ocChartMotivo, _ocChartTempo].forEach(c => { try { c?.destroy(); } catch(e){} });
  _ocChartRegional = _ocChartCentral = _ocChartMotivo = _ocChartTempo = null;
}

// ── Donut "Status das ocorrências" ─────────────────────────
// 31/07: 4 categorias (Em aberto/Inconclusiva/Concluída/DAI) — vencida/
// urgente continuam existindo como dado (cards, filtros), só saem do
// gráfico/legenda principal. DAI é categoria própria (exclusiva das
// outras 3, ver buildOcKPIs), não sublegenda. Escalonamento/atraso
// continuam na sublegenda abaixo (ver _buildOcSublegenda).
const OC_DONUT_META = {
  aberta:       { col: '#3b82f6', label: 'Em aberto'     },
  inconclusiva: { col: '#8b5cf6', label: 'Inconclusiva'  },
  concluida:    { col: '#10b981', label: 'Concluída'     },
  dai:          { col: '#eab308', label: 'DAI'           }
};

function _buildOcDonut(kpis) {
  const total = kpis.total;
  if (!total) {
    return `<div style="display:flex;align-items:center;justify-content:center;height:160px;color:var(--text3);font-size:12px;font-family:var(--mono)">Sem ocorrências</div>`;
  }

  const segs = [
    { key: 'aberta',       n: kpis.abertas        },
    { key: 'inconclusiva', n: kpis.inconclusivas  },
    { key: 'concluida',    n: kpis.concluidas     },
    { key: 'dai',          n: kpis.daiOcorrencias },
  ].filter(s => s.n > 0);

  const CX = 90, CY = 90, R = 72, ring = 26;
  const C = 2 * Math.PI * R;
  let offset = 0;
  let paths = '';
  segs.forEach(s => {
    const frac = s.n / total;
    const len  = frac * C;
    const meta = OC_DONUT_META[s.key];
    const pct  = Math.round(frac * 100);
    paths += `<circle class="oc-donut-slice" data-label="${meta.label}" data-count="${s.n}" data-pct="${pct}"
      cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${meta.col}" stroke-width="${ring}"
      stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-offset}"
      transform="rotate(-90 ${CX} ${CY})" style="cursor:pointer;transition:opacity .15s"></circle>`;
    offset += len;
  });

  const legend = segs.map(s => {
    const meta = OC_DONUT_META[s.key];
    const pct  = Math.round(s.n / total * 100);
    return `<div class="oc-donut-legend-row" data-label="${meta.label}" style="display:flex;align-items:center;gap:7px;font-size:11px;transition:opacity .15s">
      <span style="width:9px;height:9px;border-radius:2px;background:${meta.col};flex-shrink:0"></span>
      <span style="color:var(--text2);flex:1">${meta.label}</span>
      <span style="font-family:var(--mono);color:var(--text);font-weight:600">${s.n}</span>
      <span style="font-family:var(--mono);color:var(--text3);font-size:9.5px;min-width:32px;text-align:right">${pct}%</span>
    </div>`;
  }).join('');

  return `
    <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;justify-content:center">
      <div style="position:relative;width:180px;height:180px;flex-shrink:0">
        <svg viewBox="0 0 180 180" width="180" height="180">${paths}</svg>
        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none">
          <span style="font-size:24px;font-weight:700;font-family:var(--mono);color:var(--text)">${total}</span>
          <span style="font-size:9px;color:var(--text3);font-family:var(--mono);letter-spacing:.08em;text-transform:uppercase">ocorrências</span>
          <span style="font-size:11px;color:var(--green);font-family:var(--mono);margin-top:2px">${kpis.pctConc}% concl.</span>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;min-width:130px">${legend}</div>
    </div>
    ${_buildOcSublegenda(kpis)}`;
}

// Sublegenda (31/07) — métricas extras fora das fatias do donut: nível de
// escalonamento (só as ainda abertas), vencidas em aberto e atraso na
// conclusão. DAI saiu daqui — virou fatia própria do donut (ver
// OC_DONUT_META/_buildOcDonut).
function _buildOcSublegenda(kpis) {
  const { regional, supervisor, gerencia } = kpis.escalonadas;
  const itens = [
    { icon: 'ti-map-pin',        label: 'Escalonadas ao Regional',            val: regional },
    { icon: 'ti-user-shield',    label: 'Escalonadas ao Supervisor do Setor', val: supervisor },
    { icon: 'ti-crown',          label: 'Escalonadas à Gerência',             val: gerencia },
    { icon: 'ti-alert-triangle', label: 'Vencidas em aberto',                 val: kpis.vencidas },
    { icon: 'ti-clock-exclamation', label: 'Concluídas em atraso',            val: kpis.concluidasAtraso },
  ];
  return `
    <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border2);display:flex;flex-direction:column;gap:6px">
      ${itens.map(it => `<div style="display:flex;align-items:center;gap:7px;font-size:10.5px">
        <i class="ti ${it.icon}" style="font-size:12px;color:var(--text3);width:14px;text-align:center;flex-shrink:0"></i>
        <span style="color:var(--text3);flex:1">${it.label}</span>
        <span style="font-family:var(--mono);color:var(--text2);font-weight:600">${it.val}</span>
      </div>`).join('')}
    </div>`;
}

function _bindOcDonutHover() {
  const wrap = document.getElementById('oc-donut-wrap');
  if (!wrap) return;
  const slices = [...wrap.querySelectorAll('.oc-donut-slice')];
  const rows   = [...wrap.querySelectorAll('.oc-donut-legend-row')];

  const setHighlight = (label) => {
    slices.forEach(s => { s.style.opacity = (!label || s.dataset.label === label) ? '1' : '0.25'; });
    rows.forEach(r => { r.style.opacity = (!label || r.dataset.label === label) ? '1' : '0.4'; });
  };

  slices.forEach(s => {
    s.addEventListener('mouseenter', () => setHighlight(s.dataset.label));
    s.addEventListener('mouseleave', () => setHighlight(null));
  });
  rows.forEach(r => {
    r.addEventListener('mouseenter', () => setHighlight(r.dataset.label));
    r.addEventListener('mouseleave', () => setHighlight(null));
  });
}

function renderOcKPIs(lista) {
  const kpis = buildOcKPIs(lista);
  const el = document.getElementById('oc-kpis');
  if (!el) return;
  _destroyOcCharts();

  const isDark = !document.body.dataset.theme || document.body.dataset.theme !== 'light';
  const textCol  = isDark ? 'rgba(123,133,160,0.9)' : 'rgba(61,79,110,0.9)';
  const gridCol  = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
  const tickFont = { family: "'DM Mono', monospace", size: 10 };

  el.innerHTML = `
    <!-- Linha 1: Donut + volume por horário -->
    <div class="oc-charts-row" style="align-items:stretch">
      <div class="oc-chart-card oc-chart-donut-card" style="flex:0 0 320px">
        <div class="oc-chart-title">Status das ocorrências</div>
        <div class="oc-donut-wrap" id="oc-donut-wrap">${_buildOcDonut(kpis)}</div>
      </div>
      <div class="oc-chart-card" style="flex:1;min-width:0">
        <div class="oc-chart-title" style="display:flex;justify-content:space-between;align-items:center">
          <span><i class="ti ti-map-pin" style="font-size:12px;margin-right:5px"></i>Tempo Médio de Conclusão por Regional</span>
          <span id="oc-regional-badge" style="font-size:10px;font-family:var(--mono);color:var(--teal);background:var(--teal-bg);padding:2px 8px;border-radius:4px;border:1px solid var(--teal-border)"></span>
        </div>
        <div style="position:relative;width:100%;height:${Math.max((kpis.tempoMedioRegional.length || 1) * 32 + 20, 120)}px">
          <canvas id="oc-chart-regional" role="img" aria-label="Tempo médio de conclusão por regional"></canvas>
        </div>
      </div>
    </div>
    <!-- Linha 2: Ranking centrais + Ocorrências por motivo -->
    <div class="oc-charts-row" style="margin-top:16px;align-items:stretch">
      <div class="oc-chart-card" style="flex:1;min-width:0">
        <div class="oc-chart-title" style="display:flex;justify-content:space-between;align-items:center">
          <span><i class="ti ti-building-factory-2" style="font-size:12px;margin-right:5px"></i>Ranking de Centrais</span>
          <span style="font-size:10px;font-family:var(--mono);color:var(--text3);background:var(--accent-dim);padding:2px 7px;border-radius:4px;border:1px solid var(--accent-glow)">top 12</span>
        </div>
        <div style="position:relative;width:100%;height:${Math.max(kpis.topCentrals.length * 28 + 20, 120)}px">
          <canvas id="oc-chart-central" role="img" aria-label="Ranking de centrais por ocorrências"></canvas>
        </div>
      </div>
      <div class="oc-chart-card" style="flex:1;min-width:0">
        <div class="oc-chart-title">
          <i class="ti ti-tag" style="font-size:12px;margin-right:5px"></i>Ocorrências por Motivo
        </div>
        <div style="position:relative;width:100%;height:${Math.max(kpis.topMotivos.length * 28 + 20, 120)}px">
          <canvas id="oc-chart-motivo" role="img" aria-label="Ocorrências por motivo"></canvas>
        </div>
      </div>
    </div>
    <!-- Linha 3: Tempo de atendimento -->
    <div class="oc-charts-row" style="margin-top:16px">
      <div class="oc-chart-card" style="flex:1">
        <div class="oc-chart-title" style="display:flex;justify-content:space-between;align-items:center">
          <span><i class="ti ti-clock-hour-4" style="font-size:12px;margin-right:5px"></i>Tempo Médio de Conclusão</span>
          <span style="font-size:10px;font-family:var(--mono);color:var(--text3)">prazo → conclusão · ${kpis.tempoCount} concluída${kpis.tempoCount!==1?'s':''}</span>
        </div>
        ${kpis.tempoMedioMin !== null ? `
        <div style="display:flex;align-items:center;gap:20px;margin:10px 0 14px;padding:12px 16px;background:var(--green-bg);border:1px solid var(--green-border);border-radius:8px;flex-wrap:wrap">
          <div style="display:flex;flex-direction:column;gap:3px;min-width:110px">
            <span style="font-size:9px;font-family:var(--mono);color:var(--text3);text-transform:uppercase;letter-spacing:.07em">Tempo Médio de Conclusão</span>
            <span style="font-size:26px;font-family:var(--mono);font-weight:700;color:var(--green);line-height:1.1">${kpis.tempoMedioMin.toFixed(1)}<span style="font-size:14px;font-weight:400;margin-left:3px">d</span></span>
            <span style="font-size:9px;font-family:var(--mono);color:var(--text3)">${kpis.tempoCount} ocorrência${kpis.tempoCount!==1?'s':''} analisada${kpis.tempoCount!==1?'s':''}</span>
          </div>
          <div style="width:1px;height:44px;background:var(--green-border);flex-shrink:0"></div>
          <div style="flex:1;min-width:180px;display:flex;flex-direction:column;gap:5px">
            <span style="font-size:9px;font-family:var(--mono);color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:2px">Distribuição por faixa</span>
            ${(()=>{
              const bk = kpis.temposBuckets;
              const entries = [
                {k:'1d',     l:'≤ 1 dia',  c:'#10b981'},
                {k:'2-3d',   l:'2–3 dias', c:'#22c55e'},
                {k:'4-7d',   l:'4–7 dias', c:'#f59e0b'},
                {k:'8-15d',  l:'8–15 dias',c:'#f97316'},
                {k:'16-30d', l:'16–30d',   c:'#f43f5e'},
                {k:'>30d',   l:'> 30 dias',c:'#dc2626'},
              ];
              const total = kpis.tempoCount || 1;
              return entries.map(({k,l,c})=>{
                const v = bk[k]||0; if(!v) return '';
                const pct = Math.round(v/total*100);
                return `<div style="display:flex;align-items:center;gap:7px">
                  <span style="font-size:9px;font-family:var(--mono);color:${c};min-width:46px;flex-shrink:0">${l}</span>
                  <div style="flex:1;height:5px;background:var(--bg3);border-radius:3px;overflow:hidden">
                    <div style="width:${pct}%;height:100%;background:${c};border-radius:3px;transition:width .4s"></div>
                  </div>
                  <span style="font-size:9px;font-family:var(--mono);color:var(--text3);min-width:30px;text-align:right">${v} (${pct}%)</span>
                </div>`;
              }).join('');
            })()}
          </div>
        </div>` : `<div style="padding:10px 0 12px;font-size:11px;font-family:var(--mono);color:var(--text3)">Nenhuma ocorrência concluída com datas registradas.</div>`}
        <div style="position:relative;width:100%;height:180px">
          <canvas id="oc-chart-tempo" role="img" aria-label="Distribuição do tempo de atendimento"></canvas>
        </div>
      </div>
    </div>`;

  _bindOcDonutHover();
  requestAnimationFrame(() => _buildOcCharts(kpis, textCol, gridCol, tickFont));
}

function _buildOcCharts(kpis, textCol, gridCol, tickFont) {
  // ── Gráfico tempo médio por regional ──────────────────────────────────────
  const regionalData = kpis.tempoMedioRegional; // [[regional, avgDias, count], ...]
  const badgeEl = document.getElementById('oc-regional-badge');
  if (badgeEl) {
    if (regionalData.length > 0) {
      const pior = regionalData[0];
      badgeEl.textContent = `pior: ${pior[0]} · ${pior[1].toFixed(1)}d`;
    } else {
      badgeEl.textContent = '';
    }
  }

  const ctxR = document.getElementById('oc-chart-regional');
  if (ctxR) {
    if (!regionalData.length) {
      const noDataCtx = ctxR.getContext('2d');
      ctxR.height = 80;
      noDataCtx.fillStyle = textCol;
      noDataCtx.font = `11px 'DM Mono', monospace`;
      noDataCtx.textAlign = 'center';
      noDataCtx.fillText('Nenhuma ocorrência concluída com datas registradas.', ctxR.width / 2, 40);
    } else {
      const rLabels = regionalData.map(([r]) => r);
      const rVals   = regionalData.map(([,v]) => parseFloat(v.toFixed(2)));
      const rCounts = regionalData.map(([,,c]) => c);
      // Gradiente de cor: maior tempo → vermelho, menor → verde
      const rColors = rVals.map((v, i) => {
        const ratio = rVals.length > 1 ? i / (rVals.length - 1) : 0;
        // 0 = pior (top) → vermelho, 1 = melhor (bottom) → verde
        const r = Math.round(220 * ratio + 239 * (1 - ratio));
        const g = Math.round(197 * ratio + 68  * (1 - ratio));
        const b = Math.round(94  * ratio + 68  * (1 - ratio));
        return `rgba(${r},${g},${b},0.8)`;
      });

      _ocChartRegional = new Chart(ctxR, {
        type: 'bar',
        data: {
          labels: rLabels,
          datasets: [{
            data: rVals,
            backgroundColor: rColors,
            borderRadius: 3,
            borderSkipped: false
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: ctx => {
                  const dias = ctx.raw;
                  const count = rCounts[ctx.dataIndex];
                  return `${dias.toFixed(1)} dias em média · ${count} ocorrência${count !== 1 ? 's' : ''}`;
                }
              }
            }
          },
          scales: {
            x: {
              grid: { color: gridCol },
              ticks: { color: textCol, font: tickFont, callback: v => `${v}d` },
              beginAtZero: true
            },
            y: {
              grid: { display: false },
              ticks: { color: textCol, font: tickFont }
            }
          }
        }
      });
    }
  }

  // ── Ranking centrais ───────────────────────────────────────────────────────
  const ctxC = document.getElementById('oc-chart-central');
  if (ctxC && kpis.topCentrals.length) {
    const labels = kpis.topCentrals.map(([c]) => c);
    const vals   = kpis.topCentrals.map(([,n]) => n);
    _ocChartCentral = new Chart(ctxC, {
      type: 'bar',
      data: {
        labels,
        datasets:[{
          data: vals,
          backgroundColor: labels.map((_,i) => `rgba(59,130,246,${Math.max(0.3, 1 - i*0.06)})`),
          borderRadius: 3, borderSkipped: false
        }]
      },
      options: {
        indexAxis:'y', responsive:true, maintainAspectRatio:false,
        plugins:{legend:{display:false}, tooltip:{callbacks:{label:ctx=>`${ctx.raw} ocorrência${ctx.raw!==1?'s':''}`}}},
        scales:{
          x:{grid:{color:gridCol},ticks:{color:textCol,font:tickFont,precision:0},beginAtZero:true},
          y:{grid:{display:false},ticks:{color:textCol,font:tickFont}}
        }
      }
    });
  }

  // ── Ocorrências por motivo ─────────────────────────────────────────────────
  const ctxM = document.getElementById('oc-chart-motivo');
  if (ctxM && kpis.topMotivos.length) {
    const mLabels = kpis.topMotivos.map(([m]) => m.toUpperCase());
    const mVals   = kpis.topMotivos.map(([,n]) => n);
    _ocChartMotivo = new Chart(ctxM, {
      type: 'bar',
      data: {
        labels: mLabels,
        datasets:[{
          data: mVals,
          backgroundColor: 'rgba(245,158,11,0.75)',
          borderRadius: 3, borderSkipped: false
        }]
      },
      options: {
        indexAxis:'y', responsive:true, maintainAspectRatio:false,
        plugins:{legend:{display:false}, tooltip:{callbacks:{label:ctx=>`${ctx.raw} ocorrência${ctx.raw!==1?'s':''}`}}},
        scales:{
          x:{grid:{color:gridCol},ticks:{color:textCol,font:tickFont,precision:0},beginAtZero:true},
          y:{grid:{display:false},ticks:{color:textCol,font:{...tickFont,size:9},maxTicksLimit:20}}
        }
      }
    });
  }

  // ── Tempo de atendimento ───────────────────────────────────────────────────
  const ctxT = document.getElementById('oc-chart-tempo');
  if (ctxT) {
    const buckets = kpis.temposBuckets;
    const tLabels = ['≤ 1 dia','2–3 dias','4–7 dias','8–15 dias','16–30 dias','> 30 dias'];
    const tKeys   = ['1d','2-3d','4-7d','8-15d','16-30d','>30d'];
    const tVals   = tKeys.map(k => buckets[k] || 0);
    const tTotal  = tVals.reduce((a,b) => a+b, 0);

    // Determina o bucket onde está a média (em dias), para destacá-lo
    const avgMin = kpis.tempoMedioMin; // agora representa dias
    const _avgBucketIdx = avgMin === null ? -1 :
      avgMin <= 1  ? 0 :
      avgMin <= 3  ? 1 :
      avgMin <= 7  ? 2 :
      avgMin <= 15 ? 3 :
      avgMin <= 30 ? 4 : 5;

    const tColorsBase   = ['rgba(16,185,129,0.85)','rgba(34,197,94,0.75)','rgba(245,158,11,0.75)','rgba(249,115,22,0.75)','rgba(244,63,94,0.75)','rgba(220,38,38,0.75)'];
    const tColorsDimmed = tColorsBase.map((c,i) => i === _avgBucketIdx ? c : c.replace(/[\d.]+\)$/, m => '0.35)'));
    const tBorderColors = tColorsBase.map((c,i) => i === _avgBucketIdx ? c.replace(/[\d.]+\)$/, '1)') : 'transparent');
    const tBorderWidths = tColorsBase.map((c,i) => i === _avgBucketIdx ? 2 : 0);

    // Plugin customizado para desenhar label "ø média" no bucket destacado
    const avgLabelPlugin = {
      id: 'avgLabel',
      afterDatasetsDraw(chart) {
        if (_avgBucketIdx < 0) return;
        const { ctx, chartArea } = chart;
        const meta = chart.getDatasetMeta(0);
        const bar  = meta.data[_avgBucketIdx];
        if (!bar) return;
        const avgLabel = `ø ${avgMin.toFixed(1)} d`;
        ctx.save();
        ctx.font = `bold 10px 'DM Mono', monospace`;
        ctx.fillStyle = tColorsBase[_avgBucketIdx].replace(/[\d.]+\)$/, '1)');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const x = bar.x;
        const y = Math.max(bar.y - 4, chartArea.top + 12);
        ctx.fillText(avgLabel, x, y);
        ctx.restore();
      }
    };

    _ocChartTempo = new Chart(ctxT, {
      type: 'bar',
      data: {
        labels: tLabels,
        datasets:[{
          data: tVals,
          backgroundColor: _avgBucketIdx >= 0 ? tColorsDimmed : tColorsBase,
          borderColor: tBorderColors,
          borderWidth: tBorderWidths,
          borderRadius: 4, borderSkipped: false
        }]
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins:{
          legend:{display:false},
          tooltip:{callbacks:{
            label: ctx => {
              const pct = tTotal > 0 ? ` (${Math.round(ctx.raw/tTotal*100)}%)` : '';
              return `${ctx.raw} ocorrência${ctx.raw!==1?'s':''}${pct}`;
            },
            afterLabel: ctx => {
              if (ctx.dataIndex === _avgBucketIdx && avgMin !== null) {
                const avg = avgMin < 1 ? `${(avgMin * 24).toFixed(1)} h` : `${avgMin.toFixed(1)} d`;
                return `← bucket da média (${avg})`;
              }
              return null;
            }
          }}
        },
        scales:{
          x:{grid:{color:gridCol},ticks:{color:textCol,font:tickFont}},
          y:{grid:{color:gridCol},ticks:{color:textCol,font:tickFont,precision:0},beginAtZero:true}
        }
      },
      plugins: [avgLabelPlugin]
    });
  }
}

// ── Helpers de renderização de hierarquia ─────────────────
// Texto "· responsável (escalonado por Fulano)" pra uma entrada de
// hierarquia (31/07) — `responsavel` é texto livre (quem deve tratar
// aquele nível) e `acionadoPor` é automático (quem de fato clicou pra
// escalonar); mostra os dois quando existem, nunca confunde um com o
// outro. Reaproveitado na barra do card e no timeline do modal de detalhe.
function _ocHierMetaTexto(entrada) {
  if (!entrada) return '';
  const partes = [];
  if (entrada.responsavel) partes.push(escapeHtml(entrada.responsavel));
  if (entrada.acionadoPor) partes.push(`escalonado por ${escapeHtml(entrada.acionadoPor)}`);
  return partes.length ? ` · ${partes.join(' · ')}` : '';
}

function _buildOcHierarquiaBar(o) {
  const nivelAtual = ocNivelAtual(o);
  if (nivelAtual === 0 && !(o.hierarquia && o.hierarquia.length)) return '';
  const hist = o.hierarquia || [];
  const info = ocNivelInfo(nivelAtual);
  const podeDesc = ocPodeDescalonar(o) && !o.concluida && !o.inconclusiva;

  // Item do nível atual (sempre visível)
  const atvInfo = OC_HIERARQUIA[nivelAtual];
  const atvEntrada = nivelAtual === 0
    ? { data: o.dataAbertura, responsavel: o.operador }
    : hist.find(hh => hh.nivel === nivelAtual);

  const clicavelAtual = nivelAtual > 0 && atvEntrada;
  const itemAtual = `<div class="oc-card-hier-item oc-card-hier-ativo${clicavelAtual ? ' oc-card-hier-item-link' : ''}"
    style="${clicavelAtual ? `--hier-color:${atvInfo.color};--hier-color-bg:${atvInfo.colorBg}` : ''}"
    ${clicavelAtual ? `onclick="openEditarEscalonamentoModal('${o.id}',${nivelAtual})" title="Ver escalonamento para ${atvInfo.label}"` : ''}>
    <div class="oc-card-hier-dot" style="background:${atvInfo.color};border-color:${atvInfo.color}">
      <i class="ti ${atvInfo.icon}"></i>
    </div>
    <div class="oc-card-hier-body">
      <span class="oc-card-hier-label" style="color:${atvInfo.color}">${atvInfo.label}</span>
      ${atvEntrada ? `<span class="oc-card-hier-meta">${fmtDateBR(atvEntrada.data)}${_ocHierMetaTexto(atvEntrada)}</span>` : ''}
    </div>
    <span class="oc-card-hier-badge" style="background:${atvInfo.colorBg};color:${atvInfo.color};border-color:${atvInfo.colorBorder}">atual</span>
    ${podeDesc ? `<button class="btn btn-xs oc-btn-descalonar oc-hier-desc-btn" onclick="event.stopPropagation();descalonar('${o.id}')" title="Voltar ao nível anterior"><i class="ti ti-arrow-down-circle"></i></button>` : ''}
    ${clicavelAtual ? `<i class="ti ti-chevron-right oc-hier-item-arrow"></i>` : ''}
  </div>`;

  // Itens dos níveis anteriores (ocultos por padrão)
  const itensAnteriores = OC_HIERARQUIA.slice(0, nivelAtual).map((h, i) => {
    const entrada = i === 0
      ? { data: o.dataAbertura, responsavel: o.operador }
      : hist.find(hh => hh.nivel === i);
    const clicavel = i > 0 && entrada;
    return `<div class="oc-card-hier-item oc-card-hier-passado${clicavel ? ' oc-card-hier-item-link' : ''}"
      style="${clicavel ? `--hier-color:${h.color};--hier-color-bg:${h.colorBg}` : ''}"
      ${clicavel ? `onclick="openEditarEscalonamentoModal('${o.id}',${i})" title="Ver escalonamento para ${h.label}"` : ''}>
      <div class="oc-card-hier-dot" style="background:${h.color};border-color:${h.color}">
        <i class="ti ${h.icon}"></i>
      </div>
      <div class="oc-card-hier-body">
        <span class="oc-card-hier-label" style="color:var(--text3)">${h.label}</span>
        ${entrada ? `<span class="oc-card-hier-meta">${fmtDateBR(entrada.data)}${_ocHierMetaTexto(entrada)}</span>` : ''}
      </div>
      ${clicavel ? `<i class="ti ti-chevron-right oc-hier-item-arrow"></i>` : ''}
    </div>`;
  }).join('');

  const temHistorico = nivelAtual > 0;

  return `<div class="oc-card-hierarquia" style="border-color:${info.colorBorder}" onclick="event.stopPropagation()">
    <div class="${temHistorico ? 'oc-card-hier-label-top oc-card-hier-toggle' : 'oc-card-hier-label-top'}"
      ${temHistorico ? `role="button" tabindex="0"
      onclick="(function(btn){var wrap=btn.closest('.oc-card-hierarquia');wrap.classList.toggle('oc-hier-expanded');var ico=btn.querySelector('.oc-hier-toggle-ico');ico.style.transform=wrap.classList.contains('oc-hier-expanded')?'rotate(180deg)':'rotate(0deg)'})(this)"
      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}"` : ''}>
      <i class="ti ti-sitemap" style="font-size:9px"></i> Hierarquia
      ${temHistorico ? `<span class="oc-hier-hist-badge">${nivelAtual} escalonamento${nivelAtual > 1 ? 's' : ''}</span>
      <i class="ti ti-chevron-down oc-hier-toggle-ico"></i>` : ''}
    </div>
    ${temHistorico ? `<div class="oc-card-hier-historico">${itensAnteriores}</div>` : ''}
    ${itemAtual}
  </div>`;
}

window.ocToggleHierarquia = function(btn) {
  const wrap = btn.closest('.oc-card-hierarquia');
  wrap.classList.toggle('oc-hier-expanded');
  const ico = btn.querySelector('.oc-hier-toggle-ico');
  if (ico) ico.style.transform = wrap.classList.contains('oc-hier-expanded') ? 'rotate(180deg)' : 'rotate(0deg)';
};

function _buildOcHierarquiaDetail(o) {
  const hist = o.hierarquia || [];
  if (!hist.length) {
    return `<div class="oc-detail-section-label">Hierarquia</div>
      <div class="oc-hier-timeline oc-hier-timeline-empty">
        ${OC_HIERARQUIA.map((h, i) => `
          <div class="oc-hier-tl-item ${i === 0 ? 'oc-hier-tl-ativo' : 'oc-hier-tl-pendente'}">
            <div class="oc-hier-tl-dot" style="${i === 0 ? `background:${h.color};border-color:${h.color}` : ''}">
              <i class="ti ${h.icon}"></i>
            </div>
            <div class="oc-hier-tl-body">
              <span class="oc-hier-tl-label" style="${i === 0 ? `color:${h.color}` : ''}">${h.label}</span>
              ${i === 0 ? `<span class="oc-hier-tl-meta">Nível atual — aguardando resolução</span>` : `<span class="oc-hier-tl-meta">Não escalonado</span>`}
            </div>
          </div>`).join('')}
      </div>`;
  }

  const nivelAtual = ocNivelAtual(o);
  return `<div class="oc-detail-section-label">Hierarquia de Escalonamento</div>
    <div class="oc-hier-timeline">
      ${OC_HIERARQUIA.map((h, i) => {
        const entrada = i === 0 ? { data: o.dataAbertura, motivo: 'Abertura da ocorrência', responsavel: o.operador } : hist.find(hh => hh.nivel === i);
        const ativo   = i === nivelAtual;
        const passado = i < nivelAtual;
        const pendente= i > nivelAtual;
        return `<div class="oc-hier-tl-item ${ativo ? 'oc-hier-tl-ativo' : ''} ${passado ? 'oc-hier-tl-passado' : ''} ${pendente ? 'oc-hier-tl-pendente' : ''}">
          <div class="oc-hier-tl-dot" style="${(ativo || passado) && entrada ? `background:${h.color};border-color:${h.color}` : ''}">
            <i class="ti ${h.icon}"></i>
          </div>
          <div class="oc-hier-tl-body">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
              <span class="oc-hier-tl-label" style="${(ativo || passado) && entrada ? `color:${h.color}` : ''}">${h.label}</span>
              ${i > 0 && entrada ? `<button class="btn btn-sm oc-hier-tl-edit-btn" onclick="closeOcDetailModal();openEditarEscalonamentoModal('${o.id}',${i})" title="Editar escalonamento"><i class="ti ti-pencil"></i></button>` : ''}
            </div>
            ${entrada ? `
              <span class="oc-hier-tl-meta">${fmtDateBR(entrada.data)}${_ocHierMetaTexto(entrada)}</span>
              ${i > 0 ? `<span class="oc-hier-tl-motivo">${escapeHtml(entrada.motivo)}</span>` : ''}
            ` : `<span class="oc-hier-tl-meta">Não escalonado</span>`}
            ${ativo && !o.concluida && !o.inconclusiva ? `<span class="oc-hier-tl-badge">Nível atual</span>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

// ── Render lista ──────────────────────────────────────────
function renderOcorrencias() {
  if (!Array.isArray(state.ocorrencias)) state.ocorrencias = [];
  const lista = getOcorrenciasFiltradas();
  // KPIs sempre no TOTAL de state.ocorrencias, não na lista com micro-filtro
  // aplicado (mesmo comportamento de antes) — a exclusão de Ajuste
  // Sistêmico (DAI) das métricas de tempo médio/ranking (que não fazem
  // sentido pra um registro que nasce já concluído no mesmo dia, sem prazo
  // real) agora é decidida DENTRO de buildOcKPIs, métrica por métrica —
  // o donut e a contagem total continuam precisando ver as DAIs.
  renderOcKPIs(state.ocorrencias);
  _renderOcLista(lista);
  // Cobre o filtro de período (calendar.js chama renderOcorrencias direto
  // ao completar o range, sem passar pelos outros pontos que já
  // sincronizavam este botão — ver _ocSyncClearBtn).
  _ocSyncClearBtn();
}

// ── Filtros (31/07) — padrão "Visão Micro" (Dashboard Analítico) ───────
// Mesmo padrão já usado 3x no app (Agregados, Inventário, Ausências —
// prefixo `imf`/`inv` em Inventário): dropdown com checkbox multi-seleção,
// busca interna, e um estado pendente/aplicado (Aplicar só confirma ao
// clicar, Cancelar ou clique fora descarta). Cópia do padrão, não extração
// de componente — é assim que as outras 3 telas fizeram, cada uma com seu
// próprio prefixo de id/função (aqui: `omf`/`oc`).
const OC_STATUS_OPTIONS = [
  { value: 'aberta',           label: 'Em aberto' },
  { value: 'vencida',          label: 'Vencidas' },
  { value: 'urgente',          label: 'Urgentes' },
  { value: 'inconclusiva',     label: 'Inconclusivas' },
  { value: 'concluida',        label: 'Concluídas' },
  { value: 'ajuste_sistemico', label: 'Ajuste Sistêmico' },
];
const _OC_FILTER_KEY_LABELS = { status: 'Status', central: 'Central', material: 'Material', regional: 'Regional' };
const _ocMicroFilter = {
  pending:  { status: new Set(), central: new Set(), material: new Set(), regional: new Set() },
  applied:  { status: new Set(), central: new Set(), material: new Set(), regional: new Set() },
  options:  { status: OC_STATUS_OPTIONS, central: [], material: [], regional: [] },
};

// Central → Regional (state.filiais) — ocorrências não têm campo regional
// próprio, só central; pra filtrar por regional precisa resolver via o
// cadastro de filiais (mesma normalização usada no resto do arquivo:
// alias || origem, trim). Central sem filial cadastrada (ou sem regional
// preenchido) cai fora do filtro — não aparece em nenhuma opção.
function _ocRegionalPorCentral() {
  const map = new Map();
  (state.filiais || []).forEach(f => {
    const nome = (f.alias || f.origem || '').trim();
    const regional = (f.regional || '').trim();
    if (nome && regional) map.set(nome, regional);
  });
  return map;
}

// Mesma lógica que já existia inline no filtro antigo — extraída pra dar
// pra checar "bate com QUALQUER status marcado" no multi-seleção.
function ocStatusMatches(o, statusValue) {
  switch (statusValue) {
    case 'ajuste_sistemico': return !!o.origemAjusteSistemico;
    case 'concluida':        return !!o.concluida;
    case 'aberta':           return !o.concluida && !o.inconclusiva;
    case 'vencida':          return !o.concluida && !o.inconclusiva && ocDateStatus(o.dataLimite) === 'vencida';
    case 'urgente':          return !o.concluida && !o.inconclusiva && ocDateStatus(o.dataLimite) === 'urgente';
    case 'inconclusiva':     return !!o.inconclusiva && !o.concluida;
    default:                 return false;
  }
}

function _ocBuildOptionsList(key, query = '') {
  const container = document.getElementById(`omfo-${key}`);
  if (!container) return;
  const opts = _ocMicroFilter.options[key] || [];
  const q = query.toLowerCase().trim();
  const filtered = q ? opts.filter(o => o.label.toLowerCase().includes(q)) : opts;
  const applied = _ocMicroFilter.applied[key];
  const pending = _ocMicroFilter.pending[key];

  if (!filtered.length) {
    container.innerHTML = `<div style="padding:12px 10px;color:var(--text3);font-size:12px;text-align:center">Nenhum resultado</div>`;
    return;
  }
  container.innerHTML = filtered.map(opt => {
    const checked = pending.size ? pending.has(opt.value) : applied.has(opt.value);
    const id = `omfopt-${key}-${opt.value.replace(/[^a-z0-9]/gi, '_')}`;
    return `<label class="micro-filter-option" for="${id}">
      <input type="checkbox" id="${id}" value="${escapeHtml(opt.value)}" ${checked ? 'checked' : ''}
        onchange="_ocMicroFilterCheckChange('${key}', this)">
      <span class="micro-filter-option-label" title="${escapeHtml(opt.label)}">${escapeHtml(opt.label)}</span>
    </label>`;
  }).join('');
}

function _ocMicroFilterCheckChange(key, checkbox) {
  const pending = _ocMicroFilter.pending[key];
  if (checkbox.checked) pending.add(checkbox.value); else pending.delete(checkbox.value);
}

function _ocCloseMicroFilterDropdown(key) {
  document.getElementById(`omfd-${key}`)?.classList.remove('open');
  document.getElementById(`omfc-${key}`)?.classList.remove('open');
}

function ocToggleMicroFilter(key) {
  const dd = document.getElementById(`omfd-${key}`);
  const chev = document.getElementById(`omfc-${key}`);
  if (!dd || !chev) return;
  const allKeys = ['status', 'central', 'material', 'regional'];
  // Fecha os outros dropdowns primeiro, revertendo pending não aplicado.
  allKeys.filter(k => k !== key).forEach(otherKey => {
    const otherDd = document.getElementById(`omfd-${otherKey}`);
    if (otherDd?.classList.contains('open')) {
      _ocMicroFilter.pending[otherKey] = new Set(_ocMicroFilter.applied[otherKey]);
      _ocCloseMicroFilterDropdown(otherKey);
    }
  });
  _ocCloseOrdenarDropdown(); // só um dropdown aberto por vez na barra inteira
  const isOpen = dd.classList.toggle('open');
  chev.classList.toggle('open', isOpen);
  if (isOpen) {
    _ocMicroFilter.pending[key] = new Set(_ocMicroFilter.applied[key]);
    const searchEl = document.getElementById(`omfs-${key}`);
    if (searchEl) searchEl.value = '';
    _ocBuildOptionsList(key);
    setTimeout(() => searchEl?.focus(), 50);
  }
}

function ocFilterMicroOptions(key, query) {
  _ocBuildOptionsList(key, query);
}

function ocApplyMicroFilter(key) {
  _ocMicroFilter.applied[key] = new Set(_ocMicroFilter.pending[key]);
  _ocCloseMicroFilterDropdown(key);
  _ocSyncTriggerLabel(key);
  _ocSyncClearBtn();
  renderOcorrencias();
}

function ocCancelMicroFilter(key) {
  _ocMicroFilter.pending[key] = new Set(_ocMicroFilter.applied[key]);
  _ocCloseMicroFilterDropdown(key);
}

function ocClearMicroFilter(key) {
  _ocMicroFilter.pending[key] = new Set();
  _ocMicroFilter.applied[key] = new Set();
  _ocCloseMicroFilterDropdown(key);
  _ocSyncTriggerLabel(key);
  _ocSyncClearBtn();
  renderOcorrencias();
}

function ocClearAllMicroFilters() {
  ['status', 'central', 'material', 'regional'].forEach(key => {
    _ocMicroFilter.pending[key] = new Set();
    _ocMicroFilter.applied[key] = new Set();
    _ocSyncTriggerLabel(key);
  });
  if (typeof calClearRange === 'function') calClearRange('oc');
  _ocSyncClearBtn();
  renderOcorrencias();
}

function _ocSyncTriggerLabel(key) {
  const btn = document.getElementById(`omft-${key}`);
  const label = document.getElementById(`omft-${key}-label`);
  if (!label || !btn) return;
  const keyLabel = _OC_FILTER_KEY_LABELS[key] || key;
  const applied = _ocMicroFilter.applied[key];
  if (!applied.size) {
    label.innerHTML = keyLabel;
    btn.classList.remove('active');
  } else if (applied.size === 1) {
    const val = [...applied][0];
    const opt = (_ocMicroFilter.options[key] || []).find(o => o.value === val);
    const texto = opt ? opt.label : val;
    label.innerHTML = `${keyLabel}: <strong>${escapeHtml(texto.length > 18 ? texto.slice(0, 18) + '…' : texto)}</strong>`;
    btn.classList.add('active');
  } else {
    label.innerHTML = `${keyLabel} <span class="micro-filter-badge">${applied.size}</span>`;
    btn.classList.add('active');
  }
}

function _ocSyncClearBtn() {
  const btn = document.getElementById('oc-mf-clear-btn');
  if (!btn) return;
  const f = _ocMicroFilter.applied;
  const hasPeriodo = !!document.getElementById('oc-dt-ini')?.value;
  const hasAny = f.status.size || f.central.size || f.material.size || f.regional.size || hasPeriodo;
  btn.style.display = hasAny ? '' : 'none';
}

// Fecha o dropdown aberto ao clicar fora dele, descartando qualquer edição
// pendente não aplicada (mesmo comportamento do padrão em analitico.js).
document.addEventListener('click', e => {
  ['status', 'central', 'material', 'regional'].forEach(key => {
    const group = document.getElementById(`omfg-${key}`);
    if (group && !group.contains(e.target)) {
      const dd = document.getElementById(`omfd-${key}`);
      if (dd?.classList.contains('open')) {
        _ocMicroFilter.pending[key] = new Set(_ocMicroFilter.applied[key]);
        _ocCloseMicroFilterDropdown(key);
      }
    }
  });
  const ordenarGroup = document.getElementById('omfg-ordenar');
  if (ordenarGroup && !ordenarGroup.contains(e.target)) _ocCloseOrdenarDropdown();
  // Menu "···" dos cards — fora de .oc-card no DOM (ver _ocAbrirMenuCard),
  // então só fecha por não estar dentro do próprio menu.
  const cardMenu = document.getElementById('oc-card-menu');
  if (cardMenu?.classList.contains('open') && !cardMenu.contains(e.target)) _ocFecharMenuCard();
});

// Ordenação (31/07) — padrão é DATA DE ABERTURA (dataAbertura — quando a
// ocorrência/DAI foi aberta, não quando o registro entrou no sistema), da
// mais nova pra mais antiga. dataAbertura é string "AAAA-MM-DD", por isso
// localeCompare em vez de subtração numérica (mesmo formato/comparação já
// usada em dataLimite no modo "prioridade"). O antigo comportamento
// (vencida/urgente primeiro) vira só mais uma opção no seletor.
const OC_SORT_OPTIONS = [
  { value: 'abertura_desc', label: 'Mais recentes primeiro' },
  { value: 'abertura_asc',  label: 'Mais antigas primeiro' },
  { value: 'prioridade',    label: 'Prioridade (vencidas primeiro)' },
];
// 31/07: virou um dropdown no mesmo padrão visual dos filtros (pill +
// chevron + opções), não mais um <select> nativo destoando dos outros
// botões — mesmo padrão de "dropdown simples" (seleção única, sem
// Aplicar/Cancelar) já usado em Inventário pra Justificativa/Divergências
// (ver invSetJustificativa/invToggleJustificativaDropdown).
let _ocSortMode = 'abertura_desc';

function _ocSyncOrdenarBtn() {
  const btn = document.getElementById('omft-ordenar');
  const label = document.getElementById('omft-ordenar-label');
  if (!btn || !label) return;
  const isDefault = _ocSortMode === 'abertura_desc';
  const opt = OC_SORT_OPTIONS.find(o => o.value === _ocSortMode);
  label.textContent = isDefault ? 'Ordenar' : (opt?.label || 'Ordenar');
  btn.classList.toggle('active', !isDefault);
  document.querySelectorAll('#omfd-ordenar .micro-filter-option--radio').forEach(el => {
    el.classList.toggle('selected', el.dataset.val === _ocSortMode);
  });
}

function _ocCloseOrdenarDropdown() {
  document.getElementById('omfd-ordenar')?.classList.remove('open');
  document.getElementById('omfc-ordenar')?.classList.remove('open');
}

function ocToggleOrdenarDropdown() {
  const dd = document.getElementById('omfd-ordenar');
  const chev = document.getElementById('omfc-ordenar');
  if (!dd) return;
  // Fecha os dropdowns de filtro se algum estiver aberto (mesmo cuidado
  // do lado deles em relação a este) — revertendo pending não aplicado.
  ['status', 'central', 'material', 'regional'].forEach(key => {
    const otherDd = document.getElementById(`omfd-${key}`);
    if (otherDd?.classList.contains('open')) {
      _ocMicroFilter.pending[key] = new Set(_ocMicroFilter.applied[key]);
      _ocCloseMicroFilterDropdown(key);
    }
  });
  const isOpen = dd.classList.toggle('open');
  chev?.classList.toggle('open', isOpen);
}

function ocSetOrdenar(value) {
  _ocSortMode = value;
  _ocSyncOrdenarBtn();
  _ocCloseOrdenarDropdown();
  renderOcorrencias();
}

function _ocCompararOrdenacao(a, b, sortMode) {
  if (sortMode === 'abertura_asc') return (a.dataAbertura || '').localeCompare(b.dataAbertura || '');
  if (sortMode === 'prioridade') {
    const sa = ocStatusLabel(a), sb = ocStatusLabel(b);
    const order = { vencida: 0, urgente: 1, ajuste_sistemico_pendente: 2, normal: 3, inconclusiva: 4, 'concluída': 5, ajuste_sistemico: 6 };
    if (order[sa] !== order[sb]) return order[sa] - order[sb];
    return (a.dataLimite || '').localeCompare(b.dataLimite || '');
  }
  return (b.dataAbertura || '').localeCompare(a.dataAbertura || ''); // 'abertura_desc' (padrão)
}

function getOcorrenciasFiltradas() {
  const fStatus   = _ocMicroFilter.applied.status;
  const fCentral  = _ocMicroFilter.applied.central;
  const fMaterial = _ocMicroFilter.applied.material;
  const fRegional = _ocMicroFilter.applied.regional;
  const fBusca    = (document.getElementById('oc-filter-busca')?.value || '').toLowerCase();
  const sortMode  = _ocSortMode;
  // Filtro de período (31/07) — datas ISO gravadas pelo calendário
  // compartilhado (js/calendar.js, pfx="oc") nos hidden inputs; compara
  // por dataAbertura (mesmo campo já usado em toda a tela/ordenação).
  const dtIni = document.getElementById('oc-dt-ini')?.value || '';
  const dtFim = document.getElementById('oc-dt-fim')?.value || '';
  // Só resolve o mapa central→regional se o filtro estiver mesmo em uso —
  // evita varrer state.filiais à toa em toda renderização.
  const mapaRegional = fRegional.size ? _ocRegionalPorCentral() : null;

  return (state.ocorrencias || []).filter(o => {
    if (fStatus.size && ![...fStatus].some(s => ocStatusMatches(o, s))) return false;
    if (fCentral.size && !fCentral.has(o.central || '')) return false;
    if (fMaterial.size && !fMaterial.has(o.material || '')) return false;
    if (fRegional.size) {
      const reg = mapaRegional.get((o.central || '').trim());
      if (!reg || !fRegional.has(reg)) return false;
    }
    if (dtIni && (o.dataAbertura || '') < dtIni) return false;
    if (dtFim && (o.dataAbertura || '') > dtFim) return false;
    if (fBusca) {
      const hay = [o.central, o.material, o.operador, o.descricao, o.id, o.numero, o.daiNumero, o.daiTag].join(' ').toLowerCase();
      if (!hay.includes(fBusca)) return false;
    }
    return true;
  }).sort((a, b) => _ocCompararOrdenacao(a, b, sortMode));
}

// ── Menu "···" dos cards (31/07) ────────────────────────────
// Com o crescimento de ações (DAI já tem 7), o rodapé do card ficava
// apertado e cortava botão. Fica visível só o essencial — ação
// principal do fluxo (Editar Nº SAP/Preencher Nº SAP na DAI; Concluir/
// Reabrir/Reabrir concluída na comum), Editar/Termo e Excluir — o resto
// entra neste menu único, compartilhado por todos os cards e populado a
// cada abertura (ver _renderOcLista pro HTML do gatilho "···").
function _ocAbrirMenuCard(event, id) {
  event.stopPropagation();
  const o = (state.ocorrencias || []).find(oc => oc.id === id);
  const menu = document.getElementById('oc-card-menu');
  if (!o || !menu) return;

  // Clicar de novo no mesmo gatilho fecha (toggle), em vez de reabrir
  // idêntico no mesmo lugar.
  if (menu.classList.contains('open') && menu.dataset.ocId === id) {
    _ocFecharMenuCard();
    return;
  }

  const isAjuste = !!o.origemAjusteSistemico;
  const isAdmin = window.currentUser?.role === 'admin';
  const itens = [];
  if (isAdmin) itens.push({ icon: 'ti-user-plus', label: 'Atribuir a outro usuário', acao: `openAtribuirModal('${o.id}')` });
  if (isAjuste) {
    itens.push({ icon: 'ti-printer',   label: 'Reimprimir Documento',       acao: `reimprimirDocumentoDai('${o.daiId || ''}')` });
    itens.push({ icon: 'ti-download',  label: 'Baixar ZIP',                 acao: `baixarZipDai('${o.daiId || ''}')` });
    itens.push({ icon: 'ti-file-plus', label: 'Anexar Arquivo',             acao: `adicionarAnexoDaiExistente('${o.daiId || ''}')` });
  } else {
    if (!o.concluida && !o.inconclusiva) itens.push({ icon: 'ti-alert-triangle',  label: 'Marcar como inconclusiva', acao: `openInconclusivaModal('${o.id}')` });
    if (ocPodeEscalonar(o))              itens.push({ icon: 'ti-arrow-up-circle', label: 'Escalonar',                acao: `openEscalonarModal('${o.id}')` });
  }

  menu.innerHTML = itens.map(it => `<button type="button" class="oc-card-menu-item" onclick="event.stopPropagation();_ocFecharMenuCard();${it.acao}">
    <i class="ti ${it.icon}"></i> ${it.label}
  </button>`).join('') || `<div style="padding:8px 10px;font-size:11.5px;color:var(--text3)">Nenhuma ação extra.</div>`;

  const rect = event.currentTarget.getBoundingClientRect();
  // Alinha a borda DIREITA do menu com a do botão (que fica no canto
  // direito do card) — evita estourar a borda direita da tela.
  menu.style.left = 'auto';
  menu.style.right = `${window.innerWidth - rect.right}px`;
  menu.dataset.ocId = id;
  menu.classList.add('open'); // precisa estar visível pra offsetHeight medir certo

  // Abre pra cima quando não cabe embaixo (card perto do rodapé da tela):
  // sendo position:fixed, o menu não acompanha o scroll da página, então um
  // item que ultrapassasse o fim da viewport ficava inacessível — sem opção
  // de rolar até ele.
  const menuHeight = menu.offsetHeight || 0;
  const cabeEmbaixo = rect.bottom + 6 + menuHeight <= window.innerHeight - 8;
  menu.style.top = cabeEmbaixo
    ? `${rect.bottom + 6}px`
    : `${Math.max(8, rect.top - menuHeight - 6)}px`;
}

function _ocFecharMenuCard() {
  document.getElementById('oc-card-menu')?.classList.remove('open');
}

function _renderOcLista(lista) {
  const el = document.getElementById('oc-lista');
  if (!el) return;
  if (!lista.length) {
    el.innerHTML = `<div class="empty-state"><i class="ti ti-clipboard-off"></i><p>Nenhuma ocorrência encontrada.</p></div>`;
    return;
  }

  el.innerHTML = lista.map(o => {
    const _rawStatus = ocStatusLabel(o);
    const status = _rawStatus === 'concluída' ? 'concluida' : _rawStatus;
    const statusLabel = { concluida: 'Concluída', vencida: 'Vencida', urgente: 'Urgente', normal: 'Em aberto', inconclusiva: 'Inconclusiva', ajuste_sistemico: 'Ajuste Sistêmico', ajuste_sistemico_pendente: 'Ajuste Sistêmico — Pendente' };
    const statusCls   = { concluida: 'oc-badge-green', vencida: 'oc-badge-red', urgente: 'oc-badge-amber', normal: 'oc-badge-blue', inconclusiva: 'oc-badge-purple', ajuste_sistemico: 'oc-badge-gold', ajuste_sistemico_pendente: 'oc-badge-gold' };
    const isAjuste = !!o.origemAjusteSistemico;

    return `<div class="oc-card ${o.concluida && !isAjuste ? 'oc-card-done' : ''} ${o.inconclusiva ? 'oc-card-inconclusiva' : ''} ${isAjuste ? 'oc-card-ajuste-sistemico' : ''} oc-card-${status}" onclick="openOcDetailModal('${o.id}')">
      <div class="oc-card-header">
        <div class="oc-card-header-left">
          <span class="oc-badge ${statusCls[status]}">${isAjuste ? `<i class="ti ${o.concluida ? "ti-rubber-stamp" : "ti-clock-hour-4"}" style="margin-right:3px"></i>` : ''}${statusLabel[status]}</span>
          <span class="oc-card-id" title="${isAjuste ? 'Ocorrência interna: ' + escapeHtml(o.id) + (o.daiNumero ? ' · Nº fiscal: ' + escapeHtml(o.daiNumero) : '') : ''}">${isAjuste && (o.daiTag || o.daiNumero) ? escapeHtml(o.daiTag || o.daiNumero) : escapeHtml(o.numero || o.id)}</span>
          <span class="oc-card-central"><i class="ti ti-building-warehouse"></i> ${escapeHtml(o.central || '—')}</span>
          ${o.material ? `<span class="oc-card-material"><i class="ti ti-box"></i> ${escapeHtml(o.material)}</span>` : ''}
        </div>
        <div class="oc-card-header-right">
          <span class="oc-card-date-group">
            <span class="oc-card-date-label">Abertura</span>
            <span class="oc-card-date-val">${fmtDateBR(o.dataAbertura)}</span>
          </span>
          ${o.dataLimite ? `<span class="oc-card-date-sep">→</span>
          <span class="oc-card-date-group ${status === 'vencida' ? 'oc-date-red' : status === 'urgente' ? 'oc-date-amber' : ''}">
            <span class="oc-card-date-label">Prazo</span>
            <span class="oc-card-date-val">${fmtDateBR(o.dataLimite)}</span>
          </span>` : ''}
          ${o.concluida && o.dataConclusao ? `<span class="oc-card-date-sep">✓</span>
          <span class="oc-card-date-group oc-date-green">
            <span class="oc-card-date-label">Conclusão</span>
            <span class="oc-card-date-val">${fmtDateBR(o.dataConclusao)}</span>
          </span>` : ''}
          ${o.inconclusiva && !o.concluida && o.dataInconclusiva ? `<span class="oc-card-date-sep">—</span>
          <span class="oc-card-date-group" style="color:var(--purple)">
            <span class="oc-card-date-label">Inconclusiva em</span>
            <span class="oc-card-date-val">${fmtDateBR(o.dataInconclusiva)}</span>
          </span>` : ''}
        </div>
      </div>

      <div class="oc-card-body">
        <div class="oc-card-desc">${escapeHtml(o.descricao || '')}</div>
        ${o.concluida && o.descConclusao ? `<div class="oc-card-conclusao"><i class="ti ti-circle-check"></i> ${escapeHtml(o.descConclusao)}</div>` : ''}
        ${o.inconclusiva && !o.concluida && o.motivoInconclusiva ? `<div class="oc-card-inconclusiva-obs"><i class="ti ti-alert-triangle"></i> ${escapeHtml(o.motivoInconclusiva)}</div>` : ''}
        ${_buildOcHierarquiaBar(o)}
      </div>

      <div class="oc-card-footer">
        <div class="oc-card-footer-left">${o.criadoPorNome ? `<span class="oc-card-criador" title="Criado por"><i class="ti ti-user-circle"></i> ${escapeHtml(o.criadoPorNome)}</span>` : ''}</div>
        <div class="oc-card-footer-right">
          ${isAjuste ? `
          <button class="btn btn-sm ${!o.concluida ? 'oc-btn-concluir' : ''}" onclick="event.stopPropagation();editarSapDai('${o.daiId || ''}')" title="${o.concluida ? 'Editar Nº do documento SAP' : 'Preencher Nº do documento SAP e concluir'}">
            <i class="ti ti-edit"></i>
          </button>
          <button class="btn btn-sm" onclick="event.stopPropagation();gerarTermoResponsabilidade('${o.daiId || ''}')" title="Gerar Termo de Responsabilidade do Informante">
            <i class="ti ti-signature"></i>
          </button>
          <button class="btn btn-sm btn-danger-ghost" onclick="event.stopPropagation();confirmarExcluirAjusteSistemico('${o.id}')" title="Excluir (requer confirmação de ciência)">
            <i class="ti ti-trash"></i>
          </button>` : `
          ${!o.concluida && !o.inconclusiva ? `<button class="btn btn-sm oc-btn-concluir" onclick="event.stopPropagation();openConcluirModal('${o.id}')" title="Concluir">
            <i class="ti ti-circle-check"></i>
          </button>` : ''}
          ${o.inconclusiva && !o.concluida ? `<button class="btn btn-sm oc-btn-reabrir" onclick="event.stopPropagation();reabrirOcorrencia('${o.id}')" title="Reabrir ocorrência">
            <i class="ti ti-rotate"></i>
          </button>` : ''}
          ${o.concluida ? `<button class="btn btn-sm oc-btn-reabrir-concluida" onclick="event.stopPropagation();reabrirOcorrenciaConcluida('${o.id}')" title="Reabrir ocorrência concluída">
            <i class="ti ti-rotate"></i>
          </button>` : ''}
          <button class="btn btn-sm" onclick="event.stopPropagation();openOcorrenciaModal('${o.id}')" title="Editar">
            <i class="ti ti-edit"></i>
          </button>
          <button class="btn btn-sm btn-danger-ghost" onclick="event.stopPropagation();confirmarExcluirOcorrencia('${o.id}')" title="Excluir">
            <i class="ti ti-trash"></i>
          </button>`}
          <button class="btn btn-sm" onclick="_ocAbrirMenuCard(event,'${o.id}')" title="Mais ações">
            <i class="ti ti-dots-vertical"></i>
          </button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── Modal de detalhe (visualização completa) ──────────────
function openOcDetailModal(id) {
  const o = (state.ocorrencias || []).find(oc => oc.id === id);
  if (!o) return;
  const isAjuste = !!o.origemAjusteSistemico;
  const dai = isAjuste ? (state.ajustesSistemicos || []).find(d => d.id === o.daiId) : null;
  const status = ocStatusLabel(o) === 'concluída' ? 'concluida' : ocStatusLabel(o);
  const statusLabel = { concluida: 'Concluída', vencida: 'Vencida', urgente: 'Urgente', normal: 'Em aberto', inconclusiva: 'Inconclusiva', ajuste_sistemico: 'Ajuste Sistêmico', ajuste_sistemico_pendente: 'Ajuste Sistêmico — Pendente' };
  const statusCls   = { concluida: 'oc-badge-green', vencida: 'oc-badge-red', urgente: 'oc-badge-amber', normal: 'oc-badge-blue', inconclusiva: 'oc-badge-purple', ajuste_sistemico: 'oc-badge-gold', ajuste_sistemico_pendente: 'oc-badge-gold' };
  const waLink = o.contato ? buildWhatsAppLink(o.contato, o) : null;

  const el = document.getElementById('oc-detail-modal');
  if (!el) return;
  el.dataset.currentId = id; // usado para reabrir a mesma ocorrência após ações externas (ex: editar SAP de um DAI com múltiplas ocorrências vinculadas)

  el.querySelector('.oc-detail-header').innerHTML = `
    <span class="oc-badge ${statusCls[status]}">${isAjuste ? `<i class="ti ${o.concluida ? "ti-rubber-stamp" : "ti-clock-hour-4"}" style="margin-right:3px"></i>` : ''}${statusLabel[status]}</span>
    <span class="oc-card-central"><i class="ti ti-building-warehouse"></i> ${escapeHtml(o.central || '—')}</span>
    ${o.material ? `<span class="oc-card-material"><i class="ti ti-box"></i> ${escapeHtml(o.material)}</span>` : ''}
    <span style="font-size:11px;color:var(--text3);font-family:var(--mono);margin-left:auto" title="${isAjuste ? 'Ocorrência interna: ' + escapeHtml(o.id) + (o.daiNumero ? ' · Nº fiscal: ' + escapeHtml(o.daiNumero) : '') : ''}">${isAjuste && (o.daiTag || o.daiNumero) ? escapeHtml(o.daiTag || o.daiNumero) : escapeHtml(o.numero || o.id)}</span>`;

  el.querySelector('.oc-detail-dates').innerHTML = `
    <span class="oc-card-date-group" style="align-items:flex-start">
      <span class="oc-card-date-label">Abertura</span>
      <span class="oc-card-date-val">${fmtDateBR(o.dataAbertura)}</span>
    </span>
    ${o.dataLimite ? `<span class="oc-card-date-sep">→</span>
    <span class="oc-card-date-group ${status === 'vencida' ? 'oc-date-red' : status === 'urgente' ? 'oc-date-amber' : ''}" style="align-items:flex-start">
      <span class="oc-card-date-label">Prazo</span>
      <span class="oc-card-date-val">${fmtDateBR(o.dataLimite)}</span>
    </span>` : ''}
    ${o.concluida && o.dataConclusao ? `<span class="oc-card-date-sep">✓</span>
    <span class="oc-card-date-group oc-date-green" style="align-items:flex-start">
      <span class="oc-card-date-label">Conclusão</span>
      <span class="oc-card-date-val">${fmtDateBR(o.dataConclusao)}</span>
    </span>` : ''}
    ${o.inconclusiva && !o.concluida && o.dataInconclusiva ? `<span class="oc-card-date-sep">—</span>
    <span class="oc-card-date-group" style="color:var(--purple);align-items:flex-start">
      <span class="oc-card-date-label">Inconclusiva em</span>
      <span class="oc-card-date-val">${fmtDateBR(o.dataInconclusiva)}</span>
    </span>` : ''}`;

  el.querySelector('.oc-detail-desc').innerHTML = `
    <div class="oc-detail-section-label">Descrição</div>
    <div class="oc-detail-section-val">${escapeHtml(o.descricao || '—')}</div>`;

  const acaoPorTxt = o.ultimaAcaoPorNome ? ` <span style="color:var(--text3);font-weight:400">— por ${escapeHtml(o.ultimaAcaoPorNome)}</span>` : '';
  el.querySelector('.oc-detail-conclusao').innerHTML = [
    (!isAjuste && o.concluida && o.descConclusao) ? `
      <div class="oc-detail-section-label">Conclusão</div>
      <div class="oc-detail-section-val" style="color:var(--green)">${escapeHtml(o.descConclusao)}${o.ultimaAcaoTipo === 'concluida' ? acaoPorTxt : ''}</div>` : '',
    (isAjuste && !o.concluida) ? `
      <div class="oc-detail-section-label" style="color:var(--amber)">Pendente</div>
      <div class="oc-detail-section-val" style="color:var(--amber)">Aguardando preenchimento do Nº do documento SAP para concluir este ajuste.</div>` : '',
    o.inconclusiva && !o.concluida && o.motivoInconclusiva ? `
      <div class="oc-detail-section-label" style="color:var(--purple)">Motivo da inconclusividade</div>
      <div class="oc-detail-section-val" style="color:var(--purple)">${escapeHtml(o.motivoInconclusiva)}${o.ultimaAcaoTipo === 'inconclusiva' ? acaoPorTxt : ''}</div>` : '',
  ].join('');

  // Seção exclusiva do Documento de Ajuste de Inventário (DAI) — mostra a
  // tabela completa de itens (material/peso/movimento/SAP/função) e a
  // lista de informantes. _daiGetItens/_daiGetInformantes (dai.js) also
  // cobrem DAIs antigos (gerados antes desta funcionalidade), reconstruindo
  // um item único a partir dos campos legados.
  const daiEl = el.querySelector('.oc-detail-dai');
  if (daiEl) {
    if (isAjuste && dai) {
      const itens = (typeof _daiGetItens === 'function') ? _daiGetItens(dai) : [];
      const informantes = (typeof _daiGetInformantes === 'function') ? _daiGetInformantes(dai) : [];
      const itemAtualId = o.daiItemId || null;
      const informantesTxt = informantes.map(i => escapeHtml(i.nome) + (i.cargo ? ` (${escapeHtml(i.cargo)})` : '')).join(', ') || '—';
      const itensRowsHtml = itens.map(it => {
        const pendente = !it.sapDocumento || it.sapDocumento === 'PENDENTE';
        return `<tr class="${it.id && it.id === itemAtualId ? 'oc-dai-item-atual' : ''}">
          <td>${escapeHtml(it.material || '—')}</td>
          <td>${it.peso !== null && it.peso !== undefined && it.peso !== '' ? Number(it.peso).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
          <td>${escapeHtml(it.tipoMovimentoSap || '—')}</td>
          <td ${pendente ? 'style="color:var(--amber)"' : ''}>${pendente ? 'Pendente' : escapeHtml(it.sapDocumento)}</td>
          <td>${escapeHtml(it.objetivo || '—')}</td>
        </tr>`;
      }).join('');

      daiEl.innerHTML = `
        <div class="oc-detail-section-label" style="color:var(--gold)">Documento de Ajuste de Inventário</div>
        <div class="dai-numero-preview" style="margin-bottom:8px">${escapeHtml(dai.tag || dai.numero || '—')}</div>
        <div class="oc-detail-section-val" style="line-height:1.8;overflow-wrap:anywhere">
          Nº do documento (fiscal): <strong>${escapeHtml(dai.numero || '—')}</strong><br>
          Central: <strong>${escapeHtml(dai.central || o.central || '—')}</strong>${dai.regionalCentral ? ` <span style="color:var(--text3)">(Regional ${escapeHtml(dai.regionalCentral)})</span>` : ''}${dai.cnpjCentral ? ` <span style="color:var(--text3)">(CNPJ ${escapeHtml(dai.cnpjCentral)})</span>` : ''}<br>
          Informante(s): <strong>${informantesTxt}</strong><br>
          Data do ocorrido: <strong>${fmtDateBR(dai.dataOcorrido)}</strong> · Gerado em: <strong>${dai.dataGeracao ? new Date(dai.dataGeracao).toLocaleString('pt-BR') : '—'}</strong><br>
          Analista responsável (assinatura): <strong>${escapeHtml(dai.analista || '—')}</strong>
        </div>
        <div style="margin-top:10px;overflow-x:auto">
          <table class="oc-dai-itens-table">
            <thead><tr><th>Material</th><th>Peso (kg)</th><th>Tipo Mov.</th><th>Nº Doc. SAP</th><th>Função do movimento</th></tr></thead>
            <tbody>${itensRowsHtml}</tbody>
          </table>
        </div>
        ${Array.isArray(dai.anexos) && dai.anexos.length ? `
        <div class="dai-anexo-list" style="margin-top:10px">
          ${dai.anexos.map(a => `<div class="dai-anexo-chip"><i class="ti ti-paperclip"></i><span class="dai-anexo-chip-nome">${escapeHtml(a.nome)}</span><span class="dai-anexo-chip-tam">${formatBytes(a.tamanho)}</span></div>`).join('')}
        </div>` : ''}`;
    } else {
      daiEl.innerHTML = '';
    }
  }

  el.querySelector('.oc-detail-meta').innerHTML = `
    <span><i class="ti ti-user" style="margin-right:4px"></i>${escapeHtml(o.operador || '—')}</span>
    ${o.criadoPorNome ? `<span title="Criado por"><i class="ti ti-user-circle" style="margin-right:4px"></i>${escapeHtml(o.criadoPorNome)}</span>` : ''}
    ${waLink ? `<a href="${waLink}" target="_blank" rel="noopener" class="oc-wa-btn"><i class="ti ti-brand-whatsapp"></i> ${escapeHtml(o.contato)}</a>` : ''}`;

  el.querySelector('.oc-detail-actions').innerHTML = isAjuste ? `
    <button class="btn btn-sm" onclick="reimprimirDocumentoDai('${o.daiId || ''}')"><i class="ti ti-printer"></i> Reimprimir Documento</button>
    <button class="btn btn-sm ${!o.concluida ? 'oc-btn-concluir' : ''}" onclick="editarSapDai('${o.daiId || ''}')"><i class="ti ti-edit"></i> ${o.concluida ? 'Editar Nº SAP' : 'Preencher Nº SAP'}</button>
    <button class="btn btn-sm" onclick="baixarZipDai('${o.daiId || ''}')"><i class="ti ti-download"></i> Baixar ZIP</button>
    <button class="btn btn-sm" onclick="gerarTermoResponsabilidade('${o.daiId || ''}')"><i class="ti ti-signature"></i> Termo de Responsabilidade</button>
    <button class="btn btn-sm" onclick="adicionarAnexoDaiExistente('${o.daiId || ''}')"><i class="ti ti-file-plus"></i> Anexar Arquivo</button>
    <button class="btn btn-sm btn-danger-ghost" onclick="closeOcDetailModal();confirmarExcluirAjusteSistemico('${o.id}')"><i class="ti ti-trash"></i></button>` : `
    ${!o.concluida && !o.inconclusiva ? `<button class="btn btn-sm oc-btn-inconclusiva" onclick="closeOcDetailModal();openInconclusivaModal('${o.id}')"><i class="ti ti-alert-triangle"></i> Inconclusiva</button>` : ''}
    ${o.inconclusiva && !o.concluida ? `<button class="btn btn-sm oc-btn-reabrir" onclick="closeOcDetailModal();reabrirOcorrencia('${o.id}')"><i class="ti ti-rotate"></i> Reabrir</button>` : ''}
    ${o.concluida ? `<button class="btn btn-sm oc-btn-reabrir-concluida" onclick="closeOcDetailModal();reabrirOcorrenciaConcluida('${o.id}')"><i class="ti ti-rotate"></i> Reabrir</button>` : ''}
    ${ocPodeEscalonar(o) ? `<button class="btn btn-sm oc-btn-escalonar" onclick="closeOcDetailModal();openEscalonarModal('${o.id}')"><i class="ti ti-arrow-up-circle"></i> Escalonar</button>` : ''}
    ${!o.concluida ? `<button class="btn btn-sm oc-btn-concluir" onclick="closeOcDetailModal();openConcluirModal('${o.id}')"><i class="ti ti-circle-check"></i> Concluir</button>` : ''}
    <button class="btn btn-sm" onclick="closeOcDetailModal();openOcorrenciaModal('${o.id}')"><i class="ti ti-edit"></i> Editar</button>
    <button class="btn btn-sm btn-danger-ghost" onclick="closeOcDetailModal();confirmarExcluirOcorrencia('${o.id}')"><i class="ti ti-trash"></i></button>`;

  // Seção de hierarquia no modal de detalhe
  const hierEl = el.querySelector('.oc-detail-hierarquia');
  if (hierEl) hierEl.innerHTML = isAjuste ? '' : _buildOcHierarquiaDetail(o);

  el.classList.add('open');
}


function closeOcDetailModal() {
  document.getElementById('oc-detail-modal')?.classList.remove('open');
}

// ── Populares opções de filtro ────────────────────────────
function populateOcFiltros() {
  const centrais  = [...new Set((state.ocorrencias || []).map(o => o.central).filter(Boolean))].sort();
  const materiais = [...new Set((state.ocorrencias || []).map(o => o.material).filter(Boolean))].sort();

  // Dropdowns da toolbar (padrão Visão Micro, ver _ocMicroFilter acima) —
  // 31/07: mostram só o que já existe numa ocorrência registrada, não o
  // cadastro inteiro (esse continua completo só no formulário de Nova
  // Ocorrência, mais abaixo — lá faz sentido oferecer qualquer central/
  // material cadastrado; aqui é um filtro do que já foi lançado, não um
  // seletor de cadastro). Status também é filtrado pelo mesmo critério —
  // só entra na lista quem tem pelo menos 1 ocorrência batendo agora.
  _ocMicroFilter.options.status = OC_STATUS_OPTIONS.filter(opt =>
    (state.ocorrencias || []).some(o => ocStatusMatches(o, opt.value))
  );
  _ocMicroFilter.options.central  = centrais.map(c => ({ value: c, label: c }));
  _ocMicroFilter.options.material = materiais.map(m => ({ value: m, label: m }));
  // Regional (substituiu Operador, 31/07) — resolvido via central→regional
  // (state.filiais), só os que aparecem em alguma ocorrência agora.
  const mapaRegional = _ocRegionalPorCentral();
  const regionais = [...new Set(
    centrais.map(c => mapaRegional.get(c)).filter(Boolean)
  )].sort();
  _ocMicroFilter.options.regional = regionais.map(r => ({ value: r, label: r }));
  ['status', 'central', 'material', 'regional'].forEach(key => {
    _ocBuildOptionsList(key);
    _ocSyncTriggerLabel(key);
  });
  _ocSyncClearBtn();
  _ocSyncOrdenarBtn();

  // Centrais do cadastro: campo "origem" (código/nome da central) — só pro
  // formulário de Nova Ocorrência (mCentral abaixo), que continua
  // oferecendo o cadastro completo, diferente do filtro da toolbar acima.
  const stCentrals  = (state.filiais  || [])
    .map(f => (f.alias || f.origem || '').trim())
    .filter(Boolean)
    .sort();
  // Materiais do cadastro — 31/07: só o GRUPO (alias), não mais
  // "GRUPO: NOME ORIGINAL". Cai pro nome original só se o cadastro não
  // tiver alias preenchido (registro incompleto, melhor mostrar algo do
  // que nada). O formulário de Nova Ocorrência oferece SÓ o cadastrado em
  // Configurações (sem mesclar com materiais digitados livremente em
  // ocorrências antigas), pra não deixar escolher algo fora do catálogo.
  const stMateriais = [...new Set((state.materiais || [])
    .map(m => (m.alias || m.origem || '').trim())
    .filter(Boolean))].sort();

  const mCentral  = document.getElementById('oc-form-central');
  const mMaterial = document.getElementById('oc-form-material');

  if (mCentral) {
    const opts = [...new Set([...stCentrals, ...centrais])].sort();
    mCentral.innerHTML = '<option value="">Selecione a central</option>'
      + opts.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  }
  if (mMaterial) {
    mMaterial.innerHTML = '<option value="">Selecione o material (opcional)</option>'
      + stMateriais.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
  }
}

// ── Modal nova/editar ocorrência ──────────────────────────
function openOcorrenciaModal(id) {
  const o = id ? (state.ocorrencias || []).find(oc => oc.id === id) : null;
  populateOcFiltros();
  document.getElementById('oc-modal-title').textContent = o ? 'Editar Ocorrência' : 'Nova Ocorrência';
  document.getElementById('oc-form-id').value          = o?.id || '';
  document.getElementById('oc-form-abertura').value    = o?.dataAbertura  || new Date().toISOString().split('T')[0];
  document.getElementById('oc-form-limite').value      = o?.dataLimite    || '';
  document.getElementById('oc-form-central').value     = o?.central       || '';
  document.getElementById('oc-form-material').value    = o?.material      || '';
  document.getElementById('oc-form-operador').value    = o?.operador      || '';
  document.getElementById('oc-form-contato').value     = o?.contato ? fmtPhoneDisplay(o.contato) : '';
  document.getElementById('oc-form-descricao').value   = o?.descricao     || '';
  const motivoEl = document.getElementById('oc-form-motivo');
  if (motivoEl) motivoEl.value = o?.motivo || '';

  // Seção de escalonamento inicial — só em nova ocorrência
  const isNova = !o;
  const escToggle = document.getElementById('oc-form-esc-toggle');
  const escWrap   = document.getElementById('oc-form-esc-wrap');
  if (escToggle) escToggle.style.display = isNova ? '' : 'none';
  if (escWrap)   { escWrap.style.display = 'none'; escWrap.dataset.active = '0'; }
  if (isNova) _ocFormEscBuildNiveis();
  document.getElementById('oc-form-esc-motivo').value      = '';
  document.getElementById('oc-form-esc-responsavel').value = '';
  document.getElementById('oc-form-esc-data').value        = new Date().toISOString().split('T')[0];

  // Atribuir pra outro usuário — só em nova ocorrência, só pro Supervisor
  // (reatribuir uma já existente é feito pelo botão no card, não aqui).
  const atribuirWrap = document.getElementById('oc-form-atribuir-wrap');
  const atribuirSel   = document.getElementById('oc-form-atribuir');
  if (atribuirWrap && atribuirSel) {
    const mostrar = isNova && window.currentUser?.role === 'admin';
    atribuirWrap.style.display = mostrar ? '' : 'none';
    if (mostrar) {
      const usuarios = _ocUsuariosParaAtribuir();
      atribuirSel.innerHTML = `<option value="">Eu mesmo</option>` +
        usuarios.map(u => `<option value="${u.id}">${escapeHtml(u.nome_exibicao || u.email)}</option>`).join('');
    }
  }

  document.getElementById('oc-modal').classList.add('open');
  initPhoneMasks();
}

function _ocFormEscBuildNiveis() {
  const container = document.getElementById('oc-form-esc-nivel-opcoes');
  if (!container) return;
  // Níveis 1+ (Central é o padrão, não precisa escalonar pra ele)
  container.innerHTML = OC_HIERARQUIA.slice(1).map((h, i) => `
    <button type="button" class="oc-escalonar-nivel-btn ${i === 0 ? 'oc-escalonar-nivel-ativo' : ''}"
      data-nivel="${h.nivel}"
      style="--nivel-color:${h.color};--nivel-bg:${h.colorBg};--nivel-border:${h.colorBorder}"
      onclick="ocFormEscSelecionarNivel(${h.nivel})">
      <i class="ti ${h.icon}"></i>
      <span>${h.label}</span>
    </button>`).join('');
}

window.ocFormToggleEsc = function() {
  const wrap   = document.getElementById('oc-form-esc-wrap');
  const btn    = document.getElementById('oc-form-esc-toggle');
  const active = wrap.dataset.active === '1';
  wrap.dataset.active = active ? '0' : '1';
  wrap.style.display  = active ? 'none' : 'flex';
  btn.classList.toggle('oc-escalonar-nivel-ativo', !active);
};

window.ocFormEscSelecionarNivel = function(nivel) {
  document.querySelectorAll('#oc-form-esc-nivel-opcoes .oc-escalonar-nivel-btn').forEach(b => {
    b.classList.toggle('oc-escalonar-nivel-ativo', parseInt(b.dataset.nivel) === nivel);
  });
};

function closeOcorrenciaModal() {
  document.getElementById('oc-modal').classList.remove('open');
}

function submitOcorrenciaForm() {
  const id         = document.getElementById('oc-form-id').value;
  const abertura   = document.getElementById('oc-form-abertura').value;
  const limite     = document.getElementById('oc-form-limite').value;
  const central    = document.getElementById('oc-form-central').value.trim();
  const material   = document.getElementById('oc-form-material').value.trim();
  const operador   = document.getElementById('oc-form-operador').value.trim();
  const contatoRaw = document.getElementById('oc-form-contato').value.trim();
  const contato    = contatoRaw.replace(/\D/g, '') || null;
  const descricao  = document.getElementById('oc-form-descricao').value.trim();
  const motivo     = document.getElementById('oc-form-motivo')?.value.trim() || '';
  // Atribuir pra outro usuário (só existe/aparece em nova ocorrência, ver
  // openOcorrenciaModal) — vazio = "eu mesmo", vira undefined igual a uma
  // ocorrência nova sem atribuição (cai no fallback de _ocToDbRow).
  const atribuidoId = !id ? (document.getElementById('oc-form-atribuir')?.value || undefined) : undefined;

  if (!central)   { toast('Informe a central.', 'error'); return; }
  if (!descricao) { toast('Informe a descrição da solicitação.', 'error'); return; }

  // Escalonamento inicial
  const escWrap  = document.getElementById('oc-form-esc-wrap');
  const escAtivo = !id && escWrap?.dataset.active === '1';
  let hierarquiaInicial = [];
  if (escAtivo) {
    const escNivelBtn = document.querySelector('#oc-form-esc-nivel-opcoes .oc-escalonar-nivel-ativo');
    const escNivel    = escNivelBtn ? parseInt(escNivelBtn.dataset.nivel) : 1;
    const escMotivo   = document.getElementById('oc-form-esc-motivo').value.trim();
    const escResp     = document.getElementById('oc-form-esc-responsavel').value.trim();
    const escData     = document.getElementById('oc-form-esc-data').value;
    if (!escMotivo) { toast('Informe o motivo do escalonamento inicial.', 'error'); return; }
    hierarquiaInicial = [{ nivel: escNivel, motivo: escMotivo, responsavel: escResp || null, data: escData, criadoEm: Date.now(), acionadoPor: _ocNomeAtor() }];
  }

  const existing = id ? (state.ocorrencias || []).find(o => o.id === id) : null;
  // numero (exibição) nunca é regerado numa edição — mesmo em registros
  // antigos sem `numero` gravado, existing.id já cumpre esse papel.
  const numero = existing ? (existing.numero || existing.id) : _nextOcId();
  const ocorrencia = {
    id:           id || _ocGerarIdSeguro(),
    // Preserva o DONO ORIGINAL numa edição (undefined numa criação sem
    // atribuição — vira "ainda não resolvido", mesmo padrão do resto do
    // arquivo, cai no fallback de _ocToDbRow). Sem isto, editar a
    // ocorrência de outra pessoa perdia o vínculo com o dono real — ver o
    // comentário em _ocToDbRow (BUG REAL, 31/07). Numa criação NOVA com
    // atribuição (Supervisor escolheu alguém no modal), o escolhido já
    // nasce como dono — não precisa de reatribuição depois.
    userId:       existing?.userId || atribuidoId,
    numero,
    dataAbertura: abertura,
    motivo:       motivo,
    dataLimite:   limite || null,
    central,
    material:     material || null,
    operador:     operador || null,
    contato:      contato,
    descricao,
    concluida:    existing?.concluida     || false,
    dataConclusao: existing?.dataConclusao || null,
    descConclusao: existing?.descConclusao || null,
    hierarquia:   existing?.hierarquia    || hierarquiaInicial,
    criadoEm:     existing?.criadoEm      || Date.now(),
    // Nome de quem criou (31/07) — snapshot automático, nunca reescrito
    // numa edição (preserva o criador original mesmo se outra pessoa
    // editar depois). Sem isso, quem visse a ocorrência de outra conta
    // não tinha como saber de quem era (RLS de profiles bloqueia resolver
    // o nome de outro usuário — ver _ocToDbRow/criado_por_nome).
    criadoPorNome: existing?.criadoPorNome || window.currentUser?.nome_completo || window.currentUser?.email || null,
  };

  saveOcorrencia(ocorrencia);
  closeOcorrenciaModal();
  populateOcFiltros();
  toast(id ? 'Ocorrência atualizada.' : 'Ocorrência registrada.', 'success');
}

// ── Modal concluir ────────────────────────────────────────
function openConcluirModal(id) {
  document.getElementById('oc-concluir-id').value = id;
  document.getElementById('oc-concluir-data').value = new Date().toISOString().split('T')[0];
  document.getElementById('oc-concluir-desc').value = '';
  document.getElementById('oc-concluir-modal').classList.add('open');
}

function closeConcluirModal() {
  document.getElementById('oc-concluir-modal').classList.remove('open');
}

function submitConcluir() {
  const id   = document.getElementById('oc-concluir-id').value;
  const data = document.getElementById('oc-concluir-data').value;
  const desc = document.getElementById('oc-concluir-desc').value.trim();
  if (!desc) { toast('Informe uma descrição da conclusão.', 'error'); return; }
  const o = (state.ocorrencias || []).find(oc => oc.id === id);
  if (!o) return;
  o.concluida     = true;
  o.dataConclusao = data;
  o.descConclusao = desc;
  o.ultimaAcaoTipo = 'concluida';
  o.ultimaAcaoPorNome = _ocNomeAtor();
  persist();
  renderOcorrencias();
  closeConcluirModal();
  _ocSyncUpsert(o);
  toast('Ocorrência concluída!', 'success');
}

// ── Modal inconclusiva ────────────────────────────────────
function openInconclusivaModal(id) {
  document.getElementById('oc-inconclusiva-id').value   = id;
  document.getElementById('oc-inconclusiva-data').value = new Date().toISOString().split('T')[0];
  document.getElementById('oc-inconclusiva-motivo').value = '';
  document.getElementById('oc-inconclusiva-modal').classList.add('open');
}

function closeInconclusivaModal() {
  document.getElementById('oc-inconclusiva-modal').classList.remove('open');
}

function submitInconclusiva() {
  const id     = document.getElementById('oc-inconclusiva-id').value;
  const data   = document.getElementById('oc-inconclusiva-data').value;
  const motivo = document.getElementById('oc-inconclusiva-motivo').value.trim();
  if (!motivo) { toast('Informe o motivo da inconclusividade.', 'error'); return; }
  const o = (state.ocorrencias || []).find(oc => oc.id === id);
  if (!o) return;
  o.inconclusiva       = true;
  o.dataInconclusiva   = data;
  o.motivoInconclusiva = motivo;
  o.ultimaAcaoTipo = 'inconclusiva';
  o.ultimaAcaoPorNome = _ocNomeAtor();
  persist();
  renderOcorrencias();
  closeInconclusivaModal();
  _ocSyncUpsert(o);
  toast('Ocorrência marcada como inconclusiva.', 'info');
}

function reabrirOcorrencia(id) {
  const o = (state.ocorrencias || []).find(oc => oc.id === id);
  if (!o) return;
  o.inconclusiva       = false;
  o.dataInconclusiva   = null;
  o.motivoInconclusiva = null;
  o.ultimaAcaoTipo = 'reaberta';
  o.ultimaAcaoPorNome = _ocNomeAtor();
  persist();
  renderOcorrencias();
  _ocSyncUpsert(o);
  toast('Ocorrência reaberta.', 'success');
}

function reabrirOcorrenciaConcluida(id) {
  const o = (state.ocorrencias || []).find(oc => oc.id === id);
  if (!o) return;
  o.concluida      = false;
  o.dataConclusao  = null;
  o.descConclusao  = null;
  o.ultimaAcaoTipo = 'reaberta';
  o.ultimaAcaoPorNome = _ocNomeAtor();
  persist();
  renderOcorrencias();
  _ocSyncUpsert(o);
  toast('Ocorrência reaberta.', 'success');
}


// Modal de confirmação (31/07) — antes disparava direto no clique, só com
// undo por toast depois. Um clique sem querer já apagava, e o toast
// desaparecia em 6s sem ninguém notar. O modal agora é a barreira real; o
// undo continua como rede extra pra quem confirmou e se arrependeu.
function confirmarExcluirOcorrencia(id) {
  const o = (state.ocorrencias || []).find(oc => oc.id === id);
  if (!o) return;
  const label = [o.central, o.material].filter(Boolean).join(' / ');
  confirmarDestrutivo({
    title: 'Excluir ocorrência',
    sub: o.numero || o.id,
    body: `Isso remove a ocorrência${label ? ` <strong>${escapeHtml(label)}</strong>` : ''}. Depois de confirmar, ainda dá pra desfazer por alguns segundos no aviso que aparece.`,
    confirmLabel: 'Excluir',
    onConfirm: () => {
      // Usa toast com undo — guarda o registro específico (não o array
      // inteiro) para poder re-inserir só ele no Supabase se desfizer.
      const ocSnapshot = { ...o };
      deleteOcorrencia(id);
      toast(`Ocorrência "${label}" removida.`, 'info', 6000, () => {
        state.ocorrencias.push(ocSnapshot);
        persist();
        renderOcorrencias();
        _ocSyncUpsert(ocSnapshot);
      });
    },
  });
}

// ── Exclusão de ocorrência de Ajuste Sistêmico (DAI) ───────────────────
// Diferente de confirmarExcluirOcorrencia (destrutiva com undo simples),
// este fluxo exige que o analista marque um checkbox de ciência antes de
// poder confirmar — o registro está vinculado a um Documento de Ajuste de
// Inventário já emitido/impresso, com validade fiscal. A exclusão aqui
// NÃO tem undo por toast; em vez disso, grava um log permanente em
// state.ajustesExcluidos (nunca apagado) para responder por que aquele
// número de DAI não aparece mais no sistema, caso perguntado numa
// auditoria futura. Ver decisão registrada com o analista responsável
// pelo sistema (Hugo).
function confirmarExcluirAjusteSistemico(id) {
  const o = (state.ocorrencias || []).find(oc => oc.id === id);
  if (!o || !o.origemAjusteSistemico) return;
  const dai = (state.ajustesSistemicos || []).find(d => d.id === o.daiId) || null;
  const tag = dai?.tag || o.daiTag || dai?.numero || o.daiNumero || '—';
  const numero = dai?.numero || o.daiNumero || '—';

  confirmarDestrutivo({
    title: 'Excluir ocorrência de Ajuste Sistêmico',
    sub: tag,
    body: `
      <div style="display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;gap:8px;align-items:center">
          <span style="color:var(--text3);min-width:80px;font-size:12px">Documento</span>
          <strong>${escapeHtml(tag)}</strong>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span style="color:var(--text3);min-width:80px;font-size:12px">Nº fiscal</span>
          <span style="font-family:var(--mono);font-size:11.5px">${escapeHtml(numero)}</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span style="color:var(--text3);min-width:80px;font-size:12px">Central</span>
          <span>${escapeHtml(o.central || '—')}</span>
        </div>
        <div style="margin-top:8px;padding:10px 12px;background:var(--gold-bg);border:1px solid var(--gold-border);border-radius:6px;font-size:12px;color:var(--text2)">
          <i class="ti ti-alert-triangle" style="color:var(--gold)"></i>
          Este registro é vinculado a um Documento de Ajuste de Inventário (DAI) já gerado — provavelmente já impresso/enviado à controladoria. A exclusão daqui NÃO apaga o documento físico/PDF já emitido, e ficará registrada permanentemente num log interno de auditoria.
        </div>
      </div>`,
    confirmLabel: 'Excluir mesmo assim',
    requireConsent: true,
    consentLabel: 'Estou ciente de que este documento já foi emitido/apresentado e assumo a responsabilidade por esta exclusão.',
    onConfirm: () => {
      // Log permanente — nunca removido, mesmo que o resto seja excluído.
      // A tabela ajustes_excluidos no Supabase nem tem política de
      // UPDATE/DELETE — a garantia de "nunca apagado" é do próprio banco.
      if (!Array.isArray(state.ajustesExcluidos)) state.ajustesExcluidos = [];
      const logExclusao = {
        daiTag: tag,
        daiNumero: numero,
        central: o.central || null,
        dataGeracao: dai?.dataGeracao || null,
        excluidoPor: window.currentUser?.nome_completo || null,
        excluidoEm: Date.now(),
      };
      state.ajustesExcluidos.push(logExclusao);

      // Remove a cópia local dos anexos (a fonte oficial é o ZIP baixado na
      // hora da geração — ver dai.js)
      if (dai && Array.isArray(dai.anexos) && dai.anexos.length && typeof idbDeleteAnexosDai === 'function') {
        idbDeleteAnexosDai(dai.id, dai.anexos.length);
      }

      // Remove o registro de metadados do DAI e a ocorrência
      if (dai) state.ajustesSistemicos = (state.ajustesSistemicos || []).filter(d => d.id !== dai.id);
      state.ocorrencias = (state.ocorrencias || []).filter(oc => oc.id !== id);

      persist();
      renderOcorrencias();
      _ocSyncDelete(id, o.userId);
      if (dai && typeof _daiSyncDelete === 'function') _daiSyncDelete(dai.id, o.userId);
      if (window.supabaseClient) {
        window.supabaseClient.from('ajustes_excluidos').insert({
          dai_tag: logExclusao.daiTag,
          dai_numero: logExclusao.daiNumero,
          central: logExclusao.central,
          data_geracao: logExclusao.dataGeracao,
          excluido_por: logExclusao.excluidoPor,
          excluido_em: logExclusao.excluidoEm,
        }).then(({ error }) => {
          if (error) {
            console.warn('[Supabase] Falha ao registrar log de auditoria na nuvem:', error);
            toast('⚠ Excluído nesta sessão, mas o log de auditoria não pôde ser sincronizado com a nuvem.', 'error');
          }
        });
      }
      toast(`Ocorrência de Ajuste Sistêmico "${tag}" excluída. Registro de auditoria mantido.`, 'info');
    }
  });
}

// Busca no boot — log de auditoria é só união (nunca editado/excluído),
// então simplesmente mescla o que veio da nuvem com o que já existe local,
// sem risco de perder nada em qualquer direção.
async function syncAjustesExcluidosFromSupabase() {
  try {
    // fetchMineOrIntegrated pagina por cursor (sem teto de 10k do PostgREST)
    // e já aplica o filtro mine-or-integrated internamente.
    const filtrado = await fetchMineOrIntegrated('ajustes_excluidos', 'id, user_id, dai_tag, dai_numero, central, data_geracao, excluido_por, excluido_em');
    const remoto = filtrado.map(r => ({
      daiTag: r.dai_tag, daiNumero: r.dai_numero, central: r.central,
      dataGeracao: r.data_geracao, excluidoPor: r.excluido_por, excluidoEm: r.excluido_em,
    }));
    const local = Array.isArray(state.ajustesExcluidos) ? state.ajustesExcluidos : [];
    const chave = r => r.daiTag + '|' + r.excluidoEm;
    const vistos = new Set(local.map(chave));
    const novos = remoto.filter(r => !vistos.has(chave(r)));
    state.ajustesExcluidos = [...local, ...novos];

    // Corte de produção (27/07): registros de exclusão que só existem
    // local (a chamada original falhou na hora) sobem agora. Append-only,
    // então é insert — não upsert (a tabela não tem policy de UPDATE).
    const remotoSet = new Set(remoto.map(chave));
    const naoSincronizados = local.filter(r => !remotoSet.has(chave(r)));
    if (naoSincronizados.length) {
      const rows = naoSincronizados.map(r => ({
        dai_tag: r.daiTag, dai_numero: r.daiNumero, central: r.central,
        data_geracao: r.dataGeracao, excluido_por: r.excluidoPor, excluido_em: r.excluidoEm,
      }));
      const { error: insErr } = await window.supabaseClient.from('ajustes_excluidos').insert(rows);
      if (insErr) console.warn('[Supabase] Falha ao sincronizar log de exclusão de DAI local:', insErr);
    }
  } catch (err) {
    console.warn('[Supabase] Falha ao buscar log de auditoria (ajustesExcluidos) — mantendo dados locais.', err);
  }
}

// ── Render inicial da página ──────────────────────────────
function renderOcorrenciasPage() {
  if (!Array.isArray(state.ocorrencias)) state.ocorrencias = [];
  populateOcFiltros();
  renderOcorrencias();
}

// Fechamento por ESC dos modais de Ocorrências é tratado de forma
// centralizada em analitico.js (setupModalCloseOnEscape), que cobre
// todo elemento .modal-overlay do sistema — nenhum listener extra
// é necessário aqui.

Object.assign(window, {
  _ocRealtimeInit,
  _ocRealtimeStop,
  _ocDetectarMudancaPrioritaria,
  _ocMicroFilterCheckChange,
  ocToggleMicroFilter,
  ocFilterMicroOptions,
  ocApplyMicroFilter,
  ocCancelMicroFilter,
  ocClearMicroFilter,
  ocClearAllMicroFilters,
  ocToggleOrdenarDropdown,
  ocSetOrdenar,
  ocStatusMatches,
  _ocMicroFilter,
  renderOcorrenciasPage,
  renderOcorrencias,
  openOcorrenciaModal,
  closeOcorrenciaModal,
  submitOcorrenciaForm,
  ocFormToggleEsc,
  ocFormEscSelecionarNivel,
  openConcluirModal,
  closeConcluirModal,
  submitConcluir,
  openInconclusivaModal,
  closeInconclusivaModal,
  submitInconclusiva,
  reabrirOcorrencia,
  reabrirOcorrenciaConcluida,
  confirmarExcluirOcorrencia,
  confirmarExcluirAjusteSistemico,
  getOcorrenciasFiltradas,
  openOcDetailModal,
  closeOcDetailModal,
  openEscalonarModal,
  closeEscalonarModal,
  submitEscalonar,
  openAtribuirModal,
  closeAtribuirModal,
  submitAtribuir,
  reatribuirOcorrencia,
  ocSelecionarNivel,
  openEditarEscalonamentoModal,
  closeEditarEscalonamentoModal,
  submitEditarEscalonamento,
  descalonar,
});
