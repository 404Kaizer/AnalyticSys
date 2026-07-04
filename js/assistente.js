'use strict';

// ═══════════════════════════════════════════════════════════
// ASSISTENTE — Iteração 3
// Base estrutural nova:
//  - Intenções viram um REGISTRO (_ASST_INTENTS), não uma cadeia de if/else
//    — adicionar/reordenar intenção é só editar a lista.
//  - Contexto de conversa: lembra a última central/material/regional
//    resolvidos, para perguntas de seguimento ("e a central Y?") sem
//    precisar repetir o nome. Sempre que o contexto é usado, a resposta
//    avisa isso explicitamente (nunca fica "escondido").
// Novo módulo coberto: pendências de cadastro (Configurações → Padronização).
//
// Continua por regras (sem LLM) e somente leitura — nunca cria, edita
// ou remove nada do state, e nunca chama reaplicarPadronizacao* (essas
// mutam o state; usamos apenas findMaterialMatch/normalizarCentral, que
// são consultas puras).
// ═══════════════════════════════════════════════════════════

const ASST_HISTORY_KEY = 'analyticsys_asst_history_v1';

// Contexto de conversa — não persiste entre recarregamentos de página
// (é memória de curto prazo da sessão atual, não histórico salvo).
let _asstContext = { central: null, material: null, regional: null };

// Mantém sincronizado com a mensagem inicial estática em index.html
// (#asst-chat-body), já que "limpar" e "sem histórico salvo" devem
// devolver o mesmo estado de boas-vindas.
const _ASST_WELCOME_HTML = `
  Oi! Sou seu analista auxiliar de estoque. Respondo sobre a última análise rodada no Dashboard, e ajudo com ocorrências e pendências de cadastro a qualquer momento.
  <br><br>
  Digite <code>/</code> e escolha um contexto para eu saber onde buscar a resposta — ele fica travado até você trocar ou remover. Se a pergunta escolhida precisar de um período analisado, eu peço as datas aqui mesmo, sem escolher por conta própria.
  <div class="asst-suggestions">
    <button class="asst-chip" onclick="asstQuickStart('ocorrencias')">Ocorrências abertas</button>
    <button class="asst-chip" onclick="asstQuickStart('saude')">Resumo do período</button>
    <button class="asst-chip" onclick="asstQuickStart('saldo')">Saldo de um material</button>
    <button class="asst-chip" onclick="asstQuickStart('pior')">Piores centrais</button>
  </div>`;

// ── Utilitários de estado/período ───────────────────────────────────
function _asstHasAnalise() {
  return !!(window.__analiticoDtIni && window.__analiticoDtFim);
}

function _asstNoAnaliseMsg() {
  return 'Ainda não há uma análise executada. Rode o período desejado no <b>Dashboard Analítico</b> primeiro e tente novamente.';
}

function _asstPeriodoLabel() {
  if (!_asstHasAnalise()) return '—';
  const toDate = v => (v instanceof Date ? v : new Date(v));
  return `${fmtPtDate(toDate(window.__analiticoDtIni))} a ${fmtPtDate(toDate(window.__analiticoDtFim))}`;
}

function _asstContextNote(tipo, valor) {
  return `<div class="asst-context-note"><i class="ti ti-history"></i> usando ${tipo} <b>${escapeHtml(valor)}</b> da pergunta anterior</div>`;
}

// ── Resolução de entidades citadas em texto livre (tolerante) ───────
// Duas passadas: (1) substring exato do nome inteiro — mais confiável
// quando o nome aparece por completo; (2) todos os "tokens" do nome
// aparecem em qualquer ordem na pergunta — tolera hífen/espaço/acento
// (normalizeLooseText já trata isso) e pequenas reordenações.
// Limitação conhecida: nomes concatenados sem separador (“CPII” em vez
// de “CP-II”) ainda não casam.
function _asstFuzzyResolve(text, names) {
  const qLoose  = normalizeLooseText(text);
  const qTokens = qLoose.split(' ').filter(Boolean);
  let best = null, bestScore = 0;

  (names || []).forEach(n => {
    const nLoose = normalizeLooseText(n);
    if (!nLoose || nLoose.length < 3) return;

    if (qLoose.includes(nLoose)) {
      const score = 1000 + nLoose.length;
      if (score > bestScore) { bestScore = score; best = n; }
      return;
    }

    const nTokens = nLoose.split(' ').filter(Boolean);
    if (nTokens.length && nTokens.every(t => qTokens.includes(t))) {
      const score = 500 + nLoose.length;
      if (score > bestScore) { bestScore = score; best = n; }
    }
  });

  return best;
}

function _asstResolveCentral(text) {
  if (typeof _macroState !== 'undefined' && _macroState?.centralMap) {
    const fromMacro = _asstFuzzyResolve(text, Object.keys(_macroState.centralMap));
    if (fromMacro) return fromMacro;
  }
  const ocCentrals = [...new Set((state.ocorrencias || []).map(o => o.central).filter(Boolean))];
  return _asstFuzzyResolve(text, ocCentrals);
}

function _asstResolveRegional(text) {
  if (typeof _macroState === 'undefined' || !_macroState?.centralMap) return null;
  const regionals = [...new Set(Object.values(_macroState.centralMap).map(v => v.regional).filter(r => r && r !== '—'))];
  return _asstFuzzyResolve(text, regionals);
}

function _asstResolveMaterial(text) {
  if (!Array.isArray(state.materiais) || !state.materiais.length) return null;
  const nameToAlias = new Map();
  state.materiais.forEach(m => {
    const alias = String(m.alias || '').trim();
    [m.alias, m.origem].forEach(cand => {
      const c = String(cand || '').trim();
      if (c) nameToAlias.set(c, alias || c);
    });
  });
  const matched = _asstFuzzyResolve(text, [...nameToAlias.keys()]);
  return matched ? nameToAlias.get(matched) : null;
}

// ── Versões "com contexto": tentam resolver da pergunta; se não achar,
// caem no que foi mencionado por último na conversa. Sempre reportam
// se o valor usado veio do contexto (fromContext), para a resposta
// poder avisar isso ao analista.
function _asstResolveCentralCtx(text) {
  const found = _asstResolveCentral(text);
  if (found) { _asstContext.central = found; return { value: found, fromContext: false }; }
  if (_asstContext.central) return { value: _asstContext.central, fromContext: true };
  return { value: null, fromContext: false };
}

function _asstResolveMaterialCtx(text) {
  const found = _asstResolveMaterial(text);
  if (found) { _asstContext.material = found; return { value: found, fromContext: false }; }
  if (_asstContext.material) return { value: _asstContext.material, fromContext: true };
  return { value: null, fromContext: false };
}

function _asstResolveRegionalCtx(text) {
  const found = _asstResolveRegional(text);
  if (found) { _asstContext.regional = found; return { value: found, fromContext: false }; }
  if (_asstContext.regional) return { value: _asstContext.regional, fromContext: true };
  return { value: null, fromContext: false };
}

// ── Intenção: materiais críticos/urgentes ───────────────────────────
function _asstIntentCriticidade(query) {
  if (!_asstHasAnalise() || !window._rankByLevel) return _asstNoAnaliseMsg();

  const centralRes  = _asstResolveCentralCtx(query);
  const regionalRes = !centralRes.value ? _asstResolveRegionalCtx(query) : { value: null, fromContext: false };

  let critico = window._rankByLevel.critico || [];
  let urgente = window._rankByLevel.urgente || [];
  let escopo = '', nota = '';

  if (centralRes.value) {
    critico = critico.filter(i => i.central === centralRes.value);
    urgente = urgente.filter(i => i.central === centralRes.value);
    escopo = ` em <b>${escapeHtml(centralRes.value)}</b>`;
    if (centralRes.fromContext) nota = _asstContextNote('central', centralRes.value);
  } else if (regionalRes.value) {
    critico = critico.filter(i => i.regional === regionalRes.value);
    urgente = urgente.filter(i => i.regional === regionalRes.value);
    escopo = ` na regional de <b>${escapeHtml(regionalRes.value)}</b>`;
    if (regionalRes.fromContext) nota = _asstContextNote('regional', regionalRes.value);
  }

  if (!critico.length && !urgente.length) {
    return nota + `Nenhum material crítico ou urgente${escopo} no período ${_asstPeriodoLabel()}. 👍`;
  }

  const item = i => `${escapeHtml(i.mat)} — ${escapeHtml(i.central)} (${signedKg(i.diff)})`;
  let html = `<b>${critico.length}</b> crítico(s) e <b>${urgente.length}</b> urgente(s)${escopo} — período ${_asstPeriodoLabel()}.`;

  if (critico.length) {
    html += `<div class="asst-section-title" style="color:var(--red)"><i class="ti ti-flame"></i> Críticos</div>`;
    html += critico.slice(0, 8).map(i => `<div class="asst-item">${item(i)}</div>`).join('');
    if (critico.length > 8) html += `<div class="asst-more">+ ${critico.length - 8} outro(s)</div>`;
  }
  if (urgente.length) {
    html += `<div class="asst-section-title" style="color:var(--amber)"><i class="ti ti-alert-circle"></i> Urgentes</div>`;
    html += urgente.slice(0, 8).map(i => `<div class="asst-item">${item(i)}</div>`).join('');
    if (urgente.length > 8) html += `<div class="asst-more">+ ${urgente.length - 8} outro(s)</div>`;
  }
  return nota + html;
}

// ── Intenção: ranking de centrais (pior/melhor) ─────────────────────
function _asstIntentRankingCentral(query, wantWorst) {
  if (!_asstHasAnalise() || typeof _macroState === 'undefined' || !_macroState?.centralMap) return _asstNoAnaliseMsg();

  const entries = Object.entries(_macroState.centralMap);
  if (!entries.length) return `Não há dados de centrais disponíveis para o período ${_asstPeriodoLabel()}.`;

  const sorted = entries.sort((a, b) => {
    const A = a[1].counts, B = b[1].counts;
    if (B.critico !== A.critico) return B.critico - A.critico;
    if (B.urgente !== A.urgente) return B.urgente - A.urgente;
    if (B.atencao !== A.atencao) return B.atencao - A.atencao;
    return Math.abs(b[1].worstDiff) - Math.abs(a[1].worstDiff);
  });

  const list  = wantWorst ? sorted.slice(0, 5) : sorted.slice().reverse().slice(0, 5);
  const title = wantWorst ? 'Piores centrais' : 'Melhores centrais';

  let html = `<b>${title} — período ${_asstPeriodoLabel()}</b>`;
  html += list.map(([central, v], idx) => {
    const lvlLabel = (typeof _levelLabel !== 'undefined' && _levelLabel[v.level]) || String(v.level || '—').toUpperCase();
    return `<div class="asst-item">${idx + 1}. <b>${escapeHtml(central)}</b> — ${v.counts.critico} crítico(s), ${v.counts.urgente} urgente(s), ${v.counts.atencao} atenção · saúde ${lvlLabel}</div>`;
  }).join('');
  return html;
}

// ── Intenção: ocorrências abertas ───────────────────────────────────
function _asstIntentOcorrencias(query) {
  const centralRes = _asstResolveCentralCtx(query);
  const abertas  = (state.ocorrencias || []).filter(o => !o.concluida && !o.inconclusiva);
  const filtradas = centralRes.value ? abertas.filter(o => normalizeText(o.central) === normalizeText(centralRes.value)) : abertas;

  const escopo = centralRes.value ? ` em <b>${escapeHtml(centralRes.value)}</b>` : '';
  const nota = centralRes.fromContext ? _asstContextNote('central', centralRes.value) : '';

  if (!filtradas.length) return nota + `Nenhuma ocorrência aberta${escopo}. 👍`;

  const vencidas = filtradas.filter(o => ocDateStatus(o.dataLimite) === 'vencida');
  const urgentes = filtradas.filter(o => ocDateStatus(o.dataLimite) === 'urgente');

  let html = `<b>${filtradas.length}</b> ocorrência(s) aberta(s)${escopo}`;
  if (vencidas.length) html += ` — <span style="color:var(--red)">${vencidas.length} vencida(s)</span>`;
  if (urgentes.length) html += ` — <span style="color:var(--amber)">${urgentes.length} vencendo em breve</span>`;

  html += filtradas.slice(0, 8).map(o => {
    const st = ocDateStatus(o.dataLimite);
    const badge = st === 'vencida' ? '🔴' : st === 'urgente' ? '🟠' : '⚪';
    const assunto = (o.descricao || o.motivo || '').trim();
    const assuntoCurto = assunto.length > 60 ? assunto.slice(0, 60) + '…' : assunto;
    return `<div class="asst-item">${badge} <b>${escapeHtml(o.central || '—')}</b>${o.material ? ' · ' + escapeHtml(o.material) : ''} — prazo ${o.dataLimite ? fmtDateBR(o.dataLimite) : '—'}${assuntoCurto ? '<br><span style="color:var(--text2)">' + escapeHtml(assuntoCurto) + '</span>' : ''}</div>`;
  }).join('');
  if (filtradas.length > 8) html += `<div class="asst-more">+ ${filtradas.length - 8} outra(s)</div>`;
  return nota + html;
}

// ── Intenção: saúde global / resumo do período ──────────────────────
function _asstIntentSaudeGlobal() {
  if (!_asstHasAnalise() || typeof _macroState === 'undefined' || !_macroState?.centralMap) return _asstNoAnaliseMsg();

  const centrals = Object.values(_macroState.centralMap);
  const byLevel  = window._rankByLevel || { critico: [], urgente: [], atencao: [] };
  const distrib  = { bom: 0, atencao: 0, urgente: 0, critico: 0 };
  centrals.forEach(c => { distrib[c.level] = (distrib[c.level] || 0) + 1; });

  let html = `<b>Resumo geral — ${_asstPeriodoLabel()}</b>`;
  html += `<div class="asst-item">${centrals.length} central(is) analisada(s): 🔴 ${distrib.critico} crítica(s) &nbsp; 🟠 ${distrib.urgente} urgente(s) &nbsp; 🟡 ${distrib.atencao} atenção &nbsp; 🟢 ${distrib.bom} boa(s)</div>`;
  html += `<div class="asst-item">Materiais: <b>${byLevel.critico.length}</b> crítico(s), <b>${byLevel.urgente.length}</b> urgente(s), <b>${byLevel.atencao.length}</b> em atenção.</div>`;

  const abertas  = (state.ocorrencias || []).filter(o => !o.concluida && !o.inconclusiva);
  const vencidas = abertas.filter(o => ocDateStatus(o.dataLimite) === 'vencida');
  html += `<div class="asst-item">Ocorrências: <b>${abertas.length}</b> aberta(s)${vencidas.length ? `, <span style="color:var(--red)">${vencidas.length} vencida(s)</span>` : ''}.</div>`;

  let ausTotal = 0;
  try { ausTotal = (_ausComputar(window.__analiticoDtIni, window.__analiticoDtFim) || []).length; } catch (e) {}
  if (ausTotal) html += `<div class="asst-item">Ausências de lançamento: <b>${ausTotal}</b> no período.</div>`;

  return html;
}

// ── Intenção: saldo de um material específico numa central ──────────
function _asstIntentSaldoMaterial(query) {
  if (!_asstHasAnalise()) return _asstNoAnaliseMsg();

  const centralRes = _asstResolveCentralCtx(query);
  const matRes     = _asstResolveMaterialCtx(query);
  const central = centralRes.value, matAlias = matRes.value;

  if (!central && !matAlias) return 'Não identifiquei a central nem o material na pergunta. Tente algo como: "saldo de CIMENTO CP-II na central Volta Redonda".';
  if (!central)  return `Identifiquei o material <b>${escapeHtml(matAlias)}</b>, mas não a central. Qual central você quer consultar?`;
  if (!matAlias) return `Identifiquei a central <b>${escapeHtml(central)}</b>, mas não o material. Qual material você quer consultar?`;

  let nota = '';
  if (centralRes.fromContext) nota += _asstContextNote('central', central);
  if (matRes.fromContext)     nota += _asstContextNote('material', matAlias);

  const dtIni = window.__analiticoDtIni, dtFim = window.__analiticoDtFim;
  const lancsAll = getLancsByCentralInPeriod(central, dtIni, dtFim).filter(l => l.material === matAlias);
  const sapAll   = getSapByCentralInPeriod(central, dtIni, dtFim).filter(s => s.material === matAlias);

  const rawCat = (lancsAll[0]?.categoria || sapAll[0]?.categoria || '').trim().toUpperCase();
  const catKey = detectCatKey(rawCat) || detectCatFromMat(matAlias);
  const prev   = getPrePeriodLaunchStock({ central, material: matAlias, dtIni, dtFim, catKey });
  const snap   = buildSnapshot({
    lancs: lancsAll, sap: sapAll,
    initialStockOverride:     prev?.value  ?? null,
    initialDateLabelOverride: prev?.dtLabel ?? null,
  });

  if (!lancsAll.length && !sapAll.length && snap.pesoIniAusente) {
    return nota + `Não encontrei movimentações de <b>${escapeHtml(matAlias)}</b> em <b>${escapeHtml(central)}</b> no período ${_asstPeriodoLabel()}.`;
  }

  const thresholds = getHealthThresholds();
  const level = classifyVariation(Math.abs(snap.diff), catKey, thresholds);
  const levelLabel = (typeof _levelLabel !== 'undefined' && _levelLabel[level]) || String(level || '—').toUpperCase();

  let html = `<b>${escapeHtml(matAlias)}</b> — <b>${escapeHtml(central)}</b> · período ${_asstPeriodoLabel()}`;
  html += `<div class="asst-item">Est. Inicial: ${snap.pesoIniAusente ? '—' : fmtKg(snap.pesoIni)} (${snap.dtIniLabel})</div>`;
  html += `<div class="asst-item">Entradas: ${fmtKg(snap.totalEnt)} &nbsp; Saídas: ${fmtKg(Math.abs(snap.totalSai))}</div>`;
  html += `<div class="asst-item">Est. Teórico: ${fmtKg(snap.estTeorico)}</div>`;
  html += `<div class="asst-item">Est. Final (real): ${snap.pesoFimAusente ? '—' : fmtKg(snap.pesoFim)} (${snap.dtFimLabel})</div>`;
  html += `<div class="asst-item"><b>Variação: ${signedKg(snap.diff)}</b> — ${levelLabel}</div>`;
  return nota + html;
}

// ── Intenção: tendência/projeção (regressão linear sobre ~8 semanas) ─
function _asstIntentTendencia(query) {
  if (!_asstHasAnalise()) return _asstNoAnaliseMsg();

  const centralRes = _asstResolveCentralCtx(query);
  const matRes     = _asstResolveMaterialCtx(query);
  const central = centralRes.value, matAlias = matRes.value;

  if (!central && !matAlias) return 'Para projetar uma tendência preciso da central e do material. Ex.: "tendência de CIMENTO CP-II na central Volta Redonda".';
  if (!central)  return `Identifiquei o material <b>${escapeHtml(matAlias)}</b>, mas não a central. Qual central?`;
  if (!matAlias) return `Identifiquei a central <b>${escapeHtml(central)}</b>, mas não o material. Qual material?`;

  if (typeof _tCompute !== 'function' || typeof _tForecast !== 'function') {
    return 'O módulo de tendência não está disponível nesta tela.';
  }

  let nota = '';
  if (centralRes.fromContext) nota += _asstContextNote('central', central);
  if (matRes.fromContext)     nota += _asstContextNote('material', matAlias);

  const dtFim = window.__analiticoDtFim instanceof Date ? window.__analiticoDtFim : new Date(window.__analiticoDtFim);
  const dtIniHist = new Date(dtFim);
  dtIniHist.setDate(dtIniHist.getDate() - 56);

  let weekData;
  try {
    weekData = _tCompute('central', central, dtIniHist, dtFim, new Set([matAlias]));
  } catch (err) {
    console.error('Assistente: erro ao computar tendência', err);
    return nota + 'Não consegui calcular a tendência agora.';
  }

  const comHistorico = (weekData || []).filter(w => w.realKg > 0);
  if (comHistorico.length < 2) {
    return nota + `Não há histórico semanal suficiente de <b>${escapeHtml(matAlias)}</b> em <b>${escapeHtml(central)}</b> para projetar uma tendência.`;
  }

  const forecast = _tForecast(weekData);
  if (forecast === null || !Number.isFinite(forecast)) {
    return nota + `Não foi possível calcular uma projeção confiável para <b>${escapeHtml(matAlias)}</b> em <b>${escapeHtml(central)}</b>.`;
  }

  const ultimas = comHistorico.slice(-4);
  let html = `<b>Projeção — ${escapeHtml(matAlias)}</b> em <b>${escapeHtml(central)}</b>`;
  html += `<div class="asst-item">Últimas semanas: ${ultimas.map(w => `${w.shortLabel}: ${signedKg(w.variation)}`).join(' · ')}</div>`;
  html += `<div class="asst-item"><b>Projeção para a próxima semana: ${signedKg(forecast)}</b></div>`;
  html += `<div class="asst-more">Regressão linear simples sobre as últimas ${ultimas.length} semanas — use como indicativo, não substitui a análise do período.</div>`;
  return nota + html;
}

// ── Intenção: centrais/materiais sem lançar (ausências) ─────────────
function _asstIntentAusencias(query) {
  if (!_asstHasAnalise()) return _asstNoAnaliseMsg();
  if (typeof _ausComputar !== 'function') return 'O módulo de ausências não está disponível nesta tela.';

  const centralRes = _asstResolveCentralCtx(query);

  let ausencias;
  try {
    ausencias = _ausComputar(window.__analiticoDtIni, window.__analiticoDtFim) || [];
  } catch (err) {
    console.error('Assistente: erro ao computar ausências', err);
    return 'Não consegui calcular as ausências de lançamento agora.';
  }

  const filtradas = centralRes.value ? ausencias.filter(a => a.central === centralRes.value) : ausencias;
  const escopo = centralRes.value ? ` em <b>${escapeHtml(centralRes.value)}</b>` : '';
  const nota = centralRes.fromContext ? _asstContextNote('central', centralRes.value) : '';

  if (!filtradas.length) return nota + `Nenhuma ausência de lançamento${escopo} no período ${_asstPeriodoLabel()}. 👍`;

  const porCentral = new Map();
  filtradas.forEach(a => {
    if (!porCentral.has(a.central)) porCentral.set(a.central, { dias: 0, materiais: new Set() });
    const g = porCentral.get(a.central);
    g.dias += a.diasAusentes.length;
    g.materiais.add(a.mat);
  });
  const ranking = [...porCentral.entries()].sort((a, b) => b[1].dias - a[1].dias);

  let html = `<b>${filtradas.length}</b> ausência(s) de lançamento${escopo} — período ${_asstPeriodoLabel()}.`;
  html += ranking.slice(0, 8).map(([c, g]) =>
    `<div class="asst-item"><b>${escapeHtml(c)}</b> — ${g.materiais.size} material(is), ${g.dias} dia(s) ausente(s) no total</div>`
  ).join('');
  if (ranking.length > 8) html += `<div class="asst-more">+ ${ranking.length - 8} outra(s) central(is)</div>`;
  return nota + html;
}

// ── Intenção: ações de relatório cadastradas para um material crítico ─
function _asstIntentAcoes(query) {
  if (!_asstHasAnalise() || !window._rankByLevel) return _asstNoAnaliseMsg();
  if (typeof _resolverAcoesParaMaterial !== 'function') return 'O módulo de ações de relatório não está disponível nesta tela.';

  const centralRes = _asstResolveCentralCtx(query);
  const matRes     = _asstResolveMaterialCtx(query);
  const central = centralRes.value, matAlias = matRes.value;

  if (!central && !matAlias) return 'Para consultar as ações definidas, preciso da central e do material. Ex.: "ações para CIMENTO CP-II na central Volta Redonda".';
  if (!central)  return `Identifiquei o material <b>${escapeHtml(matAlias)}</b>, mas não a central. Qual central?`;
  if (!matAlias) return `Identifiquei a central <b>${escapeHtml(central)}</b>, mas não o material. Qual material?`;

  let nota = '';
  if (centralRes.fromContext) nota += _asstContextNote('central', central);
  if (matRes.fromContext)     nota += _asstContextNote('material', matAlias);

  const todos = [
    ...(window._rankByLevel.critico || []),
    ...(window._rankByLevel.urgente || []),
    ...(window._rankByLevel.atencao || []),
  ];
  const item = todos.find(i => i.central === central && i.mat === matAlias);
  if (!item) return nota + `<b>${escapeHtml(matAlias)}</b> em <b>${escapeHtml(central)}</b> não está em atenção, urgente ou crítico no período ${_asstPeriodoLabel()}.`;

  const acoes = _resolverAcoesParaMaterial(item.mat, item.diff, item.categoria, item.level, item.catKey, item.catSubKey);
  const lvlLabel = (typeof _levelLabel !== 'undefined' && _levelLabel[item.level]) || String(item.level).toUpperCase();

  let html = `<b>${escapeHtml(matAlias)}</b> em <b>${escapeHtml(central)}</b> — ${lvlLabel} (${signedKg(item.diff)})`;
  if (acoes) {
    html += `<div class="asst-section-title"><i class="ti ti-clipboard-check"></i> Ação definida</div><div class="asst-item">${escapeHtml(acoes)}</div>`;
  } else {
    html += `<div class="asst-item" style="color:var(--text2)">Nenhuma ação cadastrada para esse cenário em Configurações.</div>`;
  }
  return nota + html;
}

// ── Intenção: pendências de cadastro (Configurações → Padronização) ──
// Um registro fica "pendente" quando findMaterialMatch/normalizarCentral
// não encontram nenhum item cadastrado — ambas são consultas puras,
// nunca mutam o state (ao contrário de reaplicarPadronizacaoMateriais/
// Centrais, que por isso nunca são chamadas aqui).
function _asstIntentConfigPendente() {
  if (typeof CENTRAL_FIELDS_BY_MODULO === 'undefined' || typeof findMaterialMatch !== 'function') {
    return 'Não consegui verificar pendências de cadastro agora.';
  }

  const materiaisPendentes = new Map();
  const centraisPendentes  = new Map();

  ['entradas', 'saidas', 'lancamentos', 'sap'].forEach(mod => {
    (state[mod] || []).forEach(r => {
      const rawMat = String(r.materialOriginal ?? '').trim();
      if (rawMat && !findMaterialMatch(rawMat)) {
        materiaisPendentes.set(rawMat, (materiaisPendentes.get(rawMat) || 0) + 1);
      }
    });
  });

  const filIdx = getFilialLookupIndex();
  Object.entries(CENTRAL_FIELDS_BY_MODULO).forEach(([mod, fields]) => {
    (state[mod] || []).forEach(r => {
      fields.forEach(f => {
        const rawCentral = String(r[`${f}Original`] ?? '').trim();
        if (!rawCentral) return;
        const found = filIdx.exact.get(normalizeText(rawCentral));
        if (!found) centraisPendentes.set(rawCentral, (centraisPendentes.get(rawCentral) || 0) + 1);
      });
    });
  });

  if (!materiaisPendentes.size && !centraisPendentes.size) {
    return 'Nenhum material ou central pendente de padronização. 👍';
  }

  let html = `<b>Pendências de cadastro</b> (Configurações → Padronização)`;

  if (materiaisPendentes.size) {
    const list = [...materiaisPendentes.entries()].sort((a, b) => b[1] - a[1]);
    html += `<div class="asst-section-title" style="color:var(--amber)"><i class="ti ti-alert-triangle"></i> Materiais não padronizados (${list.length})</div>`;
    html += list.slice(0, 8).map(([raw, count]) => `<div class="asst-item">${escapeHtml(raw)} — ${count} registro(s)</div>`).join('');
    if (list.length > 8) html += `<div class="asst-more">+ ${list.length - 8} outro(s)</div>`;
  }
  if (centraisPendentes.size) {
    const list = [...centraisPendentes.entries()].sort((a, b) => b[1] - a[1]);
    html += `<div class="asst-section-title" style="color:var(--amber)"><i class="ti ti-alert-triangle"></i> Centrais não padronizadas (${list.length})</div>`;
    html += list.slice(0, 8).map(([raw, count]) => `<div class="asst-item">${escapeHtml(raw)} — ${count} registro(s)</div>`).join('');
    if (list.length > 8) html += `<div class="asst-more">+ ${list.length - 8} outro(s)</div>`;
  }
  return html;
}

// ── Intenções: tabelas brutas (Entradas/Saídas/Lançamentos/SAP/Produção) ─
// Leem state.* diretamente — nunca dependem de análise rodada, e o
// filtro de central/material é opcional (mesma resolução com memória
// de contexto usada no resto do assistente).
function _asstFiltroBruto(query, records) {
  const centralRes = _asstResolveCentralCtx(query);
  const matRes     = _asstResolveMaterialCtx(query);
  let filtrados = records;
  if (centralRes.value) filtrados = filtrados.filter(r => r.central === centralRes.value);
  if (matRes.value)     filtrados = filtrados.filter(r => r.material === matRes.value);

  let nota = '';
  if (centralRes.fromContext) nota += _asstContextNote('central', centralRes.value);
  if (matRes.fromContext)     nota += _asstContextNote('material', matRes.value);

  const partes = [];
  if (centralRes.value) partes.push(`central <b>${escapeHtml(centralRes.value)}</b>`);
  if (matRes.value)     partes.push(`material <b>${escapeHtml(matRes.value)}</b>`);

  return { filtrados, nota, escopo: partes.join(', ') };
}

function _asstResumoBruto(records, pesoField, valorField) {
  return {
    total: records.length,
    peso:  records.reduce((s, r) => s + (Number(r[pesoField]) || 0), 0),
    valor: records.reduce((s, r) => s + (Number(r[valorField]) || 0), 0),
  };
}

function _asstFmtMoeda(v) {
  return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function _asstIntentEntradasConsulta(query) {
  const { filtrados, nota, escopo } = _asstFiltroBruto(query, state.entradas || []);
  if (!filtrados.length) return nota + `Nenhuma entrada encontrada${escopo ? ' — ' + escopo : ''}.`;
  const r = _asstResumoBruto(filtrados, 'peso', 'valorTotal');
  let html = `<b>${r.total}</b> entrada(s)${escopo ? ' — ' + escopo : ''}.`;
  html += `<div class="asst-item">Peso total: ${fmtKg(r.peso)}</div>`;
  html += `<div class="asst-item">Valor total: ${_asstFmtMoeda(r.valor)}</div>`;
  return nota + html;
}

function _asstIntentSaidasConsulta(query) {
  const { filtrados, nota, escopo } = _asstFiltroBruto(query, state.saidas || []);
  if (!filtrados.length) return nota + `Nenhuma saída encontrada${escopo ? ' — ' + escopo : ''}.`;
  const r = _asstResumoBruto(filtrados, 'peso', 'valorTotal');
  let html = `<b>${r.total}</b> saída(s)${escopo ? ' — ' + escopo : ''}.`;
  html += `<div class="asst-item">Peso total: ${fmtKg(r.peso)}</div>`;
  html += `<div class="asst-item">Valor total: ${_asstFmtMoeda(r.valor)}</div>`;
  return nota + html;
}

function _asstIntentLancamentosConsulta(query) {
  const { filtrados, nota, escopo } = _asstFiltroBruto(query, state.lancamentos || []);
  if (!filtrados.length) return nota + `Nenhum lançamento encontrado${escopo ? ' — ' + escopo : ''}.`;
  const r = _asstResumoBruto(filtrados, 'peso', 'valorTotal');
  let html = `<b>${r.total}</b> lançamento(s)${escopo ? ' — ' + escopo : ''}.`;
  html += `<div class="asst-item">Peso total: ${fmtKg(r.peso)}</div>`;
  html += `<div class="asst-item">Valor total: ${_asstFmtMoeda(r.valor)}</div>`;
  return nota + html;
}

function _asstIntentSapConsulta(query) {
  const { filtrados, nota, escopo } = _asstFiltroBruto(query, state.sap || []);
  if (!filtrados.length) return nota + `Nenhuma movimentação SAP encontrada${escopo ? ' — ' + escopo : ''}.`;
  const r = _asstResumoBruto(filtrados, 'peso', 'valorTotal');
  let html = `<b>${r.total}</b> movimentação(ões) SAP${escopo ? ' — ' + escopo : ''}.`;
  html += `<div class="asst-item">Peso total: ${fmtKg(r.peso)}</div>`;
  html += `<div class="asst-item">Valor total: ${_asstFmtMoeda(r.valor)}</div>`;
  return nota + html;
}

function _asstIntentProducaoConsulta(query) {
  const centralRes = _asstResolveCentralCtx(query);
  let filtrados = state.producao || [];
  if (centralRes.value) filtrados = filtrados.filter(r => r.central === centralRes.value);

  const nota   = centralRes.fromContext ? _asstContextNote('central', centralRes.value) : '';
  const escopo = centralRes.value ? `central <b>${escapeHtml(centralRes.value)}</b>` : '';

  if (!filtrados.length) return nota + `Nenhum registro de produção encontrado${escopo ? ' — ' + escopo : ''}.`;

  const producaoTotal = filtrados.reduce((s, r) => s + (Number(r.producao) || 0), 0);
  const vendasTotal   = filtrados.reduce((s, r) => s + (Number(r.totalVendas) || 0), 0);

  let html = `<b>${filtrados.length}</b> registro(s) de produção${escopo ? ' — ' + escopo : ''}.`;
  html += `<div class="asst-item">Produção total: ${producaoTotal.toLocaleString('pt-BR')} m³</div>`;
  html += `<div class="asst-item">Total de vendas: ${_asstFmtMoeda(vendasTotal)}</div>`;
  return nota + html;
}

// ── Registro de intenções ────────────────────────────────────────────
// Cada item vira uma entrada do menu "/" (label amigável, agrupada por
// group). requiresAnalise indica se a intenção depende de uma análise
// já ter sido rodada no Dashboard Analítico (window.__analiticoDtIni/Fim,
// _macroState, window._rankByLevel) — ocorrências e pendências de
// cadastro leem dado bruto e por isso nunca dependem disso. needs é só
// informativo (usado na mensagem de trava, para avisar o que citar);
// quem resolve central/material de fato continua sendo o próprio
// handler via _asstResolve*Ctx, que já lembra o que foi dito antes
// através de _asstContext — é essa memória (não uma máquina de estado
// nova) que resolve o problema de o assistente perguntar algo e não
// reconhecer a resposta na mensagem seguinte, já que agora essa
// mensagem seguinte é enviada direto pro mesmo handler, sem passar de
// novo por detecção de intenção.
const _ASST_INTENTS = [
  { id: 'saldo',           label: 'Saldo de um material',           group: 'Estoque',     icon: 'ti-scale',            needs: ['material', 'central'], requiresAnalise: true,  handler: raw => _asstIntentSaldoMaterial(raw) },
  { id: 'tendencia',       label: 'Tendência de um material',       group: 'Estoque',     icon: 'ti-trending-up',      needs: ['material', 'central'], requiresAnalise: true,  handler: raw => _asstIntentTendencia(raw) },
  { id: 'pior',            label: 'Piores centrais no período',     group: 'Centrais',    icon: 'ti-arrow-down-right', needs: [],                      requiresAnalise: true,  handler: raw => _asstIntentRankingCentral(raw, true) },
  { id: 'melhor',          label: 'Melhores centrais no período',   group: 'Centrais',    icon: 'ti-arrow-up-right',   needs: [],                      requiresAnalise: true,  handler: raw => _asstIntentRankingCentral(raw, false) },
  { id: 'ausencias',       label: 'Centrais sem lançar',            group: 'Centrais',    icon: 'ti-calendar-off',     needs: [],                      requiresAnalise: true,  handler: raw => _asstIntentAusencias(raw) },
  { id: 'ocorrencias',     label: 'Ocorrências abertas',            group: 'Ocorrências', icon: 'ti-list-details',     needs: [],                      requiresAnalise: false, handler: raw => _asstIntentOcorrencias(raw) },
  { id: 'config-pendente', label: 'Pendências de padronização',     group: 'Cadastro',    icon: 'ti-alert-triangle',   needs: [],                      requiresAnalise: false, handler: () => _asstIntentConfigPendente() },
  { id: 'criticidade',     label: 'Materiais críticos/urgentes',    group: 'Geral',       icon: 'ti-flame',            needs: [],                      requiresAnalise: true,  handler: raw => _asstIntentCriticidade(raw) },
  { id: 'saude',           label: 'Resumo do período',              group: 'Geral',       icon: 'ti-report',           needs: [],                      requiresAnalise: true,  handler: () => _asstIntentSaudeGlobal() },
  { id: 'acoes',           label: 'Ações para um material crítico', group: 'Geral',       icon: 'ti-clipboard-check',  needs: ['material', 'central'], requiresAnalise: true,  handler: raw => _asstIntentAcoes(raw) },

  // ── Tabelas brutas: consulta (somente leitura, independe de análise) ─
  { id: 'entradas-consulta',     label: 'Entradas (NF) registradas',   group: 'Consultar dados', icon: 'ti-package-import', needs: [], requiresAnalise: false, handler: raw => _asstIntentEntradasConsulta(raw) },
  { id: 'saidas-consulta',       label: 'Saídas (OS) registradas',     group: 'Consultar dados', icon: 'ti-package-export', needs: [], requiresAnalise: false, handler: raw => _asstIntentSaidasConsulta(raw) },
  { id: 'lancamentos-consulta',  label: 'Lançamentos registrados',     group: 'Consultar dados', icon: 'ti-clipboard-list', needs: [], requiresAnalise: false, handler: raw => _asstIntentLancamentosConsulta(raw) },
  { id: 'sap-consulta',          label: 'Movimentações SAP',           group: 'Consultar dados', icon: 'ti-database',       needs: [], requiresAnalise: false, handler: raw => _asstIntentSapConsulta(raw) },
  { id: 'producao-consulta',     label: 'Produção registrada',         group: 'Consultar dados', icon: 'ti-chart-bar',      needs: [], requiresAnalise: false, handler: raw => _asstIntentProducaoConsulta(raw) },

  // ── Tabelas brutas: registro manual (única ação que o assistente
  // dispara — sempre formulário → confirmação explícita antes de gravar,
  // reaproveitando as mesmas funções puras que os modais das telas usam) ─
  { id: 'entrada-registrar',    label: 'Registrar entrada (NF)',        group: 'Registrar dado', icon: 'ti-circle-plus', needs: [], requiresAnalise: false, formKind: 'entrada',    handler: () => _asstManualNoOpMsg() },
  { id: 'saida-registrar',      label: 'Registrar saída (OS)',          group: 'Registrar dado', icon: 'ti-circle-plus', needs: [], requiresAnalise: false, formKind: 'saida',      handler: () => _asstManualNoOpMsg() },
  { id: 'lancamento-registrar', label: 'Registrar lançamento',          group: 'Registrar dado', icon: 'ti-circle-plus', needs: [], requiresAnalise: false, formKind: 'lancamento', handler: () => _asstManualNoOpMsg() },
  { id: 'sap-registrar',        label: 'Registrar movimentação SAP',    group: 'Registrar dado', icon: 'ti-circle-plus', needs: [], requiresAnalise: false, formKind: 'sap',        handler: () => _asstManualNoOpMsg() },
  { id: 'producao-registrar',   label: 'Registrar produção',            group: 'Registrar dado', icon: 'ti-circle-plus', needs: [], requiresAnalise: false, formKind: 'producao',   handler: () => _asstManualNoOpMsg() },
];

function _asstIntentById(id) {
  return _ASST_INTENTS.find(it => it.id === id) || null;
}

const _ASST_SLOT_LABEL = { material: 'o material', central: 'a central' };


// ── Contexto travado via "/" ──────────────────────────────────────────
let _asstLockedIntent = null;
const _asstDD = { open: false, items: [], active: 0 };

function _asstGroupedForFilter(filterRaw) {
  const f = normalizeLooseText(filterRaw || '');
  return _ASST_INTENTS.filter(it => !f
    || normalizeLooseText(it.label).includes(f)
    || normalizeLooseText(it.group).includes(f));
}

function _asstOpenDropdown(filterRaw) {
  _asstDD.items = _asstGroupedForFilter(filterRaw);
  if (_asstDD.active >= _asstDD.items.length) _asstDD.active = Math.max(0, _asstDD.items.length - 1);
  _asstDD.open = true;
  _asstRenderDropdown();
}

function _asstCloseDropdown() {
  _asstDD.open = false;
  _asstRenderDropdown();
}

function _asstRenderDropdown() {
  const el = document.getElementById('asst-dropdown');
  if (!el) return;
  if (!_asstDD.open) { el.style.display = 'none'; el.innerHTML = ''; return; }

  if (!_asstDD.items.length) {
    el.innerHTML = '<div class="asst-dd-empty">Nenhum contexto encontrado.</div>';
    el.style.display = '';
    return;
  }

  let html = '', lastGroup = null;
  _asstDD.items.forEach((it, idx) => {
    if (it.group !== lastGroup) { html += `<div class="asst-dd-group">${escapeHtml(it.group)}</div>`; lastGroup = it.group; }
    const flag = (it.requiresAnalise && !_asstHasAnalise())
      ? '<i class="ti ti-calendar asst-dd-flag" title="pede um período analisado"></i>' : '';
    html += `<div class="asst-dd-item${idx === _asstDD.active ? ' active' : ''}" onclick="_asstSelectIntent('${it.id}')"><i class="ti ${it.icon} asst-dd-icon"></i><span>${escapeHtml(it.label)}</span>${flag}</div>`;
  });
  el.innerHTML = html;
  el.style.display = '';
}

function _asstInputChanged(el) {
  const v = el.value;
  if (v.charAt(0) === '/') {
    _asstDD.active = 0;
    _asstOpenDropdown(v.slice(1));
  } else if (_asstDD.open) {
    _asstCloseDropdown();
  }
}

function _asstInputKeydown(ev) {
  if (_asstDD.open) {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); _asstDD.active = Math.min(_asstDD.active + 1, _asstDD.items.length - 1); _asstRenderDropdown(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); _asstDD.active = Math.max(_asstDD.active - 1, 0); _asstRenderDropdown(); }
    else if (ev.key === 'Enter') { ev.preventDefault(); const it = _asstDD.items[_asstDD.active]; if (it) _asstSelectIntent(it.id); }
    else if (ev.key === 'Escape') { _asstCloseDropdown(); const input = document.getElementById('asst-input'); if (input) input.value = ''; }
    return;
  }
  if (ev.key === 'Enter') asstSend();
}

// ── Etiquetas de contexto/período acima do campo de digitação ───────
function _asstRenderContextPill(it) {
  const pill  = document.getElementById('asst-context-pill');
  const icon  = document.getElementById('asst-context-pill-icon');
  const label = document.getElementById('asst-context-pill-label');
  if (!pill || !label) return;
  if (icon) icon.className = 'ti ' + it.icon;
  label.textContent = it.label;
  pill.style.display = '';
  _asstRenderPeriodPill();
}

function _asstRenderPeriodPill() {
  const row     = document.getElementById('asst-pill-row');
  const pill    = document.getElementById('asst-period-pill');
  const label   = document.getElementById('asst-period-pill-label');
  const ctxPill = document.getElementById('asst-context-pill');
  if (!row || !pill || !label) return;
  if (_asstHasAnalise()) {
    label.textContent = _asstPeriodoLabel();
    pill.style.display = '';
  } else {
    pill.style.display = 'none';
  }
  const anyVisible = (ctxPill && ctxPill.style.display !== 'none') || pill.style.display !== 'none';
  row.style.display = anyVisible ? 'flex' : 'none';
}

function _asstClearIntent() {
  _asstLockedIntent = null;
  const pill = document.getElementById('asst-context-pill');
  if (pill) pill.style.display = 'none';
  _asstRenderPeriodPill();
  _asstAppendMsg('bot', 'Contexto removido. Digite / para escolher outro.');
}

// ── Seletor de período dentro do chat ────────────────────────────────
// O usuário sempre escolhe as datas — o assistente nunca sugere nem
// assume um período por conta própria.
function _asstPeriodPickerHtml() {
  return `<div class="asst-pp">
    <div class="asst-pp-row">
      <input type="date" class="asst-pp-ini">
      <input type="date" class="asst-pp-fim">
    </div>
    <button class="asst-pp-btn" onclick="_asstRunAnaliseFromChat(this)">Rodar análise</button>
    <div class="asst-pp-err" style="display:none">Escolha as duas datas.</div>
  </div>`;
}

function _asstRunAnaliseFromChat(btn) {
  const wrap = btn.closest('.asst-pp');
  const iniEl = wrap?.querySelector('.asst-pp-ini');
  const fimEl = wrap?.querySelector('.asst-pp-fim');
  const errEl = wrap?.querySelector('.asst-pp-err');
  if (!iniEl || !fimEl || !errEl) return;

  const iniStr = iniEl.value, fimStr = fimEl.value;
  if (!iniStr || !fimStr) { errEl.style.display = ''; return; }
  errEl.style.display = 'none';
  btn.disabled = true; iniEl.disabled = true; fimEl.disabled = true;
  btn.textContent = 'Analisando...';

  if (typeof rodarAnalitico !== 'function') {
    _asstAppendMsg('bot', 'Não consegui rodar a análise agora — o módulo do Dashboard Analítico não está disponível nesta tela.');
    return;
  }

  rodarAnalitico(iniStr, fimStr, result => {
    if (!result || !result.ok) {
      btn.disabled = false; iniEl.disabled = false; fimEl.disabled = false;
      btn.textContent = 'Rodar análise';
      const motivo = result?.reason === 'sem-dados'
        ? 'Não encontrei dados para esse período — tente outras datas.'
        : 'Não consegui concluir a análise — confira as datas e tente de novo.';
      _asstAppendMsg('bot', motivo);
      return;
    }
    _asstRenderPeriodPill();
    const msg = `Análise concluída para o período <b>${_asstPeriodoLabel()}</b>.`
      + (_asstLockedIntent ? ' ' + _asstContextLockedMsg(_asstLockedIntent) : '');
    _asstAppendMsg('bot', msg);
  });
}

function _asstEditPeriod() {
  _asstAppendMsg('bot', 'Trocar o período da análise:');
  _asstAppendMsg('bot', _asstPeriodPickerHtml());
}

function _asstContextLockedMsg(it) {
  let msg = `Contexto travado em <b>${escapeHtml(it.label)}</b>. Pergunte livremente`;
  msg += (it.needs && it.needs.length)
    ? ` — cite ${it.needs.map(n => _ASST_SLOT_LABEL[n]).join(' e ')}; se faltar algo, eu pergunto.`
    : ' dentro desse tema.';
  if (it.requiresAnalise) msg += ` Usando o período já analisado: <b>${_asstPeriodoLabel()}</b>.`;
  return msg;
}

function _asstSelectIntent(id) {
  const it = _asstIntentById(id);
  if (!it) return;
  _asstLockedIntent = it;
  _asstPendingManual = null;
  _asstCloseDropdown();
  const input = document.getElementById('asst-input');
  if (input) { input.value = ''; input.focus(); }
  _asstRenderContextPill(it);

  if (it.requiresAnalise && !_asstHasAnalise()) {
    _asstAppendMsg('bot', `Para responder sobre <b>${escapeHtml(it.label)}</b> preciso de um período analisado antes. Escolha as datas:`);
    _asstAppendMsg('bot', _asstPeriodPickerHtml());
    return;
  }
  if (it.formKind) {
    _asstAppendMsg('bot', `Preencha os dados para registrar ${escapeHtml(_ASST_MANUAL_FORMS[it.formKind]?.label || '')}:`);
    _asstAppendMsg('bot', _asstManualFormHtml(it.formKind));
    return;
  }
  _asstAppendMsg('bot', _asstContextLockedMsg(it));
}

// ── Registro manual de dados brutos — única ação que o assistente pode
// disparar. Sempre em dois passos: formulário → confirmação explícita
// antes de gravar. create() chama as mesmas funções puras de import.js
// usadas pelos modais das telas, sem duplicar validação/normalização.
let _asstPendingManual = null;

const _ASST_MANUAL_FORMS = {
  entrada: {
    label: 'entrada (NF)', create: dados => _criarRegistroEntrada(dados),
    fields: [
      { key: 'central',    label: 'Central compra',  type: 'text',   required: true },
      { key: 'mat',        label: 'Material',        type: 'text',   required: true },
      { key: 'peso',       label: 'Peso (kg)',       type: 'number', required: true },
      { key: 'custo',      label: 'Custo unitário',  type: 'number' },
      { key: 'nf',         label: 'Nota fiscal',     type: 'text' },
      { key: 'fornecedor', label: 'Fornecedor',      type: 'text' },
      { key: 'dtEmissao',  label: 'Data de emissão', type: 'date' },
    ],
  },
  saida: {
    label: 'saída (OS)', create: dados => _criarRegistroSaida(dados),
    fields: [
      { key: 'central',    label: 'Central',          type: 'text',   required: true },
      { key: 'mat',        label: 'Material',         type: 'text',   required: true },
      { key: 'peso',       label: 'Peso (kg)',        type: 'number', required: true },
      { key: 'custo',      label: 'Custo unitário',   type: 'number' },
      { key: 'os',         label: 'Ordem de serviço', type: 'text' },
      { key: 'fornecedor', label: 'Fornecedor',       type: 'text' },
      { key: 'dtEmissao',  label: 'Data',             type: 'date' },
    ],
  },
  lancamento: {
    label: 'lançamento', create: dados => _criarRegistroLancamento(dados),
    fields: [
      { key: 'central',    label: 'Central',        type: 'text',   required: true },
      { key: 'mat',        label: 'Material',       type: 'text',   required: true },
      { key: 'peso',       label: 'Peso (kg)',      type: 'number', required: true },
      { key: 'custo',      label: 'Custo unitário', type: 'number' },
      { key: 'fornecedor', label: 'Fornecedor',     type: 'text' },
      { key: 'dtLanc',     label: 'Data',           type: 'date' },
    ],
  },
  sap: {
    label: 'movimentação SAP', create: dados => _criarRegistroSAP(dados),
    fields: [
      { key: 'central',   label: 'Central',            type: 'text',   required: true },
      { key: 'mat',       label: 'Material',           type: 'text',   required: true },
      { key: 'movimento', label: 'Movimento',          type: 'text',   required: true },
      { key: 'peso',      label: 'Peso (kg)',          type: 'number' },
      { key: 'custoUnit', label: 'Custo unitário',     type: 'number' },
      { key: 'documento', label: 'Documento',          type: 'text' },
      { key: 'dtLanc',    label: 'Data de lançamento', type: 'date' },
    ],
  },
  producao: {
    label: 'produção', create: dados => _criarRegistroProducao(dados),
    fields: [
      { key: 'central',  label: 'Central',       type: 'text',   required: true },
      { key: 'mes',      label: 'Mês (AAAA-MM)', type: 'text',   required: true },
      { key: 'producao', label: 'Produção (m³)', type: 'number' },
      { key: 'preco',    label: 'Preço médio',   type: 'number' },
      { key: 'custo',    label: 'Custo médio',   type: 'number' },
      { key: 'vendas',   label: 'Total vendas',  type: 'number' },
    ],
  },
};

const _ASST_MANUAL_REFRESH = {
  entrada:    () => { if (typeof renderEntradas    === 'function') renderEntradas(); },
  saida:      () => { if (typeof renderSaidas      === 'function') renderSaidas(); },
  lancamento: () => { if (typeof renderLancamentos === 'function') renderLancamentos(); },
  sap:        () => { if (typeof renderSAP         === 'function') renderSAP(); },
  producao:   () => { if (typeof renderProducao    === 'function') renderProducao(); },
};

function _asstManualNoOpMsg() {
  return 'Preencha o formulário acima pra registrar. Se quiser trocar de contexto, digite /.';
}

function _asstManualFormHtml(kind) {
  const spec = _ASST_MANUAL_FORMS[kind];
  if (!spec) return '';
  const campos = spec.fields.map(f =>
    `<label class="asst-mf-label">${escapeHtml(f.label)}${f.required ? ' *' : ''}</label>
     <input type="${f.type}" class="asst-mf-input" data-key="${f.key}">`
  ).join('');
  return `<div class="asst-mf" data-kind="${kind}">
    ${campos}
    <button class="asst-mf-btn" onclick="_asstManualFormContinue(this)">Continuar</button>
    <div class="asst-mf-err" style="display:none">Preencha os campos obrigatórios (*).</div>
  </div>`;
}

function _asstManualFormContinue(btn) {
  const wrap = btn.closest('.asst-mf');
  if (!wrap) return;
  const kind = wrap.dataset.kind;
  const spec = _ASST_MANUAL_FORMS[kind];
  if (!spec) return;

  const dados = {};
  wrap.querySelectorAll('.asst-mf-input').forEach(inp => { dados[inp.dataset.key] = inp.value.trim(); });

  const faltando = spec.fields.some(f => f.required && !dados[f.key]);
  const err = wrap.querySelector('.asst-mf-err');
  if (faltando) { if (err) err.style.display = ''; return; }
  if (err) err.style.display = 'none';

  wrap.querySelectorAll('input, button').forEach(el => { el.disabled = true; });
  _asstPendingManual = { kind, dados };
  _asstAppendMsg('bot', _asstManualConfirmHtml(kind, dados));
}

function _asstManualConfirmHtml(kind, dados) {
  const spec = _ASST_MANUAL_FORMS[kind];
  const linhas = spec.fields
    .filter(f => dados[f.key])
    .map(f => `<div class="asst-item">${escapeHtml(f.label)}: <b>${escapeHtml(dados[f.key])}</b></div>`)
    .join('');
  return `<div class="asst-mc">
    Confira antes de salvar — isso grava um registro novo de <b>${escapeHtml(spec.label)}</b>:
    ${linhas}
    <div class="asst-mc-actions">
      <button class="asst-mc-cancel" onclick="_asstManualCancel(this)">Cancelar</button>
      <button class="asst-mc-confirm" onclick="_asstManualConfirmSave(this)">Confirmar e salvar</button>
    </div>
  </div>`;
}

function _asstManualConfirmSave(btn) {
  if (!_asstPendingManual) return;
  const { kind, dados } = _asstPendingManual;
  const spec = _ASST_MANUAL_FORMS[kind];
  const wrap = btn.closest('.asst-mc');
  if (wrap) wrap.querySelectorAll('button').forEach(b => { b.disabled = true; });

  let resultado;
  try {
    resultado = spec.create(dados);
  } catch (err) {
    console.error('Assistente: erro ao salvar registro manual', err);
    resultado = { ok: false, erro: 'Ocorreu um erro ao salvar. Tente novamente.' };
  }
  _asstPendingManual = null;

  if (!resultado || !resultado.ok) {
    _asstAppendMsg('bot', resultado?.erro || 'Não consegui salvar — confira os dados e tente de novo.');
    return;
  }
  const refresh = _ASST_MANUAL_REFRESH[kind];
  if (refresh) refresh();
  _asstAppendMsg('bot', `Pronto — registro de <b>${escapeHtml(spec.label)}</b> salvo com sucesso.`);
}

function _asstManualCancel(btn) {
  _asstPendingManual = null;
  const wrap = btn.closest('.asst-mc');
  if (wrap) wrap.querySelectorAll('button').forEach(b => { b.disabled = true; });
  _asstAppendMsg('bot', 'Registro não foi salvo.');
}

// ── UI do painel de chat ─────────────────────────────────────────────
function _asstRenderMsg(role, html) {
  const body = document.getElementById('asst-chat-body');
  if (!body) return;
  const div = document.createElement('div');
  div.className = 'asst-msg asst-msg-' + role;
  if (role === 'bot') {
    div.innerHTML = `<div class="asst-msg-content">${html}</div><button class="asst-copy-btn" onclick="asstCopyMsg(this)" title="Copiar resposta"><i class="ti ti-copy"></i></button>`;
  } else {
    div.innerHTML = html;
  }
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
}

function _asstAppendMsg(role, html) {
  _asstRenderMsg(role, html);
  _asstPersistHistory();
}

function _asstPersistHistory() {
  const body = document.getElementById('asst-chat-body');
  if (!body) return;
  try {
    const items = [...body.children].map(div => ({
      role: div.classList.contains('asst-msg-bot') ? 'bot' : 'user',
      html: div.querySelector('.asst-msg-content')?.innerHTML ?? div.innerHTML,
    }));
    localStorage.setItem(ASST_HISTORY_KEY, JSON.stringify(items));
  } catch (err) { /* localStorage indisponível — sem persistência, sem quebrar o chat */ }
}

function _asstLoadHistory() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(ASST_HISTORY_KEY) || 'null'); } catch (err) { saved = null; }
  if (!Array.isArray(saved) || !saved.length) return;

  const body = document.getElementById('asst-chat-body');
  if (!body) return;
  body.innerHTML = '';
  saved.forEach(m => _asstRenderMsg(m.role === 'bot' ? 'bot' : 'user', m.html));
}

function asstCopyMsg(btn) {
  const content = btn.previousElementSibling;
  const text = content?.innerText || '';
  if (!text) return;
  navigator.clipboard?.writeText(text).then(() => toast('Resposta copiada!'));
}

// Dado o contexto travado via "/", chama o handler direto — sem passar
// de novo por detecção de intenção. Isso é o que corrige o bug de
// "pergunto algo e não reconheço a resposta seguinte": o handler usa
// _asstResolve*Ctx, que já lembra o que foi resolvido na chamada
// anterior através de _asstContext.
function _asstProcessLocked(text) {
  if (!_asstLockedIntent) return 'Escolha um contexto antes de perguntar — digite / para ver as opções.';
  const it = _asstLockedIntent;
  if (it.requiresAnalise && !_asstHasAnalise()) {
    return 'Ainda falta rodar a análise do período — preencha as datas acima antes de perguntar.';
  }
  return it.handler(text);
}

function asstSend() {
  const input = document.getElementById('asst-input');
  const text = (input?.value || '').trim();
  if (!text || text.charAt(0) === '/') return;

  _asstAppendMsg('user', escapeHtml(text));
  input.value = '';

  let resposta;
  try {
    resposta = _asstProcessLocked(text);
  } catch (err) {
    console.error('Assistente: erro ao processar pergunta', err);
    resposta = 'Ocorreu um erro ao processar essa pergunta. Tente reformular.';
  }
  _asstAppendMsg('bot', resposta);
}

function asstQuickStart(id) {
  _asstSelectIntent(id);
}

function asstClearChat() {
  const body = document.getElementById('asst-chat-body');
  if (!body) return;
  body.innerHTML = '';
  _asstRenderMsg('bot', _ASST_WELCOME_HTML);
  _asstContext = { central: null, material: null, regional: null };
  _asstLockedIntent = null;
  _asstPendingManual = null;
  _asstCloseDropdown();
  const pill = document.getElementById('asst-context-pill');
  if (pill) pill.style.display = 'none';
  _asstRenderPeriodPill();
  try { localStorage.removeItem(ASST_HISTORY_KEY); } catch (err) {}
}
