# Repository context cleanup

## Summary and reason

Record the existing repository cleanup alongside the lean agent instructions: remove the root Claude context, the old OpenCode configuration, and the obsolete safe-SQL research page. Nested Claude files import their corresponding AGENTS.md.

## Files changed

- `CLAUDE.md`, `opencode.json`, `docs/050-Research/Analysis-Safe-SQL-Execution.md`: deleted.
- Root and nested agent instructions and their existing detail files are committed together.
- `CHANGELOG.md` and this detail record the cleanup.

## Impact

- Desktop, API, UI, data: no runtime changes.
- Agent tooling: root Claude context and OpenCode configuration are removed; nested instructions remain available.

## Verification

- Inspected the current deletions and nested instruction imports.
- `git diff --check`: passed.
