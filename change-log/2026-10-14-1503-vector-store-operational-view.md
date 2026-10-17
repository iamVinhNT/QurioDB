# Vector Store operational view

## Summary and why

Settings > AI Assistant > Vector Store used to open on a large graph map with a backend label, a source count, and a refresh button. It did not show whether retrieval was enabled, how fresh the index was, which connections had never been indexed, or offer any maintenance action. Users had to switch to RAG Index to do anything.

The screen now opens on an operational view built only from existing API data:

- Status header: retrieval enabled/disabled and backend (`sqlite_vec / local`) from `GET /api/rag/status`. When `QURIODB_RAG_ENABLED` is off, a warning explains that sync returns without indexing and the sync buttons are disabled. An "Add sources" button opens the RAG Index section, and a refresh button reloads all vector store queries.
- Stat tiles: total sources (indexed and not-indexed split), databases covered (connections with at least one source out of all connections, plus global sources), last indexed, and oldest source, all derived from `GET /api/rag/sources` and `GET /api/database/list`.
- Database sync: one row per connection with source count, the indexed schema names (parsed from the `database_schema:<db>:<schema>` source id), last indexed time, and a Re-sync / Index now button. The button calls the existing `POST /api/rag/pipeline/sync/database/{id}` once per known schema (`public` when none is indexed yet), indexes saved queries once, and leaves query history off, as in RAG Index. The session keeps each database's last sync result (chunks and embeddings from the sync response) and flags a sync that produced chunks but no embeddings. Sources whose connection no longer exists are listed as "Connection removed" without a sync action.
- Indexed content: a Sources/Map toggle. Sources is a searchable, type-filterable list with inline inspection (reusing `SourceInspector` and `GET /api/rag/sources/{id}`) and removal behind a confirmation dialog (`DELETE /api/rag/sources/{id}`). Map is the existing graph view, unchanged.
- The section rail shows the source count and the description "Index status and sources".

Source timestamps are stored as naive UTC. The inspector parsed them as local time, so they could be off by the UTC offset. The new `parseServerTimestamp` helper reads them as UTC, and the inspector now prefers the API's `chunkCount`.

The API does not report runtime sqlite-vec extension load status, embedding provider availability, total chunk or embedding counts, or background sync jobs. The screen does not show or imply those values. The only embedding figures shown come from a sync response in the current session.

## Files changed

- `apps/web/src/app/settings/components/ai-settings/VectorStoreMapScreen.tsx`: composes the status panel, sync and delete mutations, and the Sources/Map toggle.
- `apps/web/src/app/settings/components/ai-settings/VectorStoreStatusPanel.tsx` (new): status header, stat tiles, database sync rows.
- `apps/web/src/app/settings/components/ai-settings/VectorStoreSourceList.tsx` (new): searchable source list, inline inspection, delete confirmation.
- `apps/web/src/app/settings/components/ai-settings/vector-store-overview.ts` (new): derives totals, coverage, freshness, and schema names; parses UTC timestamps.
- `apps/web/src/app/settings/components/ai-settings/VectorStoreMapNodes.tsx`: inspector reads timestamps as UTC and uses `chunkCount`.
- `apps/web/src/app/settings/components/ai-settings/AISettingsSectionRail.tsx`: Vector Store description.
- `apps/web/src/app/settings/components/AISettings.tsx`: rail source count and the "Add sources" navigation to RAG Index.
- `CHANGELOG.md`: Unreleased entry.

## Impact

- UI: Vector Store screen layout and actions as described. The RAG Index section is unchanged.
- API: none. The screen uses existing endpoints only.
- Data: none to the schema. Re-sync and remove change RAG index rows through the existing endpoints, only after an explicit user click (remove also needs confirmation).
- Desktop: frontend-only change. It uses `aiApi`/`databaseApi`, so the dynamic sidecar API URL still applies. No sidecar rebuild is needed. The packaged desktop app was not built or launched.

## Verification

- `cd apps/web && bunx tsc --noEmit`: passed (exit 0).
- Browser dev check (`DISABLE_AUTH=true` API on 127.0.0.1:5000 and `VITE_DISABLE_AUTH=true` Vite on :3001, using the local metadata DB) at 1440×1000 and 1024×800: the status header, tiles, database sync rows (including a removed connection), source list, inline inspection (35 chunks shown), delete dialog (opened and cancelled), and Map toggle all rendered without page-level horizontal overflow. Servers were stopped afterwards.
- Not run: re-sync and remove were not triggered at runtime, to leave the local index unchanged. No tests were added or run, as the task requested. Dark mode and the packaged desktop app were not checked.
