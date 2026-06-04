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

    const levelTablesHtml = levelSections.map(ls => `
      <div class="level-section" style="border-left:4px solid ${ls.color};margin-bottom:20px;page-break-inside:avoid">
        <div class="level-header" style="background:${ls.bg};border-bottom:1px solid ${ls.border}">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:20px">${ls.icon}</span>
            <div>
              <div class="level-title" style="color:${ls.color}">${ls.label}</div>
              <div class="level-subtitle">${ls.sublabel}</div>
            </div>
          </div>
          <span class="level-count" style="background:${ls.color};color:#fff">${ls.count} material${ls.count>1?'is':''}</span>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:36px">#</th>
              <th>Material</th>
              <th>Central</th>
              <th>Variação</th>
              <th>Tendência</th>
            </tr>
          </thead>
          <tbody>
            ${buildLevelRows(ls.items, ls.color)}
          </tbody>
        </table>
        ${ls.items.length > 20 ? `<div class="overflow-note">+ ${ls.items.length - 20} materiais adicionais não exibidos</div>` : ''}
      </div>
    `).join('');

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
