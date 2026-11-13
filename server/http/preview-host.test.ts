import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createPreview } from './preview';
import { frameable, startPreviewHost } from './preview-host';

const servers: http.Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

function listen(s: http.Server): Promise<number> {
  servers.push(s);
  return new Promise((ok) => s.listen(0, '127.0.0.1', () => ok((s.address() as AddressInfo).port)));
}

describe('prévia em domínio próprio', () => {
  it('tira X-Frame-Options e frame-ancestors, e mantém o resto do CSP', () => {
    const out = frameable({ 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'self'; frame-ancestors 'none'", 'content-type': 'text/html' });
    expect(out['x-frame-options']).toBeUndefined();
    expect(out['content-security-policy']).toBe("default-src 'self'");
    expect(out['content-type']).toBe('text/html');
  });

  it('só repassa com o cookie do link assinado, na raiz e com os caminhos intactos', async () => {
    const app = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'X-Frame-Options': 'DENY' });
      res.end(`app:${req.url}:${req.headers.cookie ?? ''}`);
    });
    const appPort = await listen(app);
    const preview = createPreview({ blockedPorts: () => [] });
    const host = startPreviewHost({ port: 0, host: '127.0.0.1', preview });
    servers.push(host);
    await new Promise((ok) => host.once('listening', ok));
    const hostPort = (host.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${hostPort}`;

    expect((await fetch(`${base}/_next/x.js`)).status).toBe(403);
    const token = preview.issue(appPort)!.slice('/preview/'.length, -1);
    const open = await fetch(`${base}/__devland/open?t=${encodeURIComponent(token)}`, { redirect: 'manual' });
    expect(open.status).toBe(302);
    const cookie = open.headers.get('set-cookie')!.split(';')[0]!;
    const r = await fetch(`${base}/_next/x.js?a=1`, { headers: { cookie: `${cookie}; sessao=abc` } });
    expect(r.status).toBe(200);
    expect(r.headers.get('x-frame-options')).toBeNull();
    expect(await r.text()).toBe('app:/_next/x.js?a=1:sessao=abc');
    expect((await fetch(`${base}/__devland/open?t=1234/1.${'0'.repeat(32)}`, { redirect: 'manual' })).status).toBe(403);
  });
});
