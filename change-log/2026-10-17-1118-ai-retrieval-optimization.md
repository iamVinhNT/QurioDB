# AI retrieval and streaming optimization

## Summary and why

Fix the confirmed AI review regressions: schema index and graph synchronization overwrote the same source using incompatible content; unscoped embedding credentials could select another user's Google key; obsolete vectors consumed top-k before eligibility filtering; prompt assembly repeatedly fetched metadata; every SSE fragment committed the whole response. Relational SQL agent and autocomplete now share GraphRAG evidence.

## Changes

- One strict snapshot includes columns, composite/cross-schema foreign keys and indexes. Schema indexing and graph sync share an atomic source/chunk/graph writer. Matching chunks retain IDs/vectors; missing embeddings are staged before SQLite writes. Reflection errors preserve the last successful snapshot.
- Consolidated the Google embedding gateway around current owner credentials, bounded timeout/attempts and lexical fallback. Removed the system-key helper and process-wide cached key. Propagated the actor to query-history/shared saved-query indexing without changing shared source ownership.
- Filter active knowledge, base and schema in SQL before loading candidate text. No unused `RagEmbedding.vectorJson` deserialization. sqlite-vec receives eligible rowids before KNN top-k.
- RAG disabled short-circuits context bootstrap/metadata and graph expansion, including preview. Identifier contracts reuse columns once per schema.
- Chat and SQL action streams share bounded snapshot persistence: first event, 1 second or 4096 new characters on incoming events, and final/error/generator-cancellation flush. Structured events and retrieval-event deduplication remain compatible.
- SQL agent graph/legacy paths and inline completion use common owner-scoped context. Known SQL tasks avoid an extra intent classifier request. MongoDB retains its existing trusted context and execution policy.
- Saved task temperature/token settings now reach ordinary invoke/stream generation independently of model selection. Autocomplete and triage retain deliberate call-specific limits. Removed unused provider, query-syntax and MongoDB helpers plus unused imports/variables.

## Files changed

API routes: `routes/ai_stream.py`, `routes/rag.py`.

AI services: `services/ai_service.py`; `services/ai/{agent,base,context,langchain_runtime,mongodb_query,query_understanding,rag_context,task_model_router}.py`; `services/ai/retrieval/{embedding_gateway,index_service,metadata_source,pipeline,retrieval_service,schema_graph,sqlite_vec_store,graph_retrieval}.py`; `services/{knowledge_embeddings,knowledge_publish}.py`.

Tests: `tests/test_ai_optimization.py`, `tests/test_graph_rag_scope.py`, `tests/test_rag_index.py`, `tests/test_task_model_router.py`.

Docs: `docs/specs/2026-10-17-ai-optimization.md`, `docs/plans/2026-10-17-ai-optimization.md`, `docs/modules/{04-ai-assistant,05-rag}.md`, `docs/architecture/06-ai-and-rag.md` (docs remain gitignored). `CHANGELOG.md` links this record.

## Impact

- Desktop: requires a rebuilt Python sidecar; Linux package/lifecycle verification tracked below.
- API: existing response/SSE contracts retained. Query-history indexing now explicitly resolves the authenticated actor. SQL execution approval remains enforced server-side.
- UI: no frontend source changes in this optimization. Concurrent Vector Store UI work remains intact.
- Data: no migration; immutable revision history retained. Matching chunks preserve IDs and embeddings. A first canonical schema sync can update older hashes/evidence together.
- Cost/performance: identical schema reindex issues zero new embedding calls. Synthetic 1000-candidate/1536-dimension loading peak fell from 56.42 MiB to 2.17 MiB (~96%). Eight selected tables use 1 full-schema column fetch instead of 10. One hundred short SSE fragments produce 2 commits instead of 100. These are isolated fixture measurements, not production latency or model-accuracy claims.

## Verification

In progress; final command results and Linux artifact/lifecycle evidence will be appended before completion. Tests use disposable HOME, fake provider keys/vectors, and blocked provider sockets; no paid inference or production metadata changes.

## Limits

Lexical matching still scans eligible text in memory. A hard process kill may lose the unflushed SSE batch. Real provider quality/cost, Windows/macOS packaging and full native UI interaction are unverified in this Linux run.

### Verified API and web results

- `cd apps/api && venv/bin/python tests/run_isolated.py tests/test_ai_*.py tests/test_graph_rag_*.py tests/test_knowledge_*.py tests/test_rag_*.py tests/test_schema_retriever.py tests/test_task_model_router.py tests/test_langchain_runtime.py tests/test_sql_safety.py -q --tb=short`: **408 passed**. Covers MongoDB regressions, SQL policy, credentials/rotation, real SQLite reflection, stable chunk IDs/vectors, inactive/base/schema KNN scope, batching, cancellation, task options and common SQL context.
- `cd apps/api && venv/bin/python tests/run_isolated.py -m rag -q --tb=short`: **242 passed**, 517 deselected. Overlaps the suite above; counts are not additive.
- `cd apps/web && bunx vitest run tests/hooks/use-ai-chat.test.ts tests/components/knowledge`: **34 passed**. `bunx tsc --noEmit`: **PASS**.
- `cd apps/desktop/src-tauri && cargo test --target x86_64-unknown-linux-gnu`: **24 passed**. Plain `cargo test` first failed because repository config defaults to `x86_64-pc-windows-gnu` and this Linux environment lacks `x86_64-w64-mingw32-dlltool`; the explicit Linux target resolves the environment mismatch.
- `cd apps/api && venv/bin/python -m PyInstaller specs/api-x86_64-unknown-linux-gnu.spec --noconfirm --clean`: **PASS**. Compared 21 frozen AI module code objects against current source: **PASS**. Copied rebuilt binary into `apps/desktop/src-tauri/bin/`.
- `apps/api/venv/bin/python apps/api/tests/smoke_knowledge_sidecar.py`: **PASS**. Enhanced the smoke with a real SQLite index and repeated index/graph calls: chunk IDs and index text remain stable and published knowledge remains retrievable. Dynamic port, required nonce, publish/preview/graph/revision round trips, restart recovery and parent-death shutdown pass with temporary HOME. Ten one-document/one-table offline previews: p50 12.38 ms, observed p95 15.17 ms, max sampled process-tree RSS 356.19 MiB. This tiny fixture is not a corpus-scale benchmark.

Existing dependency deprecation warnings remain (SQLAlchemy datetime/legacy APIs, Google typing and FastAPI TestClient); no new test failure remains in the completed suites.

### Linux package and final verification

- `cd apps/desktop && bun run tauri build --target x86_64-unknown-linux-gnu --bundles deb`: **PASS**, including TypeScript and Vite production build. Artifact: `apps/desktop/src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/deb/QurioDB_0.1.5_amd64.deb`.
- `apps/api/venv/bin/python apps/api/tests/smoke_knowledge_desktop.py`: **PASS** on `QurioDB_0.1.5_amd64.deb`. The smoke now selects the most recently built deb and checks the extracted sidecar SHA-256 against the rebuilt binary, so an older package cannot silently satisfy the check. Native startup, dynamic API port, nonce readiness, isolated metadata and sidecar shutdown all pass. These checks do not exercise the full native UI.
- Also changed `tests/smoke_knowledge_sidecar.py` and `tests/smoke_knowledge_desktop.py` for the package regressions described above.
- `git diff --check`: **PASS**. No commits, staging, package installation or production database changes were performed.

All acceptance criteria AC1–AC9 in the optimization spec have corresponding passing verification. Windows/macOS and live-provider inference remain outside this Linux verification run.
