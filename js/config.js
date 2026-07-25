// ── Indicador leve de carregamento (spinner de botão) ──────────────────
// Usado em ações rápidas (salvar/excluir cadastro individual), em vez do
// overlay cheio de tela (reservado para operações longas como importação
// de arquivo grande). Guarda o HTML original no dataset para restaurar
// depois, sem precisar duplicar o markup do botão em cada chamador.
function _setBtnLoading(btn, loading, loadingLabel) {
  if (!btn) return;
  if (loading) {
    if (btn.dataset.origHtml === undefined) btn.dataset.origHtml = btn.innerHTML;
    btn.innerHTML = `<span class="btn-spinner"></span> ${escapeHtml(loadingLabel || 'Processando...')}`;
    btn.disabled = true;
    btn.classList.add('is-loading');
  } else {
    if (btn.dataset.origHtml !== undefined) { btn.innerHTML = btn.dataset.origHtml; delete btn.dataset.origHtml; }
    btn.disabled = false;
    btn.classList.remove('is-loading');
  }
}

// ── Sincronização de configs com Supabase (Fase 2) ─────────────────────
// "key" é a identidade natural aqui (não o id gerado pelo banco) — por
// isso o upsert usa onConflict:'user_id,key' (restrição adicionada via
// migração). Reaproveita mergePersistentConfigs para não perder defaults
// locais que ainda não tenham sido sincronizados.
async function _configsSyncUpsert(rec) {
  const { error } = await window.supabaseClient
    .from('configs')
    .upsert(rec, { onConflict: 'user_id,key' });
  if (error) {
    console.warn('[Supabase] Falha ao sincronizar config:', error);
    toast('⚠ Salvo nesta sessão, mas não foi possível sincronizar com a nuvem.', 'error');
  }
}

async function _configsSyncDelete(key) {
  const { error } = await window.supabaseClient
    .from('configs')
    .delete()
    .eq('key', key)
    .eq('user_id', window.currentUser?.id);
  if (error) {
    console.warn('[Supabase] Falha ao excluir config na nuvem:', error);
    toast('⚠ Removida nesta sessão, mas não foi possível sincronizar com a nuvem.', 'error');
  }
}

async function syncConfigsFromSupabase() {
  try {
    const { data, error } = await window.supabaseClient
      .from('configs')
      .select('key, value, desc, created')
      .order('created', { ascending: false });
    if (error) throw error;
    state.configs = mergePersistentConfigs(state.configs, data || []);
  } catch (err) {
    console.warn('[Supabase] Falha ao buscar configs — mantendo dados locais.', err);
  }
}

// Grupos de materiais e Regionais são catálogos simples (só nome) — merge
// por nome normalizado, nuvem inclui o que faltar localmente sem duplicar.
async function syncCatalogosFromSupabase() {
  const mergeCatalogo = (localArr, remoteRows) => {
    const vistos = new Map();
    (localArr || []).forEach(n => { const k = normalizeText(n); if (k) vistos.set(k, n); });
    (remoteRows || []).forEach(r => { const k = normalizeText(r.nome); if (k && !vistos.has(k)) vistos.set(k, r.nome); });
    return [...vistos.values()];
  };
  try {
    const [gruposRes, regionaisRes] = await Promise.all([
      window.supabaseClient.from('grupos_materiais').select('nome'),
      window.supabaseClient.from('regionais_centrais').select('nome'),
    ]);
    if (gruposRes.error) throw gruposRes.error;
    if (regionaisRes.error) throw regionaisRes.error;
    state.gruposMateriais = mergeCatalogo(state.gruposMateriais, gruposRes.data);
    state.regionaisCentrais = mergeCatalogo(state.regionaisCentrais, regionaisRes.data);
  } catch (err) {
    console.warn('[Supabase] Falha ao buscar grupos/regionais — mantendo dados locais.', err);
  }
}

function salvarConfig() {
  const key = val('cfg-key');
  const value = val('cfg-val-input');
  const desc = val('cfg-desc');
  if (!key) { toast('Informe a chave', 'error'); return; }

  const existing = state.configs.findIndex(c => normalizeText(c.key) === normalizeText(key));
  const rec = { key, value, desc, created: new Date().toLocaleDateString('pt-BR') };
  if (existing >= 0) state.configs[existing] = rec; else state.configs.unshift(rec);

  persist();
  renderConfigs();
  toast('Configuração salva');
  closeModal('modal-config');
  _configsSyncUpsert(rec);
}

function removerConfig(pagedIndex) {
  const { data } = getListPageData('configs');
  const rec = data[pagedIndex];
  if (!rec) return;
  const idx = state.configs.indexOf(rec);
  if (idx < 0) return;
  state.configs.splice(idx, 1);
  persist();
  renderConfigs();
  toast('Configuração removida', 'error');
  _configsSyncDelete(rec.key);
}

function editConfig(key) {
  const item = state.configs.find(c => normalizeText(c.key) === normalizeText(key));
  if (!item) { toast('Configuração não encontrada', 'error'); return; }
  setVal('cfg-key', item.key);
  setVal('cfg-val-input', item.value);
  setVal('cfg-desc', item.desc || '');
  openModal('modal-config');
}

function deleteConfig(key) {
  const idx = state.configs.findIndex(c => normalizeText(c.key) === normalizeText(key));
  if (idx < 0) { toast('Configuração não encontrada', 'error'); return; }
  if (!confirm(`Excluir configuração "${key}"?`)) return;
  state.configs.splice(idx, 1);
  persist();
  renderConfigs();
  toast('Configuração excluída', 'error');
  _configsSyncDelete(key);
}


// ═══════════════════════════════════════════════════════════
// ATUALIZAR CADASTROS — botão em Padronização de Centrais/Materiais
// ═══════════════════════════════════════════════════════════
// Reaplica o cadastro ATUAL de Centrais e Materiais sobre os registros já
// importados/lançados (Entradas, Saídas, Lançamentos, SAP), sem precisar
// reimportar nada. Útil quando o cadastro é editado/completado DEPOIS que
// os dados já entraram no sistema — ex.: categoria adicionada a um material
// que antes estava sem, ou um alias corrigido que agora bate com nomes que
// antes ficavam sem padronização.
//
// Isso é exatamente o que já acontece automaticamente ao salvar/importar um
// novo cadastro (ver salvarMateriais/handleMateriaisImport/salvarFiliais/
// handleFiliaisImport, que chamam reaplicarPadronizacaoMateriais/Centrais
// + renderAll). Este botão expõe a mesma reaplicação sob demanda, para os
// casos em que o cadastro foi editado de outra forma e as telas antigas
// ficaram desatualizadas.
//
// Depois de reaplicar, atualiza TODAS as telas que dependem desses
// cadastros: as tabelas de Entradas/Saídas/Lançamentos/SAP/Produção e o
// Dashboard Gerencial (via renderAll), o Dashboard Analítico — Visão Micro/
// Regional (via rodarAnalitico, que já se auto-protege se não houver
// período selecionado) e o Inventário, se já tiver sido gerado na sessão.
async function atualizarCadastros() {
  const btns = document.querySelectorAll('.js-atualizar-cadastros');
  btns.forEach(b => {
    b.disabled = true;
    b.dataset.origHtml = b.dataset.origHtml || b.innerHTML;
    b.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .7s linear infinite"></i> Atualizando...';
  });

  try {
    // 1) Reaplica a padronização usando o cadastro atual de Centrais/Materiais
    //    sobre entradas/saidas/lancamentos/sap (materialOriginal/centralOriginal
    //    já salvos em cada registro são a fonte — nada é perdido nem reimportado).
    if (typeof reaplicarPadronizacaoCentrais === 'function')  reaplicarPadronizacaoCentrais();
    if (typeof reaplicarPadronizacaoMateriais === 'function') reaplicarPadronizacaoMateriais();

    // 2) Invalida todos os índices derivados — sem isso, telas com cache
    //    (Lançamentos/SAP/Saídas/busca global) continuam mostrando os
    //    valores antigos mesmo com o state já atualizado.
    if (typeof invalidateMaterialLookup === 'function')   invalidateMaterialLookup();
    if (typeof invalidateFilialLookup === 'function')     invalidateFilialLookup();
    if (typeof invalidateLancIndex === 'function')        invalidateLancIndex();
    if (typeof invalidateSapIndex === 'function')         invalidateSapIndex();
    if (typeof invalidateSaidasIndex === 'function')      invalidateSaidasIndex();
    if (typeof invalidateAllSearchIndexes === 'function') invalidateAllSearchIndexes();

    // 3) Salva o resultado.
    if (typeof persistStateNow === 'function') await persistStateNow();
    else persist();

    // 4) Tabelas/telas "de base": Entradas/Saídas/Lançamentos/SAP/Produção/
    //    Imports/Configs/Ações/Filiais/Materiais + Dashboard Gerencial —
    //    o mesmo conjunto já usado após importar um cadastro novo.
    renderAll();

    // 5) Dashboard Analítico (Visão Micro/Regional): rodarAnalitico() sem
    //    argumentos usa o período já selecionado na tela; se nenhum período
    //    foi selecionado ainda, ela mesma não faz nada (mesmo comportamento
    //    usado em ui.js após excluir/editar lançamentos).
    if (typeof rodarAnalitico === 'function') rodarAnalitico();

    // 6) Inventário: só regenera se a tela já tiver conteúdo gerado nesta
    //    sessão — evita disparar "Nenhum dado encontrado" para quem nunca
    //    abriu o Inventário. O critério espelha o usado internamente por
    //    invGerar/renderInventario (inv-content visível = já gerado).
    const invJaGerado = document.getElementById('inv-content')?.style.display === '';
    if (invJaGerado && typeof window.invGerar === 'function') window.invGerar();

    toast('Cadastros reaplicados — Entradas, Saídas, Lançamentos, SAP e demais telas foram atualizados.');
  } catch (err) {
    console.error('[AtualizarCadastros] Falha ao reaplicar cadastros:', err);
    toast('Falha ao atualizar cadastros. Veja o console para detalhes.', 'error');
  } finally {
    btns.forEach(b => {
      b.disabled = false;
      if (b.dataset.origHtml) { b.innerHTML = b.dataset.origHtml; delete b.dataset.origHtml; }
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// CADASTRO INDIVIDUAL DE MATERIAIS — campos digitados, múltiplas linhas
// ═══════════════════════════════════════════════════════════════════════
let _matIndivRowSeq = 0;

// Abre o modal de Cadastro Individual de Materiais. Aceita um objeto de
// pré-preenchimento opcional — { origem, alias, categoria, focus } — usado
// pelos atalhos de "material sem cadastro/categoria" espalhados pelo
// sistema (Dashboard, Analítico, Inventário, duplicidade de cadastro).
function abrirCadastroMaterialIndividual(prefill) {
  const container = document.getElementById('mat-indiv-rows');
  if (!container) return;
  container.innerHTML = '';
  _matIndivRowSeq = 0;
  _addMaterialIndivRow();
  openModal('modal-materiais-individual');

  const row = container.querySelector('.reg-individual-row');
  if (prefill && row) {
    const origemInput = row.querySelector('[data-field="origem"]');
    const aliasInput = row.querySelector('[data-field="alias"]');
    const categoriaSelect = row.querySelector('[data-field="categoria"]');
    if (origemInput) origemInput.value = prefill.origem || '';
    if (aliasInput) aliasInput.value = prefill.alias || '';
    if (categoriaSelect && prefill.categoria) categoriaSelect.value = prefill.categoria;
  }

  setTimeout(() => {
    const focusField = prefill?.focus || 'origem';
    (row?.querySelector(`[data-field="${focusField}"]`) || container.querySelector('input'))?.focus();
  }, 50);
}

// ═══════════════════════════════════════════════════════════════════════
// CATÁLOGO DE GRUPOS SAP — usado no dropdown "Grupo SAP" do cadastro de
// Materiais. Combina os grupos cadastrados manualmente (state.gruposMateriais,
// persistente — ver defaultState em state.js) com os grupos já em uso em
// state.materiais, para que a lista sempre reflita "todos os grupos já
// cadastrados" mesmo antes desta funcionalidade existir.
// ═══════════════════════════════════════════════════════════════════════

// Garante que um nome de grupo esteja no catálogo persistente. Chamado
// sempre que um material é salvo (upsertMateriais) e ao cadastrar um grupo
// novo "avulso" pelo botão "+" — idempotente, não duplica (comparação
// insensível a maiúsculas/acentos via normalizeText).
function registrarGrupoMaterial(nome) {
  const grupo = String(nome || '').trim();
  if (!grupo) return;
  if (!Array.isArray(state.gruposMateriais)) state.gruposMateriais = [];
  const key = normalizeText(grupo);
  const jaExiste = state.gruposMateriais.some(g => normalizeText(g) === key);
  if (!jaExiste) {
    state.gruposMateriais.push(grupo);
    if (window.supabaseClient) {
      window.supabaseClient.from('grupos_materiais').upsert({ nome: grupo }, { onConflict: 'user_id,nome' })
        .then(({ error }) => { if (error) console.warn('[Supabase] Falha ao sincronizar grupo de material:', error); });
    }
  }
}

// Lista ordenada e sem duplicatas de todos os grupos disponíveis para o
// dropdown: catálogo persistente + grupos em uso nos materiais cadastrados.
function getGruposMateriaisDisponiveis() {
  const vistos = new Map(); // normalizado -> primeira grafia encontrada
  const add = nome => {
    const grupo = String(nome || '').trim();
    if (!grupo) return;
    const key = normalizeText(grupo);
    if (!vistos.has(key)) vistos.set(key, grupo);
  };
  (state.gruposMateriais || []).forEach(add);
  (state.materiais || []).forEach(m => add(m?.alias));
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

// Reconstrói as <option> de um <select> de Grupo SAP preservando o valor
// selecionado (ou aplicando um novo valor, se informado).
function _rebuildGrupoMateriaisOptions(selectEl, novoValor) {
  if (!selectEl) return;
  const valorAtual = novoValor !== undefined ? novoValor : selectEl.value;
  const options = getGruposMateriaisDisponiveis()
    .map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
  selectEl.innerHTML = `<option value="">—</option>${options}`;
  selectEl.value = valorAtual;
}

// Atualiza todos os dropdowns de Grupo SAP abertos no modal (pode haver
// várias linhas simultâneas, via "+ Adicionar linha").
function _refreshGrupoMateriaisSelects() {
  document.querySelectorAll('#mat-indiv-rows [data-field="alias"]').forEach(sel => _rebuildGrupoMateriaisOptions(sel));
}

// ── Mini modal "Novo Grupo SAP" ─────────────────────────────────────────
let _novoGrupoMaterialTarget = null; // <select> da linha que abriu o mini modal

function abrirNovoGrupoMaterial(btn) {
  const row = btn.closest('.reg-individual-row');
  _novoGrupoMaterialTarget = row?.querySelector('[data-field="alias"]') || null;
  setVal('novo-grupo-material-nome', '');
  openModal('modal-novo-grupo-material');
  setTimeout(() => document.getElementById('novo-grupo-material-nome')?.focus(), 50);
}

async function salvarNovoGrupoMaterial(btn) {
  const nomeDigitado = val('novo-grupo-material-nome').trim();
  if (!nomeDigitado) { toast('Informe o nome do grupo', 'error'); return; }

  const key = normalizeText(nomeDigitado);
  const existente = getGruposMateriaisDisponiveis().find(g => normalizeText(g) === key);
  const nomeFinal = existente || nomeDigitado;

  _setBtnLoading(btn, true, 'Salvando...');
  if (!existente) {
    registrarGrupoMaterial(nomeDigitado);
    await persistStateNow();
  }
  _refreshGrupoMateriaisSelects();
  if (_novoGrupoMaterialTarget) _novoGrupoMaterialTarget.value = nomeFinal;
  _novoGrupoMaterialTarget = null;
  _setBtnLoading(btn, false);
  closeModal('modal-novo-grupo-material');
  toast(existente ? `Grupo "${nomeFinal}" já existia — selecionado` : `Grupo "${nomeFinal}" cadastrado`);
}

function _addMaterialIndivRow() {
  const container = document.getElementById('mat-indiv-rows');
  if (!container) return;
  const id = _matIndivRowSeq++;
  const catOptions = (typeof CATEGORIAS_MATERIAL !== 'undefined' ? CATEGORIAS_MATERIAL : [])
    .map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  const grupoOptions = getGruposMateriaisDisponiveis()
    .map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
  const row = document.createElement('div');
  row.className = 'reg-individual-row reg-row-materiais';
  row.dataset.rowId = id;
  row.innerHTML = `
    <div class="form-group">
      <label class="form-label">Original</label>
      <input type="text" class="form-input" data-field="origem" placeholder="Nome bruto (como vem na importação)">
    </div>
    <div class="form-group">
      <label class="form-label">Grupo SAP</label>
      <div style="display:flex; gap:6px">
        <select class="form-select" data-field="alias" style="flex:1; min-width:0">
          <option value="">—</option>
          ${grupoOptions}
        </select>
        <button type="button" class="btn" title="Cadastrar novo Grupo SAP" onclick="abrirNovoGrupoMaterial(this)" style="flex:0 0 auto; padding:0 12px"><i class="ti ti-plus"></i></button>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Categoria</label>
      <select class="form-select" data-field="categoria">
        <option value="">—</option>
        ${catOptions}
      </select>
    </div>
    <div class="reg-row-remove" title="Remover esta linha" onclick="_removeIndivRow(this)"><i class="ti ti-x"></i></div>
  `;
  container.appendChild(row);
}

// Compartilhado entre Materiais e Filiais — remove a linha clicada, mas
// mantém sempre pelo menos 1 linha visível no formulário (limpa em vez de
// remover, se for a última).
function _removeIndivRow(el) {
  const row = el.closest('.reg-individual-row');
  if (!row) return;
  const container = row.parentElement;
  if (container.children.length <= 1) {
    row.querySelectorAll('input, select').forEach(i => { i.value = ''; });
    return;
  }
  row.remove();
}

async function salvarMateriaisIndividual(btn) {
  const container = document.getElementById('mat-indiv-rows');
  if (!container) return;
  const rows = [...container.querySelectorAll('.reg-individual-row')];
  const imported = [];
  rows.forEach(row => {
    const origem = row.querySelector('[data-field="origem"]')?.value.trim() || '';
    const alias  = row.querySelector('[data-field="alias"]')?.value.trim()  || '';
    const categoriaRaw = row.querySelector('[data-field="categoria"]')?.value.trim() || '';
    if (!origem || !alias) return; // linha em branco ou incompleta — ignora silenciosamente
    imported.push({
      origem, alias,
      categoria: normalizeCategoriaMaterial(categoriaRaw),
      created: new Date().toLocaleDateString('pt-BR')
    });
  });

  if (!imported.length) { toast('Preencha ao menos um cadastro completo (Original + Grupo SAP)', 'error'); return; }

  _setBtnLoading(btn, true, 'Cadastrando...');
  upsertMateriais(imported);
  listPages.materiais = 0;
  closeModal('modal-materiais-individual');
  _setBtnLoading(btn, false);
  reaplicarPadronizacaoMateriais();
  await persistStateNow();
  renderAll();
  updateImportPrereqUI();
  toast(`${imported.length} material(is) cadastrado(s)`);
}

function materialMatchKey(item) {
  return [
    normalizeText(item?.origem),
    normalizeText(item?.alias)
  ].join('||');
}

function makeMaterialId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return 'mat_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

function normalizeImportedMaterial(item, importId) {
  const src = item && typeof item === 'object' ? item : {};
  return {
    id: src.id || makeMaterialId(),
    origem: String(src.origem || '').trim(),
    alias: String(src.alias || '').trim(),
    categoria: normalizeCategoriaMaterial(src.categoria),
    created: src.created || new Date().toLocaleDateString('pt-BR'),
    importId
  };
}

function normalizeImportedFilial(item, importId) {
  const src = item && typeof item === 'object' ? item : {};
  return {
    origem: String(src.origem || '').trim(),
    alias: String(src.alias || '').trim(),
    cnpj: String(src.cnpj || '').trim(),
    regional: String(src.regional || '').trim(),
    created: src.created || new Date().toLocaleDateString('pt-BR'),
    importId
  };
}

function upsertMateriais(items) {
  (items || []).forEach(item => {
    const src = item && typeof item === 'object' ? item : {};
    const rec = {
      id: src.id || makeMaterialId(),
      ...src,
      created: src.created || new Date().toLocaleDateString('pt-BR')
    };

    const key = materialMatchKey(rec);
    const idx = state.materiais.findIndex(f => materialMatchKey(f) === key);
    if (idx >= 0) state.materiais[idx] = { ...state.materiais[idx], ...rec };
    else state.materiais.unshift(rec);
    // Mantém o catálogo de Grupos SAP em sincronia — cobre tanto o cadastro
    // guiado quanto a importação por arquivo (handleMateriaisImport), já
    // que ambos passam por aqui.
    registrarGrupoMaterial(rec.alias);
  });
  invalidateMaterialLookup();
}

function parseMateriaisRows(rows) {
  const cleaned = (rows || []).filter(row => Array.isArray(row) && row.some(c => c !== '' && c !== null && c !== undefined));
  if (!cleaned.length) return [];

  const norm = v => normalizeText(v);
  const header = cleaned[0].map(norm);

  const findIdx = (...names) => {
    for (const name of names) {
      const idx = header.findIndex(h => h === norm(name));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const headerLooksLikeMeta = header.some(h => [
    'ORIGEM', 'ORIGINAL', 'MATERIAL', 'MATERIAL ORIGINAL', 'GRUPO', 'GRUPO SAP', 'SAP', 'CATEGORIA', 'DESCRICAO', 'DESCRIÇÃO'
  ].includes(h));

  let startRow = 0;
  let origemIdx = 0;
  let aliasIdx = 1;
  let categoriaIdx = -1;

  if (headerLooksLikeMeta) {
    startRow = 1;
    origemIdx = findIdx('origem', 'original', 'material', 'material original', 'nome');
    aliasIdx = findIdx('grupo', 'grupo sap', 'sap', 'padronizada', 'padronizado', 'padronizacao', 'padronização');
    // "Descrição"/"Observação" entram como aliases de Categoria: essa era a
    // convenção usada para anotar a categoria antes de existir uma coluna
    // dedicada, e o cadastro de Materiais não tem mais um campo de descrição.
    categoriaIdx = findIdx('categoria', 'categoria material', 'category', 'cat', 'cat.', 'descricao', 'descrição', 'descricao do material', 'observacao', 'observação');
    if (origemIdx < 0) origemIdx = 0;
    if (aliasIdx < 0) aliasIdx = 1;
  }
  // Sem cabeçalho reconhecido, não há como adivinhar com segurança em qual
  // coluna posicional estaria a categoria — fica de fora nesse caso (o
  // analista pode completar depois pelo cadastro manual ou reimportar com
  // um cabeçalho "CATEGORIA" explícito).

  return cleaned.slice(startRow).map(row => ({
    origem: String(row[origemIdx] || '').trim(),
    alias: String(row[aliasIdx] || '').trim(),
    categoria: categoriaIdx >= 0 ? normalizeCategoriaMaterial(row[categoriaIdx]) : '',
    created: new Date().toLocaleDateString('pt-BR')
  })).filter(r => r.origem && r.alias);
}

async function handleMateriaisImport(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (typeof XLSX === 'undefined') {
    toast('Biblioteca XLSX não carregada.', 'error');
    return;
  }

  showLoadingOverlay('Importando materiais', 'Lendo o arquivo de materiais...');
  if (typeof loadingShowSteps === 'function') loadingShowSteps([
    { id: 'mat-read',  icon: 'ti-file-spreadsheet', label: 'Lendo o arquivo' },
    { id: 'mat-parse', icon: 'ti-transform',         label: 'Processando cadastros' },
    { id: 'mat-norm',  icon: 'ti-adjustments',       label: 'Padronizando materiais' },
    { id: 'mat-save',  icon: 'ti-device-floppy',     label: 'Salvando no banco local' },
  ]);

  const fileName = file.name.toLowerCase();
  const reader = new FileReader();

  reader.onload = async function(e) {
    try {
      _lstepSet('mat-read', 'running'); _lbarSet(10);
      updateLoadingOverlay('Separando os registros de materiais...', 'Importando materiais');
      let rows = [];

      if (fileName.endsWith('.csv')) {
        const wb = XLSX.read(String(e.target.result || ''), { type: 'string', raw: true });
        const ws = sanitizeWorksheet(wb.Sheets[wb.SheetNames[0]]);
        rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      } else {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: false });
        const ws = sanitizeWorksheet(wb.Sheets[wb.SheetNames[0]]);
        rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      }

      _lstepSet('mat-read', 'done'); _lstepSet('mat-parse', 'running'); _lbarSet(35);
      const items = parseMateriaisRows(rows);

      if (!items.length) {
        toast('Arquivo sem cadastros válidos', 'error');
        hideLoadingOverlay('Falha');
        if (typeof loadingHideSteps === 'function') loadingHideSteps();
        return;
      }

      const importId = `cad_materiais_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

      _lstepSet('mat-parse', 'done'); _lstepSet('mat-norm', 'running'); _lbarSet(60);
      updateLoadingOverlay('Atualizando cadastros salvos...', 'Importando materiais');
      upsertMateriais(items.map(item => normalizeImportedMaterial(item, importId)));
      state.imports.unshift({
        id: importId, arquivo: file.name, modulo: 'Materiais',
        registros: items.length, dataHora: new Date().toLocaleString('pt-BR'),
        status: 'Importado', createdAt: Date.now()
      });
      listPages.materiais = 0;
      reaplicarPadronizacaoMateriais();
      _lstepSet('mat-norm', 'done'); _lstepSet('mat-save', 'running'); _lbarSet(85);
      await persistStateNow();
      _lstepSet('mat-save', 'done'); _lbarSet(100);
      renderAll();
      updateImportPrereqUI();
      closeModal('modal-materiais-individual');
      hideLoadingOverlay('Materiais importados');
      if (typeof loadingHideSteps === 'function') loadingHideSteps();
      toast(`${items.length} material(is) importado(s)`);
      event.target.value = '';
    } catch (err) {
      console.error(err);
      toast('Falha ao importar materiais', 'error');
    } finally {
      hideLoadingOverlay('Importação concluída');
    }
  };

  reader.onerror = () => {
    toast('Não foi possível ler o arquivo selecionado', 'error');
    hideLoadingOverlay('Falha na importação');
  };

  if (fileName.endsWith('.csv')) reader.readAsText(file, 'utf-8');
  else reader.readAsArrayBuffer(file);
}

function focusMaterialImport() {
  document.getElementById('file-materiais')?.click();
}

async function removerMaterial(id, btn) {
  const idx = state.materiais.findIndex(m => m.id === id);
  if (idx < 0) {
    toast('Material não encontrado', 'error');
    return;
  }
  const rec = state.materiais[idx];

  confirmarDestrutivo({
    title: 'Excluir cadastro de material',
    sub: rec.origem,
    body: `
      <div style="display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;gap:8px;align-items:center">
          <span style="color:var(--text3);min-width:80px;font-size:12px">Original</span>
          <strong>${escapeHtml(rec.origem)}</strong>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span style="color:var(--text3);min-width:80px;font-size:12px">Grupo SAP</span>
          <span>${escapeHtml(rec.alias)}</span>
        </div>
        <div style="margin-top:8px;padding:10px 12px;background:var(--red-bg);border:1px solid var(--red-border);border-radius:6px;font-size:12px;color:var(--red)">
          <i class="ti ti-alert-triangle"></i>
          Registros já importados que usam este nome original deixarão de ser padronizados e passarão a aparecer como "sem cadastro" até serem recadastrados.
        </div>
      </div>`,
    confirmLabel: 'Excluir material',
    onConfirm: async () => {
      _setBtnLoading(btn, true);
      const curIdx = state.materiais.findIndex(m => m.id === id);
      if (curIdx < 0) { _setBtnLoading(btn, false); return; }
      state.materiais.splice(curIdx, 1);
      invalidateMaterialLookup();
      reaplicarPadronizacaoMateriais();
      await persistStateNow();
      renderAll();
      updateImportPrereqUI();
      toast('Material removido');
      // Não precisa _setBtnLoading(false) aqui — o botão em si some do DOM
      // no próximo renderAll()/renderMateriais(), que redesenha a tabela.
    }
  });
}

async function limparMateriais() {
  if (!state.materiais.length) return toast('Nenhum material cadastrado', 'error');
  if (!confirm('Excluir todos os materiais cadastrados?')) return;
  state.materiais = [];
  invalidateMaterialLookup();
  reaplicarPadronizacaoMateriais();
  await persistStateNow();
  renderAll();
  updateImportPrereqUI();
  toast('Todos os materiais foram excluídos', 'error');
}

// Exporta a Padronização de Materiais para uma planilha Excel (.xlsx),
// somente com as colunas usadas na reimportação (ver parseMateriaisRows) —
// "Criado em" e campos internos (id/importId) ficam de fora de propósito,
// já que são regenerados automaticamente ao reimportar.
function exportarMateriaisExcel() {
  if (!state.materiais.length) { toast('Nenhum material cadastrado para exportar', 'error'); return; }
  if (typeof XLSX === 'undefined') { toast('Biblioteca XLSX não carregada.', 'error'); return; }

  const rows = state.materiais.map(m => ({
    'Origem': m.origem || '',
    'Grupo SAP': m.alias || '',
    'Categoria': m.categoria || ''
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Materiais');
  XLSX.writeFile(wb, `padronizacao_materiais_${new Date().toISOString().slice(0, 10)}.xlsx`);
  toast(`${rows.length} material(is) exportado(s)`);
}


// ═══════════════════════════════════════════════════════════════════════
// CADASTRO INDIVIDUAL DE CENTRAIS — campos digitados, múltiplas linhas
// ═══════════════════════════════════════════════════════════════════════
let _filIndivRowSeq = 0;

// Abre o modal de Cadastro Individual de Centrais. Aceita um objeto de
// pré-preenchimento opcional — { origem, alias, cnpj, regional, focus } —
// usado pelo atalho de "central sem cadastro" no painel de pendências de
// padronização (Dashboard).
function abrirCadastroFilialIndividual(prefill) {
  const container = document.getElementById('filial-indiv-rows');
  if (!container) return;
  container.innerHTML = '';
  _filIndivRowSeq = 0;
  _addFilialIndivRow();
  openModal('modal-filiais-individual');

  const row = container.querySelector('.reg-individual-row');
  if (prefill && row) {
    const origemInput   = row.querySelector('[data-field="origem"]');
    const aliasInput    = row.querySelector('[data-field="alias"]');
    const cnpjInput     = row.querySelector('[data-field="cnpj"]');
    const regionalInput = row.querySelector('[data-field="regional"]');
    if (origemInput)   origemInput.value   = prefill.origem   || '';
    if (aliasInput)    aliasInput.value    = prefill.alias    || '';
    if (cnpjInput)     cnpjInput.value     = prefill.cnpj     || '';
    if (regionalInput) regionalInput.value = prefill.regional || '';
  }

  setTimeout(() => {
    const focusField = prefill?.focus || 'origem';
    (row?.querySelector(`[data-field="${focusField}"]`) || container.querySelector('input'))?.focus();
  }, 50);
}

// ═══════════════════════════════════════════════════════════════════════
// CATÁLOGO DE REGIONAIS — usado no dropdown "Regional" do cadastro de
// Centrais. Mesmo padrão do catálogo de Grupos SAP (ver acima): combina os
// regionais cadastrados manualmente (state.regionaisCentrais, persistente)
// com os regionais já em uso em state.filiais.
// ═══════════════════════════════════════════════════════════════════════

function registrarRegionalCentral(nome) {
  const regional = String(nome || '').trim();
  if (!regional) return;
  if (!Array.isArray(state.regionaisCentrais)) state.regionaisCentrais = [];
  const key = normalizeText(regional);
  const jaExiste = state.regionaisCentrais.some(r => normalizeText(r) === key);
  if (!jaExiste) {
    state.regionaisCentrais.push(regional);
    if (window.supabaseClient) {
      window.supabaseClient.from('regionais_centrais').upsert({ nome: regional }, { onConflict: 'user_id,nome' })
        .then(({ error }) => { if (error) console.warn('[Supabase] Falha ao sincronizar regional:', error); });
    }
  }
}

function getRegionaisCentraisDisponiveis() {
  const vistos = new Map();
  const add = nome => {
    const regional = String(nome || '').trim();
    if (!regional) return;
    const key = normalizeText(regional);
    if (!vistos.has(key)) vistos.set(key, regional);
  };
  (state.regionaisCentrais || []).forEach(add);
  (state.filiais || []).forEach(f => add(f?.regional));
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function _rebuildRegionaisCentraisOptions(selectEl, novoValor) {
  if (!selectEl) return;
  const valorAtual = novoValor !== undefined ? novoValor : selectEl.value;
  const options = getRegionaisCentraisDisponiveis()
    .map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');
  selectEl.innerHTML = `<option value="">—</option>${options}`;
  selectEl.value = valorAtual;
}

function _refreshRegionaisCentraisSelects() {
  document.querySelectorAll('#filial-indiv-rows [data-field="regional"]').forEach(sel => _rebuildRegionaisCentraisOptions(sel));
}

// ── Mini modal "Novo Regional" ──────────────────────────────────────────
let _novoRegionalCentralTarget = null; // <select> da linha que abriu o mini modal

function abrirNovoRegionalCentral(btn) {
  const row = btn.closest('.reg-individual-row');
  _novoRegionalCentralTarget = row?.querySelector('[data-field="regional"]') || null;
  setVal('novo-regional-central-nome', '');
  openModal('modal-novo-regional-central');
  setTimeout(() => document.getElementById('novo-regional-central-nome')?.focus(), 50);
}

async function salvarNovoRegionalCentral(btn) {
  const nomeDigitado = val('novo-regional-central-nome').trim();
  if (!nomeDigitado) { toast('Informe o nome do regional', 'error'); return; }

  const key = normalizeText(nomeDigitado);
  const existente = getRegionaisCentraisDisponiveis().find(r => normalizeText(r) === key);
  const nomeFinal = existente || nomeDigitado;

  _setBtnLoading(btn, true, 'Salvando...');
  if (!existente) {
    registrarRegionalCentral(nomeDigitado);
    await persistStateNow();
  }
  _refreshRegionaisCentraisSelects();
  if (_novoRegionalCentralTarget) _novoRegionalCentralTarget.value = nomeFinal;
  _novoRegionalCentralTarget = null;
  _setBtnLoading(btn, false);
  closeModal('modal-novo-regional-central');
  toast(existente ? `Regional "${nomeFinal}" já existia — selecionado` : `Regional "${nomeFinal}" cadastrado`);
}

function _addFilialIndivRow() {
  const container = document.getElementById('filial-indiv-rows');
  if (!container) return;
  const id = _filIndivRowSeq++;
  const regionalOptions = getRegionaisCentraisDisponiveis()
    .map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');
  const row = document.createElement('div');
  row.className = 'reg-individual-row reg-row-filiais';
  row.dataset.rowId = id;
  row.innerHTML = `
    <div class="form-group">
      <label class="form-label">Original</label>
      <input type="text" class="form-input" data-field="origem" placeholder="Nome bruto (como vem na importação)">
    </div>
    <div class="form-group">
      <label class="form-label">Sigla</label>
      <input type="text" class="form-input" data-field="alias" placeholder="SET1">
    </div>
    <div class="form-group">
      <label class="form-label">CNPJ</label>
      <input type="text" class="form-input" data-field="cnpj" placeholder="00.000.000/0000-00">
    </div>
    <div class="form-group">
      <label class="form-label">Regional</label>
      <div style="display:flex; gap:6px">
        <select class="form-select" data-field="regional" style="flex:1; min-width:0">
          <option value="">—</option>
          ${regionalOptions}
        </select>
        <button type="button" class="btn" title="Cadastrar novo Regional" onclick="abrirNovoRegionalCentral(this)" style="flex:0 0 auto; padding:0 12px"><i class="ti ti-plus"></i></button>
      </div>
    </div>
    <div class="reg-row-remove" title="Remover esta linha" onclick="_removeIndivRow(this)"><i class="ti ti-x"></i></div>
  `;
  container.appendChild(row);
}

async function salvarFiliaisIndividual(btn) {
  const container = document.getElementById('filial-indiv-rows');
  if (!container) return;
  const rows = [...container.querySelectorAll('.reg-individual-row')];
  const imported = [];
  rows.forEach(row => {
    const origem   = row.querySelector('[data-field="origem"]')?.value.trim()   || '';
    const alias    = row.querySelector('[data-field="alias"]')?.value.trim()    || '';
    const cnpj     = row.querySelector('[data-field="cnpj"]')?.value.trim()     || '';
    const regional = row.querySelector('[data-field="regional"]')?.value.trim() || '';
    if (!origem || !alias) return; // linha em branco ou incompleta — ignora silenciosamente
    imported.push({ origem, alias, cnpj, regional, created: new Date().toLocaleDateString('pt-BR') });
  });

  if (!imported.length) { toast('Preencha ao menos um cadastro completo (Original + Sigla)', 'error'); return; }

  _setBtnLoading(btn, true, 'Cadastrando...');
  upsertFiliais(imported);
  closeModal('modal-filiais-individual');
  _setBtnLoading(btn, false);
  reaplicarPadronizacaoCentrais();
  await persistStateNow();
  renderAll();
  updateImportPrereqUI();
  toast(`${imported.length} filial(is) cadastrada(s)`);
}

function upsertFiliais(items) {
  (items || []).forEach(item => {
    const src = item && typeof item === 'object' ? item : {};
    const key = normalizeText(src.origem);
    const aliasKey = normalizeText(src.alias);
    const idx = state.filiais.findIndex(f => normalizeText(f.origem) === key || normalizeText(f.alias) === aliasKey);
    const rec = {
      ...src,
      created: src.created || new Date().toLocaleDateString('pt-BR')
    };
    if (idx >= 0) state.filiais[idx] = rec; else state.filiais.unshift(rec);
    // Mantém o catálogo de Regionais em sincronia — cobre tanto o cadastro
    // guiado quanto a importação por arquivo (handleFiliaisImport).
    registrarRegionalCentral(rec.regional);
  });
  invalidateFilialLookup();
}

function parseFiliaisRows(rows) {
  const cleaned = (rows || []).filter(row => Array.isArray(row) && row.some(c => c !== '' && c !== null && c !== undefined));
  if (!cleaned.length) return [];

  const norm = v => normalizeText(v);
  const header = cleaned[0].map(norm);

  const findIdx = (...names) => {
    for (const name of names) {
      const idx = header.findIndex(h => h === norm(name));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const headerLooksLikeMeta = header.some(h => [
    'ORIGEM', 'ORIGINAL', 'ALIAS', 'SIGLA', 'DESCRICAO', 'DESCRIÇÃO', 'FILIAL', 'CENTRAL', 'CNPJ', 'REGIONAL'
  ].includes(h));

  let startRow = 0;
  let origemIdx = 0;
  let aliasIdx = 1;
  let cnpjIdx = 2;
  let regionalIdx = 3;

  if (headerLooksLikeMeta) {
    startRow = 1;
    origemIdx   = findIdx('origem', 'original', 'central', 'filial', 'central origem', 'central original');
    aliasIdx    = findIdx('alias', 'sigla', 'padronizada', 'central padrão', 'central padrao');
    cnpjIdx     = findIdx('cnpj', 'cpf cnpj', 'documento');
    regionalIdx = findIdx('regional', 'regiao', 'região', 'responsavel', 'responsável', 'gestor');
    if (origemIdx < 0) origemIdx = 0;
    if (aliasIdx < 0) aliasIdx = 1;
    if (cnpjIdx < 0) cnpjIdx = 2;
    if (regionalIdx < 0) regionalIdx = 3;
  }

  return cleaned.slice(startRow).map(row => ({
    origem:   String(row[origemIdx]   || '').trim(),
    alias:    String(row[aliasIdx]    || '').trim(),
    cnpj:     String(row[cnpjIdx]     || '').trim(),
    regional: String(row[regionalIdx] || '').trim(),
    created: new Date().toLocaleDateString('pt-BR')
  })).filter(r => r.origem && r.alias);
}

async function handleFiliaisImport(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (typeof XLSX === 'undefined') {
    toast('Biblioteca XLSX não carregada.', 'error');
    return;
  }

  showLoadingOverlay('Importando centrais', 'Lendo o arquivo de filiais...');
  if (typeof loadingShowSteps === 'function') loadingShowSteps([
    { id: 'fil-read',  icon: 'ti-file-spreadsheet', label: 'Lendo o arquivo' },
    { id: 'fil-parse', icon: 'ti-transform',         label: 'Processando cadastros' },
    { id: 'fil-save',  icon: 'ti-device-floppy',     label: 'Salvando no banco local' },
  ]);

  const fileName = file.name.toLowerCase();
  const reader = new FileReader();

  reader.onload = async function(e) {
    try {
      _lstepSet('fil-read', 'running'); _lbarSet(15);
      updateLoadingOverlay('Separando os registros de centrais...', 'Importando centrais');
      let rows = [];

      if (fileName.endsWith('.csv')) {
        const wb = XLSX.read(String(e.target.result || ''), { type: 'string', raw: true });
        const ws = sanitizeWorksheet(wb.Sheets[wb.SheetNames[0]]);
        rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      } else {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: false });
        const ws = sanitizeWorksheet(wb.Sheets[wb.SheetNames[0]]);
        rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      }

      _lstepSet('fil-read', 'done'); _lstepSet('fil-parse', 'running'); _lbarSet(45);
      const items = parseFiliaisRows(rows);

      if (!items.length) {
        toast('Arquivo sem cadastros válidos', 'error');
        hideLoadingOverlay('Falha');
        if (typeof loadingHideSteps === 'function') loadingHideSteps();
        return;
      }

      const importId = `cad_centrais_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

      _lstepSet('fil-parse', 'done'); _lstepSet('fil-save', 'running'); _lbarSet(75);
      updateLoadingOverlay('Atualizando cadastros salvos...', 'Importando centrais');
      upsertFiliais(items.map(item => normalizeImportedFilial(item, importId)));
      state.imports.unshift({
        id: importId, arquivo: file.name, modulo: 'Centrais',
        registros: items.length, dataHora: new Date().toLocaleString('pt-BR'),
        status: 'Importado', createdAt: Date.now()
      });
      reaplicarPadronizacaoCentrais();
      await persistStateNow();
      _lstepSet('fil-save', 'done'); _lbarSet(100);
      renderAll();
      closeModal('modal-filiais-individual');
      hideLoadingOverlay('Centrais importadas');
      if (typeof loadingHideSteps === 'function') loadingHideSteps();
      toast(`${items.length} filial(is) importada(s)`);
      event.target.value = '';
    } catch (err) {
      console.error(err);
      toast('Falha ao importar filiais', 'error');
    } finally {
      if (typeof loadingHideSteps === 'function') loadingHideSteps();
      hideLoadingOverlay('Importação concluída');
    }
  };

  reader.onerror = () => {
    toast('Não foi possível ler o arquivo selecionado', 'error');
    hideLoadingOverlay('Falha na importação');
  };

  if (fileName.endsWith('.csv')) reader.readAsText(file, 'utf-8');
  else reader.readAsArrayBuffer(file);
}

function focusFilialImport() {
  document.getElementById('file-filiais')?.click();
}

async function removerFilial(pagedIndex) {
  const { data } = getListPageData('filiais');
  const rec = data[pagedIndex];
  if (!rec) return;
  const idx = state.filiais.indexOf(rec);
  if (idx < 0) return;

  if (!confirm(`Excluir a central "${rec.origem}"?`)) return;

  const snapshot = { ...rec };
  const originalIndex = idx;

  confirmarComUndo({
    message: `Central "${rec.origem}" excluída`,
    action: () => {
      const curIdx = state.filiais.indexOf(rec);
      if (curIdx >= 0) state.filiais.splice(curIdx, 1);
      invalidateFilialLookup();
      reaplicarPadronizacaoCentrais();
      persist();
      renderAll();
      updateImportPrereqUI();
    },
    undo: () => {
      const insertAt = originalIndex >= 0 && originalIndex <= state.filiais.length
        ? originalIndex
        : 0;
      state.filiais.splice(insertAt, 0, snapshot);
      invalidateFilialLookup();
      reaplicarPadronizacaoCentrais();
      persist();
      renderAll();
      updateImportPrereqUI();
    },
  });
}

async function limparFiliais() {
  if (!state.filiais.length) return toast('Nenhuma filial cadastrada', 'error');
  if (!confirm('Excluir todas as filiais cadastradas?')) return;
  state.filiais = [];
  invalidateFilialLookup();
  reaplicarPadronizacaoCentrais();
  await persistStateNow();
  renderAll();
  updateImportPrereqUI();
  toast('Todas as filiais foram excluídas', 'error');
}

// Exporta a Padronização de Centrais para uma planilha Excel (.xlsx),
// somente com as colunas usadas na reimportação (ver parseFiliaisRows) —
// "Criado em" e campos internos (importId) ficam de fora de propósito, já
// que são regenerados automaticamente ao reimportar.
function exportarFiliaisExcel() {
  if (!state.filiais.length) { toast('Nenhuma central cadastrada para exportar', 'error'); return; }
  if (typeof XLSX === 'undefined') { toast('Biblioteca XLSX não carregada.', 'error'); return; }

  const rows = state.filiais.map(f => ({
    'Origem': f.origem || '',
    'Sigla': f.alias || '',
    'CNPJ': f.cnpj || '',
    'Regional': f.regional || ''
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Centrais');
  XLSX.writeFile(wb, `padronizacao_centrais_${new Date().toISOString().slice(0, 10)}.xlsx`);
  toast(`${rows.length} central(is) exportada(s)`);
}

// ═══════════════════════════════════════════════════════════
// AÇÕES DE RELATÓRIO — regras para o Relatório com Ações
// ═══════════════════════════════════════════════════════════

function makeAcaoId() {
  return 'AR-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

// Busca as ações de relatório do Supabase e substitui state.acoesRelatorio —
// chamada no boot (ver restoreAndRender em dashboard.js, dentro do STEP 1).
// Em caso de falha de rede, mantém o que já foi carregado do IndexedDB local
// como fallback, em vez de zerar a lista.
async function syncAcoesRelatorioFromSupabase() {
  try {
    const { data, error } = await window.supabaseClient
      .from('acoes_relatorio')
      .select('id, user_id, categorias, nivel, acoes, created')
      .order('created', { ascending: false });
    if (error) throw error;
    state.acoesRelatorio = data || [];
  } catch (err) {
    console.warn('[Supabase] Falha ao buscar acoesRelatorio — mantendo dados locais.', err);
  }
}

function abrirModalAcaoRelatorio(id) {
  const item = id ? (state.acoesRelatorio || []).find(a => a.id === id) : null;

  let modal = document.getElementById('modal-acoes-relatorio');
  if (!modal) return;

  // Reseta checkboxes
  modal.querySelectorAll('.ar-cat-cb').forEach(cb => { cb.checked = false; });

  // Preenche campos se for edição
  document.getElementById('ar-id').value    = item?.id || '';
  document.getElementById('ar-nivel').value = item?.nivel || '';
  document.getElementById('ar-acoes').value = item?.acoes || '';

  // Marca categorias salvas
  if (item?.categorias && Array.isArray(item.categorias)) {
    item.categorias.forEach(cat => {
      const cb = modal.querySelector(`.ar-cat-cb[value="${cat}"]`);
      if (cb) cb.checked = true;
    });
  }

  document.getElementById('ar-modal-title').textContent = item ? 'Editar Ação' : 'Nova Ação de Relatório';

  openModal('modal-acoes-relatorio');
}

async function salvarAcaoRelatorio() {
  const id    = val('ar-id');
  const nivel = val('ar-nivel');
  const acoes = val('ar-acoes').trim();

  // Lê categorias marcadas
  const categorias = [...document.querySelectorAll('.ar-cat-cb:checked')].map(cb => cb.value);

  if (!categorias.length) { toast('Selecione ao menos uma categoria', 'error'); return; }
  if (!nivel)             { toast('Selecione o nível de criticidade', 'error'); return; }
  if (!acoes)             { toast('Informe as ações propostas', 'error'); return; }

  const rec = {
    id:         id || makeAcaoId(),
    categorias,
    nivel,
    acoes,
    created: new Date().toLocaleDateString('pt-BR')
  };

  if (!Array.isArray(state.acoesRelatorio)) state.acoesRelatorio = [];
  const idx = state.acoesRelatorio.findIndex(a => a.id === rec.id);
  if (idx >= 0) state.acoesRelatorio[idx] = rec;
  else state.acoesRelatorio.unshift(rec);

  renderAcoesRelatorio();
  toast(idx >= 0 ? 'Ação atualizada' : 'Ação cadastrada');
  closeModal('modal-acoes-relatorio');
  persist(); // fallback local (IndexedDB) — mantém funcionamento offline

  const { error } = await window.supabaseClient.from('acoes_relatorio').upsert(rec);
  if (error) {
    console.warn('[Supabase] Falha ao salvar ação de relatório:', error);
    toast('⚠ Salvo nesta sessão, mas não foi possível sincronizar com a nuvem.', 'error');
  }
}

function editarAcaoRelatorio(id) {
  abrirModalAcaoRelatorio(id);
}

async function removerAcaoRelatorio(id) {
  if (!confirm('Excluir esta ação de relatório?')) return;
  if (!Array.isArray(state.acoesRelatorio)) return;
  const idx = state.acoesRelatorio.findIndex(a => a.id === id);
  if (idx < 0) return;
  state.acoesRelatorio.splice(idx, 1);
  renderAcoesRelatorio();
  toast('Ação removida', 'error');
  persist(); // fallback local (IndexedDB)

  const { error } = await window.supabaseClient.from('acoes_relatorio').delete().eq('id', id);
  if (error) {
    console.warn('[Supabase] Falha ao excluir ação de relatório:', error);
    toast('⚠ Removida nesta sessão, mas não foi possível sincronizar com a nuvem.', 'error');
  }
}

async function limparAcoesRelatorio() {
  if (!(state.acoesRelatorio || []).length) return toast('Nenhuma ação cadastrada', 'error');
  if (!confirm('Excluir todas as ações de relatório?')) return;
  state.acoesRelatorio = [];
  renderAcoesRelatorio();
  toast('Todas as ações foram excluídas', 'error');
  persist(); // fallback local (IndexedDB)

  const { error } = await window.supabaseClient.from('acoes_relatorio').delete().eq('user_id', window.currentUser?.id);
  if (error) {
    console.warn('[Supabase] Falha ao limpar ações de relatório:', error);
    toast('⚠ Removidas nesta sessão, mas não foi possível sincronizar com a nuvem.', 'error');
  }
}

// ═══════════════════════════════════════════════════════════
// DASHBOARD GERENCIAL — strip KPI analítico (sem filtro de período)
// ═══════════════════════════════════════════════════════════
