# mcp-personal

MCP hub server that aggregates tools from multiple domain packages into a single globally-available interface.

## Status

**Stage:** POC (Proof of Concept)

## Why a Hub?

Without a hub, each MCP package needs separate configuration, and tools only work in specific project directories. The hub pattern gives you:

- **One config** — Single `config.yaml` lists all your domain packages
- **Global availability** — Tools work regardless of which directory Claude Code starts from
- **Namespace clarity** — Tools prefixed by domain: `newsletter_run_weekly_digest`, `travel_search_flights`

## Architecture

```
User Config (~/.config/mcp-personal/config.yaml)
         ↓
   mcp-personal (this package)
         ↓
   Domain Packages (mcp-newsletter-review, mcp-travel, etc.)
```

## Prerequisites

- Node.js 18+
- One or more domain MCP packages installed locally
- Domain packages built (`npm run build` in each)

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/lokkaflokka/mcp-personal.git
cd mcp-personal
npm install

# 2. Create your config
mkdir -p ~/.config/mcp-personal
cp examples/config.example.yaml ~/.config/mcp-personal/config.yaml
# Edit config.yaml with paths to your domain packages

# 3. Build
npm run build

# 4. Add to Claude Code (user-level for global availability)
claude mcp add -s user personal node /path/to/mcp-personal/dist/server/index.js
```

## Configuration

Edit `~/.config/mcp-personal/config.yaml`:

```yaml
schema_version: "1.0"
packages:
  newsletter:
    path: ~/mcp_personal_dev/mcp-authored/mcp-newsletter-review
    enabled: true
  travel:
    path: ~/mcp_personal_dev/mcp-authored/mcp-travel
    enabled: false  # Disabled packages don't expose tools
```

## Available Tools

The hub exposes tools from enabled domain packages, plus:

| Tool | Description |
|------|-------------|
| `orchestrator_status` | Shows which packages are loaded and available |

Domain package tools are namespaced:
- `newsletter_run_weekly_digest`
- `newsletter_run_rss_digest`
- `newsletter_content_feed_status`
- `travel_search_flights` (when enabled)

## Development

```bash
npm install
npm run build
npm run dev    # Run with tsx for development
npm test       # Run tests
```

## Key Constraints

- **Distributable** — This package contains generic orchestration logic; personal config stays in `~/.config/`
- **Delegates, doesn't duplicate** — Business logic lives in domain packages. This package only routes.
- **Namespaced tools** — Tools prefixed with package name using underscores (MCP spec disallows colons)

## Related Packages

- [mcp-newsletter-review](https://github.com/lokkaflokka/mcp-newsletter-review) — Newsletter scoring and briefing
- [mcp-travel](https://github.com/lokkaflokka/mcp-travel) — Flight search and price tracking

## License

MIT
