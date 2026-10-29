# Add test:changed

The fast check only type-checks, and the full check takes about a minute, so there was nothing in between for "did my change break the tests that cover it". `bun run test:changed` fills that gap.

## Files changed

- `scripts/verify.sh`: new `changed` mode. It lists uncommitted and untracked files, runs `vitest related` on the changed web sources, and runs pytest on the changed API test files plus the API tests that mention a changed module (matched by module name). If no API test mentions the module it runs the whole API suite. With nothing changed it says so and exits 0.
- `package.json`: `test:changed` script.
- `AGENTS.md`: documents the narrow check, removes the hard-coded test counts (780 web, 756 API) that would go stale, and records that most files under `apps/web` fail `prettier --check`, so format enforcement was not added.

## Impact

- Desktop/API/UI/data: none. No application code changed.
- The Stop hook still runs only the fast check. Related tests were left out of it on purpose: in another repo a widely imported component pulled in about 30 test files and took close to four minutes.

## Verification

- Probe files (a web leaf module with a test, an API module with a test) were added and removed: the passing probe ran 1 web and 1 API test and exited 0; with the expectation changed the run failed with exit 1. With no changes the mode printed "nothing to run".
- Measured before deciding against a format check: 254 of 434 tracked source files fail `prettier --check` (240 under `apps/web`).
