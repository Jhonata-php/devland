import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encryptPayload, generateVapidKeys, vapidHeader } from './webpush';

const u = (s: string) => Buffer.from(s, 'base64url');

describe('Web Push (RFC 8291 / 8292)', () => {
  it('bate com o exemplo da RFC 8291 (Apêndice A)', () => {
    const body = encryptPayload(
      Buffer.from('When I grow up, I want to be a watermelon'),
      u('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'),
      u('BTBZMqHH6r4Tts7J_aSIgg'),
      { asPrivate: u('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'), salt: u('DGv6ra1nlYgDCS1FRnbzlw') },
    );
    expect(body.toString('base64url')).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    );
  });

  it('o navegador consegue decifrar o que o servidor cifrou (ida e volta)', () => {
    const ua = createECDH('prime256v1');
    ua.generateKeys();
    const auth = Buffer.alloc(16, 7);
    const text = JSON.stringify({ title: 'DevLand', body: 'Rafaela concluiu ✅' });
    const msg = encryptPayload(Buffer.from(text), ua.getPublicKey(), auth);
    const salt = msg.subarray(0, 16);
    const asPublic = msg.subarray(21, 21 + msg.readUInt8(20));
    const cipher = msg.subarray(21 + asPublic.length);
    const shared = ua.computeSecret(asPublic);
    const ikm = Buffer.from(hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]), 32));
    const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
    const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
    const d = createDecipheriv('aes-128-gcm', cek, nonce);
    d.setAuthTag(cipher.subarray(cipher.length - 16));
    const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
    expect(plain.subarray(0, plain.length - 1).toString()).toBe(text);
    expect(plain[plain.length - 1]).toBe(2);
  });

  it('o cabeçalho VAPID tem uma assinatura ES256 que a chave pública confere', () => {
    const keys = generateVapidKeys();
    const h = vapidHeader('https://push.exemplo.com/abc', keys, 'mailto:a@b.c', 1_800_000_000_000);
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(h)!;
    expect(m[4]).toBe(keys.publicKey);
    expect(JSON.parse(Buffer.from(m[2], 'base64url').toString())).toMatchObject({ aud: 'https://push.exemplo.com', sub: 'mailto:a@b.c' });
    const pub = u(keys.publicKey);
    const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33, 65).toString('base64url') }, format: 'jwk' });
    expect(verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: 'ieee-p1363' }, u(m[3]))).toBe(true);
  });
});
