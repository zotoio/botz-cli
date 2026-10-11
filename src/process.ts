import { accessSync, constants, existsSync, realpathSync, statSync } from 'node:fs';
import { delimiter, dirname, extname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

export interface Command { executable: string; args: string[] }
export function executable(file: string): boolean {
  try { accessSync(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK); return statSync(file).isFile(); }
  catch { return false; }
}
export function which(name: string, path = process.env.PATH ?? ''): string | undefined {
  const extensions = process.platform === 'win32' && !extname(name)
    ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';') : [''];
  for (const dir of path.split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = resolve(dir, name + extension);
      if (executable(candidate)) return candidate;
    }
  }
}
export function tool(name: 'npm' | 'pnpm' | 'git'): Command {
  const binary = which(name);
  if (name === 'npm') {
    const candidates = [
      ...(binary ? [realpathSync(binary)] : []),
      join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
      join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
    ];
    const script = candidates.find(p => p.endsWith('npm-cli.js') && existsSync(p));
    if (script) return { executable: process.execPath, args: [script] };
  }
  if (!binary) throw new Error(`Install ${name} and put it on PATH`);
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(binary)) {
    if (name === 'pnpm') {
      const candidates = [join(dirname(binary), 'node_modules/pnpm/bin/pnpm.cjs'),
        join(dirname(binary), 'node_modules/corepack/dist/pnpm.js')];
      const script = candidates.find(existsSync);
      if (script) return { executable: process.execPath, args: [script] };
    }
    throw new Error(`Cannot execute ${binary} without a shell; install a native ${name} launcher`);
  }
  return { executable: binary, args: [] };
}
export class CommandError extends Error {
  constructor(message: string, public readonly output: string) { super(message); }
}
export function run(command: Command, args: string[], cwd: string, capture = false): string {
  const result = spawnSync(command.executable, [...command.args, ...args], {
    cwd, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit',
    timeout: 600_000, maxBuffer: 8 * 1024 * 1024, shell: false,
  });
  if (result.error || result.status !== 0) {
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    throw new CommandError(`${command.executable} ${args[0] ?? ''} failed: ${
      result.error?.message ?? `exit ${result.status}`}`, output);
  }
  return result.stdout?.trim() ?? '';
}
export async function forward(command: Command, args: string[], env = process.env): Promise<number> {
  // Give POSIX children their own process group so terminal signals are forwarded
  // exactly once, including to descendants. No shell parses user arguments.
  return new Promise((resolveExit) => {
    const child = spawn(command.executable, [...command.args, ...args], {
      stdio: 'inherit', env, shell: false, detached: process.platform !== 'win32',
    });
    const signals = ['SIGINT', 'SIGTERM'] as const;
    const handlers = signals.map(signal => {
      const handler = () => {
        if (!child.pid) return;
        try {
          if (process.platform !== 'win32') process.kill(-child.pid, signal);
          else child.kill(signal);
        } catch { /* Child may have exited before forwarding. */ }
      };
      process.on(signal, handler);
      return [signal, handler] as const;
    });
    const cleanup = () => handlers.forEach(([signal, handler]) => process.off(signal, handler));
    child.once('error', error => {
      cleanup(); console.error(`botz: ${error.message}`);
      resolveExit((error as NodeJS.ErrnoException).code === 'ENOENT' ? 127 : 126);
    });
    child.once('exit', (code, signal) => {
      cleanup();
      if (signal === 'SIGINT') resolveExit(130);
      else if (signal === 'SIGTERM') resolveExit(143);
      else resolveExit(code ?? 1);
    });
  });
}
