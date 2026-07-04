'use strict';

// ═══════════════════════════════════════════════════════════
// ASSISTENTE — Iteração 2
// Ainda por regras (sem LLM). Novidades:
//  - Reconhecimento mais tolerante de central/material (tokens, não só
//    substring exato — resiste a reordenação e a hífen/espaço/acento).
//  - Novas intenções: tendência/projeção (trend.js), ausências de
//    lançamento (dashboard.js) e ações de relatório cadastradas
//    (relatorio.js).
//  - Copiar resposta e histórico persistido em localStorage.
//
// Continua somente leitura — nunca cria, edita ou remove nada do state.
// ═══════════════════════════════════════════════════════════

const ASST_HISTORY_KEY = 'analyticsys_asst_history_v1';

// Mantém sincronizado com a mensagem inicial estática em index.html
// (#asst-chat-body), já que "limpar" e "sem histórico salvo" devem
// devolver o mesmo estado de boas-vindas.
const _ASST_WELCOME_HTML = `
  Oi! Eu respondo perguntas sobre a última análise rodada no Dashboard Analítico. Experimente:
  <div class="asst-suggestions">
    <button class="asst-chip" onclick="asstAskSuggestion(this)">Quais materiais estão críticos?</button>
    <button class="asst-chip" onclick="asstAskSuggestion(this)">Qual central está pior no período?</button>
    <button class="asst-chip" onclick="asstAskSuggestion(this)">Quantas ocorrências abertas existem?</button>
    <button class="asst-chip" onclick="asstAskSuggestion(this)">Resumo geral do período</button>
    <button class="asst-chip" onclick="asstAskSuggestion(this)">Quais centrais estão sem lançar?</button>
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

// ── Resolução de entidades citadas em texto livre (tolerante) ───────
// Duas passadas: (1) substring exato do nome inteiro — mais confiável
// quando o nome aparece por completo; (2) todos os "tokens" do nome
// aparecem em qualquer ordem na pergunta — tolera hífen/espaço/acento
// (normalizeLooseText já trata isso) e pequenas reordenações.
// Limitação conhecida: nomes concatenados sem separador (“CPII” em vez
// de “CP-II”) ainda não casam — ficaria para uma iteração futura.
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
  // Prioriza as centrais da última análise (mais completo e já é o
  // universo que os relatórios usam); cai para as citadas em ocorrências
  // quando não há análise rodada, para não travar essa intenção específica.
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

// ── Intenção: materiais críticos/urgentes ───────────────────────────
function _asstIntentCriticidade(query) {
  if (!_asstHasAnalise() || !window._rankByLevel) return _asstNoAnaliseMsg();

  const central  = _asstResolveCentral(query);
  const regional = !central ? _asstResolveRegional(query) : null;

  let critico = window._rankByLevel.critico || [];
  let urgente = window._rankByLevel.urgente || [];
  if (central) {
    critico = critico.filter(i => i.central === central);
    urgente = urgente.filter(i => i.central === central);
  } else if (regional) {
    critico = critico.filter(i => i.regional === regional);
    urgente = urgente.filter(i => i.regional === regional);
  }

  const escopo = central ? ` em <b>${escapeHtml(central)}</b>`
               : regional ? ` na regional de <b>${escapeHtml(regional)}</b>` : '';

  if (!critico.length && !urgente.length) {
    return `Nenhum material crítico ou urgente${escopo} no período ${_asstPeriodoLabel()}. 👍`;
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
  return html;
}

// ── Intenção: ranking de centrais (pior/melhor) ─────────────────────
function _asstIntentRankingCentral(query, wantWorst) {
  if (!_asstHasAnalise() || typeof _macroState === 'undefined' || !_macroState?.centralMap) return _asstNoAnaliseMsg();

  const entries = Object.entries(_macroState.centralMap);
  if (!entries.length) return `Não há dados de centrais disponíveis para o período ${_asstPeriodoLabel()}.`;

  // Mesmo critério de desempate do ranking "Piores Centrais" já usado no
  // sistema: contagem bruta (críticos → urgentes → atenção) descendente,
  // com a maior variação absoluta como critério final de desempate.
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
  const central  = _asstResolveCentral(query);
  const abertas  = (state.ocorrencias || []).filter(o => !o.concluida && !o.inconclusiva);
  const filtradas = central ? abertas.filter(o => normalizeText(o.central) === normalizeText(central)) : abertas;

  const escopo = central ? ` em <b>${escapeHtml(central)}</b>` : '';
  if (!filtradas.length) return `Nenhuma ocorrência aberta${escopo}. 👍`;

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
  return html;
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

  const central  = _asstResolveCentral(query);
  const matAlias = _asstResolveMaterial(query);

  if (!central && !matAlias) return 'Não identifiquei a central nem o material na pergunta. Tente algo como: "saldo de CIMENTO CP-II na central Volta Redonda".';
  if (!central)  return `Identifiquei o material <b>${escapeHtml(matAlias)}</b>, mas não a central. Qual central você quer consultar?`;
  if (!matAlias) return `Identifiquei a central <b>${escapeHtml(central)}</b>, mas não o material. Qual material você quer consultar?`;

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
    return `Não encontrei movimentações de <b>${escapeHtml(matAlias)}</b> em <b>${escapeHtml(central)}</b> no período ${_asstPeriodoLabel()}.`;
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
  return html;
}

// ── Intenção: tendência/projeção (regressão linear sobre ~8 semanas) ─
function _asstIntentTendencia(query) {
  if (!_asstHasAnalise()) return _asstNoAnaliseMsg();

  const central  = _asstResolveCentral(query);
  const matAlias = _asstResolveMaterial(query);

  if (!central && !matAlias) return 'Para projetar uma tendência preciso da central e do material. Ex.: "tendência de CIMENTO CP-II na central Volta Redonda".';
  if (!central)  return `Identifiquei o material <b>${escapeHtml(matAlias)}</b>, mas não a central. Qual central?`;
  if (!matAlias) return `Identifiquei a central <b>${escapeHtml(central)}</b>, mas não o material. Qual material?`;

  if (typeof _tCompute !== 'function' || typeof _tForecast !== 'function') {
    return 'O módulo de tendência não está disponível nesta tela.';
  }

  const dtFim = window.__analiticoDtFim instanceof Date ? window.__analiticoDtFim : new Date(window.__analiticoDtFim);
  const dtIniHist = new Date(dtFim);
  dtIniHist.setDate(dtIniHist.getDate() - 56); // ~8 semanas de histórico para a regressão

  let weekData;
  try {
    weekData = _tCompute('central', central, dtIniHist, dtFim, new Set([matAlias]));
  } catch (err) {
    console.error('Assistente: erro ao computar tendência', err);
    return 'Não consegui calcular a tendência agora.';
  }

  const comHistorico = (weekData || []).filter(w => w.realKg > 0);
  if (comHistorico.length < 2) {
    return `Não há histórico semanal suficiente de <b>${escapeHtml(matAlias)}</b> em <b>${escapeHtml(central)}</b> para projetar uma tendência.`;
  }

  const forecast = _tForecast(weekData);
  if (forecast === null || !Number.isFinite(forecast)) {
    return `Não foi possível calcular uma projeção confiável para <b>${escapeHtml(matAlias)}</b> em <b>${escapeHtml(central)}</b>.`;
  }

  const ultimas = comHistorico.slice(-4);
  let html = `<b>Projeção — ${escapeHtml(matAlias)}</b> em <b>${escapeHtml(central)}</b>`;
  html += `<div class="asst-item">Últimas semanas: ${ultimas.map(w => `${w.shortLabel}: ${signedKg(w.variation)}`).join(' · ')}</div>`;
  html += `<div class="asst-item"><b>Projeção para a próxima semana: ${signedKg(forecast)}</b></div>`;
  html += `<div class="asst-more">Regressão linear simples sobre as últimas ${ultimas.length} semanas — use como indicativo, não substitui a análise do período.</div>`;
  return html;
}

// ── Intenção: centrais/materiais sem lançar (ausências) ─────────────
function _asstIntentAusencias(query) {
  if (!_asstHasAnalise()) return _asstNoAnaliseMsg();
  if (typeof _ausComputar !== 'function') return 'O módulo de ausências não está disponível nesta tela.';

  const central = _asstResolveCentral(query);

  let ausencias;
  try {
    ausencias = _ausComputar(window.__analiticoDtIni, window.__analiticoDtFim) || [];
  } catch (err) {
    console.error('Assistente: erro ao computar ausências', err);
    return 'Não consegui calcular as ausências de lançamento agora.';
  }

  const filtradas = central ? ausencias.filter(a => a.central === central) : ausencias;
  const escopo = central ? ` em <b>${escapeHtml(central)}</b>` : '';
  if (!filtradas.length) return `Nenhuma ausência de lançamento${escopo} no período ${_asstPeriodoLabel()}. 👍`;

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
  return html;
}

// ── Intenção: ações de relatório cadastradas para um material crítico ─
function _asstIntentAcoes(query) {
  if (!_asstHasAnalise() || !window._rankByLevel) return _asstNoAnaliseMsg();
  if (typeof _resolverAcoesParaMaterial !== 'function') return 'O módulo de ações de relatório não está disponível nesta tela.';

  const central  = _asstResolveCentral(query);
  const matAlias = _asstResolveMaterial(query);

  if (!central && !matAlias) return 'Para consultar as ações definidas, preciso da central e do material. Ex.: "ações para CIMENTO CP-II na central Volta Redonda".';
  if (!central)  return `Identifiquei o material <b>${escapeHtml(matAlias)}</b>, mas não a central. Qual central?`;
  if (!matAlias) return `Identifiquei a central <b>${escapeHtml(central)}</b>, mas não o material. Qual material?`;

  const todos = [
    ...(window._rankByLevel.critico || []),
    ...(window._rankByLevel.urgente || []),
    ...(window._rankByLevel.atencao || []),
  ];
  const item = todos.find(i => i.central === central && i.mat === matAlias);
  if (!item) return `<b>${escapeHtml(matAlias)}</b> em <b>${escapeHtml(central)}</b> não está em atenção, urgente ou crítico no período ${_asstPeriodoLabel()}.`;

  const acoes = _resolverAcoesParaMaterial(item.mat, item.diff, item.categoria, item.level, item.catKey, item.catSubKey);
  const lvlLabel = (typeof _levelLabel !== 'undefined' && _levelLabel[item.level]) || String(item.level).toUpperCase();

  let html = `<b>${escapeHtml(matAlias)}</b> em <b>${escapeHtml(central)}</b> — ${lvlLabel} (${signedKg(item.diff)})`;
  if (acoes) {
    html += `<div class="asst-section-title"><i class="ti ti-clipboard-check"></i> Ação definida</div><div class="asst-item">${escapeHtml(acoes)}</div>`;
  } else {
    html += `<div class="asst-item" style="color:var(--text2)">Nenhuma ação cadastrada para esse cenário em Configurações.</div>`;
  }
  return html;
}

// ── Ajuda / fallback ─────────────────────────────────────────────────
function _asstFallbackHelp() {
  return 'Não entendi a pergunta. Posso responder sobre:' +
    '<div class="asst-item">• Materiais críticos/urgentes — ex.: "quais materiais estão críticos?"</div>' +
    '<div class="asst-item">• Central pior/melhor no período — ex.: "qual central está pior?"</div>' +
    '<div class="asst-item">• Ocorrências abertas — ex.: "quantas ocorrências abertas na central X?"</div>' +
    '<div class="asst-item">• Resumo/saúde geral do período — ex.: "resumo geral"</div>' +
    '<div class="asst-item">• Saldo de um material numa central — ex.: "saldo de CIMENTO CP-II na central X"</div>' +
    '<div class="asst-item">• Tendência/projeção — ex.: "tendência de CIMENTO CP-II na central X"</div>' +
    '<div class="asst-item">• Centrais sem lançar — ex.: "quais centrais estão sem lançar?"</div>' +
    '<div class="asst-item">• Ações definidas para um material crítico — ex.: "ações para CIMENTO CP-II na central X"</div>';
}

// ── Roteador de intenção (regras por palavra-chave, sem LLM) ────────
function _asstProcessQuery(raw) {
  const q = normalizeText(raw);
  if (!q) return 'Digite uma pergunta — por exemplo: "quais materiais estão críticos?"';

  if (/OCORRENCIA/.test(q))                          return _asstIntentOcorrencias(raw);
  if (/AUSENCIA|SEM LANCAR|NAO LANCOU/.test(q))       return _asstIntentAusencias(raw);
  if (/\b(ACAO|ACOES)\b/.test(q))                     return _asstIntentAcoes(raw);
  if (/\bPIOR(ES)?\b/.test(q))                        return _asstIntentRankingCentral(raw, true);
  if (/\bMELHOR(ES)?\b/.test(q))                      return _asstIntentRankingCentral(raw, false);
  if (/TENDENCIA|PREVISAO|PROJECAO/.test(q))          return _asstIntentTendencia(raw);
  if (/\bSALDO\b|ESTOQUE DE|QUANTO TEM/.test(q))      return _asstIntentSaldoMaterial(raw);
  if (/CRITIC|URGENTE/.test(q))                       return _asstIntentCriticidade(raw);
  if (/SAUDE|RESUMO|VISAO GERAL|SITUACAO/.test(q))    return _asstIntentSaudeGlobal();

  return _asstFallbackHelp();
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
  if (!Array.isArray(saved) || !saved.length) return; // mantém a mensagem de boas-vindas estática do HTML

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

function asstSend() {
  const input = document.getElementById('asst-input');
  const text = (input?.value || '').trim();
  if (!text) return;

  _asstAppendMsg('user', escapeHtml(text));
  input.value = '';

  let resposta;
  try {
    resposta = _asstProcessQuery(text);
  } catch (err) {
    console.error('Assistente: erro ao processar pergunta', err);
    resposta = 'Ocorreu um erro ao processar essa pergunta. Tente reformular.';
  }
  _asstAppendMsg('bot', resposta);
}

function asstAskSuggestion(btn) {
  const input = document.getElementById('asst-input');
  if (input) input.value = btn.textContent.trim();
  asstSend();
}

function asstClearChat() {
  const body = document.getElementById('asst-chat-body');
  if (!body) return;
  body.innerHTML = '';
  _asstRenderMsg('bot', _ASST_WELCOME_HTML);
  try { localStorage.removeItem(ASST_HISTORY_KEY); } catch (err) {}
}
