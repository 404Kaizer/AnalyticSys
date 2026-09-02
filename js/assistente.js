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
const ASST_LOG_KEY     = 'analyticsys_asst_log_nao_reconhecidas_v1';

// Registro local (por navegador) de perguntas que caíram no "não
// reconheci" de algum roteador — não centraliza entre analistas
// diferentes (o sistema não tem backend), mas dá pra exportar e juntar
// manualmente. Guarda só as últimas 200 pra não crescer sem limite.
function _asstRegistrarNaoReconhecida(contexto, query) {
  try {
    const bruto = localStorage.getItem(ASST_LOG_KEY);
    const lista = bruto ? JSON.parse(bruto) : [];
    lista.push({ contexto, pergunta: query, data: new Date().toISOString() });
    localStorage.setItem(ASST_LOG_KEY, JSON.stringify(lista.slice(-200)));
  } catch (err) {
    console.error('Assistente: erro ao registrar pergunta não reconhecida', err);
  }
}

function _asstExportarLogNaoReconhecidas() {
  try {
    const bruto = localStorage.getItem(ASST_LOG_KEY);
    const lista = bruto ? JSON.parse(bruto) : [];
    const blob = new Blob([JSON.stringify(lista, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'assistente-perguntas-nao-reconhecidas.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch (err) {
    console.error('Assistente: erro ao exportar log', err);
  }
}

function _asstIntentLogNaoReconhecidas() {
  let lista = [];
  try {
    const bruto = localStorage.getItem(ASST_LOG_KEY);
    lista = bruto ? JSON.parse(bruto) : [];
  } catch (err) { /* ignora, trata como vazio */ }

  if (!lista.length) return 'Nenhuma pergunta não reconhecida registrada neste navegador ainda — bom sinal, ou ninguém esbarrou num limite ainda.';

  const recentes = lista.slice(-10).reverse();
  let html = `<b>${lista.length}</b> pergunta(s) não reconhecida(s) registrada(s) neste navegador (10 mais recentes abaixo):`;
  html += recentes.map(item => {
    const it = _asstIntentById(item.contexto);
    const nomeContexto = it ? it.label : item.contexto;
    const data = new Date(item.data);
    return `<div class="asst-item">${data.toLocaleDateString('pt-BR')} · <b>${escapeHtml(nomeContexto)}</b> — "${escapeHtml(item.pergunta)}"</div>`;
  }).join('');
  html += `<button class="asst-mf-btn" onclick="_asstExportarLogNaoReconhecidas()">Baixar log completo (.json)</button>`;
  html += `<div class="asst-item" style="margin-top:6px;color:var(--text3);font-size:11px;">Esse registro fica só neste navegador. Pra juntar com o que os outros analistas perguntaram, exporte e junte os arquivos manualmente.</div>`;
  return html;
}

// Contexto de conversa — não persiste entre recarregamentos de página
// (é memória de curto prazo da sessão atual, não histórico salvo).
let _asstContext = { central: null, material: null, regional: null };

// Mantém sincronizado com a mensagem inicial estática em index.html
// (#asst-chat-body), já que "limpar" e "sem histórico salvo" devem
// devolver o mesmo estado de boas-vindas.
const _ASST_WELCOME_HTML = `
  Oi! Sou seu analista auxiliar de estoque. Digite <code>/</code> e escolha um contexto pra começar.
  <div class="asst-suggestions">
    <button class="asst-chip" onclick="asstQuickStart('ocorrencias')">Ocorrências abertas</button>
    <button class="asst-chip" onclick="asstQuickStart('dashboard-analitico')">Dashboard Analítico</button>
    <button class="asst-chip" onclick="asstQuickStart('entradas-consulta')">Entradas</button>
    <button class="asst-chip" onclick="_asstMostrarAjuda()"><i class="ti ti-help-circle"></i> Ajuda</button>
  </div>`;

// Conteúdo completo (o que a mensagem de boas-vindas tinha antes de ser
// encurtada), agora só sob demanda via botão — junto com o que
// realmente não funciona, pra não dar a entender que tudo funciona.
function _asstAjudaHtml() {
  return `
    <div class="asst-section-title"><i class="ti ti-route"></i> Como funciona</div>
    <div class="asst-item">Digite <code>/</code> e escolha um contexto — ele representa uma parte do sistema (Dashboard Analítico, Entradas, Ocorrências...) e fica travado até você trocar (digite <code>/</code> de novo) ou remover (✕ na etiqueta acima do campo).</div>
    <div class="asst-item">Dentro do contexto, pergunte com suas próprias palavras — não precisa escolher entre perguntas prontas.</div>
    <div class="asst-item">Singular pede 1 resultado ("pior fornecedor"), plural pede vários ("piores fornecedores"). "Top 3" ou "os 5 piores" sempre define a quantidade exata, não importa singular/plural.</div>

    <div class="asst-section-title"><i class="ti ti-list-details"></i> Contextos disponíveis</div>
    <div class="asst-item"><b>Dashboard Analítico</b> — crítico/urgente, ranking de central ou material, saldo e tendência de um material, ausências, resumo geral. Precisa de análise rodada (peço o período aqui mesmo se faltar).</div>
    <div class="asst-item"><b>Entradas, Saídas, Lançamentos, SAP, Custos SAP</b> — contagem, total e ranking (por central, material, fornecedor ou movimento) de cada tabela.</div>
    <div class="asst-item"><b>Fluxo</b> — combina as tabelas que você citar na pergunta (ex.: "considerando SAP"); sem citar nenhuma, usa entradas + saídas.</div>
    <div class="asst-item"><b>Ocorrências</b> — abertas por padrão, ou análise por regional/motivo/central/tempo de retorno.</div>
    <div class="asst-item"><b>Configurações</b> — pendências de padronização, ou ações propostas pra um material crítico.</div>
    <div class="asst-item"><b>Registrar entrada/saída/lançamento/SAP/produção</b> — a única ação que de fato executo: formulário → confirmação explícita → gravação.</div>

    <div class="asst-section-title"><i class="ti ti-calendar"></i> Período aceito</div>
    <div class="asst-item">Datas explícitas ("01/06/2026 a 23/06/2026"), nomes de mês ("maio a julho"), e relativos: hoje, ontem, amanhã, semana passada/que vem, mês passado/que vem, "N dias/semanas/meses/anos atrás".</div>

    <div class="asst-section-title" style="color:var(--red)"><i class="ti ti-alert-triangle"></i> O que ainda não funciona</div>
    <div class="asst-item">Frequência ou hábito — "sempre", "nunca", "às vezes" não são período; exigiriam analisar consistência no histórico inteiro, e isso não existe ainda.</div>
    <div class="asst-item">Pergunta aberta, comparativa ou causal — "por que a central X piorou", "resuma os riscos do trimestre". O assistente segue regras, não interpreta linguagem livre desse jeito.</div>
    <div class="asst-item">Nenhuma ação além de registrar dado — não importa arquivo, não faz backup, não altera configuração.</div>
  `;
}

function _asstMostrarAjuda() {
  _asstAppendMsg('bot', _asstAjudaHtml());
}

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
  const limite = _asstDetectarLimite(normalizeText(query), _ASST_SING_MATERIAL, 8);

  if (critico.length) {
    html += `<div class="asst-section-title" style="color:var(--red)"><i class="ti ti-flame"></i> Críticos</div>`;
    html += critico.slice(0, limite).map(i => `<div class="asst-item">${item(i)}</div>`).join('');
    if (critico.length > limite) html += `<div class="asst-more">+ ${critico.length - limite} outro(s)</div>`;
  }
  if (urgente.length) {
    html += `<div class="asst-section-title" style="color:var(--amber)"><i class="ti ti-alert-circle"></i> Urgentes</div>`;
    html += urgente.slice(0, limite).map(i => `<div class="asst-item">${item(i)}</div>`).join('');
    if (urgente.length > limite) html += `<div class="asst-more">+ ${urgente.length - limite} outro(s)</div>`;
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

  const limite = _asstDetectarLimite(normalizeText(query), _ASST_SING_CENTRAL, 5);
  const list  = wantWorst ? sorted.slice(0, limite) : sorted.slice().reverse().slice(0, limite);
  const title = wantWorst ? (limite === 1 ? 'Pior central' : 'Piores centrais') : (limite === 1 ? 'Melhor central' : 'Melhores centrais');

  let html = `<b>${title} — período ${_asstPeriodoLabel()}</b>`;
  html += list.map(([central, v], idx) => {
    const lvlLabel = (typeof _levelLabel !== 'undefined' && _levelLabel[v.level]) || String(v.level || '—').toUpperCase();
    return `<div class="asst-item">${idx + 1}. <b>${escapeHtml(central)}</b> — ${v.counts.critico} crítico(s), ${v.counts.urgente} urgente(s), ${v.counts.atencao} atenção · saúde ${lvlLabel}</div>`;
  }).join('');
  return html;
}

// ── Intenção: ranking de materiais (pior/melhor) ─────────────────────
// Faltava por completo — o roteador do Dashboard Analítico mandava
// "pior"/"melhor" sempre pro ranking de central, mesmo quando a
// pergunta pedia material. Usa _macroState.matItems (já calculado por
// central+material, com custo de impacto), sem recalcular nada.
function _asstIntentRankingMaterial(query, wantWorst) {
  if (!_asstHasAnalise() || typeof _macroState === 'undefined' || !_macroState?.matItems) return _asstNoAnaliseMsg();

  const centralRes = _asstResolveCentralCtx(query);
  let items = _macroState.matItems;
  let escopo = '', nota = '';
  if (centralRes.value) {
    items = items.filter(i => i.central === centralRes.value);
    escopo = ` em <b>${escapeHtml(centralRes.value)}</b>`;
    if (centralRes.fromContext) nota = _asstContextNote('central', centralRes.value);
  }

  if (!items.length) return nota + `Não há dados de materiais disponíveis${escopo} para o período ${_asstPeriodoLabel()}.`;

  const ordemLevel = { critico: 3, urgente: 2, atencao: 1, bom: 0 };
  const sorted = items.slice().sort((a, b) => {
    const ord = (ordemLevel[b.level] ?? 0) - (ordemLevel[a.level] ?? 0);
    return ord !== 0 ? ord : (b.custo || 0) - (a.custo || 0);
  });

  const limite = _asstDetectarLimite(normalizeText(query), _ASST_SING_MATERIAL, 5);
  const list  = wantWorst ? sorted.slice(0, limite) : sorted.slice().reverse().slice(0, limite);
  const title = wantWorst ? (limite === 1 ? 'Pior material' : 'Piores materiais') : (limite === 1 ? 'Melhor material' : 'Melhores materiais');

  let html = `<b>${title}${escopo} — período ${_asstPeriodoLabel()}</b>`;
  html += list.map((i, idx) => {
    const lvlLabel = (typeof _levelLabel !== 'undefined' && _levelLabel[i.level]) || String(i.level || '—').toUpperCase();
    return `<div class="asst-item">${idx + 1}. <b>${escapeHtml(i.mat)}</b> — ${escapeHtml(i.central)} (${signedKg(i.totalDiff)}) · saúde ${lvlLabel}</div>`;
  }).join('');
  return nota + html;
}


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

  const ordemStatus = { vencida: 0, urgente: 1 };
  const ordenadas = filtradas.slice().sort((a, b) => {
    const oa = ordemStatus[ocDateStatus(a.dataLimite)] ?? 2;
    const ob = ordemStatus[ocDateStatus(b.dataLimite)] ?? 2;
    if (oa !== ob) return oa - ob;
    const da = parseDate(a.dataLimite), db = parseDate(b.dataLimite);
    return (da && db) ? da - db : 0;
  });
  const limite = _asstDetectarLimite(normalizeText(query), _ASST_SING_OCORRENCIA, 8);

  html += ordenadas.slice(0, limite).map(o => {
    const st = ocDateStatus(o.dataLimite);
    const badge = st === 'vencida' ? '🔴' : st === 'urgente' ? '🟠' : '⚪';
    const assunto = (o.descricao || o.motivo || '').trim();
    const assuntoCurto = assunto.length > 60 ? assunto.slice(0, 60) + '…' : assunto;
    return `<div class="asst-item">${badge} <b>${escapeHtml(o.central || '—')}</b>${o.material ? ' · ' + escapeHtml(o.material) : ''} — prazo ${o.dataLimite ? fmtDateBR(o.dataLimite) : '—'}${assuntoCurto ? '<br><span style="color:var(--text2)">' + escapeHtml(assuntoCurto) + '</span>' : ''}</div>`;
  }).join('');
  if (ordenadas.length > limite) html += `<div class="asst-more">+ ${ordenadas.length - limite} outra(s)</div>`;
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
  // Ajustes de Fechamento Mensal (Y11/Y12) desconsiderados — mesmo critério
  // usado em todo o sistema (ver isSapExcluidoPorFechamento, ui.js).
  const sapAll   = getSapByCentralInPeriod(central, dtIni, dtFim)
    .filter(s => s.material === matAlias)
    .filter(s => !isSapExcluidoPorFechamento(s));

  const rawCat = (lancsAll[0]?.categoria || sapAll[0]?.categoria || '').trim().toUpperCase();
  const catKey = detectCatKey(rawCat) || detectCatFromMat(matAlias);
  // Est. Inicial: saldo TEÓRICO do SAP (âncora de Custos SAP + movimentações),
  // mesma fonte da Visão Micro / Inventário / Dashboard — senão o Assistente
  // responderia um Est. Inicial e uma Variação diferentes dos das telas.
  const prev   = (typeof _anGetSapStock === 'function')
    ? _anGetSapStock({ central, material: matAlias, dtIni })
    : getPrePeriodLaunchStock({ central, material: matAlias, dtIni, dtFim, catKey });
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
  // Rateio por NATUREZA (ENTRADAS/SAÍDAS/AJUSTES), igual à Visão Micro — o
  // buildSnapshot acima separa por sinal e não conhece o balde AJUSTES, e
  // sem ele um estorno ou uma transferência apareceria como "Saída" aqui.
  const _natA = repartirSapPorNatureza(sapAll);
  html += `<div class="asst-item">Entradas: ${fmtKgSigned(_natA.totalEnt)} &nbsp; Saídas: ${fmtKgSigned(_natA.totalSai)} &nbsp; Ajustes: ${fmtKgSigned(_natA.totalAju)}</div>`;
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
  const limite = _asstDetectarLimite(normalizeText(query), _ASST_SING_CENTRAL, 8);
  html += ranking.slice(0, limite).map(([c, g]) =>
    `<div class="asst-item"><b>${escapeHtml(c)}</b> — ${g.materiais.size} material(is), ${g.dias} dia(s) ausente(s) no total</div>`
  ).join('');
  if (ranking.length > limite) html += `<div class="asst-more">+ ${ranking.length - limite} outra(s) central(is)</div>`;
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
// Reaproveita getPendenciasPadronizacao() (normalize.js) — mesma fonte
// usada pelo indicador visual em Configurações — para não ter duas lógicas
// de "o que conta como pendente" divergindo com o tempo. Consulta pura,
// nunca muta o state.
function _asstIntentConfigPendente(query) {
  if (typeof getPendenciasPadronizacao !== 'function') {
    return 'Não consegui verificar pendências de cadastro agora.';
  }

  const { materiais, centrais } = getPendenciasPadronizacao();

  if (!materiais.length && !centrais.length) {
    return 'Nenhum material ou central pendente de padronização. 👍';
  }

  let html = `<b>Pendências de cadastro</b> (Configurações → Padronização)`;
  const qNorm = normalizeText(query || '');

  if (materiais.length) {
    const limite = _asstDetectarLimite(qNorm, _ASST_SING_MATERIAL, 8);
    html += `<div class="asst-section-title" style="color:var(--amber)"><i class="ti ti-alert-triangle"></i> Materiais pendentes (${materiais.length})</div>`;
    html += materiais.slice(0, limite).map(item => {
      const motivoTxt = item.motivo === 'sem_categoria'
        ? `sem categoria (já padronizado como "${escapeHtml(item.aliasPadronizado)}")`
        : 'não cadastrado';
      return `<div class="asst-item">${escapeHtml(item.nome)} — ${motivoTxt} — ${item.count} registro(s)</div>`;
    }).join('');
    if (materiais.length > limite) html += `<div class="asst-more">+ ${materiais.length - limite} outro(s)</div>`;
  }
  if (centrais.length) {
    const limite = _asstDetectarLimite(qNorm, _ASST_SING_CENTRAL, 8);
    html += `<div class="asst-section-title" style="color:var(--amber)"><i class="ti ti-alert-triangle"></i> Centrais não padronizadas (${centrais.length})</div>`;
    html += centrais.slice(0, limite).map(item => `<div class="asst-item">${escapeHtml(item.nome)} — ${item.count} registro(s)</div>`).join('');
    if (centrais.length > limite) html += `<div class="asst-more">+ ${centrais.length - limite} outro(s)</div>`;
  }
  return html;
}

// ═══════════════════════════════════════════════════════════
// MOTOR GENÉRICO DE CONSULTA — catálogo de módulos + parser de
// pergunta composta (agrupar por X, ordenar por Y, top N, no período
// W) em vez de uma função hardcoded por pergunta/tabela. Um módulo
// novo só declara onde estão os dados; não escreve lógica de consulta
// nova. Continua sendo regras (não LLM) — previsível e auditável.
// ═══════════════════════════════════════════════════════════

const _ASST_MESES = ['JANEIRO','FEVEREIRO','MARCO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];

function _asstUltimoDiaMes(ano, mesIdx) {
  return new Date(ano, mesIdx + 1, 0).getDate();
}

// Reconhece datas explícitas ("de 01/06/2026 até 23/06/2026") e nomes
// de mês ("maio a julho", "em junho"). Sem ano citado, assume o ano
// corrente — mas isso é sempre reportado na resposta (assumiuAno),
// nunca fica silencioso. Sem nada reconhecível, retorna null (quem
// chama decide se avisa que não entendeu o período).
function _asstHoje() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function _asstFimDoDia(d) {
  const f = new Date(d);
  f.setHours(23, 59, 59, 999);
  return f;
}

function _asstSegundaDaSemana(data) {
  const d = new Date(data);
  const diaSemana = d.getDay(); // 0 = domingo
  d.setDate(d.getDate() + (diaSemana === 0 ? -6 : 1 - diaSemana));
  return d;
}

function _asstRangeSemana(segunda) {
  const dom = new Date(segunda);
  dom.setDate(dom.getDate() + 6);
  return { dtIni: segunda, dtFim: _asstFimDoDia(dom) };
}

function _asstRangeMes(ano, mesIdx) {
  return { dtIni: new Date(ano, mesIdx, 1), dtFim: new Date(ano, mesIdx + 1, 0, 23, 59, 59) };
}

// Datas relativas a hoje ("ontem", "semana passada", "3 meses atrás"...).
// Tudo calculado a partir da data real do navegador em tempo de
// execução — nunca uma data fixa. Retorna null se nada bater, pra
// quem chama tentar o parser de nomes de mês em seguida.
function _asstParsePeriodoRelativo(qLoose) {
  const hoje = _asstHoje();

  const mAtras = qLoose.match(/\b(\d{1,3})\s*(DIAS?|SEMANAS?|MESES?|ANOS?)\s*ATRAS\b/);
  if (mAtras) {
    const n = Number(mAtras[1]);
    const unidade = mAtras[2];
    if (unidade.startsWith('DIA')) {
      const d = new Date(hoje); d.setDate(d.getDate() - n);
      return { dtIni: d, dtFim: _asstFimDoDia(d), assumiuAno: false };
    }
    if (unidade.startsWith('SEMANA')) {
      const seg = _asstSegundaDaSemana(hoje); seg.setDate(seg.getDate() - n * 7);
      return { ..._asstRangeSemana(seg), assumiuAno: false };
    }
    if (unidade.startsWith('MES')) {
      const base = new Date(hoje.getFullYear(), hoje.getMonth() - n, 1);
      return { ..._asstRangeMes(base.getFullYear(), base.getMonth()), assumiuAno: false };
    }
    if (unidade.startsWith('ANO')) {
      const ano = hoje.getFullYear() - n;
      return { dtIni: new Date(ano, 0, 1), dtFim: new Date(ano, 11, 31, 23, 59, 59), assumiuAno: false };
    }
  }

  if (/\bHOJE\b/.test(qLoose)) return { dtIni: hoje, dtFim: _asstFimDoDia(hoje), assumiuAno: false };
  if (/\bONTEM\b/.test(qLoose)) {
    const d = new Date(hoje); d.setDate(d.getDate() - 1);
    return { dtIni: d, dtFim: _asstFimDoDia(d), assumiuAno: false };
  }
  if (/\bAMANHA\b/.test(qLoose)) {
    const d = new Date(hoje); d.setDate(d.getDate() + 1);
    return { dtIni: d, dtFim: _asstFimDoDia(d), assumiuAno: false };
  }

  if (/SEMANA PASSADA|SEMANA ANTERIOR/.test(qLoose)) {
    const seg = _asstSegundaDaSemana(hoje); seg.setDate(seg.getDate() - 7);
    return { ..._asstRangeSemana(seg), assumiuAno: false };
  }
  if (/SEMANA QUE VEM|PROXIMA SEMANA|PROX SEMANA/.test(qLoose)) {
    const seg = _asstSegundaDaSemana(hoje); seg.setDate(seg.getDate() + 7);
    return { ..._asstRangeSemana(seg), assumiuAno: false };
  }
  if (/\b(ESSA|ESTA)\s+SEMANA\b/.test(qLoose)) {
    return { ..._asstRangeSemana(_asstSegundaDaSemana(hoje)), assumiuAno: false };
  }

  if (/MES PASSADO|MES ANTERIOR/.test(qLoose)) {
    const base = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    return { ..._asstRangeMes(base.getFullYear(), base.getMonth()), assumiuAno: false };
  }
  if (/MES QUE VEM|PROXIMO MES|PROX MES/.test(qLoose)) {
    const base = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);
    return { ..._asstRangeMes(base.getFullYear(), base.getMonth()), assumiuAno: false };
  }
  if (/\b(ESSE|ESTE)\s+MES\b/.test(qLoose)) {
    return { ..._asstRangeMes(hoje.getFullYear(), hoje.getMonth()), assumiuAno: false };
  }

  return null;
}

function _asstParsePeriodo(query) {
  const datas = query.match(/\d{2}\/\d{2}\/\d{4}/g);
  if (datas && datas.length) {
    const dtIni = parseDate(datas[0]);
    const dtFimBase = parseDate(datas[datas.length > 1 ? 1 : 0]);
    if (dtIni && dtFimBase) {
      const dtFim = new Date(dtFimBase.getFullYear(), dtFimBase.getMonth(), dtFimBase.getDate(), 23, 59, 59);
      return { dtIni, dtFim, assumiuAno: false };
    }
  }

  const qLoose = normalizeLooseText(query);

  const relativo = _asstParsePeriodoRelativo(qLoose);
  if (relativo) return relativo;

  const anoMatch = qLoose.match(/\b(20\d{2})\b/);
  const ano = anoMatch ? Number(anoMatch[1]) : new Date().getFullYear();

  const mesesEncontrados = [];
  _ASST_MESES.forEach((nome, idx) => {
    if (new RegExp('\\b' + nome + '\\b').test(qLoose)) mesesEncontrados.push(idx);
  });
  if (!mesesEncontrados.length) return null;

  const mIni = mesesEncontrados[0];
  const mFim = mesesEncontrados[mesesEncontrados.length - 1];
  return {
    dtIni: new Date(ano, mIni, 1),
    dtFim: new Date(ano, mFim, _asstUltimoDiaMes(ano, mFim), 23, 59, 59),
    assumiuAno: !anoMatch,
  };
}

// "fornecedor"/"movimento" sozinhos já pedem ranking (não há outro uso
// pra essas palavras aqui); "central"/"material" só viram ranking
// combinados com linguagem de "mais/maior/top" — porque também servem
// de filtro solto ("entradas da central X").
function _asstDetectarDimensao(qNorm, dimensoes) {
  const querRanking = /\b(MAIS|MAIOR|MAIORES|MENOS|MENOR|MENORES|TOP|RANKING|MELHOR|MELHORES|PIOR|PIORES)\b/.test(qNorm);
  for (const nome of Object.keys(dimensoes)) {
    const cfg = dimensoes[nome];
    if (cfg.padrao.test(qNorm) && (!cfg.ambiguo || querRanking)) return nome;
  }
  return null;
}

function _asstDetectarMetrica(qNorm, metricas) {
  for (const [nome, cfg] of Object.entries(metricas)) {
    if (cfg.gatilho && cfg.gatilho.test(qNorm)) return nome;
  }
  return Object.keys(metricas).find(k => metricas[k].default) || Object.keys(metricas)[0];
}

// Número explícito ("top 3", "os 5 piores") sempre vence. Sem número
// explícito, o singular da dimensão ("fornecedor", "central") indica
// que o analista quer só 1 resultado — plural ("fornecedores",
// "centrais") mantém o padrão de vários.
function _asstDetectarLimite(qNorm, singularPad, padrao = 8) {
  const m = qNorm.match(/\bTOP\s*(\d{1,2})\b/) || qNorm.match(/\b(\d{1,2})\s*(MAIORES|MELHORES|PIORES|PRIMEIROS)\b/);
  if (m) { const n = Number(m[1]); if (n > 0 && n <= 50) return n; }
  if (singularPad && singularPad.test(qNorm)) return 1;
  return padrao;
}

function _asstAgregarGrupo(registros, getDim, metricaCfg) {
  const grupos = new Map();
  registros.forEach(r => {
    const chave = String(getDim(r) || '').trim() || '—';
    if (!grupos.has(chave)) grupos.set(chave, { soma: 0, conta: 0 });
    const g = grupos.get(chave);
    const v = Number(metricaCfg.get(r));
    if (!Number.isNaN(v)) { g.soma += v; g.conta += 1; }
  });
  return [...grupos.entries()]
    .map(([chave, g]) => {
      const valor = metricaCfg.agg === 'conta' ? g.conta : (metricaCfg.agg === 'media' ? (g.conta ? g.soma / g.conta : 0) : g.soma);
      return [chave, valor, g.conta];
    })
    .sort((a, b) => b[1] - a[1]);
}

function _asstFmtMoeda(v) {
  return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ── Catálogo de módulos ──────────────────────────────────────────────
// Entradas é a única tabela sem campo "central" direto (usa
// centralCompra/centralDestino) — por isso central é sempre um
// acessor (get), nunca um nome de campo fixo assumido.
//
// Padrões de dimensão tratam singular e plural explicitamente — usar
// só a palavra no singular (ex.: fornecedor\b) falha pra "fornecedorES"
// e sobretudo pra plurais irregulares em -al→-ais (central→centrais,
// material→materiais), que é como analista costuma perguntar de verdade.
const _ASST_PAD_CENTRAL    = /\bCENTRA(L|IS)\b/;
const _ASST_PAD_MATERIAL   = /\bMATERIA(L|IS)\b/;
const _ASST_PAD_FORNECEDOR = /\bFORNECEDOR(ES)?\b/;
const _ASST_PAD_MOVIMENTO  = /\bMOVIMENTO(S)?\b/;

// Versões só-singular (\bCENTRAL\b nunca casa "CENTRAIS", confirmado
// por teste) — usadas pra saber se o analista pediu UM resultado
// ("pior fornecedor") ou VÁRIOS ("piores fornecedores"), já que hoje
// o motor sempre devolvia uma lista, ignorando o singular da pergunta.
const _ASST_SING_CENTRAL    = /\bCENTRAL\b/;
const _ASST_SING_MATERIAL   = /\bMATERIAL\b/;
const _ASST_SING_FORNECEDOR = /\bFORNECEDOR\b/;
const _ASST_SING_MOVIMENTO  = /\bMOVIMENTO\b/;
const _ASST_SING_REGIONAL   = /\bREGIONAL\b/;
const _ASST_SING_MOTIVO     = /\bMOTIVO\b/;
const _ASST_SING_OCORRENCIA = /\bOCORRENCIA\b/;
const _ASST_SING_REGISTRO   = /\bREGISTRO\b/;

const _ASST_MODULOS = {
  entradas: {
    registros: () => state.entradas || [],
    data: r => parseDate(r.dtEmissao),
    dimensoes: {
      central:    { get: r => r.centralDestino || r.centralCompra || '—', ambiguo: true,  padrao: _ASST_PAD_CENTRAL, singular: _ASST_SING_CENTRAL },
      material:   { get: r => r.material || '—', ambiguo: true,  padrao: _ASST_PAD_MATERIAL, singular: _ASST_SING_MATERIAL },
      fornecedor: { get: r => r.fornecedor || '—', ambiguo: false, padrao: _ASST_PAD_FORNECEDOR, singular: _ASST_SING_FORNECEDOR },
    },
    metricas: {
      peso:  { agg: 'soma',  get: r => Number(r.peso) || 0,       fmt: v => fmtKg(v),        gatilho: /\bPESO\b|\bKG\b/, default: true },
      valor: { agg: 'soma',  get: r => Number(r.valorTotal) || 0, fmt: v => _asstFmtMoeda(v), gatilho: /CUSTO|VALOR/ },
      qtd:   { agg: 'conta', get: () => 1,                        fmt: v => v.toLocaleString('pt-BR'), gatilho: /QUANTIDADE|INCIDENCIA|\bREGISTROS?\b/ },
    },
    singular: 'entrada', plural: 'entradas',
  },
  saidas: {
    registros: () => state.saidas || [],
    data: r => parseDate(r.dtEmissao),
    dimensoes: {
      central:    { get: r => r.central || '—', ambiguo: true,  padrao: _ASST_PAD_CENTRAL, singular: _ASST_SING_CENTRAL },
      material:   { get: r => r.material || '—', ambiguo: true,  padrao: _ASST_PAD_MATERIAL, singular: _ASST_SING_MATERIAL },
      fornecedor: { get: r => r.fornecedor || '—', ambiguo: false, padrao: _ASST_PAD_FORNECEDOR, singular: _ASST_SING_FORNECEDOR },
    },
    metricas: {
      peso:  { agg: 'soma',  get: r => Number(r.peso) || 0,       fmt: v => fmtKg(v),        gatilho: /\bPESO\b|\bKG\b/, default: true },
      valor: { agg: 'soma',  get: r => Number(r.valorTotal) || 0, fmt: v => _asstFmtMoeda(v), gatilho: /CUSTO|VALOR/ },
      qtd:   { agg: 'conta', get: () => 1,                        fmt: v => v.toLocaleString('pt-BR'), gatilho: /QUANTIDADE|INCIDENCIA|\bREGISTROS?\b/ },
    },
    singular: 'saída', plural: 'saídas',
  },
  lancamentos: {
    registros: () => state.lancamentos || [],
    data: r => parseDate(r.dtLanc),
    dimensoes: {
      central:    { get: r => r.central || '—', ambiguo: true,  padrao: _ASST_PAD_CENTRAL, singular: _ASST_SING_CENTRAL },
      material:   { get: r => r.material || '—', ambiguo: true,  padrao: _ASST_PAD_MATERIAL, singular: _ASST_SING_MATERIAL },
      fornecedor: { get: r => r.fornecedor || '—', ambiguo: false, padrao: _ASST_PAD_FORNECEDOR, singular: _ASST_SING_FORNECEDOR },
    },
    metricas: {
      peso:  { agg: 'soma',  get: r => Number(r.peso) || 0,       fmt: v => fmtKg(v),        gatilho: /\bPESO\b|\bKG\b/, default: true },
      valor: { agg: 'soma',  get: r => Number(r.valorTotal) || 0, fmt: v => _asstFmtMoeda(v), gatilho: /CUSTO|VALOR/ },
      qtd:   { agg: 'conta', get: () => 1,                        fmt: v => v.toLocaleString('pt-BR'), gatilho: /QUANTIDADE|INCIDENCIA|\bREGISTROS?\b/ },
    },
    singular: 'lançamento', plural: 'lançamentos',
  },
  sap: {
    registros: () => state.sap || [],
    data: r => parseDate(r.dtLanc),
    dimensoes: {
      central:   { get: r => r.central || '—', ambiguo: true,  padrao: _ASST_PAD_CENTRAL, singular: _ASST_SING_CENTRAL },
      material:  { get: r => r.material || '—', ambiguo: true,  padrao: _ASST_PAD_MATERIAL, singular: _ASST_SING_MATERIAL },
      movimento: { get: r => r.movimento || '—', ambiguo: false, padrao: _ASST_PAD_MOVIMENTO, singular: _ASST_SING_MOVIMENTO },
    },
    metricas: {
      peso:  { agg: 'soma',  get: r => Number(r.peso) || 0,       fmt: v => fmtKg(v),        gatilho: /\bPESO\b|\bKG\b/, default: true },
      valor: { agg: 'soma',  get: r => Number(r.valorTotal) || 0, fmt: v => _asstFmtMoeda(v), gatilho: /CUSTO|VALOR/ },
      qtd:   { agg: 'conta', get: () => 1,                        fmt: v => v.toLocaleString('pt-BR'), gatilho: /QUANTIDADE|INCIDENCIA|\bREGISTROS?\b/ },
    },
    singular: 'movimentação SAP', plural: 'movimentações SAP',
  },
  custosSap: {
    registros: () => state.custosSap || [],
    data: r => { const y = Number(r.ano), m = Number(r.mes); return y && m ? new Date(y, m - 1, 1) : null; },
    dimensoes: {
      central:  { get: r => r.central || '—', ambiguo: true, padrao: _ASST_PAD_CENTRAL, singular: _ASST_SING_CENTRAL },
      material: { get: r => r.material || '—', ambiguo: true, padrao: _ASST_PAD_MATERIAL, singular: _ASST_SING_MATERIAL },
    },
    metricas: {
      estoque: { agg: 'soma',  get: r => Number(r.estoqueTotal) || 0, fmt: v => v.toLocaleString('pt-BR'), gatilho: /ESTOQUE/, default: true },
      valor:   { agg: 'soma',  get: r => Number(r.valorTotal) || 0,   fmt: v => _asstFmtMoeda(v), gatilho: /VALOR|CUSTO/ },
      qtd:     { agg: 'conta', get: () => 1,                          fmt: v => v.toLocaleString('pt-BR'), gatilho: /QUANTIDADE|\bREGISTROS?\b/ },
    },
    singular: 'registro de Custos SAP', plural: 'registros de Custos SAP',
  },
  // Composto: une Entradas + Saídas numa única visão de "fluxo" por
  // central/material — pergunta que nenhuma tabela isolada responde.
  fluxo: {
    registros: query => _asstFluxoRegistros(query),
    notaFontes: query => _asstFluxoDescricao(query),
    data: r => parseDate(r.dtEmissao),
    dimensoes: {
      central:  { get: r => r.central || '—', ambiguo: true, padrao: _ASST_PAD_CENTRAL, singular: _ASST_SING_CENTRAL },
      material: { get: r => r.material || '—', ambiguo: true, padrao: _ASST_PAD_MATERIAL, singular: _ASST_SING_MATERIAL },
    },
    metricas: {
      peso:  { agg: 'soma',  get: r => Number(r.peso) || 0,       fmt: v => fmtKg(v),        gatilho: /\bPESO\b|\bKG\b|FLUXO/, default: true },
      valor: { agg: 'soma',  get: r => Number(r.valorTotal) || 0, fmt: v => _asstFmtMoeda(v), gatilho: /CUSTO|VALOR/ },
      qtd:   { agg: 'conta', get: () => 1,                        fmt: v => v.toLocaleString('pt-BR'), gatilho: /QUANTIDADE|INCIDENCIA|\bREGISTROS?\b/ },
    },
    singular: 'movimentação de fluxo', plural: 'movimentações de fluxo',
  },
};

const _ASST_DIM_LABEL     = { central: 'Centrais', material: 'Materiais', fornecedor: 'Fornecedores', movimento: 'Movimentos' };
const _ASST_DIM_LABEL_SING = { central: 'Central', material: 'Material', fornecedor: 'Fornecedor', movimento: 'Movimento' };
const _ASST_METRICA_LABEL = { peso: 'peso', valor: 'valor', qtd: 'quantidade', estoque: 'estoque' };

// Motor único: qualquer módulo do catálogo passa por aqui. Extrai
// dimensão (agrupar por), métrica (ordenar por), limite (top N) e
// período do texto livre, de forma independente uma da outra — dá pra
// combinar todas ao mesmo tempo, ou usar só as que a pergunta citou.
function _asstExecutarConsulta(modKey, query) {
  const mod = _ASST_MODULOS[modKey];
  const qNorm = normalizeText(query);

  const dim     = _asstDetectarDimensao(qNorm, mod.dimensoes);
  const metrica = _asstDetectarMetrica(qNorm, mod.metricas);
  const limite  = _asstDetectarLimite(qNorm, dim ? mod.dimensoes[dim].singular : null);
  const periodo = _asstParsePeriodo(query);

  let regs = mod.registros(query);
  let nota = mod.notaFontes ? mod.notaFontes(query) : '';

  if (periodo) {
    regs = regs.filter(r => { const d = mod.data(r); return d && d >= periodo.dtIni && d <= periodo.dtFim; });
    nota += `<div class="asst-context-note"><i class="ti ti-calendar"></i> período ${fmtPtDate(periodo.dtIni)} a ${fmtPtDate(periodo.dtFim)}${periodo.assumiuAno ? ' — assumindo ' + periodo.dtIni.getFullYear() : ''}</div>`;
  } else if (/\b(PERIODO|MES|DATA|SEMANA|TRIMESTRE|ANO)\b/.test(qNorm)) {
    nota += `<div class="asst-context-note"><i class="ti ti-alert-triangle"></i> não identifiquei o período da pergunta — mostrando todos os dados</div>`;
  }

  // Filtra pelas dimensões citadas que NÃO são a que está sendo
  // ranqueada (ex.: ranking de fornecedor ainda respeita um material
  // citado; ranking de central ignora central citada, não faria sentido).
  Object.entries(mod.dimensoes).forEach(([nome, cfg]) => {
    if (nome === dim) return;
    if (nome === 'central') {
      const r = _asstResolveCentralCtx(query);
      if (r.value) { regs = regs.filter(x => cfg.get(x) === r.value); if (r.fromContext) nota += _asstContextNote('central', r.value); }
    } else if (nome === 'material') {
      const r = _asstResolveMaterialCtx(query);
      if (r.value) { regs = regs.filter(x => cfg.get(x) === r.value); if (r.fromContext) nota += _asstContextNote('material', r.value); }
    }
  });

  const metricaCfg = mod.metricas[metrica];

  if (dim) {
    if (!regs.length) return nota + `Nenhum(a) ${mod.singular} encontrado(a).`;
    const ranking = _asstAgregarGrupo(regs, mod.dimensoes[dim].get, metricaCfg).slice(0, limite);
    const tituloMetrica = metrica === 'qtd' ? 'mais frequentes' : `por ${_ASST_METRICA_LABEL[metrica] || metrica}`;
    const rotuloDim = limite === 1 ? (_ASST_DIM_LABEL_SING[dim] || dim) : (_ASST_DIM_LABEL[dim] || dim);
    let html = `<b>${rotuloDim} ${limite === 1 ? (metrica === 'qtd' ? 'mais frequente' : tituloMetrica) : tituloMetrica} — ${escapeHtml(mod.plural)}</b>`;
    html += ranking.map(([nome, valor, conta], idx) =>
      `<div class="asst-item">${idx + 1}. <b>${escapeHtml(nome)}</b> — ${metricaCfg.fmt(valor)}${metricaCfg.agg !== 'conta' ? ' · ' + conta + ' registro(s)' : ''}</div>`
    ).join('');
    return nota + html;
  }

  // Sem dimensão pedida: total simples (todas as métricas do módulo)
  // + lista dos últimos registros — número solto sem exemplo não ajuda.
  if (!regs.length) return nota + `Nenhum(a) ${mod.singular} encontrado(a).`;

  const total = regs.length;
  let html = `<b>${total}</b> ${total === 1 ? mod.singular : mod.plural}.`;
  Object.entries(mod.metricas).forEach(([nome, cfg]) => {
    if (cfg.agg === 'conta') return;
    const soma = regs.reduce((s, r) => s + (Number(cfg.get(r)) || 0), 0);
    html += `<div class="asst-item">${_ASST_METRICA_LABEL[nome] || nome} total: ${cfg.fmt(soma)}</div>`;
  });

  const ordenados = regs.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const limiteRegistros = _asstDetectarLimite(qNorm, _ASST_SING_REGISTRO, 8);
  html += `<div class="asst-section-title"><i class="ti ti-list-details"></i> Últimos registros</div>`;
  html += ordenados.slice(0, limiteRegistros).map(r => {
    const dataStr    = r.dtEmissao || r.dtLanc || r.mes || '—';
    const centralStr = mod.dimensoes.central ? mod.dimensoes.central.get(r) : '—';
    const materialStr = mod.dimensoes.material ? mod.dimensoes.material.get(r) : null;
    const doc = r.nf || r.os || r.documento || '';
    let linha = `${escapeHtml(dataStr)} · <b>${escapeHtml(centralStr)}</b>`;
    if (r.tipo) linha += ` · ${escapeHtml(r.tipo)}`;
    if (materialStr) linha += ` · ${escapeHtml(materialStr)}`;
    if (doc) linha += ` · ${escapeHtml(doc)}`;
    return `<div class="asst-item">${linha}</div>`;
  }).join('');
  if (ordenados.length > limiteRegistros) html += `<div class="asst-more">+ ${ordenados.length - limiteRegistros} outro(s)</div>`;

  return nota + html;
}

// ── Ocorrências: análise por regional/motivo/central ────────────────
// Reaproveita buildOcKPIs() (já existe em ocorrencias.js pra alimentar
// os gráficos da tela — inclusive tempoMedioRegional, exatamente
// "tempo de retorno por regional") em vez de recalcular do zero.
function _asstIntentOcorrenciasAnalise(query) {
  if (typeof buildOcKPIs !== 'function') return 'O módulo de análise de ocorrências não está disponível nesta tela.';
  const qNorm = normalizeText(query);
  const kpis = buildOcKPIs(state.ocorrencias || []);

  const querTempo    = /TEMPO|RETORNO|DEMORA|PRAZO/.test(qNorm);
  const querRegional = /\bREGIONA(L|IS)\b/.test(qNorm);
  const querMotivo   = /\bMOTIVOS?\b/.test(qNorm);
  const querCentral  = _ASST_PAD_CENTRAL.test(qNorm) && /\b(MAIS|MAIOR|MAIORES|MENOS|MENOR|PIOR|PIORES|MELHOR|MELHORES|TOP)\b/.test(qNorm);

  if (querRegional && querTempo) {
    if (!kpis.tempoMedioRegional.length) return 'Ainda não há ocorrências concluídas suficientes pra calcular tempo de retorno por regional.';
    const limite = _asstDetectarLimite(qNorm, _ASST_SING_REGIONAL, 8);
    let html = `<b>${limite === 1 ? 'Regional' : 'Regionais'} por tempo médio de retorno (pior → melhor)</b>`;
    html += kpis.tempoMedioRegional.slice(0, limite).map(([regional, dias, qtd], idx) =>
      `<div class="asst-item">${idx + 1}. <b>${escapeHtml(regional)}</b> — ${dias.toFixed(1)} dia(s) em média · ${qtd} ocorrência(s) concluída(s)</div>`
    ).join('');
    return html;
  }

  if (querMotivo) {
    if (!kpis.topMotivos.length) return 'Nenhuma ocorrência registrada ainda.';
    const limite = _asstDetectarLimite(qNorm, _ASST_SING_MOTIVO, 8);
    let html = `<b>Ocorrências por motivo${limite === 1 ? ' mais comum' : ''}</b>`;
    html += kpis.topMotivos.slice(0, limite).map(([motivo, qtd], idx) => `<div class="asst-item">${idx + 1}. <b>${escapeHtml(motivo)}</b> — ${qtd} ocorrência(s)</div>`).join('');
    return html;
  }

  if (querCentral) {
    if (!kpis.topCentrals.length) return 'Nenhuma ocorrência registrada ainda.';
    const limite = _asstDetectarLimite(qNorm, _ASST_SING_CENTRAL, 8);
    let html = `<b>${limite === 1 ? 'Central' : 'Centrais'} com mais ocorrências</b>`;
    html += kpis.topCentrals.slice(0, limite).map(([central, qtd], idx) => `<div class="asst-item">${idx + 1}. <b>${escapeHtml(central)}</b> — ${qtd} ocorrência(s)</div>`).join('');
    return html;
  }

  let html = '<b>Visão geral de ocorrências</b>';
  html += `<div class="asst-item">${kpis.total} no total — ${kpis.abertas} aberta(s), ${kpis.concluidas} concluída(s) (${kpis.pctConc}%), ${kpis.inconclusivas} inconclusiva(s)</div>`;
  html += `<div class="asst-item">${kpis.vencidas} vencida(s), ${kpis.urgentes} vencendo em breve</div>`;
  if (kpis.tempoMedioMin != null) html += `<div class="asst-item">Tempo médio de conclusão: ${kpis.tempoMedioMin.toFixed(1)} dia(s) (${kpis.tempoCount} concluída(s) consideradas)</div>`;
  if (kpis.tempoMedioRegional.length) {
    const pior = kpis.tempoMedioRegional[0];
    html += `<div class="asst-item">Regional com pior tempo de retorno: <b>${escapeHtml(pior[0])}</b> — ${pior[1].toFixed(1)} dia(s)</div>`;
  }
  return html;
}

// ── Roteadores internos por módulo ───────────────────────────────────
// O menu "/" agora trava uma ÁREA do sistema (não uma pergunta
// específica). Dentro da área, esses roteadores decidem — por 2-3
// palavras-chave, igual o resto do assistente — qual das funções que
// já existem chamar. Isso não é exposto no menu; é só o "atendente
// interno" de cada contexto amplo.

// Dashboard Analítico: criticidade, ranking, saldo, tendência,
// ausências e resumo — todas já exigiam análise rodada, então o
// contexto inteiro pode travar essa exigência de uma vez só.
function _asstRoteiaDashboardAnalitico(query) {
  const qNorm = normalizeText(query);
  if (/\bSALDO\b|ESTOQUE DE|QUANTO TEM/.test(qNorm)) return _asstIntentSaldoMaterial(query);
  if (/TENDENCIA|PREVISAO|PROJECAO/.test(qNorm)) return _asstIntentTendencia(query);
  if (/AUSENCIA|SEM LANCAR|NAO LANCOU/.test(qNorm)) return _asstIntentAusencias(query);
  if (/CRITIC|URGENTE/.test(qNorm)) return _asstIntentCriticidade(query);
  if (/\bPIOR(ES)?\b/.test(qNorm)) return _ASST_PAD_MATERIAL.test(qNorm) ? _asstIntentRankingMaterial(query, true) : _asstIntentRankingCentral(query, true);
  if (/\bMELHOR(ES)?\b/.test(qNorm)) return _ASST_PAD_MATERIAL.test(qNorm) ? _asstIntentRankingMaterial(query, false) : _asstIntentRankingCentral(query, false);
  if (/SAUDE|RESUMO|VISAO GERAL|SITUACAO/.test(qNorm)) return _asstIntentSaudeGlobal();

  // Nada bateu — isso é diferente de "pediu resumo geral" de propósito.
  // Avisa (em vez de devolver o resumo como se fosse resposta certa) e
  // registra, porque com 6 sub-perguntas bem diferentes aqui dentro,
  // "não reconheci nada" é um sinal real de pergunta fora do catálogo.
  _asstRegistrarNaoReconhecida('dashboard-analitico', query);
  const aviso = `<div class="asst-context-note"><i class="ti ti-alert-triangle"></i> não reconheci uma pergunta específica aqui — mostrando o resumo geral. Posso responder sobre: crítico/urgente, pior/melhor central, saldo, tendência, ausências, ou "resumo geral".</div>`;
  return aviso + _asstIntentSaudeGlobal();
}

// Ocorrências: lista de abertas (padrão) ou análise por
// regional/motivo/central/tempo quando a pergunta pedir isso.
function _asstRoteiaOcorrencias(query) {
  const qNorm = normalizeText(query);
  const pedeAnalise = /\bREGIONA(L|IS)\b|MOTIVOS?|TEMPO|RETORNO|DEMORA|PRAZO/.test(qNorm)
    || (_ASST_PAD_CENTRAL.test(qNorm) && /\b(MAIS|MAIOR|MAIORES|MENOS|MENOR|PIOR|PIORES|MELHOR|MELHORES|TOP)\b/.test(qNorm));
  return pedeAnalise ? _asstIntentOcorrenciasAnalise(query) : _asstIntentOcorrencias(query);
}

// Configurações: pendências de padronização (padrão) ou ações
// propostas pra um material crítico. Único módulo com exigência mista
// de análise (ações precisa, padronização não) — quando cai em ações
// sem análise rodada, a própria função avisa (_asstNoAnaliseMsg), só
// não abre o seletor de período embutido como os outros módulos abrem
// no travamento do contexto; é uma limitação conhecida, não um bug.
function _asstRoteiaConfiguracoes(query) {
  const qNorm = normalizeText(query);
  if (/\b(ACAO|ACOES)\b/.test(qNorm)) return _asstIntentAcoes(query);
  return _asstIntentConfigPendente(query);
}

// ── Fluxo: fontes dinâmicas ──────────────────────────────────────────
// Em vez de fixar Entradas+Saídas, reconhece quais tabelas a própria
// pergunta cita ("fluxo de entrada e SAP") e combina exatamente essas.
// Sem nenhuma citada, cai no padrão mais natural: Entradas+Saídas.
function _asstFluxoFontes(query) {
  const qLoose = normalizeLooseText(query || '');
  const incluir = {
    entrada:    /ENTRADA/.test(qLoose),
    saida:      /SAIDA/.test(qLoose),
    lancamento: /LANCAMENTO/.test(qLoose),
    sap:        /\bSAP\b/.test(qLoose),
  };
  const nenhumaCitada = !incluir.entrada && !incluir.saida && !incluir.lancamento && !incluir.sap;
  return nenhumaCitada ? { entrada: true, saida: true } : incluir;
}

function _asstFluxoRegistros(query) {
  const usar = _asstFluxoFontes(query);
  let regs = [];
  if (usar.entrada)    regs = regs.concat((state.entradas    || []).map(r => ({ central: r.centralDestino || r.centralCompra || '—', material: r.material, peso: r.peso, valorTotal: r.valorTotal, dtEmissao: r.dtEmissao, nf: r.nf, tipo: 'entrada', createdAt: r.createdAt })));
  if (usar.saida)      regs = regs.concat((state.saidas      || []).map(r => ({ central: r.central || '—', material: r.material, peso: r.peso, valorTotal: r.valorTotal, dtEmissao: r.dtEmissao, os: r.os, tipo: 'saída', createdAt: r.createdAt })));
  if (usar.lancamento) regs = regs.concat((state.lancamentos || []).map(r => ({ central: r.central || '—', material: r.material, peso: r.peso, valorTotal: r.valorTotal, dtEmissao: r.dtLanc, tipo: 'lançamento', createdAt: r.createdAt })));
  if (usar.sap)        regs = regs.concat((state.sap         || []).map(r => ({ central: r.central || '—', material: r.material, peso: r.peso, valorTotal: r.valorTotal, dtEmissao: r.dtLanc, documento: r.documento, tipo: 'SAP', createdAt: r.createdAt })));
  return regs;
}

function _asstFluxoDescricao(query) {
  const usar = _asstFluxoFontes(query);
  const nomes = [];
  if (usar.entrada) nomes.push('entradas');
  if (usar.saida) nomes.push('saídas');
  if (usar.lancamento) nomes.push('lançamentos');
  if (usar.sap) nomes.push('SAP');
  return `<div class="asst-context-note"><i class="ti ti-arrows-exchange"></i> considerando: ${nomes.join(', ')}</div>`;
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
  // ── Dashboard Analítico: um contexto só, cobrindo criticidade,
  // ranking de centrais, saldo, tendência, ausências e resumo — o
  // roteador interno decide qual chamar pelas palavras da pergunta.
  {
    id: 'dashboard-analitico', label: 'Dashboard Analítico', group: 'Dashboard Analítico', icon: 'ti-chart-bar',
    needs: [], requiresAnalise: true, handler: raw => _asstRoteiaDashboardAnalitico(raw),
    intro: () => `Contexto travado em <b>Dashboard Analítico</b>. Pergunte sobre materiais críticos/urgentes, ranking de centrais (pior/melhor), saldo ou tendência de um material, centrais sem lançar, ou peça um resumo geral. Usando o período já analisado: <b>${_asstPeriodoLabel()}</b>.`,
  },

  // ── Consultar dados: um contexto por tabela real do sistema. O
  // motor genérico (_asstExecutarConsulta) entende agrupar/ordenar/
  // limitar/período dentro de cada uma.
  { id: 'entradas-consulta',    label: 'Entradas (NF)',            group: 'Consultar dados', icon: 'ti-package-import',   needs: [], requiresAnalise: false, handler: raw => _asstExecutarConsulta('entradas', raw) },
  { id: 'saidas-consulta',      label: 'Saídas (OS)',              group: 'Consultar dados', icon: 'ti-package-export',   needs: [], requiresAnalise: false, handler: raw => _asstExecutarConsulta('saidas', raw) },
  { id: 'lancamentos-consulta', label: 'Lançamentos',              group: 'Consultar dados', icon: 'ti-clipboard-list',   needs: [], requiresAnalise: false, handler: raw => _asstExecutarConsulta('lancamentos', raw) },
  { id: 'sap-consulta',         label: 'SAP',                      group: 'Consultar dados', icon: 'ti-database',         needs: [], requiresAnalise: false, handler: raw => _asstExecutarConsulta('sap', raw) },
  { id: 'custosSap-consulta',   label: 'Custos SAP',               group: 'Consultar dados', icon: 'ti-chart-bar',        needs: [], requiresAnalise: false, handler: raw => _asstExecutarConsulta('custosSap', raw) },
  {
    id: 'fluxo-consulta', label: 'Fluxo (entre tabelas)', group: 'Consultar dados', icon: 'ti-arrows-exchange',
    needs: [], requiresAnalise: false, handler: raw => _asstExecutarConsulta('fluxo', raw),
    intro: () => 'Contexto travado em <b>Fluxo</b>. Combino as tabelas que você citar na pergunta (entrada, saída, lançamento, SAP) — sem citar nenhuma, uso entradas + saídas por padrão.',
  },

  // ── Ocorrências: um contexto só — lista de abertas (padrão) ou
  // análise por regional/motivo/central/tempo quando a pergunta pedir.
  {
    id: 'ocorrencias', label: 'Ocorrências', group: 'Ocorrências', icon: 'ti-list-details',
    needs: [], requiresAnalise: false, handler: raw => _asstRoteiaOcorrencias(raw),
    intro: () => 'Contexto travado em <b>Ocorrências</b>. Pergunte pelas abertas, ou peça uma análise por regional, motivo, central ou tempo de retorno.',
  },

  // ── Configurações: um contexto só — pendências de padronização
  // (padrão) ou ações propostas pra um material crítico.
  {
    id: 'configuracoes', label: 'Configurações', group: 'Configurações', icon: 'ti-settings',
    needs: [], requiresAnalise: false, handler: raw => _asstRoteiaConfiguracoes(raw),
    intro: () => 'Contexto travado em <b>Configurações</b>. Pergunte sobre pendências de padronização, ou ações propostas pra um material crítico (isso último pede análise rodada).',
  },

  // ── Tabelas brutas: registro manual (única ação que o assistente
  // dispara — sempre formulário → confirmação explícita antes de gravar,
  // reaproveitando as mesmas funções puras que os modais das telas usam) ─
  { id: 'entrada-registrar',    label: 'Registrar entrada (NF)',        group: 'Registrar dado', icon: 'ti-circle-plus', needs: [], requiresAnalise: false, formKind: 'entrada',    handler: () => _asstManualNoOpMsg() },
  { id: 'saida-registrar',      label: 'Registrar saída (OS)',          group: 'Registrar dado', icon: 'ti-circle-plus', needs: [], requiresAnalise: false, formKind: 'saida',      handler: () => _asstManualNoOpMsg() },
  { id: 'lancamento-registrar', label: 'Registrar lançamento',          group: 'Registrar dado', icon: 'ti-circle-plus', needs: [], requiresAnalise: false, formKind: 'lancamento', handler: () => _asstManualNoOpMsg() },
  { id: 'sap-registrar',        label: 'Registrar movimentação SAP',    group: 'Registrar dado', icon: 'ti-circle-plus', needs: [], requiresAnalise: false, formKind: 'sap',        handler: () => _asstManualNoOpMsg() },
  { id: 'custosSap-registrar',  label: 'Registrar Custos SAP',          group: 'Registrar dado', icon: 'ti-circle-plus', needs: [], requiresAnalise: false, formKind: 'custosSap',  handler: () => _asstManualNoOpMsg() },

  // ── Sistema: diagnóstico do próprio assistente, não é dado do negócio ─
  { id: 'log-nao-reconhecidas', label: 'Perguntas não reconhecidas', group: 'Sistema', icon: 'ti-help-circle', needs: [], requiresAnalise: false, handler: () => _asstIntentLogNaoReconhecidas() },
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
  _asstAppendMsg('bot', it.intro ? it.intro() : _asstContextLockedMsg(it));
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
      { key: 'pedido',    label: 'Pedido',             type: 'text' },
      { key: 'documento', label: 'Doc MIGO',           type: 'text' },
      { key: 'dtLanc',    label: 'Data de lançamento', type: 'date' },
    ],
  },
  custosSap: {
    label: 'Custos SAP', create: dados => _criarRegistroCustosSap(dados),
    fields: [
      { key: 'material',     label: 'Material',      type: 'text',   required: true },
      { key: 'central',      label: 'Central',       type: 'text',   required: true },
      { key: 'ano',          label: 'Ano',            type: 'text',   required: true },
      { key: 'mes',          label: 'Mês',            type: 'text',   required: true },
      { key: 'estoqueTotal', label: 'Estoque total',  type: 'number' },
      { key: 'valorTotal',   label: 'Valor total',    type: 'number' },
      { key: 'custo',        label: 'Custo',          type: 'number' },
    ],
  },
};

const _ASST_MANUAL_REFRESH = {
  entrada:    () => { if (typeof renderEntradas    === 'function') renderEntradas(); },
  saida:      () => { if (typeof renderSaidas      === 'function') renderSaidas(); },
  lancamento: () => { if (typeof renderLancamentos === 'function') renderLancamentos(); },
  sap:        () => { if (typeof renderSAP         === 'function') renderSAP(); },
  custosSap:  () => { if (typeof renderCustosSap   === 'function') renderCustosSap(); },
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
