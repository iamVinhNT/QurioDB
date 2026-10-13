# Query History implementation contract and work status

Base: `dev` at `38e75d1437fbc1b598812c4f162fe879c2183a0a`.
Integration: `/home/vinhnt/orca/workspaces/QurioDB/slp-history-integration`, branch `iamVinhNT/slp-history-integration`.
Lead child Run: `run_b15a087a38d7`. Lead owns this status document and final changelog. API and Web Peers own separate child worktrees and relinquish ownership with their candidate reports.

## Fixed API contract

- Existing router prefix is `/api/database`; use `/api/database/history` (the brief's `/api/history` is shorthand, not a currently registered endpoint).
- All endpoints retain existing `get_current_user` protection. No new columns, migrations, or userId ownership. Do not edit sql_policy, RAG, or database_health_service.
- GET accepts optional `databaseId` (existing behavior), `q` (default empty), `limit` (default 50, inclusive range 1–200), `offset` (default 0, nonnegative), and `paginated` (default false).
- With `paginated=false`, return the exact existing array shape, with unchanged item fields including nullable timestamps and the nested `database.databaseName`. No new envelope/fields for legacy callers. Default limit remains 50.
- With `paginated=true`, return `{items: QueryHistoryResponse[], hasMore: boolean, nextOffset: number | null}`. Fetch one extra matching row to determine hasMore; nextOffset is offset + returned items count when more exists, otherwise null. No total-count query needed.
- Search is applied server-side before offset/limit, matches a literal case-insensitive substring of SQL or database name (OR), trims surrounding whitespace, and treats `%`, `_`, and backslash literally. SQLite case insensitivity follows its normal ASCII lower()/LIKE behavior; no Unicode collation dependency.
- Ordering: `created_on DESC, id DESC`, deterministic for timestamp ties. Offset pagination is best effort across concurrent inserts/deletes; refresh resets pages. No snapshot token.
- Invalid numeric paging values return FastAPI 422. Service/database failures propagate through existing HTTP error handling rather than falsely returning successful empty results.
- DELETE `/api/database/history?databaseId=<id>` physically deletes all QueryHistory rows for that ID, independent of search/paging. A required databaseId missing from the query returns 422; empty or whitespace-only ID returns 422 with a clear reason. Validate again in the service so an unscoped deletion is impossible. Return `{deletedCount: number}`; unknown/nonexistent IDs and empty histories return 200 with 0. Commit once; rollback on database failure. Do not change Db, SavedQuery, RAG or health rows.

## Fixed Web contract

- Preserve `databaseApi.getHistory(databaseId?)` for other callers. Add `getHistoryPage(databaseId, {q, limit, offset})`, requesting paginated=true through the existing api client, and `deleteHistory(databaseId)`.
- Old sidecars may ignore the new GET parameters and return an array. Normalize that as a single legacy page (`hasMore=false`, `nextOffset=null`, a `legacy` indication for the panel), locally filter that available array for q, and clearly indicate that only the latest 50 entries are searchable until the backend is updated. Do not fabricate paging support or repeatedly load the same array. DELETE failures from an old backend are displayed and do not clear history.
- Panel fetches first page per selected database/search; uses server search for new backends; supports explicit Load more, refresh resetting pages, loading/error states, and no stale results when switching database/search. Handle response races through query keys/captured mutation database ID. Guard delete actions when no database is selected.
- Confirmation dialog explicitly says deletion affects database health stats and AI context built from query history. Delete only after confirmation, scoped to the database captured by the dialog; disable/safely reset on selection changes and pending requests. After successful deletion reset/invalidate that database's history pages and show the result. Keep copy/open-editor behavior and existing UI primitives.

## Acceptance and status

- API Peer: pending dispatch; owns routes/execution_routes.py, services/execution, schemas/execution.py, tests/test_execution.py.
- Web Peer: pending dispatch; owns api-client.ts, SQLLabHistoryPanel.tsx and related Web tests.
- Lead: record candidate decisions, integrate commits, run API execution tests, related Web tests and TypeScript checks; exercise isolated browser dev if available. Never touch main worktree user edits.
- Sidecar rebuild deliberately skipped per user decision; packaged desktop app unverified. No push or merge to dev.
