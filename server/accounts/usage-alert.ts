// Alerta de uso do plano: UM aviso quando uma conta chega perto do limite da sessão de 5 horas ou da semana, e UM aviso
// quando esse limite renova. Nada no meio: enquanto a conta continua alta, não repete.
//
// Por que não repete mesmo que o número mexa: o estado de cada conta+janela ("já avisei") fica em disco, então reiniciar o
// servidor (atualização, redeploy) não avisa tudo de novo; só se considera renovado depois de ficar bem abaixo do limite
// por alguns minutos seguidos (uma leitura isolada baixa, de outra fonte de uso, não conta); e depois de renovar há uma
// pausa antes de poder avisar de novo. Só leituras recentes (`usageStatus` "ok") mudam o estado.
// Puro e testado (usage-alert.test.ts); o servidor chama a cada snapshot.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AccountInfo } from '../../shared/types';

/** Percentual a partir do qual avisa "perto do limite" (uma vez por ciclo). */
export const LIMIT_AT = 95;
/** Abaixo disto, e por RESET_AFTER_MS seguidos, o limite conta como renovado. */
export const RESET_BELOW = 60;
export const RESET_AFTER_MS = 3 * 60_000;
/** Depois de renovar, não avisa o limite de novo por este tempo (cinto contra leitura que oscila). */
export const COOLDOWN_MS = 10 * 60_000;

type Window = 'fiveHour' | 'sevenDay';

export interface UsageNotice {
  accountId: string;
  accountName: string;
  window: Window;
  kind: 'limit' | 'reset';
  utilization: number;
}

interface State {
  /** Já avisou o limite neste ciclo (e ainda não avisou a renovação). */
  alerted: boolean;
  /** Desde quando a leitura está baixa (para confirmar a renovação). */
  lowSince?: number;
  /** Quando avisou a última renovação. */
  resetAt?: number;
}

export class UsageAlerts {
  private state: Record<string, State> = {};

  constructor(
    private readonly file?: string,
    private readonly now: () => number = Date.now,
  ) {
    try {
      const raw = JSON.parse(readFileSync(file ?? '', 'utf8')) as unknown;
      if (raw && typeof raw === 'object') this.state = raw as Record<string, State>;
    } catch {
      // sem arquivo: primeira vez
    }
  }

  /**
   * Avisos novos desta leitura. Na primeira vez que vê uma conta já acima do limite (instalação nova ou arquivo apagado),
   * só anota "já avisado": o aviso daquele ciclo já foi dado ou não vale mais.
   */
  check(accounts: readonly AccountInfo[]): UsageNotice[] {
    const out: UsageNotice[] = [];
    const t = this.now();
    let dirty = false;
    for (const a of accounts) {
      if (a.usageStatus !== 'ok') continue;
      for (const window of ['fiveHour', 'sevenDay'] as const) {
        const w = a.usage?.[window];
        if (!w || !Number.isFinite(w.utilization)) continue;
        const key = `${a.id}|${window}`;
        const known = this.state[key];
        const u = w.utilization;
        if (!known) {
          this.state[key] = { alerted: u >= LIMIT_AT };
          dirty = true;
          continue;
        }
        if (!known.alerted) {
          const cooling = known.resetAt !== undefined && t - known.resetAt < COOLDOWN_MS;
          if (u >= LIMIT_AT && !cooling) {
            known.alerted = true;
            delete known.lowSince;
            dirty = true;
            out.push({ accountId: a.id, accountName: a.name, window, kind: 'limit', utilization: Math.round(u) });
          }
          continue;
        }
        if (u >= RESET_BELOW) {
          if (known.lowSince !== undefined) {
            delete known.lowSince;
            dirty = true;
          }
        } else if (known.lowSince === undefined) {
          known.lowSince = t;
          dirty = true;
        } else if (t - known.lowSince >= RESET_AFTER_MS) {
          known.alerted = false;
          delete known.lowSince;
          known.resetAt = t;
          dirty = true;
          out.push({ accountId: a.id, accountName: a.name, window, kind: 'reset', utilization: Math.round(u) });
        }
      }
    }
    if (dirty) this.save();
    return out;
  }

  private save(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.state));
      renameSync(tmp, this.file);
    } catch {
      // segue em memória até o próximo reinício
    }
  }
}
