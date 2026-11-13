// Prévia num domínio próprio (ex.: preview.devland.suaempresa.com -> porta 4749 do container): o site do projeto é servido
// na RAIZ desse domínio, sem reescrever caminhos. É o que faz apps de verdade funcionarem (Next, React Router, Vite com
// HMR, login com cookie, localStorage): pelo caminho /preview/... do próprio DevLand, os caminhos absolutos montados em
// tempo de execução ("/_next/...", fetch("/api/...")) escapavam do prefixo e a página ficava em branco.
//
// Segurança: o domínio é outro (origem diferente da do DevLand, então o site não lê a sessão nem a API do DevLand); só
// entra quem abriu pelo DevLand: /__devland/open?t=<token assinado de preview.ts> grava um cookie só deste domínio, e
// cada pedido confere esse cookie (vale 1 h, como o token). Só repassa para 127.0.0.1 e nas portas que a prévia aceita.
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import net from 'node:net';
import type { Preview } from './preview';

const COOKIE = 'devland_preview';

function tokenOf(req: IncomingMessage): string {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers.cookie ?? '');
  try {
    return m ? decodeURIComponent(m[1]!) : '';
  } catch {
    return '';
  }
}

/** Cabeçalho Cookie sem o cookie da prévia (o site do projeto não precisa dele). */
function cookiesWithout(header: string | undefined): string | undefined {
  const rest = (header ?? '').split(/;\s*/).filter((c) => c && !c.startsWith(`${COOKIE}=`));
  return rest.length ? rest.join('; ') : undefined;
}

/** Tira o que impede o site de aparecer dentro do DevLand (X-Frame-Options e frame-ancestors do CSP). */
export function frameable(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = { ...headers };
  delete out['x-frame-options'];
  const csp = out['content-security-policy'];
  if (typeof csp === 'string') {
    const kept = csp.split(';').map((d) => d.trim()).filter((d) => d && !/^frame-ancestors\b/i.test(d));
    if (kept.length) out['content-security-policy'] = kept.join('; ');
    else delete out['content-security-policy'];
  }
  return out;
}

function page(res: ServerResponse, status: number, text: string): void {
  const body = `<!doctype html><meta charset="utf-8"><body style="font:14px -apple-system,system-ui,sans-serif;background:#111110;color:#c9c7c2;padding:24px">${text.replace(/[<>&]/g, '')}</body>`;
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}

export function startPreviewHost(opts: { port: number; host: string; preview: Preview; log?: (msg: string) => void }): http.Server {
  const { preview } = opts;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/__devland/open') {
      const t = url.searchParams.get('t') ?? '';
      if (!preview.portOfToken(t)) return page(res, 403, 'Link da prévia inválido ou vencido: abra a prévia de novo pelo DevLand.');
      const secure = String(req.headers['x-forwarded-proto'] ?? '').includes('https');
      res.writeHead(302, {
        'Set-Cookie': `${COOKIE}=${encodeURIComponent(t)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600${secure ? '; Secure' : ''}`,
        Location: '/',
        'Cache-Control': 'no-store',
      });
      return res.end();
    }
    const port = preview.portOfToken(tokenOf(req));
    if (!port) return page(res, 403, 'Prévia vencida: abra a prévia de novo pelo DevLand.');
    const headers: http.OutgoingHttpHeaders = { ...req.headers, host: `localhost:${port}`, cookie: cookiesWithout(req.headers.cookie) };
    const up = http.request({ host: '127.0.0.1', port, path: req.url, method: req.method, headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, frameable(r.headers));
      r.pipe(res);
    });
    up.on('error', () => {
      if (!res.headersSent) page(res, 424, `Nada respondeu na porta ${port}: o servidor do projeto está rodando?`);
      else res.destroy();
    });
    req.pipe(up);
  });
  // WebSocket (recarregar ao vivo do Vite/Next): repassa a conexão crua para a mesma porta.
  server.on('upgrade', (req, socket, head) => {
    const port = preview.portOfToken(tokenOf(req));
    if (!port) return socket.destroy();
    const up = net.connect(port, '127.0.0.1', () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const k = req.rawHeaders[i]!;
        lines.push(`${k}: ${k.toLowerCase() === 'host' ? `localhost:${port}` : req.rawHeaders[i + 1]}`);
      }
      up.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length) up.write(head);
      socket.pipe(up).pipe(socket);
    });
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
  });
  server.listen(opts.port, opts.host, () => opts.log?.(`prévia em domínio próprio escutando em ${opts.host}:${opts.port}`));
  return server;
}
