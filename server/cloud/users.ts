// Usuários e convites do Habblaud Cloud (HABBLAUD_CLOUD=1), em <dataDir>/users.json (permissão 600).
//
// Senha só como hash scrypt (remote/password.ts). Convite: token aleatório entregue uma vez ao admin; o arquivo guarda
// só o SHA-256 dele. `epoch` entra na chave das sessões do usuário (http/remote.ts): somar 1 derruba todas.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { newBackupCodes, newSecret, otpauthUri, verifyTotp } from './totp';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RemoteFeature } from '../http/remote';
import { hashPassword, parsePasswordHash, verifyPassword } from '../remote/password';
import { tr } from '../../shared/i18n';

export type Role = 'admin' | 'user';

export const FEATURES: readonly RemoteFeature[] = ['permissions', 'messages', 'terminal', 'spawn'];
export const PASSWORD_MIN = 10;
export const NAME_RE = /^[\p{L}\p{N}._-]{2,32}$/u;
export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
export const INVITE_MS = 7 * 24 * 60 * 60 * 1000;
/** Link de "esqueci a senha": vale por 30 min e uma vez só. */
export const RESET_MS = 30 * 60 * 1000;

export interface User {
  id: string;
  name: string;
  /** E-mail de entrada (minúsculo, único). Contas antigas não têm: entram pelo usuário e definem o e-mail no perfil. */
  email?: string;
  passwordHash: string;
  role: Role;
  allow: RemoteFeature[];
  epoch: number;
  createdAt: number;
  /** Verificação em duas etapas (cloud/totp.ts): segredo em base32, ligado só depois de confirmado com um código. */
  totpSecret?: string;
  totpEnabled?: boolean;
  /** Segredo gerado e ainda não confirmado (ativação em andamento). */
  totpPending?: string;
  /** SHA-256 dos códigos de reserva ainda não usados. */
  backupHashes?: string[];
}

export interface Invite {
  /** SHA-256 (hex) do token. */
  hash: string;
  role: Role;
  allow: RemoteFeature[];
  expiresAt: number;
  createdBy: string;
  /** E-mail de quem foi convidado: o link vai para ele e a conta nasce com esse e-mail. */
  email?: string;
  /** Nome sugerido pelo admin (a pessoa confirma ao criar a conta). */
  name?: string;
}

/** O que sai pela API (sem o hash da senha). */
export type PublicUser = Omit<User, 'passwordHash' | 'epoch'>;

export interface Reset {
  /** SHA-256 (hex) do token. */
  hash: string;
  userId: string;
  expiresAt: number;
}

interface FileData {
  users: User[];
  invites: Invite[];
  resets?: Reset[];
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
  private data: FileData = { users: [], invites: [], resets: [] };
  /** Hash de verdade para conferir quando o usuário não existe (o scrypt roda igual: não denuncia quem existe). */
  private dummy?: Promise<string>;

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
    private readonly logN?: number,
  ) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<FileData>;
      this.data = { users: Array.isArray(raw.users) ? raw.users : [], invites: Array.isArray(raw.invites) ? raw.invites : [], resets: Array.isArray(raw.resets) ? raw.resets : [] };
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

  async create(name: string, password: string, role: Role, allow: RemoteFeature[], email?: string): Promise<User> {
    const clean = name.trim();
    const mail = email === undefined ? undefined : this.cleanEmail(email);
    if (!NAME_RE.test(clean)) throw new UserError(tr('Nome inválido: use de 2 a 32 letras, números, ponto, hífen ou sublinhado.'));
    if (password.length < PASSWORD_MIN) throw new UserError(tr('A senha precisa ter pelo menos {0} caracteres.', [PASSWORD_MIN]));
    if (this.byName(clean)) throw new UserError(tr('Esse nome já está em uso.'));
    if (mail && this.byEmail(mail)) throw new UserError(tr('Esse e-mail já está em uso.'));
    const user: User = {
      id: randomUUID(),
      name: clean,
      ...(mail ? { email: mail } : {}),
      passwordHash: await hashPassword(password, this.logN),
      role,
      allow: role === 'admin' ? [...FEATURES] : cleanAllow(allow),
      epoch: 0,
      createdAt: this.now(),
    };
    // Outra criação pode ter terminado enquanto o scrypt rodava.
    if (this.byName(clean) || (mail && this.byEmail(mail))) throw new UserError(tr('Esse nome ou e-mail já está em uso.'));
    this.data.users.push(user);
    this.save();
    return user;
  }

  /** Confere e-mail (ou usuário) e senha; o scrypt roda mesmo sem o usuário. */
  async verify(login: string, password: string): Promise<User | undefined> {
    const id = login.trim();
    // A entrada é pelo e-mail. Só contas antigas, criadas antes de existir e-mail, ainda entram pelo nome.
    const byName = id.includes('@') ? undefined : this.byName(id);
    const user = id.includes('@') ? this.byEmail(id.toLowerCase()) : byName && !byName.email ? byName : undefined;
    this.dummy ??= hashPassword(randomBytes(16).toString('hex'), this.logN);
    const hash = parsePasswordHash(user?.passwordHash ?? (await this.dummy));
    const ok = !!hash && (await verifyPassword(password, hash));
    return ok && user ? user : undefined;
  }

  /** Define (ou troca) o e-mail de entrada de um usuário. */
  /** Começa a ativar a verificação em duas etapas: segredo novo, ainda desligado até confirmar com um código. */
  startTotp(id: string): { secret: string; uri: string } {
    const user = this.get(id);
    if (!user) throw new UserError(tr('Usuário não encontrado.'));
    const secret = newSecret();
    user.totpPending = secret;
    this.save();
    return { secret, uri: otpauthUri(secret, user.email ?? user.name) };
  }

  /** Confirma a ativação com um código do app; devolve os códigos de reserva (mostrados uma vez só). */
  enableTotp(id: string, code: string): string[] {
    const user = this.get(id);
    if (!user?.totpPending) throw new UserError(tr('Comece a ativação de novo.'));
    if (!verifyTotp(user.totpPending, code)) throw new UserError(tr('Código inválido: confira o horário do celular e tente o código novo.'));
    const backup = newBackupCodes();
    user.totpSecret = user.totpPending;
    user.totpEnabled = true;
    delete user.totpPending;
    user.backupHashes = backup.map((c) => sha256(c));
    this.save();
    return backup;
  }

  /** Desliga a verificação em duas etapas (pede um código válido, do app ou de reserva). */
  disableTotp(id: string, code: string): void {
    const user = this.get(id);
    if (!user?.totpEnabled) return;
    if (!this.checkSecondFactor(id, code)) throw new UserError(tr('Código inválido.'));
    delete user.totpSecret;
    delete user.totpEnabled;
    delete user.backupHashes;
    this.save();
  }

  needsSecondFactor(id: string): boolean {
    return !!this.get(id)?.totpEnabled;
  }

  /** Código do app (TOTP) ou um código de reserva, que deixa de valer ao ser usado. */
  checkSecondFactor(id: string, code: string): boolean {
    const user = this.get(id);
    if (!user?.totpEnabled || !user.totpSecret) return false;
    if (verifyTotp(user.totpSecret, code)) return true;
    const h = sha256(code.trim().toLowerCase());
    const i = user.backupHashes?.indexOf(h) ?? -1;
    if (i < 0) return false;
    user.backupHashes!.splice(i, 1);
    this.save();
    return true;
  }

  setEmail(id: string, email: string): User {
    const user = this.get(id);
    if (!user) throw new UserError(tr('Usuário não encontrado.'));
    const mail = this.cleanEmail(email);
    const other = this.byEmail(mail);
    if (other && other.id !== id) throw new UserError(tr('Esse e-mail já está em uso.'));
    user.email = mail;
    this.save();
    return user;
  }

  private cleanEmail(raw: string): string {
    const mail = raw.trim().toLowerCase();
    if (!EMAIL_RE.test(mail) || mail.length > 254) throw new UserError(tr('E-mail inválido.'));
    return mail;
  }

  private byEmail(mail: string): User | undefined {
    return this.data.users.find((u) => u.email === mail);
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

  createInvite(role: Role, allow: RemoteFeature[], createdBy: string, email?: string, name?: string): { token: string; expiresAt: number } {
    const mail = email === undefined ? undefined : this.cleanEmail(email);
    const label = name?.trim() || undefined;
    if (label && !NAME_RE.test(label)) throw new UserError(tr('Nome inválido: use de 2 a 32 letras, números, ponto, hífen ou sublinhado.'));
    if (mail && this.byEmail(mail)) throw new UserError(tr('Esse e-mail já tem conta.'));
    const token = randomBytes(32).toString('base64url');
    const expiresAt = this.now() + INVITE_MS;
    this.prune();
    this.data.invites.push({ hash: sha256(token), role, allow: role === 'admin' ? [...FEATURES] : cleanAllow(allow), expiresAt, createdBy, ...(mail ? { email: mail } : {}), ...(label ? { name: label } : {}) });
    this.save();
    return { token, expiresAt };
  }

  inviteValid(token: string): boolean {
    return !!this.findInvite(token);
  }

  /** Desfaz um convite que não chegou a ser entregue (o e-mail falhou). */
  revokeInvite(token: string): void {
    const invite = this.findInvite(token);
    if (!invite) return;
    this.data.invites = this.data.invites.filter((i) => i !== invite);
    this.save();
  }

  /** Nome que o admin sugeriu para o convite. */
  inviteName(token: string): string | undefined {
    return this.findInvite(token)?.name;
  }

  /** E-mail para o qual o convite foi mandado (a conta nasce com ele). */
  inviteEmail(token: string): string | undefined {
    return this.findInvite(token)?.email;
  }

  async acceptInvite(token: string, name: string, password: string, email?: string): Promise<User> {
    const invite = this.findInvite(token);
    if (!invite) throw new UserError(tr('Convite inválido, vencido ou já usado.'));
    // Gasta o convite antes do scrypt: duas aberturas ao mesmo tempo não criam duas contas.
    this.data.invites = this.data.invites.filter((i) => i !== invite);
    try {
      return await this.create(name, password, invite.role, invite.allow, invite.email ?? email);
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

  /** Quem tem este e-mail (ou, se vier um nome de usuário, esse usuário), desde que tenha e-mail para receber o link. */
  findForReset(login: string): User | undefined {
    const id = login.trim();
    const user = id.includes('@') ? this.byEmail(id.toLowerCase()) : this.byName(id);
    return user?.email ? user : undefined;
  }

  /** Token novo de redefinição de senha (um por usuário: o anterior deixa de valer). */
  createReset(userId: string): { token: string; expiresAt: number } {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = this.now() + RESET_MS;
    this.prune();
    this.data.resets = (this.data.resets ?? []).filter((r) => r.userId !== userId);
    this.data.resets.push({ hash: sha256(token), userId, expiresAt });
    this.save();
    return { token, expiresAt };
  }

  resetValid(token: string): boolean {
    return !!this.findReset(token);
  }

  /** Troca a senha com o token (uso único), derruba as sessões abertas e devolve o usuário. */
  async resetPassword(token: string, password: string): Promise<User> {
    const reset = this.findReset(token);
    if (!reset) throw new UserError(tr('Link inválido, vencido ou já usado. Peça um novo.'));
    if (password.length < PASSWORD_MIN) throw new UserError(tr('A senha precisa ter pelo menos {0} caracteres.', [PASSWORD_MIN]));
    const user = this.get(reset.userId);
    if (!user) throw new UserError(tr('Link inválido, vencido ou já usado. Peça um novo.'));
    // Gasta o token antes do scrypt: dois envios ao mesmo tempo não valem os dois.
    this.data.resets = (this.data.resets ?? []).filter((r) => r !== reset);
    try {
      user.passwordHash = await hashPassword(password, this.logN);
    } catch (err) {
      this.data.resets.push(reset);
      throw err;
    }
    user.epoch++;
    this.save();
    return user;
  }

  private findReset(token: string): Reset | undefined {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
    const hash = sha256(token);
    return (this.data.resets ?? []).find((r) => r.hash === hash && r.expiresAt > this.now());
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
    this.data.resets = (this.data.resets ?? []).filter((r) => r.expiresAt > now);
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
  return { id: u.id, name: u.name, ...(u.email ? { email: u.email } : {}), role: u.role, allow: [...u.allow], createdAt: u.createdAt };
}
