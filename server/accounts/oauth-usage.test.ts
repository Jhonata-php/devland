import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { fetchOAuthUsage } from './oauth-usage';

const dir = (exp: number) => {
  const d = mkdtempSync(join(tmpdir(), 'oau-'));
  writeFileSync(join(d, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: exp } }));
  return d;
};
const ok = (body: unknown) => async (_u: string, init: { headers: Record<string, string> }) => {
  expect(init.headers.Authorization).toBe('Bearer tok');
  return { ok: true, json: async () => body };
};

it('lê as janelas e marca a origem', async () => {
  const u = await fetchOAuthUsage(dir(2e12), 1e12, ok({ five_hour: { utilization: 12, resets_at: '2030-01-01T00:00:00Z' }, seven_day: { utilization: 40 } }));
  expect(u).toMatchObject({ source: 'oauth', fetchedAt: 1e12, fiveHour: { utilization: 12 }, sevenDay: { utilization: 40 } });
});
it('token vencido, sem arquivo ou erro: sem números', async () => {
  expect(await fetchOAuthUsage(dir(5), 1e12, ok({}))).toBeUndefined();
  expect(await fetchOAuthUsage('/nao/existe', 1e12, ok({}))).toBeUndefined();
  expect(await fetchOAuthUsage(dir(2e12), 1e12, async () => ({ ok: false, json: async () => ({}) }))).toBeUndefined();
});
