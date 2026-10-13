# Query History search, pagination, and database-scoped deletion

## Summary and reason

Query History previously loaded only 50 rows and searched that small client-side list. The new API searches SQL and database names before pagination; SQL Lab can load more pages and delete history for the selected database after confirmation.

The default GET response remains the existing array. New clients opt into a paging envelope. A new UI connected to an old sidecar detects the array, searches only the latest 50 returned rows, and shows that limitation. Unsupported deletion fails visibly without clearing history.

The fixed contract, Peer candidates and Lead acceptance, cleanup, and recovery evidence are recorded in [the work-status document](2026-10-14-query-history-work-status.md). Candidate branch: `iamVinhNT/query-history-final`, worktree `/home/vinhnt/DEV/QurioDB-history-final`, original base `dev` at `38e75d1437fbc1b598812c4f162fe879c2183a0a`.

## Files changed

- `apps/api/routes/execution_routes.py`: validated GET paging and scoped DELETE.
- `apps/api/services/execution/__init__.py`: search before paging, deterministic ordering, transaction-safe deletion.
- `apps/api/schemas/execution.py`: opt-in page and delete-count responses.
- `apps/api/tests/test_execution.py`: real SQLite/HTTP regressions.
- `apps/web/src/lib/api-client.ts`: page/delete methods and old-backend normalization.
- `apps/web/src/app/sqllab/components/SQLLabHistoryPanel.tsx`: search, paging, confirmation, errors and request-race handling; cache prefix matches query execution refresh.
- `apps/web/tests/lib/api-client-history.test.ts` and `apps/web/tests/components/sqllab/sql-lab-history-panel.test.tsx`.
- `CHANGELOG.md` and the work-status document.

## Impact

- Desktop: runtime API URL patterns preserved. Older sidecars offer limited search and no deletion, reported by the UI. Sidecar rebuild deliberately skipped per user decision; packaged desktop startup, health, URL and shutdown unverified.
- API: authenticated GET `/api/database/history` adds q/limit/offset/paginated parameters while preserving the default 50-row array. Authenticated DELETE requires nonblank databaseId; empty or missing IDs return 422, and unknown IDs return deletedCount 0.
- UI: server search, explicit Load more, refresh resetting pages, visible failures, selected-database confirmation warning about database health stats and AI history context.
- Data: physical deletion of selected database QueryHistory rows resets history-derived health statistics and removes source rows for future RAG history indexing. Existing indexed RAG records are unchanged. No columns, migrations, userId, or SQL-policy/RAG/health implementation changes.
- Limits: deterministic created_on/ID ordering, but offset pages can shift under concurrent inserts/deletes; refresh restarts paging. SQLite search follows ASCII case-insensitive matching.

## Verification

On the original merged candidate, `python -m pytest tests/test_execution.py` using `/home/vinhnt/DEV/QurioDB/apps/api/venv/bin/python` passed 37 tests; related Web Vitest passed 47 tests across five files; `bunx tsc --noEmit` passed. The first Web run had two default-URL assertion failures caused by dev VITE_API_URL=5127; clearing VITE_API_URL passed all 47 tests. Root `.venv` lacked FastAPI; the source repo API venv provides Python 3.14.4 and FastAPI 0.137.2.

API Peer also passed 46 nearby SQL-policy, AI-policy, saved-query and NoSQL regression tests. Dependency/model deprecation warnings remain.

Dev verification uses temporary SQLite metadata and targets; no user data is mutated. Baseline olderneedle search reproduced the 50-row limit. New Web against the old running backend showed the latest-50 limitation, required the health/AI confirmation, and displayed unsupported DELETE failure while retaining history.

Final checkout checks:

- From apps/api: `/home/vinhnt/DEV/QurioDB/apps/api/venv/bin/python -m pytest tests/test_execution.py` — 37 passed in 2.78s, 342 dependency/model deprecation warnings.
- From apps/web: `VITE_API_URL= bunx vitest run tests/lib/api-client-history.test.ts tests/components/sqllab/sql-lab-history-panel.test.tsx tests/services/api-client.test.ts tests/lib/api-client-confirmation.test.ts tests/lib/runtime-api.test.ts` — 47 passed across five files in 11.72s.
- From apps/web: `bunx tsc --noEmit` — exit 0. `git diff --check` — clean.
- Browser on `bun run dev`, UI port 3001/API port 5127: search found original olderneedle beyond latest 50; three UI executions refreshed history automatically; Load more expanded 50 to 57 and disappeared at end; refresh reset the page; search reset returned all four matching rows. Cancel left 58 entries intact; confirmed delete removed 58 despite an active search and emptied the panel. GET and raw metadata SQL verified selected database 0 rows, other database 1 row. Dialog text and screenshot were visually inspected. Evidence: `/tmp/quriodb-history-verification/browser-verification.json` and `/home/vinhnt/DEV/QurioDB/.playwright-mcp/query-history-delete-confirmation.png`.

All requested browser flows were verified. Packaged desktop app, sidecar build and desktop startup/nonce-health/API-URL/shutdown remain deliberately unverified per user decision.

Both Orca-managed integration checkouts and their branches disappeared externally around 00:50:13 and 00:54:20; cause remains unproven. Supervisor authorized reconstruction from preserved commit 57d76f1 in a plain Git worktree outside Orca storage and rerunning final checks. Both Peer worktrees/branches remain intact; API terminal preserved by Orca as user-owned, Web terminal released with transcript archive, zero reclaimable workers. No push or merge to dev.

Dev verification processes were stopped after acceptance. Temporary local env files and the untracked API venv symlink were removed; ignored node_modules links remain for review. Main user edits and dev HEAD remain unchanged.
