import { describe, expect, it } from 'vitest';
import { dueSchedules, parseSchedule, zonedParts, type Schedule } from './schedules';

// 2026-11-09 12:00 UTC = 09:00 em São Paulo (segunda-feira).
const MON_9_SP = Date.UTC(2026, 10, 9, 12, 0);
const base = (over: Partial<Schedule> = {}): Schedule => ({ id: 'a', folder: '/w', prompt: 'p', time: '09:00', days: [1], tz: 'America/Sao_Paulo', enabled: true, createdAt: 0, ...over });

describe('agendamentos', () => {
  it('hora e dia no fuso de quem agendou', () => {
    expect(zonedParts(MON_9_SP, 'America/Sao_Paulo')).toEqual({ day: 1, date: '2026-11-09', time: '09:00' });
  });
  it('roda no horário, uma vez por dia, só nos dias escolhidos', () => {
    expect(dueSchedules([base()], MON_9_SP).length).toBe(1);
    expect(dueSchedules([base()], MON_9_SP - 60_000).length).toBe(0);
    expect(dueSchedules([base({ lastRunAt: MON_9_SP })], MON_9_SP + 120_000).length).toBe(0);
    expect(dueSchedules([base({ days: [2] })], MON_9_SP).length).toBe(0);
    expect(dueSchedules([base({ enabled: false })], MON_9_SP).length).toBe(0);
  });
  it('não dispara atrasado demais (servidor fora do ar)', () => {
    expect(dueSchedules([base()], MON_9_SP + 9 * 60_000).length).toBe(1);
    expect(dueSchedules([base()], MON_9_SP + 30 * 60_000).length).toBe(0);
  });
  it('valida o pedido', () => {
    const s = parseSchedule({ folder: '/w', prompt: 'revisar', time: '08:30', days: [1, 1, 5, 9], tz: 'America/Sao_Paulo', account: 'auto' }, 0);
    expect(s).toMatchObject({ folder: '/w', prompt: 'revisar', time: '08:30', days: [1, 5], enabled: true });
    expect(s.account).toBeUndefined();
    expect(() => parseSchedule({ folder: '/w', prompt: 'x', time: '25:00', days: [1] }, 0)).toThrow();
    expect(() => parseSchedule({ folder: '/w', prompt: 'x', time: '09:00', days: [] }, 0)).toThrow();
    expect(() => parseSchedule({ folder: '/w', prompt: 'x', time: '09:00', days: [1], tz: 'Lua/Base' }, 0)).toThrow();
  });
});
