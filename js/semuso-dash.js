'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// OPERAÇÕES — DASHBOARD "MATERIAL SEM USO" (Hugo, 19/11/2026)
// ═══════════════════════════════════════════════════════════════════════════
// Protótipo aprovado em 19/11/2026: https://claude.ai/artifact/611DxKazyrA9unANsFGV48
// Abas Visão geral · Onde está · Tratativas · Itens e o relatório por material
// (placar, consumo × saldo, onde tem uso, régua e linha do tempo).
//
// AUTOCONTIDO de propósito: recebe os dados prontos (mural-semuso.js monta)
// e só desenha. Por isso o arquivo baixado leva este módulo inteiro
// (SUD_FONTE.toString()) e continua interativo sem o app. Não chamar nada
// do app aqui dentro — só as variáveis de cor do CSS.
//
// Dados (D): { ref, ini, hoje (ts), its: [{ k, central, material, regional,
//   categoria, dono, dias, semHist, ultUso, nivel, kg, custo, rs,
//   trat: {causa, quando} | null, volta, prio }], det: { [k]: { serie:
//   [{n, c, s}], outras: [{central, regional, mes, ult}], ev: [{d, tipo,
//   tit, txt, b}] } } }
// cfg: { modo: 'tela' | 'arq', sel: k | null, abrir: 'nomeGlobal(k)',
//   voltar: 'js', acoes: html, baixar: html }
function SUD_FONTE() {
  const DIA = 864e5;
  const st = { aba: 'geral', busca: '', fil: '', ord: ['prio', -1], tl: new Set(), cent: '', sel: null };
  let D = null, cfg = {}, vis = [], cache = {};
  const NIV = { critico: ['CRÍTICO', 'var(--red)', 'ti-flame'], urgente: ['URGENTE', 'var(--urgente)', 'ti-alert-circle'], atencao: ['ATENÇÃO', 'var(--amber)', 'ti-alert-triangle'] };
  // Ícones de criticidade do sistema (_levelIcon, macro.js); a fonte Tabler vai embutida no arquivo.
  const ico = (ic, cor) => `<i class="ti ${ic} sud-ico" style="color:${cor}" aria-hidden="true"></i>`;
  const TL = { sap: ['SAP', 'var(--text2)'], nivel: ['Alerta', 'var(--amber)'], com: ['Comentário', 'var(--accent)'], reg: ['Registro', 'var(--purple)'],
    oc: ['Ocorrência', 'var(--red)'], dai: ['DAI', 'var(--gold)'], volta: ['Fila', 'var(--text2)'] };
  const TL_F = [['com', 'Comentários'], ['reg', 'Registros'], ['oc', 'Ocorrências'], ['dai', 'DAIs'], ['nivel', 'Alertas']];
  const FAIXAS = [['60–89', 60, 'var(--amber)'], ['90–119', 90, 'var(--urgente)'], ['120–179', 120, 'var(--red)'], ['180–364', 180, 'var(--sud-red2)'], ['365+', 365, 'var(--sud-red2)']];
  const CAUSA_COR = { sazonal: 'var(--teal)', 'reserva estratégica': 'var(--accent)', 'aguardando coleta': 'var(--purple)', 'obra parada': 'var(--gold)', outro: 'var(--text2)', 'Solicitação de coleta': 'var(--green)' };

  // ── Formatação ─────────────────────────────────────────────────────────
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const soma = (a, f) => a.reduce((x, i) => x + f(i), 0);
  const rs = (v) => 'R$ ' + Math.round(v).toLocaleString('pt-BR');
  const rsK = (v) => v >= 1e6 ? 'R$ ' + (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' mi' : v >= 1e4 ? 'R$ ' + Math.round(v / 1e3).toLocaleString('pt-BR') + ' mil' : rs(v);
  const kgF = (v) => Math.abs(v) >= 1e4 ? (v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' t' : Math.round(v).toLocaleString('pt-BR') + ' kg';
  const dF = (ts) => new Date(ts).toLocaleDateString('pt-BR');
  const dC = (ts) => new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  const cap = (t) => t[0] + t.slice(1).toLowerCase();
  const T = (tit, linhas) => encodeURIComponent(`<b>${esc(tit)}</b>` + linhas.map(([a, b]) => `<div class="sud-tip-l"><span>${a}</span><span>${b}</span></div>`).join(''));
  const prio = (i) => (i.trat ? -100 : 0) + i.prio;
  // Gráfico desenhado depois, na largura real do espaço (W em px = viewBox):
  // o texto fica no tamanho do CSS e não estica com a tela (Hugo, 19/11/2026).
  const ch = (f) => `<div class="sud-ch" data-ch="${cache.ch.push(f) - 1}"></div>`;
  function desenhar() {
    document.querySelectorAll('#sud-root [data-ch]').forEach(el => { const f = cache.ch && cache.ch[+el.dataset.ch]; if (f) el.innerHTML = f(Math.max(280, Math.round(el.clientWidth) || 560)); });
  }
  const faixaDe = (i) => i.semHist ? 'Sem mov.' : [...FAIXAS].reverse().find(f => i.dias >= f[1])[0];
  function agrupa(its, f) {
    const m = new Map();
    its.forEach(i => { const k = f(i); if (!m.has(k)) m.set(k, { n: k, tot: 0, pend: 0, trat: 0, q: 0, qp: 0, kg: 0, its: [] });
      const g = m.get(k); g.tot += i.rs; g.kg += i.kg; g.q++; g.its.push(i); if (i.trat) g.trat += i.rs; else { g.pend += i.rs; g.qp++; } });
    return [...m.values()].sort((a, b) => b.tot - a.tot);
  }
  // Valores usados em onclick vão por índice (nomes têm aspas, barras…).
  const ref = (lista, v) => { let i = lista.indexOf(v); if (i < 0) { lista.push(v); i = lista.length - 1; } return i; };

  // ── Gráficos (SVG) ─────────────────────────────────────────────────────
  function donut(partes, centro, sub, size = 168) {
    const tot = soma(partes, p => p.v) || 1, R = size / 2 - 8, r = R - 20, cx = size / 2, nz = partes.filter(p => p.v).length; let a0 = -Math.PI / 2; const P = [];
    const pt = (rr, a) => `${(cx + rr * Math.cos(a)).toFixed(1)} ${(cx + rr * Math.sin(a)).toFixed(1)}`;
    partes.forEach(p => { if (!p.v) return;
      const fr = p.v / tot; if (fr >= .9999) { P.push(`<circle cx="${cx}" cy="${cx}" r="${(R + r) / 2}" fill="none" stroke="${p.c}" stroke-width="${R - r}" data-sud-tip="${p.tip || ''}"/>`); return; }
      const a1 = a0 + fr * Math.PI * 2 - (nz > 1 ? .02 : 0), big = a1 - a0 > Math.PI ? 1 : 0;
      P.push(`<path class="sud-hov" ${p.on ? `onclick="${p.on}"` : ''} data-sud-tip="${p.tip || ''}" fill="${p.c}" d="M${pt(R, a0)}A${R} ${R} 0 ${big} 1 ${pt(R, a1)}L${pt(r, a1)}A${r} ${r} 0 ${big} 0 ${pt(r, a0)}Z"/>`);
      a0 += fr * Math.PI * 2; });
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${esc(sub)}">${P.join('')}
      <text x="${cx}" y="${cx - 2}" text-anchor="middle" class="sud-big">${centro}</text><text x="${cx}" y="${cx + 17}" text-anchor="middle" class="sud-ax">${sub}</text></svg>`;
  }
  function legenda(partes, fmt) {
    const tot = soma(partes, p => p.v) || 1;
    return `<div class="sud-legl">${partes.map(p => `<div>${p.ic ? ico(p.ic, p.c) : `<i style="background:${p.c}"></i>`}<span>${esc(p.n)}<small>${p.sub || ''}</small></span>
      <span class="sud-num">${fmt(p.v)}<small>${Math.round(p.v / tot * 100)}%</small></span></div>`).join('')}</div>`;
  }
  function colunas(dados, { H = 190, W = 560 } = {}) {
    const L = 6, B = 34, T0 = 18, n = dados.length || 1, max = Math.max(...dados.map(d => d.pend + d.trat), 1);
    const bw = Math.min(56, (W - L * 2) / n * .62), x = (i) => L + (W - L * 2) / n * (i + .5), y = (v) => T0 + (H - B - T0) * (1 - v / max);
    const g = [0, .5, 1].map(f => `<line class="sud-grid" x1="0" x2="${W}" y1="${y(max * f)}" y2="${y(max * f)}"/>`).join('');
    return `<svg class="sud-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de colunas">${g}${dados.map((d, i) => {
      const tot = d.pend + d.trat, yp = y(d.pend), yt = y(tot);
      return `<g class="sud-hov" data-sud-tip="${T(d.n, [['Valor parado', rs(tot)], ['Sem tratativa', rs(d.pend)], ['Tratado', rs(d.trat)], ['Pares', d.q]])}" ${d.on ? `onclick="${d.on}"` : ''}>
        <rect x="${x(i) - bw / 2}" y="${T0}" width="${bw}" height="${H - B - T0}" fill="transparent"/>
        <rect x="${x(i) - bw / 2}" y="${yp}" width="${bw}" height="${Math.max(0, H - B - yp)}" rx="3" fill="${d.c || 'var(--amber)'}"/>
        <rect x="${x(i) - bw / 2}" y="${yt}" width="${bw}" height="${Math.max(0, yp - yt)}" rx="3" fill="var(--green)" opacity=".55"/>
        ${tot ? `<text x="${x(i)}" y="${yt - 5}" text-anchor="middle" class="sud-val">${rsK(tot).replace('R$ ', '')}</text>` : ''}
        <text x="${x(i)}" y="${H - B + 15}" text-anchor="middle" class="sud-ax">${esc(d.n)}</text>
        <text x="${x(i)}" y="${H - B + 28}" text-anchor="middle" class="sud-ax sud-ax2">${d.q} ${d.q === 1 ? 'par' : 'pares'}</text></g>`; }).join('')}</svg>`;
  }
  function barrasH(dados, W = 900) {
    const rowH = 28, H = dados.length * rowH + 4, lab = Math.min(220, Math.round(W * .36)), valW = 92, max = Math.max(...dados.map(d => d.pend + d.trat), 1), w = (v) => (W - lab - valW - 12) * v / max;
    return `<svg class="sud-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ranking">${dados.map((d, i) => { const y = i * rowH + 4, tot = d.pend + d.trat;
      return `<g class="sud-hov" ${d.on ? `onclick="${d.on}"` : ''} data-sud-tip="${T(d.n, [['Valor parado', rs(tot)], ['Sem tratativa', rs(d.pend)], ['Pares', d.q], ...(d.extra || [])])}">
        <rect x="0" y="${y - 2}" width="${W}" height="${rowH}" fill="transparent"/>
        <text x="0" y="${y + 13}" class="sud-ax sud-ax-l">${esc(d.n.length > 30 ? d.n.slice(0, 29) + '…' : d.n)}</text>
        <rect x="${lab}" y="${y + 3}" width="${Math.max(1, w(d.pend))}" height="13" rx="3" fill="${d.c || 'var(--amber)'}"/>
        <rect x="${lab + w(d.pend)}" y="${y + 3}" width="${w(d.trat)}" height="13" rx="3" fill="var(--green)" opacity=".55"/>
        <text x="${W}" y="${y + 13}" text-anchor="end" class="sud-val">${rsK(tot)}</text></g>`; }).join('')}</svg>`;
  }
  function squarify(itens, x, y, w, h) {
    const out = []; let fila = itens.filter(i => i.v > 0).sort((a, b) => b.v - a.v); const tot = soma(fila, i => i.v) || 1, k = w * h / tot;
    fila = fila.map(i => ({ ...i, a: i.v * k })); let rx = x, ry = y, rw = w, rh = h;
    while (fila.length) {
      const lado = Math.max(1, Math.min(rw, rh)); let linha = [], pior = Infinity;
      for (const it of fila) { const t = [...linha, it], s2 = soma(t, i => i.a), mx = Math.max(...t.map(i => i.a)), mn = Math.min(...t.map(i => i.a));
        const p = Math.max(lado * lado * mx / (s2 * s2), s2 * s2 / (lado * lado * mn)); if (p > pior) break; pior = p; linha = t; }
      fila = fila.slice(linha.length); const esp = soma(linha, i => i.a) / lado; let off = 0;
      linha.forEach(i => { const l = i.a / esp; out.push(rw >= rh ? { ...i, x: rx, y: ry + off, w: esp, h: l } : { ...i, x: rx + off, y: ry, w: l, h: esp }); off += l; });
      if (rw >= rh) { rx += esp; rw -= esp; } else { ry += esp; rh -= esp; }
    }
    return out;
  }
  function treemap(its, W) {
    const H = W < 520 ? 300 : 380; let svg = '';
    const corta = (t, w) => { const n = Math.max(0, Math.floor((w - 16) / 7)); return t.length > n ? (n > 3 ? t.slice(0, n - 1) + '…' : '') : t; };
    squarify(agrupa(its, i => i.regional).map(g => ({ n: g.n, v: g.tot, g })), 0, 0, W, H).forEach(R => {
      svg += `<rect x="${R.x + 1}" y="${R.y + 1}" width="${Math.max(0, R.w - 2)}" height="${Math.max(0, R.h - 2)}" rx="6" fill="var(--bg3)"/>`
        + `<text x="${R.x + 8}" y="${R.y + 13}" class="sud-ax sud-ax-cab">${esc(corta(String(R.n).toUpperCase() + ' · ' + rsK(R.v), R.w))}</text>`;
      squarify(agrupa(R.g.its, i => i.central).map(c => ({ n: c.n, v: c.tot, c })), R.x + 3, R.y + 18, Math.max(1, R.w - 6), Math.max(1, R.h - 21)).forEach(C => {
        const c = C.c, pct = c.tot ? c.pend / c.tot : 0, pior = ['critico', 'urgente', 'atencao'].find(n => c.its.some(i => i.nivel === n));
        const cor = pct === 0 ? 'var(--green)' : NIV[pior][1], nome = corta(c.n, C.w);
        svg += `<g class="sud-hov" onclick="SUD.central(${ref(cache.cent, c.n)})" data-sud-tip="${T(c.n, [['Regional', esc(R.n)], ['Valor parado', rs(c.tot)], ['Sem tratativa', `${rs(c.pend)} (${Math.round(pct * 100)}%)`], ['Pares', c.q], ['Pior nível', NIV[pior][0]]])}">
          <rect x="${C.x + 1.5}" y="${C.y + 1.5}" width="${Math.max(0, C.w - 3)}" height="${Math.max(0, C.h - 3)}" rx="4" fill="${cor}" opacity="${(.28 + .55 * pct).toFixed(2)}"/>
          ${C.w > 70 && C.h > 34 ? `<text x="${C.x + 8}" y="${C.y + 18}" class="sud-tm">${esc(nome)}</text><text x="${C.x + 8}" y="${C.y + 33}" class="sud-val">${rsK(c.tot)}</text>` : ''}</g>`;
      });
    });
    return `<svg class="sud-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Valor parado por regional e central">${svg}</svg>`;
  }

  // ── Abas ───────────────────────────────────────────────────────────────
  const sec = (tit, hint, corpo) => `<div class="sud-sec"><h4>${tit}${hint ? ` <span class="sud-hint">${hint}</span>` : ''}</h4>${corpo}</div>`;
  const legPT = '<div class="sud-leg"><span><i style="background:var(--amber)"></i>sem tratativa</span><span><i style="background:var(--green);opacity:.55"></i>tratado</span></div>';

  function abaGeral(its) {
    const tot = soma(its, i => i.rs), pend = its.filter(i => !i.trat), tp = soma(pend, i => i.rs);
    const ds = its.filter(i => !i.semHist).map(i => i.dias).sort((a, b) => a - b), med = ds[Math.floor(ds.length / 2)] || 0;
    const pReg = agrupa(pend, i => i.regional)[0], pMat = agrupa(pend, i => i.material)[0], crit = pend.filter(i => i.nivel === 'critico').length;
    const pct = tot ? tp / tot : 0, selo = pct > .6 ? ['var(--red)', 'CRÍTICO', 'ti-flame'] : pct > .3 ? ['var(--urgente)', 'ATENÇÃO', 'ti-alert-circle'] : ['var(--green)', 'SOB CONTROLE', 'ti-circle-check'];
    const niveis = ['critico', 'urgente', 'atencao'].map(n => { const a = its.filter(i => i.nivel === n);
      return { n: cap(NIV[n][0]), ic: NIV[n][2], v: soma(a, i => i.rs), c: NIV[n][1], sub: `${a.length} ${a.length === 1 ? 'par' : 'pares'} · ${{ critico: '120+ dias', urgente: '90–119 dias', atencao: '60–89 dias' }[n]}`,
        tip: T(NIV[n][0], [['Pares', a.length], ['Valor', rs(soma(a, i => i.rs))], ['Sem tratativa', a.filter(i => !i.trat).length]]), on: `SUD.itens('${n}')` }; });
    const fx = [...FAIXAS.map(f => [f[0], f[2]]), ['Sem mov.', 'var(--purple)']].map(([n, c]) => { const a = its.filter(i => faixaDe(i) === n);
      return { n, c, q: a.length, pend: soma(a.filter(i => !i.trat), i => i.rs), trat: soma(a.filter(i => i.trat), i => i.rs) }; });
    const r0 = new Date(D.ref), meses = [];
    for (let k = 11; k >= 0; k--) { const d = new Date(r0.getFullYear(), r0.getMonth() - k, 1);
      meses.push({ k: d.getFullYear() * 12 + d.getMonth(), n: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''), q: 0, pend: 0, trat: 0 }); }
    let antes = { q: 0, v: 0 };
    its.forEach(i => { const d = new Date((i.semHist ? D.ini + 120 * DIA : i.ultUso + 60 * DIA)), m = meses.find(x => x.k === d.getFullYear() * 12 + d.getMonth());
      if (m) { m.q++; if (i.trat) m.trat += i.rs; else m.pend += i.rs; } else { antes.q++; antes.v += i.rs; } });
    const linkReg = pReg ? `<a onclick="SUD.aba('onde')">${esc(pReg.n)}</a> (${rsK(pReg.pend)})` : '—';
    const linkMat = pMat ? `<a onclick="SUD.buscar(${ref(cache.txt, pMat.n)})">${esc(pMat.n)}</a>` : '—';
    return `<div class="sud-vered"><span class="sud-selo" style="--c:${selo[0]}">${ico(selo[2], selo[0])}${selo[1]}</span>
        <span>${Math.round(pct * 100)}% do valor parado está sem tratativa. Maior concentração: ${linkReg}, puxada por ${linkMat}.</span></div>
      <div class="sud-placar">
        <div><span>Valor parado</span><b>${rsK(tot)}</b><small>${its.length} pares · ${new Set(its.map(i => i.central)).size} centrais</small></div>
        <div><span>Sem tratativa</span><b style="color:var(--amber)">${rsK(tp)}</b><small>${pend.length} ${pend.length === 1 ? 'par' : 'pares'} · ${crit} ${crit === 1 ? 'crítico' : 'críticos'}</small></div>
        <div><span>Saldo parado</span><b>${kgF(soma(its, i => i.kg))}</b><small>saldo SAP de hoje</small></div>
        <div><span>Tempo parado</span><b>${med} dias</b><small>mediana · máx. ${ds[ds.length - 1] || 0} dias</small></div>
      </div>
      <div class="sud-g2">
        ${sec('Por nível', '', `<div class="sud-dl">${donut(niveis, its.length, 'pares')}${legenda(niveis, rsK)}</div>`)}
        ${sec('Envelhecimento', 'dias sem uso · R$', ch(W => colunas(fx, { W })) + '<div class="sud-leg"><span><i style="background:var(--amber)"></i>sem tratativa (cor da faixa)</span><span><i style="background:var(--green);opacity:.55"></i>tratado</span></div>')}
      </div>
      ${sec('Entrada na fila', 'mês em que o par completou 60 dias sem uso · valor de hoje', ch(W => colunas(meses, { H: 170, W }))
        + (antes.q ? `<p class="sud-hint">${antes.q} ${antes.q === 1 ? 'par' : 'pares'} (${rsK(antes.v)}) entraram antes de ${meses[0].n}.</p>` : ''))}`;
  }

  function abaOnde(its) {
    const regs = agrupa(its, i => i.regional).map(g => g.n), cats = agrupa(its, i => i.categoria).map(g => g.n);
    const cel = (r, c) => its.filter(i => i.regional === r && i.categoria === c);
    const max = Math.max(...regs.flatMap(r => cats.map(c => soma(cel(r, c), i => i.rs))), 1);
    const heat = `<div class="sud-x"><table class="sud-heat"><thead><tr><th></th>${cats.map(c => `<th>${esc(c)}</th>`).join('')}<th class="n">Total</th></tr></thead><tbody>
      ${regs.map(r => `<tr><th>${esc(r)}</th>${cats.map(c => { const a = cel(r, c), v = soma(a, i => i.rs), p = soma(a.filter(i => !i.trat), i => i.rs);
        return v ? `<td class="sud-hov" data-sud-tip="${T(r + ' · ' + c, [['Valor parado', rs(v)], ['Sem tratativa', rs(p)], ['Pares', a.length]])}" style="background:color-mix(in srgb, var(--amber) ${Math.round(10 + 70 * v / max)}%, transparent)" onclick="SUD.buscar(${ref(cache.txt, c)})">${rsK(v).replace('R$ ', '')}</td>` : '<td class="z">—</td>'; }).join('')}
        <td class="n">${rsK(soma(its.filter(i => i.regional === r), i => i.rs)).replace('R$ ', '')}</td></tr>`).join('')}</tbody></table></div>`;
    const mats = agrupa(its, i => i.material).slice(0, 10).map(g => ({ ...g, c: 'var(--amber)', extra: [['Centrais', new Set(g.its.map(i => i.central)).size]], on: `SUD.buscar(${ref(cache.txt, g.n)})` }));
    return sec('Onde está o valor parado', 'área = R$ · cor = pior nível · intensidade = parte sem tratativa · clique filtra a central', ch(W => treemap(its, W)))
      + sec('Regional × categoria', 'R$ parado', heat)
      + sec('Materiais com mais valor parado', 'somando as centrais', ch(W => barrasH(mats, W)) + legPT);
  }

  function abaTrat(its) {
    const tot = soma(its, i => i.rs), tr = its.filter(i => i.trat), vt = soma(tr, i => i.rs), pct = tot ? vt / tot : 0, R = 62, C = 2 * Math.PI * R;
    const gauge = `<svg viewBox="0 0 168 168" width="168" height="168" role="img" aria-label="Percentual tratado"><circle cx="84" cy="84" r="${R}" fill="none" stroke="var(--bg4)" stroke-width="16"/>
      <circle cx="84" cy="84" r="${R}" fill="none" stroke="var(--green)" stroke-width="16" stroke-dasharray="${(C * pct).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 84 84)" stroke-linecap="round"/>
      <text x="84" y="84" text-anchor="middle" class="sud-big">${Math.round(pct * 100)}%</text><text x="84" y="102" text-anchor="middle" class="sud-ax">do valor tratado</text></svg>`;
    const causas = agrupa(tr, i => /^Solicitação de coleta/.test(i.trat.causa) ? 'Solicitação de coleta' : String(i.trat.causa).replace(/^Sem uso:\s*/, ''))
      .map(g => ({ n: g.n, v: g.tot, c: CAUSA_COR[g.n] || 'var(--text2)', sub: `${g.q} ${g.q === 1 ? 'par' : 'pares'}`, tip: T(g.n, [['Pares', g.q], ['Valor', rs(g.tot)]]) }));
    const donos = agrupa(its, i => i.dono).map(g => ({ ...g, c: 'var(--amber)', extra: [['Tratados', `${g.q - g.qp} de ${g.q}`]] }));
    const sem = [];
    for (let k = 0; k < 5; k++) { const a = D.hoje + k * 7 * DIA, b = a + 7 * DIA, v = tr.filter(i => i.volta >= a && i.volta < b);
      sem.push({ n: dC(a).slice(0, 5), q: v.length, pend: soma(v, i => i.rs), trat: 0, c: 'var(--text2)' }); }
    const num = (rot, v, cor = '') => `<div><span class="sud-hint">${rot}</span><b class="sud-num"${cor ? ` style="color:${cor}"` : ''}>${v}</b></div>`;
    return `<div class="sud-g2">
        ${sec('Andamento', '', `<div class="sud-dl">${gauge}<div class="sud-nums">${num('Tratados', `${tr.length} <small>de ${its.length} pares</small>`)}${num('Valor tratado', rsK(vt), 'var(--green)')}${num('Valor sem tratativa', rsK(tot - vt), 'var(--amber)')}</div></div>`)}
        ${sec('Causas informadas', 'tratativas dos últimos 30 dias', causas.length ? `<div class="sud-dl">${donut(causas, tr.length, 'tratados')}${legenda(causas, rsK)}</div>` : '<p class="sud-hint">Nenhum material tratado.</p>')}
      </div>
      ${sec('Por dono', 'analista da categoria · R$ parado', ch(W => barrasH(donos, W)) + legPT)}
      ${sec('Voltam para a fila', 'tratativas que vencem (30 dias) por semana, se o material continuar parado', ch(W => colunas(sem, { H: 150, W })))}`;
  }

  function abaItens(its) {
    const chips = [['', 'Todos'], ['pend', 'Sem tratativa'], ['critico', 'Crítico'], ['urgente', 'Urgente'], ['atencao', 'Atenção']]
      .map(([v, r]) => `<button class="sud-chip${st.fil === v ? ' on' : ''}" onclick="SUD.itens('${v}')">${r}</button>`).join('');
    return `<div class="sud-ferr"><input id="sud-busca" type="search" placeholder="Buscar material, central, regional, categoria, dono…" value="${esc(st.busca)}" oninput="SUD.digitar(this.value)">${chips}</div>
      <div id="sud-tab">${tabela(its)}</div>`;
  }
  function tabela(its) {
    const q = st.busca.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''), sa = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const a = its.filter(i => (!st.fil || (st.fil === 'pend' ? !i.trat : i.nivel === st.fil)) && (!q || q.split(/[,;]+/).map(t => t.trim()).filter(Boolean)
      .some(t => [i.material, i.central, i.regional, i.categoria, i.dono].some(x => sa(x).includes(t)))));
    const [k, d] = st.ord, val = { prio, material: i => i.material, central: i => i.central, dias: i => i.dias, kg: i => i.kg, rs: i => i.rs };
    a.sort((x, y) => { const p = val[k](x), r = val[k](y); return (p > r ? 1 : p < r ? -1 : 0) * d; });
    const th = (key, rot, n) => `<th class="${n ? 'n' : ''} sud-ord" onclick="SUD.ordenar('${key}')">${rot}${st.ord[0] === key ? (st.ord[1] > 0 ? ' ↑' : ' ↓') : ''}</th>`;
    return `<p class="sud-hint">${a.length} pares · ${rs(soma(a, i => i.rs))}</p><div class="sud-x"><table class="sud-tab"><thead><tr>${th('prio', 'Nível')}${th('material', 'Material')}${th('central', 'Central')}<th>Dono</th>${th('dias', 'Dias', 1)}${th('kg', 'Saldo', 1)}${th('rs', 'Valor', 1)}<th>Tratativa</th></tr></thead><tbody>
      ${a.map(i => `<tr onclick="SUD.abrir(${vis.indexOf(i)})"><td><span class="sud-tag" style="color:${NIV[i.nivel][1]}">${ico(NIV[i.nivel][2], NIV[i.nivel][1])}${NIV[i.nivel][0]}</span></td>
        <td><b>${esc(i.material)}</b></td><td>${esc(i.central)}<span class="sud-hint"> · ${esc(i.regional)}</span></td><td>${esc(i.dono)}</td>
        <td class="n">${i.semHist ? i.dias + '+' : i.dias}</td><td class="n">${kgF(i.kg)}</td><td class="n">${i.custo ? rs(i.rs) : '<span class="sud-hint">sem custo</span>'}</td>
        <td>${i.trat ? `<span style="color:var(--green)">${esc(String(i.trat.causa).replace(/^Sem uso:\s*/, ''))}</span><span class="sud-hint"> · volta ${dC(i.volta).slice(0, 5)}</span>` : '<span style="color:var(--amber)">pendente</span>'}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  // ── Relatório por material ─────────────────────────────────────────────
  function consumoSaldo(serie, W) {
    const H = 200, L = 6, B = 26, T0 = 18, n = serie.length || 1, mc = Math.max(...serie.map(m => m.c), 1), ms = Math.max(...serie.map(m => m.s), 1);
    const x = (k) => L + (W - L * 2) / n * (k + .5), bw = (W - L * 2) / n * .55, yc = (v) => T0 + (H - B - T0) * (1 - v / mc), ys = (v) => T0 + (H - B - T0) * (1 - Math.max(0, v) / ms);
    const fim = serie[n - 1];
    return `<svg class="sud-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Consumo mensal e saldo">
      ${[0, .5, 1].map(f => `<line class="sud-grid" x1="0" x2="${W}" y1="${T0 + (H - B - T0) * f}" y2="${T0 + (H - B - T0) * f}"/>`).join('')}
      ${serie.map((m, k) => `<g class="sud-hov" data-sud-tip="${T(m.n, [['Consumo', kgF(m.c)], ['Saldo no fim do mês', kgF(m.s)]])}"><rect x="${x(k) - bw / 2}" y="${T0}" width="${bw}" height="${H - B - T0}" fill="transparent"/>
        ${m.c > 0 ? `<rect x="${x(k) - bw / 2}" y="${yc(m.c)}" width="${bw}" height="${H - B - yc(m.c)}" rx="3" fill="var(--teal)" opacity=".75"/>` : `<rect x="${x(k) - bw / 2}" y="${H - B - 2}" width="${bw}" height="2" fill="var(--red)"/>`}
        <text x="${x(k)}" y="${H - 8}" text-anchor="middle" class="sud-ax"${m.c > 0 ? '' : ' style="fill:var(--red)"'}>${esc(m.n)}</text></g>`).join('')}
      <path d="${serie.map((m, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)} ${ys(m.s).toFixed(1)}`).join('')}" fill="none" stroke="var(--text)" stroke-width="2" stroke-linejoin="round"/>
      ${serie.map((m, k) => `<circle cx="${x(k)}" cy="${ys(m.s)}" r="${k === n - 1 ? 4 : 2.5}" fill="var(--text)"/>`).join('')}
      ${fim ? `<text x="${x(n - 1) - 8}" y="${ys(fim.s) - 9}" text-anchor="end" class="sud-val">${kgF(fim.s)}</text>` : ''}</svg>
      <div class="sud-leg"><span><i style="background:var(--teal);opacity:.75"></i>consumo no mês</span><span><i style="background:var(--text);height:2px"></i>saldo no fim do mês</span><span><i style="background:var(--red);height:3px"></i>mês sem uso</span></div>`;
  }
  function outras(i, o, uf) {
    if (!uf) return '<p class="sud-hint">Esta central está sem UF no cadastro. Preencha em Configurações › Centrais (botão "Preencher UF") para ver as centrais do mesmo estado.</p>';
    if (!o.length) return `<p class="sud-hint">Nenhuma outra central de ${esc(uf)} usou este material nos últimos 90 dias.</p>`;
    return `<div class="sud-x"><table class="sud-tab sud-tab-s"><thead><tr><th>Central</th><th class="n">Consumo/mês</th><th class="n">Saldo daqui cobre</th></tr></thead><tbody>
      ${o.map(c => { const m = c.mes ? i.kg / c.mes : Infinity;
        return `<tr><td>${esc(c.central)}<span class="sud-hint"> · ${esc(c.regional)}</span></td><td class="n">${kgF(c.mes)}</td>
          <td class="n" style="color:${m <= 3 ? 'var(--green)' : 'var(--text)'}">${m === Infinity ? '—' : m.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + (m < 2 && m >= 1 ? ' mês' : ' meses')}</td></tr>`; }).join('')}</tbody></table></div>
      <p class="sud-hint">Média dos últimos 3 meses. Em verde: a central gastaria o saldo parado em até 3 meses, boa candidata para a coleta.</p>`;
  }
  function regua(i, ev, W) {
    const H = 74, L = 8, Rr = W - 8, ini = i.semHist ? D.ini : i.ultUso, span = Math.max(DIA, D.ref - ini), x = (t) => L + (Rr - L) * Math.min(1, Math.max(0, (t - ini) / span));
    const c = (n) => ini + n * DIA;
    const fx = i.semHist ? [[ini, D.ref, 'var(--red)']] : [[ini, c(60), 'var(--bg4)'], [c(60), c(90), 'var(--amber)'], [c(90), c(120), 'var(--urgente)'], [c(120), D.ref, 'var(--red)']]
      .filter(f => f[0] < D.ref).map(f => [f[0], Math.min(f[1], D.ref), f[2]]);
    const mk = i.semHist ? [] : [60, 90, 120].filter(n => c(n) <= D.ref);
    const pts = ev.filter(e => !['sap', 'nivel'].includes(e.tipo) && e.d >= ini);
    return `<svg class="sud-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Régua do tempo parado">
      ${fx.map(([a, b, cor]) => `<rect x="${x(a)}" y="30" width="${Math.max(0, x(b) - x(a))}" height="8" fill="${cor}"/>`).join('')}
      ${mk.map(n => `<line x1="${x(c(n))}" x2="${x(c(n))}" y1="26" y2="42" stroke="var(--text2)"/><text x="${x(c(n))}" y="56" text-anchor="middle" class="sud-ax">${n}d</text>`).join('')}
      ${pts.map(e => `<g data-sud-tip="${T(e.tit, [[dF(e.d), '']])}"><circle cx="${x(e.d)}" cy="16" r="5.5" fill="${TL[e.tipo][1]}"/><line x1="${x(e.d)}" x2="${x(e.d)}" y1="21" y2="30" stroke="${TL[e.tipo][1]}"/></g>`).join('')}
      <text x="${L}" y="70" class="sud-ax">${i.semHist ? 'início da base' : 'último uso'} · ${dC(ini)}</text><text x="${Rr}" y="70" text-anchor="end" class="sud-ax">${dC(D.ref)} · ${i.dias}${i.semHist ? '+' : ''} dias</text></svg>`;
  }
  function detalhe(i, topo) {
    const det = (D.det || {})[i.k] || { serie: [], outras: [], ev: [] }, cor = NIV[i.nivel][1];
    const ev = det.ev.filter(e => !st.tl.size || st.tl.has(e.tipo) || e.tipo === 'sap').slice().sort((a, b) => b.d - a.d);
    const conta = (k) => det.ev.filter(e => e.tipo === k).length, melhor = det.outras[0];
    const hoje = `<div class="sud-ev sud-ev-hoje" style="--c:${cor}"><span class="dt">hoje</span><span class="mk"><i class="cheio"></i></span><div class="tx"><span class="tp">${NIV[i.nivel][0]}</span>
      <b>${i.semHist ? `${i.dias}+ dias sem movimento` : `${i.dias} dias sem uso`}</b>
      <p>${i.trat ? `Tratado: ${esc(String(i.trat.causa).replace(/^Sem uso:\s*/, ''))} em ${dF(i.trat.quando)}. Volta para a fila em ${dF(i.volta)} se continuar parado.` : 'Sem tratativa nos últimos 30 dias. Comente a causa ou abra uma Solicitação de coleta com o motivo "Sem uso".'}</p></div></div>`;
    return `<div class="sud-det">
      <div class="sud-det-cab">${ico(NIV[i.nivel][2], cor)}<div><h3>${esc(i.material)}</h3><span class="sud-hint">${esc(i.central)} · ${esc(i.regional)} · ${esc(i.categoria)}</span></div>${topo}</div>
      <div class="sud-vered"><span class="sud-selo" style="--c:${cor}">${ico(NIV[i.nivel][2], cor)}${NIV[i.nivel][0]}</span><span>${i.semHist ? `Saldo sem nenhum movimento desde o início da base (${dF(D.ini)}).` : `Último uso em ${dF(i.ultUso)}; parado há ${i.dias} dias.`}
        ${i.trat ? `Tratado: ${esc(String(i.trat.causa).replace(/^Sem uso:\s*/, ''))}.` : '<span style="color:var(--amber)">Sem tratativa.</span>'}
        ${melhor && melhor.mes && i.kg / melhor.mes <= 3 ? `${esc(melhor.central)} gasta este saldo em ${(i.kg / melhor.mes).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${i.kg / melhor.mes < 2 ? 'mês' : 'meses'}.` : ''}</span></div>
      <div class="sud-placar">
        <div><span>Valor parado</span><b>${i.custo ? rsK(i.rs) : '—'}</b><small>${i.custo ? 'R$ ' + i.custo.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '/kg' : 'sem custo no Custos SAP'}</small></div>
        <div><span>Saldo SAP</span><b>${kgF(i.kg)}</b><small>Custos SAP + movimentos</small></div>
        <div><span>Dias parado</span><b style="color:${cor}">${i.dias}${i.semHist ? '+' : ''}</b><small>${i.semHist ? 'sem histórico na base' : 'desde ' + dC(i.ultUso)}</small></div>
        <div><span>Dono</span><b class="sud-txt">${esc(i.dono)}</b><small>${esc(i.categoria)}</small></div>
      </div>
      <div class="sud-g2">
        ${sec('Consumo e saldo', 'últimos 12 meses', det.serie.length ? ch(W => consumoSaldo(det.serie, W)) : '<p class="sud-hint">Sem movimentos SAP no período.</p>')}
        ${sec('Onde este material tem uso', `outras centrais${det.uf ? ' de ' + esc(det.uf) : ' do mesmo estado'}, últimos 90 dias`, outras(i, det.outras, det.uf))}
      </div>
      ${sec('Tempo parado', `régua ${i.semHist ? 'do início da base' : 'do último uso'} até ${dF(D.ref)} · pontos = ações`, ch(W => regua(i, det.ev, W)))}
      ${sec('Linha do tempo', i.semHist ? 'desde o início da base' : 'do último uso até hoje', `<div class="sud-ferr">
          <button class="sud-chip${st.tl.size ? '' : ' on'}" onclick="SUD.tlTipo('')">Tudo</button>${TL_F.filter(([k]) => conta(k)).map(([k, r]) => `<button class="sud-chip${st.tl.has(k) ? ' on' : ''}" onclick="SUD.tlTipo('${k}')"><i class="sud-dot" style="background:${TL[k][1]}"></i>${conta(k)} ${r}</button>`).join('')}</div>
        <div class="sud-tl">${hoje}${ev.map(e => `<div class="sud-ev" style="--c:${TL[e.tipo][1]}"><span class="dt">${dC(e.d)}</span><span class="mk"><i${e.tipo === 'sap' ? ' class="cheio"' : ''}></i></span>
          <div class="tx"><span class="tp">${TL[e.tipo][0]}</span><b>${esc(e.tit)}</b>${e.b || e.txt ? `<p>${e.b ? `<b>${esc(e.b)}.</b> ` : ''}${esc(e.txt || '')}</p>` : ''}</div></div>`).join('')}</div>`)}
      ${cfg.acoes ? `<div class="sud-acoes">${cfg.acoes}</div>` : ''}
    </div>`;
  }

  // ── Montagem ───────────────────────────────────────────────────────────
  function filtrados() { return D.its.filter(i => !st.cent || i.central === st.cent); }
  function dash() {
    const its = vis = filtrados();
    const abas = [['geral', 'Visão geral'], ['onde', 'Onde está'], ['trat', 'Tratativas', its.filter(i => !i.trat).length], ['itens', 'Itens', its.length]];
    const corpo = !its.length ? '<p class="sud-hint">Nenhum material sem uso com esses filtros.</p>' : { geral: abaGeral, onde: abaOnde, trat: abaTrat, itens: abaItens }[st.aba](its);
    return `<div class="sud-dash">
      ${cfg.modo === 'tela' ? `<div class="sud-cab"><h3>Material sem uso</h3><span class="sud-hint">Dias até ${dF(D.ref)} (movimento SAP mais recente) · base desde ${dF(D.ini)}</span>${cfg.baixar || ''}</div>` : ''}
      ${st.cent ? `<div class="sud-filtro">Central: <b>${esc(st.cent)}</b> <button class="sud-chip" onclick="SUD.central(-1)">✕ limpar</button></div>` : ''}
      <div class="sud-abas" role="tablist">${abas.map(([k, r, n]) => `<button role="tab" aria-selected="${st.aba === k}" class="sud-aba${st.aba === k ? ' on' : ''}" onclick="SUD.aba('${k}')">${r}${n != null ? `<span>${n}</span>` : ''}</button>`).join('')}</div>
      <div class="sud-pane">${corpo}</div></div>
      <p class="sud-hint sud-rod">Atenção a partir de 60 dias, Urgente a partir de 90, Crítico a partir de 120. Não contam como uso: Y11, Y12, 551 e estornos. Tratativa (comentário com causa "Sem uso" ou Solicitação de coleta) vale 30 dias.</p>`;
  }
  function interno() {
    cache = { cent: cache.cent || [], txt: cache.txt || [], ch: [] };
    if (cfg.modo === 'tela') {
      const i = cfg.sel && D.its.find(x => x.k === cfg.sel);
      return i ? `<div class="sud-dash">${detalhe(i, `<button class="btn btn-sm" onclick="${cfg.voltar}">← Painel</button>`)}</div>` : dash();
    }
    const i = st.sel != null && D.its.find(x => x.k === st.sel);
    return dash() + (i ? `<div class="sud-fundo" onclick="SUD.fechar()"></div><aside class="sud-gaveta" role="dialog" aria-label="Material sem uso">${detalhe(i, '<button class="btn btn-sm" onclick="SUD.fechar()">✕ Fechar</button>')}</aside>` : '');
  }
  function redesenhar() {
    const el = document.getElementById('sud-root'); if (!el) return;
    const foco = document.activeElement && document.activeElement.id === 'sud-busca';
    el.innerHTML = interno();
    desenhar();
    if (foco) { const b = document.getElementById('sud-busca'); if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); } }
  }
  // Balão próprio (data-sud-tip), o mesmo na tela e no arquivo.
  function ligarBalao() {
    if (window._sudTip) return; window._sudTip = true;
    let tip = null;
    const pos = (e) => { const w = tip.offsetWidth, h = tip.offsetHeight; let x = e.clientX + 14, y = e.clientY + 14;
      if (x + w > innerWidth - 8) x = e.clientX - w - 10; if (y + h > innerHeight - 8) y = e.clientY - h - 10;
      tip.style.left = Math.max(8, x) + 'px'; tip.style.top = Math.max(8, y) + 'px'; };
    const ver = (e) => { const a = e.target.closest && e.target.closest('[data-sud-tip]');
      if (!a || !a.dataset.sudTip) { if (tip) tip.style.display = 'none'; return; }
      if (!tip) { tip = document.createElement('div'); tip.className = 'sud-tip'; document.body.appendChild(tip); }
      tip.innerHTML = decodeURIComponent(a.dataset.sudTip); tip.style.display = 'block'; pos(e); };
    document.addEventListener('mousemove', ver); document.addEventListener('click', ver);
    window.addEventListener('scroll', () => { if (tip) tip.style.display = 'none'; }, { passive: true });
    let t = null; window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(desenhar, 150); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && st.sel != null && cfg.modo === 'arq') SUD.fechar(); });
  }

  return {
    html(dados, c) { D = dados; cfg = c || {}; if (cfg.modo === 'arq' && cfg.sel) { st.sel = cfg.sel; cfg.sel = null; } ligarBalao(); setTimeout(desenhar); return `<div id="sud-root" class="sud">${interno()}</div>`; },
    aba(k) { st.aba = k; redesenhar(); },
    itens(f) { st.aba = 'itens'; st.fil = f || ''; redesenhar(); },
    buscar(n) { st.aba = 'itens'; st.fil = ''; st.busca = cache.txt[n] || ''; redesenhar(); },
    digitar(v) { st.busca = v; const el = document.getElementById('sud-tab'); if (el) el.innerHTML = tabela(vis); },
    ordenar(k) { st.ord = st.ord[0] === k ? [k, -st.ord[1]] : [k, k === 'material' || k === 'central' ? 1 : -1]; redesenhar(); },
    central(n) { const c = n < 0 ? '' : cache.cent[n]; st.cent = st.cent === c ? '' : c; redesenhar(); },
    tlTipo(k) { if (!k) st.tl.clear(); else if (st.tl.has(k)) st.tl.delete(k); else st.tl.add(k); redesenhar(); },
    abrir(idx) { const i = vis[idx]; if (!i) return; st.tl.clear();
      if (cfg.modo === 'tela') { if (typeof window[cfg.abrir] === 'function') window[cfg.abrir](i.k); } else { st.sel = i.k; redesenhar(); } },
    fechar() { st.sel = null; redesenhar(); }
  };
}
var SUD = SUD_FONTE();
