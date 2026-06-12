'use strict';

// ═══════════════════════════════════════════════════════════
// OCORRÊNCIAS — módulo completo
// ═══════════════════════════════════════════════════════════

// ── Estado local (persistido no state global) ─────────────
function getOcorrencias() {
  if (!Array.isArray(state.ocorrencias)) state.ocorrencias = [];
  return state.ocorrencias;
}

function _nextOcId() {
  const lista = getOcorrencias();
  const nums = lista
    .map(o => { const m = String(o.id).match(/^OC-(\d+)$/); return m ? parseInt(m[1]) : 0; })
    .filter(n => n > 0);
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return 'OC-' + next;
}

function saveOcorrencia(ocorrencia) {
  if (!Array.isArray(state.ocorrencias)) state.ocorrencias = [];
  const idx = state.ocorrencias.findIndex(o => o.id === ocorrencia.id);
  if (idx >= 0) state.ocorrencias[idx] = ocorrencia;
  else state.ocorrencias.push(ocorrencia);
  persist();
  renderOcorrencias();
}

function deleteOcorrencia(id) {
  state.ocorrencias = (state.ocorrencias || []).filter(o => o.id !== id);
  persist();
  renderOcorrencias();
}

// ── Helpers ───────────────────────────────────────────────
function ocDateStatus(dataLimite) {
  if (!dataLimite) return 'normal';
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const limite = new Date(dataLimite + 'T00:00:00');
  const diff = Math.ceil((limite - hoje) / 86400000);
  if (diff < 0) return 'vencida';
  if (diff <= 2) return 'urgente';
  return 'normal';
}

function ocStatusLabel(o) {
  if (o.concluida) return 'concluída';
  return ocDateStatus(o.dataLimite);
}

function fmtDateBR(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function buildWhatsAppLink(numero, ocorrencia) {
  const clean = (numero || '').replace(/\D/g, '');
  const phone = clean.startsWith('55') ? clean : '55' + clean;
  const central = escapeHtml(ocorrencia.central || '');
  const material = escapeHtml(ocorrencia.material || '');
  const descricao = escapeHtml(ocorrencia.descricao || '');
  const dataLimite = fmtDateBR(ocorrencia.dataLimite);
  const msg = `Olá! Estou entrando em contato referente a uma ocorrência aberta no AnalyticSys.\n\n` +
    `*Central:* ${central}\n` +
    `*Material:* ${material}\n` +
    `*Prazo:* ${dataLimite}\n\n` +
    `*Descrição:*\n${descricao}\n\n` +
    `Por favor, verifique e nos retorne assim que possível. Obrigado!`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

// ── KPIs ──────────────────────────────────────────────────
function buildOcKPIs(lista) {
  const total      = lista.length;
  const concluidas = lista.filter(o => o.concluida).length;
  const abertas    = total - concluidas;
  const vencidas   = lista.filter(o => !o.concluida && ocDateStatus(o.dataLimite) === 'vencida').length;
  const urgentes   = lista.filter(o => !o.concluida && ocDateStatus(o.dataLimite) === 'urgente').length;
  const pctConc    = total > 0 ? Math.round(concluidas / total * 100) : 0;

  // Contagem por central (top 12)
  const porCentral = {};
  lista.forEach(o => { const c = o.central || '—'; porCentral[c] = (porCentral[c] || 0) + 1; });
  const topCentrals = Object.entries(porCentral).sort((a, b) => b[1] - a[1]).slice(0, 12);

  // Contagem por motivo
  const porMotivo = {};
  lista.forEach(o => {
    const m = (o.motivo || '').trim() || 'Sem motivo';
    porMotivo[m] = (porMotivo[m] || 0) + 1;
  });
  const topMotivos = Object.entries(porMotivo).sort((a, b) => b[1] - a[1]);

  // Diferença entre data de conclusão e data prazo (prazo → conclusão) em dias
  // Negativo = concluída antes do prazo; positivo = concluída após o prazo
  const temposBuckets = { '1d':0, '2-3d':0, '4-7d':0, '8-15d':0, '16-30d':0, '>30d':0 };
  let tempoTotal = 0, tempoCount = 0;
  lista.forEach(o => {
    if (!o.concluida || !o.dataLimite || !o.dataConclusao) return;
    const ini = new Date(o.dataLimite + 'T00:00:00'), fim = new Date(o.dataConclusao + 'T00:00:00');
    if (isNaN(ini) || isNaN(fim)) return;
    const days = (fim - ini) / 86400000;
    tempoTotal += days; tempoCount++;
    const absDays = Math.abs(days);
    if      (absDays <= 1)  temposBuckets['1d']++;
    else if (absDays <= 3)  temposBuckets['2-3d']++;
    else if (absDays <= 7)  temposBuckets['4-7d']++;
    else if (absDays <= 15) temposBuckets['8-15d']++;
    else if (absDays <= 30) temposBuckets['16-30d']++;
    else                    temposBuckets['>30d']++;
  });
  const tempoMedioMin = tempoCount > 0 ? tempoTotal / tempoCount : null; // agora em dias

  return { total, concluidas, abertas, vencidas, urgentes, pctConc,
           topCentrals, porCentral, topMotivos, porMotivo,
           temposBuckets, tempoMedioMin, tempoCount, _lista: lista };
}

// ── Render KPIs ───────────────────────────────────────────
let _ocChartHorario  = null;
let _ocChartCentral  = null;
let _ocChartMotivo   = null;
let _ocChartTempo    = null;

function _destroyOcCharts() {
  [_ocChartHorario, _ocChartCentral, _ocChartMotivo, _ocChartTempo].forEach(c => { try { c?.destroy(); } catch(e){} });
  _ocChartHorario = _ocChartCentral = _ocChartMotivo = _ocChartTempo = null;
}

// ── Donut "Status das ocorrências" ─────────────────────────
const OC_DONUT_META = {
  vencida:   { col: '#ef4444', label: 'Vencida'   },
  urgente:   { col: '#f59e0b', label: 'Urgente'   },
  normal:    { col: '#3b82f6', label: 'Em aberto' },
  concluida: { col: '#10b981', label: 'Concluída' }
};

function _buildOcDonut(kpis) {
  const total = kpis.total;
  if (!total) {
    return `<div style="display:flex;align-items:center;justify-content:center;height:160px;color:var(--text3);font-size:12px;font-family:var(--mono)">Sem ocorrências</div>`;
  }

  const normais = Math.max(0, kpis.abertas - kpis.vencidas - kpis.urgentes);
  const segs = [
    { key: 'vencida',   n: kpis.vencidas   },
    { key: 'urgente',   n: kpis.urgentes   },
    { key: 'normal',    n: normais         },
    { key: 'concluida', n: kpis.concluidas },
  ].filter(s => s.n > 0);

  const CX = 90, CY = 90, R = 72, ring = 26;
  const C = 2 * Math.PI * R;
  let offset = 0;
  let paths = '';
  segs.forEach(s => {
    const frac = s.n / total;
    const len  = frac * C;
    const meta = OC_DONUT_META[s.key];
    const pct  = Math.round(frac * 100);
    paths += `<circle class="oc-donut-slice" data-label="${meta.label}" data-count="${s.n}" data-pct="${pct}"
      cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${meta.col}" stroke-width="${ring}"
      stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-offset}"
      transform="rotate(-90 ${CX} ${CY})" style="cursor:pointer;transition:opacity .15s"></circle>`;
    offset += len;
  });

  const legend = segs.map(s => {
    const meta = OC_DONUT_META[s.key];
    const pct  = Math.round(s.n / total * 100);
    return `<div class="oc-donut-legend-row" data-label="${meta.label}" style="display:flex;align-items:center;gap:7px;font-size:11px;transition:opacity .15s">
      <span style="width:9px;height:9px;border-radius:2px;background:${meta.col};flex-shrink:0"></span>
      <span style="color:var(--text2);flex:1">${meta.label}</span>
      <span style="font-family:var(--mono);color:var(--text);font-weight:600">${s.n}</span>
      <span style="font-family:var(--mono);color:var(--text3);font-size:9.5px;min-width:32px;text-align:right">${pct}%</span>
    </div>`;
  }).join('');

  return `
    <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;justify-content:center">
      <div style="position:relative;width:180px;height:180px;flex-shrink:0">
        <svg viewBox="0 0 180 180" width="180" height="180">${paths}</svg>
        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none">
          <span style="font-size:24px;font-weight:700;font-family:var(--mono);color:var(--text)">${total}</span>
          <span style="font-size:9px;color:var(--text3);font-family:var(--mono);letter-spacing:.08em;text-transform:uppercase">ocorrências</span>
          <span style="font-size:11px;color:var(--green);font-family:var(--mono);margin-top:2px">${kpis.pctConc}% concl.</span>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;min-width:130px">${legend}</div>
    </div>`;
}

function _bindOcDonutHover() {
  const wrap = document.getElementById('oc-donut-wrap');
  if (!wrap) return;
  const slices = [...wrap.querySelectorAll('.oc-donut-slice')];
  const rows   = [...wrap.querySelectorAll('.oc-donut-legend-row')];

  const setHighlight = (label) => {
    slices.forEach(s => { s.style.opacity = (!label || s.dataset.label === label) ? '1' : '0.25'; });
    rows.forEach(r => { r.style.opacity = (!label || r.dataset.label === label) ? '1' : '0.4'; });
  };

  slices.forEach(s => {
    s.addEventListener('mouseenter', () => setHighlight(s.dataset.label));
    s.addEventListener('mouseleave', () => setHighlight(null));
  });
  rows.forEach(r => {
    r.addEventListener('mouseenter', () => setHighlight(r.dataset.label));
    r.addEventListener('mouseleave', () => setHighlight(null));
  });
}

function renderOcKPIs(lista) {
  const kpis = buildOcKPIs(lista);
  const el = document.getElementById('oc-kpis');
  if (!el) return;
  _destroyOcCharts();

  const isDark = !document.body.dataset.theme || document.body.dataset.theme !== 'light';
  const textCol  = isDark ? 'rgba(123,133,160,0.9)' : 'rgba(61,79,110,0.9)';
  const gridCol  = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
  const tickFont = { family: "'DM Mono', monospace", size: 10 };

  el.innerHTML = `
    <!-- Linha 1: Donut + volume por horário -->
    <div class="oc-charts-row" style="align-items:stretch">
      <div class="oc-chart-card oc-chart-donut-card" style="flex:0 0 320px">
        <div class="oc-chart-title">Status das ocorrências</div>
        <div class="oc-donut-wrap" id="oc-donut-wrap">${_buildOcDonut(kpis)}</div>
      </div>
      <div class="oc-chart-card" style="flex:1;min-width:0">
        <div class="oc-chart-title" style="display:flex;justify-content:space-between;align-items:center">
          <span><i class="ti ti-clock" style="font-size:12px;margin-right:5px"></i>Volume de Solicitações por Horário do Dia</span>
          <span id="oc-horario-pico" style="font-size:10px;font-family:var(--mono);color:var(--teal);background:var(--teal-bg);padding:2px 8px;border-radius:4px;border:1px solid var(--teal-border)"></span>
        </div>
        <div style="position:relative;width:100%;height:160px">
          <canvas id="oc-chart-horario" role="img" aria-label="Volume de ocorrências por horário do dia"></canvas>
        </div>
      </div>
    </div>
    <!-- Linha 2: Ranking centrais + Ocorrências por motivo -->
    <div class="oc-charts-row" style="margin-top:16px;align-items:stretch">
      <div class="oc-chart-card" style="flex:1;min-width:0">
        <div class="oc-chart-title" style="display:flex;justify-content:space-between;align-items:center">
          <span><i class="ti ti-building-factory-2" style="font-size:12px;margin-right:5px"></i>Ranking de Centrais</span>
          <span style="font-size:10px;font-family:var(--mono);color:var(--text3);background:var(--accent-dim);padding:2px 7px;border-radius:4px;border:1px solid var(--accent-glow)">top 12</span>
        </div>
        <div style="position:relative;width:100%;height:${Math.max(kpis.topCentrals.length * 28 + 20, 120)}px">
          <canvas id="oc-chart-central" role="img" aria-label="Ranking de centrais por ocorrências"></canvas>
        </div>
      </div>
      <div class="oc-chart-card" style="flex:1;min-width:0">
        <div class="oc-chart-title">
          <i class="ti ti-tag" style="font-size:12px;margin-right:5px"></i>Ocorrências por Motivo
        </div>
        <div style="position:relative;width:100%;height:${Math.max(kpis.topMotivos.length * 28 + 20, 120)}px">
          <canvas id="oc-chart-motivo" role="img" aria-label="Ocorrências por motivo"></canvas>
        </div>
      </div>
    </div>
    <!-- Linha 3: Tempo de atendimento -->
    <div class="oc-charts-row" style="margin-top:16px">
      <div class="oc-chart-card" style="flex:1">
        <div class="oc-chart-title" style="display:flex;justify-content:space-between;align-items:center">
          <span><i class="ti ti-clock-hour-4" style="font-size:12px;margin-right:5px"></i>Tempo Médio de Conclusão</span>
          <span style="font-size:10px;font-family:var(--mono);color:var(--text3)">prazo → conclusão · ${kpis.tempoCount} concluída${kpis.tempoCount!==1?'s':''}</span>
        </div>
        ${kpis.tempoMedioMin !== null ? `
        <div style="display:flex;align-items:center;gap:20px;margin:10px 0 14px;padding:12px 16px;background:var(--green-bg);border:1px solid var(--green-border);border-radius:8px;flex-wrap:wrap">
          <div style="display:flex;flex-direction:column;gap:3px;min-width:110px">
            <span style="font-size:9px;font-family:var(--mono);color:var(--text3);text-transform:uppercase;letter-spacing:.07em">Tempo Médio de Conclusão</span>
            <span style="font-size:26px;font-family:var(--mono);font-weight:700;color:var(--green);line-height:1.1">${kpis.tempoMedioMin < 1 ? (kpis.tempoMedioMin * 24).toFixed(1)+'<span style="font-size:14px;font-weight:400;margin-left:3px">h</span>' : kpis.tempoMedioMin.toFixed(1)+'<span style="font-size:14px;font-weight:400;margin-left:3px">d</span>'}</span>
            <span style="font-size:9px;font-family:var(--mono);color:var(--text3)">${kpis.tempoCount} ocorrência${kpis.tempoCount!==1?'s':''} analisada${kpis.tempoCount!==1?'s':''}</span>
          </div>
          <div style="width:1px;height:44px;background:var(--green-border);flex-shrink:0"></div>
          <div style="flex:1;min-width:180px;display:flex;flex-direction:column;gap:5px">
            <span style="font-size:9px;font-family:var(--mono);color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:2px">Distribuição por faixa</span>
            ${(()=>{
              const bk = kpis.temposBuckets;
              const entries = [
                {k:'1d',     l:'≤ 1 dia',  c:'#10b981'},
                {k:'2-3d',   l:'2–3 dias', c:'#22c55e'},
                {k:'4-7d',   l:'4–7 dias', c:'#f59e0b'},
                {k:'8-15d',  l:'8–15 dias',c:'#f97316'},
                {k:'16-30d', l:'16–30d',   c:'#f43f5e'},
                {k:'>30d',   l:'> 30 dias',c:'#dc2626'},
              ];
              const total = kpis.tempoCount || 1;
              return entries.map(({k,l,c})=>{
                const v = bk[k]||0; if(!v) return '';
                const pct = Math.round(v/total*100);
                return `<div style="display:flex;align-items:center;gap:7px">
                  <span style="font-size:9px;font-family:var(--mono);color:${c};min-width:46px;flex-shrink:0">${l}</span>
                  <div style="flex:1;height:5px;background:var(--bg3);border-radius:3px;overflow:hidden">
                    <div style="width:${pct}%;height:100%;background:${c};border-radius:3px;transition:width .4s"></div>
                  </div>
                  <span style="font-size:9px;font-family:var(--mono);color:var(--text3);min-width:30px;text-align:right">${v} (${pct}%)</span>
                </div>`;
              }).join('');
            })()}
          </div>
        </div>` : `<div style="padding:10px 0 12px;font-size:11px;font-family:var(--mono);color:var(--text3)">Nenhuma ocorrência concluída com datas registradas.</div>`}
        <div style="position:relative;width:100%;height:180px">
          <canvas id="oc-chart-tempo" role="img" aria-label="Distribuição do tempo de atendimento"></canvas>
        </div>
      </div>
    </div>`;

  _bindOcDonutHover();
  requestAnimationFrame(() => _buildOcCharts(kpis, textCol, gridCol, tickFont));
}

function _buildOcCharts(kpis, textCol, gridCol, tickFont) {
  // ── Gráfico horário ────────────────────────────────────────────────────────
  const horarioData = new Array(24).fill(0);
  (kpis._lista || []).forEach(o => {
    if (!o.criadoEm) return;
    const h = new Date(o.criadoEm).getHours();
    horarioData[h]++;
  });
  const picoH = horarioData.indexOf(Math.max(...horarioData));
  const picoEl = document.getElementById('oc-horario-pico');
  if (picoEl && Math.max(...horarioData) > 0) picoEl.textContent = `pico: ${String(picoH).padStart(2,'0')}h`;

  const ctxH = document.getElementById('oc-chart-horario');
  if (ctxH) {
    _ocChartHorario = new Chart(ctxH, {
      type: 'bar',
      data: {
        labels: Array.from({length:24}, (_,i) => String(i).padStart(2,'0')+'h'),
        datasets: [{
          data: horarioData,
          backgroundColor: horarioData.map((v,i) => i === picoH && v > 0 ? 'rgba(99,102,241,0.9)' : 'rgba(99,102,241,0.35)'),
          borderRadius: 3, borderSkipped: false
        }]
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins:{legend:{display:false}, tooltip:{callbacks:{label:ctx=>`${ctx.raw} ocorrência${ctx.raw!==1?'s':''}`}}},
        scales:{
          x:{grid:{color:gridCol},ticks:{color:textCol,font:tickFont,maxRotation:0}},
          y:{grid:{color:gridCol},ticks:{color:textCol,font:tickFont,precision:0},beginAtZero:true}
        }
      }
    });
  }

  // ── Ranking centrais ───────────────────────────────────────────────────────
  const ctxC = document.getElementById('oc-chart-central');
  if (ctxC && kpis.topCentrals.length) {
    const labels = kpis.topCentrals.map(([c]) => c);
    const vals   = kpis.topCentrals.map(([,n]) => n);
    _ocChartCentral = new Chart(ctxC, {
      type: 'bar',
      data: {
        labels,
        datasets:[{
          data: vals,
          backgroundColor: labels.map((_,i) => `rgba(59,130,246,${Math.max(0.3, 1 - i*0.06)})`),
          borderRadius: 3, borderSkipped: false
        }]
      },
      options: {
        indexAxis:'y', responsive:true, maintainAspectRatio:false,
        plugins:{legend:{display:false}, tooltip:{callbacks:{label:ctx=>`${ctx.raw} chamado${ctx.raw!==1?'s':''}`}}},
        scales:{
          x:{grid:{color:gridCol},ticks:{color:textCol,font:tickFont,precision:0},beginAtZero:true},
          y:{grid:{display:false},ticks:{color:textCol,font:tickFont}}
        }
      }
    });
  }

  // ── Ocorrências por motivo ─────────────────────────────────────────────────
  const ctxM = document.getElementById('oc-chart-motivo');
  if (ctxM && kpis.topMotivos.length) {
    const mLabels = kpis.topMotivos.map(([m]) => m.toUpperCase());
    const mVals   = kpis.topMotivos.map(([,n]) => n);
    _ocChartMotivo = new Chart(ctxM, {
      type: 'bar',
      data: {
        labels: mLabels,
        datasets:[{
          data: mVals,
          backgroundColor: 'rgba(245,158,11,0.75)',
          borderRadius: 3, borderSkipped: false
        }]
      },
      options: {
        indexAxis:'y', responsive:true, maintainAspectRatio:false,
        plugins:{legend:{display:false}, tooltip:{callbacks:{label:ctx=>`${ctx.raw} ocorrência${ctx.raw!==1?'s':''}`}}},
        scales:{
          x:{grid:{color:gridCol},ticks:{color:textCol,font:tickFont,precision:0},beginAtZero:true},
          y:{grid:{display:false},ticks:{color:textCol,font:{...tickFont,size:9},maxTicksLimit:20}}
        }
      }
    });
  }

  // ── Tempo de atendimento ───────────────────────────────────────────────────
  const ctxT = document.getElementById('oc-chart-tempo');
  if (ctxT) {
    const buckets = kpis.temposBuckets;
    const tLabels = ['≤ 1 dia','2–3 dias','4–7 dias','8–15 dias','16–30 dias','> 30 dias'];
    const tKeys   = ['1d','2-3d','4-7d','8-15d','16-30d','>30d'];
    const tVals   = tKeys.map(k => buckets[k] || 0);
    const tTotal  = tVals.reduce((a,b) => a+b, 0);

    // Determina o bucket onde está a média (em dias), para destacá-lo
    const avgMin = kpis.tempoMedioMin; // agora representa dias
    const _avgBucketIdx = avgMin === null ? -1 :
      avgMin <= 1  ? 0 :
      avgMin <= 3  ? 1 :
      avgMin <= 7  ? 2 :
      avgMin <= 15 ? 3 :
      avgMin <= 30 ? 4 : 5;

    const tColorsBase   = ['rgba(16,185,129,0.85)','rgba(34,197,94,0.75)','rgba(245,158,11,0.75)','rgba(249,115,22,0.75)','rgba(244,63,94,0.75)','rgba(220,38,38,0.75)'];
    const tColorsDimmed = tColorsBase.map((c,i) => i === _avgBucketIdx ? c : c.replace(/[\d.]+\)$/, m => '0.35)'));
    const tBorderColors = tColorsBase.map((c,i) => i === _avgBucketIdx ? c.replace(/[\d.]+\)$/, '1)') : 'transparent');
    const tBorderWidths = tColorsBase.map((c,i) => i === _avgBucketIdx ? 2 : 0);

    // Plugin customizado para desenhar label "ø média" no bucket destacado
    const avgLabelPlugin = {
      id: 'avgLabel',
      afterDatasetsDraw(chart) {
        if (_avgBucketIdx < 0) return;
        const { ctx, chartArea } = chart;
        const meta = chart.getDatasetMeta(0);
        const bar  = meta.data[_avgBucketIdx];
        if (!bar) return;
        const avgLabel = avgMin < 1 ? `ø ${(avgMin * 24).toFixed(1)} h` : `ø ${avgMin.toFixed(1)} d`;
        ctx.save();
        ctx.font = `bold 10px 'DM Mono', monospace`;
        ctx.fillStyle = tColorsBase[_avgBucketIdx].replace(/[\d.]+\)$/, '1)');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const x = bar.x;
        const y = Math.max(bar.y - 4, chartArea.top + 12);
        ctx.fillText(avgLabel, x, y);
        ctx.restore();
      }
    };

    _ocChartTempo = new Chart(ctxT, {
      type: 'bar',
      data: {
        labels: tLabels,
        datasets:[{
          data: tVals,
          backgroundColor: _avgBucketIdx >= 0 ? tColorsDimmed : tColorsBase,
          borderColor: tBorderColors,
          borderWidth: tBorderWidths,
          borderRadius: 4, borderSkipped: false
        }]
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins:{
          legend:{display:false},
          tooltip:{callbacks:{
            label: ctx => {
              const pct = tTotal > 0 ? ` (${Math.round(ctx.raw/tTotal*100)}%)` : '';
              return `${ctx.raw} ocorrência${ctx.raw!==1?'s':''}${pct}`;
            },
            afterLabel: ctx => {
              if (ctx.dataIndex === _avgBucketIdx && avgMin !== null) {
                const avg = avgMin < 1 ? `${(avgMin * 24).toFixed(1)} h` : `${avgMin.toFixed(1)} d`;
                return `← bucket da média (${avg})`;
              }
              return null;
            }
          }}
        },
        scales:{
          x:{grid:{color:gridCol},ticks:{color:textCol,font:tickFont}},
          y:{grid:{color:gridCol},ticks:{color:textCol,font:tickFont,precision:0},beginAtZero:true}
        }
      },
      plugins: [avgLabelPlugin]
    });
  }
}

// ── Render lista ──────────────────────────────────────────
function renderOcorrencias() {
  if (!Array.isArray(state.ocorrencias)) state.ocorrencias = [];
  const lista = getOcorrenciasFiltradas();
  renderOcKPIs(state.ocorrencias); // KPIs sempre no total
  _renderOcLista(lista);
  _renderOcAlerts(state.ocorrencias);
}

function getOcorrenciasFiltradas() {
  const fStatus  = document.getElementById('oc-filter-status')?.value || '';
  const fCentral = (document.getElementById('oc-filter-central')?.value || '').toLowerCase();
  const fMaterial = (document.getElementById('oc-filter-material')?.value || '').toLowerCase();
  const fOperador = (document.getElementById('oc-filter-operador')?.value || '').toLowerCase();
  const fBusca   = (document.getElementById('oc-filter-busca')?.value || '').toLowerCase();

  return (state.ocorrencias || []).filter(o => {
    if (fStatus === 'concluida' && !o.concluida) return false;
    if (fStatus === 'aberta'    &&  o.concluida) return false;
    if (fStatus === 'vencida'   && (o.concluida || ocDateStatus(o.dataLimite) !== 'vencida')) return false;
    if (fStatus === 'urgente'   && (o.concluida || ocDateStatus(o.dataLimite) !== 'urgente')) return false;
    if (fCentral  && !(o.central  || '').toLowerCase().includes(fCentral)) return false;
    if (fMaterial && !(o.material || '').toLowerCase().includes(fMaterial)) return false;
    if (fOperador && !(o.operador || '').toLowerCase().includes(fOperador)) return false;
    if (fBusca) {
      const hay = [o.central, o.material, o.operador, o.descricao, o.id].join(' ').toLowerCase();
      if (!hay.includes(fBusca)) return false;
    }
    return true;
  }).sort((a, b) => {
    // Vencidas e urgentes primeiro, depois por data limite
    const sa = ocStatusLabel(a), sb = ocStatusLabel(b);
    const order = { vencida: 0, urgente: 1, normal: 2, 'concluída': 3 };
    if (order[sa] !== order[sb]) return order[sa] - order[sb];
    return (a.dataLimite || '').localeCompare(b.dataLimite || '');
  });
}

function _renderOcAlerts(lista) {
  const el = document.getElementById('oc-alerts');
  if (!el) return;
  const vencidas = lista.filter(o => !o.concluida && ocDateStatus(o.dataLimite) === 'vencida');
  const urgentes = lista.filter(o => !o.concluida && ocDateStatus(o.dataLimite) === 'urgente');
  if (!vencidas.length && !urgentes.length) { el.innerHTML = ''; return; }

  let html = '';
  if (vencidas.length) {
    html += `<div class="oc-alert oc-alert-red">
      <i class="ti ti-alert-circle"></i>
      <strong>${vencidas.length} ocorrência${vencidas.length>1?'s':''} vencida${vencidas.length>1?'s':''}</strong>
      — prazo ultrapassado: ${vencidas.map(o => escapeHtml(o.central) + (o.material ? ' / ' + escapeHtml(o.material) : '')).join(', ')}
    </div>`;
  }
  if (urgentes.length) {
    html += `<div class="oc-alert oc-alert-amber">
      <i class="ti ti-clock-exclamation"></i>
      <strong>${urgentes.length} ocorrência${urgentes.length>1?'s':''} vence${urgentes.length>1?'m':''} em breve</strong>
      — menos de 2 dias: ${urgentes.map(o => escapeHtml(o.central) + (o.material ? ' / ' + escapeHtml(o.material) : '')).join(', ')}
    </div>`;
  }
  el.innerHTML = html;
}

function _renderOcLista(lista) {
  const el = document.getElementById('oc-lista');
  if (!el) return;
  if (!lista.length) {
    el.innerHTML = `<div class="empty-state"><i class="ti ti-clipboard-off"></i><p>Nenhuma ocorrência encontrada.</p></div>`;
    return;
  }

  el.innerHTML = lista.map(o => {
    const status = o.concluida ? 'concluida' : ocDateStatus(o.dataLimite);
    const statusLabel = { concluida: 'Concluída', vencida: 'Vencida', urgente: 'Urgente', normal: 'Em aberto' };
    const statusCls   = { concluida: 'oc-badge-green', vencida: 'oc-badge-red', urgente: 'oc-badge-amber', normal: 'oc-badge-blue' };
    const waLink = o.contato ? buildWhatsAppLink(o.contato, o) : null;

    return `<div class="oc-card ${o.concluida ? 'oc-card-done' : ''} oc-card-${status}" onclick="openOcDetailModal('${o.id}')">
      <div class="oc-card-header">
        <div class="oc-card-header-left">
          <span class="oc-badge ${statusCls[status]}">${statusLabel[status]}</span>
          <span class="oc-card-id">${escapeHtml(o.id)}</span>
          <span class="oc-card-central"><i class="ti ti-building-warehouse"></i> ${escapeHtml(o.central || '—')}</span>
          ${o.material ? `<span class="oc-card-material"><i class="ti ti-box"></i> ${escapeHtml(o.material)}</span>` : ''}
        </div>
        <div class="oc-card-header-right">
          <span class="oc-card-date-group">
            <span class="oc-card-date-label">Abertura</span>
            <span class="oc-card-date-val">${fmtDateBR(o.dataAbertura)}</span>
          </span>
          ${o.dataLimite ? `<span class="oc-card-date-sep">→</span>
          <span class="oc-card-date-group ${status === 'vencida' ? 'oc-date-red' : status === 'urgente' ? 'oc-date-amber' : ''}">
            <span class="oc-card-date-label">Prazo</span>
            <span class="oc-card-date-val">${fmtDateBR(o.dataLimite)}</span>
          </span>` : ''}
          ${o.concluida && o.dataConclusao ? `<span class="oc-card-date-sep">✓</span>
          <span class="oc-card-date-group oc-date-green">
            <span class="oc-card-date-label">Conclusão</span>
            <span class="oc-card-date-val">${fmtDateBR(o.dataConclusao)}</span>
          </span>` : ''}
        </div>
      </div>

      <div class="oc-card-body">
        <div class="oc-card-desc">${escapeHtml(o.descricao || '')}</div>
        ${o.concluida && o.descConclusao ? `<div class="oc-card-conclusao"><i class="ti ti-circle-check"></i> ${escapeHtml(o.descConclusao)}</div>` : ''}
      </div>

      <div class="oc-card-footer">
        <div class="oc-card-footer-left">
          <i class="ti ti-user"></i>
          <span>${escapeHtml(o.operador || '—')}</span>
          ${waLink ? `<a href="${waLink}" target="_blank" rel="noopener" class="oc-wa-btn" title="WhatsApp" onclick="event.stopPropagation()">
            <i class="ti ti-brand-whatsapp"></i> ${escapeHtml(o.contato)}
          </a>` : ''}
        </div>
        <div class="oc-card-footer-right">
          ${!o.concluida ? `<button class="btn btn-sm oc-btn-concluir" onclick="event.stopPropagation();openConcluirModal('${o.id}')" title="Concluir">
            <i class="ti ti-circle-check"></i>
          </button>` : ''}
          <button class="btn btn-sm" onclick="event.stopPropagation();openOcorrenciaModal('${o.id}')" title="Editar">
            <i class="ti ti-edit"></i>
          </button>
          <button class="btn btn-sm btn-danger-ghost" onclick="event.stopPropagation();confirmarExcluirOcorrencia('${o.id}')" title="Excluir">
            <i class="ti ti-trash"></i>
          </button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── Modal de detalhe (visualização completa) ──────────────
function openOcDetailModal(id) {
  const o = (state.ocorrencias || []).find(oc => oc.id === id);
  if (!o) return;
  const status = o.concluida ? 'concluida' : ocDateStatus(o.dataLimite);
  const statusLabel = { concluida: 'Concluída', vencida: 'Vencida', urgente: 'Urgente', normal: 'Em aberto' };
  const statusCls   = { concluida: 'oc-badge-green', vencida: 'oc-badge-red', urgente: 'oc-badge-amber', normal: 'oc-badge-blue' };
  const waLink = o.contato ? buildWhatsAppLink(o.contato, o) : null;

  const el = document.getElementById('oc-detail-modal');
  if (!el) return;

  el.querySelector('.oc-detail-header').innerHTML = `
    <span class="oc-badge ${statusCls[status]}">${statusLabel[status]}</span>
    <span class="oc-card-central"><i class="ti ti-building-warehouse"></i> ${escapeHtml(o.central || '—')}</span>
    ${o.material ? `<span class="oc-card-material"><i class="ti ti-box"></i> ${escapeHtml(o.material)}</span>` : ''}
    <span style="font-size:11px;color:var(--text3);font-family:var(--mono);margin-left:auto">${escapeHtml(o.id)}</span>`;

  el.querySelector('.oc-detail-dates').innerHTML = `
    <span class="oc-card-date-group" style="align-items:flex-start">
      <span class="oc-card-date-label">Abertura</span>
      <span class="oc-card-date-val">${fmtDateBR(o.dataAbertura)}</span>
    </span>
    ${o.dataLimite ? `<span class="oc-card-date-sep">→</span>
    <span class="oc-card-date-group ${status === 'vencida' ? 'oc-date-red' : status === 'urgente' ? 'oc-date-amber' : ''}" style="align-items:flex-start">
      <span class="oc-card-date-label">Prazo</span>
      <span class="oc-card-date-val">${fmtDateBR(o.dataLimite)}</span>
    </span>` : ''}
    ${o.concluida && o.dataConclusao ? `<span class="oc-card-date-sep">✓</span>
    <span class="oc-card-date-group oc-date-green" style="align-items:flex-start">
      <span class="oc-card-date-label">Conclusão</span>
      <span class="oc-card-date-val">${fmtDateBR(o.dataConclusao)}</span>
    </span>` : ''}`;

  el.querySelector('.oc-detail-desc').innerHTML = `
    <div class="oc-detail-section-label">Descrição</div>
    <div class="oc-detail-section-val">${escapeHtml(o.descricao || '—')}</div>`;

  el.querySelector('.oc-detail-conclusao').innerHTML = o.concluida && o.descConclusao ? `
    <div class="oc-detail-section-label">Conclusão</div>
    <div class="oc-detail-section-val" style="color:var(--green)">${escapeHtml(o.descConclusao)}</div>` : '';

  el.querySelector('.oc-detail-meta').innerHTML = `
    <span><i class="ti ti-user" style="margin-right:4px"></i>${escapeHtml(o.operador || '—')}</span>
    ${waLink ? `<a href="${waLink}" target="_blank" rel="noopener" class="oc-wa-btn"><i class="ti ti-brand-whatsapp"></i> ${escapeHtml(o.contato)}</a>` : ''}`;

  el.querySelector('.oc-detail-actions').innerHTML = `
    ${!o.concluida ? `<button class="btn btn-sm oc-btn-concluir" onclick="closeOcDetailModal();openConcluirModal('${o.id}')"><i class="ti ti-circle-check"></i> Concluir</button>` : ''}
    <button class="btn btn-sm" onclick="closeOcDetailModal();openOcorrenciaModal('${o.id}')"><i class="ti ti-edit"></i> Editar</button>
    <button class="btn btn-sm btn-danger-ghost" onclick="closeOcDetailModal();confirmarExcluirOcorrencia('${o.id}')"><i class="ti ti-trash"></i></button>`;

  el.classList.add('open');
}

function closeOcDetailModal() {
  document.getElementById('oc-detail-modal')?.classList.remove('open');
}

// ── Populares opções de filtro ────────────────────────────
function populateOcFiltros() {
  const centrais  = [...new Set((state.ocorrencias || []).map(o => o.central).filter(Boolean))].sort();
  const materiais = [...new Set((state.ocorrencias || []).map(o => o.material).filter(Boolean))].sort();
  const operadores = [...new Set((state.ocorrencias || []).map(o => o.operador).filter(Boolean))].sort();

  const selC = document.getElementById('oc-filter-central');
  const selM = document.getElementById('oc-filter-material');
  const selO = document.getElementById('oc-filter-operador');
  // Filtros: combina centrais/materiais do cadastro + das ocorrências existentes
  const allCentrals  = [...new Set([
    ...(state.filiais || []).map(f => (f.alias || f.origem || '').trim()),
    ...centrais
  ])].filter(Boolean).sort();
  const allMateriais = [...new Set([
    ...(state.materiais || []).map(m => (m.material || '').trim()),
    ...materiais
  ])].filter(Boolean).sort();

  if (selC) selC.innerHTML = '<option value="">Todas as centrais</option>'  + allCentrals.map(c  => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  if (selM) selM.innerHTML = '<option value="">Todos os materiais</option>' + allMateriais.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
  if (selO) selO.innerHTML = '<option value="">Todos os operadores</option>' + operadores.map(op => `<option value="${escapeHtml(op)}">${escapeHtml(op)}</option>`).join('');

  // Centrais do cadastro: campo "origem" (código/nome da central)
  const stCentrals  = (state.filiais  || [])
    .map(f => (f.alias || f.origem || '').trim())
    .filter(Boolean)
    .sort();
  // Materiais do cadastro: campo "material"
  const stMateriais = (state.materiais || [])
    .map(m => (m.material || '').trim())
    .filter(Boolean)
    .sort();

  const mCentral  = document.getElementById('oc-form-central');
  const mMaterial = document.getElementById('oc-form-material');

  if (mCentral) {
    const opts = [...new Set([...stCentrals, ...centrais])].sort();
    mCentral.innerHTML = '<option value="">Selecione a central</option>'
      + opts.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  }
  if (mMaterial) {
    const opts = [...new Set([...stMateriais, ...materiais])].sort();
    mMaterial.innerHTML = '<option value="">Selecione o material (opcional)</option>'
      + opts.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
  }
}

// ── Modal nova/editar ocorrência ──────────────────────────
function openOcorrenciaModal(id) {
  const o = id ? (state.ocorrencias || []).find(oc => oc.id === id) : null;
  populateOcFiltros();
  document.getElementById('oc-modal-title').textContent = o ? 'Editar Ocorrência' : 'Nova Ocorrência';
  document.getElementById('oc-form-id').value          = o?.id || '';
  document.getElementById('oc-form-abertura').value    = o?.dataAbertura  || new Date().toISOString().split('T')[0];
  document.getElementById('oc-form-limite').value      = o?.dataLimite    || '';
  document.getElementById('oc-form-central').value     = o?.central       || '';
  document.getElementById('oc-form-material').value    = o?.material      || '';
  document.getElementById('oc-form-operador').value    = o?.operador      || '';
  document.getElementById('oc-form-contato').value     = o?.contato       || '';
  document.getElementById('oc-form-descricao').value   = o?.descricao     || '';
  const motivoEl = document.getElementById('oc-form-motivo');
  if (motivoEl) motivoEl.value = o?.motivo || '';
  document.getElementById('oc-modal').classList.add('open');
}

function closeOcorrenciaModal() {
  document.getElementById('oc-modal').classList.remove('open');
}

function submitOcorrenciaForm() {
  const id         = document.getElementById('oc-form-id').value;
  const abertura   = document.getElementById('oc-form-abertura').value;
  const limite     = document.getElementById('oc-form-limite').value;
  const central    = document.getElementById('oc-form-central').value.trim();
  const material   = document.getElementById('oc-form-material').value.trim();
  const operador   = document.getElementById('oc-form-operador').value.trim();
  const contato    = document.getElementById('oc-form-contato').value.trim();
  const descricao  = document.getElementById('oc-form-descricao').value.trim();
  const motivo     = document.getElementById('oc-form-motivo')?.value.trim() || '';

  if (!central)   { toast('Informe a central.', 'error'); return; }
  if (!descricao) { toast('Informe a descrição da solicitação.', 'error'); return; }

  const existing = id ? (state.ocorrencias || []).find(o => o.id === id) : null;
  const ocorrencia = {
    id:           id || _nextOcId(),
    dataAbertura: abertura,
    motivo:       motivo,
    dataLimite:   limite || null,
    central,
    material:     material || null,
    operador:     operador || null,
    contato:      contato  || null,
    descricao,
    concluida:    existing?.concluida     || false,
    dataConclusao: existing?.dataConclusao || null,
    descConclusao: existing?.descConclusao || null,
    criadoEm:     existing?.criadoEm      || Date.now(),
  };

  saveOcorrencia(ocorrencia);
  closeOcorrenciaModal();
  populateOcFiltros();
  toast(id ? 'Ocorrência atualizada.' : 'Ocorrência registrada.', 'success');
}

// ── Modal concluir ────────────────────────────────────────
function openConcluirModal(id) {
  document.getElementById('oc-concluir-id').value = id;
  document.getElementById('oc-concluir-data').value = new Date().toISOString().split('T')[0];
  document.getElementById('oc-concluir-desc').value = '';
  document.getElementById('oc-concluir-modal').classList.add('open');
}

function closeConcluirModal() {
  document.getElementById('oc-concluir-modal').classList.remove('open');
}

function submitConcluir() {
  const id   = document.getElementById('oc-concluir-id').value;
  const data = document.getElementById('oc-concluir-data').value;
  const desc = document.getElementById('oc-concluir-desc').value.trim();
  if (!desc) { toast('Informe uma descrição da conclusão.', 'error'); return; }
  const o = (state.ocorrencias || []).find(oc => oc.id === id);
  if (!o) return;
  o.concluida     = true;
  o.dataConclusao = data;
  o.descConclusao = desc;
  persist();
  renderOcorrencias();
  closeConcluirModal();
  toast('Ocorrência concluída!', 'success');
}

// ── Excluir ───────────────────────────────────────────────
function confirmarExcluirOcorrencia(id) {
  const o = (state.ocorrencias || []).find(oc => oc.id === id);
  if (!o) return;
  const label = [o.central, o.material].filter(Boolean).join(' / ');
  // Usa toast com undo
  const prev = [...(state.ocorrencias || [])];
  deleteOcorrencia(id);
  toast(`Ocorrência "${label}" removida.`, 'info', 6000, () => {
    state.ocorrencias = prev;
    persist();
    renderOcorrencias();
  });
}

// ── Render inicial da página ──────────────────────────────
function renderOcorrenciasPage() {
  if (!Array.isArray(state.ocorrencias)) state.ocorrencias = [];
  populateOcFiltros();
  renderOcorrencias();
}

Object.assign(window, {
  renderOcorrenciasPage,
  renderOcorrencias,
  openOcorrenciaModal,
  closeOcorrenciaModal,
  submitOcorrenciaForm,
  openConcluirModal,
  closeConcluirModal,
  submitConcluir,
  confirmarExcluirOcorrencia,
  getOcorrenciasFiltradas,
  openOcDetailModal,
  closeOcDetailModal,
});
