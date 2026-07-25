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
// retorna null — o próprio submit do formulário de login rechama init()
// depois de autenticar com sucesso.

window.AuthGate = (function () {
  let wired = false;

  function $(id) { return document.getElementById(id); }

  function showGate() {
    $('auth-gate').removeAttribute('hidden');
    document.querySelector('.layout')?.setAttribute('hidden', '');
  }

  function hideGate() {
    $('auth-gate').setAttribute('hidden', '');
    document.querySelector('.layout')?.removeAttribute('hidden');
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

  // Busca o papel (user/admin) do usuário logado. profiles é criado
  // automaticamente por um gatilho no banco quando o ADM cadastra o
  // usuário (ver migração fase1_profiles_rls_dono_admin) — não deveria
  // faltar, mas cai em 'user' por segurança se algo inesperado acontecer.
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
  }

  function wireForm() {
    if (wired) return;
    wired = true;

    const form = $('auth-gate-form-login');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearError();
      const btn = $('auth-gate-submit-btn');
      const email = $('auth-email').value.trim();
      const password = $('auth-password').value;
      const origHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="btn-spinner"></span> Entrando...';

      const { data, error } = await window.supabaseClient.auth.signInWithPassword({ email, password });

      btn.disabled = false;
      btn.innerHTML = origHtml;

      if (error) {
        showError('E-mail ou senha inválidos.');
        return;
      }

      const profile = await fetchProfile(data.user.id);
      window.currentUser = { id: data.user.id, email: data.user.email, role: profile?.role || 'user' };
      updateAccountUI(data.user, profile);
      hideGate();
      if (typeof window.init === 'function') window.init();
    });

    $('auth-gate-forgot-btn').addEventListener('click', async () => {
      clearError();
      const email = $('auth-email').value.trim();
      if (!email) { showError('Digite seu e-mail acima para receber o link de redefinição.'); return; }
      await window.supabaseClient.auth.resetPasswordForEmail(email);
      $('auth-gate-form-login').style.display = 'none';
      $('auth-gate-forgot-sent').style.display = 'flex';
    });

    $('auth-gate-back-btn').addEventListener('click', () => {
      $('auth-gate-forgot-sent').style.display = 'none';
      $('auth-gate-form-login').style.display = 'flex';
    });
  }

  // Chamada no topo de init() (analitico.js). Retorna a sessão se já
  // autenticado (o boot normal do app prossegue); caso contrário mostra a
  // tela de login e retorna null (init() para ali até o login acontecer).
  async function ensureSession() {
    wireForm();
    const { data: { session } } = await window.supabaseClient.auth.getSession();

    if (!session) {
      showGate();
      return null;
    }

    const profile = await fetchProfile(session.user.id);
    window.currentUser = { id: session.user.id, email: session.user.email, role: profile?.role || 'user' };
    updateAccountUI(session.user, profile);
    hideGate();
    return session;
  }

  async function signOut() {
    await window.supabaseClient.auth.signOut();
    window.currentUser = null;
    window.location.reload();
  }

  return { ensureSession, signOut, getCurrentUser: () => window.currentUser };
})();
