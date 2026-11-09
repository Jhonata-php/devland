import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AccountInfo } from '../../shared/types';
import { COOLDOWN_MS, RESET_AFTER_MS, UsageAlerts } from './usage-alert';

const acc = (five: number, week = 10, status: AccountInfo['usageStatus'] = 'ok'): AccountInfo =>
  ({ id: '.claude', name: 'Conta A', short: 'A', color: '#f80', configDir: '/x', sessions: 0, usageStatus: status, usage: { source: 'oauth', fiveHour: { utilization: five, resetsAt: Math.random() }, sevenDay: { utilization: week } } }) as unknown as AccountInfo;

function clock() {
  let t = 1_000_000;
  return { now: () => t, tick: (ms: number) => (t += ms) };
}

describe('alerta de uso do plano', () => {
  it('avisa uma vez ao chegar perto do limite e não repete, mesmo com o número e o resetsAt mudando', () => {
    const c = clock();
    const u = new UsageAlerts(undefined, c.now);
    expect(u.check([acc(40)])).toEqual([]);
    expect(u.check([acc(96)]).map((n) => [n.window, n.kind, n.utilization])).toEqual([['fiveHour', 'limit', 96]]);
    for (const v of [97, 99, 100, 98, 100, 96]) {
      c.tick(5_000);
      expect(u.check([acc(v)])).toEqual([]);
    }
  });

  it('só avisa a renovação depois de ficar baixo por alguns minutos; uma leitura baixa isolada não conta', () => {
    const c = clock();
    const u = new UsageAlerts(undefined, c.now);
    u.check([acc(10)]);
    u.check([acc(100)]);
    // leitura baixa de outra fonte, e logo volta alto: nada
    c.tick(1_000);
    expect(u.check([acc(5)])).toEqual([]);
    c.tick(60_000);
    expect(u.check([acc(100)])).toEqual([]);
    // agora de verdade: baixo e assim fica
    c.tick(1_000);
    expect(u.check([acc(3)])).toEqual([]);
    c.tick(RESET_AFTER_MS - 1);
    expect(u.check([acc(4)])).toEqual([]);
    c.tick(1);
    expect(u.check([acc(4)]).map((n) => n.kind)).toEqual(['reset']);
    // renovou uma vez só
    c.tick(60_000);
    expect(u.check([acc(5)])).toEqual([]);
  });

  it('depois de renovar, o ciclo seguinte avisa de novo (com a pausa de segurança)', () => {
    const c = clock();
    const u = new UsageAlerts(undefined, c.now);
    u.check([acc(10)]);
    u.check([acc(97)]);
    u.check([acc(2)]);
    c.tick(RESET_AFTER_MS);
    expect(u.check([acc(2)]).map((n) => n.kind)).toEqual(['reset']);
    // subiu de novo cedo demais (dentro da pausa): ainda não avisa
    c.tick(60_000);
    expect(u.check([acc(96)])).toEqual([]);
    c.tick(COOLDOWN_MS);
    expect(u.check([acc(96)]).map((n) => n.kind)).toEqual(['limit']);
  });

  it('limite da semana avisa e renova por conta própria; leitura antiga (stale) não mexe em nada', () => {
    const c = clock();
    const u = new UsageAlerts(undefined, c.now);
    u.check([acc(10, 10)]);
    expect(u.check([acc(10, 96, 'stale')])).toEqual([]);
    expect(u.check([acc(10, 96)]).map((n) => [n.window, n.kind])).toEqual([['sevenDay', 'limit']]);
  });

  it('conta que já aparece acima do limite na primeira leitura não dispara aviso (evita rajada ao atualizar)', () => {
    const u = new UsageAlerts(undefined, clock().now);
    expect(u.check([acc(100, 100)])).toEqual([]);
  });

  it('o estado fica em disco: reiniciar não repete o aviso nem a renovação', () => {
    const dir = mkdtempSync(join(tmpdir(), 'usage-'));
    try {
      const file = join(dir, 'usage-alerts.json');
      const c = clock();
      const first = new UsageAlerts(file, c.now);
      first.check([acc(10)]);
      expect(first.check([acc(99)]).map((n) => n.kind)).toEqual(['limit']);
      const afterRestart = new UsageAlerts(file, c.now);
      expect(afterRestart.check([acc(99)])).toEqual([]);
      afterRestart.check([acc(1)]);
      c.tick(RESET_AFTER_MS);
      expect(afterRestart.check([acc(1)]).map((n) => n.kind)).toEqual(['reset']);
      expect(new UsageAlerts(file, c.now).check([acc(1)])).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
