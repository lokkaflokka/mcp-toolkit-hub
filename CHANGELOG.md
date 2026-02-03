# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
