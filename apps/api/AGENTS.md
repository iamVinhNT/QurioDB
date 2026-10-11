# apps/api (FastAPI)

## Rules
- Layers: `routes/` (HTTP, Pydantic from `schemas/`) -> `services/` (logic) -> `models/` (tables). Routes stay thin.
- Protect routes with `Depends(get_current_user)`; use `get_admin_user` for connection create/update/delete/test.
- Target-database secrets are encrypted (`utils/crypto.py`) and masked in responses. Never log passwords, keys, or URIs.
- Relational SQL goes through `ExecutionService` and `SqlExecutionPolicy`. Do not add a path that runs user SQL without it.
- After editing or deleting a connection, call `BaseDatabaseService.invalidate_cache(db_id)`.
- PyInstaller discovers modules by import. If a new dependency or dynamic import is needed in the frozen sidecar, add an explicit import (see `app.py`) or update `specs/*.spec`.

## How to
- Add an endpoint: schema in `schemas/`, logic in a service, route in `routes/`, register new routers in `core/routers.py`, test in `tests/`.
- Change the metadata schema: edit the model, add an idempotent migration to `services/startup.py` (SQLite `ALTER`/rebuild helpers exist there), add a test.
- Change AI streaming: SSE event kinds are `thinking`, `message`, `sql`, `analysis`, `citations`, `retrieval_trace`, `warnings`, `suggestions`, `error` (`services/ai/streaming.py`). Update `stream_parser.py` and the web `useAIChat.ts` together.
- New AI task key: add to `TASK_CATALOG` in `services/ai/task_model_router.py`.
- RAG tuning uses `QURIODB_RAG_*` env vars (`services/ai/retrieval/*`, `rag_context.py`).

## Check
- `python -m pytest path/to/test.py::test_name`; AI/RAG changes: `python -m pytest -m rag`.
- Desktop-relevant change: rebuild the sidecar and confirm `/api/desktop/health` and shutdown still work (see root invariants).
