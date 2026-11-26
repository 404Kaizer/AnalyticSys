'use strict';

// ══════════════════════════════════════════════════════════════════════
// ACORDOS — notas mães/adiantamentos, rebates e acordos financeiros.
// Só ADM + INSUMOS (navigate em ui.js, CSS em modules.css, RLS acordo_*).
// Migration: supabase/migrations/20261123_acordos.sql.
//
// Fase 1 (23/11/2026): só NOTA MÃE. Rebate e acordo financeiro já podem ser
// escolhidos como modalidade, mas ainda não têm tela.
//
// Fonte: cob_sefaz (import do SEFAZ das Cobranças), só as NFs com algum item
// de CFOP marcado no cadastro (cob_cfop.acordo): 'mae' (5922/6922, simples
// faturamento) e 'filha' (5116/6116/5117/6117, remessa). A filha aponta a mãe
// nas informações complementares (nº ou chave); a que não aponta vira alerta
// "sem vínculo" e o analista vincula à mão (acordo_vinculos).
// Central: das Entradas (state.entradas) pela chave de acesso ou, sem chave,
// por CNPJ do fornecedor + número; mãe sem Entrada herda a central das filhas.
// Status: Autorizada (padrão), Cancelada (SEFAZ, trava), e os manuais
// Devolvida/Inutilizada/Indevida/Recusada (acordo_nf_status).
// Peso = VOLUME do SEFAZ em toneladas (igual à Cobrança).
// ══════════════════════════════════════════════════════════════════════

const AC_MODALIDADES = { nota_mae: 'Nota mãe', rebate: 'Rebate', acordo_financeiro: 'Acordo financeiro' };
const AC_STATUS = {
  autorizada: ['Autorizada', 'badge-green'], cancelada: ['Cancelada', 'badge-red'],
  devolvida: ['Devolvida', 'badge-amber'], inutilizada: ['Inutilizada', 'badge-purple'],
  indevida: ['Indevida', 'badge-amber'], recusada: ['Recusada', 'badge-red'],
};
const AC_STATUS_MANUAIS = ['autorizada', 'devolvida', 'inutilizada', 'indevida', 'recusada'];
const AC_GRUPOS = { fornecedor: 'Fornecedor', regional: 'Regional', central: 'Central', material: 'Material' };

const AC = {
  carga: null, sujo: true, iniciado: false,
  cfop: new Map(),            // cfop → 'mae' | 'filha'
  forn: new Map(),            // cnpj → { cnpj, nome, modalidade }
  status: new Map(),          // chave → status manual
  vinc: new Map(),            // chave_filha → { chave_mae, numero_mae }
  regPorCen: new Map(),       // alias → regional
  nfs: [],                    // NFs do SEFAZ (mães + filhas), cruas
  maes: [], filhas: [], porForn: new Map(),
  cenIdx: null, cenIdxRef: null, cenIdxLen: -1,
  sel: '', grp: '', aba: null, paba: 'maes', abertas: new Set(), listaRecolhida: false,
  fAberto: null, fPend: null, fBusca: '', evo: 't', evoNotas: [],
  F: { q: '', regs: new Set(), cens: new Set(), mats: new Set(), grupo: 'fornecedor' },
};

/* ───────── formatação ───────── */
const _acE = s => escapeHtml(String(s ?? ''));
const _acNf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const _acNf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const _acNf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const _acT = v => _acNf2.format(v || 0) + ' t';
const _acR = v => 'R$ ' + _acNf2.format(v || 0);
const _acData = ms => ms ? new Date(ms).toLocaleDateString('pt-BR') : '—';
const _acCnpjFmt = c => String(c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const _acNum = v => String(v ?? '').split('/')[0].replace(/\D/g, '').replace(/^0+(?=\d)/, '');
const _acDia = 86400000;

/* ───────── carga ───────── */
async function _acFetchAll(table, cols, ordem, filtro = q => q) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await filtro(window.supabaseClient.from(table).select(cols)).order(ordem).range(de, de + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

async function _acCarregar() {
  const sb = window.supabaseClient;
  if (!sb) throw new Error('sem conexão com o banco');
  const [cfops, fornCad, fornAc, status, vinc, filiais] = await Promise.all([
    _acFetchAll('cob_cfop', 'cfop, acordo', 'cfop', q => q.not('acordo', 'is', null)),
    _acFetchAll('cob_fornecedores', 'nome, cnpj', 'cnpj').catch(() => []),
    _acFetchAll('acordo_fornecedores', '*', 'cnpj'),
    _acFetchAll('acordo_nf_status', '*', 'chave'),
    _acFetchAll('acordo_vinculos', '*', 'chave_filha'),
    _acFetchAll('filiais', 'alias, regional', 'alias').catch(() => []),
  ]);
  AC.cfop = new Map(cfops.map(c => [String(c.cfop), c.acordo]));
  AC.forn = new Map();
  fornCad.forEach(f => { const c = String(f.cnpj || '').replace(/\D/g, ''); if (c.length === 14) AC.forn.set(c, { cnpj: c, nome: f.nome || c, modalidade: '' }); });
  _acSetForn(fornAc);
  _acSetStatus(status);
  _acSetVinc(vinc);
  AC.regPorCen = new Map();
  [...(state.filiais || []), ...filiais].forEach(f => { const a = String(f.alias || '').trim(); if (a && f.regional && !AC.regPorCen.has(a)) AC.regPorCen.set(a, String(f.regional).trim()); });

  // Uma consulta por CFOP (contains no jsonb dos itens); a NF com item de mãe e de filha conta como mãe.
  const porChave = new Map();
  const lotes = await Promise.all([...AC.cfop.keys()].map(cfop =>
    _acFetchAll('cob_sefaz', 'chave, cnpj_emitente, nome, numero, serie, emissao, status, itens', 'chave', q => q.contains('itens', JSON.stringify([{ cfop }])))));   // string: array vira literal de array do Postgres, não JSON
  lotes.flat().forEach(s => porChave.set(s.chave, s));
  AC.nfs = [...porChave.values()];
  AC.cenIdx = null;
  AC.sujo = false;
}

function _acSetForn(rows) {
  for (const f of AC.forn.values()) f.modalidade = '';
  rows.forEach(r => {
    const f = AC.forn.get(r.cnpj) || { cnpj: r.cnpj, nome: r.nome || r.cnpj, modalidade: '' };
    f.modalidade = r.modalidade || '';
    AC.forn.set(r.cnpj, f);
  });
}
function _acSetStatus(rows) { AC.status = new Map(rows.map(r => [r.chave, r.status])); }
function _acSetVinc(rows) { AC.vinc = new Map(rows.map(r => [r.chave_filha, { chave_mae: r.chave_mae, numero_mae: r.numero_mae }])); }

/* ───────── central pelas Entradas ───────── */
// Uma passada na base (~1 mi linhas), refeita só quando state.entradas muda.
function _acCentrais() {
  const ents = state.entradas || [];
  if (AC.cenIdx && AC.cenIdxRef === ents && AC.cenIdxLen === ents.length) return AC.cenIdx;
  const ch = new Set(AC.nfs.map(n => n.chave)), nfk = new Set(AC.nfs.map(n => n.cnpj_emitente + '|' + n.numero));
  const porCh = new Map(), porNf = new Map(), mat = new Map();   // mat: chave ou cnpj|nº → materiais padronizados
  const poeMat = (k, v) => { if (v) (mat.get(k) || mat.set(k, new Set()).get(k)).add(v); };
  for (let i = 0; i < ents.length; i++) {
    const r = ents[i];
    const cen = r.centralDestino || r.centralCompra;
    if (!cen) continue;
    if (r.chave && ch.has(r.chave)) { porCh.set(r.chave, cen); poeMat(r.chave, r.material); continue; }
    if (r.cnpjFornecedor) { const k = r.cnpjFornecedor + '|' + _acNum(r.nf); if (nfk.has(k)) { porNf.set(k, cen); poeMat(k, r.material); } }
  }
  AC.cenIdx = { porCh, porNf, mat };
  AC.cenIdxRef = ents; AC.cenIdxLen = ents.length;
  return AC.cenIdx;
}

/* ───────── vínculo filha → mãe ───────── */
// O complementar vem com muito texto junto (motorista, placas, lacres, frete…).
// Ex.: "...[LACRES: 988545-988546] [FRETE TOTAL 1.944,99] REMESSA REFERENTE A
// NFE 0949920 DE 24 09 2026, NF 0949920 23 09 26" → mãe 949920.
//   chaves: 44 dígitos seguidos ou em blocos de 4 (espaço/ponto entre blocos);
//   nums:   número depois de NF / NFE / NF-E / N.F. / NOTA (FISCAL), com até
//           4 palavras no meio (padrões dos fornecedores, Hugo 23/11/2026):
//           "NOTA FISCAL MAE 123", "N.F. MAE N 123", "NF-E REFERENCIADA: 123",
//           "NF DE FATURAMENTO NO 123", "NOTA FISCAL NUMERO 123"; milhar com
//           ponto aceito ("000.949.920");
//   soltos: qualquer outro número de 3–9 dígitos — só se nums não achar mãe.
// Dígitos separados por espaço/hífen NÃO são emendados (datas, lacres).
// ponytail: número casa com QUALQUER mãe do mesmo fornecedor com esse número;
// número ambíguo (2 mães, séries diferentes) fica sem vínculo. Filha que cita
// 2 mães vai para a primeira. Teto: vínculo manual.
const AC_RE_CHAVE = /(?<!\d)\d{4}(?:[ .]?\d{4}){10}(?!\d)/g;
// Palavras no meio só de letras (MAE, DE, FATURAMENTO, REFERENCIADA, N, NO, Nº…):
// número errado que escape daqui ainda precisa ser nº de uma mãe do fornecedor.
const AC_RE_NF = /(?:^|[^A-Z])(?:N\.?\s?F\.?(?:\s?-?\s?E)?|NOTAS?(?:\s+FISCA(?:L|IS))?(?:\s+ELETRONICAS?)?)(?:[\s:.#-]+(?:[A-Z]{1,14}|N[º°])\.?){0,4}[\s:.#-]*(\d{1,3}(?:\.\d{3})+|\d{3,9})(?!\d)/g;
function _acCitacoes(txt) {
  const s = normalizeText(txt);
  const chaves = (s.match(AC_RE_CHAVE) || []).map(c => c.replace(/\D/g, ''));
  const resto = s.replace(AC_RE_CHAVE, ' ');
  const nums = [...new Set([...resto.matchAll(AC_RE_NF)].map(m => _acNum(m[1].replace(/\./g, ''))))];
  const soltos = [...new Set((resto.match(/(?<!\d)\d{3,9}(?!\d)/g) || []).map(_acNum))];
  return { chaves, nums, soltos };
}

// Materiais da nota para comparar mãe × filha: [{ keys, peso }]. Com um material
// só, o nome padronizado da Entrada da própria nota também vale como chave.
function _acMats(itens, chavesDe, daEntrada) {
  const por = new Map();
  itens.forEach(i => {
    if (!i.material) return;
    const x = por.get(i.material) || por.set(i.material, { keys: new Set(chavesDe(i.material)), peso: 0 }).get(i.material);
    x.peso += Number(i.volume) || 0;
  });
  const mats = [...por.values()];
  if (mats.length === 1 && daEntrada?.size === 1) mats[0].keys.add(normalizeLooseText([...daEntrada][0]));
  return mats;
}

/* ───────── recomendação da nota mãe (Hugo, 25/11/2026) ───────── */
// Para cada filha sem vínculo, da mais antiga para a mais nova: a nota mãe MAIS
// ANTIGA com saldo para o peso, entre as autorizadas do mesmo fornecedor, central
// e material, emitidas até o dia da filha. Nenhuma com saldo inteiro → a de maior
// saldo, com aviso (excede). Cada recomendação já desconta o saldo da seguinte.
// Em nota mãe com vários materiais o saldo é o do material da filha.
// Devolve Map chave da filha → { mae, saldo, excede } ou { motivo }.
const _acMesmoMat = (a, b) => { for (const k of a.keys) if (b.keys.has(k)) return true; return false; };
function _acRec(g) {
  if (g.rec) return g.rec;
  const rec = g.rec = new Map();
  const dia = ms => new Date(ms).setHours(0, 0, 0, 0);
  const maes = g.maes.filter(m => m.status === 'autorizada' && m.central && m.mats.length).sort((a, b) => a.emissao - b.emissao);
  // Saldo por material da nota mãe. Um material só: toda filha vinculada conta.
  const saldos = new Map(maes.map(m => {
    const bolsas = m.mats.map(x => ({ keys: x.keys, saldo: m.mats.length === 1 ? m.peso : x.peso }));
    m.filhas.forEach(f => {
      if (f.status === 'cancelada') return;
      if (bolsas.length === 1) { bolsas[0].saldo -= f.peso; return; }
      f.mats.forEach(x => { const b = bolsas.find(y => _acMesmoMat(x, y)); if (b) b.saldo -= x.peso; });
    });
    return [m, bolsas];
  }));
  [...g.semVinc].sort((a, b) => a.emissao - b.emissao).forEach(f => {
    const man = AC.vinc.get(f.chave);
    if (man) { rec.set(f.chave, { motivo: `vinculada à NF ${man.numero_mae}, que não está no SEFAZ importado` }); return; }
    if (!f.central) { rec.set(f.chave, { motivo: 'filha sem central nas Entradas' }); return; }
    if (!f.mats.length || !(f.peso > 0)) { rec.set(f.chave, { motivo: 'filha sem material ou peso' }); return; }
    const cands = [];
    for (const m of maes) {
      if (m.central !== f.central || (m.emissao && f.emissao && dia(m.emissao) > dia(f.emissao))) continue;
      const usa = f.mats.map(x => [saldos.get(m).find(b => _acMesmoMat(x, b)), x.peso]);
      if (usa.some(([b]) => !b)) continue;
      const saldo = Math.max(0, Math.min(...usa.map(([b]) => b.saldo)));
      const excede = usa.reduce((t, [b, p]) => t + Math.max(0, p - Math.max(0, b.saldo)), 0);
      cands.push({ mae: m, usa, saldo, excede: excede > 0.001 ? excede : 0 });
    }
    if (!cands.length) { rec.set(f.chave, { motivo: 'nenhuma nota mãe autorizada desta central e material até a data da filha' }); return; }
    const r = cands.find(c => !c.excede) || cands.reduce((a, b) => b.saldo > a.saldo ? b : a);
    if (!(r.saldo > 0.001)) { rec.set(f.chave, { motivo: 'nenhuma nota mãe com saldo' }); return; }
    r.usa.forEach(([b, p]) => { b.saldo -= p; });
    rec.set(f.chave, r);
  });
  return rec;
}

function _acMontar() {
  const idx = _acCentrais();
  const chaveMat = new Map();   // nome do SEFAZ → chaves de comparação (o nome e o padronizado)
  const chavesDe = n => chaveMat.get(n) || chaveMat.set(n, [normalizeLooseText(n), normalizeLooseText(normalizarMaterial(n))]).get(n);
  const mk = s => {
    const itens = Array.isArray(s.itens) ? s.itens : [];
    const tipos = itens.map(i => AC.cfop.get(String(i.cfop || '')));
    const cancelada = /cancel/i.test(s.status || '');
    const manual = AC.status.get(s.chave);
    return {
      chave: s.chave, cnpj: s.cnpj_emitente, nome: s.nome, numero: s.numero, serie: s.serie,
      emissao: s.emissao ? new Date(s.emissao).getTime() : 0,
      tipo: tipos.includes('mae') ? 'mae' : 'filha',
      status: cancelada ? 'cancelada' : (manual || 'autorizada'),
      itens, comp: itens.find(i => i.complementar)?.complementar || '',
      peso: itens.reduce((t, i) => t + (Number(i.volume) || 0), 0),
      valor: itens.reduce((t, i) => t + (Number(i.valor_total) || 0), 0),
      materiais: [...new Set(itens.map(i => i.material).filter(Boolean))],
      mats: _acMats(itens, chavesDe, idx.mat.get(s.chave) || idx.mat.get(s.cnpj_emitente + '|' + s.numero)),
      central: idx.porCh.get(s.chave) || idx.porNf.get(s.cnpj_emitente + '|' + s.numero) || '',
    };
  };
  const todas = AC.nfs.map(mk);
  AC.maes = todas.filter(n => n.tipo === 'mae');
  AC.filhas = todas.filter(n => n.tipo === 'filha');
  const maePorChave = new Map(AC.maes.map(m => [m.chave, m]));
  const maePorNum = new Map();
  AC.maes.forEach(m => { const k = m.cnpj + '|' + m.numero; (maePorNum.get(k) || maePorNum.set(k, []).get(k)).push(m); });
  AC.maePorChave = maePorChave; AC.maePorNum = maePorNum;
  AC.maes.forEach(m => { m.filhas = []; });

  AC.filhas.forEach(f => {
    f.mae = null; f.vinculo = '';
    const man = AC.vinc.get(f.chave);
    if (man) { f.mae = maePorChave.get(man.chave_mae) || null; f.vinculo = 'manual'; f.maeNumero = man.numero_mae; }
    else {
      const { chaves, nums, soltos } = _acCitacoes(f.comp);
      const porCh = chaves.map(c => maePorChave.get(c)).find(Boolean);
      if (porCh) { f.mae = porCh; f.vinculo = 'chave'; }
      else {
        // 1º os números ao lado de "NF"; só sem nenhum deles casando, os soltos.
        const casar = lista => { const c = new Set(); lista.forEach(n => (maePorNum.get(f.cnpj + '|' + n) || []).forEach(m => c.add(m))); return c; };
        let cands = casar(nums);
        if (!cands.size) cands = casar(soltos);
        if (cands.size === 1) { f.mae = [...cands][0]; f.vinculo = 'numero'; }
      }
    }
    if (f.mae) f.mae.filhas.push(f);
  });
  // Mãe sem Entrada: central mais frequente entre as filhas.
  AC.maes.forEach(m => {
    m.filhas.sort((a, b) => a.emissao - b.emissao);
    if (!m.central) {
      const cont = new Map();
      m.filhas.forEach(f => f.central && cont.set(f.central, (cont.get(f.central) || 0) + 1));
      m.central = [...cont.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    }
    m.regional = AC.regPorCen.get(m.central) || '';
  });
  AC.filhas.forEach(f => { if (!f.central && f.mae) f.central = f.mae.central; f.regional = AC.regPorCen.get(f.central) || ''; });

  // Por fornecedor: mães, filhas sem vínculo e o ritmo/peso médio das filhas.
  AC.porForn = new Map();
  const pf = c => AC.porForn.get(c) || AC.porForn.set(c, { maes: [], semVinc: [], filhas: [] }).get(c);
  AC.maes.forEach(m => { pf(m.cnpj).maes.push(m); if (!AC.forn.has(m.cnpj)) AC.forn.set(m.cnpj, { cnpj: m.cnpj, nome: m.nome || m.cnpj, modalidade: '' }); });
  AC.filhas.forEach(f => {
    const g = pf(f.cnpj);
    if (f.status === 'cancelada') return;
    if (f.mae) g.filhas.push(f); else g.semVinc.push(f);
  });
  for (const g of AC.porForn.values()) {
    g.filhas.sort((a, b) => a.emissao - b.emissao);
    g.pesoMedio = g.filhas.length ? g.filhas.reduce((t, f) => t + f.peso, 0) / g.filhas.length : 0;
    g.intervalo = _acIntervalo(g.filhas);
    g.maes.sort((a, b) => b.emissao - a.emissao);
    g.maes.forEach(m => Object.assign(m, _acKpis(m, g)));
    g.pendT = g.maes.filter(m => m.status === 'autorizada').reduce((t, m) => t + m.pendT, 0);
    g.pendR = g.maes.filter(m => m.status === 'autorizada').reduce((t, m) => t + m.pendR, 0);
    g.semVinc.sort((a, b) => b.emissao - a.emissao);
  }
}

// Dias médios entre filhas consecutivas (null com menos de 2).
function _acIntervalo(fs) {
  if (fs.length < 2) return null;
  return (fs[fs.length - 1].emissao - fs[0].emissao) / _acDia / (fs.length - 1);
}

function _acKpis(m, g) {
  const fs = m.filhas.filter(f => f.status !== 'cancelada');
  const retT = fs.reduce((t, f) => t + f.peso, 0);
  const custoUn = m.peso > 0 ? m.valor / m.peso : (Number(m.itens[0]?.valor_unit) || 0);
  const pendT = Math.max(0, m.peso - retT);
  const pesoMedio = g.pesoMedio || (fs.length ? retT / fs.length : 0);
  const nfsRest = pendT > 0 && pesoMedio > 0 ? Math.ceil(pendT / pesoMedio) : (pendT > 0 ? null : 0);
  const intervalo = _acIntervalo(fs) ?? g.intervalo;
  const diasRest = nfsRest === 0 ? 0 : (nfsRest != null && intervalo != null ? nfsRest * intervalo : null);
  const base = fs.length ? Math.max(fs[fs.length - 1].emissao, Date.now()) : Date.now();
  return {
    retT, retR: retT * custoUn, pendT, pendR: pendT * custoUn, custoUn,
    nRet: fs.length, nfsRest, pesoMedio, intervalo, diasRest,
    previsao: diasRest != null && diasRest > 0 ? base + diasRest * _acDia : null,
    excedido: retT - m.peso > 0.001 ? retT - m.peso : 0,
    pct: m.peso > 0 ? Math.min(1, retT / m.peso) : 0,
  };
}

/* ───────── filtros (barra igual à do Mural de Operações) ───────── */
const AC_FILTROS = [
  { k: 'regs', label: 'Regional', icon: 'ti-users-group', de: m => [m.regional] },
  { k: 'cens', label: 'Central', icon: 'ti-building-warehouse', de: m => [m.central] },
  { k: 'mats', label: 'Material', icon: 'ti-box', de: m => m.materiais },
];
const AC_ABAS = [['nota_mae', 'ti-file-dollar', 'Nota mãe'], ['rebate', 'ti-receipt-refund', 'Rebate'], ['acordo_financeiro', 'ti-coins', 'Acordo fin.'], ['', 'ti-circle-dashed', 'Sem acordo']];
// Período (seletor do topo, pfx 'ac'): filtra a nota mãe pela EMISSÃO; o saldo
// continua contando todas as filhas (Hugo, 23/11/2026).
const _acPassaMae = m => (!AC.per || (m.emissao >= AC.per.ini && m.emissao <= AC.per.fim))
  && (!AC.F.regs.size || AC.F.regs.has(m.regional)) && (!AC.F.cens.size || AC.F.cens.has(m.central)) && (!AC.F.mats.size || m.materiais.some(x => AC.F.mats.has(x)));
const _acTemFiltro = () => !!(AC.per || AC.F.regs.size || AC.F.cens.size || AC.F.mats.size);
window.addEventListener('cal-range', e => {
  if (e.detail?.pfx !== 'ac') return;
  const ini = document.getElementById('ac-dt-ini')?.value, fim = document.getElementById('ac-dt-fim')?.value;
  if (ini && !fim) return;   // 1º clique: espera o fim do intervalo
  AC.per = ini && fim ? { ini: new Date(ini + 'T00:00:00').getTime(), fim: new Date(fim + 'T23:59:59.999').getTime() } : null;
  _acDesenhar();
});
const _acMaesDe = cnpj => (AC.porForn.get(cnpj)?.maes || []).filter(_acPassaMae);
const _acGrupoDe = { regional: m => [m.regional || 'Sem regional'], central: m => [m.central || 'Sem central'], material: m => m.materiais.length ? m.materiais : ['Sem material'] };

function _acFiltrosHtml() {
  const grupos = [['fornecedor', 'ti-truck', 'Por Fornecedor — lista simples'], ['regional', 'ti-users-group', 'Por Regional — regional → fornecedores'],
    ['central', 'ti-building-warehouse', 'Por Central — central → fornecedores'], ['material', 'ti-box', 'Por Material — material → fornecedores']];
  const filtros = AC_FILTROS.map(x => {
    const ap = AC.F[x.k], aberto = AC.fAberto === x.k;
    const rotulo = ap.size === 1 ? [...ap][0] : ap.size > 1 ? `${x.label} (${ap.size})` : x.label;
    let opcoes = '';
    if (aberto) {
      const marc = AC.fPend || ap, q = normalizeText(AC.fBusca).toLowerCase();
      const lista = [...new Set(AC.maes.flatMap(x.de).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
        .filter(v => !q || normalizeText(v).toLowerCase().includes(q));
      opcoes = lista.length ? lista.map((v, n) => `<label class="micro-filter-option" for="acf-${x.k}-${n}">
          <input type="checkbox" id="acf-${x.k}-${n}" ${marc.has(v) ? 'checked' : ''} data-v="${_acE(v)}" onchange="acFMarcar(this)">
          <span class="micro-filter-option-label" title="${_acE(v)}">${_acE(v)}</span></label>`).join('')
        : '<div style="padding:12px 10px;color:var(--text3);font-size:13.5px;text-align:center">Nenhum resultado</div>';
    }
    return `<div class="micro-filter-group mo-fg" data-k="${x.k}">
      <button class="micro-filter-trigger${ap.size ? ' active' : ''}" onclick="acFAbrir('${x.k}')"><i class="ti ${x.icon}"></i><span>${_acE(rotulo)}</span><i class="ti ti-chevron-down micro-filter-chev${aberto ? ' open' : ''}"></i></button>
      <div class="micro-filter-dropdown${aberto ? ' open' : ''}">
        <div class="micro-filter-search-wrap"><i class="ti ti-search"></i>
          <input class="micro-filter-search" id="acf-busca-${x.k}" type="text" placeholder="Buscar ${x.label.toLowerCase()}…" value="${_acE(aberto ? AC.fBusca : '')}" oninput="acFBuscar(this)"></div>
        <div class="micro-filter-options">${opcoes}</div>
        <div class="micro-filter-footer">
          <button class="btn btn-filter-clear" onclick="acFLimpar('${x.k}')"><i class="ti ti-filter-off"></i> Limpar</button>
          <button class="btn" onclick="acFFechar()"><i class="ti ti-x"></i> Cancelar</button>
          <button class="btn btn-primary" onclick="acFAplicar('${x.k}')"><i class="ti ti-check"></i> Aplicar</button>
        </div></div></div>`;
  }).join('');
  return `<div class="micro-filter-bar mo-filter-bar">
    <div class="micro-group-mode mp-grupos" role="group" aria-label="Agrupar a lista">${grupos.map(([k, ic, t]) =>
      `<button class="${AC.F.grupo === k ? 'active' : ''}" onclick="acGrupo('${k}')" title="${t}" aria-label="${t}" aria-pressed="${AC.F.grupo === k}"><i class="ti ${ic}"></i></button>`).join('')}</div>
    <div class="micro-filter-divider"></div>${filtros}
    ${_acTemFiltro() ? '<button class="btn btn-sm mo-limpar" onclick="acFLimparTodos()"><i class="ti ti-filter-off"></i> Limpar filtros</button>' : ''}
    <button class="btn btn-sm" style="margin-left:auto" onclick="acRecarregar()" title="Ler de novo as notas do SEFAZ"><i class="ti ti-refresh"></i> Recarregar</button>
  </div>`;
}

/* ───────── render ───────── */
async function acordosRender() {
  const root = document.getElementById('ac-root');
  if (!root) return;
  if (!AC.iniciado) {
    AC.iniciado = true; _acRealtime();
    if (typeof _showTip === 'function') {
      const alvo = e => e.target.closest?.('.ac-ro [data-tip]');
      root.addEventListener('mouseover', e => { const l = alvo(e); if (l) _showTip(e, decodeURIComponent(l.dataset.tip), '#7b85a0'); });
      root.addEventListener('mousemove', e => { if (alvo(e)) _moveTip(e); });
      root.addEventListener('mouseout', e => { if (alvo(e)) _hideTip(); });
    }
    document.addEventListener('click', e => { if (AC.fAberto && e.target.isConnected && !e.target.closest('#ac-root .mo-fg')) acFFechar(); });
  }
  if (AC.sujo || !AC.carga) {
    if (!AC.carga) {
      root.innerHTML = '<div class="empty-state"><i class="ti ti-loader-2"></i><p>Carregando notas do SEFAZ…</p></div>';
      AC.carga = _acCarregar().catch(e => { AC.carga = null; throw e; });
    }
    try { await AC.carga; }
    catch (e) {
      root.innerHTML = `<div class="empty-state"><i class="ti ti-database-off"></i><p>Não foi possível carregar os acordos: ${_acE(e.message || e)}.<br>Se for a primeira vez, rode o SQL <b>20261123_acordos.sql</b> no Supabase.</p></div>`;
      return;
    }
  }
  _acMontar();
  // 1ª abertura: começa na aba Nota mãe se alguém já tem essa modalidade.
  if (AC.aba === null) AC.aba = [...AC.forn.values()].some(f => f.modalidade === 'nota_mae') ? 'nota_mae' : '';
  _acDesenhar();
}

// Redesenha a tela inteira (como o Mural), mantendo a rolagem da lista e o foco da busca.
function _acDesenhar() {
  const root = document.getElementById('ac-root');
  if (!root || AC.aba === null) return;
  const corpo = root.querySelector('.mp-lista-corpo'), sc = corpo ? corpo.scrollTop : 0;
  const foco = document.activeElement?.id;
  root.innerHTML = `<div class="mp-root">${_acFiltrosHtml()}<div class="mp">${_acListaHtml()}<section class="mp-painel">${_acPainelHtml()}</section></div></div>`;
  const c2 = root.querySelector('.mp-lista-corpo'); if (c2) c2.scrollTop = sc;
  if (foco === 'ac-busca' || foco?.startsWith('acf-busca')) { const i = document.getElementById(foco); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  _acFoco();
  _acEvoDesenhar();
}

/* ───────── lista (esquerda) ───────── */
function _acFornDaAba(semBusca) {
  const q = semBusca ? '' : normalizeText(AC.F.q).toLowerCase();
  return [...AC.forn.values()].filter(f => {
    if ((f.modalidade || '') !== AC.aba) return false;
    if (q && !normalizeText(f.nome + ' ' + f.cnpj + ' ' + _acCnpjFmt(f.cnpj)).toLowerCase().includes(q)) return false;
    return !_acTemFiltro() || _acMaesDe(f.cnpj).length > 0;
  }).sort(_acOrdemForn);
}
function _acOrdemForn(a, b) {
  const ga = AC.porForn.get(a.cnpj), gb = AC.porForn.get(b.cnpj);
  return (gb?.maes.length ? 1 : 0) - (ga?.maes.length ? 1 : 0) || (gb?.pendR || 0) - (ga?.pendR || 0)
    || (gb?.semVinc.length || 0) - (ga?.semVinc.length || 0) || String(a.nome).localeCompare(String(b.nome), 'pt-BR');
}
// Cor do ícone: vermelho = filhas sem vínculo; âmbar = saldo restante; verde = em dia; cinza = sem nota mãe.
function _acIco(sv, pend, tem) {
  const [ic, cor] = !tem ? ['ti-minus', 'var(--text3)'] : sv ? ['ti-link-off', 'var(--red)'] : pend > 0 ? ['ti-hourglass', 'var(--amber)'] : ['ti-circle-check', 'var(--green)'];
  return `<i class="ti ${ic} mp-ico" style="color:${cor}" aria-hidden="true"></i>`;
}
function _acLinhaForn(f, recuo) {
  const g = AC.porForn.get(f.cnpj), maes = _acMaesDe(f.cnpj), sv = g?.semVinc.length || 0;
  const sub = [_acCnpjFmt(f.cnpj), maes.length ? `${maes.length} nota${maes.length > 1 ? 's' : ''} mãe` : ''].filter(Boolean).join(' · ');
  const sel = AC.sel === f.cnpj;
  return `<button class="mp-row mp-item ${recuo}${sel ? ' sel' : AC.sel ? ' apagado' : ''}" onclick="acSel('${f.cnpj}')">
    ${_acIco(sv, g?.pendT, maes.length || sv)}<span class="mp-nome"><b title="${_acE(f.nome)}">${_acE(f.nome)}</b><small>${sub}${sv ? ` · <span style="color:var(--red)">${sv} sem vínculo</span>` : ''}</small></span>
    <span class="mp-dir"><span class="mp-v">${g?.pendT ? _acT(g.pendT) : '—'}</span>${g?.pendR ? `<span class="mo-hint mono" style="font-size:11.5px">${_acR(g.pendR)}</span>` : ''}</span></button>`;
}
function _acListaHtml() {
  const forns = _acFornDaAba();
  if (AC.listaRecolhida) {
    return `<section class="mp-lista recolhida"><button class="mp-lista-abrir" onclick="acLista()" title="Mostrar a lista" aria-expanded="false">
      <i class="ti ti-layout-sidebar-left-expand"></i><span>Fornecedores · ${forns.length}</span></button></section>`;
  }
  let linhas;
  if (AC.F.grupo === 'fornecedor') linhas = forns.map(f => _acLinhaForn(f, 'mp-item-1')).join('');
  else {
    // O fornecedor aparece em cada grupo onde tem nota mãe; sem nota mãe vai para o fim.
    const chave = _acGrupoDe[AC.F.grupo], grupos = new Map(), sem = [];
    forns.forEach(f => {
      const maes = _acMaesDe(f.cnpj);
      if (!maes.length) { sem.push(f); return; }
      new Set(maes.flatMap(chave)).forEach(k => (grupos.get(k) || grupos.set(k, []).get(k)).push(f));
    });
    const pendDe = (k, fs) => fs.reduce((t, f) => t + _acMaesDe(f.cnpj).filter(m => m.status === 'autorizada' && chave(m).includes(k)).reduce((a, m) => a + m.pendT, 0), 0);
    const blocos = [...grupos.entries()].map(([k, fs]) => [k, fs, pendDe(k, fs)]).sort((a, b) => b[2] - a[2] || a[0].localeCompare(b[0], 'pt-BR'));
    if (sem.length) blocos.push(['Sem nota mãe', sem, 0]);
    linhas = blocos.map(([k, fs, p]) => {
      const aberta = AC.grp === k, sv = fs.reduce((t, f) => t + (AC.porForn.get(f.cnpj)?.semVinc.length || 0), 0);
      return `<div class="mp-bloco${aberta ? ' aberto' : ''}"><button class="mp-row mp-reg${aberta && !AC.sel ? ' sel' : (AC.grp && !aberta) ? ' apagado' : ''}" onclick="acGrp(this.dataset.k)" data-k="${_acE(k)}">
        <i class="ti ti-chevron-${aberta ? 'down' : 'right'} mp-chev"></i>${_acIco(sv, p, k !== 'Sem nota mãe')}
        <span class="mp-nome"><b>${_acE(k)}</b><small>${fs.length} fornecedor${fs.length > 1 ? 'es' : ''}${sv ? ` · <span style="color:var(--red)">${sv} sem vínculo</span>` : ''}</small></span>
        <span class="mp-v">${p ? _acT(p) : '—'}</span></button>${aberta ? fs.map(f => _acLinhaForn(f, 'mp-item-1')).join('') : ''}</div>`;
    }).join('');
  }
  const contaAba = k => [...AC.forn.values()].filter(f => (f.modalidade || '') === k && (!_acTemFiltro() || _acMaesDe(f.cnpj).length)).length;
  return `<section class="mp-lista">
    <div class="mp-lista-head"><div class="mp-lista-linha">
      <label class="mp-busca"><i class="ti ti-search"></i><input id="ac-busca" type="text" placeholder="Buscar fornecedor ou CNPJ…" value="${_acE(AC.F.q)}" oninput="acBusca(this.value)" aria-label="Buscar fornecedor"></label>
      <button class="mp-lista-recolher" onclick="acLista()" title="Recolher a lista para a lateral" aria-expanded="true"><i class="ti ti-layout-sidebar-left-collapse"></i></button>
    </div></div>
    <div class="mp-subabas" role="tablist">${AC_ABAS.map(([k, ic, rot]) =>
      `<button class="mo-aba${AC.aba === k ? ' on' : ''}" role="tab" aria-selected="${AC.aba === k}" onclick="acAba('${k}')"><i class="ti ${ic}"></i>${rot} <b>${contaAba(k)}</b></button>`).join('')}</div>
    <div class="mp-lista-corpo">${linhas || `<div class="empty-state" style="padding:24px"><p>${AC.aba && !AC.F.q && !_acTemFiltro() ? 'Nenhum fornecedor com esta modalidade. Abra um fornecedor em <b>Sem acordo</b> e escolha a modalidade no painel.' : 'Nada com esses filtros.'}</p></div>`}</div>
  </section>`;
}

/* ───────── painel (direita) ───────── */
function _acCab(migalhas, titulo, sub, pendT, pendR) {
  return `<div class="mp-cab"><div style="min-width:0">
      <div class="mp-migalhas">${migalhas.join(' › ')}</div>
      <h2>${titulo}</h2><p class="mo-hint">${sub}</p></div>
    <div class="mp-cab-num"><b style="color:${pendT > 0 ? 'var(--amber)' : 'var(--text2)'}">${_acT(pendT)}</b><span class="mo-hint mono">${_acR(pendR)} restante</span></div></div>`;
}
const _acCx = (val, rot, cor) => `<div class="mp-pend-cx"><b${cor ? ` style="color:${cor}"` : ''}>${val}</b><span>${rot}</span></div>`;

/* ───────── gráficos do Resumo (Hugo, 25/11/2026) ───────── */
// Duas roscas (físico e financeiro: retirado × restante, total no centro) e a
// evolução mês a mês embaixo. A fatia Retirado é a parte DENTRO do saldo (retirado
// − excedido), para as fatias fecharem no total; o que passou está no card (_acCardsSaldo).
const _acRc = v => Math.abs(v) >= 1e6 ? 'R$ ' + _acNf1.format(v / 1e6) + ' mi' : Math.abs(v) >= 1e4 ? 'R$ ' + _acNf0.format(v / 1e3) + ' mil' : 'R$ ' + _acNf0.format(v);
const _acTc = v => _acNf0.format(v) + ' t';
const _acTipG = (tit, linhas) => encodeURIComponent(`<b>${tit}</b><div style="display:grid;grid-template-columns:auto auto;gap:4px 16px;margin-top:6px;font-family:var(--mono);font-size:13px">${linhas.map(([r, v]) => `<span style="color:var(--text2)">${r}</span><span style="text-align:right">${v}</span>`).join('')}</div>`);

// Os três números do Resumo. Retirado ACIMA de uma nota mãe não abate o saldo das
// outras: com excedido, retirado + restante passa do total (dito no card).
function _acCardsSaldo(aut) {
  const s = k => aut.reduce((t, m) => t + m[k], 0);
  const tot = s('peso'), ret = s('retT'), pen = s('pendT'), exc = s('excedido');
  const pct = v => tot > 0 ? _acNf1.format(v / tot * 100) + '% do peso total' : '';
  const card = (cls, ic, rot, t, r, sub) => `<div class="ac-kc ${cls}"><div class="ac-kc-rot"><i class="ti ${ic}"></i>${rot}</div><b>${_acT(t)}</b><span class="ac-kc-r">${_acR(r)}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
  return `<div class="ac-kcs">
    ${card('tot', 'ti-stack-2', 'Saldo total', tot, s('valor'), `${_acNf0.format(aut.length)} ${aut.length === 1 ? 'nota mãe autorizada' : 'notas mães autorizadas'}`)}
    ${card('ret', 'ti-truck-delivery', 'Saldo retirado', ret, s('retR'), pct(Math.max(0, ret - exc)) + (exc > 0.001 ? ` · mais ${_acT(exc)} acima do saldo de alguma nota mãe` : ''))}
    ${card('pen', 'ti-hourglass', 'Saldo restante', pen, s('pendR'), pct(pen))}</div>`;
}

function _acGraficos(aut) {
  AC.evoNotas = aut;
  const s = k => aut.reduce((t, m) => t + m[k], 0);
  const excR = aut.reduce((t, m) => t + m.excedido * m.custoUn, 0);
  const rosca = (tit, fmt, curto, total, ret, pend, exc) => {
    const R = 82, E = 26, C = 2 * Math.PI * R, dentro = Math.max(0, ret - exc);
    const p = v => total > 0 ? v / total : 0, pct = v => total > 0 ? _acNf1.format(p(v) * 100) + '%' : '—';
    const fatias = [['Retirado', dentro, 'ret', ret], ['Restante', pend, 'pen', pend]].filter(x => x[1] > 0 && total > 0);
    const gap = fatias.length > 1 ? 3 : 0;   // espaço na cor do fundo entre as fatias
    let pos = 0;
    const arcos = fatias.map(([r, v, cls, cheio]) => {
      const L = p(v) * C, d = `<circle class="ac-ro-f ${cls}" r="${R}" cx="110" cy="110" stroke-width="${E}" stroke-dasharray="${Math.max(0.5, L - gap).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-pos - gap / 2).toFixed(2)}" data-tip="${_acTipG(`${tit} · ${r}`, [['Valor', fmt(cheio)], ['Do saldo total', pct(v)]])}"/>`;
      pos += L;
      return d;
    }).join('');
    const leg = (r, cls, pc) => `<div class="ac-ro-l"><i class="${cls}"></i><span>${r}</span><b>${pc}</b></div>`;
    return `<div class="ac-ro"><div class="ac-gr-tit">${tit}</div><div class="ac-ro-corpo">
      <svg viewBox="0 0 220 220" role="img" aria-label="${_acE(`${tit}: saldo total ${fmt(total)}, retirado ${fmt(ret)}, restante ${fmt(pend)}`)}">
        <circle class="ac-ro-fundo" r="${R}" cx="110" cy="110" stroke-width="${E}"/><g transform="rotate(-90 110 110)">${arcos}</g>
        <text x="110" y="103" class="ac-ro-rot">Saldo total</text><text x="110" y="126" class="ac-ro-tot">${curto(total)}</text></svg>
      <div class="ac-ro-leg">${leg('Retirado', 'ret', pct(dentro))}${leg('Restante', 'pen', pct(pend))}</div></div></div>`;
  };
  return `<div class="ac-gr-dois">${rosca('Físico', _acT, _acTc, s('peso'), s('retT'), s('pendT'), s('excedido'))}${rosca('Financeiro', _acR, _acRc, s('valor'), s('retR'), s('pendR'), excR)}</div>
    <div class="ac-ro ac-ev"><div class="ac-gr-tit">Evolução por mês
      <span class="ac-ev-leg"><span><i class="tot"></i>Saldo total</span><span><i class="ret"></i>Retirado</span><span><i class="pen"></i>Restante</span></span>
      <span class="mp-modo" role="group" aria-label="Unidade da evolução">${[['t', 'Físico'], ['r', 'Financeiro']].map(([k, r]) => `<button data-evo="${k}" class="${AC.evo === k ? 'on' : ''}" aria-pressed="${AC.evo === k}" onclick="acEvo('${k}')">${r}</button>`).join('')}</span></div>
      <div id="ac-evo"></div></div>`;
}

// Saldo total, retirado e restante ACUMULADOS no fim de cada mês; o último mês
// bate com as roscas. Nota mãe entra no mês da emissão; a filha, no mês dela.
// ponytail: no máximo 36 meses na tela (o acumulado anterior entra no 1º).
function _acEvolucao(aut, modo) {
  const mes = ms => { const d = new Date(ms); return d.getFullYear() * 12 + d.getMonth(); };
  let ini = Infinity, fim = -Infinity;
  const ve = ms => { if (ms > 0) { const k = mes(ms); if (k < ini) ini = k; if (k > fim) fim = k; } };
  aut.forEach(m => { ve(m.emissao); m.filhas.forEach(f => { if (f.status !== 'cancelada') ve(f.emissao); }); });
  if (ini > fim) return [];
  ini = Math.max(ini, fim - 35);
  const n = fim - ini + 1, idx = ms => Math.max(0, (ms > 0 ? mes(ms) : ini) - ini);
  const out = Array.from({ length: n }, (_, i) => ({ mes: ini + i, tot: 0, ret: 0, pen: 0 }));
  aut.forEach(m => {
    const u = modo === 'r' ? m.custoUn : 1, por = new Float64Array(n);
    m.filhas.forEach(f => { if (f.status !== 'cancelada') por[idx(f.emissao)] += f.peso; });
    let ret = 0;
    for (let i = 0, e = idx(m.emissao); i < n; i++) {
      ret += por[i];
      out[i].ret += ret * u;
      if (i >= e) { out[i].tot += modo === 'r' ? m.valor : m.peso; out[i].pen += Math.max(0, m.peso - ret) * u; }
    }
  });
  return out;
}

// Desenhada depois do HTML, na largura real do painel (texto sem esticar).
function _acEvoDesenhar() {
  const el = document.getElementById('ac-evo');
  if (!el) return;
  const pts = _acEvolucao(AC.evoNotas || [], AC.evo), fmt = AC.evo === 'r' ? _acR : _acT, curto = AC.evo === 'r' ? _acRc : _acTc;
  if (!pts.length) { el.innerHTML = '<p class="mo-hint">Sem notas mães para mostrar.</p>'; return; }
  const W = Math.max(320, Math.round(el.clientWidth)), H = 250, P = { l: 74, r: 16, t: 14, b: 26 }, n = pts.length;
  const max = Math.max(...pts.flatMap(p => [p.tot, p.ret, p.pen])) || 1;
  const bruto = max / 4, mag = 10 ** Math.floor(Math.log10(bruto)), passo = [1, 2, 2.5, 5, 10].map(k => k * mag).find(k => k >= bruto);
  const topo = passo * Math.ceil(max / passo - 1e-9), larg = (W - P.l - P.r) / n;
  const x = i => P.l + larg * (i + 0.5), y = v => P.t + (1 - v / topo) * (H - P.t - P.b);
  const nome = k => ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][k % 12] + '/' + String(Math.floor(k / 12)).slice(2);
  const eixo = v => AC.evo === 'r' ? (topo >= 1e6 ? 'R$ ' + new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(v / 1e6) + ' mi' : 'R$ ' + _acNf0.format(v)) : _acNf0.format(v) + ' t';
  let grade = '';
  for (let v = 0; v <= topo + passo / 2; v += passo) grade += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="${P.l - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${eixo(v)}</text>`;
  const cada = Math.ceil(n / Math.max(1, Math.floor((W - P.l - P.r) / 56)));
  const rotX = pts.map((p, i) => (n - 1 - i) % cada ? '' : `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${nome(p.mes)}</text>`).join('');
  const linha = k => n > 1 ? `<path class="ac-ev-ln ${k}" d="${pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(p[k]).toFixed(1)).join('')}"/>` : '';
  const pontos = (p, i) => ['tot', 'ret', 'pen'].map(k => `<circle class="${k}" cx="${x(i).toFixed(1)}" cy="${y(p[k]).toFixed(1)}" r="4.5"/>`).join('');
  const fim = pts[n - 1];
  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${_acE(`Evolução até ${nome(fim.mes)}: saldo total ${curto(fim.tot)}, retirado ${curto(fim.ret)}, restante ${curto(fim.pen)}`)}">
    <g class="ac-ev-gr">${grade}${rotX}</g>${linha('tot')}${linha('ret')}${linha('pen')}
    <g class="ac-ev-fim">${pontos(fim, n - 1)}</g>
    ${pts.map((p, i) => `<g class="ac-ev-c" data-tip="${_acTipG(nome(p.mes) + ' · acumulado', [['Saldo total', fmt(p.tot)], ['Retirado', fmt(p.ret)], ['Restante', fmt(p.pen)]])}"><rect x="${(x(i) - larg / 2).toFixed(1)}" y="${P.t}" width="${larg.toFixed(1)}" height="${H - P.t - P.b}"/><line x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${P.t}" y2="${H - P.b}"/>${pontos(p, i)}</g>`).join('')}
  </svg>`;
}
function acEvo(k) {
  AC.evo = k;
  document.querySelectorAll('#ac-root [data-evo]').forEach(b => { b.classList.toggle('on', b.dataset.evo === k); b.setAttribute('aria-pressed', b.dataset.evo === k); });
  _acEvoDesenhar();
}
let _acEvoT = null;
window.addEventListener('resize', () => { clearTimeout(_acEvoT); _acEvoT = setTimeout(_acEvoDesenhar, 150); });

// Números secundários, em texto: notas fora da conta e o ritmo das filhas.
function _acResumoTxt(aut, maes, g) {
  const fora = maes.length - aut.length, partes = [];
  if (fora) partes.push(`${_acNf0.format(fora)} nota${fora === 1 ? '' : 's'} mãe${fora === 1 ? '' : 's'} não autorizada${fora === 1 ? '' : 's'} fora da conta`);
  if (g?.pesoMedio) partes.push(`filha de ${_acT(g.pesoMedio)} em média`);
  if (g?.intervalo > 0) partes.push(g.intervalo >= 1 ? `uma a cada ${_acNf1.format(g.intervalo)} dias` : `${_acNf1.format(1 / g.intervalo)} por dia`);
  return partes.join(' · ') || 'notas mães autorizadas';
}

function _acPainelHtml() {
  const f = AC.forn.get(AC.sel);
  if (f) return _acPainelForn(f);
  // Geral (ou o grupo aberto): resumo das notas mães dos fornecedores da aba.
  const forns = _acFornDaAba(true);
  const doGrupo = m => !AC.grp || AC.F.grupo === 'fornecedor' || _acGrupoDe[AC.F.grupo](m).includes(AC.grp);
  const maes = forns.flatMap(x => _acMaesDe(x.cnpj)).filter(doGrupo);
  const aut = maes.filter(m => m.status === 'autorizada');
  const soma = k => aut.reduce((t, m) => t + m[k], 0);
  const sv = forns.reduce((t, x) => t + (AC.porForn.get(x.cnpj)?.semVinc.length || 0), 0);
  const rot = AC_ABAS.find(a => a[0] === AC.aba)[2];
  const mig = [AC.grp ? `<button class="mo-link" onclick="acGrp('')">Geral</button>` : '<span>Geral</span>'];
  if (AC.grp) mig.push(`<span>${AC_GRUPOS[AC.F.grupo]}</span>`);
  const top = forns.map(x => [x, AC.porForn.get(x.cnpj)]).filter(([, g]) => g?.pendT > 0).sort((a, b) => b[1].pendR - a[1].pendR).slice(0, 8);
  const maxR = top[0]?.[1].pendR || 1;
  const semV = forns.map(x => [x, AC.porForn.get(x.cnpj)?.semVinc.length || 0]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]).slice(0, 8);
  return _acCab(mig, _acE(AC.grp || 'Acordos · ' + rot), `${forns.length} fornecedor${forns.length === 1 ? '' : 'es'} nesta aba · ${AC.maes.length} notas mães e ${AC.filhas.length} filhas no SEFAZ importado`, soma('pendT'), soma('pendR'))
    + (AC.cfop.size ? '' : '<div class="mp-card"><p class="mo-hint">Nenhum CFOP marcado como nota mãe/filha (Configurações → CFOP → Acordo).</p></div>')
    + `<div class="mp-card"><h4 class="mp-tit">Resumo <span class="mo-hint">${_acResumoTxt(aut, maes)}</span></h4>${_acCardsSaldo(aut)}${_acGraficos(aut)}</div>
    <div class="mp-dois">
      <div class="mp-card"><h4 class="mp-tit">O que mais pesa <span class="mo-hint">saldo restante em R$</span></h4>${top.length ? top.map(([x, g]) => `<button class="mp-rank" style="grid-template-columns:minmax(0,1fr) 90px 150px" onclick="acSel('${x.cnpj}')">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_acE(x.nome)}</span><span class="mp-rank-bar"><i style="width:${g.pendR / maxR * 100}%;background:var(--amber)"></i></span><span class="mono" style="text-align:right">${_acR(g.pendR)}<small class="mo-hint" style="display:block">${_acT(g.pendT)}</small></span></button>`).join('') : '<p class="mo-hint">Nenhum saldo restante.</p>'}</div>
      <div class="mp-card"><h4 class="mp-tit">Filhas sem vínculo <span class="mo-hint">${sv ? _acNf0.format(sv) + ' no total' : ''}</span></h4>${semV.length ? semV.map(([x, n]) => `<button class="mp-lin" onclick="acSel('${x.cnpj}')"><i class="ti ti-link-off" style="color:var(--red)"></i><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_acE(x.nome)}</span><b class="mono">${n}</b></button>`).join('') : '<p class="mo-hint">Todas as filhas estão vinculadas.</p>'}</div>
    </div>`;
}

function _acPainelForn(f) {
  const g = AC.porForn.get(f.cnpj) || { maes: [], semVinc: [], filhas: [] };
  const maes = g.maes.filter(_acPassaMae);
  const aut = maes.filter(m => m.status === 'autorizada');
  const soma = k => aut.reduce((t, m) => t + m[k], 0);
  const mig = [`<button class="mo-link" onclick="acSel('')">Geral</button>`];
  if (AC.grp) mig.push(`<button class="mo-link" onclick="acSel('')">${_acE(AC.grp)}</button>`);
  mig.push('<span>Fornecedor</span>');
  const mod = `<div class="mp-card"><h4 class="mp-tit">Modalidade do acordo <span class="mo-hint">vale para todas as centrais</span></h4><div class="mp-chips">${[['', 'Sem acordo'], ...Object.entries(AC_MODALIDADES)].map(([k, r]) =>
    `<button class="mp-chip${(f.modalidade || '') === k ? ' ac-chip-on' : ''}" onclick="acModalidade('${f.cnpj}','${k}')">${(f.modalidade || '') === k ? '<i class="ti ti-check"></i>' : ''}${r}</button>`).join('')}</div></div>`;
  const ehMae = f.modalidade === 'nota_mae';
  let corpo;
  if (!ehMae) {
    corpo = `<div class="mp-card"><p class="mo-hint" style="font-size:14px">${!f.modalidade
      ? `Escolha a modalidade acima.${g.maes.length ? ` Há <b>${g.maes.length}</b> nota${g.maes.length > 1 ? 's' : ''} mãe deste fornecedor no SEFAZ — escolha <b>Nota mãe</b> para ver o saldo.` : ''}`
      : `A tela de <b>${_acE(AC_MODALIDADES[f.modalidade])}</b> ainda não foi feita — por enquanto só Nota mãe.`}</p></div>`;
  } else {
    corpo = `<div class="mp-card"><h4 class="mp-tit">Resumo <span class="mo-hint">${_acResumoTxt(aut, maes, g)}</span></h4>${_acCardsSaldo(aut)}${_acGraficos(aut)}</div>
      <div class="mp-subabas ac-subabas" role="tablist">${[['maes', 'ti-file-dollar', 'Notas mães', maes.length, ''], ['semvinc', 'ti-link-off', 'Sem vínculo', g.semVinc.length, g.semVinc.length ? 'var(--red)' : '']].map(([k, ic, rot, n, cor]) =>
        `<button class="mo-aba${AC.paba === k ? ' on' : ''}" role="tab" aria-selected="${AC.paba === k}" onclick="acPaba('${k}')"><i class="ti ${ic}"${cor ? ` style="color:${cor}"` : ''}></i>${rot} <b${cor ? ` style="color:${cor}"` : ''}>${n}</b></button>`).join('')}</div>
      <div class="ac-maes">${AC.paba === 'semvinc' ? _acAlertaSemVinc(f, g) : _acCardsMaes(maes)}</div>`;
  }
  return _acCab(mig, _acE(f.nome), _acCnpjFmt(f.cnpj), ehMae ? soma('pendT') : 0, ehMae ? soma('pendR') : 0) + mod + corpo;
}

/* ───────── cards no padrão da Visão Micro (expande, recolhe, foco) ───────── */
const _acPill = (txt, cor, ic) => `<span class="ac-pill" style="--c:${cor}">${ic ? `<i class="ti ${ic}"></i>` : ''}${txt}</span>`;
const _acChev = aberto => `<i class="ti ti-chevron-down micro-filial-chev" style="color:var(--text3);font-size:16px;flex-shrink:0;transition:transform 0.2s;${aberto ? 'transform:rotate(180deg)' : ''}"></i>`;

const _acDlId = c => (c || 'semcentral').replace(/[^A-Za-z0-9]/g, '_');
const _acNoLote = r => !!(r?.mae && !r.excede);
function _acRecHtml(s, r) {
  if (!r?.mae) return `<span class="mo-hint ac-rec-nao">${_acE(r?.motivo || '—')}</span>`;
  const m = r.mae, tip = `NF ${m.numero} · ${m.central} · ${_acData(m.emissao)} · ${m.materiais.join(', ')} — saldo já descontando as filhas mais antigas recomendadas antes desta`;
  return `<div class="ac-rec" title="${_acE(tip)}"><div><b class="mono">${_acE(m.numero)}</b><small>${_acData(m.emissao)} · saldo ${_acT(r.saldo)}</small>
    ${r.excede ? `<small class="ac-exc"><i class="ti ti-alert-triangle"></i> passa ${_acT(r.excede)} do saldo</small>` : ''}</div>
    <button class="btn btn-sm" onclick="acVincularRecs('${s.cnpj}','${s.chave}')" title="Vincular à recomendada"><i class="ti ti-check"></i></button></div>`;
}
// Subaba "Sem vínculo": filhas cujo complementar não cita a nota mãe — vincular à mão.
function _acAlertaSemVinc(f, g) {
  if (!g.semVinc.length) return '<div class="mp-card"><p class="mo-hint"><i class="ti ti-circle-check" style="color:var(--green)"></i> Todas as notas filhas deste fornecedor estão vinculadas a uma nota mãe.</p></div>';
  const rec = _acRec(g), lote = g.semVinc.filter(s => _acNoLote(rec.get(s.chave)));
  const avisos = g.semVinc.filter(s => rec.get(s.chave)?.excede).length;
  return `<div class="mp-card ac-semvinc">
    <h4 class="mp-tit">${g.semVinc.length} nota${g.semVinc.length > 1 ? 's' : ''} filha${g.semVinc.length > 1 ? 's' : ''} sem vínculo <span class="mo-hint">${_acT(g.semVinc.reduce((t, s) => t + s.peso, 0))} · o complementar não cita a nota mãe</span></h4>
    ${lote.length ? `<div class="ac-rec-lote"><button class="btn btn-sm btn-primary" onclick="acVincularRecs('${f.cnpj}')"><i class="ti ti-link"></i> Vincular ${lote.length} recomendada${lote.length > 1 ? 's' : ''}</button><span class="mo-hint">a nota mãe mais antiga com saldo, da mesma central e material${avisos ? ` · ${avisos} com aviso de saldo fica${avisos > 1 ? 'm' : ''} fora do lote` : ''}</span></div>` : ''}
    <div class="micro-table-wrap"><table class="ac-tab"><thead><tr><th>Número</th><th>Emissão</th><th>Central</th><th>Material</th><th class="num">Peso</th><th>Complementar</th><th>Recomendada</th><th>Vincular à nota mãe</th></tr></thead><tbody>
    ${g.semVinc.map(s => `<tr>
      <td class="mono">${_acE(s.numero)}</td><td>${_acData(s.emissao)}</td><td>${_acE(s.central || '—')}</td><td class="ac-comp ac-comp-mat" title="${_acE(s.materiais.join(', '))}">${_acE(s.materiais.join(', ') || '—')}</td><td class="num mono">${_acT(s.peso)}</td>
      <td class="ac-comp" title="${_acE(s.comp)}">${_acE(s.comp || '—')}</td>
      <td>${_acRecHtml(s, rec.get(s.chave))}</td>
      <td><div class="ac-vinc"><input class="form-input" id="ac-v-${s.chave}" placeholder="Nº ou chave da mãe" list="ac-dl-${f.cnpj}-${_acDlId(s.central)}" onkeydown="if(event.key==='Enter')acVincular('${s.chave}')"><button class="btn btn-sm" onclick="acVincular('${s.chave}')" title="Vincular"><i class="ti ti-link"></i></button></div></td>
    </tr>`).join('')}
    </tbody></table></div>
    ${[...new Set(g.semVinc.map(s => s.central))].map(c => {
      // Sugestões só com as mães da central da filha (Hugo, 23/11/2026); filha
      // sem central (ou central sem mãe conhecida) vê todas as do fornecedor.
      const daCen = c ? g.maes.filter(m => m.central === c) : [];
      return `<datalist id="ac-dl-${f.cnpj}-${_acDlId(c)}">${(daCen.length ? daCen : g.maes).map(m => `<option value="${_acE(m.numero)}">${_acE(m.numero)} · ${_acE(m.central || 'sem central')} · ${_acData(m.emissao)} · ${m.status === 'autorizada' ? 'saldo ' + _acT(m.pendT) : AC_STATUS[m.status][0].toLowerCase()} · ${_acE(m.materiais.join(', ') || 'sem material')}</option>`).join('')}</datalist>`;
    }).join('')}
  </div>`;
}

function _acCardsMaes(maes) {
  if (!maes.length) return `<div class="mp-card"><p class="mo-hint">Nenhuma nota mãe deste fornecedor no SEFAZ importado${_acTemFiltro() ? ' para o filtro' : ''}.</p></div>`;
  return `<div class="micro-section-title" style="margin:6px 2px 0"><i class="ti ti-file-dollar"></i> Notas mães (${maes.length})</div>` + maes.map(m => {
    const st = AC_STATUS[m.status], ab = AC.abertas.has(m.chave);
    const stHtml = m.status === 'cancelada'
      ? `<span class="badge ${st[1]}" title="Cancelada no SEFAZ">${st[0]}</span>`
      : `<select class="form-select ac-st ${st[1]}" onclick="event.stopPropagation()" onchange="acStatus('${m.chave}', this.value)" title="Status da nota mãe">${AC_STATUS_MANUAIS.map(k => `<option value="${k}"${m.status === k ? ' selected' : ''}>${AC_STATUS[k][0]}</option>`).join('')}</select>`;
    return `<div class="micro-filial-card ac-mcard${m.status !== 'autorizada' ? ' ac-inativa' : ''}" data-ac="${m.chave}">
      <div class="micro-filial-header-wrap${ab ? ' open' : ''}">
        <div class="micro-filial-header" onclick="acToggle(this.closest('.micro-filial-header-wrap'))">
          <div class="micro-filial-name"><i class="ti ti-file-dollar"></i> NF ${_acE(m.numero)}<span class="ac-mcard-sub">${_acE(m.central || 'sem central')} · ${_acData(m.emissao)}</span></div>
          <div class="micro-filial-summary">${stHtml}
            ${_acPill('Restante: ' + _acT(m.pendT), m.pendT > 0 ? 'var(--amber)' : 'var(--text3)', 'ti-hourglass')}
            ${_acPill('Retirado ' + _acNf0.format(m.pct * 100) + '%', 'var(--teal)', 'ti-truck-delivery')}
            ${m.excedido ? _acPill('Excedido ' + _acT(m.excedido), 'var(--red)', 'ti-alert-triangle') : ''}
            <span class="summary-sep"></span>
            <span class="ac-mcard-mat" title="${_acE(m.materiais.join(', '))}">${_acE(m.materiais.join(', ') || '—')}</span>
            <span class="ac-minibar" title="${_acNf0.format(m.pct * 100)}% retirado"><i style="width:${m.pct * 100}%"></i></span>
          </div>
        </div>
        <div class="micro-filial-actions">${_acChev(ab)}</div>
      </div>
      <div class="micro-filial-body${ab ? ' open' : ''}">${ab ? _acRelatorio(m) : ''}</div>
    </div>`;
  }).join('');
}

// Relatório da nota mãe (corpo do card): KPIs, barra, curva do saldo, dados da nota e filhas.
function _acRelatorio(m) {
  const tempo = m.diasRest == null ? '—' : m.diasRest === 0 ? 'Zerado' : `${_acNf0.format(Math.ceil(m.diasRest))} dias`;
  const tempoSub = m.previsao ? `até acabar · previsão ${_acData(m.previsao)}` : m.diasRest === 0 ? 'saldo zerado' : 'até acabar · sem ritmo de retiradas';
  let s = m.peso;
  const filhas = m.filhas.map(f => {
    const ok = f.status !== 'cancelada'; if (ok) s -= f.peso;
    return `<tr${ok ? '' : ' class="inativa"'}>
      <td class="mono">${_acE(f.numero)}${ok ? '' : ' <span class="badge badge-red">Cancelada</span>'}</td><td>${_acData(f.emissao)}</td><td>${_acE(f.central || '—')}</td>
      <td class="num mono">${_acT(f.peso)}</td><td class="num mono">${ok ? _acT(s) : '—'}</td>
      <td><span class="badge ${f.vinculo === 'manual' ? 'badge-purple' : 'badge-teal'}">${{ manual: 'Manual', chave: 'Pela chave', numero: 'Pelo número' }[f.vinculo]}</span></td>
      <td class="mono ac-chave" title="${f.chave}">${f.chave}</td>
      <td>${f.vinculo === 'manual' ? `<button class="btn-icon danger" title="Desfazer vínculo manual" onclick="event.stopPropagation();acDesvincular('${f.chave}')"><i class="ti ti-link-off"></i></button>` : ''}</td>
    </tr>`;
  }).join('');
  return `<div class="micro-body-section">
      <div class="micro-section-title"><i class="ti ti-report-analytics"></i> Saldo da nota mãe</div>
      <div class="mp-pend ac-pend6">
        ${_acCx(_acT(m.retT), 'retirado · ' + _acR(m.retR), 'var(--teal)')}
        ${_acCx(_acT(m.pendT), 'restante · ' + _acR(m.pendR), 'var(--amber)')}
        ${_acCx(_acNf0.format(m.nRet), `NFs retiradas de ${_acT(m.peso)}`)}
        ${_acCx(m.nfsRest == null ? '—' : _acNf0.format(m.nfsRest), 'NFs até acabar (peso médio)')}
        ${_acCx(tempo, tempoSub, 'var(--purple)')}
        ${_acCx(m.pesoMedio ? _acT(m.pesoMedio) : '—', 'peso médio das filhas do fornecedor')}
      </div>
      <div class="ac-prog"><div class="ac-prog-bar"><i style="width:${m.pct * 100}%"></i></div>
        <div class="ac-prog-leg"><span><b class="ac-dot teal"></b>Retirado ${_acNf0.format(m.pct * 100)}%</span><span><b class="ac-dot amber"></b>Restante ${_acNf0.format((1 - m.pct) * 100)}%</span>
        ${m.excedido ? `<span class="ac-exc"><i class="ti ti-alert-triangle"></i> Retirado ${_acT(m.excedido)} acima da nota mãe</span>` : ''}</div></div>
      ${_acCurva(m)}
    </div>
    <div class="micro-body-section">
      <div class="micro-section-title"><i class="ti ti-file-info"></i> Dados da nota</div>
      <div class="ac-dn">
        <div class="ac-dn-id">
          <div><span>Emissão</span><b>${_acData(m.emissao)}</b></div>
          <div><span>Central</span><b>${_acE(m.central || '—')}</b>${m.regional ? `<small>Regional ${_acE(m.regional)}</small>` : ''}</div>
          <div class="ac-dn-mat"><span>Material</span><b>${_acE(m.materiais.join(', ') || '—')}</b></div>
        </div>
        <div class="ac-dn-num">
          <div><span>Peso</span><b>${_acT(m.peso)}</b></div>
          <div><span>Custo unitário</span><b>${_acR(m.custoUn)}<small> /t</small></b></div>
          <div><span>Valor total</span><b>${_acR(m.valor)}</b></div>
        </div>
        <div class="ac-dn-chave"><span>Chave de acesso</span><code>${m.chave.replace(/(\d{4})(?=\d)/g, '$1 ')}</code>
          <button class="btn btn-sm" onclick="event.stopPropagation();acCopiar('${m.chave}')" title="Copiar a chave (sem espaços)"><i class="ti ti-copy"></i> Copiar</button></div>
      </div>
    </div>
    <div class="micro-body-section"><div class="micro-section-title"><i class="ti ti-truck-delivery"></i> Notas filhas (${m.filhas.length})</div>
      ${m.filhas.length ? '' : '<p class="mo-hint">Nenhuma nota filha vinculada a esta nota mãe ainda.</p>'}</div>
    ${m.filhas.length ? `<div class="micro-table-wrap"><table class="ac-tab"><thead><tr><th>Nota filha</th><th>Emissão</th><th>Central</th><th class="num">Peso</th><th class="num">Saldo depois</th><th>Vínculo</th><th>Chave de acesso</th><th></th></tr></thead><tbody>${filhas}</tbody></table></div>` : ''}`;
}

// Curva do saldo restante (degrau a cada filha) + projeção tracejada até zerar.
function _acCurva(m) {
  const fs = m.filhas.filter(f => f.status !== 'cancelada');
  if (!fs.length || !(m.peso > 0)) return '';
  const W = 640, H = 150, P = { l: 52, r: 12, t: 12, b: 22 };
  const t0 = Math.min(m.emissao || fs[0].emissao, fs[0].emissao);
  const tFim = Math.max(m.previsao || 0, fs[fs.length - 1].emissao, t0 + _acDia);
  const yMax = Math.max(m.peso, m.retT);
  const x = t => P.l + (t - t0) / (tFim - t0) * (W - P.l - P.r);
  const y = v => P.t + (1 - Math.max(0, v) / yMax) * (H - P.t - P.b);
  let s = m.peso, d = `M${x(t0)},${y(s)}`;
  fs.forEach(f => { d += ` H${x(f.emissao)}`; s -= f.peso; d += ` V${y(s)}`; });
  const ult = fs[fs.length - 1].emissao;
  const proj = m.previsao && s > 0 ? `<path d="M${x(ult)},${y(s)} L${x(m.previsao)},${y(0)}" class="ac-proj"/>` : '';
  const ticks = [0, 0.5, 1].map(k => `<text x="${P.l - 6}" y="${y(yMax * k) + 3}" text-anchor="end">${_acNf0.format(yMax * k)} t</text><line x1="${P.l}" x2="${W - P.r}" y1="${y(yMax * k)}" y2="${y(yMax * k)}"/>`).join('');
  return `<div class="ac-curva"><div class="ac-curva-tit">Saldo restante ao longo do tempo</div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Saldo restante da nota mãe">
      <g class="ac-grid">${ticks}</g>
      <path d="${d}" class="ac-linha"/>${proj}
      <text x="${P.l}" y="${H - 6}">${_acData(t0)}</text><text x="${W - P.r}" y="${H - 6}" text-anchor="end">${_acData(tFim)}${m.previsao ? ' (previsão)' : ''}</text>
    </svg></div>`;
}

/* ───────── ações de tela ───────── */
function acSel(cnpj) { AC.sel = AC.sel === cnpj ? '' : cnpj; AC.paba = 'maes'; AC.abertas.clear(); _acDesenhar(); }
function acGrp(k) { AC.grp = AC.grp === k ? '' : k; AC.sel = ''; _acDesenhar(); }
function acGrupo(g) { AC.F.grupo = g; AC.grp = ''; _acDesenhar(); }
function acAba(k) { AC.aba = k; AC.sel = ''; AC.grp = ''; _acDesenhar(); }
function acPaba(k) { AC.paba = k; _acDesenhar(); }
let _acBuscaT = null;
// Só a lista muda: o painel resume a aba e os filtros, não o texto da busca.
function acBusca(q) {
  AC.F.q = q; clearTimeout(_acBuscaT);
  _acBuscaT = setTimeout(() => { if (!mpTrocarCorpoLista(document.querySelector('#ac-root .mp-lista'), _acListaHtml())) _acDesenhar(); }, 250);
}
// Recolhe/expande com a animação do Mural (muralPainelLista): a largura da
// lista que já está na tela transita (CSS .mp-anim) e o conteúdo novo entra com
// fade (.entrando). Só a lista é trocada: o painel (e o que estiver digitado
// nele) fica como está.
function acLista() {
  if (AC.listaAnim) return;
  AC.listaRecolhida = !AC.listaRecolhida;
  try { localStorage.setItem('acordos.listaRecolhida', AC.listaRecolhida ? '1' : '0'); } catch (_) { /* sem storage */ }
  const lista = document.querySelector('#ac-root .mp-lista');
  if (!lista || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return _acDesenhar();
  AC.listaAnim = true;
  // Congela a largura do conteúdo para ele não refluir enquanto a lista muda.
  [...lista.children].forEach(c => { c.style.width = c.offsetWidth + 'px'; });
  lista.classList.add('mp-anim');
  lista.classList.toggle('recolhida', AC.listaRecolhida);
  setTimeout(() => {
    AC.listaAnim = false;
    const atual = document.querySelector('#ac-root .mp-lista');
    if (atual) { atual.outerHTML = _acListaHtml(); document.querySelector('#ac-root .mp-lista').classList.add('entrando'); }
    _acEvoDesenhar();   // a largura do painel mudou
  }, MP_LISTA_ANIM_MS);
}
function acRecarregar() { AC.carga = null; AC.sujo = true; acordosRender(); }

// Filtros com vários itens (mesmo fluxo do Mural: marca, Aplicar/Cancelar).
function acFAbrir(k) {
  if (AC.fAberto === k) return acFFechar();
  AC.fAberto = k; AC.fPend = new Set(AC.F[k]); AC.fBusca = '';
  _acDesenhar();
  document.getElementById('acf-busca-' + k)?.focus();
}
function acFMarcar(el) { if (el.checked) AC.fPend.add(el.dataset.v); else AC.fPend.delete(el.dataset.v); }
function acFBuscar(el) { AC.fBusca = el.value; mfFiltrarOpcoes(el); }
function acFFechar() { AC.fAberto = null; AC.fPend = null; AC.fBusca = ''; _acDesenhar(); }
function acFAplicar(k) { AC.F[k] = new Set(AC.fPend); acFFechar(); }
function acFLimpar(k) { AC.F[k] = new Set(); acFFechar(); }
function acFLimparTodos() { AC_FILTROS.forEach(x => { AC.F[x.k] = new Set(); }); _acDesenhar(); }

// Expandir/recolher um card (como toggleMicro). O corpo só é montado ao abrir.
function acToggle(wrap) {
  const card = wrap.closest('.ac-mcard'), k = card.dataset.ac, body = wrap.nextElementSibling;
  const aberto = !AC.abertas.has(k);
  if (aberto) AC.abertas.add(k); else AC.abertas.delete(k);
  if (aberto && !body.innerHTML.trim()) {
    const m = AC.maePorChave.get(k);
    if (m) body.innerHTML = _acRelatorio(m);
  }
  body.classList.toggle('open', aberto);
  wrap.classList.toggle('open', aberto);
  const chev = wrap.querySelector('.micro-filial-chev');
  if (chev) chev.style.transform = aberto ? 'rotate(180deg)' : '';
  _acFoco();
}
// Foco (como _updateCentralFocus): com 1+ card aberto, os fechados esmaecem.
function _acFoco() {
  const cards = document.querySelectorAll('#ac-root .ac-maes .ac-mcard');
  const algum = [...cards].some(c => AC.abertas.has(c.dataset.ac));
  cards.forEach(c => c.classList.toggle('central-dimmed', algum && !AC.abertas.has(c.dataset.ac)));
}

const _acQuem = () => ({ atualizado_por: window.currentUser?.id, atualizado_em: new Date().toISOString() });

async function acModalidade(cnpj, mod) {
  const f = AC.forn.get(cnpj);
  const q = window.supabaseClient.from('acordo_fornecedores');
  const { error } = mod
    ? await q.upsert({ cnpj, nome: f?.nome || null, modalidade: mod, ..._acQuem() })
    : await q.delete().eq('cnpj', cnpj);
  if (error) { toast('Falha ao salvar a modalidade: ' + error.message, 'error'); _acDesenhar(); return; }
  if (f) f.modalidade = mod;
  AC.sel = cnpj;
  if (mod !== AC.aba) AC.aba = mod;   // segue o fornecedor para a aba da nova modalidade
  _acDesenhar();
  toast(mod ? `${f?.nome || cnpj}: ${AC_MODALIDADES[mod]}.` : 'Modalidade removida.', 'success');
}

async function acStatus(chave, st) {
  const q = window.supabaseClient.from('acordo_nf_status');
  const { error } = st === 'autorizada' ? await q.delete().eq('chave', chave) : await q.upsert({ chave, status: st, ..._acQuem() });
  if (error) { toast('Falha ao salvar o status: ' + error.message, 'error'); _acDesenhar(); return; }
  if (st === 'autorizada') AC.status.delete(chave); else AC.status.set(chave, st);
  acordosRender();
}

async function acVincular(chaveFilha) {
  const inp = document.getElementById('ac-v-' + chaveFilha);
  const v = String(inp?.value || '').replace(/\D/g, '');
  const filha = AC.filhas.find(f => f.chave === chaveFilha);
  if (!v || !filha) { toast('Informe o número ou a chave de acesso da nota mãe.', 'error'); return; }
  let mae = null;
  if (v.length === 44) {
    mae = AC.maePorChave.get(v);
    if (!mae) { toast('Essa chave não é de uma nota mãe do SEFAZ importado.', 'error'); return; }
  } else {
    const cands = AC.maePorNum.get(filha.cnpj + '|' + _acNum(v)) || [];
    if (cands.length > 1) { toast('Há mais de uma nota mãe com esse número — informe a chave de acesso.', 'error'); return; }
    mae = cands[0];
    if (!mae) { toast(`Nenhuma nota mãe nº ${_acNum(v)} deste fornecedor no SEFAZ importado.`, 'error'); return; }
  }
  if (mae.cnpj !== filha.cnpj && !confirm(`A nota mãe ${mae.numero} é de outro fornecedor (${mae.nome}). Vincular mesmo assim?`)) return;
  const { error } = await window.supabaseClient.from('acordo_vinculos')
    .upsert({ chave_filha: chaveFilha, chave_mae: mae.chave, numero_mae: mae.numero, ..._acQuem() });
  if (error) { toast('Falha ao vincular: ' + error.message, 'error'); return; }
  AC.vinc.set(chaveFilha, { chave_mae: mae.chave, numero_mae: mae.numero });
  toast(`Nota filha ${filha.numero} vinculada à nota mãe ${mae.numero}.`, 'success');
  acordosRender();
}

// Aceita a recomendação de uma filha (com chave) ou todas as do fornecedor sem
// aviso de saldo. Não sobrescreve vínculo que outro usuário tenha feito antes.
async function acVincularRecs(cnpj, chaveFilha) {
  const g = AC.porForn.get(cnpj);
  if (!g || AC.vinculando) return;
  const rec = _acRec(g);
  const pares = g.semVinc.map(s => [s, rec.get(s.chave)]).filter(([s, r]) => chaveFilha ? s.chave === chaveFilha && r?.mae : _acNoLote(r));
  if (!pares.length) return;
  if (!chaveFilha) {
    const t = pares.reduce((a, [s]) => a + s.peso, 0), nMaes = new Set(pares.map(([, r]) => r.mae.chave)).size;
    if (!confirm(`Vincular ${pares.length} nota(s) filha(s) (${_acT(t)}) a ${nMaes} nota(s) mãe recomendada(s)?\n\nPara desfazer, é uma a uma, na lista de filhas da nota mãe.`)) return;
  } else if (pares[0][1].excede && !confirm(`A filha ${pares[0][0].numero} passa ${_acT(pares[0][1].excede)} do saldo da nota mãe ${pares[0][1].mae.numero}. Vincular mesmo assim?`)) return;
  AC.vinculando = true;
  let erro = null, gravadas = 0;
  try {
    const linhas = pares.map(([s, r]) => ({ chave_filha: s.chave, chave_mae: r.mae.chave, numero_mae: r.mae.numero, ..._acQuem() }));
    for (let i = 0; i < linhas.length && !erro; i += 500) {
      const { error, data } = await window.supabaseClient.from('acordo_vinculos')
        .upsert(linhas.slice(i, i + 500), { onConflict: 'chave_filha', ignoreDuplicates: true }).select('chave_filha');
      if (error) erro = error; else gravadas += data.length;
    }
    _acSetVinc(await _acFetchAll('acordo_vinculos', '*', 'chave_filha'));
  } catch (e) { erro = erro || e; }
  AC.vinculando = false;
  if (erro) toast(`Falha ao vincular${gravadas ? ` (${gravadas} gravada(s) antes do erro)` : ''}: ` + (erro.message || erro), 'error');
  else toast(`${gravadas} nota(s) filha(s) vinculada(s)${gravadas < pares.length ? ` · ${pares.length - gravadas} já tinha(m) vínculo` : ''}.`, 'success');
  acordosRender();
}

function acCopiar(txt) {
  const ok = () => toast('Chave de acesso copiada.', 'success');
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(txt).then(ok, () => prompt('Copie a chave de acesso:', txt));
  else prompt('Copie a chave de acesso:', txt);
}

async function acDesvincular(chaveFilha) {
  if (!confirm('Desfazer o vínculo manual desta nota filha? Ela volta para os alertas se o complementar não citar a nota mãe.')) return;
  const { error } = await window.supabaseClient.from('acordo_vinculos').delete().eq('chave_filha', chaveFilha);
  if (error) { toast('Falha ao desfazer: ' + error.message, 'error'); return; }
  AC.vinc.delete(chaveFilha);
  acordosRender();
}

/* ───────── tempo real (ADM × INSUMOS) ───────── */
// ponytail: recarrega a tabela inteira a cada evento (são pequenas); o SEFAZ
// (cob_imports/cob_cfop) recarrega tudo na próxima abertura da aba ou na hora, se ela estiver aberta.
function _acRealtime() {
  const sb = window.supabaseClient;
  if (!sb) return;
  const ativa = () => document.getElementById('page-acordos')?.classList.contains('active');
  // Eventos agrupados: o vínculo em lote grava centenas de linhas de uma vez.
  const tabela = (t, ordem, set) => {
    let espera = null;
    sb.channel('ac_' + t).on('postgres_changes', { event: '*', schema: 'public', table: t }, () => {
      clearTimeout(espera);
      espera = setTimeout(async () => {
        try { set(await _acFetchAll(t, '*', ordem)); if (ativa() && AC.carga) acordosRender(); } catch (e) { console.warn('[Acordos]', t, e); }
      }, 400);
    }).subscribe();
  };
  tabela('acordo_fornecedores', 'cnpj', _acSetForn);
  tabela('acordo_nf_status', 'chave', _acSetStatus);
  tabela('acordo_vinculos', 'chave_filha', _acSetVinc);
  let timer = null;
  sb.channel('ac_sefaz')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cob_imports' }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => { AC.carga = null; AC.sujo = true; if (ativa()) acordosRender(); }, 1500);
    }).subscribe();
}

Object.assign(window, { acordosRender, acSel, acGrp, acGrupo, acAba, acPaba, acBusca, acLista, acRecarregar, acFAbrir, acFMarcar, acFBuscar, acFFechar, acFAplicar, acFLimpar, acFLimparTodos, acToggle, acModalidade, acStatus, acVincular, acVincularRecs, acEvo, acCopiar, acDesvincular });
// Lista recolhida: lembrada neste navegador.
try { AC.listaRecolhida = localStorage.getItem('acordos.listaRecolhida') === '1'; } catch (_) { /* sem storage */ }
