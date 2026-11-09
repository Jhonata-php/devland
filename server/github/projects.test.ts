import { describe, expect, it } from 'vitest';
import { checksOf, commitsPerDay, githubUrl } from './projects';

describe('projetos git', () => {
  it('converte o origin do GitHub (https e ssh) em link; outros servidores ficam sem', () => {
    expect(githubUrl('git@github.com:Jhonata-php/devland.git')).toBe('https://github.com/Jhonata-php/devland');
    expect(githubUrl('https://github.com/a/b.git\n')).toBe('https://github.com/a/b');
    expect(githubUrl('https://gitlab.com/a/b.git')).toBeUndefined();
  });
  it('conta commits por dia, de 13 dias atrás até hoje', () => {
    const now = new Date(2026, 10, 9, 15).getTime();
    const day = 86_400_000;
    const c = commitsPerDay([now - 1000, now - day, now - day, now - 20 * day], now);
    expect(c).toHaveLength(14);
    expect(c[13]).toBe(1);
    expect(c[12]).toBe(2);
    expect(c.reduce((a, b) => a + b, 0)).toBe(3);
  });
});

describe('checksOf', () => {
  it('resume o CI do PR: falha ganha de pendente, que ganha de ok', () => {
    expect(checksOf(undefined)).toBe('none');
    expect(checksOf([{ conclusion: 'SUCCESS' }, { state: 'SUCCESS' }])).toBe('ok');
    expect(checksOf([{ conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS' }])).toBe('pending');
    expect(checksOf([{ status: 'IN_PROGRESS' }, { conclusion: 'FAILURE' }])).toBe('fail');
  });
});
