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
  if (maiorPior >= MURAL_REGRAS.degrauFracao * Math.abs(vn)) return { formato: 'degrau', piorando: ult3 };
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

  const rows = _anSerieDiaria({
    dayList: janela.dayList, lancsMat: lancsJan, sapMat: sapJan,
    preCarry: { value: prev.value, date: prev.date }, isSemanal: catKey === 'agregado'
  });
  const pontos = muralPontos(rows);
  if (!pontos.length) return { pontoCego: 'semLancamento' };
  const ult = pontos[pontos.length - 1];
  const v   = ult.v;
  const nivel = classifyVariation(Math.abs(v), catKey, thresholds);
  if (nivel === 'bom') return { bom: true };

  // Cascata até o último lançamento — fecha com v por construção da série.
  const dtUlt  = parseDate(ult.dt);
  const sapAte = sapJan.filter(s => { const d = parseDate(s.dtLanc); return d && d <= dtUlt; });
  const nat    = repartirSapPorNatureza(sapAte);
  const cascata = {
    ini: _r1(prev.value), ent: _r1(nat.totalEnt), sai: _r1(nat.totalSai), aju: _r1(nat.totalAju),
    teo: _r1(prev.value + nat.totalEnt + nat.totalSai + nat.totalAju), fim: _r1(ult.fim)
  };

  // Parte explicada: divergência PUZL × SAP do par, da janela até o último
  // lançamento (mesma reconciliação por referência da Visão Micro).
  const naJanela = (dt) => { const d = parseDate(dt); return d && d >= janela.ini && d <= dtUlt; };
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
    && classificarEstoqueCapacidade(central, mat, ult.fim).faixa === 'erro';
  const { formato, piorando } = muralFormato(pontos.map(p => p.v), catKey, thresholds, { capErro });
  const entrada = muralEntradaFila(pontos, catKey, thresholds);

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
  [...alvo].forEach(c => { porCategoria[c] = { itens: [], pontosCegos: { semAncora: [], semLancamento: [] } }; });
  let n = 0;
  for (const p of pares.values()) {
    if (!p.categoria || !alvo.has(p.categoria) || !p.catKey) continue;
    const res = muralAvaliarPar({ central: p.central, mat: p.mat, catKey: p.catKey, categoria: p.categoria,
      janela, lancsJan: p.lancs, sapJan: p.sap, thresholds, ctx });
    const dest = porCategoria[p.categoria];
    if (res.item) dest.itens.push(res.item);
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
    const { itens, pontosCegos } = calc.porCategoria[categoria];
    const payload = {
      versao: 1, janela: calc.janela, base: calc.base,
      itens,
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
