// Terminais órfãos de uma rodada anterior do servidor: a atualização nativa reinicia só o Node (o container continua), e os
// `claude --resume <sessão>` que ele tinha aberto podem continuar vivos sem dono. Ao subir de novo, retomar as mesmas
// conversas por cima deles duplicava os agentes (o mesmo agente 2 ou 3 vezes no escritório). Aqui: achar esses processos
// em /proc (Linux, sem depender de ps/pgrep na imagem) e encerrá-los antes de retomar cada conversa uma vez só.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ResumeProc {
  pid: number;
  ppid: number;
  sessionId: string;
}

/** Sessão de um `claude ... --resume <id> ...` (cmdline separada por \0); undefined para outros processos. */
export function resumeSessionOf(cmdline: string): string | undefined {
  const args = cmdline.split('\0').filter(Boolean);
  if (!args.some((a) => /(^|\/)claude$/.test(a) || /claude-code\/cli\.m?js$/.test(a))) return undefined;
  const i = args.indexOf('--resume');
  const id = i >= 0 ? args[i + 1] : undefined;
  return id && /^[0-9a-f-]{8,64}$/i.test(id) ? id : undefined;
}

/** ppid do /proc/<pid>/stat (o nome do processo vem entre parênteses e pode ter espaços). */
export function ppidOf(stat: string): number {
  const after = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  return Number(after[1]);
}

export function listResumeProcs(proc = '/proc'): ResumeProc[] {
  const out: ResumeProc[] = [];
  let pids: string[] = [];
  try {
    pids = readdirSync(proc).filter((p) => /^\d+$/.test(p));
  } catch {
    return out;
  }
  for (const p of pids) {
    try {
      const sessionId = resumeSessionOf(readFileSync(join(proc, p, 'cmdline'), 'utf8'));
      if (!sessionId) continue;
      out.push({ pid: Number(p), ppid: ppidOf(readFileSync(join(proc, p, 'stat'), 'utf8')), sessionId });
    } catch {
      // processo saiu no meio da leitura
    }
  }
  return out;
}

/** Encerra os `claude --resume` sem dono (pai = 1) e devolve as sessões deles, para retomá-las de novo uma vez só. */
export function killOrphanResumes(myPid = process.pid, proc = '/proc'): Set<string> {
  const ids = new Set<string>();
  for (const r of listResumeProcs(proc)) {
    if (r.ppid !== 1 || r.pid === myPid) continue;
    ids.add(r.sessionId);
    try {
      process.kill(r.pid, 'SIGTERM');
      setTimeout(() => {
        try {
          process.kill(r.pid, 'SIGKILL');
        } catch {
          // já saiu
        }
      }, 3_000).unref();
    } catch {
      // sem permissão ou já saiu
    }
  }
  return ids;
}
