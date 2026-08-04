## Confirmar antes de implementar

Se o pedido do usuário ficar ambíguo, suscetível a erro, mal explicado, ou você tiver qualquer dúvida sobre o que foi pedido, SEMPRE PERGUNTE ANTES DE IMPLEMENTAR QUALQUER COISA. Não presuma o entendimento correto e siga direto pro código — confirme primeiro.

## Preview / local server

Never start a local dev server or open the Browser pane (`preview_start`, `preview_*`, embedded browser tools) for this project — it crashes the desktop app. The user always tests changes themselves in their own browser. Only use these tools if the user explicitly asks for them in that message.

## ponytail

Ponytail (lazy-senior-dev mode) must stay active for all coding work in this project: climb the ladder (YAGNI → reuse → stdlib → native → existing dep → one-liner → minimum code) before writing anything, keep diffs short, and mark deliberate corner-cuts with a `ponytail:` comment naming the ceiling and upgrade path.

## headroom

Use `headroom_compress` on large tool outputs (file reads, search results, logs, JSON) before reasoning over them, to keep context usage low. Use `headroom_retrieve` with the returned hash when the full original content is needed.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
