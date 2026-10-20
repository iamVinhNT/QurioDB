# Untrack docs and .agents

`docs/` and `.agents/` are gitignored, but nine files in them had been force-added earlier. They are now removed from the git index only; the files stay on disk and the ignore rules keep them out of future commits.

## Files changed

- Untracked `.agents/rules/code-change-quality-gate.md`, `.agents/settings.json` and `.agents/settings.local.json`.
- Untracked `docs/plans/` (4 files) and `docs/specs/` (2 files).
- `AGENTS.md`: notes that `.agents/` is local-only, next to the existing note that `docs/` is gitignored.

## Impact

- Desktop/API/UI/data: none.
- Fresh clones, CI and git worktrees no longer receive these files; the project rules in `.agents/rules/` and the older specs and plans exist only on the maintainer's machine. Earlier change records that link to these paths now point at local-only files.
- Existing clones that pull this commit may have Git delete the working copies of these nine files; keep a copy first.

## Verification

- `git ls-files .agents docs` prints nothing after the change, and `git check-ignore` confirms both directories are ignored.
- The nine files still exist on disk in this clone.
- No tests were run; the change touches no executable code.
