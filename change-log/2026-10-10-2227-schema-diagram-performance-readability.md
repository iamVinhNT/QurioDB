# SQL Lab schema diagram: performance and readability (phase 1)

Date: 2026-10-10 22:27 (local)

## Summary

The SQL Lab "Schema" ER diagram was slow and hard to read on real schemas (147 tables, 322 foreign keys: 19,016 DOM nodes, 322 animated edges, about 31 ms per frame while zooming, and `fitView` stuck at zoom 0.5 so most tables were cut off in the narrow side panel). This phase is frontend only:

- Lighter rendering: no edge animation, no blur/large shadows/entrance animation on table cards, memoized `TableNode`, `onlyRenderVisibleElements`, `minZoom` 0.05, small connection handles.
- Layout no longer depends on the theme and is computed from real node sizes (header, visible rows, footer). Tables without relations go into a grid below the connected graph. Dagre ranks that would form one very tall column (many tables referencing a few hub tables such as `ab_user`) are wrapped into several sub-columns so the whole graph has a screen-like aspect ratio.
- Three detail levels (Name only, Keys, All columns). Default is Keys when a schema has more than 30 tables, otherwise All columns. Key, foreign-key and plain columns have different icons and colors.
- Duplicate foreign keys between the same ordered pair of tables are merged into one link; self references and links to tables outside the schema are not drawn.
- Hover or click on a table highlights its links and dims the others; the clicked table gets a selected border. State is reset when the schema data changes.
- The old "View Details" dialog (a second React Flow instance) is replaced by an in-place fullscreen toggle (Esc exits). A minimap was added.

Known limits, deferred to phase 2 (or later): the backend does not return primary keys yet (Keys mode treats columns referenced by a foreign key as keys), `foreignSchema` is not used to tell apart same-named tables in different schemas, no column-level links, no ELK layout.

## Files changed

All under `apps/web`:

- `src/app/sqllab/components/SchemaVisualizer.tsx`: stable layout memo, separate edge-emphasis and selected-node memos, detail level control, fullscreen toggle with Esc, refit on geometry change, minimap, reset of hover/selection/override when data changes, "Tables / Links" footer.
- `src/app/sqllab/components/schemavisualizer/TableNode.tsx`: memoized card, detail levels, key/FK/plain icons with colors and `data-column-role`, bounded `nowheel nodrag` scroll area, "+N more columns" footer.
- `src/app/sqllab/components/schemavisualizer/layout.ts`: dagre layout from computed node sizes, rank wrapping, isolated-table grid.
- `src/app/sqllab/components/schemavisualizer/graph.ts` (new): visible-column selection, size constants, composite column splitting, edge filtering and merging.
- `src/app/sqllab/components/schemavisualizer/types.ts` (new): schema metadata and node data types.
- `src/app/sqllab/components/schemavisualizer/SchemaDetailsDialog.tsx`: deleted (replaced by fullscreen toggle).
- `tests/lib/schema-diagram.test.ts`, `tests/lib/schema-rank-layout.test.ts`, `tests/components/sqllab/table-node.test.tsx`, `tests/components/sqllab/schema-visualizer.test.tsx` (all new): graph and layout helpers, hub-and-spoke layout (no overlap, aspect ratio, determinism), `TableNode` detail levels and selection, visualizer behavior (refit triggers, Esc listener cleanup, selection, stale-state reset, link count).

## Impact

- Desktop: frontend only; no sidecar rebuild needed. Fullscreen uses `position: fixed` and was not checked inside the Tauri WebView.
- API: none.
- UI: SQL Lab Schema panel (diagram, toolbar overlay, fullscreen). The "View Details" button and dialog are gone.
- Data/migration: none.

## Verification

- `bunx vitest run tests/lib/schema-diagram.test.ts tests/lib/schema-rank-layout.test.ts tests/components/sqllab` (cwd `apps/web`): 42 files, 233 tests passed.
- `bunx tsc --noEmit` (cwd `apps/web`): no errors.
- `bunx prettier --check` on touched files: passed (run by the implementer). `git diff --check`: clean.
- ESLint: not run successfully; the repository has no ESLint config for `apps/web` (`ESLint couldn't find an eslint.config.* file`).
- Browser measurement with Playwright on a real PostgreSQL schema (147 tables, 322 foreign keys, 228 links after merging), same script before and after, 345x607 px side panel, 60 synthetic zoom events:
  - DOM nodes: 19,016 before, 7,758 after.
  - Animated edges: 322 before, 0 after.
  - Average zoom frame time: 31.1 ms before, about 17.5-17.9 ms after; p95 66.7 ms before, 16.8-33.2 ms after (two runs).
  - Fullscreen 1280x720: `fitView` zoom 0.2 with all 147 tables visible (before: 0.05 floor and still not fitting after the first rewrite, 0.5 and cut off originally). The side panel stays near 0.054 because it is only 345 px wide; use fullscreen for the overview.
  - Clicking `ab_user` (92 related links) highlighted those links, dimmed the other 136 and drew the selected border; Esc left fullscreen and refit to the panel; no console errors.
- Independent review (separate Claude session): round 1 on the first complete snapshot returned ACTION_REQUIRED (selected border never shown, stale hover/selection after a schema change, over-engineered sort, weak UI tests, labels, missing change log). All were fixed. Round 2 on the fixed code found no blocking code finding; its only finding (browser measurements of this change log not recorded as evidence) was fixed by recording them in the run evidence. Two low notes are deferred: the reset effect can run layout twice when the data changes, and any new `tables` array reference clears the user's selection.
- Not run: desktop build, Tauri WebView check, backend tests (no backend change).
