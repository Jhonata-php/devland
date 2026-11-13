// DevLand Cloud: atualizar por dentro do app. A versão em uso vem da imagem (DEVLAND_CLOUD_VERSION, a tag cloud-v*
// que o workflow grava ao construir); a mais recente, da lista de tags da imagem no GHCR (pública, sem token); e o
// botão "Atualizar agora" pede ao Velix para reimplantar o projeto (o container não troca a própria imagem), pela API
// MCP do Velix com um token de API (POST <VELIX_URL>/api/mcp, ferramenta redeploy_project).
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { compareVersions, parseVersion, type LatestSource } from './checker';
import { tr } from '../../shared/i18n';

const TIMEOUT_MS = 15_000;

/** "cloud-v0.3.5" ou "v0.3.5" → "0.3.5" (undefined se não for uma versão). */
export function cloudVersionOf(tag: string | undefined): string | undefined {
  const m = /^(?:cloud-)?v?(\d{1,6}\.\d{1,6}\.\d{1,6})$/.exec((tag ?? '').trim());
  return m?.[1];
}

/** A maior versão entre as tags cloud-v* da imagem ("dono/nome" no ghcr.io). */
export function ghcrLatest(image: string, fetchFn: typeof fetch = fetch): LatestSource {
  return async () => {
    const t = await fetchFn(`https://ghcr.io/token?service=ghcr.io&scope=repository:${image}:pull`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!t.ok) throw new Error(tr('o GitHub respondeu {0}', [t.status]));
    const token = ((await t.json()) as { token?: unknown }).token;
    if (typeof token !== 'string') throw new Error(tr('o GitHub não deu acesso à lista de versões'));
    const res = await fetchFn(`https://ghcr.io/v2/${image}/tags/list?n=1000`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(tr('o GitHub respondeu {0}', [res.status]));
    const tags = (((await res.json()) as { tags?: unknown }).tags ?? []) as unknown[];
    let best: string | undefined;
    for (const tag of tags) {
      const v = typeof tag === 'string' && tag.startsWith('cloud-') ? cloudVersionOf(tag) : undefined;
      if (v && parseVersion(v) && (!best || compareVersions(v, best) > 0)) best = v;
    }
    return { latest: best };
  };
}

export interface VelixTarget {
  /** Endereço do painel, ex.: https://velix.needbr.com */
  url: string;
  /** Token de API do Velix (escopo "write"). */
  token: string;
  /** Id, slug ou nome do projeto do DevLand no Velix. */
  project: string;
}

/** Variáveis DEVLAND_VELIX_URL, DEVLAND_VELIX_TOKEN e DEVLAND_VELIX_PROJECT (as três, ou nada). */
export function velixTargetFromEnv(env: NodeJS.ProcessEnv): VelixTarget | undefined {
  const url = env.DEVLAND_VELIX_URL?.trim().replace(/\/+$/, '');
  const token = env.DEVLAND_VELIX_TOKEN?.trim();
  const project = env.DEVLAND_VELIX_PROJECT?.trim();
  if (!url || !token || !project) return undefined;
  // O token vai no cabeçalho: só https (ou o próprio computador, nos testes).
  if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url)) return undefined;
  return { url, token, project };
}

/** Valida o que a pessoa digitou na tela (endereço https, token e projeto); devolve o alvo ou o motivo. */
export function parseVelixTarget(raw: unknown): VelixTarget | { error: string } {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const t = velixTargetFromEnv({ DEVLAND_VELIX_URL: str(r.url), DEVLAND_VELIX_TOKEN: str(r.token), DEVLAND_VELIX_PROJECT: str(r.project) });
  if (!t) return { error: tr('preencha o endereço do Velix (com https://), o token e o projeto') };
  if (t.token.length > 512 || t.project.length > 120) return { error: tr('token ou projeto grande demais') };
  return t;
}

/** Conexão com o Velix guardada em <dataDir>/velix.json (só o servidor lê; o token nunca volta para a página). */
export function loadVelixFile(file: string): VelixTarget | undefined {
  try {
    const t = parseVelixTarget(JSON.parse(readFileSync(file, 'utf8')));
    return 'error' in t ? undefined : t;
  } catch {
    return undefined;
  }
}

export function saveVelixFile(file: string, t: VelixTarget): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(t)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}

/** Pede ao Velix para reimplantar o projeto (baixa a imagem :latest e sobe de novo; os volumes ficam). */
export async function velixRedeploy(target: VelixTarget, fetchFn: typeof fetch = fetch): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetchFn(`${target.url}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${target.token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'redeploy_project', arguments: { project: target.project } } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) return { ok: false, error: tr('o Velix recusou o token (inválido, expirado ou revogado)') };
    if (!res.ok) return { ok: false, error: tr('o Velix respondeu {0}', [res.status]) };
    const body = (await res.json()) as { error?: { message?: unknown }; result?: { isError?: boolean; content?: { text?: unknown }[] } };
    if (body.error) return { ok: false, error: String(body.error.message ?? tr('erro do Velix')).slice(0, 200) };
    if (body.result?.isError) return { ok: false, error: String(body.result.content?.[0]?.text ?? tr('erro do Velix')).slice(0, 200) };
    return { ok: true };
  } catch (err) {
    const name = (err as { name?: unknown })?.name;
    return { ok: false, error: name === 'TimeoutError' || name === 'AbortError' ? tr('o Velix não respondeu a tempo') : tr('sem conexão com o Velix') };
  }
}
