# botz-cli

The TypeScript host for `botz <command> [args]`. Runs on Node.js 22.13+ with no
runtime dependencies. Originally extracted from [botz-mcp](https://github.com/zotoio/botz-mcp).

## Install and discover extensions

```bash
npm install -g @zotoio/botz-cli
botz --version
botz plugins search
botz plugins install mcp-swarm
botz plugins list
botz mcp-swarm --help
```

`botz plugins install` installs the extension into a host-managed directory,
without requiring the extension's global npm/pnpm bin directory on PATH. Only the
core `botz` executable needs to be on PATH. Repeating the command updates to the
latest stable extension version. A failed install preserves the previous one.

```bash
botz plugins info mcp-swarm
botz plugins list --json
botz plugins install mcp-swarm --version 0.5.3
botz plugins install mcp-swarm --version next
```

Search uses the core's bundled catalog of known extensions (currently MCP Swarm).
List reports the core version and each installed extension's version, source, and
executable location. Versions are read from package metadata without running
plugins. Arbitrary PATH executables without npm metadata show `unknown`.

For source development or a version not yet on npm, Git and pnpm are also needed:

```bash
botz plugins install mcp-swarm --source --ref main
```

Source installs run the selected public repository's install/build scripts.
Registry installs disable lifecycle scripts. `--version` accepts an exact SemVer,
`latest`, or `next`; `--ref` accepts a Git tag, branch, or commit with `--source`.
Installs live in `~/.local/share/botz/plugins`, or the directory set by
`BOTZ_PLUGIN_HOME`. An interrupted installer may leave a `.mcp-swarm.lock`
directory: remove it only after confirming no installer is running. A
`.mcp-swarm.previous` directory preserves an installation interrupted during
replacement and must be recovered before installing again.

## Migrating from the Python host

Version 0.2.0 replaces the Python host with TypeScript compiled to JavaScript.
Install the npm package, remove the old pipx installation with
`pipx uninstall botz-cli`, and check `botz --version`. Python is no longer needed
for the core. Python entry-point plugins must expose a `botz-<name>` executable
on PATH instead. Existing managed MCP Swarm installations remain discoverable.

## Extension contract

The core alone owns the `botz` executable. The separately versioned
[botz-mcp-swarm-cli](https://github.com/zotoio/botz-mcp-swarm-cli) package owns
`botz-mcp-swarm` and is invoked with `botz mcp-swarm [args]`.

Managed extensions take precedence over executables named `botz-<name>` on PATH;
otherwise the first executable wins. Empty PATH entries are ignored. Names use
letters, digits, and hyphens, starting with a letter or digit. `serve`, `plugins`,
`help`, and `mcp` are reserved.

The host preserves literal argument boundaries, cwd, environment, and exit
status, and sets `BOTZ_PLUGIN=<name>`. It forwards SIGINT/SIGTERM to the plugin
process group on POSIX. Managed npm JavaScript bins work on Windows, macOS, and
Linux through the current Node executable. Arbitrary Windows batch-file plugins
without resolvable npm package metadata are not supported.

## Optional MCP server

Install `botz-mcp` separately and put its executable on PATH, then use
`botz serve [args]`. The host does not install the server's model dependencies.
`botz serve --help` works without the server; a missing server exits 127.
Unknown commands exit 2 and known uninstalled extensions show an install hint.

## Development and release

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm build
pnpm pack --pack-destination .artifacts
```

CI builds, tests, and installs the packed artifact on Linux, macOS, and Windows
with Node 22.13 and 24. See [RELEASING.md](RELEASING.md) for SemVer releases and
npm trusted publishing.
