# Query History search, pagination, and database-scoped deletion

## Summary and reason

Query History previously loaded only 50 rows and searched that small client-side list. The new API searches SQL and database names before pagination; SQL Lab can load more pages and delete history for the selected database after confirmation.

The default GET response remains the existing array. New clients opt into a paging envelope. A new UI connected to an old sidecar detects the array, searches only the latest 50 returned rows, and shows that limitation. Unsupported deletion fails visibly without clearing history.

The fixed contract, Peer candidates and Lead acceptance, cleanup, and recovery evidence are recorded in [the work-status document](2026-10-14-query-history-work-status.md). Candidate branch: `iamVinhNT/slp-history-recovery`, worktree `/home/vinhnt/orca/workspaces/QurioDB/slp-history-recovery`, original base `dev` at `38e75d1437fbc1b598812c4f162fe879c2183a0a`.

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

Recovery verification and the merged browser acceptance are pending and will be recorded before delivery. The original integration checkout/branch disappeared during verification for an unproven reason; Supervisor authorized recovery from preserved integrated commit c2c81a7. Both Peer worktrees/branches remain intact, API terminal preserved by Orca as user-owned, Web terminal released with transcript archive, zero reclaimable workers. No push or merge to dev.
