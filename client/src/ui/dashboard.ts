// Modo Painel: o DevLand sem o mapa. Uma plataforma limpa (inspirada no Conductor) com visão geral, agentes, contas e
// pessoas. Usa os mesmos dados (snapshot) e as mesmas janelas do modo Escritório: conversa, Novo agente, Configurações,
// Plugins e conectar contas. A troca fica em prefs.view (ui/index.ts liga e desliga).
import { access } from '../net/access';
import type { AccountInfo, AgentInfo } from '../../../shared/types';
import { tr } from '../../../shared/i18n';
import { BRAND } from '../../../shared/brand';
import type { UiComponent, UiContext } from './context';
import { h } from './dom';
import { ICONS } from './icons';
import { createAvatar } from './avatar';
import { clampPercent, formatResetAt, formatTokens, prettyModel, relativeTime, usageLevel } from './format';
import { activityFallback, isPresent, statusLabel } from './model';
import { AiPage } from './dashboard-ai';
import { GithubData } from './dashboard-github';
import { McpPage } from './dashboard-mcp';
import { PermissionCard } from './permission';
import { SearchPalette, type SearchItem } from './dashboard-search';

export type DashPage = 'home' | 'agents' | 'chats' | 'github' | 'accounts' | 'connectors' | 'people' | 'ai';

export interface DashActions {
  openChat(agentId: string): void;
  /** Mostra ou esconde a lista de conversas (na página Conversas ela fica encaixada no conteúdo). */
  showChats(on: boolean): void;
  chatsOpen(): boolean;
  newAgent(): void;
  canSpawn(): boolean;
  openOffice(): void;
  openSettings(): void;
  openPlugins(): void;
  /** Entregas: o que os agentes terminaram (a mesma janela do escritório). */
  openDeliveries(): void;
  /** Sessão nova do Claude Code na pasta (terminal interativo); ausente quando o terminal interativo está desligado. */
  newSessionIn?(path: string): void;
  /** Janelas do Cloud: conectar contas ou permissões detalhadas das pessoas. */
  openCloud(kind: 'contas' | 'usuarios'): void;
}

interface CloudUser { id: string; name: string; email?: string; role: 'admin' | 'user'; createdAt: number; totpEnabled?: boolean }

const PAGES: { id: DashPage; icon: string; label: () => string; short?: () => string; side?: boolean }[] = [
  { id: 'home', icon: ICONS.overview, label: () => tr('Visão geral'), short: () => tr('Início') },
  { id: 'agents', icon: ICONS.newAgent, label: () => tr('Agentes') },
  { id: 'chats', icon: ICONS.feed, label: () => tr('Conversas') },
  { id: 'github', icon: ICONS.browser, label: () => tr('GitHub'), side: true },
  { id: 'accounts', icon: ICONS.lock, label: () => tr('Contas') },
  { id: 'connectors', icon: ICONS.plugin, label: () => tr('Conectores'), side: true },
  { id: 'people', icon: ICONS.hand, label: () => tr('Pessoas'), side: true },
  { id: 'ai', icon: ICONS.terminal, label: () => tr('IA local'), short: () => tr('IA'), side: true },
];
/** Chave do menu recolhido (preferência só deste navegador). */
const COLLAPSE_KEY = 'devland:dash-collapsed';

const LOGO = {
  claude: '<svg viewBox="0 0 24 24" aria-hidden="true"><g stroke="currentColor" stroke-width="2.4" stroke-linecap="round">' +
    [0, 30, 60, 90, 120, 150].map((d) => `<line x1="12" y1="3.5" x2="12" y2="20.5" transform="rotate(${d} 12 12)"/>`).join('') + '</g></svg>',
  codex: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7l5 5-5 5M12 18h7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

/** Ícone em pixel (svg) dentro de um <i>. */
function icon(svg: string): HTMLElement {
  const i = h('i', { attrs: { 'aria-hidden': 'true' } });
  i.innerHTML = svg;
  return i;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';

export class Dashboard implements UiComponent {
  readonly el: HTMLElement;
  private page: DashPage = 'home';
  private readonly main: HTMLElement;
  private readonly nav: HTMLElement;
  private readonly tabs: HTMLElement;
  private lastKey = '';
  private shown: DashPage | null = null;
  private readonly pluginsBtn: HTMLButtonElement;
  private readonly top: HTMLElement;
  private readonly ai: AiPage;
  private readonly gh: GithubData;
  private readonly mcp: McpPage;
  /** Cartões de aprovar/negar da Visão geral, um por agente (guardam o estado do botão entre os redesenhos). */
  private readonly perms = new Map<string, PermissionCard>();
  private readonly search: SearchPalette;
  private readonly ptr: HTMLElement;
  private readonly meEl: HTMLElement;
  private people: { users: CloudUser[]; me: string } | null = null;
  private peopleErr = '';
  private me: { name: string; email: string | null; role: string } | null = null;

  constructor(private ctx: UiContext, private act: DashActions) {
    const collapse = h('button', { class: 'dash-collapse', type: 'button', title: tr('Recolher o menu'), attrs: { 'aria-label': tr('Recolher o menu') }, on: { click: () => this.setCollapsed(!this.el.classList.contains('is-collapsed')) } }, icon(ICONS.sidebar));
    const brand = h('div', { class: 'dash-brand' },
      h('img', { attrs: { src: '/assets/brand/logo-mark.png', srcset: '/assets/brand/logo-mark@4x.png 4x', alt: '', width: 30, height: 30 } }),
      h('span', { text: BRAND }), collapse);
    this.nav = h('nav', { class: 'dash-nav', attrs: { 'aria-label': tr('Seções') } });
    this.pluginsBtn = this.toolBtn(ICONS.plugin, tr('Plugins'), () => act.openPlugins());
    this.meEl = h('div', { class: 'dash-me', hidden: true });
    const tools = h('div', { class: 'dash-tools' }, this.pluginsBtn, this.toolBtn(ICONS.settings, tr('Configurações'), () => act.openSettings()));
    this.top = h('header', { class: 'dash-top' });
    this.gh = new GithubData(() => ctx.invalidate());
    this.mcp = new McpPage(() => ctx.invalidate(), (t, sub) => this.header(t, sub));
    this.ai = new AiPage(() => ctx.invalidate(), (t, sub) => this.header(t, sub));
    this.main = h('main', { class: 'dash-main' });
    this.ptr = h('div', { class: 'dash-ptr', text: tr('Solte para atualizar') });
    this.tabs = h('nav', { class: 'dash-tabs', attrs: { 'aria-label': tr('Seções') } });
    this.el = h('div', { class: 'dash', hidden: true },
      h('aside', { class: 'dash-side' }, brand, this.nav, h('div', { class: 'dash-grow' }), tools, this.meEl),
      h('div', { class: 'dash-body' }, this.top, this.ptr, this.main), this.tabs);
    this.search = new SearchPalette(() => this.searchItems());
    this.el.append(this.search.el);
    addEventListener('keydown', (e) => {
      if (this.el.hidden || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k') return;
      e.preventDefault();
      if (this.search.isOpen) this.search.close();
      else this.search.open();
    });
    this.pullToRefresh();
    try {
      if (localStorage.getItem(COLLAPSE_KEY) === '1') this.setCollapsed(true);
    } catch { /* sem armazenamento: menu aberto */ }
  }

  /** O que a busca (⌘K) encontra: páginas, agentes, projetos e ações. */
  private searchItems(): SearchItem[] {
    const snap = this.ctx.store.snapshot;
    const pages = PAGES.map((p) => ({ group: tr('Páginas'), label: p.label(), run: () => this.go(p.id) }));
    const agents = this.agents().map((a) => ({ group: tr('Agentes'), label: a.name, hint: `${snap?.rooms.find((r) => r.id === a.roomId)?.name ?? ''} · ${statusLabel(a.status)}`, run: () => this.openChat(a.id) }));
    const projects = (this.gh.data?.projects ?? []).map((p) => ({ group: tr('Projetos'), label: p.name, hint: p.branch, run: () => this.go('github') }));
    const actions: SearchItem[] = [
      ...(this.act.canSpawn() ? [{ group: tr('Ações'), label: tr('Novo agente'), run: () => this.act.newAgent() }] : []),
      { group: tr('Ações'), label: tr('Entregas'), run: () => this.act.openDeliveries() },
      { group: tr('Ações'), label: tr('Escritório'), hint: tr('mapa em pixel art'), run: () => this.act.openOffice() },
      { group: tr('Ações'), label: tr('Configurações'), run: () => this.act.openSettings() },
    ];
    return [...agents, ...projects, ...pages, ...actions];
  }

  /** Celular: puxar a página para baixo no topo atualiza os números (projetos, gráficos, IA). */
  private pullToRefresh(): void {
    let startY = -1;
    let pulled = 0;
    const hint = this.ptr;
    this.main.addEventListener('touchstart', (e) => {
      startY = this.main.scrollTop <= 0 ? e.touches[0]!.clientY : -1;
      pulled = 0;
    }, { passive: true });
    this.main.addEventListener('touchmove', (e) => {
      if (startY < 0) return;
      pulled = Math.max(0, e.touches[0]!.clientY - startY);
      hint.style.setProperty('--pull', `${Math.min(pulled, 90)}px`);
      hint.classList.toggle('is-ready', pulled > 70);
    }, { passive: true });
    this.main.addEventListener('touchend', () => {
      if (startY >= 0 && pulled > 70) {
        void this.gh.load();
        this.lastKey = '';
        this.ctx.invalidate();
      }
      startY = -1;
      hint.style.setProperty('--pull', '0px');
      hint.classList.remove('is-ready');
    });
  }

  private setCollapsed(on: boolean): void {
    this.el.classList.toggle('is-collapsed', on);
    // A janela de conversas encaixada (fora do .dash) também precisa saber a largura do menu.
    document.documentElement.classList.toggle('dash-collapsed', on);
    try {
      localStorage.setItem(COLLAPSE_KEY, on ? '1' : '0');
    } catch { /* só nesta visita */ }
  }

  /** Barra do topo: título da página, quem precisa de você, Conversas, Escritório e Novo agente. */
  private renderTop(): void {
    const agents = this.agents();
    const working = agents.filter((a) => a.status === 'working' || a.status === 'shell').length;
    const waiting = agents.filter((a) => a.status === 'waiting').length;
    const page = PAGES.find((p) => p.id === this.page)!;
    const chats = h('button', { class: `dash-btn${this.page === 'chats' ? ' is-on' : ''}`, type: 'button', on: { click: () => this.go('chats') } }, icon(ICONS.feed), h('span', { class: 'dash-hide-sm', text: tr('Conversas') }), waiting ? h('em', { class: 'dash-count', text: String(waiting) }) : null);
    const find = h('button', { class: 'dash-btn dash-find', type: 'button', title: tr('Buscar (⌘K)'), attrs: { 'aria-label': tr('Buscar') }, on: { click: () => this.search.open() } }, icon(ICONS.search), h('span', { class: 'dash-hide-sm', text: tr('Buscar') }), h('kbd', { class: 'dash-hide-sm', text: '⌘K' }));
    const deliveries = h('button', { class: 'dash-btn', type: 'button', title: tr('Entregas: o que os agentes terminaram'), on: { click: () => this.act.openDeliveries() } }, icon(ICONS.delivery), h('span', { class: 'dash-hide-sm', text: tr('Entregas') }));
    const office = h('button', { class: 'dash-btn', type: 'button', title: tr('Ver os agentes no mapa em pixel art'), on: { click: () => this.act.openOffice() } }, icon(ICONS.office), h('span', { class: 'dash-hide-sm', text: tr('Escritório') }));
    const settings = h('button', { class: 'dash-btn dash-only-sm', type: 'button', attrs: { 'aria-label': tr('Configurações') }, on: { click: () => this.act.openSettings() } }, icon(ICONS.settings));
    this.top.replaceChildren(
      h('img', { class: 'dash-only-sm dash-top__logo', attrs: { src: '/assets/brand/logo-mark.png', srcset: '/assets/brand/logo-mark@4x.png 4x', alt: BRAND, width: 28, height: 28 } }),
      h('div', { class: 'dash-top__title' }, h('b', { text: page.label() }),
        h('span', { class: 'dash-live dash-hide-sm' }, h('i', { class: working ? 'is-on' : '' }), h('span', { text: working ? tr('{0} trabalhando', [working]) : tr('Ninguém trabalhando agora') }))),
      h('div', { class: 'dash-top__act' }, find, chats, deliveries, office, settings, this.newBtn(true)));
  }

  private toolBtn(svg: string, label: string, fn: () => void, cls = ''): HTMLButtonElement {
    return h('button', { class: `dash-tool ${cls}`.trim(), type: 'button', on: { click: fn } }, icon(svg), h('span', { text: label }));
  }

  show(on: boolean): void {
    this.el.hidden = !on;
    this.lastKey = '';
    this.shown = null;
    if (!on && this.page === 'chats') this.go('home');
    this.ai.active(on && this.page === 'ai');
    // Gráficos da Visão geral e página GitHub: lê ao abrir o painel e a cada minuto.
    this.gh.active(on);
    if (on && access().cloud && !this.me) void this.loadMe();
  }

  go(page: DashPage): void {
    if (page !== this.page && (page === 'chats' || this.page === 'chats')) this.act.showChats(page === 'chats');
    this.page = page;
    document.documentElement.classList.toggle('dash-on-chats', page === 'chats');
    this.ai.active(page === 'ai' && !this.el.hidden);
    this.mcp.active(page === 'connectors');
    this.lastKey = '';
    if (page === 'people') void this.loadPeople();
    this.main.scrollTop = 0;
    this.ctx.invalidate();
  }

  render(): void {
    if (this.el.hidden) return;
    const snap = this.ctx.store.snapshot;
    const minute = Math.floor(this.ctx.now() / 30_000);
    // Pessoas não depende do snapshot: redesenhar apagaria o que se digita no convite.
    const key = `${this.page}|${this.page === 'people' ? 0 : snap?.rev ?? -1}|${minute}|${access().admin}|${access().cloud}|${this.people ? this.people.users.length : -1}|${this.peopleErr}|${this.me?.name}|${this.act.chatsOpen()}|${this.ai.key()}|${this.page === 'connectors' ? this.mcp.key() : ''}|${this.page === 'home' || this.page === 'github' ? this.gh.key() : ''}`;
    if (key === this.lastKey) return;
    // Alguém digitando na página (convite, pergunta à IA): não redesenha por baixo dele.
    const focus = document.activeElement;
    if (this.shown === this.page && focus && this.main.contains(focus) && /^(INPUT|TEXTAREA|SELECT)$/.test(focus.tagName)) return;
    this.lastKey = key;
    this.pluginsBtn.hidden = !(access().admin || (access().local && !access().remote));
    this.renderNav();
    this.renderTop();
    const page = this.page === 'agents' ? this.agentsPage() : this.page === 'accounts' ? this.accountsPage() : this.page === 'people' ? this.peoplePage() : this.page === 'chats' ? this.chatsPage() : this.page === 'ai' ? this.ai.page() : this.page === 'connectors' ? this.mcp.page() : this.page === 'github' ? this.gh.page((t, sub, ...r) => this.header(t, sub, ...r), () => this.act.openCloud('contas'), this.act.newSessionIn) : this.homePage();
    // A animação de entrada só na troca de página (não a cada snapshot).
    if (this.page !== this.shown) page.classList.add('is-enter');
    this.shown = this.page;
    this.main.replaceChildren(page);
  }

  private renderNav(): void {
    const waiting = this.agents().filter((a) => a.status === 'waiting').length;
    const make = (cls: string) => PAGES.map((p) => {
      return h('button', { class: `${cls}${p.id === this.page ? ' is-on' : ''}`, type: 'button', title: p.label(), attrs: { 'aria-current': p.id === this.page ? 'page' : undefined }, on: { click: () => this.go(p.id) } },
        icon(p.icon), h('span', { text: cls === 'dash-tab' && p.short ? p.short() : p.label() }), p.id === 'chats' && waiting ? h('em', { text: String(waiting) }) : null);
    });
    // Perfil no pé do menu (só no Cloud, onde há login).
    this.meEl.hidden = !this.me;
    if (this.me) this.meEl.replaceChildren(h('span', { class: 'dash-av', text: initials(this.me.name) }), h('span', { class: 'dash-me__txt' }, h('b', { text: this.me.name }), h('small', { text: this.me.email ?? (this.me.role === 'admin' ? tr('Admin') : tr('Usuário')) })),
      h('button', { class: 'dash-link', type: 'button', text: tr('Sair'), on: { click: () => void this.logout() } }));
    this.nav.replaceChildren(...make('dash-nav__item'));
    // Celular: só as páginas principais nas abas; Pessoas e IA local ficam na página Mais (Visão geral tem os atalhos).
    this.tabs.replaceChildren(...make('dash-tab').filter((_, i) => !PAGES[i]!.side));
  }

  /** Abre a conversa com o agente na página Conversas (encaixada no conteúdo, sem sair do painel). */
  openChat(id: string): void {
    this.go('chats');
    this.act.openChat(id);
  }

  private chatsPage(): HTMLElement {
    // A conversa em si é a janela de conversas do DevLand, encaixada no lugar do conteúdo (dashboard.css).
    if (this.act.chatsOpen()) return h('div', { class: 'dash-page dash-chats-ph' });
    return h('div', { class: 'dash-page' }, this.header(tr('Conversas'), tr('Fale com qualquer agente e aprove pedidos sem sair do painel.')),
      h('section', { class: 'dash-card dash-empty' }, h('h2', { text: tr('Conversas fechadas') }), h('button', { class: 'dash-btn dash-btn--primary', type: 'button', text: tr('Ver conversas'), on: { click: () => this.act.showChats(true) } })));
  }

  /** Só contas conectadas de verdade: com e-mail, números de uso ou sessão aberta (pasta vazia do Codex não conta). */
  private accounts(): AccountInfo[] {
    return (this.ctx.store.snapshot?.accounts ?? []).filter((a) => !!a.email || !!a.usage || a.sessions > 0);
  }

  private agents(): AgentInfo[] {
    return (this.ctx.store.snapshot?.agents ?? []).filter((a) => a.kind === 'main' && isPresent(a));
  }

  private header(title: string, sub: string, ...right: (HTMLElement | null)[]): HTMLElement {
    return h('header', { class: 'dash-head' }, h('div', {}, h('h1', { text: title }), h('p', { text: sub })), h('div', { class: 'dash-head__act' }, ...right));
  }

  private newBtn(compact = false): HTMLElement | null {
    if (!this.act.canSpawn()) return null;
    return h('button', { class: 'dash-btn dash-btn--primary', type: 'button', attrs: { 'aria-label': tr('Novo agente') }, on: { click: () => this.act.newAgent() } }, compact ? h('span', { class: 'dash-only-sm', text: '+' }) : null, h('span', { class: compact ? 'dash-hide-sm' : '', text: tr('+ Novo agente') }));
  }

  // ------------------------------------------------------------------ páginas
  private homePage(): HTMLElement {
    const snap = this.ctx.store.snapshot;
    const agents = this.agents();
    const now = this.ctx.now();
    const working = agents.filter((a) => a.status === 'working' || a.status === 'shell').length;
    const waiting = agents.filter((a) => a.status === 'waiting');
    const tokens = agents.reduce((n, a) => n + a.stats.tokensIn + a.stats.tokensOut, 0);
    const lines = agents.reduce((n, a) => n + (a.stats.linesAdded ?? 0), 0);
    const hour = new Date().getHours();
    const hello = hour < 12 ? tr('Bom dia') : hour < 18 ? tr('Boa tarde') : tr('Boa noite');
    const name = this.me?.name ? `, ${this.me.name.split(' ')[0]}` : '';
    const stat = (label: string, value: string, hint: string, tone = '') => h('div', { class: `dash-stat ${tone}` }, h('span', { text: label }), h('b', { text: value }), h('small', { text: hint }));
    const accounts = this.accounts();
    return h('div', { class: 'dash-page' },
      this.header(`${hello}${name}`, tr('Tudo o que os seus agentes estão fazendo agora.')),
      h('section', { class: 'dash-stats' },
        stat(tr('Trabalhando'), String(working), agents.length === 1 ? tr('1 agente aberto') : tr('{0} agentes abertos', [agents.length]), working ? 'is-live' : ''),
        stat(tr('Precisam de você'), String(waiting.length), waiting.length ? tr('Responda para eles seguirem') : tr('Nada pendente'), waiting.length ? 'is-warn' : ''),
        stat(tr('Tokens das sessões'), formatTokens(tokens), tr('entrada + saída')),
        stat(tr('Linhas escritas'), lines.toLocaleString(), tr('nas sessões abertas'))),
      this.gh.charts(),
      h('section', { class: 'dash-more' },
        h('button', { class: 'dash-btn', type: 'button', on: { click: () => this.go('people') } }, icon(ICONS.hand), h('span', { text: tr('Pessoas') })),
        h('button', { class: 'dash-btn', type: 'button', on: { click: () => this.go('ai') } }, icon(ICONS.terminal), h('span', { text: tr('IA local') })),
        h('button', { class: 'dash-btn', type: 'button', on: { click: () => this.go('github') } }, icon(ICONS.browser), h('span', { text: tr('GitHub') })),
        h('button', { class: 'dash-btn', type: 'button', on: { click: () => this.go('connectors') } }, icon(ICONS.plugin), h('span', { text: tr('Conectores') })),
        this.pluginsBtn.hidden ? null : h('button', { class: 'dash-btn', type: 'button', on: { click: () => this.act.openPlugins() } }, icon(ICONS.plugin), h('span', { text: tr('Plugins') }))),
      this.usageAlert(now),
      waiting.length ? h('section', { class: 'dash-card dash-attn' }, h('h2', { text: tr('Precisam de você') }), h('div', { class: 'dash-list' }, ...waiting.map((a) => this.waitingRow(a, now)))) : null,
      h('div', { class: 'dash-cols' },
        h('section', { class: 'dash-card' }, h('div', { class: 'dash-card__head' }, h('h2', { text: tr('Agentes') }), h('button', { class: 'dash-link', type: 'button', text: tr('Ver todos'), on: { click: () => this.go('agents') } })),
          agents.length ? h('div', { class: 'dash-list' }, ...agents.slice().sort((a, b) => b.lastEventAt - a.lastEventAt).slice(0, 6).map((a) => this.agentRow(a, now))) : this.emptyAgents()),
        h('section', { class: 'dash-card' }, h('div', { class: 'dash-card__head' }, h('h2', { text: tr('Uso das contas') }), h('button', { class: 'dash-link', type: 'button', text: tr('Gerenciar'), on: { click: () => this.go('accounts') } })),
          accounts.length ? h('div', { class: 'dash-usage-list' }, ...accounts.map((a) => this.usageMini(a, now))) : h('p', { class: 'dash-muted', text: tr('Nenhuma conta encontrada ainda.') }))));
  }

  private agentsPage(): HTMLElement {
    const snap = this.ctx.store.snapshot;
    const now = this.ctx.now();
    const agents = this.agents();
    const groups = (snap?.rooms ?? []).map((r) => ({ room: r, list: agents.filter((a) => a.roomId === r.id) })).filter((g) => g.list.length);
    return h('div', { class: 'dash-page' },
      this.header(tr('Agentes'), agents.length === 1 ? tr('1 sessão aberta, agrupada por projeto.') : tr('{0} sessões abertas, agrupadas por projeto.', [agents.length])),
      groups.length ? h('div', { class: 'dash-groups' }, ...groups.map((g) => h('section', { class: 'dash-card' },
        h('div', { class: 'dash-card__head' }, h('h2', {}, h('span', { class: 'dash-folder', text: '▸' }), g.room.name), h('small', { class: 'dash-muted', text: g.room.path })),
        h('div', { class: 'dash-list' }, ...g.list.map((a) => this.agentRow(a, now, true)))))) : h('section', { class: 'dash-card' }, this.emptyAgents()));
  }

  private accountsPage(): HTMLElement {
    const snap = this.ctx.store.snapshot;
    const now = this.ctx.now();
    const accounts = this.accounts();
    const agents = this.agents();
    const connect = access().cloud ? h('button', { class: 'dash-btn dash-btn--primary', type: 'button', text: tr('+ Conectar conta'), on: { click: () => this.act.openCloud('contas') } }) : null;
    return h('div', { class: 'dash-page' },
      this.header(tr('Contas'), tr('Claude e Codex conectados neste DevLand e quanto já usaram do plano.'), connect),
      accounts.length ? h('div', { class: 'dash-grid' }, ...accounts.map((a) => this.accountCard(a, agents.filter((x) => x.account === a.id).length, now)))
        : h('section', { class: 'dash-card dash-empty' }, h('h2', { text: tr('Nenhuma conta ainda') }), h('p', { text: tr('Entre no Claude Code ou no Codex neste computador, ou conecte uma conta pela web.') }), connect));
  }

  private peoplePage(): HTMLElement {
    if (!access().cloud) {
      return h('div', { class: 'dash-page' }, this.header(tr('Pessoas'), tr('Quem pode entrar neste DevLand.')),
        h('section', { class: 'dash-card dash-empty' }, h('h2', { text: tr('Só você por aqui') }), h('p', { text: tr('Convites, papéis e permissões existem na instalação com login (DevLand Cloud). Nesta máquina, quem abre a página pelo computador é o dono.') })));
    }
    if (!access().admin) {
      return h('div', { class: 'dash-page' }, this.header(tr('Pessoas'), tr('Quem pode entrar neste DevLand.')),
        h('section', { class: 'dash-card dash-empty' }, h('h2', { text: tr('Só para admins') }), h('p', { text: tr('Peça a um admin para convidar ou mudar permissões.') })));
    }
    const users = this.people?.users ?? [];
    const form = h('form', { class: 'dash-invite', on: { submit: (e) => { e.preventDefault(); void this.invite(form); } } },
      h('input', { attrs: { name: 'email', type: 'email', required: true, placeholder: tr('e-mail da pessoa'), autocomplete: 'off' } }),
      h('input', { attrs: { name: 'name', type: 'text', placeholder: tr('nome (opcional)'), autocomplete: 'off' } }),
      h('select', { attrs: { name: 'role', 'aria-label': tr('Papel') } }, h('option', { attrs: { value: 'user' }, text: tr('Usuário') }), h('option', { attrs: { value: 'admin' }, text: tr('Admin') })),
      h('button', { class: 'dash-btn dash-btn--primary', type: 'submit', text: tr('Enviar convite') }),
      h('p', { class: `dash-form-msg${this.peopleErr.startsWith('✓') ? ' is-ok' : ''}`, text: this.peopleErr.replace(/^✓ /, '') }));
    return h('div', { class: 'dash-page' },
      this.header(tr('Pessoas'), users.length === 1 ? tr('Só você por enquanto. Convide por e-mail e escolha o papel.') : tr('{0} pessoas com acesso. Convide por e-mail e escolha o papel.', [users.length]),
        h('button', { class: 'dash-btn', type: 'button', text: tr('Permissões detalhadas'), on: { click: () => this.act.openCloud('usuarios') } })),
      h('section', { class: 'dash-card' }, h('h2', { text: tr('Convidar') }), form),
      h('section', { class: 'dash-card dash-table' },
        h('div', { class: 'dash-tr dash-tr--head' }, h('span', { text: tr('Pessoa') }), h('span', { text: tr('Papel') }), h('span', { text: tr('Segurança') }), h('span', { text: tr('Desde') }), h('span')),
        ...users.map((u) => {
          const self = u.id === this.people?.me;
          return h('div', { class: 'dash-tr' },
            h('span', { class: 'dash-person' }, h('span', { class: 'dash-av', text: initials(u.name) }), h('span', {}, h('b', { text: u.name + (self ? ` ${tr('(você)')}` : '') }), h('small', { text: u.email ?? '—' }))),
            h('span', {}, h('span', { class: `dash-badge${u.role === 'admin' ? ' is-admin' : ''}`, text: u.role === 'admin' ? tr('Admin') : tr('Usuário') })),
            h('span', { class: 'dash-muted', text: u.totpEnabled ? tr('2 etapas ligada') : tr('Só senha') }),
            h('span', { class: 'dash-muted', text: new Date(u.createdAt).toLocaleDateString() }),
            h('span', { class: 'dash-row-act' }, self ? null : h('button', { class: 'dash-link dash-link--bad', type: 'button', text: tr('Remover'), on: { click: () => void this.remove(u) } })));
        })));
  }

  // ------------------------------------------------------------------ peças
  private agentRow(a: AgentInfo, now: number, full = false): HTMLElement {
    const acc = this.ctx.account(a.account);
    const st = a.status === 'shell' ? 'working' : a.status;
    return h('button', { class: 'dash-agent', type: 'button', on: { click: () => this.openChat(a.id) } },
      createAvatar(a, 'sm'),
      h('span', { class: 'dash-agent__main' },
        h('span', { class: 'dash-agent__top' }, h('b', { text: a.name }), h('span', { class: `dash-status is-${st}`, text: statusLabel(a.status) })),
        h('span', { class: 'dash-agent__act', text: a.title || a.activity?.text || activityFallback(a) })),
      full ? h('span', { class: 'dash-agent__meta' },
        a.gitBranch ? h('code', { text: a.gitBranch }) : null,
        a.model ? h('span', { text: prettyModel(a.model) }) : null) : null,
      h('span', { class: 'dash-agent__side' },
        acc ? h('span', { class: 'dash-dot', style: `background:${acc.color}`, title: acc.name }) : null,
        h('small', { text: relativeTime(a.lastEventAt, now) })));
  }

  /** Agente esperando: a linha e, quando há pedido de permissão, o cartão para aprovar ou negar ali mesmo. */
  private waitingRow(a: AgentInfo, now: number): HTMLElement {
    const full = this.ctx.agent(a.id) ?? a;
    if (!full.permission) return this.agentRow(a, now);
    let card = this.perms.get(a.id);
    if (!card) {
      card = new PermissionCard(this.ctx);
      card.el.classList.add('dash-perm');
      this.perms.set(a.id, card);
    }
    card.render(full);
    for (const id of this.perms.keys()) if (!this.ctx.agent(id)?.permission) this.perms.delete(id);
    return h('div', { class: 'dash-waiting' }, this.agentRow(a, now), card.el);
  }

  /** Aviso quando uma conta está perto do limite (semana a partir de 80%, 5 horas a partir de 90%). */
  private usageAlert(now: number): HTMLElement | null {
    const hot = this.accounts().filter((a) => (a.usage?.sevenDay?.utilization ?? 0) >= 80 || (a.usage?.fiveHour?.utilization ?? 0) >= 90);
    if (!hot.length) return null;
    return h('section', { class: 'dash-alert' }, h('b', { text: tr('Perto do limite') }),
      h('span', { text: hot.map((a) => {
        const w = a.usage?.sevenDay;
        const f = a.usage?.fiveHour;
        return (w?.utilization ?? 0) >= 80
          ? tr('{0}: {1}% da semana (renova {2})', [a.name, Math.round(w!.utilization), w!.resetsAt ? formatResetAt(w!.resetsAt, now) : '—'])
          : tr('{0}: {1}% das 5 horas (renova {2})', [a.name, Math.round(f!.utilization), f!.resetsAt ? formatResetAt(f!.resetsAt, now) : '—']);
      }).join(' · ') }),
      h('button', { class: 'dash-link', type: 'button', text: tr('Ver contas'), on: { click: () => this.go('accounts') } }));
  }

  private emptyAgents(): HTMLElement {
    return h('div', { class: 'dash-empty' }, h('h2', { text: tr('Nenhum agente aberto') }), h('p', { text: tr('Abra o Claude Code ou o Codex em qualquer pasta, ou comece um agente por aqui.') }), this.newBtn());
  }

  private logo(a: AccountInfo, big = false): HTMLElement {
    const p = a.provider ?? 'claude';
    const el = icon(LOGO[p]);
    el.className = `dash-logo is-${p}${big ? ' is-big' : ''}`;
    return el;
  }

  private bar(label: string, win: { utilization: number; resetsAt?: number } | undefined, now: number): HTMLElement | null {
    if (!win) return null;
    const pct = clampPercent(win.utilization);
    return h('div', { class: `dash-bar is-${usageLevel(pct)}` },
      h('div', { class: 'dash-bar__top' }, h('span', { text: label }), h('b', { text: `${Math.round(pct)}%` })),
      h('div', { class: 'dash-bar__track' }, h('i', { style: `width:${pct}%` })),
      win.resetsAt ? h('small', { text: tr('renova {0}', [formatResetAt(win.resetsAt, now)]) }) : null);
  }

  private usageMini(a: AccountInfo, now: number): HTMLElement {
    const u = a.usage;
    return h('div', { class: 'dash-usage' }, this.logo(a),
      h('div', { class: 'dash-usage__main' }, h('b', { text: a.name }),
        u?.noQuota ? h('small', { class: 'dash-bad', text: tr('Sem cota agora') }) : u ? h('div', { class: 'dash-bars dash-bars--2' }, this.bar(tr('5 horas'), u.fiveHour, now), this.bar(tr('Semana'), u.sevenDay, now)) : h('small', { class: 'dash-muted', text: tr('Uso ainda desconhecido') })));
  }

  private accountCard(a: AccountInfo, open: number, now: number): HTMLElement {
    const u = a.usage;
    return h('section', { class: 'dash-card dash-account' },
      h('div', { class: 'dash-account__head' }, this.logo(a, true),
        h('div', { class: 'dash-account__who' }, h('b', { text: a.name }), h('small', { text: a.email ?? a.organization ?? a.configDir })),
        a.plan ? h('span', { class: 'dash-badge', text: a.plan }) : null),
      u?.noQuota ? h('p', { class: 'dash-bad', text: tr('Sem cota nem créditos para usar agora.') }) : null,
      u ? h('div', { class: 'dash-bars' }, this.bar(tr('Sessão de 5 horas'), u.fiveHour, now), this.bar(tr('Semana'), u.sevenDay, now), this.bar(tr('Semana · Opus'), u.sevenDayOpus, now))
        : h('p', { class: 'dash-muted', text: tr('O uso aparece quando a conta abre uma sessão com o plugin do DevLand.') }),
      h('div', { class: 'dash-account__foot' },
        h('span', { text: open === 1 ? tr('1 sessão aberta') : tr('{0} sessões abertas', [open]) }),
        h('span', { class: 'dash-muted', text: a.usageStatus === 'stale' ? tr('números antigos') : a.usageStatus === 'ok' ? tr('ao vivo') : tr('sem números') })));
  }

  // ------------------------------------------------------------------ Cloud
  private async loadMe(): Promise<void> {
    try {
      const r = await fetch('/api/cloud/me', { credentials: 'same-origin' });
      if (r.ok) this.me = await r.json();
    } catch { /* fora do Cloud */ }
    this.lastKey = '';
    this.ctx.invalidate();
  }

  private async loadPeople(): Promise<void> {
    if (!access().cloud || !access().admin) return;
    try {
      const r = await fetch('/api/cloud/users', { credentials: 'same-origin' });
      if (r.ok) this.people = await r.json();
    } catch { /* tenta de novo ao voltar à página */ }
    this.lastKey = '';
    this.ctx.invalidate();
  }

  private async call(method: string, url: string, body?: unknown): Promise<void> {
    const r = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || tr('Não deu certo.'));
  }

  private async invite(form: HTMLFormElement): Promise<void> {
    const f = new FormData(form);
    const btn = form.querySelector('button')!;
    btn.disabled = true;
    try {
      await this.call('POST', '/api/cloud/invites', { email: f.get('email'), name: f.get('name'), role: f.get('role'), allow: ['permissions'] });
      this.peopleErr = `✓ ${tr('Convite enviado para {0}.', [String(f.get('email'))])}`;
    } catch (err) {
      this.peopleErr = (err as Error).message;
    }
    btn.disabled = false;
    void this.loadPeople();
  }

  private async remove(u: CloudUser): Promise<void> {
    if (!confirm(tr('Remover {0}? As sessões dele caem na hora.', [u.name]))) return;
    try {
      await this.call('DELETE', `/api/cloud/users/${u.id}`);
      this.peopleErr = '';
    } catch (err) {
      this.peopleErr = (err as Error).message;
    }
    void this.loadPeople();
  }

  private async logout(): Promise<void> {
    await fetch('/api/remote/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
    location.replace('/login');
  }
}
