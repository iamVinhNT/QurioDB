# Add verify script and CI

`bun run lint` and `bun run check-types` check nothing, so there was no single command that proves a change is sound, and no CI ran the tests. This adds one script with a fast and a full mode, and a CI workflow that runs it.

## Files changed

- `scripts/verify.sh` (new): `fast` runs the web typecheck; `full` adds the web tests (Vitest) and the API tests (pytest). It uses `apps/api/venv` when present, or `PYTHON`.
- `package.json`: `typecheck` (fast) and `verify` (full) scripts.
- `.github/workflows/ci.yml` (new): runs `bash scripts/verify.sh full` on pull requests, pushes to `dev` and manual dispatch. Read-only token, actions pinned to commit SHAs, Python 3.11 (the version the release workflow uses), 25 minute timeout.
- `AGENTS.md`: documents the two commands, the 2026-10-20 baseline and the CI workflow.

## Impact

- Desktop/API/UI/data: none. No application code changed.
- Contributors: pull requests now show a CI result.

## Verification

- `bun run verify` passed locally in about 65 seconds: web typecheck, 780 web tests, 756 API tests (3 skipped). `bun run typecheck` passed in about 6 seconds.
- The workflow file parses as YAML, every action is pinned to a 40 character SHA, the token is read-only and no expression is interpolated into a `run` step. It has NOT been run on GitHub: Python 3.11 and a clean Ubuntu runner differ from the local Python 3.14 environment, so trigger it once with `workflow_dispatch` and fix any difference.
