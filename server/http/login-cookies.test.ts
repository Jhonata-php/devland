import { describe, expect, it } from 'vitest';
import { KEEP_COOKIE, loginCookies } from './remote';

describe('Lembrar de mim', () => {
  it('marcado: cookies persistentes; desmarcado: cookie de sessão e a marca apagada', () => {
    const [keep, mark] = loginCookies('tok', 100, true, true);
    expect(keep).toContain('Max-Age=100');
    expect(mark).toMatch(new RegExp(`^${KEEP_COOKIE}=1;.*Max-Age=100`));
    const [temp, clear] = loginCookies('tok', 100, false, false);
    expect(temp).not.toContain('Max-Age');
    expect(clear).toContain('Max-Age=0');
  });
});
