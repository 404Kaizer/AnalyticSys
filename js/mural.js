'use strict';

// ═══════════════════════════════════════════════════════════
// MURAL DE OPERAÇÕES — cálculo e foto (Fase 1, entrega B)
// ═══════════════════════════════════════════════════════════
// Cada analista importa só a(s) categoria(s) dele, então só ele consegue
// calcular a fila delas: o dono calcula no próprio navegador e publica uma
// FOTO compacta em public.mural_fotos (uma linha por dia × categoria). O ADM
// lê as fotos de todos; o analista, só as dele (RLS).
//
// Dono de cada categoria = public.analistas_categoria (o mesmo cadastro que
// já roteia as DAIs do formulário público, em Supervisão).
//
// Janela MÓVEL de 30 dias até ontem, independente do período escolhido na
// tela — senão uma variação que cresce há semanas sumiria ao trocar o filtro.
// A série é a da Visão Micro (_anSerieDiaria, analitico.js), acumulada.

const MURAL_JANELA_DIAS = 30;

// ponytail: cortes do formato da variação chutados a partir dos casos reais
// discutidos com o Hugo (06/11/2026). Calibrar com a causa de encerramento
// (Fase 2) quando houver alguns meses de histórico.
const MURAL_REGRAS = {
  degrauFracao:  0.6,  // um passo responde por ≥ 60% da variação final
  derivaFracao:  0.7,  // ≥ 70% dos passos pioram (e os 3 últimos também)
  serroteTrocas: 0.5,  // o sinal do passo troca em ≥ 50% das vezes...
                       // ...e a média da série fica dentro da faixa "bom"
  minPontos:     3
};

// Motivos de divergência PUZL × SAP que EXPLICAM variação de estoque (ver
// diagnosticarDivergenciaSapPuzl, ui.js). Os outros são ambíguos: um
// movimento no SAP sem documento na PUZL ('sem-ref-sap') pode ser
// perfeitamente real.
const MURAL_EXPLICA = new Set(['pendente', 'duplicada', 'peso', 'estornada']);

// ── Funções puras ─────────────────────────────────────────────────────────

// Janela de 30 dias terminando ONTEM. Devolve as datas (00:00) e a lista de
// dias no formato que _anSerieDiaria espera.
function muralJanela(hoje = new Date()) {
  const fim = new Date(hoje); fim.setHours(0, 0, 0, 0); fim.setDate(fim.getDate() - 1);
  const ini = new Date(fim);  ini.setDate(ini.getDate() - (MURAL_JANELA_DIAS - 1));
  const dayList = [];
  for (const d = new Date(ini); d <= fim; d.setDate(d.getDate() + 1)) dayList.push(new Date(d));
  return { ini, fim, dayList };
}

// Linhas de _anSerieDiaria → variação ACUMULADA em cada dia com lançamento.
// O diff de cada linha é desde o lançamento anterior; a soma até o dia D é a
// variação do par em D (com o carry partindo do saldo teórico do SAP).
function muralPontos(rows) {
  const pontos = [];
  let acum = 0;
  rows.forEach(r => {
    acum += r.diff || 0;
    if (r.hasLanc) pontos.push({ dt: r.dateLabel, v: acum, fim: r.finalStock });
  });
  return pontos;
}

// Formato da série acumulada (valores na ordem dos lançamentos).
//   deriva  → cresce a cada lançamento    degrau → saltou uma vez e ficou
//   herdada → salto já no 1º lançamento do mês que SE MANTEVE sem explicação
//             (ajuste do fechamento feito sobre aferição errada)
//   inicio  → salto no início que não se manteve (ou tem explicação)
//   serrote → oscila e volta (ruído)      irregular → nenhum dos anteriores
//   erro    → lançamento fisicamente impossível (capacidade)
//   poucos  → menos de 3 lançamentos na janela
function muralFormato(valores, catKey, thresholds, { capErro = false } = {}) {
  if (capErro) return { formato: 'erro', piorando: false };
  const n = valores.length;
  if (n < MURAL_REGRAS.minPontos) return { formato: 'poucos', piorando: false };
  const vn = valores[n - 1];
  const s  = Math.sign(vn) || 1;
  // O primeiro passo parte de zero: um salto antes do 1º lançamento conta.
  const passos = valores.map((v, i) => v - (i ? valores[i - 1] : 0));
  const piores = passos.filter(d => d * s > 0);
  const ult3   = passos.slice(-3).every(d => d * s > 0);
  let trocas = 0;
  for (let i = 1; i < passos.length; i++) {
    if (Math.sign(passos[i]) && Math.sign(passos[i - 1]) && Math.sign(passos[i]) !== Math.sign(passos[i - 1])) trocas++;
  }
  const media = valores.reduce((a, b) => a + b, 0) / n;
  if (trocas >= MURAL_REGRAS.serroteTrocas * (passos.length - 1)
      && classifyVariation(Math.abs(media), catKey, thresholds) === 'bom') {
    return { formato: 'serrote', piorando: false };
  }
  const maiorPior = Math.max(0, ...piores.map(d => Math.abs(d)));
  if (maiorPior >= MURAL_REGRAS.degrauFracao * Math.abs(vn)) {
    // O maior salto é o INICIAL (do começo do trecho ao 1º lançamento).
    //   herdada → e a diferença SE MANTEVE nos lançamentos seguintes: o ajuste
    //             do fechamento anterior foi feito sobre uma aferição errada
    //             (ex.: lançou 50 t no último dia, ajustamos, no dia seguinte
    //             mediu 25 t e assim ficou). Hugo, 09/11/2026.
    //   inicio  → não se manteve: algo nos primeiros dias, ou Custos SAP do
    //             mês anterior importado antes do ajuste.
    // ponytail: tolerância = metade da faixa "bom" ou 15% do 1º valor.
    if (passos[0] * s > 0 && Math.abs(passos[0]) >= maiorPior) {
      const tol = Math.max((thresholds[catKey]?.bom || 0) * 0.5, Math.abs(valores[0]) * 0.15);
      const manteve = valores.slice(1).every(v => Math.abs(v - valores[0]) <= tol);
      return { formato: manteve ? 'herdada' : 'inicio', piorando: ult3 };
    }
    return { formato: 'degrau', piorando: ult3 };
  }
  if (piores.length >= MURAL_REGRAS.derivaFracao * passos.length && ult3) return { formato: 'deriva', piorando: true };
  return { formato: 'irregular', piorando: ult3 };
}

// Data de entrada na fila: o lançamento mais antigo a partir do qual a
// variação não voltou mais para "bom". null = está dentro da faixa hoje.
// desdeInicio = já estava fora no 1º lançamento da janela (há 30+ dias).
function muralEntradaFila(pontos, catKey, thresholds) {
  let j = pontos.length;
  while (j > 0 && classifyVariation(Math.abs(pontos[j - 1].v), catKey, thresholds) !== 'bom') j--;
  if (j === pontos.length) return null;
  return { dt: pontos[j].dt, desdeInicio: j === 0 };
}

// Efeito de um motivo de divergência na VARIAÇÃO do estoque. O diagnóstico
// mede SAP − PUZL em grandeza por lado: entrada a mais no SAP (ex.: NF
// duplicada) sobe o teórico → desfalque; saída a menos no SAP (OS pendente)
// também sobe o teórico → desfalque.
function muralEfeitoDivergencia(lado, kg) {
  return lado === 'ent' ? -kg : kg;
}

const _r1 = v => Math.round(v * 10) / 10;

// ── Cálculo de um par (lê o state; sem DOM) ────────────────────────────────
// lancsJan/sapJan: registros do par JÁ recortados na janela (SAP sem os
// excluídos por fechamento). Devolve { item } (fora da faixa), { bom: true },
// ou { pontoCego: 'semAncora' | 'semLancamento' }.
function muralAvaliarPar({ central, mat, catKey, categoria, janela, lancsJan, sapJan, thresholds, ctx }) {
  const prev = _anGetSapStock({ central, material: mat, dtIni: janela.ini });
  if (!prev) return { pontoCego: 'semAncora' };
  if (!lancsJan.length) return { pontoCego: 'semLancamento' };

  const isSemanal = isCatKeySemanal(catKey);
  const rows = _anSerieDiaria({
    dayList: janela.dayList, lancsMat: lancsJan, sapMat: sapJan,
    preCarry: { value: prev.value, date: prev.date }, isSemanal
  });
  const pontos = muralPontos(rows);
  if (!pontos.length) return { pontoCego: 'semLancamento' };
  const ult = pontos[pontos.length - 1];
  const v30 = ult.v;

  // ── Variação ATUAL (principal) × acumulado de 30 dias (secundário) ──────
  // Hugo, 09/11/2026: a janela de 30 dias atravessa o fechamento, e a
  // diferença do mês anterior já foi ajustada nele (Y11/Y12 — que a série
  // do período não soma, como a Micro). A variação que manda (nível, fila,
  // prazo, prioridade) é a do MÊS EM ABERTO: parte do saldo do SAP no dia 1,
  // que já inclui o ajuste do fechamento — mesma conta da Micro em "Mês
  // atual". Os 30 dias ficam como informação e no gráfico. Sem lançamento
  // no mês ainda (começo de mês, Agregado semanal): usa os 30 dias, marcado.
  const mesIni = new Date(janela.fim.getFullYear(), janela.fim.getMonth(), 1);
  const noMes = (dt) => { const d = parseDate(dt); return d && d >= mesIni; };
  let base = { anc: prev, desde: janela.ini, pontos }, atual = mesIni <= janela.ini;
  if (!atual) {
    const ancMes = _anGetSapStock({ central, material: mat, dtIni: mesIni });
    const lancsMes = lancsJan.filter(l => noMes(l.dtLanc));
    if (ancMes && lancsMes.length) {
      const pMes = muralPontos(_anSerieDiaria({
        dayList: janela.dayList.filter(d => d >= mesIni), lancsMat: lancsMes, sapMat: sapJan.filter(s => noMes(s.dtLanc)),
        preCarry: { value: ancMes.value, date: ancMes.date }, isSemanal
      }));
      if (pMes.length) { base = { anc: ancMes, desde: mesIni, pontos: pMes }; atual = true; }
    }
  }
  const ultP = base.pontos[base.pontos.length - 1];
  const v = ultP.v;
  const nivel = classifyVariation(Math.abs(v), catKey, thresholds);
  // Na faixa: vai para a aba "Na faixa" do Mural, em formato compacto
  // [central, material, variação atual, regional, último lançamento, 30 dias].
  if (nivel === 'bom') {
    const fil = getFilialLookupIndex().exact.get(normalizeText(central));
    return { bom: true, faixa: [central, mat, _r1(v), (fil?.regional || '').trim() || '—', ultP.dt, _r1(v30)] };
  }

  // Cascata até o último lançamento — fecha com a variação atual por
  // construção da série (âncora e movimentos do mesmo trecho).
  const dtUlt  = parseDate(ultP.dt);
  const sapAte = sapJan.filter(s => { const d = parseDate(s.dtLanc); return d && d >= base.desde && d <= dtUlt; });
  const nat    = repartirSapPorNatureza(sapAte);
  const cascata = {
    ini: _r1(base.anc.value), ent: _r1(nat.totalEnt), sai: _r1(nat.totalSai), aju: _r1(nat.totalAju),
    teo: _r1(base.anc.value + nat.totalEnt + nat.totalSai + nat.totalAju), fim: _r1(ultP.fim)
  };

  // Parte explicada: divergência PUZL × SAP do par, no mesmo trecho da
  // variação atual (mesma reconciliação por referência da Visão Micro).
  const naJanela = (dt) => { const d = parseDate(dt); return d && d >= base.desde && d <= dtUlt; };
  const puzlEnt = (ctx.entradasPorCentral.get(central) || []).filter(e => e.material === mat && naJanela(e.dtDescarga || e.dtEmissao));
  const puzlSai = (ctx.saidasPorCentral.get(central)   || []).filter(s => s.material === mat && naJanela(s.dtEmissao));
  const explic = [];
  [['ent', nat.entRecords, puzlEnt], ['sai', nat.saiRecords, puzlSai]].forEach(([lado, sapRecords, puzlRecords]) => {
    const diag = diagnosticarDivergenciaSapPuzl({ sapRecords, puzlRecords, lado, material: mat });
    diag.motivos.forEach(m => {
      if (!MURAL_EXPLICA.has(m.chave) || Math.abs(m.kg) < 0.01) return;
      explic.push({ chave: m.chave, lado, n: m.count, t: m.curto, kg: _r1(muralEfeitoDivergencia(lado, m.kg)) });
    });
  });
  const explicadoKg = _r1(explic.reduce((s, e) => s + e.kg, 0));

  const capErro = typeof classificarEstoqueCapacidade === 'function'
    && classificarEstoqueCapacidade(central, mat, ultP.fim).faixa === 'erro';
  // Formato e entrada na fila seguem a variação ATUAL (o que vai ao próximo
  // fechamento). O fechamento SEMPRE ajusta a variação (Hugo, 09/11/2026):
  // um salto já no 1º lançamento do mês aconteceu nos primeiros dias, ou o
  // Custos SAP do mês anterior foi importado antes do ajuste — não é
  // "variação não ajustada".
  let { formato, piorando } = muralFormato(base.pontos.map(p => p.v), catKey, thresholds, { capErro });
  // Herdada só no trecho do MÊS (depois de um fechamento) e sem explicação:
  // se pendência/divergência cobre metade do 1º salto, a causa é outra.
  if (formato === 'herdada' && (!atual || Math.abs(explicadoKg) >= 0.5 * Math.abs(base.pontos[0].v))) formato = 'inicio';
  const entrada = muralEntradaFila(base.pontos, catKey, thresholds);

  // Reincidência: meses civis anteriores seguidos com o mesmo sinal fora da
  // faixa. Só para quem já está na fila (é a parte cara).
  let meses = 1;
  for (let k = 0; k < 3; k++) {
    const ref = new Date(janela.fim.getFullYear(), janela.fim.getMonth() - k, 1);
    const ant = _anGetVarMesAnterior(central, mat, ref);
    if (!ant || Math.sign(ant.diff) !== Math.sign(v)
        || classifyVariation(Math.abs(ant.diff), catKey, thresholds) === 'bom') break;
    meses++;
  }

  const codSap = getCodSapPorGrupo(mat);
  const custo  = codSap
    ? getCustoMedioCustosSap(central, codSap, janela.fim.getFullYear(), janela.fim.getMonth() + 1, _anGetCustosSapIdx())
    : null;
  const custoMed = custo ? custo.valor : 0;
  const filial = getFilialLookupIndex().exact.get(normalizeText(central));

  return { item: {
    central, material: mat, categoria, catKey, codSap: codSap || '',
    regional: (filial?.regional || '').trim() || '—',
    nivel, formato, piorando, v: _r1(v), custoMed, rs: _r1(v * custoMed),
    // v = variação ATUAL (principal); v30 = acumulado dos 30 dias. atual=false
    // quando ainda não há lançamento no mês (v = 30 dias). desde = início do
    // trecho da variação principal; primeiroMes = 1º ponto desse trecho.
    v30: _r1(v30), rs30: _r1(v30 * custoMed), atual, desde: fmtPtDate(base.desde),
    primeiroMes: [base.pontos[0].dt, _r1(base.pontos[0].v)],
    explicadoKg, explic,
    pontos: pontos.map(p => [p.dt, _r1(p.v)]),
    cascata, entrada, meses, capErro
  } };
}

// ── Cálculo das categorias do dono ─────────────────────────────────────────
// categorias: rótulos de CATEGORIAS_MATERIAL. Devolve { porCategoria:
// { [categoria]: { itens, pontosCegos } }, base, janela }.
async function muralCalcular(categorias) {
  const alvo = new Set(categorias.map(normalizeCategoriaMaterial).filter(Boolean));
  const janela = muralJanela();
  const thresholds = getHealthThresholds();
  const emJanela = (dt) => { const d = parseDate(dt); return d && d >= janela.ini && d <= janela.fim; };

  // Categoria pelo CADASTRO via materialOriginal (como o Gerencial), não pelo
  // nome padronizado — ver _dgVgBuildPares.
  const catDe = (rec) => normalizeCategoriaMaterial(getCategoriaPorGrupo(rec.materialOriginal || rec.material));

  // PUZL agrupada por central uma vez só (centralDestino primeiro, como o
  // diagnóstico da Visão Micro).
  const entradasPorCentral = new Map();
  (state.entradas || []).forEach(e => {
    const c = e.centralDestino || e.centralCompra || '';
    if (!entradasPorCentral.has(c)) entradasPorCentral.set(c, []);
    entradasPorCentral.get(c).push(e);
  });
  ensureSaidasIndex();
  const ctx = { entradasPorCentral, saidasPorCentral: _saidasByCentral };

  // Universo: todo par central × material com lançamento OU SAP na janela.
  const pares = new Map(); // `${central}|||${mat}` -> { central, mat, lancs, sap, categoria, catKey }
  const semCadastro = new Set();
  const addPar = (central, mat, rec) => {
    const k = central + '|||' + mat;
    if (!pares.has(k)) {
      const categoria = catDe(rec);
      if (!categoria) { semCadastro.add(rec.materialOriginal || mat); }
      pares.set(k, { central, mat, categoria, catKey: categoria ? getCatKeyDoCadastro(rec.materialOriginal || rec.material) : null, lancs: [], sap: [] });
    }
    return pares.get(k);
  };
  for (const [central, porMat] of getLancIndex().byCentralMat) {
    for (const [mat, arr] of porMat) {
      arr.forEach(r => { if (emJanela(r.dtLanc)) addPar(central, mat, r).lancs.push(r); });
    }
  }
  await yieldToUI();
  for (const [central, porMat] of getSapIndex().byCentralMat) {
    for (const [mat, arr] of porMat) {
      arr.forEach(r => { if (emJanela(r.dtLanc) && !isSapExcluidoPorFechamento(r)) addPar(central, mat, r).sap.push(r); });
    }
  }
  await yieldToUI();

  const porCategoria = {};
  [...alvo].forEach(c => { porCategoria[c] = { itens: [], faixa: [], pontosCegos: { semAncora: [], semLancamento: [] }, lancDesde: null }; });
  let n = 0;
  for (const p of pares.values()) {
    if (!p.categoria || !alvo.has(p.categoria) || !p.catKey) continue;
    // Primeiro lançamento da janela na base do dono: se começa tarde, a
    // parte "herdada" mistura diferença antiga com o período sem lançamento.
    p.lancs.forEach(l => {
      const d = parseDate(l.dtLanc);
      if (d && (!porCategoria[p.categoria].lancDesde || d < porCategoria[p.categoria].lancDesde)) porCategoria[p.categoria].lancDesde = d;
    });
    const res = muralAvaliarPar({ central: p.central, mat: p.mat, catKey: p.catKey, categoria: p.categoria,
      janela, lancsJan: p.lancs, sapJan: p.sap, thresholds, ctx });
    const dest = porCategoria[p.categoria];
    if (res.item) dest.itens.push(res.item);
    else if (res.faixa) dest.faixa.push(res.faixa);
    else if (res.pontoCego) dest.pontosCegos[res.pontoCego].push(`${p.central} · ${p.mat}`);
    if (++n % 25 === 0) await yieldToUI();
  }

  return {
    janela: { ini: fmtPtDate(janela.ini), fim: fmtPtDate(janela.fim) },
    base: muralDataBase(),
    semCadastro: [...semCadastro].sort().slice(0, 50),
    semCadastroTotal: semCadastro.size,
    porCategoria
  };
}

// Até quando vai cada módulo importado — o "frescor" da base do dono.
function muralDataBase() {
  const maxData = (arr, campo) => {
    let max = null;
    (arr || []).forEach(r => {
      const d = parseDate(typeof campo === 'function' ? campo(r) : r[campo]);
      if (d && (!max || d > max)) max = d;
    });
    return max ? fmtPtDate(max) : null;
  };
  return {
    sap:         maxData(state.sap, 'dtLanc'),
    lancamentos: maxData(state.lancamentos, 'dtLanc'),
    entradas:    maxData(state.entradas, r => r.dtDescarga || r.dtEmissao),
    saidas:      maxData(state.saidas, 'dtEmissao')
  };
}

// ── Publicação ─────────────────────────────────────────────────────────────
let _muralMinhasCats = null;
async function _muralMinhasCategorias() {
  if (_muralMinhasCats) return _muralMinhasCats;
  const uid = window.currentUser?.id;
  if (!uid || !window.supabaseClient) return [];
  const { data, error } = await window.supabaseClient
    .from('analistas_categoria').select('categoria').eq('analista_user_id', uid);
  if (error) { console.warn('[Mural] Donos por categoria:', error.message); return []; }
  _muralMinhasCats = (data || []).map(r => r.categoria);
  return _muralMinhasCats;
}

// Hash curto (FNV-1a) só para não regravar a mesma foto a cada boot.
function _muralHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

async function muralPublicar({ forcar = false } = {}) {
  const uid = window.currentUser?.id;
  if (!uid || !window.supabaseClient || !Array.isArray(state.lancamentos) || !state.lancamentos.length) return;
  const cats = await _muralMinhasCategorias();
  if (!cats.length) return; // não é dono de categoria (ex.: ADM)

  const t0 = performance.now();
  const calc = await muralCalcular(cats);
  const dia  = localISODate(new Date());
  for (const categoria of Object.keys(calc.porCategoria)) {
    const { itens, faixa, pontosCegos, lancDesde } = calc.porCategoria[categoria];
    const payload = {
      versao: 1, janela: calc.janela,
      base: { ...calc.base, lancamentosDesde: lancDesde ? fmtPtDate(lancDesde) : null },
      itens,
      faixa, // [central, material, variação, regional, último lançamento]
      pontosCegos: {
        semAncora:     { total: pontosCegos.semAncora.length,     exemplos: pontosCegos.semAncora.slice(0, 30) },
        semLancamento: { total: pontosCegos.semLancamento.length, exemplos: pontosCegos.semLancamento.slice(0, 30) },
        semCadastro:   { total: calc.semCadastroTotal,            exemplos: calc.semCadastro.slice(0, 30) }
      }
    };
    const hash = _muralHash(JSON.stringify(payload));
    const chaveLocal = `muralHash|${uid}|${dia}|${categoria}`;
    let anterior = null;
    try { anterior = localStorage.getItem(chaveLocal); } catch (_) { /* sem storage */ }
    if (!forcar && anterior === hash) continue;
    const { error } = await window.supabaseClient.from('mural_fotos').upsert(
      { dia, categoria, payload, hash, gerado_por: uid, gerado_em: new Date().toISOString() },
      { onConflict: 'dia,categoria' }
    );
    if (error) { console.warn('[Mural] Falha ao publicar', categoria, error.message); continue; }
    try { localStorage.setItem(chaveLocal, hash); } catch (_) { /* sem storage */ }
  }
  console.info(`[Mural] Foto calculada em ${Math.round(performance.now() - t0)} ms`);
  // A aba Operações do próprio dono passa a mostrar a foto nova.
  if (document.getElementById('mural-root') && typeof muralRecarregar === 'function') muralRecarregar();
}

// Atualizar do Dashboard Analítico (rodarAnalitico): o dono recalcula e
// publica a própria foto (que recarrega a tela no fim); o ADM e quem não é
// dono de categoria só releem as fotos.
async function muralAtualizar() {
  try {
    const cats = await _muralMinhasCategorias();
    if (cats.length && state.lancamentos?.length) await muralPublicar();
    else await muralRecarregar();
  } catch (err) { console.warn('[Mural] Erro ao atualizar:', err); }
}

// Debounce + ocioso: roda depois do boot e de cada importação, fora do
// caminho crítico (nunca dentro do overlay de carregamento).
let _muralTimer = null;
function muralAgendarPublicacao() {
  clearTimeout(_muralTimer);
  _muralTimer = setTimeout(() => {
    const go = () => muralPublicar().catch(err => console.warn('[Mural] Erro ao calcular a foto:', err));
    if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 15000 });
    else go();
  }, 3000);
}

// ═══════════════════════════════════════════════════════════
// TELA "OPERAÇÕES" (Fase 1, entrega C)
// ═══════════════════════════════════════════════════════════
// Lê as fotos (a última e a anterior de cada categoria) e deriva na hora
// tudo o que depende de ação humana: prazo, sem ação, escalonamento e
// prioridade. Nada disso é gravado — muda sozinho quando alguém comenta ou
// abre ocorrência (variacao_comentarios / ocorrencias).
//
// Regras confirmadas com o Hugo (06/11/2026):
//   prazo para o dono agir: Crítico 2 · Urgente 5 · Atenção 10 dias;
//   comentário renova o prazo UMA vez; Crítico só sai com ocorrência;
//   prazo vencido ou ocorrência aberta com a variação crescendo → escalonado
//   ao ADM (que é o Supervisor).

const MURAL_PRAZO = { critico: 2, urgente: 5, atencao: 10 };
const MURAL_GRAV  = { critico: 6, urgente: 3, atencao: 1, bom: 0 };
// Tendência pesa a ORDEM da fila, não tira ninguém dela: tudo acima do limite
// é tratado antes do fechamento (Hugo, 09/11/2026) — Serrote inclusive.
const MURAL_TEND  = { deriva: 1.5, degrau: 1, herdada: 1, inicio: 1, serrote: 0.4, irregular: 1, poucos: 1, erro: 1.3 };
// Impacto na prioridade: o financeiro pesa mais (equilibra as categorias —
// 1 kg de aditivo vale muito mais que 1 kg de areia), o físico entra junto
// (Hugo, 09/11/2026). Financeiro = log10(R$); físico = log2(1 + vezes o
// limite Crítico da categoria). ponytail: pesos a calibrar com o uso.
// reincidencia: a parte do acumulado de 30 dias ANTERIOR ao mês, quando vai
// no mesmo sentido da variação atual (Hugo, 09/11/2026: "se for reincidente,
// mesmo sinal, o peso é maior") — log2(1 + vezes o limite Crítico).
const MURAL_PESO_IMPACTO = { financeiro: 1, fisico: 0.5, reincidencia: 1 };
const MURAL_NIVEL = {
  critico: { label: 'CRÍTICO', cor: 'var(--red)',     icon: 'ti-flame' },
  urgente: { label: 'URGENTE', cor: 'var(--urgente)', icon: 'ti-alert-circle' },
  atencao: { label: 'ATENÇÃO', cor: 'var(--amber)',   icon: 'ti-alert-triangle' }
};
const MURAL_FORMATO_LABEL = {
  deriva: 'Deriva', degrau: 'Degrau', herdada: 'Herdada', inicio: 'Salto no início', serrote: 'Serrote', irregular: 'Irregular',
  poucos: 'Poucos lançamentos', erro: 'Provável erro de lançamento'
};
const MURAL_FORMATO_DESC = {
  deriva: 'cresce a cada lançamento', degrau: 'saltou uma vez dentro da janela e ficou',
  herdada: 'a diferença apareceu no 1º lançamento do mês e se manteve sem explicação: provável aferição errada usada no ajuste do fechamento anterior — confira com o operador a medição do último dia do mês',
  inicio: 'a maior parte já aparece no 1º lançamento do mês e depois mudou: veja os primeiros dias do mês e confira se o Custos SAP do mês anterior já traz o ajuste do fechamento',
  serrote: 'oscila e volta: confira cubagem e horário do lançamento',
  irregular: 'sobe e desce sem padrão', poucos: 'menos de 3 lançamentos na janela', erro: 'lançamento acima da capacidade física'
};
const MURAL_STATUS = {
  novo:        { label: 'Novo',              cor: 'var(--accent)' },
  semAcao:     { label: 'Sem ação',          cor: 'var(--urgente)' },
  tratamento:  { label: 'Em tratamento',     cor: 'var(--purple)' },
  escalonado:  { label: 'Escalonado ao ADM', cor: 'var(--red)' }
};

// Prazo final de tudo: o fechamento (último dia útil do mês). Passado o do
// mês corrente, vale o do próximo.
function _muralFechamento(hoje) {
  const ult = (a, m) => { const d = new Date(a, m + 1, 0); while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1); d.setHours(0, 0, 0, 0); return d; };
  const f = ult(hoje.getFullYear(), hoje.getMonth());
  return hoje > f ? ult(hoje.getFullYear(), hoje.getMonth() + 1) : f;
}

const _mo = { carregado: false, carregando: false, erro: null, fotos: [], donos: [], avocacoes: [], avocDisponivel: false,
  filtro: 'todos', ordem: 'prio', ids: null, idsLabel: '', auditoria: null, aba: 'fila' };

const _moDia = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const _moDiasEntre = (a, b) => Math.round((_moDia(b) - _moDia(a)) / 86400000);
const _moIsoParaData = (iso) => iso ? new Date(String(iso).slice(0, 10) + 'T00:00:00') : null;
const _moKg = (v) => (v < -0.05 ? '−' : v > 0.05 ? '+' : '') + Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' kg';
const _moRs = (v) => (v < -0.5 ? '−' : v > 0.5 ? '+' : '') + 'R$ ' + Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const _moEsc = (s) => escapeHtml(String(s ?? ''));
const _moEhAdm = () => window.currentUser?.role === 'admin';
const _moChave = (i) => i.central + '|' + i.material;
const _moRsResidual = (i) => Math.abs(i.residual * (i.custoMed || 0));
// O FÍSICO manda (Hugo, 09/11/2026); R$ fica como informação secundária.
const _moKgResidual = (i) => Math.abs(i.residual || 0);
// Totais em toneladas a partir de 10 t, como o Gerencial; abaixo, em kg.
const _moPeso = (kg) => Math.abs(kg) >= 10000
  ? (kg / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' t'
  : kg.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' kg';
const _moPesoSinal = (kg) => (kg < -0.05 ? '−' : kg > 0.05 ? '+' : '') + _moPeso(Math.abs(kg));

// ── Leitura das fotos ──────────────────────────────────────────────────────
// Duas consultas: primeiro só (dia, categoria) dos últimos 10 dias, depois o
// payload apenas da última e da penúltima foto de cada categoria — o ADM não
// baixa dez dias de payload à toa.
async function _muralCarregarFotos() {
  const sb = window.supabaseClient;
  const desde = new Date(); desde.setDate(desde.getDate() - 10);
  const { data: idx, error: e1 } = await sb.from('mural_fotos')
    .select('dia, categoria').gte('dia', localISODate(desde)).order('dia', { ascending: false });
  if (e1) throw new Error(e1.message);
  const porCat = new Map();
  (idx || []).forEach(r => {
    if (!porCat.has(r.categoria)) porCat.set(r.categoria, []);
    if (porCat.get(r.categoria).length < 2) porCat.get(r.categoria).push(r.dia);
  });
  if (!porCat.size) return [];
  const dias = [...new Set([...porCat.values()].flat())];
  const { data, error: e2 } = await sb.from('mural_fotos')
    .select('dia, categoria, payload, gerado_por, gerado_em')
    .in('dia', dias).in('categoria', [...porCat.keys()]);
  if (e2) throw new Error(e2.message);
  const fotos = [];
  porCat.forEach((ds, categoria) => {
    const achar = d => (data || []).find(r => r.categoria === categoria && r.dia === d) || null;
    const atual = achar(ds[0]);
    if (atual) fotos.push({ categoria, atual, anterior: ds[1] ? achar(ds[1]) : null });
  });
  return fotos;
}

async function _muralCarregarDonos() {
  const { data, error } = await window.supabaseClient
    .from('analistas_categoria').select('categoria, analista_user_id, analista_nome');
  if (error) throw new Error(error.message);
  return data || [];
}

// Avocações ativas (o ADM assumiu o item no lugar do dono). Se a tabela
// ainda não existir no banco, o recurso fica oculto — o resto do Mural
// segue funcionando.
async function _muralCarregarAvocacoes() {
  const { data, error } = await window.supabaseClient.from('mural_avocacoes')
    .select('id, central, material, categoria, motivo, obs, avocado_em').is('devolvido_em', null);
  if (error) { _mo.avocDisponivel = false; return []; }
  _mo.avocDisponivel = true;
  return data || [];
}

async function muralRecarregar() {
  if (_mo.carregando || !window.supabaseClient) return;
  _mo.carregando = true; _mo.erro = null;
  muralRender();
  try {
    const [fotos, donos, avocacoes] = await Promise.all([_muralCarregarFotos(), _muralCarregarDonos(), _muralCarregarAvocacoes()]);
    _mo.fotos = fotos; _mo.donos = donos; _mo.avocacoes = avocacoes; _mo.carregado = true;
    _muralAvisos();
  } catch (err) {
    _mo.erro = err.message || String(err);
  } finally {
    _mo.carregando = false;
    muralRender();
  }
}

// ── Avisos no sino ─────────────────────────────────────────────────────────
// Só o que pede ação e só quando o quadro muda (o id leva o dia e a
// contagem — ver notifSyncMural). O analista recebe os da própria fila
// (a RLS já só entrega as fotos dele); o ADM, os de todos + foto atrasada.
function _muralAvisos() {
  if (typeof notifSyncMural !== 'function') return;
  const itens = muralItensDerivados();
  const hoje = _moDia(new Date()), dia = localISODate(hoje);
  const av = [];
  const add = (chave, n, level, title, body, filtro) => { if (n) av.push({ id: `mural-${chave}-${dia}-${n}`, level, title, body, filtro }); };
  const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;
  const esc = itens.filter(i => i.status === 'escalonado');
  add('escalonados', esc.length, 'critico', `Mural: ${plural(esc.length, 'item escalonado', 'itens escalonados')} ao ADM`,
    'Prazo vencido sem ocorrência, ou ocorrência aberta com a variação ainda crescendo.', 'vencido');
  const vence = itens.filter(i => !i.temOc && !i.vencido && _moDiasEntre(hoje, i.limite) <= 1);
  add('vence', vence.length, 'atencao', `Mural: ${plural(vence.length, 'prazo vence', 'prazos vencem')} até amanhã`,
    'Comente a causa ou abra a ocorrência para não escalonar.', 'semtrat');
  const novosCrit = itens.filter(i => i.novo && i.nivel === 'critico');
  add('novos', novosCrit.length, 'atencao', `Mural: ${plural(novosCrit.length, 'novo item crítico', 'novos itens críticos')}`,
    'Entraram na fila desde a foto anterior.', null);
  const fech = _muralFechamento(hoje), dFech = _moDiasEntre(hoje, fech);
  const semTrat = itens.filter(i => i.semTratamento).length;
  if (dFech <= 5) add('fechamento', semTrat, 'critico', `Fechamento em ${dFech} dia${dFech === 1 ? '' : 's'}: ${plural(semTrat, 'item sem tratamento', 'itens sem tratamento')}`,
    'Tudo acima do limite precisa ter a causa comentada ou ocorrência aberta antes do fechamento.', 'semtrat');
  const avoc = itens.filter(i => i.avocado);
  if (!_moEhAdm()) add('avocados', avoc.length, 'atencao', `Mural: ${plural(avoc.length, 'item seu foi avocado', 'itens seus foram avocados')} pelo ADM`,
    avoc.map(i => `${i.material} · ${i.central}: ${i.avocado.motivo}`).slice(0, 3).join('; '), 'avocados');
  if (_moEhAdm()) {
    const atrasadas = _mo.donos.filter(d => { const f = _mo.fotos.find(x => x.categoria === d.categoria); return !f || _moDiasEntre(_moIsoParaData(f.atual.dia), hoje) > 1; });
    add('fotos', atrasadas.length, 'atencao', `Mural: ${plural(atrasadas.length, 'categoria sem foto recente', 'categorias sem foto recente')}`,
      atrasadas.map(d => d.categoria).join(', ') + ' — a fila dessa(s) categoria(s) pode estar desatualizada.', null);
  }
  notifSyncMural(av);
}

// ── Itens com o estado de ação derivado ───────────────────────────────────
function _muralDonoDe(categoria) {
  const d = _mo.donos.find(x => x.categoria === categoria);
  return { uid: d?.analista_user_id || null, nome: (d?.analista_nome || '—').trim() };
}

// Ações registradas no par a partir de uma data: comentários (de qualquer
// pessoa — o ADM também conta) e ocorrências em aberto. O analista só
// enxerga as próprias ocorrências (RLS), mas a ocorrência aberta pelo modal
// de comentário deixa rastro em variacao_comentarios (oc_id), visível a todos.
function _muralAcoes(central, material, desde) {
  const coms = (typeof _varComDe === 'function' ? _varComDe(central, material) : [])
    .map(r => ({ ...r, quando: r.created_at ? new Date(r.created_at) : _moIsoParaData(r.data) }))
    .filter(r => r.quando && _moDia(r.quando) >= desde);
  const comentarios = coms.filter(r => !r.oc_id).map(r => r.quando).sort((a, b) => a - b);
  const ultCom = coms.filter(r => !r.oc_id).sort((a, b) => b.quando - a.quando)[0];
  const causa = ultCom && typeof varComCausaDe === 'function' ? varComCausaDe(ultCom.texto) : null;
  const ocs = (Array.isArray(state.ocorrencias) ? state.ocorrencias : [])
    .filter(o => o.central === central && o.material === material && !o.concluida
              && _moIsoParaData(o.dataAbertura) && _moIsoParaData(o.dataAbertura) >= desde)
    .map(o => ({ numero: o.numero || o.id, quando: _moIsoParaData(o.dataAbertura), limite: _moIsoParaData(o.dataLimite) }));
  coms.filter(r => r.oc_id).forEach(r => {
    const num = r.oc_numero || r.oc_id;
    if (!ocs.some(o => o.numero === num)) ocs.push({ numero: num, quando: r.quando });
  });
  ocs.sort((a, b) => a.quando - b.quando);
  return { comentarios, ocs, causa };
}

function _muralValorEm(pontos, data) {
  let v = null;
  pontos.forEach(([dt, val]) => { const d = parseDate(dt); if (d && d <= data) v = val; });
  return v;
}

function muralItensDerivados() {
  const hoje = _moDia(new Date());
  const thresholds = getHealthThresholds();
  const fechamento = _muralFechamento(hoje);
  const itens = [];
  _mo.fotos.forEach(f => {
    const p = f.atual.payload || {};
    const janelaIni = parseDate(p.janela?.ini) || hoje;
    const anteriores = new Map(((f.anterior?.payload?.itens) || []).map(i => [_moChave(i), i]));
    const dono = _muralDonoDe(f.categoria);
    (p.itens || []).forEach(it => {
      // Início do trecho da variação principal (dia 1 do mês, ou a janela de
      // 30 dias nas fotos antigas / sem lançamento no mês).
      const inicioTrecho = parseDate(it.desde) || janelaIni;
      const entrada = it.entrada && !it.entrada.desdeInicio ? (parseDate(it.entrada.dt) || inicioTrecho) : inicioTrecho;
      const { comentarios, ocs, causa } = _muralAcoes(it.central, it.material, entrada);
      const prazoDias = MURAL_PRAZO[it.nivel] || 10;
      // Comentário renova o prazo uma vez (conta só o primeiro); Crítico só
      // sai com ocorrência.
      const base = (it.nivel !== 'critico' && comentarios.length) ? comentarios[0] : entrada;
      let limite = _moDia(base); limite.setDate(limite.getDate() + prazoDias);
      // Nunca depois do fechamento: tudo acima do limite é tratado antes dele.
      const limitadoPeloFechamento = limite > fechamento;
      if (limitadoPeloFechamento) limite = new Date(fechamento);
      const temOc = ocs.length > 0;
      const semTratamento = !temOc && !comentarios.length;
      const ultAcao = [...comentarios, ...ocs.map(o => o.quando)].sort((a, b) => b - a)[0] || null;
      const diasSemAcao = Math.max(0, _moDiasEntre(ultAcao || entrada, hoje));
      const vencido = !temOc && hoje > limite;
      // Herdada × nova: o que já existia no 1º lançamento da janela e o que
      // mudou dentro dela. Só tem sentido quando o 1º ponto vai no mesmo
      // sentido da variação atual.
      // Fotos novas: 1º ponto do MÊS (o que já aparece do dia 1 até o 1º
      // lançamento); fotos antigas: 1º ponto da janela.
      const prim = it.primeiroMes || (it.pontos && it.pontos[0]) || null;
      const ultDt = it.pontos?.length ? it.pontos[it.pontos.length - 1][0] : null;
      const p0 = prim ? prim[1] : 0;
      const herdadaKg = (prim && prim[0] !== ultDt && Math.sign(p0) === Math.sign(it.v)) ? p0 : 0;
      let ocCrescendo = false;
      if (temOc) {
        const vAbertura = _muralValorEm(it.pontos || [], ocs[0].quando);
        ocCrescendo = vAbertura != null && Math.abs(it.v) > Math.abs(vAbertura) * 1.1;
      }
      const ant = anteriores.get(_moChave(it));
      const novo = !ant && !!f.anterior;
      const piorou = !!ant && Math.abs(it.v) > Math.abs(ant.v) + 0.01 && (MURAL_GRAV[it.nivel] > MURAL_GRAV[ant.nivel] || it.piorando);
      const residual = it.v - (it.explicadoKg || 0);
      // Físico normalizado pela categoria: quantas vezes a variação passa do
      // limite Crítico (600 kg de aditivo pesa como 26 t de cimento, não
      // como 600 kg de areia).
      const limCritico = thresholds[it.catKey]?.urgente || 0;
      const vezesLimite = limCritico ? Math.abs(it.v) / limCritico : 0;
      // Reincidência pelo acumulado: o trecho dos 30 dias antes do mês (v30 −
      // atual) no MESMO sentido da variação atual.
      const anterior = (it.atual && it.v30 != null) ? it.v30 - it.v : 0;
      const reincidente = anterior !== 0 && Math.sign(anterior) === Math.sign(it.v);
      const vezesAnterior = reincidente && limCritico ? Math.abs(anterior) / limCritico : 0;
      const partes = [
        ['Gravidade × tendência', (MURAL_GRAV[it.nivel] || 0) * (MURAL_TEND[it.formato] || 1)],
        ['Impacto financeiro (R$)', MURAL_PESO_IMPACTO.financeiro * Math.log10(Math.abs(it.rs || 0) + 1)],
        [`Impacto físico (${vezesLimite.toFixed(1)}× o limite Crítico)`, MURAL_PESO_IMPACTO.fisico * Math.log2(1 + vezesLimite)],
        [`Reincidência: acumulado antes do mês no mesmo sentido (${vezesAnterior.toFixed(1)}× o limite Crítico)`, MURAL_PESO_IMPACTO.reincidencia * Math.log2(1 + vezesAnterior)],
        ['Dias sem ação × 0,3', Math.min(diasSemAcao, 10) * 0.3],
        ['Meses seguidos fora da faixa', ((it.meses || 1) - 1) * 1.5],
        ['Prazo vencido', vencido ? 3 : 0],
        ['Ocorrência aberta e variação crescendo', ocCrescendo ? 2 : 0]
      ];
      const status = (vencido || ocCrescendo) ? 'escalonado' : temOc ? 'tratamento' : novo ? 'novo' : 'semAcao';
      const avocado = _mo.avocacoes.find(a => a.central === it.central && a.material === it.material) || null;
      itens.push({ ...it, categoriaFoto: f.categoria, dono, avocado, causa, entrada, limite, limitadoPeloFechamento, fechamento,
        temOc, semTratamento, ocs, comentarios, diasSemAcao, vencido, ocCrescendo, novo, piorou, residual,
        herdadaKg, novaKg: it.v - herdadaKg, reincidente, anteriorKg: anterior,
        prioridade: partes.reduce((s, x) => s + x[1], 0), partes, status });
    });
  });
  return itens;
}

// ── Render ─────────────────────────────────────────────────────────────────
// Gráfico dos 30 dias (acumulado). desde (dd/mm/aaaa): início do mês — a
// partir daí é o trecho da variação atual; o que vem antes fica apagado.
function _muralSpark(pontos, cor, desde) {
  const s = (pontos || []).map(p => p[1]);
  if (s.length < 2) return '<span class="mo-hint">—</span>';
  const w = 120, h = 36, min = Math.min(0, ...s), max = Math.max(0, ...s), r = (max - min) || 1;
  const x = i => (2 + i * (w - 6) / (s.length - 1)).toFixed(1), y = v => (3 + (max - v) / r * (h - 8)).toFixed(1);
  const pts = s.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const dIni = parseDate(desde);
  const iMes = dIni ? pontos.findIndex(p => { const d = parseDate(p[0]); return d && d >= dIni; }) : -1;
  // Antes do início do mês: faixa apagada por cima do trecho já fechado.
  const marca = iMes > 0
    ? `<rect x="0" y="0" width="${(+x(iMes) - (+x(iMes) - +x(iMes - 1)) / 2).toFixed(1)}" height="${h}" fill="var(--bg2)" opacity=".55"/>
       <line x1="${(+x(iMes) - (+x(iMes) - +x(iMes - 1)) / 2).toFixed(1)}" x2="${(+x(iMes) - (+x(iMes) - +x(iMes - 1)) / 2).toFixed(1)}" y1="0" y2="${h}" stroke="var(--text3)" stroke-dasharray="2 2"/>` : '';
  return `<svg class="mo-spark" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <line x1="2" x2="${w - 2}" y1="${y(0)}" y2="${y(0)}" stroke="var(--border3)" stroke-dasharray="2 3"/>
    <polygon points="${x(0)},${y(0)} ${pts} ${x(s.length - 1)},${y(0)}" fill="${cor}" opacity=".14"/>
    <polyline points="${pts}" fill="none" stroke="${cor}" stroke-width="1.6" stroke-linejoin="round"/>
    <circle cx="${x(s.length - 1)}" cy="${y(s[s.length - 1])}" r="2.6" fill="${cor}"/>${marca}</svg>`;
}

function _muralPrazoHtml(it) {
  if (it.temOc) {
    // A ocorrência é o pedido à central: se não for concluída, o item vai
    // para o fechamento como "solicitação não concluída".
    const lim = it.ocs.map(o => o.limite).filter(Boolean).sort((a, b) => a - b)[0];
    const d = lim ? _moDiasEntre(new Date(), lim) : null;
    const prazoOc = d == null ? '' : d < 0
      ? ` · <b class="mo-red">prazo da central vencido há ${-d} dia${d < -1 ? 's' : ''}</b>`
      : ` · central tem até ${fmtPtDate(lim).slice(0, 5)}${lim > it.fechamento ? ' <b class="mo-red">(depois do fechamento)</b>' : ''}`;
    return `<span class="mo-meta"><i class="ti ti-file-alert"></i> ocorrência aberta${prazoOc}${it.ocCrescendo ? ' · <b class="mo-red">variação crescendo desde a abertura</b>' : ''}</span>`;
  }
  const d = _moDiasEntre(new Date(), it.limite);
  const crit = it.nivel === 'critico';
  const fech = it.limitadoPeloFechamento ? ` (fechamento ${fmtPtDate(it.fechamento).slice(0, 5)})` : '';
  if (d < 0) return `<span class="mo-meta mo-red"><i class="ti ti-clock-exclamation"></i> prazo vencido há ${-d} dia${d < -1 ? 's' : ''}${fech}${crit ? ' · Crítico exige ocorrência' : ''}</span>`;
  return `<span class="mo-meta${it.limitadoPeloFechamento ? ' mo-red' : ''}"><i class="ti ti-clock"></i> ${d === 0 ? 'prazo vence hoje' : `${d} dia${d > 1 ? 's' : ''} para agir`}${fech}${crit ? ' · exige ocorrência' : ''}</span>`;
}

// Onde procurar: o que já aparece no 1º lançamento do trecho (do dia 1 até
// ele: primeiros dias do mês, ou Custos SAP do mês anterior importado antes
// do ajuste do fechamento) × o que veio depois. Só aparece quando essa
// parte pesa (≥ 30% da variação).
function _muralHerdadaHtml(it) {
  if (!it.herdadaKg || Math.abs(it.herdadaKg) < 0.3 * Math.abs(it.v)) return '';
  const desde = (it.primeiroMes || it.pontos?.[0])?.[0]?.slice(0, 5) || '';
  const doMes = !!it.primeiroMes && it.atual;
  return `<div class="mo-ex-text"><b class="mo-herd">${_moKg(it.herdadaKg)}</b> já no 1º lançamento${doMes ? ' do mês' : ''} (${_moEsc(desde)}) · <b>${_moKg(it.novaKg)}</b> depois</div>`;
}

function _muralItemHtml(it) {
  const nv = MURAL_NIVEL[it.nivel] || MURAL_NIVEL.atencao;
  const st = MURAL_STATUS[it.status];
  // Número e gráfico na cor do SINAL, padrão do sistema: desfalque vermelho,
  // sobra âmbar. A cor do nível fica na etiqueta e na faixa lateral.
  const corV = it.v < -0.05 ? 'var(--red)' : it.v > 0.05 ? 'var(--amber)' : 'var(--text2)';
  const chips = [];
  if (it.piorando) chips.push(['hot', 'ti-trending-up', 'piorando']);
  if ((it.meses || 1) > 1) chips.push(['hot', 'ti-history', `${it.meses}º mês seguido`]);
  if (it.reincidente) chips.push(['hot', 'ti-repeat', `reincidente: ${_moKg(it.anteriorKg)} antes do mês, mesmo sentido`]);
  if (!it.temOc && it.diasSemAcao > 0) chips.push(['warn', 'ti-clock', `sem ação há ${it.diasSemAcao} dia${it.diasSemAcao > 1 ? 's' : ''}`]);
  if (it.capErro) chips.push(['warn', 'ti-alert-hexagon', 'acima da capacidade física']);
  if (it.ocs.length) chips.push(['', 'ti-file-alert', it.ocs.map(o => o.numero).join(', ')]);
  if (it.avocado) chips.push(['adm', 'ti-shield-check', `avocado pelo ADM: ${it.avocado.motivo}`]);
  if (it.causa) chips.push(['adm', 'ti-message-check', `causa: ${it.causa}`]);
  const pe = Math.min(100, Math.abs(it.explicadoKg || 0) / (Math.abs(it.v) || 1) * 100);
  const explic = (it.explic || []).length
    ? `<b class="mo-teal">${_moKg(it.explicadoKg)}</b> explicados · <b>${_moKg(it.residual)}</b> sem explicação`
    : `Nada explicado por pendência ou divergência · <b>${_moKg(it.v)}</b> a investigar`;
  const titleExplic = (it.explic || []).map(e => `${e.t}: ${_moKg(e.kg)}`).join('\n');
  const titlePrio = it.partes.filter(p => p[1]).map(p => `${p[0]}: +${p[1].toFixed(1)}`).join('\n');
  const pts = it.pontos || [];
  const dataset = `data-central="${_moEsc(it.central)}" data-material="${_moEsc(it.material)}"`;
  return `<article class="mo-item" style="--lv:${nv.cor}">
    <div class="mo-stripe"></div>
    <div class="mo-main">
      <div class="mo-title">
        <span class="mo-lvl"><i class="ti ${nv.icon}"></i>${nv.label}</span>
        <span class="mo-mat">${_moEsc(it.material)}</span>
        <span class="mo-where">· ${_moEsc(it.central)} · Reg. ${_moEsc(it.regional)}</span>
        <span class="mo-shape mo-shape-${_moEsc(it.formato)}" title="${_moEsc(MURAL_FORMATO_DESC[it.formato] || '')}">${_moEsc(MURAL_FORMATO_LABEL[it.formato] || it.formato)}</span>
      </div>
      ${chips.length ? `<div class="mo-why">${chips.map(([c, i, t]) => `<span class="${c}"><i class="ti ${i}"></i>${_moEsc(t)}</span>`).join('')}</div>` : ''}
      <div class="mo-explain" title="${_moEsc(titleExplic)}">
        <div class="mo-track"><i style="width:${pe}%;background:var(--teal)"></i><i style="width:${100 - pe}%;background:${nv.cor};opacity:.75"></i></div>
        <div class="mo-ex-text">${explic}</div>
        ${_muralHerdadaHtml(it)}
      </div>
    </div>
    <div class="mo-sparkbox">${_muralSpark(pts, corV, it.atual ? it.desde : null)}<small>${pts.length ? `${_moEsc(pts[0][0].slice(0, 5))} → ${_moEsc(pts[pts.length - 1][0].slice(0, 5))}` : ''}</small></div>
    <div class="mo-num"><span class="mo-kg" style="color:${corV}" title="${it.atual === false ? 'Sem lançamento no mês ainda: mostrando o acumulado de 30 dias' : 'Variação atual: desde o dia 1 do mês (após o fechamento anterior)'}">${_moKg(it.v)}</span><span class="mo-rs">${it.custoMed ? _moRs(it.rs) : 'sem custo'}</span>${
      it.v30 != null ? `<span class="mo-30" title="Acumulado dos últimos 30 dias, atravessando o fechamento">${it.atual === false ? 'sem lançamento no mês · ' : ''}30 dias: ${_moKg(it.v30)}</span>`
        : '<span class="mo-30 mo-antiga" title="Foto calculada pela versão anterior do Mural: o número é o acumulado de 30 dias. A variação do mês aparece quando o dono da categoria entrar ou clicar em Atualizar.">foto antiga · acumulado 30 dias</span>'}<span class="mo-prio" title="${_moEsc(titlePrio)}">prioridade <b>${it.prioridade.toFixed(1)}</b></span></div>
    <div class="mo-foot">
      <span class="mo-status" style="--sc:${st.cor}">${st.label}</span>
      <span class="mo-meta"><i class="ti ti-user"></i> ${it.avocado ? `ADM <span class="mo-hint">(${_moEsc(it.dono.nome)} acompanha)</span>` : _moEsc(it.dono.nome)}</span>
      ${_muralPrazoHtml(it)}
      <div class="mo-actions">
        <button class="btn btn-sm" onclick="muralVerNaMicro(this)" ${dataset}><i class="ti ti-chart-dots-2"></i> Ver na Micro</button>
        <button class="btn btn-sm" onclick="muralComentar(this)" ${dataset} data-diff="${it.v}" data-periodo="${pts.length ? _moEsc(pts[0][0] + ' a ' + pts[pts.length - 1][0]) : ''}"><i class="ti ti-message-plus"></i> ${it.temOc ? 'Comentar' : 'Comentar / ocorrência'}</button>
        ${_moEhAdm() && _mo.avocDisponivel ? (it.avocado
          ? `<button class="btn btn-sm" onclick="muralDevolver('${_moEsc(it.avocado.id)}')" title="Devolver a ${_moEsc(it.dono.nome)}"><i class="ti ti-arrow-back-up"></i> Devolver</button>`
          : `<button class="btn btn-sm" onclick="muralAvocar(this)" ${dataset} data-categoria="${_moEsc(it.categoriaFoto)}" data-dono="${_moEsc(it.dono.nome)}" title="Assumir este item no lugar do dono"><i class="ti ti-shield-check"></i> Avocar</button>`) : ''}
      </div>
    </div>
  </article>`;
}

function _muralFiltrar(itens) {
  if (_mo.ids) return itens.filter(i => _mo.ids.has(_moChave(i)));
  if (_mo.filtro === 'piorando') return itens.filter(i => i.piorando);
  if (_mo.filtro === 'semacao')  return itens.filter(i => !i.temOc && i.diasSemAcao > 0);
  if (_mo.filtro === 'semtrat')  return itens.filter(i => i.semTratamento);
  if (_mo.filtro === 'avocados') return itens.filter(i => i.avocado);
  if (_mo.filtro === 'vencido')  return itens.filter(i => i.status === 'escalonado');
  return itens;
}

function _muralOrdenar(itens) {
  const k = { prio: i => -i.prioridade, kg: i => -Math.abs(i.v || 0), residual: i => -_moKgResidual(i) }[_mo.ordem] || (i => -i.prioridade);
  return [...itens].sort((a, b) => k(a) - k(b));
}

// Contagem regressiva do fechamento: tudo acima do limite precisa estar
// tratado (comentário com a causa ou ocorrência aberta) antes dele; o
// fechamento só ajusta o que sobrar sem explicação.
function _muralFechamentoHtml(itens) {
  const fech = _muralFechamento(_moDia(new Date()));
  const dias = _moDiasEntre(new Date(), fech);
  const semTrat = itens.filter(i => i.semTratamento);
  const cor = dias <= 3 && semTrat.length ? 'var(--red)' : dias <= 7 && semTrat.length ? 'var(--urgente)' : 'var(--text2)';
  return `<div class="mo-fech" style="--fc:${cor}"><i class="ti ti-calendar-due"></i>
    <span><b>Fechamento ${dias === 0 ? 'hoje' : `em ${dias} dia${dias > 1 ? 's' : ''}`}</b> (${fmtPtDate(fech)})</span>
    <span class="mo-hint">·</span><span><b>${itens.length}</b> acima do limite</span>
    <span class="mo-hint">·</span>${semTrat.length
      ? `<button class="mo-link" onclick="muralFiltro('semtrat')"><b>${semTrat.length}</b> ainda sem tratamento</button>`
      : '<span class="mo-teal">todos com tratamento registrado</span>'}
    <span class="mo-hint" style="margin-left:auto">O fechamento só ajusta o que ficar sem explicação ou pedido à central não concluído.</span></div>`;
}

function _muralKpisHtml(itens) {
  const fila = itens;
  const semAcao = fila.filter(i => !i.temOc && i.diasSemAcao > 0).length;
  const piorando = fila.filter(i => i.piorando).length;
  const esc = fila.filter(i => i.status === 'escalonado').length;
  const kgRes = fila.reduce((s, i) => s + _moKgResidual(i), 0);
  const rs = fila.reduce((s, i) => s + _moRsResidual(i), 0);
  // Mesma conta das colunas do Painel do time: líquido com sinal e, embaixo,
  // desfalque · sobra.
  const soma = (f, cond) => fila.reduce((s, i) => s + (cond(i) ? f(i) : 0), 0);
  const vLiq = soma(i => i.v, () => true), vDes = soma(i => i.v, i => i.v < 0), vSob = soma(i => i.v, i => i.v > 0);
  const rLiq = soma(i => i.rs || 0, () => true), rDes = soma(i => i.rs || 0, i => i.v < 0), rSob = soma(i => i.rs || 0, i => i.v > 0);
  const corSinal = v => v < -0.05 ? 'var(--red)' : v > 0.05 ? 'var(--amber)' : 'var(--text)';
  // Os dois principais (Hugo, 09/11/2026) ficam em destaque numa linha
  // própria; os demais, menores, embaixo — mesmo esquema de dois níveis do
  // Resumo do Período do Gerencial.
  // Principal = variação ATUAL (mês em aberto); embaixo, o acumulado de 30
  // dias, que atravessa o fechamento (secundário).
  const v30 = soma(i => i.v30 ?? i.v, () => true), r30 = soma(i => i.rs30 ?? i.rs ?? 0, () => true);
  const principais = [
    ['Variação total · mês atual', _moPesoSinal(vLiq), `${_moPesoSinal(vDes)} desfalque · ${_moPesoSinal(vSob)} sobra · 30 dias: ${_moPesoSinal(v30)}`, corSinal(vLiq), 'ti-scale'],
    ['Custo da variação · mês atual', _moRs(rLiq), `${_moRs(rDes)} desfalque · ${_moRs(rSob)} sobra · 30 dias: ${_moRs(r30)}`, corSinal(rLiq), 'ti-coin']
  ];
  const k = [
    ['Na fila', fila.length, 'pares fora da faixa', 'var(--text)', 'ti-list-details'],
    ['Sem ação', semAcao, 'nada feito desde que entrou', semAcao ? 'var(--urgente)' : 'var(--green)', 'ti-clock'],
    ['Piorando', piorando, 'cresceu nos 3 últimos lançamentos', piorando ? 'var(--red)' : 'var(--green)', 'ti-trending-up'],
    ['Escalonados', esc, 'prazo vencido ou ocorrência sem efeito', esc ? 'var(--red)' : 'var(--green)', 'ti-arrow-big-up-lines'],
    ['Sem explicação', _moPeso(kgRes), `parte da variação sem causa · ${_moRs(rs).replace(/^[+−]/, '')}`, 'var(--amber)', 'ti-eye-off']
  ];
  const card = (cls) => ([l, v, s, c, i]) =>
    `<div class="mo-kpi${cls}" style="--kc:${c}"><span class="mo-kpi-label"><i class="ti ${i}"></i>${l}</span><span class="mo-kpi-val" style="color:${c}">${v}</span><span class="mo-kpi-sub">${s}</span></div>`;
  return `<div class="mo-kpis-hero">${principais.map(card(' mo-kpi-hero')).join('')}</div>
    <div class="mo-kpis">${k.map(card('')).join('')}</div>`;
}

function _muralIdsAttr(arr) { return _moEsc(JSON.stringify(arr.map(_moChave))); }

function _muralDesdeHtml(itens) {
  const novos = itens.filter(i => i.novo), piores = itens.filter(i => i.piorou);
  const resolvidos = [];
  _mo.fotos.forEach(f => {
    const atuais = new Set((f.atual.payload?.itens || []).map(_moChave));
    (f.anterior?.payload?.itens || []).forEach(i => { if (!atuais.has(_moChave(i))) resolvidos.push(`${i.material} · ${i.central}`); });
  });
  const chip = (lbl, arr, cor, icon) => arr.length
    ? `<button class="mo-since-chip" style="--fg:${cor}" onclick="muralFiltrarIds('${lbl}', this)" data-ids="${_muralIdsAttr(arr)}"><i class="ti ${icon}"></i><b>${arr.length}</b> ${lbl}</button>` : '';
  const html = chip('novos', novos, 'var(--accent)', 'ti-plus') + chip('pioraram', piores, 'var(--red)', 'ti-trending-up')
    + (resolvidos.length ? `<span class="mo-since-chip" style="--fg:var(--green)" title="${_moEsc(resolvidos.join('\n'))}"><i class="ti ti-check"></i><b>${resolvidos.length}</b> voltaram à faixa</span>` : '');
  return `<div class="mo-since"><span class="mo-since-label">Desde a foto anterior</span>${html || '<span class="mo-hint">Nada mudou entre as duas últimas fotos.</span>'}</div>`;
}

function _muralPontosCegosHtml() {
  const linhas = [];
  const semCadPorDono = new Set(); // sem categoria é da BASE do dono, não da categoria: 1x por dono
  _mo.fotos.forEach(f => {
    const pc = f.atual.payload?.pontosCegos || {};
    const add = (k, titulo, desc, cat) => { const x = pc[k]; if (x && x.total) linhas.push({ titulo: `${x.total} ${titulo}`, desc, ex: x.exemplos || [], cat }); };
    add('semAncora', 'par(es) sem saldo do SAP', 'Sem Cód SAP ou sem Custos SAP: a variação não é calculada.', f.categoria);
    add('semLancamento', 'par(es) sem lançamento na janela', 'Teve SAP, mas ninguém lançou o estoque em 30 dias.', f.categoria);
    // Base de lançamentos que começa depois do início da janela: a parte
    // "herdada" dos itens mistura diferença antiga com o período sem lançamento.
    const p = f.atual.payload || {};
    const desde = parseDate(p.base?.lancamentosDesde), ini = parseDate(p.janela?.ini);
    if (desde && ini && _moDiasEntre(ini, desde) > 3) {
      linhas.push({ titulo: `Lançamentos só a partir de ${p.base.lancamentosDesde.slice(0, 5)}`, cat: f.categoria, ex: [],
        desc: `A janela começa em ${p.janela.ini.slice(0, 5)}, mas a base do dono não tem lançamento antes disso. A parte "já no 1º lançamento" inclui esse período.` });
    }
    // Peso das OS divergindo do SAP sempre na mesma direção, em muitas OS: não
    // é causa de um par, é problema de dado (origem dos pesos das Saídas).
    const pesos = (p.itens || []).flatMap(i => (i.explic || []).filter(e => e.chave === 'peso' && e.lado === 'sai'));
    const nOs = pesos.reduce((s, e) => s + (e.n || 0), 0), kgOs = pesos.reduce((s, e) => s + (e.kg || 0), 0);
    const mesmoSentido = pesos.length && pesos.every(e => Math.sign(e.kg) === Math.sign(pesos[0].kg));
    if (nOs >= 50 && mesmoSentido) {
      linhas.push({ titulo: `${nOs.toLocaleString('pt-BR')} OS com peso PUZL ≠ SAP, todas no mesmo sentido`, cat: f.categoria, ex: [], alerta: true,
        desc: `${kgOs < 0 ? 'O SAP baixa menos' : 'O SAP baixa mais'} que a PUZL: ${_moPeso(Math.abs(kgOs))} no total (${(Math.abs(kgOs) / nOs).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg por OS). Confira a origem dos pesos das Saídas (importação e OS repetidas) antes de usar essa parte como explicação.` });
    }
    const dono = f.atual.gerado_por || f.categoria;
    if (!semCadPorDono.has(dono)) {
      semCadPorDono.add(dono);
      add('semCadastro', 'material(is) sem categoria', 'Fora da saúde e sem dono até ser cadastrado.', `base de ${_muralDonoDe(f.categoria).nome}`);
    }
  });
  if (_moEhAdm()) {
    const hoje = _moDia(new Date());
    _mo.donos.forEach(d => {
      const f = _mo.fotos.find(x => x.categoria === d.categoria);
      const dias = f ? _moDiasEntre(_moIsoParaData(f.atual.dia), hoje) : null;
      if (dias == null || dias > 1) linhas.push({ titulo: `Foto de ${d.categoria} ${dias == null ? 'não publicada nos últimos 10 dias' : `atrasada há ${dias} dias`}`, desc: `Dono: ${d.analista_nome || '—'}. A fila dessa categoria pode estar desatualizada.`, ex: [], alerta: true });
    });
    const ref = new Date(); ref.setDate(1); ref.setMonth(ref.getMonth() - 1);
    const temMesAnt = (state.custosSap || []).some(r => Number(r.ano) === ref.getFullYear() && Number(r.mes) === ref.getMonth() + 1);
    if (!temMesAnt) linhas.push({ titulo: `Custos SAP de ${String(ref.getMonth() + 1).padStart(2, '0')}/${ref.getFullYear()} não importado`, desc: 'O Est. Inicial de todos os analistas fica ancorado num mês mais antigo.', ex: [], alerta: true });
  }
  if (!linhas.length) return '<p class="mo-hint">Nenhum ponto cego nas fotos atuais.</p>';
  return linhas.map(l => `<div class="mo-blind${l.alerta ? ' mo-blind-alerta' : ''}"><b>${_moEsc(l.titulo)}</b>${l.cat ? `<span class="mo-cat">${_moEsc(l.cat)}</span>` : ''}<small>${_moEsc(l.desc)}${l.ex.length ? ` Ex.: ${_moEsc(l.ex.slice(0, 3).join('; '))}` : ''}</small></div>`).join('');
}

function _muralTimeHtml(itens) {
  const hoje = _moDia(new Date());
  const porDono = new Map();
  _mo.donos.forEach(d => {
    const k = d.analista_user_id || d.categoria;
    if (!porDono.has(k)) porDono.set(k, { nome: d.analista_nome || '—', cats: [] });
    porDono.get(k).cats.push(d.categoria);
  });
  const ativos = itens;
  const linhas = [...porDono.values()].map(d => {
    const its = ativos.filter(i => d.cats.includes(i.categoriaFoto));
    const fotos = _mo.fotos.filter(f => d.cats.includes(f.categoria));
    const ultima = fotos.map(f => _moIsoParaData(f.atual.dia)).sort((a, b) => b - a)[0];
    const atraso = ultima ? _moDiasEntre(ultima, hoje) : null;
    const base = fotos[0]?.atual.payload?.base || {};
    const kgRes = its.reduce((s, i) => s + _moKgResidual(i), 0);
    const rs = its.reduce((s, i) => s + _moRsResidual(i), 0);
    // Variação e custo totais: soma COM SINAL (líquida, como a Variação Total
    // do Gerencial) e, embaixo, quanto é desfalque e quanto é sobra.
    const soma = (f, cond) => its.reduce((s, i) => s + (cond(i) ? f(i) : 0), 0);
    const vLiq = soma(i => i.v, () => true), vDes = soma(i => i.v, i => i.v < 0), vSob = soma(i => i.v, i => i.v > 0);
    const rLiq = soma(i => i.rs || 0, () => true), rDes = soma(i => i.rs || 0, i => i.v < 0), rSob = soma(i => i.rs || 0, i => i.v > 0);
    const corSinal = v => v < -0.05 ? 'var(--red)' : v > 0.05 ? 'var(--amber)' : 'inherit';
    const n = (v, c) => `<td${v ? ` style="color:${c}"` : ''}>${v}</td>`;
    return `<tr onclick="muralFiltrarIds('fila de ${_moEsc(d.nome)}', this)" data-ids="${_muralIdsAttr(its)}">
      <td><b>${_moEsc(d.nome)}</b><small>${_moEsc(d.cats.join(', '))}</small></td>
      <td>${its.length}</td>
      <td style="color:${corSinal(vLiq)}">${_moPesoSinal(vLiq)}<small>${_moPesoSinal(vDes)} · ${_moPesoSinal(vSob)}</small></td>
      <td style="color:${corSinal(rLiq)}">${_moRs(rLiq)}<small>${_moRs(rDes)} · ${_moRs(rSob)}</small></td>
      ${n(its.filter(i => i.piorando).length, 'var(--red)')}${n(its.filter(i => !i.temOc && i.diasSemAcao > 0).length, 'var(--urgente)')}${n(its.filter(i => i.status === 'escalonado').length, 'var(--red)')}${n(its.filter(i => i.semTratamento).length, 'var(--urgente)')}
      <td>${_moPeso(kgRes)}<small>${_moRs(rs).replace(/^[+−]/, '')}</small></td>
      <td${atraso == null || atraso > 1 ? ' style="color:var(--red)"' : ''}>${atraso == null ? 'sem foto' : atraso === 0 ? 'hoje' : `há ${atraso} dia${atraso > 1 ? 's' : ''}`}<small>SAP ${_moEsc((base.sap || '—').slice(0, 5))} · lanç. ${_moEsc((base.lancamentos || '—').slice(0, 5))}</small></td></tr>`;
  }).join('');
  // Central na fila de mais de um analista: causa comum provável na central.
  const donosPorCentral = new Map();
  ativos.forEach(i => {
    if (!donosPorCentral.has(i.central)) donosPorCentral.set(i.central, new Set());
    donosPorCentral.get(i.central).add(i.dono.nome);
  });
  // Mais analistas e mais itens primeiro. Um bloco recolhido só, com um chip
  // por central (Hugo, 09/11/2026: uma linha por central ocupava a tela).
  const multi = [...donosPorCentral].filter(([, s]) => s.size > 1)
    .map(([c, s]) => ({ c, s, its: ativos.filter(i => i.central === c) }))
    .sort((a, b) => (b.s.size - a.s.size) || (b.its.length - a.its.length));
  const multiHtml = multi.length ? `<details class="mo-multi">
      <summary><i class="ti ti-alert-triangle"></i><b>${multi.length} centra${multi.length > 1 ? 'is' : 'l'}</b> na fila de mais de um analista
        <span class="mo-hint">· pode ser causa comum na central (operação, balança, gestão)</span><i class="ti ti-chevron-down mo-multi-chev"></i></summary>
      <div class="mo-multi-chips">${multi.map(({ c, s, its }) =>
        `<button class="mo-chip" onclick="muralFiltrarIds('${_moEsc(c)}', this)" data-ids="${_muralIdsAttr(its)}" title="${_moEsc([...s].join(', '))}"><b>${_moEsc(c)}</b> ${s.size} analistas · ${its.length} ite${its.length > 1 ? 'ns' : 'm'}</button>`).join('')}</div>
    </details>` : '';
  return `<div class="mo-panel"><div class="mo-panel-head"><span class="mo-panel-title"><i class="ti ti-users"></i>Painel do time</span><span class="mo-hint" style="margin-left:auto">Clique num analista para ver a fila dele</span></div>
    <div class="mo-scroll"><table class="mo-team"><thead><tr><th>Analista</th><th>Na fila</th><th title="Soma com sinal das variações da fila. Embaixo: desfalque · sobra">Variação total</th><th title="Soma com sinal do custo das variações da fila. Embaixo: desfalque · sobra">Custo da variação</th><th>Piorando</th><th>Sem ação</th><th>Escalonados</th><th title="Ainda sem comentário com a causa nem ocorrência: não pode ir para o fechamento">Sem tratamento</th><th>Sem explicação</th><th>Foto</th></tr></thead><tbody>${linhas}</tbody></table></div>
    ${multiHtml}</div>`;
}

function _muralAuditoriaHtml() {
  const a = _mo.auditoria;
  let corpo;
  if (!a) corpo = '<p class="mo-hint">Compara a sua base completa com as fotos dos analistas: material fora da foto do dono e pares em que a variação discorda.</p>';
  else if (a.erro) corpo = `<p class="mo-hint mo-red">${_moEsc(a.erro)}</p>`;
  else {
    const l = (arr, fmt) => arr.slice(0, 15).map(fmt).join('') + (arr.length > 15 ? `<small>+${arr.length - 15} outros</small>` : '');
    corpo = `<p class="mo-hint">Rodada em ${_moEsc(a.quando)} (${a.ms} ms).</p>
      <div class="mo-blind${a.fora.length ? ' mo-blind-alerta' : ''}"><b>${a.fora.length} par(es) fora da foto do dono</b><small>Fora da faixa na sua base, mas ausentes da foto da categoria.</small>${l(a.fora, x => `<small>• ${_moEsc(x.material)} · ${_moEsc(x.central)} (${_moEsc(x.categoria)}): ${_moKg(x.v)}</small>`)}</div>
      <div class="mo-blind${a.diverg.length ? ' mo-blind-alerta' : ''}"><b>${a.diverg.length} par(es) com variação divergente</b><small>Sua base × foto do dono: base desatualizada ou importação incompleta de um dos lados.</small>${l(a.diverg, x => `<small>• ${_moEsc(x.material)} · ${_moEsc(x.central)}: ADM ${_moKg(x.vAdm)} × dono ${_moKg(x.vDono)}</small>`)}</div>
      <div class="mo-blind${a.semCadastro ? ' mo-blind-alerta' : ''}"><b>${a.semCadastro} material(is) sem categoria na sua base</b><small>${_moEsc((a.semCadastroEx || []).slice(0, 5).join('; '))}</small></div>`;
  }
  return `<div class="mo-panel"><div class="mo-panel-head"><span class="mo-panel-title"><i class="ti ti-shield-search"></i>Auditoria de cobertura</span>
    <button class="btn btn-sm" style="margin-left:auto" onclick="muralAuditar()"><i class="ti ti-player-play"></i> ${a ? 'Rodar de novo' : 'Rodar'}</button></div><div class="mo-panel-body">${corpo}</div></div>`;
}

function muralRender() {
  const el = document.getElementById('mural-root');
  if (!el) return;
  if (!_mo.carregado && !_mo.carregando && !_mo.erro) { muralRecarregar(); return; }
  const adm = _moEhAdm();
  // Sem cabeçalho nem botão (Hugo, 09/11/2026): o Mural atualiza sozinho no
  // boot, depois de cada importação e junto com o Atualizar do Dashboard.
  const cab = '';
  if (_mo.erro) { el.innerHTML = cab + `<div class="empty-state"><p>Não foi possível ler o Mural: ${_moEsc(_mo.erro)}</p></div>`; return; }
  if (!_mo.carregado) { el.innerHTML = cab + '<div class="empty-state"><p>Carregando as fotos…</p></div>'; return; }
  if (!_mo.fotos.length) {
    el.innerHTML = cab + `<div class="empty-state"><p>${adm
      ? 'Nenhum analista publicou foto nos últimos 10 dias. A foto sai sozinha quando o dono da categoria entra no sistema.'
      : 'Sua foto ainda não foi publicada. Ela é calculada sozinha alguns segundos depois do carregamento e de cada importação.'}</p></div>`;
    return;
  }
  const itens = muralItensDerivados();
  _mo._ultItens = itens;
  // Filtros da barra valem para KPIs e fila; fechamento, "desde a foto
  // anterior" e Painel do time continuam mostrando o quadro inteiro.
  const base = _muralAplicarFiltros(itens);
  const lista = _muralOrdenar(_muralFiltrar(base));
  const ativos = lista;
  const filtros = [['todos', adm ? 'Todos' : 'Minha fila'], ['semtrat', 'Sem tratamento'], ['piorando', 'Piorando'], ['semacao', 'Sem ação'], ['vencido', 'Escalonados']];
  if (itens.some(i => i.avocado)) filtros.push(['avocados', 'Avocados']);
  const cats = [...new Set(_mo.fotos.map(f => f.categoria))].join(', ');
  const fotoInfo = _mo.fotos.map(f => `${f.categoria}: ${String(f.atual.dia).split('-').reverse().join('/')}`).join(' · ');
  el.innerHTML = cab + _muralFechamentoHtml(itens) + _muralDesdeHtml(itens) + _muralFiltrosHtml(itens) + _muralKpisHtml(base) + (adm ? _muralTimeHtml(itens) : '') +
    `<div class="mo-grid">
      <div class="mo-panel">
        <div class="mo-panel-head">
          <div class="mo-abas" role="tablist">
            <button class="mo-aba${_mo.aba !== 'faixa' ? ' on' : ''}" role="tab" aria-selected="${_mo.aba !== 'faixa'}" onclick="muralAba('fila')"><i class="ti ti-flame"></i>${adm ? 'Fila de ação' : 'Minha fila · ' + _moEsc(cats)} <b>${base.length}</b></button>
            <button class="mo-aba${_mo.aba === 'faixa' ? ' on' : ''}" role="tab" aria-selected="${_mo.aba === 'faixa'}" onclick="muralAba('faixa')"><i class="ti ti-circle-check"></i>Na faixa <b>${_muralFaixaFiltradas().length}</b></button>
          </div>
          ${_mo.aba === 'faixa' ? '' : `<div class="mo-filtros">${filtros.map(([k, l]) => `<button class="mo-chip${!_mo.ids && _mo.filtro === k ? ' on' : ''}" onclick="muralFiltro('${k}')">${l}</button>`).join('')}
            ${_mo.ids ? `<button class="mo-chip on" onclick="muralFiltro('todos')">${_moEsc(_mo.idsLabel)} <i class="ti ti-x"></i></button>` : ''}
            <select class="mo-sort" onchange="muralOrdem(this.value)" aria-label="Ordenar a fila">
              <option value="prio"${_mo.ordem === 'prio' ? ' selected' : ''}>Ordenar: prioridade</option>
              <option value="kg"${_mo.ordem === 'kg' ? ' selected' : ''}>Ordenar: variação (kg)</option>
              <option value="residual"${_mo.ordem === 'residual' ? ' selected' : ''}>Ordenar: sem explicação (kg)</option>
            </select>
            <button class="btn btn-sm" onclick="muralGruposTodos(true)" title="Expandir todos os grupos"><i class="ti ti-arrows-maximize"></i></button>
            <button class="btn btn-sm" onclick="muralGruposTodos(false)" title="Recolher todos os grupos"><i class="ti ti-arrows-minimize"></i></button></div>`}
        </div>
        ${_mo.aba === 'faixa' ? _muralFaixaHtml() : `<div class="mo-queue">${_muralFilaHtml(ativos)}</div>`}
        <div class="mo-foot-note mo-hint">Janela móvel de ${MURAL_JANELA_DIAS} dias até ontem · Fotos: ${_moEsc(fotoInfo)}</div>
      </div>
      <div class="mo-aside">
        <div class="mo-panel"><div class="mo-panel-head"><span class="mo-panel-title"><i class="ti ti-eye-off"></i>Pontos cegos</span></div><div class="mo-panel-body">${_muralPontosCegosHtml()}</div></div>
        ${adm ? _muralAuditoriaHtml() : ''}
        <div class="mo-panel"><div class="mo-panel-head"><span class="mo-panel-title"><i class="ti ti-clock"></i>Prazos para o dono agir</span></div><div class="mo-panel-body mo-rules">
          ${Object.entries(MURAL_PRAZO).map(([k, d]) => `<span class="mo-lvl" style="--lv:${MURAL_NIVEL[k].cor}">${MURAL_NIVEL[k].label}</span><span>${d} dias${k === 'critico' ? ', só sai com ocorrência' : ''}</span>`).join('')}
          <p class="mo-hint" style="grid-column:1/-1;margin:6px 0 0">Ação é comentar ou abrir ocorrência; o comentário renova o prazo uma vez. Prazo vencido, ou ocorrência aberta com a variação crescendo, escalona ao ADM. Nenhum prazo passa do fechamento.</p></div></div>
      </div>
    </div>`;
}

// ── Filtros (mesmo visual e comportamento dos da Visão Micro) ─────────────
// Multisseleção com busca, Limpar/Cancelar/Aplicar. Estado próprio do Mural
// (não mexe no _microFilter da Micro). Os filtros de dimensão (regional,
// central, categoria, material, dono, tipo) valem também para "Na faixa".
const MURAL_FILTROS = [
  { k: 'regional',  label: 'Regional',  icon: 'ti-users-group',         dim: true,  de: i => i.regional || '—' },
  { k: 'central',   label: 'Central',   icon: 'ti-building-warehouse',  dim: true,  de: i => i.central },
  { k: 'categoria', label: 'Categoria', icon: 'ti-tag',                 dim: true,  de: i => i.categoriaFoto || i.categoria },
  { k: 'material',  label: 'Material',  icon: 'ti-box',                 dim: true,  de: i => i.material },
  { k: 'nivel',     label: 'Nível',     icon: 'ti-heartbeat',           dim: false, de: i => i.nivel,
    nome: v => (MURAL_NIVEL[v] || {}).label || v, ordem: ['critico', 'urgente', 'atencao'] },
  { k: 'tipo',      label: 'Tipo',      icon: 'ti-arrows-diff',         dim: true,  de: i => i.v < 0 ? 'desfalque' : 'sobra',
    nome: v => v === 'desfalque' ? 'Desfalque' : 'Sobra', ordem: ['desfalque', 'sobra'] },
  { k: 'formato',   label: 'Formato',   icon: 'ti-chart-line',          dim: false, de: i => i.formato, nome: v => MURAL_FORMATO_LABEL[v] || v },
  { k: 'status',    label: 'Situação',  icon: 'ti-progress-check',      dim: false, de: i => i.status, nome: v => (MURAL_STATUS[v] || {}).label || v,
    ordem: ['escalonado', 'semAcao', 'novo', 'tratamento'] },
  { k: 'dono',      label: 'Dono',      icon: 'ti-user',                dim: true,  de: i => i.avocado ? 'ADM' : i.dono.nome, soAdm: true }
];
_mo.f = Object.fromEntries(MURAL_FILTROS.map(x => [x.k, new Set()]));
_mo.fPend = null; _mo.fAberto = null; _mo.fBusca = '';
_mo.grupo = 'regional'; _mo.abertos = new Map();

function _muralFiltroDef(k) { return MURAL_FILTROS.find(x => x.k === k); }
function _muralFiltrosAtivos() { return MURAL_FILTROS.some(x => _mo.f[x.k].size); }

// Linha da aba "Na faixa" no mesmo formato que os filtros esperam.
function _muralFaixaComoItem(l) { return { regional: l.regional, central: l.central, categoriaFoto: l.categoria, material: l.material, v: l.v, dono: { nome: l.dono } }; }

function _muralAplicarFiltros(itens, soDimensao) {
  return itens.filter(i => MURAL_FILTROS.every(x => {
    if (!_mo.f[x.k].size || (soDimensao && !x.dim)) return true;
    return _mo.f[x.k].has(x.de(i));
  }));
}

function _muralOpcoes(k, itens) {
  const def = _muralFiltroDef(k);
  const vals = new Set(itens.map(def.de));
  if (def.dim) _muralFaixaLinhas().forEach(l => vals.add(def.de(_muralFaixaComoItem(l))));
  const arr = [...vals].filter(v => v != null && v !== '');
  return def.ordem ? def.ordem.filter(v => vals.has(v)) : arr.sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
}

function _muralFiltrosHtml(itens) {
  const adm = _moEhAdm();
  const grupos = [['regional', 'ti-users-group', 'Por Regional — regional → central → itens'],
                  ['central', 'ti-building-warehouse', 'Por Central — central → itens'],
                  ['material', 'ti-box', 'Por Material — material → centrais']];
  const filtros = MURAL_FILTROS.filter(x => !x.soAdm || adm).map(x => {
    const ap = _mo.f[x.k], aberto = _mo.fAberto === x.k;
    const nome = x.nome || (v => v);
    const rotulo = ap.size === 1 ? nome([...ap][0]) : ap.size > 1 ? `${x.label} (${ap.size})` : x.label;
    let opcoes = '';
    if (aberto) {
      const marc = _mo.fPend || ap, q = _mo.fBusca.toLowerCase();
      const lista = _muralOpcoes(x.k, itens).filter(v => !q || String(nome(v)).toLowerCase().includes(q));
      opcoes = lista.length ? lista.map((v, n) => `<label class="micro-filter-option" for="mof-${x.k}-${n}">
          <input type="checkbox" id="mof-${x.k}-${n}" ${marc.has(v) ? 'checked' : ''} data-v="${_moEsc(v)}" onchange="muralFiltroMarcar('${x.k}', this)">
          <span class="micro-filter-option-label" title="${_moEsc(nome(v))}">${_moEsc(nome(v))}</span></label>`).join('')
        : '<div style="padding:12px 10px;color:var(--text3);font-size:13.5px;text-align:center">Nenhum resultado</div>';
    }
    return `<div class="micro-filter-group mo-fg" data-k="${x.k}">
      <button class="micro-filter-trigger${ap.size ? ' active' : ''}" onclick="muralFiltroAbrir('${x.k}')"><i class="ti ${x.icon}"></i><span>${_moEsc(rotulo)}</span><i class="ti ti-chevron-down micro-filter-chev${aberto ? ' open' : ''}"></i></button>
      <div class="micro-filter-dropdown${aberto ? ' open' : ''}">
        <div class="micro-filter-search-wrap"><i class="ti ti-search"></i>
          <input class="micro-filter-search" id="mof-busca-${x.k}" type="text" placeholder="Buscar ${x.label.toLowerCase()}…" value="${_moEsc(aberto ? _mo.fBusca : '')}" oninput="muralFiltroBuscar('${x.k}', this.value)"></div>
        <div class="micro-filter-options" id="mof-op-${x.k}">${opcoes}</div>
        <div class="micro-filter-footer">
          <button class="btn btn-filter-clear" onclick="muralFiltroLimpar('${x.k}')"><i class="ti ti-filter-off"></i> Limpar</button>
          <button class="btn" onclick="muralFiltroFechar()"><i class="ti ti-x"></i> Cancelar</button>
          <button class="btn btn-primary" onclick="muralFiltroAplicar('${x.k}')"><i class="ti ti-check"></i> Aplicar</button>
        </div></div></div>`;
  }).join('');
  return `<div class="micro-filter-bar mo-filter-bar">
    <div class="micro-group-mode">${grupos.map(([g, i, t]) => `<button class="${_mo.grupo === g ? 'active' : ''}" onclick="muralGrupo('${g}')" title="${t}" aria-label="${t}"><i class="ti ${i}"></i></button>`).join('')}</div>
    <div class="micro-filter-divider"></div>
    ${filtros}
    ${_muralFiltrosAtivos() ? '<button class="btn btn-sm mo-limpar" onclick="muralFiltrosLimparTodos()"><i class="ti ti-filter-off"></i> Limpar filtros</button>' : ''}
  </div>`;
}

function muralFiltroAbrir(k) {
  if (_mo.fAberto === k) return muralFiltroFechar();
  _mo.fAberto = k; _mo.fPend = new Set(_mo.f[k]); _mo.fBusca = '';
  muralRender();
  document.getElementById(`mof-busca-${k}`)?.focus();
}
function muralFiltroFechar() { _mo.fAberto = null; _mo.fPend = null; _mo.fBusca = ''; muralRender(); }
function muralFiltroMarcar(k, el) { if (!_mo.fPend) return; el.checked ? _mo.fPend.add(el.dataset.v) : _mo.fPend.delete(el.dataset.v); }
// Busca só redesenha a lista de opções, para o campo não perder o foco.
function muralFiltroBuscar(k, q) {
  _mo.fBusca = q;
  const box = document.getElementById(`mof-op-${k}`); if (!box) return;
  const tmp = document.createElement('div'); tmp.innerHTML = _muralFiltrosHtml(_mo._ultItens || []);
  const novo = tmp.querySelector(`#mof-op-${k}`); if (novo) box.innerHTML = novo.innerHTML;
}
function muralFiltroAplicar(k) { _mo.f[k] = new Set(_mo.fPend || []); muralFiltroFechar(); }
function muralFiltroLimpar(k) { _mo.f[k] = new Set(); muralFiltroFechar(); }
function muralFiltrosLimparTodos() { MURAL_FILTROS.forEach(x => { _mo.f[x.k] = new Set(); }); _mo.ids = null; _mo.filtro = 'todos'; muralFiltroFechar(); }
// Clique fora do dropdown aberto = Cancelar (como na Micro).
document.addEventListener('click', e => {
  if (!_mo.fAberto) return;
  if (e.target.closest?.('.mo-fg')) return;   // dentro do próprio filtro
  if (!e.target.isConnected) return;          // botão que o próprio render acabou de trocar
  muralFiltroFechar();
});

// ── Três visões (como na Micro): por Regional, por Central, por Material ──
// Grupos e itens seguem a ordenação escolhida (ver _muralAgrupar). Abertos por
// padrão: os 3 primeiros grupos (e, na visão Regional, as 2 primeiras
// centrais de cada regional aberta); o resto fica recolhido.
function _muralResumoGrupo(its) {
  const vLiq = its.reduce((s, i) => s + i.v, 0), rLiq = its.reduce((s, i) => s + (i.rs || 0), 0);
  const cont = k => its.filter(i => i.nivel === k).length;
  const esc = its.filter(i => i.status === 'escalonado').length, semT = its.filter(i => i.semTratamento).length;
  const cor = v => v < -0.05 ? 'var(--red)' : v > 0.05 ? 'var(--amber)' : 'var(--text2)';
  return `<span class="mo-grp-n">${its.length} ite${its.length === 1 ? 'm' : 'ns'}</span>
    ${['critico', 'urgente', 'atencao'].map(k => cont(k) ? `<span class="mo-lvl" style="--lv:${MURAL_NIVEL[k].cor}">${cont(k)} ${MURAL_NIVEL[k].label}</span>` : '').join('')}
    ${esc ? `<span class="mo-grp-tag mo-red">${esc} escalonado${esc > 1 ? 's' : ''}</span>` : ''}
    ${semT ? `<span class="mo-grp-tag">${semT} sem tratamento</span>` : ''}
    <span class="mo-grp-num" style="color:${cor(vLiq)}">${_moPesoSinal(vLiq)}</span>
    <span class="mo-grp-num mo-hint">${_moRs(rLiq)}</span>`;
}

// A ordem dos GRUPOS segue a ordenação escolhida (Hugo, 09/11/2026):
// prioridade = a maior de dentro; variação = |líquida do grupo| (o número da
// linha); sem explicação = soma do que está sem explicação.
function _muralAgrupar(its, chave) {
  const m = new Map();
  its.forEach(i => { const k = chave(i); if (!m.has(k)) m.set(k, []); m.get(k).push(i); });
  const peso = {
    prio:     g => Math.max(...g.map(i => i.prioridade)),
    kg:       g => Math.abs(g.reduce((s, i) => s + i.v, 0)),
    residual: g => g.reduce((s, i) => s + _moKgResidual(i), 0)
  }[_mo.ordem] || (g => Math.max(...g.map(i => i.prioridade)));
  return [...m].sort((a, b) => peso(b[1]) - peso(a[1]));
}

function _muralGrupoAberto(key, padrao) { return _mo.abertos.has(key) ? _mo.abertos.get(key) : padrao; }

function _muralGrupoHtml(key, titulo, sub, its, aberto, corpo, nivel) {
  return `<details class="mo-grp mo-grp-${nivel}" data-g="${_moEsc(key)}" ${aberto ? 'open' : ''} ontoggle="muralGrupoToggle(this)">
    <summary><i class="ti ti-chevron-right mo-grp-chev"></i><span class="mo-grp-tit">${_moEsc(titulo)}</span>${sub ? `<span class="mo-hint">${_moEsc(sub)}</span>` : ''}
      <span class="mo-grp-res">${_muralResumoGrupo(its)}</span></summary>
    <div class="mo-grp-corpo">${corpo}</div></details>`;
}

function _muralFilaHtml(lista) {
  if (!lista.length) return '<div class="empty-state" style="padding:28px"><p>Nada nesta visão.</p></div>';
  const g = _mo.grupo;
  if (g === 'material') {
    return _muralAgrupar(lista, i => i.material).map(([mat, its], n) => {
      const key = 'mat|' + mat;
      return _muralGrupoHtml(key, mat, `${its[0].categoriaFoto} · ${new Set(its.map(i => i.central)).size} central(is)`, its, _muralGrupoAberto(key, n < 3), its.map(_muralItemHtml).join(''), 1);
    }).join('');
  }
  if (g === 'central') {
    return _muralAgrupar(lista, i => i.central).map(([cen, its], n) => {
      const key = 'cen|' + cen;
      return _muralGrupoHtml(key, cen, `Reg. ${its[0].regional}`, its, _muralGrupoAberto(key, n < 3), its.map(_muralItemHtml).join(''), 1);
    }).join('');
  }
  return _muralAgrupar(lista, i => i.regional || '—').map(([reg, its], n) => {
    const key = 'reg|' + reg;
    const centrais = _muralAgrupar(its, i => i.central).map(([cen, ic], m) => {
      const k2 = 'reg|' + reg + '|' + cen;
      return _muralGrupoHtml(k2, cen, '', ic, _muralGrupoAberto(k2, n < 3 && m < 2), ic.map(_muralItemHtml).join(''), 2);
    }).join('');
    return _muralGrupoHtml(key, `Regional ${reg}`, `${new Set(its.map(i => i.central)).size} central(is)`, its, _muralGrupoAberto(key, n < 3), centrais, 1);
  }).join('');
}

function muralGrupo(g) { _mo.grupo = g; muralRender(); }
function muralGrupoToggle(el) { _mo.abertos.set(el.dataset.g, el.open); }
function muralGruposTodos(abrir) {
  document.querySelectorAll('#mural-root details.mo-grp').forEach(d => { d.open = abrir; _mo.abertos.set(d.dataset.g, abrir); });
}

// ── Aba "Na faixa" ────────────────────────────────────────────────────────
// Pares dentro do limite também ficam à vista (Hugo, 09/11/2026), separados
// da fila. Ordem: mais perto de sair da faixa primeiro (% do limite "bom").
function _muralFaixaLinhas() {
  const thresholds = getHealthThresholds();
  const linhas = [];
  _mo.fotos.forEach(f => {
    const catKey = detectCatKey(f.categoria);
    const lim = thresholds[catKey]?.bom || 0;
    const naFilaAntes = new Set((f.anterior?.payload?.itens || []).map(_moChave));
    (f.atual.payload?.faixa || []).forEach(([central, material, v, regional, ult, v30]) => {
      linhas.push({ central, material, v, v30, regional, ult, categoria: f.categoria, dono: _muralDonoDe(f.categoria).nome,
        pct: lim ? Math.abs(v) / lim * 100 : 0, voltou: naFilaAntes.has(central + '|' + material) });
    });
  });
  return linhas.sort((a, b) => b.pct - a.pct);
}

function _muralFaixaFiltradas() {
  return _muralFaixaLinhas().filter(l => _muralAplicarFiltros([_muralFaixaComoItem(l)], true).length);
}

function _muralFaixaHtml() {
  const linhas = _muralFaixaFiltradas();
  const semDado = _mo.fotos.some(f => !Array.isArray(f.atual.payload?.faixa));
  if (!linhas.length) return `<div class="empty-state" style="padding:28px"><p>${semDado
    ? 'As fotos atuais ainda não trazem os itens na faixa. A próxima foto de cada dono já traz.'
    : 'Nenhum par na faixa nas fotos atuais.'}</p></div>`;
  const adm = _moEhAdm();
  return `<div class="mo-scroll mo-faixa-scroll"><table class="mo-team mo-faixa">
    <thead><tr><th>Material · Central</th>${adm ? '<th>Dono</th>' : ''}<th>Variação</th><th title="Quanto da faixa &quot;bom&quot; da categoria a variação já ocupa">Uso da faixa</th><th>Último lanç.</th></tr></thead>
    <tbody>${linhas.map(l => {
      const cor = l.pct >= 80 ? 'var(--amber)' : 'var(--green)';
      return `<tr><td><b>${_moEsc(l.material)}</b>${l.voltou ? ' <span class="mo-voltou" title="Estava na fila na foto anterior">voltou à faixa</span>' : ''}<small>${_moEsc(l.central)} · Reg. ${_moEsc(l.regional)} · ${_moEsc(l.categoria)}</small></td>
        ${adm ? `<td><small style="font-size:13.5px">${_moEsc(l.dono)}</small></td>` : ''}
        <td style="color:${l.v < -0.05 ? 'var(--red)' : l.v > 0.05 ? 'var(--amber)' : 'inherit'}">${_moKg(l.v)}${l.v30 != null ? `<small>30 dias: ${_moKg(l.v30)}</small>` : ''}</td>
        <td><span class="mo-uso"><i style="width:${Math.min(100, l.pct)}%;background:${cor}"></i></span>${Math.round(l.pct)}%</td>
        <td>${_moEsc((l.ult || '—').slice(0, 5))}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

// ── Ações da tela ──────────────────────────────────────────────────────────
function muralAba(a) { _mo.aba = a; muralRender(); }
function muralFiltro(f) { _mo.filtro = f; _mo.ids = null; _mo.aba = 'fila'; muralRender(); }
function muralOrdem(o) { _mo.ordem = o; muralRender(); }
function muralFiltrarIds(label, el) {
  try { _mo.ids = new Set(JSON.parse(el.dataset.ids || '[]')); } catch (_) { _mo.ids = null; }
  _mo.idsLabel = label; _mo.aba = 'fila';
  muralRender();
  document.querySelector('#mural-root .mo-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function muralVerNaMicro(btn) {
  if (typeof anSwitchView === 'function') anSwitchView('micro');
  if (typeof microFocusFromMacro === 'function') microFocusFromMacro('material', btn.dataset.material);
}
// Reaproveita o modal de comentários da Visão Micro (que também abre a
// ocorrência já preenchida). Ele lê a variação do <tr> mais próximo.
function muralComentar(btn) {
  const tr = document.createElement('tr');
  tr.dataset.diff = btn.dataset.diff;
  const b = document.createElement('button');
  Object.assign(b.dataset, { central: btn.dataset.central, material: btn.dataset.material, periodo: btn.dataset.periodo });
  tr.appendChild(b);
  if (typeof openVarComModal === 'function') openVarComModal(b);
}

// ── Avocar / devolver (só ADM) ─────────────────────────────────────────────
// O ADM (Supervisor) é o único que troca o dono de um item: assume no lugar
// do analista, com motivo e observação obrigatórios — o analista continua
// vendo e é avisado. Devolver encerra a avocação (fica no histórico).
const MURAL_MOTIVOS_AVOCAR = ['Prazo vencido sem ação', 'Exige decisão da gestão', 'Envolve mais de uma categoria na central', 'Analista ausente', 'Outro'];

function muralAvocar(btn) {
  const d = btn.dataset;
  document.getElementById('mural-avocar-overlay')?.remove();
  const ov = document.createElement('div');
  ov.className = 'modal-overlay open';
  ov.id = 'mural-avocar-overlay';
  ov.style.zIndex = '10050';
  ov.innerHTML = `<div class="modal" style="max-width:460px">
    <div class="modal-title"><i class="ti ti-shield-check"></i> Avocar item para o ADM</div>
    <div class="modal-sub">${_moEsc(d.material)} · ${_moEsc(d.central)}. ${_moEsc(d.dono)} continua vendo o item e é avisado(a), com o motivo abaixo.</div>
    <label class="mo-hint" for="mural-av-motivo" style="display:block;margin-top:10px">Motivo</label>
    <select class="form-input" id="mural-av-motivo" style="width:100%">${['', ...MURAL_MOTIVOS_AVOCAR].map(m => `<option value="${_moEsc(m)}">${m || 'Escolha um motivo'}</option>`).join('')}</select>
    <label class="mo-hint" for="mural-av-obs" style="display:block;margin-top:10px">Observação para ${_moEsc(d.dono)} (obrigatória)</label>
    <textarea class="form-input" id="mural-av-obs" rows="3" style="width:100%;resize:vertical"></textarea>
    <div class="form-actions">
      <button class="btn" type="button" onclick="document.getElementById('mural-avocar-overlay').remove()">Cancelar</button>
      <button class="btn btn-primary" id="mural-av-ok" type="button" disabled>Avocar</button>
    </div></div>`;
  document.body.appendChild(ov);
  const motivo = ov.querySelector('#mural-av-motivo'), obs = ov.querySelector('#mural-av-obs'), ok = ov.querySelector('#mural-av-ok');
  const validar = () => { ok.disabled = !(motivo.value && obs.value.trim().length >= 5); };
  motivo.addEventListener('change', validar); obs.addEventListener('input', validar);
  ok.addEventListener('click', async () => {
    ok.disabled = true;
    const { error } = await window.supabaseClient.from('mural_avocacoes').insert({
      central: d.central, material: d.material, categoria: d.categoria,
      motivo: motivo.value, obs: obs.value.trim(), avocado_por: window.currentUser?.id
    });
    if (error) { ok.disabled = false; if (typeof toast === 'function') toast('Não foi possível avocar: ' + error.message, 'error'); return; }
    ov.remove();
    if (typeof toast === 'function') toast(`Item avocado. ${d.dono} será avisado(a).`, 'success');
    muralRecarregar();
  });
}

async function muralDevolver(id) {
  const { error } = await window.supabaseClient.from('mural_avocacoes')
    .update({ devolvido_em: new Date().toISOString(), devolvido_por: window.currentUser?.id }).eq('id', id);
  if (error) { if (typeof toast === 'function') toast('Não foi possível devolver: ' + error.message, 'error'); return; }
  if (typeof toast === 'function') toast('Item devolvido ao dono da categoria.', 'success');
  muralRecarregar();
}

// Auditoria de cobertura (só ADM): o mesmo cálculo do dono, na base
// completa do ADM, comparado com as fotos. Sob demanda — na base de ~1 mi de
// registros não cabe no boot.
async function muralAuditar() {
  if (!_moEhAdm()) return;
  if (typeof _anShowViewLoading === 'function') _anShowViewLoading('Auditando a cobertura', 'Calculando a fila na sua base completa...');
  const t0 = performance.now();
  try {
    const calc = await muralCalcular(CATEGORIAS_MATERIAL);
    const thresholds = getHealthThresholds();
    const fotoPorPar = new Map();
    _mo.fotos.forEach(f => (f.atual.payload?.itens || []).forEach(i => fotoPorPar.set(_moChave(i), i)));
    const comFoto = new Set(_mo.fotos.map(f => f.categoria));
    const fora = [], diverg = [];
    Object.values(calc.porCategoria).forEach(({ itens }) => itens.forEach(i => {
      const dono = fotoPorPar.get(_moChave(i));
      if (!dono) { if (comFoto.has(i.categoria)) fora.push(i); return; }
      if (Math.abs(i.v - dono.v) > (thresholds[i.catKey]?.bom || 0)) diverg.push({ ...i, vAdm: i.v, vDono: dono.v });
    }));
    _mo.auditoria = { quando: new Date().toLocaleString('pt-BR'), ms: Math.round(performance.now() - t0), fora, diverg,
      semCadastro: calc.semCadastroTotal, semCadastroEx: calc.semCadastro };
  } catch (err) {
    _mo.auditoria = { erro: 'Falha na auditoria: ' + (err.message || err) };
  } finally {
    if (typeof _anHideViewLoading === 'function') _anHideViewLoading();
    muralRender();
  }
}
