'use strict';

// ═══════════════════════════════════════════════════════════
// MENSAGENS — chat entre usuários
// ═══════════════════════════════════════════════════════════
// ETAPA 1 (casca visual) — plano combinado com o Hugo em 28/07:
//   1. Casca visual: item "Mensagens" + popover + avatares no topbar  ← AQUI
//   2. Utilitário de avatar (cor + inicial a partir do e-mail/id)
//   3. Presença global (tirar o polling de last_seen de dentro do Admin)
//   4. Tabela `mensagens` no Supabase
//   5. Política de RLS (remetente OU destinatário OU geral OU admin)
//   6. Envio/recebimento manual (1:1)
//   7. Chat geral
//   8. Canal Realtime dedicado
//   9. Clique no avatar do topbar → abre o chat com aquela pessoa
//  10. Abertura automática da janela ao receber mensagem + som + badge
//  11. Testes de RLS e casos de borda
//
// Nesta entrega: só a troca de conversa "ativa" na lista funciona (visual,
// local, sem Supabase). O popover em si (abrir/fechar/arrastar/trazer pra
// frente) já funciona de graça via openTool()/closeTool() — mecanismo
// genérico de format.js, reaproveitado sem nenhuma mudança lá.
//
// A lista de conversas 1:1 (uma por usuário online) ainda não é
// preenchida — isso entra na Etapa 3, junto com a fileira de avatares do
// topbar (mesma fonte de presença pras duas coisas).

// ═══════════════════════════════════════════════════════════
// AVATAR — cor determinística + inicial (Etapa 2)
// ═══════════════════════════════════════════════════════════
// Não existe coluna de foto em `profiles`, então o avatar é sempre
// gerado: um círculo colorido com a inicial do e-mail, no estilo do
// Gmail/Google Workspace quando o usuário não tem foto configurada.
//
// A cor vem de uma paleta FIXA das variáveis semânticas do próprio tema
// (--accent/--teal/--purple/--green/--amber/--red), escolhida por um hash
// simples do e-mail/id — a mesma pessoa sempre cai na mesma cor, e a cor
// já se adapta sozinha à troca de tema (dark/graphite/light/sand), porque
// é a variável CSS que muda, não um hex fixo calculado aqui.
//
// --gold fica de fora de propósito: é reservado só pro status "Ajuste
// Sistêmico" (DAI) em Ocorrências (ver tokens.css) — não pode ser
// reaproveitado pra mais nada, pra manter esse sinal visual exclusivo.
//
// Não prefixado com "msgs" de propósito — é usado tanto no chat quanto
// na fileira de avatares do topbar (Etapa 3), e pode vir a ser reutilizado
// em outras telas (ex.: tabela de usuários do Admin) no futuro.
const AVATAR_COLOR_VARS = ['--accent', '--teal', '--purple', '--green', '--amber', '--red'];

function _avatarHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

// Retorna { initial, colorVar } a partir de um e-mail (ou qualquer string
// estável — id do usuário também serve, caso o e-mail não esteja
// disponível no momento da chamada).
function avatarInfo(seed) {
  const s = String(seed || '').trim();
  const colorVar = AVATAR_COLOR_VARS[_avatarHash(s) % AVATAR_COLOR_VARS.length];
  const namePart = s.includes('@') ? s.split('@')[0] : s;
  const initial = (namePart.trim()[0] || '?').toUpperCase();
  return { initial, colorVar };
}

// Monta o HTML de um avatar circular pronto pra inserir no DOM. A classe
// de tamanho/posição (online-avatar, msgs-conv-avatar...) é decidida por
// quem chama — esta função só resolve cor + inicial, uma vez só.
// Com foto real (avatar_url, cadastrada em Conta → Gerenciar Conta) ela
// tem prioridade sobre o círculo colorido — mesma foto que o dono vê no
// próprio topbar aparece aqui pros outros usuários (presença, chat etc.).
function avatarHTML(seed, className, extraAttrs, avatarUrl) {
  if (avatarUrl) return `<img class="${className}" src="${avatarUrl}" alt="" ${extraAttrs || ''}>`;
  const { initial, colorVar } = avatarInfo(seed);
  return `<div class="${className}" style="background:var(${colorVar})" ${extraAttrs || ''}>${initial}</div>`;
}

// ═══════════════════════════════════════════════════════════
// PRESENÇA GLOBAL — fileira de avatares online no topbar (Etapa 3)
// ═══════════════════════════════════════════════════════════
// Independente do polling que já existe em admin.js (esse continua só
// pra tabela detalhada da aba Usuários — email/role/created_at, que só
// o admin consegue ler direto de `profiles` via RLS). Este aqui roda
// pra QUALQUER usuário logado, o tempo todo — não só com uma tela
// específica aberta — usando a RPC usuarios_presenca() (28/07): um
// usuário comum não pode ler a linha de outra pessoa direto em
// `profiles` (RLS é dono OU admin, e isso não mudou). A RPC devolve só
// id/email/last_seen, nada além disso — profiles continua com a mesma
// política restrita de sempre.
//
// Mesmo corte do admin.js (_adminStatusInfo): ≤10min sem heartbeat =
// online. Diferente do admin, aqui só nos importa "online ou não"
// (decisão de 28/07) — sem estados away/offline, porque quem não está
// online simplesmente não aparece na fileira.

// Prefixo MSGS_ proposital — admin.js já declara PRESENCE_ONLINE_MS/
// PRESENCE_POLL_MS no escopo global (com valores/propósito próprios, ver
// _adminStatusInfo). Como nenhum dos dois arquivos é ES module, os dois
// <script defer> compartilham o mesmo escopo global léxico da página, e
// duas declarações `const` de mesmo nome em arquivos diferentes colidem
// exatamente como colidiriam num arquivo só (SyntaxError: Identifier
// already declared — quebrava mensagens.js inteiro, silenciosamente).
const MSGS_PRESENCE_ONLINE_MS = 10 * 60 * 1000;
const MSGS_PRESENCE_POLL_MS   = 30 * 1000;

let _presenceGlobalInterval = null;

// Conversa aberta no momento no popover — 'geral' ou o id (uuid) da
// pessoa. Lido por openTool() em format.js pra recarregar o histórico
// certo quando o popover é reaberto (ver ali).
let _msgsConversaAtiva = 'geral';

function _presenceEsc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Cache dos dados de todo mundo (id → {email, nome_exibicao, avatar_url,
// ...}), atualizado a cada tick de presença. Usado pra identificar o autor
// de cada mensagem no chat Geral (_msgsBubbleHTML) sem precisar de uma
// segunda consulta — a mesma RPC já traz tudo que precisamos.
let _msgsUsuariosPorId = {};

async function _presenceGlobalTick() {
  if (!window.supabaseClient || !window.currentUser?.id) return;

  const { data, error } = await window.supabaseClient.rpc('usuarios_presenca');
  if (error) {
    console.warn('[Presença] Falha ao buscar usuários:', error);
    return;
  }

  (data || []).forEach(u => { _msgsUsuariosPorId[u.id] = u; });

  const agora = Date.now();
  const meuId = window.currentUser.id;
  const todos = (data || [])
    .filter(u => u.id !== meuId)
    .sort((a, b) => (a.email || '').localeCompare(b.email || ''));

  const onlineIds = new Set(
    todos
      .filter(u => u.last_seen && (agora - new Date(u.last_seen).getTime()) <= MSGS_PRESENCE_ONLINE_MS)
      .map(u => u.id)
  );

  // Fileira de avatares do topbar — continua só com quem está online agora
  // (isso aqui é presença de verdade, não lista de contatos).
  const wrap = document.getElementById('online-users-wrap');
  const list = document.getElementById('online-users-list');
  if (wrap && list) {
    const online = todos.filter(u => onlineIds.has(u.id));
    if (!online.length) {
      wrap.style.display = 'none';
      list.innerHTML = '';
    } else {
      // Clique no avatar do topbar abre o Mensagens já na conversa daquela
      // pessoa (Etapa 9) — reaproveita openTool()/msgsAbrirConversa() que já
      // existem, sem precisar de uma função nova só pra isso.
      list.innerHTML = online.map(u => {
        const nome = u.nome_exibicao?.trim() || (u.email || '').split('@')[0];
        const onclick = `openTool('mensagens'); msgsAbrirConversa('${u.id}')`;
        return avatarHTML(u.email, 'online-avatar', `title="${_presenceEsc(nome)} — online" onclick="${onclick}"`, u.avatar_url);
      }).join('');
      wrap.style.display = 'flex';
    }
  }

  // Lista de conversas do popover — TODO MUNDO, esteja online ou não (28/07:
  // Hugo pediu pra poder mandar mensagem independente de status). O status
  // ainda aparece no subtítulo de cada item, só não filtra mais quem entra
  // na lista.
  msgsRenderConversas(todos, onlineIds);
}

// ═══════════════════════════════════════════════════════════
// LISTA DE CONVERSAS 1:1 (Etapa 1, concluindo)
// ═══════════════════════════════════════════════════════════
// Chamada a cada tick de presença, com o array de usuários online que
// _presenceGlobalTick já buscou. "Geral" é fixo no HTML (index.html) e
// nunca é tocado aqui — só os itens 1:1, marcados com
// .msgs-conv-item-injetado, são removidos e reconstruídos do zero a cada
// chamada (mais simples que fazer diff, e o volume é pequeno).
function msgsRenderConversas(todos, onlineIds) {
  const list = document.getElementById('msgs-conv-list');
  const hint = document.getElementById('msgs-conv-empty-hint');
  if (!list) return;

  const activeId = list.querySelector('.msgs-conv-item.active')?.dataset.conv || 'geral';

  list.querySelectorAll('.msgs-conv-item-injetado').forEach(el => el.remove());

  todos.forEach(u => {
    const nome = u.nome_exibicao?.trim() || (u.email || '').split('@')[0];
    const estaOnline = onlineIds.has(u.id);
    const classeItem = 'msgs-conv-item msgs-conv-item-injetado' + (estaOnline ? '' : ' msgs-conv-item-offline');
    const classePreview = 'msgs-conv-preview' + (estaOnline ? ' msgs-conv-preview-online' : '');
    list.insertAdjacentHTML('beforeend', `
      <button class="${classeItem}" data-conv="${u.id}" onclick="msgsAbrirConversa('${u.id}')">
        ${avatarHTML(u.email, 'msgs-conv-avatar', '', u.avatar_url)}
        <div class="msgs-conv-body">
          <div class="msgs-conv-name">${_presenceEsc(nome)}</div>
          <div class="${classePreview}">${estaOnline ? 'Online' : 'Offline'}</div>
        </div>
      </button>`);
  });

  if (hint) hint.style.display = todos.length ? 'none' : '';

  // Se a conversa ativa era com alguém que não existe mais na lista (caso
  // raro — usuário removido do sistema), volta pro Geral. Como a lista
  // agora traz todo mundo (não só quem está online), isso praticamente
  // nunca mais deve acontecer por alguém simplesmente ter saído do ar.
  const continuaExistindo = activeId === 'geral' || todos.some(u => u.id === activeId);
  if (continuaExistindo) {
    list.querySelectorAll('.msgs-conv-item').forEach(el => el.classList.toggle('active', el.dataset.conv === activeId));
  } else {
    msgsAbrirConversa('geral');
  }
}

// Chamada no boot (dashboard.js, STEP 5) — idempotente, mesmo padrão de
// _activityRealtimeInit(). Roda pra qualquer usuário logado, o tempo
// todo, não só dentro do Admin.
function _presenceGlobalInit() {
  if (_presenceGlobalInterval) return;
  _presenceGlobalTick();
  _presenceGlobalInterval = setInterval(_presenceGlobalTick, MSGS_PRESENCE_POLL_MS);
}

// Chamada no SIGNED_OUT sem reload (auth.js) — mesmo cuidado do canal de
// atividade: sem isso, o polling continuaria rodando com uma sessão
// derrubada até a próxima navegação.
function _presenceGlobalStop() {
  clearInterval(_presenceGlobalInterval);
  _presenceGlobalInterval = null;
  const wrap = document.getElementById('online-users-wrap');
  const list = document.getElementById('online-users-list');
  if (wrap) wrap.style.display = 'none';
  if (list) list.innerHTML = '';
}

function msgsAbrirConversa(convId) {
  const list = document.getElementById('msgs-conv-list');
  if (!list) return;

  const item = list.querySelector(`.msgs-conv-item[data-conv="${CSS.escape(convId)}"]`);
  if (!item) return;

  list.querySelectorAll('.msgs-conv-item').forEach(el => el.classList.toggle('active', el === item));

  // Espelha nome/subtítulo/avatar da conversa clicada no cabeçalho — lê do
  // próprio item da lista em vez de duplicar os dados em outro lugar.
  const nameDst = document.getElementById('msgs-chat-header-name');
  const subDst  = document.getElementById('msgs-chat-header-sub');
  const avatarDst = document.getElementById('msgs-chat-header-avatar');
  const nameSrc = item.querySelector('.msgs-conv-name')?.textContent || '';
  const subSrc  = item.querySelector('.msgs-conv-preview')?.textContent || '';
  const avatarSrc = item.querySelector('.msgs-conv-avatar');
  if (nameDst) nameDst.textContent = nameSrc;
  if (subDst)  subDst.textContent  = subSrc;
  if (avatarDst && avatarSrc) {
    const clone = avatarSrc.cloneNode(true);
    clone.id = 'msgs-chat-header-avatar';
    avatarDst.replaceWith(clone);
  }

  _msgsConversaAtiva = convId;

  const input      = document.getElementById('msgs-input');
  const sendBtn    = document.getElementById('msgs-send-btn');
  const attachBtn  = document.getElementById('msgs-attach-btn');
  const limparBtn  = document.getElementById('msgs-limpar-conversa-btn');
  if (input)     input.disabled     = false;
  if (sendBtn)   sendBtn.disabled   = false;
  if (attachBtn) attachBtn.disabled = false;
  if (limparBtn) limparBtn.style.display = window.currentUser?.role === 'admin' ? '' : 'none';

  _msgsCarregarHistorico(convId);
}

// ═══════════════════════════════════════════════════════════
// ENVIO/RECEBIMENTO — 1:1 e Geral (Etapas 6 e 7)
// ═══════════════════════════════════════════════════════════
// "Manual" de propósito (nome do plano original): carrega o histórico ao
// abrir a conversa e envia por INSERT direto. Não há atualização
// automática enquanto a janela fica aberta com a conversa parada — isso
// é o canal Realtime dedicado da Etapa 8, ainda não implementado. RLS na
// tabela `mensagens` já garante remetente/destinatário/geral/admin —
// testado com múltiplas identidades reais antes desta entrega.

function _msgsScrollParaFinal() {
  const body = document.getElementById('msgs-chat-body');
  if (body) body.scrollTop = body.scrollHeight;
}

// No Geral (várias pessoas na mesma janela), cada bolha alheia leva
// foto+nome de quem mandou — no 1:1 isso já é óbvio pelo cabeçalho da
// conversa, então só entra aqui quando a conversa ativa é 'geral'.
function _msgsAutorHTML(remetenteId) {
  const u = _msgsUsuariosPorId[remetenteId];
  const nome = u?.nome_exibicao?.trim() || (u?.email || '').split('@')[0] || '—';
  return `<div class="msgs-msg-autor">
    ${avatarHTML(u?.email, 'msgs-msg-avatar', '', u?.avatar_url)}
    <span>${escapeHtml(nome)}</span>
  </div>`;
}

// Cache de signed URLs (bucket é privado, não dá pra usar o path direto
// num <img src>) — path → { url, expira }. Populado por
// _msgsPreCarregarPreviews antes de qualquer bolha com imagem ser
// desenhada (histórico, envio próprio ou recebido em tempo real).
let _msgsSignedUrlCache = {};
const _MSGS_SIGNED_URL_TTL_MS = 60 * 60 * 1000; // 1h — mesmo prazo passado pro createSignedUrls

async function _msgsPreCarregarPreviews(msgs) {
  if (!window.supabaseClient) return;
  const agora = Date.now();
  const paths = [...new Set(
    (msgs || [])
      .filter(m => m.anexo_path && !m.excluida_em && _msgsEhImagem(m.anexo_nome))
      .map(m => m.anexo_path)
  )].filter(p => !_msgsSignedUrlCache[p] || _msgsSignedUrlCache[p].expira <= agora);
  if (!paths.length) return;

  const { data, error } = await window.supabaseClient.storage
    .from('mensagens-anexos')
    .createSignedUrls(paths, _MSGS_SIGNED_URL_TTL_MS / 1000);
  if (error || !data) return;

  data.forEach((item, i) => {
    if (item.signedUrl) _msgsSignedUrlCache[paths[i]] = { url: item.signedUrl, expira: agora + _MSGS_SIGNED_URL_TTL_MS };
  });
}

// Anexo dentro da bolha: imagem já com preview pronto (cache populado por
// _msgsPreCarregarPreviews) vira uma miniatura clicável; qualquer outro
// caso (arquivo não-imagem, ou preview ainda não carregado) cai no chip
// de nome+tamanho — os dois abrem o mesmo modal de pré-visualização (ver
// _msgsAbrirAnexo). Dados em data-* em vez de interpolar no onclick —
// nome original do arquivo pode ter aspas/caracteres que quebrariam o
// atributo inline.
function _msgsAnexoHTML(msg) {
  if (!msg.anexo_path) return '';
  const nome = msg.anexo_nome || 'arquivo';
  const dataAttrs = `data-anexo-path="${escapeHtml(msg.anexo_path)}" data-anexo-nome="${escapeHtml(nome)}" data-anexo-tamanho="${msg.anexo_tamanho || 0}"`;

  const previewUrl = _msgsEhImagem(nome) ? _msgsSignedUrlCache[msg.anexo_path]?.url : null;
  if (previewUrl) {
    return `<button type="button" class="msgs-anexo-img-wrap" ${dataAttrs} onclick="_msgsAbrirAnexo(this)">
      <img src="${previewUrl}" alt="${escapeHtml(nome)}" loading="lazy">
    </button>`;
  }

  const tam = typeof formatBytes === 'function' ? formatBytes(msg.anexo_tamanho) : '';
  return `<button type="button" class="msgs-anexo-chip" ${dataAttrs} onclick="_msgsAbrirAnexo(this)">
    <i class="ti ti-file-text"></i>
    <span class="msgs-anexo-chip-nome">${escapeHtml(nome)}</span>
    <span class="msgs-anexo-chip-tam">${tam}</span>
  </button>`;
}

// Quem mandou apaga a própria mensagem; admin apaga qualquer uma — só
// decide se o botão aparece (a segurança de verdade é a RLS de UPDATE,
// que segue exatamente essa mesma regra).
function _msgsExcluirHTML(msg, souEu) {
  const podeExcluir = souEu || window.currentUser?.role === 'admin';
  if (!podeExcluir) return '';
  const anexoArg = msg.anexo_path ? `'${msg.anexo_path}'` : 'null';
  return `<button type="button" class="msgs-msg-del" title="Excluir mensagem" onclick="_msgsExcluir('${msg.id}', ${anexoArg})"><i class="ti ti-trash"></i></button>`;
}

// Nome de exibição de quem apagou — "Você" só na tela de quem
// efetivamente apagou (cada cliente resolve contra o próprio
// currentUser.id), o nome de verdade pra todo mundo mais.
function _msgsNomeUsuario(userId) {
  if (userId === window.currentUser?.id) return 'Você';
  const u = _msgsUsuariosPorId[userId];
  return u?.nome_exibicao?.trim() || (u?.email || '').split('@')[0] || 'um usuário';
}

// Mensagem apagada (soft delete) — vira uma "lápide" no lugar dela: quem
// apagou (e, se foi admin apagando mensagem alheia, de quem era), sem
// texto/anexo. Registro fica visível pra sempre, não só até recarregar.
function _msgsTombstoneHTML(msg, souEu) {
  const hora = new Date(msg.criado_em).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
  const quem = _msgsNomeUsuario(msg.excluida_por);
  const texto = (msg.excluida_por === msg.remetente_id)
    ? `${quem} apagou esta mensagem.`
    : `${quem} apagou uma mensagem de ${_msgsNomeUsuario(msg.remetente_id)}.`;
  return `<div class="msgs-msg msgs-msg-tombstone ${souEu ? 'msgs-msg-mine' : 'msgs-msg-theirs'}" data-msg-id="${msg.id}">
    <i class="ti ti-trash"></i> ${escapeHtml(texto)}
    <div class="msgs-msg-meta">${hora}</div>
  </div>`;
}

function _msgsBubbleHTML(msg, souEu) {
  if (msg.excluida_em) return _msgsTombstoneHTML(msg, souEu);

  const hora = new Date(msg.criado_em).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
  const autorHTML = (!souEu && _msgsConversaAtiva === 'geral') ? _msgsAutorHTML(msg.remetente_id) : '';
  const texto = msg.conteudo ? escapeHtml(msg.conteudo) : '';
  return `<div class="msgs-msg ${souEu ? 'msgs-msg-mine' : 'msgs-msg-theirs'}" data-msg-id="${msg.id}">
    ${autorHTML}
    ${_msgsAnexoHTML(msg)}
    ${texto}
    <div class="msgs-msg-meta">${hora}${_msgsExcluirHTML(msg, souEu)}</div>
  </div>`;
}

const _MSGS_SELECT_COLS = 'id, remetente_id, destinatario_id, conteudo, criado_em, lido, anexo_path, anexo_nome, anexo_tamanho, excluida_em, excluida_por';

async function _msgsExcluir(msgId, anexoPath) {
  if (!window.supabaseClient || !window.currentUser?.id) return;
  if (!confirm('Excluir esta mensagem? Não pode ser desfeito.')) return;

  const { data, error } = await window.supabaseClient
    .from('mensagens')
    .update({
      conteudo: '', anexo_path: null, anexo_nome: null, anexo_tamanho: null,
      excluida_em: new Date().toISOString(), excluida_por: window.currentUser.id,
    })
    .eq('id', msgId)
    .select(_MSGS_SELECT_COLS)
    .single();

  if (error) {
    console.warn('[Mensagens] Falha ao excluir mensagem:', error);
    if (typeof toast === 'function') toast('Não foi possível excluir a mensagem.', 'error');
    return;
  }

  if (anexoPath) {
    window.supabaseClient.storage.from('mensagens-anexos').remove([anexoPath])
      .then(({ error: errStorage }) => {
        if (errStorage) console.warn('[Mensagens] Falha ao remover anexo do Storage:', errStorage);
      });
  }

  const el = document.querySelector(`.msgs-msg[data-msg-id="${CSS.escape(msgId)}"]`);
  if (el) el.outerHTML = _msgsBubbleHTML(data, data.remetente_id === window.currentUser.id);
}

// Admin só — apaga (soft delete) todas as mensagens ainda não apagadas da
// conversa aberta no momento, Geral incluso.
async function _msgsLimparConversa() {
  if (!window.supabaseClient || !window.currentUser?.id || window.currentUser.role !== 'admin') return;
  const destino = _msgsConversaAtiva;
  const label = destino === 'geral' ? 'o chat Geral inteiro' : 'esta conversa inteira';
  if (!confirm(`Limpar ${label}? Todas as mensagens serão marcadas como apagadas. Não pode ser desfeito.`)) return;

  const meuId = window.currentUser.id;
  let query = window.supabaseClient.from('mensagens').select('id, anexo_path').is('excluida_em', null);
  query = (destino === 'geral')
    ? query.is('destinatario_id', null)
    : query.or(`and(remetente_id.eq.${meuId},destinatario_id.eq.${destino}),and(remetente_id.eq.${destino},destinatario_id.eq.${meuId})`);

  const { data: alvos, error: errSel } = await query;
  if (errSel) {
    console.warn('[Mensagens] Falha ao buscar mensagens pra limpar:', errSel);
    if (typeof toast === 'function') toast('Não foi possível limpar a conversa.', 'error');
    return;
  }
  if (!alvos || !alvos.length) return;

  const { error } = await window.supabaseClient
    .from('mensagens')
    .update({
      conteudo: '', anexo_path: null, anexo_nome: null, anexo_tamanho: null,
      excluida_em: new Date().toISOString(), excluida_por: meuId,
    })
    .in('id', alvos.map(m => m.id));

  if (error) {
    console.warn('[Mensagens] Falha ao limpar conversa:', error);
    if (typeof toast === 'function') toast('Não foi possível limpar a conversa.', 'error');
    return;
  }

  const paths = alvos.map(m => m.anexo_path).filter(Boolean);
  if (paths.length) {
    window.supabaseClient.storage.from('mensagens-anexos').remove(paths)
      .then(({ error: errStorage }) => { if (errStorage) console.warn('[Mensagens] Falha ao remover anexos:', errStorage); });
  }

  _msgsCarregarHistorico(destino);
  if (typeof toast === 'function') toast('Conversa limpa.', 'success');
}

// ── Pré-visualização de anexo (modal) ────────────────────
let _msgsAnexoPreviewUrl = null;

function _msgsEhImagem(nome) {
  return /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(nome || '');
}

async function _msgsAbrirAnexo(btn) {
  if (!window.supabaseClient) return;
  const path     = btn.dataset.anexoPath;
  const nome     = btn.dataset.anexoNome;
  const tamanho  = Number(btn.dataset.anexoTamanho) || 0;
  const origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .7s linear infinite"></i> Abrindo...';

  const { data, error } = await window.supabaseClient.storage.from('mensagens-anexos').download(path);

  btn.disabled = false;
  btn.innerHTML = origHtml;

  if (error || !data) {
    if (typeof toast === 'function') toast('Não foi possível abrir o anexo.', 'error');
    return;
  }

  if (_msgsAnexoPreviewUrl) URL.revokeObjectURL(_msgsAnexoPreviewUrl);
  _msgsAnexoPreviewUrl = URL.createObjectURL(data);

  const nomeEl = document.getElementById('anexo-preview-nome');
  const tamEl  = document.getElementById('anexo-preview-tam');
  const bodyEl = document.getElementById('anexo-preview-body');
  if (nomeEl) nomeEl.textContent = nome || 'Anexo';
  if (tamEl)  tamEl.textContent  = typeof formatBytes === 'function' ? formatBytes(tamanho) : '';
  if (bodyEl) {
    bodyEl.innerHTML = _msgsEhImagem(nome)
      ? `<img src="${_msgsAnexoPreviewUrl}" alt="${escapeHtml(nome || '')}" style="max-width:100%;max-height:60vh;border-radius:8px;object-fit:contain">`
      : `<div class="anexo-preview-generico"><i class="ti ti-file-text"></i><span>Pré-visualização não disponível para este tipo de arquivo.</span></div>`;
  }

  if (typeof openModal === 'function') openModal('modal-anexo-preview');
}

function _msgsAbrirAnexoNovaGuia() {
  if (_msgsAnexoPreviewUrl) window.open(_msgsAnexoPreviewUrl, '_blank');
}

async function _msgsCarregarHistorico(convId) {
  const body = document.getElementById('msgs-chat-body');
  if (!body || !window.supabaseClient || !window.currentUser?.id) return;

  const meuId = window.currentUser.id;
  body.innerHTML = '<div class="msgs-empty-state"><i class="ti ti-loader-2" style="animation:spin .7s linear infinite"></i><p>Carregando...</p></div>';

  let query = window.supabaseClient.from('mensagens').select(_MSGS_SELECT_COLS);
  query = (convId === 'geral')
    ? query.is('destinatario_id', null)
    : query.or(`and(remetente_id.eq.${meuId},destinatario_id.eq.${convId}),and(remetente_id.eq.${convId},destinatario_id.eq.${meuId})`);

  const { data, error } = await query.order('criado_em', { ascending: true }).limit(200);

  // A conversa pode ter mudado enquanto a busca estava em andamento — não
  // pinta uma resposta desatualizada por cima da conversa atual.
  if (_msgsConversaAtiva !== convId) return;

  if (error) {
    console.warn('[Mensagens] Falha ao carregar histórico:', error);
    body.innerHTML = '<div class="msgs-empty-state"><i class="ti ti-alert-triangle"></i><p>Não foi possível carregar as mensagens.</p></div>';
    return;
  }

  if (!data || !data.length) {
    const msgVazio = convId === 'geral' ? 'Nenhuma mensagem ainda. Seja o primeiro a escrever.' : 'Nenhuma mensagem ainda. Comece a conversa.';
    body.innerHTML = `<div class="msgs-empty-state"><i class="ti ti-message-circle-2"></i><p>${msgVazio}</p></div>`;
  } else {
    await _msgsPreCarregarPreviews(data);
    if (_msgsConversaAtiva !== convId) return; // pode ter mudado durante o fetch dos previews
    body.innerHTML = data.map(m => _msgsBubbleHTML(m, m.remetente_id === meuId)).join('');
    _msgsScrollParaFinal();
  }

  // Marca como lidas as que eu recebi nessa conversa 1:1 — geral não tem
  // "lido" por pessoa, então não se aplica (RLS também bloquearia: a
  // policy de update só permite quando destinatario_id = eu).
  if (convId !== 'geral') {
    const temNaoLida = (data || []).some(m => m.destinatario_id === meuId && !m.lido);
    if (temNaoLida) {
      window.supabaseClient.from('mensagens')
        .update({ lido: true })
        .eq('destinatario_id', meuId)
        .eq('remetente_id', convId)
        .eq('lido', false)
        .then(({ error: errLido }) => {
          if (errLido) console.warn('[Mensagens] Falha ao marcar como lidas:', errLido);
        });
    }
  }
}

// ═══════════════════════════════════════════════════════════
// BUSCA — texto, anexo e data (Etapa 14)
// ═══════════════════════════════════════════════════════════
// Um painel só, reaproveitado pelos dois botões de lupa (topo do popover
// e cabeçalho de cada conversa) — o que muda é o escopo padrão
// selecionado. Resultado é sempre mostrado ali mesmo (bolha própria, com
// nome de quem mandou + de qual conversa, se for busca "todas") — não
// tenta rolar até a mensagem na conversa ao vivo, porque o histórico só
// carrega as últimas 200 e a busca pode achar coisa mais antiga que isso.
let _msgsBuscaAtiva = false;

function _msgsAbrirBusca(escopoPadrao) {
  _msgsBuscaAtiva = true;
  const escopoSel = document.getElementById('msgs-search-escopo');
  if (escopoSel) escopoSel.value = escopoPadrao;
  const overlay = document.getElementById('msgs-search-overlay');
  if (overlay) overlay.style.display = 'flex';
  document.getElementById('msgs-search-texto')?.focus();
}

function _msgsFecharBusca() {
  _msgsBuscaAtiva = false;
  const overlay = document.getElementById('msgs-search-overlay');
  if (overlay) overlay.style.display = 'none';
}

// Rótulo "em Geral" / "em Fulano" — só aparece nos resultados de busca
// "todas as conversas", pra saber de onde veio cada mensagem.
function _msgsConversaLabel(msg) {
  if (msg.destinatario_id === null) return 'Geral';
  const outroId = msg.remetente_id === window.currentUser?.id ? msg.destinatario_id : msg.remetente_id;
  return _msgsNomeUsuario(outroId);
}

function _msgsResultadoHTML(msg, mostrarConversa) {
  const data = new Date(msg.criado_em).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
  const convLabel = mostrarConversa ? `<span class="msgs-search-result-conv">em ${escapeHtml(_msgsConversaLabel(msg))}</span>` : '';
  const texto = msg.conteudo ? `<div class="msgs-search-result-texto">${escapeHtml(msg.conteudo)}</div>` : '';
  return `<div class="msgs-search-result">
    <div class="msgs-search-result-top">
      <strong>${escapeHtml(_msgsNomeUsuario(msg.remetente_id))}</strong>
      ${convLabel}
      <span class="msgs-search-result-data">${data}</span>
    </div>
    ${_msgsAnexoHTML(msg)}
    ${texto}
  </div>`;
}

async function _msgsBuscar() {
  if (!window.supabaseClient || !window.currentUser?.id) return;
  const resultsEl = document.getElementById('msgs-search-results');
  if (!resultsEl) return;

  const texto   = (document.getElementById('msgs-search-texto')?.value || '').trim();
  const soAnexo = document.getElementById('msgs-search-so-anexo')?.checked;
  const dataDe  = document.getElementById('msgs-search-data-de')?.value;
  const dataAte = document.getElementById('msgs-search-data-ate')?.value;
  const escopo  = document.getElementById('msgs-search-escopo')?.value || 'atual';

  if (!texto && !soAnexo && !dataDe && !dataAte) {
    resultsEl.innerHTML = '<div class="msgs-empty-state"><i class="ti ti-search"></i><p>Digite um termo, escolha um período ou filtre por anexo.</p></div>';
    return;
  }

  resultsEl.innerHTML = '<div class="msgs-empty-state"><i class="ti ti-loader-2" style="animation:spin .7s linear infinite"></i><p>Buscando...</p></div>';

  const meuId = window.currentUser.id;
  let query = window.supabaseClient.from('mensagens').select(_MSGS_SELECT_COLS).is('excluida_em', null);

  if (escopo === 'atual') {
    const convId = _msgsConversaAtiva;
    query = (convId === 'geral')
      ? query.is('destinatario_id', null)
      : query.or(`and(remetente_id.eq.${meuId},destinatario_id.eq.${convId}),and(remetente_id.eq.${convId},destinatario_id.eq.${meuId})`);
  }
  if (texto)   query = query.ilike('conteudo', `%${texto}%`);
  if (soAnexo) query = query.not('anexo_path', 'is', null);
  if (dataDe)  query = query.gte('criado_em', `${dataDe}T00:00:00`);
  if (dataAte) query = query.lte('criado_em', `${dataAte}T23:59:59`);

  const { data, error } = await query.order('criado_em', { ascending: false }).limit(100);

  if (error) {
    console.warn('[Mensagens] Falha na busca:', error);
    resultsEl.innerHTML = '<div class="msgs-empty-state"><i class="ti ti-alert-triangle"></i><p>Não foi possível buscar.</p></div>';
    return;
  }
  if (!data || !data.length) {
    resultsEl.innerHTML = '<div class="msgs-empty-state"><i class="ti ti-search-off"></i><p>Nenhuma mensagem encontrada.</p></div>';
    return;
  }

  await _msgsPreCarregarPreviews(data);
  resultsEl.innerHTML = data.map(m => _msgsResultadoHTML(m, escopo === 'todas')).join('');
}

// ESC fecha só o painel de busca (não o Mensagens inteiro) quando ele
// está aberto — capture:true garante que roda antes do handler genérico
// de ESC dos popovers (format.js), que fecharia a ferramenta inteira.
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && _msgsBuscaAtiva) {
    _msgsFecharBusca();
    e.stopPropagation();
  }
}, true);

async function msgsEnviar() {
  const input = document.getElementById('msgs-input');
  const btn   = document.getElementById('msgs-send-btn');
  if (!input || !window.supabaseClient || !window.currentUser?.id) return;

  const texto = input.value.trim();
  if (!texto) return;

  const meuId           = window.currentUser.id;
  const destinatarioId  = _msgsConversaAtiva === 'geral' ? null : _msgsConversaAtiva;

  input.disabled = true;
  if (btn) btn.disabled = true;

  const { data, error } = await window.supabaseClient
    .from('mensagens')
    .insert({ remetente_id: meuId, destinatario_id: destinatarioId, conteudo: texto })
    .select(_MSGS_SELECT_COLS)
    .single();

  input.disabled = false;
  if (btn) btn.disabled = false;
  input.focus();

  if (error) {
    console.warn('[Mensagens] Falha ao enviar:', error);
    if (typeof toast === 'function') toast('Não foi possível enviar a mensagem. Tente de novo.', 'error');
    return;
  }

  input.value = '';

  // Só pinta a bolha se a conversa não mudou enquanto o insert corria.
  const conversaDaMensagem = destinatarioId ?? 'geral';
  const body = document.getElementById('msgs-chat-body');
  if (body && _msgsConversaAtiva === conversaDaMensagem) {
    const vazio = body.querySelector('.msgs-empty-state');
    if (vazio) body.innerHTML = '';
    body.insertAdjacentHTML('beforeend', _msgsBubbleHTML(data, true));
    _msgsScrollParaFinal();
  }
}

function _msgsInputKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    msgsEnviar();
  }
}

// ── Anexos (Etapa 12) ────────────────────────────────────
// Envio próprio, à parte do texto (sem combinar legenda) — escolher o
// arquivo já sobe e manda na hora, sem etapa de pré-visualização.
// Limite de tamanho de verdade é o do bucket (mensagens-anexos, 10MB) —
// aqui é só feedback imediato antes de gastar o upload.
const MSGS_ANEXO_MAX_BYTES = 10 * 1024 * 1024;

function _msgsAbrirSeletorAnexo() {
  document.getElementById('msgs-anexo-input')?.click();
}

async function _msgsEnviarAnexo(file) {
  if (!file || !window.supabaseClient || !window.currentUser?.id) return;
  if (file.size > MSGS_ANEXO_MAX_BYTES) {
    toast(`Arquivo muito grande — limite de ${formatBytes(MSGS_ANEXO_MAX_BYTES)}.`, 'error');
    return;
  }

  const input     = document.getElementById('msgs-input');
  const sendBtn   = document.getElementById('msgs-send-btn');
  const attachBtn = document.getElementById('msgs-attach-btn');
  if (input)     input.disabled     = true;
  if (sendBtn)   sendBtn.disabled   = true;
  if (attachBtn) attachBtn.disabled = true;

  const meuId          = window.currentUser.id;
  const destinatarioId = _msgsConversaAtiva === 'geral' ? null : _msgsConversaAtiva;
  // Id gerado no cliente pra já poder montar o caminho do Storage
  // (remetente/mensagem/arquivo) antes do INSERT existir — mesmo motivo
  // pelo qual a policy de SELECT do bucket cruza com mensagens.id.
  const msgId       = crypto.randomUUID();
  const nomeSeguro   = file.name.replace(/[^a-zA-Z0-9_.\-]/g, '_').slice(-120);
  const path         = `${meuId}/${msgId}/${nomeSeguro}`;

  const { error: uploadError } = await window.supabaseClient.storage
    .from('mensagens-anexos')
    .upload(path, file, { contentType: file.type || 'application/octet-stream' });

  if (uploadError) {
    if (input)     input.disabled     = false;
    if (sendBtn)   sendBtn.disabled   = false;
    if (attachBtn) attachBtn.disabled = false;
    console.warn('[Mensagens] Falha ao enviar anexo:', uploadError);
    toast('Não foi possível enviar o anexo. Tente de novo.', 'error');
    return;
  }

  const { data, error } = await window.supabaseClient
    .from('mensagens')
    .insert({
      id: msgId, remetente_id: meuId, destinatario_id: destinatarioId, conteudo: '',
      anexo_path: path, anexo_nome: file.name, anexo_tamanho: file.size,
    })
    .select(_MSGS_SELECT_COLS)
    .single();

  if (input)     input.disabled     = false;
  if (sendBtn)   sendBtn.disabled   = false;
  if (attachBtn) attachBtn.disabled = false;

  if (error) {
    console.warn('[Mensagens] Falha ao registrar anexo:', error);
    toast('Não foi possível enviar o anexo. Tente de novo.', 'error');
    // Arquivo já subiu mas a mensagem não foi criada — remove pra não
    // ficar órfão no Storage sem nenhuma mensagem apontando pra ele.
    window.supabaseClient.storage.from('mensagens-anexos').remove([path]);
    return;
  }

  await _msgsPreCarregarPreviews([data]);

  const conversaDaMensagem = destinatarioId ?? 'geral';
  const body = document.getElementById('msgs-chat-body');
  if (body && _msgsConversaAtiva === conversaDaMensagem) {
    const vazio = body.querySelector('.msgs-empty-state');
    if (vazio) body.innerHTML = '';
    body.insertAdjacentHTML('beforeend', _msgsBubbleHTML(data, true));
    _msgsScrollParaFinal();
  }
}

// ═══════════════════════════════════════════════════════════
// CANAL REALTIME (Etapa 8)
// ═══════════════════════════════════════════════════════════
// Mesmo padrão do canal de atividade em notifications.js
// (_activityRealtimeInit/_activityRealtimeStop) — chamado no boot
// (dashboard.js) e parado no SIGNED_OUT sem reload (auth.js).
//
// RLS de `mensagens` já garante que cada usuário só recebe pelo canal os
// INSERTs que a policy de select também deixaria ele ler via query normal
// (confirmado na documentação do Supabase: Postgres Changes respeita RLS
// nativamente) — remetente, destinatário, geral, ou admin. Não escrevemos
// nenhuma policy adicional em realtime.messages porque não usamos canal
// privado (private:true) — é o modo clássico postgres_changes, que já
// aplica a RLS da própria tabela.
let _msgsChannel = null;
function _msgsRealtimeInit() {
  if (!window.supabaseClient || !window.currentUser || _msgsChannel) return;
  _msgsChannel = window.supabaseClient
    .channel('mensagens_realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensagens' },
      (payload) => { if (payload?.new) _msgsHandleNova(payload.new); })
    // Exclusão é soft delete (UPDATE, não DELETE) — só nos importa quando
    // excluida_em passa a existir; ignora updates de "marcar como lida".
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'mensagens' },
      (payload) => {
        const novo = payload?.new;
        if (!novo?.excluida_em) return;
        const el = document.querySelector(`.msgs-msg[data-msg-id="${CSS.escape(novo.id)}"]`);
        if (el) el.outerHTML = _msgsBubbleHTML(novo, novo.remetente_id === window.currentUser?.id);
      })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('[Mensagens] Canal Realtime com problema:', status);
      }
    });
}
function _msgsRealtimeStop() {
  if (_msgsChannel && window.supabaseClient) {
    window.supabaseClient.removeChannel(_msgsChannel);
  }
  _msgsChannel = null;
}

// ═══════════════════════════════════════════════════════════
// BADGE DE NÃO LIDAS (Etapa 10)
// ═══════════════════════════════════════════════════════════
// Contador simples em memória (não persiste entre reloads de propósito —
// ao recarregar a página, o histórico de cada conversa já reflete o que
// está lido/não lido via a coluna `lido`; o badge é só o "flash" de coisa
// nova chegando com a aba aberta, mesma filosofia do toast de atividade).
let _msgsNaoLidas = 0;
function _msgsBadgeIncrementar() {
  _msgsNaoLidas++;
  _msgsBadgeRender();
}
function _msgsBadgeZerar() {
  _msgsNaoLidas = 0;
  _msgsBadgeRender();
}
function _msgsBadgeRender() {
  const badge = document.getElementById('msgs-badge');
  if (!badge) return;
  badge.textContent = _msgsNaoLidas > 9 ? '9+' : String(_msgsNaoLidas);
  badge.style.display = _msgsNaoLidas > 0 ? '' : 'none';
}

// ═══════════════════════════════════════════════════════════
// MENSAGEM NOVA — abertura automática + som (Etapa 10)
// ═══════════════════════════════════════════════════════════
// Chamada pelo canal Realtime a cada INSERT que a RLS deixa este usuário
// ver. Duas ressalvas importantes:
//
// 1. Mensagem que EU mandei: já foi pintada localmente (otimista) em
//    msgsEnviar() — ignorar aqui pra não duplicar a bolha.
// 2. Visibilidade de admin sobre conversa alheia: is_admin() na policy
//    deixa um admin RECEBER o evento de uma conversa entre duas outras
//    pessoas da qual ele não participa. Isso é visibilidade, não uma
//    notificação — abrir a janela e tocar som pra toda conversa privada
//    da empresa seria spam, não o que a Etapa 10 pediu. Por isso só
//    dispara abertura/som quando a mensagem é de fato dirigida a mim
//    (geral ou DM comigo); do contrário, no máximo atualiza a bolha se eu
//    já estiver com aquela conversa aberta (caso raro de estar navegando
//    o histórico alheio como admin).
async function _msgsHandleNova(msg) {
  const meuId = window.currentUser?.id;
  if (!meuId || msg.remetente_id === meuId) return;

  const conversaDaMensagem = msg.destinatario_id === null ? 'geral' : msg.remetente_id;
  const éParaMim = msg.destinatario_id === null || msg.destinatario_id === meuId;

  const jaEstouNessaConversa = typeof _openTools !== 'undefined' && _openTools.has('mensagens')
    && _msgsConversaAtiva === conversaDaMensagem;

  if (jaEstouNessaConversa) {
    // Já de olho nessa conversa — só pinta a bolha, sem interromper nada.
    await _msgsPreCarregarPreviews([msg]);
    const body = document.getElementById('msgs-chat-body');
    if (body) {
      const vazio = body.querySelector('.msgs-empty-state');
      if (vazio) body.innerHTML = '';
      body.insertAdjacentHTML('beforeend', _msgsBubbleHTML(msg, false));
      _msgsScrollParaFinal();
    }
    return;
  }

  if (!éParaMim) return; // visibilidade de admin sobre conversa alheia — sem notificação

  // Garante que a pessoa já aparece na lista de conversas antes de tentar
  // abrir a conversa com ela — cobre a corrida rara de receber uma
  // mensagem antes do próximo tick de presença (30s) ter rodado.
  if (conversaDaMensagem !== 'geral') {
    const jaNaLista = document.querySelector(`#msgs-conv-list .msgs-conv-item[data-conv="${CSS.escape(conversaDaMensagem)}"]`);
    if (!jaNaLista && typeof _presenceGlobalTick === 'function') await _presenceGlobalTick();
  }

  if (typeof openTool === 'function') openTool('mensagens');
  msgsAbrirConversa(conversaDaMensagem);
  if (typeof notifPlaySound === 'function') notifPlaySound();
  _msgsBadgeIncrementar();
}

Object.assign(window, {
  avatarInfo, avatarHTML, msgsAbrirConversa, msgsEnviar, _msgsInputKeydown,
  _msgsAbrirSeletorAnexo, _msgsEnviarAnexo, _msgsAbrirAnexo, _msgsAbrirAnexoNovaGuia,
  _msgsExcluir, _msgsLimparConversa, _msgsAbrirBusca, _msgsFecharBusca, _msgsBuscar,
  _presenceGlobalInit, _presenceGlobalStop, _msgsRealtimeInit, _msgsRealtimeStop,
});
