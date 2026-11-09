import { describe, expect, it } from 'vitest';
import type { AccountInfo } from '../../shared/types';
import { usageAlerts } from './usage-alert';

const acc = (five: number, week = 10, resetsAt = 1): AccountInfo =>
  ({ id: '.claude', name: 'Conta A', short: 'A', color: '#f80', configDir: '/x', sessions: 0, usage: { source: 'oauth', fiveHour: { utilization: five, resetsAt }, sevenDay: { utilization: week } } }) as unknown as AccountInfo;

describe('usageAlerts', () => {
  it('avisa uma vez por limiar e por janela', () => {
    const fired = new Set<string>();
    expect(usageAlerts([acc(50)], fired)).toEqual([]);
    expect(usageAlerts([acc(82)], fired)).toEqual([{ accountId: '.claude', accountName: 'Conta A', window: 'fiveHour', threshold: 80, utilization: 82 }]);
    expect(usageAlerts([acc(85)], fired)).toEqual([]);
    expect(usageAlerts([acc(96)], fired).map((a) => a.threshold)).toEqual([95]);
    expect(usageAlerts([acc(99)], fired)).toEqual([]);
  });
  it('pulando direto para 97% avisa só o maior; janela nova avisa de novo', () => {
    const fired = new Set<string>();
    expect(usageAlerts([acc(97)], fired).map((a) => a.threshold)).toEqual([95]);
    expect(usageAlerts([acc(81, 10, 2)], fired).map((a) => a.threshold)).toEqual([80]);
  });
  it('limite semanal também avisa', () => {
    expect(usageAlerts([acc(10, 90)], new Set()).map((a) => a.window)).toEqual(['sevenDay']);
  });
});
