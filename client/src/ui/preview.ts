// Prévia ao vivo: janela com um "navegador" (iframe) que mostra o site do projeto em desenvolvimento. O servidor
// (server/http/preview.ts) faz o proxy autenticado de 127.0.0.1:<porta> e entrega um endereço com token; aqui só se
// escolhe a porta (detectada entre as comuns ou digitada) e se recarrega sozinho quando um agente do projeto mexe
// num arquivo. O iframe é "sandbox" (origem opaca): o site da prévia não alcança a API do Habblaud.
import { tr } from '../../../shared/i18n';
import { access } from '../net/access';
import type { UiComponent, UiContext } from './context';
import { h, iconButton, setHidden, setText } from './dom';
import { ICONS } from './icons';

const PORT_KEY = 'habblaud.preview.port';
const RELOAD_DEBOUNCE_MS = 1_200;
/** O token dura 1 h no servidor; renova antes. */
const RENEW_MS = 50 * 60_000;

/** "3000", "localhost:5173/x", "http://127.0.0.1:8080" -> porta (só 1024-65535). */
export function portOf(text: string): number | undefined {
  const m = /^\s*(?:https?:\/\/)?(?:(?:localhost|127\.0\.0\.1|\[::1\]):)?(\d{1,5})(?:[/?#].*)?\s*$/i.exec(text);
  const n = m ? Number(m[1]) : NaN;
  return n >= 1024 && n <= 65535 ? n : undefined;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? String(res.status));
  return json;
}

export class PreviewPanel implements UiComponent {
  readonly button: HTMLButtonElement;
  readonly el: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly ports: HTMLElement;
  // Rodar o projeto: o DevLand sobe o npm run dev da pasta escolhida e abre a prévia na porta que ele anunciar.
  private readonly projectSel: HTMLSelectElement;
  private readonly runBtn: HTMLButtonElement;
  private readonly stopBtn: HTMLButtonElement;
  private readonly frame: HTMLIFrameElement;
  private readonly stage: HTMLElement;
  private readonly note: HTMLElement;
  private readonly liveBtn: HTMLButtonElement;
  private readonly phoneBtn: HTMLButtonElement;
  private port = 0;
  private src = '';
  private live = true;
  private lastEdit = '';
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;
  private renewTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly ctx: UiContext) {
    this.button = iconButton(ICONS.browser, tr('Prévia ao vivo do site'), () => this.toggle());
    this.button.setAttribute('aria-haspopup', 'dialog');
    this.button.hidden = true;

    this.input = h('input', { class: 'ui-preview__url', type: 'text', attrs: { placeholder: tr('porta ou endereço (ex.: 5173)'), 'aria-label': tr('Porta do site'), autocomplete: 'off', spellcheck: 'false', inputmode: 'url' } });
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') void this.go(portOf(this.input.value));
    });
    this.input.addEventListener('keyup', (e) => e.stopPropagation());
    this.ports = h('div', { class: 'ui-preview__ports' });
    this.projectSel = h('select', { class: 'ui-rename__input ui-preview__project', attrs: { 'aria-label': tr('Projeto') } });
    this.runBtn = h('button', { class: 'ui-btn ui-perm__btn--allow ui-preview__run', type: 'button', text: tr('Rodar o projeto'), attrs: { title: tr('Sobe o servidor de desenvolvimento (npm run dev) da pasta e abre a prévia') }, on: { click: () => void this.runProject() } });
    this.stopBtn = h('button', { class: 'ui-btn ui-preview__stop', type: 'button', text: tr('Parar'), hidden: true, on: { click: () => void this.stopProject() } });
    this.liveBtn = h('button', { class: 'ui-btn ui-preview__tool is-on', type: 'button', text: tr('ao vivo'), attrs: { 'aria-pressed': 'true', title: tr('Recarrega quando um agente altera um arquivo') }, on: { click: () => this.setLive(!this.live) } });
    this.phoneBtn = h('button', { class: 'ui-btn ui-preview__tool', type: 'button', text: tr('celular'), attrs: { 'aria-pressed': 'false', title: tr('Mostra o site numa tela de celular') }, on: { click: () => this.setPhone(!this.stage.classList.contains('is-phone')) } });
    const reload = iconButton('↻', tr('Recarregar'), () => this.reload(), 'ui-icon-btn--sm');
    this.frame = h('iframe', { class: 'ui-preview__frame', attrs: { title: tr('Prévia do site'), sandbox: 'allow-scripts allow-forms allow-popups allow-modals', referrerpolicy: 'no-referrer' } });
    this.note = h('p', { class: 'ui-preview__note', text: tr('Rode o servidor do projeto (npm run dev) e escolha a porta: a prévia aparece aqui e atualiza sozinha.') });
    this.stage = h('div', { class: 'ui-preview__stage' }, this.note, this.frame);
    const close = iconButton(ICONS.close, tr('Fechar'), () => this.hide(), 'ui-icon-btn--sm');
    this.el = h(
      'div',
      { class: 'ui-popover ui-preview', role: 'dialog', tabIndex: -1, attrs: { 'aria-label': tr('Prévia ao vivo'), id: 'ui-preview', popover: 'manual' } },
      h('div', { class: 'ui-popover__head' }, h('h2', { text: tr('Prévia ao vivo') }), close),
      h('div', { class: 'ui-preview__bar' }, reload, this.input, this.liveBtn, this.phoneBtn),
      h('div', { class: 'ui-preview__bar ui-preview__runbar' }, this.projectSel, this.runBtn, this.stopBtn),
      this.ports,
      this.stage,
    );
    // Fica aberta enquanto você conversa (popover manual: clicar na conversa não a fecha); Esc dentro dela fecha.
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hide();
    });
    this.el.addEventListener('toggle', () => {
      const open = this.isOpen;
      this.button.setAttribute('aria-expanded', String(open));
      this.button.classList.toggle('is-on', open);
      if (open) {
        void this.refreshPorts();
        this.fillProjects();
      }
    });
    try {
      const saved = Number(localStorage.getItem(PORT_KEY));
      if (saved) this.input.value = String(saved);
    } catch {
      // sem armazenamento: começa vazio
    }
  }

  get isOpen(): boolean {
    try {
      return this.el.matches(':popover-open');
    } catch {
      return this.el.classList.contains('is-open');
    }
  }

  /** Um agente pediu para mostrar o site: abre a prévia já na porta. */
  openPort(port: number): void {
    this.input.value = String(port);
    if (!this.isOpen) {
      if (typeof this.el.showPopover === 'function') this.el.showPopover();
      else this.el.classList.add('is-open');
    }
    void this.go(port);
  }

  toggle(): void {
    if (this.isOpen) this.hide();
    else {
      if (typeof this.el.showPopover === 'function') this.el.showPopover();
      else this.el.classList.add('is-open');
      if (this.input.value && !this.src) void this.go(portOf(this.input.value));
    }
  }

  hide(): void {
    if (typeof this.el.hidePopover === 'function' && this.isOpen) this.el.hidePopover();
    this.el.classList.remove('is-open');
  }

  render(): void {
    const a = access();
    const store = this.ctx.store;
    setHidden(this.button, !(a.preview || store.mock));
    if (!this.live || !this.src) return;
    // Recarrega quando alguém no escritório termina de editar/gravar um arquivo (o id da última edição muda).
    let last = '';
    let at = 0;
    for (const ag of store.snapshot?.agents ?? []) {
      const act = ag.activity;
      if (act && (act.kind === 'edit' || act.kind === 'write') && act.at > at) {
        at = act.at;
        last = act.id;
      }
    }
    if (last && last !== this.lastEdit) {
      const first = !this.lastEdit;
      this.lastEdit = last;
      if (!first) this.scheduleReload();
    } else if (!this.lastEdit) this.lastEdit = last || '-';
  }

  private setLive(on: boolean): void {
    this.live = on;
    this.liveBtn.classList.toggle('is-on', on);
    this.liveBtn.setAttribute('aria-pressed', String(on));
  }

  private setPhone(on: boolean): void {
    this.stage.classList.toggle('is-phone', on);
    this.phoneBtn.classList.toggle('is-on', on);
    this.phoneBtn.setAttribute('aria-pressed', String(on));
  }

  private scheduleReload(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => this.reload(), RELOAD_DEBOUNCE_MS);
  }

  /** ponytail: volta à página inicial (o iframe é de outra origem, não dá para ler o caminho atual). */
  private reload(): void {
    if (this.src) this.frame.src = this.src;
  }

  /** Projetos = pastas das salas (a raiz /workspace não é projeto); o da sala do agente selecionado vem primeiro. */
  private fillProjects(): void {
    const snap = this.ctx.store.snapshot;
    const rooms = (snap?.rooms ?? []).filter((r) => /^\//.test(r.path ?? '') && r.path.replace(/\/+$/, '') !== '/workspace');
    const keep = this.projectSel.value;
    const cur = this.ctx.selection();
    const sel = cur?.type === 'agent' ? snap?.agents.find((a) => a.id === cur.id)?.roomId : cur?.type === 'room' ? cur.id : undefined;
    this.projectSel.replaceChildren(...rooms.map((r) => h('option', { attrs: { value: r.path }, text: r.name || r.path })));
    const pick = rooms.find((r) => r.path === keep) ?? rooms.find((r) => r.id === sel);
    if (pick) this.projectSel.value = pick.path;
    this.runBtn.disabled = !rooms.length;
  }

  private async runProject(): Promise<void> {
    const folder = this.projectSel.value;
    if (!folder) return;
    this.runBtn.disabled = true;
    this.say(tr('Subindo o servidor do projeto (npm run dev)…'));
    try {
      const r = await post<{ port: number; script: string; reused: boolean }>('/api/preview/run', { folder });
      this.input.value = String(r.port);
      setHidden(this.stopBtn, false);
      await this.go(r.port);
    } catch (err) {
      this.say((err as Error).message);
    } finally {
      this.runBtn.disabled = false;
    }
  }

  private async stopProject(): Promise<void> {
    await post('/api/preview/stop', { folder: this.projectSel.value }).catch(() => undefined);
    setHidden(this.stopBtn, true);
    this.say(tr('Servidor do projeto parado.'));
  }

  private async refreshPorts(): Promise<void> {
    try {
      const r = await fetch('/api/preview/ports', { cache: 'no-store' });
      const list = ((await r.json()) as { ports?: number[] }).ports ?? [];
      this.ports.replaceChildren(
        ...list.map((p) => h('button', { class: `ui-btn ui-preview__port${p === this.port ? ' is-on' : ''}`, type: 'button', text: `:${p}`, on: { click: () => { this.input.value = String(p); void this.go(p); } } })),
      );
      if (!list.length && !this.src) setText(this.note, tr('Nenhum servidor de desenvolvimento encontrado nas portas comuns. Digite a porta acima.'));
    } catch {
      // sem a lista (demo ou servidor antigo): a porta digitada continua valendo
    }
  }

  private async go(port: number | undefined): Promise<void> {
    if (!port) {
      this.say(tr('Porta inválida: use um número de 1024 a 65535.'));
      return;
    }
    try {
      const { url } = await post<{ url: string }>('/api/preview', { port });
      this.port = port;
      this.src = url;
      this.frame.src = url;
      this.stage.classList.add('has-frame');
      try {
        localStorage.setItem(PORT_KEY, String(port));
      } catch {
        // tudo bem: a porta só não fica lembrada
      }
      if (this.renewTimer) clearTimeout(this.renewTimer);
      this.renewTimer = setTimeout(() => void this.go(this.port), RENEW_MS);
      void this.refreshPorts();
    } catch (err) {
      this.say((err as Error).message);
    }
  }

  private say(text: string): void {
    this.stage.classList.remove('has-frame');
    setText(this.note, text);
  }
}
