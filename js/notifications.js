'use strict';

// ═══════════════════════════════════════════════════════════
// SISTEMA DE NOTIFICAÇÕES — notifications.js
// ═══════════════════════════════════════════════════════════

// Limiares de saúde espelham calcHealthScore em ui.js:
//   score >= 80  → ok       (sem alerta)
//   score >= 55  → atencao
//   score >= 30  → urgente
//   score <  30  → critico
const NOTIF_CONF_WARN_DAYS = 2;

const NOTIF_SRC = {
  SAUDE_CENTRAIS:  'saude-centrais',
  SAUDE_MATERIAIS: 'saude-materiais',
  OC_VENCIDA:      'oc-vencida',
  OC_URGENTE:      'oc-urgente',
  CONF_TERCA:      'conf-terca',
  CONF_MENSAL:     'conf-mensal',
};

function _notifEsc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function _notifFmtDate(d) {
  return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear();
}
function _lastWorkingDay(year, month) {
  const d = new Date(year, month+1, 0);
  while (d.getDay()===0||d.getDay()===6) d.setDate(d.getDate()-1);
  return d;
}
function _nextTuesday() {
  const d = new Date(); d.setHours(0,0,0,0);
  if (d.getDay()===2) return d;
  while (d.getDay()!==2) d.setDate(d.getDate()+1);
  return d;
}

// Converte score numérico para level usando os limiares do sistema
function _notifScoreToLevel(score) {
  if (score >= 80) return 'ok';
  if (score >= 55) return 'atencao';
  if (score >= 30) return 'urgente';
  return 'critico';
}

// Rótulos amigáveis para cada level
const _NOTIF_LEVEL_LABEL = { ok:'Ok', atencao:'Atenção', urgente:'Urgente', critico:'Crítico' };

// Período de referência: 01/mm → ontem
function _notifPeriodoLabel() {
  const today = new Date(); today.setHours(0,0,0,0);
  const ontem = new Date(today); ontem.setDate(ontem.getDate()-1);
  const ini   = new Date(today.getFullYear(), today.getMonth(), 1);
  return `${_notifFmtDate(ini)} a ${_notifFmtDate(ontem)}`;
}

// ── Calcula conjunto esperado de notificações ─────────────
function _notifCompute(healthScores) {
  const result  = [];
  const today   = new Date(); today.setHours(0,0,0,0);
  // Usa o período passado pelo analítico se disponível, senão o período silencioso
  const periodo = healthScores?.periodoLabel || _notifPeriodoLabel();

  // Saúde das centrais — usa limiares do sistema
  if (healthScores?.centralScore != null) {
    const s   = healthScores.centralScore;
    const lvl = _notifScoreToLevel(s);
    if (lvl !== 'ok') {
      result.push({ id: NOTIF_SRC.SAUDE_CENTRAIS, type:'saude',
        level: lvl === 'urgente' ? 'atencao' : lvl,
        title: `Saúde das centrais: ${s}% · ${_NOTIF_LEVEL_LABEL[lvl]}`,
        body:  `Período analisado: ${periodo}. A saúde geral das centrais está em ${s}% (${_NOTIF_LEVEL_LABEL[lvl]}). Acesse o Dashboard Analítico para identificar os materiais críticos.`,
        source: NOTIF_SRC.SAUDE_CENTRAIS });
    }
  }

  // Saúde dos materiais — usa limiares do sistema
  if (healthScores?.matScore != null) {
    const s   = healthScores.matScore;
    const lvl = _notifScoreToLevel(s);
    if (lvl !== 'ok') {
      result.push({ id: NOTIF_SRC.SAUDE_MATERIAIS, type:'saude',
        level: lvl === 'urgente' ? 'atencao' : lvl,
        title: `Saúde dos materiais: ${s}% · ${_NOTIF_LEVEL_LABEL[lvl]}`,
        body:  `Período analisado: ${periodo}. A saúde geral dos materiais está em ${s}% (${_NOTIF_LEVEL_LABEL[lvl]}). Acesse o Dashboard Analítico para detalhes.`,
        source: NOTIF_SRC.SAUDE_MATERIAIS });
    }
  }

  // Ocorrências vencidas
  const ocs = Array.isArray(state?.ocorrencias) ? state.ocorrencias : [];
  const venc = ocs.filter(o => !o.concluida && !o.inconclusiva && o.dataLimite &&
    new Date(o.dataLimite+'T00:00:00') < today);
  if (venc.length) result.push({ id: NOTIF_SRC.OC_VENCIDA, type:'ocorrencia', level:'critico',
    title: `${venc.length} ocorrência${venc.length!==1?'s':''} vencida${venc.length!==1?'s':''}`,
    body:  `${venc.length} ocorrência${venc.length!==1?'s':''} passou${venc.length!==1?'ram':''} do prazo. Acesse o módulo de Ocorrências.`,
    source: NOTIF_SRC.OC_VENCIDA });

  // Ocorrências urgentes
  const urg = ocs.filter(o => {
    if (o.concluida||o.inconclusiva||!o.dataLimite) return false;
    const d = Math.round((new Date(o.dataLimite+'T00:00:00')-today)/86400000);
    return d>=0 && d<=2;
  });
  if (urg.length) result.push({ id: NOTIF_SRC.OC_URGENTE, type:'ocorrencia', level:'atencao',
    title: `${urg.length} ocorrência${urg.length!==1?'s':''} urgente${urg.length!==1?'s':''}`,
    body:  `${urg.length} ocorrência${urg.length!==1?'s':''} vence${urg.length!==1?'m':''} em até 2 dias. Verifique Ocorrências.`,
    source: NOTIF_SRC.OC_URGENTE });

  // Conferência semanal (terça)
  const terca = _nextTuesday();
  const diffT = Math.round((terca-today)/86400000);
  if (diffT<=NOTIF_CONF_WARN_DAYS) {
    const label = diffT===0?'hoje':diffT===1?'amanhã':`em ${diffT} dias`;
    result.push({ id: NOTIF_SRC.CONF_TERCA, type:'conferencia', level:'info',
      title: `Conferência semanal ${label}`,
      body:  `A terça-feira de conferência é ${label} (${_notifFmtDate(terca)}). Certifique-se de lançar os estoques.`,
      source: NOTIF_SRC.CONF_TERCA });
  }

  // Fechamento mensal (último dia útil)
  const lastUtil = _lastWorkingDay(today.getFullYear(), today.getMonth());
  const diffM = Math.round((lastUtil-today)/86400000);
  if (diffM>=0 && diffM<=NOTIF_CONF_WARN_DAYS) {
    const label = diffM===0?'hoje':diffM===1?'amanhã':`em ${diffM} dias`;
    result.push({ id: NOTIF_SRC.CONF_MENSAL, type:'conferencia', level:'info',
      title: `Fechamento mensal ${label}`,
      body:  `O último dia útil do mês é ${label} (${_notifFmtDate(lastUtil)}). Faça o fechamento mensal de estoque.`,
      source: NOTIF_SRC.CONF_MENSAL });
  }

  return result;
}

// Tipos calculados/recalculados por _notifCompute a cada chamada de
// notifSync. Preparado para a Etapa 3: notificações de 'atividade' (via
// Realtime) são inseridas por fora deste ciclo (ver notifPushActivity,
// a ser criado na próxima etapa) e não devem ser removidas aqui — sem
// isso, a primeira recomputação de saúde depois de uma notificação de
// atividade a apagaria da lista sem nenhum motivo relacionado a ela.
const _NOTIF_MANAGED_TYPES = new Set(['saude','ocorrencia','conferencia']);

// ── Sincroniza state.notifications ───────────────────────
function notifSync(healthScores) {
  if (!Array.isArray(state.notifications)) state.notifications = [];
  const expected    = _notifCompute(healthScores);
  const expectedIds = new Set(expected.map(n=>n.id));

  // Remove as que não se aplicam mais — só entre os tipos que este
  // cálculo de fato gerencia (saude/ocorrencia/conferencia).
  state.notifications = state.notifications.filter(n=>!_NOTIF_MANAGED_TYPES.has(n.type) || expectedIds.has(n.id));

  // Adiciona novas
  const existingIds = new Set(state.notifications.map(n=>n.id));
  expected.forEach(n => {
    if (!existingIds.has(n.id)) {
      state.notifications.push({ ...n, createdAt: Date.now(), read: false });
    }
  });

  // Ordena: não lidas primeiro → nível → data
  const lvlOrd = {critico:0,atencao:1,info:2};
  state.notifications.sort((a,b) => {
    if (a.read!==b.read) return a.read?1:-1;
    const ld=(lvlOrd[a.level]??3)-(lvlOrd[b.level]??3);
    return ld!==0?ld:b.createdAt-a.createdAt;
  });

  _notifRenderBadge();
  if (typeof persist==='function') persist();
}

// ── Cálculo silencioso de saúde ao carregar ───────────────
async function notifSilentHealthCheck() {
  if (!Array.isArray(state.lancamentos)||!state.lancamentos.length) {
    notifSync(null); return;
  }
  try {
    const today = new Date(); today.setHours(0,0,0,0);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate()-1);
    const dtIni = new Date(today.getFullYear(),today.getMonth(),1);
    const dtFim = yesterday;
    if (dtFim<dtIni) { notifSync(null); return; }

    if (typeof buildDashboardGerencialResults!=='function'||
        typeof calcHealthScore!=='function'||
        typeof getHealthThresholds!=='function'||
        typeof buildSnapshot!=='function'||
        typeof classifyVariation!=='function'||
        typeof detectCatKey!=='function') {
      notifSync(null); return;
    }

    await yieldToUI();
    const results = buildDashboardGerencialResults(dtIni, dtFim);
    if (!results?.length) { notifSync(null); return; }
    await yieldToUI();

    const thresholds = getHealthThresholds();
    const _scoreFromCounts = counts => {
      const total = Object.values(counts).reduce((s,n)=>s+n,0);
      if (!total) return 100;
      const penalty = (counts.atencao||0)*0.2 + (counts.urgente||0)*0.5 + (counts.critico||0)*1.0;
      return Math.max(0, Math.round((1 - penalty/total)*100));
    };

    const centralCounts = {bom:0, atencao:0, urgente:0, critico:0};
    const matCounts     = {bom:0, atencao:0, urgente:0, critico:0};

    // Processa centrais em batches de 5 com yield para não bloquear o thread
    const BATCH = 5;
    for (let i = 0; i < results.length; i += BATCH) {
      results.slice(i, i + BATCH).forEach(r => {
        // Usa lancsByMat já computado pelo buildDashboardGerencialResults
        const lancsByMat = r.lancsByMat || new Map();
        const sapByMat   = new Map();
        (r.sapNoPeriodo||[]).forEach(s => {
          if (!sapByMat.has(s.material)) sapByMat.set(s.material,[]);
          sapByMat.get(s.material).push(s);
        });
        const matDiffs = (r.allMats||[]).map(mat => {
          const lancs = lancsByMat.get(mat)||[];
          const sap   = sapByMat.get(mat)||[];
          const rawCat = ((lancs[0]||sap[0])?.categoria||'').trim().toUpperCase();
          const catKey = detectCatKey(rawCat)||(typeof detectCatFromMat==='function'?detectCatFromMat(mat):null);
          const prev  = typeof getPrePeriodLaunchStock==='function'
            ? getPrePeriodLaunchStock({central:r.central,material:mat,dtIni,dtFim,catKey}) : null;
          const snap  = buildSnapshot({lancs,sap,initialStockOverride:prev?.value??null});
          const level  = classifyVariation(Math.abs(snap.diff), catKey, thresholds);
          matCounts[level]++;
          return {diff:snap.diff, catKey};
        });
        const {level: centralLevel} = calcHealthScore(matDiffs, null, null, thresholds);
        centralCounts[(!centralLevel||centralLevel==='ok') ? 'bom' : centralLevel]++;
      });
      await yieldToUI(); // yield entre batches
    }

    notifSync({ centralScore: _scoreFromCounts(centralCounts), matScore: _scoreFromCounts(matCounts) });
  } catch(err) {
    console.warn('[Notif] Erro no check silencioso:',err);
    notifSync(null);
  }
}

// ── Badge ─────────────────────────────────────────────────
function _notifRenderBadge() {
  const notifs = Array.isArray(state.notifications)?state.notifications:[];
  const unread = notifs.filter(n=>!n.read).length;
  const badge  = document.getElementById('notif-badge');
  const btn    = document.getElementById('notif-btn');
  if (!badge||!btn) return;
  if (unread>0) {
    badge.textContent = unread>99?'99+':String(unread);
    badge.style.display='';
    const lvlOrd={critico:0,atencao:1,info:2};
    const worst=notifs.filter(n=>!n.read).sort((a,b)=>(lvlOrd[a.level]??3)-(lvlOrd[b.level]??3))[0];
    badge.className='notif-badge notif-badge-'+(worst?.level||'info');
    btn.classList.add('notif-btn-active');
  } else {
    badge.style.display='none';
    btn.classList.remove('notif-btn-active');
  }
}

// ── Dropdown ──────────────────────────────────────────────
let _notifOpen=false;
function notifToggle() { _notifOpen?notifClose():notifOpen(); }
function notifOpen()  {
  _notifOpen=true;
  _notifRenderDropdown();
  document.getElementById('notif-dropdown')?.classList.add('open');
  document.getElementById('notif-btn')?.classList.add('open');
}
function notifClose() {
  _notifOpen=false;
  document.getElementById('notif-dropdown')?.classList.remove('open');
  document.getElementById('notif-btn')?.classList.remove('open');
}
document.addEventListener('click', e=>{
  const wrap=document.getElementById('notif-wrap');
  if (wrap&&!wrap.contains(e.target)&&_notifOpen) notifClose();
});

const _NLM = {
  critico:{ col:'var(--red)',   icon:'ti-flame',          label:'Crítico' },
  atencao:{ col:'var(--amber)', icon:'ti-alert-triangle', label:'Atenção' },
  info:   { col:'var(--accent)', icon:'ti-info-circle',    label:'Info'    },
};
const _NTM = {
  saude:        { icon:'ti-heartbeat'       },
  ocorrencia:   { icon:'ti-alert-circle'    },
  conferencia:  { icon:'ti-calendar-event'  },
  atividade:    { icon:'ti-bolt'            },
  auth:         { icon:'ti-fingerprint'     },
  // Prioridade do Supervisor (31/07) — ícone e cor próprios (ver
  // _SUPERVISOR_PRIORITY_COLOR abaixo), pra não se confundir visualmente
  // nem com os alertas de saúde/prazo (ocorrencia) nem com o feed genérico
  // de atividade de terceiros.
  escalonamento:{ icon:'ti-arrow-up-circle' },
  dai:          { icon:'ti-file-text'       },
  // Lado do DONO (31/07) — o Supervisor escalonou/concluiu/marcou
  // inconclusiva/reabriu/descalonou a ocorrência dele. Um ícone/cor só,
  // reaproveitado pros vários sub-tipos (ver _ocDetectarMudancaPrioritaria
  // em ocorrencias.js) — o título já diz qual foi a ação específica.
  'acao-supervisor': { icon:'ti-user-shield' },
};

// Cor do ícone de notificações de atividade/auth — por módulo (mesma cor
// da aba correspondente em index.html, ex.: entradas=verde, saídas=vermelho),
// não por level (que pra esse tipo é sempre 'info', sem significado). Level
// continua mandando a cor pra saude/ocorrencia/conferencia (ali sim é
// severidade de verdade). Tabelas sem aba própria (cadastro/config) caem
// no cinza neutro da aba Configurações.
const _ACTIVITY_MODULE_COLOR = {
  entradas:    'var(--green)',
  saidas:      'var(--red)',
  lancamentos: 'var(--amber)',
  ocorrencias: 'var(--amber)',
  custos_sap:  'var(--purple)',
  sap:         'var(--accent)',
  imports:     'var(--teal)',
  profiles:    'var(--red)',
};
const _ACTIVITY_DEFAULT_COLOR = 'var(--text2)';
const _AUTH_COLOR = 'var(--accent)';

// Cor das notificações de prioridade do Supervisor — reaproveita as MESMAS
// cores já usadas pra essas coisas no resto do app, em vez de inventar uma
// nova: roxo é a cor do nível "Supervisor do Setor" em OC_HIERARQUIA
// (ocorrencias.js), dourado é a cor de tudo que é DAI/Ajuste Sistêmico
// (--gold, ver oc-badge-gold/oc-card-ajuste-sistemico em modules.css).
const _SUPERVISOR_PRIORITY_COLOR = { escalonamento: 'var(--purple)', dai: 'var(--gold)', 'acao-supervisor': 'var(--purple)' };

function _notifTimeAgo(ts) {
  if (!ts) return '';
  const m=Math.floor((Date.now()-ts)/60000);
  if (m<1) return 'agora';
  if (m<60) return m+'min atrás';
  const h=Math.floor(m/60);
  if (h<24) return h+'h atrás';
  return Math.floor(h/24)+'d atrás';
}

// Mapa source → página de destino
const _NOTIF_ROUTE = {
  [NOTIF_SRC.SAUDE_CENTRAIS]:  'analitico',
  [NOTIF_SRC.SAUDE_MATERIAIS]: 'analitico',
  [NOTIF_SRC.OC_VENCIDA]:      'ocorrencias',
  [NOTIF_SRC.OC_URGENTE]:      'ocorrencias',
  [NOTIF_SRC.CONF_TERCA]:      'lancamentos',
  [NOTIF_SRC.CONF_MENSAL]:     'lancamentos',
};

function notifNavigate(id, event) {
  event?.stopPropagation();
  const n = (state.notifications||[]).find(n=>n.id===id);
  if (n) { n.read=true; if(typeof persist==='function') persist(); }
  const page = _NOTIF_ROUTE[id];
  notifClose();
  if (page && typeof navigate==='function') navigate(page);
  _notifRenderBadge();
}

// ── Prioridade do Supervisor: ocorrência escalonada / nova DAI (31/07) ──
// Disparada pelo Realtime de ocorrencias.js (_ocRealtimeInit) só na
// PRIMEIRA vez que uma ocorrência de outro usuário entra na tela do
// Supervisor por escalonamento ou DAI — não a cada edição. Ao contrário da
// notificação genérica de atividade, o clique abre o modal PADRÃO de
// Ocorrências/DAI (openOcDetailModal, o mesmo que os cards da tela usam),
// não um modal genérico de antes/depois de campos.
function notifPushOcorrenciaSupervisor({ ocorrenciaId, tipo, titulo, corpo }) {
  if (!Array.isArray(state.notifications)) state.notifications = [];
  const id = `${tipo}-oc-${ocorrenciaId}`;
  if (state.notifications.some(n => n.id === id)) return; // já notificado nesta sessão
  state.notifications.unshift({
    id, type: tipo, level: 'critico', title: titulo, body: (corpo || '').slice(0, 140),
    createdAt: Date.now(), read: false, ocorrenciaId,
  });
  if (typeof persist === 'function') persist();
  _notifRenderBadge();
  if (_notifOpen) _notifRenderDropdown();
  notifShowActivityToast(titulo, corpo || '');
  notifPlaySound();
}

function notifAbrirOcorrenciaPrioritaria(notifId, event) {
  event?.stopPropagation();
  const n = (state.notifications||[]).find(x => x.id === notifId);
  if (!n || !n.ocorrenciaId) return;
  n.read = true;
  if (typeof persist === 'function') persist();
  _notifRenderBadge();
  notifClose();
  if (typeof navigate === 'function') navigate('ocorrencias');
  if (typeof openOcDetailModal === 'function') openOcDetailModal(n.ocorrenciaId);
}

function _notifRenderDropdown() {
  const body=document.getElementById('notif-list');
  if (!body) return;
  const notifs=Array.isArray(state.notifications)?state.notifications:[];
  if (!notifs.length) {
    body.innerHTML=`<div class="notif-empty"><i class="ti ti-bell-off"></i><span>Nenhuma notificação</span></div>`;
    return;
  }
  body.innerHTML=notifs.map(n=>{
    const lm=_NLM[n.level]||_NLM.info;
    const tm=_NTM[n.type]||_NTM.ocorrencia;
    const isAtividade = n.type === 'atividade' || n.type === 'auth';
    // Notificações vinculadas a uma ocorrência (31/07: escalonamento/dai do
    // lado do Supervisor, acao-supervisor do lado do dono) abrem o modal
    // PADRÃO de Ocorrências (o mesmo que o card na tela usa), não o modal
    // genérico de detalhe de atividade — discriminado por ocorrenciaId, não
    // por type, pra qualquer tipo novo desse grupo cair aqui automaticamente.
    const temOcorrenciaVinculada = !!n.ocorrenciaId;
    const iconCol = n.type === 'auth' ? _AUTH_COLOR
      : n.type === 'atividade' ? (_ACTIVITY_MODULE_COLOR[n.activityTable] || _ACTIVITY_DEFAULT_COLOR)
      : temOcorrenciaVinculada ? (_SUPERVISOR_PRIORITY_COLOR[n.type] || 'var(--purple)')
      : lm.col;
    const hasRoute = isAtividade ? !!n.activityLogId : temOcorrenciaVinculada ? true : !!_NOTIF_ROUTE[n.id];
    const clickAttr = !hasRoute ? '' : isAtividade
      ? `onclick="notifAbrirDetalheAtividade('${_notifEsc(n.id)}',event)"`
      : temOcorrenciaVinculada
      ? `onclick="notifAbrirOcorrenciaPrioritaria('${_notifEsc(n.id)}',event)"`
      : `onclick="notifNavigate('${_notifEsc(n.id)}',event)"`;
    return `<div class="notif-item${n.read?' notif-item-read':''}${hasRoute?' notif-item-clickable':''}"
      data-id="${_notifEsc(n.id)}"
      ${clickAttr}>
      <div class="notif-item-icon" style="background:color-mix(in srgb, ${iconCol} 18%, transparent);color:${iconCol};border:1px solid color-mix(in srgb, ${iconCol} 30%, transparent)"><i class="ti ${tm.icon}"></i></div>
      <div class="notif-item-body">
        <div class="notif-item-title">${_notifEsc(n.title)}</div>
        <div class="notif-item-desc">${_notifEsc(n.body)}</div>
        <div class="notif-item-meta">
          <span class="notif-level-chip" style="color:${lm.col}">${lm.label}</span>
          <span class="notif-time">${_notifTimeAgo(n.createdAt)}</span>
          ${hasRoute?`<span class="notif-go-hint"><i class="ti ti-arrow-right" style="font-size:10px"></i></span>`:''}
        </div>
      </div>
      ${n.integrable ? (n.integrated
          ? `<span class="notif-integrated-badge" title="Integrado aos seus dados"><i class="ti ti-circle-check"></i></span>`
          : `<button class="notif-integrar-btn" onclick="notifIntegrar('${_notifEsc(n.id)}',event)" title="Aceitar — passa a contar nos seus dados"><i class="ti ti-download"></i> Aceitar</button>`)
        : (!n.read?`<button class="notif-mark-btn" onclick="notifMarkRead('${_notifEsc(n.id)}',event)" title="Marcar como lida"><i class="ti ti-check"></i></button>`:'')}
    </div>`;
  }).join('');
}

// Aceita um registro de outro usuário: passa a contar nas telas de
// trabalho do ADM (record_integrations, via integrarRegistro em
// normalize.js) e re-sincroniza só o módulo afetado.
async function notifIntegrar(id, event) {
  event?.stopPropagation();
  const n = (state.notifications||[]).find(n=>n.id===id);
  if (!n || !n.integrable || n.integrated) return;
  const ok = await integrarRegistro(n.activityTable, n.integratedRowId);
  if (!ok) { toast('Não foi possível aceitar o registro.', 'error'); return; }
  n.integrated = true;
  n.read = true;
  if (typeof persist==='function') persist();
  _notifRenderBadge();
  _notifRenderDropdown();
  toast('Registro integrado aos seus dados.', 'success');
}

// ── Ações ─────────────────────────────────────────────────
function notifMarkRead(id,event) {
  event?.stopPropagation();
  const n=(state.notifications||[]).find(n=>n.id===id);
  if (n) { n.read=true; if(typeof persist==='function') persist(); }
  _notifRenderBadge();
  _notifRenderDropdown();
}
function notifMarkAllRead() {
  (state.notifications||[]).forEach(n=>{n.read=true;});
  if (typeof persist==='function') persist();
  _notifRenderBadge();
  _notifRenderDropdown();
}
function notifUpdateFromAnalytico(centralScore, matScore, dtIni, dtFim) {
  let periodoLabel = null;
  if (dtIni && dtFim) {
    const ini = dtIni instanceof Date ? dtIni : new Date(dtIni);
    const fim = dtFim instanceof Date ? dtFim : new Date(dtFim);
    periodoLabel = `${_notifFmtDate(ini)} a ${_notifFmtDate(fim)}`;
  }
  notifSync({
    centralScore: typeof centralScore==='number' ? centralScore : null,
    matScore:     typeof matScore    ==='number' ? matScore     : null,
    periodoLabel,
  });
}
function notifBoot() {
  if (!Array.isArray(state.notifications)) state.notifications=[];

  // Descarta notificações de atividade já lidas — só limpeza local (essa
  // lista nem é o registro de verdade, que continua intacto no
  // activity_log). Não mexe nos tipos "gerenciados" (saude/ocorrencia/
  // conferencia, ver _NOTIF_MANAGED_TYPES): esses representam uma
  // condição em aberto, não um evento pontual — sumir com a versão lida
  // faria o aviso reaparecer como não lido enquanto a condição persistir.
  const antes = state.notifications.length;
  const _TIPOS_PONTUAIS = new Set(['atividade', 'escalonamento', 'dai', 'acao-supervisor']);
  state.notifications = state.notifications.filter(n => !_TIPOS_PONTUAIS.has(n.type) || !n.read);
  if (state.notifications.length !== antes && typeof persist === 'function') persist();

  _notifRenderBadge();
  // Delay generoso — o cálculo silencioso de saúde é pesado (percorre todos os dados).
  // Só executa quando o browser está ocioso para não travar a UI logo após o boot.
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => notifSilentHealthCheck(), { timeout: 10000 });
  } else {
    setTimeout(() => notifSilentHealthCheck(), 5000);
  }
}

// ═══════════════════════════════════════════════════════════
// SOM + TOAST DE ATIVIDADE — infraestrutura (Fase 5, Etapa 1)
// ═══════════════════════════════════════════════════════════
// Funções prontas para uso pela Etapa 3 (canal Realtime assinando
// activity_log). Nesta entrega elas existem e funcionam isoladamente,
// mas ainda não são chamadas por nenhum gatilho automático — a fiação
// com o Realtime e com a regra "ADM vê ação de outros / dono vê ação do
// ADM" fica pra próxima etapa.

// Som curto (dois tons subindo), gerado via Web Audio API — sem depender
// de nenhum arquivo de áudio externo. Contexto criado só na primeira
// chamada (lazy) porque navegadores bloqueiam AudioContext antes de
// qualquer interação do usuário; como o app já exige clique/login antes
// de qualquer notificação chegar, isso nunca deve ser um problema na
// prática. Falha (ex.: contexto bloqueado) é silenciosa — o toast visual
// continua funcionando normalmente mesmo sem som.
let _notifAudioCtx = null;
function notifPlaySound() {
  try {
    if (!_notifAudioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      _notifAudioCtx = new AC();
    }
    if (_notifAudioCtx.state === 'suspended') _notifAudioCtx.resume();
    const ctx = _notifAudioCtx;
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.6, ctx.currentTime + 0.02);
    gain.gain.setValueAtTime(0.6, ctx.currentTime + 0.2); // sustém no pico em vez de já cair
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.32);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.32);
  } catch (e) { console.warn('[Notif] Falha ao tocar som:', e); }
}

// Popup transiente embaixo do sino (elemento #notif-activity-toast,
// ver index.html) — some sozinho depois de alguns segundos ou ao clicar
// nele. Independente do dropdown/badge (que continuam representando o
// histórico persistido); este é só o "flash" de algo acontecendo agora.
let _notifToastTimer = null;
function notifShowActivityToast(title, body) {
  const el = document.getElementById('notif-activity-toast');
  if (!el) return;
  const titleEl = el.querySelector('.notif-toast-title');
  const bodyEl  = el.querySelector('.notif-toast-body');
  if (titleEl) titleEl.textContent = title || 'Atividade';
  if (bodyEl)  bodyEl.textContent  = body  || '';
  el.classList.add('show');
  clearTimeout(_notifToastTimer);
  _notifToastTimer = setTimeout(() => el.classList.remove('show'), 5000);
}
function notifHideActivityToast() {
  document.getElementById('notif-activity-toast')?.classList.remove('show');
  clearTimeout(_notifToastTimer);
}

// ═══════════════════════════════════════════════════════════
// REALTIME DE ATIVIDADE — Fase 5, Etapa 3
// ═══════════════════════════════════════════════════════════
// Assina só a activity_log (não as 19 tabelas diretamente — ver migração
// da Etapa 2). A trigger de banco já grava lá toda escrita relevante; o
// Postgres Changes do Supabase só entrega a cada cliente as linhas que a
// RLS de activity_log permite (dono OU ator OU admin) — a regra abaixo é
// uma segunda camada no cliente, não a barreira de segurança real.
//
// Regra (decidida com o Hugo em 27/07):
//   - ADM é notificado de qualquer ação de QUALQUER outro usuário.
//   - Um usuário comum é notificado só quando o ATOR foi o ADM mexendo
//     num registro que é dele (dono).
//   - Ninguém é notificado da própria ação.

const _ACTIVITY_VERB = { INSERT: 'criou', UPDATE: 'editou', DELETE: 'excluiu' };

// Eventos de auth não são um registro de dado sendo mexido — não fazem
// sentido no molde "{ator} {verbo} um registro em {módulo}". Frase própria
// por evento, sem módulo nem corpo (auth nunca carrega old_data/new_data).
const _ACTIVITY_AUTH_LABEL = {
  LOGIN:           'entrou no sistema',
  LOGOUT:          'saiu do sistema',
  PASSWORD_CHANGE: 'trocou a senha',
};

function _activityShouldNotify(row) {
  const me = window.currentUser;
  if (!me || !row) return false;
  if (row.actor_id === me.id) return false; // nunca notifica a própria ação
  // LOGIN pousa toda vez que qualquer usuário abre o sistema — virou
  // ruído puro poluindo o sino do Supervisor (achado do usuário, 31/07).
  // O evento continua gravado no activity_log (auditoria intacta); só a
  // NOTIFICAÇÃO é cortada. LOGOUT/PASSWORD_CHANGE continuam normalmente.
  if (row.table_name === 'auth' && row.operation === 'LOGIN') return false;
  if (me.role === 'admin') return true;     // admin vê ação de qualquer outro
  return row.owner_id === me.id;            // dono vê quando o ADM mexeu no que é dele
}

// ADMIN_MODULOS (admin.js) já tem o rótulo e as colunas mais relevantes
// de cada tabela — reaproveitado aqui pra não duplicar essa lista.
function _activityModuleLabel(tableName) {
  if (tableName === 'profiles') return 'Usuários';
  return (typeof ADMIN_MODULOS !== 'undefined' && ADMIN_MODULOS[tableName]?.label) || tableName;
}
// ADMIN_MODULOS não cobre `profiles` de propósito (tem aba própria no
// Admin — ver admin.js). Descrição própria só pra essa tabela, usada só
// quando a mudança é de verdade (troca de papel — heartbeat de presença
// já é filtrado na origem, na trigger do banco).
const _ACTIVITY_EXTRA_COLS = {
  profiles: ['email', 'role'],
};
function _activityDescribeRow(row) {
  const cols = _ACTIVITY_EXTRA_COLS[row.table_name]
    || (typeof ADMIN_MODULOS !== 'undefined' && ADMIN_MODULOS[row.table_name]?.cols)
    || [];
  const data = row.operation === 'DELETE' ? row.old_data : row.new_data;
  if (!data) return '';
  return cols.map(c => data[c]).filter(v => v !== null && v !== undefined && v !== '')
    .slice(0, 2).join(' · ');
}

// A RLS de profiles é dono OU admin — um usuário comum não consegue ler
// o e-mail de outra pessoa mesmo tentando, então pra ele o rótulo do
// ator é sempre genérico. Só quando EU sou admin faz sentido resolver
// e-mails de terceiros (e só admin tem visibilidade pra isso no banco).
let _activityUserCache = null;
async function _activityGetUserCache() {
  if (_activityUserCache) return _activityUserCache;
  _activityUserCache = new Map();
  try {
    const { data, error } = await window.supabaseClient.from('profiles').select('id, email');
    if (!error && data) data.forEach(u => _activityUserCache.set(u.id, u.email));
  } catch (e) { console.warn('[Activity] Falha ao carregar usuários:', e); }
  return _activityUserCache;
}
async function _activityResolveActorLabel(actorId) {
  const me = window.currentUser;
  if (me?.role !== 'admin') return 'O administrador';
  const cache = await _activityGetUserCache();
  const email = cache.get(actorId);
  return email ? email.split('@')[0] : 'Alguém';
}

// Só oferece "Aceitar integração" pra INSERT único (não em lote — um
// import em massa de outro usuário deve ser tratado pela lista de
// pendências no painel de Supervisão, não aceito às cegas por uma
// notificação que só carrega a amostra mais recente do grupo) numa das
// tabelas do fluxo de integração, e só pro ADM (só ele tem RLS bypass
// pra sequer receber o evento de outro dono).
function _activityIsIntegrable(row, count) {
  return row.operation === 'INSERT' && count === 1
    && typeof RECORD_INTEGRATION_TABLES !== 'undefined'
    && RECORD_INTEGRATION_TABLES.includes(row.table_name)
    && window.currentUser?.role === 'admin';
}

async function _activityEmitNotification(row, count) {
  const isAuth      = row.table_name === 'auth';
  const isAlertConf = row.table_name === 'admin_alert_confirmations';
  const actorLabel  = await _activityResolveActorLabel(row.actor_id);

  let title, body;
  if (isAlertConf) {
    title = `${actorLabel} confirmou o alerta`;
    body  = '';
  } else if (isAuth) {
    title = `${actorLabel} ${_ACTIVITY_AUTH_LABEL[row.operation] || 'mexeu na conta'}`;
    body  = '';
  } else {
    const verb        = _ACTIVITY_VERB[row.operation] || 'alterou';
    const moduleLabel = _activityModuleLabel(row.table_name);
    title = count > 1
      ? `${actorLabel} ${verb} ${count} registros em ${moduleLabel}`
      : `${actorLabel} ${verb} um registro em ${moduleLabel}`;
    body = count === 1 ? _activityDescribeRow(row) : '';
  }

  if (!Array.isArray(state.notifications)) state.notifications = [];
  state.notifications.unshift({
    id: `atividade-${row.table_name}-${row.id}`,
    type: isAuth ? 'auth' : 'atividade',
    level: 'info',
    title, body,
    createdAt: Date.now(),
    read: false,
    // Referência direta pro activity_log — usada por notifAbrirDetalheAtividade
    // pra buscar o registro completo (old_data/new_data) só quando clicado,
    // sem precisar guardar tudo isso localmente pra cada notificação.
    activityLogId: row.id,
    activityTable: row.table_name,
    activityCount: count,
    // Fluxo de aceite (js/normalize.js: integrarRegistro) — row_id é o id
    // do registro em `activityTable`, já vem pronto da trigger do banco
    // (v_id em _activity_log_capture), sem precisar abrir new_data.
    integrable: _activityIsIntegrable(row, count),
    integratedRowId: row.row_id,
    integrated: false,
  });
  // Cache local recente só pro dropdown — o histórico completo já vive
  // na nuvem (activity_log), então não precisa crescer pra sempre aqui.
  const ATIV_MAX_LOCAL = 200;
  let seen = 0;
  state.notifications = state.notifications.filter(n => {
    if (n.type !== 'atividade' && n.type !== 'auth') return true;
    seen++;
    return seen <= ATIV_MAX_LOCAL;
  });
  if (typeof persist === 'function') persist();

  _notifRenderBadge();
  if (_notifOpen) _notifRenderDropdown();

  notifShowActivityToast(title, body);
  notifPlaySound();
}

// ── Detalhe de atividade (modal, ao clicar numa notificação) ───────────
// Busca o registro completo no activity_log só na hora do clique (não fica
// guardado localmente por notificação) — a RLS de activity_log já libera
// pro dono OU pro ator OU pro admin, então funciona pra qualquer papel.
async function notifAbrirDetalheAtividade(notifId, event) {
  event?.stopPropagation();
  const n = (state.notifications||[]).find(x => x.id === notifId);
  if (!n || (n.type !== 'atividade' && n.type !== 'auth')) return;
  n.read = true;
  if (typeof persist==='function') persist();
  _notifRenderBadge();
  if (_notifOpen) _notifRenderDropdown();
  notifClose();

  const titleEl = document.getElementById('notif-detail-title');
  const bodyEl = document.getElementById('notif-detail-body');
  if (titleEl) titleEl.textContent = n.title;
  if (bodyEl) bodyEl.innerHTML = `<div class="empty-state"><i class="ti ti-loader"></i><p>Carregando detalhes...</p></div>`;
  if (typeof openModal === 'function') openModal('notif-detail-modal');

  if (!n.activityLogId || !window.supabaseClient) {
    if (bodyEl) bodyEl.innerHTML = `<p style="color:var(--text3);font-size:12.5px">Detalhe não disponível.</p>`;
    return;
  }

  const { data, error } = await window.supabaseClient
    .from('activity_log')
    .select('*')
    .eq('id', n.activityLogId)
    .maybeSingle();

  if (error || !data) {
    if (bodyEl) bodyEl.innerHTML = `<p style="color:var(--text3);font-size:12.5px">Não foi possível carregar os detalhes${error ? ' ('+_notifEsc(error.message)+')' : ' (registro não encontrado)'}.</p>`;
    return;
  }
  if (bodyEl) bodyEl.innerHTML = _notifRenderActivityDetail(n, data);
}

// Formata um valor de campo pro detalhe (mesmas regras de exibição usadas
// em "Dados por módulo" — array vira lista separada por vírgula, boolean
// vira Sim/Não, vazio vira travessão).
function _notifFmtCampoValor(v) {
  if (v === null || v === undefined || v === '') return '<span style="color:var(--text3)">—</span>';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (Array.isArray(v)) return _notifEsc(v.join(', '));
  if (typeof v === 'object') return _notifEsc(JSON.stringify(v));
  return _notifEsc(String(v));
}

const _ACTIVITY_OP_LABEL = { INSERT: 'Criação', UPDATE: 'Edição', DELETE: 'Exclusão' };

function _notifRenderActivityDetail(n, row) {
  if (row.table_name === 'auth') {
    const when = row.created_at ? new Date(row.created_at).toLocaleString('pt-BR') : '—';
    return `
      <div style="display:flex;flex-direction:column;gap:2px">
        <div style="font-size:13px">${_notifEsc(n.title)}</div>
        <div style="color:var(--text3);font-size:11.5px">${_notifEsc(when)}</div>
      </div>`;
  }
  const label = _activityModuleLabel(row.table_name);
  const opLabel = _ACTIVITY_OP_LABEL[row.operation] || row.operation;
  const when = row.created_at ? new Date(row.created_at).toLocaleString('pt-BR') : '—';
  const oldData = row.old_data || {};
  const newData = row.new_data || {};
  const keys = [...new Set([...Object.keys(oldData), ...Object.keys(newData)])]
    .filter(k => k !== 'id' && k !== 'user_id')
    .sort();

  const isUpdate = row.operation === 'UPDATE';
  const header = isUpdate
    ? `<tr><th style="font-size:11px;color:var(--text3);text-align:left;font-weight:600">Campo</th><th style="font-size:11px;color:var(--text3);text-align:left;font-weight:600">Antes</th><th style="font-size:11px;color:var(--text3);text-align:left;font-weight:600">Depois</th></tr>`
    : `<tr><th style="font-size:11px;color:var(--text3);text-align:left;font-weight:600">Campo</th><th colspan="2" style="font-size:11px;color:var(--text3);text-align:left;font-weight:600">Valor</th></tr>`;

  const rowsHtml = keys.map(k => {
    const before = oldData[k];
    const after = newData[k];
    if (row.operation === 'DELETE') {
      return `<tr><td style="color:var(--text3);font-size:11px;white-space:nowrap">${_notifEsc(k)}</td><td colspan="2">${_notifFmtCampoValor(before)}</td></tr>`;
    }
    if (row.operation === 'INSERT') {
      return `<tr><td style="color:var(--text3);font-size:11px;white-space:nowrap">${_notifEsc(k)}</td><td colspan="2">${_notifFmtCampoValor(after)}</td></tr>`;
    }
    const changed = JSON.stringify(before) !== JSON.stringify(after);
    return `<tr${changed ? ' style="background:color-mix(in srgb, var(--accent) 8%, transparent)"' : ''}>
      <td style="color:var(--text3);font-size:11px;white-space:nowrap">${_notifEsc(k)}</td>
      <td>${_notifFmtCampoValor(before)}</td>
      <td>${changed ? '<i class="ti ti-arrow-right" style="font-size:10px;color:var(--text3);margin-right:4px"></i>' : ''}${_notifFmtCampoValor(after)}</td>
    </tr>`;
  }).join('');

  const grupoAviso = n.activityCount > 1
    ? `<div style="font-size:11px;color:var(--text3);margin-bottom:12px;display:flex;align-items:center;gap:5px"><i class="ti ti-info-circle"></i> Esta notificação agrupa ${n.activityCount} alterações — mostrando a mais recente.</div>`
    : '';

  return `
    <div style="display:flex;flex-direction:column;gap:2px;margin-bottom:12px">
      <div style="font-size:13px"><strong>${_notifEsc(label)}</strong> — ${_notifEsc(opLabel)}</div>
      <div style="color:var(--text3);font-size:11.5px">${_notifEsc(when)}</div>
    </div>
    ${grupoAviso}
    <div style="overflow-x:auto;max-height:50vh;overflow-y:auto">
      <table style="width:100%;font-size:12px;border-collapse:collapse">
        <thead>${header}</thead>
        <tbody>${rowsHtml || `<tr><td colspan="3" style="color:var(--text3)">Sem dados de campo pra exibir.</td></tr>`}</tbody>
      </table>
    </div>`;
}


// Evita spam quando uma importação em lote de Materiais/Filiais (os
// únicos módulos que sincronizam também o importado, não só manual) gera
// muitas linhas de uma vez. Cada grupo tem seu próprio timer; só "estoura"
// numa notificação combinada quando fica ~2.5s sem novo evento do mesmo
// grupo. O activity_log continua guardando cada linha individualmente —
// o agrupamento é só da notificação visível, não do histórico.
const _activityBatchData   = new Map();
const _activityBatchTimers = new Map();
const ACTIVITY_BATCH_MS = 2500;

// Ocorrência de outro usuário que virou 'escalonamento'/'dai' pro Supervisor
// já ganha a notificação DEDICADA (ver notifPushOcorrenciaSupervisor,
// disparada por ocorrencias.js/_ocRealtimeInit) — sem este corte, o mesmo
// evento gerava as DUAS notificações (a genérica de atividade E a
// dedicada) pra mesma ocorrência (achado do usuário, 31/07). Reusa
// _ocMotivoRelevancia (ocorrencias.js) em vez de reimplementar a regra,
// pra nunca dessincronizar dos dois motivos que a notificação dedicada de
// fato cobre — 'proprio' (o próprio ADM é dono) e 'integrado' continuam só
// com a notificação genérica, já que a dedicada não existe pra eles.
async function _activityEhOcorrenciaPrioritariaParaMim(row) {
  if (window.currentUser?.role !== 'admin' || row.table_name !== 'ocorrencias') return false;
  const data = row.operation === 'DELETE' ? row.old_data : row.new_data;
  if (!data || typeof _ocMotivoRelevancia !== 'function') return false;
  const motivo = await _ocMotivoRelevancia(data);
  return motivo === 'escalonamento' || motivo === 'dai';
}

// Lado do DONO (31/07): quando o Supervisor escalona/conclui/marca
// inconclusiva/reabre/descalona a ocorrência de outra pessoa, o dono deve
// ver isso ESPECIFICAMENTE, não só "o administrador editou um registro".
// Usa old_data/new_data (só o activity_log tem os dois completos — o
// canal direto de `ocorrencias` só traz a PK no DELETE) pra descobrir o
// que mudou de verdade — ver _ocDetectarMudancaPrioritaria (ocorrencias.js).
// Edição "de campo" (central, descrição etc.) devolve null e cai na
// notificação genérica normalmente.
function _activityNotificarMudancaOcorrencia(row) {
  if (row.table_name !== 'ocorrencias' || row.operation !== 'UPDATE') return false;
  if (window.currentUser?.role === 'admin') return false; // esta é pro DONO, não pro Supervisor
  if (typeof _ocDetectarMudancaPrioritaria !== 'function') return false;
  const mudanca = _ocDetectarMudancaPrioritaria(row.old_data, row.new_data);
  if (!mudanca) return false;
  if (typeof notifPushMudancaOcorrencia === 'function') {
    notifPushMudancaOcorrencia({ ocorrenciaId: row.row_id, activityLogId: row.id, ...mudanca });
  }
  return true;
}

function notifPushMudancaOcorrencia({ ocorrenciaId, activityLogId, tipo, titulo, corpo }) {
  if (!Array.isArray(state.notifications)) state.notifications = [];
  state.notifications.unshift({
    id: `acao-supervisor-${activityLogId}`,
    type: 'acao-supervisor',
    level: 'critico',
    title: titulo,
    body: (corpo || '').slice(0, 140),
    createdAt: Date.now(),
    read: false,
    ocorrenciaId,
    _subtipo: tipo, // só pra depuração/telemetria futura — não usado no render
  });
  if (typeof persist === 'function') persist();
  _notifRenderBadge();
  if (_notifOpen) _notifRenderDropdown();
  notifShowActivityToast(titulo, corpo || '');
  notifPlaySound();
}

async function _activityQueueEvent(row) {
  if (!_activityShouldNotify(row)) return;
  if (await _activityEhOcorrenciaPrioritariaParaMim(row)) return;
  if (_activityNotificarMudancaOcorrencia(row)) return;
  const key = `${row.actor_id}|${row.table_name}|${row.operation}`;
  const entry = _activityBatchData.get(key) || { count: 0, sample: row };
  entry.count++;
  entry.sample = row;
  _activityBatchData.set(key, entry);

  clearTimeout(_activityBatchTimers.get(key));
  _activityBatchTimers.set(key, setTimeout(() => {
    const data = _activityBatchData.get(key);
    _activityBatchData.delete(key);
    _activityBatchTimers.delete(key);
    if (data) _activityEmitNotification(data.sample, data.count);
  }, ACTIVITY_BATCH_MS));
}

// ── Canal Realtime ────────────────────────────────────────
// Chamada no boot (dashboard.js, STEP 5) — idempotente via _activityChannel.
let _activityChannel = null;
function _activityRealtimeInit() {
  if (!window.supabaseClient || !window.currentUser || _activityChannel) return;
  _activityChannel = window.supabaseClient
    .channel('activity_log_notifications')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_log' },
      (payload) => { if (payload?.new) _activityQueueEvent(payload.new); })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('[Activity] Canal Realtime com problema:', status);
      }
    });
}
// Chamada em auth.js no evento SIGNED_OUT (sessão caindo sem reload da
// página) — o logout normal (signOut()) recarrega a página, o que já
// derruba o canal sozinho; este caminho cobre o caso sem reload.
function _activityRealtimeStop() {
  if (_activityChannel && window.supabaseClient) {
    window.supabaseClient.removeChannel(_activityChannel);
  }
  _activityChannel = null;
  _activityBatchTimers.forEach(t => clearTimeout(t));
  _activityBatchTimers.clear();
  _activityBatchData.clear();
  _activityUserCache = null;
}

// ═══════════════════════════════════════════════════════════
// ALERTA DO ADMINISTRADOR — broadcast pra todos os usuários
// ═══════════════════════════════════════════════════════════
// Sempre olha só o alerta mais recente (admin_alerts) — um novo alerta
// "substitui" o pendente por decisão do Hugo (04/08): não empilha fila.
// Quem confirma vira uma linha em admin_alert_confirmations, que já sai
// notificada pro ADM de graça via trg_activity_log (mesmo pipeline de
// activity_log usado pra qualquer outra tabela — ver _activityEmitNotification).
// Modelos prontos — cada um com ícone e cor própria (tokens já existentes
// em css/tokens.css, tema-aware). 'personalizado' é o padrão ao abrir o
// modal: canvas em branco, sem cor, pro ADM escrever livremente.
const ADMIN_ALERT_PRESETS = {
  personalizado: { label: 'Personalizado', icon: 'ti-pencil', color: 'var(--text2)', bg: 'var(--bg3)', border: 'var(--border2)', text: '' },
  reuniao: { label: 'Reunião', icon: 'ti-calendar-event', color: 'var(--accent)', bg: 'var(--accent-dim)', border: 'var(--accent)', text: 'Teremos uma reunião em breve. Fique atento ao horário e não deixe de participar.' },
  metas_semanal: { label: 'Metas · Semanal', icon: 'ti-target-arrow', color: 'var(--amber)', bg: 'var(--amber-bg)', border: 'var(--amber)', text: 'Lembrete semanal: analistas, cobrem dos operadores dos seus grupos as aferições e o lançamento dos estoques das usinas no sistema.' },
  metas_mensal: { label: 'Metas · Mensal', icon: 'ti-report-money', color: 'var(--red)', bg: 'var(--red-bg)', border: 'var(--red)', text: 'Fechamento mensal: analistas, cobrem dos operadores dos seus grupos as aferições e o lançamento dos estoques das usinas no sistema até o fechamento.' },
  atualizacao: { label: 'Atualização do Sistema', icon: 'ti-refresh', color: 'var(--purple)', bg: 'var(--purple-bg)', border: 'var(--purple)', text: 'O sistema está em atualização agora. Salve o que estiver fazendo imediatamente e evite novos lançamentos até o aviso de conclusão.' },
  comunicado: { label: 'Comunicado Geral', icon: 'ti-info-circle', color: 'var(--green)', bg: 'var(--green-bg)', border: 'var(--green)', text: 'Comunicado importante: ' },
};

let _adminAlertId = null;
let _adminAlertCountdownInterval = null;
let _adminAlertComposeCategoria = 'personalizado';

async function adminAlertCheckPendente() {
  if (!window.supabaseClient || !window.currentUser) return;
  try {
    const { data: alerta } = await window.supabaseClient
      .from('admin_alerts').select('id, message, category, created_by')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!alerta || alerta.created_by === window.currentUser.id) return; // sem alerta, ou é o próprio ADM que enviou
    const { data: conf } = await window.supabaseClient
      .from('admin_alert_confirmations').select('id')
      .eq('alert_id', alerta.id).eq('user_id', window.currentUser.id).maybeSingle();
    if (!conf) _adminAlertShow(alerta);
  } catch (e) { console.warn('[Alerta] Falha ao checar alerta pendente:', e); }
}

function _adminAlertShow(alerta) {
  _adminAlertId = alerta.id;
  const preset  = ADMIN_ALERT_PRESETS[alerta.category] || ADMIN_ALERT_PRESETS.personalizado;
  const overlay = document.getElementById('admin-alert-overlay');
  overlay?.style?.setProperty('--cat-color', preset.color);
  overlay?.style?.setProperty('--cat-bg', preset.bg);
  overlay?.style?.setProperty('--cat-border', preset.border);
  const icon = document.getElementById('admin-alert-icon');
  if (icon) icon.className = 'ti ' + preset.icon;
  const titulo = document.getElementById('admin-alert-titulo');
  if (titulo) titulo.textContent = preset === ADMIN_ALERT_PRESETS.personalizado ? 'Alerta do administrador' : preset.label;
  const msgEl = document.getElementById('admin-alert-message');
  if (msgEl) msgEl.textContent = alerta.message;
  const btn = document.getElementById('admin-alert-confirm-btn');
  if (btn) btn.disabled = true;
  overlay?.classList.add('open');

  const deadline = Date.now() + 5000;
  clearInterval(_adminAlertCountdownInterval);
  _adminAlertCountdownInterval = setInterval(() => {
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    const el = document.getElementById('admin-alert-countdown');
    if (el) el.textContent = String(remaining);
    if (remaining <= 0) {
      clearInterval(_adminAlertCountdownInterval);
      _adminAlertCountdownInterval = null;
      if (btn) btn.disabled = false;
    }
  }, 250);
}

async function adminAlertConfirmar() {
  const alertId = _adminAlertId;
  if (!alertId || !window.supabaseClient || !window.currentUser) return;
  try {
    await window.supabaseClient.from('admin_alert_confirmations')
      .insert({ alert_id: alertId, user_id: window.currentUser.id });
  } catch (e) { console.warn('[Alerta] Falha ao registrar confirmação:', e); }
  document.getElementById('admin-alert-overlay')?.classList.remove('open');
  _adminAlertId = null;
}

// ADM abre o modal de composição — grade de modelos renderizada a partir
// de ADMIN_ALERT_PRESETS, sempre começando em 'personalizado' (em branco).
function adminAlertAbrirCompose() {
  _adminAlertComposeCategoria = 'personalizado';
  const grid = document.getElementById('admin-alert-preset-grid');
  if (grid) {
    grid.innerHTML = Object.entries(ADMIN_ALERT_PRESETS).map(([key, p]) => `
      <button type="button" class="admin-alert-preset-chip${key === 'personalizado' ? ' active' : ''}" data-cat="${key}"
        style="--cat-color:${p.color};--cat-bg:${p.bg};--cat-border:${p.border}"
        onclick="adminAlertSelecionarPreset('${key}')">
        <i class="ti ${p.icon}"></i> ${_notifEsc(p.label)}
      </button>`).join('');
  }
  const text = document.getElementById('admin-alert-compose-text');
  if (text) text.value = '';
  document.getElementById('admin-alert-compose-overlay')?.classList.add('open');
}

function adminAlertSelecionarPreset(key) {
  _adminAlertComposeCategoria = key;
  document.querySelectorAll('#admin-alert-preset-grid .admin-alert-preset-chip')
    .forEach(el => el.classList.toggle('active', el.dataset.cat === key));
  const preset = ADMIN_ALERT_PRESETS[key];
  const text = document.getElementById('admin-alert-compose-text');
  if (text && preset?.text) text.value = preset.text;
}

function adminAlertFecharCompose() {
  document.getElementById('admin-alert-compose-overlay')?.classList.remove('open');
}

async function adminAlertEnviar() {
  if (!window.supabaseClient || !window.currentUser) return;
  const text = document.getElementById('admin-alert-compose-text');
  const msg  = (text?.value || '').trim();
  if (!msg) { if (typeof toast === 'function') toast('Escreva uma mensagem antes de enviar.', 'error'); return; }
  const btn = document.getElementById('admin-alert-compose-send-btn');
  if (btn) btn.disabled = true;
  try {
    const { error } = await window.supabaseClient.from('admin_alerts')
      .insert({ message: msg, category: _adminAlertComposeCategoria, created_by: window.currentUser.id });
    if (error) throw error;
    if (typeof toast === 'function') toast('Alerta enviado a todos os usuários.', 'success');
    adminAlertFecharCompose();
  } catch (e) {
    console.warn('[Alerta] Falha ao enviar:', e);
    if (typeof toast === 'function') toast('Falha ao enviar alerta.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

let _adminAlertChannel = null;
function adminAlertRealtimeInit() {
  if (!window.supabaseClient || !window.currentUser || _adminAlertChannel) return;
  _adminAlertChannel = window.supabaseClient
    .channel('admin_alerts_realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'admin_alerts' },
      () => { adminAlertCheckPendente(); })
    .subscribe();
}
function adminAlertRealtimeStop() {
  if (_adminAlertChannel && window.supabaseClient) window.supabaseClient.removeChannel(_adminAlertChannel);
  _adminAlertChannel = null;
}

Object.assign(window,{
  notifToggle,notifClose,notifOpen,
  notifMarkRead,notifMarkAllRead,notifNavigate,notifIntegrar,
  notifSync,notifBoot,notifUpdateFromAnalytico,notifSilentHealthCheck,
  notifPlaySound,notifShowActivityToast,notifHideActivityToast,
  notifAbrirDetalheAtividade,
  notifPushOcorrenciaSupervisor,notifAbrirOcorrenciaPrioritaria,notifPushMudancaOcorrencia,
  _activityRealtimeInit,_activityRealtimeStop,
  adminAlertCheckPendente,adminAlertConfirmar,adminAlertEnviar,
  adminAlertAbrirCompose,adminAlertSelecionarPreset,adminAlertFecharCompose,
  adminAlertRealtimeInit,adminAlertRealtimeStop,
});
