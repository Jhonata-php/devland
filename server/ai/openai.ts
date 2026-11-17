// A IA local do DevLand como API compatível com a da OpenAI (/v1/models e /v1/chat/completions, com streaming e
// ferramentas), repassada ao Ollama do próprio DevLand. Serve outros sistemas (ex.: o "Pergunte ao Orion"). Só liga com
// DEVLAND_AI_TOKEN definido; quem chama manda `Authorization: Bearer <token>`.
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { tr } from '../../shared/i18n';
import type { LocalAi } from './local';

const MAX_BODY = 4 * 1024 * 1024;

export function aiBearerOk(req: IncomingMessage, token = process.env.DEVLAND_AI_TOKEN): boolean {
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
  if (!process.env.DEVLAND_AI_TOKEN || !ai) json(res, 404, { error: { message: tr('API de IA desligada: defina DEVLAND_AI_TOKEN') } });
  else if (!aiBearerOk(req)) json(res, 401, { error: { message: tr('token inválido') } });
  else if (path === '/v1/models' && req.method === 'GET') void relay(res, ai.forward('/v1/models'));
  else if (path === '/v1/chat/completions' && req.method === 'POST') {
    readBody(req).then(
      (body) => relay(res, ai.forward('/v1/chat/completions', body as { model?: unknown }), (body as { stream?: unknown }).stream === true),
      (err: Error) => json(res, 400, { error: { message: err.message } }),
    );
  } else json(res, 404, { error: { message: tr('rota desconhecida') } });
  return true;
}

async function relay(res: ServerResponse, call: Promise<Response>, stream = false): Promise<void> {
  try {
    const r = await call;
    res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'no-store', ...(stream ? { 'X-Accel-Buffering': 'no' } : {}) });
    if (!r.body) return void res.end();
    const src = Readable.fromWeb(r.body as never);
    res.on('close', () => src.destroy());
    src.pipe(res);
  } catch (err) {
    if (!res.headersSent) json(res, 502, { error: { message: (err as Error).message } });
    else res.end();
  }
}
