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
}


async function salvarMateriais() {
  const text = val('materiais-text');
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!lines.length) { toast('Informe ao menos um cadastro', 'error'); return; }

  const imported = parseMateriaisLines(lines);
  if (!imported.length) { toast('Nenhum cadastro válido encontrado', 'error'); return; }

  upsertMateriais(imported);
  listPages.materiais = 0;
  setVal('materiais-text', '');
  reaplicarPadronizacaoMateriais();
  await persistStateNow();
  renderAll();
  updateImportPrereqUI();
  toast(`${imported.length} material(is) cadastrado(s)`);
  closeModal('modal-materiais');
}

function parseMateriaisLines(lines) {
  const items = [];

  for (const rawLine of lines) {
    const line = String(rawLine || '').trim();
    if (!line) continue;

    let origem = '';
    let alias = '';
    let desc = '';

    const direct = line.match(/^(.*?)(?:\s*(?:=>|=|;|\t)\s*)(.+)$/);
    if (direct) {
      origem = direct[1].trim();
      const right = direct[2].trim();
      const parts = right.split('|').map(s => s.trim()).filter(Boolean);
      alias = parts[0] || '';
      desc = parts.slice(1).join(' | ');
    } else {
      const parts = line.split('|').map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2) {
        origem = parts[0];
        alias = parts[1];
        desc = parts.slice(2).join(' | ');
      }
    }

    if (!origem || !alias) continue;

    items.push({
      origem,
      alias,
      desc,
      created: new Date().toLocaleDateString('pt-BR')
    });
  }

  return items;
}

function materialMatchKey(item) {
  return [
    normalizeText(item?.origem),
    normalizeText(item?.alias),
    normalizeText(item?.desc)
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
    desc: String(src.desc || '').trim(),
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
    'ORIGEM', 'ORIGINAL', 'MATERIAL', 'MATERIAL ORIGINAL', 'GRUPO', 'GRUPO SAP', 'SAP', 'DESCRICAO', 'DESCRIÇÃO'
  ].includes(h));

  let startRow = 0;
  let origemIdx = 0;
  let aliasIdx = 1;
  let descIdx = 2;

  if (headerLooksLikeMeta) {
    startRow = 1;
    origemIdx = findIdx('origem', 'original', 'material', 'material original', 'nome');
    aliasIdx = findIdx('grupo', 'grupo sap', 'sap', 'padronizada', 'padronizado', 'padronizacao', 'padronização');
    descIdx = findIdx('descricao', 'descrição', 'descricao do material', 'observacao', 'observação');
    if (origemIdx < 0) origemIdx = 0;
    if (aliasIdx < 0) aliasIdx = 1;
    if (descIdx < 0) descIdx = 2;
  }

  return cleaned.slice(startRow).map(row => ({
    origem: String(row[origemIdx] || '').trim(),
    alias: String(row[aliasIdx] || '').trim(),
    desc: String(row[descIdx] || '').trim(),
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
      closeModal('modal-materiais');
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

async function removerMaterial(id) {
  const idx = state.materiais.findIndex(m => m.id === id);
  if (idx < 0) {
    toast('Material não encontrado', 'error');
    return;
  }
  state.materiais.splice(idx, 1);
  invalidateMaterialLookup();
  reaplicarPadronizacaoMateriais();
  await persistStateNow();
  renderAll();
  updateImportPrereqUI();
  toast('Material removido');
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


async function salvarFiliais() {
  const text = val('filiais-text');
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!lines.length) { toast('Informe ao menos um cadastro', 'error'); return; }

  const imported = parseFiliaisLines(lines);
  if (!imported.length) { toast('Nenhum cadastro válido encontrado', 'error'); return; }

  upsertFiliais(imported);
  setVal('filiais-text', '');
  await persistStateNow();
  renderFiliais();
  updateImportPrereqUI();
  toast(`${imported.length} filial(is) cadastrada(s)`);
}

function parseFiliaisLines(lines) {
  const items = [];

  for (const rawLine of lines) {
    const line = String(rawLine || '').trim();
    if (!line) continue;

    let origem = '';
    let alias = '';
    let cnpj = '';
    let regional = '';

    // Primary format: [num |] ORIGINAL = SIGLA = CNPJ = REGIONAL
    const eqParts = line.split('=').map(s => s.trim());
    if (eqParts.length >= 2) {
      // Left side may be "82 | Sete Lagoas" — take last pipe-token as origem
      const leftRaw = eqParts[0];
      const pipeParts = leftRaw.split('|').map(s => s.trim()).filter(Boolean);
      origem   = pipeParts.at(-1) || leftRaw.trim();
      alias    = eqParts[1] || '';
      cnpj     = eqParts[2] || '';
      regional = eqParts[3] || '';
    } else {
      // Fallback: pipe-only format
      const parts = line.split('|').map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2) {
        origem = parts.slice(0, -1).join(' | ');
        alias  = parts.at(-1);
      }
    }

    if (!origem || !alias) continue;

    items.push({
      origem,
      alias,
      cnpj,
      regional,
      created: new Date().toLocaleDateString('pt-BR')
    });
  }

  return items;
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
      await persistStateNow();
      _lstepSet('fil-save', 'done'); _lbarSet(100);
      renderFiliais();
      closeModal('modal-filiais');
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
  state.filiais.splice(idx, 1);
  invalidateFilialLookup();
  await persistStateNow();
  renderFiliais();
  updateImportPrereqUI();
  toast('Filial removida', 'error');
}

async function limparFiliais() {
  if (!state.filiais.length) return toast('Nenhuma filial cadastrada', 'error');
  if (!confirm('Excluir todas as filiais cadastradas?')) return;
  state.filiais = [];
  invalidateFilialLookup();
  await persistStateNow();
  renderFiliais();
  updateImportPrereqUI();
  toast('Todas as filiais foram excluídas', 'error');
}

// ═══════════════════════════════════════════════════════════
// AÇÕES DE RELATÓRIO — regras para o Relatório com Ações
// ═══════════════════════════════════════════════════════════

function makeAcaoId() {
  return 'AR-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
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

function salvarAcaoRelatorio() {
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

  persist();
  renderAcoesRelatorio();
  toast(idx >= 0 ? 'Ação atualizada' : 'Ação cadastrada');
  closeModal('modal-acoes-relatorio');
}

function editarAcaoRelatorio(id) {
  abrirModalAcaoRelatorio(id);
}

function removerAcaoRelatorio(id) {
  if (!confirm('Excluir esta ação de relatório?')) return;
  if (!Array.isArray(state.acoesRelatorio)) return;
  const idx = state.acoesRelatorio.findIndex(a => a.id === id);
  if (idx < 0) return;
  state.acoesRelatorio.splice(idx, 1);
  persist();
  renderAcoesRelatorio();
  toast('Ação removida', 'error');
}

function limparAcoesRelatorio() {
  if (!(state.acoesRelatorio || []).length) return toast('Nenhuma ação cadastrada', 'error');
  if (!confirm('Excluir todas as ações de relatório?')) return;
  state.acoesRelatorio = [];
  persist();
  renderAcoesRelatorio();
  toast('Todas as ações foram excluídas', 'error');
}

// ═══════════════════════════════════════════════════════════
// DASHBOARD GERENCIAL — strip KPI analítico (sem filtro de período)
// ═══════════════════════════════════════════════════════════
