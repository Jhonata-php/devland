import { describe, expect, it } from 'vitest';
import { packageName, recommend } from './local';

describe('IA local', () => {
  it('recomenda o maior modelo de código que cabe com folga na memória', () => {
    expect(recommend(2)).toBe('qwen2.5-coder:1.5b');
    expect(recommend(6)).toBe('qwen2.5-coder:3b');
    expect(recommend(16)).toBe('qwen2.5-coder:7b');
  });
  it('escolhe o pacote do Ollama pelo sistema', () => {
    expect(packageName('linux', 'arm64')).toBe('ollama-linux-arm64.tar.zst');
    expect(packageName('linux', 'x64')).toBe('ollama-linux-amd64.tar.zst');
    expect(packageName('darwin', 'arm64')).toBe('ollama-darwin.tgz');
    expect(packageName('win32', 'x64')).toBeNull();
  });
});
