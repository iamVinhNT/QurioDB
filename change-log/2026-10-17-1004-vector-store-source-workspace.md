# Vector Store source workspace and map dialog

## Summary and rationale

Settings > AI Assistant > Vector Store now prioritizes source management. The previous overview and database list occupied 860px at 1440×900, placing all sources below the viewport. The map reserved a 380px inspector even with no selection; selecting a source could rebuild the graph and move every node out of view.

The approved redesign keeps Sources on the main screen and opens the map in a large dialog. The overview now occupies 158px at the same viewport. Database sync and storage details are expandable. Sources support search, database/type/status filters, title/index-time sorting, inspection in a side sheet, and confirmed removal. Closing the map preserves source filters, scroll position and the selected row.

The map loads on demand, uses the available dialog height, shows an inspector only for a selected source, and makes its minimap optional. Selecting a source no longer expands chunks into the graph or changes node positions. Shared inspection provides search and pagination through every returned chunk, with loading/error/retry states. Graph construction no longer silently truncates sources after eight items or chunks after twenty items. A separate retrieval guide explains sources, chunks, indexing and context; configured capabilities are explicitly distinguished from live job progress.

## Files changed

- `apps/web/src/app/settings/components/ai-settings/VectorStoreMapScreen.tsx`: persistent source view and lazy map dialog, with focus restoration.
- `VectorStoreStatusPanel.tsx`: compact metrics, expandable sync/storage details, preserved indexing controls and feedback.
- `VectorStoreSourceList.tsx`, `VectorStoreSourceTable.tsx`: source filters, sorting, selection, detail sheet and confirmed removal.
- `VectorStoreSourceInspector.tsx`: complete searchable chunk pagination and detail error handling.
- `VectorStoreMap.tsx`, `VectorStoreMapNodes.tsx`, `vector-store-map-graph.ts`: stable selection, responsive canvas, compact nodes, readable viewport and complete graph construction.
- `VectorStoreRetrievalGuide.tsx`, `vector-store-overview.ts`: retrieval explanation and shared source type labels.
- `apps/web/tests/components/settings/vector-store-workspace.test.tsx`, `vector-store-map-graph.test.ts`: regression coverage.
- `CHANGELOG.md`; local `docs/modules/05-rag.md`, `docs/modules/06-settings.md` and `docs/plans/2026-10-17-vector-store-redesign.md` (docs are gitignored).

## Impact

- **Desktop/UI:** Changes the bundled React interface and improves use of desktop window space. The dialog supports Escape, trapped focus through the existing Base UI primitive, and returns focus to Open map. No browser-only fullscreen API is used.
- **API:** Existing `aiApi` and `databaseApi` calls are unchanged; dynamic desktop API resolution remains intact.
- **Data:** No schema or migration changes. Indexing and confirmed source removal retain their existing server behavior. Browser verification did not index or delete user data.
- **Sidecar:** No Python or Rust changes; no sidecar rebuild is required for these edits.

## Verification

- Baseline: existing graph and Settings layout suites passed (12 tests); `cd apps/web && bunx tsc --noEmit` passed.
- `cd apps/web && bunx vitest run tests/components/settings`: 31 tests passed across 8 files, including graph stability, source filter persistence, chunk 35 access, retry/error states, confirmed deletion, disabled indexing and focus restoration.
- `cd apps/web && bunx tsc --noEmit`: passed.
- Browser: checked 1440×900, 1366×768 and 1024×768 without horizontal overflow, in light and dark themes. Verified real source selection with 35 chunks, visible selected node, unchanged graph positions and node count, source-sheet-to-map navigation, filter/scroll preservation, keyboard focus containment, Escape and focus restoration. Verified optional minimap, retrieval guide, and no clipped node content after tightening node padding. The final view shows all six existing sources within the first 1440×900 viewport.
- `cd apps/web && NODE_OPTIONS=--max-old-space-size=8192 bun run build`: passed.
- `cd apps/web && VITE_DISABLE_AUTH=true NODE_OPTIONS=--max-old-space-size=8192 bun run build`: passed on the final UI (22.97 seconds), matching the desktop web build flag. Vite reports large chunks and mixed static/dynamic imports for the existing SQL formatter usage; these are warnings, not build failures.
- Targeted `bunx prettier --check` for changed UI/test files and `git diff --check`: passed.
- Packaged Tauri runtime was not launched; native startup/sidecar health/shutdown were not exercised because this change only alters web UI.
