import { describe, expect, it } from 'vitest';
import { parseMcpList } from './mcp';

describe('conectores MCP', () => {
  it('lê a saída do claude mcp list', () => {
    const out = 'Checking MCP server health…\n\nvelix: https://ns1.example.com/api/mcp (HTTP) - ✔ Connected\nplaywright: npx @playwright/mcp@latest - ✗ Failed to connect\nsentry: https://mcp.sentry.dev/mcp (HTTP) - ⚠ Needs authentication\n';
    expect(parseMcpList(out)).toEqual([
      { name: 'velix', target: 'https://ns1.example.com/api/mcp (HTTP)', status: 'ok', detail: 'Connected' },
      { name: 'playwright', target: 'npx @playwright/mcp@latest', status: 'fail', detail: 'Failed to connect' },
      { name: 'sentry', target: 'https://mcp.sentry.dev/mcp (HTTP)', status: 'auth', detail: 'Needs authentication' },
    ]);
  });
});
