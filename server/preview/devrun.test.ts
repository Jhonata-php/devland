import { describe, expect, it } from 'vitest';
import { pickScript, portFromOutput } from './devrun';

describe('rodar o projeto', () => {
  it('escolhe o script de desenvolvimento', () => {
    expect(pickScript({ build: 'x', dev: 'vite', start: 'node .' })).toBe('dev');
    expect(pickScript({ start: 'next start' })).toBe('start');
    expect(pickScript({ test: 'vitest' })).toBeUndefined();
    expect(pickScript(undefined)).toBeUndefined();
  });
  it('acha a porta na saída dos servidores comuns', () => {
    expect(portFromOutput('  ➜  Local:   http://localhost:5173/')).toBe(5173);
    expect(portFromOutput('\u001b[32m▲ Next.js\u001b[0m - Local: http://localhost:3220')).toBe(3220);
    expect(portFromOutput('Server listening on port 8080')).toBe(8080);
    expect(portFromOutput('listening at http://0.0.0.0:4000')).toBe(4000);
    expect(portFromOutput('compilando…')).toBeUndefined();
    expect(portFromOutput('localhost:80')).toBeUndefined();
  });
});
