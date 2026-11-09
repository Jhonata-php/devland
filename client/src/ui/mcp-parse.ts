// Entende o que a pessoa cola na conversa de Conectores: o comando `claude mcp add`, o JSON de "mcpServers" que as
// documentações mostram, um endereço solto, um comando (npx/uvx/docker) ou o nome de um sugerido.
export interface ParsedConnector { name: string; transport: 'http' | 'sse' | 'stdio'; target: string }
interface Catalog { name: string; title: string; transport: string; target: string }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'conector';

/** Nome a partir do endereço: mcp.notion.com → notion; api.exemplo.dev/mcp → exemplo. */
function nameFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.split('.').filter((p) => !['mcp', 'api', 'www', 'com', 'dev', 'app', 'io', 'net', 'org', 'ai'].includes(p));
    return slug(host[0] ?? 'conector');
  } catch {
    return 'conector';
  }
}

export function parseConnector(text: string, catalog: readonly Catalog[]): ParsedConnector[] {
  const t = text.trim();
  if (!t) return [];
  // JSON: {"mcpServers": {"nome": {"url": ...} | {"command": "npx", "args": [...]}}} ou só o objeto de dentro.
  if (t.startsWith('{')) {
    try {
      const j = JSON.parse(t) as Record<string, unknown>;
      const servers = (j.mcpServers ?? j.servers ?? j) as Record<string, { url?: string; type?: string; command?: string; args?: string[] }>;
      return Object.entries(servers)
        .filter(([, v]) => v && typeof v === 'object' && (v.url || v.command))
        .map(([k, v]) => v.url
          ? { name: slug(k), transport: v.type === 'sse' ? 'sse' : 'http', target: v.url }
          : { name: slug(k), transport: 'stdio', target: [v.command, ...(v.args ?? [])].join(' ') });
    } catch {
      return [];
    }
  }
  // claude mcp add [opções] nome [url | -- comando...]
  const cmd = /^(?:claude\s+)?mcp\s+add\s+(.+)$/s.exec(t);
  if (cmd) {
    const parts = cmd[1]!.split(/\s+/);
    let transport: ParsedConnector['transport'] = 'stdio';
    const rest: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]!;
      if (p === '--') { rest.push('--', ...parts.slice(i + 1)); break; }
      if (p === '--transport' || p === '-t') { transport = parts[++i] === 'sse' ? 'sse' : parts[i] === 'http' ? 'http' : 'stdio'; continue; }
      if (/^--transport=/.test(p)) { const v = p.split('=')[1]; transport = v === 'sse' ? 'sse' : v === 'http' ? 'http' : 'stdio'; continue; }
      if (p === '--scope' || p === '-s' || p === '-e' || p === '--env' || p === '-H' || p === '--header') { i++; continue; }
      if (p.startsWith('-')) continue;
      rest.push(p);
    }
    const name = rest[0];
    if (!name) return [];
    const dash = rest.indexOf('--');
    const target = dash >= 0 ? rest.slice(dash + 1).join(' ') : rest.slice(1).join(' ');
    if (!target) return [];
    if (/^https?:\/\//.test(target) && transport === 'stdio') transport = 'http';
    return [{ name: slug(name), transport, target }];
  }
  // Endereço solto.
  const url = /https?:\/\/\S+/.exec(t)?.[0];
  if (url) return [{ name: nameFromUrl(url), transport: /\/sse\/?$/.test(url) ? 'sse' : 'http', target: url.replace(/[),.;]+$/, '') }];
  // Comando (npx, uvx, docker, node, python).
  if (/^(npx|uvx|docker|node|python3?|bunx|pnpm\s+dlx)\s/.test(t)) {
    const pkg = t.split(/\s+/).find((w, i) => i > 0 && !w.startsWith('-')) ?? 'conector';
    return [{ name: slug(pkg.replace(/^@[^/]+\//, '').replace(/@.*$/, '').replace(/-?mcp-?/, '') || pkg), transport: 'stdio', target: t }];
  }
  // Nome de um sugerido ("notion", "quero o playwright").
  const low = t.toLowerCase();
  return catalog.filter((c) => low.includes(c.name) || low.includes(c.title.toLowerCase())).map((c) => ({ name: c.name, transport: c.transport as ParsedConnector['transport'], target: c.target }));
}
