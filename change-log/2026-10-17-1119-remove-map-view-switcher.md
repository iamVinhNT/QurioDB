# Remove Map view switcher

## Summary and rationale

Remove the Sources / How retrieval works switcher shown in the user's screenshot. The Map opens directly on the source graph, retaining search, source count, minimap controls and source inspection. Remove the unused retrieval-guide component and its pipeline-status query from this screen so that the removed view no longer adds a request or affects screen loading/error state.

## Files changed

- `apps/web/src/app/settings/components/ai-settings/VectorStoreMap.tsx`: remove view switcher/state/guide branch and unused props.
- `apps/web/src/app/settings/components/ai-settings/VectorStoreMapScreen.tsx`: remove guide-only pipeline status query/prop/invalidation.
- `apps/web/src/app/settings/components/ai-settings/VectorStoreRetrievalGuide.tsx`: remove unused component introduced during this session.
- `apps/web/tests/components/settings/vector-store-workspace.test.tsx`: keep source selection, graph stability, pagination and inspector-close coverage without guide navigation.
- `CHANGELOG.md` and this detail file.
- Gitignored docs: `docs/modules/05-rag.md`, `docs/modules/06-settings.md`, `docs/plans/2026-10-17-remove-map-view-switcher.md`.

## Impact

Desktop/UI only. One unnecessary API read is removed from this screen; API contracts, data, indexing, Python and Rust are unchanged. No sidecar rebuild required.

## Verification

- `cd apps/web && bunx vitest run tests/components/settings/vector-store-workspace.test.tsx`: 9 passed.
- `cd apps/web && bunx tsc --noEmit`: passed.
- Targeted Prettier check and `git diff --check`: passed.
- Browser DOM: switcher and expand/restore actions absent; source search available; eight graph nodes render; selecting a source opens details and fixed bottom pagination with a 149-chunk source.
- Production build and native packaged Tauri runtime were not rerun for this removal.
