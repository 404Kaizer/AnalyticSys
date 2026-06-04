// ═══════════════════════════════════════════════════════════
// ÍNDICE DE BUSCA INVERTIDO — evita scan linear em 1M+ registros
// ═══════════════════════════════════════════════════════════
// Estratégia: para cada módulo, mantemos um Array de strings de busca
// pré-computadas (uma por registro). A busca percorre apenas esse array
// de strings simples em vez de acessar cada campo de cada objeto.
// O índice é invalidado (= null) sempre que os dados do módulo mudam,
// e reconstruído de forma lazy na próxima chamada de filterRecords.

const _searchIndex = {
  // { scope: { version: number, index: string[] } }
  // version é o comprimento do array no momento da construção;
  // qualquer push/clear invalida pelo tamanho diferente.
};

// Retorna o índice para o scope, construindo-o se necessário.
function _getOrBuildIndex(scope, records, fields) {
  const cached = _searchIndex[scope];
  if (cached && cached.version === records.length) return cached.index;

  // Reconstrói — concatena os campos buscáveis de cada registro em uma
  // única string lowercase separada por \x00 (nunca aparece nos dados).
  const index = new Array(records.length);
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    let s = '';
    for (let j = 0; j < fields.length; j++) {
      const v = r[fields[j]];
      if (v != null && v !== '') s += String(v).toLowerCase() + '\x00';
    }
    index[i] = s;
  }
  _searchIndex[scope] = { version: records.length, index };
  return index;
}

// Invalida o índice de um módulo (chame após importar ou remover registros).
function invalidateSearchIndex(scope) {
  delete _searchIndex[scope];
}

// Invalida todos os índices de uma vez (ex: ao limpar tudo).
function invalidateAllSearchIndexes() {
  for (const k of Object.keys(_searchIndex)) delete _searchIndex[k];
}

function recordMatchesSearch(record, query, fields) {
  const tokens = tokenizeSearch(query);
  if (!tokens.length) return true;

  return tokens.every(token => {
    const pair = token.match(/^([^:=\s]+)\s*[:=]\s*(.+)$/);
    if (pair) {
      const field = pair[1];
      const value = pair[2].trim().toLowerCase();
      const candidates = getFieldCandidates(field);
      return candidates.some(candidate => String(record?.[candidate] ?? '').toLowerCase().includes(value));
    }

    const needle = token.toLowerCase();
    return fields.some(field => String(record?.[field] ?? '').toLowerCase().includes(needle));
  });
}

// filterRecords — versão com índice invertido para buscas simples (sem field:value)
// e fallback para a lógica completa quando há tokens field:value ou múltiplos tokens.
function filterRecords(records, query, fields, scope) {
  const q = String(query ?? '').trim();
  if (!q) return records;

  const tokens = tokenizeSearch(q);
  if (!tokens.length) return records;

  // Verifica se há algum token com sintaxe field:value (requer acesso ao objeto)
  const hasFieldToken = tokens.some(t => /^[^:=\s]+\s*[:=]\s*.+$/.test(t));

  if (!hasFieldToken && scope) {
    // Caminho rápido: usa o índice invertido — só strings, sem acessar objetos
    const index = _getOrBuildIndex(scope, records, fields);
    const needles = tokens.map(t => t.toLowerCase());
    const result = [];
    for (let i = 0; i < index.length; i++) {
      const s = index[i];
      let ok = true;
      for (let j = 0; j < needles.length; j++) {
        if (!s.includes(needles[j])) { ok = false; break; }
      }
      if (ok) result.push(records[i]);
    }
    return result;
  }

  // Caminho completo: suporta field:value e lógica de aliases
  return records.filter(rec => recordMatchesSearch(rec, q, fields));
}

// ═══════════════════════════════════════════════════════════
// DEBOUNCE DOS INPUTS DE FILTRO — evita re-render a cada tecla
// ═══════════════════════════════════════════════════════════
// Mapa de timers por módulo para debounce individual.
const _filterDebounceTimers = {};
const FILTER_DEBOUNCE_MS = 180; // ms de espera após o último keystroke

function debouncedFilter(module, value, renderFn) {
  clearTimeout(_filterDebounceTimers[module]);
  _filterDebounceTimers[module] = setTimeout(() => renderFn(value), FILTER_DEBOUNCE_MS);
}
