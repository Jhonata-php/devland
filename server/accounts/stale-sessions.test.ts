import { mkdirSync, mkdtempSync, utimesSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clearStaleSessions } from './stale-sessions';

describe('registros de sessão velhos', () => {
  it('apaga só os gravados antes da subida', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acc-'));
    mkdirSync(join(dir, 'sessions'));
    const old = join(dir, 'sessions', '174.json');
    const fresh = join(dir, 'sessions', '180.json');
    const other = join(dir, 'sessions', 'notas.txt');
    for (const f of [old, fresh, other]) writeFileSync(f, '{}');
    const boot = Date.now();
    utimesSync(old, new Date(boot - 60_000), new Date(boot - 60_000));
    utimesSync(other, new Date(boot - 60_000), new Date(boot - 60_000));
    utimesSync(fresh, new Date(boot + 5_000), new Date(boot + 5_000));
    expect(clearStaleSessions([dir, join(dir, 'nao-existe')], boot)).toBe(1);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(other)).toBe(true);
  });
});
