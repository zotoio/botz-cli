import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';
import { catalog, validName } from './catalog.js';
import { executable, type Command } from './process.js';

export interface Plugin { name: string; version: string; source: 'managed' | 'PATH'; path: string; command: Command }
export function pluginHome(): string {
  return resolve(process.env.BOTZ_PLUGIN_HOME || join(homedir(), '.local/share/botz/plugins'));
}
export function packagePlugin(root: string, name: string, source: Plugin['source']): Plugin | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[`botz-${name}`];
    if (typeof bin !== 'string' || typeof pkg.version !== 'string') return;
    const target = realpathSync(resolve(root, bin));
    const rel = relative(realpathSync(root), target);
    if (rel.startsWith('..') || isAbsolute(rel)) return;
    // npm launchers are JavaScript; execute them with the host Node on all OSes.
    if (!/\.(?:[cm]?js)$/.test(target)) return;
    return { name, version: pkg.version, source, path: target,
      command: { executable: process.execPath, args: [target] } };
  } catch { return; }
}
export function managedPlugin(name: string, home = pluginHome()): Plugin | undefined {
  const extension = catalog[name];
  if (!extension) return;
  return packagePlugin(join(home, name, 'runtime/node_modules', extension.package), name, 'managed');
}
export function discover(home = pluginHome(), path = process.env.PATH ?? ''): Plugin[] {
  const plugins = new Map<string, Plugin>();
  for (const name of Object.keys(catalog)) {
    const plugin = managedPlugin(name, home);
    if (plugin) plugins.set(name, plugin);
  }
  for (const dir of path.split(delimiter).filter(Boolean)) {
    let names: string[];
    try { names = readdirSync(dir).sort(); } catch { continue; }
    for (const file of names) {
      if (!file.startsWith('botz-')) continue;
      const name = file.slice(5).replace(process.platform === 'win32' ? /\.(exe|cmd|bat|com)$/i : /$^/, '');
      const binary = resolve(dir, file);
      if (!validName(name) || plugins.has(name) || !executable(binary)) continue;
      let root: string;
      try { root = dirname(realpathSync(binary)); } catch { continue; }
      let plugin: Plugin | undefined;
      for (let depth = 0; depth < 5; depth++, root = dirname(root)) {
        plugin = packagePlugin(root, name, 'PATH');
        if (plugin) break;
      }
      const known = catalog[name];
      if (!plugin && known) {
        for (const prefix of [join(dir, 'node_modules'), join(dir, '../lib/node_modules')]) {
          plugin = packagePlugin(join(prefix, known.package), name, 'PATH');
          if (plugin) break;
        }
      }
      if (!plugin && !/\.(cmd|bat)$/i.test(binary)) {
        plugin = { name, version: 'unknown', source: 'PATH', path: binary,
          command: { executable: binary, args: [] } };
      }
      if (plugin) plugins.set(name, plugin);
    }
  }
  return [...plugins.values()].sort((a, b) => a.name.localeCompare(b.name));
}
