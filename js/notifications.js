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
  info:   { col:'#3b82f6',      icon:'ti-info-circle',    label:'Info'    },
};
const _NTM = {
  saude:      { icon:'ti-heartbeat'      },
  ocorrencia: { icon:'ti-alert-circle'   },
  conferencia:{ icon:'ti-calendar-event' },
  atividade:  { icon:'ti-bolt'           },
  auth:       { icon:'ti-fingerprint'    },
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
  producao:    'var(--purple)',
  sap:         'var(--accent)',
  imports:     'var(--teal)',
  profiles:    'var(--red)',
};
const _ACTIVITY_DEFAULT_COLOR = 'var(--text2)';
const _AUTH_COLOR = 'var(--accent)';

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
    const iconCol = n.type === 'auth' ? _AUTH_COLOR
      : n.type === 'atividade' ? (_ACTIVITY_MODULE_COLOR[n.activityTable] || _ACTIVITY_DEFAULT_COLOR)
      : lm.col;
    const hasRoute = isAtividade ? !!n.activityLogId : !!_NOTIF_ROUTE[n.id];
    const clickAttr = !hasRoute ? '' : isAtividade
      ? `onclick="notifAbrirDetalheAtividade('${_notifEsc(n.id)}',event)"`
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
      ${!n.read?`<button class="notif-mark-btn" onclick="notifMarkRead('${_notifEsc(n.id)}',event)" title="Marcar como lida"><i class="ti ti-check"></i></button>`:''}
    </div>`;
  }).join('');
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
  state.notifications = state.notifications.filter(n => n.type !== 'atividade' || !n.read);
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

async function _activityEmitNotification(row, count) {
  const isAuth      = row.table_name === 'auth';
  const actorLabel  = await _activityResolveActorLabel(row.actor_id);

  let title, body;
  if (isAuth) {
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

function _activityQueueEvent(row) {
  if (!_activityShouldNotify(row)) return;
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

Object.assign(window,{
  notifToggle,notifClose,notifOpen,
  notifMarkRead,notifMarkAllRead,notifNavigate,
  notifSync,notifBoot,notifUpdateFromAnalytico,notifSilentHealthCheck,
  notifPlaySound,notifShowActivityToast,notifHideActivityToast,
  notifAbrirDetalheAtividade,
  _activityRealtimeInit,_activityRealtimeStop,
});
