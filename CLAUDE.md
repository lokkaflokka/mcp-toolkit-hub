# CLAUDE.md

```yaml
_context:
  tier: distributable  # MCP package for others to use
  version: 0.1.0
  last_updated: 2026-01-19
```

MCP hub server that aggregates tools from multiple domain packages into a single globally-available interface.

## Purpose

This package provides a **hub** that exposes tools from multiple domain packages (newsletter-review, travel, etc.) through a single MCP server. When configured at the user level, tools work globally regardless of which directory Claude Code is started from.

**Why a hub?** Without it, each MCP package needs separate configuration, and tools only work in specific project directories. The hub pattern gives you one config, global availability.

## Architecture

```
User Config (~/.config/mcp-toolkit-hub/config.yaml)
         ↓
   mcp-toolkit-hub (this package)
         ↓
   Domain Packages (mcp-newsletter-review, mcp-travel, etc.)
```

## Key Constraints

- **Distributable** — Generic orchestration logic; user config is personal
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

User config at `~/.config/mcp-toolkit-hub/config.yaml`:

```yaml
schema_version: "1.0"
packages:
  newsletter:
    path: ~/path/to/mcp-newsletter-review  # Your local path
    enabled: true
  travel:
    path: ~/path/to/mcp-travel
    enabled: false
```

See `examples/config.example.yaml` for a full template.

## Adding to Claude Code

Configure at user level via `/mcp` command:
- Command: `node`
- Args: `/path/to/mcp-toolkit-hub/dist/server/index.js`

Or via CLI:
```bash
claude mcp add -s user personal node /path/to/mcp-toolkit-hub/dist/server/index.js
```
