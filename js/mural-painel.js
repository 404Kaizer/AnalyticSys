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
  const r = muralSaude(ps.map(p => ({ mat: p.material, diff: p.v, catKey: p.catKey })), getHealthThresholds());
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
    out.push(muralSaude(series.map(x => ({ mat: '', diff: x.s ? (x.s.acc[d] || 0) : 0, catKey: x.catKey })), th).score);
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
  // Centro do donut = Saúde da Micro (calcHealthScore, via muralSaude: sem variação = bom), não a fórmula da Macro (Hugo, 11/11/2026).
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
// Guarda até MP_INV_MAX meses (o seletor de meses do inventário), mas o
// Acumulado continua sendo os últimos MURAL_RX_MESES inventários + o período.
const MP_INV_MAX = 12;
function _mpAcumPar(p) {
  const k = _mpChave(p.central, p.material);
  if (!_mp.acum.has(k)) {
    const meses = _muralRxMeses(p.central, p.material, p.catKey, false, MP_INV_MAX).map(m => ({ chave: m.chave, rot: m.rot, v: m.v }));
    const fech = meses.slice(-MURAL_RX_MESES).filter(m => m.v != null);
    _mp.acum.set(k, { v: fech.reduce((t, m) => t + m.v, 0), n: fech.length, meses });
  }
  const a = _mp.acum.get(k);
  return { v: a.v + p.v, n: a.n, meses: a.meses };
}

// Justificativas Operacionais (Visão Inventário) de um mês, só dos pares do
// escopo: chave 'AAAA-MM|||central|||material' em state.invJustificativas.
function _mpJustificativas(mesKey, ps) {
  const pares = new Set(ps.map(p => p.central + '|||' + p.material)), pre = mesKey + '|||';
  return (state.invJustificativas || []).filter(r => r && r.k && r.k.startsWith(pre) && pares.has(r.k.slice(pre.length)) && (r.op || r.fiscal))
    .map(r => { const [, central, material] = r.k.split('|||'); return { central, material, texto: String(r.op || r.fiscal), doc: r.documentoSap || '' }; });
}

// ── Inventário a inventário do escopo (Hugo, 10/11/2026) ──────────────────
// Linha da variação LÍQUIDA por inventário: soma, mês a mês, da variação de
// inventário de todos os pares da regional/central (mesma conta do gráfico
// de barras do Raio-X) + o período do Analítico (tracejado). Sai do cache do
// acumulado, então não custa cálculo a mais. Desenhado na largura real.
// opts.meses: Set das chaves 'AAAA-MM' (+ 'mes' = o período) a mostrar; sem
// ele, os últimos MURAL_RX_MESES inventários + o período. opts.sep: modo
// Separado da regional — em cada mês uma barra por central, lado a lado.
function _mpInvHtml(ps, larg, opts = {}) {
  const P = muralPeriodo();
  const meses = new Map(), soma = (x, central, nome, v) => {
    x.v += v; x.n++; if (v < 0) x.des += v; else x.sob += v;
    x.pares.push({ nome, v });
    const c = x.porC.get(central) || { v: 0, n: 0 }; c.v += v; c.n++; x.porC.set(central, c);
  };
  ps.forEach(p => {
    const a = _mp.acum.get(_mpChave(p.central, p.material));
    (a?.meses || []).forEach(m => {
      if (!meses.has(m.chave)) meses.set(m.chave, { chave: m.chave, rot: m.rot, v: 0, n: 0, des: 0, sob: 0, pares: [], porC: new Map() });
      if (m.v != null) soma(meses.get(m.chave), p.central, `${p.material} · ${p.central}`, m.v);
    });
  });
  const ab = { chave: 'mes', rot: `${fmtPtDate(P.ini).slice(0, 5)}–${fmtPtDate(P.fim).slice(0, 5)}`, v: 0, n: 0, des: 0, sob: 0, pares: [], porC: new Map(), aberto: true };
  ps.forEach(p => soma(ab, p.central, `${p.material} · ${p.central}`, p.v));
  const chaves = [...meses.keys()].sort();
  const sel = opts.meses || new Set([...chaves.slice(-MURAL_RX_MESES), 'mes']);
  const pts = [...chaves.filter(k => sel.has(k)).map(k => meses.get(k)), ...(sel.has('mes') ? [ab] : [])];
  const comV = pts.filter(x => x.n);
  if (!comV.length) return '<p class="mo-hint">Nenhum inventário nos meses escolhidos.</p>';
  // Separado: as centrais na ordem do peso nos meses mostrados; cor fixa por central.
  const sep = !!opts.sep, pesoC = new Map();
  if (sep) comV.forEach(p => p.porC.forEach((c, nome) => pesoC.set(nome, (pesoC.get(nome) || 0) + Math.abs(c.v))));
  const centrais = [...pesoC.keys()].sort((a, b) => pesoC.get(b) - pesoC.get(a));
  const corC = new Map(centrais.map((c, i) => [c, MP_PALETA[i % MP_PALETA.length]]));

  // Barras (Hugo, 18/11/2026): uma coluna por inventário + o período; a barra
  // sai do zero — desfalque vermelho para baixo, sobra âmbar para cima; o
  // período (ainda aberto) mais claro e com contorno tracejado. O balão abre
  // na coluna inteira (retângulo transparente com a classe mo-rx-pt).
  // Nunca menor que 560 px: abaixo disso os rótulos dos meses se atropelam;
  // em tela estreita (celular) o gráfico rola na horizontal (.mp-inv).
  const W = Math.max(560, Math.round(larg)), H = 230, L = 96, R = 24, T = 26, B = 40, f = (v) => v.toFixed(1);
  const vals = sep ? comV.flatMap(p => [...p.porC.values()].map(c => c.v)) : comV.map(x => x.v);
  const mn = Math.min(0, ...vals), mxv = Math.max(0, ...vals), pad = (mxv - mn || 1) * 0.12;
  const y = (v) => T + (mxv + pad - v) / (mxv - mn + 2 * pad) * (H - T - B);
  const slot = (W - L - R) / pts.length, bw = Math.min(slot * 0.46, 72), y0 = y(0);
  const x = (i) => L + (i + 0.5) * slot;
  const svg = [];
  // Eixo: máximo, zero e mínimo (pula rótulo a menos de 14 px de outro).
  const ticks = []; [mxv, 0, mn].forEach(v => { if (!ticks.some(t => Math.abs(y(t) - y(v)) < 14)) ticks.push(v); });
  ticks.forEach(v => svg.push(`<text x="${L - 10}" y="${f(y(v) + 4)}" text-anchor="end" class="mo-rx-ax">${_moPesoSinal(v)}</text>`));
  svg.push(`<line x1="${L}" x2="${W - R}" y1="${f(y0)}" y2="${f(y0)}" stroke="var(--border3)"/>`);
  pts.forEach((p, i) => {
    svg.push(`<text x="${f(x(i))}" y="${H - 20}" text-anchor="middle" class="mo-rx-ax" style="fill:var(--text2)">${_moEsc(p.rot)}</text>`,
      `<text x="${f(x(i))}" y="${H - 6}" text-anchor="middle" class="mo-rx-ax">${p.aberto ? 'período' : p.n ? (slot < 84 ? 'inv.' : 'inventário') : 'sem inv.'}</text>`); // coluna estreita: "inv." não atropela o vizinho
    if (!p.n) return;
    const c = _moRxHex(p.v), top = [...p.pares].sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 3);
    const aberto = p.aberto ? ` fill-opacity=".35" stroke-width="1.5" stroke-dasharray="4 3"` : '';
    let grade, extra;
    if (sep) {
      // Uma barra por central (na cor dela), lado a lado dentro da coluna.
      const larg = Math.min(slot * 0.82, 26 * centrais.length), bwC = larg / centrais.length;
      centrais.forEach((nome, j) => {
        const cc = p.porC.get(nome);
        if (!cc) return;
        const topo = Math.min(y(cc.v), y0), alt = Math.max(Math.abs(y(cc.v) - y0), 1.5), cor = corC.get(nome);
        svg.push(`<rect x="${f(x(i) - larg / 2 + j * bwC + bwC * 0.08)}" y="${f(topo)}" width="${f(bwC * 0.84)}" height="${f(alt)}" rx="2" fill="${cor}"${aberto ? aberto + ` stroke="${cor}"` : ''} style="pointer-events:none"/>`);
      });
      grade = centrais.filter(nome => p.porC.has(nome)).sort((a, b) => Math.abs(p.porC.get(b).v) - Math.abs(p.porC.get(a).v))
        .map(nome => _moRxLinha(`<span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${corC.get(nome)};margin-right:7px;vertical-align:-1px"></span>${_moEsc(nome)}`, _moKg(p.porC.get(nome).v), _moRxHex(p.porC.get(nome).v))).join('')
        + _moRxLinha('<b style="color:var(--text)">Total</b>', _moKg(p.v), c);
      extra = '';
    } else {
      grade = _moRxLinha('Variação líquida', _moKg(p.v), c) + _moRxLinha('Desfalques', _moKg(p.des), '#f43f5e')
        + _moRxLinha('Sobras', _moKg(p.sob), '#f59e0b') + _moRxLinha(p.aberto ? 'Pares' : 'Pares com inventário', `${p.n} de ${ps.length}`);
      extra = `<div style="margin-top:10px;font-size:12.5px;color:var(--text2)">Os que mais pesam:</div>` + top.map(t =>
        `<div style="display:flex;gap:10px;font-size:12.5px;margin-top:3px"><span style="color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_moEsc(t.nome)}</span><span style="margin-left:auto;font-family:var(--mono);color:${_moRxHex(t.v)}">${_moKg(t.v)}</span></div>`).join('');
      const ly = p.v < 0 ? y(p.v) + 15 : y(p.v) - 7, topo = Math.min(y(p.v), y0), alt = Math.max(Math.abs(y(p.v) - y0), 1.5);
      svg.push(`<rect x="${f(x(i) - bw / 2)}" y="${f(topo)}" width="${f(bw)}" height="${f(alt)}" rx="3" fill="${c}"${aberto ? aberto + ` stroke="${c}"` : ''} style="pointer-events:none"/>`,
        `<text x="${f(x(i))}" y="${f(ly)}" text-anchor="middle" class="mo-rx-ax" style="fill:${c};font-weight:600;pointer-events:none">${_moPesoSinal(p.v)}</text>`);
    }
    const tip = _moRxTip(c, `${p.rot}${p.aberto ? ' · período do Analítico' : ''}`, '', grade, extra);
    svg.push(`<rect class="mo-rx-pt" x="${f(x(i) - slot / 2)}" y="${T - 8}" width="${f(slot)}" height="${H - B - T + 8}" rx="6" data-tip="${tip}" data-col="${c}"/>`);
    // Ponto das Justificativas Operacionais do mês (Visão Inventário), do
    // lado oposto ao da barra, junto do zero; balão com o texto de cada uma.
    const js = p.aberto ? [] : _mpJustificativas(p.chave, ps);
    if (js.length) {
      const jy = p.v < 0 ? y0 - 12 : y0 + 12, MAX = 8;
      const lista = js.slice(0, MAX).map(j => `<div style="margin-top:9px;font-size:12.5px;line-height:1.4"><b style="color:var(--text)">${_moEsc(j.central)} · ${_moEsc(j.material)}</b>${j.doc ? `<span style="color:var(--text3);font-family:var(--mono);font-size:11.5px"> · doc ${_moEsc(j.doc)}</span>` : ''}<div style="color:var(--text2);white-space:normal">${_moEsc(j.texto.length > 220 ? j.texto.slice(0, 220) + '…' : j.texto)}</div></div>`).join('')
        + (js.length > MAX ? `<div style="margin-top:8px;font-size:12.5px;color:var(--text3)">+ ${js.length - MAX} justificativa${js.length - MAX === 1 ? '' : 's'} na Visão Inventário</div>` : '');
      const jtip = _moRxTip('#60a5fa', `Justificativas · ${p.rot}`, String(js.length), '', lista);
      svg.push(`<circle class="mo-rx-pt mp-just" cx="${f(x(i))}" cy="${f(jy)}" r="5.5" fill="#60a5fa" stroke="var(--bg2)" stroke-width="2" data-tip="${jtip}" data-col="#60a5fa"><title>${js.length} justificativa${js.length === 1 ? '' : 's'}</title></circle>`);
    }
  });
  const leg = sep ? `<div class="mp-inv-leg">${centrais.map(nome => `<span><i style="background:${corC.get(nome)}"></i>${_moEsc(nome)}</span>`).join('')}</div>` : '';
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Variação de inventário a inventário, em barras${sep ? ' por central' : ''}" style="display:block;overflow:visible">${svg.join('')}</svg>${leg}`;
}

// ── Regional (Hugo, 18/11/2026: layout "Regional 3" do quadro de layouts) ──
// Resumo em 3 colunas (Saúde · Tendência · Piores variações), filtro de
// criticidade dos materiais (vários níveis; vazio = todos) que muda o gráfico
// de inventários e os cartões, e um cartão por central (pior Saúde primeiro)
// com a tendência inventário a inventário — Única (a soma) ou Separada (uma
// linha por material) — e os materiais agrupados por nível.
const MP_NIVEIS = [['critico', 'CRÍTICO'], ['urgente', 'URGENTE'], ['atencao', 'ATENÇÃO'], ['bom', 'BOM']];
const MP_NIVEL_NOME = { critico: 'CRÍTICO', urgente: 'URGENTE', atencao: 'ATENÇÃO', bom: 'SAUDÁVEL' };
const MP_PALETA = ['#60a5fa', '#f472b6', '#a78bfa', '#2dd4bf', '#fbbf24', '#fb7185', '#38bdf8', '#fb923c', '#c084fc', '#4ade80', '#e879f9', '#94a3b8'];
_mp.niv = new Set();
_mp.tendModo = (() => { try { return localStorage.getItem('mural.tendModo') || 'unico'; } catch (_) { return 'unico'; } })();
function muralPainelNivel(l) {
  if (!l) _mp.niv.clear(); else if (_mp.niv.has(l)) _mp.niv.delete(l); else _mp.niv.add(l);
  _mpCentraisRedesenhar();
}
function muralPainelTendModo(m) {
  _mp.tendModo = m;
  try { localStorage.setItem('mural.tendModo', m); } catch (_) { /* sem storage */ }
  _mpCentraisRedesenhar();
}
const _mpNivFiltro = (ps) => _mp.niv.size ? ps.filter(p => _mp.niv.has(p.nivel)) : ps;

// Seletor de meses e Único/Separado do inventário da regional (Hugo,
// 18/11/2026): até MP_INV_MAX meses fechados + o período; padrão = os últimos
// MURAL_RX_MESES + o período. Os meses valem também para a tendência dos
// cartões. Trocar só redesenha os gráficos (o painel não é refeito).
_mp.invSel = null;
_mp.invModo = (() => { try { return localStorage.getItem('mural.invModo') || 'unico'; } catch (_) { return 'unico'; } })();
function _mpInvMesesDisp() {
  const P = muralPeriodo();
  return Array.from({ length: MP_INV_MAX }, (_, i) => {
    const d = new Date(P.ini.getFullYear(), P.ini.getMonth() - MP_INV_MAX + i, 1);
    return { chave: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      rot: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '') + '/' + String(d.getFullYear()).slice(2) };
  });
}
const _mpInvSel = () => _mp.invSel || new Set([..._mpInvMesesDisp().slice(-MURAL_RX_MESES).map(m => m.chave), 'mes']);
const _mpInvOpts = (s) => (s.tipo === 'regional' ? { meses: _mpInvSel(), sep: _mp.invModo === 'separado' } : {});
function _mpInvCtlHtml(aberto = false) {
  const sel = _mpInvSel(), disp = _mpInvMesesDisp(), n = disp.filter(m => sel.has(m.chave)).length;
  const bt = (k, rot) => `<button class="mp-mes${sel.has(k) ? ' on' : ''}" onclick="muralInvMes('${k}')" aria-pressed="${sel.has(k)}">${rot}</button>`;
  return `<details class="mp-meses"${aberto ? ' open' : ''}><summary class="btn btn-sm" title="Meses exibidos no gráfico e na tendência dos cartões"><i class="ti ti-calendar-month"></i>${n} ${n === 1 ? 'mês' : 'meses'}${sel.has('mes') ? ' + período' : ''}<i class="ti ti-chevron-down"></i></summary>
      <div class="mp-meses-pop"><div class="mp-meses-at"><span class="mo-hint">Últimos</span>${[3, 6, 12].map(k => `<button class="mp-mes" onclick="muralInvAtalho(${k})">${k}</button>`).join('')}</div>
        <div class="mp-meses-grade">${disp.map(m => bt(m.chave, m.rot)).join('')}${bt('mes', 'Período')}</div></div></details>
    <div class="mp-modo" role="group" aria-label="Barras do inventário">${[['unico', 'Único'], ['separado', 'Separado']]
      .map(([k, r]) => `<button class="${_mp.invModo === k ? 'on' : ''}" onclick="muralInvModo('${k}')" aria-pressed="${_mp.invModo === k}">${r}</button>`).join('')}</div>`;
}
function muralInvMes(k) {
  const s = new Set(_mpInvSel());
  if (s.has(k)) s.delete(k); else s.add(k);
  _mp.invSel = s; _mpInvRedesenhar(true);
}
function muralInvAtalho(n) { _mp.invSel = new Set([..._mpInvMesesDisp().slice(-n).map(m => m.chave), 'mes']); _mpInvRedesenhar(true); }
function muralInvModo(m) {
  _mp.invModo = m;
  try { localStorage.setItem('mural.invModo', m); } catch (_) { /* sem storage */ }
  _mpInvRedesenhar(false);
}
function _mpInvRedesenhar(aberto) {
  const ctl = document.getElementById('mp-inv-ctl');
  if (ctl) ctl.innerHTML = _mpInvCtlHtml(aberto);
  _mpGraficos();
}
// Gráfico de inventário + tendência dos cartões (depois que o acumulado
// trouxe os meses de cada par: _mp._esc, gravado em _mpDepois).
function _mpGraficos() {
  const e = _mp._esc;
  if (!e) return;
  const inv = document.getElementById('mp-inv');
  if (inv) inv.innerHTML = _mpInvHtml(e.ps, inv.clientWidth, _mpInvOpts(e.s));
  document.querySelectorAll('.mp-ccs .mp-cc-tend[data-c]').forEach(el => {
    const cps = e.ps.filter(p => p.central === el.dataset.c);
    el.innerHTML = _mpCartaoTendHtml(cps, _mpNivFiltro(cps), el.clientWidth);
  });
}
const _mpNivTexto = () => MP_NIVEIS.filter(([l]) => _mp.niv.has(l)).map(([, r]) => r.toLowerCase()).join(' + ');
const _mpCurto = (v) => Math.abs(v) >= 10000 ? (v < 0 ? '−' : v > 0 ? '+' : '') + Math.round(Math.abs(v) / 1000).toLocaleString('pt-BR') + ' t' : _moPesoSinal(v);

function _mpRegionalHtml(ps, cab) {
  const v = ps.reduce((t, p) => t + p.v, 0);
  const top = [...ps].sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 5), max = Math.max(1, ...top.map(p => Math.abs(p.v)));
  const resumo = `<div class="mp-card mp-resumo">
    <div class="mp-res-col mp-res-saude"><h4 class="mp-res-tit">Saúde da regional</h4>${_mpDonutCaixa('mp-mats')}</div>
    <div class="mp-res-col mp-res-tend"><h4 class="mp-res-tit">Tendência</h4>
      <div><span class="mo-hint">Variação do período</span><b class="mp-big" style="color:${_mpCor(v)}">${_moPesoSinal(v)}</b></div>
      <div id="mp-acum"><span class="mo-hint">Acumulado</span><b class="mp-big mo-hint">calculando…</b></div>
      <div class="mp-saude-tend" id="mp-tend"><span class="mo-hint">Saúde no período: calculando…</span></div></div>
    <div class="mp-res-col mp-res-top"><h4 class="mp-res-tit">Piores variações — central × material</h4>${top.map(p => `<button class="mp-res-var" ${_mpLinhaAttrs('item', p)}>
      <span class="mp-res-var-l"><span><b>${_moEsc(p.central)}</b> · ${_moEsc(p.material)}</span><span class="mono" style="color:${_mpCor(p.v)}">${_moPesoSinal(p.v)}</span></span>
      <span class="mp-res-barra"><i style="width:${(Math.abs(p.v) / max * 100).toFixed(1)}%;background:${_mpCor(p.v)}"></i></span></button>`).join('') || '<p class="mo-hint">Sem variação no período.</p>'}</div>
  </div>`;
  const inv = `<div class="mp-card"><div class="mp-inv-cab"><h4 class="mp-tit">Variação de inventário a inventário <span class="mo-hint">soma líquida dos ${ps.length} pares</span></h4>
      <div id="mp-inv-ctl" class="mp-inv-ctl">${_mpInvCtlHtml()}</div></div>
    <div id="mp-inv" class="mp-inv"><span class="mo-hint">Calculando os inventários…</span></div></div>`;
  // Pendências saíram da regional (ficam na central, material e Geral); no
  // lugar, "Ações por criticidade" dentro da seção das centrais (Hugo, 18/11/2026).
  return `${cab}${resumo}${inv}<div id="mp-centrais" class="mp-centrais">${_mpCentraisHtml(ps)}</div>${_mpTlHtml()}`;
}

// Ações por criticidade: um card por nível marcado no filtro (sem filtro:
// Crítico, Urgente e Atenção). As ações são as das Configurações → Ações de
// Relatório (state.acoesRelatorio: por categoria + nível), resolvidas como no
// relatório da Micro (_resolverAcoesParaMaterial, relatorio.js); materiais que
// caem na mesma regra dividem o mesmo bloco (Hugo, 18/11/2026).
function _mpAcoesNivelHtml(ps) {
  const niveis = MP_NIVEIS.filter(([l]) => (_mp.niv.size ? _mp.niv.has(l) : l !== 'bom'));
  const catNome = (k) => (typeof _REL_CAT_NOMES !== 'undefined' && _REL_CAT_NOMES[k]) || 'Sem cadastro';
  const resolver = (p, l) => (l === 'bom' || typeof _resolverAcoesParaMaterial !== 'function' ? null : _resolverAcoesParaMaterial(p.material, p.v, '', l, p.catKey, ''));
  return `<div class="mp-card mp-acoes"><h4 class="mp-tit">Ações por criticidade <span class="mo-hint">definidas em Configurações → Ações de Relatório</span></h4><div class="mp-acoes-grade">${niveis.map(([l, rot]) => {
    const ms = ps.filter(p => p.nivel === l), v = ms.reduce((t, p) => t + p.v, 0), nc = new Set(ms.map(p => p.central)).size;
    const grupos = new Map();
    ms.forEach(p => {
      const acoes = resolver(p, l), k = acoes || '';
      if (!grupos.has(k)) grupos.set(k, { acoes, cats: new Set(), n: 0 });
      const g = grupos.get(k); g.cats.add(catNome(p.catKey)); g.n++;
    });
    const blocos = [...grupos.values()].sort((a, b) => (b.acoes ? 1 : 0) - (a.acoes ? 1 : 0) || b.n - a.n).map(g => `<div class="mp-acao-g">
      <div class="mp-acao-cat"><b>${_moEsc([...g.cats].join(' · '))}</b><span class="mo-hint">${g.n} materia${g.n === 1 ? 'l' : 'is'}</span></div>
      ${g.acoes ? `<ul>${String(g.acoes).split(/[;|\n]/).map(a => a.trim().replace(/^[-•–]\s*/, '')).filter(Boolean).map(a => `<li>${_moEsc(a)}</li>`).join('')}</ul>`
        : `<p class="mo-hint">${l === 'bom' ? 'Dentro do esperado — sem ação necessária.' : 'Sem ação cadastrada para esta categoria e nível.'}</p>`}</div>`).join('');
    return `<div class="mp-acao" style="--c:${MP_NIVEL_COR[l]}"><div class="mp-acao-cab">${_mpIco(l)}<b>${rot}</b>
        <span class="mp-acao-nums"><span><b>${ms.length}</b> materia${ms.length === 1 ? 'l' : 'is'}</span><span><b>${nc}</b> centra${nc === 1 ? 'l' : 'is'}</span><span class="mono" style="color:${_mpCor(v)}">${_moPesoSinal(v)}</span></span></div>
      ${ms.length ? blocos : '<p class="mo-hint">Nenhum material neste nível.</p>'}</div>`;
  }).join('')}</div></div>`;
}

// Seção "Centrais da regional": título, Único/Separado da tendência, filtro de
// criticidade (vale só para os cartões) e os cartões. Redesenhada sozinha
// quando o filtro ou o modo mudam (também no HTML exportado).
function _mpCentraisHtml(ps) {
  const niv = `<div class="mp-niv" role="group" aria-label="Filtrar as centrais pela criticidade dos materiais"><span class="mo-hint">Criticidade dos materiais</span>
    <button class="mp-niv-b${_mp.niv.size ? '' : ' on'}" onclick="muralPainelNivel('')" aria-pressed="${!_mp.niv.size}">Todos</button>
    ${MP_NIVEIS.map(([l, rot]) => { const n = ps.filter(p => p.nivel === l).length, on = _mp.niv.has(l);
      return `<button class="mp-niv-b mp-niv-l${on ? ' on' : ''}" style="--c:${MP_NIVEL_COR[l]}" onclick="muralPainelNivel('${l}')" aria-pressed="${on}"${n || on ? '' : ' disabled'}>${_mpIco(l)}${n} ${rot}</button>`; }).join('')}</div>`;
  const cards = [..._mpAgrupar(ps, p => p.central)].map(([c, cps]) => ({ c, cps, fcps: _mpNivFiltro(cps), s: _mpSaude(cps) }))
    .filter(x => x.fcps.length).sort((a, b) => a.s.score - b.s.score);
  const modo = `<div class="mp-modo" role="group" aria-label="Linhas da tendência das centrais"><span class="mo-hint">Tendência</span>${[['unico', 'Único'], ['separado', 'Separado']]
    .map(([k, r]) => `<button class="${_mp.tendModo === k ? 'on' : ''}" onclick="muralPainelTendModo('${k}')" aria-pressed="${_mp.tendModo === k}">${r}</button>`).join('')}</div>`;
  return `<div class="mp-cc-sec"><h4 class="mp-tit">Centrais da regional <span class="mo-hint">${_mp.niv.size ? `só as centrais com materiais ${_mpNivTexto()} · ` : ''}pior saúde primeiro</span></h4>${modo}</div>
    ${niv}
    <div class="mp-ccs">${cards.map(x => _mpCartaoHtml(x.c, x.cps, x.fcps, x.s)).join('') || '<p class="mo-hint">Nenhuma central com materiais nesse nível.</p>'}</div>
    ${_mpAcoesNivelHtml(ps)}`;
}
// Redesenha só a seção das centrais (e as tendências dos cartões, se o
// acumulado já trouxe os meses); sem ela na tela, refaz o painel.
function _mpCentraisRedesenhar() {
  const el = document.getElementById('mp-centrais');
  if (!el || !_mp._esc) { muralRender(); return; }
  el.innerHTML = _mpCentraisHtml(_mp._esc.ps);
  _mpGraficos();
}

// Grupos de nível do cartão e as linhas do modo Separado — mesma ordem e
// cores na lista e no gráfico. Sem filtro, o Bom fica resumido (uma linha só).
function _mpCartaoGrupos(fcps) {
  const linhas = [], nova = (nome, ps) => { const sw = MP_PALETA[linhas.length % MP_PALETA.length]; linhas.push({ nome, ps, sw }); return sw; };
  const grupos = MP_NIVEIS.map(([l, rot]) => {
    const ms = fcps.filter(p => p.nivel === l).sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
    if (!ms.length) return null;
    const resumir = l === 'bom' && !_mp.niv.size;
    const sw = resumir ? nova(`Bom · ${ms.length} materiais`, ms) : null;
    return { l, rot, ms, sw, itens: resumir ? [] : ms.map(p => ({ p, sw: nova(p.material, [p]) })) };
  }).filter(Boolean);
  return { grupos, linhas };
}

function _mpCartaoHtml(c, cps, fcps, s) {
  const v = fcps.reduce((t, p) => t + p.v, 0), sep = _mp.tendModo === 'separado';
  const sw = (cor) => sep ? `<i class="mp-sw" style="background:${cor}"></i>` : '';
  const { grupos } = _mpCartaoGrupos(fcps);
  return `<article class="mp-cc">
    <button class="mp-cc-cab" ${_mpLinhaAttrs('central', { regional: cps[0].regional, central: c })} title="Abrir a central">${_mpIco(s.nivel)}<b>${_moEsc(c)}</b>
      <span class="mp-cc-saude" style="color:${MP_NIVEL_COR[s.nivel]}"><b>${s.score}%</b><small>${MP_NIVEL_NOME[s.nivel]}</small></span></button>
    <span class="mp-cc-barra"><i style="width:${s.score}%;background:${MP_NIVEL_COR[s.nivel]}"></i></span>
    <div class="mp-cc-v"><span class="mo-hint">${v < 0 ? 'Desfalque' : 'Sobra'}${_mp.niv.size ? ` · ${_mpNivTexto()}` : ''}</span><b style="color:${_mpCor(v)}">${_moPesoSinal(v)}</b></div>
    <div class="mp-cc-tend" data-c="${_moEsc(c)}"><span class="mo-hint">Tendência: calculando…</span></div>
    <div>${grupos.map(g => `<div class="mp-faixa" style="--c:${MP_NIVEL_COR[g.l]}">${_mpIco(g.l)}<b>${g.rot}</b>
        <span class="mono">${g.sw ? sw(g.sw) : ''}${g.ms.length} · ${_moPesoSinal(g.ms.reduce((t, p) => t + p.v, 0))}</span></div>
      ${g.itens.length ? `<div class="mp-cc-itens">${g.itens.map(({ p, sw: cor }) => `<button class="mp-cc-it" ${_mpLinhaAttrs('item', p)}>${sw(cor)}<span>${_moEsc(p.material)}</span><span class="mono" style="color:${_mpCor(p.v)}">${_moPesoSinal(p.v)}</span></button>`).join('')}</div>` : ''}`).join('')}</div>
  </article>`;
}

// Tendência do cartão (depois do acumulado, que traz os inventários de cada
// par): soma, por inventário, dos pares listados + o período. Único = uma
// linha com pontos na cor da Saúde da central no mês; Separado = uma linha por
// material. Desenhada na largura real; balão por coluna (classe mp-ct-col).
function _mpCartaoTendHtml(cps, fcps, larg) {
  const th = getHealthThresholds(), rotM = new Map();
  const mm = new Map(cps.map(p => {
    const ms = _mp.acum.get(_mpChave(p.central, p.material))?.meses || [];
    ms.forEach(m => rotM.set(m.chave, m.rot));
    return [p, new Map(ms.map(m => [m.chave, m.v]))];
  }));
  // Os meses do seletor do inventário (e o período, se marcado); ult = índice
  // do período (-1 quando desmarcado).
  const sel = _mpInvSel(), ord = [...rotM.keys()].sort().filter(k => sel.has(k));
  const n = ord.length + (sel.has('mes') ? 1 : 0), ult = sel.has('mes') ? n - 1 : -1;
  // Valor de um grupo de pares no ponto i (null = ninguém com inventário no mês).
  const val = (ps, i) => {
    if (i === ult) return ps.reduce((t, p) => t + p.v, 0);
    let s = 0, k = 0;
    ps.forEach(p => { const x = mm.get(p).get(ord[i]); if (x != null) { s += x; k++; } });
    return k ? s : null;
  };
  const sep = _mp.tendModo === 'separado', { linhas } = _mpCartaoGrupos(fcps);
  const soma = Array.from({ length: n }, (_, i) => val(fcps, i));
  const series = sep ? linhas.map(ln => ({ ...ln, s: Array.from({ length: n }, (_, i) => val(ln.ps, i)) })) : [{ nome: 'Total', sw: 'var(--text2)', s: soma }];
  const saude = Array.from({ length: n }, (_, i) => {
    const ds = cps.map(p => ({ mat: p.material, catKey: p.catKey, diff: i === ult ? p.v : mm.get(p).get(ord[i]) })).filter(d => d.diff != null);
    if (!ds.length) return null;
    const r = muralSaude(ds, th);
    return { score: r.score, nivel: r.level === 'ok' ? 'bom' : r.level };
  });
  // Piorando/melhorando: o último ponto mostrado contra o anterior com valor.
  const comV = soma.filter(x => x != null), ant = comV.length > 1 ? comV[comV.length - 2] : null;
  const piora = ant != null && Math.abs(comV[comV.length - 1]) > Math.abs(ant);
  const cab = `<div class="mp-cc-tend-l"><span class="mo-hint">Tendência · inventário a inventário</span>${ant == null ? '' : `<b style="color:${piora ? 'var(--red)' : 'var(--green)'}">${piora ? '▼ piorando' : '▲ melhorando'}</b>`}</div>`;
  if (soma.filter(x => x != null).length < 2) return cab + '<p class="mo-hint">Sem inventários suficientes nesta central.</p>';

  const W = Math.max(240, Math.round(larg)), H = 118, L = 62, R = 10, T = 10, B = 22, f = (v) => v.toFixed(1);
  const vals = series.flatMap(x => x.s).filter(x => x != null), mn = Math.min(0, ...vals), mx = Math.max(0, ...vals), pad = (mx - mn || 1) * 0.1;
  const y = (v) => T + (mx + pad - v) / (mx - mn + 2 * pad) * (H - T - B), x = (i) => L + i * (W - L - R) / (n - 1), y0 = y(0);
  const svg = [`<line x1="${L}" x2="${W - R}" y1="${f(y0)}" y2="${f(y0)}" stroke="var(--border3)"/>`];
  [mx, 0, mn].filter((v, i, a) => a.indexOf(v) === i && (v === 0 || Math.abs(y(v) - y0) > 14))
    .forEach(v => svg.push(`<text x="${L - 8}" y="${f(y(v) + 4)}" text-anchor="end" class="mo-rx-ax" style="font-size:11px">${_mpCurto(v)}</text>`));
  series.forEach(ln => {
    const idx = ln.s.map((v, i) => (v == null ? -1 : i)).filter(i => i >= 0);
    idx.forEach((i, k) => {
      if (!k) return;
      const j = idx[k - 1];
      svg.push(`<line x1="${f(x(j))}" y1="${f(y(ln.s[j]))}" x2="${f(x(i))}" y2="${f(y(ln.s[i]))}" style="stroke:${ln.sw}" stroke-width="${sep ? 1.6 : 2}"${i === ult || i - j > 1 ? ' stroke-dasharray="4 3"' : ''}/>`);
    });
    idx.forEach(i => svg.push(sep
      ? `<circle cx="${f(x(i))}" cy="${f(y(ln.s[i]))}" r="${i === ult ? 3.5 : 2.5}" style="fill:${ln.sw};pointer-events:none"/>`
      : `<circle cx="${f(x(i))}" cy="${f(y(ln.s[i]))}" r="${i === ult ? 5.5 : 3.5}" style="fill:${saude[i] ? MP_NIVEL_COR[saude[i].nivel] : 'var(--text3)'};pointer-events:none"/>`));
  });
  const colW = (W - L - R) / (n - 1);
  for (let i = 0; i < n; i++) {
    const rot = i === ult ? (n > 8 ? 'P' : 'per.') : rotM.get(ord[i]).slice(0, 1).toUpperCase(); // P: com muitos meses não cabe "per."
    svg.push(`<text x="${f(x(i))}" y="${H - 4}" text-anchor="middle" class="mo-rx-ax" style="font-size:11px">${rot}</text>`);
    const titulo = i === ult ? 'Período do Analítico' : rotM.get(ord[i]);
    const grade = sep
      ? series.filter(ln => ln.s[i] != null).sort((a, b) => Math.abs(b.s[i]) - Math.abs(a.s[i]))
          .map(ln => _moRxLinha(`<span style="display:inline-block;width:12px;height:3px;border-radius:2px;background:${ln.sw};margin-right:6px;vertical-align:middle"></span>${_moEsc(ln.nome)}`, _moKg(ln.s[i]), _moRxHex(ln.s[i]))).join('')
        + (soma[i] != null ? _moRxLinha('<b style="color:var(--text)">Total</b>', _moKg(soma[i]), _moRxHex(soma[i])) : '')
      : (soma[i] != null ? _moRxLinha('Variação líquida', _moKg(soma[i]), _moRxHex(soma[i])) : _moRxLinha('Variação líquida', 'sem inventário'))
        + (saude[i] ? _moRxLinha('Saúde da central', saude[i].score + '%', MP_NIVEL_COR[saude[i].nivel]) : '');
    const c = soma[i] == null ? '#7b85a0' : _moRxHex(soma[i]);
    svg.push(`<rect class="mp-ct-col" x="${f(x(i) - colW / 2)}" y="0" width="${f(colW)}" height="${H - B + 4}" rx="4" data-tip="${_moRxTip(c, titulo, i === ult ? '' : 'inventário', grade)}" data-col="${c}"/>`);
  }
  return cab + `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tendência da central, inventário a inventário" style="display:block;overflow:visible">${svg.join('')}</svg>`;
}

// ── Linha do tempo do escopo (Hugo, 18/11/2026) ───────────────────────────
// Substitui "Ações no período" na regional, central e material. Só o período
// do Analítico: comentários do analista, ocorrências (abertura, escalonamento,
// conclusão), Registros operacionais (data do ocorrido) e alertas (sem
// lançamento, lançamento pendente, sem uso). O inventário do mês anterior
// fechado fica fixo no topo. Vertical por dia (mais recente em cima), chips
// por tipo, 30 por vez; o clique abre a origem. Fila fora (decisão do Hugo).
const MP_TL = [['inv', 'Inventário', 'ti-clipboard-check', 'var(--green)'], ['com', 'Comentários', 'ti-message-2', 'var(--accent)'],
  ['oc', 'Ocorrências', 'ti-file-alert', 'var(--red)'], ['reg', 'Registros', 'ti-clipboard-text', 'var(--purple)'], ['alerta', 'Alertas', 'ti-bell-ringing', 'var(--amber)']];
const MP_TL_PASSO = 30;
_mp.tlTipos = new Set();
_mp.tlN = MP_TL_PASSO;
const _mpTlHtml = () => `<div class="mp-card"><h4 class="mp-tit">Linha do tempo <span class="mo-hint">período do Analítico</span></h4><div id="mp-tl"><span class="mo-hint">Montando a linha do tempo…</span></div></div>`;

function _mpTlMontar(ps, s) {
  const P = muralPeriodo(), de = localISODate(P.ini), ate = localISODate(P.fim);
  const noPer = (iso) => !!iso && iso >= de && iso <= ate, iso = (d) => (d ? localISODate(d) : '');
  // Central comparada pela FILIAL do cadastro (origem, alias ou CNPJ): o
  // Registro grava origem || alias, a análise usa outro nome — por texto
  // exato não casava e os Registros sumiam da linha (Hugo, 18/11/2026).
  const fil = typeof getFilialLookupIndex === 'function' ? getFilialLookupIndex().exact : null;
  const cKey = (c) => {
    const n = normalizeText(String(c || '').trim());
    const f = fil && (fil.get(n) || fil.get(String(c || '').replace(/\D/g, '')));
    return f ? normalizeText(f.alias || f.origem) : n;
  };
  const nomeDe = new Map(ps.map(p => [cKey(p.central), p.central])); // chave → nome usado no painel
  const cent = new Set(nomeDe.keys()), soMat = s.tipo === 'material' ? normalizeText(s.material) : null;
  const doEscopo = (c, m) => cent.has(cKey(c)) && (!soMat || normalizeText(m || '') === soMat);
  const regDe = new Map(ps.map(p => [p.central, p.regional]));
  const abrirItem = (c, m) => () => muralPainelSel({ dataset: { t: 'item', r: regDe.get(c) || '', c, m } });
  const ev = [];
  const add = (tipo, dia, ts, titulo, onde, texto, abrir) => ev.push({ i: ev.length, tipo, dia, ts: ts || 0, titulo, onde, texto, abrir });

  ps.forEach(p => (typeof _varComDe === 'function' ? _varComDe(p.central, p.material) : []).forEach(r => {
    if (r.oc_id || !noPer(r.data)) return; // comentário de ocorrência entra como ocorrência
    const causa = typeof varComCausaDe === 'function' ? varComCausaDe(r.texto) : null;
    const resto = typeof _varComSemCausa === 'function' ? _varComSemCausa(r.texto) : r.texto;
    add('com', r.data, Date.parse(r.created_at), `Comentário · ${r.autor_nome || '—'}${typeof varComDataComentario === 'function' && varComDataComentario(r) ? ` · comentado ${varComDataComentario(r)}` : ''}`, `${p.material} · ${p.central}`,
      (causa ? `<b>${_moEsc(causa)}.</b> ` : '') + _moEsc(resto || ''), abrirItem(p.central, p.material));
  }));

  (state.ocorrencias || []).forEach(o => {
    if (!doEscopo(o.central, o.material)) return;
    const onde = [o.material, o.central].filter(Boolean).join(' · '), num = o.numero ? ` #${o.numero}` : '';
    const abrir = () => typeof openOcDetailModal === 'function' && openOcDetailModal(o.id);
    if (noPer(o.dataAbertura)) add('oc', o.dataAbertura, o.criadoEm, `Ocorrência${num} aberta`, onde, _moEsc(o.motivo || o.descricao || ''), abrir);
    (o.hierarquia || []).forEach(h => {
      const d = String(h.data || '').slice(0, 10);
      if (noPer(d)) add('oc', d, h.criadoEm, `Ocorrência${num} escalonada · ${(typeof OC_HIERARQUIA !== 'undefined' && OC_HIERARQUIA[h.nivel]?.label) || ''}`, onde, _moEsc(h.motivo || ''), abrir);
    });
    if (o.concluida && noPer(o.dataConclusao)) add('oc', o.dataConclusao, 0, `Ocorrência${num} concluída`, onde, _moEsc(o.descConclusao || ''), abrir);
    if (o.inconclusiva && noPer(o.dataInconclusiva)) add('oc', o.dataInconclusiva, 0, `Ocorrência${num} inconclusiva`, onde, _moEsc(o.motivoInconclusiva || ''), abrir);
  });

  // Registros operacionais (solicitacoes.js / Supabase): só o envio, na data do ocorrido.
  (typeof _sol !== 'undefined' ? _sol.lista : []).forEach(r => {
    const d = String(r.data_ocorrido || '').slice(0, 10);
    let k = cKey(r.central);
    if (!cent.has(k) && r.cnpj_central) k = cKey(r.cnpj_central);
    if (r.status === 'excluida' || !noPer(d) || !cent.has(k)) return;
    const central = nomeDe.get(k) || r.central;
    const mats = (r.itens || []).map(i => i.material).filter(Boolean);
    if (soMat && !mats.some(m => normalizeText(m) === soMat)) return;
    add('reg', d, Date.parse(r.created_at), `${r.categoria_situacao || 'Registro'}${r.motivo ? ' · ' + r.motivo : ''}`, `${r.protocolo || ''} · ${central}`,
      _moEsc(mats.slice(0, 4).join(', ') + (mats.length > 4 ? ` + ${mats.length - 4}` : '')), () => typeof solAbrir === 'function' && solAbrir(r.id));
  });

  // Alertas: sem lançamento no último dia (AUSENTE), lançamento pendente, sem uso.
  ps.forEach(p => {
    const onde = `${p.material} · ${p.central}`;
    const d1 = iso(p.sl?.esperado && parseDate(p.sl.esperado));
    if (noPer(d1)) add('alerta', d1, 0, 'Sem lançamento no dia', onde, 'Est. Final AUSENTE na Visão Micro', abrirItem(p.central, p.material));
    const d2 = iso(p.it?.lancPendente && parseDate(p.it.lancPendente));
    if (noPer(d2)) add('alerta', d2, 0, 'Lançamento pendente', onde, '', abrirItem(p.central, p.material));
  });
  if (typeof suItens === 'function' && typeof SU_NIVEIS !== 'undefined') suItens().forEach(i => {
    const lim = SU_NIVEIS.find(([, n]) => n === i.nivel)?.[0];
    if (!lim || !i.ultUso || !doEscopo(i.central, i.material)) return;
    const d = new Date(i.ultUso); d.setDate(d.getDate() + lim);
    if (noPer(iso(d))) add('alerta', iso(d), 0, `Sem uso há ${lim} dias`, `${i.material} · ${i.central}`,
      `Saldo de ${_moPeso(i.kg)} parado desde ${fmtPtDate(new Date(i.ultUso))}`, () => muralPainelAba('semuso'));
  });

  // Fixo no topo: o inventário do mês anterior ao período, fechado.
  const ant = new Date(P.ini.getFullYear(), P.ini.getMonth() - 1, 1), chave = `${ant.getFullYear()}-${String(ant.getMonth() + 1).padStart(2, '0')}`;
  let v = 0, des = 0, sob = 0, n = 0;
  ps.forEach(p => {
    const m = (_mp.acum.get(_mpChave(p.central, p.material))?.meses || []).find(x => x.chave === chave);
    if (m && m.v != null) { v += m.v; n++; if (m.v < 0) des += m.v; else sob += m.v; }
  });
  const fixo = n ? { rot: ant.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }), v, des, sob, n, js: _mpJustificativas(chave, ps) } : null;
  return { ev, fixo };
}

function _mpTlRender() {
  const el = document.getElementById('mp-tl'), t = _mp._tl;
  if (!el || !t) return;
  const ativo = (k) => !_mp.tlTipos.size || _mp.tlTipos.has(k);
  const conta = (k) => (k === 'inv' ? (t.fixo ? 1 : 0) : t.ev.filter(e => e.tipo === k).length);
  const chips = `<div class="mp-niv mp-tl-chips" role="group" aria-label="Filtrar a linha do tempo por tipo">
    <button class="mp-niv-b${_mp.tlTipos.size ? '' : ' on'}" onclick="muralTlTipo('')" aria-pressed="${!_mp.tlTipos.size}">Todos</button>
    ${MP_TL.map(([k, rot, ic, cor]) => { const on = _mp.tlTipos.has(k), n = conta(k);
      return `<button class="mp-niv-b mp-niv-l${on ? ' on' : ''}" style="--c:${cor}" onclick="muralTlTipo('${k}')" aria-pressed="${on}"${n || on ? '' : ' disabled'}><i class="ti ${ic}"></i>${n} ${rot}</button>`; }).join('')}</div>`;
  const f = t.fixo;
  const fixo = f && ativo('inv') ? `<button class="mp-tl-fixo" onclick="anSwitchView('inventario')" title="Abrir a Visão Inventário">
    <i class="ti ti-clipboard-check"></i><span><b>Inventário de ${_moEsc(f.rot)} fechado</b>
      <small>${f.n} par${f.n === 1 ? '' : 'es'} · desfalques ${_moPesoSinal(f.des)} · sobras ${_moPesoSinal(f.sob)} · ${f.js.length} justificativa${f.js.length === 1 ? '' : 's'}</small>
      ${f.js.slice(0, 3).map(j => `<span class="mp-tl-just"><b>${_moEsc(j.central)} · ${_moEsc(j.material)}:</b> ${_moEsc(j.texto)}</span>`).join('')}
      ${f.js.length > 3 ? `<small>+ ${f.js.length - 3} na Visão Inventário</small>` : ''}</span>
    <b class="mono" style="color:${_mpCor(f.v)}">${_moPesoSinal(f.v)}</b></button>` : '';
  const vis = t.ev.filter(e => ativo(e.tipo)).sort((a, b) => b.dia.localeCompare(a.dia) || b.ts - a.ts);
  const TIPO = Object.fromEntries(MP_TL.map(([k, , ic, cor]) => [k, { ic, cor }]));
  let dia = '', lista = '';
  vis.slice(0, _mp.tlN).forEach(e => {
    if (e.dia !== dia) {
      dia = e.dia;
      lista += `<div class="mp-tl-dia">${new Date(dia + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}</div>`;
    }
    lista += `<button class="mp-tl-ev" style="--c:${TIPO[e.tipo].cor}" onclick="muralTlAbrir(${e.i})"><i class="ti ${TIPO[e.tipo].ic}"></i>
      <span class="mp-tl-txt"><span class="mp-tl-l"><b>${_moEsc(e.titulo)}</b><small>${_moEsc(e.onde)}</small></span>${e.texto ? `<span class="mp-tl-desc">${e.texto}</span>` : ''}</span></button>`;
  });
  const mais = vis.length > _mp.tlN ? `<button class="btn btn-sm mp-tl-mais" onclick="muralTlMais()">Ver mais (${vis.length - _mp.tlN})</button>` : '';
  el.innerHTML = chips + fixo + (lista ? `<div class="mp-tl">${lista}</div>${mais}` : (fixo ? '' : '<p class="mo-hint">Nenhum evento no período.</p>'));
}
function muralTlTipo(k) {
  if (!k) _mp.tlTipos.clear(); else if (_mp.tlTipos.has(k)) _mp.tlTipos.delete(k); else _mp.tlTipos.add(k);
  _mp.tlN = MP_TL_PASSO; _mpTlRender();
}
function muralTlMais() { _mp.tlN += MP_TL_PASSO; _mpTlRender(); }
function muralTlAbrir(i) { const e = _mp._tl?.ev[i]; if (e) e.abrir(); }
// Monta (depois do acumulado, que traz o inventário do mês anterior) e, se os
// Registros ainda não foram carregados do Supabase, carrega uma vez e remonta.
function _mpTlAtualizar(ps, s) {
  if (!document.getElementById('mp-tl')) return;
  _mp.tlN = MP_TL_PASSO;
  _mp._tl = _mpTlMontar(ps, s); _mpTlRender();
  if (typeof solCarregar === 'function' && typeof _sol !== 'undefined' && !_sol.lista.length && !_mp._tlSolPedido) {
    _mp._tlSolPedido = true;
    const gen = _mp.gen;
    solCarregar().then(() => { if (gen === _mp.gen && document.getElementById('mp-tl')) { _mp._tl = _mpTlMontar(ps, s); _mpTlRender(); } });
  }
}

// ── Exportar HTML (Hugo, 18/11/2026) ──────────────────────────────────────
// O painel exatamente como está na tela, com os filtros aplicados, num arquivo
// único: CSS do app, fontes e ícones embutidos e os balões religados por
// data-tip (helpers do Relatório Gerencial, relatorio.js). Botões ficam
// inertes (o arquivo não tem o app); a linha do tempo sai inteira.
const _mpExportarBtnHtml = () => _mp.aba === 'semuso' ? '' : `<span class="mp-exp-btn">${typeof reEmailBtnsHtml === 'function' ? reEmailBtnsHtml() : ''}<button class="btn btn-sm" onclick="muralPainelExportar(this)" title="Baixar o painel como está na tela, com os filtros aplicados"><i class="ti ti-file-download"></i> Exportar HTML</button></span>`;


// Filtros do painel que continuam funcionando no arquivo (Hugo, 18/11/2026):
// criticidade, Único/Separado (inventário e tendência), meses e chips da
// linha do tempo. O arquivo leva os dados do escopo e as MESMAS funções de
// desenho (toString), com stubs para o que é do app (muralRender, Raio-X…).
const MP_EXP_ATIVOS = /^(muralPainelNivel|muralPainelTendModo|muralInvMes|muralInvAtalho|muralInvModo|muralTlTipo|muralTlMais)\(/;
function _mpExpScript() {
  const e = _mp._esc;
  if (!e) return ''; // os meses ainda não tinham sido calculados: sai estático
  const fns = { _mpIco, _mpCor, _mpChave, _mpSaude, _mpAgrupar, _mpJustificativas, _mpInvHtml, muralPainelNivel, muralPainelTendModo,
    _mpNivFiltro, _mpInvMesesDisp, _mpInvSel, _mpInvOpts, _mpInvCtlHtml, muralInvMes, muralInvAtalho, muralInvModo, _mpInvRedesenhar,
    _mpGraficos, _mpNivTexto, _mpCurto, _mpCentraisHtml, _mpCentraisRedesenhar, _mpCartaoGrupos, _mpCartaoHtml, _mpCartaoTendHtml,
    _mpTlRender, muralTlTipo, muralTlMais, _mpLinhaAttrs, _mpAcoesNivelHtml, _resolverAcoesParaMaterial, _moEsc, _moKg, _moPeso, _moPesoSinal, _moRxHex, _moRxLinha, _moRxTip,
    muralSaude, calcHealthScore, classifyVariation, escapeHtml, fmtPtDate, localISODate };
  const vals = { _REL_CAT_NOMES, MP_NIVEL_COR, MP_INV_MAX, MP_NIVEIS, MP_NIVEL_NOME, MP_PALETA, MP_TL, MP_TL_PASSO, MURAL_RX_MESES, HEALTH_PENALTIES, _levelIcon };
  const codigo = Object.entries(fns).map(([n, f]) => { const src = f.toString(); return /^\s*(async\s+)?function[\s*]/.test(src) ? src : `var ${n} = ${src};`; })
    .concat(Object.entries(vals).map(([n, v]) => `var ${n} = ${JSON.stringify(v)};`)).join('\n');
  const P = muralPeriodo();
  const ps = e.ps.map(p => ({ central: p.central, regional: p.regional, material: p.material, v: p.v, nivel: p.nivel, catKey: p.catKey }));
  const pares = new Set(ps.map(p => p.central + '|||' + p.material));
  const dados = {
    P: [P.ini.getTime(), P.fim.getTime()], th: getHealthThresholds(), ps, s: e.s,
    acum: ps.map(p => [_mpChave(p.central, p.material), _mp.acum.get(_mpChave(p.central, p.material))]).filter(([, a]) => a),
    js: (state.invJustificativas || []).filter(r => r && r.k && pares.has(r.k.split('|||').slice(1).join('|||'))),
    ar: state.acoesRelatorio || [],
    tl: _mp._tl ? { ev: _mp._tl.ev.map(({ abrir, ...r }) => r), fixo: _mp._tl.fixo } : null,
    niv: [..._mp.niv], tendModo: _mp.tendModo, invModo: _mp.invModo, invSel: _mp.invSel ? [..._mp.invSel] : null, tlTipos: [..._mp.tlTipos]
  };
  const seguro = (t) => String(t).replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
  return `<script>
${seguro(codigo)}
var DADOS = ${seguro(JSON.stringify(dados))};
var state = { invJustificativas: DADOS.js, acoesRelatorio: DADOS.ar };
function muralPeriodo() { return { ini: new Date(DADOS.P[0]), fim: new Date(DADOS.P[1]) }; }
function getHealthThresholds() { return DADOS.th; }
function muralRender() {} function muralPainelSel() {} function muralTlAbrir() {} function anSwitchView() {} function muralPainelAba() {} function _hideTip() {}
var _mp = { sel: DADOS.s, niv: new Set(DADOS.niv), tendModo: DADOS.tendModo, invModo: DADOS.invModo, invSel: DADOS.invSel ? new Set(DADOS.invSel) : null,
  tlTipos: new Set(DADOS.tlTipos), tlN: 1e9, acum: new Map(DADOS.acum), _esc: { ps: DADOS.ps, s: DADOS.s }, _tl: DADOS.tl };
// Gráficos redesenhados na largura de quem abre o arquivo (e ao redimensionar).
var _mpExpT = null;
window.addEventListener('load', function () { _mpGraficos(); });
window.addEventListener('resize', function () { clearTimeout(_mpExpT); _mpExpT = setTimeout(_mpGraficos, 150); });
<\/script>`;
}

// Balão do arquivo exportado: o mesmo do app (#macro-donut-tip, com as regras
// do modules.css — inclusive o limite à largura da tela no celular) e com
// toque: tocar num ponto/barra mostra, tocar fora ou rolar esconde.
function _mpExpTipScript() {
  return `<script>
(function () {
  var tip = null;
  function el() {
    if (tip) return tip;
    tip = document.createElement('div'); tip.id = 'macro-donut-tip';
    tip.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;display:none;background:var(--bg2);border:1px solid var(--border3);border-radius:10px;padding:12px 15px;min-width:200px;max-width:260px;box-shadow:0 8px 32px rgba(0,0,0,.5);font-family:var(--font);font-size:12px';
    document.body.appendChild(tip); return tip;
  }
  function pos(t, x, y) {
    var P = 10, W = innerWidth, H = innerHeight, r = t.getBoundingClientRect(), w = r.width || 260, h = r.height || 160;
    var lx = x + 14, ly = y + 14;
    if (lx + w + P > W) lx = x - w - 10;
    if (ly + h + P > H) ly = y - h - 10;
    t.style.left = Math.max(P, Math.min(lx, W - w - P)) + 'px'; t.style.top = Math.max(P, Math.min(ly, H - h - P)) + 'px';
  }
  function alvo(e) { return e.target.closest && e.target.closest('[data-tip]'); }
  function mostrar(a, x, y) { var t = el(); t.innerHTML = decodeURIComponent(a.dataset.tip); t.style.borderColor = (a.dataset.col || '#3b82f6') + '55'; t.style.display = 'block'; pos(t, x, y); }
  function esconder() { if (tip) tip.style.display = 'none'; }
  document.addEventListener('mouseover', function (e) { var a = alvo(e); if (a) mostrar(a, e.clientX, e.clientY); });
  document.addEventListener('mousemove', function (e) { if (tip && tip.style.display !== 'none' && alvo(e)) pos(tip, e.clientX, e.clientY); });
  document.addEventListener('mouseout', function (e) { if (alvo(e)) esconder(); });
  document.addEventListener('click', function (e) { var a = alvo(e); if (a) mostrar(a, e.clientX, e.clientY); else esconder(); });
  window.addEventListener('scroll', esconder, { passive: true });
})();
<\/script>`;
}

async function muralPainelExportar(btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await _mpGerarHtml();
    if (!r) { toast('Exportação indisponível nesta tela.', 'error'); return; }
    _mpBaixar(r.html, r.nome, 'text/html;charset=utf-8');
  } catch (err) {
    console.error('[Operações] Erro ao exportar:', err);
    toast('Não foi possível exportar: ' + (err.message || err), 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}
function _mpBaixar(conteudo, nome, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
// O arquivo do painel na tela ({ html, nome, titulo }) — usado pelo Exportar
// HTML e como anexo do e-mail (relatorio-email.js). null fora do painel.
async function _mpGerarHtml() {
  const painel = document.querySelector('#mural-root .mp-painel');
  if (!painel || typeof _dgrCssApp !== 'function') return null;
  const s = _mp.sel, nAntes = _mp.tlN;
  try {
    if (_mp._tl) { _mp.tlN = Infinity; _mpTlRender(); }
    const clone = painel.cloneNode(true);
    clone.querySelectorAll('.mp-tl-mais').forEach(e => e.remove());
    // Ficam só os cliques dos filtros do painel (as funções vão no arquivo).
    clone.querySelectorAll('[onclick]').forEach(e => { if (!MP_EXP_ATIVOS.test(e.getAttribute('onclick'))) e.removeAttribute('onclick'); });
    const titulo = s.tipo === 'geral' ? 'Geral' : s.tipo === 'item' ? `${s.material} · ${s.central}`
      : s.tipo === 'regional' ? s.regional : s.tipo === 'central' ? s.central : s.material;
    // Cabeçalho, barra de ações (tema, baixar, imprimir) e rodapé dos
    // relatórios do sistema (_buildRankingShellHTML, relatorio.js) — Hugo,
    // 18/11/2026; o painel entra como corpo, com o CSS do app embutido.
    const agora = new Date(), tema = document.body.dataset.theme || '', css = await _dgrCssApp();
    const quem = window.currentUser?.nome_exibicao || '';
    const P = muralPeriodo(), periodo = `${fmtPtDate(P.ini)} a ${fmtPtDate(P.fim)}`;
    const nivel = { geral: 'Geral', regional: 'Regional', central: 'Central', material: 'Material', item: 'Raio-X' }[s.tipo] || '';
    const slug = String(titulo).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const nome = `operacoes-${slug || 'painel'}-${localISODate(agora)}.html`;
    const corpo = `<style>
.mp-exp{display:flex;flex-direction:column;gap:14px;font-size:14px;color:var(--text)}
.mp-exp button:not([onclick]){pointer-events:none}
.mp-exp .mp-cc-cab,.mp-exp .mp-cc-it,.mp-exp .mp-res-var,.mp-exp .mp-tl-ev,.mp-exp .mp-tl-fixo{cursor:default}
.mp-exp .mp-cc-tend svg{max-width:100%;height:auto}
.mp-exp .mp-migalhas,.mp-exp .mp-cab h2{display:none}
/* Celular em pé (Hugo, 18/11/2026): margens menores, colunas do resumo
   empilhadas com filete em cima, cartões em uma coluna; o gráfico de
   inventário rola na horizontal em vez de encolher. */
@media (max-width:640px){
  .rk-hero-inner{padding:16px 14px 14px}
  .rk-page{padding:12px 10px 20px}
  .rk-hero h1{font-size:22px}
  .action-bar{padding:10px 12px;gap:10px}
  .action-bar-title span{display:block;margin-left:0}
  .report-footer{padding:12px 14px}
  .mp-exp .mp-card{padding:14px 12px}
  .mp-exp .mp-resumo{padding:16px 0}
  .mp-exp .mp-res-col{padding:0 14px;max-width:none}
  .mp-exp .mp-res-col + .mp-res-col{border-left:0;border-top:1px solid var(--border);padding-top:16px}
  .mp-exp .mp-ccs{grid-template-columns:1fr}
  .mp-exp .mp-cc{padding:14px 12px}
  .mp-exp .mp-faixa{margin:0 -12px;padding:8px 12px 8px 9px}
  .mp-exp .mp-inv-ctl{margin-left:0}
  .mp-exp .mp-meses-pop{right:auto;left:0;width:min(300px,calc(100vw - 40px))}
  .mp-exp .mp-inv::before{content:'Arraste para o lado para ver todos os meses →';display:block;position:sticky;left:0;font-size:11.5px;color:var(--text3);margin-bottom:4px}
  .mp-exp .mp-tl-l{font-size:13px}
}
</style>
<div class="mp-exp"><section class="mp-painel">${clone.innerHTML}</section></div>
${_mpExpScript()}
${_mpExpTipScript()}`;
    const html = _buildRankingShellHTML({ periodoBadge: periodo, periodo, now: agora.toLocaleString('pt-BR') }, {
      pageTitle: `Operações · ${titulo}`, badge: `Operações · ${nivel}`, title: titulo,
      subtitle: `${quem ? `Gerado por ${quem} · ` : ''}mesmos números da Visão Micro`,
      bodyHtml: corpo, cssApp: css, offlineCompleto: true,
      temaAlternavel: true, temaInicial: /light|sand/.test(tema) ? 'light' : 'dark',
      permitirDownload: true, nomeArquivoDownload: nome,
      notaRodape: 'Operações · variações do período do Analítico, com os mesmos números da Visão Micro.'
    });
    return { html, nome, titulo };
  } finally {
    _mp.tlN = nAntes;
    if (_mp._tl) _mpTlRender();
  }
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
    // Só a lista muda (o painel não depende da busca); sem lista na tela, tudo.
    document.querySelector('#mural-root .mp-grupos')?.classList.toggle('mp-grupos-off', _mpTermos().length > 0);
    if (_mp._todos && _mp.aba !== 'semuso' && mpTrocarCorpoLista(document.querySelector('#mural-root .mp-lista'), _mpListaHtml(_mp._todos))) return;
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
    <span class="mp-dir"><span class="mp-v" style="color:${_mpCor(p.v)}">${_moPesoSinal(p.v)}</span>${p.it ? _mpPrioHtml(p.it) : ''}</span></button>`;
}

// Prioridade de ação de cada item da fila (Hugo, 17/11/2026): faixa pela
// pontuação de "Por que está nesta posição da fila"; o detalhamento vira o
// balão do selo. ponytail: cortes fixos (≥ 20 Alta, ≥ 12 Média) — calibrar
// com o uso (ou trocar por tercis da fila) se a distribuição pedir.
const MP_PRIO_FAIXAS = [[20, 'Alta', '#f43f5e'], [12, 'Média', '#f59e0b'], [-Infinity, 'Baixa', '#94a3b8']];
const _mpPrioNum = (n) => n.toFixed(1).replace('.', ',');
function _mpPrioHtml(it) {
  const [, rot, cor] = MP_PRIO_FAIXAS.find(([min]) => it.prioridade >= min);
  const grade = it.partes.filter(p => p[1]).map(p => _moRxLinha(_moEsc(p[0]), '+' + _mpPrioNum(p[1]))).join('')
    + _moRxLinha('<b style="color:var(--text)">Prioridade</b>', _mpPrioNum(it.prioridade), cor);
  const tip = _moRxTip(cor, `Prioridade ${rot}`, _mpPrioNum(it.prioridade), grade,
    '<div style="margin-top:10px;font-size:12.5px;color:var(--text2)">Por que está nesta posição da fila</div>');
  return `<span class="mp-prio" style="--c:${cor}" data-tip="${tip}" data-col="${cor}">${rot} · ${_mpPrioNum(it.prioridade)}</span>`;
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
// Animação: a largura e o conteúdo da lista que JÁ está na tela transitam
// (CSS .mp-anim) e só no fim tudo é redesenhado — assim os gráficos do painel
// saem na largura final. O conteúdo novo entra com um fade (.entrando).
const MP_LISTA_ANIM_MS = 260;
function muralPainelLista() {
  if (_mp.listaAnim) return;
  _mp.listaRecolhida = !_mp.listaRecolhida;
  try { localStorage.setItem('mural.listaRecolhida', _mp.listaRecolhida ? '1' : '0'); } catch (_) { /* sem storage */ }
  if (typeof _hideTip === 'function') _hideTip();
  const lista = document.querySelector('#mural-root .mp-lista');
  if (!lista || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return muralRender();
  _mp.listaAnim = true; _mp.listaEntrando = true;
  // Congela a largura do conteúdo para ele não refluir enquanto a lista encolhe.
  [...lista.children].forEach(c => { c.style.width = c.offsetWidth + 'px'; });
  lista.classList.add('mp-anim');
  lista.classList.toggle('recolhida', _mp.listaRecolhida);
  setTimeout(() => { _mp.listaAnim = false; muralRender(); }, MP_LISTA_ANIM_MS);
}
function _mpListaHtml(todos) {
  const ent = _mp.listaEntrando ? ' entrando' : '';
  _mp.listaEntrando = false;
  if (_mp.listaRecolhida) {
    const n = todos.filter(p => p.it).length;
    return `<section class="mp-lista recolhida${ent}"><button class="mp-lista-abrir" onclick="muralPainelLista()" title="Mostrar a lista" aria-label="Mostrar a lista" aria-expanded="false">
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

  if (aba === 'semuso' && typeof suListaHtml === 'function') linhas = suListaHtml();
  const contaAba = termos.length ? contar : todos;
  return `<section class="mp-lista${ent}">
    <div class="mp-lista-head">
      <div class="mp-lista-linha">
        <label class="mp-busca"><i class="ti ti-search"></i><input id="mp-busca" type="text" placeholder="Buscar: regional, central, material… (separe por vírgula)" value="${_moEsc(_mp.busca)}" oninput="muralPainelBusca(this.value)" aria-label="Buscar regional, central ou material"></label>
        <button class="mp-lista-recolher" onclick="muralPainelLista()" title="Recolher a lista para a lateral" aria-label="Recolher a lista" aria-expanded="true"><i class="ti ti-layout-sidebar-left-collapse"></i></button>
      </div>
    </div>
    <div class="mp-subabas" role="tablist">
        ${[['fila', 'ti-flame', 'Fila', p => !!p.it], ['faixa', 'ti-circle-check', 'Na faixa', p => !!p.fx], ['sem', 'ti-calendar-x', 'Sem lançamento', p => !!p.sl], ['semuso', 'ti-hourglass', 'Sem uso', null]]
          .map(([k, ic, rot, f]) => `<button class="mo-aba${aba === k ? ' on' : ''}" role="tab" aria-selected="${aba === k}" onclick="muralPainelAba('${k}')"${k === 'sem' ? ' title="Sem lançamento no último dia do período (AUSENTE na Visão Micro)"' : k === 'semuso' ? ' title="Material com saldo e sem uso há 60 dias ou mais (o número conta os sem tratativa)"' : ''}><i class="ti ${ic}"></i>${rot} <b>${f ? contaAba.filter(f).length : _mpSemUsoConta()}</b></button>`).join('')}
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

// Na regional as pílulas de contagem ficam ocultas no PC (o filtro de
// criticidade já tem os números) e aparecem no celular, no lugar das
// chamadas do donut, que ficam ilegíveis em tela pequena (modules.css).
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
  if (s.tipo === 'regional') return _mpRegionalHtml(ps, _mpCabHtml(_moEsc(s.regional), `${nCent} · ${contas}`, ps));
  const cab = s.tipo === 'material' ? _mpCabHtml(_moEsc(s.material), `${_moEsc(getCategoriaPorGrupo(s.material) || '')} · ${nCent} · ${contas} · donos: ${donos}`, ps)
    : _mpCabHtml(_moEsc(s.central), `${_moEsc(s.regional)} · ${contas} · donos: ${donos}`, ps);
  // Material: cada central com este material, pela variação (o par), e o
  // clique abre o Raio-X dele.
  const rank = s.tipo === 'material' ? (() => {
      const max = Math.max(1, ...ps.map(p => Math.abs(p.v)));
      return `<div class="mp-card"><h4 class="mp-tit">Centrais com ${_moEsc(s.material)} <span class="mo-hint">pela variação do período</span></h4>${[...ps].sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).map(p => `<button class="mp-rank mp-rank-mat" ${_mpLinhaAttrs('item', p)}>
        ${_mpIco(p.nivel)}<b>${_moEsc(p.central)}</b><span class="mp-rank-bar"><i style="width:${(Math.abs(p.v) / max * 100).toFixed(1)}%;background:${MP_NIVEL_COR[p.nivel]}"></i></span><span class="mono" style="color:${_mpCor(p.v)}">${_moPesoSinal(p.v)}</span></button>`).join('')}</div>`;
    })() : '';
  const inv = `<div class="mp-card"><h4 class="mp-tit">Variação de inventário a inventário <span class="mo-hint">soma líquida dos ${ps.length} pares</span></h4>
    <div id="mp-inv" class="mp-inv"><span class="mo-hint">Calculando os inventários…</span></div></div>`;
  return `${cab}${_mpSaudeHtml(ps)}${inv}${rank}${_mpPendHtml()}${_mpTopHtml(ps)}${_mpTlHtml()}`;
}

// ── Render ─────────────────────────────────────────────────────────────────
// Aba Sem uso (mural-semuso.js): lista e painel próprios, fora das contas de
// saúde e variação dos pares.
const _mpSemUsoConta = () => typeof suItensFiltrados === 'function' ? suItensFiltrados().filter(i => !i.trat).length : 0;
function muralPainelRender(el, itens) {
  const semUso = _mp.aba === 'semuso' && typeof suPainelHtml === 'function';
  const todos = _mp._todos = _mpPares(itens); // _todos: regionais do envio em massa (relatorio-email.js)
  const fila = _muralAplicarFiltros(itens);
  // Seleção que sumiu (filtro, busca, item que saiu da fila) volta ao Geral.
  const s = _mp.sel;
  if (s.tipo !== 'geral' && !todos.some(p => s.tipo === 'item' ? (p.central === s.central && p.material === s.material) : _mpNoEscopo(p, s))) _mp.sel = { tipo: 'geral' };
  // Balão dos pontos do gráfico de inventários e do selo de prioridade da
  // lista (o do Raio-X tem o seu, em #mp-rx).
  if (!el.dataset.mpTip && typeof _showTip === 'function') {
    el.dataset.mpTip = '1';
    const ALVO = '.mp-inv .mo-rx-pt, .mp-prio, .mp-ct-col';
    el.addEventListener('mouseover', e => { const p = e.target.closest?.(ALVO); if (p) _showTip(e, decodeURIComponent(p.dataset.tip), p.dataset.col); });
    el.addEventListener('mousemove', e => { if (e.target.closest?.(ALVO)) _moveTip(e); });
    el.addEventListener('mouseout', e => { if (e.target.closest?.(ALVO)) _hideTip(); });
  }
  // Mantém a rolagem da fila ao redesenhar (clique num item não volta ao topo).
  const sc = el.querySelector('.mp-lista-corpo')?.scrollTop;
  el.innerHTML = `<div class="mp-root">${_muralFiltrosHtml(itens)}
    <div class="mp">${_mpListaHtml(todos)}
      <section class="mp-painel">${semUso ? suPainelHtml() : _mpPainelHtml(todos, fila)}</section></div></div>`;
  const c = el.querySelector('.mp-lista-corpo'); if (c && sc) c.scrollTop = sc;
  if (!semUso) _mpDepois(todos);
}

// Depois do HTML: donuts (o próprio _renderDonut da Macro), Raio-X no painel
// e os blocos que demoram (pendências, acumulado) em segundo plano.
function _mpDepois(todos) {
  const gen = ++_mp.gen, s = _mp.sel, d = _mp._donuts || {};
  _mp._esc = null; // os gráficos só redesenham depois do acumulado deste painel
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
    const box = document.getElementById('mp-pend'); // a regional não tem Pendências: pula o cálculo
    if (box) {
      for (let i = 0; i < centrais.length; i++) {
        _mpPendCentral(centrais[i]);
        await muralCederTempo(ced); if (gen !== _mp.gen) return;
      }
      if (gen !== _mp.gen) return;
      box.innerHTML = _mpPendCorpoHtml(_mpPendEscopo(ps, centrais, soMat), comDocs);
      // Explicado (OS duplicadas) dos itens da fila do escopo — o caro; depois redesenha.
      // Os prazos da lista vêm primeiro (_muralEnriquecer); o explicado espera.
      while (_mo.enriquecendo) { await new Promise(r => setTimeout(r, 60)); if (gen !== _mp.gen) return; }
      const fila = ps.filter(p => p.it && !_mp.explic.has(_mpChave(p.central, p.material)));
      for (let i = 0; i < fila.length; i++) {
        _mpExplicPar(fila[i]);
        await muralCederTempo(ced); if (gen !== _mp.gen) return;
      }
      if (fila.length && gen === _mp.gen) box.innerHTML = _mpPendCorpoHtml(_mpPendEscopo(ps, centrais, soMat), comDocs);
    }
    if (s.tipo === 'geral') return;
    let tot = 0, nInv = 0;
    for (let i = 0; i < ps.length; i++) {
      const a = _mpAcumPar(ps[i]); tot += a.v; nInv = Math.max(nInv, a.n);
      await muralCederTempo(ced); if (gen !== _mp.gen) return;
    }
    const ac = document.getElementById('mp-acum');
    if (ac) ac.innerHTML = `<span class="mo-hint">Acumulado</span><b class="mp-big" style="color:${_mpCor(tot)}">${_moPesoSinal(tot)}</b><small class="mo-hint">${nInv} inventário${nInv === 1 ? '' : 's'} + o período</small>`;
    // Inventário (o filtro de criticidade da regional vale só para os cartões)
    // e a tendência de cada cartão — os meses já estão no cache.
    _mp._esc = { ps, s };
    _mpGraficos();
    _mpTlAtualizar(ps, s);
    const serie = await _mpSerieSaude(ps, gen);
    if (!serie || gen !== _mp.gen) return;
    const tend = document.getElementById('mp-tend');
    if (tend) tend.innerHTML = _mpTendHtml(serie);
  } catch (err) {
    // Nunca ficar em "calculando…" para sempre: mostra o erro no lugar.
    console.error('[Operações] Erro no cálculo do painel:', err);
    const msg = `<span class="mo-hint" style="color:var(--red)">Não foi possível calcular: ${_moEsc(err.message || String(err))}</span>`;
    ['mp-pend', 'mp-acum', 'mp-inv', 'mp-tend', 'mp-tl'].forEach(id => { const e = document.getElementById(id); if (e && /calculando|montando/i.test(e.textContent)) e.innerHTML = msg; });
    document.querySelectorAll('#mural-root .mp-cc-tend').forEach(e => { if (/calculando/i.test(e.textContent)) e.innerHTML = msg; });
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
