// Página "Plugins" do modo Painel: os plugins do Claude Code instalados e os para descobrir, com busca, e os
// marketplaces de onde eles vêm (acrescentar pelo dono/repositório do GitHub). Conversa com /api/plugins.
import { access } from '../net/access';
import { tr } from '../../../shared/i18n';
import { h } from './dom';

interface Plugin { id: string; name: string; description: string; marketplace: string; version?: string; installed: boolean }

export class PluginsPage {
  private list: Plugin[] | null = null;
  private markets: { name: string; source: string }[] = [];
  private tab: 'installed' | 'discover' = 'installed';
  private q = '';
  private busy = '';
  private msg = '';
  private err = '';
  private loaded = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private invalidate: () => void, private header: (title: string, sub: string, ...right: (HTMLElement | null)[]) => HTMLElement) {}

  key(): string {
    return `${this.tab}|${this.q}|${this.busy}|${this.msg}|${this.err}|${this.list?.map((p) => p.id + p.installed).join(',') ?? '-'}|${this.markets.length}`;
  }

  active(on: boolean): void {
    if (on && !this.loaded) void this.load();
  }

  private async call(method: string, url: string, body?: unknown): Promise<unknown> {
    const r = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j as { error?: string }).error || tr('Não deu certo.'));
    return j;
  }

  private async load(): Promise<void> {
    this.loaded = true;
    try {
      const [p, m] = await Promise.all([
        this.call('GET', `/api/plugins?q=${encodeURIComponent(this.q)}`) as Promise<{ plugins: Plugin[] }>,
        this.call('GET', '/api/plugins/marketplaces') as Promise<{ marketplaces: { name: string; source: string }[] }>,
      ]);
      this.list = p.plugins;
      this.markets = m.marketplaces;
      this.err = '';
    } catch (e) {
      this.err = (e as Error).message;
      this.list ??= [];
    }
    this.invalidate();
  }

  private run(label: string, fn: () => Promise<unknown>, done: string): void {
    this.busy = label;
    this.msg = '';
    this.err = '';
    this.invalidate();
    fn().then(() => (this.msg = done), (e: Error) => (this.err = e.message)).finally(() => {
      this.busy = '';
      void this.load();
    });
  }

  page(): HTMLElement {
    const sub = tr('Habilidades, comandos e ganchos extras para os agentes do Claude Code. Valem para todas as contas.');
    if (!(access().admin || (access().local && !access().remote))) {
      return h('div', { class: 'dash-page' }, this.header(tr('Plugins'), sub), h('section', { class: 'dash-card dash-empty' }, h('h2', { text: tr('Só para admins') }), h('p', { text: tr('Peça a um admin para instalar plugins.') })));
    }
    const head = this.header(tr('Plugins'), sub);
    if (!this.list) return h('div', { class: 'dash-page' }, head, h('section', { class: 'dash-card dash-empty' }, h('p', { text: this.err || tr('Lendo o catálogo de plugins…') })));
    const installed = this.list.filter((p) => p.installed);
    const shown = this.tab === 'installed' ? installed : this.list.filter((p) => !p.installed);
    const search = h('input', { class: 'dash-plug-search', attrs: { type: 'search', placeholder: tr('Buscar plugins (ex.: revisão, testes, github)'), 'aria-label': tr('Buscar') } });
    search.value = this.q;
    search.addEventListener('input', () => {
      this.q = search.value;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.load(), 350);
    });
    const tab = (id: 'installed' | 'discover', label: string, n?: number) => h('button', { class: `dash-plug-tab${this.tab === id ? ' is-on' : ''}`, type: 'button', on: { click: () => { this.tab = id; this.invalidate(); } } }, h('span', { text: label }), n !== undefined ? h('em', { text: String(n) }) : null);
    const cards = shown.length ? h('div', { class: 'dash-models' }, ...shown.map((p) => h('div', { class: `dash-model${p.installed ? ' is-in' : ''}` },
      h('div', { class: 'dash-model__top' }, h('b', { text: p.name }), p.version ? h('span', { class: 'dash-badge', text: `v${p.version}` }) : null),
      h('p', { text: p.description || tr('Sem descrição.') }),
      h('div', { class: 'dash-model__foot' },
        h('small', { class: 'dash-muted', text: p.marketplace }),
        p.installed
          ? h('button', { class: 'dash-btn dash-btn--ghost-bad', type: 'button', attrs: { disabled: !!this.busy }, text: this.busy === p.id ? tr('Removendo…') : tr('Remover'), on: { click: () => this.run(p.id, () => this.call('POST', '/api/plugins/uninstall', { id: p.id }), tr('{0} removido. Sessões novas já vêm sem ele.', [p.name])) } })
          : h('button', { class: 'dash-btn dash-btn--primary', type: 'button', attrs: { disabled: !!this.busy }, text: this.busy === p.id ? tr('Instalando…') : tr('Instalar'), on: { click: () => this.run(p.id, () => this.call('POST', '/api/plugins/install', { id: p.id }), tr('{0} instalado. Sessões novas já vêm com ele.', [p.name])) } }))))) :
      h('p', { class: 'dash-muted', text: this.tab === 'installed' ? tr('Nenhum plugin instalado ainda. Veja em Descobrir.') : this.q ? tr('Nada encontrado para "{0}".', [this.q]) : tr('Nenhum plugin novo nos marketplaces. Acrescente um marketplace abaixo.') });

    const form = h('form', { class: 'dash-plug-add', on: { submit: (e) => {
      e.preventDefault();
      const src = String(new FormData(form).get('source') ?? '').trim();
      if (src) this.run('market', () => this.call('POST', '/api/plugins/marketplaces', { source: src }), tr('Marketplace acrescentado. Os plugins dele aparecem em Descobrir.'));
    } } },
      h('input', { attrs: { name: 'source', placeholder: tr('dono/repositório do GitHub (ex.: obra/superpowers-marketplace)'), autocomplete: 'off', required: true } }),
      h('button', { class: 'dash-btn dash-btn--primary', type: 'submit', attrs: { disabled: !!this.busy }, text: this.busy === 'market' ? tr('Acrescentando…') : tr('Acrescentar') }));

    return h('div', { class: 'dash-page' }, head,
      this.err ? h('p', { class: 'dash-bad', text: this.err }) : null,
      this.msg ? h('p', { class: 'dash-ok', text: this.msg }) : null,
      h('section', { class: 'dash-card' },
        h('div', { class: 'dash-plug-bar' }, h('div', { class: 'dash-plug-tabs' }, tab('installed', tr('Instalados'), installed.length), tab('discover', tr('Descobrir'))), search),
        cards),
      h('section', { class: 'dash-card' }, h('h2', { text: tr('Marketplaces') }),
        h('p', { class: 'dash-muted dash-plug-hint', text: tr('Os plugins vêm de marketplaces (repositórios no GitHub). Não achou um plugin? Acrescente o marketplace dele.') }),
        h('div', { class: 'dash-list' }, ...this.markets.map((m) => h('div', { class: 'dash-agent dash-agent--static' },
          h('span', { class: 'dash-agent__main' }, h('b', { text: m.name }), h('span', { class: 'dash-agent__act', text: m.source })),
          /^(claude-plugins-official|habblaud|anthropic-plugin-directory)$/.test(m.name) ? null : h('button', { class: 'dash-btn dash-btn--ghost-bad', type: 'button', attrs: { disabled: !!this.busy }, text: tr('Remover'), on: { click: () => confirm(tr('Remover o marketplace {0}? Os plugins instalados dele continuam.', [m.name])) && this.run(m.name, () => this.call('DELETE', `/api/plugins/marketplaces/${encodeURIComponent(m.name)}`), tr('Marketplace removido.')) } })))),
        form));
  }
}
