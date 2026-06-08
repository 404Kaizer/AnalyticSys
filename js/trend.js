// ═══════════════════════════════════════════════════════════
// GRÁFICO DE TENDÊNCIA DE VARIAÇÃO
// Semanas de terça a terça · período e materiais configuráveis
// ═══════════════════════════════════════════════════════════

// ── Estado ───────────────────────────────────────────────
let _trendState = {
  type:      null,   // 'central' | 'regional'
  name:      null,
  dtIni:     null,   // Date
  dtFim:     null,   // Date
  materials: null,   // Set of selected material names, null = all
  allMats:   [],     // all available materials
};

// ── Helpers de data ──────────────────────────────────────
function _trendDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function _trendPrevTuesday(d) {
  const dt = new Date(d);
  const dow = dt.getDay();
  const diff = dow >= 2 ? dow - 2 : 7 + dow - 2;
  dt.setDate(dt.getDate() - diff);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function _trendBuildWeeks(dtIni, dtFim) {
  const endDate = _trendPrevTuesday(dtFim || new Date());
  const startRef = dtIni || (() => { const d = new Date(endDate); d.setMonth(d.getMonth() - 3); return d; })();

  const weeks = [];
  let wStart = _trendPrevTuesday(startRef);
  while (wStart <= endDate) {
    const wEnd = new Date(wStart);
    wEnd.setDate(wEnd.getDate() + 6);
    if (wEnd > endDate) break;
    weeks.push({ start: new Date(wStart), end: new Date(wEnd) });
    wStart = new Date(wEnd);
    wStart.setDate(wStart.getDate() + 1);
  }
  return weeks;
}

// ── Get lancs/saps for a central or regional ─────────────
function _trendGetRecords(type, name) {
  let centraisList = null;
  if (type === 'regional') {
    const filiais = (state.filiais || []).filter(f =>
      normalizeText(f.regional || '') === normalizeText(name)
    );
    centraisList = new Set(filiais.map(f => normalizeText(f.alias || f.origem || '')));
  }

  const lancs = (state.lancamentos || []).filter(l => {
    const c = normalizeText(l.central || '');
    return type === 'central'
      ? c === normalizeText(name)
      : centraisList.has(c);
  });
  const saps = (state.sap || []).filter(s => {
    const c = normalizeText(s.central || '');
    return type === 'central'
      ? c === normalizeText(name)
      : centraisList.has(c);
  });
  return { lancs, saps };
}

// ── Get all unique materials ──────────────────────────────
function _trendGetAllMaterials(lancs, saps) {
  const mats = new Set();
  lancs.forEach(l => l.material && mats.add(l.material));
  saps.forEach(s => s.material && mats.add(s.material));
  return [...mats].sort();
}

// ── Compute weeks ─────────────────────────────────────────
function _trendComputeWeeks(lancs, saps, dtIni, dtFim, selectedMats) {
  const weeks = _trendBuildWeeks(dtIni, dtFim);

  // Filter by selected materials
  const filtLancs = selectedMats
    ? lancs.filter(l => selectedMats.has(l.material))
    : lancs;
  const filtSaps = selectedMats
    ? saps.filter(s => selectedMats.has(s.material))
    : saps;

  return weeks.map(({ start, end }) => {
    const sk = _trendDateKey(start), ek = _trendDateKey(end);

    const realKg = filtLancs
      .filter(l => { const d = parseDate(l.dtLanc); if (!d) return false; const dk = _trendDateKey(d); return dk >= sk && dk <= ek; })
      .reduce((s, l) => s + num(l.peso), 0);

    const sapKg = filtSaps
      .filter(s => { const d = parseDate(s.dtLanc); if (!d) return false; const dk = _trendDateKey(d); return dk >= sk && dk <= ek; })
      .reduce((s, r) => {
        const p = num(r.peso);
        return s + (p > 0 ? p : -Math.abs(p));
      }, 0);

    const variation = realKg - sapKg;
    return {
      label:     `${start.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})}`,
      startDate: start, endDate: end,
      realKg, teorKg: sapKg, variation,
    };
  });
}

// ── Forecast (linear regression on last 4 weeks) ─────────
function _trendForecast(weekData) {
  const recent = weekData.slice(-4).filter(w => w.realKg > 0);
  if (recent.length < 2) return null;
  const n = recent.length;
  const xs = recent.map((_, i) => i);
  const ys = recent.map(w => w.variation);
  const mx = xs.reduce((a,b) => a+b,0) / n;
  const my = ys.reduce((a,b) => a+b,0) / n;
  const num2 = xs.reduce((s,x,i) => s + (x-mx)*(ys[i]-my), 0);
  const den  = xs.reduce((s,x) => s + (x-mx)**2, 0);
  if (den === 0) return null;
  const slope = num2 / den;
  return (my - slope * mx) + slope * n;
}

// ── Draw ──────────────────────────────────────────────────
function _trendDraw(weekData) {
  const canvas = document.getElementById('trend-canvas');
  const wrap   = document.getElementById('trend-chart-wrap');
  if (!canvas || !wrap) return;
  canvas.width  = wrap.offsetWidth  || 760;
  canvas.height = wrap.offsetHeight || 320;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const PAD = { top: 30, right: 70, bottom: 50, left: 88 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top  - PAD.bottom;

  const style = getComputedStyle(document.body);
  const C = {
    bg:     style.getPropertyValue('--bg2').trim(),
    grid:   style.getPropertyValue('--border').trim(),
    text3:  style.getPropertyValue('--text3').trim(),
    accent: style.getPropertyValue('--accent').trim(),
    red:    style.getPropertyValue('--red').trim(),
    green:  style.getPropertyValue('--green').trim(),
    amber:  style.getPropertyValue('--amber').trim(),
    purple: style.getPropertyValue('--purple').trim(),
    text:   style.getPropertyValue('--text').trim(),
  };

  ctx.clearRect(0, 0, W, H);

  const vals     = weekData.map(w => w.variation);
  const forecast = _trendForecast(weekData);
  const allVals  = forecast != null ? [...vals, forecast] : vals;
  const maxV     = Math.max(...allVals.map(Math.abs), 1);
  const range    = maxV * 1.25;

  const n = weekData.length;
  const xPos = i => PAD.left + ((i + 0.5) / n) * cW;
  const yPos = v => PAD.top + cH * (1 - (v + range) / (range * 2));
  const yZero = yPos(0);

  // Grid
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = PAD.top + (cH * i / 4);
    ctx.strokeStyle = C.grid;
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
    const val = range - (range * 2 * i / 4);
    ctx.fillStyle = C.text3;
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(_trendFmtKg(val), PAD.left - 6, y + 3);
  }

  // Zero line
  ctx.strokeStyle = C.text;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(PAD.left, yZero); ctx.lineTo(PAD.left + cW, yZero); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = C.text3;
  ctx.font = '9px monospace';
  ctx.textAlign = 'right';
  ctx.fillText('0', PAD.left - 6, yZero + 3);

  if (!vals.length) {
    ctx.fillStyle = C.text3;
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Sem dados para o período selecionado', W/2, H/2);
    return;
  }

  // Area fill
  const lastV = vals[vals.length-1];
  ctx.beginPath();
  ctx.moveTo(xPos(0), yZero);
  vals.forEach((v,i) => ctx.lineTo(xPos(i), yPos(v)));
  ctx.lineTo(xPos(vals.length-1), yZero);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH);
  grad.addColorStop(0, lastV >= 0 ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.18)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fill();

  // Main line
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  vals.forEach((v,i) => i===0 ? ctx.moveTo(xPos(i),yPos(v)) : ctx.lineTo(xPos(i),yPos(v)));
  ctx.stroke();

  // Points
  vals.forEach((v,i) => {
    ctx.beginPath();
    ctx.arc(xPos(i), yPos(v), 4, 0, Math.PI*2);
    ctx.fillStyle = v >= 0 ? C.green : C.red;
    ctx.fill();
    ctx.strokeStyle = C.bg;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });

  // Forecast
  if (forecast != null) {
    const fx0 = xPos(vals.length-1);
    const fx1 = xPos(vals.length-1) + cW/n;
    const fy0 = yPos(lastV);
    const fy1 = yPos(forecast);
    ctx.strokeStyle = C.purple;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6,4]);
    ctx.beginPath(); ctx.moveTo(fx0,fy0); ctx.lineTo(fx1,fy1); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(fx1, fy1, 5, 0, Math.PI*2);
    ctx.fillStyle = C.purple;
    ctx.fill();
    ctx.strokeStyle = C.bg;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = C.purple;
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('Prev.', fx1+6, fy1+4);
  }

  // X labels — skip some if too many weeks
  const step = n > 20 ? Math.ceil(n/12) : 1;
  ctx.fillStyle = C.text3;
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  vals.forEach((_,i) => {
    if (i % step !== 0 && i !== vals.length-1) return;
    ctx.fillText(weekData[i].label, xPos(i), PAD.top + cH + 18);
  });
  if (forecast != null) {
    ctx.fillStyle = C.purple;
    ctx.fillText('próx.', xPos(vals.length-1) + cW/n, PAD.top + cH + 18);
  }

  // Store for tooltip
  canvas._weekData = weekData;
  canvas._forecast = forecast;
  canvas._helpers  = { xPos, yPos, PAD, cW, cH, C, W, H, n };
  canvas.onmousemove  = _trendTooltip;
  canvas.onmouseleave = () => {
    const tip = document.getElementById('trend-tooltip');
    if (tip) tip.style.display = 'none';
  };
}

function _trendFmtKg(v) {
  const abs = Math.abs(v);
  if (abs >= 1000000) return (v/1000000).toFixed(1)+'M';
  if (abs >= 1000)    return (v/1000).toFixed(1)+'K';
  return v.toFixed(0);
}

function _trendTooltip(e) {
  const canvas = e.target;
  const rect   = canvas.getBoundingClientRect();
  const mx     = (e.clientX - rect.left) * (canvas.width / rect.width);
  const { xPos, cW, n } = canvas._helpers;
  const weeks = canvas._weekData;

  let nearest = -1, minDist = Infinity;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(mx - xPos(i));
    if (d < minDist) { minDist = d; nearest = i; }
  }
  if (nearest < 0 || minDist > cW / n) return;

  const w   = weeks[nearest];
  let tip = document.getElementById('trend-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'trend-tooltip';
    tip.style.cssText = `position:fixed;pointer-events:none;background:var(--bg2);border:1px solid var(--border2);border-radius:8px;padding:10px 14px;font-size:12px;font-family:var(--mono);box-shadow:0 8px 24px rgba(0,0,0,.4);z-index:9999;min-width:180px`;
    document.body.appendChild(tip);
  }
  const varSign  = w.variation >= 0 ? '+' : '';
  const varColor = w.variation >= 0 ? 'var(--green)' : 'var(--red)';
  tip.innerHTML = `
    <div style="font-weight:700;color:var(--text);margin-bottom:6px">
      ${w.startDate.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})} → ${w.endDate.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})}
    </div>
    <div style="color:var(--text3);margin-bottom:3px">Real: <strong style="color:var(--text)">${w.realKg.toLocaleString('pt-BR',{maximumFractionDigits:0})} kg</strong></div>
    <div style="color:var(--text3);margin-bottom:5px">Teórico: <strong style="color:var(--text)">${w.teorKg.toLocaleString('pt-BR',{maximumFractionDigits:0})} kg</strong></div>
    <div style="font-weight:700;font-size:13px;color:${varColor}">${varSign}${w.variation.toLocaleString('pt-BR',{maximumFractionDigits:0})} kg</div>`;
  tip.style.display = 'block';
  tip.style.left = Math.min(e.clientX + 14, window.innerWidth - 210) + 'px';
  tip.style.top  = Math.max(10, e.clientY - 80) + 'px';
}

// ── Controls ──────────────────────────────────────────────
function trendOnPeriodSet(dtIni, dtFim) {
  // Snap both dates to nearest Tuesday
  const snappedIni = _trendNearestTuesday(dtIni);
  const snappedFim = _trendPrevTuesday(dtFim);   // fim = last Tuesday on or before chosen date

  // Ensure at least 1 week apart
  if (snappedFim <= snappedIni) {
    snappedFim.setDate(snappedFim.getDate() + 7);
  }

  _trendState.dtIni = snappedIni;
  _trendState.dtFim = snappedFim;

  // Update cal-picker label to show snapped dates
  const label = document.getElementById('trend-cal-label');
  if (label) {
    const fmt = d => d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' });
    label.textContent = `${fmt(snappedIni)} → ${fmt(snappedFim)}`;
  }

  _trendRefresh();
}

// Nearest Tuesday on or after a date
function _trendNearestTuesday(d) {
  const dt = new Date(d);
  dt.setHours(0,0,0,0);
  const dow = dt.getDay(); // 0=sun, 2=tue
  if (dow === 2) return dt;
  const diff = dow < 2 ? 2 - dow : 9 - dow; // days until next Tuesday
  dt.setDate(dt.getDate() + diff);
  return dt;
}

// ── Material dropdown (micro-filter style) ────────────────
function trendToggleMatDropdown() {
  const dd   = document.getElementById('trend-mat-dropdown');
  const chev = document.getElementById('trend-mat-chev');
  const btn  = document.getElementById('trend-mat-trigger');
  if (!dd) return;
  const open = dd.classList.contains('open');
  dd.classList.toggle('open', !open);
  if (chev) chev.style.transform = open ? '' : 'rotate(180deg)';
  if (btn)  btn.classList.toggle('open', !open);
}

function trendCloseMatDropdown() {
  const dd   = document.getElementById('trend-mat-dropdown');
  const chev = document.getElementById('trend-mat-chev');
  const btn  = document.getElementById('trend-mat-trigger');
  dd?.classList.remove('open');
  if (chev) chev.style.transform = '';
  btn?.classList.remove('open');
  _trendApplyMatFilter();
}

function trendClearMatFilter() {
  const opts = document.getElementById('trend-mat-options');
  if (opts) opts.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
}

function trendFilterMatSearch(q) {
  const opts = document.getElementById('trend-mat-options');
  if (!opts) return;
  opts.querySelectorAll('.micro-filter-option').forEach(opt => {
    opt.style.display = opt.textContent.toLowerCase().includes(q.toLowerCase()) ? '' : 'none';
  });
}

function _trendApplyMatFilter() {
  const opts = document.getElementById('trend-mat-options');
  if (!opts) return;
  const checked = Array.from(opts.querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.value);
  const mats    = _trendState.allMats;
  _trendState.materials = checked.length === 0 || checked.length === mats.length
    ? null
    : new Set(checked);
  _trendUpdateMatTrigger();
  _trendRefresh();
}

function _trendUpdateMatTrigger() {
  const sel   = _trendState.materials;
  const mats  = _trendState.allMats;
  const label = document.getElementById('trend-mat-trigger-label');
  const count = document.getElementById('trend-mat-count');
  const btn   = document.getElementById('trend-mat-trigger');
  const n     = sel ? sel.size : mats.length;
  if (label) label.textContent = sel ? `${n} material${n !== 1 ? 'is' : ''}` : 'Todos';
  if (count) count.textContent = `(${n}/${mats.length})`;
  if (btn)   btn.classList.toggle('active', !!sel);
}

function _trendRenderMatOptions() {
  const el   = document.getElementById('trend-mat-options');
  const mats = _trendState.allMats;
  const sel  = _trendState.materials;
  if (!el) return;
  el.innerHTML = mats.map(m => {
    const checked = !sel || sel.has(m) ? 'checked' : '';
    return `<label class="micro-filter-option">
      <input type="checkbox" value="${escapeHtml(m)}" ${checked}>
      <span class="micro-filter-option-label">${escapeHtml(m)}</span>
    </label>`;
  }).join('');
}

// Close on outside click
document.addEventListener('click', e => {
  const wrap = document.getElementById('trend-mat-wrap');
  const dd   = document.getElementById('trend-mat-dropdown');
  if (dd?.classList.contains('open') && wrap && !wrap.contains(e.target)) {
    trendCloseMatDropdown();
  }
});

function _trendRefresh() {
  const { type, name, dtIni, dtFim, materials } = _trendState;
  if (!type || !name) return;
  const { lancs, saps } = _trendGetRecords(type, name);
  const weekData = _trendComputeWeeks(lancs, saps, dtIni, dtFim, materials);
  _trendDraw(weekData);
  _trendRenderLegend(weekData);
}

function _trendRenderLegend(weekData) {
  const el = document.getElementById('trend-legend');
  if (!el) return;
  const forecast = _trendForecast(weekData);
  const n = weekData.length;
  const trend = n >= 2
    ? weekData[n-1].variation - weekData[n-2].variation
    : 0;
  el.innerHTML = `
    <span class="trend-legend-item">
      <span style="background:var(--accent);width:20px;height:3px;display:inline-block;vertical-align:middle;margin-right:5px;border-radius:2px"></span>
      Variação semanal
    </span>
    <span class="trend-legend-item">
      <span style="width:20px;height:0;display:inline-block;vertical-align:middle;margin-right:5px;border-top:2px dashed var(--purple)"></span>
      Previsão: <strong style="color:var(--purple)">${forecast != null ? (forecast>=0?'+':'') + forecast.toLocaleString('pt-BR',{maximumFractionDigits:0}) + ' kg' : '—'}</strong>
    </span>
    <span class="trend-legend-item" style="color:${trend <= 0 ? 'var(--red)' : 'var(--green)'}">
      <i class="ti ti-trending-${trend <= 0 ? 'down' : 'up'}"></i>
      ${trend <= 0 ? 'Piorando' : 'Melhorando'}
      (${trend >= 0 ? '+' : ''}${trend.toLocaleString('pt-BR',{maximumFractionDigits:0})} kg vs semana ant.)
    </span>`;
}

// ── Open modal ────────────────────────────────────────────
function openTrendModal(type, name) {
  const titleEl = document.getElementById('trend-modal-title');
  const subEl   = document.getElementById('trend-modal-sub');
  if (titleEl) titleEl.innerHTML = `<i class="ti ti-chart-line"></i> Tendência — ${escapeHtml(name)}`;
  if (subEl)   subEl.textContent = `${type === 'central' ? 'Central' : 'Regional'} · variação semanal (ter→ter)`;

  // Get all records and materials
  const { lancs, saps } = _trendGetRecords(type, name);
  const allMats = _trendGetAllMaterials(lancs, saps);

  // Default: last 3 months
  const now     = new Date();
  const dtFimDef = new Date(now);
  const dtIniDef = new Date(now);
  dtIniDef.setMonth(dtIniDef.getMonth() - 3);
  _trendState = { type, name, dtIni: dtIniDef, dtFim: dtFimDef, materials: null, allMats };

  // Pre-set cal-picker range
  if (typeof calSetRange === 'function') calSetRange('trend', dtIniDef.toISOString().slice(0,10), dtFimDef.toISOString().slice(0,10));

  _trendRenderMatOptions();
  _trendUpdateMatTrigger();
  openModal('modal-trend');

  setTimeout(() => _trendRefresh(), 80);
}

// Cleanup tooltip when modal closes
document.addEventListener('click', e => {
  const tip = document.getElementById('trend-tooltip');
  if (tip && !document.getElementById('modal-trend')?.classList.contains('open')) {
    tip.style.display = 'none';
  }
});

Object.assign(window, { openTrendModal, trendOnPeriodSet, trendToggleMatDropdown, trendCloseMatDropdown, trendClearMatFilter, trendFilterMatSearch });
