function excluirImportacao(importId) {
  const importRecord = state.imports.find(r => r.id === importId);
  const nomeArquivo  = importRecord?.arquivo ?? 'importação';
  const modulo       = importRecord?.modulo  ?? '';
  const registros    = importRecord?.registros ?? 0;
  const dataHora     = importRecord?.dataHora  ?? '';

  confirmarDestrutivo({
    title:        'Excluir importação',
    sub:          nomeArquivo,
    body:         `
      <div style="display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;gap:8px;align-items:center">
          <span style="color:var(--text3);min-width:80px;font-size:12px">Módulo</span>
          <strong>${escapeHtml(modulo)}</strong>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span style="color:var(--text3);min-width:80px;font-size:12px">Registros</span>
          <strong style="color:var(--red)">${Number(registros).toLocaleString('pt-BR')} registros serão removidos</strong>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span style="color:var(--text3);min-width:80px;font-size:12px">Importado em</span>
          <span>${escapeHtml(dataHora)}</span>
        </div>
        <div style="margin-top:8px;padding:10px 12px;background:var(--red-bg);border:1px solid var(--red-border);border-radius:6px;font-size:12px;color:var(--red)">
          <i class="ti ti-alert-triangle"></i>
          Esta ação removerá todos os registros desta importação. Use <strong>Desfazer</strong> logo após se precisar reverter.
        </div>
      </div>`,
    confirmLabel: 'Excluir importação',
    onConfirm: () => {
      const snapshotEntradas    = [...state.entradas];
      const snapshotSaidas      = [...state.saidas];
      const snapshotLancamentos = [...state.lancamentos];
      const snapshotSap         = [...state.sap];
      const snapshotProducao    = [...state.producao];
      const snapshotFiliais     = [...state.filiais];
      const snapshotMateriais   = [...state.materiais];
      const snapshotImports     = [...state.imports];

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


// ── Helpers para cálculo automático de valor total ──────────
function _modalAutoCalcTotal(pesoId, custoId, totalId) {
  const peso  = num(val(pesoId));
  const custo = num(val(custoId));
  if (peso && custo) {
    const el = document.getElementById(totalId);
    if (el && !el.dataset.userEdited) el.value = (peso * custo).toFixed(2);
  }
}

function _fmtDateInput(v) {
  // Converte YYYY-MM-DD (input type=date) para dd/mm/aaaa
  if (!v) return new Date().toLocaleDateString('pt-BR');
  const [y,m,d] = v.split('-');
  return d && m && y ? `${d}/${m}/${y}` : v;
}

function salvarEntrada() {
  const peso  = num(val('e-peso'));
  const custo = num(val('e-custo'));
  const total = num(val('e-valor-total')) || (peso * custo);
  const mat   = val('e-material');
  const central = val('e-central-compra');

  if (!central) { toast('Informe a Central Compra', 'error'); return; }
  if (!mat)     { toast('Informe o Material', 'error'); return; }
  if (!peso)    { toast('Informe o Peso', 'error'); return; }

  const rec = stamp({
    centralCompra:  normalizarCentral(central),
    centralDestino: normalizarCentral(val('e-central-destino') || central),
    nf:             val('e-nf') || '—',
    dtEmissao:      _fmtDateInput(val('e-dt-emissao')),
    dtDescarga:     _fmtDateInput(val('e-dt-descarga') || val('e-dt-emissao')),
    fornecedor:     val('e-fornecedor') || '—',
    categoria:      val('e-categoria') || '—',
    materialOriginal: mat,
    material:       normalizarMaterial(mat),
    peso,
    um:             val('e-um') || 'KG',
    custo,
    valorTotal:     total
  });

  state.entradas.unshift(rec);
  invalidateSearchIndex('entradas');
  persist();
  closeModal('modal-manual');
  renderEntradas();
  updateDashboard();
  toast('Entrada salva com sucesso');
}

function salvarSaida() {
  const peso  = num(val('s-peso'));
  const custo = num(val('s-custo'));
  const total = num(val('s-valor-total')) || (peso * custo);
  const mat   = val('s-material');
  const central = val('s-central');

  if (!central) { toast('Informe a Central', 'error'); return; }
  if (!mat)     { toast('Informe o Material', 'error'); return; }
  if (!peso)    { toast('Informe o Peso', 'error'); return; }

  const rec = stamp({
    central:        normalizarCentral(central),
    dtEmissao:      _fmtDateInput(val('s-dt-emissao')),
    os:             val('s-os') || '—',
    contrato:       '—',
    categoria:      val('s-categoria') || '—',
    fornecedor:     val('s-fornecedor') || '—',
    materialOriginal: mat,
    material:       normalizarMaterial(mat),
    peso,
    um:             val('s-um') || 'KG',
    custo,
    valorTotal:     total
  });

  state.saidas.unshift(rec);
  invalidateSearchIndex('saidas');
  persist();
  closeModal('modal-manual');
  renderSaidas();
  updateDashboard();
  toast('Saída salva com sucesso');
}

function salvarLancamento() {
  const peso  = num(val('l-peso'));
  const custo = num(val('l-custo'));
  const total = num(val('l-valor-total')) || (peso * custo);
  const mat   = val('l-material');
  const central = val('l-central');

  if (!central) { toast('Informe a Central', 'error'); return; }
  if (!mat)     { toast('Informe o Material', 'error'); return; }
  if (!peso)    { toast('Informe o Peso', 'error'); return; }

  const rec = stamp({
    central:        normalizarCentral(central),
    dtLanc:         _fmtDateInput(val('l-dt-lanc')),
    fornecedor:     val('l-fornecedor') || '—',
    categoria:      val('l-categoria') || '—',
    materialOriginal: mat,
    material:       normalizarMaterial(mat),
    peso,
    um:             val('l-um') || 'KG',
    custo,
    valorTotal:     total
  });

  state.lancamentos.unshift(rec);
  invalidateLancIndex();
  persist();
  closeModal('modal-manual');
  renderLancamentos();
  updateDashboard();
  toast('Lançamento salvo com sucesso');
}

function salvarSAP() {
  const peso  = num(val('sap-peso'));
  const custoUnit = num(val('sap-custo-unit'));
  const total = num(val('sap-valor-total')) || (Math.abs(peso) * custoUnit);
  const mat   = val('sap-material');
  const central = val('sap-central');
  const movimento = val('sap-movimento');

  if (!central)  { toast('Informe a Central', 'error'); return; }
  if (!mat)      { toast('Informe o Material', 'error'); return; }
  if (!movimento){ toast('Informe o Movimento', 'error'); return; }

  const hoje = new Date().toLocaleDateString('pt-BR');
  const rec = stamp({
    usuario:        val('sap-usuario') || '—',
    movimento,
    ref:            val('sap-ref') || '—',
    documento:      val('sap-doc') || '—',
    central:        normalizarCentral(central),
    deposito:       val('sap-deposito') || '—',
    dtDoc:          _fmtDateInput(val('sap-dt-doc') || val('sap-dt-lanc')),
    dtLanc:         _fmtDateInput(val('sap-dt-lanc')) || hoje,
    dtReg:          _fmtDateInput(val('sap-dt-reg') || val('sap-dt-lanc')),
    materialOriginal: mat,
    material:       normalizarMaterial(mat),
    peso,
    um:             val('sap-um') || 'KG',
    custoUnit,
    valorTotal:     total
  });

  state.sap.unshift(rec);
  invalidateSapIndex();
  persist();
  closeModal('modal-manual');
  renderSAP();
  updateDashboard();
  toast('Movimentação SAP salva com sucesso');
}
