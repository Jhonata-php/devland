import { describe, expect, it } from 'vitest';
import { agentRole, roleFromTitle } from './roles';

const base = { kind: 'main' as const, title: '', name: 'Ana', recent: [] };
const act = (kind: 'edit' | 'run', detail: string) => ({ id: '1', kind, icon: '', text: detail, detail, at: 0 });

describe('roles', () => {
  it('lê a etiqueta do nome da sessão', () => {
    expect(roleFromTitle('DevLand [front]: ajustar botão')).toBe('front');
    expect(roleFromTitle('DevLand [xyz]: nada')).toBeUndefined();
  });
  it('deduz pelos arquivos e pelo projeto', () => {
    expect(agentRole({ ...base, activity: act('edit', 'src/App.tsx') })).toBe('front');
    expect(agentRole({ ...base, activity: act('edit', 'server/db.py') })).toBe('back');
    expect(agentRole({ ...base, activity: act('edit', 'a/b.test.ts') })).toBe('tests');
    expect(agentRole(base, { name: 'meu-backend', path: '/x' })).toBe('back');
    expect(agentRole({ ...base, kind: 'sub' as never })).toBeUndefined();
  });
  it('a etiqueta vale mais que a dedução', () => {
    expect(agentRole({ ...base, title: 'DevLand [review]: x', activity: act('edit', 'a.tsx') })).toBe('review');
  });
});
