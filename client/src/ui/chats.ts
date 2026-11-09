// Conversas (celular): os agentes como uma lista de conversas, como num app de mensagens. Tocar em uma abre o histórico
// em balões (o que você pediu à direita, o que o agente respondeu à esquerda, avisos no meio, ferramentas em linhas
// discretas) com a caixa de resposta embaixo. Usa o mesmo stream do terminal do agente (GET /api/agents/:id/terminal) e a
// mesma caixa de mensagem (ui/composer.ts), então não precisa abrir gaveta nem terminal.
import { ROLES } from '../../../shared/roles';
import { funcChip, roleLabel, roleOf } from './roles';
import type { AgentInfo, TerminalEntry } from '../../../shared/types';
import { tr } from '../../../shared/i18n';
import type { UiComponent, UiContext } from './context';
import { PermissionCard } from './permission';
import { MessageComposer } from './composer';
import { ChatTools, type ChatToolsHooks } from './chat-tools';
import { createAvatar } from './avatar';
import { h, setHidden, setText } from './dom';
import { relativeTime } from './format';
import { renderMarkdown } from './markdown';
import { activityFallback, isPresent, statusLabel } from './model';
import { parseAppend, parseInit, terminalUrl } from './terminal';

/** EventSource.CLOSED (como no terminal). */
const ES_CLOSED = 2;
/** Agente recém-criado: tenta abrir a conversa de novo a cada 2 s por até 30 s. */
const RETRIES = 15;
const RETRY_MS = 2_000;
const MAX_ENTRIES = 400;

/**
 * Sessão que acabou sem fazer nada (nenhuma ferramenta, nenhum título, parada ou encerrada): sobra de agente automático ou de
 * reimplantação, que só poluía a lista.
 */
const isEmptySession = (a: AgentInfo): boolean =>
  !a.title && !!a.stats && a.stats.toolCalls === 0 && (a.status === 'offline' || a.status === 'idle' || a.status === 'done');

/**
 * Conversas principais (não subagentes), a mais recente primeiro. A mesma conversa (conta + sessão) aparece uma vez só: depois
 * de uma reimplantação ela volta num processo novo e o antigo ficava na lista como encerrado. Fica o que está presente e, no
 * empate, o mais recente.
 */
export function chatAgents(agents: readonly AgentInfo[]): AgentInfo[] {
  const best = new Map<string, AgentInfo>();
  for (const a of agents) {
    if (a.kind !== 'main' || isEmptySession(a)) continue;
    const key = a.sessionId ? `${a.account}:${a.sessionId}` : a.id;
    const cur = best.get(key);
    const better = !cur || (isPresent(a) && !isPresent(cur)) || (isPresent(a) === isPresent(cur) && a.lastEventAt > cur.lastEventAt);
    if (better) best.set(key, a);
  }
  return [...best.values()].sort((a, b) => b.lastEventAt - a.lastEventAt);
}

/** O que cada entrada do transcript vira na conversa: balão, aviso ou linha de ferramenta (resultados e raciocínio não). */
export function chatRole(e: TerminalEntry): 'me' | 'agent' | 'note' | 'tool' | null {
  switch (e.kind) {
    case 'user':
      return 'me';
    case 'assistant':
      return e.text.trim() ? 'agent' : null;
    case 'system':
      return 'note';
    case 'tool':
      return 'tool';
    default:
      return null;
  }
}

export class ChatsView implements UiComponent {
  readonly el: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly threadEl: HTMLElement;
  private readonly listBody: HTMLElement;
  private readonly msgs: HTMLElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly note: HTMLElement;
  private readonly composer: MessageComposer;
  private open = false;
  private current: string | null = null;
  private source: EventSource | null = null;
  private entries: TerminalEntry[] = [];
  private seen = new Set<string>();
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stick = true;
  private lastListKey = '';
  private readonly perm: PermissionCard;
  private readonly tools: ChatTools;

  constructor(private ctx: UiContext, hooks: Omit<ChatToolsHooks, 'announce'>) {
    this.tools = new ChatTools({ ...hooks, announce: (t) => ctx.announce(t) });
    this.listBody = h('div', { class: 'ui-chats__list' });
    this.listEl = h(
      'div',
      { class: 'ui-chats__screen ui-chats__screen--list' },
      h('div', { class: 'ui-chats__head' }, h('h2', { text: tr('Conversas') }), h('button', { class: 'ui-icon-btn ui-icon-btn--sm', type: 'button', text: '✕', attrs: { 'aria-label': tr('Fechar') }, on: { click: () => this.close() } })),
      this.listBody,
    );
    this.title = h('strong', { class: 'ui-chats__title' });
    this.sub = h('span', { class: 'ui-chats__sub' });
    this.msgs = h('div', { class: 'ui-chats__msgs', attrs: { role: 'log', 'aria-live': 'polite' } });
    this.msgs.addEventListener('scroll', () => {
      this.stick = this.msgs.scrollHeight - this.msgs.scrollTop - this.msgs.clientHeight < 80;
    });
    this.note = h('p', { class: 'ui-chats__note', hidden: true });
    this.composer = new MessageComposer(ctx, 'terminal');
    // Pedido de permissão (ou pergunta) do agente: aprovar ou negar sem sair da conversa.
    this.perm = new PermissionCard(ctx);
    this.perm.el.classList.add('ui-chats__perm');
    this.threadEl = h(
      'div',
      { class: 'ui-chats__screen ui-chats__screen--thread', hidden: true },
      h(
        'div',
        { class: 'ui-chats__head' },
        h('button', { class: 'ui-icon-btn ui-icon-btn--sm', type: 'button', text: '←', attrs: { 'aria-label': tr('Voltar às conversas') }, on: { click: () => this.showList() } }),
        h('div', { class: 'ui-chats__who' }, this.title, this.sub),
        this.tools.el,
        h('button', { class: 'ui-icon-btn ui-icon-btn--sm', type: 'button', text: '✕', attrs: { 'aria-label': tr('Fechar') }, on: { click: () => this.close() } }),
      ),
      this.msgs,
      this.note,
      this.perm.el,
      h('div', { class: 'ui-chats__composer' }, this.composer.el),
    );
    this.el = h('section', { class: 'ui-chats', hidden: true, attrs: { 'aria-label': tr('Conversas') } }, this.listEl, this.threadEl);
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  show(): void {
    this.open = true;
    setHidden(this.el, false);
    this.showList();
    this.ctx.invalidate();
  }

  close(): void {
    this.open = false;
    this.disconnect();
    this.current = null;
    setHidden(this.el, true);
    this.ctx.invalidate();
  }

  private showList(): void {
    this.disconnect();
    this.current = null;
    this.lastListKey = '';
    setHidden(this.listEl, false);
    setHidden(this.threadEl, true);
    this.render();
  }

  openChat(agentId: string): void {
    this.open = true;
    setHidden(this.el, false);
    setHidden(this.listEl, true);
    setHidden(this.threadEl, false);
    this.current = agentId;
    this.entries = [];
    this.seen.clear();
    this.msgs.replaceChildren();
    this.stick = true;
    this.connect(false);
    this.render();
  }

  private connect(auto: boolean): void {
    this.disconnect();
    const id = this.current;
    if (!id) return;
    if (!auto) this.retries = 0;
    setHidden(this.note, false);
    setText(this.note, tr('Abrindo a conversa…'));
    let es: EventSource;
    try {
      es = new EventSource(terminalUrl(id));
    } catch {
      setText(this.note, tr('Não foi possível abrir a conversa.'));
      return;
    }
    this.source = es;
    es.addEventListener('init', (ev) => {
      if (this.source !== es) return;
      const init = parseInit((ev as MessageEvent).data);
      if (!init) return;
      this.entries = [];
      this.seen.clear();
      this.msgs.replaceChildren();
      this.add(init.entries);
      // Sem nenhuma mensagem gravada: avisa em vez de deixar a tela em branco.
      setHidden(this.note, init.entries.length > 0);
      if (!init.entries.length) setText(this.note, tr('Esta conversa ainda não tem mensagens gravadas, ou o agente já foi fechado.'));
      this.scrollEnd(true);
    });
    es.addEventListener('append', (ev) => {
      if (this.source !== es) return;
      this.add(parseAppend((ev as MessageEvent).data));
      this.scrollEnd(false);
    });
    es.addEventListener('error', () => {
      if (this.source !== es) return;
      if (es.readyState !== ES_CLOSED) return; // o navegador tenta reconectar sozinho
      es.close();
      this.source = null;
      if (this.entries.length === 0 && this.retries < RETRIES) {
        this.retries++;
        this.retryTimer = setTimeout(() => this.connect(true), RETRY_MS);
      } else setText(this.note, tr('Esta conversa ainda não tem mensagens gravadas, ou o agente já foi fechado.'));
    });
  }

  private disconnect(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.source?.close();
    this.source = null;
  }

  private add(list: readonly TerminalEntry[]): void {
    const frag = document.createDocumentFragment();
    for (const e of list) {
      if (this.seen.has(e.id)) continue;
      this.seen.add(e.id);
      this.entries.push(e);
      const node = this.bubble(e);
      if (node) frag.append(node);
    }
    this.msgs.append(frag);
    while (this.msgs.childElementCount > MAX_ENTRIES) this.msgs.firstElementChild?.remove();
  }

  private bubble(e: TerminalEntry): HTMLElement | null {
    const role = chatRole(e);
    if (!role) return null;
    if (role === 'tool' && e.kind === 'tool') return h('div', { class: 'ui-chats__tool', text: `⚙ ${e.title}` });
    if (role === 'note' && e.kind === 'system') return h('div', { class: 'ui-chats__sys', text: e.text });
    if ((role === 'me' || role === 'agent') && (e.kind === 'user' || e.kind === 'assistant')) {
      // Texto vazio (só ferramentas no turno) deixava uma faixa em branco entre as mensagens.
      if (!e.text.trim()) return null;
      const body = h('div', { class: 'ui-chats__body' });
      if (role === 'agent') body.append(renderMarkdown(e.text));
      else body.textContent = e.text;
      return h('div', { class: `ui-chats__row ui-chats__row--${role}` }, h('div', { class: `ui-chats__bubble ui-chats__bubble--${role}` }, body, h('time', { class: 'ui-chats__time', text: new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })));
    }
    return null;
  }

  private scrollEnd(force: boolean): void {
    if (!force && !this.stick) return;
    requestAnimationFrame(() => {
      this.msgs.scrollTop = this.msgs.scrollHeight;
    });
  }

  render(): void {
    if (!this.open) return;
    const snap = this.ctx.store.liveSnapshot;
    const agents = chatAgents(snap?.agents ?? []);
    if (this.current) {
      const a = agents.find((x) => x.id === this.current);
      setText(this.title, a?.name ?? '…');
      const fr = a && roleOf(a, snap?.rooms);
      setText(this.sub, a ? `${statusLabel(a.status)} · ${snap?.rooms.find((r) => r.id === a.roomId)?.name ?? ''}${fr ? ` · ${ROLES[fr].icon} ${roleLabel(fr)}` : ''}` : tr('saiu do escritório'));
      this.tools.update(a, a ? snap?.rooms.find((r) => r.id === a.roomId)?.path : undefined);
      this.composer.render(a, a?.id ?? this.current);
      // ctx.agent junta ao agente o pedido de permissão em aberto (o snapshot puro não o traz).
      this.perm.render(a ? (this.ctx.agent(a.id) ?? a) : undefined);
      return;
    }
    const now = this.ctx.now();
    // Só refaz a lista quando algo mudou (a tela renderiza várias vezes por segundo e a lista perderia rolagem e toque).
    const key = agents.map((a) => `${a.id}:${a.status}:${a.activity?.id ?? ''}:${a.name}:${roleOf(a, snap?.rooms) ?? ''}`).join('|') + `#${Math.floor(now / 30_000)}`;
    if (key === this.lastListKey && this.listBody.childElementCount > 0) return;
    this.lastListKey = key;
    if (agents.length === 0) {
      this.listBody.replaceChildren(h('p', { class: 'ui-chats__empty', text: tr('Nenhuma conversa ainda. Toque em Novo para começar uma.') }));
      return;
    }
    this.listBody.replaceChildren(
      ...agents.map((a) => {
        const room = snap?.rooms.find((r) => r.id === a.roomId);
        const preview = a.status === 'waiting' ? `✋ ${a.waitingFor ?? ''}` : (a.activity ? `${a.activity.icon} ${a.activity.text}` : activityFallback(a));
        const dot = h('span', { class: `ui-chats__dot is-${a.status}`, attrs: { 'aria-hidden': 'true' } });
        const row = h(
          'button',
          { class: `ui-chats__item${isPresent(a) ? '' : ' is-gone'}`, type: 'button', on: { click: () => this.openChat(a.id) } },
          h('span', { class: 'ui-chats__avatar' }, createAvatar(a, 'md'), dot),
          h('span', { class: 'ui-chats__text' }, h('strong', { text: a.name }), funcChip(roleOf(a, snap?.rooms)), h('span', { class: 'ui-chats__room', text: room?.name ?? '' }), h('span', { class: 'ui-chats__preview', text: preview })),
          h('time', { class: 'ui-chats__when', text: relativeTime(a.lastEventAt, now) }),
        );
        return row;
      }),
    );
  }
}
