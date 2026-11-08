// Web Push sem dependências: criptografia do conteúdo (RFC 8291, aes128gcm) e identificação do servidor (VAPID, RFC 8292), só
// com node:crypto. É o que permite avisar o celular mesmo com o Habblaud fechado (iPhone: app na Tela de Início, iOS 16.4+).
import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from 'node:crypto';

const b64u = (b: Buffer): string => b.toString('base64url');
const fromB64u = (s: string): Buffer => Buffer.from(s, 'base64url');

export interface VapidKeys {
  /** Ponto público não comprimido (65 bytes) em base64url: é o `applicationServerKey` do navegador. */
  publicKey: string;
  /** Chave privada (32 bytes) em base64url. */
  privateKey: string;
}

export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

/** Corpo cifrado (aes128gcm) de uma mensagem push para um navegador (p256dh 65 bytes, auth 16 bytes). */
export function encryptPayload(payload: Buffer, uaPublic: Buffer, authSecret: Buffer, fixed?: { asPrivate?: Buffer; salt?: Buffer }): Buffer {
  const as = createECDH('prime256v1');
  if (fixed?.asPrivate) as.setPrivateKey(fixed.asPrivate);
  else as.generateKeys();
  const asPublic = as.getPublicKey();
  const shared = as.computeSecret(uaPublic);
  const salt = fixed?.salt ?? randomBytes(16);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // Um só registro: o conteúdo, o delimitador 0x02 (último registro) e a etiqueta de autenticação.
  const body = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

/** Cabeçalho Authorization do VAPID (JWT ES256) para o servidor de push `endpoint`. */
export function vapidHeader(endpoint: string, keys: VapidKeys, subject: string, nowMs = Date.now()): string {
  const pub = fromB64u(keys.publicKey);
  const jwk = { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), d: keys.privateKey };
  const key = createPrivateKey({ key: jwk, format: 'jwk' });
  const head = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(nowMs / 1000) + 12 * 3600, sub: subject })));
  const sig = sign('sha256', Buffer.from(`${head}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${keys.publicKey}`;
}

export interface PushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushOutcome = 'sent' | 'gone' | 'failed';

/** Resultado do último envio de cada aparelho (status HTTP do serviço de push, ou 0 se nem chegou lá): para o teste explicar a falha. */
export const lastPushStatus = { code: 0 };

/** Manda uma mensagem a um aparelho. `gone` = a assinatura não vale mais (404/410): quem chama a remove. */
export async function sendPush(sub: PushSubscription, message: unknown, keys: VapidKeys, subject: string, fetchFn: typeof fetch = fetch): Promise<PushOutcome> {
  try {
    const body = encryptPayload(Buffer.from(JSON.stringify(message)), fromB64u(sub.p256dh), fromB64u(sub.auth));
    const res = await fetchFn(sub.endpoint, {
      method: 'POST',
      headers: {
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '3600',
        Urgency: 'high',
        Authorization: vapidHeader(sub.endpoint, keys, subject),
      },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(15_000),
    });
    lastPushStatus.code = res.status;
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.ok ? 'sent' : 'failed';
  } catch {
    lastPushStatus.code = 0;
    return 'failed';
  }
}
