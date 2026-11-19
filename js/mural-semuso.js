'use strict';

// ═══════════════════════════════════════════════════════════
// OPERAÇÕES — MATERIAL SEM USO (aba "Sem uso" do Mural)
// ═══════════════════════════════════════════════════════════
// Regras fechadas com o Hugo em 17/11/2026:
//   · par central × material com saldo no SAP (Custos SAP + movimentos depois
//     da âncora, o mesmo saldo da Visão Micro — _anGetSapStock);
//   · uso = qualquer movimento SAP, menos Y11/Y12/551 e os estornos;
//   · dias contados até o movimento SAP mais recente da base (não até hoje —
//     importação atrasada não gera alerta falso);
//   · Atenção ≥ 60 dias, Urgente ≥ 90, Crítico ≥ 120. Saldo sem nenhum
//     movimento na base = Crítico, se a base cobrir ≥ 120 dias;
//   · tratativa = comentário com causa "Sem uso: …" OU Solicitação de coleta
//     com motivo "Sem uso"; vale 30 dias, depois o item volta.
// Independe do período do Analítico. Depende de mural.js (_mo, helpers _mo*)
// e mural-painel.js (_mp).

const SU_NIVEIS = [[120, 'critico'], [90, 'urgente'], [60, 'atencao']];
const SU_IGNORA = new Set(['Y11', 'Y12', '551', '102', '202', '302', '304', '306', '310', '312', '552', '802', '864']);
const SU_REARME_DIAS = 30;
const SU_CAUSAS = ['Sem uso: sazonal', 'Sem uso: reserva estratégica', 'Sem uso: aguardando coleta', 'Sem uso: obra parada', 'Sem uso: outro'];
const SU_GRAV = { critico: 6, urgente: 3, atencao: 1 };
const _suEhCausa = (causa) => /^Sem uso/.test(causa || '');

const _su = { chave: '', calc: null, calculando: null, coletas: [], sel: null };

// ── Cálculo (pesado: passa uma vez por todo o SAP) ─────────────────────────
// ponytail: cache pela identidade/tamanho de state.sap e state.custosSap;
// uma edição pontual que não muda o tamanho só entra no próximo reload.
function _suChave() {
  return `${(state.sap || []).length}|${(state.custosSap || []).length}|${(state.materiais || []).length}`;
}

async function suCalcular() {
  const chave = _suChave();
  if (_su.calc && _su.chave === chave) return _su.calc;
  if (_su.calculando) return _su.calculando;
  _su.calculando = (async () => {
    const t0 = performance.now(), ced = { t: performance.now() };
    const { byCentralMat } = getSapIndex();
    // Última data de uso por par + início/fim da base, numa passada só.
    let min = Infinity, max = -Infinity;
    const ultUso = new Map(); // central → Map(material → ts | null)
    for (const [central, mats] of byCentralMat) {
      const m2 = new Map(); ultUso.set(central, m2);
      for (const [mat, arr] of mats) {
        let u = null;
        for (let i = 0; i < arr.length; i++) {
          const r = arr[i], ts = parseDateTs(r.dtLanc);
          if (ts === null) continue;
          if (ts < min) min = ts;
          if (ts > max) max = ts;
          if ((u === null || ts > u) && !SU_IGNORA.has(normMov(r.movimento))) u = ts;
        }
        m2.set(mat, u);
        await muralCederTempo(ced);
      }
    }
    if (max === -Infinity) return { itens: [], ref: null, ini: null, ms: performance.now() - t0 };
    // Pares que só existem no Custos SAP (saldo sem movimento nenhum na base).
    const matPorCod = new Map();
    (state.materiais || []).forEach(m => { const c = normalizarCodSap(m.codSap); if (c && m.alias && !matPorCod.has(c)) matPorCod.set(c, String(m.alias).trim()); });
    (state.custosSap || []).forEach(r => {
      const central = String(r.central || '').trim(), mat = matPorCod.get(normalizarCodSap(r.material));
      if (!central || !mat) return;
      if (!ultUso.has(central)) ultUso.set(central, new Map());
      if (!ultUso.get(central).has(mat)) ultUso.get(central).set(mat, null);
    });

    const ref = new Date(max); ref.setHours(0, 0, 0, 0);
    const amanha = new Date(ref); amanha.setDate(amanha.getDate() + 1);
    const baseDias = Math.round((max - min) / 86400000);
    const idx = _anGetCustosSapIdx(), fil = getFilialLookupIndex().exact;
    const itens = [];
    for (const [central, mats] of ultUso) {
      for (const [material, u] of mats) {
        const dias = u === null ? baseDias : Math.round((max - u) / 86400000);
        if (dias < 60 || (u === null && baseDias < 120)) continue;
        const catKey = getCatKeyDoCadastro(material);
        if (!catKey) continue;
        const saldo = _anGetSapStock({ central, material, dtIni: amanha });
        if (!saldo || !(saldo.value > 0.5)) continue;
        const cod = getCodSapPorGrupo(material);
        const custo = getCustoMedioCustosSap(central, cod, ref.getFullYear(), ref.getMonth() + 1, idx)?.valor || 0;
        const nivel = u === null ? 'critico' : SU_NIVEIS.find(([d]) => dias >= d)[1];
        itens.push({ central, material, catKey, codSap: cod || '', categoria: normalizeCategoriaMaterial(getCategoriaPorGrupo(material)) || '—',
          regional: (fil.get(normalizeText(central))?.regional || '').trim() || '—',
          ultUso: u, semHistorico: u === null, dias, nivel, kg: saldo.value, custo, rs: saldo.value * custo });
        await muralCederTempo(ced);
      }
    }
    const ms = performance.now() - t0;
    console.info(`[Mural] Sem uso: ${itens.length} pares em ${ms.toFixed(0)} ms (${(state.sap || []).length} registros SAP).`);
    return { itens, ref, ini: new Date(min), ms };
  })();
  try {
    _su.calc = await _su.calculando; _su.chave = chave;
  } finally { _su.calculando = null; }
  return _su.calc;
}

// Solicitações de coleta "Sem uso" dos últimos 30 dias (a RLS filtra o que
// cada um enxerga). Leve: só as colunas que importam.
async function _suCarregarColetas() {
  if (!window.supabaseClient) return [];
  const desde = new Date(); desde.setDate(desde.getDate() - SU_REARME_DIAS);
  const { data, error } = await window.supabaseClient.from('solicitacoes')
    .select('protocolo, central, itens, created_at, status')
    .eq('categoria_situacao', 'Coleta de material').eq('motivo', 'Sem uso').gte('created_at', desde.toISOString());
  if (error) { console.warn('[Mural] Solicitações de coleta sem uso:', error.message); return []; }
  return (data || []).filter(s => s.status !== 'excluida').map(s => ({ ...s,
    centralNorm: normalizarCentral(s.central), mats: new Set((s.itens || []).map(i => normalizeText(i.grupoMaterial || ''))) }));
}

// Chamado por muralRecarregar: calcula em segundo plano e atualiza aba e sino.
async function suRecarregar(gen) {
  try {
    const [, coletas] = await Promise.all([suCalcular(), _suCarregarColetas()]);
    if (gen !== _mo.gen) return;
    _su.coletas = coletas;
    if (!_mo.enriquecendo) _muralAvisos();
    if (_mp.aba === 'semuso' || !_mo.fotos.length) muralRender();
  } catch (err) { console.warn('[Mural] Erro ao calcular sem uso:', err); }
}

// ── Itens com a tratativa derivada (muda sozinha com comentário/coleta) ───
function suItens() {
  if (!_su.calc) return [];
  const eu = window.currentUser?.id;
  const minhas = new Set(_mo.donos.filter(d => d.analista_user_id === eu).map(d => normalizeCategoriaMaterial(d.categoria)));
  const hoje = _moDia(new Date()), corte = new Date(hoje); corte.setDate(corte.getDate() - SU_REARME_DIAS);
  // Tratativas dos últimos 30 dias por par (uma passada nos comentários).
  const trats = new Map();
  const marcar = (k, t) => { if (t.quando >= corte && (!trats.has(k) || trats.get(k).quando < t.quando)) trats.set(k, t); };
  (typeof _varComs !== 'undefined' ? _varComs : []).forEach(r => {
    const causa = !r.oc_id && varComCausaDe(r.texto);
    if (!_suEhCausa(causa)) return;
    const quando = r.created_at ? new Date(r.created_at) : _moIsoParaData(r.data);
    if (quando) marcar(r.central + '|' + r.material, { quando, causa });
  });
  return _su.calc.itens.filter(i => _moEhAdm() || minhas.has(i.categoria)).map(i => {
    const k = _moChave(i);
    _su.coletas.forEach(s => { if (s.centralNorm === i.central && s.mats.has(normalizeText(i.material)))
      marcar(k, { quando: new Date(s.created_at), causa: `Solicitação de coleta ${s.protocolo || ''}`.trim() }); });
    const trat = trats.get(k) || null;
    const volta = trat ? new Date(_moDia(trat.quando).getTime() + SU_REARME_DIAS * 86400000) : null;
    const dono = _muralDonoDe(i.categoria);
    const prioridade = (SU_GRAV[i.nivel] || 0) + Math.log10(Math.abs(i.rs) + 1);
    return { ...i, trat, volta, dono, prioridade };
  });
}

function suItensFiltrados() {
  const termos = _mpTermos();
  return suItens().filter(i => _muralAplicarFiltros([{ regional: i.regional, central: i.central, categoriaFoto: i.categoria, material: i.material, v: 0, dono: i.dono }], true).length
    && (!termos.length || termos.some(t => [i.regional, i.central, i.material].some(x => normalizeText(x).includes(t)))));
}

// Aviso no sino (entra junto com os do Mural em _muralAvisos).
function suAviso(add) {
  const pend = suItens().filter(i => !i.trat);
  if (!pend.length) return;
  const crit = pend.some(i => i.nivel === 'critico');
  const rs = pend.reduce((s, i) => s + i.rs, 0);
  add('semuso', pend.length, crit ? 'critico' : 'atencao',
    `${pend.length} ${pend.length === 1 ? 'material sem uso' : 'materiais sem uso'} há 60+ dias`,
    `${_moRs(rs).replace('+', '')} parados em estoque, sem tratativa. Comente a causa ou abra a coleta.`, 'semuso');
}

// ── Tela ───────────────────────────────────────────────────────────────────
const _suData = (ts) => ts ? fmtPtDate(new Date(ts)) : '—';
const _suDiasTxt = (i) => i.semHistorico ? `sem movimento desde o início da base (${i.dias}+ dias)` : `${i.dias} dias sem uso`;

function suListaHtml() {
  if (!_su.calc) return `<div class="empty-state" style="padding:24px"><p>Levantando os materiais sem uso…</p></div>`;
  const its = suItensFiltrados().sort((a, b) => (!!a.trat - !!b.trat) || b.prioridade - a.prioridade);
  if (!its.length) return `<div class="empty-state" style="padding:24px"><p>Nenhum material parado há 60 dias ou mais${_mpTermos().length || _muralFiltrosAtivos() ? ' com esses filtros' : ''}.</p></div>`;
  return its.map(i => {
    const sel = _su.sel === _moChave(i);
    const sit = i.trat ? `Tratado em ${fmtPtDate(i.trat.quando).slice(0, 5)} · volta em ${fmtPtDate(i.volta).slice(0, 5)}` : 'Sem tratativa';
    return `<button class="mp-row mp-item mp-item-1${sel ? ' sel' : ''}${i.trat ? ' apagado' : ''}" onclick="suSel(this)" data-c="${_moEsc(i.central)}" data-m="${_moEsc(i.material)}">
      ${_mpIco(i.nivel)}<span class="mp-nome"><b>${_moEsc(i.material)}</b><small style="color:${i.trat ? 'var(--text2)' : 'var(--amber)'}">${_moEsc(i.central)} · ${_moEsc(_suDiasTxt(i))} · ${sit}</small></span>
      <span class="mp-dir"><span class="mp-v">${_moRs(i.rs).replace('+', '')}</span></span></button>`;
  }).join('');
}

function suPainelHtml() {
  if (!_su.calc) return '<div class="mp-card"><span class="mo-hint">Calculando…</span></div>';
  const its = suItensFiltrados();
  const it = _su.sel && its.find(i => _moChave(i) === _su.sel);
  const base = `Dias contados até ${_suData(_su.calc.ref)} (movimento SAP mais recente da base, que começa em ${_suData(_su.calc.ini)}). Não contam como uso: Y11, Y12, 551 e estornos.`;
  if (!it) {
    const pend = its.filter(i => !i.trat), soma = (a, f) => a.reduce((s, i) => s + f(i), 0);
    const porNivel = ['critico', 'urgente', 'atencao'].map(n => `<div class="mp-placar-num"><span class="mo-kpi-label">${MURAL_NIVEL[n].label}</span><b style="color:${MP_NIVEL_COR[n]}">${its.filter(i => i.nivel === n).length}</b></div>`).join('');
    return `<div class="mp-card"><h4 class="mp-tit">Material sem uso <span class="mo-hint">${its.length} pares · ${its.length - pend.length} tratados</span></h4>
      <div class="mo-placar">${porNivel}
        <div class="mp-placar-num"><span class="mo-kpi-label">Parado em estoque</span><b>${_moRs(soma(its, i => i.rs)).replace('+', '')}</b><span class="mo-hint mono">sem tratativa ${_moRs(soma(pend, i => i.rs)).replace('+', '')}</span></div></div>
      <p class="mo-hint" style="margin-top:10px">Atenção a partir de 60 dias, Urgente a partir de 90, Crítico a partir de 120. ${base}</p>
      <p class="mo-hint">Para tratar: comente a causa (sazonal, reserva estratégica, aguardando coleta, obra parada) ou abra uma Solicitação de coleta com o motivo "Sem uso". O item volta ${SU_REARME_DIAS} dias depois se continuar parado.</p>
      <div style="display:flex;justify-content:flex-end"><button class="btn btn-sm" onclick="suRelatorioExportar(this)" title="Baixar este relatório (com os filtros aplicados) num arquivo HTML"><i class="ti ti-file-download"></i> Baixar relatório</button></div></div>
      ${_suRelatorioHtml(its)}`;
  }
  const lin = (k, v) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid var(--border)"><span class="mo-hint">${k}</span><b>${v}</b></div>`;
  return `<div class="mp-card"><h4 class="mp-tit">${_mpIco(it.nivel)} ${_moEsc(it.material)} <span class="mo-hint">${_moEsc(it.central)} · ${_moEsc(it.regional)}</span>
      <button class="mo-link" style="margin-left:auto" onclick="suSel(null)">Voltar</button></h4>
    ${lin('Nível', `<span style="color:${MP_NIVEL_COR[it.nivel]}">${MURAL_NIVEL[it.nivel].label}</span>`)}
    ${lin('Tempo parado', _moEsc(_suDiasTxt(it)))}
    ${lin('Último uso', it.semHistorico ? '—' : _suData(it.ultUso))}
    ${lin('Saldo SAP', _moPeso(it.kg))}
    ${lin('Valor parado', `${_moRs(it.rs).replace('+', '')}${it.custo ? '' : ' <span class="mo-hint">(sem custo no Custos SAP)</span>'}`)}
    ${lin('Categoria · dono', `${_moEsc(it.categoria)} · ${_moEsc(it.dono.nome)}`)}
    ${lin('Tratativa', it.trat ? `${_moEsc(it.trat.causa)} em ${fmtPtDate(it.trat.quando)} · volta em ${fmtPtDate(it.volta)}` : '<span style="color:var(--amber)">pendente</span>')}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
      <button class="btn btn-primary" onclick="suComentar()"><i class="ti ti-message-dots"></i> Comentar a causa</button>
      <a class="btn" href="registro-operacional.html" target="_blank" rel="noopener"><i class="ti ti-truck"></i> Abrir Solicitação de coleta</a>
    </div>
    <p class="mo-hint" style="margin-top:10px">Na Solicitação, escolha "Coleta de material" com o motivo "Sem uso", esta central e este material. ${base}</p></div>`;
}

// ── Relatório (Hugo, 19/11/2026) ─────────────────────────────────────────
// KPIs, distribuições, rankings e a tabela de TODOS os itens da lista (com os
// filtros da tela). HTML/CSS puro (barras em div), então o mesmo markup vai
// para o arquivo baixado sem script nenhum.
const SU_FAIXAS = [['60–89 dias', 60, 'var(--amber)'], ['90–119 dias', 90, 'var(--urgente)'], ['120–179 dias', 120, 'var(--red)'],
  ['180–364 dias', 180, 'var(--red)'], ['365+ dias', 365, 'var(--red)'], ['Sem movimento na base', Infinity, 'var(--text3)']];
const _suFaixa = (i) => i.semHistorico ? SU_FAIXAS[5] : [...SU_FAIXAS.slice(0, 5)].reverse().find(([, d]) => i.dias >= d);
const _suRsTxt = (v) => _moRs(v).replace('+', '');
const _suPct = (a, b) => b ? Math.round(a / b * 100) + '%' : '—';

function _suAgrupar(its, chave) {
  const m = new Map();
  its.forEach(i => {
    const k = chave(i);
    if (!m.has(k)) m.set(k, { nome: k, rs: 0, kg: 0, n: 0, pendRs: 0, pendN: 0, outros: new Set() });
    const g = m.get(k);
    g.rs += i.rs; g.kg += i.kg; g.n++;
    if (!i.trat) { g.pendRs += i.rs; g.pendN++; }
  });
  return [...m.values()].sort((a, b) => b.rs - a.rs);
}

// Barra horizontal: parte sem tratativa na cor da linha, parte tratada em verde.
function _suBarras(titulo, grupos, opts = {}) {
  if (!grupos.length) return '';
  const max = Math.max(...grupos.map(g => g.rs), 1), total = grupos.reduce((s, g) => s + g.rs, 0);
  const lin = grupos.map(g => `<div class="su-bar">
      <span class="su-bar-n" title="${_moEsc(g.nome)}">${_moEsc(g.nome)}${opts.sub ? `<small>${_moEsc(opts.sub(g))}</small>` : ''}</span>
      <span class="su-bar-t"><i style="width:${g.pendRs / max * 100}%;background:${g.cor || 'var(--amber)'}"></i><i style="width:${(g.rs - g.pendRs) / max * 100}%;background:var(--green);opacity:.55"></i></span>
      <span class="su-bar-v"><b>${_suRsTxt(g.rs)}</b><small>${g.n} ${g.n === 1 ? 'par' : 'pares'} · ${_suPct(g.rs, total)}</small></span></div>`).join('');
  return `<div class="mp-card"><h4 class="mp-tit">${titulo}${opts.hint ? ` <span class="mo-hint">${opts.hint}</span>` : ''}</h4>${lin}</div>`;
}

function _suRelatorioHtml(its) {
  if (!its.length) return '';
  const soma = (a, f) => a.reduce((s, i) => s + f(i), 0);
  const pend = its.filter(i => !i.trat), rs = soma(its, i => i.rs), rsPend = soma(pend, i => i.rs);
  const comHist = its.filter(i => !i.semHistorico);
  const diasMed = comHist.length ? Math.round(soma(comHist, i => i.dias) / comHist.length) : 0;
  const diasMax = comHist.length ? Math.max(...comHist.map(i => i.dias)) : 0;
  const nCent = new Set(its.map(i => i.central)).size, nMat = new Set(its.map(i => i.material)).size;
  const semCusto = its.filter(i => !i.custo).length;
  const kpi = (rot, val, sub = '', cor = '') => `<div class="su-kpi"><span class="mo-kpi-label">${rot}</span><b${cor ? ` style="color:${cor}"` : ''}>${val}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const niveis = ['critico', 'urgente', 'atencao'].map(n => {
    const a = its.filter(i => i.nivel === n);
    return kpi(MURAL_NIVEL[n].label, a.length, _suRsTxt(soma(a, i => i.rs)), MP_NIVEL_COR[n]);
  }).join('');
  const kpis = `<div class="mp-card"><h4 class="mp-tit">Indicadores</h4><div class="su-kpis">
      ${kpi('Pares parados', its.length, `${nCent} centrais · ${nMat} materiais`)}
      ${kpi('Valor parado', _suRsTxt(rs), semCusto ? `${semCusto} sem custo no Custos SAP` : 'pelo custo médio do Custos SAP')}
      ${kpi('Saldo parado', _moPeso(soma(its, i => i.kg)))}
      ${kpi('Sem tratativa', _suRsTxt(rsPend), `${pend.length} pares · ${_suPct(rsPend, rs)} do valor`, pend.length ? 'var(--amber)' : '')}
      ${kpi('Tratados', _suPct(its.length - pend.length, its.length), `${its.length - pend.length} de ${its.length} pares`, 'var(--green)')}
      ${kpi('Dias parado', diasMed ? `${diasMed} dias` : '—', diasMax ? `média · máximo ${diasMax} dias` : 'só itens sem histórico')}
      ${niveis}</div>
    <div class="mo-fbar" style="margin-top:6px"><i style="width:${rs ? rsPend / rs * 100 : 0}%;background:var(--amber)"></i><i style="flex:1;background:var(--green);opacity:.55"></i></div>
    <div class="mo-fleg"><span><i style="background:var(--amber)"></i>Sem tratativa ${_suRsTxt(rsPend)}</span><span><i style="background:var(--green);opacity:.55"></i>Tratado ${_suRsTxt(rs - rsPend)}</span></div></div>`;

  const leg = 'cor = sem tratativa · verde = tratado';
  const faixas = SU_FAIXAS.map(([nome, , cor]) => {
    const g = _suAgrupar(its.filter(i => _suFaixa(i)[0] === nome), () => nome)[0];
    return g && { ...g, cor };
  }).filter(Boolean);
  const pendDe = (g) => g.pendN ? `${g.pendN} sem tratativa` : 'tudo tratado';
  const comCor = (gs) => gs.map(g => ({ ...g, cor: 'var(--amber)' }));
  const topCent = _suAgrupar(its, i => i.central).slice(0, 10);
  topCent.forEach(g => { g.reg = its.find(i => i.central === g.nome)?.regional || ''; });
  const topMat = _suAgrupar(its, i => i.material).slice(0, 10);
  topMat.forEach(g => { g.nc = new Set(its.filter(i => i.material === g.nome).map(i => i.central)).size; });
  const causas = _suAgrupar(its, i => !i.trat ? 'Sem tratativa' : /^Solicitação de coleta/.test(i.trat.causa) ? 'Solicitação de coleta' : i.trat.causa)
    .map(g => ({ ...g, cor: g.nome === 'Sem tratativa' ? 'var(--amber)' : 'var(--green)' }));
  // Na de causas o verde já é "tratado": a barra inteira vai numa cor só.
  causas.forEach(g => { g.pendRs = g.rs; });

  const ord = [...its].sort((a, b) => (!!a.trat - !!b.trat) || b.prioridade - a.prioridade);
  const tabela = `<div class="mp-card"><h4 class="mp-tit">Todos os itens <span class="mo-hint">${its.length} pares · sem tratativa primeiro, depois por prioridade</span></h4>
    <div class="su-tab-wrap"><table class="su-tab"><thead><tr><th>Nível</th><th>Material</th><th>Central</th><th>Regional</th><th>Categoria</th><th>Dono</th>
      <th class="n">Dias</th><th>Último uso</th><th class="n">Saldo</th><th class="n">Valor</th><th>Tratativa</th></tr></thead><tbody>
    ${ord.map(i => `<tr><td style="color:${MP_NIVEL_COR[i.nivel]};white-space:nowrap">${_mpIco(i.nivel)} ${MURAL_NIVEL[i.nivel].label}</td>
      <td><b>${_moEsc(i.material)}</b></td><td>${_moEsc(i.central)}</td><td>${_moEsc(i.regional)}</td><td>${_moEsc(i.categoria)}</td><td>${_moEsc(i.dono?.nome || '—')}</td>
      <td class="n">${i.semHistorico ? `${i.dias}+` : i.dias}</td><td>${i.semHistorico ? 'sem movimento' : _suData(i.ultUso)}</td>
      <td class="n">${_moPeso(i.kg)}</td><td class="n">${i.custo ? _suRsTxt(i.rs) : '<span class="mo-hint">sem custo</span>'}</td>
      <td>${i.trat ? `${_moEsc(i.trat.causa)}<small> · ${fmtPtDate(i.trat.quando).slice(0, 5)}, volta ${fmtPtDate(i.volta).slice(0, 5)}</small>` : '<span style="color:var(--amber)">pendente</span>'}</td></tr>`).join('')}
    </tbody></table></div></div>`;

  return `<div class="su-rel">${kpis}
    <div class="su-graf">
      ${_suBarras('Por tempo parado', faixas, { hint: leg, sub: pendDe })}
      ${_suBarras('Por regional', comCor(_suAgrupar(its, i => i.regional)), { hint: leg, sub: pendDe })}
      ${_suBarras('Por categoria', comCor(_suAgrupar(its, i => i.categoria)), { hint: leg, sub: pendDe })}
      ${_suBarras('Tratativas por causa', causas, { sub: g => `${_moPeso(g.kg)}` })}
      ${_suBarras('Top 10 centrais', comCor(topCent), { hint: 'por valor parado', sub: g => `${g.reg} · ${pendDe(g)}` })}
      ${_suBarras('Top 10 materiais', comCor(topMat), { hint: 'por valor parado, somando as centrais', sub: g => `${g.nc} ${g.nc === 1 ? 'central' : 'centrais'} · ${pendDe(g)}` })}
    </div>${tabela}</div>`;
}

async function suRelatorioExportar(btn) {
  if (btn) btn.disabled = true;
  try {
    const its = suItensFiltrados();
    if (!_su.calc || !its.length || typeof _dgrCssApp !== 'function') { toast('Nada para exportar nesta tela.', 'error'); return; }
    const agora = new Date(), tema = document.body.dataset.theme || '', css = await _dgrCssApp();
    const quem = window.currentUser?.nome_exibicao || '';
    const periodo = `${_suData(_su.calc.ini)} a ${_suData(_su.calc.ref)}`;
    const filtros = _mpTermos().length || _muralFiltrosAtivos() ? 'com os filtros aplicados · ' : '';
    const nome = `operacoes-sem-uso-${localISODate(agora)}.html`;
    const corpo = `<style>.su-exp{display:flex;flex-direction:column;gap:14px;font-size:14px;color:var(--text)}</style>
      <div class="su-exp"><p class="mo-hint">Atenção a partir de 60 dias, Urgente a partir de 90, Crítico a partir de 120. Dias contados até ${_suData(_su.calc.ref)} (movimento SAP mais recente da base, que começa em ${_suData(_su.calc.ini)}). Não contam como uso: Y11, Y12, 551 e estornos. Tratativa vale ${SU_REARME_DIAS} dias.</p>
      ${_suRelatorioHtml(its)}</div>`;
    const html = _buildRankingShellHTML({ periodoBadge: periodo, periodo, now: agora.toLocaleString('pt-BR') }, {
      pageTitle: 'Operações · Material sem uso', badge: 'Operações · Sem uso', title: 'Material sem uso',
      subtitle: `${quem ? `Gerado por ${quem} · ` : ''}${filtros}${its.length} pares parados há 60+ dias`,
      bodyHtml: corpo, cssApp: css, offlineCompleto: true,
      temaAlternavel: true, temaInicial: /light|sand/.test(tema) ? 'light' : 'dark',
      permitirDownload: true, nomeArquivoDownload: nome,
      notaRodape: 'Operações · material com saldo no SAP sem movimento de uso há 60 dias ou mais.'
    });
    _mpBaixar(html, nome, 'text/html;charset=utf-8');
  } catch (err) {
    console.error('[Operações] Erro ao exportar sem uso:', err);
    toast('Não foi possível exportar: ' + (err.message || err), 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function suSel(el) { _su.sel = el ? el.dataset.c + '|' + el.dataset.m : null; muralRender(); }

function suComentar() {
  const it = suItens().find(i => _moChave(i) === _su.sel);
  if (!it || typeof openVarComModal !== 'function') return;
  const b = document.createElement('button');
  Object.assign(b.dataset, { central: it.central, material: it.material, semuso: _suDiasTxt(it) + ` · saldo ${_moPeso(it.kg)}` });
  openVarComModal(b);
}

Object.assign(window, { suSel, suComentar, suRelatorioExportar });
