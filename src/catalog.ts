export interface Extension {
  name: string;
  description: string;
  package: string;
  executable: string;
  repository: string;
}
export const catalog: Readonly<Record<string, Extension>> = Object.freeze(Object.assign(Object.create(null) as Record<string, Extension>, {
  'mcp-swarm': {
    name: 'mcp-swarm', description: 'MCP load testing, saved suites, and workers',
    package: '@zotoio/botz-mcp-swarm-cli', executable: 'botz-mcp-swarm',
    repository: 'https://github.com/zotoio/botz-mcp-swarm-cli.git',
  },
}));
export const reserved = new Set(['serve', 'plugins', 'help', 'mcp']);
export function validName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(name) && !reserved.has(name);
}
