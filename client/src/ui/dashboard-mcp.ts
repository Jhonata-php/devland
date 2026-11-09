// Página "Conectores" do modo Painel: servidores MCP do Claude Code (documentação, navegador, Sentry, Notion...).
// Adiciona em todas as contas do Claude, no escopo do usuário. Conversa com /api/mcp (server/accounts/mcp.ts).
import { access } from '../net/access';
import { tr } from '../../../shared/i18n';
import { h } from './dom';
import { parseConnector, type ParsedConnector } from './mcp-parse';

interface Server { name: string; target: string; status: 'ok' | 'fail' | 'auth' | 'unknown'; detail: string }
interface CatalogItem { name: string; title: string; desc: string; transport: string; target: string }

export class McpPage {
  private servers: Server[] | null = null;
  private catalog: CatalogItem[] = [];
  private err = '';
  private busy = '';
  private loaded = false;
  /** Conversa para adicionar: o que a pessoa colou e o que o DevLand entendeu. */
  private talk: { me: string; found: ParsedConnector[]; added: Set<string>; errors: Map<string, string> }[] = [];
  private draft = '';

  constructor(private invalidate: () => void, private header: (title: string, sub: string, ...right: (HTMLElement | null)[]) => HTMLElement) {}

  key(): string {
    return `${this.err}|${this.busy}|${this.servers?.map((s) => s.name + s.status).join(',') ?? '-'}|${this.talk.length}|${this.talk.map((t) => t.added.size + t.errors.size).join(',')}|${this.open}`;
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

  /** Janela "Adicionar conector" aberta. */
  private open = false;

  /** Adiciona os conectores entendidos na mensagem, um por um, e relê a lista para mostrar se conectou. */
  private async addAll(t: { found: ParsedConnector[]; added: Set<string>; errors: Map<string, string> }): Promise<void> {
    for (const f of t.found) {
      this.busy = f.name;
      this.invalidate();
      try {
        await this.call('POST', '/api/mcp', f);
        t.added.add(f.name);
      } catch (e) {
        t.errors.set(f.name, (e as Error).message);
      }
    }
    this.busy = '';
    await this.load();
  }

  page(): HTMLElement {
    const add = h('button', { class: 'dash-btn dash-btn--primary', type: 'button', text: tr('+ Adicionar conector'), on: { click: () => { this.open = true; this.invalidate(); } } });
    const head = this.header(tr('Conectores'), tr('Dão aos agentes acesso a documentação, navegador, erros de produção, tarefas e mais.'), add);
    if (!(access().admin || (access().local && !access().remote))) {
      return h('div', { class: 'dash-page' }, this.header(tr('Conectores'), tr('Dão aos agentes acesso a documentação, navegador, erros de produção, tarefas e mais.')), h('section', { class: 'dash-card dash-empty' }, h('h2', { text: tr('Só para admins') }), h('p', { text: tr('Peça a um admin para adicionar conectores.') })));
    }
    if (!this.servers) return h('div', { class: 'dash-page' }, head, h('section', { class: 'dash-card dash-empty' }, h('p', { text: this.err || tr('Lendo os conectores…') })));
    const have = new Map(this.servers.map((s) => [s.name, s]));
    const pill = (s: Server) => h('span', { class: `dash-status ${s.status === 'ok' ? 'is-working' : s.status === 'auth' ? 'is-waiting' : s.status === 'fail' ? 'is-bad' : ''}`, text: s.status === 'ok' ? tr('Conectado') : s.status === 'auth' ? tr('Precisa entrar') : s.status === 'fail' ? tr('Falhou') : s.detail || '—' });
    const remove = (name: string) => h('button', { class: 'dash-btn dash-btn--ghost-bad', type: 'button', text: tr('Remover'), on: { click: () => confirm(tr('Remover o conector {0} de todas as contas?', [name])) && this.act(name, () => this.call('DELETE', `/api/mcp/${encodeURIComponent(name)}`)) } });
    const titleOf = (name: string) => this.catalog.find((c) => c.name === name)?.title ?? name;

    // Os que você já tem, em cartões.
    const mine = this.servers.length
      ? h('div', { class: 'dash-models' }, ...this.servers.map((sv) => h('div', { class: `dash-model${sv.status === 'ok' ? ' is-in' : ''}` },
          h('div', { class: 'dash-model__top' }, h('b', { text: titleOf(sv.name) }), pill(sv)),
          h('p', { class: 'dash-mcp-target', text: sv.target }),
          h('div', { class: 'dash-model__foot' }, h('span', { class: 'dash-grow' }), remove(sv.name)))))
      : h('div', { class: 'dash-empty' }, h('h2', { text: tr('Nenhum conector ainda') }), h('p', { text: tr('Conectores dão aos agentes ferramentas novas: documentação atualizada, um navegador para testar o site, os erros de produção, as suas tarefas.') }),
          h('button', { class: 'dash-btn dash-btn--primary', type: 'button', text: tr('+ Adicionar conector'), on: { click: () => { this.open = true; this.invalidate(); } } }));

    return h('div', { class: 'dash-page' }, head,
      this.err ? h('p', { class: 'dash-bad', text: this.err }) : null,
      h('section', { class: 'dash-card' }, mine,
        this.servers.some((sv) => sv.status === 'auth') ? h('p', { class: 'dash-muted dash-note', text: tr('"Precisa entrar": abra uma conversa com um agente e peça para rodar /mcp, ou entre pelo terminal do Claude Code; o login fica salvo na conta.') }) : null),
      this.open ? this.modal(have, pill) : null);
  }

  /** A janela de conversa: cole o comando, o JSON, o endereço ou toque num sugerido; ela adiciona e diz se conectou. */
  private modal(have: Map<string, Server>, pill: (s: Server) => HTMLElement): HTMLElement {
    const input = h('textarea', { attrs: { rows: 1, placeholder: tr('Cole o comando, o JSON, o endereço ou o nome (ex.: notion)'), 'aria-label': tr('Mensagem') } });
    input.value = this.draft;
    input.addEventListener('input', () => {
      this.draft = input.value;
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
    });
    const send = (text = input.value.trim()) => {
      if (!text || this.busy) return;
      const t = { me: text, found: parseConnector(text, this.catalog), added: new Set<string>(), errors: new Map<string, string>() };
      this.talk.push(t);
      this.draft = '';
      input.value = '';
      input.blur();
      this.invalidate();
      if (t.found.length) void this.addAll(t);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    });
    const result = (f: ParsedConnector, t: (typeof this.talk)[number]) => {
      const err = t.errors.get(f.name);
      if (err) return h('p', { class: 'dash-bad', text: tr('Não deu para adicionar: {0}', [err]) });
      if (!t.added.has(f.name)) return h('div', { class: 'cw-wait' }, h('span', { class: 'cw-spin' }), h('span', { text: tr('Adicionando e testando a conexão…') }));
      const sv = have.get(f.name);
      if (!sv) return h('p', { class: 'dash-muted', text: tr('Adicionado. Conferindo a conexão…') });
      return h('div', { class: 'dash-mcp-res' }, pill(sv), h('span', { text: sv.status === 'ok' ? tr('Pronto: os agentes já podem usar.') : sv.status === 'auth' ? tr('Adicionado. Falta entrar na conta do serviço: peça a um agente para rodar /mcp.') : tr('Adicionado, mas não conectou ainda: {0}', [sv.detail]) }));
    };
    const bubbles = this.talk.flatMap((t) => [
      h('div', { class: 'dash-ai-msg is-user' }, h('div', { class: 'dash-ai-msg__text', text: t.me })),
      h('div', { class: 'dash-ai-msg is-assistant' }, t.found.length
        ? h('div', { class: 'dash-mcp-found' }, ...t.found.map((f) => h('div', { class: 'dash-mcp-item' },
            h('div', {}, h('b', { text: f.name }), h('small', { text: `${f.transport === 'stdio' ? tr('comando') : f.transport.toUpperCase()} · ${f.target}` }), result(f, t)))))
        : h('div', { class: 'dash-ai-msg__text', text: tr('Não entendi. Cole o comando "claude mcp add…" da documentação, o JSON de mcpServers, o endereço do conector (https://…) ou toque num sugerido.') })),
    ]);
    const chips = this.catalog.filter((c) => !have.has(c.name)).map((c) => h('button', { class: 'dash-mcp-chip', type: 'button', title: c.desc, attrs: { disabled: !!this.busy }, on: { click: () => send(c.title) } }, h('b', { text: c.title }), h('small', { text: c.desc })));
    const close = () => { this.open = false; this.invalidate(); };
    const box = h('section', { class: 'dash-card dash-ai-chat dash-mcp-chat' },
      h('div', { class: 'dash-ai-chat__head' }, h('span', { class: 'dash-ai-av', attrs: { 'aria-hidden': 'true' } }),
        h('div', {}, h('b', { text: tr('Adicionar conector') }), h('small', { text: tr('Cole o que a documentação do conector manda ou escolha um sugerido.') })),
        h('button', { class: 'dash-ai-x', type: 'button', text: '✕', attrs: { 'aria-label': tr('Fechar') }, on: { click: close } })),
      h('div', { class: 'dash-ai-log' }, ...(bubbles.length ? bubbles : [h('div', { class: 'dash-mcp-sug' }, h('p', { class: 'dash-muted', text: tr('Sugeridos') }), h('div', { class: 'dash-mcp-chips' }, ...chips))])),
      h('div', { class: 'dash-ai-compose' }, input, h('button', { class: 'dash-ai-send', type: 'button', text: '↑', attrs: { 'aria-label': tr('Mandar'), disabled: !!this.busy }, on: { click: () => send() } })),
      h('p', { class: 'dash-muted dash-note dash-mcp-warn', text: tr('Vale para todas as contas do Claude neste servidor. Conectores por comando rodam no servidor: adicione só os que você confia.') }));
    return h('div', { class: 'dash-ai-modal', on: { click: (e) => e.target === e.currentTarget && close() } }, box);
  }
}
