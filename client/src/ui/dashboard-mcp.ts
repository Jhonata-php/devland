// Página "Conectores" do modo Painel: servidores MCP do Claude Code (documentação, navegador, Sentry, Notion...).
// Adiciona em todas as contas do Claude, no escopo do usuário. Conversa com /api/mcp (server/accounts/mcp.ts).
import { access } from '../net/access';
import { tr } from '../../../shared/i18n';
import { h } from './dom';

interface Server { name: string; target: string; status: 'ok' | 'fail' | 'auth' | 'unknown'; detail: string }
interface CatalogItem { name: string; title: string; desc: string; transport: string; target: string }

export class McpPage {
  private servers: Server[] | null = null;
  private catalog: CatalogItem[] = [];
  private err = '';
  private busy = '';
  private loaded = false;

  constructor(private invalidate: () => void, private header: (title: string, sub: string) => HTMLElement) {}

  key(): string {
    return `${this.err}|${this.busy}|${this.servers?.map((s) => s.name + s.status).join(',') ?? '-'}`;
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
      const j = (await this.call('GET', '/api/mcp')) as { servers: Server[]; catalog: CatalogItem[] };
      this.servers = j.servers;
      this.catalog = j.catalog;
      this.err = '';
    } catch (e) {
      this.err = (e as Error).message;
    }
    this.invalidate();
  }

  private act(label: string, fn: () => Promise<unknown>): void {
    this.busy = label;
    this.err = '';
    this.invalidate();
    fn().then(() => this.load(), (e: Error) => (this.err = e.message)).finally(() => {
      this.busy = '';
      this.invalidate();
    });
  }

  page(): HTMLElement {
    const head = this.header(tr('Conectores'), tr('Servidores MCP: dão aos agentes acesso a documentação, navegador, erros de produção, tarefas e mais.'));
    if (!(access().admin || (access().local && !access().remote))) {
      return h('div', { class: 'dash-page' }, head, h('section', { class: 'dash-card dash-empty' }, h('h2', { text: tr('Só para admins') }), h('p', { text: tr('Peça a um admin para adicionar conectores.') })));
    }
    if (!this.servers) return h('div', { class: 'dash-page' }, head, h('section', { class: 'dash-card dash-empty' }, h('p', { text: this.err || tr('Lendo os conectores…') })));
    const have = new Map(this.servers.map((s) => [s.name, s]));
    const pill = (s: Server) => h('span', { class: `dash-status ${s.status === 'ok' ? 'is-working' : s.status === 'auth' ? 'is-waiting' : s.status === 'fail' ? 'is-bad' : ''}`, text: s.status === 'ok' ? tr('Conectado') : s.status === 'auth' ? tr('Precisa entrar') : s.status === 'fail' ? tr('Falhou') : s.detail || '—' });
    const remove = (name: string) => h('button', { class: 'dash-link dash-link--bad', type: 'button', text: tr('Remover'), on: { click: () => confirm(tr('Remover o conector {0} de todas as contas?', [name])) && this.act(name, () => this.call('DELETE', `/api/mcp/${encodeURIComponent(name)}`)) } });

    const catalog = h('div', { class: 'dash-models' }, ...this.catalog.map((c) => {
      const s = have.get(c.name);
      return h('div', { class: `dash-model${s ? ' is-in' : ''}` },
        h('div', { class: 'dash-model__top' }, h('b', { text: c.title }), h('span', { class: 'dash-badge', text: c.transport === 'stdio' ? tr('comando') : c.transport.toUpperCase() })),
        h('p', { text: c.desc }),
        h('div', { class: 'dash-model__foot' },
          s ? pill(s) : h('small', { class: 'dash-muted', text: c.target }),
          s ? remove(c.name) : h('button', { class: 'dash-btn', type: 'button', attrs: { disabled: !!this.busy }, text: this.busy === c.name ? tr('Adicionando…') : tr('Adicionar'), on: { click: () => this.act(c.name, () => this.call('POST', '/api/mcp', { name: c.name, transport: c.transport, target: c.target })) } })));
    }));

    const mine = this.servers.length ? h('div', { class: 'dash-list' }, ...this.servers.map((s) => h('div', { class: 'dash-agent dash-agent--static' },
      h('span', { class: 'dash-agent__main' }, h('span', { class: 'dash-agent__top' }, h('b', { text: s.name }), pill(s)), h('span', { class: 'dash-agent__act', text: s.target })),
      remove(s.name)))) : h('p', { class: 'dash-muted', text: tr('Nenhum conector ainda. Comece por um dos sugeridos abaixo.') });

    const form = h('form', { class: 'dash-invite dash-mcp-form', on: { submit: (e) => {
      e.preventDefault();
      const f = new FormData(form);
      this.act(String(f.get('name')), () => this.call('POST', '/api/mcp', { name: f.get('name'), transport: f.get('transport'), target: f.get('target') }));
    } } },
      h('input', { attrs: { name: 'name', required: true, placeholder: tr('nome (ex.: meu-servidor)'), autocomplete: 'off' } }),
      h('input', { attrs: { name: 'target', required: true, placeholder: tr('https://… ou o comando (ex.: npx meu-mcp)'), autocomplete: 'off' } }),
      h('select', { attrs: { name: 'transport', 'aria-label': tr('Tipo') } }, h('option', { attrs: { value: 'http' }, text: 'HTTP' }), h('option', { attrs: { value: 'sse' }, text: 'SSE' }), h('option', { attrs: { value: 'stdio' }, text: tr('Comando') })),
      h('button', { class: 'dash-btn dash-btn--primary', type: 'submit', attrs: { disabled: !!this.busy }, text: tr('Adicionar') }));

    return h('div', { class: 'dash-page' }, head,
      this.err ? h('p', { class: 'dash-bad', text: this.err }) : null,
      h('section', { class: 'dash-card' }, h('div', { class: 'dash-card__head' }, h('h2', { text: tr('Seus conectores') }), h('button', { class: 'dash-link', type: 'button', text: tr('Atualizar'), on: { click: () => void this.load() } })), mine,
        this.servers.some((s) => s.status === 'auth') ? h('p', { class: 'dash-muted dash-note', text: tr('"Precisa entrar": abra uma conversa com um agente e peça para rodar /mcp, ou entre pelo terminal do Claude Code; o login fica salvo na conta.') }) : null),
      h('section', { class: 'dash-card' }, h('h2', { text: tr('Sugeridos') }), catalog),
      h('section', { class: 'dash-card' }, h('h2', { text: tr('Adicionar outro') }), form,
        h('p', { class: 'dash-muted dash-note', text: tr('Vale para todas as contas do Claude neste servidor e para qualquer projeto. Conectores por comando rodam no servidor: adicione só os que você confia.') })));
  }
}
