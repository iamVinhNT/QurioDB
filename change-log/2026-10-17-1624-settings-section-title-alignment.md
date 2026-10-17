# AI settings section title alignment

Vector Store and Knowledge Base now present their section titles in the main card header, with the same icon, typography, and description hierarchy used by Gateway, Models, and the other AI Assistant settings screens. Vector Store actions remain beside the title while status and database details stay in the content area. Storage details open as an overlay so expanding them does not resize or break the parent status layout.

## Files changed

- `apps/web/src/app/settings/components/ai-settings/VectorStoreMapScreen.tsx`
- `apps/web/src/app/settings/components/ai-settings/VectorStoreStatusPanel.tsx`
- `apps/web/src/app/knowledge/Library.tsx`
- `apps/web/src/app/knowledge/Workspace.tsx`
- `apps/web/tests/components/settings/vector-store-workspace.test.tsx`
- `apps/web/tests/components/knowledge/knowledge-workspace.test.tsx`

## Impact

- Desktop/UI: visual consistency only; existing Vector Store and Knowledge Base actions and data flows are unchanged.
- API/data: no changes.

## Verification

- `cd apps/web && bunx vitest run tests/components/settings/vector-store-workspace.test.tsx tests/components/knowledge/knowledge-workspace.test.tsx`
- `cd apps/web && bunx tsc --noEmit`
