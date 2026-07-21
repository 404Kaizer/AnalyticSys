function _buildCriticidadeData(categoriasFiltro) {
  const byLevelRaw = window._rankByLevel;
  if (!byLevelRaw || (!byLevelRaw.critico.length && !byLevelRaw.urgente.length)) {
    alert('Nenhum dado de criticidade disponível. Execute a análise primeiro.');
    return null;
  }

  // Se um filtro de categorias foi informado, restringe os dados de origem —
  // todo o restante da função (KPIs, narrativa, blocos, tabelas) já reflete só o selecionado.
  const byLevel = (Array.isArray(categoriasFiltro) && categoriasFiltro.length)
    ? {
        critico: byLevelRaw.critico.filter(i => categoriasFiltro.includes(i.catKey || 'aglomerante')),
        urgente: byLevelRaw.urgente.filter(i => categoriasFiltro.includes(i.catKey || 'aglomerante')),
      }
    : byLevelRaw;

  if (!byLevel.critico.length && !byLevel.urgente.length) {
    alert('Nenhum item encontrado para as categorias selecionadas.');
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

  // ── Tabela estilo "auditoria" — colunas: Nível, Filial, Regional, Material, Variação ──
  // Uma tabela por nível (Crítico/Urgente); duas tabelas ficam lado a lado por categoria.
  function buildAuditTable(items, levelCfg) {
    if (!items.length) {
      return `<div class="audit-table-wrap">
        <div class="audit-table-header" style="background:${levelCfg.headerColor}">
          <i class="ti ${levelCfg.icon}"></i> ${levelCfg.label}
        </div>
        <div class="audit-table-empty">Nenhum item nesta categoria.</div>
      </div>`;
    }
    // Ordem: maior desfalque (diff mais negativo) primeiro → maior sobra (diff mais positivo) por último
    const sorted = [...items].sort((a, b) => (Number(a.diff) || 0) - (Number(b.diff) || 0));
    const rows = sorted.map(item => {
      const cellColor = varDirColor(item.diff);
      return `<tr>
        <td class="audit-td audit-td-nivel"><i class="ti ${levelCfg.icon}" style="color:${levelCfg.headerColor}"></i></td>
        <td class="audit-td audit-td-filial">${escRel(item.central)}</td>
        <td class="audit-td audit-td-regional" title="${escRel(item.regional || '—')}">${escRel(item.regional || '—')}</td>
        <td class="audit-td audit-td-mat" title="${escRel(item.mat)}">${escRel(item.mat)}</td>
        <td class="audit-td audit-td-var" style="background:${cellColor}">${fmtKgSigned(item.diff)}</td>
      </tr>`;
    }).join('');
    return `<div class="audit-table-wrap">
      <div class="audit-table-header" style="background:${levelCfg.headerColor}">
        <i class="ti ${levelCfg.icon}"></i> ${levelCfg.label}
        <span class="audit-table-count">${items.length}</span>
      </div>
      <table class="audit-table">
        <thead><tr>
          <th class="audit-th-nivel">Nível</th>
          <th>Filial</th>
          <th>Regional</th>
          <th>Material</th>
          <th class="audit-th-var">Variação</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  // ── Seção de uma categoria: título + as duas tabelas (Crítico | Urgente) lado a lado ──
  function buildCategoriaAuditSection(catKey, label, criticoItems, urgenteItems) {
    if (!criticoItems.length && !urgenteItems.length) return '';
    const critTable = buildAuditTable(criticoItems, { key: 'critico', label: 'CRÍTICO', headerColor: '#dc2626', icon: 'ti-flame' });
    const urgTable  = buildAuditTable(urgenteItems,  { key: 'urgente', label: 'URGENTE', headerColor: '#f97316', icon: 'ti-alert-circle' });
    return `<section class="audit-section">
      <div class="audit-section-title">${escRel(label)}</div>
      <div class="audit-section-grid">
        ${critTable}
        ${urgTable}
      </div>
    </section>`;
  }

  // ── Monta todas as seções (uma por categoria presente nos dados) ──
  function buildAuditSections() {
    return CAT_ORDER
      .filter(k =>
        byLevel.critico.some(i => (i.catKey || 'aglomerante') === k) ||
        byLevel.urgente.some(i => (i.catKey || 'aglomerante') === k)
      )
      .map(catKey => {
        const crit = byLevel.critico.filter(i => (i.catKey || 'aglomerante') === catKey);
        const urg  = byLevel.urgente.filter(i => (i.catKey || 'aglomerante') === catKey);
        return buildCategoriaAuditSection(catKey, CAT_LABELS[catKey], crit, urg);
      }).join('');
  }

  const auditSectionsHtml = buildAuditSections();

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
        <span class="reg-cat-block-count">${regionais.length} ${regionais.length === 1 ? 'regional' : 'regionais'}</span>
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
    auditSectionsHtml, execSummaryHtml,
  };
}

// ── CSS escuro compartilhado pelos fragmentos de HTML gerados em
//    _buildCriticidadeData (execSummaryHtml e auditSectionsHtml). As classes
//    abaixo têm os MESMOS NOMES usados nesses fragmentos — só a paleta muda
//    para o tema escuro em tela cheia (mesmo padrão do Ranking/Ausência). ──
function _criticidadeDarkStyles() {
  return `
    /* ── Resumo Executivo (Visão Diretoria) ── */
    .exec-summary { background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.09); border-radius:14px; padding:24px 28px 28px; margin-bottom:24px; }
    .exec-summary-title { display:flex; align-items:center; gap:14px; margin-bottom:20px; padding-bottom:16px; border-bottom:1px solid rgba(255,255,255,.08); }
    .exec-summary-icon { width:40px; height:40px; border-radius:10px; background:rgba(59,130,246,.15); border:1px solid rgba(59,130,246,.35); display:flex; align-items:center; justify-content:center; font-size:18px; flex-shrink:0; }
    .exec-title-main { font-size:16px; font-weight:800; color:#fff; letter-spacing:-.01em; }
    .exec-title-sub { font-size:11.5px; color:#94a3b8; margin-top:2px; }

    .exec-headline { position:relative; overflow:hidden; border-radius:14px; padding:22px 28px; margin-bottom:24px; display:flex; align-items:center; justify-content:space-between; gap:20px; flex-wrap:wrap; }
    .exec-headline-glow { position:absolute; top:-50px; right:-30px; width:180px; height:180px; border-radius:50%; background:rgba(255,255,255,.08); pointer-events:none; }
    .exec-headline-glow2 { position:absolute; bottom:-60px; right:120px; width:130px; height:130px; border-radius:50%; background:rgba(255,255,255,.05); pointer-events:none; }
    .exec-headline-left { display:flex; align-items:center; gap:18px; position:relative; }
    .exec-headline-icon { width:56px; height:56px; border-radius:14px; background:rgba(255,255,255,.15); border:1.5px solid rgba(255,255,255,.28); display:flex; align-items:center; justify-content:center; font-size:26px; flex-shrink:0; }
    .exec-headline-label { font-size:11.5px; color:rgba(255,255,255,.72); text-transform:uppercase; letter-spacing:.06em; font-weight:600; margin-bottom:5px; }
    .exec-headline-value { font-size:30px; font-weight:900; color:#fff; letter-spacing:-.01em; line-height:1; }
    .exec-headline-value span { font-family:'JetBrains Mono',monospace; font-weight:800; }
    .exec-headline-meta { display:flex; align-items:center; gap:18px; position:relative; }
    .exec-headline-meta-item { text-align:center; }
    .exec-headline-meta-item strong { display:block; font-size:24px; font-weight:800; color:#fff; font-family:'JetBrains Mono',monospace; line-height:1; }
    .exec-headline-meta-item span { display:block; font-size:9.5px; color:rgba(255,255,255,.65); text-transform:uppercase; letter-spacing:.06em; margin-top:4px; }
    .exec-headline-meta-sep { width:1px; height:34px; background:rgba(255,255,255,.2); }

    .exec-blocks { display:flex; flex-direction:column; gap:18px; }
    .exec-block { background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.08); border-radius:12px; padding:22px 28px; border-top:4px solid rgba(255,255,255,.15); }
    .exec-block--narrative { border-top-color:#3b82f6; }
    .exec-block--bars { border-top-color:#dc2626; }
    .exec-block-title { font-size:11.5px; font-weight:800; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8; margin-bottom:18px; display:flex; align-items:center; gap:8px; }
    .exec-block-title-icon { font-size:14px; }

    .exec-narrative { max-width:880px; }
    .exec-narrative p { font-size:13.5px; color:#cbd5e1; line-height:1.8; margin-bottom:12px; }
    .exec-narrative p:last-child { margin-bottom:0; }
    .exec-narrative strong { color:#fff; }

    .donut-empty { font-size:12px; color:#64748b; font-style:italic; padding:30px 0; text-align:center; }

    .reg-bar-legend { display:flex; gap:20px; margin-bottom:16px; padding:10px 14px; background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.08); border-radius:8px; font-size:11px; color:#cbd5e1; font-weight:600; }
    .reg-bar-legend span { display:flex; align-items:center; gap:6px; }
    .reg-bar-legend i { font-size:13px; }
    .reg-cat-blocks-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(255px,1fr)); gap:16px; align-items:start; }
    .reg-cat-block { min-width:0; background:rgba(255,255,255,.025); border:1px solid rgba(255,255,255,.08); border-top:3px solid rgba(255,255,255,.15); border-radius:10px; padding:16px 18px 18px; }
    .reg-cat-block-title { font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8; margin-bottom:14px; display:flex; align-items:center; gap:8px; padding-bottom:10px; border-bottom:1px solid rgba(255,255,255,.08); }
    .reg-cat-dot { width:9px; height:9px; border-radius:3px; flex-shrink:0; }
    .reg-cat-block-count { margin-left:auto; font-family:'JetBrains Mono',monospace; font-weight:700; color:#64748b; font-size:10px; text-transform:none; letter-spacing:0; }
    .reg-item-list { display:flex; flex-direction:column; gap:4px; }
    .reg-item-row { display:flex; flex-direction:column; gap:7px; }
    .reg-item-row:not(.reg-item-row--top) { padding-bottom:12px; border-bottom:1px solid rgba(255,255,255,.06); }
    .reg-item-row:not(.reg-item-row--top):last-child { border-bottom:none; padding-bottom:0; }
    .reg-item-name-line { display:flex; align-items:center; gap:9px; }
    .reg-item-rank { width:20px; height:20px; border-radius:6px; background:rgba(255,255,255,.08); color:#94a3b8; font-size:11px; font-weight:800; font-family:'JetBrains Mono',monospace; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
    .reg-item-label { font-size:14px; font-weight:800; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; }
    .reg-item-stats-line { display:flex; align-items:center; gap:7px; padding-left:29px; font-size:11.5px; color:#94a3b8; font-weight:600; }
    .reg-item-sep { color:#475569; }
    .reg-item-pct-full { color:#cbd5e1; }
    .reg-item-net-line { font-size:13px; font-weight:800; font-family:'JetBrains Mono',monospace; padding-left:29px; }
    .reg-item-level-line { display:flex; align-items:center; gap:6px; padding-left:29px; flex-wrap:wrap; }
    .reg-item-level-badge { display:flex; align-items:center; gap:5px; font-size:11px; font-weight:800; padding:4px 10px; border-radius:7px; line-height:1.3; }
    .reg-item-level-badge i { font-size:12px; }
    .reg-item-level-badge--critico { background:rgba(220,38,38,.16); color:#f87171; }
    .reg-item-level-badge--urgente { background:rgba(234,88,12,.16); color:#fb923c; }

    /* ── Estilo "Auditoria" — tabelas Crítico/Urgente lado a lado (Relatório Detalhado) ── */
    .audit-section { margin-bottom:30px; }
    .audit-section-title { font-size:15px; font-weight:900; text-transform:uppercase; letter-spacing:.05em; color:#fff; margin-bottom:10px; padding-left:2px; }
    .audit-section-grid { display:grid; grid-template-columns:1fr 1fr; gap:18px; align-items:start; }
    .audit-table-wrap { border:1px solid rgba(255,255,255,.15); border-radius:6px; overflow:hidden; }
    .audit-table-header { padding:10px 16px; color:#fff; font-weight:900; font-size:14px; letter-spacing:.04em; display:flex; align-items:center; gap:8px; text-transform:uppercase; }
    .audit-table-header i { font-size:15px; }
    .audit-table-count { margin-left:auto; background:rgba(255,255,255,.22); border-radius:12px; padding:2px 10px; font-size:12px; font-family:'JetBrains Mono',monospace; }
    .audit-table-empty { padding:16px; text-align:center; color:#64748b; font-style:italic; font-size:12px; background:rgba(255,255,255,.02); }
    .audit-table { width:100%; border-collapse:collapse; background:rgba(255,255,255,.015); table-layout:fixed; }
    .audit-table thead tr { background:rgba(255,255,255,.05); }
    .audit-table th { padding:7px 8px; font-size:9.5px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; color:#94a3b8; text-align:left; border:1px solid rgba(255,255,255,.1); }
    .audit-th-nivel { width:38px; text-align:center; }
    .audit-th-var { width:110px; text-align:right; }
    .audit-td { padding:6px 8px; font-size:11px; border:1px solid rgba(255,255,255,.07); color:#e2e8f0; }
    .audit-td-nivel { text-align:center; font-size:13px; }
    .audit-td-filial { font-family:'JetBrains Mono',monospace; font-weight:700; color:#cbd5e1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .audit-td-regional { font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:#e2e8f0; }
    .audit-td-mat { color:#cbd5e1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .audit-td-var { font-family:'JetBrains Mono',monospace; font-weight:900; color:#fff; text-align:right; font-size:11.5px; white-space:nowrap; }
    .audit-table tbody tr:nth-child(even) td:not(.audit-td-var) { background:rgba(255,255,255,.02); }

    .var-cell i, .cat-header-net i, .reg-item-net-line i, .exec-headline-value i { font-size:.9em; margin-right:3px; vertical-align:-1px; }

    @media print {
      .audit-section { page-break-inside:avoid; }
      .audit-table tr { page-break-inside:avoid; }
      .exec-summary { page-break-inside:avoid; }
      .exec-headline, .audit-table-header, .audit-table thead tr, .audit-td-var,
      .reg-item-level-badge--critico, .reg-item-level-badge--urgente, .reg-cat-dot, .reg-cat-block {
        -webkit-print-color-adjust:exact; color-adjust:exact;
      }
    }`;
}

// ── Abre o relatório (HTML pronto) em nova janela — usado por todos os
//    relatórios do sistema (Ausências, Ranking, Ocorrências, Criticidade). ──
function _openRelWindow(html) {
  const w = window.open('', '_blank', 'width=1200,height=900,scrollbars=yes,resizable=yes');
  if (!w) { alert('Popups bloqueados! Permita pop-ups para gerar o relatório.'); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
}

// ── Botão "Visão Diretoria" — Resumo Executivo isolado (narrativa + gráficos) ──
window.gerarVisaoDiretoria = function(categoriasFiltro) {
  const d = _buildCriticidadeData(categoriasFiltro);
  if (!d) return;

  const bodyHtml = `<style>${_criticidadeDarkStyles()}</style>${d.execSummaryHtml}`;

  const html = _buildRankingShellHTML({
    periodoBadge: d.periodo,
    periodo: d.periodo,
    now: d.now,
    kpis: [
      { value: d.totalCritico,   label: 'críticos',  color: '#ef4444' },
      { value: d.totalUrgente,   label: 'urgentes',  color: '#f97316' },
      { value: d.totalRegionais, label: 'regionais', color: '#3b82f6' },
      { value: d.totalGeral,     label: 'total',     color: '#94a3b8' }
    ]
  }, {
    pageTitle:  `Visão Diretoria — ${d.periodo}`,
    badge:      'Alerta de Criticidade',
    title:      'Visão Diretoria',
    subtitle:   'Resumo executivo de criticidade — ação imediata ou monitoramento reforçado necessário.',
    bodyHtml,
    notaRodape: 'Crítico e urgente calculados a partir do desequilíbrio (desfalque/sobra) entre estoque físico e lançamentos no período selecionado.'
  });

  _openRelWindow(html);
};

// ── Botão "Relatório Detalhado" — Ranking completo Crítico/Urgente por regional, central e material ──
window.gerarRelatorioDetalhado = function(categoriasFiltro) {
  const d = _buildCriticidadeData(categoriasFiltro);
  if (!d) return;

  const bodyHtml = `<style>${_criticidadeDarkStyles()}</style>${d.auditSectionsHtml}`;

  const html = _buildRankingShellHTML({
    periodoBadge: d.periodo,
    periodo: d.periodo,
    now: d.now,
    kpis: [
      { value: d.totalCritico,   label: 'críticos',  color: '#ef4444' },
      { value: d.totalUrgente,   label: 'urgentes',  color: '#f97316' },
      { value: d.totalRegionais, label: 'regionais', color: '#3b82f6' },
      { value: d.totalGeral,     label: 'total',     color: '#94a3b8' }
    ]
  }, {
    pageTitle:  `Relatório Detalhado de Criticidade — ${d.periodo}`,
    badge:      'Alerta de Criticidade',
    title:      'Relatório Detalhado de Criticidade',
    subtitle:   'Ranking completo por regional, central e material — ação imediata ou monitoramento reforçado necessário.',
    bodyHtml,
    notaRodape: 'Tabelas lado a lado por categoria de material (Aglomerantes, Agregados, Aditivos, Adições), ordenadas do maior desfalque para a maior sobra.'
  });

  _openRelWindow(html);
};

// ═══════════════════════════════════════════════════════════════════
// MODAL DE SELEÇÃO DE CATEGORIAS — usado pelos botões "Visão Diretoria"
// e "Relatório Detalhado". Multisseleção via checkboxes + atalho "Selecionar todas".
// ═══════════════════════════════════════════════════════════════════
window.abrirModalCategoriasRelatorio = function(tipo) {
  const byLevel = window._rankByLevel;
  if (!byLevel || (!byLevel.critico.length && !byLevel.urgente.length)) {
    alert('Nenhum dado de criticidade disponível. Execute a análise primeiro.');
    return;
  }

  const CAT_ORDER_M  = ['aglomerante', 'agregado', 'aditivo', 'adicao'];
  const CAT_LABELS_M = { aglomerante: 'Aglomerantes', agregado: 'Agregados', aditivo: 'Aditivos', adicao: 'Adições' };

  const todosItens = [...byLevel.critico, ...byLevel.urgente];
  const counts = {};
  CAT_ORDER_M.forEach(k => counts[k] = 0);
  todosItens.forEach(i => {
    const k = i.catKey || 'aglomerante';
    counts[k] = (counts[k] || 0) + 1;
  });

  const categoriasComDados = CAT_ORDER_M.filter(k => counts[k] > 0);
  if (!categoriasComDados.length) {
    alert('Nenhuma categoria com dados disponível.');
    return;
  }

  let modal = document.getElementById('rel-categorias-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'rel-categorias-modal';
    modal.className = 'modal-overlay';
    modal.style.cssText = 'z-index:3200';
    document.body.appendChild(modal);
  }

  const tituloRel = tipo === 'diretoria' ? 'Visão Diretoria' : 'Relatório Detalhado';

  const opcoesHtml = categoriasComDados.map(catKey => {
    const label = CAT_LABELS_M[catKey];
    const count = counts[catKey];
    return `<label class="rel-cat-option" style="display:flex;align-items:center;justify-content:space-between;width:100%;padding:12px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:13px;font-family:inherit;color:#0f172a;font-weight:600;gap:10px">
      <span style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" class="rel-cat-checkbox" value="${catKey}" checked onchange="_atualizaSelecaoTodasCategorias()" style="width:16px;height:16px;cursor:pointer;accent-color:#2563eb">
        <span>${label}</span>
      </span>
      <span style="font-size:11px;color:#94a3b8;font-family:'DM Mono',monospace">${count} ${count === 1 ? 'item' : 'itens'}</span>
    </label>`;
  }).join('');

  modal.innerHTML = `
    <div class="modal" style="max-width:480px;width:94vw">
      <div class="modal-title" style="display:flex;align-items:center;gap:10px">
        <i class="ti ti-filter" style="color:var(--accent)"></i>
        Categorias — ${tituloRel}
      </div>
      <div class="modal-sub">Selecione as categorias que devem aparecer no relatório</div>
      <label style="display:flex;align-items:center;justify-content:space-between;width:100%;padding:12px 16px;background:linear-gradient(135deg,#1e3a5f,#1e40af);border:none;border-radius:8px;cursor:pointer;font-size:13px;font-family:inherit;color:#fff;font-weight:700;gap:10px;margin-bottom:12px">
        <span style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" id="rel-cat-todas" checked onchange="_toggleTodasCategorias(this)" style="width:16px;height:16px;cursor:pointer">
          <span>Selecionar todas</span>
        </span>
        <span style="font-size:11px;opacity:.75">${todosItens.length} itens no total</span>
      </label>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px">
        ${opcoesHtml}
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px">
        <button class="btn" onclick="document.getElementById('rel-categorias-modal').classList.remove('open')">Cancelar</button>
        <button class="btn btn-primary" onclick="_gerarRelatorioComCategorias('${tipo}')">Gerar</button>
      </div>
    </div>`;

  modal.classList.add('open');
};

// Marca/desmarca todas as categorias quando o checkbox "Selecionar todas" é alterado
window._toggleTodasCategorias = function(checkbox) {
  document.querySelectorAll('.rel-cat-checkbox').forEach(cb => { cb.checked = checkbox.checked; });
};

// Reflete no checkbox "Selecionar todas" se todas as categorias individuais estão marcadas
window._atualizaSelecaoTodasCategorias = function() {
  const all = document.querySelectorAll('.rel-cat-checkbox');
  const checked = document.querySelectorAll('.rel-cat-checkbox:checked');
  const todasCb = document.getElementById('rel-cat-todas');
  if (todasCb) todasCb.checked = all.length === checked.length;
};

// Lê as categorias marcadas, fecha o modal e dispara o relatório correspondente
window._gerarRelatorioComCategorias = function(tipo) {
  const checked = Array.from(document.querySelectorAll('.rel-cat-checkbox:checked')).map(cb => cb.value);
  if (!checked.length) {
    alert('Selecione ao menos uma categoria.');
    return;
  }
  document.getElementById('rel-categorias-modal')?.classList.remove('open');
  if (tipo === 'diretoria') {
    window.gerarVisaoDiretoria(checked);
  } else {
    window.gerarRelatorioDetalhado(checked);
  }
};

// ═══════════════════════════════════════════════════════════════════
// RELATÓRIO DE AUSÊNCIAS DE LANÇAMENTO
// ═══════════════════════════════════════════════════════════════════

function _buildAusenciasRelHTML({ titulo, badge, subtitle, notaRodape, periodo, geradoEm, regionaisData, totalDias, totalMats, totalCentrals, totalRegionais }) {
  // Monta HTML regional → central → materiais — mesmo padrão visual (tema
  // escuro) dos relatórios de Ranking Centrais/Regionais: reaproveita o
  // shell _buildRankingShellHTML (hero, KPIs, tabela, footer).
  const fmtDateChip = d => String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear();

  const regionalSections = (regionaisData || []).map(({ regional, centrais }) => {
    const totalRegAus = centrais.reduce((s, c) => s + c.mats.length, 0);
    const nCentrals   = centrais.length;

    const centraisHtml = centrais.map(({ central, mats }) => {
      const totalAus = mats.length;
      const matRows = mats.map(({ mat, tipo, dias, estoqueZerado, motivoZerado, ultimaData, ultimaPeso, ultimaEntrada, ultimaSaida, ultimoSap, totalLancs }) => {
        const isSemanal = tipo === 'Semanal';
        const chips = dias.map(d =>
          `<span class="aus-date-chip${estoqueZerado ? ' aus-date-chip--zerado' : ''}">${fmtDateChip(d)}</span>`
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
        const zeroBadgeLabel = motivoZerado === 'inatividade' ? 'SEM MOVIMENTAÇÃO' : 'ESTOQUE ZERADO';
        const zeroBadge = estoqueZerado
          ? `<span class="aus-badge-zerado" title="${_buildZeroTitleRel()}"><i class="ti ti-alert-triangle"></i> ${zeroBadgeLabel}</span>`
          : '';
        return `
          <tr>
            <td class="rk-name" style="font-size:11.5px;font-weight:700">${_rankEsc(mat)}${zeroBadge}</td>
            <td><span class="aus-badge-tipo ${isSemanal ? 'aus-badge-semanal' : 'aus-badge-diario'}">${tipo}</span></td>
            <td class="rk-num" style="color:${estoqueZerado ? '#f87171' : '#e2e8f0'}">${dias.length}</td>
            <td>${chips}</td>
          </tr>`;
      }).join('');

      return `
        <div class="aus-central-block">
          <div class="aus-central-header">
            <i class="ti ti-building-warehouse"></i>
            <span class="aus-central-name">${_rankEsc(central)}</span>
            <span class="aus-central-badge">${totalAus} ausência${totalAus !== 1 ? 's' : ''}</span>
          </div>
          <table class="rk-table">
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
      <div class="aus-regional-block">
        <div class="aus-regional-header">
          <i class="ti ti-users-group"></i>
          <span class="aus-regional-name">${_rankEsc(regional)}</span>
          <span class="aus-regional-badge">${totalRegAus} ausência${totalRegAus !== 1 ? 's' : ''}</span>
          <span class="aus-regional-sub">${nCentrals} ${nCentrals !== 1 ? 'centrais' : 'central'}</span>
        </div>
        <div class="aus-regional-centrais">${centraisHtml}</div>
      </div>`;
  }).join('');

  const bodyHtml = `
    <style>
      .aus-alert-banner { display:flex; align-items:flex-start; gap:12px; background:rgba(217,119,6,.10); border:1px solid rgba(217,119,6,.35); border-radius:10px; padding:14px 18px; margin-bottom:22px; font-size:12px; color:#fde68a; line-height:1.6; }
      .aus-alert-banner i { font-size:17px; color:#f59e0b; flex-shrink:0; margin-top:1px; }
      .aus-alert-banner strong { color:#fbbf24; }

      .aus-regional-block { margin-bottom:24px; }
      .aus-regional-block:last-child { margin-bottom:0; }
      .aus-regional-header { display:flex; align-items:center; gap:10px; margin-bottom:13px; padding-bottom:9px; border-bottom:1px solid rgba(255,255,255,.1); }
      .aus-regional-header i { color:#f87171; font-size:16px; flex-shrink:0; }
      .aus-regional-name { font-size:14px; font-weight:800; color:#fff; }
      .aus-regional-badge { background:rgba(220,38,38,.14); border:1px solid rgba(220,38,38,.35); color:#f87171; font-size:10px; font-weight:800; padding:3px 9px; border-radius:5px; font-family:'JetBrains Mono',monospace; }
      .aus-regional-sub { font-size:10.5px; color:#64748b; margin-left:auto; }

      .aus-central-block { background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.08); border-radius:10px; padding:14px 16px; margin-bottom:12px; page-break-inside:avoid; }
      .aus-central-block:last-child { margin-bottom:0; }
      .aus-central-header { display:flex; align-items:center; gap:8px; margin-bottom:10px; }
      .aus-central-header i { color:#93c5fd; font-size:14px; flex-shrink:0; }
      .aus-central-name { font-size:12.5px; font-weight:800; color:#fff; }
      .aus-central-badge { background:rgba(59,130,246,.12); border:1px solid rgba(59,130,246,.3); color:#93c5fd; font-size:9.5px; font-weight:700; padding:2px 8px; border-radius:4px; font-family:'JetBrains Mono',monospace; }

      .aus-badge-tipo { display:inline-block; padding:2px 8px; border-radius:4px; font-size:9.5px; font-weight:700; font-family:'JetBrains Mono',monospace; }
      .aus-badge-semanal { background:rgba(168,85,247,.14); border:1px solid rgba(168,85,247,.35); color:#c4b5fd; }
      .aus-badge-diario  { background:rgba(34,197,94,.12); border:1px solid rgba(34,197,94,.32); color:#86efac; }

      .aus-date-chip { display:inline-block; background:rgba(59,130,246,.12); border:1px solid rgba(59,130,246,.3); color:#93c5fd; border-radius:4px; padding:2px 7px; font-size:10px; font-family:'JetBrains Mono',monospace; white-space:nowrap; margin:1px 3px 1px 0; }
      .aus-date-chip--zerado { background:rgba(239,68,68,.12); border-color:rgba(239,68,68,.35); color:#fca5a5; }

      .aus-badge-zerado { display:inline-flex; align-items:center; gap:4px; margin-left:8px; background:rgba(239,68,68,.14); border:1px solid rgba(239,68,68,.4); color:#f87171; font-size:8.5px; font-weight:800; padding:2px 7px; border-radius:4px; letter-spacing:.03em; cursor:help; vertical-align:middle; }
    </style>

    <div class="aus-alert-banner">
      <i class="ti ti-alert-triangle"></i>
      <span><strong>ATENÇÃO:</strong> os lançamentos abaixo estão ausentes no sistema e comprometem diretamente a integridade dos estoques, a confiabilidade das análises e a rastreabilidade operacional. A ausência de lançamento distorce variações e invalida o inventário do período.</span>
    </div>

    ${regionalSections}

    <div class="callout-regularizacao">
      <div class="callout-regularizacao-title">⚠ Regularização Imediata</div>
      <div class="callout-regularizacao-text">Revisar as datas apontadas e realizar o lançamento correto do estoque. Pendências mantidas serão escalonadas ao supervisor regional.</div>
    </div>`;

  const d = {
    periodoBadge: _rankPeriodoBadgeLabel(),
    periodo,
    now: geradoEm,
    kpis: [
      { value: totalDias,      label: totalDias !== 1 ? 'ausências' : 'ausência',     color: '#ef4444' },
      { value: totalMats,      label: totalMats !== 1 ? 'materiais' : 'material',     color: '#f59e0b' },
      { value: totalCentrals,  label: totalCentrals !== 1 ? 'centrais' : 'central',   color: '#22c55e' },
      { value: totalRegionais, label: totalRegionais !== 1 ? 'regionais' : 'regional', color: '#3b82f6' }
    ]
  };

  return _buildRankingShellHTML(d, {
    pageTitle:  titulo,
    badge:      badge || 'Cobrança de Pendências',
    title:      titulo,
    subtitle:   subtitle || 'Ausências de lançamento de estoque no período selecionado.',
    bodyHtml,
    notaRodape: notaRodape || '1 linha = 1 material com ausência(s) de lançamento no período. Frequência considerada conforme cadastro (diária ou semanal).'
  });
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
    badge:          'Cobrança de Pendências',
    subtitle:       'Materiais sem lançamento no período nesta central, para cobrança e regularização imediata.',
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
    badge:          'Cobrança de Pendências',
    subtitle:       'Materiais sem lançamento no período nesta regional, agrupados por central, para cobrança e regularização imediata.',
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

// Relatório de Cobrança (todas as centrais filtradas)
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
    titulo:         'Relatório de Cobrança — Ausências de Lançamento',
    badge:          'Cobrança de Pendências',
    subtitle:       'Lista completa de materiais sem lançamento no período, organizada por regional e central, para cobrança e regularização imediata.',
    notaRodape:     '1 linha = 1 material com ausência(s) de lançamento no período. Frequência considerada conforme cadastro (diária ou semanal).',
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
// MODAL DE SELEÇÃO — Tipo de Relatório de Ausência de Lançamento
// Unifica os 3 relatórios (Geral, Ranking Centrais, Ranking Regionais)
// no botão único "Gerar Relatório". Mesmo padrão visual e comportamental
// do abrirModalRelatorioCentral (Analítico): cartões clicáveis com
// ícone + título + descrição, seleção única, fecha o modal e dispara
// o relatório correspondente.
// ═══════════════════════════════════════════════════════════════════
window.abrirModalRelatorioAusencias = function() {
  if (!window._ausenciasData?.length) { alert('Nenhuma ausência no período/filtros selecionados.'); return; }

  let modal = document.getElementById('aus-rel-tipo-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'aus-rel-tipo-modal';
    modal.className = 'modal-overlay';
    modal.style.cssText = 'z-index:3200';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal" style="max-width:460px;width:94vw">
      <div class="modal-title" style="display:flex;align-items:center;gap:10px">
        <i class="ti ti-file-report" style="color:var(--accent)"></i>
        Gerar Relatório
      </div>
      <div class="modal-sub">Ausência de Lançamento · selecione o tipo de relatório</div>
      <div style="display:flex;flex-direction:column;gap:10px;margin:20px 0">

        <button onclick="document.getElementById('aus-rel-tipo-modal').classList.remove('open');gerarRelatorioAusenciasGeral();"
          style="display:flex;align-items:flex-start;gap:14px;width:100%;padding:16px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;cursor:pointer;font-family:inherit;color:var(--text);text-align:left;transition:border-color .15s,background .15s"
          onmouseover="this.style.borderColor='var(--accent)';this.style.background='var(--bg3)'"
          onmouseout="this.style.borderColor='var(--border)';this.style.background='var(--bg2)'">
          <div style="width:38px;height:38px;border-radius:9px;background:linear-gradient(135deg,rgba(29,78,216,0.18),rgba(37,99,235,0.12));border:1px solid rgba(37,99,235,0.3);display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <i class="ti ti-file-report" style="color:#60a5fa;font-size:17px"></i>
          </div>
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:3px">Relatório de Cobrança</div>
            <div style="font-size:12px;color:var(--text2);line-height:1.5">Todas as ausências agrupadas por regional → central → material, com datas e detalhes de estoque, para cobrança e regularização.</div>
          </div>
        </button>

        <button onclick="document.getElementById('aus-rel-tipo-modal').classList.remove('open');gerarRankingCentrais();"
          style="display:flex;align-items:flex-start;gap:14px;width:100%;padding:16px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;cursor:pointer;font-family:inherit;color:var(--text);text-align:left;transition:border-color .15s,background .15s"
          onmouseover="this.style.borderColor='var(--accent)';this.style.background='var(--bg3)'"
          onmouseout="this.style.borderColor='var(--border)';this.style.background='var(--bg2)'">
          <div style="width:38px;height:38px;border-radius:9px;background:linear-gradient(135deg,rgba(239,68,68,0.18),rgba(220,38,38,0.12));border:1px solid rgba(239,68,68,0.3);display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <i class="ti ti-trophy" style="color:#f87171;font-size:17px"></i>
          </div>
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:3px">Ranking Centrais</div>
            <div style="font-size:12px;color:var(--text2);line-height:1.5">Top 10 centrais com mais dias de ausência — cards de destaque e alerta de regularização imediata.</div>
          </div>
        </button>

        <button onclick="document.getElementById('aus-rel-tipo-modal').classList.remove('open');gerarRankingRegionais();"
          style="display:flex;align-items:flex-start;gap:14px;width:100%;padding:16px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;cursor:pointer;font-family:inherit;color:var(--text);text-align:left;transition:border-color .15s,background .15s"
          onmouseover="this.style.borderColor='var(--accent)';this.style.background='var(--bg3)'"
          onmouseout="this.style.borderColor='var(--border)';this.style.background='var(--bg2)'">
          <div style="width:38px;height:38px;border-radius:9px;background:linear-gradient(135deg,rgba(168,85,247,0.18),rgba(147,51,234,0.12));border:1px solid rgba(168,85,247,0.3);display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <i class="ti ti-map-2" style="color:#c084fc;font-size:17px"></i>
          </div>
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:3px">Ranking Regionais</div>
            <div style="font-size:12px;color:var(--text2);line-height:1.5">Lista completa das regionais ordenadas por quantidade de centrais fora do padrão.</div>
          </div>
        </button>

      </div>
      <div class="form-actions">
        <button class="btn" onclick="document.getElementById('aus-rel-tipo-modal').classList.remove('open')">Cancelar</button>
      </div>
    </div>`;

  modal.classList.add('open');
  if (modal._escHandler) document.removeEventListener('keydown', modal._escHandler);
  modal._escHandler = (e) => { if (e.key === 'Escape') { modal.classList.remove('open'); document.removeEventListener('keydown', modal._escHandler); } };
  document.addEventListener('keydown', modal._escHandler);
};

// ═══════════════════════════════════════════════════════════════════
// RANKING DE AUSÊNCIAS — Piores Centrais e Piores Regionais
// ═══════════════════════════════════════════════════════════════════
// Estrutura e tema visual seguem o alerta de referência ponto a ponto:
// tema escuro em toda a página (não só no header), barra fina no topo,
// header full-bleed com badge + título real do alerta, badge de período
// destacado, KPIs com barra colorida dentro do header, layout em 2
// colunas (tabela + sidebar de regionais críticas no relatório de
// Centrais; tabela dividida em 2 blocos no relatório de Regionais).
//
// Fonte de dados: window._ausenciasData (já filtrado pela tela de
// Ausências). Exclusão manual de central = desmarcá-la no filtro
// Central da tela de Ausências antes de gerar o ranking.

function _rankEsc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// Comprime uma lista de Date[] em faixas compactas tipo "01-04 · 06-11 · 13-16"
// (DD quando a faixa não cruza o mês, DD/MM quando cruza).
function _rankCompactarDias(datas) {
  const iso = [...new Set((datas || []).map(d => localISODate(d)))].filter(Boolean).sort();
  if (!iso.length) return '—';

  const groups = [];
  let start = iso[0], prev = iso[0];
  for (let i = 1; i < iso.length; i++) {
    const cur = iso[i];
    const diffDays = Math.round((new Date(cur + 'T12:00:00') - new Date(prev + 'T12:00:00')) / 86400000);
    if (diffDays === 1) { prev = cur; continue; }
    groups.push([start, prev]);
    start = cur; prev = cur;
  }
  groups.push([start, prev]);

  const fmtDM = i => { const p = i.split('-'); return `${p[2]}/${p[1]}`; };
  const fmtD  = i => i.split('-')[2];

  // "a" por extenso entre início e fim da faixa (em vez de hífen) — evita que
  // "01-04" seja lido como dias isolados 01 e 04; "01 a 04" deixa claro que é
  // o intervalo inteiro (01, 02, 03 e 04).
  return groups.map(([a, b]) => {
    if (a === b) return fmtDM(a);
    const sameMonth = a.slice(0, 7) === b.slice(0, 7);
    return sameMonth ? `${fmtD(a)} a ${fmtD(b)}` : `${fmtDM(a)} a ${fmtDM(b)}`;
  }).join(' · ');
}

// Agrupa ausências (já filtradas) por central. Ordena por dias únicos com
// QUALQUER ausência (desc), desempate por total de registros material-dia
// ausentes (desc) — mesmo critério do alerta de referência.
function _rankAgruparPorCentral(ausencias) {
  const byCentral = new Map();
  ausencias.forEach(a => {
    if (!byCentral.has(a.central)) {
      byCentral.set(a.central, { central: a.central, regional: a.regional || 'Sem regional', registros: 0, grupos: new Set(), diasSet: new Set() });
    }
    const g = byCentral.get(a.central);
    g.registros += a.diasAusentes.length;
    g.grupos.add(a.categoria || '—');
    a.diasAusentes.forEach(d => g.diasSet.add(localISODate(d)));
  });

  return [...byCentral.values()]
    .map(g => ({
      central:    g.central,
      regional:   g.regional,
      registros:  g.registros,
      grupos:     g.grupos.size,
      diasUnicos: g.diasSet.size,
      diasList:   [...g.diasSet].sort().map(iso => new Date(iso + 'T12:00:00'))
    }))
    .sort((a, b) => (b.diasUnicos - a.diasUnicos) || (b.registros - a.registros) || a.central.localeCompare(b.central));
}

// Agrupa ausências (já filtradas) por regional. Ordena por quantidade de
// centrais fora do padrão (desc), desempate por total de registros
// material-dia ausentes (desc).
function _rankAgruparPorRegional(ausencias) {
  const byRegional = new Map();
  ausencias.forEach(a => {
    const key = a.regional || 'Sem regional';
    if (!byRegional.has(key)) byRegional.set(key, { regional: key, centrais: new Set(), registros: 0, grupos: new Set() });
    const g = byRegional.get(key);
    g.centrais.add(a.central);
    g.registros += a.diasAusentes.length;
    g.grupos.add(a.categoria || '—');
  });

  return [...byRegional.values()]
    .map(g => ({
      regional:  g.regional,
      centrais:  [...g.centrais].sort(),
      nCentrais: g.centrais.size,
      registros: g.registros,
      grupos:    g.grupos.size
    }))
    .sort((a, b) => (b.nCentrais - a.nCentrais) || (b.registros - a.registros) || a.regional.localeCompare(b.regional));
}

// Centrais fora do filtro aplicado (exclusão manual via filtro Central de
// Ausências) — usado pro badge "X DESCONSIDERADA(S)" no header.
function _rankCentraisDesconsideradas() {
  try {
    const todas    = (typeof _ausFilter !== 'undefined' && _ausFilter.options?.central) || [];
    const aplicado = (typeof _ausFilter !== 'undefined' && _ausFilter.applied?.central) || new Set();
    if (!aplicado.size) return [];
    return todas.filter(c => !aplicado.has(c));
  } catch (e) { return []; }
}

// Deriva "Mês/Ano" do período em análise (só quando início e fim caem no
// mesmo mês — mesmo texto do alerta de referência, "DATAS REFERENTES A
// JULHO/2026"); se o período cruzar meses, omite.
function _rankMesAnoLabel() {
  const ini = document.getElementById('aus-dt-ini')?.value || '';
  const fim = document.getElementById('aus-dt-fim')?.value || '';
  if (!ini || !fim) return '';
  const [ya, ma] = ini.split('-');
  const [yb, mb] = fim.split('-');
  if (ya !== yb || ma !== mb) return '';
  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  return `${meses[Number(ma) - 1]}/${ya}`;
}

// Badge de período compacto tipo "01 A 16 JUL 2026" (mesmo formato do
// alerta de referência). Cai para o formato padrão dd/mm/aaaa se as datas
// não puderem ser lidas dos campos de período.
function _rankPeriodoBadgeLabel() {
  const ini = document.getElementById('aus-dt-ini')?.value || '';
  const fim = document.getElementById('aus-dt-fim')?.value || '';
  const MESES_ABR = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
  if (!ini || !fim) return (_ausGetPeriodo() || '').toUpperCase();
  const [ya, ma, da] = ini.split('-').map(Number);
  const [yb, mb, db] = fim.split('-').map(Number);
  if (!ya || !yb) return (_ausGetPeriodo() || '').toUpperCase();
  if (ya === yb && ma === mb) {
    return da === db
      ? `${String(da).padStart(2,'0')} ${MESES_ABR[ma - 1]} ${ya}`
      : `${String(da).padStart(2,'0')} A ${String(db).padStart(2,'0')} ${MESES_ABR[mb - 1]} ${yb}`;
  }
  return `${String(da).padStart(2,'0')} ${MESES_ABR[ma - 1]} ${ya} A ${String(db).padStart(2,'0')} ${MESES_ABR[mb - 1]} ${yb}`;
}

// Cor de severidade por dias únicos com ausência (limiares do alerta de
// referência: ≥10 vermelho, ≥5 âmbar, resto verde).
function _rankSeverityDias(dias) {
  if (dias >= 10) return '#ef4444';
  if (dias >= 5)  return '#f59e0b';
  return '#22c55e';
}

// Cor de severidade por quantidade de centrais fora do padrão (linhas da
// tabela de regionais que não entraram nos cards do topo).
function _rankSeverityCentrais(n) {
  if (n >= 3) return '#ef4444';
  if (n >= 2) return '#f59e0b';
  return '#3b82f6';
}

// ── Shell HTML compartilhado pelos 2 relatórios de ranking ──────────────
// Tema escuro em toda a página, header full-bleed, badge de alerta real,
// badge de período destacado e KPIs com barra colorida — igual ao
// alerta de referência.
function _buildRankingShellHTML(d, opts) {
  const { periodoBadge, periodo, now, kpis, desconsideradas } = d;

  // A linha de KPIs do header é OPCIONAL: só é renderizada quando `kpis` vem
  // preenchido. Relatórios que passam o array (Ranking, Ausência, Cobrança,
  // Criticidade, etc.) continuam exibindo a barra normalmente; quem omitir
  // (ou passar vazio) — caso do Relatório Gerencial, onde esses números já
  // aparecem na seção "Resumo do Período" e a barra ficava redundante — não
  // renderiza a .rk-kpi-row nenhuma.
  const kpisHtml = (kpis || []).map(k => `
    <div class="rk-kpi" style="border-left-color:${k.color}">
      <strong>${k.value}</strong>
      <span>${_rankEsc(k.label)}</span>
    </div>`
  ).join('');
  const kpiRowHtml = (kpis && kpis.length)
    ? `<div class="rk-kpi-row">${kpisHtml}</div>`
    : '';

  const descHtml = (desconsideradas && desconsideradas.length)
    ? `<div class="rk-period-sub">${desconsideradas.map(c => _rankEsc(c)).join(', ')} desconsiderada${desconsideradas.length !== 1 ? 's' : ''}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${_rankEsc(opts.pageTitle)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/dist/tabler-icons.min.css">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700;800&display=swap');
  /* Orientação de página configurável por relatório — a maioria continua
     travada em paisagem (comportamento original, preservado por padrão)
     porque foi desenhada pra isso. O Relatório Gerencial do Dashboard
     passa opts.pageOrientation:'livre' pra deixar o usuário escolher no
     diálogo de impressão, com retrato como padrão do navegador — CSS não
     pode "destravar e ainda assim sugerir retrato" ao mesmo tempo, então
     a forma de fazer isso é simplesmente não declarar orientação nenhuma
     (nem landscape nem portrait): sem palavra-chave de orientação no
     @page, o Chrome deixa o seletor do diálogo livre, e retrato é o
     padrão dele quando nada mais é especificado. */
  @page { size: ${opts.pageOrientation === 'livre' ? 'A4' : 'A4 landscape'}; margin: 8mm 10mm; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Inter',system-ui,sans-serif; background:#0b1220; color:#e2e8f0; font-size:12.5px; line-height:1.5; -webkit-font-smoothing:antialiased; }

  .action-bar { position:sticky; top:0; z-index:100; background:#1e293b; display:flex; align-items:center; justify-content:space-between; padding:12px 24px; box-shadow:0 2px 12px rgba(0,0,0,.3); }
  .action-bar-title { color:#e2e8f0; font-size:13px; font-weight:500; }
  .action-bar-title span { color:#64748b; font-size:12px; margin-left:10px; }
  .action-bar-btns { display:flex; gap:10px; }
  .btn-print { background:#e8790a; color:#fff; border:none; border-radius:7px; padding:8px 18px; font-size:13px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:7px; transition:background .15s; }
  .btn-print:hover { background:#c9670a; }
  .btn-close { background:#334155; color:#cbd5e1; border:none; border-radius:7px; padding:8px 14px; font-size:13px; font-weight:500; cursor:pointer; transition:background .15s; }
  .btn-close:hover { background:#475569; }

  .rk-topbar { height:6px; background:#dc2626; }

  /* Header full-bleed */
  .rk-hero { background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%); border-bottom:1px solid rgba(255,255,255,.06); }
  .rk-hero-inner { max-width:1400px; margin:0 auto; padding:20px 40px 18px; }
  .rk-hero-top { display:flex; align-items:flex-start; justify-content:space-between; gap:24px; flex-wrap:wrap; }
  .rk-badge { display:inline-block; background:#dc2626; color:#fff; font-size:10.5px; font-weight:800; letter-spacing:.07em; text-transform:uppercase; padding:5px 12px; border-radius:5px; margin-bottom:8px; }
  .rk-hero h1 { font-size:26px; font-weight:800; color:#f8fafc; letter-spacing:-.01em; line-height:1.25; }
  .rk-hero p { font-size:13px; color:#94a3b8; font-weight:400; margin-top:8px; max-width:600px; }
  .rk-period-badge { background:#0f172a; border:1px solid rgba(255,255,255,.12); border-radius:10px; padding:11px 20px; text-align:center; flex-shrink:0; }
  .rk-period-main { font-size:14px; font-weight:800; color:#fff; letter-spacing:.03em; white-space:nowrap; }
  .rk-period-sub { font-size:9px; color:#fca5a5; margin-top:5px; text-transform:uppercase; letter-spacing:.05em; font-weight:700; }

  /* Logos, discretos no rodapé do header */
  .rk-hero-brand { display:flex; align-items:center; gap:16px; margin-bottom:12px; opacity:.85; }
  .rk-hero-brand img { height:38px; width:auto; object-fit:contain; filter:invert(1) hue-rotate(178deg); }
  .rk-hero-sys-icon { height:38px; width:38px; flex-shrink:0; }
  .rk-hero-brand-sep { width:1px; height:30px; background:rgba(255,255,255,.15); }
  .rk-hero-brand-text { font-size:12px; font-weight:800; letter-spacing:.06em; font-family:'JetBrains Mono',monospace; color:#cbd5e1; }
  .rk-hero-brand-text span { color:#f97316; }

  /* KPIs com barra colorida, dentro do header */
  .rk-kpi-row { display:flex; gap:14px; margin-top:22px; flex-wrap:wrap; }
  .rk-kpi { flex:1; min-width:230px; background:rgba(255,255,255,.045); border-left:4px solid; border-radius:6px; padding:13px 18px; display:flex; align-items:baseline; gap:12px; }
  .rk-kpi strong { font-size:26px; font-weight:900; font-family:'JetBrains Mono',monospace; color:#fff; line-height:1; white-space:nowrap; }
  .rk-kpi span { font-size:9.5px; color:#94a3b8; text-transform:uppercase; letter-spacing:.05em; font-weight:700; }

  /* Corpo */
  .rk-page { max-width:1400px; margin:0 auto; padding:18px 40px 24px; }

  .callout-regularizacao { text-align:center; background:linear-gradient(135deg,#dc2626,#991b1b); border-radius:10px; padding:16px 24px; margin:20px 0 0; }
  .callout-regularizacao-title { font-size:12.5px; font-weight:900; letter-spacing:.08em; text-transform:uppercase; color:#fff; margin-bottom:6px; }
  .callout-regularizacao-text { font-size:11.5px; color:rgba(255,255,255,.92); line-height:1.6; max-width:640px; margin:0 auto; }

  .tier-banner { display:inline-flex; align-items:center; gap:8px; background:rgba(220,38,38,.14); border:1px solid rgba(220,38,38,.4); border-radius:6px; padding:7px 14px; margin:0 0 14px; font-size:10.5px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; color:#f87171; }

  /* Cards de destaque */
  .rank-cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px; margin-bottom:20px; }
  .rank-card { background:rgba(255,255,255,.045); border:1px solid rgba(255,255,255,.09); border-radius:12px; padding:15px 17px; page-break-inside:avoid; }
  .rank-card-pos { display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; border-radius:6px; background:#dc2626; color:#fff; font-family:'JetBrains Mono',monospace; font-weight:800; font-size:11px; margin-bottom:9px; }
  .rank-card-name { font-size:13.5px; font-weight:800; color:#fff; margin-bottom:3px; }
  .rank-card-sub { font-size:10px; color:#94a3b8; margin-bottom:12px; font-family:'JetBrains Mono',monospace; line-height:1.6; }
  .rank-card-stats { display:flex; gap:16px; }
  .rank-card-stats strong { display:block; font-size:16px; font-weight:800; font-family:'JetBrains Mono',monospace; color:#f87171; line-height:1; }
  .rank-card-stats span { display:block; font-size:8.5px; color:#94a3b8; text-transform:uppercase; letter-spacing:.04em; margin-top:3px; }

  /* Tabela — tema escuro, cabeçalho simples (sem barra escura extra) */
  .rk-table-head { display:flex; align-items:baseline; justify-content:space-between; gap:10px; flex-wrap:wrap; margin-bottom:9px; }
  .rk-table-head-title { font-size:11px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; color:#f87171; }
  .rk-table-head-cap { font-size:9px; color:#64748b; text-transform:uppercase; letter-spacing:.05em; font-weight:700; }
  .rk-table-wrap { margin-bottom:16px; }
  .rk-table { width:100%; border-collapse:collapse; }
  .rk-table thead tr { border-bottom:1px solid rgba(255,255,255,.14); }
  .rk-table th { padding:7px 10px; font-size:9px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; color:#64748b; text-align:left; }
  .rk-table td { padding:9px 10px; font-size:11.5px; border-bottom:1px solid rgba(255,255,255,.055); color:#e2e8f0; vertical-align:middle; }
  .rkp-pos-cell { width:32px; text-align:center; }
  .rkp-pos { display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:5px; font-family:'JetBrains Mono',monospace; font-weight:800; font-size:10.5px; color:#fff; }
  .rk-name { font-weight:800; color:#fff; font-size:12px; }
  .rk-sub { font-size:9.5px; color:#94a3b8; margin-top:1px; }
  .rk-num { font-family:'JetBrains Mono',monospace; font-weight:800; text-align:center; font-size:13px; }
  .rk-chip { display:inline-block; background:rgba(59,130,246,.12); border:1px solid rgba(59,130,246,.3); color:#93c5fd; border-radius:4px; padding:2px 7px; font-size:10px; font-family:'JetBrains Mono',monospace; white-space:nowrap; margin:1px 3px 1px 0; }
  .rk-dates { font-family:'JetBrains Mono',monospace; font-size:10px; color:#cbd5e1; line-height:1.7; }

  /* Layout 2 colunas — tabela + sidebar (Centrais) */
  .rk-layout { display:grid; grid-template-columns:1fr 280px; gap:24px; align-items:start; }
  .rk-sidebar-title { font-size:10.5px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; color:#f87171; margin-bottom:11px; }
  .rk-sidebar-cards { display:flex; flex-direction:column; gap:10px; }
  .rk-side-card { background:rgba(255,255,255,.045); border:1px solid rgba(255,255,255,.09); border-radius:10px; padding:12px 14px; }
  .rk-side-top { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
  .rk-side-pos { display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px; border-radius:5px; background:#dc2626; color:#fff; font-family:'JetBrains Mono',monospace; font-weight:800; font-size:9.5px; flex-shrink:0; }
  .rk-side-name { font-size:12.5px; font-weight:800; color:#fff; }
  .rk-side-sub { font-size:9px; color:#94a3b8; font-family:'JetBrains Mono',monospace; margin-bottom:9px; }
  .rk-side-stats { display:flex; gap:14px; }
  .rk-side-stats strong { display:block; font-size:14px; font-weight:800; color:#f87171; font-family:'JetBrains Mono',monospace; line-height:1; }
  .rk-side-stats span { display:block; font-size:8px; color:#64748b; text-transform:uppercase; letter-spacing:.04em; margin-top:2px; }

  /* Tabela dividida em 2 blocos lado a lado (Regionais) */
  .rk-table-split { display:grid; grid-template-columns:1fr 1fr; gap:20px; }

  @media (max-width:900px) {
    .rk-layout, .rk-table-split { grid-template-columns:1fr; }
  }

  .report-footer { margin-top:10px; padding:12px 40px; background:#1e293b; color:#64748b; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; font-size:10.5px; }
  .report-footer strong { color:#94a3b8; }
  .footer-note { width:100%; margin-top:6px; padding-top:6px; border-top:1px solid rgba(255,255,255,.08); font-size:9.5px; color:#475569; }

  @media print {
    body { background:#0b1220 !important; }
    .action-bar { display:none !important; }
    * { -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
    .rank-card, .rk-table-wrap, .rk-side-card { page-break-inside:avoid; }
  }
</style>
</head>
<body>

<div class="action-bar">
  <div class="action-bar-title">
    ${_rankEsc(opts.title)}
    <span>Período: ${_rankEsc(periodo)} · Gerado em ${_rankEsc(now)}</span>
  </div>
  <div class="action-bar-btns">
    <button class="btn-print" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button>
    <button class="btn-close" onclick="window.close()">✕ Fechar</button>
  </div>
</div>

<div class="rk-topbar"></div>

<div class="rk-hero">
  <div class="rk-hero-inner">
    <div class="rk-hero-brand">
      <img src="https://concrelagos.com.br/wp-content/uploads/2021/10/Ativo-3.svg" alt="Concrelagos Concreto">
      <div class="rk-hero-brand-sep"></div>
      <svg class="rk-hero-sys-icon" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="ícone AnalyticSys">
        <polygon points="18,2 30,9 18,16 6,9" fill="#ff6b35"/>
        <polygon points="18,16 30,9 30,23 18,30" fill="#c44e1f"/>
        <polygon points="18,16 6,9 6,23 18,30" fill="#ff9060"/>
        <polyline points="21,26 24,21 27,23 30,18" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="30" cy="18" r="1.5" fill="white" opacity="0.8"/>
      </svg>
      <div class="rk-hero-brand-text">ANALYTIC<span>SYS</span></div>
    </div>
    <div class="rk-hero-top">
      <div>
        <span class="rk-badge">${_rankEsc(opts.badge)}</span>
        <h1>${_rankEsc(opts.title)}</h1>
        <p>${_rankEsc(opts.subtitle)}</p>
      </div>
      <div class="rk-period-badge">
        <div class="rk-period-main">${_rankEsc(periodoBadge)}</div>
        ${descHtml}
      </div>
    </div>
    ${kpiRowHtml}
  </div>
</div>

<div class="rk-page">
  ${opts.bodyHtml}

  <div class="report-footer">
    <div>
      <strong>AnalyticSys</strong> · Gestão Centralizada de Estoque e Insumos · Concrelagos Concreto
    </div>
    <div style="text-align:right">
      Período: <strong style="color:#94a3b8">${_rankEsc(periodo)}</strong>
    </div>
    ${opts.notaRodape ? `<div class="footer-note">${_rankEsc(opts.notaRodape)}</div>` : ''}
  </div>
</div>

</body>
</html>`;
}

// ── Componente: card compacto de sidebar (regional crítica) ─────────────
function _buildRankSideCard(r, i) {
  return `
    <div class="rk-side-card">
      <div class="rk-side-top">
        <span class="rk-side-pos">${String(i + 1).padStart(2, '0')}</span>
        <span class="rk-side-name">${_rankEsc(r.regional)}</span>
      </div>
      <div class="rk-side-sub">${r.centrais.map(c => _rankEsc(c)).join(' · ')}</div>
      <div class="rk-side-stats">
        <div><strong>${r.nCentrais}</strong><span>${r.nCentrais !== 1 ? 'centrais' : 'central'}</span></div>
        <div><strong>${r.registros}</strong><span>registros</span></div>
      </div>
    </div>`;
}

// ── Relatório 1 — Ranking de Centrais (Top 10 piores usinas) ────────────
function _buildRankingCentraisBody(rows, mesAno, sidebarRows) {
  const trs = rows.map((r, i) => {
    const cor = _rankSeverityDias(r.diasUnicos);
    return `
    <tr>
      <td class="rkp-pos-cell"><span class="rkp-pos" style="background:${cor}">${String(i + 1).padStart(2, '0')}</span></td>
      <td><div class="rk-name">${_rankEsc(r.central)}</div><div class="rk-sub">${_rankEsc(r.regional)}</div></td>
      <td class="rk-num" style="color:${cor}">${r.diasUnicos}</td>
      <td class="rk-num" style="color:#e2e8f0">${r.registros}</td>
      <td class="rk-num" style="color:#e2e8f0">${r.grupos}</td>
      <td class="rk-dates">${_rankCompactarDias(r.diasList)}</td>
    </tr>`;
  }).join('');

  const tableHtml = `
    <div class="rk-table-head">
      <span class="rk-table-head-title">Top ${rows.length} piores centrais · ordem por dias com ausência</span>
      ${mesAno ? `<span class="rk-table-head-cap">Datas referentes a ${_rankEsc(mesAno.toUpperCase())}</span>` : ''}
    </div>
    <div class="rk-table-wrap">
      <table class="rk-table">
        <thead>
          <tr>
            <th style="width:32px">#</th>
            <th>Central / Regional</th>
            <th style="width:60px;text-align:center">Dias</th>
            <th style="width:60px;text-align:center">Reg.</th>
            <th style="width:70px;text-align:center">Grupos</th>
            <th>Dias sem lançamento</th>
          </tr>
        </thead>
        <tbody>${trs}</tbody>
      </table>
    </div>`;

  const sidebarHtml = (sidebarRows && sidebarRows.length) ? `
    <div>
      <div class="rk-sidebar-title">Regionais mais críticas</div>
      <div class="rk-sidebar-cards">${sidebarRows.map((r, i) => _buildRankSideCard(r, i)).join('')}</div>
    </div>` : '<div></div>';

  return `<div class="rk-layout">
    <div>${tableHtml}</div>
    ${sidebarHtml}
  </div>`;
}

window.gerarRankingCentrais = function() {
  if (!window._ausenciasData?.length) { alert('Nenhuma ausência no período selecionado.'); return; }

  const ausencias = window._ausenciasData;
  const todas      = _rankAgruparPorCentral(ausencias);
  if (!todas.length) { alert('Nenhuma central com ausência no período/filtros atuais.'); return; }
  const top10 = todas.slice(0, 10);
  const pior  = top10[0];

  const todasRegionais = _rankAgruparPorRegional(ausencias);
  const sidebarRows    = todasRegionais.slice(0, 4);

  const totalRegistros = todas.reduce((s, r) => s + r.registros, 0);
  const periodo = _ausGetPeriodo();
  const now     = new Date().toLocaleString('pt-BR');
  const mesAno  = _rankMesAnoLabel();

  const bodyHtml = `
    ${_buildRankingCentraisBody(top10, mesAno, sidebarRows)}
    <div class="callout-regularizacao">
      <div class="callout-regularizacao-title">⚠ Regularização Imediata</div>
      <div class="callout-regularizacao-text">Revisar as datas, apagar e relançar os estoques corretos. Pendências mantidas serão escalonadas ao supervisor regional.</div>
    </div>`;

  const html = _buildRankingShellHTML({
    periodoBadge: _rankPeriodoBadgeLabel(),
    periodo, now,
    kpis: [
      { value: todas.length,    label: 'centrais fora do padrão',         color: '#ef4444' },
      { value: totalRegistros,  label: 'registros material-dia ausentes', color: '#f59e0b' },
      { value: pior.diasUnicos, label: 'dias sem lançar na pior central', color: '#22c55e' }
    ],
    desconsideradas: _rankCentraisDesconsideradas()
  }, {
    pageTitle:  'Ranking de Centrais — Ausência de Lançamento',
    badge:      'Alerta Crítico',
    title:      'Falha no lançamento diário dos materiais',
    subtitle:   'Ausências comprometem o fechamento, distorcem o estoque e impedem a rastreabilidade operacional.',
    bodyHtml,
    notaRodape: '1 registro = 1 material sem lançamento em 1 data. Ranking das centrais: dias únicos com qualquer ausência; desempate por registros.'
  });

  const w = window.open('', '_blank', 'width=1300,height=900,scrollbars=yes,resizable=yes');
  if (!w) { alert('Popups bloqueados! Permita pop-ups para gerar o relatório.'); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
};

// ── Relatório 2 — Ranking de Regionais (lista completa) ──────────────────
function _buildRankingRegionaisTableBlock(rows, offset) {
  const trs = rows.map((r, i) => {
    const cor   = _rankSeverityCentrais(r.nCentrais);
    const chips = r.centrais.map(c => `<span class="rk-chip">${_rankEsc(c)}</span>`).join('');
    return `
      <tr>
        <td class="rkp-pos-cell"><span class="rkp-pos" style="background:${cor}">${String(offset + i + 1).padStart(2, '0')}</span></td>
        <td><div class="rk-name">${_rankEsc(r.regional)}</div><div class="rk-sub">${r.grupos} grupo${r.grupos !== 1 ? 's' : ''} de material</div></td>
        <td class="rk-num" style="color:${cor}">${r.nCentrais}</td>
        <td class="rk-num" style="color:#e2e8f0">${r.registros}</td>
        <td>${chips}</td>
      </tr>`;
  }).join('');

  return `
    <table class="rk-table">
      <thead>
        <tr>
          <th style="width:32px">#</th>
          <th>Regional</th>
          <th style="width:74px;text-align:center">Centrais</th>
          <th style="width:80px;text-align:center">Reg.</th>
          <th>Centrais</th>
        </tr>
      </thead>
      <tbody>${trs}</tbody>
    </table>`;
}

window.gerarRankingRegionais = function() {
  if (!window._ausenciasData?.length) { alert('Nenhuma ausência no período selecionado.'); return; }

  const ausencias = window._ausenciasData;
  const todas      = _rankAgruparPorRegional(ausencias);
  if (!todas.length) { alert('Nenhuma regional com ausência no período/filtros atuais.'); return; }

  const totalCentrais  = new Set(ausencias.map(a => a.central)).size;
  const totalRegistros = todas.reduce((s, r) => s + r.registros, 0);
  const periodo = _ausGetPeriodo();
  const now     = new Date().toLocaleString('pt-BR');

  // Topo em destaque (cards) — até 4; o resto continua numerado, dividido
  // em 2 blocos de tabela lado a lado (mesmo layout do alerta de referência).
  const CARDS_N = Math.min(4, todas.length);
  const emCards = todas.slice(0, CARDS_N);
  const noResto = todas.length > CARDS_N ? todas.slice(CARDS_N) : [];

  const cardsHtml = emCards.map((r, i) => `
    <div class="rank-card">
      <div class="rank-card-pos">${String(i + 1).padStart(2, '0')}</div>
      <div class="rank-card-name">${_rankEsc(r.regional)}</div>
      <div class="rank-card-sub">${r.centrais.map(c => _rankEsc(c)).join(' · ')}</div>
      <div class="rank-card-stats">
        <div><strong>${r.nCentrais}</strong><span>${r.nCentrais !== 1 ? 'centrais' : 'central'}</span></div>
        <div><strong>${r.registros}</strong><span>registros</span></div>
      </div>
    </div>`).join('');

  const tierLabel = `Faixa crítica · ${emCards[0].nCentrais} ${emCards[0].nCentrais !== 1 ? 'centrais' : 'central'} fora do padrão`;

  let restoHtml = '';
  if (noResto.length) {
    const metade = Math.ceil(noResto.length / 2);
    const col1 = noResto.slice(0, metade);
    const col2 = noResto.slice(metade);
    restoHtml = `
      <div class="rk-table-split">
        <div class="rk-table-wrap">${_buildRankingRegionaisTableBlock(col1, CARDS_N)}</div>
        ${col2.length ? `<div class="rk-table-wrap">${_buildRankingRegionaisTableBlock(col2, CARDS_N + col1.length)}</div>` : ''}
      </div>`;
  }

  const bodyHtml = `
    <div class="tier-banner"><i class="ti ti-alert-triangle"></i> ${tierLabel}</div>
    <div class="rank-cards">${cardsHtml}</div>
    ${restoHtml}`;

  const html = _buildRankingShellHTML({
    periodoBadge: _rankPeriodoBadgeLabel(),
    periodo, now,
    kpis: [
      { value: todas.length,   label: 'regionais em alerta',             color: '#ef4444' },
      { value: totalCentrais,  label: 'centrais fora do padrão',         color: '#f59e0b' },
      { value: totalRegistros, label: 'registros material-dia ausentes', color: '#22c55e' }
    ],
    desconsideradas: _rankCentraisDesconsideradas()
  }, {
    pageTitle:  'Ranking de Regionais — Ausência de Lançamento',
    badge:      'Regionais em Alerta',
    title:      'Ranking completo das regionais',
    subtitle:   'Quanto mais centrais fora do padrão, maior o risco de falha recorrente no acompanhamento diário.',
    bodyHtml,
    notaRodape: 'Ordem: quantidade de centrais fora do padrão; desempate pelo total de registros material-dia ausentes.'
  });

  const w = window.open('', '_blank', 'width=1300,height=900,scrollbars=yes,resizable=yes');
  if (!w) { alert('Popups bloqueados! Permita pop-ups para gerar o relatório.'); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
};


// ── CSS escuro compartilhado pelas tabelas de material (Relatório Regional e
//    Relatório de Central — mesmas classes .data-table/.rank-cell/.mat-name) ──
function _criticidadeMatTableStyles() {
  return `
    .data-table { width:100%; border-collapse:collapse; font-size:12px; }
    .data-table th { background:rgba(255,255,255,.04); padding:9px 12px; text-align:left; font-weight:700; color:#94a3b8; font-size:10.5px; text-transform:uppercase; letter-spacing:.05em; border-bottom:1px solid rgba(255,255,255,.1); }
    .data-table td { padding:9px 12px; border-bottom:1px solid rgba(255,255,255,.06); vertical-align:top; color:#e2e8f0; }
    .data-table tbody tr:last-child td { border-bottom:none; }
    .data-row:hover { background:rgba(255,255,255,.02); }
    .rank-cell { color:#64748b; font-weight:700; font-family:'JetBrains Mono',monospace; font-size:11px; }
    .mat-name { font-weight:700; color:#fff; }
    .var-cell strong { font-family:'JetBrains Mono',monospace; }`;
}

// ═══════════════════════════════════════════════════════════════════
// RELATÓRIO POR REGIONAL (Crítico + Urgente de todas as centrais)
// (mesmo shell escuro dos relatórios de Ranking/Ausência: _buildRankingShellHTML)
// ═══════════════════════════════════════════════════════════════════
window.gerarRelatorioRegional = function(regionalName) {
  const byLevel = window._rankByLevel;
  if (!byLevel) { alert('Nenhum dado de criticidade disponível. Execute a análise primeiro.'); return; }

  // Filtra itens do regional
  const filter = item => (item.regional || '—') === regionalName;
  const criticos = (byLevel.critico || []).filter(filter);
  const urgentes = (byLevel.urgente || []).filter(filter);

  if (!criticos.length && !urgentes.length) {
    alert('Nenhum material crítico ou urgente para este regional.');
    return;
  }

  const periodo = _getAnPeriodo();
  const now = new Date().toLocaleString('pt-BR');

  // Helpers compartilhados
  function fmtKgR(v) { const n = Math.abs(Number(v)||0); return n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+' kg'; }
  function varDir(v) { return v < -0.001 ? 'Desfalque' : v > 0.001 ? 'Sobra' : 'Equil.'; }
  function varDirColor(v) { return v < -0.001 ? '#f87171' : v > 0.001 ? '#4ade80' : '#94a3b8'; }
  function trendLabel(t) { return t==='worsening'?'▲ Piorando':t==='improving'?'▼ Melhorando':'→ Estável'; }
  function trendColor(t) { return t==='worsening'?'#f87171':t==='improving'?'#4ade80':'#94a3b8'; }
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

  function buildCentralBlock(centralName, items, levelColor, levelBg, levelBorder, levelIcon, levelLabel, badgeColor) {
    return `
    <div class="central-section" style="margin-bottom:16px;border:1px solid ${levelBorder};border-left:4px solid ${levelColor};border-radius:8px;overflow:hidden;page-break-inside:avoid">
      <div style="background:${levelBg};padding:12px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid ${levelBorder}">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:16px">${levelIcon}</span>
          <div>
            <div style="font-size:13px;font-weight:700;color:${levelColor}">${escR(centralName)}</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:2px">${levelLabel}</div>
          </div>
        </div>
        <span style="background:${badgeColor};color:#fff;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">${items.length} ${items.length>1?'materiais':'material'}</span>
      </div>
      <table class="data-table">
        <thead><tr><th style="width:36px">#</th><th>Material</th><th>Variação</th><th>Tendência</th></tr></thead>
        <tbody>${buildMatRows(items)}</tbody>
      </table>
    </div>`;
  }

  // Monta seções por nível
  const levels = [
    { key:'critico', items:criticos, color:'#f87171', badgeColor:'#dc2626', bg:'rgba(239,68,68,.08)', border:'rgba(239,68,68,.3)', icon:'🔴', sublabel:'Ação imediata — escalar à gerência' },
    { key:'urgente', items:urgentes, color:'#fb923c', badgeColor:'#ea580c', bg:'rgba(249,115,22,.08)', border:'rgba(249,115,22,.3)', icon:'🟠', sublabel:'Atenção redobrada — repassar aos operadores' },
  ].filter(l => l.items.length > 0);

  const levelBgGradient = { critico: 'linear-gradient(135deg,#7f1d1d 0%,#991b1b 60%,#b91c1c 100%)', urgente: 'linear-gradient(135deg,#7c2d12 0%,#9a3412 60%,#c2410c 100%)' };
  const levelGlow      = { critico: 'rgba(239,68,68,0.35)', urgente: 'rgba(249,115,22,0.35)' };

  const sectionsHtml = levels.map(l => {
    const byCentral = groupByCentral(l.items);
    const centraisHtml = byCentral.map(([cn, items]) =>
      buildCentralBlock(cn, items, l.color, l.bg, l.border, l.icon, l.sublabel, l.badgeColor)
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
      '<div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.09);border-top:none;border-radius:0 0 12px 12px;padding:18px">' +
        centraisHtml +
      '</div>' +
    '</div>';
  }).join('');

  // Sumário
  const totalGeral = criticos.length + urgentes.length;
  const centraisAfetadas = new Set([...criticos,...urgentes].map(i=>i.central)).size;

  const bodyHtml = `<style>${_criticidadeMatTableStyles()}</style>${sectionsHtml}`;

  const html = _buildRankingShellHTML({
    periodoBadge: periodo,
    periodo, now,
    kpis: [
      { value: criticos.length,   label: 'críticos',            color: '#ef4444' },
      { value: urgentes.length,   label: 'urgentes',            color: '#f97316' },
      { value: centraisAfetadas,  label: 'centrais afetadas',   color: '#3b82f6' },
      { value: totalGeral,        label: 'total',               color: '#94a3b8' }
    ]
  }, {
    pageTitle:  `Relatório Regional — ${regionalName}`,
    badge:      'Alerta de Criticidade',
    title:      `Relatório Regional — ${regionalName}`,
    subtitle:   'Materiais críticos e urgentes agrupados por central, para ação imediata ou monitoramento reforçado.',
    bodyHtml,
    notaRodape: 'Crítico e urgente calculados a partir do desequilíbrio (desfalque/sobra) entre estoque físico e lançamentos no período selecionado.'
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
  if (modal._escHandler) document.removeEventListener('keydown', modal._escHandler);
  modal._escHandler = (e) => { if (e.key === 'Escape') { modal.classList.remove('open'); document.removeEventListener('keydown', modal._escHandler); } };
  document.addEventListener('keydown', modal._escHandler);
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
// RELATÓRIO POR CENTRAL (Atenção + Urgente + Crítico) — Relatório Padrão
// (mesmo shell escuro dos relatórios de Ranking/Ausência: _buildRankingShellHTML)
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
  function varDirColor(v) { return v<-0.001?'#f87171':v>0.001?'#4ade80':'#94a3b8'; }
  function trendLabel(t) { return t==='worsening'?'▲ Piorando':t==='improving'?'▼ Melhorando':'→ Estável'; }
  function trendColor(t) { return t==='worsening'?'#f87171':t==='improving'?'#4ade80':'#94a3b8'; }
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

  function buildLevelSection(items, color, icon, label, sublabel) {
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
        '<div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.09);border-top:none">' +
          '<table class="data-table"><thead><tr><th style="width:36px">#</th><th>Material</th><th>Variação</th><th>Tendência</th></tr></thead><tbody>' + buildRows(items) + '</tbody></table>' +
        '</div>' +
      '</div>'
    );
  }

  const sectionsHtml = [
    criticos.length && buildLevelSection(criticos,'#ef4444','🔴','CRÍTICO','Ação imediata — escalar à gerência'),
    urgentes.length && buildLevelSection(urgentes,'#f97316','🟠','URGENTE','Atenção redobrada — repassar aos regionais'),
    atencoes.length && buildLevelSection(atencoes,'#f59e0b','⚠️','ATENÇÃO','Monitorar — contatar operador'),
  ].filter(Boolean).join('');

  const totalGeral = criticos.length + urgentes.length + atencoes.length;
  const regional = [...criticos,...urgentes,...atencoes][0]?.regional || '—';

  const infoBar = `
    <div class="crit-info-bar">
      <div class="crit-info-item"><span class="crit-info-label">Central</span><span class="crit-info-value">${escC(centralName)}</span></div>
      <div style="width:1px;height:28px;background:rgba(255,255,255,.1)"></div>
      <div class="crit-info-item"><span class="crit-info-label">Regional</span><span class="crit-info-value">${escC(regional)}</span></div>
      <div style="width:1px;height:28px;background:rgba(255,255,255,.1)"></div>
      <div class="crit-info-item"><span class="crit-info-label">Total de materiais</span><span class="crit-info-value">${totalGeral} ${totalGeral!==1?'materiais':'material'}</span></div>
    </div>`;

  const bodyHtml = `
    <style>
      ${_criticidadeMatTableStyles()}
      .crit-info-bar { display:flex; align-items:center; gap:16px; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.09); border-radius:10px; padding:12px 16px; margin-bottom:22px; flex-wrap:wrap; }
      .crit-info-item { display:flex; flex-direction:column; gap:2px; }
      .crit-info-label { font-size:9.5px; color:#64748b; text-transform:uppercase; letter-spacing:.06em; }
      .crit-info-value { font-size:12.5px; color:#e2e8f0; font-weight:600; }
    </style>
    ${infoBar}
    ${sectionsHtml}`;

  const html = _buildRankingShellHTML({
    periodoBadge: periodo,
    periodo, now,
    kpis: [
      { value: criticos.length, label: 'críticos', color: '#ef4444' },
      { value: urgentes.length, label: 'urgentes', color: '#f97316' },
      { value: atencoes.length, label: 'atenção',  color: '#f59e0b' },
      { value: totalGeral,      label: 'total',    color: '#94a3b8' }
    ]
  }, {
    pageTitle:  `Relatório Central — ${centralName}`,
    badge:      'Alerta de Criticidade',
    title:      `Relatório de Central — ${centralName}`,
    subtitle:   `${escC(regional)} · materiais críticos, urgentes e em atenção, por nível de prioridade.`,
    bodyHtml,
    notaRodape: 'Crítico, urgente e atenção calculados a partir do desequilíbrio (desfalque/sobra) entre estoque físico e lançamentos no período selecionado.'
  });

  _openRelWindow(html);
};

// ═══════════════════════════════════════════════════════════════════
// RELATÓRIO COM AÇÕES — igual ao Padrão + coluna de ações por material
// (mesmo shell escuro dos relatórios de Ranking/Ausência: _buildRankingShellHTML)
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
  function varColor(v){ return v < -0.001 ? '#f87171'   : v > 0.001 ? '#fbbf24' : '#94a3b8'; }
  function trendLabel(t){ return t==='worsening' ? '▲ Piorando' : t==='improving' ? '▼ Melhorando' : '→ Estável'; }
  function trendColor(t){ return t==='worsening' ? '#f87171' : t==='improving' ? '#4ade80' : '#94a3b8'; }
  function escC(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // Monta cards de material — layout vertical, sem tabela
  function buildCards(items, levelColor, levelBg, levelKey) {
    return items.map((item, idx) => {
      const acoes  = _resolverAcoesParaMaterial(item.mat, item.diff, item.categoria, levelKey || item.level, item.catKey, item.catSubKey);
      const vc     = varColor(item.diff);
      const tc     = trendColor(item.trend);
      const hasAcao = acoes !== null;

      const acoesItems = hasAcao
        ? acoes.split(/[;|\n]/).map(a => a.trim()).filter(Boolean)
        : [];

      const acoesBullets = acoesItems.map(a =>
        '<li style="margin-bottom:5px;padding-left:4px;word-break:break-word;overflow-wrap:break-word">' + escC(a) + '</li>'
      ).join('');

      const acoesBlock = hasAcao
        ? '<div style="margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,.08)">' +
            '<div style="display:flex;align-items:center;gap:7px;margin-bottom:10px">' +
              '<span style="width:20px;height:20px;border-radius:50%;background:rgba(34,197,94,.15);border:1.5px solid rgba(34,197,94,.4);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:11px;color:#4ade80">✓</span>' +
              '<span style="font-size:11px;font-weight:700;color:#4ade80;text-transform:uppercase;letter-spacing:.06em">Ações propostas</span>' +
            '</div>' +
            '<ul style="margin:0;padding-left:18px;font-size:13px;color:#e2e8f0;line-height:1.7;word-break:break-word;overflow-wrap:break-word">' + acoesBullets + '</ul>' +
          '</div>'
        : '<div style="margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,.06);display:flex;align-items:center;gap:7px">' +
            '<span style="width:20px;height:20px;border-radius:50%;background:rgba(255,255,255,.04);border:1.5px solid rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:11px;color:#64748b">—</span>' +
            '<span style="font-size:12px;color:#64748b;font-style:italic">Sem regra cadastrada para esta variação</span>' +
          '</div>';

      return '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.09);border-left:4px solid ' + levelColor + ';border-radius:10px;padding:18px 20px;margin-bottom:12px;page-break-inside:avoid;overflow:hidden;word-break:break-word">' +

        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px">' +
          '<div style="display:flex;align-items:center;gap:10px">' +
            '<span style="width:26px;height:26px;border-radius:7px;background:' + levelBg + ';color:' + levelColor + ';font-size:11px;font-weight:800;font-family:\'JetBrains Mono\',monospace;display:flex;align-items:center;justify-content:center;flex-shrink:0">' + (idx+1) + '</span>' +
            '<span style="font-size:15px;font-weight:700;color:#fff">' + escC(item.mat) + '</span>' +
          '</div>' +
          (hasAcao
            ? '<span style="padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;background:rgba(34,197,94,.15);color:#4ade80;border:1px solid rgba(34,197,94,.4);white-space:nowrap;flex-shrink:0">✓ Com ação</span>'
            : '<span style="padding:3px 10px;border-radius:20px;font-size:10px;font-weight:600;background:rgba(255,255,255,.04);color:#64748b;border:1px solid rgba(255,255,255,.12);white-space:nowrap;flex-shrink:0">Sem ação</span>'
          ) +
        '</div>' +

        '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
          '<div style="display:flex;align-items:center;gap:7px;padding:7px 12px;border-radius:8px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);min-width:160px">' +
            '<div>' +
              '<div style="font-size:10px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px">Variação</div>' +
              '<div style="font-size:14px;font-weight:800;color:' + vc + ';font-family:\'JetBrains Mono\',monospace">' + varDir(item.diff) + '</div>' +
              '<div style="font-size:12px;font-weight:500;color:' + vc + ';font-family:\'JetBrains Mono\',monospace">' + fmtKgC(item.diff) + '</div>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:7px;padding:7px 12px;border-radius:8px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);min-width:140px">' +
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
    critico: { color:'#f87171', bg:'rgba(239,68,68,.16)', grad:'linear-gradient(135deg,#7f1d1d 0%,#991b1b 60%,#b91c1c 100%)', glow:'rgba(239,68,68,0.30)', icon:'🔴', label:'CRÍTICO', sub:'Ação imediata — escalar à gerência' },
    urgente: { color:'#fb923c', bg:'rgba(249,115,22,.16)', grad:'linear-gradient(135deg,#7c2d12 0%,#9a3412 60%,#c2410c 100%)', glow:'rgba(249,115,22,0.28)', icon:'🟠', label:'URGENTE', sub:'Atenção redobrada — repassar aos regionais' },
    atencao: { color:'#fbbf24', bg:'rgba(245,158,11,.16)', grad:'linear-gradient(135deg,#78350f 0%,#92400e 60%,#b45309 100%)', glow:'rgba(245,158,11,0.25)', icon:'⚠️', label:'ATENÇÃO', sub:'Monitorar — contatar operador' },
  };

  function buildLevelSection(items, cfg, levelKey) {
    if (!items.length) return '';
    const cards = buildCards(items, cfg.color, cfg.bg, levelKey);
    return '<div style="margin-bottom:32px;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px ' + cfg.glow + ';page-break-inside:avoid">' +
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
      '<div style="background:rgba(255,255,255,.015);padding:16px 20px;border:1px solid rgba(255,255,255,.09);border-top:none">' +
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

  const infoBar = `
    <div class="crit-info-bar">
      <div class="crit-info-item"><span class="crit-info-label">Central</span><span class="crit-info-value">${escC(centralName)}</span></div>
      <div style="width:1px;height:28px;background:rgba(255,255,255,.1)"></div>
      <div class="crit-info-item"><span class="crit-info-label">Regional</span><span class="crit-info-value">${escC(regional)}</span></div>
      <div style="width:1px;height:28px;background:rgba(255,255,255,.1)"></div>
      <div class="crit-info-item"><span class="crit-info-label">Total de materiais</span><span class="crit-info-value">${totalGeral}</span></div>
      <div style="width:1px;height:28px;background:rgba(255,255,255,.1)"></div>
      <div class="crit-info-item"><span class="crit-info-label">Regras cadastradas</span><span class="crit-info-value">${totalRegras}</span></div>
    </div>`;

  const bodyHtml = `
    <style>
      .crit-info-bar { display:flex; align-items:center; gap:16px; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.09); border-radius:10px; padding:12px 16px; margin-bottom:22px; flex-wrap:wrap; }
      .crit-info-item { display:flex; flex-direction:column; gap:2px; }
      .crit-info-label { font-size:9.5px; color:#64748b; text-transform:uppercase; letter-spacing:.06em; }
      .crit-info-value { font-size:12.5px; color:#e2e8f0; font-weight:600; }
    </style>
    ${infoBar}
    ${sectionsHtml}`;

  const html = _buildRankingShellHTML({
    periodoBadge: periodo,
    periodo, now,
    kpis: [
      { value: criticos.length, label: 'críticos',  color: '#ef4444' },
      { value: urgentes.length, label: 'urgentes',  color: '#f97316' },
      { value: atencoes.length, label: 'atenção',   color: '#f59e0b' },
      { value: comAcoes,        label: 'com ação',  color: '#22c55e' },
      { value: semAcoes,        label: 'sem ação',  color: '#64748b' }
    ]
  }, {
    pageTitle:  `Relatório com Ações — ${centralName}`,
    badge:      'Cobrança de Pendências',
    title:      `Relatório com Ações — ${centralName}`,
    subtitle:   `${escC(regional)} · materiais críticos, urgentes e em atenção, com ações corretivas propostas por regra cadastrada.`,
    bodyHtml,
    notaRodape: 'Ações resolvidas a partir das regras cadastradas em Configurações → Ações de Relatório, pela combinação de material, categoria, nível e faixa de variação mais próxima.'
  });

  _openRelWindow(html);
};

// ═══════════════════════════════════════════════════════════════════════════════
// RELATÓRIO GERENCIAL DE OCORRÊNCIAS — visão executiva para diretoria
// ═══════════════════════════════════════════════════════════════════════════════
// RELATÓRIO GERENCIAL DE OCORRÊNCIAS — visão executiva (mesmo shell escuro dos
// relatórios de Ranking/Ausência: _buildRankingShellHTML)
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
  const semaforoColor = pctVenc > 30 ? '#ef4444' : pctVenc > 10 ? '#f59e0b' : '#22c55e';
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

  // ── Pior regional (para meta no header) ──────────────────────────────────────
  const piorRegional = regionaisOrdenados[0];

  // ── Builders de seção (tema escuro) ──────────────────────────────────────────
  function buildRegionalRow([reg, r]) {
    const tm = r.tempoCount > 0 ? (r.tempoTotal / r.tempoCount).toFixed(1) : '—';
    const pctR = r.total > 0 ? Math.round(r.concluidas / r.total * 100) : 0;
    const barW = r.total > 0 ? Math.round(r.concluidas / r.total * 100) : 0;
    const rowBg = r.vencidas > 0 ? 'rgba(239,68,68,.06)' : r.urgentes > 0 ? 'rgba(245,158,11,.06)' : 'transparent';
    const vencColor = r.vencidas > 0 ? '#f87171' : '#64748b';
    const urgColor  = r.urgentes > 0 ? '#fbbf24' : '#64748b';
    return `
    <tr style="background:${rowBg}">
      <td class="rk-name" style="font-size:12px">${escR(reg)}</td>
      <td class="rk-num">${r.total}</td>
      <td class="rk-num" style="color:#93c5fd">${r.abertas}</td>
      <td class="rk-num" style="color:${vencColor}">${r.vencidas}</td>
      <td class="rk-num" style="color:${urgColor}">${r.urgentes}</td>
      <td class="rk-num" style="font-size:11px;color:#cbd5e1">${tm === '—' ? '—' : tm + 'd'}</td>
      <td style="min-width:130px">
        <div style="display:flex;align-items:center;gap:8px">
          <div class="oc-bar-track"><div class="oc-bar-fill" style="width:${barW}%;background:#22c55e"></div></div>
          <span style="font-size:10.5px;font-family:'JetBrains Mono',monospace;color:#94a3b8;min-width:30px;text-align:right">${pctR}%</span>
        </div>
      </td>
    </tr>`;
  }

  function buildMotivoRow([motivo, m], idx) {
    const barW = Math.round(m.total / maxMotivo * 100);
    const vColor = m.vencidas > 0 ? '#f87171' : '#64748b';
    return `
    <tr>
      <td class="rk-num" style="color:#64748b;font-size:10px">${idx+1}</td>
      <td class="rk-name" style="font-size:11.5px">${escR(motivo)}</td>
      <td style="min-width:150px">
        <div style="display:flex;align-items:center;gap:8px">
          <div class="oc-bar-track"><div class="oc-bar-fill" style="width:${barW}%;background:#3b82f6"></div></div>
          <span style="font-size:10.5px;font-family:'JetBrains Mono',monospace;color:#94a3b8;min-width:22px;text-align:right">${m.total}</span>
        </div>
      </td>
      <td class="rk-num" style="color:#93c5fd">${m.abertas}</td>
      <td class="rk-num" style="color:${vColor}">${m.vencidas}</td>
    </tr>`;
  }

  function buildCentralRow([central, c], idx) {
    const barW = Math.round(c.total / maxCentral * 100);
    const reg = getRegional(central);
    const vColor = c.vencidas > 0 ? '#f87171' : '#64748b';
    const uColor = c.urgentes > 0 ? '#fbbf24' : '#64748b';
    const rowBg = c.vencidas > 0 ? 'rgba(239,68,68,.06)' : c.urgentes > 0 ? 'rgba(245,158,11,.06)' : 'transparent';
    return `
    <tr style="background:${rowBg}">
      <td class="rk-num" style="color:#64748b;font-size:10px">${idx+1}</td>
      <td class="rk-name" style="font-size:12px">${escR(central)}</td>
      <td class="rk-sub" style="margin-top:0">${escR(reg)}</td>
      <td style="min-width:120px">
        <div style="display:flex;align-items:center;gap:8px">
          <div class="oc-bar-track"><div class="oc-bar-fill" style="width:${barW}%;background:#818cf8"></div></div>
          <span style="font-size:10.5px;font-family:'JetBrains Mono',monospace;color:#94a3b8;min-width:18px;text-align:right">${c.total}</span>
        </div>
      </td>
      <td class="rk-num" style="color:#93c5fd">${c.abertas}</td>
      <td class="rk-num" style="color:${vColor}">${c.vencidas}</td>
      <td class="rk-num" style="color:${uColor}">${c.urgentes}</td>
    </tr>`;
  }

  // ── bodyHtml ──────────────────────────────────────────────────────────────────
  const bodyHtml = `
    <style>
      .oc-semaforo { border-radius:10px; padding:16px 22px; display:flex; align-items:center; gap:16px; margin-bottom:22px; }
      .oc-semaforo-dot { width:16px; height:16px; border-radius:50%; flex-shrink:0; }
      .oc-semaforo-label { font-size:14px; font-weight:800; letter-spacing:.04em; }
      .oc-semaforo-desc { font-size:11.5px; color:#94a3b8; margin-top:3px; }

      .oc-highlight { background:rgba(255,255,255,.045); border:1px solid rgba(255,255,255,.09); border-radius:12px; padding:20px 24px; margin-bottom:24px; display:flex; align-items:center; gap:32px; flex-wrap:wrap; }
      .oc-highlight-label { font-size:10.5px; color:#94a3b8; text-transform:uppercase; letter-spacing:.06em; }
      .oc-highlight-value { font-family:'JetBrains Mono',monospace; font-weight:800; font-size:38px; color:#4ade80; line-height:1; margin-top:4px; }
      .oc-highlight-value small { font-size:16px; font-weight:400; color:#94a3b8; margin-left:4px; }
      .oc-highlight-sub { font-size:10.5px; color:#64748b; margin-top:4px; }
      .oc-highlight-divider { width:1px; height:56px; background:rgba(255,255,255,.1); flex-shrink:0; }
      .oc-highlight-stats { display:flex; flex-direction:column; gap:8px; flex:1; min-width:220px; }
      .oc-highlight-row { display:flex; justify-content:space-between; font-size:11.5px; }
      .oc-highlight-row span:first-child { color:#94a3b8; }
      .oc-highlight-row strong { font-family:'JetBrains Mono',monospace; }

      .oc-bar-track { flex:1; height:5px; background:rgba(255,255,255,.09); border-radius:3px; overflow:hidden; }
      .oc-bar-fill { height:100%; border-radius:3px; }
    </style>

    <div class="oc-semaforo" style="background:${semaforoColor}18;border:1px solid ${semaforoColor}40">
      <div class="oc-semaforo-dot" style="background:${semaforoColor};box-shadow:0 0 10px ${semaforoColor}80"></div>
      <div>
        <div class="oc-semaforo-label" style="color:${semaforoColor}">${semaforoLabel}</div>
        <div class="oc-semaforo-desc">${escR(semaforoDesc)}${piorRegional ? ` · Regional com mais atenção: <strong style="color:#e2e8f0">${escR(piorRegional[0])}</strong>` : ''}</div>
      </div>
    </div>

    ${tempoMedio !== null ? `
    <div class="oc-highlight">
      <div>
        <div class="oc-highlight-label">Tempo médio de conclusão</div>
        <div class="oc-highlight-value">${tempoMedio}<small>dias</small></div>
        <div class="oc-highlight-sub">média entre as ${tempoCount} ocorrência${tempoCount!==1?'s':''} concluídas com datas</div>
      </div>
      <div class="oc-highlight-divider"></div>
      <div class="oc-highlight-stats">
        <div class="oc-highlight-row"><span>Ocorrências abertas</span><strong style="color:#93c5fd">${abertas}</strong></div>
        <div class="oc-highlight-row"><span>Vencidas (prazo expirado)</span><strong style="color:#f87171">${vencidas}</strong></div>
        <div class="oc-highlight-row"><span>Urgentes (vencem em até 2 dias)</span><strong style="color:#fbbf24">${urgentes}</strong></div>
        <div class="oc-highlight-row"><span>Em prazo normal</span><strong style="color:#a5b4fc">${normais}</strong></div>
      </div>
    </div>` : ''}

    <div class="rk-table-wrap">
      <div class="rk-table-head">
        <div class="rk-table-head-title">Situação por Regional</div>
        <div class="rk-table-head-cap">${regionaisOrdenados.length} ${regionaisOrdenados.length!==1?'regionais':'regional'} · ordenado por criticidade</div>
      </div>
      <table class="rk-table">
        <thead>
          <tr>
            <th>Regional</th><th style="text-align:center">Total</th><th style="text-align:center">Em Aberto</th>
            <th style="text-align:center">Vencidas</th><th style="text-align:center">Urgentes</th>
            <th style="text-align:center">Tempo Médio</th><th>% Concluídas</th>
          </tr>
        </thead>
        <tbody>${regionaisOrdenados.map(buildRegionalRow).join('')}</tbody>
      </table>
    </div>

    <div class="rk-table-wrap">
      <div class="rk-table-head">
        <div class="rk-table-head-title">Ranking de Centrais</div>
        <div class="rk-table-head-cap">top ${topCentrals.length} por volume e criticidade</div>
      </div>
      <table class="rk-table">
        <thead>
          <tr>
            <th style="width:28px">#</th><th>Central</th><th>Regional</th><th>Volume</th>
            <th style="text-align:center">Em Aberto</th><th style="text-align:center">Vencidas</th><th style="text-align:center">Urgentes</th>
          </tr>
        </thead>
        <tbody>${topCentrals.map(buildCentralRow).join('')}</tbody>
      </table>
    </div>

    <div class="rk-table-wrap">
      <div class="rk-table-head">
        <div class="rk-table-head-title">Distribuição por Motivo</div>
        <div class="rk-table-head-cap">${motivosOrdenados.length} motivo${motivosOrdenados.length!==1?'s':''}</div>
      </div>
      <table class="rk-table">
        <thead>
          <tr><th style="width:28px">#</th><th>Motivo</th><th>Volume</th><th style="text-align:center">Em Aberto</th><th style="text-align:center">Vencidas</th></tr>
        </thead>
        <tbody>${motivosOrdenados.map(buildMotivoRow).join('')}</tbody>
      </table>
    </div>`;

  const d = {
    periodoBadge: now.split(' ')[0],
    periodo: 'Base completa de ocorrências',
    now,
    kpis: [
      { value: total,           label: 'total de ocorrências', color: '#94a3b8' },
      { value: abertas,         label: 'em aberto',            color: '#3b82f6' },
      { value: vencidas,        label: 'vencidas',              color: '#ef4444' },
      { value: urgentes,        label: 'urgentes',              color: '#f59e0b' },
      { value: pctConc + '%',   label: 'concluídas',            color: '#22c55e' }
    ]
  };

  const html = _buildRankingShellHTML(d, {
    pageTitle:  'Relatório Gerencial de Ocorrências',
    badge:      'Relatório Gerencial',
    title:      'Painel de Ocorrências — Situação Geral',
    subtitle:   'Visão executiva de abertura, prazos e conclusão de todas as ocorrências registradas.',
    bodyHtml,
    notaRodape: 'Vencida: prazo expirado. Urgente: vence em até 2 dias. Tempo médio calculado apenas entre ocorrências concluídas com data de abertura e conclusão registradas.'
  });

  _openRelWindow(html);
};

// ═══════════════════════════════════════════════════════════════════════════════
// RELATÓRIO GERENCIAL DO DASHBOARD GERENCIAL — Visão Geral, para diretoria/
// presidência (mesmo shell escuro dos demais Relatórios Gerenciais:
// _buildRankingShellHTML). Lê window._dgVgLastData (cache populado no fim de
// renderDgVisaoGeralPdf, em dashboard.js) — nunca recalcula nada, garantindo
// que os números do PDF batem exatamente com o que está na tela.
//
// FASE 1: Resumo do Período (KPIs) + Saúde Geral (gauges capturados como
// imagem). FASE 2: Categoria + Custo por Regional/Central (extremos + 2
// gráficos de barra). FASE 3: Custo Absoluto (donut de Grupo + 4 donuts de
// categoria). FASE 4 (final): Giro & Cobertura (Top 5) + Detalhado
// Analítico (tabela de material + 4 rankings, lista completa). Relatório
// completo — todas as 10 seções da Visão Geral.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Rasteriza um <svg> vivo da tela em PNG (data URL), resolvendo as
//    variáveis CSS (var(--text)/var(--text3)/var(--mono)) usadas nesses
//    SVGs para valores literais do tema escuro — o relatório abre numa
//    janela/documento própria, sem acesso às custom properties do app.
//    scale:2 pra ficar nítido tanto na tela quanto impresso. ──────────────
function _dgrSvgParaPngDataUrl(svgEl, scale = 2) {
  return new Promise((resolve) => {
    if (!svgEl) { resolve(null); return; }
    try {
      let svgStr = new XMLSerializer().serializeToString(svgEl);
      svgStr = svgStr
        .replace(/var\(--text3\)/g, '#404a60')
        .replace(/var\(--text\)/g, '#dde3f0')
        .replace(/var\(--mono\)/g, "'JetBrains Mono',monospace");
      if (!svgStr.includes('xmlns=')) {
        svgStr = svgStr.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
      }
      const vb = svgEl.viewBox && svgEl.viewBox.baseVal;
      const rect = svgEl.getBoundingClientRect();
      const w = (vb && vb.width)  || rect.width  || 300;
      const h = (vb && vb.height) || rect.height || 220;
      const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = w * scale;
        canvas.height = h * scale;
        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    } catch (err) {
      console.error('[Relatório Gerencial - Dashboard] Falha ao capturar SVG:', err);
      resolve(null);
    }
  });
}

// ── Captura um <canvas> (Chart.js) já desenhado na tela em PNG — cores
//    já vêm "assadas" nos pixels do canvas, sem depender de CSS var. ─────
function _dgrCanvasParaPngDataUrl(canvasId) {
  const c = document.getElementById(canvasId);
  if (!c) return null;
  try { return c.toDataURL('image/png'); }
  catch (err) { console.error('[Relatório Gerencial - Dashboard] Falha ao capturar canvas', canvasId, err); return null; }
}

// ── Seção 1: Resumo do Período (réplica dos cards de KPI da tela, com
//    cores literais do tema escuro em vez de var(--x) — ver nota acima). ──
function _dgrBuildResumoPeriodoHtml(d) {
  const colorFor = v => v < -0.0001 ? '#f43f5e' : v > 0.0001 ? '#f59e0b' : '#06b6d4';
  const varCol = colorFor(d.varTotalFisica);
  const cstCol = colorFor(d.custoTotal);

  const totalEstTeorico = d.estTotais.totalIni + d.movTotais.totalEnt - d.movTotais.totalSai;
  const pctVariacao = Math.abs(totalEstTeorico) > 0.0001 ? (d.varTotalFisica / totalEstTeorico) * 100 : null;
  const custoEstTeorico = (d.estTotais.custoIni || 0) + (d.custoMovTotais.custoEnt || 0) - (d.custoMovTotais.custoSai || 0);
  const pctCusto = Math.abs(custoEstTeorico) > 0.0001 ? (d.custoTotal / custoEstTeorico) * 100 : null;

  const kgEvolucao    = d.estTotais.totalFim - d.estTotais.totalIni;
  const custoEvolucao = (d.estTotais.custoFim || 0) - (d.estTotais.custoIni || 0);
  const pctEvolucao   = Math.abs(d.estTotais.totalIni) > 0.0001 ? (kgEvolucao / d.estTotais.totalIni) * 100 : null;
  const evoCol = colorFor(kgEvolucao);

  const pctStr = p => p === null ? '—' : Math.abs(p).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';

  // Saldo físico do card hero em toneladas (kg ÷ 1.000) — só essa linha,
  // a pedido do Hugo; o resto do relatório (cards secundários, tabela de
  // Detalhamento) continua em kg, que é o grão certo pra aquele nível de
  // detalhe.
  const fmtTon = kg => (kg / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ton';

  // Caminhões/Carretas/IBCs (equivalente em veículos da variação física —
  // mesma metodologia da tela, ver veiculosRowHtml em _dgVgRenderKpisHero,
  // dashboard.js) — versão discreta, sem ícone/selo, pra ficar ao lado do
  // saldo em vez de ocupar uma grade grande embaixo (ficava desbalanceado).
  const v = d.veiculosTotalKpi || {};
  const veiculoStat = (label, valor) => `
    <div class="dgr-kpi-veiculo-simples">
      <div class="dgr-kpi-veiculo-simples-valor" style="color:${_dgrValCor(valor)}">${_daFmtCountSigned(valor)}</div>
      <div class="dgr-kpi-veiculo-simples-label">${label}</div>
    </div>`;
  const veiculosHtml = (v.caminhoes || v.carretas || v.ibcs) ? `
    <div class="dgr-kpi-veiculos-simples">
      ${veiculoStat('Caminhões', v.caminhoes)}
      ${veiculoStat('Carretas', v.carretas)}
      ${veiculoStat('IBCs', v.ibcs)}
    </div>` : '';

  // Card secundário padrão (rótulo + selo de ícone colorido no topo, valor
  // grande, subvalor menor).
  const card2 = (label, iconCls, iconCol, valor, sub) => `
    <div class="dgr-kpi-card">
      <div class="dgr-kpi-card-head">
        <div class="dgr-kpi-label">${label}</div>
        <div class="dgr-kpi-icon" style="background:${iconCol}1f;color:${iconCol}"><i class="ti ${iconCls}"></i></div>
      </div>
      <div class="dgr-kpi-value">${valor}</div>
      <div class="dgr-kpi-unit">${sub}</div>
    </div>`;

  // Card "Variação Ajustada" — as % de Variação e de Custo Var. separadas
  // do card hero, cada uma com seu mini-rótulo, uma acima da outra.
  const cardVariacaoAjustada = `
    <div class="dgr-kpi-card">
      <div class="dgr-kpi-card-head">
        <div class="dgr-kpi-label">Variação Ajustada</div>
        <div class="dgr-kpi-icon" style="background:${varCol}1f;color:${varCol}"><i class="ti ti-adjustments"></i></div>
      </div>
      ${pctVariacao === null ? '<div class="dgr-kpi-unit">—</div>' : `
      <div class="dgr-kpi-pct" style="color:${varCol}">${varSymbol(d.varTotalFisica)} ${pctStr(pctVariacao)}</div>
      <div class="dgr-kpi-unit">Variação · do Est. Teórico</div>`}
      ${pctCusto === null ? '' : `
      <div class="dgr-kpi-divider-row">
        <div class="dgr-kpi-pct" style="color:${cstCol}">${varSymbol(d.custoTotal)} ${pctStr(pctCusto)}</div>
        <div class="dgr-kpi-pct-label">Custo Var. · do Custo Teórico</div>
      </div>`}
    </div>`;

  return `
    <div class="dgr-section-title"><i class="ti ti-report-money"></i>Resumo do Período — Estoque, Movimentação e Variação</div>
    <div class="dgr-kpi-secondary">
      ${card2('Est. Inicial Total', 'ti-database', '#94a3b8', money(d.estTotais.custoIni || 0), fmtKg(d.estTotais.totalIni))}
      ${card2('Entradas', 'ti-activity', '#10b981', money(d.custoMovTotais.custoEnt || 0), fmtKg(d.movTotais.totalEnt))}
      ${card2('Saídas', 'ti-activity', '#f43f5e', money(d.custoMovTotais.custoSai || 0), fmtKg(d.movTotais.totalSai))}
      ${card2('Est. Final Total', 'ti-circle-check', '#3b82f6', money(d.estTotais.custoFim || 0), fmtKg(d.estTotais.totalFim))}
      ${card2('Evolução Estoque', 'ti-chart-line', '#8b5cf6', `<span style="color:${evoCol}">${pctEvolucao === null ? '—' : varSymbol(kgEvolucao) + ' ' + pctStr(pctEvolucao)}</span>`, `${varSymbol(kgEvolucao)} ${money(Math.abs(custoEvolucao))}`)}
      ${cardVariacaoAjustada}
    </div>
    <div class="dgr-kpi-hero" style="border-top-color:${cstCol}">
      <div class="dgr-kpi-card-head">
        <div class="dgr-kpi-label">Variação Estoque</div>
        <div class="dgr-kpi-icon" style="background:${cstCol}1f;color:${cstCol}"><i class="ti ti-currency-dollar"></i></div>
      </div>
      <div class="dgr-kpi-hero-custo" style="color:${cstCol}">${varSymbol(d.custoTotal)} ${money(Math.abs(d.custoTotal))}</div>
      <div class="dgr-kpi-unit">R$ bruto</div>
      <div class="dgr-kpi-hero-saldo-row">
        <div>
          <div class="dgr-kpi-hero-saldo" style="color:${varCol}">${varSymbol(d.varTotalFisica)} ${fmtTon(Math.abs(d.varTotalFisica))}</div>
          <div class="dgr-kpi-unit">ton bruto</div>
        </div>
        ${veiculosHtml}
      </div>
    </div>`;
}

// ── Seção 2: Saúde Geral — Centrais e Materiais (gauges capturados como
//    imagem + badges de contagem por nível, reaproveitados direto do DOM
//    já renderizado — já usam cores literais, só o font-family precisa de
//    resolução). ────────────────────────────────────────────────────────
function _dgrBuildSaudeGeralHtml(imgCentral, imgMateriais) {
  const resolveMono = html => (html || '').replace(/var\(--mono\)/g, "'JetBrains Mono',monospace");
  const summaryCentral   = resolveMono(document.getElementById('dg-vg-health-central-summary')?.innerHTML);
  const summaryMateriais = resolveMono(document.getElementById('dg-vg-health-materiais-summary')?.innerHTML);
  const subCentral    = document.getElementById('dg-vg-health-central-subtitle')?.textContent || '';
  const subMateriais  = document.getElementById('dg-vg-health-materiais-subtitle')?.textContent || '';

  const card = (titulo, iconCls, sub, img, summary) => `
    <div class="dgr-health-card">
      <div class="dgr-health-title"><i class="ti ${iconCls}"></i><span>${_rankEsc(titulo)}</span><span style="margin-left:auto;font-weight:400;color:#64748b;font-size:10px">${_rankEsc(sub)}</span></div>
      ${img ? `<img src="${img}" alt="${_rankEsc(titulo)}">` : '<div style="padding:40px 0;color:#64748b;font-size:11px;text-align:center">Gráfico indisponível</div>'}
      <div class="dgr-health-summary">${summary}</div>
    </div>`;

  return `
    <div class="dgr-section-title" style="margin-top:26px"><i class="ti ti-heart-rate-monitor"></i>Saúde Geral — Centrais e Materiais</div>
    <div class="dgr-health-grid">
      ${card('Saúde Geral — Centrais', 'ti-building-factory-2', subCentral, imgCentral, summaryCentral)}
      ${card('Saúde Geral — Materiais', 'ti-heartbeat', subMateriais, imgMateriais, summaryMateriais)}
    </div>`;
}

// ── Seção 3: Desfalque e Sobra por Categoria — gráfico de barra (Chart.js)
//    capturado como imagem; cores já vêm "assadas" nos pixels do canvas,
//    sem depender de CSS var (ver _dgrCanvasParaPngDataUrl). ─────────────
function _dgrBuildCategoriaHtml(imgCategoria) {
  return `
    <div class="dgr-chart-card" style="margin-top:26px">
      <div class="dgr-chart-title"><i class="ti ti-chart-bar"></i>Desfalque e Sobra por Categoria — % do Volume Movimentado</div>
      ${imgCategoria ? `<img src="${imgCategoria}" alt="Desfalque e Sobra por Categoria">` : '<div class="dgr-chart-empty">Gráfico indisponível</div>'}
    </div>`;
}

// ── Seções 4/5/6: Custo por Regional e Central — 4 cards de destaque
//    (extremos, reconstruídos a partir de d.extRegional/d.extCentral já
//    calculados — mesma lógica de _dgVgRenderExtremos em dashboard.js, só
//    com cores literais em vez de var(--x)) + os 2 gráficos de barra
//    (Regional/Central) capturados como imagem. ──────────────────────────
function _dgrBuildCustoRegionalCentralHtml(d, imgRegional, imgUsina) {
  const extremoBox = (label, ext) => {
    if (!ext) return `
      <div class="dgr-extremo-box">
        <div class="dgr-extremo-label">${_rankEsc(label)}</div>
        <div class="dgr-extremo-value" style="color:#64748b">—</div>
        <div class="dgr-extremo-name">Sem dados no período</div>
      </div>`;
    const col = ext.v < 0 ? '#f43f5e' : '#f59e0b';
    return `
      <div class="dgr-extremo-box">
        <div class="dgr-extremo-label">${_rankEsc(label)}</div>
        <div class="dgr-extremo-value" style="color:${col}">${_dgrNowrapNum(`${varSymbol(ext.v)} ${money(Math.abs(ext.v))}`)}</div>
        <div class="dgr-extremo-kg">${_dgrNowrapNum(`${varSymbol(ext.kg || 0)} ${fmtKg(Math.abs(ext.kg || 0))}`)}</div>
        <div class="dgr-extremo-name">${_rankEsc(ext.k)}</div>
      </div>`;
  };

  const extremosHtml =
    extremoBox('Regional · Maior Desfalque', d.extRegional.min && d.extRegional.min.v < 0 ? d.extRegional.min : null) +
    extremoBox('Regional · Maior Sobra',     d.extRegional.max && d.extRegional.max.v > 0 ? d.extRegional.max : null) +
    extremoBox('Central · Maior Desfalque',  d.extCentral.min  && d.extCentral.min.v  < 0 ? d.extCentral.min  : null) +
    extremoBox('Central · Maior Sobra',      d.extCentral.max  && d.extCentral.max.v  > 0 ? d.extCentral.max  : null);

  return `
    <div class="dgr-section-title" style="margin-top:26px"><i class="ti ti-scale"></i>Custo por Regional e Central</div>
    <div class="dgr-extremos-grid">${extremosHtml}</div>
    <div class="dgr-chart-grid">
      <div class="dgr-chart-card">
        <div class="dgr-chart-title"><i class="ti ti-users"></i>Variação de Custo por Regional</div>
        ${imgRegional ? `<img src="${imgRegional}" alt="Variação de Custo por Regional">` : '<div class="dgr-chart-empty">Gráfico indisponível</div>'}
      </div>
      <div class="dgr-chart-card">
        <div class="dgr-chart-title"><i class="ti ti-building-factory-2"></i>Variação de Custo por Central</div>
        ${imgUsina ? `<img src="${imgUsina}" alt="Variação de Custo por Central">` : '<div class="dgr-chart-empty">Gráfico indisponível</div>'}
      </div>
    </div>`;
}

// ── Seções 7/8: Custo Absoluto — 1 donut combinado (Grupo de Material,
//    em destaque) + 4 donuts de categoria (Agregado/Aglomerante/Aditivo/
//    Adição), todos gerados por _dgVgRenderCustoDonutSvg (mesma função dos
//    gauges de Saúde Geral) e capturados com a mesma técnica de resolução
//    de var(--x) já validada na Fase 1.
//    NÃO CHAMADA ATUALMENTE — removida do corpo do relatório a pedido do
//    Hugo (jul/2026). Função mantida (não deletada) pra reativar rápido
//    caso ele queira essa seção de volta; a captura das imagens
//    correspondentes também foi removida do fluxo principal.
function _dgrBuildCustoAbsolutoHtml(imgGrupo, imgsCat) {
  const subGrupo = document.getElementById('dg-vg-grupo-subtitle')?.textContent || '';
  const catTitulos = {
    agregado: 'Custo Absoluto por Agregado',
    aglomerante: 'Custo Absoluto por Aglomerante',
    aditivo: 'Custo Absoluto por Aditivo',
    adicao: 'Custo Absoluto por Adição'
  };

  const smallCard = catKey => {
    const sub = document.getElementById(`dg-vg-donut-${catKey}-subtitle`)?.textContent || '';
    const img = imgsCat[catKey];
    return `
      <div class="dgr-chart-card dgr-donut-small">
        <div class="dgr-chart-title"><span>${_rankEsc(catTitulos[catKey])}</span><span style="margin-left:auto;font-weight:400;color:#64748b;font-size:10px">${_rankEsc(sub)}</span></div>
        ${img ? `<img src="${img}" alt="${_rankEsc(catTitulos[catKey])}">` : '<div class="dgr-chart-empty">Gráfico indisponível</div>'}
      </div>`;
  };

  return `
    <div class="dgr-section-title" style="margin-top:26px"><i class="ti ti-chart-pie"></i>Custo Absoluto — Por Grupo e Categoria de Material</div>
    <div class="dgr-grupo-layout">
      <div class="dgr-chart-card dgr-donut-grande">
        <div class="dgr-chart-title"><span><i class="ti ti-chart-donut"></i>Custo Absoluto por Grupo de Material</span><span style="margin-left:auto;font-weight:400;color:#64748b;font-size:10px">${_rankEsc(subGrupo)}</span></div>
        ${imgGrupo ? `<img src="${imgGrupo}" alt="Custo Absoluto por Grupo de Material">` : '<div class="dgr-chart-empty">Gráfico indisponível</div>'}
      </div>
      <div class="dgr-donut-sub-grid">
        ${smallCard('agregado')}${smallCard('aglomerante')}${smallCard('aditivo')}${smallCard('adicao')}
      </div>
    </div>`;
}

// ── Seção 9: Giro & Cobertura — Top 5 Centrais/Materiais mais saudáveis e
//    mais críticos. Lê d.giro (cache populado no fim de renderDgGiro, em
//    dashboard.js — a lógica de classificação de nível/giro/cobertura NUNCA
//    é duplicada aqui, só reformatada com cores literais). Tabelas
//    reaproveitam .rk-table do shell (_buildRankingShellHTML). ───────────
function _dgrNivelCor(level) {
  return { bom: '#10b981', atencao: '#f59e0b', urgente: '#f97316', critico: '#f43f5e' }[level] || '#64748b';
}
function _dgrGiroCor(g) {
  if (g > 4.0)  return '#f43f5e';
  if (g >= 2.0) return '#10b981';
  if (g >= 1.0) return '#06b6d4';
  if (g >= 0.5) return '#f59e0b';
  if (g >= 0.2) return '#f97316';
  return '#f43f5e';
}
function _dgrTruncNome(nome, max = 26) {
  const s = String(nome || '');
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}
// ── Abastecimento (entradas ÷ saídas) — MESMOS limiares/rótulos de
//    buildAbastCell (função interna de renderDgGiro, dashboard.js, não
//    acessível globalmente), só com cores literais em vez de var(--x) e
//    sem os data-help/tooltips (não fazem sentido num PDF estático).
//    panel: 'alto' (alto giro — risco de ruptura) ou 'baixo' (baixo giro —
//    capital parado) — o mesmo % de abastecimento é lido de forma
//    diferente conforme o painel, exatamente como na tela. ──────────────
function _dgrAbastInfo(entradas, saidas, panel) {
  if (saidas < 0.001 && entradas < 0.001) return { texto: '—', cor: '#64748b', icone: null };
  if (saidas < 0.001) return { texto: 'acúmulo', cor: '#8b5cf6', icone: 'ti-arrow-up' };
  const ratio = (entradas / saidas) * 100;
  const label = ratio.toFixed(0) + '%';
  if (panel === 'alto') {
    if (ratio >= 100) return { texto: label, cor: '#10b981', icone: 'ti-circle-check' };
    if (ratio >= 80)  return { texto: label, cor: '#f59e0b', icone: 'ti-alert-triangle' };
    return { texto: label, cor: '#f43f5e', icone: 'ti-flame' };
  }
  if (ratio > 150)  return { texto: label, cor: '#8b5cf6', icone: 'ti-currency-dollar' };
  if (ratio >= 100) return { texto: label, cor: '#f59e0b', icone: 'ti-arrow-up' };
  if (ratio >= 80)  return { texto: label, cor: '#10b981', icone: 'ti-equal' };
  return { texto: label, cor: '#f43f5e', icone: 'ti-trending-down' };
}
// ── Cobertura (dias de estoque no ritmo de consumo atual) — MESMOS
//    limiares/ícones de buildCoberturaCell (função interna de
//    renderDgGiro, dashboard.js, não acessível globalmente), com cores
//    literais em vez de var(--x). null (sem consumo) fica de fora — vira
//    texto simples, sem badge, igual na tela. ─────────────────────────
function _dgrCoberturaInfo(dias) {
  if (dias === null) return null;
  const d = dias.toFixed(1) + 'd';
  if (dias < 5)   return { texto: d, cor: '#f43f5e', icone: 'ti-flame' };
  if (dias < 10)  return { texto: d, cor: '#f59e0b', icone: 'ti-alert-triangle' };
  if (dias < 20)  return { texto: d, cor: '#10b981', icone: 'ti-circle-check' };
  if (dias <= 40) return { texto: d, cor: '#f59e0b', icone: 'ti-clock' };
  return { texto: d, cor: '#8b5cf6', icone: 'ti-lock' };
}
function _dgrGiroListaHtml(titulo, iconCls, items, panel, footerArr) {
  if (!items || !items.length) {
    return `<div class="dgr-chart-card"><div class="dgr-chart-title"><i class="ti ${iconCls}"></i>${_rankEsc(titulo)}</div><div class="dgr-chart-empty">Sem dados de giro</div></div>`;
  }
  const rows = items.map(item => {
    const cor = _dgrNivelCor(item.nivel.level);
    const abast = _dgrAbastInfo(item.entradas, item.saidas, panel);
    const cobertura = _dgrCoberturaInfo(item.cobertura);
    return `
    <tr>
      <td class="rk-name" style="font-size:10.5px" title="${_rankEsc(item.name)}"><span class="dgr-nome-trunc-inner">${_rankEsc(_dgrTruncNome(item.name))}</span></td>
      <td><span style="display:inline-block;padding:2px 6px;border-radius:5px;font-size:8.5px;font-weight:700;white-space:nowrap;background:${cor}22;color:${cor};border:1px solid ${cor}55">${_rankEsc(item.nivel.label)}</span></td>
      <td style="text-align:right">${cobertura
        ? `<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 6px;border-radius:5px;font-size:8px;font-weight:700;white-space:nowrap;background:${cobertura.cor}22;color:${cobertura.cor};border:1px solid ${cobertura.cor}55"><i class="ti ${cobertura.icone}" style="font-size:9px"></i>${cobertura.texto}</span>`
        : `<span class="rk-num" style="font-size:9px;color:#64748b">sem consumo</span>`}</td>
      <td class="rk-num" style="font-size:9px;color:${_dgrGiroCor(item.giro)}">${_dgrNowrapNum(item.giro.toFixed(2) + '×')}</td>
      <td class="rk-num" style="font-size:8.5px;color:#94a3b8">${_dgrNowrapNum(fmtKgShort(item.entradas))}</td>
      <td class="rk-num" style="font-size:8.5px;color:#94a3b8">${_dgrNowrapNum(fmtKgShort(item.saidas))}</td>
      <td class="rk-num" style="font-size:8.5px;color:#94a3b8">${_dgrNowrapNum(fmtKgShort(item.estMedio || 0))}</td>
      <td style="text-align:right"><span style="display:inline-flex;align-items:center;gap:3px;padding:2px 6px;border-radius:5px;font-size:8px;font-weight:700;white-space:nowrap;background:${abast.cor}22;color:${abast.cor};border:1px solid ${abast.cor}55">${abast.icone ? `<i class="ti ${abast.icone}" style="font-size:9px"></i>` : ''}${abast.texto}</span></td>
    </tr>`;
  }).join('');

  // Rodapé de resumo (só no painel "Materiais Mais Críticos" — mesma
  // condição withFooter=true de buildBaixoFooter na tela) — soma sobre o
  // array COMPLETO (footerArr), não só os 5 exibidos na tabela.
  const footerHtml = footerArr ? (() => {
    const parados   = footerArr.filter(m => m.giro < 0.1).length;
    const baixoGiro = footerArr.filter(m => m.giro >= 0.1 && m.giro < 1).length;
    const estTotal  = footerArr.reduce((s, m) => s + (m.estMedio || 0), 0);
    return `
      <div class="dgr-giro-footer">
        <span style="color:#f43f5e"><i class="ti ti-lock" style="font-size:10px"></i> ${parados} parado${parados !== 1 ? 's' : ''}</span>
        <span style="color:#f59e0b"><i class="ti ti-alert-triangle" style="font-size:10px"></i> ${baixoGiro} baixo giro</span>
        <span style="color:#64748b;margin-left:auto">Est. total parado: ${fmtKgShort(estTotal)}</span>
      </div>`;
  })() : '';

  return `
    <div class="dgr-chart-card">
      <div class="dgr-chart-title"><i class="ti ${iconCls}"></i>${_rankEsc(titulo)}</div>
      <table class="rk-table dgr-giro-table">
        <thead><tr>
          <th style="width:19%">Nome</th>
          <th style="width:11%">Nível</th>
          <th style="width:10%;text-align:right">Cobertura</th>
          <th style="width:8%;text-align:right">Giro</th>
          <th style="width:12%;text-align:right">Entradas</th>
          <th style="width:12%;text-align:right">Saídas</th>
          <th style="width:12%;text-align:right">Est.Médio</th>
          <th style="width:16%;text-align:right">Abast.</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${footerHtml}
    </div>`;
}
function _dgrBuildGiroCoberturaHtml(d) {
  const g = d.giro;
  if (!g) return '';
  return `
    <div class="dgr-section-title" style="margin-top:26px"><i class="ti ti-arrows-exchange"></i>Giro & Cobertura — Top 5</div>
    <div class="dgr-chart-grid">
      ${_dgrGiroListaHtml('Top 5 Centrais — Mais Saudáveis', 'ti-trending-up', g.centralAlto, 'alto')}
      ${_dgrGiroListaHtml('Top 5 Centrais — Mais Críticas', 'ti-trending-down', g.centralBaixo, 'baixo')}
    </div>
    <div class="dgr-chart-grid" style="margin-top:28px">
      ${_dgrGiroListaHtml('Top 5 Materiais — Mais Saudáveis', 'ti-trending-up', g.matAlto, 'alto')}
      ${_dgrGiroListaHtml('Top 5 Materiais — Mais Críticos', 'ti-trending-down', g.matBaixo, 'baixo', g.matArrFull)}
    </div>`;
}

// ── Seção 10: Detalhado Analítico — tabela de Detalhamento por Material +
//    4 rankings (Regional/Central/Material/Categoria). Chama DIRETO as
//    mesmas funções puras de cálculo que dashboard.js usa na tela
//    (_daBuildTabelaMaterial, _daBuildRanking, etc. — funções globais,
//    reaproveitando d.pares/d.results/d.totalEstTeoricoKpi já cacheados),
//    então os números nunca podem divergir da Visão Geral. Lista completa
//    (sem corte por Top N) — decisão do Hugo, jul/2026: tabelas usam
//    .dgr-table-wrap (sem page-break-inside:avoid, ao contrário de
//    .rk-table-wrap do shell) pra paginar naturalmente na impressão em vez
//    de forçar a tabela inteira numa página só. ───────────────────────────
function _dgrValCor(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '#64748b';
  return v < -0.0001 ? '#f43f5e' : v > 0.0001 ? '#f59e0b' : '#64748b';
}
// Mantém o trecho numérico de um valor já formatado (money/fmtKg/pct etc.)
// inteiro, numa unidade não-quebrável — prefixos (R$, ícone de seta) e
// sufixos (kg, /kg, %, ×) continuam podendo quebrar pra linha seguinte
// livremente, mas o número em si NUNCA quebra no meio de um dígito
// (evita o "12.85|5.060|,00|kg" que acontecia em colunas estreitas).
function _dgrNowrapNum(str) {
  const s = String(str);
  // Pega o ÚLTIMO trecho numérico da string — é sempre o valor formatado
  // de verdade. Usar o primeiro (versão anterior, com bug) podia casar um
  // número que apareça ANTES dele dentro de HTML já embutido, como o
  // "11" de style="font-size:11px" no ícone que varSymbol() antepõe em
  // _daFmtPctSigned/_daFmtMoneySigned/_daFmtCountSigned — o que quebrava
  // a tag no meio e vazava texto cru pro PDF.
  const m = s.match(/[\d.,]+(?!.*[\d.,])/);
  if (!m) return s;
  return s.slice(0, m.index) + `<span style="white-space:nowrap">${m[0]}</span>` + s.slice(m.index + m[0].length);
}
// ── Fonte proporcional ao número de linhas — tabelas pequenas (poucas
//    linhas, sobra espaço na página) ganham texto bem maior e mais
//    legível; tabelas grandes continuam no tamanho compacto já validado
//    contra o pior caso real (números de até 18 dígitos). 'material' tem
//    9 colunas (mais apertado), 'ranking' tem 6 (mais folga por coluna).
//    Cada patamar foi testado com os valores mais largos que aparecem no
//    sistema pra garantir que não reintroduz overflow. ──────────────────
function _dgrFontesPorLinhas(n, tipo) {
  // A tabela de material (9 colunas) tem margem real mínima pra crescer,
  // independente da quantidade de linhas — a largura de cada coluna é a
  // MESMA % do container tanto com 5 quanto com 38 linhas (table-layout:
  // fixed), então "menos linhas" não libera espaço horizontal nenhum, só
  // vertical. Testei e confirmei: acima de ~8,3px já estoura com os
  // valores mais largos reais do sistema. Fica praticamente fixa.
  // A tabela de ranking (6 colunas, bem mais folga por coluna) sim ganha
  // uma escala de verdade — validada com nomes/valores reais no pior
  // caso (FERNANDO FIGUEIREDO, R$ 227.453,54) na largura real de página.
  const escalas = {
    material: [[Infinity, 8.2]],
    ranking:  [[8, 10.5], [20, 9.5], [40, 8.8], [Infinity, 8.2]]
  };
  const escala = escalas[tipo] || escalas.material;
  let base = 8.2;
  for (const [limite, fonte] of escala) {
    if (n <= limite) { base = fonte; break; }
  }
  return { base, nome: +(base + (tipo === 'ranking' ? 0.4 : 0.2)).toFixed(1), header: Math.max(7.5, +(base - 0.4).toFixed(1)) };
}
function _dgrTabelaMaterialHtml(dados) {
  if (!dados.linhas.length) return '';
  const f = _dgrFontesPorLinhas(dados.linhas.length, 'material');
  const rows = dados.linhas.map(l => `
    <tr>
      <td class="rk-name" style="font-size:${f.nome}px">${_rankEsc(l.mat)}${l.catKey ? `<div class="rk-sub" style="font-size:${Math.max(8, f.nome - 2.5)}px">${_rankEsc(DG_VG_CATSUB_LABELS[l.catSubKey] || DG_VG_CAT_LABELS[l.catKey] || l.catKey)}</div>` : ''}</td>
      <td class="rk-num" style="font-size:${f.base}px;color:#06b6d4">${_dgrNowrapNum(fmtKg(l.estIni))}</td>
      <td class="rk-num" style="font-size:${f.base}px;color:#10b981">${_dgrNowrapNum(fmtKg(l.entKg))}</td>
      <td class="rk-num" style="font-size:${f.base}px;color:#f43f5e">${_dgrNowrapNum(fmtKg(l.saiKg))}</td>
      <td class="rk-num" style="font-size:${f.base}px;color:#06b6d4">${_dgrNowrapNum(fmtKg(l.estTeorico))}</td>
      <td class="rk-num" style="font-size:${f.base}px;color:#06b6d4">${_dgrNowrapNum(fmtKg(l.estFim))}</td>
      <td class="rk-num" style="font-size:${f.base}px;color:${_dgrValCor(l.pctVariacao)}">${_dgrNowrapNum(_daFmtPctSigned(l.pctVariacao))}</td>
      <td class="rk-num" style="font-size:${f.base}px">${_dgrNowrapNum(money(l.custoMedio) + '/kg')}</td>
      <td class="rk-num" style="font-size:${f.base}px;color:${_dgrValCor(l.custoAjuste)}">${_dgrNowrapNum(_daFmtMoneySigned(l.custoAjuste))}</td>
    </tr>`).join('');
  const t = dados.total;
  const totalRow = `
    <tr style="font-weight:800;background:rgba(255,255,255,.05)">
      <td class="rk-name" style="font-size:${f.nome}px">Total</td>
      <td class="rk-num" style="font-size:${f.base}px;color:#06b6d4">${_dgrNowrapNum(fmtKg(t.estIni))}</td>
      <td class="rk-num" style="font-size:${f.base}px;color:#10b981">${_dgrNowrapNum(fmtKg(t.entKg))}</td>
      <td class="rk-num" style="font-size:${f.base}px;color:#f43f5e">${_dgrNowrapNum(fmtKg(t.saiKg))}</td>
      <td class="rk-num" style="font-size:${f.base}px;color:#06b6d4">${_dgrNowrapNum(fmtKg(t.estTeorico))}</td>
      <td class="rk-num" style="font-size:${f.base}px;color:#06b6d4">${_dgrNowrapNum(fmtKg(t.estFim))}</td>
      <td class="rk-num" style="font-size:${f.base}px;color:${_dgrValCor(t.pctVariacao)}">${_dgrNowrapNum(_daFmtPctSigned(t.pctVariacao))}</td>
      <td class="rk-num" style="font-size:${f.base}px">${_dgrNowrapNum(money(t.custoMedio) + '/kg')}</td>
      <td class="rk-num" style="font-size:${f.base}px;color:${_dgrValCor(t.custoAjuste)}">${_dgrNowrapNum(_daFmtMoneySigned(t.custoAjuste))}</td>
    </tr>`;
  return `
    <div class="dgr-table-wrap">
      <div class="rk-table-head"><div class="rk-table-head-title">Detalhamento por Material (Grupo SAP)</div><div class="rk-table-head-cap">${dados.linhas.length} materia${dados.linhas.length !== 1 ? 'is' : 'l'}</div></div>
      <table class="rk-table dgr-material-table">
        <thead><tr>
          <th style="width:14%;font-size:${f.header}px">Grupo SAP</th>
          <th style="width:12%;text-align:right;font-size:${f.header}px">Est. Inicial</th>
          <th style="width:12%;text-align:right;font-size:${f.header}px">Entradas</th>
          <th style="width:12%;text-align:right;font-size:${f.header}px">Saídas</th>
          <th style="width:12%;text-align:right;font-size:${f.header}px">Est. Teórico</th>
          <th style="width:12%;text-align:right;font-size:${f.header}px">Est. Final</th>
          <th style="width:8%;text-align:right;font-size:${f.header}px">% Variação</th>
          <th style="width:9%;text-align:right;font-size:${f.header}px">Custo Médio</th>
          <th style="width:9%;text-align:right;font-size:${f.header}px">Custo Ajuste</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot>${totalRow}</tfoot>
      </table>
    </div>`;
}
function _dgrRankingHtml(titulo, colLabel, dados) {
  if (!dados.linhas.length) return '';
  const f = _dgrFontesPorLinhas(dados.linhas.length, 'ranking');
  const rows = dados.linhas.map(l => {
    const imp = _daMaiorImpacto(l);
    const cell = (campo, valor) => imp === campo ? `<strong>${_dgrNowrapNum(_daFmtCountSigned(valor))}</strong>` : _dgrNowrapNum(_daFmtCountSigned(valor));
    return `
    <tr>
      <td class="rk-name" style="font-size:${f.nome}px">${_rankEsc(l.nome)}</td>
      <td class="rk-num" style="font-size:${f.base}px;color:${_dgrValCor(l.caminhoes)}">${cell('caminhoes', l.caminhoes)}</td>
      <td class="rk-num" style="font-size:${f.base}px;color:${_dgrValCor(l.carretas)}">${cell('carretas', l.carretas)}</td>
      <td class="rk-num" style="font-size:${f.base}px;color:${_dgrValCor(l.ibcs)}">${cell('ibcs', l.ibcs)}</td>
      <td class="rk-num" style="font-size:${f.base}px;color:${_dgrValCor(l.pctVariacao)}">${_dgrNowrapNum(_daFmtPctSigned(l.pctVariacao))}</td>
      <td class="rk-num" style="font-size:${f.base}px;color:${_dgrValCor(l.custoTotal)}">${_dgrNowrapNum(_daFmtMoneySigned(l.custoTotal))}</td>
    </tr>`;
  }).join('');
  const t = dados.total;
  const totalRow = `
    <tr style="font-weight:800;background:rgba(255,255,255,.05)">
      <td class="rk-name" style="font-size:${f.nome}px">Total</td>
      <td class="rk-num" style="font-size:${f.base}px;color:${_dgrValCor(t.caminhoes)}">${_dgrNowrapNum(_daFmtCountSigned(t.caminhoes))}</td>
      <td class="rk-num" style="font-size:${f.base}px;color:${_dgrValCor(t.carretas)}">${_dgrNowrapNum(_daFmtCountSigned(t.carretas))}</td>
      <td class="rk-num" style="font-size:${f.base}px;color:${_dgrValCor(t.ibcs)}">${_dgrNowrapNum(_daFmtCountSigned(t.ibcs))}</td>
      <td class="rk-num" style="font-size:${f.base}px;color:${_dgrValCor(t.pctVariacao)}">${_dgrNowrapNum(_daFmtPctSigned(t.pctVariacao))}</td>
      <td class="rk-num" style="font-size:${f.base}px;color:${_dgrValCor(t.custoTotal)}">${_dgrNowrapNum(_daFmtMoneySigned(t.custoTotal))}</td>
    </tr>`;
  return `
    <div class="dgr-table-wrap">
      <div class="rk-table-head"><div class="rk-table-head-title">${_rankEsc(titulo)}</div><div class="rk-table-head-cap">${dados.linhas.length} ${dados.linhas.length !== 1 ? 'itens' : 'item'}</div></div>
      <table class="rk-table dgr-ranking-table">
        <thead><tr>
          <th style="width:26%;font-size:${f.header}px">${_rankEsc(colLabel)}</th>
          <th style="width:13%;text-align:right;font-size:${f.header}px">Caminhões</th>
          <th style="width:13%;text-align:right;font-size:${f.header}px">Carretas</th>
          <th style="width:13%;text-align:right;font-size:${f.header}px">IBCs</th>
          <th style="width:13%;text-align:right;font-size:${f.header}px">Variação</th>
          <th style="width:22%;text-align:right;font-size:${f.header}px">Custo Total</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot>${totalRow}</tfoot>
      </table>
    </div>`;
}
function _dgrBuildDetalhadoAnaliticoHtml(d) {
  const entradasFlat = _daBuildEntradasFlat(d.results);
  const pesoMedio     = _daPesoMedioPorTipo(entradasFlat);
  const tabelaMaterial = _daBuildTabelaMaterial(d.pares);
  const rankRegional  = _daBuildRanking(d.pares, pesoMedio, p => p.regional, d.totalEstTeoricoKpi, k => k === '—' ? 'Sem regional' : k);
  const rankCentral   = _daBuildRanking(d.pares, pesoMedio, p => p.central,  d.totalEstTeoricoKpi);
  const rankMaterial  = _daBuildRanking(d.pares, pesoMedio, p => p.mat,      d.totalEstTeoricoKpi);
  const rankCategoria = _daBuildRanking(
    d.pares, pesoMedio,
    p => p.catKey === 'agregado' ? (p.catSubKey || 'agregado_sem_subcategoria') : p.catKey,
    d.totalEstTeoricoKpi,
    k => DG_VG_CATSUB_LABELS[k] || DG_VG_CAT_LABELS[k] || (k === 'agregado_sem_subcategoria' ? 'Agregado (sem subcategoria)' : k)
  );

  return `
    <div class="dgr-section-title" style="margin-top:26px"><i class="ti ti-table"></i>Detalhado Analítico</div>
    ${_dgrTabelaMaterialHtml(tabelaMaterial)}
    ${_dgrRankingHtml('Ranking de Regionais', 'Regional', rankRegional)}
    ${_dgrRankingHtml('Ranking de Centrais', 'Central', rankCentral)}
    ${_dgrRankingHtml('Ranking de Materiais', 'Material', rankMaterial)}
    ${_dgrRankingHtml('Ranking de Categoria', 'Categoria', rankCategoria)}`;
}

function _dgrEstilos() {
  return `
    .dgr-section-title { font-size:11px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; color:#f87171; margin:0 0 8px; display:flex; align-items:center; gap:8px; }
    .dgr-kpi-secondary { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:8px; }
    .dgr-kpi-card { background:rgba(255,255,255,.045); border:1px solid rgba(255,255,255,.09); border-radius:12px; padding:18px 20px; border-top:3px solid transparent; page-break-inside:avoid; }
    .dgr-kpi-secondary .dgr-kpi-card { padding:12px 16px; border-top:none; }
    .dgr-kpi-card-head { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; margin-bottom:8px; }
    .dgr-kpi-icon { width:30px; height:30px; border-radius:9px; display:flex; align-items:center; justify-content:center; font-size:15px; flex-shrink:0; }
    .dgr-kpi-label { font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8; }
    .dgr-kpi-value { font-family:'JetBrains Mono',monospace; font-size:21px; font-weight:800; color:#fff; }
    .dgr-kpi-secondary .dgr-kpi-value { font-size:18px; }
    .dgr-kpi-unit { font-size:10.5px; color:#64748b; margin-top:4px; font-family:'JetBrains Mono',monospace; }
    .dgr-kpi-divider-row { display:flex; align-items:baseline; gap:7px; margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,.08); }
    .dgr-kpi-pct { font-family:'JetBrains Mono',monospace; font-size:19px; font-weight:800; }
    .dgr-kpi-pct-label { font-size:10px; color:#64748b; }
    /* Card hero "Variação Estoque" — custo em evidência (valor maior),
       saldo em kg abaixo (menor), veículos em blocos grandes por baixo. */
    .dgr-kpi-hero { background:rgba(255,255,255,.045); border:1px solid rgba(255,255,255,.09); border-radius:12px; padding:15px 22px; border-top:3px solid transparent; page-break-inside:avoid; }
    .dgr-kpi-hero-custo { font-family:'JetBrains Mono',monospace; font-size:27px; font-weight:800; }
    .dgr-kpi-hero-saldo { font-family:'JetBrains Mono',monospace; font-size:19px; font-weight:700; }
    /* Linha do saldo (agora em toneladas) + veículos lado a lado — sem
       selo/ícone (só número + rótulo pequeno), discretos, ao lado do
       saldo em vez de embaixo numa grade grande — pedido do Hugo pra
       corrigir o desbalanceamento do card hero. */
    .dgr-kpi-hero-saldo-row { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:20px; margin-top:12px; padding-top:12px; border-top:1px solid rgba(255,255,255,.08); }
    .dgr-kpi-veiculos-simples { display:flex; gap:28px; flex-wrap:wrap; }
    .dgr-kpi-veiculo-simples { text-align:center; }
    .dgr-kpi-veiculo-simples-valor { font-family:'JetBrains Mono',monospace; font-size:15px; font-weight:800; }
    .dgr-kpi-veiculo-simples-label { font-size:9px; color:#64748b; text-transform:uppercase; letter-spacing:.05em; font-weight:700; margin-top:2px; }
    .dgr-health-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
    .dgr-health-card { background:rgba(255,255,255,.045); border:1px solid rgba(255,255,255,.09); border-radius:12px; padding:18px; page-break-inside:avoid; }
    .dgr-health-card img { max-width:100%; height:auto; display:block; margin:0 auto; }
    .dgr-health-title { font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; color:#e2e8f0; margin-bottom:10px; display:flex; align-items:center; gap:6px; }
    .dgr-health-summary { display:flex; flex-wrap:wrap; gap:6px; justify-content:center; margin-top:10px; }
    .dgr-chart-card { background:rgba(255,255,255,.045); border:1px solid rgba(255,255,255,.09); border-radius:12px; padding:16px 18px; page-break-inside:avoid; }
    .dgr-chart-card img { max-width:100%; height:auto; display:block; margin:0 auto; }
    .dgr-chart-title { font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; color:#e2e8f0; margin-bottom:12px; display:flex; align-items:center; gap:6px; }
    .dgr-chart-empty { padding:40px 0; color:#64748b; font-size:11px; text-align:center; }
    .dgr-chart-grid { display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-top:14px; }
    .dgr-extremos-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin-bottom:4px; }
    .dgr-extremo-box { background:rgba(255,255,255,.045); border:1px solid rgba(255,255,255,.09); border-radius:12px; padding:12px 14px; page-break-inside:avoid; }
    .dgr-extremo-label { font-size:9px; font-family:'JetBrains Mono',monospace; letter-spacing:.05em; text-transform:uppercase; color:#64748b; margin-bottom:5px; }
    .dgr-extremo-value { font-size:16px; font-weight:700; font-family:'JetBrains Mono',monospace; letter-spacing:-.02em; margin-bottom:3px; }
    .dgr-extremo-kg { font-size:9.5px; font-family:'JetBrains Mono',monospace; color:#64748b; margin-bottom:5px; }
    .dgr-extremo-name { font-size:11px; color:#cbd5e1; font-weight:600; }
    .dgr-grupo-layout { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
    .dgr-donut-grande img { max-width:100%; height:auto; }
    .dgr-donut-sub-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    .dgr-donut-small .dgr-chart-title { margin-bottom:8px; }
    .dgr-table-wrap {
      margin-bottom:26px;
      background:rgba(255,255,255,.045);
      border:1px solid rgba(255,255,255,.09);
      border-radius:12px;
      padding:16px 18px;
    }
    .dgr-table-wrap thead { display:table-header-group; }
    .dgr-table-wrap tbody tr { page-break-inside:avoid; }
    .dgr-table-wrap .rk-table { table-layout:fixed; }
    .dgr-table-wrap tbody tr:nth-child(even) { background:rgba(255,255,255,.025); }
    .dgr-chart-card table.rk-table tbody tr:nth-child(even) { background:rgba(255,255,255,.025); }
    /* Mais respiro nas células — escopado a .dgr-chart-card/.dgr-table-wrap
       (Giro & Cobertura + Detalhado Analítico) pra não alterar .rk-table
       nos outros relatórios do sistema (Ocorrências, Ranking etc.), que
       usam a densidade padrão do shell. */
    .dgr-chart-card .rk-table th, .dgr-table-wrap .rk-table th { padding:9px 3px; font-size:8.2px; }
    .dgr-chart-card .rk-table td, .dgr-table-wrap .rk-table td { padding:10px 3px; line-height:1.4; overflow-wrap:break-word; font-size:8.2px; }
    /* Coluna de nome (1ª coluna) é a única que pode quebrar em várias
       linhas — mantém uma fonte um pouco maior, mais legível, já que ela
       tem a largura reservada pra isso. As demais colunas (números) usam
       a fonte reduzida acima pra caber numa linha só sem vazar pra célula
       vizinha. */
    .dgr-table-wrap .rk-name, .dgr-chart-card .rk-name { font-size:10px !important; }
    .dgr-table-wrap .rk-name { line-height:1.4; }
    /* Corte de texto do nome — num span INTERNO ao td (não no td em si),
       com max-width:100% do pai. O td continua um table-cell normal,
       respeitando a largura em % que table-layout:fixed calculou; um
       display:inline-block com max-width fixo direto no td (versão
       anterior) não respeitava essa largura de forma confiável e deixava
       o texto vazar visualmente pra célula vizinha. */
    .dgr-nome-trunc-inner { display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; }
    .dgr-chart-card table.rk-table { table-layout:fixed; }
    .dgr-giro-footer { display:flex; gap:14px; padding:8px 0 0; margin-top:8px; border-top:1px solid rgba(255,255,255,.08); flex-wrap:wrap; font-size:9px; font-family:'JetBrains Mono',monospace; font-weight:700; }
    .dgr-giro-footer span { display:flex; align-items:center; gap:4px; }
    /* Colapso dos pares de card (Giro, gráficos de barra) e das grades de
       3 colunas — SEMPRE ao imprimir/gerar PDF, não só condicional a
       largura. Medi e confirmei: @media(max-width) é avaliado contra a
       largura da JANELA do navegador, não da página impressa — numa
       janela larga a condição nunca dispara mesmo a página final saindo
       estreita (retrato), o que já causou tabelas do Giro espremidas a
       ponto de virar ilegíveis. Como as classes dgr-* só existem neste
       relatório, é seguro deixar incondicional no papel. A condição por
       largura continua valendo também, só como bônus pra quem visualizar
       o HTML numa janela estreita antes de imprimir. */
    @media print, (max-width:900px) {
      .dgr-kpi-secondary, .dgr-health-grid, .dgr-grupo-layout, .dgr-donut-sub-grid { grid-template-columns:repeat(2,1fr); }
      .dgr-chart-grid { grid-template-columns:1fr; }
    }
    @media print { .dgr-kpi-card, .dgr-health-card, .dgr-chart-card, .dgr-extremo-box { page-break-inside:avoid; } }`;
}

window.gerarRelatorioGerencialDashboard = async function() {
  const d = window._dgVgLastData;
  if (!d) {
    toast('Analise um período no Dashboard Gerencial antes de gerar o relatório.', 'error');
    return;
  }

  const btn = document.getElementById('dg-btn-relatorio-gerencial');
  if (btn?.disabled) return;
  if (typeof _setBtnLoading === 'function') _setBtnLoading(btn, true, 'Gerando...');
  if (typeof showLoadingOverlay === 'function') showLoadingOverlay('Gerando relatório', 'Capturando gráficos e montando o PDF...');

  try {
    const now = new Date().toLocaleString('pt-BR');
    const periodo = (d.dtIni && d.dtFim)
      ? `${d.dtIni.toLocaleDateString('pt-BR')} a ${d.dtFim.toLocaleDateString('pt-BR')}`
      : 'Período completo';

    const [imgGaugeCentral, imgGaugeMateriais] = await Promise.all([
      _dgrSvgParaPngDataUrl(document.getElementById('dg-vg-gauge-central-svg')),
      _dgrSvgParaPngDataUrl(document.getElementById('dg-vg-gauge-chart-svg'))
    ]);
    const imgCategoria = _dgrCanvasParaPngDataUrl('dg-vg-chart-categoria');
    const imgRegional  = _dgrCanvasParaPngDataUrl('dg-vg-chart-regional');
    const imgUsina     = _dgrCanvasParaPngDataUrl('dg-vg-chart-usina');

    const bodyHtml = `<style>${_dgrEstilos()}</style>`
      + _dgrBuildResumoPeriodoHtml(d)
      + _dgrBuildCustoRegionalCentralHtml(d, imgRegional, imgUsina)
      + _dgrBuildSaudeGeralHtml(imgGaugeCentral, imgGaugeMateriais)
      + _dgrBuildCategoriaHtml(imgCategoria)
      + _dgrBuildGiroCoberturaHtml(d)
      + _dgrBuildDetalhadoAnaliticoHtml(d);

    const html = _buildRankingShellHTML({
      periodoBadge: periodo,
      periodo,
      now,
      kpis: []
    }, {
      pageOrientation: 'livre',
      pageTitle:  'Relatório Gerencial — Dashboard Gerencial',
      badge:      'Relatório Gerencial',
      title:      'Visão Geral — Dashboard Gerencial',
      subtitle:   'Resumo executivo de estoque, movimentação, variação e saúde geral do período selecionado.',
      bodyHtml,
      notaRodape: 'Variação e Custo Var. desconsideram Ajustes de Fechamento Mensal não reincluídos manualmente. Saúde Geral considera os limiares configurados em Configurações → Parâmetros.'
    });

    _openRelWindow(html);
  } catch (err) {
    console.error('[Relatório Gerencial - Dashboard] Falha ao gerar:', err);
    toast('Falha ao gerar o relatório. Veja o console para detalhes.', 'error');
  } finally {
    if (typeof _setBtnLoading === 'function') _setBtnLoading(btn, false);
    if (typeof hideLoadingOverlay === 'function') hideLoadingOverlay();
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// RELATÓRIO DE COBRANÇA POR REGIONAL — ocorrências abertas/urgentes/vencidas
// ordenadas por prioridade crítica, com filtro por regional (mesmo shell escuro
// dos relatórios de Ranking/Ausência: _buildRankingShellHTML)
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
  function buildTempoCell(o) {
    const st = ocStatus(o);
    const diasAberto = diffDays(o.dataAbertura, nowISO);
    const abertoStr = diasAberto !== null ? diasAberto+'d' : '—';

    if (st === 'vencida') {
      const diasVencido = diffDays(o.dataLimite, nowISO);
      return `<div class="oc-tempo"><span class="oc-tempo-main" style="color:#f87171">⚠ ${diasVencido}d vencido</span><span class="oc-tempo-sub">aberto há ${abertoStr}</span></div>`;
    }
    if (st === 'urgente') {
      const diasRestam = diffDays(nowISO, o.dataLimite);
      return `<div class="oc-tempo"><span class="oc-tempo-main" style="color:#fbbf24">🔔 ${diasRestam}d p/ vencer</span><span class="oc-tempo-sub">aberto há ${abertoStr}</span></div>`;
    }
    const diasRestam = o.dataLimite ? diffDays(nowISO, o.dataLimite) : null;
    return `<div class="oc-tempo">${diasRestam !== null
        ? `<span class="oc-tempo-main" style="color:#a5b4fc">${diasRestam}d restantes</span>`
        : `<span style="font-size:10.5px;color:#64748b">Sem prazo</span>`}<span class="oc-tempo-sub">aberto há ${abertoStr}</span></div>`;
  }

  function buildStatusBadge(st) {
    const cfg = {
      vencida: { cls:'oc-status-vencida', label:'VENCIDA'   },
      urgente: { cls:'oc-status-urgente', label:'URGENTE'   },
      normal:  { cls:'oc-status-normal',  label:'EM ABERTO' },
    };
    const c = cfg[st] || cfg.normal;
    return `<span class="oc-status ${c.cls}">${c.label}</span>`;
  }

  function buildOcorrenciaRow(o, idx) {
    const st = ocStatus(o);
    const leftColor = st==='vencida' ? '#ef4444' : st==='urgente' ? '#f59e0b' : 'rgba(255,255,255,.12)';
    const rowBg     = st==='vencida' ? 'rgba(239,68,68,.05)' : st==='urgente' ? 'rgba(245,158,11,.05)' : 'transparent';

    return `
    <tr style="background:${rowBg};box-shadow:inset 3px 0 0 ${leftColor}">
      <td class="rk-num" style="color:#64748b;font-size:10px">${idx+1}</td>
      <td>${buildStatusBadge(st)}</td>
      <td>
        <div style="font-weight:700;font-size:11.5px;color:#f1f5f9;font-family:'JetBrains Mono',monospace">${escR(o.id)}</div>
        ${o.motivo ? `<div style="font-size:9.5px;color:#64748b;margin-top:2px">${escR(o.motivo)}</div>` : ''}
      </td>
      <td class="rk-name" style="font-size:12px">${escR(o.central||'—')}</td>
      <td style="font-size:11.5px;color:#cbd5e1">${escR(o.material||'—')}</td>
      <td style="font-size:10.5px;color:#94a3b8">
        <div>${fmtBR(o.dataAbertura)}</div>
        ${o.dataLimite ? `<div style="color:${st==='vencida'?'#f87171':st==='urgente'?'#fbbf24':'#64748b'};font-size:9.5px;margin-top:2px">prazo: ${fmtBR(o.dataLimite)}</div>` : ''}
      </td>
      <td>${buildTempoCell(o)}</td>
      <td style="font-size:11.5px;color:#cbd5e1;max-width:240px">
        <div style="overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.4">${escR(o.descricao||'—')}</div>
      </td>
      <td style="font-size:10.5px;color:#94a3b8">
        <div>${escR(o.operador||'—')}</div>
        ${o.contato ? `<div style="color:#64748b;margin-top:2px">${escR(o.contato)}</div>` : ''}
      </td>
    </tr>`;
  }

  function buildCentralSection(centralNome, ocorrencias) {
    const venc = ocorrencias.filter(o => ocStatus(o)==='vencida').length;
    const urg  = ocorrencias.filter(o => ocStatus(o)==='urgente').length;
    const norm = ocorrencias.filter(o => ocStatus(o)==='normal').length;
    const piorSt = venc > 0 ? 'vencida' : urg > 0 ? 'urgente' : 'normal';
    const accent = piorSt==='vencida' ? '#ef4444' : piorSt==='urgente' ? '#f59e0b' : '#64748b';

    const badges = [
      venc > 0 ? `<span class="oc-mini-badge" style="color:#fca5a5">🔴 ${venc} vencida${venc!==1?'s':''}</span>` : '',
      urg  > 0 ? `<span class="oc-mini-badge" style="color:#fde68a">🟡 ${urg} urgente${urg!==1?'s':''}</span>` : '',
      norm > 0 ? `<span class="oc-mini-badge" style="color:#93c5fd">🔵 ${norm} em aberto</span>` : '',
    ].filter(Boolean).join(' ');

    return `
    <div class="oc-central-block">
      <div class="oc-central-hdr" style="background:rgba(255,255,255,.035);border-bottom:1px solid rgba(255,255,255,.08)">
        <div class="oc-central-hdr-left">
          <span style="width:5px;height:22px;border-radius:3px;background:${accent};flex-shrink:0;display:inline-block"></span>
          <span class="oc-central-name">${escR(centralNome)}</span>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${badges}</div>
      </div>
      <table class="rk-table">
        <thead>
          <tr>
            <th style="width:26px">#</th><th style="width:82px">Status</th><th style="width:88px">ID / Motivo</th>
            <th>Central</th><th>Material</th><th style="width:100px">Datas</th>
            <th style="width:125px">Prazo / Tempo</th><th>Descrição</th><th style="width:105px">Responsável</th>
          </tr>
        </thead>
        <tbody>${ocorrencias.map(buildOcorrenciaRow).join('')}</tbody>
      </table>
    </div>`;
  }

  function buildRegionalSection([regNome, centrais]) {
    const todasOc  = Object.values(centrais).flat();
    const regVenc  = todasOc.filter(o => ocStatus(o)==='vencida').length;
    const regUrg   = todasOc.filter(o => ocStatus(o)==='urgente').length;
    const regNorm  = todasOc.filter(o => ocStatus(o)==='normal').length;
    const regTotal = todasOc.length;
    const piorSt   = regVenc > 0 ? 'vencida' : regUrg > 0 ? 'urgente' : 'normal';
    const regBg    = piorSt==='vencida'
      ? 'linear-gradient(135deg,#7f1d1d 0%,#991b1b 60%,#b91c1c 100%)'
      : piorSt==='urgente'
      ? 'linear-gradient(135deg,#78350f 0%,#92400e 60%,#b45309 100%)'
      : 'linear-gradient(135deg,#1e3a5f 0%,#1e40af 60%,#2563eb 100%)';

    const centraisOrdenadas = Object.entries(centrais).sort((a, b) => {
      const sv = x => x.filter(o => ocStatus(o)==='vencida').length;
      const su = x => x.filter(o => ocStatus(o)==='urgente').length;
      return (sv(b[1])*100 + su(b[1])) - (sv(a[1])*100 + su(a[1]));
    });

    return `
    <div class="oc-regional-section">
      <div class="oc-regional-hdr" style="background:${regBg}">
        <div style="display:flex;align-items:center;gap:14px;position:relative">
          <div class="oc-regional-icon"><i class="ti ti-map-2"></i></div>
          <div>
            <div class="oc-regional-name">${escR(regNome)}</div>
            <div class="oc-regional-sub">${centraisOrdenadas.length} ${centraisOrdenadas.length!==1?'centrais':'central'} · ${regTotal} ocorrência${regTotal!==1?'s':''}</div>
          </div>
        </div>
        <div class="oc-regional-stats">
          <div class="oc-regional-stat"><strong style="color:#fca5a5">${regVenc}</strong><span>Vencidas</span></div>
          <div class="oc-regional-stat-sep"></div>
          <div class="oc-regional-stat"><strong style="color:#fde68a">${regUrg}</strong><span>Urgentes</span></div>
          <div class="oc-regional-stat-sep"></div>
          <div class="oc-regional-stat"><strong style="color:#bfdbfe">${regNorm}</strong><span>Em Aberto</span></div>
        </div>
      </div>
      <div class="oc-regional-body">
        ${centraisOrdenadas.map(([cn, ocs]) => buildCentralSection(cn, ocs)).join('')}
      </div>
    </div>`;
  }

  // ── bodyHtml ──────────────────────────────────────────────────────────────────
  const tituloFiltro = regionalFiltro ? ` — ${regionalFiltro}` : ' — Todos os Regionais';

  const bodyHtml = `
    <style>
      .oc-status { display:inline-block; padding:3px 9px; border-radius:12px; font-size:9.5px; font-weight:800; letter-spacing:.05em; white-space:nowrap; }
      .oc-status-vencida { background:rgba(239,68,68,.15); color:#fca5a5; border:1px solid rgba(239,68,68,.4); }
      .oc-status-urgente { background:rgba(245,158,11,.15); color:#fde68a; border:1px solid rgba(245,158,11,.4); }
      .oc-status-normal  { background:rgba(59,130,246,.15); color:#93c5fd; border:1px solid rgba(59,130,246,.4); }

      .oc-tempo { display:flex; flex-direction:column; gap:3px; }
      .oc-tempo-main { font-size:10.5px; font-family:'JetBrains Mono',monospace; font-weight:800; white-space:nowrap; }
      .oc-tempo-sub { font-size:9.5px; color:#64748b; font-family:'JetBrains Mono',monospace; white-space:nowrap; }

      .oc-regional-section { margin-bottom:26px; }
      .oc-regional-section:last-child { margin-bottom:0; }
      .oc-regional-hdr { border-radius:12px 12px 0 0; padding:16px 22px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; position:relative; overflow:hidden; }
      .oc-regional-hdr::before { content:''; position:absolute; right:-20px; top:-20px; width:100px; height:100px; border-radius:50%; background:rgba(255,255,255,.06); pointer-events:none; }
      .oc-regional-icon { width:38px; height:38px; border-radius:9px; background:rgba(255,255,255,.15); border:1px solid rgba(255,255,255,.25); display:flex; align-items:center; justify-content:center; flex-shrink:0; }
      .oc-regional-icon i { color:#fff; font-size:17px; }
      .oc-regional-name { font-size:16px; font-weight:900; color:#fff; letter-spacing:-.01em; }
      .oc-regional-sub { font-size:10.5px; color:rgba(255,255,255,.62); margin-top:2px; }
      .oc-regional-stats { display:flex; align-items:center; position:relative; }
      .oc-regional-stat { text-align:center; padding:0 16px; }
      .oc-regional-stat strong { display:block; font-size:22px; font-weight:800; font-family:'JetBrains Mono',monospace; line-height:1; }
      .oc-regional-stat span { font-size:9px; text-transform:uppercase; letter-spacing:.05em; color:rgba(255,255,255,.6); font-weight:700; margin-top:3px; display:block; }
      .oc-regional-stat-sep { width:1px; height:34px; background:rgba(255,255,255,.2); }
      .oc-regional-body { background:rgba(255,255,255,.025); border:1px solid rgba(255,255,255,.09); border-top:none; border-radius:0 0 12px 12px; padding:14px; }

      .oc-central-block { margin-bottom:14px; border-radius:10px; overflow:hidden; border:1px solid rgba(255,255,255,.09); page-break-inside:avoid; }
      .oc-central-block:last-child { margin-bottom:0; }
      .oc-central-hdr { padding:10px 16px; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
      .oc-central-hdr-left { display:flex; align-items:center; gap:10px; }
      .oc-central-name { font-size:13px; font-weight:800; color:#fff; }
      .oc-mini-badge { padding:2px 8px; border-radius:10px; font-size:9px; font-weight:700; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12); }
    </style>

    <div class="rk-table-head" style="margin-bottom:16px">
      <div class="rk-table-head-title">${escR(regionalFiltro ? regionalFiltro : 'Todos os Regionais')}</div>
      <div class="rk-table-head-cap">ocorrências em aberto por prioridade</div>
    </div>

    ${regionaisOrdenados.map(buildRegionalSection).join('')}`;

  const d = {
    periodoBadge: now.split(' ')[0],
    periodo: 'Ocorrências em aberto',
    now,
    kpis: [
      { value: totalAberto,  label: 'total em aberto', color: '#94a3b8' },
      { value: totalVencido, label: 'vencidas',        color: '#ef4444' },
      { value: totalUrgente, label: 'urgentes',        color: '#f59e0b' },
      { value: totalNormal,  label: 'em prazo',        color: '#3b82f6' }
    ]
  };

  const html = _buildRankingShellHTML(d, {
    pageTitle:  `Relatório de Cobrança por Regional${tituloFiltro}`,
    badge:      'Cobrança de Pendências',
    title:      'Cobrança Regional — Ocorrências em Aberto',
    subtitle:   `Ocorrências em aberto ordenadas por prioridade crítica${regionalFiltro ? ' · ' + escR(regionalFiltro) : ', agrupadas por regional e central'}.`,
    bodyHtml,
    notaRodape: 'Vencida: prazo expirado. Urgente: vence em até 2 dias. Regionais e centrais ordenados por quantidade de ocorrências vencidas/urgentes.'
  });

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
// (mesmo shell escuro dos relatórios de Ranking/Ausência: _buildRankingShellHTML)
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

  const abertas = centralFiltro
    ? todasAbertas.filter(o => (o.central || '—') === centralFiltro)
    : todasAbertas;

  if (!abertas.length) {
    alert(`Nenhuma ocorrência em aberto para a central "${centralFiltro}".`);
    return;
  }

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

  // ── Célula de tempo ──────────────────────────────────────────────────────────
  function buildTempoCell(o) {
    const st = ocStatus(o);
    const diasAberto = diffDays(o.dataAbertura, nowISO);
    const abertoStr  = diasAberto !== null ? diasAberto+'d' : '—';

    if (st === 'vencida') {
      const diasVencido = diffDays(o.dataLimite, nowISO);
      return `<div class="oc-tempo"><span class="oc-tempo-chip" style="background:rgba(239,68,68,.14);border:1px solid rgba(239,68,68,.4);color:#fca5a5">⚠ ${diasVencido}d vencido</span><span class="oc-tempo-sub">em aberto há ${abertoStr}</span></div>`;
    }
    if (st === 'urgente') {
      const diasRestam = diffDays(nowISO, o.dataLimite);
      return `<div class="oc-tempo"><span class="oc-tempo-chip" style="background:rgba(245,158,11,.14);border:1px solid rgba(245,158,11,.4);color:#fde68a">🔔 ${diasRestam}d p/ vencer</span><span class="oc-tempo-sub">em aberto há ${abertoStr}</span></div>`;
    }
    const diasRestam = o.dataLimite ? diffDays(nowISO, o.dataLimite) : null;
    return `<div class="oc-tempo">${diasRestam !== null
        ? `<span class="oc-tempo-chip" style="background:rgba(59,130,246,.14);border:1px solid rgba(59,130,246,.35);color:#93c5fd">📅 ${diasRestam}d restantes</span>`
        : `<span style="font-size:10.5px;color:#64748b">Sem prazo</span>`}<span class="oc-tempo-sub">em aberto há ${abertoStr}</span></div>`;
  }

  function buildStatusBadge(st) {
    const cfg = {
      vencida: { cls:'oc-status-vencida', label:'VENCIDA'   },
      urgente: { cls:'oc-status-urgente', label:'URGENTE'   },
      normal:  { cls:'oc-status-normal',  label:'EM ABERTO' },
    };
    const c = cfg[st] || cfg.normal;
    return `<span class="oc-status ${c.cls}">${c.label}</span>`;
  }

  function buildOcorrenciaRow(o, idx) {
    const st = ocStatus(o);
    const leftColor = st==='vencida' ? '#ef4444' : st==='urgente' ? '#f59e0b' : 'rgba(255,255,255,.12)';
    const rowBg     = st==='vencida' ? 'rgba(239,68,68,.05)' : st==='urgente' ? 'rgba(245,158,11,.05)' : 'transparent';

    return `
    <tr style="background:${rowBg};box-shadow:inset 3px 0 0 ${leftColor}">
      <td class="rk-num" style="color:#64748b;font-size:10px">${idx+1}</td>
      <td>${buildStatusBadge(st)}</td>
      <td>
        <div style="font-weight:700;font-size:11.5px;color:#f1f5f9;font-family:'JetBrains Mono',monospace">${escR(o.id)}</div>
        ${o.motivo ? `<div style="font-size:9.5px;color:#64748b;margin-top:1px">${escR(o.motivo)}</div>` : ''}
      </td>
      <td style="font-size:11.5px;color:#cbd5e1">${escR(o.material||'—')}</td>
      <td style="font-size:10.5px;color:#94a3b8">
        <div>${fmtBR(o.dataAbertura)}</div>
        ${o.dataLimite ? `<div style="color:${st==='vencida'?'#f87171':st==='urgente'?'#fbbf24':'#64748b'};font-size:9.5px;margin-top:1px">prazo: ${fmtBR(o.dataLimite)}</div>` : ''}
      </td>
      <td>${buildTempoCell(o)}</td>
      <td style="font-size:11.5px;color:#cbd5e1;max-width:220px">
        <div style="overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.4">${escR(o.descricao||'—')}</div>
      </td>
      <td style="font-size:10.5px;color:#94a3b8">
        <div>${escR(o.operador||'—')}</div>
        ${o.contato ? `<div style="color:#64748b;font-size:9.5px;margin-top:1px">${escR(o.contato)}</div>` : ''}
      </td>
    </tr>`;
  }

  function buildCentralSection([centralNome, ocorrencias], idx) {
    const venc = ocorrencias.filter(o => ocStatus(o)==='vencida').length;
    const urg  = ocorrencias.filter(o => ocStatus(o)==='urgente').length;
    const norm = ocorrencias.filter(o => ocStatus(o)==='normal').length;
    const reg  = getRegional(centralNome);
    const piorSt = venc > 0 ? 'vencida' : urg > 0 ? 'urgente' : 'normal';
    const hdrGrad = piorSt==='vencida'
      ? 'linear-gradient(135deg,#7f1d1d 0%,#991b1b 60%,#b91c1c 100%)'
      : piorSt==='urgente'
      ? 'linear-gradient(135deg,#78350f 0%,#92400e 60%,#b45309 100%)'
      : 'linear-gradient(135deg,#1e3a5f 0%,#1e40af 60%,#2563eb 100%)';

    const badges = [
      venc > 0 ? `<span class="oc-mini-badge" style="color:#fca5a5">🔴 ${venc} vencida${venc!==1?'s':''}</span>` : '',
      urg  > 0 ? `<span class="oc-mini-badge" style="color:#fde68a">🟡 ${urg} urgente${urg!==1?'s':''}</span>` : '',
      norm > 0 ? `<span class="oc-mini-badge" style="color:#bfdbfe">🔵 ${norm} em aberto</span>` : '',
    ].filter(Boolean).join(' ');

    return `
    <div class="oc-central-card" id="oc-central-${idx}">
      <div class="oc-central-card-hdr" style="background:${hdrGrad}">
        <div style="display:flex;align-items:center;gap:10px;position:relative">
          <div class="oc-central-num">${idx+1}</div>
          <div>
            <div class="oc-central-card-name">${escR(centralNome)}</div>
            <div class="oc-central-card-sub">${escR(reg)} · ${ocorrencias.length} ocorrência${ocorrencias.length!==1?'s':''}</div>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;position:relative">${badges}</div>
      </div>
      <table class="rk-table">
        <thead>
          <tr>
            <th style="width:26px">#</th><th style="width:82px">Status</th><th style="width:88px">ID / Motivo</th>
            <th>Material</th><th style="width:95px">Datas</th><th style="width:135px">Prazo / Tempo</th>
            <th>Descrição</th><th style="width:100px">Responsável</th>
          </tr>
        </thead>
        <tbody>${ocorrencias.map(buildOcorrenciaRow).join('')}</tbody>
      </table>
    </div>`;
  }

  function buildSumario() {
    return centraisOrdenadas.slice(0, 20).map(([cn, ocs], idx) => {
      const venc = ocs.filter(o => ocStatus(o)==='vencida').length;
      const urg  = ocs.filter(o => ocStatus(o)==='urgente').length;
      const total = ocs.length;
      const cor  = venc > 0 ? '#f87171' : urg > 0 ? '#fbbf24' : '#93c5fd';
      const barW = Math.round(total / (centraisOrdenadas[0][1].length || 1) * 100);
      return `
      <a href="#oc-central-${idx}" class="oc-sumario-item">
        <span class="oc-sumario-idx">${idx+1}</span>
        <div style="flex:1;min-width:0">
          <div class="oc-sumario-name">${escR(cn)}</div>
          <div style="display:flex;align-items:center;gap:5px;margin-top:3px">
            <div class="oc-bar-track"><div class="oc-bar-fill" style="width:${barW}%;background:${cor}"></div></div>
            <span style="font-size:9.5px;font-family:'JetBrains Mono',monospace;color:#64748b;min-width:18px;text-align:right">${total}</span>
          </div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          ${venc>0 ? `<span class="oc-sumario-tag" style="color:#fca5a5">${venc}</span>` : ''}
          ${urg>0  ? `<span class="oc-sumario-tag" style="color:#fde68a">${urg}</span>`  : ''}
        </div>
      </a>`;
    }).join('');
  }

  // ── bodyHtml ──────────────────────────────────────────────────────────────────
  const bodyHtml = `
    <style>
      .oc-status { display:inline-block; padding:3px 9px; border-radius:12px; font-size:9.5px; font-weight:800; letter-spacing:.05em; white-space:nowrap; }
      .oc-status-vencida { background:rgba(239,68,68,.15); color:#fca5a5; border:1px solid rgba(239,68,68,.4); }
      .oc-status-urgente { background:rgba(245,158,11,.15); color:#fde68a; border:1px solid rgba(245,158,11,.4); }
      .oc-status-normal  { background:rgba(59,130,246,.15); color:#93c5fd; border:1px solid rgba(59,130,246,.4); }

      .oc-tempo { display:flex; flex-direction:column; gap:4px; }
      .oc-tempo-chip { display:inline-flex; align-items:center; gap:4px; padding:3px 8px; border-radius:6px; font-size:10.5px; font-family:'JetBrains Mono',monospace; font-weight:800; white-space:nowrap; width:fit-content; }
      .oc-tempo-sub { font-size:9.5px; color:#64748b; font-family:'JetBrains Mono',monospace; white-space:nowrap; padding-left:2px; }

      .oc-mini-badge { padding:2px 8px; border-radius:10px; font-size:9px; font-weight:700; background:rgba(255,255,255,.13); border:1px solid rgba(255,255,255,.2); }

      .oc-central-card { margin-bottom:16px; border-radius:10px; overflow:hidden; border:1px solid rgba(255,255,255,.09); page-break-inside:avoid; }
      .oc-central-card:last-child { margin-bottom:0; }
      .oc-central-card-hdr { padding:12px 18px; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
      .oc-central-num { width:26px; height:26px; border-radius:7px; background:rgba(255,255,255,.15); border:1px solid rgba(255,255,255,.22); display:flex; align-items:center; justify-content:center; font-size:11.5px; font-weight:800; color:#fff; font-family:'JetBrains Mono',monospace; flex-shrink:0; }
      .oc-central-card-name { font-size:14px; font-weight:800; color:#fff; letter-spacing:-.01em; }
      .oc-central-card-sub { font-size:10px; color:rgba(255,255,255,.6); margin-top:1px; }

      .oc-layout { display:grid; grid-template-columns:220px 1fr; gap:22px; align-items:start; }
      .oc-sumario-col { position:sticky; top:78px; background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.09); border-radius:10px; overflow:hidden; }
      .oc-sumario-hdr { background:rgba(255,255,255,.04); border-bottom:1px solid rgba(255,255,255,.08); padding:10px 14px; font-size:10.5px; font-weight:800; color:#94a3b8; text-transform:uppercase; letter-spacing:.06em; }
      .oc-sumario-body { padding:4px 12px 10px; max-height:calc(100vh - 140px); overflow-y:auto; }
      .oc-sumario-item { display:flex; align-items:center; gap:9px; padding:7px 0; border-bottom:1px solid rgba(255,255,255,.06); text-decoration:none; }
      .oc-sumario-item:last-child { border-bottom:none; }
      .oc-sumario-idx { font-size:9.5px; font-family:'JetBrains Mono',monospace; color:#64748b; min-width:16px; font-weight:700; }
      .oc-sumario-name { font-size:11px; font-weight:700; color:#e2e8f0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .oc-sumario-tag { padding:1px 6px; border-radius:8px; font-size:8.5px; font-weight:800; background:rgba(255,255,255,.08); }
      .oc-bar-track { flex:1; height:4px; background:rgba(255,255,255,.09); border-radius:2px; overflow:hidden; }
      .oc-bar-fill { height:100%; border-radius:2px; }

      @media (max-width:900px) { .oc-layout { grid-template-columns:1fr; } .oc-sumario-col { position:static; } }
      @media print { .oc-sumario-col { display:none; } .oc-layout { display:block; } }
    </style>

    <div class="oc-layout">
      <div class="oc-sumario-col">
        <div class="oc-sumario-hdr"><i class="ti ti-list-details"></i> Índice de Centrais</div>
        <div class="oc-sumario-body">
          ${buildSumario()}
          ${centraisOrdenadas.length > 20 ? `<div style="padding:8px 0;font-size:9.5px;color:#64748b;font-style:italic">+ ${centraisOrdenadas.length - 20} centrais adicionais</div>` : ''}
        </div>
      </div>
      <div>
        <div class="rk-table-head" style="margin-bottom:14px">
          <div class="rk-table-head-title">${totalCentral} Centra${totalCentral!==1?'is':'l'}</div>
          <div class="rk-table-head-cap">ocorrências em aberto por prioridade</div>
        </div>
        ${centraisOrdenadas.map(buildCentralSection).join('')}
      </div>
    </div>`;

  const d = {
    periodoBadge: now.split(' ')[0],
    periodo: 'Ocorrências em aberto',
    now,
    kpis: [
      { value: totalAberto,  label: 'total em aberto', color: '#94a3b8' },
      { value: totalVencido, label: 'vencidas',        color: '#ef4444' },
      { value: totalUrgente, label: 'urgentes',        color: '#f59e0b' },
      { value: totalNormal,  label: 'em prazo',        color: '#3b82f6' }
    ]
  };

  const html = _buildRankingShellHTML(d, {
    pageTitle:  'Relatório de Cobrança Geral por Central',
    badge:      'Cobrança de Pendências',
    title:      'Cobrança por Central — Ocorrências em Aberto',
    subtitle:   `Ocorrências em aberto agrupadas por central, ordenadas por criticidade${centralFiltro ? ' · ' + escR(centralFiltro) : ''}.`,
    bodyHtml,
    notaRodape: 'Vencida: prazo expirado. Urgente: vence em até 2 dias. Centrais ordenadas por quantidade de ocorrências vencidas/urgentes.'
  });

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
