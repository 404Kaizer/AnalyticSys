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
// faturamento), 'filha' (5116/6116/5117/6117, remessa) e 'devolucao' (x201,
// x202, x410… — SQL 20261127). A filha aponta a mãe nas informações
// complementares (nº ou chave); a devolução aponta a mãe ou a filha que devolve
// (parte ou tudo). A que não aponta vira "sem vínculo" e o analista vincula à
// mão (acordo_vinculos).
// Central: das Entradas (state.entradas) pela chave de acesso ou, sem chave,
// por CNPJ do fornecedor + número; mãe sem Entrada herda a central das filhas.
// Status (mães e filhas): Autorizada (padrão), Cancelada (SEFAZ, trava), e os
// manuais Devolvida/Inutilizada/Indevida/Recusada (acordo_nf_status). Devolvida
// também sozinha, quando as NFs de devolução zeram a nota (_acMontar).
// Peso = VOLUME do SEFAZ em toneladas (igual à Cobrança).
// ══════════════════════════════════════════════════════════════════════

const AC_MODALIDADES = { nota_mae: 'Nota mãe', rebate: 'Rebate', acordo_financeiro: 'Acordo financeiro' };
// Finalizada: automático (mãe retirada até o fim), não fica em acordo_nf_status.
const AC_STATUS = {
  autorizada: ['Autorizada', 'badge-green'], finalizada: ['Finalizada', 'badge-green'], cancelada: ['Cancelada', 'badge-red'],
  devolvida: ['Devolvida', 'badge-amber'], inutilizada: ['Inutilizada', 'badge-purple'],
  indevida: ['Indevida', 'badge-amber'], recusada: ['Recusada', 'badge-red'],
};
const AC_STATUS_MANUAIS = ['autorizada', 'devolvida', 'inutilizada', 'indevida', 'recusada'];
const AC_GRUPOS = { fornecedor: 'Fornecedor', regional: 'Regional', central: 'Central', material: 'Material' };

const AC = {
  carga: null, sujo: true, iniciado: false,
  cfop: new Map(),            // cfop → 'mae' | 'filha' | 'devolucao'
  forn: new Map(),            // cnpj → { cnpj, nome, modalidade }
  status: new Map(),          // chave → status manual
  vinc: new Map(),            // chave_filha → { chave_mae, numero_mae }
  regPorCen: new Map(),       // alias → regional
  nfs: [],                    // NFs do SEFAZ (mães + filhas), cruas
  maes: [], filhas: [], devs: [], porForn: new Map(),
  cenIdx: null, cenIdxRef: null, cenIdxLen: -1,
  sel: '', grp: '', aba: null, paba: 'maes', abertas: new Set(), listaRecolhida: false,
  geo: new Map(), geoBuscando: new Set(), geoErro: new Map(),   // ficha do fornecedor: endereço do CNPJ (custos_geo)
  fAberto: null, fPend: null, fBusca: '', evo: 't', evoNotas: [],
  F: { q: '', regs: new Set(), cens: new Set(), mats: new Set(), grupo: 'regional' },
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
const AC_ZERO = 0.005;   // t: abaixo disso o saldo mostra "0,00 t" e conta como zerado

/* ───────── carga ───────── */
// table: nome da tabela ou função que devolve a consulta (rpc).
async function _acFetchAll(table, cols, ordem, filtro = q => q) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const base = typeof table === 'function' ? table() : window.supabaseClient.from(table).select(cols);
    const { data, error } = await filtro(base).order(ordem).range(de, de + 999);
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

  // Uma consulta só (RPC acordo_sefaz_nfs, SQL 20261127). Sem a RPC: uma por CFOP
  // (contains no jsonb dos itens). A NF com item de mãe e de filha conta como mãe.
  const cols = 'chave, cnpj_emitente, nome, numero, serie, emissao, status, itens, municipio, uf, transportador';
  let lotes;
  try { lotes = AC.cfop.size ? [await _acFetchAll(() => sb.rpc('acordo_sefaz_nfs').select(cols), cols, 'chave')] : []; }
  catch (e) {
    console.warn('[Acordos] RPC acordo_sefaz_nfs (rode o SQL 20261127_acordos_devolucao):', e.message || e);
    lotes = await Promise.all([...AC.cfop.keys()].map(cfop =>
      _acFetchAll('cob_sefaz', cols, 'chave', q => q.contains('itens', JSON.stringify([{ cfop }])))));   // string: array vira literal de array do Postgres, não JSON
  }
  const porChave = new Map();
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

/* ───────── vínculo filha → mãe e devolução → mãe/filha ───────── */
// O complementar vem com muito texto junto (motorista, placas, lacres, frete…).
// Ex.: "...[LACRES: 988545-988546] [FRETE TOTAL 1.944,99] REMESSA REFERENTE A
// NFE 0949920 DE 24 09 2026, NF 0949920 23 09 26" → mãe 949920.
// Cada fornecedor escreve de um jeito ("NF 123", "SIMPLES FATURAMENTO 123",
// "NOTA 123", "NFE 000.000.123"…), então NÃO se depende da palavra antes do número
// (Hugo, 27/11/2026): vale TODO número do texto que seja de uma nota do sistema.
//   chaves: 44 dígitos seguidos ou em blocos de 4 (espaço/ponto entre blocos);
//   todos:  todo número com 3+ dígitos (sem os zeros à esquerda), ponto de milhar
//           juntado ("000.949.920" → 949920);
//   rot:    os que vêm depois de NF / NFE / N.F. / NOTA (FISCAL) / FATURAMENTO, com
//           até 4 palavras no meio ("NOTA FISCAL MAE 123", "NF-E REFERENCIADA: 123")
//           — só para desempatar.
// Dígitos separados por espaço/hífen NÃO são emendados (datas, lacres).
// ponytail: nota com nº de 1–2 dígitos não casa pelo número (seria qualquer data
// ou peso). Teto: vínculo manual.
const AC_RE_CHAVE = /(?<!\d)\d{4}(?:[ .]?\d{4}){10}(?!\d)/g;
const AC_RE_NF = /(?:^|[^A-Z])(?:N\.?\s?F\.?(?:\s?-?\s?E)?|NOTAS?(?:\s+FISCA(?:L|IS))?(?:\s+ELETRONICAS?)?|FATURAMENTO)(?:[\s:.#-]+(?:[A-Z]{1,14}|N[º°])\.?){0,4}[\s:.#-]*(\d+)(?!\d)/g;
function _acCitacoes(txt) {
  const s = normalizeText(txt);
  const chaves = (s.match(AC_RE_CHAVE) || []).map(c => c.replace(/\D/g, ''));
  const resto = s.replace(AC_RE_CHAVE, ' ').replace(/(\d)\.(?=\d{3}(?!\d))/g, '$1');
  const nums = re => new Set([...resto.matchAll(re)].map(m => _acNum(m[1] ?? m[0])).filter(n => n.length >= 3));
  return { chaves, rot: nums(AC_RE_NF), todos: nums(/\d+/g) };
}

// Nota citada no complementar de `n`: pela chave; senão por um número que seja de
// uma nota de `porNum` dos CNPJs dados, não cancelada e emitida até o dia de `n`.
// Mais de uma: devolução que cita a filha e a mãe dela fica com a filha; depois
// vale a citada ao lado de NF/NOTA/FATURAMENTO, a do mesmo material e a da mesma
// central. Empate que sobra → sem vínculo (recomendação / vínculo manual).
// Devolve [nota, 'chave' | 'numero'] ou [null, ''].
const _acDiaDe = ms => new Date(ms).setHours(0, 0, 0, 0);
function _acAchar(n, porChave, porNum, cnpjs) {
  const { chaves, rot, todos } = _acCitacoes(n.comp);
  const ch = chaves.map(c => porChave.get(c)).find(x => x && x !== n);
  if (ch) return [ch, 'chave'];
  let cands = [];
  for (const c of cnpjs) for (const x of todos) for (const m of porNum.get(c + '|' + x) || []) {
    if (m !== n && m.status !== 'cancelada' && !cands.includes(m) && !(m.emissao && n.emissao && _acDiaDe(m.emissao) > _acDiaDe(n.emissao))) cands.push(m);
  }
  const filtra = ok => { if (cands.length > 1) { const c = cands.filter(ok); if (c.length) cands = c; } };
  filtra(m => !cands.some(f => f.mae === m));
  filtra(m => rot.has(m.numero));
  filtra(m => n.mats.some(x => m.mats.some(y => _acMesmoMat(x, y))));
  filtra(m => !!n.central && m.central === n.central);
  return cands.length === 1 ? [cands[0], 'numero'] : [null, ''];
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
  // Filha conta pelo retirado (sem o que devolveu); devolução da mãe também abate.
  const saldos = new Map(maes.map(m => {
    const bolsas = m.mats.map(x => ({ keys: x.keys, saldo: m.mats.length === 1 ? m.peso : x.peso }));
    const tira = (n, fator) => {
      if (bolsas.length === 1) { bolsas[0].saldo -= n.peso * fator; return; }
      n.mats.forEach(x => { const b = bolsas.find(y => _acMesmoMat(x, y)); if (b) b.saldo -= x.peso * fator; });
    };
    m.filhas.forEach(f => { if (f.ret > 0) tira(f, f.ret / f.peso); });
    m.devs.forEach(d => tira(d, 1));
    return [m, bolsas];
  }));
  [...g.semVinc].sort((a, b) => a.emissao - b.emissao).forEach(f => {
    const man = AC.vinc.get(f.chave);
    if (man) { rec.set(f.chave, { motivo: `vinculada à NF ${man.numero_mae}, que não está no SEFAZ importado` }); return; }
    if (f.status !== 'autorizada') { rec.set(f.chave, { motivo: `filha ${AC_STATUS[f.status][0].toLowerCase()} — não conta no saldo` }); return; }
    if (!f.central) { rec.set(f.chave, { motivo: 'filha sem central nas Entradas' }); return; }
    if (!f.mats.length || !(f.ret > 0)) { rec.set(f.chave, { motivo: 'filha sem material ou peso' }); return; }
    const fator = f.ret / f.peso, cands = [];
    for (const m of maes) {
      if (m.central !== f.central || (m.emissao && f.emissao && dia(m.emissao) > dia(f.emissao))) continue;
      const usa = f.mats.map(x => [saldos.get(m).find(b => _acMesmoMat(x, b)), x.peso * fator]);
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
      tipo: tipos.includes('mae') ? 'mae' : tipos.includes('filha') ? 'filha' : 'dev',
      status: cancelada ? 'cancelada' : (manual || 'autorizada'), auto: false,
      itens, comp: itens.find(i => i.complementar)?.complementar || '',
      cnpjDest: itens.find(i => i.cnpj_dest)?.cnpj_dest || '',
      peso: itens.reduce((t, i) => t + (Number(i.volume) || 0), 0),
      valor: itens.reduce((t, i) => t + (Number(i.valor_total) || 0), 0),
      materiais: [...new Set(itens.map(i => i.material).filter(Boolean))],
      mats: _acMats(itens, chavesDe, idx.mat.get(s.chave) || idx.mat.get(s.cnpj_emitente + '|' + s.numero)),
      municipio: s.municipio || '', uf: s.uf || '', transp: s.transportador || '',
      central: idx.porCh.get(s.chave) || idx.porNf.get(s.cnpj_emitente + '|' + s.numero) || '',
    };
  };
  const todas = AC.nfs.map(mk);
  AC.maes = todas.filter(n => n.tipo === 'mae');
  AC.filhas = todas.filter(n => n.tipo === 'filha');
  const porNumDe = lista => { const p = new Map(); lista.forEach(m => { const k = m.cnpj + '|' + m.numero; (p.get(k) || p.set(k, []).get(k)).push(m); }); return p; };
  AC.maePorChave = new Map(AC.maes.map(m => [m.chave, m]));
  AC.maePorNum = porNumDe(AC.maes);
  AC.notaPorChave = new Map([...AC.maes, ...AC.filhas].map(n => [n.chave, n]));
  AC.notaPorNum = porNumDe([...AC.maes, ...AC.filhas]);
  AC.maes.forEach(m => { m.filhas = []; m.devs = []; });

  // Filha → mãe: vínculo manual; senão a chave ou o número citado (_acAchar).
  AC.filhas.forEach(f => {
    f.mae = null; f.vinculo = ''; f.devs = [];
    const man = AC.vinc.get(f.chave);
    if (man) { f.mae = AC.maePorChave.get(man.chave_mae) || null; f.vinculo = 'manual'; f.maeNumero = man.numero_mae; }
    else [f.mae, f.vinculo] = _acAchar(f, AC.maePorChave, AC.maePorNum, [f.cnpj]);
    if (f.mae) f.mae.filhas.push(f);
  });

  // Devolução → mãe ou filha. O fornecedor é o emitente (devolução de venda) ou o
  // destinatário (devolução de compra, emitida pela Concrelagos). Devolução de quem
  // não tem nota mãe/filha no SEFAZ é ignorada (compras comuns).
  const temNota = new Set([...AC.maes, ...AC.filhas].map(n => n.cnpj));
  AC.devs = [];
  todas.forEach(d => {
    if (d.tipo !== 'dev' || d.status === 'cancelada') return;
    d.alvo = null; d.vinculo = '';
    const cnpjs = [d.cnpj, d.cnpjDest].filter(Boolean);
    const man = AC.vinc.get(d.chave);
    if (man) { d.alvo = AC.notaPorChave.get(man.chave_mae) || null; d.vinculo = 'manual'; d.alvoNumero = man.numero_mae; }
    else [d.alvo, d.vinculo] = _acAchar(d, AC.notaPorChave, AC.notaPorNum, cnpjs);
    d.forn = d.alvo?.cnpj || cnpjs.find(c => temNota.has(c));
    if (!d.forn) return;
    if (d.alvo) d.alvo.devs.push(d);
    AC.devs.push(d);
  });
  const somaDev = n => n.devs.reduce((t, d) => t + d.peso, 0);

  // Filha: o que voltou por devolução sai do retirado; devolvida inteira → Devolvida.
  // Só filha Autorizada conta como retirado (Hugo, 27/11/2026).
  AC.filhas.forEach(f => {
    f.devNF = somaDev(f);
    if (f.status === 'autorizada' && f.devNF > 0 && f.devNF > f.peso - AC_ZERO) { f.status = 'devolvida'; f.auto = true; }
    f.ret = f.status === 'autorizada' ? Math.max(0, f.peso - f.devNF) : 0;
  });
  // Mãe sem Entrada: central mais frequente entre as filhas. Devoluções que zeram o
  // restante → Devolvida.
  AC.maes.forEach(m => {
    m.filhas.sort((a, b) => a.emissao - b.emissao);
    m.devs.sort((a, b) => a.emissao - b.emissao);
    if (!m.central) {
      const cont = new Map();
      m.filhas.forEach(f => f.central && cont.set(f.central, (cont.get(f.central) || 0) + 1));
      m.central = [...cont.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    }
    m.regional = AC.regPorCen.get(m.central) || '';
    m.devNF = somaDev(m);
    if (m.status === 'autorizada' && m.devNF > 0 && m.peso - m.filhas.reduce((t, f) => t + f.ret, 0) - m.devNF < AC_ZERO) { m.status = 'devolvida'; m.auto = true; }
  });
  AC.filhas.forEach(f => { if (!f.central && f.mae) f.central = f.mae.central; f.regional = AC.regPorCen.get(f.central) || ''; });
  AC.devs.forEach(d => { if (!d.central && d.alvo) d.central = d.alvo.central; d.regional = AC.regPorCen.get(d.central) || ''; });

  // Por fornecedor: mães, filhas sem vínculo, devoluções e o ritmo/peso médio das filhas.
  AC.porForn = new Map();
  const pf = c => AC.porForn.get(c) || AC.porForn.set(c, { maes: [], semVinc: [], filhas: [], devs: [], devSemVinc: [] }).get(c);
  AC.maes.forEach(m => { pf(m.cnpj).maes.push(m); if (!AC.forn.has(m.cnpj)) AC.forn.set(m.cnpj, { cnpj: m.cnpj, nome: m.nome || m.cnpj, modalidade: '' }); });
  AC.filhas.forEach(f => {
    const g = pf(f.cnpj);
    if (f.status === 'cancelada') return;
    if (f.mae) g.filhas.push(f); else g.semVinc.push(f);
  });
  AC.devs.forEach(d => { const g = pf(d.forn); (d.alvo ? g.devs : g.devSemVinc).push(d); });
  for (const g of AC.porForn.values()) {
    g.filhas.sort((a, b) => a.emissao - b.emissao);
    const ret = g.filhas.filter(f => f.ret > 0);
    g.pesoMedio = ret.length ? ret.reduce((t, f) => t + f.ret, 0) / ret.length : 0;
    g.intervalo = _acIntervalo(ret);
    g.maes.sort((a, b) => b.emissao - a.emissao);
    g.maes.forEach(m => {
      Object.assign(m, _acKpis(m, g));
      // Retirada até o fim → Finalizada (automático, não grava; Hugo 27/11/2026).
      if (m.status === 'autorizada' && m.totT > 0 && m.pendT === 0) { m.status = 'finalizada'; m.auto = true; }
    });
    g.pendT = g.maes.reduce((t, m) => t + m.pendT, 0);
    g.pendR = g.maes.reduce((t, m) => t + m.pendR, 0);
    g.semVinc.sort((a, b) => b.emissao - a.emissao);
    g.devSemVinc.sort((a, b) => b.emissao - a.emissao);
  }
}

// Dias médios entre filhas consecutivas (null com menos de 2).
function _acIntervalo(fs) {
  if (fs.length < 2) return null;
  return (fs[fs.length - 1].emissao - fs[0].emissao) / _acDia / (fs.length - 1);
}

// Valores da nota mãe conforme o status (Hugo, 27/11/2026) — todas entram no Resumo:
//   autorizada: total = peso da NF; retirado = filhas autorizadas (sem o que elas
//               devolveram); devolvido = NFs de devolução da mãe; restante = o resto;
//   devolvida:  idem, mas tudo o que não foi retirado é devolvido (restante 0);
//   cancelada, inutilizada, indevida, recusada: tudo zero (a nota não vale).
function _acKpis(m, g) {
  const vale = m.status === 'autorizada' || m.status === 'finalizada' || m.status === 'devolvida';
  const fs = vale ? m.filhas.filter(f => f.ret > 0) : [];
  const retT = fs.reduce((t, f) => t + f.ret, 0);
  const totT = vale ? m.peso : 0;
  const custoUn = m.peso > 0 ? m.valor / m.peso : (Number(m.itens[0]?.valor_unit) || 0);
  const devT = !vale ? 0 : m.status === 'devolvida' ? Math.max(0, totT - retT) : m.devNF;
  // Sobra de arredondamento (aparece como "0,00 t") conta como zerado.
  const pendT = totT - retT - devT < AC_ZERO ? 0 : totT - retT - devT;
  const pesoMedio = g.pesoMedio || (fs.length ? retT / fs.length : 0);
  const nfsRest = pendT > 0 && pesoMedio > 0 ? Math.ceil(pendT / pesoMedio) : (pendT > 0 ? null : 0);
  const intervalo = _acIntervalo(fs) ?? g.intervalo;
  const diasRest = nfsRest === 0 ? 0 : (nfsRest != null && intervalo != null ? nfsRest * intervalo : null);
  const base = fs.length ? Math.max(fs[fs.length - 1].emissao, Date.now()) : Date.now();
  return {
    totT, totR: vale ? m.valor : 0, retT, retR: retT * custoUn, devT, devR: devT * custoUn, pendT, pendR: pendT * custoUn, custoUn,
    nRet: fs.length, nfsRest, pesoMedio, intervalo, diasRest,
    previsao: diasRest != null && diasRest > 0 ? base + diasRest * _acDia : null,
    excedido: retT - totT > 0.001 ? retT - totT : 0,
    pct: totT > 0 ? Math.min(1, retT / totT) : 0,
    pctDev: totT > 0 ? Math.min(1, devT / totT) : 0,
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
// Lista no padrão das Operações (mural-painel.js, Hugo 26/11/2026): Regional →
// Central → fornecedor em blocos que abrem; cada linha com ícone de situação,
// subtítulo, saldo restante à direita e um selo embaixo. Os números de cada linha
// são do recorte dela (o fornecedor dentro de uma central mostra só as notas dali).
const _acNoRecorte = (n, rec) => !rec || rec(n);
function _acSit(maes, sv) {
  const tot = maes.reduce((t, m) => t + m.totT, 0), pen = maes.reduce((t, m) => t + m.pendT, 0), penR = maes.reduce((t, m) => t + m.pendR, 0);
  const [ic, cor] = !maes.length && !sv ? ['ti-minus', 'var(--text3)'] : sv ? ['ti-link-off', 'var(--red)'] : pen > 0 ? ['ti-hourglass', 'var(--amber)'] : ['ti-circle-check', 'var(--green)'];
  const selo = sv ? [`${_acNf0.format(sv)} sem vínculo`, '#f43f5e'] : pen > 0 ? [`Restante ${_acNf0.format(tot ? pen / tot * 100 : 0)}%`, '#f59e0b'] : maes.length ? ['Zerado', '#10b981'] : null;
  return { pen, penR, ico: `<i class="ti ${ic} mp-ico" style="color:${cor}" aria-hidden="true"></i>`, selo: selo ? `<span class="mp-prio ac-selo" style="--c:${selo[1]}">${selo[0]}</span>` : '' };
}
function _acLinhaForn(f, recuo, rec) {
  const g = AC.porForn.get(f.cnpj);
  const maes = _acMaesDe(f.cnpj).filter(m => _acNoRecorte(m, rec)), sv = (g?.semVinc || []).filter(s => _acNoRecorte(s, rec)).length;
  const s = _acSit(maes, sv), sel = AC.sel === f.cnpj;
  const sub = maes.length ? `${_acNf0.format(maes.length)} nota${maes.length > 1 ? 's' : ''} mãe${maes.length > 1 ? 's' : ''} · ${_acCnpjFmt(f.cnpj)}` : _acCnpjFmt(f.cnpj);
  return `<button class="mp-row mp-item ${recuo}${sel ? ' sel' : AC.sel ? ' apagado' : ''}" onclick="acSel('${f.cnpj}')">
    ${s.ico}<span class="mp-nome"><b title="${_acE(f.nome)}">${_acE(f.nome)}</b><small>${sub}</small></span>
    <span class="mp-dir"><span class="mp-v">${s.pen > 0.001 ? _acT(s.pen) : '—'}</span>${s.selo}</span></button>`;
}
// Linha de grupo (regional, central ou material): mesmos números, somados.
function _acLinhaGrupo(nivel, k, fs, rec, aberta, sel, apagado, sub, onclick) {
  const maes = fs.flatMap(f => _acMaesDe(f.cnpj).filter(m => _acNoRecorte(m, rec)));
  const sv = fs.reduce((t, f) => t + (AC.porForn.get(f.cnpj)?.semVinc || []).filter(s => _acNoRecorte(s, rec)).length, 0);
  const s = _acSit(maes, sv);
  return `<button class="mp-row ${nivel}${sel ? ' sel' : apagado ? ' apagado' : ''}" onclick="${onclick}" data-k="${_acE(k)}">
    <i class="ti ti-chevron-${aberta ? 'down' : 'right'} mp-chev"></i>${s.ico}
    <span class="mp-nome"><b>${_acE(k)}</b><small>${sub}${sv ? ` · <span style="color:var(--red)">${_acNf0.format(sv)} sem vínculo</span>` : ''}</small></span>
    <span class="mp-v">${s.pen > 0.001 ? _acT(s.pen) : '—'}</span></button>`;
}
const _acQtdF = n => `${_acNf0.format(n)} fornecedor${n === 1 ? '' : 'es'}`;
function _acListaHtml() {
  const forns = _acFornDaAba();
  if (AC.listaRecolhida) {
    return `<section class="mp-lista recolhida"><button class="mp-lista-abrir" onclick="acLista()" title="Mostrar a lista" aria-expanded="false">
      <i class="ti ti-layout-sidebar-left-expand"></i><span>Fornecedores · ${forns.length}</span></button></section>`;
  }
  // Agrupa fornecedores por uma chave das notas (o fornecedor entra em cada grupo onde tem nota).
  const agrupa = (fs, chave, rec) => {
    const m = new Map();
    fs.forEach(f => new Set([..._acMaesDe(f.cnpj), ...(AC.porForn.get(f.cnpj)?.semVinc || [])].filter(n => _acNoRecorte(n, rec)).flatMap(chave))
      .forEach(k => (m.get(k) || m.set(k, []).get(k)).push(f)));
    const peso = (k, l) => _acSit(l.flatMap(f => _acMaesDe(f.cnpj).filter(x => _acNoRecorte(x, rec) && chave(x).includes(k))), 0).pen;
    return [...m.entries()].map(([k, l]) => [k, l.sort(_acOrdemForn), peso(k, l)]).sort((a, b) => b[2] - a[2] || a[0].localeCompare(b[0], 'pt-BR'));
  };
  const sem = forns.filter(f => !_acMaesDe(f.cnpj).length && !(AC.porForn.get(f.cnpj)?.semVinc.length));
  const com = forns.filter(f => !sem.includes(f));
  const G = AC.F.grupo, chave = _acGrupoDe[G];
  let linhas = '';
  if (G === 'fornecedor') linhas = forns.map(f => _acLinhaForn(f, 'mp-item-1')).join('');
  else {
    linhas = agrupa(com, chave).map(([k, fs]) => {
      const rec = n => chave(n).includes(k), aberta = AC.grp === k;
      const tem = !!AC.grp;
      if (G !== 'regional') {
        return `<div class="mp-bloco${aberta ? ' aberto' : ''}">${_acLinhaGrupo('mp-reg', k, fs, rec, aberta, aberta && !AC.sel, tem && !aberta, _acQtdF(fs.length), 'acGrp(this.dataset.k)')}`
          + (aberta ? fs.map(f => _acLinhaForn(f, 'mp-item-1', rec)).join('') : '') + '</div>';
      }
      // Regional → central → fornecedor (dois níveis, como Regional → Central → item nas Operações).
      const cens = agrupa(fs, n => [n.central || 'Sem central'], rec);
      let h = `<div class="mp-bloco${aberta ? ' aberto' : ''}">` + _acLinhaGrupo('mp-reg', k, fs, rec, aberta, aberta && !AC.sub && !AC.sel, tem && !aberta,
        `${_acNf0.format(cens.length)} centra${cens.length === 1 ? 'l' : 'is'} · ${_acQtdF(fs.length)}`, 'acGrp(this.dataset.k)');
      if (aberta) cens.forEach(([c, cfs]) => {
        const rc = n => rec(n) && (n.central || 'Sem central') === c, cab = AC.sub === c;
        h += `<div class="mp-sub${cab ? ' aberto' : ''}">` + _acLinhaGrupo('mp-cen', c, cfs, rc, cab, cab && !AC.sel, !!AC.sub && !cab, _acQtdF(cfs.length), 'acSub(this.dataset.k)')
          + (cab ? cfs.map(f => _acLinhaForn(f, '', rc)).join('') : '') + '</div>';
      });
      return h + '</div>';
    }).join('');
    if (sem.length) {
      const aberta = AC.grp === 'Sem nota mãe';
      linhas += `<div class="mp-bloco${aberta ? ' aberto' : ''}">${_acLinhaGrupo('mp-reg', 'Sem nota mãe', sem, null, aberta, aberta && !AC.sel, !!AC.grp && !aberta, `${_acQtdF(sem.length)} sem notas de entrega futura`, 'acGrp(this.dataset.k)')}`
        + (aberta ? sem.map(f => _acLinhaForn(f, 'mp-item-1')).join('') : '') + '</div>';
    }
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

// Os quatro números do Resumo (todas as notas mães; os valores de cada uma seguem o
// status, _acKpis). Retirado ACIMA de uma nota mãe não abate o saldo das outras:
// com excedido, retirado + devolvido + restante passa do total (dito no card).
function _acCardsSaldo(maes) {
  const s = k => maes.reduce((t, m) => t + m[k], 0);
  const tot = s('totT'), ret = s('retT'), dev = s('devT'), pen = s('pendT'), exc = s('excedido');
  const pct = v => tot > 0 ? _acNf1.format(v / tot * 100) + '% do peso total' : '';
  const card = (cls, ic, rot, t, r, sub) => `<div class="ac-kc ${cls}"><div class="ac-kc-rot"><i class="ti ${ic}"></i>${rot}</div><b>${_acT(t)}</b><span class="ac-kc-r">${_acR(r)}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
  return `<div class="ac-kcs">
    ${card('tot', 'ti-stack-2', 'Saldo total', tot, s('totR'), `${_acNf0.format(maes.length)} ${maes.length === 1 ? 'nota mãe' : 'notas mães'}`)}
    ${card('ret', 'ti-truck-delivery', 'Saldo retirado', ret, s('retR'), pct(Math.max(0, ret - exc)) + (exc > 0.001 ? ` · mais ${_acT(exc)} acima do saldo de alguma nota mãe` : ''))}
    ${card('dev', 'ti-arrow-back-up', 'Saldo devolvido', dev, s('devR'), pct(dev))}
    ${card('pen', 'ti-hourglass', 'Saldo restante', pen, s('pendR'), pct(pen))}</div>`;
}

function _acGraficos(maes) {
  AC.evoNotas = maes;
  const s = k => maes.reduce((t, m) => t + m[k], 0);
  const excR = maes.reduce((t, m) => t + m.excedido * m.custoUn, 0);
  const rosca = (tit, fmt, curto, total, ret, dev, pend, exc) => {
    const R = 82, E = 26, C = 2 * Math.PI * R, dentro = Math.max(0, ret - exc);
    const p = v => total > 0 ? v / total : 0, pct = v => total > 0 ? _acNf1.format(p(v) * 100) + '%' : '—';
    const fatias = [['Retirado', dentro, 'ret', ret], ['Devolvido', dev, 'dev', dev], ['Restante', pend, 'pen', pend]].filter(x => x[1] > 0 && total > 0);
    const gap = fatias.length > 1 ? 3 : 0;   // espaço na cor do fundo entre as fatias
    let pos = 0;
    const arcos = fatias.map(([r, v, cls, cheio]) => {
      const L = p(v) * C, d = `<circle class="ac-ro-f ${cls}" r="${R}" cx="110" cy="110" stroke-width="${E}" stroke-dasharray="${Math.max(0.5, L - gap).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-pos - gap / 2).toFixed(2)}" data-tip="${_acTipG(`${tit} · ${r}`, [['Valor', fmt(cheio)], ['Do saldo total', pct(v)]])}"/>`;
      pos += L;
      return d;
    }).join('');
    const leg = (r, cls, pc) => `<div class="ac-ro-l"><i class="${cls}"></i><span>${r}</span><b>${pc}</b></div>`;
    return `<div class="ac-ro"><div class="ac-gr-tit">${tit}</div><div class="ac-ro-corpo">
      <svg viewBox="0 0 220 220" role="img" aria-label="${_acE(`${tit}: saldo total ${fmt(total)}, retirado ${fmt(ret)}, devolvido ${fmt(dev)}, restante ${fmt(pend)}`)}">
        <circle class="ac-ro-fundo" r="${R}" cx="110" cy="110" stroke-width="${E}"/><g transform="rotate(-90 110 110)">${arcos}</g>
        <text x="110" y="103" class="ac-ro-rot">Saldo total</text><text x="110" y="126" class="ac-ro-tot">${curto(total)}</text></svg>
      <div class="ac-ro-leg">${leg('Retirado', 'ret', pct(dentro))}${leg('Devolvido', 'dev', pct(dev))}${leg('Restante', 'pen', pct(pend))}</div></div></div>`;
  };
  return `<div class="ac-gr-dois">${rosca('Físico', _acT, _acTc, s('totT'), s('retT'), s('devT'), s('pendT'), s('excedido'))}${rosca('Financeiro', _acR, _acRc, s('totR'), s('retR'), s('devR'), s('pendR'), excR)}</div>
    <div class="ac-ro ac-ev"><div class="ac-gr-tit">Evolução por mês
      <span class="ac-ev-leg"><span><i class="tot"></i>Saldo total</span><span><i class="ret"></i>Retirado</span><span><i class="dev"></i>Devolvido</span><span><i class="pen"></i>Restante</span></span>
      <span class="mp-modo" role="group" aria-label="Unidade da evolução">${[['t', 'Físico'], ['r', 'Financeiro']].map(([k, r]) => `<button data-evo="${k}" class="${AC.evo === k ? 'on' : ''}" aria-pressed="${AC.evo === k}" onclick="acEvo('${k}')">${r}</button>`).join('')}</span></div>
      <div id="ac-evo"></div></div>`;
}

// Saldo total, retirado, devolvido e restante ACUMULADOS no fim de cada mês; o
// último mês bate com as roscas. Nota mãe entra no mês da emissão; filha e NF de
// devolução, no mês delas. Mãe Devolvida: o que faltava devolver entra no mês da
// última nota. Nota que não vale (cancelada…) fica de fora (valores zero).
// ponytail: no máximo 36 meses na tela (o acumulado anterior entra no 1º).
function _acEvolucao(maes, modo) {
  const mes = ms => { const d = new Date(ms); return d.getFullYear() * 12 + d.getMonth(); };
  const vale = maes.filter(m => m.totT > 0);
  let ini = Infinity, fim = -Infinity;
  const ve = ms => { if (ms > 0) { const k = mes(ms); if (k < ini) ini = k; if (k > fim) fim = k; } };
  vale.forEach(m => { ve(m.emissao); m.filhas.forEach(f => { if (f.ret > 0) ve(f.emissao); }); m.devs.forEach(d => ve(d.emissao)); });
  if (ini > fim) return [];
  ini = Math.max(ini, fim - 35);
  const n = fim - ini + 1, idx = ms => Math.max(0, (ms > 0 ? mes(ms) : ini) - ini);
  const out = Array.from({ length: n }, (_, i) => ({ mes: ini + i, tot: 0, ret: 0, dev: 0, pen: 0 }));
  vale.forEach(m => {
    const u = modo === 'r' ? m.custoUn : 1, pr = new Float64Array(n), pd = new Float64Array(n);
    let ult = m.emissao;
    m.filhas.forEach(f => { if (f.ret > 0) { pr[idx(f.emissao)] += f.ret; ult = Math.max(ult, f.emissao); } });
    m.devs.forEach(d => { pd[idx(d.emissao)] += d.peso; ult = Math.max(ult, d.emissao); });
    if (m.devT > m.devNF) pd[idx(ult)] += m.devT - m.devNF;
    let ret = 0, dev = 0;
    for (let i = 0, e = idx(m.emissao); i < n; i++) {
      ret += pr[i]; dev = Math.min(m.devT, dev + pd[i]);
      out[i].ret += ret * u; out[i].dev += dev * u;
      if (i >= e) { out[i].tot += modo === 'r' ? m.totR : m.totT; out[i].pen += Math.max(0, m.totT - ret - dev) * u; }
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
  const max = Math.max(...pts.flatMap(p => [p.tot, p.ret, p.dev, p.pen])) || 1;
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
  const pontos = (p, i) => ['tot', 'ret', 'dev', 'pen'].map(k => `<circle class="${k}" cx="${x(i).toFixed(1)}" cy="${y(p[k]).toFixed(1)}" r="4.5"/>`).join('');
  const fim = pts[n - 1];
  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${_acE(`Evolução até ${nome(fim.mes)}: saldo total ${curto(fim.tot)}, retirado ${curto(fim.ret)}, devolvido ${curto(fim.dev)}, restante ${curto(fim.pen)}`)}">
    <g class="ac-ev-gr">${grade}${rotX}</g>${linha('tot')}${linha('ret')}${linha('dev')}${linha('pen')}
    <g class="ac-ev-fim">${pontos(fim, n - 1)}</g>
    ${pts.map((p, i) => `<g class="ac-ev-c" data-tip="${_acTipG(nome(p.mes) + ' · acumulado', [['Saldo total', fmt(p.tot)], ['Retirado', fmt(p.ret)], ['Devolvido', fmt(p.dev)], ['Restante', fmt(p.pen)]])}"><rect x="${(x(i) - larg / 2).toFixed(1)}" y="${P.t}" width="${larg.toFixed(1)}" height="${H - P.t - P.b}"/><line x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${P.t}" y2="${H - P.b}"/>${pontos(p, i)}</g>`).join('')}
  </svg>`;
}
function acEvo(k) {
  AC.evo = k;
  document.querySelectorAll('#ac-root [data-evo]').forEach(b => { b.classList.toggle('on', b.dataset.evo === k); b.setAttribute('aria-pressed', b.dataset.evo === k); });
  _acEvoDesenhar();
}
let _acEvoT = null;
window.addEventListener('resize', () => { clearTimeout(_acEvoT); _acEvoT = setTimeout(_acEvoDesenhar, 150); });

// Números secundários, em texto: notas por status e o ritmo das filhas.
function _acResumoTxt(maes, g) {
  const cont = new Map(), partes = [];
  maes.forEach(m => { if (m.status !== 'autorizada') cont.set(m.status, (cont.get(m.status) || 0) + 1); });
  cont.forEach((n, st) => partes.push(`${_acNf0.format(n)} ${AC_STATUS[st][0].toLowerCase()}${n === 1 ? '' : 's'}${st === 'devolvida' || st === 'finalizada' ? '' : ' (valores zero)'}`));
  if (g?.pesoMedio) partes.push(`filha de ${_acT(g.pesoMedio)} em média`);
  if (g?.intervalo > 0) partes.push(g.intervalo >= 1 ? `uma a cada ${_acNf1.format(g.intervalo)} dias` : `${_acNf1.format(1 / g.intervalo)} por dia`);
  return partes.join(' · ') || 'todas autorizadas';
}

function _acPainelHtml() {
  const f = AC.forn.get(AC.sel);
  if (f) return _acPainelForn(f);
  // Geral (ou o grupo aberto): resumo das notas mães dos fornecedores da aba.
  const forns = _acFornDaAba(true);
  const doGrupo = m => (!AC.grp || AC.F.grupo === 'fornecedor' || AC.grp === 'Sem nota mãe' || _acGrupoDe[AC.F.grupo](m).includes(AC.grp)) && (!AC.sub || (m.central || 'Sem central') === AC.sub);
  const maes = forns.flatMap(x => _acMaesDe(x.cnpj)).filter(doGrupo);
  const soma = k => maes.reduce((t, m) => t + m[k], 0);
  const sv = forns.reduce((t, x) => t + (AC.porForn.get(x.cnpj)?.semVinc.length || 0), 0);
  const rot = AC_ABAS.find(a => a[0] === AC.aba)[2];
  const mig = [AC.grp ? `<button class="mo-link" onclick="acGrp('')">Geral</button>` : '<span>Geral</span>'];
  if (AC.grp) mig.push(AC.sub ? `<button class="mo-link" onclick="acSub('')">${_acE(AC.grp)}</button>` : `<span>${AC_GRUPOS[AC.F.grupo]}</span>`);
  if (AC.sub) mig.push('<span>Central</span>');
  const top = forns.map(x => [x, AC.porForn.get(x.cnpj)]).filter(([, g]) => g?.pendT > 0).sort((a, b) => b[1].pendR - a[1].pendR).slice(0, 8);
  const maxR = top[0]?.[1].pendR || 1;
  const semV = forns.map(x => [x, AC.porForn.get(x.cnpj)?.semVinc.length || 0]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]).slice(0, 8);
  return _acCab(mig, _acE(AC.sub || AC.grp || 'Acordos · ' + rot), `${forns.length} fornecedor${forns.length === 1 ? '' : 'es'} nesta aba · ${AC.maes.length} notas mães, ${AC.filhas.length} filhas e ${AC.devs.length} devoluções no SEFAZ importado`, soma('pendT'), soma('pendR'))
    + (AC.cfop.size ? '' : '<div class="mp-card"><p class="mo-hint">Nenhum CFOP marcado como nota mãe/filha (Configurações → CFOP → Acordo).</p></div>')
    + `<div class="mp-card"><h4 class="mp-tit">Resumo <span class="mo-hint">${_acResumoTxt(maes)}</span></h4>${_acCardsSaldo(maes)}${_acGraficos(maes)}</div>
    <div class="mp-dois">
      <div class="mp-card"><h4 class="mp-tit">O que mais pesa <span class="mo-hint">saldo restante em R$</span></h4>${top.length ? top.map(([x, g]) => `<button class="mp-rank" style="grid-template-columns:minmax(0,1fr) 90px 150px" onclick="acSel('${x.cnpj}')">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_acE(x.nome)}</span><span class="mp-rank-bar"><i style="width:${g.pendR / maxR * 100}%;background:var(--amber)"></i></span><span class="mono" style="text-align:right">${_acR(g.pendR)}<small class="mo-hint" style="display:block">${_acT(g.pendT)}</small></span></button>`).join('') : '<p class="mo-hint">Nenhum saldo restante.</p>'}</div>
      <div class="mp-card"><h4 class="mp-tit">Filhas sem vínculo <span class="mo-hint">${sv ? _acNf0.format(sv) + ' no total' : ''}</span></h4>${semV.length ? semV.map(([x, n]) => `<button class="mp-lin" onclick="acSel('${x.cnpj}')"><i class="ti ti-link-off" style="color:var(--red)"></i><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_acE(x.nome)}</span><b class="mono">${n}</b></button>`).join('') : '<p class="mo-hint">Todas as filhas estão vinculadas.</p>'}</div>
    </div>`;
}

function _acPainelForn(f) {
  const g = AC.porForn.get(f.cnpj) || { maes: [], semVinc: [], filhas: [], devs: [], devSemVinc: [] };
  const maes = g.maes.filter(_acPassaMae);
  const soma = k => maes.reduce((t, m) => t + m[k], 0);
  const nSv = g.semVinc.length + g.devSemVinc.length;
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
    corpo = `<div class="mp-card"><h4 class="mp-tit">Resumo <span class="mo-hint">${_acResumoTxt(maes, g)}</span></h4>${_acCardsSaldo(maes)}${_acGraficos(maes)}</div>
      <div class="mp-subabas ac-subabas" role="tablist">${[['maes', 'ti-file-dollar', 'Notas mães', maes.length, ''], ['semvinc', 'ti-link-off', 'Sem vínculo', nSv, nSv ? 'var(--red)' : '']].map(([k, ic, rot, n, cor]) =>
        `<button class="mo-aba${AC.paba === k ? ' on' : ''}" role="tab" aria-selected="${AC.paba === k}" onclick="acPaba('${k}')"><i class="ti ${ic}"${cor ? ` style="color:${cor}"` : ''}></i>${rot} <b${cor ? ` style="color:${cor}"` : ''}>${n}</b></button>`).join('')}</div>
      <div class="ac-maes">${AC.paba === 'semvinc' ? _acAlertaSemVinc(f, g) : _acCardsMaes(maes)}</div>`;
  }
  return _acCab(mig, _acE(f.nome), _acCnpjFmt(f.cnpj), ehMae ? soma('pendT') : 0, ehMae ? soma('pendR') : 0) + mod + _acFicha(f, g) + corpo;
}

/* ───────── ficha do fornecedor (Hugo, 26/11/2026) ───────── */
// Só leitura. Endereço do CNPJ: o cadastro da aba Custos (custos_geo); faltando,
// busca na BrasilAPI pela mesma rotina dela (_cuGeoUm, custos.js) e grava lá.
// O resto vem de TODAS as notas do fornecedor no SEFAZ importado (sem os filtros
// da tela): quantidade, período, centrais, materiais e transportadoras.
const AC_FI_TOP = 5;
function _acFicha(f, g) {
  const nfs = [...g.maes, ...g.filhas, ...g.semVinc];
  const conta = (lista, chave) => { const c = new Map(); lista.forEach(x => { const k = chave(x); if (k) c.set(k, (c.get(k) || 0) + 1); }); return [...c.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'pt-BR')); };
  const lista = (ic, tit, pares, vazio) => {
    const max = pares[0]?.[1] || 1, resto = pares.slice(AC_FI_TOP);
    return `<div class="ac-fi-l"><div class="ac-fi-lt"><i class="ti ${ic}"></i>${tit}<b>${_acNf0.format(pares.length)}</b></div>${pares.length
      ? pares.slice(0, AC_FI_TOP).map(([k, n]) => `<div class="ac-fi-li" title="${_acE(k)} · ${_acNf0.format(n)} nota${n === 1 ? '' : 's'}"><span>${_acE(k)}</span><b>${_acNf0.format(n)}</b><i style="width:${(n / max * 100).toFixed(1)}%"></i></div>`).join('')
        + (resto.length ? `<div class="ac-fi-resto" title="${_acE(resto.map(([k, n]) => `${k} (${n})`).join(', '))}">+ ${resto.length} outra${resto.length === 1 ? '' : 's'}</div>` : '')
      : `<p class="mo-hint">${vazio}</p>`}</div>`;
  };
  const datas = nfs.map(n => n.emissao).filter(Boolean);
  const nFilhas = g.filhas.length + g.semVinc.length;
  const geo = AC.geo.get(f.cnpj);
  if (geo === undefined || (geo === null && Date.now() - (AC.geoErro.get(f.cnpj) || Infinity) > 60000)) { AC.geo.delete(f.cnpj); _acGeoBuscar(f.cnpj, f.nome); }
  const temEnd = geo && (geo.logradouro || geo.municipio);
  const mun = conta(nfs, n => n.municipio ? n.municipio + (n.uf ? ' – ' + n.uf : '') : '')[0]?.[0];
  const cep = c => String(c).replace(/^(\d{5})(\d{3})$/, '$1‑$2');
  const end = temEnd
    ? `<b>${_acE([geo.logradouro, geo.numero].filter(Boolean).join(', ') || [geo.municipio, geo.uf].filter(Boolean).join(' – '))}</b>
       <small>${_acE([geo.bairro, geo.logradouro ? [geo.municipio, geo.uf].filter(Boolean).join(' – ') : '', geo.cep ? 'CEP ' + cep(geo.cep) : ''].filter(Boolean).join(' · '))}</small>`
    : `<b>${_acE(mun || 'Endereço não encontrado')}</b><small>${geo === undefined ? '<i class="ti ti-loader-2 ac-gira"></i> buscando o endereço do CNPJ…'
        : AC.geoErro.has(f.cnpj) ? 'a consulta do CNPJ não respondeu agora — tenta de novo ao reabrir o fornecedor'
        : mun ? 'município das notas no SEFAZ — o CNPJ não tem endereço na Receita' : 'o CNPJ não tem endereço na Receita'}</small>`;
  return `<div class="mp-card" id="ac-ficha"><h4 class="mp-tit">Ficha do fornecedor <span class="mo-hint">todas as notas no SEFAZ importado</span></h4>
    <div class="ac-fi-topo">
      <div class="ac-fi-end"><i class="ti ti-map-pin"></i><div>${end}</div></div>
      <div class="ac-fi-n"><b>${_acNf0.format(g.maes.length)}</b><span>nota${g.maes.length === 1 ? '' : 's'} mãe${g.maes.length === 1 ? '' : 's'}</span></div>
      <div class="ac-fi-n"><b>${_acNf0.format(nFilhas)}</b><span>nota${nFilhas === 1 ? '' : 's'} filha${nFilhas === 1 ? '' : 's'}${g.semVinc.length ? ` · <em>${_acNf0.format(g.semVinc.length)} sem vínculo</em>` : ''}</span></div>
      <div class="ac-fi-n"><b>${datas.length ? `${_acData(Math.min(...datas))} <span class="ac-fi-seta">→</span> ${_acData(Math.max(...datas))}` : '—'}</b><span>primeira e última nota</span></div>
    </div>
    <div class="ac-fi-listas">
      ${lista('ti-building-factory-2', 'Centrais atendidas', conta(nfs, n => n.central), 'nenhuma central nas Entradas')}
      ${lista('ti-box', 'Materiais', conta(nfs.flatMap(n => n.materiais.map(m => ({ m }))), x => x.m), 'sem material nas notas')}
      ${lista('ti-truck', 'Transportadoras', conta(nfs, n => n.transp), 'não informada no SEFAZ')}
    </div></div>`;
}
// Endereço do CNPJ em AC.geo (undefined = buscando; null = sem endereço).
async function _acGeoBuscar(cnpj, nome) {
  if (AC.geoBuscando.has(cnpj)) return;
  AC.geoBuscando.add(cnpj);
  let g = null;
  try {
    const { data } = await window.supabaseClient.from('custos_geo').select('logradouro, numero, bairro, cep, municipio, uf, precisao, atualizado_em').eq('cnpj', cnpj).maybeSingle();
    g = data || null;
    // Sem cadastro (ou "não achou" de mais de 30 dias): consulta a Receita pela rotina da aba Custos.
    const velho = g && !g.logradouro && !g.municipio && Date.now() - Date.parse(g.atualizado_em) > 30 * 864e5;
    if ((!g || velho) && typeof _cuGeoUm === 'function') {
      const row = await _cuGeoUm({ cnpj, tipo: 'fornecedor', nome });
      if (!row) AC.geoErro.set(cnpj, Date.now());   // BrasilAPI fora/limitando: não grava nada
      else {
        AC.geoErro.delete(cnpj);
        g = row;
        const { error } = await window.supabaseClient.from('custos_geo').upsert(row, { onConflict: 'cnpj' });
        if (error) console.warn('[Acordos] custos_geo:', error.message);
        if (typeof CU !== 'undefined' && CU.geo) CU.geo.set(cnpj, row);   // a aba Custos já aberta vê o endereço novo
      }
    }
  } catch (e) { console.warn('[Acordos] endereço do CNPJ:', e); AC.geoErro.set(cnpj, Date.now()); }
  AC.geoBuscando.delete(cnpj);
  AC.geo.set(cnpj, g);
  const el = document.getElementById('ac-ficha');
  if (el && AC.sel === cnpj) { const g2 = AC.porForn.get(cnpj), f = AC.forn.get(cnpj); if (g2 && f) el.outerHTML = _acFicha(f, g2); }
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
// Status da nota (mãe ou filha): Cancelada vem do SEFAZ e trava; os outros são
// escolhidos à mão. Devolvida automática (pelas NFs de devolução) é dita no título.
function _acStHtml(n, quem) {
  const st = AC_STATUS[n.status];
  if (n.status === 'cancelada') return `<span class="badge ${st[1]}" title="Cancelada no SEFAZ">${st[0]}</span>`;
  const tit = `Status da nota ${quem}${!n.auto ? '' : n.status === 'finalizada' ? ' — Finalizada automaticamente (retirada até o fim)' : ' — Devolvida automaticamente pelas NFs de devolução'}`;
  const ops = AC_STATUS_MANUAIS.includes(n.status) ? AC_STATUS_MANUAIS : [n.status, ...AC_STATUS_MANUAIS];
  return `<select class="form-select ac-st ${st[1]}" onclick="event.stopPropagation()" onchange="acStatus('${n.chave}', this.value)" title="${tit}">${ops.map(k => `<option value="${k}"${n.status === k ? ' selected' : ''}>${AC_STATUS[k][0]}${n.auto && k === n.status ? ' (auto)' : ''}</option>`).join('')}</select>`;
}
const _acVincHtml = (n, ph, lista) => `<div class="ac-vinc"><input class="form-input" id="ac-v-${n.chave}" placeholder="${ph}" list="${lista}" onkeydown="if(event.key==='Enter')acVincular('${n.chave}')"><button class="btn btn-sm" onclick="acVincular('${n.chave}')" title="Vincular"><i class="ti ti-link"></i></button></div>`;
const _acMatTd = n => `<td class="ac-comp ac-comp-mat" title="${_acE(n.materiais.join(', '))}">${_acE(n.materiais.join(', ') || '—')}</td>`;

// Subaba "Sem vínculo": filhas cujo complementar não cita a nota mãe e devoluções que
// não citam a mãe/filha devolvida — vincular à mão.
function _acAlertaSemVinc(f, g) {
  if (!g.semVinc.length && !g.devSemVinc.length) return '<div class="mp-card"><p class="mo-hint"><i class="ti ti-circle-check" style="color:var(--green)"></i> Todas as notas filhas e devoluções deste fornecedor estão vinculadas.</p></div>';
  const rec = _acRec(g), lote = g.semVinc.filter(s => _acNoLote(rec.get(s.chave)));
  const avisos = g.semVinc.filter(s => rec.get(s.chave)?.excede).length;
  const filhas = !g.semVinc.length ? '' : `<div class="mp-card ac-semvinc">
    <h4 class="mp-tit">${g.semVinc.length} nota${g.semVinc.length > 1 ? 's' : ''} filha${g.semVinc.length > 1 ? 's' : ''} sem vínculo <span class="mo-hint">${_acT(g.semVinc.reduce((t, s) => t + s.peso, 0))} · o complementar não cita a nota mãe</span></h4>
    ${lote.length ? `<div class="ac-rec-lote"><button class="btn btn-sm btn-primary" onclick="acVincularRecs('${f.cnpj}')"><i class="ti ti-link"></i> Vincular ${lote.length} recomendada${lote.length > 1 ? 's' : ''}</button><span class="mo-hint">a nota mãe mais antiga com saldo, da mesma central e material${avisos ? ` · ${avisos} com aviso de saldo fica${avisos > 1 ? 'm' : ''} fora do lote` : ''}</span></div>` : ''}
    <div class="micro-table-wrap"><table class="ac-tab"><thead><tr><th>Número</th><th>Status</th><th>Emissão</th><th>Central</th><th>Material</th><th class="num">Peso</th><th>Complementar</th><th>Recomendada</th><th>Vincular à nota mãe</th></tr></thead><tbody>
    ${g.semVinc.map(s => `<tr${s.status === 'autorizada' ? '' : ' class="inativa"'}>
      <td class="mono">${_acE(s.numero)}</td><td>${_acStHtml(s, 'filha')}</td><td>${_acData(s.emissao)}</td><td>${_acE(s.central || '—')}</td>${_acMatTd(s)}<td class="num mono">${_acT(s.peso)}${s.devNF ? `<small class="mo-hint" style="display:block">${_acT(s.devNF)} devolvido</small>` : ''}</td>
      <td class="ac-comp" title="${_acE(s.comp)}">${_acE(s.comp || '—')}</td>
      <td>${_acRecHtml(s, rec.get(s.chave))}</td>
      <td>${_acVincHtml(s, 'Nº ou chave da mãe', `ac-dl-${f.cnpj}-${_acDlId(s.central)}`)}</td>
    </tr>`).join('')}
    </tbody></table></div></div>`;
  const devs = !g.devSemVinc.length ? '' : `<div class="mp-card ac-semvinc">
    <h4 class="mp-tit">${g.devSemVinc.length} devoluç${g.devSemVinc.length > 1 ? 'ões' : 'ão'} sem vínculo <span class="mo-hint">${_acT(g.devSemVinc.reduce((t, s) => t + s.peso, 0))} · o complementar não cita uma nota mãe ou filha deste fornecedor (pode ser de compra comum)</span></h4>
    <div class="micro-table-wrap"><table class="ac-tab"><thead><tr><th>Devolução</th><th>Emissão</th><th>Emitente</th><th>Material</th><th class="num">Peso</th><th>Complementar</th><th>Vincular à nota mãe ou filha</th></tr></thead><tbody>
    ${g.devSemVinc.map(d => `<tr>
      <td class="mono">${_acE(d.numero)}</td><td>${_acData(d.emissao)}</td><td>${d.cnpj === d.forn ? 'Fornecedor' : 'Concrelagos'}</td>${_acMatTd(d)}<td class="num mono">${_acT(d.peso)}</td>
      <td class="ac-comp" title="${_acE(d.comp)}">${_acE(d.comp || '—')}</td>
      <td>${d.vinculo === 'manual' ? `<span class="mo-hint ac-rec-nao">vinculada à NF ${_acE(d.alvoNumero)}, que não está no SEFAZ importado</span>` : _acVincHtml(d, 'Nº ou chave da mãe/filha', `ac-dl-${f.cnpj}-${_acDlId('')}`)}</td>
    </tr>`).join('')}
    </tbody></table></div></div>`;
  return `${filhas}${devs}
    ${[...new Set([...g.semVinc.map(s => s.central), ...(g.devSemVinc.length ? [''] : [])])].map(c => {
      // Sugestões só com as mães da central da filha (Hugo, 23/11/2026); filha
      // sem central (ou central sem mãe conhecida) vê todas as do fornecedor.
      const daCen = c ? g.maes.filter(m => m.central === c) : [];
      return `<datalist id="ac-dl-${f.cnpj}-${_acDlId(c)}">${(daCen.length ? daCen : g.maes).map(m => `<option value="${_acE(m.numero)}">${_acE(m.numero)} · ${_acE(m.central || 'sem central')} · ${_acData(m.emissao)} · ${m.status === 'autorizada' ? 'saldo ' + _acT(m.pendT) : AC_STATUS[m.status][0].toLowerCase()} · ${_acE(m.materiais.join(', ') || 'sem material')}</option>`).join('')}</datalist>`;
    }).join('')}
  `;
}

function _acCardsMaes(maes) {
  if (!maes.length) return `<div class="mp-card"><p class="mo-hint">Nenhuma nota mãe deste fornecedor no SEFAZ importado${_acTemFiltro() ? ' para o filtro' : ''}.</p></div>`;
  return `<div class="micro-section-title" style="margin:6px 2px 0"><i class="ti ti-file-dollar"></i> Notas mães (${maes.length})</div>` + maes.map(m => {
    const ab = AC.abertas.has(m.chave);
    return `<div class="micro-filial-card ac-mcard${_acTom(m)}" data-ac="${m.chave}">
      <div class="micro-filial-header-wrap${ab ? ' open' : ''}">
        <div class="micro-filial-header" onclick="acToggle(this.closest('.micro-filial-header-wrap'))">
          <div class="micro-filial-name"><i class="ti ti-file-dollar"></i> NF ${_acE(m.numero)}<span class="ac-mcard-sub">${_acE(m.central || 'sem central')} · ${_acData(m.emissao)}</span></div>
          <div class="micro-filial-summary">${_acStHtml(m, 'mãe')}
            ${_acPill('Restante: ' + _acT(m.pendT), m.pendT > 0 ? 'var(--amber)' : 'var(--text3)', 'ti-hourglass')}
            ${_acPill('Retirado ' + _acNf0.format(m.pct * 100) + '%', 'var(--teal)', 'ti-truck-delivery')}
            ${m.devT > 0.001 ? _acPill('Devolvido ' + _acT(m.devT), 'var(--gs-dev)', 'ti-arrow-back-up') : ''}
            ${m.excedido ? _acPill('Excedido ' + _acT(m.excedido), 'var(--red)', 'ti-alert-triangle') : ''}
            <span class="summary-sep"></span>
            <span class="ac-mcard-mat" title="${_acE(m.materiais.join(', '))}">${_acE(m.materiais.join(', ') || '—')}</span>
            <span class="ac-minibar" title="${_acNf0.format(m.pct * 100)}% retirado${m.devT > 0.001 ? ` · ${_acNf0.format(m.pctDev * 100)}% devolvido` : ''}"><i style="width:${m.pct * 100}%"></i><i class="dev" style="width:${m.pctDev * 100}%"></i></span>
          </div>
        </div>
        <div class="micro-filial-actions">${_acChev(ab)}</div>
      </div>
      <div class="micro-filial-body${ab ? ' open' : ''}">${ab ? _acRelatorio(m) : ''}</div>
    </div>`;
  }).join('');
}

// Cor do card pelo status (Hugo, 27/11/2026): Finalizada verde, Devolvida laranja,
// as que zeram a nota (Cancelada, Inutilizada, Indevida, Recusada) vermelho.
const _acTom = m => m.status === 'autorizada' ? '' : m.status === 'finalizada' ? ' ac-tom-fin' : m.status === 'devolvida' ? ' ac-tom-dev' : ' ac-tom-zero';
const AC_VINC = { manual: ['Manual', 'badge-purple'], chave: ['Pela chave', 'badge-teal'], numero: ['Pelo número', 'badge-teal'] };
const _acVincTd = n => `<td><span class="badge ${AC_VINC[n.vinculo][1]}">${AC_VINC[n.vinculo][0]}</span></td>
      <td class="mono ac-chave" title="${n.chave}">${n.chave}</td>
      <td>${n.vinculo === 'manual' ? `<button class="btn-icon danger" title="Desfazer vínculo manual" onclick="event.stopPropagation();acDesvincular('${n.chave}')"><i class="ti ti-link-off"></i></button>` : ''}</td>`;

// Relatório da nota mãe (corpo do card): KPIs, barra, curva do saldo, dados da nota,
// filhas e devoluções.
function _acRelatorio(m) {
  const tempo = m.diasRest == null ? '—' : m.diasRest === 0 ? 'Zerado' : `${_acNf0.format(Math.ceil(m.diasRest))} dias`;
  const tempoSub = m.previsao ? `até acabar · previsão ${_acData(m.previsao)}` : m.diasRest === 0 ? 'saldo zerado' : 'até acabar · sem ritmo de retiradas';
  // Saldo depois de cada nota, na ordem das datas: filha (o retirado) e devolução da mãe.
  const depois = new Map();
  let s = m.totT;
  _acEventos(m).forEach(([, p, n]) => { s -= p; depois.set(n.chave, s); });
  const sd = n => depois.has(n.chave) ? _acT(depois.get(n.chave)) : '—';
  const filhas = m.filhas.map(f => `<tr${f.ret > 0 ? '' : ' class="inativa"'}>
      <td class="mono">${_acE(f.numero)}</td><td>${_acStHtml(f, 'filha')}</td><td>${_acData(f.emissao)}</td><td>${_acE(f.central || '—')}</td>
      <td class="num mono">${_acT(f.peso)}</td><td class="num mono">${f.devNF ? _acT(f.devNF) : '—'}</td><td class="num mono">${sd(f)}</td>
      ${_acVincTd(f)}
    </tr>`).join('');
  const devs = [...m.devs, ...m.filhas.flatMap(f => f.devs)].sort((a, b) => a.emissao - b.emissao);
  const devRows = devs.map(d => `<tr>
      <td class="mono">${_acE(d.numero)}</td><td>${_acData(d.emissao)}</td><td>${d.cnpj === d.forn ? 'Fornecedor' : 'Concrelagos'}</td>
      <td>${d.alvo === m ? 'Nota mãe' : `Filha ${_acE(d.alvo.numero)}`}</td>
      <td class="num mono">${_acT(d.peso)}</td><td class="num mono">${d.alvo === m ? sd(d) : '—'}</td>
      ${_acVincTd(d)}
    </tr>`).join('');
  return `<div class="micro-body-section">
      <div class="micro-section-title"><i class="ti ti-report-analytics"></i> Saldo da nota mãe</div>
      <div class="mp-pend ac-pend6">
        ${_acCx(_acT(m.retT), 'retirado · ' + _acR(m.retR), 'var(--teal)')}
        ${_acCx(_acT(m.devT), 'devolvido · ' + _acR(m.devR), 'var(--gs-dev)')}
        ${_acCx(_acT(m.pendT), 'restante · ' + _acR(m.pendR), 'var(--amber)')}
        ${_acCx(_acNf0.format(m.nRet), `NFs retiradas de ${_acT(m.totT)}`)}
        ${_acCx(m.nfsRest == null ? '—' : _acNf0.format(m.nfsRest), 'NFs até acabar (peso médio)')}
        ${_acCx(tempo, tempoSub, 'var(--purple)')}
        ${_acCx(m.pesoMedio ? _acT(m.pesoMedio) : '—', 'peso médio das filhas do fornecedor')}
      </div>
      ${m.totT > 0 ? '' : `<p class="mo-hint"><i class="ti ti-info-circle"></i> Nota ${_acE(AC_STATUS[m.status][0].toLowerCase())}: não entra nos valores${m.filhas.length ? ` — mas tem ${m.filhas.length} filha${m.filhas.length > 1 ? 's' : ''} vinculada${m.filhas.length > 1 ? 's' : ''}` : ''}.</p>`}
      <div class="ac-prog"><div class="ac-prog-bar"><i style="width:${m.pct * 100}%"></i><i class="dev" style="width:${m.pctDev * 100}%"></i></div>
        <div class="ac-prog-leg"><span><b class="ac-dot teal"></b>Retirado ${_acNf0.format(m.pct * 100)}%</span>${m.devT > 0.001 ? `<span><b class="ac-dot dev"></b>Devolvido ${_acNf0.format(m.pctDev * 100)}%</span>` : ''}<span><b class="ac-dot amber"></b>Restante ${_acNf0.format(m.totT > 0 ? m.pendT / m.totT * 100 : 0)}%</span>
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
    ${m.filhas.length ? `<div class="micro-table-wrap"><table class="ac-tab"><thead><tr><th>Nota filha</th><th>Status</th><th>Emissão</th><th>Central</th><th class="num">Peso</th><th class="num">Devolvido</th><th class="num">Saldo depois</th><th>Vínculo</th><th>Chave de acesso</th><th></th></tr></thead><tbody>${filhas}</tbody></table></div>` : ''}
    ${devs.length ? `<div class="micro-body-section"><div class="micro-section-title"><i class="ti ti-arrow-back-up"></i> Devoluções (${devs.length})</div></div>
    <div class="micro-table-wrap"><table class="ac-tab"><thead><tr><th>Devolução</th><th>Emissão</th><th>Emitente</th><th>Devolve</th><th class="num">Peso</th><th class="num">Saldo depois</th><th>Vínculo</th><th>Chave de acesso</th><th></th></tr></thead><tbody>${devRows}</tbody></table></div>` : ''}`;
}

// Abatimentos do saldo da mãe na ordem das datas: [data, peso, nota] — o retirado de
// cada filha e cada devolução da mãe; na Devolvida, o que faltava devolver no fim.
function _acEventos(m) {
  if (!(m.totT > 0)) return [];
  const ev = [...m.filhas.filter(f => f.ret > 0).map(f => [f.emissao, f.ret, f]), ...m.devs.map(d => [d.emissao, d.peso, d])].sort((a, b) => a[0] - b[0]);
  if (m.devT - m.devNF > 0.001) ev.push([ev.length ? ev[ev.length - 1][0] : m.emissao, m.devT - m.devNF, m]);
  return ev;
}

// Curva do saldo restante (degrau a cada filha e devolução) + projeção tracejada até zerar.
function _acCurva(m) {
  const ev = _acEventos(m);
  if (!ev.length) return '';
  const W = 640, H = 150, P = { l: 52, r: 12, t: 12, b: 22 };
  const t0 = Math.min(m.emissao || ev[0][0], ev[0][0]);
  const tFim = Math.max(m.previsao || 0, ev[ev.length - 1][0], t0 + _acDia);
  const yMax = Math.max(m.totT, m.retT);
  const x = t => P.l + (t - t0) / (tFim - t0) * (W - P.l - P.r);
  const y = v => P.t + (1 - Math.max(0, v) / yMax) * (H - P.t - P.b);
  let s = m.totT, d = `M${x(t0)},${y(s)}`;
  ev.forEach(([t, p]) => { d += ` H${x(t)}`; s -= p; d += ` V${y(s)}`; });
  const ult = ev[ev.length - 1][0];
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
function acGrp(k) { AC.grp = AC.grp === k ? '' : k; AC.sub = ''; AC.sel = ''; _acDesenhar(); }
function acSub(k) { AC.sub = AC.sub === k ? '' : k; AC.sel = ''; _acDesenhar(); }
function acGrupo(g) { AC.F.grupo = g; AC.grp = ''; AC.sub = ''; _acDesenhar(); }
function acAba(k) { AC.aba = k; AC.sel = ''; AC.grp = ''; AC.sub = ''; _acDesenhar(); }
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

// Vínculo manual: filha → mãe, ou devolução → mãe/filha (a mesma tabela
// acordo_vinculos: chave_filha = a nota que aponta, chave_mae = a apontada).
async function acVincular(chave) {
  const inp = document.getElementById('ac-v-' + chave);
  const v = String(inp?.value || '').replace(/\D/g, '');
  const filha = AC.filhas.find(f => f.chave === chave), dev = !filha && AC.devs.find(d => d.chave === chave);
  const n = filha || dev, oQue = filha ? 'nota mãe' : 'nota mãe ou filha';
  if (!v || !n) { toast(`Informe o número ou a chave de acesso da ${oQue}.`, 'error'); return; }
  const porChave = filha ? AC.maePorChave : AC.notaPorChave, porNum = filha ? AC.maePorNum : AC.notaPorNum;
  let alvo = null;
  if (v.length === 44) {
    alvo = porChave.get(v);
    if (!alvo) { toast(`Essa chave não é de uma ${oQue} do SEFAZ importado.`, 'error'); return; }
  } else {
    const cands = [...new Set((filha ? [filha.cnpj] : [dev.cnpj, dev.cnpjDest].filter(Boolean)).flatMap(c => porNum.get(c + '|' + _acNum(v)) || []))];
    if (cands.length > 1) { toast(`Há mais de uma ${oQue} com esse número — informe a chave de acesso.`, 'error'); return; }
    alvo = cands[0];
    if (!alvo) { toast(`Nenhuma ${oQue} nº ${_acNum(v)} deste fornecedor no SEFAZ importado.`, 'error'); return; }
  }
  const forn = filha ? filha.cnpj : dev.forn;
  if (alvo.cnpj !== forn && !confirm(`A nota ${alvo.numero} é de outro fornecedor (${alvo.nome}). Vincular mesmo assim?`)) return;
  const { error } = await window.supabaseClient.from('acordo_vinculos')
    .upsert({ chave_filha: chave, chave_mae: alvo.chave, numero_mae: alvo.numero, ..._acQuem() });
  if (error) { toast('Falha ao vincular: ' + error.message, 'error'); return; }
  AC.vinc.set(chave, { chave_mae: alvo.chave, numero_mae: alvo.numero });
  toast(`${filha ? 'Nota filha' : 'Devolução'} ${n.numero} vinculada à nota ${alvo.tipo === 'mae' ? 'mãe' : 'filha'} ${alvo.numero}.`, 'success');
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
  if (!confirm('Desfazer o vínculo manual desta nota? Ela volta para "Sem vínculo" se o complementar não citar a nota.')) return;
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

Object.assign(window, { acordosRender, acSel, acGrp, acSub, acGrupo, acAba, acPaba, acBusca, acLista, acRecarregar, acFAbrir, acFMarcar, acFBuscar, acFFechar, acFAplicar, acFLimpar, acFLimparTodos, acToggle, acModalidade, acStatus, acVincular, acVincularRecs, acEvo, acCopiar, acDesvincular });
// Lista recolhida: lembrada neste navegador.
try { AC.listaRecolhida = localStorage.getItem('acordos.listaRecolhida') === '1'; } catch (_) { /* sem storage */ }
