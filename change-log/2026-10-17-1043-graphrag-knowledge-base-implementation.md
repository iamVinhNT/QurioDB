# GraphRAG and Markdown Knowledge Base implementation

## Summary and why

Implement the approved AI SQL GraphRAG and knowledge-authoring plan. Users can preserve original Markdown, review business definitions and schema bindings, publish immutable evidence, and explicitly enable it for SQL. Typed FK/business graph expansion supplies JOIN evidence while retaining the existing hybrid retriever and SQL approval policy.

## Files changed

- API models: `models/knowledge.py`, `rag_graph.py`, exports and idempotent startup migration.
- API contracts/routes: `schemas/knowledge.py`, `routes/knowledge.py`, `rag_graph.py`, router/exception wiring.
- Services: `knowledge_access.py`, `knowledge_service.py`, `knowledge_publish.py`, `knowledge_graph.py`, `knowledge_embeddings.py`, `knowledge_preview.py`; FastAPI lifespan worker.
- Retrieval: `schema_graph.py`, `graph_retrieval.py`, authoritative managed-source filters, query source plan, Unicode search, context budgeting/citations, sync integration and evaluation coverage helper.
- UI: `src/app/knowledge/*`, typed `lib/knowledge-api.ts`, lazy routes/navigation, SQL Lab immutable citation links and non-executing question handoff.
- Tests: knowledge/graph/route/lifecycle/evaluation suites; reusable isolated test runner and Linux frozen/native smoke scripts; focused knowledge UI tests and updated intent expectation.
- Local ignored docs: plan audit, architecture/RAG module updates, Knowledge Base module and implementation verification report with UI evidence.

## Impact

- Desktop: local additive tables and lifespan publication worker; sidecar rebuilt. Dynamic loopback URL, startup nonce, readiness guard and parent-death behavior retained. Linux `.deb` rebuilt; Windows/macOS unverified.
- API/data: drafts separate from immutable revisions; version conflicts return 409. Provider work staged outside the activation transaction. Active owner/base/revision/snapshot filters revoke stale/archive/unpublished evidence before physical cleanup. Legacy sources are never promoted automatically.
- UI: `/knowledge` library, Markdown editor/templates, metadata/metric/rule/example/JOIN forms, publish/history, relation list/lazy graph, context preview and versioned citations. Export preserves Markdown; mappings remain local. New bases start disabled for SQL.
- AI/safety: explicit opt-in; no automatic LLM extraction, writes or SQL execution from authoring/preview/handoff. Managed embedding credentials are owner-scoped with 10-second/one-attempt HTTP calls. No new dependency, graph server or queue service.
- Unrelated Vector Store source-workspace/minimap/pagination work was preserved.

## Verification

- Baseline isolated API suites: 50 passed, 2 skipped (missing live-evaluation fixture file).
- `venv/bin/python tests/run_isolated.py` from `apps/api`: RAG suite **223 passed**; focused knowledge/graph/SQL safety suites **44 passed**, with overlap.
- Web: `bunx vitest run tests/components/knowledge tests/components/sqllab/context-sources.test.tsx tests/lib/runtime-api.test.ts` — **25 passed**; `bunx tsc --noEmit` PASS; production build PASS.
- Rust: `cargo test --target x86_64-unknown-linux-gnu --quiet` — **24 passed**. Plain cargo selected the checked-in Windows target and lacked MinGW dlltool; explicit Linux passed.
- Clean PyInstaller build and `bun run tauri build --target x86_64-unknown-linux-gnu --bundles deb` PASS. Embedded bytecode matched final source for all seven changed knowledge/retrieval modules. Final copied-sidecar smoke PASS (publish, graph/context/citations, persisted-job recovery, parent-death exit); final rebuilt native bundle smoke PASS (dynamic port/nonce readiness, isolated metadata, sidecar shutdown).
- Tiny synthetic offline HTTP preview: 10 samples, one document/table, p50 12.98 ms, p95 22.71 ms, maximum sampled sidecar process-tree RSS 356.12 MiB. This is not a reference-corpus or live-model benchmark.
- Real isolated API UI flow: create/save/publish/bind/enable, graph/list, context/citation, SQL Lab prefill; no provider or SQL execution call. Three desktop resolutions checked without horizontal overflow, plus light/dark screenshots and inert Markdown.
- `git diff --check` PASS.
- Final regression checks include separate JOIN/document citation identities with the correct reviewed section, and owner-specific embedding credentials even through the general RAG retrieval API.

## Limits

Live-model A/B/C/D, holdout SQL accuracy, actual tokenizer/cost/generation latency and reference-machine corpus/RAM measurements remain UNVERIFIED; no provider key or paid calls were used. Full keyboard/native content audit remains unverified where Playwright physical input stalled. Native WebKit logged an internal-load error around process teardown; shell/nonce/sidecar lifecycle checks passed, which does not prove full native UI rendering.

Graph remains opt-in. Deterministic evidence/result fixtures are not reported as model accuracy. Full commands, AC audit and screenshots live in `docs/reports/2026-10-17-graph-rag-implementation.md` (docs is intentionally gitignored).
