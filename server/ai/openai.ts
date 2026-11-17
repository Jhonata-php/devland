// A IA local do DevLand como API compatível com a da OpenAI (/v1/models e /v1/chat/completions, com streaming e
// ferramentas), repassada ao Ollama do próprio DevLand. Serve outros sistemas (ex.: o "Pergunte ao Orion"). Só liga com um
// token (gerado na tela "IA local" ou DEVLAND_AI_TOKEN); quem chama manda `Authorization: Bearer <token>`.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { tr } from '../../shared/i18n';
import type { LocalAi } from './local';
import { ApiTokens, type ApiToken } from './tokens';
import { tokensFrom } from './usage';

const MAX_BODY = 4 * 1024 * 1024;

/** Quem confere o Bearer (index.ts liga ao LocalAi.tokens; sem ligar, só vale DEVLAND_AI_TOKEN). */
let authSource: (bearer: string) => ApiToken | undefined = (b) => new ApiTokens('/nonexistent/none.json').find(b);
export function setAiAuth(fn: (bearer: string) => ApiToken | undefined): void {
  authSource = fn;
}

export function aiAuth(req: IncomingMessage): ApiToken | undefined {
  const given = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1];
  return given ? authSource(given) : undefined;
}

export const aiBearerOk = (req: IncomingMessage): boolean => !!aiAuth(req);

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
  const tok = aiAuth(req);
  if (!ai || !ai.tokens.any()) json(res, 404, { error: { message: tr('API de IA desligada: gere o token em IA local') } });
  else if (!tok) json(res, 401, { error: { message: tr('token inválido') } });
  else if (path === '/v1/models' && req.method === 'GET') {
    // só os modelos que o token pode usar
    void relay(res, ai.forward('/v1/models'), undefined, (txt) => {
      try {
        const j = JSON.parse(txt) as { data?: { id: string }[] };
        return JSON.stringify({ ...j, data: (j.data ?? []).filter((m) => ai.tokens.allows(tok, m.id)) });
      } catch {
        return txt;
      }
    });
  } else if (path === '/v1/chat/completions' && req.method === 'POST') {
    const t0 = Date.now();
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0]!.trim();
    readBody(req).then(
      (raw) => {
        const body = raw as { model?: unknown; stream?: unknown; stream_options?: object };
        const model = typeof body.model === 'string' ? body.model : '';
        // 403 (não 5xx): o proxy do Velix troca o corpo das respostas 502/503/504 por uma página dele
        if (!ai.tokens.allows(tok, model)) return json(res, 403, { error: { message: tr('Este token não tem permissão para o modelo {0}', [model]) } });
        // stream: o Ollama só manda o consumo de tokens no fim se pedirmos
        if (body.stream === true) body.stream_options = { ...body.stream_options, include_usage: true };
        return relay(res, ai.forward('/v1/chat/completions', body), (tail) => {
          const tk = tokensFrom(tail);
          ai.usage.record({ at: t0, model, token: tok.name, status: res.statusCode, ms: Date.now() - t0, promptTokens: tk.prompt, completionTokens: tk.completion, ip });
          ai.tokens.touch(tok.id, tk.prompt, tk.completion);
        });
      },
      (err: Error) => json(res, 400, { error: { message: err.message } }),
    );
  } else json(res, 404, { error: { message: tr('rota desconhecida') } });
  return true;
}

/** Repassa a resposta do Ollama; `done` recebe o final dela (de onde sai o consumo de tokens) quando termina. */
async function relay(res: ServerResponse, call: Promise<Response>, done?: (tail: string) => void, rewrite?: (body: string) => string): Promise<void> {
  let tail = '';
  const fim = () => done?.(tail);
  try {
    const r = await call;
    if (rewrite) {
      const out = rewrite(await r.text());
      res.writeHead(r.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(out);
      return;
    }
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
