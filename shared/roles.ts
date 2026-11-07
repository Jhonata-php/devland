// Função do agente (front-end, back-end, testes...). Escolhida no "Novo agente" (vira a etiqueta `[id]` no nome da
// sessão, ver server/spawn/spawn.ts) ou deduzida do projeto e dos arquivos que ele mexe. Código puro.
import type { AgentInfo, RoomInfo } from './types';

export const ROLE_IDS = ['front', 'back', 'tests', 'infra', 'review', 'design'] as const;
export type RoleId = (typeof ROLE_IDS)[number];

/** Rótulo em PT (passa por tr() na interface), ícone em texto (cabe no tema hacker) e cor neon de cada função. */
export const ROLES: Record<RoleId, { label: string; icon: string; color: string }> = {
  front: { label: 'Front-end', icon: '</>', color: '#39ff88' },
  back: { label: 'Back-end', icon: '{ }', color: '#4de1ff' },
  tests: { label: 'Testes', icon: '✓', color: '#ffe14d' },
  infra: { label: 'DevOps', icon: '⚙', color: '#ff9f43' },
  review: { label: 'Revisão', icon: '◉', color: '#c58bff' },
  design: { label: 'Design', icon: '◆', color: '#ff6fb5' },
};

export const isRoleId = (v: unknown): v is RoleId => typeof v === 'string' && (ROLE_IDS as readonly string[]).includes(v);

/** Etiqueta no começo do nome da sessão: "Habblaud [front]: pedido". */
export function roleFromTitle(title: string | undefined): RoleId | undefined {
  const m = /^\S+ \[([a-z]+)\]/.exec(title ?? '');
  return m && isRoleId(m[1]) ? m[1] : undefined;
}

// Ordem importa: o primeiro que casar vence (testes antes de front/back, que também aparecem em "tests/").
const HINTS: Array<[RoleId, RegExp]> = [
  ['tests', /(\.|\/|-|_)(test|spec|e2e|cypress|playwright|vitest|jest)s?(\.|\/|-|_|$)|__tests__/i],
  ['infra', /dockerfile|docker-compose|\.github\/workflows|terraform|k8s|helm|\.ya?ml$|nginx|deploy|infra|devops/i],
  ['design', /\.(figma|sketch|svg)$|design|\.css$|\.scss$|theme|tokens/i],
  ['front', /\.(tsx|jsx|vue|svelte|html|astro)$|front|client|web|ui\b|pages?\//i],
  ['back', /\.(py|go|rs|java|rb|php|sql|prisma)$|back|server|api|database|\bdb\b/i],
];

function guess(text: string): RoleId | undefined {
  for (const [id, re] of HINTS) if (re.test(text)) return id;
  return undefined;
}

/** Função do agente: a escolhida (etiqueta no nome) > o que ele mexe agora > nome do projeto. Subagentes não têm. */
export function agentRole(a: Pick<AgentInfo, 'kind' | 'title' | 'name' | 'activity' | 'recent'>, room?: Pick<RoomInfo, 'name' | 'path'>): RoleId | undefined {
  if (a.kind !== 'main') return undefined;
  const tagged = roleFromTitle(a.title);
  if (tagged) return tagged;
  const files = [a.activity, ...(a.recent ?? []).slice(-6)].filter((x) => x && (x.kind === 'edit' || x.kind === 'write' || x.kind === 'test')).map((x) => `${x!.kind === 'test' ? 'x.test.ts ' : ''}${x!.detail ?? x!.text}`);
  const byFiles = guess(files.join('\n'));
  return byFiles ?? (room ? guess(room.name) : undefined);
}
