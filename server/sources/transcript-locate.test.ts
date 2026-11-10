import { describe, expect, it } from 'vitest';
import { locateTranscript } from './transcript-locate';

describe('locateTranscript', () => {
  it('mantém o caminho quando o arquivo existe', () => {
    expect(locateTranscript('/h/.claude-2/projects/-w-x/s1.jsonl', ['/h/.claude'], () => true)).toBe('/h/.claude-2/projects/-w-x/s1.jsonl');
  });
  it('acha a sessão na pasta de outra conta (serviço de segundo plano)', () => {
    const real = '/h/.claude/projects/-w-x/s2.jsonl';
    expect(locateTranscript('/h/.claude-2/projects/-w-x/s2.jsonl', ['/h/.claude-2', '/h/.claude'], (p) => p === real)).toBe(real);
  });
  it('sem achar, devolve o caminho original', () => {
    expect(locateTranscript('/h/.claude-2/projects/-w-x/s3.jsonl', ['/nao/existe'], () => false)).toBe('/h/.claude-2/projects/-w-x/s3.jsonl');
    expect(locateTranscript(undefined, ['/h'], () => false)).toBeUndefined();
  });
});
