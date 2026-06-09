// ═══════════════════════════════════════════════════════════
// GRÁFICO DE TENDÊNCIA — Google Finance style
// Linha + área · comparador · seleção por arrastar
// ═══════════════════════════════════════════════════════════

let _T = {
  type: null, name: null,
  dtIni: null, dtFim: null,
  materials: null, allMats: [],
  cmpMode: null, cmpEntity: null,
  cmpDtIni: null, cmpDtFim: null,
  cmpTab: 'entity',
  sel: null,
  dragging: false, dragStartIdx: null,
  hoverIdx: -1,
  weekData: [], cmpWeekData: [],
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
  const end   = _tPrevTue(dtFim || new Date());
  const start = dtIni ? _tNextTue(dtIni) : (() => { const d = new Date(end); d.setMonth(d.getMonth()-3); return _tNextTue(d); })();
  const weeks = []; let w = new Date(start);
  while (w <= end) {
    const wEnd = new Date(w); wEnd.setDate(wEnd.getDate() + 6);
    if (wEnd > end) break;
    weeks.push({ start: new Date(w), end: new Date(wEnd) });
    w = new Date(wEnd); w.setDate(w.getDate() + 1);
  }
  return weeks;
}

// ── Data ─────────────────────────────────────────────────
function _tGetCentralsList(type, name) {
  // Returns array of normalized central aliases for a regional, or single central name
  if (type === 'central') return [name];
  return (state.filiais||[])
    .filter(f => normalizeText(f.regional||'') === normalizeText(name))
    .map(f => f.alias || f.origem || '')
    .filter(Boolean);
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

// Build custo médio per material — same priority as analitico.js:
// 1st: saídas, 2nd: lançamentos, 3rd: SAP
function _tBuildCustoMedio(centrals, dtIni, dtFim) {
  const inPeriod = d => { if (!d) return false; return d >= dtIni && d <= dtFim; };
  const custoPorMat = {}, pesoPorMat = {};

  // 1. Saídas
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

  // 2. Lançamentos (fill gaps)
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

// Compute variation per week using buildSnapshot — same logic as analitico.js
function _tCompute(type, name, dtIni, dtFim, selMats) {
  const weeks   = _tBuildWeeks(dtIni, dtFim);
  const centrals = _tGetCentralsList(type, name);
  const custoMedio = _T.custoMedio;

  // Get all materials for these centrals
  const allMats = selMats
    ? [...selMats]
    : _tGetAllMaterials(type, name);

  return weeks.map(({ start, end }) => {
    const sk = _tDK(start), ek = _tDK(end);

    let totalDiff = 0, totalCusto = 0;
    let totalRealKg = 0, totalTeoricoKg = 0;

    centrals.forEach(central => {
      allMats.forEach(material => {
        // getLancIndex already built — use it directly
        const { byCentralMat } = getLancIndex();
        const matMap = byCentralMat.get(central);
        const lancsAll = matMap?.get(material) || [];

        // Lancs in this week
        const lancsWeek = lancsAll.filter(l => {
          const d = parseDate(l.dtLanc);
          if (!d) return false;
          const dk = _tDK(d);
          return dk >= sk && dk <= ek;
        });
        if (!lancsWeek.length) return;

        // SAP in this week for this central+material
        const sapWeek = (state.sap||[]).filter(s => {
          if (normalizeText(s.central||'') !== normalizeText(central)) return false;
          if (normalizeText(s.material||'') !== normalizeText(material)) return false;
          const d = parseDate(s.dtLanc);
          if (!d) return false;
          const dk = _tDK(d);
          return dk >= sk && dk <= ek;
        });

        // Pre-period stock (day before week start)
        const preStock = getPrePeriodLaunchStock({ central, material, dtIni: start });
        // End stock (last non-sunday day of week)
        const endStock = getLastPeriodLaunchStock({ central, material, dtFim: end });

        const snap = buildSnapshot({
          lancs: lancsWeek,
          sap:   sapWeek,
          initialStockOverride: preStock?.value ?? null,
          finalStockOverride:   endStock?.missing ? null : endStock?.value,
        });

        totalDiff      += snap.diff;
        totalRealKg    += snap.pesoFim;
        totalTeoricoKg += snap.estTeorico;

        // Cost: diff × custo médio do material
        const cm = custoMedio[material];
        if (cm && Number.isFinite(snap.diff)) totalCusto += snap.diff * cm;
      });
    });

    return {
      label: `${start.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})}`,
      startDate: start, endDate: end,
      variation: totalDiff,
      realKg:    totalRealKg,
      teorKg:    totalTeoricoKg,
      custo:     totalCusto,
    };
  });
}
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

// ── Format ───────────────────────────────────────────────
function _tFmtK(v) {
  const a = Math.abs(v);
  if (a>=1e6) return (v/1e6).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'M';
  if (a>=1e3) return (v/1e3).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'K';
  return v.toLocaleString('pt-BR',{maximumFractionDigits:0});
}

// ── DRAW — Google Finance style ───────────────────────────
function _tDraw() {
  const canvas = document.getElementById('trend-canvas');
  const wrap   = document.getElementById('trend-chart-wrap');
  if (!canvas || !wrap) return;

  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const W0  = wrap.clientWidth  || 760;
  const H0  = wrap.clientHeight || 300;
  canvas.width  = W0 * DPR; canvas.height = H0 * DPR;
  canvas.style.width  = W0 + 'px'; canvas.style.height = H0 + 'px';

  const ctx = canvas.getContext('2d'); ctx.scale(DPR, DPR);
  const W = W0, H = H0;
  const PAD = { top: 20, right: 72, bottom: 36, left: 14 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top  - PAD.bottom;

  const S = getComputedStyle(document.documentElement);
  const isDark = document.body.classList.contains('theme-dark') || !document.body.classList.contains('theme-light');

  const C = {
    line:    '#e8666a',
    lineCmp: '#8b5cf6',
    lineFc:  '#f59e0b',
    areaTop: isDark ? 'rgba(232,102,106,0.35)' : 'rgba(232,102,106,0.25)',
    areaBot: 'rgba(232,102,106,0)',
    grid:    isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    refLine: isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)',
    axis:    isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)',
    bg:      S.getPropertyValue('--bg2').trim(),
    selFill: 'rgba(59,130,246,0.10)',
    selLine: 'rgba(59,130,246,0.6)',
    dot:     '#60a5fa',
    tooltip: isDark ? '#1e2129' : '#ffffff',
    green:   '#22c55e',
    red:     '#ef4444',
  };

  ctx.clearRect(0, 0, W, H);

  const primary = _T.weekData;
  const cmp     = _T.cmpWeekData;
  const n = primary.length;

  if (!n) {
    ctx.fillStyle = C.axis; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Sem dados para o período', W/2, H/2); return;
  }

  const vals   = primary.map(w => w.variation);
  const cmpVals = cmp.map(w => w.variation);
  const fcast  = _tForecast(primary);
  const allV   = [...vals, ...(fcast!=null?[fcast]:[]), ...cmpVals];
  const maxV   = Math.max(...allV.map(Math.abs), 1);
  const range  = maxV * 1.28;

  // coordinate helpers
  const xP = i => PAD.left + (i / (n - 1 || 1)) * cW;
  const yP = v  => PAD.top + cH * (1 - (v + range) / (range * 2));
  const yZ = yP(0);
  const refVal = vals[0]; // first point as "previous close" reference

  // ── Subtle horizontal grid ──────────────────────────────
  const gridN = 4;
  for (let i = 0; i <= gridN; i++) {
    const y = PAD.top + (cH * i / gridN);
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
  }

  // ── Reference line (first week value, like "prev close") ──
  const yRef = yP(refVal);
  ctx.setLineDash([3, 5]); ctx.strokeStyle = C.refLine; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD.left, yRef); ctx.lineTo(PAD.left + cW, yRef); ctx.stroke();
  ctx.setLineDash([]);
  // Label on right
  ctx.fillStyle = C.axis; ctx.font = '10px monospace'; ctx.textAlign = 'left';
  ctx.fillText(_tFmtK(refVal), PAD.left + cW + 5, yRef + 3);

  // ── Selection highlight ─────────────────────────────────
  if (_T.sel) {
    const { i0, i1 } = _T.sel;
    const x0 = xP(i0), x1 = xP(i1);
    ctx.fillStyle = C.selFill;
    ctx.fillRect(x0, PAD.top, x1 - x0, cH);
    // Vertical markers
    [x0, x1].forEach(x => {
      ctx.strokeStyle = C.selLine; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, PAD.top + cH); ctx.stroke();
      // Selection dot
      const idx = x === x0 ? i0 : i1;
      const yv  = yP(vals[idx]);
      ctx.beginPath(); ctx.arc(x, yv, 5, 0, Math.PI*2);
      ctx.fillStyle = C.dot; ctx.fill();
      ctx.strokeStyle = C.bg; ctx.lineWidth = 2; ctx.stroke();
    });
  }

  // ── Draw series function ─────────────────────────────────
  const drawSeries = (seriesVals, lineColor, areaTop, areaBot) => {
    const sn = seriesVals.length;
    if (!sn) return;

    // Area gradient
    const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH);
    grad.addColorStop(0, areaTop); grad.addColorStop(1, areaBot);
    ctx.beginPath();
    ctx.moveTo(xP(0), yZ);
    seriesVals.forEach((v, i) => ctx.lineTo(xP(i * (n-1) / (sn-1 || 1)), yP(v)));
    ctx.lineTo(xP(n-1), yZ); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    // Line — smooth with bezier
    ctx.strokeStyle = lineColor; ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    seriesVals.forEach((v, i) => {
      const x = xP(i * (n-1) / (sn-1 || 1)), y = yP(v);
      if (i === 0) { ctx.moveTo(x, y); return; }
      // Smooth bezier
      const px = xP((i-1) * (n-1) / (sn-1 || 1)), py = yP(seriesVals[i-1]);
      const cpx = (px + x) / 2;
      ctx.bezierCurveTo(cpx, py, cpx, y, x, y);
    });
    ctx.stroke();
  };

  // Primary
  drawSeries(vals, C.line, C.areaTop, C.areaBot);
  // Comparison
  if (cmpVals.length) {
    drawSeries(cmpVals, C.lineCmp, 'rgba(139,92,246,0.18)', 'rgba(139,92,246,0)');
  }

  // ── Forecast dashed extension ───────────────────────────
  if (fcast != null) {
    const lastX = xP(n-1), lastY = yP(vals[n-1]);
    const fcX   = lastX + cW / (n > 1 ? n-1 : 1);
    const fcY   = yP(fcast);
    ctx.setLineDash([5, 4]); ctx.strokeStyle = C.lineFc; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.lineTo(fcX, fcY); ctx.stroke();
    ctx.setLineDash([]);
    // Forecast dot
    ctx.beginPath(); ctx.arc(fcX, fcY, 4, 0, Math.PI*2);
    ctx.fillStyle = C.lineFc; ctx.fill();
    ctx.strokeStyle = C.bg; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = C.lineFc; ctx.font = '9px monospace'; ctx.textAlign = 'left';
    ctx.fillText('Prev.', fcX + 5, fcY + 3);
  }

  // ── Hover crosshair + dot ───────────────────────────────
  if (_T.hoverIdx >= 0 && _T.hoverIdx < n) {
    const hx = xP(_T.hoverIdx), hy = yP(vals[_T.hoverIdx]);
    // Vertical crosshair
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(hx, PAD.top); ctx.lineTo(hx, PAD.top + cH); ctx.stroke();
    // Dot on line
    ctx.beginPath(); ctx.arc(hx, hy, 4.5, 0, Math.PI*2);
    ctx.fillStyle = C.line; ctx.fill();
    ctx.strokeStyle = C.bg; ctx.lineWidth = 2; ctx.stroke();
    // Comparison dot
    if (cmpVals[_T.hoverIdx] != null) {
      const cy = yP(cmpVals[_T.hoverIdx]);
      ctx.beginPath(); ctx.arc(hx, cy, 4, 0, Math.PI*2);
      ctx.fillStyle = C.lineCmp; ctx.fill();
      ctx.strokeStyle = C.bg; ctx.lineWidth = 2; ctx.stroke();
    }
  }

  // ── Y axis labels (right side) ──────────────────────────
  for (let i = 0; i <= gridN; i++) {
    const v = range - (range * 2 * i / gridN);
    const y = PAD.top + (cH * i / gridN);
    ctx.fillStyle = C.axis; ctx.font = '10px monospace'; ctx.textAlign = 'left';
    ctx.fillText(_tFmtK(v), PAD.left + cW + 5, y + 3);
  }

  // ── X axis labels ───────────────────────────────────────
  const step = n > 24 ? Math.ceil(n/8) : n > 12 ? 2 : 1;
  ctx.fillStyle = C.axis; ctx.font = '10px monospace'; ctx.textAlign = 'center';
  primary.forEach((w, i) => {
    if (i % step !== 0 && i !== n-1) return;
    ctx.fillText(w.label, xP(i), PAD.top + cH + 18);
  });

  // Store metadata for interaction
  canvas._meta = { xP, yP, PAD, cW, cH, n, C, W, H };
}

// ── Interaction ──────────────────────────────────────────
function _tEvtIdx(e) {
  const canvas = e.target;
  const rect   = canvas.getBoundingClientRect();
  const mx     = (e.clientX - rect.left);
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
  const idx = _tEvtIdx(e);
  if (idx < 0) return;
  _T.dragging = true; _T.dragStartIdx = idx;
  _T.sel = { i0: idx, i1: idx };
  _tDraw();
}

function _tOnMouseMove(e) {
  const idx = _tEvtIdx(e);
  if (idx < 0) {
    if (_T.hoverIdx !== -1) { _T.hoverIdx = -1; _tDraw(); }
    _tHideTooltip(); return;
  }

  if (_T.dragging) {
    _T.sel = { i0: Math.min(_T.dragStartIdx, idx), i1: Math.max(_T.dragStartIdx, idx) };
    _T.hoverIdx = -1;
    _tDraw();
    _tShowSelBar();
    return;
  }

  // Hover
  if (!_T.sel) {
    if (_T.hoverIdx !== idx) { _T.hoverIdx = idx; _tDraw(); }
    _tShowTooltip(e, idx);
  }
}

function _tOnMouseUp() {
  if (_T.dragging) { _T.dragging = false; _tShowSelBar(); }
}
function _tOnMouseLeave() {
  _tHideTooltip();
  if (!_T.dragging) { _T.hoverIdx = -1; _tDraw(); }
  _T.dragging = false;
}

// ── Tooltip ───────────────────────────────────────────────
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

  const sign = w.variation >= 0 ? '+' : '';
  const col  = w.variation >= 0 ? '#22c55e' : '#ef4444';
  const cW2  = _T.cmpWeekData[idx];
  let cmpHtml = '';
  if (cW2) {
    const cs = cW2.variation >= 0 ? '+' : '', cc = cW2.variation >= 0 ? '#8b5cf6' : '#ef4444';
    cmpHtml = `<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px;font-size:11px">
      <span style="color:var(--text3)">${_T.cmpEntity?.name || 'Comparação'}:</span>
      <strong style="color:${cc}"> ${cs}${cW2.variation.toLocaleString('pt-BR',{maximumFractionDigits:0})} kg</strong></div>`;
  }
  tip.innerHTML = `
    <div style="font-weight:700;color:var(--text);margin-bottom:5px;font-size:12px">${w.label}</div>
    <div style="color:var(--text3);margin-bottom:2px">Real: <strong style="color:var(--text)">${w.realKg.toLocaleString('pt-BR',{maximumFractionDigits:0})} kg</strong></div>
    <div style="color:var(--text3);margin-bottom:5px">Teórico: <strong style="color:var(--text)">${w.teorKg.toLocaleString('pt-BR',{maximumFractionDigits:0})} kg</strong></div>
    <div style="font-size:14px;font-weight:700;color:${col}">${sign}${w.variation.toLocaleString('pt-BR',{maximumFractionDigits:0})} kg</div>
    ${cmpHtml}`;
  tip.style.display = 'block';
  const tw = 190;
  const left = e.clientX + 16 + tw > window.innerWidth ? e.clientX - tw - 10 : e.clientX + 16;
  tip.style.left = left + 'px';
  tip.style.top  = Math.max(10, e.clientY - 70) + 'px';
}
function _tHideTooltip() {
  const tip = document.getElementById('trend-tooltip');
  if (tip) tip.style.display = 'none';
}

// ── Selection bar ─────────────────────────────────────────
function _tShowSelBar() {
  if (!_T.sel) return;
  const { i0, i1 } = _T.sel;
  const sliced = _T.weekData.slice(i0, i1+1); if (!sliced.length) return;
  const totalVar  = sliced.reduce((s,w) => s + w.variation, 0);
  const totalCost = sliced.reduce((s,w) => s + w.custo, 0);
  const d0 = sliced[0].startDate, d1 = sliced[sliced.length-1].endDate;
  const fmt = d => d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit'});
  const sign = totalVar >= 0 ? '+' : '';
  const col  = totalVar >= 0 ? '#22c55e' : '#ef4444';
  const bar = document.getElementById('trend-selection-bar');
  bar.style.display = 'flex';
  document.getElementById('trend-sel-range').textContent  = `${fmt(d0)} → ${fmt(d1)}  (${sliced.length} sem.)`;
  document.getElementById('trend-sel-var').innerHTML   = `<span style="color:${col}">${sign}${totalVar.toLocaleString('pt-BR',{maximumFractionDigits:0})} kg</span>`;
  document.getElementById('trend-sel-cost').innerHTML  = `<span style="color:#f59e0b">R$ ${Math.abs(totalCost).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>`;
}

function trendClearSelection() {
  _T.sel = null; _T.hoverIdx = -1;
  document.getElementById('trend-selection-bar').style.display = 'none';
  _tDraw();
}

// ── Legend & stats ────────────────────────────────────────
function _tRenderLegend() {
  const el = document.getElementById('trend-legend');
  const st = document.getElementById('trend-stats');
  if (!el) return;
  const data = _T.weekData, n = data.length;
  const fcast = _tForecast(data);
  const trend = n >= 2 ? data[n-1].variation - data[n-2].variation : 0;
  const totalVar = data.reduce((s,w) => s + w.variation, 0);

  el.innerHTML = `
    <span class="trend-legend-item">
      <span style="display:inline-block;width:20px;height:3px;background:#e8666a;border-radius:2px;vertical-align:middle;margin-right:5px"></span>
      ${_T.name || 'Principal'}
    </span>
    ${_T.cmpWeekData.length ? `<span class="trend-legend-item">
      <span style="display:inline-block;width:20px;height:3px;background:#8b5cf6;border-radius:2px;vertical-align:middle;margin-right:5px"></span>
      ${_T.cmpEntity ? _T.cmpEntity.name : 'Período ant.'}
    </span>` : ''}
    <span class="trend-legend-item">
      <span style="display:inline-block;width:20px;height:0;border-top:2px dashed #f59e0b;vertical-align:middle;margin-right:5px"></span>
      Prev.: <strong style="color:#f59e0b">${fcast != null ? (fcast>=0?'+':'')+fcast.toLocaleString('pt-BR',{maximumFractionDigits:0})+' kg' : '—'}</strong>
    </span>
    <span class="trend-legend-item" style="color:${trend<=0?'#ef4444':'#22c55e'}">
      <i class="ti ti-trending-${trend<=0?'down':'up'}"></i>
      ${trend<=0?'Piorando':'Melhorando'}
    </span>`;

  if (st) st.innerHTML = `
    <span class="trend-stat-item">Acumulado: <strong style="color:${totalVar>=0?'#22c55e':'#ef4444'}">${totalVar>=0?'+':''}${totalVar.toLocaleString('pt-BR',{maximumFractionDigits:0})} kg</strong></span>
    <span class="trend-stat-item">Semanas: <strong>${n}</strong></span>`;
}

// ── Refresh ───────────────────────────────────────────────
function _tRefresh() {
  const { type, name, dtIni, dtFim, materials } = _T;
  if (!type || !name) return;

  // Build custo médio once using full period range
  const centrals = _tGetCentralsList(type, name);
  _T.custoMedio = _tBuildCustoMedio(centrals, dtIni || new Date(0), dtFim || new Date());

  _T.weekData = _tCompute(type, name, dtIni, dtFim, materials);

  if (_T.cmpMode === 'entity' && _T.cmpEntity) {
    _T.cmpWeekData = _tCompute(_T.cmpEntity.type, _T.cmpEntity.name, dtIni, dtFim, materials);
  } else if (_T.cmpMode === 'period' && _T.cmpDtIni && _T.cmpDtFim) {
    _T.cmpWeekData = _tCompute(type, name, _T.cmpDtIni, _T.cmpDtFim, materials);
  } else {
    _T.cmpWeekData = [];
  }
  _T.sel = null; _T.hoverIdx = -1;
  document.getElementById('trend-selection-bar').style.display = 'none';
  _tDraw();
  _tRenderLegend();
}

// ── Wire canvas events ────────────────────────────────────
function _tWireCanvas() {
  const canvas = document.getElementById('trend-canvas');
  if (!canvas) return;
  canvas.onmousedown  = _tOnMouseDown;
  canvas.onmousemove  = _tOnMouseMove;
  canvas.onmouseup    = _tOnMouseUp;
  canvas.onmouseleave = _tOnMouseLeave;
}

// ── Period ────────────────────────────────────────────────
function trendOnPeriodSet(dtIni, dtFim) {
  const si = _tNextTue(dtIni), sf = _tPrevTue(dtFim);
  if (sf <= si) sf.setDate(sf.getDate()+7);
  _T.dtIni = si; _T.dtFim = sf;
  const fmt = d => d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'});
  const lbl = document.getElementById('trend-cal-label');
  if (lbl) lbl.textContent = `${fmt(si)} → ${fmt(sf)}`;
  _tRefresh();
}
function trendCmpOnPeriodSet(dtIni, dtFim) {
  const si = _tNextTue(dtIni), sf = _tPrevTue(dtFim);
  _T.cmpDtIni = si; _T.cmpDtFim = sf;
  const fmt = d => d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'});
  const lbl = document.getElementById('trend-cmp-cal-label');
  if (lbl) lbl.textContent = `${fmt(si)} → ${fmt(sf)}`;
}

// ── Material dropdown ─────────────────────────────────────
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
  document.getElementById('trend-mat-chev').style.transform = '';
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
  _tRefresh();
}
function _tRenderMatOptions() {
  const el = document.getElementById('trend-mat-options');
  if (!el) return;
  el.innerHTML = _T.allMats.map(m => {
    const ch = !_T.materials || _T.materials.has(m) ? 'checked' : '';
    return `<label class="micro-filter-option"><input type="checkbox" value="${escapeHtml(m)}" ${ch}><span class="micro-filter-option-label">${escapeHtml(m)}</span></label>`;
  }).join('');
}

// ── Comparator ────────────────────────────────────────────
function trendToggleCmpDropdown() {
  const dd = document.getElementById('trend-cmp-dropdown');
  const chev = document.getElementById('trend-cmp-chev');
  const btn  = document.getElementById('trend-cmp-trigger');
  const open = dd?.classList.contains('open');
  if (!open) _tPopulateCmpEntities();
  dd?.classList.toggle('open', !open);
  if (chev) chev.style.transform = open ? '' : 'rotate(180deg)';
  btn?.classList.toggle('open', !open);
}
function trendCmpSwitchTab(tab) {
  _T.cmpTab = tab;
  document.querySelectorAll('.trend-cmp-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('trend-cmp-entity-panel').style.display = tab === 'entity' ? '' : 'none';
  document.getElementById('trend-cmp-period-panel').style.display = tab === 'period' ? '' : 'none';
}
function trendCmpFilterSearch(q) {
  document.querySelectorAll('#trend-cmp-options .micro-filter-option').forEach(opt => {
    opt.style.display = opt.textContent.toLowerCase().includes(q.toLowerCase()) ? '' : 'none';
  });
}
function _tPopulateCmpEntities() {
  const el = document.getElementById('trend-cmp-options');
  if (!el) return;
  const regionals = [...new Set((state.filiais||[]).map(f=>f.regional).filter(Boolean))].sort();
  const centrals  = [...new Set((state.filiais||[]).map(f=>f.alias||f.origem).filter(Boolean))].sort();
  el.innerHTML =
    `<div class="trend-cmp-group-label">Regionais</div>` +
    regionals.map(r => {
      const sel = _T.cmpEntity?.name === r && _T.cmpEntity?.type === 'regional';
      return `<label class="micro-filter-option${sel?' checked':''}">
        <input type="radio" name="trend-cmp-ent" value="${escapeHtml(r)}" ${sel?'checked':''} onchange="trendCmpSelectEntity('regional','${escapeHtml(r)}',this.closest('label'))">
        <span class="micro-filter-option-label"><i class="ti ti-users-group" style="color:var(--accent)"></i> ${escapeHtml(r)}</span>
      </label>`;
    }).join('') +
    `<div class="trend-cmp-group-label" style="margin-top:4px">Centrais</div>` +
    centrals.map(c => {
      const sel = _T.cmpEntity?.name === c && _T.cmpEntity?.type === 'central';
      return `<label class="micro-filter-option${sel?' checked':''}">
        <input type="radio" name="trend-cmp-ent" value="${escapeHtml(c)}" ${sel?'checked':''} onchange="trendCmpSelectEntity('central','${escapeHtml(c)}',this.closest('label'))">
        <span class="micro-filter-option-label"><i class="ti ti-building-warehouse" style="color:var(--accent)"></i> ${escapeHtml(c)}</span>
      </label>`;
    }).join('');
}
function trendCmpSelectEntity(type, name, labelEl) {
  _T.cmpEntity = { type, name };
  document.querySelectorAll('#trend-cmp-options .micro-filter-option').forEach(l => l.classList.remove('checked'));
  labelEl?.classList.add('checked');
}
function trendCmpApply() {
  if (_T.cmpTab === 'entity' && _T.cmpEntity) { _T.cmpMode = 'entity'; }
  else if (_T.cmpTab === 'period' && _T.cmpDtIni && _T.cmpDtFim) { _T.cmpMode = 'period'; _T.cmpEntity = null; }
  else { _T.cmpMode = null; }
  _tUpdateCmpTrigger();
  document.getElementById('trend-cmp-dropdown')?.classList.remove('open');
  document.getElementById('trend-cmp-chev').style.transform = '';
  document.getElementById('trend-cmp-trigger')?.classList.remove('open');
  _tRefresh();
}
function trendCmpClear() {
  _T.cmpMode = null; _T.cmpEntity = null; _T.cmpDtIni = null; _T.cmpDtFim = null; _T.cmpWeekData = [];
  _tUpdateCmpTrigger();
  document.getElementById('trend-cmp-dropdown')?.classList.remove('open');
  document.getElementById('trend-cmp-chev').style.transform = '';
  document.getElementById('trend-cmp-trigger')?.classList.remove('open');
  _tRefresh();
}
function _tUpdateCmpTrigger() {
  const lbl = document.getElementById('trend-cmp-label');
  const btn = document.getElementById('trend-cmp-trigger');
  if (!lbl) return;
  if (!_T.cmpMode) { lbl.textContent = 'Nenhum'; btn?.classList.remove('active'); }
  else if (_T.cmpMode === 'entity' && _T.cmpEntity) { lbl.textContent = _T.cmpEntity.name; btn?.classList.add('active'); }
  else if (_T.cmpMode === 'period') {
    const fmt = d => d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
    lbl.textContent = `${fmt(_T.cmpDtIni)} → ${fmt(_T.cmpDtFim)}`;
    btn?.classList.add('active');
  }
}

// Close dropdowns on outside click
document.addEventListener('click', e => {
  ['mat','cmp'].forEach(key => {
    const wrap = document.getElementById(`trend-${key}-wrap`);
    const dd   = document.getElementById(`trend-${key}-dropdown`);
    if (dd?.classList.contains('open') && wrap && !wrap.contains(e.target)) {
      dd.classList.remove('open');
      const chev = document.getElementById(`trend-${key}-chev`);
      if (chev) chev.style.transform = '';
      document.getElementById(`trend-${key}-trigger`)?.classList.remove('open');
    }
  });
  if (!document.getElementById('modal-trend')?.classList.contains('open')) _tHideTooltip();
});

// ── Open modal ────────────────────────────────────────────
function openTrendModal(type, name) {
  const titleEl = document.getElementById('trend-modal-title');
  const subEl   = document.getElementById('trend-modal-sub');
  if (titleEl) titleEl.innerHTML = `<i class="ti ti-chart-line"></i> Tendência — ${escapeHtml(name)}`;
  if (subEl)   subEl.textContent = `${type==='central'?'Central':'Regional'} · variação semanal (ter→ter)`;

  const now = new Date();
  const dtFimDef = new Date(now);
  const dtIniDef = new Date(now); dtIniDef.setMonth(dtIniDef.getMonth()-3);

  const allMats = _tGetAllMaterials(type, name);

  _T = { ..._T, type, name, dtIni: dtIniDef, dtFim: dtFimDef,
    materials: null, allMats,
    cmpMode: null, cmpEntity: null, cmpDtIni: null, cmpDtFim: null,
    sel: null, dragging: false, hoverIdx: -1, weekData: [], cmpWeekData: [] };

  if (typeof calSetRange === 'function') calSetRange('trend', dtIniDef.toISOString().slice(0,10), dtFimDef.toISOString().slice(0,10));

  document.getElementById('trend-selection-bar').style.display = 'none';
  document.getElementById('trend-cmp-label').textContent = 'Nenhum';
  document.getElementById('trend-cmp-trigger')?.classList.remove('active');
  _tRenderMatOptions();
  const cnt = document.getElementById('trend-mat-count');
  if (cnt) cnt.textContent = `(${allMats.length}/${allMats.length})`;

  openModal('modal-trend');
  setTimeout(() => { _tRefresh(); _tWireCanvas(); }, 100);
}

window.addEventListener('resize', () => {
  if (document.getElementById('modal-trend')?.classList.contains('open')) _tDraw();
});

Object.assign(window, {
  openTrendModal, trendOnPeriodSet, trendCmpOnPeriodSet,
  trendToggleMatDropdown, trendCloseMatDropdown, trendClearMatFilter, trendFilterMatSearch,
  trendToggleCmpDropdown, trendCmpSwitchTab, trendCmpFilterSearch,
  trendCmpSelectEntity, trendCmpApply, trendCmpClear, trendClearSelection,
});
