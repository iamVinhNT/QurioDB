# Native macOS CI builds

## Summary and reason

Extend the existing desktop release workflow to build macOS alongside Windows and Linux. Apple Silicon and Intel run on separate native runners so PyInstaller and Tauri use matching architectures without cross-compiling the Python backend.

Manual preflight accepts `platform: macos` and uploads artifacts without publishing. Tagged releases wait for both macOS matrix entries as well as Windows and Linux before publication.

## Files changed

- `.github/workflows/release-desktop.yml`: add macOS selection, a native runner matrix, architecture-specific dependency caches, sidecar packaging and readiness checks, DMG/application archives, and release dependencies.
- `scripts/sync-version.test.ts`: update the existing workflow tests for three platforms, macOS selection, caches, and release gating.
- `README.md`: describe macOS artifacts, manual preflight, and signing status.
- `docs/architecture/09-build-and-release.md`: document macOS sidecar builds and CI. This existing page is gitignored and was updated locally.
- `CHANGELOG.md` and this detail file: record the change.

## Impact

- Desktop: produce separate `aarch64` and `x64` DMG installers and `.app.tar.gz` archives. Reuse `build-sidecar.sh` and explicitly pass the Darwin target to override the repository's Windows Cargo default.
- API: no source or contract changes. CI builds the frozen backend, checks `/api/desktop/health` with a generated nonce and parent PID, validates its response, and terminates it before bundling.
- UI and data: no behavior or schema changes.
- Distribution: Developer ID signing and notarization remain unconfigured. Gatekeeper can block downloaded macOS packages.

## Verification

- Baseline: clean working tree at `b8fde98`, branch `perf/sqllab-schema-diagram`; `bun test scripts/sync-version.test.ts` passed all 18 tests before editing.
- `bun test scripts/sync-version.test.ts`: 18 passed after editing.
- `actionlint .github/workflows/release-desktop.yml`: passed using a temporary installation of the official actionlint release.
- `bun run version:check`: passed for version `0.1.4`.
- YAML parsing, `bash -n` for every new macOS run block, and Python AST parsing for the embedded smoke test: passed.
- Executed the embedded smoke-test Python against temporary HTTP sidecar fixtures for both target names: healthy response, incorrect readiness body, malformed JSON, startup exit, readiness timeout, and stalled termination. All 12 scenarios produced the expected result and left no fixture sidecar process running. Timeout scenarios used shorter waits to avoid delaying local verification.
- Executed asset collection for both architectures with fixture bundles: correct filenames, archive contents, executable permissions, and symlinks passed.
- `git diff --check`: passed.
- Native macOS builds, packaged app startup, query round trips, and Tauri shutdown were not run because this workspace is Linux. These still require macOS CI runners and a packaged-app launch on macOS; fixture checks do not prove native packaging succeeds.

## References

- [GitHub runner images](https://github.com/actions/runner-images): `macos-15` is ARM64; `macos-15-intel` is Intel.
- [Tauri sidecars](https://v2.tauri.app/develop/sidecar/): external binaries require target-specific names.
- [Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/): Developer ID signing and notarization for macOS distribution.
