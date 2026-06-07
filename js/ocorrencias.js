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
  const total     = lista.length;
  const concluidas = lista.filter(o => o.concluida).length;
  const abertas    = total - concluidas;
  const vencidas   = lista.filter(o => !o.concluida && ocDateStatus(o.dataLimite) === 'vencida').length;
  const urgentes   = lista.filter(o => !o.concluida && ocDateStatus(o.dataLimite) === 'urgente').length;
  const pctConc    = total > 0 ? Math.round(concluidas / total * 100) : 0;

  // Contagem por central
  const porCentral = {};
  lista.forEach(o => {
    const c = o.central || '—';
    porCentral[c] = (porCentral[c] || 0) + 1;
  });
  const topCentrals = Object.entries(porCentral)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return { total, concluidas, abertas, vencidas, urgentes, pctConc, topCentrals, porCentral };
}

// ── Render KPIs ───────────────────────────────────────────
function renderOcKPIs(lista) {
  const kpis = buildOcKPIs(lista);
  const el = document.getElementById('oc-kpis');
  if (!el) return;

  el.innerHTML = `
    <div class="oc-charts-row">
      ${_buildOcDonut(kpis)}
      ${_buildOcCentralChart(kpis)}
    </div>`;

  // bind hover events on donut slices
  _bindOcDonutHover();
}

function _buildOcDonut(kpis) {
  const total = kpis.total;
  if (!total) return `<div class="oc-chart-card oc-chart-donut-card"><div class="oc-chart-title">Status das ocorrências</div><div style="padding:32px;text-align:center;color:var(--text3);font-size:12px;font-family:var(--mono)">Sem ocorrências</div></div>`;

  const CX = 160, CY = 160, R = 90, ri = 56;
  const slices = [
    { label: 'Concluídas', val: kpis.concluidas, col: '#10b981' },
    { label: 'Em aberto',  val: kpis.abertas - kpis.vencidas - kpis.urgentes, col: '#3b82f6' },
    { label: 'Urgentes',   val: kpis.urgentes,   col: '#f97316' },
    { label: 'Vencidas',   val: kpis.vencidas,   col: '#f43f5e' },
  ].filter(s => s.val > 0);

  let svg = `<svg viewBox="0 0 320 320" width="100%" height="100%" style="overflow:visible;display:block">
    <defs>
      <filter id="oc-glow" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="3" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>`;

  let angle = -Math.PI / 2;
  const gap = 0.022;

  slices.forEach(s => {
    const pct   = s.val / total;
    const sweep = Math.max(pct * 2 * Math.PI - gap, 0.01);
    const a0 = angle + gap / 2;
    const ae = a0 + sweep;
    const x1 = CX + R * Math.cos(a0),   y1 = CY + R * Math.sin(a0);
    const x2 = CX + R * Math.cos(ae),   y2 = CY + R * Math.sin(ae);
    const x3 = CX + ri * Math.cos(ae),  y3 = CY + ri * Math.sin(ae);
    const x4 = CX + ri * Math.cos(a0),  y4 = CY + ri * Math.sin(a0);
    const large = sweep > Math.PI ? 1 : 0;
    const midA  = a0 + sweep / 2;
    // callout
    const ex = CX + (R + 18) * Math.cos(midA);
    const ey = CY + (R + 18) * Math.sin(midA);
    const onRight = Math.cos(midA) >= 0;
    const tx = ex + (onRight ? 16 : -16);
    const pctStr = Math.round(pct * 100);
    const tipData = encodeURIComponent(JSON.stringify({ label: s.label, val: s.val, pct: pctStr, col: s.col }));

    svg += `<path class="oc-donut-slice" data-tip="${tipData}" data-col="${s.col}"
      d="M${x1.toFixed(1)},${y1.toFixed(1)} A${R},${R} 0 ${large},1 ${x2.toFixed(1)},${y2.toFixed(1)} L${x3.toFixed(1)},${y3.toFixed(1)} A${ri},${ri} 0 ${large},0 ${x4.toFixed(1)},${y4.toFixed(1)} Z"
      fill="${s.col}" opacity="0.88" style="cursor:pointer;transition:opacity .15s"/>`;

    if (pct > 0.05) {
      const sx = CX + (R + 6) * Math.cos(midA);
      const sy = CY + (R + 6) * Math.sin(midA);
      const TICK = 22;
      const lx = CX + (R + 28) * Math.cos(midA);
      const ly = CY + (R + 28) * Math.sin(midA);
      const finalX = lx + (onRight ? TICK : -TICK);
      const anchor = onRight ? 'start' : 'end';
      const labelX = finalX + (onRight ? 3 : -3);

      svg += `<polyline points="${sx.toFixed(1)},${sy.toFixed(1)} ${lx.toFixed(1)},${ly.toFixed(1)} ${finalX.toFixed(1)},${ly.toFixed(1)}"
        fill="none" stroke="${s.col}" stroke-width="1.2" stroke-opacity=".7" style="pointer-events:none"/>`;
      svg += `<text x="${labelX.toFixed(1)}" y="${(ly - 2).toFixed(1)}" text-anchor="${anchor}"
        font-size="11" font-weight="700" font-family="var(--mono)" fill="${s.col}" style="pointer-events:none">${pctStr}%</text>`;
      svg += `<text x="${labelX.toFixed(1)}" y="${(ly + 12).toFixed(1)}" text-anchor="${anchor}"
        font-size="9.5" font-family="var(--mono)" fill="${s.col}" opacity=".75" style="pointer-events:none">${s.label}</text>`;
    }
    angle += sweep + gap;
  });

  // Score central
  svg += `<text x="${CX}" y="${CY - 8}" text-anchor="middle" font-size="34" font-weight="700" font-family="var(--mono)" fill="var(--text)" style="pointer-events:none">${kpis.pctConc}%</text>`;
  svg += `<text x="${CX}" y="${CY + 15}" text-anchor="middle" font-size="10" font-family="var(--mono)" fill="var(--text3)" letter-spacing=".07em" style="pointer-events:none">CONCLUÍDAS</text>`;
  svg += `<text x="${CX}" y="${CY + 31}" text-anchor="middle" font-size="9.5" font-family="var(--mono)" fill="var(--text3)" style="pointer-events:none">${total} ocorrência${total !== 1 ? 's' : ''}</text>`;
  svg += `</svg>`;

  return `<div class="oc-chart-card oc-chart-donut-card">
    <div class="oc-chart-title">Status das ocorrências</div>
    <div class="oc-donut-wrap">${svg}</div>
  </div>`;
}

function _buildOcCentralChart(kpis) {
  if (!kpis.topCentrals.length) return `<div class="oc-chart-card"><div class="oc-chart-title">Centrais com mais ocorrências</div><div style="padding:32px;text-align:center;color:var(--text3);font-size:12px;font-family:var(--mono)">Sem dados</div></div>`;
  const max = kpis.topCentrals[0][1];
  const total = kpis.total;
  const rankColors = ['#3b82f6','#6366f1','#8b5cf6','#a78bfa','#c4b5fd'];
  const bars = kpis.topCentrals.map(([central, n], i) => {
    const pct = Math.round(n / max * 100);
    const pctOfTotal = total > 0 ? Math.round(n / total * 100) : 0;
    const col = rankColors[i] || rankColors[rankColors.length - 1];
    return `<div class="oc-bar-row">
      <div class="oc-bar-rank" style="color:${col}">${i + 1}</div>
      <div class="oc-bar-label" title="${escapeHtml(central)}">${escapeHtml(central)}</div>
      <div class="oc-bar-track">
        <div class="oc-bar-fill" style="width:${pct}%;background:${col}"></div>
      </div>
      <div class="oc-bar-meta">
        <span class="oc-bar-val" style="color:${col}">${n}</span>
        <span class="oc-bar-pct">${pctOfTotal}%</span>
      </div>
    </div>`;
  }).join('');

  return `<div class="oc-chart-card">
    <div class="oc-chart-title">Centrais com mais ocorrências</div>
    <div class="oc-bars-list">${bars}</div>
  </div>`;
}

function _bindOcDonutHover() {
  const slices = document.querySelectorAll('.oc-donut-slice');
  slices.forEach(slice => {
    const col = slice.dataset.col;
    let tip;
    try { tip = JSON.parse(decodeURIComponent(slice.dataset.tip)); } catch(e) { return; }
    const html = `
      <div style="font-weight:700;font-size:13px;color:var(--text);margin-bottom:6px;display:flex;align-items:center;gap:7px">
        <span style="width:10px;height:10px;border-radius:3px;background:${col};display:inline-block"></span>${tip.label}
      </div>
      <div style="font-family:var(--mono);font-size:11px;color:var(--text2)">${tip.val} ocorrência${tip.val !== 1 ? 's' : ''} · ${tip.pct}%</div>`;
    slice.addEventListener('mouseenter', e => {
      slices.forEach(s => s.style.opacity = s === slice ? '1' : '0.3');
      if (typeof _showHelpTip === 'function') _showHelpTip(e, html);
    });
    slice.addEventListener('mousemove', e => { if (typeof _moveHelpTip === 'function') _moveHelpTip(e); });
    slice.addEventListener('mouseleave', () => {
      slices.forEach(s => s.style.opacity = '');
      if (typeof _hideHelpTip === 'function') _hideHelpTip();
    });
  });
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

  if (!central)   { toast('Informe a central.', 'error'); return; }
  if (!descricao) { toast('Informe a descrição da solicitação.', 'error'); return; }

  const existing = id ? (state.ocorrencias || []).find(o => o.id === id) : null;
  const ocorrencia = {
    id:           id || _nextOcId(),
    dataAbertura: abertura,
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
