# MongoDB AI chat and automatic query results

## Summary and reason

MongoDB had a validated agent, but chat used the SQL streaming path. SQL previews discarded returned rows and the UI required another execution through a manual button. Chat now dispatches MongoDB database requests to the structured read-only agent, streams query text and results, and renders results immediately using shared UI. The MongoDB prompt now defines its 1–5 confidence scale and uses a confident example; the previous example used 1 and caused valid queries to be treated as clarifications.

## Files changed

- API: `services/ai_service.py`, `services/prompts.py`, `services/ai/agent.py`, `services/ai/sql_execution.py`, `services/ai/streaming.py`, `services/ai/conversation_store.py`.
- Web: `AIAssistant.tsx`, `ai/AIChatMessages.tsx`, `ai/AIMessage.tsx`, `ai/SQLBlock.tsx`, `ai/DataTablePreview.tsx`, `ai/types.ts`, `hooks/useAIChat.ts`, `lib/api-client.ts`.
- Regression tests: AI query result streaming, model readiness preview fixture, AI message presentation, chat hook, virtualization fixture.
- Documentation: `docs/modules/04-ai-assistant.md`, `docs/architecture/06-ai-and-rag.md`, `CHANGELOG.md`, this detail.

## Impact

- Desktop: shared SSE contract and UI; rebuild the Python sidecar for packaged apps. Dynamic API URLs, startup nonce, auth and process lifecycle remain intact.
- API: adds semantic `query` and `query_result` SSE events; persists query text, columns and data. Streaming agent execution does not duplicate chat history. Read-only policies remain enforced server-side. MongoDB Explain/Optimize actions use text analysis without query execution; array suggestions are supported.
- UI: removes the manual data action and redundant client execution; displays all bounded rows/columns, nested JSON and empty results. Existing history without stored results is not automatically re-executed.
- Data: bounded rows are persisted once in plaintext in local SQLite conversation history. Relational results retain the selected columns without redaction; MongoDB preserves existing sensitive-field filtering. No metadata schema migration. Local Docker test container `quriodb-agent-mongo` uses `mongo:8.0.20`, binds 127.0.0.1:27018, and holds three sample orders in `quriodb_agent_demo`; a saved read-only demo connection was added.

## Verification

- Before committing the complete working tree on 2026-10-11: all API tests passed (599 passed, 3 skipped), all web tests passed (688), web TypeScript and version consistency checks passed.

- Baseline: 77 API tests and 34 web tests passed.
- `cd apps/api && venv/bin/python -m pytest -m rag -q`: 148 passed after regression fixes.
- `QURIODB_TEST_MONGODB_URI=mongodb://127.0.0.1:27018 venv/bin/python -m pytest tests/test_mongodb_integration.py tests/test_ai_chat_persistence.py tests/test_ai_mongodb_api_contract.py tests/test_ai_action_streaming.py tests/test_ai_sql_execution_policy.py -q`: 20 passed.
- Reviewer round two: `venv/bin/python -m pytest -q -p no:cacheprovider -x` reported 599 passed; `bunx vitest run` reported 688 passed. Final verdict is unavailable because of the reviewer usage limit.
- Web focused Vitest (message, chat hook, virtualization): 44 passed; `bunx tsc --noEmit`: passed. Independent reviewer also ran SQL Lab/settings tests: 287 passed before round-two fixes.
- `cargo test --target x86_64-unknown-linux-gnu -q`: 24 passed. Plain `cargo test` selected the configured Windows target and failed because the Linux host lacks MinGW `dlltool`.
- Live Google/gemini-2.5-flash: Mongo find returned An=120, Chi=200; aggregation returned totalAmount=320; unmatched filter returned empty data. POST /api/ai/stream persisted exactly one user/assistant pair; GET history restored query and rows. SQLite preview returned 2 model names.
- Real headless Chrome rendered the chat result table and restored history; screenshot is kept in the Herdr run directory.
- Linux sidecar rebuilt. Direct packaged-binary smoke passed dynamic loopback startup, nonce health (missing nonce rejected), Mongo query, restored history, and parent-death shutdown. The Tauri GUI shell itself was not launched.
- Independent Claude review round one found Mongo analysis actions dispatching to execution and duplicated stored rows. Fixed both, added route/BSON regression coverage, and documented local plaintext history. Round two ran all API tests (599 passed), RAG (148 passed), web (688 passed), and typecheck; the Claude session then reached its usage limit before writing a final verdict. No independent PASS is claimed. Main completed self-review and final sidecar smoke.
- Live Custom/deepseek returned `401 Invalid API key`. Google later hit free-tier `429 RESOURCE_EXHAUSTED` (20 requests/day) during extra tests. A fresh browser-send test could not complete after that provider limit; successful live Mongo results and real-browser history rendering were captured separately.
