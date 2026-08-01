# Graph Report - AnalyticSys  (2026-08-01)

## Corpus Check
- 44 files · ~284,988 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1885 nodes · 3881 edges · 90 communities (82 shown, 8 thin omitted)
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 483 edges (avg confidence: 0.56)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `1711c46d`
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
- renderImports
- notesRender
- renderDgConsumo
- escapeHtml
- cloud-backup.js
- fechRenderFromForm
- renderAusencias
- macro.js
- escR
- _pimRender
- Ferramentas (Tools) Dropdown Menu
- clearAllMicroFilters
- parseDate
- getFilteredData
- buildHealthPanel
- renderAnaliticoMicro
- processImportedRows
- buildCards
- applyColFilter
- _dgVgRenderChartGrupoMaterial
- _dgrGiroListaHtml
- _fechMgrGetTodosCandidatos
- help-badges.js
- varSymbol
- toast
- _mesclarGrandeComBanco
- lrcDelete
- _buildOptionsList
- toggleAllCentralis
- ocorrencias-supervisor.test.mjs
- lookup.js
- _rankEsc
- wipe-local.test.mjs
- shortcutRemapSave
- period-fab.js
- notif-supervisor.test.mjs
- relatorio-dais.test.mjs
- openModal
- openTool
- excluirImportacao
- cloud-backup.test.mjs
- dai-anexos-storage.test.mjs
- dai-sync-admin.test.mjs
- nome-token-ids.test.mjs
- excluirProducao
- autoria-notificacoes.test.mjs
- criador-nome.test.mjs
- integracao-local.test.mjs
- oc-donut-kpis.test.mjs
- rodarAnalitico
- handleSearchModal
- _getModuleTextFilteredData
- _dgrCapturarComTema
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
- _bkpCarregarArquivo
- Q: Why does CLOUD_BACKUP_MODULOS connect Cloud Backup Module to Admin Panel, Dashboard Conflict Detection, Dashboard Rendering & Cleanup, Import Deletion & Backup Sync?

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

## Communities (90 total, 8 thin omitted)

### Community 0 - "admin.js"
Cohesion: 0.05
Nodes (88): _ADMIN_COL_TYPES, ADMIN_MODAL_PROPRIO, ADMIN_MODULOS, adminAbrirEdicao(), adminAbrirEdicaoLote(), adminAbrirExclusaoMassa(), adminAceitarPendente(), adminAceitarTodosPendentes() (+80 more)

### Community 1 - "ocorrencias.js"
Cohesion: 0.05
Nodes (85): applyPhoneMask(), _bindOcDonutHover(), _buildOcCharts(), _buildOcDonut(), _buildOcHierarquiaBar(), _buildOcHierarquiaDetail(), buildOcKPIs(), _buildOcSublegenda() (+77 more)

### Community 2 - "assistente.js"
Cohesion: 0.06
Nodes (84): _ASST_DIM_LABEL, _ASST_DIM_LABEL_SING, _ASST_INTENTS, _ASST_MANUAL_FORMS, _ASST_MANUAL_REFRESH, _ASST_MESES, _ASST_METRICA_LABEL, _ASST_MODULOS (+76 more)

### Community 3 - "ui.js"
Cohesion: 0.04
Nodes (45): analiticoDetailState, _BKP_BIG_KEYS, _BKP_MODULES, _bkpSelected, _buildNavCache(), _buildSapIndex(), closeSidebar(), _COLFILTER_LIST_SCOPES (+37 more)

### Community 4 - "dashboard.js"
Cohesion: 0.04
Nodes (46): abrirSemCadastroModuloModal(), _ausCollapsed, _ausFilter, _ausFilterBuildOptions(), buildEntradaColumnMap(), buildLancamentoColumnMap(), buildSaidaColumnMap(), buildSapColumnMap() (+38 more)

### Community 5 - "trend.js"
Cohesion: 0.07
Nodes (62): openTrendModal(), SERIES_COLORS, _T, _tApplyCenFilter(), _tApplyMatFilter(), _tBuildCustoMedio(), _tBuildWeeks(), _tCmpTooltipShow() (+54 more)

### Community 6 - "config.js"
Cohesion: 0.06
Nodes (49): abrirCadastroFilialIndividual(), abrirCadastroMaterialIndividual(), abrirModalAcaoRelatorio(), _addFilialIndivRow(), _addMaterialIndivRow(), _configEhChaveSaude(), _configsSyncDelete(), _configsSyncUpsert() (+41 more)

### Community 7 - "inventario.js"
Cohesion: 0.06
Nodes (43): Ocorrências 'Ordenar' Micro-filter (31/07), fmt(), fmtR(), _invApplyJustValues(), invAtualizarAlertas(), invAtualizarKpis(), _invAtualizarProgresso(), invAtualizarSemCadastro() (+35 more)

### Community 8 - "notifications.js"
Cohesion: 0.07
Nodes (55): RECORD_INTEGRATION_TABLES, _ACTIVITY_AUTH_LABEL, _ACTIVITY_EXTRA_COLS, _ACTIVITY_MODULE_COLOR, _ACTIVITY_OP_LABEL, _ACTIVITY_VERB, _activityBatchData, _activityBatchTimers (+47 more)

### Community 9 - "dai.js"
Cohesion: 0.08
Nodes (53): DAI Generator Modal (Documento de Ajuste de Inventário), Ocorrências Page, abrirModalDai(), adicionarAnexoDaiExistente(), baixarZipDai(), _daiAddInformanteRow(), _daiAddItemRow(), daiAdicionarAnexos() (+45 more)

### Community 10 - "agregados.js"
Cohesion: 0.08
Nodes (52): agrApplyFilters(), _agrBuildResumo(), agrClearDropdown(), agrClearFilters(), agrCloseDropdown(), _agrCompute(), _agrCutoffDate(), _agrDateKey() (+44 more)

### Community 11 - "mensagens.js"
Cohesion: 0.08
Nodes (46): AVATAR_COLOR_VARS, _avatarHash(), avatarHTML(), avatarInfo(), _msgsAbrirAnexo(), msgsAbrirConversa(), _msgsAnexoHTML(), _msgsAtualizarBadges() (+38 more)

### Community 12 - "format.js"
Cohesion: 0.05
Nodes (36): _calc, calcAction(), _calcCompute(), _calcFmt(), _calcUpdateDisplay(), closeSearchModal(), _COLOR_MAP, _fechConfig (+28 more)

### Community 13 - "normalize.js"
Cohesion: 0.07
Nodes (47): buildFilialLookupIndex(), buildMaterialLookupIndex(), _carregarNomesOriginais(), CATEGORIA_MODULOS, CATEGORIAS_MATERIAL, CENTRAL_FIELDS_BY_MODULO, checarWipePendente(), _donosPorTabela (+39 more)

### Community 14 - "auth.js"
Cohesion: 0.10
Nodes (37): Auth Gate — Login / Password Recovery Screen (Fase 1), Idle / Inactivity Auto-Logout Warning (Fase 1), _accountModalSalvar(), _accountModalTrocarSenha(), _accountRenderAvatars(), AVATAR_EXT_POR_MIME, bootApp(), clearError() (+29 more)

### Community 15 - "state.js"
Cohesion: 0.07
Nodes (29): _supaDeleteOwned(), applyTheme(), closeThemeSwitcher(), domCache, filters, getFieldCandidates(), getSavedTheme(), hasRequiredReferenceData() (+21 more)

### Community 16 - "analitico.js"
Cohesion: 0.06
Nodes (25): _anStockCache, _closeBdPortal(), _ensureBdPortal(), _gsHighlight(), handleGlobalSearch(), _microFilter, _microFilterResults, _MODAL_ESC_JA_TRATADO (+17 more)

### Community 17 - "import.js"
Cohesion: 0.12
Nodes (25): _CASCADE_TABELAS_NUVEM, _cascadeRestoreCloudByImportId(), _criarRegistroEntrada(), _criarRegistroLancamento(), _criarRegistroSaida(), _criarRegistroSAP(), _entradasSyncUpsert(), _entradasSyncUpsertBatch() (+17 more)

### Community 18 - "ncd.js"
Cohesion: 0.13
Nodes (30): NCD_COR, NCD_SAP_CODIGOS, ncdAbrirModal(), _ncdAplicarCnpj(), _ncdCodigoMap, _ncdCodigoMaterial(), _ncdColetarGrupos(), _ncdCpfValido() (+22 more)

### Community 19 - "relatorio.js"
Cohesion: 0.10
Nodes (10): _ausGetPeriodo(), _buildAusenciasRelHTML(), _buildRankingShellHTML(), _dgrFonteIconesEmbutida(), _dgrFontesEmbutidas(), _dgrScriptAbas(), _dgrScriptCollapse(), _dgrScriptDownload() (+2 more)

### Community 20 - "_fechMgrRender"
Cohesion: 0.10
Nodes (26): abrirFechManager(), buildColFilterHTML(), fecharFechImportModal(), fecharFechManager(), _fechImportAplicar(), _fechMgrAplicarFiltros(), _fechMgrAplicarLote(), _fechMgrApplyColFilter() (+18 more)

### Community 21 - "renderDgVisaoGeralPdf"
Cohesion: 0.10
Nodes (26): buildDashboardGerencialResults(), _daBuildEntradasFlat(), _daBuildRanking(), _daBuildTabelaMaterial(), _daPesoMedioPorTipo(), _daRenderDetalhadoAnalitico(), dateCmp(), _daVarIrrelevante() (+18 more)

### Community 22 - "renderModule"
Cohesion: 0.18
Nodes (24): getMateriaisSemCadastroDoModulo(), _pendPadronizacaoBtnHtml(), removerRegistro(), renderAcoesRelatorio(), renderAll(), renderConfigs(), renderDuplicatasCadastroMateriais(), renderEntradas() (+16 more)

### Community 23 - "persist.js"
Cohesion: 0.18
Nodes (19): applySavedState(), buildStateSnapshot(), compactSapRecords(), daiAnexoKey(), flushPersistQueue(), idbDeleteAnexosDai(), idbGet(), idbGetAnexoDai() (+11 more)

### Community 24 - "renderImports"
Cohesion: 0.14
Nodes (17): filtrarLista(), getListFilteredData(), getListPageData(), _getScopeTextFilteredData(), _importStatusBadge(), initResizable(), irParaPagina(), irParaUltima() (+9 more)

### Community 25 - "notesRender"
Cohesion: 0.16
Nodes (22): notesAutoSave(), notesCloseEditor(), notesDeleteCard(), notesDeleteCurrent(), notesEditorUpdate(), notesExec(), _notesFromDbRow(), notesInsertChecklist() (+14 more)

### Community 26 - "renderDgConsumo"
Cohesion: 0.13
Nodes (21): _dcBuildRankingCentrais(), _dcBuildRankingMateriais(), _dcCalcGiroCoberturaGeral(), _dcRenderChartRanking(), _dcRenderKpiStrip(), _dgDeltaBadgeHtml(), _dgRankCardHtml(), _dgResolveCssColor() (+13 more)

### Community 27 - "escapeHtml"
Cohesion: 0.13
Nodes (20): CODIGOS_ENTRADA, buildAnaliticoDetailBreakdown(), buildAnaliticoDetailHtml(), buildPendIntegSection(), _buildSaidasIndex(), calcPendentesIntegracao(), ensureSaidasIndex(), escapeHtml() (+12 more)

### Community 28 - "cloud-backup.js"
Cohesion: 0.20
Nodes (19): Admin Health — Storage Tab (28/07), _cbBackupTodosModulos(), _cbGuardarGeracaoAnterior(), _cbGunzipBlob(), _cbGzipString(), _cbLastBackupAt, _cbLerGeracao(), _cbRestaurarModulo() (+11 more)

### Community 29 - "fechRenderFromForm"
Cohesion: 0.15
Nodes (19): fechAddAlert(), fechAddItem(), fechamentoResetarTexto(), _fechDefaultFields(), _fechGetFields(), _fechLastWeekday(), _fechLastWorkdayOfMonth(), _fechLoadAllSaved() (+11 more)

### Community 30 - "renderAusencias"
Cohesion: 0.17
Nodes (18): applyAusFilter(), ausCollapseAll(), _ausDateStr(), ausExpandAll(), _ausFilterSyncClear(), _ausFilterSyncLabel(), ausToggleAllCentralis(), ausToggleAllRegionais() (+10 more)

### Community 31 - "macro.js"
Cohesion: 0.21
Nodes (16): _calcTrend(), _getTip(), _hideTip(), _levelColor, _levelFromScore(), _levelLabel, _levelSev, macroApplyFilter() (+8 more)

### Community 32 - "escR"
Cohesion: 0.17
Nodes (18): buildCentralBlock(), buildCentralRow(), buildCentralSection(), buildDaiRow(), buildMotivoRow(), buildOcorrenciaRow(), buildRegionalRow(), buildRegionalSection() (+10 more)

### Community 33 - "_pimRender"
Cohesion: 0.27
Nodes (10): _nfNeedsConversionWarning(), openPendIntegModal(), _pimApplyFilters(), pimGoToPage(), _pimItemDate(), _pimMatchesSearch(), _pimMonthKey(), _pimRender() (+2 more)

### Community 34 - "Ferramentas (Tools) Dropdown Menu"
Cohesion: 0.13
Nodes (16): .serena/project.yml — Serena Project Config, AnalyticSys (Product — Estoque · Insumos System), index.html — AnalyticSys Main App Shell (SPA), Admin — Formulário Público Section (public link + analyst/category routing), Admin / Supervisão Page, Assistente (Chat Assistant) Popover, Backup / Restaurar por Módulos Modal, Calculadora Popover (Basic + Stock-Analytic tabs) (+8 more)

### Community 35 - "clearAllMicroFilters"
Cohesion: 0.23
Nodes (18): applyMicroFilter(), _applyMicroVisibility(), cancelMicroFilter(), clearAllMicroFilters(), clearMicroFilter(), _closeMicroFilterDropdown(), _microFilterBar(), _microRecomputeOptions() (+10 more)

### Community 36 - "parseDate"
Cohesion: 0.24
Nodes (10): _ausComputar(), _ausContextoMaterial(), _ausEnsureEntSaiIdx(), _ausInvalidateCache(), _ausInvalidateEntSaiIdx(), ausQuickOntem(), ausQuickTercaAnterior(), _ausUltimoLanc() (+2 more)

### Community 37 - "getFilteredData"
Cohesion: 0.15
Nodes (21): _abrirModalDetalheMaterial(), _abrirModalDetalheMaterialFromEl(), _agruparRegistros(), _applyModuleSort(), _buildResumoCardsHtml(), _convertNfPesoToKg(), _fecharModalDetalheMaterial(), getFilteredData() (+13 more)

### Community 38 - "buildHealthPanel"
Cohesion: 0.15
Nodes (15): buildHealthPanel(), _buildLancIndex(), buildSnapshot(), calcHealthScore(), classifyVariation(), detectCatFromMat(), detectCatKey(), getHealthThresholds() (+7 more)

### Community 39 - "renderAnaliticoMicro"
Cohesion: 0.19
Nodes (14): _anClearStockCache(), _anGetLastPeriodStockFallback(), _anGetPrePeriodStock(), _anGetPrevDayStock(), anSwitchView(), _applyGroupPendHighlight(), buildAbsentTooltip(), buildCentralCard() (+6 more)

### Community 40 - "processImportedRows"
Cohesion: 0.15
Nodes (14): conflictConfirm(), _detectConflicts(), _fpEntrada(), _fpLancamento(), _fpProducao(), _fpSaida(), _fpSap(), _mergeDedup() (+6 more)

### Community 41 - "buildCards"
Cohesion: 0.24
Nodes (14): buildCards(), _buildCriticidadeData(), buildLevelSection(), buildMatRows(), buildRows(), escC(), fmtKgC(), fmtKgR() (+6 more)

### Community 42 - "applyColFilter"
Cohesion: 0.29
Nodes (14): applyColFilter(), clearAllColFilters(), clearColFilter(), closeColFilterPopover(), colHasFilter(), ensureColFilters(), getColUniqueValues(), injectColFilterButtons() (+6 more)

### Community 43 - "_dgVgRenderChartGrupoMaterial"
Cohesion: 0.18
Nodes (13): _dgVgAgruparOutros(), _dgVgBuildCentralHealthData(), _dgVgBuildHealthDonutData(), _dgVgDrawDonutSvg(), _dgVgHealthTipHtml(), _dgVgMaterialTipHtml(), _dgVgRenderChartGrupoMaterial(), _dgVgRenderCustoDonutSvg() (+5 more)

### Community 44 - "_dgrGiroListaHtml"
Cohesion: 0.19
Nodes (13): _dgrAbastInfo(), _dgrBuildCustoRegionalCentralHtml(), _dgrBuildDetalhadoAnaliticoHtml(), _dgrBuildGiroCoberturaHtml(), _dgrBuildResumoPeriodoHtml(), _dgrGiroCor(), _dgrGiroListaHtml(), _dgrNivelCor() (+5 more)

### Community 45 - "_fechMgrGetTodosCandidatos"
Cohesion: 0.24
Nodes (13): _bdmFechExcluidosHtml(), _fechImportNormDoc(), _fechImportPreVisualizar(), _fechMesIndice(), _fechMgrGetTodosCandidatos(), _getFechOverrideSet(), _getInvJustDocSet(), getSapFechKey() (+5 more)

### Community 46 - "help-badges.js"
Cohesion: 0.36
Nodes (11): _buildHelpContent(), _getHelpTip(), HELP_DEFS, hideCustoMedTip(), _hideHelpTip(), initHelpBadges(), moveCustoMedTip(), _moveHelpTip() (+3 more)

### Community 47 - "varSymbol"
Cohesion: 0.33
Nodes (11): _daColorFor(), _daFmtCountSigned(), _daFmtMoneySigned(), _daFmtPctSigned(), _daMaiorImpacto(), _daRenderRanking(), _daRenderTabelaMaterial(), _dgVgRenderExtremos() (+3 more)

### Community 48 - "toast"
Cohesion: 0.24
Nodes (11): calcCopy(), confirmarComUndo(), fechamentoAbrirPrint(), fechamentoCopiarWhatsapp(), fechamentoGerarImagem(), _fechFmtDate(), _fechGerarImagemCanvas(), _fechGetPlainText() (+3 more)

### Community 49 - "_mesclarGrandeComBanco"
Cohesion: 0.18
Nodes (11): _entradasFromDbRow(), _lancFromDbRow(), _mesclarGrandeComBanco(), _producaoFromDbRow(), _saidasFromDbRow(), _sapFromDbRow(), syncEntradasFromSupabase(), syncLancamentosFromSupabase() (+3 more)

### Community 50 - "lrcDelete"
Cohesion: 0.12
Nodes (21): bkpConfirmar(), _bkpParseStreaming(), closeLancConflictModal(), _exportarModulos(), _invalidateLancDupCache(), invalidateLancIndex(), _invalidateMatTransferPairCache(), invalidateSaidasIndex() (+13 more)

### Community 51 - "_buildOptionsList"
Cohesion: 0.29
Nodes (7): _buildOptionsList(), _buildVariacaoOptions(), filterMicroOptions(), _syncVarDropdownToState(), toggleMicroFilter(), _updateVarHint(), _varFilterChange()

### Community 52 - "toggleAllCentralis"
Cohesion: 0.22
Nodes (10): collapseAllMicro(), expandAllMicro(), toggleAllCentralis(), toggleAllRegionais(), toggleMicro(), toggleRegional(), _updateCentralFocus(), _updateRegionalFocus() (+2 more)

### Community 53 - "ocorrencias-supervisor.test.mjs"
Cohesion: 0.22
Nodes (7): casos, daiBase, fonteOcorrencias, montar(), montarComSupabase(), raiz, rowBase

### Community 54 - "lookup.js"
Cohesion: 0.28
Nodes (5): _filterDebounceTimers, filterRecords(), _getOrBuildIndex(), recordMatchesSearch(), _searchIndex

### Community 55 - "_rankEsc"
Cohesion: 0.25
Nodes (9): _buildRankingCentraisBody(), _buildRankingRegionaisTableBlock(), _buildRankSideCard(), _dgrBuildCustoAbsolutoHtml(), _dgrBuildSaudeGeralHtml(), _rankCompactarDias(), _rankEsc(), _rankSeverityCentrais() (+1 more)

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

### Community 63 - "excluirImportacao"
Cohesion: 0.33
Nodes (7): _cascadeDeleteCloudByImportId(), _cbReforcarBackupModulos(), excluirImportacao(), _importsSyncDelete(), _importsSyncUpsert(), _importsToDbRow(), reconcilePendingDeletes()

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

### Community 68 - "excluirProducao"
Cohesion: 0.29
Nodes (7): _criarRegistroProducao(), excluirProducao(), _producaoSyncDelete(), _producaoSyncUpsert(), _producaoSyncUpsertBatch(), _producaoToDbRow(), salvarProducao()

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
Cohesion: 0.33
Nodes (3): casos, fonteOcorrencias, raiz

### Community 73 - "rodarAnalitico"
Cohesion: 0.60
Nodes (5): rodarAnalitico(), setQuickPeriod(), setQuickPeriodCurrentMonth(), setQuickPeriodCurrentYear(), toISODate()

### Community 74 - "handleSearchModal"
Cohesion: 0.50
Nodes (5): handleSearchModal(), openSearchModal(), _renderSmHint(), _runSearchModal(), _smHighlight()

### Community 75 - "_getModuleTextFilteredData"
Cohesion: 0.60
Nodes (5): getLancamentoDuplicateKeys(), getLancamentoRecordKey(), _getModuleTextFilteredData(), getSapDuplicateKeys(), getSapRecordKey()

### Community 76 - "_dgrCapturarComTema"
Cohesion: 0.33
Nodes (6): Ausências de Lançamento Panel (Lançamentos page), calendar.js — Date-range Picker Logic, _dgrCanvasParaPngDataUrl(), _dgrCapturarCategoriaAmpliada(), _dgrCapturarComTema(), _dgrSvgParaPngDataUrl()

### Community 77 - "Cloudflare Turnstile (CAPTCHA / Bot Protection Widget)"
Cohesion: 0.67
Nodes (3): Cloudflare Turnstile (CAPTCHA / Bot Protection Widget), Turnstile Widget (Login form), Turnstile Widget (Public Form)

### Community 87 - "init"
Cohesion: 0.22
Nodes (9): _alertasLabel(), closeGlobalSearch(), init(), _nextLancLabel(), restoreSidebarState(), _saudeGeralLabel(), setupKeyboardShortcuts(), setupModalCloseOnEscape() (+1 more)

### Community 88 - "_bkpCarregarArquivo"
Cohesion: 0.33
Nodes (7): abrirModalBackup(), _bkpCarregarArquivo(), bkpHandleDrop(), bkpSelectAll(), bkpSwitchTab(), _renderBkpModuleList(), restaurarBackupModular()

### Community 89 - "Q: Why does CLOUD_BACKUP_MODULOS connect Cloud Backup Module to Admin Panel, Dashboard Conflict Detection, Dashboard Rendering & Cleanup, Import Deletion & Backup Sync?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Why does CLOUD_BACKUP_MODULOS connect Cloud Backup Module to Admin Panel, Dashboard Conflict Detection, Dashboard Rendering & Cleanup, Import Deletion & Backup Sync?, Source Nodes

## Knowledge Gaps
- **219 isolated node(s):** `Answer`, `Outcome`, `Source Nodes`, `_MESES_BR`, `_MESES_FULL` (+214 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `CLOUD_BACKUP_MODULOS` connect `cloud-backup.js` to `admin.js`, `processImportedRows`, `renderModule`, `excluirImportacao`?**
  _High betweenness centrality (0.093) - this node is a cross-community bridge._
- **Why does `removerRegistro()` connect `renderModule` to `analitico.js`, `dashboard.js`, `cloud-backup.js`?**
  _High betweenness centrality (0.080) - this node is a cross-community bridge._
- **Why does `adminConfirmarExclusaoMassa()` connect `admin.js` to `cloud-backup.js`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **What connects `Answer`, `Outcome`, `Source Nodes` to the rest of the system?**
  _219 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `admin.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05423094904160823 - nodes in this community are weakly interconnected._
- **Should `ocorrencias.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05002337540906966 - nodes in this community are weakly interconnected._
- **Should `assistente.js` be split into smaller, more focused modules?**
  _Cohesion score 0.056179775280898875 - nodes in this community are weakly interconnected._