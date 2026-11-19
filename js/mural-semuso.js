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
  return (data || []).filter(s => s.status !== 'excluida').map(s => ({ ...s, categoria_situacao: 'Coleta de material', motivo: 'Sem uso',
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

// Painel da aba (Hugo, 19/11/2026): dashboard em abas sem item selecionado;
// com item, o relatório do material com a linha do tempo. O desenho é do
// semuso-dash.js (SUD); aqui só se montam os dados.
function suPainelHtml() {
  if (!_su.calc) return '<div class="mp-card"><span class="mo-hint">Calculando…</span></div>';
  const its = suItensFiltrados();
  if (!its.length) return `<div class="mp-card"><p class="mo-hint">Nenhum material parado há 60 dias ou mais${_mpTermos().length || _muralFiltrosAtivos() ? ' com esses filtros' : ''}.</p></div>`;
  const it = _su.sel && its.find(i => _moChave(i) === _su.sel);
  const acoes = it ? `<button class="btn btn-primary" onclick="suComentar()"><i class="ti ti-message-dots"></i> Comentar a causa</button>
    <a class="btn" href="registro-operacional.html" target="_blank" rel="noopener" title='Escolha "Coleta de material" com o motivo "Sem uso", esta central e este material'><i class="ti ti-truck"></i> Abrir Solicitação de coleta</a>
    <button class="btn" style="margin-left:auto" onclick="suRelatorioExportar(this, true)"><i class="ti ti-file-download"></i> Baixar relatório do material</button>` : '';
  const D = _suDados(its);
  if (it) D.det[_moChave(it)] = _suDetalhe(it, _suCtxAcoes());
  return SUD.html(D, { modo: 'tela', sel: it ? _moChave(it) : null, abrir: 'suSelChave', voltar: 'suSel(null)', movs: 'suMovimentacoes', acoes,
    baixar: '<button class="btn btn-sm" onclick="suRelatorioExportar(this)" title="Baixar o relatório (com os filtros aplicados) num arquivo HTML"><i class="ti ti-file-download"></i> Baixar relatório</button>' });
}

// Itens no formato do SUD (só o que ele desenha, datas em ms).
function _suDados(its) {
  return { ref: _su.calc.ref.getTime(), ini: _su.calc.ini.getTime(), hoje: _moDia(new Date()).getTime(), det: {},
    its: its.map(i => ({ k: _moChave(i), central: i.central, material: i.material, regional: i.regional, categoria: i.categoria, dono: i.dono?.nome || '—',
      dias: i.dias, semHist: i.semHistorico, ultUso: i.ultUso, nivel: i.nivel, kg: i.kg, custo: i.custo, rs: i.rs, prio: i.prioridade,
      trat: i.trat ? { causa: i.trat.causa, quando: i.trat.quando.getTime() } : null, volta: i.volta ? i.volta.getTime() : null })) };
}

// Central pela FILIAL do cadastro (origem, alias ou CNPJ) e material pelo
// cadastro — o mesmo casamento da linha do tempo do painel (_mpTlMontar).
function _suCKey(c) {
  const fil = getFilialLookupIndex().exact, n = normalizeText(String(c || '').trim());
  const f = fil.get(n) || fil.get(String(c || '').replace(/\D/g, ''));
  return f ? normalizeText(f.alias || f.origem) : n;
}
const _suMKey = (m) => normalizeText(typeof normalizarMaterial === 'function' ? normalizarMaterial(String(m || '')) : String(m || ''));

// Ocorrências, DAIs e Registros indexados por central|material (uma passada).
function _suCtxAcoes() {
  const por = (arr, chaves) => { const m = new Map(); arr.forEach(x => chaves(x).forEach(k => { if (!m.has(k)) m.set(k, []); m.get(k).push(x); })); return m; };
  const itensDai = (d) => typeof _daiGetItens === 'function' ? _daiGetItens(d) : (d.itens || []);
  const regs = [...(typeof _sol !== 'undefined' ? _sol.lista : []), ..._su.coletas].filter(r => r.status !== 'excluida');
  return {
    oc: por(state.ocorrencias || [], o => [_suCKey(o.central) + '|' + _suMKey(o.material)]),
    dai: por(state.ajustesSistemicos || [], d => [...new Set(itensDai(d).map(x => _suCKey(d.central) + '|' + _suMKey(x.material)))]),
    reg: por(regs, r => [...new Set((r.itens || []).map(x => _suCKey(r.central) + '|' + _suMKey(x.material || x.grupoMaterial)))]),
    itensDai
  };
}

// Relatório do material: consumo × saldo (12 meses), outras centrais que
// usam o material (90 dias) e a linha do tempo desde o último uso.
function _suDetalhe(i, ctx) {
  const ref = _su.calc.ref, DIA = 86400000, refTs = ref.getTime(), hoje = _moDia(new Date()).getTime();
  const uso = (r) => !SU_IGNORA.has(normMov(r.movimento));
  const arr = getSapIndex().byCentralMat.get(i.central)?.get(i.material) || [];
  // Consumo do mês = saídas de uso; saldo no fim do mês = saldo de hoje menos
  // os movimentos depois do mês (mesmo filtro do saldo SAP do Analítico).
  const serie = [];
  for (let k = 11; k >= 0; k--) {
    const a = new Date(ref.getFullYear(), ref.getMonth() - k, 1), b = new Date(ref.getFullYear(), ref.getMonth() - k + 1, 1);
    serie.push({ n: a.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '') + (k === 11 || a.getMonth() === 0 ? '/' + String(a.getFullYear()).slice(2) : ''),
      a: a.getTime(), b: b.getTime(), c: 0, s: i.kg });
  }
  let ult = null;
  arr.forEach(r => {
    const ts = parseDateTs(r.dtLanc); if (ts === null) return;
    const p = num(r.peso);
    if (uso(r)) {
      const m = serie.find(x => ts >= x.a && ts < x.b); if (m) m.c -= p;
      if (ts === i.ultUso && (!ult || Math.abs(p) > Math.abs(num(ult.peso)))) ult = r;
    }
    if (getCatKeyDoCadastro(r.materialOriginal) && !isSapExcluidoPorFechamento(r)) serie.forEach(m => { if (ts >= m.b) m.s -= p; });
  });
  serie.forEach(m => { m.c = Math.max(0, m.c); delete m.a; delete m.b; });

  // Só centrais do mesmo estado (UF do cadastro de filiais — Hugo, 19/11/2026).
  const outras = [], lim = refTs - 90 * DIA, fil = getFilialLookupIndex().exact;
  const ufDe = (c) => String(fil.get(normalizeText(c))?.uf || "").toUpperCase(), uf = ufDe(i.central);
  for (const [c, mats] of getSapIndex().byCentralMat) {
    const a2 = uf && c !== i.central && ufDe(c) === uf && mats.get(i.material);
    if (!a2) continue;
    let cons = 0, u = 0;
    a2.forEach(r => { const ts = parseDateTs(r.dtLanc); if (ts === null || ts < lim || !uso(r)) return; cons -= num(r.peso); if (ts > u) u = ts; });
    if (cons > 0.5) outras.push({ central: c, regional: (fil.get(normalizeText(c))?.regional || '').trim() || '—', mes: cons / 3, ult: u });
  }
  outras.sort((a, b) => b.mes - a.mes);

  // Linha do tempo: só o que aconteceu desde o último uso (ou início da base).
  const desde = (i.ultUso ?? _su.calc.ini.getTime()) - DIA, ev = [];
  const E = (d, tipo, tit, txt, b) => { if (d != null && !isNaN(d) && d >= desde) ev.push({ d, tipo, tit, txt: String(txt || '').slice(0, 300), b: b || '' }); };
  const dia = (iso) => iso ? _moIsoParaData(String(iso).slice(0, 10))?.getTime() : null;
  if (i.semHistorico) ev.push({ d: _su.calc.ini.getTime(), tipo: 'sap', tit: 'Início da base SAP', txt: `Saldo de ${_moPeso(i.kg)} sem nenhum movimento desde o início da base. Entra como Crítico.` });
  else {
    ev.push({ d: i.ultUso, tipo: 'sap', tit: 'Último uso no SAP', txt: ult ? `Mov. ${normMov(ult.movimento)} · ${_moPeso(Math.abs(num(ult.peso)))}.` : '' });
    SU_NIVEIS.slice().reverse().forEach(([n, nv]) => { const d = i.ultUso + n * DIA; if (d <= refTs) ev.push({ d, tipo: 'nivel', tit: `Passou a ${MURAL_NIVEL[nv].label[0] + MURAL_NIVEL[nv].label.slice(1).toLowerCase()}`, txt: `${n} dias sem uso.` }); });
  }
  (typeof _varComDe === 'function' ? _varComDe(i.central, i.material) : []).forEach(r => {
    if (r.oc_id) return; // comentário de ocorrência entra como ocorrência
    const d = r.created_at ? Date.parse(r.created_at) : dia(r.data);
    const causa = typeof varComCausaDe === 'function' ? varComCausaDe(r.texto) : null;
    E(d, 'com', `Comentário · ${r.autor_nome || '—'}`, typeof _varComSemCausa === 'function' ? _varComSemCausa(r.texto) : r.texto, causa);
    const volta = _suEhCausa(causa) && _moDia(new Date(d)).getTime() + SU_REARME_DIAS * DIA;
    if (volta && volta <= hoje) E(volta, 'volta', 'Tratativa venceu', `Passaram ${SU_REARME_DIAS} dias e o material continua parado: voltou para a fila.`);
  });
  const k = _suCKey(i.central) + '|' + _suMKey(i.material);
  (ctx.oc.get(k) || []).forEach(o => {
    const n = o.numero ? ` #${o.numero}` : '';
    E(dia(o.dataAbertura), 'oc', `Ocorrência${n} aberta`, o.motivo || o.descricao);
    (o.hierarquia || []).forEach(h => E(dia(h.data), 'oc', `Ocorrência${n} escalonada${typeof OC_HIERARQUIA !== 'undefined' && OC_HIERARQUIA[h.nivel]?.label ? ' · ' + OC_HIERARQUIA[h.nivel].label : ''}`, h.motivo));
    if (o.concluida) E(dia(o.dataConclusao), 'oc', `Ocorrência${n} concluída`, o.descConclusao);
    if (o.inconclusiva) E(dia(o.dataInconclusiva), 'oc', `Ocorrência${n} inconclusiva`, o.motivoInconclusiva);
  });
  (ctx.dai.get(k) || []).forEach(d => {
    const its = ctx.itensDai(d).filter(x => _suMKey(x.material) === _suMKey(i.material));
    const peso = its.reduce((s, x) => s + (num(x.peso) || 0), 0), mov = [...new Set(its.map(x => x.tipoMovimentoSap).filter(Boolean))].join(', ');
    const quando = typeof d.dataGeracao === 'number' ? d.dataGeracao : Date.parse(d.dataGeracao);
    E(quando, 'dai', `DAI ${d.numero || ''} gerada`.replace(/\s+gerada$/, ' gerada'),
      [peso ? `Ajuste de ${_moPeso(Math.abs(peso))}` : '', mov ? `Mov. ${mov}` : '', d.descricao || ''].filter(Boolean).join(' · '));
  });
  const vistos = new Set();
  (ctx.reg.get(k) || []).forEach(r => {
    if (r.protocolo && vistos.has(r.protocolo)) return;
    vistos.add(r.protocolo);
    E(dia(r.data_ocorrido) ?? Date.parse(r.created_at), 'reg', `${r.categoria_situacao || 'Registro'}${r.protocolo ? ' ' + r.protocolo : ''}`,
      [r.motivo ? `Motivo ${r.motivo}` : '', r.status ? `Status: ${r.status}` : ''].filter(Boolean).join(' · '));
  });
  ev.sort((a, b) => a.d - b.d);
  return { serie, outras: outras.slice(0, 8), uf, ev };
}

function suSelChave(k) { _su.sel = k; muralRender(); }

// Clique numa central de "Onde este material tem uso": o modal de
// Movimentações da Visão Micro (o mesmo do Mural) para essa central × o
// material aberto, nos 90 dias do quadro.
function suMovimentacoes(k, central) {
  const it = suItens().find(i => _moChave(i) === k);
  if (!it || !central || typeof muralRaioXCalcular !== 'function') return;
  const fim = new Date(_su.calc.ref), ini = new Date(fim);
  ini.setDate(ini.getDate() - 90);
  const rx = muralRaioXCalcular(central, it.material, getCatKeyDoCadastro(it.material), { ini, fim });
  if (!rx) { toast('Não foi possível montar as movimentações.', 'error'); return; }
  window.__analiticoDetailCache = window.__analiticoDetailCache || new Map();
  window.__analiticoDetailCache.set('semuso-mov', { ...rx.payload, key: 'semuso-mov' });
  openAnaliticoDetailModal('semuso-mov');
}

// Arquivo baixado: o mesmo dashboard (módulo SUD inteiro + dados) no shell
// dos relatórios do sistema; o material abre na gaveta. Com soItem, o
// arquivo já abre no material selecionado.
async function suRelatorioExportar(btn, soItem) {
  if (btn) btn.disabled = true;
  try {
    const todos = suItensFiltrados();
    if (!_su.calc || !todos.length || typeof _dgrCssApp !== 'function') { toast('Nada para exportar nesta tela.', 'error'); return; }
    const it = soItem ? todos.find(i => _moChave(i) === _su.sel) : null;
    const D = _suDados(todos), ctx = _suCtxAcoes(), ced = { t: performance.now() };
    for (const i of todos) { D.det[_moChave(i)] = _suDetalhe(i, ctx); await muralCederTempo(ced); }
    const agora = new Date(), tema = document.body.dataset.theme || '', css = await _dgrCssApp();
    const quem = window.currentUser?.nome_exibicao || '';
    const filtros = _mpTermos().length || _muralFiltrosAtivos() ? 'com os filtros aplicados · ' : '';
    const titulo = it ? `${it.material} · ${it.central}` : 'Material sem uso';
    const slug = titulo.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const nome = `operacoes-sem-uso${it ? '-' + slug : ''}-${localISODate(agora)}.html`;
    const seguro = (t) => String(t).replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
    const corpo = `<style>.sud-arq{font-size:14px;color:var(--text)}</style><div class="sud-arq" id="sud-arq"></div>
<script>
${seguro(SUD_FONTE.toString())}
var SUD = SUD_FONTE();
document.getElementById('sud-arq').innerHTML = SUD.html(${seguro(JSON.stringify(D))}, ${JSON.stringify({ modo: 'arq', sel: it ? _moChave(it) : null })});
<\/script>`;
    const periodo = `${_suData(_su.calc.ini)} a ${_suData(_su.calc.ref)}`;
    const html = _buildRankingShellHTML({ periodoBadge: periodo, periodo, now: agora.toLocaleString('pt-BR') }, {
      pageTitle: `Operações · ${titulo}`, badge: 'Operações · Sem uso', title: titulo,
      subtitle: `${quem ? `Gerado por ${quem} · ` : ''}${filtros}${todos.length} pares parados há 60+ dias · dias contados até ${_suData(_su.calc.ref)}`,
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

Object.assign(window, { suSel, suSelChave, suMovimentacoes, suComentar, suRelatorioExportar });
