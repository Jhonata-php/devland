import { statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { tempDir } from '../test/fixtures';
import { INVITE_MS, UserStore, allowedOf } from './users';

const tmp: (() => void)[] = [];
afterEach(() => tmp.splice(0).forEach((c) => c()));
function store(now = () => 1_000) {
  const t = tempDir();
  tmp.push(t.cleanup);
  const file = join(t.dir, 'users.json');
  return { file, s: new UserStore(file, now, 10) };
}

describe('UserStore', () => {
  it('cria o admin, confere a senha e grava com permissão 600', async () => {
    const { file, s } = store();
    expect(s.isEmpty()).toBe(true);
    const admin = await s.create('Ana', 'senha-bem-longa', 'admin', []);
    expect(allowedOf(admin).has('terminal')).toBe(true);
    expect((await s.verify('ana', 'senha-bem-longa'))?.id).toBe(admin.id);
    expect(await s.verify('ana', 'errada-errada')).toBeUndefined();
    expect(await s.verify('ninguem', 'senha-bem-longa')).toBeUndefined();
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(new UserStore(file).get(admin.id)?.name).toBe('Ana');
    expect(JSON.stringify(s.list())).not.toContain('scrypt');
  });

  it('recusa nome repetido, nome estranho e senha curta', async () => {
    const { s } = store();
    await s.create('ana', 'senha-bem-longa', 'admin', []);
    await expect(s.create('ANA', 'senha-bem-longa', 'user', [])).rejects.toThrow();
    await expect(s.create('a b', 'senha-bem-longa', 'user', [])).rejects.toThrow();
    await expect(s.create('bia', 'curta', 'user', [])).rejects.toThrow();
  });

  it('convite: uso único, vence em 7 dias, guarda só o hash, leva papel e permissões', async () => {
    let now = 1_000;
    const { file, s } = store(() => now);
    const admin = await s.create('ana', 'senha-bem-longa', 'admin', []);
    const { token } = s.createInvite('user', ['messages', 'xyz' as never], admin.id);
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(file, 'utf8')).not.toContain(token);
    const bia = await s.acceptInvite(token, 'bia', 'outra-senha-longa');
    expect(bia.role).toBe('user');
    expect([...allowedOf(bia)]).toEqual(['messages']);
    await expect(s.acceptInvite(token, 'caio', 'outra-senha-longa')).rejects.toThrow();
    const late = s.createInvite('user', [], admin.id).token;
    now += INVITE_MS + 1;
    expect(s.inviteValid(late)).toBe(false);
  });

  it('convite com nome em uso continua valendo para tentar de novo', async () => {
    const { s } = store();
    const admin = await s.create('ana', 'senha-bem-longa', 'admin', []);
    const { token } = s.createInvite('user', [], admin.id);
    await expect(s.acceptInvite(token, 'ana', 'outra-senha-longa')).rejects.toThrow();
    expect(s.inviteValid(token)).toBe(true);
  });

  it('não deixa ficar sem admin; muda papel e permissões; época sobe', async () => {
    const { s } = store();
    const ana = await s.create('ana', 'senha-bem-longa', 'admin', []);
    expect(() => s.update(ana.id, { role: 'user' })).toThrow();
    expect(() => s.remove(ana.id)).toThrow();
    const bia = await s.create('bia', 'senha-bem-longa', 'user', []);
    expect(s.update(bia.id, { allow: ['terminal'] }).allow).toEqual(['terminal']);
    s.update(bia.id, { role: 'admin' });
    s.update(ana.id, { role: 'user', allow: [] });
    expect(allowedOf(s.get(ana.id)!).size).toBe(0);
    s.bumpEpoch(bia.id);
    expect(s.get(bia.id)!.epoch).toBe(1);
    s.remove(ana.id);
    expect(s.get(ana.id)).toBeUndefined();
  });
});
