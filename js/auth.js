'use strict';

// ═══════════════════════════════════════════════════════════
// AUTH GATE — login/logout via Supabase Auth (Fase 1)
// ═══════════════════════════════════════════════════════════
// Cadastro de novos usuários é feito só pelo ADM (fora do app, pelo
// Dashboard do Supabase, por enquanto) — não existe formulário de
// autocadastro aqui de propósito.
//
// window.AuthGate.ensureSession() é chamada no início de init()
// (analitico.js). Se já existir sessão válida, resolve com ela e o boot
// normal do app continua. Se não existir, mostra a tela de login e
// retorna null.
//
// IMPORTANTE — links de e-mail (convite / redefinir senha): o Supabase
// só estabelece a sessão temporária DEPOIS de ler o token que vem na
// própria URL, de forma assíncrona — ou seja, pode acontecer um instante
// depois do getSession() já ter rodado dentro de ensureSession() sem
// encontrar nada. Por isso o app escuta onAuthStateChange continuamente
// (não confia só na checagem única do boot), e reage tanto a uma sessão
// que aparece atrasada quanto ao evento PASSWORD_RECOVERY (convite ou
// redefinição), mostrando a tela de "defina sua senha".

window.AuthGate = (function () {
  let wired = false;
  let appBooted = false;

  // ── Logout por inatividade ────────────────────────────────────────────
  // 4h sem nenhuma atividade (mouse, teclado, clique, scroll, toque) →
  // aviso de 60s com opção de continuar conectado → desloga se ninguém
  // reagir. Só a aba que detém o lock de escrita (isActiveTab, definido em
  // persist.js) efetivamente desloga — uma aba passiva em segundo plano
  // não deve derrubar a sessão de quem está de fato usando o sistema na
  // outra aba (a sessão do Supabase é compartilhada entre abas).
  const IDLE_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 horas
  const IDLE_WARNING_LEAD_MS = 60 * 1000;     // aviso 60s antes de deslogar
  const IDLE_ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
  const IDLE_THROTTLE_MS = 2000; // não reagenda o timer a cada pixel de mousemove

  let idleWarnTimer = null;
  let idleCountdownInterval = null;
  let idleLastActivityAt = 0;
  let idleListenersWired = false;

  // isActiveTab é um `let` de topo de arquivo em persist.js — como todos
  // os scripts do sistema são clássicos (sem type="module"), compartilham
  // o mesmo escopo global e o nome fica visível aqui diretamente. Se por
  // algum motivo persist.js não tiver carregado, assume ativo para não
  // travar o recurso.
  function _idleThisTabIsActive() {
    try { return typeof isActiveTab === 'undefined' ? true : isActiveTab; }
    catch (_) { return true; }
  }

  // ── Presença (indicador Online/Away/Offline no painel de Administração) ─
  // Reaproveita a mesma atividade rastreada acima, mas com throttle próprio
  // bem mais folgado (1 min) — não precisa da mesma granularidade do timer
  // de logout, e evita gravar no banco a cada poucos segundos. O painel de
  // Administração calcula o status (online ≤10min / away 10min-4h / offline
  // >4h) a partir deste timestamp — ver admin.js.
  const PRESENCE_THROTTLE_MS = 60 * 1000;
  let presenceLastSentAt = 0;

  function _presenceHeartbeat(force) {
    if (!appBooted || !window.currentUser?.id) return;
    const now = Date.now();
    if (!force && now - presenceLastSentAt < PRESENCE_THROTTLE_MS) return;
    presenceLastSentAt = now;
    window.supabaseClient
      .from('profiles')
      .update({ last_seen: new Date().toISOString() })
      .eq('id', window.currentUser.id)
      .then(({ error }) => {
        if (error) console.warn('[Presença] Falha ao atualizar last_seen:', error);
      });
  }

  function $(id) { return document.getElementById(id); }

  function _idleHideWarning() {
    clearInterval(idleCountdownInterval);
    idleCountdownInterval = null;
    $('idle-warning-overlay')?.classList.remove('open');
  }

  function _idleShowWarning() {
    if (!_idleThisTabIsActive()) {
      // Aba passiva: não é ela quem decide o logout — só reagenda a
      // checagem sem exibir nada (o overlay de aba somente-leitura já
      // cobre a tela aqui).
      idleWarnTimer = setTimeout(_idleShowWarning, 30000);
      return;
    }
    const deadline = Date.now() + IDLE_WARNING_LEAD_MS;
    $('idle-warning-overlay')?.classList.add('open');
    idleCountdownInterval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      const el = $('idle-warning-countdown');
      if (el) el.textContent = String(remaining);
      if (remaining <= 0) {
        clearInterval(idleCountdownInterval);
        idleCountdownInterval = null;
        if (_idleThisTabIsActive()) {
          signOut();
        } else {
          _idleHideWarning();
          _idleResetTimer();
        }
      }
    }, 250);
  }

  function _idleResetTimer() {
    clearTimeout(idleWarnTimer);
    _idleHideWarning();
    if (!appBooted) return; // só conta inatividade com sessão ativa
    idleWarnTimer = setTimeout(_idleShowWarning, IDLE_TIMEOUT_MS - IDLE_WARNING_LEAD_MS);
  }

  function _idleOnActivity() {
    if (!appBooted) return;
    const now = Date.now();
    // Durante o aviso, qualquer atividade cancela na hora (sem throttle) —
    // é o caso em que a resposta rápida importa mais que economizar uma
    // chamada de timer.
    const warningOpen = $('idle-warning-overlay')?.classList.contains('open');
    if (!warningOpen && now - idleLastActivityAt < IDLE_THROTTLE_MS) return;
    idleLastActivityAt = now;
    _idleResetTimer();
    _presenceHeartbeat(false);
  }

  function _idleWireListeners() {
    if (idleListenersWired) return;
    idleListenersWired = true;
    IDLE_ACTIVITY_EVENTS.forEach(evt => {
      document.addEventListener(evt, _idleOnActivity, { passive: true });
    });
    $('idle-warning-stay-btn')?.addEventListener('click', _idleResetTimer);
  }

  function showGate() {
    $('auth-gate').removeAttribute('hidden');
    document.querySelector('.layout')?.setAttribute('hidden', '');
  }

  function hideGate() {
    $('auth-gate').setAttribute('hidden', '');
    document.querySelector('.layout')?.removeAttribute('hidden');
  }

  function showLoginForm() {
    $('auth-gate-form-login').style.display = 'flex';
    $('auth-gate-forgot-sent').style.display = 'none';
    $('auth-gate-form-recovery').style.display = 'none';
  }

  function showForgotSent() {
    $('auth-gate-form-login').style.display = 'none';
    $('auth-gate-forgot-sent').style.display = 'flex';
    $('auth-gate-form-recovery').style.display = 'none';
  }

  function showRecoveryForm() {
    $('auth-gate-form-login').style.display = 'none';
    $('auth-gate-forgot-sent').style.display = 'none';
    $('auth-gate-form-recovery').style.display = 'flex';
  }

  function showError(msg) {
    const el = $('auth-gate-error');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
  }

  function clearError() {
    const el = $('auth-gate-error');
    if (!el) return;
    el.style.display = 'none';
    el.textContent = '';
  }

  function showRecoveryError(msg) {
    const el = $('auth-gate-recovery-error');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
  }

  function clearRecoveryError() {
    const el = $('auth-gate-recovery-error');
    if (!el) return;
    el.style.display = 'none';
    el.textContent = '';
  }

  // Busca o papel (user/admin) do usuário logado. profiles é criado
  // automaticamente por um gatilho no banco quando o ADM cadastra o
  // usuário — não deveria faltar, mas cai em 'user' por segurança se algo
  // inesperado acontecer.
  async function fetchProfile(userId) {
    try {
      const { data, error } = await window.supabaseClient
        .from('profiles')
        .select('id, email, role')
        .eq('id', userId)
        .single();
      if (error) throw error;
      return data;
    } catch (err) {
      console.warn('[Auth] Falha ao carregar perfil — assumindo papel "user".', err);
      return null;
    }
  }

  function updateAccountUI(user, profile) {
    const emailEl = $('auth-account-email');
    const roleEl = $('auth-account-role');
    if (emailEl) emailEl.textContent = user?.email || '—';
    if (roleEl) roleEl.textContent = profile?.role === 'admin' ? 'Administrador' : 'Usuário';

    // Tab "Administração" só aparece pra quem é admin. Isso é só UI — a
    // segurança de verdade está nas políticas de RLS de cada tabela.
    const adminTab = $('tab-admin');
    const isAdmin = profile?.role === 'admin';
    if (adminTab) adminTab.style.display = isAdmin ? '' : 'none';

    // Decisão 28/07 — só o ADM gera Notas de Crédito/Débito. Botão some
    // pra quem não é admin (a policy de INSERT de notas_ajuste já bloqueia
    // no banco; isso é só pra não oferecer uma ação que vai falhar).
    const ncdBtn = $('btn-ncd-abrir');
    if (ncdBtn) ncdBtn.style.display = isAdmin ? '' : 'none';

    // Decisão 28/07 — Limites de Saúde (Configurações) viram globais e só
    // o ADM edita. Trava o botão "Salvar Limites" e os 12 campos pra quem
    // não é admin; a leitura continua igual pra todos (RLS libera SELECT
    // de chaves saude_* pra qualquer autenticado). Mesmo padrão: isto é
    // só UI, a segurança de verdade está na policy de INSERT/UPDATE/DELETE
    // de configs.
    const saveHealthBtn = $('btn-salvar-health-config');
    if (saveHealthBtn) saveHealthBtn.style.display = isAdmin ? '' : 'none';
    document.querySelectorAll('input[id^="hcfg-"]').forEach(inp => { inp.disabled = !isAdmin; });
    const healthReadonlyNote = $('health-cfg-readonly-note');
    if (healthReadonlyNote) healthReadonlyNote.style.display = isAdmin ? 'none' : '';
  }

  // Ponto único que "entra" no app a partir de uma sessão válida — chamado
  // tanto pela checagem inicial (ensureSession) quanto pelo listener de
  // auth state (login por senha, ou sessão detectada com atraso a partir
  // de um link de e-mail). Idempotente via appBooted: pode ser chamado
  // mais de uma vez sem duplicar o boot do app.
  async function bootApp(session) {
    if (appBooted) return;
    appBooted = true;
    const profile = await fetchProfile(session.user.id);
    window.currentUser = { id: session.user.id, email: session.user.email, role: profile?.role || 'user' };
    updateAccountUI(session.user, profile);
    hideGate();
    _idleWireListeners();
    _idleResetTimer();
    _presenceHeartbeat(true); // imediato — não espera o throttle de 1min
    if (typeof window.init === 'function') window.init();
  }

  // ── Cloudflare Turnstile — protege login e "esqueci minha senha" contra
  // tentativas automatizadas. Um único widget serve pros dois, já que
  // ambos vivem no mesmo formulário visível (o botão "esqueci minha senha"
  // fica dentro do form de login, não é uma tela separada). Renderização
  // explícita (não implícita) pra poder resetar o token depois de cada
  // tentativa — o token do Turnstile é de uso único.
  const TURNSTILE_SITEKEY = '0x4AAAAAAD-V-RBGDDiirGsF';
  let turnstileWidgetId = null;

  function _turnstileRender() {
    if (turnstileWidgetId !== null) return;
    if (typeof turnstile === 'undefined') {
      // Script ainda não carregou (ou foi bloqueado) — tenta de novo em
      // breve, em vez de deixar o login sem proteção nenhuma.
      setTimeout(_turnstileRender, 500);
      return;
    }
    turnstileWidgetId = turnstile.render('#turnstile-login-widget', {
      sitekey: TURNSTILE_SITEKEY,
      theme: 'dark',
    });
  }

  function _turnstileGetToken() {
    if (typeof turnstile === 'undefined' || turnstileWidgetId === null) return null;
    return turnstile.getResponse(turnstileWidgetId) || null;
  }

  function _turnstileReset() {
    if (typeof turnstile === 'undefined' || turnstileWidgetId === null) return;
    turnstile.reset(turnstileWidgetId);
  }

  function wireForm() {
    if (wired) return;
    wired = true;
    _turnstileRender();

    $('auth-gate-form-login').addEventListener('submit', async (e) => {
      e.preventDefault();
      clearError();
      const captchaToken = _turnstileGetToken();
      if (!captchaToken) {
        showError('Confirme que você não é um robô antes de entrar.');
        return;
      }
      const btn = $('auth-gate-submit-btn');
      const email = $('auth-email').value.trim();
      const password = $('auth-password').value;
      const origHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="btn-spinner"></span> Entrando...';

      const { error } = await window.supabaseClient.auth.signInWithPassword({ email, password, options: { captchaToken } });

      btn.disabled = false;
      btn.innerHTML = origHtml;
      _turnstileReset(); // token é de uso único — sempre reseta, com ou sem erro

      if (error) {
        showError('E-mail ou senha inválidos.');
        return;
      }
      // Sucesso: o listener onAuthStateChange (SIGNED_IN) cuida do boot
      // via bootApp() — mesmo caminho usado por sessões vindas de link.
    });

    $('auth-gate-forgot-btn').addEventListener('click', async () => {
      clearError();
      const email = $('auth-email').value.trim();
      if (!email) { showError('Digite seu e-mail acima para receber o link de redefinição.'); return; }
      const captchaToken = _turnstileGetToken();
      if (!captchaToken) {
        showError('Confirme que você não é um robô antes de continuar.');
        return;
      }
      await window.supabaseClient.auth.resetPasswordForEmail(email, { captchaToken });
      _turnstileReset();
      showForgotSent();
    });

    $('auth-gate-back-btn').addEventListener('click', showLoginForm);

    $('auth-gate-form-recovery').addEventListener('submit', async (e) => {
      e.preventDefault();
      clearRecoveryError();
      const pw1 = $('auth-recovery-password').value;
      const pw2 = $('auth-recovery-password-confirm').value;

      if (pw1.length < 6) { showRecoveryError('A senha precisa ter pelo menos 6 caracteres.'); return; }
      if (pw1 !== pw2) { showRecoveryError('As senhas não coincidem.'); return; }

      const btn = $('auth-gate-recovery-submit-btn');
      const origHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="btn-spinner"></span> Salvando...';

      const { error } = await window.supabaseClient.auth.updateUser({ password: pw1 });

      btn.disabled = false;
      btn.innerHTML = origHtml;

      if (error) {
        showRecoveryError('Não foi possível salvar a senha. Tente novamente ou peça um novo link.');
        return;
      }

      // A sessão temporária do link de recuperação já é uma sessão válida
      // depois da senha definida — entra direto no app.
      const { data: { session } } = await window.supabaseClient.auth.getSession();
      if (session) bootApp(session);
    });
  }

  // Chamada no topo de init() (analitico.js). Retorna a sessão se já
  // autenticado (o boot normal do app prossegue); caso contrário mostra a
  // tela de login e retorna null (init() para ali até haver sessão).
  async function ensureSession() {
    wireForm();
    const { data: { session } } = await window.supabaseClient.auth.getSession();

    if (!session) {
      showGate();
      showLoginForm();
      return null;
    }

    await bootApp(session);
    return session;
  }

  async function signOut() {
    clearTimeout(idleWarnTimer);
    _idleHideWarning();
    // Marca como offline ANTES de encerrar a sessão — depois do
    // auth.signOut(), a requisição perde a permissão pra atualizar o
    // próprio registro (RLS exige sessão válida). Falha aqui não deve
    // impedir o logout de acontecer, por isso o try/catch silencioso.
    if (window.currentUser?.id) {
      try {
        await window.supabaseClient.from('profiles').update({ last_seen: null }).eq('id', window.currentUser.id);
      } catch (err) {
        console.warn('[Presença] Falha ao marcar offline no logout:', err);
      }
    }
    await window.supabaseClient.auth.signOut();
    window.currentUser = null;
    window.location.reload();
  }

  // Escuta contínua — cobre o caso do link de e-mail: o supabase-js lê o
  // token da URL de forma assíncrona, então a sessão pode aparecer (ou o
  // evento de recuperação disparar) um instante depois do ensureSession()
  // já ter rodado sem encontrar nada.
  document.addEventListener('DOMContentLoaded', () => {
    window.supabaseClient.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        wireForm();
        showGate();
        showRecoveryForm();
        return;
      }
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
        bootApp(session);
      }
      if (event === 'SIGNED_OUT') {
        appBooted = false;
        // Espelha o reset acima na trava de idempotência de init()
        // (analitico.js) — sem isso, se a sessão cair sem reload da
        // página (ex.: SIGNED_OUT vindo de outro dispositivo), um novo
        // login na mesma aba nunca conseguiria rodar o boot de novo.
        if (typeof _appBootExecuted !== 'undefined') _appBootExecuted = false;
        clearTimeout(idleWarnTimer);
        _idleHideWarning();
        // Fecha o canal Realtime de atividade (Fase 5) — sem isso, uma
        // sessão derrubada sem reload (ex.: SIGNED_OUT vindo de outro
        // dispositivo) deixaria o canal antigo aberto com credenciais
        // inválidas até a próxima navegação.
        if (typeof _activityRealtimeStop === 'function') _activityRealtimeStop();
        // Presença global (Mensagens) — mesmo cuidado: para o polling e
        // limpa a fileira de avatares antes de uma eventual troca de
        // usuário na mesma aba sem reload.
        if (typeof _presenceGlobalStop === 'function') _presenceGlobalStop();
      }
    });
  });

  return { ensureSession, signOut, getCurrentUser: () => window.currentUser };
})();
