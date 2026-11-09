import { describe, expect, it } from 'vitest';
import { parseConnector } from './mcp-parse';

const cat = [{ name: 'notion', title: 'Notion', transport: 'http', target: 'https://mcp.notion.com/mcp' }];

describe('parseConnector', () => {
  it('entende o comando claude mcp add', () => {
    expect(parseConnector('claude mcp add --transport http sentry https://mcp.sentry.dev/mcp', cat)).toEqual([{ name: 'sentry', transport: 'http', target: 'https://mcp.sentry.dev/mcp' }]);
    expect(parseConnector('claude mcp add playwright -- npx @playwright/mcp@latest', cat)).toEqual([{ name: 'playwright', transport: 'stdio', target: 'npx @playwright/mcp@latest' }]);
  });
  it('entende o JSON de mcpServers', () => {
    expect(parseConnector('{"mcpServers":{"supabase":{"command":"npx","args":["-y","@supabase/mcp-server-supabase"]},"x":{"url":"https://x.dev/sse","type":"sse"}}}', cat)).toEqual([
      { name: 'supabase', transport: 'stdio', target: 'npx -y @supabase/mcp-server-supabase' },
      { name: 'x', transport: 'sse', target: 'https://x.dev/sse' },
    ]);
  });
  it('entende endereço solto e nome de sugerido', () => {
    expect(parseConnector('usa este: https://mcp.stripe.com', cat)).toEqual([{ name: 'stripe', transport: 'http', target: 'https://mcp.stripe.com' }]);
    expect(parseConnector('quero o notion', cat)).toEqual([{ name: 'notion', transport: 'http', target: 'https://mcp.notion.com/mcp' }]);
    expect(parseConnector('oi', cat)).toEqual([]);
  });
});
