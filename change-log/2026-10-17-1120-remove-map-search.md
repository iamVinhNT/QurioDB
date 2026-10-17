# Remove Map search toolbar

## Summary and rationale

Remove the source-search field, count toolbar and search-only filtering state from the Vector Store Map as requested. The graph uses the full dialog content area and always receives all sources. Source-table filters and detail chunk search remain available.

## Files changed

- `apps/web/src/app/settings/components/ai-settings/VectorStoreMap.tsx`
- `CHANGELOG.md` and this detail file.
- Gitignored local docs: `docs/modules/05-rag.md`, `docs/modules/06-settings.md`.

## Impact

Desktop/UI only. No API, data, sidecar, Rust or dependency changes.

## Verification

- `cd apps/web && bunx vitest run tests/components/settings/vector-store-workspace.test.tsx`: 9 passed.
- `cd apps/web && bunx tsc --noEmit`: passed.
- Targeted Prettier check and `git diff --check`: passed.
- Browser DOM: map search absent, eight graph nodes render, selecting a source retains detail chunk search.
- Production build and native packaged Tauri runtime were not rerun for this small removal.

## Final task verification before commit

`cd apps/web && bunx vitest run tests/components/settings`: 32 tests passed across 8 files on the final workspace. `cd apps/web && bunx tsc --noEmit`: passed. The commit includes only Vector Store UI/tests and its changelog entries; unrelated API and Knowledge Base work remains unstaged. Module docs and plans remain local under the existing `docs/` gitignore rule.
