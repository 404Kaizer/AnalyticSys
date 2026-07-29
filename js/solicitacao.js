'use strict';

// ═══════════════════════════════════════════════════════════
// SOLICITAÇÃO PÚBLICA DE DAI — lógica da página isolada
// ═══════════════════════════════════════════════════════════
// Sem login. Toda validação "de verdade" acontece no servidor (Edge
// Function solicitacao-dai) — o que está aqui é só validação de
// conveniência (UX rápida) e nunca deve ser tratado como a barreira de
// segurança real.
//
// Anexos sobem DIRETO pro Supabase Storage (bucket privado
// "solicitacoes-anexos") usando a chave publicável (mesma do resto do
// sistema — a proteção real é a política de RLS do bucket, que só libera
// INSERT para quem não tem sessão, nunca leitura). Só o CAMINHO do
// arquivo é enviado depois para a Edge Function.
// ═══════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://kgbmswykhqhmcajxlvri.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_SFDcmWJ0fSuS0tmWkiibnQ_RLjfRJug';
const FUNCTION_URL = SUPABASE_URL + '/functions/v1/solicitacao-dai';
const TURNSTILE_SITEKEY = '0x4AAAAAAD-V-RBGDDiirGsF';

const ANEXO_MAX_MB = 15;
const ANEXO_MAX_COUNT = 10;
const ANEXO_TIPOS_ACEITOS = /^image\/|^application\/pdf$|^application\/msword$|wordprocessingml/;

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

let _catalogo = { centrais: [], materiaisPorCategoria: {} };
let _anexos = []; // { id, file, nome, tamanho, tipo, path, status: 'pendente'|'enviando'|'ok'|'erro' }
let _anexoSeq = 0;
let turnstileWidgetId = null;

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || isNaN(bytes)) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}
function hoje() { return new Date().toISOString().split('T')[0]; }

function mostrarAlerta(msg, tipo) {
  const area = document.getElementById('sol-alert-area');
  const cls = tipo === 'error' ? 'sol-alert-error' : 'sol-alert-info';
  const icon = tipo === 'error' ? 'ti-alert-triangle' : 'ti-info-circle';
  area.innerHTML = `<div class="sol-alert ${cls}"><i class="ti ${icon}"></i><div>${escapeHtml(msg)}</div></div>`;
  area.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function limparAlerta() { document.getElementById('sol-alert-area').innerHTML = ''; }

// ── Turnstile ────────────────────────────────────────────────────────
function _turnstileRender() {
  if (turnstileWidgetId !== null) return;
  if (typeof turnstile === 'undefined') { setTimeout(_turnstileRender, 400); return; }
  turnstileWidgetId = turnstile.render('#turnstile-solicitacao-widget', {
    sitekey: TURNSTILE_SITEKEY,
    theme: 'dark',
  });
}
function _turnstileGetToken() {
  if (typeof turnstile === 'undefined' || turnstileWidgetId === null) return null;
  return turnstile.getResponse(turnstileWidgetId) || null;
}
function _turnstileReset() {
  if (typeof turnstile === 'undefined' || turnstileWidgetId === null) return;
  turnstile.reset(turnstileWidgetId);
}

// ── Catálogo (central + materiais por categoria) ───────────────────────
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

function popularMateriais() {
  const sel = document.getElementById('sol-material');
  const grupos = _catalogo.materiaisPorCategoria || {};
  let html = '<option value="">Selecione o material</option>';
  Object.keys(grupos).forEach((categoria) => {
    const itens = grupos[categoria];
    if (!itens || !itens.length) return;
    html += `<optgroup label="${escapeHtml(categoria)}">`
      + itens.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('')
      + '</optgroup>';
  });
  sel.innerHTML = html;
}

// ── Anexos ──────────────────────────────────────────────────────────
function _renderAnexos() {
  const el = document.getElementById('sol-anexo-lista');
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
  if (restantes <= 0) { mostrarAlerta(`Máximo de ${ANEXO_MAX_COUNT} anexos por solicitação.`, 'error'); return; }
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

// ── Termo de Responsabilidade (impressão) ──────────────────────────────
// Usa os dados já preenchidos no formulário — a DAI ainda não existe
// nesse momento (é gerada só no envio), então a referência fica em
// aberto ("A PREENCHER") até o operador anexar o termo assinado.
function _valorAtual(id) { return (document.getElementById(id)?.value || '').trim(); }

function imprimirTermo() {
  const central = _valorAtual('sol-central');
  const dataOcorrido = _valorAtual('sol-data');
  const material = _valorAtual('sol-material');
  const peso = _valorAtual('sol-peso');
  const movimento = _valorAtual('sol-movimento');
  const objetivo = _valorAtual('sol-objetivo');
  const descricao = _valorAtual('sol-descricao');
  const nome = _valorAtual('sol-inf-nome');
  const cargo = _valorAtual('sol-inf-cargo');

  if (!central || !dataOcorrido || !nome) {
    mostrarAlerta('Preencha ao menos Central, Data do ocorrido e seu Nome antes de imprimir o termo.', 'error');
    return;
  }

  const dataFmt = (() => {
    const [y, m, d] = dataOcorrido.split('-');
    return (y && m && d) ? `${d}/${m}/${y}` : dataOcorrido;
  })();

  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8">
<title>Termo de Responsabilidade</title>
<style>
  @page { size: A4 portrait; margin: 14mm 16mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background:#ece6d5; color:#1c1608; font-size:12.5px; line-height:1.5; }
  .action-bar { position: sticky; top:0; background:#1c1608; display:flex; align-items:center; justify-content:space-between; padding:12px 24px; }
  .action-bar-title { color:#f4f1e8; font-size:13px; }
  .btn-print { background:#ff6b35; color:#1c1608; border:none; border-radius:7px; padding:8px 18px; font-size:13px; font-weight:700; cursor:pointer; }
  .btn-close { background:#3a2f14; color:#eee; border:none; border-radius:7px; padding:8px 14px; font-size:13px; cursor:pointer; margin-left:10px; }
  .doc-wrap { max-width:760px; margin:28px auto 60px; background:#fff; color:#1c1608; padding:34px 40px 44px; box-shadow:0 6px 28px rgba(0,0,0,.18); }
  .doc-header { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; border-bottom:3px solid #ff6b35; padding-bottom:16px; margin-bottom:18px; }
  .doc-title h1 { font-size:15.5px; letter-spacing:.04em; text-transform:uppercase; text-align:right; }
  .doc-title .numero { font-family: monospace; font-weight:800; color:#a04a1f; font-size:13px; margin-top:6px; text-align:right; }
  .confidential-strip { text-align:center; padding:9px; background:#fdf1ea; border:1px solid #ff6b35; border-radius:6px; font-size:10px; color:#a04a1f; font-weight:700; letter-spacing:.05em; text-transform:uppercase; margin-bottom:20px; }
  .field-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px 24px; margin-bottom:18px; }
  .field-label { font-size:9.5px; text-transform:uppercase; letter-spacing:.06em; color:#8a7a64; margin-bottom:4px; }
  .field-value { font-size:12.5px; font-weight:700; border-bottom:1px solid #e5ddc8; padding-bottom:5px; overflow-wrap:anywhere; }
  .declaracao { font-size:13px; line-height:1.85; text-align:justify; margin:8px 0 24px; }
  .desc-box { border:1px solid #e5ddc8; border-radius:6px; padding:13px 15px; font-size:12px; line-height:1.7; white-space:pre-wrap; margin:6px 0 18px; }
  .itens-table { width:100%; border-collapse:collapse; margin:6px 0 20px; font-size:11px; }
  .itens-table th { text-align:left; font-size:9px; text-transform:uppercase; letter-spacing:.05em; color:#8a7a64; padding:6px 8px; border-bottom:2px solid #ff6b35; }
  .itens-table td { padding:7px 8px; border-bottom:1px solid #e5ddc8; }
  .assinatura-box { margin-top:40px; text-align:center; }
  .assinatura-linha { border-top:1px solid #1c1608; width:320px; margin:0 auto 8px; }
  .assinatura-nome { font-weight:800; font-size:13px; }
  .assinatura-sub { font-size:10px; color:#8a7a64; margin-top:2px; text-transform:uppercase; }
  .assinatura-data { margin-top:28px; font-size:12px; }
  .linha-preencher { display:inline-block; border-bottom:1px solid #1c1608; width:60px; margin:0 3px; }
  .doc-footer { margin-top:30px; padding-top:12px; border-top:1px solid #e5ddc8; font-size:9px; color:#8a7a64; }
  @media print { .action-bar { display:none !important; } body { background:#fff !important; } .doc-wrap { box-shadow:none !important; margin:0 auto !important; } }
</style></head>
<body>
<div class="action-bar">
  <div class="action-bar-title">Termo de Responsabilidade do Informante</div>
  <div><button class="btn-print" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button><button class="btn-close" onclick="window.close()">✕ Fechar</button></div>
</div>
<div class="doc-wrap">
  <div class="doc-header">
    <img src="https://concrelagos.com.br/wp-content/uploads/2021/10/Ativo-3.svg" alt="Concrelagos Concreto" height="40" onerror="this.style.display='none'">
    <div class="doc-title"><h1>Termo de<br>Responsabilidade</h1><div class="numero">Ref. A PREENCHER NO ENVIO</div></div>
  </div>
  <div class="confidential-strip">⚠ Assine este termo, anexe-o (foto/scan) no formulário e só então envie a solicitação</div>
  <div class="field-grid">
    <div><div class="field-label">Central</div><div class="field-value">${escapeHtml(central)}</div></div>
    <div><div class="field-label">Data do ocorrido</div><div class="field-value">${escapeHtml(dataFmt)}</div></div>
  </div>
  <div class="field-label">Item do ajuste</div>
  <table class="itens-table">
    <thead><tr><th>Material</th><th>Peso (kg)</th><th>Tipo Mov.</th><th>Função do movimento</th></tr></thead>
    <tbody><tr><td>${escapeHtml(material || '—')}</td><td>${escapeHtml(peso || '—')}</td><td>${escapeHtml(movimento || '—')}</td><td>${escapeHtml(objetivo || '—')}</td></tr></tbody>
  </table>
  <div class="field-label">Descrição do ocorrido</div>
  <div class="desc-box">${escapeHtml(descricao || '—')}</div>
  <div class="declaracao">
    Eu, <strong>${escapeHtml(nome)}</strong>${cargo ? ` (${escapeHtml(cargo)})` : ''}, DECLARO que as informações por mim prestadas relativas ao ocorrido acima descrito são verídicas e correspondem fielmente aos fatos por mim observados, estando ciente das responsabilidades decorrentes da prestação de informações falsas ou inexatas.
  </div>
  <div class="assinatura-box">
    <div class="assinatura-linha"></div>
    <div class="assinatura-nome">${escapeHtml(nome)}</div>
    <div class="assinatura-sub">${cargo ? escapeHtml(cargo) + ' — ' : ''}Assinatura do informante</div>
    <div class="assinatura-data">Data: <span class="linha-preencher">&nbsp;</span>/<span class="linha-preencher">&nbsp;</span>/<span class="linha-preencher" style="width:90px">&nbsp;</span></div>
  </div>
  <div class="doc-footer">Concrelagos Concreto · AnalyticSys — Documento gerado a partir do formulário público de solicitação</div>
</div>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) { mostrarAlerta('Não foi possível abrir a janela de impressão — verifique o bloqueador de pop-ups.', 'error'); return; }
  win.document.write(html);
  win.document.close();
}
window.imprimirTermo = imprimirTermo;

// ── Envio ───────────────────────────────────────────────────────────
function _setBtnEnviarLoading(loading) {
  const btn = document.getElementById('sol-btn-enviar');
  btn.disabled = loading;
  btn.innerHTML = loading ? '<i class="ti ti-loader-2" style="animation:sol-spin 1s linear infinite"></i> Enviando…' : '<i class="ti ti-send"></i> Enviar solicitação';
}

async function enviarSolicitacao(ev) {
  ev.preventDefault();
  limparAlerta();

  const central = _valorAtual('sol-central');
  const material = _valorAtual('sol-material');
  const peso = _valorAtual('sol-peso');
  const movimento = _valorAtual('sol-movimento');
  const objetivo = _valorAtual('sol-objetivo');
  const dataOcorrido = _valorAtual('sol-data');
  const descricao = _valorAtual('sol-descricao');
  const nome = _valorAtual('sol-inf-nome');
  const cargo = _valorAtual('sol-inf-cargo');
  const contato = _valorAtual('sol-inf-contato');

  if (!central) return mostrarAlerta('Selecione a central.', 'error');
  if (!material) return mostrarAlerta('Selecione o material.', 'error');
  const pesoNum = parseFloat(String(peso).replace(',', '.'));
  if (!peso || isNaN(pesoNum) || pesoNum <= 0) return mostrarAlerta('Informe um peso válido.', 'error');
  if (!movimento) return mostrarAlerta('Informe o tipo de movimento SAP.', 'error');
  if (!objetivo) return mostrarAlerta('Informe a função do movimento.', 'error');
  if (!dataOcorrido) return mostrarAlerta('Informe a data do ocorrido.', 'error');
  if (dataOcorrido > hoje()) return mostrarAlerta('A data do ocorrido não pode ser no futuro.', 'error');
  if (!descricao) return mostrarAlerta('Descreva o ocorrido.', 'error');
  if (!nome) return mostrarAlerta('Informe seu nome.', 'error');

  if (_anexos.some((a) => a.status === 'enviando')) return mostrarAlerta('Aguarde o envio dos anexos terminar.', 'error');
  if (_anexos.some((a) => a.status === 'erro')) return mostrarAlerta('Remova ou reenvie os anexos que falharam antes de continuar.', 'error');
  const anexosOk = _anexos.filter((a) => a.status === 'ok');
  if (!anexosOk.length) return mostrarAlerta('Anexe ao menos o Termo de Responsabilidade assinado antes de enviar.', 'error');

  const turnstileToken = _turnstileGetToken();
  if (!turnstileToken) return mostrarAlerta('Confirme que você não é um robô antes de enviar.', 'error');

  _setBtnEnviarLoading(true);
  try {
    const resp = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'submit',
        turnstileToken,
        central, grupoMaterial: material, peso: pesoNum,
        tipoMovimentoSap: movimento, objetivo, dataOcorrido, descricao,
        informanteNome: nome, informanteCargo: cargo, informanteContato: contato,
        anexos: anexosOk.map((a) => ({ path: a.path, nome: a.nome, tipo: a.tipo, tamanho: a.tamanho })),
      }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      _turnstileReset();
      mostrarAlerta(data?.error || 'Não foi possível enviar a solicitação. Tente novamente.', 'error');
      _setBtnEnviarLoading(false);
      return;
    }
    _mostrarSucesso(data.numero, data.tag);
  } catch (err) {
    console.error('[Solicitação] Falha no envio:', err);
    _turnstileReset();
    mostrarAlerta('Falha de conexão. Verifique sua internet e tente novamente.', 'error');
    _setBtnEnviarLoading(false);
  }
}

function _mostrarSucesso(numero, tag) {
  document.getElementById('sol-form').style.display = 'none';
  const el = document.getElementById('sol-success');
  el.style.display = 'block';
  el.innerHTML = `
    <i class="ti ti-circle-check"></i>
    <h2>Solicitação enviada com sucesso</h2>
    <p>Sua solicitação foi registrada como <span class="sol-numero">${escapeHtml(tag)}</span> e já está com o analista responsável, aguardando o ajuste no SAP.</p>
    <p>Guarde a referência <span class="sol-numero">${escapeHtml(numero)}</span> para acompanhamento, se precisar.</p>
    <button type="button" class="sol-btn" style="margin-top:18px" onclick="location.reload()"><i class="ti ti-plus"></i> Enviar outra solicitação</button>
  `;
}

// ── Boot ────────────────────────────────────────────────────────────
async function boot() {
  _turnstileRender();
  document.getElementById('sol-data').max = hoje();

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
    _catalogo = await carregarCatalogo();
    popularCentrais();
    popularMateriais();
    document.getElementById('sol-loading').style.display = 'none';
    document.getElementById('sol-form').style.display = 'block';
  } catch (err) {
    console.error('[Solicitação] Falha ao carregar catálogo:', err);
    document.getElementById('sol-loading').style.display = 'none';
    mostrarAlerta('Não foi possível carregar o formulário agora. Recarregue a página em instantes ou avise o administrador.', 'error');
  }
}

document.addEventListener('DOMContentLoaded', boot);
