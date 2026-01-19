# CLAUDE.md

```yaml
_context:
  tier: personal  # Not distributable - personal orchestration layer
  version: 0.1.0
  last_updated: 2026-01-18
```

Personal orchestrator MCP server that aggregates tools from domain packages.

## Purpose

This package provides a **hub** that exposes tools from multiple domain packages (newsletter-review, travel, etc.) through a single MCP server. When configured at the user level, tools work globally regardless of which directory Claude Code is started from.

## Architecture

```
User Config (~/.config/personal-orchestrator/config.yaml)
         ↓
   mcp-personal (this package)
         ↓
   Domain Packages (mcp-newsletter-review, mcp-travel, etc.)
```

## Key Constraints

- **Personal only** — This package is NOT distributable. It lives in `~/mcp_personal_dev/mcp-personal/`, not `mcp-authored/`.
- **Delegates, doesn't duplicate** — Business logic stays in domain packages. This package only routes.
- **Namespaced tools** — Tools are prefixed with package name: `newsletter_run_weekly_digest` (underscores, not colons — MCP spec limitation)

## Development

```bash
npm install
npm run build
npm run dev   # Run with tsx for development
npm test      # Run tests (vitest)
```

## Testing

Tests live in `tests/` and cover:
- **Config loading** — File not found, invalid YAML, schema validation, path expansion
- **Routing** — Tool registration, disabled packages, orchestrator_status always available
- **Schema sync** — Parameter existence, bounds matching with domain packages
- **Integration** — Graceful degradation when packages not built

**Running tests:** `npm test`

**Pre-commit hook:** Runs tests automatically before commits.

## Configuration

User config at `~/.config/personal-orchestrator/config.yaml`:

```yaml
schema_version: "1.0"
packages:
  newsletter:
    path: ~/mcp_personal_dev/mcp-authored/mcp-newsletter-review
    enabled: true
  travel:
    path: ~/mcp_personal_dev/mcp-authored/mcp-travel
    enabled: false  # Not yet integrated
```

## Adding to Claude Code

Configure at user level via `/mcp` command:
- Command: `node`
- Args: `~/mcp_personal_dev/mcp-personal/dist/server/index.js`
