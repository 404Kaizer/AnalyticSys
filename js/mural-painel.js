// ═══════════════════════════════════════════════════════════
// OPERAÇÕES · VISÃO NOVA (EM TESTE) — lista + painel
// ═══════════════════════════════════════════════════════════
// Hugo, 10/11/2026 (opção B do quadro de layouts): à esquerda a lista
// Regional → Central → Item; à direita um painel que muda com a seleção:
//   Geral (nada selecionado) → Regional → Central → Item (o Raio-X).
// Mesmos blocos em todo nível: Saúde (variação do mês, acumulado, tendência da
// saúde e o donut da Macro), Pendências, O que mais pesa, Ações.
// Fica como visão SECUNDÁRIA dentro de Operações (botão "Testar a visão
// nova") até ser aprovada; a visão atual não muda. Tudo sai dos mesmos pares
// do Mural (fotos já reconciliadas pela base mais recente), então os números
// batem com a fila. Depende de mural.js (estado _mo) e macro.js (_renderDonut).

const _mp = { sel: { tipo: 'geral' }, aba: 'fila', busca: '', pend: new Map(), acum: new Map(), entPorCentral: null, carimbo: '', gen: 0 };

const MP_NIVEL_COR = { critico: 'var(--red)', urgente: 'var(--urgente)', atencao: 'var(--amber)', bom: 'var(--green)' };
const _mpIco = (n, cls = 'mp-ico') => `<i class="ti ${_levelIcon[n] || 'ti-minus'} ${cls}" style="color:${MP_NIVEL_COR[n] || 'var(--text3)'}" aria-hidden="true"></i>`;
const _mpCor = (v) => v < -0.05 ? 'var(--red)' : v > 0.05 ? 'var(--amber)' : 'var(--text2)';
const _mpChave = (c, m) => c + '|' + m;

function muralPainelAtivo() { try { return localStorage.getItem('mural.visao') === 'painel'; } catch (_) { return false; } }
function muralVisao(nova) {
  try { localStorage.setItem('mural.visao', nova ? 'painel' : 'atual'); } catch (_) { /* sem storage */ }
  // Fecha a gaveta do Raio-X sem passar por muralRaioXFechar (que, no painel, volta para a central).
  document.getElementById('mo-drawer')?.classList.remove('open');
  document.getElementById('mo-scrim')?.classList.remove('open');
  _mo.rx = null; _mp.sel = { tipo: 'geral' };
  muralRender();
}
function muralPainelBotaoHtml(nova) {
  return `<div class="mp-switch">${nova ? '<span class="mp-beta"><i class="ti ti-flask"></i> Visão nova · em teste</span>' : ''}
    <button class="btn btn-sm" onclick="muralVisao(${!nova})"><i class="ti ${nova ? 'ti-arrow-back-up' : 'ti-flask'}"></i> ${nova ? 'Voltar à visão atual' : 'Testar a visão nova'}</button></div>`;
}

// ── Pares e saúde ──────────────────────────────────────────────────────────
// Todo par avaliado nas fotos: fila (com os filtros da barra) + faixa.
function _mpPares(itens) {
  const q = normalizeText(_mp.busca || '');
  const casa = (p) => !q || normalizeText(`${p.material} ${p.central} ${p.regional}`).includes(q);
  const fila = _muralAplicarFiltros(itens).map(i => ({ central: i.central, regional: i.regional || '—', material: i.material,
    v: i.v, rs: i.rs || 0, catKey: i.catKey, nivel: i.nivel, it: i }));
  const faixa = _muralFaixaFiltradas().map(l => ({ central: l.central, regional: l.regional || '—', material: l.material,
    v: l.v, rs: 0, catKey: getCatKeyDoCadastro(l.material) || detectCatKey(l.categoria), nivel: 'bom', fx: l }));
  return fila.concat(faixa).filter(casa);
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
const _mpPeso = (p) => p.it ? p.it.prioridade : (p.fx?.pct || 0) / 100;
const _mpPesoGrupo = (ps) => Math.max(...ps.map(_mpPeso));

// Série da saúde no mês, dia a dia, a partir dos pontos de cada item (o
// acumulado dos 30 dias menos o que já vinha antes do mês). Pares da faixa
// contam como bom o mês todo.
// ponytail: aproximação — os pontos têm âncora no início da janela de 30
// dias, não no dia 1; se divergir da conta do mês, guardar a série do mês na foto.
function _mpSerieSaude(ps) {
  const J = muralJanela(), th = getHealthThresholds();
  const ini = new Date(J.fim.getFullYear(), J.fim.getMonth(), 1);
  const dias = J.dayList.filter(d => d >= ini);
  const serie = ps.filter(p => p.it).map(p => {
    const base = (p.it.v30 ?? p.it.v) - p.it.v;
    const pts = (p.it.pontos || []).map(([dt, v]) => [parseDate(dt), v]).filter(([d]) => d && d >= ini);
    return { catKey: p.catKey, pts, base };
  });
  const nBom = ps.length - serie.length;
  return dias.map(d => {
    const c = { bom: nBom, atencao: 0, urgente: 0, critico: 0 };
    serie.forEach(s => {
      let v = null;
      for (const [pd, pv] of s.pts) { if (pd <= d) v = pv - s.base; else break; }
      c[v == null ? 'bom' : classifyVariation(Math.abs(v), s.catKey, th)]++;
    });
    return macroScoreFromCounts(c);
  });
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
  return { counts, levelMeta, itens, score: macroScoreFromCounts(counts), total: ps.length };
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
  return { counts, levelMeta: _mpDonutMats(ps).levelMeta, itens, score: macroScoreFromCounts(counts), total: porC.size, piores };
}

// ── Pendências (por central, sob demanda, com cache) ──────────────────────
// NF da PUZL sem entrada no SAP e OS da PUZL sem baixa no SAP: a mesma conta
// das "NFs/OS pendentes" da Micro (calcPendentesIntegracao), no mês em aberto.
function _mpCarimbo() {
  const J = muralJanela();
  return [state.sap?.length, state.entradas?.length, state.saidas?.length, localISODate(J.fim)].join('|');
}
function _mpPendCentral(central) {
  const car = _mpCarimbo();
  if (car !== _mp.carimbo) { _mp.carimbo = car; _mp.pend.clear(); _mp.acum.clear(); _mp.entPorCentral = null; }
  if (_mp.pend.has(central)) return _mp.pend.get(central);
  if (!_mp.entPorCentral) {
    _mp.entPorCentral = new Map();
    (state.entradas || []).forEach(e => {
      const c = e.centralCompra || e.centralDestino || '';
      if (!_mp.entPorCentral.has(c)) _mp.entPorCentral.set(c, []);
      _mp.entPorCentral.get(c).push(e);
    });
  }
  const J = muralJanela();
  const ini = new Date(J.fim.getFullYear(), J.fim.getMonth(), 1), fim = new Date(J.fim); fim.setHours(23, 59, 59, 999);
  const sap = (getSapIndex().byCentral.get(central) || []).filter(r => { const d = parseDate(r.dtLanc); return d && d >= ini && d <= fim; });
  const r = calcPendentesIntegracao({ central, dtIni: ini, dtFim: fim, sapNoPeriodo: sap, entradasDaCentral: _mp.entPorCentral.get(central) || [] });
  _mp.pend.set(central, r);
  return r;
}

// Pendências de um escopo. OS duplicadas e lançamentos pendentes já vêm nos pares.
function _mpPendEscopo(ps, centrais) {
  const nf = [], os = [];
  centrais.forEach(c => { const r = _mpPendCentral(c); nf.push(...r.pendNF.map(e => ({ ...e, _c: c }))); os.push(...r.pendOS.map(e => ({ ...e, _c: c }))); });
  const dup = [];
  ps.forEach(p => (p.it?.explic || []).forEach(e => { if (e.chave === 'duplicada' && e.lado === 'sai') dup.push({ p, n: e.n, kg: e.kg }); }));
  const lanc = ps.filter(p => p.it ? p.it.lancPendente : p.fx?.terPend);
  return { nf, os, dup, lanc };
}

// ── Acumulado (inventários fechados + mês em aberto), por par, com cache ──
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
// de barras do Raio-X) + o mês em aberto (tracejado). Sai do cache do
// acumulado, então não custa cálculo a mais. Desenhado na largura real.
function _mpInvHtml(ps, larg) {
  const J = muralJanela();
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
  const ab = { rot: J.fim.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '') + '/' + String(J.fim.getFullYear()).slice(2),
    v: 0, n: ps.length, des: 0, sob: 0, pares: [], aberto: true };
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
  // Linha: trechos contínuos entre meses com inventário; até o mês em aberto, tracejada.
  const idx = pts.map((p, i) => (p.n ? i : -1)).filter(i => i >= 0);
  idx.forEach((i, k) => {
    if (!k) return;
    const j = idx[k - 1];
    svg.push(`<line x1="${f(x(j))}" y1="${f(y(pts[j].v))}" x2="${f(x(i))}" y2="${f(y(pts[i].v))}" stroke="var(--text2)" stroke-width="2.2"${pts[i].aberto || i - j > 1 ? ' stroke-dasharray="5 4"' : ''}/>`);
  });
  pts.forEach((p, i) => {
    svg.push(`<text x="${f(x(i))}" y="${H - 20}" text-anchor="middle" class="mo-rx-ax" style="fill:var(--text2)">${_moEsc(p.rot)}</text>`,
      `<text x="${f(x(i))}" y="${H - 6}" text-anchor="middle" class="mo-rx-ax">${p.aberto ? 'em aberto' : p.n ? 'inventário' : 'sem inv.'}</text>`);
    if (!p.n) return;
    const c = _moRxHex(p.v), top = [...p.pares].sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 3);
    const grade = _moRxLinha('Variação líquida', _moKg(p.v), c) + _moRxLinha('Desfalques', _moKg(p.des), '#f43f5e')
      + _moRxLinha('Sobras', _moKg(p.sob), '#f59e0b') + _moRxLinha(p.aberto ? 'Pares' : 'Pares com inventário', `${p.n} de ${ps.length}`);
    const extra = `<div style="margin-top:10px;font-size:12.5px;color:var(--text2)">Os que mais pesam:</div>` + top.map(t =>
      `<div style="display:flex;gap:10px;font-size:12.5px;margin-top:3px"><span style="color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_moEsc(t.nome)}</span><span style="margin-left:auto;font-family:var(--mono);color:${_moRxHex(t.v)}">${_moKg(t.v)}</span></div>`).join('');
    const tip = _moRxTip(c, `${p.rot}${p.aberto ? ' · em aberto' : ''}`, '', grade, extra);
    const ly = p.v < 0 ? y(p.v) + 20 : y(p.v) - 11;
    svg.push(`<circle class="mo-rx-pt" cx="${f(x(i))}" cy="${f(y(p.v))}" r="5" fill="${c}"${p.aberto ? ' fill-opacity=".45" stroke="' + c + '" stroke-width="1.5"' : ''} data-tip="${tip}" data-col="${c}"/>`,
      `<text x="${f(x(i))}" y="${f(ly)}" text-anchor="middle" class="mo-rx-ax" style="fill:${c};font-weight:600;pointer-events:none">${_moPesoSinal(p.v)}</text>`);
  });
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Variação líquida de inventário a inventário" style="display:block;overflow:visible">${svg.join('')}</svg>`;
}

// ── Seleção ────────────────────────────────────────────────────────────────
function muralPainelSel(el) {
  const d = el.dataset, s = _mp.sel;
  // Clicar de novo no que já está aberto sobe um nível.
  if (d.t === 'regional' && s.tipo === 'regional' && s.regional === d.r) _mp.sel = { tipo: 'geral' };
  else if (d.t === 'central' && s.tipo === 'central' && s.central === d.c) _mp.sel = { tipo: 'regional', regional: d.r };
  else _mp.sel = d.t === 'geral' ? { tipo: 'geral' } : { tipo: d.t, regional: d.r, central: d.c, material: d.m };
  if (_mp.sel.tipo !== 'item') _mo.rx = null;
  if (typeof _hideTip === 'function') _hideTip();
  muralRender();
}
function muralPainelVoltar() {
  const s = _mp.sel;
  _mp.sel = s.tipo === 'item' ? { tipo: 'central', regional: s.regional, central: s.central } : { tipo: 'geral' };
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

// ── Lista (esquerda) ───────────────────────────────────────────────────────
function _mpLinhaAttrs(t, p) {
  return `onclick="muralPainelSel(this)" data-t="${t}" data-r="${_moEsc(p.regional || '')}" data-c="${_moEsc(p.central || '')}" data-m="${_moEsc(p.material || '')}"`;
}

function _mpListaHtml(todos, nFila, nFaixa) {
  const s = _mp.sel, faixa = _mp.aba === 'faixa';
  const vis = todos.filter(p => faixa ? !!p.fx : !!p.it);
  const porReg = [..._mpAgrupar(vis, p => p.regional)].sort((a, b) => _mpPesoGrupo(b[1]) - _mpPesoGrupo(a[1]));
  const linhas = porReg.map(([reg, rps]) => {
    const rTodos = todos.filter(p => p.regional === reg);
    const sR = _mpSaude(rTodos), aberta = s.regional === reg && s.tipo !== 'geral';
    const vR = rps.reduce((t, p) => t + p.v, 0);
    const centrais = [..._mpAgrupar(rps, p => p.central)].sort((a, b) => _mpPesoGrupo(b[1]) - _mpPesoGrupo(a[1]));
    let h = `<button class="mp-row mp-reg${s.tipo === 'regional' && s.regional === reg ? ' sel' : ''}" ${_mpLinhaAttrs('regional', { regional: reg })} title="Saúde ${sR.score}%">
      <i class="ti ti-chevron-${aberta ? 'down' : 'right'} mp-chev"></i>${_mpIco(sR.nivel)}
      <span class="mp-nome"><b>Reg. ${_moEsc(reg)}</b><small>${centrais.length} centra${centrais.length === 1 ? 'l' : 'is'} · ${rps.length} ite${rps.length === 1 ? 'm' : 'ns'}</small></span>
      <span class="mp-v" style="color:${_mpCor(vR)}">${_moPesoSinal(vR)}</span></button>`;
    if (!aberta) return h;
    centrais.forEach(([c, cps]) => {
      const sC = _mpSaude(todos.filter(p => p.central === c)), cAberta = s.central === c && (s.tipo === 'central' || s.tipo === 'item');
      const vC = cps.reduce((t, p) => t + p.v, 0);
      h += `<button class="mp-row mp-cen${s.tipo === 'central' && s.central === c ? ' sel' : ''}" ${_mpLinhaAttrs('central', { regional: reg, central: c })} title="Saúde ${sC.score}%">
        <i class="ti ti-chevron-${cAberta ? 'down' : 'right'} mp-chev"></i>${_mpIco(sC.nivel)}
        <span class="mp-nome"><b>${_moEsc(c)}</b><small>${cps.length} ite${cps.length === 1 ? 'm' : 'ns'}</small></span>
        <span class="mp-v" style="color:${_mpCor(vC)}">${_moPesoSinal(vC)}</span></button>`;
      if (!cAberta) return;
      cps.sort((a, b) => _mpPeso(b) - _mpPeso(a)).forEach(p => {
        let sit, sitCor = 'var(--text2)';
        if (p.it) {
          const pz = _muralPrazoTxt(p.it), pend = _moPendente(p.it);
          sit = `${(MURAL_STATUS[p.it.status] || {}).label || ''} · ${pz.t}${pend ? ` · lançamento ${pend} pendente` : ''}`;
          if (pz.red || p.it.status === 'escalonado') sitCor = 'var(--red)';
        } else {
          sit = `${Math.round(p.fx.pct)}% da faixa · último lançamento ${(p.fx.ult || '—').slice(0, 5)}${p.fx.terPend ? ` · lançamento ${_moPendente({ lancPendente: p.fx.terPend })} pendente` : ''}`;
        }
        h += `<button class="mp-row mp-item${s.tipo === 'item' && s.central === c && s.material === p.material ? ' sel' : ''}" ${_mpLinhaAttrs('item', p)}>
          ${_mpIco(p.nivel)}<span class="mp-nome"><b>${_moEsc(p.material)}</b><small style="color:${sitCor}">${_moEsc(sit)}</small></span>
          <span class="mp-v" style="color:${_mpCor(p.v)}">${_moPesoSinal(p.v)}</span></button>`;
      });
    });
    return h;
  }).join('');
  return `<section class="mp-lista">
    <div class="mp-lista-head">
      <div class="mo-abas" role="tablist">
        <button class="mo-aba${faixa ? '' : ' on'}" role="tab" aria-selected="${!faixa}" onclick="muralPainelAba('fila')"><i class="ti ti-flame"></i>Fila <b>${nFila}</b></button>
        <button class="mo-aba${faixa ? ' on' : ''}" role="tab" aria-selected="${faixa}" onclick="muralPainelAba('faixa')"><i class="ti ti-circle-check"></i>Na faixa <b>${nFaixa}</b></button>
      </div>
      <label class="mp-busca"><i class="ti ti-search"></i><input id="mp-busca" type="text" placeholder="Buscar material, central ou regional" value="${_moEsc(_mp.busca)}" oninput="muralPainelBusca(this.value)" aria-label="Buscar material, central ou regional"></label>
    </div>
    <div class="mp-lista-corpo">${linhas || '<div class="empty-state" style="padding:24px"><p>Nada com esses filtros.</p></div>'}</div>
  </section>`;
}

// ── Painel (direita) ──────────────────────────────────────────────────────
function _mpCabHtml(titulo, sub, ps) {
  const s = _mp.sel, v = ps.reduce((t, p) => t + p.v, 0), rs = ps.reduce((t, p) => t + p.rs, 0);
  const migalhas = [`<button class="mo-link" ${_mpLinhaAttrs('geral', {})}>Geral</button>`];
  if (s.tipo === 'central') migalhas.push(`<button class="mo-link" ${_mpLinhaAttrs('regional', { regional: s.regional })}>Reg. ${_moEsc(s.regional)}</button>`);
  migalhas.push(`<span>${s.tipo === 'regional' ? 'Regional' : 'Central'}</span>`);
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
  const serie = _mpSerieSaude(ps);
  const d = serie.length > 1 ? serie[serie.length - 1] - serie[0] : 0;
  const corT = d < 0 ? 'var(--red)' : d > 0 ? 'var(--green)' : 'var(--text2)';
  const W = 200, H = 54, mx = serie.length > 1 ? (W - 8) / (serie.length - 1) : 0, y = (s) => (H - 4 - s / 100 * (H - 10)).toFixed(1);
  const pts = serie.map((s, i) => `${(4 + i * mx).toFixed(1)},${y(s)}`).join(' ');
  const J = muralJanela(), ini = new Date(J.fim.getFullYear(), J.fim.getMonth(), 1);
  return `<div class="mp-card mp-saude">
    <div class="mp-saude-esq">
      <div><span class="mo-hint">Variação do mês</span><b class="mp-big" style="color:${_mpCor(v)}">${_moPesoSinal(v)}</b></div>
      <div id="mp-acum"><span class="mo-hint">Acumulado</span><b class="mp-big mo-hint">calculando…</b></div>
      <div class="mp-saude-tend">
        <div class="mp-saude-tend-l"><span class="mo-hint">Saúde no mês</span><b style="color:${corT}">${d < 0 ? '▼ piorando' : d > 0 ? '▲ melhorando' : '→ estável'}</b></div>
        ${serie.length > 1 ? `<svg width="100%" viewBox="0 0 ${W} ${H}" role="img" aria-label="Saúde ${d < 0 ? 'piorando' : d > 0 ? 'melhorando' : 'estável'} no mês" style="display:block">
          <polyline points="${pts}" fill="none" stroke="${corT}" stroke-width="2.2" stroke-linejoin="round"></polyline>
          <circle cx="${(4 + (serie.length - 1) * mx).toFixed(1)}" cy="${y(serie[serie.length - 1])}" r="3.5" fill="${corT}"></circle></svg>` : '<span class="mo-hint">Poucos dias no mês ainda.</span>'}
        <div class="mp-saude-datas mono"><span>${fmtPtDate(ini).slice(0, 5)}</span><span>${fmtPtDate(J.fim).slice(0, 5)}</span></div>
      </div>
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
      ${_mpIco(p.nivel)}<span class="mp-nome"><b>${_moEsc(p.material)}</b>${_mp.sel.tipo === 'regional' ? `<small>${_moEsc(p.central)}</small>` : ''}</span>
      <span class="mp-v" style="color:${_mpCor(p.v)}">${_moPesoSinal(p.v)}</span></button>`).join('') : '<p class="mo-hint">Nada fora da faixa aqui.</p>'}</div>`;
}

function _mpAcoesHtml(ps) {
  const J = muralJanela(), ini = new Date(J.fim.getFullYear(), J.fim.getMonth(), 1);
  let nCom = 0, nOc = 0, ult = null;
  ps.forEach(p => {
    const a = _muralAcoes(p.central, p.material, ini);
    nCom += a.comentarios.length; nOc += a.ocs.length;
    (typeof _varComDe === 'function' ? _varComDe(p.central, p.material) : []).forEach(r => {
      if (r.oc_id || !r.created_at) return;
      if (!ult || r.created_at > ult.created_at) ult = { ...r, central: p.central, material: p.material };
    });
  });
  return `<div class="mp-card"><h4 class="mp-tit">Ações no mês</h4>
    <div class="mp-acoes-n"><span><b>${nCom}</b> comentário${nCom === 1 ? '' : 's'}</span><span><b>${nOc}</b> ocorrência${nOc === 1 ? '' : 's'} aberta${nOc === 1 ? '' : 's'}</span></div>
    ${ult ? `<div class="mp-ult"><span class="mo-hint">Último · ${_moEsc(ult.autor_nome || ult.autor || '—')} · ${new Date(ult.created_at).toLocaleDateString('pt-BR')} · ${_moEsc(ult.material)} · ${_moEsc(ult.central)}</span><div>${_moEsc(ult.texto || '')}</div></div>` : '<p class="mo-hint">Nenhum comentário neste mês.</p>'}</div>`;
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
    const base = _mo.fotos.find(f => d.cats.includes(f.categoria))?.atual.payload?.base || {};
    return `<button class="mp-time-l" onclick="muralPainelDono(this)" data-cats="${_moEsc(JSON.stringify(d.cats))}" title="Filtrar a lista pelas categorias de ${_moEsc(d.nome)}">
      <span class="mp-nome"><b>${_moEsc(d.nome)}</b><small>${_moEsc(d.cats.join(', '))}</small></span>
      ${_muralBarraFech(its)}<span class="mono mo-hint">${trat}/${its.length}</span>
      <span class="mp-time-n"><b style="color:${esc ? 'var(--red)' : 'var(--text3)'}">${esc}</b> escalonados · SAP ${_moEsc((base.sap || '—').slice(0, 5))}</span></button>`;
  }).join('');
  return `<div class="mp-card"><h4 class="mp-tit">Time</h4>${linhas}</div>`;
}

function _mpPainelHtml(todos, itensFila) {
  const s = _mp.sel;
  if (s.tipo === 'item') return `<div class="mp-rx" id="mp-rx" data-c="${_moEsc(s.central)}" data-m="${_moEsc(s.material)}"></div>`;
  if (s.tipo === 'geral') {
    const dc = _mpDonutCentrais(todos);
    _mp._donuts = { centrais: dc, mats: _mpDonutMats(todos) };
    return `${_muralPlacarHtml(itensFila)}
      <div class="mp-dois">
        <div class="mp-card"><h4 class="mp-tit">Saúde das centrais <span class="mo-hint">${dc.total} centrais</span></h4>${_mpDonutCaixa('mp-centrais')}
          ${dc.piores.length ? `<div class="mo-hint" style="margin-top:6px">Piores — clique para abrir a central</div><div class="mp-chips">${dc.piores.map(c => `<button class="mp-chip" ${_mpLinhaAttrs('central', c)}>${_mpIco(c.nivel)}${_moEsc(c.central)} <b style="color:${MP_NIVEL_COR[c.nivel]}">${c.score}%</b></button>`).join('')}</div>` : ''}</div>
        <div class="mp-card"><h4 class="mp-tit">Materiais por nível <span class="mo-hint">${todos.length} pares</span></h4>${_mpDonutCaixa('mp-mats')}
          <div class="mo-hint" style="margin-top:6px">Atenção + urgente + crítico = a fila; bom = na faixa.</div></div>
      </div>
      ${_mpPendHtml()}${_mpTimeHtml(_mo._ultItens || [])}`;
  }
  const ps = todos.filter(p => s.tipo === 'regional' ? p.regional === s.regional : p.central === s.central);
  const centrais = [...new Set(ps.map(p => p.central))];
  const nF = ps.filter(p => p.it).length, nB = ps.length - nF;
  _mp._donuts = { mats: _mpDonutMats(ps) };
  const cab = s.tipo === 'regional'
    ? _mpCabHtml(`Reg. ${_moEsc(s.regional)}`, `${centrais.length} centra${centrais.length === 1 ? 'l' : 'is'} · ${nF} na fila · ${nB} na faixa`, ps)
    : _mpCabHtml(_moEsc(s.central), `Reg. ${_moEsc(s.regional)} · ${nF} na fila · ${nB} na faixa · donos: ${_moEsc([...new Set(ps.filter(p => p.it).map(p => p.it.dono?.nome).filter(Boolean))].join(', ') || '—')}`, ps);
  const rank = s.tipo === 'regional' ? `<div class="mp-card"><h4 class="mp-tit">Saúde das centrais da regional</h4>${centrais.map(c => ({ c, ...(_mpSaude(ps.filter(p => p.central === c))) }))
    .sort((a, b) => a.score - b.score).map(x => `<button class="mp-rank" ${_mpLinhaAttrs('central', { regional: s.regional, central: x.c })}>
      ${_mpIco(x.nivel)}<b>${_moEsc(x.c)}</b><span class="mp-rank-bar"><i style="width:${x.score}%;background:${MP_NIVEL_COR[x.nivel]}"></i></span><span class="mono" style="color:${MP_NIVEL_COR[x.nivel]}">${x.score}%</span></button>`).join('')}</div>` : '';
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
  if (s.tipo !== 'geral' && !todos.some(p => p.regional === s.regional && (s.tipo === 'regional' || p.central === s.central) && (s.tipo !== 'item' || p.material === s.material))) _mp.sel = { tipo: 'geral' };
  // Balão dos pontos do gráfico de inventários (o do Raio-X tem o seu, em #mp-rx).
  if (!el.dataset.mpTip && typeof _showTip === 'function') {
    el.dataset.mpTip = '1';
    el.addEventListener('mouseover', e => { const p = e.target.closest?.('.mp-inv .mo-rx-pt'); if (p) _showTip(e, decodeURIComponent(p.dataset.tip), p.dataset.col); });
    el.addEventListener('mousemove', e => { if (e.target.closest?.('.mp-inv .mo-rx-pt')) _moveTip(e); });
    el.addEventListener('mouseout', e => { if (e.target.closest?.('.mp-inv .mo-rx-pt')) _hideTip(); });
  }
  el.innerHTML = muralPainelBotaoHtml(true) + `<div class="mp-root">${_muralFiltrosHtml(itens)}
    <div class="mp">${_mpListaHtml(todos, todos.filter(p => p.it).length, todos.filter(p => p.fx).length)}
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
  const ps = s.tipo === 'geral' ? todos : todos.filter(p => s.tipo === 'regional' ? p.regional === s.regional : p.central === s.central);
  setTimeout(async () => {
    const centrais = [...new Set(ps.map(p => p.central))];
    for (let i = 0; i < centrais.length; i++) {
      _mpPendCentral(centrais[i]);
      if (i % 4 === 3) { await yieldToUI(); if (gen !== _mp.gen) return; }
    }
    if (gen !== _mp.gen) return;
    const box = document.getElementById('mp-pend');
    if (box) box.innerHTML = _mpPendCorpoHtml(_mpPendEscopo(ps, centrais), s.tipo === 'central');
    if (s.tipo === 'geral') return;
    let tot = 0, nInv = 0;
    for (let i = 0; i < ps.length; i++) {
      const a = _mpAcumPar(ps[i]); tot += a.v; nInv = Math.max(nInv, a.n);
      if (i % 3 === 2) { await yieldToUI(); if (gen !== _mp.gen) return; }
    }
    const ac = document.getElementById('mp-acum');
    if (ac) ac.innerHTML = `<span class="mo-hint">Acumulado</span><b class="mp-big" style="color:${_mpCor(tot)}">${_moPesoSinal(tot)}</b><small class="mo-hint">${nInv} inventário${nInv === 1 ? '' : 's'} + mês em aberto</small>`;
    const inv = document.getElementById('mp-inv');
    if (inv) inv.innerHTML = _mpInvHtml(ps, inv.clientWidth);
  }, 0);
}

function _mpPendCorpoHtml(pd, comDocs) {
  const kg = (e) => typeof _convertNfPesoToKg === 'function' ? _convertNfPesoToKg(e.peso, e.um, e.material, e.fornecedor) : num(e.peso);
  const nDup = pd.dup.reduce((t, x) => t + x.n, 0);
  const caixas = [
    [pd.nf.length, 'NF PUZL sem entrada SAP', 'var(--amber)'],
    [null, 'Cobranças de insumos', 'var(--text3)', 'seção em desenho'],
    [pd.os.length, 'OS PUZL sem baixa SAP', 'var(--amber)'],
    [nDup, 'OS duplicadas no SAP', 'var(--red)'],
    [pd.lanc.length, 'Lançamentos pendentes', 'var(--amber)']
  ].map(([n, rot, cor, obs]) => `<div class="mp-pend-cx"><b style="color:${n ? cor : 'var(--text3)'}">${n == null ? '—' : n}</b><span>${rot}</span>${obs ? `<small class="mo-hint">${obs}</small>` : ''}</div>`).join('');
  if (!comDocs) return `<div class="mp-pend">${caixas}</div>`;
  const docs = [
    ...pd.nf.map(e => ['NF sem entrada SAP', 'var(--amber)', `NF ${e.nf}`, e.material, kg(e), `descarga ${String(e.dtDescarga || e.dtEmissao || '').slice(0, 5)}`]),
    ...pd.dup.map(x => ['OS duplicada', 'var(--red)', `${x.n} OS`, x.p.material, Math.abs(x.kg), 'no mês']),
    ...pd.os.map(e => ['OS sem baixa SAP', 'var(--amber)', `OS ${e.os}`, e.material, num(e.peso), `emitida ${String(e.dtEmissao || '').slice(0, 5)}`]),
    ...pd.lanc.map(p => ['Lançamento pendente', 'var(--amber)', _moPendente(p.it || { lancPendente: p.fx.terPend }) || '', p.material, null, ''])
  ];
  const MAX = 40;
  return `<div class="mp-pend">${caixas}</div>
    ${docs.length ? `<div class="mp-docs">${docs.slice(0, MAX).map(([t, cor, doc, mat, peso, dt]) => `<div class="mp-doc">
      <span style="color:${cor}">${_moEsc(t)}</span><span class="mp-nome"><b>${_moEsc(doc)}</b><small>${_moEsc(mat || '')}</small></span>
      <span class="mono">${peso == null ? '—' : _moPeso(peso)}</span><span class="mo-hint">${_moEsc(dt)}</span></div>`).join('')}
      ${docs.length > MAX ? `<p class="mo-hint">+ ${docs.length - MAX} pendências</p>` : ''}</div>` : '<p class="mo-hint">Nenhuma pendência nesta central.</p>'}`;
}
