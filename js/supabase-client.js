'use strict';

// ═══════════════════════════════════════════════════════════
// SUPABASE — cliente único do sistema
// ═══════════════════════════════════════════════════════════
// Carregado logo após a lib supabase-js (CDN) e antes de todos os módulos
// do AnalyticSys — qualquer módulo pode usar window.supabaseClient a
// partir daqui (ver ordem dos <script> em index.html).
//
// Chave usada: "publishable" (sb_publishable_...) — segura para uso no
// front-end (equivalente à antiga "anon key"). A proteção real dos dados
// não vem do sigilo desta chave, e sim das políticas de RLS configuradas
// no banco (ver Fase 1 do plano — autenticação + regra dono/admin).
//
// Projeto: analyticsys (org. AnalyticSys, plano free, região sa-east-1).
const SUPABASE_URL = 'https://kgbmswykhqhmcajxlvri.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_SFDcmWJ0fSuS0tmWkiibnQ_RLjfRJug';

window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
window.SUPABASE_URL = SUPABASE_URL;
window.SUPABASE_PUBLISHABLE_KEY = SUPABASE_PUBLISHABLE_KEY;
