import { describe, expect, it } from 'vitest';
import { checksOf, commitsPerDay, githubUrl, pushBranch } from './projects';

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

describe('enviar ao GitHub (push)', () => {
  /** git de mentira: guarda os comandos e responde o que o teste combinou (null = o comando falhou). */
  const fake = (answers: Record<string, string | null>) => {
    const calls: string[] = [];
    const run = async (_f: string, args: string[]) => {
      const key = args.join(' ');
      calls.push(key);
      return key in answers ? answers[key]! : '';
    };
    return { calls, run };
  };

  it('só envia a branch quando não há mensagem (não mexe nos arquivos)', async () => {
    const { calls, run } = fake({ 'rev-parse --abbrev-ref HEAD': 'feature\n' });
    expect(await pushBranch('/p', undefined, run)).toEqual({ branch: 'feature', committed: 0 });
    expect(calls).toEqual(['rev-parse --abbrev-ref HEAD', 'push -u origin HEAD']);
  });

  it('com mensagem e arquivos mudados: commit de tudo e depois o envio', async () => {
    const { calls, run } = fake({ 'rev-parse --abbrev-ref HEAD': 'feature\n', 'status --porcelain': ' M a.ts\n?? b.ts\n' });
    expect(await pushBranch('/p', '  ajusta a tela  ', run)).toEqual({ branch: 'feature', committed: 2 });
    expect(calls).toEqual(['rev-parse --abbrev-ref HEAD', 'status --porcelain', 'add -A', 'commit -m ajusta a tela', 'push -u origin HEAD']);
  });

  it('sem alterações a mensagem não gera commit vazio; falhas viram motivo', async () => {
    const clean = fake({ 'rev-parse --abbrev-ref HEAD': 'main\n', 'status --porcelain': '' });
    expect(await pushBranch('/p', 'x', clean.run)).toEqual({ branch: 'main', committed: 0 });
    expect(clean.calls).not.toContain('add -A');
    await expect(pushBranch('/p', undefined, fake({ 'rev-parse --abbrev-ref HEAD': 'HEAD\n' }).run)).rejects.toThrow('detached');
    await expect(pushBranch('/p', undefined, fake({ 'rev-parse --abbrev-ref HEAD': 'x\n', 'push -u origin HEAD': null }).run)).rejects.toThrow('push');
    await expect(pushBranch('/p', 'm', fake({ 'rev-parse --abbrev-ref HEAD': 'x\n', 'status --porcelain': ' M a\n', 'commit -m m': null }).run)).rejects.toThrow('commit');
  });
});
