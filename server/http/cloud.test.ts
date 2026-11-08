import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { UserStore } from '../cloud/users';
import type { Mail, Mailer } from '../mail/smtp';
import { setQuiet } from '../log';
import { tempDir } from '../test/fixtures';
import { createCloud, userKeyOf } from './cloud';
import { COOKIE, RemoteSessions, SESSION_MS, createRemoteGate } from './remote';

setQuiet(true);
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

async function setup(now = () => Date.now(), mailer?: Mailer) {
  const t = tempDir();
  const store = new UserStore(join(t.dir, 'users.json'), now, 10);
  const sessions = new RemoteSessions(Buffer.alloc(32, 7), { user: '', passwordHashText: '' }, now, undefined, userKeyOf(store));
  const cloud = createCloud({ store, sessions, secure: (req) => req.headers['x-forwarded-proto'] === 'https', setupCode: 'AAAA-BBBB-CCCC', mailer });
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

const invitePathOf = (m: Mail | undefined): string => /https?:\/\/[^/\s]+(\/convite\/[A-Za-z0-9_-]+)/.exec(m?.text ?? '')?.[1] ?? '';

describe('DevLand Cloud', () => {
  it('sem usuários manda para /setup; o admin só nasce com o código de instalação', async () => {
    const { call, cloud } = await setup();
    expect((await call('/')).location).toBe('/setup');
    expect((await call('/login')).location).toBe('/setup');
    expect((await call('/setup')).text).toContain('Código de instalação');
    expect((await call('/api/cloud/setup', { body: { code: 'errado', name: 'ana', email: 'ana@exemplo.com', password: 'senha-bem-longa' } })).status).toBe(401);
    const ok = await call('/api/cloud/setup', { body: { code: 'aaaa-bbbb-cccc', name: 'ana', email: 'ana@exemplo.com', password: 'senha-bem-longa' }, headers: { 'X-Forwarded-Proto': 'https' } });
    expect(ok.status).toBe(200);
    expect(ok.set).toContain('Secure');
    expect(cloud.setupCode()).toBeUndefined();
    expect((await call('/', { cookie: ok.cookie })).text).toBe('escritorio terminal=true admin=true');
    expect((await call('/api/cloud/setup', { body: { code: 'AAAA-BBBB-CCCC', name: 'eve', password: 'senha-bem-longa' } })).status).toBe(409);
    expect((await call('/setup')).location).toBe('/login');
  });

  it('esqueci a senha: link por e-mail troca a senha uma vez só; resposta igual para e-mail que não existe', async () => {
    const sent: Mail[] = [];
    const { call } = await setup(undefined, { send: async (m) => void sent.push(m) });
    await call('/api/cloud/setup', { body: { code: 'AAAA-BBBB-CCCC', name: 'ana', email: 'ana@exemplo.com', password: 'senha-bem-longa' } });
    expect((await call('/login')).text).toContain('/esqueci');
    expect((await call('/esqueci')).text).toContain('/api/cloud/forgot');
    const nobody = await call('/api/cloud/forgot', { body: { login: 'ninguem@exemplo.com' } });
    expect(nobody.status).toBe(200);
    expect(sent).toHaveLength(0);
    expect((await call('/api/cloud/forgot', { body: { login: 'Ana@Exemplo.com' }, headers: { Host: 'devland.test', 'X-Forwarded-Proto': 'https' } })).status).toBe(200);
    await new Promise((ok) => setTimeout(ok, 10));
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('ana@exemplo.com');
    const path = /https:\/\/[^/\s]+(\/redefinir\/[A-Za-z0-9_-]{43})/.exec(sent[0].text)?.[1];
    expect(path).toBeTruthy();
    expect((await call(path!)).text).toContain('/api/cloud/reset');
    const token = path!.split('/').pop();
    expect((await call('/api/cloud/reset', { body: { token, password: 'curta' } })).status).toBe(400);
    const ok = await call('/api/cloud/reset', { body: { token, password: 'senha-nova-bem-longa' } });
    expect(ok.status).toBe(200);
    expect(ok.cookie).toBeTruthy();
    expect((await call('/api/cloud/reset', { body: { token, password: 'outra-senha-longa' } })).status).toBe(400);
    expect((await call('/api/remote/login', { body: { user: 'ana', password: 'senha-bem-longa' } })).status).toBe(401);
    expect((await call('/api/remote/login', { body: { user: 'ana@exemplo.com', password: 'senha-nova-bem-longa' } })).status).toBe(200);
    expect((await call(path!)).text).toContain('Link inválido');
  });

  it('convite: o link vai só por e-mail para a pessoa (nome e e-mail já preenchidos); sem SMTP ou com falha no envio não fica convite solto', async () => {
    const sent: Mail[] = [];
    const ok = await setup(undefined, { send: async (m) => void sent.push(m) });
    const admin = (await ok.call('/api/cloud/setup', { body: { code: 'AAAA-BBBB-CCCC', name: 'ana', email: 'ana@exemplo.com', password: 'senha-bem-longa' } })).cookie;
    const r = await ok.call('/api/cloud/invites', { body: { role: 'user', allow: [], email: 'Caio@Exemplo.com', name: 'caio' }, cookie: admin, headers: { Host: 'devland.test', 'X-Forwarded-Proto': 'https' } });
    expect(r.status).toBe(200);
    expect(r.text).not.toContain('convite/'); // a resposta não traz o link
    expect(sent[0].to).toBe('caio@exemplo.com');
    const path = invitePathOf(sent[0]);
    expect(path).toBeTruthy();
    const page = (await ok.call(path)).text;
    expect(page).toContain('value="caio@exemplo.com"');
    expect(page).toContain('value="caio"');
    expect(page).toContain('readonly');

    const none = await setup();
    const adm2 = (await none.call('/api/cloud/setup', { body: { code: 'AAAA-BBBB-CCCC', name: 'ana', email: 'ana@exemplo.com', password: 'senha-bem-longa' } })).cookie;
    expect((await none.call('/api/cloud/invites', { body: { role: 'user', allow: [], email: 'x@exemplo.com' }, cookie: adm2 })).status).toBe(400);

    const bad = await setup(undefined, { send: async () => { throw new Error('SMTP 535'); } });
    const adm3 = (await bad.call('/api/cloud/setup', { body: { code: 'AAAA-BBBB-CCCC', name: 'ana', email: 'ana@exemplo.com', password: 'senha-bem-longa' } })).cookie;
    expect((await bad.call('/api/cloud/invites', { body: { role: 'user', allow: [], email: 'y@exemplo.com' }, cookie: adm3 })).status).toBe(502);
  });

  it('sem SMTP o /login não mostra o link e o /esqueci explica', async () => {
    const { call } = await setup();
    await call('/api/cloud/setup', { body: { code: 'AAAA-BBBB-CCCC', name: 'ana', email: 'ana@exemplo.com', password: 'senha-bem-longa' } });
    expect((await call('/login')).text).not.toContain('/esqueci');
    expect((await call('/esqueci')).text).toContain('não está configurado');
    expect((await call('/api/cloud/forgot', { body: { login: 'ana@exemplo.com' } })).status).toBe(404);
  });

  it('convite cria usuário com as permissões escolhidas; usuário comum não administra', async () => {
    const sent: Mail[] = [];
    const { call } = await setup(undefined, { send: async (m) => void sent.push(m) });
    const admin = (await call('/api/cloud/setup', { body: { code: 'AAAA-BBBB-CCCC', name: 'ana', email: 'ana@exemplo.com', password: 'senha-bem-longa' } })).cookie;
    expect((await call('/api/cloud/invites', { body: { role: 'user', allow: ['messages'] }, cookie: admin })).status).toBe(400); // sem e-mail
    expect((await call('/api/cloud/invites', { body: { role: 'user', allow: ['messages'], email: 'bia@exemplo.com', name: 'bia' }, cookie: admin })).status).toBe(200);
    const inv = { path: invitePathOf(sent[0]) };
    expect(inv.path).toBeTruthy();
    expect((await call(inv.path)).text).toContain('convidado');
    const token = inv.path.split('/').pop();
    const bia = (await call('/api/cloud/invite', { body: { token, name: 'bia', email: 'bia@exemplo.com', password: 'outra-senha-longa' } })).cookie;
    expect((await call('/', { cookie: bia })).text).toBe('escritorio terminal=false admin=false');
    expect((await call('/api/cloud/users', { cookie: bia })).status).toBe(403);
    expect((await call('/admin', { cookie: bia })).location).toBe('/');
    // /admin só existe dentro da janela do app: direto, admin vai para o app (que abre a janela); embed devolve a página.
    expect((await call('/admin', { cookie: admin })).location).toBe('/?painel=usuarios');
    expect((await call('/admin?embed', { cookie: admin })).text).toContain('<h1>');
    expect((await call('/api/cloud/invite', { body: { token, name: 'caio', email: 'caio@exemplo.com', password: 'outra-senha-longa' } })).status).toBe(400);

    const users = JSON.parse((await call('/api/cloud/users', { cookie: admin })).text) as { users: { id: string; name: string }[] };
    const biaId = users.users.find((u) => u.name === 'bia')!.id;
    await call(`/api/cloud/users/${biaId}`, { method: 'PATCH', body: { allow: ['terminal'] }, cookie: admin });
    expect((await call('/', { cookie: bia })).text).toBe('escritorio terminal=true admin=false');
    await call(`/api/cloud/users/${biaId}`, { method: 'DELETE', cookie: admin });
    expect((await call('/', { cookie: bia })).location).toBe('/login');
  });

  it('login, sair de todos e sem login a API responde 401', async () => {
    const { call } = await setup();
    await call('/api/cloud/setup', { body: { code: 'AAAA-BBBB-CCCC', name: 'ana', email: 'ana@exemplo.com', password: 'senha-bem-longa' } });
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
    const c = (await call('/api/cloud/setup', { body: { code: 'AAAA-BBBB-CCCC', name: 'ana', email: 'ana@exemplo.com', password: 'senha-bem-longa' } })).cookie;
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

describe('código de instalação vindo do Velix', () => {
  it('vale exatamente como veio (base64url, com maiúsculas e minúsculas)', async () => {
    const t = tempDir();
    closers.push(async () => t.cleanup());
    const store = new UserStore(join(t.dir, 'users.json'), Date.now, 10);
    const sessions = new RemoteSessions(Buffer.alloc(32, 7), { user: '', passwordHashText: '' }, Date.now, undefined, userKeyOf(store));
    const cloud = createCloud({ store, sessions, secure: () => false, setupCode: 'aB3_xY-9kLmN' });
    expect(cloud.setupCode()).toBe('aB3_xY-9kLmN');
  });
});
