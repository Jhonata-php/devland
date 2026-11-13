// Acesso remoto autenticado (celular na mesma rede): uma SEGUNDA porta, com usuário, senha e HTTPS.
//
// A porta principal continua só no loopback (hooks, plugins e o navegador do próprio computador, sem login). A porta
// remota aceita qualquer endereço, mas TODA requisição nela passa por aqui antes da API: sem o cookie de sessão, a
// página vira a tela de login e a API responde 401. O que separa "local" de "remoto" é a porta em que a conexão
// chegou, nunca o cabeçalho Host (que um cliente da rede imita à vontade).
//
// Configuração (escrita por `npm run remote:setup`, scripts/remote-setup.ts):
//   DEVLAND_REMOTE_USER + DEVLAND_REMOTE_PASSWORD_HASH  ligam a porta (o hash é scrypt, ver remote/password.ts;
//                                                         senha em texto puro não é aceita)
//   DEVLAND_REMOTE_ALLOW   o que a sessão remota pode fazer além de ver: permissions, messages, terminal ("none" = só
//                           ver). Padrão: permissions.
//   DEVLAND_REMOTE_TLS_DIR pasta com server.key, server.crt (e ca.crt, servido em /remote/ca.crt). Padrão:
//                           /remote-tls no Docker, ~/.devland/remote-tls/server no Node. Sem certificado a porta não
//                           sobe, a menos que DEVLAND_REMOTE_INSECURE_HTTP=1 (HTTP puro: senha e cookie à vista na rede).
//   DEVLAND_REMOTE_PORT / DEVLAND_REMOTE_HOST  só no Node (padrão 0.0.0.0:4748); no Docker o container escuta sempre
//                           em 0.0.0.0:4748 e quem decide a exposição é a porta publicada (DEVLAND_REMOTE_BIND).
//
// Sessão: cookie HttpOnly + SameSite=Strict (+ Secure com HTTPS) assinado com HMAC; chave = segredo aleatório em
// <dataDir>/remote-secret misturado com usuário e hash da senha: trocar a senha derruba todas as sessões.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unwatchFile, watchFile, writeFileSync } from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parsePasswordHash, verifyPassword, type PasswordHash } from '../remote/password';
import { hostAllowed } from './guard';
import { getLocale, tr } from '../../shared/i18n';
import { authPage, BRAND, ICON, js } from './auth-shell';

export type RemoteFeature = 'permissions' | 'messages' | 'terminal' | 'spawn';

const FEATURES: readonly RemoteFeature[] = ['permissions', 'messages', 'terminal', 'spawn'];

export interface RemoteTls {
  dir: string;
  keyFile: string;
  certFile: string;
  caFile: string;
}

export interface RemoteConfig {
  port: number;
  host: string;
  user: string;
  /** Ausente no DevLand Cloud (os usuários ficam em <dataDir>/users.json). */
  passwordHash?: PasswordHash;
  /** Texto do hash como veio do ambiente (entra na chave das sessões). */
  passwordHashText: string;
  allow: ReadonlySet<RemoteFeature>;
  /** Ausente = HTTP puro (só com DEVLAND_REMOTE_INSECURE_HTTP=1, ou no DevLand Cloud, com o TLS no proxy). */
  tls?: RemoteTls;
  /**
   * DEVLAND_CLOUD=1: vários usuários (http/cloud.ts), HTTP atrás do proxy (Traefik), cookie Secure pelo
   * X-Forwarded-Proto. `allow` vira o teto; o que vale é a lista de cada usuário.
   */
  cloud?: true;
}

export const DEFAULT_REMOTE_PORT = 4748;
export const COOKIE = 'devland_remote';
export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
/** Depois de quanto tempo um token em uso é trocado por um novo (janela deslizante, RemoteSessions.renew). */
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;
/** Prazo para o primeiro byte de uma conexão na porta remota (antes de saber se é HTTPS). */
const FIRST_BYTE_MS = 15_000;

function truthy(v: string | undefined): boolean {
  return !!v && /^(1|true|yes|sim|on)$/i.test(v.trim());
}

export function defaultTlsDir(env: NodeJS.ProcessEnv, inDocker: boolean): string {
  if (env.DEVLAND_REMOTE_TLS_DIR?.trim()) return env.DEVLAND_REMOTE_TLS_DIR.trim();
  return inDocker ? '/remote-tls' : join(env.HOME || homedir(), '.devland', 'remote-tls', 'server');
}

/** Liga o acesso remoto a partir do ambiente. `warning` explica por que ficou desligado quando parece intencional. */
export function parseRemoteConfig(
  env: NodeJS.ProcessEnv,
  inDocker: boolean,
  exists: (path: string) => boolean = existsSync,
): { config?: RemoteConfig; warning?: string } {
  if (truthy(env.DEVLAND_CLOUD)) {
    // No container a porta é sempre a 4748; quem a expõe é o proxy, nunca uma porta publicada sem ele.
    const port = inDocker ? DEFAULT_REMOTE_PORT : Number.parseInt(env.DEVLAND_REMOTE_PORT ?? '', 10) || DEFAULT_REMOTE_PORT;
    const host = inDocker ? '0.0.0.0' : env.DEVLAND_REMOTE_HOST?.trim() || '127.0.0.1';
    return { config: { port, host, user: '', passwordHashText: '', allow: new Set(FEATURES), cloud: true } };
  }
  const user = env.DEVLAND_REMOTE_USER?.trim() ?? '';
  const hashText = env.DEVLAND_REMOTE_PASSWORD_HASH?.trim() ?? '';
  const plain = env.DEVLAND_REMOTE_PASSWORD ?? '';
  if (!user && !hashText && !plain) return {};
  if (plain && !hashText) return { warning: tr('acesso remoto desligado: senha em texto puro (DEVLAND_REMOTE_PASSWORD) não é aceita; rode npm run remote:setup') };
  if (!user || !hashText) return { warning: tr('acesso remoto desligado: faltam DEVLAND_REMOTE_USER e DEVLAND_REMOTE_PASSWORD_HASH; rode npm run remote:setup') };
  const passwordHash = parsePasswordHash(hashText);
  if (!passwordHash) return { warning: tr('acesso remoto desligado: DEVLAND_REMOTE_PASSWORD_HASH inválido; rode npm run remote:setup') };
  const dir = defaultTlsDir(env, inDocker);
  const tls: RemoteTls = { dir, keyFile: join(dir, 'server.key'), certFile: join(dir, 'server.crt'), caFile: join(dir, 'ca.crt') };
  const hasTls = exists(tls.keyFile) && exists(tls.certFile);
  const insecure = truthy(env.DEVLAND_REMOTE_INSECURE_HTTP);
  if (!hasTls && !insecure) return { warning: tr('acesso remoto desligado: sem certificado em {0} (HTTPS é obrigatório); rode npm run remote:setup', [dir]) };
  const rawPort = Number.parseInt(env.DEVLAND_REMOTE_PORT ?? '', 10);
  const port = inDocker ? DEFAULT_REMOTE_PORT : Number.isInteger(rawPort) && rawPort > 0 && rawPort < 65536 ? rawPort : DEFAULT_REMOTE_PORT;
  const host = inDocker ? '0.0.0.0' : env.DEVLAND_REMOTE_HOST?.trim() || '0.0.0.0';
  return {
    config: { port, host, user, passwordHash, passwordHashText: hashText, allow: parseAllow(env.DEVLAND_REMOTE_ALLOW), tls: hasTls ? tls : undefined },
  };
}

export function parseAllow(raw: string | undefined): Set<RemoteFeature> {
  if (raw === undefined || !raw.trim()) return new Set<RemoteFeature>(['permissions']);
  const out = new Set<RemoteFeature>();
  for (const part of raw.split(',')) {
    const p = part.trim().toLowerCase();
    if ((FEATURES as readonly string[]).includes(p)) out.add(p as RemoteFeature);
  }
  return out;
}

/** Segredo de assinatura: lido de `file` ou criado (32 bytes, permissão 600). Sem disco gravável, vale só nesta execução. */
export function loadSecret(file: string): Buffer {
  try {
    if (existsSync(file)) {
      const hex = readFileSync(file, 'utf8').trim();
      if (/^[0-9a-f]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
    }
    const secret = randomBytes(32);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, secret.toString('hex'), { mode: 0o600 });
    chmodSync(file, 0o600);
    return secret;
  } catch {
    return randomBytes(32);
  }
}

/** Compara em tempo constante (os dois lados viram digests do mesmo tamanho). */
export function safeEqual(a: string, b: string): boolean {
  const h = (s: string) => createHash('sha256').update(s, 'utf8').digest();
  return timingSafeEqual(h(a), h(b));
}

export class RemoteSessions {
  private readonly key: Buffer;
  /** Assinatura -> validade dos tokens encerrados por "Sair" antes de vencer (o cookie apagado não basta: uma cópia valeria até expirar). */
  private readonly revoked = new Map<string, number>();

  constructor(
    secret: Buffer,
    cfg: Pick<RemoteConfig, 'user' | 'passwordHashText'>,
    private readonly now: () => number = Date.now,
    /** Onde a lista de tokens encerrados sobrevive a reinícios (ausente = só em memória). */
    private readonly revokedFile?: string,
    /**
     * DevLand Cloud: material da chave de cada usuário (id, época, hash da senha); undefined = usuário não existe mais.
     * Com ele, os tokens levam o id (`v2.<id>.<validade>.<assinatura>`).
     */
    private readonly userKey?: (uid: string) => string | undefined,
  ) {
    this.key = createHmac('sha256', secret).update(`${cfg.user}\0${cfg.passwordHashText}`, 'utf8').digest();
    this.loadRevoked();
  }

  private sign(payload: string, uid?: string): string | undefined {
    let key = this.key;
    if (uid !== undefined) {
      const material = this.userKey?.(uid);
      if (material === undefined) return undefined;
      key = createHmac('sha256', this.key).update(material, 'utf8').digest();
    }
    return createHmac('sha256', key).update(payload, 'utf8').digest('base64url');
  }

  /** Token novo (de 30 dias); com `uid`, do usuário (DevLand Cloud). */
  issue(uid?: string): { token: string; maxAgeS: number } {
    const exp = this.now() + SESSION_MS;
    const payload = uid === undefined ? `v1.${exp}` : `v2.${uid}.${exp}`;
    return { token: `${payload}.${this.sign(payload, uid) ?? ''}`, maxAgeS: Math.floor(SESSION_MS / 1000) };
  }

  verify(token: string | undefined): boolean {
    const parsed = this.parse(token);
    return !!parsed && !this.revoked.has(parsed.sig);
  }

  /** Id do usuário de um token válido (v2); undefined para inválido ou v1. */
  userOf(token: string | undefined): string | undefined {
    const parsed = this.parse(token);
    return parsed && !this.revoked.has(parsed.sig) ? parsed.uid : undefined;
  }

  /**
   * Janela deslizante: token válido emitido há mais de um dia ganha um novo de 30 dias (quem usa não cai). O antigo
   * continua valendo até vencer (uma aba com o cookie velho não perde a sessão no meio).
   */
  renew(token: string | undefined): { token: string; maxAgeS: number } | undefined {
    const parsed = this.parse(token);
    if (!parsed || this.revoked.has(parsed.sig)) return undefined;
    if (parsed.exp - this.now() > SESSION_MS - RENEW_AFTER_MS) return undefined;
    return this.issue(parsed.uid);
  }

  /** Encerra este token (botão "Sair"); token inválido ou vencido não muda nada. */
  revoke(token: string | undefined): void {
    const parsed = this.parse(token);
    if (!parsed) return;
    const now = this.now();
    for (const [sig, exp] of this.revoked) if (exp <= now) this.revoked.delete(sig);
    this.revoked.set(parsed.sig, parsed.exp);
    this.saveRevoked();
  }

  private parse(token: string | undefined): { exp: number; sig: string; uid?: string } | undefined {
    if (!token) return undefined;
    const m = /^(?:v1|v2\.([0-9a-f-]{36}))\.(\d{10,16})\.([A-Za-z0-9_-]{43})$/.exec(token);
    if (!m) return undefined;
    const uid = m[1];
    if (uid === undefined ? token.startsWith('v2') : !this.userKey) return undefined;
    const exp = Number(m[2]);
    if (exp <= this.now()) return undefined;
    const sig = this.sign(uid === undefined ? `v1.${m[2]}` : `v2.${uid}.${m[2]}`, uid);
    if (sig === undefined) return undefined;
    const expected = Buffer.from(sig);
    const got = Buffer.from(m[3]);
    return expected.length === got.length && timingSafeEqual(expected, got) ? { exp, sig: m[3], uid } : undefined;
  }

  private loadRevoked(): void {
    if (!this.revokedFile) return;
    try {
      const data: unknown = JSON.parse(readFileSync(this.revokedFile, 'utf8'));
      const now = this.now();
      for (const [sig, exp] of Object.entries(data as Record<string, unknown>)) {
        if (/^[A-Za-z0-9_-]{43}$/.test(sig) && typeof exp === 'number' && exp > now) this.revoked.set(sig, exp);
      }
    } catch {
      // sem arquivo (ou ilegível): ninguém encerrado ainda
    }
  }

  private saveRevoked(): void {
    if (!this.revokedFile) return;
    try {
      mkdirSync(dirname(this.revokedFile), { recursive: true });
      const tmp = `${this.revokedFile}.tmp`;
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.revoked)), { mode: 0o600 });
      renameSync(tmp, this.revokedFile);
    } catch {
      // segue valendo em memória até o próximo reinício
    }
  }
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/**
 * Freio contra tentativa e erro: depois de 5 falhas seguidas, cada nova tentativa espera 2^(n-5) s (até 5 min).
 * Global, não por IP: no Docker todo cliente da rede chega com o endereço do gateway. Uma conferência de senha por vez
 * (begin/end), contada como falha desde o começo: tentativas em paralelo não passam pelo freio enquanto o scrypt roda.
 */
export class LoginThrottle {
  private failures = 0;
  private blockedUntil = 0;
  private busy = false;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly threshold = 5,
  ) {}

  /** Segundos até poder tentar de novo (0 = pode; 1 enquanto outra tentativa está em andamento). */
  retryAfter(): number {
    return Math.max(this.busy ? 1 : 0, Math.ceil((this.blockedUntil - this.now()) / 1000));
  }

  /** Começa uma tentativa (já contada como falha); false se o freio ou outra tentativa não deixam. */
  begin(): boolean {
    if (this.retryAfter() > 0) return false;
    this.busy = true;
    this.fail();
    return true;
  }

  /** Fim da tentativa começada em begin(): acertou zera o freio; errou fica a falha já contada. */
  end(ok: boolean): void {
    this.busy = false;
    if (ok) this.succeed();
  }

  fail(): void {
    this.failures++;
    if (this.failures >= this.threshold) this.blockedUntil = this.now() + Math.min(300, 2 ** Math.min(20, this.failures - this.threshold)) * 1000;
  }

  succeed(): void {
    this.failures = 0;
    this.blockedUntil = 0;
  }
}

/** Endereço do cliente segundo o proxy: o ÚLTIMO item de X-Forwarded-For (o que o próprio proxy acrescentou; os de antes o cliente pode forjar). */
export function forwardedClient(req: IncomingMessage): string {
  const h = req.headers['x-forwarded-for'];
  const last = (Array.isArray(h) ? h.join(',') : (h ?? '')).split(',').pop()?.trim() ?? '';
  return /^[\w.:%-]{1,64}$/.test(last) ? last : '';
}

/**
 * Freio por cliente (quem erra a senha só trava a si mesmo, não o dono da conta) mais um freio global bem mais folgado
 * contra quem troca de endereço a cada tentativa.
 */
export class ClientThrottles {
  private readonly byClient = new Map<string, LoginThrottle>();
  private readonly global: LoginThrottle;
  constructor(private readonly now: () => number = Date.now) {
    this.global = new LoginThrottle(now, 40);
  }
  for(req: IncomingMessage): Pick<LoginThrottle, 'retryAfter' | 'begin' | 'end'> {
    const key = forwardedClient(req);
    if (this.byClient.size > 2000) this.byClient.clear();
    let mine = this.byClient.get(key);
    if (!mine) this.byClient.set(key, (mine = new LoginThrottle(this.now)));
    const all = [mine, this.global];
    return {
      retryAfter: () => Math.max(...all.map((t) => t.retryAfter())),
      begin: () => {
        if (all.some((t) => t.retryAfter() > 0)) return false;
        for (const t of all) t.begin();
        return true;
      },
      end: (ok: boolean) => all.forEach((t) => t.end(ok)),
    };
  }
}

/** Requisições que chegaram pela porta remota e passaram pelo login. */
const remoteRequests = new WeakSet<IncomingMessage>();
/** Arquivos que a porta remota serve sem login: manifesto e ícones (o celular os busca antes do login, sem o
 *  cookie). Nada da API nem do escritório. */
const PUBLIC_STATIC = /^\/(manifest\.webmanifest|assets\/brand\/[\w.@-]+\.png)$/;

export function isRemoteRequest(req: IncomingMessage): boolean {
  return remoteRequests.has(req);
}

/** DevLand Cloud: id do usuário que fez a requisição (porta remota, já autenticada). */
const remoteUsers = new WeakMap<IncomingMessage, string>();

export function remoteUserOf(req: IncomingMessage): string | undefined {
  return remoteUsers.get(req);
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(data);
}

export function readBody(req: IncomingMessage, max = 8 * 1024): Promise<string> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= max) chunks.push(c);
    });
    req.on('end', () => (size > max ? fail(new Error(tr('corpo grande demais'))) : ok(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', fail);
  });
}

export const CA_PATH = '/remote/ca.crt';

/** Texto nosso (tr) dentro do HTML: escapa o que o HTML interpretaria. */
export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Estilo das telas de entrada (login, criar admin, convite, usuários). */
export const PAGE_STYLE = `<style>
  :root { color-scheme: dark; --bg: #0e1018; --card: #171a27; --line: #2b3047; --txt: #ece9e1; --mut: #98a0bb; --gold: #f4c95d; --gold2: #e0a93a; --bad: #ff8a80; }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body { margin: 0; min-height: 100vh; min-height: 100dvh; display: grid; place-items: center; color: var(--txt);
         font: 16px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
         padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
         background: radial-gradient(900px 500px at 50% -10%, rgba(244, 201, 93, .13), transparent 60%),
                     radial-gradient(700px 500px at 100% 100%, rgba(98, 140, 255, .10), transparent 60%),
                     linear-gradient(rgba(255, 255, 255, .025) 1px, transparent 1px) 0 0 / 100% 24px,
                     var(--bg); }
  form { width: 100%; max-width: 380px; background: linear-gradient(180deg, #1c2030, var(--card)); border: 2px solid var(--line); border-radius: 14px;
         padding: 28px 24px 24px; box-shadow: 0 18px 50px rgba(0, 0, 0, .45), inset 0 1px 0 rgba(255, 255, 255, .05); }
  .brand { display: flex; flex-direction: column; align-items: center; gap: 10px; margin-bottom: 18px; text-align: center; }
  .brand img { width: 72px; height: 72px; filter: drop-shadow(0 6px 14px rgba(244, 201, 93, .25)); }
  h1 { margin: 0; font-size: 24px; letter-spacing: .5px; color: var(--gold); }
  p { margin: 0 0 18px; color: var(--mut); font-size: 13px; }
  .brand p { margin: 0; }
  p.ca { margin: 20px 0 0; font-size: 12px; }
  a { color: var(--gold); }
  code { color: var(--txt); }
  label { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: var(--mut); margin: 14px 0 6px; }
  input { width: 100%; padding: 13px 14px; font: inherit; font-size: 16px; color: inherit; background: #0f121c; border: 2px solid var(--line); border-radius: 8px;
          transition: border-color .15s, box-shadow .15s; }
  input:focus { outline: none; border-color: var(--gold); box-shadow: 0 0 0 3px rgba(244, 201, 93, .18); }
  .field { position: relative; }
  .field input { padding-right: 48px; }
  .eye { position: absolute; right: 4px; top: 4px; width: 40px; height: 40px; margin: 0; padding: 0; display: grid; place-items: center; background: transparent; color: var(--mut);
         border-radius: 6px; font-size: 18px; font-weight: 400; }
  .eye:hover { color: var(--txt); background: rgba(255, 255, 255, .06); }
  button { width: 100%; margin-top: 22px; padding: 13px; font: inherit; font-weight: 700; font-size: 16px; color: #14161f; background: linear-gradient(180deg, var(--gold), var(--gold2));
           border: 0; border-radius: 8px; cursor: pointer; box-shadow: 0 4px 0 #8f6a1c, 0 8px 18px rgba(0, 0, 0, .35); transition: transform .08s, box-shadow .08s, filter .15s; }
  button:hover { filter: brightness(1.06); }
  button:active { transform: translateY(3px); box-shadow: 0 1px 0 #8f6a1c; }
  button:focus-visible { outline: 3px solid rgba(244, 201, 93, .5); outline-offset: 2px; }
  button:disabled { opacity: .65; cursor: wait; transform: none; }
  button.busy::after { content: ''; display: inline-block; width: 14px; height: 14px; margin-left: 10px; vertical-align: -2px; border: 2px solid rgba(20, 22, 31, .35);
                       border-top-color: #14161f; border-radius: 50%; animation: spin .7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  #err { min-height: 20px; margin-top: 14px; color: var(--bad); font-size: 13px; text-align: center; }
  #err.shake { animation: shake .35s; }
  @keyframes shake { 20%, 60% { transform: translateX(-5px); } 40%, 80% { transform: translateX(5px); } }
  .foot { margin-top: 18px; text-align: center; font-size: 11px; color: #6c7390; }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
</style>`;

export function loginPage(opts: { caDownload: boolean; intro?: string; forgot?: boolean }): string {
  const ca = opts.caDownload
    ? `<p class="help">${esc(tr('Primeira vez neste celular?'))} <a href="${CA_PATH}" download="devland-ca.crt">${esc(tr('Instale o certificado do DevLand'))}</a> ${esc(tr('para tirar o aviso de segurança (confira a impressão digital que o npm run remote:setup mostrou).'))}</p>`
    : '';
  const card = `
<h1>${esc(tr('Bem-vindo de volta'))}</h1>
<p class="sub">${esc(opts.intro ?? tr('Acesso pelo celular. Entre com o usuário e a senha que você escolheu no npm run remote:setup.'))}</p>
<form id="f" autocomplete="on" novalidate>
  <div id="err" class="alert err" role="alert"></div>
  <label class="l" for="u">${esc(tr('E-mail'))}</label>
  <div class="field">${ICON.user}<input id="u" name="username" type="email" inputmode="email" placeholder="${esc(tr('seu@email.com'))}" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required></div>
  <div class="lrow"><label class="l" for="p">${esc(tr('Senha'))}</label>${opts.forgot ? `<a class="lnk" href="/esqueci">${esc(tr('Esqueci a senha'))}</a>` : ''}</div>
  <div class="field">${ICON.lock}<input id="p" name="password" type="password" autocomplete="current-password" required>
    <button id="eye" class="eye" type="button" aria-label="${esc(tr('Mostrar a senha'))}" aria-pressed="false">${ICON.eye}</button></div>
  <div id="cw" hidden><label class="l" for="c">${esc(tr('Código de verificação'))}</label>
  <div class="field">${ICON.lock}<input id="c" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" maxlength="9"></div></div>
  <label class="check"><input id="r" name="remember" type="checkbox" checked><span>${esc(tr('Lembrar de mim neste aparelho'))}</span></label>
  <button id="b" class="btn" type="submit"><span class="spin" aria-hidden="true"></span><span id="bt">${esc(tr('Entrar'))}</span></button>
</form>
${ca}`;
  const script = `
  (function () {
    var f = document.getElementById('f'), b = document.getElementById('b'), bt = document.getElementById('bt'), err = document.getElementById('err'), eye = document.getElementById('eye');
    var eyeOn = ${js(ICON.eyeOff)}, eyeOff = ${js(ICON.eye)};
    eye.addEventListener('click', function () {
      var show = f.password.type === 'password';
      f.password.type = show ? 'text' : 'password';
      eye.setAttribute('aria-pressed', String(show)); eye.innerHTML = show ? eyeOn : eyeOff;
    });
    function fail(text) { err.textContent = text; err.className = 'alert err on'; void err.offsetWidth; err.className = 'alert err on shake'; }
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (!f.username.value.trim() || !f.password.value) return fail(${js(tr('Informe e-mail e senha.'))});
      b.disabled = true; b.classList.add('busy'); err.className = 'alert err';
      try {
        var r = await fetch('/api/remote/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin', body: JSON.stringify({ user: f.username.value, password: f.password.value, code: f.code.value, remember: f.remember.checked }) });
        if (r.ok) { location.replace('/'); return; }
        var body = await r.json().catch(function () { return {}; });
        if (body.needCode) { var cw = document.getElementById('cw'); var first = cw.hidden; cw.hidden = false; f.code.focus(); if (first && !f.code.value) { err.className = 'alert err'; b.disabled = false; b.classList.remove('busy'); return; } }
        fail(body.error || ${js(tr('Não deu para entrar.'))});
      } catch (x) { fail(${js(tr('Sem conexão com o DevLand.'))}); }
      b.disabled = false; b.classList.remove('busy');
    });
  })();`;
  return authPage({ title: `${BRAND} · ${tr('entrar')}`, card, script });
}

/** `frameable`: só o próprio DevLand pode embutir (as páginas do Cloud abrem em janela dentro do escritório). */
export function sendHtml(res: ServerResponse, html: string, frameable = false): void {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': frameable ? 'SAMEORIGIN' : 'DENY',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(html);
}

/** `maxAgeS` null = cookie de sessão do navegador (some ao fechar): login sem "Lembrar de mim". */
export function cookieHeader(value: string, maxAgeS: number | null, secure: boolean, name = COOKIE): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict${maxAgeS === null ? '' : `; Max-Age=${maxAgeS}`}${secure ? '; Secure' : ''}`;
}

/** Marca "Lembrar de mim": a renovação do login mantém o cookie persistente só para quem marcou. */
export const KEEP_COOKIE = `${COOKIE}_keep`;

/** Cookies do login: com `remember`, persistentes; sem, só enquanto o navegador estiver aberto. */
export function loginCookies(token: string, maxAgeS: number, remember: boolean, secure: boolean): string[] {
  return remember
    ? [cookieHeader(token, maxAgeS, secure), cookieHeader('1', maxAgeS, secure, KEEP_COOKIE)]
    : [cookieHeader(token, null, secure), cookieHeader('', 0, secure, KEEP_COOKIE)];
}

/** DevLand Cloud (DEVLAND_CLOUD=1): login pelos usuários de <dataDir>/users.json (http/cloud.ts). */
export interface CloudGate {
  /** Id do usuário quando nome e senha conferem. */
  login(name: string, password: string): Promise<string | undefined>;
  /** Ainda sem nenhum usuário: a entrada é a tela de criar o admin. */
  needsSetup(): boolean;
  /** Verificação em duas etapas: o usuário precisa do código do app (ou de reserva) depois da senha. */
  needsCode?(id: string): boolean;
  checkCode?(id: string, code: string): boolean;
  /** Rotas sem login (criar admin, aceitar convite); true quando já respondeu. */
  publicRoute(req: IncomingMessage, res: ServerResponse, url: URL): boolean;
}

export interface RemoteGateDeps {
  /** Usuário e senha do modo de um usuário só (sem `cloud`). */
  config?: Pick<RemoteConfig, 'user' | 'passwordHash'>;
  sessions: RemoteSessions;
  /** Cookie com Secure (a porta fala HTTPS; atrás de proxy, decidido por requisição). */
  secure: boolean | ((req: IncomingMessage) => boolean);
  cloud?: CloudGate;
  /** Caminhos que se autenticam sozinhos (prévia ao vivo: token na URL, sem cookie; ver http/preview.ts). */
  selfAuth?: (pathname: string) => boolean;
  /** Arquivo da CA pública servido em /remote/ca.crt (ausente = sem download). */
  caFile?: string;
  throttle?: LoginThrottle;
  /** Conferência da senha (injetável nos testes; padrão: scrypt). */
  verify?: (password: string, hash: PasswordHash) => Promise<boolean>;
}

/**
 * Filtro da porta remota, depois do guard (Host/Origin/JSON) e antes da API: devolve true quando já respondeu (login,
 * logout, 401, redirecionamento, CA) e false quando a requisição está autenticada — e então a marca como remota.
 */
export function createRemoteGate(deps: RemoteGateDeps): (req: IncomingMessage, res: ServerResponse, url: URL) => boolean {
  const clients = new ClientThrottles();
  const verify = deps.verify ?? verifyPassword;
  const caAvailable = () => !!deps.caFile && existsSync(deps.caFile);
  const cloud = deps.cloud;
  return (req, res, url) => {
    const path = url.pathname;
    const method = req.method ?? 'GET';
    const secure = typeof deps.secure === 'function' ? deps.secure(req) : deps.secure;
    const cookie = readCookie(req.headers.cookie, COOKIE);
    const uid = cloud ? deps.sessions.userOf(cookie) : undefined;
    const authed = cloud ? uid !== undefined : deps.sessions.verify(cookie);

    // Cabeçalhos de endurecimento em toda resposta da porta (as respostas que definem os seus mantêm os deles).
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'; base-uri 'none'; object-src 'none'; form-action 'self'");
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    if (path === '/api/remote/login') {
      const throttle = deps.throttle ?? clients.for(req);
      if (method !== 'POST') {
        sendJson(res, 405, { error: tr('método não permitido') }, { Allow: 'POST' });
        return true;
      }
      const tooMany = () => {
        const wait = Math.max(1, throttle.retryAfter());
        sendJson(res, 429, { error: tr('Muitas tentativas. Tente de novo em {0} s.', [wait]) }, { 'Retry-After': String(wait) });
      };
      if (throttle.retryAfter() > 0) {
        req.resume();
        tooMany();
        return true;
      }
      // A tentativa só começa (e ocupa o freio) com o corpo inteiro na mão: um corpo que nunca termina não trava o
      // login de mais ninguém.
      let begun = false;
      let ok = false;
      readBody(req)
        .then(async (raw) => {
          if (!throttle.begin()) return tooMany();
          begun = true;
          let body: { user?: unknown; password?: unknown; code?: unknown; remember?: unknown } = {};
          try {
            body = JSON.parse(raw) as typeof body;
          } catch {
            // corpo inválido: cai na recusa abaixo
          }
          const user = typeof body.user === 'string' ? body.user : '';
          const password = typeof body.password === 'string' ? body.password : '';
          let who: string | undefined;
          if (cloud) {
            who = await cloud.login(user, password);
            if (who === undefined) return sendJson(res, 401, { error: tr('E-mail ou senha incorretos.') });
            // Duas etapas: com a senha certa, pede o código; código errado conta como tentativa errada no freio.
            if (cloud.needsCode?.(who)) {
              const code = typeof body.code === 'string' ? body.code.trim() : '';
              if (!code) return sendJson(res, 401, { error: tr('Digite o código do app autenticador.'), needCode: true });
              if (!cloud.checkCode?.(who, code)) return sendJson(res, 401, { error: tr('Código inválido.'), needCode: true });
            }
          } else {
            // O scrypt roda sempre (sem atalho que denuncie se foi o usuário ou a senha que errou).
            const okPassword = !!deps.config?.passwordHash && (await verify(password, deps.config.passwordHash));
            const okUser = !!deps.config && safeEqual(user.trim(), deps.config.user);
            if (!(okUser && okPassword)) return sendJson(res, 401, { error: tr('Usuário ou senha incorretos.') });
          }
          ok = true;
          const { token, maxAgeS } = deps.sessions.issue(who);
          sendJson(res, 200, { ok: true }, { 'Set-Cookie': loginCookies(token, maxAgeS, body.remember !== false, secure) });
        })
        .catch(() => {
          if (!res.headersSent) sendJson(res, 400, { error: tr('requisição inválida') });
        })
        .finally(() => {
          if (begun) throttle.end(ok);
        });
      return true;
    }

    if (path === '/api/remote/logout') {
      req.resume();
      if (method !== 'POST') sendJson(res, 405, { error: tr('método não permitido') }, { Allow: 'POST' });
      else {
        deps.sessions.revoke(cookie);
        sendJson(res, 200, { ok: true }, { 'Set-Cookie': [cookieHeader('', 0, secure), cookieHeader('', 0, secure, KEEP_COOKIE)] });
      }
      return true;
    }

    if (path === CA_PATH) {
      // Público de propósito: é só o certificado da CA (a chave nunca sai do computador).
      req.resume();
      if (!caAvailable()) sendJson(res, 404, { error: tr('sem certificado da CA') });
      else {
        const pem = readFileSync(deps.caFile!);
        res.writeHead(200, {
          'Content-Type': 'application/x-x509-ca-cert',
          'Content-Disposition': 'attachment; filename="devland-ca.crt"',
          'Content-Length': pem.length,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(pem);
      }
      return true;
    }

    if (cloud?.publicRoute(req, res, url)) return true;

    if (path === '/login') {
      req.resume();
      const go = authed ? '/' : cloud?.needsSetup() ? '/setup' : undefined;
      if (go) {
        res.writeHead(302, { Location: go, 'Cache-Control': 'no-store' });
        res.end();
      } else sendHtml(res, loginPage({ caDownload: caAvailable(), forgot: !!cloud, intro: cloud ? tr('Entre com o seu e-mail e a senha do DevLand.') : undefined }));
      return true;
    }

    if (!authed && method === 'GET' && deps.selfAuth?.(path)) {
      remoteRequests.add(req);
      return false;
    }
    if (authed) {
      remoteRequests.add(req);
      if (uid !== undefined) remoteUsers.set(req, uid);
      const fresh = deps.sessions.renew(cookie);
      if (fresh) res.setHeader('Set-Cookie', cookieHeader(fresh.token, readCookie(req.headers.cookie, KEEP_COOKIE) ? fresh.maxAgeS : null, secure));
      return false;
    }
    // Ícone e manifesto do app (Tela de Início): públicos, o celular os busca antes do login (e sem o cookie).
    if ((method === 'GET' || method === 'HEAD') && PUBLIC_STATIC.test(path)) {
      remoteRequests.add(req);
      return false;
    }

    req.resume();
    if (path === '/api' || path.startsWith('/api/')) {
      sendJson(res, 401, { error: tr('faça login: abra o DevLand por esta porta no navegador e entre com e-mail e senha') });
    } else {
      res.writeHead(302, { Location: cloud?.needsSetup() ? '/setup' : '/login', 'Cache-Control': 'no-store' });
      res.end();
    }
    return true;
  };
}

export interface RemoteListener {
  /** O que escuta a porta (TCP com HTTPS + redirecionamento, ou HTTP puro). */
  server: net.Server;
  close(): void;
}

/**
 * Sobe a porta remota. Com HTTPS, um servidor TCP olha o primeiro byte de cada conexão: 0x16 (TLS ClientHello) vai para
 * o HTTPS; qualquer outra coisa é HTTP digitado sem "s" e recebe 308 para https://. O certificado é recarregado sozinho
 * quando o arquivo muda (npm run remote:setup ou a renovação do docker:up), sem derrubar quem está conectado.
 */
export function startRemoteListener(
  cfg: Pick<RemoteConfig, 'port' | 'host' | 'tls'>,
  onRequest: (req: IncomingMessage, res: ServerResponse) => void,
  log: { info(m: string): void; warn(m: string): void; error(m: string): void },
  allowedHosts: ReadonlySet<string> = new Set(),
): RemoteListener {
  if (!cfg.tls) {
    const plain = http.createServer(onRequest);
    plain.on('error', (err) => log.error(tr('Acesso remoto: não deu para escutar na porta {0} ({1}).', [cfg.port, (err as Error).message])));
    plain.listen(cfg.port, cfg.host);
    return { server: plain, close: () => plain.close() };
  }
  const tls = cfg.tls;
  const read = () => ({ key: readFileSync(tls.keyFile), cert: readFileSync(tls.certFile) });
  const secure = https.createServer(read(), onRequest);
  secure.on('tlsClientError', () => {
    // Celular que ainda não confia na CA fecha o aperto de mão: normal até instalar o certificado.
  });
  const reload = () => {
    try {
      secure.setSecureContext(read());
      log.info(tr('   Acesso remoto: certificado recarregado.'));
    } catch (err) {
      log.warn(tr('   Acesso remoto: certificado novo ilegível, mantendo o anterior ({0}).', [(err as Error).message]));
    }
  };
  watchFile(tls.certFile, { interval: 15_000 }, (cur, prev) => {
    if (cur.mtimeMs !== prev.mtimeMs || cur.ino !== prev.ino) reload();
  });
  const redirect = http.createServer((req, res) => {
    const host = req.headers.host;
    req.resume();
    if (!host || !hostAllowed(host, allowedHosts)) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`${tr('Use https://')}\n`);
      return;
    }
    res.writeHead(308, { Location: `https://${host}${req.url ?? '/'}`, 'Cache-Control': 'no-store' });
    res.end();
  });
  const tcp = net.createServer((socket) => {
    // Conexão que não manda nada não fica pendurada para sempre.
    socket.setTimeout(FIRST_BYTE_MS, () => socket.destroy());
    socket.once('data', (first: Buffer) => {
      socket.setTimeout(0);
      socket.pause();
      socket.unshift(first);
      (first[0] === 0x16 ? secure : redirect).emit('connection', socket);
      process.nextTick(() => socket.resume());
    });
    socket.on('error', () => socket.destroy());
  });
  tcp.on('error', (err) => log.error(tr('Acesso remoto: não deu para escutar na porta {0} ({1}).', [cfg.port, (err as Error).message])));
  tcp.listen(cfg.port, cfg.host);
  return {
    server: tcp,
    close: () => {
      unwatchFile(tls.certFile);
      tcp.close();
      secure.close();
      redirect.close();
    },
  };
}
