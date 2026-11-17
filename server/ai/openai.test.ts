import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { aiBearerOk, handleOpenAi } from './openai';
import type { LocalAi } from './local';

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
    const ai = { forward: async (p: string, b?: unknown) => (seen.push([p, b]), new Response('{"ok":1}', { headers: { 'content-type': 'application/json' } })) } as unknown as LocalAi;
    const base = await listen((req, res) => void (handleOpenAi(req, res, req.url!, ai) || res.writeHead(404).end()));
    const call = (auth?: string) => fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) }, body: '{"model":"m","messages":[]}' });
    expect((await call('Bearer x')).status).toBe(404);
    process.env.DEVLAND_AI_TOKEN = 'segredo';
    expect((await call()).status).toBe(401);
    expect((await call('Bearer errado')).status).toBe(401);
    const ok = await call('Bearer segredo');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: 1 });
    expect(seen).toEqual([['/v1/chat/completions', { model: 'm', messages: [] }]]);
    expect(aiBearerOk({ headers: { authorization: 'Bearer segredo' } } as never)).toBe(true);
  });
});
