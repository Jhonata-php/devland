// "Rodar o projeto" (prévia ao vivo): o próprio DevLand sobe o servidor de desenvolvimento de um projeto (npm run dev,
// ou start/serve), em segundo plano e como o usuário dos agentes, descobre a porta pela saída dele e devolve para a
// página abrir a prévia. Um processo por pasta; "Parar" encerra. Só pastas de projetos que o escritório conhece (as salas),
// com a mesma trava do terminal (roda código do projeto).
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tr } from '../../shared/i18n';
import { agentRunAs, runAsOptions } from '../spawn/runas';

const SCRIPTS = ['dev', 'start', 'serve', 'preview'];
const PORT_WAIT_MS = 90_000;
const OUTPUT_MAX = 20_000;

/** Script de desenvolvimento do package.json (dev, depois start, serve, preview). */
export function pickScript(scripts: Record<string, unknown> | undefined): string | undefined {
  return SCRIPTS.find((s) => typeof scripts?.[s] === 'string');
}

/** Porta anunciada na saída do servidor (vite, next, webpack, express…): "localhost:5173", "port 3000"… */
export function portFromOutput(text: string): number | undefined {
  // Sem as cores do terminal.
  const clean = text.replace(/\u001b\[[0-9;]*m/g, '');
  const m = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|::):(\d{4,5})/.exec(clean) ?? /\bport\s*:?\s*(\d{4,5})\b/i.exec(clean);
  const port = m ? Number(m[1]) : NaN;
  return port >= 1024 && port <= 65535 ? port : undefined;
}

interface Run {
  folder: string;
  script: string;
  proc: ChildProcess;
  output: string;
  port?: number;
  startedAt: number;
}

export interface RunInfo {
  folder: string;
  script: string;
  port?: number;
  running: boolean;
  startedAt: number;
}

export class DevRunner {
  private readonly runs = new Map<string, Run>();

  constructor(private readonly opts: { allowed: (folder: string) => boolean; npm?: string }) {}

  list(): RunInfo[] {
    return [...this.runs.values()].map((r) => ({ folder: r.folder, script: r.script, port: r.port, running: r.proc.exitCode === null && !r.proc.killed, startedAt: r.startedAt }));
  }

  /** Sobe (ou reaproveita) o servidor da pasta e espera a porta aparecer na saída. */
  async start(raw: string): Promise<{ port: number; script: string; reused: boolean }> {
    const folder = resolve(raw.trim());
    if (!raw.trim() || !this.opts.allowed(folder)) throw new Error(tr('Essa pasta não é de um projeto do escritório.'));
    const current = this.runs.get(folder);
    if (current && current.proc.exitCode === null && current.port) return { port: current.port, script: current.script, reused: true };
    if (current) this.stop(folder);
    let pkg: { scripts?: Record<string, unknown> } = {};
    try {
      pkg = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')) as typeof pkg;
    } catch {
      throw new Error(tr('Sem package.json nessa pasta: rode o servidor pelo agente ou digite a porta.'));
    }
    const script = pickScript(pkg.scripts);
    if (!script) throw new Error(tr('O package.json não tem script dev, start, serve nem preview.'));
    if (!existsSync(join(folder, 'node_modules'))) throw new Error(tr('Instale as dependências primeiro (npm install na pasta do projeto).'));
    const npm = this.opts.npm ?? 'npm';
    const proc = spawn(npm, ['run', script], { cwd: folder, detached: true, stdio: ['ignore', 'pipe', 'pipe'], ...runAsOptions({ ...process.env, FORCE_COLOR: '0', BROWSER: 'none' }, agentRunAs()) });
    const run: Run = { folder, script, proc, output: '', startedAt: Date.now() };
    this.runs.set(folder, run);
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => fail(new Error(tr('O servidor não mostrou a porta em 90 s. Saída: {0}', [run.output.slice(-300)]))), PORT_WAIT_MS);
      const onData = (d: Buffer) => {
        run.output = (run.output + d.toString('utf8')).slice(-OUTPUT_MAX);
        const port = run.port ?? portFromOutput(run.output);
        if (port && !run.port) {
          run.port = port;
          clearTimeout(timer);
          ok({ port, script, reused: false });
        }
      };
      proc.stdout?.on('data', onData);
      proc.stderr?.on('data', onData);
      proc.on('exit', (code) => {
        clearTimeout(timer);
        if (!run.port) fail(new Error(tr('O servidor parou (código {0}). Saída: {1}', [String(code), run.output.slice(-300)])));
      });
      proc.on('error', (err) => {
        clearTimeout(timer);
        fail(err);
      });
    });
  }

  stop(raw: string): boolean {
    const folder = resolve(raw.trim());
    const r = this.runs.get(folder);
    if (!r) return false;
    // detached: o npm e o servidor que ele abriu ficam num grupo próprio; o sinal vai para o grupo todo.
    if (r.proc.exitCode === null && r.proc.pid) {
      const pid = r.proc.pid;
      const signal = (sig: NodeJS.Signals) => {
        try {
          process.kill(-pid, sig);
        } catch {
          // grupo já saiu
        }
      };
      signal('SIGTERM');
      // Alguns servidores (ex.: next-server) seguram o SIGTERM: sem sair em 3 s, o grupo todo leva SIGKILL.
      setTimeout(() => signal('SIGKILL'), 3_000).unref();
    }
    this.runs.delete(folder);
    return true;
  }

  stopAll(): void {
    for (const f of [...this.runs.keys()]) this.stop(f);
  }
}
