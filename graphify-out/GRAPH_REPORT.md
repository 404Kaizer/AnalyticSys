# Graph Report - .  (2026-07-29)

## Corpus Check
- 32 files · ~248,617 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1737 nodes · 3605 edges · 83 communities (64 shown, 19 thin omitted)
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 441 edges (avg confidence: 0.58)
- Token cost: 77,494 input · 0 output

## Community Hubs (Navigation)
- Assistant Chat Module
- PDF Report Builder
- Import & Persistence Sync
- Dashboard Core
- Trend Analysis Charts
- UI Core Helpers
- Config & Catalog Admin
- Inventory Module
- Solicitation Wizard Logic
- Occurrences Module
- Aggregated Stock Control
- Admin Panel
- Formatting & Loading Overlay
- DAI Document Generation
- Notifications & Activity Feed
- Name Normalization & Lookup
- Analytics Module
- App State & Theme
- Auth & Session Management
- Index/Solicitation Page Wiring
- NCD PDF Generation
- Managerial Dashboard Rankings
- Fechamento (Closing) Manager UI
- Dashboard Rendering
- Notes Feature
- Messages/Chat Module
- Dashboard Ranking Builders
- Material Detail Modal
- Backup Restore Streaming
- Analytic Detail Breakdown
- Fechamento Alerts
- Analitico Microfilter
- Dashboard Absence Filter
- Macro Trend Calc
- UI List Filtering
- Calendar Widget
- Health Panel & Lancamento Index
- Analitico Stock Cache
- Dashboard Conflict Detection
- UI Column Filters
- Cloud Backup
- Dashboard Central Health Data
- Fechamento Excluded Docs
- Help Badges
- Dashboard Color/Count Format
- Format Copy/Confirm
- Analitico Micro Expand/Collapse
- Dashboard Absence Compute
- Pending Integration Modal
- Analitico Alerts/Search
- Lookup Debounce Filter
- Format Shortcuts
- Period FAB Widget
- Analitico Option Builders
- Format Fechamento Modal
- Format Draggable Tools
- UI Backup Modal
- Chart.js/Dashboard Page Wiring
- Analitico Period Runner
- Format Search Modal
- UI Lancamento Duplicate Keys
- Index Analitico/Macro Wiring
- Index Lookup/Persist Wiring
- Index Admin Page Wiring
- Index Config Page Wiring
- Index Import Page Wiring
- Index Inventario/NCD Wiring
- Index Mensagens/Notifications Wiring
- Index Agregados Wiring
- Index Assistente Wiring
- Index Calendar Wiring
- Index DAI Wiring
- Index Format Wiring
- Index Help Badges Wiring
- Index Normalize Wiring
- Index Relatorio Wiring
- Index UI Wiring
- Index Entradas Page
- Index Lancamentos Page
- Index Producao Page
- Index Saidas Page
- Index SAP Page

## God Nodes (most connected - your core abstractions)
1. `renderDgVisaoGeralPdf()` - 31 edges
2. `escapeHtml()` - 20 edges
3. `_fechMgrRender()` - 19 edges
4. `adminLoadModulo()` - 17 edges
5. `getFilteredData()` - 16 edges
6. `_asstHasAnalise()` - 14 edges
7. `renderAusencias()` - 14 edges
8. `renderModule()` - 14 edges
9. `renderOcorrencias()` - 14 edges
10. `boot()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `Turnstile widget (turnstile-solicitacao-widget)` --semantically_similar_to--> `Auth Gate (Login Screen)`  [INFERRED] [semantically similar]
  solicitacao.html → index.html
- `js/ocorrencias.js` --semantically_similar_to--> `Solicitação de Movimentação de Estoque (public form)`  [INFERRED] [semantically similar]
  index.html → solicitacao.html
- `Supabase JS SDK (CDN)` --semantically_similar_to--> `Supabase JS SDK (CDN)`  [INFERRED] [semantically similar]
  index.html → solicitacao.html
- `Cloudflare Turnstile Widget (CDN)` --semantically_similar_to--> `Cloudflare Turnstile Widget (CDN)`  [INFERRED] [semantically similar]
  index.html → solicitacao.html
- `buildCentralCard()` --indirect_call--> `makeResizable()`  [INFERRED]
  js/analitico.js → js/ui.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Public Stock Movement Request Wizard Flow** — solicitacao_step_local, solicitacao_step_situacao, solicitacao_step_informantes, solicitacao_step_termo, solicitacao_avancarstep, solicitacao_voltarstep [EXTRACTED 1.00]
- **Login/Session Authentication Flow** — index_auth_gate, index_idle_warning_overlay, index_js_auth, index_js_supabase_client, index_turnstile_cdn [INFERRED 0.85]
- **Client-side Data State/Persistence Pipeline** — index_js_state, index_js_lookup, index_js_persist, index_js_normalize, index_js_cloud_backup, index_js_supabase_client [INFERRED 0.75]

## Communities (83 total, 19 thin omitted)

### Community 0 - "Assistant Chat Module"
Cohesion: 0.06
Nodes (84): _ASST_DIM_LABEL, _ASST_DIM_LABEL_SING, _ASST_INTENTS, _ASST_MANUAL_FORMS, _ASST_MANUAL_REFRESH, _ASST_MESES, _ASST_METRICA_LABEL, _ASST_MODULOS (+76 more)

### Community 1 - "PDF Report Builder"
Cohesion: 0.05
Nodes (65): _ausGetPeriodo(), _buildAusenciasRelHTML(), buildCards(), buildCentralBlock(), buildCentralRow(), buildCentralSection(), _buildCriticidadeData(), buildLevelSection() (+57 more)

### Community 2 - "Import & Persistence Sync"
Cohesion: 0.05
Nodes (66): _CASCADE_TABELAS_NUVEM, _cascadeDeleteCloudByImportId(), _cascadeRestoreCloudByImportId(), _criarRegistroEntrada(), _criarRegistroLancamento(), _criarRegistroProducao(), _criarRegistroSaida(), _criarRegistroSAP() (+58 more)

### Community 3 - "Dashboard Core"
Cohesion: 0.04
Nodes (46): abrirSemCadastroModuloModal(), _ausCollapsed, _ausFilter, _ausFilterBuildOptions(), buildEntradaColumnMap(), buildLancamentoColumnMap(), buildSaidaColumnMap(), buildSapColumnMap() (+38 more)

### Community 4 - "Trend Analysis Charts"
Cohesion: 0.07
Nodes (62): openTrendModal(), SERIES_COLORS, _T, _tApplyCenFilter(), _tApplyMatFilter(), _tBuildCustoMedio(), _tBuildWeeks(), _tCmpTooltipShow() (+54 more)

### Community 5 - "UI Core Helpers"
Cohesion: 0.04
Nodes (45): analiticoDetailState, _BKP_BIG_KEYS, _BKP_MODULES, _bkpSelected, _buildNavCache(), _buildSapIndex(), closeSidebar(), _COLFILTER_LIST_SCOPES (+37 more)

### Community 6 - "Config & Catalog Admin"
Cohesion: 0.06
Nodes (52): abrirCadastroFilialIndividual(), abrirCadastroMaterialIndividual(), abrirModalAcaoRelatorio(), _addFilialIndivRow(), _addMaterialIndivRow(), _configEhChaveSaude(), _configsSyncDelete(), _configsSyncUpsert() (+44 more)

### Community 7 - "Inventory Module"
Cohesion: 0.06
Nodes (42): fmt(), fmtR(), _invApplyJustValues(), invAtualizarAlertas(), invAtualizarKpis(), _invAtualizarProgresso(), invAtualizarSemCadastro(), _invBuildOptionsList() (+34 more)

### Community 8 - "Solicitation Wizard Logic"
Cohesion: 0.08
Nodes (54): adicionarAnexos(), adicionarInformante(), adicionarItemMaterial(), _anexos, _atualizarVariacao(), avancarStep(), boot(), _calcVariacaoBalanca() (+46 more)

### Community 9 - "Occurrences Module"
Cohesion: 0.08
Nodes (52): applyPhoneMask(), _bindOcDonutHover(), _buildOcCharts(), _buildOcDonut(), _buildOcHierarquiaBar(), _buildOcHierarquiaDetail(), buildOcKPIs(), buildWhatsAppLink() (+44 more)

### Community 10 - "Aggregated Stock Control"
Cohesion: 0.08
Nodes (52): agrApplyFilters(), _agrBuildResumo(), agrClearDropdown(), agrClearFilters(), agrCloseDropdown(), _agrCompute(), _agrCutoffDate(), _agrDateKey() (+44 more)

### Community 11 - "Admin Panel"
Cohesion: 0.09
Nodes (48): _ADMIN_COL_TYPES, ADMIN_MODULOS, adminAbrirEdicao(), adminAbrirEdicaoLote(), adminAlterarPapel(), adminAplicarEdicaoLote(), _adminAtualizarBarraLote(), _adminBuildSearchOr() (+40 more)

### Community 12 - "Formatting & Loading Overlay"
Cohesion: 0.05
Nodes (36): _calc, calcAction(), _calcCompute(), _calcFmt(), _calcUpdateDisplay(), closeSearchModal(), _COLOR_MAP, _fechConfig (+28 more)

### Community 13 - "DAI Document Generation"
Cohesion: 0.10
Nodes (45): abrirModalDai(), adicionarAnexoDaiExistente(), baixarZipDai(), _daiAddInformanteRow(), _daiAddItemRow(), daiAdicionarAnexos(), _daiAdicionarAnexosPosGeracao(), _daiAnexosPendentes (+37 more)

### Community 14 - "Notifications & Activity Feed"
Cohesion: 0.08
Nodes (44): _ACTIVITY_EXTRA_COLS, _ACTIVITY_OP_LABEL, _ACTIVITY_VERB, _activityBatchData, _activityBatchTimers, _activityDescribeRow(), _activityEmitNotification(), _activityGetUserCache() (+36 more)

### Community 15 - "Name Normalization & Lookup"
Cohesion: 0.10
Nodes (37): buildFilialLookupIndex(), buildMaterialLookupIndex(), _carregarNomesOriginais(), CATEGORIA_MODULOS, CATEGORIAS_MATERIAL, CENTRAL_FIELDS_BY_MODULO, _ensureIdSelected(), fetchAllRows() (+29 more)

### Community 16 - "Analytics Module"
Cohesion: 0.06
Nodes (25): _anStockCache, _closeBdPortal(), _ensureBdPortal(), _gsHighlight(), handleGlobalSearch(), _microFilter, _microFilterResults, _MODAL_ESC_JA_TRATADO (+17 more)

### Community 17 - "App State & Theme"
Cohesion: 0.07
Nodes (27): applyTheme(), closeThemeSwitcher(), domCache, filters, getFieldCandidates(), getSavedTheme(), hasRequiredReferenceData(), listFilters (+19 more)

### Community 18 - "Auth & Session Management"
Cohesion: 0.11
Nodes (30): _accountRenderAvatars(), bootApp(), clearError(), clearRecoveryError(), closeAccountSwitcher(), ensureSession(), fetchProfile(), hideGate() (+22 more)

### Community 19 - "Index/Solicitation Page Wiring"
Cohesion: 0.08
Nodes (27): css/auth-gate.css, Auth Gate (Login Screen), Idle Session Warning Modal, js/auth.js, js/cloud-backup.js, js/ocorrencias.js, js/supabase-client.js, Main App Layout (Sidebar + Pages) (+19 more)

### Community 20 - "NCD PDF Generation"
Cohesion: 0.13
Nodes (30): NCD_COR, NCD_SAP_CODIGOS, ncdAbrirModal(), _ncdAplicarCnpj(), _ncdCodigoMap, _ncdCodigoMaterial(), _ncdColetarGrupos(), _ncdCpfValido() (+22 more)

### Community 21 - "Managerial Dashboard Rankings"
Cohesion: 0.10
Nodes (26): buildDashboardGerencialResults(), _daBuildEntradasFlat(), _daBuildRanking(), _daBuildTabelaMaterial(), _daPesoMedioPorTipo(), _daRenderDetalhadoAnalitico(), dateCmp(), _daVarIrrelevante() (+18 more)

### Community 22 - "Fechamento (Closing) Manager UI"
Cohesion: 0.10
Nodes (26): abrirFechManager(), buildColFilterHTML(), fecharFechImportModal(), fecharFechManager(), _fechImportAplicar(), _fechMgrAplicarFiltros(), _fechMgrAplicarLote(), _fechMgrApplyColFilter() (+18 more)

### Community 23 - "Dashboard Rendering"
Cohesion: 0.18
Nodes (24): getMateriaisSemCadastroDoModulo(), _pendPadronizacaoBtnHtml(), removerRegistro(), renderAcoesRelatorio(), renderAll(), renderConfigs(), renderDuplicatasCadastroMateriais(), renderEntradas() (+16 more)

### Community 24 - "Notes Feature"
Cohesion: 0.16
Nodes (22): notesAutoSave(), notesCloseEditor(), notesDeleteCard(), notesDeleteCurrent(), notesEditorUpdate(), notesExec(), _notesFromDbRow(), notesInsertChecklist() (+14 more)

### Community 25 - "Messages/Chat Module"
Cohesion: 0.19
Nodes (19): AVATAR_COLOR_VARS, _avatarHash(), avatarHTML(), avatarInfo(), msgsAbrirConversa(), _msgsBadgeIncrementar(), _msgsBadgeRender(), _msgsBadgeZerar() (+11 more)

### Community 26 - "Dashboard Ranking Builders"
Cohesion: 0.13
Nodes (21): _dcBuildRankingCentrais(), _dcBuildRankingMateriais(), _dcCalcGiroCoberturaGeral(), _dcRenderChartRanking(), _dcRenderKpiStrip(), _dgDeltaBadgeHtml(), _dgRankCardHtml(), _dgResolveCssColor() (+13 more)

### Community 27 - "Material Detail Modal"
Cohesion: 0.15
Nodes (21): _abrirModalDetalheMaterial(), _abrirModalDetalheMaterialFromEl(), _agruparRegistros(), _applyModuleSort(), _buildResumoCardsHtml(), _convertNfPesoToKg(), _fecharModalDetalheMaterial(), getFilteredData() (+13 more)

### Community 28 - "Backup Restore Streaming"
Cohesion: 0.12
Nodes (21): bkpConfirmar(), _bkpParseStreaming(), closeLancConflictModal(), _exportarModulos(), _invalidateLancDupCache(), invalidateLancIndex(), _invalidateMatTransferPairCache(), invalidateSaidasIndex() (+13 more)

### Community 29 - "Analytic Detail Breakdown"
Cohesion: 0.13
Nodes (20): CODIGOS_ENTRADA, buildAnaliticoDetailBreakdown(), buildAnaliticoDetailHtml(), buildPendIntegSection(), _buildSaidasIndex(), calcPendentesIntegracao(), ensureSaidasIndex(), escapeHtml() (+12 more)

### Community 30 - "Fechamento Alerts"
Cohesion: 0.15
Nodes (19): fechAddAlert(), fechAddItem(), fechamentoResetarTexto(), _fechDefaultFields(), _fechGetFields(), _fechLastWeekday(), _fechLastWorkdayOfMonth(), _fechLoadAllSaved() (+11 more)

### Community 31 - "Analitico Microfilter"
Cohesion: 0.23
Nodes (18): applyMicroFilter(), _applyMicroVisibility(), cancelMicroFilter(), clearAllMicroFilters(), clearMicroFilter(), _closeMicroFilterDropdown(), _microFilterBar(), _microRecomputeOptions() (+10 more)

### Community 32 - "Dashboard Absence Filter"
Cohesion: 0.17
Nodes (18): applyAusFilter(), ausCollapseAll(), _ausDateStr(), ausExpandAll(), _ausFilterSyncClear(), _ausFilterSyncLabel(), ausToggleAllCentralis(), ausToggleAllRegionais() (+10 more)

### Community 33 - "Macro Trend Calc"
Cohesion: 0.21
Nodes (16): _calcTrend(), _getTip(), _hideTip(), _levelColor, _levelFromScore(), _levelLabel, _levelSev, macroApplyFilter() (+8 more)

### Community 34 - "UI List Filtering"
Cohesion: 0.14
Nodes (17): filtrarLista(), getListFilteredData(), getListPageData(), _getScopeTextFilteredData(), _importStatusBadge(), initResizable(), irParaPagina(), irParaUltima() (+9 more)

### Community 35 - "Calendar Widget"
Cohesion: 0.33
Nodes (13): applyRangeClass(), fmtDisplay(), getPicker(), renderCal(), renderDaysView(), renderMonthGrid(), renderYearGrid(), sameDay() (+5 more)

### Community 36 - "Health Panel & Lancamento Index"
Cohesion: 0.15
Nodes (15): buildHealthPanel(), _buildLancIndex(), buildSnapshot(), calcHealthScore(), classifyVariation(), detectCatFromMat(), detectCatKey(), getHealthThresholds() (+7 more)

### Community 37 - "Analitico Stock Cache"
Cohesion: 0.19
Nodes (14): _anClearStockCache(), _anGetLastPeriodStockFallback(), _anGetPrePeriodStock(), _anGetPrevDayStock(), anSwitchView(), _applyGroupPendHighlight(), buildAbsentTooltip(), buildCentralCard() (+6 more)

### Community 38 - "Dashboard Conflict Detection"
Cohesion: 0.15
Nodes (14): conflictConfirm(), _detectConflicts(), _fpEntrada(), _fpLancamento(), _fpProducao(), _fpSaida(), _fpSap(), _mergeDedup() (+6 more)

### Community 39 - "UI Column Filters"
Cohesion: 0.29
Nodes (14): applyColFilter(), clearAllColFilters(), clearColFilter(), closeColFilterPopover(), colHasFilter(), ensureColFilters(), getColUniqueValues(), injectColFilterButtons() (+6 more)

### Community 40 - "Cloud Backup"
Cohesion: 0.29
Nodes (12): _cbBackupTodosModulos(), _cbGunzipBlob(), _cbGzipString(), _cbLastBackupAt, _cbRestaurarModulo(), _cbSha256Hex(), _cbSuportado(), _cbUploadEmAndamento (+4 more)

### Community 41 - "Dashboard Central Health Data"
Cohesion: 0.18
Nodes (13): _dgVgAgruparOutros(), _dgVgBuildCentralHealthData(), _dgVgBuildHealthDonutData(), _dgVgDrawDonutSvg(), _dgVgHealthTipHtml(), _dgVgMaterialTipHtml(), _dgVgRenderChartGrupoMaterial(), _dgVgRenderCustoDonutSvg() (+5 more)

### Community 42 - "Fechamento Excluded Docs"
Cohesion: 0.24
Nodes (13): _bdmFechExcluidosHtml(), _fechImportNormDoc(), _fechImportPreVisualizar(), _fechMesIndice(), _fechMgrGetTodosCandidatos(), _getFechOverrideSet(), _getInvJustDocSet(), getSapFechKey() (+5 more)

### Community 43 - "Help Badges"
Cohesion: 0.36
Nodes (11): _buildHelpContent(), _getHelpTip(), HELP_DEFS, hideCustoMedTip(), _hideHelpTip(), initHelpBadges(), moveCustoMedTip(), _moveHelpTip() (+3 more)

### Community 44 - "Dashboard Color/Count Format"
Cohesion: 0.33
Nodes (11): _daColorFor(), _daFmtCountSigned(), _daFmtMoneySigned(), _daFmtPctSigned(), _daMaiorImpacto(), _daRenderRanking(), _daRenderTabelaMaterial(), _dgVgRenderExtremos() (+3 more)

### Community 45 - "Format Copy/Confirm"
Cohesion: 0.24
Nodes (11): calcCopy(), confirmarComUndo(), fechamentoAbrirPrint(), fechamentoCopiarWhatsapp(), fechamentoGerarImagem(), _fechFmtDate(), _fechGerarImagemCanvas(), _fechGetPlainText() (+3 more)

### Community 46 - "Analitico Micro Expand/Collapse"
Cohesion: 0.22
Nodes (10): collapseAllMicro(), expandAllMicro(), toggleAllCentralis(), toggleAllRegionais(), toggleMicro(), toggleRegional(), _updateCentralFocus(), _updateRegionalFocus() (+2 more)

### Community 47 - "Dashboard Absence Compute"
Cohesion: 0.24
Nodes (10): _ausComputar(), _ausContextoMaterial(), _ausEnsureEntSaiIdx(), _ausInvalidateCache(), _ausInvalidateEntSaiIdx(), ausQuickOntem(), ausQuickTercaAnterior(), _ausUltimoLanc() (+2 more)

### Community 48 - "Pending Integration Modal"
Cohesion: 0.27
Nodes (10): _nfNeedsConversionWarning(), openPendIntegModal(), _pimApplyFilters(), pimGoToPage(), _pimItemDate(), _pimMatchesSearch(), _pimMonthKey(), _pimRender() (+2 more)

### Community 49 - "Analitico Alerts/Search"
Cohesion: 0.22
Nodes (9): _alertasLabel(), closeGlobalSearch(), init(), _nextLancLabel(), restoreSidebarState(), _saudeGeralLabel(), setupKeyboardShortcuts(), setupModalCloseOnEscape() (+1 more)

### Community 50 - "Lookup Debounce Filter"
Cohesion: 0.28
Nodes (5): _filterDebounceTimers, filterRecords(), _getOrBuildIndex(), recordMatchesSearch(), _searchIndex

### Community 51 - "Format Shortcuts"
Cohesion: 0.36
Nodes (8): getShortcut(), _shortcutKeyLabel(), shortcutRemapSave(), _shortcutsLoad(), shortcutsRender(), shortcutsReset(), _shortcutsSave(), _shortcutsUpdateUI()

### Community 52 - "Period FAB Widget"
Cohesion: 0.43
Nodes (6): activePage(), contentVisible(), fmtShort(), getActiveDates(), syncFabInputs(), syncFabLabel()

### Community 53 - "Analitico Option Builders"
Cohesion: 0.29
Nodes (7): _buildOptionsList(), _buildVariacaoOptions(), filterMicroOptions(), _syncVarDropdownToState(), toggleMicroFilter(), _updateVarHint(), _varFilterChange()

### Community 54 - "Format Fechamento Modal"
Cohesion: 0.29
Nodes (7): abrirFechamento(), closeModal(), closeToolsMenu(), confirmarDestrutivo(), fechamentoSwitchTipo(), openModal(), shortcutStartRemap()

### Community 55 - "Format Draggable Tools"
Cohesion: 0.38
Nodes (7): closeTool(), _makeDraggable(), _makeResizable(), _nextToolZ(), _notesLoad(), openTool(), toggleCalc()

### Community 56 - "UI Backup Modal"
Cohesion: 0.33
Nodes (7): abrirModalBackup(), _bkpCarregarArquivo(), bkpHandleDrop(), bkpSelectAll(), bkpSwitchTab(), _renderBkpModuleList(), restaurarBackupModular()

### Community 57 - "Chart.js/Dashboard Page Wiring"
Cohesion: 0.40
Nodes (5): Chart.js (CDN), js/dashboard.js, js/trend.js, Dashboard Gerencial Page, Trend Analysis Tabs (overview/dist/heat/comparison)

### Community 58 - "Analitico Period Runner"
Cohesion: 0.60
Nodes (5): rodarAnalitico(), setQuickPeriod(), setQuickPeriodCurrentMonth(), setQuickPeriodCurrentYear(), toISODate()

### Community 59 - "Format Search Modal"
Cohesion: 0.50
Nodes (5): handleSearchModal(), openSearchModal(), _renderSmHint(), _runSearchModal(), _smHighlight()

### Community 60 - "UI Lancamento Duplicate Keys"
Cohesion: 0.60
Nodes (5): getLancamentoDuplicateKeys(), getLancamentoRecordKey(), _getModuleTextFilteredData(), getSapDuplicateKeys(), getSapRecordKey()

### Community 61 - "Index Analitico/Macro Wiring"
Cohesion: 0.67
Nodes (3): js/analitico.js, js/macro.js, Analítico Page

### Community 62 - "Index Lookup/Persist Wiring"
Cohesion: 0.67
Nodes (3): js/lookup.js, js/persist.js, js/state.js

## Knowledge Gaps
- **176 isolated node(s):** `ADMIN_MODULOS`, `_adminProfiles`, `_adminCurrentRows`, `_adminSelectedIds`, `_ADMIN_COL_TYPES` (+171 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `renderModuleByName()` connect `Dashboard Rendering` to `UI List Filtering`, `UI Core Helpers`, `UI Column Filters`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Why does `toast()` connect `Format Copy/Confirm` to `Formatting & Loading Overlay`, `Analytics Module`, `Format Shortcuts`, `Notes Feature`, `Fechamento Alerts`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Why does `_dgVgDrawDonutSvg()` connect `Dashboard Central Health Data` to `Macro Trend Calc`, `Dashboard Core`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **What connects `ADMIN_MODULOS`, `_adminProfiles`, `_adminCurrentRows` to the rest of the system?**
  _176 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Assistant Chat Module` be split into smaller, more focused modules?**
  _Cohesion score 0.056179775280898875 - nodes in this community are weakly interconnected._
- **Should `PDF Report Builder` be split into smaller, more focused modules?**
  _Cohesion score 0.052160493827160495 - nodes in this community are weakly interconnected._
- **Should `Import & Persistence Sync` be split into smaller, more focused modules?**
  _Cohesion score 0.05228070175438596 - nodes in this community are weakly interconnected._