# QurioDB

Desktop-first database management and analytics app (Bun/Turbo monorepo: `apps/web` React, `apps/api` FastAPI, `apps/desktop` Tauri 2). The packaged desktop app is the priority target: the Tauri shell bundles the web UI and runs the API as a local sidecar. Judge every backend or frontend change by its effect on the packaged desktop app, not only on browser dev.

Product: single-user-first, local. SQL Lab (browse databases, edit and run SQL), an AI Assistant (text-to-SQL with RAG/GraphRAG), connections to Postgres, MySQL, MongoDB, Redis and others, a dashboard, file import and a Markdown knowledge base. Users are analysts and developers working on their own machine.

## Commands

Repo docs are written for Windows/PowerShell. On Linux use the forms below and skip `.ps1`/`.bat` scripts.

- Install: `bun install` and `pip install -r apps/api/requirements.txt`
- Dev: `bun run dev` (web + api), `bun run dev:web` (Vite :3001, proxies `/api` to :5000), `bun run dev:backend` (FastAPI on 127.0.0.1:5000)
- Fast check: `bun run typecheck` (web typecheck, about 6-25 s). Full check: `bun run verify` (typecheck, web tests and API tests, about 65 s). Baseline on 2026-10-20: 780 web tests and 756 API tests pass (3 skipped). Both run `scripts/verify.sh`, which uses `apps/api/venv` for the API tests because `python` may resolve to a pyenv shim.
- Web tests: `cd apps/web && bunx vitest run [path] [-t "name"]`
- Web typecheck: `cd apps/web && bunx tsc --noEmit`
- API tests: `cd apps/api && python -m pytest [path::test]`; AI/RAG regression suite: `python -m pytest -m rag` (or `bun run test:rag`)
- Rust tests: `cd apps/desktop/src-tauri && cargo test`
- `bun run lint` and `bun run check-types` run Turbo, but no workspace defines those scripts, so they check nothing. Use the check commands above. CI (`.github/workflows/ci.yml`) runs `scripts/verify.sh full` on pull requests and pushes to `dev`; it has not been run on GitHub yet, so trigger it once with `workflow_dispatch`.
- Format: `bun run format`
- Desktop build: Windows `bun run desktop:build`; Linux `bun run desktop:sidecar:linux`, `desktop:build:linux`, `desktop:dev:linux`
- Version: set `QURIODB_VERSION` in root `.env`, then `bun run version:sync` (`version:check` to verify)
- Frontend production build out of memory: `NODE_OPTIONS=--max-old-space-size=8192`

## Invariants (desktop)

- After changing Python in `apps/api` that desktop needs, rebuild the sidecar (`powershell -ExecutionPolicy Bypass -File build-backend.ps1` on Windows). The packaged app runs the prebuilt binary in `apps/desktop/src-tauri/bin/`, so it stays stale otherwise.
- Keep `/health` and `/api/health`. Desktop readiness is `/api/desktop/health`, which requires the `X-QurioDB-Startup-Nonce` header.
- Bind the backend to `127.0.0.1` only (Windows firewall prompts, nonce trust model).
- The desktop API URL is dynamic (`http://127.0.0.1:<port>/api/`). Never hard-code it; use `getApiBaseUrl()` from `apps/web/src/lib/runtime-api.ts`.
- The API is not reachable immediately on desktop startup. `DesktopReadyGuard` gates rendering until Rust reports ready.
- Tauri kills the sidecar on exit; the API also exits if its parent dies. Verify startup, health, API URL, and shutdown after desktop-affecting changes.

## Gotchas

- Sidecar lifecycle (spawn, readiness polling, restart, kill) is in `apps/desktop/src-tauri/src/backend.rs`, not `lib.rs`.
- The API is FastAPI, not Flask, despite stale comments. Routers are wired in `apps/api/core/routers.py`. Keep `routes/` -> `services/` -> `models/` boundaries.
- Metadata DB: `~/.quriodb/quriodb.db`. There is no migration framework: add model columns plus an idempotent migration function in `apps/api/services/startup.py` (`setup_database` runs `create_all`, migrations, seeds). First run seeds `admin` / `password123`.
- Desktop runs with `DISABLE_AUTH=true` (sidecar) and `VITE_DISABLE_AUTH=true` (web build). Browser mode uses JWT.
- AI provider keys live encrypted in the metadata DB (Settings -> AI Assistant), not in env vars.
- SQL safety is enforced server-side (`apps/api/services/execution/sql_policy.py`, one-time approval tokens). Never relax it only in the UI. The AI assistant must never auto-execute writes.
- Do not reintroduce a TS `baseUrl`; the `@` alias (`apps/web/src`) comes from `vite-tsconfig-paths`.
- Default branch is `dev`.

## Where to look

- Nearest nested file applies: `apps/api/AGENTS.md`, `apps/web/AGENTS.md`, `apps/desktop/AGENTS.md`.
- Reference docs: `docs/README.md` indexes `docs/architecture/*` (design) and `docs/modules/*` (per feature). Open only the page for the area you change. `docs/` is gitignored, so it may be absent; the code is the truth, and fix a doc if you find it wrong.
- Rules: `.agents/rules/code-change-quality-gate.md` (applies to every code change) and `.agents/rules/clean-code.md` (`.agents/` is gitignored and local-only). Skills: `.agents/skills/*` (backend-developer, frontend-developer, commit-convention, business-analysis).
- Prefer a code-intelligence tool (CodeGraph MCP) or targeted search over reading whole files. For cross-layer work trace UI -> API client -> route -> service -> (desktop sidecar) before editing.

## Working rules

- Follow existing patterns; keep edits scoped; do not revert changes you did not make.
- Multi-file or unfamiliar work: explore and plan first. If the diff fits in one sentence, just do it.
- Verify with the narrowest relevant test before finishing. Add a regression test for each bug fix. Run a baseline test first for risky fixes.
- Final response: list checks run, and any failures or skipped steps.

## Change log (required for every change)

1. `CHANGELOG.md`: add one line under `## [Unreleased]` (Added/Changed/Fixed/Removed/Security) linking the detail file.
2. `change-log/<YYYY-MM-DD>-<HHmm>-<slug>.md` (local time): summary and why, files changed, impact (desktop, API, UI, data), verification (say if none was run).

If a change alters behavior described in `docs/`, update that page too.
