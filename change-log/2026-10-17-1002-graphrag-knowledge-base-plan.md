# GraphRAG and Markdown Knowledge Base plan

## Summary and rationale

Created a draft design and implementation plan for the user's two requirements: GraphRAG for AI SQL and a screen for creating knowledge bases and design documents that support retrieval. The user requested Markdown and the `docs/plan/` location, with the task-oriented format used by earlier plans.

The plan retains hybrid retrieval, adds a typed schema/business graph, and introduces a Markdown authoring workspace with revisioned publication, reviewed bindings and evidence citations. It defines API/data contracts, UI flows, acceptance criteria, ordered tasks and packaged-desktop verification. It references the active Vector Store redesign without replacing that work. A subsequent user request moved the plan to `docs/plans/`; the current file path is listed below.

## Files changed

- `docs/plans/2026-10-17-graphrag-knowledge-base.md`: draft architecture, screen design and implementation plan.
- `docs/README.md`: link to the new plan.
- `CHANGELOG.md`: Unreleased entry linking this detail file.
- `change-log/2026-10-17-1002-graphrag-knowledge-base-plan.md`: change record.

`docs/` remains gitignored. The plan and documentation index are local artifacts; no files were force-added or committed.

## Impact

- Desktop, API and UI runtime: no behavior changed; implementation and sidecar work are future tasks.
- Data: no migration, knowledge indexing, provider call or source-database change performed.
- Existing in-progress Vector Store files and earlier research artifacts were preserved.

## Verification

- Read the existing AI/RAG UI, API client, routes, models, ingestion/index/retrieval services, metadata source and the active Vector Store plan before drafting.
- Prettier check of the new plan and this change record: passed.
- Checked local reference links, the README entry, ten acceptance criteria and fourteen unique task IDs; used the repository Mermaid helper for a structural check of the one diagram: passed.
- `git diff --check`: passed.
- Strict Mermaid rendering was skipped because `mmdc` is unavailable. The structural check does not prove rendered layout.
- Product tests, browser UI checks, live-model evaluation and desktop/sidecar builds were not run for this documentation-only change. The plan lists those as implementation requirements.
