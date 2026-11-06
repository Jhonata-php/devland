import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { UserStore } from '../cloud/users';
import { setQuiet } from '../log';
import { tempDir } from '../test/fixtures';
import { createCloud, userKeyOf } from './cloud';
import { COOKIE, RemoteSessions, SESSION_MS, createRemoteGate } from './remote';

setQuiet(true);
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

async function setup(now = () => Date.now()) {
  const t = tempDir();
  const store = new UserStore(join(t.dir, 'users.json'), now, 10);
  const sessions = new RemoteSessions(Buffer.alloc(32, 7), { user: '', passwordHashText: '' }, now, undefined, userKeyOf(store));
  const cloud = createCloud({ store, sessions, secure: (req) => req.headers['x-forwarded-proto'] === 'https', setupCode: 'AAAA-BBBB-CCCC' });
  const gate = createRemoteGate({ sessions, secure: (req) => req.headers['x-forwarded-proto'] === 'https', cloud: cloud.gate });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (gate(req, res, url) || cloud.api(req, res, url)) return;
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`escritorio terminal=${cloud.allows(req, 'terminal')} admin=${cloud.isAdmin(req)}`);
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  closers.push(async () => {
    await new Promise<void>((ok) => server.close(() => ok()));
    t.cleanup();
  });
  const call = async (path: string, opts: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) => {
    const res = await fetch(base + path, {
      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json', ...(opts.cookie ? { Cookie: opts.cookie } : {}), ...opts.headers },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const set = res.headers.get('set-cookie') ?? '';
    const cookie = new RegExp(`${COOKIE}=([^;]*)`).exec(set)?.[1];
    return { status: res.status, location: res.headers.get('location'), set, cookie: cookie ? `${COOKIE}=${cookie}` : undefined, text: await res.text() };
  };
  return { store, cloud, call };
}

describe('Habblaud Cloud', () => {
  it('sem usuários manda para /setup; o admin só nasce com o código de instalação', async () => {
    const { call, cloud } = await setup();
    expect((await call('/')).location).toBe('/setup');
    expect((await call('/login')).location).toBe('/setup');
    expect((await call('/setup')).text).toContain('Código de instalação');
    expect((await call('/api/cloud/setup', { body: { code: 'errado', name: 'ana', password: 'senha-bem-longa' } })).status).toBe(401);
    const ok = await call('/api/cloud/setup', { body: { code: 'aaaa-bbbb-cccc', name: 'ana', password: 'senha-bem-longa' }, headers: { 'X-Forwarded-Proto': 'https' } });
    expect(ok.status).toBe(200);
    expect(ok.set).toContain('Secure');
    expect(cloud.setupCode()).toBeUndefined();
    expect((await call('/', { cookie: ok.cookie })).text).toBe('escritorio terminal=true admin=true');
    expect((await call('/api/cloud/setup', { body: { code: 'AAAA-BBBB-CCCC', name: 'eve', password: 'senha-bem-longa' } })).status).toBe(409);
    expect((await call('/setup')).location).toBe('/login');
  });

  it('convite cria usuário com as permissões escolhidas; usuário comum não administra', async () => {
    const { call } = await setup();
    const admin = (await call('/api/cloud/setup', { body: { code: 'AAAA-BBBB-CCCC', name: 'ana', password: 'senha-bem-longa' } })).cookie;
    const inv = JSON.parse((await call('/api/cloud/invites', { body: { role: 'user', allow: ['messages'] }, cookie: admin })).text) as { path: string };
    expect((await call(inv.path)).text).toContain('convidado');
    const token = inv.path.split('/').pop();
    const bia = (await call('/api/cloud/invite', { body: { token, name: 'bia', password: 'outra-senha-longa' } })).cookie;
    expect((await call('/', { cookie: bia })).text).toBe('escritorio terminal=false admin=false');
    expect((await call('/api/cloud/users', { cookie: bia })).status).toBe(403);
    expect((await call('/admin', { cookie: bia })).location).toBe('/');
    expect((await call('/api/cloud/invite', { body: { token, name: 'caio', password: 'outra-senha-longa' } })).status).toBe(400);

    const users = JSON.parse((await call('/api/cloud/users', { cookie: admin })).text) as { users: { id: string; name: string }[] };
    const biaId = users.users.find((u) => u.name === 'bia')!.id;
    await call(`/api/cloud/users/${biaId}`, { method: 'PATCH', body: { allow: ['terminal'] }, cookie: admin });
    expect((await call('/', { cookie: bia })).text).toBe('escritorio terminal=true admin=false');
    await call(`/api/cloud/users/${biaId}`, { method: 'DELETE', cookie: admin });
    expect((await call('/', { cookie: bia })).location).toBe('/login');
  });

  it('login, sair de todos e sem login a API responde 401', async () => {
    const { call } = await setup();
    await call('/api/cloud/setup', { body: { code: 'AAAA-BBBB-CCCC', name: 'ana', password: 'senha-bem-longa' } });
    expect((await call('/api/remote/login', { body: { user: 'ana', password: 'errada-errada' } })).status).toBe(401);
    const a = (await call('/api/remote/login', { body: { user: 'Ana', password: 'senha-bem-longa' } })).cookie;
    const b = (await call('/api/remote/login', { body: { user: 'ana', password: 'senha-bem-longa' } })).cookie;
    expect((await call('/api/snapshot')).status).toBe(401);
    await call('/api/cloud/logout-all', { body: {}, cookie: a });
    expect((await call('/', { cookie: b })).location).toBe('/login');
  });

  it('sessão em uso é renovada depois de um dia (não cai)', async () => {
    let now = 1_800_000_000_000;
    const { call } = await setup(() => now);
    const c = (await call('/api/cloud/setup', { body: { code: 'AAAA-BBBB-CCCC', name: 'ana', password: 'senha-bem-longa' } })).cookie;
    expect((await call('/', { cookie: c })).cookie).toBeUndefined();
    now += 2 * 24 * 60 * 60 * 1000;
    const renewed = (await call('/', { cookie: c })).cookie;
    expect(renewed).toBeDefined();
    now += SESSION_MS - 24 * 60 * 60 * 1000;
    expect((await call('/', { cookie: c })).location).toBe('/login');
    expect((await call('/', { cookie: renewed })).status).toBe(200);
  });
});

describe('máquina no container (Cloud)', () => {
  it('terminal pela porta com login só com remoteOk; sem ele, só o próprio computador', async () => {
    const { ptyRequestProblem } = await import('./pty');
    const remoteReq = { socket: { remoteAddress: '172.18.0.5' }, headers: { host: 'habblaud.needbr.com' } } as unknown as http.IncomingMessage;
    expect(ptyRequestProblem(remoteReq)).not.toBeNull();
    expect(ptyRequestProblem(remoteReq, () => false)).not.toBeNull();
    expect(ptyRequestProblem(remoteReq, () => true)).toBeNull();
  });

  it('agentes rodam como o usuário dev quando configurado', async () => {
    const { agentRunAs, runAsOptions } = await import('../spawn/runas');
    expect(agentRunAs({})).toBeUndefined();
    const runAs = agentRunAs({ HABBLAUD_AGENT_UID: '1001', HABBLAUD_AGENT_GID: '1001', HABBLAUD_AGENT_USER: 'dev', HABBLAUD_AGENT_HOME: '/home/dev' });
    const o = runAsOptions({ PATH: '/bin', HOME: '/root' }, runAs);
    expect(o).toMatchObject({ uid: 1001, gid: 1001, env: { PATH: '/bin', HOME: '/home/dev', USER: 'dev' } });
    expect(runAsOptions({ HOME: '/root' }, undefined)).toEqual({ env: { HOME: '/root' } });
  });
});
