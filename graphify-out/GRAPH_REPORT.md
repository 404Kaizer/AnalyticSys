# Graph Report - C:/Users/hugos/Documents/GitHub/AnalyticSys  (2026-07-31)

## Corpus Check
- 36 files · ~284,828 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1880 nodes · 3877 edges · 87 communities (79 shown, 8 thin omitted)
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 483 edges (avg confidence: 0.56)
- Token cost: 161,422 input · 0 output

## Community Hubs (Navigation)
- Admin Panel
- Occurrences Module
- Assistant Chat Module
- Backup Import & Fechamento Modals
- Dashboard Import & Ausencias Core
- Trend Analysis Charts
- Config & Catalog Admin
- Inventory Divergences Module
- Notifications & Activity Feed
- DAI Document Generation
- Aggregated Stock Filters
- Chat Messages & Presence
- Calculator Tool
- Filial & Material Lookup Index
- Auth & Session Management
- App State & Theme
- Analitico Core & Stock Cache
- Cloud Import & Record Creation
- NCD Code Mapping
- Ausencias Report Builder
- Fechamento Manager UI
- Dashboard Entradas Ranking
- Dashboard Rendering & Cleanup
- State Persistence
- List Filtering & Sorting UI
- Notes Editor
- Dashboard Ranking & Giro
- Analitico Detail & Conflict UI
- Cloud Backup Module
- Fechamento Alerts
- Dashboard Ausencias Filters
- Macro Calculations
- Regional Report Sections
- SAP Index Lookup UI
- Project Root & Config Docs
- Analitico Microfilters
- Dashboard Ausencias Computation
- Material Detail Modal UI
- Health Panel & Snapshot UI
- Analitico Stock Cache Fallback
- Dashboard Conflict Detection
- Criticidade Report Cards
- Column Filter UI
- Dashboard Health Donut Data
- Regional Cost Report
- Fechamento Import Preview UI
- Help Badges Tooltip
- Dashboard Formatting Helpers
- Calculator Copy & Print
- DB Row Import Mapping
- Backup Export & Cache Invalidation
- Analitico Filter Options
- Analitico Expand/Collapse Controls
- Occurrences Supervisor Tests
- Debounced Lookup Filter
- Ranking Report Tables
- Wipe Local Storage Tests
- Keyboard Shortcut Config
- Period Floating Action Button
- Notification Supervisor Tests
- DAI Report Tests
- Modal & Menu Close Handlers
- Draggable/Resizable Tool Helpers
- Import Deletion & Backup Sync
- Cloud Backup Tests
- DAI Attachments Storage Tests
- DAI Sync Admin Tests
- Name Token ID Tests
- Producao Import Sync
- Notification Authorship Tests
- Creator Name Tests
- Local Integration Tests
- Occurrence Donut KPI Tests
- Analitico Quick Period Controls
- Search Modal UI
- Lancamento Duplicate Detection
- Report Chart Export (PNG)
- Cloudflare Turnstile Integration
- Vercel Config
- Shared Manual Record Modal
- Entradas Page
- Lancamentos Page
- Saidas Page
- SAP Page
- Situacao Category Select
- Termo de Responsabilidade Step

## God Nodes (most connected - your core abstractions)
1. `renderDgVisaoGeralPdf()` - 31 edges
2. `adminLoadModulo()` - 25 edges
3. `_adminEsc()` - 22 edges
4. `escapeHtml()` - 20 edges
5. `_adminErroDetalhe()` - 19 edges
6. `renderOcorrencias()` - 19 edges
7. `_fechMgrRender()` - 19 edges
8. `getFilteredData()` - 16 edges
9. `_asstHasAnalise()` - 14 edges
10. `wireForm()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `Ausências de Lançamento Panel (Lançamentos page)` --references--> `calendar.js — Date-range Picker Logic`  [INFERRED]
  index.html → js/calendar.js
- `solicitacao.html — Public Stock Movement Request Form` --references--> `solicitacao.js — Public Form Logic`  [EXTRACTED]
  solicitacao.html → js/solicitacao.js
- `Admin — Formulário Público Section (public link + analyst/category routing)` --shares_data_with--> `solicitacao.html — Public Stock Movement Request Form`  [INFERRED]
  index.html → solicitacao.html
- `buildCentralCard()` --indirect_call--> `makeResizable()`  [INFERRED]
  js/analitico.js → js/ui.js
- `init()` --indirect_call--> `updateToolsTheme()`  [INFERRED]
  js/analitico.js → js/state.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Entradas/Saídas/Lançamentos/SAP pages share the generic Add-Record modal, sort and pagination functions** — index_page_entradas, index_page_saidas, index_page_lancamentos, index_page_sap, index_modal_manual [INFERRED 0.85]
- **Calculadora/Notas/Assistente/Mensagens all implement the same generic tool-popover open/close pattern (openTool/closeTool, .tool-popover)** — index_calc_popover, index_notes_popover, index_assistente_popover, index_mensagens_popover [EXTRACTED 1.00]
- **DAI generation, Ocorrências, and the public-form/admin routing jointly form the inventory-adjustment reporting flow** — index_dai_modal, index_ocorrencias_page, index_admin_formpublico, solicitacao [INFERRED 0.75]

## Communities (87 total, 8 thin omitted)

### Community 0 - "Admin Panel"
Cohesion: 0.05
Nodes (88): _ADMIN_COL_TYPES, ADMIN_MODAL_PROPRIO, ADMIN_MODULOS, adminAbrirEdicao(), adminAbrirEdicaoLote(), adminAbrirExclusaoMassa(), adminAceitarPendente(), adminAceitarTodosPendentes() (+80 more)

### Community 1 - "Occurrences Module"
Cohesion: 0.05
Nodes (85): applyPhoneMask(), _bindOcDonutHover(), _buildOcCharts(), _buildOcDonut(), _buildOcHierarquiaBar(), _buildOcHierarquiaDetail(), buildOcKPIs(), _buildOcSublegenda() (+77 more)

### Community 2 - "Assistant Chat Module"
Cohesion: 0.06
Nodes (84): _ASST_DIM_LABEL, _ASST_DIM_LABEL_SING, _ASST_INTENTS, _ASST_MANUAL_FORMS, _ASST_MANUAL_REFRESH, _ASST_MESES, _ASST_METRICA_LABEL, _ASST_MODULOS (+76 more)

### Community 3 - "Backup Import & Fechamento Modals"
Cohesion: 0.03
Nodes (57): abrirModalBackup(), analiticoDetailState, _BKP_BIG_KEYS, _BKP_MODULES, _bkpCarregarArquivo(), bkpHandleDrop(), _bkpParseStreaming(), bkpSelectAll() (+49 more)

### Community 4 - "Dashboard Import & Ausencias Core"
Cohesion: 0.03
Nodes (48): abrirSemCadastroModuloModal(), _ausCollapsed, _ausFilter, _ausFilterBuildOptions(), buildEntradaColumnMap(), buildLancamentoColumnMap(), buildSaidaColumnMap(), buildSapColumnMap() (+40 more)

### Community 5 - "Trend Analysis Charts"
Cohesion: 0.07
Nodes (62): openTrendModal(), SERIES_COLORS, _T, _tApplyCenFilter(), _tApplyMatFilter(), _tBuildCustoMedio(), _tBuildWeeks(), _tCmpTooltipShow() (+54 more)

### Community 6 - "Config & Catalog Admin"
Cohesion: 0.06
Nodes (49): abrirCadastroFilialIndividual(), abrirCadastroMaterialIndividual(), abrirModalAcaoRelatorio(), _addFilialIndivRow(), _addMaterialIndivRow(), _configEhChaveSaude(), _configsSyncDelete(), _configsSyncUpsert() (+41 more)

### Community 7 - "Inventory Divergences Module"
Cohesion: 0.06
Nodes (43): Ocorrências 'Ordenar' Micro-filter (31/07), fmt(), fmtR(), _invApplyJustValues(), invAtualizarAlertas(), invAtualizarKpis(), _invAtualizarProgresso(), invAtualizarSemCadastro() (+35 more)

### Community 8 - "Notifications & Activity Feed"
Cohesion: 0.07
Nodes (55): RECORD_INTEGRATION_TABLES, _ACTIVITY_AUTH_LABEL, _ACTIVITY_EXTRA_COLS, _ACTIVITY_MODULE_COLOR, _ACTIVITY_OP_LABEL, _ACTIVITY_VERB, _activityBatchData, _activityBatchTimers (+47 more)

### Community 9 - "DAI Document Generation"
Cohesion: 0.08
Nodes (53): DAI Generator Modal (Documento de Ajuste de Inventário), Ocorrências Page, abrirModalDai(), adicionarAnexoDaiExistente(), baixarZipDai(), _daiAddInformanteRow(), _daiAddItemRow(), daiAdicionarAnexos() (+45 more)

### Community 10 - "Aggregated Stock Filters"
Cohesion: 0.08
Nodes (52): agrApplyFilters(), _agrBuildResumo(), agrClearDropdown(), agrClearFilters(), agrCloseDropdown(), _agrCompute(), _agrCutoffDate(), _agrDateKey() (+44 more)

### Community 11 - "Chat Messages & Presence"
Cohesion: 0.08
Nodes (46): AVATAR_COLOR_VARS, _avatarHash(), avatarHTML(), avatarInfo(), _msgsAbrirAnexo(), msgsAbrirConversa(), _msgsAnexoHTML(), _msgsAtualizarBadges() (+38 more)

### Community 12 - "Calculator Tool"
Cohesion: 0.05
Nodes (36): _calc, calcAction(), _calcCompute(), _calcFmt(), _calcUpdateDisplay(), closeSearchModal(), _COLOR_MAP, _fechConfig (+28 more)

### Community 13 - "Filial & Material Lookup Index"
Cohesion: 0.07
Nodes (47): buildFilialLookupIndex(), buildMaterialLookupIndex(), _carregarNomesOriginais(), CATEGORIA_MODULOS, CATEGORIAS_MATERIAL, CENTRAL_FIELDS_BY_MODULO, checarWipePendente(), _donosPorTabela (+39 more)

### Community 14 - "Auth & Session Management"
Cohesion: 0.10
Nodes (37): Auth Gate — Login / Password Recovery Screen (Fase 1), Idle / Inactivity Auto-Logout Warning (Fase 1), _accountModalSalvar(), _accountModalTrocarSenha(), _accountRenderAvatars(), AVATAR_EXT_POR_MIME, bootApp(), clearError() (+29 more)

### Community 15 - "App State & Theme"
Cohesion: 0.07
Nodes (29): _supaDeleteOwned(), applyTheme(), closeThemeSwitcher(), domCache, filters, getFieldCandidates(), getSavedTheme(), hasRequiredReferenceData() (+21 more)

### Community 16 - "Analitico Core & Stock Cache"
Cohesion: 0.08
Nodes (25): _alertasLabel(), _anStockCache, _closeBdPortal(), closeGlobalSearch(), _ensureBdPortal(), _gsHighlight(), handleGlobalSearch(), init() (+17 more)

### Community 17 - "Cloud Import & Record Creation"
Cohesion: 0.11
Nodes (26): _CASCADE_TABELAS_NUVEM, _cascadeRestoreCloudByImportId(), _criarRegistroEntrada(), _criarRegistroLancamento(), _criarRegistroSaida(), _criarRegistroSAP(), _entradasSyncUpsert(), _entradasSyncUpsertBatch() (+18 more)

### Community 18 - "NCD Code Mapping"
Cohesion: 0.13
Nodes (30): NCD_COR, NCD_SAP_CODIGOS, ncdAbrirModal(), _ncdAplicarCnpj(), _ncdCodigoMap, _ncdCodigoMaterial(), _ncdColetarGrupos(), _ncdCpfValido() (+22 more)

### Community 19 - "Ausencias Report Builder"
Cohesion: 0.09
Nodes (12): Ausências de Lançamento Panel (Lançamentos page), calendar.js — Date-range Picker Logic, _ausGetPeriodo(), _buildAusenciasRelHTML(), _buildRankingShellHTML(), _dgrFonteIconesEmbutida(), _dgrFontesEmbutidas(), _dgrScriptAbas() (+4 more)

### Community 20 - "Fechamento Manager UI"
Cohesion: 0.10
Nodes (26): abrirFechManager(), buildColFilterHTML(), fecharFechImportModal(), fecharFechManager(), _fechImportAplicar(), _fechMgrAplicarFiltros(), _fechMgrAplicarLote(), _fechMgrApplyColFilter() (+18 more)

### Community 21 - "Dashboard Entradas Ranking"
Cohesion: 0.10
Nodes (24): CODIGOS_ENTRADA, _daBuildEntradasFlat(), _daBuildRanking(), _daBuildTabelaMaterial(), _daPesoMedioPorTipo(), _daRenderDetalhadoAnalitico(), _daVarIrrelevante(), DG_VG_CAT_ORDER (+16 more)

### Community 22 - "Dashboard Rendering & Cleanup"
Cohesion: 0.18
Nodes (24): getMateriaisSemCadastroDoModulo(), _pendPadronizacaoBtnHtml(), removerRegistro(), renderAcoesRelatorio(), renderAll(), renderConfigs(), renderDuplicatasCadastroMateriais(), renderEntradas() (+16 more)

### Community 23 - "State Persistence"
Cohesion: 0.18
Nodes (19): applySavedState(), buildStateSnapshot(), compactSapRecords(), daiAnexoKey(), flushPersistQueue(), idbDeleteAnexosDai(), idbGet(), idbGetAnexoDai() (+11 more)

### Community 24 - "List Filtering & Sorting UI"
Cohesion: 0.11
Nodes (23): _applyModuleSort(), filtrarLista(), getFilteredData(), getListFilteredData(), getListPageData(), _getScopeTextFilteredData(), _importStatusBadge(), initResizable() (+15 more)

### Community 25 - "Notes Editor"
Cohesion: 0.16
Nodes (22): notesAutoSave(), notesCloseEditor(), notesDeleteCard(), notesDeleteCurrent(), notesEditorUpdate(), notesExec(), _notesFromDbRow(), notesInsertChecklist() (+14 more)

### Community 26 - "Dashboard Ranking & Giro"
Cohesion: 0.13
Nodes (21): _dcBuildRankingCentrais(), _dcBuildRankingMateriais(), _dcCalcGiroCoberturaGeral(), _dcRenderChartRanking(), _dcRenderKpiStrip(), _dgDeltaBadgeHtml(), _dgRankCardHtml(), _dgResolveCssColor() (+13 more)

### Community 27 - "Analitico Detail & Conflict UI"
Cohesion: 0.14
Nodes (21): buildAnaliticoDetailBreakdown(), buildAnaliticoDetailHtml(), closeLancConflictModal(), escapeHtml(), findMaterialTransferPair(), findTransferPairCentral(), getMatTransferPairIndex(), getTransferPairIndex() (+13 more)

### Community 28 - "Cloud Backup Module"
Cohesion: 0.20
Nodes (19): Admin Health — Storage Tab (28/07), _cbBackupTodosModulos(), _cbGuardarGeracaoAnterior(), _cbGunzipBlob(), _cbGzipString(), _cbLastBackupAt, _cbLerGeracao(), _cbRestaurarModulo() (+11 more)

### Community 29 - "Fechamento Alerts"
Cohesion: 0.15
Nodes (19): fechAddAlert(), fechAddItem(), fechamentoResetarTexto(), _fechDefaultFields(), _fechGetFields(), _fechLastWeekday(), _fechLastWorkdayOfMonth(), _fechLoadAllSaved() (+11 more)

### Community 30 - "Dashboard Ausencias Filters"
Cohesion: 0.17
Nodes (18): applyAusFilter(), ausCollapseAll(), _ausDateStr(), ausExpandAll(), _ausFilterSyncClear(), _ausFilterSyncLabel(), ausToggleAllCentralis(), ausToggleAllRegionais() (+10 more)

### Community 31 - "Macro Calculations"
Cohesion: 0.21
Nodes (16): _calcTrend(), _getTip(), _hideTip(), _levelColor, _levelFromScore(), _levelLabel, _levelSev, macroApplyFilter() (+8 more)

### Community 32 - "Regional Report Sections"
Cohesion: 0.17
Nodes (18): buildCentralBlock(), buildCentralRow(), buildCentralSection(), buildDaiRow(), buildMotivoRow(), buildOcorrenciaRow(), buildRegionalRow(), buildRegionalSection() (+10 more)

### Community 33 - "SAP Index Lookup UI"
Cohesion: 0.14
Nodes (18): _buildSapIndex(), getSapByCentralInPeriod(), getSapIndex(), _nfNeedsConversionWarning(), openPendIntegGlobalModal(), openPendIntegModal(), _pimApplyFilters(), _pimGetSapCache() (+10 more)

### Community 34 - "Project Root & Config Docs"
Cohesion: 0.13
Nodes (16): .serena/project.yml — Serena Project Config, AnalyticSys (Product — Estoque · Insumos System), index.html — AnalyticSys Main App Shell (SPA), Admin — Formulário Público Section (public link + analyst/category routing), Admin / Supervisão Page, Assistente (Chat Assistant) Popover, Backup / Restaurar por Módulos Modal, Calculadora Popover (Basic + Stock-Analytic tabs) (+8 more)

### Community 35 - "Analitico Microfilters"
Cohesion: 0.28
Nodes (15): applyMicroFilter(), _applyMicroVisibility(), cancelMicroFilter(), clearAllMicroFilters(), clearMicroFilter(), _closeMicroFilterDropdown(), _readVarPending(), _syncClearBtn() (+7 more)

### Community 36 - "Dashboard Ausencias Computation"
Cohesion: 0.15
Nodes (15): _ausComputar(), _ausContextoMaterial(), _ausEnsureEntSaiIdx(), _ausInvalidateCache(), _ausInvalidateEntSaiIdx(), ausQuickOntem(), ausQuickTercaAnterior(), _ausUltimoLanc() (+7 more)

### Community 37 - "Material Detail Modal UI"
Cohesion: 0.21
Nodes (15): _abrirModalDetalheMaterial(), _abrirModalDetalheMaterialFromEl(), _agruparRegistros(), _buildResumoCardsHtml(), _convertNfPesoToKg(), _fecharModalDetalheMaterial(), _heroSubCardHtml(), renderEntradasSummary() (+7 more)

### Community 38 - "Health Panel & Snapshot UI"
Cohesion: 0.15
Nodes (15): buildHealthPanel(), _buildLancIndex(), buildSnapshot(), calcHealthScore(), classifyVariation(), detectCatFromMat(), detectCatKey(), getHealthThresholds() (+7 more)

### Community 39 - "Analitico Stock Cache Fallback"
Cohesion: 0.19
Nodes (14): _anClearStockCache(), _anGetLastPeriodStockFallback(), _anGetPrePeriodStock(), _anGetPrevDayStock(), anSwitchView(), _applyGroupPendHighlight(), buildAbsentTooltip(), buildCentralCard() (+6 more)

### Community 40 - "Dashboard Conflict Detection"
Cohesion: 0.15
Nodes (14): conflictConfirm(), _detectConflicts(), _fpEntrada(), _fpLancamento(), _fpProducao(), _fpSaida(), _fpSap(), _mergeDedup() (+6 more)

### Community 41 - "Criticidade Report Cards"
Cohesion: 0.24
Nodes (14): buildCards(), _buildCriticidadeData(), buildLevelSection(), buildMatRows(), buildRows(), escC(), fmtKgC(), fmtKgR() (+6 more)

### Community 42 - "Column Filter UI"
Cohesion: 0.29
Nodes (14): applyColFilter(), clearAllColFilters(), clearColFilter(), closeColFilterPopover(), colHasFilter(), ensureColFilters(), getColUniqueValues(), injectColFilterButtons() (+6 more)

### Community 43 - "Dashboard Health Donut Data"
Cohesion: 0.18
Nodes (13): _dgVgAgruparOutros(), _dgVgBuildCentralHealthData(), _dgVgBuildHealthDonutData(), _dgVgDrawDonutSvg(), _dgVgHealthTipHtml(), _dgVgMaterialTipHtml(), _dgVgRenderChartGrupoMaterial(), _dgVgRenderCustoDonutSvg() (+5 more)

### Community 44 - "Regional Cost Report"
Cohesion: 0.19
Nodes (13): _dgrAbastInfo(), _dgrBuildCustoRegionalCentralHtml(), _dgrBuildDetalhadoAnaliticoHtml(), _dgrBuildGiroCoberturaHtml(), _dgrBuildResumoPeriodoHtml(), _dgrGiroCor(), _dgrGiroListaHtml(), _dgrNivelCor() (+5 more)

### Community 45 - "Fechamento Import Preview UI"
Cohesion: 0.24
Nodes (13): _bdmFechExcluidosHtml(), _fechImportNormDoc(), _fechImportPreVisualizar(), _fechMesIndice(), _fechMgrGetTodosCandidatos(), _getFechOverrideSet(), _getInvJustDocSet(), getSapFechKey() (+5 more)

### Community 46 - "Help Badges Tooltip"
Cohesion: 0.36
Nodes (11): _buildHelpContent(), _getHelpTip(), HELP_DEFS, hideCustoMedTip(), _hideHelpTip(), initHelpBadges(), moveCustoMedTip(), _moveHelpTip() (+3 more)

### Community 47 - "Dashboard Formatting Helpers"
Cohesion: 0.33
Nodes (11): _daColorFor(), _daFmtCountSigned(), _daFmtMoneySigned(), _daFmtPctSigned(), _daMaiorImpacto(), _daRenderRanking(), _daRenderTabelaMaterial(), _dgVgRenderExtremos() (+3 more)

### Community 48 - "Calculator Copy & Print"
Cohesion: 0.24
Nodes (11): calcCopy(), confirmarComUndo(), fechamentoAbrirPrint(), fechamentoCopiarWhatsapp(), fechamentoGerarImagem(), _fechFmtDate(), _fechGerarImagemCanvas(), _fechGetPlainText() (+3 more)

### Community 49 - "DB Row Import Mapping"
Cohesion: 0.18
Nodes (11): _entradasFromDbRow(), _lancFromDbRow(), _mesclarGrandeComBanco(), _producaoFromDbRow(), _saidasFromDbRow(), _sapFromDbRow(), syncEntradasFromSupabase(), syncLancamentosFromSupabase() (+3 more)

### Community 50 - "Backup Export & Cache Invalidation"
Cohesion: 0.22
Nodes (11): bkpConfirmar(), _exportarModulos(), _invalidateLancDupCache(), invalidateLancIndex(), _invalidateMatTransferPairCache(), invalidateSaidasIndex(), _invalidateSapDupCache(), invalidateSapIndex() (+3 more)

### Community 51 - "Analitico Filter Options"
Cohesion: 0.22
Nodes (10): _buildOptionsList(), _buildVariacaoOptions(), filterMicroOptions(), _microFilterBar(), _microRecomputeOptions(), populateMicroFilterOptions(), _syncVarDropdownToState(), toggleMicroFilter() (+2 more)

### Community 52 - "Analitico Expand/Collapse Controls"
Cohesion: 0.22
Nodes (10): collapseAllMicro(), expandAllMicro(), toggleAllCentralis(), toggleAllRegionais(), toggleMicro(), toggleRegional(), _updateCentralFocus(), _updateRegionalFocus() (+2 more)

### Community 53 - "Occurrences Supervisor Tests"
Cohesion: 0.22
Nodes (7): casos, daiBase, fonteOcorrencias, montar(), montarComSupabase(), raiz, rowBase

### Community 54 - "Debounced Lookup Filter"
Cohesion: 0.28
Nodes (5): _filterDebounceTimers, filterRecords(), _getOrBuildIndex(), recordMatchesSearch(), _searchIndex

### Community 55 - "Ranking Report Tables"
Cohesion: 0.25
Nodes (9): _buildRankingCentraisBody(), _buildRankingRegionaisTableBlock(), _buildRankSideCard(), _dgrBuildCustoAbsolutoHtml(), _dgrBuildSaudeGeralHtml(), _rankCompactarDias(), _rankEsc(), _rankSeverityCentrais() (+1 more)

### Community 56 - "Wipe Local Storage Tests"
Cohesion: 0.25
Nodes (6): casos, fakeIndexedDB(), fonteNormalize, fontePersist, montar(), raiz

### Community 57 - "Keyboard Shortcut Config"
Cohesion: 0.36
Nodes (8): getShortcut(), _shortcutKeyLabel(), shortcutRemapSave(), _shortcutsLoad(), shortcutsRender(), shortcutsReset(), _shortcutsSave(), _shortcutsUpdateUI()

### Community 58 - "Period Floating Action Button"
Cohesion: 0.43
Nodes (6): activePage(), contentVisible(), fmtShort(), getActiveDates(), syncFabInputs(), syncFabLabel()

### Community 59 - "Notification Supervisor Tests"
Cohesion: 0.25
Nodes (5): activityRowOc, activityRowUpdate, casos, fonte, raiz

### Community 60 - "DAI Report Tests"
Cohesion: 0.25
Nodes (5): casos, fonteRelatorio, itemConcluido, itemPendente, raiz

### Community 61 - "Modal & Menu Close Handlers"
Cohesion: 0.29
Nodes (7): abrirFechamento(), closeModal(), closeToolsMenu(), confirmarDestrutivo(), fechamentoSwitchTipo(), openModal(), shortcutStartRemap()

### Community 62 - "Draggable/Resizable Tool Helpers"
Cohesion: 0.38
Nodes (7): closeTool(), _makeDraggable(), _makeResizable(), _nextToolZ(), _notesLoad(), openTool(), toggleCalc()

### Community 63 - "Import Deletion & Backup Sync"
Cohesion: 0.33
Nodes (7): _cascadeDeleteCloudByImportId(), _cbReforcarBackupModulos(), excluirImportacao(), _importsSyncDelete(), _importsSyncUpsert(), _importsToDbRow(), reconcilePendingDeletes()

### Community 64 - "Cloud Backup Tests"
Cohesion: 0.33
Nodes (5): casos, fonte, montar(), raiz, sha256()

### Community 65 - "DAI Attachments Storage Tests"
Cohesion: 0.29
Nodes (3): casos, fonteDai, raiz

### Community 66 - "DAI Sync Admin Tests"
Cohesion: 0.29
Nodes (4): casos, fonteDai, raiz, rowDai

### Community 67 - "Name Token ID Tests"
Cohesion: 0.29
Nodes (4): casos, fonteDai, fonteOcorrencias, raiz

### Community 68 - "Producao Import Sync"
Cohesion: 0.33
Nodes (6): _criarRegistroProducao(), excluirProducao(), _producaoSyncDelete(), _producaoSyncUpsert(), _producaoToDbRow(), salvarProducao()

### Community 69 - "Notification Authorship Tests"
Cohesion: 0.33
Nodes (3): casos, fonteOcorrencias, raiz

### Community 70 - "Creator Name Tests"
Cohesion: 0.33
Nodes (3): casos, fonteOcorrencias, raiz

### Community 71 - "Local Integration Tests"
Cohesion: 0.33
Nodes (3): casos, fonte, raiz

### Community 72 - "Occurrence Donut KPI Tests"
Cohesion: 0.33
Nodes (3): casos, fonteOcorrencias, raiz

### Community 73 - "Analitico Quick Period Controls"
Cohesion: 0.60
Nodes (5): rodarAnalitico(), setQuickPeriod(), setQuickPeriodCurrentMonth(), setQuickPeriodCurrentYear(), toISODate()

### Community 74 - "Search Modal UI"
Cohesion: 0.50
Nodes (5): handleSearchModal(), openSearchModal(), _renderSmHint(), _runSearchModal(), _smHighlight()

### Community 75 - "Lancamento Duplicate Detection"
Cohesion: 0.60
Nodes (5): getLancamentoDuplicateKeys(), getLancamentoRecordKey(), _getModuleTextFilteredData(), getSapDuplicateKeys(), getSapRecordKey()

### Community 76 - "Report Chart Export (PNG)"
Cohesion: 0.67
Nodes (4): _dgrCanvasParaPngDataUrl(), _dgrCapturarCategoriaAmpliada(), _dgrCapturarComTema(), _dgrSvgParaPngDataUrl()

### Community 77 - "Cloudflare Turnstile Integration"
Cohesion: 0.67
Nodes (3): Cloudflare Turnstile (CAPTCHA / Bot Protection Widget), Turnstile Widget (Login form), Turnstile Widget (Public Form)

## Knowledge Gaps
- **216 isolated node(s):** `_MESES_BR`, `_MESES_FULL`, `_agrPickerYear`, `_anStockCache`, `_microFilter` (+211 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `CLOUD_BACKUP_MODULOS` connect `Cloud Backup Module` to `Admin Panel`, `Dashboard Conflict Detection`, `Dashboard Rendering & Cleanup`, `Import Deletion & Backup Sync`?**
  _High betweenness centrality (0.088) - this node is a cross-community bridge._
- **Why does `removerRegistro()` connect `Dashboard Rendering & Cleanup` to `Analitico Core & Stock Cache`, `Dashboard Import & Ausencias Core`, `Cloud Backup Module`?**
  _High betweenness centrality (0.076) - this node is a cross-community bridge._
- **Why does `_adminExecutarExclusaoMassa()` connect `Admin Panel` to `Cloud Backup Module`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **What connects `_MESES_BR`, `_MESES_FULL`, `_agrPickerYear` to the rest of the system?**
  _216 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Admin Panel` be split into smaller, more focused modules?**
  _Cohesion score 0.05423094904160823 - nodes in this community are weakly interconnected._
- **Should `Occurrences Module` be split into smaller, more focused modules?**
  _Cohesion score 0.05002337540906966 - nodes in this community are weakly interconnected._
- **Should `Assistant Chat Module` be split into smaller, more focused modules?**
  _Cohesion score 0.056179775280898875 - nodes in this community are weakly interconnected._