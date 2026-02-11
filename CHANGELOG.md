# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-02-10

### Added

- **`briefing_save_for_later` tool** — Delegates to content-feed package's `appendSavedItem()` for saving URLs
- **`briefing_import_read_later` tool** — Imports URLs from Apple Reminders "Read Later" list via `remindctl`, appends to saved-items state. Platform-specific tool kept in toolkit-hub (not in distributed package).
- Saved items count displayed in `briefing_content_feed_status`

### Changed

- **Renamed tool prefix** from `newsletter_` to `briefing_` — All delegated content-feed tools now use `briefing_` namespace
- **Config key migration** — Supports both `briefing` and legacy `newsletter` config keys for backwards compatibility
- Module loading updated: `newsletterModules` → `briefingModules`, with expanded interface for saved item state functions

## [0.4.0] - 2026-02-05

### Added

- **`orchestrator_health` tool** — Aggregates health across hub: config status, per-package load status with validation details, delegated health checks from domain packages. Returns structured JSON with overall status (ready/degraded/unhealthy).
- **Config validation on startup** — Checks each enabled package: path exists, `dist/` exists, entry point exists. Surfaces actionable errors ("Package not built? Run `npm run build` in [path]").
- **Actionable load error messages** — Newsletter module load failures now provide specific guidance (not built, not found, or raw error) instead of generic stack traces. Errors surfaced in both `orchestrator_status` and `orchestrator_health`.

### Changed

- Package paths now read from config instead of hardcoded `NEWSLETTER_PACKAGE` constant
- `orchestrator_status` now shows config errors and per-package load errors
- Server name updated from `personal-orchestrator` to `mcp-toolkit-hub`

## [0.3.0] - 2026-02-02

### Changed

- **Renamed from mcp-personal to mcp-toolkit-hub** — "personal" in a public repo name sent a mixed signal. Updated: package name, config path (`~/.config/mcp-toolkit-hub/`), docs, tests, examples, GitHub repo.
- Bumped MCP SDK minimum from ^1.0.0 to ^1.18.0 (aligns declared minimum with actual API usage)

## [0.2.0] - 2026-02-02

### Added

- Distributable packaging (proper entry point, build config)
- Vitest test suite for orchestrator tool registration
- Health check tool delegating to newsletter package
- README.md and ROADMAP.md documentation

### Changed

- Delegated digest logic to newsletter package (eliminated duplicated code)
- Delegated health check to newsletter package (eliminated last duplication)

## [0.1.0] - 2026-01-19

### Added

- Initial release
- Toolkit hub aggregating domain package tools
- Newsletter digest and RSS digest tool wrappers
- Content feed status tool
- YAML-based configuration
