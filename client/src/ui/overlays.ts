// Camadas de estado: splash de carregamento, escritório vazio e aviso de conexão perdida.
import type { UiComponent, UiContext } from './context';
import { accountsClick } from './accounts';
import { h, iconButton, prefersReducedMotion, setHidden, setText } from './dom';
import { ICONS } from './icons';
import { emptyOfficeHint } from './provider';
import { wordmark } from './widgets';
import { tr } from '../../../shared/i18n';
import { access } from '../net/access';
import { appearanceFromSeed, characterSprite, poseFrameCount, poseFrameDuration } from '../art';
import type { Dir, HeldItem, Pose } from '../art/api';

/** Depois de quanto tempo sem conexão o aviso aparece. */
const DISCONNECTED_BANNER_MS = 8_000;

/** Cenas do bonequinho da tela de carregamento: a pose, para onde olha, o que segura e o balão. */
const SPLASH_SCENES: { pose: Pose; dir: Dir; held?: HeldItem; walk?: boolean; say: () => string }[] = [
  { pose: 'walk', dir: 'right', walk: true, say: () => tr('Chegando no escritório…') },
  { pose: 'drink', dir: 'down', held: 'coffee', say: () => tr('Passando um café…') },
  { pose: 'stretch', dir: 'down', say: () => tr('Ligando os monitores…') },
  { pose: 'talk', dir: 'down', say: () => tr('Chamando os agentes…') },
];
const SPLASH_SCENE_MS = 2400;
/** Palco em px de mundo (desenhado 3x maior, pixelado). */
const STAGE_W = 72;
const STAGE_H = 36;

/** O bonequinho da tela de carregamento: anda, toma café, se espreguiça e chama a turma, com um balão por cena. */
function splashScene(): { el: HTMLElement; stop(): void } {
  const canvas = h('canvas', { class: 'ui-splash__stage', attrs: { width: STAGE_W, height: STAGE_H, 'aria-hidden': 'true' } });
  const say = h('span', { class: 'ui-splash__say' });
  const el = h('div', { class: 'ui-splash__scene' }, say, canvas);
  const ctx = canvas.getContext('2d');
  const look = Math.random() < 0.5 ? 'f' : 'm';
  const appearance = appearanceFromSeed(Math.floor(Math.random() * 1e9), { look });
  const t0 = performance.now();
  let raf = 0;
  let scene = -1;
  const draw = (now: number) => {
    const t = Math.max(0, now - t0);
    const i = Math.floor(t / SPLASH_SCENE_MS) % SPLASH_SCENES.length;
    const sc = SPLASH_SCENES[i];
    if (i !== scene) {
      scene = i;
      say.textContent = sc.say();
      say.classList.remove('is-pop');
      void say.offsetWidth;
      say.classList.add('is-pop');
    }
    if (ctx) {
      ctx.clearRect(0, 0, STAGE_W, STAGE_H);
      // chão: uma faixa de piso com o quadriculado do mapa
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(0, STAGE_H - 4, STAGE_W, 1);
      for (let x = 2; x < STAGE_W; x += 8) ctx.fillRect(x, STAGE_H - 3, 1, 3);
      const p = (t % SPLASH_SCENE_MS) / SPLASH_SCENE_MS;
      // na cena de andar ele entra pela esquerda e para no meio; nas outras fica no meio
      const x = sc.walk ? Math.round(8 + (STAGE_W / 2 - 8) * Math.min(1, p * 1.25)) : STAGE_W / 2;
      const pose: Pose = sc.walk && p * 1.25 >= 1 ? 'stand' : sc.pose;
      const frame = Math.floor(t / poseFrameDuration(pose)) % poseFrameCount(pose);
      const spr = characterSprite({ appearance, dir: sc.dir, pose, frame, held: sc.held });
      ctx.drawImage(spr.canvas, Math.round(x - spr.ax), Math.round(STAGE_H - 4 - spr.ay));
    }
    raf = requestAnimationFrame(draw);
  };
  if (prefersReducedMotion()) {
    say.textContent = SPLASH_SCENES[1].say();
    requestAnimationFrame((now) => {
      draw(now);
      cancelAnimationFrame(raf);
    });
  } else raf = requestAnimationFrame(draw);
  return { el, stop: () => cancelAnimationFrame(raf) };
}

export class Splash implements UiComponent {
  readonly el: HTMLElement;
  private text: HTMLElement;
  private done = false;
  private readonly startedAt = performance.now();
  private tick: ReturnType<typeof setTimeout> | null = null;
  private readonly scene = splashScene();

  constructor(private ctx: UiContext) {
    this.text = h('p', { class: 'ui-splash__text', text: tr('Conectando ao escritório…') });
    this.el = h(
      'div',
      { class: 'ui-splash', role: 'status', attrs: { 'aria-live': 'polite' } },
      h('div', { class: 'ui-splash__inner' }, this.scene.el, wordmark('ui-splash__name'), this.text, h('span', { class: 'ui-splash__bar' })),
    );
  }

  render(): void {
    if (this.done) return;
    const { store } = this.ctx;
    if (store.snapshot) {
      this.done = true;
      this.el.classList.add('is-hidden');
      const remove = () => {
        this.scene.stop();
        this.el.remove();
      };
      if (prefersReducedMotion()) remove();
      else setTimeout(remove, 600);
      return;
    }
    const waited = performance.now() - this.startedAt;
    let text = tr('Conectando ao escritório…');
    if (waited > DISCONNECTED_BANNER_MS) text = tr('O servidor do DevLand não responde. Confira se ele está rodando (npm run dev ou npm start); seguimos tentando.');
    else if (store.connection === 'closed') text = tr('Não foi possível conectar ao servidor do DevLand. Tentando de novo…');
    setText(this.text, text);
    // Reavalia o texto mesmo sem eventos novos.
    this.tick ??= setTimeout(() => {
      this.tick = null;
      this.ctx.invalidate();
    }, 1_000);
  }
}

/** Conectado e sem nenhuma sessão: o cartão "escritório vazio" aparece (e os painéis não repetem o aviso). */
export function officeIsEmpty(ctx: UiContext): boolean {
  const { store } = ctx;
  const snap = store.snapshot;
  const connected = store.connection === 'open' || store.connection === 'mock';
  // No timelapse, um momento sem ninguém não é "abra o Claude Code (ou o Codex)".
  return connected && !store.replaying && !!snap && snap.agents.length === 0 && snap.rooms.length === 0;
}

export class EmptyState implements UiComponent {
  readonly el: HTMLElement;
  private hint: HTMLElement;
  private demoBtn: HTMLButtonElement;
  /** Habblaud Cloud: o servidor é a máquina; o primeiro agente começa por aqui. */
  private cloudRow: HTMLElement;
  private termBtn: HTMLButtonElement;
  private busy = false;
  /** Fechado pelo X: não volta até o escritório ter agentes (aí a próxima vez que esvaziar mostra de novo). */
  private dismissed = false;

  constructor(
    private ctx: UiContext,
    /** Abre o Claude Code num terminal interativo (Habblaud Cloud); ausente/false = sem o botão. */
    private terminal?: { enabled: boolean; open(cwd: string): Promise<void> },
  ) {
    const art = h('div', { class: 'ui-empty__art', attrs: { 'aria-hidden': 'true' } });
    const img = h('img', { attrs: { src: '/assets/illustrations/empty-office.png', alt: '', draggable: 'false' } });
    img.addEventListener('error', () => {
      img.remove();
      art.classList.add('is-css');
      // Ilustração em CSS: mesa vazia, monitor apagado, planta e luminária.
      art.append(
        h('span', { class: 'ui-empty__lamp' }),
        h('span', { class: 'ui-empty__monitor' }),
        h('span', { class: 'ui-empty__desk' }),
        h('span', { class: 'ui-empty__chair' }),
        h('span', { class: 'ui-empty__plant' }),
      );
    });
    art.append(img);
    this.hint = h('p', { class: 'ui-empty__text' });
    this.demoBtn = h('button', { class: 'ui-btn ui-btn--primary', type: 'button', text: tr('Ver demonstração'), on: { click: () => void this.startDemo() } });
    this.el = h(
      'section',
      { class: 'ui-empty', hidden: true, attrs: { 'aria-labelledby': 'ui-empty-title' } },
      iconButton(ICONS.close, tr('Fechar'), () => {
        this.dismissed = true;
        this.ctx.invalidate();
      }, 'ui-icon-btn--sm ui-empty__close'),
      art,
      h('h2', { class: 'ui-empty__title', text: tr('O escritório está vazio'), attrs: { id: 'ui-empty-title' } }),
      this.hint,
      (this.cloudRow = h(
        'div',
        { class: 'ui-empty__actions', hidden: true },
        h('a', { class: 'ui-btn ui-btn--primary ui-btn-accounts', text: tr('Conectar contas'), attrs: { href: '/contas' }, on: { click: accountsClick(ctx.root) } }),
        (this.termBtn = h('button', { class: 'ui-btn ui-btn--primary', type: 'button', text: tr('Novo agente'), title: tr('Escolha o projeto e comece um agente'), on: { click: () => void this.openTerminal() } }) as HTMLButtonElement),
      )),
      this.demoBtn,
    );
  }

  private async openTerminal(): Promise<void> {
    this.termBtn.disabled = true;
    try {
      await this.terminal?.open('/workspace');
    } catch (err) {
      this.ctx.announce((err as Error).message || tr('Não foi possível abrir o terminal.'));
    } finally {
      this.termBtn.disabled = false;
    }
  }

  render(): void {
    const { store } = this.ctx;
    const snap = store.snapshot;
    const empty = officeIsEmpty(this.ctx);
    if (!empty) this.dismissed = false;
    const show = empty && !this.dismissed;
    setHidden(this.el, !show);
    if (!show || !snap) return;
    const cloud = !!access().cloud;
    setText(this.hint, cloud ? tr('Conecte uma conta do Claude ou do Codex e abra um terminal: o agente aparece aqui no escritório.') : emptyOfficeHint(snap.accounts));
    setHidden(this.cloudRow, !cloud);
    setHidden(this.termBtn, !this.terminal?.enabled);
    this.demoBtn.disabled = this.busy;
    setHidden(this.demoBtn, store.mock || (cloud && !access().admin));
  }

  private async startDemo(): Promise<void> {
    this.busy = true;
    this.ctx.invalidate();
    try {
      const ok = await this.ctx.store.setDemo(true);
      if (!ok) this.ctx.announce(tr('Não foi possível ligar a demonstração.'));
    } catch {
      this.ctx.announce(tr('Não foi possível falar com o servidor.'));
    } finally {
      this.busy = false;
      this.ctx.invalidate();
    }
  }
}

export class ConnectionBanner implements UiComponent {
  readonly el: HTMLElement;
  private since: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private text: HTMLElement;
  private retry: HTMLElement;

  constructor(private ctx: UiContext) {
    this.text = h('span');
    this.retry = h('span', { class: 'ui-banner__retry' });
    // A reconexão automática (com espera crescente) mora no store; o botão só antecipa a próxima tentativa.
    const retryBtn = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Tentar agora'), on: { click: () => ctx.store.reconnectNow() } });
    this.el = h(
      'div',
      { class: 'ui-banner', role: 'alert', hidden: true },
      h('span', { class: 'ui-banner__dot', attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'ui-banner__text' }, this.text, this.retry),
      retryBtn,
    );
  }

  render(): void {
    const { store } = this.ctx;
    const conn = store.connection;
    const down = conn === 'connecting' || conn === 'closed';
    if (!down) {
      this.since = null;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      setHidden(this.el, true);
      return;
    }
    this.since ??= Date.now();
    const elapsed = Date.now() - this.since;
    if (elapsed < DISCONNECTED_BANNER_MS) {
      this.timer ??= setTimeout(() => {
        this.timer = null;
        this.ctx.invalidate();
      }, DISCONNECTED_BANNER_MS - elapsed + 50);
      return;
    }
    setText(
      this.text,
      store.snapshot
        ? tr('Sem conexão com o servidor do DevLand há algum tempo. O escritório mostra o último estado conhecido.')
        : tr('O servidor do DevLand não responde. Confira se ele está rodando (npm run dev ou npm start).'),
    );
    const next = store.nextRetryAt;
    const secs = next === null ? 0 : Math.max(1, Math.ceil((next - Date.now()) / 1000));
    setText(this.retry, next === null ? tr(' Tentando reconectar…') : tr(' Nova tentativa em {0} s.', [secs]));
    setHidden(this.el, false);
    // Atualiza a contagem regressiva a cada segundo enquanto o aviso estiver aberto.
    this.timer ??= setTimeout(() => {
      this.timer = null;
      this.ctx.invalidate();
    }, 1_000);
  }
}
