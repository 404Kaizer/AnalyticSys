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
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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

// ── Sincroniza state.notifications ───────────────────────
function notifSync(healthScores) {
  if (!Array.isArray(state.notifications)) state.notifications = [];
  const expected    = _notifCompute(healthScores);
  const expectedIds = new Set(expected.map(n=>n.id));

  // Remove as que não se aplicam mais
  state.notifications = state.notifications.filter(n=>expectedIds.has(n.id));

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

    await new Promise(r => setTimeout(r, 0));
    const results = buildDashboardGerencialResults(dtIni, dtFim);
    if (!results?.length) { notifSync(null); return; }
    await new Promise(r => setTimeout(r, 0));

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
          const prev  = typeof getPrePeriodLaunchStock==='function'
            ? getPrePeriodLaunchStock({central:r.central,material:mat,dtIni,dtFim}) : null;
          const snap  = buildSnapshot({lancs,sap,initialStockOverride:prev?.value??null});
          const rawCat = ((lancs[0]||sap[0])?.categoria||'').trim().toUpperCase();
          const catKey = detectCatKey(rawCat)||(typeof detectCatFromMat==='function'?detectCatFromMat(mat):null);
          const level  = classifyVariation(Math.abs(snap.diff), catKey, thresholds);
          matCounts[level]++;
          return {diff:snap.diff, catKey};
        });
        const {level: centralLevel} = calcHealthScore(matDiffs, null, null, thresholds);
        centralCounts[(!centralLevel||centralLevel==='ok') ? 'bom' : centralLevel]++;
      });
      await new Promise(r => setTimeout(r, 0)); // yield entre batches
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
};

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
    const hasRoute = !!_NOTIF_ROUTE[n.id];
    return `<div class="notif-item${n.read?' notif-item-read':''}${hasRoute?' notif-item-clickable':''}"
      data-id="${_notifEsc(n.id)}"
      ${hasRoute?`onclick="notifNavigate('${_notifEsc(n.id)}',event)"`:''}>
      <div class="notif-item-icon" style="background:${lm.col}18;color:${lm.col};border:1px solid ${lm.col}30"><i class="ti ${tm.icon}"></i></div>
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
  _notifRenderBadge();
  // Delay generoso — o cálculo silencioso de saúde é pesado (percorre todos os dados).
  // Só executa quando o browser está ocioso para não travar a UI logo após o boot.
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => notifSilentHealthCheck(), { timeout: 10000 });
  } else {
    setTimeout(() => notifSilentHealthCheck(), 5000);
  }
}

Object.assign(window,{
  notifToggle,notifClose,notifOpen,
  notifMarkRead,notifMarkAllRead,notifNavigate,
  notifSync,notifBoot,notifUpdateFromAnalytico,notifSilentHealthCheck,
});
