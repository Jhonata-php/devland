// A IA local do DevLand como API compatível com a da OpenAI (/v1/models e /v1/chat/completions, com streaming e
// ferramentas), repassada ao Ollama do próprio DevLand. Serve outros sistemas (ex.: o "Pergunte ao Orion"). Só liga com um
// token (gerado na tela "IA local" ou DEVLAND_AI_TOKEN); quem chama manda `Authorization: Bearer <token>`.
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { tr } from '../../shared/i18n';
import type { LocalAi } from './local';
import { tokensFrom } from './usage';

const MAX_BODY = 4 * 1024 * 1024;

/** De onde vem o token (index.ts liga ao LocalAi: o gerado na tela "IA local" ou DEVLAND_AI_TOKEN). */
let tokenSource: () => string | undefined = () => process.env.DEVLAND_AI_TOKEN || undefined;
export function setAiTokenSource(fn: () => string | undefined): void {
  tokenSource = fn;
}

export function aiBearerOk(req: IncomingMessage, token = tokenSource()): boolean {
  if (!token) return false;
  const given = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1] ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) return fail(new Error(tr('corpo grande demais')));
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        ok(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        fail(new Error(tr('JSON inválido')));
      }
    });
    req.on('error', fail);
  });
}

/** Atende /v1/*; devolve true quando a rota era dele. */
export function handleOpenAi(req: IncomingMessage, res: ServerResponse, path: string, ai: LocalAi | undefined): boolean {
  if (!path.startsWith('/v1/')) return false;
  if (!tokenSource() || !ai) json(res, 404, { error: { message: tr('API de IA desligada: gere o token em IA local') } });
  else if (!aiBearerOk(req)) json(res, 401, { error: { message: tr('token inválido') } });
  else if (path === '/v1/models' && req.method === 'GET') void relay(res, ai.forward('/v1/models'));
  else if (path === '/v1/chat/completions' && req.method === 'POST') {
    const t0 = Date.now();
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0]!.trim();
    readBody(req).then(
      (raw) => {
        // stream: o Ollama só manda o consumo de tokens no fim se pedirmos
        const body = raw as { model?: unknown; stream?: unknown; stream_options?: object };
        if (body.stream === true) body.stream_options = { ...body.stream_options, include_usage: true };
        return relay(res, ai.forward('/v1/chat/completions', body), (tail) => {
          const tk = tokensFrom(tail);
          ai.usage.record({ at: t0, model: typeof body.model === 'string' ? body.model : '', status: res.statusCode, ms: Date.now() - t0, promptTokens: tk.prompt, completionTokens: tk.completion, ip });
        });
      },
      (err: Error) => json(res, 400, { error: { message: err.message } }),
    );
  } else json(res, 404, { error: { message: tr('rota desconhecida') } });
  return true;
}

/** Repassa a resposta do Ollama; `done` recebe o final dela (de onde sai o consumo de tokens) quando termina. */
async function relay(res: ServerResponse, call: Promise<Response>, done?: (tail: string) => void): Promise<void> {
  let tail = '';
  const fim = () => done?.(tail);
  try {
    const r = await call;
    res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    if (!r.body) {
      res.end();
      return fim();
    }
    const src = Readable.fromWeb(r.body as never);
    src.on('data', (c: Buffer) => {
      tail = (tail + c.toString('utf8')).slice(-4096);
    });
    src.on('end', fim);
    res.on('close', () => src.destroy());
    src.pipe(res);
  } catch (err) {
    if (!res.headersSent) json(res, 502, { error: { message: (err as Error).message } });
    else res.end();
    fim();
  }
}
