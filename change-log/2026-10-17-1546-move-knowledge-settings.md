# Move Knowledge Base into Settings > AI Assistant

## Summary and why

Knowledge Base authoring now lives in the AI Assistant settings shell, beside RAG and Vector Store controls. Its forms use the shared ShadCN controls so labels, focus states, selects and checkboxes match the rest of the application. Existing deep links remain usable.

## Changes

- Added a lazy-loaded Knowledge Base section to the AI Assistant settings rail.
- Added canonical Settings routes for the library, base workspace and document editor.
- Removed the standalone Knowledge Base header navigation item.
- Updated authoring, relation, context preview and SQL citation links to the canonical routes.
- Replaced Knowledge Base form controls and action buttons with shared ShadCN components; retained the native file input for Markdown import.
- Standardized Vector Store and Knowledge Base with the AI settings card shell and content right border. Knowledge bases and documents now use the ShadCN Table, and creating a knowledge base opens a ShadCN Dialog.
- Added consistent vertical spacing between Knowledge Base sections and moved pagination controls to the right with accessible icon-only previous/next buttons.
- Fixed the ShadCN select adapter so selected connections display their human-readable label instead of the internal UUID.
- Redirected legacy `/knowledge/...` URLs while preserving query parameters and section anchors.
- Updated module and architecture documentation.

## Files changed

Frontend: `apps/web/src/App.tsx`, `components/header.tsx`, `app/settings/components/{SettingsContent,AISettings}.tsx`, `app/settings/components/ai-settings/AISettingsSectionRail.tsx`, `app/knowledge/{routes,controls,Library,Workspace,ContextPreview,Relations,DocumentEditor,DefinitionEditor,DefinitionForms}.tsx`, `app/sqllab/components/ai/ContextSources.tsx`, `vitest.setup.tsx`, and the Knowledge Base regression tests.

Docs: `docs/modules/{05-rag,06-settings,10-knowledge-base}.md`, `docs/architecture/06-ai-and-rag.md`.

## Impact

- Desktop/UI: Knowledge Base is opened through Settings > AI Assistant; the API and local metadata model are unchanged.
- API/data: no changes.
- Compatibility: old Knowledge Base and citation URLs redirect to the new Settings route, retaining revision and section context.

## Verification

- `cd apps/web && bunx tsc --noEmit`: passed.
- Focused Settings and Knowledge Base Vitest suites: 25 tests passed, including the selected-label regression.
- Desktop package rebuild/native smoke was run after the frontend changes.
