'use strict';

// ═══════════════════════════════════════════════════════════
// SISTEMA DE BADGES DE AJUDA — help-badges.js
// Todos os badges "?" do sistema. Reutiliza o tooltip de macro.js.
// ═══════════════════════════════════════════════════════════

// ── Conteúdo de cada badge ────────────────────────────────────────────
const HELP_DEFS = {

  // ── Gráfico donut — Centrais ─────────────────────────────────────────
  'centrais': {
    title: 'Gráfico: Centrais mais críticas',
    sections: [
      {
        heading: 'Classificação de cada central',
        body: 'Cada central recebe o nível de saúde calculado pelo sistema — o mesmo exibido no cabeçalho do card individual: <strong>SAUDÁVEL, ATENÇÃO, URGENTE</strong> ou <strong>CRÍTICO</strong>. Esse nível considera todos os materiais da central, ponderado pelo sistema de penalidades.',
      },
      {
        heading: 'Score de saúde geral (centro do gráfico)',
        body: 'Representa a saúde agregada de todas as centrais no período. Cada central penaliza o score proporcionalmente ao seu nível sobre o total:',
        weights: 'macro',
      },
      {
        heading: 'Filtro de regional',
        body: 'Restringe o gráfico às centrais de uma regional específica. O score e as contagens são recalculados para o subconjunto filtrado.',
      },
      {
        heading: 'Ranking inferior',
        body: 'Lista as 5 piores centrais, ordenadas por: número de materiais críticos → urgentes → atenção. Em empate, o maior desvio absoluto individual desempata.',
      },
    ],
  },

  // ── Gráfico donut — Materiais ─────────────────────────────────────────
  'materiais': {
    title: 'Gráfico: Materiais mais críticos',
    sections: [
      {
        heading: 'Unidade de análise: par central × material',
        body: 'Cada entrada é um par central × material — CIMENTO da CGN1 e CIMENTO da CCA1 são dois itens distintos. Total esperado: número de centrais × média de materiais por central.',
      },
      {
        heading: 'Classificação de cada par',
        body: 'O nível (BOM, ATENÇÃO, URGENTE, CRÍTICO) é determinado pelos thresholds configurados em <strong>Configurações → Saúde</strong>, aplicados sobre a variação de estoque do par no período.',
      },
      {
        heading: 'Score de saúde geral (centro do gráfico)',
        body: 'Representa a saúde agregada de todos os pares. A fórmula pondera cada par pelo seu nível sobre o total:',
        weights: 'macro',
      },
      {
        heading: 'Filtro de categoria',
        body: 'Filtra por categoria de material (Aglomerante, Agregado, Aditivo, Adição). As opções aparecem apenas se houver dados da categoria no período.',
      },
      {
        heading: 'Tendência ▲▼→',
        body: 'O período é dividido ao meio. Se o desvio absoluto crescer mais de 10% na 2ª metade: <strong style="color:#f43f5e">▲ Piorando</strong>. Se cair mais de 10%: <strong style="color:#10b981">▼ Melhorando</strong>. Caso contrário: → Estável.',
      },
    ],
  },

  // ── Score de saúde da central (cabeçalho do card micro) ──────────────
  'health-score': {
    title: 'Score de saúde da central',
    sections: [
      {
        heading: 'O que é',
        body: 'Representa a saúde operacional da central no período selecionado. Vai de 0% (todos os materiais críticos) a 100% (todos os materiais dentro dos limites).',
      },
      {
        heading: 'Como é calculado',
        body: 'Cada material é classificado por nível com base nos thresholds definidos em <strong>Configurações → Saúde</strong>. O score pondera as penalidades apenas sobre os materiais <em>não-neutros</em> (com variação relevante):',
        weights: 'health',
      },
      {
        heading: 'Faixa de classificação',
        body: `<div style="display:grid;grid-template-columns:auto auto;gap:4px 16px;font-family:var(--mono);font-size:10.5px;margin-top:4px">
          <span style="color:#10b981;font-weight:700">≥ 80%</span><span style="color:var(--text2)">SAUDÁVEL</span>
          <span style="color:#f59e0b;font-weight:700">55–79%</span><span style="color:var(--text2)">ATENÇÃO</span>
          <span style="color:#f97316;font-weight:700">30–54%</span><span style="color:var(--text2)">URGENTE</span>
          <span style="color:#f43f5e;font-weight:700">0–29%</span><span style="color:var(--text2)">CRÍTICO</span>
        </div>`,
      },
      {
        heading: 'Thresholds de variação',
        body: 'Os limiares em kg para cada categoria (Aglomerante, Agregado, Aditivo, Adição) são configuráveis pelo analista. Acesse <strong>Configurações → Saúde da Central</strong> para ajustá-los.',
      },
    ],
  },

  // ── Variação de estoque (cards de detalhe) ───────────────────────────
  'variacao': {
    title: 'Variação de estoque',
    sections: [
      {
        heading: 'Fórmula',
        body: `<div style="font-family:var(--mono);font-size:11px;background:var(--bg3);border-radius:5px;padding:8px 12px;margin-top:4px;border:1px solid var(--border)">
          Variação = Est. Final − Est. Teórico<br>
          Est. Teórico = Est. Inicial + Entradas SAP + Saídas SAP
        </div>`,
      },
      {
        heading: 'Est. Inicial',
        body: 'Saldo do <strong>último lançamento antes do início do período</strong>. Se não houver lançamento anterior, usa o primeiro lançamento do próprio período. Isso garante que a análise parte de um estado real conhecido.',
      },
      {
        heading: 'Est. Final',
        body: 'Saldo do <strong>último lançamento dentro do período</strong> (data mais recente). Se houver múltiplos lançamentos no mesmo dia, todos são somados.',
      },
      {
        heading: 'Entradas e Saídas SAP',
        body: 'Movimentações do SAP no período. Entradas são os pesos positivos (códigos 101, 801), saídas são os pesos negativos (código 201). Outros códigos são registrados mas não entram no Est. Teórico.',
      },
      {
        heading: 'Interpretação',
        body: `<span style="color:#10b981">⊕ Sobra</span> — Est. Final maior que o teórico. Pode indicar entrada não registrada ou saída não lançada.<br><br>
          <span style="color:#f43f5e">⊖ Desfalque</span> — Est. Final menor que o teórico. Pode indicar consumo não registrado ou divergência de medição.`,
      },
    ],
  },

  // ── Est. Inicial ─────────────────────────────────────────────────────
  'est-inicial': {
    title: 'Estoque Inicial',
    sections: [
      {
        heading: 'De onde vem',
        body: 'O sistema busca o <strong>último lançamento registrado antes do início do período</strong> para cada par central × material. Esse saldo é usado como ponto de partida do cálculo.',
      },
      {
        heading: 'Por que não o primeiro lançamento do período?',
        body: 'O primeiro lançamento dentro do período pode ser de qualquer dia — não necessariamente representa o estoque no início. O saldo pré-período é mais preciso porque reflete o estado real do estoque no momento em que o período começa.',
      },
      {
        heading: 'Quando não há lançamento anterior',
        body: 'Se não existir nenhum lançamento antes do período, o sistema usa o primeiro lançamento do próprio período como Est. Inicial. Nesse caso, o Est. Teórico pode ficar igual ao Est. Final e a Variação será zero ou próxima de zero.',
      },
    ],
  },

  // ── Tendência ▲▼→ nos painéis de criticidade ─────────────────────────
  'tendencia': {
    title: 'Indicador de tendência',
    sections: [
      {
        heading: 'Como é calculada',
        body: 'O período selecionado é dividido ao meio. O desvio absoluto (|Variação|) é calculado separadamente na 1ª e na 2ª metade. A mudança percentual entre as duas metades determina a tendência.',
      },
      {
        heading: 'Critério',
        body: `<div style="display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-family:var(--mono);font-size:10.5px;margin-top:4px">
          <span style="color:#f43f5e;font-weight:700">▲ Piorando</span><span style="color:var(--text2)">desvio cresceu mais de 10%</span>
          <span style="color:#10b981;font-weight:700">▼ Melhorando</span><span style="color:var(--text2)">desvio caiu mais de 10%</span>
          <span style="color:var(--text3)">→ Estável</span><span style="color:var(--text2)">variação dentro de ±10%</span>
        </div>`,
      },
      {
        heading: 'Limitação',
        body: 'Para períodos muito curtos (menos de 2 semanas), pode haver poucas movimentações em cada metade, tornando a tendência menos confiável. Nesse caso, considere ampliar o período de análise.',
      },
    ],
  },

  // ── Custo da variação ─────────────────────────────────────────────────
  'custo-variacao': {
    title: 'Custo estimado da variação',
    sections: [
      {
        heading: 'Fórmula',
        body: `<div style="font-family:var(--mono);font-size:11px;background:var(--bg3);border-radius:5px;padding:8px 12px;margin-top:4px;border:1px solid var(--border)">
          Custo = |Variação em kg| × Custo Médio (R$/kg)
        </div>`,
      },
      {
        heading: 'Custo Médio',
        body: 'Calculado a partir dos registros SAP do período: soma dos valores dividida pelo total de kg movimentado. Se não houver dados SAP com valor para o material, o custo estimado não é exibido.',
      },
      {
        heading: 'É uma estimativa',
        body: 'O custo reflete o impacto financeiro <em>potencial</em> da variação — não é um valor contábil confirmado. Serve como referência para priorização: um desfalque de 50 kg de aditivo caro pode ser mais grave que 500 kg de agregado barato.',
      },
    ],
  },

  // ── Painéis de criticidade (crank) ────────────────────────────────────
  'crank': {
    title: 'Painel de criticidade',
    sections: [
      {
        heading: 'Classificação dos materiais',
        body: 'Cada linha representa um par central × material classificado neste nível. A classificação usa os thresholds configurados em <strong>Configurações → Saúde</strong> aplicados sobre a variação do período.',
      },
      {
        heading: 'Ordenação',
        body: 'As linhas são ordenadas pelo <strong>custo estimado absoluto</strong> (maior impacto financeiro primeiro). Isso prioriza os casos com maior relevância econômica, independente do volume em kg.',
      },
      {
        heading: 'Tendência ▲▼→',
        body: 'Compara o desvio absoluto na 1ª metade do período com o da 2ª. ▲ o problema está crescendo, ▼ está diminuindo, → está estável (variação < 10%).',
      },
      {
        heading: 'Barra de impacto',
        body: 'A barra horizontal é relativa ao maior custo do painel — o item com maior custo tem barra 100%, os demais são proporcionais.',
      },
    ],
  },

};

// ── Renderiza seções de um help def ──────────────────────────────────
const _MACRO_WEIGHTS_HTML = `
  <div style="display:grid;grid-template-columns:auto auto auto;gap:5px 14px;margin-top:8px;font-family:var(--mono);font-size:10.5px">
    <span style="color:#f43f5e;font-weight:700">CRÍTICO</span><span style="color:var(--text3)">penalidade</span><span style="color:var(--text);font-weight:600">1,0 por item</span>
    <span style="color:#f97316;font-weight:700">URGENTE</span><span style="color:var(--text3)">penalidade</span><span style="color:var(--text);font-weight:600">0,5 por item</span>
    <span style="color:#f59e0b;font-weight:700">ATENÇÃO</span><span style="color:var(--text3)">penalidade</span><span style="color:var(--text);font-weight:600">0,2 por item</span>
    <span style="color:#10b981;font-weight:700">BOM</span><span style="color:var(--text3)">penalidade</span><span style="color:var(--text);font-weight:600">0,0 por item</span>
  </div>
  <div style="margin-top:8px;font-size:10px;color:var(--text3);font-family:var(--mono);background:var(--bg3);border-radius:5px;padding:6px 9px;border:1px solid var(--border)">
    score = (1 − soma_penalidades / total) × 100
  </div>`;

const _HEALTH_WEIGHTS_HTML = `
  <div style="display:grid;grid-template-columns:auto auto auto;gap:5px 14px;margin-top:8px;font-family:var(--mono);font-size:10.5px">
    <span style="color:#f43f5e;font-weight:700">CRÍTICO</span><span style="color:var(--text3)">penalidade</span><span style="color:var(--text);font-weight:600">6 pt</span>
    <span style="color:#f97316;font-weight:700">URGENTE</span><span style="color:var(--text3)">penalidade</span><span style="color:var(--text);font-weight:600">3 pt</span>
    <span style="color:#f59e0b;font-weight:700">ATENÇÃO</span><span style="color:var(--text3)">penalidade</span><span style="color:var(--text);font-weight:600">1 pt</span>
    <span style="color:#10b981;font-weight:700">BOM</span><span style="color:var(--text3)">penalidade</span><span style="color:var(--text);font-weight:600">0 pt</span>
  </div>
  <div style="margin-top:8px;font-size:10px;color:var(--text3);font-family:var(--mono);background:var(--bg3);border-radius:5px;padding:6px 9px;border:1px solid var(--border)">
    score = max(0, 100 − Σpenalidades / total_não_neutros × 100)
  </div>`;

function _buildHelpContent(key) {
  const def = HELP_DEFS[key];
  if (!def) return '';
  const sections = def.sections.map(s => `
    <div style="margin-bottom:12px">
      <div style="font-size:10px;font-weight:700;color:var(--accent);font-family:var(--mono);letter-spacing:.05em;text-transform:uppercase;margin-bottom:5px">${s.heading}</div>
      <div style="font-size:11.5px;color:var(--text2);line-height:1.65">${s.body}</div>
      ${s.weights === 'health' ? _HEALTH_WEIGHTS_HTML : s.weights === 'macro' ? _MACRO_WEIGHTS_HTML : ''}
    </div>`).join('');
  return `
    <div style="font-size:12.5px;font-weight:700;color:var(--text);margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--border2)">${def.title}</div>
    ${sections}`;
}

// ── Singleton tooltip (reutiliza o de macro.js se já existir) ─────────
function _getHelpTip() {
  let t = document.getElementById('macro-donut-tip');
  if (!t) {
    t = document.createElement('div');
    t.id = 'macro-donut-tip';
    t.style.cssText = [
      'position:fixed','z-index:9999','pointer-events:none','display:none',
      'background:var(--bg2)','border:1px solid var(--border3)',
      'border-radius:10px','padding:14px 16px','min-width:220px','max-width:340px',
      'box-shadow:0 8px 32px rgba(0,0,0,.5)',
      'font-family:var(--font)','font-size:12px',
    ].join(';');
    document.body.appendChild(t);
  }
  return t;
}
function _hideHelpTip() {
  const t = _getHelpTip();
  t.style.display = 'none';
}

function _positionTip(t, cx, cy) {
  const PAD = 10;
  const W = window.innerWidth, H = window.innerHeight;
  // getBoundingClientRect works even with display:block before repaint
  const rect = t.getBoundingClientRect();
  const tw = rect.width  || t.offsetWidth  || 340;
  const th = rect.height || t.offsetHeight || 200;
  let lx = cx + 14, ly = cy + 14;
  if (lx + tw + PAD > W) lx = cx - tw - 10;
  if (ly + th + PAD > H) ly = cy - th - 10;
  lx = Math.max(PAD, Math.min(lx, W - tw - PAD));
  ly = Math.max(PAD, Math.min(ly, H - th - PAD));
  t.style.left = lx + 'px';
  t.style.top  = ly + 'px';
}

function _moveHelpTip(e) {
  const t = _getHelpTip();
  if (t.style.display === 'none') return;
  _positionTip(t, e.clientX, e.clientY);
}

function _showHelpTip(e, html) {
  const t = _getHelpTip();
  t.innerHTML = html;
  t.style.borderColor = 'var(--accent)';
  t.style.display = 'block';
  _positionTip(t, e.clientX, e.clientY);
}

// ── Inicializa todos os badges data-help no documento ─────────────────
function initHelpBadges() {
  document.querySelectorAll('[data-help]').forEach(badge => {
    if (badge._helpInit) return;   // evita re-bind em re-renders
    badge._helpInit = true;
    const key = badge.dataset.help;
    badge.addEventListener('mouseenter', e => _showHelpTip(e, _buildHelpContent(key)));
    badge.addEventListener('mousemove',  _moveHelpTip);
    badge.addEventListener('mouseleave', _hideHelpTip);
  });
}
window.initHelpBadges = initHelpBadges;

// ── Tooltip de custo médio (hover na célula Custo Variação) ───────────
function showCustoMedTip(e, custoMedLabel, fonte) {
  const isSaidas     = fonte === 'Módulo Saídas';
  const isLanc       = fonte === 'Módulo Lançamentos';
  const isFallback   = fonte === 'Fallback SAP';
  const fonteColor   = isSaidas ? '#10b981' : isLanc ? '#3b82f6' : isFallback ? '#f59e0b' : 'var(--text3)';
  const fonteIcon    = isSaidas ? 'ti-circle-check' : isLanc ? 'ti-notes' : isFallback ? 'ti-alert-triangle' : 'ti-minus';
  const fonteNote    = isLanc
    ? 'Não encontrado no módulo Saídas.<br>Usando custo dos Lançamentos.'
    : isFallback
    ? 'Não encontrado em Saídas nem Lançamentos.<br>Usando custo do SAP como fallback.'
    : '';
  const t = _getHelpTip();
  t.innerHTML = `
    <div style="font-size:9px;font-weight:700;color:var(--text3);font-family:var(--mono);letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px">Custo médio</div>
    <div style="font-size:15px;font-weight:700;color:var(--text);font-family:var(--mono);margin-bottom:8px">${custoMedLabel}</div>
    <div style="display:flex;align-items:center;gap:5px;font-size:10.5px;font-family:var(--mono);color:${fonteColor}">
      <i class="ti ${fonteIcon}" style="font-size:12px"></i>
      <span style="font-weight:600">${fonte || '—'}</span>
    </div>
    ${fonteNote ? `<div style="font-size:9.5px;color:var(--text3);font-family:var(--mono);margin-top:6px;line-height:1.6">${fonteNote}</div>` : ''}`;
  t.style.borderColor = fonteColor;
  t.style.display = 'block';
  _positionTip(t, e.clientX, e.clientY);
}
function moveCustoMedTip(e) { _moveHelpTip(e); }
function hideCustoMedTip()  { _hideHelpTip(); }

Object.assign(window, { showCustoMedTip, moveCustoMedTip, hideCustoMedTip });

// Inicializa na carga inicial
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initHelpBadges);
} else {
  initHelpBadges();
}
