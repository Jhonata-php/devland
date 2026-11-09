// Página GitHub do modo Painel: os projetos git desta máquina (salas do escritório e, no Cloud, as pastas de /workspace),
// com branch, alterações pendentes, commits por dia e o link do repositório; e a conta do GitHub conectada (gh). Os
// comandos rodam como o usuário dos agentes (no Cloud, o dono das pastas), com prazo curto.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runAsOptions } from '../spawn/runas';

export const ACTIVITY_DAYS = 14;

export interface ProjectInfo {
  name: string;
  path: string;
  branch: string;
  /** Arquivos mudados e ainda sem commit. */
  dirty: number;
  /** Commits ainda não enviados (à frente do upstream); null = sem upstream. */
  ahead: number | null;
  lastCommitAt: number;
  lastCommit: string;
  /** Endereço do repositório no GitHub (https), quando o origin é do GitHub. */
  url?: string;
  /** Commits por dia nos últimos ACTIVITY_DAYS dias (do mais antigo para hoje). */
  commits: number[];
}

type Run = (file: string, args: string[], cwd: string) => Promise<string | null>;

const defaultRun: Run = (file, args, cwd) =>
  new Promise((ok) => {
    execFile(file, args, { cwd, timeout: 8000, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, ...runAsOptions(process.env) }, (err, stdout) => ok(err ? null : stdout));
  });

/** https://github.com/dono/repo a partir do origin (https ou ssh); outros servidores git ficam sem link. */
export function githubUrl(remote: string): string | undefined {
  const m = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(remote.trim());
  return m ? `https://github.com/${m[1]}/${m[2]}` : undefined;
}

/** Índice do dia (0 = mais antigo, ACTIVITY_DAYS-1 = hoje) de cada commit, no fuso local do servidor. */
export function commitsPerDay(timestamps: readonly number[], now: number, days = ACTIVITY_DAYS): number[] {
  const out = new Array<number>(days).fill(0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  for (const t of timestamps) {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    const back = Math.round((today.getTime() - d.getTime()) / 86_400_000);
    if (back >= 0 && back < days) out[days - 1 - back]! += 1;
  }
  return out;
}

export async function projectInfo(dir: string, now = Date.now(), run: Run = defaultRun): Promise<ProjectInfo | null> {
  if (!existsSync(join(dir, '.git'))) return null;
  const [branch, status, last, log, remote, ahead] = await Promise.all([
    run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], dir),
    run('git', ['status', '--porcelain'], dir),
    run('git', ['log', '-1', '--format=%ct%x09%s'], dir),
    run('git', ['log', '--all', `--since=${ACTIVITY_DAYS} days ago`, '--format=%ct'], dir),
    run('git', ['remote', 'get-url', 'origin'], dir),
    run('git', ['rev-list', '--count', '@{upstream}..HEAD'], dir),
  ]);
  if (branch === null) return null;
  const [at, ...subject] = (last ?? '').trim().split('\t');
  return {
    name: dir.split('/').filter(Boolean).pop() ?? dir,
    path: dir,
    branch: branch.trim(),
    dirty: (status ?? '').split('\n').filter((l) => l.trim()).length,
    ahead: ahead === null ? null : Number(ahead.trim()) || 0,
    lastCommitAt: Number(at) * 1000 || 0,
    lastCommit: subject.join('\t').slice(0, 140),
    url: remote ? githubUrl(remote) : undefined,
    commits: commitsPerDay((log ?? '').split('\n').filter(Boolean).map((s) => Number(s) * 1000), now),
  };
}

/** Os projetos (no máximo 30), do mais recente para o mais antigo. */
export async function listProjects(dirs: readonly string[], now = Date.now(), run: Run = defaultRun): Promise<ProjectInfo[]> {
  const unique = [...new Set(dirs.map((d) => d.replace(/\/+$/, '')))].slice(0, 30);
  const all = await Promise.all(unique.map((d) => projectInfo(d, now, run).catch(() => null)));
  return all.filter((p): p is ProjectInfo => !!p).sort((a, b) => b.lastCommitAt - a.lastCommitAt);
}

/** Conta do GitHub conectada pelo gh (login e foto), ou null. */
export async function githubUser(ghBin: string | undefined, run: Run = defaultRun): Promise<{ login: string; name: string; avatar: string } | null> {
  if (!ghBin) return null;
  const out = await run(ghBin, ['api', 'user', '--jq', '[.login, (.name // ""), .avatar_url] | @tsv'], process.env.HOME ?? '/');
  const [login, name, avatar] = (out ?? '').trim().split('\t');
  return login ? { login, name: name || login, avatar: avatar ?? '' } : null;
}

/** git pull --ff-only (só avança; nunca faz merge nem perde nada). */
export async function pull(dir: string, run: Run = defaultRun): Promise<boolean> {
  return (await run('git', ['pull', '--ff-only'], dir)) !== null;
}

export interface ProjectDetail {
  files: { status: string; path: string }[];
  diff: string;
  truncated: boolean;
  prs: { number: number; title: string; branch: string; url: string; draft: boolean; checks: 'ok' | 'fail' | 'pending' | 'none' }[];
}

const DIFF_MAX = 150_000;

/** Estado de CI de um PR a partir do statusCheckRollup do gh. */
export function checksOf(rollup: readonly { conclusion?: string; state?: string; status?: string }[] | undefined): ProjectDetail['prs'][number]['checks'] {
  if (!rollup?.length) return 'none';
  const v = rollup.map((c) => (c.conclusion || c.state || c.status || '').toUpperCase());
  if (v.some((x) => ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(x))) return 'fail';
  if (v.some((x) => ['PENDING', 'IN_PROGRESS', 'QUEUED', 'EXPECTED', ''].includes(x))) return 'pending';
  return 'ok';
}

/** O que mudou (arquivos e diff contra o último commit, novos incluídos) e os PRs abertos do repositório. */
export async function projectDetail(dir: string, ghBin: string | undefined, run: Run = defaultRun): Promise<ProjectDetail> {
  const [status, diff, prs] = await Promise.all([
    run('git', ['status', '--porcelain'], dir),
    run('git', ['diff', 'HEAD', '--no-color', '--no-ext-diff'], dir),
    ghBin ? run(ghBin, ['pr', 'list', '--state', 'open', '--limit', '20', '--json', 'number,title,headRefName,url,isDraft,statusCheckRollup'], dir) : Promise.resolve(null),
  ]);
  const files = (status ?? '').split('\n').filter((l) => l.trim()).map((l) => ({ status: l.slice(0, 2).trim() || 'M', path: l.slice(3) }));
  let list: ProjectDetail['prs'] = [];
  try {
    list = (JSON.parse(prs ?? '[]') as { number: number; title: string; headRefName: string; url: string; isDraft: boolean; statusCheckRollup?: { conclusion?: string; state?: string; status?: string }[] }[])
      .map((p) => ({ number: p.number, title: p.title, branch: p.headRefName, url: p.url, draft: p.isDraft, checks: checksOf(p.statusCheckRollup) }));
  } catch {
    // gh sem login ou repositório fora do GitHub: sem PRs
  }
  const text = diff ?? '';
  return { files, diff: text.slice(0, DIFF_MAX), truncated: text.length > DIFF_MAX, prs: list };
}

/** Envia a branch atual e abre o PR com o título e a descrição dos commits. Nunca na branch principal. */
export async function createPr(dir: string, ghBin: string | undefined, run: Run = defaultRun): Promise<string> {
  if (!ghBin) throw new Error('gh');
  const branch = (await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], dir))?.trim();
  if (!branch || branch === 'HEAD' || branch === 'main' || branch === 'master') throw new Error('main');
  if ((await run('git', ['push', '-u', 'origin', 'HEAD'], dir)) === null) throw new Error('push');
  const url = await run(ghBin, ['pr', 'create', '--fill'], dir);
  if (url === null) throw new Error('pr');
  return url.trim().split('\n').pop() ?? '';
}
