import { describe, expect, it } from 'vitest';
import { callbackUrl, extractAuthUrl } from './oauth-url';

const SCREEN = [
  'Authenticating with ns1…',
  '',
  '  If your browser doesn\'t open automatically, copy this URL manually',
  '  https://ns1.needbr.com/oauth/authorize?response_type=code&client_id=vlxc_CUIY4&code_challenge=bDy6pbGtyNd',
  '  D2BLVvOq6FVK7ePdevrVbbu_aIg0Lb7w&code_challenge_method=S256&redirect_uri=http%3A%2F%2Flocalhost%3A54119%2Fcallback',
  '',
  '  If the redirect page shows a connection error, paste the URL',
  '  URL >',
].join('\r\n');

describe('login de conector', () => {
  it('junta o link quebrado em linhas e ignora o texto em volta', () => {
    expect(extractAuthUrl(SCREEN)).toBe('https://ns1.needbr.com/oauth/authorize?response_type=code&client_id=vlxc_CUIY4&code_challenge=bDy6pbGtyNdD2BLVvOq6FVK7ePdevrVbbu_aIg0Lb7w&code_challenge_method=S256&redirect_uri=http%3A%2F%2Flocalhost%3A54119%2Fcallback');
    expect(extractAuthUrl('\u001b[31mhttps://exemplo.com/docs\u001b[0m')).toBeUndefined();
    expect(extractAuthUrl('nada aqui')).toBeUndefined();
  });
  it('só aceita como retorno o endereço de localhost com o código', () => {
    expect(callbackUrl('  http://localhost:54119/callback?code=abc&state=x ')).toBe('http://localhost:54119/callback?code=abc&state=x');
    expect(callbackUrl('http://127.0.0.1:1/callback?error=access_denied')).toBeDefined();
    expect(callbackUrl('https://evil.example/callback?code=abc')).toBeUndefined();
    expect(callbackUrl('http://localhost:54119/callback')).toBeUndefined();
    expect(callbackUrl('lixo')).toBeUndefined();
  });
});
