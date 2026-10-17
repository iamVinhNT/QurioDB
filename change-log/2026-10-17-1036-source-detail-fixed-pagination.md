# Fixed pagination in source details

## Summary and rationale

Keep Previous/Next available without scrolling to the end of the chunk list. SourceInspector now separates its scrolling content from a non-shrinking pagination footer. Both the source sheet and map inspector constrain its height through the existing flex-column layout. Show in map also remains outside the source sheet's scrolling content.

## Files changed

- `apps/web/src/app/settings/components/ai-settings/VectorStoreSourceInspector.tsx`: shared scroll body and pagination footer.
- `apps/web/src/app/settings/components/ai-settings/VectorStoreSourceList.tsx`: constrained sheet body and Show in map placement.
- `apps/web/src/app/settings/components/ai-settings/VectorStoreMap.tsx`: constrained inspector body.
- `apps/web/tests/components/settings/vector-store-workspace.test.tsx`: pagination outside scrolling content, previous/next, search reset and footer hiding for a single page.
- `CHANGELOG.md` and this detail file.
- Gitignored local docs: `docs/modules/05-rag.md`, `docs/modules/06-settings.md`, `docs/plans/2026-10-17-source-detail-fixed-actions.md`.

## Impact

- Desktop/UI: pagination stays visible in both source detail hosts; content scrolls without covering the footer.
- API/data: no changes.
- Sidecar/Rust: no changes or rebuild required.

## Verification

- `cd apps/web && bunx vitest run tests/components/settings/vector-store-workspace.test.tsx`: 9 passed.
- `cd apps/web && bunx tsc --noEmit`: passed.
- Browser at 1024×768: a real source with 35 chunks; footer stays vertically fixed at both scroll extremes in the source sheet and map inspector. Next and Previous work. No horizontal overflow. Map button y remained 692.96px before and after scrolling.
- Targeted Prettier check and `git diff --check`: passed.
- Production build and native packaged Tauri runtime were not rerun for this focused CSS/layout change.
