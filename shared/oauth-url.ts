// Login de conector (MCP) pelo navegador: o Claude Code imprime no terminal o link de autorização (quebrado em várias linhas
// pela largura da tela) e, no fim, espera a pessoa colar o endereço da página de retorno (http://localhost:PORTA/callback?...).
// Aqui só se acha e se confere esses dois endereços; ficam num arquivo puro, testado em oauth-url.test.ts.

/** Tira as sequências de controle do terminal (cores, cursor, títulos). */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[()][A-Z0-9]/g, '');
}

/** O último link de autorização impresso na tela (junta as linhas em que ele foi quebrado). */
export function extractAuthUrl(screen: string): string | undefined {
  const lines = stripAnsi(screen).split(/\r?\n/).map((l) => l.trim());
  let found: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    if (!/^https?:\/\/\S+$/.test(lines[i]!)) continue;
    let url = lines[i]!;
    while (i + 1 < lines.length && /^\S+$/.test(lines[i + 1]!)) url += lines[++i]!;
    if (/oauth|authorize|client_id=/i.test(url)) found = url;
  }
  return found;
}

/** O endereço de retorno que a pessoa copia da barra do navegador: só localhost e com o código de autorização. */
export function callbackUrl(text: string): string | undefined {
  const t = text.trim();
  try {
    const u = new URL(t);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
    return u.protocol === 'http:' && local && (u.searchParams.has('code') || u.searchParams.has('error')) ? t : undefined;
  } catch {
    return undefined;
  }
}

/** Teclas que levam o menu /mcp (terminal escondido) ao "Authenticate" do conector; vazio se a tela ainda não é um menu. */
export function mcpKeys(screen: string, name: string): string {
  const lines = stripAnsi(screen).split(/\r?\n/);
  if (/trust (this|the) (folder|files)|Yes, I trust/i.test(screen)) return '\r';
  if (/authenticate/i.test(screen) && !/Authenticating|authorization url|paste/i.test(screen)) return '\r';
  const cursor = lines.findIndex((l) => /^\s*[❯›>]\s/.test(l));
  const word = new RegExp(`(^|[^\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w-]|$)`, 'i');
  const target = lines.findIndex((l) => /^\s*(?:[❯›>]\s+)?(?:\d+\.\s*)?\S/.test(l) && word.test(l) && /·|needs|connected|failed|auth/i.test(l));
  if (!/MCP/i.test(screen) || cursor < 0 || target < 0) return '';
  const delta = target - cursor;
  return (delta > 0 ? '\x1b[B'.repeat(delta) : '\x1b[A'.repeat(-delta)) + '\r';
}
