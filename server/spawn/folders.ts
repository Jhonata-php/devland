// Pastas sugeridas no "Novo agente": os projetos em que você trabalhou por último, para escolher com um toque em vez de
// lembrar o caminho. Vêm do histórico de sessões (o `cwd` dos transcripts, de todas as contas e ferramentas) e das salas
// do escritório. Worktrees de agentes (<projeto>/.claude/worktrees/<nome>) contam como o projeto; pastas temporárias
// (e as scratch-workspaces do app do Claude) ficam de fora. Node puro: só junta e ordena (quem lê os transcripts é
// sources/history.ts).
import { readdirSync, statSync } from 'node:fs';


export interface SpawnFolder {
  /** Caminho absoluto no computador do app do Claude. */
  path: string;
  /** Nome curto (última parte do caminho). */
  name: string;
  /** Atividade mais recente (epoch ms; 0 = só a sala, sem horário). */
  lastAt: number;
  /** Sessões recentes nesta pasta. */
  sessions: number;
}

export const FOLDERS_LIMIT = 15;

const TEMP = /^(\/private)?\/(tmp|var\/folders|var\/tmp)(\/|$)/;
/** Pastas descartáveis que o app desktop do Claude cria para sessões sem projeto. */
const SCRATCH = /\/Application Support\/Claude\/scratch-workspaces\//;
const WORKTREE = /^(.*?)\/\.(claude|codex)\/worktrees\/[^/]+(\/.*)?$/;

function absolute(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);
}

/** A pasta do projeto para um caminho de sessão (worktree vira o projeto; temporária ou relativa = undefined). */
export function projectFolder(raw: string | undefined): string | undefined {
  const p = raw?.trim().replace(/[\\/]+$/, '');
  if (!p || !absolute(p) || TEMP.test(p) || SCRATCH.test(p)) return undefined;
  const wt = WORKTREE.exec(p);
  return wt ? wt[1] || undefined : p;
}

/** Junta sessões e salas em pastas únicas, da atividade mais recente para a mais antiga. */
export function recentFolders(
  sessions: ReadonlyArray<{ project?: string; lastAt: number }>,
  rooms: ReadonlyArray<{ path?: string; lastAt?: number }>,
  limit = FOLDERS_LIMIT,
): SpawnFolder[] {
  const byPath = new Map<string, SpawnFolder>();
  const add = (raw: string | undefined, lastAt: number, session: boolean) => {
    const path = projectFolder(raw);
    if (!path) return;
    const cur = byPath.get(path);
    if (cur) {
      cur.lastAt = Math.max(cur.lastAt, lastAt);
      if (session) cur.sessions++;
    } else byPath.set(path, { path, name: path.split(/[\\/]/).pop() || path, lastAt, sessions: session ? 1 : 0 });
  };
  for (const s of sessions) add(s.project, s.lastAt, true);
  for (const r of rooms) add(r.path, r.lastAt ?? 0, false);
  return [...byPath.values()].sort((a, b) => b.lastAt - a.lastAt || a.path.localeCompare(b.path)).slice(0, limit);
}

/** Cloud: cada pasta de projeto dentro de /workspace (os repositórios clonados) vira uma escolha, mesmo sem sessão ainda. */
export function workspaceFolders(root: string, list: (dir: string) => string[] = (d) => readdirSync(d)): SpawnFolder[] {
  const out: SpawnFolder[] = [];
  try {
    for (const name of list(root)) {
      if (name.startsWith('.')) continue;
      const path = `${root}/${name}`;
      let mtime = 0;
      try {
        const st = statSync(path);
        if (!st.isDirectory()) continue;
        mtime = st.mtimeMs;
      } catch {
        continue;
      }
      out.push({ path, name, lastAt: mtime, sessions: 0 });
    }
  } catch {
    // sem a pasta: nada a sugerir
  }
  return out;
}

/** Junta as pastas de /workspace às recentes (sem repetir), as mais recentes primeiro. */
export function mergeFolders(recent: SpawnFolder[], extra: SpawnFolder[]): SpawnFolder[] {
  const seen = new Set(recent.map((f) => f.path));
  return [...recent, ...extra.filter((f) => !seen.has(f.path))].sort((a, b) => b.lastAt - a.lastAt || a.path.localeCompare(b.path));
}
