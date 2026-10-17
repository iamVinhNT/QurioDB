# More space for source chunks

## Summary and rationale

The source inspector's metadata and explanation occupied most of its initial viewport. Replace those blocks with a compact title/status/database summary and an Info disclosure for source type, access, indexed time and total chunks. Remove the repeated chunk explanation. Keep search/count above the independently scrolling chunk content and retain the fixed pagination footer. Chunk cards use tighter spacing and a responsive grid when the panel is expanded. Page/search changes return chunk scroll to the top.

Add expand/restore buttons to both detail headers. The map inspector expands across the map content; the source sheet expands across the app viewport. Search, selected source and pagination remain mounted and preserved. Show in map moves into the sheet header as a labelled icon action.

## Files changed

- `apps/web/src/app/settings/components/ai-settings/VectorStoreSourceInspector.tsx`: compact summary, metadata disclosure, fixed search, independent chunk scrolling, responsive cards and scroll reset.
- `apps/web/src/app/settings/components/ai-settings/VectorStoreMap.tsx`: header expand/restore and panel layout.
- `apps/web/src/app/settings/components/ai-settings/VectorStoreSourceList.tsx`: sheet expand/restore and compact header actions.
- `apps/web/tests/components/settings/vector-store-workspace.test.tsx`: metadata disclosure, fixed search, scroll reset and expansion state retention in both hosts.
- `CHANGELOG.md` and this detail file.
- Gitignored local docs: `docs/modules/05-rag.md`, `docs/modules/06-settings.md`, `docs/plans/2026-10-17-source-detail-chunk-space.md`.

## Impact

- Desktop/UI: chunk content receives most of the detail panel space; expansion uses existing app panels and no browser fullscreen API.
- API/data: no changes to calls, persistence, source indexing or removal.
- Sidecar/Rust/dependencies: no changes; no sidecar rebuild required.

## Verification

- Baseline and final `cd apps/web && bunx vitest run tests/components/settings/vector-store-workspace.test.tsx`: 9 passed.
- `cd apps/web && bunx tsc --noEmit`: passed.
- Targeted `bunx prettier --check` for the three components and workspace test: passed.
- `git diff --check`: passed.
- Browser: real 149-chunk source at 1024×768 and 1440×900, light/dark. At 1024×768 the first chunk moves from y=560.21 to y=358.74; visible chunk space is approximately 2.8 times larger and its scroll viewport is 346px high. Pagination stays fixed. Page navigation resets scroll. Expand/restore preserves search/page in both hosts; source sheet expands to viewport width. At 1440×900 expanded content has four columns and all ten page items are visible. Metadata disclosure works; no horizontal overflow.
- Native packaged Tauri runtime and production build were not rerun for this focused frontend follow-up.
