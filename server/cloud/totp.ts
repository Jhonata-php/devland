// Verificação em duas etapas (TOTP, RFC 6238): código de 6 dígitos que muda a cada 30 s, gerado pelo app autenticador
// (Senhas do iPhone, Google Authenticator, 1Password…). Segredo em base32; aceita o passo anterior e o seguinte (relógio
// do celular um pouco fora). Sem dependências: HMAC-SHA1 do node:crypto.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_S = 30;
export const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Código HOTP (RFC 4226) de `digits` dígitos para o contador dado. */
export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(msg).digest();
  const off = h[h.length - 1] & 15;
  const bin = ((h[off] & 127) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/** Segredo novo (160 bits, em base32). */
export function newSecret(): string {
  return base32Encode(randomBytes(20));
}

/** Confere o código no passo atual e nos vizinhos (±1). */
export function verifyTotp(secretB32: string, code: string, nowMs = Date.now()): boolean {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  const key = base32Decode(secretB32);
  const step = Math.floor(nowMs / 1000 / STEP_S);
  for (const d of [-1, 0, 1]) {
    const want = Buffer.from(hotp(key, step + d));
    if (timingSafeEqual(want, Buffer.from(c))) return true;
  }
  return false;
}

/** Endereço otpauth:// que o app autenticador entende (no iPhone, tocar abre o app de Senhas). */
export function otpauthUri(secretB32: string, account: string, issuer = 'DevLand'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_S}`;
}

/** Códigos de reserva (uso único), no formato xxxx-xxxx. */
export function newBackupCodes(n = 8): string[] {
  return Array.from({ length: n }, () => {
    const hex = randomBytes(4).toString('hex');
    return `${hex.slice(0, 4)}-${hex.slice(4)}`;
  });
}
