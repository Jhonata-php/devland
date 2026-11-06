// Habblaud Cloud: atualizar por dentro do app. A versão em uso vem da imagem (HABBLAUD_CLOUD_VERSION, a tag cloud-v*
// que o workflow grava ao construir); a mais recente, da lista de tags da imagem no GHCR (pública, sem token); e o
// botão "Atualizar agora" pede ao Velix para reimplantar o projeto (o container não troca a própria imagem), pela API
// MCP do Velix com um token de API (POST <VELIX_URL>/api/mcp, ferramenta redeploy_project).
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
  /** Id, slug ou nome do projeto do Habblaud no Velix. */
  project: string;
}

/** Variáveis HABBLAUD_VELIX_URL, HABBLAUD_VELIX_TOKEN e HABBLAUD_VELIX_PROJECT (as três, ou nada). */
export function velixTargetFromEnv(env: NodeJS.ProcessEnv): VelixTarget | undefined {
  const url = env.HABBLAUD_VELIX_URL?.trim().replace(/\/+$/, '');
  const token = env.HABBLAUD_VELIX_TOKEN?.trim();
  const project = env.HABBLAUD_VELIX_PROJECT?.trim();
  if (!url || !token || !project) return undefined;
  // O token vai no cabeçalho: só https (ou o próprio computador, nos testes).
  if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url)) return undefined;
  return { url, token, project };
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
