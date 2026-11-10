// "Agentes podem fazer push e merge (inclusive na main)": o modo automático do Claude Code bloqueia subir direto na
// branch principal mesmo a pedido; a regra explícita em permissions.allow do settings.json da conta libera. Liga ou
// desliga as mesmas regras em todas as contas do Claude, sem mexer no resto do arquivo.
import { chownSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentRunAs } from '../spawn/runas';

export const GIT_RULES = ['Bash(git push:*)', 'Bash(git merge:*)', 'Bash(gh pr merge:*)'] as const;

type Settings = { permissions?: { allow?: unknown[]; [k: string]: unknown }; [k: string]: unknown };

function read(file: string): Settings {
  try {
    const d = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return d && typeof d === 'object' && !Array.isArray(d) ? (d as Settings) : {};
  } catch {
    return {};
  }
}

/** Liga/desliga as regras num settings (puro, para teste). */
export function applyGitRules(s: Settings, allow: boolean): Settings {
  const list = Array.isArray(s.permissions?.allow) ? s.permissions!.allow!.filter((r) => !(GIT_RULES as readonly unknown[]).includes(r)) : [];
  const next = allow ? [...list, ...GIT_RULES] : list;
  return { ...s, permissions: { ...(s.permissions ?? {}), allow: next } };
}

export function gitRulesOn(s: Settings): boolean {
  const list = Array.isArray(s.permissions?.allow) ? s.permissions!.allow! : [];
  return GIT_RULES.every((r) => list.includes(r));
}

export function gitPushAllowed(dirs: readonly string[]): boolean {
  return dirs.length > 0 && dirs.every((d) => gitRulesOn(read(join(d, 'settings.json'))));
}

export function setGitPush(dirs: readonly string[], allow: boolean): void {
  const owner = agentRunAs();
  for (const dir of dirs) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const file = join(dir, 'settings.json');
    const tmp = `${file}.devland-tmp`;
    writeFileSync(tmp, `${JSON.stringify(applyGitRules(read(file), allow), null, 2)}\n`);
    // O arquivo é da conta dos agentes (usuário dev no Cloud): continua sendo dele.
    if (owner) {
      try {
        chownSync(tmp, owner.uid, owner.gid);
      } catch {
        // sem permissão para trocar o dono (fora do Cloud): fica como está
      }
    }
    renameSync(tmp, file);
  }
}
