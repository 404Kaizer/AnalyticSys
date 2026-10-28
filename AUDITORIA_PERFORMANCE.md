# Auditoria de Performance — AnalyticSys

Estado: **medição completa na escala real (08/10/2026). Plano em ondas na seção 4, aguardando aprovação.**
Nenhuma linha de código do sistema foi alterada nesta auditoria.

## 1. Como foi medido

- **Escala:** a da conta ADM, tirada dos manifests do backup na nuvem: SAP ~1,07 mi, Saídas ~1,03 mi,
  Entradas ~100 mil e Lançamentos ~100 mil, ou seja, ~2,3 mi de registros no IndexedDB. O Postgres está quase
  vazio (lançamentos = 68 linhas) e as respostas do servidor levam em média ~0,1 s, então a rede não é o
  gargalo. Tudo é CPU e memória no navegador.
- **Ambiente:** Chrome headless rodando o `index.html` **real** com todos os scripts do sistema, sem Supabase.
  1. Uma fase gera a base sintética com cadastro realista (74 centrais, 180 materiais, ~2 anos de datas, mix
     de movimentos) e a grava com o `persistStateNow` real.
  2. Outra fase executa o boot real e um roteiro de 26 ações do analista.
- **Métricas por ação:**
  - "clique→resposta": duração da chamada.
  - "maior travada": o maior intervalo em que a tela ficou sem responder, medido por um batimento de 50 ms.
  - "até ficar livre": inclui as gravações que a ação dispara depois.
- **Máquina:** a desta medição tem 12 threads e 16 GB de RAM. Se no PC do analista o boot leva ~6 min contra
  ~80 s aqui, todos os números abaixo devem ser **~4–5× maiores** lá. Isso é suposição: não foi medido no PC
  dele.
- **Correções:** cada uma foi prototipada e comparada com a função atual sobre a mesma base, com casos de
  borda injetados (duplicatas, estornos 102, pares Y11/Y12, datas inválidas).

## 2. O que o analista sente hoje (medido aqui)

| Ação | Tela presa | Causa principal |
|---|---|---|
| **Abrir o sistema (boot)** | **70–92 s** | 3 a 4 regravações completas da base (§3.1), pré-carga do Analítico (12–17 s numa tarefa só), leitura do IndexedDB (5–6 s) |
| **Salvar 1 lançamento manual** | ~11 s presa em ~13,5 s, com travadas de até **4,3 s** | Grava a base inteira: 1 mi de Saídas clonado de uma vez (4 s) + 107 chunks de SAP (6,3 s) + compactação dupla (§3.1) |
| **Marcar notificação como lida**, receber atividade de outro analista, editar ocorrência, justificativa de inventário | idem (~11 s) | `persist()` sempre regrava tudo; as notificações chamam `persist()` 11 vezes no código |
| Considerar/desconsiderar ajuste (`semSap`) | ~6 s, travada de **5,4 s** | A gravação "leve" ainda reclona 1 mi de Saídas |
| **Ordenar SAP por Peso** | **11,6 s** | Comparador com 4 regex + `parseFloat` + `localeCompare` por comparação |
| **Próxima página com ordenação ativa** | **23,5 s** | Reordena 1 mi de registros **duas vezes** a cada troca de página |
| Ordenar SAP por Data | 8,1 s | idem |
| 1ª busca de texto no SAP ou em Saídas | 2,6–2,7 s | Monta o índice de busca (1 texto por registro) |
| Abrir SAP / qualquer re-render do SAP | 0,6–0,8 s | `renderSapSummary` soma 1 mi de registros a cada render (0,7 s) |
| **Analisar (setembro inteiro)** | travada de **12,6 s**, livre só aos **26 s** | `parseDate` sem cache, detector de duplicatas varrendo 1 mi, e depois `notifSync` → regravação completa |
| Inventário (gerar) | **10–12 s** | Cálculo interno do inventário (a perfilar na Onda 2) + `calcPendentesIntegracao` 2,4 s |
| Gerencial (Atualizar) | 6,2 s | `buildDashboardGerencialResults` 5 s, dos quais 2,9 s são `getSapByCentralInPeriod` (`parseDate`) |
| Abrir Saídas/Lançamentos/Entradas/Config | 0,1–0,5 s | ok |
| **Fechar ou recarregar a aba** | **a aba morre** | `_emergencySave` faz `JSON.stringify` de ~1,2 mi de registros: **3 de 3 crashes por "javascript OOM"** (relatório do Chrome). Mesmo sem crash, o localStorage só aceita ~5 MB, então a cópia de emergência nunca funcionou nesta escala |
| **Outro analista importa Custos SAP** | **~2,5 min** de tela picotada em **todo** navegador conectado | Realtime re-renderiza a tabela a cada evento: 16 ms × ~10 mil eventos (rajadas reais de 10.416 e 10.513 eventos em 07/10 às 9h e às 17h) |
| 30 min após abrir, e a cada 3 h | ~17 s de processamento por módulo grande | Backup na nuvem reenvia **tudo** (~100 MB), mesmo sem mudança; o horário do último envio não sobrevive ao recarregar |
| Relógio da topbar (30 s) | desprezível | ok |

**Memória:** o heap chega a **2,4–3,0 GB**. O Chrome limita o JavaScript de uma aba a ~4 GB. Sobra ~1/4 de
folga antes de o boot passar a derrubar a aba, e a base cresce todo mês. Numa máquina com 8 GB, uma aba de
3 GB mais o resto do Windows vira troca de memória em disco, o que pode explicar boa parte do 4–5× lá.

## 3. Causas-raiz

### 3.1 Gravação monolítica: a raiz dos "travamentos aleatórios"

`persist()` ([persist.js:670](js/persist.js:670)) não sabe o que mudou e regrava **tudo**:
- o snapshot `appState`, com as 4 coleções grandes menos o SAP, num único `put`; só clonar as Saídas leva 4 s
  de tela travada;
- mais 107 chunks de SAP (6,3 s);
- mais a compactação do SAP **duas vezes** ([persist.js:408](js/persist.js:408) e [persist.js:178](js/persist.js:178)),
  sendo que a 2ª, sobre o que já está compactado, desperdiça 1,4 s.

Isso roda a cada `persist()`, e há ~65 pontos de chamada. Entre eles estão:
- **notificações** (`notifSync`, `notifMarkRead`, atividade via Realtime): [notifications.js:173](js/notifications.js:173), :479, :768;
- ocorrências, justificativas de inventário, overrides de fechamento, configurações, DAI;
- **no boot**, `notifSync` sozinho dispara 3 regravações completas, além da gravação final do passo 8
  ([dashboard.js:8329](js/dashboard.js:8329)).

Desligando só as regravações do boot, ele cai de ~92 s para **~34 s**.

### 3.2 Trabalho repetido sem cache

| Ponto | Hoje | Protótipo | Mesmo resultado? |
|---|---|---|---|
| `parseDate` ([dashboard.js:8372](js/dashboard.js:8372)), regex + `new Date` por chamada | 1.021 ms / 1 mi | 404 ms (cache, devolvendo `Date`) · 105 ms (timestamp) | ✅ 50 mil entradas + bordas |
| `getSapByCentralInPeriod` ([ui.js:5597](js/ui.js:5597)) | 1.761 ms | 401 ms | ✅ mesmos registros, mesma ordem |
| `_buildLancIndex` (sort com `parseDate` no comparador) | 2.618 ms | 910 ms | ✅ mesma ordem |
| **Analisar setembro** (só com o cache de datas) | 11.727 ms | 7.338 ms | — |
| Ordenar SAP por Peso / Data / Material ([ui.js:626](js/ui.js:626)) | 11.082 / 8.625 / 4.527 ms | 1.083 / 1.444 / 830 ms | ✅ ordem idêntica (4 colunas) |
| `getSapDuplicateKeys` ([ui.js:346](js/ui.js:346)) | 4.650 ms | 3.255 ms (dá para descer mais montando a chave só dos marcados) | ✅ 3.000 reais / 5.991 anulados |
| Compactação SAP repetida | +1.409 ms por gravação | 0 | ✅ idempotente |
| `renderSapSummary` | 717 ms por render | ~0 (cache) | — |

### 3.3 Tarefas gigantes sem fatiar
O Analítico (até 17 s), o Inventário (10–12 s) e o Gerencial (6 s) rodam como um bloco síncrono só: a tela não
pinta nem o progresso.

### 3.4 Eventos em rajada sem agrupamento
O Realtime de Custos SAP ([import.js:1145](js/import.js:1145)) faz render + `updateDashboard` a cada evento.

### 3.5 Memória perto do teto
- cópias inteiras a cada gravação (a compactação aloca ~1 mi de objetos novos, 2×);
- índice de busca (1 texto por registro, por módulo);
- `JSON.stringify` gigante no fechamento da aba.

## 4. Plano em ondas, e como cada risco é contornado

**Regra geral:** nenhuma onda antes da aprovação; um commit por correção; cada correção medida antes e depois na
escala real e comparada com o código atual (como na §3.2). Antes de qualquer onda que mexa em gravação:
Ferramentas → **Exportar backup**. O backup condensado na nuvem continua existindo como 2ª rede.

### Onda 1: sem mudar o formato do banco local (risco baixo, reversão = `git revert`)

| # | Correção | Ganho medido | Risco e como contorno |
|---|---|---|---|
| 1.1 | Cache no `parseDate` (mapa string → timestamp, devolvendo um `Date` **novo** a cada chamada) e versão "timestamp" nos laços quentes (`getSapByCentralInPeriod`, `getLancsByCentralInPeriod`, ordenação dos índices) | Analisar −37%, Gerencial −2,2 s, índice de Lançamentos −1,7 s, boot −5 a −7 s | **Risco:** quem recebe o `Date` mutá-lo (há ~90 `.set*` no projeto). **Contorno:** nunca compartilhar o objeto; cache só para `string`; limite de tamanho. Equivalência provada em 50 mil entradas + bordas. |
| 1.2 | Ordenação de coluna com chave calculada 1× e `Intl.Collator` único; resultado ordenado guardado para a paginação | Ordenar: 11,6 s → ~1,1 s. **Próxima página: 23,5 s → ~0** | **Risco:** ordem mudar ou cache velho depois de edição. **Contorno:** mesmo comparador, sort estável, ordem provada idêntica em 4 colunas; cache invalidado por array, tamanho, filtro, coluna e direção, mais um contador de versão incrementado em todo `persist()` (toda mutação passa por ele). |
| 1.3 | Cache do `renderSapSummary`, usando a mesma chave do 1.2 | −0,7 s em todo render do SAP | Idem 1.2. |
| 1.4 | `getSapDuplicateKeys` com chave montada 1× e a chave do registro só para os marcados | 4,7 s → 3,3 s no protótipo (meta ~2 s) | **Risco:** marcar duplicata errada. **Contorno:** conjuntos provados iguais com duplicatas, estornos e Y11/Y12 injetados. |
| 1.5 | Remover a 2ª compactação do SAP em cada gravação | −1,4 s por gravação, −~350 MB de pico | Nenhum: compactar 2× dá o mesmo resultado que 1×. |
| 1.6 | Chunks do SAP gravados em lotes menores, cedendo a tela entre eles | As travadas de ~1 s viram ~0,1–0,2 s (o total não muda) | **Risco:** gravação interrompida no meio. **Contorno:** a ordem atual se mantém (chunks → meta → limpeza), que já é segura contra interrupção. |
| 1.7 | Realtime de Custos SAP: aplicar o evento na hora e **agrupar o re-render** (1 render a cada ~300 ms) | Rajada de 10 mil: ~2,5 min → ~1 s | **Risco:** tela mostrar dado de até 300 ms atrás. **Contorno:** o estado em memória é atualizado na hora; só a pintura é agrupada. |
| 1.8 | `_emergencySave` só com as coleções pequenas (as grandes só se couberem, ex.: < 20 mil registros) | Fechar/recarregar deixa de derrubar a aba; a cópia de emergência **passa a funcionar** | **Risco:** perder um lançamento feito menos de 1,5 s antes de fechar. **Contorno:** hoje isso já se perde, porque a gravação falha; usuários com base pequena continuam cobertos pela regra de tamanho. |
| 1.9 | Backup na nuvem: guardar o horário do último envio e **pular chunks iguais** (o hash já é calculado e já existe no manifest) | Sem mudança: nada é enviado (hoje ~100 MB); resta calcular o hash. Com mudança: só os chunks alterados | **Risco:** backup incompleto. **Contorno:** hash igual = conteúdo idêntico; o manifest é regravado com todos os hashes; a restauração já confere hash por chunk. |
| 1.10 | Analítico/Inventário/Gerencial cedendo a tela entre centrais (barra de progresso andando) | Sem "congelou" durante a análise | **Risco:** clique durante o cálculo. **Contorno:** o overlay de carregamento já bloqueia cliques; trava contra reentrada. |

### Onda 2: gravação em camadas (risco médio; o formato antigo continua sendo lido e gravado)

**Ideia:** criar uma 2ª chave `appStateLite` com **só as coleções pequenas** (notificações, ocorrências,
justificativas, overrides, configs, cadastros, custos, imports…), que custa ~50–100 ms. O `appState` completo
continua existindo e sendo gravado quando uma coleção grande muda. No boot, vale a mais recente (`savedAt`).
`persist({ leve: true })` grava só a lite; `persist()` sem argumento **continua gravando tudo**, então
qualquer ponto não migrado mantém o comportamento de hoje.

| # | Correção | Ganho | Risco e como contorno |
|---|---|---|---|
| 2.1 | Mecanismo lite + leitura combinada no `loadState` (ordem: appState → lite → emergência, pelo `savedAt`) | — | **Risco:** voltar dado antigo. **Contorno:** testes de ida e volta (gravar → recarregar → comparar hash de todas as coleções), alternância lite/completa nas duas ordens e matar a aba no meio da gravação. |
| 2.2 | Migrar para `leve` os chamadores que **só** mexem em coleções pequenas, cada um lido e verificado: notificações (menos `notifIntegrar`, que integra registros grandes e fica completo), ocorrências, justificativas, overrides (os 3 `semSap` de hoje), configs, ações do relatório, DAI | Marcar como lida, editar ocorrência, justificar, considerar ajuste: **~11 s → ~0,1 s** | **Risco:** um chamador mexer numa coleção grande sem declarar, e ela não ser gravada. **Contorno:** auditoria função por função (lista no commit); na dúvida, fica completo. Um teste compara o estado gravado com o da memória depois de cada ação migrada. |
| 2.3 | Boot: o passo 8 grava só a lite, e a completa **apenas** se o boot mudou uma coleção grande (sincronização trouxe diferença, restauração de backup, backfill de id, limpeza, wipe, gravação anterior interrompida). Essa gravação roda **depois** de liberar a tela | Boot −15 s (e −35 a 55 s com o 2.2) | **Risco:** não gravar algo que mudou no boot. Lição do bug de 27/07: id gerado e não salvo virou 295 mil duplicatas na nuvem. **Contorno:** cada ponto que muda dado no boot vira um "marca sujo" explícito; a comparação da sincronização é por conteúdo; na dúvida, grava tudo como hoje. O invariante do passo 3 (padronização recalculada a cada boot) já cobre o campo `material`. |
| 2.4 | **Rollback:** o código antigo ignora a lite e lê o `appState`. Só perde as mudanças pequenas feitas depois da última gravação completa, e todas essas coleções, exceto notificações, voltam do Supabase no boot ("o banco manda") | — | Testado simulando o `persist.js` atual lendo o banco gravado pelo novo. |

### Onda 3: importação
São os itens 4, 8 e 9 da auditoria de setembro, ainda válidos: o código não mudou.
- fingerprint calculado 1× no `_mergeDedup` (−50 a −67%);
- XLSX em modo `dense`;
- lotes de import cedendo por tempo, e não a cada 200–700 linhas (hoje são 23–80 s de espera pura em 1 mi);
- tirar a cópia compactada antes do merge.

### Onda 4: arquitetura (decisão sua, muda o formato do banco local)
Só ela leva o boot a "segundos" e afasta o teto de 4 GB:
- coleções grandes em chunks próprios, gravando só o que mudou (salvar 1 lançamento passa a custar ~0,1 s);
- carga por período, sob demanda, em vez de 2,3 mi de objetos vivos;
- cálculo e IndexedDB em Web Worker.

**Risco real:** o código antigo não lê o formato novo, então o rollback exige um passo de conversão. Por isso
fica separada.

### Projeção (máquina desta medição)

| | Hoje | Após Onda 1 | Após Onda 2 |
|---|---|---|---|
| Boot | 70–92 s | ~60–80 s | **~20–25 s** |
| Salvar 1 registro grande | ~11 s | ~9 s, em travadas curtas | ~9 s (Onda 4: ~0,1 s) |
| Notificação / ocorrência / justificativa / ajuste | 6–11 s | 6–9 s | **~0,1 s** |
| Ordenar / paginar SAP | 11,6 / 23,5 s | **~1,1 / ~0 s** | idem |
| Analisar setembro | 12,6 s + ~13 s de gravação | ~7 s com progresso + ~9 s de gravação | **~7 s**, sem gravação depois |
| Fechar/recarregar | aba morre | ok | ok |

No PC do analista, multiplique por ~4–5. Mesmo após a Onda 2, o boot lá ainda deve ficar em ~1,5 min. Abaixo
disso, só com a Onda 4.

## 5. Bugs de lógica vistos de passagem (não corrigidos)

1. O índice de busca usa `records.length` como versão, e a mesma chave serve para dados filtrados do mesmo
   módulo ([lookup.js:19](js/lookup.js:19)): um filtro "só manuais" com o mesmo tamanho reaproveitaria o índice
   errado.
2. Os itens 1–4 da §7 da auditoria de setembro (anexo abaixo) continuam válidos.

---

# Anexo — Auditoria de 21/09/2026 (análise estática + baseline sintético 500 k / 1 M)


Estado: **Fase 0 + baseline sintético medidos (seção 5). Plano da Fase 2 na seção 6 — aguardando aprovação.**
Data: 21/09/2026 · Commit-base: `5a2cc1c`

Regra desta auditoria: nada abaixo vira mudança de código antes de ter número medido. A seção 3 (achados) é
análise estática — diz *onde* e *por quê* o custo existe e *como cresce com N*; a gravidade real vem da seção 5
(baseline), que ainda está vazia.

---

### 1. Como medir (roteiro para o usuário)

#### 1.1 Carregar a sonda

A sonda é [js/perf-probe.js](js/perf-probe.js). Não está no `index.html`. Dois modos:

**Modo A — pós-boot (console).** Serve para os cenários (b)–(e). Abra o sistema, F12 → Console, cole:

```js
var s=document.createElement('script');s.src='js/perf-probe.js?'+Date.now();document.head.appendChild(s);
```

**Modo B — boot completo.** Serve para o cenário (a). Só assim a sonda envolve as funções de boot *antes* de
rodarem. Edite **temporariamente** o `index.html` e coloque esta linha como a **primeira** tag `<script>` do
`<head>`, **sem `defer`**:

```html
<script src="js/perf-probe.js"></script>
```

Depois de colher o cenário (a), remova a linha. (Em modo A, do boot só se recupera o que o Chrome bufferiza:
long tasks, navigation/resource timing — sem a quebra por etapa.)

#### 1.2 Comandos

| Comando | O que faz |
|---|---|
| `__perf.mark('rótulo')` | Marca um instante (ex.: antes de clicar em algo) |
| `__perf.reset()` | Zera long tasks, eventos e medidas — use entre cenários |
| `__perf.report('nome do cenário')` | Imprime a tabela no console **e copia para a área de transferência** |
| `__perf.snapshot()` | Só memória + contagens + tamanhos de storage |

#### 1.3 Os 5 cenários (base real, ≥ 500 mil registros)

Use o **Chrome ou Edge** (é o único que expõe `performance.memory`), aba **visível** o tempo todo (com a aba oculta
o sistema pula os `yield`s de propósito e os números mudam), sem DevTools na aba "Performance" gravando
(distorce). Cole cada relatório aqui, um por cenário.

| # | Cenário | Passos | Relatório |
|---|---|---|---|
| a | **Boot frio** | Modo B. Fechar todas as abas do sistema, abrir de novo, esperar o overlay "Sistema pronto" sumir e a primeira página ficar clicável. Então: `__perf.report('a-boot')`. | `a-boot` |
| b | **Importar planilha grande** | Modo A. `__perf.reset()`, importar o **maior** arquivo que você tem (SAP/MB51 ideal), esperar terminar. `__perf.report('b-import <nome do arquivo> <nº linhas>')`. Anote também o tempo de relógio percebido e se a UI respondeu a clique durante o processo. | `b-import` |
| c | **Trocar entre as 4 páginas mais usadas** | `__perf.reset()`. Alternar, com ~3 s de intervalo: Dashboard Analítico → SAP → Dashboard Gerencial → Lançamentos → Dashboard Analítico → SAP. Repetir o ciclo 2×. `__perf.report('c-nav')`. Diga quais são de fato as 4 mais usadas se forem outras. | `c-nav` |
| d | **Filtro/período em cada uma** | `__perf.reset()`. Em cada uma das 4 páginas: mudar o período (ou digitar um filtro de texto na tabela SAP/Lançamentos e aplicar um filtro de coluna). Uma ação por vez, esperar terminar. `__perf.report('d-filtros')`. | `d-filtros` |
| e | **Memória após 10 min** | Logo após (d): `await __perf.snapshot()` → anote `usedJSHeap`. Deixar 10 min sem mexer. `await __perf.snapshot()` de novo. Depois mais 5 min mexendo normalmente e um terceiro snapshot. Cole os três. | `e-mem` |

Se algum cenário travar a aba por completo (Chrome oferecendo "Aguardar/Sair"), anote isso também — é dado.

---

### 2. Fatos da arquitetura — confirmação

| Afirmação inicial | Resultado | Evidência |
|---|---|---|
| 33 scripts `defer` no `index.html`, ~64 k linhas | **Confirmado**: 33 tags (27 locais + 6 CDN), 63 886 linhas em `js/` | [index.html:6046-6536](index.html:6046); `wc -l js/*.js` |
| Maiores: ui 8.7k, dashboard 8.5k, relatorio 7.3k… | **Confirmado em linhas — mas em bytes a história é outra**: `relatorio.js` tem **1,58 MB** (ui 431 KB, dashboard 439 KB) | ver 3.1.1 |
| Estado global em `state.js`, persistido em localStorage + IDB | **Confirmado**. IDB é a fonte principal; localStorage só como fallback/emergência (sem SAP) | [js/state.js:122](js/state.js:122), [js/persist.js:544-609](js/persist.js:544) |
| Importação de Excel em `js/import.js` na thread principal | **Parcialmente errado**: o parse não está em `import.js` (que é CRUD manual + sync Supabase). Está em `dashboard.js` (`handleImport` → `processImportedRows`) e em `config.js` (cadastros). Na thread principal: **confirmado** | [js/dashboard.js:7546](js/dashboard.js:7546), [js/dashboard.js:6672](js/dashboard.js:6672), [js/config.js:1642](js/config.js:1642) |
| Render por `innerHTML` (83 em dashboard, 57 em ui) | **Confirmado**: 83 / 57 / admin 51 / format 36 | `grep -c innerHTML` |
| Nenhum Web Worker | **Confirmado** (0 ocorrências de `new Worker`) | — |
| `rAF + setTimeout` espalhado como "yield" | **Confirmado**, centralizado em `nextFrame()` + `yieldToUI()` (7 usos diretos do padrão) | [js/format.js:592](js/format.js:592) |
| Backup gzip via `CompressionStream` trava a thread principal | **Refutado em parte**: `CompressionStream` é streaming e o Chrome comprime fora da thread principal. O que bloqueia é o `JSON.stringify` do chunk + `TextEncoder` + **gunzip+comparação de string de autoteste** (dobra o trabalho) | [js/cloud-backup.js:220-231](js/cloud-backup.js:220) |
| Chart.js 4 | Confirmado (4.4.1 CDN). `destroy()` antes de recriar: **sim** no Gerencial (`_dgVgCharts`) | [js/dashboard.js:595](js/dashboard.js:595) |
| Testes `node --test tests/` | 20 arquivos `.mjs`. **Node.js não está instalado nesta máquina** — não consegui rodar. Precisa ser rodado por você (ou instalar Node) em todo commit da Fase 3 | `tests/` |
| `graphify` para navegar | **Indisponível**: nem `graphify` nem `python` no PATH. Usei `graphify-out/GRAPH_REPORT.md` + leitura direta. `graphify update .` não vai rodar aqui | — |
| `PAGE_SIZE = 50` respeitado | Nos 5 módulos tabulares (`pageSlice`) **sim**. Nos painéis analíticos (cards por central, giros, rankings) não há paginação — é render completo do agregado | [js/ui.js:699](js/ui.js:699) |

---

### 3. Achados por área (análise estática)

Legenda de gravidade: **B** = bloqueia a UI (síncrono) · **N** = cresce linear com registros · **N log N** · **N²**.

#### 3.1 Boot e carregamento inicial

**3.1.1 — 1,17 MB de fontes base64 dentro de `relatorio.js`, baixados e parseados em todo boot.** `B, fixo`
Linhas [1649](js/relatorio.js:1649) (343 515 chars) e [1656](js/relatorio.js:1656) (823 810 chars) são duas
template strings com Inter + JetBrains Mono + Tabler Icons em `data:font/woff2;base64`. Só são usadas quando
`opts.offlineCompleto = true` (relatório offline). 74 % do peso de `relatorio.js` e ~29 % do JS total do app
(1,17 MB de 4,0 MB) é payload que a página nunca usa em sessão normal. O parser JS ainda tem que tokenizar essas
strings.

**3.1.2 — Todos os 27 scripts locais + 6 CDN carregam antes de qualquer página ser útil.** `B, fixo`
`xlsx.full.min.js` (~900 KB), jspdf + autotable, jszip, Chart.js, supabase-js, turnstile — todos `defer`, todos
antes de `init()`. Dependências reais entre globais ainda não mapeadas (fica para a Fase 1 com números; o
`graph.json` tem essa informação). Observação: `defer` mantém a ordem, então o `init()` em
[analitico.js:4611](js/analitico.js:4611) só dispara depois do último script.

**3.1.3 — `restoreAndRender()` faz trabalho O(N) sobre TODAS as coleções, várias vezes, síncrono.** `B, N`
[js/dashboard.js:8050-8320](js/dashboard.js:8050). Sequência, cada item com um `nextFrame()` entre eles (o que
pinta o overlay, mas cada bloco em si é uma long task):

| Etapa | O que faz com N registros | Ref. |
|---|---|---|
| `loadState` → `loadSapChunks` | `Promise.all` de todos os chunks + `.flat()` | [persist.js:230](js/persist.js:230) |
| `applySavedState` | `.map` sobre entradas/saidas/lancamentos/sap/custosSap para garantir `id` (aloca array novo de N mesmo se ninguém precisa) + `.filter` em SAP | [persist.js:463-479](js/persist.js:463) |
| `reaplicarPadronizacaoMateriais()` | **Recria todos os objetos** das 4 coleções (`{...rec, material: normalizarMaterial(raw)}`) em **todo boot** — N alocações, dobra memória transitoriamente | [normalize.js:909](js/normalize.js:909), chamado em [dashboard.js:8134](js/dashboard.js:8134) |
| `getLancIndex()`, `getSapIndex()` | Constrói índices por central/material — O(N), necessário, mas síncrono | [ui.js:5411](js/ui.js:5411), [ui.js:5444](js/ui.js:5444) |
| `notifSilentHealthCheck()` | Cálculo de saúde do estoque completo | [notifications.js:177](js/notifications.js:177) |
| `_rodarAnaliticoCore()` (pré-carga) | Roda o Dashboard Analítico inteiro para a última terça | [dashboard.js:8260](js/dashboard.js:8260) |
| `updateDashboard()` | Dashboard Gerencial completo (KPIs, giros, gráficos) — para uma página que **não** é a inicial | [dashboard.js:8280](js/dashboard.js:8280) |
| `renderFiliais()`, `renderMateriais()` | Páginas que o usuário talvez não abra | — |
| **`persistStateNow()`** | **Reescreve o estado inteiro no IDB ao fim de todo boot**, mesmo sem alteração: `compactSapRecords` 2× sobre N SAP + structured clone de tudo 2× (ver 3.3.1) | [dashboard.js:8303](js/dashboard.js:8303) |

Hipótese a confirmar com (a): o boot com 1 M de registros gasta mais tempo em `reaplicarPadronizacao` +
`persistStateNow` (trabalho redundante) do que na leitura do IDB em si.

#### 3.2 Importação de Excel

Caminho real: `handleImport` [dashboard.js:7546](js/dashboard.js:7546) → `FileReader.readAsArrayBuffer` →
`XLSX.read(buf, {type:'array', cellDates:false, dense:false})` [7591](js/dashboard.js:7591) →
`sanitizeWorksheet` → `sheet_to_json(ws, {header:1, raw:true, defval:''})` [7635](js/dashboard.js:7635) →
`processImportedRows` [6672](js/dashboard.js:6672) → `_mergeWithConflictCheck` [6466](js/dashboard.js:6466) →
`_mergeDedup` [6597](js/dashboard.js:6597) → `state[x] = result` → `persist()` → `renderImports()` +
`renderModule()` → backup em nuvem.

**3.2.1 — `XLSX.read` + `sheet_to_json` são uma única long task síncrona.** `B, N`
Nenhum yield entre ler o arquivo e ter `rows`. Para 1 M de linhas o SheetJS aloca o workbook inteiro (modo
esparso: um objeto `{t, v, w}` por célula → ~15 objetos × 1 M linhas) e depois `sheet_to_json` aloca 1 M arrays.
Sem `dense: true` (o código passa `dense: false` explicitamente), sem `sheetRows`, e lê **todas as abas** do
arquivo mesmo usando uma só. Esta é a etapa em que a aba "congela" sem barra de progresso — o overlay diz
"Lendo planilha…" e nada anda.

**3.2.2 — Conversão em lotes cede com `nextFrame()` (rAF + setTimeout).** `parcial`
[6698-6716](js/dashboard.js:6698): `batchSize` entre 200 e 700 → para 1 M de linhas são ~1 400–5 000 lotes, cada
um cedendo um frame inteiro (≥16 ms) → **≥ 23–80 s só de espera de frame**, independente do trabalho. É o
padrão "rAF+setTimeout" descrito no briefing: garante pintura, mas o custo de yield domina.

**3.2.3 — Dedup/merge é O(n+m) (bom), mas recomputa o fingerprint ~5× por registro, tudo síncrono.** `B, N`
[`_mergeDedup` 6597-6624](js/dashboard.js:6597): `fpFn(r)` é chamado para `incomingFps` (Set), `existingByFp`
(Map), `updatedExisting` (filter + map = 2×), `trulyNew` (filter), `kept` (filter sobre *existing*). Cada
`_fpSap` [6555](js/dashboard.js:6555) faz 2× `normalizeText` (NFD + 3 regex + upper) + `num()` + `join`. Com
1 M existentes + 1 M novos: ~5 M fingerprints ≈ 10 M normalizações unicode, em **um único bloco síncrono**
depois de um só `nextFrame()` [6494](js/dashboard.js:6494). Além disso `compactSapRecords(state.sap)`
[6504](js/dashboard.js:6504) aloca N objetos novos só para o merge.

**3.2.4 — Depois do merge: `persist()` grava tudo (3.3.1) + `renderImports()` + `renderModule()` + backup em nuvem
(`_cbReforcarBackupModulos`) — na mesma sequência.** Ver 3.3 e 3.6.

**3.2.5 — Feedback de progresso**: existe (steps + barra), mas as fases 3.2.1 e 3.2.3 não emitem progresso —
são as mais longas.

#### 3.3 Persistência e memória

**3.3.1 — Todo `persist()` serializa e grava o estado INTEIRO, e cada coleção 2×.** `B, N`
[`persistStateNow` 544-609](js/persist.js:544):
1. `buildStateSnapshot()` [392](js/persist.js:392) → `compactSapRecords(state.sap)` [277](js/persist.js:277):
   **N objetos novos** (1ª vez).
2. `idbPut('appState', {...snapshot, sap: []})` → structured clone de todas as coleções não-SAP.
3. `saveSapChunks(db, snapshot.sap)` [172](js/persist.js:172) → chama `compactSapRecords` **de novo** sobre o já
   compactado (**2ª alocação de N objetos**) → `slice` em chunks de 10 k → `idbPut` de cada (clone).
4. Loop por `saveSnapshotKeys` [7](js/persist.js:7) gravando **cada coleção outra vez** como chave individual →
   structured clone de tudo pela **2ª vez**.

Não há dirty flag: editar uma justificativa de inventário reescreve 1 M de registros SAP. O debounce de 1,5 s
[639](js/persist.js:639) só agrupa chamadas; não reduz o volume. Structured clone de IDB roda na thread principal
(o custo de serialização é síncrono no `put`; só o I/O é assíncrono). Os `setTimeout(0)` entre etapas
[555-581](js/persist.js:555) cedem entre os blocos, mas cada bloco é uma long task.

Quem chama `persist()`: 100+ pontos (todo CRUD, toggles, overrides). Confirmar com (d) quantos `persist:`
aparecem em um cenário de filtro — se aparecer, filtro está disparando gravação.

**3.3.2 — Hidratação carrega tudo para memória de uma vez.** `B, N`
`loadState` [642](js/persist.js:642): `Promise.all` de todos os chunks SAP + `.flat()` → 1 M objetos JS vivos
desde o primeiro segundo, mesmo que o usuário só vá ao Dashboard Analítico do mês corrente. Não existe leitura
por consulta/período.

**3.3.3 — Cópias de arrays grandes.** `N`
`[...data].sort` em `_applyModuleSort` [ui.js:622](js/ui.js:622); `compactSapRecords` (3 chamadas/ciclo);
`reaplicarPadronizacaoMateriais` (3.1.3); `applySavedState` `.map`; `getListFilteredData('dashboard')`
[ui.js:712-719](js/ui.js:712) monta um feed com **todos** os registros das 5 coleções, com `money()` por
registro, e ordena — verificar se ainda tem chamador (não achei nenhum: candidato a código morto).

**3.3.4 — Índice de busca por texto duplica os dados como strings.** `N (memória)`
[`_getOrBuildIndex` lookup.js:17](js/lookup.js:17): uma string lowercase concatenando ~15 campos por registro,
por módulo. Em 1 M SAP são ~1 M strings de 100–200 chars ≈ 150–300 MB extra quando o usuário digita o primeiro
filtro. Invalidação por `records.length` — edições in-place sem mudar tamanho **não invalidam** (bug de dado,
não de performance: reportar à parte).

**3.3.5 — Datas como string + `parseDate` sem cache.** `N por consulta`
Todos os registros guardam `dtLanc` etc. como `"DD/MM/AAAA"`. `parseDate` [dashboard.js:8346](js/dashboard.js:8346)
faz regex + split + `new Date()` **por registro, por filtro de período** — 77 pontos de chamada. Um filtro de
período no Analítico sobre 1 M SAP aloca 1 M `Date`s e descarta. Os valores são altamente repetidos (poucos
milhares de datas distintas em 1 M linhas): cache `Map<string, number>` seria O(distintos).

**3.3.6 — Backup em nuvem por chunk faz 5 passes sobre o JSON.** `B por chunk`
[cloud-backup.js:220-231](js/cloud-backup.js:220): `stringify` → `TextEncoder` (sha) → `TextEncoder` (gzip) →
gunzip → **comparação de string inteira** (autoteste). Chunkado, então limitado por chunk; disparado após cada
importação [import.js:73](js/import.js:73) e a cada 30 min/3 h [cloud-backup.js:65-66](js/cloud-backup.js:65).

#### 3.4 Renderização e troca de página

**3.4.1 — Toda troca de página re-renderiza a página destino do zero.** `B, N` (depende da página)
`navigate` [ui.js:29](js/ui.js:29) → `renderPage` [dashboard.js:7933](js/dashboard.js:7933). Só `filiais` e
`materiais` são cacheadas (`_staticPages`). Entrar em SAP roda `renderSAP()` → `pageSlice` → `getFilteredData`
[ui.js:678](js/ui.js:678) → filtro de texto (O(N) se houver query) → filtro de coluna (O(N)) → **sort
`[...data].sort(comparador)`** se houver coluna ordenada. Sem query/filtro/sort, `getFilteredData` devolve o
array original e o custo é o `slice(50)` — barato. **Com** sort, é 3.4.2.

**3.4.2 — Ordenação por coluna: comparador com 4 regex + `parseFloat` ×2 + `localeCompare(..., {numeric:true})`
por comparação.** `B, N log N`
[ui.js:617-633](js/ui.js:617). `localeCompare` com options instancia um `Intl.Collator` por chamada. Para
1 M linhas: ~20 M comparações. O próprio comentário em [ui.js:691-696](js/ui.js:695) mede ~500 ms em 50 k;
extrapolando N log N → **~14 s em 1 M**, e roda em toda paginação (`pageSlice` chama `getFilteredData` de novo
a cada "próxima página" [ui.js:793](js/ui.js:793)).

**3.4.3 — Dashboard Analítico/Gerencial: agregação completa a cada entrada na página.**
`updateDashboard` [dashboard.js:519](js/dashboard.js:519) e `_rodarAnaliticoCore` [analitico.js:446](js/analitico.js:446)
não têm memoização por (versão da coleção + período). Trocar Analítico → SAP → Analítico com o mesmo período
recalcula tudo. Quantificar em (c). Funções > 150 linhas nesse caminho: `buildCentralCard` (1 125 linhas,
[analitico.js:940](js/analitico.js:940)), `renderDgGiro` (463), `buildDashboardGerencialResults` (250),
`_agrCompute` (238), `_ausComputar` (236) — misturam cálculo e `innerHTML`, o que é o que impede mover para
Worker sem refatorar.

**3.4.4 — `renderAll()` renderiza 12 páginas de uma vez.** `B`
[dashboard.js:7895](js/dashboard.js:7895), chamado em 20 pontos (`config.js` ×14, `import.js` ×2, `ui.js` ×3).
Qualquer alteração em cadastro (filial/material) redesenha todas as tabelas + Dashboard Gerencial.

**3.4.5 — Formatação: `toLocaleString` por valor, sem formatador pré-criado.**
`money()` [format.js:140](js/format.js:140) e `fmtKg` [dashboard.js:8374](js/dashboard.js:8374) chamam
`n.toLocaleString('pt-BR', {...})` — 45 usos em dashboard, 26 em relatorio, 24 em ui. Zero `new Intl.NumberFormat`
no projeto. Custo por chamada ~10× o de um formatador reutilizado; relevante onde roda por registro (rankings,
cards, exportações), irrelevante em 50 linhas de tabela.

**3.4.6 — Chart.js**: `destroy()` antes de recriar — OK no Gerencial. **Nenhum** gráfico usa `animation: false`
nem `decimation` (0 ocorrências). Quantificar em (c) se os `_dgVgCharts` aparecem como long task.

**3.4.7 — Listeners**: 167 `addEventListener` vs 34 `removeEventListener`. A maioria dos handlers de tabela é
`onclick` inline no HTML gerado (substituído junto com o `innerHTML`, sem vazamento). Os `document.addEventListener`
de nível superior são registrados uma vez. Não vejo vazamento óbvio por análise estática; (e) decide.

**3.4.8 — Layout thrashing**: não encontrei `offsetHeight`/`getBoundingClientRect` dentro de loops de render.
Não é foco.

#### 3.5 Gráficos — coberto em 3.4.6.

#### 3.6 Rede e Supabase

- 11 canais Realtime ativos após o boot (`_activityRealtimeInit`, `wipe`, `presence`, `msgs`, `oc`, `dai`,
  `custosSap`, `fech`, `fechInvUnlock`, `periodoFech`, `cap`) — [dashboard.js:8166-8198](js/dashboard.js:8166).
  O que cada evento dispara ainda não foi rastreado; `_custosSapRealtimeInit` chama `renderCustosSap()` por evento
  [import.js:1149](js/import.js:1149). Rastrear os demais na Fase 1 se (e) mostrar crescimento de memória ou long
  tasks em idle.
- Boot: `SUPABASE_BOOT_SYNCS` em `Promise.all` — bom (paralelo).
- Backup: ver 3.3.6.

#### 3.7 Estrutura do código

- **25 funções > 150 linhas**; as 5 maiores: `buildCentralCard` 1 125, `_dgrNomeArquivoRelatorio` 1 027 (nome
  enganoso — é o gerador do relatório), `_resolverAcoesParaMaterial` 947, `openBreakdownModal` 690,
  `processImportedRows` 526.
- Cálculo puro já isolado (candidatos a Worker sem reescrita): `_mergeDedup`, `_detectConflicts`, `_fp*`,
  `compactSapRecords`, `_parseCsvToRows`, `normalizeText`, `parseDate`, `_buildSapIndex`/`_buildLancIndex`.
  Os agregadores (`_agrCompute`, `_ausComputar`, `buildDashboardGerencialResults`) misturam DOM — precisariam
  de separação antes.
- Duplicação já conhecida pelo próprio código: `_lstepSet` existia em dois arquivos
  ([dashboard.js:7965](js/dashboard.js:7965), comentário); `updateToolsTheme` declarado 2× em `state.js`
  ([294](js/state.js:294) e [306](js/state.js:306)).

---

### 4. O que NÃO vou tocar (fora de escopo ou bug de lógica a reportar separadamente)

- Índice de busca não invalida em edição in-place (3.3.4) — bug de dado.
- `getListFilteredData('dashboard')` sem chamador aparente (3.3.3) — confirmar e, se morto, remover é limpeza,
  não performance.
- Sort por string de data via `toISO` (3.4.2) — a semântica de ordenação fica como está.

---

### 5. Baseline medido — sintético, código real, Chrome headless

O usuário não pôde rodar os cenários no navegador dele, então medi o que dá para medir sem ele: um harness em
Chrome 151 headless (`--enable-precise-memory-info`, 12 threads lógicas, 16 GB) que carrega os scripts **reais**
do projeto (`state, lookup, persist, normalize, format, ui, import, config, dashboard` — zero erros de carga),
gera N registros SAP sintéticos com a mesma forma dos reais (30 centrais, 200 materiais, ~1 000 datas distintas,
10 códigos de movimento) e cronometra cada função com `performance.now()`. Cada linha = 1 execução, síncrona.

O que este baseline **não** cobre (precisa do navegador do usuário com a base real): download/parse dos 33
scripts, I/O do IndexedDB, layout/paint das páginas, INP, Realtime, crescimento de memória em 10 min. Para esses
continua valendo o roteiro da seção 1.

#### 5.1 Memória

| Métrica | 500 k | 1 M |
|---|---|---|
| Heap após gerar SAP (objeto por linha, 23 campos) | 144 MB | 286 MB |
| **Bytes por registro SAP em memória** | **302 B** | **300 B** |
| Pico transitório de `compactSapRecords` (cópia completa) | +352 MB | +807 MB |
| `_getOrBuildIndex` (índice de busca por texto) | +303 MB | (~600 MB) |
| Heap ao fim do harness | 752 MB | 1 440 MB |

#### 5.2 Boot (parte computacional)

| Função | 500 k | 1 M | Ref. |
|---|---|---|---|
| `applySavedState` `.map` de id | 9 ms | 44 ms | [persist.js:463](js/persist.js:463) |
| `applySavedState` `.filter` pulzsys | 13 ms | 66 ms | [persist.js:479](js/persist.js:479) |
| **`reaplicarPadronizacaoMateriais`** (só SAP) | **482 ms** (+65 MB) | **2 384 ms** (+139 MB) | [normalize.js:909](js/normalize.js:909) |
| `_buildSapIndex` | 24 ms | 172 ms | [ui.js:5444](js/ui.js:5444) |
| `getSapDuplicateKeys` (frio, 1º `renderSAP`) | 1 802 ms | — | [ui.js:337](js/ui.js:337) |
| **`persistStateNow` ao fim do boot** — ver 5.3 | **≈ 7 s** | **≈ 16 s** | [dashboard.js:8303](js/dashboard.js:8303) |

#### 5.3 Persistência — custo de UM `persist()` (tudo na thread principal)

| Etapa | 500 k | 1 M | Ref. |
|---|---|---|---|
| `compactSapRecords` (1ª, em `buildStateSnapshot`) | 1 000 ms | 4 164 ms | [persist.js:277](js/persist.js:277) |
| `compactSapRecords` (2ª, em `saveSapChunks`, **sobre o já compactado**) | 1 490 ms | 3 888 ms | [persist.js:174](js/persist.js:174) |
| `buildStateSnapshot` total (inclui a 1ª) | 1 862 ms | 4 621 ms | [persist.js:392](js/persist.js:392) |
| Serialização dos chunks (`structuredClone` de 50/100 × 10 k ≈ o que o `put` do IDB faz) | 3 627 ms | 7 160 ms | [persist.js:184](js/persist.js:184) |
| **Total CPU por salvamento (sem I/O, sem as outras coleções)** | **≈ 7,0 s** | **≈ 15,7 s** | |
| `JSON.stringify` SAP (caminho `_emergencySave`/fallback) | 2 845 ms | 12 377 ms | [persist.js:783](js/persist.js:783) |

Isso é pago em **toda** chamada de `persist()` (marcar um checkbox de override, salvar uma justificativa, editar
um cadastro), mesmo que SAP não tenha mudado, e mais uma vez ao final do boot.

#### 5.4 Importação (500 k existentes + 100 k novos, 50 % duplicados)

| Etapa | 500 k | 1 M | Ref. |
|---|---|---|---|
| `_detectConflicts` | 33 ms | 148 ms | ok |
| `_fpSap` × N (uma passada) | 727 ms | 3 620 ms | [dashboard.js:6555](js/dashboard.js:6555) |
| **`_mergeDedup` como está** | **3 654 ms** | **30 340 ms** | [dashboard.js:6597](js/dashboard.js:6597) |
| `_mergeDedup` com fingerprint calculado 1× (mesma semântica) | 1 835 ms | 9 848 ms | protótipo no harness |
| `compactSapRecords` extra antes do merge | 1 000 ms | 4 164 ms | [dashboard.js:6504](js/dashboard.js:6504) |

Parse do Excel (arquivo gerado no harness com 200 k linhas × 15 colunas, **inflado** — 107 MB por não usar
shared strings; os tempos absolutos são maiores que num MB51 real, as proporções valem):

| Etapa | 200 k linhas | Ref. |
|---|---|---|
| `XLSX.read` esparso (`dense:false`, como hoje) | **15 290 ms** (+520 MB) | [dashboard.js:7591](js/dashboard.js:7591) |
| `sheet_to_json` (esparso) | 1 742 ms | [dashboard.js:7635](js/dashboard.js:7635) |
| `XLSX.read` **`dense:true`** | 9 883 ms (+288 MB) | |
| `sheet_to_json` (dense) | **86 ms** | |
| CSV equivalente (18,9 MB): split nativo | **289 ms** | [dashboard.js:7484](js/dashboard.js:7484) |

Yield entre lotes: `batchSize` 200–700 → em 1 M de linhas, 1 430–5 000 `nextFrame()` × ≥ 16 ms = **23–80 s
só esperando frame** ([dashboard.js:6698](js/dashboard.js:6698)).

#### 5.5 Render / navegação / filtro

| Função | 500 k | 1 M | Ref. |
|---|---|---|---|
| `getFilteredData('sap')` sem filtro/sort | 1 ms | 12 ms | ok |
| `renderSAP()` 1ª vez (cache de duplicatas frio) | 1 599 ms | — | [dashboard.js:4971](js/dashboard.js:4971) |
| `renderSAP()` 2ª vez (cache quente) | 93 ms | — | |
| ↳ `renderSapSummary` (soma N a cada render) | 169 ms | — | [ui.js:6093](js/ui.js:6093) |
| **`_applyModuleSort` coluna numérica (`peso`)** | **1 836 ms** | **9 691 ms** | [ui.js:617](js/ui.js:617) |
| **`_applyModuleSort` coluna de data (`localeCompare`)** | **4 254 ms** | **17 109 ms** | |
| Mesmo sort com chave pré-computada + 1 `Intl.Collator` (mesma ordem) | 640 ms | 2 672 ms | protótipo |
| `_getOrBuildIndex('sap')` (1º filtro de texto) | 1 128 ms (+303 MB) | 10 875 ms | [lookup.js:17](js/lookup.js:17) |
| `filterRecords` "central 05" (índice quente) | 300 ms | 2 084 ms | |
| `parseDate` × N | 416 ms | 1 700 ms | [dashboard.js:8346](js/dashboard.js:8346) |
| `parseDate` × N com cache `Map` | 9 ms | 59 ms | protótipo |
| `money()` × N (`toLocaleString`) | **21 520 ms** | 85 015 ms | [format.js:140](js/format.js:140) |
| `Intl.NumberFormat` pré-criado × N | 710 ms | 2 226 ms | protótipo — **30×** |
| `getListFilteredData('dashboard')` | 31 344 ms | 53 358 ms | [ui.js:710](js/ui.js:710) — **sem chamador: código morto** |
| `renderLancamentos` 1ª / 2ª (125 k) | 208 / 28 ms | — | ok |

Nota: o sort "por data" de hoje cai no ramo numérico (`parseFloat("01022024")`) e ordena por DDMMAAAA — isso é
um **bug de lógica** pré-existente (ordena pelo dia, não pela data); a otimização preserva o comportamento atual
e o bug fica reportado à parte na seção 7.

---

### 6. Fase 2 — Plano priorizado (aguardando aprovação)

Ordenado por ganho/esforço. "Ganho" é o medido na 5.x (500 k / 1 M); "Verificável aqui" = consigo provar
antes/depois no harness sem o navegador do usuário.

| # | Problema | Evidência | Impacto no usuário | Esforço | Risco | Ganho estimado | Verificável aqui |
|---|---|---|---|---|---|---|---|
| 1 | `compactSapRecords` roda 2× por salvamento (2ª sobre o já compactado) | 5.3: 1,5 s / 3,9 s | Todo `persist()` e o fim do boot | **P** (1 linha: `saveSapChunks` recebe já compactado) | Baixo — saída idêntica (compactar 2× é idempotente) | −1,5 s / −3,9 s por save; −350 MB de pico | Sim |
| 2 | `persistStateNow()` ao fim de **todo** boot, mesmo sem mudança | 5.3: ≈ 7 s / 16 s | Boot | **P** (só gravar se `reaplicar`/migração/limpeza alteraram algo) | Baixo-médio — depende de #3 para "nada mudou" ser verdade | −7 s / −16 s de boot | Parcial (CPU sim, I/O não) |
| 3 | `reaplicarPadronizacaoMateriais()` recria todos os objetos em todo boot | 5.2: 0,48 s / 2,4 s, +65/139 MB | Boot | **P** — guardar no `meta` do IDB um carimbo do cadastro de materiais (n + pares origem→alias) e só reaplicar se mudou. `config.js` já chama reaplicar quando o cadastro muda em sessão | Médio — se o carimbo falhar em detectar mudança, padronização fica velha até a próxima importação | −0,5 s / −2,4 s de boot e −65/139 MB | Sim |
| 4 | `_mergeDedup` calcula fingerprint ~5× por registro | 5.4: 3,65 s → 1,84 s (500 k); 30 s → 9,8 s (1 M) | Import (congelamento sem progresso) | **P** — mesma função, fp em array paralelo | Baixo — função pura, resultado e ordem idênticos, testável em Node | **−50 % / −67 %** do merge | Sim + teste Node |
| 5 | Sort de coluna: 4 regex + `parseFloat` ×2 + `localeCompare` c/ options por comparação; re-sort a cada paginação | 5.5: 4,25 s → 0,64 s (500 k); 17 s → 2,7 s (1 M) | Clique em cabeçalho, próxima página, checkbox em massa | **P** — chave calculada 1× por linha + `Intl.Collator` único; cache do resultado por (array, col, dir) | Baixo — comparador equivalente (incl. o ramo numérico atual); cache invalida onde `_lastFiltered` já invalida | **−85 %** no sort; paginação passa de O(N log N) para O(1) | Sim |
| 6 | `parseDate` sem cache — regex + split + `new Date` por registro por filtro | 5.5: 416 ms → 9 ms / 1,7 s → 59 ms por passada; 77 pontos de chamada | Todo filtro de período (Analítico, Gerencial, Inventário) | **P** — `Map<string, timestamp>`; devolve `new Date(ts)` (há 90 `.set*` no projeto — não pode compartilhar o objeto) | Baixo — mesma saída | ~−90 % do custo de datas em cada recálculo | Sim |
| 7 | `money`/`fmtKg`/`toLocaleString` por valor | 5.5: 30× mais lento que formatador pré-criado | Rankings, cards, relatório, exportações (onde roda por registro) | **P** — `Intl.NumberFormat` cacheado por `decimals`; mesmo ICU, mesma string | Baixo | Depende de quantas formatações por render — a medir no browser; ordem de 100 ms–1 s por painel | Sim (micro) |
| 8 | `XLSX.read` esparso + `sanitizeWorksheet` por endereço | 5.4: read −35 %, `sheet_to_json` −95 %, memória −45 % | Import — o trecho sem progresso | **P/M** — `dense:true` + `sanitizeWorksheet` iterando `ws['!data']` (hoje ela ficaria muda em dense) | Médio — `sanitizeWorksheet` precisa de teste com célula de erro em dense | −6 s por 200 k linhas no meu arquivo inflado; menos no real | Sim (com XLSX via CDN) |
| 9 | Lotes de import cedem 1 frame a cada 200–700 linhas | 5.4: 23–80 s de espera pura em 1 M | Import | **P** — lote por **tempo** (~40 ms de trabalho) e `scheduler.yield()` c/ fallback `setTimeout(0)` | Baixo | −20 a −70 s em 1 M; UI continua respondendo igual (ou melhor) | Parcial |
| 10 | 1,17 MB de fontes base64 em `relatorio.js` em todo boot | 3.1.1: 29 % do JS | Boot (download + parse) | **P** — mover as 2 funções para `js/relatorio-fontes.js`, carregado por Promise só quando `offlineCompleto` | Baixo — o único consumidor é o relatório offline; CSP já permite `'self'` | −1,17 MB por boot; tempo depende da rede — só o browser do usuário mede | Não (bytes sim, tempo não) |

Fora do top 10, já identificados e com número, para as ondas seguintes:

| # | Problema | Evidência | Esforço | Observação |
|---|---|---|---|---|
| 11 | Serialização dos chunks SAP no `put` do IDB (3,6 s / 7,2 s) | 5.3 | **M** — IDB dentro de um Worker (o `structuredClone` do `postMessage` ainda custa 1×, mas o `put` sai da thread principal) ou gravar só chunks sujos | Onda A/C. `invalidateSapIndex()` **não** cobre edição in-place, então dirty-flag precisa de um contador de versão próprio nos pontos de mutação — enumerar com cuidado |
| 12 | `renderSapSummary` soma N a cada render da página SAP | 5.5: 169 ms | **P** — cache pela referência de `_lastFiltered.sap` | Onda D |
| 13 | `getListFilteredData('dashboard')` — 31 s potenciais, 0 chamadores | 5.5 | **P** — remover | Limpeza, não performance |
| 14 | Índice de busca por texto: +303 MB em 500 k | 5.1 | **M** — índice por campo só sob demanda, ou busca sem índice materializado (300 ms vs 1,1 s + 303 MB: o índice só compensa a partir da 4ª busca) | Onda B |
| 15 | Worker para `XLSX.read` + `sheet_to_json` + CSV | 5.4 | **M/G** | Onda A — depois de #8 |
| 16 | Carregamento sob demanda dos módulos/CDN | 3.1.2 | **G** | Onda E — precisa do baseline de boot do browser |

Metas do briefing revisadas à luz de 5.x:
- "Salvamento nunca bloqueia > 50 ms": **irreal** com objeto-por-linha + `structuredClone` de 1 M na thread
  principal, mesmo após #1. Realista após #1/#2: ~5 s / ~11 s por save de SAP, e **zero** quando SAP não mudou
  (#11). Chegar a < 50 ms exige Worker + gravação incremental (#11, Onda C).
- "Import de 1 M: −50 %": #4 + #8 + #9 somados dão isso na parte que medi; o parse no Worker (#15) é o que faz
  "UI nunca congela".
- "Boot −40 %": #2 + #3 + #10 tiram 8–19 s de CPU + 1,17 MB de download; a fração depende do baseline real.

---

### 7. Bugs de lógica encontrados (reportados, NÃO corrigidos junto com performance)

1. **Sort por data ordena por dia** — `_applyModuleSort` ([ui.js:625-628](js/ui.js:625)): `"01/02/2024"` vira
   `parseFloat("01022024")` e cai no ramo numérico antes de chegar ao `toISO`. Ordenar por `dtLanc` ordena por
   DDMMAAAA como número.
2. **Índice de busca não invalida em edição in-place** — `_getOrBuildIndex` ([lookup.js:19](js/lookup.js:19))
   usa `records.length` como versão; editar um campo sem mudar o tamanho mantém o índice velho.
3. **Importar SAP descarta campos não persistidos dos registros existentes** — `existingForMerge =
   compactSapRecords(state.sap)` ([dashboard.js:6504](js/dashboard.js:6504)) e o resultado vira o novo `state.sap`.
   `editado` não está em `SAP_PERSIST_FIELDS` ([persist.js:258](js/persist.js:258)), então `original.editado`
   em `_mergeDedup` nunca é `true` para SAP e a proteção de "registro editado" não se aplica. (Se `editado` for
   marcado por outro campo em SAP, ignorar este item.)
4. `updateToolsTheme` declarada duas vezes em `state.js` ([294](js/state.js:294), [306](js/state.js:306)) —
   inócuo, só limpeza.

---

### 8. Próximos passos

1. **Aprovação** dos itens do top 10 (ou de um subconjunto). Sugestão de 1ª onda: #1, #4, #5, #6, #7, #13 —
   todos puros, sem mudança de formato persistido, cada um verificável no harness com antes/depois.
2. Pendências de ambiente: **Node.js** para `node --test tests/` (não instalado aqui) e **graphify**.
3. Quando puder, rodar o roteiro da seção 1 no navegador real: é o único jeito de medir boot, IDB, INP e memória
   em 10 min — e de dizer se o top 10 acima está na ordem certa para a base real.
