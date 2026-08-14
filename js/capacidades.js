'use strict';

// ══════════════════════════════════════════════════════════════════════════════
// CAPACIDADES E ESTOQUE DE SEGURANÇA (Configurações)
// ══════════════════════════════════════════════════════════════════════════════
// Capacidade física de armazenagem de cada central por material —
// SILO (aglomerantes), BAIA (agregados miúdos/graúdos) e IBC/TANQUE (aditivos).
//
// TRÊS FONTES, nesta ordem de precedência (decisão do Hugo, 14/08/2026):
//   1. manual     — valor digitado direto na célula, vence tudo;
//   2. estrutura  — soma das unidades declaradas (silos/baias/tanques), com
//                   irregularidades já descontadas — ver capEstruturaTotal;
//   3. lançamentos— estimativa: média dos CAP_TOP_N maiores lançamentos da
//                   janela. É o fallback de quem ainda não declarou estrutura.
//
// Por que a MÉDIA DOS N MAIORES e não a média simples: o saldo lançado quase
// nunca está no topo do silo/baia, então a média de todos os lançamentos fica
// muito abaixo da capacidade real e acusaria "acima da capacidade" o tempo
// todo. A média dos CAP_TOP_N maiores aproxima o teto real sem ficar refém de
// um único pico de digitação errada (o que aconteceria usando só o máximo).
//
// UNIDADE: silo e tanque são declarados na mesma UM dos lançamentos (kg/L);
// baia é declarada em DIMENSÕES e sai em m³ (decisão do Hugo: "o volume é da
// baia, não do material" — sem massa específica no meio). Quando a UM dos
// lançamentos daquela linha não é m³, a linha ganha um aviso de que a
// comparação capacidade × estoque lançado não é direta — ver capAlertaUM.
//
// ADIÇÕES ficam de fora de propósito — não têm estrutura de armazenagem
// própria mapeada.
//
// Só o que o usuário declara é persistido (overrides e estruturas); o resto
// é recalculado a cada render.
// ══════════════════════════════════════════════════════════════════════════════

const CAP_TOP_N = 5;            // quantos maiores lançamentos entram na média
const CAP_JANELA_MESES = 12;    // janela de histórico considerada
const CAP_PCT_PADRAO = 25;      // % da capacidade usada como estoque de segurança
const CAP_FATOR_BAIA_PADRAO = 85; // % de aproveitamento do volume da baia
const CAP_FATOR_BAIA_KEY = 'cap_fator_aproveitamento_baia';
const CAP_OVERRIDES_KEY = '__capacidades_overrides__';
const CAP_ESTRUTURAS_KEY = '__capacidades_estruturas__';
const CAP_PAGE_SIZE = PAGE_SIZE;

// Situação de cada unidade declarada — a irregularidade é POR UNIDADE (silo 2
// com incrustação não afeta os outros silos da mesma central).
const CAP_SITUACOES = {
  normal:   { label: 'Normal',              icone: 'ti-circle-check',    cor: 'var(--green)' },
  reduzida: { label: 'Capacidade reduzida', icone: 'ti-alert-triangle',  cor: 'var(--amber)' },
  fora:     { label: 'Fora de operação',    icone: 'ti-circle-x',        cor: 'var(--red)'   }
};

// Categoria cadastrada (normalize.js/CATEGORIAS_MATERIAL) → estrutura física.
// "Adição" não está aqui de propósito: material sem entrada neste mapa é
// simplesmente ignorado na tabela.
const CAP_ARMAZENAGEM = {
  'Aglomerante':     { tipo: 'Silo',       icone: 'ti-droplet',  cor: 'var(--amber)',  catKey: 'aglomerante' },
  'Agregado Graúdo': { tipo: 'Baia',       icone: 'ti-mountain', cor: 'var(--teal)',   catKey: 'agregado'    },
  'Agregado Miúdo':  { tipo: 'Baia',       icone: 'ti-mountain', cor: 'var(--teal)',   catKey: 'agregado'    },
  'Aditivo':         { tipo: 'IBC/Tanque', icone: 'ti-flask',    cor: 'var(--purple)', catKey: 'aditivo'     }
};

const CAP_CATS_PCT = [
  { catKey: 'aglomerante', label: 'Aglomerantes (silos)' },
  { catKey: 'agregado',    label: 'Agregados (baias)'    },
  { catKey: 'aditivo',     label: 'Aditivos (IBC/tanques)' }
];

const CAP_BUSCA_CAMPOS = ['central', 'grupo', 'codSap', 'categoria', 'tipo'];

let _capRowsCache = null;
let _capCacheSig = '';
let capPage = 0;
let capFiltro = '';

function capInvalidarCache() { _capRowsCache = null; _capCacheSig = ''; }

// Assinatura barata do que alimenta o cálculo — importar/excluir lançamentos
// ou materiais já derruba o cache sozinho, sem precisar de hook em cada
// caminho de escrita. Edições que não mudam a contagem (ex.: trocar a
// categoria de um material) são cobertas por atualizarCadastros(), que chama
// capInvalidarCache explicitamente.
function _capCacheSignature() {
  return `${(state.lancamentos || []).length}|${(state.materiais || []).length}`;
}

// ── Overrides manuais ─────────────────────────────────────────────────────
// Guardados como UMA linha de state.configs (JSON), não uma config por
// célula: pega persistência local + sync na nuvem de graça (_configsSyncUpsert)
// sem inundar a tabela "Configurações Personalizadas" com centenas de linhas.
// Mesmo padrão de __responsavel_padrao__.
// ponytail: teto ~algumas centenas de overrides num único campo texto. Se um
// dia virar milhares, migra pra tabela própria no Supabase.
function capGetOverrides() {
  const cfg = state.configs.find(c => c.key === CAP_OVERRIDES_KEY);
  if (!cfg || !cfg.value) return {};
  try {
    const obj = JSON.parse(cfg.value);
    return (obj && typeof obj === 'object') ? obj : {};
  } catch (err) {
    console.warn('[Capacidades] Overrides ilegíveis — ignorando.', err);
    return {};
  }
}

function capSalvarOverrides(map) {
  const rec = {
    key: CAP_OVERRIDES_KEY,
    value: JSON.stringify(map),
    desc: 'Capacidades e estoques de segurança editados manualmente',
    created: new Date().toLocaleDateString('pt-BR')
  };
  const i = state.configs.findIndex(c => c.key === CAP_OVERRIDES_KEY);
  if (i >= 0) state.configs[i] = rec; else state.configs.unshift(rec);
  persist();
  if (window.supabaseClient && typeof _configsSyncUpsert === 'function') _configsSyncUpsert(rec);
}

// ── Estrutura física declarada ────────────────────────────────────────────
// Mesmo esquema de armazenamento dos overrides: uma linha só de state.configs
// com o JSON de todas as estruturas, chaveado por central|||grupo.
//   { "CENTRAL|||GRUPO": [ unidade, unidade, ... ] }
// Unidade de silo/tanque: { cap, situacao, reducaoPct, obs }
// Unidade de baia:        { larg, comp, prof, situacao, reducaoPct, obs }
function capGetEstruturas() {
  const cfg = state.configs.find(c => c.key === CAP_ESTRUTURAS_KEY);
  if (!cfg || !cfg.value) return {};
  try {
    const obj = JSON.parse(cfg.value);
    return (obj && typeof obj === 'object') ? obj : {};
  } catch (err) {
    console.warn('[Capacidades] Estruturas ilegíveis — ignorando.', err);
    return {};
  }
}

function capSalvarEstruturas(map) {
  const rec = {
    key: CAP_ESTRUTURAS_KEY,
    value: JSON.stringify(map),
    desc: 'Silos, baias e tanques declarados por central e material',
    created: new Date().toLocaleDateString('pt-BR')
  };
  const i = state.configs.findIndex(c => c.key === CAP_ESTRUTURAS_KEY);
  if (i >= 0) state.configs[i] = rec; else state.configs.unshift(rec);
  persist();
  if (window.supabaseClient && typeof _configsSyncUpsert === 'function') _configsSyncUpsert(rec);
}

function capFatorBaia() {
  const cfg = state.configs.find(c => normalizeText(c.key) === normalizeText(CAP_FATOR_BAIA_KEY));
  const n = cfg ? num(cfg.value) : NaN;
  return (Number.isFinite(n) && n > 0) ? n : CAP_FATOR_BAIA_PADRAO;
}

// Capacidade NOMINAL de uma unidade, antes de descontar irregularidade.
// Baia: largura × comprimento × profundidade × fator de aproveitamento
// (o agregado empilhado forma talude e não enche a baia como uma caixa).
function capUnidadeNominal(u, ehAgregado, fator) {
  if (ehAgregado) {
    const v = num(u.larg) * num(u.comp) * num(u.prof);
    return v > 0 ? v * (fator / 100) : 0;
  }
  return Math.max(0, num(u.cap));
}

// Capacidade EFETIVA — nominal menos o impacto da irregularidade declarada.
function capUnidadeEfetiva(u, ehAgregado, fator) {
  const nominal = capUnidadeNominal(u, ehAgregado, fator);
  if (u.situacao === 'fora') return 0;
  if (u.situacao === 'reduzida') {
    const pct = Math.min(100, Math.max(0, num(u.reducaoPct)));
    return nominal * (1 - pct / 100);
  }
  return nominal;
}

// Soma da estrutura + o resumo usado na tabela. Devolve null quando não há
// estrutura declarada, para o chamador cair no fallback dos lançamentos.
function capEstruturaTotal(unidades, ehAgregado) {
  if (!Array.isArray(unidades) || !unidades.length) return null;
  const fator = capFatorBaia();
  let total = 0, nominal = 0, fora = 0, reduzidas = 0, comObs = 0;
  unidades.forEach(u => {
    nominal += capUnidadeNominal(u, ehAgregado, fator);
    total   += capUnidadeEfetiva(u, ehAgregado, fator);
    if (u.situacao === 'fora') fora++;
    else if (u.situacao === 'reduzida') reduzidas++;
    if (u.obs) comObs++;
  });
  return { total, nominal, fora, reduzidas, comObs, qtd: unidades.length };
}

// ── % de estoque de segurança por categoria ───────────────────────────────
function capPctSeguranca(catKey) {
  const cfg = state.configs.find(c => normalizeText(c.key) === normalizeText(`estsec_pct_${catKey}`));
  const n = cfg ? num(cfg.value) : NaN;
  return (Number.isFinite(n) && n > 0) ? n : CAP_PCT_PADRAO;
}

function loadCapPctInputs() {
  CAP_CATS_PCT.forEach(({ catKey }) => {
    const input = document.getElementById(`cap-pct-${catKey}`);
    if (input) input.value = capPctSeguranca(catKey);
  });
  const fator = document.getElementById('cap-fator-baia');
  if (fator) fator.value = capFatorBaia();
}

function _capUpsertConfig(key, valor, desc) {
  const rec = { key, value: String(valor), desc, created: new Date().toLocaleDateString('pt-BR') };
  const i = state.configs.findIndex(c => normalizeText(c.key) === normalizeText(key));
  if (i >= 0) state.configs[i] = rec; else state.configs.unshift(rec);
  if (window.supabaseClient && typeof _configsSyncUpsert === 'function') _configsSyncUpsert(rec);
}

function salvarPctSeguranca() {
  let salvos = 0;
  CAP_CATS_PCT.forEach(({ catKey, label }) => {
    const input = document.getElementById(`cap-pct-${catKey}`);
    if (!input) return;
    const n = num(input.value);
    if (!Number.isFinite(n) || n <= 0) return;
    _capUpsertConfig(`estsec_pct_${catKey}`, n, `Estoque de segurança — % da capacidade para ${label}`);
    salvos++;
  });
  const inFator = document.getElementById('cap-fator-baia');
  if (inFator) {
    const f = num(inFator.value);
    if (Number.isFinite(f) && f > 0 && f <= 100) {
      _capUpsertConfig(CAP_FATOR_BAIA_KEY, f, 'Aproveitamento do volume da baia (%)');
      salvos++;
    }
  }
  if (!salvos) { toast('Informe percentuais maiores que zero', 'error'); return; }
  persist();
  capInvalidarCache();
  renderCapacidades();
  if (typeof renderConfigs === 'function') renderConfigs();
  toast(`${salvos} percentual(is) salvo(s)`);
}

// ── Cálculo ───────────────────────────────────────────────────────────────
// Categoria vem do CADASTRO de materiais (fonte única, igual à Saúde da
// Central). Material sem categoria cadastrada não entra na tabela — não dá
// pra saber se é silo, baia ou tanque.
function _capCategoriaDe(grupo, cache) {
  if (cache.has(grupo)) return cache.get(grupo);
  const cat = (typeof getCategoriaPorGrupo === 'function') ? getCategoriaPorGrupo(grupo) : '';
  cache.set(grupo, cat);
  return cat;
}

function capRowKey(central, grupo) { return `${central}|||${grupo}`; }

// A UM dos lançamentos vem de planilha e não tem grafia única para metro
// cúbico — M3, M³, MC, m3. Só vale avisar de divergência de unidade quando
// realmente não for volume.
function _capEhM3(um) {
  return /^(M3|M³|MC|M\^3)$/i.test(String(um || '').trim());
}

function getCapacidadesRows() {
  const sig = _capCacheSignature();
  if (_capRowsCache && _capCacheSig === sig) return _capRowsCache;
  _capCacheSig = sig;

  const catCache = new Map();
  const buckets = new Map(); // key -> { central, grupo, categoria, um, pesos:[[t,peso]] }
  let maxT = 0;

  for (const r of (state.lancamentos || [])) {
    const central = String(r.central || '').trim();
    const grupo   = String(r.material || '').trim();
    if (!central || !grupo) continue;

    const categoria = _capCategoriaDe(grupo, catCache);
    if (!CAP_ARMAZENAGEM[categoria]) continue; // sem cadastro, ou Adição

    const peso = num(r.peso);
    if (!(peso > 0)) continue;

    const dt = parseDate(r.dtLanc);
    if (!dt) continue;
    const t = dt.getTime();
    if (t > maxT) maxT = t;

    const key = capRowKey(central, grupo);
    let b = buckets.get(key);
    if (!b) {
      b = { central, grupo, categoria, um: '', pesos: [] };
      buckets.set(key, b);
    }
    if (!b.um && r.um) b.um = String(r.um).trim();
    b.pesos.push([t, peso]);
  }

  if (!maxT) { _capRowsCache = []; return _capRowsCache; }

  // Janela ancorada no lançamento mais recente da base (e não em "hoje"):
  // se o usuário está analisando um histórico que termina meses atrás, a
  // tabela continua fazendo sentido em vez de ficar vazia.
  const ref = new Date(maxT);
  const corte = new Date(ref.getFullYear(), ref.getMonth() - CAP_JANELA_MESES, ref.getDate()).getTime();

  const overrides = capGetOverrides();
  const estruturas = capGetEstruturas();
  const rows = [];

  buckets.forEach((b, key) => {
    const naJanela = b.pesos.filter(([t]) => t >= corte).map(([, p]) => p);
    if (!naJanela.length) return;

    naJanela.sort((a, z) => z - a);
    const topo = naJanela.slice(0, CAP_TOP_N);
    const capLanc = topo.reduce((s, v) => s + v, 0) / topo.length;

    const arm = CAP_ARMAZENAGEM[b.categoria];
    const ehAgregado = arm.catKey === 'agregado';
    const pct = capPctSeguranca(arm.catKey);

    const unidades = Array.isArray(estruturas[key]) ? estruturas[key] : [];
    const est = capEstruturaTotal(unidades, ehAgregado);

    const ov = overrides[key] || {};
    const capManual = Number.isFinite(ov.cap);
    const segManual = Number.isFinite(ov.seg);

    // Uma estrutura só "manda" no número se alguma unidade tiver medida. Quem
    // registrou apenas uma observação (sem capacidade/dimensões) continua com
    // a estimativa dos lançamentos, mas a coluna Estrutura segue mostrando o
    // que foi declarado. Total zero com nominal > 0 é caso legítimo: tudo
    // fora de operação.
    const temCapDeclarada = !!est && est.nominal > 0;

    // Precedência: manual > estrutura declarada > estimativa dos lançamentos.
    const fonte = capManual ? 'manual' : (temCapDeclarada ? 'estrutura' : 'lancamentos');
    const capAuto = temCapDeclarada ? est.total : capLanc;  // vale quando não há edição manual
    const capacidade = capManual ? num(ov.cap) : capAuto;
    const segAuto = capacidade * pct / 100;

    // Baia é declarada em m³; o lançamento vem na UM do material. Quando a
    // estrutura manda e as unidades divergem, a comparação não é direta.
    const um = b.um || 'KG';
    const umExibicao = (ehAgregado && temCapDeclarada) ? 'm³' : um;
    const capAlertaUM = ehAgregado && temCapDeclarada && !_capEhM3(um);

    rows.push({
      key,
      central: b.central,
      grupo: b.grupo,
      codSap: (typeof getCodSapPorGrupo === 'function' ? getCodSapPorGrupo(b.grupo) : '') || '',
      categoria: b.categoria,
      tipo: arm.tipo,
      icone: arm.icone,
      cor: arm.cor,
      catKey: arm.catKey,
      ehAgregado,
      pct,
      um,
      umExibicao,
      capAlertaUM,
      temCapDeclarada,
      amostras: naJanela.length,
      capLanc,
      est,
      fonte,
      capAuto,
      segAuto,
      capacidade,
      seguranca: segManual ? num(ov.seg) : segAuto,
      capManual,
      segManual
    });
  });

  rows.sort((a, b) =>
    a.central.localeCompare(b.central, 'pt-BR') ||
    a.grupo.localeCompare(b.grupo, 'pt-BR'));

  _capRowsCache = rows;
  return rows;
}

// Consulta pública pra outras telas (Visão Micro) — devolve a capacidade e o
// estoque de segurança vigentes (manual se houver, senão o automático).
// Indexado: a Visão Micro chama isto uma vez por material de cada central,
// o que com .find() viraria varredura quadrática sobre a tabela inteira.
let _capRowsIndex = null;
let _capIndexOf = null;   // array de referência que gerou o índice

function getCapacidadeCentralMaterial(central, material) {
  const rows = getCapacidadesRows();
  if (_capIndexOf !== rows) {
    _capRowsIndex = new Map(rows.map(r => [r.key, r]));
    _capIndexOf = rows;
  }
  const key = capRowKey(String(central || '').trim(), String(material || '').trim());
  return _capRowsIndex.get(key) || null;
}

// ══════════════════════════════════════════════════════════════════════════
// CLASSIFICAÇÃO DE ESTOQUE × CAPACIDADE — motor consumido pela Visão Micro
// ══════════════════════════════════════════════════════════════════════════
// Compara o estoque de uma central+material (na Visão Micro, o Est. Final do
// último lançamento) com a capacidade e o estoque de segurança da tabela de
// Configurações. Só lógica — quem desenha badge, chip ou filtro é a tela.
//
// Os cortes são configuráveis (chaves cap_lim_*) para permitir calibrar sem
// mexer em código; os defaults abaixo são o ponto de partida.
// "ordem" é a gravidade — usada pra ordenar a seção da Visão Micro.
const CAP_FAIXAS = {
  sem_base: { label: 'SEM BASE',            icone: 'ti-help-circle',    cor: 'var(--text3)',   ordem: 0 },
  normal:   { label: 'NORMAL',              icone: 'ti-circle-check',   cor: 'var(--green)',   ordem: 1 },
  abaixo:   { label: 'ABAIXO DO MÍNIMO',    icone: 'ti-arrow-down',     cor: 'var(--amber)',   ordem: 2 },
  limite:   { label: 'NO LIMITE',           icone: 'ti-alert-triangle', cor: 'var(--urgente)', ordem: 3 },
  ruptura:  { label: 'RUPTURA',             icone: 'ti-flame',          cor: 'var(--red)',     ordem: 4 },
  acima:    { label: 'ACIMA DA CAPACIDADE', icone: 'ti-alert-octagon',  cor: 'var(--red)',     ordem: 5 },
  // Faixa mais alta: não é "silo cheio demais", é estoque que não caberia
  // fisicamente na central. Na prática, quase sempre um zero a mais no
  // lançamento — que era a dor original que motivou esta tabela.
  erro:     { label: 'PROVÁVEL ERRO DE LANÇAMENTO', icone: 'ti-alert-hexagon', cor: 'var(--red)', ordem: 6 }
};

const CAP_LIMITES_PADRAO = {
  ruptura: 50,   // % do estoque de segurança — abaixo disso é ruptura
  limite:  90,   // % da capacidade — a partir daí a central está "no limite"
  acima:  110,   // % da capacidade — acima disso não cabe fisicamente
  erro:   150    // % da capacidade — acima disso é provável erro de digitação
};

// Abaixo deste número de lançamentos na janela, a estimativa (quando não há
// estrutura declarada) é frágil demais pra gerar alerta — vira "sem base".
const CAP_MIN_AMOSTRAS = 3;

function capLimite(nome) {
  const cfg = state.configs.find(c => normalizeText(c.key) === normalizeText(`cap_lim_${nome}`));
  const n = cfg ? num(cfg.value) : NaN;
  return (Number.isFinite(n) && n > 0) ? n : CAP_LIMITES_PADRAO[nome];
}

// estoque: peso/volume lançado a comparar. Devolve sempre um objeto — a tela
// decide se desenha ou não a partir de .faixa.
function classificarEstoqueCapacidade(central, material, estoque) {
  const r = getCapacidadeCentralMaterial(central, material);
  const semBase = motivo => ({ faixa: 'sem_base', motivo, ...CAP_FAIXAS.sem_base, row: r });

  if (!r) return semBase('Central/material sem capacidade calculada — sem lançamentos na janela ou material sem categoria cadastrada.');
  if (!(r.capacidade > 0)) return semBase('Capacidade zerada — declare a estrutura ou informe o valor manualmente.');
  if (r.capAlertaUM) return semBase(`Baia declarada em m³ e lançamentos em ${r.um} — as unidades não são comparáveis.`);
  if (r.fonte === 'lancamentos' && r.amostras < CAP_MIN_AMOSTRAS) {
    return semBase(`Capacidade estimada com apenas ${r.amostras} lançamento(s) — declare a estrutura para liberar o alerta.`);
  }

  const est = num(estoque);
  const C = r.capacidade;
  const S = r.seguranca;
  const pctCap = C > 0 ? (est / C) * 100 : 0;
  const pctSeg = S > 0 ? (est / S) * 100 : null;

  let faixa;
  if (pctCap > capLimite('erro'))         faixa = 'erro';
  else if (pctCap > capLimite('acima'))   faixa = 'acima';
  else if (pctCap >= capLimite('limite')) faixa = 'limite';
  else if (S > 0 && pctSeg < capLimite('ruptura')) faixa = 'ruptura';
  else if (S > 0 && est < S)              faixa = 'abaixo';
  else                                    faixa = 'normal';

  // Quanto sobra acima da capacidade ou falta para o estoque de segurança —
  // é o número que gera ação (comprar ou conferir o lançamento).
  const delta = (faixa === 'acima' || faixa === 'erro' || faixa === 'limite')
    ? est - C
    : (S > 0 ? est - S : 0);

  return { faixa, ...CAP_FAIXAS[faixa], row: r, estoque: est, capacidade: C, seguranca: S, pctCap, pctSeg, delta, um: r.umExibicao };
}

// ══════════════════════════════════════════════════════════════════════════
// SEÇÃO "CAPACIDADE E ESTOQUE DE SEGURANÇA" DO CARD DA VISÃO MICRO
// ══════════════════════════════════════════════════════════════════════════
// Renderizada acima de "Integração SAP" no corpo do card (analitico.js).
// Lista TODOS os materiais fora da faixa, ordenados por gravidade; os que
// estão normais ou sem base viram contadores no título, pra não ocupar
// espaço com o que não pede ação.
//
// A seção é SEMPRE renderizada — inclusive vazia — de propósito: sumir
// quando está tudo bem faria os cards mudarem de altura entre si e
// esconderia justamente o caso "capacidade não configurada", que também
// precisa aparecer.
//
// materiais: [{ mat, estoque, ausente }] — estoque é o Est. Final do último
// lançamento do período (o mesmo número da coluna da tabela de materiais).
function buildCapacidadeSection({ central, materiais }) {
  const avaliados = [];
  let normais = 0, semBase = 0, ausentes = 0;

  (materiais || []).forEach(({ mat, estoque, ausente }) => {
    if (ausente) { ausentes++; return; }
    const c = classificarEstoqueCapacidade(central, mat, estoque);
    if (c.faixa === 'sem_base') { semBase++; return; }
    if (c.faixa === 'normal')   { normais++; return; }
    avaliados.push({ mat, c });
  });

  // Pior primeiro; dentro da mesma faixa, o maior desvio absoluto na frente.
  avaliados.sort((a, b) => (b.c.ordem - a.c.ordem) || (Math.abs(b.c.delta) - Math.abs(a.c.delta)));

  const contadores = [];
  if (normais)  contadores.push(`<span class="capsec-count capsec-count-ok"><i class="ti ti-circle-check"></i> ${normais} na faixa</span>`);
  if (semBase)  contadores.push(`<span class="capsec-count capsec-count-neutro" title="Sem capacidade confiável — declare a estrutura em Configurações"><i class="ti ti-help-circle"></i> ${semBase} sem base</span>`);
  if (ausentes) contadores.push(`<span class="capsec-count capsec-count-neutro" title="Sem lançamento no período — não há estoque final para comparar"><i class="ti ti-calendar-off"></i> ${ausentes} sem lançamento</span>`);

  let corpo;
  if (avaliados.length) {
    corpo = `
      <div class="capsec-table-wrap">
        <table class="capsec-table">
          <thead>
            <tr>
              <th>Material</th>
              <th>Situação</th>
              <th style="text-align:right">Estoque</th>
              <th style="text-align:right">Capacidade</th>
              <th style="text-align:right">Est. Segurança</th>
              <th style="text-align:right">Ocupação</th>
              <th style="text-align:right">A mais / a menos</th>
            </tr>
          </thead>
          <tbody>${avaliados.map(({ mat, c }) => {
            const acima = c.delta > 0;
            const refLabel = (c.faixa === 'acima' || c.faixa === 'erro' || c.faixa === 'limite')
              ? 'da capacidade' : 'do estoque de segurança';
            return `
            <tr title="${escapeHtml(capExplicacaoFaixa(c))}">
              <td class="td-mono capsec-mat">${escapeHtml(mat)}</td>
              <td><span class="capsec-badge" style="color:${c.cor};border-color:${c.cor}"><i class="ti ${c.icone}"></i> ${escapeHtml(c.label)}</span></td>
              <td class="td-mono capsec-val" style="color:${c.cor}">${_capNum(c.estoque)} ${escapeHtml(c.um)}</td>
              <td class="td-mono capsec-val capsec-ref">${_capNum(c.capacidade)} ${escapeHtml(c.um)}</td>
              <td class="td-mono capsec-val capsec-ref">${c.seguranca > 0 ? `${_capNum(c.seguranca)} ${escapeHtml(c.um)}` : '—'}</td>
              <td class="td-mono capsec-val" style="color:${c.cor}">${_capNum(c.pctCap)}%</td>
              <td class="td-mono capsec-val" style="color:${c.cor}" title="${escapeHtml(`${acima ? 'Excedente em relação' : 'Falta em relação'} ${refLabel}`)}">
                ${acima ? '+' : '−'}${_capNum(Math.abs(c.delta))} ${escapeHtml(c.um)}
              </td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>`;
  } else if (normais) {
    corpo = `<span class="capsec-empty capsec-empty-ok"><i class="ti ti-circle-check"></i> Todos os estoques dentro da faixa de capacidade</span>`;
  } else if (semBase) {
    // Há material pra avaliar, mas nenhum tem capacidade confiável.
    corpo = `<span class="capsec-empty"><i class="ti ti-settings-exclamation"></i> Capacidade não configurada para os materiais desta central —
      <a href="#" onclick="event.preventDefault();event.stopPropagation();irParaCapacidades()">declarar em Configurações</a></span>`;
  } else {
    corpo = `<span class="capsec-empty"><i class="ti ti-calendar-off"></i> Nenhum material com lançamento no período para comparar</span>`;
  }

  return `
    <div class="capsec-section">
      <div class="micro-section-title">
        <i class="ti ti-gauge"></i>
        Capacidade e Estoque de Segurança
        <span class="capsec-counts">${contadores.join('')}</span>
      </div>
      ${corpo}
    </div>`;
}

// Faixas distintas presentes numa central — usada pelo filtro "Capacidade"
// da Visão Micro pra decidir se o card aparece.
function capFaixasDaCentral(central, materiais) {
  const set = new Set();
  (materiais || []).forEach(({ mat, estoque, ausente }) => {
    if (ausente) return;
    set.add(classificarEstoqueCapacidade(central, mat, estoque).faixa);
  });
  return [...set];
}

// Atalho do estado vazio — leva pra tabela de Capacidades nas Configurações.
function irParaCapacidades() {
  if (typeof navigate === 'function') navigate('configuracoes');
  setTimeout(() => {
    document.getElementById('tb-capacidades')?.closest('.table-card')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 120);
}

// Texto pronto pro tooltip do badge — abre a conta em vez de só dar o rótulo.
function capExplicacaoFaixa(c) {
  if (!c) return '';
  if (c.faixa === 'sem_base') return `Sem base para avaliar. ${c.motivo}`;
  const linhas = [
    `${c.label} — estoque ${_capNum(c.estoque)} ${c.um}`,
    `Capacidade: ${_capNum(c.capacidade)} ${c.um} (${_capNum(c.pctCap)}% ocupado)`,
  ];
  if (c.seguranca > 0) linhas.push(`Estoque de segurança: ${_capNum(c.seguranca)} ${c.um}`);
  if (c.row?.fonte === 'estrutura') linhas.push(`Capacidade vinda da estrutura declarada (${c.row.est.qtd} ${_capUnidadeLabel(c.row.catKey, c.row.est.qtd)}).`);
  else if (c.row?.fonte === 'manual') linhas.push('Capacidade definida manualmente.');
  else linhas.push(`Capacidade estimada pelos ${Math.min(CAP_TOP_N, c.row?.amostras || 0)} maiores lançamentos.`);
  return linhas.join('\n');
}

// ── Render ────────────────────────────────────────────────────────────────
function capDadosFiltrados() {
  // Sem o 4º argumento de propósito: filterRecords só usa o índice invertido
  // (cacheado por escopo) quando recebe scope, e estas linhas são derivadas —
  // recalculadas a cada import. São poucas centenas, a varredura direta é
  // instantânea e não tem cache pra invalidar.
  return filterRecords(getCapacidadesRows(), capFiltro, CAP_BUSCA_CAMPOS);
}

function capFiltrar(valor) {
  capFiltro = valor;
  capPage = 0;
  renderCapacidades();
}

function capIrParaPagina(p) { capPage = Math.max(0, p); renderCapacidades(); }
function capPaginaAnterior() { capIrParaPagina(capPage - 1); }
function capProximaPagina() {
  const total = Math.ceil(capDadosFiltrados().length / CAP_PAGE_SIZE);
  if (capPage < total - 1) capIrParaPagina(capPage + 1);
}
function capIrParaUltima() {
  const total = Math.ceil(capDadosFiltrados().length / CAP_PAGE_SIZE);
  capIrParaPagina(Math.max(0, total - 1));
}

function _capNum(v) {
  return num(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Como "silo"/"baia"/"tanque" aparecem no singular e no plural na tabela.
function _capUnidadeLabel(catKey, qtd) {
  const l = { aglomerante: ['silo', 'silos'], agregado: ['baia', 'baias'], aditivo: ['tanque', 'tanques'] }[catKey]
         || ['unidade', 'unidades'];
  return qtd === 1 ? l[0] : l[1];
}

// Texto do tooltip da capacidade — deixa explícito de onde saiu o número e
// quais eram as outras opções, pra o usuário não ter que adivinhar.
function _capOrigemDescricao(r) {
  const partes = [];
  if (r.fonte === 'manual') partes.push('Valor editado manualmente.');
  else if (r.fonte === 'estrutura') partes.push(`Soma de ${r.est.qtd} ${_capUnidadeLabel(r.catKey, r.est.qtd)} declarados.`);
  else partes.push(`Estimado pela média dos ${Math.min(CAP_TOP_N, r.amostras)} maiores lançamentos da janela.`);

  if (r.est) {
    const umEst = r.ehAgregado ? 'm³' : r.um;
    if (r.est.fora) partes.push(`${r.est.fora} fora de operação (não somam).`);
    if (r.est.reduzidas) partes.push(`${r.est.reduzidas} com capacidade reduzida.`);
    if (Math.abs(r.est.nominal - r.est.total) > 0.005) {
      partes.push(`Nominal sem irregularidades: ${_capNum(r.est.nominal)} ${umEst}.`);
    }
    if (r.fonte === 'manual' && r.temCapDeclarada) partes.push(`Estrutura declarada: ${_capNum(r.est.total)} ${umEst}.`);
    if (!r.temCapDeclarada) partes.push('Unidades declaradas sem medida — a capacidade segue estimada pelos lançamentos.');
  }
  if (r.fonte !== 'lancamentos') partes.push(`Estimativa pelos lançamentos: ${_capNum(r.capLanc)} ${r.um}.`);
  return partes.join(' ');
}

function _capFonteChip(r) {
  if (r.fonte === 'manual') return '<span class="cap-badge-manual" title="Valor alterado manualmente">manual</span>';
  if (r.fonte === 'estrutura') return '<span class="cap-badge-estrutura" title="Calculado a partir da estrutura declarada">estrutura</span>';
  return '';
}

function _capEstruturaCelula(r, k) {
  const irregulares = r.est ? (r.est.fora + r.est.reduzidas + r.est.comObs) : 0;
  const alerta = irregulares
    ? `<i class="ti ti-alert-triangle cap-irregular-icon" title="${escapeHtml(
        [r.est.fora ? `${r.est.fora} fora de operação` : '',
         r.est.reduzidas ? `${r.est.reduzidas} com capacidade reduzida` : '',
         r.est.comObs ? `${r.est.comObs} com observação registrada` : '']
          .filter(Boolean).join(' · '))}"></i>`
    : '';
  const avisoUM = r.capAlertaUM
    ? `<i class="ti ti-ruler-measure cap-um-alerta" title="${escapeHtml(
        `Baia declarada em m³, mas os lançamentos desta linha estão em ${r.um} — a comparação capacidade × estoque lançado não é direta.`)}"></i>`
    : '';
  const label = r.est
    ? `${r.est.qtd} ${_capUnidadeLabel(r.catKey, r.est.qtd)}`
    : 'definir';
  const cls = r.est ? 'btn-link-cap definido' : 'btn-link-cap';
  return `<div class="cap-cell">
    <button class="${cls}" data-key="${k}" onclick="abrirEstruturaCapacidade(this)" title="Declarar silos, baias e tanques desta central">
      <i class="ti ti-layout-grid-add"></i> ${label}
    </button>${alerta}${avisoUM}
  </div>`;
}

function renderCapacidades() {
  const tb = document.getElementById('tb-capacidades');
  if (!tb) return;
  loadCapPctInputs();

  const data = capDadosFiltrados();
  const totalPages = Math.max(1, Math.ceil(data.length / CAP_PAGE_SIZE));
  if (capPage > totalPages - 1) capPage = totalPages - 1;
  const pageData = data.slice(capPage * CAP_PAGE_SIZE, (capPage + 1) * CAP_PAGE_SIZE);

  const info = document.getElementById('pi-capacidades');
  if (info) {
    info.textContent = data.length === 0
      ? '0 registros'
      : `${capPage * CAP_PAGE_SIZE + 1}-${Math.min((capPage + 1) * CAP_PAGE_SIZE, data.length)} de ${data.length} registros (pág. ${capPage + 1}/${totalPages})`;
  }

  if (!data.length) {
    tb.innerHTML = `<tr><td colspan="11"><div class="empty-state"><i class="ti ti-barrel"></i><p>${
      capFiltro
        ? 'Nenhum resultado para este filtro.'
        : 'Nada a calcular ainda — importe Lançamentos e cadastre a categoria dos materiais.'
    }</p></div></td></tr>`;
    return;
  }

  // A chave viaja em data-key (nunca interpolada dentro de uma string JS no
  // onclick): nome de material com apóstrofo — "AREIA D'ÁGUA" — quebraria o
  // handler mesmo passando por escapeHtml, já que o parser HTML devolve o
  // &#39; como ' antes do JS ser avaliado.
  tb.innerHTML = pageData.map(r => {
    const k = escapeHtml(r.key);
    const um = escapeHtml(r.umExibicao);
    const capCls = r.capManual ? ' cap-input-editado' : '';
    const segCls = r.segManual ? ' cap-input-editado' : '';
    const capTitle = escapeHtml(_capOrigemDescricao(r));
    const segTitle = escapeHtml(r.segManual
      ? `Editado manualmente — automático: ${_capNum(r.segAuto)} ${r.umExibicao}`
      : `${r.pct}% da capacidade`);
    const editado = (r.capManual || r.segManual);
    return `
    <tr>
      <td><input type="checkbox" class="chk-capacidades-row" value="${k}"></td>
      <td class="td-mono">${escapeHtml(r.central)}</td>
      <td class="td-mono">${escapeHtml(r.grupo)}</td>
      <td class="td-mono">${escapeHtml(r.codSap) || '—'}</td>
      <td class="td-muted"><span class="cap-tipo-chip" style="color:${r.cor}"><i class="ti ${r.icone}"></i> ${escapeHtml(r.tipo)}</span></td>
      <td class="td-muted">${escapeHtml(r.categoria)}</td>
      <td class="td-mono td-muted" title="Lançamentos considerados nos últimos ${CAP_JANELA_MESES} meses">${r.amostras}</td>
      <td>${_capEstruturaCelula(r, k)}</td>
      <td>
        <div class="cap-cell">
          <input type="number" step="0.01" min="0" class="health-cfg-input${capCls}" title="${capTitle}"
                 value="${num(r.capacidade).toFixed(2)}"
                 data-key="${k}" data-campo="cap" onchange="capEditarCelula(this)">
          <span class="cap-um">${um}</span>
          ${_capFonteChip(r)}
        </div>
      </td>
      <td>
        <div class="cap-cell">
          <input type="number" step="0.01" min="0" class="health-cfg-input${segCls}" title="${segTitle}"
                 value="${num(r.seguranca).toFixed(2)}"
                 data-key="${k}" data-campo="seg" onchange="capEditarCelula(this)">
          <span class="cap-um">${um}</span>
          ${r.segManual ? '<span class="cap-badge-manual" title="Valor alterado manualmente">manual</span>' : ''}
        </div>
      </td>
      <td>
        ${editado
          ? `<button class="btn-icon" title="Voltar ao valor calculado automaticamente" data-key="${k}" onclick="capRestaurarAuto(this)"><i class="ti ti-rotate"></i></button>`
          : '<span class="td-muted" style="font-size:11px">auto</span>'}
      </td>
    </tr>`;
  }).join('');
}

// ── Edição ────────────────────────────────────────────────────────────────
function capEditarCelula(el) {
  const key = el?.dataset?.key;
  const campo = el?.dataset?.campo;
  if (!key || !campo) return;
  const row = getCapacidadesRows().find(r => r.key === key);
  if (!row) return;

  const raw = String(el.value ?? '').trim();
  const n = num(raw);
  if (raw && !(n >= 0)) { toast('Informe um valor numérico maior ou igual a zero', 'error'); renderCapacidades(); return; }

  const overrides = capGetOverrides();
  const atual = overrides[key] || {};
  const auto = campo === 'cap' ? row.capAuto : row.segAuto;

  // Campo apagado, ou digitado exatamente igual ao automático, não vira
  // "override" — volta pro calculado, em vez de gravar um zero fantasma ou
  // marcar como manual uma linha que o usuário só passou por cima.
  if (!raw || Math.abs(n - auto) < 0.005) delete atual[campo];
  else atual[campo] = n;

  if (Object.keys(atual).length) overrides[key] = atual;
  else delete overrides[key];

  capSalvarOverrides(overrides);
  capInvalidarCache();
  renderCapacidades();
}

function capRestaurarAuto(el) {
  const key = el?.dataset?.key;
  if (!key) return;
  const overrides = capGetOverrides();
  if (!overrides[key]) return;
  delete overrides[key];
  capSalvarOverrides(overrides);
  capInvalidarCache();
  renderCapacidades();
  toast('Valores recalculados automaticamente');
}

function capToggleSelecionarTodos(checked) {
  document.querySelectorAll('#tb-capacidades .chk-capacidades-row').forEach(el => { el.checked = checked; });
}

function capSelecionados() {
  return [...document.querySelectorAll('#tb-capacidades .chk-capacidades-row:checked')].map(el => el.value);
}

function abrirEdicaoCapacidadesSelecionadas() {
  const keys = capSelecionados();
  if (!keys.length) { toast('Selecione ao menos uma linha para editar', 'error'); return; }
  const info = document.getElementById('cap-massa-info');
  if (info) info.textContent = `${keys.length} linha(s) selecionada(s). Deixe um campo em branco para não alterá-lo.`;
  const inCap = document.getElementById('cap-massa-capacidade');
  const inSeg = document.getElementById('cap-massa-seguranca');
  if (inCap) inCap.value = '';
  if (inSeg) inSeg.value = '';
  openModal('modal-capacidades-massa');
  setTimeout(() => inCap?.focus(), 50);
}

function salvarEdicaoCapacidadesEmMassa() {
  const keys = capSelecionados();
  if (!keys.length) { toast('Nenhuma linha selecionada', 'error'); return; }

  const rawCap = String(document.getElementById('cap-massa-capacidade')?.value ?? '').trim();
  const rawSeg = String(document.getElementById('cap-massa-seguranca')?.value ?? '').trim();
  if (!rawCap && !rawSeg) { toast('Informe ao menos um valor', 'error'); return; }

  const nCap = rawCap ? num(rawCap) : null;
  const nSeg = rawSeg ? num(rawSeg) : null;
  if ((rawCap && !(nCap >= 0)) || (rawSeg && !(nSeg >= 0))) {
    toast('Valores devem ser numéricos e maiores ou iguais a zero', 'error');
    return;
  }

  const overrides = capGetOverrides();
  const porKey = new Map(getCapacidadesRows().map(r => [r.key, r]));
  let aplicados = 0;

  keys.forEach(key => {
    const row = porKey.get(key);
    if (!row) return;
    const atual = overrides[key] || {};
    if (nCap !== null) {
      if (Math.abs(nCap - row.capAuto) < 0.005) delete atual.cap; else atual.cap = nCap;
    }
    if (nSeg !== null) {
      if (Math.abs(nSeg - row.segAuto) < 0.005) delete atual.seg; else atual.seg = nSeg;
    }
    if (Object.keys(atual).length) overrides[key] = atual; else delete overrides[key];
    aplicados++;
  });

  capSalvarOverrides(overrides);
  capInvalidarCache();
  renderCapacidades();
  closeModal('modal-capacidades-massa');
  toast(`${aplicados} linha(s) atualizada(s)`);
}

function restaurarCapacidadesSelecionadas() {
  const keys = capSelecionados();
  if (!keys.length) { toast('Selecione ao menos uma linha', 'error'); return; }
  const overrides = capGetOverrides();
  let removidos = 0;
  keys.forEach(key => { if (overrides[key]) { delete overrides[key]; removidos++; } });
  if (!removidos) { toast('Nenhuma das linhas selecionadas tinha edição manual', 'error'); return; }
  capSalvarOverrides(overrides);
  capInvalidarCache();
  renderCapacidades();
  toast(`${removidos} linha(s) voltaram ao cálculo automático`);
}

// ══════════════════════════════════════════════════════════════════════════
// ESTRUTURA FÍSICA — modal de silos / baias / tanques de uma central
// ══════════════════════════════════════════════════════════════════════════
let _capEstruturaKey = null;   // linha sendo editada
let _capEstruturaRow = null;

function abrirEstruturaCapacidade(el) {
  const key = el?.dataset?.key;
  if (!key) return;
  const row = getCapacidadesRows().find(r => r.key === key);
  if (!row) { toast('Linha não encontrada', 'error'); return; }

  _capEstruturaKey = key;
  _capEstruturaRow = row;

  const titulo = document.getElementById('cap-estrutura-titulo');
  if (titulo) titulo.innerHTML = `<i class="ti ${row.icone}"></i> ${escapeHtml(row.tipo)}s — ${escapeHtml(row.central)}`;
  const sub = document.getElementById('cap-estrutura-sub');
  if (sub) {
    sub.textContent = row.ehAgregado
      ? `${row.grupo} · dimensões em metros, capacidade resultante em m³`
      : `${row.grupo} · capacidade de cada unidade em ${row.um}`;
  }
  const dica = document.getElementById('cap-estrutura-dica');
  if (dica) {
    dica.textContent = row.ehAgregado
      ? `Volume = largura × comprimento × profundidade × ${capFatorBaia()}% de aproveitamento.`
      : 'A capacidade da linha é a soma das unidades, descontadas as irregularidades.';
  }

  const container = document.getElementById('cap-estrutura-rows');
  if (container) {
    container.innerHTML = '';
    const unidades = capGetEstruturas()[key] || [];
    if (unidades.length) unidades.forEach(u => _capAddUnidadeRow(u));
    else _capAddUnidadeRow();
  }
  _capAtualizarTotalEstrutura();
  openModal('modal-capacidade-estrutura');
}

function _capAddUnidadeRow(u) {
  const container = document.getElementById('cap-estrutura-rows');
  if (!container || !_capEstruturaRow) return;
  const row = _capEstruturaRow;
  const dados = u || { situacao: 'normal' };
  const idx = container.children.length + 1;

  const camposMedida = row.ehAgregado
    ? `<label class="cap-un-campo"><span>Largura (m)</span><input type="number" step="0.01" min="0" class="health-cfg-input" data-campo="larg" value="${dados.larg ?? ''}" oninput="_capAtualizarTotalEstrutura()"></label>
       <label class="cap-un-campo"><span>Comprimento (m)</span><input type="number" step="0.01" min="0" class="health-cfg-input" data-campo="comp" value="${dados.comp ?? ''}" oninput="_capAtualizarTotalEstrutura()"></label>
       <label class="cap-un-campo"><span>Profundidade (m)</span><input type="number" step="0.01" min="0" class="health-cfg-input" data-campo="prof" value="${dados.prof ?? ''}" oninput="_capAtualizarTotalEstrutura()"></label>`
    : `<label class="cap-un-campo"><span>Capacidade (${escapeHtml(row.um)})</span><input type="number" step="0.01" min="0" class="health-cfg-input" data-campo="cap" value="${dados.cap ?? ''}" oninput="_capAtualizarTotalEstrutura()"></label>`;

  const situacaoOpts = Object.entries(CAP_SITUACOES).map(([k, s]) =>
    `<option value="${k}"${(dados.situacao || 'normal') === k ? ' selected' : ''}>${s.label}</option>`).join('');

  const div = document.createElement('div');
  div.className = 'cap-un-row';
  div.innerHTML = `
    <div class="cap-un-head">
      <span class="cap-un-num">${escapeHtml(_capUnidadeLabel(row.catKey, 1))} ${idx}</span>
      <span class="cap-un-calc" data-calc>—</span>
      <button class="btn-icon danger" type="button" title="Remover" onclick="_capRemoverUnidadeRow(this)"><i class="ti ti-trash"></i></button>
    </div>
    <div class="cap-un-campos">${camposMedida}</div>
    <div class="cap-un-campos">
      <label class="cap-un-campo"><span>Situação</span>
        <select class="health-cfg-input cap-un-select" data-campo="situacao" onchange="_capSituacaoChange(this)">${situacaoOpts}</select>
      </label>
      <label class="cap-un-campo cap-un-reducao"><span>Redução (%)</span>
        <input type="number" step="1" min="0" max="100" class="health-cfg-input" data-campo="reducaoPct" value="${dados.reducaoPct ?? ''}" oninput="_capAtualizarTotalEstrutura()">
      </label>
      <label class="cap-un-campo cap-un-obs"><span>Irregularidade / observação</span>
        <input type="text" class="form-input" data-campo="obs" placeholder="Ex.: incrustação na parede, aeração com defeito…" value="${escapeHtml(dados.obs || '')}">
      </label>
    </div>`;
  container.appendChild(div);
  _capSituacaoChange(div.querySelector('[data-campo="situacao"]'));
}

// "Redução (%)" só faz sentido em Capacidade reduzida — em Normal e Fora de
// operação o campo some, pra não sugerir um número que não é usado.
function _capSituacaoChange(sel) {
  if (!sel) return;
  const row = sel.closest('.cap-un-row');
  const wrap = row?.querySelector('.cap-un-reducao');
  if (wrap) wrap.style.display = sel.value === 'reduzida' ? '' : 'none';
  _capAtualizarTotalEstrutura();
}

function _capRemoverUnidadeRow(btn) {
  const row = btn.closest('.cap-un-row');
  const container = document.getElementById('cap-estrutura-rows');
  if (!row || !container) return;
  row.remove();
  // Renumera os rótulos para não ficar "silo 1, silo 3" depois de remover.
  [...container.children].forEach((el, i) => {
    const numEl = el.querySelector('.cap-un-num'); // não use "num": sombrearia o helper global
    if (numEl && _capEstruturaRow) numEl.textContent = `${_capUnidadeLabel(_capEstruturaRow.catKey, 1)} ${i + 1}`;
  });
  _capAtualizarTotalEstrutura();
}

// Lê o modal e devolve as unidades declaradas.
function _capLerUnidadesDoModal() {
  const container = document.getElementById('cap-estrutura-rows');
  if (!container || !_capEstruturaRow) return [];
  const ehAgregado = _capEstruturaRow.ehAgregado;
  const unidades = [];
  [...container.children].forEach(el => {
    const get = campo => el.querySelector(`[data-campo="${campo}"]`)?.value ?? '';
    const situacao = CAP_SITUACOES[get('situacao')] ? get('situacao') : 'normal';
    const obs = String(get('obs')).trim();
    const u = { situacao };
    if (obs) u.obs = obs;
    if (situacao === 'reduzida') u.reducaoPct = Math.min(100, Math.max(0, num(get('reducaoPct'))));
    let temMedida;
    if (ehAgregado) {
      const larg = num(get('larg')), comp = num(get('comp')), prof = num(get('prof'));
      temMedida = (larg > 0 || comp > 0 || prof > 0);
      u.larg = larg; u.comp = comp; u.prof = prof;
    } else {
      const cap = num(get('cap'));
      temMedida = cap > 0;
      u.cap = cap;
    }
    // Descarta só a linha REALMENTE vazia. Uma unidade sem medida mas com
    // situação anormal ou observação é mantida de propósito: "silo 3 fora de
    // operação" precisa continuar aparecendo na contagem mesmo sem alguém
    // ter digitado a capacidade dele.
    if (!temMedida && situacao === 'normal' && !obs) return;
    unidades.push(u);
  });
  return unidades;
}

function _capAtualizarTotalEstrutura() {
  const container = document.getElementById('cap-estrutura-rows');
  const totalEl = document.getElementById('cap-estrutura-total');
  if (!container || !_capEstruturaRow) return;
  const ehAgregado = _capEstruturaRow.ehAgregado;
  const umLabel = ehAgregado ? 'm³' : _capEstruturaRow.um;
  const fator = capFatorBaia();

  // Prévia por unidade — o usuário vê o volume da baia sair enquanto digita.
  [...container.children].forEach(el => {
    const get = campo => el.querySelector(`[data-campo="${campo}"]`)?.value ?? '';
    const situacao = el.querySelector('[data-campo="situacao"]')?.value || 'normal';
    const u = ehAgregado
      ? { larg: num(get('larg')), comp: num(get('comp')), prof: num(get('prof')), situacao, reducaoPct: num(get('reducaoPct')) }
      : { cap: num(get('cap')), situacao, reducaoPct: num(get('reducaoPct')) };
    const nominal = capUnidadeNominal(u, ehAgregado, fator);
    const efetiva = capUnidadeEfetiva(u, ehAgregado, fator);
    const calc = el.querySelector('[data-calc]');
    if (!calc) return;
    if (!(nominal > 0)) { calc.textContent = '—'; calc.className = 'cap-un-calc'; return; }
    if (Math.abs(nominal - efetiva) < 0.005) {
      calc.textContent = `${_capNum(efetiva)} ${umLabel}`;
      calc.className = 'cap-un-calc';
    } else {
      calc.textContent = `${_capNum(efetiva)} ${umLabel} (nominal ${_capNum(nominal)})`;
      calc.className = 'cap-un-calc reduzido';
    }
  });

  if (totalEl) {
    const est = capEstruturaTotal(_capLerUnidadesDoModal(), ehAgregado);
    totalEl.textContent = est ? `${_capNum(est.total)} ${umLabel}` : '—';
  }
}

function salvarEstruturaCapacidade() {
  if (!_capEstruturaKey) return;
  const unidades = _capLerUnidadesDoModal();
  const estruturas = capGetEstruturas();
  if (unidades.length) estruturas[_capEstruturaKey] = unidades;
  else delete estruturas[_capEstruturaKey];

  capSalvarEstruturas(estruturas);
  capInvalidarCache();
  renderCapacidades();
  closeModal('modal-capacidade-estrutura');
  toast(unidades.length
    ? `Estrutura salva — ${unidades.length} ${_capUnidadeLabel(_capEstruturaRow.catKey, unidades.length)}`
    : 'Estrutura removida — a capacidade volta a ser estimada pelos lançamentos');
  _capEstruturaKey = null;
  _capEstruturaRow = null;
}

function adicionarUnidadeEstrutura() { _capAddUnidadeRow(); _capAtualizarTotalEstrutura(); }

function recalcularCapacidades() {
  capInvalidarCache();
  renderCapacidades();
  toast('Capacidades recalculadas a partir dos lançamentos');
}

Object.assign(window, {
  renderCapacidades, loadCapPctInputs, salvarPctSeguranca, capFiltrar,
  capIrParaPagina, capPaginaAnterior, capProximaPagina, capIrParaUltima,
  capEditarCelula, capRestaurarAuto, capToggleSelecionarTodos,
  abrirEdicaoCapacidadesSelecionadas, salvarEdicaoCapacidadesEmMassa,
  restaurarCapacidadesSelecionadas, recalcularCapacidades,
  capInvalidarCache, getCapacidadesRows, getCapacidadeCentralMaterial,
  classificarEstoqueCapacidade, capExplicacaoFaixa, capLimite, CAP_FAIXAS,
  buildCapacidadeSection, irParaCapacidades, capFaixasDaCentral,
  abrirEstruturaCapacidade, salvarEstruturaCapacidade, adicionarUnidadeEstrutura,
  _capAddUnidadeRow, _capRemoverUnidadeRow, _capSituacaoChange, _capAtualizarTotalEstrutura
});
