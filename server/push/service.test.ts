import { createECDH } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PushService } from './service';

const sub = (endpoint = 'https://fcm.googleapis.com/fcm/send/abc') => {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  return { endpoint, keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: Buffer.alloc(16, 3).toString('base64url') } };
};
const make = (fetchFn?: typeof fetch) => {
  const s = new PushService({ dir: mkdtempSync(join(tmpdir(), 'push-')), subject: 'mailto:a@b.c', fetchFn });
  s.load();
  return s;
};

describe('PushService', () => {
  it('gera as chaves uma vez e guarda as assinaturas (sem repetir o mesmo aparelho)', () => {
    const s = make();
    expect(s.publicKey()).toMatch(/^[\w-]{80,100}$/);
    const a = sub();
    expect(s.subscribe(a)).toEqual({ ok: true });
    expect(s.subscribe(a)).toEqual({ ok: true });
    expect(s.count()).toBe(1);
  });

  it('recusa endereço que não é de servidor de push de navegador e dados mal formados', () => {
    const s = make();
    expect(s.subscribe(sub('https://interno.local/x')).ok).toBe(false);
    expect(s.subscribe(sub('http://fcm.googleapis.com/x')).ok).toBe(false);
    expect(s.subscribe({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'curto', auth: 'x' } }).ok).toBe(false);
    expect(s.count()).toBe(0);
  });

  it('manda a todos e tira a assinatura que o servidor de push diz que acabou (410)', async () => {
    const calls: string[] = [];
    const s = make((async (url: string) => {
      calls.push(url);
      return new Response(null, { status: url.includes('morta') ? 410 : 201 });
    }) as unknown as typeof fetch);
    s.subscribe(sub('https://fcm.googleapis.com/fcm/send/viva'));
    s.subscribe(sub('https://fcm.googleapis.com/fcm/send/morta'));
    expect(await s.notify({ title: 'DevLand', body: 'oi' })).toBe(1);
    expect(calls).toHaveLength(2);
    expect(s.count()).toBe(1);
  });
});
