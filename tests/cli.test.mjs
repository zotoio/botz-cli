import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { discover, packagePlugin } from '../dist/plugins.js';
import { transaction, parseInstall } from '../dist/install.js';
const coreVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
function fixture(t) {
  // macOS temporary paths can use /var while child processes report /private/var.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'botz-test-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function invoke(args, root, extra = {}) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: root,
    env: { ...process.env, PATH: '', BOTZ_PLUGIN_HOME: root, ...extra } });
}
function plugin(root, name = 'mcp-swarm', body = "console.log('0.5.3')") {
  const pkg = join(root, name, 'runtime/node_modules/@zotoio/botz-mcp-swarm-cli');
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@zotoio/botz-mcp-swarm-cli', version: '0.5.3', type: 'module', bin: { 'botz-mcp-swarm': './cli.js' } }));
  writeFileSync(join(pkg, 'cli.js'), body);
  return pkg;
}
test('help and core version work with no plugins or Python', t => {
  const root = fixture(t);
  assert.match(invoke(['--help'], root).stdout, /plugins install/);
  assert.equal(invoke(['--version'], root).stdout.trim(), coreVersion);
  assert.equal(invoke(['serve'], root).status, 127);
  assert.equal(invoke(['serve', '--help'], root).status, 0);
  assert.equal(invoke(['mcp-swarm'], root).status, 2);
  assert.match(invoke(['mcp-swarm'], root).stderr, /botz plugins install mcp-swarm/);
});
test('catalog search, info and JSON list report actual installed metadata without executing plugins', t => {
  const root = fixture(t);
  const marker = join(root, 'executed');
  plugin(root, 'mcp-swarm', `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'bad');`);
  const list = JSON.parse(invoke(['plugins', 'list', '--json'], root).stdout);
  assert.equal(list.core.version, coreVersion);
  assert.equal(list.plugins[0].version, '0.5.3');
  assert.equal(list.plugins[0].source, 'managed');
  assert.equal(existsSync(marker), false);
  const info = JSON.parse(invoke(['plugins', 'info', 'mcp-swarm', '--json'], root).stdout);
  assert.equal(info[0].installedVersion, '0.5.3');
  assert.equal(JSON.parse(invoke(['plugins', 'search', 'swarm', '--json'], root).stdout).length, 1);
  assert.notEqual(invoke(['plugins', 'install', 'unknown'], root).status, 0);
});
for (const linked of [false, true]) test(`forwards literal arguments, cwd, environment and nonzero exit without a shell${linked ? ' through a symlink' : ''}`, t => {
  const base = fixture(t);
  const root = linked ? join(base, 'linked') : base;
  if (linked) symlinkSync(base, root, process.platform === 'win32' ? 'junction' : 'dir');
  plugin(root, 'mcp-swarm', `console.log(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),plugin:process.env.BOTZ_PLUGIN,custom:process.env.BOTZ_TEST})); process.exitCode=23;`);
  const args = ['space separated', '$(touch bad)', ';echo bad', '"quoted"', '--help'];
  const result = invoke(['mcp-swarm', ...args], root, { BOTZ_TEST: 'inherited' });
  assert.equal(result.status, 23, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { args, cwd: realpathSync(root), plugin: 'mcp-swarm', custom: 'inherited' });
});
test('managed install wins over PATH; first PATH executable wins and reserved names are excluded', { skip: process.platform === 'win32' }, t => {
  const root = fixture(t);
  const a = join(root, 'a'); const b = join(root, 'b');
  mkdirSync(a); mkdirSync(b);
  for (const dir of [a, b]) for (const name of ['mcp-swarm', 'hello', 'mcp', 'serve']) {
    writeFileSync(join(dir, `botz-${name}`), '#!/bin/sh\nexit 0', { mode: 0o755 });
  }
  mkdirSync(join(a, 'botz-directory'));
  plugin(root);
  const found = discover(root, [a, b].join(delimiter));
  assert.deepEqual(found.map(p => p.name), ['hello', 'mcp-swarm']);
  assert.equal(found[0].path, join(a, 'botz-hello'));
  assert.equal(found[1].source, 'managed');
});
test('package bins cannot escape the installed package', t => {
  const root = fixture(t);
  const pkg = plugin(root);
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ version: '1.0.0', bin: { 'botz-mcp-swarm': '../../escape.js' } }));
  writeFileSync(join(pkg, '../../escape.js'), '');
  assert.equal(packagePlugin(pkg, 'mcp-swarm', 'managed'), undefined);
});
test('failed preparation preserves prior install and clears locks; successful update replaces it', t => {
  const root = fixture(t); const target = join(root, 'mcp-swarm');
  mkdirSync(target); writeFileSync(join(target, 'old'), 'working');
  assert.throws(() => transaction('mcp-swarm', stage => { writeFileSync(join(stage, 'partial'), 'bad'); throw new Error('failed build'); }, root), /failed build/);
  assert.equal(readFileSync(join(target, 'old'), 'utf8'), 'working');
  assert.equal(existsSync(join(root, '.mcp-swarm.lock')), false);
  transaction('mcp-swarm', stage => writeFileSync(join(stage, 'new'), 'ready'), root);
  assert.equal(readFileSync(join(target, 'new'), 'utf8'), 'ready');
  assert.equal(existsSync(join(target, 'old')), false);
});
test('concurrent install refuses lock and leaves it intact', t => {
  const root = fixture(t); mkdirSync(join(root, '.mcp-swarm.lock'));
  assert.throws(() => transaction('mcp-swarm', () => assert.fail('must not prepare'), root), /locked/);
  assert.ok(existsSync(join(root, '.mcp-swarm.lock')));
});
test('install accepts explicit versions and refs; rejects ambiguous or injectable selectors', () => {
  assert.deepEqual(parseInstall(['--version', '1.2.3-rc.1']), { source: false, version: '1.2.3-rc.1' });
  assert.deepEqual(parseInstall(['--source', '--ref', 'v0.5.3']), { source: true, ref: 'v0.5.3' });
  for (const args of [['--version'], ['--ref', 'main'], ['--source', '--version', '1.2.3'], ['--version', '01.2.3'], ['--version', '1.2.3-01'], ['--version', 'file:evil'], ['--source', '--ref', '../evil']]) {
    assert.throws(() => parseInstall(args));
  }
});
test('SIGTERM reaches a running plugin and gives conventional status', { skip: process.platform === 'win32', timeout: 10000 }, async t => {
  const root = fixture(t);
  plugin(root, 'mcp-swarm', `console.log('ready');setInterval(()=>{},1000);`);
  const child = spawn(process.execPath, [cli, 'mcp-swarm'], { env: { ...process.env, BOTZ_PLUGIN_HOME: root }, stdio: ['ignore','pipe','pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); });
  const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({code, signal})));
  child.kill('SIGTERM');
  assert.deepEqual(await exit, {code:143,signal:null});
});
