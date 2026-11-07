import { describe, expect, it } from 'vitest';
import { pickAccountByLoad } from './pick-account';

describe('escolha da conta para uma sessão nova', () => {
  it('prefere a conta com mais folga (considera a pior entre 5 h e semana)', () => {
    expect(pickAccountByLoad([{ id: 'A', connected: true, fiveHour: 90, sevenDay: 20 }, { id: 'B', connected: true, fiveHour: 30, sevenDay: 40 }])).toBe('B');
  });
  it('ignora conta sem login e mantém a primeira em empate', () => {
    expect(pickAccountByLoad([{ id: 'A', connected: false, fiveHour: 0 }, { id: 'B', connected: true, fiveHour: 40 }])).toBe('B');
    expect(pickAccountByLoad([{ id: 'A', connected: true, fiveHour: 40 }, { id: 'B', connected: true, fiveHour: 40.5 }])).toBe('A');
  });
  it('sem números, uma conta com folga conhecida passa na frente', () => {
    expect(pickAccountByLoad([{ id: 'A', connected: true }, { id: 'B', connected: true, fiveHour: 10, sevenDay: 10 }])).toBe('B');
    expect(pickAccountByLoad([])).toBeUndefined();
  });
});
