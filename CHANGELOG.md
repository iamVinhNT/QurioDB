# Changelog

All notable changes to QurioDB are recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Each entry links to a detail file in `change-log/`. Rules are in `AGENTS.md` (Change log section).

## [Unreleased]

### Removed

- Root Claude context, legacy OpenCode configuration and obsolete safe-SQL research page. See [change-log/2026-10-11-0741-repository-context-cleanup.md](change-log/2026-10-11-0741-repository-context-cleanup.md).

### Added

- Project documentation under `docs/architecture/` (9 docs) and `docs/modules/` (9 docs) with an index in `docs/README.md`. See [change-log/2026-10-10-2220-docs-architecture-modules.md](change-log/2026-10-10-2220-docs-architecture-modules.md).
- Change log process: `CHANGELOG.md` plus per-change detail files in `change-log/`. See [change-log/2026-10-10-2219-agents-changelog-rules.md](change-log/2026-10-10-2219-agents-changelog-rules.md).

### Changed

- Desktop package metadata and installer links now use version 0.1.4. See [change-log/2026-10-11-0741-desktop-version-014.md](change-log/2026-10-11-0741-desktop-version-014.md).
- Agent instructions restructured for multiple coding agents: `AGENTS.md` is now the single source of truth (281 -> 61 lines, verified commands, invariants, gotchas), with short nested `AGENTS.md` in `apps/api`, `apps/web`, `apps/desktop`; every `CLAUDE.md` now only imports `@AGENTS.md`. See [change-log/2026-10-10-2236-agents-md-lean-restructure.md](change-log/2026-10-10-2236-agents-md-lean-restructure.md).
- `AGENTS.md`: new "Project Documentation" section guiding coding agents to the matching `docs/` pages and rules for keeping them current. See [change-log/2026-10-10-2224-agents-docs-guidance.md](change-log/2026-10-10-2224-agents-docs-guidance.md).
- `AGENTS.md`: new "Change Log Rules" section and a matching line in Engineering Guidance. See [change-log/2026-10-10-2219-agents-changelog-rules.md](change-log/2026-10-10-2219-agents-changelog-rules.md).
- SQL Lab schema diagram is much lighter and readable on large schemas: no animated edges, memoized and simpler table cards, theme-independent layout with wrapped hub ranks and a grid for unrelated tables, Name/Keys/All detail levels, link highlighting on hover and click, fullscreen toggle with a minimap. See [change-log/2026-10-10-2227-schema-diagram-performance-readability.md](change-log/2026-10-10-2227-schema-diagram-performance-readability.md).
- SQL Lab schema diagram on large schemas: links to hub tables (referenced by 10+ tables) are folded into `→ hub` chips with a "Hub links" toggle, edge labels appear only on the hovered/selected table, and edges are drawn below the cards. See [change-log/2026-10-10-2300-schema-diagram-hub-folding.md](change-log/2026-10-10-2300-schema-diagram-hub-folding.md).
- SQL Lab schema diagram: table cards switch to a compact header-only form below zoom 0.30 (rows return from 0.36 up), which cuts `All columns` zoom frame time on a 147-table schema from about 53 ms to about 18 ms (measured on a loaded machine) and its DOM from 11.7k to 4.0k nodes. See [change-log/2026-10-10-2327-schema-diagram-zoom-lod.md](change-log/2026-10-10-2327-schema-diagram-zoom-lod.md).

### Removed

- SQL Lab schema diagram "View Details" dialog, replaced by the in-place fullscreen toggle. See [change-log/2026-10-10-2227-schema-diagram-performance-readability.md](change-log/2026-10-10-2227-schema-diagram-performance-readability.md).
