import { describe, expect, it } from 'vitest';
import { clampPos } from './drag';

describe('janelas arrastáveis', () => {
  it('mantém o cabeçalho à vista', () => {
    expect(clampPos(100, 100, 400, 1200, 800)).toEqual({ x: 100, y: 100 });
    expect(clampPos(-1000, -50, 400, 1200, 800)).toEqual({ x: -340, y: 0 });
    expect(clampPos(5000, 5000, 400, 1200, 800)).toEqual({ x: 1140, y: 760 });
  });
});
