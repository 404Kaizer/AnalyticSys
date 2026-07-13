'use strict';

const domCache = new Map();

function $(selector) {
if (!domCache.has(selector)) {
  domCache.set(selector, document.querySelector(selector));
}
return domCache.get(selector);
}


const STORAGE_KEY = 'central_analise_state_v4';
const THEME_KEY = 'central_analise_theme_v1';
const PAGE_SIZE = 50;

const defaultState = () => ({
  entradas: [],
  saidas: [],
  lancamentos: [],
  sap: [],
  producao: [],
  imports: [],
  configs: [],
  filiais: [],
  materiais: [],
  // Catálogo de Grupos SAP cadastrados manualmente (via botão "+" no
  // dropdown de Grupo SAP do cadastro de Materiais). Existe separado de
  // "materiais" para que um grupo recém-criado sobreviva mesmo sem nenhum
  // material vinculado a ele ainda — ver registrarGrupoMaterial (config.js).
  gruposMateriais: [],
  // Catálogo de Regionais cadastrados manualmente (via botão "+" no
  // dropdown de Regional do cadastro de Centrais). Mesmo padrão de
  // gruposMateriais — ver registrarRegionalCentral (config.js).
  regionaisCentrais: [],
  ocorrencias: [],
  acoesRelatorio: [],
  notifications: [],  // { id, type, level, title, body, source, createdAt, read }
  // Justificativas do fechamento de Inventário — array de
  // {k, op, fiscal, saldo, custoMedioSap, documentoSap}. "k" já embute o
  // mês (mesKey|||central|||material), então o isolamento entre meses
  // acontece naturalmente na própria chave — não precisa de bucket
  // separado por mês. Ver inventario.js (_invHydrateJustificativas /
  // _invSyncJustificativasToState).
  invJustificativas: []
});


const state = defaultState();

function normalizeConfigKey(key) {
return String(key ?? '').trim().toLowerCase();
}

function mergePersistentConfigs(existing, incoming) {
const merged = new Map();

const push = (rec) => {
  if (!rec || typeof rec !== 'object') return;
  const key = String(rec.key ?? '').trim();
  if (!key) return;
  const norm = normalizeConfigKey(key);
  if (!norm) return;
  merged.set(norm, {
    ...rec,
    key
  });
};

if (Array.isArray(incoming)) incoming.forEach(push);
if (Array.isArray(existing)) {
  existing.forEach(rec => {
    const norm = normalizeConfigKey(rec?.key);
    if (!norm || merged.has(norm)) return;
    push(rec);
  });
}

return [...merged.values()];
}

function hasRequiredReferenceData() {
return Array.isArray(state.filiais) && state.filiais.length > 0 &&
       Array.isArray(state.materiais) && state.materiais.length > 0;
}

function updateImportPrereqUI() {
const banner = document.getElementById('import-prereq-banner');
if (banner) {
  banner.style.display = hasRequiredReferenceData() ? 'none' : 'flex';
}
}

function showImportPrereqMessage() {
toast('Bloqueado: importe primeiro PADRONIZAÇÃO DE CENTRAIS e PADRONIZAÇÃO DE MATERIAIS em Configurações.', 'error');
updateImportPrereqUI();
}

function safeJSONParse(value, fallback = null) {

try {
  return JSON.parse(value);
} catch (error) {
  console.warn('Falha ao interpretar JSON persistido:', error);
  return fallback;
}
}

function debounce(fn, delay = 120) {
let timeout;
return (...args) => {
  clearTimeout(timeout);
  timeout = setTimeout(() => fn(...args), delay);
};
}


const pages = {
  entradas: 0,
  saidas: 0,
  lancamentos: 0,
  sap: 0
};

const filters = {
  entradas: '',
  saidas: '',
  lancamentos: '',
  sap: ''
};

const listFilters = {
  dashboard: '',
  imports: '',
  configs: '',
  filiais: '',
  materiais: '',
  acoesRelatorio: ''
};

const listPages = {
  dashboard: 0,
  imports: 0,
  configs: 0,
  filiais: 0,
  materiais: 0,
  acoesRelatorio: 0
};

let currentPageProducao = 0;
let filtroProducao = '';

const moduleMap = {
  'tb-entradas': 'entradas',
  'tb-saidas': 'saidas',
  'tb-lancamentos': 'lancamentos',
  'tb-sap': 'sap',
  'tb-producao': 'producao'
};

const moduleTableMap = {
  entradas: 'tb-entradas',
  saidas: 'tb-saidas',
  lancamentos: 'tb-lancamentos',
  sap: 'tb-sap',
  producao: 'tb-producao'
};

const pageTitleMap = {
  dashboard: { title: 'Dashboard Gerencial', sub: 'visão executiva consolidada' },
  entradas: { title: 'Entradas (NF)', sub: 'notas fiscais que geram saldo de estoque' },
  saidas: { title: 'Saídas (OS)', sub: 'ordens de serviço que consomem saldo' },
  lancamentos: { title: 'Lançamentos', sub: 'saldo real por material e central' },
  sap: { title: 'Movimentações SAP', sub: 'extrato consolidado de todas as movimentações' },
  producao: { title: 'Produção', sub: 'produção consolidada por central' },
  analitico: { title: 'Dashboard Analítico', sub: 'análise de estoque por período, filial e fechamento de inventário' },
  importar: { title: 'Importar Dados', sub: 'importe arquivos .xlsx ou .csv para cada módulo' },
  configuracoes: { title: 'Configurações', sub: 'parâmetros e informações de referência do sistema' },
  ocorrencias: { title: 'Ocorrências', sub: 'solicitações abertas e gestão de ocorrências por central' }
};


const themeLabels = {
  dark: 'Escuro',
  graphite: 'Grafite',
  light: 'Claro',
  sand: 'Areia'
};

function getSavedTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return themeLabels[saved] ? saved : 'dark';
  } catch (err) {
    return 'dark';
  }
}

function updateThemeUI(theme) {
  // Update tools dropdown theme buttons
  document.querySelectorAll('.tools-theme-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
}

function updateToolsTheme() {
  updateThemeUI(document.body.dataset.theme || 'dark');
}

function applyTheme(theme) {
  const selected = themeLabels[theme] ? theme : 'dark';
  document.body.dataset.theme = selected;
  try { localStorage.setItem(THEME_KEY, selected); } catch (err) {}
  updateThemeUI(selected);
}

// Called once at boot and after theme change to sync dropdown state
function updateToolsTheme() {
  updateThemeUI(document.body.dataset.theme || 'dark');
}

function setTheme(theme) {
  applyTheme(theme);
}

function qs(sel, root = document) { return root.querySelector(sel); }
function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
function val(id) { return document.getElementById(id)?.value?.trim() || ''; }
function setVal(id, value) { const el = document.getElementById(id); if (el) el.value = value ?? ''; }


function normalizeText(v) {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function normalizeSearchKey(v) {
  return normalizeText(v).replace(/[^A-Z0-9]/g, '');
}

function tokenizeSearch(query) {
  const text = String(query ?? '').trim();
  if (!text) return [];
  const tokens = [];
  const re = /"([^"]+)"|'([^']+)'|(\S+)/g;
  let m;
  while ((m = re.exec(text))) {
    const token = (m[1] || m[2] || m[3] || '').trim();
    if (token) tokens.push(token);
  }
  return tokens;
}

const searchFieldAliases = {
  central: ['central', 'centralcompra', 'centraldestino', 'centralsaida', 'centralestoque', 'centralprod', 'centralprodutiva'],
  material: ['material', 'materialoriginal', 'grupo', 'gruposap'],
  fornecedor: ['fornecedor'],
  categoria: ['categoria'],
  documento: ['documento'],
  ref: ['ref', 'referencia'],
  os: ['os'],
  nf: ['nf', 'notafiscal'],
  contrato: ['contrato'],
  deposito: ['deposito'],
  usuario: ['usuario'],
  movimento: ['movimento'],
  mes: ['mes'],
  arquivo: ['arquivo'],
  modulo: ['modulo'],
  registros: ['registros'],
  datahora: ['datahora'],
  status: ['status'],
  key: ['key', 'chave'],
  value: ['value', 'valor'],
  desc: ['desc', 'descricao', 'descricao'],
  created: ['created', 'criadoem', 'criado'],
  origem: ['origem', 'original'],
  alias: ['alias', 'padronizada'],
  cnpj: ['cnpj', 'documento', 'cpfcnpj'],
  regional: ['regional', 'regiao', 'gestor', 'responsavel'],
  peso: ['peso'],
  um: ['um'],
  custo: ['custo', 'custounit', 'customedio'],
  valortotal: ['valortotal', 'valor', 'totalvendas'],
  producao: ['producao'],
  margem: ['margem']
};

function getFieldCandidates(field) {
  const key = normalizeSearchKey(field);
  return searchFieldAliases[key] || [key];
}

function getSearchableFields(scope) {
  const map = {
    entradas: ['centralCompra', 'centralDestino', 'nf', 'dtEmissao', 'dtDescarga', 'fornecedor', 'categoria', 'material', 'materialOriginal', 'peso', 'um', 'custo', 'valorTotal'],
    saidas: ['central', 'dtEmissao', 'os', 'contrato', 'categoria', 'fornecedor', 'material', 'materialOriginal', 'peso', 'um', 'custo', 'valorTotal'],
    lancamentos: ['central', 'dtLanc', 'fornecedor', 'municipio', 'categoria', 'material', 'materialOriginal', 'peso', 'um', 'custo', 'valorTotal'],
    sap: ['usuario', 'movimento', 'ref', 'documento', 'central', 'deposito', 'dtDoc', 'dtLanc', 'dtReg', 'material', 'materialOriginal', 'peso', 'um', 'custoUnit', 'valorTotal'],
    producao: ['mes', 'central', 'producao', 'um', 'precoMedio', 'custoMedio', 'margem', 'totalVendas'],
    dashboard: ['modulo', 'material', 'central', 'valor', 'data', 'status'],
    imports: ['arquivo', 'modulo', 'registros', 'dataHora', 'status'],
    configs: ['key', 'value', 'desc', 'created'],
    filiais: ['origem', 'alias', 'cnpj', 'regional', 'created'],
    materiais: ['origem', 'alias', 'desc', 'created']
  };
  return map[scope] || [];
}
