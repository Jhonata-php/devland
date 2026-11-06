// Usuários e convites do Habblaud Cloud (HABBLAUD_CLOUD=1), em <dataDir>/users.json (permissão 600).
//
// Senha só como hash scrypt (remote/password.ts). Convite: token aleatório entregue uma vez ao admin; o arquivo guarda
// só o SHA-256 dele. `epoch` entra na chave das sessões do usuário (http/remote.ts): somar 1 derruba todas.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RemoteFeature } from '../http/remote';
import { hashPassword, parsePasswordHash, verifyPassword } from '../remote/password';
import { tr } from '../../shared/i18n';

export type Role = 'admin' | 'user';

export const FEATURES: readonly RemoteFeature[] = ['permissions', 'messages', 'terminal', 'spawn'];
export const PASSWORD_MIN = 10;
export const NAME_RE = /^[\p{L}\p{N}._-]{2,32}$/u;
export const INVITE_MS = 7 * 24 * 60 * 60 * 1000;

export interface User {
  id: string;
  name: string;
  passwordHash: string;
  role: Role;
  allow: RemoteFeature[];
  epoch: number;
  createdAt: number;
}

export interface Invite {
  /** SHA-256 (hex) do token. */
  hash: string;
  role: Role;
  allow: RemoteFeature[];
  expiresAt: number;
  createdBy: string;
}

/** O que sai pela API (sem o hash da senha). */
export type PublicUser = Omit<User, 'passwordHash' | 'epoch'>;

interface FileData {
  users: User[];
  invites: Invite[];
}

export class UserError extends Error {}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export function cleanAllow(raw: unknown): RemoteFeature[] {
  if (!Array.isArray(raw)) return [];
  return FEATURES.filter((f) => raw.includes(f));
}

/** Admin pode tudo; usuário, o que estiver na lista dele. */
export function allowedOf(user: Pick<User, 'role' | 'allow'>): Set<RemoteFeature> {
  return new Set(user.role === 'admin' ? FEATURES : user.allow);
}

export class UserStore {
  private data: FileData = { users: [], invites: [] };
  /** Hash de verdade para conferir quando o usuário não existe (o scrypt roda igual: não denuncia quem existe). */
  private dummy?: Promise<string>;

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
    private readonly logN?: number,
  ) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<FileData>;
      this.data = { users: Array.isArray(raw.users) ? raw.users : [], invites: Array.isArray(raw.invites) ? raw.invites : [] };
    } catch {
      // sem arquivo: instalação nova
    }
  }

  isEmpty(): boolean {
    return this.data.users.length === 0;
  }

  get(id: string): User | undefined {
    return this.data.users.find((u) => u.id === id);
  }

  list(): PublicUser[] {
    return this.data.users.map(toPublic);
  }

  async create(name: string, password: string, role: Role, allow: RemoteFeature[]): Promise<User> {
    const clean = name.trim();
    if (!NAME_RE.test(clean)) throw new UserError(tr('Nome inválido: use de 2 a 32 letras, números, ponto, hífen ou sublinhado.'));
    if (password.length < PASSWORD_MIN) throw new UserError(tr('A senha precisa ter pelo menos {0} caracteres.', [PASSWORD_MIN]));
    if (this.byName(clean)) throw new UserError(tr('Esse nome já está em uso.'));
    const user: User = {
      id: randomUUID(),
      name: clean,
      passwordHash: await hashPassword(password, this.logN),
      role,
      allow: role === 'admin' ? [...FEATURES] : cleanAllow(allow),
      epoch: 0,
      createdAt: this.now(),
    };
    // Outra criação pode ter terminado enquanto o scrypt rodava.
    if (this.byName(clean)) throw new UserError(tr('Esse nome já está em uso.'));
    this.data.users.push(user);
    this.save();
    return user;
  }

  /** Confere nome e senha; o scrypt roda mesmo sem o usuário. */
  async verify(name: string, password: string): Promise<User | undefined> {
    const user = this.byName(name.trim());
    this.dummy ??= hashPassword(randomBytes(16).toString('hex'), this.logN);
    const hash = parsePasswordHash(user?.passwordHash ?? (await this.dummy));
    const ok = !!hash && (await verifyPassword(password, hash));
    return ok && user ? user : undefined;
  }

  update(id: string, patch: { role?: Role; allow?: RemoteFeature[] }): User {
    const user = this.get(id);
    if (!user) throw new UserError(tr('Usuário não encontrado.'));
    if (patch.role && patch.role !== user.role) {
      if (user.role === 'admin' && this.admins() === 1) throw new UserError(tr('A instalação precisa de pelo menos um admin.'));
      user.role = patch.role;
    }
    user.allow = user.role === 'admin' ? [...FEATURES] : cleanAllow(patch.allow ?? user.allow);
    this.save();
    return user;
  }

  remove(id: string): void {
    const user = this.get(id);
    if (!user) throw new UserError(tr('Usuário não encontrado.'));
    if (user.role === 'admin' && this.admins() === 1) throw new UserError(tr('A instalação precisa de pelo menos um admin.'));
    this.data.users = this.data.users.filter((u) => u.id !== id);
    this.save();
  }

  /** Derruba todas as sessões do usuário. */
  bumpEpoch(id: string): void {
    const user = this.get(id);
    if (!user) return;
    user.epoch++;
    this.save();
  }

  createInvite(role: Role, allow: RemoteFeature[], createdBy: string): { token: string; expiresAt: number } {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = this.now() + INVITE_MS;
    this.prune();
    this.data.invites.push({ hash: sha256(token), role, allow: role === 'admin' ? [...FEATURES] : cleanAllow(allow), expiresAt, createdBy });
    this.save();
    return { token, expiresAt };
  }

  inviteValid(token: string): boolean {
    return !!this.findInvite(token);
  }

  async acceptInvite(token: string, name: string, password: string): Promise<User> {
    const invite = this.findInvite(token);
    if (!invite) throw new UserError(tr('Convite inválido, vencido ou já usado.'));
    // Gasta o convite antes do scrypt: duas aberturas ao mesmo tempo não criam duas contas.
    this.data.invites = this.data.invites.filter((i) => i !== invite);
    try {
      return await this.create(name, password, invite.role, invite.allow);
    } catch (err) {
      this.data.invites.push(invite);
      this.save();
      throw err;
    }
  }

  private findInvite(token: string): Invite | undefined {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
    const hash = sha256(token);
    return this.data.invites.find((i) => i.hash === hash && i.expiresAt > this.now());
  }

  private byName(name: string): User | undefined {
    const key = name.toLowerCase();
    return this.data.users.find((u) => u.name.toLowerCase() === key);
  }

  private admins(): number {
    return this.data.users.filter((u) => u.role === 'admin').length;
  }

  private prune(): void {
    const now = this.now();
    this.data.invites = this.data.invites.filter((i) => i.expiresAt > now);
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.file);
  }
}

function toPublic(u: User): PublicUser {
  return { id: u.id, name: u.name, role: u.role, allow: [...u.allow], createdAt: u.createdAt };
}
