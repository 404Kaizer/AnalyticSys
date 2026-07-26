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
          // Marca a exclusão de forma SÍNCRONA antes de qualquer outra coisa —
          // sobrevive a um fechamento/crash da aba mesmo que aconteça antes do
          // persist() (debounced) chegar a rodar. Ver reconcilePendingDeletes()
          // em persist.js.
          if (typeof markImportPendingDelete === 'function') markImportPendingDelete(importId);

          // Registros manuais (fonte='manual') não têm importId e nunca devem
          // ser removidos por esta operação — a guarda explícita protege contra
          // casos futuros onde importId possa ser undefined por outro motivo.
          const removeByImport = arr => arr.filter(r => r.fonte === 'manual' || r.importId !== importId);
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
          // Invalida todos os índices de busca para que o dashboard e as
          // listagens reflitam imediatamente os registros removidos.
          invalidateLancIndex();
          invalidateSapIndex();
          invalidateSaidasIndex();
          invalidateAllSearchIndexes();
          persist();
          renderAll();

          // Sincroniza a exclusão do próprio registro de log com a nuvem
          // (Fase 4 — Etapa 3). Os demais módulos (Lançamentos, Filiais,
          // Materiais) ainda NÃO têm seus registros apagados da nuvem por
          // esta operação — isso fica pra Etapa 7 (cascata unificada).
          if (typeof _importsSyncDelete === 'function') _importsSyncDelete(importId);
        },
        undo: () => {
          // A exclusão foi revertida — remove a marca para que um fechamento
          // logo em seguida não reaplique a exclusão no próximo boot.
          if (typeof unmarkImportPendingDelete === 'function') unmarkImportPendingDelete(importId);

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
          // Invalida índices também no undo para reconstruir com os dados restaurados.
          invalidateLancIndex();
          invalidateSapIndex();
          invalidateSaidasIndex();
          invalidateAllSearchIndexes();
          persist();
          renderAll();

          // Restaura o registro de log na nuvem também.
          if (typeof _importsSyncUpsert === 'function') {
            const importSnap = snapshotImports.find(r => r.id === importId);
            if (importSnap) _importsSyncUpsert(importSnap);
          }
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

function _criarRegistroProducao(dados) {
  const central = dados.central;
  const rec = stamp({
    fonte: 'manual',
    mes: dados.mes,
    centralOriginal: central,
    central: normalizarCentral(central),
    producao: num(dados.producao),
    um: 'm³',
    precoMedio: num(dados.preco),
    custoMedio: num(dados.custo),
    margem: dados.margem,
    totalVendas: num(dados.vendas)
  });

  if (!rec.mes || !rec.central) return { ok: false, erro: 'Preencha mês e central' };

  state.producao.unshift(rec);
  persist();
  return { ok: true, rec };
}

function salvarProducao() {
  const resultado = _criarRegistroProducao({
    central:  val('p-central'),
    mes:      val('p-mes'),
    producao: val('p-producao'),
    preco:    val('p-preco'),
    custo:    val('p-custo'),
    margem:   val('p-margem'),
    vendas:   val('p-vendas'),
  });
  if (!resultado.ok) { toast(resultado.erro, 'error'); return; }
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

// Lógica pura: recebe um objeto de dados (não depende de inputs do DOM),
// valida, normaliza e grava. Retorna { ok, rec } ou { ok:false, erro }.
// Usada tanto pelo modal (salvarEntrada) quanto pelo Assistente (chat).
function _criarRegistroEntrada(dados) {
  const central        = dados.central;
  const centralDestino = dados.centralDestino || central;
  const mat            = dados.mat;
  const peso           = num(dados.peso);
  const custo          = num(dados.custo);
  const total          = num(dados.total) || (peso * custo);

  if (!central) return { ok: false, erro: 'Informe a Central Compra' };
  if (!mat)     return { ok: false, erro: 'Informe o Material' };
  if (!peso)    return { ok: false, erro: 'Informe o Peso' };

  registrarNomeOriginalMaterial('entradas', mat);
  const categoriaOriginal = String(dados.categoria || '').trim();
  const rec = stamp({
    fonte: 'manual',
    centralCompraOriginal:  central,
    centralCompra:          normalizarCentral(central),
    centralDestinoOriginal: centralDestino,
    centralDestino:         normalizarCentral(centralDestino),
    nf:             dados.nf || '—',
    dtEmissao:      _fmtDateInput(dados.dtEmissao),
    dtDescarga:     _fmtDateInput(dados.dtDescarga || dados.dtEmissao),
    fornecedor:     dados.fornecedor || '—',
    categoriaOriginal,
    categoria:      getCategoriaPorGrupo(mat) || categoriaOriginal || '—',
    materialOriginal: mat,
    material:       normalizarMaterial(mat),
    peso,
    um:             dados.um || 'KG',
    custo,
    valorTotal:     total
  });

  state.entradas.unshift(rec);
  invalidateSearchIndex('entradas');
  persist();
  return { ok: true, rec };
}

function salvarEntrada() {
  const resultado = _criarRegistroEntrada({
    central:        val('e-central-compra'),
    centralDestino: val('e-central-destino'),
    mat:            val('e-material'),
    peso:           val('e-peso'),
    custo:          val('e-custo'),
    total:          val('e-valor-total'),
    nf:             val('e-nf'),
    dtEmissao:      val('e-dt-emissao'),
    dtDescarga:     val('e-dt-descarga'),
    fornecedor:     val('e-fornecedor'),
    categoria:      val('e-categoria'),
    um:             val('e-um'),
  });
  if (!resultado.ok) { toast(resultado.erro, 'error'); return; }
  closeModal('modal-manual');
  renderEntradas();
  updateDashboard();
  toast('Entrada salva com sucesso');
}


function _criarRegistroSaida(dados) {
  const central = dados.central;
  const mat     = dados.mat;
  const peso    = num(dados.peso);
  const custo   = num(dados.custo);
  const total   = num(dados.total) || (peso * custo);

  if (!central) return { ok: false, erro: 'Informe a Central' };
  if (!mat)     return { ok: false, erro: 'Informe o Material' };
  if (!peso)    return { ok: false, erro: 'Informe o Peso' };

  registrarNomeOriginalMaterial('saidas', mat);
  const categoriaOriginalSaida = String(dados.categoria || '').trim();
  const rec = stamp({
    fonte: 'manual',
    centralOriginal: central,
    central:        normalizarCentral(central),
    dtEmissao:      _fmtDateInput(dados.dtEmissao),
    os:             dados.os || '—',
    contrato:       '—',
    categoriaOriginal: categoriaOriginalSaida,
    categoria:      getCategoriaPorGrupo(mat) || categoriaOriginalSaida || '—',
    fornecedor:     dados.fornecedor || '—',
    materialOriginal: mat,
    material:       normalizarMaterial(mat),
    peso,
    um:             dados.um || 'KG',
    custo,
    valorTotal:     total
  });

  state.saidas.unshift(rec);
  invalidateSearchIndex('saidas');
  persist();
  return { ok: true, rec };
}

function salvarSaida() {
  const resultado = _criarRegistroSaida({
    central:    val('s-central'),
    mat:        val('s-material'),
    peso:       val('s-peso'),
    custo:      val('s-custo'),
    total:      val('s-valor-total'),
    os:         val('s-os'),
    categoria:  val('s-categoria'),
    fornecedor: val('s-fornecedor'),
    dtEmissao:  val('s-dt-emissao'),
    um:         val('s-um'),
  });
  if (!resultado.ok) { toast(resultado.erro, 'error'); return; }
  closeModal('modal-manual');
  renderSaidas();
  updateDashboard();
  toast('Saída salva com sucesso');
}


function _criarRegistroLancamento(dados) {
  const central = dados.central;
  const mat     = dados.mat;
  const peso    = num(dados.peso);
  const custo   = num(dados.custo);
  const total   = num(dados.total) || (peso * custo);

  if (!central) return { ok: false, erro: 'Informe a Central' };
  if (!mat)     return { ok: false, erro: 'Informe o Material' };
  if (!peso)    return { ok: false, erro: 'Informe o Peso' };

  registrarNomeOriginalMaterial('lancamentos', mat);
  const categoriaOriginalLanc = String(dados.categoria || '').trim();
  const rec = stamp({
    fonte: 'manual',
    centralOriginal: central,
    central:        normalizarCentral(central),
    dtLanc:         _fmtDateInput(dados.dtLanc),
    fornecedor:     dados.fornecedor || '—',
    categoriaOriginal: categoriaOriginalLanc,
    categoria:      getCategoriaPorGrupo(mat) || categoriaOriginalLanc || '—',
    materialOriginal: mat,
    material:       normalizarMaterial(mat),
    peso,
    um:             dados.um || 'KG',
    custo,
    valorTotal:     total
  });

  state.lancamentos.unshift(rec);
  invalidateLancIndex();
  persist();
  _lancSyncUpsert(rec);
  return { ok: true, rec };
}

function salvarLancamento() {
  const resultado = _criarRegistroLancamento({
    central:    val('l-central'),
    mat:        val('l-material'),
    peso:       val('l-peso'),
    custo:      val('l-custo'),
    total:      val('l-valor-total'),
    fornecedor: val('l-fornecedor'),
    categoria:  val('l-categoria'),
    dtLanc:     val('l-dt-lanc'),
    um:         val('l-um'),
  });
  if (!resultado.ok) { toast(resultado.erro, 'error'); return; }
  closeModal('modal-manual');
  renderLancamentos();
  updateDashboard();
  toast('Lançamento salvo com sucesso');
}

// ═══════════════════════════════════════════════════════════
// LANÇAMENTOS — sincronização com o Supabase (Fase 4 — Etapa 1)
// ═══════════════════════════════════════════════════════════
// Primeiro dos 5 módulos grandes a sincronizar. Cobre: criação manual
// (_criarRegistroLancamento, usada tanto pelo modal quanto pelo Assistente),
// importação em lote (hook em processImportedRows, dashboard.js) e exclusão
// individual (removerRegistro, dashboard.js). A exclusão em cascata de uma
// importação inteira (excluirImportacao) AINDA NÃO remove da nuvem — isso
// fica pra uma etapa própria da Fase 4, depois que os outros módulos também
// estiverem sincronizando (evita reescrever excluirImportacao várias vezes).

function _lancToDbRow(r) {
  return {
    id: r.id,
    fonte: r.fonte || null,
    central_original: r.centralOriginal || null,
    central: r.central || null,
    dt_lanc: r.dtLanc || null,
    fornecedor: r.fornecedor || null,
    categoria_original: r.categoriaOriginal || null,
    categoria: r.categoria || null,
    material_original: r.materialOriginal || null,
    material: r.material || null,
    peso: r.peso ?? null,
    um: r.um || null,
    custo: r.custo ?? null,
    valor_total: r.valorTotal ?? null,
    import_id: r.importId || null,
    created_at: r.createdAt || null,
  };
}

function _lancFromDbRow(row) {
  return {
    id: row.id,
    fonte: row.fonte,
    centralOriginal: row.central_original,
    central: row.central,
    dtLanc: row.dt_lanc,
    fornecedor: row.fornecedor,
    categoriaOriginal: row.categoria_original,
    categoria: row.categoria,
    materialOriginal: row.material_original,
    material: row.material,
    peso: row.peso,
    um: row.um,
    custo: row.custo,
    valorTotal: row.valor_total,
    importId: row.import_id || undefined,
    createdAt: row.created_at,
  };
}

// Upsert de um único lançamento (criação manual/Assistente). Falha não
// bloqueia a UI (já gravado localmente) — só avisa por toast, mesmo padrão
// de ocorrencias.js/dai.js.
function _lancSyncUpsert(rec) {
  if (!window.supabaseClient) return;
  window.supabaseClient.from('lancamentos').upsert(_lancToDbRow(rec))
    .then(({ error }) => {
      if (error) {
        console.warn('[Supabase] Falha ao sincronizar lançamento:', error);
        toast('⚠ Lançamento salvo nesta sessão, mas não foi possível sincronizar com a nuvem.', 'error');
      }
    });
}

// Upsert em lote — usado na importação em massa e na sincronização inicial
// (registros locais pré-existentes que ainda não subiram pra nuvem). Quebra
// em blocos para não estourar o limite de payload do Postgrest em arquivos
// grandes (semanas de lançamentos agregados podem chegar a milhares de
// linhas de uma vez).
const LANC_SYNC_BATCH_SIZE = 500;
async function _lancSyncUpsertBatch(records) {
  if (!window.supabaseClient || !records || !records.length) return;
  const rows = records.map(_lancToDbRow);
  for (let i = 0; i < rows.length; i += LANC_SYNC_BATCH_SIZE) {
    const slice = rows.slice(i, i + LANC_SYNC_BATCH_SIZE);
    const { error } = await window.supabaseClient.from('lancamentos').upsert(slice);
    if (error) {
      console.warn('[Supabase] Falha ao sincronizar lote de lançamentos:', error);
      toast('⚠ Lançamentos salvos nesta sessão, mas não foi possível sincronizar todos com a nuvem.', 'error');
      break; // evita repetir o mesmo toast a cada bloco que falhar
    }
  }
}

// Exclusão individual — chamada por removerRegistro (dashboard.js).
function _lancSyncDelete(id) {
  if (!window.supabaseClient || !id) return;
  window.supabaseClient.from('lancamentos').delete().eq('id', id)
    .then(({ error }) => { if (error) console.warn('[Supabase] Falha ao excluir lançamento na nuvem:', error); });
}

// Busca no boot (ver SUPABASE_BOOT_SYNCS em dashboard.js). NUNCA substitui a
// lista local inteira — mescla por id, nuvem tem prioridade em conflito.
// Isso evita apagar localmente lançamentos que ainda não tiveram tempo de
// subir (gravados offline, ou logo após esta sincronização ser ativada pela
// 1ª vez, quando a base local já tem lançamentos e a nuvem ainda está
// vazia). Depois do merge, qualquer registro local que ainda não exista na
// nuvem sobe agora — é assim que a base já existente de cada analista se
// sincroniza sozinha na primeira vez que abrir o sistema após esta
// atualização, sem precisar de nenhuma migração manual.
async function syncLancamentosFromSupabase() {
  if (!window.supabaseClient) return;
  try {
    const { data, error } = await window.supabaseClient.from('lancamentos').select('*');
    if (error) throw error;
    const remoto = (data || []).map(_lancFromDbRow);
    const idsRemotos = new Set(remoto.map(r => r.id));

    const local = Array.isArray(state.lancamentos) ? state.lancamentos : [];
    const porId = new Map(local.filter(r => r.id).map(r => [r.id, r]));
    remoto.forEach(r => porId.set(r.id, r));
    state.lancamentos = [...porId.values()];
    if (typeof invalidateLancIndex === 'function') invalidateLancIndex();

    const naoSincronizados = local.filter(r => r.id && !idsRemotos.has(r.id));
    if (naoSincronizados.length) await _lancSyncUpsertBatch(naoSincronizados);
  } catch (err) {
    console.warn('[Supabase] Falha ao buscar lançamentos — mantendo dados locais.', err);
  }
}

// ═══════════════════════════════════════════════════════════
// LOG DE IMPORTAÇÕES — sincronização com o Supabase (Fase 4 — Etapa 3)
// ═══════════════════════════════════════════════════════════
// 'id' aqui já é o próprio importId (string estável gerada em
// processImportedRows) — diferente de Lançamentos/Filiais/Materiais, este
// módulo não precisou de nenhuma fundação de id novo.
// Só sincroniza registros com status já definitivo (nunca 'Processando' —
// esse é um estado transitório local, sem sentido persistir na nuvem).

function _importsToDbRow(rec) {
  return {
    id: rec.id,
    arquivo: rec.arquivo || null,
    modulo: rec.modulo || null,
    registros: rec.registros ?? null,
    total_arquivo: rec.totalArquivo ?? null,
    data_hora: rec.dataHora || null,
    status: rec.status || null,
    status_tip: rec.statusTip || null,
    created_at: rec.createdAt || null,
  };
}

function _importsFromDbRow(row) {
  return {
    id: row.id,
    arquivo: row.arquivo,
    modulo: row.modulo,
    registros: row.registros,
    totalArquivo: row.total_arquivo,
    dataHora: row.data_hora,
    status: row.status,
    statusTip: row.status_tip,
    createdAt: row.created_at,
  };
}

function _importsSyncUpsert(rec) {
  if (!window.supabaseClient || !rec || rec.status === 'Processando') return;
  window.supabaseClient.from('imports').upsert(_importsToDbRow(rec))
    .then(({ error }) => { if (error) console.warn('[Supabase] Falha ao sincronizar log de importação:', error); });
}

function _importsSyncDelete(importId) {
  if (!window.supabaseClient || !importId) return;
  window.supabaseClient.from('imports').delete().eq('id', importId)
    .then(({ error }) => { if (error) console.warn('[Supabase] Falha ao excluir log de importação na nuvem:', error); });
}

// Busca no boot — merge por id (o próprio importId), nuvem tem prioridade
// em conflito. Depois do merge, sincronização inicial: registros locais
// definitivos ('Processando' fica de fora, é estado transitório) que ainda
// não existem na nuvem sobem agora — mesmo padrão de Lançamentos/Filiais/
// Materiais.
async function syncImportsFromSupabase() {
  if (!window.supabaseClient) return;
  try {
    const { data, error } = await window.supabaseClient.from('imports').select('*');
    if (error) throw error;
    const remoto = (data || []).map(_importsFromDbRow);
    const idsRemotos = new Set(remoto.map(r => r.id));

    const local = Array.isArray(state.imports) ? state.imports : [];
    const porId = new Map(local.filter(r => r.id).map(r => [r.id, r]));
    remoto.forEach(r => porId.set(r.id, r));
    state.imports = [...porId.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    const naoSincronizados = local.filter(r => r.id && r.status !== 'Processando' && !idsRemotos.has(r.id));
    naoSincronizados.forEach(_importsSyncUpsert);
  } catch (err) {
    console.warn('[Supabase] Falha ao buscar log de importações — mantendo dados locais.', err);
  }
}


function _criarRegistroSAP(dados) {
  const central   = dados.central;
  const mat       = dados.mat;
  const movimento = dados.movimento;
  const peso      = num(dados.peso);
  const custoUnit = num(dados.custoUnit);
  const total     = num(dados.total) || (Math.abs(peso) * custoUnit);

  if (!central)   return { ok: false, erro: 'Informe a Central' };
  if (!mat)       return { ok: false, erro: 'Informe o Material' };
  if (!movimento) return { ok: false, erro: 'Informe o Movimento' };

  const hoje = new Date().toLocaleDateString('pt-BR');
  const rec = stamp({
    fonte: 'manual',
    usuario:        dados.usuario || '—',
    movimento,
    ref:            dados.ref || '—',
    documento:      dados.documento || '—',
    centralOriginal: central,
    central:        normalizarCentral(central),
    deposito:       dados.deposito || '—',
    dtDoc:          _fmtDateInput(dados.dtDoc || dados.dtLanc),
    dtLanc:         _fmtDateInput(dados.dtLanc) || hoje,
    dtReg:          _fmtDateInput(dados.dtReg || dados.dtLanc),
    materialOriginal: mat,
    material:       normalizarMaterial(mat),
    peso,
    um:             dados.um || 'KG',
    custoUnit,
    valorTotal:     total
  });

  state.sap.unshift(rec);
  invalidateSapIndex();
  persist();
  return { ok: true, rec };
}

function salvarSAP() {
  const resultado = _criarRegistroSAP({
    central:    val('sap-central'),
    mat:        val('sap-material'),
    movimento:  val('sap-movimento'),
    peso:       val('sap-peso'),
    custoUnit:  val('sap-custo-unit'),
    total:      val('sap-valor-total'),
    usuario:    val('sap-usuario'),
    ref:        val('sap-ref'),
    documento:  val('sap-doc'),
    deposito:   val('sap-deposito'),
    dtDoc:      val('sap-dt-doc'),
    dtLanc:     val('sap-dt-lanc'),
    dtReg:      val('sap-dt-reg'),
    um:         val('sap-um'),
  });
  if (!resultado.ok) { toast(resultado.erro, 'error'); return; }
  closeModal('modal-manual');
  renderSAP();
  updateDashboard();
  toast('Movimentação SAP salva com sucesso');
}
