'use strict';

// ═══════════════════════════════════════════════════════════
// DAI — Documento de Ajuste de Inventário
// ═══════════════════════════════════════════════════════════
// Gerador de documento corporativo (validade fiscal/auditoria) para
// registrar ajustes de estoque (perdas, sobras, erros) nas centrais.
// Ao gerar, o sistema:
//   1. Monta um HTML corporativo e abre numa nova janela, com botão
//      "Imprimir / Salvar PDF" — mesmo padrão já usado em relatorio.js
//      (window.print()), sem depender de nenhuma lib de PDF.
//   2. Baixa um ZIP (documento + anexos originais) — a FONTE DA VERDADE,
//      já fora do navegador no momento da geração.
//   3. Guarda uma cópia local de conveniência dos anexos no IndexedDB
//      (fora do snapshot principal — ver idbPutAnexoDai em persist.js),
//      só para permitir reabrir/reimprimir o documento depois.
//   4. Abre automaticamente uma ocorrência dourada e já concluída em
//      Ocorrências (ver ocorrencias.js), com o status exclusivo
//      "Ajuste Sistêmico" — só criado por este módulo.
//
// Numeração: DAI-<nº do documento SAP>-<AAAAMMDD da geração>-<sequência
// do dia>. O número do documento SAP já é gerado pelo próprio SAP, então
// garante unicidade por si só — a data+sequência é só um complemento de
// rastreabilidade, não uma tentativa de gerar unicidade sozinha.
// ═══════════════════════════════════════════════════════════

let _daiAnexosPendentes = []; // File[] em memória, até o clique em "Gerar"

// ── Formatação ──────────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || isNaN(bytes)) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function _daiSomenteDigitos(v) {
  return String(v || '').replace(/\D/g, '');
}

function _daiDataGeracaoKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

// ── Numeração ───────────────────────────────────────────────
function _daiProximoSequencial(sapDigits, dataKey) {
  const existentes = (state.ajustesSistemicos || []).filter(
    a => a.sapDocumento === sapDigits && a.dataGeracaoKey === dataKey
  );
  return String(existentes.length + 1).padStart(2, '0');
}

function _daiMontarNumero(sapDigits, dataKey, seq) {
  return `DAI-${sapDigits}-${dataKey}-${seq}`;
}

// Identificador curto e sequencial do DAI — mesmo padrão de _nextOcId()
// (OC-1, OC-2...) em ocorrencias.js. Diferente do número fiscal do
// documento (dai.numero, formato DAI-<SAP>-<AAAAMMDD>-<seq>), que
// continua sendo o número oficial impresso no documento; este "tag" serve
// só como referência rápida em cards, tooltips e cross-referências.
function _nextDaiTag() {
  const lista = state.ajustesSistemicos || [];
  const nums = lista
    .map(d => { const m = String(d.tag || '').match(/^DAI-(\d+)$/); return m ? parseInt(m[1]) : 0; })
    .filter(n => n > 0);
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return 'DAI-' + next;
}

function _daiAtualizarPreviewNumero() {
  const wrap = document.getElementById('dai-numero-preview-wrap');
  const el = document.getElementById('dai-numero-preview');
  if (!wrap || !el) return;
  const sapDigits = _daiSomenteDigitos(document.getElementById('dai-form-sap')?.value);
  if (!sapDigits) { wrap.style.display = 'none'; return; }
  const dataKey = _daiDataGeracaoKey(new Date());
  const seq = _daiProximoSequencial(sapDigits, dataKey);
  el.innerHTML = `<i class="ti ti-hash"></i> ${escapeHtml(_daiMontarNumero(sapDigits, dataKey, seq))}`;
  wrap.style.display = '';
}

// Chamado pelo oninput do campo SAP — filtra em tempo real para aceitar
// somente dígitos (documento SAP não tem letras nem caracteres especiais)
// e atualiza o preview do número do DAI junto.
function _daiFiltrarSapInput(input) {
  const digits = _daiSomenteDigitos(input.value);
  if (input.value !== digits) input.value = digits;
  _daiAtualizarPreviewNumero();
}

// ── Hash de integridade dos anexos ─────────────────────────
// SHA-256 nativo do navegador (Web Crypto API) — nenhuma lib extra
// necessária. Serve como selo de integridade: se o arquivo original for
// alterado depois, o hash não bate mais com o registrado no documento.
async function _daiHashArquivo(file) {
  try {
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (err) {
    console.warn('[DAI] Falha ao calcular hash do anexo (não crítico):', err);
    return null;
  }
}

// ── Modal: abrir / popular ─────────────────────────────────
function abrirModalDai() {
  _daiAnexosPendentes = [];
  const central = document.getElementById('dai-form-central');
  const dataOc  = document.getElementById('dai-form-data-ocorrido');
  const tipoMov = document.getElementById('dai-form-tipo-movimento');
  const objetivo = document.getElementById('dai-form-objetivo');
  const sap     = document.getElementById('dai-form-sap');
  const oper    = document.getElementById('dai-form-operador');
  const desc    = document.getElementById('dai-form-descricao');
  if (central) central.value = '';
  if (dataOc)  dataOc.value  = new Date().toISOString().split('T')[0];
  if (tipoMov) tipoMov.value = '';
  if (objetivo) objetivo.value = '';
  if (sap)     sap.value     = '';
  if (oper)    oper.value    = '';
  if (desc)    desc.value    = '';

  _daiPopularCentrais();
  if (typeof _rebuildGrupoMateriaisOptions === 'function') {
    _rebuildGrupoMateriaisOptions(document.getElementById('dai-form-material'), '');
  }
  const cnpjPreview = document.getElementById('dai-cnpj-preview');
  if (cnpjPreview) cnpjPreview.innerHTML = '';
  _daiRenderAnalistaBlock();
  _daiRenderAnexosList();
  _daiAtualizarPreviewNumero();

  openModal('dai-modal');
}

function _daiPopularCentrais() {
  const sel = document.getElementById('dai-form-central');
  if (!sel) return;
  const stCentrals = [...new Set(
    (state.filiais || []).map(f => (f.origem || f.alias || '').trim()).filter(Boolean)
  )].sort();
  sel.innerHTML = '<option value="">Selecione a central</option>'
    + stCentrals.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
}

// Localiza o cadastro da central (state.filiais) a partir do valor
// selecionado no formulário — nome original (origem) tem prioridade
// sobre a sigla (alias), mesmo critério usado para popular o select.
function _daiFindFilial(central) {
  if (!central) return null;
  return (state.filiais || []).find(
    f => (f.origem || f.alias || '').trim() === central.trim()
  ) || null;
}

// CNPJ da central — vem do cadastro em Configurações → Cadastros
// (state.filiais[].cnpj). Documento exige esse dado para ter validade
// fiscal; se a central não tiver CNPJ cadastrado, bloqueia a geração e
// pede pro analista completar o cadastro antes.
function _daiObterCnpjCentral(central) {
  return (_daiFindFilial(central)?.cnpj || '').trim();
}

// Regional da central — exibido no documento junto ao campo Central.
function _daiObterRegionalCentral(central) {
  return (_daiFindFilial(central)?.regional || '').trim();
}

function _daiAtualizarCnpjPreview() {
  const central = document.getElementById('dai-form-central')?.value || '';
  const el = document.getElementById('dai-cnpj-preview');
  if (!el) return;
  if (!central) { el.innerHTML = ''; return; }
  const cnpj = _daiObterCnpjCentral(central);
  el.innerHTML = cnpj
    ? `<div class="dai-cnpj-ok"><i class="ti ti-building-bank"></i> CNPJ da central: ${escapeHtml(cnpj)}</div>`
    : `<div class="dai-cnpj-missing"><i class="ti ti-alert-triangle"></i> Esta central não tem CNPJ cadastrado. Preencha em Configurações → Cadastros antes de gerar o documento.</div>`;
}

// Nome do analista: preenchido automaticamente a partir de Configurações
// (__responsavel_padrao__ — mesmo campo usado em todo o resto do sistema).
// Se vazio, exige preenchimento manual + checkbox de ciência dos riscos
// antes de permitir gerar o documento.
function _daiRenderAnalistaBlock() {
  const wrap = document.getElementById('dai-analista-wrap');
  if (!wrap) return;
  const nomeConfig = ((state.configs || []).find(c => c.key === '__responsavel_padrao__') || {}).value || '';

  if (nomeConfig.trim()) {
    wrap.innerHTML = `
      <div class="oc-form-group">
        <label class="oc-label">Analista responsável (assinatura)</label>
        <div class="dai-intro-box" style="background:var(--bg3);border-color:var(--border2)">
          <i class="ti ti-signature" style="color:var(--gold)"></i>
          <div>
            <strong>${escapeHtml(nomeConfig.trim())}</strong><br>
            <span style="font-size:10.5px;color:var(--text3)">Preenchido automaticamente a partir de Configurações → responsável padrão.</span>
          </div>
        </div>
      </div>`;
  } else {
    wrap.innerHTML = `
      <div class="oc-form-group">
        <label class="oc-label">Nome do analista responsável (assinatura) <span class="oc-required">*</span></label>
        <input type="text" id="dai-form-analista" class="oc-input" placeholder="Seu nome completo">
        <span class="oc-hint">Não há responsável padrão preenchido em Configurações — informe seu nome aqui para este documento.</span>
      </div>
      <div class="dai-consent-box" style="margin-top:8px">
        <input type="checkbox" id="dai-form-atestado">
        <label for="dai-form-atestado">Declaro estar ciente dos riscos de ajustes falsos/inconsistentes perante auditoria e fiscalização, e afirmo que as informações prestadas neste documento estão de acordo com o ocorrido.</label>
      </div>`;
  }
}

// ── Anexos ──────────────────────────────────────────────────
const DAI_ANEXO_MAX_MB = 15;

function daiAdicionarAnexos(event) {
  const files = Array.from(event.target.files || []);
  files.forEach(f => {
    if (f.size > DAI_ANEXO_MAX_MB * 1024 * 1024) {
      toast(`"${f.name}" excede ${DAI_ANEXO_MAX_MB}MB e não foi anexado.`, 'error');
      return;
    }
    _daiAnexosPendentes.push(f);
  });
  event.target.value = ''; // permite selecionar o mesmo arquivo de novo, se removido
  _daiRenderAnexosList();
}

function daiRemoverAnexo(idx) {
  _daiAnexosPendentes.splice(idx, 1);
  _daiRenderAnexosList();
}

function _daiRenderAnexosList() {
  const el = document.getElementById('dai-anexo-lista');
  if (!el) return;
  if (!_daiAnexosPendentes.length) { el.innerHTML = ''; return; }
  el.innerHTML = _daiAnexosPendentes.map((f, idx) => `
    <div class="dai-anexo-chip">
      <i class="ti ti-paperclip"></i>
      <span class="dai-anexo-chip-nome">${escapeHtml(f.name)}</span>
      <span class="dai-anexo-chip-tam">${formatBytes(f.size)}</span>
      <button type="button" class="dai-anexo-chip-rm" onclick="daiRemoverAnexo(${idx})" title="Remover">
        <i class="ti ti-x"></i>
      </button>
    </div>`).join('');
}

// ── Geração do documento + ocorrência ──────────────────────
async function gerarDocumentoAjuste() {
  const central     = document.getElementById('dai-form-central')?.value.trim();
  const dataOcorrido = document.getElementById('dai-form-data-ocorrido')?.value;
  const material    = document.getElementById('dai-form-material')?.value.trim();
  const tipoMovimentoSap = document.getElementById('dai-form-tipo-movimento')?.value.trim();
  const objetivo    = document.getElementById('dai-form-objetivo')?.value.trim();
  const sapDigits   = _daiSomenteDigitos(document.getElementById('dai-form-sap')?.value);
  const operador    = document.getElementById('dai-form-operador')?.value.trim();
  const descricao   = document.getElementById('dai-form-descricao')?.value.trim();

  if (!central)          return toast('Selecione a central.', 'error');
  if (!dataOcorrido)     return toast('Informe a data do ocorrido.', 'error');
  if (!material)         return toast('Selecione o material (grupo SAP).', 'error');
  if (!operador)         return toast('Informe o operador informante.', 'error');
  if (!descricao)        return toast('Descreva o ocorrido.', 'error');
  if (!objetivo)         return toast('Informe a função do movimento SAP.', 'error');
  if (!tipoMovimentoSap) return toast('Informe o tipo de movimento SAP.', 'error');
  if (!sapDigits)        return toast('Informe o número do documento SAP (somente dígitos).', 'error');

  const cnpjCentral = _daiObterCnpjCentral(central);
  if (!cnpjCentral) return toast(`A central "${central}" não tem CNPJ cadastrado. Preencha em Configurações → Cadastros antes de gerar o documento.`, 'error');
  const regionalCentral = _daiObterRegionalCentral(central);

  // Analista responsável / atestado de ciência
  const nomeConfig = ((state.configs || []).find(c => c.key === '__responsavel_padrao__') || {}).value || '';
  let analista = nomeConfig.trim();
  let atestadoManual = false;
  if (!analista) {
    analista = (document.getElementById('dai-form-analista')?.value || '').trim();
    const atestadoOk = !!document.getElementById('dai-form-atestado')?.checked;
    if (!analista) return toast('Informe o nome do analista responsável.', 'error');
    if (!atestadoOk) return toast('Confirme a ciência sobre os riscos de ajustes falsos para continuar.', 'error');
    atestadoManual = true;
  }

  const btn = document.getElementById('dai-btn-gerar');
  if (btn?.disabled) return; // proteção contra duplo clique
  if (typeof _setBtnLoading === 'function') _setBtnLoading(btn, true, 'Gerando...');

  try {
    const dataGeracaoTs   = Date.now();
    const dataGeracaoDate = new Date(dataGeracaoTs);
    const dataGeracaoKey  = _daiDataGeracaoKey(dataGeracaoDate);
    const seq             = _daiProximoSequencial(sapDigits, dataGeracaoKey);
    const numero          = _daiMontarNumero(sapDigits, dataGeracaoKey, seq);
    const tag              = _nextDaiTag();
    const daiId            = 'dai_' + dataGeracaoTs + '_' + Math.random().toString(36).slice(2, 8);

    // Hash + metadados dos anexos (arquivos originais ficam em memória
    // até o ZIP ser montado logo abaixo)
    const anexosFiles = [..._daiAnexosPendentes];
    const anexosMeta = [];
    for (const f of anexosFiles) {
      const hash = await _daiHashArquivo(f);
      anexosMeta.push({ nome: f.name, tipo: f.type || 'application/octet-stream', tamanho: f.size, hash });
    }

    const daiRecord = {
      id: daiId,
      tag,
      numero,
      dataGeracao: dataGeracaoTs,
      dataGeracaoKey,
      dataOcorrido,
      central,
      cnpjCentral,
      regionalCentral,
      material,
      tipoMovimentoSap,
      objetivo,
      descricao,
      operador,
      analista,
      atestadoManual,
      sapDocumento: sapDigits,
      ocorrenciaId: null, // preenchido abaixo
      anexos: anexosMeta,
    };

    // Cópia local de conveniência dos anexos (best-effort — a fonte
    // oficial é o ZIP baixado alguns passos abaixo)
    for (let i = 0; i < anexosFiles.length; i++) {
      if (typeof idbPutAnexoDai === 'function') await idbPutAnexoDai(daiId, i, anexosFiles[i]);
    }

    // Ocorrência automática — dourada, já concluída, status exclusivo
    // (calculado ANTES do HTML do documento para que o vínculo apareça
    // corretamente no rodapé)
    const ocId = _nextOcId();
    daiRecord.ocorrenciaId = ocId;

    // HTML do documento oficial (aberto para impressão/PDF mais abaixo)
    const docHtml = _daiBuildDocumentoHtml(daiRecord);

    const ocorrencia = {
      id: ocId,
      dataAbertura: dataOcorrido,
      motivo: objetivo,
      dataLimite: null,
      central,
      material,
      operador,
      contato: null,
      descricao,
      concluida: true,
      dataConclusao: dataGeracaoDate.toISOString().split('T')[0],
      descConclusao: `Ajuste sistêmico registrado via Documento ${numero}. Função do movimento SAP: ${objetivo}. Tipo de movimento SAP: ${tipoMovimentoSap}. Documento SAP: ${sapDigits}.`,
      hierarquia: [],
      criadoEm: dataGeracaoTs,
      origemAjusteSistemico: true,
      daiId,
      daiNumero: numero,
      daiTag: tag,
    };

    if (!Array.isArray(state.ajustesSistemicos)) state.ajustesSistemicos = [];
    state.ajustesSistemicos.push(daiRecord);
    saveOcorrencia(ocorrencia); // já persiste e re-renderiza Ocorrências
    persist(); // garante que ajustesSistemicos também seja gravado agora

    // Abre o documento para impressão/"Salvar PDF"
    _openRelWindow(docHtml);

    // Baixa o ZIP (documento + anexos originais) — fonte da verdade,
    // já fora do navegador
    await _daiBaixarZip(daiRecord, docHtml, anexosFiles);

    closeModal('dai-modal');
    populateOcFiltros();
    toast(`Documento ${numero} gerado e ocorrência ${ocId} registrada.`, 'success');
  } catch (err) {
    console.error('[DAI] Falha ao gerar documento:', err);
    toast('Falha ao gerar o documento. Veja o console para detalhes.', 'error');
  } finally {
    if (typeof _setBtnLoading === 'function') _setBtnLoading(btn, false);
  }
}

// Reimpressão — reconstrói o mesmo HTML a partir dos metadados salvos
// (chamado a partir do card/detalhe da ocorrência de Ajuste Sistêmico).
function reimprimirDocumentoDai(daiId) {
  const dai = (state.ajustesSistemicos || []).find(d => d.id === daiId);
  if (!dai) { toast('Documento não encontrado — pode já ter sido excluído.', 'error'); return; }
  const html = _daiBuildDocumentoHtml(dai);
  _openRelWindow(html);
}

// ── ZIP (documento + anexos originais) ─────────────────────
async function _daiBaixarZip(daiRecord, docHtml, anexosFiles) {
  if (typeof JSZip === 'undefined') {
    toast('Biblioteca de ZIP não carregada (verifique a conexão) — o documento foi gerado normalmente, mas não foi possível empacotar os anexos automaticamente.', 'error');
    return;
  }
  try {
    const zip = new JSZip();
    zip.file(`${daiRecord.numero}.html`, docHtml);
    if (anexosFiles.length) {
      const pasta = zip.folder('anexos');
      anexosFiles.forEach(f => pasta.file(f.name, f));
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${daiRecord.numero}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    console.warn('[DAI] Falha ao montar o ZIP de anexos (não crítico — o documento já foi gerado):', err);
    toast('O documento foi gerado, mas houve falha ao montar o ZIP de anexos.', 'error');
  }
}

// ── HTML do documento corporativo ──────────────────────────
// Documento autocontido (própria janela, sem depender do CSS do app) —
// mesmo padrão de relatorio.js (_openRelWindow abre em nova janela com
// botão "Imprimir / Salvar PDF"). Fundo claro/portrait: é um documento
// para ser impresso em papel ou salvo como PDF e arquivado, diferente
// dos dashboards internos do sistema.
function _daiBuildDocumentoHtml(dai) {
  const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s ?? ''));
  const dataGeracaoFmt = dai.dataGeracao ? new Date(dai.dataGeracao).toLocaleString('pt-BR') : '—';
  const dataOcorridoFmt = (typeof fmtDateBR === 'function') ? fmtDateBR(dai.dataOcorrido) : (dai.dataOcorrido || '—');

  const anexosHtml = (Array.isArray(dai.anexos) && dai.anexos.length) ? `
    <div class="field-label">Anexos de comprovação (${dai.anexos.length})</div>
    <div class="anexos-list">
      ${dai.anexos.map(a => `
        <div class="anexo-item">
          <span>${esc(a.nome)} <span style="color:#8a7a64">(${formatBytes(a.tamanho)})</span></span>
          <span class="anexo-hash" title="SHA-256 completo: ${a.hash ? esc(a.hash) : 'não calculado'}">${a.hash ? esc(a.hash.slice(0, 16)) + '…' : '— sem hash —'}</span>
        </div>`).join('')}
    </div>
    <div style="font-size:9px;color:#8a7a64;margin-top:-8px;margin-bottom:18px">Os arquivos originais dos anexos acompanham o pacote ZIP baixado junto com este documento.</div>
  ` : '';

  const atestadoHtml = dai.atestadoManual ? `
    <div class="atestado">
      O analista acima declarou, no ato da geração deste documento, estar ciente dos riscos de ajustes falsos/inconsistentes perante auditoria e fiscalização, e afirmou que as informações aqui prestadas estão de acordo com o ocorrido relatado.
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(dai.numero)} — Documento de Ajuste de Inventário</title>
<style>
  @page { size: A4 portrait; margin: 14mm 16mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; background: #ece6d5; color: #1c1608; font-size: 12.5px; line-height: 1.5; -webkit-font-smoothing: antialiased; }

  .action-bar { position: sticky; top: 0; z-index: 100; background: #1c1608; display: flex; align-items: center; justify-content: space-between; padding: 12px 24px; box-shadow: 0 2px 12px rgba(0,0,0,.3); }
  .action-bar-title { color: #f4f1e8; font-size: 13px; font-weight: 500; }
  .action-bar-title span { color: #c9a227; font-size: 12px; margin-left: 10px; font-family: monospace; }
  .action-bar-btns { display: flex; gap: 10px; }
  .btn-print { background: #c9a227; color: #1c1608; border: none; border-radius: 7px; padding: 8px 18px; font-size: 13px; font-weight: 700; cursor: pointer; }
  .btn-print:hover { background: #b5911f; }
  .btn-close { background: #3a2f14; color: #eee; border: none; border-radius: 7px; padding: 8px 14px; font-size: 13px; cursor: pointer; }
  .btn-close:hover { background: #4a3d1c; }

  .doc-wrap { max-width: 760px; margin: 28px auto 60px; background: #fff; color: #1c1608; padding: 34px 40px 44px; box-shadow: 0 6px 28px rgba(0,0,0,.18); }

  .doc-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; border-bottom: 3px solid #c9a227; padding-bottom: 16px; margin-bottom: 18px; }
  .doc-header img { height: 40px; width: auto; }
  .doc-title { text-align: right; }
  .doc-title h1 { font-size: 15.5px; letter-spacing: .04em; text-transform: uppercase; color: #1c1608; line-height: 1.35; }
  .doc-title .numero { font-family: monospace; font-weight: 800; color: #8a6d1a; font-size: 13px; margin-top: 6px; }

  .confidential-strip { text-align: center; padding: 9px; background: #fdf6e3; border: 1px solid #c9a227; border-radius: 6px; font-size: 10px; color: #7a5c0f; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; margin-bottom: 20px; }

  .field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 24px; margin-bottom: 18px; }
  .field-label { font-size: 9.5px; text-transform: uppercase; letter-spacing: .06em; color: #8a7a64; margin-bottom: 4px; }
  .field-value { font-size: 12.5px; font-weight: 700; border-bottom: 1px solid #e5ddc8; padding-bottom: 5px; color: #1c1608; overflow-wrap: anywhere; word-break: break-word; }
  .oc-objetivo-box { background: #fdf6e3; border: 1px solid #e5ddc8; border-radius: 6px; padding: 10px 14px; margin-bottom: 16px; overflow-wrap: anywhere; word-break: break-word; }

  .desc-box { border: 1px solid #e5ddc8; border-radius: 6px; padding: 13px 15px; font-size: 12px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; margin: 6px 0 18px; color: #2a2110; }

  .anexos-list { margin-top: 6px; }
  .anexo-item { display: flex; justify-content: space-between; gap: 12px; font-size: 11px; padding: 6px 0; border-bottom: 1px dashed #e5ddc8; }
  .anexo-hash { font-family: monospace; color: #8a7a64; font-size: 9.5px; white-space: nowrap; }

  .assinatura-box { margin-top: 46px; padding-top: 16px; border-top: 1px solid #1c1608; text-align: center; }
  .assinatura-nome { font-weight: 800; font-size: 13.5px; }
  .assinatura-sub { font-size: 10px; color: #8a7a64; margin-top: 3px; text-transform: uppercase; letter-spacing: .04em; }
  .atestado { margin: 12px auto 0; font-size: 9.5px; color: #8a7a64; font-style: italic; max-width: 520px; line-height: 1.6; }

  .doc-footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #e5ddc8; display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 9px; color: #8a7a64; flex-wrap: wrap; }

  @media print {
    .action-bar { display: none !important; }
    body { background: #fff !important; padding: 0 !important; }
    .doc-wrap { box-shadow: none !important; margin: 0 auto !important; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  }
</style>
</head>
<body>

<div class="action-bar">
  <div class="action-bar-title">Documento de Ajuste de Inventário <span>${esc(dai.numero)}</span></div>
  <div class="action-bar-btns">
    <button class="btn-print" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button>
    <button class="btn-close" onclick="window.close()">✕ Fechar</button>
  </div>
</div>

<div class="doc-wrap">
  <div class="doc-header">
    <img src="https://concrelagos.com.br/wp-content/uploads/2021/10/Ativo-3.svg" alt="Concrelagos Concreto" onerror="this.style.display='none'">
    <div class="doc-title">
      <h1>Documento de Ajuste<br>de Inventário</h1>
      <div class="numero">${esc(dai.numero)}</div>
    </div>
  </div>

  <div class="confidential-strip"><i>⚠</i> Documento com validade fiscal — uso interno, contabilidade, controladoria e fiscalização</div>

  <div class="field-grid">
    <div><div class="field-label">Central${dai.regionalCentral ? ` <span style="text-transform:none;font-weight:400">— Regional ${esc(dai.regionalCentral)}</span>` : ''}</div><div class="field-value">${esc(dai.central)}${dai.cnpjCentral ? ` <span style="font-weight:400;font-size:10.5px;color:#8a7a64">(CNPJ ${esc(dai.cnpjCentral)})</span>` : ''}</div></div>
    <div><div class="field-label">Data do ocorrido</div><div class="field-value">${esc(dataOcorridoFmt)}</div></div>
    <div><div class="field-label">Operador informante</div><div class="field-value">${esc(dai.operador)}</div></div>
    <div><div class="field-label">Data/hora de geração do documento</div><div class="field-value">${esc(dataGeracaoFmt)}</div></div>
  </div>

  <div class="field-label">Material <span style="text-transform:none;font-weight:400">(grupo SAP)</span></div>
  <div class="field-value" style="border-bottom:1px solid #e5ddc8;padding-bottom:5px;margin-bottom:16px">${esc(dai.material)}</div>

  <div class="field-label">Descrição do ocorrido</div>
  <div class="desc-box">${esc(dai.descricao)}</div>

  <div class="oc-objetivo-box">
    <div class="field-label">Função do movimento SAP</div>
    <div class="field-value" style="border-bottom:none;padding-bottom:0">${esc(dai.objetivo)}</div>
  </div>

  <div class="field-grid" style="margin-bottom:18px">
    <div><div class="field-label">Tipo de movimento SAP</div><div class="field-value">${esc(dai.tipoMovimentoSap)}</div></div>
    <div><div class="field-label">Nº Documento SAP (pós-ajuste)</div><div class="field-value">${esc(dai.sapDocumento)}</div></div>
  </div>

  ${anexosHtml}

  <div class="assinatura-box">
    <div class="assinatura-nome">${esc(dai.analista)}</div>
    <div class="assinatura-sub">Analista responsável — assinatura</div>
    ${atestadoHtml}
  </div>

  <div class="doc-footer">
    <span>Concrelagos Concreto · AnalyticSys</span>
    <span>DAI vinculado: ${esc(dai.tag || dai.numero)}</span>
  </div>
</div>

</body>
</html>`;
}

Object.assign(window, {
  abrirModalDai,
  daiAdicionarAnexos,
  daiRemoverAnexo,
  gerarDocumentoAjuste,
  reimprimirDocumentoDai,
  formatBytes,
});
