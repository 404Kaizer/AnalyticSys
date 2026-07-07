function stamp(obj) {
  return { ...obj, createdAt: Date.now() };
}

// ═══════════════════════════════════════════════════════════════════════
// REGISTRO DE NOMES ORIGINAIS DE MATERIAIS (diagnóstico de padronização)
// ═══════════════════════════════════════════════════════════════════════
// Objetivo: capturar TODO nome original de material visto em Entradas,
// Saídas e Lançamentos — os 3 módulos com campo "categoria" próprio
// (CATEGORIA_MODULOS) — ANTES/no momento da conversão via
// normalizarMaterial()/getCategoriaPorGrupo(), para permitir investigar
// depois quais nomes estão passando despercebidos sem categoria, mesmo
// já havendo cadastro em Configurações → Materiais.
//
// Puramente informativo: nunca influencia a padronização em si, nunca
// bloqueia nem atrasa o fluxo principal (falhas de leitura/escrita no
// localStorage são silenciosamente ignoradas).
//
// Guardado em localStorage (não IndexedDB) porque é um índice pequeno
// (1 entrada por NOME DISTINTO de material, não por lançamento/registro),
// então não esbarra no limite de tamanho do localStorage mesmo em bases
// com milhares de notas — e leitura/escrita síncrona é mais simples de
// encaixar nos 3 pontos de captura sem reestruturar o fluxo de persist().
//
// Pontos de captura (ver registrarNomeOriginalMaterial):
//   1. Importação em lote (dashboard.js, processImportBatch)
//   2. Cadastro manual pelos modais (import.js, _criarRegistroEntrada/Saida/Lancamento)
//   3. Reprocessamento ao editar o cadastro de Materiais (reaplicarPadronizacaoMateriais)
const NOMES_ORIGINAIS_KEY = 'central_analise_nomes_originais_v1';
// Proteção contra crescimento descontrolado em bases muito grandes/sujas —
// número de NOMES DISTINTOS guardados, não de ocorrências.
const NOMES_ORIGINAIS_LIMITE = 5000;

let _nomesOriginaisCache = null;
let _nomesOriginaisDirty = false;

function _carregarNomesOriginais() {
  if (_nomesOriginaisCache) return _nomesOriginaisCache;
  try {
    const raw = localStorage.getItem(NOMES_ORIGINAIS_KEY);
    _nomesOriginaisCache = raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.warn('[NomesOriginais] Falha ao carregar registro salvo, reiniciando:', err);
    _nomesOriginaisCache = {};
  }
  return _nomesOriginaisCache;
}

function _persistirNomesOriginais() {
  if (!_nomesOriginaisDirty || !_nomesOriginaisCache) return;
  try {
    localStorage.setItem(NOMES_ORIGINAIS_KEY, JSON.stringify(_nomesOriginaisCache));
    _nomesOriginaisDirty = false;
  } catch (err) {
    // Provável quota do localStorage excedida — não deve interromper
    // importação/cadastro por causa de um índice de diagnóstico.
    console.warn('[NomesOriginais] Falha ao salvar registro (quota do localStorage?):', err);
  }
}

// Flush com debounce — evita serializar o objeto inteiro a cada linha
// durante importações em lote de milhares de registros. `debounce` vem
// de state.js (carregado antes deste arquivo).
const _persistirNomesOriginaisDebounced = (typeof debounce === 'function')
  ? debounce(_persistirNomesOriginais, 400)
  : _persistirNomesOriginais;

// Registra a ocorrência de um nome original de material visto em um dos
// módulos com categoria (entradas/saidas/lancamentos), ANTES/no momento
// da conversão. Agregado por nome distinto (normalizado) — cada chamada
// soma 1 ocorrência e atualiza o resultado mais recente da padronização,
// em vez de gravar uma linha por lançamento.
//   modulo: 'entradas' | 'saidas' | 'lancamentos'
//   nomeOriginal: valor bruto (materialOriginal) como veio do arquivo/formulário
function registrarNomeOriginalMaterial(modulo, nomeOriginal) {
  const raw = String(nomeOriginal ?? '').trim();
  if (!raw) return;

  try {
    const registro = _carregarNomesOriginais();
    const key = normalizeLooseText(raw);

    let entry = registro[key];
    if (!entry) {
      if (Object.keys(registro).length >= NOMES_ORIGINAIS_LIMITE) {
        // Índice cheio — ainda assim tenta persistir o que já foi coletado.
        _persistirNomesOriginaisDebounced();
        return;
      }
      entry = registro[key] = {
        nomeOriginal: raw,
        modulos: {},
        ocorrencias: 0,
        materialCadastrado: false,
        categoriaCadastrada: false,
        categoriaResolvida: '',
        materialPadronizado: '',
        primeiraOcorrencia: '',
        ultimaOcorrencia: ''
      };
    }

    const found = (typeof findMaterialMatch === 'function') ? findMaterialMatch(raw) : null;
    const agora = new Date().toISOString();

    entry.modulos[modulo] = (entry.modulos[modulo] || 0) + 1;
    entry.ocorrencias += 1;
    entry.materialCadastrado = !!found;
    entry.categoriaCadastrada = !!(found && found.categoria);
    entry.categoriaResolvida = (found && found.categoria) || '';
    entry.materialPadronizado = found ? found.alias : raw;
    entry.primeiraOcorrencia = entry.primeiraOcorrencia || agora;
    entry.ultimaOcorrencia = agora;

    _nomesOriginaisDirty = true;
    _persistirNomesOriginaisDebounced();
  } catch (err) {
    // Nunca deixa o registro de diagnóstico quebrar o fluxo principal.
    console.warn('[NomesOriginais] Falha ao registrar nome original:', err);
  }
}

// Helpers de leitura — usados pelo indicador de pendências de padronização
// em Configurações (a implementar em etapa posterior). Já disponíveis aqui
// para não precisar duplicar a leitura da chave depois.
function listarNomesOriginaisMateriais() {
  return Object.values(_carregarNomesOriginais());
}

// "Sem categoria" = material não cadastrado OU cadastrado sem categoria
// preenchida — os dois jeitos de um material passar despercebido.
function listarNomesOriginaisSemCategoria() {
  return listarNomesOriginaisMateriais().filter(e => !e.categoriaCadastrada);
}

function limparNomesOriginaisMateriais() {
  _nomesOriginaisCache = {};
  _nomesOriginaisDirty = true;
  _persistirNomesOriginais();
}

function normalizarCentral(valor) {
  const raw = String(valor ?? '').trim();
  if (!raw) return '';
  const key = normalizeText(raw);
  const index = getFilialLookupIndex();

  const cached = index.cache.get(key);
  if (cached !== undefined) return cached;

  // Primary lookup: by normalised text (covers origem, alias and formatted CNPJ)
  let found = index.exact.get(key);

  // Secondary lookup: if value looks like a CNPJ (≥11 digits), try digits-only key
  if (!found) {
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 11) {
      found = index.exact.get(digits);
    }
  }

  const resolved = found ? found.alias : raw;
  index.cache.set(key, resolved);
  return resolved;
}

function normalizarCentraisRecord(rec, keys) {
  const out = { ...rec };
  keys.forEach(k => {
    if (out[k] !== undefined) {
      const raw = String(out[k] ?? '').trim();
      out[`${k}Original`] = out[`${k}Original`] ?? raw;
      out[k] = normalizarCentral(raw);
    }
  });
  return out;
}

// Campos de central por módulo — usado para reaplicar a padronização de
// centrais (Filiais) sobre os registros já importados, do mesmo jeito que
// reaplicarPadronizacaoMateriais() já faz para materiais.
const CENTRAL_FIELDS_BY_MODULO = {
  entradas: ['centralCompra', 'centralDestino'],
  saidas: ['central'],
  lancamentos: ['central'],
  sap: ['central'],
  producao: ['central']
};

function reaplicarPadronizacaoCentrais(modulos = Object.keys(CENTRAL_FIELDS_BY_MODULO)) {
  const aplicar = (rec, keys) => {
    const out = { ...rec };
    keys.forEach(k => {
      if (out[k] === undefined) return;
      // Usa o valor original salvo (${k}Original) como fonte da reconversão.
      // Registros antigos (gravados antes desta função existir) não têm esse
      // campo — nesses casos, cai no valor atual como fallback (comportamento
      // anterior, sem reversão possível para eles).
      const raw = String(out[`${k}Original`] ?? out[k] ?? '').trim();
      if (!raw) return;
      out[`${k}Original`] = out[`${k}Original`] ?? raw;
      out[k] = normalizarCentral(raw);
    });
    return out;
  };

  for (const modulo of modulos) {
    if (!Array.isArray(state[modulo])) continue;
    const keys = CENTRAL_FIELDS_BY_MODULO[modulo];
    if (!keys) continue;
    state[modulo] = state[modulo].map(rec => aplicar(rec, keys));
  }
}

// ── Categoria de Material — lista fixa usada em todo o sistema ──────────
// Mantida em sincronia com os padrões já reconhecidos por detectCatKey/
// detectCatSubKey (ui.js): AGLOMERANTE, AGREGADO (Graúdo/Miúdo), ADITIVO,
// ADIÇÃO. É a lista oficial exibida/aceita no cadastro de Materiais.
const CATEGORIAS_MATERIAL = ['Aglomerante', 'Agregado Graúdo', 'Agregado Miúdo', 'Aditivo', 'Adição'];

// Reconhece variações de digitação/acentuação/caixa e mapeia para o rótulo
// canônico da lista fixa acima. Retorna '' quando não reconhece — a
// categoria não é inventada, fica em branco para cadastro manual posterior.
function normalizeCategoriaMaterial(valor) {
  const raw = String(valor ?? '').trim();
  if (!raw) return '';
  const c = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
  if (/AGREGA/.test(c)) {
    if (/GRAUD/.test(c)) return 'Agregado Graúdo';
    if (/MIUD/.test(c))  return 'Agregado Miúdo';
    return ''; // "Agregado" sem indicação de Graúdo/Miúdo não é aceito
  }
  if (/AGLOMERANTE/.test(c)) return 'Aglomerante';
  if (/ADITIV/.test(c)) return 'Aditivo';
  if (/ADIC[AÃ]O|ADICAO|ADIC/.test(c)) return 'Adição';
  return '';
}

// Retorna a categoria cadastrada para o material (Padronização de Materiais),
// usando o mesmo índice de match de normalizarMaterial. Só devolve algo se o
// material estiver cadastrado E tiver categoria preenchida — sem heurística.
function getCategoriaPorGrupo(valor) {
  const raw = String(valor ?? '').trim();
  if (!raw) return '';
  const found = findMaterialMatch(raw);
  return (found && found.categoria) ? found.categoria : '';
}

// Módulos cujos registros têm campo "categoria" próprio (digitado ou
// importado) e que devem ser padronizados a partir do cadastro de Materiais.
// SAP não entra aqui: nem o lançamento manual nem a importação em lote do
// SAP possuem esse campo hoje.
const CATEGORIA_MODULOS = ['entradas', 'saidas', 'lancamentos'];

// Migração única: o campo "Descrição" do cadastro de Materiais foi removido
// (era usado informalmente para anotar a categoria, ex.: "ADITIVO",
// "AGLOMERANTE"). Aqui, qualquer material sem categoria cujo desc antigo
// bata com a lista fixa tem a categoria recuperada automaticamente; o campo
// desc é então descartado. Idempotente — roda sem custo se não houver nada
// para migrar.
function migrarCategoriaLegadaMateriais() {
  let mudou = false;
  (state.materiais || []).forEach(m => {
    if (!m.categoria && m.desc) {
      const migrada = normalizeCategoriaMaterial(m.desc);
      if (migrada) { m.categoria = migrada; mudou = true; }
    }
    if (m.desc !== undefined) { delete m.desc; mudou = true; }
  });
  if (mudou) invalidateMaterialLookup();
  return mudou;
}

function normalizeLooseText(v) {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function materialSearchTerms(valor) {
  const raw = String(valor ?? '').trim();
  if (!raw) return [];
  return [...new Set([
    raw,
    ...raw.split('|').map(s => s.trim()).filter(Boolean)
  ])];
}

function tokenPrefixScore(a, b) {
  const aa = a.split(' ').filter(Boolean);
  const bb = b.split(' ').filter(Boolean);
  const len = Math.min(aa.length, bb.length);
  let i = 0;
  while (i < len && aa[i] === bb[i]) i += 1;
  return i;
}

function scoreMaterialMatch(searchValue, item) {
  const terms = materialSearchTerms(searchValue).map(normalizeLooseText).filter(Boolean);
  const targets = [item.origemNorm, item.aliasNorm].filter(Boolean);
  let best = 0;

  for (const term of terms) {
    for (const target of targets) {
      if (!term || !target) continue;

      if (term === target) {
        best = Math.max(best, 1000 + target.length);
        continue;
      }

      const tScore = tokenPrefixScore(term, target);
      const rScore = tokenPrefixScore(target, term);

      if (tScore > 0) {
        best = Math.max(best, 700 + (tScore * 20) + target.length);
      }
      if (rScore > 0) {
        best = Math.max(best, 650 + (rScore * 20) + term.length);
      }

      const paddedTerm = ` ${term} `;
      const paddedTarget = ` ${target} `;
      if (paddedTerm.includes(` ${target} `)) {
        best = Math.max(best, 600 + target.length);
      }
      if (paddedTarget.includes(` ${term} `)) {
        best = Math.max(best, 550 + term.length);
      }
    }
  }

  return best;
}

function makeMaterialIndexItem(item) {
  const origem = String(item?.origem ?? '').trim();
  const alias = String(item?.alias ?? '').trim();
  const origemNorm = normalizeLooseText(origem);
  const aliasNorm = normalizeLooseText(alias);
  return {
    item,
    origemNorm,
    aliasNorm,
    size: Math.max(origemNorm.length, aliasNorm.length)
  };
}

let _materialLookupVersion = 0;
let _materialLookupIndex = null;
let _filialLookupVersion = 0;
let _filialLookupIndex = null;

function invalidateMaterialLookup() {
  _materialLookupVersion += 1;
  _materialLookupIndex = null;
}

function invalidateFilialLookup() {
  _filialLookupVersion += 1;
  _filialLookupIndex = null;
}

function buildMaterialLookupIndex() {
  const list = Array.isArray(state.materiais) ? state.materiais : [];
  // `ordered` continua do MAIOR pro menor — usado pelo scan fuzzy
  // (scoreMaterialMatch), que já favorece naturalmente o texto mais longo
  // em caso de empate de pontuação (ver scoreMaterialMatch).
  const ordered = list
    .map((item, index) => ({ ...makeMaterialIndexItem(item), index }))
    .sort((a, b) => b.size - a.size || a.index - b.index);

  // O mapa de match EXATO é construído numa ordem PRÓPRIA, separada de
  // `ordered`: do MENOR pro maior texto. Como é um Map.set() (quem entra
  // por último sobrescreve), isso garante que o cadastro com o texto MAIOR
  // vence em caso de dois registros mapeando a mesma chave normalizada —
  // o mesmo critério de desempate do match aproximado (scoreMaterialMatch),
  // eliminando a inconsistência entre os dois caminhos.
  const bySizeAsc = [...ordered].sort((a, b) => a.size - b.size || b.index - a.index);
  const exact = new Map();
  for (const entry of bySizeAsc) {
    if (entry.origemNorm) exact.set(entry.origemNorm, entry.item);
    if (entry.aliasNorm) exact.set(entry.aliasNorm, entry.item);
  }

  _materialLookupIndex = {
    version: _materialLookupVersion,
    ordered,
    exact,
    cache: new Map()
  };
  return _materialLookupIndex;
}

function getMaterialLookupIndex() {
  if (!_materialLookupIndex || _materialLookupIndex.version !== _materialLookupVersion) {
    return buildMaterialLookupIndex();
  }
  return _materialLookupIndex;
}

function buildFilialLookupIndex() {
  const list = Array.isArray(state.filiais) ? state.filiais : [];
  const exact = new Map();
  for (const item of list) {
    const origem = normalizeText(item.origem);
    const alias  = normalizeText(item.alias);
    if (origem) exact.set(origem, item);
    if (alias)  exact.set(alias, item);
    // Also index by CNPJ (stripped of formatting) so centralDestino coming
    // as a CNPJ string is resolved to the registered sigla/alias
    if (item.cnpj) {
      const cnpjFull    = normalizeText(item.cnpj);                          // e.g. "00 000 000 0000 00"
      const cnpjDigits  = item.cnpj.replace(/\D/g, '');                      // "00000000000000"
      if (cnpjFull)   exact.set(cnpjFull,   item);
      if (cnpjDigits) exact.set(cnpjDigits, item);
    }
  }

  _filialLookupIndex = {
    version: _filialLookupVersion,
    exact,
    cache: new Map()
  };
  return _filialLookupIndex;
}

function getFilialLookupIndex() {
  if (!_filialLookupIndex || _filialLookupIndex.version !== _filialLookupVersion) {
    return buildFilialLookupIndex();
  }
  return _filialLookupIndex;
}

// Flag global: durante importações em batch, findMaterialMatch usa apenas
// lookup exato (sem fuzzy scan), evitando Maximum call stack size exceeded.
let _batchImportMode = false;

function findMaterialMatch(valor) {
  const raw = String(valor ?? '').trim();
  if (!raw) return null;

  const index = getMaterialLookupIndex();
  const key = normalizeLooseText(raw);

  const cached = index.cache.get(key);
  if (cached) return cached;

  const exact = index.exact.get(key);
  if (exact) {
    index.cache.set(key, exact);
    return exact;
  }

  // Durante importação em batch, não fazer fuzzy scan para evitar stack overflow.
  if (_batchImportMode) return null;

  let bestItem = null;
  let bestScore = 0;
  for (const entry of index.ordered) {
    const score = scoreMaterialMatch(raw, entry);
    if (score > bestScore) {
      bestScore = score;
      bestItem = entry.item;
    }
  }

  if (bestItem) index.cache.set(key, bestItem);
  return bestItem;
}

function normalizarMaterial(valor) {
  const raw = String(valor ?? '').trim();
  if (!raw) return '';
  const found = findMaterialMatch(raw);
  return found ? found.alias : raw;
}

function normalizarMateriaisRecord(rec, keys) {
  const out = { ...rec };
  keys.forEach(k => {
    if (out[k] !== undefined) {
      const raw = String(out[k] ?? '').trim();
      out[`${k}Original`] = out[`${k}Original`] ?? raw;
      out[k] = normalizarMaterial(raw);
    }
  });
  return out;
}

function reaplicarPadronizacaoMateriais(modulos = ['entradas', 'saidas', 'lancamentos', 'sap']) {
  const categoriaModulos = new Set(CATEGORIA_MODULOS);

  const aplicar = (rec, comCategoria, modulo) => {
    const raw = String(rec.materialOriginal ?? rec.material ?? '').trim();
    const out = raw
      ? { ...rec, materialOriginal: rec.materialOriginal ?? raw, material: normalizarMaterial(raw) }
      : { ...rec, materialOriginal: rec.materialOriginal ?? '', material: rec.material ?? '' };

    if (comCategoria) {
      // Captura diagnóstica (ponto 3): reprocessamento é o momento em que
      // uma edição no cadastro de Materiais deveria "resolver" a categoria
      // de registros já importados — se continuar sem categoria aqui, é
      // sinal de que o nome ainda não bate com nenhum cadastro.
      if (raw) registrarNomeOriginalMaterial(modulo, raw);

      // categoriaOriginal preserva o valor digitado/importado originalmente,
      // do mesmo jeito que materialOriginal preserva o nome bruto do material.
      const catOriginal = String(
        rec.categoriaOriginal ?? (rec.categoria && rec.categoria !== '—' ? rec.categoria : '')
      ).trim();
      const catPadrao = getCategoriaPorGrupo(raw || out.material);
      out.categoriaOriginal = catOriginal;
      out.categoria = catPadrao || catOriginal || '—';
    }

    return out;
  };

  for (const modulo of modulos) {
    if (!Array.isArray(state[modulo])) continue;
    const comCategoria = categoriaModulos.has(modulo);
    state[modulo] = state[modulo].map(rec => aplicar(rec, comCategoria, modulo));
  }
}

// ═══════════════════════════════════════════════════════════════════════
// PENDÊNCIAS DE PADRONIZAÇÃO (Configurações → indicador acima das tabelas)
// ═══════════════════════════════════════════════════════════════════════
// Varre Entradas/Saídas/Lançamentos/SAP/Produção em busca de nomes ORIGINAIS
// de material/central que precisam de atenção no cadastro. Consulta pura
// (nunca muta o state) — mesma regra que o Assistente já usava em
// _asstIntentConfigPendente, centralizada aqui para ter UMA fonte de
// verdade usada tanto pelo indicador visual (dashboard.js) quanto pelo
// Assistente (chat).
//
// Um MATERIAL entra na lista por 2 motivos distintos:
//   'nao_cadastrado' — o nome não bate com nenhum item do cadastro
//                       (findMaterialMatch não encontra nada)
//   'sem_categoria'  — o nome BATE com um item do cadastro (já teria um
//                       alias padronizado), mas esse item está sem a
//                       categoria preenchida — é o caso "cadastrado mas
//                       passando despercebido" que motivou o registro de
//                       nomes originais.
// Uma CENTRAL só tem o motivo 'nao_cadastrado' — Filiais não têm campo de
// categoria.
function getPendenciasPadronizacao() {
  const materiaisPendentes = new Map();
  const centraisPendentes  = new Map();

  if (typeof findMaterialMatch === 'function') {
    ['entradas', 'saidas', 'lancamentos', 'sap'].forEach(mod => {
      (state[mod] || []).forEach(r => {
        const rawMat = String(r.materialOriginal ?? '').trim();
        if (!rawMat) return;

        const found = findMaterialMatch(rawMat);
        let motivo = null;
        if (!found) motivo = 'nao_cadastrado';
        else if (!found.categoria) motivo = 'sem_categoria';
        if (!motivo) return; // cadastrado e com categoria — nada pendente

        let entry = materiaisPendentes.get(rawMat);
        if (!entry) {
          entry = {
            nome: rawMat,
            count: 0,
            motivo,
            // Só relevante para 'sem_categoria': aponta para o registro do
            // cadastro que precisa ser completado (origem+alias exatos,
            // usados depois para editar em vez de duplicar o cadastro).
            origemCadastro: found ? found.origem : '',
            aliasPadronizado: found ? found.alias : ''
          };
          materiaisPendentes.set(rawMat, entry);
        }
        entry.count += 1;
      });
    });
  }

  if (typeof getFilialLookupIndex === 'function' && typeof CENTRAL_FIELDS_BY_MODULO !== 'undefined') {
    const filIdx = getFilialLookupIndex();
    Object.entries(CENTRAL_FIELDS_BY_MODULO).forEach(([mod, fields]) => {
      (state[mod] || []).forEach(r => {
        fields.forEach(f => {
          const rawCentral = String(r[`${f}Original`] ?? '').trim();
          if (!rawCentral) return;
          const found = filIdx.exact.get(normalizeText(rawCentral));
          if (found) return; // central já cadastrada — nada pendente

          let entry = centraisPendentes.get(rawCentral);
          if (!entry) {
            entry = { nome: rawCentral, count: 0, motivo: 'nao_cadastrado' };
            centraisPendentes.set(rawCentral, entry);
          }
          entry.count += 1;
        });
      });
    });
  }

  const toSortedList = map => [...map.values()]
    .sort((a, b) => b.count - a.count || a.nome.localeCompare(b.nome, 'pt-BR'));

  return {
    materiais: toSortedList(materiaisPendentes),
    centrais:  toSortedList(centraisPendentes)
  };
}

// ═══════════════════════════════════════════════════════════════════════
// CADASTROS DUPLICADOS/CONFLITANTES (Configurações → Padronização de Materiais)
// ═══════════════════════════════════════════════════════════════════════
// Detecta registros do cadastro de Materiais com a mesma ORIGEM normalizada
// apontando para ALIASES diferentes — ex.: dois registros com origem="XYPEX",
// um com alias="CRISTALIZANTE/IMPERMIABILIZANTE" e outro com alias
// "CRISTALIZANTE/IMPERMIABILIZANTE - XYPEX". Nenhum dos dois é tecnicamente
// inválido (materialMatchKey usa origem+alias combinados, então os dois são
// salvos como registros distintos), mas na prática apenas um deles "vence"
// no índice de busca (buildMaterialLookupIndex) — o outro fica morto,
// nunca aplicado a nenhum lançamento/entrada/saída/SAP, sem nenhum aviso.
//
// Escopo deliberadamente restrito: só o caso "mesma origem, aliases
// diferentes". O caso inverso (mesmo alias final vindo de origens
// diferentes) é comum e intencional — vários nomes brutos convergindo para
// um único material padronizado é o comportamento normal do sistema, não
// um conflito.
//
// Consulta pura (nunca muta o state), no mesmo espírito de
// getPendenciasPadronizacao().
function getDuplicatasCadastroMateriais() {
  const porOrigem = new Map(); // origemNorm -> [{ item, aliasNorm }]

  (state.materiais || []).forEach(item => {
    const origem = String(item?.origem ?? '').trim();
    const alias  = String(item?.alias ?? '').trim();
    if (!origem || !alias) return;

    const origemNorm = normalizeLooseText(origem);
    if (!origemNorm) return;

    if (!porOrigem.has(origemNorm)) porOrigem.set(origemNorm, []);
    porOrigem.get(origemNorm).push({ item, alias, aliasNorm: normalizeLooseText(alias) });
  });

  const conflitos = [];
  for (const [origemNorm, registros] of porOrigem.entries()) {
    // Só é conflito se houver ALIASES distintos para a mesma origem —
    // registros idênticos (mesma origem, mesmo alias, ids diferentes por
    // algum motivo) não entram aqui.
    const aliasesDistintos = new Set(registros.map(r => r.aliasNorm));
    if (aliasesDistintos.size < 2) continue;

    // Reaproveita o mesmo índice/critério de desempate usado em produção
    // (buildMaterialLookupIndex) para apontar qual registro está "vencendo"
    // hoje e qual está órfão — informação central para o usuário decidir
    // o que fazer, sem precisar reproduzir a lógica manualmente.
    const vencedorAtual = (typeof findMaterialMatch === 'function')
      ? findMaterialMatch(registros[0].item.origem)
      : null;

    conflitos.push({
      origem: registros[0].item.origem, // texto de exibição (não normalizado)
      registros: registros.map(r => ({
        id: r.item.id,
        origem: r.item.origem,
        alias: r.alias,
        categoria: r.item.categoria || '',
        vencendo: !!(vencedorAtual && vencedorAtual.id === r.item.id)
      }))
    });
  }

  return conflitos.sort((a, b) => a.origem.localeCompare(b.origem, 'pt-BR'));
}
