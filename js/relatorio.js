window.gerarRelatorioGerencial = function() {
  const byLevel = window._rankByLevel;
  if (!byLevel || (!byLevel.critico.length && !byLevel.urgente.length)) {
    alert('Nenhum dado de criticidade disponível. Execute a análise primeiro.');
    return;
  }

  const dtIniEl = document.getElementById('an-dt-ini');
  const dtFimEl = document.getElementById('an-dt-fim');
  const periodo = (() => {
    const ini = dtIniEl?.value || '';
    const fim = dtFimEl?.value || '';
    if (!ini && !fim) return 'Período não especificado';
    const fmt = v => { if (!v) return ''; const [y,m,d] = v.split('-'); return `${d}/${m}/${y}`; };
    if (ini === fim) return fmt(ini);
    return `${fmt(ini)} a ${fmt(fim)}`;
  })();

  const now = new Date().toLocaleString('pt-BR');

  // ── Flatten all items ──
  const allItems = [
    ...byLevel.critico.map(i => ({...i, levelLabel:'CRÍTICO', levelPriority:0, levelColor:'#ef4444', levelBg:'#fef2f2', levelBorder:'#fca5a5', levelBgDark:'#7f1d1d'})),
    ...byLevel.urgente.map(i => ({...i, levelLabel:'URGENTE', levelPriority:1, levelColor:'#f97316', levelBg:'#fff7ed', levelBorder:'#fdba74', levelBgDark:'#7c2d12'})),
  ];

  // ── Group by regional ──
  const byRegional = {};
  allItems.forEach(item => {
    const reg = item.regional || '—';
    if (!byRegional[reg]) byRegional[reg] = { critico:[], urgente:[] };
    if (item.levelPriority === 0) byRegional[reg].critico.push(item);
    else byRegional[reg].urgente.push(item);
  });

  // Sort regionals: those with critico first, then urgente
  const regionalOrder = Object.entries(byRegional).sort((a, b) => {
    const aScore = a[1].critico.length * 1000 + a[1].urgente.length * 100;
    const bScore = b[1].critico.length * 1000 + b[1].urgente.length * 100;
    return bScore - aScore;
  });

  // ── Summary totals ──
  const totalCritico = byLevel.critico.length;
  const totalUrgente = byLevel.urgente.length;
  const totalGeral   = totalCritico + totalUrgente;

  // ── Helpers ──
  function fmtKgRel(v) {
    const n = Number(v) || 0;
    const abs = Math.abs(n);
    return abs.toLocaleString('pt-BR', {minimumFractionDigits:2,maximumFractionDigits:2}) + ' kg';
  }
  function varDir(v) { return v < -0.001 ? 'Desfalque' : v > 0.001 ? 'Sobra' : 'Equil.'; }
  function varDirColor(v) { return v < -0.001 ? '#ef4444' : v > 0.001 ? '#10b981' : '#6b7280'; }
  function trendLabel(t) {
    if (t === 'worsening') return '▲ Piorando';
    if (t === 'improving') return '▼ Melhorando';
    return '→ Estável';
  }
  function trendColor(t) {
    if (t === 'worsening') return '#ef4444';
    if (t === 'improving') return '#10b981';
    return '#6b7280';
  }
  function escRel(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // ── Build central summary per regional ──
  function buildCentralSummary(items) {
    const centrais = {};
    items.forEach(i => {
      if (!centrais[i.central]) centrais[i.central] = {critico:0, urgente:0, worstDiff:0};
      const c = centrais[i.central];
      if (i.levelPriority===0) c.critico++;
      else if (i.levelPriority===1) c.urgente++;
      if (i.diff < c.worstDiff) c.worstDiff = i.diff;
    });
    return Object.entries(centrais).sort((a,b) => {
      const as = a[1].critico*100 + a[1].urgente*10;
      const bs = b[1].critico*100 + b[1].urgente*10;
      return bs - as;
    });
  }

  // ── Build rows for a level table ──
  function buildLevelRows(items, levelColor) {
    return items.slice(0,20).map((item, idx) => {
      const dir = varDir(item.diff);
      const dc  = varDirColor(item.diff);
      const tc  = trendColor(item.trend);
      const tl  = trendLabel(item.trend);
      return `<tr class="data-row">
        <td class="rank-cell">${idx+1}</td>
        <td class="mat-cell"><span class="mat-name">${escRel(item.mat)}</span></td>
        <td class="central-cell">${escRel(item.central)}</td>
        <td class="var-cell" style="color:${dc}"><strong>${dir}</strong><br><span style="font-size:11px;font-weight:500">${fmtKgRel(item.diff)}</span></td>
        <td class="trend-cell" style="color:${tc}">${tl}</td>
      </tr>`;
    }).join('');
  }

  function buildRegionalSection(regName, data, regIdx) {
    const allRegItems = [...data.critico, ...data.urgente];
    const centrais = buildCentralSummary(allRegItems);
    const hasC = data.critico.length > 0;
    const hasU = data.urgente.length > 0;
    const regPriority = hasC ? 'CRÍTICO' : 'URGENTE';
    const regPriorityColor = hasC ? '#ef4444' : '#f97316';
    const regPriorityBg = hasC ? '#fef2f2' : '#fff7ed';
    const regPriorityBorder = hasC ? '#fca5a5' : '#fdba74';

    // Worst central badges
    const centralBadges = centrais.slice(0,5).map(([cn, cs]) => {
      const cl = cs.critico > 0 ? '#ef4444' : '#f97316';
      const cb = cs.critico > 0 ? '#fff1f2' : '#fff7ed';
      const cIcon = cs.critico > 0 ? '🔴' : '🟠';
      return `<span class="central-badge" style="background:${cb};border:1px solid ${cl}40;color:${cl}">${cIcon} ${escRel(cn)} <span style="opacity:.7">${cs.critico+cs.urgente} mat.</span></span>`;
    }).join('');

    // Level tables — only critico and urgente
    const levelSections = [];
    if (hasC) levelSections.push({
      color:'#ef4444', bg:'#fef2f2', border:'#fca5a5', icon:'🔴',
      label:'CRÍTICO', sublabel:'Ação imediata — escalar à gerência',
      items: data.critico, count: data.critico.length
    });
    if (hasU) levelSections.push({
      color:'#f97316', bg:'#fff7ed', border:'#fdba74', icon:'🟠',
      label:'URGENTE', sublabel:'Atenção redobrada — repassar aos regionais',
      items: data.urgente, count: data.urgente.length
    });

    const _gerGrad = {
      '#ef4444': 'linear-gradient(135deg,#7f1d1d 0%,#991b1b 60%,#b91c1c 100%)',
      '#f97316': 'linear-gradient(135deg,#7c2d12 0%,#9a3412 60%,#c2410c 100%)',
    };
    const _gerGlow = {
      '#ef4444': 'rgba(239,68,68,0.30)',
      '#f97316': 'rgba(249,115,22,0.28)',
    };
    const levelTablesHtml = levelSections.map(ls => {
      const grad = _gerGrad[ls.color] || ('linear-gradient(135deg,' + ls.color + ' 0%,' + ls.color + 'cc 100%)');
      const glow = _gerGlow[ls.color] || (ls.color + '44');
      return '<div class="level-section" style="margin-bottom:24px;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px ' + glow + ';page-break-inside:avoid">' +
        '<div style="background:' + grad + ';padding:20px 26px;display:flex;align-items:center;justify-content:space-between;position:relative;overflow:hidden">' +
          '<div style="position:absolute;right:-20px;top:-20px;width:100px;height:100px;border-radius:50%;background:rgba(255,255,255,0.06);pointer-events:none"></div>' +
          '<div style="position:absolute;right:52px;bottom:-28px;width:60px;height:60px;border-radius:50%;background:rgba(255,255,255,0.04);pointer-events:none"></div>' +
          '<div style="display:flex;align-items:center;gap:16px;position:relative">' +
            '<div style="width:52px;height:52px;border-radius:13px;background:rgba(255,255,255,0.13);border:1.5px solid rgba(255,255,255,0.22);display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">' + ls.icon + '</div>' +
            '<div>' +
              '<div style="font-size:20px;font-weight:900;color:#fff;letter-spacing:.07em;line-height:1;text-transform:uppercase">' + ls.label + '</div>' +
              '<div style="font-size:12px;color:rgba(255,255,255,0.62);margin-top:5px;font-weight:500">' + ls.sublabel + '</div>' +
            '</div>' +
          '</div>' +
          '<span style="background:rgba(255,255,255,0.15);border:1.5px solid rgba(255,255,255,0.25);color:#fff;padding:6px 16px;border-radius:24px;font-size:13px;font-weight:800;letter-spacing:.03em;position:relative">' + ls.count + ' ' + (ls.count>1?'materiais':'material') + '</span>' +
        '</div>' +
        '<div style="background:#fff;border:1px solid #e2e8f0;border-top:none">' +
          '<table class="data-table">' +
            '<thead><tr><th style="width:36px">#</th><th>Material</th><th>Central</th><th>Variação</th><th>Tendência</th></tr></thead>' +
            '<tbody>' + buildLevelRows(ls.items, ls.color) + '</tbody>' +
          '</table>' +
          (ls.items.length > 20 ? '<div class="overflow-note">+ ' + (ls.items.length - 20) + ' materiais adicionais não exibidos</div>' : '') +
        '</div>' +
      '</div>';
    }).join('');

    const bgColor = regIdx % 2 === 0 ? '#f8fafc' : '#ffffff';

    return `
    <div class="regional-section" style="page-break-inside:avoid">
      <div class="regional-header" style="background:${regPriorityBg};border:2px solid ${regPriorityBorder};border-left:6px solid ${regPriorityColor}">
        <div class="regional-header-left">
          <div class="regional-name">
            <span class="regional-icon" style="background:${regPriorityColor}20;color:${regPriorityColor}">R</span>
            ${escRel(regName)}
          </div>
          <div class="regional-centrais-wrap">${centralBadges}</div>
        </div>
        <div class="regional-header-right">
          <div class="reg-stat-block">
            <span class="reg-stat-num" style="color:#ef4444">${data.critico.length}</span>
            <span class="reg-stat-label">Críticos</span>
          </div>
          <div class="reg-stat-sep"></div>
          <div class="reg-stat-block">
            <span class="reg-stat-num" style="color:#f97316">${data.urgente.length}</span>
            <span class="reg-stat-label">Urgentes</span>
          </div>
          <div class="priority-badge" style="background:${regPriorityColor};color:#fff;margin-left:16px">${regPriority}</div>
        </div>
      </div>
      <div class="regional-body">
        ${levelTablesHtml}
      </div>
    </div>`;
  }

  // ── Generate full HTML ──
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Relatório Gerencial de Criticidade — ${periodo}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');

  * { box-sizing: border-box; margin:0; padding:0; }
  body {
    font-family: 'Inter', system-ui, sans-serif;
    background: #f1f5f9;
    color: #0f172a;
    font-size: 13px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  /* Print wrapper */
  .page-wrap { max-width:1100px; margin:0 auto; padding:20px; }

  /* Top action bar */
  .action-bar {
    position: sticky; top: 0; z-index: 100;
    background: #1e293b;
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 24px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.2);
  }
  .action-bar-title { color: #e2e8f0; font-size: 13px; font-weight: 500; }
  .action-bar-title span { color: #64748b; font-size: 12px; margin-left: 10px; }
  .action-bar-btns { display: flex; gap: 10px; }
  .btn-print {
    background: #2563eb; color: #fff; border: none; border-radius: 7px;
    padding: 8px 18px; font-size: 13px; font-weight: 600; cursor: pointer;
    display: flex; align-items: center; gap: 7px; transition: background .15s;
  }
  .btn-print:hover { background: #1d4ed8; }
  .btn-close {
    background: #334155; color: #cbd5e1; border: none; border-radius: 7px;
    padding: 8px 14px; font-size: 13px; font-weight: 500; cursor: pointer;
    transition: background .15s;
  }
  .btn-close:hover { background: #475569; }

  /* Report header */
  .report-header {
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
    color: #fff;
    border-radius: 14px;
    padding: 32px 36px;
    margin-bottom: 24px;
    position: relative;
    overflow: hidden;
  }
  .report-header::before {
    content: '';
    position: absolute; top:-40px; right:-40px;
    width:200px; height:200px;
    border-radius:50%;
    background: rgba(239,68,68,0.08);
    border: 2px solid rgba(239,68,68,0.12);
  }
  .report-header::after {
    content: '';
    position: absolute; bottom:-60px; right:80px;
    width:150px; height:150px;
    border-radius:50%;
    background: rgba(245,158,11,0.06);
    border: 2px solid rgba(245,158,11,0.10);
  }
  .report-header-top { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:24px; }
  .report-logo-area { display:flex; align-items:center; gap:12px; }
  .report-logo-icon {
    width:48px; height:48px; border-radius:12px;
    background: rgba(239,68,68,0.18);
    border: 1px solid rgba(239,68,68,0.3);
    display:flex; align-items:center; justify-content:center;
    font-size:22px;
  }
  .report-logo-text h1 { font-size:20px; font-weight:800; color:#f8fafc; letter-spacing:-0.01em; }
  .report-logo-text p { font-size:12px; color:#94a3b8; font-weight:400; margin-top:2px; }
  .report-meta { text-align:right; }
  .report-meta .meta-label { font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:.06em; }
  .report-meta .meta-value { font-size:13px; color:#cbd5e1; font-weight:500; margin-top:2px; }
  .report-urgency-banner {
    background: rgba(239,68,68,0.12);
    border: 1px solid rgba(239,68,68,0.25);
    border-radius: 10px;
    padding: 14px 20px;
    display: flex; align-items: center; gap: 14px;
    margin-bottom: 20px;
  }
  .urgency-icon { font-size: 24px; }
  .urgency-title { font-size: 14px; font-weight: 700; color: #fca5a5; letter-spacing:.01em; }
  .urgency-desc { font-size: 12px; color: #94a3b8; margin-top:2px; }
  .report-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .stat-card {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 10px;
    padding: 16px 18px;
    text-align: center;
    transition: transform .15s;
  }
  .stat-card-num { font-size: 32px; font-weight: 800; line-height: 1; margin-bottom: 6px; font-family: 'JetBrains Mono', monospace; }
  .stat-card-label { font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: .05em; font-weight: 500; }
  .stat-card.s-critico .stat-card-num { color: #f87171; }
  .stat-card.s-urgente .stat-card-num { color: #fb923c; }
  .stat-card.s-atencao .stat-card-num { color: #fbbf24; }
  .stat-card.s-total .stat-card-num { color: #e2e8f0; }

  /* Section title */
  .section-title {
    font-size: 13px; font-weight: 700; color: #475569; text-transform: uppercase;
    letter-spacing: .08em; margin: 28px 0 14px;
    display: flex; align-items: center; gap: 10px;
  }
  .section-title::after {
    content: ''; flex: 1; height: 1px; background: #e2e8f0;
  }

  /* Regional section */
  .regional-section { margin-bottom: 28px; }
  .regional-header {
    border-radius: 12px 12px 0 0;
    padding: 18px 22px;
    display: flex; align-items: center; justify-content: space-between;
    flex-wrap: wrap; gap: 12px;
  }
  .regional-header-left { display:flex; flex-direction:column; gap:10px; }
  .regional-name {
    font-size: 18px; font-weight: 800; color: #0f172a;
    display: flex; align-items: center; gap: 10px;
    letter-spacing: -0.01em;
  }
  .regional-icon {
    width: 32px; height: 32px; border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-size: 13px; font-weight: 800;
  }
  .regional-centrais-wrap { display: flex; flex-wrap: wrap; gap: 6px; }
  .central-badge {
    padding: 4px 10px; border-radius: 20px;
    font-size: 11px; font-weight: 600;
  }
  .regional-header-right { display:flex; align-items:center; gap:0; }
  .reg-stat-block { text-align: center; padding: 0 18px; }
  .reg-stat-num { display: block; font-size: 26px; font-weight: 800; font-family: 'JetBrains Mono', monospace; line-height:1; }
  .reg-stat-label { font-size: 10px; text-transform: uppercase; letter-spacing:.06em; color: #64748b; font-weight: 600; margin-top:3px; display:block; }
  .reg-stat-sep { width: 1px; height: 40px; background: #e2e8f0; }
  .priority-badge {
    padding: 6px 14px; border-radius: 20px;
    font-size: 11px; font-weight: 800; letter-spacing: .08em;
  }

  /* Regional body */
  .regional-body { background: #fff; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px; padding: 18px; }

  /* Level section */
  .level-section { border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0; }
  .level-header {
    padding: 14px 18px;
    display: flex; align-items: center; justify-content: space-between;
  }
  .level-title { font-size: 14px; font-weight: 800; letter-spacing: .04em; }
  .level-subtitle { font-size: 11px; color: #64748b; font-weight: 500; margin-top: 2px; }
  .level-count {
    padding: 4px 12px; border-radius: 20px;
    font-size: 11px; font-weight: 700; letter-spacing: .04em;
  }

  /* Data table */
  .data-table { width: 100%; border-collapse: collapse; }
  .data-table thead tr { background: #f8fafc; }
  .data-table th {
    padding: 10px 14px;
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .07em; color: #64748b;
    text-align: left; border-bottom: 1px solid #e2e8f0;
  }
  .data-table tbody tr.data-row { border-bottom: 1px solid #f1f5f9; transition: background .1s; }
  .data-table tbody tr.data-row:last-child { border-bottom: none; }
  .data-table tbody tr.data-row:hover { background: #f8fafc; }
  .data-table td { padding: 10px 14px; vertical-align: middle; }
  .rank-cell { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #94a3b8; font-weight: 600; }
  .mat-cell { }
  .mat-name { font-weight: 700; font-size: 13px; color: #1e293b; }
  .central-cell { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #475569; font-weight: 500; }
  .var-cell { font-size: 12px; }
  .trend-cell { font-size: 11px; font-weight: 600; }

  .overflow-note {
    padding: 8px 14px; font-size: 11px; color: #94a3b8;
    background: #f8fafc; border-top: 1px solid #f1f5f9;
    font-style: italic;
  }

  /* Footer */
  .report-footer {
    margin-top: 36px; padding: 20px 24px;
    background: #1e293b; border-radius: 12px; color: #64748b;
    display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;
    font-size: 11px;
  }
  .report-footer strong { color: #94a3b8; }

  /* Confidential strip */
  .confidential-strip {
    text-align: center; padding: 10px;
    background: #fef2f2; border: 1px solid #fca5a5;
    border-radius: 8px; margin-bottom: 20px;
    font-size: 11px; color: #dc2626; font-weight: 700; letter-spacing: .08em;
    text-transform: uppercase;
  }

  /* Print */
  @media print {
    body { background: #fff !important; }
    .action-bar { display: none !important; }
    .page-wrap { padding: 0 !important; max-width: 100% !important; }
    .regional-section { page-break-inside: avoid; }
    .level-section { page-break-inside: avoid; }
    .report-header { background: #0f172a !important; -webkit-print-color-adjust: exact; color-adjust: exact; }
    .stat-card { -webkit-print-color-adjust: exact; color-adjust: exact; }
    .regional-header { -webkit-print-color-adjust: exact; color-adjust: exact; }
    .level-header { -webkit-print-color-adjust: exact; color-adjust: exact; }
    .priority-badge { -webkit-print-color-adjust: exact; color-adjust: exact; }
    .level-count { -webkit-print-color-adjust: exact; color-adjust: exact; }
    .action-bar { display: none; }
  }
</style>
</head>
<body>

<!-- Action bar (hidden on print) -->
<div class="action-bar">
  <div class="action-bar-title">
    Relatório Gerencial de Criticidade
    <span>Período: ${periodo} · Gerado em ${now}</span>
  </div>
  <div class="action-bar-btns">
    <button class="btn-print" onclick="window.print()">
      🖨️ Imprimir / Salvar PDF
    </button>
    <button class="btn-close" onclick="window.close()">✕ Fechar</button>
  </div>
</div>

<div class="page-wrap">

  <!-- Confidential strip -->
  <div class="confidential-strip" style="margin-top:18px">
    ⚠ Documento Confidencial — Uso interno · Diretoria e Regionais
  </div>

  <!-- Report header -->
  <div class="report-header">
    <div class="report-header-top">
      <div class="report-logo-area">
        <div class="report-logo-icon">📊</div>
        <div class="report-logo-text">
          <h1>Relatório Gerencial de Criticidade</h1>
          <p>AnalyticSys · Gestão Centralizada de Materiais</p>
        </div>
      </div>
      <div class="report-meta">
        <div class="meta-label">Período analisado</div>
        <div class="meta-value">${periodo}</div>
        <div class="meta-label" style="margin-top:8px">Gerado em</div>
        <div class="meta-value">${now}</div>
      </div>
    </div>

    <div class="report-urgency-banner">
      <span class="urgency-icon">🚨</span>
      <div>
        <div class="urgency-title">ALERTA DE CRITICIDADE — AÇÃO REQUERIDA</div>
        <div class="urgency-desc">Este relatório identifica materiais com variações críticas de estoque. Cada item listado representa um risco operacional que requer atenção imediata ou monitoramento reforçado.</div>
      </div>
    </div>

    <div class="report-stats">
      <div class="stat-card s-critico">
        <div class="stat-card-num">${totalCritico}</div>
        <div class="stat-card-label">🔴 Críticos</div>
      </div>
      <div class="stat-card s-urgente">
        <div class="stat-card-num">${totalUrgente}</div>
        <div class="stat-card-label">🟠 Urgentes</div>
      </div>
      <div class="stat-card s-total">
        <div class="stat-card-num">${totalGeral}</div>
        <div class="stat-card-label">⚪ Total no Relatório</div>
      </div>
    </div>
  </div>

  <!-- Rankings por Regional -->
  <div class="section-title">Rankings por Regional — Piores Centrais e Materiais</div>

  ${regionalOrder.map(([regName, data], idx) => buildRegionalSection(regName, data, idx)).join('')}

  <!-- Footer -->
  <div class="report-footer">
    <div>
      <strong>AnalyticSys</strong> · Gestão Centralizada de Materiais<br>
      Documento gerado automaticamente em ${now}
    </div>
    <div style="text-align:right">
      Período: <strong style="color:#94a3b8">${periodo}</strong><br>
      ${totalGeral} ocorrência${totalGeral !== 1 ? 's' : ''} (crítico + urgente) em ${regionalOrder.length} regional${regionalOrder.length !== 1 ? 'is' : ''}
    </div>
  </div>
</div>

</body>
</html>`;

  // ── Open in new window ──
  const w = window.open('', '_blank', 'width=1200,height=900,scrollbars=yes,resizable=yes');
  if (!w) { alert('Popups bloqueados! Permita pop-ups para este site para gerar o relatório.'); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
};

// ═══════════════════════════════════════════════════════════════════
// RELATÓRIO DE AUSÊNCIAS DE LANÇAMENTO
// ═══════════════════════════════════════════════════════════════════

function _buildAusenciasRelHTML({ titulo, periodo, geradoEm, regionaisData, totalDias, totalMats, totalCentrals, totalRegionais }) {
  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function fmtDate(d) {
    return String(d.getDate()).padStart(2,'0') + '/' +
           String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear();
  }

  // Monta HTML regional → central → materiais
  let blockIdx = 0;
  const regionalSections = (regionaisData || []).map(({ regional, centrais }) => {
    const totalRegAus = centrais.reduce((s, c) => s + c.mats.length, 0);
    const nCentrals   = centrais.length;

    const centraisHtml = centrais.map(({ central, mats }) => {
      const totalAus = mats.length;
      const matRows = mats.map(({ mat, tipo, dias, estoqueZerado, motivoZerado, ultimaData, ultimaPeso, ultimaEntrada, ultimaSaida, ultimoSap, totalLancs }, ri) => {
        const isSemanal = tipo === 'Semanal';
        const chips = dias.map(d =>
          `<span class="date-chip${estoqueZerado ? ' date-chip--zerado' : ''}">${fmtDate(d)}</span>`
        ).join('');
        const fmtD = d => d ? new Date(d).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' }) : '—';
        const _buildZeroTitleRel = () => {
          const lines = [];
          if (motivoZerado === 'peso_zero')    lines.push('Motivo: último lançamento registrou 0 kg');
          else if (motivoZerado === 'inatividade') lines.push('Motivo: sem lançamento há mais de 30 dias');
          lines.push(`Últ. estoque lançado: ${fmtD(ultimaData)}${ultimaPeso != null ? ' (' + Number(ultimaPeso).toLocaleString('pt-BR') + ' kg)' : ''}`);
          if (ultimaEntrada) lines.push(`Últ. entrada (NF): ${fmtD(ultimaEntrada)}`);
          if (ultimaSaida)   lines.push(`Últ. saída (OS): ${fmtD(ultimaSaida)}`);
          if (ultimoSap)     lines.push(`Últ. mov. SAP: ${fmtD(ultimoSap)}`);
          if (totalLancs != null) lines.push(`Total de lançamentos históricos: ${totalLancs}`);
          return lines.join('&#10;');
        };
        const zeroBadgeLabel = motivoZerado === 'inatividade' ? '&#9888; SEM MOVIMENTAÇÃO' : '&#9888; ESTOQUE ZERADO';
        const zeroBadge = estoqueZerado
          ? `<span class="badge-zerado" title="${_buildZeroTitleRel()}">${zeroBadgeLabel}</span>`
          : '';
        return `
          <tr class="${ri % 2 === 0 ? 'row-even' : 'row-odd'}${estoqueZerado ? ' row-zerado' : ''}">
            <td class="td-mat${estoqueZerado ? ' td-mat--zerado' : ''}">${esc(mat)}${zeroBadge}</td>
            <td class="td-tipo">
              <span class="badge-tipo ${isSemanal ? 'badge-semanal' : 'badge-diario'}">${tipo}</span>
            </td>
            <td class="td-count${estoqueZerado ? ' td-count--zerado' : ''}">${dias.length}</td>
            <td class="td-dates">${chips}</td>
          </tr>`;
      }).join('');

      return `
        <div class="central-block" style="animation-delay:${(blockIdx++) * 0.04}s">
          <div class="central-header">
            <div class="central-header-left">
              <span class="central-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 21h18M3 7l9-4 9 4M4 7v14M20 7v14M9 21v-4a3 3 0 0 1 6 0v4"/>
                </svg>
              </span>
              <span class="central-name">${esc(central)}</span>
              <span class="central-badge">${totalAus} ausência${totalAus !== 1 ? 's' : ''}</span>
            </div>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th style="width:30%">Material</th>
                <th style="width:100px">Frequência</th>
                <th style="width:90px;text-align:center">Ausências</th>
                <th>Datas sem lançamento</th>
              </tr>
            </thead>
            <tbody>${matRows}</tbody>
          </table>
        </div>`;
    }).join('');

    return `
      <div class="regional-block">
        <div class="regional-header">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          <span class="regional-name">${esc(regional)}</span>
          <span class="regional-badge">${totalRegAus} ausência${totalRegAus !== 1 ? 's' : ''}</span>
          <span class="regional-sub">${nCentrals} ${nCentrals !== 1 ? 'centrais' : 'central'}</span>
        </div>
        <div class="regional-centrais">${centraisHtml}</div>
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(titulo)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Segoe UI', 'Inter', system-ui, -apple-system, sans-serif;
      background: #f0f4f8;
      color: #1a2332;
      line-height: 1.5;
    }

    /* ── Header ── */
    .report-header {
      background: #ffffff;
      border-bottom: 3px solid #e8790a;
      padding: 0;
    }
    .header-top {
      background: #1a2332;
      padding: 20px 48px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
    }
    .logos-wrap {
      display: flex;
      align-items: center;
      gap: 28px;
    }
    .logo-concrelagos {
      height: 44px;
      width: auto;
      object-fit: contain;
      filter: invert(1) hue-rotate(178deg);
      opacity: .95;
    }
    .logo-sep {
      width: 1px;
      height: 40px;
      background: #334155;
    }
    .logo-analyticsys {
      display: flex;
      align-items: center;
      gap: 8px;
      opacity: .7;
    }
    .logo-analyticsys-text {
      font-size: 12px;
      font-weight: 800;
      letter-spacing: .06em;
      font-family: monospace;
      line-height: 1;
      color: #cbd5e1;
    }
    .logo-analyticsys-text span { color: #f97316; }
    .logo-analyticsys-sub {
      font-size: 8px;
      color: #64748b;
      letter-spacing: .14em;
      text-transform: uppercase;
      margin-top: 2px;
    }
    .header-meta {
      text-align: right;
      font-size: 11px;
      color: #64748b;
    }
    .header-meta strong { color: #94a3b8; }

    .header-body {
      padding: 28px 48px 24px;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 24px;
      flex-wrap: wrap;
    }
    .report-title {
      font-size: 24px;
      font-weight: 700;
      color: #1a2332;
      line-height: 1.2;
      letter-spacing: -.01em;
    }
    .report-period {
      font-size: 13px;
      color: #64748b;
      margin-top: 6px;
    }
    .report-period strong { color: #1a2332; }



    /* ── Alert ── */
    .alert-banner {
      background: #fffbeb;
      border-top: 1px solid #fde68a;
      border-bottom: 1px solid #fde68a;
      padding: 14px 48px;
      display: flex;
      align-items: flex-start;
      gap: 12px;
      font-size: 13px;
      color: #78350f;
      line-height: 1.6;
    }

    /* ── Content ── */
    .content {
      max-width: 1080px;
      margin: 0 auto;
      padding: 36px 48px;
    }

    /* ── Summary chips ── */
    .summary-chips {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .s-chip {
      display: inline-block;
      border-radius: 5px;
      padding: 4px 12px;
      font-size: 11px;
      font-weight: 700;
      font-family: monospace;
      letter-spacing: .04em;
      border: 1px solid;
    }
    .s-chip-red    { background: #fff1f2; color: #b91c1c; border-color: #fecdd3; }
    .s-chip-amber  { background: #fffbeb; color: #92400e; border-color: #fde68a; }
    .s-chip-blue   { background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; }
    .s-chip-purple { background: #f5f3ff; color: #6d28d9; border-color: #ddd6fe; }

    /* ── Regional block ── */
    .regional-block {
      margin-bottom: 32px;
      page-break-inside: avoid;
    }
    .regional-block:last-child { margin-bottom: 0; }
    .regional-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 18px;
      background: #1a2332;
      color: #e2e8f0;
      border-radius: 8px 8px 0 0;
      margin-bottom: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .regional-header svg { color: #60a5fa; flex-shrink: 0; }
    .regional-name {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: .06em;
      text-transform: uppercase;
      color: #f1f5f9;
    }
    .regional-badge {
      background: rgba(220,38,38,.25);
      color: #fca5a5;
      border: 1px solid rgba(220,38,38,.4);
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 10px;
      font-weight: 700;
      font-family: monospace;
    }
    .regional-sub {
      font-size: 10px;
      color: #64748b;
      font-family: monospace;
    }
    .regional-centrais {
      padding: 12px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-top: none;
      border-radius: 0 0 8px 8px;
    }
    .regional-centrais .central-block {
      margin-bottom: 12px;
    }
    .regional-centrais .central-block:last-child { margin-bottom: 0; }

    /* ── Central block ── */
    .central-block {
      background: #ffffff;
      border-radius: 10px;
      border: 1px solid #e2e8f0;
      overflow: hidden;
      margin-bottom: 20px;
      box-shadow: 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04);
      page-break-inside: avoid;
    }
    .central-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 13px 18px;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
    }
    .central-header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .central-icon {
      width: 28px;
      height: 28px;
      border-radius: 6px;
      background: #e8790a;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .central-name {
      font-size: 14px;
      font-weight: 700;
      color: #1a2332;
      letter-spacing: .02em;
    }
    .central-badge {
      font-size: 11px;
      font-weight: 700;
      font-family: monospace;
      letter-spacing: .04em;
      color: #b91c1c;
      background: #fff1f2;
      border: 1px solid #fecdd3;
      border-radius: 5px;
      padding: 3px 10px;
    }

    /* ── Table ── */
    .data-table {
      width: 100%;
      border-collapse: collapse;
    }
    .data-table thead tr {
      background: #f1f5f9;
    }
    .data-table th {
      padding: 9px 16px;
      font-size: 10.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .07em;
      color: #64748b;
      text-align: left;
      border-bottom: 1px solid #e2e8f0;
    }
    .row-even { background: #ffffff; }
    .row-odd  { background: #f8fafc; }
    .td-mat, .td-tipo, .td-count, .td-dates {
      padding: 9px 16px;
      border-bottom: 1px solid #f1f5f9;
      vertical-align: middle;
    }
    .td-mat {
      font-weight: 600;
      font-size: 13px;
      color: #1e293b;
    }
    .td-count {
      text-align: center;
      font-family: monospace;
      font-size: 14px;
      font-weight: 800;
      color: #dc2626;
    }
    .td-dates { line-height: 1.8; }

    /* ── Badges ── */
    .badge-tipo {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 700;
      font-family: monospace;
      letter-spacing: .04em;
    }
    .badge-diario  { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }

    /* Linha zerada */
    .row-zerado { background: #fff1f2 !important; }
    .td-mat--zerado { color: #b91c1c !important; font-weight: 700; }
    .td-count--zerado { color: #b91c1c !important; }
    .date-chip--zerado { opacity: .45; }
    .badge-zerado {
      display: inline-block;
      margin-left: 8px;
      padding: 1px 6px;
      border-radius: 3px;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: .05em;
      background: #fff1f2;
      color: #b91c1c;
      border: 1px solid #fecdd3;
      vertical-align: middle;
      white-space: nowrap;
    }
    .badge-semanal { background: #f5f3ff; color: #6d28d9; border: 1px solid #ddd6fe; }

    .date-chip {
      display: inline-block;
      background: #fff7ed;
      border: 1px solid #fed7aa;
      color: #9a3412;
      border-radius: 4px;
      padding: 2px 7px;
      font-size: 11px;
      font-family: monospace;
      white-space: nowrap;
      margin: 2px 3px 2px 0;
    }

    /* ── Footer ── */
    .report-footer {
      background: #1a2332;
      color: #64748b;
      padding: 18px 48px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      margin-top: 0;
    }
    .report-footer strong { color: #94a3b8; }

    @media print {
      body { background: #fff; }
      .central-block { box-shadow: none; border: 1px solid #e2e8f0; }
      .header-top { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .report-footer { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>

<div class="report-header">
  <div class="header-top">
    <div class="logos-wrap">
      <!-- Concrelagos em destaque -->
      <img class="logo-concrelagos"
        src="https://concrelagos.com.br/wp-content/uploads/2021/10/Ativo-3.svg"
        alt="Concrelagos Concreto">
      <div class="logo-sep"></div>
      <!-- AnalyticSys menor -->
      <div class="logo-analyticsys">
        <svg width="22" height="24" viewBox="0 0 40 44" fill="none">
          <polygon points="20,4 32,10 32,18 20,12" fill="#ff6b35" opacity=".95"/>
          <polygon points="20,4 8,10 8,18 20,12" fill="#ffb380" opacity=".95"/>
          <polygon points="20,12 32,18 8,18" fill="#ff6b35" opacity=".1"/>
          <polygon points="20,16 34,22 34,31 20,25" fill="#ff6b35" opacity=".65"/>
          <polygon points="20,16 6,22 6,31 20,25" fill="#ffb380" opacity=".65"/>
          <polygon points="20,29 36,36 36,44 20,37" fill="#ff6b35" opacity=".35"/>
          <polygon points="20,29 4,36 4,44 20,37" fill="#ffb380" opacity=".35"/>
        </svg>
        <div>
          <div class="logo-analyticsys-text">ANALYTIC<span>SYS</span></div>
          <div class="logo-analyticsys-sub">Estoque · Insumos</div>
        </div>
      </div>
    </div>
    <div class="header-meta">
      Gerado em <strong>${esc(geradoEm)}</strong>
    </div>
  </div>

  <div class="header-body">
    <div>
      <div class="report-title">${esc(titulo)}</div>
      <div class="report-period">Período de análise: <strong>${esc(periodo)}</strong></div>
    </div>
    <div class="summary-chips">
      <span class="s-chip s-chip-red">${totalDias} lançamento${totalDias !== 1 ? 's' : ''} ausente${totalDias !== 1 ? 's' : ''}</span>
      <span class="s-chip s-chip-amber">${totalMats} ${totalMats !== 1 ? 'materiais' : 'material'}</span>
      <span class="s-chip s-chip-blue">${totalCentrals} ${totalCentrals !== 1 ? 'centrais' : 'central'}</span>
      ${totalRegionais >= 1 ? `<span class="s-chip s-chip-purple">${totalRegionais} ${totalRegionais !== 1 ? 'regionais' : 'regional'}</span>` : ''}
    </div>
  </div>
</div>

<div class="alert-banner">
  <svg style="flex-shrink:0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
  <span><strong>ATENÇÃO:</strong> Os lançamentos abaixo estão <strong>ausentes</strong> no sistema e comprometem diretamente a integridade dos estoques, a confiabilidade das análises e a rastreabilidade operacional. A ausência de lançamento distorce variações e invalida o inventário do período. <strong style="color:#b45309;font-size:13.5px;display:inline-block;margin-top:4px">⚠ Regularização imediata é obrigatória.</strong></span>
</div>

<div class="content">
  ${regionalSections}
</div>

<div class="report-footer">
  <span>Concrelagos Concreto &nbsp;·&nbsp; <strong>AnalyticSys</strong> &nbsp;·&nbsp; Gestão Centralizada de Estoque e Insumos</span>
  <span>Período: <strong>${esc(periodo)}</strong></span>
</div>

</body>
</html>`;
}


// Converte ausencias para estrutura regional → centrais → mats
function _ausenciasParaRegionaisData(ausencias) {
  const byRegional = new Map();
  ausencias.forEach(a => {
    const regional = a.regional || 'Sem regional';
    if (!byRegional.has(regional)) byRegional.set(regional, new Map());
    const byCentral = byRegional.get(regional);
    if (!byCentral.has(a.central)) byCentral.set(a.central, []);
    byCentral.get(a.central).push({
      mat:           a.mat,
      tipo:          a.isSemanal ? 'Semanal' : 'Diário',
      dias:          a.diasAusentes,
      estoqueZerado: a.estoqueZerado  || false,
      motivoZerado:  a.motivoZerado   || null,
      ultimaData:    a.ultimaData     || null,
      ultimaPeso:    a.ultimoPeso     ?? null,
      ultimaEntrada: a.ultimaEntrada  || null,
      ultimaSaida:   a.ultimaSaida    || null,
      ultimoSap:     a.ultimoSap      || null,
      totalLancs:    a.totalLancs     ?? null,
    });
  });

  // Total de ausências por regional e central para ordenação maior → menor
  const totRegional = new Map();
  const totCentral  = new Map();
  ausencias.forEach(a => {
    const reg = a.regional || 'Sem regional';
    totRegional.set(reg,    (totRegional.get(reg)    || 0) + a.diasAusentes.length);
    totCentral.set(a.central, (totCentral.get(a.central) || 0) + a.diasAusentes.length);
  });

  return [...byRegional.entries()]
    .sort((a, b) =>
      (totRegional.get(b[0]) - totRegional.get(a[0])) ||
      a[0].localeCompare(b[0])
    )
    .map(([regional, byCentral]) => ({
      regional,
      centrais: [...byCentral.entries()]
        .sort((a, b) =>
          (totCentral.get(b[0]) - totCentral.get(a[0])) ||
          a[0].localeCompare(b[0])
        )
        .map(([central, mats]) => ({
          central,
          mats: mats.sort((a, b) => a.mat.localeCompare(b.mat))
        }))
    }));
}

function _ausGetPeriodo() {
  const ini = document.getElementById('aus-dt-ini')?.value || '';
  const fim = document.getElementById('aus-dt-fim')?.value || '';
  const fmt = v => { if (!v) return ''; const [y,m,d] = v.split('-'); return `${d}/${m}/${y}`; };
  if (!ini && !fim) return 'Período não especificado';
  return ini === fim ? fmt(ini) : `${fmt(ini)} a ${fmt(fim)}`;
}

// Relatório por central específica
window.gerarRelatorioAusenciasCentral = function(central) {
  if (!window._ausenciasData?.length) return;
  const ausencias = window._ausenciasData.filter(a => a.central === central);
  if (!ausencias.length) { alert('Nenhuma ausência para esta central.'); return; }

  const regionaisData = _ausenciasParaRegionaisData(ausencias);
  const diasUnicos    = new Set(ausencias.flatMap(a => a.diasAusentes.map(d => d.toISOString().slice(0,10)))).size;
  const matsUnicos    = new Set(ausencias.map(a => a.mat)).size;
  const periodo       = _ausGetPeriodo();
  const html = _buildAusenciasRelHTML({
    titulo:         `Ausências de Lançamento — ${central}`,
    periodo,
    geradoEm:       new Date().toLocaleString('pt-BR'),
    regionaisData,
    totalDias:      diasUnicos,
    totalMats:      matsUnicos,
    totalCentrals:  1,
    totalRegionais: 1
  });

  const w = window.open('', '_blank', 'width=1200,height=900,scrollbars=yes,resizable=yes');
  if (!w) { alert('Popups bloqueados! Permita pop-ups para gerar o relatório.'); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
};

// Relatório por regional específica
window.gerarRelatorioAusenciasRegional = function(regional) {
  if (!window._ausenciasData?.length) return;
  const ausencias = window._ausenciasData.filter(a => (a.regional || 'Sem regional') === regional);
  if (!ausencias.length) { alert('Nenhuma ausência para esta regional.'); return; }

  const regionaisData = _ausenciasParaRegionaisData(ausencias);
  const diasUnicos    = new Set(ausencias.flatMap(a => a.diasAusentes.map(d => d.toISOString().slice(0,10)))).size;
  const matsUnicos    = new Set(ausencias.map(a => a.mat)).size;
  const centralsCnt   = new Set(ausencias.map(a => a.central)).size;
  const periodo       = _ausGetPeriodo();
  const html = _buildAusenciasRelHTML({
    titulo:         `Ausências de Lançamento — ${regional}`,
    periodo,
    geradoEm:       new Date().toLocaleString('pt-BR'),
    regionaisData,
    totalDias:      diasUnicos,
    totalMats:      matsUnicos,
    totalCentrals:  centralsCnt,
    totalRegionais: 1
  });

  const w = window.open('', '_blank', 'width=1200,height=900,scrollbars=yes,resizable=yes');
  if (!w) { alert('Popups bloqueados! Permita pop-ups para gerar o relatório.'); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
};

// Relatório geral (todas as centrais filtradas)
window.gerarRelatorioAusenciasGeral = function() {
  if (!window._ausenciasData?.length) { alert('Nenhuma ausência no período selecionado.'); return; }

  const ausencias     = window._ausenciasData;
  const regionaisData = _ausenciasParaRegionaisData(ausencias);
  const diasUnicos    = new Set(ausencias.flatMap(a => a.diasAusentes.map(d => d.toISOString().slice(0,10)))).size;
  const matsUnicos    = new Set(ausencias.map(a => a.mat)).size;
  const centralsCnt   = new Set(ausencias.map(a => a.central)).size;
  const regionaisCnt  = new Set(ausencias.map(a => a.regional || 'Sem regional')).size;
  const periodo       = _ausGetPeriodo();
  const html = _buildAusenciasRelHTML({
    titulo:         'Relatório Geral de Ausências de Lançamento',
    periodo,
    geradoEm:       new Date().toLocaleString('pt-BR'),
    regionaisData,
    totalDias:      diasUnicos,
    totalMats:      matsUnicos,
    totalCentrals:  centralsCnt,
    totalRegionais: regionaisCnt
  });

  const w = window.open('', '_blank', 'width=1200,height=900,scrollbars=yes,resizable=yes');
  if (!w) { alert('Popups bloqueados! Permita pop-ups para gerar o relatório.'); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
};


// ═══════════════════════════════════════════════════════════════════
// RELATÓRIO POR REGIONAL (Crítico + Urgente de todas as centrais)
// ═══════════════════════════════════════════════════════════════════

window.gerarRelatorioRegional = function(regionalName) {
  const byLevel = window._rankByLevel;
  if (!byLevel) { alert('Nenhum dado de criticidade disponível. Execute a análise primeiro.'); return; }

  // Filtra itens do regional
  const filter = item => (item.regional || '—') === regionalName;
  const criticos = (byLevel.critico || []).filter(filter);
  const urgentes = (byLevel.urgente || []).filter(filter);
  const atencoes = (byLevel.atencao || []).filter(filter);

  if (!criticos.length && !urgentes.length) {
    alert('Nenhum material crítico ou urgente para este regional.');
    return;
  }

  const periodo = _getAnPeriodo();
  const now = new Date().toLocaleString('pt-BR');

  // Helpers compartilhados
  function fmtKgR(v) { const n = Math.abs(Number(v)||0); return n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+' kg'; }
  function varDir(v) { return v < -0.001 ? 'Desfalque' : v > 0.001 ? 'Sobra' : 'Equil.'; }
  function varDirColor(v) { return v < -0.001 ? '#ef4444' : v > 0.001 ? '#10b981' : '#6b7280'; }
  function trendLabel(t) { return t==='worsening'?'▲ Piorando':t==='improving'?'▼ Melhorando':'→ Estável'; }
  function trendColor(t) { return t==='worsening'?'#ef4444':t==='improving'?'#10b981':'#6b7280'; }
  function escR(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // Agrupa por central
  function groupByCentral(items) {
    const m = {};
    items.forEach(i => { if (!m[i.central]) m[i.central]=[]; m[i.central].push(i); });
    return Object.entries(m).sort((a,b) => b[1].length - a[1].length);
  }

  function buildMatRows(items) {
    return items.map((item,idx) => {
      const dc = varDirColor(item.diff); const tc = trendColor(item.trend);
      return `<tr class="data-row">
        <td class="rank-cell">${idx+1}</td>
        <td class="mat-cell"><span class="mat-name">${escR(item.mat)}</span></td>
        <td class="var-cell" style="color:${dc}"><strong>${varDir(item.diff)}</strong><br><span style="font-size:11px">${fmtKgR(item.diff)}</span></td>
        <td class="trend-cell" style="color:${tc}">${trendLabel(item.trend)}</td>
      </tr>`;
    }).join('');
  }

  function buildCentralBlock(centralName, items, levelColor, levelBg, levelBorder, levelIcon, levelLabel) {
    return `
    <div class="central-section" style="margin-bottom:16px;border:1px solid ${levelBorder};border-left:4px solid ${levelColor};border-radius:8px;overflow:hidden;page-break-inside:avoid">
      <div style="background:${levelBg};padding:12px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid ${levelBorder}">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:16px">${levelIcon}</span>
          <div>
            <div style="font-size:13px;font-weight:700;color:${levelColor}">${escR(centralName)}</div>
            <div style="font-size:11px;color:#64748b;margin-top:2px">${levelLabel}</div>
          </div>
        </div>
        <span style="background:${levelColor};color:#fff;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">${items.length} ${items.length>1?'materiais':'material'}</span>
      </div>
      <table class="data-table">
        <thead><tr><th style="width:36px">#</th><th>Material</th><th>Variação</th><th>Tendência</th></tr></thead>
        <tbody>${buildMatRows(items)}</tbody>
      </table>
    </div>`;
  }

  // Monta seções por nível
  const levels = [
    { key:'critico', items:criticos, color:'#ef4444', bg:'#fef2f2', border:'#fca5a5', icon:'🔴', label:'CRÍTICO — Ação imediata · Escalar à gerência', sectionTitle:'🔴 Crítico', sublabel:'Ação imediata — escalar à gerência' },
    { key:'urgente', items:urgentes, color:'#f97316', bg:'#fff7ed', border:'#fdba74', icon:'🟠', label:'URGENTE — Atenção redobrada · Repassar aos operadores', sectionTitle:'🟠 Urgente', sublabel:'Atenção redobrada — repassar aos operadores' },
  ].filter(l => l.items.length > 0);

  const levelBgGradient = { critico: 'linear-gradient(135deg,#7f1d1d 0%,#991b1b 60%,#b91c1c 100%)', urgente: 'linear-gradient(135deg,#7c2d12 0%,#9a3412 60%,#c2410c 100%)' };
  const levelGlow      = { critico: 'rgba(239,68,68,0.35)', urgente: 'rgba(249,115,22,0.35)' };

  const sectionsHtml = levels.map(l => {
    const byCentral = groupByCentral(l.items);
    const centraisHtml = byCentral.map(([cn, items]) =>
      buildCentralBlock(cn, items, l.color, l.bg, l.border, l.icon, l.sublabel)
    ).join('');
    const grad = levelBgGradient[l.key] || ('linear-gradient(135deg,' + l.color + ' 0%,' + l.color + 'cc 100%)');
    const glow = levelGlow[l.key] || (l.color + '55');
    const levelNameMap = { critico: 'CRÍTICO', urgente: 'URGENTE' };
    const levelName = levelNameMap[l.key] || l.key.toUpperCase();
    return '<div class="level-group" style="margin-bottom:36px">' +
      '<div style="background:' + grad + ';border-radius:12px 12px 0 0;padding:22px 28px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 4px 24px ' + glow + ';position:relative;overflow:hidden">' +
        '<div style="position:absolute;right:-24px;top:-24px;width:120px;height:120px;border-radius:50%;background:rgba(255,255,255,0.06);pointer-events:none"></div>' +
        '<div style="position:absolute;right:60px;bottom:-40px;width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,0.04);pointer-events:none"></div>' +
        '<div style="display:flex;align-items:center;gap:18px;position:relative">' +
          '<div style="width:56px;height:56px;border-radius:14px;background:rgba(255,255,255,0.12);border:1.5px solid rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;font-size:26px;flex-shrink:0">' + l.icon + '</div>' +
          '<div>' +
            '<div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:.06em;line-height:1;text-transform:uppercase">' + levelName + '</div>' +
            '<div style="font-size:12px;color:rgba(255,255,255,0.65);margin-top:5px;font-weight:500;letter-spacing:.02em">' + l.sublabel + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;position:relative">' +
          '<span style="background:rgba(255,255,255,0.15);border:1.5px solid rgba(255,255,255,0.25);color:#fff;padding:6px 18px;border-radius:24px;font-size:13px;font-weight:800;letter-spacing:.03em">' + l.items.length + ' ' + (l.items.length>1?'materiais':'material') + '</span>' +
          '<span style="font-size:11px;color:rgba(255,255,255,0.5);font-weight:600">' + byCentral.length + ' ' + (byCentral.length>1?'centrais':'central') + ' afetada' + (byCentral.length>1?'s':'') + '</span>' +
        '</div>' +
      '</div>' +
      '<div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:18px">' +
        centraisHtml +
      '</div>' +
    '</div>';
  }).join('');

  // Sumário
  const totalGeral = criticos.length + urgentes.length;
  const centraisAfetadas = new Set([...criticos,...urgentes].map(i=>i.central)).size;

  const html = _buildRelRegionalHTML({
    titulo: `Relatório Regional — ${regionalName}`,
    subtitulo: 'Materiais Críticos e Urgentes',
    periodo, now,
    totalCritico: criticos.length, totalUrgente: urgentes.length, totalGeral,
    centraisAfetadas, sectionsHtml,
    escR, regionalName,
  });

  _openRelWindow(html);
};

function _getAnPeriodo() {
  const ini = document.getElementById('an-dt-ini')?.value || '';
  const fim = document.getElementById('an-dt-fim')?.value || '';
  if (!ini && !fim) return 'Período não especificado';
  const fmt = v => { if (!v) return ''; const [y,m,d] = v.split('-'); return `${d}/${m}/${y}`; };
  return ini === fim ? fmt(ini) : `${fmt(ini)} a ${fmt(fim)}`;
}

function _openRelWindow(html) {
  const w = window.open('', '_blank', 'width=1200,height=900,scrollbars=yes,resizable=yes');
  if (!w) { alert('Popups bloqueados! Permita pop-ups para gerar o relatório.'); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
}

function _buildRelRegionalHTML({ titulo, subtitulo, periodo, now, totalCritico, totalUrgente, totalGeral, centraisAfetadas, sectionsHtml, escR, regionalName }) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>${titulo}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Inter',system-ui,sans-serif; background:#f1f5f9; color:#0f172a; font-size:13px; line-height:1.5; -webkit-font-smoothing:antialiased; }
  .page-wrap { max-width:1100px; margin:0 auto; padding:20px; }
  .action-bar { position:sticky;top:0;z-index:100;background:#1e293b;display:flex;align-items:center;justify-content:space-between;padding:12px 24px;box-shadow:0 2px 12px rgba(0,0,0,0.2); }
  .action-bar-title { color:#e2e8f0;font-size:13px;font-weight:500; }
  .action-bar-title span { color:#64748b;font-size:12px;margin-left:10px; }
  .action-bar-btns { display:flex;gap:10px; }
  .btn-print { background:#2563eb;color:#fff;border:none;border-radius:7px;padding:8px 18px;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:7px; }
  .btn-print:hover { background:#1d4ed8; }
  .btn-close { background:#334155;color:#cbd5e1;border:none;border-radius:7px;padding:8px 14px;font-size:13px;font-weight:500;cursor:pointer; }
  .btn-close:hover { background:#475569; }
  .report-header { background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);color:#fff;border-radius:14px;padding:32px 36px;margin-bottom:24px;position:relative;overflow:hidden; }
  .report-header::before { content:'';position:absolute;top:-40px;right:-40px;width:200px;height:200px;border-radius:50%;background:rgba(239,68,68,0.08);border:2px solid rgba(239,68,68,0.12); }
  .report-header-top { display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px; }
  .report-logo-area { display:flex;align-items:center;gap:12px; }
  .report-logo-icon { width:48px;height:48px;border-radius:12px;background:rgba(239,68,68,0.18);border:1px solid rgba(239,68,68,0.3);display:flex;align-items:center;justify-content:center;font-size:22px; }
  .report-logo-text h1 { font-size:18px;font-weight:800;color:#f8fafc;letter-spacing:-0.01em; }
  .report-logo-text p { font-size:12px;color:#94a3b8;font-weight:400;margin-top:2px; }
  .report-meta { text-align:right; }
  .report-meta .meta-label { font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.06em; }
  .report-meta .meta-value { font-size:13px;color:#cbd5e1;font-weight:500;margin-top:2px; }
  .report-stats { display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:20px; }
  .stat-card { background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:16px 18px;text-align:center; }
  .stat-card-num { font-size:28px;font-weight:800;line-height:1;margin-bottom:6px;font-family:'JetBrains Mono',monospace; }
  .stat-card-label { font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;font-weight:500; }
  .confidential-strip { background:linear-gradient(90deg,#7f1d1d,#991b1b);color:#fecaca;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:7px 18px;border-radius:8px;text-align:center;margin-bottom:16px; }
  .section-title { font-size:13px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.08em;margin:28px 0 14px;display:flex;align-items:center;gap:10px; }
  .section-title::after { content:'';flex:1;height:1px;background:#e2e8f0; }
  .data-table { width:100%;border-collapse:collapse;font-size:12px; }
  .data-table th { background:#f8fafc;padding:9px 12px;text-align:left;font-weight:700;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid #e2e8f0; }
  .data-table td { padding:9px 12px;border-bottom:1px solid #f1f5f9;vertical-align:top; }
  .data-row:hover { background:#f8fafc; }
  .rank-cell { color:#94a3b8;font-weight:700;font-family:'JetBrains Mono',monospace;font-size:11px; }
  .mat-name { font-weight:600;color:#0f172a; }
  .report-footer { margin-top:40px;padding:20px 24px;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#64748b; }
  @media print {
    .action-bar { display:none; }
    body { background:#fff !important; }
    .page-wrap { padding:0 !important;max-width:100% !important; }
    .report-header { background:#0f172a !important;-webkit-print-color-adjust:exact;color-adjust:exact; }
    .central-section { page-break-inside:avoid; }
  }
</style>
</head>
<body>
<div class="action-bar">
  <div class="action-bar-title">${escR(titulo)} <span>Período: ${escR(periodo)} · Gerado em ${now}</span></div>
  <div class="action-bar-btns">
    <button class="btn-print" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button>
    <button class="btn-close" onclick="window.close()">✕ Fechar</button>
  </div>
</div>
<div class="page-wrap">
  <div class="confidential-strip" style="margin-top:18px">⚠ Documento Confidencial — Uso interno · Regional e Gerência</div>
  <div class="report-header">
    <div class="report-header-top">
      <div class="report-logo-area">
        <div class="report-logo-icon">📋</div>
        <div class="report-logo-text">
          <h1>${escR(titulo)}</h1>
          <p>${escR(subtitulo)} · AnalyticSys</p>
        </div>
      </div>
      <div class="report-meta">
        <div class="meta-label">Período analisado</div>
        <div class="meta-value">${escR(periodo)}</div>
        <div class="meta-label" style="margin-top:8px">Gerado em</div>
        <div class="meta-value">${now}</div>
      </div>
    </div>
    <div class="report-stats">
      <div class="stat-card"><div class="stat-card-num" style="color:#f87171">${totalCritico}</div><div class="stat-card-label">🔴 Críticos</div></div>
      <div class="stat-card"><div class="stat-card-num" style="color:#fb923c">${totalUrgente}</div><div class="stat-card-label">🟠 Urgentes</div></div>
      <div class="stat-card"><div class="stat-card-num" style="color:#e2e8f0">${totalGeral}</div><div class="stat-card-label">📊 Total · ${centraisAfetadas} ${centraisAfetadas!==1?'centrais':'central'}</div></div>
    </div>
  </div>
  ${sectionsHtml}
  <div class="report-footer">
    <span>Concrelagos Concreto · <strong>AnalyticSys</strong> · Gestão Centralizada de Estoque e Insumos</span>
    <span>Período: <strong>${escR(periodo)}</strong></span>
  </div>
</div>
</body>
</html>`;
}


// ═══════════════════════════════════════════════════════════════════
// RELATÓRIO POR CENTRAL (Atenção + Urgente + Crítico)
// ═══════════════════════════════════════════════════════════════════

window.gerarRelatorioCentral = function(centralName) {
  const byLevel = window._rankByLevel;
  if (!byLevel) { alert('Nenhum dado de criticidade disponível. Execute a análise primeiro.'); return; }

  const filter = item => item.central === centralName;
  const criticos = (byLevel.critico || []).filter(filter);
  const urgentes = (byLevel.urgente || []).filter(filter);
  const atencoes = (byLevel.atencao || []).filter(filter);

  if (!criticos.length && !urgentes.length && !atencoes.length) {
    alert('Nenhum material crítico, urgente ou em atenção para esta central.');
    return;
  }

  const periodo = _getAnPeriodo();
  const now = new Date().toLocaleString('pt-BR');

  function fmtKgC(v) { const n=Math.abs(Number(v)||0); return n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+' kg'; }
  function varDir(v) { return v<-0.001?'Desfalque':v>0.001?'Sobra':'Equil.'; }
  function varDirColor(v) { return v<-0.001?'#ef4444':v>0.001?'#10b981':'#6b7280'; }
  function trendLabel(t) { return t==='worsening'?'▲ Piorando':t==='improving'?'▼ Melhorando':'→ Estável'; }
  function trendColor(t) { return t==='worsening'?'#ef4444':t==='improving'?'#10b981':'#6b7280'; }
  function escC(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function buildRows(items) {
    return items.map((item,idx) => {
      const dc=varDirColor(item.diff); const tc=trendColor(item.trend);
      return `<tr class="data-row">
        <td class="rank-cell">${idx+1}</td>
        <td class="mat-cell"><span class="mat-name">${escC(item.mat)}</span></td>
        <td class="var-cell" style="color:${dc}"><strong>${varDir(item.diff)}</strong><br><span style="font-size:11px">${fmtKgC(item.diff)}</span></td>
        <td class="trend-cell" style="color:${tc}">${trendLabel(item.trend)}</td>
      </tr>`;
    }).join('');
  }

  const _lvlGrad = {
    '#ef4444': 'linear-gradient(135deg,#7f1d1d 0%,#991b1b 60%,#b91c1c 100%)',
    '#f97316': 'linear-gradient(135deg,#7c2d12 0%,#9a3412 60%,#c2410c 100%)',
    '#f59e0b': 'linear-gradient(135deg,#78350f 0%,#92400e 60%,#b45309 100%)',
  };
  const _lvlGlow = {
    '#ef4444': 'rgba(239,68,68,0.35)',
    '#f97316': 'rgba(249,115,22,0.35)',
    '#f59e0b': 'rgba(245,158,11,0.30)',
  };

  function buildLevelSection(items, color, bg, border, icon, label, sublabel) {
    const grad = _lvlGrad[color] || ('linear-gradient(135deg,' + color + ' 0%,' + color + 'cc 100%)');
    const glow = _lvlGlow[color] || (color + '55');
    return (
      '<div style="margin-bottom:28px;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px ' + glow + ';page-break-inside:avoid">' +
        '<div style="background:' + grad + ';padding:20px 26px;display:flex;align-items:center;justify-content:space-between;position:relative;overflow:hidden">' +
          '<div style="position:absolute;right:-20px;top:-20px;width:100px;height:100px;border-radius:50%;background:rgba(255,255,255,0.06);pointer-events:none"></div>' +
          '<div style="position:absolute;right:50px;bottom:-32px;width:64px;height:64px;border-radius:50%;background:rgba(255,255,255,0.04);pointer-events:none"></div>' +
          '<div style="display:flex;align-items:center;gap:16px;position:relative">' +
            '<div style="width:52px;height:52px;border-radius:13px;background:rgba(255,255,255,0.13);border:1.5px solid rgba(255,255,255,0.22);display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">' + icon + '</div>' +
            '<div>' +
              '<div style="font-size:20px;font-weight:900;color:#fff;letter-spacing:.07em;line-height:1;text-transform:uppercase">' + label + '</div>' +
              '<div style="font-size:12px;color:rgba(255,255,255,0.62);margin-top:5px;font-weight:500">' + sublabel + '</div>' +
            '</div>' +
          '</div>' +
          '<span style="background:rgba(255,255,255,0.15);border:1.5px solid rgba(255,255,255,0.25);color:#fff;padding:6px 16px;border-radius:24px;font-size:13px;font-weight:800;letter-spacing:.03em;position:relative">' + items.length + ' ' + (items.length>1?'materiais':'material') + '</span>' +
        '</div>' +
        '<div style="background:#fff;border:1px solid #e2e8f0;border-top:none">' +
          '<table class="data-table"><thead><tr><th style="width:36px">#</th><th>Material</th><th>Variação</th><th>Tendência</th></tr></thead><tbody>' + buildRows(items) + '</tbody></table>' +
        '</div>' +
      '</div>'
    );
  }

  const sectionsHtml = [
    criticos.length && buildLevelSection(criticos,'#ef4444','#fef2f2','#fca5a5','🔴','CRÍTICO','Ação imediata — escalar à gerência'),
    urgentes.length && buildLevelSection(urgentes,'#f97316','#fff7ed','#fdba74','🟠','URGENTE','Atenção redobrada — repassar aos regionais'),
    atencoes.length && buildLevelSection(atencoes,'#f59e0b','#fffbeb','#fcd34d','⚠️','ATENÇÃO','Monitorar — contatar operador'),
  ].filter(Boolean).join('');

  const totalGeral = criticos.length + urgentes.length + atencoes.length;
  const regional = [...criticos,...urgentes,...atencoes][0]?.regional || '—';

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Relatório Central — ${escC(centralName)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
  * { box-sizing:border-box;margin:0;padding:0; }
  body { font-family:'Inter',system-ui,sans-serif;background:#f1f5f9;color:#0f172a;font-size:13px;line-height:1.5;-webkit-font-smoothing:antialiased; }
  .page-wrap { max-width:1100px;margin:0 auto;padding:20px; }
  .action-bar { position:sticky;top:0;z-index:100;background:#1e293b;display:flex;align-items:center;justify-content:space-between;padding:12px 24px;box-shadow:0 2px 12px rgba(0,0,0,0.2); }
  .action-bar-title { color:#e2e8f0;font-size:13px;font-weight:500; }
  .action-bar-title span { color:#64748b;font-size:12px;margin-left:10px; }
  .action-bar-btns { display:flex;gap:10px; }
  .btn-print { background:#2563eb;color:#fff;border:none;border-radius:7px;padding:8px 18px;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:7px; }
  .btn-print:hover { background:#1d4ed8; }
  .btn-close { background:#334155;color:#cbd5e1;border:none;border-radius:7px;padding:8px 14px;font-size:13px;font-weight:500;cursor:pointer; }
  .btn-close:hover { background:#475569; }
  .report-header { background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);color:#fff;border-radius:14px;padding:32px 36px;margin-bottom:24px;position:relative;overflow:hidden; }
  .report-header::before { content:'';position:absolute;top:-40px;right:-40px;width:200px;height:200px;border-radius:50%;background:rgba(239,68,68,0.08);border:2px solid rgba(239,68,68,0.12); }
  .report-header-top { display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px; }
  .report-logo-area { display:flex;align-items:center;gap:12px; }
  .report-logo-icon { width:48px;height:48px;border-radius:12px;background:rgba(239,68,68,0.18);border:1px solid rgba(239,68,68,0.3);display:flex;align-items:center;justify-content:center;font-size:22px; }
  .report-logo-text h1 { font-size:18px;font-weight:800;color:#f8fafc;letter-spacing:-0.01em; }
  .report-logo-text p { font-size:12px;color:#94a3b8;font-weight:400;margin-top:2px; }
  .report-meta { text-align:right; }
  .report-meta .meta-label { font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.06em; }
  .report-meta .meta-value { font-size:13px;color:#cbd5e1;font-weight:500;margin-top:2px; }
  .central-info-bar { display:flex;align-items:center;gap:16px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.10);border-radius:10px;padding:14px 18px;margin-bottom:20px;flex-wrap:wrap; }
  .central-info-item { display:flex;flex-direction:column;gap:2px; }
  .central-info-label { font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.06em; }
  .central-info-value { font-size:13px;color:#e2e8f0;font-weight:600; }
  .report-stats { display:grid;grid-template-columns:repeat(4,1fr);gap:14px; }
  .stat-card { background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:14px 16px;text-align:center; }
  .stat-card-num { font-size:26px;font-weight:800;line-height:1;margin-bottom:5px;font-family:'JetBrains Mono',monospace; }
  .stat-card-label { font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;font-weight:500; }
  .confidential-strip { background:linear-gradient(90deg,#7f1d1d,#991b1b);color:#fecaca;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:7px 18px;border-radius:8px;text-align:center;margin-bottom:16px; }
  .data-table { width:100%;border-collapse:collapse;font-size:12px; }
  .data-table th { background:#f8fafc;padding:9px 12px;text-align:left;font-weight:700;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid #e2e8f0; }
  .data-table td { padding:9px 12px;border-bottom:1px solid #f1f5f9;vertical-align:top; }
  .data-row:hover { background:#f8fafc; }
  .rank-cell { color:#94a3b8;font-weight:700;font-family:'JetBrains Mono',monospace;font-size:11px; }
  .mat-name { font-weight:600;color:#0f172a; }
  .report-footer { margin-top:40px;padding:20px 24px;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#64748b; }
  @media print {
    .action-bar { display:none; }
    body { background:#fff !important; }
    .page-wrap { padding:0 !important;max-width:100% !important; }
    .report-header { background:#0f172a !important;-webkit-print-color-adjust:exact;color-adjust:exact; }
  }
</style>
</head>
<body>
<div class="action-bar">
  <div class="action-bar-title">Relatório Central — ${escC(centralName)} <span>Período: ${escC(periodo)} · Gerado em ${now}</span></div>
  <div class="action-bar-btns">
    <button class="btn-print" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button>
    <button class="btn-close" onclick="window.close()">✕ Fechar</button>
  </div>
</div>
<div class="page-wrap">
  <div class="confidential-strip" style="margin-top:18px">⚠ Documento Confidencial — Uso interno · Operadores e Gerência</div>
  <div class="report-header">
    <div class="report-header-top">
      <div class="report-logo-area">
        <div class="report-logo-icon">🏭</div>
        <div class="report-logo-text">
          <h1>Relatório de Central</h1>
          <p>${escC(centralName)} · AnalyticSys · Gestão Centralizada de Materiais</p>
        </div>
      </div>
      <div class="report-meta">
        <div class="meta-label">Período analisado</div>
        <div class="meta-value">${escC(periodo)}</div>
        <div class="meta-label" style="margin-top:8px">Gerado em</div>
        <div class="meta-value">${now}</div>
      </div>
    </div>
    <div class="central-info-bar">
      <div class="central-info-item"><span class="central-info-label">Central</span><span class="central-info-value">${escC(centralName)}</span></div>
      <div style="width:1px;height:32px;background:rgba(255,255,255,0.1)"></div>
      <div class="central-info-item"><span class="central-info-label">Regional</span><span class="central-info-value">${escC(regional)}</span></div>
      <div style="width:1px;height:32px;background:rgba(255,255,255,0.1)"></div>
      <div class="central-info-item"><span class="central-info-label">Total de materiais</span><span class="central-info-value">${totalGeral} ${totalGeral!==1?'materiais':'material'}</span></div>
    </div>
    <div class="report-stats">
      <div class="stat-card"><div class="stat-card-num" style="color:#f87171">${criticos.length}</div><div class="stat-card-label">🔴 Críticos</div></div>
      <div class="stat-card"><div class="stat-card-num" style="color:#fb923c">${urgentes.length}</div><div class="stat-card-label">🟠 Urgentes</div></div>
      <div class="stat-card"><div class="stat-card-num" style="color:#fbbf24">${atencoes.length}</div><div class="stat-card-label">⚠️ Atenção</div></div>
      <div class="stat-card"><div class="stat-card-num" style="color:#e2e8f0">${totalGeral}</div><div class="stat-card-label">📊 Total Geral</div></div>
    </div>
  </div>
  ${sectionsHtml}
  <div class="report-footer">
    <span>Concrelagos Concreto · <strong>AnalyticSys</strong> · Gestão Centralizada de Estoque e Insumos</span>
    <span>Período: <strong>${escC(periodo)}</strong></span>
  </div>
</div>
</body>
</html>`;

  _openRelWindow(html);
};

// ═══════════════════════════════════════════════════════════════════════════════
// RELATÓRIO GERENCIAL DE OCORRÊNCIAS — visão executiva para diretoria
// ═══════════════════════════════════════════════════════════════════════════════
window.gerarRelatorioGeralOcorrencias = function() {
  const lista = (state.ocorrencias || []);
  if (!lista.length) {
    alert('Nenhuma ocorrência cadastrada para gerar o relatório.');
    return;
  }

  const now    = new Date().toLocaleString('pt-BR');
  const nowISO = new Date().toISOString().split('T')[0]; // YYYY-MM-DD de hoje

  // ── helpers ─────────────────────────────────────────────────────────────────
  function escR(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function fmtBR(iso) { if (!iso) return '—'; const [y,m,d] = iso.split('-'); return `${d}/${m}/${y}`; }

  // Dias entre duas datas ISO (b - a), inteiro
  function diffDays(aISO, bISO) {
    if (!aISO || !bISO) return null;
    const a = new Date(aISO + 'T00:00:00'), b = new Date(bISO + 'T00:00:00');
    if (isNaN(a) || isNaN(b)) return null;
    return Math.round((b - a) / 86400000);
  }

  function ocStatus(o) {
    if (o.concluida) return 'concluida';
    if (!o.dataLimite) return 'normal';
    const d = diffDays(nowISO, o.dataLimite);
    if (d < 0)  return 'vencida';
    if (d <= 2) return 'urgente';
    return 'normal';
  }

  // ── mapeamento central → regional via state.filiais ──────────────────────────
  const centralParaRegional = {};
  (state.filiais || []).forEach(f => {
    const key = (f.alias || f.origem || '').trim().toLowerCase();
    if (key) centralParaRegional[key] = (f.regional || '').trim() || 'Sem Regional';
  });
  function getRegional(central) {
    return centralParaRegional[(central||'').trim().toLowerCase()] || 'Sem Regional';
  }

  // ── KPIs globais ──────────────────────────────────────────────────────────────
  const total      = lista.length;
  const concluidas = lista.filter(o => o.concluida).length;
  const abertas    = total - concluidas;
  const vencidas   = lista.filter(o => ocStatus(o) === 'vencida').length;
  const urgentes   = lista.filter(o => ocStatus(o) === 'urgente').length;
  const normais    = abertas - vencidas - urgentes;
  const pctConc    = total > 0 ? Math.round(concluidas / total * 100) : 0;
  const pctVenc    = abertas > 0 ? Math.round(vencidas / abertas * 100) : 0;

  // Semáforo: vermelho se >30% vencidas dentre abertas, amarelo se >10%, verde se ok
  const semaforoColor = pctVenc > 30 ? '#ef4444' : pctVenc > 10 ? '#f59e0b' : '#10b981';
  const semaforoLabel = pctVenc > 30 ? 'CRÍTICO' : pctVenc > 10 ? 'ATENÇÃO' : 'NORMAL';
  const semaforoDesc  = pctVenc > 30
    ? `${pctVenc}% das ocorrências abertas estão com prazo vencido — ação imediata necessária.`
    : pctVenc > 10
    ? `${pctVenc}% das ocorrências abertas estão vencidas — acompanhamento necessário.`
    : `Situação sob controle. ${pctVenc}% de vencimento entre as abertas.`;

  // Tempo médio de conclusão (abertura→conclusão, em dias)
  let tempoTotal = 0, tempoCount = 0;
  lista.forEach(o => {
    if (!o.concluida || !o.dataAbertura || !o.dataConclusao) return;
    const d = diffDays(o.dataAbertura, o.dataConclusao);
    if (d === null || d < 0) return;
    tempoTotal += d; tempoCount++;
  });
  const tempoMedio = tempoCount > 0 ? (tempoTotal / tempoCount).toFixed(1) : null;

  // ── KPIs por regional ─────────────────────────────────────────────────────────
  const porRegional = {};
  lista.forEach(o => {
    const reg = getRegional(o.central);
    if (!porRegional[reg]) porRegional[reg] = { total:0, abertas:0, vencidas:0, urgentes:0, concluidas:0, tempoTotal:0, tempoCount:0 };
    const r = porRegional[reg];
    r.total++;
    const st = ocStatus(o);
    if (o.concluida) { r.concluidas++; }
    else             { r.abertas++;    }
    if (st === 'vencida') r.vencidas++;
    if (st === 'urgente') r.urgentes++;
    if (o.concluida && o.dataAbertura && o.dataConclusao) {
      const d = diffDays(o.dataAbertura, o.dataConclusao);
      if (d !== null && d >= 0) { r.tempoTotal += d; r.tempoCount++; }
    }
  });

  // Ordena: mais vencidas primeiro, depois mais urgentes
  const regionaisOrdenados = Object.entries(porRegional).sort((a, b) => {
    const scoreA = a[1].vencidas * 1000 + a[1].urgentes * 100 + a[1].abertas;
    const scoreB = b[1].vencidas * 1000 + b[1].urgentes * 100 + b[1].abertas;
    return scoreB - scoreA;
  });

  // ── KPIs por motivo ───────────────────────────────────────────────────────────
  const porMotivo = {};
  lista.forEach(o => {
    const m = (o.motivo || '').trim() || 'Sem motivo';
    if (!porMotivo[m]) porMotivo[m] = { total:0, abertas:0, vencidas:0 };
    porMotivo[m].total++;
    if (!o.concluida) porMotivo[m].abertas++;
    if (ocStatus(o) === 'vencida') porMotivo[m].vencidas++;
  });
  const motivosOrdenados = Object.entries(porMotivo).sort((a, b) => b[1].total - a[1].total);
  const maxMotivo = motivosOrdenados[0]?.[1]?.total || 1;

  // ── Top centrais com mais abertas ─────────────────────────────────────────────
  const porCentral = {};
  lista.forEach(o => {
    const c = o.central || '—';
    if (!porCentral[c]) porCentral[c] = { total:0, abertas:0, vencidas:0, urgentes:0 };
    porCentral[c].total++;
    if (!o.concluida) porCentral[c].abertas++;
    if (ocStatus(o) === 'vencida') porCentral[c].vencidas++;
    if (ocStatus(o) === 'urgente') porCentral[c].urgentes++;
  });
  const topCentrals = Object.entries(porCentral)
    .sort((a, b) => (b[1].vencidas * 100 + b[1].urgentes * 10 + b[1].abertas) - (a[1].vencidas * 100 + a[1].urgentes * 10 + a[1].abertas))
    .slice(0, 12);
  const maxCentral = topCentrals[0]?.[1]?.total || 1;

  // ── Pior regional (para badge no header) ─────────────────────────────────────
  const piorRegional = regionaisOrdenados[0];

  // ── Builders de seção ─────────────────────────────────────────────────────────
  function buildRegionalRow([reg, r]) {
    const tm = r.tempoCount > 0 ? (r.tempoTotal / r.tempoCount).toFixed(1) : '—';
    const pctR = r.total > 0 ? Math.round(r.concluidas / r.total * 100) : 0;
    const barW = r.total > 0 ? Math.round(r.concluidas / r.total * 100) : 0;
    const rowColor = r.vencidas > 0 ? '#fef2f2' : r.urgentes > 0 ? '#fffbeb' : '#f8fafc';
    const vencColor = r.vencidas > 0 ? '#ef4444' : '#94a3b8';
    const urgColor  = r.urgentes > 0 ? '#f59e0b' : '#94a3b8';
    return `
    <tr style="border-bottom:1px solid #f1f5f9;background:${rowColor}">
      <td style="padding:11px 14px;font-weight:700;font-size:13px;color:#0f172a">${escR(reg)}</td>
      <td style="padding:11px 14px;text-align:center;font-family:'JetBrains Mono',monospace;font-weight:700;font-size:15px;color:#1e293b">${r.total}</td>
      <td style="padding:11px 14px;text-align:center;font-family:'JetBrains Mono',monospace;font-weight:700;font-size:15px;color:#3b82f6">${r.abertas}</td>
      <td style="padding:11px 14px;text-align:center;font-family:'JetBrains Mono',monospace;font-weight:800;font-size:15px;color:${vencColor}">${r.vencidas}</td>
      <td style="padding:11px 14px;text-align:center;font-family:'JetBrains Mono',monospace;font-weight:800;font-size:15px;color:${urgColor}">${r.urgentes}</td>
      <td style="padding:11px 14px;text-align:center;font-family:'JetBrains Mono',monospace;font-size:12px;color:#475569">${tm === '—' ? '—' : tm + 'd'}</td>
      <td style="padding:11px 14px;min-width:130px">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden">
            <div style="width:${barW}%;height:100%;background:#10b981;border-radius:3px"></div>
          </div>
          <span style="font-size:11px;font-family:'JetBrains Mono',monospace;color:#475569;min-width:32px;text-align:right">${pctR}%</span>
        </div>
      </td>
    </tr>`;
  }

  function buildMotivoRow([motivo, m], idx) {
    const barW = Math.round(m.total / maxMotivo * 100);
    const vColor = m.vencidas > 0 ? '#ef4444' : '#94a3b8';
    return `
    <tr style="border-bottom:1px solid #f1f5f9">
      <td style="padding:10px 14px;font-size:11px;font-family:'JetBrains Mono',monospace;color:#94a3b8;font-weight:600">${idx+1}</td>
      <td style="padding:10px 14px;font-weight:600;font-size:13px;color:#1e293b">${escR(motivo)}</td>
      <td style="padding:10px 14px;min-width:160px">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;height:5px;background:#e2e8f0;border-radius:3px;overflow:hidden">
            <div style="width:${barW}%;height:100%;background:#3b82f6;border-radius:3px"></div>
          </div>
          <span style="font-size:11px;font-family:'JetBrains Mono',monospace;color:#475569;min-width:24px;text-align:right">${m.total}</span>
        </div>
      </td>
      <td style="padding:10px 14px;text-align:center;font-family:'JetBrains Mono',monospace;font-weight:700;font-size:13px;color:#3b82f6">${m.abertas}</td>
      <td style="padding:10px 14px;text-align:center;font-family:'JetBrains Mono',monospace;font-weight:700;font-size:13px;color:${vColor}">${m.vencidas}</td>
    </tr>`;
  }

  function buildCentralRow([central, c], idx) {
    const barW = Math.round(c.total / maxCentral * 100);
    const reg = getRegional(central);
    const vColor = c.vencidas > 0 ? '#ef4444' : '#94a3b8';
    const uColor = c.urgentes > 0 ? '#f59e0b' : '#94a3b8';
    const rowBg = c.vencidas > 0 ? '#fef2f2' : c.urgentes > 0 ? '#fffbeb' : '#ffffff';
    return `
    <tr style="border-bottom:1px solid #f1f5f9;background:${rowBg}">
      <td style="padding:10px 14px;font-size:11px;font-family:'JetBrains Mono',monospace;color:#94a3b8;font-weight:600">${idx+1}</td>
      <td style="padding:10px 14px;font-weight:700;font-size:13px;color:#1e293b">${escR(central)}</td>
      <td style="padding:10px 14px;font-size:11px;color:#64748b">${escR(reg)}</td>
      <td style="padding:10px 14px;min-width:130px">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;height:5px;background:#e2e8f0;border-radius:3px;overflow:hidden">
            <div style="width:${barW}%;height:100%;background:#6366f1;border-radius:3px"></div>
          </div>
          <span style="font-size:11px;font-family:'JetBrains Mono',monospace;color:#475569;min-width:20px;text-align:right">${c.total}</span>
        </div>
      </td>
      <td style="padding:10px 14px;text-align:center;font-family:'JetBrains Mono',monospace;font-weight:700;color:#3b82f6">${c.abertas}</td>
      <td style="padding:10px 14px;text-align:center;font-family:'JetBrains Mono',monospace;font-weight:800;color:${vColor}">${c.vencidas}</td>
      <td style="padding:10px 14px;text-align:center;font-family:'JetBrains Mono',monospace;font-weight:800;color:${uColor}">${c.urgentes}</td>
    </tr>`;
  }

  // ── HTML ──────────────────────────────────────────────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Relatório Gerencial de Ocorrências — ${now}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Inter',system-ui,sans-serif; background:#f1f5f9; color:#0f172a; font-size:13px; line-height:1.5; -webkit-font-smoothing:antialiased; }
  .page-wrap { max-width:1100px; margin:0 auto; padding:20px; }

  /* Action bar */
  .action-bar { position:sticky; top:0; z-index:100; background:#1e293b; display:flex; align-items:center; justify-content:space-between; padding:12px 24px; box-shadow:0 2px 12px rgba(0,0,0,0.2); }
  .action-bar-title { color:#e2e8f0; font-size:13px; font-weight:500; }
  .action-bar-title span { color:#64748b; font-size:12px; margin-left:10px; }
  .action-bar-btns { display:flex; gap:10px; }
  .btn-print { background:#2563eb; color:#fff; border:none; border-radius:7px; padding:8px 18px; font-size:13px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:7px; transition:background .15s; }
  .btn-print:hover { background:#1d4ed8; }
  .btn-close { background:#334155; color:#cbd5e1; border:none; border-radius:7px; padding:8px 14px; font-size:13px; font-weight:500; cursor:pointer; transition:background .15s; }
  .btn-close:hover { background:#475569; }

  /* Report header */
  .report-header { background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%); color:#fff; border-radius:14px; padding:32px 36px; margin-bottom:24px; position:relative; overflow:hidden; }
  .report-header::before { content:''; position:absolute; top:-40px; right:-40px; width:200px; height:200px; border-radius:50%; background:rgba(16,185,129,0.08); border:2px solid rgba(16,185,129,0.12); }
  .report-header::after { content:''; position:absolute; bottom:-60px; right:80px; width:150px; height:150px; border-radius:50%; background:rgba(239,68,68,0.06); border:2px solid rgba(239,68,68,0.10); }
  .report-header-top { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:24px; }
  .report-logo-area { display:flex; align-items:center; gap:12px; }
  .report-logo-icon { width:48px; height:48px; border-radius:12px; background:rgba(16,185,129,0.18); border:1px solid rgba(16,185,129,0.3); display:flex; align-items:center; justify-content:center; font-size:22px; }
  .report-logo-text h1 { font-size:20px; font-weight:800; color:#f8fafc; letter-spacing:-0.01em; }
  .report-logo-text p { font-size:12px; color:#94a3b8; font-weight:400; margin-top:2px; }
  .report-meta { text-align:right; }
  .meta-label { font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:.06em; }
  .meta-value { font-size:13px; color:#cbd5e1; font-weight:500; margin-top:2px; }

  /* Semáforo banner */
  .semaforo-banner { border-radius:10px; padding:16px 22px; display:flex; align-items:center; gap:16px; margin-bottom:22px; }
  .semaforo-dot { width:18px; height:18px; border-radius:50%; flex-shrink:0; }
  .semaforo-label { font-size:15px; font-weight:800; letter-spacing:.04em; }
  .semaforo-desc { font-size:12px; color:#94a3b8; margin-top:3px; }

  /* KPI grid */
  .kpi-grid { display:grid; grid-template-columns:repeat(5,1fr); gap:12px; margin-bottom:0; }
  .kpi-card { background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:16px 18px; text-align:center; }
  .kpi-num { font-size:30px; font-weight:800; font-family:'JetBrains Mono',monospace; line-height:1; margin-bottom:5px; }
  .kpi-label { font-size:10px; color:#94a3b8; text-transform:uppercase; letter-spacing:.05em; font-weight:500; }

  /* Section title */
  .section-title { font-size:12px; font-weight:700; color:#475569; text-transform:uppercase; letter-spacing:.08em; margin:28px 0 12px; display:flex; align-items:center; gap:10px; }
  .section-title::after { content:''; flex:1; height:1px; background:#e2e8f0; }

  /* Card wrapper */
  .card { background:#fff; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden; margin-bottom:20px; }
  .card-header { background:#f8fafc; border-bottom:1px solid #e2e8f0; padding:12px 18px; font-size:12px; font-weight:700; color:#475569; text-transform:uppercase; letter-spacing:.06em; display:flex; align-items:center; justify-content:space-between; }
  .card-badge { padding:3px 10px; border-radius:12px; font-size:11px; font-weight:700; }

  /* Tables */
  .data-table { width:100%; border-collapse:collapse; }
  .data-table thead tr { background:#f8fafc; }
  .data-table th { padding:10px 14px; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:#64748b; text-align:left; border-bottom:1px solid #e2e8f0; }
  .data-table th.center { text-align:center; }
  .data-table tbody tr:last-child { border-bottom:none; }

  /* Confidential */
  .confidential-strip { text-align:center; padding:10px; background:#fef2f2; border:1px solid #fca5a5; border-radius:8px; margin-bottom:20px; font-size:11px; color:#dc2626; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }

  /* Footer */
  .report-footer { margin-top:36px; padding:20px 24px; background:#1e293b; border-radius:12px; color:#64748b; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; font-size:11px; }
  .report-footer strong { color:#94a3b8; }

  /* Print */
  @media print {
    body { background:#fff !important; }
    .action-bar { display:none !important; }
    .page-wrap { padding:0 !important; max-width:100% !important; }
    .report-header { background:#0f172a !important; -webkit-print-color-adjust:exact; color-adjust:exact; }
    .kpi-card { -webkit-print-color-adjust:exact; color-adjust:exact; }
    .semaforo-banner { -webkit-print-color-adjust:exact; color-adjust:exact; }
    .card { page-break-inside:avoid; }
  }
</style>
</head>
<body>

<div class="action-bar">
  <div class="action-bar-title">
    Relatório Gerencial de Ocorrências
    <span>Gerado em ${now}</span>
  </div>
  <div class="action-bar-btns">
    <button class="btn-print" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button>
    <button class="btn-close" onclick="window.close()">✕ Fechar</button>
  </div>
</div>

<div class="page-wrap">

  <div class="confidential-strip" style="margin-top:18px">
    ⚠ Documento Confidencial — Uso interno · Diretoria
  </div>

  <!-- HEADER -->
  <div class="report-header">
    <div class="report-header-top">
      <div class="report-logo-area">
        <div class="report-logo-icon">📋</div>
        <div class="report-logo-text">
          <h1>Relatório Gerencial de Ocorrências</h1>
          <p>AnalyticSys · Gestão Centralizada de Materiais</p>
        </div>
      </div>
      <div class="report-meta">
        <div class="meta-label">Gerado em</div>
        <div class="meta-value">${now}</div>
        ${piorRegional ? `<div class="meta-label" style="margin-top:8px">Regional com mais atenção</div>
        <div class="meta-value" style="color:#fca5a5">${escR(piorRegional[0])}</div>` : ''}
      </div>
    </div>

    <!-- Semáforo executivo -->
    <div class="semaforo-banner" style="background:${semaforoColor}18;border:1px solid ${semaforoColor}40;margin-bottom:20px">
      <div class="semaforo-dot" style="background:${semaforoColor};box-shadow:0 0 10px ${semaforoColor}80"></div>
      <div>
        <div class="semaforo-label" style="color:${semaforoColor}">${semaforoLabel}</div>
        <div class="semaforo-desc">${escR(semaforoDesc)}</div>
      </div>
    </div>

    <!-- KPIs -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-num" style="color:#e2e8f0">${total}</div>
        <div class="kpi-label">Total de ocorrências</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num" style="color:#3b82f6">${abertas}</div>
        <div class="kpi-label">Em aberto</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num" style="color:#ef4444">${vencidas}</div>
        <div class="kpi-label">🔴 Vencidas</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num" style="color:#f59e0b">${urgentes}</div>
        <div class="kpi-label">🟡 Urgentes</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num" style="color:#10b981">${pctConc}%</div>
        <div class="kpi-label">✅ Concluídas</div>
      </div>
    </div>
  </div>

  <!-- TEMPO MÉDIO DE CONCLUSÃO (destaque) -->
  ${tempoMedio !== null ? `
  <div class="card" style="margin-bottom:20px">
    <div class="card-header">
      ⏱ Tempo Médio de Conclusão
      <span class="card-badge" style="background:#f0fdf4;color:#16a34a;border:1px solid #86efac">${tempoCount} ocorrência${tempoCount!==1?'s':''} concluída${tempoCount!==1?'s':''} com datas</span>
    </div>
    <div style="padding:20px 24px;display:flex;align-items:center;gap:32px;flex-wrap:wrap">
      <div style="display:flex;flex-direction:column;gap:4px">
        <span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.06em">Da abertura até a conclusão</span>
        <span style="font-size:42px;font-family:'JetBrains Mono',monospace;font-weight:800;color:#10b981;line-height:1">${tempoMedio}<span style="font-size:20px;font-weight:400;color:#64748b;margin-left:4px">dias</span></span>
        <span style="font-size:11px;color:#94a3b8">média entre as ${tempoCount} ocorrência${tempoCount!==1?'s':''} concluídas</span>
      </div>
      <div style="width:1px;height:60px;background:#e2e8f0;flex-shrink:0"></div>
      <div style="display:flex;flex-direction:column;gap:8px;flex:1;min-width:200px">
        <div style="display:flex;justify-content:space-between;font-size:12px">
          <span style="color:#64748b">Ocorrências abertas</span>
          <strong style="color:#3b82f6">${abertas}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px">
          <span style="color:#64748b">Vencidas (prazo expirado)</span>
          <strong style="color:#ef4444">${vencidas}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px">
          <span style="color:#64748b">Urgentes (vencem em até 2 dias)</span>
          <strong style="color:#f59e0b">${urgentes}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px">
          <span style="color:#64748b">Em prazo normal</span>
          <strong style="color:#6366f1">${normais}</strong>
        </div>
      </div>
    </div>
  </div>` : ''}

  <!-- TABELA POR REGIONAL -->
  <div class="section-title">Situação por Regional</div>
  <div class="card">
    <div class="card-header">
      🗺 Ranking de Regionais — ordenado por criticidade
      <span class="card-badge" style="background:#fef2f2;color:#ef4444;border:1px solid #fca5a5">${regionaisOrdenados.length} regional${regionaisOrdenados.length!==1?'is':''}</span>
    </div>
    <table class="data-table">
      <thead>
        <tr>
          <th>Regional</th>
          <th class="center">Total</th>
          <th class="center">Em Aberto</th>
          <th class="center">🔴 Vencidas</th>
          <th class="center">🟡 Urgentes</th>
          <th class="center">Tempo Médio</th>
          <th>% Concluídas</th>
        </tr>
      </thead>
      <tbody>
        ${regionaisOrdenados.map(buildRegionalRow).join('')}
      </tbody>
    </table>
  </div>

  <!-- TOP CENTRAIS -->
  <div class="section-title">Ranking de Centrais</div>
  <div class="card">
    <div class="card-header">
      🏭 Top ${topCentrals.length} Centrais — por volume e criticidade
      <span class="card-badge" style="background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe">top ${topCentrals.length}</span>
    </div>
    <table class="data-table">
      <thead>
        <tr>
          <th style="width:36px">#</th>
          <th>Central</th>
          <th>Regional</th>
          <th>Volume total</th>
          <th class="center">Em Aberto</th>
          <th class="center">🔴 Vencidas</th>
          <th class="center">🟡 Urgentes</th>
        </tr>
      </thead>
      <tbody>
        ${topCentrals.map(buildCentralRow).join('')}
      </tbody>
    </table>
  </div>

  <!-- OCORRÊNCIAS POR MOTIVO -->
  <div class="section-title">Distribuição por Motivo</div>
  <div class="card">
    <div class="card-header">
      🏷 Principais causas das ocorrências
      <span class="card-badge" style="background:#fefce8;color:#d97706;border:1px solid #fde68a">${motivosOrdenados.length} motivo${motivosOrdenados.length!==1?'s':''}</span>
    </div>
    <table class="data-table">
      <thead>
        <tr>
          <th style="width:36px">#</th>
          <th>Motivo</th>
          <th>Volume</th>
          <th class="center">Em Aberto</th>
          <th class="center">🔴 Vencidas</th>
        </tr>
      </thead>
      <tbody>
        ${motivosOrdenados.map(buildMotivoRow).join('')}
      </tbody>
    </table>
  </div>

  <div class="report-footer">
    <span>Concrelagos Concreto · <strong>AnalyticSys</strong> · Gestão Centralizada de Materiais</span>
    <span>Gerado em <strong>${now}</strong> · ${total} ocorrência${total!==1?'s':''} no total</span>
  </div>

</div><!-- /page-wrap -->
</body>
</html>`;

  _openRelWindow(html);
};

// ═══════════════════════════════════════════════════════════════════════════════
// RELATÓRIO DE COBRANÇA POR REGIONAL — ocorrências abertas/urgentes/vencidas
// ordenadas por prioridade crítica, com filtro por regional
// ═══════════════════════════════════════════════════════════════════════════════
window.gerarRelatorioCobrancaRegional = function(regionalFiltro) {
  const nowISO = new Date().toISOString().split('T')[0];
  const now    = new Date().toLocaleString('pt-BR');

  // ── helpers ─────────────────────────────────────────────────────────────────
  function escR(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function fmtBR(iso) { if (!iso) return '—'; const [y,m,d] = iso.split('-'); return `${d}/${m}/${y}`; }
  function diffDays(aISO, bISO) {
    if (!aISO || !bISO) return null;
    const a = new Date(aISO+'T00:00:00'), b = new Date(bISO+'T00:00:00');
    if (isNaN(a)||isNaN(b)) return null;
    return Math.round((b - a) / 86400000);
  }
  function ocStatus(o) {
    if (o.concluida) return 'concluida';
    if (!o.dataLimite) return 'normal';
    const d = diffDays(nowISO, o.dataLimite);
    if (d < 0)  return 'vencida';
    if (d <= 2) return 'urgente';
    return 'normal';
  }
  // Ordem numérica de prioridade para ordenação
  const statusPriority = { vencida: 0, urgente: 1, normal: 2, concluida: 9 };

  // ── mapeamento central → regional ────────────────────────────────────────────
  const centralParaRegional = {};
  (state.filiais || []).forEach(f => {
    const key = (f.alias || f.origem || '').trim().toLowerCase();
    if (key) centralParaRegional[key] = (f.regional || '').trim() || 'Sem Regional';
  });
  function getRegional(central) {
    return centralParaRegional[(central||'').trim().toLowerCase()] || 'Sem Regional';
  }

  // Lista de regionais disponíveis (para o selector do modal)
  const regionaisDisponiveis = [...new Set(
    (state.ocorrencias || [])
      .filter(o => !o.concluida)
      .map(o => getRegional(o.central))
  )].sort();

  // ── filtra só abertas (vencidas + urgentes + normais) ────────────────────────
  const abertas = (state.ocorrencias || []).filter(o => !o.concluida);

  if (!abertas.length) {
    alert('Não há ocorrências em aberto para gerar o relatório.');
    return;
  }

  // Aplica filtro de regional se informado
  const listaFiltrada = regionalFiltro
    ? abertas.filter(o => getRegional(o.central) === regionalFiltro)
    : abertas;

  if (!listaFiltrada.length) {
    alert(`Nenhuma ocorrência em aberto para o regional "${regionalFiltro}".`);
    return;
  }

  // Ordena: vencidas → urgentes → normais; dentro de cada grupo, mais antiga primeiro
  listaFiltrada.sort((a, b) => {
    const pa = statusPriority[ocStatus(a)], pb = statusPriority[ocStatus(b)];
    if (pa !== pb) return pa - pb;
    // Dentro do mesmo status: vencidas = mais dias vencido primeiro;
    // urgentes/normais = prazo mais próximo primeiro
    const da = a.dataLimite || '9999-12-31';
    const db = b.dataLimite || '9999-12-31';
    return da.localeCompare(db);
  });

  // ── Agrupa por regional → central ────────────────────────────────────────────
  const porRegional = {};
  listaFiltrada.forEach(o => {
    const reg = getRegional(o.central);
    const cen = o.central || '—';
    if (!porRegional[reg]) porRegional[reg] = {};
    if (!porRegional[reg][cen]) porRegional[reg][cen] = [];
    porRegional[reg][cen].push(o);
  });

  // Ordena regionais: mais vencidas primeiro
  const regionaisOrdenados = Object.entries(porRegional).sort((a, b) => {
    const countVenc = obj => Object.values(obj).flat().filter(o => ocStatus(o)==='vencida').length;
    const countUrg  = obj => Object.values(obj).flat().filter(o => ocStatus(o)==='urgente').length;
    return (countVenc(b[1])*1000 + countUrg(b[1])) - (countVenc(a[1])*1000 + countUrg(a[1]));
  });

  // ── Totais globais do relatório ───────────────────────────────────────────────
  const totalAberto  = listaFiltrada.length;
  const totalVencido = listaFiltrada.filter(o => ocStatus(o)==='vencida').length;
  const totalUrgente = listaFiltrada.filter(o => ocStatus(o)==='urgente').length;
  const totalNormal  = listaFiltrada.filter(o => ocStatus(o)==='normal').length;

  // ── Builders ─────────────────────────────────────────────────────────────────

  // Célula de "tempo em aberto / dias vencido / dias para vencer"
  function buildTempoCell(o) {
    const st = ocStatus(o);
    const diasAberto = diffDays(o.dataAbertura, nowISO);

    if (st === 'vencida') {
      const diasVencido = diffDays(o.dataLimite, nowISO); // positivo = quantos dias passou
      return `
        <div style="display:flex;flex-direction:column;gap:3px">
          <span style="font-size:11px;font-family:'JetBrains Mono',monospace;font-weight:800;color:#ef4444;white-space:nowrap">
            ⚠ ${diasVencido}d vencido
          </span>
          <span style="font-size:10px;color:#94a3b8;font-family:'JetBrains Mono',monospace;white-space:nowrap">
            aberto há ${diasAberto !== null ? diasAberto+'d' : '—'}
          </span>
        </div>`;
    }
    if (st === 'urgente') {
      const diasRestam = diffDays(nowISO, o.dataLimite); // positivo = dias que faltam
      return `
        <div style="display:flex;flex-direction:column;gap:3px">
          <span style="font-size:11px;font-family:'JetBrains Mono',monospace;font-weight:800;color:#f59e0b;white-space:nowrap">
            🔔 ${diasRestam}d p/ vencer
          </span>
          <span style="font-size:10px;color:#94a3b8;font-family:'JetBrains Mono',monospace;white-space:nowrap">
            aberto há ${diasAberto !== null ? diasAberto+'d' : '—'}
          </span>
        </div>`;
    }
    // normal — sem prazo ou prazo folgado
    const diasRestam = o.dataLimite ? diffDays(nowISO, o.dataLimite) : null;
    return `
      <div style="display:flex;flex-direction:column;gap:3px">
        ${diasRestam !== null
          ? `<span style="font-size:11px;font-family:'JetBrains Mono',monospace;color:#6366f1;white-space:nowrap">
               ${diasRestam}d restantes
             </span>`
          : `<span style="font-size:11px;color:#94a3b8">Sem prazo</span>`}
        <span style="font-size:10px;color:#94a3b8;font-family:'JetBrains Mono',monospace;white-space:nowrap">
          aberto há ${diasAberto !== null ? diasAberto+'d' : '—'}
        </span>
      </div>`;
  }

  function buildStatusBadge(st) {
    const cfg = {
      vencida: { bg:'#fef2f2', color:'#ef4444', border:'#fca5a5', label:'VENCIDA'   },
      urgente: { bg:'#fffbeb', color:'#d97706', border:'#fde68a', label:'URGENTE'   },
      normal:  { bg:'#eff6ff', color:'#2563eb', border:'#bfdbfe', label:'EM ABERTO' },
    };
    const c = cfg[st] || cfg.normal;
    return `<span style="display:inline-block;padding:3px 9px;border-radius:12px;font-size:10px;font-weight:800;letter-spacing:.05em;background:${c.bg};color:${c.color};border:1px solid ${c.border}">${c.label}</span>`;
  }

  function buildOcorrenciaRow(o, idx) {
    const st      = ocStatus(o);
    const rowBg   = st==='vencida' ? '#fffbf9' : st==='urgente' ? '#fffef5' : '#ffffff';
    const leftBorder = st==='vencida' ? '#ef4444' : st==='urgente' ? '#f59e0b' : '#e2e8f0';

    return `
    <tr style="border-bottom:1px solid #f1f5f9;background:${rowBg};border-left:3px solid ${leftBorder}">
      <td style="padding:11px 14px;font-size:11px;font-family:'JetBrains Mono',monospace;color:#94a3b8;font-weight:600">${idx+1}</td>
      <td style="padding:11px 10px">${buildStatusBadge(st)}</td>
      <td style="padding:11px 14px">
        <div style="font-weight:700;font-size:12px;color:#0f172a;font-family:'JetBrains Mono',monospace">${escR(o.id)}</div>
        ${o.motivo ? `<div style="font-size:10px;color:#64748b;margin-top:2px">${escR(o.motivo)}</div>` : ''}
      </td>
      <td style="padding:11px 14px;font-weight:600;font-size:13px;color:#1e293b">${escR(o.central||'—')}</td>
      <td style="padding:11px 14px;font-size:12px;color:#475569">${escR(o.material||'—')}</td>
      <td style="padding:11px 14px;font-size:11px;color:#475569">
        <div>${fmtBR(o.dataAbertura)}</div>
        ${o.dataLimite ? `<div style="color:${st==='vencida'?'#ef4444':st==='urgente'?'#d97706':'#94a3b8'};font-size:10px;margin-top:2px">prazo: ${fmtBR(o.dataLimite)}</div>` : ''}
      </td>
      <td style="padding:11px 14px">${buildTempoCell(o)}</td>
      <td style="padding:11px 14px;font-size:12px;color:#334155;max-width:240px">
        <div style="overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.4">${escR(o.descricao||'—')}</div>
      </td>
      <td style="padding:11px 14px;font-size:11px;color:#64748b">
        <div>${escR(o.operador||'—')}</div>
        ${o.contato ? `<div style="color:#94a3b8;margin-top:2px">${escR(o.contato)}</div>` : ''}
      </td>
    </tr>`;
  }

  function buildCentralSection(centralNome, ocorrencias) {
    const venc = ocorrencias.filter(o => ocStatus(o)==='vencida').length;
    const urg  = ocorrencias.filter(o => ocStatus(o)==='urgente').length;
    const norm = ocorrencias.filter(o => ocStatus(o)==='normal').length;
    const piorSt = venc > 0 ? 'vencida' : urg > 0 ? 'urgente' : 'normal';
    const hdrBg = piorSt==='vencida' ? '#fef2f2' : piorSt==='urgente' ? '#fffbeb' : '#f8fafc';
    const hdrBorder = piorSt==='vencida' ? '#fca5a5' : piorSt==='urgente' ? '#fde68a' : '#e2e8f0';
    const hdrAccent = piorSt==='vencida' ? '#ef4444' : piorSt==='urgente' ? '#f59e0b' : '#64748b';

    const badges = [
      venc > 0 ? `<span style="padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;background:#fef2f2;color:#ef4444;border:1px solid #fca5a5">🔴 ${venc} vencida${venc!==1?'s':''}</span>` : '',
      urg  > 0 ? `<span style="padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;background:#fffbeb;color:#d97706;border:1px solid #fde68a">🟡 ${urg} urgente${urg!==1?'s':''}</span>` : '',
      norm > 0 ? `<span style="padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe">🔵 ${norm} em aberto</span>` : '',
    ].filter(Boolean).join(' ');

    return `
    <div style="margin-bottom:16px;border-radius:10px;overflow:hidden;border:1px solid ${hdrBorder};page-break-inside:avoid">
      <div style="background:${hdrBg};border-bottom:1px solid ${hdrBorder};padding:10px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="width:6px;height:24px;border-radius:3px;background:${hdrAccent};flex-shrink:0"></span>
          <span style="font-size:14px;font-weight:800;color:#0f172a">${escR(centralNome)}</span>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${badges}</div>
      </div>
      <table class="data-table" style="font-size:12px">
        <thead>
          <tr>
            <th style="width:28px">#</th>
            <th style="width:88px">Status</th>
            <th style="width:90px">ID / Motivo</th>
            <th>Central</th>
            <th>Material</th>
            <th style="width:105px">Datas</th>
            <th style="width:130px">Prazo / Tempo</th>
            <th>Descrição</th>
            <th style="width:110px">Responsável</th>
          </tr>
        </thead>
        <tbody>
          ${ocorrencias.map(buildOcorrenciaRow).join('')}
        </tbody>
      </table>
    </div>`;
  }

  function buildRegionalSection([regNome, centrais]) {
    const todasOc   = Object.values(centrais).flat();
    const regVenc   = todasOc.filter(o => ocStatus(o)==='vencida').length;
    const regUrg    = todasOc.filter(o => ocStatus(o)==='urgente').length;
    const regNorm   = todasOc.filter(o => ocStatus(o)==='normal').length;
    const regTotal  = todasOc.length;
    const piorSt    = regVenc > 0 ? 'vencida' : regUrg > 0 ? 'urgente' : 'normal';
    const regColor  = piorSt==='vencida' ? '#ef4444' : piorSt==='urgente' ? '#f59e0b' : '#3b82f6';
    const regBg     = piorSt==='vencida'
      ? 'linear-gradient(135deg,#7f1d1d 0%,#991b1b 60%,#b91c1c 100%)'
      : piorSt==='urgente'
      ? 'linear-gradient(135deg,#78350f 0%,#92400e 60%,#b45309 100%)'
      : 'linear-gradient(135deg,#1e3a5f 0%,#1e40af 60%,#2563eb 100%)';

    // Ordena centrais: mais vencidas primeiro
    const centraisOrdenadas = Object.entries(centrais).sort((a, b) => {
      const sv = x => x.filter(o => ocStatus(o)==='vencida').length;
      const su = x => x.filter(o => ocStatus(o)==='urgente').length;
      return (sv(b[1])*100 + su(b[1])) - (sv(a[1])*100 + su(a[1]));
    });

    return `
    <div class="regional-section" style="margin-bottom:32px;page-break-inside:avoid">
      <div style="background:${regBg};border-radius:12px 12px 0 0;padding:18px 24px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;position:relative;overflow:hidden">
        <div style="position:absolute;right:-20px;top:-20px;width:100px;height:100px;border-radius:50%;background:rgba(255,255,255,0.06);pointer-events:none"></div>
        <div style="display:flex;align-items:center;gap:14px;position:relative">
          <div style="width:40px;height:40px;border-radius:10px;background:rgba(255,255,255,0.15);border:1.5px solid rgba(255,255,255,0.25);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">🗺</div>
          <div>
            <div style="font-size:18px;font-weight:900;color:#fff;letter-spacing:-0.01em">${escR(regNome)}</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.6);margin-top:2px">${centraisOrdenadas.length} central${centraisOrdenadas.length!==1?'is':''} · ${regTotal} ocorrência${regTotal!==1?'s':''}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:0;position:relative">
          <div style="text-align:center;padding:0 18px">
            <span style="display:block;font-size:26px;font-weight:800;font-family:'JetBrains Mono',monospace;color:#fca5a5;line-height:1">${regVenc}</span>
            <span style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,0.55);font-weight:600;margin-top:3px;display:block">Vencidas</span>
          </div>
          <div style="width:1px;height:40px;background:rgba(255,255,255,0.2)"></div>
          <div style="text-align:center;padding:0 18px">
            <span style="display:block;font-size:26px;font-weight:800;font-family:'JetBrains Mono',monospace;color:#fde68a;line-height:1">${regUrg}</span>
            <span style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,0.55);font-weight:600;margin-top:3px;display:block">Urgentes</span>
          </div>
          <div style="width:1px;height:40px;background:rgba(255,255,255,0.2)"></div>
          <div style="text-align:center;padding:0 18px">
            <span style="display:block;font-size:26px;font-weight:800;font-family:'JetBrains Mono',monospace;color:#bfdbfe;line-height:1">${regNorm}</span>
            <span style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,0.55);font-weight:600;margin-top:3px;display:block">Em Aberto</span>
          </div>
        </div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:16px">
        ${centraisOrdenadas.map(([cn, ocs]) => buildCentralSection(cn, ocs)).join('')}
      </div>
    </div>`;
  }

  // ── HTML ──────────────────────────────────────────────────────────────────────
  const tituloFiltro = regionalFiltro ? ` — ${regionalFiltro}` : ' — Todos os Regionais';

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Relatório de Cobrança por Regional${tituloFiltro}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap');
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Inter',system-ui,sans-serif; background:#f1f5f9; color:#0f172a; font-size:13px; line-height:1.5; -webkit-font-smoothing:antialiased; }
  .page-wrap { max-width:1200px; margin:0 auto; padding:20px; }

  .action-bar { position:sticky; top:0; z-index:100; background:#1e293b; display:flex; align-items:center; justify-content:space-between; padding:12px 24px; box-shadow:0 2px 12px rgba(0,0,0,0.2); flex-wrap:wrap; gap:10px; }
  .action-bar-title { color:#e2e8f0; font-size:13px; font-weight:500; }
  .action-bar-title span { color:#64748b; font-size:12px; margin-left:10px; }
  .action-bar-btns { display:flex; gap:10px; }
  .btn-print { background:#2563eb; color:#fff; border:none; border-radius:7px; padding:8px 18px; font-size:13px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:7px; }
  .btn-print:hover { background:#1d4ed8; }
  .btn-close { background:#334155; color:#cbd5e1; border:none; border-radius:7px; padding:8px 14px; font-size:13px; font-weight:500; cursor:pointer; }
  .btn-close:hover { background:#475569; }

  .report-header { background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%); color:#fff; border-radius:14px; padding:28px 32px; margin-bottom:24px; position:relative; overflow:hidden; }
  .report-header::before { content:''; position:absolute; top:-40px; right:-40px; width:200px; height:200px; border-radius:50%; background:rgba(239,68,68,0.08); border:2px solid rgba(239,68,68,0.12); }
  .report-header-top { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:20px; flex-wrap:wrap; gap:16px; }
  .report-logo-area { display:flex; align-items:center; gap:12px; }
  .report-logo-icon { width:48px; height:48px; border-radius:12px; background:rgba(239,68,68,0.18); border:1px solid rgba(239,68,68,0.3); display:flex; align-items:center; justify-content:center; font-size:22px; }
  .report-logo-text h1 { font-size:19px; font-weight:800; color:#f8fafc; letter-spacing:-0.01em; }
  .report-logo-text p { font-size:12px; color:#94a3b8; margin-top:2px; }
  .report-meta { text-align:right; }
  .meta-label { font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:.06em; }
  .meta-value { font-size:13px; color:#cbd5e1; font-weight:500; margin-top:2px; }

  .kpi-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
  .kpi-card { background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:14px 18px; text-align:center; }
  .kpi-num { font-size:28px; font-weight:800; font-family:'JetBrains Mono',monospace; line-height:1; margin-bottom:5px; }
  .kpi-label { font-size:10px; color:#94a3b8; text-transform:uppercase; letter-spacing:.05em; font-weight:500; }

  .section-title { font-size:12px; font-weight:700; color:#475569; text-transform:uppercase; letter-spacing:.08em; margin:24px 0 12px; display:flex; align-items:center; gap:10px; }
  .section-title::after { content:''; flex:1; height:1px; background:#e2e8f0; }

  .regional-section { margin-bottom:32px; }
  .data-table { width:100%; border-collapse:collapse; }
  .data-table thead tr { background:#f8fafc; }
  .data-table th { padding:9px 14px; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:#64748b; text-align:left; border-bottom:1px solid #e2e8f0; }
  .data-table tbody tr:last-child { border-bottom:none; }

  .confidential-strip { text-align:center; padding:10px; background:#fef2f2; border:1px solid #fca5a5; border-radius:8px; margin-bottom:20px; font-size:11px; color:#dc2626; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }

  .report-footer { margin-top:32px; padding:18px 24px; background:#1e293b; border-radius:12px; color:#64748b; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; font-size:11px; }
  .report-footer strong { color:#94a3b8; }

  @media print {
    body { background:#fff !important; }
    .action-bar { display:none !important; }
    .page-wrap { padding:0 !important; max-width:100% !important; }
    .regional-section { page-break-before:auto; }
    .report-header { background:#0f172a !important; -webkit-print-color-adjust:exact; color-adjust:exact; }
    .kpi-card { -webkit-print-color-adjust:exact; color-adjust:exact; }
    tr { -webkit-print-color-adjust:exact; color-adjust:exact; }
    .data-table tbody tr { page-break-inside:avoid; }
  }
</style>
</head>
<body>

<div class="action-bar">
  <div class="action-bar-title">
    Relatório de Cobrança por Regional${tituloFiltro}
    <span>Gerado em ${now}</span>
  </div>
  <div class="action-bar-btns">
    <button class="btn-print" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button>
    <button class="btn-close" onclick="window.close()">✕ Fechar</button>
  </div>
</div>

<div class="page-wrap">
  <div class="confidential-strip" style="margin-top:18px">
    ⚠ Documento Confidencial — Uso interno · Gestão de Regionais
  </div>

  <div class="report-header">
    <div class="report-header-top">
      <div class="report-logo-area">
        <div class="report-logo-icon">🚨</div>
        <div class="report-logo-text">
          <h1>Relatório de Cobrança por Regional</h1>
          <p>AnalyticSys · Ocorrências em aberto · ordenadas por prioridade crítica${regionalFiltro ? ' · ' + escR(regionalFiltro) : ''}</p>
        </div>
      </div>
      <div class="report-meta">
        <div class="meta-label">Gerado em</div>
        <div class="meta-value">${now}</div>
        <div class="meta-label" style="margin-top:8px">Escopo</div>
        <div class="meta-value">${regionalFiltro ? escR(regionalFiltro) : 'Todos os regionais'}</div>
      </div>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-num" style="color:#e2e8f0">${totalAberto}</div>
        <div class="kpi-label">Total em aberto</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num" style="color:#ef4444">${totalVencido}</div>
        <div class="kpi-label">🔴 Vencidas</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num" style="color:#f59e0b">${totalUrgente}</div>
        <div class="kpi-label">🟡 Urgentes</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num" style="color:#3b82f6">${totalNormal}</div>
        <div class="kpi-label">🔵 Em prazo</div>
      </div>
    </div>
  </div>

  <div class="section-title">
    ${regionalFiltro ? escR(regionalFiltro) : 'Todos os Regionais'} — Ocorrências em Aberto por Prioridade
  </div>

  ${regionaisOrdenados.map(buildRegionalSection).join('')}

  <div class="report-footer">
    <span>Concrelagos Concreto · <strong>AnalyticSys</strong> · Gestão Centralizada de Materiais</span>
    <span>${totalAberto} ocorrência${totalAberto!==1?'s':''} em aberto · Gerado em <strong>${now}</strong></span>
  </div>
</div>
</body>
</html>`;

  _openRelWindow(html);
};

// ── Modal de seleção de regional para o Relatório 2 ─────────────────────────
window.abrirSeletorRegionalOcorrencias = function() {
  const nowISO = new Date().toISOString().split('T')[0];
  const centralParaRegional = {};
  (state.filiais || []).forEach(f => {
    const key = (f.alias || f.origem || '').trim().toLowerCase();
    if (key) centralParaRegional[key] = (f.regional || '').trim() || 'Sem Regional';
  });
  function getRegional(central) {
    return centralParaRegional[(central||'').trim().toLowerCase()] || 'Sem Regional';
  }

  const abertas = (state.ocorrencias || []).filter(o => !o.concluida);
  if (!abertas.length) {
    alert('Não há ocorrências em aberto para gerar o relatório.');
    return;
  }

  // Monta contagem por regional para exibir no modal
  const porRegional = {};
  abertas.forEach(o => {
    const reg = getRegional(o.central);
    if (!porRegional[reg]) porRegional[reg] = { vencidas:0, urgentes:0, total:0 };
    porRegional[reg].total++;
    if (!o.dataLimite) return;
    const d = Math.round((new Date(o.dataLimite+'T00:00:00') - new Date(nowISO+'T00:00:00')) / 86400000);
    if (d < 0) porRegional[reg].vencidas++;
    else if (d <= 2) porRegional[reg].urgentes++;
  });

  const regionais = Object.entries(porRegional).sort((a, b) => {
    return (b[1].vencidas*1000 + b[1].urgentes*100 + b[1].total) - (a[1].vencidas*1000 + a[1].urgentes*100 + a[1].total);
  });

  // Cria o modal dinamicamente se não existir
  let modal = document.getElementById('oc-rel-regional-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'oc-rel-regional-modal';
    modal.className = 'modal-overlay';
    modal.style.cssText = 'z-index:3200';
    document.body.appendChild(modal);
  }

  const opcoesHtml = regionais.map(([reg, c]) => {
    const vBadge = c.vencidas > 0 ? `<span style="padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;background:#fef2f2;color:#ef4444;border:1px solid #fca5a5">🔴 ${c.vencidas}</span>` : '';
    const uBadge = c.urgentes > 0 ? `<span style="padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;background:#fffbeb;color:#d97706;border:1px solid #fde68a">🟡 ${c.urgentes}</span>` : '';
    return `<button onclick="document.getElementById('oc-rel-regional-modal').classList.remove('open');gerarRelatorioCobrancaRegional('${reg.replace(/'/g,"\\'")}');"
      style="display:flex;align-items:center;justify-content:space-between;width:100%;padding:12px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:13px;font-family:inherit;color:#0f172a;font-weight:600;transition:background .12s;text-align:left;gap:10px"
      onmouseover="this.style.background='#eff6ff'" onmouseout="this.style.background='#f8fafc'">
      <span>${reg}</span>
      <span style="display:flex;align-items:center;gap:6px">
        ${vBadge}${uBadge}
        <span style="font-size:11px;color:#94a3b8;font-family:'DM Mono',monospace">${c.total} oc.</span>
      </span>
    </button>`;
  }).join('');

  modal.innerHTML = `
    <div class="modal" style="max-width:480px;width:94vw">
      <div class="modal-title" style="display:flex;align-items:center;gap:10px">
        <i class="ti ti-map-pin" style="color:var(--amber)"></i>
        Relatório de Cobrança por Regional
      </div>
      <div class="modal-sub">Selecione o regional ou gere para todos</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin:16px 0">
        <button onclick="document.getElementById('oc-rel-regional-modal').classList.remove('open');gerarRelatorioCobrancaRegional(null);"
          style="display:flex;align-items:center;justify-content:space-between;width:100%;padding:12px 16px;background:linear-gradient(135deg,#1e3a5f,#1e40af);border:none;border-radius:8px;cursor:pointer;font-size:13px;font-family:inherit;color:#fff;font-weight:700;gap:10px"
          onmouseover="this.style.opacity='.9'" onmouseout="this.style.opacity='1'">
          <span>🗺 Todos os Regionais</span>
          <span style="font-size:11px;opacity:.7">${abertas.length} ocorrências no total</span>
        </button>
        <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin:4px 0 2px;padding:0 2px">ou escolha um regional</div>
        ${opcoesHtml}
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:8px">
        <button class="btn" onclick="document.getElementById('oc-rel-regional-modal').classList.remove('open')">Cancelar</button>
      </div>
    </div>`;

  modal.classList.add('open');
};

// ═══════════════════════════════════════════════════════════════════════════════
// RELATÓRIO DE COBRANÇA GERAL POR CENTRAL — todas as ocorrências abertas
// agrupadas por central, com colunas de tempo detalhadas, para cobrança ampla
// ═══════════════════════════════════════════════════════════════════════════════
window.gerarRelatorioCobrancaCentral = function(centralFiltro) {
  const nowISO = new Date().toISOString().split('T')[0];
  const now    = new Date().toLocaleString('pt-BR');

  // ── helpers ─────────────────────────────────────────────────────────────────
  function escR(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function fmtBR(iso) { if (!iso) return '—'; const [y,m,d] = iso.split('-'); return `${d}/${m}/${y}`; }
  function diffDays(aISO, bISO) {
    if (!aISO || !bISO) return null;
    const a = new Date(aISO+'T00:00:00'), b = new Date(bISO+'T00:00:00');
    if (isNaN(a)||isNaN(b)) return null;
    return Math.round((b - a) / 86400000);
  }
  function ocStatus(o) {
    if (o.concluida) return 'concluida';
    if (!o.dataLimite) return 'normal';
    const d = diffDays(nowISO, o.dataLimite);
    if (d < 0)  return 'vencida';
    if (d <= 2) return 'urgente';
    return 'normal';
  }
  const statusPriority = { vencida:0, urgente:1, normal:2, concluida:9 };

  // ── mapeamento central → regional ────────────────────────────────────────────
  const centralParaRegional = {};
  (state.filiais || []).forEach(f => {
    const key = (f.alias || f.origem || '').trim().toLowerCase();
    if (key) centralParaRegional[key] = (f.regional || '').trim() || 'Sem Regional';
  });
  function getRegional(central) {
    return centralParaRegional[(central||'').trim().toLowerCase()] || 'Sem Regional';
  }

  // ── filtra só abertas ────────────────────────────────────────────────────────
  const todasAbertas = (state.ocorrencias || []).filter(o => !o.concluida);
  if (!todasAbertas.length) {
    alert('Não há ocorrências em aberto para gerar o relatório.');
    return;
  }

  // Aplica filtro de central se informado
  const abertas = centralFiltro
    ? todasAbertas.filter(o => (o.central || '—') === centralFiltro)
    : todasAbertas;

  if (!abertas.length) {
    alert(`Nenhuma ocorrência em aberto para a central "${centralFiltro}".`);
    return;
  }

  // Ordena globalmente: vencidas → urgentes → normais; dentro do grupo por prazo
  abertas.sort((a, b) => {
    const pa = statusPriority[ocStatus(a)], pb = statusPriority[ocStatus(b)];
    if (pa !== pb) return pa - pb;
    return (a.dataLimite||'9999-12-31').localeCompare(b.dataLimite||'9999-12-31');
  });

  // ── Agrupa por central ───────────────────────────────────────────────────────
  const porCentral = {};
  abertas.forEach(o => {
    const c = o.central || '—';
    if (!porCentral[c]) porCentral[c] = [];
    porCentral[c].push(o);
  });

  // Ordena centrais: mais vencidas → mais urgentes → mais abertas
  const centraisOrdenadas = Object.entries(porCentral).sort((a, b) => {
    const sv = arr => arr.filter(o => ocStatus(o)==='vencida').length;
    const su = arr => arr.filter(o => ocStatus(o)==='urgente').length;
    return (sv(b[1])*1000 + su(b[1])*100 + b[1].length) -
           (sv(a[1])*1000 + su(a[1])*100 + a[1].length);
  });

  // ── Totais globais ───────────────────────────────────────────────────────────
  const totalAberto  = abertas.length;
  const totalVencido = abertas.filter(o => ocStatus(o)==='vencida').length;
  const totalUrgente = abertas.filter(o => ocStatus(o)==='urgente').length;
  const totalNormal  = abertas.filter(o => ocStatus(o)==='normal').length;
  const totalCentral = centraisOrdenadas.length;

  // ── Célula de tempo (três indicadores) ──────────────────────────────────────
  function buildTempoCell(o) {
    const st = ocStatus(o);
    const diasAberto = diffDays(o.dataAbertura, nowISO);
    const abertoStr  = diasAberto !== null ? diasAberto+'d' : '—';

    if (st === 'vencida') {
      const diasVencido = diffDays(o.dataLimite, nowISO); // positivo = passou do prazo
      return `
        <div style="display:flex;flex-direction:column;gap:4px">
          <span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;background:#fef2f2;border:1px solid #fca5a5;font-size:11px;font-family:'JetBrains Mono',monospace;font-weight:800;color:#dc2626;white-space:nowrap">
            ⚠ ${diasVencido}d vencido
          </span>
          <span style="font-size:10px;color:#94a3b8;font-family:'JetBrains Mono',monospace;white-space:nowrap;padding-left:2px">
            em aberto há ${abertoStr}
          </span>
        </div>`;
    }
    if (st === 'urgente') {
      const diasRestam = diffDays(nowISO, o.dataLimite); // positivo = dias restantes
      return `
        <div style="display:flex;flex-direction:column;gap:4px">
          <span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;background:#fffbeb;border:1px solid #fde68a;font-size:11px;font-family:'JetBrains Mono',monospace;font-weight:800;color:#d97706;white-space:nowrap">
            🔔 ${diasRestam}d p/ vencer
          </span>
          <span style="font-size:10px;color:#94a3b8;font-family:'JetBrains Mono',monospace;white-space:nowrap;padding-left:2px">
            em aberto há ${abertoStr}
          </span>
        </div>`;
    }
    // normal
    const diasRestam = o.dataLimite ? diffDays(nowISO, o.dataLimite) : null;
    return `
      <div style="display:flex;flex-direction:column;gap:4px">
        ${diasRestam !== null
          ? `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;background:#eff6ff;border:1px solid #bfdbfe;font-size:11px;font-family:'JetBrains Mono',monospace;font-weight:700;color:#2563eb;white-space:nowrap">
               📅 ${diasRestam}d restantes
             </span>`
          : `<span style="font-size:11px;color:#94a3b8">Sem prazo</span>`}
        <span style="font-size:10px;color:#94a3b8;font-family:'JetBrains Mono',monospace;white-space:nowrap;padding-left:2px">
          em aberto há ${abertoStr}
        </span>
      </div>`;
  }

  function buildStatusBadge(st) {
    const cfg = {
      vencida: { bg:'#fef2f2', color:'#ef4444', border:'#fca5a5', label:'VENCIDA'   },
      urgente: { bg:'#fffbeb', color:'#d97706', border:'#fde68a', label:'URGENTE'   },
      normal:  { bg:'#eff6ff', color:'#2563eb', border:'#bfdbfe', label:'EM ABERTO' },
    };
    const c = cfg[st] || cfg.normal;
    return `<span style="display:inline-block;padding:3px 9px;border-radius:12px;font-size:10px;font-weight:800;letter-spacing:.05em;background:${c.bg};color:${c.color};border:1px solid ${c.border}">${c.label}</span>`;
  }

  function buildOcorrenciaRow(o, idx) {
    const st = ocStatus(o);
    const rowBg      = st==='vencida' ? '#fffbf9' : st==='urgente' ? '#fffef5' : '#ffffff';
    const leftBorder = st==='vencida' ? '#ef4444' : st==='urgente' ? '#f59e0b' : '#e2e8f0';

    return `
    <tr style="border-bottom:1px solid #f1f5f9;background:${rowBg};border-left:3px solid ${leftBorder}">
      <td style="padding:10px 12px;font-size:11px;font-family:'JetBrains Mono',monospace;color:#94a3b8;font-weight:600">${idx+1}</td>
      <td style="padding:10px 10px">${buildStatusBadge(st)}</td>
      <td style="padding:10px 12px">
        <div style="font-weight:700;font-size:12px;color:#0f172a;font-family:'JetBrains Mono',monospace">${escR(o.id)}</div>
        ${o.motivo ? `<div style="font-size:10px;color:#64748b;margin-top:1px">${escR(o.motivo)}</div>` : ''}
      </td>
      <td style="padding:10px 12px;font-size:12px;color:#475569">${escR(o.material||'—')}</td>
      <td style="padding:10px 12px;font-size:11px;color:#475569">
        <div>${fmtBR(o.dataAbertura)}</div>
        ${o.dataLimite ? `<div style="color:${st==='vencida'?'#ef4444':st==='urgente'?'#d97706':'#94a3b8'};font-size:10px;margin-top:1px">prazo: ${fmtBR(o.dataLimite)}</div>` : ''}
      </td>
      <td style="padding:10px 12px">${buildTempoCell(o)}</td>
      <td style="padding:10px 12px;font-size:12px;color:#334155;max-width:220px">
        <div style="overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.4">${escR(o.descricao||'—')}</div>
      </td>
      <td style="padding:10px 12px;font-size:11px;color:#64748b">
        <div>${escR(o.operador||'—')}</div>
        ${o.contato ? `<div style="color:#94a3b8;font-size:10px;margin-top:1px">${escR(o.contato)}</div>` : ''}
      </td>
    </tr>`;
  }

  function buildCentralSection([centralNome, ocorrencias], idx) {
    const venc = ocorrencias.filter(o => ocStatus(o)==='vencida').length;
    const urg  = ocorrencias.filter(o => ocStatus(o)==='urgente').length;
    const norm = ocorrencias.filter(o => ocStatus(o)==='normal').length;
    const reg  = getRegional(centralNome);
    const piorSt = venc > 0 ? 'vencida' : urg > 0 ? 'urgente' : 'normal';

    // Cabeçalho da central: gradiente conforme pior status
    const hdrGrad = piorSt==='vencida'
      ? 'linear-gradient(135deg,#7f1d1d 0%,#991b1b 60%,#b91c1c 100%)'
      : piorSt==='urgente'
      ? 'linear-gradient(135deg,#78350f 0%,#92400e 60%,#b45309 100%)'
      : 'linear-gradient(135deg,#1e3a5f 0%,#1e40af 60%,#2563eb 100%)';

    const badges = [
      venc > 0 ? `<span style="padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;background:rgba(255,255,255,0.15);color:#fca5a5;border:1px solid rgba(255,255,255,0.2)">🔴 ${venc} vencida${venc!==1?'s':''}</span>` : '',
      urg  > 0 ? `<span style="padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;background:rgba(255,255,255,0.15);color:#fde68a;border:1px solid rgba(255,255,255,0.2)">🟡 ${urg} urgente${urg!==1?'s':''}</span>` : '',
      norm > 0 ? `<span style="padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;background:rgba(255,255,255,0.15);color:#bfdbfe;border:1px solid rgba(255,255,255,0.2)">🔵 ${norm} em aberto</span>` : '',
    ].filter(Boolean).join(' ');

    return `
    <div style="margin-bottom:20px;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.07);page-break-inside:avoid">
      <div style="background:${hdrGrad};padding:12px 18px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;position:relative;overflow:hidden">
        <div style="position:absolute;right:-16px;top:-16px;width:70px;height:70px;border-radius:50%;background:rgba(255,255,255,0.05);pointer-events:none"></div>
        <div style="display:flex;align-items:center;gap:10px;position:relative">
          <div style="width:28px;height:28px;border-radius:7px;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.22);display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;font-weight:800;color:#fff;font-family:'JetBrains Mono',monospace">${idx+1}</div>
          <div>
            <div style="font-size:15px;font-weight:800;color:#fff;letter-spacing:-0.01em">${escR(centralNome)}</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.55);margin-top:1px">${escR(reg)} · ${ocorrencias.length} ocorrência${ocorrencias.length!==1?'s':''}</div>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;position:relative">${badges}</div>
      </div>
      <table class="data-table" style="font-size:12px">
        <thead>
          <tr>
            <th style="width:28px">#</th>
            <th style="width:88px">Status</th>
            <th style="width:90px">ID / Motivo</th>
            <th>Material</th>
            <th style="width:100px">Datas</th>
            <th style="width:150px">Prazo / Tempo em Aberto</th>
            <th>Descrição</th>
            <th style="width:110px">Responsável</th>
          </tr>
        </thead>
        <tbody>
          ${ocorrencias.map(buildOcorrenciaRow).join('')}
        </tbody>
      </table>
    </div>`;
  }

  // ── Sumário lateral: top centrais com badge visual ───────────────────────────
  function buildSumario() {
    return centraisOrdenadas.slice(0, 20).map(([cn, ocs], idx) => {
      const venc = ocs.filter(o => ocStatus(o)==='vencida').length;
      const urg  = ocs.filter(o => ocStatus(o)==='urgente').length;
      const total = ocs.length;
      const cor  = venc > 0 ? '#ef4444' : urg > 0 ? '#f59e0b' : '#3b82f6';
      const barW = Math.round(total / (centraisOrdenadas[0][1].length || 1) * 100);
      return `
      <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #f1f5f9">
        <span style="font-size:10px;font-family:'JetBrains Mono',monospace;color:#94a3b8;min-width:18px;font-weight:600">${idx+1}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:700;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escR(cn)}</div>
          <div style="display:flex;align-items:center;gap:5px;margin-top:3px">
            <div style="flex:1;height:4px;background:#e2e8f0;border-radius:2px;overflow:hidden">
              <div style="width:${barW}%;height:100%;background:${cor};border-radius:2px"></div>
            </div>
            <span style="font-size:10px;font-family:'JetBrains Mono',monospace;color:#64748b;min-width:20px;text-align:right">${total}</span>
          </div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          ${venc>0 ? `<span style="padding:1px 6px;border-radius:8px;font-size:9px;font-weight:700;background:#fef2f2;color:#ef4444">🔴${venc}</span>` : ''}
          ${urg>0  ? `<span style="padding:1px 6px;border-radius:8px;font-size:9px;font-weight:700;background:#fffbeb;color:#d97706">🟡${urg}</span>`  : ''}
        </div>
      </div>`;
    }).join('');
  }

  // ── HTML ──────────────────────────────────────────────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Relatório de Cobrança Geral por Central</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap');
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Inter',system-ui,sans-serif; background:#f1f5f9; color:#0f172a; font-size:13px; line-height:1.5; -webkit-font-smoothing:antialiased; }
  .page-wrap { max-width:1200px; margin:0 auto; padding:20px; }

  .action-bar { position:sticky; top:0; z-index:100; background:#1e293b; display:flex; align-items:center; justify-content:space-between; padding:12px 24px; box-shadow:0 2px 12px rgba(0,0,0,0.2); flex-wrap:wrap; gap:10px; }
  .action-bar-title { color:#e2e8f0; font-size:13px; font-weight:500; }
  .action-bar-title span { color:#64748b; font-size:12px; margin-left:10px; }
  .action-bar-btns { display:flex; gap:10px; }
  .btn-print { background:#2563eb; color:#fff; border:none; border-radius:7px; padding:8px 18px; font-size:13px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:7px; }
  .btn-print:hover { background:#1d4ed8; }
  .btn-close { background:#334155; color:#cbd5e1; border:none; border-radius:7px; padding:8px 14px; font-size:13px; font-weight:500; cursor:pointer; }
  .btn-close:hover { background:#475569; }

  .report-header { background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%); color:#fff; border-radius:14px; padding:28px 32px; margin-bottom:24px; position:relative; overflow:hidden; }
  .report-header::before { content:''; position:absolute; top:-40px; right:-40px; width:200px; height:200px; border-radius:50%; background:rgba(99,102,241,0.08); border:2px solid rgba(99,102,241,0.12); }
  .report-header-top { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:20px; flex-wrap:wrap; gap:16px; }
  .report-logo-icon { width:48px; height:48px; border-radius:12px; background:rgba(99,102,241,0.18); border:1px solid rgba(99,102,241,0.3); display:flex; align-items:center; justify-content:center; font-size:22px; }
  .report-logo-text h1 { font-size:19px; font-weight:800; color:#f8fafc; letter-spacing:-0.01em; }
  .report-logo-text p { font-size:12px; color:#94a3b8; margin-top:2px; }
  .meta-label { font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:.06em; }
  .meta-value { font-size:13px; color:#cbd5e1; font-weight:500; margin-top:2px; }

  .kpi-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
  .kpi-card { background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:14px 18px; text-align:center; }
  .kpi-num { font-size:28px; font-weight:800; font-family:'JetBrains Mono',monospace; line-height:1; margin-bottom:5px; }
  .kpi-label { font-size:10px; color:#94a3b8; text-transform:uppercase; letter-spacing:.05em; font-weight:500; }

  /* Layout de duas colunas: sumário + conteúdo */
  .layout-cols { display:grid; grid-template-columns:220px 1fr; gap:20px; align-items:start; }
  .sumario-col { position:sticky; top:62px; background:#fff; border:1px solid #e2e8f0; border-radius:10px; overflow:hidden; }
  .sumario-header { background:#f8fafc; border-bottom:1px solid #e2e8f0; padding:10px 14px; font-size:11px; font-weight:700; color:#475569; text-transform:uppercase; letter-spacing:.06em; }
  .sumario-body { padding:4px 14px 10px; max-height:calc(100vh - 100px); overflow-y:auto; }
  .content-col { min-width:0; }

  .section-title { font-size:12px; font-weight:700; color:#475569; text-transform:uppercase; letter-spacing:.08em; margin:0 0 14px; display:flex; align-items:center; gap:10px; }
  .section-title::after { content:''; flex:1; height:1px; background:#e2e8f0; }

  .data-table { width:100%; border-collapse:collapse; }
  .data-table thead tr { background:#f8fafc; }
  .data-table th { padding:9px 12px; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:#64748b; text-align:left; border-bottom:1px solid #e2e8f0; }
  .data-table tbody tr:last-child { border-bottom:none; }

  .confidential-strip { text-align:center; padding:10px; background:#fef2f2; border:1px solid #fca5a5; border-radius:8px; margin-bottom:20px; font-size:11px; color:#dc2626; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
  .report-footer { margin-top:32px; padding:18px 24px; background:#1e293b; border-radius:12px; color:#64748b; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; font-size:11px; }
  .report-footer strong { color:#94a3b8; }

  @media print {
    body { background:#fff !important; }
    .action-bar { display:none !important; }
    .page-wrap { padding:0 !important; max-width:100% !important; }
    .layout-cols { display:block; }
    .sumario-col { display:none; }
    .report-header { background:#0f172a !important; -webkit-print-color-adjust:exact; color-adjust:exact; }
    .kpi-card { -webkit-print-color-adjust:exact; color-adjust:exact; }
    tr { -webkit-print-color-adjust:exact; color-adjust:exact; }
    div[style*="border-radius:10px"] { page-break-inside:avoid; }
  }
</style>
</head>
<body>

<div class="action-bar">
  <div class="action-bar-title">
    Relatório de Cobrança Geral por Central
    <span>Gerado em ${now}</span>
  </div>
  <div class="action-bar-btns">
    <button class="btn-print" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button>
    <button class="btn-close" onclick="window.close()">✕ Fechar</button>
  </div>
</div>

<div class="page-wrap">
  <div class="confidential-strip" style="margin-top:18px">
    ⚠ Documento Confidencial — Uso interno · Gestão Operacional
  </div>

  <!-- HEADER -->
  <div class="report-header">
    <div class="report-header-top">
      <div style="display:flex;align-items:center;gap:12px">
        <div class="report-logo-icon">🏭</div>
        <div class="report-logo-text">
          <h1>Relatório de Cobrança Geral por Central</h1>
          <p>AnalyticSys · Ocorrências em aberto · ordenadas por criticidade${centralFiltro ? ' · ' + escR(centralFiltro) : ''}</p>
        </div>
      </div>
      <div style="text-align:right">
        <div class="meta-label">Gerado em</div>
        <div class="meta-value">${now}</div>
        <div class="meta-label" style="margin-top:8px">Centrais com ocorrências</div>
        <div class="meta-value">${totalCentral} centra${totalCentral!==1?'is':'l'}</div>
      </div>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-num" style="color:#e2e8f0">${totalAberto}</div>
        <div class="kpi-label">Total em aberto</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num" style="color:#ef4444">${totalVencido}</div>
        <div class="kpi-label">🔴 Vencidas</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num" style="color:#f59e0b">${totalUrgente}</div>
        <div class="kpi-label">🟡 Urgentes</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num" style="color:#3b82f6">${totalNormal}</div>
        <div class="kpi-label">🔵 Em prazo</div>
      </div>
    </div>
  </div>

  <!-- LAYOUT DUAS COLUNAS -->
  <div class="layout-cols">

    <!-- SUMÁRIO LATERAL (sticky) -->
    <div class="sumario-col">
      <div class="sumario-header">📋 Índice de Centrais</div>
      <div class="sumario-body">
        ${buildSumario()}
        ${centraisOrdenadas.length > 20 ? `<div style="padding:8px 0;font-size:10px;color:#94a3b8;font-style:italic">+ ${centraisOrdenadas.length - 20} centrais adicionais</div>` : ''}
      </div>
    </div>

    <!-- CONTEÚDO PRINCIPAL -->
    <div class="content-col">
      <div class="section-title">
        ${totalCentral} Centra${totalCentral!==1?'is':'l'} — Ocorrências em Aberto por Prioridade
      </div>
      ${centraisOrdenadas.map(buildCentralSection).join('')}
    </div>

  </div><!-- /layout-cols -->

  <div class="report-footer">
    <span>Concrelagos Concreto · <strong>AnalyticSys</strong> · Gestão Centralizada de Materiais</span>
    <span>${totalAberto} ocorrência${totalAberto!==1?'s':''} em aberto · ${totalCentral} centra${totalCentral!==1?'is':'l'} · Gerado em <strong>${now}</strong></span>
  </div>
</div>
</body>
</html>`;

  _openRelWindow(html);
};

// ── Modal de seleção de central para o Relatório 3 ──────────────────────────
window.abrirSeletorCentralOcorrencias = function() {
  const nowISO = new Date().toISOString().split('T')[0];

  const abertas = (state.ocorrencias || []).filter(o => !o.concluida);
  if (!abertas.length) {
    alert('Não há ocorrências em aberto para gerar o relatório.');
    return;
  }

  // Monta contagem por central para exibir no modal
  const porCentral = {};
  abertas.forEach(o => {
    const c = o.central || '—';
    if (!porCentral[c]) porCentral[c] = { vencidas:0, urgentes:0, total:0 };
    porCentral[c].total++;
    if (!o.dataLimite) return;
    const d = Math.round((new Date(o.dataLimite+'T00:00:00') - new Date(nowISO+'T00:00:00')) / 86400000);
    if (d < 0) porCentral[c].vencidas++;
    else if (d <= 2) porCentral[c].urgentes++;
  });

  // Ordena: mais vencidas → mais urgentes → mais abertas
  const centrais = Object.entries(porCentral).sort((a, b) =>
    (b[1].vencidas*1000 + b[1].urgentes*100 + b[1].total) -
    (a[1].vencidas*1000 + a[1].urgentes*100 + a[1].total)
  );

  // Cria o modal dinamicamente se não existir
  let modal = document.getElementById('oc-rel-central-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'oc-rel-central-modal';
    modal.className = 'modal-overlay';
    modal.style.cssText = 'z-index:3200';
    document.body.appendChild(modal);
  }

  const opcoesHtml = centrais.map(([central, c]) => {
    const vBadge = c.vencidas > 0 ? `<span style="padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;background:#fef2f2;color:#ef4444;border:1px solid #fca5a5">🔴 ${c.vencidas}</span>` : '';
    const uBadge = c.urgentes > 0 ? `<span style="padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;background:#fffbeb;color:#d97706;border:1px solid #fde68a">🟡 ${c.urgentes}</span>` : '';
    const safe = central.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    return `<button onclick="document.getElementById('oc-rel-central-modal').classList.remove('open');gerarRelatorioCobrancaCentral('${safe}');"
      style="display:flex;align-items:center;justify-content:space-between;width:100%;padding:12px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:13px;font-family:inherit;color:#0f172a;font-weight:600;transition:background .12s;text-align:left;gap:10px"
      onmouseover="this.style.background='#eff6ff'" onmouseout="this.style.background='#f8fafc'">
      <span>${central}</span>
      <span style="display:flex;align-items:center;gap:6px">
        ${vBadge}${uBadge}
        <span style="font-size:11px;color:#94a3b8;font-family:'DM Mono',monospace">${c.total} oc.</span>
      </span>
    </button>`;
  }).join('');

  modal.innerHTML = `
    <div class="modal" style="max-width:480px;width:94vw;max-height:88vh;overflow:hidden;display:flex;flex-direction:column">
      <div class="modal-title" style="display:flex;align-items:center;gap:10px;flex-shrink:0">
        <i class="ti ti-building-factory-2" style="color:var(--accent)"></i>
        Relatório de Cobrança por Central
      </div>
      <div class="modal-sub" style="flex-shrink:0">Selecione a central ou gere para todas</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin:16px 0;overflow-y:auto;flex:1;padding-right:2px">
        <button onclick="document.getElementById('oc-rel-central-modal').classList.remove('open');gerarRelatorioCobrancaCentral(null);"
          style="display:flex;align-items:center;justify-content:space-between;width:100%;padding:12px 16px;background:linear-gradient(135deg,#3730a3,#4f46e5);border:none;border-radius:8px;cursor:pointer;font-size:13px;font-family:inherit;color:#fff;font-weight:700;gap:10px;flex-shrink:0"
          onmouseover="this.style.opacity='.9'" onmouseout="this.style.opacity='1'">
          <span>🏭 Todas as Centrais</span>
          <span style="font-size:11px;opacity:.7">${abertas.length} ocorrência${abertas.length!==1?'s':''} no total</span>
        </button>
        <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin:4px 0 2px;padding:0 2px;flex-shrink:0">ou escolha uma central</div>
        ${opcoesHtml}
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:8px;flex-shrink:0">
        <button class="btn" onclick="document.getElementById('oc-rel-central-modal').classList.remove('open')">Cancelar</button>
      </div>
    </div>`;

  modal.classList.add('open');
};
