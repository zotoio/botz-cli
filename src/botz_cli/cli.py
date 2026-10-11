"""Host CLI for botz.

`botz` is the shared command. `botz serve` launches the separately installed
`botz-mcp` server executable. Other tools attach as plugins:

* an executable named `botz-<name>` on `PATH` becomes `botz <name>`.
  `botz-mcp-swarm` is `botz mcp-swarm`. The host sets `BOTZ_PLUGIN` to the
  plugin name and replaces itself with that executable.
* a `botz.plugins` entry point whose name is the command and whose value is
  `callable(argv: list[str]) -> int`. Optional `botz_help` on the callable is
  the help line. Entry points override a PATH plugin of the same name.

`botz-mcp` is the server script, not a plugin. Names `serve`, `plugins`,
`help`, and `mcp` are reserved.
"""

from __future__ import annotations

import logging
import os
import shutil
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from importlib.metadata import entry_points

from . import __version__

log = logging.getLogger(__name__)

ENTRY_POINT_GROUP = "botz.plugins"
RESERVED = frozenset({"serve", "plugins", "help", "mcp"})
PluginMain = Callable[[list[str]], int]


@dataclass(frozen=True)
class Plugin:
    """One installed CLI plugin."""

    name: str
    kind: str
    target: str
    help: str
    executable: str | None = None
    run: PluginMain | None = None


def _valid_name(name: str) -> bool:
    if not name or name in RESERVED:
        return False
    if not name[0].isalnum():
        return False
    return all(ch.isalnum() or ch == "-" for ch in name)


def discover_path_plugins(path: str | None = None) -> dict[str, Plugin]:
    """First executable `botz-<name>` on PATH wins. Later duplicates are ignored."""
    found: dict[str, Plugin] = {}
    seen: set[str] = set()
    raw = os.environ.get("PATH", "") if path is None else path
    for directory in raw.split(os.pathsep):
        if not directory or directory in seen:
            continue
        seen.add(directory)
        try:
            names = os.listdir(directory)
        except OSError:
            continue
        for filename in sorted(names):
            prefix = "botz-"
            if not filename.startswith(prefix):
                continue
            plugin_name = filename[len(prefix) :]
            if not _valid_name(plugin_name) or plugin_name in found:
                continue
            full = os.path.abspath(os.path.join(directory, filename))
            if not os.path.isfile(full) or not os.access(full, os.X_OK):
                continue
            found[plugin_name] = Plugin(
                name=plugin_name,
                kind="path",
                target=full,
                help=f"plugin ({filename})",
                executable=full,
            )
    return found


def discover_entry_plugins() -> dict[str, Plugin]:
    """Load `botz.plugins` entry points. Malformed metadata is skipped."""
    found: dict[str, Plugin] = {}
    try:
        eps = entry_points(group=ENTRY_POINT_GROUP)
    except Exception as exc:
        log.warning("plugin entry-point discovery failed: %s", exc)
        return found
    for ep in eps:
        if not _valid_name(ep.name):
            continue
        try:
            loaded = ep.load()
        except Exception as exc:
            log.warning("plugin entry point %s failed to load: %s", ep.name, exc)
            continue
        if not callable(loaded):
            log.warning("plugin entry point %s is not callable", ep.name)
            continue
        help_text = getattr(loaded, "botz_help", None)
        found[ep.name] = Plugin(
            name=ep.name,
            kind="entry-point",
            target=str(ep.value),
            help=help_text if isinstance(help_text, str) and help_text else "plugin",
            run=loaded,
        )
    return found


def discover_plugins(path: str | None = None) -> dict[str, Plugin]:
    """PATH plugins, then entry points (entry points win on a name clash)."""
    plugins = discover_path_plugins(path)
    plugins.update(discover_entry_plugins())
    return plugins


def _serve() -> int:
    executable = shutil.which("botz-mcp")
    if not executable:
        print(
            "botz: install botz-mcp separately and put botz-mcp on PATH to use serve",
            file=sys.stderr,
        )
        return 127
    return _exec(executable, [], os.environ.copy())


def _exec(executable: str, args: list[str], env: dict[str, str]) -> int:
    try:
        os.execvpe(executable, [executable, *args], env)  # noqa: S606
    except OSError as exc:
        print(f"botz: cannot execute {executable}: {exc.strerror}", file=sys.stderr)
        return 127 if isinstance(exc, FileNotFoundError) else 126
    return 1  # execvpe does not return


def invoke(plugin: Plugin, argv: Sequence[str]) -> int:
    """Run a plugin. A PATH plugin replaces this process."""
    args = list(argv)
    if plugin.run is not None:
        try:
            result = plugin.run(args)
        except SystemExit as exc:
            code = exc.code
            if code is None or code == 0:
                return 0
            return code if isinstance(code, int) else 1
        return int(result or 0)
    if not plugin.executable:
        print(f"botz: plugin {plugin.name} has no executable", file=sys.stderr)
        return 1
    env = os.environ.copy()
    env["BOTZ_PLUGIN"] = plugin.name
    # Absolute path of an installed botz-* executable. Replacing this process
    # keeps the plugin's exit code and signals. No shell is involved.
    return _exec(plugin.executable, args, env)


def _print_plugins(plugins: dict[str, Plugin]) -> None:
    if not plugins:
        print("No plugins installed.")
        print("Add an executable named botz-<name> on PATH, or a botz.plugins entry point.")
        return
    width = max(len(name) for name in plugins)
    for name in sorted(plugins):
        plugin = plugins[name]
        print(f"{name:<{width}}  {plugin.kind:<12}  {plugin.target}")


def _print_help(plugins: dict[str, Plugin]) -> None:
    print("usage: botz <command> [args]")
    print()
    print("Commands:")
    print("  serve      Run the separately installed botz-mcp server")
    print("  --version  Show the host version")
    print("  plugins    List installed CLI plugins")
    if plugins:
        print()
        print("Plugins:")
        width = max(len(name) for name in plugins)
        for name in sorted(plugins):
            print(f"  {name:<{width}}  {plugins[name].help}")


def main(argv: Sequence[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if args == ["--version"]:
        print(__version__)
        return 0
    plugins = discover_plugins()
    if not args or args[0] in {"-h", "--help", "help"}:
        _print_help(plugins)
        return 0
    command, rest = args[0], args[1:]
    if command == "plugins":
        _print_plugins(plugins)
        return 0
    if command == "serve":
        if rest and rest[0] in {"-h", "--help"}:
            print("usage: botz serve")
            print("Run the botz-mcp HTTP server (same process as the botz-mcp script).")
            return 0
        if rest:
            print(f"botz: serve takes no arguments, got {rest[0]!r}", file=sys.stderr)
            return 2
        return _serve()
    plugin = plugins.get(command)
    if plugin is None:
        print(f"botz: unknown command {command!r}", file=sys.stderr)
        _print_help(plugins)
        return 2
    return invoke(plugin, rest)


if __name__ == "__main__":
    raise SystemExit(main())
