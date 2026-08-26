'use strict';

// ═══════════════════════════════════════════════════════════
// MACRO: Donut charts + rankings + filtros regional/categoria
// ═══════════════════════════════════════════════════════════

const _levelColor = { critico: '#f43f5e', urgente: '#f97316', atencao: '#f59e0b', bom: '#10b981' };
const _levelLabel = { critico: 'CRÍTICO', urgente: 'URGENTE', atencao: 'ATENÇÃO', bom: 'BOM' };
const _levelSev   = { critico: 3, urgente: 2, atencao: 1, bom: 0 };
const _levelFromScore = (s) => s >= 80 ? 'bom' : s >= 55 ? 'atencao' : s >= 30 ? 'urgente' : 'critico';

// Estado global para re-renderização ao filtrar
let _macroState = null;

// ── Tendência ─────────────────────────────────────────────────────────
function _calcTrend(lancs, sap, dtIni, dtFim, prevValue) {
  if (!dtIni || !dtFim) return 'stable';
  const mid = new Date((dtIni.getTime() + dtFim.getTime()) / 2);
  const split = (arr, from, to) =>
    arr.filter(r => { const d = parseDate(r.dtLanc); return d && d >= from && d <= to; });
  const lancsA = split(lancs, dtIni, mid), sapA = split(sap, dtIni, mid);
  const lancsB = split(lancs, mid, dtFim), sapB = split(sap, mid, dtFim);
  if (!lancsA.length && !sapA.length) return 'stable';
  if (!lancsB.length && !sapB.length) return 'stable';
  const snapA = buildSnapshot({ lancs: lancsA, sap: sapA, initialStockOverride: prevValue ?? null });
  const diffB = buildSnapshot({ lancs: lancsB, sap: sapB, initialStockOverride: snapA.pesoFim ?? null }).diff;
  const absA = Math.abs(snapA.diff), absB = Math.abs(diffB);
  const delta = absA > 0.001 ? (absB - absA) / absA : 0;
  if (delta >  0.10) return 'worsening';
  if (delta < -0.10) return 'improving';
  return 'stable';
}

function _trendIcon(trend) {
  if (trend === 'worsening') return `<span title="Piorando" style="color:#f43f5e;font-size:11px;margin-left:4px">▲</span>`;
  if (trend === 'improving') return `<span title="Melhorando" style="color:#10b981;font-size:11px;margin-left:4px">▼</span>`;
  return `<span title="Estável" style="color:var(--text3);font-size:10px;margin-left:4px">→</span>`;
}

// ─────────────────────────────────────────────────────────────────────
function renderMacroPanels(results, thresholds, dtIni, dtFim) {
  if (!results || !results.length) return;

  const byLevel    = { critico: [], urgente: [], atencao: [], bom: [] };
  const centralMap = {};   // central → { level, counts, worstDiff, regional }
  const matItems   = [];   // { central, mat, level, totalDiff, catKey, regional }

  results.forEach(r => {
    const lancsByMat = new Map();
    const sapByMat   = new Map();
    (r.lancsNoPeriodo || []).forEach(l => {
      const m = l.material || '—';
      if (!lancsByMat.has(m)) lancsByMat.set(m, []);
      lancsByMat.get(m).push(l);
    });
    (r.sapNoPeriodo || []).forEach(s => {
      const m = s.material || '—';
      if (!sapByMat.has(m)) sapByMat.set(m, []);
      sapByMat.get(m).push(s);
    });

    // ── Injeção de pendentes considerados ────────────────────────────────
    // Replica a mesma lógica de buildCentralCard (analitico.js) para que os
    // relatórios e rankings (window._rankByLevel) reflitam o estado de
    // "Considerar NFs/OS pendentes" do analista, e não fiquem presos aos
    // dados originais do SAP.
    const _pendStateCentral = (window._pendConsiderados || {})[r.central] || {};
    const _pendCacheCentral = (window._pendCache        || {})[r.central] || {};
    if (_pendStateCentral.nf && _pendCacheCentral.pendNF) {
      (_pendCacheCentral.pendNF || []).forEach(e => {
        const m = e.material || '—';
        if (!sapByMat.has(m)) sapByMat.set(m, []);
        sapByMat.get(m).push({
          movimento: '101',
          peso:      _convertNfPesoToKg(e.peso, e.um, e.material),
          ref:       String(e.nf || ''),
          documento: '',
          material:  m,
          dtLanc:    e.dtDescarga || e.dtEmissao || '',
          _sintetico: true
        });
      });
    }
    if (_pendStateCentral.os && _pendCacheCentral.pendOS) {
      (_pendCacheCentral.pendOS || []).forEach(e => {
        const m = e.material || '—';
        if (!sapByMat.has(m)) sapByMat.set(m, []);
        sapByMat.get(m).push({
          movimento: '201',
          peso:      -Math.abs(num(e.peso)),
          ref:       String(e.os || ''),
          documento: '',
          material:  m,
          dtLanc:    e.dtEmissao || '',
          _sintetico: true
        });
      });
    }

    const card     = document.querySelector(`.micro-filial-card[data-central="${CSS.escape(r.central)}"]`);
    const regional = card?.dataset.regional || '—';
    const _mapCardLevel = l => (!l || l === 'none' || l === 'ok') ? 'bom' : l;
    const cardLevel = _mapCardLevel(card?.dataset.healthLevel);

    centralMap[r.central] = {
      level: cardLevel, regional,
      counts: { critico:0, urgente:0, atencao:0, bom:0 },
      worstDiff: 0
    };

    // Est. Inicial: saldo TEÓRICO do SAP (âncora Custos SAP + movimentações),
    // mesma fonte da Visão Micro — ver _anGetSapTheoreticalStock em
    // analitico.js. Antes vinha do lançamento do operador, o que fazia a
    // Macro/Regional mostrar variação diferente da Micro pro mesmo material.
    //
    // Sumiu o cache local (preCache) porque _anGetSapStock já cacheia, e o
    // cache dele é limpo a cada _rodarAnaliticoCore — como a Macro roda
    // depois da Micro na mesma análise, aqui ele chega quente.
    //
    // Sumiu também o catKey que era calculado só pra esta chamada: ele
    // existia pela regra de Agregado do getPrePeriodLaunchStock (lançamento
    // semanal), e o saldo do SAP existe em qualquer data. O catKey da
    // classificação, logo abaixo, é outro e continua como estava.
    (r.allMats || []).forEach(mat => {
      const lancs = lancsByMat.get(mat) || [];
      const sap   = sapByMat.get(mat)   || [];
      const prev  = (typeof _anGetSapStock === 'function')
        ? _anGetSapStock({ central: r.central, material: mat, dtIni }) : null;
      const snap  = buildSnapshot({
        lancs, sap,
        initialStockOverride:     prev?.value  ?? null,
        initialDateLabelOverride: prev?.dtLabel ?? null,
      });
      const diff   = snap.diff;
      const rawCat = (lancs[0]?.categoria || sap[0]?.categoria || '').trim().toUpperCase();
      const catKey = detectCatKey(rawCat) || detectCatFromMat(mat);
      const level  = classifyVariation(Math.abs(diff), catKey, thresholds);

      centralMap[r.central].counts[level]++;
      if (Math.abs(diff) > centralMap[r.central].worstDiff)
        centralMap[r.central].worstDiff = Math.abs(diff);

      const custoMed = (r.custoMedioPorMat || {})[mat] || 0;
      const custo    = Math.abs(diff * custoMed);
      const trend    = _calcTrend(lancs, sap, dtIni, dtFim, prev?.value);  // calculado para todos os níveis, incluindo 'bom'

      matItems.push({ central: r.central, mat, level, totalDiff: diff, catKey, regional, custo, trend });

      // 'bom' também entra em byLevel — os relatórios de Central/Regional
      // permitem selecionar quais níveis exibir, inclusive o bom.
      const item     = { central: r.central, regional, mat, diff, custo, level, trend, categoria: rawCat, catKey, catSubKey: detectCatSubKey(rawCat, mat) };
      if (level === 'critico')      byLevel.critico.push(item);
      else if (level === 'urgente') byLevel.urgente.push(item);
      else if (level === 'atencao') byLevel.atencao.push(item);
      else                          byLevel.bom.push(item);
    });
  });

  const sortByCusto = arr => arr.sort((a, b) => Math.abs(b.custo) - Math.abs(a.custo));
  sortByCusto(byLevel.critico);
  sortByCusto(byLevel.urgente);
  sortByCusto(byLevel.atencao);
  sortByCusto(byLevel.bom);
  window._rankByLevel = byLevel;

  _renderCrankPanel('critico', byLevel.critico);
  _renderCrankPanel('urgente', byLevel.urgente);
  _renderCrankPanel('atencao', byLevel.atencao);
  if (typeof initHelpBadges === 'function') initHelpBadges();

  // Guarda estado para re-render ao filtrar
  _macroState = { centralMap, matItems, _dtIni: dtIni, _dtFim: dtFim };

  // Popula opções dos filtros
  _populateFilters(centralMap, matItems);

  // Renderiza com filtros vazios (mostra tudo)
  macroApplyFilter();
}

// ── Popula filtros ────────────────────────────────────────────────────
function _populateFilters(centralMap, matItems) {
  const selReg = document.getElementById('macro-filter-regional');
  const selCat = document.getElementById('macro-filter-categoria');
  if (!selReg || !selCat) return;

  const regionals = [...new Set(Object.values(centralMap).map(v => v.regional).filter(v => v && v !== '—'))].sort();
  const catMap = { aglomerante: 'Aglomerante', agregado: 'Agregado', aditivo: 'Aditivo', adicao: 'Adição' };
  const cats   = [...new Set(matItems.map(i => i.catKey).filter(Boolean))].sort();

  const curReg = selReg.value;
  const curCat = selCat.value;

  selReg.innerHTML = '<option value="">Todas as regionais</option>' +
    regionals.map(r => `<option value="${escapeHtml(r)}"${r === curReg ? ' selected' : ''}>${escapeHtml(r)}</option>`).join('');
  selCat.innerHTML = '<option value="">Todas as categorias</option>' +
    cats.map(c => `<option value="${escapeHtml(c)}"${c === curCat ? ' selected' : ''}>${escapeHtml(catMap[c] || c)}</option>`).join('');
}

// ── Aplica filtros e re-renderiza donuts ──────────────────────────────
function macroApplyFilter() {
  if (!_macroState) return;
  const { centralMap, matItems } = _macroState;

  const selReg = document.getElementById('macro-filter-regional')?.value || '';
  const selCat = document.getElementById('macro-filter-categoria')?.value || '';

  // ── Centrais ─────────────────────────────────────────────────────────
  const filteredCentrals = Object.entries(centralMap)
    .filter(([, v]) => !selReg || v.regional === selReg);

  const centralCounts = { bom: 0, atencao: 0, urgente: 0, critico: 0 };
  filteredCentrals.forEach(([, v]) => centralCounts[v.level]++);

  // Agrega diff/custo/trend por nível da CENTRAL.
  // Usa apenas materiais não-bom para que o total bata com o gráfico de materiais
  // (materiais bons numa central urgente não representam custo problemático).
  const centralAgg = { critico:{diff:0,custo:0,trends:[]}, urgente:{diff:0,custo:0,trends:[]}, atencao:{diff:0,custo:0,trends:[]}, bom:{diff:0,custo:0,trends:[]} };
  const matItemsForRegion = matItems.filter(i => !selReg || i.regional === selReg);
  matItemsForRegion.forEach(i => {
    // Agrupa pelo nível do MATERIAL (não da central) — assim ambos os totais são comparáveis
    const lvl = i.level || 'bom';
    if (!centralAgg[lvl]) return;
    centralAgg[lvl].diff  += i.totalDiff;
    centralAgg[lvl].custo += i.custo || 0;
    if (i.trend && i.trend !== 'stable') centralAgg[lvl].trends.push(i.trend);
  });
  const _cTrend = (lvl) => {
    const t = centralAgg[lvl]?.trends || [];
    const w = t.filter(x => x==='worsening').length, im = t.filter(x => x==='improving').length;
    return w > im ? 'worsening' : im > w ? 'improving' : t.length ? 'stable' : null;
  };

  // Variação líquida por central = soma assinada do diff de todos os materiais
  // (preserva o sinal para que o ranking mostre corretamente desfalque vs. sobra)
  const centralNetDiff = {};
  matItemsForRegion.forEach(i => {
    centralNetDiff[i.central] = (centralNetDiff[i.central] || 0) + i.totalDiff;
  });

  const top5centrais = filteredCentrals
    .filter(([, v]) => v.level !== 'bom')
    .sort((a, b) => {
      const cA = a[1].counts, cB = b[1].counts;
      if (cB.critico !== cA.critico) return cB.critico - cA.critico;
      if (cB.urgente !== cA.urgente) return cB.urgente - cA.urgente;
      if (cB.atencao !== cA.atencao) return cB.atencao - cA.atencao;
      return Math.abs(centralNetDiff[b[0]] || 0) - Math.abs(centralNetDiff[a[0]] || 0);
    })
    .slice(0, 5)
    .map(([name, v]) => ({ name, level: v.level, counts: v.counts, diff: centralNetDiff[name] || 0 }));

  // Monta levelMeta para o tooltip das fatias de centrais
  const centralLevelMeta = {};
  ['critico','urgente','atencao','bom'].forEach(lvl => {
    centralLevelMeta[lvl] = {
      diff:  centralAgg[lvl].diff,
      custo: centralAgg[lvl].custo,
      trend: _cTrend(lvl),
    };
  });

  // ── Materiais ─────────────────────────────────────────────────────────
  const filteredMats = matItems.filter(i => !selCat || i.catKey === selCat);

  const matCounts = { bom: 0, atencao: 0, urgente: 0, critico: 0 };
  filteredMats.forEach(({ level }) => matCounts[level]++);

  // Agrega diff/custo/trend de TODOS os itens de cada nível
  const matAgg = { critico:{diff:0,custo:0,trends:[]}, urgente:{diff:0,custo:0,trends:[]}, atencao:{diff:0,custo:0,trends:[]}, bom:{diff:0,custo:0,trends:[]} };
  filteredMats.forEach(i => {
    if (!matAgg[i.level]) return;
    matAgg[i.level].diff  += i.totalDiff;
    matAgg[i.level].custo += i.custo || 0;
    if (i.trend && i.trend !== 'stable') matAgg[i.level].trends.push(i.trend);
  });
  const _mTrend = (lvl) => {
    const t = matAgg[lvl]?.trends || [];
    const w = t.filter(x => x==='worsening').length, im = t.filter(x => x==='improving').length;
    return w > im ? 'worsening' : im > w ? 'improving' : t.length ? 'stable' : null;
  };

  const matLevelMeta = {};
  ['critico','urgente','atencao','bom'].forEach(lvl => {
    matLevelMeta[lvl] = {
      diff:  matAgg[lvl].diff,
      custo: matAgg[lvl].custo,
      trend: _mTrend(lvl),
    };
  });

  // ── Top 5 materiais: agrega por nome do material (TODAS as centrais, todos os níveis) ──
  // Inclui pares 'bom' na soma para que totalDiff e contagem de centrais sejam corretos.
  // O filtro de "pior nível !== bom" é aplicado DEPOIS da agregação completa.
  const matByName = new Map();
  filteredMats.forEach(v => {
    if (!matByName.has(v.mat)) {
      matByName.set(v.mat, {
        mat: v.mat, totalDiff: 0, custo: 0,
        centrais: new Set(), levels: [], trends: []
      });
    }
    const agg = matByName.get(v.mat);
    agg.totalDiff += (v.totalDiff || 0);
    agg.custo     += (v.custo    || 0);
    agg.centrais.add(v.central);
    agg.levels.push(v.level);
    agg.trends.push(v.trend || 'stable');
  });

  const _worstLevel = levels => {
    const ord = { critico: 3, urgente: 2, atencao: 1, bom: 0 };
    return levels.reduce((w, l) => (ord[l] ?? 0) > (ord[w] ?? 0) ? l : w, 'bom');
  };
  const _aggTrend = trends => {
    const w = trends.filter(t => t === 'worsening').length;
    const i = trends.filter(t => t === 'improving').length;
    return w > i ? 'worsening' : i > w ? 'improving' : 'stable';
  };

  const top5mats = [...matByName.values()]
    .filter(v => _worstLevel(v.levels) !== 'bom') // só exibe materiais com pelo menos 1 central não-bom
    .sort((a, b) => {
      const la = _worstLevel(a.levels), lb = _worstLevel(b.levels);
      const sd = _levelSev[lb] - _levelSev[la];
      return sd !== 0 ? sd : Math.abs(b.totalDiff) - Math.abs(a.totalDiff);
    })
    .slice(0, 5)
    .map(v => {
      const nCentrais = v.centrais.size;
      return {
        name:  v.mat,
        sub:   nCentrais === 1 ? [...v.centrais][0] : `${nCentrais} centrais`,
        level: _worstLevel(v.levels),
        diff:  v.totalDiff,
        custo: v.custo,
        trend: _aggTrend(v.trends)
      };
    });

  // ── Score de saúde agregado ──────────────────────────────────────────
  // Usa HEALTH_PENALTIES para ponderar: mesmo cálculo do calcHealthScore
  // mas aplicado aos counts por nível já calculados acima
  const _scoreFromCounts = (counts) => {
    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    if (!total) return 100;
    // Score geral da empresa: quanto do total está saudável,
    // penalizando proporcionalmente pela gravidade de cada nível.
    // Pesos por item sobre o total (não sobre os não-bons):
    //   bom      → penalidade 0    (contribui 100% para a saúde)
    //   atencao  → penalidade 0.2  (leve)
    //   urgente  → penalidade 0.5  (moderado)
    //   critico  → penalidade 1.0  (total)
    const penalty =
      (counts.atencao||0) * 0.2 +
      (counts.urgente||0) * 0.5 +
      (counts.critico||0) * 1.0;
    return Math.max(0, Math.round((1 - penalty / total) * 100));
  };

  const centralScore = _scoreFromCounts(centralCounts);
  const matScore     = _scoreFromCounts(matCounts);
  const nCentrals    = Object.values(centralCounts).reduce((s, n) => s + n, 0);
  const nMats        = Object.values(matCounts).reduce((s, n) => s + n, 0);

  // Build per-level item lists (only when a filter is active — for tooltip display)
  const centralItemsByLevel = {};
  if (selReg) {
    filteredCentrals.forEach(([name, v]) => {
      if (!centralItemsByLevel[v.level]) centralItemsByLevel[v.level] = [];
      centralItemsByLevel[v.level].push(name);
    });
  }
  const matItemsByLevel = {};
  if (selCat || selReg) {
    filteredMats.forEach(({ mat, central, level }) => {
      if (!matItemsByLevel[level]) matItemsByLevel[level] = [];
      matItemsByLevel[level].push(`${mat} (${central})`);
    });
  }

  _renderDonut('centrais', centralCounts, top5centrais, centralLevelMeta, centralScore, nCentrals, centralItemsByLevel);
  _renderDonut('mats',     matCounts,     top5mats,     matLevelMeta,     matScore,     nMats,     matItemsByLevel);

  // Expõe os scores para o sistema de notificações
  window._macroHealthScores = { centralScore, matScore };
  if (typeof notifUpdateFromAnalytico === 'function') {
    notifUpdateFromAnalytico(centralScore, matScore, _macroState._dtIni, _macroState._dtFim);
  }
}
window.macroApplyFilter = macroApplyFilter;

// ── Tooltip singleton ─────────────────────────────────────────────────
// Tooltip singleton — shared with help-badges.js via same element id
let _macroTip = null;
function _getTip() {
  if (_macroTip) return _macroTip;
  _macroTip = document.getElementById('macro-donut-tip');
  if (!_macroTip) {
    _macroTip = document.createElement('div');
    _macroTip.id = 'macro-donut-tip';
    _macroTip.style.cssText = [
      'position:fixed','z-index:9999','pointer-events:none','display:none',
      'background:var(--bg2)','border:1px solid var(--border3)',
      'border-radius:10px','padding:12px 15px','min-width:200px','max-width:260px',
      'box-shadow:0 8px 32px rgba(0,0,0,.5)',
      'font-family:var(--font)','font-size:12px',
    ].join(';');
    document.body.appendChild(_macroTip);
  }
  return _macroTip;
}

function _posTip(t, cx, cy) {
  const PAD = 10;
  const W = window.innerWidth, H = window.innerHeight;
  const rect = t.getBoundingClientRect();
  const tw = rect.width  || t.offsetWidth  || 260;
  const th = rect.height || t.offsetHeight || 160;
  let lx = cx + 14, ly = cy + 14;
  if (lx + tw + PAD > W) lx = cx - tw - 10;
  if (ly + th + PAD > H) ly = cy - th - 10;
  lx = Math.max(PAD, Math.min(lx, W - tw - PAD));
  ly = Math.max(PAD, Math.min(ly, H - th - PAD));
  t.style.left = lx + 'px';
  t.style.top  = ly + 'px';
}

function _hideTip() {
  const t = _getTip();
  t.style.display = 'none';
}
function _moveTip(e) {
  const t = _getTip();
  if (t.style.display === 'none') return;
  _posTip(t, e.clientX, e.clientY);
}
function _showTip(e, html, col) {
  const t = _getTip();
  t.innerHTML = html;
  t.style.borderColor = col + '55';
  t.style.display = 'block';
  _posTip(t, e.clientX, e.clientY);
}

// ── Donut SVG ─────────────────────────────────────────────────────────
// sliceData: array of { lvl, n, pct, col, items[] } — built from counts + top5
function _renderDonut(type, counts, top5, levelMeta, healthScore, totalCount, itemsByLevel = {}) {
  const svgEl  = document.getElementById(`chart-${type}-donut`);
  const summEl = document.getElementById(`chart-${type}-summary`);
  const impEl  = document.getElementById(`chart-${type}-impact`);
  if (!svgEl) return;

  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  const isCentrals = type === 'centrais';

  if (!total) {
    svgEl.innerHTML = `<text x="150" y="145" text-anchor="middle" font-size="13" fill="var(--text3)" font-family="var(--mono)">Sem dados</text>`;
    if (summEl) summEl.innerHTML = '';
    if (impEl)  impEl.innerHTML  = '';
    return;
  }

  // ── SVG: viewBox mais largo para acomodar callout lines ─────────────
  // 420×300: o donut fica centrado, callouts se estendem para os lados
  svgEl.setAttribute('viewBox', '0 0 420 300');
  svgEl.setAttribute('height', '300');

  const CX = 210, CY = 148, R = 104, ri = 60;
  const CALLOUT_R   = R + 22;   // onde a linha sai do donut
  const ELBOW_R     = R + 44;   // onde a linha dobra em ângulo reto
  const TICK_LEN    = 22;       // comprimento do traço horizontal
  let svg = '', angle = -Math.PI / 2;

  svg += `<defs>
    <filter id="mglow-${type}" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <style>
      .mslice-${type} { cursor:pointer; transition:opacity .15s; transform-origin:${CX}px ${CY}px; }
      .mslice-${type}:hover { opacity:1 !important; filter:url(#mglow-${type}); }
      .mslice-${type}.m-dimmed { opacity:0.32; }
      .mcallout-${type} { pointer-events:none; transition:opacity .15s; }
      .mcallout-${type}.m-dimmed { opacity:0.18; }
    </style>
  </defs>`;

  const sliceOrder = ['critico', 'urgente', 'atencao', 'bom'];
  const gap = 0.022;

  const _trendForLevel = (lvl) => levelMeta?.[lvl]?.trend ?? null;
  const _custoForLevel = (lvl) => levelMeta?.[lvl]?.custo ?? 0;
  const _diffForLevel  = (lvl) => levelMeta?.[lvl]?.diff  ?? 0;

  const sliceData = [];  // built first pass, callouts drawn second pass

  // ── Pass 1: draw slices, collect callout data ─────────────────────────
  sliceOrder.forEach(lvl => {
    const n = counts[lvl] || 0;
    if (!n) return;
    const pct   = n / total;
    const sweep = Math.max(pct * 2 * Math.PI - gap, 0.01);
    const col   = _levelColor[lvl];

    const a0 = angle + gap / 2;
    const ae = a0 + sweep;
    const midA = a0 + sweep / 2;

    const x1 = CX + R * Math.cos(a0),   y1 = CY + R * Math.sin(a0);
    const x2 = CX + R * Math.cos(ae),   y2 = CY + R * Math.sin(ae);
    const x3 = CX + ri * Math.cos(ae),  y3 = CY + ri * Math.sin(ae);
    const x4 = CX + ri * Math.cos(a0),  y4 = CY + ri * Math.sin(a0);
    const large = sweep > Math.PI ? 1 : 0;

    const pctStr = Math.round(pct * 100);
    const trend  = _trendForLevel(lvl);
    const custo  = _custoForLevel(lvl);
    const diff   = _diffForLevel(lvl);

    const tipLines = [
      `<div style="display:flex;align-items:center;gap:7px;margin-bottom:8px">
        <span style="width:10px;height:10px;border-radius:3px;background:${col};display:inline-block;flex-shrink:0"></span>
        <span style="font-weight:700;font-size:13px;color:var(--text)">${_levelLabel[lvl]}</span>
        <span style="margin-left:auto;font-family:var(--mono);font-size:11px;color:${col};font-weight:700">${n} (${pctStr}%)</span>
      </div>`,
      `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;font-family:var(--mono);font-size:10.5px">`,
      `<div style="color:var(--text3)">Variação total</div>
       <div class="${varClass(diff)}" style="font-weight:600">${varSymbol(diff)} ${fmtKgShort(Math.abs(diff))}</div>`,
      custo > 0 ? (() => {
        // diff < 0 = desfalque (perda), diff > 0 = sobra
        const custoColor = diff < 0 ? '#f43f5e' : '#10b981';
        const custoLabel = diff < 0 ? 'Custo estimado (perda)' : 'Custo estimado (sobra)';
        const custoIcon  = diff < 0
          ? '<i class="ti ti-circle-arrow-down" style="font-size:11px;margin-right:3px;vertical-align:middle"></i>'
          : '<i class="ti ti-circle-arrow-up"   style="font-size:11px;margin-right:3px;vertical-align:middle"></i>';
        return `<div style="color:var(--text3)">${custoLabel}</div>
          <div style="color:${custoColor};font-weight:600">${custoIcon}${money(custo)}</div>`;
      })() : '',
      `<div style="color:var(--text3)">% do total</div>
       <div style="color:var(--text)">${pctStr}%</div>`,
      trend ? `<div style="color:var(--text3)">Tendência</div>
       <div style="${trend==='worsening'?'color:#f43f5e':trend==='improving'?'color:#10b981':'color:var(--text3)'}">
         ${trend==='worsening'?'▲ Piorando':trend==='improving'?'▼ Melhorando':'→ Estável'}
       </div>` : '',
      `</div>`,
      (() => {
        const items = itemsByLevel[lvl];
        if (!items || !items.length) return '';
        const MAX = 8;
        const shown = items.slice(0, MAX);
        const more  = items.length - MAX;
        return `<div style="margin-top:8px;border-top:1px solid rgba(255,255,255,0.08);padding-top:8px">
          <div style="font-family:var(--mono);font-size:9.5px;color:var(--text3);margin-bottom:5px;letter-spacing:.06em">ITENS (${items.length})</div>
          <div style="display:flex;flex-direction:column;gap:3px">
            ${shown.map(it => `<div style="font-family:var(--mono);font-size:10px;color:${col};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px">${escapeHtml(it)}</div>`).join('')}
            ${more > 0 ? `<div style="font-family:var(--mono);font-size:9.5px;color:var(--text3)">+ ${more} mais…</div>` : ''}
          </div>
        </div>`;
      })(),
    ].filter(Boolean).join('');

    svg += `<path class="mslice-${type}" data-lvl="${lvl}" data-tip="${encodeURIComponent(tipLines)}" data-col="${col}"
      d="M${x1.toFixed(1)},${y1.toFixed(1)} A${R},${R} 0 ${large},1 ${x2.toFixed(1)},${y2.toFixed(1)} L${x3.toFixed(1)},${y3.toFixed(1)} A${ri},${ri} 0 ${large},0 ${x4.toFixed(1)},${y4.toFixed(1)} Z"
      fill="${col}" opacity="0.88"/>`;

    sliceData.push({ lvl, midA, pct, pctStr, col, n });
    angle += sweep + gap;
  });

  // ── Pass 2: callout lines (drawn on top of slices) ────────────────────
  // To avoid overlap we sort by vertical position and nudge overlapping labels
  // Elbow point: goes out radially, then horizontal tick
  sliceData.forEach(({ lvl, midA, pct, pctStr, col, n }) => {
    if (pct < 0.02) return;  // skip slivers too small to label

    // Radial elbow point
    const ex  = CX + ELBOW_R * Math.cos(midA);
    const ey  = CY + ELBOW_R * Math.sin(midA);

    // Start point (just outside slice edge)
    const sx = CX + CALLOUT_R * Math.cos(midA);
    const sy = CY + CALLOUT_R * Math.sin(midA);

    // Horizontal tick direction: left if slice is on left half, right if on right half
    const onRight = Math.cos(midA) >= 0;
    const tx = ex + (onRight ? TICK_LEN : -TICK_LEN);
    const ty = ey;

    // Label anchor
    const labelX = tx + (onRight ? 4 : -4);
    const labelAnchor = onRight ? 'start' : 'end';

    // Percentage label
    const label = `${pctStr}%`;
    // n label below
    const nLabel = `${n}`;

    const cid = `${type}-${lvl}`;

    svg += `<g class="mcallout-${type}" data-callout-lvl="${lvl}">
      <polyline points="${sx.toFixed(1)},${sy.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)} ${tx.toFixed(1)},${ty.toFixed(1)}"
        fill="none" stroke="${col}" stroke-width="1.2" stroke-opacity="0.7" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="2" fill="${col}" opacity="0.7"/>
      <text x="${labelX.toFixed(1)}" y="${(ty - 3).toFixed(1)}" text-anchor="${labelAnchor}"
        font-size="12" font-weight="700" font-family="var(--mono)" fill="${col}">${label}</text>
      <text x="${labelX.toFixed(1)}" y="${(ty + 11).toFixed(1)}" text-anchor="${labelAnchor}"
        font-size="9.5" font-family="var(--mono)" fill="${col}" opacity="0.65">${_levelLabel[lvl]}</text>
    </g>`;
  });

  // ── Centro: score de saúde agregado ─────────────────────────────────
  const score      = healthScore ?? 0;
  const scoreLevel = _levelFromScore(score);
  const scoreCol   = _levelColor[scoreLevel] || '#10b981';
  const scoreLabel = { bom:'SAUDÁVEL', atencao:'ATENÇÃO', urgente:'URGENTE', critico:'CRÍTICO' }[scoreLevel] || '';
  const nLabel     = totalCount ?? total;
  const unitLabel  = isCentrals ? 'centrais' : 'mat × central';

  // Anel de fundo cinza + anel colorido de score
  const SR = ri - 8;  // raio do anel de score (dentro do buraco do donut)
  const sCirc = 2 * Math.PI * SR;
  const sDash = (score / 100) * sCirc;

  svg += `<circle cx="${CX}" cy="${CY}" r="${SR}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="5" style="pointer-events:none"/>`;
  svg += `<circle cx="${CX}" cy="${CY}" r="${SR}" fill="none" stroke="${scoreCol}" stroke-width="5"
    stroke-dasharray="${sDash.toFixed(1)} ${sCirc.toFixed(1)}"
    stroke-dashoffset="${(sCirc / 4).toFixed(1)}"
    stroke-linecap="round" opacity="0.55" style="pointer-events:none"/>`;

  // Score principal — grande, colorido
  svg += `<text x="${CX}" y="${CY - 8}" text-anchor="middle" font-size="34" font-weight="700" font-family="var(--mono)" fill="${scoreCol}" style="pointer-events:none">${score}%</text>`;
  // Label de nível
  svg += `<text x="${CX}" y="${CY + 13}" text-anchor="middle" font-size="9" font-weight="700" font-family="var(--mono)" fill="${scoreCol}" letter-spacing=".08em" opacity="0.85" style="pointer-events:none">${scoreLabel}</text>`;
  // Total de itens — discreto, abaixo
  svg += `<text x="${CX}" y="${CY + 32}" text-anchor="middle" font-size="8.5" font-family="var(--mono)" fill="var(--text3)" style="pointer-events:none">${nLabel} ${unitLabel}</text>`;

  svgEl.innerHTML = svg;

  // Bind hover events — dim both slices and their callout lines
  svgEl.querySelectorAll(`.mslice-${type}`).forEach(path => {
    const col = path.dataset.col;
    const tip = decodeURIComponent(path.dataset.tip);
    const lvl = path.dataset.lvl;
    const allSlices   = svgEl.querySelectorAll(`.mslice-${type}`);
    const allCallouts = svgEl.querySelectorAll(`.mcallout-${type}`);

    path.addEventListener('mouseenter', (e) => {
      allSlices.forEach(s => s.classList.toggle('m-dimmed', s !== path));
      allCallouts.forEach(c => c.classList.toggle('m-dimmed', c.dataset.calloutLvl !== lvl));
      _showTip(e, tip, col);
    });
    path.addEventListener('mousemove', _moveTip);
    path.addEventListener('mouseleave', () => {
      allSlices.forEach(s => s.classList.remove('m-dimmed'));
      allCallouts.forEach(c => c.classList.remove('m-dimmed'));
      _hideTip();
    });
  });

  // ── Summary badges ───────────────────────────────────────────────────
  if (summEl) {
    summEl.innerHTML = sliceOrder.filter(lvl => counts[lvl] > 0).map(lvl => {
      const col = _levelColor[lvl];
      return `<span style="
        display:inline-flex;align-items:center;gap:5px;
        background:${col}18;color:${col};
        border:1px solid ${col}35;
        padding:3px 10px;border-radius:5px;
        font-size:10px;font-weight:700;font-family:var(--mono);
        letter-spacing:.04em;white-space:nowrap;cursor:default">
        <span style="width:6px;height:6px;border-radius:50%;background:${col};display:inline-block;flex-shrink:0"></span>
        ${counts[lvl]} ${_levelLabel[lvl]}
      </span>`;
    }).join('');
  }

  // ── Barras de ranking ─────────────────────────────────────────────────
  if (!impEl || !top5.length) { if (impEl) impEl.innerHTML = ''; return; }

  const maxVal = Math.max(...top5.map(i => Math.abs(i.diff ?? i.worstDiff ?? 0)), 0.001);

  // Cada linha do ranking é clicável: filtra a Visão Micro pela central /
  // material da linha e leva a tela até lá (ver _macroFocusMicro).
  const focusKey = type === 'centrais' ? 'central' : 'material';
  const focusHint = focusKey === 'central'
    ? 'Ver esta central na Visão Micro'
    : 'Ver este material na Visão Micro';

  impEl.innerHTML = top5.map(item => {
    const col    = _levelColor[item.level];
    const dv     = item.diff ?? item.worstDiff ?? 0;
    const pct    = Math.round(Math.abs(dv) / maxVal * 100);
    const name   = (item.name || '').length > 22 ? (item.name||'').slice(0,20)+'…' : (item.name||'');
    const sub    = item.sub || null;
    const lvlCol = _levelColor[item.level];
    const lvlLbl = _levelLabel[item.level];
    let countsTip = '';
    if (item.counts) {
      const parts = [];
      if (item.counts.critico) parts.push(`${item.counts.critico} crít.`);
      if (item.counts.urgente) parts.push(`${item.counts.urgente} urg.`);
      if (item.counts.atencao) parts.push(`${item.counts.atencao} ate.`);
      countsTip = parts.join(' · ');
    }
    const trendHtml = item.trend && item.trend !== 'stable'
      ? `<span style="font-size:9px;margin-left:4px;color:${item.trend==='worsening'?'#f43f5e':'#10b981'}">${item.trend==='worsening'?'▲':'▼'}</span>`
      : '';

    return `<div class="macro-bar-row macro-bar-row-clickable" role="button" tabindex="0"
      title="${escapeHtml(item.name||'')} — ${focusHint}"
      data-focus-value="${escapeHtml(item.name||'')}"
      onclick="_macroFocusMicro('${focusKey}', this)"
      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();_macroFocusMicro('${focusKey}', this)}">
      <div style="min-width:130px;max-width:155px;overflow:hidden">
        <div class="macro-bar-label">${escapeHtml(name)}${trendHtml}</div>
        ${sub ? `<div class="macro-bar-label-sub">${escapeHtml(sub)}</div>` : ''}
        ${countsTip ? `<div class="macro-bar-label-sub">${countsTip}</div>` : ''}
      </div>
      <div class="macro-bar-track">
        <div class="macro-bar-fill" style="width:${pct}%;background:${col}"></div>
      </div>
      <span class="macro-bar-val td-mono ${varClass(dv)}">${varSymbol(dv)} ${fmtKgShort(Math.abs(dv))}</span>
      <span class="macro-bar-level" style="background:${lvlCol}18;color:${lvlCol};border:1px solid ${lvlCol}35">${lvlLbl}</span>
    </div>`;
  }).join('');
}

// ── Clique numa linha do ranking → foca a Visão Micro ─────────────────
// O valor vem do data-attribute (e não inline no onclick) para não quebrar
// com aspas/apóstrofos no nome da central ou do material.
function _macroFocusMicro(key, el) {
  const value = el?.dataset?.focusValue || '';
  if (!value) return;
  if (typeof microFocusFromMacro !== 'function') return;
  microFocusFromMacro(key, value);
}

// ── Crank panel ───────────────────────────────────────────────────────
function _renderCrankPanel(levelKey, items) {
  const body  = document.getElementById(`crank-${levelKey}-body`);
  const count = document.getElementById(`crank-${levelKey}-count`);
  if (!body) return;
  if (count) count.textContent = items.length || '0';

  if (!items.length) {
    const lbl = { critico: 'crítico', urgente: 'urgente', atencao: 'em atenção' };
    body.innerHTML = `<div class="crank-empty"><i class="ti ti-check"></i><span>Nenhum material ${lbl[levelKey]}</span></div>`;
    return;
  }

  const maxCusto = Math.max(...items.map(i => Math.abs(i.custo)), 0.001);
  body.innerHTML = items.slice(0, 30).map(item => {
    const barPct    = Math.round(Math.abs(item.custo) / maxCusto * 100);
    const impactLvl = Math.abs(item.custo) > maxCusto * 0.66 ? 'alto'
                    : Math.abs(item.custo) > maxCusto * 0.33 ? 'medio' : 'baixo';
    const varCls    = varClass(item.diff);
    return `
      <div class="crank-row" data-central="${escapeHtml(item.central)}" data-mat="${escapeHtml(item.mat)}" onclick="_crankOpenDetail(this)">
        <div class="crank-row-left">
          <span class="crank-row-mat" title="${escapeHtml(item.mat)}">${escapeHtml(item.mat)}${_trendIcon(item.trend)}</span>
          <span class="crank-row-meta">
            <span>${escapeHtml(item.central)}</span>
            <span class="sep">·</span>
            <span>${escapeHtml(item.regional)}</span>
          </span>
        </div>
        <div class="crank-row-right">
          <span class="crank-row-var td-mono ${varCls}">${varSymbol(item.diff)} ${fmtKg(Math.abs(item.diff))}</span>
          <div class="crank-impact-bar-wrap">
            <div class="crank-impact-bar-fill" style="width:${barPct}%"></div>
          </div>
          <span class="crank-impact-label crank-impact-${impactLvl}">${money(Math.abs(item.custo))}</span>
        </div>
      </div>`;
  }).join('');
}

// ── Clique na linha → abre o mesmo modal "Detalhamento do Material" da
// Visão Micro (openAnaliticoDetailModal). A Visão Micro já roda antes dos
// painéis de criticidade (renderAnaliticoMicro chama renderMacroPanels no
// fim), então window.__analiticoDetailCache já tem uma entrada central+mat
// para cada linha aqui — só precisa achar a chave correspondente. ─────────
function _crankOpenDetail(row) {
  const { central, mat } = row.dataset;
  const cache = window.__analiticoDetailCache;
  let key = null;
  if (cache) {
    for (const [k, payload] of cache) {
      if (payload.central === central && payload.material === mat) { key = k; break; }
    }
  }
  if (!key) { toast('Detalhamento não encontrado.', 'error'); return; }
  openAnaliticoDetailModal(key);
}

// ── Clipboard ─────────────────────────────────────────────────────────
function _crankCopy(levelKey) {
  const items = window._rankByLevel?.[levelKey];
  if (!items?.length) { toast('Nenhum dado para copiar', 'error'); return; }
  const tl = t => t === 'worsening' ? '▲ Piorando' : t === 'improving' ? '▼ Melhorando' : '→ Estável';
  const text = items.map(i =>
    `${i.mat} | ${i.central} | ${i.regional} | ${i.diff<0?'-':'+'}${Math.abs(i.diff).toFixed(2)} kg | ${Math.abs(i.custo).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})} | ${tl(i.trend)}`
  ).join('\n');
  navigator.clipboard?.writeText(text)
    .then(() => toast('Lista copiada!', 'success'))
    .catch(() => toast('Não foi possível copiar', 'error'));
}


Object.assign(window, { renderMacroPanels, macroApplyFilter, _crankCopy, _crankOpenDetail, _macroFocusMicro });
