"""Run against an installed host and MCP Swarm executable on PATH."""
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

host = shutil.which("botz")
assert host, "install the botz-cli wheel first"
assert shutil.which("botz-mcp-swarm"), "install the MCP Swarm extension first"
with tempfile.TemporaryDirectory(prefix="botz-host-") as scratch:
    root = Path(scratch)
    (root / ".git").mkdir()
    # A dependency-free JSON-RPC stdio fixture, so this checks the real extension
    # without requiring botz-mcp, model downloads, credentials, or an HTTP server.
    fixture = root / "fixture.mjs"
    fixture.write_text('''
import { createInterface } from 'node:readline';
const input = createInterface({ input: process.stdin });
input.on('line', line => {
  const req = JSON.parse(line);
  if (req.id === undefined) return;
  let result = {};
  if (req.method === 'initialize') result = {
    protocolVersion: req.params.protocolVersion,
    capabilities: { tools: {} }, serverInfo: { name: 'host-fixture', version: '1' }
  };
  if (req.method === 'tools/list') result = { tools: [{
    name: 'echo', annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { message: { type: 'string' } } }
  }] };
  if (req.method === 'tools/call') result = {
    content: [{ type: 'text', text: String(req.params.arguments.message ?? 'ok') }]
  };
  console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }));
});
''')
    env = {key: value for key, value in os.environ.items()
           if not key.startswith(("SWARM_", "OTEL_", "OPENAI_", "ANTHROPIC_", "TYPESAFE_"))}

    def run(*args, code=0):
        result = subprocess.run([host, *args], cwd=root, env=env,
                                capture_output=True, text=True, timeout=30, check=False)
        assert result.returncode == code, result.stdout + result.stderr
        return result.stdout

    assert "mcp-swarm" in run("plugins")
    assert "Usage: botz mcp-swarm" in run("mcp-swarm", "--help")
    run("mcp-swarm", "suite", "capture", "--command", "node", "--arg", str(fixture),
        "--name", "host-demo")
    report = json.loads(run("mcp-swarm", "suite", "run", "--suite", "host-demo",
                            "--set", "message=hello world", "--format", "json"))
    assert report["verdict"] == "pass", report
    run("mcp-swarm", "unknown-command", code=1)
    print("Host + MCP Swarm smoke passed: discovery, help, capture, run, arguments, exit status.")
