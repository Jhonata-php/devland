import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyTranscript } from './transcript-copy';

describe('copyTranscript', () => {
  it('copia a sessão para a mesma pasta de projeto da outra conta', () => {
    const root = mkdtempSync(join(tmpdir(), 'tc-'));
    const a = join(root, '.claude');
    const b = join(root, '.claude-2');
    mkdirSync(join(a, 'projects', '-workspace-site'), { recursive: true });
    mkdirSync(b);
    writeFileSync(join(a, 'projects', '-workspace-site', 'sess-12345678.jsonl'), '{"cwd":"/workspace/site"}\n');
    expect(copyTranscript(a, b, 'sess-12345678')).toBe(true);
    expect(readFileSync(join(b, 'projects', '-workspace-site', 'sess-12345678.jsonl'), 'utf8')).toBe('{"cwd":"/workspace/site"}\n');
    expect(copyTranscript(a, b, 'sess-outra000')).toBe(false);
  });
});
