# botz-cli

The lightweight host for `botz <command> [args]`. Python 3.11+, with no runtime
dependencies. Originally extracted from [botz-mcp](https://github.com/zotoio/botz-mcp).

## Install

Install from this public repository until a registry release is available:

```bash
pipx install git+https://github.com/zotoio/botz-cli.git
botz --help
botz --version
```

Alternatively, install with `python -m pip install git+https://github.com/zotoio/botz-cli.git`
inside a virtual environment. Put its `bin` directory on PATH.

## MCP Swarm extension

The [botz-mcp-swarm-cli](https://github.com/zotoio/botz-mcp-swarm-cli) extension
is installed and versioned separately. With Node 22.13+ and pnpm available:

```bash
git clone https://github.com/zotoio/botz-mcp-swarm-cli.git
cd botz-mcp-swarm-cli
pnpm install --frozen-lockfile
pnpm build
pnpm link --global
botz plugins
botz mcp-swarm --help
botz mcp-swarm suite capture --url http://127.0.0.1:3000/mcp --name demo
botz mcp-swarm suite run --suite demo
```

The extension installs `botz-mcp-swarm` on PATH. The host discovers it as
`mcp-swarm`, forwards arguments, and sets `BOTZ_PLUGIN=mcp-swarm`.
No Python package dependency is needed between this host and the Node extension.
The extension must not install its own `botz` executable.

## Optional MCP server

Install `botz-mcp` separately and put its executable on PATH, then run:

```bash
botz serve
```

This executes `botz-mcp` without importing the server or installing its model
dependencies into the host. Without the server executable, `serve` exits 127
with an installation hint. `botz serve --help` works without the server installed.

## Extension contract

Executable plugins are files named `botz-<name>` on PATH. The first executable
with a given name wins. Plugin names start with a letter or digit and contain
only letters, digits, and hyphens. Empty PATH entries are ignored.

On Linux and macOS, the host replaces itself with the executable, preserving
argument boundaries, working directory, inherited environment, signals, and exit
status. The original host's POSIX executable behavior is retained; Windows batch
file plugins (`.cmd`/`.bat`) are not currently supported.

Python packages can also register in-process plugins:

```toml
[project.entry-points."botz.plugins"]
hello = "my_package.cli:main"
```

The callable accepts `argv: list[str]` and returns an integer exit status.
An optional `botz_help` attribute supplies its help text. Entry-point plugins
override an executable plugin with the same name. They must be installed into
the host's Python environment (with pipx, use `pipx inject botz-cli <package>`).
Malformed entry points are skipped with a warning.

`serve`, `plugins`, `help`, and `mcp` are reserved. The server executable
`botz-mcp` is therefore never mistaken for a plugin. Unknown commands exit 2.

## Development

```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install -e '.[dev]'
ruff check .
pytest
python -m build
```

CI checks the installed wheel and runs the actual MCP Swarm executable through
`botz mcp-swarm`. Only this repo owns and publishes the `botz` command;
`botz-mcp` owns the server and `botz-mcp-swarm-cli` owns the load-testing extension.
