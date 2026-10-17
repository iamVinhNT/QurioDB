# Vector Store storage details overlay

Opening Storage details in the Vector Store status row no longer participates in the flex layout. The information now appears in an anchored, viewport-constrained overlay, so expanding it does not resize or break the parent card.

## Files changed

- `apps/web/src/app/settings/components/ai-settings/VectorStoreStatusPanel.tsx`
- `apps/web/tests/components/settings/vector-store-workspace.test.tsx`

## Impact

- Desktop/UI: Storage details remain available without shifting the status row, database sync controls, or source list.
- API/data: no changes.

## Verification

- `cd apps/web && bunx vitest run tests/components/settings/vector-store-workspace.test.tsx`
- `cd apps/web && bunx tsc --noEmit`
- `bunx prettier --check apps/web/src/app/settings/components/ai-settings/VectorStoreStatusPanel.tsx apps/web/tests/components/settings/vector-store-workspace.test.tsx`
