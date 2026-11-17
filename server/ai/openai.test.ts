import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { handleOpenAi, setAiAuth } from './openai';
import type { LocalAi } from './local';
import { ApiTokens } from './tokens';
import { ApiUsage, tokensFrom } from './usage';
import { DictationService } from '../dictation/dictation';

const servers: http.Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.closeAllConnections(), s.close();
});
const dir = () => mkdtempSync(join(tmpdir(), 'ai-'));
const listen = async (h: http.RequestListener) => {
  const s = http.createServer(h);
  servers.push(s);
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
};

const MODELS = '{"object":"list","data":[{"id":"qwen3:8b"},{"id":"coder:1.5b"}]}';
const CHAT = '{"ok":1,"usage":{"prompt_tokens":12,"completion_tokens":30,"total_tokens":42}}';

describe('API de IA compatível com OpenAI', () => {
  it('sem token fica desligada; com tokens exige o Bearer e respeita a permissão por modelo', async () => {
    const d = dir();
    const tokens = new ApiTokens(join(d, 't.json'), undefined, () => undefined);
    const usage = new ApiUsage(join(d, 'u.json'));
    const seen: unknown[] = [];
    const ai = {
      tokens,
      usage,
      forward: async (p: string, b?: unknown) => (seen.push([p, b]), new Response(p === '/v1/models' ? MODELS : CHAT, { headers: { 'content-type': 'application/json' } })),
    } as unknown as LocalAi;
    setAiAuth((b) => tokens.find(b));
    const base = await listen((req, res) => void (handleOpenAi(req, res, req.url!, ai) || res.writeHead(404).end()));
    const call = (path: string, auth?: string, body?: object) =>
      fetch(`${base}${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) }, body: body ? JSON.stringify(body) : undefined });

    expect((await call('/v1/models', 'Bearer x')).status).toBe(404); // nenhum token criado

    const so8b = tokens.create('Orion', ['qwen3:8b']);
    const todos = tokens.create('Livre', []);
    expect((await call('/v1/models')).status).toBe(401);
    expect((await call('/v1/models', 'Bearer errado')).status).toBe(401);

    // lista de modelos: só os permitidos
    const m = (await (await call('/v1/models', `Bearer ${so8b.token}`)).json()) as { data: { id: string }[] };
    expect(m.data.map((x) => x.id)).toEqual(['qwen3:8b']);
    expect(((await (await call('/v1/models', `Bearer ${todos.token}`)).json()) as { data: unknown[] }).data).toHaveLength(2);

    // pedido de um modelo sem permissão: 403 e nada vai ao Ollama
    const proibido = await call('/v1/chat/completions', `Bearer ${so8b.token}`, { model: 'coder:1.5b', messages: [] });
    expect(proibido.status).toBe(403);
    expect(JSON.stringify(seen)).not.toContain('coder');

    const ok = await call('/v1/chat/completions', `Bearer ${so8b.token}`, { model: 'qwen3:8b', messages: [] });
    expect(ok.status).toBe(200);
    expect(seen.at(-1)).toEqual(['/v1/chat/completions', { model: 'qwen3:8b', messages: [] }]);
    await new Promise((r) => setTimeout(r, 50));
    expect(usage.summary()).toMatchObject({ total: { requests: 1, promptTokens: 12, completionTokens: 30 }, models: [{ model: 'qwen3:8b', tokens: 42 }], last: [{ token: 'Orion', model: 'qwen3:8b', status: 200 }] });
    expect(tokens.list().find((t) => t.id === so8b.id)).toMatchObject({ requests: 1, promptTokens: 12, completionTokens: 30 });
  });
});

describe('cliente que desiste', () => {
  it('cancela o pedido ao Ollama quando a conexão cai antes da resposta', async () => {
    const d = dir();
    const tokens = new ApiTokens(join(d, 't.json'), undefined, () => undefined);
    const tok = tokens.create('Orion', []);
    setAiAuth((b) => tokens.find(b));
    let sinal: AbortSignal | undefined;
    const ai = {
      tokens,
      usage: new ApiUsage(join(d, 'u.json')),
      // o "Ollama" nunca responde: só termina se for cancelado
      forward: (_p: string, _b: unknown, signal?: AbortSignal) => ((sinal = signal), new Promise<Response>((_ok, fail) => signal?.addEventListener('abort', () => fail(new Error('abortado'))))),
    } as unknown as LocalAi;
    const base = await listen((req, res) => void (handleOpenAi(req, res, req.url!, ai) || res.writeHead(404).end()));
    const ctl = new AbortController();
    const p = fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok.token}` }, body: JSON.stringify({ model: 'm', messages: [] }), signal: ctl.signal }).catch(() => 'caiu');
    await new Promise((r) => setTimeout(r, 150));
    expect(sinal?.aborted).toBe(false);
    ctl.abort();
    await p;
    await new Promise((r) => setTimeout(r, 150));
    expect(sinal?.aborted).toBe(true);
  });
});

describe('tokens', () => {
  it('cria, edita, revoga e migra o token antigo único para "Principal"', () => {
    const d = dir();
    const f = join(d, 't.json');
    writeFileSync(join(d, 'old'), 'antigo123\n');
    const t = new ApiTokens(f, join(d, 'old'), () => 'doambiente');
    expect(t.list().map((x) => x.name)).toEqual(['DEVLAND_AI_TOKEN', 'Principal']);
    expect(t.find('antigo123')?.name).toBe('Principal');
    expect(t.find('doambiente')?.fromEnv).toBe(true);
    const n = t.create('Orion', ['a']);
    t.update(n.id, { name: 'Orion 2', models: ['a', 'b'] });
    expect(new ApiTokens(f, undefined, () => undefined).list().find((x) => x.id === n.id)).toMatchObject({ name: 'Orion 2', models: ['a', 'b'] });
    expect(t.allows(n, 'a:latest') || t.allows({ ...n, models: ['a:latest'] }, 'a')).toBe(true);
    expect(t.allows(n, 'c')).toBe(false);
    t.remove(n.id);
    expect(t.find(n.token)).toBeUndefined();
  });
});

describe('uso da API', () => {
  it('tokensFrom lê o usage do fim da resposta (com ou sem stream)', () => {
    expect(tokensFrom('data: {"choices":[]}\n\ndata: {"usage":{"prompt_tokens":5,"completion_tokens":7,"total_tokens":12}}\n\ndata: [DONE]')).toEqual({ prompt: 5, completion: 7 });
    expect(tokensFrom('sem uso')).toEqual({ prompt: 0, completion: 0 });
  });

  it('ApiUsage soma, conta erros, guarda os últimos pedidos e dá 14 dias para o gráfico', () => {
    const u = new ApiUsage(join(dir(), 'u.json'));
    for (let i = 0; i < 35; i++) u.record({ at: Date.now(), model: 'm', status: i === 0 ? 500 : 200, ms: 1, promptTokens: 1, completionTokens: 2, ip: 'x' });
    const s = u.summary();
    expect(s.total).toEqual({ requests: 35, errors: 1, promptTokens: 35, completionTokens: 70 });
    expect(s.last).toHaveLength(30);
    expect(s.days).toHaveLength(14);
    expect(s.days.at(-1)).toMatchObject({ requests: 35, tokens: 105 });
    expect(s.days[0]).toMatchObject({ requests: 0, tokens: 0 });
  });
});

describe('transcrição de áudio (/v1/audio/transcriptions)', () => {
  it('manda o áudio ao Whisper do ditado e devolve o texto; sem Whisper, 503; sem token, 401', async () => {
    const tokens = new ApiTokens(join(dir(), 't.json'), undefined, () => undefined);
    const tok = tokens.create('Orion', []);
    setAiAuth((b) => tokens.find(b));
    const ai = { tokens, usage: new ApiUsage(join(dir(), 'u.json')) } as unknown as LocalAi;
    const com = new DictationService({ transcriber: async () => ({ text: 'quantos MB deu o AP 02', lang: 'pt' }) });
    const sem = new DictationService();
    const mk = (d: DictationService) => listen((req, res) => void (handleOpenAi(req, res, req.url!, ai, d) || res.writeHead(404).end()));
    const audio = { type: 'audio/webm', data: Buffer.alloc(200, 1).toString('base64') };
    const call = (base: string, auth?: string) => fetch(`${base}/v1/audio/transcriptions`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) }, body: JSON.stringify(audio) });
    const ok = await mk(com);
    expect((await call(ok)).status).toBe(401);
    const r = await call(ok, `Bearer ${tok.token}`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ text: 'quantos MB deu o AP 02', language: 'pt' });
    expect((await call(await mk(sem), `Bearer ${tok.token}`)).status).toBe(503);
  });
});
