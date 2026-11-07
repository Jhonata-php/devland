// Habblaud Cloud: cada agente é um processo do Claude Code, e a cada reimplantação o container reinicia e todos morrem
// (e saem do escritório). Para não perder o trabalho de vista, o servidor guarda quem estava ativo (conta, sessão e pasta) e,
// ao subir, retoma cada conversa com `claude --resume` (pty/manager.ts: resume). Quem foi encerrado de propósito não volta:
// o arquivo reflete só o que estava vivo na última foto, tirada a cada poucos segundos e congelada ao encerrar o servidor.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface LiveAgent {
  account: string;
  sessionId: string;
  cwd: string;
}

export const MAX_RESUME = 6;

/**
 * Pasta de worktree do Claude Code (<projeto>/.claude/worktrees/<nome>) volta para a raiz do projeto: a conversa nasceu
 * lá, e o escritório não deve ganhar uma sala "worktree" (sem projeto) a cada reimplantação.
 */
export function projectRoot(cwd: string): string {
  const i = cwd.indexOf('/.claude/worktrees/');
  return i > 0 ? cwd.slice(0, i) : cwd;
}

/** A mesma conversa aparece uma vez só (o agente da raiz e o do worktree têm o mesmo sessionId), com a pasta já normalizada. */
export function dedupeLive(list: readonly LiveAgent[]): LiveAgent[] {
  const seen = new Set<string>();
  const out: LiveAgent[] = [];
  for (const a of list) {
    if (seen.has(a.sessionId)) continue;
    seen.add(a.sessionId);
    out.push({ ...a, cwd: projectRoot(a.cwd) });
  }
  return out;
}

export function saveLiveAgents(file: string, list: readonly LiveAgent[]): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(list.slice(0, 50))}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}

export function loadLiveAgents(file: string): LiveAgent[] {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (!Array.isArray(raw)) return [];
    return dedupeLive(raw
      .filter((a): a is LiveAgent => !!a && typeof a.account === 'string' && typeof a.sessionId === 'string' && typeof a.cwd === 'string' && /^[\w-]{8,64}$/.test(a.sessionId)))
      .slice(0, MAX_RESUME);
  } catch {
    return [];
  }
}
