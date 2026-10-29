# Desktop update notification

Desktop users had no way to learn that a newer release exists. The app now checks the latest stable GitHub release and tells the user, without downloading or installing anything (phase 1 of `docs/specs/2026-10-28-update-notification.md`; plan in `docs/plans/2026-10-28-update-notification.md`).

## Behavior

- About 5 s after the desktop UI is ready, and every 24 h while it stays open, the web UI calls the Tauri command `check_for_update` (only when "Check for updates automatically" is on, the default).
- Rust requests `https://api.github.com/repos/iamVinhNT/QurioDB/releases/latest` (10 s timeout), compares the `vX.Y.Z` tag with the app's `major.minor.patch`, and returns the result or an error code (`network`, `rateLimited`, `notFound`, `serverError`, `invalidResponse`).
- When a newer version exists and it was not skipped, the header shows an icon-only button with a dot (`aria-label="Update available: X.Y.Z"`). Its popover has "Download from GitHub", "Skip this version" and a link to Settings. A toast appears once per version.
- "Download from GitHub" calls `open_release_page` with the version only; Rust validates it as `X.Y.Z` and builds the release URL itself, so the webview never chooses what gets opened. "Skip this version" also dismisses a toast that is still showing.
- Automatic check failures are silent. Settings > General > "About and updates" shows the installed version, the last check time, a manual check with readable error messages (announced through one permanent `role="status"` region; the button uses `aria-disabled` during a check so keyboard focus stays on it), and the auto-check switch.
- Nothing is cached across launches, so an upgraded app never shows a stale update. Browser mode renders none of this and never calls Tauri.

## Files changed

- `apps/desktop/src-tauri/src/update.rs` (new): check, version compare, URL prefix check, both commands, unit tests with `httpmock`.
- `apps/desktop/src-tauri/src/lib.rs`: registers the two commands.
- `apps/web/src/lib/desktop-update.ts` (new): typed `invoke` wrappers and `getInstalledVersion`.
- `apps/web/src/stores/use-update-store.ts` (new): check result shared by header and Settings; persists `skippedVersion` and `notifiedVersion` under `update-state`.
- `apps/web/src/stores/use-settings-store.ts`: `autoCheckUpdates` preference (default `true`).
- `apps/web/src/components/ui/popover.tsx` (new): Base UI popover wrapper in the style of the other `ui/` wrappers.
- `apps/web/src/components/update-indicator.tsx` (new) and `components/header.tsx`: header icon, popover, toast, timers.
- `apps/web/src/app/settings/components/general-settings/AboutUpdatesCard.tsx` (new) and `GeneralSettings.tsx`: Settings card.
- Tests: `tests/lib/desktop-update.test.ts`, `tests/stores/use-update-store.test.ts`, `tests/components/update-indicator.test.tsx`, `tests/components/settings/about-updates-card.test.tsx`, one assertion in `tests/stores/use-settings-store.test.ts`.
- Docs (local, gitignored): `docs/architecture/02-desktop-runtime.md` (Update notification section), `docs/modules/06-settings.md`.

## Impact

- Desktop: one HTTPS request to api.github.com per launch and per 24 h. Startup is not blocked (the check starts 5 s after mount). No sidecar, health, port or shutdown change. No Python change, so the sidecar does not need a rebuild.
- API and data: none. The metadata DB is untouched; the new preference syncs with the other settings on Save.
- UI: new header icon (only when an update exists), popover, toast and Settings card.
- `open_release_page` uses the shell plugin's `open`, deprecated since 2.1 in favor of `tauri-plugin-opener`; kept to avoid a new dependency.

## Verification

- Rust: `cargo test --target x86_64-unknown-linux-gnu` 33 passed (9 new). Plain `cargo test` fails on Linux because `.cargo/config.toml` sets the Windows GNU target.
- Web: `bun run typecheck` OK; `bun run verify` (via `verify-receipt run full`) passed: 136 files, 813 web tests, API tests. A first run failed one existing test (`vector-store-workspace.test.tsx`) while a desktop build ran in parallel; it passed alone and in the rerun.
- The new web tests print React `act(...)` warnings (async store updates); many existing component tests print the same warning. Tests pass.
- Browser check (Playwright against Vite with a mocked Tauri IPC, dark and light, 1280 and 960 px): icon, toast, popover, keyboard open, Download calls `open_release_page`, Skip hides the icon, Settings card, no icon when up to date. Fixed a popover overflow found there (340 to 360 px).
- Live endpoint: `releases/latest` returns `v0.1.6` with an `html_url` under the allowed prefix.
- Desktop: debug build with `--config '{"version":"0.1.5"}'` (no tracked version file changed). Backend ready at 14:25:49; the GitHub request started at 14:25:54. Visual check in the real window and shutdown: see the review notes below once done.

## Review (independent reviewer, round 1)

Findings and outcome:
- Medium, security: the URL prefix check in `open_release_page` could be bypassed with encoded dot segments (`%2e%2e`), sending the browser to another GitHub repo's release asset. Fixed: the command takes a version and Rust builds the URL; test covers `..`, `%2e%2e`, query strings and full URLs.
- Low: a pre-release app version never saw updates. Fixed: compare `major.minor.patch` only.
- Low: 5xx showed "check your internet connection". Fixed: new `serverError` code and message.
- Low: Skip left the toast visible. Fixed: `toast.dismiss`.
- Low: the check button lost keyboard focus when disabled. Fixed: `aria-disabled` plus a guard; test asserts it stays enabled and does not start a second check.
- Low: result messages were not in a stable live region. Fixed: one permanent `role="status"` region.
- Info: `shell:allow-open` in `capabilities/default.json` was already unscoped before this change; the Rust check is defense in depth. Not changed here.
