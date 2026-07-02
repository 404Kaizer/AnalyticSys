function _buildCriticidadeData() {
  const byLevel = window._rankByLevel;
  if (!byLevel || (!byLevel.critico.length && !byLevel.urgente.length)) {
    alert('Nenhum dado de criticidade disponível. Execute a análise primeiro.');
    return null;
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

  const totalCritico = byLevel.critico.length;
  const totalUrgente = byLevel.urgente.length;
  const totalGeral   = totalCritico + totalUrgente;
  const totalRegionais = new Set([...byLevel.critico, ...byLevel.urgente].map(i => i.regional || '—')).size;

  // ── Helpers ──
  function fmtKgRel(v) {
    const n = Number(v) || 0;
    const abs = Math.abs(n);
    return abs.toLocaleString('pt-BR', {minimumFractionDigits:2,maximumFractionDigits:2}) + ' kg';
  }
  // Padrão do sistema (dashboard.js): desfalque = ti-trending-down + var(--red); sobra = ti-trending-up + var(--amber)
  function varDir(v) { return v < -0.001 ? 'Desfalque' : v > 0.001 ? 'Sobra' : 'Equil.'; }
  function varDirColor(v) { return v < -0.001 ? '#f43f5e' : v > 0.001 ? '#f59e0b' : '#6b7280'; }
  function varDirIcon(v) { return v < -0.001 ? 'ti-trending-down' : v > 0.001 ? 'ti-trending-up' : 'ti-minus'; }
  function varDirHtml(v) {
    return `<i class="ti ${varDirIcon(v)}"></i> ${varDir(v)}`;
  }
  function escRel(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // ── Agrupamento por categoria de material (Aglomerantes, Agregados, Aditivos, Adições) ──
  const CAT_ORDER  = ['aglomerante', 'agregado', 'aditivo', 'adicao'];
  const CAT_LABELS = { aglomerante: 'Aglomerantes', agregado: 'Agregados', aditivo: 'Aditivos', adicao: 'Adições' };
  function groupByCategoria(items) {
    const map = new Map();
    items.forEach(i => {
      const key = i.catKey || 'aglomerante';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(i);
    });
    const ordered = CAT_ORDER.filter(k => map.has(k)).map(k => [k, map.get(k)]);
    map.forEach((v, k) => { if (!CAT_ORDER.includes(k)) ordered.push([k, v]); });
    return ordered;
  }

  // ── Build a global level block (Crítico ou Urgente) — colunas: Regional, Central, Material, Variação — separado por categoria ──
  function buildLevelBlock(items, cfg) {
    const grupos = groupByCategoria(items);

    const bodyHtml = grupos.map(([catKey, catItems]) => {
      const catLabel = CAT_LABELS[catKey] || catKey;
      const netDiff  = catItems.reduce((s, i) => s + (Number(i.diff) || 0), 0);
      const netColor = varDirColor(netDiff);
      // Ordem: maior desfalque (diff mais negativo) primeiro → maior sobra (diff mais positivo) por último
      const catItemsOrdenados = [...catItems].sort((a, b) => (Number(a.diff) || 0) - (Number(b.diff) || 0));
      const catRows = catItemsOrdenados.map((item, idx) => {
        const dc  = varDirColor(item.diff);
        return `<tr class="data-row${idx % 2 === 1 ? ' data-row--alt' : ''}">
          <td class="rank-cell">${idx + 1}</td>
          <td class="reg-cell">${escRel(item.regional || '—')}</td>
          <td class="central-cell">${escRel(item.central)}</td>
          <td class="mat-cell"><span class="mat-name">${escRel(item.mat)}</span></td>
          <td class="var-cell" style="color:${dc}"><strong>${varDirHtml(item.diff)}</strong> <span class="var-kg">${fmtKgRel(item.diff)}</span></td>
        </tr>`;
      }).join('');

      return `<tbody class="cat-group">
        <tr class="cat-header-row">
          <td colspan="5" class="cat-header-cell" style="background:${cfg.catBg};border-left:6px solid ${cfg.catAccent}">
            <div class="cat-header-inner">
              <span class="cat-header-label" style="color:${cfg.catText}">${escRel(catLabel)}</span>
              <div class="cat-header-right">
                <span class="cat-header-net" style="color:${netColor}">${varDirHtml(netDiff)} acumulado <strong>${fmtKgRel(netDiff)}</strong></span>
                <span class="cat-header-count" style="color:${cfg.catText}">${catItems.length} ${catItems.length === 1 ? 'material' : 'materiais'}</span>
              </div>
            </div>
          </td>
        </tr>
        ${catRows}
      </tbody>`;
    }).join('');

    return `
    <section class="level-block level-block--${cfg.key}" style="page-break-inside:auto">
      <div class="level-block-header" style="background:${cfg.headerGrad}">
        <div class="level-block-header-glow"></div>
        <div class="level-block-header-left">
          <div class="level-block-icon" style="background:${cfg.iconBg};border-color:${cfg.iconBorder}">${cfg.icon}</div>
          <div>
            <div class="level-block-title" style="font-size:${cfg.titleSize}">${cfg.label}</div>
            <div class="level-block-sub">${cfg.sublabel}</div>
          </div>
        </div>
        <div class="level-block-count">${items.length} ${items.length === 1 ? 'material' : 'materiais'}</div>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:44px">#</th>
            <th>Regional</th>
            <th>Central</th>
            <th>Material</th>
            <th style="width:210px">Variação</th>
          </tr>
        </thead>
        ${bodyHtml || `<tbody><tr><td colspan="5" class="empty-cell">Nenhum item nesta categoria.</td></tr></tbody>`}
      </table>
    </section>`;
  }

  const criticoBlock = buildLevelBlock(byLevel.critico, {
    key: 'critico',
    icon: '<i class="ti ti-flame"></i>',
    label: 'CRÍTICO',
    sublabel: 'Ação imediata — escalar à gerência',
    titleSize: '24px',
    headerGrad: 'linear-gradient(135deg,#7f1d1d 0%,#991b1b 55%,#b91c1c 100%)',
    iconBg: 'rgba(255,255,255,0.16)',
    iconBorder: 'rgba(255,255,255,0.3)',
    catAccent: '#dc2626',
    catBg: '#fef2f2',
    catText: '#991b1b',
  });

  const urgenteBlock = buildLevelBlock(byLevel.urgente, {
    key: 'urgente',
    icon: '<i class="ti ti-alert-circle"></i>',
    label: 'URGENTE',
    sublabel: 'Atenção redobrada — repassar aos regionais',
    titleSize: '19px',
    headerGrad: 'linear-gradient(135deg,#7c2d12 0%,#9a3412 55%,#c2410c 100%)',
    iconBg: 'rgba(255,255,255,0.14)',
    iconBorder: 'rgba(255,255,255,0.26)',
    catAccent: '#ea580c',
    catBg: '#fff7ed',
    catText: '#9a3412',
  });

  // ═══════════════════════════════════════════════════════════════════
  // RESUMO EXECUTIVO — narrativa automática + gráficos
  // ═══════════════════════════════════════════════════════════════════
  const allItemsFlat = [...byLevel.critico, ...byLevel.urgente];

  const CAT_CHART_COLORS = { aglomerante: '#3b82f6', agregado: '#8b5cf6', aditivo: '#f59e0b', adicao: '#10b981' };

  // ── Totais por categoria (contagem + variação líquida) ──
  function buildCategoriaTotais(itemsAll) {
    const map = new Map();
    itemsAll.forEach(i => {
      const key = i.catKey || 'aglomerante';
      if (!map.has(key)) map.set(key, { count: 0, net: 0 });
      const e = map.get(key);
      e.count++; e.net += (Number(i.diff) || 0);
    });
    return CAT_ORDER.filter(k => map.has(k)).map(k => ({ key: k, label: CAT_LABELS[k], ...map.get(k) }));
  }

  // ── Totais por regional (crítico / urgente / total / net acumulado) ──
  function buildRegionalTotaisRobusto() {
    const map = new Map();
    const bump = (reg, field, diff) => {
      const key = reg || '—';
      if (!map.has(key)) map.set(key, { critico: 0, urgente: 0, net: 0 });
      const e = map.get(key);
      e[field]++;
      e.net += (Number(diff) || 0);
    };
    byLevel.critico.forEach(i => bump(i.regional, 'critico', i.diff));
    byLevel.urgente.forEach(i => bump(i.regional, 'urgente', i.diff));
    return Array.from(map.entries()).map(([regional, c]) => ({
      regional, critico: c.critico, urgente: c.urgente, total: c.critico + c.urgente, net: c.net
    })).sort((a, b) => b.total - a.total);
  }

  const categoriaTotais = buildCategoriaTotais(allItemsFlat);
  const regionalTotais  = buildRegionalTotaisRobusto();

  const netGeral    = allItemsFlat.reduce((s, i) => s + (Number(i.diff) || 0), 0);
  const netGeralDir = varDir(netGeral);
  const netGeralCor = varDirColor(netGeral);

  const topCategoria = [...categoriaTotais].sort((a, b) => b.count - a.count)[0];
  const topCategoriaPct = topCategoria ? Math.round(topCategoria.count / totalGeral * 100) : 0;

  const top3Regionais = regionalTotais.slice(0, 3);
  const top3Pct = totalGeral ? Math.round(top3Regionais.reduce((s, r) => s + r.total, 0) / totalGeral * 100) : 0;
  const topRegionalNome = regionalTotais[0]?.regional || '—';

  // ── Narrativa automática (versão curta — o número consolidado vira o destaque visual, abaixo) ──
  const narrativaHtml = `
    <p>
      As <strong>${top3Regionais.length} regionais</strong> com maior concentração de problemas
      (encabeçadas por <strong>${escRel(topRegionalNome)}</strong>) respondem por
      <strong>${top3Pct}%</strong> dos ${totalGeral} itens críticos e urgentes identificados neste período.
    </p>
    <p>
      A categoria <strong>${topCategoria ? escRel(topCategoria.label) : '—'}</strong> é a mais representativa,
      com ${topCategoria ? topCategoria.count : 0} materiais (${topCategoriaPct}% do total)
      e variação líquida de <strong style="color:${topCategoria ? varDirColor(topCategoria.net) : '#64748b'}">${topCategoria ? varDir(topCategoria.net) : '—'} ${topCategoria ? fmtKgRel(topCategoria.net) : ''}</strong>.
    </p>`;

  // ── Totais por regional, segmentados por categoria de material (para os blocos dinâmicos) ──
  function buildRegionalPorCategoria() {
    const map = new Map(); // catKey -> Map(regional -> {critico,urgente,net})
    const bump = (catKey, reg, field, diff) => {
      const ck = catKey || 'aglomerante';
      if (!map.has(ck)) map.set(ck, new Map());
      const regMap = map.get(ck);
      const key = reg || '—';
      if (!regMap.has(key)) regMap.set(key, { critico: 0, urgente: 0, net: 0 });
      const e = regMap.get(key);
      e[field]++;
      e.net += (Number(diff) || 0);
    };
    byLevel.critico.forEach(i => bump(i.catKey, i.regional, 'critico', i.diff));
    byLevel.urgente.forEach(i => bump(i.catKey, i.regional, 'urgente', i.diff));

    return CAT_ORDER.filter(k => map.has(k)).map(catKey => {
      const regMap = map.get(catKey);
      const totalCat = Array.from(regMap.values()).reduce((s, e) => s + e.critico + e.urgente, 0);
      const regionais = Array.from(regMap.entries())
        .map(([regional, e]) => ({ regional, critico: e.critico, urgente: e.urgente, total: e.critico + e.urgente, net: e.net }))
        .sort((a, b) => b.total - a.total);
      return { catKey, label: CAT_LABELS[catKey], regionais, totalCat };
    });
  }

  // ── Blocos horizontais: concentração por regional, um bloco por categoria (dinâmico), com todos os regionais ──
  function fmtKgSigned(v) {
    const n = Number(v) || 0;
    const sign = n < -0.001 ? '−' : n > 0.001 ? '+' : '';
    return sign + fmtKgRel(n);
  }

  function buildRegionalBlock(catKey, label, regionais, totalCat) {
    if (!regionais.length) return '';
    const accent = CAT_CHART_COLORS[catKey] || '#64748b';
    const TOP_BG = ['1c', '12', '0a']; // opacidade hex decrescente pros 3 primeiros (1º mais forte)
    const rows = regionais.map((r, idx) => {
      const pctRepr  = totalCat ? Math.round(r.total / totalCat * 100) : 0;
      const netColor = varDirColor(r.net);
      const isTop3 = idx < 3;
      const rowStyle = isTop3 ? `background:${accent}${TOP_BG[idx]};border-radius:9px;padding:12px 13px;` : 'padding:11px 2px;';
      return `<div class="reg-item-row${isTop3 ? ' reg-item-row--top' : ''}" style="${rowStyle}">
        <div class="reg-item-name-line">
          <span class="reg-item-rank"${isTop3 ? ` style="background:${accent};color:#fff"` : ''}>${idx + 1}</span>
          <span class="reg-item-label" title="${escRel(r.regional)}">${escRel(r.regional)}</span>
        </div>
        <div class="reg-item-stats-line">
          <span class="reg-item-count">${r.total} ${r.total === 1 ? 'material' : 'materiais'}</span>
          <span class="reg-item-sep">·</span>
          <span class="reg-item-pct-full">Representa ${pctRepr}%</span>
        </div>
        <div class="reg-item-net-line" style="color:${netColor}"><i class="ti ${varDirIcon(r.net)}"></i> ${fmtKgSigned(r.net)}</div>
        <div class="reg-item-level-line">
          ${r.critico ? `<span class="reg-item-level-badge reg-item-level-badge--critico"><i class="ti ti-flame"></i> ${r.critico} Crítico${r.critico === 1 ? '' : 's'}</span>` : ''}
          ${r.urgente ? `<span class="reg-item-level-badge reg-item-level-badge--urgente"><i class="ti ti-alert-circle"></i> ${r.urgente} Urgente${r.urgente === 1 ? '' : 's'}</span>` : ''}
        </div>
      </div>`;
    }).join('');
    return `<div class="reg-cat-block" style="border-top-color:${accent}">
      <div class="reg-cat-block-title">
        <span class="reg-cat-dot" style="background:${accent}"></span>
        <span style="color:${accent}">${escRel(label)}</span>
        <span class="reg-cat-block-count">${regionais.length} regionai${regionais.length === 1 ? '' : 's'}</span>
      </div>
      <div class="reg-item-list">${rows}</div>
    </div>`;
  }

  function buildRegionalBarChart() {
    const grupos = buildRegionalPorCategoria();
    if (!grupos.length) return `<div class="donut-empty">Sem dados suficientes.</div>`;
    const blocks = grupos.map(g => buildRegionalBlock(g.catKey, g.label, g.regionais, g.totalCat)).join('');
    return `<div class="reg-bar-legend">
        <span><i class="ti ti-flame" style="color:#dc2626"></i> Crítico</span>
        <span><i class="ti ti-alert-circle" style="color:#ea580c"></i> Urgente</span>
      </div>
      <div class="reg-cat-blocks-grid">${blocks}</div>`;
  }

  // ── Card de destaque: o número que resume o relatório em um olhar ──
  const netIsBad  = netGeral < -0.001;
  const netIsGood = netGeral > 0.001;
  const headlineGrad = netIsBad
    ? 'linear-gradient(135deg,#7f1d1d 0%,#991b1b 45%,#b91c1c 100%)'
    : netIsGood
      ? 'linear-gradient(135deg,#78350f 0%,#92400e 45%,#b45309 100%)'
      : 'linear-gradient(135deg,#334155 0%,#475569 100%)';
  const headlineIcon = `<i class="ti ${varDirIcon(netGeral)}"></i>`;
  const headlineHtml = `
    <div class="exec-headline" style="background:${headlineGrad}">
      <div class="exec-headline-glow"></div>
      <div class="exec-headline-glow2"></div>
      <div class="exec-headline-left">
        <div class="exec-headline-icon">${headlineIcon}</div>
        <div>
          <div class="exec-headline-label">Desequilíbrio líquido consolidado do período</div>
          <div class="exec-headline-value">${netGeralDir} <span>${fmtKgRel(netGeral)}</span></div>
        </div>
      </div>
      <div class="exec-headline-meta">
        <div class="exec-headline-meta-item"><strong>${totalGeral}</strong><span>ocorrências</span></div>
        <div class="exec-headline-meta-sep"></div>
        <div class="exec-headline-meta-item"><strong>${totalRegionais}</strong><span>regionais</span></div>
      </div>
    </div>`;

  const execSummaryHtml = `
    <div class="exec-summary">
      <div class="exec-summary-title">
        <span class="exec-summary-icon">📌</span>
        <div>
          <div class="exec-title-main">Resumo Executivo</div>
          <div class="exec-title-sub">Leitura rápida gerada automaticamente a partir dos dados deste relatório</div>
        </div>
      </div>

      ${headlineHtml}

      <div class="exec-blocks">
        <div class="exec-block exec-block--narrative">
          <div class="exec-block-title"><span class="exec-block-title-icon">🔎</span> Principais Achados</div>
          <div class="exec-narrative">${narrativaHtml}</div>
        </div>
        <div class="exec-block exec-block--bars">
          <div class="exec-block-title"><span class="exec-block-title-icon">📍</span> Concentração por Regional</div>
          ${buildRegionalBarChart()}
        </div>
      </div>
    </div>`;

  return {
    periodo, now, totalCritico, totalUrgente, totalGeral, totalRegionais,
    criticoBlock, urgenteBlock, execSummaryHtml,
  };
}

// ── Shell HTML compartilhado (cabeçalho com logo, KPIs, footer) — o conteúdo do corpo varia por relatório ──
function _buildCriticidadeShell(d, opts) {
  const { periodo, now, totalCritico, totalUrgente, totalRegionais, totalGeral } = d;
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${opts.pageTitle}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/dist/tabler-icons.min.css">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');

  @page { size: A4 landscape; margin: 10mm 12mm; }

  * { box-sizing: border-box; margin:0; padding:0; }
  body {
    font-family: 'Inter', system-ui, sans-serif;
    background: #f1f5f9;
    color: #0f172a;
    font-size: 12.5px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  .page-wrap { max-width:1500px; margin:0 auto; padding:20px; }

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

  /* Confidential strip */
  .confidential-strip {
    text-align: center; padding: 10px;
    background: #fef2f2; border: 1px solid #fca5a5;
    border-radius: 8px; margin-bottom: 20px;
    font-size: 11px; color: #dc2626; font-weight: 700; letter-spacing: .08em;
    text-transform: uppercase;
  }

  /* Report header */
  .report-header {
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
    color: #fff;
    border-radius: 14px;
    padding: 22px 32px;
    margin-bottom: 22px;
    position: relative;
    overflow: hidden;
  }
  .report-header::before {
    content: '';
    position: absolute; top:-50px; right:-40px;
    width:160px; height:160px;
    border-radius:50%;
    background: rgba(239,68,68,0.07);
    border: 2px solid rgba(239,68,68,0.10);
  }
  .report-header::after {
    content: '';
    position: absolute; bottom:-70px; right:100px;
    width:120px; height:120px;
    border-radius:50%;
    background: rgba(245,158,11,0.05);
    border: 2px solid rgba(245,158,11,0.08);
  }
  .report-header-top { display:flex; align-items:center; justify-content:space-between; margin-bottom:18px; flex-wrap:wrap; gap:16px; position:relative; }

  /* Logo real da empresa — mesmo padrão dos demais relatórios do sistema */
  .logos-wrap { display:flex; align-items:center; gap:22px; }
  .logo-concrelagos { height:38px; width:auto; object-fit:contain; filter:invert(1) hue-rotate(178deg); opacity:.95; }
  .logo-sep { width:1px; height:34px; background:rgba(255,255,255,0.18); }
  .logo-analyticsys { display:flex; align-items:center; gap:8px; opacity:.85; }
  .logo-analyticsys-text { font-size:12px; font-weight:800; letter-spacing:.06em; font-family:'JetBrains Mono',monospace; line-height:1; color:#cbd5e1; }
  .logo-analyticsys-text span { color:#f97316; }
  .logo-analyticsys-sub { font-size:8px; color:#64748b; letter-spacing:.14em; text-transform:uppercase; margin-top:2px; }

  .report-title-block h1 { font-size:20px; font-weight:800; color:#f8fafc; letter-spacing:-0.01em; }
  .report-title-block p { font-size:12px; color:#94a3b8; font-weight:400; margin-top:2px; }
  .report-meta { text-align:right; position:relative; }
  .report-meta .meta-label { font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:.06em; }
  .report-meta .meta-value { font-size:13px; color:#cbd5e1; font-weight:500; margin-top:2px; }

  .report-header-bottom {
    display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px;
    padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.08); position: relative;
  }
  .report-alert-inline { display: flex; align-items: center; gap: 10px; }
  .alert-inline-icon { font-size: 16px; }
  .alert-inline-text { font-size: 12px; color: #cbd5e1; }
  .alert-inline-text strong { color: #fca5a5; font-weight: 700; }

  .report-stats-inline { display: flex; align-items: center; gap: 16px; }
  .stat-inline { display: flex; align-items: baseline; gap: 6px; }
  .stat-inline strong { font-size: 18px; font-weight: 800; font-family: 'JetBrains Mono', monospace; line-height: 1; }
  .stat-inline span { font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: .04em; }
  .stat-inline-sep { width: 1px; height: 16px; background: rgba(255,255,255,0.12); }

  /* ── Resumo Executivo ── */
  .exec-summary {
    background: #fff; border: 1px solid #e2e8f0; border-radius: 14px;
    padding: 24px 28px 28px; margin-bottom: 28px;
    box-shadow: 0 8px 28px rgba(15,23,42,0.09);
  }
  .exec-summary-title { display:flex; align-items:center; gap:14px; margin-bottom:20px; padding-bottom:16px; border-bottom:1px solid #f1f5f9; }
  .exec-summary-icon {
    width:40px; height:40px; border-radius:10px;
    background: linear-gradient(135deg,#eff6ff 0%,#dbeafe 100%);
    border:1px solid #bfdbfe; box-shadow: inset 0 1px 2px rgba(255,255,255,.8), 0 2px 6px rgba(37,99,235,.12);
    display:flex; align-items:center; justify-content:center; font-size:18px; flex-shrink:0;
  }
  .exec-title-main { font-size:16px; font-weight:800; color:#0f172a; letter-spacing:-0.01em; }
  .exec-title-sub { font-size:11.5px; color:#94a3b8; margin-top:2px; }

  /* Card de destaque — "herói" do resumo */
  .exec-headline {
    position: relative; overflow: hidden;
    border-radius: 14px; padding: 22px 28px; margin-bottom: 24px;
    display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap;
    box-shadow: 0 10px 30px rgba(15,23,42,0.22);
  }
  .exec-headline-glow {
    position:absolute; top:-50px; right:-30px; width:180px; height:180px; border-radius:50%;
    background:rgba(255,255,255,0.08); pointer-events:none;
  }
  .exec-headline-glow2 {
    position:absolute; bottom:-60px; right:120px; width:130px; height:130px; border-radius:50%;
    background:rgba(255,255,255,0.05); pointer-events:none;
  }
  .exec-headline-left { display:flex; align-items:center; gap:18px; position:relative; }
  .exec-headline-icon {
    width:56px; height:56px; border-radius:14px; background:rgba(255,255,255,0.15);
    border:1.5px solid rgba(255,255,255,0.28); display:flex; align-items:center; justify-content:center;
    font-size:26px; flex-shrink:0;
  }
  .exec-headline-label { font-size:11.5px; color:rgba(255,255,255,0.72); text-transform:uppercase; letter-spacing:.06em; font-weight:600; margin-bottom:5px; }
  .exec-headline-value { font-size:30px; font-weight:900; color:#fff; letter-spacing:-0.01em; line-height:1; }
  .exec-headline-value span { font-family:'JetBrains Mono',monospace; font-weight:800; }
  .exec-headline-meta { display:flex; align-items:center; gap:18px; position:relative; }
  .exec-headline-meta-item { text-align:center; }
  .exec-headline-meta-item strong { display:block; font-size:24px; font-weight:800; color:#fff; font-family:'JetBrains Mono',monospace; line-height:1; }
  .exec-headline-meta-item span { display:block; font-size:9.5px; color:rgba(255,255,255,0.65); text-transform:uppercase; letter-spacing:.06em; margin-top:4px; }
  .exec-headline-meta-sep { width:1px; height:34px; background:rgba(255,255,255,0.2); }

  .exec-blocks { display:flex; flex-direction:column; gap: 18px; }
  .exec-block {
    background:#fff; border:1px solid #e9edf3; border-radius:12px; padding:22px 28px;
    box-shadow: 0 4px 16px rgba(15,23,42,0.07);
    border-top: 4px solid #cbd5e1;
  }
  .exec-block--narrative { border-top-color: #3b82f6; }
  .exec-block--bars  { border-top-color: #dc2626; }
  .exec-block-title {
    font-size:11.5px; font-weight:800; text-transform:uppercase; letter-spacing:.06em; color:#475569;
    margin-bottom:18px; display:flex; align-items:center; gap:8px;
  }
  .exec-block-title-icon { font-size:14px; }

  .exec-narrative { max-width: 880px; }
  .exec-narrative p { font-size:13.5px; color:#334155; line-height:1.8; margin-bottom:12px; }
  .exec-narrative p:last-child { margin-bottom:0; }
  .exec-narrative strong { color:#0f172a; }

  .donut-empty { font-size:12px; color:#94a3b8; font-style:italic; padding:30px 0; text-align:center; }

  .reg-bar-legend {
    display:flex; gap:20px; margin-bottom:16px; padding:10px 14px;
    background:#f8fafc; border:1px solid #e9edf3; border-radius:8px; font-size:11px; color:#475569; font-weight:600;
  }
  .reg-bar-legend span { display:flex; align-items:center; gap:6px; }
  .reg-bar-legend i { font-size:13px; }
  .reg-cat-blocks-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(255px, 1fr)); gap: 16px; align-items:start; }
  .reg-cat-block {
    min-width: 0; background:#fbfcfd; border:1px solid #e9edf3; border-top:3px solid #cbd5e1;
    border-radius:10px; padding:16px 18px 18px;
  }
  .reg-cat-block-title {
    font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.06em; color:#475569;
    margin-bottom:14px; display:flex; align-items:center; gap:8px; padding-bottom:10px; border-bottom:1px solid #e9edf3;
  }
  .reg-cat-dot { width:9px; height:9px; border-radius:3px; flex-shrink:0; }
  .reg-cat-block-count { margin-left:auto; font-family:'JetBrains Mono',monospace; font-weight:700; color:#94a3b8; font-size:10px; text-transform:none; letter-spacing:0; }
  .reg-item-list { display:flex; flex-direction:column; gap:4px; }
  .reg-item-row { display:flex; flex-direction:column; gap:7px; }
  .reg-item-row:not(.reg-item-row--top) { padding-bottom:12px; border-bottom:1px solid #f1f5f9; }
  .reg-item-row:not(.reg-item-row--top):last-child { border-bottom:none; padding-bottom:0; }
  .reg-item-name-line { display:flex; align-items:center; gap:9px; }
  .reg-item-rank {
    width:20px; height:20px; border-radius:6px; background:#f1f5f9; color:#64748b;
    font-size:11px; font-weight:800; font-family:'JetBrains Mono',monospace;
    display:flex; align-items:center; justify-content:center; flex-shrink:0;
  }
  .reg-item-label { font-size:14px; font-weight:800; color:#1e293b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; }
  .reg-item-stats-line { display:flex; align-items:center; gap:7px; padding-left:29px; font-size:11.5px; color:#64748b; font-weight:600; }
  .reg-item-sep { color:#cbd5e1; }
  .reg-item-pct-full { color:#475569; }
  .reg-item-net-line {
    font-size:13px; font-weight:800; font-family:'JetBrains Mono',monospace;
    padding-left:29px;
  }
  .reg-item-level-line { display:flex; align-items:center; gap:6px; padding-left:29px; flex-wrap:wrap; }
  .reg-item-level-badge {
    display:flex; align-items:center; gap:5px; font-size:11px; font-weight:800;
    padding:4px 10px; border-radius:7px; line-height:1.3;
  }
  .reg-item-level-badge i { font-size:12px; }
  .reg-item-level-badge--critico { background:#fef2f2; color:#dc2626; }
  .reg-item-level-badge--urgente { background:#fff7ed; color:#ea580c; }

  /* ── Blocos globais Crítico / Urgente ── */
  .level-block { border-radius: 12px; overflow: hidden; margin-bottom: 26px; border: 1px solid #e2e8f0; }
  .level-block--critico { box-shadow: 0 8px 28px rgba(220,38,38,0.22); border: 2px solid #fca5a5; }
  .level-block--urgente { box-shadow: 0 4px 18px rgba(249,115,22,0.16); }
  .level-block-header {
    padding: 20px 26px; display:flex; align-items:center; justify-content:space-between;
    position:relative; overflow:hidden;
  }
  .level-block--critico .level-block-header { padding: 26px 30px; }
  .level-block-header-glow {
    position:absolute; right:-30px; top:-30px; width:140px; height:140px; border-radius:50%;
    background:rgba(255,255,255,0.07); pointer-events:none;
  }
  .level-block-header-left { display:flex; align-items:center; gap:16px; position:relative; }
  .level-block-icon {
    width:52px; height:52px; border-radius:13px; border:1.5px solid;
    display:flex; align-items:center; justify-content:center; font-size:24px; flex-shrink:0; color:#fff;
  }
  .level-block--critico .level-block-icon { width:60px; height:60px; font-size:28px; }
  .level-block-title { font-weight:900; color:#fff; letter-spacing:.07em; line-height:1; text-transform:uppercase; }
  .level-block-sub { font-size:12.5px; color:rgba(255,255,255,0.65); margin-top:6px; font-weight:500; }
  .level-block-count {
    background: rgba(255,255,255,0.15); border:1.5px solid rgba(255,255,255,0.25); color:#fff;
    padding:7px 18px; border-radius:24px; font-size:13.5px; font-weight:800; letter-spacing:.03em; position:relative;
    flex-shrink: 0;
  }

  /* Data table */
  .data-table { width: 100%; border-collapse: collapse; background:#fff; }
  .data-table thead tr { background: #f8fafc; }
  .data-table th {
    padding: 10px 16px;
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .07em; color: #64748b;
    text-align: left; border-bottom: 1px solid #e2e8f0;
  }
  .data-table tbody tr.data-row { border-bottom: 1px solid #f1f5f9; }
  .data-table tbody tr.data-row--alt { background:#fafbfc; }
  .data-table tbody.cat-group:last-child tr.data-row:last-child { border-bottom: none; }

  /* Cabeçalho de categoria dentro do bloco */
  .cat-header-row { }
  .cat-header-cell { padding: 11px 18px 11px 14px !important; }
  .cat-header-inner { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .cat-header-label { font-size: 13.5px; font-weight: 900; text-transform: uppercase; letter-spacing: .09em; }
  .cat-header-right { display: flex; align-items: baseline; gap: 18px; }
  .cat-header-net { font-size: 11.5px; font-weight: 700; font-family: 'JetBrains Mono', monospace; }
  .cat-header-net strong { font-weight: 800; }
  .cat-header-count { font-size: 11px; font-weight: 700; font-family: 'JetBrains Mono', monospace; opacity: .8; }

  .rank-cell { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #94a3b8; font-weight: 600; }
  .reg-cell { font-size: 12px; color:#334155; font-weight:600; }
  .central-cell { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #475569; font-weight: 500; }
  .mat-name { font-weight: 700; font-size: 13px; color: #1e293b; }
  .var-cell { font-size: 12px; white-space:nowrap; }
  .var-cell i, .cat-header-net i, .reg-item-net-line i, .exec-headline-value i { font-size: 0.9em; margin-right: 3px; vertical-align: -1px; }
  .var-kg { font-size:11px; font-weight:500; }
  .empty-cell { text-align:center; padding:18px; color:#94a3b8; font-style:italic; font-size:12px; }

  /* Footer */
  .report-footer {
    margin-top: 10px; padding: 18px 24px;
    background: #1e293b; border-radius: 12px; color: #64748b;
    display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;
    font-size: 11px;
  }
  .report-footer strong { color: #94a3b8; }

  /* Print */
  @media print {
    body { background: #fff !important; }
    .action-bar { display: none !important; }
    .page-wrap { padding: 0 !important; max-width: 100% !important; }
    .level-block { page-break-inside: auto; }
    .data-table tr { page-break-inside: avoid; }
    .level-block-header { page-break-after: avoid; }
    .cat-header-row { page-break-after: avoid; }
    .report-header { background: #0f172a !important; -webkit-print-color-adjust: exact; color-adjust: exact; }
    .report-header-bottom { -webkit-print-color-adjust: exact; color-adjust: exact; }
    .level-block-header { -webkit-print-color-adjust: exact; color-adjust: exact; }
    .data-table thead tr { -webkit-print-color-adjust: exact; color-adjust: exact; }
    .cat-header-cell { -webkit-print-color-adjust: exact; color-adjust: exact; }
    .exec-summary { page-break-inside: avoid; box-shadow:none !important; }
    .exec-headline { -webkit-print-color-adjust: exact; color-adjust: exact; box-shadow:none !important; }
    .exec-block { box-shadow:none !important; }
    .reg-item-level-badge--critico, .reg-item-level-badge--urgente, .reg-cat-dot, .reg-cat-block {
      -webkit-print-color-adjust: exact; color-adjust: exact;
    }
  }
</style>
</head>
<body>

<!-- Action bar (hidden on print) -->
<div class="action-bar">
  <div class="action-bar-title">
    ${opts.title}
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
      <div class="logos-wrap">
        <img class="logo-concrelagos"
          src="https://concrelagos.com.br/wp-content/uploads/2021/10/Ativo-3.svg"
          alt="Concrelagos Concreto">
        <div class="logo-sep"></div>
        <div class="logo-analyticsys">
          <svg width="20" height="22" viewBox="0 0 40 44" fill="none">
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
      <div class="report-meta">
        <div class="meta-label">Período analisado</div>
        <div class="meta-value">${periodo}</div>
        <div class="meta-label" style="margin-top:8px">Gerado em</div>
        <div class="meta-value">${now}</div>
      </div>
    </div>

    <div class="report-title-block" style="margin-bottom:16px">
      <h1>${opts.title}</h1>
      <p>${opts.subtitle}</p>
    </div>

    <div class="report-header-bottom">
      <div class="report-alert-inline">
        <span class="alert-inline-icon">🚨</span>
        <span class="alert-inline-text"><strong>Alerta de criticidade</strong> — ação imediata ou monitoramento reforçado necessário</span>
      </div>
      <div class="report-stats-inline">
        <div class="stat-inline"><strong style="color:#f87171">${totalCritico}</strong><span>críticos</span></div>
        <div class="stat-inline-sep"></div>
        <div class="stat-inline"><strong style="color:#fb923c">${totalUrgente}</strong><span>urgentes</span></div>
        <div class="stat-inline-sep"></div>
        <div class="stat-inline"><strong style="color:#60a5fa">${totalRegionais}</strong><span>regionais</span></div>
        <div class="stat-inline-sep"></div>
        <div class="stat-inline"><strong style="color:#e2e8f0">${totalGeral}</strong><span>total</span></div>
      </div>
    </div>
  </div>

  ${opts.bodyHtml}

  <!-- Footer -->
  <div class="report-footer">
    <div>
      <strong>AnalyticSys</strong> · Gestão Centralizada de Materiais · Concrelagos Concreto<br>
      Documento gerado automaticamente em ${now}
    </div>
    <div style="text-align:right">
      Período: <strong style="color:#94a3b8">${periodo}</strong><br>
      ${totalGeral} ocorrência${totalGeral !== 1 ? 's' : ''} (crítico + urgente) em ${totalRegionais} regional${totalRegionais !== 1 ? 'is' : ''}
    </div>
  </div>
</div>

</body>
</html>`;
}

// ── Abre o relatório em nova janela ──
function _openCriticidadeWindow(html) {
  const w = window.open('', '_blank', 'width=1400,height=900,scrollbars=yes,resizable=yes');
  if (!w) { alert('Popups bloqueados! Permita pop-ups para este site para gerar o relatório.'); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
}

// ── Botão "Visão Diretoria" — Resumo Executivo isolado (narrativa + gráficos) ──
window.gerarVisaoDiretoria = function() {
  const d = _buildCriticidadeData();
  if (!d) return;
  const html = _buildCriticidadeShell(d, {
    pageTitle: `Visão Diretoria — ${d.periodo}`,
    title: 'Visão Diretoria',
    subtitle: 'Resumo executivo de criticidade · AnalyticSys · Concrelagos Concreto',
    bodyHtml: d.execSummaryHtml,
  });
  _openCriticidadeWindow(html);
};

// ── Botão "Relatório Detalhado" — Ranking completo Crítico/Urgente por regional, central e material ──
window.gerarRelatorioDetalhado = function() {
  const d = _buildCriticidadeData();
  if (!d) return;
  const html = _buildCriticidadeShell(d, {
    pageTitle: `Relatório Detalhado de Criticidade — ${d.periodo}`,
    title: 'Relatório Detalhado de Criticidade',
    subtitle: 'Ranking completo por regional, central e material · AnalyticSys · Concrelagos Concreto',
    bodyHtml: `${d.criticoBlock}\n  ${d.urgenteBlock}`,
  });
  _openCriticidadeWindow(html);
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
// MODAL DE SELEÇÃO — Tipo de Relatório da Central (Analítico)
// ═══════════════════════════════════════════════════════════════════

window.abrirModalRelatorioCentral = function(centralName) {
  let modal = document.getElementById('an-rel-central-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'an-rel-central-modal';
    modal.className = 'modal-overlay';
    modal.style.cssText = 'z-index:3200';
    document.body.appendChild(modal);
  }

  const safe = centralName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  modal.innerHTML = `
    <div class="modal" style="max-width:460px;width:94vw">
      <div class="modal-title" style="display:flex;align-items:center;gap:10px">
        <i class="ti ti-file-analytics" style="color:var(--accent)"></i>
        Relatório de Central
      </div>
      <div class="modal-sub">${centralName} · selecione o tipo de relatório</div>
      <div style="display:flex;flex-direction:column;gap:10px;margin:20px 0">

        <button onclick="document.getElementById('an-rel-central-modal').classList.remove('open');gerarRelatorioCentral('${safe}');"
          style="display:flex;align-items:flex-start;gap:14px;width:100%;padding:16px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;cursor:pointer;font-family:inherit;color:var(--text);text-align:left;transition:border-color .15s,background .15s"
          onmouseover="this.style.borderColor='var(--accent)';this.style.background='var(--bg3)'"
          onmouseout="this.style.borderColor='var(--border)';this.style.background='var(--bg2)'">
          <div style="width:38px;height:38px;border-radius:9px;background:linear-gradient(135deg,rgba(29,78,216,0.18),rgba(37,99,235,0.12));border:1px solid rgba(37,99,235,0.3);display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <i class="ti ti-chart-bar" style="color:#60a5fa;font-size:17px"></i>
          </div>
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:3px">Relatório Padrão</div>
            <div style="font-size:12px;color:var(--text2);line-height:1.5">Criticidade de materiais por nível — crítico, urgente e atenção. Variação e tendência por material.</div>
          </div>
        </button>

        <button onclick="document.getElementById('an-rel-central-modal').classList.remove('open');gerarRelatorioComAcoes('${safe}');"
          style="display:flex;align-items:flex-start;gap:14px;width:100%;padding:16px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;cursor:pointer;font-family:inherit;color:var(--text);text-align:left;transition:border-color .15s,background .15s"
          onmouseover="this.style.borderColor='var(--accent)';this.style.background='var(--bg3)'"
          onmouseout="this.style.borderColor='var(--border)';this.style.background='var(--bg2)'">
          <div style="width:38px;height:38px;border-radius:9px;background:linear-gradient(135deg,rgba(16,185,129,0.18),rgba(5,150,105,0.12));border:1px solid rgba(16,185,129,0.3);display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <i class="ti ti-checklist" style="color:#34d399;font-size:17px"></i>
          </div>
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:3px">Relatório com Ações</div>
            <div style="font-size:12px;color:var(--text2);line-height:1.5">Inclui ações propostas por material com base nas regras cadastradas em Configurações → Ações de Relatório.</div>
          </div>
        </button>

      </div>
      <div class="form-actions">
        <button class="btn" onclick="document.getElementById('an-rel-central-modal').classList.remove('open')">Cancelar</button>
      </div>
    </div>`;

  modal.classList.add('open');
  modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('open'); };
};

// ═══════════════════════════════════════════════════════════════════
// HELPER — resolve ações para um material/variação
// Retorna a string de ações da regra mais próxima do valor, ou null
// ═══════════════════════════════════════════════════════════════════

function _resolverAcoesParaMaterial(materialNome, variacao, categoriaItem, nivelItem, catKeyItem, catSubKeyItem) {
  const regras = (state.acoesRelatorio || []);
  if (!regras.length) return null;

  // Helper: normaliza string para comparação
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

  // Mapeamento: valor do checkbox → catKey(s) ou catSubKey(s) usados pelo sistema
  // Prioridade: catSubKey (distingue miúdo/graúdo) > catKey (agregado genérico)
  const CHECKBOX_TO_KEYS = {
    'agregados miudos':   { subKeys: ['agregado_miudo'],  fallbackKey: null },
    'agregados graudos':  { subKeys: ['agregado_graudo'], fallbackKey: null },
    'aglomerantes':       { subKeys: [],                  fallbackKey: 'aglomerante' },
    'aditivos e adicoes': { subKeys: [],                  fallbackKey: ['aditivo', 'adicao'] },
  };

  // Tenta match por categoria + nível (novo formato)
  const nivelNorm  = norm(nivelItem || '');
  const catKeyNorm    = norm(catKeyItem || '');
  const catSubKeyNorm = norm(catSubKeyItem || '');

  const porCategoriaNivel = regras.filter(r => {
    if (!Array.isArray(r.categorias) || !r.nivel) return false;
    const matchNivel = norm(r.nivel) === nivelNorm;
    if (!matchNivel) return false;

    const matchCat = r.categorias.some(c => {
      const map = CHECKBOX_TO_KEYS[norm(c)];
      if (!map) return false;
      // Match por subKey (miúdo/graúdo) se disponível
      if (map.subKeys.length && catSubKeyNorm) {
        return map.subKeys.includes(catSubKeyNorm);
      }
      // Match por catKey genérico (aglomerante, aditivo, adicao)
      const fk = map.fallbackKey;
      if (!fk) return false;
      if (Array.isArray(fk)) return fk.includes(catKeyNorm);
      return fk === catKeyNorm;
    });
    return matchCat;
  });

  if (porCategoriaNivel.length) {
    return porCategoriaNivel[0].acoes;
  }

  // Compatibilidade retroativa: tenta match pelo nome do material + operador/valor (formato antigo)
  const legado = regras.filter(r => {
    if (!r.material || !r.operador) return false;
    const normA = norm(r.material);
    const normM = norm(materialNome);
    return normA === normM;
  });

  if (!legado.length) return null;

  const avaliarRegra = (r) => {
    const v = Number(r.valor);
    switch (r.operador) {
      case 'lt':  return variacao <  v;
      case 'lte': return variacao <= v;
      case 'eq':  return Math.abs(variacao - v) < 0.001;
      case 'gte': return variacao >= v;
      case 'gt':  return variacao >  v;
      default:    return false;
    }
  };

  const candidatas = legado.filter(avaliarRegra);
  if (!candidatas.length) return null;

  candidatas.sort((a, b) => Math.abs(Number(a.valor) - variacao) - Math.abs(Number(b.valor) - variacao));
  return candidatas[0].acoes;
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

// ═══════════════════════════════════════════════════════════════════
// RELATÓRIO COM AÇÕES — igual ao Padrão + coluna de ações por material
// ═══════════════════════════════════════════════════════════════════

window.gerarRelatorioComAcoes = function(centralName) {
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

  const totalRegras = (state.acoesRelatorio || []).length;
  if (!totalRegras) {
    if (!confirm('Nenhuma regra cadastrada em Configurações → Ações de Relatório.\nO relatório será gerado sem ações associadas. Continuar?')) return;
  }

  const periodo = _getAnPeriodo();
  const now = new Date().toLocaleString('pt-BR');

  function fmtKgC(v) { const n=Math.abs(Number(v)||0); return n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+' kg'; }
  function varDir(v)  { return v < -0.001 ? 'Desfalque' : v > 0.001 ? 'Sobra' : 'Equilibrado'; }
  function varColor(v){ return v < -0.001 ? '#ef4444'   : v > 0.001 ? '#f59e0b' : '#6b7280'; }
  function trendLabel(t){ return t==='worsening' ? '▲ Piorando' : t==='improving' ? '▼ Melhorando' : '→ Estável'; }
  function trendColor(t){ return t==='worsening' ? '#ef4444' : t==='improving' ? '#10b981' : '#64748b'; }
  function escC(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // Monta cards de material — layout vertical, sem tabela
  function buildCards(items, levelColor, levelBg, levelKey) {
    return items.map((item, idx) => {
      const acoes  = _resolverAcoesParaMaterial(item.mat, item.diff, item.categoria, levelKey || item.level, item.catKey, item.catSubKey);
      const vc     = varColor(item.diff);
      const tc     = trendColor(item.trend);
      const hasAcao = acoes !== null;

      // Cada ação separada por ponto-e-vírgula vira um bullet
      const acoesItems = hasAcao
        ? acoes.split(/[;|\n]/).map(a => a.trim()).filter(Boolean)
        : [];

      const acoesBullets = acoesItems.map(a =>
        '<li style="margin-bottom:5px;padding-left:4px;word-break:break-word;overflow-wrap:break-word">' + escC(a) + '</li>'
      ).join('');

      const acoesBlock = hasAcao
        ? '<div style="margin-top:14px;padding-top:14px;border-top:1px solid #e2e8f0">' +
            '<div style="display:flex;align-items:center;gap:7px;margin-bottom:10px">' +
              '<span style="width:20px;height:20px;border-radius:50%;background:#dcfce7;border:1.5px solid #86efac;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:11px">✓</span>' +
              '<span style="font-size:11px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:.06em">Ações propostas</span>' +
            '</div>' +
            '<ul style="margin:0;padding-left:18px;font-size:13px;color:#1e293b;line-height:1.7;word-break:break-word;overflow-wrap:break-word">' + acoesBullets + '</ul>' +
          '</div>'
        : '<div style="margin-top:14px;padding-top:14px;border-top:1px solid #f1f5f9;display:flex;align-items:center;gap:7px">' +
            '<span style="width:20px;height:20px;border-radius:50%;background:#f8fafc;border:1.5px solid #e2e8f0;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:11px;color:#94a3b8">—</span>' +
            '<span style="font-size:12px;color:#94a3b8;font-style:italic">Sem regra cadastrada para esta variação</span>' +
          '</div>';

      return '<div style="background:#fff;border:1px solid #e2e8f0;border-left:4px solid ' + levelColor + ';border-radius:10px;padding:18px 20px;margin-bottom:12px;page-break-inside:avoid;overflow:hidden;word-break:break-word">' +

        // Linha topo: número + nome do material
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px">' +
          '<div style="display:flex;align-items:center;gap:10px">' +
            '<span style="width:26px;height:26px;border-radius:7px;background:' + levelBg + ';color:' + levelColor + ';font-size:11px;font-weight:800;font-family:\'JetBrains Mono\',monospace;display:flex;align-items:center;justify-content:center;flex-shrink:0">' + (idx+1) + '</span>' +
            '<span style="font-size:15px;font-weight:700;color:#0f172a">' + escC(item.mat) + '</span>' +
          '</div>' +
          (hasAcao
            ? '<span style="padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;background:#dcfce7;color:#15803d;border:1px solid #86efac;white-space:nowrap;flex-shrink:0">✓ Com ação</span>'
            : '<span style="padding:3px 10px;border-radius:20px;font-size:10px;font-weight:600;background:#f8fafc;color:#94a3b8;border:1px solid #e2e8f0;white-space:nowrap;flex-shrink:0">Sem ação</span>'
          ) +
        '</div>' +

        // Linha de métricas: variação + tendência
        '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
          '<div style="display:flex;align-items:center;gap:7px;padding:7px 12px;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0;min-width:160px">' +
            '<div>' +
              '<div style="font-size:10px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px">Variação</div>' +
              '<div style="font-size:14px;font-weight:800;color:' + vc + ';font-family:\'JetBrains Mono\',monospace">' + varDir(item.diff) + '</div>' +
              '<div style="font-size:12px;font-weight:500;color:' + vc + ';font-family:\'JetBrains Mono\',monospace">' + fmtKgC(item.diff) + '</div>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:7px;padding:7px 12px;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0;min-width:140px">' +
            '<div>' +
              '<div style="font-size:10px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px">Tendência</div>' +
              '<div style="font-size:13px;font-weight:700;color:' + tc + '">' + trendLabel(item.trend) + '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        acoesBlock +
      '</div>';
    }).join('');
  }

  const lvlCfg = {
    critico: { color:'#ef4444', bg:'#fef2f2', grad:'linear-gradient(135deg,#7f1d1d 0%,#991b1b 60%,#b91c1c 100%)', glow:'rgba(239,68,68,0.30)', icon:'🔴', label:'CRÍTICO', sub:'Ação imediata — escalar à gerência' },
    urgente: { color:'#f97316', bg:'#fff7ed', grad:'linear-gradient(135deg,#7c2d12 0%,#9a3412 60%,#c2410c 100%)', glow:'rgba(249,115,22,0.28)', icon:'🟠', label:'URGENTE', sub:'Atenção redobrada — repassar aos regionais' },
    atencao: { color:'#f59e0b', bg:'#fffbeb', grad:'linear-gradient(135deg,#78350f 0%,#92400e 60%,#b45309 100%)', glow:'rgba(245,158,11,0.25)', icon:'⚠️', label:'ATENÇÃO', sub:'Monitorar — contatar operador' },
  };

  function buildLevelSection(items, cfg, levelKey) {
    if (!items.length) return '';
    const cards = buildCards(items, cfg.color, cfg.bg, levelKey);
    return '<div style="margin-bottom:32px;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px ' + cfg.glow + ';page-break-inside:avoid">' +
      // Header colorido
      '<div style="background:' + cfg.grad + ';padding:20px 28px;display:flex;align-items:center;justify-content:space-between;position:relative;overflow:hidden">' +
        '<div style="position:absolute;right:-20px;top:-20px;width:110px;height:110px;border-radius:50%;background:rgba(255,255,255,0.06);pointer-events:none"></div>' +
        '<div style="display:flex;align-items:center;gap:16px;position:relative">' +
          '<div style="width:52px;height:52px;border-radius:13px;background:rgba(255,255,255,0.13);border:1.5px solid rgba(255,255,255,0.22);display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">' + cfg.icon + '</div>' +
          '<div>' +
            '<div style="font-size:20px;font-weight:900;color:#fff;letter-spacing:.06em;line-height:1;text-transform:uppercase">' + cfg.label + '</div>' +
            '<div style="font-size:12px;color:rgba(255,255,255,0.65);margin-top:5px;font-weight:500">' + cfg.sub + '</div>' +
          '</div>' +
        '</div>' +
        '<span style="background:rgba(255,255,255,0.15);border:1.5px solid rgba(255,255,255,0.25);color:#fff;padding:7px 18px;border-radius:24px;font-size:13px;font-weight:800;position:relative">' + items.length + ' ' + (items.length > 1 ? 'materiais' : 'material') + '</span>' +
      '</div>' +
      // Cards de material
      '<div style="background:#f8fafc;padding:16px 20px;border:1px solid #e2e8f0;border-top:none">' +
        cards +
      '</div>' +
    '</div>';
  }

  const allItems = [...criticos, ...urgentes, ...atencoes];
  const totalGeral = allItems.length;
  const regional   = allItems[0]?.regional || '—';
  const comAcoes   = allItems.filter(i => _resolverAcoesParaMaterial(i.mat, i.diff, i.categoria, i.level, i.catKey, i.catSubKey) !== null).length;
  const semAcoes   = totalGeral - comAcoes;

  const sectionsHtml =
    buildLevelSection(criticos, lvlCfg.critico, 'critico') +
    buildLevelSection(urgentes, lvlCfg.urgente, 'urgente') +
    buildLevelSection(atencoes, lvlCfg.atencao, 'atencao');

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Relatório com Ações — ${escC(centralName)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap');
  *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Inter',system-ui,sans-serif; background:#f1f5f9; color:#0f172a; font-size:13px; line-height:1.6; -webkit-font-smoothing:antialiased; }
  .page-wrap { max-width:860px; margin:0 auto; padding:24px 20px 48px; }

  .action-bar { position:sticky; top:0; z-index:100; background:#1e293b; display:flex; align-items:center; justify-content:space-between; padding:12px 24px; box-shadow:0 2px 12px rgba(0,0,0,0.25); flex-wrap:wrap; gap:10px; }
  .action-bar-title { color:#e2e8f0; font-size:13px; font-weight:500; }
  .action-bar-title span { color:#64748b; font-size:11px; margin-left:10px; }
  .action-bar-btns { display:flex; gap:10px; }
  .btn-print { background:#2563eb; color:#fff; border:none; border-radius:7px; padding:8px 18px; font-size:13px; font-weight:600; cursor:pointer; }
  .btn-print:hover { background:#1d4ed8; }
  .btn-close { background:#334155; color:#cbd5e1; border:none; border-radius:7px; padding:8px 14px; font-size:13px; cursor:pointer; }

  .report-header { background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%); color:#fff; border-radius:16px; padding:32px 36px; margin-bottom:28px; position:relative; overflow:hidden; }
  .report-header::before { content:''; position:absolute; top:-50px; right:-50px; width:220px; height:220px; border-radius:50%; background:rgba(16,185,129,0.07); border:2px solid rgba(16,185,129,0.12); pointer-events:none; }
  .rh-top { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:22px; flex-wrap:wrap; gap:16px; }
  .rh-logo { display:flex; align-items:center; gap:14px; }
  .rh-icon { width:52px; height:52px; border-radius:13px; background:rgba(16,185,129,0.18); border:1px solid rgba(16,185,129,0.3); display:flex; align-items:center; justify-content:center; font-size:24px; flex-shrink:0; }
  .rh-title { font-size:20px; font-weight:800; color:#f8fafc; letter-spacing:-0.02em; line-height:1.2; }
  .rh-sub { font-size:12px; color:#94a3b8; margin-top:3px; }
  .rh-meta { text-align:right; }
  .rh-meta-label { font-size:10px; color:#64748b; text-transform:uppercase; letter-spacing:.06em; }
  .rh-meta-value { font-size:13px; color:#cbd5e1; font-weight:500; margin-top:2px; }

  .info-bar { display:flex; align-items:center; gap:20px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.10); border-radius:10px; padding:14px 18px; margin-bottom:20px; flex-wrap:wrap; gap:16px; }
  .info-item { display:flex; flex-direction:column; gap:2px; }
  .info-label { font-size:10px; color:#64748b; text-transform:uppercase; letter-spacing:.06em; }
  .info-value { font-size:13px; color:#e2e8f0; font-weight:600; }
  .info-sep { width:1px; height:32px; background:rgba(255,255,255,0.10); flex-shrink:0; }

  .stats-grid { display:grid; grid-template-columns:repeat(5,1fr); gap:12px; }
  .stat { background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:14px 12px; text-align:center; }
  .stat-n { font-size:28px; font-weight:800; line-height:1; margin-bottom:4px; font-family:'JetBrains Mono',monospace; }
  .stat-l { font-size:10px; color:#94a3b8; text-transform:uppercase; letter-spacing:.05em; font-weight:500; }

  .confidential { background:linear-gradient(90deg,#064e3b,#065f46); color:#6ee7b7; font-size:11px; font-weight:700; letter-spacing:.10em; text-transform:uppercase; padding:7px 20px; border-radius:8px; text-align:center; margin-bottom:20px; }

  .report-footer { margin-top:40px; padding:18px 24px; background:#1e293b; border-radius:12px; color:#64748b; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; font-size:11px; }
  .report-footer strong { color:#94a3b8; }

  @media print {
    body { background:#fff !important; }
    .action-bar { display:none !important; }
    .page-wrap { padding:0 !important; max-width:100% !important; }
    .report-header { background:#0f172a !important; -webkit-print-color-adjust:exact; color-adjust:exact; }
    div[style*="page-break-inside:avoid"] { page-break-inside:avoid; }
    ul li { -webkit-print-color-adjust:exact; color-adjust:exact; }
  }
  @media (max-width:600px) {
    .stats-grid { grid-template-columns:repeat(3,1fr); }
    .rh-top { flex-direction:column; }
    .rh-meta { text-align:left; }
  }
</style>
</head>
<body>

<div class="action-bar">
  <div class="action-bar-title">
    Relatório com Ações — ${escC(centralName)}
    <span>Período: ${escC(periodo)} · Gerado em ${now}</span>
  </div>
  <div class="action-bar-btns">
    <button class="btn-print" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button>
    <button class="btn-close" onclick="window.close()">✕ Fechar</button>
  </div>
</div>

<div class="page-wrap">

  <div class="confidential" style="margin-top:4px">⚠ Documento Confidencial — Uso interno · Operadores e Gerência</div>

  <div class="report-header">
    <div class="rh-top">
      <div class="rh-logo">
        <div class="rh-icon">✅</div>
        <div>
          <div class="rh-title">Relatório com Ações</div>
          <div class="rh-sub">${escC(centralName)} · AnalyticSys · Gestão Centralizada de Materiais</div>
        </div>
      </div>
      <div class="rh-meta">
        <div class="rh-meta-label">Período analisado</div>
        <div class="rh-meta-value">${escC(periodo)}</div>
        <div class="rh-meta-label" style="margin-top:8px">Gerado em</div>
        <div class="rh-meta-value">${now}</div>
      </div>
    </div>

    <div class="info-bar">
      <div class="info-item"><span class="info-label">Central</span><span class="info-value">${escC(centralName)}</span></div>
      <div class="info-sep"></div>
      <div class="info-item"><span class="info-label">Regional</span><span class="info-value">${escC(regional)}</span></div>
      <div class="info-sep"></div>
      <div class="info-item"><span class="info-label">Total de materiais</span><span class="info-value">${totalGeral}</span></div>
      <div class="info-sep"></div>
      <div class="info-item"><span class="info-label">Regras cadastradas</span><span class="info-value">${totalRegras}</span></div>
    </div>

    <div class="stats-grid">
      <div class="stat"><div class="stat-n" style="color:#f87171">${criticos.length}</div><div class="stat-l">🔴 Críticos</div></div>
      <div class="stat"><div class="stat-n" style="color:#fb923c">${urgentes.length}</div><div class="stat-l">🟠 Urgentes</div></div>
      <div class="stat"><div class="stat-n" style="color:#fbbf24">${atencoes.length}</div><div class="stat-l">⚠️ Atenção</div></div>
      <div class="stat"><div class="stat-n" style="color:#34d399">${comAcoes}</div><div class="stat-l">✅ Com ação</div></div>
      <div class="stat"><div class="stat-n" style="color:#94a3b8">${semAcoes}</div><div class="stat-l">— Sem ação</div></div>
    </div>
  </div>

  ${sectionsHtml}

  <div class="report-footer">
    <span>Concrelagos Concreto · <strong>AnalyticSys</strong> · Gestão Centralizada de Estoque e Insumos</span>
    <span>Período: <strong>${escC(periodo)}</strong> · ${totalGeral} ${totalGeral !== 1 ? 'materiais' : 'material'} · ${comAcoes} com ação</span>
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
