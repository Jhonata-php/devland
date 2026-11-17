import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { aiBearerOk, handleOpenAi } from './openai';
import type { LocalAi } from './local';
import { ApiUsage, tokensFrom } from './usage';

const servers: http.Server[] = [];
afterEach(() => {
  delete process.env.DEVLAND_AI_TOKEN;
  for (const s of servers.splice(0)) s.closeAllConnections(), s.close();
});
const listen = async (h: http.RequestListener) => {
  const s = http.createServer(h);
  servers.push(s);
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
};

describe('API de IA compatível com OpenAI', () => {
  it('sem token configurado fica desligada; com token exige o Bearer e repassa ao Ollama', async () => {
    const seen: unknown[] = [];
    const usage = new ApiUsage(join(mkdtempSync(join(tmpdir(), 'ai-')), 'u.json'));
    const ai = { usage, forward: async (p: string, b?: unknown) => (seen.push([p, b]), new Response('{"ok":1,"usage":{"prompt_tokens":12,"completion_tokens":30,"total_tokens":42}}', { headers: { 'content-type': 'application/json' } })) } as unknown as LocalAi;
    const base = await listen((req, res) => void (handleOpenAi(req, res, req.url!, ai) || res.writeHead(404).end()));
    const call = (auth?: string) => fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) }, body: '{"model":"m","messages":[]}' });
    expect((await call('Bearer x')).status).toBe(404);
    process.env.DEVLAND_AI_TOKEN = 'segredo';
    expect((await call()).status).toBe(401);
    expect((await call('Bearer errado')).status).toBe(401);
    const ok = await call('Bearer segredo');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: 1 });
    expect(seen).toEqual([['/v1/chat/completions', { model: 'm', messages: [] }]]);
    await new Promise((r) => setTimeout(r, 50));
    expect(usage.summary()).toMatchObject({ total: { requests: 1, errors: 0, promptTokens: 12, completionTokens: 30 }, today: { requests: 1 }, last: [{ model: 'm', status: 200, promptTokens: 12, completionTokens: 30 }] });
    expect(aiBearerOk({ headers: { authorization: 'Bearer segredo' } } as never)).toBe(true);
  });
});

describe('uso da API', () => {
  it('tokensFrom lê o usage do fim da resposta (com ou sem stream)', () => {
    expect(tokensFrom('data: {"choices":[]}\n\ndata: {"usage":{"prompt_tokens":5,"completion_tokens":7,"total_tokens":12}}\n\ndata: [DONE]')).toEqual({ prompt: 5, completion: 7 });
    expect(tokensFrom('sem uso')).toEqual({ prompt: 0, completion: 0 });
  });

  it('ApiUsage soma, conta erros e guarda só os últimos pedidos', () => {
    const u = new ApiUsage(join(mkdtempSync(join(tmpdir(), 'ai-')), 'u.json'));
    for (let i = 0; i < 35; i++) u.record({ at: Date.now(), model: 'm', status: i === 0 ? 500 : 200, ms: 1, promptTokens: 1, completionTokens: 2, ip: 'x' });
    const s = u.summary();
    expect(s.total).toEqual({ requests: 35, errors: 1, promptTokens: 35, completionTokens: 70 });
    expect(s.last).toHaveLength(30);
  });
});
