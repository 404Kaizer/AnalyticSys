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
  // uf/reg/cen = onde o mapa está (navegação); regs/cens/mats/forns = filtros (vários itens).
  // mat/forn = o único material/fornecedor marcado (ou ''), derivado em _cuSync.
  F: { uf: '', reg: '', cen: '', mat: '', forn: '', div: false, regs: new Set(), cens: new Set(), mats: new Set(), forns: new Set() },
  L: { selos: false, cor: true, calor: false, esp: 'gasto', raio: 0 }, // esp: espessura da rota (gasto | frete por km); raio: km em volta da central (0 = desligado) // selos de alerta saíram do mapa (26/11): alertas ficam na gaveta e no tooltip
  sel: null, tab: 'nfs', pmat: null, cmpMat: null,
  mes: 0, viewAno: 0,           // mês selecionado (aaaamm)
  iniciado: false, base: null,  // promessa da carga única (d3, malha, cadastros)
  chave: '', NFS: [], porMes: new Map(), minYm: 0,
  unMat: new Map(), nomeForn: new Map(), fornMats: new Map(),
  cen: new Map(), geo: new Map(), cnpjPorNome: new Map(), fornCad: new Map(),
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
// Malhas do IBGE guardadas no navegador (IndexedDB 'custos-malhas'): baixa uma vez e reaproveita nas
// próximas aberturas. Malha muda raramente; trocar CU_MALHA_VER força baixar de novo.
const CU_MALHA_VER = 'v1|';
function _cuMalhaDb() {
  // Se o IndexedDB não responder em 1,5 s (bloqueado/indisponível), segue sem cache: o mapa nunca espera por ele.
  if (!CU._mdb) CU._mdb = new Promise(ok => { setTimeout(() => ok(null), 1500); try { const r = indexedDB.open('custos-malhas', 1); r.onupgradeneeded = () => r.result.createObjectStore('m'); r.onsuccess = () => ok(r.result); r.onerror = r.onblocked = () => ok(null); } catch (_) { ok(null); } });
  return CU._mdb;
}
async function _cuMalha(url) {
  const db = await _cuMalhaDb(), k = CU_MALHA_VER + url;
  if (db) { const g = await new Promise(ok => { try { const q = db.transaction('m').objectStore('m').get(k); q.onsuccess = () => ok(q.result || null); q.onerror = () => ok(null); } catch (_) { ok(null); } }); if (g) return g; }
  const r = await fetch(url).catch(() => null);
  if (!r || !r.ok) return null;
  const g = await r.json();
  if (db) try { db.transaction('m', 'readwrite').objectStore('m').put(g, k); } catch (_) { /* sem espaço: segue sem cache */ }
  return g;
}
function _cuGarantirBase() {
  if (CU.base) return CU.base;
  CU.base = (async () => {
    await _cuScript(CU_D3_URL);
    const sb = !!window.supabaseClient;
    const [br, filiais, geo, coms, forns, fretes] = await Promise.all([
      _cuMalha(CU_IBGE + 'paises/BR?' + CU_GEOJSON + '&intrarregiao=UF').then(g => { if (!g) throw new Error('malha do IBGE indisponível'); return g; }),
      sb ? _cuFetchAll('filiais', 'origem, alias, cnpj, regional, uf', 'alias').catch(() => []) : [],
      sb ? _cuFetchAll('custos_geo', '*', 'cnpj').catch(e => { console.warn('[Custos] custos_geo:', e); return []; }) : [],
      sb ? _cuFetchAll('custos_comentarios', '*', 'created_at').catch(e => { console.warn('[Custos] custos_comentarios:', e); return []; }) : [],
      sb ? _cuFetchAll('cob_fornecedores', 'nome, cnpj', 'cnpj').catch(() => []) : [],
      sb ? _cuFetchAll('custos_frete', '*', 'created_at').catch(e => { console.warn('[Custos] custos_frete (rodou o SQL 20261119_custos_frete?):', e); return []; }) : [],
    ]);
    CU.br = _cuRewind(br);
    _cuMontarCentrais([...(state.filiais || []), ...filiais]);
    geo.forEach(g => CU.geo.set(g.cnpj, g));
    _cuSetComs(coms);
    _cuSetFrete(fretes);
    forns.forEach(f => { const c = String(f.cnpj || '').replace(/\D/g, ''); if (c.length === 14) { CU.cnpjPorNome.set(_cuNomeNorm(f.nome), c); CU.fornCad.set(c, f.nome || c); } });
    _cuMapaInit();
    if (sb) {
      // ponytail: recarrega a tabela inteira a cada mudança (é pequena); se crescer, aplicar só o payload.
      window.supabaseClient.channel('custos_comentarios')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'custos_comentarios' }, () => _cuRecarregarComs())
        .subscribe();
      window.supabaseClient.channel('custos_frete')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'custos_frete' }, () => _cuRecarregarFrete())
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
// Categoria padronizada do material (agrupa o seletor do comparador) e unidade do preço.
function _cuCategoria(cat, mat) {
  let c = (typeof normalizeCategoriaMaterial === 'function' ? normalizeCategoriaMaterial(cat) : cat) || '';
  if (!c && typeof getCategoriaPorGrupo === 'function') c = getCategoriaPorGrupo(mat) || '';
  return c || 'Outros';
}
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
  const diaCache = new Map(), kgUnCache = new Map(), fkPorNome = new Map(), pares = new Map(), lista = [], nfFr = new Map();
  CU.unMat = new Map(); CU.catMat = new Map(); CU.nomeForn = new Map(); CU.fornMats = new Map(); CU.cenComCompra = new Set();
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
    if (!CU.unMat.has(mat)) { CU.unMat.set(mat, _cuUnidade(r.categoria, mat)); CU.catMat.set(mat, _cuCategoria(r.categoria, mat)); }
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
    // Frete real por NF (todos os materiais da NF juntos): o CTe repetido nos itens conta uma vez (chave ou nº do CTe;
    // sem chave, o maior valor) e o peso total da NF serve para dividir o frete entre os materiais.
    const ft = r.freteTotal;
    if (ft > 0 && r.nf && r.nf !== '—') {
      const kn = fk + '|' + String(r.nf) + '|' + d; let o = nfFr.get(kn);
      if (!o) nfFr.set(kn, o = { kg: 0, fr: 0, sem: 0, v: null });
      o.kg += kg; const kf = r.freteChave || r.freteNumero;
      if (kf) { if (!o.v || !o.v.has(kf)) { (o.v || (o.v = new Set())).add(kf); o.fr += ft; } } else if (ft > o.sem) o.sem = ft;
    }
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
    let FR = null; // frete real por NF — só nos pares que têm frete nas Entradas
    let m = 0;
    for (let j = 0; j < n;) {
      // Itens da mesma NF (mesmo número e data) viram uma NF só.
      const i0 = rows[j], nf = nfDe(i0);
      let kg = 0, val = 0, pk = 0, tr = -1, jj = j, kgF = 0, frSem = 0;
      do {
        const i = rows[jj], r = ents[i];
        kg += kgRow[i]; val += valRow[i]; pk += pkgRow[i] * kgRow[i];
        if (tr < 0 && r.centralCompra && r.centralDestino && r.centralCompra !== r.centralDestino) tr = i;
        if (r.freteTotal > 0) { kgF += kgRow[i]; if (!nf && r.freteTotal > frSem) frSem = r.freteTotal; } // sem nº de NF: maior valor do item
        jj++;
      } while (jj < n && nf && dRow[rows[jj]] === dRow[i0] && nfDe(rows[jj]) === nf);
      D[m] = dRow[i0]; Q[m] = kg / f; T[m] = val; PR[m] = Math.round(pk / kg * f * dec) / dec; RI[m] = i0; TR[m] = tr;
      // Frete da NF (todos os materiais) dividido pelo peso deste material: antes o frete inteiro do CTe
      // caía em cada material da NF e um aditivo de poucos kg ficava com o frete do caminhão todo.
      let fr = frSem;
      if (kgF > 0 && nf) { const o = nfFr.get(p.forn + '|' + nf + '|' + dRow[i0]); if (o && o.kg) fr = (o.fr + o.sem) * kgF / o.kg; }
      if (fr > 0) { if (!FR) FR = new Float64Array(n); FR[m] = fr; }
      const b = Math.min(m, 5);
      if (!b) AL[m] = ((D[m] / 100) | 0) !== minYm ? 3 : 0;   // 3 = fornecedor novo (nunca no 1º mês da base)
      else {
        let mn = Infinity, mx = -Infinity;
        for (let t = m - b; t < m; t++) { if (PR[t] < mn) mn = PR[t]; if (PR[t] > mx) mx = PR[t]; }
        MN[m] = mn; MX[m] = mx; BS[m] = b; AL[m] = PR[m] > mx ? 1 : PR[m] < mn ? 2 : 0;
      }
      meses.add((D[m] / 100) | 0); m++; j = jj;
    }
    // Alerta de CTe: frete por unidade fora da faixa dos últimos 5 CTe do mesmo par (mesma regra da NF).
    let ACL = null, CMN = null, CMX = null, CBS = null;
    if (FR) {
      ACL = new Int8Array(m); CMN = new Float64Array(m); CMX = new Float64Array(m); CBS = new Int8Array(m);
      const hist = [];
      for (let t = 0; t < m; t++) {
        if (!FR[t]) continue;
        const u = Math.round(FR[t] / Q[t] * dec) / dec, ult = hist.slice(-5);
        if (ult.length) { let mn = Infinity, mx = -Infinity; ult.forEach(v => { if (v < mn) mn = v; if (v > mx) mx = v; }); CMN[t] = mn; CMX[t] = mx; CBS[t] = ult.length; ACL[t] = u > mx ? 1 : u < mn ? 2 : 0; }
        hist.push(u);
      }
    }
    Object.assign(p, { n: m, D, Q, T, PR, MN, MX, AL, BS, RI, TR, FR, ACL, CMN, CMX, CBS, dec, rows: null });
    total += m;
    (CU.fornMats.get(p.forn) || CU.fornMats.set(p.forn, new Set()).get(p.forn)).add(p.mat);
    CU.cenComCompra.add(p.cen);
    // Central que aparece nas Entradas mas não no cadastro.
    if (!CU.cen.has(p.cen)) CU.cen.set(p.cen, { alias: p.cen, nome: p.cen, cnpj: '', regional: 'Sem regional', uf: '', _s: -1 });
  }
  CU.ents = ents; CU.pares = lista; CU.meses = meses; CU.nNfs = total; CU.mesCache = new Map();
  CU.minYm = minYm === Infinity ? 0 : minYm;
  CU.mesesSel = (CU.mesesSel || []).filter(ym => meses.has(ym));
  if (!CU.mesesSel.length) CU.mesesSel = meses.size ? [Math.max(...meses)] : [];
  CU.mes = CU.mesesSel[CU.mesesSel.length - 1] || 0;
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
      const frT = p.FR ? p.FR[k] : 0;
      if (frT > 0) {
        o.fr = frT; o.frUn = Math.round(frT / qtd * p.dec) / p.dec;
        if (p.CBS[k]) { o.cMin = p.CMN[k]; o.cMax = p.CMX[k]; o.cBase = p.CBS[k]; }
        const ac = p.ACL[k]; if (ac) { o.alertaCte = ac === 1 ? 'acima' : 'abaixo'; o.cteDif = (o.frUn - (ac === 1 ? o.cMax : o.cMin)) * qtd; }
      }
      _cuAplicaFrete(o);
      a.push(o);
    }
  }
  CU.mesCache.set(ym, a);
  if (CU.mesCache.size > Math.max(8, (CU.mesesSel || []).length + 6)) CU.mesCache.delete(CU.mesCache.keys().next().value);
  return a;
}

/* ───────── recortes ───────── */
const _cuUfCen = c => c.uf || CU.geo.get(c.cnpj)?.uf || '';
// Período = vários meses (CU.mesesSel); CU.mes = o último deles (âncora dos gráficos de 6 meses).
function _cuPeriodo() {
  const sel = CU.mesesSel || [CU.mes], k = sel.join(',');
  if (CU._perK === k && CU._perA && CU.mesCache.has(sel[0])) return CU._perA;
  CU._perK = k;
  return CU._perA = sel.length === 1 ? _cuMes(sel[0]) : [].concat(...sel.map(_cuMes));
}
function _cuPerTxt() {
  const s = CU.mesesSel || [CU.mes]; if (!s.length || !s[0]) return '';
  if (s.length === 1) return _cuYmTxt(s[0]);
  const ab = ym => CU_MESES[ym % 100 - 1] + '/' + Math.floor(ym / 100);
  const idx = ym => Math.floor(ym / 100) * 12 + ym % 100, seguidos = s.every((ym, i) => !i || idx(ym) - idx(s[i - 1]) === 1);
  return seguidos ? `${ab(s[0])} a ${ab(s[s.length - 1])}` : `${s.length} meses (${s.map(ab).join(', ')})`;
}
// Navegação do mapa ↔ filtros: clicar no mapa/migalhas troca uf/reg/cen e o filtro passa a
// mostrar só aquele item; filtro com vários itens não mexe aqui (já acertou CU._navAnt).
function _cuSync() {
  const F = CU.F, nav = F.uf + '|' + F.reg + '|' + F.cen;
  if (nav !== CU._navAnt) { F.regs = new Set(F.reg ? [F.reg] : []); F.cens = new Set(F.cen ? [F.cen] : []); CU._navAnt = nav; }
  F.mat = F.mats.size === 1 ? [...F.mats][0] : '';
  F.forn = F.forns.size === 1 ? [...F.forns][0] : '';
}
function _cuNfsF() {
  // Chamado várias vezes por clique (mapa, painel, comparador): guarda o último recorte.
  const F = CU.F, a = _cuPeriodo(), j = s => [...s].join(','), chave = [F.uf, F.reg, F.cen, j(F.regs), j(F.cens), j(F.mats), j(F.forns), F.div, CU.geo.size].join('|');
  if (CU._nfsA === a && CU._nfsK === chave) return CU._nfsR;
  CU._nfsA = a; CU._nfsK = chave;
  return CU._nfsR = a.filter(n => {
    if (F.cen && n.cen !== F.cen) return false;
    if (F.cens.size && !F.cens.has(n.cen)) return false;
    const c = CU.cen.get(n.cen);
    if (F.reg && c.regional !== F.reg) return false;
    if (F.regs.size && !F.regs.has(c.regional)) return false;
    if (F.uf && _cuUfCen(c) !== F.uf) return false;
    return (!F.mats.size || F.mats.has(n.mat)) && (!F.forns.size || F.forns.has(n.forn)) && (!F.div || n.isDiv);
  });
}
// g/pm = valor e preço da NF; ge/pe = custo entregue (NF + frete); d = alertas de NF; dc = alertas de CTe.
function _cuAgg(arr) {
  let g = 0, q = 0, d = 0, dr = 0, ge = 0, dc = 0, dcr = 0; const mats = new Set();
  arr.forEach(n => { g += n.tot; q += n.qtd; ge += n.te; mats.add(n.mat); if (n.isDiv) { d++; if (n.dif > 0) dr += n.dif; } if (n.isCte) { dc++; if (n.cteDif > 0) dcr += n.cteDif; } });
  return { g, q, n: arr.length, d, dr, ge, dc, dcr, mats, pm: q ? g / q : 0, pe: q ? ge / q : 0, fu: q ? (ge - g) / q : 0 };
}
// Índice de preço (rotas coloridas, calor) sobre o custo ENTREGUE.
function _cuRef(arr) { const m = {}; arr.forEach(n => { (m[n.mat] || (m[n.mat] = { g: 0, q: 0 })).g += n.te; m[n.mat].q += n.qtd; }); Object.values(m).forEach(o => o.p = o.g / o.q); return m; }
function _cuIdx(arr, ref) { let s = 0, w = 0; arr.forEach(n => { const r = ref[n.mat]; if (!r || !r.p) return; s += (n.ent - r.p) / r.p * n.te; w += n.te; }); return w ? s / w : 0; }

/* ───────── frete: cadastro (custos_frete) + frete real da NF ───────── */
const CU_MODAL = { cif: 'CIF (frete no preço)', cte: 'CTe (FOB)', proprio: 'Transporte próprio' };
function _cuSetFrete(rows) {
  CU.frete = rows; CU.freteIdx = new Map();
  rows.slice().sort((a, b) => (b.vigencia || '').localeCompare(a.vigencia || '')).forEach(r => { (CU.freteIdx.get(r.fornecedor) || CU.freteIdx.set(r.fornecedor, []).get(r.fornecedor)).push(r); });
  // O frete entra nos objetos do mês: refaz os meses abertos.
  CU.mesCache = new Map(); CU._perK = null; CU._nfsA = null;
}
async function _cuRecarregarFrete() {
  try { _cuSetFrete(await _cuFetchAll('custos_frete', '*', 'created_at')); } catch (e) { console.warn('[Custos] custos_frete:', e); return; }
  if (document.getElementById('page-custos')?.classList.contains('active') && CU.pares) _cuUpdate(false);
}
// Linha vigente mais específica: central > regional; material > todos; depois a vigência mais recente.
function _cuFreteCad(forn, mat, cen, d) {
  const rows = CU.freteIdx?.get(forn); if (!rows) return null;
  const reg = CU.cen.get(cen)?.regional, ds = `${Math.floor(d / 10000)}-${String(Math.floor(d / 100) % 100).padStart(2, '0')}-${String(d % 100).padStart(2, '0')}`;
  let melhor = null, ms = -1;
  for (const r of rows) {
    if (r.vigencia > ds) continue;
    if (r.central ? r.central !== cen : r.regional !== reg) continue;
    if (r.material && r.material !== mat) continue;
    const s = (r.central ? 2 : 0) + (r.material ? 1 : 0);
    if (s > ms) { ms = s; melhor = r; }
  }
  return melhor;
}
function _cuAplicaFrete(o) {
  const cad = _cuFreteCad(o.forn, o.mat, o.cen, o.d), esperado = cad ? (cad.modalidade === 'cif' ? 0 : (+cad.valor || 0)) : null;
  o.cad = cad;
  o.frete = o.fr > 0 ? o.frUn : (esperado || 0);
  o.freteFonte = o.fr > 0 ? 'nf' : cad ? cad.modalidade : '';
  o.divCte = !!(o.fr > 0 && cad && Math.abs(o.frUn - esperado) > 0.005);
  if (o.divCte) { o.cteEsperado = esperado; if (!o.alertaCte) o.cteDif = (o.frUn - esperado) * o.qtd; }
  o.isCte = !!o.alertaCte || o.divCte;
  o.ent = o.pr + o.frete; o.te = o.tot + o.frete * o.qtd;
}
function _cuEscopo() {
  const s = CU.sel;
  if (s?.t === 'cen') return s.id; if (s?.t === 'rota') return s.cen;
  if (CU.F.cen) return CU.F.cen;
  if (CU.F.reg) return 'reg:' + CU.F.reg;
  if (CU.F.uf) return 'uf:' + CU.F.uf;
  return 'BR';
}
const _cuEscopoNome = k => k === 'BR' ? 'Brasil' : k.startsWith('reg:') ? k.slice(4) : k.startsWith('uf:') ? k.slice(3) : (CU.cen.get(k)?.nome || k);
function _cuNomeF(fk) { return CU.nomeForn.get(fk) || CU.fornCad.get(fk) || CU.geo.get(fk)?.nome || (fk.startsWith('n:') ? fk.slice(2) : fk); }
function _cuRegsDaUf(uf) { return [...new Set([...CU.cen.values()].filter(c => _cuUfCen(c) === uf && CU.cenComCompra?.has(c.alias)).map(c => c.regional))].sort(); }
// Cor da regional (nível Estado): paleta fixa de 12 cores distintas, legível nos dois temas.
const CU_CORES_REG = ['#f59e0b', '#22c3d9', '#a78bfa', '#f472b6', '#34d399', '#60a5fa', '#fb7185', '#facc15', '#2dd4bf', '#c084fc', '#fb923c', '#4ade80'];
function _cuCorReg(reg) { const regs = _cuRegsDaUf(CU.F.uf); const i = regs.indexOf(reg); return CU_CORES_REG[(i < 0 ? 0 : i) % CU_CORES_REG.length]; }

/* ───────── posições ───────── */
function _cuLL(cnpj) { const g = cnpj && CU.geo.get(cnpj); return g && g.lat != null && g.lng != null ? [g.lng, g.lat] : null; }
function _cuXY(cnpj) { const ll = _cuLL(cnpj); return ll ? CU.proj(ll) : null; }
function _cuKm(a, b) { const r = Math.PI / 180, dl = (b[1] - a[1]) * r, dn = (b[0] - a[0]) * r, h = Math.sin(dl / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dn / 2) ** 2; return 6371 * 2 * Math.asin(Math.sqrt(h)) * 1.3; }
function _cuKmPar(cen, fk) { const a = _cuLL(CU.cen.get(cen)?.cnpj), b = _cuLL(fk); return a && b ? _cuKm(a, b) : null; }

/* ───────── mapa ───────── */
let _cuSvg, _cuG, _cuZoom, _cuGr = {};
/* ───────── Canvas: estados e municípios ─────────
   Os <path> continuam no SVG, no grupo com opacity 0: recebem mouse/clique, classes e :hover do CSS
   como antes. Só a pintura vai para o <canvas>, que no zoom/arrasto redesenha um bitmap em vez de o
   navegador re-rasterizar centenas de polígonos SVG.
   ponytail: o estilo de cada path vem de getComputedStyle (relido só quando classe/hover/tema mudam);
   se passar de alguns milhares de polígonos, trocar por tabela de cores por classe. */
const CV = { el: null, lista: null, raf: 0, p2: new WeakMap() };
function _cuCvSuja() { CV.lista = null; _cuCvAgenda(); }
function _cuCvAgenda() { if (!CV.raf) CV.raf = requestAnimationFrame(() => { CV.raf = 0; _cuCvDesenha(); }); }
function _cuCvLista() {
  const out = [];
  [_cuGr.st, _cuGr.mun].forEach(g => {
    if (getComputedStyle(g.node()).display === 'none') return;
    g.node().querySelectorAll('path').forEach(el => {
      const d = el.getAttribute('d'); if (!d) return;
      const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return;
      let c = CV.p2.get(el); if (!c || c.d !== d) CV.p2.set(el, c = { d, p: new Path2D(d) });
      const op = +cs.opacity;
      out.push({ p: c.p, f: cs.fill, fo: +cs.fillOpacity * op, s: cs.stroke, so: +cs.strokeOpacity * op, w: parseFloat(cs.strokeWidth) || 0 });
    });
  });
  return out;
}
function _cuCvDesenha() {
  const cv = CV.el; if (!cv || !_cuSvg) return;
  const dpr = devicePixelRatio || 1, W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
  if (!W || !H) return;
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  if (!CV.lista) CV.lista = _cuCvLista();
  const ctx = cv.getContext('2d'), t = d3.zoomTransform(_cuSvg.node());
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
  ctx.setTransform(dpr * t.k, 0, 0, dpr * t.k, dpr * t.x, dpr * t.y); ctx.lineJoin = 'round';
  for (const o of CV.lista) {
    if (o.fo > 0 && o.f !== 'none') { ctx.globalAlpha = o.fo; ctx.fillStyle = o.f; ctx.fill(o.p); }
    if (o.so > 0 && o.w > 0 && o.s !== 'none') { ctx.globalAlpha = o.so; ctx.strokeStyle = o.s; ctx.lineWidth = o.w; ctx.stroke(o.p); }
  }
  ctx.globalAlpha = 1;
}
function _cuCvInit() {
  CV.el = document.getElementById('cu-canvas'); if (!CV.el) return;
  [_cuGr.st, _cuGr.mun].forEach(g => {
    g.style('opacity', 0);
    // Qualquer mudança de classe/estilo/geometria ou hover nos paths relê os estilos.
    new MutationObserver(_cuCvSuja).observe(g.node(), { attributes: true, childList: true, subtree: true, attributeFilter: ['class', 'style', 'd'] });
    g.node().addEventListener('mouseover', _cuCvSuja); g.node().addEventListener('mouseout', _cuCvSuja);
  });
  // Classes do SVG (esmaece, movendo), --sw no fim do zoom e troca de tema mudam o estilo calculado.
  new MutationObserver(_cuCvSuja).observe(_cuSvg.node(), { attributes: true, attributeFilter: ['class', 'style'] });
  new MutationObserver(_cuCvSuja).observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
  new ResizeObserver(_cuCvAgenda).observe(CV.el);
}
function _cuMapaInit() {
  CU.proj = d3.geoMercator().fitSize([1000, 1000], CU.br);
  // 3 casas decimais no espaço projetado (0–1000): caminhos bem menores, sem perda visível até o zoom de município.
  CU.path = d3.geoPath(CU.proj); if (CU.path.digits) CU.path.digits(3);
  _cuSvg = d3.select('#cu-map'); _cuG = _cuSvg.append('g');
  ['st', 'mun', 'stl', 'agg', 'raio', 'lig', 'rt', 'hit', 'f', 'c', 'b', 'l', 'rg'].forEach(k => _cuGr[k] = _cuG.append('g'));
  _cuCvInit();
  // Fluidez: o transform do grupo muda a cada evento (barato); a reescala de marcadores, rótulos e rotas
  // roda no máximo uma vez por quadro (requestAnimationFrame), não a cada evento de roda/arrasto.
  _cuZoom = d3.zoom().scaleExtent([.6, 800])
    // Roda ~50% mais rápida que o padrão do d3 e mapa preso perto do Brasil (não some ao arrastar).
    .wheelDelta(e => -e.deltaY * (e.deltaMode === 1 ? .05 : e.deltaMode ? 1 : .003))
    .translateExtent([[-700, -700], [1700, 1700]])
    .on('start', () => _cuSvg.classed('movendo', true))
    .on('end', () => { _cuSvg.classed('movendo', false); _cuSvg.style('--sw', String(1 / CU.K)); _cuNavSalvar(); }) // largura das linhas: 1x no fim, não a cada quadro
    .on('zoom', e => { _cuG.attr('transform', e.transform); _cuCvAgenda(); if (Math.abs(e.transform.k - CU.K) > 1e-6) { CU.K = e.transform.k; if (!CU._raf) CU._raf = requestAnimationFrame(() => { CU._raf = 0; _cuRescale(); }); } });
  // Duplo clique no FUNDO aproxima 2× onde clicou (nos estados/pontos o clique já navega).
  _cuSvg.call(_cuZoom).on('dblclick.zoom', null).on('dblclick', e => { if (e.target !== _cuSvg.node()) return; e.preventDefault(); _cuSvg.transition().duration(300).call(_cuZoom.scaleBy, 2, d3.pointer(e)); });
  // Troca de tema com a aba aberta: as cores calculadas no desenho (tom dos estados, rotas) vêm das variáveis --mp-*.
  new MutationObserver(() => { if (CU.pares) { _cuDesenhar(); _cuLegenda(); } }).observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
  _cuGr.st.selectAll('path').data(CU.br.features).join('path').attr('class', 'st').attr('d', CU.path)
    .on('click', (e, f) => _cuClicaUf(CU_UFS[f.properties.codarea], e))
    .on('mousemove', (e, f) => {
      const uf = CU_UFS[f.properties.codarea], a = _cuAggUf(uf);
      _cuTip(e, `<b>${uf}</b><br><span class="mono">${a.n ? _cuBrlc(a.g) + ' · ' + a.d + ' alertas' : 'sem compras no período'}</span>`);
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
  _cuMalha(CU_IBGE + 'estados/' + cod + '?' + CU_GEOJSON + '&intrarregiao=municipio').then(g => {
    if (!g) return;
    CU.mun[uf] = { fc: _cuRewind(g), sel: _cuGr.mun.append('g').selectAll('path').data(g.features).join('path').attr('class', 'mn').attr('d', CU.path)
      // Eventos ligados uma vez; o mapa feição→centrais da regional atual fica em CU._munCen (_cuDesenhar).
      .on('mousemove', (e, f) => { const rg = CU._munReg?.get(f); if (rg) { const r = CU._regInfo?.get(rg); _cuTip(e, `<b>${_cuE(rg)}</b><br><span class="mono">${r ? _cuBrlc(r.s.g) + ' · ' + r.n + ' centra' + (r.n > 1 ? 'is' : 'l') + (r.s.d ? ' · ' + r.s.d + ' alertas' : '') : 'sem NF no período'}<br>clique para abrir a regional</span>`); return; } const cs = CU._munCen?.get(f); if (cs) _cuTip(e, cs.map(c => `<b>${_cuE(c.nome)}</b>`).join('<br>') + `<br><span class="mono">${cs.length > 1 ? 'clique para aproximar' : 'clique para abrir a central'}</span>`); })
      .on('mouseenter', (e, f) => _cuRealcaMun(f)).on('mouseleave', () => { _cuTipOff(); _cuRealceOff(); })
      .on('click', (e, f) => { const rg = CU._munReg?.get(f); if (rg) { _cuTipOff(); CU.F.reg = rg; CU.sel = { t: 'reg', reg: rg }; _cuUpdate(true); return; } const cs = CU._munCen?.get(f); if (!cs) return; _cuTipOff(); if (cs.length === 1) _cuAbreCentral(cs[0]); else _cuFit(CU.path.bounds(f)); }) };
    _cuDesenhar(); if (CU.F.cen) _cuFit(_cuBounds());
  }).catch(() => {}).finally(() => { CU.munCarregando[uf] = false; });
}
// Municípios (do conjunto) que dividem borda com outro do conjunto: a malha do IBGE é única, então
// vizinhos têm vértices idênticos. Cache pela lista de municípios (refeito só quando ela muda).
function _cuVizinhos(feats) {
  if (feats.length < 2) return new Set();
  const chave = feats.map(f => f.properties.codarea).sort().join(',');
  if (CU._vizK === chave) return CU._vizR;
  const dono = new Map(), viz = new Set();
  const anel = (r, i) => r.forEach(p => { const k = p[0] + ',' + p[1], o = dono.get(k); if (o === undefined) dono.set(k, i); else if (o !== i) { viz.add(feats[o]); viz.add(feats[i]); } });
  feats.forEach((f, i) => { const g = f.geometry; (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).forEach(poly => poly.forEach(r => anel(r, i))); });
  CU._vizK = chave; CU._vizR = viz;
  return viz;
}
// Município que contém o ponto, com cache (geoContains em ~850 municípios por central custava a cada desenho).
function _cuMunDoPonto(uf, ll) {
  if (!ll || !CU.mun[uf]) return undefined;
  const k = uf + '|' + ll[0] + '|' + ll[1], c = (CU._munPt || (CU._munPt = new Map()));
  if (!c.has(k)) c.set(k, CU.mun[uf].fc.features.find(f => d3.geoContains(f, ll)));
  return c.get(k);
}
function _cuBounds() {
  const F = CU.F;
  if (F.cen) {
    // Padrão: central + seus fornecedores (o conteúdo deste nível). "Ver só o município" aproxima.
    const c = CU.cen.get(F.cen), ll = _cuLL(c?.cnpj);
    const m = _cuMunDoPonto(_cuUfCen(c), ll);
    let b = m ? CU.path.bounds(m) : ll ? (p => [[p[0] - 1.2, p[1] - 1.2], [p[0] + 1.2, p[1] + 1.2]])(CU.proj(ll)) : null;
    if (b && !CU.soMun) {
      const pts = [...new Set(_cuNfsF().filter(n => n.cen === F.cen).map(n => n.forn))].map(_cuXY).filter(Boolean);
      if (pts.length) b = [[Math.min(b[0][0], ...pts.map(p => p[0] - 4)), Math.min(b[0][1], ...pts.map(p => p[1] - 4))], [Math.max(b[1][0], ...pts.map(p => p[0] + 4)), Math.max(b[1][1], ...pts.map(p => p[1] + 4))]];
    }
    if (b) return b;
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
function _cuFit(b, dur = 450) {
  if (!_cuSvg || !CU.W) return;
  const aberto = document.getElementById('cu-panel').classList.contains('open');
  const pw = aberto && innerWidth > 820 ? document.getElementById('cu-panel').offsetWidth + 20 : 0;
  const ph = aberto && innerWidth <= 820 ? CU.H * .62 : 0;
  const w = CU.W - pw, h = CU.H - ph, dx = b[1][0] - b[0][0] || 1, dy = b[1][1] - b[0][1] || 1;
  const k = Math.min(w / dx, h / dy) * .86;
  const t = d3.zoomIdentity.translate(w / 2 - k * (b[0][0] + b[1][0]) / 2, h / 2 - k * (b[0][1] + b[1][1]) / 2).scale(k);
  (dur ? _cuSvg.transition().duration(dur) : _cuSvg).call(_cuZoom.transform, t);
}
function _cuAlternaMunicipio() { CU.soMun = !CU.soMun; _cuCrumbs(); _cuFit(_cuBounds()); }
// Cores do MAPA (sempre claro, decisão do Hugo 23/11): variáveis --mp-* em #cu-mapwrap.
const _cuCssM = n => getComputedStyle(document.getElementById('cu-mapwrap')).getPropertyValue(n).trim();
function _cuHeat(ix) { const c = d3.color(_cuCssM(ix >= 0 ? '--mp-ruim' : '--mp-bom')) || d3.color('#888'); c.opacity = Math.min(.85, .15 + Math.abs(ix) / .12 * .7); return c + ''; }
function _cuRtCor(ix) { return _cuCssM(ix > .06 ? '--mp-ruim' : ix > .02 ? '--mp-medio' : ix < -.03 ? '--mp-bom' : '--mp-neutro'); }
// Sigla SAP da central para o rótulo do mapa: o alias (ex.: "VRE"); se vier no formato
// "36 | VRE | VOLTA REDONDA", a parte do meio. O nome completo fica no tooltip.
function _cuSigla(c) { const s = String(c.alias || c.nome || ''); const p = s.split('|').map(x => x.trim()).filter(Boolean); return p.length >= 2 ? p[1] : s; }
// Pontos (sem ícones, pedido do Hugo 26/11): central laranja, fornecedor cinza-azulado, foco ciano.
// Tamanho fixo na tela: raio em this._r, posição em this._xy (ver _cuRescale).
function _cuPontos(sel, tipo) { return sel.join(en => en.append('circle').attr('class', 'pt pt-' + tipo)); }
// Ligação das centrais da regional em foco: árvore geradora mínima (Prim), faixa larga translúcida.
function _cuArvore(pts) {
  const n = pts.length; if (n < 2) return [];
  const dentro = new Array(n).fill(false), dist = new Array(n).fill(Infinity), pai = new Array(n).fill(-1), arestas = [];
  dist[0] = 0;
  for (let it = 0; it < n; it++) {
    let u = -1; for (let i = 0; i < n; i++) if (!dentro[i] && (u < 0 || dist[i] < dist[u])) u = i;
    dentro[u] = true; if (pai[u] >= 0) arestas.push([pts[pai[u]], pts[u]]);
    for (let v = 0; v < n; v++) if (!dentro[v]) { const d = Math.hypot(pts[u][0] - pts[v][0], pts[u][1] - pts[v][1]); if (d < dist[v]) { dist[v] = d; pai[v] = u; } }
  }
  return arestas;
}

// O mapa revela um nível por clique, para não poluir:
//   Brasil   → só estados, pintados pelo gasto, selo de alertas no centro do estado;
//   Estado   → municípios das centrais em laranja, pontos com a SIGLA; clique abre a regional;
//   Regional → as centrais dela em ciano (municípios e pontos), ligadas por uma faixa; as demais
//              centrais do estado ficam apagadas, só para contexto (nome da regional só no tooltip);
//   Central  → rotas, fornecedores com compra e as alternativas em cinza.
// Fornecedor em foco (painel, comparador ou filtro) mostra as rotas dele em qualquer nível.
function _cuAbreCentral(c) { Object.assign(CU.F, { uf: _cuUfCen(c), reg: c.regional, cen: c.alias }); CU.sel = { t: 'cen', id: c.alias }; CU.tab = 'nfs'; _cuUpdate(true); }
function _cuAbreRegional(reg) { _cuTipOff(); CU.F.reg = reg; CU.F.cen = ''; CU.sel = { t: 'reg', reg }; _cuUpdate(true); }
// ── Realce no hover (26/11): o item sob o mouse e o que é dele ficam acesos; o resto esmaece. ──
function _cuRealceOff() { if (!_cuSvg) return; _cuSvg.classed('esmaece', false); _cuSvg.selectAll('.ativo').classed('ativo', false); }
function _cuRealca({ cens = new Set(), forns = new Set(), rota = null }) {
  if (!_cuSvg) return;
  // Rotas acesas: as de uma central acesa, as de um fornecedor aceso, ou só a rota sob o mouse.
  const rtOn = l => rota ? (l.c === rota.c && l.f === rota.f) : (cens.has(l.c) || forns.has(l.f));
  const fs = new Set(forns), cs = new Set(cens);
  _cuGr.rt.selectAll('path').each(l => { if (rtOn(l)) { fs.add(l.f); cs.add(l.c); } });
  const xys = new Set(), muns = new Set();
  cs.forEach(a => { const c = CU.cen.get(a); if (!c) return; if (c._xy) xys.add(c._xy); const m = _cuMunDoPonto(_cuUfCen(c), _cuLL(c.cnpj)); if (m) muns.add(m); });
  _cuSvg.classed('esmaece', true);
  _cuGr.c.selectAll('circle.pt').classed('ativo', c => cs.has(c.alias));
  _cuGr.f.selectAll('circle.pt').classed('ativo', fk => fs.has(fk));
  _cuGr.mun.selectAll('path.mn').classed('ativo', f => muns.has(f));
  // Arestas da triangulação: as que tocam a central acesa (ou ligam duas acesas).
  _cuGr.lig.selectAll('line.lig').classed('ativo', d => cs.size === 1 ? (xys.has(d[0]) || xys.has(d[1])) : (xys.has(d[0]) && xys.has(d[1])));
  _cuGr.rt.selectAll('path').classed('ativo', rtOn);
  _cuGr.l.selectAll('text').classed('ativo', d => d.forn && d.cen ? rtOn({ c: d.cen, f: d.forn }) : d.cen ? cs.has(d.cen) : d.forn ? fs.has(d.forn) : false);
}
function _cuRealcaMun(f) { const cs = [...CU.cen.values()].filter(c => _cuMunDoPonto(_cuUfCen(c), _cuLL(c.cnpj)) === f).map(c => c.alias); if (cs.length) _cuRealca({ cens: new Set(cs) }); }
function _cuNivel() { const F = CU.F; return F.cen ? 'cen' : F.reg ? 'reg' : F.uf ? 'uf' : 'br'; }
function _cuFornFoco() { const s = CU.sel; return s?.t === 'forn' ? new Set([s.id]) : s?.t === 'rota' ? new Set([s.forn]) : CU.F.forns.size ? CU.F.forns : null; }
function _cuDesenhar() {
  if (!_cuSvg) return;
  _cuRealceOff(); // redesenho troca as classes: não deixa o mapa esmaecido sem item aceso
  const F = CU.F, L = CU.L, sel = CU.sel, arr = _cuNfsF(), ref = _cuRef(arr), nivel = _cuNivel(), fornFoco = _cuFornFoco();
  const cenPos = new Map();
  CU.cen.forEach(c => { const xy = _cuXY(c.cnpj); if (xy) cenPos.set(c.alias, xy); });
  // Estado destacado = tem central (com UF), mesmo que ela ainda não tenha coordenada.
  const cenUfs = new Set([...CU.cen.values()].filter(c => cenPos.has(c.alias) || CU.cenComCompra?.has(c.alias)).map(_cuUfCen).filter(Boolean));
  const ufFoco = F.uf || (F.reg && _cuUfCen([...CU.cen.values()].find(c => c.regional === F.reg) || {}));
  // Nível Brasil: tom do estado pelo gasto no período (creme → laranja); calor troca pelo índice de preço.
  const porUf = !ufFoco ? _cuGroup(arr, n => _cuUfCen(CU.cen.get(n.cen))) : {};
  const gUf = Object.fromEntries(Object.entries(porUf).map(([u, a]) => [u, _cuAgg(a)]));
  const gUfMax = d3.max(Object.values(gUf), s => s.g) || 1;
  const tom = d3.interpolateRgb(_cuCssM('--mp-uf-min'), _cuCssM('--mp-uf-max'));
  // Estados com central mantêm o tom em todos os níveis; sem central ficam cinza (dim).
  _cuGr.st.selectAll('path').attr('class', f => { const uf = CU_UFS[f.properties.codarea]; return 'st' + (cenUfs.has(uf) ? ' has' : '') + (ufFoco && uf === ufFoco ? ' foco' : '') + (ufFoco && uf !== ufFoco && !cenUfs.has(uf) ? ' dim' : ''); })
    .style('fill', f => {
      if (ufFoco) return null;
      const uf = CU_UFS[f.properties.codarea], s = gUf[uf];
      if (!s) return null;
      return L.calor ? _cuHeat(_cuIdx(porUf[uf], ref)) : tom(Math.sqrt(s.g / gUfMax));
    });
  _cuGr.stl.style('display', ufFoco ? 'none' : null).selectAll('text').classed('has', f => cenUfs.has(CU_UFS[f.properties.codarea]));
  // ── Municípios: só os que têm central são desenhados ──
  //   Estado: todos em laranja (clicáveis → regional); Regional/Central: os da regional em ciano
  //   (clicáveis → central), os das outras regionais do estado apagados; o da central aberta, ciano forte.
  const naRegional = (nivel === 'reg' || nivel === 'cen') && F.reg;
  const munCen = new Map(); // feição → centrais da regional em foco
  CU._munCen = munCen;      // lido pelos eventos fixos dos municípios (_cuCarregarMun)
  const temReg = new Map(); // nível Estado: feição → regional (clique e tooltip)
  CU._munReg = nivel === 'uf' && !fornFoco ? temReg : null;
  const ufsReg = new Set();
  if (naRegional) [...CU.cen.values()].filter(c => c.regional === F.reg && _cuLL(c.cnpj)).forEach(c => {
    const uf = _cuUfCen(c); if (!uf) return;
    ufsReg.add(uf); _cuCarregarMun(uf);
    const f = _cuMunDoPonto(uf, _cuLL(c.cnpj)); if (f) (munCen.get(f) || munCen.set(f, []).get(f)).push(c);
  });
  if (ufFoco) _cuCarregarMun(ufFoco);
  const munSel = F.cen ? _cuMunDoPonto(_cuUfCen(CU.cen.get(F.cen) || {}), _cuLL(CU.cen.get(F.cen)?.cnpj)) : null;
  const comCentral = L.calor && ufFoco ? new Map() : null;
  if (comCentral) [...CU.cen.values()].filter(c => _cuUfCen(c) === ufFoco && _cuLL(c.cnpj)).forEach(c => { const mm = _cuMunDoPonto(ufFoco, _cuLL(c.cnpj)); if (mm) (comCentral.get(mm) || comCentral.set(mm, []).get(mm)).push(c.alias); });
  Object.entries(CU.mun).forEach(([uf, m]) => {
    const ativo = uf === ufFoco || ufsReg.has(uf);
    const temC = new Set();
    if (uf === ufFoco) [...CU.cen.values()].forEach(c => { if (_cuUfCen(c) === uf) { const mm = _cuMunDoPonto(uf, _cuLL(c.cnpj)); if (mm) { temC.add(mm); if (!temReg.has(mm)) temReg.set(mm, c.regional); } } });
    m.sel.style('display', f => ativo && (temC.has(f) || munCen.has(f) || f === munSel) ? null : 'none');
    // Contorno só onde dois municípios com central se encostam (separa os vizinhos; isolados ficam lisos).
    const viz = ativo ? _cuVizinhos([...new Set([...temC, ...munCen.keys(), munSel].filter(Boolean))]) : new Set();
    if (!ativo) return;
    m.sel.attr('class', f => 'mn' + (viz.has(f) ? ' viz' : '') + (munCen.has(f) ? ' foco hasc' : temC.has(f) ? (naRegional ? ' temc fora' : ' temc' + (CU._munReg ? ' hasc' : '')) : '') + (f === munSel ? ' sel' : ''))
      .style('stroke', null)
      .style('fill', f => { if (!comCentral || f === munSel) return null; const al = comCentral.get(f); if (!al) return null; const a = arr.filter(n => al.includes(n.cen)); return a.length ? _cuHeat(_cuIdx(a, ref)) : null; });
  });
  // rotas: só no nível da central, ou as do fornecedor em foco
  const base = nivel === 'cen' ? arr.filter(n => n.cen === F.cen) : fornFoco ? arr.filter(n => fornFoco.has(n.forn)) : [];
  const vis = Object.entries(_cuGroup(base, n => n.cen + '\u0001' + n.forn)).map(([k, a]) => { const [c, f] = k.split('\u0001'); const s = _cuAgg(a); return { c, f, a, s, ix: _cuIdx(a, ref), mats: [...s.mats] }; })
    .filter(l => cenPos.has(l.c) && _cuXY(l.f));
  const foco = l => sel && ((sel.t === 'forn' && l.f === sel.id) || (sel.t === 'rota' && l.c === sel.cen && l.f === sel.forn));
  const curva = l => { const a = cenPos.get(l.c), b = _cuXY(l.f), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1]; return `M${b[0]},${b[1]}Q${mx - dy * .18},${my + dx * .18} ${a[0]},${a[1]}`; };
  // Espessura da rota: pelo gasto (padrão) ou pelo FRETE POR KM (frete por unidade ÷ km estimados).
  vis.forEach(l => { const km = _cuKmPar(l.c, l.f); l.km = km; l.fkm = km ? l.s.fu / km : 0; l.val = L.esp === 'frete' ? l.fkm : l.s.g; });
  const vmax = d3.max(vis, l => l.val) || 1;
  _cuGr.rt.selectAll('path').data(vis, l => l.c + '|' + l.f).join('path').attr('d', curva)
    .attr('class', 'rt') // sem animação do tracejado: ela redesenhava o mapa inteiro a cada quadro
    .style('stroke', l => L.cor ? _cuRtCor(l.ix) : foco(l) ? _cuCssM('--mp-foco') : _cuCssM('--mp-rota'))
    .style('opacity', l => nivel === 'cen' && sel && (sel.t === 'forn' || sel.t === 'rota') ? (foco(l) ? 1 : .2) : .9)
    .each(l => { l.w = (foco(l) ? 1.4 : 1) + 3.2 * Math.sqrt(l.val / vmax); });
  _cuGr.hit.selectAll('path').data(vis, l => l.c + '|' + l.f).join('path').attr('class', 'rthit').attr('d', curva)
    .on('mousemove', (e, l) => { const km = _cuKmPar(l.c, l.f); _cuTip(e, `<b>${_cuE(_cuNomeF(l.f))}</b> → <b>${_cuE(_cuSigla(CU.cen.get(l.c)))}</b><br><span class="mono">${l.mats.map(_cuE).join(', ')}<br>${km ? _cuNf0.format(km) + ' km · ' : ''}${_cuBrlc(l.s.g)}${l.mats.length === 1 ? ' · ' + _cuP(l.mats[0], l.s.pm) : ''}<br>frete ${l.mats.length === 1 ? _cuP(l.mats[0], l.s.fu) : _cuBrlc(l.s.ge - l.s.g)}${l.fkm && l.mats.length === 1 ? ' · ' + _cuPn(l.mats[0], l.fkm) + '/' + _cuU(l.mats[0]) + '·km' : ''}<br>preço vs média: ${_cuPct(l.ix)}${l.s.d ? ` · ${l.s.d} alerta${l.s.d > 1 ? 's' : ''}` : ''}</span>`); })
    .on('mouseenter', (e, l) => _cuRealca({ rota: l })).on('mouseleave', () => { _cuTipOff(); _cuRealceOff(); })
    .on('click', (e, l) => { CU.sel = { t: 'rota', cen: l.c, forn: l.f }; CU.tab = 'nfs'; _cuUpdate(false); });
  // fornecedores: os das rotas visíveis + (nível central) alternativas em cinza
  const ativos = new Set(vis.map(l => l.f));
  const fl = [...ativos];
  if (fornFoco) fornFoco.forEach(fk => { if (!ativos.has(fk) && _cuXY(fk)) fl.push(fk); });
  // Central aberta: além dos que entregaram no período, só os que JÁ entregaram nesta central em algum
  // momento da base (em cinza). Não mostra todos os que vendem o mesmo material (Hugo, 26/11: poluía).
  if (nivel === 'cen') (CU.pares || []).forEach(p => { if (p.cen === F.cen && !ativos.has(p.forn) && !fl.includes(p.forn) && _cuXY(p.forn) && (!F.mats.size || F.mats.has(p.mat))) fl.push(p.forn); });
  // Raio de atendimento (central aberta): círculo de N km em LINHA RETA e os fornecedores dentro dele
  // que vendem algum material desta central, mesmo sem compra aqui (alternativas próximas).
  const llCen = nivel === 'cen' ? _cuLL(CU.cen.get(F.cen)?.cnpj) : null, noRaio = new Map();
  if (llCen && L.raio > 0) {
    const matsCen = new Set((CU.pares || []).filter(p => p.cen === F.cen).map(p => p.mat));
    const cand = new Set([...CU.fornMats.keys(), ...[...CU.geo.values()].filter(g => g.tipo === 'fornecedor').map(g => g.cnpj)]);
    cand.forEach(fk => {
      const ll = _cuLL(fk); if (!ll || fl.includes(fk)) return;
      const vende = !CU.fornMats.has(fk) || [...CU.fornMats.get(fk)].some(m => matsCen.has(m) && (!F.mats.size || F.mats.has(m)));
      const km = _cuKm(llCen, ll) / 1.3; // _cuKm já vem × 1,3 (estrada); o raio é linha reta
      if (vende && km <= L.raio) { noRaio.set(fk, km); fl.push(fk); }
    });
  }
  _cuGr.raio.selectAll('path').data(llCen && L.raio > 0 ? [d3.geoCircle().center(llCen).radius(L.raio / 111.2)()] : []).join('path').attr('class', 'raio').attr('d', CU.path);
  // Tooltip do fornecedor: soma uma vez por desenho (antes filtrava o recorte inteiro a cada movimento do mouse).
  const porFornArr = _cuGroup(arr, 'forn'), aggFornCache = new Map();
  const aggForn = fk => { let s = aggFornCache.get(fk); if (!s) aggFornCache.set(fk, s = _cuAgg(porFornArr[fk] || [])); return s; };
  const selF = fk => !!fornFoco?.has(fk) && (sel?.t === 'forn' || sel?.t === 'rota');
  // Alternativas (cinza) desenhadas primeiro: ficam por baixo dos fornecedores com compra.
  const flOrd = [...fl.filter(fk => !ativos.has(fk)), ...fl.filter(fk => ativos.has(fk))];
  _cuPontos(_cuGr.f.selectAll('circle.pt').data(flOrd, fk => fk), 'forn')
    .attr('class', fk => 'pt pt-forn' + (ativos.has(fk) ? '' : ' off') + (noRaio.has(fk) ? ' raio' : '') + (selF(fk) ? ' sel' : ''))
    .each(function (fk) { this._xy = _cuXY(fk); this._r = selF(fk) ? 6 : ativos.has(fk) ? 4.5 : 3.5; })
    .on('mousemove', (e, fk) => { const a = aggForn(fk), g = CU.geo.get(fk); _cuTip(e, `<b>${_cuE(_cuNomeF(fk))}</b><br><span class="mono">${_cuE((g?.municipio || '') + (g?.uf ? '/' + g.uf : ''))}<br>${a.n ? _cuBrlc(a.g) + ' no recorte' : noRaio.has(fk) ? 'no raio: ' + _cuNf0.format(noRaio.get(fk)) + ' km em linha reta · nunca entregou nesta central' : 'sem compra no período (já entregou nesta central)'}</span>`); })
    .on('mouseenter', (e, fk) => _cuRealca({ forns: new Set([fk]) })).on('mouseleave', () => { _cuTipOff(); _cuRealceOff(); })
    .on('click', (e, fk) => { CU.sel = { t: 'forn', id: fk }; CU.tab = 'nfs'; _cuUpdate(false); })
    .order();
  // ── Centrais ──
  const porCen = _cuGroup(arr, 'cen');
  let cs = [];
  if (nivel === 'uf' && !fornFoco) cs = [...CU.cen.values()].filter(c => cenPos.has(c.alias) && _cuUfCen(c) === ufFoco);
  else if (naRegional) cs = [...CU.cen.values()].filter(c => cenPos.has(c.alias) && (c.regional === F.reg || _cuUfCen(c) === ufFoco));
  else if (fornFoco) cs = [...CU.cen.values()].filter(c => cenPos.has(c.alias) && vis.some(l => l.c === c.alias));
  const cenSel = c => F.cen === c.alias || (sel?.t === 'cen' && sel.id === c.alias) || (sel?.t === 'rota' && sel.cen === c.alias) || (CU.cmpCen || []).includes(c.alias);
  cs.forEach(c => {
    // Com uma central aberta o recorte fica só nela: as outras da regional não viram "sem NF" (cinza) por isso.
    const a = _cuAgg(porCen[c.alias] || []); c._g = a.g; c._nd = a.d; c._sem = !porCen[c.alias] && nivel !== 'cen'; c._xy = cenPos.get(c.alias);
    c._foco = naRegional && c.regional === F.reg; c._fora = naRegional && !c._foco;
  });
  const gmax = d3.max(cs, c => c._g) || 1;
  cs.forEach(c => { c._rr = cenSel(c) ? 7 : c._fora ? 3.5 : L.calor && !c._sem ? 4 + 5 * Math.sqrt(c._g / gmax) : 5; });
  // Triangulação (Delaunay) das centrais da regional em foco: triângulos levemente preenchidos e
  // arestas como faixas. Com 2 centrais (ou todas alinhadas), cai na ligação simples (_cuArvore).
  const ptsF = cs.filter(c => c._foco).map(c => c._xy), tri = [];
  let arestas = [];
  if (naRegional && ptsF.length >= 3) {
    const dl = d3.Delaunay.from(ptsF), T = dl.triangles, H = dl.halfedges;
    for (let t = 0; t < T.length; t += 3) tri.push([ptsF[T[t]], ptsF[T[t + 1]], ptsF[T[t + 2]]]);
    for (let e = 0; e < T.length; e++) if (H[e] < e) arestas.push([ptsF[T[e]], ptsF[T[e % 3 === 2 ? e - 2 : e + 1]]]);
  }
  if (naRegional && !arestas.length) arestas = _cuArvore(ptsF);
  _cuGr.lig.selectAll('path.tri').data(tri).join('path').attr('class', 'tri').attr('d', t => 'M' + t.map(p => p.join(',')).join('L') + 'Z');
  _cuGr.lig.selectAll('line.lig').data(arestas).join('line').attr('class', 'lig')
    .attr('x1', d => d[0][0]).attr('y1', d => d[0][1]).attr('x2', d => d[1][0]).attr('y2', d => d[1][1]);
  // Desenha as apagadas primeiro (ficam por baixo das centrais da regional em foco).
  const csOrd = [...cs.filter(c => c._fora), ...cs.filter(c => !c._fora)];
  _cuPontos(_cuGr.c.selectAll('circle.pt').data(csOrd, c => c.alias), 'cen')
    .attr('class', c => 'pt pt-cen' + (c._sem ? ' off' : '') + (c._foco ? ' foco' : '') + (c._fora ? ' fora' : '') + (cenSel(c) ? ' sel' : ''))
    .each(function (c) { this._xy = c._xy; this._r = c._rr; })
    .on('mousemove', (e, c) => _cuTip(e, `<b>${_cuE(_cuSigla(c))}</b> · ${_cuE(c.nome)}<br><span class="mono">${_cuE(c.regional)}<br>${c._sem ? 'sem NF no período e filtros' : _cuBrlc(c._g)}${c._nd ? ` · ${c._nd} alerta${c._nd > 1 ? 's' : ''} de preço` : ''}<br>${nivel === 'uf' ? 'clique para abrir a regional' : 'clique para abrir a central'} · Ctrl+clique compara</span>`))
    .on('mouseenter', (e, c) => _cuRealca({ cens: new Set([c.alias]) })).on('mouseleave', () => { _cuTipOff(); _cuRealceOff(); })
    .on('click', (e, c) => (e.ctrlKey || e.metaKey) ? _cuComparaAdd(c) : nivel === 'uf' && !fornFoco ? _cuAbreRegional(c.regional) : _cuAbreCentral(c))
    .order();
  // Nível Estado: soma por regional para o tooltip do município (CU._regInfo, lido pelos eventos fixos).
  CU._regInfo = nivel === 'uf' && !fornFoco ? new Map(Object.entries(_cuGroup(arr, n => CU.cen.get(n.cen).regional)).map(([r, a]) => [r, { s: _cuAgg(a), n: new Set(a.map(x => x.cen)).size }])) : null;
  // selos de alerta: no centro do estado (Brasil) ou ao lado do ponto da central (não nas apagadas)
  const selosUf = nivel === 'br' && !fornFoco ? Object.entries(gUf).filter(([u, s]) => s.d > 0).map(([u, s]) => { const st = CU.br.features.find(f => CU_UFS[f.properties.codarea] === u); return st ? { id: 'uf' + u, _xy: CU.path.centroid(st), _nd: s.d, _rr: 7 } : null; }).filter(Boolean) : [];
  _cuGr.b.selectAll('g').data(L.selos ? [...selosUf, ...cs.filter(c => !c._fora)].filter(x => x._nd > 0) : [], x => x.id || x.alias)
    .join(en => { const g = en.append('g').attr('class', 'bdg'); g.append('circle'); g.append('text'); return g; })
    .each(function (x) { d3.select(this).select('text').text(x._nd > 999 ? '999+' : x._nd); });
  // rótulos (dx/dy em px de tela; só do que está visível)
  // Distância de cada rota no meio da curva (estimativa por estrada = linha reta × 1,3).
  const kmRotas = vis.length > 60 ? [] : vis.map(l => {
    const a = cenPos.get(l.c), b = _cuXY(l.f), km = _cuKmPar(l.c, l.f); if (!km) return null;
    const cx = (a[0] + b[0]) / 2 - (b[1] - a[1]) * .18, cy = (a[1] + b[1]) / 2 + (b[0] - a[0]) * .18;
    return { id: 'k' + l.c + '|' + l.f, cen: l.c, forn: l.f, x: .25 * b[0] + .5 * cx + .25 * a[0], y: .25 * b[1] + .5 * cy + .25 * a[1], t: '~' + _cuNf0.format(km) + ' km', cls: 'lbl km', dy: 4 };
  }).filter(Boolean);
  const lb = [
    ...kmRotas,
    // Sigla da central à direita do ponto (nas apagadas, só no tooltip).
    ...cs.filter(c => !c._fora).map(c => ({ id: 'c' + c.alias, cen: c.alias, x: c._xy[0], y: c._xy[1], t: _cuSigla(c), cls: 'lbl dir' + (c._foco ? ' foco' : ''), dx: c._rr + 4, dy: 4 })),
    ...fl.filter(fk => ativos.has(fk) || fornFoco?.has(fk)).map(fk => { const p = _cuXY(fk); return { id: 'f' + fk, forn: fk, x: p[0], y: p[1], t: _cuNomeF(fk), cls: 'lbl f' + (ativos.has(fk) ? '' : ' off'), dy: -10 }; }),
  ];
  _cuGr.l.selectAll('text').data(lb, d => d.id).join('text').attr('class', d => d.cls).text(d => d.t);
  _cuRescale();
}
function _cuRescale() {
  if (!_cuG) return;
  _cuReguaEscala();
  const k = CU.K;
  _cuGr.rt.selectAll('path').style('stroke-width', l => l.w / k).style('stroke-dasharray', CU.L.cor ? `${6 / k} ${5 / k}` : `${4 / k} ${3 / k}`);
  _cuGr.hit.selectAll('path').style('stroke-width', 10 / k);
  _cuGr.lig.selectAll('line.lig').style('stroke-width', 10 / k);
  // Pontos com tamanho fixo na tela (o zoom só muda a posição).
  [_cuGr.c, _cuGr.f].forEach(g => g.selectAll('circle.pt').each(function () { this.setAttribute('cx', this._xy[0]); this.setAttribute('cy', this._xy[1]); this.setAttribute('r', (this._r || 5) / k); this.style.strokeWidth = (1.6 / k) + 'px'; }));
  _cuGr.b.selectAll('g').each(function (x) { const o = (x._rr || 6) * .72 + 3, cx = x._xy[0] + o / k, cy = x._xy[1] - o / k; d3.select(this).select('circle').attr('cx', cx).attr('cy', cy).attr('r', (x._nd > 99 ? 9 : 7) / k).style('stroke-width', 1.2 / k); d3.select(this).select('text').attr('x', cx).attr('y', cy).style('font-size', ((x._nd > 99 ? 7.5 : 8.5) / k) + 'px'); });
  _cuGr.stl.selectAll('text').style('font-size', (14 / k) + 'px').style('display', k > 2.6 ? 'none' : null);
  _cuGr.l.selectAll('text').style('font-size', (11.5 / k) + 'px').attr('x', d => d.x + (d.dx || 0) / k).attr('y', d => d.y + d.dy / k).style('stroke-width', 3.5 / k);
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
  // (As regionais do estado ficam no mapa, pintadas, e no filtro Regional: sem fila de botões aqui.)
  if (F.cen) { const b = document.createElement('button'); b.type = 'button'; b.className = 'c'; b.textContent = CU.soMun ? 'Ver fornecedores' : 'Ver só o município'; b.onclick = _cuAlternaMunicipio; el.append(b); }
}
function _cuLegenda() {
  // Legenda e dica mudam com o nível: só explica o que está desenhado.
  const L = CU.L, nivel = _cuNivel(), rotas = nivel === 'cen' || !!_cuFornFoco();
  const dica = rotas ? 'Clique numa rota ou fornecedor para detalhar' : { br: 'Clique num estado para ver as regionais', uf: 'Clique numa regional para ver as centrais', reg: 'Clique numa central para ver os fornecedores' }[nivel];
  let h = `<div class="dica">${dica}</div><div class="lyr"><b>Camadas</b>
    ${rotas ? `<label><input type="checkbox" data-l="cor"${L.cor ? ' checked' : ''}> Rotas coloridas por preço</label>` : ''}
    <label><input type="checkbox" data-l="calor"${L.calor ? ' checked' : ''}> Mapa de calor</label>
    ${rotas ? `<label>Espessura <select data-l="esp" class="cu-leg-sel"><option value="gasto"${L.esp === 'gasto' ? ' selected' : ''}>gasto</option><option value="frete"${L.esp === 'frete' ? ' selected' : ''}>frete por km</option></select></label>` : ''}
    ${nivel === 'cen' ? `<label>Raio <select data-l="raio" class="cu-leg-sel">${[0, 50, 100, 200, 300].map(v => `<option value="${v}"${L.raio === v ? ' selected' : ''}>${v ? v + ' km' : 'desligado'}</option>`).join('')}</select></label>` : ''}</div>`;
  // Ponto da legenda (mesmo desenho do mapa).
  const ic = (tipo, cor) => `<i style="width:10px;height:10px;border-radius:50%;background:${cor};box-shadow:0 0 0 1.5px var(--mp-halo)"></i>`;
  if (nivel === 'br' && !rotas && !L.calor) h += `<div class="r"><i class="grad" style="width:60px;background:linear-gradient(90deg,var(--mp-uf-min),var(--mp-uf-max))"></i>Estado · tom = gasto no período</div>`;
  if (nivel === 'uf' && !rotas) h += `<div class="r">${ic('cen', 'var(--mp-cen)')}Central (sigla SAP) · clique abre a regional</div><div class="r"><i style="width:14px;height:10px;border-radius:2px;background:var(--mp-mun);border:1px solid var(--mp-mun-borda)"></i>Município com central</div>`;
  if (nivel === 'reg' || nivel === 'cen') h += `<div class="r">${ic('cen', 'var(--mp-foco)')}Central da regional (ligadas pela faixa)</div><div class="r">${ic('cen', 'var(--mp-cen-fora)')}Outras centrais do estado</div>`;
  else if (rotas) h += `<div class="r">${ic('cen', 'var(--mp-cen)')}Central</div>`;
  if (nivel === 'reg') h += `<div class="r"><i style="width:14px;height:10px;border-radius:2px;background:var(--mp-foco-mun);border:1px solid var(--mp-foco)"></i>Município da regional (clique para abrir)</div>`;
  if (rotas) {
    h += `<div class="r">${ic('forn', 'var(--mp-forn)')}Fornecedor com compra</div>`;
    if (nivel === 'cen') {
      h += `<div class="r">${ic('forn', 'var(--mp-forn-off)')}Já entregou nesta central, sem compra no período</div>`;
      if (L.raio) h += `<div class="r"><i style="width:10px;height:10px;border-radius:50%;background:var(--mp-forn-off);box-shadow:0 0 0 1.5px var(--mp-foco)"></i>No raio de ${L.raio} km, nunca entregou aqui</div>`;
      const fora = _cuForaDoMapa(_cuNfsF().filter(n => n.cen === CU.F.cen)).forns.length;
      if (fora) h += `<div class="r" style="color:var(--mp-medio)"><i class="ti ti-map-pin-off"></i>${fora} fornecedor${fora > 1 ? 'es' : ''} com compra sem localização · veja no Resumo</div>`;
    }
    h += L.cor ? `<div class="r"><i style="width:18px;height:3px;background:var(--mp-ruim)"></i>rota &gt; 6% acima da média</div><div class="r"><i style="width:18px;height:3px;background:var(--mp-medio)"></i>2 a 6% acima</div><div class="r"><i style="width:18px;height:3px;background:var(--mp-bom)"></i>abaixo da média</div><div class="r" style="color:var(--mp-txt2)">espessura = ${L.esp === 'frete' ? 'frete por km' : 'gasto'}</div>`
      : `<div class="r"><i style="width:18px;border-top:2px dashed var(--mp-rota)"></i>Fornecimento no período</div>`;
  }
  if (L.calor) h += `<div class="r"><i class="grad" style="background:linear-gradient(90deg,var(--mp-bom),var(--mp-chip) 50%,var(--mp-ruim))"></i></div><div class="r" style="justify-content:space-between;width:120px;color:var(--mp-txt2)"><span>−12%</span><span>média</span><span>+12%</span></div>`;
  // Recolhida por padrão (atrapalhava a visão do mapa); a escolha fica guardada no navegador.
  if (CU.legAberta === undefined) { try { CU.legAberta = localStorage.getItem('custos.legenda') === '1'; } catch (_) { CU.legAberta = false; } }
  const el = document.getElementById('cu-legend');
  const fora = nivel === 'cen' ? _cuForaDoMapa(_cuNfsF().filter(n => n.cen === CU.F.cen)).forns.length : 0;
  el.classList.toggle('fechada', !CU.legAberta);
  el.innerHTML = CU.legAberta
    ? `<div class="cu-leg-top"><b>Legenda e camadas</b><button type="button" class="cu-leg-tg" title="Recolher a legenda">−</button></div>${h}`
    : `<button type="button" class="cu-leg-tg cu-leg-btn" title="${_cuE(dica)}"><i class="ti ti-list-details"></i> Legenda${fora ? ` <span class="cu-leg-aviso" title="${fora} fornecedor(es) com compra sem localização">${fora} fora do mapa</span>` : ''}</button>`;
  el.querySelector('.cu-leg-tg').onclick = () => { CU.legAberta = !CU.legAberta; try { localStorage.setItem('custos.legenda', CU.legAberta ? '1' : '0'); } catch (_) { /* sem storage */ } _cuLegenda(); };
  el.querySelectorAll('[data-l]').forEach(i => i.onchange = () => { CU.L[i.dataset.l] = i.type === 'checkbox' ? i.checked : i.dataset.l === 'raio' ? +i.value : i.value; _cuUpdate(false); });
}
// Seleção múltipla com busca (Regional, Central, Material, Fornecedor). O conjunto é o
// próprio filtro em CU.F; onChange recebe o conjunto já alterado.
function _cuMulti(id, opts, set, todos, onChange) {
  const host = document.getElementById(id);
  if (!host._ok) {
    host._ok = true;
    host.innerHTML = `<button type="button" class="form-select cu-ms-btn"></button><div class="cu-ms-pop" hidden><input class="form-input cu-ms-busca" placeholder="Buscar"><div class="cu-ms-acoes"><button type="button" data-a="vis">Marcar os visíveis</button><button type="button" data-a="limpar">Limpar</button></div><div class="cu-ms-lista"></div></div>`;
    const pop = host.querySelector('.cu-ms-pop'), busca = host.querySelector('.cu-ms-busca');
    host.querySelector('.cu-ms-btn').onclick = () => {
      const abrir = pop.hidden;
      document.querySelectorAll('.cu-ms-pop').forEach(p => { p.hidden = true; });
      if (abrir) { pop.hidden = false; busca.value = ''; _cuMultiLista(host); busca.focus(); }
    };
    busca.oninput = () => _cuMultiLista(host);
    host.querySelector('.cu-ms-lista').onchange = e => { const v = e.target.dataset.v; if (v == null) return; e.target.checked ? host._set.add(v) : host._set.delete(v); host._onChange(host._set); };
    host.querySelector('[data-a="vis"]').onclick = () => { host._visiveis.forEach(v => host._set.add(v)); host._onChange(host._set); };
    host.querySelector('[data-a="limpar"]').onclick = () => { host._set.clear(); host._onChange(host._set); };
  }
  // Itens marcados que saíram da lista (ex.: trocou o período) continuam visíveis para desmarcar.
  const tem = new Set(opts.map(o => o[0]));
  host._opts = [...opts, ...[...set].filter(v => !tem.has(v)).map(v => [v, (id === 'cu-f-forn' ? _cuNomeF(v) : CU.cen.get(v)?.nome || v) + ' (sem NF no período)'])];
  host._set = set; host._onChange = onChange;
  const sel = host._opts.filter(o => set.has(o[0]));
  const btn = host.querySelector('.cu-ms-btn');
  btn.textContent = !set.size ? todos : set.size === 1 ? (sel[0]?.[1] || [...set][0]) : `${set.size} selecionados`;
  btn.title = sel.map(o => o[1]).join('\n');
  host.classList.toggle('on', set.size > 0);
  if (!host.querySelector('.cu-ms-pop').hidden) _cuMultiLista(host);
}
function _cuMultiLista(host) {
  const q = _cuNomeNorm(host.querySelector('.cu-ms-busca').value), lista = host.querySelector('.cu-ms-lista');
  const vis = host._opts.filter(([v, t]) => !q || _cuNomeNorm(t + ' ' + v).includes(q));
  host._visiveis = vis.map(o => o[0]);
  // Marcados primeiro; ponytail: lista corta em 400 itens (a busca acha o resto).
  const ord = [...vis.filter(o => host._set.has(o[0])), ...vis.filter(o => !host._set.has(o[0]))].slice(0, 400);
  const top = lista.scrollTop;
  lista.innerHTML = ord.length ? ord.map(([v, t]) => `<label><input type="checkbox" data-v="${_cuE(v)}"${host._set.has(v) ? ' checked' : ''}> <span>${_cuE(t)}</span></label>`).join('') + (vis.length > 400 ? `<div class="cu-ms-mais">+ ${vis.length - 400}: refine a busca</div>` : '') : '<div class="cu-ms-mais">Nada encontrado</div>';
  lista.scrollTop = top;
}
function _cuFiltros() {
  const F = CU.F, per = _cuPeriodo();
  const cens = [...new Set(per.map(n => n.cen))].map(a => CU.cen.get(a));
  _cuMulti('cu-f-reg', [...new Set(cens.map(c => c.regional))].sort().map(r => [r, r]), F.regs, 'Todas', s => {
    // Uma regional: o mapa vai até ela. Várias: volta ao Brasil mostrando só as marcadas.
    const r = s.size === 1 ? [...s][0] : '', c = r && [...CU.cen.values()].find(x => x.regional === r);
    Object.assign(F, { reg: r, cen: '', uf: c ? _cuUfCen(c) : '' }); F.cens = new Set();
    CU.sel = r ? { t: 'reg', reg: r } : null; _cuNavFeita(); _cuUpdate(true);
  });
  _cuMulti('cu-f-cen', cens.filter(c => !F.regs.size || F.regs.has(c.regional)).sort((a, b) => a.nome.localeCompare(b.nome)).map(c => [c.alias, c.nome]), F.cens, 'Todas', s => {
    // Uma central: abre. Várias da mesma regional: vai à regional. Várias regionais: Brasil.
    const cs = [...s].map(a => CU.cen.get(a)).filter(Boolean), regs = [...new Set(cs.map(c => c.regional))];
    if (cs.length === 1) { Object.assign(F, { uf: _cuUfCen(cs[0]), reg: cs[0].regional, cen: cs[0].alias }); CU.sel = { t: 'cen', id: cs[0].alias }; }
    else if (regs.length === 1) { Object.assign(F, { uf: _cuUfCen(cs[0]), reg: regs[0], cen: '' }); CU.sel = { t: 'reg', reg: regs[0] }; }
    else { Object.assign(F, { uf: '', reg: '', cen: '' }); CU.sel = null; }
    _cuNavFeita(); _cuUpdate(true);
  });
  _cuMulti('cu-f-mat', [...new Set(per.map(n => n.mat))].sort().map(m => [m, m]), F.mats, 'Todos', () => _cuUpdate(false));
  _cuMulti('cu-f-forn', [...new Set(per.filter(n => !F.mats.size || F.mats.has(n.mat)).map(n => n.forn))].map(fk => [fk, _cuNomeF(fk)]).sort((a, b) => a[1].localeCompare(b[1])), F.forns, 'Todos', s => {
    CU.sel = s.size === 1 ? { t: 'forn', id: [...s][0] } : (CU.sel?.t === 'forn' || CU.sel?.t === 'rota' ? null : CU.sel); _cuUpdate(false);
  });
  document.getElementById('cu-f-div').checked = F.div;
  const lbl = document.getElementById('cu-month-label'); if (lbl) lbl.textContent = _cuPerTxt() || 'Selecionar mês';
}
// O filtro já acertou a navegação: registra para _cuSync não sobrescrever os conjuntos.
function _cuNavFeita() { const F = CU.F; CU._navAnt = F.uf + '|' + F.reg + '|' + F.cen; }
// Seletor de meses: clique marca/desmarca; Shift+clique marca o intervalo; atalhos.
function _cuMesGrid() {
  const y = CU.viewAno, temDados = CU.meses || new Set(), sel = new Set(CU.mesesSel || []);
  document.getElementById('cu-month-inner').innerHTML = `<div class="cal-header"><button class="cal-nav-btn" type="button" data-cuano="-1"><i class="ti ti-chevron-left"></i></button><span class="cal-header-center" style="cursor:default">${y}</span><button class="cal-nav-btn" type="button" data-cuano="1"><i class="ti ti-chevron-right"></i></button></div>
    <div class="cal-month-grid">${CU_MESES.map((n, i) => { const ym = y * 100 + i + 1; return `<button class="cal-grid-item${sel.has(ym) ? ' active' : ''}" type="button" data-cumes="${ym}" style="${temDados.has(ym) ? '' : 'opacity:.45'}">${n}</button>`; }).join('')}</div>
    <div class="cu-mes-atalhos"><button type="button" data-cuat="1">Último mês</button><button type="button" data-cuat="3">Últimos 3</button><button type="button" data-cuat="ano">Ano ${y}</button></div>
    <div class="cu-mes-dica">Clique marca ou desmarca · Shift+clique marca o intervalo</div>`;
  document.querySelectorAll('#cu-month-inner [data-cuano]').forEach(b => b.onclick = e => { e.stopPropagation(); CU.viewAno += +b.dataset.cuano; _cuMesGrid(); });
  document.querySelectorAll('#cu-month-inner [data-cumes]').forEach(b => b.onclick = e => {
    const ym = +b.dataset.cumes, s = new Set(CU.mesesSel || []);
    if (e.shiftKey && CU._mesAnc) {
      const idx = v => Math.floor(v / 100) * 12 + v % 100 - 1, [a, z] = [idx(CU._mesAnc), idx(ym)].sort((p, q) => p - q);
      for (let k = a; k <= z; k++) s.add(Math.floor(k / 12) * 100 + k % 12 + 1);
    } else if (s.has(ym)) { if (s.size > 1) s.delete(ym); } else s.add(ym);
    CU._mesAnc = ym; _cuSetMeses([...s]);
  });
  document.querySelectorAll('#cu-month-inner [data-cuat]').forEach(b => b.onclick = () => {
    const ms = [...(CU.meses || [])].sort((p, q) => p - q), at = b.dataset.cuat;
    _cuSetMeses(at === 'ano' ? ms.filter(ym => Math.floor(ym / 100) === y) : ms.slice(-(+at)));
  });
}
function _cuSetMeses(lista) {
  if (!lista.length) return;
  CU.mesesSel = [...new Set(lista)].sort((p, q) => p - q); CU.mes = CU.mesesSel[CU.mesesSel.length - 1];
  _cuMesGrid(); _cuUpdate(false);
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
    // Ordena e compara pelo custo ENTREGUE (NF + frete).
    // km: até a central escolhida; sem central, média das rotas ponderada pelo volume.
    const kmDe = (f, a) => { if (CU.F.cen) return _cuKmPar(CU.F.cen, f); let s = 0, w = 0; a.forEach(n => { const k = _cuKmPar(n.cen, f); if (k) { s += k * n.qtd; w += n.qtd; } }); return w ? s / w : null; };
    const rows = Object.entries(_cuGroup(am, 'forn')).map(([f, a]) => ({ f, a, s: _cuAgg(a), km: kmDe(f, a) })).sort((a, b) => a.s.pe - b.s.pe);
    const best = rows[0]?.s.pe;
    // NF + frete e alertas numa 2ª linha sob o nome: a gaveta tem 420 px.
    const det = r => [`NF ${_cuPn(m, r.s.pm)} + frete ${_cuPn(m, r.s.fu)} (${_cuFonteFrete(r.a)})`, r.s.d ? `<span class="cu-worse">${r.s.d} alerta${r.s.d > 1 ? 's' : ''} NF</span>` : '', r.s.dc ? `<span class="cu-worse">${r.s.dc} CTe</span>` : ''].filter(Boolean).join(' · ');
    return `<div class="cu-sec"><h3>${_cuE(m)}</h3><div style="overflow-x:auto"><table><thead><tr><th>Fornecedor</th><th class="n" title="Custo entregue = preço da NF + frete">Entregue</th><th class="n" title="Diferença para o melhor custo entregue">Dif.</th><th class="n" title="${CU.F.cen ? 'Distância estimada até a central' : 'Distância média das rotas, ponderada pelo volume'}">km</th><th class="n">Vol.</th><th></th></tr></thead><tbody>${
      rows.map((r, i) => `<tr class="cl" data-forn="${_cuE(r.f)}"><td>${_cuE(_cuNomeF(r.f))}<br><span style="font-size:11px;color:var(--text3)">${det(r)}</span></td><td class="n">${_cuPn(m, r.s.pe)}</td><td class="n ${i ? 'cu-worse' : 'cu-best'}">${i ? _cuPct(r.s.pe / best - 1) : 'melhor'}</td><td class="n">${r.km ? _cuNf0.format(r.km) : '–'}</td><td class="n">${_cuNf0.format(r.s.q / tq * 100)}%</td><td>${_cuComBtn(r.f, m, esc, '', `${_cuNomeF(r.f)} · ${m} · ${_cuEscopoNome(esc)}`, true)}</td></tr>`).join('')}</tbody></table></div></div>`;
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
// Endereço completo + CEP (BrasilAPI, guardado em custos_geo).
function _cuEndereco(cnpj) {
  const g = cnpj && CU.geo.get(cnpj);
  if (!g || (!g.logradouro && !g.municipio)) return '';
  const rua = [g.logradouro, g.numero].filter(Boolean).join(', ') + (g.bairro ? ' – ' + g.bairro : '');
  const cep = g.cep ? 'CEP ' + String(g.cep).replace(/^(\d{5})(\d{3})$/, '$1-$2') : '';
  return [rua, g.municipio && `${g.municipio}/${g.uf}`, cep].filter(Boolean).join(' · ');
}
/* ───────── aba Frete (fornecedor ou rota): cadastro por regional/central ───────── */
function _cuFretePainel(s) {
  const fk = s.t === 'rota' ? s.forn : s.id;
  const pares = (CU.pares || []).filter(p => p.forn === fk);
  const cens = [...new Set(pares.map(p => p.cen))].map(a => CU.cen.get(a)).filter(Boolean);
  const regs = [...new Set(cens.map(c => c.regional))].sort();
  const mats = [...new Set(pares.map(p => p.mat))].sort();
  const regPadrao = s.t === 'rota' ? CU.cen.get(s.cen)?.regional : regs[0];
  const hoje = new Date(), dHoje = hoje.getFullYear() * 10000 + (hoje.getMonth() + 1) * 100 + hoje.getDate();
  const unid = m => m ? _cuU(m) : mats.every(x => _cuU(x) === 'kg') ? 'kg' : 't';
  // Situação vigente hoje por regional (e por central atendida, quando houver valor próprio).
  const linhas = regs.map(r => {
    const cr = cens.filter(c => c.regional === r);
    const vig = _cuFreteCad(fk, null, cr[0]?.alias, dHoje);
    const porCen = cr.map(c => ({ c, v: _cuFreteCad(fk, null, c.alias, dHoje) })).filter(x => x.v && x.v.central);
    const txt = v => v ? `${CU_MODAL[v.modalidade]}${v.modalidade === 'cif' ? '' : v.valor != null ? ' · R$ ' + _cuNf2.format(v.valor) + '/' + unid(v.material) : ' · sem custo'}${v.material ? ' · ' + _cuE(v.material) : ''} <span class="cu-semloc">desde ${v.vigencia.split('-').reverse().join('/')}</span>` : '<span class="cu-worse">sem frete cadastrado</span>';
    return `<tr><td><b>${_cuE(r)}</b>${porCen.map(x => `<br><span class="cu-semloc">↳ ${_cuE(x.c.nome)}</span>`).join('')}</td><td>${vig && !vig.central ? txt(vig) : txt(null)}${porCen.map(x => `<br>${txt(x.v)}`).join('')}</td></tr>`;
  }).join('');
  const hist = (CU.frete || []).filter(r => r.fornecedor === fk).sort((a, b) => a.regional.localeCompare(b.regional) || (a.central || '').localeCompare(b.central || '') || b.vigencia.localeCompare(a.vigencia));
  const opt = (v, t, sel) => `<option value="${_cuE(v)}"${v === sel ? ' selected' : ''}>${_cuE(t)}</option>`;
  const cenOpts = r => cens.filter(c => c.regional === r).map(c => opt(c.alias, c.nome, s.t === 'rota' ? s.cen : '')).join('');
  return `<div class="cu-note">Frete que entra no <b>custo entregue</b> quando a NF não traz o CTe real. CIF soma zero; CTe soma o valor; transporte próprio soma o valor, se houver. Se a NF trouxer o frete real e ele diferir do cadastrado, vira alerta de CTe.</div>
    <div class="cu-sec"><h3>Vigente hoje, por região atendida</h3><div style="overflow-x:auto"><table><thead><tr><th>Regional</th><th>Frete</th></tr></thead><tbody>${linhas || '<tr><td colspan="2">Sem compras na base.</td></tr>'}</tbody></table></div></div>
    <div class="cu-sec"><h3>Cadastrar frete</h3><form class="cu-fr-form" id="cu-fr-form">
      <label>Regional<select class="form-select" id="cu-fr-reg">${regs.map(r => opt(r, r, regPadrao)).join('')}</select></label>
      <label>Central<select class="form-select" id="cu-fr-cen"><option value="">Toda a regional</option>${cenOpts(regPadrao)}</select></label>
      <label>Material<select class="form-select" id="cu-fr-mat"><option value="">Todos</option>${mats.map(m => opt(m, m, '')).join('')}</select></label>
      <label>Modalidade<select class="form-select" id="cu-fr-mod">${Object.entries(CU_MODAL).map(([k, t]) => opt(k, t, 'cte')).join('')}</select></label>
      <label><span>Valor (<span id="cu-fr-un">R$/${unid('')}</span>)</span><input class="form-input" id="cu-fr-val" type="number" min="0" step="0.0001" inputmode="decimal" placeholder="0,00"></label>
      <label>Vale a partir de<input class="form-input" id="cu-fr-vig" type="date" value="${hoje.toISOString().slice(0, 10)}"></label>
      <label class="larga">Observação<input class="form-input" id="cu-fr-obs" placeholder="nº do contrato, tabela, combinado com…"></label>
      <div class="larga cu-mact"><button type="submit" class="cu-btn cu-pri">Salvar frete</button></div>
    </form></div>
    <div class="cu-sec"><h3>Histórico</h3>${hist.length ? `<div style="overflow-x:auto"><table><thead><tr><th>Região</th><th>Frete</th><th>Vigência</th><th></th></tr></thead><tbody>${hist.map(r => `<tr><td>${_cuE(r.regional)}${r.central ? `<br><span class="cu-semloc">${_cuE(CU.cen.get(r.central)?.nome || r.central)}</span>` : ''}${r.material ? `<br><span class="cu-semloc">${_cuE(r.material)}</span>` : ''}</td><td>${CU_MODAL[r.modalidade]}${r.modalidade === 'cif' ? '' : r.valor != null ? '<br>R$ ' + _cuNf2.format(r.valor) + '/' + unid(r.material) : '<br>sem custo'}${r.obs ? `<br><span class="cu-semloc">${_cuE(r.obs)}</span>` : ''}</td><td class="n">${r.vigencia.split('-').reverse().join('/')}<br><span class="cu-semloc">${_cuE(r.autor_nome || '')}</span></td><td><button type="button" class="cu-cbtn" data-frdel="${r.id}">Apagar</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="cu-note">Nenhum frete cadastrado para este fornecedor.</div>'}</div>`;
}
function _cuFreteLigar(el, s) {
  const fk = s.t === 'rota' ? s.forn : s.id, $ = id => el.querySelector('#' + id);
  const form = $('cu-fr-form'); if (!form) return;
  const ajusta = () => {
    const mod = $('cu-fr-mod').value, m = $('cu-fr-mat').value;
    $('cu-fr-val').disabled = mod === 'cif'; if (mod === 'cif') $('cu-fr-val').value = '';
    $('cu-fr-un').textContent = 'R$/' + (m ? _cuU(m) : 't');
  };
  $('cu-fr-reg').onchange = () => {
    const r = $('cu-fr-reg').value, cs = [...new Set((CU.pares || []).filter(p => p.forn === fk).map(p => p.cen))].map(a => CU.cen.get(a)).filter(c => c && c.regional === r);
    $('cu-fr-cen').innerHTML = '<option value="">Toda a regional</option>' + cs.map(c => `<option value="${_cuE(c.alias)}">${_cuE(c.nome)}</option>`).join('');
  };
  $('cu-fr-mod').onchange = ajusta; $('cu-fr-mat').onchange = ajusta; ajusta();
  form.onsubmit = async e => {
    e.preventDefault();
    const mod = $('cu-fr-mod').value, v = $('cu-fr-val').value;
    if (mod === 'cte' && v === '') { toast('Informe o valor do CTe por unidade.', 'error'); $('cu-fr-val').focus(); return; }
    const row = { fornecedor: fk, regional: $('cu-fr-reg').value, central: $('cu-fr-cen').value || null, material: $('cu-fr-mat').value || null, modalidade: mod,
      valor: mod === 'cif' || v === '' ? null : num(v), vigencia: $('cu-fr-vig').value, obs: $('cu-fr-obs').value.trim() || null,
      autor_nome: typeof _ocNomeAtor === 'function' ? _ocNomeAtor() : (window.currentUser?.name || null) };
    if (!row.regional || !row.vigencia) { toast('Escolha a regional e a data de vigência.', 'error'); return; }
    const { error } = await window.supabaseClient.from('custos_frete').insert(row);
    if (error) { toast('Não foi possível salvar o frete: ' + error.message, 'error'); return; }
    toast('Frete salvo.'); await _cuRecarregarFrete();
  };
  el.querySelectorAll('[data-frdel]').forEach(b => b.onclick = async () => {
    if (b.dataset.conf !== '1') { b.dataset.conf = '1'; b.textContent = 'Confirmar'; return; }
    const { error } = await window.supabaseClient.from('custos_frete').delete().eq('id', b.dataset.frdel);
    if (error) { toast('Não foi possível apagar: ' + error.message, 'error'); return; }
    await _cuRecarregarFrete();
  });
}
// De onde veio o frete de um grupo de NFs (texto curto).
function _cuFonteFrete(arr) {
  const f = new Set(arr.map(n => n.freteFonte));
  if (f.size > 1) return 'misto';
  const x = [...f][0];
  return x === 'nf' ? 'CTe da NF' : x === 'cif' ? 'CIF' : x === 'cte' ? 'CTe cadastrado' : x === 'proprio' ? 'transp. próprio' : 'frete não cadastrado';
}
const CU_ALERTA_CTE = { acima: 'Acima dos últimos 5 CTe', abaixo: 'Abaixo dos últimos 5 CTe' };
function _cuListaCte(arr) {
  const d = arr.filter(n => n.isCte).sort((a, b) => b.d - a.d);
  const comFrete = arr.filter(n => n.fr > 0).length;
  if (!d.length) return `<div class="cu-note">Nenhum alerta de CTe neste recorte.${comFrete ? '' : ' Nenhuma NF do recorte traz frete nas Entradas (coluna TOTAL FRETE): reimporte as Entradas para ter o CTe real.'}</div>`;
  const ac = d.filter(n => n.alertaCte === 'acima').length, ab = d.filter(n => n.alertaCte === 'abaixo').length, dv = d.filter(n => n.divCte).length, tot = d3.sum(d.filter(n => n.cteDif > 0), n => n.cteDif);
  return `<div class="cu-note">Alerta quando o frete da NF (CTe real, por unidade) fica acima ou abaixo de todos os últimos 5 CTe do mesmo fornecedor, material e central, ou quando difere do frete cadastrado para a região.<br><b>${ac}</b> acima · <b>${ab}</b> abaixo · <b>${dv}</b> divergente do cadastro · pago acima: <b>${_cuBrl(tot)}</b></div>` +
    d.slice(0, 80).map(n => {
      const ref = n.alertaCte ? (n.alertaCte === 'acima' ? n.cMax : n.cMin) : n.cteEsperado;
      const pills = (n.alertaCte ? `<span class="cu-pill ${n.alertaCte === 'acima' ? 'up' : 'dn'}">${CU_ALERTA_CTE[n.alertaCte]}</span> ` : '') + (n.divCte ? `<span class="cu-pill nv">Divergente do cadastro</span>` : '');
      const faixa = n.alertaCte ? ` · últimos ${n.cBase}: ${n.cMin === n.cMax ? _cuP(n.mat, n.cMin) : _cuPn(n.mat, n.cMin) + ' a ' + _cuP(n.mat, n.cMax)}` : '';
      const cad = n.divCte ? ` · cadastro: ${CU_MODAL[n.cad.modalidade]}${n.cad.modalidade === 'cif' ? '' : ' ' + _cuP(n.mat, n.cteEsperado)}` : '';
      return `<div class="cu-nf ${n.cteDif > 0 ? 'acima' : 'abaixo'}"><span><b>NF ${_cuE(n.nf)}</b> · ${_cuDataNf(n.d)} ${pills}<br><span class="m">${_cuE(_cuNomeF(n.forn))} → ${_cuE(CU.cen.get(n.cen).nome)}<br>${_cuE(n.mat)} · ${_cuQ(n.mat, n.qtd)} · frete ${_cuBrl(n.fr)} = ${_cuP(n.mat, n.frUn)}${faixa}${cad}</span></span><span class="d">${ref ? `<span class="cu-pill ${n.cteDif > 0 ? 'up' : 'dn'}">${_cuPct(n.frUn / ref - 1)}</span><br>` : ''}${n.cteDif > 0 ? '+' : ''}${_cuBrl(n.cteDif || 0)}<br>${_cuComBtn(n.forn, n.mat, n.cen, 'cte:' + n.nf, `CTe da NF ${n.nf} · ${_cuNomeF(n.forn)} → ${CU.cen.get(n.cen).nome}`)}</span></div>`;
    }).join('') + (d.length > 80 ? `<div class="cu-note">+ ${d.length - 80} — filtre por central ou fornecedor para ver todas.</div>` : '');
}
function _cuForaDoMapa(arr) {
  return { cens: [...new Set(arr.map(n => n.cen))].map(a => CU.cen.get(a)).filter(c => !_cuLL(c.cnpj)), forns: [...new Set(arr.map(n => n.forn))].filter(fk => !_cuLL(fk)) };
}
function _cuSemLocal(arr) {
  const { cens, forns } = _cuForaDoMapa(arr);
  if (!cens.length && !forns.length) return '';
  const motivo = fk => !/^\d{14}$/.test(fk) ? 'sem CNPJ' : CU.geo.get(fk)?.precisao === 'falhou' ? 'endereço não encontrado' : 'buscando';
  return `<div class="cu-sec"><h3>Fora do mapa (sem localização)</h3><div class="cu-note">${cens.length ? `<b>Centrais:</b> ${cens.map(c => _cuE(c.nome) + (c.cnpj ? '' : ' (sem CNPJ no cadastro)')).join(', ')}<br>` : ''}${forns.length ? `<b>Fornecedores:</b> ${forns.slice(0, 40).map(fk => _cuE(_cuNomeF(fk)) + ` (${motivo(fk)})`).join(', ')}${forns.length > 40 ? ` e mais ${forns.length - 40}` : ''}<br>Sem CNPJ: reimporte as Entradas com a coluna CNPJ FORNECEDOR ou cadastre o fornecedor nas Cobranças.` : ''}</div></div>`;
}
/* ───────── comparar duas centrais (Ctrl+clique) ───────── */
function _cuComparaAdd(c) {
  _cuTipOff();
  const l = (CU.cmpCen || []).filter(a => a !== c.alias); l.push(c.alias); CU.cmpCen = l.slice(-2);
  if (CU.cmpCen.length < 2) { toast(`${_cuSigla(c)} marcada. Ctrl+clique em outra central para comparar.`); _cuDesenhar(); return; }
  CU.sel = { t: 'cmp', a: CU.cmpCen[0], b: CU.cmpCen[1] }; _cuUpdate(false);
}
// NFs de uma central no período, com os filtros de material/fornecedor/alerta (sem a navegação do mapa).
function _cuNfsDe(alias) { const F = CU.F; return _cuPeriodo().filter(n => n.cen === alias && (!F.mats.size || F.mats.has(n.mat)) && (!F.forns.size || F.forns.has(n.forn)) && (!F.div || n.isDiv)); }
function _cuComparaHtml(s) {
  const A = CU.cen.get(s.a), B = CU.cen.get(s.b), na = _cuNfsDe(s.a), nb = _cuNfsDe(s.b), a = _cuAgg(na), b = _cuAgg(nb);
  const kmMed = (arr, al) => { let x = 0, w = 0; arr.forEach(n => { const k = _cuKmPar(al, n.forn); if (k) { x += k * n.qtd; w += n.qtd; } }); return w ? x / w : null; };
  // Destaca o menor valor da linha (custo menor = melhor) quando os dois existem.
  const lin = (rot, va, vb, fmt, menorMelhor = true) => {
    const m = va != null && vb != null && va !== vb ? ((va < vb) === menorMelhor ? 'a' : 'b') : '';
    return `<tr><td>${rot}</td><td class="n${m === 'a' ? ' cu-best' : ''}">${va == null ? '–' : fmt(va)}</td><td class="n${m === 'b' ? ' cu-best' : ''}">${vb == null ? '–' : fmt(vb)}</td></tr>`;
  };
  const nForn = arr => new Set(arr.map(n => n.forn)).size;
  const mats = [...new Set([...na, ...nb].map(n => n.mat))].sort();
  const melhor = (arr, m) => { const g = _cuGroup(arr.filter(n => n.mat === m), 'forn'); let best = null; Object.entries(g).forEach(([f, v]) => { const s2 = _cuAgg(v); if (!best || s2.pe < best.pe) best = { f, pe: s2.pe }; }); return best; };
  const tabMat = mats.map(m => {
    const sa = _cuAgg(na.filter(n => n.mat === m)), sb = _cuAgg(nb.filter(n => n.mat === m)), ma = melhor(na, m), mb = melhor(nb, m);
    const va = sa.q ? sa.pe : null, vb = sb.q ? sb.pe : null, d = va && vb ? vb / va - 1 : null;
    return `<tr><td><b>${_cuE(m)}</b><br><span class="cu-semloc">${ma ? 'A: ' + _cuE(_cuNomeF(ma.f)) : 'A: –'}<br>${mb ? 'B: ' + _cuE(_cuNomeF(mb.f)) : 'B: –'}</span></td><td class="n${va && vb && va < vb ? ' cu-best' : ''}">${va ? _cuPn(m, va) : '–'}</td><td class="n${va && vb && vb < va ? ' cu-best' : ''}">${vb ? _cuPn(m, vb) : '–'}</td><td class="n ${d > 0 ? 'cu-worse' : d < 0 ? 'cu-best' : ''}">${d == null ? '–' : _cuPct(d)}</td></tr>`;
  }).join('');
  return `<div class="cu-ph"><div><div class="ey">Comparação</div><h2>${_cuE(_cuSigla(A))} × ${_cuE(_cuSigla(B))}</h2><p>A: ${_cuE(A.nome)} · ${_cuE(A.regional)}<br>B: ${_cuE(B.nome)} · ${_cuE(B.regional)}</p></div><button type="button" class="cu-x" id="cu-px" title="Fechar a comparação">×</button></div>
    <div class="cu-pb">
      <div class="cu-sec"><h3>${_cuE(_cuPerTxt())}</h3><div style="overflow-x:auto"><table><thead><tr><th></th><th class="n">A · ${_cuE(_cuSigla(A))}</th><th class="n">B · ${_cuE(_cuSigla(B))}</th></tr></thead><tbody>
        ${lin('Gasto NF', a.g, b.g, _cuBrlc, false)}${lin('Frete', a.ge - a.g, b.ge - b.g, _cuBrlc)}${lin('Volume', a.q ? d3.sum(na, n => n.qtd * (_cuU(n.mat) === 'kg' ? 1 : 1000)) : null, b.q ? d3.sum(nb, n => n.qtd * (_cuU(n.mat) === 'kg' ? 1 : 1000)) : null, _cuTon, false)}
        ${lin('Alertas NF', a.d, b.d, x => _cuNf0.format(x))}${lin('Alertas CTe', a.dc, b.dc, x => _cuNf0.format(x))}${lin('Fornecedores', nForn(na), nForn(nb), x => _cuNf0.format(x), false)}${lin('Distância média dos fornecedores', kmMed(na, s.a), kmMed(nb, s.b), x => _cuNf0.format(x) + ' km')}
      </tbody></table></div></div>
      <div class="cu-sec"><h3>Custo entregue por material</h3>${tabMat ? `<div style="overflow-x:auto"><table><thead><tr><th>Material · melhor fornecedor</th><th class="n">A</th><th class="n">B</th><th class="n">B vs A</th></tr></thead><tbody>${tabMat}</tbody></table></div>` : '<div class="cu-note">Sem NFs no período para estas centrais.</div>'}</div>
      <div class="cu-note">Em verde, o menor custo (ou menos alertas). Ctrl+clique em outra central troca a comparação.</div>
    </div>`;
}
function _cuPainel() {
  const el = document.getElementById('cu-panel'), main = document.getElementById('cu-main'), s = CU.sel;
  el.classList.toggle('open', !!s); main.classList.toggle('popen', !!s);
  if (!s) { el.innerHTML = ''; CU.cmpCen = []; return; }
  if (s.t === 'cmp') { el.innerHTML = _cuComparaHtml(s); el.querySelector('#cu-px').onclick = () => { CU.sel = null; CU.cmpCen = []; _cuUpdate(false); }; return; }
  CU.cmpCen = [];
  const arr = _cuEscopoNfs(), a = _cuAgg(arr), ref = _cuRef(_cuNfsF());
  let ey = 'Visão geral', ttl = 'Brasil', sub = _cuPerTxt(), eyc = '', end = '';
  const fmtCnpj = c => /^\d{14}$/.test(c || '') ? 'CNPJ ' + c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : 'sem CNPJ';
  if (s.t === 'uf') { ey = 'Estado'; ttl = s.uf; sub = _cuRegsDaUf(s.uf).length + ' regionais · ' + sub; }
  if (s.t === 'reg') { ey = 'Regional'; ttl = s.reg; }
  if (s.t === 'cen') { const c = CU.cen.get(s.id); ey = 'Central'; ttl = c.nome; sub = `${c.regional} · ${fmtCnpj(c.cnpj)}`; end = _cuEndereco(c.cnpj); }
  if (s.t === 'forn') { ey = 'Fornecedor'; eyc = 'f'; ttl = _cuNomeF(s.id); sub = fmtCnpj(s.id); end = _cuEndereco(s.id); }
  if (s.t === 'rota') { ey = 'Rota'; eyc = 'f'; ttl = `${_cuNomeF(s.forn)} → ${CU.cen.get(s.cen).nome}`; end = [_cuEndereco(s.forn), _cuEndereco(CU.cen.get(s.cen).cnpj)].filter(Boolean).join('  →  '); }
  const umMat = a.mats.size === 1, m1 = [...a.mats][0];
  const gMat = new Map(); arr.forEach(n => gMat.set(n.mat, (gMat.get(n.mat) || 0) + n.tot));
  const mats = [...a.mats].sort((x, y) => gMat.get(y) - gMat.get(x));
  const tabs = [['resumo', 'Resumo'], ['forn', 'Fornecedores'], ['precos', 'Preços'], ['nfs', 'Alertas', a.d + a.dc]];
  if (s.t === 'forn' || s.t === 'rota') tabs.push(['frete', 'Frete']);
  if (CU.tab === 'frete' && s.t !== 'forn' && s.t !== 'rota') CU.tab = 'resumo';
  let body = '';
  if (CU.tab === 'frete') body = _cuFretePainel(s);
  else if (!arr.length) body = s.t === 'forn' ? '<div class="cu-note">Fornecedor sem compra no período e filtros. Fica no mapa em cinza para servir de alternativa na comparação.</div>' : '<div class="cu-note">Nenhuma NF com os filtros atuais.</div>';
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
      body += `<div class="cu-facts"><div><span>Distância estimada</span><b>${km ? _cuNf0.format(km) + ' km' : '–'}</b></div><div><span>R$/${_cuU(m)} por 100 km</span><b>${km && umMat ? _cuPn(m, a.pm / km * 100) : '–'}</b></div><div><span>Última NF</span><b>${_cuP(m, last.pr)}</b></div><div><span>Faixa das últimas 5</span><b>${last.min == null ? '–' : last.min === last.max ? _cuPn(m, last.min) : _cuPn(m, last.min) + ' a ' + _cuPn(m, last.max)}</b></div><div><span>Média do material</span><b>${med ? _cuP(m, med) : '–'}</b></div><div><span>Rota vs média</span><b class="${ixr > .02 ? 'cu-worse' : ''}">${_cuPct(ixr)}</b></div><div><span>Frete (${_cuFonteFrete(am)})</span><b>${_cuP(m, _cuAgg(am).fu)}</b></div><div><span>Custo entregue</span><b>${_cuP(m, _cuAgg(am).pe)}</b></div></div>
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
    if (s.t === 'br' || s.t === 'cen') body += _cuSemLocal(arr);
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
  } else {
    // Alertas em duas abinhas: NF (preço da nota) e CTe (frete).
    if (CU.alTipo !== 'cte') CU.alTipo = 'nf';
    body = `<div class="cu-chips"><button type="button" class="cu-chip${CU.alTipo === 'nf' ? ' on' : ''}" data-al="nf">Alertas NF (${a.d})</button><button type="button" class="cu-chip${CU.alTipo === 'cte' ? ' on' : ''}" data-al="cte">Alertas CTe (${a.dc})</button></div>` + (CU.alTipo === 'cte' ? _cuListaCte(arr) : _cuListaNfs(arr));
  }
  el.innerHTML = `<div class="cu-ph"><div><div class="ey ${eyc}">${ey}</div><h2>${_cuE(ttl)}</h2><p>${_cuE(sub)}</p>${end ? `<p class="end"><i class="ti ti-map-pin"></i> ${_cuE(end)}</p>` : (s.t === 'cen' || s.t === 'forn') ? '<p class="end">Endereço ainda não localizado (veja o Diagnóstico)</p>' : ''}</div><button type="button" class="cu-x" id="cu-px" title="Fechar">×</button></div>
    <div class="cu-pk">
      <div><span>Gasto NF</span><b>${_cuBrlc(a.g)}</b><em>${umMat ? _cuQ(m1, a.q) : _cuTon(d3.sum(arr, n => n.qtd * (_cuU(n.mat) === 'kg' ? 1 : 1000)))}</em></div>
      <div><span>Frete</span><b>${a.ge > a.g ? _cuBrlc(a.ge - a.g) : '—'}</b><em>${a.ge > a.g && a.g ? _cuNf1.format((a.ge - a.g) / a.g * 100) + '% do gasto' : 'sem frete no recorte'}</em></div>
      <div><span>${umMat ? 'Custo entregue' : 'Custo vs média'}</span><b>${umMat ? _cuP(m1, a.pe) : _cuPct(_cuIdx(arr, ref))}</b><em>${umMat ? 'NF ' + _cuPn(m1, a.pm) + ' + frete ' + _cuPn(m1, a.fu) : 'índice do custo entregue'}</em></div>
      <div><span>Alertas</span><b class="${a.d + a.dc ? 'red' : ''}">${a.d + a.dc}</b><em>NF ${a.d} · CTe ${a.dc}${a.dr + a.dcr ? ' · +' + _cuBrlc(a.dr + a.dcr) : ''}</em></div>
    </div>
    <div class="cu-tabs" role="tablist">${tabs.map(([k, t, n]) => `<button type="button" role="tab" class="${k === CU.tab ? 'on' : ''}" data-tab="${k}">${t}${n != null ? `<span class="n ${n ? 'red' : ''}">${n}</span>` : ''}</button>`).join('')}</div>
    <div class="cu-pb">${body}</div>`;
  el.querySelector('#cu-px').onclick = () => { CU.sel = null; _cuUpdate(false); _cuFit(_cuBounds()); };
  el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { CU.tab = b.dataset.tab; _cuPainel(); });
  el.querySelectorAll('[data-pmat]').forEach(b => b.onclick = () => { CU.pmat = b.dataset.pmat; _cuPainel(); });
  el.querySelectorAll('[data-al]').forEach(b => b.onclick = () => { CU.alTipo = b.dataset.al; _cuPainel(); });
  if (CU.tab === 'frete') _cuFreteLigar(el, s);
  el.querySelectorAll('.cu-bar').forEach(b => b.onclick = () => {
    const k = b.dataset.k, act = b.dataset.act;
    if (act === 'reg') { const c = [...CU.cen.values()].find(x => x.regional === k); Object.assign(CU.F, { reg: k, cen: '', uf: c ? _cuUfCen(c) : '' }); CU.sel = { t: 'reg', reg: k }; _cuUpdate(true); }
    else if (act === 'cen') { const c = CU.cen.get(k); Object.assign(CU.F, { uf: _cuUfCen(c), reg: c.regional, cen: k }); CU.sel = { t: 'cen', id: k }; _cuUpdate(true); }
    else if (act === 'mat') { CU.F.mats = new Set([k]); _cuUpdate(false); }
  });
  el.querySelectorAll('[data-forn]').forEach(r => r.onclick = () => { CU.sel = { t: 'forn', id: r.dataset.forn }; _cuUpdate(false); });
  el.querySelectorAll('[data-rota]').forEach(r => r.onclick = () => { CU.sel = { t: 'rota', cen: r.dataset.rota, forn: s.id }; _cuUpdate(false); });
  el.querySelectorAll('[data-rota2]').forEach(r => r.onclick = () => { CU.sel = { t: 'rota', cen: s.id, forn: r.dataset.rota2 }; _cuUpdate(false); });
}

/* ───────── comparador ───────── */
// Opções do seletor de material do comparador: agrupadas por categoria, com nº de fornecedores no recorte.
function _cuOpcoesMat(mats, atual, arr) {
  const nf = new Map(); arr.forEach(n => { let s = nf.get(n.mat); if (!s) nf.set(n.mat, s = new Set()); s.add(n.forn); });
  const grupos = _cuGroup(mats, m => CU.catMat?.get(m) || 'Outros');
  return Object.keys(grupos).sort().map(g => `<optgroup label="${_cuE(g)}">${grupos[g].map(m => `<option value="${_cuE(m)}"${m === atual ? ' selected' : ''}>${_cuE(m)} (${nf.get(m)?.size || 0} forn.)</option>`).join('')}</optgroup>`).join('');
}
function _cuStrip() {
  const el = document.getElementById('cu-strip');
  // Recolhido por padrão (a faixa ocupava um terço da tela); a escolha fica guardada no navegador.
  if (CU.cmpAberto === undefined) { try { CU.cmpAberto = localStorage.getItem('custos.comparador') === '1'; } catch (_) { CU.cmpAberto = false; } }
  const alterna = () => { CU.cmpAberto = !CU.cmpAberto; try { localStorage.setItem('custos.comparador', CU.cmpAberto ? '1' : '0'); } catch (_) { /* sem storage */ } _cuStrip(); requestAnimationFrame(() => { _cuMedir(); _cuFit(_cuBounds(), 0); }); };
  el.classList.toggle('fechado', !CU.cmpAberto);
  if (!CU.cmpAberto) { el.innerHTML = `<button type="button" class="cu-cmp-tg"><i class="ti ti-chevron-up"></i> Comparador de fornecedores · ${_cuE(_cuEscopoNome(_cuEscopo()))}</button>`; el.querySelector('.cu-cmp-tg').onclick = alterna; return; }
  const arr = _cuNfsF(), mats = [...new Set(arr.map(n => n.mat))].sort();
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
  const rows = Object.entries(_cuGroup(am, 'forn')).map(([f, v]) => ({ f, s: _cuAgg(v), ser: serie(f) })).sort((x, y) => x.s.pe - y.s.pe); // custo entregue (NF + frete)
  const best = rows[0]?.s.pe, tq = _cuAgg(am).q;
  const spark = ser => { const p = ser.filter(q => q.y != null); if (p.length < 2) return '<svg viewBox="0 0 186 22" width="100%" height="22"></svg>'; const x = d3.scaleLinear().domain([0, 5]).range([2, 184]), ex = d3.extent(p, q => q.y), y = d3.scaleLinear().domain(ex[0] === ex[1] ? [ex[0] * .98, ex[1] * 1.02] : ex).range([20, 3]); return `<svg viewBox="0 0 186 22" width="100%" height="22"><path d="${d3.line().x(q => x(q.x)).y(q => y(q.y))(p)}" style="fill:none;stroke:var(--amber);stroke-width:1.5"/></svg>`; };
  el.innerHTML = `<div class="sh"><button type="button" class="cu-cmp-tg" title="Recolher o comparador"><i class="ti ti-chevron-down"></i></button><b>Comparador · ${_cuE(_cuEscopoNome(esc))}</b><label class="cu-cmp-sel">Material <select class="form-select" id="cu-cmp-mat">${_cuOpcoesMat(mats, m, arr)}</select></label></div>
    <div class="cu-cards">${rows.map((r, i) => `<div class="cu-card" data-cf="${_cuE(r.f)}"><span class="nm" title="${_cuE(_cuNomeF(r.f))}">${_cuE(_cuNomeF(r.f))}</span><span class="pr" title="Custo entregue = NF + frete">R$ ${_cuPn(m, r.s.pe)}<span style="font-size:11px;color:var(--text3)">/${_cuU(m)} entregue</span></span><span class="sub"><span>NF ${_cuPn(m, r.s.pm)} + frete ${_cuPn(m, r.s.fu)}</span></span><span class="sub"><span class="${i ? 'cu-worse' : 'cu-best'}">${i ? _cuPct(r.s.pe / best - 1) : 'melhor custo'}</span><span>${_cuNf0.format(r.s.q / tq * 100)}% do vol.</span></span>${spark(r.ser)}<span class="sub"><span class="${r.s.d ? 'cu-worse' : ''}">${r.s.d ? r.s.d + ' alerta' + (r.s.d > 1 ? 's' : '') : 'sem alerta'}</span>${_cuComBtn(r.f, m, esc, '', `${_cuNomeF(r.f)} · ${m} · ${_cuEscopoNome(esc)}`)}</span></div>`).join('') || '<div class="cu-note">Sem NFs no período.</div>'}</div>`;
  el.querySelector('#cu-cmp-mat').onchange = e => { CU.cmpMat = e.target.value; _cuStrip(); };
  el.querySelector('.cu-cmp-tg').onclick = alterna;
  el.querySelectorAll('[data-cf]').forEach(b => b.onclick = () => { CU.sel = { t: 'forn', id: b.dataset.cf }; CU.tab = 'forn'; _cuUpdate(false); });
}

/* ───────── geocodificação em segundo plano ───────── */
async function _cuGeoUm(a) {
  let b = null;
  // Falha TEMPORÁRIA (limite 429, 5xx, rede) não vira 'falhou': devolve null e tenta de novo na próxima abertura.
  // Só 'falhou' quando a BrasilAPI diz que o CNPJ não existe (404) ou quando nada localiza o endereço.
  let st = 0;
  try { const r = await fetch('https://brasilapi.com.br/api/cnpj/v1/' + a.cnpj); st = r.status; if (r.ok) b = await r.json(); } catch (_) { st = 0; }
  if (!b && st !== 404 && st !== 400) return null;
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
    // Todas as centrais com CNPJ (inclusive sem compra, que ficam cinza no mapa).
    CU.cen.forEach(c => { if (c.cnpj && falta(c.cnpj)) alvos.push({ cnpj: c.cnpj, tipo: 'central', nome: c.nome }); });
    // Fornecedores do mês escolhido primeiro (por gasto), depois o resto do histórico,
    // depois os cadastrados nas Cobranças sem compra (alternativas em cinza).
    const gasto = new Map(); _cuPeriodo().forEach(n => gasto.set(n.forn, (gasto.get(n.forn) || 0) + n.tot));
    [...CU.fornMats.keys()].filter(fk => /^\d{14}$/.test(fk) && falta(fk)).sort((x, y) => (gasto.get(y) || 0) - (gasto.get(x) || 0))
      .forEach(fk => alvos.push({ cnpj: fk, tipo: 'fornecedor', nome: _cuNomeF(fk) }));
    CU.fornCad.forEach((nome, c) => { if (!CU.fornMats.has(c) && falta(c)) alvos.push({ cnpj: c, tipo: 'fornecedor', nome }); });
    let feitos = 0, seguidas = 0;
    for (const a of alvos) {
      _cuStatus(`Localizando endereços: ${feitos} de ${alvos.length}`);
      const row = await _cuGeoUm(a); feitos++;
      if (!row) {
        // BrasilAPI fora ou limitando: espera mais; 5 seguidas → para e retoma na próxima abertura da aba.
        if (++seguidas >= 5) { console.warn('[Custos] BrasilAPI sem resposta; a busca de endereços continua na próxima abertura.'); break; }
        await _cuEspera(3000 * seguidas); continue;
      }
      seguidas = 0;
      CU.geo.set(a.cnpj, row);
      const { error } = await window.supabaseClient.from('custos_geo').upsert(row, { onConflict: 'cnpj' });
      if (error) console.warn('[Custos] custos_geo:', error.message);
      if (feitos % 5 === 0 && document.getElementById('page-custos')?.classList.contains('active')) _cuDesenhar();
      await _cuEspera(300); // ritmo da BrasilAPI (mesmo de preencherUfFiliais)
    }
    if (alvos.length) _cuUpdate(false);
  } finally { CU.geoRodando = false; _cuStatus(''); }
}

/* ───────── régua: distância e custo entre dois pontos que o analista escolhe ─────────
   Clique em dois pontos do mapa; perto de uma central ou fornecedor o ponto gruda nele.
   Mostra linha reta e estimativa por estrada (× 1,3, mesma regra das rotas) e, com o
   custo por km digitado, o custo total (ida ou ida e volta). Esc ou × fecha. */
const CU_REGUA_KEY = 'custos.regua.rkm';
CU.regua = { on: false, pts: [] };
function _cuReguaLiga(on) {
  CU.regua.on = on; CU.regua.pts = [];
  document.getElementById('cu-regua').hidden = !on;
  document.getElementById('cu-z-regua').classList.toggle('on', on);
  document.getElementById('cu-map').classList.toggle('regua', on);
  if (on) { try { document.getElementById('cu-regua-rkm').value = localStorage.getItem(CU_REGUA_KEY) || ''; } catch (_) { /* sem storage */ } }
  _cuTipOff(); _cuReguaDesenha();
}
function _cuReguaPonto(e) {
  // Ponto no sistema do mapa (já descontado o zoom); gruda na central/fornecedor desenhado mais próximo.
  const [x, y] = d3.pointer(e, _cuG.node()), raio = 16 / CU.K;
  let melhor = null, dmin = raio;
  _cuGr.c.selectAll('circle.pt').each(c => { const d = Math.hypot(c._xy[0] - x, c._xy[1] - y); if (d < dmin) { dmin = d; melhor = { xy: c._xy, nome: _cuSigla(c) + ' · ' + c.nome }; } });
  _cuGr.f.selectAll('circle.pt').each(fk => { const p = _cuXY(fk), d = Math.hypot(p[0] - x, p[1] - y); if (d < dmin) { dmin = d; melhor = { xy: p, nome: _cuNomeF(fk) }; } });
  const xy = melhor ? melhor.xy : [x, y];
  return { xy, ll: CU.proj.invert(xy), nome: melhor?.nome || null };
}
function _cuReguaClique(e) {
  if (!CU.regua.on) return;
  e.stopPropagation(); e.preventDefault(); // não abre central/estado por baixo
  const p = _cuReguaPonto(e), pts = CU.regua.pts;
  if (pts.length >= 2) pts.length = 0;
  pts.push(p); _cuReguaDesenha();
}
function _cuReguaDesenha() {
  const pts = CU.regua.on ? CU.regua.pts : [], g = _cuGr.rg;
  if (!g) return;
  g.selectAll('*').remove();
  const res = document.getElementById('cu-regua-res'), dica = document.getElementById('cu-regua-dica');
  pts.forEach(p => g.append('circle').attr('class', 'rg-pt').attr('cx', p.xy[0]).attr('cy', p.xy[1]));
  if (pts.length === 2) {
    const [a, b] = pts, mx = (a.xy[0] + b.xy[0]) / 2, my = (a.xy[1] + b.xy[1]) / 2;
    const reta = _cuKm(a.ll, b.ll) / 1.3, estrada = reta * 1.3; // _cuKm já devolve × 1,3
    g.insert('line', ':first-child').attr('class', 'rg-ln').attr('x1', a.xy[0]).attr('y1', a.xy[1]).attr('x2', b.xy[0]).attr('y2', b.xy[1]);
    g.append('text').attr('class', 'rg-tx').attr('x', mx).attr('y', my).text(`${_cuNf0.format(reta)} km (~${_cuNf0.format(estrada)} por estrada)`);
    const nome = p => p.nome || `${_cuNf2.format(p.ll[1])}, ${_cuNf2.format(p.ll[0])}`;
    const rkm = num(document.getElementById('cu-regua-rkm').value), iv = document.getElementById('cu-regua-iv').checked, km = estrada * (iv ? 2 : 1);
    res.innerHTML = `<div class="trecho">${_cuE(nome(a))} → ${_cuE(nome(b))}</div>
      <div class="cu-facts"><div><span>Linha reta</span><b>${_cuNf1.format(reta)} km</b></div><div><span>Por estrada (estimado)</span><b>~${_cuNf0.format(estrada)} km</b></div>
      <div><span>Km considerados${iv ? ' (ida e volta)' : ''}</span><b>${_cuNf0.format(km)} km</b></div><div><span>Custo total</span><b class="${rkm ? 'tot' : ''}">${rkm ? _cuBrl(km * rkm) : 'informe o R$/km'}</b></div></div>`;
    dica.textContent = 'Clique de novo para começar outra medida';
  } else {
    res.innerHTML = '';
    dica.textContent = pts.length ? 'Agora clique no segundo ponto' : 'Clique no primeiro ponto (perto de uma central ou fornecedor, o ponto gruda nele)';
  }
  _cuReguaEscala();
}
function _cuReguaEscala() {
  const g = _cuGr.rg, k = CU.K; if (!g) return;
  g.selectAll('.rg-pt').attr('r', 5 / k).style('stroke-width', 2 / k);
  g.selectAll('.rg-ln').style('stroke-width', 2 / k).style('stroke-dasharray', `${6 / k} ${4 / k}`);
  g.selectAll('.rg-tx').style('font-size', (12 / k) + 'px').style('stroke-width', 4 / k).attr('dy', -8 / k);
}

/* ───────── diagnóstico: o que está (e o que não está) no mapa, e por quê ───────── */const CU_PRECISAO = { cep: 'pelo CEP', endereco: 'pelo endereço', municipio: 'centro do município', manual: 'manual' };
function _cuGeoStatus(cnpj) {
  if (!cnpj) return ['sem CNPJ', 'err'];
  const g = CU.geo.get(cnpj);
  if (!g) return [CU.geoRodando ? 'buscando endereço…' : 'endereço ainda não buscado', 'warn'];
  if (g.precisao === 'falhou' || g.lat == null) return ['endereço não encontrado', 'err'];
  return [`${CU_PRECISAO[g.precisao] || g.precisao}${g.municipio ? ' · ' + g.municipio + '/' + g.uf : ''}`, 'ok'];
}
function _cuDiagnostico() {
  const nfMes = new Map(), nfBase = new Map(), fMes = new Map();
  _cuPeriodo().forEach(n => { nfMes.set(n.cen, (nfMes.get(n.cen) || 0) + 1); fMes.set(n.forn, (fMes.get(n.forn) || 0) + 1); });
  (CU.pares || []).forEach(p => nfBase.set(p.cen, (nfBase.get(p.cen) || 0) + p.n));
  const cens = [...CU.cen.values()].map(c => {
    const [geo, st] = _cuGeoStatus(c.cnpj), prob = [];
    if (c._s === -1) prob.push('não está no cadastro de filiais (o nome nas Entradas é diferente do cadastro?)');
    else if (!c.cnpj) prob.push('sem CNPJ válido no cadastro de filiais');
    if (c.regional === 'Sem regional' && c._s !== -1) prob.push('sem regional no cadastro');
    if (!_cuUfCen(c)) prob.push('sem UF');
    if (c.cnpj && st !== 'ok') prob.push(geo);
    if (!nfBase.get(c.alias)) prob.push('nenhuma NF na base de Entradas');
    else if (!nfMes.get(c.alias)) prob.push('sem NF no período (aparece em cinza)');
    return { c, geo, st, prob, mapa: !!_cuLL(c.cnpj), mes: nfMes.get(c.alias) || 0, base: nfBase.get(c.alias) || 0 };
  }).sort((a, b) => (a.mapa - b.mapa) || a.c.regional.localeCompare(b.c.regional) || a.c.nome.localeCompare(b.c.nome));
  const regs = Object.entries(_cuGroup(cens, x => x.c.regional)).map(([r, l]) => ({ r, n: l.length, mapa: l.filter(x => x.mapa).length, ufs: [...new Set(l.map(x => _cuUfCen(x.c)).filter(Boolean))].join(', ') || '—', mes: d3.sum(l, x => x.mes) })).sort((a, b) => a.r.localeCompare(b.r));
  const forns = [...CU.fornMats.keys()].map(fk => { const cnpj = /^\d{14}$/.test(fk) ? fk : ''; const [geo, st] = _cuGeoStatus(cnpj); return { fk, cnpj, geo, st, mapa: !!_cuLL(fk), mes: fMes.get(fk) || 0 }; })
    .sort((a, b) => (a.mapa - b.mapa) || b.mes - a.mes || _cuNomeF(a.fk).localeCompare(_cuNomeF(b.fk)));
  const fmtCnpj = c => c ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : '—';
  const pill = (ok, t) => `<span class="cu-pill ${ok}">${_cuE(t)}</span>`;
  const linha = (busca, fora, html) => `<tr data-busca="${_cuE(_cuNomeNorm(busca))}" data-fora="${fora ? 1 : 0}">${html}</tr>`;
  const cOk = cens.filter(x => x.mapa).length, fOk = forns.filter(x => x.mapa).length, fMesOk = forns.filter(x => x.mes && x.mapa).length, fMesN = forns.filter(x => x.mes).length;
  document.getElementById('cu-diag-body').innerHTML = `
    <div class="cu-diag-res"><div><b>${cOk} de ${cens.length}</b>centrais no mapa</div><div><b>${fMesOk} de ${fMesN}</b>fornecedores com compra em ${_cuPerTxt()} no mapa</div><div><b>${fOk} de ${forns.length}</b>fornecedores da base no mapa</div><div><b>${regs.length}</b>regionais</div></div>
    <div class="cu-note">Uma central entra no mapa quando tem CNPJ no cadastro de filiais e o endereço foi encontrado. No nível Brasil e Estado ela conta na bolha pela UF; na regional, sem NF no período fica em cinza.</div>
    <div class="cu-sec"><h3>Centrais</h3><div style="overflow-x:auto"><table><thead><tr><th>Central</th><th>Regional</th><th>UF</th><th>CNPJ</th><th>Localização</th><th class="n">NFs período</th><th class="n">NFs base</th><th>Problemas</th></tr></thead><tbody>${
      cens.map(x => linha(`${x.c.nome} ${x.c.alias} ${x.c.regional} ${x.c.cnpj}`, !x.mapa, `<td><b>${_cuE(x.c.nome)}</b>${x.c.nome !== x.c.alias ? `<br><span class="cu-semloc">${_cuE(x.c.alias)}</span>` : ''}</td><td>${_cuE(x.c.regional)}</td><td>${_cuE(_cuUfCen(x.c) || '—')}</td><td class="mono">${fmtCnpj(x.c.cnpj)}</td><td>${pill(x.st, x.mapa ? x.geo : 'fora do mapa')}</td><td class="n">${x.mes}</td><td class="n">${x.base}</td><td class="mot">${x.prob.map(_cuE).join('; ') || '—'}</td>`)).join('')}</tbody></table></div></div>
    <div class="cu-sec"><h3>Regionais</h3><div style="overflow-x:auto"><table><thead><tr><th>Regional</th><th>UF</th><th class="n">Centrais</th><th class="n">No mapa</th><th class="n">NFs período</th></tr></thead><tbody>${
      regs.map(r => linha(`${r.r} ${r.ufs}`, r.mapa < r.n, `<td><b>${_cuE(r.r)}</b></td><td>${_cuE(r.ufs)}</td><td class="n">${r.n}</td><td class="n ${r.mapa < r.n ? 'cu-worse' : ''}">${r.mapa}</td><td class="n">${r.mes}</td>`)).join('')}</tbody></table></div></div>
    <div class="cu-sec"><h3>Fornecedores com compra na base</h3><div style="overflow-x:auto"><table><thead><tr><th>Fornecedor</th><th>CNPJ</th><th>Localização</th><th class="n">NFs período</th><th>Materiais</th></tr></thead><tbody>${
      forns.map(x => linha(`${_cuNomeF(x.fk)} ${x.cnpj}`, !x.mapa, `<td>${_cuE(_cuNomeF(x.fk))}</td><td class="mono">${fmtCnpj(x.cnpj)}</td><td>${pill(x.st, x.st === 'err' && !x.cnpj ? 'sem CNPJ · reimporte as Entradas ou cadastre nas Cobranças' : x.geo)}</td><td class="n">${x.mes}</td><td class="mot">${[...CU.fornMats.get(x.fk)].map(_cuE).join(', ')}</td>`)).join('')}</tbody></table></div></div>`;
  _cuDiagFiltrar();
}
function _cuDiagFiltrar() {
  const q = _cuNomeNorm(document.getElementById('cu-diag-busca').value), so = document.getElementById('cu-diag-so').checked;
  document.querySelectorAll('#cu-diag-body tbody tr').forEach(tr => { tr.hidden = (q && !tr.dataset.busca.includes(q)) || (so && tr.dataset.fora !== '1'); });
}
function _cuDiagRefazer() {
  // Esquece as buscas que falharam (e as centrais/fornecedores sem coordenada) e busca de novo.
  let n = 0;
  const alvo = c => { const g = c && CU.geo.get(c); if (g && (g.precisao === 'falhou' || g.lat == null)) { CU.geo.delete(c); n++; } };
  CU.cen.forEach(c => alvo(c.cnpj)); CU.fornMats.forEach((_, fk) => alvo(fk));
  toast(n ? `Buscando de novo o endereço de ${n} CNPJ(s) em segundo plano.` : 'Nenhuma busca com falha para refazer. Os itens "sem CNPJ" precisam de cadastro.');
  if (n) _cuGeocodificar().then(() => { if (!document.getElementById('cu-diag').hidden) _cuDiagnostico(); });
}

/* ───────── tooltip, status, seletor de mês ───────── */
// Tooltip: só reescreve e mede o conteúdo quando ele muda; a cada movimento só reposiciona.
function _cuTip(e, h) { const t = document.getElementById('cu-tip'); if (t._h !== h || t.hidden) { t.innerHTML = h; t._h = h; t.hidden = false; t._r = t.getBoundingClientRect(); } const r = t._r; let x = e.clientX + 14, y = e.clientY + 14; if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14; if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14; t.style.left = x + 'px'; t.style.top = y + 'px'; }
// Soma por UF do período (tooltip dos estados), refeita só quando o período muda.
function _cuAggUf(uf) {
  const per = _cuPeriodo();
  if (CU._aggUfA !== per) { CU._aggUfA = per; const m = new Map(); per.forEach(n => { const u = _cuUfCen(CU.cen.get(n.cen)); (m.get(u) || m.set(u, []).get(u)).push(n); }); CU._aggUf = new Map([...m].map(([u, a]) => [u, _cuAgg(a)])); }
  return CU._aggUf.get(uf) || _cuAgg([]);
}
function _cuTipOff() { document.getElementById('cu-tip').hidden = true; }
function _cuStatus(t) { const el = document.getElementById('cu-status'); if (el) el.textContent = t; }
function _cuVazio(t) { const el = document.getElementById('cu-empty'); el.textContent = t; el.hidden = !t; }
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
  _cuSync();
  if (CU.F.cen !== CU._cenAnt) { CU.soMun = false; CU._cenAnt = CU.F.cen; } // outra central: volta a enquadrar os fornecedores
  const temMes = _cuPeriodo().length > 0;
  _cuVazio(!CU.nNfs ? 'Nenhuma entrada com material, peso e valor na base. Importe as Entradas para montar os custos.' : !temMes ? `Nenhuma NF em ${_cuPerTxt()}. Escolha outro mês.` : '');
  _cuFiltros(); _cuCrumbs(); _cuLegenda(); _cuDesenhar(); _cuStrip(); _cuPainel();
  if (refit) requestAnimationFrame(() => { _cuMedir(); _cuFit(_cuBounds()); });
  _cuNavSalvar();
}
function _cuInitUI() {
  const F = CU.F;
  // Os filtros de vários itens (_cuMulti) ligam os próprios eventos em _cuFiltros.
  document.getElementById('cu-f-div').addEventListener('change', e => { F.div = e.target.checked; _cuUpdate(false); });
  document.getElementById('cu-diag-abrir').onclick = () => { if (!CU.pares) return; _cuDiagnostico(); document.getElementById('cu-diag').hidden = false; document.getElementById('cu-diag-busca').focus(); };
  document.getElementById('cu-diag-x').onclick = () => { document.getElementById('cu-diag').hidden = true; };
  document.getElementById('cu-diag').addEventListener('click', e => { if (e.target.id === 'cu-diag') e.currentTarget.hidden = true; });
  document.getElementById('cu-diag-busca').addEventListener('input', _cuDiagFiltrar);
  document.getElementById('cu-diag-so').addEventListener('change', _cuDiagFiltrar);
  document.getElementById('cu-diag-refazer').onclick = _cuDiagRefazer;
  document.getElementById('cu-f-clear').addEventListener('click', () => { Object.assign(F, { uf: '', reg: '', cen: '', div: false, regs: new Set(), cens: new Set(), mats: new Set(), forns: new Set() }); _cuNavFeita(); CU.sel = null; _cuUpdate(true); });
  document.getElementById('cu-z-in').onclick = () => _cuSvg?.transition().duration(220).call(_cuZoom.scaleBy, 1.8);
  document.getElementById('cu-z-out').onclick = () => _cuSvg?.transition().duration(220).call(_cuZoom.scaleBy, 1 / 1.8);
  // Teclado (aba Custos aberta, fora de campos): + aproxima, − afasta, 0 enquadra o nível atual.
  document.addEventListener('keydown', e => {
    if (!document.getElementById('page-custos')?.classList.contains('active') || e.ctrlKey || e.metaKey || e.altKey || /input|select|textarea/i.test(e.target.tagName)) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); document.getElementById('cu-z-in').click(); }
    else if (e.key === '-') { e.preventDefault(); document.getElementById('cu-z-out').click(); }
    else if (e.key === '0') { e.preventDefault(); _cuFit(_cuBounds()); }
  });
  document.getElementById('cu-z-fit').onclick = () => _cuFit(_cuBounds());
  document.getElementById('cu-z-regua').onclick = () => _cuReguaLiga(!CU.regua.on);
  document.getElementById('cu-regua-x').onclick = () => _cuReguaLiga(false);
  document.getElementById('cu-map').addEventListener('click', _cuReguaClique, true); // captura: régua ligada não abre o que está por baixo
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && CU.regua.on) _cuReguaLiga(false); });
  document.getElementById('cu-regua-rkm').addEventListener('input', e => { try { localStorage.setItem(CU_REGUA_KEY, e.target.value); } catch (_) { /* sem storage */ } _cuReguaDesenha(); });
  document.getElementById('cu-regua-iv').addEventListener('change', _cuReguaDesenha);
  // Botão de comentário: captura antes do clique do card/linha que o contém.
  document.getElementById('page-custos').addEventListener('click', e => {
    const b = e.target.closest('[data-cuc-f]'); if (!b) return;
    e.stopPropagation(); e.preventDefault();
    _cuComAbrir({ f: b.dataset.cucF, m: b.dataset.cucM, c: b.dataset.cucC, n: b.dataset.cucN, l: b.dataset.cucL });
  }, true);
  document.getElementById('cu-com-x').onclick = document.getElementById('cu-com-cancel').onclick = () => { document.getElementById('cu-com').hidden = true; CU.comAtual = null; };
  document.getElementById('cu-com').addEventListener('click', e => { if (e.target.id === 'cu-com') { e.currentTarget.hidden = true; CU.comAtual = null; } });
  document.getElementById('cu-com-form').addEventListener('submit', _cuComSalvar);
  // Fecha o seletor de meses e as listas de filtro ao clicar fora (alvo que saiu do DOM = clique dentro que redesenhou).
  document.addEventListener('click', e => {
    if (!e.target.isConnected) return;
    if (!e.target.closest('#cu-month-wrap')) _cuFechaMes();
    if (!e.target.closest('.cu-ms')) document.querySelectorAll('.cu-ms-pop').forEach(p => { p.hidden = true; });
  });
}
/* ───────── lembrar onde parou (estado, regional, central, seleção e zoom) ───────── */
// Por usuário/navegador (localStorage): é conveniência de tela, não dado.
const CU_NAV_K = 'custos.nav';
function _cuNavSalvar() {
  if (!_cuSvg || !CU.navPronto) return;
  const F = CU.F, t = d3.zoomTransform(_cuSvg.node()), s = CU.sel && CU.sel.t !== 'cmp' ? CU.sel : null;
  try { localStorage.setItem(CU_NAV_K, JSON.stringify({ uf: F.uf, reg: F.reg, cen: F.cen, sel: s, tab: CU.tab, z: [t.x, t.y, t.k], wh: [CU.W, CU.H] })); } catch (_) { /* sem storage */ }
}
// true = restaurou o zoom (quem chamou não precisa enquadrar).
function _cuNavRestaurar() {
  let v; try { v = JSON.parse(localStorage.getItem(CU_NAV_K) || 'null'); } catch (_) { v = null; }
  if (!v) return false;
  const regOk = r => !r || [...CU.cen.values()].some(c => c.regional === r);
  if ((v.cen && !CU.cen.has(v.cen)) || !regOk(v.reg)) { try { localStorage.removeItem(CU_NAV_K); } catch (_) { /* sem storage */ } return false; }
  Object.assign(CU.F, { uf: v.uf || '', reg: v.reg || '', cen: v.cen || '' });
  const s = v.sel;
  CU.sel = !s ? null : (s.t === 'cen' && !CU.cen.has(s.id)) || (s.t === 'rota' && !CU.cen.has(s.cen)) ? null : s;
  if (v.tab) CU.tab = v.tab;
  // Zoom só volta se a janela tem o mesmo tamanho; senão enquadra o nível salvo.
  return !!(v.z && v.wh && Math.abs(v.wh[0] - CU.W) < 2 && Math.abs(v.wh[1] - CU.H) < 2);
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
  // Na primeira abertura volta onde o usuário parou; nas seguintes o CU já está como ficou.
  const primeira = !CU.navPronto; let zoomOk = false;
  if (primeira) zoomOk = _cuNavRestaurar(); else zoomOk = true;
  CU.navPronto = true;
  _cuUpdate(!zoomOk);
  if (zoomOk && primeira) { try { const z = JSON.parse(localStorage.getItem(CU_NAV_K)).z; _cuSvg.call(_cuZoom.transform, d3.zoomIdentity.translate(z[0], z[1]).scale(z[2])); } catch (_) { _cuFit(_cuBounds(), 0); } }
  _cuGeocodificar();
}
window.custosRender = custosRender;
