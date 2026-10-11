# apps/desktop (Tauri 2, Rust)

## Rules
- `src-tauri/src/backend.rs` owns the sidecar: allocate loopback port and 256-bit nonce, spawn `api` with `DISABLE_AUTH`, `QURIODB_DESKTOP_PORT`, `QURIODB_STARTUP_NONCE`, `QURIODB_DESKTOP_PARENT_PID`, poll `/api/desktop/health` every 500 ms (up to 180 tries), emit `backend-status-changed`.
- State is generation-based: events or children from an older generation must not overwrite a newer status or child. Keep that property when editing, and keep tests for it.
- The nonce must never appear in public status payloads or logs.
- Status values: `starting`, `ready` (with `apiBaseUrl`), `failed` (with `errorCode`). The web `desktop-backend.ts` and `desktop-ready-guard.tsx` mirror these; change both sides together.
- Windows shutdown uses `taskkill /F /T /PID` to end the process tree.
- Sidecar binary is `bin/api` in `tauri.conf.json`, resolved per target triple from `src-tauri/bin/` (prebuilt; rebuild after API changes, see root invariants).

## Check
- `cd src-tauri && cargo test` (readiness, generation, and status-serialization tests are in `backend.rs`).
- Linux dev: `bun run desktop:dev:linux` from the repo root (builds the sidecar first).
- Desktop-affecting change: start the app, confirm backend-ready, one query round trip, and no leftover `api` process after quit.
