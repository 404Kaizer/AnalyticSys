'use strict';

// ═══════════════════════════════════════════════════════════
// DAI — Documento de Ajuste de Inventário
// ═══════════════════════════════════════════════════════════
// Gerador de documento corporativo (validade fiscal/auditoria) para
// registrar ajustes de estoque (perdas, sobras, erros) nas centrais.
//
// Uma mesma nota (DAI) pode conter vários ITENS (material + peso + tipo
// de movimento SAP + nº do documento SAP + função do movimento) e vários
// INFORMANTES (nome + cargo) — útil quando um mesmo ocorrido afetou mais
// de um material, precisou de mais de um ajuste, ou envolveu mais de um
// tipo de movimento/informante ao mesmo tempo, tudo para a mesma central.
//
// Ao gerar, o sistema:
//   1. Monta um HTML corporativo e abre numa nova janela, com botão
//      "Imprimir / Salvar PDF" — mesmo padrão já usado em relatorio.js
//      (window.print()), sem depender de nenhuma lib de PDF.
//   2. Sobe os anexos pro Supabase Storage (mesmo bucket dos anexos do
//      formulário público, ver _daiSubirAnexo) — fonte de verdade única,
//      acessível de qualquer dispositivo/usuário. DAIs geradas antes desta
//      mudança (31/07) têm anexos só no IndexedDB de quem as criou (ver
//      idbGetAnexoDai em persist.js) — baixarZipDai cai nesse fallback.
//   3. Abre automaticamente ocorrência(s) dourada(s) em Ocorrências (ver
//      ocorrencias.js), com o status exclusivo "Ajuste Sistêmico" — só
//      criado por este módulo. Por padrão é UMA única ocorrência para o
//      DAI inteiro; o analista pode optar por uma ocorrência separada
//      POR ITEM quando a nota tiver mais de um item (checkbox no modal).
//
// Numeração: DAI-<nº do documento SAP>-<AAAAMMDD da geração>-<sequência
// do dia>. Quando a nota tem vários itens, cada um pode ter seu próprio
// Nº de documento SAP — o número FISCAL da nota como um todo usa o SAP
// do PRIMEIRO item (mesma regra de quando só existia 1 item por DAI,
// mantida por compatibilidade). Os demais itens têm seu próprio SAP
// registrado individualmente em cada linha da tabela do documento.
// ═══════════════════════════════════════════════════════════

// ── Sincronização com Supabase (Fase 2, etapa final) ────────────────────
// Documento tem validade fiscal/auditoria — falha aqui não pode passar em
// silêncio total (por isso o toast de aviso), mas também não trava a UI:
// o documento já foi gerado, impresso e salvo localmente antes desta
// chamada rodar.
function _daiSyncUpsert(dai) {
  if (!window.supabaseClient) return;
  const row = {
    id: dai.id,
    tag: dai.tag,
    numero: dai.numero,
    data_geracao: dai.dataGeracao,
    data_geracao_key: dai.dataGeracaoKey,
    data_ocorrido: dai.dataOcorrido,
    central: dai.central,
    cnpj_central: dai.cnpjCentral,
    regional_central: dai.regionalCentral,
    descricao: dai.descricao,
    informantes: dai.informantes || [],
    itens: dai.itens || [],
    analista: dai.analista,
    atestado_manual: !!dai.atestadoManual,
    ocorrencia_por_item: !!dai.ocorrenciaPorItem,
    ocorrencia_ids: dai.ocorrenciaIds || [],
    anexos: dai.anexos || [],
    material: dai.material,
    tipo_movimento_sap: dai.tipoMovimentoSap,
    objetivo: dai.objetivo,
    operador: dai.operador,
    sap_documento: dai.sapDocumento,
  };
  window.supabaseClient.from('ajustes_sistemicos').upsert(row)
    .then(({ error }) => {
      if (error) {
        console.warn('[Supabase] Falha ao sincronizar DAI:', error);
        toast('⚠ Documento salvo nesta sessão, mas não foi possível sincronizar com a nuvem.', 'error');
      }
    });
}

// ownerId — dono real do DAI (mesmo dono da ocorrência vinculada, criados
// juntos no mesmo fluxo — ver ocorrencias.js). Default currentUser.id
// cobre o caso comum (analista excluindo o próprio documento).
function _daiSyncDelete(daiId, ownerId) {
  _supaDeleteOwned('ajustes_sistemicos', { id: daiId }, null, ownerId)
    .then(({ error }) => { if (error) console.warn('[Supabase] Falha ao excluir DAI na nuvem:', error); });
}

// Reatribuição (31/07) — chamada por reatribuirOcorrencia (ocorrencias.js)
// quando a ocorrência reatribuída é uma DAI, pra manter os dois com o
// mesmo dono. PK de ajustes_sistemicos é só `id` (não composta como
// ocorrencias), então um UPDATE simples já move a linha — sem risco de
// virar INSERT por engano.
async function _daiSyncReatribuir(daiId, donoAntigo, donoNovo) {
  const { error } = await window.supabaseClient
    .from('ajustes_sistemicos')
    .update({ user_id: donoNovo })
    .eq('id', daiId)
    .eq('user_id', donoAntigo);
  if (error) {
    console.warn('[Supabase] Falha ao reatribuir DAI:', error);
    return false;
  }
  return true;
}

// Busca no boot — mescla por id, nuvem tem prioridade (mesmo padrão do
// resto do sistema). Mantém dados locais em caso de falha de rede.
// Extraído do corpo de syncAjustesSistemicosFromSupabase (31/07) pra dar
// pra reusar no handler do Realtime também, sem duplicar o mapeamento.
function _daiFromDbRow(r) {
  return {
    id: r.id, tag: r.tag, numero: r.numero, dataGeracao: r.data_geracao,
    dataGeracaoKey: r.data_geracao_key, dataOcorrido: r.data_ocorrido,
    central: r.central, cnpjCentral: r.cnpj_central, regionalCentral: r.regional_central,
    descricao: r.descricao, informantes: r.informantes || [], itens: r.itens || [],
    analista: r.analista, atestadoManual: r.atestado_manual, ocorrenciaPorItem: r.ocorrencia_por_item,
    ocorrenciaIds: r.ocorrencia_ids || [], anexos: r.anexos || [],
    material: r.material, tipoMovimentoSap: r.tipo_movimento_sap, objetivo: r.objetivo,
    operador: r.operador, sapDocumento: r.sap_documento,
  };
}

async function syncAjustesSistemicosFromSupabase() {
  try {
    // fetchAllRows (cursor por id) — select('*') direto tinha o mesmo risco
    // de teto de 1000 linhas já corrigido em Lançamentos/Entradas. Sem
    // .order() antes, então a troca não muda ordenação nenhuma.
    // ADM (31/07): ajustes_sistemicos só é lido por id (modal de detalhe,
    // exclusão) — nenhuma tela monta uma lista própria a partir dele, então
    // não existe o risco de "poluir a lista de trabalho" que motivou o
    // filtro mine+integrada em syncOcorrenciasFromSupabase. Sem isto, uma
    // DAI reatribuída pra outro usuário (ou vista via card/notificação)
    // ficava de fora de state.ajustesSistemicos e o modal de detalhe
    // (openOcDetailModal) renderizava sem a seção "Documento de Ajuste de
    // Inventário" — RLS (is_admin()) já libera o ADM a ler tudo.
    const data = window.currentUser?.role === 'admin'
      ? await fetchAllRows('ajustes_sistemicos')
      : await fetchMineOrIntegrated('ajustes_sistemicos');
    // O BANCO MANDA (30/07): o self-heal que existia aqui reenviava DAI
    // apagado, desfazendo a exclusão no boot seguinte. A nuvem substitui;
    // erro de busca cai no catch e preserva o local.
    state.ajustesSistemicos = (data || []).map(_daiFromDbRow);
  } catch (err) {
    console.warn('[Supabase] Falha ao buscar DAIs — mantendo dados locais.', err);
  }
}

// ── Realtime (31/07) ────────────────────────────────────────────────────
// Mesma regra do fetch acima aplicada evento a evento: usuário comum já
// vem restringido pela RLS (dono OU is_admin); ADM vê tudo, espelhando o
// fetch inicial (fetchAllRows acima) — sem isto o Realtime dessincronizava
// de novo logo após o primeiro DAI reatribuído/criado por outro usuário.
async function _daiEhRelevantePraMim(row) {
  return true;
}
function _daiUpsertLocal(row) {
  if (!Array.isArray(state.ajustesSistemicos)) state.ajustesSistemicos = [];
  const dai = _daiFromDbRow(row);
  const idx = state.ajustesSistemicos.findIndex(d => d.id === dai.id);
  if (idx >= 0) state.ajustesSistemicos[idx] = dai; else state.ajustesSistemicos.push(dai);
}
function _daiRemoveLocal(rowId) {
  if (!Array.isArray(state.ajustesSistemicos)) return;
  state.ajustesSistemicos = state.ajustesSistemicos.filter(d => d.id !== rowId);
}

let _daiChannel = null;
function _daiRealtimeInit() {
  if (!window.supabaseClient || !window.currentUser || _daiChannel) return;
  const handle = async (payload, tipo) => {
    const row = tipo === 'DELETE' ? payload.old : payload.new;
    if (!row) return;
    if (tipo === 'DELETE') { _daiRemoveLocal(row.id); return; }
    if (await _daiEhRelevantePraMim(row)) _daiUpsertLocal(row); else _daiRemoveLocal(row.id);
  };
  _daiChannel = window.supabaseClient
    .channel('ajustes_sistemicos_realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ajustes_sistemicos' }, (p) => handle(p, 'INSERT'))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ajustes_sistemicos' }, (p) => handle(p, 'UPDATE'))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'ajustes_sistemicos' }, (p) => handle(p, 'DELETE'))
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.warn('[DAI] Canal Realtime com problema:', status);
    });
}
function _daiRealtimeStop() {
  if (_daiChannel && window.supabaseClient) window.supabaseClient.removeChannel(_daiChannel);
  _daiChannel = null;
}

let _daiAnexosPendentes = []; // File[] em memória, até o clique em "Gerar"
let _daiInformanteRowSeq = 0;
let _daiItemRowSeq = 0;

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

function _daiFmtPeso(peso) {
  if (peso === null || peso === undefined || peso === '') return '—';
  const n = Number(peso);
  if (isNaN(n)) return '—';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _daiDataGeracaoKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

// ── Numeração ───────────────────────────────────────────────
// Quando o Nº do documento SAP ainda não é conhecido na hora da geração
// (campo opcional — ver gerarDocumentoAjuste), usamos este placeholder no
// lugar dos dígitos do SAP. O número fiscal final só é calculado de
// verdade quando o analista preenche o SAP depois (ver salvarSapDai).
const DAI_SAP_PENDENTE = 'PENDENTE';

function _daiProximoSequencial(sapDigits, dataKey) {
  const chave = sapDigits || DAI_SAP_PENDENTE;
  const existentes = (state.ajustesSistemicos || []).filter(
    a => a.sapDocumento === chave && a.dataGeracaoKey === dataKey
  );
  return String(existentes.length + 1).padStart(2, '0');
}

function _daiMontarNumero(sapDigits, dataKey, seq) {
  return `DAI-${sapDigits || DAI_SAP_PENDENTE}-${dataKey}-${seq}`;
}

// Identificador curto e sequencial do DAI — mesmo padrão de _nextOcId()
// (OC-HUGO-1, OC-MAYCON-2...) em ocorrencias.js, incluindo o token do
// primeiro nome do criador (31/07: antes era só "DAI-N", sem token —
// como state.ajustesSistemicos só reflete o que o usuário atual vê
// (mine+integrada), duas contas diferentes podiam gerar a mesma tag
// "DAI-1" de forma independente; o token resolve isso do mesmo jeito
// que já resolvia pra ocorrências). Diferente do número fiscal do
// documento (dai.numero, formato DAI-<SAP>-<AAAAMMDD>-<seq>), que
// continua sendo o número oficial impresso no documento; este "tag" serve
// só como referência rápida em cards, tooltips e cross-referências —
// nunca é usada como chave de busca (ver dai.id, esse sim único de
// verdade), então uma colisão aqui é só estética, não funcional.
function _nextDaiTag() {
  const token = (typeof _ocUserToken === 'function')
    ? _ocUserToken(window.currentUser?.nome_completo, window.currentUser?.email)
    : 'USR';
  const prefix = `DAI-${token}-`;
  const lista = state.ajustesSistemicos || [];
  const nums = lista
    .map(d => {
      const label = String(d.tag || '');
      if (!label.startsWith(prefix)) return 0;
      const n = parseInt(label.slice(prefix.length), 10);
      return Number.isFinite(n) ? n : 0;
    })
    .filter(n => n > 0);
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return prefix + next;
}

// Preview do número fiscal no modal de geração — baseado no Nº SAP do
// PRIMEIRO item da lista (ver nota de numeração no topo do arquivo).
function _daiAtualizarPreviewNumero() {
  const wrap = document.getElementById('dai-numero-preview-wrap');
  const el = document.getElementById('dai-numero-preview');
  if (!wrap || !el) return;
  const primeiroSapInput = document.querySelector('#dai-itens-rows .dai-item-card [data-field="sapDocumento"]');
  const sapDigits = _daiSomenteDigitos(primeiroSapInput?.value);
  const dataKey = _daiDataGeracaoKey(new Date());
  const seq = _daiProximoSequencial(sapDigits, dataKey);
  const numero = _daiMontarNumero(sapDigits, dataKey, seq);
  el.innerHTML = sapDigits
    ? `<i class="ti ti-hash"></i> ${escapeHtml(numero)}`
    : `<i class="ti ti-clock-hour-4"></i> ${escapeHtml(numero)} <span style="font-weight:400">— fica pendente até o Nº SAP do 1º item ser preenchido</span>`;
  wrap.style.display = '';
}

// Filtro de dígitos genérico para campos de Nº de documento SAP (documento
// SAP não tem letras nem caracteres especiais).
function _daiFiltrarDigitosInput(input) {
  const digits = _daiSomenteDigitos(input.value);
  if (input.value !== digits) input.value = digits;
}

// Usado nos campos de SAP DENTRO do modal de geração — além de filtrar
// dígitos, atualiza o preview do número (só o 1º item afeta o número).
function _daiFiltrarSapItemInput(input) {
  _daiFiltrarDigitosInput(input);
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

// ── Compatibilidade com DAIs antigos ───────────────────────
// Antes desta funcionalidade, um DAI tinha um único material/peso(não
// existia)/tipoMovimentoSap/sapDocumento/objetivo e um único operador
// (campos "soltos" no registro). Estas duas funções são o ÚNICO ponto de
// leitura de itens/informantes em todo o sistema — tanto os documentos
// quanto o detalhe da ocorrência (ocorrencias.js) passam por elas, para
// que registros antigos continuem abrindo normalmente (reconstruindo um
// item/informante único a partir dos campos legados).
function _daiGetItens(dai) {
  if (Array.isArray(dai.itens) && dai.itens.length) return dai.itens;
  return [{
    id: (dai.id || 'dai') + '_legacy_item',
    material: dai.material || '',
    peso: (typeof dai.peso === 'number') ? dai.peso : null,
    tipoMovimentoSap: dai.tipoMovimentoSap || '',
    sapDocumento: dai.sapDocumento || DAI_SAP_PENDENTE,
    objetivo: dai.objetivo || '',
  }];
}

function _daiGetInformantes(dai) {
  if (Array.isArray(dai.informantes) && dai.informantes.length) return dai.informantes;
  return dai.operador ? [{ nome: dai.operador, cargo: '' }] : [];
}

// Primeira ocorrência vinculada a um DAI — usado só para reabrir o
// detalhe certo depois de uma ação (ex: anexar arquivo). Cobre tanto
// DAIs novos (ocorrenciaIds[]) quanto antigos (ocorrenciaId único).
function _daiPrimeiraOcorrenciaId(dai) {
  if (Array.isArray(dai.ocorrenciaIds) && dai.ocorrenciaIds.length) return dai.ocorrenciaIds[0];
  return dai.ocorrenciaId || null;
}

// ── Modal: abrir / popular ─────────────────────────────────
function abrirModalDai() {
  _daiAnexosPendentes = [];
  const central = document.getElementById('dai-form-central');
  const dataOc  = document.getElementById('dai-form-data-ocorrido');
  const desc    = document.getElementById('dai-form-descricao');
  if (central) central.value = '';
  if (dataOc)  dataOc.value  = new Date().toISOString().split('T')[0];
  if (desc)    desc.value    = '';

  _daiPopularCentrais();

  const informantesWrap = document.getElementById('dai-informantes-rows');
  if (informantesWrap) informantesWrap.innerHTML = '';
  _daiAddInformanteRow();

  const itensWrap = document.getElementById('dai-itens-rows');
  if (itensWrap) itensWrap.innerHTML = '';
  _daiAddItemRow();

  const modoCheckbox = document.getElementById('dai-form-ocorrencia-por-item');
  if (modoCheckbox) modoCheckbox.checked = false;
  _daiAtualizarModoOcorrenciaVisibilidade();

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

// Nome do analista: preenchido automaticamente a partir do nome completo
// do perfil (Conta → Gerenciar Conta — mesmo campo usado em todo o resto
// do sistema). Se vazio, exige preenchimento manual + checkbox de
// ciência dos riscos antes de permitir gerar o documento.
function _daiRenderAnalistaBlock() {
  const wrap = document.getElementById('dai-analista-wrap');
  if (!wrap) return;
  const nomeConfig = window.currentUser?.nome_completo || '';

  if (nomeConfig.trim()) {
    wrap.innerHTML = `
      <div class="oc-form-group">
        <label class="oc-label">Analista responsável (assinatura)</label>
        <div class="dai-intro-box" style="background:var(--bg3);border-color:var(--border2)">
          <i class="ti ti-signature" style="color:var(--gold)"></i>
          <div>
            <strong>${escapeHtml(nomeConfig.trim())}</strong><br>
            <span style="font-size:10.5px;color:var(--text3)">Preenchido automaticamente a partir do seu nome completo (Conta → Gerenciar Conta).</span>
          </div>
        </div>
      </div>`;
  } else {
    wrap.innerHTML = `
      <div class="oc-form-group">
        <label class="oc-label">Nome do analista responsável (assinatura) <span class="oc-required">*</span></label>
        <input type="text" id="dai-form-analista" class="oc-input" placeholder="Seu nome completo">
        <span class="oc-hint">Você ainda não preencheu seu nome completo em Conta → Gerenciar Conta — informe seu nome aqui para este documento.</span>
      </div>
      <div class="dai-consent-box" style="margin-top:8px">
        <input type="checkbox" id="dai-form-atestado">
        <label for="dai-form-atestado">Declaro estar ciente dos riscos de ajustes falsos/inconsistentes perante auditoria e fiscalização, e afirmo que as informações prestadas neste documento estão de acordo com o ocorrido.</label>
      </div>`;
  }
}

// ── Informantes dinâmicos ───────────────────────────────────
// Linha compacta (nome + cargo), reaproveitando o padrão visual/CSS já
// usado em Materiais/Filiais (.reg-individual-row) — inclusive o remove
// compartilhado (_removeIndivRow, definido em config.js).
function _daiAddInformanteRow() {
  const container = document.getElementById('dai-informantes-rows');
  if (!container) return;
  const id = _daiInformanteRowSeq++;
  const row = document.createElement('div');
  row.className = 'reg-individual-row reg-row-dai-informante';
  row.dataset.rowId = id;
  row.innerHTML = `
    <div class="oc-form-group">
      <label class="oc-label" style="font-size:10px">Nome</label>
      <input type="text" class="oc-input" data-field="nome" placeholder="Nome de quem informou o ocorrido">
    </div>
    <div class="oc-form-group">
      <label class="oc-label" style="font-size:10px">Cargo <span class="oc-hint">(opcional)</span></label>
      <input type="text" class="oc-input" data-field="cargo" placeholder="Operador, encarregado…">
    </div>
    <div class="reg-row-remove" title="Remover informante" onclick="_removeIndivRow(this)"><i class="ti ti-x"></i></div>
  `;
  container.appendChild(row);
}

function _daiColetarInformantesDoModal() {
  const rows = [...document.querySelectorAll('#dai-informantes-rows .reg-individual-row')];
  return rows
    .map(row => ({
      nome: row.querySelector('[data-field="nome"]')?.value.trim() || '',
      cargo: row.querySelector('[data-field="cargo"]')?.value.trim() || '',
    }))
    .filter(inf => inf.nome); // ignora linhas em branco
}

// ── Itens dinâmicos (material + peso + movimento + SAP + função) ───
function _daiMaterialOptionsHtml() {
  const grupos = (typeof getGruposMateriaisDisponiveis === 'function') ? getGruposMateriaisDisponiveis() : [];
  return grupos.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
}

function _daiAddItemRow() {
  const container = document.getElementById('dai-itens-rows');
  if (!container) return;
  const id = _daiItemRowSeq++;
  const card = document.createElement('div');
  card.className = 'dai-item-card';
  card.dataset.rowId = id;
  card.innerHTML = `
    <div class="dai-item-card-header">
      <span class="dai-item-card-title">Item</span>
      <div class="dai-item-card-remove" title="Remover item" onclick="_daiRemoverItemRow(this)"><i class="ti ti-x"></i></div>
    </div>
    <div class="oc-form-group">
      <label class="oc-label">Material <span class="oc-hint">(grupo SAP)</span> <span class="oc-required">*</span></label>
      <select class="oc-input" data-field="material">
        <option value="">Selecione o grupo SAP</option>
        ${_daiMaterialOptionsHtml()}
      </select>
    </div>
    <div class="oc-form-row">
      <div class="oc-form-group">
        <label class="oc-label">Peso (kg) <span class="oc-required">*</span></label>
        <input type="number" class="oc-input" data-field="peso" step="0.01" min="0" inputmode="decimal" placeholder="0,00">
      </div>
      <div class="oc-form-group">
        <label class="oc-label">Tipo de movimento SAP <span class="oc-required">*</span></label>
        <input type="text" class="oc-input" data-field="tipoMovimentoSap" placeholder="Ex.: 701, 702, Y11…" style="text-transform:uppercase" oninput="this.value = this.value.toUpperCase()">
      </div>
    </div>
    <div class="oc-form-row">
      <div class="oc-form-group">
        <label class="oc-label">Nº do documento SAP (pós-ajuste) <span class="oc-hint">(opcional)</span></label>
        <input type="text" class="oc-input" data-field="sapDocumento" inputmode="numeric" placeholder="Somente números — deixe em branco se pendente" oninput="_daiFiltrarSapItemInput(this)">
      </div>
      <div class="oc-form-group">
        <label class="oc-label">Função do movimento SAP <span class="oc-required">*</span></label>
        <input type="text" class="oc-input" data-field="objetivo" placeholder="Diminuir saldo em estoque, gerar documento de coleta de material…">
      </div>
    </div>
  `;
  container.appendChild(card);
  _daiRenumerarItens();
  _daiAtualizarModoOcorrenciaVisibilidade();
  _daiAtualizarPreviewNumero();
}

// Mantém sempre pelo menos 1 item visível (limpa em vez de remover, se
// for o último) — mesmo critério de _removeIndivRow em config.js.
function _daiRemoverItemRow(el) {
  const card = el.closest('.dai-item-card');
  if (!card) return;
  const container = card.parentElement;
  if (container.children.length <= 1) {
    card.querySelectorAll('input, select').forEach(i => { i.value = ''; });
    _daiRenumerarItens();
    _daiAtualizarPreviewNumero();
    return;
  }
  card.remove();
  _daiRenumerarItens();
  _daiAtualizarModoOcorrenciaVisibilidade();
  _daiAtualizarPreviewNumero();
}

function _daiRenumerarItens() {
  const cards = [...document.querySelectorAll('#dai-itens-rows .dai-item-card')];
  cards.forEach((card, idx) => {
    const title = card.querySelector('.dai-item-card-title');
    if (title) title.textContent = `Item ${idx + 1}`;
  });
}

// O toggle "1 ocorrência por item" só faz sentido (e só aparece) quando
// há mais de 1 item na nota — com 1 item só, o comportamento é idêntico
// ao de antes desta funcionalidade (1 DAI = 1 ocorrência).
function _daiAtualizarModoOcorrenciaVisibilidade() {
  const wrap = document.getElementById('dai-ocorrencia-modo-wrap');
  if (!wrap) return;
  const total = document.querySelectorAll('#dai-itens-rows .dai-item-card').length;
  wrap.style.display = total > 1 ? '' : 'none';
  if (total <= 1) {
    const cb = document.getElementById('dai-form-ocorrencia-por-item');
    if (cb) cb.checked = false;
  }
}

function _daiColetarItensDoModal() {
  const cards = [...document.querySelectorAll('#dai-itens-rows .dai-item-card')];
  return cards.map(card => ({
    material: card.querySelector('[data-field="material"]')?.value.trim() || '',
    peso: card.querySelector('[data-field="peso"]')?.value,
    tipoMovimentoSap: card.querySelector('[data-field="tipoMovimentoSap"]')?.value.trim() || '',
    sapDocumento: _daiSomenteDigitos(card.querySelector('[data-field="sapDocumento"]')?.value),
    objetivo: card.querySelector('[data-field="objetivo"]')?.value.trim() || '',
  }));
}

// ── Anexos ──────────────────────────────────────────────────
const DAI_ANEXO_MAX_MB = 15;

// Sobe o anexo pro Storage (31/07) — mesmo bucket já usado pelos anexos do
// formulário público (solicitacoes-anexos), sob o prefixo "interno/" (a
// policy de INSERT autenticado cobre só esse prefixo; "publico/" continua
// exclusivo do formulário anônimo). Antes, anexos de DAI manual ficavam só
// no IndexedDB do navegador de quem gerou — outro analista/ADM, ou o mesmo
// analista depois de limpar o navegador, não conseguia mais recuperá-los
// (baixarZipDai reportava como "faltante"). Devolve o `path` salvo, ou
// null se o upload falhar (fica só com os metadados, sem travar o fluxo).
async function _daiSubirAnexo(daiId, file) {
  if (!window.supabaseClient) return null;
  const nomeSeguro = file.name.replace(/[^a-zA-Z0-9_.\-]/g, '_').slice(-120);
  const path = `interno/${daiId}/${Date.now()}_${nomeSeguro}`;
  const { error } = await window.supabaseClient.storage
    .from('solicitacoes-anexos')
    .upload(path, file, { contentType: file.type || 'application/octet-stream' });
  if (error) {
    console.warn('[DAI] Falha ao subir anexo pro Storage:', error);
    return null;
  }
  return path;
}

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

// ── Geração do documento + ocorrência(s) ────────────────────
async function gerarDocumentoAjuste() {
  const central      = document.getElementById('dai-form-central')?.value.trim();
  const dataOcorrido = document.getElementById('dai-form-data-ocorrido')?.value;
  const descricao    = document.getElementById('dai-form-descricao')?.value.trim();
  const informantes  = _daiColetarInformantesDoModal();
  const itensRaw     = _daiColetarItensDoModal();
  const gerarPorItem = !!document.getElementById('dai-form-ocorrencia-por-item')?.checked;

  if (!central)             return toast('Selecione a central.', 'error');
  if (!dataOcorrido)        return toast('Informe a data do ocorrido.', 'error');
  if (!informantes.length)  return toast('Informe ao menos um informante (nome).', 'error');
  if (!descricao)           return toast('Descreva o ocorrido.', 'error');
  if (!itensRaw.length)     return toast('Adicione ao menos um item (material/peso/movimento).', 'error');

  for (let i = 0; i < itensRaw.length; i++) {
    const it = itensRaw[i];
    const pesoNum = parseFloat(String(it.peso).replace(',', '.'));
    if (!it.material)                          return toast(`Item ${i + 1}: selecione o material (grupo SAP).`, 'error');
    if (it.peso === '' || isNaN(pesoNum) || pesoNum < 0) return toast(`Item ${i + 1}: informe o peso (kg).`, 'error');
    if (!it.tipoMovimentoSap)                  return toast(`Item ${i + 1}: informe o tipo de movimento SAP.`, 'error');
    if (!it.objetivo)                          return toast(`Item ${i + 1}: informe a função do movimento SAP.`, 'error');
  }

  // Guarda de período fechado — usa dataOcorrido (quando o ajuste de fato
  // aconteceu), não a data de hoje, senão um DAI novo sempre escaparia da
  // trava (todo documento é "gerado hoje", nunca no mês fechado).
  if (window.currentUser?.role !== 'admin' && typeof isPeriodoFechado === 'function') {
    const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(dataOcorrido);
    if (m && isPeriodoFechado(m[1], m[2])) {
      return toast('Período fechado pelo administrador — não é possível gerar um ajuste para essa data.', 'error');
    }
  }

  const cnpjCentral = _daiObterCnpjCentral(central);
  if (!cnpjCentral) return toast(`A central "${central}" não tem CNPJ cadastrado. Preencha em Configurações → Cadastros antes de gerar o documento.`, 'error');
  const regionalCentral = _daiObterRegionalCentral(central);

  // Analista responsável / atestado de ciência
  const nomeConfig = window.currentUser?.nome_completo || '';
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

    const itens = itensRaw.map((it, idx) => ({
      id: 'item_' + idx + '_' + Math.random().toString(36).slice(2, 8),
      material: it.material,
      peso: parseFloat(String(it.peso).replace(',', '.')),
      tipoMovimentoSap: it.tipoMovimentoSap,
      sapDocumento: it.sapDocumento || DAI_SAP_PENDENTE,
      objetivo: it.objetivo,
    }));

    // Número fiscal do DAI: baseado no Nº SAP do PRIMEIRO item (mesma
    // regra de quando só existia 1 item por DAI — ver nota no topo do
    // arquivo). Os demais itens guardam seu próprio SAP individualmente.
    const primeiroSap = itens[0].sapDocumento === DAI_SAP_PENDENTE ? '' : itens[0].sapDocumento;
    const seq    = _daiProximoSequencial(primeiroSap, dataGeracaoKey);
    const numero = _daiMontarNumero(primeiroSap, dataGeracaoKey, seq);
    const tag    = _nextDaiTag();
    const daiId  = 'dai_' + dataGeracaoTs + '_' + Math.random().toString(36).slice(2, 8);

    // Hash + upload dos anexos pro Storage (path vira a fonte de verdade —
    // ver _daiSubirAnexo). Se o upload falhar, o anexo fica só com os
    // metadados (sem path) e o toast avisa; não trava a geração do
    // documento, que já é o dado mais importante.
    const anexosFiles = [..._daiAnexosPendentes];
    const anexosMeta = [];
    let anexosComFalha = 0;
    for (const f of anexosFiles) {
      const hash = await _daiHashArquivo(f);
      const path = await _daiSubirAnexo(daiId, f);
      if (!path) anexosComFalha++;
      anexosMeta.push({ nome: f.name, tipo: f.type || 'application/octet-stream', tamanho: f.size, hash, path });
    }
    if (anexosComFalha) toast(`${anexosComFalha} anexo(s) não puderam ser enviados — o documento foi gerado mesmo assim.`, 'error');

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
      descricao,
      informantes,
      itens,
      analista,
      atestadoManual,
      ocorrenciaPorItem: gerarPorItem && itens.length > 1,
      ocorrenciaIds: [],
      anexos: anexosMeta,
      // Espelhos dos campos legados (compatibilidade com qualquer código
      // que ainda leia estes campos "soltos" diretamente do registro) —
      // a fonte da verdade passa a ser sempre itens[]/informantes[].
      material: itens.map(i => i.material).join(', '),
      tipoMovimentoSap: itens.map(i => i.tipoMovimentoSap).join(', '),
      objetivo: itens.map(i => i.objetivo).join(', '),
      operador: informantes.map(i => i.nome).join(', '),
      sapDocumento: itens[0].sapDocumento,
    };

    // Ocorrência(s) automática(s) — dourada(s), status exclusivo. Os ids
    // são reservados um a um (push direto em state.ocorrencias) para que
    // _nextOcId() não repita o mesmo número em duas ocorrências da mesma
    // geração.
    if (!Array.isArray(state.ocorrencias)) state.ocorrencias = [];
    const operadorResumo = informantes.map(i => i.nome).join(', ');
    const ocsCriadas = [];

    if (daiRecord.ocorrenciaPorItem) {
      itens.forEach(item => {
        const ocId = _ocGerarIdSeguro();
        const ocNumero = _nextOcId();
        daiRecord.ocorrenciaIds.push(ocId);
        const concluidaNaGeracao = item.sapDocumento !== DAI_SAP_PENDENTE;
        const oc = {
          id: ocId,
          numero: ocNumero,
          dataAbertura: dataOcorrido,
          motivo: item.objetivo,
          dataLimite: null,
          central,
          material: item.material,
          operador: operadorResumo,
          contato: null,
          descricao,
          concluida: concluidaNaGeracao,
          dataConclusao: concluidaNaGeracao ? dataGeracaoDate.toISOString().split('T')[0] : null,
          descConclusao: concluidaNaGeracao
            ? `Ajuste sistêmico registrado via Documento ${numero}. Função do movimento SAP: ${item.objetivo}. Tipo de movimento SAP: ${item.tipoMovimentoSap}. Documento SAP: ${item.sapDocumento}. Peso: ${_daiFmtPeso(item.peso)} kg.`
            : null,
          hierarquia: [],
          criadoEm: dataGeracaoTs,
          origemAjusteSistemico: true,
          daiId,
          daiNumero: numero,
          daiTag: tag,
          daiItemId: item.id,
          criadoPorNome: analista,
        };
        state.ocorrencias.push(oc);
        ocsCriadas.push(oc);
      });
    } else {
      const ocId = _ocGerarIdSeguro();
      const ocNumero = _nextOcId();
      daiRecord.ocorrenciaIds.push(ocId);
      const todosConcluidos = itens.every(it => it.sapDocumento !== DAI_SAP_PENDENTE);
      const materiaisResumo = [...new Set(itens.map(it => it.material))].join(', ');
      const oc = {
        id: ocId,
        numero: ocNumero,
        dataAbertura: dataOcorrido,
        motivo: itens[0].objetivo,
        dataLimite: null,
        central,
        material: materiaisResumo,
        operador: operadorResumo,
        contato: null,
        descricao,
        concluida: todosConcluidos,
        dataConclusao: todosConcluidos ? dataGeracaoDate.toISOString().split('T')[0] : null,
        descConclusao: todosConcluidos
          ? `Ajuste sistêmico registrado via Documento ${numero}. ${itens.length} item(ns) processado(s).`
          : null,
        hierarquia: [],
        criadoEm: dataGeracaoTs,
        origemAjusteSistemico: true,
        daiId,
        daiNumero: numero,
        daiTag: tag,
        daiItemId: null,
        criadoPorNome: analista,
      };
      state.ocorrencias.push(oc);
      ocsCriadas.push(oc);
    }

    if (!Array.isArray(state.ajustesSistemicos)) state.ajustesSistemicos = [];
    state.ajustesSistemicos.push(daiRecord);
    persist();
    renderOcorrencias();
    // Sincroniza as ocorrências geradas com o Supabase (a tabela ocorrencias
    // já existe — ver ocorrencias.js).
    if (typeof _ocSyncUpsert === 'function') {
      ocsCriadas.forEach(oc => _ocSyncUpsert(oc));
    }
    _daiSyncUpsert(daiRecord);

    // Abre o documento para impressão/"Salvar PDF"
    const docHtml = _daiBuildDocumentoHtml(daiRecord);
    _openRelWindow(docHtml);

    closeModal('dai-modal');
    populateOcFiltros();

    const pendentes = itens.filter(it => it.sapDocumento === DAI_SAP_PENDENTE).length;
    toast(
      pendentes === 0
        ? `Documento ${numero} gerado e ${ocsCriadas.length} ocorrência(s) concluída(s). Use os botões no card da ocorrência para gerar o Termo de Responsabilidade.`
        : `Documento ${numero} gerado com ${pendentes} de ${itens.length} item(ns) PENDENTE(S) — ficará(ão) em aberto até o(s) Nº do documento SAP ser(em) preenchido(s) (botão "Editar Nº SAP" no card).`,
      'success'
    );
  } catch (err) {
    console.error('[DAI] Falha ao gerar documento:', err);
    toast('Falha ao gerar o documento. Veja o console para detalhes.', 'error');
  } finally {
    if (typeof _setBtnLoading === 'function') _setBtnLoading(btn, false);
  }
}

// ── Editar Nº do documento SAP — por item, único dado editável pós-emissão ──
// Abre o mini-modal listando cada item do DAI com seu próprio campo de Nº
// SAP (ou vazio, se ainda pendente) + uma data de conclusão compartilhada.
// Disponível em QUALQUER DAI (pendente ou já concluído) — permite tanto
// completar item(ns) pendente(s) quanto corrigir um número SAP já
// preenchido.
function editarSapDai(daiId) {
  const dai = (state.ajustesSistemicos || []).find(d => d.id === daiId);
  if (!dai) { toast('Documento não encontrado — pode já ter sido excluído.', 'error'); return; }

  document.getElementById('dai-sap-modal-daiid').value = daiId;
  document.getElementById('dai-sap-modal-data').value = new Date().toISOString().split('T')[0];

  const itens = _daiGetItens(dai);
  const wrap = document.getElementById('dai-sap-modal-itens');
  if (wrap) {
    wrap.innerHTML = itens.map((it, idx) => {
      const precisaClassificar = !it.tipoMovimentoSap || !it.objetivo;
      const extraCampos = precisaClassificar ? `
        <div class="oc-form-group">
          <label class="oc-label">Tipo de movimento SAP <span class="oc-required">*</span> <span class="oc-hint">(vindo do formulário público — só o analista sabe esse código)</span></label>
          <input type="text" class="oc-input dai-sap-modal-item-movimento" data-item-id="${escapeHtml(it.id)}" placeholder="Ex.: 701, 702, Y11…" style="text-transform:uppercase" value="${escapeHtml(it.tipoMovimentoSap || '')}" oninput="this.value = this.value.toUpperCase()">
        </div>
        <div class="oc-form-group">
          <label class="oc-label">Função do movimento <span class="oc-required">*</span></label>
          <input type="text" class="oc-input dai-sap-modal-item-objetivo" data-item-id="${escapeHtml(it.id)}" placeholder="Diminuir saldo em estoque, gerar documento de coleta de material…" value="${escapeHtml(it.objetivo || '')}">
        </div>` : '';
      return `
      <div class="oc-form-group">
        <label class="oc-label">${escapeHtml(it.material || ('Item ' + (idx + 1)))} <span class="oc-hint">— Nº do documento SAP</span></label>
        <input type="text" class="oc-input dai-sap-modal-item-input" data-item-id="${escapeHtml(it.id)}" inputmode="numeric" placeholder="Somente números" value="${it.sapDocumento === DAI_SAP_PENDENTE ? '' : escapeHtml(it.sapDocumento || '')}" oninput="_daiFiltrarDigitosInput(this)">
      </div>${extraCampos}`;
    }).join('');
  }

  openModal('dai-sap-modal');
}

async function salvarSapDai() {
  const daiId = document.getElementById('dai-sap-modal-daiid')?.value;
  const dai = (state.ajustesSistemicos || []).find(d => d.id === daiId);
  if (!dai) { toast('Documento não encontrado — pode já ter sido excluído.', 'error'); return; }

  if (window.currentUser?.role !== 'admin' && typeof isPeriodoFechado === 'function') {
    const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(dai.dataOcorrido || '');
    if (m && isPeriodoFechado(m[1], m[2])) {
      toast('Período fechado pelo administrador — não é possível editar este ajuste.', 'error');
      return;
    }
  }

  const dataConclusao = document.getElementById('dai-sap-modal-data')?.value;
  const itens = _daiGetItens(dai);
  const inputs = [...document.querySelectorAll('.dai-sap-modal-item-input')];

  const vaiPreencherAlgum = inputs.some(inp => _daiSomenteDigitos(inp.value));
  if (vaiPreencherAlgum && !dataConclusao) return toast('Informe a data de conclusão.', 'error');

  // Itens vindos do formulário público chegam sem Tipo de Movimento/Função
  // do movimento (o operador não tem esse conhecimento) — o analista tem
  // que classificar ANTES de poder fechar o item com um Nº SAP.
  for (const inp of inputs) {
    if (!_daiSomenteDigitos(inp.value)) continue; // item continuando pendente, não exige nada extra
    const item = itens.find(it => it.id === inp.dataset.itemId);
    if (!item) continue;
    if (item.tipoMovimentoSap && item.objetivo) continue; // já classificado, nada a exigir
    const movInput = document.querySelector(`.dai-sap-modal-item-movimento[data-item-id="${item.id}"]`);
    const objInput = document.querySelector(`.dai-sap-modal-item-objetivo[data-item-id="${item.id}"]`);
    if (!movInput?.value?.trim() || !objInput?.value?.trim()) {
      return toast(`Preencha o Tipo de Movimento e a Função do movimento de "${item.material || 'item'}" antes de informar o Nº SAP.`, 'error');
    }
  }

  inputs.forEach(inp => {
    const item = itens.find(it => it.id === inp.dataset.itemId);
    if (!item) return;
    const digits = _daiSomenteDigitos(inp.value);
    item.sapDocumento = digits || DAI_SAP_PENDENTE;

    const movInput = document.querySelector(`.dai-sap-modal-item-movimento[data-item-id="${item.id}"]`);
    const objInput = document.querySelector(`.dai-sap-modal-item-objetivo[data-item-id="${item.id}"]`);
    if (movInput) item.tipoMovimentoSap = movInput.value.trim().toUpperCase();
    if (objInput) item.objetivo = objInput.value.trim();
  });

  // Espelha o item[0] nos campos legados de nível-DAI (dai.tipoMovimentoSap/
  // dai.objetivo) — é isso que _daiSyncUpsert() manda pro Supabase.
  if (itens[0]) {
    dai.tipoMovimentoSap = itens[0].tipoMovimentoSap;
    dai.objetivo = itens[0].objetivo;
  }

  // Registro legado (sem itens[] próprio) — grava a reconstrução de volta
  // no registro, migrando-o para o novo formato a partir de agora.
  if (!Array.isArray(dai.itens) || !dai.itens.length) dai.itens = itens;

  // Recalcula o número fiscal com o SAP do primeiro item, mesma regra da
  // geração. Exclui o próprio registro da contagem da sequência do dia,
  // senão ele se contaria a si mesmo.
  const primeiroSap = itens[0].sapDocumento === DAI_SAP_PENDENTE ? '' : itens[0].sapDocumento;
  const outrosComMesmoSapEData = (state.ajustesSistemicos || []).filter(
    d => d.id !== dai.id && d.sapDocumento === (primeiroSap || DAI_SAP_PENDENTE) && d.dataGeracaoKey === dai.dataGeracaoKey
  );
  const seq = String(outrosComMesmoSapEData.length + 1).padStart(2, '0');
  dai.sapDocumento = itens[0].sapDocumento;
  dai.numero = _daiMontarNumero(primeiroSap, dai.dataGeracaoKey, seq);

  // Atualiza a(s) ocorrência(s) vinculada(s) — por item (se o modo
  // "ocorrência por item" foi usado na geração) ou em bloco (1 ocorrência
  // para o DAI inteiro, concluída só quando TODOS os itens tiverem SAP).
  const ocsVinculadas = (state.ocorrencias || []).filter(o => o.daiId === dai.id);
  const porItem = ocsVinculadas.length > 1 && ocsVinculadas.every(o => o.daiItemId);

  if (porItem) {
    ocsVinculadas.forEach(oc => {
      const item = itens.find(it => it.id === oc.daiItemId);
      if (!item) return;
      oc.daiNumero = dai.numero;
      if (item.sapDocumento !== DAI_SAP_PENDENTE) {
        oc.concluida = true;
        oc.dataConclusao = dataConclusao || oc.dataConclusao;
        oc.descConclusao = `Ajuste sistêmico registrado via Documento ${dai.numero}. Função do movimento SAP: ${item.objetivo}. Tipo de movimento SAP: ${item.tipoMovimentoSap}. Documento SAP: ${item.sapDocumento}. Peso: ${_daiFmtPeso(item.peso)} kg.`;
      } else {
        oc.concluida = false;
        oc.dataConclusao = null;
        oc.descConclusao = null;
      }
    });
  } else {
    const todosConcluidos = itens.every(it => it.sapDocumento !== DAI_SAP_PENDENTE);
    ocsVinculadas.forEach(oc => {
      oc.daiNumero = dai.numero;
      if (todosConcluidos) {
        oc.concluida = true;
        oc.dataConclusao = dataConclusao || oc.dataConclusao;
        oc.descConclusao = `Ajuste sistêmico registrado via Documento ${dai.numero}. ${itens.length} item(ns) processado(s).`;
      } else {
        oc.concluida = false;
        oc.dataConclusao = null;
        oc.descConclusao = null;
      }
    });
  }

  persist();
  renderOcorrencias();
  closeModal('dai-sap-modal');
  _daiSyncUpsert(dai);
  if (typeof _ocSyncUpsert === 'function') ocsVinculadas.forEach(oc => _ocSyncUpsert(oc));

  const detailModal = document.getElementById('oc-detail-modal');
  const currentDetailId = detailModal?.dataset.currentId;
  const ocParaReabrir = ocsVinculadas.find(o => o.id === currentDetailId) || ocsVinculadas[0];
  if (detailModal?.classList.contains('open') && ocParaReabrir && typeof openOcDetailModal === 'function') {
    openOcDetailModal(ocParaReabrir.id);
  }

  const pendentesRestantes = itens.filter(it => it.sapDocumento === DAI_SAP_PENDENTE).length;
  toast(
    pendentesRestantes === 0
      ? `Ajuste concluído — número atualizado para ${dai.numero}.`
      : `${pendentesRestantes} de ${itens.length} item(ns) ainda pendente(s) — número atual ${dai.numero}.`,
    'success'
  );
}

function reimprimirDocumentoDai(daiId) {
  const dai = (state.ajustesSistemicos || []).find(d => d.id === daiId);
  if (!dai) { toast('Documento não encontrado — pode já ter sido excluído.', 'error'); return; }
  const html = _daiBuildDocumentoHtml(dai);
  _openRelWindow(html);
}

// ── Anexar arquivo a um DAI já emitido ──────────────────────
// Chamado pelo botão "Anexar Arquivo" no card/detalhe da ocorrência de
// Ajuste Sistêmico. Diferente do anexo na hora da geração (formulário),
// este fluxo grava direto no DAI já existente: sobe o arquivo pro Storage
// (ver _daiSubirAnexo), registra os metadados (com `path`) em
// state.ajustesSistemicos e persiste. O documento reimpresso já reflete
// os novos anexos automaticamente, pois é reconstruído sob demanda a
// partir de dai.anexos.
function adicionarAnexoDaiExistente(daiId) {
  const dai = (state.ajustesSistemicos || []).find(d => d.id === daiId);
  if (!dai) { toast('Documento não encontrado — pode já ter sido excluído.', 'error'); return; }

  const input = document.createElement('input');
  input.type = 'file';
  input.id = 'dai-anexo-add-input-temp';
  input.multiple = true;
  input.accept = 'image/*,.pdf,.doc,.docx';
  input.style.display = 'none';
  input.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    document.body.removeChild(input);
    if (!files.length) return;
    await _daiAdicionarAnexosPosGeracao(dai, files);
  });
  document.body.appendChild(input);
  input.click();
}

async function _daiAdicionarAnexosPosGeracao(dai, files) {
  if (!Array.isArray(dai.anexos)) dai.anexos = [];
  let adicionados = 0;

  for (const f of files) {
    if (f.size > DAI_ANEXO_MAX_MB * 1024 * 1024) {
      toast(`"${f.name}" excede ${DAI_ANEXO_MAX_MB}MB e não foi anexado.`, 'error');
      continue;
    }
    const path = await _daiSubirAnexo(dai.id, f);
    if (!path) {
      toast(`Falha ao enviar "${f.name}" — tente novamente.`, 'error');
      continue;
    }
    const hash = await _daiHashArquivo(f);
    dai.anexos.push({ nome: f.name, tipo: f.type || 'application/octet-stream', tamanho: f.size, hash, path });
    adicionados++;
  }

  if (!adicionados) return;

  persist();
  renderOcorrencias();
  _daiSyncUpsert(dai);

  // Se o modal de detalhe de alguma ocorrência ligada a este DAI estiver
  // aberto, atualiza a seção do DAI na hora para refletir o(s) anexo(s)
  // recém-adicionado(s).
  const detailModal = document.getElementById('oc-detail-modal');
  const currentDetailId = detailModal?.dataset.currentId;
  const ocsVinculadas = (state.ocorrencias || []).filter(o => o.daiId === dai.id).map(o => o.id);
  const idParaReabrir = ocsVinculadas.includes(currentDetailId) ? currentDetailId : _daiPrimeiraOcorrenciaId(dai);
  if (detailModal?.classList.contains('open') && idParaReabrir && typeof openOcDetailModal === 'function') {
    openOcDetailModal(idParaReabrir);
  }

  toast(`${adicionados} anexo(s) adicionado(s) ao ${dai.tag || dai.numero}.`, 'success');
}

// ── HTML do documento corporativo ──────────────────────────
// Documento autocontido (própria janela, sem depender do CSS do app) —
// mesmo padrão de relatorio.js (_openRelWindow abre em nova janela com
// botão "Imprimir / Salvar PDF"). Fundo claro/portrait: é um documento
// para ser impresso em papel ou salvo como PDF e arquivado, diferente
// dos dashboards internos do sistema. Itera itens (tabela) e informantes
// (lista) — cobre tanto DAIs novos quanto antigos, via _daiGetItens/
// _daiGetInformantes.
// Barra de ação (topo fixo com título + botões Imprimir/Fechar) — igual nos
// dois documentos gerados por este arquivo (DAI e Termo de Responsabilidade),
// antes copiada e colada em cada um.
function _daiActionBarCss() {
  return `
  .action-bar { position: sticky; top: 0; z-index: 100; background: #1c1608; display: flex; align-items: center; justify-content: space-between; padding: 12px 24px; box-shadow: 0 2px 12px rgba(0,0,0,.3); }
  .action-bar-title { color: #f4f1e8; font-size: 13px; font-weight: 500; }
  .action-bar-title span { color: #c9a227; font-size: 12px; margin-left: 10px; font-family: monospace; }
  .action-bar-btns { display: flex; gap: 10px; }
  .btn-print { background: #c9a227; color: #1c1608; border: none; border-radius: 7px; padding: 8px 18px; font-size: 13px; font-weight: 700; cursor: pointer; }
  .btn-print:hover { background: #b5911f; }
  .btn-close { background: #3a2f14; color: #eee; border: none; border-radius: 7px; padding: 8px 14px; font-size: 13px; cursor: pointer; }
  .btn-close:hover { background: #4a3d1c; }`;
}

function _daiBuildDocumentoHtml(dai) {
  const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s ?? ''));
  const dataGeracaoFmt = dai.dataGeracao ? new Date(dai.dataGeracao).toLocaleString('pt-BR') : '—';
  const dataOcorridoFmt = (typeof fmtDateBR === 'function') ? fmtDateBR(dai.dataOcorrido) : (dai.dataOcorrido || '—');

  const itens = _daiGetItens(dai);
  const informantes = _daiGetInformantes(dai);
  const algumPendente = itens.some(it => !it.sapDocumento || it.sapDocumento === DAI_SAP_PENDENTE);

  const informantesTxt = informantes.map(i => esc(i.nome) + (i.cargo ? ` (${esc(i.cargo)})` : '')).join(', ') || '—';

  const itensHtml = `
    <div class="field-label">Item(ns) do ajuste (${itens.length})</div>
    <table class="itens-table">
      <thead><tr><th>Material</th><th>Peso (kg)</th><th>Tipo Mov.</th><th>Nº Doc. SAP</th><th>Função do movimento</th></tr></thead>
      <tbody>
        ${itens.map(it => `<tr>
          <td>${esc(it.material || '—')}</td>
          <td>${esc(_daiFmtPeso(it.peso))}</td>
          <td>${esc(it.tipoMovimentoSap || '—')}</td>
          <td>${(!it.sapDocumento || it.sapDocumento === DAI_SAP_PENDENTE) ? '<span style="color:#a06a10">Pendente</span>' : esc(it.sapDocumento)}</td>
          <td>${esc(it.objetivo || '—')}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;

  const anexosHtml = (Array.isArray(dai.anexos) && dai.anexos.length) ? `
    <div class="field-label">Anexos de comprovação (${dai.anexos.length})</div>
    <div class="anexos-list">
      ${dai.anexos.map(a => `
        <div class="anexo-item">
          <span>${esc(a.nome)} <span style="color:#8a7a64">(${formatBytes(a.tamanho)})</span></span>
          <span class="anexo-hash" title="SHA-256 completo: ${a.hash ? esc(a.hash) : 'não calculado'}">${a.hash ? esc(a.hash.slice(0, 16)) + '…' : '— sem hash —'}</span>
        </div>`).join('')}
    </div>
    <div style="font-size:9px;color:#8a7a64;margin-top:-8px;margin-bottom:18px">Os arquivos originais dos anexos acompanham o pacote baixado junto com este documento (ver botões no card da ocorrência).</div>
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

  ${_daiActionBarCss()}

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

  .itens-table { width: 100%; border-collapse: collapse; margin: 6px 0 20px; font-size: 11px; }
  .itens-table th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .05em; color: #8a7a64; padding: 6px 8px; border-bottom: 2px solid #c9a227; }
  .itens-table td { padding: 7px 8px; border-bottom: 1px solid #e5ddc8; overflow-wrap: anywhere; }
  .itens-table tr:last-child td { border-bottom: 1px solid #1c1608; }

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

  ${algumPendente ? `<div class="confidential-strip" style="background:#fef2e5;border-color:#c98527;color:#8a5a0f"><i>⏳</i> Ajuste com item(ns) pendente(s) — aguardando preenchimento do Nº do documento SAP para conclusão</div>` : ''}

  <div class="field-grid">
    <div><div class="field-label">Central${dai.regionalCentral ? ` <span style="text-transform:none;font-weight:400">— Regional ${esc(dai.regionalCentral)}</span>` : ''}</div><div class="field-value">${esc(dai.central)}${dai.cnpjCentral ? ` <span style="font-weight:400;font-size:10.5px;color:#8a7a64">(CNPJ ${esc(dai.cnpjCentral)})</span>` : ''}</div></div>
    <div><div class="field-label">Data do ocorrido</div><div class="field-value">${esc(dataOcorridoFmt)}</div></div>
    <div><div class="field-label">Data/hora de geração do documento</div><div class="field-value">${esc(dataGeracaoFmt)}</div></div>
    <div><div class="field-label">Quantidade de itens</div><div class="field-value">${itens.length}</div></div>
  </div>

  <div class="field-label">Informante(s)</div>
  <div class="field-value" style="border-bottom:1px solid #e5ddc8;padding-bottom:5px;margin-bottom:16px">${informantesTxt}</div>

  <div class="field-label">Descrição do ocorrido</div>
  <div class="desc-box">${esc(dai.descricao)}</div>

  ${itensHtml}

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

// ── Termo de Responsabilidade do(s) Informante(s) ───────────
// Documento separado do DAI, gerado sob demanda (botão no card/detalhe
// da ocorrência) — não é auto-gerado junto com o DAI. Destinado a ser
// impresso/enviado a cada informante para assinatura física, atestando a
// veracidade das informações que ele prestou. Vinculado ao DAI apenas por
// referência (rodapé) — não é uma cópia do documento fiscal, é uma
// declaração independente de cada informante. Com múltiplos informantes,
// a declaração + assinatura se repete uma vez para cada um.
function gerarTermoResponsabilidade(daiId) {
  const dai = (state.ajustesSistemicos || []).find(d => d.id === daiId);
  if (!dai) { toast('Documento não encontrado — pode já ter sido excluído.', 'error'); return; }
  const html = _daiBuildTermoHtml(dai);
  _openRelWindow(html);
}

function _daiBuildTermoHtml(dai) {
  const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s ?? ''));
  const dataOcorridoFmt = (typeof fmtDateBR === 'function') ? fmtDateBR(dai.dataOcorrido) : (dai.dataOcorrido || '—');

  const itens = _daiGetItens(dai);
  const informantes = _daiGetInformantes(dai);

  const itensHtml = `
    <div class="field-label">Item(ns) do ajuste (${itens.length})</div>
    <table class="itens-table">
      <thead><tr><th>Material</th><th>Peso (kg)</th><th>Tipo Mov.</th><th>Nº Doc. SAP</th><th>Função do movimento</th></tr></thead>
      <tbody>
        ${itens.map(it => `<tr>
          <td>${esc(it.material || '—')}</td>
          <td>${esc(_daiFmtPeso(it.peso))}</td>
          <td>${esc(it.tipoMovimentoSap || '—')}</td>
          <td>${(!it.sapDocumento || it.sapDocumento === DAI_SAP_PENDENTE) ? '<span style="color:#a06a10">Pendente</span>' : esc(it.sapDocumento)}</td>
          <td>${esc(it.objetivo || '—')}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;

  const blocosInformantes = informantes.length ? informantes.map(inf => `
    <div class="declaracao">
      Eu, <strong>${esc(inf.nome)}</strong>${inf.cargo ? ` (${esc(inf.cargo)})` : ''}, DECLARO que as informações por mim prestadas relativas ao ocorrido abaixo descrito, utilizadas para a geração do Documento de Ajuste de Inventário nº <strong>${esc(dai.tag || dai.numero)}</strong>, são verídicas e correspondem fielmente aos fatos por mim observados, estando ciente das responsabilidades decorrentes da prestação de informações falsas ou inexatas.
    </div>
    <div class="assinatura-box">
      <div class="assinatura-linha"></div>
      <div class="assinatura-nome">${esc(inf.nome)}</div>
      <div class="assinatura-sub">${inf.cargo ? esc(inf.cargo) + ' — ' : ''}Assinatura do informante</div>
      <div class="assinatura-data">Data: <span class="linha-preencher">&nbsp;</span>/<span class="linha-preencher">&nbsp;</span>/<span class="linha-preencher" style="width:90px">&nbsp;</span></div>
    </div>
  `).join('<div style="height:1px;background:#e5ddc8;margin:38px 0"></div>') : '<div class="declaracao">Nenhum informante registrado neste DAI.</div>';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Termo de Responsabilidade — ${esc(dai.tag || dai.numero)}</title>
<style>
  @page { size: A4 portrait; margin: 14mm 16mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; background: #ece6d5; color: #1c1608; font-size: 12.5px; line-height: 1.5; -webkit-font-smoothing: antialiased; }

  ${_daiActionBarCss()}

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

  .declaracao { font-size: 13px; line-height: 1.85; text-align: justify; margin: 8px 0 24px; }
  .declaracao strong { color: #1c1608; }

  .desc-box { border: 1px solid #e5ddc8; border-radius: 6px; padding: 13px 15px; font-size: 12px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; margin: 6px 0 18px; color: #2a2110; }

  .itens-table { width: 100%; border-collapse: collapse; margin: 6px 0 20px; font-size: 11px; }
  .itens-table th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .05em; color: #8a7a64; padding: 6px 8px; border-bottom: 2px solid #c9a227; }
  .itens-table td { padding: 7px 8px; border-bottom: 1px solid #e5ddc8; overflow-wrap: anywhere; }
  .itens-table tr:last-child td { border-bottom: 1px solid #1c1608; }

  .assinatura-box { margin-top: 40px; text-align: center; }
  .assinatura-linha { border-top: 1px solid #1c1608; width: 320px; margin: 0 auto 8px; }
  .assinatura-nome { font-weight: 800; font-size: 13px; }
  .assinatura-sub { font-size: 10px; color: #8a7a64; margin-top: 2px; text-transform: uppercase; letter-spacing: .04em; }
  .assinatura-data { margin-top: 28px; font-size: 12px; }
  .assinatura-data .linha-preencher { display: inline-block; border-bottom: 1px solid #1c1608; width: 60px; margin: 0 3px; }

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
  <div class="action-bar-title">Termo de Responsabilidade do(s) Informante(s) <span>${esc(dai.tag || dai.numero)}</span></div>
  <div class="action-bar-btns">
    <button class="btn-print" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button>
    <button class="btn-close" onclick="window.close()">✕ Fechar</button>
  </div>
</div>

<div class="doc-wrap">
  <div class="doc-header">
    <img src="https://concrelagos.com.br/wp-content/uploads/2021/10/Ativo-3.svg" alt="Concrelagos Concreto" onerror="this.style.display='none'">
    <div class="doc-title">
      <h1>Termo de<br>Responsabilidade</h1>
      <div class="numero">Ref. ${esc(dai.tag || dai.numero)}</div>
    </div>
  </div>

  <div class="confidential-strip"><i>⚠</i> Este termo deve ser assinado por cada informante e devolvido ao analista responsável</div>

  <div class="field-grid">
    <div><div class="field-label">Central</div><div class="field-value">${esc(dai.central)}</div></div>
    <div><div class="field-label">Data do ocorrido</div><div class="field-value">${esc(dataOcorridoFmt)}</div></div>
  </div>

  ${itensHtml}

  <div class="field-label">Descrição do ocorrido</div>
  <div class="desc-box">${esc(dai.descricao)}</div>

  ${blocosInformantes}

  <div class="doc-footer">
    <span>Concrelagos Concreto · AnalyticSys</span>
    <span>DAI vinculado: ${esc(dai.tag || dai.numero)}</span>
  </div>
</div>

</body>
</html>`;
}

// ── Baixar ZIP (documento + anexos) ────────────────────────────────────
// Essa função era referenciada pelo botão "Baixar ZIP" nos cards de
// ocorrência (ver ocorrencias.js), mas nunca tinha sido implementada —
// por isso o download simplesmente não funcionava para NENHUM DAI,
// manual ou vindo do formulário público. Monta um ZIP com o documento
// (HTML) + cada anexo, buscando o arquivo de onde ele estiver disponível
// — no Supabase Storage (anexos com "path", que desde 31/07 cobre tanto o
// formulário público quanto a criação/anexo manual, ver _daiSubirAnexo)
// ou, só como fallback pra DAIs geradas ANTES dessa mudança, no
// IndexedDB local (existe apenas no navegador de quem gerou o DAI).
async function baixarZipDai(daiId) {
  const dai = (state.ajustesSistemicos || []).find(d => d.id === daiId);
  if (!dai) { toast('Documento não encontrado — pode já ter sido excluído.', 'error'); return; }
  if (typeof JSZip === 'undefined') { toast('Biblioteca de compactação não carregou — recarregue a página e tente de novo.', 'error'); return; }

  const btn = (typeof event !== 'undefined' && event?.currentTarget) ? event.currentTarget : null;
  if (typeof _setBtnLoading === 'function' && btn) _setBtnLoading(btn, true);

  try {
    const zip = new JSZip();
    zip.file(`${(dai.tag || dai.numero || 'documento').replace(/[\\/:*?"<>|]/g, '_')}.html`, _daiBuildDocumentoHtml(dai));

    const anexos = Array.isArray(dai.anexos) ? dai.anexos : [];
    let faltantes = 0;
    for (let idx = 0; idx < anexos.length; idx++) {
      const a = anexos[idx];
      let blob = null;

      // Anexos do formulário público têm "path" no Storage.
      if (a.path && window.supabaseClient) {
        try {
          const { data, error } = await window.supabaseClient.storage.from('solicitacoes-anexos').download(a.path);
          if (!error && data) blob = data;
        } catch (err) {
          console.warn('[DAI] Falha ao baixar anexo do Storage:', err);
        }
      }

      // Anexos da criação manual só existem no IndexedDB local (deste
      // navegador/dispositivo específico).
      if (!blob && typeof idbGetAnexoDai === 'function') {
        try { blob = await idbGetAnexoDai(daiId, idx); } catch { /* segue sem esse anexo */ }
      }

      if (blob) {
        const nomeSeguro = (a.nome || `anexo_${idx + 1}`).replace(/[\\/:*?"<>|]/g, '_');
        zip.file(nomeSeguro, blob);
      } else {
        faltantes++;
      }
    }

    const blobZip = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blobZip);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(dai.tag || dai.numero || 'documento').replace(/[\\/:*?"<>|]/g, '_')}.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    toast(
      faltantes > 0
        ? `ZIP gerado — ${faltantes} anexo(s) não puderam ser recuperados (só existiam localmente em outro dispositivo).`
        : `ZIP de ${dai.tag || dai.numero} gerado com sucesso.`,
      faltantes > 0 ? 'error' : 'success'
    );
  } catch (err) {
    console.error('[DAI] Falha ao gerar ZIP:', err);
    toast('Falha ao gerar o ZIP. Veja o console para detalhes.', 'error');
  } finally {
    if (typeof _setBtnLoading === 'function' && btn) _setBtnLoading(btn, false);
  }
}

Object.assign(window, {
  abrirModalDai,
  _daiAddInformanteRow,
  _daiAddItemRow,
  _daiRemoverItemRow,
  _daiFiltrarSapItemInput,
  _daiFiltrarDigitosInput,
  _daiAtualizarCnpjPreview,
  _daiGetItens,
  _daiGetInformantes,
  daiAdicionarAnexos,
  daiRemoverAnexo,
  gerarDocumentoAjuste,
  reimprimirDocumentoDai,
  editarSapDai,
  salvarSapDai,
  adicionarAnexoDaiExistente,
  gerarTermoResponsabilidade,
  formatBytes,
  baixarZipDai,
  _daiRealtimeInit,
  _daiRealtimeStop,
  _daiSyncReatribuir,
});
