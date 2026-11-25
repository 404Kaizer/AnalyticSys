'use strict';

// ══════════════════════════════════════════════════════════════════════
// REPOSIÇÕES — rateio do desfalque de AGREGADOS entre os fornecedores, para
// negociar reposição (tela; a conta está em reposicoes-motor.js).
// Só ADM + INSUMOS (navigate em ui.js, CSS em modules.css, RLS rep_*).
// Migration: supabase/migrations/20261125_reposicoes.sql.
//
// ADM: calcula do próprio navegador (SAP, Lançamentos, Custos SAP, Entradas) e
// PUBLICA o mês fechado. INSUMOS: vê a mesma tela, só com os meses publicados.
// Os dois registram a negociação (fornecedor × mês), com os números congelados
// na abertura — a base pode mudar depois; a tela avisa, o negociado não muda.
// Documento do fornecedor: nunca mostra base, participação, desfalque total nem
// nada que leve ao concorrente; a conta sai pelo ÍNDICE DE FALTA.
// ══════════════════════════════════════════════════════════════════════

const RP_ST = { '': ['Não iniciada', 'var(--text2)'], negociando: ['Em negociação', 'var(--accent)'], acordada: ['Acordada', 'var(--amber)'], trav: ['Travado', 'var(--urgente)'], sem_acordo: ['Sem acordo', 'var(--red)'], concluida: ['Concluída', 'var(--green)'] };
const RP_ORD = ['', 'negociando', 'acordada', 'trav', 'sem_acordo', 'concluida'];
const RP_ABAS = {
  novo: ['A negociar', 'ti-heart-handshake', s => s === ''], and: ['Em negociação', 'ti-messages', s => s === 'negociando' || s === 'acordada'],
  fim: ['Encerradas', 'ti-circle-check', s => s === 'concluida' || s === 'sem_acordo'], trav: ['Travados', 'ti-lock', s => s === 'trav'],
};
const RP_FORMAS = ['NF de reposição (material)', 'Desconto em NF futura', 'Crédito financeiro', 'Mista (material + valor)', 'Outra'];
const RP_CONCL = ['Reposto integral', 'Reposto parcial', 'Convertido em valor', 'Sem acordo'];
const RP_MOT = {
  ini: 'Est. Inicial ausente', ini_neg: 'Est. Inicial negativo', mes_ant: 'Mês anterior sem ajuste', sem_cont_ant: 'Sem contagem no mês anterior', fim: 'Est. Final ausente', cod: 'Outro Cód SAP com saldo',
  sem_nf: 'Entrada SAP sem nº de NF', sem_forn: 'NF do SAP fora das Entradas', outro_mat: 'NF com outro material', outra_cen: 'NF em outra central', sem_cnpj: 'NF sem CNPJ do fornecedor', dois_forn: 'NF em dois fornecedores',
  neg: 'NF com saldo negativo', fator: 'NF sem fator de conversão', dup: 'NF duplicada no SAP', dois_dest: 'NF com dois destinos', transf: 'Transferência incompleta', base: 'Sem base para ratear',
};
const RP_COR = { forn: 'var(--rp-1)', ini: 'var(--rp-2)', sem: 'var(--rp-3)', repos: 'var(--rp-4)' };
const RP_CORP = ['var(--rp-1)', 'var(--rp-3)', 'var(--rp-4)', 'var(--rp-5)', 'var(--rp-6)'];
const RP_MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const RP = {
  iniciado: false, carga: null, erro: '', B: null, fora: null, res: new Map(), pub: new Map(), pubRes: new Map(), negs: new Map(), reposSig: '',
  meses: [], mes: [], viewAno: 0, grupo: 'fornecedor', F: { regs: new Set(), cens: new Set(), mats: new Set() }, fAberto: null, fPend: null, fBusca: '',
  q: '', aba: 'novo', no: { tipo: 'geral' }, un: 't', eixo: 'forn', ab: new Set(), nfAb: new Set(), mot: '', desenhos: [], gen: 0,
};

/* ───────── formatação ───────── */
const _rpN = [0, 1, 2, 3, 4].map(d => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const _rpT = (kg, d = 2) => _rpN[d].format(kg / 1000) + ' t', _rpR = v => 'R$ ' + _rpN[2].format(v || 0), _rpP = v => _rpN[2].format(v) + '%', _rpP1 = v => _rpN[1].format(v) + '%';
const _rpE = s => escapeHtml(String(s ?? ''));
const _rpMesL = ym => { const [a, m] = ym.split('-'); return RP_MESES[m - 1] + '/' + a; }, _rpMesC = ym => { const [a, m] = ym.split('-'); return RP_MESES[m - 1].slice(0, 3) + '/' + a.slice(2); };
const _rpIc = n => `<i class="ti ${n}" aria-hidden="true"></i>`;
const _rpTip = (t, l) => encodeURIComponent(`<b>${_rpE(t)}</b>${l.length ? `<div style="display:grid;grid-template-columns:auto auto;gap:4px 16px;margin-top:6px;font-family:var(--mono);font-size:13px">${l.map(([a, b]) => `<span style="color:var(--text2)">${_rpE(a)}</span><span style="text-align:right">${_rpE(b)}</span>`).join('')}</div>` : ''}`);
const _rpSelo = (t, c, i) => `<span class="rp-selo" style="--c:${c}">${i ? _rpIc(i) : ''}${t}</span>`, _rpNota = (t, c = 'var(--amber)', i = 'ti-alert-triangle') => `<div class="rp-nota" style="--c:${c}">${_rpIc(i)}<span>${t}</span></div>`;
const _rpLeg = l => `<span class="rp-legh">${l.map(([n, c]) => `<span><i style="background:${c}"></i>${n}</span>`).join('')}</span>`;
const _rpSeg = (ops, at, acao, rot) => `<span class="mp-modo" role="group" aria-label="${rot}">${ops.map(([k, n]) => `<button class="${at === k ? 'on' : ''}" aria-pressed="${at === k}" data-rp="${acao}" data-v="${k}">${n}</button>`).join('')}</span>`;
const _rpPlural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
const _rpLer = v => { const n = parseFloat(String(v).replace(/\./g, '').replace(',', '.')); return n > 0 ? n : 0; };
const _rpData = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';
const _rpAdm = () => window.currentUser?.role === 'admin';
const _rpQuem = () => window.currentUser?.nome_completo || window.currentUser?.email || '';
const _rpAberto = ym => { const [a, m] = ym.split('-').map(Number); return _rpAdm() && !isPeriodoFechado(a, m); };
const _rpKey = r => r.par.central + '|' + r.par.material, _rpKeyT = k => _rpE(k.replace('|', ' · '));

/* ───────── carga ───────── */
async function _rpFetch(tab, cols, ordem, filtro = q => q) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await filtro(window.supabaseClient.from(tab).select(cols)).order(ordem).range(de, de + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}
async function _rpCarregarNegs() {
  const rows = await _rpFetch('rep_negociacoes', '*', 'raiz');
  RP.negs = new Map(rows.map(n => [n.raiz + '|' + n.ym, n]));
  _rpReposMudou();
}
async function _rpCarregarPubs() {
  const rows = await _rpFetch('rep_publicacoes', 'ym, versao, hash, resumo, publicado_nome, publicado_em', 'ym');
  RP.pub = new Map();
  rows.forEach(p => { if (!RP.pub.has(p.ym) || RP.pub.get(p.ym).versao < p.versao) RP.pub.set(p.ym, p); });
}
// Notas que não identificam fornecedor: mães, canceladas e as marcadas na aba Acordos.
// Se a lista não vier, NÃO calcula (melhor parar do que ratear com nota errada).
async function _rpCarregarFora() {
  const fora = new Set(), sb = window.supabaseClient;
  for (let de = 0; ; de += 1000) {
    const { data, error } = await sb.rpc('acordo_maes_ocultas').range(de, de + 999);
    if (error) throw error;
    data.forEach(m => { fora.add(m.chave); fora.add(m.cnpj + '|' + m.numero); });
    if (data.length < 1000) break;
  }
  const [canc, st] = await Promise.all([_rpFetch('cob_sefaz', 'chave', 'chave', q => q.ilike('status', '%cancel%')), _rpFetch('acordo_nf_status', 'chave, status', 'chave')]);
  canc.forEach(c => fora.add(c.chave));
  st.forEach(s => { if (s.status !== 'autorizada') fora.add(s.chave); });
  return fora;
}
// NFs vinculadas a negociações = reposição (saldo da central). Mudou → o mês recalcula.
function _rpReposMudou() {
  const s = new Set();
  RP.negs.forEach(n => (n.dados?.nfs || []).forEach(x => s.add(n.raiz + '|' + repNumNf(x.nf) + '|' + x.key)));
  const sig = [...s].sort().join(';');
  if (sig !== RP.reposSig) { RP.reposSig = sig; if (_rpAdm()) RP.res.clear(); }
  RP.repos = s;
}
const _rpEhRepos = (raiz, nf, c, m) => RP.repos.has(raiz + '|' + nf + '|' + c + '|' + m);

async function _rpCarregar() {
  if (!window.supabaseClient) throw new Error('sem conexão com o banco');
  _rpStatus('Carregando…');
  await Promise.all([_rpCarregarNegs(), _rpCarregarPubs()]);
  if (_rpAdm()) RP.fora = await _rpCarregarFora();
}
async function _rpBase() {
  if (!_rpAdm()) { RP.meses = [...RP.pub.keys()].sort(); return; }
  const antes = RP.B?.porNum;
  RP.B = await repBaseMontar(RP.fora, _rpStatus);
  if (RP.B.porNum !== antes) RP.res.clear();
  RP.meses = RP.B.meses;
}
// Garante o resultado dos meses em RP.res.
async function _rpGarantir(yms) {
  for (const ym of yms) {
    if (_rpAdm()) { if (!RP.res.has(ym)) { _rpStatus('Calculando ' + _rpMesL(ym) + '…'); await yieldToUI(); RP.res.set(ym, repCalcularMes(RP.B, ym, _rpEhRepos)); } continue; }
    const p = RP.pub.get(ym);
    if (!p || RP.pubRes.get(ym)?.versao === p.versao) continue;
    const { data, error } = await window.supabaseClient.from('rep_publicacoes').select('payload').eq('ym', ym).eq('versao', p.versao).single();
    if (error) throw error;
    const json = await _cbGunzipBlob(await (await fetch('data:application/gzip;base64,' + data.payload)).blob());
    if (await _cbSha256Hex(json) !== p.hash) throw new Error(`publicação de ${_rpMesL(ym)} corrompida (hash não confere)`);
    RP.pubRes.set(ym, { versao: p.versao });
    RP.res.set(ym, JSON.parse(json).itens);
  }
  _rpStatus('');
}
function _rpStatus(t) { const e = document.getElementById('rp-status'); if (e) e.textContent = t; }

async function reposicoesRender() {
  const root = document.getElementById('rp-root');
  if (!root) return;
  if (!RP.iniciado) { RP.iniciado = true; _rpLigar(root); }
  const gen = ++RP.gen;
  try {
    if (!RP.carga) { root.innerHTML = '<div class="empty-state"><i class="ti ti-loader-2"></i><p>Carregando reposições…</p></div>'; RP.carga = _rpCarregar().catch(e => { RP.carga = null; throw e; }); }
    await RP.carga;
    await _rpBase();
    if (!RP.mes.length && RP.meses.length) RP.mes = [[...RP.meses].reverse().find(m => !_rpAberto(m)) || RP.meses[RP.meses.length - 1]];
    await _rpGarantir(RP.mes);
  } catch (e) {
    console.error('[Reposições]', e);
    _rpStatus('');
    root.innerHTML = `<div class="empty-state"><i class="ti ti-database-off"></i><p>Não foi possível montar as reposições: ${_rpE(e.message || e)}.<br>Se for a primeira vez, rode o SQL <b>20261125_reposicoes.sql</b> no Supabase.</p><button class="btn" data-rp="recarregar"><i class="ti ti-refresh"></i> Tentar de novo</button></div>`;
    return;
  }
  if (gen !== RP.gen) return;
  _rpDesenhar();
  _rpFundo(gen);
}
// Meses do gráfico (12 até o último escolhido), calculados em segundo plano.
const _rpMesesHist = () => { const f = RP.mes[RP.mes.length - 1]; return RP.meses.filter(m => m <= f).slice(-12); };
async function _rpFundo(gen) {
  let novos = 0;
  for (const ym of _rpMesesHist()) {
    if (RP.res.has(ym)) continue;
    await new Promise(r => setTimeout(r, 30));
    if (gen !== RP.gen || !document.getElementById('page-reposicoes')?.classList.contains('active')) return;
    try { await _rpGarantir([ym]); novos++; } catch (e) { console.warn('[Reposições] histórico', ym, e); }
  }
  if (novos && gen === RP.gen) _rpHistDesenhar();
}

/* ───────── somas ───────── */
const _rpPassa = r => (!RP.F.regs.size || RP.F.regs.has(r.par.regional)) && (!RP.F.cens.size || RP.F.cens.has(r.par.central)) && (!RP.F.mats.size || RP.F.mats.has(r.par.material));
const _rpNoOk = par => RP.no.tipo === 'regional' ? par.regional === RP.no.reg : RP.no.tipo === 'central' ? par.central === RP.no.cen : RP.no.tipo === 'material' ? par.material === RP.no.mat : true;
const _rpDoMes = ym => RP.res.get(ym) || [];
const _rpItens = () => RP.mes.flatMap(_rpDoMes).filter(_rpPassa);
const _rpNeg = (raiz, ym) => RP.negs.get(raiz + '|' + ym);
const _rpFornDe = (ym, k) => _rpDoMes(ym).filter(r => r.estado === 'desfalque' && r.partes.some(p => p.k === k && p.cotaKg));
function _rpPorForn(lista) {
  const o = new Map();
  lista.forEach(r => r.partes.forEach(p => {
    if (p.tipo !== 'forn') return;
    const f = o.get(p.k) || o.set(p.k, { k: p.k, nome: p.nome, kg: 0, valor: 0, itens: [], cens: new Set(), sobra: 0 }).get(p.k);
    if (r.estado === 'sobra') { f.sobra += r.sobraKg * p.pct / 100; return; }
    if (r.estado !== 'desfalque' || !p.cotaKg) return;
    f.kg += p.cotaKg; f.valor += p.valor; f.itens.push({ r, p }); f.cens.add(r.par.central);
  }));
  for (const [k, f] of o) if (!f.itens.length) o.delete(k);
  return o;
}
function _rpTotais(lista) {
  const t = { desf: 0, forn: 0, valor: 0, ini: 0, sem: 0, repos: 0, trav: 0, travKg: 0, nDesf: 0, sobra: 0 };
  lista.forEach(r => {
    if (r.estado === 'bloqueado') { t.trav++; t.travKg += r.desfalqueKg; return; }
    if (r.estado === 'sobra') t.sobra += r.sobraKg;
    if (r.estado !== 'desfalque') return;
    t.nDesf++; t.desf += r.desfalqueKg;
    r.partes.forEach(p => { t[p.tipo] += p.cotaKg; if (p.tipo === 'forn') t.valor += p.valor; });
  });
  return t;
}
// Caminhões (Hugo, 26/11/2026): a cobrar ÷ peso médio por NF do fornecedor, para
// cima. Média = peso SAP das NFs dele nos meses escolhidos, em TODAS as centrais
// (os filtros não mudam a média), só de itens não travados; NF com dois materiais
// conta como um caminhão.
function _rpMediaCam(k) {
  const nfs = new Map();
  RP.mes.forEach(ym => _rpDoMes(ym).forEach(r => {
    if (r.estado === 'bloqueado') return;
    r.partes.find(p => p.k === k)?.nfs.forEach(n => { const c = ym + '|' + n.nf; nfs.set(c, (nfs.get(c) || 0) + n.kg); });
  }));
  let kg = 0; nfs.forEach(v => { kg += v; });
  return nfs.size && kg > 0 ? { kg, n: nfs.size, media: kg / nfs.size } : null;
}
// fs: [{ k, kg }] → caminhões somados por fornecedor e a média de peso deles juntos.
function _rpCaminhoes(fs) {
  let n = 0, kg = 0, nfs = 0;
  fs.forEach(f => { const m = _rpMediaCam(f.k); if (!m || !(f.kg > 0)) return; n += Math.ceil(f.kg / m.media); kg += m.kg; nfs += m.n; });
  return { n, media: nfs ? kg / nfs : 0 };
}
const _rpKpiCam = (c, txt) => _rpKpi('N° de caminhões', '', _rpN[0].format(c.n), c.media ? `média de ${_rpT(c.media, 1)} por caminhão` : 'sem NF para calcular a média', txt);
const _rpAc = (n, i) => n.dados.acordado?.[i.key] ?? i.kg;
const _rpAcR = (n, i) => { const a = _rpAc(n, i); return a === i.kg ? i.valor : Math.round(a * i.preco / 10) / 100; };
const _rpNegKg = n => n.congelado.itens.reduce((s, i) => s + i.kg, 0), _rpNegAc = n => n.congelado.itens.reduce((s, i) => s + _rpAc(n, i), 0);
const _rpNegRec = n => (n.dados.nfs || []).reduce((s, x) => s + x.kg, 0) + (n.dados.fim?.kgFin || 0);
// Acordado e recuperado só das centrais/materiais do recorte; o que virou dinheiro se divide pelo que faltava repor.
function _rpNegF(n) {
  const nfs = new Map(); (n.dados.nfs || []).forEach(x => nfs.set(x.key, (nfs.get(x.key) || 0) + x.kg));
  const falta = i => Math.max(0, _rpAc(n, i) - (nfs.get(i.key) || 0)), ft = n.congelado.itens.reduce((s, i) => s + falta(i), 0);
  return n.congelado.itens.filter(i => _rpPassa({ par: i }) && _rpNoOk(i)).reduce((o, i) => { o.ac += _rpAc(n, i); o.rec += (nfs.get(i.key) || 0) + (ft ? (n.dados.fim?.kgFin || 0) * falta(i) / ft : 0); return o; }, { ac: 0, rec: 0 });
}
const _rpNegsDe = yms => [...RP.negs.values()].filter(n => yms.includes(n.ym));
const _rpStForn = (k, yms) => { const s = yms.filter(m => _rpFornDe(m, k).some(_rpPassa)).map(m => _rpNeg(k, m)?.status || ''); return RP_ORD.find(x => s.includes(x)) ?? ''; };
// Assinatura do resultado (avisa quando o publicado difere do cálculo atual).
function _rpSig(res) {
  let h = 2166136261;
  const t = res.map(r => _rpKey(r) + r.estado + r.desfalqueKg + r.partes.map(p => p.k + p.cotaKg + (p.valor || '')).join()).sort().join('|');
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16) + ':' + t.length;
}

/* ───────── gráficos (SVG) ───────── */
const _rpCurto = u => v => u === 'r' ? (v >= 1e6 ? _rpN[1].format(v / 1e6) + ' mi' : v >= 1e3 ? _rpN[v % 1e3 ? 1 : 0].format(v / 1e3) + ' mil' : _rpN[0].format(v)) : _rpN[v / 1000 % 1 ? 1 : 0].format(v / 1000) + ' t';
function _rpRosca(tit, partes, fmt, extra) {
  const R = 82, EW = 26, C = 2 * Math.PI * R, tot = partes.reduce((s, p) => s + p.v, 0), vis = partes.filter(p => p.v > 0), gap = vis.length > 1 ? 3 : 0;
  let pos = 0;
  const arcos = vis.map(p => { const L = p.v / tot * C, h = `<circle class="rp-ft" r="${R}" cx="110" cy="110" stroke-width="${EW}" style="stroke:${p.c}" stroke-dasharray="${Math.max(.8, L - gap).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-pos - gap / 2).toFixed(2)}" data-tip="${_rpTip(p.n, [['Peso', fmt(p.v)], ['Fatia', _rpP1(p.v / tot * 100)]])}"/>`; pos += L; return h; }).join('');
  return `<div class="rp-rosca"><svg viewBox="0 0 220 220" role="img" aria-label="${_rpE(tit + ': ' + partes.map(p => p.n + ' ' + fmt(p.v)).join(', '))}"><circle class="rp-fd" r="${R}" cx="110" cy="110" stroke-width="${EW}"/><g transform="rotate(-90 110 110)">${arcos}</g><text x="110" y="103" class="rp-t1">${tit}</text><text x="110" y="127" class="rp-t2">${fmt(tot)}</text></svg>
    <div class="rp-leg">${partes.map(p => `<div><i style="background:${p.c}"></i><span title="${_rpE(p.n)}">${_rpE(p.n)}</span><b>${p.p != null ? _rpP1(p.p) : tot ? _rpP1(p.v / tot * 100) : '—'}${extra ? `<small>${fmt(p.v)}</small>` : ''}</b></div>`).join('')}</div></div>`;
}
function _rpGraf(fn, h = 230, id) { id = id || 'rpg' + RP.desenhos.length; RP.desenhos.push([id, fn, h]); return `<div class="rp-graf" id="${id}" style="min-height:${h}px"></div>`; }
function _rpEixo(max, W, H, p, fmt) {
  const b = max / 4 || 1, m = 10 ** Math.floor(Math.log10(b)), ps = [1, 2, 2.5, 5, 10].map(k => k * m).find(k => k >= b), topo = ps * Math.ceil(max / ps - 1e-9) || ps, y = v => p.t + (1 - v / topo) * (H - p.t - p.b);
  let g = '';
  for (let v = 0; v <= topo + ps / 2; v += ps) g += `<line x1="${p.l}" x2="${W - p.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${p.l - 8}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`;
  return { y, g };
}
const _rpColunas = (itens, u) => (W, H) => {
  const p = { l: 62, r: 8, t: 22, b: 34 }, max = Math.max(...itens.map(i => i.segs.reduce((s, x) => s + x.v, 0)), 1), { y, g } = _rpEixo(max, W, H, p, _rpCurto(u)), lg = (W - p.l - p.r) / itens.length, b = Math.min(46, lg * .62), f = v => u === 'r' ? _rpR(v) : _rpT(v);
  return `<g class="rp-gr">${g}</g>` + itens.map((it, i) => {
    const cx = p.l + lg * (i + .5), tot = it.segs.reduce((s, x) => s + x.v, 0), vis = it.segs.filter(s => s.v > 0), mxc = Math.max(4, Math.floor(lg / 8.6)), nome = it.n.length > mxc ? it.n.slice(0, mxc - 1) + '…' : it.n;
    let ac = 0;
    const bars = vis.map((s, j) => { const y0 = y(ac), y1 = y(ac += s.v), hh = Math.max(1, y0 - y1 - (j < vis.length - 1 ? 2 : 0)), yt = y0 - hh, r = j === vis.length - 1 ? Math.min(4, hh) : 0; return `<path class="rp-col" style="fill:${s.c}" d="M${cx - b / 2},${y0}V${yt + r}Q${cx - b / 2},${yt} ${cx - b / 2 + r},${yt}H${cx + b / 2 - r}Q${cx + b / 2},${yt} ${cx + b / 2},${yt + r}V${y0}Z"/>`; }).join('');
    return `<g class="rp-h${it.on ? ' rp-cl' : ''}" ${it.on || ''} data-tip="${_rpTip(it.n, [...it.segs.map(s => [s.n, f(s.v)]), ...(it.segs.length > 1 ? [['Total', f(tot)]] : [])])}"><rect class="rp-alvo" x="${cx - lg / 2}" y="${p.t}" width="${lg}" height="${H - p.t}"/>${bars}<text class="rp-rot" x="${cx}" y="${y(tot) - 6}">${lg > 46 ? _rpCurto(u)(Math.round(tot / 100) * 100) : ''}</text><text x="${cx}" y="${H - 12}" text-anchor="middle" class="rp-eixo">${_rpE(nome)}</text></g>`;
  }).join('');
};
const _rpLinhas = (xs, series, u) => (W, H) => {
  const p = { l: 62, r: 14, t: 12, b: 28 }, max = Math.max(...series.flatMap(s => s.v), 1), { y, g } = _rpEixo(max, W, H, p, _rpCurto(u)), lg = (W - p.l - p.r) / xs.length, x = i => p.l + lg * (i + .5), f = v => u === 'r' ? _rpR(v) : _rpT(v), cada = Math.ceil(xs.length / Math.max(1, Math.floor((W - p.l - p.r) / 52)));
  return `<g class="rp-gr">${g}${xs.map((m, i) => (xs.length - 1 - i) % cada ? '' : `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${m}</text>`).join('')}</g>` + series.map(s => `<path class="rp-ln" style="stroke:${s.c}" d="${s.v.map((v, i) => (i ? 'L' : 'M') + x(i) + ',' + y(v)).join('')}"/><circle r="4.5" style="fill:${s.c}" cx="${x(xs.length - 1)}" cy="${y(s.v[xs.length - 1])}"/>`).join('')
    + xs.map((m, i) => `<g class="rp-ev" data-tip="${_rpTip(m, series.map(s => [s.n, f(s.v[i])]))}"><rect class="rp-alvo" x="${x(i) - lg / 2}" y="${p.t}" width="${lg}" height="${H - p.t - p.b}"/><line x1="${x(i)}" x2="${x(i)}" y1="${p.t}" y2="${H - p.b}"/>${series.map(s => `<circle r="4.5" style="fill:${s.c}" cx="${x(i)}" cy="${y(s.v[i])}"/>`).join('')}</g>`).join('');
};
function _rpPintar(lista) {
  lista.forEach(([id, fn, H]) => { const el = document.getElementById(id); if (!el) return; const W = Math.max(280, Math.round(el.clientWidth)); el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${fn(W, H)}</svg>`; });
}
// Histórico: geral/grupo (desfalque, a cobrar, recuperado) ou do fornecedor (cota, recuperado).
function _rpHistFn() {
  const ms = _rpMesesHist().filter(m => RP.res.has(m)), k = RP.no.tipo === 'forn' ? RP.no.forn : '';
  const rec = m => k ? (_rpNeg(k, m) ? _rpNegRec(_rpNeg(k, m)) : 0) : _rpNegsDe([m]).reduce((s, n) => s + _rpNegF(n).rec, 0);
  const t = ms.map(m => { const l = _rpDoMes(m).filter(r => _rpPassa(r) && _rpNoOk(r.par)); return k ? { forn: _rpPorForn(l).get(k)?.kg || 0, desf: 0 } : _rpTotais(l); });
  const s = [...(k ? [] : [{ n: 'Desfalque', c: 'var(--rp-2)', v: t.map(x => x.desf) }]), { n: k ? 'Cota' : 'A cobrar', c: 'var(--rp-1)', v: t.map(x => x.forn) }, { n: 'Recuperado', c: 'var(--rp-3)', v: ms.map(rec) }];
  return _rpLinhas(ms.map(_rpMesC), s, 't');
}
function _rpHistDesenhar() { const el = document.getElementById('rp-hist'); if (el) _rpPintar([['rp-hist', _rpHistFn(), 220]]); }

/* ───────── barra de período e filtros ───────── */
function _rpTopo() {
  const uma = RP.mes.length === 1 ? RP.mes[0] : '', rot = RP.mes.length ? (uma ? MESES_NOME_DG[uma.slice(5) - 1] + ' de ' + uma.slice(0, 4) : `${_rpMesC(RP.mes[0])} a ${_rpMesC(RP.mes[RP.mes.length - 1])} (${RP.mes.length} meses)`) : 'Selecionar mês';
  const lbl = document.getElementById('rp-month-label'); if (lbl) lbl.textContent = rot;
  const box = document.getElementById('rp-estado'); if (!box) return;
  let h = '';
  if (_rpAdm()) {
    const ab = RP.mes.filter(_rpAberto);
    h += ab.length ? _rpSelo(uma ? 'Prévia · mês aberto' : 'Inclui mês aberto (prévia)', 'var(--accent)', 'ti-eye') : RP.mes.length ? _rpSelo('Mês fechado', 'var(--green)', 'ti-lock') : '';
    if (uma && !ab.length) {
      const p = RP.pub.get(uma), muda = p && RP.res.has(uma) && p.resumo?.sig !== _rpSig(_rpDoMes(uma));
      if (p) h += `<span class="mo-hint">Publicado v${p.versao} · ${new Date(p.publicado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>`;
      if (muda) h += _rpSelo('O cálculo atual difere do publicado', 'var(--amber)', 'ti-alert-triangle');
      if (!p || muda) h += `<button class="btn btn-primary" data-rp="publicar"><i class="ti ti-upload"></i> <span>${p ? 'Publicar nova versão' : 'Publicar para INSUMOS'}</span></button>`;
    }
  } else if (uma && RP.pub.get(uma)) { const p = RP.pub.get(uma); h += `<span class="mo-hint">Calculado pelo ADM · publicado v${p.versao} em ${new Date(p.publicado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}${p.publicado_nome ? ' por ' + _rpE(p.publicado_nome) : ''}</span>`; }
  box.innerHTML = h + (_rpAdm() ? '<button class="btn" data-rp="recalcular" title="Ler a base de novo e recalcular"><i class="ti ti-refresh"></i> <span>Recalcular</span></button>' : '');
}
// Grade igual à do Gerencial (_dgRenderMonthGrid). onclick direto, não data-rp:
// calendar.js barra a propagação dos cliques dentro de .cal-picker-dropdown.
function _rpMesGrade() {
  const box = document.getElementById('rp-month-inner');
  if (!box) return;
  const y = RP.viewAno, sel = new Set(RP.mes);
  box.innerHTML = `
    <div class="cal-header">
      <button class="cal-nav-btn" onclick="rpNavAno(-1)" type="button"><i class="ti ti-chevron-left"></i></button>
      <span class="cal-header-center" style="cursor:default">${y}</span>
      <button class="cal-nav-btn" onclick="rpNavAno(1)" type="button"><i class="ti ti-chevron-right"></i></button>
    </div>
    <div class="cal-month-grid">${MESES_ABREV_DG.map((n, m) => `<button class="cal-grid-item${sel.has(y + '-' + String(m + 1).padStart(2, '0')) ? ' active' : ''}" onclick="rpSelMes(${m}, event)" type="button">${n}</button>`).join('')}</div>`;
}
window.rpNavAno = d => { RP.viewAno += d; _rpMesGrade(); };
// Clique = um mês (fecha e recalcula, como no Gerencial). Shift+clique = do mês atual até ele.
window.rpSelMes = (m, e) => {
  const ym = RP.viewAno + '-' + String(m + 1).padStart(2, '0');
  let l = [ym];
  if (e?.shiftKey && RP.mes.length) { const [a, z] = [RP.mes[0], ym].sort(); l = RP.meses.filter(x => x >= a && x <= z); if (!l.length) l = [ym]; }
  _rpFechaMes();
  _rpIr(l);
};
const RP_FILTROS = [{ k: 'regs', label: 'Regional', icon: 'ti-users-group', de: p => p.regional }, { k: 'cens', label: 'Central', icon: 'ti-building-warehouse', de: p => p.central }, { k: 'mats', label: 'Material', icon: 'ti-box', de: p => p.material }];
function _rpFiltrosHtml() {
  const grupos = [['fornecedor', 'ti-truck', 'Por Fornecedor — fornecedor → itens'], ['regional', 'ti-users-group', 'Por Regional — regional → central → itens'], ['central', 'ti-building-warehouse', 'Por Central — central → itens'], ['material', 'ti-box', 'Por Material — material → itens']];
  const filtros = RP_FILTROS.map(x => {
    const ap = RP.F[x.k], ab = RP.fAberto === x.k, rot = ap.size === 1 ? [...ap][0] : ap.size > 1 ? `${x.label} (${ap.size})` : x.label;
    let ops = '';
    if (ab) {
      const q = normalizeText(RP.fBusca).toLowerCase(), l = [...new Set(RP.mes.flatMap(_rpDoMes).map(r => x.de(r.par)))].sort((a, b) => a.localeCompare(b, 'pt-BR')).filter(v => !q || normalizeText(v).toLowerCase().includes(q));
      ops = l.length ? l.map((v, n) => `<label class="micro-filter-option" for="rpf-${n}"><input type="checkbox" id="rpf-${n}" ${RP.fPend.has(v) ? 'checked' : ''} data-rpc="fMarcar" data-v="${_rpE(v)}"><span class="micro-filter-option-label" title="${_rpE(v)}">${_rpE(v)}</span></label>`).join('') : '<div style="padding:12px 10px;color:var(--text3);font-size:13.5px;text-align:center">Nenhum resultado</div>';
    }
    return `<div class="micro-filter-group mo-fg"><button class="micro-filter-trigger${ap.size ? ' active' : ''}" data-rp="fAbrir" data-v="${x.k}"><i class="ti ${x.icon}"></i><span>${_rpE(rot)}</span><i class="ti ti-chevron-down micro-filter-chev${ab ? ' open' : ''}"></i></button>
      <div class="micro-filter-dropdown${ab ? ' open' : ''}"><div class="micro-filter-search-wrap"><i class="ti ti-search"></i><input class="micro-filter-search" id="rpf-busca" type="text" placeholder="Buscar ${x.label.toLowerCase()}…" value="${_rpE(ab ? RP.fBusca : '')}" data-rpi="fBuscar"></div><div class="micro-filter-options">${ops}</div>
      <div class="micro-filter-footer"><button class="btn btn-filter-clear" data-rp="fLimpar" data-v="${x.k}"><i class="ti ti-filter-off"></i> Limpar</button><button class="btn" data-rp="fFechar"><i class="ti ti-x"></i> Cancelar</button><button class="btn btn-primary" data-rp="fAplicar" data-v="${x.k}"><i class="ti ti-check"></i> Aplicar</button></div></div></div>`;
  }).join('');
  return `<div class="micro-filter-bar mo-filter-bar"><div class="micro-group-mode mp-grupos${RP.q.trim() ? ' mp-grupos-off' : ''}" role="group" aria-label="Agrupar a lista">${grupos.map(([k, i, t]) => `<button class="${RP.grupo === k ? 'active' : ''}" data-rp="grupo" data-v="${k}" title="${t}" aria-label="${t}" aria-pressed="${RP.grupo === k}"><i class="ti ${i}"></i></button>`).join('')}</div><div class="micro-filter-divider"></div>${filtros}
    ${RP.F.regs.size + RP.F.cens.size + RP.F.mats.size ? '<button class="btn btn-sm mo-limpar" data-rp="fTudo"><i class="ti ti-filter-off"></i> Limpar filtros</button>' : ''}</div>`;
}

/* ───────── lista (mesma das Operações, mural-painel.js) ───────── */
// Folha = fornecedor × central × material × mês. A aba decide quais folhas
// aparecem; o número do grupo é sempre o total dele.
function _rpFolhas(itens) {
  const out = [];
  itens.forEach(r => {
    const b = { r, reg: r.par.regional, cen: r.par.central, mat: r.par.material, ym: r.par.ym, key: _rpKey(r) };
    if (r.estado === 'desfalque') r.partes.forEach(p => { if (p.tipo === 'forn' && p.cotaKg) { const n = _rpNeg(p.k, r.par.ym); out.push({ ...b, forn: p.k, nome: p.nome, kg: p.cotaKg, v: p.valor, st: n?.status || '', n }); } });
    else if (r.estado === 'bloqueado') { const fs = r.partes.filter(p => p.tipo === 'forn'); (fs.length ? fs : [{ k: '', nome: 'Sem fornecedor identificado' }]).forEach((p, i) => out.push({ ...b, forn: p.k, nome: p.nome, kg: 0, v: 0, st: 'trav', i })); }
  });
  return out;
}
const _rpContar = L => Object.fromEntries(Object.entries(RP_ABAS).map(([k, a]) => [k, L.filter(x => a[2](x.st) && !(x.st === 'trav' && x.i)).length]));
const _rpNoAttr = no => `data-rp="no" data-no="${_rpE(JSON.stringify(no))}"`;
function _rpListaHtml(itens) {
  const todos = _rpFolhas(itens), no = RP.no, g = RP.grupo, termos = RP.q.split(/[,;]+/).map(t => normalizeText(t.trim())).filter(Boolean), ent = RP.lEnt ? ' entrando' : ''; RP.lEnt = false;
  const vis = todos.filter(x => RP_ABAS[RP.aba][2](x.st) && (RP.aba !== 'trav' || !RP.mot || x.r.motivos.some(m => m.c === RP.mot))), cont = _rpContar(todos);
  if (RP.rec) return `<section class="mp-lista recolhida${ent}"><button class="mp-lista-abrir" data-rp="lista" title="Mostrar a lista" aria-label="Mostrar a lista" aria-expanded="false"><i class="ti ti-layout-sidebar-left-expand"></i><span>Lista · ${cont.novo} a negociar</span></button></section>`;
  const nAba = n => ({ novo: `${n} a negociar`, and: `${n} em negociação`, fim: _rpPlural(n, 'encerrado', 'encerrados'), trav: _rpPlural(n, 'travado', 'travados') })[RP.aba];
  const agr = (ps, f) => { const m = new Map(); ps.forEach(x => { const k = f(x); (m.get(k) || m.set(k, []).get(k)).push(x); }); return m; };
  const soma = ps => ps.reduce((s, x) => [s[0] + x.kg, s[1] + x.v], [0, 0]), ordenar = m => [...m].sort((a, b) => soma(b[1])[1] - soma(a[1])[1] || String(a[0]).localeCompare(b[0], 'pt-BR'));
  const unicos = ps => ps.filter(x => !(x.st === 'trav' && x.i && g !== 'fornecedor'));
  const via = no.via || g, noItem = no.tipo === 'item', tem = no.tipo !== 'geral' && (via === 'fornecedor' ? !!no.forn : true);
  const ponto = st => `<span class="rp-pto" style="--c:${RP_ST[st][1]}" title="${RP_ST[st][0]}"></span>`;
  const val = (a, b) => `<span class="mp-dir"><span class="mp-v">${a}</span><small class="mo-hint mono">${b}</small></span>`;
  const folha = (x, recuo, v) => {   // v = visão do grupo; o que já está no grupo não se repete
    const tr = x.st === 'trav', eu = noItem && no.key === x.key && no.ym === x.ym && (!no.forn || no.forn === x.forn || tr), vv = v === 'regional' ? 'central' : v;
    const tit = vv === 'fornecedor' ? `${x.cen} · ${x.mat}` : tr ? (vv === 'material' ? x.cen : x.mat) : x.nome, sub = vv === 'fornecedor' ? x.reg : tr ? '' : vv === 'material' ? x.cen : x.mat;
    const pz = x.n?.dados?.prazo && (x.st === 'acordada' || x.st === 'negociando') ? ' · prazo ' + _rpData(x.n.dados.prazo).slice(0, 5) : '';
    const pre = [sub, RP.mes.length > 1 ? _rpMesC(x.ym) : ''].filter(Boolean).map(_rpE).join(' · ');
    return `<button class="mp-row mp-item ${recuo}${eu ? ' sel' : noItem ? ' apagado' : ''}" ${_rpNoAttr({ tipo: 'item', via: v, reg: x.reg, cen: x.cen, mat: x.mat, forn: tr && vv !== 'fornecedor' ? '' : x.forn, key: x.key, ym: x.ym })}>${ponto(x.st)}<span class="mp-nome"><b title="${_rpE(tit)}">${_rpE(tit)}</b><small>${pre}${pre ? ' · ' : ''}<span style="color:${RP_ST[x.st][1]}">${tr ? _rpE(x.r.motivos[0].t) : RP_ST[x.st][0] + pz}</span></small></span>${tr ? val(x.r.desfalqueKg ? _rpT(x.r.desfalqueKg) : '—', 'em dúvida') : val(_rpT(x.kg), _rpR(x.v))}</button>`;
  };
  const folhas = (ps, recuo, v) => unicos(ps).sort((a, b) => b.v - a.v || b.r.desfalqueKg - a.r.desfalqueKg).map(x => folha(x, recuo, v)).join('');
  const grupo = (alvo, tit, sub, gTodos, ab, sel, apag, recuo) => { const [kg, v] = soma(gTodos), st = RP_ORD.find(s => gTodos.some(x => x.st === s)) ?? ''; return `<button class="mp-row ${recuo}${sel ? ' sel' : apag ? ' apagado' : ''}" aria-expanded="${ab}" ${_rpNoAttr(alvo)}><i class="ti ti-chevron-${ab ? 'down' : 'right'} mp-chev"></i>${ponto(st)}<span class="mp-nome"><b title="${_rpE(tit)}">${_rpE(tit)}</b><small>${_rpE(sub)}</small></span>${val(_rpT(kg), _rpR(v))}</button>`; };
  const bloco = (a, h) => `<div class="mp-bloco${a ? ' aberto' : ''}">${h}</div>`;
  const simples = (tipo, campo, dado, recuoV) => ([k, ps]) => {
    const a = via === recuoV && no[campo] === k && tem, p0 = ps[0], alvo = { tipo, via: recuoV, [campo]: k, ...(tipo === 'central' ? { reg: p0.reg } : {}) };
    const sub = tipo === 'central' ? `${p0.reg} · ${nAba(unicos(ps).length)}` : `${_rpPlural(new Set(ps.map(x => x.cen)).size, 'central', 'centrais')} · ${nAba(unicos(ps).length)}`;
    return bloco(a, grupo(alvo, tipo === 'forn' ? p0.nome : k, sub, todos.filter(x => dado(x) === k), a, no.tipo === tipo && a, tem && !a, 'mp-reg') + (a ? folhas(ps, 'mp-item-1', recuoV) : ''));
  };
  const bForn = simples('forn', 'forn', x => x.forn, 'fornecedor'), bMat = simples('material', 'mat', x => x.mat, 'material'), bCen = simples('central', 'cen', x => x.cen, 'central');
  const bReg = ([reg, ps]) => {
    const a = via === 'regional' && no.reg === reg && tem, cens = ordenar(agr(ps, x => x.cen));
    let h = grupo({ tipo: 'regional', via: 'regional', reg }, reg, `${_rpPlural(cens.length, 'central', 'centrais')} · ${nAba(unicos(ps).length)}`, todos.filter(x => x.reg === reg), a, no.tipo === 'regional' && a, tem && !a, 'mp-reg');
    if (a) cens.forEach(([c, cs]) => { const ca = no.cen === c; h += `<div class="mp-sub${ca ? ' aberto' : ''}">${grupo({ tipo: 'central', via: 'regional', reg, cen: c }, c, nAba(unicos(cs).length), todos.filter(x => x.cen === c), ca, no.tipo === 'central' && ca, !!no.cen && !ca, 'mp-cen')}${ca ? folhas(cs, '', 'regional') : ''}</div>`; });
    return bloco(a, h);
  };
  let h = '', contar = cont;
  if (termos.length) {
    const casa = t => { const n = normalizeText(t); return termos.some(q => n.includes(q)); }, sec = (t, l, f) => l.length ? `<div class="mp-secao">${t} <b>${l.length}</b></div>` + l.map(f).join('') : '';
    h = sec('Fornecedores', ordenar(agr(vis.filter(x => x.forn && casa(x.nome)), x => x.forn)), bForn) + sec('Regionais', ordenar(agr(vis.filter(x => casa(x.reg)), x => x.reg)), bReg) + sec('Centrais', ordenar(agr(vis.filter(x => casa(x.cen)), x => x.cen)), bCen) + sec('Materiais', ordenar(agr(vis.filter(x => casa(x.mat)), x => x.mat)), bMat);
    contar = _rpContar(todos.filter(x => [x.nome, x.reg, x.cen, x.mat].some(casa)));
  } else h = ordenar(agr(vis, x => ({ fornecedor: x.forn, regional: x.reg, central: x.cen, material: x.mat })[g])).map({ fornecedor: bForn, regional: bReg, central: bCen, material: bMat }[g]).join('');
  const filtroMot = RP.aba === 'trav' && RP.mot ? `<div class="rp-mot"><span>Só: <b>${RP_MOT[RP.mot] || RP.mot}</b></span><button class="mo-link" data-rp="mot" data-v="">ver todos</button></div>` : '';
  return `<section class="mp-lista${ent}"><div class="mp-lista-head"><div class="mp-lista-linha"><label class="mp-busca"><i class="ti ti-search"></i><input id="rp-busca" type="text" placeholder="Buscar: fornecedor, central… (separe por vírgula)" value="${_rpE(RP.q)}" data-rpi="busca" aria-label="Buscar fornecedor, regional, central ou material"></label><button class="mp-lista-recolher" data-rp="lista" title="Recolher a lista para a lateral" aria-label="Recolher a lista" aria-expanded="true"><i class="ti ti-layout-sidebar-left-collapse"></i></button></div></div>
    <div class="mp-subabas" role="tablist">${Object.entries(RP_ABAS).map(([k, [n, i]]) => `<button class="mo-aba${RP.aba === k ? ' on' : ''}" role="tab" aria-selected="${RP.aba === k}" data-rp="aba" data-v="${k}"><i class="ti ${i}"></i>${n} <b>${contar[k]}</b></button>`).join('')}</div>
    ${filtroMot}<div class="mp-lista-corpo">${h || `<div class="empty-state" style="padding:24px"><p>${termos.length ? 'Nada nesta aba. O número de cada aba mostra onde está.' : `Nada em "${RP_ABAS[RP.aba][0]}" neste período.`}</p></div>`}</div></section>`;
}

/* ───────── painel ───────── */
const _rpPer = () => RP.mes.length === 1 ? _rpMesL(RP.mes[0]) : `${_rpMesL(RP.mes[0])} a ${_rpMesL(RP.mes[RP.mes.length - 1])} (${RP.mes.length} meses somados)`;
function _rpMigas() {
  const n = RP.no, l = (t, no) => `<button class="mo-link" ${_rpNoAttr(no).replace('data-rp="no"', 'data-rp="irPara"')}>${_rpE(t)}</button>`, p = [n.tipo === 'geral' ? '<span>Geral</span>' : l('Geral', { tipo: 'geral' })];
  if (n.tipo === 'regional') p.push('<span>Regional</span>');
  if (n.tipo === 'material') p.push('<span>Material</span>');
  if (n.tipo === 'forn') p.push('<span>Fornecedor</span>');
  if (n.tipo === 'central') { if (n.reg) p.push(l(n.reg, { tipo: 'regional', via: 'regional', reg: n.reg })); p.push('<span>Central</span>'); }
  if (n.tipo === 'item') {
    if (n.via === 'fornecedor' && n.forn) p.push(l(_rpNome(n.forn), { tipo: 'forn', via: 'fornecedor', forn: n.forn }));
    else if (n.via === 'material') p.push(l(n.mat, { tipo: 'material', via: 'material', mat: n.mat }));
    else if (n.via !== 'fornecedor') { if (n.via === 'regional') p.push(l(n.reg, { tipo: 'regional', via: 'regional', reg: n.reg })); p.push(l(n.cen, { tipo: 'central', via: n.via, reg: n.reg, cen: n.cen })); }
    p.push('<span>Item</span>');
  }
  return p.join('<span>›</span>');
}
function _rpNome(k) { for (const l of RP.res.values()) for (const r of l) for (const p of r.partes) if (p.k === k) return p.nome; return k; }
const _rpKpi = (rot, cor, b, s, small, attr) => `<${attr ? 'button' : 'div'} class="rp-kpi" ${cor ? `style="--c:${cor}"` : ''} ${attr || ''}><span class="rp-kpi-r">${cor ? '<i></i>' : ''}${rot}</span><b>${b}</b>${s ? `<span class="rp-kpi-s">${s}</span>` : ''}${small ? `<small>${small}</small>` : ''}</${attr ? 'button' : 'div'}>`;

function _rpGeral(itens) {
  const no = RP.no, gr = ['regional', 'central', 'material'].includes(no.tipo);
  if (gr) itens = itens.filter(r => _rpNoOk(r.par));
  const t = _rpTotais(itens), fs = [..._rpPorForn(itens).values()].sort((a, b) => b.valor - a.valor), ns = _rpNegsDe(RP.mes).map(n => [n, _rpNegF(n)]);
  const rec = ns.reduce((s, [, f]) => s + f.rec, 0), ac = ns.reduce((s, [n, f]) => s + (n.status === 'negociando' ? 0 : f.ac), 0), pc = v => t.desf ? _rpP1(v / t.desf * 100) : '0%', porR = RP.un === 'r';
  const cen = new Map();
  itens.filter(r => r.estado === 'desfalque').forEach(r => { const o = cen.get(r.par.central) || cen.set(r.par.central, { forn: 0, ini: 0, out: 0, val: 0, reg: r.par.regional }).get(r.par.central); r.partes.forEach(p => { if (p.tipo === 'forn') { o.forn += p.cotaKg; o.val += p.valor; } else if (p.tipo === 'ini') o.ini += p.cotaKg; else o.out += p.cotaKg; }); });
  const colF = [...fs].sort((a, b) => porR ? b.valor - a.valor : b.kg - a.kg).slice(0, 10).map(f => ({ n: f.nome, segs: [{ n: 'A cobrar', v: porR ? f.valor : f.kg, c: RP_COR.forn }], on: `data-rp="forn" data-v="${f.k}"` }));
  const colC = [...cen].sort((a, b) => porR ? b[1].val - a[1].val : b[1].forn + b[1].ini + b[1].out - a[1].forn - a[1].ini - a[1].out).slice(0, 16).map(([n, o]) => ({ n, segs: porR ? [{ n: 'A cobrar', v: o.val, c: RP_COR.forn }] : [{ n: 'Fornecedores', v: o.forn, c: RP_COR.forn }, { n: 'Estoque inicial', v: o.ini, c: RP_COR.ini }, { n: 'Sem fornecedor e reposição', v: o.out, c: RP_COR.sem }] }));
  const cols = RP.eixo === 'forn' ? colF : colC, motC = new Map();
  itens.forEach(r => { if (r.estado === 'bloqueado') new Set(r.motivos.map(m => m.c)).forEach(c => motC.set(c, (motC.get(c) || 0) + 1)); });
  const tab = itens.filter(r => r.estado !== 'zero');
  return `<div class="mp-cab"><div><div class="mp-migalhas">${_rpMigas()}</div><h2>${gr ? _rpE(no.tipo === 'regional' ? no.reg : no.tipo === 'central' ? no.cen : no.mat) : 'Desfalque de agregados'} · ${_rpPer()}</h2><p class="mo-hint">${_rpPlural(t.nDesf, 'item', 'itens')} com desfalque (central × material) · ${_rpPlural(fs.length, 'fornecedor envolvido', 'fornecedores envolvidos')}${t.sobra ? ` · sobra de ${_rpT(t.sobra)} em outros itens, que não compensa` : ''}</p></div></div>
  <div class="rp-kpis">${_rpKpi('Desfalque total', '', _rpT(t.desf), '', 'Teórico menos contagem, sem nenhum Y11/Y12')}${_rpKpi('A cobrar dos fornecedores', RP_COR.forn, _rpT(t.forn), _rpR(t.valor), pc(t.forn) + ' do desfalque')}${_rpKpi('Fica com a central', RP_COR.ini, _rpT(t.ini + t.sem + t.repos), pc(t.ini + t.sem + t.repos), `Estoque inicial ${_rpT(t.ini)}${t.sem ? ` · sem fornecedor ${_rpT(t.sem)}` : ''}${t.repos ? ` · reposição ${_rpT(t.repos)}` : ''}`)}${_rpKpi('Recuperado', 'var(--green)', _rpT(rec), `de ${_rpT(ac)} acordadas`, t.forn ? _rpP1(rec / t.forn * 100) + ' do que cabe aos fornecedores' : '')}${_rpKpiCam(_rpCaminhoes(fs), 'Por fornecedor, arredondado para cima')}</div>
  <div class="rp-dois"><div class="mp-card"><h4 class="mp-tit">Para quem vai o desfalque</h4>${t.desf ? _rpRosca('Desfalque', [{ n: 'Fornecedores', v: t.forn, c: RP_COR.forn }, { n: 'Estoque inicial', v: t.ini, c: RP_COR.ini }, ...(t.sem ? [{ n: 'Sem fornecedor', v: t.sem, c: RP_COR.sem }] : []), ...(t.repos ? [{ n: 'Saldo de reposição', v: t.repos, c: RP_COR.repos }] : [])], v => _rpT(v, 1), true) : '<p class="mo-hint">Sem desfalque no período.</p>'}</div>
    <div class="mp-card"><h4 class="mp-tit">Mês a mês <span class="mo-hint">${_rpLeg([['Desfalque', 'var(--rp-2)'], ['A cobrar', 'var(--rp-1)'], ['Recuperado', 'var(--rp-3)']])}</span></h4>${_rpGraf(_rpHistFn(), 220, 'rp-hist')}</div></div>
  <div class="mp-card"><h4 class="mp-tit rp-tit">Onde está o desfalque ${RP.eixo === 'cen' && !porR ? _rpLeg([['Fornecedores', RP_COR.forn], ['Estoque inicial', RP_COR.ini], ['Sem fornecedor e reposição', RP_COR.sem]]) : ''}<span class="rp-dir">${_rpSeg([['forn', 'Fornecedor'], ['cen', 'Central']], RP.eixo, 'eixo', 'Eixo')}${_rpSeg([['t', 'Toneladas'], ['r', 'R$']], RP.un, 'un', 'Unidade')}</span></h4>${cols.length ? _rpGraf(_rpColunas(cols, RP.un), 250) : '<p class="mo-hint">Sem desfalque no período.</p>'}</div>
  ${motC.size ? `<div class="mp-card"><h4 class="mp-tit">Por que há itens travados <span class="mo-hint">um item pode ter mais de um motivo</span></h4><div class="mp-chips">${[...motC].sort((a, b) => b[1] - a[1]).map(([c, n]) => `<button class="mp-chip" data-rp="mot" data-v="${c}">${RP_MOT[c] || c} <b>${n}</b></button>`).join('')}</div></div>` : ''}
  ${_rpTabela(tab)}`;
}

// Tabela "Todos os itens": funil por coluna (o mesmo motor de filtro das tabelas
// de Entradas/SAP — colFilterMeta/injectColFilterButtons em ui.js, com fonte e
// render próprios) e ordenação pelo título, sobre TODOS os itens (não só os 150 da tela).
const _rpEnt = r => r.partes.filter(p => p.tipo === 'forn').reduce((s, p) => s + p.kg, 0), _rpCob = r => r.partes.filter(p => p.tipo === 'forn').reduce((s, p) => s + p.cotaKg, 0);
const _rpSit = r => r.estado === 'bloqueado' ? 'Travado' : r.estado === 'sobra' ? 'Sobra' : 'Negociável';
const _rpNd = r => r.estado === 'bloqueado' || r.estado === 'sobra';
const _rpTn = kg => _rpN[2].format(kg / 1000);   // tabela: o "t" vai no aviso do título, não em cada célula
function _rpColunas_() {
  return [
    ['cen', 'Central', r => r.par.central, r => `<b>${_rpE(r.par.central)}</b>`],
    ['mat', 'Material', r => r.par.material, r => _rpE(r.par.material)],
    ...(RP.mes.length > 1 ? [['mes', 'Mês', r => r.par.ym, r => _rpMesC(r.par.ym), r => _rpMesC(r.par.ym)]] : []),
    ['ini', 'Est. Inicial', r => r.par.estIniKg, r => r.par.estIniKg == null ? '—' : _rpTn(r.par.estIniKg), 1],
    ['ent', 'Entradas', _rpEnt, r => _rpTn(_rpEnt(r)), 1],
    ['teo', 'Teórico', r => r.teoKg, r => _rpTn(r.teoKg), 1],
    ['real', 'Real', r => r.par.estFimKg, r => r.par.estFimKg == null ? '—' : _rpTn(r.par.estFimKg), 1],
    ['desf', 'Desfalque', r => r.estado === 'bloqueado' ? null : r.estado === 'sobra' ? -r.sobraKg : r.desfalqueKg, r => r.estado === 'bloqueado' ? '—' : r.estado === 'sobra' ? `<span class="mo-hint">sobra ${_rpTn(r.sobraKg)}</span>` : _rpTn(r.desfalqueKg), 1],
    ['pct', '% fornec.', r => _rpNd(r) || !r.desfalqueKg ? null : _rpCob(r) / r.desfalqueKg * 100, r => _rpNd(r) ? '—' : _rpP1(r.desfalqueKg ? _rpCob(r) / r.desfalqueKg * 100 : 0), 1],
    ['cob', 'A cobrar', r => _rpNd(r) ? null : _rpCob(r), r => _rpNd(r) ? '—' : _rpTn(_rpCob(r)), 1],
    ['sit', 'Situação', _rpSit, r => r.estado === 'bloqueado' ? _rpSelo('Travado', 'var(--urgente)', 'ti-lock') : r.estado === 'sobra' ? _rpSelo('Sobra', 'var(--text3)') : _rpSelo('Negociável', 'var(--green)', 'ti-check')],
  ].map(([id, rot, v, html, n]) => ({ id, rot, v, html, n: n === 1, txt: typeof n === 'function' ? n : r => html(r).replace(/<[^>]+>/g, '') }));
}
function _rpTabela(tab) {
  const cols = _rpColunas_(), sig = cols.map(c => c.id).join();
  if (RP.tabSig !== sig) { RP.tabSig = sig; colFilters.reposicoes = {}; }   // colunas mudaram (Mês entra/sai): filtros por índice não valem mais
  colFilterMeta.reposicoes = { tbodyId: 'rp-tb-itens', fields: cols.map(c => c.txt), fonte: () => RP.tabBase || [], render: () => _rpDesenhar() };
  RP.tabBase = tab;
  const vis = tab.filter(r => recordPassesColFilters('reposicoes', r)), MAX = 150, o = RP.ord, c = o && cols.find(x => x.id === o.c);
  vis.sort(c ? (a, b) => { const x = c.v(a), y = c.v(b); if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1; return (c.n ? x - y : String(x).localeCompare(String(y), 'pt-BR', { numeric: true })) * (o.dir === 'asc' ? 1 : -1); }
    : (a, b) => (b.estado === 'desfalque') - (a.estado === 'desfalque') || b.desfalqueKg - a.desfalqueKg);
  const filtro = moduleHasColFilter('reposicoes');
  return `<div class="mp-card"><h4 class="mp-tit rp-tit">Todos os itens <span class="mo-hint">${filtro ? `${vis.length} de ${tab.length} · ` : ''}em toneladas · clique para abrir a conta</span>${filtro ? '<span class="rp-dir"><button class="btn btn-sm" data-rp="tabLimpa"><i class="ti ti-filter-off"></i> Limpar filtros</button></span>' : ''}</h4>
    <div class="rp-tw"><table class="rp-t" id="rp-tab-itens"><thead><tr>${cols.map(x => `<th class="${x.n ? 'n ' : ''}${o?.c === x.id ? 'sort-' + o.dir : ''}" data-sort-col="${x.id}" data-rp="ord" data-v="${x.id}" title="Ordenar por ${x.rot}">${x.rot}<i class="mod-sort-icon"></i></th>`).join('')}</tr></thead>
    <tbody id="rp-tb-itens">${vis.slice(0, MAX).map(r => `<tr class="rp-clk" tabindex="0" data-rp="item" data-k="${_rpE(_rpKey(r))}" data-ym="${r.par.ym}">${cols.map(x => `<td${x.n ? ' class="n"' : ''}>${x.html(r)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="mo-hint" style="text-align:center;padding:18px">Nenhum item com esses filtros.</td></tr>`}</tbody></table></div>
    ${vis.length > MAX ? `<p class="mo-hint">Mostrando ${MAX} de ${vis.length} itens. Use o funil das colunas ou a lista para chegar aos outros.</p>` : ''}</div>`;
}

function _rpConta(r, eu) {
  const p = r.par, b = r.estado === 'bloqueado', L = (a, v, c = '') => `<div class="${c}"><span>${a}</span><span>${v}</span></div>`, ent = r.partes.filter(x => x.tipo === 'forn').reduce((s, x) => s + x.kg, 0), sem = r.partes.find(x => x.tipo === 'sem');
  let ci = 0;
  const cor = new Map(r.partes.map(x => [x.k, x.tipo === 'forn' ? RP_CORP[ci++ % RP_CORP.length] : x.tipo === 'ini' ? 'var(--rp-2)' : x.tipo === 'repos' ? 'var(--text2)' : 'var(--text3)'])), des = r.estado === 'desfalque' || (b && r.desfalqueKg > 0);
  return `${r.motivos.map(m => _rpNota(`<b>Travado:</b> ${_rpE(m.t)}.`, 'var(--urgente)', 'ti-lock')).join('')}${r.motivos.length ? '<p class="mo-hint">Fica fora dos totais até ser corrigido na origem. Os números abaixo são só para conferência.</p>' : ''}${r.avisos.map(a => _rpNota(_rpE(a))).join('')}
  <div class="rp-conta"><div><h4>Passo 1 · Quanto faltou</h4><div class="rp-linhas">
    ${L(`Estoque inicial (livro SAP${p.ancora ? `, base ${p.ancora}` : ''})`, p.estIniKg == null ? 'ausente' : _rpT(p.estIniKg, 3))}${p.estIniFisKg != null ? L('<span class="mo-hint">contagem do fim do mês anterior</span>', `<span class="mo-hint">${_rpT(p.estIniFisKg, 3)}</span>`) : ''}${L('+ Entradas de fornecedores', _rpT(ent, 3))}${r.reposKg ? L('+ NF de reposição (saldo)', _rpT(r.reposKg, 3)) : ''}${r.passagemKg ? L('+ NF que só passa por aqui (destino em outra central)', _rpT(r.passagemKg, 3)) : ''}${sem ? L('+ Entradas sem fornecedor (transferências)', _rpT(sem.kg, 3)) : ''}${L('− Saídas (consumo, transferências enviadas)', _rpT(-r.saidasKg, 3))}
    ${L('= Teórico', _rpT(r.teoKg, 3), 'eq')}${L(`− Real (contagem${p.fimData ? ' de ' + p.fimData : ''})`, p.estFimKg == null ? 'ausente' : _rpT(p.estFimKg, 3))}${r.estado === 'sobra' ? L('= Sobra', _rpT(r.sobraKg, 3), 'eq') : L('= Desfalque', p.estFimKg == null || p.estIniKg == null ? '—' : _rpT(r.desfalqueKg, 3), 'des')}</div>
    <p class="mo-hint">${r.fechKg ? `Ajustes Y11/Y12 de ${_rpT(r.fechKg, 3)} fora da conta. ` : ''}Pesos do SAP; a NF só diz de quem é.</p></div>
  <div><h4>Passo 2 · De quem é a participação</h4>${r.baseKg > 0 ? _rpRosca(des ? 'Desfalque' : 'Base', r.partes.map(x => ({ n: x.nome, v: des ? x.cotaKg : x.kg, p: x.pct, c: cor.get(x.k) })), v => _rpT(v, 1), false) : '<p class="mo-hint">Sem base para ratear.</p>'}</div></div>
  <div><h4 class="rp-h4">Passo 3 · Quanto cabe a cada um</h4><div class="rp-tw"><table class="rp-t"><thead><tr><th>Origem</th><th class="n">Peso na base</th><th class="n">Participação</th><th class="n">Cota do desfalque</th><th class="n">Preço médio R$/t</th><th class="n">Valor</th></tr></thead><tbody>${r.partes.map(x => `<tr class="${eu && x.k === eu ? 'rp-eu' : ''}"><td><span class="rp-q" style="background:${cor.get(x.k)}"></span>${_rpE(x.nome)}${x.tipo === 'ini' ? ' <span class="mo-hint">(fica com a central)</span>' : ''}</td><td class="n">${_rpT(x.kg, 3)}</td><td class="n">${_rpP(x.pct)}</td><td class="n">${_rpT(x.cotaKg, 3)}</td><td class="n">${x.tipo === 'forn' ? _rpN[2].format(x.preco ?? x.precoRef ?? 0) : '—'}</td><td class="n">${x.tipo === 'forn' && !b ? _rpR(x.valor) : '—'}</td></tr>`).join('')}<tr class="rp-tot"><td>Total</td><td class="n">${_rpT(r.baseKg, 3)}</td><td class="n">${r.baseKg > 0 ? '100,00%' : '—'}</td><td class="n">${_rpT(r.desfalqueKg, 3)}</td><td></td><td class="n">${b ? '—' : _rpR(r.partes.reduce((s, x) => s + (x.valor || 0), 0))}</td></tr></tbody></table></div>
    <p class="mo-hint">Participação = peso ÷ base. Cota = desfalque × participação, em quilos inteiros, e a soma fecha exata. Preço médio = valor das NFs do fornecedor ÷ toneladas das NFs (já convertidas). Custos SAP: ${p.custoSap ? 'R$ ' + _rpN[2].format(p.custoSap) + '/t' : 'ausente'}.</p></div>
  ${_rpNfs(r, eu)}`;
}
function _rpNfs(r, eu) {
  const ps = r.partes.filter(p => p.nfs.length && (!eu || p.k === eu || p.tipo === 'repos')), id = r.par.ym + _rpKey(r), n = ps.reduce((s, p) => s + p.nfs.length, 0), ab = RP.nfAb.has(id);
  if (!n) return '';
  return `<div><button class="btn btn-sm" data-rp="nfs" data-v="${_rpE(id)}"><i class="ti ti-truck-delivery"></i> ${ab ? 'Ocultar' : 'Ver'} ${_rpPlural(n, 'NF usada', 'NFs usadas')}</button>${ab ? `<div class="rp-tw" style="margin-top:10px"><table class="rp-t"><thead><tr><th>NF</th><th>Data SAP</th><th>Fornecedor</th><th class="n">Peso SAP</th><th class="n">Quantidade na NF</th><th class="n">NF convertida</th><th class="n">Diferença</th><th class="n">Valor</th></tr></thead><tbody>${ps.flatMap(p => p.nfs.map(x => { const d = x.pesoNf == null ? null : x.kg - x.pesoNf; return `<tr><td class="mono">${_rpE(x.nf)}</td><td>${_rpE(x.dt)}</td><td>${_rpE(p.nome)}${x.via ? ` <span class="mo-hint">via ${_rpE(x.via)}</span>` : ''}${x.est ? ' <span class="mo-hint">com estorno</span>' : ''}${p.tipo === 'repos' ? ' <span class="mo-hint">reposição</span>' : ''}</td><td class="n">${_rpT(x.kg, 3)}</td><td class="n">${_rpN[3].format(x.qtd)} ${_rpE(x.um)}</td><td class="n">${x.pesoNf == null ? 'sem fator' : _rpT(x.pesoNf, 3)}</td><td class="n">${d == null ? '—' : (d > 0 ? '+' : '') + _rpN[0].format(d) + ' kg'}</td><td class="n">${_rpR(x.valor)}</td></tr>`; })).join('')}</tbody></table></div>` : ''}</div>`;
}
function _rpItemCard(r, eu) {
  const id = r.par.ym + _rpKey(r), ab = RP.ab.has(id), p = r.partes.find(x => x.k === eu), b = r.estado === 'bloqueado', X = (a, v) => `<span class="rp-x"><small>${a}</small><b>${v}</b></span>`;
  return `<div class="rp-item${ab ? ' ab' : ''}" data-item="${_rpE(id)}"><button class="rp-ihead" aria-expanded="${ab}" data-rp="abre" data-v="${_rpE(id)}"><span class="rp-nm"><b>${_rpE(r.par.central)} · ${_rpE(r.par.material)}</b><small>${_rpE(r.par.regional)} · Agregado ${r.par.sub}${RP.mes.length > 1 ? ' · ' + _rpMesL(r.par.ym) : ''}</small></span>${X('Desfalque', b ? '—' : _rpT(r.desfalqueKg))}${p ? X('Participação', _rpP(p.pct)) + X('Cota', b ? '—' : _rpT(p.cotaKg)) + X('Valor', b ? '—' : _rpR(p.valor)) : ''}${b ? _rpSelo('Travado', 'var(--urgente)', 'ti-lock') : ''}<i class="ti ti-chevron-down rp-chev"></i></button>${ab ? `<div class="rp-ibody">${_rpConta(r, eu)}</div>` : ''}</div>`;
}
function _rpPainelItem(itens) {
  const no = RP.no, r = itens.find(x => x.par.ym === no.ym && _rpKey(x) === no.key);
  if (!r) { RP.no = { tipo: 'geral' }; return _rpGeral(itens); }
  const eu = no.forn, pe = r.partes.find(p => p.k === eu), b = r.estado === 'bloqueado';
  return `<div class="mp-cab"><div><div class="mp-migalhas">${_rpMigas()}</div><h2>${_rpE(r.par.central)} · ${_rpE(r.par.material)}</h2><p class="mo-hint">${_rpE(r.par.regional)} · Agregado ${r.par.sub} · ${_rpMesL(r.par.ym)}</p></div><div class="mp-cab-num"><b>${b ? '—' : _rpT(r.estado === 'sobra' ? r.sobraKg : r.desfalqueKg)}</b><span class="mo-hint">${b ? 'travado' : r.estado === 'sobra' ? 'de sobra' : 'de desfalque'}</span></div></div>
  ${pe && r.estado === 'desfalque' ? `<div class="rp-kpis">${_rpKpi(_rpE(pe.nome), RP_COR.forn, _rpT(pe.cotaKg), _rpR(pe.valor), _rpP(pe.pct) + ' de participação')}${_rpKpi('Negociação de ' + _rpMesL(r.par.ym), '', RP_ST[_rpNeg(eu, r.par.ym)?.status || ''][0], '', `Vale para todas as centrais do fornecedor<br><button class="btn btn-sm" style="margin-top:8px" data-rp="fornMes" data-v="${eu}" data-ym="${r.par.ym}"><i class="ti ti-heart-handshake"></i> Ver negociação</button>`)}</div>` : ''}<div class="mp-card rp-espaco">${_rpConta(r, eu || '')}</div>`;
}

function _rpForn(f, itens) {
  const um = RP.mes.length === 1 ? RP.mes[0] : '', st = _rpStForn(f.k, RP.mes), base = f.itens.reduce((s, i) => s + i.r.desfalqueKg, 0), ord = [...f.itens].sort((a, b) => b.p.valor - a.p.valor), trav = itens.filter(r => r.estado === 'bloqueado' && r.partes.some(p => p.k === f.k));
  return `<div class="mp-cab"><div style="min-width:0"><div class="mp-migalhas">${_rpMigas()}</div><h2>${_rpE(f.nome)}</h2><p class="mo-hint">Raiz do CNPJ ${f.k.replace(/^(..)(...)(...)$/, '$1.$2.$3')} · ${_rpPer()}</p></div><div class="mp-cab-num">${um ? _rpSelo(RP_ST[st][0], RP_ST[st][1]) : ''}<b>${_rpT(f.kg)}</b><span class="mo-hint mono">${_rpR(f.valor)}</span></div></div>
  <div class="rp-kpis">${_rpKpi('Cota do fornecedor', RP_COR.forn, _rpT(f.kg), _rpR(f.valor), `${_rpPlural(f.itens.length, 'item', 'itens')} em ${_rpPlural(f.cens.size, 'central', 'centrais')}`)}${_rpKpi('Desfalque nesses itens', '', _rpT(base), _rpP1(f.kg / base * 100) + ' é dele', 'O resto é do estoque inicial e de outras origens')}${_rpKpi('Preço médio', '', 'R$ ' + _rpN[2].format(f.kg ? f.valor / f.kg * 1000 : 0), 'por tonelada', 'Ponderado pela cota, das NFs dele')}${_rpKpi('Sobra no período', '', _rpT(f.sobra), 'não compensa', 'Só para você saber se ele citar')}${_rpKpiCam(_rpCaminhoes([f]), `Média de ${_rpPlural(_rpMediaCam(f.k)?.n || 0, 'NF', 'NFs')} dele, arredondado para cima`)}</div>
  <div class="rp-dois"><div class="mp-card"><h4 class="mp-tit">Cota por central e material</h4>${_rpGraf(_rpColunas(ord.slice(0, 8).map(({ r, p }) => ({ n: r.par.central + ' ' + r.par.material + (um ? '' : ' ' + _rpMesC(r.par.ym)), segs: [{ n: 'Cota', v: p.cotaKg, c: RP_COR.forn }], on: `data-rp="abreItem" data-v="${_rpE(r.par.ym + _rpKey(r))}"` })), 't'), 220)}</div><div class="mp-card"><h4 class="mp-tit">Mês a mês <span class="mo-hint">${_rpLeg([['Cota', 'var(--rp-1)'], ['Recuperado', 'var(--rp-3)']])}</span></h4>${_rpGraf(_rpHistFn(), 220, 'rp-hist')}</div></div>
  ${um ? _rpNegHtml(f, um) : `<div class="mp-card"><h4 class="mp-tit">Negociação</h4><p class="mo-hint">A negociação é por mês. Abra um mês:</p><div class="mp-chips">${RP.mes.filter(m => _rpFornDe(m, f.k).length).map(m => `<button class="mp-chip" data-rp="fornMes" data-v="${f.k}" data-ym="${m}">${_rpMesL(m)} · ${RP_ST[_rpNeg(f.k, m)?.status || ''][0]}</button>`).join('')}</div></div>`}
  <h4 class="mp-tit">A conta, item por item</h4>${ord.map(({ r }) => _rpItemCard(r, f.k)).join('')}${trav.length ? `<h4 class="mp-tit">Travados deste fornecedor</h4>${trav.map(r => _rpItemCard(r, f.k)).join('')}` : ''}`;
}

/* ───────── negociação ───────── */
function _rpNegHtml(f, ym) {
  const n = _rpNeg(f.k, ym), prev = _rpAberto(ym), docs = `<span class="rp-dir"><button class="btn btn-sm" data-rp="doc" data-v="pdf" ${prev ? 'disabled' : ''}><i class="ti ti-file-text"></i> PDF</button><button class="btn btn-sm" data-rp="doc" data-v="xls" ${prev ? 'disabled' : ''}><i class="ti ti-file-spreadsheet"></i> Excel</button></span>`;
  if (!n) return `<div class="mp-card" id="rp-neg"><h4 class="mp-tit rp-tit">Negociação ${docs}</h4>${prev ? _rpNota('Mês aberto é só prévia. A negociação abre depois do fechamento.', 'var(--accent)', 'ti-eye') : `<p class="mo-hint" style="max-width:68ch">Ao abrir, os números de ${_rpMesL(ym)} ficam congelados para este fornecedor. Se a base mudar depois, a tela avisa, mas não muda o que foi negociado.</p><div><button class="btn btn-primary" data-rp="novaNeg"><i class="ti ti-heart-handshake"></i> <span>Abrir negociação</span></button></div>`}</div>`;
  const its = n.congelado.itens, d = n.dados, fim = d.fim || {}, ac = _rpNegAc(n), rec = _rpNegRec(n), enc = n.status === 'concluida' || n.status === 'sem_acordo';
  const difs = its.map(i => { const r = _rpDoMes(ym).find(x => _rpKey(x) === i.key), p = r?.estado === 'desfalque' ? r.partes.find(x => x.k === f.k) : null; return { i, hoje: p?.cotaKg || 0, trav: r?.estado === 'bloqueado' }; }).filter(x => x.hoje !== x.i.kg);
  const novos = _rpFornDe(ym, f.k).filter(r => !its.some(i => i.key === _rpKey(r)));
  const sapDe = x => { const p = _rpAdm() && RP.B?.pares.get(x.key); if (!p) return ''; let kg = 0, dt = ''; p.movs.forEach(l => l.forEach(r => { if (REP_COMPRA.has(normMov(r.movimento)) && repNumNf(r.ref) === repNumNf(x.nf)) { kg += num(r.peso); dt = dt || r.dtLanc; } })); return kg ? `<span class="mo-hint">SAP ${dt}: ${_rpT(kg, 3)}</span>` : '<span style="color:var(--amber)">ainda não está no SAP</span>'; };
  return `<div class="mp-card" id="rp-neg"><h4 class="mp-tit rp-tit">Negociação <small class="mo-hint">números congelados em ${new Date(n.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}${n.criado_nome ? ' por ' + _rpE(n.criado_nome) : ''}</small>${docs}</h4>
  ${difs.length || novos.length ? _rpNota(`A base mudou depois de congelar: ${[...difs.map(x => `<b>${_rpKeyT(x.i.key)}</b> ${x.trav ? 'está travado hoje' : 'hoje daria ' + _rpT(x.hoje, 3)} (congelado ${_rpT(x.i.kg, 3)})`), ...novos.map(r => `<b>${_rpKeyT(_rpKey(r))}</b> entrou depois`)].join('; ')}. O negociado continua valendo.`) : ''}
  <div class="mp-chips" role="group" aria-label="Situação">${['negociando', 'acordada', 'concluida', 'sem_acordo'].map(k => `<button class="mp-chip${n.status === k ? ' ac-chip-on' : ''}" aria-pressed="${n.status === k}" data-rp="status" data-v="${k}"><span class="rp-pto" style="--c:${RP_ST[k][1]}"></span>${RP_ST[k][0]}</button>`).join('')}<span class="mo-hint" id="rp-salvo" style="margin-left:auto;align-self:center">${n.atualizado_nome ? `Última alteração: ${_rpE(n.atualizado_nome)}, ${new Date(n.atualizado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : ''}</span></div>
  <div class="rp-tw"><table class="rp-t"><thead><tr><th>Central · material</th><th class="n">Cota congelada</th><th class="n">Preço R$/t</th><th class="n">Valor</th><th class="n">Acordado (t)</th></tr></thead><tbody>${its.map((i, j) => `<tr><td>${_rpKeyT(i.key)}</td><td class="n">${_rpT(i.kg, 3)}</td><td class="n">${_rpN[2].format(i.preco)}</td><td class="n">${_rpR(i.valor)}</td><td class="n"><input class="form-input rp-num" id="rp-ac${j}" aria-label="Acordado ${_rpE(i.key)}" value="${_rpN[3].format(_rpAc(n, i) / 1000)}" data-rpc="acordado" data-k="${_rpE(i.key)}"></td></tr>`).join('')}<tr class="rp-tot"><td>Total</td><td class="n">${_rpT(_rpNegKg(n), 3)}</td><td></td><td class="n">${_rpR(its.reduce((s, i) => s + i.valor, 0))}</td><td class="n">${_rpT(ac, 3)}<br><span class="mo-hint">${_rpR(its.reduce((s, i) => s + _rpAcR(n, i), 0))}</span></td></tr></tbody></table></div>
  <div class="rp-campos"><label>Como será feita<select class="form-select" id="rp-forma" data-rpc="campo" data-v="forma"><option value="">Escolha…</option>${RP_FORMAS.map(x => `<option${d.forma === x ? ' selected' : ''}>${x}</option>`).join('')}</select></label><label>Prazo combinado<input class="form-input" id="rp-prazo" type="date" value="${_rpE(d.prazo || '')}" data-rpc="campo" data-v="prazo"></label><label>Contato no fornecedor<input class="form-input" id="rp-contato" value="${_rpE(d.contato || '')}" data-rpc="campo" data-v="contato"></label><label class="rp-lg">Observação<textarea class="form-input" id="rp-obs" rows="2" data-rpc="campo" data-v="obs">${_rpE(d.obs || '')}</textarea></label></div>
  <div class="rp-sec"><h4 class="mp-tit">NFs de reposição recebidas <span class="mo-hint">entram no estoque como saldo e não contam como entrada do fornecedor</span></h4>
    <div class="rp-progl"><div class="rp-prog" role="img" aria-label="Recuperado ${_rpT(rec)} de ${_rpT(ac)}"><i style="width:${ac ? Math.min(100, rec / ac * 100) : 0}%"></i></div><span class="mono">${_rpT(rec)} de ${_rpT(ac)}</span></div>
    ${(d.nfs || []).length ? `<div class="rp-tw"><table class="rp-t"><thead><tr><th>NF</th><th>Recebida em</th><th>Central · material</th><th class="n">Peso da NF</th><th></th><th></th></tr></thead><tbody>${d.nfs.map((x, j) => `<tr><td class="mono">${_rpE(x.nf)}</td><td>${_rpE(x.data)}</td><td>${_rpKeyT(x.key)}</td><td class="n">${_rpT(x.kg, 3)}</td><td>${sapDe(x)}</td><td class="n"><button class="btn btn-sm" data-rp="tiraNf" data-v="${j}" title="Desvincular esta NF"><i class="ti ti-link-off"></i></button></td></tr>`).join('')}</tbody></table></div>` : '<p class="mo-hint">Nenhuma NF vinculada ainda.</p>'}
    <div class="rp-campos rp-fim"><label>NF<input class="form-input" id="rp-nf" inputmode="numeric" placeholder="Número"></label><label>Central · material<select class="form-select" id="rp-nfkey">${its.map(i => `<option value="${_rpE(i.key)}">${_rpKeyT(i.key)}</option>`).join('')}</select></label><button class="btn" data-rp="addNf"><i class="ti ti-link"></i> <span>Vincular NF das Entradas</span></button></div></div>
  <div class="rp-sec"><h4 class="mp-tit">Conclusão ${enc ? _rpSelo(RP_ST[n.status][0], RP_ST[n.status][1]) : ''}</h4><div class="rp-campos"><label>Resultado<select class="form-select" id="rp-fres" data-rpc="fimc" data-v="res"><option value="">Em aberto</option>${RP_CONCL.map(x => `<option${fim.res === x ? ' selected' : ''}>${x}</option>`).join('')}</select></label><label>Data<input class="form-input" id="rp-fdata" type="date" value="${_rpE(fim.data || '')}" data-rpc="fimc" data-v="data"></label><label>Valor convertido (R$)<input class="form-input" id="rp-fval" inputmode="decimal" value="${fim.valor ? _rpN[2].format(fim.valor) : ''}" placeholder="0,00" data-rpc="fimc" data-v="valor"></label><label>Equivalente em t<input class="form-input" id="rp-fkg" inputmode="decimal" value="${fim.kgFin ? _rpN[3].format(fim.kgFin / 1000) : ''}" placeholder="0,000" data-rpc="fimc" data-v="kgFin"></label><label class="rp-lg">Como ficou combinado<textarea class="form-input" id="rp-ftxt" rows="2" data-rpc="fimc" data-v="txt">${_rpE(fim.txt || '')}</textarea></label></div></div>
  ${_rpAdm() ? '<div class="rp-sec"><div><button class="btn btn-sm" data-rp="apagaNeg"><i class="ti ti-trash"></i> Excluir negociação</button></div></div>' : ''}</div>`;
}
const _rpNegAtual = () => _rpNeg(RP.no.forn, RP.mes[0]);
// ponytail: grava a linha "dados" inteira (última gravação vence). Dois usuários no
// MESMO fornecedor e mês ao mesmo tempo é raro; se virar problema, gravar por campo.
async function _rpGravar(n, redesenha = true) {
  const s = document.getElementById('rp-salvo'); if (s) s.textContent = 'Salvando…';
  if (redesenha) _rpDesenhar();
  const { data, error } = await window.supabaseClient.from('rep_negociacoes').update({ status: n.status, dados: n.dados, atualizado_nome: _rpQuem() }).eq('raiz', n.raiz).eq('ym', n.ym).select().single();
  if (error) { toast('Falha ao salvar a negociação: ' + error.message, 'error'); await _rpCarregarNegs().catch(() => {}); _rpDesenhar(); return false; }
  RP.negs.set(n.raiz + '|' + n.ym, data);
  const s2 = document.getElementById('rp-salvo'); if (s2) s2.textContent = 'Salvo às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return true;
}
async function _rpAbrirNeg() {
  const k = RP.no.forn, ym = RP.mes[0];
  if (_rpAberto(ym)) return;
  // Congela sempre o cálculo de AGORA (base relida), nunca um número em memória.
  if (_rpAdm()) { repBaseDescartar(); await _rpBase(); RP.res.delete(ym); await _rpGarantir([ym]); }
  const rs = _rpFornDe(ym, k);
  if (!rs.length) { toast('Depois de recalcular, este fornecedor não tem cota neste mês.', 'error'); _rpDesenhar(); return; }
  const itens = rs.map(r => { const p = r.partes.find(x => x.k === k); return { key: _rpKey(r), central: r.par.central, material: r.par.material, regional: r.par.regional, kg: p.cotaKg, preco: p.preco ?? p.precoRef ?? 0, valor: p.valor, entregue: p.kg, indice: r.indice, nfs: p.nfs.map(x => ({ nf: x.nf, dt: x.dt, kg: x.kg, valor: x.valor })) }; });
  const { data, error } = await window.supabaseClient.from('rep_negociacoes').insert({ raiz: k, ym, nome: _rpNome(k), congelado: { itens, versao: RP.pub.get(ym)?.versao || null }, dados: {}, criado_nome: _rpQuem(), atualizado_nome: _rpQuem() }).select().single();
  if (error) { toast(error.code === '23505' ? 'Essa negociação já foi aberta por outra pessoa.' : 'Falha ao abrir a negociação: ' + error.message, 'error'); await _rpCarregarNegs().catch(() => {}); _rpDesenhar(); return; }
  RP.negs.set(k + '|' + ym, data);
  RP.aba = 'and';
  toast('Negociação aberta. Números congelados.', 'success');
  _rpDesenhar();
}
async function _rpAddNf() {
  const n = _rpNegAtual(), numero = repNumNf(document.getElementById('rp-nf').value), key = document.getElementById('rp-nfkey').value, [cen, mat] = key.split('|');
  if (numero === '0') return toast('Informe o número da NF.', 'error');
  if ((n.dados.nfs || []).some(x => repNumNf(x.nf) === numero && x.key === key)) return toast('Essa NF já está vinculada.', 'error');
  const achadas = (state.entradas || []).filter(e => repNumNf(e.nf) === numero && repRaiz(e.cnpjFornecedor) === n.raiz && (e.centralDestino || e.centralCompra) === cen && e.material === mat);
  if (!achadas.length) return toast(`NF ${numero} deste fornecedor não está nas Entradas de ${cen} · ${mat}. Importe as Entradas e tente de novo.`, 'error');
  const dt = e => (e.dtDescarga && e.dtDescarga !== '—') ? e.dtDescarga : e.dtEmissao, e0 = achadas.sort((a, b) => (parseDateTs(dt(b)) || 0) - (parseDateTs(dt(a)) || 0))[0], mesma = achadas.filter(e => dt(e) === dt(e0) && (e.chave || '') === (e0.chave || ''));
  if (_nfNeedsConversionWarning(e0.um, e0.material, e0.fornecedor) || !_normalizarUM(e0.um)) return toast(`A NF está em ${e0.um || 'unidade vazia'} sem fator de conversão nas Configurações.`, 'error');
  const kg = Math.round(mesma.reduce((s, e) => s + _convertNfPesoToKg(e.peso, e.um, e.material, e.fornecedor), 0) * 1000) / 1000;
  n.dados = { ...n.dados, nfs: [...(n.dados.nfs || []), { nf: numero, chave: e0.chave || '', data: dt(e0), key, kg }] };
  if (await _rpGravar(n, false)) { toast(`NF ${numero} vinculada como saldo de reposição (${_rpT(kg, 3)}).`, 'success'); _rpReposMudou(); reposicoesRender(); }
}

async function _rpPublicar() {
  const ym = RP.mes[0];
  if (!_rpAdm() || RP.mes.length !== 1 || _rpAberto(ym)) return;
  if (!_cbSuportado()) return toast('Este navegador não suporta compressão — não dá para publicar.', 'error');
  repBaseDescartar(); await _rpBase(); RP.res.delete(ym); await _rpGarantir([ym]); _rpDesenhar();
  const res = _rpDoMes(ym), t = _rpTotais(res), v = (RP.pub.get(ym)?.versao || 0) + 1;
  if (!res.length) return toast('Nenhum item para publicar neste mês.', 'error');
  if (!confirm(`Publicar ${_rpMesL(ym)} (versão ${v}) para o INSUMOS?\n\nDesfalque ${_rpT(t.desf)} · a cobrar ${_rpT(t.forn)} (${_rpR(t.valor)}) · ${_rpPlural(t.trav, 'item travado', 'itens travados')}.`)) return;
  _rpStatus('Publicando…');
  const json = JSON.stringify({ formato: 1, ym, itens: res }), [hash, gz] = await Promise.all([_cbSha256Hex(json), _cbGzipString(json)]);
  const { error } = await window.supabaseClient.from('rep_publicacoes').insert({ ym, versao: v, payload: await _dgFzB64DeBlob(gz), hash, resumo: { sig: _rpSig(res), desf: t.desf, forn: t.forn, valor: t.valor, trav: t.trav }, publicado_nome: _rpQuem() });
  _rpStatus('');
  if (error) return toast('Falha ao publicar: ' + error.message, 'error');
  await _rpCarregarPubs().catch(() => {});
  toast(`${_rpMesL(ym)} publicado (versão ${v}).`, 'success');
  _rpDesenhar();
}

/* ───────── documento do fornecedor (PDF e Excel) ───────── */
// SÓ dados do próprio fornecedor: entregue × índice de falta = a repor. Sem base,
// participação, estoque inicial ou desfalque total (por eles se chega ao concorrente).
function _rpDocDados() {
  const k = RP.no.forn, ym = RP.mes[0], n = _rpNeg(k, ym);
  const itens = n ? n.congelado.itens : _rpFornDe(ym, k).map(r => { const p = r.partes.find(x => x.k === k); return { central: r.par.central, material: r.par.material, kg: p.cotaKg, preco: p.preco ?? p.precoRef ?? 0, valor: p.valor, entregue: p.kg, indice: r.indice, nfs: p.nfs }; });
  return { nome: n?.nome || _rpNome(k), ym, itens, kg: itens.reduce((s, i) => s + i.kg, 0), valor: itens.reduce((s, i) => s + i.valor, 0), nfs: itens.flatMap(i => i.nfs.map(x => ({ nf: x.nf, dt: x.dt, kg: x.kg, valor: x.valor, central: i.central, material: i.material }))) };
}
function _rpDocPdf() {
  const d = _rpDocDados(), e = _rankEsc, agora = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }), td = (v, r) => `<td${r ? ' style="text-align:right;font-family:\'JetBrains Mono\',monospace;white-space:nowrap"' : ''}>${v}</td>`, th = l => l.map(([t, r]) => `<th${r ? ' style="text-align:right"' : ''}>${t}</th>`).join('');
  const bodyHtml = `<style>.rk-table tr{page-break-inside:avoid}.rp-tot td{font-weight:800;border-top:2px solid var(--dgr-table-border-forte,rgba(255,255,255,.14))}.rp-expl{font-size:11px;color:var(--dgr-text-dim,#94a3b8);margin:8px 0 18px}</style>
    <div class="rk-table-wrap"><div class="rk-table-head"><span class="rk-table-head-title">Cálculo por central e material</span></div><table class="rk-table"><thead><tr>${th([['Central'], ['Material'], ['Entregue por vocês (t)', 1], ['Índice de falta', 1], ['A repor (t)', 1], ['R$/t', 1], ['Valor', 1]])}</tr></thead><tbody>${d.itens.map(i => `<tr>${td(e(i.central))}${td(e(i.material))}${td(_rpN[3].format(i.entregue / 1000), 1)}${td(_rpN[4].format(i.indice) + '%', 1)}${td(_rpN[3].format(i.kg / 1000), 1)}${td(_rpN[2].format(i.preco), 1)}${td(_rpR(i.valor), 1)}</tr>`).join('')}<tr class="rp-tot"><td colspan="4">Total</td>${td(_rpN[3].format(d.kg / 1000), 1)}<td></td>${td(_rpR(d.valor), 1)}</tr></tbody></table></div>
    <p class="rp-expl">Índice de falta: quanto faltou para cada tonelada que passou pela central no mês, neste material. A repor = entregue × índice, arredondado ao quilo. Valor pelo preço médio das próprias notas no mês.</p>
    <div class="rk-table-wrap"><div class="rk-table-head"><span class="rk-table-head-title">Suas notas fiscais consideradas</span><span class="rk-table-head-cap">${_rpPlural(d.nfs.length, 'nota', 'notas')}</span></div><table class="rk-table"><thead><tr>${th([['NF'], ['Data'], ['Central'], ['Material'], ['Peso recebido (t)', 1], ['Valor', 1]])}</tr></thead><tbody>${d.nfs.map(x => `<tr>${td(e(x.nf))}${td(e(x.dt))}${td(e(x.central))}${td(e(x.material))}${td(_rpN[3].format(x.kg / 1000), 1)}${td(_rpR(x.valor), 1)}</tr>`).join('')}</tbody></table></div>`;
  _openRelWindow(_buildRankingShellHTML({ periodoBadge: `Gerado em ${agora}`, periodo: _rpMesL(d.ym), now: agora, kpis: [{ value: _rpT(d.kg, 3), label: 'a repor', color: '#f59e0b' }, { value: _rpR(d.valor), label: 'valor de referência', color: '#3b82f6' }, { value: d.itens.length, label: d.itens.length === 1 ? 'item' : 'itens', color: '#22c55e' }] },
    { pageTitle: `Reposição — ${d.nome} — ${_rpMesL(d.ym)}`, badge: 'Reposição de agregados', title: 'Demonstrativo de reposição', subtitle: `${d.nome} · competência ${_rpMesL(d.ym)}`, bodyHtml, notaRodape: 'Pesos pelo recebimento registrado no SAP.' }));
}
function _rpDocXls() {
  const d = _rpDocDados(), t = v => Math.round(v) / 1000, ws = XLSX.utils.aoa_to_sheet([['Fornecedor', d.nome], ['Competência', _rpMesL(d.ym)], [], ['Central', 'Material', 'Entregue (t)', 'Índice de falta (%)', 'A repor (t)', 'R$/t', 'Valor (R$)'], ...d.itens.map(i => [i.central, i.material, t(i.entregue), Math.round(i.indice * 1e4) / 1e4, t(i.kg), Math.round(i.preco * 100) / 100, i.valor]), ['Total', '', '', '', t(d.kg), '', Math.round(d.valor * 100) / 100]]);
  const ws2 = XLSX.utils.aoa_to_sheet([['NF', 'Data', 'Central', 'Material', 'Peso recebido (t)', 'Valor (R$)'], ...d.nfs.map(x => [x.nf, x.dt, x.central, x.material, t(x.kg), Math.round(x.valor * 100) / 100])]);
  const fmt = (w, cols, de) => { const R = XLSX.utils.decode_range(w['!ref']); for (let r = de; r <= R.e.r; r++) for (const [c, z] of cols) { const x = w[XLSX.utils.encode_cell({ r, c })]; if (x && x.t === 'n') x.z = z; } };
  fmt(ws, [[2, '#,##0.000'], [3, '0.0000'], [4, '#,##0.000'], [5, '#,##0.00'], [6, '#,##0.00']], 4); fmt(ws2, [[4, '#,##0.000'], [5, '#,##0.00']], 1);
  ws['!cols'] = [22, 24, 14, 18, 14, 12, 14].map(wch => ({ wch })); ws2['!cols'] = [12, 12, 12, 24, 18, 14].map(wch => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Reposição'); XLSX.utils.book_append_sheet(wb, ws2, 'Notas fiscais');
  XLSX.writeFile(wb, `reposicao_${normalizeText(d.nome).replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40)}_${d.ym}.xlsx`);
}

/* ───────── desenho ───────── */
function _rpDesenhar() {
  const root = document.getElementById('rp-root');
  if (!root) return;
  _rpTopo();
  // Mês sem dado (ou ainda não publicado): diz por quê em vez de voltar sozinho para outro mês.
  if (!RP.mes.some(m => _rpDoMes(m).length)) {
    const per = RP.mes.length ? _rpPer() : '';
    root.innerHTML = `<div class="empty-state"><i class="ti ti-scale"></i><p>${_rpAdm() ? (RP.meses.length ? `Nenhum movimento SAP nem contagem de agregado em ${per}.` : 'Nenhum movimento SAP de agregado na base deste navegador.') : per ? `O ADM ainda não publicou ${per}.` : 'O ADM ainda não publicou nenhum mês.'}</p></div>`;
    return;
  }
  RP.desenhos = [];
  const itens = _rpItens(), f = RP.no.tipo === 'forn' ? _rpPorForn(itens).get(RP.no.forn) : null;
  if (RP.no.tipo === 'forn' && !f) RP.no = { tipo: 'geral' };
  const sc = root.querySelector('.mp-lista-corpo')?.scrollTop, ae = document.activeElement, foco = ae?.id, pos = ae?.selectionStart;
  root.innerHTML = `<div class="mp-root">${_rpFiltrosHtml()}<div class="mp">${_rpListaHtml(itens)}<section class="mp-painel">${RP.no.tipo === 'item' ? _rpPainelItem(itens) : f ? _rpForn(f, itens) : _rpGeral(itens)}</section></div></div>`;
  _rpPintar(RP.desenhos);
  const ti = document.getElementById('rp-tab-itens');
  if (ti && typeof injectColFilterButtons === 'function') injectColFilterButtons(ti, 'reposicoes');
  const c = root.querySelector('.mp-lista-corpo'); if (c && sc) c.scrollTop = sc;
  if (foco && root.contains(document.getElementById(foco))) { const e = document.getElementById(foco); e.focus({ preventScroll: true }); try { e.setSelectionRange(pos, pos); } catch (_) { /* select/date */ } }
}

/* ───────── ações ───────── */
const _rpTopoPg = () => window.scrollTo({ top: 0 });
async function _rpIr(meses) { RP.mes = meses; if (RP.no.tipo === 'item' && !meses.includes(RP.no.ym)) RP.no = { tipo: 'geral' }; RP.mot = ''; await reposicoesRender(); }
const RP_ACOES = {
  recarregar() { RP.carga = null; reposicoesRender(); },
  async recalcular() { repBaseDescartar(); RP.res.clear(); RP.carga = null; await reposicoesRender(); },
  publicar: _rpPublicar,
  grupo(b) { RP.grupo = b.dataset.v; RP.no = { tipo: 'geral' }; _rpDesenhar(); },
  aba(b) { RP.aba = b.dataset.v; RP.mot = ''; _rpDesenhar(); },
  mot(b) { RP.mot = b.dataset.v; RP.aba = 'trav'; _rpDesenhar(); },
  eixo(b) { RP.eixo = b.dataset.v; _rpDesenhar(); },
  // 1º clique: texto crescente, número decrescente (maior no topo); 3º clique volta à ordem padrão.
  ord(b, e) {
    if (e.target.closest('.cf-btn, .col-resizer')) return;
    const c = b.dataset.v, num = b.classList.contains('n'), o = RP.ord, ini = num ? 'desc' : 'asc';
    RP.ord = o?.c !== c ? { c, dir: ini } : o.dir === ini ? { c, dir: ini === 'asc' ? 'desc' : 'asc' } : null;
    _rpDesenhar();
  },
  tabLimpa() { colFilters.reposicoes = {}; _rpDesenhar(); },
  un(b) { RP.un = b.dataset.v; _rpDesenhar(); },
  // Clique no que já está aberto volta um nível, como nas Operações.
  no(b) {
    const n = JSON.parse(b.dataset.no), a = RP.no, mesmo = a.tipo === n.tipo && ['via', 'reg', 'cen', 'mat', 'forn', 'key', 'ym'].every(k => (a[k] || '') === (n[k] || ''));
    if (!mesmo) RP.no = n;
    else if (n.tipo === 'item') RP.no = n.via === 'fornecedor' ? { tipo: 'forn', via: n.via, forn: n.forn } : n.via === 'material' ? { tipo: 'material', via: n.via, mat: n.mat } : { tipo: 'central', via: n.via, reg: n.reg, cen: n.cen };
    else if (n.tipo === 'central' && n.via === 'regional') RP.no = { tipo: 'regional', via: 'regional', reg: n.reg };
    else RP.no = { tipo: 'geral' };
    if (RP.no.tipo === 'forn' && !RP.no.forn) RP.no = { tipo: 'geral' };
    _rpDesenhar(); _rpTopoPg();
  },
  irPara(b) { RP.no = JSON.parse(b.dataset.no); _rpDesenhar(); _rpTopoPg(); },
  forn(b) { _rpIrForn(b.dataset.v); },
  async fornMes(b) { RP.no = { tipo: 'forn', via: 'fornecedor', forn: b.dataset.v }; if (RP.mes.length !== 1 || RP.mes[0] !== b.dataset.ym) await _rpIr([b.dataset.ym]); _rpIrForn(b.dataset.v); },
  item(b) {
    const r = _rpDoMes(b.dataset.ym).find(x => _rpKey(x) === b.dataset.k);
    if (!r) return;
    RP.no = { tipo: 'item', via: RP.grupo, reg: r.par.regional, cen: r.par.central, mat: r.par.material, forn: '', key: b.dataset.k, ym: b.dataset.ym };
    if (r.estado === 'bloqueado') RP.aba = 'trav';
    _rpDesenhar(); _rpTopoPg();
  },
  abre(b) { const v = b.dataset.v; RP.ab.has(v) ? RP.ab.delete(v) : RP.ab.add(v); _rpDesenhar(); },
  abreItem(b) { RP.ab.add(b.dataset.v); _rpDesenhar(); [...document.querySelectorAll('#rp-root [data-item]')].find(x => x.dataset.item === b.dataset.v)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); },
  nfs(b) { const v = b.dataset.v; RP.nfAb.has(v) ? RP.nfAb.delete(v) : RP.nfAb.add(v); _rpDesenhar(); },
  lista() {
    if (RP.lAnim) return;
    RP.rec = !RP.rec;
    try { localStorage.setItem('reposicoes.lista', RP.rec ? '1' : '0'); } catch (_) { /* sem storage */ }
    const l = document.querySelector('#rp-root .mp-lista');
    if (!l || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return _rpDesenhar();
    RP.lAnim = RP.lEnt = true;
    [...l.children].forEach(c => { c.style.width = c.offsetWidth + 'px'; });
    l.classList.add('mp-anim'); l.classList.toggle('recolhida', RP.rec);
    setTimeout(() => { RP.lAnim = false; _rpDesenhar(); }, MP_LISTA_ANIM_MS);
  },
  fAbrir(b) { const k = b.dataset.v; if (RP.fAberto === k) return RP_ACOES.fFechar(); RP.fAberto = k; RP.fPend = new Set(RP.F[k]); RP.fBusca = ''; _rpDesenhar(); document.querySelector('#rp-root .micro-filter-dropdown.open #rpf-busca')?.focus(); },
  fFechar() { RP.fAberto = null; RP.fPend = null; RP.fBusca = ''; _rpDesenhar(); },
  fAplicar(b) { RP.F[b.dataset.v] = new Set(RP.fPend); RP_ACOES.fFechar(); },
  fLimpar(b) { RP.F[b.dataset.v] = new Set(); RP_ACOES.fFechar(); },
  fTudo() { RP_FILTROS.forEach(x => { RP.F[x.k] = new Set(); }); _rpDesenhar(); },
  async novaNeg(b) { b.disabled = true; try { await _rpAbrirNeg(); } catch (e) { toast('Falha ao abrir a negociação: ' + (e.message || e), 'error'); _rpDesenhar(); } },
  status(b) { const n = _rpNegAtual(); n.status = b.dataset.v; RP.aba = n.status === 'concluida' || n.status === 'sem_acordo' ? 'fim' : 'and'; _rpGravar(n); },
  addNf: _rpAddNf,
  async tiraNf(b) { const n = _rpNegAtual(), j = +b.dataset.v; if (!confirm('Desvincular esta NF? Ela volta a contar como entrada do fornecedor.')) return; n.dados = { ...n.dados, nfs: n.dados.nfs.filter((_, i) => i !== j) }; if (await _rpGravar(n, false)) { _rpReposMudou(); reposicoesRender(); } },
  apagaNeg() {
    const n = _rpNegAtual();
    confirmarDestrutivo({ title: 'Excluir negociação', sub: `${n.nome} · ${_rpMesL(n.ym)}`, body: 'Os números congelados, o acordado, as NFs vinculadas e a conclusão serão apagados. Não dá para desfazer.', confirmLabel: 'Excluir', onConfirm: async () => {
      const { error } = await window.supabaseClient.from('rep_negociacoes').delete().eq('raiz', n.raiz).eq('ym', n.ym);
      if (error) return toast('Falha ao excluir: ' + error.message, 'error');
      RP.negs.delete(n.raiz + '|' + n.ym); RP.aba = 'novo'; _rpReposMudou(); toast('Negociação excluída.', 'success'); reposicoesRender();
    } });
  },
  doc(b) { try { b.dataset.v === 'pdf' ? _rpDocPdf() : _rpDocXls(); } catch (e) { console.error('[Reposições] documento', e); toast('Falha ao gerar o documento: ' + (e.message || e), 'error'); } },
};
function _rpIrForn(k) {
  RP.no = { tipo: 'forn', via: 'fornecedor', forn: k }; RP.grupo = 'fornecedor'; RP.q = '';
  const s = _rpStForn(k, RP.mes); RP.aba = Object.keys(RP_ABAS).find(a => RP_ABAS[a][2](s)) || RP.aba;
  _rpDesenhar(); _rpTopoPg();
}
const RP_MUDA = {   // change
  fMarcar(el) { el.checked ? RP.fPend.add(el.dataset.v) : RP.fPend.delete(el.dataset.v); },
  acordado(el) { const n = _rpNegAtual(); n.dados = { ...n.dados, acordado: { ...(n.dados.acordado || {}), [el.dataset.k]: Math.round(_rpLer(el.value) * 1000) } }; _rpGravar(n); },
  campo(el) { const n = _rpNegAtual(); n.dados = { ...n.dados, [el.dataset.v]: el.value.trim() }; _rpGravar(n, false); },
  fimc(el) {
    const n = _rpNegAtual(), c = el.dataset.v, fim = { ...(n.dados.fim || {}) };
    fim[c] = c === 'valor' ? Math.round(_rpLer(el.value) * 100) / 100 : c === 'kgFin' ? Math.round(_rpLer(el.value) * 1000) : el.value.trim();
    if (c === 'res') { n.status = !fim.res ? 'acordada' : fim.res === 'Sem acordo' ? 'sem_acordo' : 'concluida'; RP.aba = fim.res ? 'fim' : 'and'; if (fim.res && !fim.data) fim.data = localISODate(new Date()); }
    n.dados = { ...n.dados, fim };
    _rpGravar(n, c !== 'txt' && c !== 'data');
  },
};
let _rpT1 = null, _rpT2 = null;
const RP_DIGITA = {   // input
  busca(el) { RP.q = el.value; clearTimeout(_rpT1); _rpT1 = setTimeout(_rpDesenhar, 250); },
  fBuscar(el) { RP.fBusca = el.value; _rpDesenhar(); },
};
function _rpFechaMes() { document.getElementById('rp-month-dropdown')?.classList.remove('open'); document.getElementById('rp-month-trigger')?.classList.remove('open'); }
window.rpToggleMes = function () {
  const dd = document.getElementById('rp-month-dropdown');
  if (dd.classList.contains('open')) return _rpFechaMes();
  document.querySelectorAll('.cal-picker-dropdown.open').forEach(x => { x.classList.remove('open'); document.getElementById(x.id.replace('-dropdown', '-trigger'))?.classList.remove('open'); });
  RP.viewAno = +(RP.mes[RP.mes.length - 1] || localISODate(new Date())).slice(0, 4);
  dd.classList.add('open'); document.getElementById('rp-month-trigger').classList.add('open'); _rpMesGrade();
};
const _rpAtiva = () => !!document.getElementById('page-reposicoes')?.classList.contains('active');
function _rpLigar(root) {
  const pg = document.getElementById('page-reposicoes');
  const rodar = (mapa, attr) => e => { const b = e.target.closest?.(`[data-${attr}]`); if (!b || !pg.contains(b) || b.disabled) return; const fn = mapa[b.dataset[attr]]; if (!fn) return; if (attr === 'rp' && !b.closest('.mo-fg')) RP.fAberto = null; fn(b, e); };
  pg.addEventListener('click', rodar(RP_ACOES, 'rp'));
  pg.addEventListener('change', rodar(RP_MUDA, 'rpc'));
  pg.addEventListener('input', rodar(RP_DIGITA, 'rpi'));
  pg.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches?.('tr[data-rp]')) e.target.click(); });
  document.addEventListener('click', e => {
    if (RP.fAberto && e.target.isConnected && !e.target.closest('#rp-root .mo-fg')) RP_ACOES.fFechar();
    if (e.target.isConnected && !e.target.closest('#rp-month-wrap')) _rpFechaMes();
  });
  if (typeof _showTip === 'function') {
    const alvo = e => e.target.closest?.('[data-tip]');
    root.addEventListener('mouseover', e => { const l = alvo(e); if (l) _showTip(e, decodeURIComponent(l.dataset.tip), '#7b85a0'); });
    root.addEventListener('mousemove', e => { if (alvo(e)) _moveTip(e); });
    root.addEventListener('mouseout', e => { if (alvo(e)) _hideTip(); });
    root.addEventListener('click', () => _hideTip());
  }
  window.addEventListener('resize', () => { clearTimeout(_rpT2); _rpT2 = setTimeout(() => { if (_rpAtiva()) { _rpPintar(RP.desenhos); _rpHistDesenhar(); } }, 160); });
  // Publicação não tem Realtime (payload grande): confere as versões ao voltar o foco.
  window.addEventListener('focus', async () => {
    if (!_rpAtiva() || _rpAdm() || !RP.carga) return;
    const antes = JSON.stringify([...RP.pub.values()].map(p => [p.ym, p.versao]));
    try { await _rpCarregarPubs(); } catch (_) { return; }
    if (JSON.stringify([...RP.pub.values()].map(p => [p.ym, p.versao])) !== antes) reposicoesRender();
  });
  let t = null;
  window.supabaseClient?.channel('rep_negociacoes').on('postgres_changes', { event: '*', schema: 'public', table: 'rep_negociacoes' }, () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      if (document.activeElement?.closest?.('#rp-neg')) { t = setTimeout(() => _rpCarregarNegs().catch(() => {}), 5000); return; }   // não atropela quem está digitando
      const sig = RP.reposSig;
      try { await _rpCarregarNegs(); } catch (e) { console.warn('[Reposições] negociações', e); return; }
      if (_rpAtiva() && RP.carga) { if (sig !== RP.reposSig) reposicoesRender(); else _rpDesenhar(); }
    }, 400);
  }).subscribe();
}
try { RP.rec = localStorage.getItem('reposicoes.lista') === '1'; } catch (_) { /* sem storage */ }
window.reposicoesRender = reposicoesRender;
