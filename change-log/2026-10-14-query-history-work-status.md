# Query History implementation contract and work status

Base: `dev` at `38e75d1437fbc1b598812c4f162fe879c2183a0a`.
Final integration: `/home/vinhnt/DEV/QurioDB-history-final`, branch `iamVinhNT/query-history-final` (recovered from `57d76f1`, retaining original base `38e75d1`).
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

- API Peer: completed, ownership relinquished; owned routes/execution_routes.py, services/execution, schemas/execution.py, tests/test_execution.py.
- Web Peer: completed, ownership relinquished; owned api-client.ts, SQLLabHistoryPanel.tsx and related Web tests.
- Lead: record candidate decisions, integrate commits, run API execution tests, related Web tests and TypeScript checks; exercise isolated browser dev if available. Never touch main worktree user edits.
- Sidecar rebuild deliberately skipped per user decision; packaged desktop app unverified. No push or merge to dev.

## Peer evidence and Lead decisions

- API SLP P1: Task `task_820da803bf4b`, Dispatch `ctx_8e1ad697f0a1`, worktree `/home/vinhnt/orca/workspaces/QurioDB/slp-p1-history-api`; candidate `6f2f61dc2136c8f9f4631f43008b1e21ad29eb63`, parent `59ad1fc`, original base `38e75d1`. Baseline 6 tests, final 37 execution tests and 46 nearby SQL/saved-query/NoSQL regressions passed with isolated metadata. Exact owned scope only; clean worktree and ownership relinquished. Lead ACCEPT: reviewed route, schemas, service and real SQLite HTTP regression coverage; fixed contract, safety and compatibility preserved. Integrated as `df93ee7`.
- Web SLP P2: Task `task_ca199df4ece2`, Dispatch `ctx_dc5b7077c887`, worktree `/home/vinhnt/orca/workspaces/QurioDB/slp-p2-history-web`; candidate `7148d1ff17b9f13fa0ec11fcb9c6f3041229fc1f`, parent `59ad1fc`, original base `38e75d1`. Baseline 13 client tests, final 47 tests across five related files and TypeScript passed; early fixture/type errors repaired. Exact owned scope only; clean worktree and ownership relinquished. Lead ACCEPT: reviewed API array normalization, selection/remount and query keys, scoped cancellation/reset, dialog and global pending-delete guard; thirteen panel cases cover failures and request races. Integrated as `c2c81a7`.
- Lead directed Web Peer to use the existing `history` query-cache prefix: execution already invalidates `["history", selectedDS]`. This fixes stale-panel refresh within the owned panel, with a focused regression test.
- Both workers settled successfully. API `worker-release` returned retained/user_takeover/processAction none; preserve the user-owned terminal. Web `worker-release` closed only its proven settled agent terminal and captured its transcript. Fleet has zero reclaimable workers; both Peer branches/worktrees remain intact.

## Recovery and verification

- Original integration worktree and branch disappeared around local 00:50:13 during verification. Lead issued no worktree removal; Supervisor confirmed no worktree commands and no evidence of a user deletion. Cause remains unproven. Child resource receipts identify only their Peer worktrees; Web release closed its exact terminal, and API release performed no process action. Original integrated Git object remained and was backed up to `/tmp/quriodb-history-verification/integrated-candidate.patch`.
- Supervisor explicitly authorized reconstruction on a new isolated branch. Recovered `c2c81a730c2fa1acc7e075e8fce583bdc13f3247` into this worktree and restored Lead changelogs. No push, merge to dev, or edits to main user files; preserve all worktrees until final report.
- Original merged candidate: 37 API tests and TypeScript passed; Web first run 45/47 because local dev VITE_API_URL=5127 contaminated two default-URL expectations, then 47/47 passed with VITE_API_URL cleared. Recovery reruns and browser acceptance are recorded in the detail changelog before final delivery.
- Isolated dev: `bun run dev`, UI 3001/API 5127 on loopback, metadata `/tmp/quriodb-history-verification/metadata.db` and two temporary SQLite targets. Executed 55 safe SELECTs for selected database and 1 control query for another. Baseline browser search could not find olderneedle outside the latest 50. New Web with still-running baseline backend displayed the latest-50 limit; confirmed unsupported DELETE returned Method Not Allowed visibly and retained history.

## Final acceptance

- A second external removal affected slp-history-recovery and its branch around local 00:54:20, without any further release/worktree operations from Lead. Git object 57d76f1 preserved code and restored logs; backed up to `/tmp/quriodb-history-verification/recovered-candidate-with-logs.patch`. Cause of both removals remains unproven; Supervisor reports both former paths contain only Vite-recreated `.vite` data and confirmed no removal by Supervisor.
- Supervisor explicitly authorized plain `git worktree add` outside Orca storage. Created this home-directory worktree from 57d76f1 on a new local branch. Both Peer branches/worktrees and main dev/user changes remain intact. No further removals or worktree releases.
- Final API acceptance: from apps/api, `/home/vinhnt/DEV/QurioDB/apps/api/venv/bin/python -m pytest tests/test_execution.py` — 37 passed in 2.78s (342 dependency/model deprecation warnings).
- Final Web acceptance: from apps/web, `VITE_API_URL= bunx vitest run tests/lib/api-client-history.test.ts tests/components/sqllab/sql-lab-history-panel.test.tsx tests/services/api-client.test.ts tests/lib/api-client-confirmation.test.ts tests/lib/runtime-api.test.ts` — 47 passed across five files in 11.72s. Clear VITE_API_URL only for tests so the isolated dev URL does not change default-URL expectations.
- `bunx tsc --noEmit` — exit 0; `git diff --check` — clean. Candidate code is unchanged from the passing merged Peer implementations; final commits update logs only.
- Browser on `bun run dev` (UI port 3001/API port 5127, temporary SQLite data): search found original olderneedle beyond latest 50; Open in Editor plus three Run clicks saved query executions and refreshed history automatically. Load more expanded 50 to 57 rows (7980px virtual list) and removed the exhausted-page button; refresh restored first-page Load more. Search reset returned all four matching olderneedle rows after executions.
- Confirmation displayed selected database name/ID, deletion beyond current search, health stats and AI-context effects. Cancel preserved all 58 rows. Confirmed delete returned 58 and panel became No Query History with and without search; GET and raw SQLite counts verified selected DB 0, other DB 1. Confirmation screenshot was visually inspected at `/home/vinhnt/DEV/QurioDB/.playwright-mcp/query-history-delete-confirmation.png`; numeric evidence `/tmp/quriodb-history-verification/browser-verification.json`.
- Lead ACCEPTS the integrated code after merged test and browser evidence. No outstanding code failures. Packaged desktop, frozen sidecar build and desktop startup/nonce health/dynamic URL/shutdown remain deliberately unverified; no rebuild per user decision. Offset-concurrency and ASCII-search limits are retained.

Dev verification processes were stopped after acceptance. Temporary local env files and the untracked API venv symlink were removed; ignored node_modules links remain for review. Main user edits and dev HEAD remain unchanged.
