// Notificações (opt-in): Notification do navegador para alertas com a aba oculta, sons de aviso
// (sino de "precisa de você", estalo de conclusão; pela mesa de som da UI) e o contador no título da
// aba quando há agentes esperando você.
import type { Notice } from '../../../shared/types';
import type { SoundBoard } from '../audio/board';
import type { UiComponent, UiContext } from './context';
import { computeCounters } from './model';
import { tr } from '../../../shared/i18n';

const BASE_TITLE = 'Habblaud';

export type NotificationState = 'unsupported' | 'default' | 'granted' | 'denied';

export function notificationState(): NotificationState {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/** applicationServerKey do navegador: base64url -> bytes. */
function keyBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export class Notifier implements UiComponent {
  private lastTitle = '';
  /** Este aparelho está assinado no push do servidor: ele avisa até com a página fechada, então a página não repete. */
  private pushActive = false;

  constructor(
    private ctx: UiContext,
    private sounds: SoundBoard,
  ) {
    ctx.store.on('notice', (n) => this.onNotice(n));
    // Já ligado antes (preferência guardada e permissão dada): garante a assinatura do push depois de um reinício do servidor.
    if (ctx.prefs.browserNotifications && notificationState() === 'granted') void this.subscribePush();
  }

  /** Registra o service worker e assina este aparelho no push do servidor. Devolve se ficou assinado. */
  async subscribePush(): Promise<boolean> {
    if (this.ctx.store.mock || typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const res = await fetch('/api/push/key', { credentials: 'same-origin' });
      if (!res.ok) return false;
      const key = ((await res.json()) as { publicKey?: string }).publicKey;
      if (!key) return false;
      let sub = await reg.pushManager.getSubscription();
      try {
        sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
      } catch {
        // chave do servidor mudou: a assinatura antiga não vale mais
        await sub?.unsubscribe();
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
      }
      const ok = (await fetch('/api/push/subscribe', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub.toJSON()) })).ok;
      this.pushActive = ok;
      return ok;
    } catch {
      return false;
    }
  }

  /** Desliga o push deste aparelho (o servidor esquece a assinatura). */
  async unsubscribePush(): Promise<void> {
    this.pushActive = false;
    try {
      const reg = await navigator.serviceWorker?.getRegistration('/sw.js');
      const sub = await reg?.pushManager.getSubscription();
      if (!sub) return;
      await fetch('/api/push/unsubscribe', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    } catch {
      // sem service worker: nada a desligar
    }
  }

  /** Manda uma notificação de teste a todos os aparelhos assinados. Devolve quantos receberam (ou -1 se falhou). */
  async testPush(): Promise<number> {
    try {
      const res = await fetch('/api/push/test', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      return res.ok ? ((await res.json()) as { sent?: number }).sent ?? 0 : -1;
    } catch {
      return -1;
    }
  }

  /** Pede permissão de notificação ao ligar a opção. Devolve o estado final. */
  async enableBrowserNotifications(): Promise<NotificationState> {
    const state = notificationState();
    if (state === 'unsupported' || state === 'denied') return state;
    if (state === 'default') {
      try {
        await Notification.requestPermission();
      } catch {
        // alguns navegadores só aceitam a pergunta por gesto do usuário
      }
    }
    const now = notificationState();
    if (now === 'granted') await this.subscribePush();
    return now;
  }

  render(): void {
    // Ao vivo, mesmo durante o timelapse: o título da aba avisa quem precisa de você agora.
    const waiting = computeCounters(this.ctx.store.liveSnapshot).waiting;
    const title = waiting > 0 ? `(${waiting}) ${BASE_TITLE}` : BASE_TITLE;
    if (title !== this.lastTitle) {
      this.lastTitle = title;
      document.title = title;
    }
  }

  private onNotice(n: Notice): void {
    const prefs = this.ctx.prefs;
    // o sino toca mesmo com a aba oculta (é ele que chama você de volta); o estalo, só com ela à vista
    if (n.level === 'alert') this.sounds.play('chime');
    else if (n.level === 'success') this.sounds.play('pop');
    if (!this.pushActive && (n.level === 'alert' || n.level === 'success') && prefs.browserNotifications && document.hidden && notificationState() === 'granted') {
      try {
        const notification = new Notification(n.level === 'alert' ? tr('Habblaud — precisa de você') : tr('Habblaud — terminou'), {
          body: n.text,
          tag: n.agentId ?? n.id,
          icon: '/assets/brand/favicon-32.png',
        });
        notification.onclick = () => {
          window.focus();
          if (n.agentId && this.ctx.agent(n.agentId)) this.ctx.select({ type: 'agent', id: n.agentId }, { focus: true });
          notification.close();
        };
      } catch {
        // Alguns navegadores só permitem notificações via service worker; o toast continua aparecendo.
      }
    }
  }
}
