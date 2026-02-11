# mcp-toolkit-hub

MCP hub server that aggregates tools from multiple domain packages into a single globally-available interface.

## Status

**Stage:** POC (Proof of Concept)

## Why a Hub?

Without a hub, each MCP package needs separate configuration, and tools only work in specific project directories. The hub pattern gives you:

- **One config** — Single `config.yaml` lists all your domain packages
- **Global availability** — Tools work regardless of which directory Claude Code starts from
- **Namespace clarity** — Tools prefixed by domain: `briefing_run_weekly_digest`, `travel_search_flights`

## Architecture

```
User Config (~/.config/mcp-toolkit-hub/config.yaml)
         ↓
   mcp-toolkit-hub (this package)
         ↓
   Domain Packages (mcp-content-feed, mcp-travel, etc.)
```

## Prerequisites

- Node.js 18+
- One or more domain MCP packages installed locally
- Domain packages built (`npm run build` in each)

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/lokkaflokka/mcp-toolkit-hub.git
cd mcp-toolkit-hub
npm install

# 2. Create your config
mkdir -p ~/.config/mcp-toolkit-hub
cp examples/config.example.yaml ~/.config/mcp-toolkit-hub/config.yaml
# Edit config.yaml with paths to your domain packages

# 3. Build
npm run build

# 4. Add to Claude Code (user-level for global availability)
claude mcp add -s user personal node /path/to/mcp-toolkit-hub/dist/server/index.js
```

## Configuration

Edit `~/.config/mcp-toolkit-hub/config.yaml`:

```yaml
schema_version: "1.0"
packages:
  briefing:
    path: ~/mcp_personal_dev/mcp-authored/mcp-content-feed
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
- `briefing_run_weekly_digest`
- `briefing_run_rss_digest`
- `briefing_content_feed_status`
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

- [mcp-content-feed](https://github.com/lokkaflokka/mcp-content-feed) — Content scoring and briefing (Gmail + RSS + saved URLs)
- [mcp-travel](https://github.com/lokkaflokka/mcp-travel) — Flight search and price tracking

## License

MIT
