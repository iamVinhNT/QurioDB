# Changelog

All notable changes to QurioDB are recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Each entry links to a detail file in `change-log/`. Rules are in `AGENTS.md` (Change log section).

## [Unreleased]

### Fixed

- CSV export now honors encoding bytes, adds Unicode BOMs for Excel, rejects unrepresentable text, and protects formula cells while preserving valid numbers. See [change-log/2026-10-13-2359-csv-export-encoding-safety.md](change-log/2026-10-13-2359-csv-export-encoding-safety.md).

### Removed

- Undo the review-added 9router endpoint fallback; Custom Provider continues to require an explicitly configured base URL. See [change-log/2026-10-12-2327-remove-legacy-gateway-fallback.md](change-log/2026-10-12-2327-remove-legacy-gateway-fallback.md).
- Root Claude context, legacy OpenCode configuration and obsolete safe-SQL research page. See [change-log/2026-10-11-0741-repository-context-cleanup.md](change-log/2026-10-11-0741-repository-context-cleanup.md).

### Added

- SQL Lab Query History supports server-side search, load-more pagination, and confirmed deletion for the selected database. See [change-log/2026-10-14-0040-query-history-search-pagination-delete.md](change-log/2026-10-14-0040-query-history-search-pagination-delete.md).
- Native macOS CI builds for Apple Silicon and Intel, with sidecar readiness checks and DMG/application release assets. See [change-log/2026-10-12-2304-macos-ci-builds.md](change-log/2026-10-12-2304-macos-ci-builds.md).
- Project documentation under `docs/architecture/` (9 docs) and `docs/modules/` (9 docs) with an index in `docs/README.md`. See [change-log/2026-10-10-2220-docs-architecture-modules.md](change-log/2026-10-10-2220-docs-architecture-modules.md).
- Change log process: `CHANGELOG.md` plus per-change detail files in `change-log/`. See [change-log/2026-10-10-2219-agents-changelog-rules.md](change-log/2026-10-10-2219-agents-changelog-rules.md).

### Changed

- AI readiness reuses successful probes for five minutes, and Auto keeps its model per conversation with bounded provider-error failover. See [change-log/2026-10-14-1324-ai-model-stability.md](change-log/2026-10-14-1324-ai-model-stability.md).
- AI Assistant Auto Provider randomly selects an active registered model with the current user's configured provider and keeps that pair throughout each request. See [change-log/2026-10-12-2339-auto-provider-registered-models.md](change-log/2026-10-12-2339-auto-provider-registered-models.md).
- Desktop package metadata and installer links now use version 0.1.5 for the macOS CI release. See [change-log/2026-10-12-2308-desktop-version-015.md](change-log/2026-10-12-2308-desktop-version-015.md).
- AI chat supports MongoDB through its validated read-only agent and displays bounded query results immediately for every database type, with restored history and nested values. See [change-log/2026-10-10-2335-ai-mongodb-inline-results.md](change-log/2026-10-10-2335-ai-mongodb-inline-results.md).

- Replace the legacy AI gateway choice with Custom Provider, validate base URLs and migrate saved configurations. See [change-log/2026-10-11-0741-custom-ai-provider.md](change-log/2026-10-11-0741-custom-ai-provider.md).
- Desktop package metadata and installer links now use version 0.1.4. See [change-log/2026-10-11-0741-desktop-version-014.md](change-log/2026-10-11-0741-desktop-version-014.md).
- Agent instructions restructured for multiple coding agents: `AGENTS.md` is now the single source of truth (281 -> 61 lines, verified commands, invariants, gotchas), with short nested `AGENTS.md` in `apps/api`, `apps/web`, `apps/desktop`; every `CLAUDE.md` now only imports `@AGENTS.md`. See [change-log/2026-10-10-2236-agents-md-lean-restructure.md](change-log/2026-10-10-2236-agents-md-lean-restructure.md).
- `AGENTS.md`: new "Project Documentation" section guiding coding agents to the matching `docs/` pages and rules for keeping them current. See [change-log/2026-10-10-2224-agents-docs-guidance.md](change-log/2026-10-10-2224-agents-docs-guidance.md).
- `AGENTS.md`: new "Change Log Rules" section and a matching line in Engineering Guidance. See [change-log/2026-10-10-2219-agents-changelog-rules.md](change-log/2026-10-10-2219-agents-changelog-rules.md).
- SQL Lab schema diagram is much lighter and readable on large schemas: no animated edges, memoized and simpler table cards, theme-independent layout with wrapped hub ranks and a grid for unrelated tables, Name/Keys/All detail levels, link highlighting on hover and click, fullscreen toggle with a minimap. See [change-log/2026-10-10-2227-schema-diagram-performance-readability.md](change-log/2026-10-10-2227-schema-diagram-performance-readability.md).
- SQL Lab schema diagram on large schemas: links to hub tables (referenced by 10+ tables) are folded into `→ hub` chips with a "Hub links" toggle, edge labels appear only on the hovered/selected table, and edges are drawn below the cards. See [change-log/2026-10-10-2300-schema-diagram-hub-folding.md](change-log/2026-10-10-2300-schema-diagram-hub-folding.md).
- SQL Lab schema diagram: table cards switch to a compact header-only form below zoom 0.30 (rows return from 0.36 up), which cuts `All columns` zoom frame time on a 147-table schema from about 53 ms to about 18 ms (measured on a loaded machine) and its DOM from 11.7k to 4.0k nodes. See [change-log/2026-10-10-2327-schema-diagram-zoom-lod.md](change-log/2026-10-10-2327-schema-diagram-zoom-lod.md).

### Removed

- SQL Lab schema diagram "View Details" dialog, replaced by the in-place fullscreen toggle. See [change-log/2026-10-10-2227-schema-diagram-performance-readability.md](change-log/2026-10-10-2227-schema-diagram-performance-readability.md).
