"""Host CLI: built-in commands and plugin discovery."""

import os
import stat
import subprocess
import sys

from botz_cli.cli import Plugin, discover_plugins, invoke, main


def _executable(path, body: str) -> None:
    path.write_text(body)
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


def test_reserved_server_script_is_not_a_plugin(tmp_path, monkeypatch):
    _executable(tmp_path / "botz-mcp", "#!/bin/sh\nexit 0\n")
    _executable(tmp_path / "botz-mcp-swarm", "#!/bin/sh\nexit 0\n")
    monkeypatch.delenv("PATH", raising=False)
    plugins = discover_plugins(str(tmp_path))
    assert set(plugins) == {"mcp-swarm"}
    assert plugins["mcp-swarm"].kind == "path"
    assert plugins["mcp-swarm"].executable.endswith("botz-mcp-swarm")


def test_first_path_entry_wins(tmp_path):
    first = tmp_path / "first"
    second = tmp_path / "second"
    first.mkdir()
    second.mkdir()
    _executable(first / "botz-demo", "#!/bin/sh\n")
    _executable(second / "botz-demo", "#!/bin/sh\n")
    plugins = discover_plugins(os.pathsep.join((str(first), str(second))))
    assert plugins["demo"].executable == str(first / "botz-demo")


def test_entry_point_overrides_path_plugin(tmp_path, monkeypatch):
    _executable(tmp_path / "botz-hello", "#!/bin/sh\n")

    def hello(argv):
        return 0

    hello.botz_help = "say hello"

    class _EP:
        name = "hello"
        value = "pkg:hello"

        @staticmethod
        def load():
            return hello

    monkeypatch.setattr(
        "botz_cli.cli.entry_points",
        lambda group: [_EP()] if group == "botz.plugins" else [],
    )
    plugins = discover_plugins(str(tmp_path))
    assert plugins["hello"].kind == "entry-point"
    assert plugins["hello"].help == "say hello"


def test_entry_point_plugin_runs_in_process(monkeypatch):
    seen = {}

    def hello(argv):
        seen["argv"] = argv
        return 3

    hello.botz_help = "say hello"

    class _EP:
        name = "hello"
        value = "pkg:hello"

        @staticmethod
        def load():
            return hello

    monkeypatch.setattr(
        "botz_cli.cli.entry_points",
        lambda group: [_EP()] if group == "botz.plugins" else [],
    )
    monkeypatch.setattr("botz_cli.cli.discover_path_plugins", lambda path=None: {})
    assert main(["hello", "--loud"]) == 3
    assert seen["argv"] == ["--loud"]


def test_unknown_command_exits_2(monkeypatch, capsys):
    monkeypatch.setattr("botz_cli.cli.discover_plugins", lambda path=None: {})
    assert main(["nope"]) == 2
    err = capsys.readouterr().err
    assert "unknown command" in err


def test_plugins_command_lists_path_plugin(tmp_path, monkeypatch, capsys):
    _executable(tmp_path / "botz-mcp-swarm", "#!/bin/sh\n")
    monkeypatch.setattr(
        "botz_cli.cli.discover_plugins",
        lambda path=None: discover_plugins(str(tmp_path)),
    )
    assert main(["plugins"]) == 0
    out = capsys.readouterr().out
    assert "mcp-swarm" in out
    assert "path" in out


def test_help_lists_plugin(tmp_path, monkeypatch, capsys):
    _executable(tmp_path / "botz-mcp-swarm", "#!/bin/sh\n")
    monkeypatch.setattr(
        "botz_cli.cli.discover_plugins",
        lambda path=None: discover_plugins(str(tmp_path)),
    )
    assert main(["--help"]) == 0
    out = capsys.readouterr().out
    assert "botz mcp-swarm" not in out
    assert "mcp-swarm" in out
    assert "serve" in out


def test_path_plugin_replaces_process(tmp_path):
    out = tmp_path / "out"
    plugin = tmp_path / "botz-mcp-swarm"
    _executable(
        plugin,
        "#!/bin/sh\nprintf '%s\\n' \"$BOTZ_PLUGIN\" \"$@\" > \"$BOTZ_TEST_OUT\"\n",
    )
    env = os.environ.copy()
    env["PATH"] = str(tmp_path)
    env["BOTZ_TEST_OUT"] = str(out)
    completed = subprocess.run(
        [sys.executable, "-m", "botz_cli.cli", "mcp-swarm", "run", "--manifest", "x"],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
    assert out.read_text().splitlines() == ["mcp-swarm", "run", "--manifest", "x"]


def test_invoke_entry_point_system_exit():
    def boom(argv):
        raise SystemExit(4)

    plugin = Plugin(name="boom", kind="entry-point", target="pkg:boom", help="boom", run=boom)
    assert invoke(plugin, []) == 4


def test_serve_does_not_require_server_for_help(monkeypatch, capsys):
    monkeypatch.setattr("botz_cli.cli.shutil.which", lambda name: None)
    assert main(["serve", "--help"]) == 0
    assert "botz serve" in capsys.readouterr().out
    assert main(["serve"]) == 127
    assert "install botz-mcp separately" in capsys.readouterr().err


def test_serve_launches_separate_server(tmp_path):
    server = tmp_path / "botz-mcp"
    _executable(server, "#!/bin/sh\nprintf 'server-started\\n'\nexit 7\n")
    result = subprocess.run(
        [sys.executable, "-m", "botz_cli", "serve"],
        env={**os.environ, "PATH": str(tmp_path)},
        capture_output=True, text=True, check=False,
    )
    assert result.returncode == 7
    assert result.stdout == "server-started\n"


def test_plugin_arguments_environment_and_status(tmp_path):
    plugin = tmp_path / "botz-demo"
    _executable(plugin, '#!/bin/sh\nprintf "%s\\n" "$BOTZ_PLUGIN" "$@"\nexit 9\n')
    result = subprocess.run(
        [sys.executable, "-m", "botz_cli", "demo", "two words", "literal;$stuff", ""],
        env={**os.environ, "PATH": str(tmp_path)},
        cwd=tmp_path, capture_output=True, text=True, check=False,
    )
    assert result.returncode == 9
    assert result.stdout.splitlines() == ["demo", "two words", "literal;$stuff", ""]


def test_version_does_not_load_plugins(monkeypatch, capsys):
    def unexpected():
        raise AssertionError("version must not load plugins")
    monkeypatch.setattr("botz_cli.cli.discover_plugins", unexpected)
    assert main(["--version"]) == 0
    assert capsys.readouterr().out.strip() == "0.1.0"


def test_missing_executable_is_reported(capsys):
    plugin = Plugin(name="gone", kind="path", target="gone", help="gone",
                    executable="/nonexistent-botz-plugin")
    assert invoke(plugin, []) == 127
    assert "cannot execute" in capsys.readouterr().err


def test_serve_rejects_arguments(monkeypatch):
    def unexpected():
        raise AssertionError("invalid serve invocation must not start a server")
    monkeypatch.setattr("botz_cli.cli._serve", unexpected)
    assert main(["serve", "unexpected"]) == 2
