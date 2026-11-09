import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { McpStore, parseMcpList } from './mcp';

describe('conectores MCP', () => {
  it('lê a saída do claude mcp list', () => {
    const out = 'Checking MCP server health…\n\nvelix: https://ns1.example.com/api/mcp (HTTP) - ✔ Connected\nplaywright: npx @playwright/mcp@latest - ✗ Failed to connect\nsentry: https://mcp.sentry.dev/mcp (HTTP) - ⚠ Needs authentication\n';
    expect(parseMcpList(out)).toEqual([
      { name: 'velix', target: 'https://ns1.example.com/api/mcp', transport: 'http', status: 'ok', detail: 'Connected' },
      { name: 'playwright', target: 'npx @playwright/mcp@latest', transport: 'stdio', status: 'fail', detail: 'Failed to connect' },
      { name: 'sentry', target: 'https://mcp.sentry.dev/mcp', transport: 'http', status: 'auth', detail: 'Needs authentication' },
    ]);
  });

  it('o nome de exibição fica salvo, vale só na tela e some com o conector', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-'));
    try {
      const file = join(dir, 'mcp-names.json');
      const store = new McpStore('claude', () => [], file);
      store.rename('ns1', '  Painel   do Velix ');
      expect(new McpStore('claude', () => [], file)['aliases']).toEqual({ ns1: 'Painel do Velix' });
      expect(() => store.rename('ns1', 'x'.repeat(41))).toThrow();
      expect(() => store.rename('../x', 'ok')).toThrow();
      store.rename('ns1', '');
      expect(new McpStore('claude', () => [], file)['aliases']).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
