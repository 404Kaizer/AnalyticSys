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

// ═══════════════════════════════════════════════════════════════════
// RELATÓRIO DE AUSÊNCIAS DE LANÇAMENTO
// ═══════════════════════════════════════════════════════════════════

function _buildAusenciasRelHTML({ titulo, periodo, geradoEm, centraisData, totalDias, totalMats, totalCentrals }) {
  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function fmtDate(d) {
    return String(d.getDate()).padStart(2,'0') + '/' +
           String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear();
  }

  const centralSections = centraisData.map(({ central, mats }, idx) => {
    const totalAus = mats.length;
    const matRows = mats.map(({ mat, tipo, dias }, ri) => {
      const isSemanal = tipo === 'Semanal';
      const chips = dias.map(d =>
        `<span class="date-chip">${fmtDate(d)}</span>`
      ).join('');
      return `
        <tr class="${ri % 2 === 0 ? 'row-even' : 'row-odd'}">
          <td class="td-mat">${esc(mat)}</td>
          <td class="td-tipo">
            <span class="badge-tipo ${isSemanal ? 'badge-semanal' : 'badge-diario'}">${tipo}</span>
          </td>
          <td class="td-count">${dias.length}</td>
          <td class="td-dates">${chips}</td>
        </tr>`;
    }).join('');

    return `
      <div class="central-block" style="animation-delay:${idx * 0.04}s">
        <div class="central-header">
          <div class="central-header-left">
            <span class="central-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 21h18M3 7l9-4 9 4M4 7v14M20 7v14M9 21v-4a3 3 0 0 1 6 0v4"/>
              </svg>
            </span>
            <span class="central-name">${esc(central)}</span>
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
  </div>
</div>

<div class="alert-banner">
  <svg style="flex-shrink:0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
  <span><strong>ATENÇÃO:</strong> Os lançamentos abaixo estão <strong>ausentes</strong> no sistema e comprometem diretamente a integridade dos estoques, a confiabilidade das análises e a rastreabilidade operacional. A ausência de lançamento distorce variações e invalida o inventário do período. <strong style="color:#b45309;font-size:13.5px;display:inline-block;margin-top:4px">⚠ Regularização imediata é obrigatória.</strong></span>
</div>

<div class="content">
  ${centralSections}
</div>

<div class="report-footer">
  <span>Concrelagos Concreto &nbsp;·&nbsp; <strong>AnalyticSys</strong> &nbsp;·&nbsp; Gestão Centralizada de Estoque e Insumos</span>
  <span>Período: <strong>${esc(periodo)}</strong></span>
</div>

</body>
</html>`;
}


// Converte o array ausencias (do renderAusencias) para o formato centraisData
function _ausenciasParaCentraisData(ausencias) {
  const byCentral = new Map();
  ausencias.forEach(a => {
    if (!byCentral.has(a.central)) byCentral.set(a.central, []);
    byCentral.get(a.central).push({
      mat:  a.mat,
      tipo: a.isSemanal ? 'Semanal' : 'Diário',
      dias: a.diasAusentes
    });
  });
  return [...byCentral.entries()]
    .sort((a,b) => a[0].localeCompare(b[0]))
    .map(([central, mats]) => ({
      central,
      mats: mats.sort((a,b) => a.mat.localeCompare(b.mat))
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

  const centraisData = _ausenciasParaCentraisData(ausencias);
  const diasUnicos   = new Set(ausencias.flatMap(a => a.diasAusentes.map(d => d.toISOString().slice(0,10)))).size;
  const matsUnicos   = new Set(ausencias.map(a => a.mat)).size;
  const periodo      = _ausGetPeriodo();
  const html = _buildAusenciasRelHTML({
    titulo:       `Ausências de Lançamento — ${central}`,
    periodo,
    geradoEm:     new Date().toLocaleString('pt-BR'),
    centraisData,
    totalDias:    diasUnicos,
    totalMats:    matsUnicos,
    totalCentrals: 1
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

  const ausencias   = window._ausenciasData;
  const centraisData = _ausenciasParaCentraisData(ausencias);
  const diasUnicos  = new Set(ausencias.flatMap(a => a.diasAusentes.map(d => d.toISOString().slice(0,10)))).size;
  const matsUnicos  = new Set(ausencias.map(a => a.mat)).size;
  const centralsCnt = new Set(ausencias.map(a => a.central)).size;
  const periodo     = _ausGetPeriodo();
  const html = _buildAusenciasRelHTML({
    titulo:       'Relatório Geral de Ausências de Lançamento',
    periodo,
    geradoEm:     new Date().toLocaleString('pt-BR'),
    centraisData,
    totalDias:    diasUnicos,
    totalMats:    matsUnicos,
    totalCentrals: centralsCnt
  });

  const w = window.open('', '_blank', 'width=1200,height=900,scrollbars=yes,resizable=yes');
  if (!w) { alert('Popups bloqueados! Permita pop-ups para gerar o relatório.'); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
};
