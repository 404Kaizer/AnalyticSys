'use strict';

// ═══════════════════════════════════════════════════════════
// COBRANÇAS — cobrança de lançamento de NFs (setor de Insumos)
// ═══════════════════════════════════════════════════════════
// Seção própria (abaixo do Dashboard Analítico). Dados 100% nas tabelas
// cob_* do Supabase, compartilhadas entre admin e o perfil 'insumos'
// (RLS via cob_acesso()) — nada aqui lê/escreve o state local do resto
// do sistema.
//
// Perfil 'insumos' (Etapa 2): só enxerga Cobranças, Importar Dados e
// Configurações (ver COB_PAGINAS_INSUMOS + navigate() em ui.js); o boot
// dele pula restoreAndRender (ver init() em analitico.js) — não carrega
// entradas/saídas/SAP etc., que nem são dele. O que some na tela é
// controlado por body.role-insumos (auth.js) + CSS (modules.css).

const COB_PAGINAS_INSUMOS = new Set(['cobrancas', 'importar', 'configuracoes']);

function cobIsInsumos() {
  return window.currentUser?.role === 'insumos';
}

// Boot enxuto do perfil insumos — substitui restoreAndRender.
function cobBootInsumos() {
  // Importar/Configurações do resto do sistema não rodam pra ele (as
  // seções ficam ocultas por CSS); os cards da Cobrança entram nas
  // próximas etapas.
  pageRenderers.importar = () => {};
  pageRenderers.configuracoes = () => {};
  navigate('cobrancas');
}

// ── Página ───────────────────────────────────────────────────
pageRenderers.cobrancas = () => renderCobrancas();

function renderCobrancas() {
  // Etapa 2: só a estrutura. Cálculo e painéis entram na Etapa 5.
}

function cobSwitchTab(tab) {
  document.querySelectorAll('#page-cobrancas .dg-tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.cobTab === tab));
  document.querySelectorAll('#page-cobrancas .dg-tab-pane').forEach(p =>
    p.classList.toggle('active', p.id === 'cob-pane-' + tab));
}
