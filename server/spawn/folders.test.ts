import { describe, expect, it } from 'vitest';
import { projectFolder, recentFolders } from './folders';

describe('pastas sugeridas no Novo agente', () => {
  it('worktree de agente vira o projeto; temporária e relativa ficam de fora', () => {
    expect(projectFolder('/Users/a/Coding/morgana/.claude/worktrees/read-outcome-4c9d08')).toBe('/Users/a/Coding/morgana');
    expect(projectFolder('/Users/a/proj/.codex/worktrees/x/sub')).toBe('/Users/a/proj');
    expect(projectFolder('/Users/a/proj/')).toBe('/Users/a/proj');
    expect(projectFolder('/private/tmp/claude-501/scratch')).toBeUndefined();
    expect(projectFolder('/var/folders/xy/T/abc')).toBeUndefined();
    expect(projectFolder('/Users/a/Library/Application Support/Claude/scratch-workspaces/e8/60/scratch-2026-10-12-315a47')).toBeUndefined();
    expect(projectFolder('relativo')).toBeUndefined();
    expect(projectFolder('C:\\code\\win')).toBe('C:\\code\\win');
    expect(projectFolder(undefined)).toBeUndefined();
  });

  it('junta sessões e salas por pasta, mais recente primeiro, com limite', () => {
    const sessions = [
      { project: '/Users/a/loja', lastAt: 100 },
      { project: '/Users/a/loja/.claude/worktrees/w1', lastAt: 300 },
      { project: '/Users/a/devland', lastAt: 200 },
      { project: '/tmp/x', lastAt: 999 },
      { lastAt: 500 },
    ];
    const rooms = [{ path: '/Users/a/sala-nova', lastAt: 250 }, { path: '/Users/a/devland', lastAt: 50 }];
    expect(recentFolders(sessions, rooms)).toEqual([
      { path: '/Users/a/loja', name: 'loja', lastAt: 300, sessions: 2 },
      { path: '/Users/a/sala-nova', name: 'sala-nova', lastAt: 250, sessions: 0 },
      { path: '/Users/a/devland', name: 'devland', lastAt: 200, sessions: 1 },
    ]);
    expect(recentFolders(sessions, rooms, 1).map((f) => f.path)).toEqual(['/Users/a/loja']);
  });
});

describe('workspaceFolders / mergeFolders', () => {
  it('lista só pastas visíveis e não repete as recentes', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { workspaceFolders, mergeFolders } = await import('./folders');
    const root = mkdtempSync(join(tmpdir(), 'ws-'));
    mkdirSync(join(root, 'site'));
    mkdirSync(join(root, '.oculta'));
    writeFileSync(join(root, 'arquivo.txt'), '');
    const extra = workspaceFolders(root);
    expect(extra.map((f) => f.name)).toEqual(['site']);
    const merged = mergeFolders([{ path: join(root, 'site'), name: 'site', lastAt: 1, sessions: 2 }], extra);
    expect(merged).toHaveLength(1);
    expect(workspaceFolders('/não/existe')).toEqual([]);
  });
});
