# Custom AI provider configuration

## Summary and reason

Replace the gateway-specific 9router choice with a configurable OpenAI-compatible Custom Provider. Require a valid HTTP(S) base URL, use provider model inventory, and prefer the most recently saved provider configuration.

## Files changed

- API: `models/user_ai_config.py`, `routes/ai_config.py`, `services/ai/langchain_runtime.py`, `services/startup.py`.
- Web: AI settings, provider configuration and add-model dialog.
- API runtime/model readiness tests and web provider configuration regression tests.
- `CHANGELOG.md` and this detail.

## Impact

- Desktop and API: shared AI runtime supports Custom Provider; the packaged sidecar must include the updated Python source.
- UI: Custom Provider requires a base URL; OpenAI also supports a base URL override.
- Data: idempotent SQLite migration renames legacy 9router configuration and models to Custom. When a Custom configuration already exists, it takes precedence and the duplicate legacy configuration is deleted.

## Verification

- `cd apps/api && venv/bin/python -m pytest -q`: 599 passed, 3 skipped.
- `cd apps/web && bunx vitest run`: 688 passed.
- `cd apps/web && bunx tsc --noEmit`: passed.
- Linux sidecar was rebuilt and its startup, nonce readiness, query and shutdown smoke checks passed during the MongoDB work.
- A live Custom/deepseek request returned `401 Invalid API key`; successful live authentication with that configuration remains unverified.
