# CLAUDE.md

```yaml
_context:
  tier: distributable  # MCP package for others to use
  version: 0.5.0
  last_updated: 2026-02-10
```

MCP hub server that aggregates tools from multiple domain packages into a single globally-available interface.

## Purpose

This package provides a **hub** that exposes tools from multiple domain packages (content-feed, travel, etc.) through a single MCP server. When configured at the user level, tools work globally regardless of which directory Claude Code is started from.

**Why a hub?** Without it, each MCP package needs separate configuration, and tools only work in specific project directories. The hub pattern gives you one config, global availability.

## Architecture

```
User Config (~/.config/mcp-toolkit-hub/config.yaml)
         ↓
   mcp-toolkit-hub (this package)
         ↓
   Domain Packages (mcp-content-feed, mcp-travel, etc.)
```

## Key Constraints

- **Distributable** — Generic orchestration logic; user config is personal
- **Delegates, doesn't duplicate** — Business logic stays in domain packages. This package only routes.
- **Namespaced tools** — Tools are prefixed with package name: `briefing_run_weekly_digest` (underscores, not colons — MCP spec limitation)

## Defensive Coding Standards

This package loads and delegates to other packages — it's the trust boundary between user config, domain packages, and LLM-generated tool calls. Apply defensive thinking to all code changes.

### Security-Sensitive Areas

**Config Loading** (`src/lib/config.ts`)
- Config is YAML from user files — may be hand-edited, malformed, or missing
- Validate structure with Zod schema: actionable error messages for every validation failure
- Handle missing config file: clear error with path ("Config not found at [path]. Create from example at [example path]")
- Handle malformed YAML: surface parse error with line number if possible
- Validate `schema_version` field — future-proof against config format changes

**Path Expansion** (`src/lib/config.ts`)
- Package paths come from user config and use tilde (`~`) expansion
- Validate expanded paths: directory exists, is absolute, doesn't traverse outside expected locations
- Never use user-supplied paths in `require()` or `import()` without validation
- Directory traversal risk: `../../etc/passwd` in a path field should be caught and rejected

**Package Delegation** (`src/server/tools.ts`)
- Validate package exports exist before calling — a missing export shouldn't crash the hub
- Handle package load failures gracefully: log the error, mark package as unavailable, continue serving other packages
- Surface actionable error messages: "Package 'briefing' failed to load: dist/ not found. Run `npm run build` in [path]"
- Never catch and swallow errors silently — at minimum surface in `orchestrator_status`

**Tool Parameter Passthrough** (`src/server/tools.ts`)
- All tool parameters come from LLM output — treat as untrusted
- Validate parameter types and bounds before forwarding to domain packages
- Don't blindly pass through objects — validate expected shape
- Bound numeric parameters (e.g., `days_back`: 1-30, `max_items`: 1-30)

**Orchestrator Status** (`src/server/tools.ts`)
- Status tool must never expose sensitive config values (paths with usernames, credentials)
- Report package health without leaking internal details
- Include load errors so users can diagnose issues

### Pre-Commit Checklist

Before any commit, ask these 4 questions:
1. **Data leak?** Could this change expose personal config paths, package internals, or user data?
2. **Crash path?** Could a missing package, bad config, or malformed tool call crash the hub?
3. **Actionable errors?** Are all error messages helpful without exposing sensitive details?
4. **Credential trust?** Would I run this code routing to my own packages with my own data?

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
  briefing:
    path: ~/path/to/mcp-content-feed  # Your local path
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

## Key Files for Common Tasks

| Task | Primary File | Notes |
|------|--------------|-------|
| Add domain package support | `src/server/tools.ts` | Register tools with MCP server |
| Config schema changes | `src/lib/config.ts` | Zod schema with defaults |
| Add orchestrator tool | `src/server/tools.ts` | Orchestrator-level tools (status, health) |
| Package loading logic | `src/server/tools.ts` | Dynamic import + error handling |

## Common Mistakes

- **Don't duplicate domain logic** — The hub delegates to packages. If you find yourself reimplementing scoring, state management, or domain rules here, stop and put it in the domain package.
- **Don't swallow load errors** — Every package load failure must be surfaced somewhere (status tool, logs). Silent failures make debugging impossible.
- **Don't hardcode package paths** — Always read from config. The `NEWSLETTER_PACKAGE` constant pattern should be replaced with config-driven paths.
- **Don't forget to rebuild** — After committing source changes, run `npm run build`. The MCP server runs from `dist/`, not `src/`.
