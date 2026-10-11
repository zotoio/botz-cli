import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
const tarball = resolve(process.argv[2]);
const root = mkdtempSync(join(tmpdir(), 'botz-consumer-'));
const npm = process.platform === 'win32'
  ? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
  : join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', cwd: root, ...options });
  assert.equal(result.status, 0, result.stderr || result.stdout); return result.stdout;
}
try {
  run(process.execPath, [npm, 'install', '--prefix', root, '--ignore-scripts', '--no-audit', '--no-fund', tarball]);
  const pkg = join(root, 'node_modules/@zotoio/botz-cli');
  const manifest = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.bin, { botz: './dist/cli.js' });
  assert.ok(!readdirSync(pkg).includes('src'));
  assert.ok(readdirSync(join(pkg, 'dist')).every(file => file.endsWith('.js')), 'Only compiled JavaScript may be shipped');
  assert.ok(!manifest.dependencies);
  const entry = join(pkg, manifest.bin.botz);
  const home = join(root, 'plugins');
  const env = { ...process.env, BOTZ_PLUGIN_HOME: home };
  assert.equal(run(process.execPath, [entry, '--version'], { env }).trim(), manifest.version);
  assert.match(run(process.execPath, [entry, '--help'], { env }), /plugins install/);
  const p = join(home, 'mcp-swarm/runtime/node_modules/@zotoio/botz-mcp-swarm-cli');
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, 'package.json'), JSON.stringify({version:'1.2.3', bin:{'botz-mcp-swarm':'cli.cjs'}}));
  writeFileSync(join(p, 'cli.cjs'), 'console.log(JSON.stringify({args:process.argv.slice(2),name:process.env.BOTZ_PLUGIN}))');
  const args = ['a b', '"quoted"', '& echo never', '$(touch never)'];
  assert.deepEqual(JSON.parse(run(process.execPath, [entry, 'mcp-swarm', ...args], {env})), {args,name:'mcp-swarm'});
  console.log(`Installed artifact passed on ${process.platform} ${process.version}`);
} finally { rmSync(root, { recursive: true, force: true }); }
