import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadLiveAgents, MAX_RESUME, saveLiveAgents } from './live-agents';

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
});
