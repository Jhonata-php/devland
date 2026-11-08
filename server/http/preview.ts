// Prévia ao vivo do site que o agente está construindo: um proxy SÓ de leitura (GET/HEAD) para um servidor de
// desenvolvimento em 127.0.0.1:<porta>, mostrado num iframe do Habblaud.
//
// Segurança:
// - quem pede o endereço (POST /api/preview, ver app.ts) já passou pela trava "terminal" (local ou usuário do Cloud com
//   a permissão); o endereço leva um token assinado (porta + validade), então o iframe não depende do cookie de login
//   (o iframe é "sandbox": origem opaca, sem cookie nem acesso à API do Habblaud);
// - só 127.0.0.1, só portas altas (>= 1024) e nunca as do próprio Habblaud;
// - a resposta perde Set-Cookie e os cabeçalhos de CSP/frame do projeto e ganha CSP sandbox, nosniff e no-referrer;
// - ponytail: o HTML/JS/CSS tem os caminhos absolutos ("/src/x.js") reescritos por regex para o prefixo da prévia; dá
//   para Vite/estáticos/SSR comuns, mas não é um parser (WebSocket do HMR não passa; a página recarrega sozinha).
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import net from 'node:net';
import { tr } from '../../shared/i18n';
import { esc } from './remote';

export const PREVIEW_PREFIX = '/preview/';
const TOKEN_MS = 60 * 60_000;
const BODY_MAX = 8 * 1024 * 1024;
const UPSTREAM_MS = 15_000;
/** Portas onde servidores de desenvolvimento costumam subir (a busca só olha estas). */
export const COMMON_PORTS = [3000, 3001, 3002, 4200, 4321, 5000, 5173, 5174, 5500, 8000, 8080, 8081, 8888, 9000];

export interface Preview {
  /** Endereço (caminho) da prévia da porta, com token novo; undefined se a porta não vale. */
  issue(port: number): string | undefined;
  /** O caminho é uma prévia com token válido? (o portão remoto deixa passar sem cookie.) */
  verify(pathname: string): boolean;
  handle(req: IncomingMessage, res: ServerResponse, url: URL): boolean;
  /** Portas comuns com algo escutando agora. */
  detect(): Promise<number[]>;
}

export function parsePort(v: unknown): number | undefined {
  const n = typeof v === 'string' && /^\d{1,5}$/.test(v) ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1024 && n <= 65535 ? n : undefined;
}

/** Reescreve caminhos absolutos para o prefixo da prévia (HTML: src/href/action; JS: imports; CSS: url()). */
export function rewriteBody(kind: 'html' | 'js' | 'css', body: string, base: string): string {
  const prefix = base.replace(/\/$/, '');
  if (kind === 'css') return body.replace(/url\(\s*(["']?)\/(?!\/)/g, `url($1${prefix}/`);
  if (kind === 'js') return body.replace(/(\bfrom\s*|\bimport\s*\(?\s*)(["'])\/(?!\/)/g, `$1$2${prefix}/`);
  const html = body
    .replace(/(\b(?:src|href|action|poster)\s*=\s*)(["'])\/(?!\/)/gi, `$1$2${prefix}/`)
    .replace(/(["'(])(\/(?:@vite|@fs|@id|node_modules|src)\/)/g, `$1${prefix}$2`);
  const tag = `<base href="${esc(base)}">`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + tag) : tag + html;
}

function kindOf(type: string): 'html' | 'js' | 'css' | undefined {
  if (/text\/html/i.test(type)) return 'html';
  if (/javascript|ecmascript/i.test(type)) return 'js';
  if (/text\/css/i.test(type)) return 'css';
  return undefined;
}

export function createPreview(opts: { blockedPorts: () => number[]; now?: () => number }): Preview {
  const key = randomBytes(32);
  const now = opts.now ?? Date.now;
  const mac = (port: number, exp: number) => createHmac('sha256', key).update(`${port}.${exp}`).digest('hex').slice(0, 32);
  const allowed = (port: number | undefined): port is number => parsePort(port) !== undefined && !opts.blockedPorts().includes(port!);

  /** /preview/<porta>/<exp>.<mac>/resto -> partes, ou undefined (token vencido, errado ou porta barrada). */
  const parse = (pathname: string) => {
    const m = /^\/preview\/(\d{1,5})\/(\d{1,15})\.([0-9a-f]{32})(\/.*)?$/.exec(pathname);
    if (!m) return undefined;
    const port = parsePort(m[1]);
    const exp = Number(m[2]);
    if (!allowed(port) || exp < now()) return undefined;
    const want = Buffer.from(mac(port, exp));
    const got = Buffer.from(m[3]);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return undefined;
    return { port, token: `${m[2]}.${m[3]}`, rest: m[4] ?? '/' };
  };

  const fail = (res: ServerResponse, status: number, text: string, extra: Record<string, string> = {}) => {
    const body = `<!doctype html><meta charset="utf-8"><body style="font:14px ui-monospace,monospace;background:#030905;color:#39ff88;padding:24px">${esc(text)}</body>`;
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
    res.end(body);
  };

  const headersOut = (extra: Record<string, string | string[] | undefined>) => {
    const out: Record<string, string | string[]> = {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'SAMEORIGIN',
      // sandbox = origem opaca: o site da prévia não lê cookie nem chama a API do Habblaud.
      'Content-Security-Policy': "sandbox allow-scripts allow-forms allow-popups allow-modals; frame-ancestors 'self'",
    };
    for (const [k, v] of Object.entries(extra)) if (v !== undefined) out[k] = v;
    return out;
  };

  return {
    issue(port) {
      if (!allowed(port)) return undefined;
      const exp = now() + TOKEN_MS;
      return `${PREVIEW_PREFIX}${port}/${exp}.${mac(port, exp)}/`;
    },
    verify: (pathname) => !!parse(pathname),
    async detect() {
      const open = await Promise.all(
        COMMON_PORTS.filter((p) => allowed(p)).map(
          (p) =>
            new Promise<number | null>((ok) => {
              const s = net.connect({ port: p, host: '127.0.0.1' });
              const done = (v: number | null) => {
                s.destroy();
                ok(v);
              };
              s.setTimeout(400, () => done(null));
              s.once('connect', () => done(p));
              s.once('error', () => done(null));
            }),
        ),
      );
      return open.filter((p): p is number => p !== null);
    },
    handle(req, res, url) {
      if (!url.pathname.startsWith(PREVIEW_PREFIX)) return false;
      req.resume();
      const method = req.method ?? 'GET';
      if (method !== 'GET' && method !== 'HEAD') {
        fail(res, 405, tr('a prévia só mostra o site (GET); formulários com POST não funcionam aqui'), { Allow: 'GET, HEAD' });
        return true;
      }
      const p = parse(url.pathname);
      if (!p) {
        fail(res, 403, tr('prévia expirada: reabra a prévia no DevLand'));
        return true;
      }
      const base = `${PREVIEW_PREFIX}${p.port}/${p.token}/`;
      const h = req.headers;
      const up = http.request(
        {
          host: '127.0.0.1',
          port: p.port,
          path: p.rest + url.search,
          method,
          timeout: UPSTREAM_MS,
          // Sem cookie nem Authorization do Habblaud; identity para dar para reescrever o corpo.
          headers: { host: `localhost:${p.port}`, accept: h.accept ?? '*/*', 'accept-language': h['accept-language'] ?? '', 'accept-encoding': 'identity', 'user-agent': h['user-agent'] ?? '' },
        },
        (r) => {
          const type = String(r.headers['content-type'] ?? '');
          const kind = kindOf(type);
          let location = r.headers.location;
          if (location) {
            const m = /^(?:https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?)?(\/(?!\/).*)$/.exec(location);
            location = m ? base.slice(0, -1) + m[1] : undefined; // redireciono só dentro da prévia
          }
          const common = { 'Content-Type': type || undefined, Location: location, 'Last-Modified': undefined };
          if (!kind || method === 'HEAD' || (r.statusCode ?? 200) === 304) {
            res.writeHead(r.statusCode ?? 502, headersOut({ ...common, 'Content-Length': r.headers['content-length'] }));
            r.pipe(res);
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          r.on('data', (c: Buffer) => {
            size += c.length;
            if (size > BODY_MAX) r.destroy();
            else chunks.push(c);
          });
          r.on('error', () => res.destroy());
          r.on('close', () => {
            if (size > BODY_MAX || res.headersSent) return res.destroy();
            const out = Buffer.from(rewriteBody(kind, Buffer.concat(chunks).toString('utf8'), base));
            res.writeHead(r.statusCode ?? 200, headersOut({ ...common, 'Content-Length': String(out.length) }));
            res.end(out);
          });
        },
      );
      up.on('timeout', () => up.destroy());
      up.on('error', () => {
        if (!res.headersSent) fail(res, 502, tr('nada respondeu na porta {0}: o servidor do projeto está rodando?', [p.port]));
      });
      up.end();
      return true;
    },
  };
}
