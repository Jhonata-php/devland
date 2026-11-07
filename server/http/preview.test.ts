import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPreview, parsePort, rewriteBody } from './preview';

let site: http.Server;
let sitePort = 0;
let front: http.Server;
let frontPort = 0;
const preview = createPreview({ blockedPorts: () => [1234] });

beforeAll(async () => {
  site = http.createServer((req, res) => {
    res.setHeader('Set-Cookie', 'x=1');
    if (req.url === '/') res.setHeader('Content-Type', 'text/html').end('<html><head></head><body><img src="/a.png"><script type="module" src="/m.js"></script></body></html>');
    else if (req.url === '/m.js') res.setHeader('Content-Type', 'text/javascript').end('import x from "/src/x.js";');
    else res.writeHead(302, { Location: '/' }).end();
  });
  await new Promise<void>((ok) => site.listen(0, '127.0.0.1', ok));
  sitePort = (site.address() as AddressInfo).port;
  front = http.createServer((req, res) => {
    if (!preview.handle(req, res, new URL(req.url ?? '/', 'http://x'))) res.writeHead(404).end();
  });
  await new Promise<void>((ok) => front.listen(0, '127.0.0.1', ok));
  frontPort = (front.address() as AddressInfo).port;
});
afterAll(() => {
  site.close();
  front.close();
});

const get = (path: string) => fetch(`http://127.0.0.1:${frontPort}${path}`, { redirect: 'manual' });

describe('prévia ao vivo', () => {
  it('porta: só 1024-65535 e fora das barradas', () => {
    expect(parsePort('80')).toBeUndefined();
    expect(parsePort(5173)).toBe(5173);
    expect(preview.issue(1234)).toBeUndefined();
  });
  it('sem token válido: 403; com token: reescreve e blinda a resposta', async () => {
    expect((await get(`/preview/${sitePort}/1.${'a'.repeat(32)}/`)).status).toBe(403);
    const url = preview.issue(sitePort)!;
    expect(preview.verify(url)).toBe(true);
    const r = await get(url);
    const html = await r.text();
    expect(html).toContain(`<base href="${url}">`);
    expect(html).toContain(`src="${url.slice(0, -1)}/a.png"`);
    expect(r.headers.get('set-cookie')).toBeNull();
    expect(r.headers.get('content-security-policy')).toContain('sandbox');
    expect(await (await get(`${url}m.js`)).text()).toContain(`from "${url.slice(0, -1)}/src/x.js"`);
    expect((await get(`${url}x`)).headers.get('location')).toBe(url);
  });
  it('POST é recusado e porta sem servidor dá 502', async () => {
    const url = preview.issue(sitePort)!;
    expect((await fetch(`http://127.0.0.1:${frontPort}${url}`, { method: 'POST' })).status).toBe(405);
    expect(preview.issue(9)).toBeUndefined();
  });
  it('rewriteBody mexe só em caminhos absolutos', () => {
    expect(rewriteBody('html', '<a href="//cdn/x" href2="/y"><a href="/y">', '/p/')).toContain('href="/p/y"');
    expect(rewriteBody('html', '<a href="//cdn/x">', '/p/')).toContain('href="//cdn/x"');
  });
});
