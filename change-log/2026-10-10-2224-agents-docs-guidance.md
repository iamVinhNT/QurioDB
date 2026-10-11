# Add documentation guidance for coding agents to AGENTS.md

Date: 2026-10-10 22:24 (local)

## Summary

`AGENTS.md` now tells coding agents where the project docs are, which doc to read for which kind of change, and how to keep the docs correct (update with behavior changes, stay factual, numbering, language, gitignore caveat, changelog).

## Files changed

- `AGENTS.md`: new "Project Documentation" section (tables mapping tasks and features to docs, plus six usage rules) and a new bullet in "Required Context".
- `CHANGELOG.md`: entry added under `[Unreleased]`.

## Impact

- Desktop, API, UI, data: none.
- Process: agents read the relevant `docs/architecture/*` and `docs/modules/*` before editing and update them when behavior changes.

## Verification

Documentation-only change; no tests or checks were run. File names in the tables were checked against `docs/architecture/` and `docs/modules/`.
