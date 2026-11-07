// Sessão nova sem conta pedida: a conta conectada com mais folga de uso (o maior uso entre a janela de 5 h e a semana; o menor
// vence). Sem números de uso a conta conta como 50%, então não passa na frente de uma com folga conhecida. Empate (diferença de
// até 1 ponto) fica com a primeira da lista, que é a padrão.
export interface PickCandidate {
  id: string;
  /** Tem login (no Cloud: .credentials.json na pasta da conta). */
  connected: boolean;
  fiveHour?: number;
  sevenDay?: number;
}

export function pickAccountByLoad(list: readonly PickCandidate[]): string | undefined {
  let best: { id: string; load: number } | undefined;
  for (const a of list) {
    if (!a.connected) continue;
    const known = a.fiveHour !== undefined || a.sevenDay !== undefined;
    const load = known ? Math.max(a.fiveHour ?? 0, a.sevenDay ?? 0) : 50;
    if (!best || load < best.load - 1) best = { id: a.id, load };
  }
  return best?.id;
}
