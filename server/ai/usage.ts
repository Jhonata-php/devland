// Uso da API de IA para outros sistemas (/v1): quantos pedidos, tokens, erros e os últimos pedidos, guardado em arquivo
// para sobreviver ao reinício. Aparece na tela "IA local".
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface ApiCall {
  at: number;
  model: string;
  status: number;
  ms: number;
  promptTokens: number;
  completionTokens: number;
  ip: string;
}

interface Totals {
  requests: number;
  errors: number;
  promptTokens: number;
  completionTokens: number;
}

const KEEP = 30;
const empty = (): Totals => ({ requests: 0, errors: 0, promptTokens: 0, completionTokens: 0 });
const dayOf = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

export class ApiUsage {
  private total = empty();
  private days = new Map<string, Totals>();
  private last: ApiCall[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly file: string) {
    try {
      const j = JSON.parse(readFileSync(file, 'utf8')) as { total?: Totals; days?: Record<string, Totals>; last?: ApiCall[] };
      this.total = { ...empty(), ...j.total };
      this.days = new Map(Object.entries(j.days ?? {}));
      this.last = (j.last ?? []).slice(0, KEEP);
    } catch { /* primeira vez */ }
  }

  record(c: ApiCall): void {
    const add = (t: Totals) => {
      t.requests++;
      if (c.status >= 400) t.errors++;
      t.promptTokens += c.promptTokens;
      t.completionTokens += c.completionTokens;
    };
    add(this.total);
    const d = dayOf(c.at);
    const day = this.days.get(d) ?? empty();
    add(day);
    this.days.set(d, day);
    for (const k of [...this.days.keys()].sort().slice(0, -45)) this.days.delete(k); // só os últimos 45 dias
    this.last = [c, ...this.last].slice(0, KEEP);
    this.timer ??= setTimeout(() => {
      this.timer = null;
      try {
        mkdirSync(dirname(this.file), { recursive: true });
        writeFileSync(this.file, JSON.stringify({ total: this.total, days: Object.fromEntries(this.days), last: this.last }));
      } catch { /* sem disco: segue só em memória */ }
    }, 2000);
    this.timer.unref?.();
  }

  summary(now = Date.now()) {
    return { total: this.total, today: this.days.get(dayOf(now)) ?? empty(), last: this.last };
  }

  reset(): void {
    this.total = empty();
    this.days.clear();
    this.last = [];
  }
}

/** Lê o "usage" que o Ollama manda no fim da resposta (com stream: stream_options.include_usage). */
export function tokensFrom(tail: string): { prompt: number; completion: number } {
  const m = /"usage":\s*\{[^}]*\}/.exec(tail.slice(tail.lastIndexOf('"usage"') >= 0 ? tail.lastIndexOf('"usage"') : 0));
  if (!m) return { prompt: 0, completion: 0 };
  const n = (k: string) => Number(new RegExp(`"${k}":\\s*(\\d+)`).exec(m[0])?.[1] ?? 0);
  return { prompt: n('prompt_tokens'), completion: n('completion_tokens') };
}
