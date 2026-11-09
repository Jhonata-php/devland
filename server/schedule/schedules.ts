// Agentes agendados: um pedido que abre um agente novo sozinho, nos dias e no horário escolhidos (ex.: revisar os PRs
// toda manhã às 9h). O horário vale no fuso de quem agendou (o navegador manda o fuso IANA, ex. America/Sao_Paulo): o
// servidor do Cloud costuma rodar em UTC. Guardado em <dataDir>/schedules.json; quem abre o agente é o mesmo "Novo
// agente" (SpawnService.submit), com as mesmas travas.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tr } from '../../shared/i18n';
import { isModelId } from '../../shared/models';

export interface Schedule {
  id: string;
  folder: string;
  prompt: string;
  account?: string;
  role?: string;
  /** Apelido do modelo do Claude (shared/models.ts); ausente = o padrão da conta. */
  model?: string;
  /** "HH:MM" no fuso `tz`. */
  time: string;
  /** Dias da semana (0 = domingo … 6 = sábado). */
  days: number[];
  tz: string;
  enabled: boolean;
  createdAt: number;
  /** Último disparo (epoch ms): evita abrir duas vezes no mesmo minuto/dia. */
  lastRunAt?: number;
}

export const MAX_SCHEDULES = 20;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Dia da semana, data e "HH:MM" de um instante no fuso dado. */
export function zonedParts(at: number, tz: string): { day: number; date: string; time: string } {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday ?? '');
  return { day, date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** Agendamentos que devem rodar agora: horário já chegou hoje (no fuso), dia certo, e ainda não rodou hoje. */
export function dueSchedules(list: readonly Schedule[], now: number): Schedule[] {
  return list.filter((s) => {
    if (!s.enabled) return false;
    const n = zonedParts(now, s.tz);
    if (!s.days.includes(n.day) || n.time < s.time) return false;
    // Só dentro de 10 min depois do horário (servidor fora do ar por horas não dispara tudo atrasado).
    const [h, m] = s.time.split(':').map(Number);
    const [nh, nm] = n.time.split(':').map(Number);
    if (nh * 60 + nm - (h * 60 + m) > 10) return false;
    return !s.lastRunAt || zonedParts(s.lastRunAt, s.tz).date !== n.date;
  });
}

/** Valida o pedido da página. Lança Error com a mensagem para o usuário. */
export function parseSchedule(raw: unknown, now: number): Schedule {
  const b = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const folder = str(b.folder, 1024);
  const prompt = str(b.prompt, 8000);
  const time = str(b.time, 5);
  const tz = str(b.tz, 64) || 'UTC';
  const days = Array.isArray(b.days) ? [...new Set(b.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
  if (!folder) throw new Error(tr('Escolha a pasta do projeto.'));
  if (!prompt) throw new Error(tr('Escreva o que o agente deve fazer.'));
  if (!TIME.test(time)) throw new Error(tr('Horário inválido (use HH:MM).'));
  if (!days.length) throw new Error(tr('Escolha pelo menos um dia.'));
  try {
    zonedParts(now, tz);
  } catch {
    throw new Error(tr('Fuso horário inválido.'));
  }
  const s: Schedule = { id: randomUUID(), folder, prompt, time, days, tz, enabled: true, createdAt: now };
  const account = str(b.account, 128);
  const role = str(b.role, 32);
  if (account && account !== 'auto') s.account = account;
  if (role && role !== 'auto') s.role = role;
  const model = str(b.model, 16);
  if (isModelId(model)) s.model = model;
  return s;
}

export class ScheduleStore {
  private list: Schedule[] = [];
  constructor(private readonly file: string) {}

  load(): void {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      if (Array.isArray(raw)) this.list = raw.filter((s): s is Schedule => !!s && typeof s === 'object' && typeof (s as Schedule).id === 'string');
    } catch {
      this.list = [];
    }
  }

  all(): Schedule[] {
    return this.list.map((s) => ({ ...s }));
  }

  add(s: Schedule): Schedule {
    if (this.list.length >= MAX_SCHEDULES) throw new Error(tr('Limite de {0} agendamentos.', [MAX_SCHEDULES]));
    this.list.push(s);
    this.save();
    return s;
  }

  remove(id: string): boolean {
    const n = this.list.length;
    this.list = this.list.filter((s) => s.id !== id);
    if (this.list.length !== n) this.save();
    return this.list.length !== n;
  }

  setEnabled(id: string, enabled: boolean): Schedule | undefined {
    const s = this.list.find((x) => x.id === id);
    if (!s) return undefined;
    s.enabled = enabled;
    this.save();
    return { ...s };
  }

  markRun(id: string, at: number): void {
    const s = this.list.find((x) => x.id === id);
    if (!s) return;
    s.lastRunAt = at;
    this.save();
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.list, null, 2), { mode: 0o600 });
    renameSync(`${this.file}.tmp`, this.file);
  }
}
