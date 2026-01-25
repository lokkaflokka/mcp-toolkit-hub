# Roadmap

Hub orchestrator for personal MCP packages.

## Current: v0.1.0 (POC)

- [x] Basic hub routing
- [x] Config-based package registration
- [x] Namespace prefixing for tools
- [x] `orchestrator_status` tool
- [x] Graceful degradation when packages not built
- [x] Test coverage (config, routing, schema sync)

## Next: v0.2.0 (Stability)

- [ ] Better error messages when domain packages fail
- [ ] Package health check tool (`orchestrator_health`)
- [ ] Config validation on startup with actionable errors

## Future Considerations

- [ ] Hot reload when config changes
- [ ] Dynamic discovery (scan directory for packages)
- [ ] Per-package enable/disable via tool call
- [ ] Metrics/logging for tool call frequency

## Non-Goals

- **Business logic** — Stays in domain packages, not here
- **Package management** — Users install/update packages separately
- **Authentication** — Handled by domain packages individually
