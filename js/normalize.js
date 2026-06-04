function stamp(obj) {
  return { ...obj, createdAt: Date.now() };
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
    if (out[k] !== undefined) out[k] = normalizarCentral(out[k]);
  });
  return out;
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
  const ordered = list
    .map((item, index) => ({ ...makeMaterialIndexItem(item), index }))
    .sort((a, b) => b.size - a.size || a.index - b.index);

  const exact = new Map();
  for (const entry of ordered) {
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
  const aplicar = rec => {
    const raw = String(rec.materialOriginal ?? rec.material ?? '').trim();
    if (!raw) return { ...rec, materialOriginal: rec.materialOriginal ?? '', material: rec.material ?? '' };
    const material = normalizarMaterial(raw);
    return {
      ...rec,
      materialOriginal: rec.materialOriginal ?? raw,
      material
    };
  };

  for (const modulo of modulos) {
    if (!Array.isArray(state[modulo])) continue;
    state[modulo] = state[modulo].map(aplicar);
  }
}
