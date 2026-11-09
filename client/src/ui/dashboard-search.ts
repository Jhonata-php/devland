// Busca do modo Painel (⌘K / Ctrl+K): acha página, agente, projeto ou ação e vai direto. Setas escolhem, Enter abre,
// Esc fecha.
import { tr } from '../../../shared/i18n';
import { h } from './dom';
import { normalizeSearch } from './format';

export interface SearchItem { group: string; label: string; hint?: string; run: () => void }

export class SearchPalette {
  readonly el: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly list: HTMLElement;
  private items: SearchItem[] = [];
  private shown: SearchItem[] = [];
  private index = 0;

  constructor(private source: () => SearchItem[]) {
    this.input = h('input', { attrs: { type: 'search', placeholder: tr('Buscar agente, projeto, página ou ação…'), 'aria-label': tr('Buscar'), autocomplete: 'off', spellcheck: 'false' } });
    this.list = h('div', { class: 'dash-search__list', role: 'listbox' });
    this.el = h('div', { class: 'dash-search', hidden: true, on: { click: (e) => e.target === this.el && this.close() } },
      h('div', { class: 'dash-search__box', role: 'dialog', attrs: { 'aria-label': tr('Buscar') } }, h('div', { class: 'dash-search__field' }, this.input, h('kbd', { text: 'Esc' })), this.list));
    this.input.addEventListener('input', () => this.filter());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.index = (this.index + (e.key === 'ArrowDown' ? 1 : -1) + this.shown.length) % Math.max(1, this.shown.length);
        this.draw();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.pick(this.shown[this.index]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(): void {
    this.items = this.source();
    this.el.hidden = false;
    this.input.value = '';
    this.filter();
    requestAnimationFrame(() => this.input.focus());
  }

  close(): void {
    this.el.hidden = true;
  }

  private pick(item: SearchItem | undefined): void {
    if (!item) return;
    this.close();
    item.run();
  }

  private filter(): void {
    const q = normalizeSearch(this.input.value.trim());
    this.shown = (q ? this.items.filter((i) => normalizeSearch(`${i.label} ${i.hint ?? ''} ${i.group}`).includes(q)) : this.items).slice(0, 40);
    this.index = 0;
    this.draw();
  }

  private draw(): void {
    if (!this.shown.length) {
      this.list.replaceChildren(h('p', { class: 'dash-search__empty', text: tr('Nada encontrado.') }));
      return;
    }
    let group = '';
    const out: HTMLElement[] = [];
    this.shown.forEach((item, i) => {
      if (item.group !== group) out.push(h('div', { class: 'dash-search__group', text: (group = item.group) }));
      const row = h('button', { class: `dash-search__item${i === this.index ? ' is-on' : ''}`, type: 'button', role: 'option', attrs: { 'aria-selected': i === this.index ? 'true' : 'false' }, on: { click: () => this.pick(item), mousemove: () => { if (this.index !== i) { this.index = i; this.draw(); } } } },
        h('span', { text: item.label }), item.hint ? h('small', { text: item.hint }) : null);
      out.push(row);
    });
    this.list.replaceChildren(...out);
    this.list.querySelector('.is-on')?.scrollIntoView?.({ block: 'nearest' });
  }
}
