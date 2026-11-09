// IA local: instala o Ollama na pasta de dados (sem root, sobrevive à atualização do container), baixa modelos leves,
// mostra o consumo (memória, CPU, disco e o que está carregado) e faz um teste rápido. Fala com o Ollama pela API HTTP
// dele em 127.0.0.1 (nunca exposta). Linux e macOS; o pacote vem do GitHub do Ollama.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statfsSync } from 'node:fs';
import { cpus, freemem, loadavg, totalmem } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createGunzip, createZstdDecompress } from 'node:zlib';
import { tr } from '../../shared/i18n';

export interface CatalogModel {
  id: string;
  name: string;
  /** Para que serve, em uma linha. */
  use: string;
  /** Tamanho do download (GB). */
  sizeGb: number;
  /** Memória para rodar com folga (GB). */
  ramGb: number;
  code?: boolean;
}

/** Modelos leves que rodam só com CPU. ponytail: lista fixa; atualizar à mão quando sair modelo melhor. */
/** A lista com os textos no idioma do servidor (tr na hora, depois do dicionário carregado). */
export const catalog = (): CatalogModel[] => [
  { id: 'qwen2.5-coder:1.5b', name: 'Qwen2.5 Coder 1.5B', use: tr('Código: completar e explicar, bem rápido'), sizeGb: 1.0, ramGb: 2, code: true },
  { id: 'qwen2.5-coder:3b', name: 'Qwen2.5 Coder 3B', use: tr('Código: o melhor equilíbrio para servidor pequeno'), sizeGb: 1.9, ramGb: 4, code: true },
  { id: 'qwen2.5-coder:7b', name: 'Qwen2.5 Coder 7B', use: tr('Código: respostas melhores, pede 8 GB'), sizeGb: 4.7, ramGb: 8, code: true },
  { id: 'llama3.2:1b', name: 'Llama 3.2 1B', use: tr('Conversa e resumos, mínimo de memória'), sizeGb: 1.3, ramGb: 2 },
  { id: 'llama3.2:3b', name: 'Llama 3.2 3B', use: tr('Conversa geral em português e inglês'), sizeGb: 2.0, ramGb: 4 },
  { id: 'gemma3:1b', name: 'Gemma 3 1B', use: tr('Texto curto e classificação, muito leve'), sizeGb: 0.8, ramGb: 2 },
  { id: 'gemma3:4b', name: 'Gemma 3 4B', use: tr('Texto e imagens, bom em português'), sizeGb: 3.3, ramGb: 6 },
  { id: 'qwen3:4b', name: 'Qwen3 4B', use: tr('Raciocínio e ferramentas, multilíngue'), sizeGb: 2.5, ramGb: 5 },
  { id: 'phi4-mini', name: 'Phi-4 Mini', use: tr('Raciocínio e matemática, compacto'), sizeGb: 2.5, ramGb: 5 },
  { id: 'deepseek-r1:1.5b', name: 'DeepSeek-R1 1.5B', use: tr('Raciocínio passo a passo, leve'), sizeGb: 1.1, ramGb: 2 },
];

/** O maior modelo de código que cabe com folga na memória (ou o menor, se nada couber). */
export function recommend(totalGb: number): string {
  const fit = catalog().filter((m) => m.code && m.ramGb <= totalGb * 0.7);
  return (fit.at(-1) ?? catalog()[0]!).id;
}

/** Nome do pacote do Ollama para este sistema (null = sem pacote pronto). */
export function packageName(platform: string, arch: string): string | null {
  if (platform === 'darwin') return 'ollama-darwin.tgz';
  if (platform === 'linux' && (arch === 'x64' || arch === 'arm64')) return `ollama-linux-${arch === 'x64' ? 'amd64' : 'arm64'}.tar.zst`;
  return null;
}

/** Memória livre de verdade: no Linux, MemAvailable (o freemem conta o cache de disco como usado). */
function availableMem(): number {
  try {
    const m = /MemAvailable:\s+(\d+) kB/.exec(readFileSync('/proc/meminfo', 'utf8'));
    if (m) return Number(m[1]) * 1024;
  } catch { /* fora do Linux */ }
  return freemem();
}

interface Job { kind: 'install' | 'pull'; model?: string; status: string; percent?: number; error?: string; done: boolean }

export class LocalAi {
  private readonly dir: string;
  private readonly host = '127.0.0.1:11434';
  private server: ChildProcess | null = null;
  private job: Job | null = null;
  /** Cancela o download em andamento (instalação ou modelo). */
  private abort: AbortController | null = null;

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'ollama');
  }

  /** Instalado pelo DevLand (na pasta de dados): só esse dá para desinstalar por aqui. */
  private own(): boolean {
    return existsSync(join(this.dir, 'bin', 'ollama')) || existsSync(join(this.dir, 'ollama'));
  }

  /** Binário instalado por nós (pasta de dados) ou o do sistema. */
  private bin(): string | null {
    const own = join(this.dir, 'bin', 'ollama');
    if (existsSync(own)) return own;
    if (existsSync(join(this.dir, 'ollama'))) return join(this.dir, 'ollama');
    for (const p of ['/usr/local/bin/ollama', '/usr/bin/ollama', '/opt/homebrew/bin/ollama', '/Applications/Ollama.app/Contents/Resources/ollama']) if (existsSync(p)) return p;
    return null;
  }

  private async api<T>(path: string, init?: RequestInit, timeoutMs = 3000): Promise<T> {
    const r = await fetch(`http://${this.host}${path}`, { ...init, signal: init?.signal ?? AbortSignal.timeout(timeoutMs) });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Ollama ${r.status}`);
    return (await r.json()) as T;
  }

  private async running(): Promise<string | null> {
    try {
      return (await this.api<{ version: string }>('/api/version', undefined, 1500)).version;
    } catch {
      return null;
    }
  }

  /** Sobe o `ollama serve` (só no loopback) se ele estiver instalado e parado. */
  async start(): Promise<void> {
    if (await this.running()) return;
    const bin = this.bin();
    if (!bin || this.server) return;
    mkdirSync(join(this.dir, 'models'), { recursive: true });
    const child = spawn(bin, ['serve'], {
      env: { ...process.env, OLLAMA_HOST: this.host, OLLAMA_MODELS: join(this.dir, 'models'), OLLAMA_KEEP_ALIVE: '5m' },
      stdio: 'ignore',
    });
    child.on('exit', () => {
      if (this.server === child) this.server = null;
    });
    this.server = child;
    for (let i = 0; i < 20 && !(await this.running()); i++) await new Promise((r) => setTimeout(r, 300));
  }

  stop(): void {
    this.server?.kill();
    this.server = null;
  }

  async status(): Promise<unknown> {
    const version = await this.running();
    const [models, loaded] = version
      ? await Promise.all([
          this.api<{ models: { name: string; size: number; modified_at: string }[] }>('/api/tags').then((r) => r.models, () => []),
          this.api<{ models: { name: string; size: number; size_vram: number; expires_at: string }[] }>('/api/ps').then((r) => r.models, () => []),
        ])
      : [[], []];
    let disk: { free: number; total: number } | null = null;
    try {
      mkdirSync(this.dir, { recursive: true });
      const s = statfsSync(this.dir);
      disk = { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
    } catch { /* sem como medir */ }
    const total = totalmem();
    return {
      system: { platform: process.platform, arch: process.arch, cpus: cpus().length, cpuModel: cpus()[0]?.model ?? '', load: loadavg()[0], ramTotal: total, ramFree: availableMem(), disk },
      ollama: { installed: !!this.bin(), own: this.own(), running: !!version, version, package: packageName(process.platform, process.arch) },
      models: models.map((m) => ({ name: m.name, size: m.size, modified: Date.parse(m.modified_at) || 0 })),
      loaded: loaded.map((m) => ({ name: m.name, size: m.size, vram: m.size_vram, until: Date.parse(m.expires_at) || 0 })),
      catalog: catalog(),
      recommended: recommend(total / 1e9),
      job: this.job,
    };
  }

  private busy(): void {
    if (this.job && !this.job.done) throw new Error(tr('Espere a tarefa em andamento terminar.'));
  }

  /** Baixa o pacote do Ollama do GitHub e extrai em <dados>/ollama (em segundo plano; acompanhe pelo status). */
  install(): void {
    this.busy();
    const pkg = packageName(process.platform, process.arch);
    if (!pkg) throw new Error(tr('Sem pacote do Ollama para este sistema.'));
    const job: Job = { kind: 'install', status: tr('Baixando o Ollama…'), percent: 0, done: false };
    this.job = job;
    const abort = (this.abort = new AbortController());
    void (async () => {
      try {
        mkdirSync(this.dir, { recursive: true });
        const res = await fetch(`https://github.com/ollama/ollama/releases/latest/download/${pkg}`, { signal: abort.signal });
        if (!res.ok || !res.body) throw new Error(tr('Download falhou ({0}).', [res.status]));
        const size = Number(res.headers.get('content-length')) || 0;
        let got = 0;
        const body = Readable.fromWeb(res.body as never);
        const mb = (n: number) => `${Math.round(n / 1e6)} MB`;
        body.on('data', (c: Buffer) => {
          got += c.length;
          if (size) job.percent = Math.round((got / size) * 100);
          job.status = size ? tr('Baixando o Ollama: {0} de {1}', [mb(got), mb(size)]) : tr('Baixando o Ollama: {0}', [mb(got)]);
        });
        const tar = spawn('tar', ['-x', '-C', this.dir], { stdio: ['pipe', 'ignore', 'pipe'] });
        abort.signal.addEventListener('abort', () => tar.kill());
        let err = '';
        tar.stderr.on('data', (d: Buffer) => (err += d.toString()));
        body.pipe(pkg.endsWith('.zst') ? createZstdDecompress() : createGunzip()).pipe(tar.stdin);
        const code = await new Promise<number>((resolve, reject) => {
          tar.on('error', reject);
          tar.on('close', resolve);
        });
        if (abort.signal.aborted) throw new Error(tr('Cancelado.'));
        if (code !== 0) throw new Error(err.trim() || tr('Não deu para extrair o pacote.'));
        job.status = tr('Iniciando…');
        await this.start();
        if (!(await this.running())) throw new Error(tr('O Ollama foi instalado mas não iniciou.'));
        job.status = tr('Instalado');
      } catch (e) {
        job.error = abort.signal.aborted ? tr('Cancelado.') : e instanceof Error ? e.message : String(e);
        // Pacote pela metade não conta como instalado.
        if (!(await this.running())) rmSync(join(this.dir, 'bin'), { recursive: true, force: true }), rmSync(join(this.dir, 'lib'), { recursive: true, force: true });
      }
      job.done = true;
    })();
  }

  /** Baixa um modelo do catálogo (ou qualquer nome do registro do Ollama). */
  pull(model: string): void {
    this.busy();
    if (!/^[a-z0-9][a-z0-9._/-]{0,80}(:[a-z0-9._-]{1,40})?$/i.test(model)) throw new Error(tr('Nome de modelo inválido.'));
    const job: Job = { kind: 'pull', model, status: tr('Preparando…'), percent: 0, done: false };
    this.job = job;
    const abort = (this.abort = new AbortController());
    void (async () => {
      try {
        await this.start();
        const res = await fetch(`http://${this.host}/api/pull`, { method: 'POST', body: JSON.stringify({ model, stream: true }), signal: abort.signal });
        if (!res.ok || !res.body) throw new Error(tr('O Ollama recusou o download ({0}).', [res.status]));
        let buf = '';
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          buf += Buffer.from(chunk).toString();
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (!line.trim()) continue;
            const ev = JSON.parse(line) as { status?: string; total?: number; completed?: number; error?: string };
            if (ev.error) throw new Error(ev.error);
            if (ev.status) job.status = ev.status;
            if (ev.total && ev.completed !== undefined) job.percent = Math.round((ev.completed / ev.total) * 100);
          }
        }
        job.status = tr('Pronto');
        job.percent = 100;
      } catch (e) {
        job.error = abort.signal.aborted ? tr('Cancelado.') : e instanceof Error ? e.message : String(e);
      }
      job.done = true;
    })();
  }

  async remove(model: string): Promise<void> {
    await this.api('/api/delete', { method: 'DELETE', body: JSON.stringify({ model }) }, 10_000);
  }

  cancel(): void {
    this.abort?.abort();
  }

  /** Para o Ollama e apaga a pasta dele (programa e modelos). Só o instalado pelo DevLand. */
  async uninstall(): Promise<void> {
    this.busy();
    if (!this.own()) throw new Error(tr('Este Ollama foi instalado fora do DevLand; desinstale pelo sistema.'));
    this.stop();
    for (let i = 0; i < 10 && (await this.running()); i++) await new Promise((r) => setTimeout(r, 300));
    rmSync(this.dir, { recursive: true, force: true });
    this.job = null;
  }

  /** Conversa com o modelo (o assistente local): manda o histórico, devolve a resposta e a velocidade. */
  async chat(model: string, messages: { role: string; content: string }[]): Promise<{ text: string; tokensPerS: number; seconds: number }> {
    await this.start();
    const msgs = messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-20).map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
    if (!msgs.length) throw new Error(tr('Escreva uma mensagem.'));
    const system = { role: 'system', content: tr('Você é um assistente de programação que roda no servidor do DevLand. Responda em português do Brasil, direto e com exemplos de código quando ajudar.') };
    const r = await this.api<{ message?: { content: string }; eval_count?: number; eval_duration?: number; total_duration?: number }>(
      '/api/chat', { method: 'POST', body: JSON.stringify({ model, messages: [system, ...msgs], stream: false }) }, 300_000);
    const tps = r.eval_count && r.eval_duration ? r.eval_count / (r.eval_duration / 1e9) : 0;
    return { text: r.message?.content ?? '', tokensPerS: Math.round(tps * 10) / 10, seconds: Math.round((r.total_duration ?? 0) / 1e8) / 10 };
  }
}
