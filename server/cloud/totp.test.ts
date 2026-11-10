import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hotp, otpauthUri, verifyTotp, newBackupCodes } from './totp';

// Vetores do RFC 6238 (SHA-1, segredo "12345678901234567890"), em 8 dígitos.
const SECRET = Buffer.from('12345678901234567890');

describe('TOTP', () => {
  it('vetores do RFC 6238', () => {
    expect(hotp(SECRET, Math.floor(59 / 30), 8)).toBe('94287082');
    expect(hotp(SECRET, Math.floor(1111111109 / 30), 8)).toBe('07081804');
    expect(hotp(SECRET, Math.floor(1234567890 / 30), 8)).toBe('89005924');
  });
  it('base32 vai e volta', () => {
    expect(base32Decode(base32Encode(SECRET)).equals(SECRET)).toBe(true);
    expect(base32Encode(SECRET)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });
  it('aceita o passo atual e os vizinhos, recusa o resto', () => {
    const b32 = base32Encode(SECRET);
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(b32, hotp(SECRET, step), now)).toBe(true);
    expect(verifyTotp(b32, hotp(SECRET, step - 1), now)).toBe(true);
    expect(verifyTotp(b32, hotp(SECRET, step + 2), now)).toBe(false);
    expect(verifyTotp(b32, '12345', now)).toBe(false);
    expect(verifyTotp(b32, 'abcdef', now)).toBe(false);
  });
  it('otpauth e códigos de reserva', () => {
    expect(otpauthUri('ABC', 'a@b.c')).toBe('otpauth://totp/DevLand%3Aa%40b.c?secret=ABC&issuer=DevLand&algorithm=SHA1&digits=6&period=30');
    const codes = newBackupCodes();
    expect(codes).toHaveLength(8);
    expect(codes[0]).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}$/);
  });
});
