# Roadmap

Hub orchestrator for personal MCP packages.

## Current: v0.2.0 (Stable)

- [x] Basic hub routing
- [x] Config-based package registration
- [x] Namespace prefixing for tools
- [x] `orchestrator_status` tool
- [x] Graceful degradation when packages not built
- [x] Test coverage (config, routing, schema sync)
- [x] Distributable packaging (proper entry point, build config)
- [x] Health check tool delegating to newsletter package
- [x] Delegated digest logic to newsletter package (eliminated duplication)
- [x] README.md and ROADMAP.md documentation

## Next: v0.3.0 (Robustness)

- [ ] Better error messages when domain packages fail to load
- [ ] Config validation on startup with actionable errors
- [ ] Package health check tool (`orchestrator_health`) — aggregate health from all registered packages

## Future Considerations

- [ ] Hot reload when config changes
- [ ] Dynamic discovery (scan directory for packages)
- [ ] Per-package enable/disable via tool call
- [ ] Metrics/logging for tool call frequency
- [ ] Rename: "mcp-toolkit-hub" → TBD (see below)

## Rename Discussion

The repo is public but the name "mcp-toolkit-hub" sends a mixed signal — it's a generic orchestrator pattern, not personal-data-specific. Rename candidates:

- `mcp-orchestrator` — clear role, but generic (many orchestrators exist)
- `mcp-hub` — short, describes the aggregation pattern
- `mcp-toolkit-hub` — more specific

**Decision:** Deferred until distribution architecture pass. The rename touches: GitHub repo, package.json name, PROJECTS.md registry, Claude Code MCP config, orchestrator config path (`~/.config/mcp-toolkit-hub/`). Do it once, do it right.

## Non-Goals

- **Business logic** — Stays in domain packages, not here
- **Package management** — Users install/update packages separately
- **Authentication** — Handled by domain packages individually
