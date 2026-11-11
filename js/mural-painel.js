// ═══════════════════════════════════════════════════════════
// OPERAÇÕES — lista + painel
// ═══════════════════════════════════════════════════════════
// Hugo, 10/11/2026 (opção B do quadro de layouts): à esquerda a lista
// Regional → Central → Item; à direita um painel que muda com a seleção:
//   Geral (nada selecionado) → Regional → Central → Item (o Raio-X).
// Mesmos blocos em todo nível: Saúde (variação do período, acumulado,
// tendência da saúde e o donut da Macro), Pendências, O que mais pesa, Ações.
// 11/11/2026: única visão das Operações. Os números são os da Visão Micro
// (window.__anPares, período do Analítico, base de quem está olhando): lista,
// painel e card da Micro mostram o mesmo valor. Depende de mural.js (estado
// _mo) e macro.js (_renderDonut).

const _mp = { sel: { tipo: 'geral' }, aba: 'fila', busca: '', pend: new Map(), acum: new Map(), explic: new Map(), entPorCentral: null, carimbo: '', gen: 0 };

const MP_NIVEL_COR = { critico: 'var(--red)', urgente: 'var(--urgente)', atencao: 'var(--amber)', bom: 'var(--green)' };
const _mpIco = (n, cls = 'mp-ico') => `<i class="ti ${_levelIcon[n] || 'ti-minus'} ${cls}" style="color:${MP_NIVEL_COR[n] || 'var(--text3)'}" aria-hidden="true"></i>`;
const _mpCor = (v) => v < -0.05 ? 'var(--red)' : v > 0.05 ? 'var(--amber)' : 'var(--text2)';
const _mpChave = (c, m) => c + '|' + m;

// Período do Analítico no topo: deixa claro de onde vêm os números.
function _mpTopoHtml() {
  const P = muralPeriodo();
  return `<div class="mp-switch"><span class="mo-hint"><i class="ti ti-calendar"></i> Período do Analítico: <b>${P ? `${fmtPtDate(P.ini)} a ${fmtPtDate(P.fim)}` : '—'}</b> · mesma conta da Visão Micro</span></div>`;
}

// ── Pares e saúde ──────────────────────────────────────────────────────────
// Todo par da análise: fila (fora da faixa, com os filtros da barra), faixa e
// sem lançamento no último dia (sl: AUSENTE na Micro, com o mesmo valor dela;
// entra nos totais, como lá).
function _mpPares(itens) {
  // A busca NÃO filtra pares: a lista mostra cada termo como o que ele é (_mpListaHtml).
  const fila = _muralAplicarFiltros(itens).map(i => ({ central: i.central, regional: i.regional || '—', material: i.material,
    v: i.v, rs: i.rs || 0, catKey: i.catKey, nivel: i.nivel, it: i }));
  const faixa = _muralFaixaFiltradas().map(l => ({ central: l.central, regional: l.regional || '—', material: l.material,
    v: l.v, rs: 0, catKey: getCatKeyDoCadastro(l.material) || detectCatKey(l.categoria), nivel: 'bom', fx: l }));
  const sem = _mo.fotos.flatMap(f => (f.atual.payload.semLanc || []).map(x => ({ ...x, dono: _muralDonoDe(f.categoria).nome })))
    .filter(x => _muralAplicarFiltros([{ regional: x.regional, central: x.central, categoriaFoto: x.categoria, material: x.material, v: x.v, dono: { nome: x.dono } }], true).length)
    .map(x => ({ central: x.central, regional: x.regional || '—', material: x.material, v: x.v, rs: x.rs || 0, catKey: x.catKey, nivel: x.nivel, sl: x }));
  return fila.concat(faixa, sem);
}

// Nível da regional/central: a mesma conta do card da Micro e da Macro
// (calcHealthScore sobre a variação de cada par; 'ok' = bom).
function _mpSaude(ps) {
  const r = calcHealthScore(ps.map(p => ({ mat: p.material, diff: p.v, catKey: p.catKey })), null, null, getHealthThresholds());
  return { score: r.score, nivel: r.level === 'ok' ? 'bom' : r.level };
}

function _mpAgrupar(ps, chave) {
  const m = new Map();
  ps.forEach(p => { const k = chave(p); if (!m.has(k)) m.set(k, []); m.get(k).push(p); });
  return m;
}

// Ordem: fila pela prioridade (a maior de dentro), faixa por quanto da faixa usa.
const _mpPeso = (p) => p.it ? p.it.prioridade : p.sl ? Math.abs(p.v) / 1e6 : (p.fx?.pct || 0) / 100;
const _mpPesoGrupo = (ps) => Math.max(...ps.map(_mpPeso));

// Saúde dia a dia no período: o nível de cada par em cada dia sai da série
// do período (a mesma do Raio-X, _muralSeriePar, com cache) e a saúde do dia
// é a mesma conta do centro do donut e do card da Micro. Calculada em segundo plano (_mpDepois).
async function _mpSerieSaude(ps, gen) {
  const th = getHealthThresholds(), series = [];
  const ced = { t: performance.now() };
  for (let i = 0; i < ps.length; i++) {
    series.push({ catKey: ps[i].catKey, s: _muralSeriePar(ps[i].central, ps[i].material, ps[i].catKey) });
    await muralCederTempo(ced); if (gen !== _mp.gen) return null;
  }
  const nDias = series.find(x => x.s)?.s.acc.length || 0;
  const out = [];
  for (let d = 0; d < nDias; d++)
    out.push(calcHealthScore(series.map(x => ({ mat: '', diff: x.s ? (x.s.acc[d] || 0) : 0, catKey: x.catKey })), null, null, th).score);
  return out;
}

function _mpTendHtml(serie) {
  const P = muralPeriodo();
  const d = serie.length > 1 ? serie[serie.length - 1] - serie[0] : 0;
  const corT = d < 0 ? 'var(--red)' : d > 0 ? 'var(--green)' : 'var(--text2)';
  const W = 200, H = 54, mx = serie.length > 1 ? (W - 8) / (serie.length - 1) : 0, y = (s) => (H - 4 - s / 100 * (H - 10)).toFixed(1);
  const pts = serie.map((s, i) => `${(4 + i * mx).toFixed(1)},${y(s)}`).join(' ');
  return `<div class="mp-saude-tend-l"><span class="mo-hint">Saúde no período</span><b style="color:${corT}">${d < 0 ? '▼ piorando' : d > 0 ? '▲ melhorando' : '→ estável'}</b></div>
    ${serie.length > 1 ? `<svg width="100%" viewBox="0 0 ${W} ${H}" role="img" aria-label="Saúde ${d < 0 ? 'piorando' : d > 0 ? 'melhorando' : 'estável'} no período" style="display:block">
      <polyline points="${pts}" fill="none" stroke="${corT}" stroke-width="2.2" stroke-linejoin="round"></polyline>
      <circle cx="${(4 + (serie.length - 1) * mx).toFixed(1)}" cy="${y(serie[serie.length - 1])}" r="3.5" fill="${corT}"></circle></svg>` : '<span class="mo-hint">Período de um dia só.</span>'}
    <div class="mp-saude-datas mono"><span>${P ? fmtPtDate(P.ini).slice(0, 5) : ''}</span><span>${P ? fmtPtDate(P.fim).slice(0, 5) : ''}</span></div>`;
}

// Entrada do _renderDonut para materiais (pares) de um escopo.
function _mpDonutMats(ps) {
  const counts = { bom: 0, atencao: 0, urgente: 0, critico: 0 }, meta = {}, itens = {};
  ['critico', 'urgente', 'atencao', 'bom'].forEach(l => { meta[l] = { diff: 0, custo: 0, w: 0 }; itens[l] = []; });
  ps.forEach(p => {
    counts[p.nivel]++;
    meta[p.nivel].diff += p.v; meta[p.nivel].custo += Math.abs(p.rs);
    if (p.it?.piorando) meta[p.nivel].w++;
    itens[p.nivel].push(`${p.material} (${p.central})`);
  });
  const levelMeta = Object.fromEntries(Object.entries(meta).map(([l, m]) => [l, { diff: m.diff, custo: m.custo, trend: m.w ? 'worsening' : null }]));
  // Centro do donut = Saúde da Micro (calcHealthScore), não a fórmula da Macro (Hugo, 11/11/2026).
  return { counts, levelMeta, itens, score: _mpSaude(ps).score, total: ps.length };
}

// Entrada do _renderDonut para centrais: nível de cada central pela saúde;
// variação/custo agregados pelo nível do par (como a Macro).
function _mpDonutCentrais(ps) {
  const porC = _mpAgrupar(ps, p => p.central);
  const counts = { bom: 0, atencao: 0, urgente: 0, critico: 0 }, itens = {}, cent = [];
  porC.forEach((cps, c) => {
    const s = _mpSaude(cps);
    counts[s.nivel]++; (itens[s.nivel] = itens[s.nivel] || []).push(c);
    const k = { critico: 0, urgente: 0, atencao: 0, bom: 0 }; cps.forEach(p => k[p.nivel]++);
    cent.push({ central: c, regional: cps[0].regional, ...s, k, v: cps.reduce((t, p) => t + p.v, 0) });
  });
  const piores = cent.filter(c => c.nivel !== 'bom')
    .sort((a, b) => (b.k.critico - a.k.critico) || (b.k.urgente - a.k.urgente) || (b.k.atencao - a.k.atencao) || (Math.abs(b.v) - Math.abs(a.v)))
    .slice(0, 5);
  return { counts, levelMeta: _mpDonutMats(ps).levelMeta, itens, score: _mpSaude(ps).score, total: porC.size, piores };
}

// ── Pendências (por central, sob demanda, com cache) ──────────────────────
// NF da PUZL sem entrada no SAP e OS da PUZL sem baixa no SAP: a mesma conta
// das "NFs/OS pendentes" da Micro (calcPendentesIntegracao), no período do Analítico.
function _mpCarimbo() {
  const P = muralPeriodo();
  return [_mo.gen, state.sap?.length, state.entradas?.length, state.saidas?.length, P ? localISODate(P.ini) + localISODate(P.fim) : ''].join('|');
}
function _mpPendCentral(central) {
  const car = _mpCarimbo();
  if (car !== _mp.carimbo) { _mp.carimbo = car; _mp.pend.clear(); _mp.acum.clear(); _mp.explic.clear(); _mp.entPorCentral = null; }
  if (_mp.pend.has(central)) return _mp.pend.get(central);
  if (!_mp.entPorCentral) {
    _mp.entPorCentral = new Map();
    (state.entradas || []).forEach(e => {
      const c = e.centralCompra || e.centralDestino || '';
      if (!_mp.entPorCentral.has(c)) _mp.entPorCentral.set(c, []);
      _mp.entPorCentral.get(c).push(e);
    });
  }
  const P = muralPeriodo();
  const ini = P.ini, fim = new Date(P.fim); fim.setHours(23, 59, 59, 999);
  const sap = (getSapIndex().byCentral.get(central) || []).filter(r => { const d = parseDate(r.dtLanc); return d && d >= ini && d <= fim; });
  const r = calcPendentesIntegracao({ central, dtIni: ini, dtFim: fim, sapNoPeriodo: sap, entradasDaCentral: _mp.entPorCentral.get(central) || [] });
  _mp.pend.set(central, r);
  return r;
}

// Explicado PUZL × SAP de um item da fila (a mesma conta do Raio-X), com
// cache por análise (_mp.explic é limpo junto com as pendências).
function _mpExplicPar(p) {
  const k = _mpChave(p.central, p.material);
  if (!_mp.explic.has(k)) _mp.explic.set(k, muralRaioXCalcular(p.central, p.material, p.catKey, 'mes')?.explic || []);
  return _mp.explic.get(k);
}

// Pendências de um escopo. OS duplicadas e lançamentos pendentes já vêm nos pares.
// soMat: no escopo de um Material, só as NFs/OSs desse material.
function _mpPendEscopo(ps, centrais, soMat = null) {
  const nf = [], os = [], m = soMat ? normalizeText(soMat) : null;
  const doMat = (e) => !m || normalizeText(e.material || '') === m;
  centrais.forEach(c => { const r = _mpPendCentral(c); nf.push(...r.pendNF.filter(doMat).map(e => ({ ...e, _c: c }))); os.push(...r.pendOS.filter(doMat).map(e => ({ ...e, _c: c }))); });
  const dup = [];
  // OS duplicadas: do explicado de cada item da fila (_mpExplicPar, sob demanda);
  // null enquanto não foi calculado para todos.
  let prontos = true;
  ps.forEach(p => { if (!p.it) return; const ex = _mp.explic.get(_mpChave(p.central, p.material)); if (!ex) { prontos = false; return; }
    ex.forEach(e => { if (e.chave === 'duplicada' && e.lado === 'sai') dup.push({ p, n: e.n, kg: e.kg }); }); });
  if (!prontos) dup.pendente = true;
  const lanc = ps.filter(p => p.sl);
  return { nf, os, dup, lanc };
}

// ── Acumulado (inventários antes do período + o período), por par, com cache ──
function _mpAcumPar(p) {
  const k = _mpChave(p.central, p.material);
  if (!_mp.acum.has(k)) {
    const meses = _muralRxMeses(p.central, p.material, p.catKey, false).map(m => ({ chave: m.chave, rot: m.rot, v: m.v }));
    const fech = meses.filter(m => m.v != null);
    _mp.acum.set(k, { v: fech.reduce((t, m) => t + m.v, 0), n: fech.length, meses });
  }
  const a = _mp.acum.get(k);
  return { v: a.v + p.v, n: a.n, meses: a.meses };
}

// ── Inventário a inventário do escopo (Hugo, 10/11/2026) ──────────────────
// Linha da variação LÍQUIDA por inventário: soma, mês a mês, da variação de
// inventário de todos os pares da regional/central (mesma conta do gráfico
// de barras do Raio-X) + o período do Analítico (tracejado). Sai do cache do
// acumulado, então não custa cálculo a mais. Desenhado na largura real.
function _mpInvHtml(ps, larg) {
  const P = muralPeriodo();
  const meses = new Map();
  ps.forEach(p => {
    const a = _mp.acum.get(_mpChave(p.central, p.material));
    (a?.meses || []).forEach(m => {
      if (!meses.has(m.chave)) meses.set(m.chave, { rot: m.rot, v: 0, n: 0, des: 0, sob: 0, pares: [] });
      if (m.v == null) return;
      const x = meses.get(m.chave);
      x.v += m.v; x.n++; if (m.v < 0) x.des += m.v; else x.sob += m.v;
      x.pares.push({ nome: `${p.material} · ${p.central}`, v: m.v });
    });
  });
  const ab = { rot: `${fmtPtDate(P.ini).slice(0, 5)}–${fmtPtDate(P.fim).slice(0, 5)}`, v: 0, n: ps.length, des: 0, sob: 0, pares: [], aberto: true };
  ps.forEach(p => { ab.v += p.v; if (p.v < 0) ab.des += p.v; else ab.sob += p.v; ab.pares.push({ nome: `${p.material} · ${p.central}`, v: p.v }); });
  const pts = [...[...meses.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, x]) => x), ab];
  const comV = pts.filter(x => x.n);
  if (comV.length < 2) return '<p class="mo-hint">Sem inventários suficientes neste escopo para traçar a linha.</p>';

  const W = Math.max(420, Math.round(larg)), H = 230, L = 96, R = 24, T = 26, B = 40, f = (v) => v.toFixed(1);
  const vals = comV.map(x => x.v), mn = Math.min(0, ...vals), mxv = Math.max(0, ...vals), pad = (mxv - mn || 1) * 0.12;
  const y = (v) => T + (mxv + pad - v) / (mxv - mn + 2 * pad) * (H - T - B);
  const x = (i) => L + (pts.length > 1 ? i * (W - L - R) / (pts.length - 1) : 0);
  const svg = [];
  // Eixo: máximo, zero e mínimo (pula rótulo a menos de 14 px de outro).
  const ticks = []; [mxv, 0, mn].forEach(v => { if (!ticks.some(t => Math.abs(y(t) - y(v)) < 14)) ticks.push(v); });
  ticks.forEach(v => svg.push(`<text x="${L - 10}" y="${f(y(v) + 4)}" text-anchor="end" class="mo-rx-ax">${_moPesoSinal(v)}</text>`));
  svg.push(`<line x1="${L}" x2="${W - R}" y1="${f(y(0))}" y2="${f(y(0))}" stroke="var(--border3)"/>`);
  // Linha: trechos contínuos entre meses com inventário; até o período, tracejada.
  const idx = pts.map((p, i) => (p.n ? i : -1)).filter(i => i >= 0);
  idx.forEach((i, k) => {
    if (!k) return;
    const j = idx[k - 1];
    svg.push(`<line x1="${f(x(j))}" y1="${f(y(pts[j].v))}" x2="${f(x(i))}" y2="${f(y(pts[i].v))}" stroke="var(--text2)" stroke-width="2.2"${pts[i].aberto || i - j > 1 ? ' stroke-dasharray="5 4"' : ''}/>`);
  });
  pts.forEach((p, i) => {
    svg.push(`<text x="${f(x(i))}" y="${H - 20}" text-anchor="middle" class="mo-rx-ax" style="fill:var(--text2)">${_moEsc(p.rot)}</text>`,
      `<text x="${f(x(i))}" y="${H - 6}" text-anchor="middle" class="mo-rx-ax">${p.aberto ? 'período' : p.n ? 'inventário' : 'sem inv.'}</text>`);
    if (!p.n) return;
    const c = _moRxHex(p.v), top = [...p.pares].sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 3);
    const grade = _moRxLinha('Variação líquida', _moKg(p.v), c) + _moRxLinha('Desfalques', _moKg(p.des), '#f43f5e')
      + _moRxLinha('Sobras', _moKg(p.sob), '#f59e0b') + _moRxLinha(p.aberto ? 'Pares' : 'Pares com inventário', `${p.n} de ${ps.length}`);
    const extra = `<div style="margin-top:10px;font-size:12.5px;color:var(--text2)">Os que mais pesam:</div>` + top.map(t =>
      `<div style="display:flex;gap:10px;font-size:12.5px;margin-top:3px"><span style="color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_moEsc(t.nome)}</span><span style="margin-left:auto;font-family:var(--mono);color:${_moRxHex(t.v)}">${_moKg(t.v)}</span></div>`).join('');
    const tip = _moRxTip(c, `${p.rot}${p.aberto ? ' · período do Analítico' : ''}`, '', grade, extra);
    const ly = p.v < 0 ? y(p.v) + 20 : y(p.v) - 11;
    svg.push(`<circle class="mo-rx-pt" cx="${f(x(i))}" cy="${f(y(p.v))}" r="5" fill="${c}"${p.aberto ? ' fill-opacity=".45" stroke="' + c + '" stroke-width="1.5"' : ''} data-tip="${tip}" data-col="${c}"/>`,
      `<text x="${f(x(i))}" y="${f(ly)}" text-anchor="middle" class="mo-rx-ax" style="fill:${c};font-weight:600;pointer-events:none">${_moPesoSinal(p.v)}</text>`);
  });
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Variação líquida de inventário a inventário" style="display:block;overflow:visible">${svg.join('')}</svg>`;
}

// ── Visões da lista (Hugo, 11/11/2026: as 3 da Visão Micro) ──────────────
//   regional → Regional › Central › itens
//   central  → Central › itens
//   material → Material › centrais (cada par)
_mp.grupo = (() => { try { return localStorage.getItem('mural.grupo') || 'regional'; } catch (_) { return 'regional'; } })();
function muralPainelGrupo(g) {
  _mp.grupo = g; _mp.sel = { tipo: 'geral' }; _mo.rx = null;
  try { localStorage.setItem('mural.grupo', g); } catch (_) { /* sem storage */ }
  muralRender();
}
// O par está no escopo selecionado (regional, central ou material)?
const _mpNoEscopo = (p, s) => s.tipo === 'regional' ? p.regional === s.regional
  : s.tipo === 'material' ? p.material === s.material : p.central === s.central;

// ── Seleção ────────────────────────────────────────────────────────────────
// via: de qual bloco da lista a seleção veio — 'reg' (Regional › Central ›
// itens), 'cen' (Central › itens) ou 'mat' (Material › centrais). Decide qual
// bloco abre e para onde o "×" do Raio-X volta. Sem via (cliques no painel),
// vale a da seleção atual ou a da visão escolhida.
const _MP_VIA_DO_GRUPO = { regional: 'reg', central: 'cen', material: 'mat' };
function muralPainelSel(el) {
  const d = el.dataset, s = _mp.sel;
  const via = d.via || (s.tipo !== 'geral' && s.via) || _MP_VIA_DO_GRUPO[_mp.grupo];
  // Clicar de novo no que já está aberto sobe um nível.
  if (d.t === 'regional' && s.tipo === 'regional' && s.regional === d.r) _mp.sel = { tipo: 'geral' };
  else if (d.t === 'central' && s.tipo === 'central' && s.central === d.c) _mp.sel = via === 'reg' ? { tipo: 'regional', regional: d.r, via } : { tipo: 'geral' };
  else if (d.t === 'material' && s.tipo === 'material' && s.material === d.m) _mp.sel = { tipo: 'geral' };
  else _mp.sel = d.t === 'geral' ? { tipo: 'geral' } : { tipo: d.t, regional: d.r, central: d.c, material: d.m, via };
  if (_mp.sel.tipo !== 'item') _mo.rx = null;
  if (typeof _hideTip === 'function') _hideTip();
  muralRender();
}
function muralPainelVoltar() {
  const s = _mp.sel;
  _mp.sel = s.tipo !== 'item' ? { tipo: 'geral' }
    : s.via === 'mat' ? { tipo: 'material', material: s.material, via: 'mat' }
    : { tipo: 'central', regional: s.regional, central: s.central, via: s.via };
  muralRender();
}
function muralPainelAba(a) { _mp.aba = a; muralRender(); }
// Time (Geral): clicar no analista filtra a lista pelas categorias dele.
function muralPainelDono(el) { _mo.f.categoria = new Set(JSON.parse(el.dataset.cats || '[]')); _mp.sel = { tipo: 'geral' }; muralRender(); }
let _mpBuscaT = null;
function muralPainelBusca(q) {
  _mp.busca = q;
  clearTimeout(_mpBuscaT);
  _mpBuscaT = setTimeout(() => {
    muralRender();
    const i = document.getElementById('mp-busca');
    if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }, 250);
}
// Termos da busca: vários, separados por vírgula ou ponto e vírgula.
function _mpTermos() { return String(_mp.busca || '').split(/[,;]+/).map(t => normalizeText(t.trim())).filter(Boolean); }

// ── Lista (esquerda) ───────────────────────────────────────────────────────
function _mpLinhaAttrs(t, p, via = '') {
  return `onclick="muralPainelSel(this)" data-t="${t}" data-r="${_moEsc(p.regional || '')}" data-c="${_moEsc(p.central || '')}" data-m="${_moEsc(p.material || '')}"${via ? ` data-via="${via}"` : ''}`;
}

// Linha de um par (item). Sob um Material o título é a central.
function _mpItemLinha(p, s, recuo, via) {
  let sit, sitCor = 'var(--text2)';
  if (p.it) {
    const pz = _muralPrazoTxt(p.it), pend = _moPendente(p.it);
    sit = `${(MURAL_STATUS[p.it.status] || {}).label || ''} · ${pz.t}${pend ? ` · lançamento ${pend} pendente` : ''}`;
    if (pz.red || p.it.status === 'escalonado') sitCor = 'var(--red)';
  } else if (p.sl) {
    sit = `Sem lançamento em ${(p.sl.esperado || '—').slice(0, 5)} · Est. Final AUSENTE (como na Micro)`;
    sitCor = 'var(--amber)';
  } else {
    sit = `${Math.round(p.fx.pct)}% da faixa · lançamento ${(p.fx.ult || '—').slice(0, 5)}`;
  }
  const porMat = via === 'mat';
  const esteItem = s.tipo === 'item' && s.central === p.central && s.material === p.material;
  return `<button class="mp-row mp-item ${recuo}${esteItem ? ' sel' : s.tipo === 'item' ? ' apagado' : ''}" ${_mpLinhaAttrs('item', p, via)}>
    ${_mpIco(p.nivel)}<span class="mp-nome"><b>${_moEsc(porMat ? p.central : p.material)}</b><small style="color:${sitCor}">${porMat ? _moEsc(p.regional) + ' · ' : ''}${_moEsc(sit)}</small></span>
    <span class="mp-v" style="color:${_mpCor(p.v)}">${_moPesoSinal(p.v)}</span></button>`;
}

// Linha de grupo (regional, central ou material): o número é o total de
// TODOS os pares do grupo, o mesmo do painel e da Micro.
function _mpGrupoLinha(t, dados, titulo, sub, gTodos, aberta, sel, recuo, apagado, via) {
  const sG = _mpSaude(gTodos), v = gTodos.reduce((a, p) => a + p.v, 0);
  return `<button class="mp-row ${recuo}${sel ? ' sel' : apagado ? ' apagado' : ''}" ${_mpLinhaAttrs(t, dados, via)} title="Saúde ${sG.score}%">
    <i class="ti ti-chevron-${aberta ? 'down' : 'right'} mp-chev"></i>${_mpIco(sG.nivel)}
    <span class="mp-nome"><b>${_moEsc(titulo)}</b><small>${sub}</small></span>
    <span class="mp-v" style="color:${_mpCor(v)}">${_moPesoSinal(v)}</span></button>`;
}

// Botões de visão (Regional / Central / Material): no começo da barra de
// filtros, antes de "Regional", como na Micro (Hugo, 11/11/2026). Com busca
// ficam esmaecidos — cada resultado aparece como o que ele é.
function _mpGruposHtml() {
  const g = _mp.grupo, busca = _mpTermos().length;
  const grupos = [['regional', 'ti-users-group', 'Por Regional — regional → central → itens'],
                  ['central', 'ti-building-warehouse', 'Por Central — central → itens'],
                  ['material', 'ti-box', 'Por Material — material → centrais']];
  return `<div class="micro-group-mode mp-grupos${busca ? ' mp-grupos-off' : ''}" role="group" aria-label="Agrupar a lista"${busca ? ' title="Com busca, cada resultado aparece como o que ele é (regional, central ou material)"' : ''}>${grupos.map(([k, ic, t]) =>
    `<button class="${g === k ? 'active' : ''}" onclick="muralPainelGrupo('${k}')" title="${t}" aria-label="${t}" aria-pressed="${g === k}"><i class="ti ${ic}"></i></button>`).join('')}</div>
    <div class="micro-filter-divider"></div>`;
}

// A aba só decide QUAIS ITENS aparecem; o número de cada grupo é sempre o
// total de todos os pares dele (fila + faixa + sem lançamento) — o mesmo do
// cabeçalho do painel e do card da Visão Micro (Hugo, 11/11/2026).
// Sem busca: a visão escolhida (Regional, Central ou Material). Com busca:
// cada termo aparece COMO O QUE ELE É — regional na seção Regionais, central
// em Centrais, material em Materiais —, qualquer que seja a visão (Hugo).
// Lista recolhível para a lateral (Hugo, 11/11/2026): vira uma faixa fina e o
// painel ocupa a largura; a escolha fica guardada neste navegador.
_mp.listaRecolhida = (() => { try { return localStorage.getItem('mural.listaRecolhida') === '1'; } catch (_) { return false; } })();
function muralPainelLista() {
  _mp.listaRecolhida = !_mp.listaRecolhida;
  try { localStorage.setItem('mural.listaRecolhida', _mp.listaRecolhida ? '1' : '0'); } catch (_) { /* sem storage */ }
  if (typeof _hideTip === 'function') _hideTip();
  muralRender();
}
function _mpListaHtml(todos) {
  if (_mp.listaRecolhida) {
    const n = todos.filter(p => p.it).length;
    return `<section class="mp-lista recolhida"><button class="mp-lista-abrir" onclick="muralPainelLista()" title="Mostrar a lista" aria-label="Mostrar a lista" aria-expanded="false">
      <i class="ti ti-layout-sidebar-left-expand"></i><span>Lista · ${n} na fila</span></button></section>`;
  }
  const s = _mp.sel, aba = _mp.aba, g = _mp.grupo, termos = _mpTermos();
  const daAba = (p) => aba === 'faixa' ? !!p.fx : aba === 'sem' ? !!p.sl : !!p.it;
  const vis = todos.filter(daAba);
  const rotAba = { fila: 'na fila', faixa: 'na faixa', sem: 'sem lançamento' }[aba];
  const ordenar = (m) => [...m].sort((a, b) => _mpPesoGrupo(b[1]) - _mpPesoGrupo(a[1]));
  const plural = (n, s1, sN) => `${n} ${n === 1 ? s1 : sN}`;
  const tem = s.tipo !== 'geral'; // com seleção, o que está fora do caminho esmaece
  const itens = (ps, recuo, via) => ps.sort((a, b) => _mpPeso(b) - _mpPeso(a)).map(p => _mpItemLinha(p, s, recuo, via)).join('');
  const naCentral = s.tipo === 'central' || s.tipo === 'item';

  const blocoMat = ([m, mps]) => {
    const aberta = s.via === 'mat' && s.material === m && (s.tipo === 'material' || s.tipo === 'item');
    const ncent = new Set(mps.map(p => p.central)).size;
    return `<div class="mp-bloco${aberta ? ' aberto' : ''}">` + _mpGrupoLinha('material', { material: m }, m, `${plural(ncent, 'central', 'centrais')} · ${mps.length} ${rotAba}`,
      todos.filter(p => p.material === m), aberta, s.via === 'mat' && s.tipo === 'material' && s.material === m, 'mp-reg', tem && !aberta, 'mat')
      + (aberta ? itens(mps, 'mp-item-1', 'mat') : '') + '</div>';
  };
  const blocoCen = ([c, cps]) => {
    const aberta = s.via === 'cen' && s.central === c && naCentral;
    return `<div class="mp-bloco${aberta ? ' aberto' : ''}">` + _mpGrupoLinha('central', { regional: cps[0].regional, central: c }, c, `${_moEsc(cps[0].regional)} · ${cps.length} ${rotAba}`,
      todos.filter(p => p.central === c), aberta, s.via === 'cen' && s.tipo === 'central' && s.central === c, 'mp-reg', tem && !aberta, 'cen')
      + (aberta ? itens(cps, 'mp-item-1', 'cen') : '') + '</div>';
  };
  const blocoReg = ([reg, rps]) => {
    const aberta = s.via === 'reg' && s.regional === reg && tem;
    const centrais = ordenar(_mpAgrupar(rps, p => p.central));
    let h = `<div class="mp-bloco${aberta ? ' aberto' : ''}">` + _mpGrupoLinha('regional', { regional: reg }, reg, `${plural(centrais.length, 'central', 'centrais')} · ${rps.length} ${rotAba}`,
      todos.filter(p => p.regional === reg), aberta, s.tipo === 'regional' && s.regional === reg, 'mp-reg', tem && !aberta, 'reg');
    if (!aberta) return h + '</div>';
    // Dentro da regional aberta: com uma central (ou item) escolhida, as outras centrais esmaecem.
    centrais.forEach(([c, cps]) => {
      const cAberta = s.central === c && naCentral;
      h += `<div class="mp-sub${cAberta ? ' aberto' : ''}">` + _mpGrupoLinha('central', { regional: reg, central: c }, c, `${cps.length} ${rotAba}`,
        todos.filter(p => p.central === c), cAberta, s.tipo === 'central' && s.central === c, 'mp-cen', naCentral && !cAberta, 'reg');
      if (cAberta) h += itens(cps, '', 'reg');
      h += '</div>';
    });
    return h + '</div>';
  };

  let linhas = '', contar = vis;
  if (termos.length) {
    const casa = (txt) => { const n = normalizeText(txt); return termos.some(t => n.includes(t)); };
    const secao = (titulo, grupos, bloco) => grupos.length ? `<div class="mp-secao">${titulo} <b>${grupos.length}</b></div>` + grupos.map(bloco).join('') : '';
    linhas = secao('Regionais', ordenar(_mpAgrupar(vis.filter(p => casa(p.regional)), p => p.regional)), blocoReg)
      + secao('Centrais', ordenar(_mpAgrupar(vis.filter(p => casa(p.central)), p => p.central)), blocoCen)
      + secao('Materiais', ordenar(_mpAgrupar(vis.filter(p => casa(p.material)), p => p.material)), blocoMat);
    contar = todos.filter(p => casa(p.regional) || casa(p.central) || casa(p.material));
  } else if (g === 'material') linhas = ordenar(_mpAgrupar(vis, p => p.material)).map(blocoMat).join('');
  else if (g === 'central') linhas = ordenar(_mpAgrupar(vis, p => p.central)).map(blocoCen).join('');
  else linhas = ordenar(_mpAgrupar(vis, p => p.regional)).map(blocoReg).join('');

  const contaAba = termos.length ? contar : todos;
  return `<section class="mp-lista">
    <div class="mp-lista-head">
      <div class="mp-lista-topo">
      <div class="mo-abas" role="tablist">
        ${[['fila', 'ti-flame', 'Fila', p => !!p.it], ['faixa', 'ti-circle-check', 'Na faixa', p => !!p.fx], ['sem', 'ti-calendar-x', 'Sem lançamento', p => !!p.sl]]
          .map(([k, ic, rot, f]) => `<button class="mo-aba${aba === k ? ' on' : ''}" role="tab" aria-selected="${aba === k}" onclick="muralPainelAba('${k}')"${k === 'sem' ? ' title="Sem lançamento no último dia do período (AUSENTE na Visão Micro)"' : ''}><i class="ti ${ic}"></i>${rot} <b>${contaAba.filter(f).length}</b></button>`).join('')}
      </div>
      <button class="mp-lista-recolher" onclick="muralPainelLista()" title="Recolher a lista para a lateral" aria-label="Recolher a lista" aria-expanded="true"><i class="ti ti-layout-sidebar-left-collapse"></i></button>
      </div>
      <label class="mp-busca"><i class="ti ti-search"></i><input id="mp-busca" type="text" placeholder="Buscar: regional, central, material… (separe por vírgula)" value="${_moEsc(_mp.busca)}" oninput="muralPainelBusca(this.value)" aria-label="Buscar regional, central ou material"></label>
    </div>
    <div class="mp-lista-corpo">${linhas || `<div class="empty-state" style="padding:24px"><p>${termos.length ? (contar.length ? 'Nada nesta aba — o número de cada aba mostra onde está.' : 'Nada encontrado.') : 'Nada com esses filtros.'}</p></div>`}</div>
  </section>`;
}
// ── Painel (direita) ──────────────────────────────────────────────────────
function _mpCabHtml(titulo, sub, ps) {
  const s = _mp.sel, v = ps.reduce((t, p) => t + p.v, 0), rs = ps.reduce((t, p) => t + p.rs, 0);
  const migalhas = [`<button class="mo-link" ${_mpLinhaAttrs('geral', {})}>Geral</button>`];
  if (s.tipo === 'central' && _mp.grupo === 'regional') migalhas.push(`<button class="mo-link" ${_mpLinhaAttrs('regional', { regional: s.regional })}>${_moEsc(s.regional)}</button>`);
  migalhas.push(`<span>${{ regional: 'Regional', central: 'Central', material: 'Material' }[s.tipo]}</span>`);
  return `<div class="mp-cab"><div style="min-width:0">
      <div class="mp-migalhas">${migalhas.join(' › ')}</div>
      <h2>${titulo}</h2><p class="mo-hint">${sub}</p></div>
    <div class="mp-cab-num"><b style="color:${_mpCor(v)}">${_moPesoSinal(v)}</b><span class="mo-hint mono">${_moRs(rs)}</span></div></div>`;
}

function _mpDonutCaixa(tipo) {
  return `<div class="macro-donut-area"><svg id="chart-${tipo}-donut" viewBox="0 0 420 300" width="100%" height="300" style="display:block;overflow:visible"></svg></div>
    <div class="macro-summary-row" id="chart-${tipo}-summary"></div>`;
}

function _mpSaudeHtml(ps) {
  const v = ps.reduce((t, p) => t + p.v, 0);
  return `<div class="mp-card mp-saude">
    <div class="mp-saude-esq">
      <div><span class="mo-hint">Variação do período</span><b class="mp-big" style="color:${_mpCor(v)}">${_moPesoSinal(v)}</b></div>
      <div id="mp-acum"><span class="mo-hint">Acumulado</span><b class="mp-big mo-hint">calculando…</b></div>
      <div class="mp-saude-tend" id="mp-tend"><span class="mo-hint">Saúde no período: calculando…</span></div>
    </div>
    <div class="mp-saude-dir">${_mpDonutCaixa('mp-mats')}</div>
  </div>`;
}

function _mpPendHtml() {
  return `<div class="mp-card"><h4 class="mp-tit">Pendências</h4><div id="mp-pend"><span class="mo-hint">Calculando as pendências…</span></div></div>`;
}

function _mpTopHtml(ps) {
  const top = ps.filter(p => p.it).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 5);
  return `<div class="mp-card"><h4 class="mp-tit">O que mais pesa</h4>${top.length ? top.map(p => `<button class="mp-lin" ${_mpLinhaAttrs('item', p)}>
      ${_mpIco(p.nivel)}<span class="mp-nome"><b>${_moEsc(_mp.sel.tipo === 'material' ? p.central : p.material)}</b>${_mp.sel.tipo === 'regional' ? `<small>${_moEsc(p.central)}</small>` : _mp.sel.tipo === 'material' ? `<small>${_moEsc(p.regional)}</small>` : ''}</span>
      <span class="mp-v" style="color:${_mpCor(p.v)}">${_moPesoSinal(p.v)}</span></button>`).join('') : '<p class="mo-hint">Nada fora da faixa aqui.</p>'}</div>`;
}

function _mpAcoesHtml(ps) {
  const ini = muralPeriodo().ini;
  let nCom = 0, nOc = 0, ult = null;
  ps.forEach(p => {
    const a = _muralAcoes(p.central, p.material, ini);
    nCom += a.comentarios.length; nOc += a.ocs.length;
    (typeof _varComDe === 'function' ? _varComDe(p.central, p.material) : []).forEach(r => {
      if (r.oc_id || !r.created_at) return;
      if (!ult || r.created_at > ult.created_at) ult = { ...r, central: p.central, material: p.material };
    });
  });
  return `<div class="mp-card"><h4 class="mp-tit">Ações no período</h4>
    <div class="mp-acoes-n"><span><b>${nCom}</b> comentário${nCom === 1 ? '' : 's'}</span><span><b>${nOc}</b> ocorrência${nOc === 1 ? '' : 's'} aberta${nOc === 1 ? '' : 's'}</span></div>
    ${ult ? `<div class="mp-ult"><span class="mo-hint">Último · ${_moEsc(ult.autor_nome || ult.autor || '—')} · ${new Date(ult.created_at).toLocaleDateString('pt-BR')} · ${_moEsc(ult.material)} · ${_moEsc(ult.central)}</span><div>${_moEsc(ult.texto || '')}</div></div>` : '<p class="mo-hint">Nenhum comentário neste período.</p>'}</div>`;
}

function _mpTimeHtml(itens) {
  if (!_moEhAdm()) return '';
  const porDono = new Map();
  _mo.donos.forEach(d => {
    const k = d.analista_user_id || d.categoria;
    if (!porDono.has(k)) porDono.set(k, { nome: d.analista_nome || '—', cats: [] });
    porDono.get(k).cats.push(d.categoria);
  });
  const linhas = [...porDono.values()].map(d => {
    const its = itens.filter(i => d.cats.includes(i.categoriaFoto));
    const trat = its.filter(i => !i.semTratamento).length, esc = its.filter(i => i.status === 'escalonado').length;
    return `<button class="mp-time-l" onclick="muralPainelDono(this)" data-cats="${_moEsc(JSON.stringify(d.cats))}" title="Filtrar a lista pelas categorias de ${_moEsc(d.nome)}">
      <span class="mp-nome"><b>${_moEsc(d.nome)}</b><small>${_moEsc(d.cats.join(', '))}</small></span>
      ${_muralBarraFech(its)}<span class="mono mo-hint">${trat}/${its.length}</span>
      <span class="mp-time-n"><b style="color:${esc ? 'var(--red)' : 'var(--text3)'}">${esc}</b> escalonado${esc === 1 ? '' : 's'}</span></button>`;
  }).join('');
  return `<div class="mp-card"><h4 class="mp-tit">Time</h4>${linhas}</div>`;
}

function _mpPainelHtml(todos, itensFila) {
  const s = _mp.sel;
  if (s.tipo === 'item') return `<div class="mp-rx" id="mp-rx" data-c="${_moEsc(s.central)}" data-m="${_moEsc(s.material)}"></div>`;
  if (s.tipo === 'geral') {
    const dc = _mpDonutCentrais(todos);
    _mp._donuts = { centrais: dc, mats: _mpDonutMats(todos) };
    return `${_muralPlacarHtml(itensFila, todos)}
      <div class="mp-dois">
        <div class="mp-card"><h4 class="mp-tit">Saúde das centrais <span class="mo-hint">${dc.total} centrais</span></h4>${_mpDonutCaixa('mp-centrais')}
          ${dc.piores.length ? `<div class="mo-hint" style="margin-top:6px">Piores — clique para abrir a central</div><div class="mp-chips">${dc.piores.map(c => `<button class="mp-chip" ${_mpLinhaAttrs('central', c)}>${_mpIco(c.nivel)}${_moEsc(c.central)} <b style="color:${MP_NIVEL_COR[c.nivel]}">${c.score}%</b></button>`).join('')}</div>` : ''}</div>
        <div class="mp-card"><h4 class="mp-tit">Materiais por nível <span class="mo-hint">${todos.length} pares</span></h4>${_mpDonutCaixa('mp-mats')}
          <div class="mo-hint" style="margin-top:6px">Mesma classificação da Visão Micro (inclui os sem lançamento no último dia, como lá).</div></div>
      </div>
      ${_mpPendHtml()}${_mpTimeHtml(_mo._ultItens || [])}`;
  }
  const ps = todos.filter(p => _mpNoEscopo(p, s));
  const centrais = [...new Set(ps.map(p => p.central))];
  const nF = ps.filter(p => p.it).length, nB = ps.filter(p => p.fx).length, nS = ps.filter(p => p.sl).length;
  const contas = `${nF} na fila · ${nB} na faixa${nS ? ` · ${nS} sem lançamento` : ''}`;
  const donos = _moEsc([...new Set(ps.filter(p => p.it).map(p => p.it.dono?.nome).filter(Boolean))].join(', ') || '—');
  const nCent = `${centrais.length} centra${centrais.length === 1 ? 'l' : 'is'}`;
  _mp._donuts = { mats: _mpDonutMats(ps) };
  const cab = s.tipo === 'regional' ? _mpCabHtml(_moEsc(s.regional), `${nCent} · ${contas}`, ps)
    : s.tipo === 'material' ? _mpCabHtml(_moEsc(s.material), `${_moEsc(getCategoriaPorGrupo(s.material) || '')} · ${nCent} · ${contas} · donos: ${donos}`, ps)
    : _mpCabHtml(_moEsc(s.central), `${_moEsc(s.regional)} · ${contas} · donos: ${donos}`, ps);
  // Regional: saúde de cada central. Material: cada central com este material,
  // pela variação (o par), e o clique abre o Raio-X dele.
  const rank = s.tipo === 'regional' ? `<div class="mp-card"><h4 class="mp-tit">Saúde das centrais da regional</h4>${centrais.map(c => ({ c, ...(_mpSaude(ps.filter(p => p.central === c))) }))
    .sort((a, b) => a.score - b.score).map(x => `<button class="mp-rank" ${_mpLinhaAttrs('central', { regional: s.regional, central: x.c })}>
      ${_mpIco(x.nivel)}<b>${_moEsc(x.c)}</b><span class="mp-rank-bar"><i style="width:${x.score}%;background:${MP_NIVEL_COR[x.nivel]}"></i></span><span class="mono" style="color:${MP_NIVEL_COR[x.nivel]}">${x.score}%</span></button>`).join('')}</div>`
    : s.tipo === 'material' ? (() => {
      const max = Math.max(1, ...ps.map(p => Math.abs(p.v)));
      return `<div class="mp-card"><h4 class="mp-tit">Centrais com ${_moEsc(s.material)} <span class="mo-hint">pela variação do período</span></h4>${[...ps].sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).map(p => `<button class="mp-rank mp-rank-mat" ${_mpLinhaAttrs('item', p)}>
        ${_mpIco(p.nivel)}<b>${_moEsc(p.central)}</b><span class="mp-rank-bar"><i style="width:${(Math.abs(p.v) / max * 100).toFixed(1)}%;background:${MP_NIVEL_COR[p.nivel]}"></i></span><span class="mono" style="color:${_mpCor(p.v)}">${_moPesoSinal(p.v)}</span></button>`).join('')}</div>`;
    })() : '';
  const inv = `<div class="mp-card"><h4 class="mp-tit">Variação de inventário a inventário <span class="mo-hint">soma líquida dos ${ps.length} pares</span></h4>
    <div id="mp-inv" class="mp-inv"><span class="mo-hint">Calculando os inventários…</span></div></div>`;
  return `${cab}${_mpSaudeHtml(ps)}${inv}${rank}${_mpPendHtml()}<div class="mp-dois">${_mpTopHtml(ps)}${_mpAcoesHtml(ps)}</div>`;
}

// ── Render ─────────────────────────────────────────────────────────────────
function muralPainelRender(el, itens) {
  const todos = _mpPares(itens);
  const fila = _muralAplicarFiltros(itens);
  // Seleção que sumiu (filtro, busca, item que saiu da fila) volta ao Geral.
  const s = _mp.sel;
  if (s.tipo !== 'geral' && !todos.some(p => s.tipo === 'item' ? (p.central === s.central && p.material === s.material) : _mpNoEscopo(p, s))) _mp.sel = { tipo: 'geral' };
  // Balão dos pontos do gráfico de inventários (o do Raio-X tem o seu, em #mp-rx).
  if (!el.dataset.mpTip && typeof _showTip === 'function') {
    el.dataset.mpTip = '1';
    el.addEventListener('mouseover', e => { const p = e.target.closest?.('.mp-inv .mo-rx-pt'); if (p) _showTip(e, decodeURIComponent(p.dataset.tip), p.dataset.col); });
    el.addEventListener('mousemove', e => { if (e.target.closest?.('.mp-inv .mo-rx-pt')) _moveTip(e); });
    el.addEventListener('mouseout', e => { if (e.target.closest?.('.mp-inv .mo-rx-pt')) _hideTip(); });
  }
  el.innerHTML = _mpTopoHtml() + `<div class="mp-root">${_muralFiltrosHtml(itens)}
    <div class="mp">${_mpListaHtml(todos)}
      <section class="mp-painel">${_mpPainelHtml(todos, fila)}</section></div></div>`;
  _mpDepois(todos);
}

// Depois do HTML: donuts (o próprio _renderDonut da Macro), Raio-X no painel
// e os blocos que demoram (pendências, acumulado) em segundo plano.
function _mpDepois(todos) {
  const gen = ++_mp.gen, s = _mp.sel, d = _mp._donuts || {};
  if (typeof _renderDonut === 'function') {
    if (d.centrais) _renderDonut('mp-centrais', d.centrais.counts, [], d.centrais.levelMeta, d.centrais.score, d.centrais.total, d.centrais.itens);
    if (d.mats) _renderDonut('mp-mats', d.mats.counts, [], d.mats.levelMeta, d.mats.score, d.mats.total, d.mats.itens);
  }
  if (s.tipo === 'item') {
    const mesmo = _mo.rx && _mo.rx.central === s.central && _mo.rx.mat === s.material;
    if (mesmo) _mo.rx.manterScroll = true;
    muralRaioX(s.central, s.material, mesmo ? _mo.rx.periodo : 'invs');
    return;
  }
  const ps = s.tipo === 'geral' ? todos : todos.filter(p => _mpNoEscopo(p, s));
  const comDocs = s.tipo === 'central' || s.tipo === 'material';
  const soMat = s.tipo === 'material' ? s.material : null;
  setTimeout(async () => { try {
    const ced = { t: performance.now() };
    const centrais = [...new Set(ps.map(p => p.central))];
    for (let i = 0; i < centrais.length; i++) {
      _mpPendCentral(centrais[i]);
      await muralCederTempo(ced); if (gen !== _mp.gen) return;
    }
    if (gen !== _mp.gen) return;
    const box = document.getElementById('mp-pend');
    if (box) box.innerHTML = _mpPendCorpoHtml(_mpPendEscopo(ps, centrais, soMat), comDocs);
    // Explicado (OS duplicadas) dos itens da fila do escopo — o caro; depois redesenha.
    // Os prazos da lista vêm primeiro (_muralEnriquecer); o explicado espera.
    while (_mo.enriquecendo) { await new Promise(r => setTimeout(r, 60)); if (gen !== _mp.gen) return; }
    const fila = ps.filter(p => p.it && !_mp.explic.has(_mpChave(p.central, p.material)));
    for (let i = 0; i < fila.length; i++) {
      _mpExplicPar(fila[i]);
      await muralCederTempo(ced); if (gen !== _mp.gen) return;
    }
    if (fila.length && box && gen === _mp.gen) box.innerHTML = _mpPendCorpoHtml(_mpPendEscopo(ps, centrais, soMat), comDocs);
    if (s.tipo === 'geral') return;
    let tot = 0, nInv = 0;
    for (let i = 0; i < ps.length; i++) {
      const a = _mpAcumPar(ps[i]); tot += a.v; nInv = Math.max(nInv, a.n);
      await muralCederTempo(ced); if (gen !== _mp.gen) return;
    }
    const ac = document.getElementById('mp-acum');
    if (ac) ac.innerHTML = `<span class="mo-hint">Acumulado</span><b class="mp-big" style="color:${_mpCor(tot)}">${_moPesoSinal(tot)}</b><small class="mo-hint">${nInv} inventário${nInv === 1 ? '' : 's'} + o período</small>`;
    const inv = document.getElementById('mp-inv');
    if (inv) inv.innerHTML = _mpInvHtml(ps, inv.clientWidth);
    const serie = await _mpSerieSaude(ps, gen);
    if (!serie || gen !== _mp.gen) return;
    const tend = document.getElementById('mp-tend');
    if (tend) tend.innerHTML = _mpTendHtml(serie);
  } catch (err) {
    // Nunca ficar em "calculando…" para sempre: mostra o erro no lugar.
    console.error('[Operações] Erro no cálculo do painel:', err);
    const msg = `<span class="mo-hint" style="color:var(--red)">Não foi possível calcular: ${_moEsc(err.message || String(err))}</span>`;
    ['mp-pend', 'mp-acum', 'mp-inv', 'mp-tend'].forEach(id => { const e = document.getElementById(id); if (e && /calculando/i.test(e.textContent)) e.innerHTML = msg; });
  } }, 0);
}

function _mpPendCorpoHtml(pd, comDocs) {
  const kg = (e) => typeof _convertNfPesoToKg === 'function' ? _convertNfPesoToKg(e.peso, e.um, e.material, e.fornecedor) : num(e.peso);
  const nDup = pd.dup.pendente ? null : pd.dup.reduce((t, x) => t + x.n, 0);
  const caixas = [
    [pd.nf.length, 'NF PUZL sem entrada SAP', 'var(--amber)'],
    [null, 'Cobranças de insumos', 'var(--text3)', 'seção em desenho'],
    [pd.os.length, 'OS PUZL sem baixa SAP', 'var(--amber)'],
    [nDup, 'OS duplicadas no SAP', 'var(--red)', nDup == null ? 'calculando…' : ''],
    [pd.lanc.length, 'Lançamentos pendentes', 'var(--amber)']
  ].map(([n, rot, cor, obs]) => `<div class="mp-pend-cx"><b style="color:${n ? cor : 'var(--text3)'}">${n == null ? '—' : n}</b><span>${rot}</span>${obs ? `<small class="mo-hint">${obs}</small>` : ''}</div>`).join('');
  if (!comDocs) return `<div class="mp-pend">${caixas}</div>`;
  // No escopo de um Material a coluna mostra a central (o material é o título).
  const quem = (mat, central) => _mp.sel.tipo === 'material' ? central : mat;
  const docs = [
    ...pd.nf.map(e => ['NF sem entrada SAP', 'var(--amber)', `NF ${e.nf}`, quem(e.material, e._c), kg(e), `descarga ${String(e.dtDescarga || e.dtEmissao || '').slice(0, 5)}`]),
    ...pd.dup.map(x => ['OS duplicada', 'var(--red)', `${x.n} OS`, quem(x.p.material, x.p.central), Math.abs(x.kg), 'no período']),
    ...pd.os.map(e => ['OS sem baixa SAP', 'var(--amber)', `OS ${e.os}`, quem(e.material, e._c), num(e.peso), `emitida ${String(e.dtEmissao || '').slice(0, 5)}`]),
    ...pd.lanc.map(p => ['Sem lançamento', 'var(--amber)', `dia ${(p.sl?.esperado || '').slice(0, 5)}`, quem(p.material, p.central), null, 'Est. Final AUSENTE'])
  ];
  const MAX = 40;
  return `<div class="mp-pend">${caixas}</div>
    ${docs.length ? `<div class="mp-docs">${docs.slice(0, MAX).map(([t, cor, doc, mat, peso, dt]) => `<div class="mp-doc">
      <span style="color:${cor}">${_moEsc(t)}</span><span class="mp-nome"><b>${_moEsc(doc)}</b><small>${_moEsc(mat || '')}</small></span>
      <span class="mono">${peso == null ? '—' : _moPeso(peso)}</span><span class="mo-hint">${_moEsc(dt)}</span></div>`).join('')}
      ${docs.length > MAX ? `<p class="mo-hint">+ ${docs.length - MAX} pendências</p>` : ''}</div>` : '<p class="mo-hint">Nenhuma pendência nesta central.</p>'}`;
}
