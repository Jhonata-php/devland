import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listResumeProcs, ppidOf, resumeSessionOf } from './orphans';

const SID = '562f5f1b-748a-449f-93aa-e1008930237e';

describe('terminais órfãos', () => {
  it('reconhece claude --resume e ignora o resto', () => {
    expect(resumeSessionOf(['/usr/local/bin/claude', '--resume', SID, '--', 'oi'].join('\0'))).toBe(SID);
    expect(resumeSessionOf(['node', '/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js', '--resume', SID].join('\0'))).toBe(SID);
    expect(resumeSessionOf(['/usr/local/bin/claude', '--bg'].join('\0'))).toBeUndefined();
    expect(resumeSessionOf(['vim', '--resume', SID].join('\0'))).toBeUndefined();
  });
  it('lê o ppid mesmo com espaço no nome', () => {
    expect(ppidOf('123 (claude code) S 1 123 123 0')).toBe(1);
    expect(ppidOf('77 (node) S 55 77 77 0')).toBe(55);
  });
  it('varre um /proc falso', () => {
    const proc = mkdtempSync(join(tmpdir(), 'proc-'));
    const add = (pid: number, ppid: number, cmd: string[]) => {
      mkdirSync(join(proc, String(pid)));
      writeFileSync(join(proc, String(pid), 'cmdline'), cmd.join('\0'));
      writeFileSync(join(proc, String(pid), 'stat'), `${pid} (claude) S ${ppid} 1 1 0`);
    };
    add(10, 1, ['/usr/local/bin/claude', '--resume', SID]);
    add(11, 50, ['/usr/local/bin/claude', '--resume', SID]);
    add(12, 1, ['bash']);
    expect(listResumeProcs(proc).sort((a, b) => a.pid - b.pid)).toEqual([
      { pid: 10, ppid: 1, sessionId: SID },
      { pid: 11, ppid: 50, sessionId: SID },
    ]);
  });
});
