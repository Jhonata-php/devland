// Alerta de uso do plano: avisa (no escritório e por notificação) quando uma conta passa de 80% e de 95% da sessão de
// 5 horas ou do limite semanal. Cada limiar avisa uma vez por janela: o `resetsAt` entra na chave, então a janela nova
// avisa de novo. Puro e testado (usage-alert.test.ts); o servidor chama a cada snapshot.
import type { AccountInfo } from '../../shared/types';

export const USAGE_THRESHOLDS = [80, 95] as const;

export interface UsageAlert {
  accountId: string;
  accountName: string;
  window: 'fiveHour' | 'sevenDay';
  threshold: number;
  utilization: number;
}

/** Limiares recém-cruzados (só o maior por janela). `fired` guarda o que já avisou e é atualizado aqui. */
export function usageAlerts(accounts: readonly AccountInfo[], fired: Set<string>): UsageAlert[] {
  const out: UsageAlert[] = [];
  for (const a of accounts) {
    for (const window of ['fiveHour', 'sevenDay'] as const) {
      const w = a.usage?.[window];
      if (!w || !Number.isFinite(w.utilization)) continue;
      let hit: number | undefined;
      for (const t of USAGE_THRESHOLDS) {
        if (w.utilization < t) continue;
        const key = `${a.id}|${window}|${t}|${w.resetsAt ?? ''}`;
        if (fired.has(key)) continue;
        fired.add(key);
        hit = t;
      }
      if (hit !== undefined) out.push({ accountId: a.id, accountName: a.name, window, threshold: hit, utilization: Math.round(w.utilization) });
    }
  }
  if (fired.size > 500) fired.clear();
  return out;
}
