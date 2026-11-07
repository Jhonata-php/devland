// Celular (até 600 px): barra de navegação fixa embaixo, com o que mais se usa com o polegar: Escritório (volta ao mapa),
// Agentes (painel lateral, com o número de quem precisa de você), Novo agente e Configurações. No computador fica
// escondida por CSS (a barra do topo tem tudo).
import { tr } from '../../../shared/i18n';
import { access } from '../net/access';
import { openAccounts } from './accounts';
import type { UiComponent, UiContext } from './context';
import { h, setHidden, setText } from './dom';
import { ICONS } from './icons';
import { computeCounters } from './model';

interface Item {
  el: HTMLButtonElement;
  badge?: HTMLElement;
}

export class BottomNav implements UiComponent {
  readonly el: HTMLElement;
  private readonly office: Item;
  private readonly agents: Item;
  private readonly accounts: Item;
  private readonly spawn: Item;
  private readonly settings: Item;

  constructor(
    private ctx: UiContext,
    openSpawn: () => void,
    private chats: { toggle(): void; readonly isOpen: boolean; close(): void },
  ) {
    const item = (icon: string, label: string, onClick: () => void, badge = false): Item => {
      const ic = h('span', { class: 'ui-bnav__icon', attrs: { 'aria-hidden': 'true' } });
      ic.innerHTML = icon;
      const b = badge ? h('span', { class: 'ui-bnav__badge', hidden: true }) : undefined;
      const el = h('button', { class: 'ui-bnav__item', type: 'button', on: { click: onClick } }, ic, h('span', { class: 'ui-bnav__label', text: label }), ...(b ? [b] : []));
      return { el: el as HTMLButtonElement, badge: b };
    };
    this.office = item(ICONS.office, tr('Escritório'), () => this.showOffice());
    this.agents = item(ICONS.feed, tr('Conversas'), () => this.openChats(), true);
    this.accounts = item(ICONS.lock, tr('Contas'), () => openAccounts(ctx.root));
    this.spawn = item(ICONS.newAgent, tr('Novo'), openSpawn);
    this.settings = item(ICONS.settings, tr('Ajustes'), () => ctx.toggleSettings());
    this.el = h('nav', { class: 'ui-bnav', attrs: { 'aria-label': tr('Navegação') } }, this.office.el, this.agents.el, this.accounts.el, this.spawn.el, this.settings.el);
  }

  private openChats(): void {
    this.ctx.togglePanel('sidebar', false);
    this.chats.toggle();
  }

  /** Volta ao mapa: fecha as conversas e o painel lateral e solta a seleção (a gaveta do agente fecha junto). */
  private showOffice(): void {
    this.chats.close();
    this.ctx.togglePanel('sidebar', false);
    if (this.ctx.selection()) this.ctx.select(null);
  }

  render(): void {
    const chats = this.chats.isOpen;
    // Ajustes (ou outra janela por cima) aberto: só ele fica aceso.
    const pop = this.ctx.root.classList.contains('has-popover');
    this.office.el.classList.toggle('is-active', !chats && !this.ctx.selection() && !pop);
    this.agents.el.classList.toggle('is-active', chats && !pop);
    this.settings.el.classList.toggle('is-active', pop);
    this.agents.el.setAttribute('aria-pressed', String(chats));
    // Habblaud Cloud: a aba Contas só existe na instalação em nuvem (as contas são da instalação).
    setHidden(this.accounts.el, !access().cloud);
    this.el.classList.toggle('has-accounts', !!access().cloud);
    const waiting = computeCounters(this.ctx.store.liveSnapshot).waiting;
    if (this.agents.badge) {
      setHidden(this.agents.badge, waiting === 0);
      setText(this.agents.badge, waiting > 9 ? '9+' : String(waiting));
    }
  }
}
