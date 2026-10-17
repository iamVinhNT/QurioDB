# Remove source detail expansion

## Summary and rationale

Remove expand/restore controls and their state from the Map source inspector and Sources detail sheet as requested. Keep each detail panel at its normal width. Compact metadata, chunk search, bottom pagination and Show in map remain available.

## Files changed

- `apps/web/src/app/settings/components/ai-settings/VectorStoreMap.tsx`
- `apps/web/src/app/settings/components/ai-settings/VectorStoreSourceList.tsx`
- `apps/web/tests/components/settings/vector-store-workspace.test.tsx`: remove obsolete expansion interactions while retaining pagination and graph-stability assertions.
- `CHANGELOG.md` and this detail file.
- Gitignored local docs: `docs/modules/05-rag.md`, `docs/modules/06-settings.md`.

## Impact

Desktop/UI only. No API, data, Python, Rust or dependency changes; no sidecar rebuild needed.

## Verification

- `cd apps/web && bunx vitest run tests/components/settings/vector-store-workspace.test.tsx`: 9 passed.
- `cd apps/web && bunx tsc --noEmit`: passed.
- Targeted Prettier check and `git diff --check`: passed.
- Browser DOM checked both detail hosts: no expand/restore controls; Map inspector stays 320px wide and pagination remains available.
- Production build and packaged Tauri runtime were not rerun for this removal.
