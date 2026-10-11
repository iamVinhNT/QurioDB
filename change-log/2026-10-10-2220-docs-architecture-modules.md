# Add architecture and module documentation

Date: 2026-10-10 22:20 (local)

## Summary

Added structured technical documentation written from the current code: nine architecture docs (cross-cutting design) and nine module docs (per feature), plus an index. Claims were checked against the source; places where code and older notes disagree are stated in the docs (for example, sidecar lifecycle lives in `backend.rs`, not only `lib.rs`; the Redis executor has no command allowlist; the `autoExplain` setting is not consumed; `ProtectedRoute` is unused).

## Files changed

All new, under `docs/`:

- `README.md`: index and conventions.
- `architecture/01-system-overview.md`: monorepo, topology, request flow, API prefixes.
- `architecture/02-desktop-runtime.md`: Tauri sidecar start, nonce readiness, generations, shutdown.
- `architecture/03-backend.md`: FastAPI layout, routes, services, env vars.
- `architecture/04-database.md`: metadata SQLite store, tables, migrations, seeds.
- `architecture/05-connectors-and-execution.md`: connections, metadata providers, SQL policy and approvals.
- `architecture/06-ai-and-rag.md`: providers, task routing, streaming, agent, retrieval.
- `architecture/07-frontend.md`: routes, providers, API client, state.
- `architecture/08-security.md`: auth, secrets, SQL safety, known gaps.
- `architecture/09-build-and-release.md`: sidecar and desktop build, versioning, CI, tests.
- `modules/01-sqllab.md` to `modules/09-data-import.md`: SQL Lab, connections, schema explorer, AI assistant, RAG, settings, dashboard, auth, data import.

## Impact

- Desktop, API, UI, data: none (no source code changed).
- Note: `docs/` is listed in `.gitignore` (line 89), so these files are not tracked by git unless force-added (`git add -f docs/...`). Seven files under `docs/` are already tracked.

## Verification

Documentation-only change. Content was cross-checked by reading the referenced source files; no tests or builds were run.
