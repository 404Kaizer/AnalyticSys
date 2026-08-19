# Graph Report - AnalyticSys  (2026-08-19)

## Corpus Check
- 56 files · ~327,909 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2248 nodes · 4609 edges · 122 communities (113 shown, 9 thin omitted)
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 540 edges (avg confidence: 0.56)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `13497c34`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- admin.js
- ocorrencias.js
- assistente.js
- ui.js
- dashboard.js
- trend.js
- config.js
- inventario.js
- notifications.js
- dai.js
- agregados.js
- mensagens.js
- format.js
- normalize.js
- auth.js
- state.js
- analitico.js
- import.js
- ncd.js
- relatorio.js
- _fechMgrRender
- renderDgVisaoGeralPdf
- renderModule
- persist.js
- getFilteredData
- notesRender
- renderDgConsumo
- lrcDelete
- cloud-backup.js
- fechRenderFromForm
- renderAusencias
- macro.js
- escR
- _pimRender
- solicitacao.js
- clearAllMicroFilters
- parseDate
- somarPesoCustoSap
- _buildOcHierarquiaBar
- renderAnaliticoMicro
- capacidades.js
- buildCards
- renderModuleByName
- renderOcorrencias
- _dgmLinhaHtml
- _fechMgrGetTodosCandidatos
- help-badges.js
- varSymbol
- toast
- populateOcFiltros
- buildHealthPanel
- _setModalCadastroModo
- toggleAllCentralis
- ocorrencias-supervisor.test.mjs
- lookup.js
- escapeHtml
- wipe-local.test.mjs
- shortcutRemapSave
- period-fab.js
- notif-supervisor.test.mjs
- relatorio-dais.test.mjs
- openModal
- openTool
- applyTheme
- cloud-backup.test.mjs
- dai-anexos-storage.test.mjs
- dai-sync-admin.test.mjs
- nome-token-ids.test.mjs
- renderOcKPIs
- autoria-notificacoes.test.mjs
- criador-nome.test.mjs
- integracao-local.test.mjs
- oc-donut-kpis.test.mjs
- rodarAnalitico
- handleSearchModal
- _getModuleTextFilteredData
- toggleThemeSwitcher
- Cloudflare Turnstile (CAPTCHA / Bot Protection Widget)
- vercel.json
- Shared 'Add Manual Record' Modal (modal-manual)
- Entradas (NF) Page
- Lançamentos Page
- Saídas (OS) Page
- SAP Page
- Categoria de Situação Select
- Termo de Responsabilidade Step (sign + attach)
- init
- normalizeSearchKey
- Q: Why does CLOUD_BACKUP_MODULOS connect Cloud Backup Module to Admin Panel, Dashboard Conflict Detection, Dashboard Rendering & Cleanup, Import Deletion & Backup Sync?
- _ocRealtimeInit
- _ocCloseMicroFilterDropdown
- updateImportPrereqUI
- sap-861862-dup.test.mjs
- oc-card-menu.test.mjs
- calendar.js
- giro-por-central-material.test.mjs
- _supaDeleteOwned
- calendar-oc.test.mjs
- processImportedRows
- aus-fim-de-mes.test.mjs
- sap-fechamento-override.test.mjs
- _buildRankingShellHTML
- _setBtnLoading
- toggleMicroFilter
- handleFiliaisImport
- salvarNovoGrupoMaterial
- getCodigosSapDisponiveis
- _configEhChaveSaude
- salvarNovoRegionalCentral
- _checarNovosParaImportar
- _adminEsc
- _mesclarGrandeComBanco
- AGENTS.md
- excluirImportacao
- _rankEsc
- relatorio-giro-usina.test.mjs
- adminLoadModulo
- _custosSapSyncUpsert
- _adminAtualizarBarraLote
- _buildCentralOptionsHtml
- _custosSapFromDbRow

## God Nodes (most connected - your core abstractions)
1. `renderDgVisaoGeralPdf()` - 31 edges
2. `adminLoadModulo()` - 25 edges
3. `_adminEsc()` - 22 edges
4. `_fechMgrRender()` - 22 edges
5. `_adminErroDetalhe()` - 20 edges
6. `renderOcorrencias()` - 20 edges
7. `escapeHtml()` - 20 edges
8. `renderModule()` - 18 edges
9. `renderCapacidades()` - 18 edges
10. `_rankEsc()` - 16 edges

## Surprising Connections (you probably didn't know these)
- `safeJSONParse()` --indirect_call--> `error()`  [INFERRED]
  js/state.js → tests/calendar-oc.test.mjs
- `Admin — Formulário Público Section (public link + analyst/category routing)` --shares_data_with--> `solicitacao.html — Public Stock Movement Request Form`  [INFERRED]
  index.html → solicitacao.html
- `renderModuleByName()` --indirect_call--> `renderEntradas()`  [INFERRED]
  js/ui.js → js/dashboard.js
- `renderModuleByName()` --indirect_call--> `renderSaidas()`  [INFERRED]
  js/ui.js → js/dashboard.js
- `renderModuleByName()` --indirect_call--> `renderLancamentos()`  [INFERRED]
  js/ui.js → js/dashboard.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Entradas/Saídas/Lançamentos/SAP pages share the generic Add-Record modal, sort and pagination functions** — index_page_entradas, index_page_saidas, index_page_lancamentos, index_page_sap, index_modal_manual [INFERRED 0.85]
- **Calculadora/Notas/Assistente/Mensagens all implement the same generic tool-popover open/close pattern (openTool/closeTool, .tool-popover)** — index_calc_popover, index_notes_popover, index_assistente_popover, index_mensagens_popover [EXTRACTED 1.00]
- **DAI generation, Ocorrências, and the public-form/admin routing jointly form the inventory-adjustment reporting flow** — index_dai_modal, index_ocorrencias_page, index_admin_formpublico, solicitacao [INFERRED 0.75]

## Communities (122 total, 9 thin omitted)

### Community 0 - "admin.js"
Cohesion: 0.08
Nodes (33): _ADMIN_COL_TYPES, ADMIN_MODAL_PROPRIO, ADMIN_MODULOS, adminAceitarPendente(), adminAceitarTodosPendentes(), _adminAuthInfo, _adminCategoriasFormPublico(), _adminCurrentRows (+25 more)

### Community 1 - "ocorrencias.js"
Cohesion: 0.11
Nodes (19): applyPhoneMask(), closeOcorrenciaModal(), fmtPhoneDisplay(), getOcorrencias(), initPhoneMasks(), _nextOcId(), OC_DONUT_META, _OC_FILTER_KEY_LABELS (+11 more)

### Community 2 - "assistente.js"
Cohesion: 0.06
Nodes (84): _ASST_DIM_LABEL, _ASST_DIM_LABEL_SING, _ASST_INTENTS, _ASST_MANUAL_FORMS, _ASST_MANUAL_REFRESH, _ASST_MESES, _ASST_METRICA_LABEL, _ASST_MODULOS (+76 more)

### Community 3 - "ui.js"
Cohesion: 0.03
Nodes (53): abrirModalBackup(), analiticoDetailState, _BKP_BIG_KEYS, _BKP_MODULES, _bkpCarregarArquivo(), bkpHandleDrop(), _bkpParseStreaming(), bkpSelectAll() (+45 more)

### Community 4 - "dashboard.js"
Cohesion: 0.04
Nodes (45): abrirSemCadastroModuloModal(), _ausCollapsed, _ausFilter, buildEntradaColumnMap(), buildLancamentoColumnMap(), buildSaidaColumnMap(), buildSapColumnMap(), CODIGOS_SAIDA (+37 more)

### Community 5 - "trend.js"
Cohesion: 0.07
Nodes (62): openTrendModal(), SERIES_COLORS, _T, _tApplyCenFilter(), _tApplyMatFilter(), _tBuildCustoMedio(), _tBuildWeeks(), _tCmpTooltipShow() (+54 more)

### Community 6 - "config.js"
Cohesion: 0.07
Nodes (13): abrirModalAcaoRelatorio(), _codigosSapSessionExtras, editarAcaoRelatorio(), editConfig(), _filiaisNovosItens, focusFilialImport(), focusMaterialImport(), _IMPORTAR_DE_CFG (+5 more)

### Community 7 - "inventario.js"
Cohesion: 0.06
Nodes (47): Ocorrências 'Ordenar' Micro-filter (31/07), fmt(), fmtR(), _invApplyJustValues(), invAtualizarAlertas(), invAtualizarKpis(), _invAtualizarPeriodoFechado(), _invAtualizarProgresso() (+39 more)

### Community 8 - "notifications.js"
Cohesion: 0.06
Nodes (62): RECORD_INTEGRATION_TABLES, _ACTIVITY_AUTH_LABEL, _ACTIVITY_EXTRA_COLS, _ACTIVITY_MODULE_COLOR, _ACTIVITY_OP_LABEL, _ACTIVITY_VERB, _activityBatchData, _activityBatchTimers (+54 more)

### Community 9 - "dai.js"
Cohesion: 0.08
Nodes (54): DAI Generator Modal (Documento de Ajuste de Inventário), Ocorrências Page, abrirModalDai(), adicionarAnexoDaiExistente(), baixarZipDai(), _daiActionBarCss(), _daiAddInformanteRow(), _daiAddItemRow() (+46 more)

### Community 10 - "agregados.js"
Cohesion: 0.08
Nodes (52): agrApplyFilters(), _agrBuildResumo(), agrClearDropdown(), agrClearFilters(), agrCloseDropdown(), _agrCompute(), _agrCutoffDate(), _agrDateKey() (+44 more)

### Community 11 - "mensagens.js"
Cohesion: 0.06
Nodes (61): .serena/project.yml — Serena Project Config, AnalyticSys (Product — Estoque · Insumos System), index.html — AnalyticSys Main App Shell (SPA), Admin — Formulário Público Section (public link + analyst/category routing), Admin / Supervisão Page, Assistente (Chat Assistant) Popover, Backup / Restaurar por Módulos Modal, Calculadora Popover (Basic + Stock-Analytic tabs) (+53 more)

### Community 12 - "format.js"
Cohesion: 0.05
Nodes (36): _calc, calcAction(), _calcCompute(), _calcFmt(), _calcUpdateDisplay(), closeSearchModal(), _COLOR_MAP, _fechConfig (+28 more)

### Community 13 - "normalize.js"
Cohesion: 0.07
Nodes (52): buildCustosSapIndex(), buildFilialLookupIndex(), buildMaterialLookupIndex(), _carregarNomesOriginais(), CATEGORIA_MODULOS, CATEGORIAS_MATERIAL, CENTRAL_FIELDS_BY_MODULO, checarWipePendente() (+44 more)

### Community 14 - "auth.js"
Cohesion: 0.10
Nodes (38): Auth Gate — Login / Password Recovery Screen (Fase 1), Idle / Inactivity Auto-Logout Warning (Fase 1), _accountModalSalvar(), _accountModalTrocarSenha(), _accountRenderAvatars(), AVATAR_EXT_POR_MIME, bootApp(), _bootAppRun() (+30 more)

### Community 15 - "state.js"
Cohesion: 0.09
Nodes (15): bulkSelected, domCache, filters, getSavedTheme(), listFilters, listPages, mergePersistentConfigs(), moduleMap (+7 more)

### Community 16 - "analitico.js"
Cohesion: 0.06
Nodes (28): _anStockCache, _capFilter, _capFilterChange(), _closeBdPortal(), _ensureBdPortal(), _gsHighlight(), handleGlobalSearch(), _microFilter (+20 more)

### Community 17 - "import.js"
Cohesion: 0.10
Nodes (25): _CASCADE_TABELAS_NUVEM, _cascadeRestoreCloudByImportId(), _criarRegistroEntrada(), _criarRegistroLancamento(), _criarRegistroSaida(), _criarRegistroSAP(), _entradasSyncUpsert(), _entradasSyncUpsertBatch() (+17 more)

### Community 18 - "ncd.js"
Cohesion: 0.13
Nodes (30): NCD_COR, NCD_SAP_CODIGOS, ncdAbrirModal(), _ncdAplicarCnpj(), _ncdCodigoMap, _ncdCodigoMaterial(), _ncdColetarGrupos(), _ncdCpfValido() (+22 more)

### Community 19 - "relatorio.js"
Cohesion: 0.07
Nodes (11): _DGM_NIVEL_ICONE, _dgmMesesOrdenados(), _dgmMesKey(), _dgmMesLabel(), _dgmRenderPicker(), _dgmState, _dgrCanvasParaPngDataUrl(), _dgrCapturarCategoriaAmpliada() (+3 more)

### Community 20 - "_fechMgrRender"
Cohesion: 0.09
Nodes (30): abrirFechManager(), fecharFechImportModal(), fecharFechManager(), _fechImportAplicar(), _fechInvUnlockRealtimeInit(), _fechMgrAplicarDesbloqueio(), _fechMgrAplicarFiltros(), _fechMgrAplicarLote() (+22 more)

### Community 21 - "renderDgVisaoGeralPdf"
Cohesion: 0.08
Nodes (34): _daBuildEntradasFlat(), _daBuildRanking(), _daBuildTabelaMaterial(), _daPesoMedioPorTipo(), _daRenderDetalhadoAnalitico(), _daVarIrrelevante(), DG_VG_CAT_ORDER, _dgVgAggKgPorChave() (+26 more)

### Community 22 - "renderModule"
Cohesion: 0.10
Nodes (35): atualizarBarraLote(), _custosSapOutlierInfo(), _custosSapResolveMaterial(), _donoDisplay(), excluirSelecionados(), getGrupoSapPorCodigoIndex(), getMateriaisSemCadastroDoModulo(), initAusencias() (+27 more)

### Community 23 - "persist.js"
Cohesion: 0.18
Nodes (19): applySavedState(), buildStateSnapshot(), compactSapRecords(), daiAnexoKey(), flushPersistQueue(), idbDeleteAnexosDai(), idbGet(), idbGetAnexoDai() (+11 more)

### Community 24 - "getFilteredData"
Cohesion: 0.11
Nodes (25): _applyModuleSort(), _colFilterFieldValue(), filtrarLista(), getColUniqueValues(), getFilteredData(), getListFilteredData(), getListPageData(), _getScopeTextFilteredData() (+17 more)

### Community 25 - "notesRender"
Cohesion: 0.16
Nodes (22): notesAutoSave(), notesCloseEditor(), notesDeleteCard(), notesDeleteCurrent(), notesEditorUpdate(), notesExec(), _notesFromDbRow(), notesInsertChecklist() (+14 more)

### Community 26 - "renderDgConsumo"
Cohesion: 0.16
Nodes (18): _dcBuildRankingCentrais(), _dcBuildRankingMateriais(), _dcCalcGiroCoberturaGeral(), _dcRenderChartRanking(), _dcRenderKpiStrip(), _dgDeltaBadgeHtml(), _dgRankCardHtml(), _dgResolveCssColor() (+10 more)

### Community 27 - "lrcDelete"
Cohesion: 0.13
Nodes (20): bkpConfirmar(), closeLancConflictModal(), _exportarModulos(), _invalidateLancDupCache(), invalidateLancIndex(), _invalidateMatTransferPairCache(), invalidateSaidasIndex(), _invalidateSapDupCache() (+12 more)

### Community 28 - "cloud-backup.js"
Cohesion: 0.18
Nodes (21): Admin Health — Storage Tab (28/07), adminConfirmarExclusaoMassa(), _adminExecutarExclusaoMassa(), _cbBackupTodosModulos(), _cbGuardarGeracaoAnterior(), _cbGunzipBlob(), _cbGzipString(), _cbLastBackupAt (+13 more)

### Community 29 - "fechRenderFromForm"
Cohesion: 0.15
Nodes (19): fechAddAlert(), fechAddItem(), fechamentoResetarTexto(), _fechDefaultFields(), _fechGetFields(), _fechLastWeekday(), _fechLastWorkdayOfMonth(), _fechLoadAllSaved() (+11 more)

### Community 30 - "renderAusencias"
Cohesion: 0.15
Nodes (20): applyAusFilter(), ausCollapseAll(), _ausDateStr(), ausExpandAll(), _ausFilterBuildOptions(), _ausFilterSyncClear(), _ausFilterSyncLabel(), ausToggleAllCentralis() (+12 more)

### Community 31 - "macro.js"
Cohesion: 0.19
Nodes (16): _calcTrend(), _getTip(), _hideTip(), _levelColor, _levelFromScore(), _levelLabel, _levelSev, macroApplyFilter() (+8 more)

### Community 32 - "escR"
Cohesion: 0.18
Nodes (17): buildCentralRow(), buildCentralSection(), buildDaiRow(), buildMotivoRow(), buildOcorrenciaRow(), buildRegionalRow(), buildRegionalSection(), buildStatusBadge() (+9 more)

### Community 33 - "_pimRender"
Cohesion: 0.14
Nodes (18): _buildSapIndex(), getSapByCentralInPeriod(), getSapIndex(), _nfNeedsConversionWarning(), openPendIntegGlobalModal(), openPendIntegModal(), _pimApplyFilters(), _pimGetSapCache() (+10 more)

### Community 34 - "solicitacao.js"
Cohesion: 0.08
Nodes (54): adicionarAnexos(), adicionarInformante(), adicionarItemMaterial(), _anexos, _atualizarVariacao(), avancarStep(), boot(), _calcVariacaoBalanca() (+46 more)

### Community 35 - "clearAllMicroFilters"
Cohesion: 0.18
Nodes (23): applyMicroFilter(), _applyMicroVisibility(), cancelMicroFilter(), _capFilterIsActive(), _cardCapFaixas(), _cardPassesCapFilter(), clearAllMicroFilters(), clearMicroFilter() (+15 more)

### Community 36 - "parseDate"
Cohesion: 0.11
Nodes (22): _ausComputar(), _ausContextoMaterial(), _ausEnsureEntSaiIdx(), _ausInvalidateCache(), _ausInvalidateEntSaiIdx(), ausQuickOntem(), ausQuickTercaAnterior(), _ausUltimoDiaUtilMes() (+14 more)

### Community 37 - "somarPesoCustoSap"
Cohesion: 0.18
Nodes (18): _abrirModalDetalheMaterial(), _abrirModalDetalheMaterialFromEl(), _agruparRegistros(), _bdmFechExcluidosHtml(), _buildResumoCardsHtml(), _convertNfPesoToKg(), _fecharModalDetalheMaterial(), _heroSubCardHtml() (+10 more)

### Community 38 - "_buildOcHierarquiaBar"
Cohesion: 0.18
Nodes (17): _buildOcHierarquiaBar(), _buildOcHierarquiaDetail(), buildWhatsAppLink(), fmtDateBR(), _ocAbrirMenuCard(), _ocCompararOrdenacao(), _ocDetectarMudancaPrioritaria(), _ocFecharMenuCard() (+9 more)

### Community 39 - "renderAnaliticoMicro"
Cohesion: 0.17
Nodes (15): _anClearStockCache(), _anGetCustosSapIdx(), _anGetLastPeriodStockFallback(), _anGetPrevDayStock(), _anGetSapStock(), _anGetSapTheoreticalStock(), anSwitchView(), _applyGroupPendHighlight() (+7 more)

### Community 40 - "capacidades.js"
Cohesion: 0.07
Nodes (67): abrirEdicaoCapacidadesSelecionadas(), abrirEstruturaCapacidade(), adicionarUnidadeEstrutura(), buildCapacidadeSection(), CAP_ARMAZENAGEM, CAP_BUSCA_CAMPOS, CAP_CATS_PCT, CAP_FAIXAS (+59 more)

### Community 41 - "buildCards"
Cohesion: 0.22
Nodes (15): buildCards(), buildCentralBlock(), _buildCriticidadeData(), buildLevelSection(), buildMatRows(), buildRows(), escC(), fmtKgC() (+7 more)

### Community 42 - "renderModuleByName"
Cohesion: 0.27
Nodes (15): applyColFilter(), buildColFilterHTML(), clearAllColFilters(), clearColFilter(), closeColFilterPopover(), colHasFilter(), ensureColFilters(), injectColFilterButtons() (+7 more)

### Community 43 - "renderOcorrencias"
Cohesion: 0.23
Nodes (15): closeConcluirModal(), closeInconclusivaModal(), confirmarExcluirAjusteSistemico(), confirmarExcluirOcorrencia(), deleteOcorrencia(), _ocNomeAtor(), _ocSyncDelete(), _ocSyncUpsert() (+7 more)

### Community 44 - "_dgmLinhaHtml"
Cohesion: 0.17
Nodes (19): _dgmCentralHeaderHtml(), _dgmCentralTabelaHtml(), _dgmChip(), _dgmCoberturaInfo(), _dgmLinhaHtml(), _dgmMesPaneHtml(), _dgrAbastInfo(), _dgrBuildCustoRegionalCentralHtml() (+11 more)

### Community 45 - "_fechMgrGetTodosCandidatos"
Cohesion: 0.35
Nodes (11): _fechImportNormDoc(), _fechImportPreVisualizar(), _fechMesIndice(), _fechMgrGetTodosCandidatos(), _getFechInvUnlockSet(), _getFechOverrideSet(), _getInvJustDocSet(), getSapFechKey() (+3 more)

### Community 46 - "help-badges.js"
Cohesion: 0.36
Nodes (11): _buildHelpContent(), _getHelpTip(), HELP_DEFS, hideCustoMedTip(), _hideHelpTip(), initHelpBadges(), moveCustoMedTip(), _moveHelpTip() (+3 more)

### Community 47 - "varSymbol"
Cohesion: 0.33
Nodes (11): _daColorFor(), _daFmtCountSigned(), _daFmtMoneySigned(), _daFmtPctSigned(), _daMaiorImpacto(), _daRenderRanking(), _daRenderTabelaMaterial(), _dgVgRenderExtremos() (+3 more)

### Community 48 - "toast"
Cohesion: 0.24
Nodes (11): calcCopy(), confirmarComUndo(), fechamentoAbrirPrint(), fechamentoCopiarWhatsapp(), fechamentoGerarImagem(), _fechFmtDate(), _fechGerarImagemCanvas(), _fechGetPlainText() (+3 more)

### Community 49 - "populateOcFiltros"
Cohesion: 0.20
Nodes (12): getOcorrenciasFiltradas(), OC_SORT_OPTIONS, _ocBuildOptionsList(), _ocCloseOrdenarDropdown(), ocFilterMicroOptions(), _ocRegionalPorCentral(), ocSetOrdenar(), ocStatusMatches() (+4 more)

### Community 50 - "buildHealthPanel"
Cohesion: 0.15
Nodes (15): buildHealthPanel(), _buildLancIndex(), buildSnapshot(), calcHealthScore(), classifyVariation(), detectCatFromMat(), detectCatKey(), getHealthThresholds() (+7 more)

### Community 51 - "_setModalCadastroModo"
Cohesion: 0.23
Nodes (12): abrirCadastroFiliaisEmLote(), abrirCadastroFilialIndividual(), abrirCadastroMateriaisEmLote(), abrirCadastroMaterialIndividual(), abrirEdicaoFiliaisEmLote(), abrirEdicaoFilial(), abrirEdicaoMateriaisEmLote(), abrirEdicaoMateriaisSelecionados() (+4 more)

### Community 52 - "toggleAllCentralis"
Cohesion: 0.22
Nodes (10): collapseAllMicro(), expandAllMicro(), toggleAllCentralis(), toggleAllRegionais(), toggleMicro(), toggleRegional(), _updateCentralFocus(), _updateRegionalFocus() (+2 more)

### Community 53 - "ocorrencias-supervisor.test.mjs"
Cohesion: 0.20
Nodes (7): casos, daiBase, fonteOcorrencias, montar(), montarComSupabase(), raiz, rowBase

### Community 54 - "lookup.js"
Cohesion: 0.28
Nodes (5): _filterDebounceTimers, filterRecords(), _getOrBuildIndex(), recordMatchesSearch(), _searchIndex

### Community 55 - "escapeHtml"
Cohesion: 0.12
Nodes (21): CODIGOS_ENTRADA, buildAnaliticoDetailBreakdown(), buildAnaliticoDetailHtml(), buildPendIntegSection(), _buildSaidasIndex(), calcPendentesIntegracao(), ensureSaidasIndex(), escapeHtml() (+13 more)

### Community 56 - "wipe-local.test.mjs"
Cohesion: 0.25
Nodes (6): casos, fakeIndexedDB(), fonteNormalize, fontePersist, montar(), raiz

### Community 57 - "shortcutRemapSave"
Cohesion: 0.36
Nodes (8): getShortcut(), _shortcutKeyLabel(), shortcutRemapSave(), _shortcutsLoad(), shortcutsRender(), shortcutsReset(), _shortcutsSave(), _shortcutsUpdateUI()

### Community 58 - "period-fab.js"
Cohesion: 0.43
Nodes (6): activePage(), contentVisible(), fmtShort(), getActiveDates(), syncFabInputs(), syncFabLabel()

### Community 59 - "notif-supervisor.test.mjs"
Cohesion: 0.25
Nodes (5): activityRowOc, activityRowUpdate, casos, fonte, raiz

### Community 60 - "relatorio-dais.test.mjs"
Cohesion: 0.25
Nodes (5): casos, fonteRelatorio, itemConcluido, itemPendente, raiz

### Community 61 - "openModal"
Cohesion: 0.29
Nodes (7): abrirFechamento(), closeModal(), closeToolsMenu(), confirmarDestrutivo(), fechamentoSwitchTipo(), openModal(), shortcutStartRemap()

### Community 62 - "openTool"
Cohesion: 0.38
Nodes (7): closeTool(), _makeDraggable(), _makeResizable(), _nextToolZ(), _notesLoad(), openTool(), toggleCalc()

### Community 63 - "applyTheme"
Cohesion: 0.50
Nodes (4): applyTheme(), setTheme(), updateThemeUI(), updateToolsTheme()

### Community 64 - "cloud-backup.test.mjs"
Cohesion: 0.33
Nodes (5): casos, fonte, montar(), raiz, sha256()

### Community 65 - "dai-anexos-storage.test.mjs"
Cohesion: 0.29
Nodes (3): casos, fonteDai, raiz

### Community 66 - "dai-sync-admin.test.mjs"
Cohesion: 0.29
Nodes (4): casos, fonteDai, raiz, rowDai

### Community 67 - "nome-token-ids.test.mjs"
Cohesion: 0.29
Nodes (4): casos, fonteDai, fonteOcorrencias, raiz

### Community 68 - "renderOcKPIs"
Cohesion: 0.25
Nodes (8): _bindOcDonutHover(), _buildOcCharts(), _buildOcDonut(), buildOcKPIs(), _buildOcSublegenda(), _destroyOcCharts(), ocDateStatus(), renderOcKPIs()

### Community 69 - "autoria-notificacoes.test.mjs"
Cohesion: 0.33
Nodes (3): casos, fonteOcorrencias, raiz

### Community 70 - "criador-nome.test.mjs"
Cohesion: 0.33
Nodes (3): casos, fonteOcorrencias, raiz

### Community 71 - "integracao-local.test.mjs"
Cohesion: 0.33
Nodes (3): casos, fonte, raiz

### Community 72 - "oc-donut-kpis.test.mjs"
Cohesion: 0.29
Nodes (3): casos, fonteOcorrencias, raiz

### Community 73 - "rodarAnalitico"
Cohesion: 0.60
Nodes (5): rodarAnalitico(), setQuickPeriod(), setQuickPeriodCurrentMonth(), setQuickPeriodCurrentYear(), toISODate()

### Community 74 - "handleSearchModal"
Cohesion: 0.50
Nodes (5): handleSearchModal(), openSearchModal(), _renderSmHint(), _runSearchModal(), _smHighlight()

### Community 75 - "_getModuleTextFilteredData"
Cohesion: 0.53
Nodes (6): getLancamentoDuplicateKeys(), getLancamentoRecordKey(), _getModuleTextFilteredData(), getSap861862DuplicateKeys(), getSapDuplicateKeys(), getSapRecordKey()

### Community 76 - "toggleThemeSwitcher"
Cohesion: 0.67
Nodes (3): closeThemeSwitcher(), openThemeSwitcher(), toggleThemeSwitcher()

### Community 77 - "Cloudflare Turnstile (CAPTCHA / Bot Protection Widget)"
Cohesion: 0.67
Nodes (3): Cloudflare Turnstile (CAPTCHA / Bot Protection Widget), Turnstile Widget (Login form), Turnstile Widget (Public Form)

### Community 87 - "init"
Cohesion: 0.22
Nodes (9): _alertasLabel(), closeGlobalSearch(), init(), _nextLancLabel(), restoreSidebarState(), _saudeGeralLabel(), setupKeyboardShortcuts(), setupModalCloseOnEscape() (+1 more)

### Community 88 - "normalizeSearchKey"
Cohesion: 0.67
Nodes (3): getFieldCandidates(), normalizeSearchKey(), normalizeText()

### Community 89 - "Q: Why does CLOUD_BACKUP_MODULOS connect Cloud Backup Module to Admin Panel, Dashboard Conflict Detection, Dashboard Rendering & Cleanup, Import Deletion & Backup Sync?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Why does CLOUD_BACKUP_MODULOS connect Cloud Backup Module to Admin Panel, Dashboard Conflict Detection, Dashboard Rendering & Cleanup, Import Deletion & Backup Sync?, Source Nodes

### Community 90 - "_ocRealtimeInit"
Cohesion: 0.29
Nodes (8): ocApareceAutoParaSupervisor(), _ocEhRelevantePraMim(), _ocFromDbRow(), _ocMotivoRelevancia(), _ocRealtimeInit(), _ocRemoveLocal(), _ocUpsertLocal(), syncOcorrenciasFromSupabase()

### Community 91 - "_ocCloseMicroFilterDropdown"
Cohesion: 0.36
Nodes (8): ocApplyMicroFilter(), ocCancelMicroFilter(), ocClearAllMicroFilters(), ocClearMicroFilter(), _ocCloseMicroFilterDropdown(), _ocSyncClearBtn(), _ocSyncTriggerLabel(), ocToggleOrdenarDropdown()

### Community 92 - "updateImportPrereqUI"
Cohesion: 0.67
Nodes (3): hasRequiredReferenceData(), showImportPrereqMessage(), updateImportPrereqUI()

### Community 93 - "sap-861862-dup.test.mjs"
Cohesion: 0.27
Nodes (7): casos, entrada861(), entradaNF(), fonteUi, raiz, registro(), saida862()

### Community 94 - "oc-card-menu.test.mjs"
Cohesion: 0.29
Nodes (3): casos, fonteOcorrencias, raiz

### Community 95 - "calendar.js"
Cohesion: 0.30
Nodes (14): Ausências de Lançamento Panel (Lançamentos page), applyRangeClass(), fmtDisplay(), getPicker(), renderCal(), renderDaysView(), renderMonthGrid(), renderYearGrid() (+6 more)

### Community 96 - "giro-por-central-material.test.mjs"
Cohesion: 0.18
Nodes (9): casos, chamadas, ctx, dados, fonte, porNome, raiz, results (+1 more)

### Community 98 - "calendar-oc.test.mjs"
Cohesion: 0.17
Nodes (7): safeJSONParse(), casos, error(), fakeEl(), fonteCalendar, montar(), raiz

### Community 99 - "processImportedRows"
Cohesion: 0.14
Nodes (15): conflictConfirm(), _detectConflicts(), _fpBaseCustosSap(), _fpCustosSap(), _fpEntrada(), _fpLancamento(), _fpSaida(), _fpSap() (+7 more)

### Community 100 - "aus-fim-de-mes.test.mjs"
Cohesion: 0.33
Nodes (4): casos, ctx, fonte, raiz

### Community 101 - "sap-fechamento-override.test.mjs"
Cohesion: 0.29
Nodes (5): casos, fonteUi, montar(), parseDateBr(), raiz

### Community 102 - "_buildRankingShellHTML"
Cohesion: 0.20
Nodes (10): _ausGetPeriodo(), _buildAusenciasRelHTML(), _buildRankingShellHTML(), _dgrFonteIconesEmbutida(), _dgrFontesEmbutidas(), _dgrScriptAbas(), _dgrScriptCollapse(), _dgrScriptDownload() (+2 more)

### Community 103 - "_setBtnLoading"
Cohesion: 0.19
Nodes (14): editarMateriais(), handleMateriaisImport(), makeMaterialId(), _materiaisSyncUpdate(), _materiaisSyncUpsert(), materialMatchKey(), normalizeImportedMaterial(), parseMateriaisRows() (+6 more)

### Community 104 - "toggleMicroFilter"
Cohesion: 0.25
Nodes (8): _buildCapacidadeOptions(), _buildOptionsList(), _buildVariacaoOptions(), filterMicroOptions(), _syncVarDropdownToState(), toggleMicroFilter(), _updateVarHint(), _varFilterChange()

### Community 105 - "handleFiliaisImport"
Cohesion: 0.22
Nodes (10): editarFiliais(), _filiaisSyncUpdate(), _filiaisSyncUpsert(), handleFiliaisImport(), normalizeImportedFilial(), parseFiliaisRows(), registrarRegionalCentral(), removerFilial() (+2 more)

### Community 106 - "salvarNovoGrupoMaterial"
Cohesion: 0.67
Nodes (4): getGruposMateriaisDisponiveis(), _rebuildGrupoMateriaisOptions(), _refreshGrupoMateriaisSelects(), salvarNovoGrupoMaterial()

### Community 107 - "getCodigosSapDisponiveis"
Cohesion: 0.67
Nodes (4): getCodigosSapDisponiveis(), _rebuildCodigosSapOptions(), _refreshCodigosSapSelects(), salvarNovoCodSap()

### Community 108 - "_configEhChaveSaude"
Cohesion: 0.40
Nodes (6): _configEhChaveSaude(), _configsSyncDelete(), _configsSyncUpsert(), deleteConfig(), removerConfig(), salvarConfig()

### Community 109 - "salvarNovoRegionalCentral"
Cohesion: 0.67
Nodes (4): getRegionaisCentraisDisponiveis(), _rebuildRegionaisCentraisOptions(), _refreshRegionaisCentraisSelects(), salvarNovoRegionalCentral()

### Community 110 - "_checarNovosParaImportar"
Cohesion: 0.25
Nodes (8): abrirEdicaoFiliaisSelecionados(), abrirImportarDe(), abrirNovosPendentesDetalhe(), _carregarPerfis(), _checarNovosParaImportar(), confirmarImportarDe(), filialMatchKey(), syncFiliaisFromSupabase()

### Community 112 - "_adminEsc"
Cohesion: 0.20
Nodes (18): adminAbrirExclusaoMassa(), adminAlterarPapel(), _adminErroDetalhe(), _adminEsc(), _adminExecutarResetUsuario(), adminHealthShowTab(), _adminListStorageRecursivo(), adminLoadDbStats() (+10 more)

### Community 113 - "_mesclarGrandeComBanco"
Cohesion: 0.22
Nodes (9): _entradasFromDbRow(), _lancFromDbRow(), _mesclarGrandeComBanco(), _saidasFromDbRow(), _sapFromDbRow(), syncEntradasFromSupabase(), syncLancamentosFromSupabase(), syncSaidasFromSupabase() (+1 more)

### Community 114 - "AGENTS.md"
Cohesion: 0.33
Nodes (5): Confirmar antes de implementar, graphify, headroom, ponytail, Preview / local server

### Community 115 - "excluirImportacao"
Cohesion: 0.33
Nodes (7): _cascadeDeleteCloudByImportId(), _cbReforcarBackupModulos(), excluirImportacao(), _importsSyncDelete(), _importsSyncUpsert(), _importsToDbRow(), reconcilePendingDeletes()

### Community 116 - "_rankEsc"
Cohesion: 0.22
Nodes (10): _buildRankingCentraisBody(), _buildRankingRegionaisTableBlock(), _buildRankSideCard(), _dgmFiltrosHtml(), _dgrBuildCustoAbsolutoHtml(), _dgrBuildSaudeGeralHtml(), _rankCompactarDias(), _rankEsc() (+2 more)

### Community 117 - "relatorio-giro-usina.test.mjs"
Cohesion: 0.12
Nodes (10): casos, centralFalsa(), ctx, ctxF, nivel(), raiz, resumo, secoes (+2 more)

### Community 118 - "adminLoadModulo"
Cohesion: 0.15
Nodes (17): _adminAtualizarBannerDono(), adminBuscarModulo(), adminExcluirRegistro(), adminExcluirRegistroModal(), adminFiltrarPorDono(), adminLimparBuscaModulo(), adminLimparFiltroDono(), _adminLimparSelecaoInterno() (+9 more)

### Community 119 - "_custosSapSyncUpsert"
Cohesion: 0.29
Nodes (8): _atualizarRegistroCustosSap(), _criarRegistroCustosSap(), _custosSapSyncDelete(), _custosSapSyncUpsert(), _custosSapSyncUpsertBatch(), _custosSapToDbRow(), excluirCustosSap(), salvarCustosSapManual()

### Community 120 - "_adminAtualizarBarraLote"
Cohesion: 0.13
Nodes (23): adminAbrirEdicao(), adminAbrirEdicaoLote(), adminAplicarEdicaoLote(), _adminAplicarFiltros(), _adminAtualizarBarraLote(), _adminBuildSearchOr(), _adminContagemSelecionada(), _adminDescricaoFiltroAtivo() (+15 more)

### Community 121 - "_buildCentralOptionsHtml"
Cohesion: 0.50
Nodes (4): _buildCentralOptionsHtml(), _custosSapManualPopularSelects(), _manualModalPopularSelects(), _onManualMaterialChange()

### Community 122 - "_custosSapFromDbRow"
Cohesion: 0.40
Nodes (5): _custosSapFromDbRow(), _custosSapRealtimeInit(), _custosSapRemoveLocal(), _custosSapUpsertLocal(), syncCustosSapFromSupabase()

## Knowledge Gaps
- **279 isolated node(s):** `Confirmar antes de implementar`, `Preview / local server`, `ponytail`, `headroom`, `graphify` (+274 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `RECORD_INTEGRATION_TABLES` connect `notifications.js` to `normalize.js`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **Why does `excluirImportacao()` connect `excluirImportacao` to `analitico.js`, `import.js`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **What connects `Confirmar antes de implementar`, `Preview / local server`, `ponytail` to the rest of the system?**
  _279 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `admin.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08392603129445235 - nodes in this community are weakly interconnected._
- **Should `ocorrencias.js` be split into smaller, more focused modules?**
  _Cohesion score 0.10826210826210826 - nodes in this community are weakly interconnected._
- **Should `assistente.js` be split into smaller, more focused modules?**
  _Cohesion score 0.056179775280898875 - nodes in this community are weakly interconnected._
- **Should `ui.js` be split into smaller, more focused modules?**
  _Cohesion score 0.03263157894736842 - nodes in this community are weakly interconnected._