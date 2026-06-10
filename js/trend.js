// ═══════════════════════════════════════════════════════════
// RELATÓRIO INTERATIVO DE TENDÊNCIA v2
// Abas: Visão Geral · Distribuição · Heatmap · Comparação
// ═══════════════════════════════════════════════════════════

// ── Polyfill roundRect (Chrome <99, Safari <15.4) ────────
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
    r = Math.min(r||0, w/2, h/2);
    this.moveTo(x+r, y);
    this.lineTo(x+w-r, y); this.arcTo(x+w, y, x+w, y+r, r);
    this.lineTo(x+w, y+h-r); this.arcTo(x+w, y+h, x+w-r, y+h, r);
    this.lineTo(x+r, y+h); this.arcTo(x, y+h, x, y+h-r, r);
    this.lineTo(x, y+r); this.arcTo(x, y, x+r, y, r);
    this.closePath();
  };
}

// ── Paleta de séries (até 6 linhas simultâneas) ──────────
const SERIES_COLORS = [
  { line: '#e8666a', area: 'rgba(232,102,106,0.18)', areaBot: 'rgba(232,102,106,0)' },
  { line: '#8b5cf6', area: 'rgba(139,92,246,0.15)',  areaBot: 'rgba(139,92,246,0)' },
  { line: '#3b82f6', area: 'rgba(59,130,246,0.15)',  areaBot: 'rgba(59,130,246,0)' },
  { line: '#f59e0b', area: 'rgba(245,158,11,0.15)',  areaBot: 'rgba(245,158,11,0)' },
  { line: '#10b981', area: 'rgba(16,185,129,0.15)',  areaBot: 'rgba(16,185,129,0)' },
  { line: '#f97316', area: 'rgba(249,115,22,0.15)',  areaBot: 'rgba(249,115,22,0)' },
];

// ── Estado global ────────────────────────────────────────
let _T = {
  type: null, name: null,
  dtIni: null, dtFim: null,
  materials: null, allMats: [],
  activeTab: 'overview',
  // Visão Geral
  weekData: [],
  forecastVal: null,
  sel: null, dragging: false, dragStartIdx: null, hoverIdx: -1,
  // Distribuição
  distData: [],
  distSort: 'variation', // 'variation' | 'name'
  distSortDir: -1,       // -1 desc, 1 asc
  // Heatmap
  heatData: {},          // { subEntity: weekData[] }
  heatSubEntities: [],
  heatHover: null,       // { row, col }
  // Comparação
  cmpSeries: [],         // [{ type, name, label, color, weekData }]
  cmpNormalize: false,
  cmpRelative: false,    // eixo X relativo (semana 1,2,3...)
  custoMedio: {},
};

// ── Date helpers ─────────────────────────────────────────
function _tDK(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function _tPrevTue(d) {
  const dt = new Date(d); dt.setHours(0,0,0,0);
  const dow = dt.getDay();
  dt.setDate(dt.getDate() - (dow >= 2 ? dow - 2 : 7 + dow - 2));
  return dt;
}
function _tNextTue(d) {
  const dt = new Date(d); dt.setHours(0,0,0,0);
  const dow = dt.getDay();
  if (dow === 2) return dt;
  dt.setDate(dt.getDate() + (dow < 2 ? 2 - dow : 9 - dow));
  return dt;
}
function _tBuildWeeks(dtIni, dtFim) {
  // Modelo ter→ter: cada semana vai da terça anterior (start) à terça atual (end).
  // A medição é feita no fim do dia da terça — o lançamento físico de start é o
  // pesoIni e o de end é o pesoFim. SAP = movimentações entre start e end.
  const lastTue = _tPrevTue(dtFim || new Date());
  // Terça inicial: a terça imediatamente antes da primeira terça do período
  const firstTue = dtIni ? _tNextTue(dtIni) : (() => {
    const d = new Date(lastTue); d.setMonth(d.getMonth() - 3); return _tNextTue(d);
  })();
  const weeks = [];
  let cur = new Date(firstTue);
  while (true) {
    const next = new Date(cur); next.setDate(next.getDate() + 7);
    if (next > lastTue) break;
    // start = terça anterior (cur), end = terça seguinte (next)
    weeks.push({ start: new Date(cur), end: new Date(next) });
    cur = new Date(next);
  }
  return weeks;
}

// ── Entity helpers ───────────────────────────────────────
function _tGetCentralsList(type, name) {
  if (type === 'central') return [name];
  const all = (state.filiais||[])
    .filter(f => normalizeText(f.regional||'') === normalizeText(name))
    .map(f => f.alias || f.origem || '')
    .filter(Boolean);
  // Filtro de centrais ativo (só para regionais)
  if (_T.centrals && _T.centrals.size > 0) {
    return all.filter(c => _T.centrals.has(c));
  }
  return all;
}
function _tGetSubEntities(type, name) {
  // For regional: filtered centrals (respeita _T.centrals). For central: materials.
  if (type === 'regional') return _tGetCentralsList('regional', name);
  return _tGetAllMaterials('central', name);
}
function _tGetAllMaterials(type, name) {
  const centrals = _tGetCentralsList(type, name);
  const s = new Set();
  const { byCentralMat } = getLancIndex();
  centrals.forEach(c => {
    const matMap = byCentralMat.get(c);
    if (matMap) matMap.forEach((_, mat) => s.add(mat));
  });
  return [...s].filter(m => m && m !== '—').sort();
}
function _tGetAllRegionals() {
  return [...new Set((state.filiais||[]).map(f=>f.regional).filter(Boolean))].sort();
}
function _tGetAllCentrals() {
  return [...new Set((state.filiais||[]).map(f=>f.alias||f.origem).filter(Boolean))].sort();
}

// ── Custo médio ──────────────────────────────────────────
function _tBuildCustoMedio(centrals, dtIni, dtFim) {
  const inPeriod = d => { if (!d) return false; return d >= dtIni && d <= dtFim; };
  const custoPorMat = {}, pesoPorMat = {};
  (state.saidas||[]).forEach(s => {
    if (!centrals.includes(s.central || '')) return;
    const d = parseDate(s.dtEmissao);
    if (!inPeriod(d)) return;
    const mat = s.material || '—';
    custoPorMat[mat] = (custoPorMat[mat]||0) + num(s.valorTotal);
    pesoPorMat[mat]  = (pesoPorMat[mat] ||0) + Math.abs(num(s.peso));
  });
  const out = {};
  Object.keys(custoPorMat).forEach(m => {
    if (pesoPorMat[m] > 0 && custoPorMat[m] > 0) out[m] = custoPorMat[m] / pesoPorMat[m];
  });
  (state.lancamentos||[]).forEach(l => {
    if (!centrals.includes(l.central || '')) return;
    if (out[l.material]) return;
    const d = parseDate(l.dtLanc);
    if (!inPeriod(d)) return;
    const mat = l.material || '—'; const p = Math.abs(num(l.peso));
    const vt = num(l.valorTotal), cu = num(l.custo);
    const valor = vt > 0 ? vt : cu > 0 ? cu * p : 0;
    if (!valor || !p) return;
    if (!custoPorMat['_l_'+mat]) { custoPorMat['_l_'+mat] = 0; pesoPorMat['_l_'+mat] = 0; }
    custoPorMat['_l_'+mat] += valor; pesoPorMat['_l_'+mat] += p;
  });
  Object.keys(custoPorMat).forEach(k => {
    if (!k.startsWith('_l_')) return;
    const m = k.slice(3);
    if (out[m]) return;
    if (pesoPorMat[k] > 0 && custoPorMat[k] > 0) out[m] = custoPorMat[k] / pesoPorMat[k];
  });
  return out;
}

// ── Compute variation per week ───────────────────────────
//
// MODELO TER→TER:
//   start = terça anterior (pesoIni = lançamento físico desta terça)
//   end   = terça atual    (pesoFim = lançamento físico desta terça)
//   SAP   = movimentações entre start e end inclusive (ter→ter, 7 dias)
//   estTeorico = pesoIni + totalEnt_SAP + totalSai_SAP
//   diff       = pesoFim − estTeorico
//   label = "DD/MM → DD/MM"
//
function _tCompute(type, name, dtIni, dtFim, selMats, custoMedioOverride) {
  const weeks      = _tBuildWeeks(dtIni, dtFim);
  const centrals   = _tGetCentralsList(type, name);
  const custoMedio = custoMedioOverride || _T.custoMedio;
  const allMats    = selMats ? [...selMats] : _tGetAllMaterials(type, name);

  // Índices hoistados fora do loop — chamados 1x, não N×M×W vezes
  const { byCentralMat: lancIdx } = getLancIndex();
  const { byCentralMat: sapIdx  } = getSapIndex();

  const fmtD = d => d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' });

  return weeks.map(({ start, end }) => {
    const sk = _tDK(start);   // terça anterior — pesoIni
    const ek = _tDK(end);     // terça atual    — pesoFim
    let totalDiff = 0, totalCusto = 0, totalRealKg = 0, totalTeoricoKg = 0, totalEstIni = 0, totalEnt = 0, totalSai = 0;

    centrals.forEach(central => {
      const lancMatMap = lancIdx.get(central);
      const sapMatMap  = sapIdx.get(central);

      allMats.forEach(material => {
        // ── SAP: terça anterior → terça atual (inclusive, 7 dias) ─────
        const sapAll  = sapMatMap?.get(material) || [];
        const sapWeek = sapAll.filter(s => {
          const d = parseDate(s.dtLanc);
          if (!d) return false;
          const dk = _tDK(d);
          return dk >= sk && dk <= ek;
        });

        // ── Lançamento de inventário da terça atual (pesoFim) ─────────
        // Também inclui lançamento da terça anterior se existir (pesoIni)
        const lancsAll  = lancMatMap?.get(material) || [];
        const lancsWeek = lancsAll.filter(l => {
          const d = parseDate(l.dtLanc);
          if (!d) return false;
          const dk = _tDK(d);
          return dk === sk || dk === ek;  // terça anterior OU terça atual
        });

        // Inclui se há lançamento em qualquer uma das terças OU SAP na janela
        if (!lancsWeek.length && !sapWeek.length) return;

        // ── pesoIni: lançamento da terça anterior (= start) ───────────
        const iniStock = getLastPeriodLaunchStock({ central, material, dtFim: start });

        // ── pesoFim: lançamento da terça atual (= end) ────────────────
        const endStock = getLastPeriodLaunchStock({ central, material, dtFim: end });

        const snap = buildSnapshot({
          lancs: lancsWeek, sap: sapWeek,
          initialStockOverride: iniStock && !iniStock.missing ? iniStock.value : null,
          finalStockOverride:   endStock && !endStock.missing ? endStock.value : null,
        });

        totalDiff      += snap.diff;
        totalRealKg    += snap.pesoFim;
        totalTeoricoKg += snap.estTeorico;
        totalEstIni    += snap.pesoIni;
        totalEnt       += snap.totalEnt;
        totalSai       += snap.totalSai;
        const cm = custoMedio[material];
        if (cm && Number.isFinite(snap.diff)) totalCusto += snap.diff * cm;
      });
    });

    return {
      label:      `${fmtD(start)} → ${fmtD(end)}`,  // label completo para tooltip/KPI
      shortLabel: fmtD(end),                          // só a terça atual para eixo X
      startDate:  start,
      endDate:    end,
      variation:  totalDiff,
      realKg:     totalRealKg,
      teorKg:     totalTeoricoKg,
      estIni:     totalEstIni,
      totalEnt:   totalEnt,
      totalSai:   totalSai,
      custo:      totalCusto,
    };
  });
}

// ── Compute for single sub-entity (material or central) ──
function _tComputeSubEntity(parentType, parentName, subType, subName, dtIni, dtFim) {
  // subType: for regional parent → 'central'; for central parent → 'material'
  if (subType === 'central') {
    // Passa _T.materials para que o cálculo por central respeite o filtro de materiais ativo
    return _tCompute('central', subName, dtIni, dtFim, _T.materials || null, _T.custoMedio);
  }
  // subType === 'material' — compute for parent central filtered to this material
  return _tCompute(parentType, parentName, dtIni, dtFim, new Set([subName]), _T.custoMedio);
}

// ── Forecast (linear regression on last 4 weeks) ─────────
function _tForecast(data) {
  const r = data.slice(-4).filter(w => w.realKg > 0);
  if (r.length < 2) return null;
  const n = r.length, xs = r.map((_,i)=>i), ys = r.map(w=>w.variation);
  const mx = xs.reduce((a,b)=>a+b,0)/n, my = ys.reduce((a,b)=>a+b,0)/n;
  const n2 = xs.reduce((s,x,i)=>s+(x-mx)*(ys[i]-my),0);
  const dn = xs.reduce((s,x)=>s+(x-mx)**2,0);
  if (!dn) return null;
  return (my - (n2/dn)*mx) + (n2/dn)*n;
}

// ── Format helpers ────────────────────────────────────────
function _tFmtK(v) {
  const a = Math.abs(v);
  if (a>=1e6) return (v/1e6).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'M';
  if (a>=1e3) return (v/1e3).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'K';
  return v.toLocaleString('pt-BR',{maximumFractionDigits:0});
}
function _tFmtFull(v) {
  return v.toLocaleString('pt-BR',{maximumFractionDigits:0});
}

// ── CSS theme colors helper ───────────────────────────────
function _tGetThemeColors() {
  const S = getComputedStyle(document.documentElement);
  const isDark = !document.body.classList.contains('theme-light') && document.body.dataset.theme !== 'light' && document.body.dataset.theme !== 'sand';
  return {
    isDark,
    bg2:     S.getPropertyValue('--bg2').trim(),
    bg3:     S.getPropertyValue('--bg3').trim(),
    bg4:     S.getPropertyValue('--bg4').trim(),
    border:  S.getPropertyValue('--border').trim(),
    border2: S.getPropertyValue('--border2').trim(),
    text:    S.getPropertyValue('--text').trim(),
    text2:   S.getPropertyValue('--text2').trim(),
    text3:   S.getPropertyValue('--text3').trim(),
    accent:  S.getPropertyValue('--accent').trim(),
    green:   S.getPropertyValue('--green').trim(),
    red:     S.getPropertyValue('--red').trim(),
    amber:   S.getPropertyValue('--amber').trim(),
    grid:    isDark ? 'rgba(255,255,255,0.055)' : 'rgba(0,0,0,0.055)',
    axis:    isDark ? 'rgba(255,255,255,0.40)'  : 'rgba(0,0,0,0.40)',
    zero:    isDark ? 'rgba(255,255,255,0.18)'  : 'rgba(0,0,0,0.18)',
    selFill: 'rgba(59,130,246,0.10)',
    selLine: 'rgba(59,130,246,0.60)',
  };
}

// ═══════════════════════════════════════════════════════════
// ABA 1 — VISÃO GERAL (canvas linha + KPIs)
// ═══════════════════════════════════════════════════════════

// ── Empty state — sem período selecionado ────────────────
function _tDrawEmptyState() {
  const canvas = document.getElementById('trend-canvas');
  if (!canvas) return;
  if (!canvas._W0) { _tSizeCanvas(); }
  const DPR = canvas._DPR || 1;
  const W0  = canvas._W0  || 600;
  const H0  = canvas._H0  || 300;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(DPR, DPR);
  ctx.clearRect(0, 0, W0, H0);

  const S = getComputedStyle(document.documentElement);
  const text3 = S.getPropertyValue('--text3').trim();
  const border2 = S.getPropertyValue('--border2').trim();

  // Ícone calendar
  const cx = W0 / 2, cy = H0 / 2 - 24;
  ctx.strokeStyle = border2;
  ctx.lineWidth = 1.5;
  // Retângulo do calendário
  ctx.beginPath();
  ctx.roundRect(cx - 22, cy - 18, 44, 38, 4);
  ctx.stroke();
  // Linhas do calendário
  ctx.beginPath();
  ctx.moveTo(cx - 22, cy - 6); ctx.lineTo(cx + 22, cy - 6);
  ctx.stroke();
  // Pontos (dias)
  [-10, 0, 10].forEach(dx => {
    [6, 16].forEach(dy => {
      ctx.beginPath();
      ctx.arc(cx + dx, cy + dy, 2, 0, Math.PI * 2);
      ctx.fillStyle = border2;
      ctx.fill();
    });
  });
  // Traços do topo
  [-8, 8].forEach(dx => {
    ctx.beginPath();
    ctx.moveTo(cx + dx, cy - 24); ctx.lineTo(cx + dx, cy - 14);
    ctx.stroke();
  });

  // Texto
  ctx.fillStyle = text3;
  ctx.font = '500 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Selecione um período para gerar o relatório', cx, cy + 48);
  ctx.font = '12px sans-serif';
  ctx.fillText('Use o seletor de período no topo do modal', cx, cy + 68);
}

function _tSizeCanvas() {
  const canvas = document.getElementById('trend-canvas');
  const wrap   = document.getElementById('trend-chart-wrap');
  if (!canvas || !wrap) return;

  // Zera o canvas ANTES de medir para não inflar o container
  canvas.style.width  = '0';
  canvas.style.height = '0';
  canvas.width  = 0;
  canvas.height = 0;

  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  // wrap tem padding: 10px top, 20px left+right — descontar para área útil do canvas
  const W0 = Math.max(wrap.offsetWidth  - 40, 200);
  const H0 = Math.max(wrap.offsetHeight - 10, 100);

  canvas.width        = W0 * DPR;
  canvas.height       = H0 * DPR;
  canvas.style.width  = W0 + 'px';
  canvas.style.height = H0 + 'px';
  canvas._W0  = W0;
  canvas._H0  = H0;
  canvas._DPR = DPR;
}

function _tDrawOverview() {
  const canvas = document.getElementById('trend-canvas');
  if (!canvas || !canvas._W0) return;  // _tSizeCanvas ainda não foi chamado

  // Dimensões fixas — nunca toca no DOM de layout aqui (evita loop de expansão)
  const DPR = canvas._DPR;
  const W0  = canvas._W0;
  const H0  = canvas._H0;

  // Obtém contexto e reseta transformações — ctx.scale acumula sem isso
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);  // reset absoluto
  ctx.scale(DPR, DPR);
  const W = W0, H = H0;
  const PAD = { top: 20, right: 72, bottom: 36, left: 14 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top  - PAD.bottom;
  const C = _tGetThemeColors();

  ctx.clearRect(0, 0, W, H);

  const primary = _T.weekData;
  const n = primary.length;
  if (!n) {
    ctx.fillStyle = C.axis; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Sem dados para o período selecionado', W/2, H/2); return;
  }

  const vals   = primary.map(w => w.variation);
  const fcast  = _tForecast(primary);
  const allV   = [...vals, ...(fcast!=null?[fcast]:[])];
  const maxV   = Math.max(...allV.map(Math.abs), 1);
  const range  = maxV * 1.28;

  const xP = i => PAD.left + (i / (n-1||1)) * cW;
  const yP = v  => PAD.top + cH * (1 - (v + range) / (range * 2));
  const yZ = yP(0);

  // Grid
  const gridN = 4;
  for (let i = 0; i <= gridN; i++) {
    const y = PAD.top + (cH * i / gridN);
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
  }

  // Zero reference
  ctx.setLineDash([3, 5]); ctx.strokeStyle = C.zero; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD.left, yZ); ctx.lineTo(PAD.left + cW, yZ); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = C.axis; ctx.font = '10px monospace'; ctx.textAlign = 'left';
  ctx.fillText('0', PAD.left + cW + 5, yZ + 3);

  // Selection highlight
  if (_T.sel) {
    const { i0, i1 } = _T.sel;
    const x0 = xP(i0), x1 = xP(i1);
    ctx.fillStyle = C.selFill; ctx.fillRect(x0, PAD.top, x1 - x0, cH);
    [x0, x1].forEach(x => {
      ctx.strokeStyle = C.selLine; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, PAD.top + cH); ctx.stroke();
      const idx = x === x0 ? i0 : i1;
      ctx.beginPath(); ctx.arc(x, yP(vals[idx]), 5, 0, Math.PI*2);
      ctx.fillStyle = '#60a5fa'; ctx.fill();
      ctx.strokeStyle = C.bg2; ctx.lineWidth = 2; ctx.stroke();
    });
  }

  // Draw series helper
  const drawSeries = (seriesVals, col, areaTop, areaBot, pxScale) => {
    const sn = seriesVals.length;
    if (!sn) return;
    const scale = pxScale || 1;
    const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH);
    grad.addColorStop(0, areaTop); grad.addColorStop(1, areaBot);
    ctx.beginPath();
    ctx.moveTo(xP(0), yZ);
    seriesVals.forEach((v, i) => ctx.lineTo(xP(i * (n-1) / (sn-1||1)), yP(v)));
    ctx.lineTo(xP(n-1), yZ); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    ctx.strokeStyle = col; ctx.lineWidth = 1.8 * scale;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    seriesVals.forEach((v, i) => {
      const x = xP(i * (n-1) / (sn-1||1)), y = yP(v);
      if (i === 0) { ctx.moveTo(x, y); return; }
      const px = xP((i-1) * (n-1) / (sn-1||1)), py = yP(seriesVals[i-1]);
      const cpx = (px + x) / 2;
      ctx.bezierCurveTo(cpx, py, cpx, y, x, y);
    });
    ctx.stroke();
  };

  // ── Modo Separado: uma linha por sub-entidade ───────────────────────
  if (_T.splitMode) {
    const splitSubs = _tGetSplitSeries();
    if (splitSubs.length) {
      // Recalcula range com todos os valores de todas as séries
      const allSplitV = splitSubs.flatMap(s => s.weekData.map(w => w.variation));
      const splitMaxV = Math.max(...allSplitV.map(Math.abs), 1);
      const splitRange = splitMaxV * 1.28;
      const ySplit = v => PAD.top + cH * (1 - (v + splitRange) / (splitRange * 2));
      const yZS = ySplit(0);

      // Redesenhar zero com range correto
      ctx.clearRect(0, 0, W, H);
      // Grid novamente
      for (let gi = 0; gi <= gridN; gi++) {
        const gy = PAD.top + (cH * gi / gridN);
        ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(PAD.left, gy); ctx.lineTo(PAD.left + cW, gy); ctx.stroke();
      }
      ctx.setLineDash([3, 5]); ctx.strokeStyle = C.zero; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD.left, yZS); ctx.lineTo(PAD.left + cW, yZS); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.axis; ctx.font = '10px monospace'; ctx.textAlign = 'left';
      ctx.fillText('0', PAD.left + cW + 5, yZS + 3);

      splitSubs.forEach((s, si) => {
        const col  = SERIES_COLORS[si % SERIES_COLORS.length];
        const sVals = s.weekData.map(w => w.variation);
        const sn   = sVals.length;
        if (!sn) return;
        // Área preenchida
        const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH);
        grad.addColorStop(0, col.area); grad.addColorStop(1, col.areaBot);
        ctx.beginPath();
        ctx.moveTo(xP(0), yZS);
        sVals.forEach((v, i) => ctx.lineTo(xP(i * (n-1) / (sn-1||1)), ySplit(v)));
        ctx.lineTo(xP(n-1), yZS); ctx.closePath();
        ctx.fillStyle = grad; ctx.fill();
        // Linha
        ctx.strokeStyle = col.line; ctx.lineWidth = 1.8;
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.beginPath();
        sVals.forEach((v, i) => {
          const x = xP(i * (n-1) / (sn-1||1)), y = ySplit(v);
          if (i === 0) { ctx.moveTo(x, y); return; }
          const px = xP((i-1) * (n-1) / (sn-1||1)), py = ySplit(sVals[i-1]);
          const cpx = (px + x) / 2;
          ctx.bezierCurveTo(cpx, py, cpx, y, x, y);
        });
        ctx.stroke();
      });

      // Selection highlight no modo separado — mesmo visual do consolidado
      if (_T.sel) {
        const { i0, i1 } = _T.sel;
        const x0 = xP(i0), x1 = xP(i1);
        ctx.fillStyle = C.selFill;
        ctx.fillRect(x0, PAD.top, x1 - x0, cH);
        [x0, x1].forEach(x => {
          ctx.strokeStyle = C.selLine; ctx.lineWidth = 1.5; ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, PAD.top + cH); ctx.stroke();
          const idx = x === x0 ? i0 : i1;
          // Ponto de cada série na borda da seleção
          splitSubs.forEach((s, si) => {
            if (idx >= s.weekData.length) return;
            const v = s.weekData[idx]?.variation ?? 0;
            const col = SERIES_COLORS[si % SERIES_COLORS.length];
            ctx.beginPath(); ctx.arc(x, ySplit(v), 5, 0, Math.PI*2);
            ctx.fillStyle = col.line; ctx.fill();
            ctx.strokeStyle = C.bg2; ctx.lineWidth = 2; ctx.stroke();
          });
        });
      }

      // Hover crosshair no modo separado — destaca ponto de cada série
      if (_T.hoverIdx >= 0 && _T.hoverIdx < n) {
        const hx = xP(_T.hoverIdx);
        ctx.strokeStyle = C.isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.15)';
        ctx.lineWidth = 1; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(hx, PAD.top); ctx.lineTo(hx, PAD.top + cH); ctx.stroke();
        splitSubs.forEach((s, si) => {
          if (_T.hoverIdx >= s.weekData.length) return;
          const v = s.weekData[_T.hoverIdx]?.variation ?? 0;
          const col = SERIES_COLORS[si % SERIES_COLORS.length];
          ctx.beginPath(); ctx.arc(hx, ySplit(v), 4, 0, Math.PI*2);
          ctx.fillStyle = col.line; ctx.fill();
          ctx.strokeStyle = C.bg2; ctx.lineWidth = 1.5; ctx.stroke();
        });
      }

      // Y axis e X axis
      for (let i = 0; i <= gridN; i++) {
        const v = splitRange - (splitRange * 2 * i / gridN);
        const y = PAD.top + (cH * i / gridN);
        ctx.fillStyle = C.axis; ctx.font = '10px monospace'; ctx.textAlign = 'left';
        ctx.fillText(_tFmtK(v), PAD.left + cW + 5, y + 3);
      }
      const step2 = n > 24 ? Math.ceil(n/8) : n > 12 ? 2 : 1;
      ctx.fillStyle = C.axis; ctx.font = '10px monospace'; ctx.textAlign = 'center';
      primary.forEach((w, i) => {
        if (i % step2 !== 0 && i !== n-1) return;
        ctx.fillText(w.shortLabel || w.label, xP(i), PAD.top + cH + 18);
      });

      canvas._meta = { xP, yP: ySplit, PAD, cW, cH, n, C, W, H, splitSubs };
      return;  // skip modo consolidado
    }
  }

  drawSeries(vals, SERIES_COLORS[0].line, SERIES_COLORS[0].area, SERIES_COLORS[0].areaBot);

  // Forecast
  if (fcast != null) {
    const lastX = xP(n-1), lastY = yP(vals[n-1]);
    const fcX   = lastX + cW / (n > 1 ? n-1 : 1);
    const fcY   = yP(fcast);
    ctx.setLineDash([5, 4]); ctx.strokeStyle = C.amber; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.lineTo(fcX, fcY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(fcX, fcY, 4, 0, Math.PI*2);
    ctx.fillStyle = C.amber; ctx.fill();
    ctx.strokeStyle = C.bg2; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = C.amber; ctx.font = '9px monospace'; ctx.textAlign = 'left';
    ctx.fillText('Prev.', fcX + 5, fcY + 3);
    _T.forecastVal = fcast;
  }

  // Hover crosshair
  if (_T.hoverIdx >= 0 && _T.hoverIdx < n) {
    const hx = xP(_T.hoverIdx), hy = yP(vals[_T.hoverIdx]);
    ctx.strokeStyle = C.isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(hx, PAD.top); ctx.lineTo(hx, PAD.top + cH); ctx.stroke();
    ctx.beginPath(); ctx.arc(hx, hy, 4.5, 0, Math.PI*2);
    ctx.fillStyle = SERIES_COLORS[0].line; ctx.fill();
    ctx.strokeStyle = C.bg2; ctx.lineWidth = 2; ctx.stroke();
  }

  // Y axis labels
  for (let i = 0; i <= gridN; i++) {
    const v = range - (range * 2 * i / gridN);
    const y = PAD.top + (cH * i / gridN);
    ctx.fillStyle = C.axis; ctx.font = '10px monospace'; ctx.textAlign = 'left';
    ctx.fillText(_tFmtK(v), PAD.left + cW + 5, y + 3);
  }

  // X axis labels
  const step = n > 24 ? Math.ceil(n/8) : n > 12 ? 2 : 1;
  ctx.fillStyle = C.axis; ctx.font = '10px monospace'; ctx.textAlign = 'center';
  primary.forEach((w, i) => {
    if (i % step !== 0 && i !== n-1) return;
    ctx.fillText(w.shortLabel || w.label, xP(i), PAD.top + cH + 18);
  });

  canvas._meta = { xP, yP, PAD, cW, cH, n, C, W, H };
}

// ── Retorna as séries para o modo Separado ────────────────────────────────
// Usa _T.heatData (calculado na Fase 2) se disponível.
// Se ainda não calculado, computa sob demanda (só as necessárias).
const SPLIT_MAX_SERIES = 6;

function _tGetSplitSeries() {
  const { type, name, dtIni, dtFim, materials, centrals } = _T;
  if (!type || !name || !dtIni || !dtFim) return [];

  // Sub-entidades filtradas: centrais ou materiais, conforme o tipo
  let subs = _tGetSubEntities(type, name);

  // Para regional no modo separado, cada sub é uma central filtrada
  // Para central, cada sub é um material (já filtrado por _T.materials)
  if (type === 'central' && materials) {
    subs = subs.filter(s => materials.has(s));
  }

  if (!subs.length) return [];

  // Limita ao máximo de séries
  if (subs.length > SPLIT_MAX_SERIES) subs = subs.slice(0, SPLIT_MAX_SERIES);

  return subs.map((sub, si) => {
    // Usa cache do heatData SOMENTE quando não há filtro de materiais ativo.
    // Com filtro ativo, o heatData foi calculado sem o filtro e estaria errado.
    // Invalida cache se há filtro ativo — heatData foi calculado sem filtros
    const canUseCache = !materials && !centrals && _T.heatData && _T.heatData[sub];
    const weekData = canUseCache
      ? _T.heatData[sub]
      : _tComputeSubEntity(type, name,
          type === 'regional' ? 'central' : 'material',
          sub, dtIni, dtFim);
    return { name: sub, weekData, color: SERIES_COLORS[si % SERIES_COLORS.length] };
  });
}

// ── Toggle Separado / Consolidado ──────────────────────────────────────────
function trendToggleSplitMode() {
  // Verificar se há mais de SPLIT_MAX_SERIES entidades para avisar
  const subs = _tGetSubEntities(_T.type, _T.name);
  const { type, materials } = _T;
  const filtered = type === 'central' && materials
    ? subs.filter(s => materials.has(s))
    : subs;

  const newMode = !_T.splitMode;
  if (newMode && filtered.length > SPLIT_MAX_SERIES) {
    const extra = filtered.length - SPLIT_MAX_SERIES;
    if (typeof toast === 'function') {
      toast(`Modo separado limitado a ${SPLIT_MAX_SERIES} séries. ${extra} entidade${extra>1?'s':''} omitida${extra>1?'s':''}.`, 'info');
    }
  }

  _T.splitMode = newMode;
  _T.sel = null; // limpa seleção ao trocar modo

  // Atualizar visual do botão
  const btn  = document.getElementById('trend-split-btn');
  const lbl  = document.getElementById('trend-split-label');
  const icon = document.getElementById('trend-split-icon');
  if (btn)  btn.classList.toggle('split-active', _T.splitMode);
  if (lbl)  lbl.textContent = _T.splitMode ? 'Consolidado' : 'Separado';
  if (icon) icon.className  = _T.splitMode ? 'ti ti-chart-line' : 'ti ti-chart-dots-3';

  if (_T.activeTab === 'overview') {
    _tDrawOverview();
    _tRenderOverviewLegend();
  }
}

function _tResetSplitMode() {
  _T.splitMode = false;
  const btn  = document.getElementById('trend-split-btn');
  const lbl  = document.getElementById('trend-split-label');
  const icon = document.getElementById('trend-split-icon');
  if (btn)  btn.classList.remove('split-active');
  if (lbl)  lbl.textContent = 'Separado';
  if (icon) icon.className  = 'ti ti-chart-dots-3';
}

function _tRenderKPIs() {
  const el = document.getElementById('trend-kpis');
  if (!el) return;
  if (!_T.dtIni || !_T.dtFim) {
    el.innerHTML = '<div class="tr2-kpi-empty">Selecione um período para ver os indicadores.</div>';
    return;
  }
  const data = _T.weekData;
  if (!data.length) { el.innerHTML = ''; return; }

  const total = data.reduce((s,w) => s+w.variation, 0);
  const totalCusto = data.reduce((s,w) => s+w.custo, 0);
  const fcast = _T.forecastVal ?? _tForecast(data);
  const n = data.length;
  const trend = n >= 2 ? data[n-1].variation - data[n-2].variation : 0;
  const worstWk = data.reduce((a,b) => b.variation < a.variation ? b : a, data[0]);
  const bestWk  = data.reduce((a,b) => b.variation > a.variation ? b : a, data[0]);

  // ── Helpers: funções globais de dashboard.js com fallback defensivo ──
  const _sym = v => (typeof varSymbol === 'function') ? varSymbol(v) : '';
  const _lbl = v => (typeof varLabel  === 'function') ? varLabel(v)  : (v < 0 ? 'Desfalque' : v > 0 ? 'Sobra' : 'Equilibrado');
  // Cor inline — necessário pois .tr2-kpi-val tem color:var(--text) no CSS que vence classes externas
  const _col = v => v < -0.0001 ? 'var(--red)' : v > 0.0001 ? 'var(--amber)' : 'var(--text3)';
  const _fmtKg = v => `${_tFmtK(Math.abs(v))} kg`;  // sem sinal — badge já indica direção

  // KPI de variação kg: badge + cor inline, sem sinal numérico
  const kpiKg = (label, v, sub) => `
    <div class="tr2-kpi">
      <div class="tr2-kpi-label">${label}</div>
      <div class="tr2-kpi-val" style="color:${_col(v)};display:flex;align-items:center;gap:5px">
        ${_sym(v)}<span>${_fmtKg(v)}</span>
      </div>
      ${sub ? `<div class="tr2-kpi-sub">${sub}</div>` : ''}
    </div>`;

  // KPI de variação kg com semana: badge + data + rótulo tipo
  const kpiWk = (label, wk) => {
    const col = _col(wk.variation);
    return `
    <div class="tr2-kpi">
      <div class="tr2-kpi-label">${label}</div>
      <div class="tr2-kpi-val" style="color:${col};display:flex;align-items:center;gap:5px">
        ${_sym(wk.variation)}<span>${_fmtKg(wk.variation)}</span>
      </div>
      <div class="tr2-kpi-sub" style="display:flex;align-items:center;gap:4px;margin-top:2px">
        <span>${wk.label}</span>
        <span style="opacity:.45">·</span>
        <span style="color:${col};font-size:9.5px;font-weight:700;letter-spacing:.04em">${_lbl(wk.variation)}</span>
      </div>
    </div>`;
  };

  // KPI texto simples (Semanas, Tendência)
  const kpiTxt = (label, val, sub, color) => `
    <div class="tr2-kpi">
      <div class="tr2-kpi-label">${label}</div>
      <div class="tr2-kpi-val" style="color:${color||'var(--text)'}">${val}</div>
      ${sub ? `<div class="tr2-kpi-sub">${sub}</div>` : ''}
    </div>`;

  el.innerHTML =
    kpiTxt('Semanas', `${n}`, `${data[0]?.shortLabel||data[0]?.label||''} → ${data[n-1]?.shortLabel||data[n-1]?.label||''}`) +
    kpiKg('Acumulado', total, moneyShort(Math.abs(totalCusto))) +
    kpiWk('Maior desfalque', worstWk) +
    kpiWk('Maior sobra',     bestWk) +
    kpiTxt('Tendência', trend<=0 ? '↘ Piorando' : '↗ Melhorando',
           `${_tFmtK(Math.abs(trend))} kg/sem`,
           trend<=0 ? 'var(--red)' : 'var(--amber)') +
    (fcast != null
      ? kpiKg('Previsão', fcast, 'próxima semana')
      : kpiTxt('Previsão', '—', 'próxima semana', 'var(--text3)'));
}

function _tRenderOverviewLegend() {
  const el = document.getElementById('trend-legend');
  if (!el) return;
  const data = _T.weekData;
  const fcast = _T.forecastVal ?? _tForecast(data);
  const n = data.length;
  const trendDir = n >= 2 ? data[n-1].variation - data[n-2].variation : 0;

  if (_T.splitMode) {
    const splits = _tGetSplitSeries();
    el.innerHTML = splits.map((s, si) => {
      const col = SERIES_COLORS[si % SERIES_COLORS.length];
      const tot = s.weekData.reduce((acc,w) => acc+w.variation, 0);
      const colTxt = tot < -0.0001 ? 'var(--red)' : tot > 0.0001 ? 'var(--amber)' : 'var(--text3)';
      return `<span class="trend-legend-item">
        <span style="display:inline-block;width:16px;height:3px;background:${col.line};border-radius:2px;vertical-align:middle;margin-right:4px"></span>
        <span>${escapeHtml(s.name)}</span>
        <span style="color:${colTxt};font-family:var(--mono);font-size:10.5px;margin-left:4px">${_tFmtK(Math.abs(tot))} kg</span>
      </span>`;
    }).join('');
    return;
  }

  el.innerHTML = `
    <span class="trend-legend-item">
      <span style="display:inline-block;width:20px;height:3px;background:${SERIES_COLORS[0].line};border-radius:2px;vertical-align:middle;margin-right:5px"></span>
      ${_T.name || 'Principal'}
    </span>
    <span class="trend-legend-item">
      <span style="display:inline-block;width:20px;height:0;border-top:2px dashed var(--amber);vertical-align:middle;margin-right:5px"></span>
      Prev.: <strong style="color:var(--amber)">${fcast != null ? (fcast>=0?'+':'')+_tFmtK(fcast)+' kg' : '—'}</strong>
    </span>
    <span class="trend-legend-item" style="color:${trendDir<=0?'var(--red)':'var(--green)'}">
      <i class="ti ti-trending-${trendDir<=0?'down':'up'}"></i>
      ${trendDir<=0?'Piorando':'Melhorando'}
    </span>`;
}

// ── Canvas interaction (overview) ────────────────────────
function _tEvtIdx(e) {
  const canvas = e.target;
  const rect   = canvas.getBoundingClientRect();
  const mx     = e.clientX - rect.left;
  const { xP, n } = canvas._meta || {};
  if (!xP) return -1;
  let best = -1, minD = Infinity;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(mx - xP(i));
    if (d < minD) { minD = d; best = i; }
  }
  return minD < (canvas.clientWidth / (n||1)) * 0.75 ? best : -1;
}
function _tOnMouseDown(e) {
  const idx = _tEvtIdx(e); if (idx < 0) return;
  _T.dragging = true; _T.dragStartIdx = idx;
  _T.sel = { i0: idx, i1: idx };
  _tDrawOverview();
}
function _tOnMouseMove(e) {
  const idx = _tEvtIdx(e);
  if (idx < 0) {
    if (_T.hoverIdx !== -1) { _T.hoverIdx = -1; _tDrawOverview(); }
    _tHideTooltip(); return;
  }
  if (_T.dragging) {
    _T.sel = { i0: Math.min(_T.dragStartIdx, idx), i1: Math.max(_T.dragStartIdx, idx) };
    _T.hoverIdx = -1; _tDrawOverview(); _tShowSelBar(); return;
  }
  if (!_T.sel) {
    if (_T.hoverIdx !== idx) { _T.hoverIdx = idx; _tDrawOverview(); }
    _tShowTooltip(e, idx);
  }
}
function _tOnMouseUp() { if (_T.dragging) { _T.dragging = false; _tShowSelBar(); } }
function _tOnMouseLeave() {
  _tHideTooltip();
  if (!_T.dragging) { _T.hoverIdx = -1; _tDrawOverview(); }
  _T.dragging = false;
}

function _tShowTooltip(e, idx) {
  const w = _T.weekData[idx]; if (!w) return;
  let tip = document.getElementById('trend-tooltip');
  if (!tip) {
    tip = document.createElement('div'); tip.id = 'trend-tooltip';
    tip.style.cssText = 'position:fixed;pointer-events:none;border-radius:8px;padding:10px 14px;font-size:11.5px;font-family:var(--mono);box-shadow:0 4px 24px rgba(0,0,0,.4);z-index:9999;min-width:170px;transition:left .05s,top .05s';
    document.body.appendChild(tip);
  }
  const S = getComputedStyle(document.documentElement);
  tip.style.background = S.getPropertyValue('--bg2').trim();
  tip.style.border = `1px solid ${S.getPropertyValue('--border2').trim()}`;
  // Modo separado: mostrar valores de todas as séries no mesmo ponto
  if (_T.splitMode) {
    const splits = _tGetSplitSeries();
    if (splits.length) {
      const lbl = _T.weekData[idx]?.label || '';
      let html = `<div style="font-weight:700;color:var(--text);margin-bottom:7px;font-size:12px;border-bottom:1px solid var(--border);padding-bottom:6px">${lbl}</div>`;
      splits.forEach((s, si) => {
        const sw = s.weekData[idx];
        if (!sw) return;
        const col2 = sw.variation < -0.0001 ? 'var(--red)' : sw.variation > 0.0001 ? 'var(--amber)' : 'var(--text3)';
        const sym2 = (typeof varSymbol === 'function') ? varSymbol(sw.variation) : '';
        const lc = SERIES_COLORS[si % SERIES_COLORS.length].line;
        html += `<div style="display:flex;justify-content:space-between;gap:14px;margin-bottom:4px;align-items:center">
          <span style="display:flex;align-items:center;gap:5px;color:var(--text2)">
            <span style="display:inline-block;width:10px;height:3px;background:${lc};border-radius:1px;flex-shrink:0"></span>
            ${escapeHtml(s.name)}
          </span>
          <strong style="color:${col2};display:inline-flex;align-items:center;gap:3px;font-size:12px">${sym2}<span>${_tFmtFull(Math.abs(sw.variation))} kg</span></strong>
        </div>`;
      });
      tip.innerHTML = html;
      tip.style.display = 'block';
      const tw2 = 260;
      const left2 = e.clientX + 16 + tw2 > window.innerWidth ? e.clientX - tw2 - 10 : e.clientX + 16;
      tip.style.left = left2+'px'; tip.style.top = Math.max(10, e.clientY - 70)+'px';
      return;
    }
  }

  const _ov_col = w.variation < -0.0001 ? 'var(--red)' : w.variation > 0.0001 ? 'var(--amber)' : 'var(--text3)';
  const _ov_sym = (typeof varSymbol === 'function') ? varSymbol(w.variation) : (w.variation >= 0 ? '▲' : '▼');
  const _ov_sai = w.totalSai ?? 0;
  const _ov_ent = w.totalEnt ?? 0;
  tip.innerHTML = `
    <div style="font-weight:700;color:var(--text);margin-bottom:7px;font-size:12px;border-bottom:1px solid var(--border);padding-bottom:6px">${w.label}</div>
    <div style="display:flex;flex-direction:column;gap:3px;margin-bottom:7px">
      <div style="display:flex;justify-content:space-between;gap:16px">
        <span style="color:var(--text3)">Est. Inicial</span>
        <strong style="color:var(--text)">${_tFmtFull(w.estIni ?? 0)} kg</strong>
      </div>
      <div style="display:flex;justify-content:space-between;gap:16px">
        <span style="color:var(--text3)">Entradas SAP</span>
        <strong style="color:var(--green)">+${_tFmtFull(_ov_ent)} kg</strong>
      </div>
      <div style="display:flex;justify-content:space-between;gap:16px">
        <span style="color:var(--text3)">Saídas SAP</span>
        <strong style="color:var(--red)">${_tFmtFull(_ov_sai)} kg</strong>
      </div>
    </div>
    <div style="border-top:1px solid var(--border);padding-top:6px;display:flex;flex-direction:column;gap:3px;margin-bottom:7px">
      <div style="display:flex;justify-content:space-between;gap:16px">
        <span style="color:var(--text3)">Est. Real</span>
        <strong style="color:var(--text)">${_tFmtFull(w.realKg)} kg</strong>
      </div>
      <div style="display:flex;justify-content:space-between;gap:16px">
        <span style="color:var(--text3)">Est. Teórico</span>
        <strong style="color:var(--text)">${_tFmtFull(w.teorKg)} kg</strong>
      </div>
    </div>
    <div style="border-top:1px solid var(--border);padding-top:6px;display:flex;justify-content:space-between;align-items:center;gap:16px">
      <span style="color:var(--text3)">Variação</span>
      <strong style="color:${_ov_col};display:inline-flex;align-items:center;gap:4px;font-size:13px">${_ov_sym}<span>${_tFmtFull(Math.abs(w.variation))} kg</span></strong>
    </div>`;
  tip.style.display = 'block';
  const tw = 240;
  const left = e.clientX + 16 + tw > window.innerWidth ? e.clientX - tw - 10 : e.clientX + 16;
  tip.style.left = left+'px';
  tip.style.top  = Math.max(10, e.clientY - 70)+'px';
}
function _tHideTooltip() {
  const tip = document.getElementById('trend-tooltip');
  if (tip) tip.style.display = 'none';
}

function _tShowSelBar() {
  if (!_T.sel) return;
  const { i0, i1 } = _T.sel;
  const sliced = _T.weekData.slice(i0, i1+1); if (!sliced.length) return;
  const totalVar  = sliced.reduce((s,w) => s+w.variation, 0);
  const totalCost = sliced.reduce((s,w) => s+w.custo, 0);
  const d0 = sliced[0].startDate, d1 = sliced[sliced.length-1].endDate;
  const fmt = d => d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit'});
  const _sel_col = totalVar < -0.0001 ? 'var(--red)' : totalVar > 0.0001 ? 'var(--amber)' : 'var(--text3)';
  const _sel_sym = (typeof varSymbol === 'function') ? varSymbol(totalVar) : (totalVar >= 0 ? '▲' : '▼');
  const bar = document.getElementById('trend-selection-bar');
  if (!bar) return;
  bar.style.display = 'flex';
  document.getElementById('trend-sel-range').textContent  = `${fmt(d0)} → ${fmt(d1)}  (${sliced.length} sem.)`;
  document.getElementById('trend-sel-var').innerHTML   = `<span style="color:${_sel_col};display:inline-flex;align-items:center;gap:4px">${_sel_sym}<span>${_tFmtFull(Math.abs(totalVar))} kg</span></span>`;
  document.getElementById('trend-sel-cost').innerHTML  = `<span style="color:var(--amber)">R$ ${Math.abs(totalCost).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>`;

  // Modo separado: breakdown por série no intervalo selecionado
  const splitEl = document.getElementById('trend-sel-split');
  if (splitEl) {
    if (_T.splitMode) {
      const splits = _tGetSplitSeries();
      if (splits.length > 1) {
        // Separador visual
        const items = splits.map((s, si) => {
          const sSliced = s.weekData.slice(i0, i1 + 1);
          const sVar = sSliced.reduce((acc, w) => acc + w.variation, 0);
          const sCol = sVar < -0.0001 ? 'var(--red)' : sVar > 0.0001 ? 'var(--amber)' : 'var(--text3)';
          const sSym = (typeof varSymbol === 'function') ? varSymbol(sVar) : '';
          const lc   = SERIES_COLORS[si % SERIES_COLORS.length].line;
          return `<span style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${lc};flex-shrink:0"></span>
            <span style="color:var(--text3)">${escapeHtml(s.name)}</span>
            <span style="color:${sCol};display:inline-flex;align-items:center;gap:2px">${sSym}<span>${_tFmtFull(Math.abs(sVar))} kg</span></span>
          </span>`;
        }).join(`<span style="color:var(--text3);margin:0 4px;opacity:.4">·</span>`);
        splitEl.innerHTML = `
          <span style="color:var(--text3);opacity:.4;margin:0 6px">|</span>
          <span style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11.5px;font-family:var(--mono)">${items}</span>`;
      } else {
        splitEl.innerHTML = '';
      }
    } else {
      splitEl.innerHTML = '';
    }
  }
}

function trendClearSelection() {
  _T.sel = null; _T.hoverIdx = -1;
  const bar = document.getElementById('trend-selection-bar');
  if (bar) bar.style.display = 'none';
  _tDrawOverview();
}

// ═══════════════════════════════════════════════════════════
// ABA 2 — DISTRIBUIÇÃO (barras horizontais por sub-entidade)
// ═══════════════════════════════════════════════════════════

function _tDrawDistribution() {
  const canvas = document.getElementById('trend-dist-canvas');
  const wrap   = document.getElementById('trend-dist-wrap');
  if (!canvas || !wrap) return;

  const data = _T.distData;
  if (data === null) {
    canvas.style.display = 'none';
    let msg = wrap.querySelector('.tr2-empty');
    if (!msg) { msg = document.createElement('div'); msg.className='tr2-empty'; wrap.appendChild(msg); }
    msg.innerHTML = '<i class="ti ti-loader-2" style="animation:spin 1s linear infinite;margin-right:6px"></i> Calculando…'; msg.style.display = 'flex';
    return;
  }
  if (!data.length) {
    canvas.style.display = 'none';
    let msg = wrap.querySelector('.tr2-empty');
    if (!msg) { msg = document.createElement('div'); msg.className='tr2-empty'; wrap.appendChild(msg); }
    msg.textContent = 'Sem dados para o período selecionado.'; msg.style.display = 'flex';
    return;
  }
  canvas.style.display = 'block';
  const empty = wrap.querySelector('.tr2-empty'); if (empty) empty.style.display = 'none';

  const sorted = [...data].sort((a,b) => _T.distSort === 'name'
    ? a.name.localeCompare(b.name) * _T.distSortDir
    : (a.variation - b.variation) * _T.distSortDir
  );

  const DPR   = Math.min(window.devicePixelRatio || 1, 2);
  const ROW_H = 44;   // mais respiro vertical
  const PAD_T = 36, PAD_B = 24;
  const W0    = wrap.clientWidth || 700;
  const C     = _tGetThemeColors();

  // ── LABEL_W dinâmico: mede o texto mais longo + padding fixo ──────────
  // Usamos um canvas off-screen temporário apenas para measureText
  const tmpCtx = document.createElement('canvas').getContext('2d');
  tmpCtx.font = '11.5px sans-serif';
  const MAX_NAME_CHARS = 26;
  const PAD_LABEL_LEFT = 12, PAD_LABEL_RIGHT = 20;
  let maxLabelW = 0;
  sorted.forEach(d => {
    const name = d.name.length > MAX_NAME_CHARS ? d.name.slice(0, MAX_NAME_CHARS - 1) + '…' : d.name;
    maxLabelW = Math.max(maxLabelW, tmpCtx.measureText(name).width);
  });
  const LABEL_W = Math.ceil(maxLabelW) + PAD_LABEL_LEFT + PAD_LABEL_RIGHT;

  // ── PAD_R dinâmico: espaço para o value label de sobra à direita ──────
  tmpCtx.font = 'bold 10.5px monospace';
  let maxValW = 0;
  sorted.forEach(d => {
    const t = `▲ ${_tFmtK(Math.abs(d.variation))} kg`;
    maxValW = Math.max(maxValW, tmpCtx.measureText(t).width);
  });
  const PAD_R = Math.ceil(maxValW) + 12;

  const barAreaW = W0 - LABEL_W - PAD_R;
  const zeroX    = LABEL_W + barAreaW / 2;   // linha zero — centro da área de barras

  const H0 = PAD_T + sorted.length * ROW_H + PAD_B;
  canvas.width  = W0 * DPR; canvas.height = H0 * DPR;
  canvas.style.width = W0+'px'; canvas.style.height = H0+'px';
  const ctx = canvas.getContext('2d'); ctx.scale(DPR, DPR);
  ctx.clearRect(0, 0, W0, H0);

  const maxAbs = Math.max(...data.map(d => Math.abs(d.variation)), 1);

  // ── Zona de labels (fundo sutil separado da zona de barras) ───────────
  ctx.fillStyle = C.isDark ? 'rgba(255,255,255,0.018)' : 'rgba(0,0,0,0.018)';
  ctx.fillRect(0, 0, LABEL_W, H0);

  // ── Header ────────────────────────────────────────────────────────────
  ctx.font = '9px monospace'; ctx.fillStyle = C.axis;
  ctx.textAlign = 'left';
  ctx.fillText(_T.type === 'regional' ? 'CENTRAL' : 'MATERIAL', PAD_LABEL_LEFT, 20);
  ctx.textAlign = 'center';
  ctx.fillText('VARIAÇÃO ACUMULADA (KG)', zeroX, 20);

  // ── Linha divisória vertical entre labels e barras ────────────────────
  ctx.strokeStyle = C.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(LABEL_W, PAD_T - 4); ctx.lineTo(LABEL_W, H0 - PAD_B); ctx.stroke();

  sorted.forEach((d, i) => {
    const y  = PAD_T + i * ROW_H;
    const cy = y + ROW_H / 2;

    // ── Row bg alternado ──────────────────────────────────────────────
    if (i % 2 === 0) {
      ctx.fillStyle = C.isDark ? 'rgba(255,255,255,0.022)' : 'rgba(0,0,0,0.022)';
      ctx.fillRect(0, y, W0, ROW_H);
    }

    // ── Nome do material — clipping para não vazar na zona de barras ──
    const name = d.name.length > MAX_NAME_CHARS ? d.name.slice(0, MAX_NAME_CHARS - 1) + '…' : d.name;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, y, LABEL_W - 4, ROW_H); ctx.clip();
    ctx.fillStyle = C.text2; ctx.font = '11.5px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(name, PAD_LABEL_LEFT, cy + 4);
    ctx.restore();

    // ── Barra ─────────────────────────────────────────────────────────
    const barLen = (Math.abs(d.variation) / maxAbs) * (barAreaW / 2 - 10);
    const barX   = d.variation >= 0 ? zeroX : zeroX - barLen;
    const barCol = d.variation >= 0 ? C.amber : C.red;
    const barH   = 16;
    const barY   = cy - barH / 2;

    // Fundo da barra (fill com opacidade)
    ctx.fillStyle = barCol + (C.isDark ? 'aa' : '88');
    ctx.beginPath(); ctx.roundRect(barX, barY, Math.max(barLen, 2), barH, 4); ctx.fill();
    // Borda da barra
    ctx.strokeStyle = barCol; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(barX, barY, Math.max(barLen, 2), barH, 4); ctx.stroke();

    // ── Linha zero ────────────────────────────────────────────────────
    ctx.strokeStyle = C.isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(zeroX, PAD_T); ctx.lineTo(zeroX, PAD_T + sorted.length * ROW_H); ctx.stroke();

    // ── Value label: nunca invade a zona de labels ────────────────────
    const sym     = d.variation >= 0 ? '▲' : '▼';
    const valText = `${sym} ${_tFmtK(Math.abs(d.variation))} kg`;
    ctx.font = 'bold 10.5px monospace';
    const textW = ctx.measureText(valText).width;

    if (d.variation >= 0) {
      // Sobra: à direita da barra (zona PAD_R garantida)
      ctx.fillStyle = barCol; ctx.textAlign = 'left';
      ctx.fillText(valText, zeroX + barLen + 6, cy + 4);
    } else {
      if (barLen > textW + 10) {
        // Desfalque grande: dentro da barra, branco
        ctx.fillStyle = C.isDark ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.92)';
        ctx.textAlign = 'right';
        ctx.fillText(valText, barX - 6, cy + 4);
      } else {
        // Desfalque pequeno: à esquerda da barra (barX - gap),
        // mas nunca dentro da zona de labels (x >= LABEL_W + 4)
        const xRight = barX - 6;
        const xMin   = LABEL_W + 4;
        if (xRight - textW >= xMin) {
          ctx.fillStyle = barCol; ctx.textAlign = 'right';
          ctx.fillText(valText, xRight, cy + 4);
        } else {
          // Último recurso: à direita da linha zero
          ctx.fillStyle = barCol; ctx.textAlign = 'left';
          ctx.fillText(valText, zeroX + 6, cy + 4);
        }
      }
    }
  });

  canvas._distMeta = { sorted, ROW_H, LABEL_W, PAD_T, W0 };
}

function _tDistTooltipShow(e) {
  const canvas = document.getElementById('trend-dist-canvas');
  if (!canvas?._distMeta) return;
  const { sorted, ROW_H, LABEL_W, PAD_T } = canvas._distMeta;
  const rect = canvas.getBoundingClientRect();
  const my   = e.clientY - rect.top;
  const idx  = Math.floor((my - PAD_T) / ROW_H);
  if (idx < 0 || idx >= sorted.length) { _tHideTooltip(); return; }
  const d = sorted[idx];
  let tip = document.getElementById('trend-tooltip');
  if (!tip) {
    tip = document.createElement('div'); tip.id = 'trend-tooltip';
    tip.style.cssText = 'position:fixed;pointer-events:none;border-radius:8px;padding:10px 14px;font-size:11.5px;font-family:var(--mono);box-shadow:0 4px 24px rgba(0,0,0,.4);z-index:9999;min-width:200px';
    document.body.appendChild(tip);
  }
  const S = getComputedStyle(document.documentElement);
  tip.style.background = S.getPropertyValue('--bg2').trim();
  tip.style.border = `1px solid ${S.getPropertyValue('--border2').trim()}`;
  const _dcol = d.variation < -0.0001 ? 'var(--red)' : d.variation > 0.0001 ? 'var(--amber)' : 'var(--text3)';
  const _dsym = (typeof varSymbol === 'function') ? varSymbol(d.variation) : (d.variation >= 0 ? '▲' : '▼');
  const _dlbl = (typeof varLabel  === 'function') ? varLabel(d.variation)  : (d.variation >= 0 ? 'Sobra' : 'Desfalque');
  tip.innerHTML = `
    <div style="font-weight:700;color:var(--text);margin-bottom:6px">${escapeHtml(d.name)}</div>
    <div style="color:var(--text3);display:flex;align-items:center;gap:4px">
      Variação:
      <strong style="color:${_dcol};display:inline-flex;align-items:center;gap:3px">
        ${_dsym} ${_tFmtFull(Math.abs(d.variation))} kg
      </strong>
      <span style="color:${_dcol};font-size:9.5px;font-weight:700">${_dlbl}</span>
    </div>
    <div style="color:var(--text3)">Custo: <strong style="color:var(--amber)">R$ ${d.custo.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong></div>
    <div style="color:var(--text3)">Semanas analisadas: <strong style="color:var(--text)">${d.weeks}</strong></div>`;
  tip.style.display = 'block';
  const tw = 220;
  const left = e.clientX + 16 + tw > window.innerWidth ? e.clientX - tw - 10 : e.clientX + 16;
  tip.style.left = left+'px'; tip.style.top = Math.max(10, e.clientY - 60)+'px';
}

function trendDistSort(field) {
  if (_T.distSort === field) { _T.distSortDir *= -1; }
  else { _T.distSort = field; _T.distSortDir = -1; }
  _tDrawDistribution();
}

// ═══════════════════════════════════════════════════════════
// ABA 3 — HEATMAP (sub-entidades × semanas)
// ═══════════════════════════════════════════════════════════

function _tDrawHeatmap() {
  const canvas = document.getElementById('trend-heat-canvas');
  const wrap   = document.getElementById('trend-heat-wrap');
  if (!canvas || !wrap) return;

  const subs  = _T.heatSubEntities;
  const weeks = _tBuildWeeks(_T.dtIni, _T.dtFim);
  if (_T.heatData === null) {
    canvas.style.display = 'none';
    let msg = wrap.querySelector('.tr2-empty');
    if (!msg) { msg = document.createElement('div'); msg.className='tr2-empty'; wrap.appendChild(msg); }
    msg.innerHTML = '<i class="ti ti-loader-2" style="animation:spin 1s linear infinite;margin-right:6px"></i> Calculando…'; msg.style.display = 'flex';
    return;
  }
  if (!subs.length || !weeks.length) {
    canvas.style.display = 'none'; return;
  }
  canvas.style.display = 'block';

  const DPR   = Math.min(window.devicePixelRatio || 1, 2);
  const LABEL_H = 56, PAD_B = 16, CELL_H = 36;
  const C     = _tGetThemeColors();

  // ── LABEL_W dinâmico: mede o nome mais longo ───────────────────────────
  const tmpCtx = document.createElement('canvas').getContext('2d');
  tmpCtx.font = '11.5px sans-serif';
  const MAX_NAME_CHARS = 24;
  let maxLabelPx = 0;
  subs.forEach(s => {
    const name = s.length > MAX_NAME_CHARS ? s.slice(0, MAX_NAME_CHARS - 1) + '…' : s;
    maxLabelPx = Math.max(maxLabelPx, tmpCtx.measureText(name).width);
  });
  const LABEL_W = Math.ceil(maxLabelPx) + 24;  // 12px padding cada lado

  const avail  = (wrap.clientWidth || 800) - LABEL_W - 4;
  const CELL_W = Math.max(24, Math.min(64, Math.floor(avail / weeks.length)));
  const W0     = LABEL_W + weeks.length * CELL_W + 4;
  const H0     = LABEL_H + subs.length * CELL_H + PAD_B;

  canvas.width  = W0 * DPR; canvas.height = H0 * DPR;
  canvas.style.width = W0+'px'; canvas.style.height = H0+'px';
  const ctx = canvas.getContext('2d'); ctx.scale(DPR, DPR);
  ctx.clearRect(0, 0, W0, H0);

  // ── Fundo da zona de labels ────────────────────────────────────────────
  ctx.fillStyle = C.isDark ? 'rgba(255,255,255,0.018)' : 'rgba(0,0,0,0.018)';
  ctx.fillRect(0, 0, LABEL_W, H0);

  // ── Cabeçalhos das colunas (semanas) ────────────────────────────────────
  // Estratégia adaptativa por CELL_W:
  //   CELL_W >= 42 → horizontal, fonte 9px, cabe DD/MM
  //   CELL_W 28-41 → vertical (90°), fonte 9px
  //   CELL_W < 28  → vertical (90°), fonte 8px, compacto
  // Vertical é muito mais legível que 45° quando as células são estreitas.
  const HEADER_FONT_SIZE = CELL_W >= 28 ? 9 : 8;
  const HEADER_USE_VERT  = CELL_W < 42;
  // LABEL_H precisa de espaço suficiente para o texto vertical (≈ 28px para "DD/MM")
  // já está em 56px — ok.
  ctx.fillStyle = C.isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.50)';
  ctx.font = `${HEADER_FONT_SIZE}px monospace`;

  weeks.forEach((wk, j) => {
    const cx = LABEL_W + j * CELL_W + CELL_W / 2;
    const heatWeekData = (_T.heatData[_T.heatSubEntities?.[0]] || [])
      .find(w => _tDK(w.startDate) === _tDK(wk.start));
    const lbl = heatWeekData?.shortLabel
      || wk.end.toLocaleDateString('pt-BR', {day:'2-digit', month:'2-digit'});

    ctx.save();
    if (HEADER_USE_VERT) {
      // Vertical de baixo para cima — mais legível, não sobrepõe células vizinhas
      // rotate(-PI/2): eixo X aponta para cima, eixo Y aponta para direita
      // translate para (cx, LABEL_H-4): ponto de ancora = base do texto
      // textAlign center: centraliza horizontalmente na célula
      ctx.translate(cx, LABEL_H - 4);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText(lbl, 0, 0);
    } else {
      // Horizontal — CELL_W amplo, texto cabe sem rotação
      ctx.textAlign = 'center';
      ctx.fillText(lbl, cx, LABEL_H - 10);
    }
    ctx.restore();

    // Linha guia sutil do header até a grade
    ctx.strokeStyle = C.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 0.5; ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(cx, LABEL_H - 3);
    ctx.lineTo(cx, LABEL_H);
    ctx.stroke();
  });

  // ── Linha separadora vertical entre labels e grade ────────────────────
  ctx.strokeStyle = C.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 1; ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(LABEL_W, LABEL_H - 4); ctx.lineTo(LABEL_W, H0 - PAD_B); ctx.stroke();

  // ── Linhas separadoras horizontais entre linhas ────────────────────────
  ctx.strokeStyle = C.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
  ctx.lineWidth = 0.5;
  subs.forEach((_, i) => {
    if (i === 0) return;
    const y = LABEL_H + i * CELL_H;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W0, y); ctx.stroke();
  });

  // ── Células ────────────────────────────────────────────────────────────
  subs.forEach((sub, i) => {
    const wData = _T.heatData[sub] || [];
    const rowY  = LABEL_H + i * CELL_H;

    // Pré-carrega dados para a linha inteira
    const rowMatches = weeks.map(wk =>
      wData.find(w => _tDK(w.startDate) === _tDK(wk.start)) || null
    );
    const rowVals = rowMatches.map(m => m ? m.variation : null);

    // rowMax relativo à própria entidade (normalização por linha)
    const rowMax = Math.max(...rowVals.filter(v => v !== null).map(Math.abs), 1);

    // ── Nome da entidade ─────────────────────────────────────────────
    const name = sub.length > MAX_NAME_CHARS ? sub.slice(0, MAX_NAME_CHARS - 1) + '…' : sub;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, rowY, LABEL_W - 4, CELL_H); ctx.clip();
    ctx.fillStyle = C.text2; ctx.font = '11.5px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(name, 12, rowY + CELL_H / 2 + 4);
    ctx.restore();

    // ── Fundo alternado na zona de labels ────────────────────────────
    if (i % 2 === 0) {
      ctx.fillStyle = C.isDark ? 'rgba(255,255,255,0.022)' : 'rgba(0,0,0,0.018)';
      ctx.fillRect(0, rowY, LABEL_W, CELL_H);
    }

    rowVals.forEach((v, j) => {
      const cx = LABEL_W + j * CELL_W;
      const cy = rowY;
      const PAD = 2;

      if (v === null) {
        // ── Sem dado: borda tracejada, fundo transparente ─────────────
        ctx.setLineDash([2, 2]);
        ctx.strokeStyle = C.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(cx + PAD, cy + PAD, CELL_W - PAD*2, CELL_H - PAD*2);
        ctx.setLineDash([]);
        return;
      }

      ctx.setLineDash([]);
      const intensity = Math.min(Math.abs(v) / rowMax, 1);
      const isZero    = Math.abs(v) < 0.0001;

      let fillColor, strokeColor;
      if (isZero) {
        // Zero real: fill quase invisível, borda sutil — diferencia do nulo
        fillColor   = C.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
        strokeColor = C.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';
      } else if (v < 0) {
        // Desfalque: vermelho (var(--red)) — intensidade relativa à linha
        const r = Math.round(226 * intensity + 40  * (1 - intensity));
        const g = Math.round(75  * intensity + (C.isDark ? 25 : 55) * (1 - intensity));
        const b = Math.round(74  * intensity + (C.isDark ? 35 : 65) * (1 - intensity));
        fillColor   = `rgba(${r},${g},${b},${0.18 + intensity * 0.72})`;
        strokeColor = `rgba(${r},${g},${b},${0.35 + intensity * 0.45})`;
      } else {
        // Sobra: âmbar (var(--amber)) — alinhado ao padrão diff-pos do sistema
        const r = Math.round(239 * intensity + (C.isDark ? 60 : 120) * (1 - intensity));
        const g = Math.round(159 * intensity + (C.isDark ? 50 :  90) * (1 - intensity));
        const b = Math.round(39  * intensity + (C.isDark ? 20 :  40) * (1 - intensity));
        fillColor   = `rgba(${r},${g},${b},${0.18 + intensity * 0.72})`;
        strokeColor = `rgba(${r},${g},${b},${0.35 + intensity * 0.45})`;
      }

      // Fill
      ctx.fillStyle = fillColor;
      ctx.beginPath(); ctx.roundRect(cx + PAD, cy + PAD, CELL_W - PAD*2, CELL_H - PAD*2, 4); ctx.fill();
      // Borda
      ctx.strokeStyle = strokeColor; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.roundRect(cx + PAD, cy + PAD, CELL_W - PAD*2, CELL_H - PAD*2, 4); ctx.stroke();

      // ── Valor numérico ────────────────────────────────────────────
      if (!isZero) {
        const valStr = _tFmtK(Math.abs(v));
        if (CELL_W >= 36) {
          // Célula larga: texto completo, cor forte
          const textAlpha = intensity > 0.5
            ? (C.isDark ? 0.92 : 0.88)
            : (C.isDark ? 0.70 : 0.65);
          ctx.fillStyle = C.isDark
            ? `rgba(255,255,255,${textAlpha})`
            : `rgba(0,0,0,${textAlpha})`;
          ctx.font = `${intensity > 0.4 ? 'bold ' : ''}8.5px monospace`;
          ctx.textAlign = 'center';
          ctx.fillText(valStr, cx + CELL_W / 2, cy + CELL_H / 2 + 3);
        } else if (CELL_W >= 24 && intensity > 0.55) {
          // Célula estreita: só mostra se intensidade alta (valor relevante)
          ctx.fillStyle = C.isDark ? 'rgba(255,255,255,0.70)' : 'rgba(0,0,0,0.65)';
          ctx.font = '7.5px monospace'; ctx.textAlign = 'center';
          ctx.fillText(valStr, cx + CELL_W / 2, cy + CELL_H / 2 + 3);
        }
        // Célula muito estreita: só cor, sem texto — intencionalmente limpo
      }
    });
  });

  // ── Hover: borda de destaque na célula + highlight da linha/coluna ─────
  if (_T.heatHover) {
    const { row, col } = _T.heatHover;

    // Highlight linha inteira (faixa semi-transparente)
    ctx.fillStyle = C.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
    ctx.fillRect(LABEL_W, LABEL_H + row * CELL_H, weeks.length * CELL_W, CELL_H);

    // Highlight coluna inteira
    ctx.fillStyle = C.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)';
    ctx.fillRect(LABEL_W + col * CELL_W, LABEL_H, CELL_W, subs.length * CELL_H);

    // Borda accent na célula hover
    const hx = LABEL_W + col * CELL_W + 2;
    const hy = LABEL_H + row * CELL_H + 2;
    ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5; ctx.setLineDash([]);
    ctx.beginPath(); ctx.roundRect(hx, hy, CELL_W - 4, CELL_H - 4, 4); ctx.stroke();
  }

  canvas._heatMeta = { subs, weeks, LABEL_W, LABEL_H, CELL_W, CELL_H };
}

function _tHeatTooltip(e) {
  const canvas = document.getElementById('trend-heat-canvas');
  if (!canvas?._heatMeta) return;
  const { subs, weeks, LABEL_W, LABEL_H, CELL_W, CELL_H } = canvas._heatMeta;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const col = Math.floor((mx - LABEL_W) / CELL_W);
  const row = Math.floor((my - LABEL_H) / CELL_H);
  if (col < 0 || col >= weeks.length || row < 0 || row >= subs.length) { _tHideTooltip(); return; }

  if (!_T.heatHover || _T.heatHover.row !== row || _T.heatHover.col !== col) {
    _T.heatHover = { row, col }; _tDrawHeatmap();
  }

  const sub  = subs[row];
  const wk   = weeks[col];
  const wData = _T.heatData[sub] || [];
  const match = wData.find(w => _tDK(w.startDate) === _tDK(wk.start));

  let tip = document.getElementById('trend-tooltip');
  if (!tip) {
    tip = document.createElement('div'); tip.id = 'trend-tooltip';
    tip.style.cssText = 'position:fixed;pointer-events:none;border-radius:8px;padding:10px 14px;font-size:11.5px;font-family:var(--mono);box-shadow:0 4px 24px rgba(0,0,0,.4);z-index:9999;min-width:190px';
    document.body.appendChild(tip);
  }
  const S = getComputedStyle(document.documentElement);
  tip.style.background = S.getPropertyValue('--bg2').trim();
  tip.style.border = `1px solid ${S.getPropertyValue('--border2').trim()}`;
  const lbl = wk.start.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}) + ' → ' + wk.end.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
  if (match) {
    const _ht_col = match.variation < -0.0001 ? 'var(--red)' : match.variation > 0.0001 ? 'var(--amber)' : 'var(--text3)';
    const _ht_sym = (typeof varSymbol === 'function') ? varSymbol(match.variation) : (match.variation >= 0 ? '▲' : '▼');
    const _ht_sai = match.totalSai ?? 0;
    const _ht_ent = match.totalEnt ?? 0;
    tip.innerHTML = `
      <div style="font-weight:700;color:var(--text);margin-bottom:4px;font-size:12px">${escapeHtml(sub)}</div>
      <div style="color:var(--text3);margin-bottom:7px;font-size:10.5px;border-bottom:1px solid var(--border);padding-bottom:6px">${lbl}</div>
      <div style="display:flex;flex-direction:column;gap:3px;margin-bottom:7px">
        <div style="display:flex;justify-content:space-between;gap:14px">
          <span style="color:var(--text3)">Est. Inicial</span>
          <strong style="color:var(--text)">${_tFmtFull(match.estIni ?? 0)} kg</strong>
        </div>
        <div style="display:flex;justify-content:space-between;gap:14px">
          <span style="color:var(--text3)">Entradas SAP</span>
          <strong style="color:var(--green)">+${_tFmtFull(_ht_ent)} kg</strong>
        </div>
        <div style="display:flex;justify-content:space-between;gap:14px">
          <span style="color:var(--text3)">Saídas SAP</span>
          <strong style="color:var(--red)">${_tFmtFull(_ht_sai)} kg</strong>
        </div>
      </div>
      <div style="border-top:1px solid var(--border);padding-top:6px;display:flex;flex-direction:column;gap:3px;margin-bottom:7px">
        <div style="display:flex;justify-content:space-between;gap:14px">
          <span style="color:var(--text3)">Est. Real</span>
          <strong style="color:var(--text)">${_tFmtFull(match.realKg)} kg</strong>
        </div>
        <div style="display:flex;justify-content:space-between;gap:14px">
          <span style="color:var(--text3)">Est. Teórico</span>
          <strong style="color:var(--text)">${_tFmtFull(match.teorKg)} kg</strong>
        </div>
      </div>
      <div style="border-top:1px solid var(--border);padding-top:6px;display:flex;justify-content:space-between;align-items:center;gap:14px">
        <span style="color:var(--text3)">Variação</span>
        <strong style="color:${_ht_col};display:inline-flex;align-items:center;gap:4px;font-size:13px">${_ht_sym}<span>${_tFmtFull(Math.abs(match.variation))} kg</span></strong>
      </div>`;
  } else {
    tip.innerHTML = `<div style="color:var(--text3)">${escapeHtml(sub)}<br>${lbl}<br><em>Sem dados</em></div>`;
  }
  tip.style.display = 'block';
  const tw = 240;
  const left = e.clientX + 16 + tw > window.innerWidth ? e.clientX - tw - 10 : e.clientX + 16;
  tip.style.left = left+'px'; tip.style.top = Math.max(10, e.clientY - 50)+'px';
}

// ═══════════════════════════════════════════════════════════
// ABA 4 — COMPARAÇÃO (multi-série)
// ═══════════════════════════════════════════════════════════

function _tDrawComparison() {
  const canvas = document.getElementById('trend-cmp2-canvas');
  const wrap   = document.getElementById('trend-cmp2-wrap');
  if (!canvas || !wrap) return;

  const series = _T.cmpSeries;
  if (!series.length) {
    canvas.style.display = 'none';
    let msg = wrap.querySelector('.tr2-empty');
    if (!msg) { msg = document.createElement('div'); msg.className='tr2-empty'; wrap.appendChild(msg); }
    msg.innerHTML = 'Selecione ao menos uma entidade para comparar acima.'; msg.style.display = 'flex';
    return;
  }
  canvas.style.display = 'block';
  const empty = wrap.querySelector('.tr2-empty'); if (empty) empty.style.display = 'none';

  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const W0  = wrap.clientWidth || 760;
  const H0  = wrap.clientHeight || 340;
  canvas.width  = W0 * DPR; canvas.height = H0 * DPR;
  canvas.style.width = W0+'px'; canvas.style.height = H0+'px';
  const ctx = canvas.getContext('2d'); ctx.scale(DPR, DPR);
  const C = _tGetThemeColors();
  const PAD = { top: 20, right: 80, bottom: 36, left: 14 };
  const cW = W0 - PAD.left - PAD.right;
  const cH = H0 - PAD.top  - PAD.bottom;
  ctx.clearRect(0, 0, W0, H0);

  // Normalize data
  const normalize = _T.cmpNormalize;
  const allData = series.map(s => normalize
    ? s.weekData.map((w, i) => ({ ...w, _norm: i === 0 ? 0 : w.variation - s.weekData[0].variation }))
    : s.weekData
  );
  const allVals = allData.flatMap(d => d.map(w => normalize ? w._norm : w.variation)).filter(Number.isFinite);
  if (!allVals.length) return;

  const n     = Math.max(...allData.map(d=>d.length));
  const maxV  = Math.max(...allVals.map(Math.abs), 1);
  const range = maxV * 1.28;

  const xP = (i, total) => PAD.left + (i / (total-1||1)) * cW;
  const yP = v => PAD.top + cH * (1 - (v + range) / (range * 2));
  const yZ = yP(0);

  // Grid
  const gridN = 4;
  for (let gi = 0; gi <= gridN; gi++) {
    const y = PAD.top + (cH * gi / gridN);
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
  }
  // Zero
  ctx.setLineDash([3,5]); ctx.strokeStyle = C.zero; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD.left, yZ); ctx.lineTo(PAD.left+cW, yZ); ctx.stroke();
  ctx.setLineDash([]);

  // Draw each series
  allData.forEach((data, si) => {
    const col = series[si].color;
    const sn  = data.length;
    if (!sn) return;
    const vals = data.map(w => normalize ? w._norm : w.variation);

    // Area fill
    const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH);
    grad.addColorStop(0, col + '28'); grad.addColorStop(1, col + '00');
    ctx.beginPath();
    ctx.moveTo(xP(0, n), yZ);
    vals.forEach((v, i) => ctx.lineTo(xP(i * (n-1) / (sn-1||1), n), yP(v)));
    ctx.lineTo(xP(n-1, n), yZ); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    // Line
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    vals.forEach((v, i) => {
      const x = xP(i * (n-1) / (sn-1||1), n);
      const y = yP(v);
      if (i === 0) { ctx.moveTo(x, y); return; }
      const px = xP((i-1) * (n-1) / (sn-1||1), n), py = yP(vals[i-1]);
      const cpx = (px + x) / 2;
      ctx.bezierCurveTo(cpx, py, cpx, y, x, y);
    });
    ctx.stroke();
  });

  // Y labels
  for (let gi = 0; gi <= gridN; gi++) {
    const v = range - (range * 2 * gi / gridN);
    const y = PAD.top + (cH * gi / gridN);
    ctx.fillStyle = C.axis; ctx.font = '10px monospace'; ctx.textAlign = 'left';
    ctx.fillText(_tFmtK(v), PAD.left + cW + 5, y + 3);
  }

  // X labels (use first series labels)
  const refData = allData[0] || [];
  if (refData.length) {
    const step = n > 24 ? Math.ceil(n/8) : n > 12 ? 2 : 1;
    ctx.fillStyle = C.axis; ctx.font = '10px monospace'; ctx.textAlign = 'center';
    refData.forEach((w, i) => {
      if (i % step !== 0 && i !== refData.length-1) return;
      const lbl = _T.cmpRelative ? `Sem ${i+1}` : w.label;
      ctx.fillText(lbl, xP(i * (n-1)/(refData.length-1||1), n), PAD.top + cH + 18);
    });
  }

  // Store for hover
  canvas._cmpMeta = { allData, series, xP, yP, n, PAD, cW, cH, normalize };
  _tRenderCmpLegend();
}

function _tRenderCmpLegend() {
  const el = document.getElementById('trend-cmp2-legend');
  if (!el) return;
  if (!_T.cmpSeries.length) { el.innerHTML = ''; return; }
  el.innerHTML = _T.cmpSeries.map(s => `
    <span class="trend-legend-item">
      <span style="display:inline-block;width:20px;height:3px;background:${s.color};border-radius:2px;vertical-align:middle;margin-right:5px"></span>
      ${escapeHtml(s.label)}
    </span>`).join('');
}

function _tCmpTooltipShow(e) {
  const canvas = document.getElementById('trend-cmp2-canvas');
  if (!canvas?._cmpMeta) return;
  const { allData, series, xP, yP, n, PAD } = canvas._cmpMeta;
  const rect = canvas.getBoundingClientRect();
  const mx   = e.clientX - rect.left;

  // Find closest x
  let best = -1, minD = Infinity;
  const refLen = allData[0]?.length || 0;
  for (let i = 0; i < refLen; i++) {
    const d = Math.abs(mx - xP(i * (n-1)/(refLen-1||1), n));
    if (d < minD) { minD = d; best = i; }
  }
  if (best < 0) { _tHideTooltip(); return; }

  let tip = document.getElementById('trend-tooltip');
  if (!tip) {
    tip = document.createElement('div'); tip.id = 'trend-tooltip';
    tip.style.cssText = 'position:fixed;pointer-events:none;border-radius:8px;padding:10px 14px;font-size:11.5px;font-family:var(--mono);box-shadow:0 4px 24px rgba(0,0,0,.4);z-index:9999;min-width:200px';
    document.body.appendChild(tip);
  }
  const S = getComputedStyle(document.documentElement);
  tip.style.background = S.getPropertyValue('--bg2').trim();
  tip.style.border = `1px solid ${S.getPropertyValue('--border2').trim()}`;

  const week = allData[0]?.[best];
  let html = `<div style="font-weight:700;color:var(--text);margin-bottom:6px">${week?.label || ''}</div>`;
  allData.forEach((data, si) => {
    const w = data[Math.min(best, data.length-1)];
    if (!w) return;
    const v = _T.cmpNormalize ? (w._norm ?? w.variation) : w.variation;
    const _cmp_col = v < -0.0001 ? 'var(--red)' : v > 0.0001 ? 'var(--amber)' : 'var(--text3)';
    const _cmp_sym = (typeof varSymbol === 'function') ? varSymbol(v) : (v >= 0 ? '▲' : '▼');
    const col  = series[si].color;
    html += `<div style="color:var(--text3);margin-top:3px">
      <span style="display:inline-block;width:10px;height:3px;background:${col};border-radius:1px;vertical-align:middle;margin-right:5px"></span>
      ${escapeHtml(series[si].label)}: <strong style="color:${_cmp_col};display:inline-flex;align-items:center;gap:3px">${_cmp_sym}<span>${_tFmtFull(Math.abs(v))} kg</span></strong></div>`;
  });
  tip.innerHTML = html;
  tip.style.display = 'block';
  const tw = 230;
  const left = e.clientX + 16 + tw > window.innerWidth ? e.clientX - tw - 10 : e.clientX + 16;
  tip.style.left = left+'px'; tip.style.top = Math.max(10, e.clientY - 60)+'px';
}

// ─── Comparação: selecionar séries ──────────────────────
function _tRenderCmpSelector() {
  const el = document.getElementById('trend-cmp2-selector');
  if (!el) return;

  const regionals = _tGetAllRegionals();
  const centrals  = _tGetAllCentrals();

  let html = '';
  if (regionals.length) {
    html += `<div class="tr2-cmp-group-label"><i class="ti ti-users-group"></i> Regionais</div>`;
    html += regionals.map(r => {
      const sel = _T.cmpSeries.some(s => s.name === r && s.type === 'regional');
      const colorIdx = _T.cmpSeries.findIndex(s => s.name === r && s.type === 'regional');
      const dot = sel ? `<span class="tr2-cmp-dot" style="background:${SERIES_COLORS[colorIdx]?.line || '#888'}"></span>` : '';
      return `<label class="micro-filter-option${sel?' checked':''}">
        <input type="checkbox" value="regional|${escapeHtml(r)}" ${sel?'checked':''} onchange="trendCmpToggle(this)">
        ${dot}<span class="micro-filter-option-label">${escapeHtml(r)}</span>
      </label>`;
    }).join('');
  }
  if (centrals.length) {
    html += `<div class="tr2-cmp-group-label"><i class="ti ti-building-warehouse"></i> Centrais</div>`;
    html += centrals.map(c => {
      const sel = _T.cmpSeries.some(s => s.name === c && s.type === 'central');
      const colorIdx = _T.cmpSeries.findIndex(s => s.name === c && s.type === 'central');
      const dot = sel ? `<span class="tr2-cmp-dot" style="background:${SERIES_COLORS[colorIdx]?.line || '#888'}"></span>` : '';
      return `<label class="micro-filter-option${sel?' checked':''}">
        <input type="checkbox" value="central|${escapeHtml(c)}" ${sel?'checked':''} onchange="trendCmpToggle(this)">
        ${dot}<span class="micro-filter-option-label">${escapeHtml(c)}</span>
      </label>`;
    }).join('');
  }
  el.innerHTML = html;
}

function trendCmpToggle(cb) {
  const [type, name] = cb.value.split('|');
  if (cb.checked) {
    if (_T.cmpSeries.length >= 6) { cb.checked = false; toast('Máximo de 6 séries simultâneas', 'error'); return; }
    const colorIdx = _T.cmpSeries.length;
    const weekData = _tCompute(type, name, _T.dtIni, _T.dtFim, _T.materials, _T.custoMedio);
    _T.cmpSeries.push({ type, name, label: name, color: SERIES_COLORS[colorIdx].line, weekData });
  } else {
    _T.cmpSeries = _T.cmpSeries.filter(s => !(s.name === name && s.type === type));
    // Reassign colors
    _T.cmpSeries.forEach((s, i) => s.color = SERIES_COLORS[i].line);
  }
  _tRenderCmpSelector(); // refresh dots
  _tDrawComparison();
}

function trendCmpNormalize(v) {
  _T.cmpNormalize = v;
  _tDrawComparison();
}
function trendCmpRelative(v) {
  _T.cmpRelative = v;
  _tDrawComparison();
}

function trendCmpClearAll() {
  _T.cmpSeries = [];
  _tRenderCmpSelector();
  _tDrawComparison();
}

// ═══════════════════════════════════════════════════════════
// ORQUESTRAÇÃO — refresh, abas, abertura
// ═══════════════════════════════════════════════════════════

// ── Token para cancelar refreshes obsoletos (ex: trocar período 2x rápido) ──
let _tRefreshToken = 0;

function _tRefreshAll() {
  const { type, name, dtIni, dtFim, materials } = _T;
  if (!type || !name) return;

  // Sem período selecionado → empty state em todas as abas
  if (!dtIni || !dtFim) {
    _T.weekData = []; _T.distData = []; _T.heatData = {};
    _T.heatSubEntities = []; _T.forecastVal = null; _T.custoMedio = {};
    _tRefreshTab();
    return;
  }

  // Incrementa token: qualquer callback antigo em fila vai ignorar o resultado
  const token = ++_tRefreshToken;

  // ── FASE 1 (síncrona, imediata): custo médio + overview ──────────────────
  // Essas duas são necessárias para mostrar o modal respondendo
  const centrals = _tGetCentralsList(type, name);
  _T.custoMedio  = _tBuildCustoMedio(centrals, dtIni || new Date(0), dtFim || new Date());
  _T.weekData    = _tCompute(type, name, dtIni, dtFim, materials);
  _T.forecastVal = _tForecast(_T.weekData);

  // Marca abas secundárias como "pendente" até o cálculo terminar
  _T.distData        = null;
  _T.heatData        = null;
  _T.heatSubEntities = [];

  // Renderiza a aba ativa imediatamente (overview ou outra)
  _tRefreshTab();

  // ── FASE 2 (assíncrona, background): distribuição + heatmap ──────────────
  // Divide em microtarefas para não bloquear o event loop
  const subs    = _tGetSubEntities(type, name);
  const subType = type === 'regional' ? 'central' : 'material';

  let i = 0;
  const distData = [];
  const heatData = {};

  function processNextSub() {
    if (token !== _tRefreshToken) return; // descarta se período mudou
    if (i >= subs.length) {
      // Todas as subs processadas — salva e re-renderiza se aba ativa é dist/heat
      _T.distData        = distData;
      _T.heatData        = heatData;
      _T.heatSubEntities = subs;
      if (_T.activeTab === 'dist') _tDrawDistribution();
      if (_T.activeTab === 'heat') _tDrawHeatmap();
      return;
    }

    const sub   = subs[i++];
    const wData = _tComputeSubEntity(type, name, subType, sub, dtIni, dtFim);

    // Distribuição — acumula total
    distData.push({
      name:      sub,
      variation: wData.reduce((s, w) => s + w.variation, 0),
      custo:     wData.reduce((s, w) => s + w.custo, 0),
      weeks:     wData.length,
    });

    // Heatmap — guarda série por sub-entidade
    heatData[sub] = wData;

    // Cede o event loop a cada sub para não travar a UI
    setTimeout(processNextSub, 0);
  }

  // Inicia o pipeline com um pequeno atraso para garantir que o modal pintou
  setTimeout(processNextSub, 16);

  // ── FASE 3 (assíncrona): séries de comparação ────────────────────────────
  if (_T.cmpSeries.length) {
    setTimeout(() => {
      if (token !== _tRefreshToken) return;
      _T.cmpSeries.forEach(s => {
        s.weekData = _tCompute(s.type, s.name, dtIni, dtFim, materials, _T.custoMedio);
      });
      if (_T.activeTab === 'comparison') _tDrawComparison();
    }, 0);
  }
}

function _tRefreshTab() {
  const tab = _T.activeTab;
  // Always hide selection bar when switching tabs
  if (tab !== 'overview') {
    const bar = document.getElementById('trend-selection-bar');
    if (bar) bar.style.display = 'none';
    _tHideTooltip();
  }
  // Hide/show canvas elements
  document.getElementById('trend-overview-panel').style.display = tab === 'overview'  ? '' : 'none';
  document.getElementById('trend-dist-panel').style.display     = tab === 'dist'       ? '' : 'none';
  document.getElementById('trend-heat-panel').style.display     = tab === 'heat'       ? '' : 'none';
  document.getElementById('trend-cmp2-panel').style.display     = tab === 'comparison' ? '' : 'none';

  // Sem período → empty state em todas as abas
  if (!_T.dtIni || !_T.dtFim) {
    const emptyHtml = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                  padding:52px 24px;gap:10px;color:var(--text3);font-family:var(--mono)">
        <i class="ti ti-calendar-search" style="font-size:32px;opacity:.4"></i>
        <div style="font-size:13px;font-weight:500;color:var(--text2)">Nenhum período selecionado</div>
        <div style="font-size:11px;line-height:1.6;text-align:center;max-width:320px">
          Selecione um período no topo do modal e clique em <strong>Aplicar período</strong> para gerar o relatório.
        </div>
      </div>`;
    if (tab === 'overview') {
      // Canvas: empty state desenhado
      _tSizeCanvas();
      _tDrawEmptyState();
      _tRenderKPIs();
    } else {
      // Demais abas: HTML simples no wrap
      const wrapIds = { dist: 'trend-dist-wrap', heat: 'trend-heat-wrap', comparison: 'trend-cmp2-wrap' };
      const wrapEl = document.getElementById(wrapIds[tab]);
      if (wrapEl) wrapEl.innerHTML = emptyHtml;
    }
    return;
  }

  if (tab === 'overview')  { _tDrawOverview(); _tRenderKPIs(); _tRenderOverviewLegend(); }
  if (tab === 'dist')      { _tDrawDistribution(); }
  if (tab === 'heat')      { _tDrawHeatmap(); }
  if (tab === 'comparison'){ _tRenderCmpSelector(); _tDrawComparison(); }
}

function trendSwitchTab(tab) {
  _T.activeTab = tab;
  document.querySelectorAll('.tr2-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  _tRefreshTab();
}

// ── Material filter ──────────────────────────────────────
function trendToggleMatDropdown() {
  const dd = document.getElementById('trend-mat-dropdown');
  const chev = document.getElementById('trend-mat-chev');
  const btn  = document.getElementById('trend-mat-trigger');
  const open = dd?.classList.contains('open');
  dd?.classList.toggle('open', !open);
  if (chev) chev.style.transform = open ? '' : 'rotate(180deg)';
  btn?.classList.toggle('open', !open);
}
function trendCloseMatDropdown() {
  document.getElementById('trend-mat-dropdown')?.classList.remove('open');
  const chev = document.getElementById('trend-mat-chev');
  if (chev) chev.style.transform = '';
  document.getElementById('trend-mat-trigger')?.classList.remove('open');
  _tApplyMatFilter();
}
function trendClearMatFilter() {
  document.querySelectorAll('#trend-mat-options input').forEach(cb => cb.checked = false);
}
function trendFilterMatSearch(q) {
  document.querySelectorAll('#trend-mat-options .micro-filter-option').forEach(opt => {
    opt.style.display = opt.textContent.toLowerCase().includes(q.toLowerCase()) ? '' : 'none';
  });
}
// ── Filtro de Centrais (apenas para regionais) ──────────────────────────
function trendToggleCenDropdown() {
  const dd   = document.getElementById('trend-cen-dropdown');
  const chev = document.getElementById('trend-cen-chev');
  const btn  = document.getElementById('trend-cen-trigger');
  const open = dd?.classList.contains('open');
  dd?.classList.toggle('open', !open);
  if (chev) chev.style.transform = open ? '' : 'rotate(180deg)';
  btn?.classList.toggle('open', !open);
}
function trendCloseCenDropdown() {
  document.getElementById('trend-cen-dropdown')?.classList.remove('open');
  const chev = document.getElementById('trend-cen-chev');
  if (chev) chev.style.transform = '';
  document.getElementById('trend-cen-trigger')?.classList.remove('open');
  _tApplyCenFilter();
}
function trendClearCenFilter() {
  document.querySelectorAll('#trend-cen-options input').forEach(cb => cb.checked = false);
}
function trendFilterCenSearch(q) {
  document.querySelectorAll('#trend-cen-options .micro-filter-option').forEach(opt => {
    opt.style.display = opt.textContent.toLowerCase().includes(q.toLowerCase()) ? '' : 'none';
  });
}
function _tApplyCenFilter() {
  const checked = [...document.querySelectorAll('#trend-cen-options input:checked')].map(cb => cb.value);
  _T.centrals = !checked.length || checked.length === _T.allCentrals.length ? null : new Set(checked);
  const lbl = document.getElementById('trend-cen-trigger-label');
  const cnt = document.getElementById('trend-cen-count');
  const btn = document.getElementById('trend-cen-trigger');
  const n   = _T.centrals ? _T.centrals.size : _T.allCentrals.length;
  if (lbl) lbl.textContent = _T.centrals ? `${n} centrais` : 'Todas';
  if (cnt) cnt.textContent = `(${n}/${_T.allCentrals.length})`;
  btn?.classList.toggle('active', !!_T.centrals);
  // Recalcula allMats com base nas centrais selecionadas
  _T.allMats = _tGetAllMaterials(_T.type, _T.name);
  _tRenderMatOptions();
  const matCnt = document.getElementById('trend-mat-count');
  if (matCnt) matCnt.textContent = `(${_T.allMats.length}/${_T.allMats.length})`;
  _T.materials = null; // reset filtro de materiais ao mudar centrais
  document.getElementById('trend-mat-trigger-label') && (document.getElementById('trend-mat-trigger-label').textContent = 'Todos');
  document.getElementById('trend-mat-trigger')?.classList.remove('active');
  _tRefreshAll();
}
function _tRenderCenOptions() {
  const el = document.getElementById('trend-cen-options');
  if (!el) return;
  el.innerHTML = (_T.allCentrals || []).map(c => {
    const ch = !_T.centrals || _T.centrals.has(c) ? 'checked' : '';
    return `<label class="micro-filter-option"><input type="checkbox" value="${escapeHtml(c)}" ${ch}><span class="micro-filter-option-label">${escapeHtml(c)}</span></label>`;
  }).join('');
}

function _tApplyMatFilter() {
  const checked = [...document.querySelectorAll('#trend-mat-options input:checked')].map(cb => cb.value);
  _T.materials = !checked.length || checked.length === _T.allMats.length ? null : new Set(checked);
  const lbl = document.getElementById('trend-mat-trigger-label');
  const cnt = document.getElementById('trend-mat-count');
  const btn = document.getElementById('trend-mat-trigger');
  const n   = _T.materials ? _T.materials.size : _T.allMats.length;
  if (lbl) lbl.textContent = _T.materials ? `${n} materiais` : 'Todos';
  if (cnt) cnt.textContent = `(${n}/${_T.allMats.length})`;
  btn?.classList.toggle('active', !!_T.materials);
  _tRefreshAll();
}
function _tRenderMatOptions() {
  const el = document.getElementById('trend-mat-options');
  if (!el) return;
  el.innerHTML = _T.allMats.map(m => {
    const ch = !_T.materials || _T.materials.has(m) ? 'checked' : '';
    return `<label class="micro-filter-option"><input type="checkbox" value="${escapeHtml(m)}" ${ch}><span class="micro-filter-option-label">${escapeHtml(m)}</span></label>`;
  }).join('');
}

// ── Period callback ──────────────────────────────────────
// ── Atalhos de período predefinido ───────────────────────
// Calcula datas do preset, chama trendOnPeriodSet e marca o botão ativo.
function trendSetPreset(preset) {
  const hoje = new Date();
  hoje.setHours(23, 59, 59, 999);
  let dtIni;

  if (preset === 'mes') {
    dtIni = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  } else if (preset === 'bimestre') {
    // 2 meses atrás, dia 1
    const m = hoje.getMonth();
    dtIni = new Date(hoje.getFullYear(), m - 1, 1);
  } else if (preset === 'trimestre') {
    const m = hoje.getMonth();
    dtIni = new Date(hoje.getFullYear(), m - 2, 1);
  } else if (preset === 'ano') {
    dtIni = new Date(hoje.getFullYear(), 0, 1);
  } else {
    return;
  }

  dtIni.setHours(0, 0, 0, 0);
  _tMarkPreset(preset);
  trendOnPeriodSet(dtIni, hoje, true);
}

// Marca visualmente o preset ativo, desmarca os demais
function _tMarkPreset(preset) {
  ['mes','bimestre','trimestre','ano'].forEach(p => {
    document.getElementById(`trend-preset-${p}`)?.classList.toggle('active', p === preset);
  });
}

function trendOnPeriodSet(dtIni, dtFim, fromPreset) {
  const si = _tNextTue(dtIni), sf = _tPrevTue(dtFim);
  if (sf <= si) sf.setDate(sf.getDate()+7);
  _T.dtIni = si; _T.dtFim = sf;
  const fmt = d => d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'});
  const lbl = document.getElementById('trend-cal-label');
  if (lbl) lbl.textContent = `${fmt(si)} → ${fmt(sf)}`;
  // Cal-picker manual → desmarca qualquer preset ativo
  if (!fromPreset) _tMarkPreset(null);
  _tRefreshAll();
}

// ── Wire canvas events ────────────────────────────────────
function _tWireCanvas() {
  const ov = document.getElementById('trend-canvas');
  if (ov) {
    _tSizeCanvas(); // dimensiona UMA vez aqui, mousemove nunca redimensiona
    ov.onmousedown  = _tOnMouseDown;
    ov.onmousemove  = _tOnMouseMove;
    ov.onmouseup    = _tOnMouseUp;
    ov.onmouseleave = _tOnMouseLeave;
  }
  const dist = document.getElementById('trend-dist-canvas');
  if (dist) {
    dist.onmousemove = _tDistTooltipShow;
    dist.onmouseleave = _tHideTooltip;
  }
  const heat = document.getElementById('trend-heat-canvas');
  if (heat) {
    heat.onmousemove = _tHeatTooltip;
    heat.onmouseleave = () => { _tHideTooltip(); _T.heatHover = null; };
  }
  const cmp2 = document.getElementById('trend-cmp2-canvas');
  if (cmp2) {
    cmp2.onmousemove = _tCmpTooltipShow;
    cmp2.onmouseleave = _tHideTooltip;
  }
}

// ── Close dropdowns on outside click ─────────────────────
document.addEventListener('click', e => {
  const cenWrap = document.getElementById('trend-cen-wrap');
  const cenDd   = document.getElementById('trend-cen-dropdown');
  if (cenDd?.classList.contains('open') && cenWrap && !cenWrap.contains(e.target)) {
    cenDd.classList.remove('open');
    const chev = document.getElementById('trend-cen-chev');
    if (chev) chev.style.transform = '';
    document.getElementById('trend-cen-trigger')?.classList.remove('open');
    _tApplyCenFilter();
  }
  const matWrap = document.getElementById('trend-mat-wrap');
  const matDd   = document.getElementById('trend-mat-dropdown');
  if (matDd?.classList.contains('open') && matWrap && !matWrap.contains(e.target)) {
    matDd.classList.remove('open');
    const chev = document.getElementById('trend-mat-chev');
    if (chev) chev.style.transform = '';
    document.getElementById('trend-mat-trigger')?.classList.remove('open');
    _tApplyMatFilter();
  }
  const cmpSelWrap = document.getElementById('trend-cmp2-sel-wrap');
  const cmpSelDd   = document.getElementById('trend-cmp2-sel-dropdown');
  if (cmpSelDd?.classList.contains('open') && cmpSelWrap && !cmpSelWrap.contains(e.target)) {
    cmpSelDd.classList.remove('open');
    document.getElementById('trend-cmp2-sel-chev')?.style && (document.getElementById('trend-cmp2-sel-chev').style.transform = '');
    document.getElementById('trend-cmp2-sel-trigger')?.classList.remove('open');
  }
});

// ── Open modal ────────────────────────────────────────────
function openTrendModal(type, name) {
  const titleEl = document.getElementById('trend-modal-title');
  const subEl   = document.getElementById('trend-modal-sub');
  if (titleEl) titleEl.innerHTML = `<i class="ti ti-chart-area-line"></i> ${escapeHtml(name)}`;
  if (subEl)   subEl.textContent = `${type==='central'?'Central':'Regional'} · relatório interativo de variação`;

  const allMats = _tGetAllMaterials(type, name);

  _T = {
    ..._T,
    type, name,
    dtIni: null, dtFim: null,
    centrals: null, allCentrals: _tGetCentralsList(type, name),
    splitMode: false,
    materials: null, allMats,
    activeTab: 'overview',
    weekData: [], distData: [], heatData: {}, heatSubEntities: [], heatHover: null,
    cmpSeries: [], cmpNormalize: false, cmpRelative: false,
    sel: null, dragging: false, hoverIdx: -1,
    forecastVal: null,
    custoMedio: {},
  };

  // Resetar o cal-picker sem período pré-selecionado
  const calTriggerLbl = document.getElementById('trend-cal-label');
  if (calTriggerLbl) calTriggerLbl.textContent = 'Selecionar período';
  document.getElementById('trend-cal-trigger')?.classList.remove('has-value');
  document.getElementById('trend-dt-ini') && (document.getElementById('trend-dt-ini').value = '');
  document.getElementById('trend-dt-fim') && (document.getElementById('trend-dt-fim').value = '');

  // Reset tabs UI
  trendSwitchTab('overview');

  // Reset selection bar
  const bar = document.getElementById('trend-selection-bar');
  if (bar) bar.style.display = 'none';

  // Reset atalhos de período
  _tMarkPreset(null);

  // Reset modo separado
  _tResetSplitMode();

  // Mostrar/esconder filtro de centrais conforme tipo
  const cenGroup = document.getElementById('trend-cen-group');
  const cenSep   = document.getElementById('trend-cen-sep');
  const isReg    = type === 'regional';
  if (cenGroup) cenGroup.style.display = isReg ? '' : 'none';
  if (cenSep)   cenSep.style.display   = isReg ? '' : 'none';

  // Render central options (só para regionais)
  if (isReg) {
    _tRenderCenOptions();
    const cenCnt = document.getElementById('trend-cen-count');
    const cenLbl = document.getElementById('trend-cen-trigger-label');
    const allCen = _T.allCentrals;
    if (cenCnt) cenCnt.textContent = `(${allCen.length}/${allCen.length})`;
    if (cenLbl) cenLbl.textContent = 'Todas';
    document.getElementById('trend-cen-trigger')?.classList.remove('active');
  }

  // Render material options
  _tRenderMatOptions();
  const cnt = document.getElementById('trend-mat-count');
  if (cnt) cnt.textContent = `(${allMats.length}/${allMats.length})`;
  const lbl = document.getElementById('trend-mat-trigger-label');
  if (lbl) lbl.textContent = 'Todos';
  document.getElementById('trend-mat-trigger')?.classList.remove('active');

  // Adjust subtitle based on type
  const distLabel = document.getElementById('trend-dist-subtitle');
  if (distLabel) distLabel.textContent = type === 'regional' ? 'por central' : 'por material';
  const heatLabel = document.getElementById('trend-heat-subtitle');
  if (heatLabel) heatLabel.textContent = type === 'regional' ? 'centrais × semanas' : 'materiais × semanas';

  openModal('modal-trend');
  // Limpa dimensões salvas do canvas para forçar novo sizing após abertura
  const cv = document.getElementById('trend-canvas');
  if (cv) { cv._W0 = 0; cv._H0 = 0; }
  // Abre o modal imediatamente, depois de 2 frames (garantia de paint) inicia cálculos
  requestAnimationFrame(() => requestAnimationFrame(() => {
    _tSizeCanvas();
    _tRefreshAll();
    _tWireCanvas();
  }));
}

window.addEventListener('resize', () => {
  if (document.getElementById('modal-trend')?.classList.contains('open')) {
    _tSizeCanvas(); // redimensiona canvas antes de redesenhar
    _tRefreshTab();
  }
});

Object.assign(window, {
  openTrendModal, trendOnPeriodSet, trendSetPreset, trendToggleSplitMode,
  trendSwitchTab,
  trendToggleMatDropdown, trendCloseMatDropdown, trendClearMatFilter, trendFilterMatSearch,
  trendToggleCenDropdown, trendCloseCenDropdown, trendClearCenFilter, trendFilterCenSearch,
  trendClearSelection,
  trendDistSort,
  trendCmpToggle, trendCmpNormalize, trendCmpRelative, trendCmpClearAll,
  // Manter compatibilidade com chamadas antigas que possam existir
  trendCmpSwitchTab: () => {}, trendCmpApply: () => {}, trendCmpClear: () => {},
  trendCmpSelectEntity: () => {}, trendCmpFilterSearch: () => {}, trendToggleCmpDropdown: () => {},
  trendCmpOnPeriodSet: () => {},
});
