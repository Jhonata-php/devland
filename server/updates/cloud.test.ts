import { describe, expect, it } from 'vitest';
import { UpdateChecker } from './checker';
import { cloudVersionOf, ghcrLatest, velixRedeploy, velixTargetFromEnv } from './cloud';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('Cloud: versão da imagem e atualização por dentro do app', () => {
  it('cloudVersionOf lê a tag da imagem', () => {
    expect(cloudVersionOf('cloud-v0.3.5')).toBe('0.3.5');
    expect(cloudVersionOf('v1.2.3')).toBe('1.2.3');
    expect(cloudVersionOf('dev')).toBeUndefined();
    expect(cloudVersionOf(undefined)).toBeUndefined();
  });

  it('ghcrLatest escolhe a maior tag cloud-v* (0.3.10 > 0.3.9) e ignora o resto', async () => {
    const fetchFn = (async (url: string) => {
      if (url.startsWith('https://ghcr.io/token')) return json({ token: 't' });
      return json({ tags: ['latest', 'cloud-v0.3.9', 'cloud-v0.3.10', 'cloud-v0.2.0', 'outra'] });
    }) as unknown as typeof fetch;
    expect(await ghcrLatest('jhonata-php/habblaud', fetchFn)()).toEqual({ latest: '0.3.10' });
  });

  it('velixTargetFromEnv exige as três variáveis e https', () => {
    const ok = { HABBLAUD_VELIX_URL: 'https://velix.exemplo.com/', HABBLAUD_VELIX_TOKEN: 'vlx_x', HABBLAUD_VELIX_PROJECT: 'habblaud' };
    expect(velixTargetFromEnv(ok)).toEqual({ url: 'https://velix.exemplo.com', token: 'vlx_x', project: 'habblaud' });
    expect(velixTargetFromEnv({ ...ok, HABBLAUD_VELIX_TOKEN: '' })).toBeUndefined();
    expect(velixTargetFromEnv({ ...ok, HABBLAUD_VELIX_URL: 'http://velix.exemplo.com' })).toBeUndefined();
  });

  it('velixRedeploy chama redeploy_project com o token e traduz as falhas', async () => {
    let seen: { url: string; auth: string; body: { params: { name: string; arguments: { project: string } } } } | undefined;
    const target = { url: 'https://v.exemplo.com', token: 'vlx_x', project: 'habblaud' };
    const good = (async (url: string, init: RequestInit) => {
      seen = { url, auth: (init.headers as Record<string, string>).Authorization, body: JSON.parse(String(init.body)) };
      return json({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{}' }] } });
    }) as unknown as typeof fetch;
    expect(await velixRedeploy(target, good)).toEqual({ ok: true });
    expect(seen?.url).toBe('https://v.exemplo.com/api/mcp');
    expect(seen?.auth).toBe('Bearer vlx_x');
    expect(seen?.body.params).toEqual({ name: 'redeploy_project', arguments: { project: 'habblaud' } });
    expect((await velixRedeploy(target, (async () => json({}, 401)) as unknown as typeof fetch)).ok).toBe(false);
    const toolError = (async () => json({ result: { isError: true, content: [{ text: 'Projeto não encontrado' }] } })) as unknown as typeof fetch;
    expect(await velixRedeploy(target, toolError)).toEqual({ ok: false, error: 'Projeto não encontrado' });
  });

  it('o checker usa a fonte própria e só deixa atualizar com versão nova', async () => {
    let applied = 0;
    const c = new UpdateChecker({
      current: '0.3.5',
      repo: 'jhonata-php/habblaud',
      enabled: true,
      file: null,
      source: async () => ({ latest: '0.3.6' }),
      apply: async () => {
        applied++;
        return { ok: true };
      },
    });
    expect(await c.apply()).toMatchObject({ ok: false }); // ainda não consultou: nada a instalar
    const s = await c.check();
    expect(s).toMatchObject({ available: true, latest: '0.3.6', canApply: true });
    expect(s.url).toBeUndefined();
    expect(await c.apply()).toEqual({ ok: true });
    expect(await c.apply()).toEqual({ ok: true }); // segundo clique: já está atualizando, não pede de novo
    expect(applied).toBe(1);
    expect(c.status().applyingSince).toBeGreaterThan(0);
  });
});
