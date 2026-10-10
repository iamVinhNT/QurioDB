# Schema diagram: fold hub links, labels only on focus

Date: 2026-10-10 23:00 (local)

## Summary

On a real schema (Superset metadata DB: 147 tables, 228 table-to-table links) the diagram was still full of crossing lines and overlapping labels such as `created_by_fk, changed_by_fk`. Measured on that DB: 151 of the 228 links (66%) point to just five hub tables (`ab_user`, `dbs`, `slices`, `dashboards`, `tenant`), mostly audit columns; only 77 links remain without them.

- Hub folding: in schemas with more than 30 tables, a table referenced by at least 10 distinct other tables is a hub. Links to hubs are not drawn and not given to the layout by default. The FK column row shows a small arrow chip (`→ hub`) instead; clicking the chip selects the hub and zooms to it. Hub cards show "Referenced by N". A "Hub links" toggle in the overlay shows all links again. Small schemas (30 tables or fewer) are unchanged.
- Selecting a table also draws its own hidden hub links, and hovering a normal table does too; hovering a hub does not (it would draw about a hundred links), selecting it does. While a table is selected, the footer count of hidden hub links goes down by the links being shown; the toggle always shows the total.
- Edges have no labels by default and are thin and quiet. The FK column label appears only on the links of the hovered or selected table. When more than 12 links are highlighted (for example a selected hub) they stay highlighted but get no labels and a thinner stroke.
- Edges are drawn below the table cards (`elevateEdgesOnSelect` off, edge `zIndex` -1) so highlighted lines no longer cross over column names.
- Footer reads "<n> Tables · <m> Links (+K hub links hidden)".

## Files changed

All under `apps/web`:

- `src/app/sqllab/components/SchemaVisualizer.tsx`: hub toggle state and reset, chip focus callback, uses the new model hook, `elevateEdgesOnSelect={false}`, footer hidden count.
- `src/app/sqllab/components/schemavisualizer/useSchemaGraphModel.tsx` (new): graph preprocessing, folded layout geometry and interaction edge styling in separate memoized stages; label cap (`MAX_LABELLED_EDGES`).
- `src/app/sqllab/components/schemavisualizer/HubLinksToggle.tsx` (new): toggle button.
- `src/app/sqllab/components/schemavisualizer/graph.ts`: `LARGE_SCHEMA_THRESHOLD`, `HUB_THRESHOLD`, `findHubTables`, `splitHubEdges`, `getHiddenHubColumns`.
- `src/app/sqllab/components/schemavisualizer/types.ts`: hub-related node data.
- `src/app/sqllab/components/schemavisualizer/layout.ts`: hub tables first in the grid of unconnected tables.
- `src/app/sqllab/components/schemavisualizer/TableNode.tsx`: hub chips, "Referenced by N" badge.
- Tests: `tests/components/sqllab/schema-hubs.test.tsx` (new), `schema-visualizer.test.tsx`, `table-node.test.tsx`, `tests/lib/schema-diagram.test.ts` (extended).
- `docs/modules/03-schema-explorer.md` (local, `docs/` is gitignored): schema visualizer section describes hub folding and label rules.

## Impact

- Desktop: frontend only; no sidecar rebuild. Not checked in the Tauri WebView.
- API: none (hubs are computed in the browser from the existing foreign key list).
- UI: SQL Lab Schema panel and fullscreen; new "Hub links" toggle, chips, badges; edge labels only on focus.
- Data/migration: none.

## Verification

- `bunx vitest run tests/lib/schema-diagram.test.ts tests/lib/schema-rank-layout.test.ts tests/components/sqllab` (cwd `apps/web`): 43 files, 246 tests passed. `bunx tsc --noEmit`: no errors. `bunx prettier --check` on touched files and `git diff --check`: clean (run by the implementer). ESLint: no config exists for `apps/web`, not run.
- Real browser (Playwright, same Superset DB, raw numbers in the run evidence `baseline-metrics.md`): default view in a 345x607 side panel draws 77 links with footer "(+151 hub links hidden)", 0 animated edges, 0 labels, and 5 hub badges (`ab_user` 92, `dbs` 20, `dashboards` 14, `tenant` 13, `slices` 12). Toggle on shows 228 links and refits (fullscreen zoom 0.2). Clicking the `→ ab_user` chip selected `ab_user`, zoomed to it and highlighted its 92 incoming links. After the follow-up fix, selecting `ab_user` draws those 92 links behind the cards, with no labels, at 1.5 px. No console errors in that session.
- Performance: DOM nodes 6,705 with hub links hidden (panel) and 7,316 with all links shown (fullscreen; the two numbers were not measured under identical conditions). Zoom frame time showed no measurable difference in an interleaved A/B on the same page, under machine load (mean 25.8 ms with hub links hidden, 26.9 ms shown), so this change is about readability, not frame rate. Earlier phase numbers (17.5-17.9 ms) were taken under lighter load and are not comparable.
- Not run: desktop build, Tauri WebView, backend tests (no backend change), keyboard (Tab/Enter) use of the chips in a real browser.
