'use strict';

// ═══════════════════════════════════════════════════════════
// SOLICITAÇÃO PÚBLICA — lógica da página isolada (solicitacao.html)
// ═══════════════════════════════════════════════════════════
// Sem login. Toda validação "de verdade" acontece no servidor (Edge
// Function solicitacao-dai) — o que está aqui é só conveniência de UX.
//
// Desde 13/11/2026 o envio NÃO gera DAI: vira registros em
// public.solicitacoes (um por categoria de material, atribuído ao
// analista da categoria), tratados na tela Solicitações do app.
//
// Anexos sobem DIRETO pro Storage (bucket privado "solicitacoes-anexos",
// policy só de INSERT pro anon). As assinaturas vão em base64 no envio e
// é o servidor que as grava no bucket.
// ═══════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://kgbmswykhqhmcajxlvri.supabase.co';
// Chave "anon" legada (JWT) — a publicável nova (sb_publishable_...) não
// aplicava o papel anon nos uploads do Storage (confirmado por teste).
const SUPABASE_PUBLISHABLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtnYm1zd3lraHFobWNhanhsdnJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5NDU5NjEsImV4cCI6MjEwMDUyMTk2MX0.njF0oDlHxJ1DKp_ZcLEGaXnFjCvFLRHnt8N_TGhLJSg';
const FUNCTION_URL = SUPABASE_URL + '/functions/v1/solicitacao-dai';
const TURNSTILE_SITEKEY = '0x4AAAAAAD-V-RBGDDiirGsF';

const ANEXO_MAX_MB = 15;
const ANEXO_MAX_COUNT = 10;
const ANEXO_TIPOS_ACEITOS = /^image\/|^application\/pdf$|^application\/msword$|wordprocessingml/;
const CATEGORIA_TRANSFERENCIA = 'Transferência de material entre filiais';
const CATEGORIA_CANTO = 'Teste de canto';
const CATEGORIA_CUBAGEM = 'Cubagem de agregados';
const CATEGORIA_COLETA = 'Coleta de material';
// Só na coleta: material sem identificação, com a categoria escolhida pelo
// operador (decide o analista).
const SEM_IDENTIFICACAO = 'SEM IDENTIFICAÇÃO';
const CATEGORIAS_MATERIAL_CANTO = ['Aglomerante', 'Agregado Graúdo', 'Agregado Miúdo', 'Aditivo', 'Adição'];
const CANTOS_UNICO_CATEGORIAS = ['Aditivo', 'Adição'];
const CATEGORIAS_AGREGADO = ['Agregado Graúdo', 'Agregado Miúdo'];
const CARGOS = ['Operador', 'Regional', 'Líder Técnico'];
const MAX_VALORES = 20; // pesagens por cubagem
const MAX_FUROS = 9;    // furos na caçamba (cubagem por volume)

// CRÍTICO: mesma origem do app principal — sem estas opções o supabase-js
// reaproveitaria uma sessão logada em outra aba e o upload deixaria de ser
// anônimo (só existe policy de INSERT pra anon nesse bucket).
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

let _catalogo = { centrais: [], materiaisPorCategoria: {}, fornecedores: [], entregas: [], fatoresPorCategoria: {} };
let _anexos = []; // { id, file, nome, tamanho, tipo, path, status: 'pendente'|'enviando'|'ok'|'erro' }
let _anexoSeq = 0;
let turnstileWidgetId = null;

let _itensMateriais = [];
let _itemSeq = 0;
let _informantes = []; // { id, nome, cargo, contato, assinatura (data URL PNG) }
let _infSeq = 0;

// ── Navegação por etapas (wizard) ──────────────────────────────────────
const STEP_LABELS = {
  1: 'Etapa 1 de 5 — Antes de começar',
  2: 'Etapa 2 de 5 — Onde e quando',
  3: 'Etapa 3 de 5 — O que aconteceu',
  4: 'Etapa 4 de 5 — Quem está informando',
  5: 'Etapa 5 de 5 — Comprovantes e assinatura',
};
const TOTAL_STEPS = 5;
let _stepAtual = 1;

function irParaStep(n) {
  document.querySelectorAll('.sol-step').forEach((el) => {
    el.style.display = Number(el.dataset.step) === n ? '' : 'none';
  });
  document.querySelectorAll('.sol-steps-indicator .seg').forEach((el) => {
    const s = Number(el.dataset.seg);
    el.classList.toggle('active', s === n);
    el.classList.toggle('done', s < n);
  });
  const label = document.getElementById('sol-steps-label');
  if (label) label.textContent = STEP_LABELS[n] || '';
  _stepAtual = n;
  // Quadro de assinatura precisa estar visível pra medir o tamanho.
  if (n === TOTAL_STEPS) _renderAssinaturas();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function avancarStep() {
  limparAlerta();
  if (_stepAtual === 2 && !validarSecaoOndeEQuando()) return;
  if (_stepAtual === 3 && !validarSecaoOQueAconteceu()) return;
  if (_stepAtual === 4 && !validarSecaoInformantes()) return;
  irParaStep(Math.min(_stepAtual + 1, TOTAL_STEPS));
}
window.avancarStep = avancarStep;

function voltarStep() {
  limparAlerta();
  irParaStep(Math.max(_stepAtual - 1, 1));
}
window.voltarStep = voltarStep;

// ── Utilidades ─────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || isNaN(bytes)) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}
// Data LOCAL (toISOString é UTC — depois das 21h em Brasília já seria amanhã).
function hoje() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
function _valorAtual(id) { return (document.getElementById(id)?.value || '').trim(); }
function _num(v) { return parseFloat(String(v ?? '').replace(',', '.')); }
function _positivo(v) { const n = _num(v); return Number.isFinite(n) && n > 0; }
function _fmt2(n) { return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function _fmtKg(n) { return Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' kg'; }
function _normText(v) { return String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase(); }
function _item(id) { return _itensMateriais.find((i) => i.id === id); }

function mostrarAlerta(msg, tipo) {
  const area = document.getElementById('sol-alert-area');
  const cls = tipo === 'error' ? 'sol-alert-error' : 'sol-alert-info';
  const icon = tipo === 'error' ? 'ti-alert-triangle' : 'ti-info-circle';
  area.innerHTML = `<div class="sol-alert ${cls}"><i class="ti ${icon}"></i><div>${escapeHtml(msg)}</div></div>`;
  area.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function limparAlerta() { document.getElementById('sol-alert-area').innerHTML = ''; }
function _erro(msg) { mostrarAlerta(msg, 'error'); return false; }

// ── Validação por seção ────────────────────────────────────────────────
function validarSecaoOndeEQuando() {
  const dataOcorrido = _valorAtual('sol-data');
  if (!_valorAtual('sol-central')) return _erro('Selecione a central.');
  if (!dataOcorrido) return _erro('Informe a data do ocorrido.');
  if (dataOcorrido > hoje()) return _erro('A data do ocorrido não pode ser no futuro.');
  return true;
}

function validarSecaoOQueAconteceu() {
  const central = _valorAtual('sol-central');
  const categoriaSituacao = _valorAtual('sol-categoria-situacao');
  const filialDestino = _valorAtual('sol-filial-destino');

  if (!categoriaSituacao) return _erro('Selecione a categoria de situação.');
  if (categoriaSituacao === CATEGORIA_TRANSFERENCIA) {
    if (!filialDestino) return _erro('Selecione a filial de destino.');
    if (filialDestino === central) return _erro('A filial de destino não pode ser igual à central de origem.');
  }
  if (categoriaSituacao === CATEGORIA_COLETA) {
    const motivo = _valorAtual('sol-motivo');
    if (!motivo) return _erro('Selecione o motivo da coleta.');
    if (motivo === 'Outro' && !_valorAtual('sol-motivo-outro')) return _erro('Descreva o motivo da coleta.');
  }
  if (!_itensMateriais.length) return _erro('Adicione ao menos um item.');

  for (const it of _itensMateriais) {
    if (categoriaSituacao === CATEGORIA_CANTO) {
      if (!it.categoriaMaterial) return _erro('Selecione a categoria do material em todos os testes adicionados.');
      if (!_positivo(it.referencia)) return _erro(`Informe um peso/volume de referência válido para "${it.categoriaMaterial}".`);
      const cantos = (it.cantos || []).map(_num);
      if (!cantos.length || cantos.some((c) => isNaN(c) || c < 0)) return _erro(`Preencha todos os cantos para "${it.categoriaMaterial}".`);
    } else if (categoriaSituacao === CATEGORIA_CUBAGEM) {
      if (!it.material) return _erro('Selecione o material em todas as cubagens.');
      const ref = `"${it.material}"`;
      if (!it.fornecedor) return _erro(`Selecione o fornecedor da carreta (${ref}).`);
      const doc = _docLbl(it);
      if (!it.nf.trim()) return _erro(`Informe o número ${doc.da} (${ref}).`);
      if (!it.dataEmissao) return _erro(`Informe a data de emissão ${doc.da} (${ref}).`);
      if (!it.dataRecebimento) return _erro(`Informe a data de recebimento da carga (${ref}).`);
      if (it.dataEmissao > hoje() || it.dataRecebimento > hoje()) return _erro(`As datas não podem ser no futuro (${ref}).`);
      if (it.dataRecebimento < it.dataEmissao) return _erro(`O recebimento não pode ser antes da emissão ${doc.da} (${ref}).`);
      if (!_positivo(it.pesoNf)) return _erro(`Informe o peso descrito ${doc.no} (${ref}).`);
      if (it.metodo === 'pesagem') {
        if (!it.pesagens.length || !it.pesagens.every(_positivo)) return _erro(`Preencha todas as pesagens (${ref}).`);
      } else if (it.metodo === 'cone') {
        if (!it.cones.every((c) => _positivo(c.raio) && _positivo(c.altura))) return _erro(`Preencha raio e altura de todos os cones (${ref}).`);
      } else {
        if (!_positivo(it.comprimento) || !_positivo(it.largura)) return _erro(`Informe comprimento e largura da caçamba (${ref}).`);
        if (!it.alturas.every(_positivo)) return _erro(`Preencha a altura de todos os furos (${ref}).`);
      }
    } else {
      if (!it.material) return _erro('Selecione o material em todas as linhas adicionadas (ou remova as vazias).');
      if (it.material === SEM_IDENTIFICACAO && !it.categoriaSemId) return _erro('Selecione a categoria do material sem identificação.');
      if (!_positivo(it.peso)) return _erro(`Informe um peso válido para "${it.material}".`);
    }
  }

  if (categoriaSituacao !== CATEGORIA_CUBAGEM && !_valorAtual('sol-descricao')) return _erro('Descreva o ocorrido.');
  return true;
}

function validarSecaoInformantes() {
  if (!_informantes.length) return _erro('Informe ao menos um informante.');
  for (const inf of _informantes) {
    if (!inf.nome.trim()) return _erro('Informe o nome em todas as linhas de informante adicionadas (ou remova as vazias).');
    if (!inf.cargo) return _erro(`Selecione o cargo de "${inf.nome}".`);
  }
  return true;
}

function validarSecaoFinal() {
  if (_anexos.some((a) => a.status === 'enviando')) return _erro('Aguarde o envio dos anexos terminar.');
  if (_anexos.some((a) => a.status === 'erro')) return _erro('Remova os anexos que falharam antes de continuar.');
  if (!_anexos.length && !document.getElementById('sol-sem-comprovante-ok').checked) {
    return _erro('Nenhum comprovante anexado: marque a declaração de que você se responsabiliza pela falta de prova, ou anexe os arquivos.');
  }
  const semAssinatura = _informantes.find((i) => !i.assinatura);
  if (semAssinatura) return _erro(`Falta a assinatura de "${semAssinatura.nome}".`);
  return true;
}

// ── Turnstile ────────────────────────────────────────────────────────
function _turnstileRender() {
  if (turnstileWidgetId !== null) return;
  if (typeof turnstile === 'undefined') { setTimeout(_turnstileRender, 400); return; }
  turnstileWidgetId = turnstile.render('#turnstile-solicitacao-widget', { sitekey: TURNSTILE_SITEKEY, theme: 'light' });
}
function _turnstileGetToken() {
  if (typeof turnstile === 'undefined' || turnstileWidgetId === null) return null;
  return turnstile.getResponse(turnstileWidgetId) || null;
}
function _turnstileReset() {
  if (typeof turnstile === 'undefined' || turnstileWidgetId === null) return;
  turnstile.reset(turnstileWidgetId);
}

// ── Catálogo ───────────────────────────────────────────────────────────
async function carregarCatalogo() {
  const resp = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'catalogo' }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data?.error || 'Falha ao carregar catálogo.');
  return data;
}

function popularCentrais() {
  const sel = document.getElementById('sol-central');
  sel.innerHTML = '<option value="">Selecione a central</option>'
    + _catalogo.centrais.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
}

function _materialOptionsHtml(selecionado, soCategorias, comSemId) {
  const grupos = _catalogo.materiaisPorCategoria || {};
  let html = '<option value="">Selecione o material</option>';
  if (comSemId) html += `<option value="${SEM_IDENTIFICACAO}" ${selecionado === SEM_IDENTIFICACAO ? 'selected' : ''}>${SEM_IDENTIFICACAO}</option>`;
  Object.keys(grupos).forEach((categoria) => {
    if (soCategorias && !soCategorias.includes(categoria)) return;
    const itens = grupos[categoria];
    if (!itens || !itens.length) return;
    html += `<optgroup label="${escapeHtml(categoria)}">`
      + itens.map((m) => `<option value="${escapeHtml(m)}" ${m === selecionado ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')
      + '</optgroup>';
  });
  return html;
}

// ── Categoria de situação ─────────────────────────────────────────────
function onCategoriaSituacaoChange() {
  const val = _valorAtual('sol-categoria-situacao');
  const wrap = document.getElementById('sol-fg-filial-destino');
  const sel = document.getElementById('sol-filial-destino');
  if (val === CATEGORIA_TRANSFERENCIA) {
    wrap.style.display = '';
    _popularFilialDestino();
  } else {
    wrap.style.display = 'none';
    sel.value = '';
  }
  document.getElementById('sol-campos-situacao').style.display = val ? '' : 'none';
  document.getElementById('sol-fg-motivo').style.display = val === CATEGORIA_COLETA ? '' : 'none';
  if (val !== CATEGORIA_COLETA) {
    _itensMateriais.forEach((it) => { if (it.material === SEM_IDENTIFICACAO) it.material = ''; });
  }
  // Cubagem não pede descrição — os dados da carreta já dizem tudo.
  document.getElementById('sol-fg-descricao').style.display = val === CATEGORIA_CUBAGEM ? 'none' : '';
  const addLabel = document.getElementById('sol-add-item-label');
  if (addLabel) {
    addLabel.textContent = val === CATEGORIA_CANTO ? 'Adicionar outro teste de canto'
      : val === CATEGORIA_CUBAGEM ? 'Adicionar outra carreta' : 'Adicionar outro material';
  }
  _renderItensMateriais();
}
window.onCategoriaSituacaoChange = onCategoriaSituacaoChange;

function onMotivoChange() {
  const outro = document.getElementById('sol-motivo-outro');
  outro.style.display = _valorAtual('sol-motivo') === 'Outro' ? '' : 'none';
  if (outro.style.display) outro.value = '';
}
window.onMotivoChange = onMotivoChange;

// "SEM IDENTIFICAÇÃO" mostra/esconde o campo de categoria → re-renderiza.
function _onMaterialChange(id, value) {
  _setCampo(id, 'material', value);
  _renderItensMateriais();
}
window._onMaterialChange = _onMaterialChange;

function _popularFilialDestino() {
  const origem = _valorAtual('sol-central');
  const sel = document.getElementById('sol-filial-destino');
  const valorAtual = sel.value;
  const opcoes = (_catalogo.centrais || []).filter((c) => c !== origem);
  sel.innerHTML = '<option value="">Selecione a filial de destino</option>'
    + opcoes.map((c) => `<option value="${escapeHtml(c)}" ${c === valorAtual ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
}

// ── Itens — lista dinâmica ─────────────────────────────────────────────
// O mesmo objeto serve aos três modos (material + peso, teste de canto,
// cubagem); a categoria de situação decide quais campos são renderizados.
function _novoItemMaterial() {
  return {
    id: 'im' + (_itemSeq++),
    material: '', peso: '', categoriaSemId: '',
    // teste de canto
    categoriaMaterial: '', unidade: 'kg', qtdCantos: 4, referencia: '', cantos: ['', '', '', ''],
    // cubagem
    fornecedor: '', docTipo: 'NF', nf: '', dataEmissao: '', dataRecebimento: '', pesoNf: '', umNf: 'M3',
    metodo: 'pesagem', pesagens: [''], comprimento: '', largura: '', alturas: ['', '', ''],
    cones: [{ raio: '', altura: '' }],
  };
}

function adicionarItemMaterial() {
  _itensMateriais.push(_novoItemMaterial());
  _renderItensMateriais();
}
window.adicionarItemMaterial = adicionarItemMaterial;

function removerItemMaterial(id) {
  if (_itensMateriais.length <= 1) return;
  _itensMateriais = _itensMateriais.filter((i) => i.id !== id);
  _renderItensMateriais();
}
window.removerItemMaterial = removerItemMaterial;

// Atualiza um campo simples. `recalc` = só refaz o resultado (sem
// re-renderizar a lista, pra não perder o foco de quem está digitando).
function _setCampo(id, campo, value, recalc) {
  const it = _item(id);
  if (!it) return;
  it[campo] = value;
  if (recalc) _atualizarResultado(id);
}
window._setCampo = _setCampo;

function _setValor(id, lista, idx, value) {
  const it = _item(id);
  if (!it) return;
  it[lista][idx] = value;
  _atualizarResultado(id);
}
window._setValor = _setValor;

// ── Teste de canto ─────────────────────────────────────────────────────
function _onCategoriaMaterialCantoChange(id, value) {
  const it = _item(id);
  if (!it) return;
  it.categoriaMaterial = value;
  if (CANTOS_UNICO_CATEGORIAS.includes(value)) { it.qtdCantos = 1; it.cantos = [it.cantos[0] || '']; }
  _renderItensMateriais();
}
window._onCategoriaMaterialCantoChange = _onCategoriaMaterialCantoChange;

function _onQtdCantosChange(id, value) {
  const it = _item(id);
  if (!it) return;
  const n = Math.min(4, Math.max(1, parseInt(value, 10) || 1));
  it.qtdCantos = n;
  it.cantos = Array.from({ length: n }).map((_, idx) => it.cantos[idx] || '');
  _renderItensMateriais();
}
window._onQtdCantosChange = _onQtdCantosChange;

function _calcCanto(it) {
  const ref = _num(it.referencia);
  const cantos = (it.cantos || []).map(_num);
  if (!Number.isFinite(ref) || ref <= 0 || !cantos.length || cantos.some((c) => !Number.isFinite(c))) return null;
  const media = cantos.reduce((a, b) => a + b, 0) / cantos.length;
  const variacaoAbs = media - ref;
  return { media, variacaoAbs, variacaoPct: (variacaoAbs / ref) * 100 };
}

// ── Cubagem ───────────────────────────────────────────────────────────
// Fator M3→KG das Configurações do analista da categoria e do ADM (o
// catálogo já manda nessa ordem). Fator do fornecedor > padrão do
// material; mesma regra de _lookupFatorConversao (ui.js) e da Edge
// Function. ponytail: regra copiada nos 3 lugares — mudar junto.
function _categoriaDoMaterial(material) {
  const grupos = _catalogo.materiaisPorCategoria || {};
  return Object.keys(grupos).find((c) => (grupos[c] || []).includes(material)) || '';
}

function _lookupFatorM3(material, fornecedor) {
  const m = _normText(material);
  const f = _normText(fornecedor);
  const fatores = (_catalogo.fatoresPorCategoria || {})[_categoriaDoMaterial(material)] || [];
  const cand = fatores.filter((r) => r.grupo && m.includes(_normText(r.grupo)));
  if (!cand.length) return null;
  const esp = f ? cand.filter((r) => r.fornecedor && f.includes(_normText(r.fornecedor))) : [];
  const pool = esp.length ? esp : cand.filter((r) => !r.fornecedor);
  if (!pool.length) return null;
  return [...pool].sort((a, b) => b.grupo.length - a.grupo.length)[0];
}

// Tudo em KG. Sem fator de densidade, o que depende de M3 fica null (o
// analista converte) — nunca se inventa densidade.
function _calcCubagem(it) {
  const pesoNf = _num(it.pesoNf);
  const fatorRow = _lookupFatorM3(it.material, it.fornecedor);
  const fator = fatorRow ? fatorRow.fator : null;
  let nfKg = null;
  if (pesoNf > 0) nfKg = it.umNf === 'KG' ? pesoNf : it.umNf === 'TO' ? pesoNf * 1000 : (fator ? pesoNf * fator : null);

  let volumeM3 = null, aferidoKg = null;
  if (it.metodo === 'pesagem') {
    if (it.pesagens.length && it.pesagens.every(_positivo)) aferidoKg = it.pesagens.reduce((a, b) => a + _num(b), 0);
  } else if (it.metodo === 'cone') {
    // Cone: π × r² × h ÷ 3, somado entre os cones da carreta.
    if (it.cones.length && it.cones.every((c) => _positivo(c.raio) && _positivo(c.altura))) {
      volumeM3 = it.cones.reduce((a, c) => a + Math.PI * _num(c.raio) ** 2 * _num(c.altura) / 3, 0);
      aferidoKg = fator ? volumeM3 * fator : null;
    }
  } else if (_positivo(it.comprimento) && _positivo(it.largura) && it.alturas.length && it.alturas.every(_positivo)) {
    const alturaMedia = it.alturas.reduce((a, b) => a + _num(b), 0) / it.alturas.length;
    volumeM3 = _num(it.comprimento) * _num(it.largura) * alturaMedia;
    aferidoKg = fator ? volumeM3 * fator : null;
  }
  const precisaFator = it.umNf === 'M3' || it.metodo !== 'pesagem';
  const variacaoKg = nfKg !== null && aferidoKg !== null ? aferidoKg - nfKg : null;
  return {
    fator, nfKg, volumeM3, aferidoKg, variacaoKg,
    variacaoPct: variacaoKg !== null && nfKg ? (variacaoKg / nfKg) * 100 : null,
    semFator: precisaFator && !fator && !!it.material,
  };
}

function _setVar(el, txt, alerta) {
  if (!el) return;
  el.textContent = txt;
  el.classList.toggle('alerta', !!alerta);
}

// Atualiza só os textos de resultado do item (sem re-renderizar).
function _atualizarResultado(id) {
  const it = _item(id);
  if (!it) return;
  const situacao = _valorAtual('sol-categoria-situacao');
  if (situacao === CATEGORIA_CANTO) {
    const r = _calcCanto(it);
    const sinal = r && r.variacaoAbs >= 0 ? '+' : '';
    _setVar(document.getElementById('sol-var-' + id),
      r ? `${sinal}${_fmt2(r.variacaoPct)}% (${sinal}${_fmt2(r.variacaoAbs)} ${it.unidade})` : '—',
      r && Math.abs(r.variacaoPct) >= 1);
  } else if (situacao === CATEGORIA_CUBAGEM) {
    const r = _calcCubagem(it);
    _setVar(document.getElementById('sol-cub-nf-' + id), r.nfKg !== null ? _fmtKg(r.nfKg) : '—');
    const volTxt = r.volumeM3 !== null ? ` (${r.volumeM3.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} m³)` : '';
    _setVar(document.getElementById('sol-cub-af-' + id), r.aferidoKg !== null ? _fmtKg(r.aferidoKg) + volTxt : (volTxt ? volTxt.trim() : '—'));
    const sinal = r.variacaoKg !== null && r.variacaoKg >= 0 ? '+' : '';
    _setVar(document.getElementById('sol-cub-var-' + id),
      r.variacaoKg !== null ? `${sinal}${_fmt2(r.variacaoPct)}% (${sinal}${_fmtKg(r.variacaoKg)})` : '—',
      r.variacaoPct !== null && Math.abs(r.variacaoPct) >= 1);
    const nota = document.getElementById('sol-cub-nota-' + id);
    if (nota) nota.style.display = r.semFator ? '' : 'none';
  }
}

// ── HTML dos itens ─────────────────────────────────────────────────────
function _btnRemover(it, titulo) {
  return _itensMateriais.length > 1
    ? `<button type="button" class="sol-item-row-rm" onclick="removerItemMaterial('${it.id}')" title="${titulo}"><i class="ti ti-x"></i></button>`
    : '';
}

function _inputNum(id, campo, valor, placeholder) {
  return `<input type="number" class="sol-input" step="0.01" min="0" inputmode="decimal" placeholder="${placeholder || '0,00'}" value="${escapeHtml(valor)}" oninput="_setCampo('${id}', '${campo}', this.value, true)">`;
}

function _htmlItemMaterial(it) {
  const coleta = _valorAtual('sol-categoria-situacao') === CATEGORIA_COLETA;
  const semId = coleta && it.material === SEM_IDENTIFICACAO;
  return `
    <div class="sol-item-row" data-item-id="${it.id}">
      <div class="sol-fg">
        <label class="sol-label">Material <span class="sol-required">*</span> <span class="sol-hint">(grupo SAP)</span></label>
        <select class="sol-select" onchange="_onMaterialChange('${it.id}', this.value)">
          ${_materialOptionsHtml(it.material, null, coleta)}
        </select>
      </div>
      ${semId ? `<div class="sol-fg">
        <label class="sol-label">Categoria <span class="sol-required">*</span></label>
        <select class="sol-select" onchange="_setCampo('${it.id}', 'categoriaSemId', this.value)">
          <option value="">Selecione</option>
          ${CATEGORIAS_MATERIAL_CANTO.map((c) => `<option value="${c}" ${it.categoriaSemId === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>` : ''}
      <div class="sol-fg sol-fg-peso">
        <label class="sol-label">Peso (kg) <span class="sol-required">*</span></label>
        ${_inputNum(it.id, 'peso', it.peso)}
      </div>
      ${_btnRemover(it, 'Remover material')}
    </div>`;
}

// Teste de canto: peso/volume de referência conhecido lido em cada canto
// da balança — mostra objetivamente o quanto ela está descalibrada.
function _htmlItemCanto(it) {
  const cantoUnico = CANTOS_UNICO_CATEGORIAS.includes(it.categoriaMaterial);
  const qtd = cantoUnico ? 1 : (it.qtdCantos || 4);
  const cantosHtml = Array.from({ length: qtd }).map((_, idx) => `
    <div class="sol-fg" style="margin-bottom:0">
      <label class="sol-label">Canto ${idx + 1} <span class="sol-required">*</span></label>
      <input type="number" class="sol-input" step="0.01" min="0" inputmode="decimal" placeholder="0,00" value="${escapeHtml(it.cantos[idx] ?? '')}" oninput="_setValor('${it.id}', 'cantos', ${idx}, this.value)">
    </div>`).join('');

  return `
    <div class="sol-item-balanca" data-item-id="${it.id}">
      ${_btnRemover(it, 'Remover teste')}
      <div class="sol-grid">
        <div class="sol-fg">
          <label class="sol-label">Categoria do Material <span class="sol-required">*</span></label>
          <select class="sol-select" onchange="_onCategoriaMaterialCantoChange('${it.id}', this.value)">
            <option value="">Selecione</option>
            ${CATEGORIAS_MATERIAL_CANTO.map((c) => `<option value="${c}" ${it.categoriaMaterial === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <div class="sol-fg">
          <label class="sol-label">Unidade <span class="sol-required">*</span></label>
          <select class="sol-select" onchange="_setCampo('${it.id}', 'unidade', this.value, true)">
            <option value="kg" ${it.unidade === 'kg' ? 'selected' : ''}>Quilogramas (kg)</option>
            <option value="L" ${it.unidade === 'L' ? 'selected' : ''}>Litros (L)</option>
          </select>
        </div>
      </div>
      <div class="sol-grid">
        <div class="sol-fg">
          <label class="sol-label">Peso/Volume de Referência <span class="sol-required">*</span> <span class="sol-hint">(valor conhecido usado no teste)</span></label>
          ${_inputNum(it.id, 'referencia', it.referencia)}
        </div>
        <div class="sol-fg">
          <label class="sol-label">Quantidade de Cantos <span class="sol-required">*</span></label>
          <select class="sol-select" ${cantoUnico ? 'disabled' : ''} onchange="_onQtdCantosChange('${it.id}', this.value)">
            ${[1, 2, 3, 4].map((n) => `<option value="${n}" ${(cantoUnico ? 1 : it.qtdCantos) === n ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
          ${cantoUnico ? '<span class="sol-hint">Aditivos e Adições usam sempre 1 canto</span>' : ''}
        </div>
      </div>
      <div class="sol-cantos-grid">${cantosHtml}</div>
      <div class="sol-fg" style="margin-bottom:0">
        <label class="sol-label">Variação apurada</label>
        <div class="sol-var-display" id="sol-var-${it.id}">—</div>
      </div>
    </div>`;
}

// ── Cubagem: estrutura (método, nº de pesagens/furos) re-renderiza ─────
function _onMetodoCubagemChange(id, value) {
  const it = _item(id);
  if (!it) return;
  it.metodo = ['volume', 'cone'].includes(value) ? value : 'pesagem';
  _renderItensMateriais();
}
window._onMetodoCubagemChange = _onMetodoCubagemChange;

function _addCone(id) {
  const it = _item(id);
  if (!it || it.cones.length >= MAX_VALORES) return;
  it.cones.push({ raio: '', altura: '' });
  _renderItensMateriais();
}
window._addCone = _addCone;

function _rmCone(id, idx) {
  const it = _item(id);
  if (!it || it.cones.length <= 1) return;
  it.cones.splice(idx, 1);
  _renderItensMateriais();
}
window._rmCone = _rmCone;

function _setCone(id, idx, campo, value) {
  const it = _item(id);
  if (!it || !it.cones[idx]) return;
  it.cones[idx][campo] = value;
  _atualizarResultado(id);
}
window._setCone = _setCone;

function _addPesagem(id) {
  const it = _item(id);
  if (!it || it.pesagens.length >= MAX_VALORES) return;
  it.pesagens.push('');
  _renderItensMateriais();
}
window._addPesagem = _addPesagem;

function _rmPesagem(id, idx) {
  const it = _item(id);
  if (!it || it.pesagens.length <= 1) return;
  it.pesagens.splice(idx, 1);
  _renderItensMateriais();
}
window._rmPesagem = _rmPesagem;

function _onQtdFurosChange(id, value) {
  const it = _item(id);
  if (!it) return;
  const n = Math.min(MAX_FUROS, Math.max(1, parseInt(value, 10) || 1));
  it.alturas = Array.from({ length: n }).map((_, idx) => it.alturas[idx] || '');
  _renderItensMateriais();
}
window._onQtdFurosChange = _onQtdFurosChange;

// Fornecedores que já entregaram o material na central escolhida (Entradas
// do ADM). Sem nenhuma entrega registrada na combinação, cai pra lista
// completa — não trava a primeira entrega de um fornecedor novo ali.
function _fornecedoresDaCubagem(material) {
  const central = _normText(_valorAtual('sol-central'));
  const todos = _catalogo.fornecedores || [];
  if (!material || !central) return { lista: todos, filtrado: false };
  const lista = [...new Set((_catalogo.entregas || [])
    .filter((e) => e.m === material && _normText(e.c) === central).map((e) => e.f))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return lista.length ? { lista, filtrado: true } : { lista: todos, filtrado: false };
}

function _onMaterialCubagemChange(id, value) {
  const it = _item(id);
  if (!it) return;
  it.material = value;
  if (it.fornecedor && !_fornecedoresDaCubagem(value).lista.includes(it.fornecedor)) it.fornecedor = '';
  _renderItensMateriais();
}
window._onMaterialCubagemChange = _onMaterialCubagemChange;

// Documento da carreta: NF ou ticket (de pesagem/balança). Só muda os
// rótulos — os campos são os mesmos (número, emissão, peso, unidade).
function _docLbl(it) {
  return it.docTipo === 'TICKET' ? { da: 'do ticket', no: 'no ticket' } : { da: 'da NF', no: 'na NF' };
}

function _onDocTipoChange(id, value) {
  const it = _item(id);
  if (!it) return;
  it.docTipo = value === 'TICKET' ? 'TICKET' : 'NF';
  _renderItensMateriais();
}
window._onDocTipoChange = _onDocTipoChange;

function _htmlItemCubagem(it) {
  const doc = _docLbl(it);
  const { lista: fornecedores, filtrado } = _fornecedoresDaCubagem(it.material);
  const fornOpts = fornecedores.length
    ? '<option value="">Selecione o fornecedor</option>' + fornecedores.map((f) => `<option value="${escapeHtml(f)}" ${f === it.fornecedor ? 'selected' : ''}>${escapeHtml(f)}</option>`).join('')
    : '<option value="">Nenhum fornecedor disponível — avise o analista</option>';
  const fornHint = !it.material ? '<span class="sol-hint">Selecione o material para ver quem entrega nesta central.</span>'
    : filtrado ? '<span class="sol-hint">Fornecedores que já entregaram este material nesta central.</span>'
    : fornecedores.length ? '<span class="sol-hint" style="color:var(--amber)">Nenhuma entrega deste material registrada nesta central — mostrando todos os fornecedores.</span>' : '';

  const metodoHtml = it.metodo === 'pesagem'
    ? `<div class="sol-sub-title">Pesagens (kg)</div>
       <div class="sol-valores">
         ${it.pesagens.map((v, idx) => `
           <div class="sol-valor">
             <div class="sol-fg">
               <label class="sol-label">Pesagem ${idx + 1} <span class="sol-required">*</span></label>
               <input type="number" class="sol-input" step="0.01" min="0" inputmode="decimal" placeholder="0,00" value="${escapeHtml(v)}" oninput="_setValor('${it.id}', 'pesagens', ${idx}, this.value)">
             </div>
             ${it.pesagens.length > 1 ? `<button type="button" class="sol-item-row-rm" onclick="_rmPesagem('${it.id}', ${idx})" title="Remover pesagem"><i class="ti ti-x"></i></button>` : ''}
           </div>`).join('')}
       </div>
       ${it.pesagens.length < MAX_VALORES ? `<button type="button" class="sol-btn sol-add-row-btn" onclick="_addPesagem('${it.id}')"><i class="ti ti-plus"></i> Adicionar pesagem</button>` : ''}`
    : it.metodo === 'cone'
    ? `<div class="sol-sub-title">Cones (metros)</div>
       ${it.cones.map((c, idx) => `
         <div class="sol-valor" style="margin-bottom:10px">
           <div class="sol-fg">
             <label class="sol-label">Cone ${idx + 1} — raio (m) <span class="sol-required">*</span></label>
             <input type="number" class="sol-input" step="0.01" min="0" inputmode="decimal" placeholder="0,00" value="${escapeHtml(c.raio)}" oninput="_setCone('${it.id}', ${idx}, 'raio', this.value)">
           </div>
           <div class="sol-fg">
             <label class="sol-label">Altura (m) <span class="sol-required">*</span></label>
             <input type="number" class="sol-input" step="0.01" min="0" inputmode="decimal" placeholder="0,00" value="${escapeHtml(c.altura)}" oninput="_setCone('${it.id}', ${idx}, 'altura', this.value)">
           </div>
           ${it.cones.length > 1 ? `<button type="button" class="sol-item-row-rm" onclick="_rmCone('${it.id}', ${idx})" title="Remover cone"><i class="ti ti-x"></i></button>` : ''}
         </div>`).join('')}
       ${it.cones.length < MAX_VALORES ? `<button type="button" class="sol-btn sol-add-row-btn" onclick="_addCone('${it.id}')"><i class="ti ti-plus"></i> Adicionar cone</button>` : ''}
       <div><span class="sol-hint">Volume de cada cone = π × raio² × altura ÷ 3; o total é a soma dos cones.</span></div>`
    : `<div class="sol-sub-title">Medidas da caçamba (metros)</div>
       <div class="sol-grid-3">
         <div class="sol-fg">
           <label class="sol-label">Comprimento (m) <span class="sol-required">*</span></label>
           ${_inputNum(it.id, 'comprimento', it.comprimento)}
         </div>
         <div class="sol-fg">
           <label class="sol-label">Largura (m) <span class="sol-required">*</span></label>
           ${_inputNum(it.id, 'largura', it.largura)}
         </div>
         <div class="sol-fg">
           <label class="sol-label">Quantidade de furos <span class="sol-required">*</span></label>
           <select class="sol-select" onchange="_onQtdFurosChange('${it.id}', this.value)">
             ${Array.from({ length: MAX_FUROS }).map((_, i) => `<option value="${i + 1}" ${it.alturas.length === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}
           </select>
         </div>
       </div>
       <div class="sol-valores">
         ${it.alturas.map((v, idx) => `
           <div class="sol-fg" style="margin-bottom:0">
             <label class="sol-label">Altura furo ${idx + 1} (m) <span class="sol-required">*</span></label>
             <input type="number" class="sol-input" step="0.01" min="0" inputmode="decimal" placeholder="0,00" value="${escapeHtml(v)}" oninput="_setValor('${it.id}', 'alturas', ${idx}, this.value)">
           </div>`).join('')}
       </div>
       <span class="sol-hint">Volume = comprimento × largura × média das alturas.</span>`;

  return `
    <div class="sol-item-cubagem" data-item-id="${it.id}">
      ${_btnRemover(it, 'Remover cubagem')}
      <div class="sol-sub-title">Documento da carreta</div>
      <div class="sol-grid">
        <div class="sol-fg">
          <label class="sol-label">Material cubado <span class="sol-required">*</span> <span class="sol-hint">(grupo SAP)</span></label>
          <select class="sol-select" onchange="_onMaterialCubagemChange('${it.id}', this.value)">
            ${_materialOptionsHtml(it.material, CATEGORIAS_AGREGADO)}
          </select>
        </div>
        <div class="sol-fg">
          <label class="sol-label">Fornecedor <span class="sol-required">*</span></label>
          <select class="sol-select" onchange="_setCampo('${it.id}', 'fornecedor', this.value, true)">${fornOpts}</select>
          ${fornHint}
        </div>
      </div>
      <div class="sol-grid-3">
        <div class="sol-fg">
          <label class="sol-label">Nº ${doc.da} <span class="sol-required">*</span></label>
          <div style="display:flex;gap:6px">
            <select class="sol-select" style="width:auto;flex-shrink:0" onchange="_onDocTipoChange('${it.id}', this.value)" title="Tipo de documento">
              <option value="NF" ${it.docTipo === 'NF' ? 'selected' : ''}>NF</option>
              <option value="TICKET" ${it.docTipo === 'TICKET' ? 'selected' : ''}>Ticket</option>
            </select>
            <input type="text" class="sol-input" maxlength="30" placeholder="000000" value="${escapeHtml(it.nf)}" oninput="_setCampo('${it.id}', 'nf', this.value)">
          </div>
        </div>
        <div class="sol-fg">
          <label class="sol-label">Emissão ${doc.da} <span class="sol-required">*</span></label>
          <input type="date" class="sol-input" max="${hoje()}" value="${escapeHtml(it.dataEmissao)}" onchange="_setCampo('${it.id}', 'dataEmissao', this.value)">
        </div>
        <div class="sol-fg">
          <label class="sol-label">Recebimento da carga <span class="sol-required">*</span></label>
          <input type="date" class="sol-input" max="${hoje()}" value="${escapeHtml(it.dataRecebimento)}" onchange="_setCampo('${it.id}', 'dataRecebimento', this.value)">
        </div>
      </div>
      <div class="sol-grid">
        <div class="sol-fg">
          <label class="sol-label">Peso descrito ${doc.no} <span class="sol-required">*</span></label>
          ${_inputNum(it.id, 'pesoNf', it.pesoNf)}
        </div>
        <div class="sol-fg">
          <label class="sol-label">Unidade ${doc.no} <span class="sol-required">*</span></label>
          <select class="sol-select" onchange="_setCampo('${it.id}', 'umNf', this.value, true)">
            <option value="M3" ${it.umNf === 'M3' ? 'selected' : ''}>M³ — metro cúbico</option>
            <option value="TO" ${it.umNf === 'TO' ? 'selected' : ''}>TO — tonelada</option>
            <option value="KG" ${it.umNf === 'KG' ? 'selected' : ''}>KG — quilograma</option>
          </select>
        </div>
      </div>
      <div class="sol-fg">
        <label class="sol-label">Método de cubagem <span class="sol-required">*</span></label>
        <select class="sol-select" onchange="_onMetodoCubagemChange('${it.id}', this.value)">
          <option value="pesagem" ${it.metodo === 'pesagem' ? 'selected' : ''}>Por pesagem</option>
          <option value="volume" ${it.metodo === 'volume' ? 'selected' : ''}>Por volume (furos na caçamba)</option>
          <option value="cone" ${it.metodo === 'cone' ? 'selected' : ''}>Por cone</option>
        </select>
      </div>
      ${metodoHtml}
      <div class="sol-resultado">
        <div class="sol-fg" style="margin-bottom:0"><label class="sol-label">Peso ${doc.da} (kg)</label><div class="sol-var-display" id="sol-cub-nf-${it.id}">—</div></div>
        <div class="sol-fg" style="margin-bottom:0"><label class="sol-label">Total aferido</label><div class="sol-var-display" id="sol-cub-af-${it.id}">—</div></div>
        <div class="sol-fg" style="margin-bottom:0"><label class="sol-label">Variação</label><div class="sol-var-display" id="sol-cub-var-${it.id}">—</div></div>
      </div>
      <div class="sol-resultado-nota" id="sol-cub-nota-${it.id}" style="display:none"><i class="ti ti-info-circle"></i> Sem fator de densidade cadastrado para este material/fornecedor — o analista fará a conversão de m³ para kg.</div>
    </div>`;
}

function _renderItensMateriais() {
  const el = document.getElementById('sol-itens-lista');
  const situacao = _valorAtual('sol-categoria-situacao');
  const fn = situacao === CATEGORIA_CANTO ? _htmlItemCanto : situacao === CATEGORIA_CUBAGEM ? _htmlItemCubagem : _htmlItemMaterial;
  el.innerHTML = _itensMateriais.map(fn).join('');
  _itensMateriais.forEach((it) => _atualizarResultado(it.id));
}

// ── Informantes — lista dinâmica ───────────────────────────────────────
function _novoInformante() { return { id: 'inf' + (_infSeq++), nome: '', cargo: '', contato: '', assinatura: '' }; }

function adicionarInformante() {
  _informantes.push(_novoInformante());
  _renderInformantes();
}
window.adicionarInformante = adicionarInformante;

function removerInformante(id) {
  if (_informantes.length <= 1) return;
  _informantes = _informantes.filter((i) => i.id !== id);
  _renderInformantes();
}
window.removerInformante = removerInformante;

function _onInfChange(id, campo, value) {
  const inf = _informantes.find((i) => i.id === id);
  if (inf) inf[campo] = value;
}
window._onInfChange = _onInfChange;

// Máscara simples de telefone BR: (99) 99999-9999 / (99) 9999-9999
function _maskTelefone(el) {
  let v = el.value.replace(/\D/g, '').slice(0, 11);
  if (v.length > 10) v = v.replace(/^(\d{2})(\d{5})(\d{0,4}).*/, '($1) $2-$3');
  else if (v.length > 6) v = v.replace(/^(\d{2})(\d{4})(\d{0,4}).*/, '($1) $2-$3');
  else if (v.length > 2) v = v.replace(/^(\d{2})(\d{0,5})/, '($1) $2');
  else if (v.length > 0) v = v.replace(/^(\d{0,2})/, '($1');
  el.value = v;
}
window._maskTelefone = _maskTelefone;

function _renderInformantes() {
  const el = document.getElementById('sol-informantes-lista');
  el.innerHTML = _informantes.map((inf) => `
    <div class="sol-informante-card" data-inf-id="${inf.id}">
      ${_informantes.length > 1 ? `<button type="button" class="sol-item-row-rm" onclick="removerInformante('${inf.id}')" title="Remover informante"><i class="ti ti-x"></i></button>` : ''}
      <div class="sol-grid-3">
        <div class="sol-fg">
          <label class="sol-label">Nome <span class="sol-required">*</span></label>
          <input type="text" class="sol-input" placeholder="Nome completo" value="${escapeHtml(inf.nome)}" oninput="_onInfChange('${inf.id}','nome',this.value)">
        </div>
        <div class="sol-fg">
          <label class="sol-label">Cargo <span class="sol-required">*</span></label>
          <select class="sol-select" onchange="_onInfChange('${inf.id}','cargo',this.value)">
            <option value="">Selecione</option>
            ${CARGOS.map((c) => `<option value="${c}" ${inf.cargo === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <div class="sol-fg">
          <label class="sol-label">Contato WhatsApp <span class="sol-hint">(opcional)</span></label>
          <input type="text" class="sol-input" placeholder="(00) 00000-0000" inputmode="numeric" maxlength="15" value="${escapeHtml(inf.contato)}" oninput="_maskTelefone(this); _onInfChange('${inf.id}','contato',this.value)">
        </div>
      </div>
    </div>`).join('');
}

// ── Assinatura na tela (termo de responsabilidade) ─────────────────────
// Um quadro por informante. O traço vira PNG (fundo branco, tinta preta)
// guardado em inf.assinatura a cada traço terminado — voltar de etapa e
// retornar redesenha a assinatura já feita.
function _renderAssinaturas() {
  const el = document.getElementById('sol-assinaturas-lista');
  el.innerHTML = _informantes.map((inf) => `
    <div class="sol-assinatura">
      <div class="sol-assinatura-decl">
        Eu, <strong>${escapeHtml(inf.nome)}</strong>${inf.cargo ? ` (${escapeHtml(inf.cargo)})` : ''}, DECLARO que as informações por mim prestadas neste registro são verídicas e assumo a responsabilidade por elas perante o setor de Estoque/Insumos e a diretoria da Concrelagos, ciente das consequências da prestação de informações falsas ou inexatas.
      </div>
      <div class="sol-assinatura-pad">
        <canvas id="sol-pad-${inf.id}"></canvas>
        <div class="linha"></div>
        <div class="vazio" id="sol-pad-vazio-${inf.id}">Assine aqui</div>
      </div>
      <div class="sol-assinatura-rodape">
        <span id="sol-pad-status-${inf.id}"></span>
        <button type="button" class="sol-btn sol-add-row-btn" style="margin:0" onclick="_limparAssinatura('${inf.id}')"><i class="ti ti-eraser"></i> Limpar</button>
      </div>
    </div>`).join('');
  _informantes.forEach(_initPad);
}

function _padStatus(inf) {
  const st = document.getElementById('sol-pad-status-' + inf.id);
  const vazio = document.getElementById('sol-pad-vazio-' + inf.id);
  if (st) st.innerHTML = inf.assinatura ? '<span class="ok"><i class="ti ti-check"></i> Assinado</span>' : 'Não assinado';
  if (vazio) vazio.style.display = inf.assinatura ? 'none' : '';
}

function _padFundo(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function _initPad(inf) {
  const canvas = document.getElementById('sol-pad-' + inf.id);
  if (!canvas) return;
  // Resolução limitada a 2x — assinatura não precisa de mais, e mantém o
  // PNG pequeno (vai em base64 no envio).
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#111';
  _padFundo(canvas);
  if (inf.assinatura) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, canvas.clientWidth, canvas.clientHeight);
    img.src = inf.assinatura;
  }
  _padStatus(inf);

  let desenhando = false;
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    desenhando = true;
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!desenhando) return;
    const [x, y] = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  });
  const fim = () => {
    if (!desenhando) return;
    desenhando = false;
    inf.assinatura = canvas.toDataURL('image/png');
    _padStatus(inf);
  };
  canvas.addEventListener('pointerup', fim);
  canvas.addEventListener('pointercancel', fim);
}

function _limparAssinatura(id) {
  const inf = _informantes.find((i) => i.id === id);
  const canvas = document.getElementById('sol-pad-' + id);
  if (!inf || !canvas) return;
  inf.assinatura = '';
  _padFundo(canvas);
  _padStatus(inf);
}
window._limparAssinatura = _limparAssinatura;

// ── Anexos ──────────────────────────────────────────────────────────
function _renderAnexos() {
  const el = document.getElementById('sol-anexo-lista');
  document.getElementById('sol-sem-comprovante').style.display = _anexos.length ? 'none' : '';
  if (!_anexos.length) { el.innerHTML = ''; return; }
  el.innerHTML = _anexos.map((a) => {
    const statusHtml = a.status === 'ok'
      ? '<span class="sol-anexo-chip-status ok"><i class="ti ti-check"></i></span>'
      : a.status === 'enviando'
      ? '<span class="sol-anexo-chip-status up">enviando…</span>'
      : a.status === 'erro'
      ? '<span class="sol-anexo-chip-status err" title="Falha no envio — remova e tente novamente">falhou</span>'
      : '';
    return `
      <div class="sol-anexo-chip">
        <i class="ti ti-paperclip"></i>
        <span class="sol-anexo-chip-nome">${escapeHtml(a.nome)}</span>
        <span class="sol-anexo-chip-tam">${formatBytes(a.tamanho)}</span>
        ${statusHtml}
        <button type="button" class="sol-anexo-chip-rm" onclick="removerAnexo('${a.id}')" title="Remover"><i class="ti ti-x"></i></button>
      </div>`;
  }).join('');
}

async function _uploadAnexo(anexo) {
  anexo.status = 'enviando';
  _renderAnexos();
  const pastaId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
  const nomeSeguro = anexo.file.name.replace(/[^a-zA-Z0-9_.\-]/g, '_').slice(-120);
  const path = `publico/${pastaId}/${nomeSeguro}`;
  try {
    const { error } = await sb.storage.from('solicitacoes-anexos').upload(path, anexo.file, {
      contentType: anexo.file.type || 'application/octet-stream',
      upsert: false,
    });
    if (error) throw error;
    anexo.path = path;
    anexo.status = 'ok';
  } catch (err) {
    console.error('[Solicitação] Falha ao enviar anexo:', err);
    anexo.status = 'erro';
  }
  _renderAnexos();
}

function adicionarAnexos(files) {
  const restantes = ANEXO_MAX_COUNT - _anexos.length;
  if (restantes <= 0) { mostrarAlerta(`Máximo de ${ANEXO_MAX_COUNT} anexos por registro.`, 'error'); return; }
  Array.from(files).slice(0, restantes).forEach((f) => {
    if (f.size > ANEXO_MAX_MB * 1024 * 1024) { mostrarAlerta(`"${f.name}" excede ${ANEXO_MAX_MB}MB e não foi anexado.`, 'error'); return; }
    if (!ANEXO_TIPOS_ACEITOS.test(f.type)) { mostrarAlerta(`"${f.name}" tem um formato não aceito (use imagem, PDF ou Word).`, 'error'); return; }
    const anexo = { id: 'a' + (_anexoSeq++), file: f, nome: f.name, tamanho: f.size, tipo: f.type, path: null, status: 'pendente' };
    _anexos.push(anexo);
    _uploadAnexo(anexo);
  });
  _renderAnexos();
}

function removerAnexo(id) {
  _anexos = _anexos.filter((a) => a.id !== id);
  _renderAnexos();
}
window.removerAnexo = removerAnexo;

// ── Envio ───────────────────────────────────────────────────────────
function _setBtnEnviarLoading(loading) {
  const btn = document.getElementById('sol-btn-enviar');
  btn.disabled = loading;
  btn.innerHTML = loading ? '<i class="ti ti-loader-2" style="animation:sol-spin 1s linear infinite"></i> Enviando…' : '<i class="ti ti-send"></i> Enviar registro';
}

function _itensPayload(situacao) {
  if (situacao === CATEGORIA_CANTO) {
    return _itensMateriais.map((i) => ({
      categoriaMaterial: i.categoriaMaterial, unidade: i.unidade,
      referencia: _num(i.referencia), cantos: (i.cantos || []).map(_num),
    }));
  }
  if (situacao === CATEGORIA_CUBAGEM) {
    return _itensMateriais.map((i) => ({
      grupoMaterial: i.material, fornecedor: i.fornecedor, docTipo: i.docTipo, nf: i.nf.trim(),
      dataEmissao: i.dataEmissao, dataRecebimento: i.dataRecebimento,
      pesoNf: _num(i.pesoNf), umNf: i.umNf, metodo: i.metodo,
      ...(i.metodo === 'pesagem'
        ? { pesagens: i.pesagens.map(_num) }
        : i.metodo === 'cone'
        ? { cones: i.cones.map((c) => ({ raio: _num(c.raio), altura: _num(c.altura) })) }
        : { comprimento: _num(i.comprimento), largura: _num(i.largura), alturas: i.alturas.map(_num) }),
    }));
  }
  return _itensMateriais.map((i) => ({
    grupoMaterial: i.material, peso: _num(i.peso),
    ...(i.material === SEM_IDENTIFICACAO ? { categoria: i.categoriaSemId } : {}),
  }));
}

async function enviarSolicitacao(ev) {
  ev.preventDefault();
  limparAlerta();

  if (!validarSecaoOndeEQuando() || !validarSecaoOQueAconteceu() || !validarSecaoInformantes() || !validarSecaoFinal()) return;

  const turnstileToken = _turnstileGetToken();
  if (!turnstileToken) return mostrarAlerta('Confirme que você não é um robô antes de enviar.', 'error');

  const categoriaSituacao = _valorAtual('sol-categoria-situacao');
  const anexosOk = _anexos.filter((a) => a.status === 'ok');

  _setBtnEnviarLoading(true);
  try {
    const resp = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'submit',
        turnstileToken,
        central: _valorAtual('sol-central'),
        dataOcorrido: _valorAtual('sol-data'),
        categoriaSituacao,
        filialDestino: categoriaSituacao === CATEGORIA_TRANSFERENCIA ? _valorAtual('sol-filial-destino') : null,
        motivo: categoriaSituacao !== CATEGORIA_COLETA ? null
          : _valorAtual('sol-motivo') === 'Outro' ? 'Outro: ' + _valorAtual('sol-motivo-outro') : _valorAtual('sol-motivo'),
        descricao: _valorAtual('sol-descricao'),
        itens: _itensPayload(categoriaSituacao),
        informantes: _informantes.map((i) => ({ nome: i.nome, cargo: i.cargo, contato: i.contato, assinatura: i.assinatura })),
        anexos: anexosOk.map((a) => ({ path: a.path, nome: a.nome, tipo: a.tipo, tamanho: a.tamanho })),
        semComprovante: !anexosOk.length && document.getElementById('sol-sem-comprovante-ok').checked,
      }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      _turnstileReset();
      mostrarAlerta(data?.error || 'Não foi possível enviar o registro. Tente novamente.', 'error');
      _setBtnEnviarLoading(false);
      return;
    }
    _mostrarSucesso(data.protocolo);
  } catch (err) {
    console.error('[Solicitação] Falha no envio:', err);
    _turnstileReset();
    mostrarAlerta('Falha de conexão. Verifique sua internet e tente novamente.', 'error');
    _setBtnEnviarLoading(false);
  }
}

function _mostrarSucesso(protocolo) {
  document.getElementById('sol-form').style.display = 'none';
  const el = document.getElementById('sol-success');
  el.style.display = 'block';
  el.innerHTML = `
    <i class="ti ti-circle-check sol-success-icon"></i>
    <h2>Registro enviado com sucesso</h2>
    <p>Seu registro já está com o(s) analista(s) responsável(is).</p>
    ${protocolo ? `
      <div class="sol-protocolo">
        <span>Protocolo:</span>
        <span class="sol-numero" id="sol-protocolo-txt">${escapeHtml(protocolo)}</span>
        <button type="button" class="sol-btn sol-btn-copiar" id="sol-btn-copiar" onclick="copiarProtocolo()"><i class="ti ti-copy"></i> Copiar</button>
      </div>
      <div class="sol-alert sol-alert-warn" style="text-align:left;max-width:460px;margin:18px auto 0">
        <i class="ti ti-alert-triangle"></i>
        <div><strong>Envie este protocolo ao analista responsável</strong> (por WhatsApp, por exemplo). É com ele que o analista localiza o seu registro.</div>
      </div>` : ''}
    <button type="button" class="sol-btn" style="margin-top:22px" onclick="location.reload()"><i class="ti ti-plus"></i> Enviar outro registro</button>
  `;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function copiarProtocolo() {
  const txt = document.getElementById('sol-protocolo-txt')?.textContent || '';
  const btn = document.getElementById('sol-btn-copiar');
  const ok = () => { btn.innerHTML = '<i class="ti ti-check"></i> Copiado'; setTimeout(() => { btn.innerHTML = '<i class="ti ti-copy"></i> Copiar'; }, 2000); };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(txt).then(ok).catch(() => _copiarFallback(txt) && ok());
  } else if (_copiarFallback(txt)) ok();
}
window.copiarProtocolo = copiarProtocolo;

// Navegadores antigos / página fora de HTTPS não têm navigator.clipboard.
function _copiarFallback(txt) {
  const ta = document.createElement('textarea');
  ta.value = txt;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* sem suporte */ }
  ta.remove();
  return ok;
}

// ── Boot ────────────────────────────────────────────────────────────
async function boot() {
  _turnstileRender();
  document.getElementById('sol-data').max = hoje();

  _itensMateriais.push(_novoItemMaterial());
  _informantes.push(_novoInformante());

  document.getElementById('sol-central').addEventListener('change', () => {
    if (document.getElementById('sol-fg-filial-destino').style.display !== 'none') _popularFilialDestino();
    // Fornecedores da cubagem dependem da central.
    if (_valorAtual('sol-categoria-situacao') === CATEGORIA_CUBAGEM) {
      _itensMateriais.forEach((it) => {
        if (it.fornecedor && !_fornecedoresDaCubagem(it.material).lista.includes(it.fornecedor)) it.fornecedor = '';
      });
      _renderItensMateriais();
    }
  });

  const dropzone = document.getElementById('sol-dropzone');
  document.getElementById('sol-anexos-input').addEventListener('change', (e) => {
    adicionarAnexos(e.target.files);
    e.target.value = '';
  });
  ['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('drag'); }));
  dropzone.addEventListener('drop', (e) => adicionarAnexos(e.dataTransfer.files));

  document.getElementById('sol-form').addEventListener('submit', enviarSolicitacao);

  try {
    _catalogo = { fornecedores: [], entregas: [], fatoresPorCategoria: {}, ...(await carregarCatalogo()) };
    popularCentrais();
    _renderItensMateriais();
    _renderInformantes();
    _renderAnexos();
    irParaStep(1);
    document.getElementById('sol-loading').style.display = 'none';
    document.getElementById('sol-form').style.display = 'block';
  } catch (err) {
    console.error('[Solicitação] Falha ao carregar catálogo:', err);
    document.getElementById('sol-loading').style.display = 'none';
    mostrarAlerta('Não foi possível carregar o formulário agora. Recarregue a página em instantes ou avise o administrador.', 'error');
  }
}

document.addEventListener('DOMContentLoaded', boot);
