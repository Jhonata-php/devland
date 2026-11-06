// Habblaud Cloud: conectar contas pela web (Claude Code, Codex e GitHub), sem terminal à vista.
//
// Cada "Conectar" roda o login oficial da ferramenta num terminal escondido (node-pty, como o usuário dos agentes) e
// lê da saída o que a pessoa precisa: o link (e o código, no Codex e no GitHub). No Claude, a Anthropic mostra um
// código depois de autorizar, que a página manda para cá (`paste`) e vai direto para o `claude` (nunca é gravado).
//   claude  claude auth login                 CLAUDE_CONFIG_DIR = ~/.claude (1ª conta), ~/.claude-2...
//   codex   codex login --device-auth         CODEX_HOME = ~/.codex
//   github  gh auth login --web               e depois gh auth setup-git (o git push dos agentes usa esta conta)
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chownSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tr } from '../../shared/i18n';
import type { PtyProcess, SpawnPty } from '../pty/manager';
import { agentRunAs, runAsOptions } from '../spawn/runas';

export type ConnectProvider = 'claude' | 'codex' | 'github';

export interface ConnectJobView {
  id: string;
  provider: ConnectProvider;
  state: 'starting' | 'waiting' | 'done' | 'failed';
  url?: string;
  code?: string;
  /** Claude: a página da Anthropic mostra um código que precisa voltar para cá. */
  needsPaste: boolean;
  error?: string;
}

export interface ConnectedAccount {
  provider: ConnectProvider;
  /** Pasta (Claude/Codex) ou usuário do GitHub. */
  label: string;
  dir?: string;
}

export interface ConnectDeps {
  spawn: SpawnPty;
  home: string;
  env: NodeJS.ProcessEnv;
  claudeBin: string;
  codexBin?: string;
  ghBin?: string;
  /** Pasta de conta do Claude nova (já logada): entra na lista de contas do escritório. */
  onClaudeDir(dir: string): void;
  /** Contas mudaram (conectou, falhou): a página relê. */
  onChange(): void;
}

interface Job extends ConnectJobView {
  proc?: PtyProcess;
  out: string;
  dir?: string;
}

/** Tira cores e links (OSC 8) do terminal, mantendo o texto. */
/** Cria a pasta com dono = usuário dos agentes (o servidor roda como root no Cloud; o claude roda como dev). */
function mkdirForAgent(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const who = agentRunAs();
  if (who) chownSync(dir, who.uid, who.gid);
}

function plain(text: string): string {
  return text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

const JOB_TTL_MS = 20 * 60_000;

export class ConnectService {
  private readonly jobs = new Map<string, Job>();

  constructor(private readonly deps: ConnectDeps) {}

  available(provider: ConnectProvider): boolean {
    return provider === 'claude' ? !!this.deps.claudeBin : provider === 'codex' ? !!this.deps.codexBin : !!this.deps.ghBin;
  }

  /** Começa o login (encerra um anterior da mesma ferramenta que ainda esperava). */
  start(provider: ConnectProvider): ConnectJobView {
    if (!this.available(provider)) throw new Error(tr('{0} não está instalado neste servidor', [provider]));
    for (const j of this.jobs.values()) if (j.provider === provider && j.state !== 'done' && j.state !== 'failed') this.kill(j, tr('cancelado'));
    const job: Job = { id: randomUUID(), provider, state: 'starting', needsPaste: provider === 'claude', out: '' };
    // GH_PROMPT_DISABLED: o gh não pergunta nada (as perguntas dele travam sem um terminal de verdade do outro lado);
    // o git é configurado depois, com gh auth setup-git.
    const env: NodeJS.ProcessEnv = { ...this.deps.env, TERM: 'xterm-256color', BROWSER: 'true', GH_BROWSER: 'true', GH_PROMPT_DISABLED: '1', NO_COLOR: '1' };
    let file: string;
    let args: string[];
    if (provider === 'claude') {
      job.dir = this.nextClaudeDir();
      mkdirForAgent(job.dir);
      env.CLAUDE_CONFIG_DIR = job.dir;
      [file, args] = [this.deps.claudeBin, ['auth', 'login']];
    } else if (provider === 'codex') {
      job.dir = join(this.deps.home, '.codex');
      env.CODEX_HOME = job.dir;
      [file, args] = [this.deps.codexBin!, ['login', '--device-auth']];
    } else {
      [file, args] = [this.deps.ghBin!, ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web']];
    }
    job.proc = this.deps.spawn(file, args, { cwd: this.deps.home, cols: 400, rows: 40, env });
    job.proc.onData((d) => this.onData(job, d));
    job.proc.onExit(({ exitCode }) => void this.onExit(job, exitCode));
    this.jobs.set(job.id, job);
    setTimeout(() => this.kill(job, tr('o login expirou; comece de novo')), JOB_TTL_MS).unref();
    return view(job);
  }

  get(id: string): ConnectJobView | undefined {
    const job = this.jobs.get(id);
    return job && view(job);
  }

  /** Claude: o código que a Anthropic mostrou. Vai só para o processo do login. */
  paste(id: string, code: string): ConnectJobView {
    const job = this.jobs.get(id);
    if (!job || job.provider !== 'claude' || job.state !== 'waiting') throw new Error(tr('este login não está esperando código'));
    const clean = code.trim();
    if (!/^[\w#.~-]{8,512}$/.test(clean)) throw new Error(tr('código inválido: cole exatamente o que a página da Anthropic mostrou'));
    job.proc?.write(`${clean}\r`);
    return view(job);
  }

  /** O que já está conectado (consulta as ferramentas; alguns segundos no pior caso). */
  async accounts(): Promise<ConnectedAccount[]> {
    const out: ConnectedAccount[] = [];
    for (const dir of this.claudeDirs()) {
      const r = await this.run(this.deps.claudeBin, ['auth', 'status', '--json'], { CLAUDE_CONFIG_DIR: dir });
      try {
        const s = JSON.parse(r.stdout) as { loggedIn?: boolean; email?: string };
        if (s.loggedIn) out.push({ provider: 'claude', label: s.email ?? dir, dir });
      } catch {
        // saída inesperada: conta não aparece como conectada
      }
    }
    if (this.deps.codexBin) {
      const dir = join(this.deps.home, '.codex');
      const r = await this.run(this.deps.codexBin, ['login', 'status'], { CODEX_HOME: dir });
      if (r.ok && /logged in/i.test(r.stdout + r.stderr) && !/not logged in/i.test(r.stdout + r.stderr)) out.push({ provider: 'codex', label: dir, dir });
    }
    if (this.deps.ghBin) {
      const r = await this.run(this.deps.ghBin, ['api', 'user', '--jq', '.login']);
      if (r.ok && r.stdout.trim()) out.push({ provider: 'github', label: r.stdout.trim() });
    }
    return out;
  }

  /** Repositórios da conta do GitHub (os da pessoa e das organizações dela). */
  async repos(): Promise<{ name: string; private: boolean; cloned: boolean }[]> {
    if (!this.deps.ghBin) return [];
    const r = await this.run(this.deps.ghBin, ['repo', 'list', '--limit', '100', '--json', 'nameWithOwner,isPrivate']);
    if (!r.ok) throw new Error(tr('não consegui listar os repositórios: {0}', [(r.stderr || r.stdout).trim().slice(0, 200)]));
    const list = JSON.parse(r.stdout) as { nameWithOwner: string; isPrivate: boolean }[];
    return list.map((x) => ({ name: x.nameWithOwner, private: x.isPrivate, cloned: existsSync(join(WORKSPACE, x.nameWithOwner.split('/')[1])) }));
  }

  /** Clona em /workspace/<repo>. Devolve a pasta. */
  async clone(nameWithOwner: string): Promise<string> {
    if (!this.deps.ghBin) throw new Error(tr('o GitHub não está instalado neste servidor'));
    if (!/^[\w.-]+\/[\w.-]+$/.test(nameWithOwner)) throw new Error(tr('repositório inválido'));
    const dest = join(WORKSPACE, nameWithOwner.split('/')[1]);
    if (existsSync(dest)) throw new Error(tr('já existe {0}', [dest]));
    const r = await this.run(this.deps.ghBin, ['repo', 'clone', nameWithOwner, dest], {}, 600_000);
    if (!r.ok) throw new Error(tr('não consegui clonar: {0}', [(r.stderr || r.stdout).trim().slice(-300)]));
    return dest;
  }

  private onData(job: Job, data: string): void {
    job.out = (job.out + data).slice(-20_000);
    const raw = job.out;
    const text = plain(raw);
    if (job.provider === 'claude') {
      job.url ??= /https:\/\/claude\.(?:com|ai)\/[^\s\x07\x1b]*oauth\/authorize\?[^\s\x07\x1b]+/.exec(raw)?.[0];
    } else {
      job.url ??= (job.provider === 'codex' ? /https:\/\/auth\.openai\.com\/\S+/ : /https:\/\/github\.com\/login\/device\S*/).exec(text)?.[0];
      job.code ??= /\b([A-Z0-9]{4}-[A-Z0-9]{4,6})\b/.exec(text)?.[1];
    }
    const ready = job.provider === 'claude' ? !!job.url : !!job.url && !!job.code;
    if (job.state === 'starting' && ready) {
      job.state = 'waiting';
      this.deps.onChange();
    }
  }

  private async onExit(job: Job, exitCode: number): Promise<void> {
    if (job.state === 'done' || job.state === 'failed') return;
    job.proc = undefined;
    if (exitCode !== 0) {
      const last = plain(job.out).split('\n').map((l) => l.trim()).filter(Boolean).slice(-2).join(' ');
      return this.finish(job, 'failed', last.slice(0, 300) || tr('o login não terminou'));
    }
    if (job.provider === 'claude' && job.dir) {
      // A descoberta de contas só considera pastas com projects/ ou sessions/.
      mkdirForAgent(join(job.dir, 'projects'));
      this.deps.onClaudeDir(job.dir);
    }
    if (job.provider === 'github') {
      await this.run(this.deps.ghBin!, ['auth', 'setup-git']);
      // Autor dos commits dos agentes: o usuário do GitHub (e-mail noreply, que o GitHub sempre aceita).
      const u = await this.run(this.deps.ghBin!, ['api', 'user', '--jq', '[.login, .id] | @tsv']);
      const [login, id] = u.stdout.trim().split('\t');
      if (login && id) {
        await this.run('git', ['config', '--global', 'user.name', login]);
        await this.run('git', ['config', '--global', 'user.email', `${id}+${login}@users.noreply.github.com`]);
      }
    }
    this.finish(job, 'done');
  }

  private finish(job: Job, state: 'done' | 'failed', error?: string): void {
    job.state = state;
    job.error = error;
    this.deps.onChange();
  }

  private kill(job: Job, reason: string): void {
    if (job.state === 'done' || job.state === 'failed') return;
    try {
      job.proc?.kill();
    } catch {
      // já saiu
    }
    job.proc = undefined;
    this.finish(job, 'failed', reason);
  }

  /** Pastas de conta do Claude: ~/.claude e ~/.claude-N. */
  private claudeDirs(): string[] {
    try {
      return readdirSync(this.deps.home)
        .filter((n) => n === '.claude' || /^\.claude-\d+$/.test(n))
        .sort((a, b) => a.length - b.length || a.localeCompare(b))
        .map((n) => join(this.deps.home, n));
    } catch {
      return [];
    }
  }

  /** A primeira pasta sem login (ou uma nova). */
  private nextClaudeDir(): string {
    const used = new Set(this.claudeDirs().filter((d) => existsSync(join(d, '.credentials.json'))));
    for (let n = 1; ; n++) {
      const dir = join(this.deps.home, n === 1 ? '.claude' : `.claude-${n}`);
      if (!used.has(dir)) return dir;
    }
  }

  private run(file: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}, timeout = 20_000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    return new Promise((ok) => {
      execFile(file, args, { cwd: this.deps.home, timeout, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, ...runAsOptions({ ...this.deps.env, ...extraEnv }) }, (err, stdout, stderr) =>
        ok({ ok: !err, stdout: stdout ?? '', stderr: stderr ?? '' }),
      );
    });
  }
}

export const WORKSPACE = '/workspace';

function view(j: Job): ConnectJobView {
  return { id: j.id, provider: j.provider, state: j.state, url: j.url, code: j.code, needsPaste: j.needsPaste, error: j.error };
}
