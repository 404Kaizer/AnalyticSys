// ═══════════════════════════════════════════════════════════
// CASCATA DE EXCLUSÃO NA NUVEM (Fase 4 — Etapa 7)
// ═══════════════════════════════════════════════════════════
// Escopo real: hoje só Filiais/Materiais sincronizam TODO o cadastro
// (manual + importado) — Entradas/Saídas/Lançamentos/Custos SAP só
// sincronizam manual OU editado (regra central de 27/07). Isso significa
// que, na prática, só existe algo pra apagar na nuvem por causa de uma
// importação em Filiais/Materiais, e em Lançamentos quando um registro
// importado foi editado depois (aí ele foi sincronizado mesmo tendo
// importId). Apagar por import_id nas outras tabelas é inofensivo — hoje
// nunca vai encontrar nada lá, mas já deixa pronto pro dia que Entradas/
// Saídas/Custos SAP ganharem edição inline como Lançamentos já tem.
const _CASCADE_TABELAS_NUVEM = ['filiais', 'materiais', 'lancamentos', 'entradas', 'saidas', 'custos_sap', 'sap'];

function _cascadeDeleteCloudByImportId(importId) {
  if (!importId) return;
  // Escopado ao próprio user_id (ver _supaDeleteOwned, normalize.js) — sem
  // isso, esta cascata apagava por import_id em 7 tabelas SEM NENHUM filtro
  // de dono, e o import_id (gerado por timestamp+random) não é garantia de
  // unicidade entre contas.
  _CASCADE_TABELAS_NUVEM.forEach(table => {
    _supaDeleteOwned(table, { import_id: importId })
      .then(({ error }) => { if (error) console.warn(`[Supabase] Falha ao excluir ${table} da nuvem (cascata):`, error); });
  });
}

// ── Regra de mesclagem dos 5 módulos grandes (Fase 4, 31/07) ────────────
// Estes módulos são híbridos por decisão de 27/07: o volume IMPORTADO fica
// só no navegador (+ backup condensado no Storage) porque não caberia no
// teto de 500 MB do Postgres no plano free; só o que é digitado ou editado
// à mão sobe pro banco.
//
// A mesclagem antiga fundia local ∪ nuvem e reenviava tudo que sobrasse só
// local — o que fazia toda exclusão de registro manual feita pelo painel de
// Supervisão voltar no boot seguinte. Confirmado no activity_log: exclusão
// de `entradas`/`sap` às 00:56, reinserção pelo MESMO usuário às 00:57.
//
// Agora a divisão é por REGISTRO, não por tabela:
//   • tem importId e não foi editado → volume importado, vive só local
//   • qualquer outro (manual, ou importado que foi editado) → o banco manda
// Um registro manual apagado no banco some de vez, como esperado; o volume
// importado nunca é tocado por esta função.
function _mesclarGrandeComBanco(local, remoto) {
  const soLocal = (local || []).filter(r => r.importId && !r.editado);
  return [...soLocal, ...(remoto || [])];
}

// Reforça o backup condensado (cloud-backup.js) dos 5 módulos grandes de
// uma vez — usado depois de excluirImportacao (e seu undo), que pode
// mexer em qualquer um deles. _cbUploadModulo já ignora módulos vazios
// e evita rodar duas vezes em paralelo, então chamar os 5 sempre é
// barato mesmo quando só um mudou de verdade.
// permitirReducao: true — só é chamada a partir de excluirImportacao (e do
// seu undo), onde a queda na contagem é EXATAMENTE o que o usuário pediu.
// Sem isso a guarda de encolhimento do cloud-backup bloquearia o envio e o
// lote excluído voltaria na próxima restauração.
function _cbReforcarBackupModulos() {
  if (typeof _cbUploadModulo !== 'function' || typeof CLOUD_BACKUP_MODULOS === 'undefined') return;
  CLOUD_BACKUP_MODULOS.forEach(modulo => _cbUploadModulo(modulo, { permitirReducao: true }));
}

// snapshots: { filiais, materiais, lancamentos, entradas, saidas, custosSap }
// — arrays do estado local ANTES da exclusão (pra saber o que restaurar).
function _cascadeRestoreCloudByImportId(importId, snapshots) {
  if (!window.supabaseClient || !importId) return;
  const porImport = arr => (arr || []).filter(r => r.importId === importId);
  // Filiais/Materiais: tudo que tinha esse importId sincronizava, restaura tudo.
  if (typeof _filiaisSyncUpsertBatch === 'function') _filiaisSyncUpsertBatch(porImport(snapshots.filiais));
  if (typeof _materiaisSyncUpsertBatch === 'function') _materiaisSyncUpsertBatch(porImport(snapshots.materiais));
  // Lançamentos/Entradas/Saídas/Custos SAP: só o que estava editado é que
  // pode ter ido pra nuvem — restaura só esses (nos 3 últimos, hoje nunca
  // há nada aqui, já que não existe edição inline ainda).
  if (typeof _lancSyncUpsertBatch === 'function') _lancSyncUpsertBatch(porImport(snapshots.lancamentos).filter(r => r.editado));
  if (typeof _entradasSyncUpsertBatch === 'function') _entradasSyncUpsertBatch(porImport(snapshots.entradas).filter(r => r.editado));
  if (typeof _saidasSyncUpsertBatch === 'function') _saidasSyncUpsertBatch(porImport(snapshots.saidas).filter(r => r.editado));
  if (typeof _custosSapSyncUpsertBatch === 'function') _custosSapSyncUpsertBatch(porImport(snapshots.custosSap).filter(r => r.editado));
  if (typeof _sapSyncUpsertBatch === 'function') _sapSyncUpsertBatch(porImport(snapshots.sap).filter(r => r.editado));
}

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
      const snapshotCustosSap   = [...state.custosSap];
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
          state.custosSap   = removeByImport(state.custosSap);
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
          // (Fase 4 — Etapa 3), e a cascata nas tabelas que de fato podem
          // ter algo lá (Fase 4 — Etapa 7).
          if (typeof _importsSyncDelete === 'function') _importsSyncDelete(importId);
          _cascadeDeleteCloudByImportId(importId);
          // Reforça o backup condensado dos 5 módulos grandes na hora
          // (30/07) — sem isso, excluir uma importação inteira só mudava
          // localmente até o próximo reforço periódico (até 3h depois).
          _cbReforcarBackupModulos();
        },
        undo: () => {
          // A exclusão foi revertida — remove a marca para que um fechamento
          // logo em seguida não reaplique a exclusão no próximo boot.
          if (typeof unmarkImportPendingDelete === 'function') unmarkImportPendingDelete(importId);

          state.entradas    = snapshotEntradas;
          state.saidas      = snapshotSaidas;
          state.lancamentos = snapshotLancamentos;
          state.sap         = snapshotSap;
          state.custosSap   = snapshotCustosSap;
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

          // Restaura o registro de log na nuvem também, e a cascata
          // (Fase 4 — Etapa 7).
          if (typeof _importsSyncUpsert === 'function') {
            const importSnap = snapshotImports.find(r => r.id === importId);
            if (importSnap) _importsSyncUpsert(importSnap);
          }
          _cascadeRestoreCloudByImportId(importId, {
            filiais: snapshotFiliais, materiais: snapshotMateriais,
            lancamentos: snapshotLancamentos, entradas: snapshotEntradas,
            saidas: snapshotSaidas, custosSap: snapshotCustosSap,
            sap: snapshotSap,
          });
          _cbReforcarBackupModulos();
        },
      });
    }
  });
}

function excluirCustosSap(absIndex) {
  const filtered = getFilteredData('custosSap');
  const rec = filtered[absIndex];
  if (!rec) return;

  const originalIndex = state.custosSap.indexOf(rec);
  const snapshot = { ...rec };

  confirmarComUndo({
    message: `Custos SAP de "${rec.central}" excluído`,

    action: () => {
      state.custosSap = state.custosSap.filter(r => r !== rec);
      persist();
      renderCustosSap();
      updateDashboard();
      if (rec.id && !rec.importId && typeof _custosSapSyncDelete === 'function') _custosSapSyncDelete(rec.id);
      // Reforça o backup condensado na hora (30/07) — ver removerRegistro
      // (dashboard.js) pro mesmo motivo: sem isso, um registro importado
      // excluído só some localmente até o próximo reforço periódico (até 3h).
      // permitirReducao: a contagem cair é o próprio objetivo da exclusão.
      if (typeof _cbUploadModulo === 'function') _cbUploadModulo('custosSap', { permitirReducao: true });
    },

    undo: () => {
      const insertAt = originalIndex >= 0 && originalIndex <= state.custosSap.length
        ? originalIndex
        : 0;
      state.custosSap.splice(insertAt, 0, snapshot);
      persist();
      renderCustosSap();
      updateDashboard();
      if (typeof _custosSapSyncUpsert === 'function') _custosSapSyncUpsert(snapshot);
      if (typeof _cbUploadModulo === 'function') _cbUploadModulo('custosSap');
    },
  });
}

function _criarRegistroCustosSap(dados) {
  const central = dados.central;
  const material = dados.material;
  const rec = stamp({
    fonte: 'manual',
    materialOriginal: material,
    material: normalizarMaterial(material),
    centralOriginal: central,
    central: normalizarCentral(central),
    ano: dados.ano,
    mes: dados.mes,
    estoqueTotal: num(dados.estoqueTotal),
    valorTotal: num(dados.valorTotal),
    custo: num(dados.custo)
  });

  if (!rec.material || !rec.central || !rec.ano || !rec.mes) return { ok: false, erro: 'Preencha material, central, ano e mês' };

  // Aviso de duplicata — mesmo padrão de Lançamentos/Entradas.
  if (typeof _fpCustosSap === 'function') {
    const fpNovo = _fpCustosSap(rec);
    const jaExiste = (state.custosSap || []).some(r => _fpCustosSap(r) === fpNovo);
    if (jaExiste && !confirm('Já existe um registro de Custos SAP para este material/central neste período. Deseja criar mesmo assim?')) {
      return { ok: false, erro: 'Criação cancelada — registro duplicado' };
    }
  }

  state.custosSap.unshift(rec);
  persist();
  if (typeof _custosSapSyncUpsert === 'function') _custosSapSyncUpsert(rec);
  return { ok: true, rec };
}

function salvarCustosSap() {
  const resultado = _criarRegistroCustosSap({
    material:     val('cs-material'),
    central:      val('cs-central'),
    ano:          val('cs-ano'),
    mes:          val('cs-mes'),
    estoqueTotal: val('cs-estoque-total'),
    valorTotal:   val('cs-valor-total'),
    custo:        val('cs-custo'),
  });
  if (!resultado.ok) { toast(resultado.erro, 'error'); return; }
  closeModal('modal-custos-sap');
  renderCustosSap();
  updateDashboard();
  toast('Registro de Custos SAP adicionado com sucesso');
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

  // Aviso de duplicata — mesmo padrão de Lançamentos, não bloqueia.
  if (typeof _fpEntrada === 'function') {
    const fpNovo = _fpEntrada(rec);
    const jaExiste = (state.entradas || []).some(r => _fpEntrada(r) === fpNovo);
    if (jaExiste && !confirm('Já existe uma entrada idêntica (mesma central, material, NF, data e peso). Deseja criar mesmo assim?')) {
      return { ok: false, erro: 'Criação cancelada — entrada duplicada' };
    }
  }

  state.entradas.unshift(rec);
  invalidateSearchIndex('entradas');
  persist();
  if (typeof _entradasSyncUpsert === 'function') _entradasSyncUpsert(rec);
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

  // Aviso de duplicata — mesmo padrão de Lançamentos/Entradas/Custos SAP.
  if (typeof _fpSaida === 'function') {
    const fpNovo = _fpSaida(rec);
    const jaExiste = (state.saidas || []).some(r => _fpSaida(r) === fpNovo);
    if (jaExiste && !confirm('Já existe uma saída idêntica (mesma central, material, OS, data e peso). Deseja criar mesmo assim?')) {
      return { ok: false, erro: 'Criação cancelada — saída duplicada' };
    }
  }

  state.saidas.unshift(rec);
  invalidateSearchIndex('saidas');
  persist();
  if (typeof _saidasSyncUpsert === 'function') _saidasSyncUpsert(rec);
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

  // Aviso de duplicata (não bloqueia — duplicata legítima é permitida por
  // design, ex.: dois eventos reais na mesma central/material/data). Só
  // avisa quando a chave completa (com peso) já existe, pra pegar
  // duplo-clique ou "esqueci que já lancei isso" antes de acontecer.
  if (typeof _fpLancamento === 'function') {
    const fpNovo = _fpLancamento(rec);
    const jaExiste = (state.lancamentos || []).some(r => _fpLancamento(r) === fpNovo);
    if (jaExiste && !confirm('Já existe um lançamento idêntico (mesma central, material, data e peso). Deseja criar mesmo assim?')) {
      return { ok: false, erro: 'Criação cancelada — lançamento duplicado' };
    }
  }

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
    editado: !!r.editado,
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
    editado: !!row.editado,
  };
}

// Upsert de um único lançamento — manual/Assistente OU editado inline
// (fonte='manual', OU sem importId, OU com editado=true). Decisão de
// 27/07 (revisada): pra Entradas/Saídas/Lançamentos/SAP/Custos SAP, a nuvem
// guarda o que é digitado ou editado direto no sistema — importação em
// lote em si fica só local (o arquivo original já é a cópia de
// segurança). Mas uma EDIÇÃO feita depois, mesmo num registro importado,
// é uma ação manual e deliberada — precisa sincronizar. A guarda,
// portanto, é: bloqueia só se for importado E NUNCA editado.
function _lancSyncUpsert(rec) {
  if ((rec.importId && !rec.editado) || !window.supabaseClient) return;
  window.supabaseClient.from('lancamentos').upsert(_lancToDbRow(rec))
    .then(({ error }) => {
      if (error) {
        console.warn('[Supabase] Falha ao sincronizar lançamento:', error);
        toast('⚠ Lançamento salvo nesta sessão, mas não foi possível sincronizar com a nuvem.', 'error');
      }
    });
}

// Upsert em lote — usado só na sincronização inicial de registros manuais
// pré-existentes que ainda não subiram (ver syncLancamentosFromSupabase).
// NÃO é mais chamada durante importação em lote (ver decisão acima).
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
    const data = await fetchMineOrIntegrated('lancamentos');
    const remoto = (data || []).map(_lancFromDbRow);
    const local = Array.isArray(state.lancamentos) ? state.lancamentos : [];
    state.lancamentos = _mesclarGrandeComBanco(local, remoto);
    if (typeof invalidateLancIndex === 'function') invalidateLancIndex();
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

// Busca no boot — O BANCO MANDA (30/07). Antes isto fundia local ∪ nuvem e
// reenviava o que sobrasse só local ("Corte de produção 27/07"), o que
// transformava toda exclusão feita pelo painel de Supervisão em ida e volta:
// o registro era apagado no banco e o próprio navegador do supervisor o
// reenviava no boot seguinte. Confirmado no activity_log: 134 exclusões às
// 00:11, 128 delas de volta às 00:12, mesmo usuário.
// Agora a nuvem substitui o local; um erro de busca preserva o local
// (ver dado velho é aceitável, tela vazia por falha de rede não é).
async function syncImportsFromSupabase() {
  if (!window.supabaseClient) return;
  try {
    const data = await fetchMineOrIntegrated('imports');
    // Chegar aqui já significa busca COMPLETA e bem-sucedida: fetchAllRows
    // lança em qualquer erro de página. Só sob essa garantia o banco pode
    // substituir o local — num erro, o catch abaixo preserva o que já tem.
    const remoto = (data || []).map(_importsFromDbRow);

    // 'Processando' é estado transitório que de propósito nunca sobe pro
    // banco. Substituir cru faria a importação em andamento sumir da tela
    // no meio do processo.
    const local = Array.isArray(state.imports) ? state.imports : [];
    const emAndamento = local.filter(r => r.status === 'Processando');

    state.imports = [...emAndamento, ...remoto]
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } catch (err) {
    console.warn('[Supabase] Falha ao buscar log de importações — mantendo dados locais.', err);
  }
}

// ═══════════════════════════════════════════════════════════
// CUSTOS SAP — sincronização com o Supabase (Fase 4 — Etapa 4)
// ═══════════════════════════════════════════════════════════
// Já tem id estável desde a fundação da Etapa 1 (stamp() em normalize.js
// cobre os 5 módulos grandes). Cobre: criação manual/Assistente
// (_criarRegistroCustosSap), importação em lote (hook em
// processImportedRows, dashboard.js), exclusão individual com undo
// (excluirCustosSap) e resolução de conflito manual-vs-importado
// (_resolveConflicts, dashboard.js — Custos SAP já participava desse fluxo).
// Mesmo gap conhecido: excluirImportacao ainda não apaga da nuvem (Etapa 7).

function _custosSapToDbRow(r) {
  return {
    id: r.id,
    fonte: r.fonte || null,
    material_original: r.materialOriginal || null,
    material: r.material || null,
    central_original: r.centralOriginal || null,
    central: r.central || null,
    ano: r.ano || null,
    mes: r.mes || null,
    estoque_total: r.estoqueTotal ?? null,
    valor_total: r.valorTotal ?? null,
    custo: r.custo ?? null,
    import_id: r.importId || null,
    created_at: r.createdAt || null,
  };
}

function _custosSapFromDbRow(row) {
  return {
    id: row.id,
    fonte: row.fonte,
    materialOriginal: row.material_original,
    material: row.material,
    centralOriginal: row.central_original,
    central: row.central,
    ano: row.ano,
    mes: row.mes,
    estoqueTotal: row.estoque_total,
    valorTotal: row.valor_total,
    custo: row.custo,
    importId: row.import_id || undefined,
    createdAt: row.created_at,
  };
}

// Decisão de 27/07: mesma regra de Lançamentos — só sincroniza manual.
function _custosSapSyncUpsert(rec) {
  if (rec.importId || !window.supabaseClient) return;
  window.supabaseClient.from('custos_sap').upsert(_custosSapToDbRow(rec))
    .then(({ error }) => { if (error) console.warn('[Supabase] Falha ao sincronizar Custos SAP:', error); });
}

const CUSTOS_SAP_SYNC_BATCH_SIZE = 500;
async function _custosSapSyncUpsertBatch(records) {
  if (!window.supabaseClient || !records || !records.length) return;
  const rows = records.map(_custosSapToDbRow);
  for (let i = 0; i < rows.length; i += CUSTOS_SAP_SYNC_BATCH_SIZE) {
    const { error } = await window.supabaseClient.from('custos_sap').upsert(rows.slice(i, i + CUSTOS_SAP_SYNC_BATCH_SIZE));
    if (error) { console.warn('[Supabase] Falha ao sincronizar lote de Custos SAP:', error); break; }
  }
}

function _custosSapSyncDelete(id) {
  if (!window.supabaseClient || !id) return;
  window.supabaseClient.from('custos_sap').delete().eq('id', id)
    .then(({ error }) => { if (error) console.warn('[Supabase] Falha ao excluir Custos SAP na nuvem:', error); });
}

async function syncCustosSapFromSupabase() {
  if (!window.supabaseClient) return;
  try {
    const data = await fetchMineOrIntegrated('custos_sap');
    const remoto = (data || []).map(_custosSapFromDbRow);
    const local = Array.isArray(state.custosSap) ? state.custosSap : [];
    state.custosSap = _mesclarGrandeComBanco(local, remoto);
  } catch (err) {
    console.warn('[Supabase] Falha ao buscar Custos SAP — mantendo dados locais.', err);
  }
}

// ═══════════════════════════════════════════════════════════
// ENTRADAS — sincronização com o Supabase (Fase 4 — Etapa 5)
// ═══════════════════════════════════════════════════════════
// Primeiro módulo com volume real de dados (NFs de compra, não cadastro
// esparso). Mesmo padrão: já tem id estável (fundação da Etapa 1). Cobre:
// criação manual/Assistente, importação em lote, exclusão individual
// (removerRegistro, dashboard.js) e resolução de conflito manual-vs-
// importado (_resolveConflicts, dashboard.js).

function _entradasToDbRow(r) {
  return {
    id: r.id,
    fonte: r.fonte || null,
    central_compra_original: r.centralCompraOriginal || null,
    central_compra: r.centralCompra || null,
    central_destino_original: r.centralDestinoOriginal || null,
    central_destino: r.centralDestino || null,
    nf: r.nf || null,
    dt_emissao: r.dtEmissao || null,
    dt_descarga: r.dtDescarga || null,
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

function _entradasFromDbRow(row) {
  return {
    id: row.id,
    fonte: row.fonte,
    centralCompraOriginal: row.central_compra_original,
    centralCompra: row.central_compra,
    centralDestinoOriginal: row.central_destino_original,
    centralDestino: row.central_destino,
    nf: row.nf,
    dtEmissao: row.dt_emissao,
    dtDescarga: row.dt_descarga,
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

// Decisão de 27/07: mesma regra de Lançamentos — só sincroniza manual.
function _entradasSyncUpsert(rec) {
  if (rec.importId || !window.supabaseClient) return;
  window.supabaseClient.from('entradas').upsert(_entradasToDbRow(rec))
    .then(({ error }) => { if (error) console.warn('[Supabase] Falha ao sincronizar entrada:', error); });
}

const ENTRADAS_SYNC_BATCH_SIZE = 500;
async function _entradasSyncUpsertBatch(records) {
  if (!window.supabaseClient || !records || !records.length) return;
  const rows = records.map(_entradasToDbRow);
  for (let i = 0; i < rows.length; i += ENTRADAS_SYNC_BATCH_SIZE) {
    const { error } = await window.supabaseClient.from('entradas').upsert(rows.slice(i, i + ENTRADAS_SYNC_BATCH_SIZE));
    if (error) { console.warn('[Supabase] Falha ao sincronizar lote de entradas:', error); break; }
  }
}

function _entradasSyncDelete(id) {
  if (!window.supabaseClient || !id) return;
  window.supabaseClient.from('entradas').delete().eq('id', id)
    .then(({ error }) => { if (error) console.warn('[Supabase] Falha ao excluir entrada na nuvem:', error); });
}

async function syncEntradasFromSupabase() {
  if (!window.supabaseClient) return;
  try {
    const data = await fetchMineOrIntegrated('entradas');
    const remoto = (data || []).map(_entradasFromDbRow);
    const local = Array.isArray(state.entradas) ? state.entradas : [];
    state.entradas = _mesclarGrandeComBanco(local, remoto);
    if (typeof invalidateSearchIndex === 'function') invalidateSearchIndex('entradas');
  } catch (err) {
    console.warn('[Supabase] Falha ao buscar entradas — mantendo dados locais.', err);
  }
}

// ═══════════════════════════════════════════════════════════
// SAÍDAS — sincronização com o Supabase (Fase 4 — Etapa 6)
// ═══════════════════════════════════════════════════════════
// Mesmo padrão de Entradas/Custos SAP: só manual (regra central de 27/07),
// sem edição inline ainda (se for adicionada no futuro, replicar o
// tratamento de `editado` que Lançamentos já tem).

function _saidasToDbRow(r) {
  return {
    id: r.id,
    fonte: r.fonte || null,
    central_original: r.centralOriginal || null,
    central: r.central || null,
    dt_emissao: r.dtEmissao || null,
    os: r.os || null,
    contrato: r.contrato || null,
    categoria_original: r.categoriaOriginal || null,
    categoria: r.categoria || null,
    fornecedor: r.fornecedor || null,
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

function _saidasFromDbRow(row) {
  return {
    id: row.id,
    fonte: row.fonte,
    centralOriginal: row.central_original,
    central: row.central,
    dtEmissao: row.dt_emissao,
    os: row.os,
    contrato: row.contrato,
    categoriaOriginal: row.categoria_original,
    categoria: row.categoria,
    fornecedor: row.fornecedor,
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

function _saidasSyncUpsert(rec) {
  if (rec.importId || !window.supabaseClient) return;
  window.supabaseClient.from('saidas').upsert(_saidasToDbRow(rec))
    .then(({ error }) => { if (error) console.warn('[Supabase] Falha ao sincronizar saída:', error); });
}

const SAIDAS_SYNC_BATCH_SIZE = 500;
async function _saidasSyncUpsertBatch(records) {
  if (!window.supabaseClient || !records || !records.length) return;
  const rows = records.map(_saidasToDbRow);
  for (let i = 0; i < rows.length; i += SAIDAS_SYNC_BATCH_SIZE) {
    const { error } = await window.supabaseClient.from('saidas').upsert(rows.slice(i, i + SAIDAS_SYNC_BATCH_SIZE));
    if (error) { console.warn('[Supabase] Falha ao sincronizar lote de saídas:', error); break; }
  }
}

function _saidasSyncDelete(id) {
  if (!window.supabaseClient || !id) return;
  window.supabaseClient.from('saidas').delete().eq('id', id)
    .then(({ error }) => { if (error) console.warn('[Supabase] Falha ao excluir saída na nuvem:', error); });
}

async function syncSaidasFromSupabase() {
  if (!window.supabaseClient) return;
  try {
    const data = await fetchMineOrIntegrated('saidas');
    const remoto = (data || []).map(_saidasFromDbRow);
    const local = Array.isArray(state.saidas) ? state.saidas : [];
    state.saidas = _mesclarGrandeComBanco(local, remoto);
    if (typeof invalidateSaidasIndex === 'function') invalidateSaidasIndex();
  } catch (err) {
    console.warn('[Supabase] Falha ao buscar saídas — mantendo dados locais.', err);
  }
}


// ═══════════════════════════════════════════════════════════
// SAP — sincronização com o Supabase (Fase 4 — Etapa 8)
// ═══════════════════════════════════════════════════════════
// Último dos 5 módulos grandes. Mesmo padrão de Entradas/Custos SAP/Saídas:
// só manual (regra central de 27/07), sem edição inline (se for adicionada
// no futuro, replicar o tratamento de `editado` que Lançamentos já tem).
// Importação em lote (handleImport → buildSapColumnMap) permanece só local,
// nunca chama as funções abaixo — chunking local (compactSapRecords,
// persist.js) continua como está, sem relação com a nuvem.

function _sapToDbRow(r) {
  return {
    id: r.id,
    fonte: r.fonte || null,
    usuario: r.usuario || null,
    movimento: r.movimento || null,
    ref: r.ref || null,
    documento: r.documento || null,
    central_original: r.centralOriginal || null,
    central: r.central || null,
    deposito: r.deposito || null,
    dt_doc: r.dtDoc || null,
    dt_lanc: r.dtLanc || null,
    dt_reg: r.dtReg || null,
    material_original: r.materialOriginal || null,
    material: r.material || null,
    peso: r.peso ?? null,
    um: r.um || null,
    custo_unit: r.custoUnit ?? null,
    valor_total: r.valorTotal ?? null,
    import_id: r.importId || null,
    created_at: r.createdAt || null,
  };
}

function _sapFromDbRow(row) {
  return {
    id: row.id,
    fonte: row.fonte,
    usuario: row.usuario,
    movimento: row.movimento,
    ref: row.ref,
    documento: row.documento,
    centralOriginal: row.central_original,
    central: row.central,
    deposito: row.deposito,
    dtDoc: row.dt_doc,
    dtLanc: row.dt_lanc,
    dtReg: row.dt_reg,
    materialOriginal: row.material_original,
    material: row.material,
    peso: row.peso,
    um: row.um,
    custoUnit: row.custo_unit,
    valorTotal: row.valor_total,
    importId: row.import_id || undefined,
    createdAt: row.created_at,
  };
}

function _sapSyncUpsert(rec) {
  if (rec.importId || !window.supabaseClient) return;
  window.supabaseClient.from('sap').upsert(_sapToDbRow(rec))
    .then(({ error }) => { if (error) console.warn('[Supabase] Falha ao sincronizar movimentação SAP:', error); });
}

const SAP_SYNC_BATCH_SIZE = 500;
async function _sapSyncUpsertBatch(records) {
  if (!window.supabaseClient || !records || !records.length) return;
  const rows = records.map(_sapToDbRow);
  for (let i = 0; i < rows.length; i += SAP_SYNC_BATCH_SIZE) {
    const { error } = await window.supabaseClient.from('sap').upsert(rows.slice(i, i + SAP_SYNC_BATCH_SIZE));
    if (error) { console.warn('[Supabase] Falha ao sincronizar lote de SAP:', error); break; }
  }
}

function _sapSyncDelete(id) {
  if (!window.supabaseClient || !id) return;
  window.supabaseClient.from('sap').delete().eq('id', id)
    .then(({ error }) => { if (error) console.warn('[Supabase] Falha ao excluir movimentação SAP na nuvem:', error); });
}

async function syncSAPFromSupabase() {
  if (!window.supabaseClient) return;
  try {
    const data = await fetchMineOrIntegrated('sap');
    const remoto = (data || []).map(_sapFromDbRow);
    const local = Array.isArray(state.sap) ? state.sap : [];
    state.sap = _mesclarGrandeComBanco(local, remoto);
    if (typeof invalidateSapIndex === 'function') invalidateSapIndex();
  } catch (err) {
    console.warn('[Supabase] Falha ao buscar movimentações SAP — mantendo dados locais.', err);
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
  if (typeof _sapSyncUpsert === 'function') _sapSyncUpsert(rec);
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
