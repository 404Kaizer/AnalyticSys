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

  // Corpo da conversa — placeholder até a Etapa 6 (envio/recebimento real).
  const body = document.getElementById('msgs-chat-body');
  if (body) {
    body.innerHTML = `
      <div class="msgs-empty-state">
        <i class="ti ti-message-circle-2"></i>
        <p>Em construção — o envio de mensagens chega nas próximas etapas.</p>
      </div>`;
  }
}

Object.assign(window, { avatarInfo, avatarHTML, msgsAbrirConversa });
