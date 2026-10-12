# Remove the review-added legacy gateway fallback

## Summary and reason

Revert the endpoint fallback introduced by `39357f5`. The original branch deliberately removed the 9router provider in favor of Custom Provider, which requires an explicitly configured base URL. The review incorrectly treated that intentional change as a regression.

Restore the original migration behavior: rename legacy configurations and models to Custom while retaining saved URLs. An unset URL remains unset. Neither the removed provider's environment override nor its built-in endpoint supplies a URL. Add a regression case with the old environment override present.

## Files changed

- `apps/api/services/startup.py`: restore the original migration.
- `apps/api/tests/test_langchain_runtime.py`: restore the original migration assertions and verify the removed environment override is ignored.
- `CHANGELOG.md`: replace the reverted fix entry with this removal entry.
- Replace `change-log/2026-10-12-2323-legacy-gateway-migration-url.md` with this correction.
- `docs/modules/06-settings.md`: clarify explicit URL configuration (local documentation is gitignored).

## Impact

- Desktop and API: Custom Provider requires explicit configuration; the sidecar must be rebuilt after reverting the Python source.
- UI: no changes.
- Data: the migration preserves stored URLs and leaves missing URLs unset. It does not retroactively change existing Custom configurations or user-saved URLs.

## Verification

- `cd apps/api && venv/bin/python -m pytest tests/test_langchain_runtime.py tests/test_ai_config_crypto.py -q --tb=short`: 52 passed.
- `git diff --check`: passed.
- `bun run version:check`: all managed targets match 0.1.5.
- `bun run desktop:sidecar:linux`: passed; the frozen Linux sidecar includes the reverted migration.
- `apps/api/venv/bin/python /tmp/quriodb-merge-sidecar-smoke.py`: dynamic loopback startup, nonce-authenticated readiness, missing/wrong nonce rejection, both health endpoints, `SELECT 42`, temporary connection cleanup and owner-death shutdown passed with no live sidecar descendants.
- Web/Rust tests and Windows/macOS packaging were not repeated for this Python migration revert; no frontend or Rust implementation changed.
