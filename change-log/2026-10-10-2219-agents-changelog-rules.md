# Add change log rules to AGENTS.md

Date: 2026-10-10 22:19 (local)

## Summary

Every future repository change must now update `CHANGELOG.md` (short summary) and add a detail file `change-log/<YYYY-MM-DD>-<HHmm>-<slug>.md`. The rule was added to `AGENTS.md` so every agent working in the repo follows it. The first `CHANGELOG.md` and this folder were created together with the rule's first use.

## Files changed

- `AGENTS.md`: new "Change Log Rules" section (format of both files, required detail sections) and one bullet in "Engineering Guidance".
- `CHANGELOG.md`: created (Keep a Changelog format, `[Unreleased]` section).
- `change-log/`: created.

## Impact

- Desktop: none.
- API: none.
- UI: none.
- Data/migration: none.
- Process: contributors and agents add two files of notes per change.

## Verification

Documentation-only change; no tests or checks were run.
