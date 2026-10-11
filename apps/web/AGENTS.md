# apps/web (React 19 + Vite)

## Rules
- Call the backend through `src/lib/api-client.ts` (`databaseApi`, `aiApi`, `authApi`, `userApi`). Streaming uses `streamSSE` there. Do not hard-code API URLs; `getApiBaseUrl()` handles browser vs desktop.
- Check any change touching startup, auth, or API URLs in both browser mode and Tauri mode (`isTauriRuntime()`).
- SQL Lab state is split into several contexts (`sqllab/context/SQLLabContext.tsx`). Subscribe to the narrowest one (editor, result, cursor, tab metadata, stable actions) to avoid re-render storms while typing.
- Risky SQL returns HTTP 409 `sql_confirmation_required`; the client turns it into `SqlConfirmationRequiredError` and the confirmation dialog retries with a token. Keep that flow intact.
- Reuse primitives in `src/components/ui/` and existing Tailwind patterns. New files start with a short `@file` / `@description` header comment.
- Path alias `@` -> `src`; do not add `baseUrl` to tsconfig.

## How to
- Add a page: component under `src/app/<name>/`, lazy route in `src/App.tsx`.
- Add a user preference: field and default in `src/stores/use-settings-store.ts`, a settings card, then the code that uses it (some stored options, such as `autoExplain`, are not consumed yet).

## Check
- Types: `bunx tsc --noEmit` (the root `check-types` script does nothing).
- Tests: `bunx vitest run path/to/file.test.ts`. Tests live in `tests/` and next to some sources.
- UI change: view it in the running app or a screenshot when possible; passing tests alone do not prove layout.
