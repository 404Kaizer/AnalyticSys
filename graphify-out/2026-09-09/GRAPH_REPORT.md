# Graph Report - AnalyticSys  (2026-09-09)

## Corpus Check
- 57 files · ~380,085 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2477 nodes · 5152 edges · 122 communities (113 shown, 9 thin omitted)
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 595 edges (avg confidence: 0.56)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `af913e68`
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
- applyColFilter
- notesRender
- dgFmtPeso
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
- getFilteredData
- _buildOcHierarquiaBar
- renderAnaliticoMicro
- capacidades.js
- buildCards
- pendencias.js
- renderOcorrencias
- _dgmLinhaHtml
- _fechMgrGetTodosCandidatos
- help-badges.js
- _dgrExportaveis
- toast
- populateOcFiltros
- _cubGet
- _setModalCadastroModo
- microFocusFromMacro
- ocorrencias-supervisor.test.mjs
- lookup.js
- escapeHtml
- wipe-local.test.mjs
- shortcutRemapSave
- period-fab.js
- notif-supervisor.test.mjs
- relatorio-dais.test.mjs
- buildHealthPanel
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
- _gsrRenderTabela
- diagnosticarDivergenciaSapPuzl
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
- syncLoadingElapsed
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
- renderFatoresConversao
- aus-fim-de-mes.test.mjs
- sap-fechamento-override.test.mjs
- _buildRankingShellHTML
- upsertMateriais
- _buildVariacaoOptions
- _setBtnLoading
- salvarNovoGrupoMaterial
- getCodigosSapDisponiveis
- _configEhChaveSaude
- relatorio-gerencial-clone.test.mjs
- _checarNovosParaImportar
- _dgmMesLabel
- exportarSapCsv
- _mesclarGrandeComBanco
- AGENTS.md
- excluirImportacao
- _rankEsc
- relatorio-giro-usina.test.mjs
- _dgrEvolucaoTabelaHtml
- _custosSapSyncUpsert
- movNaoClassificado
- _buildCentralOptionsHtml

## God Nodes (most connected - your core abstractions)
1. `renderDgVisaoGeralPdf()` - 31 edges
2. `adminLoadModulo()` - 25 edges
3. `_dgrExportaveis()` - 24 edges
4. `escapeHtml()` - 23 edges
5. `_adminEsc()` - 22 edges
6. `_fechMgrRender()` - 22 edges
7. `_rankEsc()` - 21 edges
8. `_adminErroDetalhe()` - 20 edges
9. `renderOcorrencias()` - 20 edges
10. `renderCapacidades()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `safeJSONParse()` --indirect_call--> `error()`  [INFERRED]
  js/state.js → tests/calendar-oc.test.mjs
- `Admin — Formulário Público Section (public link + analyst/category routing)` --shares_data_with--> `solicitacao.html — Public Stock Movement Request Form`  [INFERRED]
  index.html → solicitacao.html
- `buildCentralCard()` --indirect_call--> `makeResizable()`  [INFERRED]
  js/analitico.js → js/ui.js
- `init()` --indirect_call--> `updateToolsTheme()`  [INFERRED]
  js/analitico.js → js/state.js
- `_dgrExportaveis()` --indirect_call--> `_dgVgDestroyChart()`  [INFERRED]
  js/relatorio.js → js/dashboard.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Entradas/Saídas/Lançamentos/SAP pages share the generic Add-Record modal, sort and pagination functions** — index_page_entradas, index_page_saidas, index_page_lancamentos, index_page_sap, index_modal_manual [INFERRED 0.85]
- **Calculadora/Notas/Assistente/Mensagens all implement the same generic tool-popover open/close pattern (openTool/closeTool, .tool-popover)** — index_calc_popover, index_notes_popover, index_assistente_popover, index_mensagens_popover [EXTRACTED 1.00]
- **DAI generation, Ocorrências, and the public-form/admin routing jointly form the inventory-adjustment reporting flow** — index_dai_modal, index_ocorrencias_page, index_admin_formpublico, solicitacao [INFERRED 0.75]

## Communities (122 total, 9 thin omitted)

### Community 0 - "admin.js"
Cohesion: 0.05
Nodes (93): _ADMIN_COL_TYPES, ADMIN_MODAL_PROPRIO, ADMIN_MODULOS, adminAbrirEdicao(), adminAbrirEdicaoLote(), adminAbrirExclusaoMassa(), adminAceitarPendente(), adminAceitarTodosPendentes() (+85 more)

### Community 1 - "ocorrencias.js"
Cohesion: 0.11
Nodes (19): applyPhoneMask(), closeOcorrenciaModal(), fmtPhoneDisplay(), getOcorrencias(), initPhoneMasks(), _nextOcId(), OC_DONUT_META, _OC_FILTER_KEY_LABELS (+11 more)

### Community 2 - "assistente.js"
Cohesion: 0.06
Nodes (84): _ASST_DIM_LABEL, _ASST_DIM_LABEL_SING, _ASST_INTENTS, _ASST_MANUAL_FORMS, _ASST_MANUAL_REFRESH, _ASST_MESES, _ASST_METRICA_LABEL, _ASST_MODULOS (+76 more)

### Community 3 - "ui.js"
Cohesion: 0.03
Nodes (60): abrirModalBackup(), analiticoDetailState, _BDM_NIVEL_ESTILO, _BKP_BIG_KEYS, _BKP_MODULES, _bkpCarregarArquivo(), bkpHandleDrop(), _bkpParseStreaming() (+52 more)

### Community 4 - "dashboard.js"
Cohesion: 0.03
Nodes (61): abrirSemCadastroModuloModal(), _ausCollapsed, _ausFilter, buildEntradaColumnMap(), buildLancamentoColumnMap(), buildSaidaColumnMap(), buildSapColumnMap(), CODIGOS_SAIDA (+53 more)

### Community 5 - "trend.js"
Cohesion: 0.07
Nodes (62): openTrendModal(), SERIES_COLORS, _T, _tApplyCenFilter(), _tApplyMatFilter(), _tBuildCustoMedio(), _tBuildWeeks(), _tCmpTooltipShow() (+54 more)

### Community 6 - "config.js"
Cohesion: 0.07
Nodes (12): abrirModalAcaoRelatorio(), _codigosSapSessionExtras, editarAcaoRelatorio(), editConfig(), focusFilialImport(), focusMaterialImport(), _IMPORTAR_DE_CFG, limparFiliais() (+4 more)

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
Nodes (30): _calc, calcAction(), _calcCompute(), _calcFmt(), _calcUpdateDisplay(), _COLOR_MAP, _CUB_FAIXAS, _CUB_SUBS (+22 more)

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
Cohesion: 0.05
Nodes (43): _alertasLabel(), _anStockCache, _capFilter, _capFilterChange(), _closeBdPortal(), closeGlobalResults(), _ensureBdPortal(), _GS_COLS (+35 more)

### Community 17 - "import.js"
Cohesion: 0.09
Nodes (32): _CASCADE_TABELAS_NUVEM, _cascadeRestoreCloudByImportId(), _criarRegistroEntrada(), _criarRegistroLancamento(), _criarRegistroSaida(), _criarRegistroSAP(), _custosSapFromDbRow(), _custosSapRealtimeInit() (+24 more)

### Community 18 - "ncd.js"
Cohesion: 0.13
Nodes (30): NCD_COR, NCD_SAP_CODIGOS, ncdAbrirModal(), _ncdAplicarCnpj(), _ncdCodigoMap, _ncdCodigoMaterial(), _ncdColetarGrupos(), _ncdCpfValido() (+22 more)

### Community 19 - "relatorio.js"
Cohesion: 0.04
Nodes (13): _DGM_COLUNAS, _DGM_NIVEL_ICONE, _DGM_PESO_EIXO, _dgmState, _DGR_NOMES, _dgrChartJsEmbutido(), _dgrEmitirCodigo(), _dgrEscaparScript() (+5 more)

### Community 20 - "_fechMgrRender"
Cohesion: 0.08
Nodes (32): abrirFechManager(), buildColFilterHTML(), fecharFechImportModal(), fecharFechManager(), _fechImportAplicar(), _fechInvUnlockRealtimeInit(), _fechMgrAplicarDesbloqueio(), _fechMgrAplicarFiltros() (+24 more)

### Community 21 - "renderDgVisaoGeralPdf"
Cohesion: 0.08
Nodes (30): _daBuildEntradasFlat(), DG_VG_CAT_ORDER, _dgVgAggKgPorChave(), _dgVgAggPorChave(), _dgVgAgruparCustoVariacaoPorCategoria(), _dgVgAgruparOutros(), _dgVgBuildCentralHealthData(), _dgVgBuildHealthDonutData() (+22 more)

### Community 22 - "renderModule"
Cohesion: 0.11
Nodes (36): atualizarBarraLote(), _custosSapOutlierInfo(), _custosSapResolveMaterial(), _donoDisplay(), excluirSelecionados(), getGrupoSapPorCodigoIndex(), getMateriaisSemCadastroDoModulo(), initAusencias() (+28 more)

### Community 23 - "persist.js"
Cohesion: 0.18
Nodes (19): applySavedState(), buildStateSnapshot(), compactSapRecords(), daiAnexoKey(), flushPersistQueue(), idbDeleteAnexosDai(), idbGet(), idbGetAnexoDai() (+11 more)

### Community 24 - "applyColFilter"
Cohesion: 0.10
Nodes (32): applyColFilter(), clearAllColFilters(), clearColFilter(), closeColFilterPopover(), _colFilterFieldValue(), colHasFilter(), ensureColFilters(), filtrarLista() (+24 more)

### Community 25 - "notesRender"
Cohesion: 0.16
Nodes (22): notesAutoSave(), notesCloseEditor(), notesDeleteCard(), notesDeleteCurrent(), notesEditorUpdate(), notesExec(), _notesFromDbRow(), notesInsertChecklist() (+14 more)

### Community 26 - "dgFmtPeso"
Cohesion: 0.09
Nodes (32): buildDashboardGerencialResults(), buildGiroPorCentralMaterial(), _consumoKgSaidas(), dateCmp(), _dcBuildRankingCentrais(), _dcBuildRankingMateriais(), _dcCalcGiroCoberturaGeral(), _dcRenderChartRanking() (+24 more)

### Community 27 - "lrcDelete"
Cohesion: 0.09
Nodes (26): bkpConfirmar(), buildAnaliticoDetailHtml(), closeLancConflictModal(), _ensureFloatTip(), _exportarModulos(), _floatTipModo(), initAbsentTooltips(), _invalidateLancDupCache() (+18 more)

### Community 28 - "cloud-backup.js"
Cohesion: 0.20
Nodes (19): Admin Health — Storage Tab (28/07), _cbBackupTodosModulos(), _cbGuardarGeracaoAnterior(), _cbGunzipBlob(), _cbGzipString(), _cbLastBackupAt, _cbLerGeracao(), _cbRestaurarModulo() (+11 more)

### Community 29 - "fechRenderFromForm"
Cohesion: 0.14
Nodes (20): fechAddAlert(), fechAddItem(), fechamentoResetarTexto(), _fechDefaultFields(), _fechGetFields(), _fechLastWeekday(), _fechLastWorkdayOfMonth(), _fechLoadAllSaved() (+12 more)

### Community 30 - "renderAusencias"
Cohesion: 0.15
Nodes (20): applyAusFilter(), ausCollapseAll(), _ausDateStr(), ausExpandAll(), _ausFilterBuildOptions(), _ausFilterSyncClear(), _ausFilterSyncLabel(), ausToggleAllCentralis() (+12 more)

### Community 31 - "macro.js"
Cohesion: 0.17
Nodes (17): _dgVgDrawDonutSvg(), _calcTrend(), _getTip(), _hideTip(), _levelColor, _levelFromScore(), _levelLabel, _levelSev (+9 more)

### Community 32 - "escR"
Cohesion: 0.18
Nodes (17): buildCentralRow(), buildCentralSection(), buildDaiRow(), buildMotivoRow(), buildOcorrenciaRow(), buildRegionalRow(), buildRegionalSection(), buildStatusBadge() (+9 more)

### Community 33 - "_pimRender"
Cohesion: 0.22
Nodes (13): _convertNfPesoToKg(), _lookupFatorConversao(), _nfNeedsConversionWarning(), _normalizarUM(), openPendIntegModal(), _pimApplyFilters(), pimGoToPage(), _pimItemDate() (+5 more)

### Community 34 - "solicitacao.js"
Cohesion: 0.08
Nodes (54): adicionarAnexos(), adicionarInformante(), adicionarItemMaterial(), _anexos, _atualizarVariacao(), avancarStep(), boot(), _calcVariacaoBalanca() (+46 more)

### Community 35 - "clearAllMicroFilters"
Cohesion: 0.15
Nodes (27): applyMicroFilter(), _applyMicroVisibility(), _buildCapacidadeOptions(), _buildOptionsList(), cancelMicroFilter(), _capFilterIsActive(), _cardCapFaixas(), _cardPassesCapFilter() (+19 more)

### Community 36 - "parseDate"
Cohesion: 0.18
Nodes (14): _ausComputar(), _ausContextoMaterial(), _ausEnsureEntSaiIdx(), _ausInvalidateCache(), _ausInvalidateEntSaiIdx(), ausQuickOntem(), ausQuickTercaAnterior(), _ausUltimoDiaUtilMes() (+6 more)

### Community 37 - "getFilteredData"
Cohesion: 0.14
Nodes (23): _abrirModalDetalheMaterial(), _abrirModalDetalheMaterialFromEl(), _agruparRegistros(), _applyModuleSort(), _bdmFechExcluidosHtml(), _buildResumoCardsHtml(), _fecharModalDetalheMaterial(), getFilteredData() (+15 more)

### Community 38 - "_buildOcHierarquiaBar"
Cohesion: 0.18
Nodes (17): _buildOcHierarquiaBar(), _buildOcHierarquiaDetail(), buildWhatsAppLink(), fmtDateBR(), _ocAbrirMenuCard(), _ocCompararOrdenacao(), _ocDetectarMudancaPrioritaria(), _ocFecharMenuCard() (+9 more)

### Community 39 - "renderAnaliticoMicro"
Cohesion: 0.15
Nodes (18): _anClearStockCache(), _anGetCustosSapIdx(), _anGetLastPeriodStockFallback(), _anGetPrevDayStock(), _anGetSapStock(), _anGetSapTheoreticalStock(), _applyGroupPendHighlight(), buildAbsentTooltip() (+10 more)

### Community 40 - "capacidades.js"
Cohesion: 0.07
Nodes (69): abrirEdicaoCapacidadesSelecionadas(), abrirEstruturaCapacidade(), adicionarUnidadeEstrutura(), buildCapacidadeSection(), CAP_ARMAZENAGEM, CAP_BUSCA_CAMPOS, CAP_CATS_PCT, CAP_FAIXAS (+61 more)

### Community 41 - "buildCards"
Cohesion: 0.22
Nodes (15): buildCards(), buildCentralBlock(), _buildCriticidadeData(), buildLevelSection(), buildMatRows(), buildRows(), escC(), fmtKgC() (+7 more)

### Community 42 - "pendencias.js"
Cohesion: 0.10
Nodes (42): _pendAgruparEstoque(), _pendAgruparInteg(), pendAtualizarContadorAba(), _pendCelulaCentral(), pendCloseGeral(), pendConsiderar(), _pendConsiderarBtn(), pendConsiderarTodas() (+34 more)

### Community 43 - "renderOcorrencias"
Cohesion: 0.23
Nodes (15): closeConcluirModal(), closeInconclusivaModal(), confirmarExcluirAjusteSistemico(), confirmarExcluirOcorrencia(), deleteOcorrencia(), _ocNomeAtor(), _ocSyncDelete(), _ocSyncUpsert() (+7 more)

### Community 44 - "_dgmLinhaHtml"
Cohesion: 0.21
Nodes (13): _dgmAjudaAbast(), _dgmAjudaCobertura(), _dgmAjudaGiro(), _dgmAjudaNivel(), _dgmCoberturaInfo(), _dgmLinhaHtml(), _dgrAbastInfo(), _dgrBuildGiroCoberturaHtml() (+5 more)

### Community 45 - "_fechMgrGetTodosCandidatos"
Cohesion: 0.35
Nodes (11): _fechImportNormDoc(), _fechImportPreVisualizar(), _fechMesIndice(), _fechMgrGetTodosCandidatos(), _getFechInvUnlockSet(), _getFechOverrideSet(), _getInvJustDocSet(), getSapFechKey() (+3 more)

### Community 46 - "help-badges.js"
Cohesion: 0.36
Nodes (11): _buildHelpContent(), _getHelpTip(), HELP_DEFS, hideCustoMedTip(), _hideHelpTip(), initHelpBadges(), moveCustoMedTip(), _moveHelpTip() (+3 more)

### Community 47 - "_dgrExportaveis"
Cohesion: 0.25
Nodes (18): _daBuildRanking(), _daBuildTabelaMaterial(), _daColorFor(), _daFmtCountSigned(), _daFmtMoneySigned(), _daFmtPctSigned(), _daMaiorImpacto(), _daPesoMedioPorTipo() (+10 more)

### Community 48 - "toast"
Cohesion: 0.27
Nodes (11): calcCopy(), confirmarComUndo(), _cubAbrirPrint(), fechamentoAbrirPrint(), fechamentoCopiarWhatsapp(), fechamentoGerarImagem(), _fechFmtDate(), _fechGerarImagemCanvas() (+3 more)

### Community 49 - "populateOcFiltros"
Cohesion: 0.20
Nodes (12): getOcorrenciasFiltradas(), OC_SORT_OPTIONS, _ocBuildOptionsList(), _ocCloseOrdenarDropdown(), ocFilterMicroOptions(), _ocRegionalPorCentral(), ocSetOrdenar(), ocStatusMatches() (+4 more)

### Community 50 - "_cubGet"
Cohesion: 0.17
Nodes (24): _cubCalcCelula(), cubCalcular(), _cubDefaults(), _cubFaixa(), _cubGet(), _cubJanela(), cubLimparOverride(), _cubN() (+16 more)

### Community 51 - "_setModalCadastroModo"
Cohesion: 0.23
Nodes (12): abrirCadastroFiliaisEmLote(), abrirCadastroFilialIndividual(), abrirCadastroMateriaisEmLote(), abrirCadastroMaterialIndividual(), abrirEdicaoFiliaisEmLote(), abrirEdicaoFilial(), abrirEdicaoMateriaisEmLote(), abrirEdicaoMateriaisSelecionados() (+4 more)

### Community 52 - "microFocusFromMacro"
Cohesion: 0.14
Nodes (20): _anComOverlay(), _anHideViewLoading(), anSetGroupMode(), _anShowViewLoading(), anSwitchView(), _anSyncGroupModeUI(), collapseAllMicro(), expandAllMicro() (+12 more)

### Community 53 - "ocorrencias-supervisor.test.mjs"
Cohesion: 0.20
Nodes (7): casos, daiBase, fonteOcorrencias, montar(), montarComSupabase(), raiz, rowBase

### Community 54 - "lookup.js"
Cohesion: 0.28
Nodes (5): _filterDebounceTimers, filterRecords(), _getOrBuildIndex(), recordMatchesSearch(), _searchIndex

### Community 55 - "escapeHtml"
Cohesion: 0.15
Nodes (22): abrirDaiPorDocumentoSap(), _bdmContagemLiquida(), _bdmDiagnosticoHtml(), _bdmDivergencia(), _bdmDivergenciaTipHtml(), buildAnaliticoDetailBreakdown(), buildPendIntegSectionMaterial(), _daiIndexPorDocumentoSap() (+14 more)

### Community 56 - "wipe-local.test.mjs"
Cohesion: 0.25
Nodes (6): casos, fakeIndexedDB(), fonteNormalize, fontePersist, montar(), raiz

### Community 57 - "shortcutRemapSave"
Cohesion: 0.16
Nodes (15): abrirFechamento(), closeModal(), closeToolsMenu(), confirmarDestrutivo(), fechamentoSwitchTipo(), getShortcut(), openModal(), _shortcutKeyLabel() (+7 more)

### Community 58 - "period-fab.js"
Cohesion: 0.43
Nodes (6): activePage(), contentVisible(), fmtShort(), getActiveDates(), syncFabInputs(), syncFabLabel()

### Community 59 - "notif-supervisor.test.mjs"
Cohesion: 0.25
Nodes (5): activityRowOc, activityRowUpdate, casos, fonte, raiz

### Community 60 - "relatorio-dais.test.mjs"
Cohesion: 0.25
Nodes (5): casos, fonteRelatorio, itemConcluido, itemPendente, raiz

### Community 61 - "buildHealthPanel"
Cohesion: 0.15
Nodes (15): buildHealthPanel(), _buildLancIndex(), buildSnapshot(), calcHealthScore(), classifyVariation(), detectCatFromMat(), detectCatKey(), getHealthThresholds() (+7 more)

### Community 62 - "openTool"
Cohesion: 0.32
Nodes (8): closeAllTools(), closeTool(), _makeDraggable(), _makeResizable(), _nextToolZ(), _notesLoad(), openTool(), toggleCalc()

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

### Community 74 - "_gsrRenderTabela"
Cohesion: 0.19
Nodes (14): _gsHighlight(), _gsrCols(), _gsrFmt(), _gsrFmtPeso(), _gsrLinhas(), gsrMostrarMais(), _gsrPesoKg(), gsrRefine() (+6 more)

### Community 75 - "diagnosticarDivergenciaSapPuzl"
Cohesion: 0.13
Nodes (23): CODIGOS_ENTRADA, buildPendIntegGlobalItems(), buildPendIntegSection(), _buildSaidasIndex(), calcPendentesIntegracao(), diagnosticarDivergenciaSapPuzl(), ensureSaidasIndex(), findTransferPairCentral() (+15 more)

### Community 76 - "toggleThemeSwitcher"
Cohesion: 0.67
Nodes (3): closeThemeSwitcher(), openThemeSwitcher(), toggleThemeSwitcher()

### Community 77 - "Cloudflare Turnstile (CAPTCHA / Bot Protection Widget)"
Cohesion: 0.67
Nodes (3): Cloudflare Turnstile (CAPTCHA / Bot Protection Widget), Turnstile Widget (Login form), Turnstile Widget (Public Form)

### Community 87 - "syncLoadingElapsed"
Cohesion: 0.21
Nodes (12): destravarInteracao(), formatLoadingElapsed(), hideLoadingOverlay(), showLoadingOverlay(), syncLoadingElapsed(), syncLoadingHint(), _travaBarraEvento(), _travaBarraTecla() (+4 more)

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
Cohesion: 0.17
Nodes (10): casos, ctx, dados, EST_FIM, EST_INI, fonte, MOV, porNome (+2 more)

### Community 98 - "calendar-oc.test.mjs"
Cohesion: 0.17
Nodes (7): safeJSONParse(), casos, error(), fakeEl(), fonteCalendar, montar(), raiz

### Community 99 - "renderFatoresConversao"
Cohesion: 0.28
Nodes (9): _fatorConversaoMatchKey(), _fatoresConversaoSyncDelete(), _fatoresConversaoSyncUpsert(), fcFiltrar(), removerFatorConversao(), renderFatoresConversao(), salvarFatorConversao(), syncFatoresConversaoFromSupabase() (+1 more)

### Community 100 - "aus-fim-de-mes.test.mjs"
Cohesion: 0.33
Nodes (4): casos, ctx, fonte, raiz

### Community 101 - "sap-fechamento-override.test.mjs"
Cohesion: 0.29
Nodes (5): casos, fonteUi, montar(), parseDateBr(), raiz

### Community 102 - "_buildRankingShellHTML"
Cohesion: 0.20
Nodes (10): _ausGetPeriodo(), _buildAusenciasRelHTML(), _buildRankingShellHTML(), _dgrFonteIconesEmbutida(), _dgrFontesEmbutidas(), _dgrScriptAbas(), _dgrScriptCollapse(), _dgrScriptDownload() (+2 more)

### Community 103 - "upsertMateriais"
Cohesion: 0.23
Nodes (12): editarMateriais(), handleMateriaisImport(), makeMaterialId(), _materiaisSyncUpdate(), _materiaisSyncUpsert(), materialMatchKey(), normalizeImportedMaterial(), parseMateriaisRows() (+4 more)

### Community 104 - "_buildVariacaoOptions"
Cohesion: 0.50
Nodes (4): _buildVariacaoOptions(), _syncVarDropdownToState(), _updateVarHint(), _varFilterChange()

### Community 105 - "_setBtnLoading"
Cohesion: 0.15
Nodes (16): editarFiliais(), _filiaisSyncUpdate(), _filiaisSyncUpsert(), getRegionaisCentraisDisponiveis(), handleFiliaisImport(), normalizeImportedFilial(), parseFiliaisRows(), _rebuildRegionaisCentraisOptions() (+8 more)

### Community 106 - "salvarNovoGrupoMaterial"
Cohesion: 0.38
Nodes (7): abrirFatorConversao(), getFornecedoresDisponiveis(), getGruposMateriaisDisponiveis(), _rebuildFornecedorOptions(), _rebuildGrupoMateriaisOptions(), _refreshGrupoMateriaisSelects(), salvarNovoGrupoMaterial()

### Community 107 - "getCodigosSapDisponiveis"
Cohesion: 0.67
Nodes (4): getCodigosSapDisponiveis(), _rebuildCodigosSapOptions(), _refreshCodigosSapSelects(), salvarNovoCodSap()

### Community 108 - "_configEhChaveSaude"
Cohesion: 0.40
Nodes (6): _configEhChaveSaude(), _configsSyncDelete(), _configsSyncUpsert(), deleteConfig(), removerConfig(), salvarConfig()

### Community 109 - "relatorio-gerencial-clone.test.mjs"
Cohesion: 0.22
Nodes (5): casos, ctx, fonte, html, raiz

### Community 110 - "_checarNovosParaImportar"
Cohesion: 0.28
Nodes (9): abrirEdicaoFiliaisSelecionados(), abrirImportarDe(), abrirNovosPendentesDetalhe(), _carregarPerfis(), _checarNovosParaImportar(), confirmarImportarDe(), filialMatchKey(), _itensNovosDe() (+1 more)

### Community 111 - "_dgmMesLabel"
Cohesion: 0.25
Nodes (8): _dgmAbasDoRelatorio(), _dgmMesesOrdenados(), _dgmMesKey(), _dgmMesLabel(), _dgmRenderPicker(), _dgrMesesOrdenados(), _dgrPeriodosDoRelatorio(), _dgrRenderPickerMeses()

### Community 112 - "exportarSapCsv"
Cohesion: 0.47
Nodes (6): _closeSapExportMenu(), exportarSapCsv(), exportarSapExcel(), _sapCsvCell(), _sapExportFilename(), _sapExportRows()

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
Cohesion: 0.12
Nodes (22): _abrirJanelaRelatorio(), _buildRankingCentraisBody(), _buildRankingRegionaisTableBlock(), _buildRankSideCard(), _dgmAjudaTexto(), _dgmCentralHeaderHtml(), _dgmCentralTabelaHtml(), _dgmChip() (+14 more)

### Community 117 - "relatorio-giro-usina.test.mjs"
Cohesion: 0.08
Nodes (17): botaoTudo, cabecalhos, casos, centralFalsa(), ctx, ctxF, erros, escritas (+9 more)

### Community 118 - "_dgrEvolucaoTabelaHtml"
Cohesion: 0.33
Nodes (6): _dgrCapturarOffscreen(), _dgrEvoDetalheCardHtml(), _dgrEvolucaoLinhas(), _dgrEvolucaoTabelaHtml(), _dgrScriptEvolucao(), _dgrValCor()

### Community 119 - "_custosSapSyncUpsert"
Cohesion: 0.40
Nodes (6): _atualizarRegistroCustosSap(), _criarRegistroCustosSap(), _custosSapSyncDelete(), _custosSapSyncUpsert(), excluirCustosSap(), salvarCustosSapManual()

### Community 120 - "movNaoClassificado"
Cohesion: 0.40
Nodes (6): classificarMovSap(), MOV_NAT_AJUSTE, MOV_NAT_ENTRADA, MOV_NAT_SAIDA, movNaoClassificado(), repartirSapPorNatureza()

### Community 121 - "_buildCentralOptionsHtml"
Cohesion: 0.50
Nodes (4): _buildCentralOptionsHtml(), _custosSapManualPopularSelects(), _manualModalPopularSelects(), _onManualMaterialChange()

## Knowledge Gaps
- **311 isolated node(s):** `ADMIN_MODULOS`, `_adminProfiles`, `_adminAuthInfo`, `_adminCurrentRows`, `_adminSelectedIds` (+306 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `_dgrExportaveis()` connect `_dgrExportaveis` to `dgFmtPeso`, `relatorio.js`, `format.js`, `_cubGet`?**
  _High betweenness centrality (0.171) - this node is a cross-community bridge._
- **Why does `Ocorrências Page` connect `dai.js` to `ocorrencias.js`, `relatorio.js`?**
  _High betweenness centrality (0.107) - this node is a cross-community bridge._
- **Why does `CLOUD_BACKUP_MODULOS` connect `cloud-backup.js` to `admin.js`, `dashboard.js`, `renderModule`?**
  _High betweenness centrality (0.097) - this node is a cross-community bridge._
- **Are the 22 inferred relationships involving `_dgrExportaveis()` (e.g. with `_daBuildRanking()` and `_daBuildTabelaMaterial()`) actually correct?**
  _`_dgrExportaveis()` has 22 INFERRED edges - model-reasoned connections that need verification._
- **What connects `ADMIN_MODULOS`, `_adminProfiles`, `_adminAuthInfo` to the rest of the system?**
  _311 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `admin.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05112560488112771 - nodes in this community are weakly interconnected._
- **Should `ocorrencias.js` be split into smaller, more focused modules?**
  _Cohesion score 0.10826210826210826 - nodes in this community are weakly interconnected._