// ═══════════════════════════════════════════════════════════
// VISÃO PENDÊNCIAS — Dashboard Analítico
// ═══════════════════════════════════════════════════════════
// Terceira aba do Analítico (ao lado de Visão Micro / Visão Inventário).
// Responde a uma pergunta operacional só: "no período do cabeçalho, o que
// cada central está devendo?". Três tipos de pendência, cada um com sua
// própria tabela Central | Material | Pendências:
//
//   OS (SAÍDAS)      → saída com OS que não aparece no SAP (mov. 201)
//   NF (ENTRADAS)    → entrada com NF que não aparece no SAP (mov. 101/801)
//   ESTOQUE (LANÇ.)  → dia esperado sem lançamento de estoque
//
// NADA aqui recalcula pendência do zero — os três números já existiam no
// sistema e são apenas reagrupados:
//   • OS/NF   → window._pendCache[central] = { pendNF, pendOS }, populado por
//               buildPendIntegSection (ui.js) durante o render da Visão Micro.
//               Fallback para calcPendentesIntegracao quando o cache não
//               tiver a central (ex.: aba aberta antes do micro renderizar).
//   • ESTOQUE → _ausComputar(dtIni, dtFim) (dashboard.js), a mesma função do
//               painel de Ausências do Dashboard Gerencial — inclusive a
//               regra de dia esperado (diário exceto domingo; terças para
//               Agregado; último dia útil do mês sempre).
//
// O botão "Considerar" reaproveita 100% o mecanismo que já existia nos chips
// dos cards da Visão Micro (togglePendConsiderados, ui.js): injeta as NFs/OS
// pendentes como movimentações SAP sintéticas, o que se propaga sozinho para
// as tabelas da Micro E para os dois donuts + rankings de criticidade (via
// renderMacroPanels, chamado no fim de refreshCentralCard). Por isso o
// estado é por CENTRAL, e não por central+material: é o mesmo estado
// compartilhado com os chips do card, sem uma segunda fonte da verdade.

// ── Cache por período ────────────────────────────────────────────────────
// Derrubado por _pendViewInvalidate, chamado no início de cada
// _rodarAnaliticoCore (analitico.js) — período novo = dados novos.
const _pendView = {
  key:  '',    // 'ISO|ISO' do período já computado
  os:   null,  // [{ central, regional, materiais: [{ material, items }], total }]
  nf:   null,
  est:  null,  // idem, mas materiais: [{ material, dias: Date[] }]
};

// Estado do modal GERAL. Declarado aqui, e não junto do código do modal lá
// embaixo, porque _pendViewInvalidate (logo abaixo) mexe nele — const em TDZ
// explodiria se a invalidação chegasse antes da declaração.
const _pgmState = {
  tab:    'OS',                    // 'OS' | 'NF' | 'EST'
  month:  { OS: 'periodo', NF: 'periodo' },
  search: '',
  items:  { OS: null, NF: null },  // histórico completo, lazy
  collapsed: {},                   // 'ABA:bloco' → true quando recolhido
  estLinhas: [],                   // linhas da aba Estoque, p/ o tooltip do "+N"
};

function _pendViewInvalidate() {
  _pendView.key = '';
  _pendView.os = _pendView.nf = _pendView.est = null;
  // Histórico completo do modal GERAL também é derrubado: uma nova análise é
  // o momento em que os dados de Entradas/Saídas/SAP podem ter mudado.
  _pgmState.items = { OS: null, NF: null };
  // Esconde o contador durante a análise — número do período antigo em tela
  // enquanto o novo é calculado seria pior do que número nenhum. Ele volta no
  // fim de renderAnaliticoMicro, via pendAtualizarContadorAba.
  const badge = document.getElementById('an-view-btn-pend-count');
  if (badge) badge.style.display = 'none';
}
window._pendViewInvalidate = _pendViewInvalidate;

function _pendPeriodo() {
  const dtIni = window.__analiticoDtIni;
  const dtFim = window.__analiticoDtFim;
  if (!(dtIni instanceof Date) || !(dtFim instanceof Date)) return null;
  return { dtIni, dtFim, key: localISODate(dtIni) + '|' + localISODate(dtFim) };
}

function _pendRegionalDe(central) {
  const f = getFilialLookupIndex().exact.get(normalizeText(central));
  return (f?.regional || '').trim() || 'Sem regional';
}

// ═══════════════════════════════════════════════════════════
// AGRUPAMENTO
// ═══════════════════════════════════════════════════════════

/**
 * Reagrupa as pendências de integração SAP (OS ou NF) por central → material.
 * Fonte: window._pendCache (populado pela Visão Micro). Se alguma central do
 * resultado da análise não estiver no cache, calcula sob demanda com a mesma
 * função dos cards, e grava no cache — assim o botão "Considerar" dessa
 * central funciona igual às demais (togglePendConsiderados lê _pendCache).
 *
 * @param {'os'|'nf'} tipo
 */
function _pendAgruparInteg(tipo) {
  const per = _pendPeriodo();
  if (!per) return [];
  const results = window.__analiticoResults || [];
  window._pendCache = window._pendCache || {};

  // Pré-agrupa Entradas por central com a MESMA prioridade de
  // calcPendentesIntegracao (centralCompra, fallback centralDestino) — só
  // usado no caminho de fallback, mas montar uma vez evita O(centrais × registros).
  let entradasByCentral = null;
  const getEntradas = (central) => {
    if (!entradasByCentral) {
      entradasByCentral = new Map();
      (state.entradas || []).forEach(e => {
        const c = e.centralCompra || e.centralDestino || '';
        if (!entradasByCentral.has(c)) entradasByCentral.set(c, []);
        entradasByCentral.get(c).push(e);
      });
    }
    return entradasByCentral.get(central) || [];
  };

  const grupos = [];
  results.forEach(r => {
    const central = r.central;
    let cache = window._pendCache[central];
    if (!cache) {
      cache = calcPendentesIntegracao({
        central,
        dtIni: per.dtIni,
        dtFim: per.dtFim,
        sapNoPeriodo: r.sapNoPeriodo || [],
        entradasDaCentral: getEntradas(central),
      });
      window._pendCache[central] = cache;
    }

    const items = (tipo === 'nf' ? cache.pendNF : cache.pendOS) || [];
    if (!items.length) return;

    const porMat = new Map();
    items.forEach(it => {
      const mat = it.material || '—';
      if (!porMat.has(mat)) porMat.set(mat, []);
      porMat.get(mat).push(it);
    });

    // Só contagem aqui — o total em peso fica no modal GERAL, que agrupa por
    // material+UM (somar OS de UM diferentes sob um total só seria mentira).
    const materiais = [...porMat.entries()]
      .map(([material, its]) => ({ material, items: its }))
      .sort((a, b) => b.items.length - a.items.length || a.material.localeCompare(b.material, 'pt-BR'));

    grupos.push({
      central,
      regional: _pendRegionalDe(central),
      materiais,
      total: items.length,
    });
  });

  return grupos.sort((a, b) => b.total - a.total || a.central.localeCompare(b.central, 'pt-BR'));
}

/**
 * Reagrupa as ausências de lançamento por central → material.
 * Fonte: _ausComputar (dashboard.js), a mesma do painel de Ausências.
 */
function _pendAgruparEstoque() {
  const per = _pendPeriodo();
  if (!per || typeof _ausComputar !== 'function') return [];

  const porCentral = new Map();
  _ausComputar(per.dtIni, per.dtFim).forEach(a => {
    if (!a.diasAusentes?.length) return;
    if (!porCentral.has(a.central)) {
      porCentral.set(a.central, { central: a.central, regional: a.regional || _pendRegionalDe(a.central), materiais: [], total: 0 });
    }
    const g = porCentral.get(a.central);
    g.materiais.push({
      material:   a.mat,
      dias:       a.diasAusentes,
      categoria:  a.categoria || '—',
      semCadastro: !!a.semCadastro,
      estoqueZerado: !!a.estoqueZerado,
    });
    g.total += a.diasAusentes.length;
  });

  const grupos = [...porCentral.values()];
  grupos.forEach(g => g.materiais.sort((a, b) =>
    b.dias.length - a.dias.length || a.material.localeCompare(b.material, 'pt-BR')));
  return grupos.sort((a, b) => b.total - a.total || a.central.localeCompare(b.central, 'pt-BR'));
}

/**
 * Só OS/NF — o lado BARATO. Os dois vêm de _pendCache, que a Visão Micro já
 * deixou pronto: é reagrupamento de array em memória, sem varredura de dia.
 * Por isso o contador da aba pode chamar isto ao fim de toda análise.
 */
function _pendEnsureInteg() {
  const per = _pendPeriodo();
  if (!per) return false;
  if (_pendView.key !== per.key) {
    _pendView.key = per.key;
    _pendView.os = _pendView.nf = _pendView.est = null;
  }
  if (!_pendView.os) _pendView.os = _pendAgruparInteg('os');
  if (!_pendView.nf) _pendView.nf = _pendAgruparInteg('nf');
  return true;
}

/**
 * OS/NF + ESTOQUE. O estoque é o lado CARO (_ausComputar percorre cada par
 * central×material dia a dia do período), então só entra aqui — no caminho de
 * quem abriu a aba de fato.
 */
function _pendEnsureDados() {
  if (!_pendEnsureInteg()) return false;
  if (!_pendView.est) _pendView.est = _pendAgruparEstoque();
  return true;
}

// ═══════════════════════════════════════════════════════════
// RENDER DAS 3 TABELAS
// ═══════════════════════════════════════════════════════════

// Os handlers inline recebem ÍNDICES (grupo, material) em vez dos nomes de
// central/material: nome vira string dentro de um atributo onclick, e aí
// qualquer aspa/barra invertida no cadastro quebraria o JS. Índice é número,
// não tem como quebrar — e os arrays são exatamente os que acabaram de
// renderizar a tabela.

/** Rótulo/estado do botão "Considerar" de uma central. */
function _pendConsiderarBtn(central, tipo, gi) {
  const on = !!(window._pendConsiderados || {})[central]?.[tipo];
  return `<button class="pv-consider-btn${on ? ' is-on' : ''}" type="button"
    data-pv-consider="${tipo}" data-pv-central="${escapeHtml(central)}"
    onclick="pendConsiderar('${tipo}',${gi})"
    title="Considerar/desconsiderar as ${tipo.toUpperCase()} pendentes desta central no cálculo do Analítico (afeta as tabelas da Visão Micro e os donuts)">
    <i class="ti ${on ? 'ti-checkbox' : 'ti-square'}"></i> ${on ? 'Considerado' : 'Considerar'}
  </button>`;
}

/** Célula de central (com rowspan) compartilhada pelas três tabelas. */
const _pendCelulaCentral = (g) => `<td class="pv-central-cell" rowspan="${g.materiais.length}">
  <span class="pv-central-name">${escapeHtml(g.central)}</span>
  <span class="pv-central-reg">${escapeHtml(g.regional)}</span>
</td>`;

/** Tabela de OS ou NF: Central | Material | Pendências | Considerar. */
function _pendTabelaInteg(grupos, tipo) {
  if (!grupos.length) {
    return `<div class="pv-empty"><i class="ti ti-circle-check"></i><span>Nenhuma ${tipo.toUpperCase()} pendente no período</span></div>`;
  }
  const cls = tipo === 'nf' ? 'pv-badge-nf' : 'pv-badge-os';
  const rows = grupos.map((g, gi) => g.materiais.map((m, mi) => `
    <tr>
      ${mi === 0 ? _pendCelulaCentral(g) : ''}
      <td class="pv-mat-cell" title="${escapeHtml(m.material)}">${escapeHtml(m.material)}</td>
      <td class="pv-badge-cell">
        <button class="pv-badge ${cls}" type="button"
          onclick="pendOpenDetalhe('${tipo}',${gi},${mi})"
          title="Ver o detalhamento das ${m.items.length} ${tipo.toUpperCase()} pendentes deste material">${m.items.length}</button>
      </td>
      ${mi === 0 ? `<td class="pv-consider-cell" rowspan="${g.materiais.length}">${_pendConsiderarBtn(g.central, tipo, gi)}</td>` : ''}
    </tr>`).join('')).join('');

  return `<table class="pv-table">
    <thead><tr>
      <th>Central</th><th>Material</th>
      <th style="text-align:center">Pendências</th>
      <th style="text-align:center">Considerar</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

/** Tabela de ESTOQUE: Central | Material | Pendências (dias sem lançamento). */
function _pendTabelaEstoque(grupos) {
  if (!grupos.length) {
    return `<div class="pv-empty"><i class="ti ti-circle-check"></i><span>Nenhum dia sem lançamento no período</span></div>`;
  }
  const rows = grupos.map((g, gi) => g.materiais.map((m, mi) => `
    <tr>
      ${mi === 0 ? _pendCelulaCentral(g) : ''}
      <td class="pv-mat-cell" title="${escapeHtml(m.material)}">${escapeHtml(m.material)}${m.semCadastro ? ' <span class="pv-tag-warn" title="Material sem cadastro — regra diária aplicada por padrão">sem cadastro</span>' : ''}</td>
      <td class="pv-badge-cell">
        <button class="pv-badge pv-badge-est" type="button"
          onclick="pendOpenDetalhe('est',${gi},${mi})"
          title="Ver as ${m.dias.length} datas sem lançamento deste material">${m.dias.length}</button>
      </td>
    </tr>`).join('')).join('');

  return `<table class="pv-table">
    <thead><tr>
      <th>Central</th><th>Material</th>
      <th style="text-align:center">Pendências</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

/** Ponto de entrada da aba — chamado por anSwitchView (analitico.js). */
function renderPendenciasView() {
  const empty   = document.getElementById('pv-empty');
  const content = document.getElementById('pv-content');
  if (!empty || !content) return;

  const per = _pendPeriodo();
  if (!per || !window.__analiticoResults) {
    empty.style.display = '';
    content.style.display = 'none';
    return;
  }

  _pendEnsureDados();
  empty.style.display = 'none';
  content.style.display = '';

  const lbl = document.getElementById('pv-periodo-label');
  if (lbl) lbl.textContent = `${fmtPtDate(per.dtIni)} — ${fmtPtDate(per.dtFim)}`;

  const totOS  = _pendView.os.reduce((a, g) => a + g.total, 0);
  const totNF  = _pendView.nf.reduce((a, g) => a + g.total, 0);
  const totEst = _pendView.est.reduce((a, g) => a + g.total, 0);

  const setCount = (id, n, sufixo) => {
    const el = document.getElementById(id);
    if (el) el.textContent = `${n} ${sufixo}${n === 1 ? '' : 's'}`;
  };
  setCount('pv-count-os',  totOS,  'pendência');
  setCount('pv-count-nf',  totNF,  'pendência');
  setCount('pv-count-est', totEst, 'dia');

  document.getElementById('pv-body-os').innerHTML  = _pendTabelaInteg(_pendView.os, 'os');
  document.getElementById('pv-body-nf').innerHTML  = _pendTabelaInteg(_pendView.nf, 'nf');
  document.getElementById('pv-body-est').innerHTML = _pendTabelaEstoque(_pendView.est);

  pendAtualizarContadorAba();
  _pendSyncConsiderarUI();
}
window.renderPendenciasView = renderPendenciasView;

/**
 * Contador da aba "Visão Pendências" — chamado ao fim de toda análise
 * (renderAnaliticoMicro), sem precisar que o usuário abra a aba.
 *
 * O NÚMERO É SÓ OS + NF, de propósito: esses dois saem de _pendCache, que já
 * está pronto nesse momento, enquanto os dias sem lançamento exigem
 * _ausComputar (caro demais pra rodar em toda análise por causa de um badge).
 * Manter o número fixo em OS+NF também evita que ele PULE quando o usuário
 * entra na aba e o estoque finalmente é levantado — o total de estoque entra
 * no title, assim que existir, em vez de mexer no número.
 */
function pendAtualizarContadorAba() {
  const badge = document.getElementById('an-view-btn-pend-count');
  const btn   = document.getElementById('an-view-btn-pendencias');
  if (!badge) return;

  if (!_pendEnsureInteg()) { badge.style.display = 'none'; return; }

  const totOS = _pendView.os.reduce((a, g) => a + g.total, 0);
  const totNF = _pendView.nf.reduce((a, g) => a + g.total, 0);
  const tot   = totOS + totNF;

  badge.textContent   = tot;
  badge.style.display = tot ? '' : 'none';

  if (btn) {
    const est = _pendView.est ? _pendView.est.reduce((a, g) => a + g.total, 0) : null;
    btn.title = `${totOS} OS e ${totNF} NF${totNF === 1 ? '' : 's'} sem integração SAP no período` + (est === null
      ? ' · os dias sem lançamento de estoque são levantados ao abrir a aba'
      : ` · ${est} dia${est === 1 ? '' : 's'} sem lançamento de estoque`);
  }
}
window.pendAtualizarContadorAba = pendAtualizarContadorAba;

// ═══════════════════════════════════════════════════════════
// "CONSIDERAR" — reaproveita o estado dos chips da Visão Micro
// ═══════════════════════════════════════════════════════════

/** Sincroniza o visual de todos os botões Considerar (linhas + barra). */
function _pendSyncConsiderarUI() {
  const estado = window._pendConsiderados || {};

  document.querySelectorAll('#pv-content [data-pv-consider]').forEach(btn => {
    const on = !!estado[btn.dataset.pvCentral]?.[btn.dataset.pvConsider];
    btn.classList.toggle('is-on', on);
    btn.innerHTML = `<i class="ti ${on ? 'ti-checkbox' : 'ti-square'}"></i> ${on ? 'Considerado' : 'Considerar'}`;
  });

  ['nf', 'os'].forEach(tipo => {
    const grupos = tipo === 'nf' ? _pendView.nf : _pendView.os;
    const btn   = document.getElementById(`pv-consider-all-${tipo}`);
    const label = document.getElementById(`pv-consider-all-${tipo}-label`);
    if (!btn || !label || !grupos) return;
    const todas = grupos.length > 0 && grupos.every(g => !!estado[g.central]?.[tipo]);
    btn.classList.toggle('is-on', todas);
    btn.disabled = !grupos.length;
    label.textContent = todas
      ? `Desconsiderar todas as ${tipo.toUpperCase()}`
      : `Considerar todas as ${tipo.toUpperCase()}`;
  });
}

/** Toggle de UMA central — delega para o mecanismo já existente em ui.js. */
function pendConsiderar(tipo, gi) {
  const g = (tipo === 'nf' ? _pendView.nf : _pendView.os)?.[gi];
  if (!g || typeof togglePendConsiderados !== 'function') return;
  togglePendConsiderados(g.central, tipo);
  _pendSyncConsiderarUI();
}
window.pendConsiderar = pendConsiderar;

/**
 * Liga (ou desliga, se já estiverem todas ligadas) o "Considerar" de TODAS as
 * centrais com pendência do tipo. Escreve o estado direto e refaz cada card
 * com skipMacro — os donuts/rankings são recalculados UMA vez no fim, em vez
 * de uma vez por central.
 */
function pendConsiderarTodas(tipo) {
  const grupos = tipo === 'nf' ? _pendView.nf : _pendView.os;
  if (!grupos || !grupos.length) return;

  window._pendConsiderados = window._pendConsiderados || {};
  const estado = window._pendConsiderados;
  const alvo = !grupos.every(g => !!estado[g.central]?.[tipo]);

  grupos.forEach(g => {
    if (!estado[g.central]) estado[g.central] = { nf: false, os: false };
    if (estado[g.central][tipo] === alvo) return; // já está no estado desejado
    estado[g.central][tipo] = alvo;
    if (typeof refreshCentralCard === 'function') refreshCentralCard(g.central, { skipMacro: true });
  });

  if (typeof renderMacroPanels === 'function' && window.__analiticoResults) {
    const th = typeof getHealthThresholds === 'function' ? getHealthThresholds() : {};
    renderMacroPanels(window.__analiticoResults, th, window.__analiticoDtIni, window.__analiticoDtFim);
  }

  _pendSyncConsiderarUI();
  if (typeof toast === 'function') {
    toast(`${tipo.toUpperCase()} pendentes ${alvo ? 'consideradas' : 'desconsideradas'} em ${grupos.length} ${grupos.length === 1 ? 'central' : 'centrais'}`);
  }
}
window.pendConsiderarTodas = pendConsiderarTodas;

// ═══════════════════════════════════════════════════════════
// MODAL DE DETALHAMENTO (badge da coluna Pendências)
// ═══════════════════════════════════════════════════════════

/**
 * OS/NF: reaproveita o modal de pendentes de integração já existente
 * (openPendIntegModal, ui.js) — que traz busca, pills de mês, paginação e
 * resumo por material prontos. Ele lê os dados do dataset do elemento
 * acionador, então basta montar um trigger avulso (nunca inserido no DOM).
 *
 * ESTOQUE: modal próprio listando as datas sem lançamento, no padrão
 * alert-modal-* já usado em Conflitos/Inventário/Pendências de padronização.
 */
function pendOpenDetalhe(tipo, gi, mi) {
  const grupos = tipo === 'nf' ? _pendView.nf : tipo === 'os' ? _pendView.os : _pendView.est;
  const g = (grupos || [])[gi];
  const m = g?.materiais?.[mi];
  if (!m) return;
  const central  = g.central;
  const material = m.material;

  if (tipo === 'est') return _pendModalDatas(central, m);

  const items = m.items.map(r => tipo === 'nf'
    ? { nf: r.nf, material: r.material || '—', peso: r.peso || 0, um: r.um || 'kg',
        dtEmissao: r.dtEmissao || '—', dtDescarga: r.dtDescarga || '—', fornecedor: r.fornecedor || '—' }
    : { os: r.os, material: r.material || '—', peso: r.peso || 0, um: r.um || 'kg',
        dtEmissao: r.dtEmissao || '—', fornecedor: r.fornecedor || '—' });

  const trigger = document.createElement('span');
  trigger.dataset.tipo    = tipo.toUpperCase();
  trigger.dataset.central = `${central} · ${material}`;
  trigger.dataset.items   = encodeURIComponent(JSON.stringify(items));
  openPendIntegModal(trigger);
}
window.pendOpenDetalhe = pendOpenDetalhe;

/** Modal com as datas em que o estoque de um central+material ficou sem lançamento. */
function _pendModalDatas(central, m) {
  document.getElementById('alert-modal-pend-datas')?.remove();

  const chips = m.dias.map(d => {
    const dow = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][d.getDay()];
    return `<span class="pv-date-chip"><b>${fmtPtDate(d)}</b><span>${dow}</span></span>`;
  }).join('');

  const overlay = document.createElement('div');
  overlay.id = 'alert-modal-pend-datas';
  overlay.className = 'alert-modal-overlay';
  const onEsc = (e) => {
    if (!document.body.contains(overlay)) { document.removeEventListener('keydown', onEsc); return; }
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc); }
  };
  document.addEventListener('keydown', onEsc);
  overlay.innerHTML = `
    <div class="alert-modal-card">
      <div class="alert-modal-header">
        <div>
          <div class="alert-modal-title is-amber"><i class="ti ti-clipboard-off"></i> Estoque sem lançamento — ${escapeHtml(central)}</div>
          <div class="alert-modal-sub">${escapeHtml(m.material)} · ${m.dias.length} ${m.dias.length === 1 ? 'data' : 'datas'} esperada${m.dias.length === 1 ? '' : 's'} sem lançamento${m.estoqueZerado ? ' · estoque considerado zerado' : ''}</div>
        </div>
        <button class="alert-modal-close" onclick="document.getElementById('alert-modal-pend-datas').remove()"><i class="ti ti-x"></i></button>
      </div>
      <div class="alert-modal-body"><div class="pv-date-grid">${chips}</div></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

// ═══════════════════════════════════════════════════════════
// MODAL "GERAL" — 3 abas com informações completas
// ═══════════════════════════════════════════════════════════
// Escopo (decisão do Hugo): abre no período do cabeçalho e oferece pills de
// mês para expandir. As abas OS/NF varrem TODO o histórico (mesma função dos
// botões globais de Entradas/Saídas), então "Todos" é um recorte real. A aba
// ESTOQUE fica presa ao período do cabeçalho: "dia esperado sem lançamento"
// só existe dentro de uma janela fechada, não dá pra derivar sem recalcular.

const _PGM_MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
// ponytail: teto de linhas do detalhamento — sem paginação própria, o modal
// depende da busca/pills pra afunilar. Upgrade: reaproveitar a paginação de
// _pimRender (ui.js) se alguém reclamar do corte.
const _PGM_MAX_ROWS = 800;
// Chips de data exibidos em linha na aba Estoque; o excedente vai pro "+N".
const _PGM_MAX_CHIPS = 5;

/** 'YYYY-MM' de uma data DD/MM/AAAA ou YYYY-MM-DD. */
function _pgmMonthKey(dateStr) {
  if (!dateStr || dateStr === '—') return null;
  const s = String(dateStr);
  const m1 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m1) return `${m1[3]}-${m1[2]}`;
  const m2 = s.match(/^(\d{4})-(\d{2})/);
  return m2 ? `${m2[1]}-${m2[2]}` : null;
}

const _pgmItemDate = (it, tab) => tab === 'NF' ? (it.dtDescarga || it.dtEmissao) : it.dtEmissao;

function _pgmGetItems(tab) {
  if (!_pgmState.items[tab]) {
    _pgmState.items[tab] = typeof buildPendIntegGlobalItems === 'function'
      ? buildPendIntegGlobalItems(tab)
      : [];
  }
  return _pgmState.items[tab];
}

/** Aplica período/mês + busca livre sobre os itens de OS/NF. */
function _pgmFiltrar(tab) {
  const per = _pendPeriodo();
  const mes = _pgmState.month[tab];
  const q   = normalizeText(_pgmState.search || '');

  return _pgmGetItems(tab).filter(it => {
    if (mes === 'periodo') {
      if (!per) return false;
      const d = parseDate(_pgmItemDate(it, tab));
      if (!d || d < per.dtIni || d > per.dtFim) return false;
    } else if (mes !== 'all' && _pgmMonthKey(_pgmItemDate(it, tab)) !== mes) {
      return false;
    }
    if (!q) return true;
    return [it.central, it.material, it.fornecedor, tab === 'NF' ? it.nf : it.os,
            it.dtEmissao, tab === 'NF' ? it.dtDescarga : null]
      .some(v => v != null && normalizeText(String(v)).includes(q));
  });
}

const _pgmFmt = n => Number.isFinite(n)
  ? Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : '—';
const _pgmInt = n => (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR');

/**
 * Faixa de TOTAIS no topo do modal, logo abaixo das abas. Reflete o recorte
 * ativo (mês + busca), não o histórico inteiro — é o total do que está em tela.
 *
 * A quantidade das abas OS/NF é somada POR UNIDADE DE MEDIDA, nunca num número
 * só: NF já chega convertida pra KG, mas OS carrega a UM da saída, e juntar
 * kg com m³ sob um "total" seria um número falso. Cada UM vira seu próprio
 * valor na faixa.
 *
 * @param {'OS'|'NF'|'EST'} tab
 * @param {object[]} [itens] - itens já filtrados (só OS/NF)
 */
function _pgmRenderTotal(tab, itens) {
  const el = document.getElementById('pgm-total');
  if (!el) return;

  const celula = (label, valor, principal) =>
    `<div class="pgm-total-item${principal ? ' pgm-total-item--main' : ''}">
      <div class="pgm-total-label">${label}</div>
      <div class="pgm-total-value">${valor}</div>
    </div>`;

  if (tab === 'EST') {
    const linhas = _pgmState.estLinhas || [];
    const dias     = linhas.reduce((a, l) => a + l.dias.length, 0);
    const datas    = new Set();
    const centrais = new Set();
    linhas.forEach(l => { centrais.add(l.central); l.dias.forEach(d => datas.add(localISODate(d))); });

    el.innerHTML =
      celula('Total de dias sem lançamento', `${_pgmInt(dias)} <small>dia${dias === 1 ? '' : 's'}</small>`, true) +
      celula('Datas distintas',   _pgmInt(datas.size)) +
      celula('Pares central×material', _pgmInt(linhas.length)) +
      celula('Centrais envolvidas',    _pgmInt(centrais.size));
    return;
  }

  const lista = itens || [];
  const porUM    = new Map();
  const centrais = new Set();
  const materiais = new Set();
  lista.forEach(it => {
    const um = tab === 'NF' ? 'KG' : String(it.um || 'kg').toUpperCase();
    const q  = tab === 'NF'
      ? _convertNfPesoToKg(it.peso, it.um, it.material, it.fornecedor)
      : Math.abs(num(it.peso));
    porUM.set(um, (porUM.get(um) || 0) + q);
    if (it.central) centrais.add(it.central);
    materiais.add(it.material || '—');
  });

  const cor = tab === 'NF' ? 'var(--green)' : 'var(--red)';
  const qtdHtml = porUM.size
    ? [...porUM.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([um, v]) => `<span style="color:${cor}">${_pgmFmt(v)} <small>${escapeHtml(um)}</small></span>`)
        .join('<span class="pgm-total-sep">·</span>')
    : '—';

  el.innerHTML =
    celula(`Total de ${tab} pendentes`, `${_pgmInt(lista.length)} <small>registro${lista.length === 1 ? '' : 's'}</small>`, true) +
    celula('Quantidade total', qtdHtml) +
    celula('Centrais envolvidas', _pgmInt(centrais.size)) +
    celula('Materiais', _pgmInt(materiais.size));
}

/**
 * Envelopa um bloco do modal numa seção recolhível.
 *
 * O estado fica em _pgmState.collapsed, chaveado por aba+bloco, e NÃO no DOM:
 * digitar na busca recria o corpo inteiro via innerHTML, então uma seção
 * recolhida reabriria sozinha a cada tecla se o estado morasse na marcação.
 * Chave por aba (e não só por bloco) porque o "Resumo" da aba Estoque é outra
 * coisa que o das abas OS/NF — recolher um não deveria recolher o outro.
 *
 * @param {'resumo'|'detalhe'} kind
 * @param {string} icone   - classe do ícone Tabler
 * @param {string} titulo  - texto do cabeçalho
 * @param {string} hint    - contagem exibida à direita
 * @param {string} conteudo- HTML do corpo
 */
function _pgmSection(kind, icone, titulo, hint, conteudo) {
  const aberto = _pgmState.collapsed[`${_pgmState.tab}:${kind}`] !== true;
  return `<div class="pgm-section${aberto ? '' : ' is-collapsed'}" data-kind="${kind}">
    <button class="pgm-section-title" type="button" aria-expanded="${aberto}"
            onclick="pendGeralToggleSection('${kind}')"
            title="${aberto ? 'Recolher' : 'Expandir'} esta seção">
      <i class="ti ti-chevron-down pgm-section-chev"></i>
      <i class="ti ${icone}"></i> ${titulo}
      <span class="pgm-section-hint">${hint}</span>
    </button>
    <div class="pgm-section-body">${conteudo}</div>
  </div>`;
}

/**
 * Recolhe/expande uma seção da aba atual. Só mexe na classe do elemento — não
 * re-renderiza a tabela inteira, que pode ter centenas de linhas.
 */
function pendGeralToggleSection(kind) {
  pendDatasTipHide(); // o "+N" pode sumir junto com a seção
  const key = `${_pgmState.tab}:${kind}`;
  const recolher = !_pgmState.collapsed[key];
  _pgmState.collapsed[key] = recolher;

  const el = document.querySelector(`#pgm-body .pgm-section[data-kind="${kind}"]`);
  if (!el) return;
  el.classList.toggle('is-collapsed', recolher);
  const head = el.querySelector('.pgm-section-title');
  if (head) {
    head.setAttribute('aria-expanded', String(!recolher));
    head.title = recolher ? 'Expandir esta seção' : 'Recolher esta seção';
  }
}
window.pendGeralToggleSection = pendGeralToggleSection;

/** Resumo de OS/NF: total por central × material. */
function _pgmResumoInteg(itens, tab) {
  if (!itens.length) return '';
  const porPar = new Map();
  itens.forEach(it => {
    const um  = tab === 'NF' ? 'KG' : String(it.um || 'kg').toUpperCase();
    const key = `${it.central}|${it.material || '—'}|${um}`;
    const cur = porPar.get(key) || { central: it.central, material: it.material || '—', um, qtd: 0, peso: 0 };
    cur.qtd  += 1;
    cur.peso += tab === 'NF' ? _convertNfPesoToKg(it.peso, it.um, it.material, it.fornecedor) : Math.abs(num(it.peso));
    porPar.set(key, cur);
  });

  const linhas = [...porPar.values()].sort((a, b) =>
    b.qtd - a.qtd || a.central.localeCompare(b.central, 'pt-BR') || a.material.localeCompare(b.material, 'pt-BR'));
  const cor = tab === 'NF' ? 'var(--green)' : 'var(--red)';

  return _pgmSection('resumo', 'ti-sum', 'Resumo — total por central × material',
    `${linhas.length} combinaç${linhas.length === 1 ? 'ão' : 'ões'}`,
    `<table class="pv-table pgm-table">
      <thead><tr><th>Central</th><th>Material</th><th style="text-align:right">Pendências</th><th style="text-align:right">Quantidade</th></tr></thead>
      <tbody>${linhas.map(l => `<tr>
        <td>${escapeHtml(l.central)}</td>
        <td class="pgm-mat-cell" title="${escapeHtml(l.material)}">${escapeHtml(l.material)}</td>
        <td class="td-mono" style="text-align:right;font-weight:700">${l.qtd}</td>
        <td class="td-mono" style="text-align:right;color:${cor}">${_pgmFmt(l.peso)} ${escapeHtml(l.um)}</td>
      </tr>`).join('')}</tbody>
    </table>`);
}

/** Detalhamento completo de OS/NF. */
function _pgmDetalheInteg(itens, tab) {
  if (!itens.length) {
    return `<div class="pv-empty"><i class="ti ti-circle-check"></i><span>Nenhum registro pendente neste recorte</span></div>`;
  }
  const cortado = itens.length > _PGM_MAX_ROWS;
  const linhas  = cortado ? itens.slice(0, _PGM_MAX_ROWS) : itens;
  const cor = tab === 'NF' ? 'var(--green)' : 'var(--red)';

  const body = linhas.map(it => tab === 'NF' ? `<tr>
      <td class="td-muted">${escapeHtml(it.central || '—')}</td>
      <td class="td-mono" style="font-weight:600;color:${cor}">${escapeHtml(String(it.nf || '—'))}</td>
      <td class="pgm-mat-cell" title="${escapeHtml(String(it.material || '—'))}">${escapeHtml(String(it.material || '—'))}</td>
      <td class="td-muted">${escapeHtml(String(it.fornecedor || '—'))}</td>
      <td class="td-muted">${escapeHtml(String(it.dtEmissao || '—'))}</td>
      <td class="td-muted">${escapeHtml(String(it.dtDescarga || '—'))}</td>
      <td class="td-mono" style="text-align:right;color:${cor}">${_pgmFmt(_convertNfPesoToKg(it.peso, it.um, it.material, it.fornecedor))} KG</td>
    </tr>` : `<tr>
      <td class="td-muted">${escapeHtml(it.central || '—')}</td>
      <td class="td-mono" style="font-weight:600;color:${cor}">${escapeHtml(String(it.os || '—'))}</td>
      <td class="pgm-mat-cell" title="${escapeHtml(String(it.material || '—'))}">${escapeHtml(String(it.material || '—'))}</td>
      <td class="td-muted">${escapeHtml(String(it.fornecedor || '—'))}</td>
      <td class="td-muted">${escapeHtml(String(it.dtEmissao || '—'))}</td>
      <td class="td-mono" style="text-align:right;color:${cor}">${_pgmFmt(num(it.peso))} ${escapeHtml(String(it.um || 'kg'))}</td>
    </tr>`).join('');

  const head = tab === 'NF'
    ? '<tr><th>Central</th><th>NF</th><th>Material</th><th>Fornecedor</th><th>Dt. Emissão</th><th>Dt. Descarga</th><th style="text-align:right">Quantidade</th></tr>'
    : '<tr><th>Central</th><th>OS</th><th>Material</th><th>Fornecedor</th><th>Dt. Emissão</th><th style="text-align:right">Quantidade</th></tr>';

  return _pgmSection('detalhe', 'ti-list-details', 'Detalhamento completo',
    `${itens.length} registro${itens.length === 1 ? '' : 's'}${cortado ? ` · exibindo os ${_PGM_MAX_ROWS} primeiros — use a busca ou os meses para afunilar` : ''}`,
    `<table class="pv-table pgm-table"><thead>${head}</thead><tbody>${body}</tbody></table>`);
}

/** Aba ESTOQUE: resumo por data ausente + detalhamento por central × material. */
function _pgmEstoque() {
  const grupos = _pendView.est || [];
  const q = normalizeText(_pgmState.search || '');

  // Achata para linhas central × material, aplicando a busca livre
  const linhas = [];
  grupos.forEach(g => g.materiais.forEach(m => {
    if (q) {
      const hay = [g.central, g.regional, m.material, ...m.dias.map(fmtPtDate)];
      if (!hay.some(v => normalizeText(String(v)).includes(q))) return;
    }
    linhas.push({ central: g.central, regional: g.regional, material: m.material, dias: m.dias, semCadastro: m.semCadastro });
  }));

  // Publicado ANTES do early-return: a faixa de totais lê daqui e precisa
  // zerar corretamente quando a busca não devolve nada.
  _pgmState.estLinhas = linhas;

  if (!linhas.length) {
    return `<div class="pv-empty"><i class="ti ti-circle-check"></i><span>Nenhum dia sem lançamento neste recorte</span></div>`;
  }

  // ── Resumo: quais datas o estoque está ausente ──
  const porData = new Map(); // ISO → { d, pares, centrais:Set }
  linhas.forEach(l => l.dias.forEach(d => {
    const k = localISODate(d);
    if (!porData.has(k)) porData.set(k, { d, pares: 0, centrais: new Set() });
    const e = porData.get(k);
    e.pares += 1;
    e.centrais.add(l.central);
  }));
  const datas = [...porData.values()].sort((a, b) => a.d - b.d);
  const dowNome = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

  const resumo = _pgmSection('resumo', 'ti-calendar-x', 'Resumo — datas com estoque ausente',
    `${datas.length} data${datas.length === 1 ? '' : 's'}`,
    `<div class="pgm-date-grid">${datas.map(e => `
      <div class="pgm-date-cell" title="${e.centrais.size} ${e.centrais.size === 1 ? 'central' : 'centrais'} · ${e.pares} par${e.pares === 1 ? '' : 'es'} central×material">
        <div class="pgm-date-cell-day">${fmtPtDate(e.d)}</div>
        <div class="pgm-date-cell-dow">${dowNome[e.d.getDay()]}</div>
        <div class="pgm-date-cell-qty">${e.centrais.size} ${e.centrais.size === 1 ? 'central' : 'centrais'} · ${e.pares} mat.</div>
      </div>`).join('')}</div>`);

  // Ordena in-place: _pgmState.estLinhas aponta pro MESMO array, e é por ele
  // que o botão "+N" recupera as datas da linha pelo índice (nome de central/
  // material num atributo onclick quebraria com qualquer aspa no cadastro).
  linhas.sort((a, b) => b.dias.length - a.dias.length || a.central.localeCompare(b.central, 'pt-BR'));

  const detalhe = _pgmSection('detalhe', 'ti-list-details', 'Detalhamento completo',
    `${linhas.length} par${linhas.length === 1 ? '' : 'es'} central×material`,
    `<table class="pv-table pgm-table">
      <thead><tr><th>Central</th><th>Regional</th><th>Material</th><th style="text-align:right">Dias</th><th>Datas sem lançamento</th></tr></thead>
      <tbody>${linhas.map((l, i) => {
        const visiveis = l.dias.slice(0, _PGM_MAX_CHIPS);
        const resto    = l.dias.length - visiveis.length;
        const chips    = visiveis.map(d => `<span class="pv-date-chip pv-date-chip-sm">${fmtPtDate(d)}</span>`).join('');
        const maisBtn  = resto > 0
          ? `<button class="pgm-dates-more" type="button"
               onmouseenter="pendDatasTip(event,${i})" onmouseleave="pendDatasTipHide()"
               onfocus="pendDatasTip(event,${i})" onblur="pendDatasTipHide()"
               title="Ver todas as ${l.dias.length} datas">+${resto}</button>`
          : '';
        return `<tr>
          <td>${escapeHtml(l.central)}</td>
          <td class="td-muted">${escapeHtml(l.regional)}</td>
          <td class="pgm-mat-cell" title="${escapeHtml(l.material)}">${escapeHtml(l.material)}${l.semCadastro ? ' <span class="pv-tag-warn">sem cadastro</span>' : ''}</td>
          <td class="td-mono" style="text-align:right;font-weight:700;color:var(--amber)">${l.dias.length}</td>
          <td class="pgm-dates-cell">${chips}${maisBtn}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`);

  return resumo + detalhe;
}

// ── Tooltip do "+N" da coluna de datas ───────────────────────────────────
// position:fixed preso ao <body> porque o corpo do modal tem overflow:auto —
// um popover absoluto dentro da célula seria recortado.
let _pgmTipEl = null;

function _pgmGetTip() {
  if (_pgmTipEl && document.body.contains(_pgmTipEl)) return _pgmTipEl;
  _pgmTipEl = document.createElement('div');
  _pgmTipEl.className = 'pgm-dates-tip';
  document.body.appendChild(_pgmTipEl);
  return _pgmTipEl;
}

function pendDatasTip(ev, idx) {
  const l = _pgmState.estLinhas?.[idx];
  const alvo = ev?.currentTarget;
  if (!l || !alvo) return;

  const dow = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const t = _pgmGetTip();
  t.innerHTML = `
    <div class="pgm-dates-tip-head">${escapeHtml(l.central)} · ${escapeHtml(l.material)} — ${l.dias.length} datas</div>
    <div class="pgm-dates-tip-grid">${l.dias.map(d =>
      `<span class="pv-date-chip pv-date-chip-sm">${fmtPtDate(d)} <b>${dow[d.getDay()]}</b></span>`).join('')}</div>`;
  t.style.display = 'block';

  // Ancorado no botão: abaixo por padrão, acima quando não couber; sempre
  // dentro da viewport nas duas direções.
  const PAD = 10;
  const r  = alvo.getBoundingClientRect();
  const tw = t.offsetWidth;
  const th = t.offsetHeight;
  let left = Math.min(r.left, window.innerWidth  - tw - PAD);
  let top  = r.bottom + 8;
  if (top + th + PAD > window.innerHeight) top = r.top - th - 8;
  t.style.left = Math.max(PAD, left) + 'px';
  t.style.top  = Math.max(PAD, top)  + 'px';
}
window.pendDatasTip = pendDatasTip;

function pendDatasTipHide() {
  if (_pgmTipEl) _pgmTipEl.style.display = 'none';
}
window.pendDatasTipHide = pendDatasTipHide;

/** Pills de mês (só OS/NF). */
function _pgmRenderPills(tab) {
  const bar = document.getElementById('pgm-filter-bar');
  if (!bar) return;
  if (tab === 'EST') { bar.innerHTML = ''; bar.style.display = 'none'; return; }

  const per = _pendPeriodo();
  const meses = [...new Set(_pgmGetItems(tab).map(it => _pgmMonthKey(_pgmItemDate(it, tab))).filter(Boolean))].sort();
  const ativo = _pgmState.month[tab];

  bar.innerHTML = [
    per ? `<button class="pim-month-pill${ativo === 'periodo' ? ' active' : ''}" onclick="pendGeralSetMonth('periodo')" title="Período selecionado no cabeçalho do Analítico"><i class="ti ti-calendar-event" style="font-size:11px"></i> Período</button>` : '',
    `<button class="pim-month-pill${ativo === 'all' ? ' active' : ''}" onclick="pendGeralSetMonth('all')">Todo o histórico</button>`,
    ...meses.map(k => {
      const [y, m] = k.split('-');
      return `<button class="pim-month-pill${ativo === k ? ' active' : ''}" onclick="pendGeralSetMonth('${k}')">${_PGM_MESES[parseInt(m, 10) - 1]}/${y}</button>`;
    })
  ].join('');
  bar.style.display = '';
}

function _pgmRender() {
  // Qualquer re-render descarta o botão "+N" que abriu o tooltip; sem isto ele
  // ficaria órfão na tela (o mouseleave nunca chega num elemento removido).
  pendDatasTipHide();
  const tab = _pgmState.tab;
  const per = _pendPeriodo();

  ['OS', 'NF', 'EST'].forEach(t => {
    document.getElementById(`pgm-tab-${t}`)?.classList.toggle('active', t === tab);
  });

  // Contadores das abas — cada uma no seu próprio recorte de mês + a busca ativa
  const nOS  = _pgmFiltrar('OS').length;
  const nNF  = _pgmFiltrar('NF').length;
  const nEST = (_pendView.est || []).reduce((a, g) => a + g.total, 0);
  const setTabCount = (t, n) => { const el = document.getElementById(`pgm-tab-${t}-count`); if (el) el.textContent = n; };
  setTabCount('OS', nOS); setTabCount('NF', nNF); setTabCount('EST', nEST);

  _pgmRenderPills(tab);

  const body = document.getElementById('pgm-body');
  const sub  = document.getElementById('pgm-sub');
  const cnt  = document.getElementById('pgm-count');
  const note = document.getElementById('pgm-footer-note');

  if (tab === 'EST') {
    // _pgmEstoque popula _pgmState.estLinhas, de onde a faixa de totais lê —
    // por isso o innerHTML vem primeiro.
    if (body) body.innerHTML = _pgmEstoque();
    _pgmRenderTotal('EST');
    if (sub)  sub.textContent = per ? `Estoque · período ${fmtPtDate(per.dtIni)} — ${fmtPtDate(per.dtFim)}` : 'Estoque';
    if (cnt)  cnt.textContent = `${nEST} dia${nEST === 1 ? '' : 's'} sem lançamento`;
    if (note) note.textContent = 'Dias esperados sem lançamento — sempre no período do cabeçalho';
    return;
  }

  const itens = _pgmFiltrar(tab);
  if (body) body.innerHTML = _pgmResumoInteg(itens, tab) + _pgmDetalheInteg(itens, tab);
  _pgmRenderTotal(tab, itens);

  const mes = _pgmState.month[tab];
  const escopo = mes === 'periodo'
    ? (per ? `período ${fmtPtDate(per.dtIni)} — ${fmtPtDate(per.dtFim)}` : 'período')
    : mes === 'all' ? 'todo o histórico'
    : `${_PGM_MESES[parseInt(mes.split('-')[1], 10) - 1]}/${mes.split('-')[0]}`;

  if (sub)  sub.textContent = `${tab === 'NF' ? 'NFs (entradas)' : 'OS (saídas)'} sem integração SAP · ${escopo}`;
  if (cnt)  cnt.textContent = `${itens.length} registro${itens.length === 1 ? '' : 's'} pendente${itens.length === 1 ? '' : 's'}`;
  if (note) note.textContent = 'Registros PUZL sem correspondência no SAP (ref/documento)';
}

function pendOpenGeral() {
  const overlay = document.getElementById('pgm-overlay');
  if (!overlay) return;
  if (!_pendPeriodo()) {
    if (typeof toast === 'function') toast('Rode uma análise antes de abrir o GERAL', 'error');
    return;
  }
  _pendEnsureDados();

  _pgmState.search = '';
  const busca = document.getElementById('pgm-search');
  if (busca) busca.value = '';

  const titulo = document.getElementById('pgm-title');
  if (titulo) titulo.textContent = 'Pendências — Visão Geral';

  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');

  // Pinta o spinner antes do cálculo pesado (varredura completa do histórico
  // de Entradas/Saídas na primeira abertura) — mesmo padrão de openPendIntegGlobalModal.
  // A faixa de totais é esvaziada junto: números da abertura anterior em tela
  // durante o cálculo seriam lidos como se fossem os novos.
  const totalEl = document.getElementById('pgm-total');
  if (totalEl) totalEl.innerHTML = '';
  const body = document.getElementById('pgm-body');
  if (body) body.innerHTML = `<div style="text-align:center;padding:48px;color:var(--text3)">
    <i class="ti ti-loader-2" style="font-size:22px;display:block;margin:0 auto 10px;animation:spin 1s linear infinite"></i>
    Levantando pendências de todas as centrais...
  </div>`;
  setTimeout(_pgmRender, 0);
}
window.pendOpenGeral = pendOpenGeral;

function pendCloseGeral() {
  const overlay = document.getElementById('pgm-overlay');
  if (!overlay) return;
  pendDatasTipHide();
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
}
window.pendCloseGeral = pendCloseGeral;

function pendGeralSetTab(tab) {
  _pgmState.tab = tab;
  _pgmRender();
}
window.pendGeralSetTab = pendGeralSetTab;

function pendGeralSetMonth(key) {
  if (_pgmState.tab === 'EST') return;
  _pgmState.month[_pgmState.tab] = key;
  _pgmRender();
}
window.pendGeralSetMonth = pendGeralSetMonth;

// Debounce curto: a tabela inteira é recriada via innerHTML a cada tecla.
let _pgmSearchDebounce = null;
function pendGeralSetSearch(v) {
  _pgmState.search = v || '';
  clearTimeout(_pgmSearchDebounce);
  _pgmSearchDebounce = setTimeout(_pgmRender, 140);
}
window.pendGeralSetSearch = pendGeralSetSearch;

// Fecha o modal GERAL no Esc / clique fora
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const ov = document.getElementById('pgm-overlay');
  if (ov?.classList.contains('open')) pendCloseGeral();
});
document.addEventListener('click', e => {
  if (e.target?.id === 'pgm-overlay') pendCloseGeral();
});

// Tooltip de datas é position:fixed; rolar o corpo do modal move o botão que
// o ancorava, então ele é fechado no scroll. #pgm-body é estático no HTML
// (só o innerHTML troca), por isso o listener é registrado uma vez só.
document.getElementById('pgm-body')?.addEventListener('scroll', pendDatasTipHide, { passive: true });
