# Schema diagram: zoom-based level of detail for table cards

Date: 2026-10-10 23:27 (local)

## Summary

The SQL Lab schema diagram was still slow in `All columns` mode on a real schema (Superset metadata DB, 147 tables): about 11.7k DOM nodes, about 1.7k column rows and a zoom frame time of 52-58 ms at overview zoom, where the row text is only about 3 px high and unreadable. Measured on the live page (details in the run evidence): the cost is the number of row elements painted when zoomed far out. Hiding the rows with CSS took the same zoom test from 58 ms to 17.4 ms, while `will-change: transform` (-14%) and `contain` (no effect) were not worth it.

- Table cards now have a zoom-based level of detail. Below zoom 0.30 a card renders compact: same box size, header only (icon, name, column count, hub badge, handles); no rows, no `+N more columns` footer, no hub chips (the elements are not rendered, not just hidden). From zoom 0.36 up the full card renders as before. Between 0.30 and 0.36 the current mode is kept (hysteresis), so cards do not flicker while zooming.
- The hysteresis state is shared by all cards of one React Flow instance (keyed by the flow store), so cards that mount later (because only visible nodes are rendered) take the same mode as the others. An earlier version kept the state per card and showed mixed compact and full cards around zoom 0.36 while zooming out.
- Until the viewport size is known and the initial fit has run, cards render compact so the first paint never builds thousands of rows at the default zoom.
- Layout, node data, edges, selection, hub folding and refit logic are unchanged. Cards expose `data-lod="compact|full"`.

## Files changed

All under `apps/web`:

- `src/app/sqllab/components/schemavisualizer/useTableLod.ts` (new): boolean store selector with hysteresis, shared per flow store; exports `LOD_COMPACT_BELOW` (0.30) and `LOD_FULL_ABOVE` (0.36).
- `src/app/sqllab/components/schemavisualizer/TableNode.tsx`: renders compact or full body by the LOD flag.
- Tests: `tests/components/sqllab/table-lod.test.tsx` (new: startup, readiness latch after a later refit, all detail levels, hysteresis both ways, geometry, one render per flag flip, late-mounted cards, independent flows), `table-node.test.tsx`, `schema-hubs.test.tsx` (full-card tests now set an explicit viewport/zoom).
- `docs/modules/03-schema-explorer.md` (local, `docs/` is gitignored): describes the level of detail.

## Impact

- Desktop: frontend only; no sidecar rebuild. Not checked in the Tauri WebView.
- API: none.
- UI: SQL Lab Schema panel and fullscreen. At overview zoom cards show only their header; column rows appear when zooming in past 0.36 (also in `Keys` and `All columns`). This also applies to small schemas in the narrow side panel, where the fit zoom is about 0.1.
- Data/migration: none.

## Verification

- `bunx vitest run tests/lib/schema-diagram.test.ts tests/lib/schema-rank-layout.test.ts tests/components/sqllab` (cwd `apps/web`): 44 files, 255 tests passed. `bunx tsc --noEmit`: no errors. `bunx prettier --check` on touched files and `git diff --check`: clean (run by the implementer). ESLint: no config for `apps/web`, not run.
- Real browser (Playwright, same Superset DB, 345x607 panel, hub links hidden, machine under load; raw numbers in the run evidence `baseline-metrics.md`):
  - `All columns`: DOM nodes 11,718 -> 4,023; column rows in DOM 1,695 -> 0 at overview; zoom frame time (60 synthetic wheel events) 52.5-53.3 ms -> 17.7-17.8 ms; switching to `All columns` about 580 ms -> about 290-300 ms (switching to `Keys` 55/372 ms -> 57/270 ms). These before/after numbers were measured about 12 minutes apart on a machine under load (load average about 3), not interleaved; only the CSS experiment above was an interleaved A/B. `Keys`: DOM 6,705 -> 4,023, zoom 27 ms -> 16.7-16.9 ms.
  - Zoom sweep in `All columns`: scale 0.056 / 0.128 / 0.295 went from 57.6 / 59.8 / 26.2 ms to 16.7 / 18.7 / 17.3 ms (compact); scale 0.677 and 1.556 are full cards at 16.7 ms (the vsync floor).
  - Hysteresis: zooming in, cards turn full at about 0.375; zooming out they turn compact at about 0.288; no sample with mixed compact and full cards in either direction.
  - The remaining switch time is not the layout: layout of the 147 tables measured about 25 ms (132 ms with all 228 links shown) in a script on the real data; the rest is React Flow measuring and rendering the cards.
- Not run: desktop build, Tauri WebView, backend tests (no backend change), a start-up case where the initial fit zoom is 0.36 or more (no such connection available; covered by the unit test only).
