# Restructure agent instructions around a lean AGENTS.md

Date: 2026-10-10 22:36 (local)

## Summary

Applied the lean agent-context method (saved as the user-level skill `~/.claude/skills/agent-context-setup`, based on arXiv 2602.11988, arXiv 2607.27250, and Anthropic context-engineering and Claude Code best-practices guidance). Research found repository context files do not reliably improve task success and raise cost, and that overview text does not help, so the always-on context was cut to non-discoverable facts. Because several coding agents are used, `AGENTS.md` is the single source of truth and `CLAUDE.md` only imports it.

Before: `AGENTS.md` 281 lines, `CLAUDE.md` 69 lines (overlapping, with stale references). After: `AGENTS.md` 61 lines, nested files 14 to 20 lines each, `CLAUDE.md` files 1 line each.

## What was kept, moved, removed

- Kept in root `AGENTS.md`: verified commands (Linux forms), desktop invariants, gotchas, where to look, working rules, the change log rule (user requirement).
- Moved to nested files: API layering/migrations/SSE/task-key notes (`apps/api`), API client/context/confirmation-flow notes (`apps/web`), sidecar and generation-state rules (`apps/desktop`).
- Removed from always-on context (derivable from code or already in `docs/`): tech stack lists, repository layout, startup/shutdown narrative, route/model location notes, PowerShell-only command blocks, the two-table "Project Documentation" section, `Required Context` list.
- Corrected stale facts: sidecar lifecycle is in `backend.rs`; routers are in `core/routers.py`; models are per-file under `models/`.
- New facts recorded: root `bun run lint` and `bun run check-types` execute no tasks (no workspace defines them); `.agents/rules/code-change-quality-gate.md` references a `Project-Context.md` that does not exist.

## Files changed

- `AGENTS.md`: rewritten.
- `CLAUDE.md`: now `@AGENTS.md`.
- `apps/api/AGENTS.md`, `apps/web/AGENTS.md`, `apps/desktop/AGENTS.md`: new.
- `apps/api/CLAUDE.md`, `apps/web/CLAUDE.md`, `apps/desktop/CLAUDE.md`: new, each `@AGENTS.md`.
- `CHANGELOG.md`: entry added.
- Outside the repo: `~/.claude/skills/agent-context-setup/` (`SKILL.md`, `references/evidence.md`, `references/templates.md`).

## Impact

- Desktop, API, UI, data: none (instructions only).
- Process: agents load less always-on text; the old "read these docs first" instruction is replaced by "open only the page you need".

## Verification

- `bun run version:check`: passed.
- `cd apps/web && bunx vitest run tests/lib/runtime-api.test.ts tests/lib/desktop-backend.test.ts`: 18 tests passed.
- `bun run lint`: confirmed it runs 0 tasks.
- Every file path named in the new files was checked to exist.
- Not verified: `python -m pytest` and `cargo test`. On this machine `python` is not available through pyenv and the system `python3` has no `fastapi` installed; Rust tests were not run. The pytest and cargo commands are carried over from the previous docs, not re-run here.
- The A/B evaluation of the new context versus the old one has not been done yet.
