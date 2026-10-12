# Preserve legacy gateway endpoints before merging into dev

## Summary and reason

Review of the seven commits on `perf/sqllab-schema-diagram` found that the new migration renamed `9router` to `Custom` without resolving an unset base URL. The old provider supported a built-in endpoint and an environment override, while Custom requires an explicit URL. Existing configurations would therefore stop working after upgrading.

The migration now stores the saved URL, or the legacy `_9ROUTER_BASE_URL` override, or the old `http://127.0.0.1:20128/v1` default. Existing Custom configurations retain precedence. Regression tests verify null, empty and whitespace URLs, environment overrides, saved-URL precedence and repeated migration.

## Files changed

- `apps/api/services/startup.py`: preserve the effective endpoint during migration.
- `apps/api/tests/test_langchain_runtime.py`: replace the assertion accepting a missing endpoint with five functional regression cases.
- `CHANGELOG.md` and this detail file.
- `docs/modules/06-settings.md`: document endpoint preservation (local documentation is gitignored).

## Impact

- Desktop: upgraded installations retain working legacy gateway configurations; the Linux sidecar was rebuilt with the reviewed source and fix.
- API: startup persists the endpoint required by Custom Provider.
- UI: existing provider configuration can load an explicit URL after migration.
- Data: only migrating legacy rows receive a resolved URL; encrypted keys and existing Custom configurations retain their previous handling.

## Verification

- Baseline: the four changed API test files passed 79 tests before the fix.
- New regression before the fix: four failures and one pass, reproducing lost default and environment endpoints.
- `cd apps/api && venv/bin/python -m pytest tests/test_langchain_runtime.py -q -k legacy_gateway --tb=short`: 7 passed after the fix.
- `cd apps/api && venv/bin/python -m pytest -q`: 604 passed, 3 skipped; includes AI/RAG regressions.
- `cd apps/web && bunx vitest run`: 688 passed across 127 files.
- `cd apps/web && bunx tsc --noEmit`: passed.
- `bun test scripts/sync-version.test.ts`: 18 passed.
- `bun run version:check`: all managed targets match 0.1.5.
- `cd apps/desktop/src-tauri && cargo test --target x86_64-unknown-linux-gnu`: 24 passed.
- `bun run desktop:sidecar:linux`: passed, rebuilt the frozen Linux API binary.
- `apps/api/venv/bin/python /tmp/quriodb-merge-sidecar-smoke.py`: startup on a dynamic loopback port, authenticated readiness, rejection of missing/wrong nonces, both health endpoints, an HTTP `SELECT 42` round trip, temporary connection cleanup and owner-death shutdown passed. No live sidecar descendants remained. The verification script is temporary and not part of the repository.
- `cd apps/web && bunx cross-env NODE_OPTIONS=--max-old-space-size=8192 VITE_DISABLE_AUTH=true bun run build`: passed with the existing large-chunk warning.
- `git diff --check`: passed.
- The default `cargo test` selected the repository's Windows target and failed because `x86_64-w64-mingw32-dlltool` is unavailable; the explicit Linux target passed.
- Windows/macOS packaging and a full Tauri GUI session were not run on this Linux host.
