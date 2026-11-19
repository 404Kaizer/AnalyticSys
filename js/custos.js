// ══════════════════════════════════════════════════════════════════════
// CUSTOS — mapa de centrais e fornecedores, rotas, preços e alertas de NF.
// Só ADM + INSUMOS (navigate em ui.js, CSS em modules.css, RLS custos_*).
//
// Fonte: state.entradas (base compartilhada no IndexedDB). A central é a de
// DESTINO; compra ≠ destino vira selo "Transferência". Peso em kg pelos
// fatores de conversão das Configurações (_convertNfPesoToKg, ui.js).
// Preço em R$/t (agregado, aglomerante) ou R$/kg (aditivo, adição).
//
// Alerta de preço (regra do Hugo, 19/11/2026), por fornecedor + material +
// central, em ordem de emissão:
//   • "acima"/"abaixo": preço da NF acima/abaixo de TODAS as últimas 5 NFs
//     (com 2–4 anteriores, compara com as que existem); sem tolerância.
//   • "novo": primeira NF do fornecedor naquela central — exceto no 1º mês
//     da base, que não tem histórico para dizer se é novo.
//
// Coordenadas: tabela custos_geo (uma busca por CNPJ, reaproveitada por
// todos): BrasilAPI (CNPJ → endereço/CEP) → AwesomeAPI (CEP → lat/lng) →
// Nominatim (endereço) → centro do município (IBGE).
// Comentários: tabela custos_comentarios (fornecedor + material + central
// [+ NF]); cada um edita/apaga só o próprio.
// ══════════════════════════════════════════════════════════════════════

const CU_D3_URL = 'https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js';
const CU_IBGE = 'https://servicodados.ibge.gov.br/api/v3/malhas/';
const CU_GEOJSON = 'formato=application/vnd.geo%2Bjson&qualidade=minima';
const CU_UFS = { 11:'RO',12:'AC',13:'AM',14:'RR',15:'PA',16:'AP',17:'TO',21:'MA',22:'PI',23:'CE',24:'RN',25:'PB',26:'PE',27:'AL',28:'SE',29:'BA',31:'MG',32:'ES',33:'RJ',35:'SP',41:'PR',42:'SC',43:'RS',50:'MS',51:'MT',52:'GO',53:'DF' };
const CU_SER = ['--accent', '--teal', '--amber', '--purple', '--red', '--green'];
const CU_ALERTA = { acima: 'Acima das últimas 5', abaixo: 'Abaixo das últimas 5', novo: 'Fornecedor novo' };
const CU_MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const CU_MESES_NOME = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

const CU = {
  F: { uf: '', reg: '', cen: '', mat: '', forn: '', div: false },
  L: { selos: true, cor: true, calor: false },
  sel: null, tab: 'nfs', pmat: null, cmpMat: null,
  mes: 0, viewAno: 0,           // mês selecionado (aaaamm)
  iniciado: false, base: null,  // promessa da carga única (d3, malha, cadastros)
  chave: '', NFS: [], porMes: new Map(), minYm: 0,
  unMat: new Map(), nomeForn: new Map(), fornMats: new Map(),
  cen: new Map(), geo: new Map(), cnpjPorNome: new Map(),
  coms: [], comPorChave: new Map(), comAtual: null, comEditId: null,
  br: null, mun: {}, munCarregando: {}, K: 1, W: 800, H: 600,
};

/* ───────── formatação ───────── */
const _cuNf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const _cuNf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const _cuNf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const _cuNf4 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const _cuE = s => escapeHtml(String(s ?? ''));
const _cuBrl = v => 'R$ ' + _cuNf2.format(v);
const _cuBrlc = v => Math.abs(v) >= 1e6 ? 'R$ ' + _cuNf1.format(v / 1e6) + ' mi' : Math.abs(v) >= 1e3 ? 'R$ ' + _cuNf1.format(v / 1e3) + ' mil' : 'R$ ' + _cuNf0.format(v);
const _cuPct = v => (v > 0 ? '+' : '') + _cuNf1.format(v * 100) + '%';
const _cuU = m => CU.unMat.get(m) || 't';
const _cuPn = (m, p) => (_cuU(m) === 'kg' ? _cuNf4 : _cuNf2).format(p);     // número do preço
const _cuP = (m, p) => 'R$ ' + _cuPn(m, p) + '/' + _cuU(m);                  // preço com unidade
const _cuQ = (m, q) => _cuNf0.format(q) + ' ' + _cuU(m);
const _cuTon = kg => _cuNf0.format(kg / 1000) + ' t';
const _cuCss = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || getComputedStyle(document.body).getPropertyValue(n).trim();
const _cuDataNf = d => String(d % 100).padStart(2, '0') + '/' + String(Math.floor(d / 100) % 100).padStart(2, '0') + '/' + Math.floor(d / 10000);
const _cuYmTxt = ym => CU_MESES_NOME[(ym % 100) - 1] + ' de ' + Math.floor(ym / 100);
const _cuEspera = ms => new Promise(r => setTimeout(r, ms));
const _cuGroup = (arr, k) => arr.reduce((m, x) => { const key = typeof k === 'function' ? k(x) : x[k]; (m[key] || (m[key] = [])).push(x); return m; }, {});
function _cuDia(s) { const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s || ''); return m ? +(m[3] + m[2] + m[1]) : 0; }
function _cuNomeNorm(s) {
  return String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\b(LTDA|S ?A|EIRELI|ME|EPP|CIA|COMPANHIA)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

/* ───────── carga única ───────── */
function _cuScript(url) {
  return new Promise((ok, err) => {
    if (window.d3) return ok();
    const s = document.createElement('script');
    s.src = url; s.onload = ok; s.onerror = () => err(new Error('não carregou a biblioteca do mapa'));
    document.head.appendChild(s);
  });
}
function _cuRewind(fc) {
  // As malhas do IBGE vêm com anel no sentido que o d3 lê como "o globo
  // menos o polígono" — inverte o que tiver área maior que meio globo.
  const fix = poly => { if (d3.geoArea({ type: 'Polygon', coordinates: poly }) > 2 * Math.PI) poly.forEach(r => r.reverse()); };
  (fc.features || [fc]).forEach(f => { const g = f.geometry || f; if (g.type === 'Polygon') fix(g.coordinates); else if (g.type === 'MultiPolygon') g.coordinates.forEach(fix); });
  return fc;
}
async function _cuFetchAll(tabela, cols, ordem) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await window.supabaseClient.from(tabela).select(cols).order(ordem).range(de, de + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}
function _cuGarantirBase() {
  if (CU.base) return CU.base;
  CU.base = (async () => {
    await _cuScript(CU_D3_URL);
    const sb = !!window.supabaseClient;
    const [br, filiais, geo, coms, forns] = await Promise.all([
      fetch(CU_IBGE + 'paises/BR?' + CU_GEOJSON + '&intrarregiao=UF').then(r => { if (!r.ok) throw new Error('malha do IBGE indisponível'); return r.json(); }),
      sb ? _cuFetchAll('filiais', 'origem, alias, cnpj, regional, uf', 'alias').catch(() => []) : [],
      sb ? _cuFetchAll('custos_geo', '*', 'cnpj').catch(e => { console.warn('[Custos] custos_geo:', e); return []; }) : [],
      sb ? _cuFetchAll('custos_comentarios', '*', 'created_at').catch(e => { console.warn('[Custos] custos_comentarios:', e); return []; }) : [],
      sb ? _cuFetchAll('cob_fornecedores', 'nome, cnpj', 'cnpj').catch(() => []) : [],
    ]);
    CU.br = _cuRewind(br);
    _cuMontarCentrais([...(state.filiais || []), ...filiais]);
    geo.forEach(g => CU.geo.set(g.cnpj, g));
    _cuSetComs(coms);
    forns.forEach(f => { const c = String(f.cnpj || '').replace(/\D/g, ''); if (c.length === 14) CU.cnpjPorNome.set(_cuNomeNorm(f.nome), c); });
    _cuMapaInit();
    if (sb) {
      // ponytail: recarrega a tabela inteira a cada mudança (é pequena); se crescer, aplicar só o payload.
      window.supabaseClient.channel('custos_comentarios')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'custos_comentarios' }, () => _cuRecarregarComs())
        .subscribe();
    }
  })().catch(e => { CU.base = null; throw e; });
  return CU.base;
}
function _cuMontarCentrais(lista) {
  // Mesma central aparece no cadastro de vários usuários: fica a linha mais completa.
  const score = f => (String(f.cnpj || '').replace(/\D/g, '').length === 14 ? 2 : 0) + (f.regional ? 1 : 0) + (f.uf ? 1 : 0);
  lista.forEach(f => {
    const alias = String(f.alias || '').trim(); if (!alias) return;
    const atual = CU.cen.get(alias);
    if (atual && atual._s >= score(f)) return;
    const cnpj = String(f.cnpj || '').replace(/\D/g, '');
    CU.cen.set(alias, { alias, nome: f.origem || alias, cnpj: cnpj.length === 14 ? cnpj : '', regional: String(f.regional || '').trim() || 'Sem regional', uf: String(f.uf || '').toUpperCase(), _s: score(f) });
  });
}

/* ───────── cálculo (uma passada na base; refeito só quando ela muda) ───────── */
function _cuUnidade(cat, mat) {
  let c = (typeof normalizeCategoriaMaterial === 'function' ? normalizeCategoriaMaterial(cat) : cat) || '';
  if (!c && typeof getCategoriaPorGrupo === 'function') c = getCategoriaPorGrupo(mat) || '';
  return /aditiv|adi[cç][aã]o/i.test(c) ? 'kg' : 't';
}
async function _cuCalcularSeMudou() {
  const e = state.entradas || [];
  const chave = e.length + '|' + (e[e.length - 1]?.id || '') + '|' + CU.cnpjPorNome.size + '|' + (state.fatoresConversao || []).length;
  if (chave === CU.chave && CU.ents === e) return;
  if (CU.calcP) return CU.calcP; // aba aberta de novo durante o cálculo
  CU.calcP = _cuCalcular(e).then(() => { CU.chave = chave; }).finally(() => { CU.calcP = null; });
  return CU.calcP;
}
// Datas vêm como "dd/mm/aaaa" (fmtDate); poucas datas distintas → cache.
function _cuDiaC(cache, s) { let d = cache.get(s); if (d === undefined) { d = _cuDia(s); cache.set(s, d); } return d; }
async function _cuCalcular(ents) {
  // Base do ADM ~1 mi de linhas. Para não estourar memória nem travar a tela:
  //  • 1ª passada só agrupa ÍNDICES de linha por fornecedor › material › central
  //    (valores por linha em typed arrays temporários);
  //  • cada par vira arrays numéricos compactos (data, qtd, total, preço,
  //    alerta, faixa das últimas 5) — objeto por NF só no mês aberto (_cuMes);
  //  • cede a thread a cada bloco ("Calculando N%").
  // ponytail: ainda na thread principal; se ficar lento com a base real, mover a 1ª passada para um Worker.
  const t0 = performance.now(), N = ents.length;
  let pausa = t0; // cede a thread a cada ~50 ms de trabalho
  const dRow = new Int32Array(N), kgRow = new Float64Array(N), valRow = new Float64Array(N), pkgRow = new Float64Array(N);
  const diaCache = new Map(), kgUnCache = new Map(), fkPorNome = new Map(), pares = new Map(), lista = [];
  CU.unMat = new Map(); CU.nomeForn = new Map(); CU.fornMats = new Map(); CU.cenComCompra = new Set();
  for (let i = 0; i < N; i++) {
    if ((i & 0xfff) === 0 && performance.now() - pausa > 50) { _cuStatus(`Calculando ${Math.round(i / N * 70)}%`); await _cuEspera(0); pausa = performance.now(); }
    const r = ents[i];
    const cen = r.centralDestino || r.centralCompra, mat = r.material;
    if (!cen || cen === '—' || !mat) continue;
    const d = _cuDiaC(diaCache, r.dtEmissao) || _cuDiaC(diaCache, r.dtDescarga); if (!d) continue;
    const peso = Math.abs(num(r.peso)); if (!peso) continue;
    const um = r.um;
    let kgUn;
    if (!um || um === 'KG' || um === 'kg') kgUn = 1;
    else {
      const ck = um + '|' + mat + '|' + (r.fornecedor || '');
      kgUn = kgUnCache.get(ck);
      if (kgUn === undefined) { kgUn = num(_convertNfPesoToKg(1, um, mat, r.fornecedor)) || 0; kgUnCache.set(ck, kgUn); }
      if (!kgUn) continue;
    }
    const custo = Math.abs(num(r.custo));
    const val = Math.abs(num(r.valorTotal)) || peso * custo; if (!val) continue;
    const kg = peso * kgUn;
    dRow[i] = d; kgRow[i] = kg; valRow[i] = val; pkgRow[i] = custo ? custo / kgUn : val / kg;
    if (!CU.unMat.has(mat)) CU.unMat.set(mat, _cuUnidade(r.categoria, mat));
    let fk = r.cnpjFornecedor;
    if (!fk || fk.length !== 14) {
      const nome = r.fornecedor || '';
      fk = fkPorNome.get(nome);
      if (!fk) { const nn = _cuNomeNorm(nome); fk = CU.cnpjPorNome.get(nn) || ('n:' + nn); fkPorNome.set(nome, fk); }
    }
    let pm = pares.get(fk); if (!pm) { pm = new Map(); pares.set(fk, pm); CU.nomeForn.set(fk, r.fornecedor || '—'); }
    let pc = pm.get(mat); if (!pc) { pc = new Map(); pm.set(mat, pc); }
    let p = pc.get(cen); if (!p) { p = { forn: fk, mat, cen, rows: [] }; pc.set(cen, p); lista.push(p); }
    p.rows.push(i);
  }
  let minYm = Infinity;
  lista.forEach(p => { const i = p.rows.reduce((a, b) => dRow[b] < dRow[a] ? b : a); const ym = (dRow[i] / 100) | 0; if (ym < minYm) minYm = ym; });
  const meses = new Set(); let total = 0;
  const nfDe = i => { const v = ents[i].nf; return v && v !== '—' ? String(v) : ''; };
  for (let k = 0; k < lista.length; k++) {
    if (performance.now() - pausa > 50) { _cuStatus(`Calculando ${70 + Math.round(k / lista.length * 30)}%`); await _cuEspera(0); pausa = performance.now(); }
    const p = lista[k], rows = p.rows, n = rows.length;
    rows.sort((a, b) => dRow[a] - dRow[b] || (nfDe(a) < nfDe(b) ? -1 : nfDe(a) > nfDe(b) ? 1 : a - b));
    const un = CU.unMat.get(p.mat), f = un === 'kg' ? 1 : 1000, dec = un === 'kg' ? 1e4 : 100;
    const D = new Int32Array(n), Q = new Float64Array(n), T = new Float64Array(n), PR = new Float64Array(n), MN = new Float64Array(n), MX = new Float64Array(n);
    const AL = new Int8Array(n), BS = new Int8Array(n), RI = new Int32Array(n), TR = new Int32Array(n);
    let m = 0;
    for (let j = 0; j < n;) {
      // Itens da mesma NF (mesmo número e data) viram uma NF só.
      const i0 = rows[j], nf = nfDe(i0);
      let kg = 0, val = 0, pk = 0, tr = -1, jj = j;
      do {
        const i = rows[jj], r = ents[i];
        kg += kgRow[i]; val += valRow[i]; pk += pkgRow[i] * kgRow[i];
        if (tr < 0 && r.centralCompra && r.centralDestino && r.centralCompra !== r.centralDestino) tr = i;
        jj++;
      } while (jj < n && nf && dRow[rows[jj]] === dRow[i0] && nfDe(rows[jj]) === nf);
      D[m] = dRow[i0]; Q[m] = kg / f; T[m] = val; PR[m] = Math.round(pk / kg * f * dec) / dec; RI[m] = i0; TR[m] = tr;
      const b = Math.min(m, 5);
      if (!b) AL[m] = ((D[m] / 100) | 0) !== minYm ? 3 : 0;   // 3 = fornecedor novo (nunca no 1º mês da base)
      else {
        let mn = Infinity, mx = -Infinity;
        for (let t = m - b; t < m; t++) { if (PR[t] < mn) mn = PR[t]; if (PR[t] > mx) mx = PR[t]; }
        MN[m] = mn; MX[m] = mx; BS[m] = b; AL[m] = PR[m] > mx ? 1 : PR[m] < mn ? 2 : 0;
      }
      meses.add((D[m] / 100) | 0); m++; j = jj;
    }
    Object.assign(p, { n: m, D, Q, T, PR, MN, MX, AL, BS, RI, TR, rows: null });
    total += m;
    (CU.fornMats.get(p.forn) || CU.fornMats.set(p.forn, new Set()).get(p.forn)).add(p.mat);
    CU.cenComCompra.add(p.cen);
    // Central que aparece nas Entradas mas não no cadastro.
    if (!CU.cen.has(p.cen)) CU.cen.set(p.cen, { alias: p.cen, nome: p.cen, cnpj: '', regional: 'Sem regional', uf: '', _s: -1 });
  }
  CU.ents = ents; CU.pares = lista; CU.meses = meses; CU.nNfs = total; CU.mesCache = new Map();
  CU.minYm = minYm === Infinity ? 0 : minYm;
  if (!CU.mes || !meses.has(CU.mes)) CU.mes = meses.size ? Math.max(...meses) : 0;
  console.info(`[Custos] ${N} linhas → ${total} NFs em ${lista.length} pares, ${Math.round(performance.now() - t0)} ms`);
}
// NFs de um mês como objetos (só o que a tela usa; cache dos últimos 8 meses abertos).
function _cuMes(ym) {
  if (!CU.pares) return [];
  let a = CU.mesCache.get(ym);
  if (a) return a;
  a = [];
  const lo = ym * 100, hi = ym * 100 + 99, ents = CU.ents;
  for (const p of CU.pares) {
    const D = p.D; let l = 0, h = p.n;
    while (l < h) { const mid = (l + h) >> 1; if (D[mid] < lo) l = mid + 1; else h = mid; }
    for (let k = l; k < p.n && D[k] <= hi; k++) {
      const al = p.AL[k], r = ents[p.RI[k]], tr = p.TR[k], qtd = p.Q[k], pr = p.PR[k];
      const o = { forn: p.forn, mat: p.mat, cen: p.cen, nf: r.nf && r.nf !== '—' ? String(r.nf) : 's/ nº', d: D[k], ym, qtd, tot: p.T[k], pr,
        alerta: al === 1 ? 'acima' : al === 2 ? 'abaixo' : al === 3 ? 'novo' : null, isDiv: al > 0, dif: 0, transf: tr >= 0, compra: tr >= 0 ? ents[tr].centralCompra : '' };
      if (p.BS[k]) { o.min = p.MN[k]; o.max = p.MX[k]; o.base = p.BS[k]; if (al === 1) o.dif = (pr - o.max) * qtd; else if (al === 2) o.dif = (pr - o.min) * qtd; }
      a.push(o);
    }
  }
  CU.mesCache.set(ym, a);
  if (CU.mesCache.size > 8) CU.mesCache.delete(CU.mesCache.keys().next().value);
  return a;
}

/* ───────── recortes ───────── */
const _cuUfCen = c => c.uf || CU.geo.get(c.cnpj)?.uf || '';
function _cuNfsF() {
  // Chamado várias vezes por clique (mapa, painel, comparador): guarda o último recorte.
  const F = CU.F, a = _cuMes(CU.mes), chave = [CU.mes, F.uf, F.reg, F.cen, F.mat, F.forn, F.div, CU.geo.size].join('|');
  if (CU._nfsA === a && CU._nfsK === chave) return CU._nfsR;
  CU._nfsA = a; CU._nfsK = chave;
  return CU._nfsR = a.filter(n => {
    if (F.cen && n.cen !== F.cen) return false;
    const c = CU.cen.get(n.cen);
    if (F.reg && c.regional !== F.reg) return false;
    if (F.uf && _cuUfCen(c) !== F.uf) return false;
    return (!F.mat || n.mat === F.mat) && (!F.forn || n.forn === F.forn) && (!F.div || n.isDiv);
  });
}
function _cuAgg(arr) {
  let g = 0, q = 0, d = 0, dr = 0; const mats = new Set();
  arr.forEach(n => { g += n.tot; q += n.qtd; mats.add(n.mat); if (n.isDiv) { d++; if (n.dif > 0) dr += n.dif; } });
  return { g, q, n: arr.length, d, dr, mats, pm: q ? g / q : 0 };
}
function _cuRef(arr) { const m = {}; arr.forEach(n => { (m[n.mat] || (m[n.mat] = { g: 0, q: 0 })).g += n.tot; m[n.mat].q += n.qtd; }); Object.values(m).forEach(o => o.p = o.g / o.q); return m; }
function _cuIdx(arr, ref) { let s = 0, w = 0; arr.forEach(n => { const r = ref[n.mat]; if (!r || !r.p) return; s += (n.pr - r.p) / r.p * n.tot; w += n.tot; }); return w ? s / w : 0; }
function _cuEscopo() {
  const s = CU.sel;
  if (s?.t === 'cen') return s.id; if (s?.t === 'rota') return s.cen;
  if (CU.F.cen) return CU.F.cen;
  if (CU.F.reg) return 'reg:' + CU.F.reg;
  if (CU.F.uf) return 'uf:' + CU.F.uf;
  return 'BR';
}
const _cuEscopoNome = k => k === 'BR' ? 'Brasil' : k.startsWith('reg:') ? k.slice(4) : k.startsWith('uf:') ? k.slice(3) : (CU.cen.get(k)?.nome || k);
function _cuNomeF(fk) { return CU.nomeForn.get(fk) || CU.geo.get(fk)?.nome || (fk.startsWith('n:') ? fk.slice(2) : fk); }
function _cuRegsDaUf(uf) { return [...new Set([...CU.cen.values()].filter(c => _cuUfCen(c) === uf && CU.cenComCompra?.has(c.alias)).map(c => c.regional))].sort(); }
function _cuCorReg(reg) { const regs = _cuRegsDaUf(CU.F.uf); const i = regs.indexOf(reg); return `var(${CU_SER[(i < 0 ? 0 : i) % CU_SER.length]})`; }

/* ───────── posições ───────── */
function _cuLL(cnpj) { const g = cnpj && CU.geo.get(cnpj); return g && g.lat != null && g.lng != null ? [g.lng, g.lat] : null; }
function _cuXY(cnpj) { const ll = _cuLL(cnpj); return ll ? CU.proj(ll) : null; }
function _cuKm(a, b) { const r = Math.PI / 180, dl = (b[1] - a[1]) * r, dn = (b[0] - a[0]) * r, h = Math.sin(dl / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dn / 2) ** 2; return 6371 * 2 * Math.asin(Math.sqrt(h)) * 1.3; }
function _cuKmPar(cen, fk) { const a = _cuLL(CU.cen.get(cen)?.cnpj), b = _cuLL(fk); return a && b ? _cuKm(a, b) : null; }

/* ───────── mapa ───────── */
let _cuSvg, _cuG, _cuZoom, _cuGr = {};
function _cuMapaInit() {
  CU.proj = d3.geoMercator().fitSize([1000, 1000], CU.br);
  CU.path = d3.geoPath(CU.proj);
  _cuSvg = d3.select('#cu-map'); _cuG = _cuSvg.append('g');
  ['st', 'mun', 'stl', 'rt', 'hit', 'f', 'c', 'b', 'l'].forEach(k => _cuGr[k] = _cuG.append('g'));
  _cuZoom = d3.zoom().scaleExtent([.6, 800]).on('zoom', e => { _cuG.attr('transform', e.transform); if (Math.abs(e.transform.k - CU.K) > 1e-6) { CU.K = e.transform.k; _cuRescale(); } });
  _cuSvg.call(_cuZoom).on('dblclick.zoom', null);
  _cuGr.st.selectAll('path').data(CU.br.features).join('path').attr('class', 'st').attr('d', CU.path)
    .on('click', (e, f) => _cuClicaUf(CU_UFS[f.properties.codarea], e))
    .on('mousemove', (e, f) => {
      const uf = CU_UFS[f.properties.codarea], a = _cuAgg(_cuMes(CU.mes).filter(n => _cuUfCen(CU.cen.get(n.cen)) === uf));
      _cuTip(e, `<b>${uf}</b><br><span class="mono">${a.n ? _cuBrlc(a.g) + ' · ' + a.d + ' alertas' : 'sem compras no mês'}</span>`);
    })
    .on('mouseleave', _cuTipOff);
  _cuGr.stl.selectAll('text').data(CU.br.features).join('text').attr('class', 'stlbl').text(f => CU_UFS[f.properties.codarea])
    .attr('x', f => CU.path.centroid(f)[0]).attr('y', f => CU.path.centroid(f)[1]);
  new ResizeObserver(() => { _cuMedir(); if (document.getElementById('page-custos')?.classList.contains('active')) _cuFit(_cuBounds(), 0); }).observe(document.getElementById('cu-mapwrap'));
}
function _cuClicaUf(uf, e) {
  const regs = _cuRegsDaUf(uf);
  if (!regs.length) { _cuTip(e, `<b>${uf}</b><br><span class="mono">sem centrais com compra</span>`); return; }
  Object.assign(CU.F, { uf, cen: '', reg: regs.length === 1 ? regs[0] : '' });
  CU.sel = regs.length === 1 ? { t: 'reg', reg: regs[0] } : { t: 'uf', uf };
  _cuUpdate(true);
}
function _cuCarregarMun(uf) {
  if (CU.mun[uf] || CU.munCarregando[uf]) return;
  const cod = Object.keys(CU_UFS).find(k => CU_UFS[k] === uf); if (!cod) return;
  CU.munCarregando[uf] = true;
  // ponytail: malha municipal só em memória (cache HTTP do navegador cobre o resto); persistir no IndexedDB se a API do IBGE ficar lenta.
  fetch(CU_IBGE + 'estados/' + cod + '?' + CU_GEOJSON + '&intrarregiao=municipio').then(r => r.ok ? r.json() : null).then(g => {
    if (!g) return;
    CU.mun[uf] = { fc: _cuRewind(g), sel: _cuGr.mun.append('g').selectAll('path').data(g.features).join('path').attr('class', 'mn').attr('d', CU.path) };
    _cuDesenhar(); if (CU.F.cen) _cuFit(_cuBounds());
  }).catch(() => {}).finally(() => { CU.munCarregando[uf] = false; });
}
function _cuMunDoPonto(uf, ll) { return ll && CU.mun[uf]?.fc.features.find(f => d3.geoContains(f, ll)); }
function _cuBounds() {
  const F = CU.F;
  if (F.cen) {
    const c = CU.cen.get(F.cen), ll = _cuLL(c?.cnpj);
    const m = _cuMunDoPonto(_cuUfCen(c), ll);
    if (m) return CU.path.bounds(m);
    if (ll) { const p = CU.proj(ll), r = 1.2; return [[p[0] - r, p[1] - r], [p[0] + r, p[1] + r]]; }
  }
  if (F.reg) {
    const regs = F.uf ? _cuRegsDaUf(F.uf) : [];
    if (!(F.uf && regs.length === 1)) {
      const pts = [...CU.cen.values()].filter(c => c.regional === F.reg).map(c => _cuXY(c.cnpj)).filter(Boolean);
      if (pts.length) { const pad = 6; return [[d3.min(pts, p => p[0]) - pad, d3.min(pts, p => p[1]) - pad], [d3.max(pts, p => p[0]) + pad, d3.max(pts, p => p[1]) + pad]]; }
    }
  }
  const uf = F.uf || (F.reg && _cuUfCen([...CU.cen.values()].find(c => c.regional === F.reg) || {}));
  const st = uf && CU.br.features.find(f => CU_UFS[f.properties.codarea] === uf);
  return CU.path.bounds(st || CU.br);
}
function _cuMedir() { const r = document.getElementById('cu-mapwrap').getBoundingClientRect(); CU.W = r.width; CU.H = r.height; }
function _cuFit(b, dur = 750) {
  if (!_cuSvg || !CU.W) return;
  const aberto = document.getElementById('cu-panel').classList.contains('open');
  const pw = aberto && innerWidth > 820 ? document.getElementById('cu-panel').offsetWidth + 20 : 0;
  const ph = aberto && innerWidth <= 820 ? CU.H * .62 : 0;
  const w = CU.W - pw, h = CU.H - ph, dx = b[1][0] - b[0][0] || 1, dy = b[1][1] - b[0][1] || 1;
  const k = Math.min(w / dx, h / dy) * .86;
  const t = d3.zoomIdentity.translate(w / 2 - k * (b[0][0] + b[1][0]) / 2, h / 2 - k * (b[0][1] + b[1][1]) / 2).scale(k);
  (dur ? _cuSvg.transition().duration(dur) : _cuSvg).call(_cuZoom.transform, t);
}
function _cuFitFornecedores() {
  const c = CU.cen.get(CU.F.cen), pts = [_cuXY(c?.cnpj), ...[...new Set(_cuNfsF().map(n => n.forn))].map(_cuXY)].filter(Boolean);
  if (pts.length) _cuFit([[d3.min(pts, p => p[0]) - 4, d3.min(pts, p => p[1]) - 4], [d3.max(pts, p => p[0]) + 4, d3.max(pts, p => p[1]) + 4]]);
}
function _cuHeat(ix) { const c = d3.color(_cuCss(ix >= 0 ? '--red' : '--green')) || d3.color('#888'); c.opacity = Math.min(.85, .12 + Math.abs(ix) / .12 * .73); return c + ''; }
function _cuRtCor(ix) { return _cuCss(ix > .06 ? '--red' : ix > .02 ? '--amber' : ix < -.03 ? '--green' : '--text2'); }

function _cuDesenhar() {
  if (!_cuSvg) return;
  const F = CU.F, L = CU.L, sel = CU.sel, arr = _cuNfsF(), ref = _cuRef(arr);
  const cenPos = new Map();
  CU.cen.forEach(c => { const xy = _cuXY(c.cnpj); if (xy) cenPos.set(c.alias, xy); });
  const links = Object.entries(_cuGroup(arr, n => n.cen + '\u0001' + n.forn)).map(([k, a]) => { const [c, f] = k.split('\u0001'); const s = _cuAgg(a); return { c, f, a, s, ix: _cuIdx(a, ref), mats: [...s.mats] }; })
    .filter(l => cenPos.has(l.c) && _cuXY(l.f));
  const foco = l => sel && ((sel.t === 'forn' && l.f === sel.id) || (sel.t === 'rota' && l.c === sel.cen && l.f === sel.forn) || (sel.t === 'cen' && l.c === sel.id));
  const fornAtivos = new Set(links.map(l => l.f));
  const cenUfs = new Set([...CU.cen.values()].filter(c => cenPos.has(c.alias)).map(_cuUfCen));
  const ufFoco = F.uf || (F.reg && _cuUfCen([...CU.cen.values()].find(c => c.regional === F.reg) || {}));
  const porUf = L.calor && !ufFoco ? _cuGroup(arr, n => _cuUfCen(CU.cen.get(n.cen))) : {};
  // estados (+ calor no nível Brasil)
  _cuGr.st.selectAll('path').attr('class', f => { const uf = CU_UFS[f.properties.codarea]; return 'st' + (cenUfs.has(uf) ? ' has' : '') + (ufFoco && uf !== ufFoco ? ' dim' : ''); })
    .style('fill', f => { if (!L.calor || ufFoco) return null; const a = porUf[CU_UFS[f.properties.codarea]]; return a ? _cuHeat(_cuIdx(a, ref)) : null; });
  _cuGr.stl.style('display', ufFoco ? 'none' : null);
  // municípios do estado em foco
  Object.entries(CU.mun).forEach(([uf, m]) => m.sel.style('display', uf === ufFoco ? null : 'none'));
  if (ufFoco) {
    _cuCarregarMun(ufFoco);
    const m = CU.mun[ufFoco];
    if (m) {
      const cs = [...CU.cen.values()].filter(c => _cuUfCen(c) === ufFoco && _cuLL(c.cnpj));
      const munSel = F.cen ? _cuMunDoPonto(ufFoco, _cuLL(CU.cen.get(F.cen)?.cnpj)) : null;
      const comCentral = L.calor ? new Map() : null;
      if (comCentral) cs.forEach(c => { const mm = _cuMunDoPonto(ufFoco, _cuLL(c.cnpj)); if (mm) (comCentral.get(mm) || comCentral.set(mm, []).get(mm)).push(c.alias); });
      m.sel.attr('class', f => 'mn' + (f === munSel ? ' sel' : ''))
        .style('fill', f => { if (!comCentral || f === munSel) return null; const al = comCentral.get(f); if (!al) return null; const a = arr.filter(n => al.includes(n.cen)); return a.length ? _cuHeat(_cuIdx(a, ref)) : null; });
    }
  }
  // rotas
  const curva = l => { const a = cenPos.get(l.c), b = _cuXY(l.f), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1]; return `M${b[0]},${b[1]}Q${mx - dy * .18},${my + dx * .18} ${a[0]},${a[1]}`; };
  const vis = links.filter(l => !F.cen || l.c === F.cen);
  const vmax = d3.max(vis, l => l.s.g) || 1;
  _cuGr.rt.selectAll('path').data(vis, l => l.c + '|' + l.f).join('path').attr('d', curva)
    .attr('class', L.cor ? 'rt flow' : 'rt')
    .style('stroke', l => L.cor ? _cuRtCor(l.ix) : foco(l) ? _cuCss('--text') : _cuCss('--amber'))
    .style('opacity', l => sel && (sel.t === 'forn' || sel.t === 'rota') ? (foco(l) ? 1 : .12) : (ufFoco ? .85 : L.cor ? .7 : .38))
    .each(l => { l.w = L.cor ? .8 + 3.2 * Math.sqrt(l.s.g / vmax) : foco(l) ? 2 : 1.2; });
  _cuGr.hit.selectAll('path').data(vis, l => l.c + '|' + l.f).join('path').attr('class', 'rthit').attr('d', curva)
    .on('mousemove', (e, l) => { const km = _cuKmPar(l.c, l.f); _cuTip(e, `<b>${_cuE(_cuNomeF(l.f))}</b> → <b>${_cuE(CU.cen.get(l.c).nome)}</b><br><span class="mono">${l.mats.map(_cuE).join(', ')}<br>${km ? _cuNf0.format(km) + ' km · ' : ''}${_cuBrlc(l.s.g)}${l.mats.length === 1 ? ' · ' + _cuP(l.mats[0], l.s.pm) : ''}<br>preço vs média: ${_cuPct(l.ix)}${l.s.d ? ` · ${l.s.d} alerta${l.s.d > 1 ? 's' : ''}` : ''}</span>`); })
    .on('mouseleave', _cuTipOff).on('click', (e, l) => { CU.sel = { t: 'rota', cen: l.c, forn: l.f }; CU.tab = 'nfs'; _cuUpdate(false); });
  // fornecedores: com compra no recorte em destaque; os demais em cinza
  // Inclui fornecedor só localizado (custos_geo), sem nenhuma compra na base: aparece em cinza.
  const candidatos = new Set([...CU.fornMats.keys(), ...[...CU.geo.values()].filter(g => g.tipo === 'fornecedor').map(g => g.cnpj)]);
  const fl = [...candidatos].filter(fk => _cuXY(fk) && (!F.mat || CU.fornMats.get(fk)?.has(F.mat)));
  const selF = fk => (sel?.t === 'forn' && sel.id === fk) || (sel?.t === 'rota' && sel.forn === fk);
  _cuGr.f.selectAll('rect').data(fl, fk => fk).join('rect').attr('class', fk => 'forn' + (fornAtivos.has(fk) ? '' : ' off') + (selF(fk) ? ' sel' : ''))
    .on('mousemove', (e, fk) => { const a = _cuAgg(arr.filter(n => n.forn === fk)), g = CU.geo.get(fk); _cuTip(e, `<b>${_cuE(_cuNomeF(fk))}</b><br><span class="mono">${_cuE((g?.municipio || '') + (g?.uf ? '/' + g.uf : ''))}<br>${a.n ? _cuBrlc(a.g) + ' no recorte' : 'sem compra no recorte'}</span>`); })
    .on('mouseleave', _cuTipOff).on('click', (e, fk) => { CU.sel = { t: 'forn', id: fk }; CU.tab = 'nfs'; _cuUpdate(false); });
  _cuGr.f.selectAll('rect.off').lower();
  // centrais
  const porCen = _cuGroup(arr, 'cen');
  const cs = [...CU.cen.values()].filter(c => cenPos.has(c.alias) && porCen[c.alias]);
  cs.forEach(c => { const a = _cuAgg(porCen[c.alias]); c._g = a.g; c._nd = a.d; c._xy = cenPos.get(c.alias); });
  const gmax = d3.max(cs, c => c._g) || 1;
  const porRegional = F.uf && !F.reg && _cuRegsDaUf(F.uf).length > 1;
  cs.forEach(c => { c._rr = L.calor ? 4 + 9 * Math.sqrt(c._g / gmax) : 5.5; });
  _cuGr.c.selectAll('circle').data(cs, c => c.alias).join('circle')
    .attr('class', c => 'cen' + (F.cen === c.alias || (sel?.t === 'cen' && sel.id === c.alias) || (sel?.t === 'rota' && sel.cen === c.alias) ? ' sel' : ''))
    .attr('cx', c => c._xy[0]).attr('cy', c => c._xy[1])
    .style('fill', c => porRegional ? _cuCorReg(c.regional) : null).style('fill-opacity', L.calor ? .75 : 1)
    .on('mousemove', (e, c) => _cuTip(e, `<b>${_cuE(c.nome)}</b><br><span class="mono">${_cuE(c.regional)}<br>${_cuBrlc(c._g)}${c._nd ? ` · ${c._nd} alerta${c._nd > 1 ? 's' : ''} de preço` : ''}</span>`))
    .on('mouseleave', _cuTipOff)
    .on('click', (e, c) => { Object.assign(CU.F, { uf: _cuUfCen(c), reg: c.regional, cen: c.alias }); CU.sel = { t: 'cen', id: c.alias }; CU.tab = 'nfs'; _cuUpdate(true); });
  _cuGr.b.selectAll('g').data(L.selos ? cs.filter(c => c._nd > 0) : [], c => c.alias)
    .join(en => { const g = en.append('g').attr('class', 'bdg'); g.append('circle'); g.append('text'); return g; })
    .each(function (c) { d3.select(this).select('text').text(c._nd); });
  const lb = [...cs.map(c => ({ x: c._xy[0], y: c._xy[1], t: c.nome, f: false, id: 'c' + c.alias })), ...fl.map(fk => { const p = _cuXY(fk); return { x: p[0], y: p[1], t: _cuNomeF(fk), f: true, off: !fornAtivos.has(fk), id: 'f' + fk }; })];
  _cuGr.l.selectAll('text').data(lb, d => d.id).join('text').attr('class', d => 'lbl' + (d.f ? ' f' : '') + (d.off ? ' off' : '')).text(d => d.t).attr('x', d => d.x);
  _cuRescale();
}
function _cuRescale() {
  if (!_cuG) return;
  const k = CU.K;
  _cuGr.rt.selectAll('path').style('stroke-width', l => l.w / k).style('stroke-dasharray', CU.L.cor ? `${6 / k} ${5 / k}` : `${3 / k} ${3 / k}`);
  _cuGr.hit.selectAll('path').style('stroke-width', 10 / k);
  _cuGr.c.selectAll('circle').attr('r', c => c._rr / k).style('stroke-width', 1.5 / k);
  _cuGr.f.selectAll('rect').each(function (fk) { const p = _cuXY(fk), s = (this.classList.contains('off') ? 6 : 8) / k; d3.select(this).attr('x', p[0] - s / 2).attr('y', p[1] - s / 2).attr('width', s).attr('height', s).attr('transform', `rotate(45 ${p[0]} ${p[1]})`).style('stroke-width', 1.3 / k); });
  _cuGr.b.selectAll('g').each(function (c) { const x = c._xy[0] + 7 / k, y = c._xy[1] - 7 / k; d3.select(this).select('circle').attr('cx', x).attr('cy', y).attr('r', 6.5 / k).style('stroke-width', 1.2 / k); d3.select(this).select('text').attr('x', x).attr('y', y).style('font-size', (8.5 / k) + 'px'); });
  _cuGr.stl.selectAll('text').style('font-size', (11 / k) + 'px').style('display', k > 2.6 ? 'none' : null);
  _cuGr.l.selectAll('text').style('font-size', (11 / k) + 'px').attr('y', d => d.y - 9 / k).style('stroke-width', 3 / k).style('display', d => (d.f ? k >= 7 : k >= 2.5) ? null : 'none');
}

/* ───────── migalhas, legenda, filtros ───────── */
function _cuCrumbs() {
  const F = CU.F, el = document.getElementById('cu-crumbs'); el.innerHTML = '';
  const it = [['Brasil', () => { Object.assign(F, { uf: '', reg: '', cen: '' }); CU.sel = null; _cuUpdate(true); }, !F.uf && !F.reg && !F.cen]];
  const regsUf = F.uf ? _cuRegsDaUf(F.uf) : [];
  if (F.uf && regsUf.length > 1) it.push([F.uf, () => { Object.assign(F, { reg: '', cen: '' }); CU.sel = { t: 'uf', uf: F.uf }; _cuUpdate(true); }, !F.reg]);
  if (F.reg) it.push([F.reg, () => { F.cen = ''; CU.sel = { t: 'reg', reg: F.reg }; _cuUpdate(true); }, !F.cen]);
  if (F.cen) it.push([CU.cen.get(F.cen)?.nome || F.cen, null, true]);
  it.forEach(([t, fn, cur], i) => {
    if (i) { const s = document.createElement('span'); s.className = 'sep'; s.textContent = '›'; el.append(s); }
    const b = document.createElement('button'); b.type = 'button'; b.className = 'c' + (cur ? ' cur' : ''); b.textContent = t; if (fn && !cur) b.onclick = fn; el.append(b);
  });
  // Estado com várias regionais: cada regional vira um botão, na cor dos pontos.
  if (F.uf && !F.reg && regsUf.length > 1) regsUf.forEach(r => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'c reg'; b.style.setProperty('--rc', _cuCorReg(r)); b.textContent = r;
    b.onclick = () => { F.reg = r; CU.sel = { t: 'reg', reg: r }; _cuUpdate(true); }; el.append(b);
  });
  if (F.cen) { const b = document.createElement('button'); b.type = 'button'; b.className = 'c'; b.textContent = 'Enquadrar fornecedores'; b.onclick = _cuFitFornecedores; el.append(b); }
}
function _cuLegenda() {
  const L = CU.L; let h = `<div class="lyr"><b>Camadas</b>
    <label><input type="checkbox" data-l="selos"${L.selos ? ' checked' : ''}> Selos de alerta</label>
    <label><input type="checkbox" data-l="cor"${L.cor ? ' checked' : ''}> Rotas coloridas por preço</label>
    <label><input type="checkbox" data-l="calor"${L.calor ? ' checked' : ''}> Mapa de calor</label></div>
    <div class="r"><i style="width:10px;height:10px;border-radius:50%;background:var(--accent)"></i>Central</div>
    <div class="r"><i style="width:8px;height:8px;background:var(--amber);transform:rotate(45deg);margin:0 1px"></i>Fornecedor com compra</div>
    <div class="r"><i style="width:7px;height:7px;background:var(--text3);transform:rotate(45deg);margin:0 2px"></i>Fornecedor sem compra</div>`;
  h += L.cor ? `<div class="r"><i style="width:18px;height:3px;background:var(--red)"></i>rota &gt; 6% acima da média</div><div class="r"><i style="width:18px;height:3px;background:var(--amber)"></i>2 a 6% acima</div><div class="r"><i style="width:18px;height:3px;background:var(--green)"></i>abaixo da média</div><div class="r" style="color:var(--text3)">espessura = gasto</div>`
    : `<div class="r"><i style="width:18px;border-top:2px dashed var(--amber)"></i>Fornecimento no mês</div>`;
  if (L.calor) h += `<div class="r"><i class="grad" style="background:linear-gradient(90deg,var(--green),var(--bg3) 50%,var(--red))"></i></div><div class="r" style="justify-content:space-between;width:120px;color:var(--text3)"><span>−12%</span><span>média</span><span>+12%</span></div>`;
  if (L.selos) h += `<div class="r"><i style="width:12px;height:12px;border-radius:50%;background:var(--red)"></i>NFs em alerta de preço</div>`;
  const el = document.getElementById('cu-legend'); el.innerHTML = h;
  el.querySelectorAll('[data-l]').forEach(i => i.onchange = () => { CU.L[i.dataset.l] = i.checked; _cuUpdate(false); });
}
function _cuSelect(id, opts, val, todos) { document.getElementById(id).innerHTML = `<option value="">${todos}</option>` + opts.map(([v, t]) => `<option value="${_cuE(v)}"${v === val ? ' selected' : ''}>${_cuE(t)}</option>`).join(''); }
function _cuFiltros() {
  const F = CU.F, mes = _cuMes(CU.mes);
  const cens = [...new Set(mes.map(n => n.cen))].map(a => CU.cen.get(a));
  _cuSelect('cu-f-reg', [...new Set(cens.map(c => c.regional))].sort().map(r => [r, r]), F.reg, 'Todas');
  _cuSelect('cu-f-cen', cens.filter(c => !F.reg || c.regional === F.reg).sort((a, b) => a.nome.localeCompare(b.nome)).map(c => [c.alias, c.nome]), F.cen, 'Todas');
  _cuSelect('cu-f-mat', [...new Set(mes.map(n => n.mat))].sort().map(m => [m, m]), F.mat, 'Todos');
  _cuSelect('cu-f-forn', [...new Set(mes.filter(n => !F.mat || n.mat === F.mat).map(n => n.forn))].map(fk => [fk, _cuNomeF(fk)]).sort((a, b) => a[1].localeCompare(b[1])), F.forn, 'Todos');
  document.getElementById('cu-f-div').checked = F.div;
  const lbl = document.getElementById('cu-month-label'); if (lbl && CU.mes) lbl.textContent = _cuYmTxt(CU.mes);
}

/* ───────── comentários ───────── */
const _cuComKey = (f, m, c, nf) => [f, m, c, nf || ''].join('\u0001');
function _cuSetComs(rows) { CU.coms = rows; CU.comPorChave = new Map(); rows.forEach(r => { const k = _cuComKey(r.fornecedor, r.material, r.central, r.nf); (CU.comPorChave.get(k) || CU.comPorChave.set(k, []).get(k)).push(r); }); }
async function _cuRecarregarComs() {
  try { _cuSetComs(await _cuFetchAll('custos_comentarios', '*', 'created_at')); } catch (e) { console.warn('[Custos] comentários:', e); return; }
  if (CU.comAtual) _cuComLista();
  if (document.getElementById('page-custos')?.classList.contains('active')) { _cuStrip(); _cuPainel(); }
}
const _CU_ICO = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M2.5 3h11v7.5h-6L4.5 13v-2.5h-2z" style="fill:none;stroke:currentColor;stroke-width:1.4;stroke-linejoin:round"/></svg>';
function _cuComBtn(f, m, c, nf, rotulo, compacto) {
  const n = (CU.comPorChave.get(_cuComKey(f, m, c, nf)) || []).length;
  return `<button type="button" class="cu-cbtn${n ? ' has' : ''}" data-cuc-f="${_cuE(f)}" data-cuc-m="${_cuE(m)}" data-cuc-c="${_cuE(c)}" data-cuc-n="${_cuE(nf || '')}" data-cuc-l="${_cuE(rotulo)}" title="Comentários do analista">${_CU_ICO}${n ? '<span>' + n + '</span>' : compacto ? '' : '<span>Comentar</span>'}</button>`;
}
function _cuComAbrir(ctx) { CU.comAtual = ctx; CU.comEditId = null; document.getElementById('cu-com-lbl').textContent = ctx.l; document.getElementById('cu-com-txt').value = ''; document.getElementById('cu-com-salvar').textContent = 'Salvar comentário'; _cuComLista(); document.getElementById('cu-com').hidden = false; document.getElementById('cu-com-txt').focus(); }
function _cuComLista() {
  const c = CU.comAtual, l = CU.comPorChave.get(_cuComKey(c.f, c.m, c.c, c.n)) || [], meu = window.currentUser?.id;
  document.getElementById('cu-com-list').innerHTML = l.length ? l.map(r => `<div class="cu-ci"><div class="cm"><span><b>${_cuE(r.autor_nome || '—')}</b> · ${_cuE(new Date(r.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }))}${r.updated_at && r.updated_at !== r.created_at ? ' · editado' : ''}</span>${r.user_id === meu ? `<button type="button" data-ed="${r.id}">Editar</button><button type="button" class="del" data-del="${r.id}">Apagar</button>` : ''}</div>${_cuE(r.texto)}</div>`).join('') : '<div class="cu-note">Nenhum comentário ainda.</div>';
  document.querySelectorAll('#cu-com-list [data-ed]').forEach(b => b.onclick = () => { const r = CU.coms.find(x => x.id === b.dataset.ed); CU.comEditId = r.id; const t = document.getElementById('cu-com-txt'); t.value = r.texto; t.focus(); document.getElementById('cu-com-salvar').textContent = 'Salvar edição'; });
  document.querySelectorAll('#cu-com-list [data-del]').forEach(b => b.onclick = async () => {
    if (b.dataset.conf !== '1') { b.dataset.conf = '1'; b.textContent = 'Confirmar exclusão'; return; }
    const { error } = await window.supabaseClient.from('custos_comentarios').delete().eq('id', b.dataset.del);
    if (error) { toast('Não foi possível apagar o comentário: ' + error.message, 'error'); return; }
    await _cuRecarregarComs();
  });
}
async function _cuComSalvar(e) {
  e.preventDefault();
  const t = document.getElementById('cu-com-txt'), texto = t.value.trim(), c = CU.comAtual;
  if (!texto) { t.focus(); return; }
  const q = window.supabaseClient.from('custos_comentarios');
  const autor = typeof _ocNomeAtor === 'function' ? _ocNomeAtor() : (window.currentUser?.name || window.currentUser?.email || '—');
  const { error } = CU.comEditId
    ? await q.update({ texto, updated_at: new Date().toISOString() }).eq('id', CU.comEditId)
    : await q.insert({ fornecedor: c.f, material: c.m, central: c.c, nf: c.n || null, texto, autor_nome: autor });
  if (error) { toast('Não foi possível salvar o comentário: ' + error.message, 'error'); return; }
  t.value = ''; CU.comEditId = null; document.getElementById('cu-com-salvar').textContent = 'Salvar comentário';
  await _cuRecarregarComs();
}

/* ───────── painel ───────── */
function _cuEscopoNfs() {
  let a = _cuNfsF(); const s = CU.sel; if (!s) return a;
  if (s.t === 'forn') a = a.filter(n => n.forn === s.id);
  if (s.t === 'rota') a = a.filter(n => n.cen === s.cen && n.forn === s.forn);
  if (s.t === 'reg') a = a.filter(n => CU.cen.get(n.cen).regional === s.reg);
  if (s.t === 'uf') a = a.filter(n => _cuUfCen(CU.cen.get(n.cen)) === s.uf);
  if (s.t === 'cen') a = a.filter(n => n.cen === s.id);
  return a;
}
function _cuBarras(items, fmt, act) { const mx = d3.max(items, i => i.v) || 1; return `<div class="cu-bars">${items.map(it => `<div class="cu-bar" data-k="${_cuE(it.k)}" data-act="${act}"><span class="t">${_cuE(it.t)}</span><span class="v">${fmt(it)}</span><span class="tr"><i style="width:${it.v / mx * 100}%"></i></span></div>`).join('')}</div>`; }
function _cuMesesSerie() { const out = []; let y = Math.floor(CU.mes / 100), m = CU.mes % 100; for (let i = 0; i < 6; i++) { out.unshift(y * 100 + m); if (--m === 0) { m = 12; y--; } } return out; }
function _cuSerie(filtro) {
  // Últimos 6 meses até o mês escolhido, no mesmo recorte de fornecedor/material/central.
  return _cuMesesSerie().map((ym, i) => { const a = _cuMes(ym).filter(filtro); const g = _cuAgg(a); return { x: i, ym, y: g.q ? g.pm : null }; });
}
function _cuGrafico(series, mat, h = 150) {
  const w = 380, m = { l: 52, r: 8, t: 8, b: 20 }, all = series.flatMap(s => s.pts.filter(p => p.y != null).map(p => p.y));
  if (!all.length) return '<div class="cu-note">Sem NFs nos últimos 6 meses.</div>';
  let lo = d3.min(all), hi = d3.max(all); const pad = (hi - lo) * .15 || hi * .03; lo -= pad; hi += pad;
  const meses = _cuMesesSerie(), x = d3.scalePoint().domain(meses.map((_, i) => i)).range([m.l, w - m.r]), y = d3.scaleLinear().domain([lo, hi]).range([h - m.b, m.t]).nice(4);
  const fmt = _cuU(mat) === 'kg' ? _cuNf2 : _cuNf0;
  let s = `<svg class="cu-chart" viewBox="0 0 ${w} ${h}" width="100%">`;
  y.ticks(4).forEach(t => s += `<line class="gl" x1="${m.l}" x2="${w - m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${m.l - 6}" y="${y(t) + 3}" text-anchor="end">${fmt.format(t)}</text>`);
  meses.forEach((ym, i) => s += `<text x="${x(i)}" y="${h - 5}" text-anchor="middle">${CU_MESES[(ym % 100) - 1]}</text>`);
  series.forEach((se, i) => {
    const pts = se.pts.filter(p => p.y != null), col = `var(${CU_SER[i % CU_SER.length]})`;
    s += `<path d="${d3.line().x(p => x(p.x)).y(p => y(p.y))(pts)}" style="fill:none;stroke:${col};stroke-width:2"/>`;
    pts.forEach((p, j) => s += `<circle cx="${x(p.x)}" cy="${y(p.y)}" r="${j === pts.length - 1 ? 3.5 : 2.2}" style="fill:${col}"/>`);
  });
  return s + `</svg><div class="cu-lgd">${series.map((se, i) => `<span><i style="background:var(${CU_SER[i % CU_SER.length]})"></i>${_cuE(se.n)}</span>`).join('')}</div>`;
}
function _cuTabelaForn(arr, mats) {
  const esc = _cuEscopo();
  return mats.map(m => {
    const am = arr.filter(n => n.mat === m), tq = _cuAgg(am).q;
    const rows = Object.entries(_cuGroup(am, 'forn')).map(([f, a]) => ({ f, s: _cuAgg(a), km: CU.F.cen ? _cuKmPar(CU.F.cen, f) : null })).sort((a, b) => a.s.pm - b.s.pm);
    const best = rows[0]?.s.pm;
    // km e alertas numa 2ª linha sob o nome: a gaveta tem 420 px.
    const det = r => [r.km ? _cuNf0.format(r.km) + ' km' : '', r.s.d ? `<span class="cu-worse">${r.s.d} alerta${r.s.d > 1 ? 's' : ''}</span>` : ''].filter(Boolean).join(' · ');
    return `<div class="cu-sec"><h3>${_cuE(m)}</h3><div style="overflow-x:auto"><table><thead><tr><th>Fornecedor</th><th class="n">R$/${_cuU(m)}</th><th class="n" title="Diferença para o melhor preço">Dif.</th><th class="n">Vol.</th><th></th></tr></thead><tbody>${
      rows.map((r, i) => `<tr class="cl" data-forn="${_cuE(r.f)}"><td>${_cuE(_cuNomeF(r.f))}${det(r) ? `<br><span style="font-size:11px;color:var(--text3)">${det(r)}</span>` : ''}</td><td class="n">${_cuPn(m, r.s.pm)}</td><td class="n ${i ? 'cu-worse' : 'cu-best'}">${i ? _cuPct(r.s.pm / best - 1) : 'melhor'}</td><td class="n">${_cuNf0.format(r.s.q / tq * 100)}%</td><td>${_cuComBtn(r.f, m, esc, '', `${_cuNomeF(r.f)} · ${m} · ${_cuEscopoNome(esc)}`, true)}</td></tr>`).join('')}</tbody></table></div></div>`;
  }).join('');
}
function _cuListaNfs(arr) {
  const d = arr.filter(n => n.isDiv).sort((a, b) => b.d - a.d);
  const tr = arr.filter(n => n.transf).length;
  if (!d.length) return `<div class="cu-note">Nenhuma NF em alerta neste recorte.${tr ? ` ${tr} NF${tr > 1 ? 's' : ''} de transferência.` : ''}</div>`;
  const c = d3.rollup(d, v => v.length, n => n.alerta), tot = d3.sum(d.filter(n => n.dif > 0), n => n.dif);
  const ini = CU.minYm ? `Base começa em ${_cuYmTxt(CU.minYm)}: nesse mês não há "fornecedor novo".` : '';
  return `<div class="cu-note">Alerta quando o preço da NF fica acima ou abaixo de todas as últimas 5 NFs do mesmo fornecedor, material e central, ou quando é a primeira NF do fornecedor naquela central. ${ini}<br><b>${c.get('acima') || 0}</b> acima · <b>${c.get('abaixo') || 0}</b> abaixo · <b>${c.get('novo') || 0}</b> fornecedor novo · pago acima da faixa: <b>${_cuBrl(tot)}</b>${tr ? ` · ${tr} NF${tr > 1 ? 's' : ''} de transferência no recorte` : ''}</div>` +
    d.slice(0, 80).map(n => `<div class="cu-nf ${n.alerta}"><span><b>NF ${_cuE(n.nf)}</b> · ${_cuDataNf(n.d)} <span class="cu-pill ${n.alerta === 'acima' ? 'up' : n.alerta === 'abaixo' ? 'dn' : 'nv'}">${CU_ALERTA[n.alerta]}</span>${n.transf ? ` <span class="cu-pill tr" title="Comprada por ${_cuE(CU.cen.get(n.compra)?.nome || n.compra)}">Transferência</span>` : ''}<br><span class="m">${_cuE(_cuNomeF(n.forn))} → ${_cuE(CU.cen.get(n.cen).nome)}${n.transf ? ` (comprada por ${_cuE(CU.cen.get(n.compra)?.nome || n.compra)})` : ''}<br>${_cuE(n.mat)} · ${_cuQ(n.mat, n.qtd)} · NF ${_cuP(n.mat, n.pr)}${n.alerta === 'novo' ? ' · primeira NF nesta central' : ` · últimas ${n.base}: ${n.min === n.max ? _cuP(n.mat, n.min) : _cuPn(n.mat, n.min) + ' a ' + _cuP(n.mat, n.max)}`}</span></span><span class="d">${n.alerta !== 'novo' ? `<span class="cu-pill ${n.dif > 0 ? 'up' : 'dn'}">${_cuPct(n.pr / (n.dif > 0 ? n.max : n.min) - 1)}</span><br>${n.dif > 0 ? '+' : ''}${_cuBrl(n.dif)}` : ''}<br>${_cuComBtn(n.forn, n.mat, n.cen, n.nf, `NF ${n.nf} · ${_cuNomeF(n.forn)} → ${CU.cen.get(n.cen).nome}`)}</span></div>`).join('') +
    (d.length > 80 ? `<div class="cu-note">+ ${d.length - 80} NFs — filtre por central ou fornecedor para ver todas.</div>` : '');
}
function _cuSemLocal() {
  const cens = [...new Set(_cuMes(CU.mes).map(n => n.cen))].map(a => CU.cen.get(a)).filter(c => !_cuLL(c.cnpj));
  const forns = [...new Set(_cuMes(CU.mes).map(n => n.forn))].filter(fk => !_cuLL(fk));
  if (!cens.length && !forns.length) return '';
  const motivo = fk => !/^\d{14}$/.test(fk) ? 'sem CNPJ' : CU.geo.get(fk)?.precisao === 'falhou' ? 'endereço não encontrado' : 'buscando';
  return `<div class="cu-sec"><h3>Fora do mapa (sem localização)</h3><div class="cu-note">${cens.length ? `<b>Centrais:</b> ${cens.map(c => _cuE(c.nome) + (c.cnpj ? '' : ' (sem CNPJ no cadastro)')).join(', ')}<br>` : ''}${forns.length ? `<b>Fornecedores:</b> ${forns.slice(0, 40).map(fk => _cuE(_cuNomeF(fk)) + ` (${motivo(fk)})`).join(', ')}${forns.length > 40 ? ` e mais ${forns.length - 40}` : ''}<br>Sem CNPJ: reimporte as Entradas com a coluna CNPJ FORNECEDOR ou cadastre o fornecedor nas Cobranças.` : ''}</div></div>`;
}
function _cuPainel() {
  const el = document.getElementById('cu-panel'), main = document.getElementById('cu-main'), s = CU.sel;
  el.classList.toggle('open', !!s); main.classList.toggle('popen', !!s);
  if (!s) { el.innerHTML = ''; return; }
  const arr = _cuEscopoNfs(), a = _cuAgg(arr), ref = _cuRef(_cuNfsF());
  let ey = 'Visão geral', ttl = 'Brasil', sub = _cuYmTxt(CU.mes), eyc = '';
  if (s.t === 'uf') { ey = 'Estado'; ttl = s.uf; sub = _cuRegsDaUf(s.uf).length + ' regionais · ' + sub; }
  if (s.t === 'reg') { ey = 'Regional'; ttl = s.reg; }
  if (s.t === 'cen') { const c = CU.cen.get(s.id), g = CU.geo.get(c.cnpj); ey = 'Central'; ttl = c.nome; sub = [g?.logradouro && `${g.logradouro}${g.numero ? ', ' + g.numero : ''}`, g?.municipio && `${g.municipio}/${g.uf}`].filter(Boolean).join(' · ') || c.regional; }
  if (s.t === 'forn') { const g = CU.geo.get(s.id); ey = 'Fornecedor'; eyc = 'f'; ttl = _cuNomeF(s.id); sub = (/^\d{14}$/.test(s.id) ? 'CNPJ ' + s.id.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : 'sem CNPJ') + (g?.municipio ? ` · ${g.municipio}/${g.uf}` : ''); }
  if (s.t === 'rota') { ey = 'Rota'; eyc = 'f'; ttl = `${_cuNomeF(s.forn)} → ${CU.cen.get(s.cen).nome}`; }
  const umMat = a.mats.size === 1, m1 = [...a.mats][0];
  const gMat = new Map(); arr.forEach(n => gMat.set(n.mat, (gMat.get(n.mat) || 0) + n.tot));
  const mats = [...a.mats].sort((x, y) => gMat.get(y) - gMat.get(x));
  const tabs = [['resumo', 'Resumo'], ['forn', 'Fornecedores'], ['precos', 'Preços'], ['nfs', 'Alertas', a.d]];
  let body = '';
  if (!arr.length) body = s.t === 'forn' ? '<div class="cu-note">Fornecedor sem compra neste mês e filtros. Fica no mapa em cinza para servir de alternativa na comparação.</div>' : '<div class="cu-note">Nenhuma NF com os filtros atuais.</div>';
  else if (CU.tab === 'resumo') {
    if (s.t === 'br' || s.t === 'uf' || s.t === 'reg') {
      const nivel = s.t === 'br' ? ['regional', n => CU.cen.get(n.cen).regional, 'reg'] : s.t === 'uf' ? ['regional', n => CU.cen.get(n.cen).regional, 'reg'] : ['central', n => n.cen, 'cen'];
      const items = Object.entries(_cuGroup(arr, nivel[1])).map(([k, v]) => ({ k, t: nivel[2] === 'cen' ? CU.cen.get(k).nome : k, v: _cuAgg(v).g, ix: _cuIdx(v, ref) })).sort((x, y) => y.v - x.v);
      body += `<div class="cu-sec"><h3>Gasto por ${nivel[0]}</h3>${_cuBarras(items, i => `${_cuBrlc(i.v)} <span class="cu-pill ${i.ix > .02 ? 'up' : i.ix < -.02 ? 'dn' : 'ok'}">${_cuPct(i.ix)}</span>`, nivel[2])}</div>`;
    }
    if (s.t === 'forn') {
      const rows = Object.entries(_cuGroup(arr, n => n.cen + '\u0001' + n.mat)).map(([k, v]) => { const [c, m] = k.split('\u0001'); return { c, m, s: _cuAgg(v), km: _cuKmPar(c, s.id) }; }).sort((x, y) => x.m.localeCompare(y.m) || x.s.pm - y.s.pm);
      body += `<div class="cu-sec"><h3>Centrais atendidas</h3><div style="overflow-x:auto"><table><thead><tr><th>Central</th><th>Material</th><th class="n">Preço</th><th class="n">km</th></tr></thead><tbody>${rows.map(r => `<tr class="cl" data-rota="${_cuE(r.c)}"><td>${_cuE(CU.cen.get(r.c).nome)}</td><td>${_cuE(r.m)}</td><td class="n">${_cuP(r.m, r.s.pm)}</td><td class="n">${r.km ? _cuNf0.format(r.km) : '–'}</td></tr>`).join('')}</tbody></table></div></div>`;
    }
    if (s.t === 'rota') {
      const m = mats[0], am = arr.filter(n => n.mat === m).sort((x, y) => x.d - y.d), last = am[am.length - 1], km = _cuKmPar(s.cen, s.forn), med = ref[m]?.p, ixr = _cuIdx(arr, ref);
      body += `<div class="cu-facts"><div><span>Distância estimada</span><b>${km ? _cuNf0.format(km) + ' km' : '–'}</b></div><div><span>R$/${_cuU(m)} por 100 km</span><b>${km && umMat ? _cuPn(m, a.pm / km * 100) : '–'}</b></div><div><span>Última NF</span><b>${_cuP(m, last.pr)}</b></div><div><span>Faixa das últimas 5</span><b>${last.min == null ? '–' : last.min === last.max ? _cuPn(m, last.min) : _cuPn(m, last.min) + ' a ' + _cuPn(m, last.max)}</b></div><div><span>Média do material</span><b>${med ? _cuP(m, med) : '–'}</b></div><div><span>Rota vs média</span><b class="${ixr > .02 ? 'cu-worse' : ''}">${_cuPct(ixr)}</b></div></div>
        <div class="cu-sec"><h3>Preço por mês · ${_cuE(m)} (R$/${_cuU(m)})</h3>${_cuGrafico([{ n: 'Preço médio das NFs', pts: _cuSerie(n => n.mat === m && n.cen === s.cen && n.forn === s.forn) }], m)}</div>`;
    }
    if (s.t !== 'rota') {
      const items = Object.entries(_cuGroup(arr, 'mat')).map(([k, v]) => ({ k, t: k, v: _cuAgg(v).g, s: _cuAgg(v) })).sort((x, y) => y.v - x.v);
      body += `<div class="cu-sec"><h3>Gasto por material</h3>${_cuBarras(items, i => `${_cuBrlc(i.v)} · ${_cuP(i.k, i.s.pm)}`, 'mat')}</div>`;
    }
    if (s.t === 'cen') {
      const tr = arr.filter(n => n.transf);
      if (tr.length) body += `<div class="cu-note"><b>${tr.length}</b> NF${tr.length > 1 ? 's' : ''} de transferência (compradas por outra central): ${[...new Set(tr.map(n => CU.cen.get(n.compra)?.nome || n.compra))].map(_cuE).join(', ')}. Entram no preço desta central.</div>`;
      const ls = Object.entries(_cuGroup(arr, 'forn')).map(([f, v]) => ({ f, k: _cuKmPar(s.id, f), s: _cuAgg(v) })).sort((x, y) => (x.k ?? 1e9) - (y.k ?? 1e9));
      body += `<div class="cu-sec"><h3>Fornecedores desta central</h3><div style="overflow-x:auto"><table><thead><tr><th>Fornecedor</th><th class="n">km</th><th class="n">Gasto</th></tr></thead><tbody>${ls.map(l => { const g = CU.geo.get(l.f); return `<tr class="cl" data-rota2="${_cuE(l.f)}"><td>${_cuE(_cuNomeF(l.f))}${g?.municipio ? `<br><span style="color:var(--text3);font-size:11px">${_cuE(g.municipio)}/${_cuE(g.uf)}</span>` : ''}</td><td class="n">${l.k ? _cuNf0.format(l.k) : '–'}</td><td class="n">${_cuBrlc(l.s.g)}</td></tr>`; }).join('')}</tbody></table></div></div>`;
    }
    if (s.t === 'br') body += _cuSemLocal();
  } else if (CU.tab === 'forn') {
    if (s.t === 'forn') {
      const cens = new Set(arr.map(n => n.cen)), comp = _cuNfsF().filter(n => cens.has(n.cen) && a.mats.has(n.mat));
      body = '<div class="cu-note">Comparação com quem entrega o mesmo material nas mesmas centrais.</div>' + _cuTabelaForn(comp, mats);
    } else body = _cuTabelaForn(arr, mats);
  } else if (CU.tab === 'precos') {
    if (!CU.pmat || !a.mats.has(CU.pmat)) CU.pmat = CU.F.mat || mats[0];
    const pm = CU.pmat, am = arr.filter(n => n.mat === pm);
    const top = Object.entries(_cuGroup(am, 'forn')).sort((x, y) => _cuAgg(y[1]).q - _cuAgg(x[1]).q).slice(0, 5).map(([f]) => f);
    const noEscopo = n => { const c = CU.cen.get(n.cen); if (s.t === 'cen' && n.cen !== s.id) return false; if (s.t === 'rota' && n.cen !== s.cen) return false; if (s.t === 'reg' && c.regional !== s.reg) return false; if (s.t === 'uf' && _cuUfCen(c) !== s.uf) return false; return true; };
    body = `<div class="cu-chips">${mats.map(m => `<button type="button" class="cu-chip${m === pm ? ' on' : ''}" data-pmat="${_cuE(m)}">${_cuE(m)}</button>`).join('')}</div>
      <div class="cu-sec"><h3>R$/${_cuU(pm)} por mês, por fornecedor</h3>${_cuGrafico(top.map(f => ({ n: _cuNomeF(f), pts: _cuSerie(n => n.mat === pm && n.forn === f && noEscopo(n)) })), pm)}</div>`;
    if (s.t !== 'cen' && s.t !== 'rota') {
      const med = _cuAgg(am).pm, bc = Object.entries(_cuGroup(am, 'cen')).map(([k, v]) => ({ k, t: CU.cen.get(k).nome, v: _cuAgg(v).pm })).sort((x, y) => y.v - x.v);
      body += `<div class="cu-sec"><h3>Preço pago por central · média ${_cuP(pm, med)}</h3>${_cuBarras(bc, i => `${_cuPn(pm, i.v)} <span class="cu-pill ${i.v / med - 1 > .02 ? 'up' : i.v / med - 1 < -.02 ? 'dn' : 'ok'}">${_cuPct(i.v / med - 1)}</span>`, 'cen')}</div>`;
    }
  } else body = _cuListaNfs(arr);
  el.innerHTML = `<div class="cu-ph"><div><div class="ey ${eyc}">${ey}</div><h2>${_cuE(ttl)}</h2><p>${_cuE(sub)}</p></div><button type="button" class="cu-x" id="cu-px" title="Fechar">×</button></div>
    <div class="cu-pk"><div><span>Gasto</span><b>${_cuBrlc(a.g)}</b></div><div><span>Volume</span><b>${umMat ? _cuQ(m1, a.q) : _cuTon(d3.sum(arr, n => n.qtd * (_cuU(n.mat) === 'kg' ? 1 : 1000)))}</b></div>
    <div><span>${umMat ? 'Preço médio' : 'Preço vs média'}</span><b>${umMat ? _cuP(m1, a.pm) : _cuPct(_cuIdx(arr, ref))}</b>${umMat ? '' : ' <em>índice</em>'}</div>
    <div><span>NFs em alerta</span><b class="${a.d ? 'red' : ''}">${a.d}</b> <em>${a.dr ? '+' + _cuBrlc(a.dr) : ''}</em></div></div>
    <div class="cu-tabs" role="tablist">${tabs.map(([k, t, n]) => `<button type="button" role="tab" class="${k === CU.tab ? 'on' : ''}" data-tab="${k}">${t}${n != null ? `<span class="n ${n ? 'red' : ''}">${n}</span>` : ''}</button>`).join('')}</div>
    <div class="cu-pb">${body}</div>`;
  el.querySelector('#cu-px').onclick = () => { CU.sel = null; _cuUpdate(false); _cuFit(_cuBounds()); };
  el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { CU.tab = b.dataset.tab; _cuPainel(); });
  el.querySelectorAll('[data-pmat]').forEach(b => b.onclick = () => { CU.pmat = b.dataset.pmat; _cuPainel(); });
  el.querySelectorAll('.cu-bar').forEach(b => b.onclick = () => {
    const k = b.dataset.k, act = b.dataset.act;
    if (act === 'reg') { const c = [...CU.cen.values()].find(x => x.regional === k); Object.assign(CU.F, { reg: k, cen: '', uf: c ? _cuUfCen(c) : '' }); CU.sel = { t: 'reg', reg: k }; _cuUpdate(true); }
    else if (act === 'cen') { const c = CU.cen.get(k); Object.assign(CU.F, { uf: _cuUfCen(c), reg: c.regional, cen: k }); CU.sel = { t: 'cen', id: k }; _cuUpdate(true); }
    else if (act === 'mat') { CU.F.mat = k; _cuUpdate(false); }
  });
  el.querySelectorAll('[data-forn]').forEach(r => r.onclick = () => { CU.sel = { t: 'forn', id: r.dataset.forn }; _cuUpdate(false); });
  el.querySelectorAll('[data-rota]').forEach(r => r.onclick = () => { CU.sel = { t: 'rota', cen: r.dataset.rota, forn: s.id }; _cuUpdate(false); });
  el.querySelectorAll('[data-rota2]').forEach(r => r.onclick = () => { CU.sel = { t: 'rota', cen: s.id, forn: r.dataset.rota2 }; _cuUpdate(false); });
}

/* ───────── comparador ───────── */
function _cuStrip() {
  const el = document.getElementById('cu-strip'), arr = _cuNfsF(), mats = [...new Set(arr.map(n => n.mat))].sort();
  if (!CU.cmpMat || !mats.includes(CU.cmpMat)) CU.cmpMat = CU.F.mat || mats[0];
  const m = CU.cmpMat, am = arr.filter(n => n.mat === m), esc = _cuEscopo();
  // Série de 6 meses de todos os fornecedores numa passada por mês (não uma por fornecedor).
  const ser = new Map();
  _cuMesesSerie().forEach((ym, i) => { for (const n of _cuMes(ym)) {
    if (n.mat !== m || (CU.F.cen && n.cen !== CU.F.cen) || (CU.F.reg && CU.cen.get(n.cen).regional !== CU.F.reg)) continue;
    let s = ser.get(n.forn); if (!s) ser.set(n.forn, s = Array.from({ length: 6 }, (_, x) => ({ x, g: 0, q: 0 })));
    s[i].g += n.tot; s[i].q += n.qtd;
  } });
  const serie = f => (ser.get(f) || []).map(p => ({ x: p.x, y: p.q ? p.g / p.q : null }));
  const rows = Object.entries(_cuGroup(am, 'forn')).map(([f, v]) => ({ f, s: _cuAgg(v), ser: serie(f) })).sort((x, y) => x.s.pm - y.s.pm);
  const best = rows[0]?.s.pm, tq = _cuAgg(am).q;
  const spark = ser => { const p = ser.filter(q => q.y != null); if (p.length < 2) return '<svg viewBox="0 0 186 22" width="100%" height="22"></svg>'; const x = d3.scaleLinear().domain([0, 5]).range([2, 184]), ex = d3.extent(p, q => q.y), y = d3.scaleLinear().domain(ex[0] === ex[1] ? [ex[0] * .98, ex[1] * 1.02] : ex).range([20, 3]); return `<svg viewBox="0 0 186 22" width="100%" height="22"><path d="${d3.line().x(q => x(q.x)).y(q => y(q.y))(p)}" style="fill:none;stroke:var(--amber);stroke-width:1.5"/></svg>`; };
  el.innerHTML = `<div class="sh"><b>Comparador · ${_cuE(_cuEscopoNome(esc))}</b><div class="cu-chips">${mats.map(x => `<button type="button" class="cu-chip${x === m ? ' on' : ''}" data-cm="${_cuE(x)}">${_cuE(x)}</button>`).join('')}</div></div>
    <div class="cu-cards">${rows.map((r, i) => `<div class="cu-card" data-cf="${_cuE(r.f)}"><span class="nm" title="${_cuE(_cuNomeF(r.f))}">${_cuE(_cuNomeF(r.f))}</span><span class="pr">R$ ${_cuPn(m, r.s.pm)}<span style="font-size:11px;color:var(--text3)">/${_cuU(m)}</span></span><span class="sub"><span class="${i ? 'cu-worse' : 'cu-best'}">${i ? _cuPct(r.s.pm / best - 1) : 'melhor preço'}</span><span>${_cuNf0.format(r.s.q / tq * 100)}% do vol.</span></span>${spark(r.ser)}<span class="sub"><span class="${r.s.d ? 'cu-worse' : ''}">${r.s.d ? r.s.d + ' alerta' + (r.s.d > 1 ? 's' : '') : 'sem alerta'}</span>${_cuComBtn(r.f, m, esc, '', `${_cuNomeF(r.f)} · ${m} · ${_cuEscopoNome(esc)}`)}</span></div>`).join('') || '<div class="cu-note">Sem NFs no mês.</div>'}</div>`;
  el.querySelectorAll('[data-cm]').forEach(b => b.onclick = () => { CU.cmpMat = b.dataset.cm; _cuStrip(); });
  el.querySelectorAll('[data-cf]').forEach(b => b.onclick = () => { CU.sel = { t: 'forn', id: b.dataset.cf }; CU.tab = 'forn'; _cuUpdate(false); });
}

/* ───────── geocodificação em segundo plano ───────── */
async function _cuGeoUm(a) {
  let b = null;
  try { const r = await fetch('https://brasilapi.com.br/api/cnpj/v1/' + a.cnpj); if (r.ok) b = await r.json(); } catch (_) { /* sem resposta */ }
  const row = { cnpj: a.cnpj, tipo: a.tipo, nome: b?.nome_fantasia || b?.razao_social || a.nome || null, logradouro: b?.logradouro || null, numero: b?.numero || null, bairro: b?.bairro || null,
    cep: String(b?.cep || '').replace(/\D/g, '') || null, municipio: b?.municipio || null, uf: b?.uf || null, lat: null, lng: null, precisao: 'falhou', atualizado_em: new Date().toISOString() };
  if (!b) return row;
  if (row.cep) {
    try { const r = await fetch('https://cep.awesomeapi.com.br/json/' + row.cep); if (r.ok) { const j = await r.json(), la = +j.lat, lo = +j.lng; if (la && lo && isFinite(la) && isFinite(lo)) return Object.assign(row, { lat: la, lng: lo, precisao: 'cep' }); } } catch (_) { /* tenta o endereço */ }
  }
  try {
    const q = new URLSearchParams({ format: 'json', limit: '1', countrycodes: 'br', street: [row.numero, row.logradouro].filter(Boolean).join(' '), city: row.municipio || '', state: row.uf || '' });
    const r = await fetch('https://nominatim.openstreetmap.org/search?' + q);
    await _cuEspera(1100); // política do Nominatim: 1 consulta por segundo
    if (r.ok) { const j = await r.json(); if (j[0]) return Object.assign(row, { lat: +j[0].lat, lng: +j[0].lon, precisao: 'endereco' }); }
  } catch (_) { /* tenta o município */ }
  if (b.codigo_municipio_ibge) {
    try { const r = await fetch(CU_IBGE + 'municipios/' + b.codigo_municipio_ibge + '?' + CU_GEOJSON); if (r.ok) { const c = d3.geoCentroid(_cuRewind(await r.json())); Object.assign(row, { lng: c[0], lat: c[1], precisao: 'municipio' }); } } catch (_) { /* fica sem */ }
  }
  return row;
}
async function _cuGeocodificar() {
  if (CU.geoRodando || !window.supabaseClient) return;
  CU.geoRodando = true;
  try {
    const velho = g => g.precisao === 'falhou' && Date.now() - Date.parse(g.atualizado_em) > 30 * 864e5;
    const falta = c => c && (!CU.geo.has(c) || velho(CU.geo.get(c)));
    const alvos = [];
    CU.cen.forEach(c => { if (c.cnpj && falta(c.cnpj) && CU.cenComCompra?.has(c.alias)) alvos.push({ cnpj: c.cnpj, tipo: 'central', nome: c.nome }); });
    // Fornecedores do mês escolhido primeiro (por gasto), depois o resto do histórico.
    const gasto = new Map(); _cuMes(CU.mes).forEach(n => gasto.set(n.forn, (gasto.get(n.forn) || 0) + n.tot));
    [...CU.fornMats.keys()].filter(fk => /^\d{14}$/.test(fk) && falta(fk)).sort((x, y) => (gasto.get(y) || 0) - (gasto.get(x) || 0))
      .forEach(fk => alvos.push({ cnpj: fk, tipo: 'fornecedor', nome: _cuNomeF(fk) }));
    let feitos = 0;
    for (const a of alvos) {
      _cuStatus(`Localizando endereços: ${feitos} de ${alvos.length}`);
      const row = await _cuGeoUm(a); feitos++;
      CU.geo.set(a.cnpj, row);
      const { error } = await window.supabaseClient.from('custos_geo').upsert(row, { onConflict: 'cnpj' });
      if (error) console.warn('[Custos] custos_geo:', error.message);
      if (feitos % 5 === 0 && document.getElementById('page-custos')?.classList.contains('active')) _cuDesenhar();
      await _cuEspera(300); // ritmo da BrasilAPI (mesmo de preencherUfFiliais)
    }
    if (alvos.length) _cuUpdate(false);
  } finally { CU.geoRodando = false; _cuStatus(''); }
}

/* ───────── tooltip, status, seletor de mês ───────── */
function _cuTip(e, h) { const t = document.getElementById('cu-tip'); t.innerHTML = h; t.hidden = false; const r = t.getBoundingClientRect(); let x = e.clientX + 14, y = e.clientY + 14; if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14; if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14; t.style.left = x + 'px'; t.style.top = y + 'px'; }
function _cuTipOff() { document.getElementById('cu-tip').hidden = true; }
function _cuStatus(t) { const el = document.getElementById('cu-status'); if (el) el.textContent = t; }
function _cuVazio(t) { const el = document.getElementById('cu-empty'); el.textContent = t; el.hidden = !t; }
function _cuMesGrid() {
  const y = CU.viewAno, temDados = CU.meses || new Set();
  document.getElementById('cu-month-inner').innerHTML = `<div class="cal-header"><button class="cal-nav-btn" type="button" data-cuano="-1"><i class="ti ti-chevron-left"></i></button><span class="cal-header-center" style="cursor:default">${y}</span><button class="cal-nav-btn" type="button" data-cuano="1"><i class="ti ti-chevron-right"></i></button></div>
    <div class="cal-month-grid">${CU_MESES.map((n, i) => { const ym = y * 100 + i + 1; return `<button class="cal-grid-item${ym === CU.mes ? ' active' : ''}" type="button" data-cumes="${ym}" style="${temDados.has(ym) ? '' : 'opacity:.45'}">${n}</button>`; }).join('')}</div>`;
  document.querySelectorAll('#cu-month-inner [data-cuano]').forEach(b => b.onclick = e => { e.stopPropagation(); CU.viewAno += +b.dataset.cuano; _cuMesGrid(); });
  document.querySelectorAll('#cu-month-inner [data-cumes]').forEach(b => b.onclick = () => { CU.mes = +b.dataset.cumes; _cuFechaMes(); _cuUpdate(false); });
}
function _cuFechaMes() { document.getElementById('cu-month-dropdown')?.classList.remove('open'); document.getElementById('cu-month-trigger')?.classList.remove('open'); }
window.cuToggleMonthPicker = function () {
  const dd = document.getElementById('cu-month-dropdown');
  if (dd.classList.contains('open')) { _cuFechaMes(); return; }
  document.querySelectorAll('.cal-picker-dropdown.open').forEach(x => { x.classList.remove('open'); document.getElementById(x.id.replace('-dropdown', '-trigger'))?.classList.remove('open'); });
  CU.viewAno = Math.floor((CU.mes || (new Date().getFullYear() * 100 + 1)) / 100);
  dd.classList.add('open'); document.getElementById('cu-month-trigger').classList.add('open'); _cuMesGrid();
};

/* ───────── ciclo ───────── */
function _cuUpdate(refit) {
  const temMes = _cuMes(CU.mes).length > 0;
  _cuVazio(!CU.nNfs ? 'Nenhuma entrada com material, peso e valor na base. Importe as Entradas para montar os custos.' : !temMes ? `Nenhuma NF em ${_cuYmTxt(CU.mes)}. Escolha outro mês.` : '');
  _cuFiltros(); _cuCrumbs(); _cuLegenda(); _cuDesenhar(); _cuStrip(); _cuPainel();
  if (refit) requestAnimationFrame(() => { _cuMedir(); _cuFit(_cuBounds()); });
}
function _cuInitUI() {
  const F = CU.F;
  [['reg', 'cu-f-reg'], ['cen', 'cu-f-cen'], ['mat', 'cu-f-mat'], ['forn', 'cu-f-forn']].forEach(([k, id]) => document.getElementById(id).addEventListener('change', e => {
    F[k] = e.target.value;
    if (k === 'reg') { F.cen = ''; const c = [...CU.cen.values()].find(x => x.regional === F.reg); F.uf = F.reg && c ? _cuUfCen(c) : ''; CU.sel = F.reg ? { t: 'reg', reg: F.reg } : null; }
    if (k === 'cen') { if (F.cen) { const c = CU.cen.get(F.cen); F.reg = c.regional; F.uf = _cuUfCen(c); CU.sel = { t: 'cen', id: F.cen }; } else CU.sel = F.reg ? { t: 'reg', reg: F.reg } : null; }
    if (k === 'forn' && F.forn) CU.sel = { t: 'forn', id: F.forn };
    _cuUpdate(k === 'reg' || k === 'cen');
  }));
  document.getElementById('cu-f-div').addEventListener('change', e => { F.div = e.target.checked; _cuUpdate(false); });
  document.getElementById('cu-f-clear').addEventListener('click', () => { Object.assign(F, { uf: '', reg: '', cen: '', mat: '', forn: '', div: false }); CU.sel = null; _cuUpdate(true); });
  document.getElementById('cu-z-in').onclick = () => _cuSvg?.transition().duration(300).call(_cuZoom.scaleBy, 1.6);
  document.getElementById('cu-z-out').onclick = () => _cuSvg?.transition().duration(300).call(_cuZoom.scaleBy, 1 / 1.6);
  document.getElementById('cu-z-fit').onclick = () => _cuFit(_cuBounds());
  // Botão de comentário: captura antes do clique do card/linha que o contém.
  document.getElementById('page-custos').addEventListener('click', e => {
    const b = e.target.closest('[data-cuc-f]'); if (!b) return;
    e.stopPropagation(); e.preventDefault();
    _cuComAbrir({ f: b.dataset.cucF, m: b.dataset.cucM, c: b.dataset.cucC, n: b.dataset.cucN, l: b.dataset.cucL });
  }, true);
  document.getElementById('cu-com-x').onclick = document.getElementById('cu-com-cancel').onclick = () => { document.getElementById('cu-com').hidden = true; CU.comAtual = null; };
  document.getElementById('cu-com').addEventListener('click', e => { if (e.target.id === 'cu-com') { e.currentTarget.hidden = true; CU.comAtual = null; } });
  document.getElementById('cu-com-form').addEventListener('submit', _cuComSalvar);
  document.addEventListener('click', e => { if (!e.target.closest('#cu-month-wrap')) _cuFechaMes(); });
}
async function custosRender() {
  if (!CU.iniciado) { CU.iniciado = true; _cuInitUI(); }
  _cuStatus('Carregando…');
  try { await _cuGarantirBase(); }
  catch (e) { _cuStatus(''); _cuVazio('Não foi possível carregar o mapa: ' + e.message + '. Verifique a conexão e abra a aba de novo.'); return; }
  _cuStatus('Calculando…');
  await new Promise(r => setTimeout(r, 0)); // deixa o "Calculando…" aparecer antes da passada na base
  await _cuCalcularSeMudou();
  _cuStatus('');
  _cuMedir();
  _cuUpdate(true);
  _cuGeocodificar();
}
window.custosRender = custosRender;
