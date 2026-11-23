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
  sel: '', aberta: '',
  F: { q: '', reg: '', cen: '', mat: '', grupo: 'fornecedor' },
};

/* ───────── formatação ───────── */
const _acE = s => escapeHtml(String(s ?? ''));
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
  const porCh = new Map(), porNf = new Map();
  for (let i = 0; i < ents.length; i++) {
    const r = ents[i];
    const cen = r.centralDestino || r.centralCompra;
    if (!cen) continue;
    if (r.chave && ch.has(r.chave)) { porCh.set(r.chave, cen); continue; }
    if (r.cnpjFornecedor) { const k = r.cnpjFornecedor + '|' + _acNum(r.nf); if (nfk.has(k)) porNf.set(k, cen); }
  }
  AC.cenIdx = { porCh, porNf };
  AC.cenIdxRef = ents; AC.cenIdxLen = ents.length;
  return AC.cenIdx;
}

/* ───────── vínculo filha → mãe ───────── */
// Chaves (44 dígitos, aceitando espaços/pontos no meio) e números (3+ dígitos)
// citados nas informações complementares.
// ponytail: número casa com QUALQUER mãe do mesmo fornecedor com esse número;
// número ambíguo (2 mães, séries diferentes) fica sem vínculo. Filha que cita
// 2 mães vai para a primeira. Teto: vínculo manual.
function _acCitacoes(txt) {
  const s = String(txt || '').replace(/(\d)[\s.\-/](?=\d)/g, '$1');
  const chaves = s.match(/\d{44}/g) || [];
  const resto = s.replace(/\d{44}/g, ' ');
  const nums = (resto.match(/\d{3,9}/g) || []).map(_acNum);
  return { chaves, nums };
}

function _acMontar() {
  const idx = _acCentrais();
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
      const { chaves, nums } = _acCitacoes(f.comp);
      const porCh = chaves.map(c => maePorChave.get(c)).find(Boolean);
      if (porCh) { f.mae = porCh; f.vinculo = 'chave'; }
      else {
        const cands = new Set();
        nums.forEach(n => (maePorNum.get(f.cnpj + '|' + n) || []).forEach(m => cands.add(m)));
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

/* ───────── filtros ───────── */
const _acPassaMae = m => (!AC.F.reg || m.regional === AC.F.reg) && (!AC.F.cen || m.central === AC.F.cen) && (!AC.F.mat || m.materiais.includes(AC.F.mat));
const _acTemFiltro = () => !!(AC.F.reg || AC.F.cen || AC.F.mat);

function _acFornVisiveis() {
  const q = normalizeText(AC.F.q).toLowerCase();
  return [...AC.forn.values()].filter(f => {
    if (q && !normalizeText(f.nome + ' ' + f.cnpj + ' ' + _acCnpjFmt(f.cnpj)).toLowerCase().includes(q)) return false;
    if (_acTemFiltro()) return (AC.porForn.get(f.cnpj)?.maes || []).some(_acPassaMae);
    return true;
  }).sort((a, b) => {
    const ga = AC.porForn.get(a.cnpj), gb = AC.porForn.get(b.cnpj);
    const ra = (ga?.maes.length ? 2 : 0) + (a.modalidade ? 1 : 0), rb = (gb?.maes.length ? 2 : 0) + (b.modalidade ? 1 : 0);
    return rb - ra || (gb?.pendR || 0) - (ga?.pendR || 0) || String(a.nome).localeCompare(String(b.nome), 'pt-BR');
  });
}

/* ───────── render ───────── */
async function acordosRender() {
  const root = document.getElementById('ac-root');
  if (!root) return;
  if (!AC.iniciado) { AC.iniciado = true; _acRealtime(); }
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
  if (!root.querySelector('.ac-wrap')) root.innerHTML = _acEsqueleto();
  _acRenderFiltros();
  _acRenderLista();
  _acRenderPainel();
}

function _acEsqueleto() {
  return `<div class="ac-wrap">
    <div class="ac-toolbar">
      <div class="ac-busca"><i class="ti ti-search"></i><input class="form-input" id="ac-q" placeholder="Fornecedor ou CNPJ…" oninput="acFiltro('q', this.value)"></div>
      <label class="ac-f">Regional<select class="form-select" id="ac-f-reg" onchange="acFiltro('reg', this.value)"></select></label>
      <label class="ac-f">Central<select class="form-select" id="ac-f-cen" onchange="acFiltro('cen', this.value)"></select></label>
      <label class="ac-f">Material<select class="form-select" id="ac-f-mat" onchange="acFiltro('mat', this.value)"></select></label>
      <div class="ac-grupo" id="ac-grupo">${Object.entries(AC_GRUPOS).map(([k, r]) => `<button data-g="${k}" onclick="acFiltro('grupo','${k}')">${r}</button>`).join('')}</div>
      <button class="btn-icon" title="Recarregar notas do SEFAZ" onclick="acRecarregar()"><i class="ti ti-refresh"></i></button>
    </div>
    <div class="ac-body">
      <aside class="ac-lista" id="ac-lista"></aside>
      <section class="ac-painel" id="ac-painel"></section>
    </div>
  </div>`;
}

function _acOpcoes(id, valores, atual, rotulo) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `<option value="">${rotulo}</option>` + valores.map(v => `<option value="${_acE(v)}"${v === atual ? ' selected' : ''}>${_acE(v)}</option>`).join('');
}
function _acRenderFiltros() {
  const uniq = f => [...new Set(AC.maes.flatMap(f).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  _acOpcoes('ac-f-reg', uniq(m => [m.regional]), AC.F.reg, 'Todas');
  _acOpcoes('ac-f-cen', uniq(m => (!AC.F.reg || m.regional === AC.F.reg) ? [m.central] : []), AC.F.cen, 'Todas');
  _acOpcoes('ac-f-mat', uniq(m => m.materiais), AC.F.mat, 'Todos');
  document.querySelectorAll('#ac-grupo button').forEach(b => b.classList.toggle('active', b.dataset.g === AC.F.grupo));
  const q = document.getElementById('ac-q'); if (q && q.value !== AC.F.q) q.value = AC.F.q;
}

function _acLinhaForn(f) {
  const g = AC.porForn.get(f.cnpj);
  const maes = (g?.maes || []).filter(_acPassaMae);
  const sv = g?.semVinc.length || 0;
  return `<div class="ac-forn${AC.sel === f.cnpj ? ' sel' : ''}" onclick="acSel('${f.cnpj}')">
    <div class="ac-forn-top">
      <div class="ac-forn-nome" title="${_acE(f.nome)}">${_acE(f.nome)}</div>
      <select class="form-select ac-mod${f.modalidade ? ' def' : ''}" onclick="event.stopPropagation()" onchange="acModalidade('${f.cnpj}', this.value)" title="Modalidade do acordo">
        <option value="">Sem acordo</option>${Object.entries(AC_MODALIDADES).map(([k, r]) => `<option value="${k}"${f.modalidade === k ? ' selected' : ''}>${r}</option>`).join('')}
      </select>
    </div>
    <div class="ac-forn-sub">
      <span class="mono">${_acCnpjFmt(f.cnpj)}</span>
      ${maes.length ? `<span class="badge badge-teal">${maes.length} nota${maes.length > 1 ? 's' : ''} mãe</span>` : ''}
      ${g?.pendT ? `<span class="mono" title="Saldo pendente das notas mães autorizadas">${_acT(g.pendT)} pend.</span>` : ''}
      ${sv ? `<span class="badge badge-red" title="Notas filhas sem vínculo com nota mãe"><i class="ti ti-link-off"></i> ${sv}</span>` : ''}
    </div>
  </div>`;
}

function _acRenderLista() {
  const el = document.getElementById('ac-lista');
  if (!el) return;
  const forns = _acFornVisiveis();
  if (!forns.length) { el.innerHTML = '<div class="empty-state"><i class="ti ti-users"></i><p>Nenhum fornecedor para o filtro.</p></div>'; return; }
  if (AC.F.grupo === 'fornecedor') { el.innerHTML = forns.map(_acLinhaForn).join(''); return; }
  // Agrupado: o fornecedor aparece em cada grupo onde tem nota mãe.
  const chave = { regional: m => [m.regional || 'Sem regional'], central: m => [m.central || 'Sem central'], material: m => m.materiais.length ? m.materiais : ['Sem material'] }[AC.F.grupo];
  const grupos = new Map(), sem = [];
  forns.forEach(f => {
    const maes = (AC.porForn.get(f.cnpj)?.maes || []).filter(_acPassaMae);
    if (!maes.length) { sem.push(f); return; }
    new Set(maes.flatMap(chave)).forEach(k => (grupos.get(k) || grupos.set(k, []).get(k)).push(f));
  });
  const blocos = [...grupos.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
  if (sem.length) blocos.push(['Sem notas mães', sem]);
  el.innerHTML = blocos.map(([k, fs]) => `<div class="ac-grp"><div class="ac-grp-tit">${_acE(k)}<span>${fs.length}</span></div>${fs.map(_acLinhaForn).join('')}</div>`).join('');
}

function _acRenderPainel() {
  const el = document.getElementById('ac-painel');
  if (!el) return;
  const f = AC.forn.get(AC.sel);
  if (!f) {
    const tot = [...AC.porForn.values()];
    el.innerHTML = `<div class="ac-vazio"><i class="ti ti-file-dollar"></i>
      <p>Escolha um fornecedor na lista e defina a modalidade do acordo.</p>
      <p class="ac-muted">${AC.maes.length} notas mães e ${AC.filhas.length} notas filhas no SEFAZ importado · ${tot.reduce((t, g) => t + g.semVinc.length, 0)} filhas sem vínculo.</p>
      ${AC.cfop.size ? '' : '<p class="ac-muted">Nenhum CFOP marcado como nota mãe/filha (Configurações → CFOP).</p>'}
    </div>`;
    return;
  }
  const g = AC.porForn.get(f.cnpj) || { maes: [], semVinc: [], filhas: [] };
  const cab = `<div class="ac-p-cab"><div><div class="ac-p-nome">${_acE(f.nome)}</div><div class="ac-muted mono">${_acCnpjFmt(f.cnpj)}</div></div>
    <span class="badge ${f.modalidade ? 'badge-blue' : ''}">${_acE(AC_MODALIDADES[f.modalidade] || 'Sem acordo definido')}</span></div>`;
  if (f.modalidade !== 'nota_mae') {
    const msg = !f.modalidade
      ? `Defina a modalidade do acordo na lista.${g.maes.length ? ` Há <b>${g.maes.length}</b> nota${g.maes.length > 1 ? 's' : ''} mãe deste fornecedor no SEFAZ — escolha <b>Nota mãe</b> para ver o saldo.` : ''}`
      : `A tela de <b>${_acE(AC_MODALIDADES[f.modalidade])}</b> ainda não foi feita — por enquanto só Nota mãe.`;
    el.innerHTML = cab + `<div class="ac-vazio"><i class="ti ti-info-circle"></i><p>${msg}</p></div>`;
    return;
  }
  const maes = g.maes.filter(_acPassaMae);
  const aut = maes.filter(m => m.status === 'autorizada');
  const soma = k => aut.reduce((t, m) => t + m[k], 0);
  const resumo = `<div class="ac-kpis ac-kpis-forn">
    ${_acKpi('Notas mães autorizadas', _acNf0.format(aut.length), `${maes.length} no total`)}
    ${_acKpi('Saldo pendente', _acT(soma('pendT')), _acR(soma('pendR')), 'amber')}
    ${_acKpi('Retirado', _acT(soma('retT')), _acR(soma('retR')), 'teal')}
    ${_acKpi('Peso médio das filhas', g.pesoMedio ? _acT(g.pesoMedio) : '—', g.intervalo != null ? `1 NF a cada ${_acNf2.format(g.intervalo)} dias` : 'sem ritmo ainda')}
  </div>`;
  el.innerHTML = cab + _acAlertaSemVinc(f, g) + resumo + _acTabelaMaes(maes);
}

function _acKpi(rot, val, sub, cor) {
  return `<div class="ac-kpi${cor ? ' ac-' + cor : ''}"><div class="ac-kpi-rot">${rot}</div><div class="ac-kpi-val">${val}</div>${sub ? `<div class="ac-kpi-sub">${sub}</div>` : ''}</div>`;
}

function _acAlertaSemVinc(f, g) {
  if (!g.semVinc.length) return '';
  return `<details class="ac-alerta" open><summary><i class="ti ti-link-off"></i> ${g.semVinc.length} nota${g.semVinc.length > 1 ? 's' : ''} filha${g.semVinc.length > 1 ? 's' : ''} sem vínculo com nota mãe</summary>
    <table class="ac-tab"><thead><tr><th>Número</th><th>Emissão</th><th>Central</th><th class="num">Peso</th><th>Complementar</th><th>Vincular à nota mãe</th></tr></thead><tbody>
    ${g.semVinc.map(s => `<tr>
      <td class="mono">${_acE(s.numero)}</td><td>${_acData(s.emissao)}</td><td>${_acE(s.central || '—')}</td><td class="num mono">${_acT(s.peso)}</td>
      <td class="ac-comp" title="${_acE(s.comp)}">${_acE(s.comp || '—')}</td>
      <td><div class="ac-vinc"><input class="form-input" id="ac-v-${s.chave}" placeholder="Nº ou chave da mãe" list="ac-dl-${f.cnpj}" onkeydown="if(event.key==='Enter')acVincular('${s.chave}')"><button class="btn btn-sm" onclick="acVincular('${s.chave}')"><i class="ti ti-link"></i></button></div></td>
    </tr>`).join('')}
    </tbody></table>
    <datalist id="ac-dl-${f.cnpj}">${g.maes.map(m => `<option value="${_acE(m.numero)}">${_acE(m.numero)} · ${_acData(m.emissao)} · ${_acT(m.peso)}</option>`).join('')}</datalist>
  </details>`;
}

function _acTabelaMaes(maes) {
  if (!maes.length) return '<div class="ac-vazio"><i class="ti ti-file-off"></i><p>Nenhuma nota mãe deste fornecedor no SEFAZ importado' + (_acTemFiltro() ? ' para o filtro' : '') + '.</p></div>';
  const linhas = maes.map(m => {
    const st = AC_STATUS[m.status];
    const stCel = m.status === 'cancelada'
      ? `<span class="badge ${st[1]}" title="Cancelada no SEFAZ">${st[0]}</span>`
      : `<select class="form-select ac-st ${st[1]}" onclick="event.stopPropagation()" onchange="acStatus('${m.chave}', this.value)">${AC_STATUS_MANUAIS.map(k => `<option value="${k}"${m.status === k ? ' selected' : ''}>${AC_STATUS[k][0]}</option>`).join('')}</select>`;
    const aberta = AC.aberta === m.chave;
    return `<tr class="ac-mae${aberta ? ' aberta' : ''}${m.status !== 'autorizada' ? ' inativa' : ''}" onclick="acAbrir('${m.chave}')">
      <td>${stCel}</td><td>${_acE(m.central || '—')}</td><td class="mono">${_acE(m.numero)}</td><td>${_acData(m.emissao)}</td>
      <td>${_acE(m.materiais.join(', ') || '—')}</td><td class="num mono">${_acR(m.custoUn)}/t</td><td class="num mono">${_acR(m.valor)}</td>
      <td class="mono ac-chave" title="${m.chave}">${m.chave}</td>
      <td class="ac-bar-cel" title="${_acNf0.format(m.pct * 100)}% retirado"><div class="ac-minibar"><i style="width:${m.pct * 100}%"></i></div></td>
    </tr>${aberta ? `<tr class="ac-rel-tr"><td colspan="9">${_acRelatorio(m)}</td></tr>` : ''}`;
  }).join('');
  return `<div class="ac-tab-wrap"><table class="ac-tab ac-tab-maes"><thead><tr>
    <th>Status</th><th>Central</th><th>Número</th><th>Emissão</th><th>Material</th><th class="num">Custo un.</th><th class="num">Valor total</th><th>Chave de acesso</th><th>Retirado</th>
  </tr></thead><tbody>${linhas}</tbody></table></div>`;
}

// Relatório da nota mãe: KPIs, barra retirado × pendente, curva do saldo e as filhas.
function _acRelatorio(m) {
  const tempo = m.diasRest == null ? '—' : m.diasRest === 0 ? 'Saldo zerado' : `${_acNf0.format(Math.ceil(m.diasRest))} dias`;
  const tempoSub = m.previsao ? `previsão ${_acData(m.previsao)}` : m.diasRest === 0 ? '' : 'sem ritmo de retiradas';
  return `<div class="ac-rel">
    <div class="ac-kpis">
      ${_acKpi('Saldo retirado', _acT(m.retT), _acR(m.retR), 'teal')}
      ${_acKpi('Saldo pendente', _acT(m.pendT), _acR(m.pendR), 'amber')}
      ${_acKpi('NFs retiradas', _acNf0.format(m.nRet), `de ${_acT(m.peso)} na nota mãe`)}
      ${_acKpi('NFs até acabar', m.nfsRest == null ? '—' : _acNf0.format(m.nfsRest), 'pelo peso médio')}
      ${_acKpi('Tempo até acabar', tempo, tempoSub, 'purple')}
      ${_acKpi('Peso médio', m.pesoMedio ? _acT(m.pesoMedio) : '—', 'filhas do fornecedor')}
    </div>
    <div class="ac-prog"><div class="ac-prog-bar"><i style="width:${m.pct * 100}%"></i></div>
      <div class="ac-prog-leg"><span><b class="ac-dot teal"></b>Retirado ${_acNf0.format(m.pct * 100)}%</span><span><b class="ac-dot amber"></b>Pendente ${_acNf0.format((1 - m.pct) * 100)}%</span>
      ${m.excedido ? `<span class="ac-exc"><i class="ti ti-alert-triangle"></i> Retirado ${_acT(m.excedido)} acima da nota mãe</span>` : ''}</div></div>
    ${_acCurva(m)}
    ${m.filhas.length ? `<table class="ac-tab"><thead><tr><th>Nota filha</th><th>Emissão</th><th>Central</th><th class="num">Peso</th><th class="num">Saldo depois</th><th>Vínculo</th><th>Chave de acesso</th><th></th></tr></thead><tbody>
      ${(() => { let s = m.peso; return m.filhas.map(f => { const ok = f.status !== 'cancelada'; if (ok) s -= f.peso; return `<tr${ok ? '' : ' class="inativa"'}>
        <td class="mono">${_acE(f.numero)}${ok ? '' : ' <span class="badge badge-red">Cancelada</span>'}</td><td>${_acData(f.emissao)}</td><td>${_acE(f.central || '—')}</td>
        <td class="num mono">${_acT(f.peso)}</td><td class="num mono">${ok ? _acT(s) : '—'}</td>
        <td><span class="badge ${f.vinculo === 'manual' ? 'badge-purple' : 'badge-teal'}">${{ manual: 'Manual', chave: 'Pela chave', numero: 'Pelo número' }[f.vinculo]}</span></td>
        <td class="mono ac-chave" title="${f.chave}">${f.chave}</td>
        <td>${f.vinculo === 'manual' ? `<button class="btn-icon danger" title="Desfazer vínculo manual" onclick="event.stopPropagation();acDesvincular('${f.chave}')"><i class="ti ti-link-off"></i></button>` : ''}</td>
      </tr>`; }).join(''); })()}
    </tbody></table>` : '<p class="ac-muted">Nenhuma nota filha vinculada a esta nota mãe ainda.</p>'}
  </div>`;
}

// Curva do saldo pendente (degrau a cada filha) + projeção tracejada até zerar.
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
  return `<div class="ac-curva"><div class="ac-curva-tit">Saldo pendente ao longo do tempo</div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Saldo pendente da nota mãe">
      <g class="ac-grid">${ticks}</g>
      <path d="${d}" class="ac-linha"/>${proj}
      <text x="${P.l}" y="${H - 6}">${_acData(t0)}</text><text x="${W - P.r}" y="${H - 6}" text-anchor="end">${_acData(tFim)}${m.previsao ? ' (previsão)' : ''}</text>
    </svg></div>`;
}

/* ───────── ações ───────── */
function acSel(cnpj) { AC.sel = AC.sel === cnpj ? '' : cnpj; AC.aberta = ''; _acRenderLista(); _acRenderPainel(); }
function acAbrir(chave) { AC.aberta = AC.aberta === chave ? '' : chave; _acRenderPainel(); }
function acFiltro(k, v) {
  AC.F[k] = v;
  if (k === 'reg') AC.F.cen = '';
  _acRenderFiltros(); _acRenderLista(); _acRenderPainel();
}
function acRecarregar() { AC.carga = null; AC.sujo = true; acordosRender(); }

const _acQuem = () => ({ atualizado_por: window.currentUser?.id, atualizado_em: new Date().toISOString() });

async function acModalidade(cnpj, mod) {
  const f = AC.forn.get(cnpj);
  const q = window.supabaseClient.from('acordo_fornecedores');
  const { error } = mod
    ? await q.upsert({ cnpj, nome: f?.nome || null, modalidade: mod, ..._acQuem() })
    : await q.delete().eq('cnpj', cnpj);
  if (error) { toast('Falha ao salvar a modalidade: ' + error.message, 'error'); _acRenderLista(); return; }
  if (f) f.modalidade = mod;
  AC.sel = cnpj;
  _acRenderLista(); _acRenderPainel();
  toast(mod ? `${f?.nome || cnpj}: ${AC_MODALIDADES[mod]}.` : 'Modalidade removida.', 'success');
}

async function acStatus(chave, st) {
  const q = window.supabaseClient.from('acordo_nf_status');
  const { error } = st === 'autorizada' ? await q.delete().eq('chave', chave) : await q.upsert({ chave, status: st, ..._acQuem() });
  if (error) { toast('Falha ao salvar o status: ' + error.message, 'error'); _acRenderPainel(); return; }
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
  const tabela = (t, ordem, set) => sb.channel('ac_' + t)
    .on('postgres_changes', { event: '*', schema: 'public', table: t }, async () => {
      try { set(await _acFetchAll(t, '*', ordem)); if (ativa() && AC.carga) acordosRender(); } catch (e) { console.warn('[Acordos]', t, e); }
    }).subscribe();
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

Object.assign(window, { acordosRender, acSel, acAbrir, acFiltro, acRecarregar, acModalidade, acStatus, acVincular, acDesvincular });
