import { describe, expect, it } from 'vitest';
import type { AgentInfo, TerminalEntry } from '../../../shared/types';
import { chatAgents, chatRole, dropArrived, QUEUE_MAX_MS } from './chats';

const agent = (id: string, kind: 'main' | 'sub', lastEventAt: number) => ({ id, kind, lastEventAt }) as AgentInfo;

describe('Conversas', () => {
  it('lista só os agentes principais, o mais recente primeiro', () => {
    const list = chatAgents([agent('a', 'main', 10), agent('s', 'sub', 99), agent('b', 'main', 50)]);
    expect(list.map((a) => a.id)).toEqual(['b', 'a']);
  });

  it('a mesma conversa aparece uma vez (fica a presente); sessão vazia e encerrada some', () => {
    const a = (id: string, o: Partial<AgentInfo>) => ({ kind: 'main', account: '.claude', stats: { toolCalls: 3 }, title: 't', lastEventAt: 1, status: 'idle', ...o, id }) as AgentInfo;
    const list = chatAgents([
      a('velho', { sessionId: 's1', status: 'offline', lastEventAt: 90 }),
      a('novo', { sessionId: 's1', status: 'idle', lastEventAt: 50 }),
      a('outra', { sessionId: 's2', lastEventAt: 70 }),
      a('vazia', { sessionId: 's3', title: undefined, stats: { toolCalls: 0 } as AgentInfo['stats'], status: 'done', lastEventAt: 99 }),
      a('trabalhando-sem-titulo', { sessionId: 's4', title: undefined, stats: { toolCalls: 0 } as AgentInfo['stats'], status: 'working', lastEventAt: 10 }),
    ]);
    expect(list.map((x) => x.id)).toEqual(['outra', 'novo', 'trabalhando-sem-titulo']);
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

describe('Fila de mensagens', () => {
  it('tira da fila o que a conversa já mostrou, uma vez por mensagem, e o que passou do prazo', () => {
    const q = [{ text: 'faz o deploy', at: 0 }, { text: 'faz o deploy', at: 1 }, { text: 'e o  teste', at: 2 }, { text: 'velha', at: -QUEUE_MAX_MS }];
    const left = dropArrived(q, ['faz o deploy', 'e o teste\n\nAnexo enviado pelo DevLand'], 10);
    expect(left).toEqual([{ text: 'faz o deploy', at: 1 }]);
  });
});
