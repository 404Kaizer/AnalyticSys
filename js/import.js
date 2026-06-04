function excluirImportacao(importId) {
  const snapshotEntradas    = [...state.entradas];
  const snapshotSaidas      = [...state.saidas];
  const snapshotLancamentos = [...state.lancamentos];
  const snapshotSap         = [...state.sap];
  const snapshotProducao    = [...state.producao];
  const snapshotFiliais     = [...state.filiais];
  const snapshotMateriais   = [...state.materiais];
  const snapshotImports     = [...state.imports];

  const importRecord = state.imports.find(r => r.id === importId);
  const nomeArquivo  = importRecord?.arquivo ?? 'importação';

  confirmarComUndo({
    message: `"${nomeArquivo}" excluída`,

    action: () => {
      const removeByImport = arr => arr.filter(r => r.importId !== importId);
      state.entradas    = removeByImport(state.entradas);
      state.saidas      = removeByImport(state.saidas);
      state.lancamentos = removeByImport(state.lancamentos);
      state.sap         = removeByImport(state.sap);
      state.producao    = removeByImport(state.producao);
      state.filiais     = removeByImport(state.filiais);
      state.materiais   = removeByImport(state.materiais);
      state.imports     = state.imports.filter(r => r.id !== importId);
      // state.configs é INTENCIONALMENTE omitido aqui:
      // configurações não pertencem a nenhuma importação e jamais devem
      // ser excluídas por esta função. Só o próprio usuário pode removê-las
      // manualmente pela tela de Configurações.

      invalidateMaterialLookup();
      invalidateFilialLookup();
      persist();
      renderAll();
    },

    undo: () => {
      state.entradas    = snapshotEntradas;
      state.saidas      = snapshotSaidas;
      state.lancamentos = snapshotLancamentos;
      state.sap         = snapshotSap;
      state.producao    = snapshotProducao;
      state.filiais     = snapshotFiliais;
      state.materiais   = snapshotMateriais;
      state.imports     = snapshotImports;

      invalidateMaterialLookup();
      invalidateFilialLookup();
      persist();
      renderAll();
    },
  });
}

function excluirProducao(absIndex) {
  const filtered = getFilteredData('producao');
  const rec = filtered[absIndex];
  if (!rec) return;

  const originalIndex = state.producao.indexOf(rec);
  const snapshot = { ...rec };

  confirmarComUndo({
    message: `Produção de "${rec.central}" excluída`,

    action: () => {
      state.producao = state.producao.filter(r => r !== rec);
      persist();
      renderProducao();
      updateDashboard();
    },

    undo: () => {
      const insertAt = originalIndex >= 0 && originalIndex <= state.producao.length
        ? originalIndex
        : 0;
      state.producao.splice(insertAt, 0, snapshot);
      persist();
      renderProducao();
      updateDashboard();
    },
  });
}

function salvarProducao() {
  const rec = stamp({
    mes: val('p-mes'),
    central: normalizarCentral(val('p-central')),
    producao: num(val('p-producao')),
    um: 'm³',
    precoMedio: num(val('p-preco')),
    custoMedio: num(val('p-custo')),
    margem: val('p-margem'),
    totalVendas: num(val('p-vendas'))
  });

  if (!rec.mes || !rec.central) {
    toast('Preencha mês e central', 'error');
    return;
  }

  state.producao.unshift(rec);
  persist();
  closeModal('modal-producao');
  renderProducao();
  updateDashboard();
  toast('Registro de produção adicionado com sucesso');
}


function salvarEntrada() {
  const qtd = num(val('e-qtd'));
  const custo = num(val('e-valor'));
  const rec = stamp({
    centralCompra: normalizarCentral(val('e-central-compra')),
    centralDestino: normalizarCentral(val('e-central-destino') || val('e-central-compra')),
    nf: val('e-nf'),
    dtEmissao: val('e-data') || new Date().toLocaleDateString('pt-BR'),
    dtDescarga: val('e-data') || new Date().toLocaleDateString('pt-BR'),
    fornecedor: '—',
    categoria: '—',
    materialOriginal: val('e-desc') || val('e-mat'),
    material: normalizarMaterial(val('e-desc') || val('e-mat')),
    peso: qtd,
    um: 'KG',
    custo,
    valorTotal: qtd * custo
  });

  if (!rec.nf && !rec.material) {
    toast('Preencha a nota fiscal ou o material', 'error');
    return;
  }

  state.entradas.unshift(rec);
  persist();
  closeModal('modal-manual');
  renderEntradas();
  updateDashboard();
  toast('Entrada salva com sucesso');
}

function salvarSaida() {
  const qtd = num(val('s-qtd'));
  const custo = num(val('s-valor'));
  const rec = stamp({
    central: normalizarCentral(val('s-central')),
    dtEmissao: val('s-data') || new Date().toLocaleDateString('pt-BR'),
    os: val('s-os'),
    contrato: '—',
    categoria: '—',
    fornecedor: '—',
    materialOriginal: val('s-desc') || val('s-mat'),
    material: normalizarMaterial(val('s-desc') || val('s-mat')),
    peso: qtd,
    um: 'KG',
    custo,
    valorTotal: qtd * custo
  });

  if (!rec.os && !rec.material) {
    toast('Preencha a OS ou o material', 'error');
    return;
  }

  state.saidas.unshift(rec);
  persist();
  closeModal('modal-manual');
  renderSaidas();
  updateDashboard();
  toast('Saída salva com sucesso');
}

function salvarLancamento() {
  const saldoReal = num(val('l-saldo-real'));
  const saldoSap = num(val('l-saldo-sap'));
  const rec = stamp({
    central: normalizarCentral(val('l-central')),
    dtLanc: val('l-data') || new Date().toLocaleDateString('pt-BR'),
    fornecedor: val('l-resp') || '—',
    categoria: '—',
    materialOriginal: val('l-desc') || val('l-mat'),
    material: normalizarMaterial(val('l-desc') || val('l-mat')),
    peso: saldoReal,
    um: 'KG',
    custo: saldoSap,
    valorTotal: saldoReal * saldoSap
  });

  if (!rec.central || !rec.material) {
    toast('Preencha central e material', 'error');
    return;
  }

  state.lancamentos.unshift(rec);
  persist();
  closeModal('modal-manual');
  renderLancamentos();
  updateDashboard();
  toast('Lançamento salvo com sucesso');
}

function salvarSAP() {
  const peso = num(val('sap-qtd'));
  const total = num(val('sap-valor'));
  const rec = stamp({
    usuario: val('sap-mat') || '—',
    movimento: val('sap-tipo') || '—',
    ref: '—',
    documento: val('sap-doc'),
    central: normalizarCentral(val('sap-central')),
    deposito: '—',
    dtDoc: val('sap-data') || new Date().toLocaleDateString('pt-BR'),
    dtLanc: val('sap-data') || new Date().toLocaleDateString('pt-BR'),
    dtReg: val('sap-data') || new Date().toLocaleDateString('pt-BR'),
    materialOriginal: val('sap-desc') || val('sap-mat'),
    material: normalizarMaterial(val('sap-desc') || val('sap-mat')),
    peso,
    um: 'KG',
    custoUnit: peso !== 0 ? total / peso : 0,
    valorTotal: total
  });

  if (!rec.documento && !rec.material) {
    toast('Preencha documento ou material', 'error');
    return;
  }

  state.sap.unshift(rec);
  persist();
  closeModal('modal-manual');
  renderSAP();
  updateDashboard();
  toast('Movimentação SAP salva com sucesso');
}
