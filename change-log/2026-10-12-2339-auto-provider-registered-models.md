# Random Auto Provider selection from registered models

## Summary and reason

Auto Provider previously used the most recently saved provider, fetched that provider's remote model inventory and sometimes fell back to a built-in model. The user requested random selection from the providers and models already created in AI Settings.

Auto Provider now shuffles active registered models whose provider has a key configured for the current user. Custom Provider additionally requires a saved base URL. Unsupported providers and incomplete configurations are excluded. Preflight tries at most three randomly ordered candidates and uses the first available model. Each request selects independently; consecutive requests may select the same model. Selection is uniform over eligible models, so a provider with more registered models appears more often.

The selected provider and model remain fixed for understanding, retrieval-related generation, SQL preview/repair, MongoDB agent execution and Explain/Optimize streaming. Task assignments do not replace this choice. Explicit manual model selection retains its readiness checks. With no eligible model, the stream returns an actionable error before retrieval or generation. Quick local replies still do not require an AI provider.

## Files changed

- `apps/api/services/ai/langchain_runtime.py`: registry selection with user-scoped provider eligibility and bounded preflight.
- `apps/api/services/ai_service.py`: resolve one model/provider before understanding and retain it throughout the stream.
- `apps/api/tests/test_auto_provider_models.py`: random pool, credentials/base URL, user isolation, incomplete configurations, retries and errors.
- `apps/api/tests/test_ai_stream_model_readiness.py`: stream consistency across providers and tasks, explicit selection and early failure.
- `apps/api/tests/test_langchain_runtime.py`: remove superseded remote-inventory/default auto selection assertions; retain inventory and adapter coverage.
- `apps/api/tests/test_schema_retriever.py`: give retrieval/repair tests explicit model context and complete preview fixtures.
- `CHANGELOG.md` and this detail file.
- Local gitignored documentation: `docs/modules/04-ai-assistant.md` and `docs/architecture/06-ai-and-rag.md`.

## Impact

- Desktop and API: changes use the existing encrypted provider configuration and model registry; the Linux sidecar must include the new Python source.
- UI: the existing Auto Provider option activates the new selection behavior without changing the API request format.
- Data: no schema changes, migration or edits to saved provider/model configurations.
- Assistant streaming no longer applies `chat.*`, `router.triage` or `agent.*` model assignments: Auto selects a model before triage and passes it explicitly through the request. Task routing for non-stream entry points, including `sql.autocomplete` and explicit agent/generation endpoints, retains its existing behavior.

## Verification

- Baseline focused API tests: 75 passed.
- Focused updated API/provider/action tests: 98 passed.
- `cd apps/api && venv/bin/python -m pytest -q --tb=short`: 617 passed, 3 skipped, including stream-level SQL repair, MongoDB agent and MongoDB Explain/Optimize selection coverage.
- `bun run desktop:sidecar:linux`: passed.
- `apps/api/venv/bin/python /tmp/quriodb-merge-sidecar-smoke.py`: dynamic loopback startup, authenticated readiness, rejection of missing/wrong nonce, both health endpoints, `SELECT 42`, temporary connection cleanup and owner-death shutdown passed; no live sidecar descendants remained.
- Independent Herdr review round 1 found no production logic issue; requested clearer task-routing documentation and stream-level SQL/MongoDB regression coverage. Those findings were addressed through documentation and tests; the production code used by the rebuilt sidecar remains unchanged.
- No live provider generation or full Tauri GUI session was tested; web/Rust implementation and request contracts did not change, so their suites were not repeated.
- Independent Herdr review round 2: PASS, including 88 focused tests run by the reviewer; the final source matched the reviewed snapshot.
- Implementation was initially left uncommitted; the user subsequently requested commit and push.
