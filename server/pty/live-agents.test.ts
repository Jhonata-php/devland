import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dedupeLive, loadLiveAgents, MAX_RESUME, RESUME_GRACE_MS, saveLiveAgents, transcriptCwd, withResuming } from './live-agents';

describe('agentes ativos guardados para retomar depois da reimplantação', () => {
  it('grava e lê, ignorando entradas inválidas e limitando a quantidade', () => {
    const dir = mkdtempSync(join(tmpdir(), 'live-'));
    const file = join(dir, 'live-agents.json');
    const good = { account: '.claude', sessionId: 'a1b2c3d4-e5f6-7890', cwd: '/workspace/site' };
    saveLiveAgents(file, [good, { ...good, sessionId: '../../etc/passwd' } as never, { account: 1 } as never]);
    expect(loadLiveAgents(file)).toEqual([good]);
    saveLiveAgents(file, Array.from({ length: 20 }, (_, i) => ({ ...good, sessionId: `sess-${String(i).padStart(8, '0')}` })));
    expect(loadLiveAgents(file)).toHaveLength(MAX_RESUME);
  });

  it('arquivo ausente ou quebrado dá lista vazia', () => {
    const dir = mkdtempSync(join(tmpdir(), 'live-'));
    expect(loadLiveAgents(join(dir, 'nao-existe.json'))).toEqual([]);
    writeFileSync(join(dir, 'x.json'), '{nao é json');
    expect(loadLiveAgents(join(dir, 'x.json'))).toEqual([]);
  });

  it('worktree volta para a raiz do projeto e a conversa repetida some', () => {
    const a = { account: '.claude', sessionId: 'a1b2c3d4-e5f6-7890', cwd: '/workspace/site/.claude/worktrees/fix' };
    expect(dedupeLive([a, { ...a, cwd: '/workspace/site' }])).toEqual([{ ...a, cwd: '/workspace/site' }]);
  });
});

describe('withResuming', () => {
  const a = { account: 'a', sessionId: 'aaaaaaaa', cwd: '/w/a' };
  const b = { account: 'a', sessionId: 'bbbbbbbb', cwd: '/w/b' };
  it('nos primeiros minutos a conversa que ainda está voltando não sai da lista', () => {
    expect(withResuming([a], [a, b], 60_000).map((x) => x.sessionId)).toEqual(['aaaaaaaa', 'bbbbbbbb']);
  });
  it('depois do prazo vale só o que está vivo', () => {
    expect(withResuming([a], [a, b], RESUME_GRACE_MS).map((x) => x.sessionId)).toEqual(['aaaaaaaa']);
  });
});

describe('transcriptCwd', () => {
  it('lê a pasta gravada no histórico e volta do worktree para a raiz do projeto', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cwd-'));
    const f = join(dir, 's.jsonl');
    writeFileSync(f, '{"type":"summary"}\n{"type":"user","cwd":"/workspace/wsat/.claude/worktrees/x","sessionId":"s"}\n');
    expect(transcriptCwd(f)).toBe('/workspace/wsat');
    expect(transcriptCwd(join(dir, 'nada.jsonl'))).toBeUndefined();
  });
});
