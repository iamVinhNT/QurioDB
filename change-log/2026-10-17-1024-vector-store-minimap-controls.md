# Vector Store minimap and canvas controls

## Summary and rationale

Fix the blank Vector Store minimap and simplify its header as requested in the screenshot follow-up. Controlled graph nodes did not carry dimensions in the supplied node objects, causing MiniMap to omit them. Initial dimensions now reuse the existing layout constants. The minimap panel also used CSS sizes that disagreed with its internal 200×150 SVG; the component style API now keeps both at 160×112. Theme-aware background, mask and viewport outline keep the overview readable.

Remove the three header actions. Add minimap toggle and refresh to the native bottom-left React Flow Controls; retain its existing fit action without duplication. Toggle state is exposed through aria-pressed and icons have accessible labels/tooltips.

## Files changed

- `apps/web/src/app/settings/components/ai-settings/VectorStoreMap.tsx`: synchronized minimap dimensions, theme colors and consolidated controls.
- `apps/web/src/app/settings/components/ai-settings/vector-store-map-graph.ts`: initial node dimensions from existing layout constants.
- `apps/web/tests/components/settings/vector-store-workspace.test.tsx`: minimap toggle and refresh regression.
- `apps/web/tests/components/settings/vector-store-map-graph.test.ts`: supplied graph node dimensions regression.
- `CHANGELOG.md` and this detail file.
- Local gitignored docs: `docs/modules/05-rag.md`, `docs/modules/06-settings.md`, `docs/plans/2026-10-17-vector-store-minimap-fix.md`.

## Impact

- Desktop/UI: changes the bundled web map only; no new dependency.
- API/data: no contract, persistence, indexing or deletion changes.
- Python/Rust: no changes; no sidecar rebuild required.

## Verification

- Baseline: `cd apps/web && bunx vitest run tests/components/settings/vector-store-workspace.test.tsx`: 8 passed.
- `cd apps/web && bunx vitest run tests/components/settings/vector-store-workspace.test.tsx tests/components/settings/vector-store-map-graph.test.ts`: 16 passed.
- `cd apps/web && bunx tsc --noEmit`: passed.
- Browser: eight graph nodes now appear in the minimap, compared with zero before the fix. SVG and panel bounds match. Verified zoom in/out, fit and viewport-mask updates after panning, light/dark themes, 1440×900 and 1024×768, source inspector and no horizontal overflow. Bottom-left actions are Zoom In, Zoom Out, Fit View, Toggle minimap and Refresh source map.
- Targeted Prettier check and `git diff --check`: passed.
- Production build and native packaged Tauri runtime were not rerun for this focused frontend follow-up.
