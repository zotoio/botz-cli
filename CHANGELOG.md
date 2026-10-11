# Changelog

## 0.1.0

- Extract the `botz` host and plugin discovery from `botz-mcp`.
- Preserve PATH and `botz.plugins` entry-point extensions, including `botz mcp-swarm`.
- Launch `botz serve` through the separately installed server executable.
- Package the host without MCP server, model, or Node dependencies.
