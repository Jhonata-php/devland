// Uso do plano de uma conta SEM sessão aberta (Cloud): pergunta ao próprio serviço da Anthropic, com o token de login
// (assinatura) que o `claude auth login` guardou na pasta da conta, o mesmo que o /usage do Claude Code consulta.
// Só leitura: não renova o token (quem renova é o Claude Code, quando roda); token vencido = sem números por aqui.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AccountUsage } from '../../shared/types';
import { usageFromWindows } from './usage';

export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

type Fetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export async function fetchOAuthUsage(configDir: string, now = Date.now(), fetchFn: Fetch = fetch as unknown as Fetch): Promise<AccountUsage | undefined> {
  let token: string | undefined;
  try {
    const o = (JSON.parse(readFileSync(join(configDir, '.credentials.json'), 'utf8')) as { claudeAiOauth?: { accessToken?: unknown; expiresAt?: unknown } }).claudeAiOauth;
    if (typeof o?.accessToken === 'string' && !(typeof o.expiresAt === 'number' && o.expiresAt <= now + 30_000)) token = o.accessToken;
  } catch {
    return undefined;
  }
  if (!token) return undefined;
  try {
    const res = await fetchFn(USAGE_URL, { headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    return res.ok ? usageFromWindows(await res.json(), 'oauth', now) : undefined;
  } catch {
    return undefined;
  }
}
