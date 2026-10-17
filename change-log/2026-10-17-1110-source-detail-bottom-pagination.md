# Source detail bottom pagination

## Summary and rationale

Move the chunk range/count from the inspector header into the fixed bottom navigation bar. Previous and Next now show only chevrons, with accessible names and title tooltips preserved. The bar remains visible for single-page and empty results; both controls are disabled when navigation is unavailable. Applies to the shared inspector in the Map and Sources sheet.

## Files changed

- `apps/web/src/app/settings/components/ai-settings/VectorStoreSourceInspector.tsx`: count placement, icon controls and footer visibility.
- `apps/web/tests/components/settings/vector-store-workspace.test.tsx`: count inside the footer, icon-only controls, single/empty result disabled states.
- `CHANGELOG.md` and this detail file.
- Gitignored local docs: `docs/modules/05-rag.md`, `docs/modules/06-settings.md`.

## Impact

Desktop/UI only. No API, data, Python, Rust or dependency changes; no sidecar rebuild required.

## Verification

- `cd apps/web && bunx vitest run tests/components/settings/vector-store-workspace.test.tsx`: 9 passed.
- `cd apps/web && bunx tsc --noEmit`: passed.
- Targeted Prettier check and `git diff --check`: passed.
- Browser at 1024×768 with a 149-chunk source: range/count appears only inside the bottom bar, both buttons have empty text and accessible labels/tooltips, Next updates the count and the footer stays fixed while scrolling.
- Production build and packaged Tauri runtime were not rerun for this small presentation change.
