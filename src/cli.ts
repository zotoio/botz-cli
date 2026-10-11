#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { catalog } from './catalog.js';
import { discover } from './plugins.js';
import { install, parseInstall } from './install.js';
import { CommandError, forward, which } from './process.js';
const version: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const help = `botz ${version}\nUsage: botz <command> [args]\n\nCommands:\n  plugins search [query] [--json]   Discover available extensions\n  plugins install <name>           Install or update an extension from npm\n    [--version <version|latest|next>]\n    [--source [--ref <tag|commit>]] Build from its public repository\n  plugins list [--json]            Show installed versions and locations\n  plugins info <name> [--json]     Show catalog and installed details\n  serve [args]                    Run the separately installed botz-mcp server\n  --version                       Show the core version\n\nExample:\n  botz plugins install mcp-swarm\n  botz mcp-swarm --help`;
async function main(args: string[]): Promise<number> {
  const command = args.shift();
  if (!command || ['--help', '-h', 'help'].includes(command)) { console.log(help); return 0; }
  if (command === '--version' || command === '-V') { console.log(version); return 0; }
  if (command === 'plugins') {
    const action = args.shift() ?? 'list';
    if (action === '--help' || action === '-h') { console.log(help); return 0; }
    if (action === 'install') {
      const name = args.shift();
      if (!name) throw new Error('Usage: botz plugins install <name> [--version <version>] [--source [--ref <ref>]]');
      install(name, parseInstall(args)); return 0;
    }
    const json = args.includes('--json');
    args = args.filter(arg => arg !== '--json');
    const plugins = discover();
    if (action === 'list') {
      if (args.length) throw new Error('Usage: botz plugins list [--json]');
      const records = plugins.map(({ command: _command, ...plugin }) => plugin);
      if (json) console.log(JSON.stringify({ core: { name: '@zotoio/botz-cli', version }, plugins: records }, null, 2));
      else { console.log(`botz ${version}`); for (const p of records) console.log(`${p.name}\t${p.version}\t${p.source}\t${p.path}`);
        if (!records.length) console.log('No installed extensions. Run: botz plugins search'); }
      return 0;
    }
    if (action === 'search' || action === 'info') {
      if (args.length > 1 || args[0]?.startsWith('-')) throw new Error(`Usage: botz plugins ${action} ${action === 'info' ? '<name>' : '[query]'} [--json]`);
      const query = args[0] ?? '';
      const matches = Object.values(catalog).filter(e => action === 'info' ? e.name === query : `${e.name} ${e.description}`.toLowerCase().includes(query.toLowerCase()));
      if (action === 'info' && !matches.length) throw new Error(`Unknown extension '${query}'`);
      const records = matches.map(e => ({ ...e, installedVersion: plugins.find(p => p.name === e.name)?.version ?? null }));
      if (json) console.log(JSON.stringify(records, null, 2));
      else for (const e of records) console.log(`${e.name}\t${e.description}\n  Package: ${e.package}\n  Installed: ${e.installedVersion ?? 'not installed'}\n  Install: botz plugins install ${e.name}\n  Source: ${e.repository}`);
      return 0;
    }
    throw new Error(`Unknown plugins command '${action}'`);
  }
  if (command === 'serve') {
    if (args.includes('--help') || args.includes('-h')) { console.log('Usage: botz serve [args]\nRuns the separately installed botz-mcp server on PATH.'); return 0; }
    const server = which('botz-mcp');
    if (!server) { console.error('botz: install botz-mcp separately and put its executable on PATH to use serve'); return 127; }
    return forward({ executable: server, args: [] }, args);
  }
  const plugin = discover().find(p => p.name === command);
  if (!plugin) {
    console.error(`botz: unknown command '${command}'`);
    console.error(catalog[command] ? `Install it with: botz plugins install ${command}` : 'Run: botz plugins search');
    return 2;
  }
  return forward(plugin.command, args, { ...process.env, BOTZ_PLUGIN: command });
}
try { process.exitCode = await main(process.argv.slice(2)); }
catch (error) {
  console.error(`botz: ${error instanceof Error ? error.message : String(error)}`);
  if (error instanceof CommandError && error.output.trim()) console.error(error.output.trim());
  process.exitCode = 1;
}
