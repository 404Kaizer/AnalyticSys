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
function avatarHTML(seed, className, extraAttrs) {
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

async function _presenceGlobalTick() {
  if (!window.supabaseClient || !window.currentUser?.id) return;
  const wrap = document.getElementById('online-users-wrap');
  const list = document.getElementById('online-users-list');
  if (!wrap || !list) return;

  const { data, error } = await window.supabaseClient.rpc('usuarios_presenca');
  if (error) {
    console.warn('[Presença] Falha ao buscar usuários online:', error);
    return;
  }

  const agora = Date.now();
  const meuId = window.currentUser.id;
  const online = (data || [])
    .filter(u => u.id !== meuId && u.last_seen && (agora - new Date(u.last_seen).getTime()) <= MSGS_PRESENCE_ONLINE_MS)
    .sort((a, b) => (a.email || '').localeCompare(b.email || ''));

  if (!online.length) {
    wrap.style.display = 'none';
    list.innerHTML = '';
  } else {
    // Clique no avatar do topbar abre o Mensagens já na conversa daquela
    // pessoa (Etapa 9) — reaproveita openTool()/msgsAbrirConversa() que já
    // existem, sem precisar de uma função nova só pra isso.
    list.innerHTML = online.map(u => {
      const nome = (u.email || '').split('@')[0];
      const onclick = `openTool('mensagens'); msgsAbrirConversa('${u.id}')`;
      return avatarHTML(u.email, 'online-avatar', `title="${_presenceEsc(nome)} — online" onclick="${onclick}"`);
    }).join('');
    wrap.style.display = 'flex';
  }

  // Lista de conversas 1:1 no popover (Etapa 1, concluindo) — mesmo array
  // de online já buscado acima, sem round-trip extra ao Supabase.
  msgsRenderConversas(online);
}

// ═══════════════════════════════════════════════════════════
// LISTA DE CONVERSAS 1:1 (Etapa 1, concluindo)
// ═══════════════════════════════════════════════════════════
// Chamada a cada tick de presença, com o array de usuários online que
// _presenceGlobalTick já buscou. "Geral" é fixo no HTML (index.html) e
// nunca é tocado aqui — só os itens 1:1, marcados com
// .msgs-conv-item-injetado, são removidos e reconstruídos do zero a cada
// chamada (mais simples que fazer diff, e o volume é pequeno).
function msgsRenderConversas(online) {
  const list = document.getElementById('msgs-conv-list');
  const hint = document.getElementById('msgs-conv-empty-hint');
  if (!list) return;

  const activeId = list.querySelector('.msgs-conv-item.active')?.dataset.conv || 'geral';

  list.querySelectorAll('.msgs-conv-item-injetado').forEach(el => el.remove());

  online.forEach(u => {
    const nome = (u.email || '').split('@')[0];
    list.insertAdjacentHTML('beforeend', `
      <button class="msgs-conv-item msgs-conv-item-injetado" data-conv="${u.id}" onclick="msgsAbrirConversa('${u.id}')">
        ${avatarHTML(u.email, 'msgs-conv-avatar')}
        <div class="msgs-conv-body">
          <div class="msgs-conv-name">${_presenceEsc(nome)}</div>
          <div class="msgs-conv-preview">Online</div>
        </div>
      </button>`);
  });

  if (hint) hint.style.display = online.length ? 'none' : '';

  // Se a conversa ativa era com alguém que ficou offline nesse intervalo,
  // volta pro Geral em vez de deixar o cabeçalho apontando pra um item
  // que não existe mais na lista.
  const continuaExistindo = activeId === 'geral' || online.some(u => u.id === activeId);
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

  // Espelha nome/subtítulo da conversa clicada no cabeçalho — lê do
  // próprio item da lista em vez de duplicar os dados em outro lugar.
  const nameDst = document.getElementById('msgs-chat-header-name');
  const subDst  = document.getElementById('msgs-chat-header-sub');
  const nameSrc = item.querySelector('.msgs-conv-name')?.textContent || '';
  const subSrc  = item.querySelector('.msgs-conv-preview')?.textContent || '';
  if (nameDst) nameDst.textContent = nameSrc;
  if (subDst)  subDst.textContent  = subSrc;

  _msgsConversaAtiva = convId;

  const input   = document.getElementById('msgs-input');
  const sendBtn = document.getElementById('msgs-send-btn');
  if (input)   input.disabled   = false;
  if (sendBtn) sendBtn.disabled = false;

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

function _msgsBubbleHTML(msg, souEu) {
  const hora = new Date(msg.criado_em).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
  return `<div class="msgs-msg ${souEu ? 'msgs-msg-mine' : 'msgs-msg-theirs'}">
    ${escapeHtml(msg.conteudo)}
    <div class="msgs-msg-meta">${hora}</div>
  </div>`;
}

async function _msgsCarregarHistorico(convId) {
  const body = document.getElementById('msgs-chat-body');
  if (!body || !window.supabaseClient || !window.currentUser?.id) return;

  const meuId = window.currentUser.id;
  body.innerHTML = '<div class="msgs-empty-state"><i class="ti ti-loader-2" style="animation:spin .7s linear infinite"></i><p>Carregando...</p></div>';

  let query = window.supabaseClient.from('mensagens').select('id, remetente_id, destinatario_id, conteudo, criado_em, lido');
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
    .select('id, remetente_id, destinatario_id, conteudo, criado_em')
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
  _presenceGlobalInit, _presenceGlobalStop, _msgsRealtimeInit, _msgsRealtimeStop,
});
