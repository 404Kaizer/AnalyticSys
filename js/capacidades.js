'use strict';

// ══════════════════════════════════════════════════════════════════════════════
// CAPACIDADES E ESTOQUE DE SEGURANÇA (Configurações)
// ══════════════════════════════════════════════════════════════════════════════
// Estima a capacidade física de armazenagem de cada central por material —
// SILO (aglomerantes), BAIA (agregados miúdos/graúdos) e IBC/TANQUE (aditivos)
// — a partir dos LANÇAMENTOS já importados (saldo real contado na central).
//
// Por que a MÉDIA DOS N MAIORES e não a média simples: o saldo lançado quase
// nunca está no topo do silo/baia, então a média de todos os lançamentos fica
// muito abaixo da capacidade real e acusaria "acima da capacidade" o tempo
// todo. A média dos CAP_TOP_N maiores aproxima o teto real sem ficar refém de
// um único pico de digitação errada (o que aconteceria usando só o máximo).
//
// ADIÇÕES ficam de fora de propósito (decisão do Hugo, 14/08/2026) — não têm
// estrutura de armazenagem própria mapeada.
//
// Os valores são recalculados automaticamente a cada render, mas podem ser
// sobrescritos manualmente (individual ou em massa). Só os overrides são
// persistidos — ver capGetOverrides.
// ══════════════════════════════════════════════════════════════════════════════

const CAP_TOP_N = 5;            // quantos maiores lançamentos entram na média
const CAP_JANELA_MESES = 12;    // janela de histórico considerada
const CAP_PCT_PADRAO = 25;      // % da capacidade usada como estoque de segurança
const CAP_OVERRIDES_KEY = '__capacidades_overrides__';
const CAP_PAGE_SIZE = PAGE_SIZE;

// Categoria cadastrada (normalize.js/CATEGORIAS_MATERIAL) → estrutura física.
// "Adição" não está aqui de propósito: material sem entrada neste mapa é
// simplesmente ignorado na tabela.
const CAP_ARMAZENAGEM = {
  'Aglomerante':     { tipo: 'Silo',       icone: 'ti-droplet',  cor: 'var(--amber)',  catKey: 'aglomerante' },
  'Agregado Graúdo': { tipo: 'Baia',       icone: 'ti-mountain', cor: 'var(--teal)',   catKey: 'agregado'    },
  'Agregado Miúdo':  { tipo: 'Baia',       icone: 'ti-mountain', cor: 'var(--teal)',   catKey: 'agregado'    },
  'Aditivo':         { tipo: 'IBC/Tanque', icone: 'ti-flask',    cor: 'var(--purple)', catKey: 'aditivo'     }
};

const CAP_CATS_PCT = [
  { catKey: 'aglomerante', label: 'Aglomerantes (silos)' },
  { catKey: 'agregado',    label: 'Agregados (baias)'    },
  { catKey: 'aditivo',     label: 'Aditivos (IBC/tanques)' }
];

const CAP_BUSCA_CAMPOS = ['central', 'grupo', 'codSap', 'categoria', 'tipo'];

let _capRowsCache = null;
let _capCacheSig = '';
let capPage = 0;
let capFiltro = '';

function capInvalidarCache() { _capRowsCache = null; _capCacheSig = ''; }

// Assinatura barata do que alimenta o cálculo — importar/excluir lançamentos
// ou materiais já derruba o cache sozinho, sem precisar de hook em cada
// caminho de escrita. Edições que não mudam a contagem (ex.: trocar a
// categoria de um material) são cobertas por atualizarCadastros(), que chama
// capInvalidarCache explicitamente.
function _capCacheSignature() {
  return `${(state.lancamentos || []).length}|${(state.materiais || []).length}`;
}

// ── Overrides manuais ─────────────────────────────────────────────────────
// Guardados como UMA linha de state.configs (JSON), não uma config por
// célula: pega persistência local + sync na nuvem de graça (_configsSyncUpsert)
// sem inundar a tabela "Configurações Personalizadas" com centenas de linhas.
// Mesmo padrão de __responsavel_padrao__.
// ponytail: teto ~algumas centenas de overrides num único campo texto. Se um
// dia virar milhares, migra pra tabela própria no Supabase.
function capGetOverrides() {
  const cfg = state.configs.find(c => c.key === CAP_OVERRIDES_KEY);
  if (!cfg || !cfg.value) return {};
  try {
    const obj = JSON.parse(cfg.value);
    return (obj && typeof obj === 'object') ? obj : {};
  } catch (err) {
    console.warn('[Capacidades] Overrides ilegíveis — ignorando.', err);
    return {};
  }
}

function capSalvarOverrides(map) {
  const rec = {
    key: CAP_OVERRIDES_KEY,
    value: JSON.stringify(map),
    desc: 'Capacidades e estoques de segurança editados manualmente',
    created: new Date().toLocaleDateString('pt-BR')
  };
  const i = state.configs.findIndex(c => c.key === CAP_OVERRIDES_KEY);
  if (i >= 0) state.configs[i] = rec; else state.configs.unshift(rec);
  persist();
  if (window.supabaseClient && typeof _configsSyncUpsert === 'function') _configsSyncUpsert(rec);
}

// ── % de estoque de segurança por categoria ───────────────────────────────
function capPctSeguranca(catKey) {
  const cfg = state.configs.find(c => normalizeText(c.key) === normalizeText(`estsec_pct_${catKey}`));
  const n = cfg ? num(cfg.value) : NaN;
  return (Number.isFinite(n) && n > 0) ? n : CAP_PCT_PADRAO;
}

function loadCapPctInputs() {
  CAP_CATS_PCT.forEach(({ catKey }) => {
    const input = document.getElementById(`cap-pct-${catKey}`);
    if (input) input.value = capPctSeguranca(catKey);
  });
}

function salvarPctSeguranca() {
  let salvos = 0;
  CAP_CATS_PCT.forEach(({ catKey, label }) => {
    const input = document.getElementById(`cap-pct-${catKey}`);
    if (!input) return;
    const n = num(input.value);
    if (!Number.isFinite(n) || n <= 0) return;
    const key = `estsec_pct_${catKey}`;
    const rec = {
      key,
      value: String(n),
      desc: `Estoque de segurança — % da capacidade para ${label}`,
      created: new Date().toLocaleDateString('pt-BR')
    };
    const i = state.configs.findIndex(c => normalizeText(c.key) === normalizeText(key));
    if (i >= 0) state.configs[i] = rec; else state.configs.unshift(rec);
    if (window.supabaseClient && typeof _configsSyncUpsert === 'function') _configsSyncUpsert(rec);
    salvos++;
  });
  if (!salvos) { toast('Informe percentuais maiores que zero', 'error'); return; }
  persist();
  capInvalidarCache();
  renderCapacidades();
  if (typeof renderConfigs === 'function') renderConfigs();
  toast(`${salvos} percentual(is) salvo(s)`);
}

// ── Cálculo ───────────────────────────────────────────────────────────────
// Categoria vem do CADASTRO de materiais (fonte única, igual à Saúde da
// Central). Material sem categoria cadastrada não entra na tabela — não dá
// pra saber se é silo, baia ou tanque.
function _capCategoriaDe(grupo, cache) {
  if (cache.has(grupo)) return cache.get(grupo);
  const cat = (typeof getCategoriaPorGrupo === 'function') ? getCategoriaPorGrupo(grupo) : '';
  cache.set(grupo, cat);
  return cat;
}

function capRowKey(central, grupo) { return `${central}|||${grupo}`; }

function getCapacidadesRows() {
  const sig = _capCacheSignature();
  if (_capRowsCache && _capCacheSig === sig) return _capRowsCache;
  _capCacheSig = sig;

  const catCache = new Map();
  const buckets = new Map(); // key -> { central, grupo, categoria, um, pesos:[[t,peso]] }
  let maxT = 0;

  for (const r of (state.lancamentos || [])) {
    const central = String(r.central || '').trim();
    const grupo   = String(r.material || '').trim();
    if (!central || !grupo) continue;

    const categoria = _capCategoriaDe(grupo, catCache);
    if (!CAP_ARMAZENAGEM[categoria]) continue; // sem cadastro, ou Adição

    const peso = num(r.peso);
    if (!(peso > 0)) continue;

    const dt = parseDate(r.dtLanc);
    if (!dt) continue;
    const t = dt.getTime();
    if (t > maxT) maxT = t;

    const key = capRowKey(central, grupo);
    let b = buckets.get(key);
    if (!b) {
      b = { central, grupo, categoria, um: '', pesos: [] };
      buckets.set(key, b);
    }
    if (!b.um && r.um) b.um = String(r.um).trim();
    b.pesos.push([t, peso]);
  }

  if (!maxT) { _capRowsCache = []; return _capRowsCache; }

  // Janela ancorada no lançamento mais recente da base (e não em "hoje"):
  // se o usuário está analisando um histórico que termina meses atrás, a
  // tabela continua fazendo sentido em vez de ficar vazia.
  const ref = new Date(maxT);
  const corte = new Date(ref.getFullYear(), ref.getMonth() - CAP_JANELA_MESES, ref.getDate()).getTime();

  const overrides = capGetOverrides();
  const rows = [];

  buckets.forEach((b, key) => {
    const naJanela = b.pesos.filter(([t]) => t >= corte).map(([, p]) => p);
    if (!naJanela.length) return;

    naJanela.sort((a, z) => z - a);
    const topo = naJanela.slice(0, CAP_TOP_N);
    const capAuto = topo.reduce((s, v) => s + v, 0) / topo.length;

    const arm = CAP_ARMAZENAGEM[b.categoria];
    const pct = capPctSeguranca(arm.catKey);
    const segAuto = capAuto * pct / 100;

    const ov = overrides[key] || {};
    const capManual = Number.isFinite(ov.cap);
    const segManual = Number.isFinite(ov.seg);

    rows.push({
      key,
      central: b.central,
      grupo: b.grupo,
      codSap: (typeof getCodSapPorGrupo === 'function' ? getCodSapPorGrupo(b.grupo) : '') || '',
      categoria: b.categoria,
      tipo: arm.tipo,
      icone: arm.icone,
      cor: arm.cor,
      catKey: arm.catKey,
      pct,
      um: b.um || 'KG',
      amostras: naJanela.length,
      capAuto,
      segAuto,
      capacidade: capManual ? num(ov.cap) : capAuto,
      seguranca:  segManual ? num(ov.seg) : segAuto,
      capManual,
      segManual
    });
  });

  rows.sort((a, b) =>
    a.central.localeCompare(b.central, 'pt-BR') ||
    a.grupo.localeCompare(b.grupo, 'pt-BR'));

  _capRowsCache = rows;
  return rows;
}

// Consulta pública pra outras telas (Visão Micro) — devolve a capacidade e o
// estoque de segurança vigentes (manual se houver, senão o automático).
function getCapacidadeCentralMaterial(central, material) {
  const key = capRowKey(String(central || '').trim(), String(material || '').trim());
  return getCapacidadesRows().find(r => r.key === key) || null;
}

// ── Render ────────────────────────────────────────────────────────────────
function capDadosFiltrados() {
  // Sem o 4º argumento de propósito: filterRecords só usa o índice invertido
  // (cacheado por escopo) quando recebe scope, e estas linhas são derivadas —
  // recalculadas a cada import. São poucas centenas, a varredura direta é
  // instantânea e não tem cache pra invalidar.
  return filterRecords(getCapacidadesRows(), capFiltro, CAP_BUSCA_CAMPOS);
}

function capFiltrar(valor) {
  capFiltro = valor;
  capPage = 0;
  renderCapacidades();
}

function capIrParaPagina(p) { capPage = Math.max(0, p); renderCapacidades(); }
function capPaginaAnterior() { capIrParaPagina(capPage - 1); }
function capProximaPagina() {
  const total = Math.ceil(capDadosFiltrados().length / CAP_PAGE_SIZE);
  if (capPage < total - 1) capIrParaPagina(capPage + 1);
}
function capIrParaUltima() {
  const total = Math.ceil(capDadosFiltrados().length / CAP_PAGE_SIZE);
  capIrParaPagina(Math.max(0, total - 1));
}

function _capNum(v) {
  return num(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderCapacidades() {
  const tb = document.getElementById('tb-capacidades');
  if (!tb) return;
  loadCapPctInputs();

  const data = capDadosFiltrados();
  const totalPages = Math.max(1, Math.ceil(data.length / CAP_PAGE_SIZE));
  if (capPage > totalPages - 1) capPage = totalPages - 1;
  const pageData = data.slice(capPage * CAP_PAGE_SIZE, (capPage + 1) * CAP_PAGE_SIZE);

  const info = document.getElementById('pi-capacidades');
  if (info) {
    info.textContent = data.length === 0
      ? '0 registros'
      : `${capPage * CAP_PAGE_SIZE + 1}-${Math.min((capPage + 1) * CAP_PAGE_SIZE, data.length)} de ${data.length} registros (pág. ${capPage + 1}/${totalPages})`;
  }

  if (!data.length) {
    tb.innerHTML = `<tr><td colspan="10"><div class="empty-state"><i class="ti ti-barrel"></i><p>${
      capFiltro
        ? 'Nenhum resultado para este filtro.'
        : 'Nada a calcular ainda — importe Lançamentos e cadastre a categoria dos materiais.'
    }</p></div></td></tr>`;
    return;
  }

  // A chave viaja em data-key (nunca interpolada dentro de uma string JS no
  // onclick): nome de material com apóstrofo — "AREIA D'ÁGUA" — quebraria o
  // handler mesmo passando por escapeHtml, já que o parser HTML devolve o
  // &#39; como ' antes do JS ser avaliado.
  tb.innerHTML = pageData.map(r => {
    const k = escapeHtml(r.key);
    const um = escapeHtml(r.um);
    const capCls = r.capManual ? ' cap-input-editado' : '';
    const segCls = r.segManual ? ' cap-input-editado' : '';
    const capTitle = escapeHtml(r.capManual
      ? `Editado manualmente — automático: ${_capNum(r.capAuto)} ${r.um}`
      : `Média dos ${Math.min(CAP_TOP_N, r.amostras)} maiores lançamentos da janela`);
    const segTitle = escapeHtml(r.segManual
      ? `Editado manualmente — automático: ${_capNum(r.segAuto)} ${r.um}`
      : `${r.pct}% da capacidade`);
    const editado = (r.capManual || r.segManual);
    return `
    <tr>
      <td><input type="checkbox" class="chk-capacidades-row" value="${k}"></td>
      <td class="td-mono">${escapeHtml(r.central)}</td>
      <td class="td-mono">${escapeHtml(r.grupo)}</td>
      <td class="td-mono">${escapeHtml(r.codSap) || '—'}</td>
      <td class="td-muted"><span class="cap-tipo-chip" style="color:${r.cor}"><i class="ti ${r.icone}"></i> ${escapeHtml(r.tipo)}</span></td>
      <td class="td-muted">${escapeHtml(r.categoria)}</td>
      <td class="td-mono td-muted" title="Lançamentos considerados nos últimos ${CAP_JANELA_MESES} meses">${r.amostras}</td>
      <td>
        <div class="cap-cell">
          <input type="number" step="0.01" min="0" class="health-cfg-input${capCls}" title="${capTitle}"
                 value="${num(r.capacidade).toFixed(2)}"
                 data-key="${k}" data-campo="cap" onchange="capEditarCelula(this)">
          <span class="cap-um">${um}</span>
          ${r.capManual ? '<span class="cap-badge-manual" title="Valor alterado manualmente">manual</span>' : ''}
        </div>
      </td>
      <td>
        <div class="cap-cell">
          <input type="number" step="0.01" min="0" class="health-cfg-input${segCls}" title="${segTitle}"
                 value="${num(r.seguranca).toFixed(2)}"
                 data-key="${k}" data-campo="seg" onchange="capEditarCelula(this)">
          <span class="cap-um">${um}</span>
          ${r.segManual ? '<span class="cap-badge-manual" title="Valor alterado manualmente">manual</span>' : ''}
        </div>
      </td>
      <td>
        ${editado
          ? `<button class="btn-icon" title="Voltar ao valor calculado automaticamente" data-key="${k}" onclick="capRestaurarAuto(this)"><i class="ti ti-rotate"></i></button>`
          : '<span class="td-muted" style="font-size:11px">auto</span>'}
      </td>
    </tr>`;
  }).join('');
}

// ── Edição ────────────────────────────────────────────────────────────────
function capEditarCelula(el) {
  const key = el?.dataset?.key;
  const campo = el?.dataset?.campo;
  if (!key || !campo) return;
  const row = getCapacidadesRows().find(r => r.key === key);
  if (!row) return;

  const raw = String(el.value ?? '').trim();
  const n = num(raw);
  if (raw && !(n >= 0)) { toast('Informe um valor numérico maior ou igual a zero', 'error'); renderCapacidades(); return; }

  const overrides = capGetOverrides();
  const atual = overrides[key] || {};
  const auto = campo === 'cap' ? row.capAuto : row.segAuto;

  // Campo apagado, ou digitado exatamente igual ao automático, não vira
  // "override" — volta pro calculado, em vez de gravar um zero fantasma ou
  // marcar como manual uma linha que o usuário só passou por cima.
  if (!raw || Math.abs(n - auto) < 0.005) delete atual[campo];
  else atual[campo] = n;

  if (Object.keys(atual).length) overrides[key] = atual;
  else delete overrides[key];

  capSalvarOverrides(overrides);
  capInvalidarCache();
  renderCapacidades();
}

function capRestaurarAuto(el) {
  const key = el?.dataset?.key;
  if (!key) return;
  const overrides = capGetOverrides();
  if (!overrides[key]) return;
  delete overrides[key];
  capSalvarOverrides(overrides);
  capInvalidarCache();
  renderCapacidades();
  toast('Valores recalculados automaticamente');
}

function capToggleSelecionarTodos(checked) {
  document.querySelectorAll('#tb-capacidades .chk-capacidades-row').forEach(el => { el.checked = checked; });
}

function capSelecionados() {
  return [...document.querySelectorAll('#tb-capacidades .chk-capacidades-row:checked')].map(el => el.value);
}

function abrirEdicaoCapacidadesSelecionadas() {
  const keys = capSelecionados();
  if (!keys.length) { toast('Selecione ao menos uma linha para editar', 'error'); return; }
  const info = document.getElementById('cap-massa-info');
  if (info) info.textContent = `${keys.length} linha(s) selecionada(s). Deixe um campo em branco para não alterá-lo.`;
  const inCap = document.getElementById('cap-massa-capacidade');
  const inSeg = document.getElementById('cap-massa-seguranca');
  if (inCap) inCap.value = '';
  if (inSeg) inSeg.value = '';
  openModal('modal-capacidades-massa');
  setTimeout(() => inCap?.focus(), 50);
}

function salvarEdicaoCapacidadesEmMassa() {
  const keys = capSelecionados();
  if (!keys.length) { toast('Nenhuma linha selecionada', 'error'); return; }

  const rawCap = String(document.getElementById('cap-massa-capacidade')?.value ?? '').trim();
  const rawSeg = String(document.getElementById('cap-massa-seguranca')?.value ?? '').trim();
  if (!rawCap && !rawSeg) { toast('Informe ao menos um valor', 'error'); return; }

  const nCap = rawCap ? num(rawCap) : null;
  const nSeg = rawSeg ? num(rawSeg) : null;
  if ((rawCap && !(nCap >= 0)) || (rawSeg && !(nSeg >= 0))) {
    toast('Valores devem ser numéricos e maiores ou iguais a zero', 'error');
    return;
  }

  const overrides = capGetOverrides();
  const porKey = new Map(getCapacidadesRows().map(r => [r.key, r]));
  let aplicados = 0;

  keys.forEach(key => {
    const row = porKey.get(key);
    if (!row) return;
    const atual = overrides[key] || {};
    if (nCap !== null) {
      if (Math.abs(nCap - row.capAuto) < 0.005) delete atual.cap; else atual.cap = nCap;
    }
    if (nSeg !== null) {
      if (Math.abs(nSeg - row.segAuto) < 0.005) delete atual.seg; else atual.seg = nSeg;
    }
    if (Object.keys(atual).length) overrides[key] = atual; else delete overrides[key];
    aplicados++;
  });

  capSalvarOverrides(overrides);
  capInvalidarCache();
  renderCapacidades();
  closeModal('modal-capacidades-massa');
  toast(`${aplicados} linha(s) atualizada(s)`);
}

function restaurarCapacidadesSelecionadas() {
  const keys = capSelecionados();
  if (!keys.length) { toast('Selecione ao menos uma linha', 'error'); return; }
  const overrides = capGetOverrides();
  let removidos = 0;
  keys.forEach(key => { if (overrides[key]) { delete overrides[key]; removidos++; } });
  if (!removidos) { toast('Nenhuma das linhas selecionadas tinha edição manual', 'error'); return; }
  capSalvarOverrides(overrides);
  capInvalidarCache();
  renderCapacidades();
  toast(`${removidos} linha(s) voltaram ao cálculo automático`);
}

function recalcularCapacidades() {
  capInvalidarCache();
  renderCapacidades();
  toast('Capacidades recalculadas a partir dos lançamentos');
}

Object.assign(window, {
  renderCapacidades, loadCapPctInputs, salvarPctSeguranca, capFiltrar,
  capIrParaPagina, capPaginaAnterior, capProximaPagina, capIrParaUltima,
  capEditarCelula, capRestaurarAuto, capToggleSelecionarTodos,
  abrirEdicaoCapacidadesSelecionadas, salvarEdicaoCapacidadesEmMassa,
  restaurarCapacidadesSelecionadas, recalcularCapacidades,
  capInvalidarCache, getCapacidadesRows, getCapacidadeCentralMaterial
});
