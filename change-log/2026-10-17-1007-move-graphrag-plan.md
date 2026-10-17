# Move GraphRAG plan to docs/plans

## Summary and rationale

Moved the GraphRAG and Markdown Knowledge Base plan from `docs/plan/` to `docs/plans/` at the user's request, alongside the existing implementation plans. Updated its location statement, documentation index and original change record.

## Files changed

- `docs/plans/2026-10-17-graphrag-knowledge-base.md`: relocated plan and corrected location statement.
- `docs/README.md`: link now points to `plans/`.
- `change-log/2026-10-17-1002-graphrag-knowledge-base-plan.md`: current plan path and relocation note.
- `CHANGELOG.md`: Unreleased entry.
- `change-log/2026-10-17-1007-move-graphrag-plan.md`: this record.

## Impact

Desktop, API, UI and data behavior are unchanged. The plan remains a local artifact under the gitignored `docs/` directory.

## Verification

Confirmed the destination exists, the old file is absent, the README points to the new location and the plan's relative reference links resolve. Prettier and `git diff --check` passed. Product tests and desktop builds were skipped for this documentation-only move.
