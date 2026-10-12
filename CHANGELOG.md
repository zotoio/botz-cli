# Changelog

## 0.2.2

- Compare plugin working directories by real path so tests pass on macOS temporary directories, and cover running from a symlinked directory.

## 0.2.1

- Release through the GitHub npm trusted-publishing workflow after the initial registry bootstrap.
- Bound CI and publishing jobs so stalled installations cannot run indefinitely.

## 0.2.0

- Replace the Python host with a native TypeScript/Node CLI, published as `@zotoio/botz-cli`.
- Add extension search, info, managed install/update, and installed-version reporting.
- Preserve `botz mcp-swarm [args]` and optional `botz serve` dispatch with literal arguments and signal forwarding.
- Build and test packed npm artifacts on Linux, macOS, and Windows; publish SemVer tags through GitHub OIDC.
- Breaking: Python entry-point plugins now need to expose a `botz-<name>` executable on PATH.

## 0.1.0

- Extract the Python `botz` host from botz-mcp into its own public repository.
