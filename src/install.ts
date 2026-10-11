import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { catalog } from './catalog.js';
import { packagePlugin, pluginHome } from './plugins.js';
import { run, tool } from './process.js';

const numeric = '(?:0|[1-9][0-9]*)';
const identifier = '(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)';
export const semver = new RegExp(`^${numeric}\\.${numeric}\\.${numeric}(?:-${identifier}(?:\\.${identifier})*)?$`);
export interface InstallOptions { source: boolean; version?: string; ref?: string }
export function parseInstall(args: string[]): InstallOptions {
  const options: InstallOptions = { source: false };
  while (args.length) {
    const flag = args.shift();
    if (flag === '--source' && !options.source) options.source = true;
    else if ((flag === '--version' || flag === '--ref') && args[0] && !args[0].startsWith('-')) {
      const key = flag === '--version' ? 'version' : 'ref';
      if (options[key]) throw new Error(`Duplicate ${flag}`);
      options[key] = args.shift();
    } else throw new Error(`Unknown or incomplete install option: ${flag}`);
  }
  if (options.ref && !options.source) throw new Error('--ref requires --source');
  if (options.source && options.version) throw new Error('Use --ref for source installs, --version for npm installs');
  if (options.version && !['latest', 'next'].includes(options.version) && !semver.test(options.version)) {
    throw new Error('--version must be latest, next, or an exact SemVer (without build metadata)');
  }
  if (options.ref && (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(options.ref) || options.ref.includes('..'))) {
    throw new Error('Invalid Git ref');
  }
  return options;
}
// Stage beside the target so replacement stays on one filesystem. A failed build
// or validation cannot remove the currently working extension.
export function transaction(name: string, prepare: (stage: string) => void, home = pluginHome()): void {
  mkdirSync(home, { recursive: true });
  const lock = join(home, `.${name}.lock`);
  try { mkdirSync(lock); } catch { throw new Error(`Installation already locked: ${lock}. Remove this directory only if no installer is running.`); }
  let stage: string | undefined;
  const target = join(home, name);
  const backup = join(home, `.${name}.previous`);
  try {
    stage = mkdtempSync(join(home, `.${name}-`));
    prepare(stage);
    if (existsSync(backup)) throw new Error(`Previous installation needs recovery: ${backup}`);
    if (existsSync(target)) renameSync(target, backup);
    try { renameSync(stage, target); } catch (error) {
      if (existsSync(backup)) renameSync(backup, target);
      throw error;
    }
    rmSync(backup, { recursive: true, force: true });
  } finally {
    if (stage) rmSync(stage, { recursive: true, force: true });
    rmSync(lock, { recursive: true, force: true });
  }
}
export function install(name: string, options: InstallOptions): void {
  const extension = catalog[name];
  if (!extension) throw new Error(`Unknown extension '${name}'. Run botz plugins search.`);
  const npm = tool('npm');
  let installedVersion = "";
  transaction(name, stage => {
    const runtime = join(stage, 'runtime');
    mkdirSync(runtime);
    writeFileSync(join(runtime, 'package.json'), JSON.stringify({ name: `botz-managed-${name}`, private: true }));
    let spec: string;
    let expected: string | undefined;
    let commit: string | undefined;
    if (options.source) {
      const git = tool('git');
      const pnpm = tool('pnpm');
      const source = join(stage, 'source');
      run(git, ['clone', '--quiet', extension.repository, source], stage);
      run(git, ['checkout', '--detach', options.ref ?? 'main'], source);
      commit = run(git, ['rev-parse', 'HEAD'], source, true);
      run(pnpm, ['install', '--frozen-lockfile'], source);
      run(pnpm, ['build'], source);
      const packs = join(stage, 'packs');
      mkdirSync(packs);
      run(pnpm, ['pack', '--pack-destination', packs], source);
      const archives = readdirSync(packs).filter(file => file.endsWith('.tgz'));
      if (archives.length !== 1) throw new Error('Expected one extension tarball');
      spec = resolve(packs, archives[0]);
      expected = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version;
    } else {
      const selected = run(npm, ['view', `${extension.package}@${options.version ?? 'latest'}`, 'version', '--json'], runtime, true);
      expected = JSON.parse(selected);
      if (typeof expected !== 'string' || !semver.test(expected)) throw new Error('Registry did not return an exact SemVer');
      spec = `${extension.package}@${expected}`;
    }
    run(npm, ['install', '--prefix', runtime, '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', spec], stage);
    const plugin = packagePlugin(join(runtime, 'node_modules', extension.package), name, 'managed');
    if (!plugin || plugin.version !== expected) throw new Error('Installed extension metadata does not match the requested version');
    const reported = run(plugin.command, ['--version'], runtime, true);
    if (reported !== expected && !reported.endsWith(` ${expected}`)) throw new Error(`Extension version check failed: ${reported}`);
    writeFileSync(join(stage, 'plugin.json'), JSON.stringify({ name, version: expected, repository: extension.repository,
      source: options.source ? 'git' : 'npm', ref: options.ref, commit }, null, 2) + '\n');
    rmSync(join(stage, 'source'), { recursive: true, force: true });
    rmSync(join(stage, 'packs'), { recursive: true, force: true });
    installedVersion = expected ?? "unknown";
  });
  console.log(`Installed ${name} ${installedVersion}. Run: botz ${name} --help`);
}
