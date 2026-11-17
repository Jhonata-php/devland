// Uso da API de IA para outros sistemas (/v1): quantos pedidos, tokens, erros e os últimos pedidos, guardado em arquivo
// para sobreviver ao reinício. Aparece na tela "IA local".
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface ApiCall {
  at: number;
  model: string;
  /** Nome do token que fez o pedido. */
  token?: string;
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
  private models = new Map<string, Totals>();
  private last: ApiCall[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly file: string) {
    try {
      const j = JSON.parse(readFileSync(file, 'utf8')) as { total?: Totals; days?: Record<string, Totals>; models?: Record<string, Totals>; last?: ApiCall[] };
      this.total = { ...empty(), ...j.total };
      this.days = new Map(Object.entries(j.days ?? {}));
      this.models = new Map(Object.entries(j.models ?? {}));
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
    if (c.model) {
      const m = this.models.get(c.model) ?? empty();
      add(m);
      this.models.set(c.model, m);
    }
    for (const k of [...this.days.keys()].sort().slice(0, -45)) this.days.delete(k); // só os últimos 45 dias
    this.last = [c, ...this.last].slice(0, KEEP);
    this.timer ??= setTimeout(() => {
      this.timer = null;
      try {
        mkdirSync(dirname(this.file), { recursive: true });
        writeFileSync(this.file, JSON.stringify({ total: this.total, days: Object.fromEntries(this.days), models: Object.fromEntries(this.models), last: this.last }));
      } catch { /* sem disco: segue só em memória */ }
    }, 2000);
    this.timer.unref?.();
  }

  /** Totais, os últimos 14 dias (para o gráfico; dias sem uso valem zero), o uso por modelo e os últimos pedidos. */
  summary(now = Date.now()) {
    const days = Array.from({ length: 14 }, (_, i) => {
      const day = dayOf(now - (13 - i) * 86_400_000);
      const t = this.days.get(day) ?? empty();
      return { day, requests: t.requests, errors: t.errors, tokens: t.promptTokens + t.completionTokens };
    });
    const models = [...this.models].map(([model, t]) => ({ model, requests: t.requests, tokens: t.promptTokens + t.completionTokens })).sort((a, b) => b.tokens - a.tokens || b.requests - a.requests).slice(0, 8);
    return { total: this.total, today: this.days.get(dayOf(now)) ?? empty(), days, models, last: this.last };
  }

  reset(): void {
    this.total = empty();
    this.days.clear();
    this.models.clear();
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
