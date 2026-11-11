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

// Parte explicada de um trecho: divergência PUZL × SAP do par (mesma
// reconciliação por referência da Visão Micro). nat = repartirSapPorNatureza
// do SAP do trecho; entradas/saidas = PUZL da central (qualquer material).
// Usada pelo cálculo do Mural e pelo Raio-X.
function _muralExplicacao({ central, mat, nat, desde, ate, entradas, saidas }) {
  const noTrecho = (dt) => { const d = parseDate(dt); return d && d >= desde && d <= ate; };
  const puzlEnt = (entradas || []).filter(e => e.material === mat && noTrecho(e.dtDescarga || e.dtEmissao));
  const puzlSai = (saidas   || []).filter(s => s.material === mat && noTrecho(s.dtEmissao));
  const explic = [];
  [['ent', nat.entRecords, puzlEnt], ['sai', nat.saiRecords, puzlSai]].forEach(([lado, sapRecords, puzlRecords]) => {
    const diag = diagnosticarDivergenciaSapPuzl({ sapRecords, puzlRecords, lado, material: mat });
    diag.motivos.forEach(m => {
      if (!MURAL_EXPLICA.has(m.chave) || Math.abs(m.kg) < 0.01) return;
      explic.push({ chave: m.chave, lado, n: m.count, t: m.curto, kg: _r1(muralEfeitoDivergencia(lado, m.kg)) });
    });
  });
  return explic;
}


// PUZL agrupada por central uma vez só (centralDestino primeiro, como o
// diagnóstico da Visão Micro) + índice de Saídas — a parte "explicada".
function _muralCtx() {
  const entradasPorCentral = new Map();
  (state.entradas || []).forEach(e => {
    const c = e.centralDestino || e.centralCompra || '';
    if (!entradasPorCentral.has(c)) entradasPorCentral.set(c, []);
    entradasPorCentral.get(c).push(e);
  });
  ensureSaidasIndex();
  return { entradasPorCentral, saidasPorCentral: _saidasByCentral };
}











// Atualizar do Dashboard Analítico (rodarAnalitico): o dono recalcula e
// publica a própria foto (que recarrega a tela no fim); o ADM e quem não é
// dono de categoria só releem as fotos.
// Toda análise da Micro (renderMacroPanels → _macroAvisarMural) recarrega as
// Operações a partir do registro de pares.
async function muralAtualizar() {
  try { await muralRecarregar(); } catch (err) { console.warn('[Mural] Erro ao atualizar:', err); }
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
const MURAL_PESO_IMPACTO = { financeiro: 1, fisico: 0.5 };
// Saúde da central do item: quanto menor, mais peso — (100 − saúde)% × 6.
// Reincidência: lançamentos SEGUIDOS, até o mais recente, variando no mesmo
// sentido da variação atual — +0,5 cada, teto +5 (Hugo, 11/11/2026).
const MURAL_PESO_SAUDE = 6;
const MURAL_REINC = { porLanc: 0.5, teto: 5 };
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
  filtro: 'todos', ordem: 'prio', ids: null, idsLabel: '', aba: 'fila', series: new Map(), gen: 0, ctx: null, semAnalise: false };

const _moDia = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const _moDiasEntre = (a, b) => Math.round((_moDia(b) - _moDia(a)) / 86400000);
const _moIsoParaData = (iso) => iso ? new Date(String(iso).slice(0, 10) + 'T00:00:00') : null;
const _moKg = (v) => (v < -0.05 ? '−' : v > 0.05 ? '+' : '') + Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' kg';
const _moRs = (v) => (v < -0.5 ? '−' : v > 0.5 ? '+' : '') + 'R$ ' + Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const _moEsc = (s) => escapeHtml(String(s ?? ''));
const _moEhAdm = () => window.currentUser?.role === 'admin';
const _moChave = (i) => i.central + '|' + i.material;
// Lançamento pendente do item ou da linha da faixa: "de 07/11" / "da terça
// 03/11". tercaPendente = nome antigo do campo (fotos anteriores).
const _moPendente = (i) => {
  const p = i.lancPendente || i.tercaPendente;
  if (!p) return '';
  const d = parseDate(p);
  return (d && d.getDay() === 2 ? 'da terça ' : 'de ') + p.slice(0, 5);
};
const _moRsResidual = (i) => Math.abs(i.residual * (i.custoMed || 0));
// O FÍSICO manda (Hugo, 09/11/2026); R$ fica como informação secundária.
const _moKgResidual = (i) => Math.abs(i.residual || 0);
// Totais em toneladas a partir de 10 t, como o Gerencial; abaixo, em kg.
// Tudo em kg (Hugo, 10/11/2026): misturar t e kg atrapalhava comparar.
const _moPeso = (kg) => kg.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' kg';
const _moPesoSinal = (kg) => (kg < -0.05 ? '−' : kg > 0.05 ? '+' : '') + _moPeso(Math.abs(kg));


async function _muralCarregarDonos() {
  const { data, error } = await window.supabaseClient
    .from('analistas_categoria').select('categoria, analista_user_id, analista_nome');
  if (error) throw new Error(error.message);
  const donos = data || [];
  // Nome do dono = NOME DE EXIBIÇÃO do perfil (Hugo, 10/11/2026), não o
  // analista_nome gravado no cadastro. A RLS de profiles deixa o ADM ler
  // todos e o analista só o próprio — que é o único dono que ele vê.
  const nomes = new Map();
  const eu = window.currentUser;
  if (eu?.id && eu.nome_exibicao?.trim()) nomes.set(eu.id, eu.nome_exibicao.trim());
  const ids = [...new Set(donos.map(d => d.analista_user_id).filter(id => id && !nomes.has(id)))];
  if (ids.length && _moEhAdm()) {
    const { data: perfis } = await window.supabaseClient.from('profiles').select('id, nome_exibicao').in('id', ids);
    (perfis || []).forEach(p => { if (p.nome_exibicao?.trim()) nomes.set(p.id, p.nome_exibicao.trim()); });
  }
  return donos.map(d => ({ ...d, analista_nome: nomes.get(d.analista_user_id) || d.analista_nome }));
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

// ── Os pares vêm da Visão Micro (Hugo, 11/11/2026) ───────────────────────
// As Operações não têm conta própria: cada par vem do registro que a Micro
// preenche ao montar os cards (window.__anPares, analitico.js) — mesmo
// período do Analítico, mesmo Est. Inicial/Final, mesmas NFs/OS pendentes
// consideradas. Cada um vê a própria base (as fotos foram desligadas); o
// analista, só as categorias dele. Montado no formato "por categoria" que o
// resto do Mural lê: itens (fora da faixa), faixa (na faixa) e semLanc
// (sem lançamento no último dia — AUSENTE na Micro, com o mesmo valor dela).
function muralPeriodo() {
  if (!window.__analiticoDtIni || !window.__analiticoDtFim) return null;
  return { ini: _moDia(window.__analiticoDtIni), fim: _moDia(window.__analiticoDtFim) };
}

function _muralFotosDaMicro(donos) {
  const reg = window.__anPares, per = muralPeriodo();
  if (!reg || !reg.size || !per) return null;
  const eu = window.currentUser?.id;
  const minhas = new Set(donos.filter(d => d.analista_user_id === eu).map(d => normalizeCategoriaMaterial(d.categoria)));
  const fil = getFilialLookupIndex().exact, porCat = new Map();
  reg.forEach(e => {
    const categoria = normalizeCategoriaMaterial(e.categoria) || e.categoria || '—';
    if (!_moEhAdm() && !minhas.has(categoria)) return;
    if (!porCat.has(categoria)) porCat.set(categoria, { itens: [], faixa: [], semLanc: [] });
    const dest = porCat.get(categoria);
    const regional = (fil.get(normalizeText(e.central))?.regional || '').trim() || '—';
    const v = _r1(e.diff), custo = e.custoMed || 0;
    if (e.ausente) {
      dest.semLanc.push({ central: e.central, material: e.material, regional, catKey: e.catKey, categoria, nivel: e.nivel,
        v, rs: _r1(v * custo), esperado: e.fimEsperado, teo: e.estTeorico });
    } else if (e.nivel === 'bom') {
      dest.faixa.push([e.central, e.material, v, regional, e.dtFimLabel || e.fimEsperado, v, null]);
    } else {
      // entrada/formato/piorando/explic chegam depois (_muralEnriquecer, em
      // segundo plano); até lá o prazo aparece como "calculando".
      dest.itens.push({ central: e.central, material: e.material, categoria, catKey: e.catKey, codSap: getCodSapPorGrupo(e.material) || '',
        regional, nivel: e.nivel, formato: null, piorando: false, v, custoMed: custo, rs: _r1(v * custo), v30: v, rs30: _r1(v * custo),
        atual: true, desde: fmtPtDate(per.ini), primeiroMes: null, pontos: [], explicadoKg: 0, explic: [], meses: 1, capErro: false, lancPendente: null });
    }
  });
  const dia = localISODate(new Date());
  return [...porCat].map(([categoria, p]) => ({ categoria, anterior: null,
    atual: { dia, payload: { janela: { ini: fmtPtDate(per.ini), fim: fmtPtDate(per.fim) }, base: {}, ...p } } }));
}

// Série do período (a mesma do Raio-X) de um par, com cache por análise:
// alimenta a data de entrada na fila, o formato, "piorando" e a linha da saúde.
function _muralSeriePar(central, mat, catKey) {
  const k = central + '|' + mat;
  if (!_mo.series.has(k)) {
    const rx = muralRaioXCalcular(central, mat, catKey, 'mes', { semExplic: true });
    _mo.series.set(k, rx ? { dayList: rx.dayList, acc: rx.acc, lanc: rx.rows.map(r => !!r.hasLanc), dt: rx.rows.map(r => r.dateLabel) } : null);
  }
  return _mo.series.get(k);
}

// Cede a vez ao navegador por TEMPO (~12 ms de trabalho por fatia), não por
// número de itens: fatias pequenas demais somavam centenas de pausas.
async function muralCederTempo(estado) {
  if (performance.now() - estado.t < 12) return;
  await yieldToUI(); estado.t = performance.now();
}

async function _muralEnriquecer(gen) {
  const th = getHealthThresholds();
  const itens = _mo.fotos.flatMap(f => f.atual.payload.itens);
  const P = muralPeriodo(), ced = { t: performance.now() };
  _mo.enriquecendo = true;
  for (let n = 0; n < itens.length; n++) {
    if (gen !== _mo.gen) return;
    const it = itens[n], s = _muralSeriePar(it.central, it.material, it.catKey);
    const pontos = s ? s.lanc.map((l, i) => l ? { dt: s.dt[i], v: s.acc[i] } : null).filter(Boolean) : [];
    it.pontos = pontos.map(p => [p.dt, _r1(p.v)]);
    it.entrada = muralEntradaFila(pontos, it.catKey, th);
    Object.assign(it, muralFormato(pontos.map(p => p.v), it.catKey, th));
    let meses = 1;
    for (let k = 0; k < 3; k++) {
      const ant = _anGetVarMesAnterior(it.central, it.material, new Date(P.ini.getFullYear(), P.ini.getMonth() - k, 1));
      if (!ant || Math.sign(ant.diff) !== Math.sign(it.v) || classifyVariation(Math.abs(ant.diff), it.catKey, th) === 'bom') break;
      meses++;
    }
    it.meses = meses;
    await muralCederTempo(ced);
  }
  if (gen !== _mo.gen) return;
  _mo.enriquecendo = false;
  _muralAvisos();
  muralRender();
}

async function muralRecarregar() {
  if (_mo.carregando || !window.supabaseClient) return;
  _mo.carregando = true; _mo.erro = null;
  try {
    const [donos, avocacoes] = await Promise.all([_muralCarregarDonos(), _muralCarregarAvocacoes()]);
    _mo.donos = donos; _mo.avocacoes = avocacoes;
    _mo.gen = (_mo.gen || 0) + 1; _mo.series = new Map(); _mo.ctx = null;
    const fotos = _muralFotosDaMicro(donos);
    _mo.semAnalise = !fotos;
    _mo.fotos = fotos || []; _mo.carregado = true;
    if (fotos) _muralEnriquecer(_mo.gen).catch(err => { _mo.enriquecendo = false; console.warn('[Mural] Erro ao calcular as séries:', err); });
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
// (só as categorias dele); o ADM, os de todos.
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
  const fech = _muralFechamento(hoje), dFech = _moDiasEntre(hoje, fech);
  const semTrat = itens.filter(i => i.semTratamento).length;
  if (dFech <= 5) add('fechamento', semTrat, 'critico', `Fechamento em ${dFech} dia${dFech === 1 ? '' : 's'}: ${plural(semTrat, 'item sem tratamento', 'itens sem tratamento')}`,
    'Tudo acima do limite precisa ter a causa comentada ou ocorrência aberta antes do fechamento.', 'semtrat');
  const avoc = itens.filter(i => i.avocado);
  if (!_moEhAdm()) add('avocados', avoc.length, 'atencao', `Mural: ${plural(avoc.length, 'item seu foi avocado', 'itens seus foram avocados')} pelo ADM`,
    avoc.map(i => `${i.material} · ${i.central}: ${i.avocado.motivo}`).slice(0, 3).join('; '), 'avocados');
  notifSyncMural(av);
}

// ── Itens com o estado de ação derivado ───────────────────────────────────
// Avisos de comentário (notifPushComentario): o ADM vê tudo; o analista,
// só os pares da(s) categoria(s) dele em analistas_categoria.
function muralParMeInteressa(material) {
  if (_moEhAdm()) return true;
  const eu = window.currentUser?.id;
  const cat = normalizeCategoriaMaterial(getCategoriaPorGrupo(material));
  return !!eu && !!cat && _mo.donos.some(d => d.analista_user_id === eu && normalizeCategoriaMaterial(d.categoria) === cat);
}

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
  // Saúde de cada central com todos os pares dela (fila, faixa e sem
  // lançamento) — a mesma conta do painel da central, sem os filtros da barra.
  const paresCentral = new Map();
  const somar = (central, mat, diff, catKey) => { if (!paresCentral.has(central)) paresCentral.set(central, []); paresCentral.get(central).push({ mat, diff, catKey }); };
  _mo.fotos.forEach(f => {
    const p = f.atual.payload || {};
    (p.itens || []).forEach(i => somar(i.central, i.material, i.v, i.catKey));
    (p.faixa || []).forEach(([central, mat, v]) => somar(central, mat, v, getCatKeyDoCadastro(mat) || detectCatKey(f.categoria)));
    (p.semLanc || []).forEach(x => somar(x.central, x.material, x.v, x.catKey));
  });
  const saudeCentral = new Map([...paresCentral].map(([c, ps]) => [c, calcHealthScore(ps, null, null, thresholds).score]));
  _mo.fotos.forEach(f => {
    const p = f.atual.payload || {};
    const janelaIni = parseDate(p.janela?.ini) || hoje;
    const anteriores = new Map(((f.anterior?.payload?.itens) || []).map(i => [_moChave(i), i]));
    const dono = _muralDonoDe(f.categoria);
    (p.itens || []).forEach(it => {
      // Início do trecho da variação principal (dia 1 do mês, ou a janela de
      // 30 dias nas fotos antigas / sem lançamento no mês).
      const inicioTrecho = parseDate(it.desde) || janelaIni;
      // entrada === undefined: a série do período ainda está sendo calculada
      // (_muralEnriquecer) — sem prazo até lá, para não mostrar vencido errado.
      const semSerie = it.entrada === undefined;
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
      const vencido = !semSerie && !temOc && hoje > limite;
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
      // Reincidência: do lançamento mais recente para trás, quantos seguidos
      // variaram (em relação ao anterior) no mesmo sentido da variação atual.
      // Lançamento sem variação não conta nem zera. ponytail: limiar fixo de
      // 0,05 kg; virar limite por categoria se ruído pequeno atrapalhar.
      const pts = it.pontos || [];
      let seguidos = 0;
      for (let k = pts.length - 1; k >= 0; k--) {
        const d = pts[k][1] - (k ? pts[k - 1][1] : 0);
        if (Math.abs(d) < 0.05) continue;
        if (Math.sign(d) !== Math.sign(it.v)) break;
        seguidos++;
      }
      const saude = saudeCentral.get(it.central) ?? 100;
      const partes = [
        ['Gravidade × tendência', (MURAL_GRAV[it.nivel] || 0) * (MURAL_TEND[it.formato] || 1)],
        ['Impacto financeiro (R$)', MURAL_PESO_IMPACTO.financeiro * Math.log10(Math.abs(it.rs || 0) + 1)],
        [`Impacto físico (${vezesLimite.toFixed(1)}× o limite Crítico)`, MURAL_PESO_IMPACTO.fisico * Math.log2(1 + vezesLimite)],
        [`Saúde da central ${it.central} (${saude}%)`, (100 - saude) / 100 * MURAL_PESO_SAUDE],
        [`Reincidência: ${seguidos} lançamento${seguidos === 1 ? '' : 's'} seguido${seguidos === 1 ? '' : 's'} no mesmo sentido`, Math.min(seguidos * MURAL_REINC.porLanc, MURAL_REINC.teto)],
        ['Dias sem ação × 0,3', Math.min(diasSemAcao, 10) * 0.3],
        ['Meses seguidos fora da faixa', ((it.meses || 1) - 1) * 1.5],
        ['Prazo vencido', vencido ? 3 : 0],
        ['Ocorrência aberta e variação crescendo', ocCrescendo ? 2 : 0]
      ];
      const status = (vencido || ocCrescendo) ? 'escalonado' : temOc ? 'tratamento' : novo ? 'novo' : 'semAcao';
      const avocado = _mo.avocacoes.find(a => a.central === it.central && a.material === it.material) || null;
      itens.push({ ...it, categoriaFoto: f.categoria, dono, avocado, causa, entrada, limite, limitadoPeloFechamento, fechamento, semSerie,
        temOc, semTratamento, ocs, comentarios, diasSemAcao, vencido, ocCrescendo, novo, piorou, residual,
        herdadaKg, novaKg: it.v - herdadaKg, seguidos, saudeCentral: saude,
        prioridade: partes.reduce((s, x) => s + x[1], 0), partes, status });
    });
  });
  return itens;
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

// Prazo em texto curto para a coluna Situação da linha (Proposta A).
// { t, red }: red = vencido ou batendo no fechamento.
function _muralPrazoTxt(it) {
  if (it.temOc) {
    const lim = it.ocs.map(o => o.limite).filter(Boolean).sort((a, b) => a - b)[0];
    const d = lim ? _moDiasEntre(new Date(), lim) : null;
    const t = `${it.ocs.map(o => o.numero).join(', ') || 'Ocorrência'} aberta`
      + (d == null ? '' : d < 0 ? ` · central vencida há ${-d} d` : ` · central até ${fmtPtDate(lim).slice(0, 5)}`)
      + (it.ocCrescendo ? ' · crescendo desde a abertura' : '');
    return { t, red: (d != null && d < 0) || it.ocCrescendo };
  }
  if (it.semSerie) return { t: 'calculando o prazo…', red: false };
  const d = _moDiasEntre(new Date(), it.limite);
  const exige = it.nivel === 'critico' ? ' · exige ocorrência' : '';
  if (d < 0) return { t: `Prazo vencido há ${-d} dia${d < -1 ? 's' : ''}${exige}`, red: true };
  return { t: `${d === 0 ? 'Prazo vence hoje' : `${d} dia${d > 1 ? 's' : ''} para agir`}${it.limitadoPeloFechamento ? ' (fechamento)' : ''}${exige}`, red: it.limitadoPeloFechamento };
}




// Contagem regressiva do fechamento: tudo acima do limite precisa estar
// tratado (comentário com a causa ou ocorrência aberta) antes dele; o
// fechamento só ajusta o que sobrar sem explicação.
// ── Topo: Proposta B (Hugo, 10/11/2026) ──────────────────────────────────
// Placar do fechamento: quanto da fila já tem tratamento (comentário com
// causa ou ocorrência) e quanto falta até o fechamento, com o impacto do mês
// ao lado. Substitui os 7 KPIs e a faixa do fechamento.
// Barra: tratados (verde) · sem tratamento escalonados (vermelho) · sem
// tratamento ainda no prazo (âmbar).
function _muralBarraFech(its) {
  const tot = its.length || 1;
  const semT = its.filter(i => i.semTratamento);
  const esc = semT.filter(i => i.status === 'escalonado').length;
  const p = n => (n / tot * 100).toFixed(2) + '%';
  return `<div class="mo-fbar" role="img" aria-label="${its.length - semT.length} de ${its.length} tratados">
    <i style="width:${p(its.length - semT.length)};background:var(--green)"></i><i style="width:${p(esc)};background:var(--red)"></i><i style="width:${p(semT.length - esc)};background:var(--amber)"></i></div>`;
}

// pares: todos os pares da análise (fila + faixa + sem lançamento) — a
// variação e o custo são o TOTAL, o mesmo da Visão Micro; a fila vem embaixo.
function _muralPlacarHtml(fila, pares = fila) {
  const fech = _muralFechamento(_moDia(new Date()));
  const dias = _moDiasEntre(new Date(), fech);
  const semT = fila.filter(i => i.semTratamento).length;
  const trat = fila.length - semT;
  const soma = (arr, f, cond = () => true) => arr.reduce((s, i) => s + (cond(i) ? f(i) : 0), 0);
  const vLiq = soma(pares, i => i.v), vDes = soma(pares, i => i.v, i => i.v < 0), vSob = soma(pares, i => i.v, i => i.v > 0);
  const rLiq = soma(pares, i => i.rs || 0);
  const v30 = soma(fila, i => i.v), r30 = soma(fila, i => i.rs || 0); // parte fora da faixa
  const cor = v => v < -0.05 ? 'var(--red)' : v > 0.05 ? 'var(--amber)' : 'var(--text)';
  const corDias = dias <= 3 && semT ? 'var(--red)' : dias <= 7 && semT ? 'var(--urgente)' : 'var(--text)';
  return `<div class="mo-placar">
    <div class="mo-placar-fech">
      <div class="mo-placar-l1">
        <span class="mo-placar-dias" style="color:${corDias}">${dias === 0 ? 'Fechamento hoje' : `${dias} dia${dias > 1 ? 's' : ''}`}</span>
        <span class="mo-hint">${dias === 0 ? '' : 'até o fechamento '}(${fmtPtDate(fech)})</span>
        <span class="mo-placar-trat"><b>${trat}/${fila.length}</b> tratados${semT ? ` · <button class="mo-link" onclick="muralFiltro('semtrat')"><b>${semT}</b> sem tratamento</button>` : ''}</span>
      </div>
      ${_muralBarraFech(fila)}
      <div class="mo-fleg"><span><i style="background:var(--green)"></i>Tratados (comentário com causa ou ocorrência)</span><span><i style="background:var(--red)"></i>Sem tratamento, escalonados</span><span><i style="background:var(--amber)"></i>Sem tratamento, no prazo</span></div>
    </div>
    <div class="mo-placar-num" title="${_moEsc(_moPesoSinal(vDes) + ' desfalque · ' + _moPesoSinal(vSob) + ' sobra')}"><span class="mo-kpi-label">Variação do período</span><b style="color:${cor(vLiq)}">${_moPesoSinal(vLiq)}</b><span class="mo-hint mono">na fila ${_moPesoSinal(v30)}</span></div>
    <div class="mo-placar-num"><span class="mo-kpi-label">Custo</span><b style="color:${cor(rLiq)}">${_moRs(rLiq)}</b><span class="mo-hint mono">na fila ${_moRs(r30)}</span></div>
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
    ${typeof _mpGruposHtml === 'function' ? _mpGruposHtml() : ''}${filtros}
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
    (f.atual.payload?.faixa || []).forEach(([central, material, v, regional, ult, v30, terPend, baseAdm]) => {
      linhas.push({ central, material, v, v30, regional, ult, terPend, baseAdm, categoria: f.categoria, dono: _muralDonoDe(f.categoria).nome,
        pct: lim ? Math.abs(v) / lim * 100 : 0, voltou: naFilaAntes.has(central + '|' + material) });
    });
  });
  return linhas.sort((a, b) => b.pct - a.pct);
}

function _muralFaixaFiltradas() {
  return _muralFaixaLinhas().filter(l => _muralAplicarFiltros([_muralFaixaComoItem(l)], true).length);
}




// Atalhos do placar e do sino → filtro Situação da barra.
function muralFiltro(f) {
  _mo.f.status = new Set({ semtrat: ['semAcao', 'escalonado'], vencido: ['escalonado'] }[f] || []);
  if (typeof _mp !== 'undefined') { _mp.aba = 'fila'; _mp.sel = { tipo: 'geral' }; }
  muralRender();
}

// ── Render: lista + painel (mural-painel.js) ──────────────────────────────
// A visão anterior (fila em cartões, cartões laterais) foi retirada em
// 11/11/2026, junto com as fotos: a fonte é a análise da Visão Micro.
function muralRender() {
  const el = document.getElementById('mural-root');
  if (!el) return;
  if (!_mo.carregado && !_mo.carregando && !_mo.erro) { muralRecarregar(); return; }
  if (_mo.erro) { el.innerHTML = `<div class="empty-state"><p>Não foi possível ler as Operações: ${_moEsc(_mo.erro)}</p></div>`; return; }
  if (!_mo.carregado) { el.innerHTML = '<div class="empty-state"><p>Carregando…</p></div>'; return; }
  if (_mo.semAnalise) {
    el.innerHTML = '<div class="empty-state"><p>As Operações usam a mesma análise da Visão Micro. Escolha o período no Dashboard Analítico e clique em <b>Analisar</b>.</p></div>';
    return;
  }
  const itens = muralItensDerivados();
  _mo._ultItens = itens;
  muralPainelRender(el, itens);
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


// ── Raio-X do item ─────────────────────────────────────────────────────────
// Detalhe de um par da fila (Hugo, 09/11/2026), calculado na hora a partir
// da base local (o ADM tem a base completa; o analista, a da categoria dele).
// Mesma conta serve à gaveta do Raio-X e às Movimentações (modal da Micro).
// Âncora sempre no saldo do SAP no início do período, como o Mural.
// Sem abas de período (Hugo, 09/11/2026): o Raio-X abre em 'invs' e o
// clique numa barra abre o mês.
//   'invs' → inventário a inventário: uma barra por mês fechado ANTES do
//            período do Analítico (MURAL_RX_MESES meses) + o período
//   'inv:AAAA-MM' → dia a dia do mês fechado AAAA-MM
//   'mes'  → o PERÍODO DO ANALÍTICO (Hugo, 11/11/2026): o mesmo da Visão
//            Micro, com o resumo do card dela (_muralResumoMicro). Sem
//            análise ainda, do dia 1 até ontem.
function _muralRxPeriodo(periodo) {
  const J = muralJanela();
  const P = muralPeriodo() || { ini: new Date(J.fim.getFullYear(), J.fim.getMonth(), 1), fim: J.fim };
  if (periodo === 'invs') return { ini: new Date(P.ini.getFullYear(), P.ini.getMonth() - MURAL_RX_MESES, 1), fim: P.fim };
  if (String(periodo).startsWith('inv:')) {
    const [a, m] = periodo.slice(4).split('-').map(Number);
    return { ini: new Date(a, m - 1, 1), fim: new Date(a, m, 0) };
  }
  return { ini: P.ini, fim: P.fim };
}

// opts.semExplic: pula o diagnóstico PUZL × SAP (o caro) — a série das
// Operações só precisa dos lançamentos; o explicado sai sob demanda.
function muralRaioXCalcular(central, mat, catKey, periodo, opts = {}) {
  const p = _muralRxPeriodo(periodo);
  if (!p) return null;
  const dayList = [];
  for (const d = new Date(p.ini); d <= p.fim; d.setDate(d.getDate() + 1)) dayList.push(new Date(d));
  const ate = new Date(p.fim); ate.setHours(23, 59, 59, 999);
  const noPer = r => { const d = parseDate(r.dtLanc); return d && d >= p.ini && d <= ate; };
  const lancs = (getLancIndex().byCentralMat.get(central)?.get(mat) || []).filter(noPer);
  const sap = (getSapIndex().byCentralMat.get(central)?.get(mat) || []).filter(r => noPer(r) && !isSapExcluidoPorFechamento(r));
  const anc = _anGetSapStock({ central, material: mat, dtIni: p.ini });
  const isSemanal = isCatKeySemanal(catKey);
  const rows = _anSerieDiaria({ dayList, lancsMat: lancs, sapMat: sap,
    preCarry: anc ? { value: anc.value, date: anc.date } : null, isSemanal });
  let acum = 0;
  const acc = rows.map(r => (acum += r.diff || 0));
  let iUlt = -1;
  rows.forEach((r, i) => { if (r.hasLanc) iUlt = i; });

  // Cascata até o último lançamento — fecha com a variação, como no Mural.
  const dtUlt = iUlt >= 0 ? new Date(dayList[iUlt]) : new Date(p.fim);
  dtUlt.setHours(23, 59, 59, 999);
  const nat = repartirSapPorNatureza(sap.filter(r => parseDate(r.dtLanc) <= dtUlt));
  const cods = (recs, vazio) => _codsLabel(recs.map(r => [normMov(r.movimento)]), vazio);
  const ini = anc ? anc.value : 0;
  const estTeorico = ini + nat.totalEnt + nat.totalSai + nat.totalAju;
  // Entradas por central agrupadas uma vez por análise (_mo.ctx), não a cada par.
  const ctx = opts.semExplic ? null : (_mo.ctx || (_mo.ctx = _muralCtx()));
  const explic = opts.semExplic ? [] : _muralExplicacao({ central, mat, nat, desde: p.ini, ate: dtUlt,
    entradas: ctx.entradasPorCentral.get(central), saidas: ctx.saidasPorCentral.get(central) });
  const ultLabel = iUlt >= 0 ? rows[iUlt].dateLabel : '';
  return {
    periodo, ini: p.ini, fim: p.fim, dayList, rows, acc, iUlt, explic, isSemanal,
    temDados: lancs.length > 0 || sap.length > 0,
    payload: {
      key: 'mural-rx', central, material: mat, catKey, isSemanal,
      periodLabel: `${fmtPtDate(p.ini)} a ${fmtPtDate(p.fim)}`,
      summary: {
        pesoIni: ini, pesoIniAusente: !anc, dtIniLabel: anc ? `Saldo SAP em ${anc.dtLabel}` : 'Sem âncora no Custos SAP',
        totalEnt: nat.totalEnt, entLabel: cods(nat.entRecords, 'Sem entradas no período'),
        totalSai: nat.totalSai, saiLabel: cods(nat.saiRecords, 'Sem saídas no período'),
        totalAju: nat.totalAju, ajuLabel: cods(nat.ajuRecords, 'Sem ajustes no período'),
        estTeorico, pesoFim: iUlt >= 0 ? rows[iUlt].finalStock : 0, pesoFimAusente: iUlt < 0,
        dtFimLabel: iUlt >= 0 ? `Último lançamento: ${ultLabel}` : 'Sem lançamento no período',
        fimFallback: false, diff: iUlt >= 0 ? acc[iUlt] : 0, absentNearest: null,
        // Período do Analítico: o resumo é o do card da Micro, número a número.
        ...(_muralResumoMicro(periodo, central, mat) || {})
      },
      days: rows
    }
  };
}

// Resumo do card da Visão Micro para o par (window.__anPares, analitico.js).
function _muralResumoMicro(periodo, central, mat) {
  const r = periodo === 'mes' ? window.__anPares?.get(central + '|' + mat) : null;
  if (!r) return null;
  return { pesoIni: r.pesoIni, pesoIniAusente: r.iniAusente, dtIniLabel: r.iniAusente ? 'Sem âncora no Custos SAP' : `Saldo SAP em ${r.dtIniLabel}`,
    totalEnt: r.totalEnt, totalSai: r.totalSai, totalAju: r.totalAju, estTeorico: r.estTeorico,
    pesoFim: r.ausente ? 0 : r.pesoFim, pesoFimAusente: r.ausente,
    dtFimLabel: r.ausente ? `AUSENTE: sem lançamento em ${r.fimEsperado}` : `Lançamento: ${r.dtFimLabel}`, diff: r.diff, micro: true };
}

// ── Peças comuns dos gráficos do Raio-X (dia a dia e inventários) ────────
const MO_RX_DIM = { W: 740, H: 274, L: 100, R: 12, T: 24, B: 50 };
// Tamanho no gráfico expandido (muralRxExpandir); _moRxDim é o que vale na
// hora de desenhar. ponytail: troca global e volta, em vez de passar o
// tamanho por parâmetro por todas as funções.
const MO_RX_DIM_GRANDE = { W: 1320, H: 540, L: 112, R: 16, T: 28, B: 56 };
let _moRxDim = MO_RX_DIM;
const _moRxF = v => v.toFixed(1);
// Cor em hex porque _showTip (macro.js) pinta a borda do balão com ela.
const _moRxHex = v => v < -0.05 ? '#f43f5e' : v > 0.05 ? '#f59e0b' : '#7b85a0';
const _moRxNivel = (v, lim) => { const a = Math.abs(v); return a <= lim.bom ? ['NA FAIXA', '#10b981'] : a <= lim.atencao ? ['ATENÇÃO', '#f59e0b'] : a <= lim.urgente ? ['URGENTE', '#f97316'] : ['CRÍTICO', '#f43f5e']; };
const _moRxLinha = (rot, val, cor) => `<div style="color:var(--text2)">${rot}</div><div style="color:${cor || 'var(--text)'};text-align:right;font-weight:600">${val}</div>`;
// Balão no padrão dos donuts da Macro, mostrado por delegação na gaveta.
const _moRxTip = (cor, titulo, dir, grade, extra = '') => encodeURIComponent(`<div class="mo-rx-tipw" style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
    <span style="width:10px;height:10px;border-radius:3px;background:${cor};flex-shrink:0"></span>
    <span style="font-weight:700;font-size:15px;color:var(--text)">${titulo}</span>
    <span style="margin-left:auto;font-family:var(--mono);font-size:13px;color:${cor};font-weight:700">${dir}</span></div>
  ${grade ? `<div style="display:grid;grid-template-columns:auto auto;gap:7px 20px;font-family:var(--mono);font-size:13.5px">${grade}</div>` : ''}${extra}`);
const _MO_RX_DICA_MOV = '<div style="margin-top:10px;font-size:13px;color:var(--text2)">Clique para ver as movimentações</div>';

// Escala vertical, faixa "bom", tracejados de limite/crítico, rótulos no
// eixo da esquerda (fora da área do gráfico, pulando os que ficariam a
// menos de 14 px de outro), linha do zero e legenda.
function _muralRxEixo(vals, lim) {
  const { W, H, L, R, T, B } = _moRxDim, f = _moRxF;
  const maxAbs = Math.max(0, ...vals.map(Math.abs));
  const linhas = [[lim.bom, 'limite'], ...(maxAbs > lim.atencao ? [[lim.urgente, 'crítico']] : [])].filter(([v]) => v > 0);
  let yMax = Math.max(0, ...vals, ...linhas.map(([v]) => v)), yMin = Math.min(0, ...vals, ...linhas.map(([v]) => -v));
  const pad = (yMax - yMin) * 0.08 || 1; yMax += pad; yMin -= pad;
  const y = v => T + (yMax - v) / (yMax - yMin) * (H - T - B);
  const corLinha = rot => rot === 'crítico' ? 'var(--red)' : 'var(--green)';
  const svg = [];
  if (lim.bom > 0) svg.push(`<rect x="${L}" y="${f(y(lim.bom))}" width="${W - L - R}" height="${f(y(-lim.bom) - y(lim.bom))}" fill="var(--green)" opacity=".07"/>`);
  linhas.forEach(([v, rot]) => [v, -v].forEach(s => svg.push(
    `<line x1="${L}" x2="${W - R}" y1="${f(y(s))}" y2="${f(y(s))}" stroke="${corLinha(rot)}" stroke-dasharray="5 4" opacity=".55"/>`)));
  const ticks = [];
  [[0, 'var(--text3)'], ...linhas.flatMap(([v, rot]) => [[v, corLinha(rot)], [-v, corLinha(rot)]]),
   [Math.max(0, ...vals), 'var(--text3)'], [Math.min(0, ...vals), 'var(--text3)']]
    .forEach(([v, c]) => { if (!ticks.some(t => Math.abs(y(t[0]) - y(v)) < 14)) ticks.push([v, c]); });
  ticks.forEach(([v, c]) => svg.push(`<text x="${L - 8}" y="${f(y(v) + 4)}" text-anchor="end" class="mo-rx-ax" style="fill:${c}">${_moPesoSinal(v)}</text>`));
  svg.push(`<line x1="${L}" x2="${W - R}" y1="${f(y(0))}" y2="${f(y(0))}" stroke="var(--border3)"/>`);
  const leg = linhas.map(([v, rot]) => `<span><i style="border-color:${corLinha(rot)}"></i>${rot === 'crítico' ? 'Crítico' : 'Limite da faixa'} ±${_moPeso(v)}</span>`).join('');
  return { y, svg, leg };
}
const _muralRxSvg = (svg, leg, rotulo) => `<svg class="mo-rx-chart" viewBox="0 0 ${_moRxDim.W} ${_moRxDim.H}" role="img" aria-label="${rotulo}">${svg.join('')}</svg>
  ${leg ? `<div class="mo-rx-leg">${leg}</div>` : ''}`;

// Gráfico da variação acumulada dia a dia: pontos nos lançamentos (balão),
// fechamento em roxo na virada do mês e marcas das ações embaixo.
// gran: 'dia' (um ponto por lançamento) ou 'sem' (uma ponta por semana, de
// quarta a terça — a ponta é o último lançamento da semana, posicionada na
// terça). Só a visualização muda; a variação acumulada é a mesma conta.
function _muralRxChart(rx, lim, acoes, gran = 'dia') {
  const n = rx.rows.length;
  if (!n) return '';
  const { W, H, L, R, T, B } = _moRxDim, f = _moRxF;
  const x = i => L + (n > 1 ? i * (W - L - R) / (n - 1) : (W - L - R) / 2);
  const semanas = [];
  if (gran === 'sem') {
    const porSem = new Map();
    rx.rows.forEach((r, j) => {
      if (!r.hasLanc) return;
      const ter = new Date(rx.dayList[j]); ter.setDate(ter.getDate() + (2 - ter.getDay() + 7) % 7);
      const k = localISODate(ter);
      if (!porSem.has(k)) porSem.set(k, { ter, idx: [] });
      porSem.get(k).idx.push(j);
    });
    porSem.forEach(({ ter, idx }) => {
      const iTer = rx.dayList.findIndex(d => localISODate(d) === localISODate(ter));
      const j = idx[idx.length - 1];
      semanas.push({ i: iTer >= 0 ? iTer : j, j, ter, idx, v: rx.acc[j] });
    });
  }
  // Linha: dia a dia até o último lançamento, ou ligando as pontas semanais
  // a partir do saldo de abertura (zero) no 1º dia.
  const linha = gran === 'sem'
    ? [...(semanas.length && semanas[0].i > 0 ? [{ i: 0, v: 0 }] : []), ...semanas]
    : rx.acc.slice(0, rx.iUlt >= 0 ? rx.iUlt + 1 : 0).map((v, i) => ({ i, v }));
  const vals = linha.map(p => p.v);
  const { y, svg, leg } = _muralRxEixo(vals, lim);
  const ultV = vals.length ? vals[vals.length - 1] : 0;
  const cor = ultV < -0.05 ? 'var(--red)' : ultV > 0.05 ? 'var(--amber)' : 'var(--text2)';
  const pts = linha.map(p => `${f(x(p.i))},${f(y(p.v))}`).join(' ');
  const xUlt = linha.length ? x(linha[linha.length - 1].i) : x(0);
  const xEvery = Math.max(1, Math.ceil(n / (W > 1000 ? 16 : 8)));
  const idxMarcas = svg.length;
  rx.dayList.forEach((d, i) => {
    // Fechamento (virada do mês): linha roxa contínua entre o último dia do
    // mês e o dia 1, trecho anterior levemente apagado (já ajustado no
    // fechamento) e etiqueta — não se confunde com limite/crítico/ações.
    if (i > 0 && d.getDate() === 1) {
      const xm = (x(i - 1) + x(i)) / 2, lx = xm + 90 > W - R ? xm - 88 : xm + 4; // etiqueta vira p/ a esquerda perto da borda
      svg.push(`<rect x="${L}" y="${T}" width="${f(xm - L)}" height="${H - B - T}" fill="var(--bg)" opacity=".35"/>`,
        `<line x1="${f(xm)}" x2="${f(xm)}" y1="2" y2="${H - B}" stroke="var(--purple)" stroke-width="2.5"/>`,
        `<rect x="${f(lx)}" y="2" width="84" height="18" rx="4" fill="var(--purple)"/>`,
        `<text x="${f(lx + 42)}" y="15" text-anchor="middle" font-size="11.5" font-weight="700" fill="#fff" font-family="var(--mono)">FECHAMENTO</text>`);
    }
    // Semanal: guia discreta em cada terça (fim da semana).
    if (gran === 'sem' && d.getDay() === 2) svg.push(`<line x1="${f(x(i))}" x2="${f(x(i))}" y1="${T}" y2="${H - B}" stroke="var(--border2)"/>`);
    if ((i % xEvery === 0 && n - 1 - i >= Math.max(1.5, xEvery * 0.75)) || i === n - 1) svg.push(`<text x="${f(x(i))}" y="${H - 8}" text-anchor="${i === n - 1 ? 'end' : i === 0 ? 'start' : 'middle'}" class="mo-rx-ax">${fmtPtDate(d).slice(0, 5)}</text>`);
  });
  if (linha.length > 1) svg.push(`<polygon points="${f(x(linha[0].i))},${f(y(0))} ${pts} ${f(xUlt)},${f(y(0))}" fill="${cor}" opacity=".12"/>`,
    `<polyline points="${pts}" fill="none" stroke="${cor}" stroke-width="2" stroke-linejoin="round"/>`);
  if (gran !== 'sem') rx.rows.forEach((r, i) => {
    if (!r.hasLanc) return;
    const v = rx.acc[i], c = v < -0.05 ? 'var(--red)' : v > 0.05 ? 'var(--amber)' : 'var(--text2)';
    const [nv, nvCor] = _moRxNivel(v, lim);
    const mov = (r.theoreticalStock ?? 0) - (r.initialStock ?? 0);
    const grade = _moRxLinha('Variação acumulada', _moKg(v), _moRxHex(v))
      + _moRxLinha('No lançamento', _moKg(r.diff || 0), _moRxHex(r.diff || 0))
      + _moRxLinha('Est. Inicial', fmtKg(r.initialStock ?? 0)) + _moRxLinha('Movimentos SAP', fmtKgSigned(mov))
      + _moRxLinha('Est. Teórico', fmtKg(r.theoreticalStock ?? 0), 'var(--purple)') + _moRxLinha('Est. Final', fmtKg(r.finalStock ?? 0), 'var(--teal)')
      + (r.lancCount > 1 ? _moRxLinha('Lançamentos no dia', r.lancCount, '#f59e0b') : '');
    const tip = _moRxTip(_moRxHex(v), r.dateLabel, `<span style="color:${nvCor}">${nv}</span>`, grade, _MO_RX_DICA_MOV);
    svg.push(`<circle class="mo-rx-pt" cx="${f(x(i))}" cy="${f(y(v))}" r="${i === rx.iUlt ? 5 : 3.5}" fill="${c}" stroke="var(--bg2)" stroke-width="1.5" data-tip="${tip}" data-col="${_moRxHex(v)}" onclick="muralMovDia(${i})"/>`);
  });
  semanas.forEach((s, k) => {
    const v = s.v, c = v < -0.05 ? 'var(--red)' : v > 0.05 ? 'var(--amber)' : 'var(--text2)';
    const [nv, nvCor] = _moRxNivel(v, lim);
    const ant = k ? semanas[k - 1].v : 0, r = rx.rows[s.j];
    const ini = new Date(s.ter); ini.setDate(ini.getDate() - 6);
    const grade = _moRxLinha('Variação acumulada', _moKg(v), _moRxHex(v))
      + _moRxLinha('Na semana', _moKg(v - ant), _moRxHex(v - ant))
      + _moRxLinha('Último lançamento', _moEsc(r.dateLabel)) + _moRxLinha('Est. Final', fmtKg(r.finalStock ?? 0), 'var(--teal)')
      + _moRxLinha('Est. Teórico', fmtKg(r.theoreticalStock ?? 0), 'var(--purple)')
      + (s.idx.length > 1 ? _moRxLinha('Lançamentos na semana', s.idx.length, '#f59e0b') : '');
    const tip = _moRxTip(_moRxHex(v), `Semana ${fmtPtDate(ini).slice(0, 5)} a ${fmtPtDate(s.ter).slice(0, 5)}`, `<span style="color:${nvCor}">${nv}</span>`, grade, _MO_RX_DICA_MOV);
    svg.push(`<circle class="mo-rx-pt" cx="${f(x(s.i))}" cy="${f(y(v))}" r="${k === semanas.length - 1 ? 5.5 : 4.5}" fill="${c}" stroke="var(--bg2)" stroke-width="1.5" data-tip="${tip}" data-col="${_moRxHex(v)}" onclick="muralMovDia(${s.j})"/>`);
  });
  // Comentários e ocorrências: uma marca por dia — linha vertical na cor
  // (azul = comentário, vermelho = ocorrência) e um selo com a quantidade
  // embaixo; o grupo inteiro é a área de hover do balão (Hugo, 09/11/2026:
  // o triângulo pequeno quase não aparecia). Vai atrás da linha e dos pontos.
  const porDia = new Map();
  acoes.forEach(a => {
    let i = rx.dayList.findIndex(d => _moDia(d).getTime() === _moDia(a.quando).getTime());
    // Ação de hoje (o eixo vai até ontem): fica na última data, com a data
    // real no balão — senão o comentário recém-feito não aparecia (10/11).
    if (i < 0 && _moDia(a.quando) > _moDia(rx.dayList[n - 1])) i = n - 1;
    if (i >= 0) { if (!porDia.has(i)) porDia.set(i, []); porDia.get(i).push(a); }
  });
  const marcas = [...porDia].map(([i, as]) => {
    const cx = x(i), cy = H - B + 13, cor = as.some(a => a.oc) ? '#f43f5e' : '#3b82f6';
    // Só o tipo, o autor e quando — o texto inteiro fica no histórico, onde
    // o clique leva (Hugo, 09/11/2026: o balão cortava os comentários).
    const lista = as.map(a => `<div style="display:flex;gap:7px;margin-top:5px;align-items:center"><span style="width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${a.oc ? '#f43f5e' : '#3b82f6'}"></span>
      <span style="font-size:13.5px;color:var(--text)">${_moEsc(a.titulo)}</span><span style="margin-left:auto;padding-left:12px;font-family:var(--mono);font-size:12.5px;color:var(--text2)">${_moRxDatas(a)}</span></div>`).join('')
      + '<div style="margin-top:10px;font-size:13px;color:var(--text2)">Clique para ler no histórico</div>';
    const titulo = as.length > 1 ? `${as.length} ações` : (as[0].oc ? 'Ocorrência' : 'Comentário');
    const tip = _moRxTip(cor, titulo, fmtPtDate(as[0].quando).slice(0, 5), '', lista);
    return `<g class="mo-rx-pt mo-rx-acao" data-tip="${tip}" data-col="${cor}" onclick="muralRxIrAcoes('${localISODate(as[0].quando)}')">
      <rect x="${f(cx - 9)}" y="${T}" width="18" height="${H - B - T + 22}" fill="transparent"/>
      <line x1="${f(cx)}" x2="${f(cx)}" y1="${T}" y2="${f(cy - 9)}" stroke="${cor}" stroke-width="1.5" stroke-dasharray="3 3"/>
      <circle cx="${f(cx)}" cy="${f(cy)}" r="9" fill="${cor}"/>
      <text x="${f(cx)}" y="${f(cy + 4)}" text-anchor="middle" font-size="11" font-weight="700" fill="#fff" font-family="var(--mono)">${as.length > 1 ? as.length : (as[0].oc ? '!' : '✎')}</text></g>`;
  });
  svg.splice(idxMarcas, 0, ...marcas);
  return _muralRxSvg(svg, leg, 'Variação acumulada dia a dia');
}

// ── Inventário a inventário ────────────────────────────────────────────────
// Variação de cada mês fechado, do inventário anterior (saldo do SAP no
// dia 1, que já traz o ajuste do fechamento) ao inventário do mês (último
// lançamento do mês) — a mesma conta da coluna "mês anterior" da Visão Micro
// (_anGetVarMesAnterior). Mais o mês em aberto, como no Mural.
const MURAL_RX_MESES = 6;
// comAberto=false: só os meses fechados (o painel das Operações soma a
// variação do mês em aberto que já tem, sem recalcular o mês).
function _muralRxMeses(central, mat, catKey, comAberto = true) {
  const P = _muralRxPeriodo('mes'), out = []; // meses fechados ANTES do período do Analítico
  const nomeMes = d => d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '') + '/' + String(d.getFullYear()).slice(2);
  for (let k = MURAL_RX_MESES; k >= 1; k--) {
    const ini = new Date(P.ini.getFullYear(), P.ini.getMonth() - k, 1);
    const fim = new Date(ini.getFullYear(), ini.getMonth() + 1, 0);
    const ate = new Date(fim); ate.setHours(23, 59, 59, 999);
    const anc = _anGetSapStock({ central, material: mat, dtIni: ini });
    const fimStock = _anGetLastPeriodStockFallback({ central, material: mat, dtIni: ini, dtFim: fim });
    const nat = repartirSapPorNatureza((getSapIndex().byCentralMat.get(central)?.get(mat) || []).filter(r => {
      const d = parseDate(r.dtLanc);
      return d && d >= ini && d <= ate && getCatKeyDoCadastro(r.materialOriginal) && !isSapExcluidoPorFechamento(r);
    }));
    const teo = (anc?.value ?? 0) + nat.totalEnt + nat.totalSai + nat.totalAju;
    const ok = fimStock && !fimStock.missing;
    out.push({ chave: `${ini.getFullYear()}-${String(ini.getMonth() + 1).padStart(2, '0')}`, rot: nomeMes(ini),
      // Sem saldo do Custos SAP no início, a "variação" seria o estoque inteiro.
      anc, nat, teo, estFim: ok ? fimStock.value : null, dtFim: ok ? fimStock.dtLabel : null, v: ok && anc ? fimStock.value - teo : null,
      falta: !anc ? 'sem âncora' : 'sem inv.' });
  }
  const atual = comAberto ? muralRaioXCalcular(central, mat, catKey, 'mes') : null;
  if (atual) {
    const s = atual.payload.summary;
    // O período do Analítico, com o número do card da Micro (inclusive AUSENTE,
    // que lá entra como −Est. Teórico).
    out.push({ chave: 'mes', rot: `${fmtPtDate(atual.ini).slice(0, 5)}–${fmtPtDate(atual.fim).slice(0, 5)}`, aberto: true,
      anc: s.pesoIniAusente ? null : { value: s.pesoIni, dtLabel: s.dtIniLabel.replace('Saldo SAP em ', '') },
      nat: { totalEnt: s.totalEnt, totalSai: s.totalSai, totalAju: s.totalAju }, teo: s.estTeorico,
      estFim: s.pesoFimAusente ? null : s.pesoFim, dtFim: s.pesoFimAusente ? 'AUSENTE' : s.dtFimLabel.replace(/^(Último lançamento|Lançamento): /, ''),
      v: s.micro || !s.pesoFimAusente ? s.diff : null });
  }
  return out;
}

// Uma barra por inventário; clique abre o dia a dia daquele mês.
function _muralRxBarras(meses, lim) {
  const { W, H, L, R, B } = _moRxDim, f = _moRxF;
  const { y, svg, leg } = _muralRxEixo(meses.filter(m => m.v != null).map(m => m.v), lim);
  const slot = (W - L - R) / meses.length, bw = Math.min(56, slot * 0.56);
  meses.forEach((m, i) => {
    const cx = L + slot * i + slot / 2;
    svg.push(`<text x="${f(cx)}" y="${H - 22}" text-anchor="middle" class="mo-rx-ax" style="fill:var(--text2)">${_moEsc(m.rot)}</text>`,
      `<text x="${f(cx)}" y="${H - 6}" text-anchor="middle" class="mo-rx-ax">${m.aberto ? 'período' : 'inventário'}</text>`);
    if (m.v == null) { svg.push(`<text x="${f(cx)}" y="${f(y(0) - 6)}" text-anchor="middle" class="mo-rx-ax">${m.falta || 'sem lanç.'}</text>`); return; }
    const c = _moRxHex(m.v), [nv, nvCor] = _moRxNivel(m.v, lim);
    const y0 = y(0), y1 = y(m.v), top = Math.min(y0, y1), h = Math.max(2, Math.abs(y1 - y0));
    const grade = _moRxLinha('Variação', _moKg(m.v), c)
      + _moRxLinha(`Est. Inicial${m.anc ? ` (${_moEsc(m.anc.dtLabel)})` : ''}`, m.anc ? fmtKg(m.anc.value) : '—')
      + _moRxLinha('Entradas SAP', fmtKgSigned(m.nat.totalEnt), 'var(--green)') + _moRxLinha('Saídas SAP', fmtKgSigned(m.nat.totalSai), 'var(--red)')
      + _moRxLinha('Ajustes SAP', fmtKgSigned(m.nat.totalAju), 'var(--amber)')
      + _moRxLinha('Est. Teórico', fmtKg(m.teo), 'var(--purple)') + _moRxLinha(`Est. Final (${_moEsc(m.dtFim || '')})`, fmtKg(m.estFim), 'var(--teal)');
    const tip = _moRxTip(c, `${m.rot}${m.aberto ? ' · período do Analítico' : ''}`, `<span style="color:${nvCor}">${nv}</span>`, grade,
      '<div style="margin-top:10px;font-size:13px;color:var(--text2)">Clique para ver o dia a dia do mês</div>');
    const rot = _moPesoSinal(m.v), ly = m.v < 0 ? top + h + 15 : top - 6;
    svg.push(`<g class="mo-rx-pt mo-rx-barra" data-tip="${tip}" data-col="${c}" onclick="muralRaioXPeriodo('${m.aberto ? 'mes' : 'inv:' + m.chave}')">
      <rect x="${f(cx - bw / 2 - 3)}" y="${f(Math.min(top, top + h / 2 - 7) - 3)}" width="${f(bw + 6)}" height="${f(Math.max(h, 14) + 6)}" fill="transparent"/>
      <rect x="${f(cx - bw / 2)}" y="${f(top)}" width="${f(bw)}" height="${f(h)}" rx="3" fill="${c}" opacity="${m.aberto ? .45 : .85}"${m.aberto ? ` stroke="${c}" stroke-dasharray="4 3"` : ''}/>
      <text x="${f(cx)}" y="${f(ly)}" text-anchor="middle" class="mo-rx-ax" style="fill:${c};font-weight:600;pointer-events:none">${rot}</text></g>`);
  });
  return _muralRxSvg(svg, leg, 'Variação de inventário a inventário');
}

// Comentários e ocorrências do par dentro do período.
// "fato 03/11 · registrado 10/11 12:22" — a data do fato (modal) e a do
// registro; ocorrência só tem a data de abertura.
function _moRxDatas(a, longa) {
  const fato = longa ? fmtPtDate(a.quando) : fmtPtDate(a.quando).slice(0, 5);
  if (!a.criado) return fato;
  return `fato ${fato} · registrado ${fmtPtDate(a.criado).slice(0, 5)} ${a.criado.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}
function _muralRxAcoes(central, mat, ini, fim) {
  const ate = new Date(fim); ate.setHours(23, 59, 59, 999);
  const noPer = d => d && d >= ini && d <= ate;
  const coms = (typeof _varComDe === 'function' ? _varComDe(central, mat) : [])
    // quando = data do FATO (escolhida no modal) — posiciona no gráfico;
    // criado = quando foi registrado (Hugo, 10/11/2026: são duas datas).
    .map(r => ({ quando: _moIsoParaData(r.data) || (r.created_at ? new Date(r.created_at) : null), criado: r.created_at ? new Date(r.created_at) : null, oc: !!r.oc_id,
      titulo: `${r.oc_id ? 'Ocorrência ' + (r.oc_numero || '') : 'Comentário'} · ${r.autor_nome || '—'}`, texto: r.texto || '' }))
    .filter(a => noPer(a.quando));
  const ocs = (Array.isArray(state.ocorrencias) ? state.ocorrencias : [])
    .filter(o => o.central === central && o.material === mat && noPer(_moIsoParaData(o.dataAbertura)))
    .map(o => ({ quando: _moIsoParaData(o.dataAbertura), oc: true,
      titulo: `Ocorrência ${o.numero || o.id}${o.concluida ? ' (concluída)' : ''}`, texto: o.descricao || '', criado: null }));
  return [...coms, ...ocs].sort((a, b) => (a.quando - b.quando) || ((a.criado || 0) - (b.criado || 0)));
}

// Raio-X em GAVETA lateral (como no protótipo) e Movimentações no modal de
// detalhe da Micro — separados (Hugo, 09/11/2026): o Raio-X é a triagem
// rápida (por que está assim, o que fazer), sem tirar o analista da fila; as
// Movimentações são a auditoria dia a dia, com os códigos SAP.
function _muralRxItem(central, mat) {
  const it = (_mo._ultItens || []).find(i => i.central === central && i.material === mat);
  return { it, catKey: it?.catKey || getCatKeyDoCadastro(mat) };
}

function muralRaioX(central, mat, periodo = 'invs') { // abre em Inventários (Hugo, 09/11/2026)
  const { it, catKey } = _muralRxItem(central, mat);
  const rx = muralRaioXCalcular(central, mat, catKey, periodo);
  if (!rx) { toast('Período inválido para o Raio-X.', 'error'); return; }
  // Visão do mês: diária ou semanal (terça a terça). Padrão pela categoria
  // ao abrir outro par; depois vale a escolha do usuário.
  if (!_mo.rx || _mo.rx.central !== central || _mo.rx.mat !== mat) _mo.rxGran = isCatKeySemanal(catKey) ? 'sem' : 'dia';
  _mo.rx = { central, mat, periodo };
  // Redesenhar troca o elemento sob o mouse e o "mouseout" nunca chega
  // (ex.: clique numa barra de inventário): esconde o balão antes.
  if (typeof _hideTip === 'function') _hideTip();
  // Visão nova das Operações (mural-painel.js): o item selecionado mostra o
  // Raio-X dentro do painel, no lugar da gaveta.
  const host = document.getElementById('mp-rx');
  if (host && host.dataset.c === central && host.dataset.m === mat) {
    if (!host.dataset.tip && typeof _showTip === 'function') {
      host.dataset.tip = '1';
      host.addEventListener('mouseover', e => { const p = e.target.closest?.('.mo-rx-pt'); if (p) _showTip(e, decodeURIComponent(p.dataset.tip), p.dataset.col); });
      host.addEventListener('mousemove', e => { if (e.target.closest?.('.mo-rx-pt')) _moveTip(e); });
      host.addEventListener('mouseout', e => { if (e.target.closest?.('.mo-rx-pt')) _hideTip(); });
    }
    const sc = host.querySelector('.mo-dr-body')?.scrollTop || 0;
    // Desenha na largura real do painel (escala 1): esticar o desenho da
    // gaveta (740) até ~1050 px aumentava as fontes do gráfico (Hugo, 10/11).
    const larg = host.clientWidth - 54; // padding do corpo (2×18) + do quadro (2×8) + borda
    if (larg > 500) _moRxDim = { ...MO_RX_DIM, W: Math.round(larg) };
    try { host.innerHTML = _muralRxHtml(rx, it, catKey); } finally { _moRxDim = MO_RX_DIM; }
    if (_mo.rx.manterScroll) host.querySelector('.mo-dr-body').scrollTop = sc;
    _mo.rx.manterScroll = false;
    if (document.getElementById('mo-rx-exp-ov')?.classList.contains('open')) muralRxExpandir();
    return;
  }
  let dr = document.getElementById('mo-drawer');
  if (!dr) {
    document.body.insertAdjacentHTML('beforeend',
      '<div class="mo-scrim" id="mo-scrim" onclick="muralRaioXFechar()"></div><aside class="mo-drawer" id="mo-drawer" aria-label="Raio-X do item" aria-hidden="true"></aside>');
    dr = document.getElementById('mo-drawer');
    // Tooltip dos pontos do gráfico: o mesmo balão dos donuts da Macro.
    if (typeof _showTip === 'function') {
      dr.addEventListener('mouseover', e => { const p = e.target.closest?.('.mo-rx-pt'); if (p) _showTip(e, decodeURIComponent(p.dataset.tip), p.dataset.col); });
      dr.addEventListener('mousemove', e => { if (e.target.closest?.('.mo-rx-pt')) _moveTip(e); });
      dr.addEventListener('mouseout', e => { if (e.target.closest?.('.mo-rx-pt')) _hideTip(); });
    }
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && dr.classList.contains('open') && !document.querySelector('.modal-overlay.open')) muralRaioXFechar();
    });
  }
  const corpo = dr.querySelector('.mo-dr-body');
  const scroll = corpo ? corpo.scrollTop : 0;
  dr.innerHTML = _muralRxHtml(rx, it, catKey);
  if (_mo.rx.manterScroll) dr.querySelector('.mo-dr-body').scrollTop = scroll;
  _mo.rx.manterScroll = false;
  dr.classList.add('open'); dr.setAttribute('aria-hidden', 'false');
  if (document.getElementById('mo-rx-exp-ov')?.classList.contains('open')) muralRxExpandir();
  document.getElementById('mo-scrim').classList.add('open');
}
// Gráfico expandido: o mesmo desenho da gaveta, redesenhado em tamanho
// grande (mais datas no eixo) numa janela por cima de tudo, com os mesmos
// balões. Acompanha a gaveta: trocar de período ou clicar numa barra
// redesenha os dois.
const _muralRxBtnExp = '<button class="btn btn-sm mo-rx-exp" onclick="muralRxExpandir()" title="Expandir o gráfico"><i class="ti ti-arrows-maximize"></i> Expandir</button>';
function muralRxExpandir() {
  const d = _mo.rxDesenho;
  if (!d) return;
  let ov = document.getElementById('mo-rx-exp-ov');
  if (!ov) {
    document.body.insertAdjacentHTML('beforeend', '<div class="modal-overlay mo-rx-exp-ov" id="mo-rx-exp-ov" onclick="if (event.target === this) muralRxRecolher()"><div class="mo-rx-exp-box"></div></div>');
    ov = document.getElementById('mo-rx-exp-ov');
    if (typeof _showTip === 'function') {
      ov.addEventListener('mouseover', e => { const p = e.target.closest?.('.mo-rx-pt'); if (p) _showTip(e, decodeURIComponent(p.dataset.tip), p.dataset.col); });
      ov.addEventListener('mousemove', e => { if (e.target.closest?.('.mo-rx-pt')) _moveTip(e); });
      ov.addEventListener('mouseout', e => { if (e.target.closest?.('.mo-rx-pt')) _hideTip(); });
    }
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && ov.classList.contains('open')) { e.stopImmediatePropagation(); muralRxRecolher(); } }, true);
  }
  if (typeof _hideTip === 'function') _hideTip();
  _moRxDim = MO_RX_DIM_GRANDE;
  let grafico;
  try { grafico = d.meses ? _muralRxBarras(d.meses, d.lim) : _muralRxChart(d.rx, d.lim, d.acoes, d.gran); }
  finally { _moRxDim = MO_RX_DIM; }
  ov.querySelector('.mo-rx-exp-box').innerHTML = `<div class="mo-rx-exp-head"><b>${_moEsc(d.titulo)}</b>
      <button class="btn btn-sm" onclick="muralRxRecolher()" style="margin-left:auto"><i class="ti ti-arrows-minimize"></i> Recolher</button></div>
    <div class="mo-dr-chart">${grafico}</div>`;
  ov.classList.add('open');
}
function muralRxRecolher() {
  if (typeof _hideTip === 'function') _hideTip();
  document.getElementById('mo-rx-exp-ov')?.classList.remove('open');
}

// Clique numa marca de ação do gráfico: rola até o histórico e destaca as
// ações daquele dia (a lista tem rolagem própria, então rola ela também).
function muralRxIrAcoes(dia) {
  muralRxRecolher();
  if (typeof _hideTip === 'function') _hideTip();
  const hist = document.getElementById('mo-dr-hist');
  if (!hist) return;
  const itens = [...hist.querySelectorAll(`li[data-dia="${dia}"]`)];
  (itens[0] || hist).scrollIntoView({ behavior: 'smooth', block: 'center' });
  itens.forEach(li => { li.classList.remove('mo-rx-flash'); void li.offsetWidth; li.classList.add('mo-rx-flash'); });
}
function muralRxGran(g) {
  if (!_mo.rx) return;
  _mo.rxGran = g; _mo.rx.manterScroll = true;
  muralRaioX(_mo.rx.central, _mo.rx.mat, _mo.rx.periodo);
}
function muralRaioXAbrir(el) { muralRaioX(el.dataset.central, el.dataset.material); }
function muralRaioXPeriodo(periodo) { if (_mo.rx) { _mo.rx.manterScroll = true; muralRaioX(_mo.rx.central, _mo.rx.mat, periodo); } }
function muralRaioXFechar() {
  muralRxRecolher();
  if (typeof _hideTip === 'function') _hideTip();
  document.getElementById('mo-drawer')?.classList.remove('open');
  document.getElementById('mo-drawer')?.setAttribute('aria-hidden', 'true');
  document.getElementById('mo-scrim')?.classList.remove('open');
  _mo.rx = null;
  // Fechar o Raio-X dentro do painel volta para a central do item.
  if (document.getElementById('mp-rx') && typeof muralPainelVoltar === 'function') muralPainelVoltar();
}
// Depois de comentar/avocar o Mural redesenha; a gaveta aberta acompanha.
function _muralRxAtualizar() {
  if (_mo.rx && document.getElementById('mo-drawer')?.classList.contains('open')) {
    _mo.rx.manterScroll = true;
    muralRaioX(_mo.rx.central, _mo.rx.mat, _mo.rx.periodo);
  }
}

// Movimentações: o detalhe diário da Visão Micro (cascata, tabela dia a dia,
// códigos SAP, conflito de lançamento), no período do Raio-X aberto ou, do
// item, no mês atual (a variação principal do Mural).
function muralMovimentacoes(el) {
  const central = el.dataset.central, mat = el.dataset.material;
  const periodo = (_mo.rx && _mo.rx.central === central && _mo.rx.mat === mat) ? _mo.rx.periodo : 'mes';
  const rx = muralRaioXCalcular(central, mat, _muralRxItem(central, mat).catKey, periodo);
  if (!rx) { toast('Período inválido para as Movimentações.', 'error'); return; }
  window.__analiticoDetailCache = window.__analiticoDetailCache || new Map();
  window.__analiticoDetailCache.set('mural-mov', { ...rx.payload, key: 'mural-mov' });
  openAnaliticoDetailModal('mural-mov');
}

// Clique num ponto do gráfico (Hugo, 10/11/2026): Movimentações só do trecho
// que forma a variação daquele lançamento — do dia seguinte ao lançamento
// anterior até ele (no diário costuma ser um dia só; no semanal, a semana).
// Fatia a série do período aberto, para bater com o balão do ponto.
// ponytail: a coluna Var. Acumulada do modal recomeça do zero no trecho.
function muralMovDia(j) {
  muralRxRecolher(); // o gráfico expandido (z 320) ficaria por cima do modal (z 260)
  const { central, mat, periodo } = _mo.rx || {};
  const rx = central && muralRaioXCalcular(central, mat, _muralRxItem(central, mat).catKey, periodo);
  const fim = rx?.rows[j];
  if (!fim) return;
  let a = j;
  while (a > 0 && !rx.rows[a - 1].hasLanc) a--;
  const dias = rx.rows.slice(a, j + 1);
  const soma = k => dias.reduce((s, d) => s + (d[k] || 0), 0);
  const cods = (k, vazio) => _codsLabel(dias.flatMap(d => d[k] || []), vazio);
  const ini = dias[0].initialStock;
  window.__analiticoDetailCache = window.__analiticoDetailCache || new Map();
  window.__analiticoDetailCache.set('mural-mov', {
    ...rx.payload, key: 'mural-mov', days: dias,
    periodLabel: a === j ? fim.dateLabel : `${dias[0].dateLabel} a ${fim.dateLabel}`,
    summary: {
      ...rx.payload.summary,
      pesoIni: ini ?? 0, pesoIniAusente: ini == null,
      dtIniLabel: a > 0 ? `Último lançamento: ${rx.rows[a - 1].dateLabel}` : rx.payload.summary.dtIniLabel,
      totalEnt: soma('totalEnt'), entLabel: cods('entEntries', 'Sem entradas no trecho'),
      totalSai: soma('totalSai'), saiLabel: cods('saiEntries', 'Sem saídas no trecho'),
      totalAju: soma('totalAju'), ajuLabel: cods('ajuEntries', 'Sem ajustes no trecho'),
      estTeorico: fim.theoreticalStock ?? 0, pesoFim: fim.finalStock ?? 0, pesoFimAusente: false,
      dtFimLabel: `Lançamento: ${fim.dateLabel}`, diff: soma('diff')
    }
  });
  openAnaliticoDetailModal('mural-mov');
}

// O que conferir, pelo formato da variação (do protótipo, ajustado aos
// formatos do Mural). ponytail: lista fixa, sem marcar o que já foi visto.
const MURAL_HIPOTESES = {
  deriva: ['OS do período sem integração no SAP', 'Calibração da balança ou do dosador', 'Consumo teórico do traço × consumo lançado', 'Perda física: vazamento, varrição, devolução de concreto'],
  degrau: ['Abrir o dia do salto nas Movimentações', 'NF ou OS duplicada ou estornada nesse dia', 'Confirmar com o operador o lançamento do dia', 'Transferência 861/862 sem contrapartida'],
  herdada: ['Conferir com o operador a medição do último dia do mês anterior', 'Comparar o 1º lançamento do mês com o último do mês anterior', 'Confirmar se o ajuste do fechamento usou a aferição certa'],
  inicio: ['Ver os primeiros dias do mês nas Movimentações', 'Confirmar se o Custos SAP do mês anterior já traz o ajuste do fechamento', 'NF ou OS do fim do mês lançada no SAP só no mês seguinte'],
  serrote: ['Comparar o horário do lançamento com o das entregas', 'Revisar o método de cubagem ou aferição', 'Se a média seguir dentro da faixa, acompanhar'],
  irregular: ['Procurar nas Movimentações os dias de maior salto', 'Lançamentos duplicados no mesmo dia', 'NFs e OS pendentes do período'],
  poucos: ['Cobrar os lançamentos dos dias de conferência', 'Com poucos pontos, confirmar a medição antes de concluir'],
  erro: ['Confirmar com o operador se houve dígito a mais ou unidade errada', 'Comparar com o lançamento anterior e o seguinte', 'Corrigir o lançamento e reimportar']
};

// Ações do Raio-X no topo, ao lado do fechar (Hugo, 10/11/2026): Comentar /
// ocorrência em evidência; Movimentações e Avocar/Devolver como ícones, iguais
// aos da linha da fila. Item da faixa (sem it) também pode ser comentado.
function _muralBotoesHtml(it, dataset, periodo, diff) {
  const avocar = it && _moEhAdm() && _mo.avocDisponivel ? (it.avocado
    ? `<button class="btn btn-sm mo-ico" onclick="muralDevolver('${_moEsc(it.avocado.id)}')" title="Devolver a ${_moEsc(it.dono.nome)}" aria-label="Devolver"><i class="ti ti-arrow-back-up"></i></button>`
    : `<button class="btn btn-sm mo-ico" onclick="muralAvocar(this)" ${dataset} data-categoria="${_moEsc(it.categoriaFoto)}" data-dono="${_moEsc(it.dono.nome)}" title="Avocar: assumir este item no lugar do dono" aria-label="Avocar"><i class="ti ti-shield-check"></i></button>`) : '';
  return `<div class="mo-dr-acoes">
    <button class="btn btn-sm btn-primary" onclick="muralComentar(this)" ${dataset} data-diff="${it ? it.v : diff}" data-periodo="${_moEsc(periodo)}"><i class="ti ti-message-plus"></i> ${it?.temOc ? 'Comentar' : 'Comentar / ocorrência'}</button>
    <button class="btn btn-sm mo-ico" onclick="muralMovimentacoes(this)" ${dataset} title="Movimentações: detalhe dia a dia, com os movimentos SAP" aria-label="Movimentações"><i class="ti ti-table"></i></button>
    ${avocar}</div>`;
}

function _muralRxHtml(rx, it, catKey) {
  const { central, material, summary: s } = rx.payload;
  const thresholds = getHealthThresholds();
  const lim = thresholds[catKey] || { bom: 0, atencao: 0, urgente: 0 };
  // Período em aberto ('invs'/'mes') termina ontem, mas as ações vão até
  // agora — senão o comentário feito hoje não aparecia (Hugo, 10/11/2026).
  const acoes = _muralRxAcoes(central, material, rx.ini, String(rx.periodo).startsWith('inv:') ? rx.fim : new Date());
  const dataset = `data-central="${_moEsc(central)}" data-material="${_moEsc(material)}"`;
  // Abre em Inventários; clicar numa barra abre o mês (fechado 'inv:…' ou o
  // em aberto 'mes') no gráfico de linhas, com Diário/Semanal (Hugo, 09/11).
  const modoInvs = rx.periodo === 'invs', modoInv = !modoInvs;
  const gran = _mo.rxGran === 'sem' ? 'sem' : 'dia';
  const granBtns = [['dia', 'Diário'], ['sem', 'Semanal']].map(([k, rot]) =>
    `<button class="mo-aba${gran === k ? ' on' : ''}" onclick="muralRxGran('${k}')"${k === 'sem' ? ' title="Uma ponta por semana, de terça a terça"' : ''}>${rot}</button>`).join('');
  const nomeMes = rx.periodo === 'mes' ? `período ${fmtPtDate(rx.ini).slice(0, 5)} a ${fmtPtDate(rx.fim).slice(0, 5)}` : rx.ini.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const v = rx.iUlt >= 0 ? rx.acc[rx.iUlt] : 0;
  const nivel = rx.iUlt >= 0 ? classifyVariation(Math.abs(v), catKey, thresholds) : null;
  const nv = MURAL_NIVEL[nivel];
  const cor = x => x < -0.05 ? 'var(--red)' : x > 0.05 ? 'var(--amber)' : 'inherit';
  const custo = it?.custoMed || 0;
  const nvIt = it && (MURAL_NIVEL[it.nivel] || MURAL_NIVEL.atencao);
  const st = it && MURAL_STATUS[it.status];
  const chips = it ? `<span class="mo-lvl" style="--lv:${nvIt.cor}"><i class="ti ${nvIt.icon}"></i>${nvIt.label}</span>
      <span class="mo-shape mo-shape-${_moEsc(it.formato)}" title="${_moEsc(MURAL_FORMATO_DESC[it.formato] || '')}">${_moEsc(MURAL_FORMATO_LABEL[it.formato] || it.formato)}</span>
      ${st ? `<span class="mo-status" style="--sc:${st.cor}">${st.label}</span>` : ''}
      <span class="mo-meta"><i class="ti ti-user"></i>${_moEsc(it.avocado ? 'ADM' : it.dono?.nome || '')}</span>`
    : '<span class="mo-hint"><i class="ti ti-circle-check" style="color:var(--green)"></i> Na faixa · fora da fila de ação</span>';
  const card = (rot, val, sub, c) => `<div><small>${rot}</small><b${c ? ` style="color:${c}"` : ''}>${val}</b>${sub ? `<span>${_moEsc(sub)}</span>` : ''}</div>`;
  // Inventário a inventário: resumo da reincidência em vez da cascata.
  const meses = modoInvs ? _muralRxMeses(central, material, catKey) : null;
  // O que o botão Expandir redesenha em tamanho grande (muralRxExpandir).
  _mo.rxDesenho = { meses, rx, lim, acoes, gran, titulo: `${material} · ${central} · ${modoInvs ? 'inventário a inventário' : nomeMes + (gran === 'sem' ? ' · semanal' : ' · diário')}` };
  let resumo;
  if (modoInvs) {
    const fechados = meses.filter(m => !m.aberto && m.v != null);
    const ult = fechados[fechados.length - 1];
    const fora = fechados.filter(m => classifyVariation(Math.abs(m.v), catKey, thresholds) !== 'bom');
    let seq = 0;
    for (let i = fechados.length - 1; i >= 0; i--) {
      const m = fechados[i];
      if (!ult || Math.sign(m.v) !== Math.sign(ult.v) || classifyVariation(Math.abs(m.v), catKey, thresholds) === 'bom') break;
      seq++;
    }
    // Acumulado (Hugo, 10/11/2026): soma de todos os inventários disponíveis
    // mais o período do Analítico (o número do card da Micro).
    const comV = meses.filter(m => m.v != null), aberto = comV.find(m => m.aberto);
    const acum = comV.reduce((t, m) => t + m.v, 0);
    const acumSub = comV.length ? `${fechados.length} inventário${fechados.length === 1 ? '' : 's'}${aberto ? ' + período do Analítico' : ''}` : 'sem inventário';
    resumo = `<div class="mo-dr-sum">
      ${card('Último inventário', ult ? _moKg(ult.v) : '—', ult ? `${ult.rot}${custo ? ' · ' + _moRs(ult.v * custo) : ''}` : 'sem inventário', ult ? cor(ult.v) : '')}
      ${card('Fora da faixa', `${fora.length} de ${fechados.length}`, `inventários dos últimos ${MURAL_RX_MESES} meses`, fora.length ? 'var(--amber)' : '')}
      ${card('Seguidos no mesmo sentido', String(seq), seq > 1 ? 'reincidente até o último inventário' : seq ? 'só o último inventário' : 'último inventário na faixa', seq > 1 ? 'var(--red)' : '')}
      ${card('Acumulado', comV.length ? _moKg(acum) : '—', acumSub + (custo && comV.length ? ' · ' + _moRs(acum * custo) : ''), cor(acum))}
    </div>`;
  } else {
    resumo = `<div class="mo-dr-sum">
      ${card('Variação', rx.iUlt >= 0 ? _moKg(v) : '—', custo ? _moRs(v * custo) : (nv ? nv.label : ''), cor(v))}
      ${card('Est. Inicial', s.pesoIniAusente ? '—' : fmtKg(s.pesoIni), s.dtIniLabel)}
      ${card('Est. Teórico', fmtKg(s.estTeorico), 'Ini + Ent + Saí + Aju')}
      ${card('Est. Final', s.pesoFimAusente ? '—' : fmtKg(s.pesoFim), s.dtFimLabel)}
    </div>`;
  }
  const explicKg = rx.explic.reduce((t, e) => t + e.kg, 0);
  const explic = rx.explic.length
    ? rx.explic.map(e => `<li><span>${_moEsc(e.t)} <small class="mo-hint">(${e.n})</small></span><b class="mo-teal">${_moKg(e.kg)}</b></li>`).join('')
      + `<li class="mo-rx-tot"><span>Sem explicação</span><b>${_moKg(v - explicKg)}</b></li>`
    : '<li class="mo-hint">Nada explicado por pendência ou divergência PUZL × SAP no período.</li>';
  const hip = [...(MURAL_HIPOTESES[it?.formato] || [])];
  const pend = it && _moPendente(it);
  if (pend) hip.unshift(`Cobrar o lançamento ${pend}`);
  if (it && (it.meses || 1) > 1) hip.push('Ver as justificativas dos meses anteriores no Inventário');
  const hist = acoes.length
    ? acoes.slice().reverse().map(a => `<li data-dia="${localISODate(a.quando)}"><i class="ti ${a.oc ? 'ti-file-alert mo-red' : 'ti-message'}"></i><div><small class="mo-hint">${_moEsc(a.titulo)} · ${_moRxDatas(a, true)}</small><div>${_moEsc(a.texto) || '—'}</div></div></li>`).join('')
    : '<li class="mo-hint">Nenhum comentário ou ocorrência no período.</li>';
  const prio = it ? it.partes.filter(p => p[1]).map(p => `<span>${_moEsc(p[0])}</span><b>+${p[1].toFixed(1)}</b>`).join('')
    + `<span class="tot">Prioridade</span><b class="tot">${it.prioridade.toFixed(1)}</b>` : '';
  const sec = (icon, titulo, corpo) => `<section><h4 class="mo-dr-sec"><i class="ti ${icon}"></i>${titulo}</h4>${corpo}</section>`;
  const periodoTxt = `${fmtPtDate(rx.ini)} a ${fmtPtDate(rx.fim)}`;
  return `<div class="mo-dr-head">
      <div style="min-width:0">
        <h3>${_moEsc(material)}</h3>
        <p>${_moEsc(central)}${it ? ` · ${_moEsc(it.regional)} · ${_moEsc(it.categoriaFoto || '')}` : ''}</p>
        <div class="mo-dr-chips">${chips}</div>
        ${it ? `<div class="mo-dr-prazo">${_muralPrazoHtml(it)}</div>` : ''}
      </div>
      ${_muralBotoesHtml(it, dataset, periodoTxt, s.diff)}
      <button class="btn btn-sm mo-dr-x" onclick="muralRaioXFechar()" aria-label="Fechar o Raio-X"><i class="ti ti-x"></i></button>
    </div>
    <div class="mo-dr-body">
      <div class="mo-dr-periodo">
        ${modoInv ? `<button class="mo-link" onclick="muralRaioXPeriodo('invs')"><i class="ti ti-arrow-left"></i> Inventários</button>
          <b class="mo-rx-mes">${_moEsc(nomeMes)}${rx.periodo === 'mes' ? ' · do Analítico' : ''}</b>
          <div class="mo-abas" role="tablist" style="margin-left:auto">${granBtns}</div>` : `<span class="mo-hint">Inventários de ${periodoTxt}</span>`}</div>
      ${resumo}
      ${modoInvs
        ? sec('ti-chart-bar', 'Variação de inventário a inventário', `<div class="mo-dr-chart">${_muralRxBtnExp}${_muralRxBarras(meses, lim)}</div><p class="mo-hint">Cada barra vai do inventário do mês anterior ao do mês. Passe o mouse para a cascata do mês; clique para abrir o mês.</p>`)
        : sec('ti-chart-line', `Variação acumulada · ${gran === 'sem' ? 'semanal (terça a terça)' : 'diária'}${nv ? ` <span class="mo-lvl" style="--lv:${nv.cor}">${nv.label}</span>` : nivel === 'bom' ? ' <span class="mo-hint">na faixa</span>' : ''}`,
          (rx.temDados ? `<div class="mo-dr-chart">${_muralRxBtnExp}${_muralRxChart(rx, lim, acoes, gran)}</div><p class="mo-hint">Passe o mouse nos pontos${gran === 'sem' ? ' (fim de cada semana)' : ' (lançamentos)'} e nas marcas embaixo: azul = comentário, vermelho = ocorrência.</p>` : '<p class="mo-hint">Sem lançamentos nem movimentos SAP deste par na sua base, nesse período.</p>'))}
      ${modoInvs ? '' : sec('ti-arrows-diff', 'Explicado × sem explicação (PUZL × SAP)', `<ul class="mo-rx-list">${explic}</ul>`)}
      ${hip.length ? sec('ti-list-check', 'O que conferir', `<ul class="mo-dr-hip">${hip.map(h => `<li>${_moEsc(h)}</li>`).join('')}</ul>`) : ''}
      <div id="mo-dr-hist">${sec('ti-history', 'Histórico de ações no período', `<ul class="mo-rx-list mo-rx-acoes">${hist}</ul>`)}</div>
      ${prio ? sec('ti-sort-descending', 'Por que está nesta posição da fila', `<div class="mo-dr-prio">${prio}</div>`) : ''}
    </div>`;
}
