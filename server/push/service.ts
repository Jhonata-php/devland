// Notificações push: guarda as chaves do servidor (VAPID) e os aparelhos assinados em <dataDir>/push/ e avisa todos quando um
// agente termina ou precisa de você. Quem assina é o navegador (service worker): POST /api/push/subscribe.
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { errMsg, log } from '../log';
import { tr } from '../../shared/i18n';
import { generateVapidKeys, lastPushStatus, sendPush, type PushSubscription, type VapidKeys } from './webpush';

const MAX_SUBS = 30;
/** Só os servidores de push dos navegadores (o endereço vem do navegador: nunca postamos em um endereço qualquer). */
const ALLOWED_HOST = /(^|\.)(googleapis\.com|push\.apple\.com|mozilla\.com|windows\.com|mozaws\.net)$/;

export interface PushMessage {
  title: string;
  body: string;
  tag?: string;
}

export interface PushServiceOptions {
  dir: string;
  /** "mailto:" ou https que identifica quem manda (o servidor de push pode usar para contato). */
  subject: string;
  fetchFn?: typeof fetch;
}

export class PushService {
  private keys!: VapidKeys;
  private subs: PushSubscription[] = [];

  constructor(private readonly o: PushServiceOptions) {}

  load(): void {
    mkdirSync(this.o.dir, { recursive: true });
    const vapid = join(this.o.dir, 'vapid.json');
    try {
      this.keys = JSON.parse(readFileSync(vapid, 'utf8')) as VapidKeys;
      if (typeof this.keys.publicKey !== 'string' || typeof this.keys.privateKey !== 'string') throw new Error('formato');
    } catch {
      this.keys = generateVapidKeys();
      writeFileSync(vapid, JSON.stringify(this.keys), { mode: 0o600 });
      chmodSync(vapid, 0o600);
    }
    try {
      const raw = JSON.parse(readFileSync(join(this.o.dir, 'subs.json'), 'utf8')) as unknown;
      if (Array.isArray(raw)) this.subs = raw.filter(isSub).slice(-MAX_SUBS);
    } catch {
      // sem assinaturas ainda
    }
  }

  publicKey(): string {
    return this.keys.publicKey;
  }

  count(): number {
    return this.subs.length;
  }

  subscribe(raw: unknown): { ok: true } | { ok: false; error: string } {
    const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const keys = (r.keys && typeof r.keys === 'object' ? r.keys : {}) as Record<string, unknown>;
    const sub = { endpoint: String(r.endpoint ?? ''), p256dh: String(keys.p256dh ?? ''), auth: String(keys.auth ?? '') };
    if (!isSub(sub)) return { ok: false, error: tr('assinatura de notificação inválida') };
    this.subs = [...this.subs.filter((s) => s.endpoint !== sub.endpoint), sub].slice(-MAX_SUBS);
    return this.save();
  }

  unsubscribe(endpoint: unknown): void {
    this.subs = this.subs.filter((s) => s.endpoint !== endpoint);
    this.save();
  }

  /** Manda a todos os aparelhos assinados; tira os que o servidor de push diz que não existem mais. Devolve quantos receberam. */
  async notify(msg: PushMessage): Promise<number> {
    return (await this.notifyDetailed(msg)).sent;
  }

  /** Como notify, mas diz também quantos aparelhos estão assinados e o status HTTP de quem recusou (para o teste explicar). */
  async notifyDetailed(msg: PushMessage): Promise<{ sent: number; subscribed: number; failed: number[] }> {
    let sent = 0;
    const failed: number[] = [];
    const subscribed = this.subs.length;
    const gone = new Set<string>();
    await Promise.all(
      this.subs.map(async (s) => {
        const out = await sendPush(s, msg, this.keys, this.o.subject, this.o.fetchFn);
        if (out === 'sent') sent++;
        else {
          failed.push(lastPushStatus.code);
          if (out === 'gone') gone.add(s.endpoint);
        }
      }),
    );
    if (gone.size) {
      this.subs = this.subs.filter((s) => !gone.has(s.endpoint));
      this.save();
    }
    return { sent, subscribed, failed };
  }

  private save(): { ok: true } | { ok: false; error: string } {
    try {
      const file = join(this.o.dir, 'subs.json');
      writeFileSync(`${file}.tmp`, JSON.stringify(this.subs), { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
      return { ok: true };
    } catch (err) {
      log.warnOnce('push-save', tr('Não deu para guardar as assinaturas de notificação: {0}', [errMsg(err)]));
      return { ok: false, error: errMsg(err) };
    }
  }
}

export function isSub(s: unknown): s is PushSubscription {
  const x = s as Partial<PushSubscription> | null;
  if (!x || typeof x.endpoint !== 'string' || typeof x.p256dh !== 'string' || typeof x.auth !== 'string') return false;
  if (x.endpoint.length > 600 || !/^[\w-]+$/.test(x.p256dh) || !/^[\w-]+$/.test(x.auth)) return false;
  let url: URL;
  try {
    url = new URL(x.endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || !ALLOWED_HOST.test(url.hostname)) return false;
  return Buffer.from(x.p256dh, 'base64url').length === 65 && Buffer.from(x.auth, 'base64url').length === 16;
}
