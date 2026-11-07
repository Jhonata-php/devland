import { describe, expect, it } from 'vitest';
import type { AgentInfo, TerminalEntry } from '../../../shared/types';
import { chatAgents, chatRole } from './chats';

const agent = (id: string, kind: 'main' | 'sub', lastEventAt: number) => ({ id, kind, lastEventAt }) as AgentInfo;

describe('Conversas', () => {
  it('lista só os agentes principais, o mais recente primeiro', () => {
    const list = chatAgents([agent('a', 'main', 10), agent('s', 'sub', 99), agent('b', 'main', 50)]);
    expect(list.map((a) => a.id)).toEqual(['b', 'a']);
  });

  it('o que vira balão, aviso ou linha de ferramenta', () => {
    const e = (x: object) => ({ id: '1', at: 1, ...x }) as TerminalEntry;
    expect(chatRole(e({ kind: 'user', text: 'oi' }))).toBe('me');
    expect(chatRole(e({ kind: 'assistant', text: 'olá' }))).toBe('agent');
    expect(chatRole(e({ kind: 'assistant', text: '   ' }))).toBeNull();
    expect(chatRole(e({ kind: 'system', text: 'compactou' }))).toBe('note');
    expect(chatRole(e({ kind: 'tool', tool: 'Bash', title: 'Bash(ls)' }))).toBe('tool');
    expect(chatRole(e({ kind: 'result', toolUseId: 't', text: 'x' }))).toBeNull();
    expect(chatRole(e({ kind: 'thinking' }))).toBeNull();
  });
});
