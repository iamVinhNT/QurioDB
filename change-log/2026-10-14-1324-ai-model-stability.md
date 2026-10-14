# AI model readiness cache and conversation stability

## Design recorded before implementation

The desktop sidecar uses one API process, so state lives in memory without database columns or migrations. Successful remote readiness probes are cached under `(user_id, normalized_provider, model_id)` for exactly 300 seconds measured by a monotonic clock from probe completion. Failures are never cached. Local model activation and provider configuration checks still run before cache reuse.

Each positive entry carries a non-reversible fingerprint of the effective credential and base URL; credentials are never logged or returned. On the next readiness check, credential rotation, provider configuration removal or base-URL changes invalidate stale positives before reuse. Expired entries are removed on cache access, inactive models invalidate their entry, and a real provider/model error immediately removes the contradicted positive. The cache holds at most 512 entries and evicts the oldest positive when full. Process exit clears all entries. Configuration invalidation is checked lazily on use rather than adding out-of-scope route hooks.

Auto selection is remembered by `(user_id, conversation_id)` in AIService. A conversation reuses its provider/model pair while locally eligible; a real provider/model error invalidates its probe entry and triggers bounded reselection excluding pairs already failed in that request. With no eligible fallback, an existing SSE `error` event terminates the response. Explicit model selection does not trigger Auto fallback. No conversation identifier preserves request-scoped selection. Existing execution permissions and SQL safety remain authoritative.

## Ownership and shared interfaces

- Peer A owns runtime probe cache initialization, readiness validation, probe invalidation helpers and `tests/test_model_probe_cache.py`. Shared helper: `invalidate_model_probe(user_id, provider, model_id)`.
- Peer B owns AIService conversation selection and real-error fallback, runtime `select_auto_model` exclusions and related tests. Shared selector accepts optional `excluded_models` containing `(model_id, normalized_provider)` pairs. Runtime initialization and cache methods remain Peer A's scope.
- Lead owns integration, changelog, verification and acceptance. Writers use separate child worktrees; Lead does not edit their moving scopes.

## Verification and acceptance

Base: clean child worktree at `e2feb296ec0ee0b8009a5a995cda73a57762d329`, equal to current `dev` HEAD. Parent staged CSV detail is excluded. Nested worker depth is 2. Codex writers use gpt-6.1-sol with medium effort for bounded implementation; Claude sonnet reviews an immutable integrated candidate independently.

Baseline verification passed: targeted acceptance suite 38 tests; `python -m pytest -m rag` exactly 166 passed, 454 deselected. Commands require `PATH=/home/vinhnt/DEV/QurioDB/apps/api/venv/bin:$PATH` because the default Python shim is unavailable. The shared environment uses Python 3.14.4. Missing `.agents/rules/clean-code.md`, `.agents/skills/` and ignored `docs/` were confirmed rather than fabricated.

P1: `task_73c01799bcb2` / `ctx_d3bf6b0e6160`, worktree `slp-p1-probe-cache`. P2: `task_28d7eea32ca0` / `ctx_20992590d039`, worktree `slp-p2-auto-stickiness`. Child Run: `run_d17a46a91aae`.

Lead approved request-local provider-call interception in AIService so Mongo generation errors are not swallowed by the inherited helper. Only provider calls retry; SQL previews and Mongo query executions are never replayed. General text preserves incremental SSE: errors before response output retry within the current call; errors after partial output select and remember a healthy fallback, emit a sanitized interruption error and terminate this response. The next message uses the fallback. Already-buffered SQL and Mongo model calls can retry within the same request. This behavior was reported to Supervisor before implementation.

## Changes and impact

Changed `apps/api/services/ai/langchain_runtime.py` and `apps/api/services/ai_service.py`; regression coverage is in `test_model_probe_cache.py`, `test_auto_provider_models.py` and `test_ai_stream_model_readiness.py`. `CHANGELOG.md` links this detail. API behavior now avoids repeated readiness network calls within the five-minute window and retains conversation Auto selection. No UI, SQL safety, RAG implementation or metadata schema changes were needed. Desktop source behavior uses process-local state; packaged desktop behavior is unverified because the sidecar was not rebuilt, as requested.

## Candidate dispositions and integration

Lead ACCEPTS P1 `c79c16a693e5ba2472fb037fe68143b670d84b0d` and P2 `fb3ff0da3565d80cc6987bcface7b04e120145de` for integration: their exact scoped changes and regression evidence satisfy their briefs, and both writers relinquished ownership. P1 integrated as `e29eec1`; P2 integrated as `84a45bf`. P2 used an extra manual candidate worktree despite assigned Orca placement; Lead integrated its exact immutable commit rather than absent changes in the assigned tree.

Lead added an integrated regression exercising actual Auto selection and the readiness cache across repeated conversation messages and exactly 300-second expiry. Its first assertion assumed a single SSE message chunk; the parser correctly split chunks, so the assertion now compares concatenated content. The initial integrated RAG run had this single test-only failure (212 passed); the corrected narrow check and RAG rerun are recorded below.

Worker settlements succeeded. Release receipts for both writers preserve runtime-recorded `user_owned`/`retained` terminals with reason `user_takeover` and `processAction: none`; Lead does not override user ownership. A monitoring gap occurred before direct user `retry`; durable settlements and candidates were recovered after runtime restart.

Final review and verification are recorded below. No live provider calls or packaged desktop startup, health, API URL or shutdown checks were performed. Conversation state lasts the API process lifetime, simultaneous cold probes may duplicate, and the simple global conversation preflight lock can contend under parallel traffic.

## Independent review and repair

Claude sonnet reviewer P3 (`task_ffc8d534dace` / `ctx_1bb109b2bc00`) reviewed immutable `327d1f1bd254e2d9ca9fc2a3d52662f8d82b1858`, independently passing 84 cache/provider/stream tests and 213 RAG tests. Lead REJECTED this integrated candidate after one actionable finding: sanitized preflight exceptions deliberately discard upstream causes and status, so status-only error text did not exclude a failed sticky pair. Lead now recognizes the exact sanitized preflight prefix and adds four regressions using the actual wrapping helper for 401, 404, 429 and 503 errors.

All review notes have dispositions. The outer provider message is now considered when its cause is unrelated, with a regression. Provider SDK errors, including model request rejection, continue to count as provider/model failures only at the provider-call boundary, consistent with automatic failover authorization. The global preflight lock and process-lifetime conversation memory are accepted desktop tradeoffs; revisit per-conversation locks or lifecycle cleanup if observed contention or memory growth requires it. Existing connection/credential redaction now also applies to stream errors, preserving Mongo redaction after the new interception path; a regression verifies URI/password/API-key removal in events and logs. No SQL safety or RAG code was changed. The reviewer reported an app-module import initialized `~/.quriodb`; no live provider use or data inspection was requested or performed by Lead.

Post-repair verification and final immutable review are recorded below. The first credential-redaction assertion expected a particular placeholder; repeated safe-provider sanitization may omit bracketed text, so the corrected assertion checks preserved error meaning and absence of secrets rather than placeholder formatting.

## Revised delivery authorization

The completion audit relayed the user's explicit final local `dev` delivery and cleanup request in message `msg_75af69926e79`. This replaces the original parent-edit/dev-commit restriction only for final local integration; no push remains authorized. Lead will deliver the accepted candidate into `/home/vinhnt/DEV/QurioDB` and verify there, preserving unrelated edits. The parent checkout is currently clean at `e2feb296`; the pre-existing CSV detail blob is `e503a11eeba9616b7f05fb02b483001ae63283fa` and remains outside the candidate diff. Audit owns cleanup of task-created workspaces after Lead settlement; Lead must not remove its active worktree.

## Final ACCEPT and delivery evidence

Lead ACCEPTS immutable code candidate `76ccac084f9270291c387bcae4a38a8a15ca79d7`. Fresh Claude sonnet P4 (`task_a96ec44e3062` / `ctx_bc32db95a1a1`) re-reviewed the repair against `327d1f1`, passed all six narrow regressions and reported no actionable findings. All P3 findings are resolved or explicitly accepted as documented desktop tradeoffs; no implementation work remains. Both reviews used a provider different from the Codex writers and Lead repair.

Commands ran from `apps/api` with `PATH=/home/vinhnt/DEV/QurioDB/apps/api/venv/bin:$PATH`:

- `python -m pytest tests/test_auto_provider_models.py tests/test_ai_stream_model_readiness.py tests/test_ai_chat_persistence.py`: **73 passed** after repair in Lead and again after local `dev` delivery.
- `python -m pytest -m rag`: **219 passed, 454 deselected** after repair in Lead and again after local `dev` delivery. The expected baseline **166** passed before changes; **53 new RAG-marked regressions** account for the increase.
- `python -m pytest tests/test_ai_stream_model_readiness.py -k 'sanitized_preflight or outer_message or connection_credentials'`: **6 passed**, independently confirmed by P4.
- Integrated conversation/readiness regression: passed; second message at 299.999 seconds made no extra remote probe, and exactly 300 seconds repeated the probe while retaining the selected pair.
- Additional Mongo/action/stream route/parser/history suite before the review repair: **103 passed**. P3 independently passed **84** provider/stream/cache tests and **213** pre-repair RAG tests.
- `git diff --check`: passed. Only seven scoped paths differ from original base; no web, RAG implementation, SQL-policy/safety or schema changes. No unresolved test failures; dependency/datetime deprecation warnings remain.

The clean parent `dev` checkout was fast-forwarded from `e2feb296` to accepted code `76ccac0` and reverified with both required commands. Its CSV detail blob remains exactly `e503a11eeba9616b7f05fb02b483001ae63283fa`. This final documentation-only evidence commit is delivered by a second fast-forward without changing tested API code. No push occurred.

All four Peer Tasks/Dispatches settled successfully and their deliveries were processed and acknowledged. All release receipts retain user-taken-over terminals with `processAction: none`; `worker-list --run run_d17a46a91aae --terminal-state reclaimable` returns zero. The completion audit is the explicit next owner for closing these user-owned terminals and removing task-created workspaces after Lead settlement, preserving candidate refs and this report in the parent checkout. Sidecar rebuild and packaged desktop behavior remain unverified as requested.
