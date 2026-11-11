// Página "Conectores" do modo Painel: servidores MCP do Claude Code (documentação, navegador, Sentry, Notion...).
// Adiciona em todas as contas do Claude, no escopo do usuário. Conversa com /api/mcp (server/accounts/mcp.ts).
import { callbackUrl, extractAuthUrl, mcpKeys } from '../../../shared/oauth-url';
import { ptyScreen, sendPtyInput } from './ptyapi';
import { access } from '../net/access';
import { tr } from '../../../shared/i18n';
import { h } from './dom';
import { parseConnector, type ParsedConnector } from './mcp-parse';

interface Server { name: string; target: string; transport: 'http' | 'sse' | 'stdio'; alias?: string; status: 'ok' | 'fail' | 'auth' | 'unknown'; detail: string }
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
  /** Pasta onde o Claude Code abre para entrar num conector (vem do servidor). */
  private loginDir = '';
  /** Conector sendo renomeado. */
  private editing = '';
  /** Conector em que a pessoa clicou em Entrar: a página confere sozinha até conectar. */
  private waiting = '';
  /** Terminal aberto para o login, o link de autorização que ele imprimiu e se o endereço de retorno já foi enviado. */
  private ptyId = '';
  private authUrl = '';
  private sent = false;
  private peekTimer: ReturnType<typeof setInterval> | undefined;
  /** Janela em branco aberta no clique em Entrar (para não ser bloqueada) e que vai para o link de autorização. */
  private popup: Window | null = null;
  private lastKey = 0;
  private peekFrom = 0;
  private failed = false;
  private pressed = false;
  private readonly onFocus = () => void this.pasteBack();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private invalidate: () => void,
    private header: (title: string, sub: string, ...right: (HTMLElement | null)[]) => HTMLElement,
    /** Abre o terminal já no /mcp (ausente sem terminal interativo: cai na dica de rodar /mcp à mão). */
    private canLogin: () => ((path: string) => Promise<string | undefined>) | undefined = () => undefined,
  ) {}

  key(): string {
    return `${this.err}|${this.busy}|${this.servers?.map((s) => s.name + s.status + (s.alias ?? '')).join(',') ?? '-'}|${this.talk.length}|${this.talk.map((t) => t.added.size + t.errors.size).join(',')}|${this.open}|${this.editing}|${this.waiting}|${this.authUrl}|${this.sent}`;
  }

  /** Confere de 8 em 8 s (por até 3 min) se o login que a pessoa foi fazer no terminal já valeu. */
  private watch(name: string): void {
    this.waiting = name;
    clearInterval(this.timer);
    const until = Date.now() + 3 * 60_000;
    this.timer = setInterval(() => {
      if (Date.now() > until || !this.waiting) return this.stopWatch();
      void this.load().then(() => {
        if (this.servers?.find((s) => s.name === this.waiting)?.status === 'ok') this.stopWatch();
      });
    }, 8000);
  }

  /**
   * Guia o menu /mcp do Claude Code (terminal escondido) até o link de autorização: escolhe o conector, aperta
   * "Authenticate" e lê o link da tela. Se em 45 s não achar, avisa para tentar de novo.
   */
  private peek(id: string, name: string): void {
    this.ptyId = id;
    this.authUrl = '';
    this.sent = false;
    this.failed = false;
    this.pressed = false;
    this.peekFrom = Date.now();
    this.lastKey = 0;
    clearInterval(this.peekTimer);
    window.addEventListener('focus', this.onFocus);
    this.peekTimer = setInterval(() => {
      if (!this.waiting || this.ptyId !== id) return;
      void ptyScreen(id).then((text) => {
        if (this.ptyId !== id || this.authUrl) return;
        const url = extractAuthUrl(text);
        if (url) {
          this.authUrl = url;
          if (this.popup && !this.popup.closed) {
            this.popup.opener = null;
            this.popup.location.href = url;
          }
          this.invalidate();
          return;
        }
        if (Date.now() - this.peekFrom > 45_000) {
          this.failed = true;
          this.stopWatch(true);
          return;
        }
        if (Date.now() - this.lastKey < 2500) return;
        let keys = mcpKeys(text, name);
        // "Authenticate" só uma vez: a opção continua na tela até o link aparecer.
        if (keys === '\r' && /authenticate/i.test(text) && !/trust/i.test(text)) {
          if (this.pressed) keys = '';
          this.pressed = true;
        }
        if (keys) {
          this.lastKey = Date.now();
          void sendPtyInput(id, keys).catch(() => undefined);
        }
      });
    }, 1000);
  }

  /** Voltou para a aba com o endereço de retorno copiado: manda sozinho ao Claude Code. */
  private async pasteBack(): Promise<void> {
    if (!this.authUrl || this.sent || !this.ptyId) return;
    try {
      const text = await navigator.clipboard.readText();
      if (callbackUrl(text)) await this.finish(text);
    } catch {
      // sem permissão da área de transferência: o campo de colar continua valendo
    }
  }

  /** Manda ao terminal o endereço de retorno colado (o Claude Code termina o login com ele). */
  private async finish(text: string): Promise<string | undefined> {
    const url = callbackUrl(text);
    if (!url) return tr('Cole o endereço completo da página que abriu (começa com http://localhost e tem "code=").');
    try {
      await sendPtyInput(this.ptyId, `${url}\r`);
      this.sent = true;
      this.invalidate();
    } catch (err) {
      return (err as Error).message;
    }
    return undefined;
  }

  /** Passo a passo do login no cartão: abrir o link, autorizar e colar o endereço de retorno. */
  private authSteps(): HTMLElement {
    const field = h('input', { class: 'dash-mcp-rename', type: 'text', attrs: { placeholder: 'http://localhost:…/callback?code=…', 'aria-label': tr('Endereço da página de retorno'), autocomplete: 'off', spellcheck: 'false' } }) as HTMLInputElement;
    const msg = h('p', { class: 'dash-mcp-hint is-bad', hidden: true });
    const go = h('button', { class: 'dash-btn dash-btn--primary', type: 'button', text: tr('Concluir') }) as HTMLButtonElement;
    const send = () => void this.finish(field.value).then((err) => { msg.hidden = !err; msg.textContent = err ?? ''; });
    go.addEventListener('click', send);
    field.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) send(); });
    if (this.sent) return h('div', { class: 'dash-mcp-steps' }, h('p', { class: 'dash-mcp-hint', text: tr('Enviado ao Claude Code. Conferindo a conexão…') }));
    return h('div', { class: 'dash-mcp-steps' },
      h('p', { class: 'dash-mcp-hint', text: tr('1. Abra o link e autorize o acesso.') }),
      h('a', { class: 'dash-btn dash-btn--primary', attrs: { href: this.authUrl, target: '_blank', rel: 'noopener noreferrer' }, text: tr('Abrir link de autorização') }),
      h('p', { class: 'dash-mcp-hint', text: tr('2. Ao terminar, o navegador abre uma página com erro (localhost). É esperado: copie o endereço dessa página e cole aqui.') }),
      h('div', { class: 'dash-mcp-edit' }, field, go), msg);
  }

  private stopWatch(keepError = false): void {
    window.removeEventListener('focus', this.onFocus);
    if (!keepError) this.failed = false;
    if (this.popup && !this.popup.closed && !this.authUrl) this.popup.close();
    this.popup = null;
    clearInterval(this.peekTimer);
    this.peekTimer = undefined;
    this.ptyId = this.authUrl = '';
    this.sent = false;
    clearInterval(this.timer);
    this.timer = undefined;
    this.waiting = '';
    this.invalidate();
  }

  active(on: boolean): void {
    if (on && !this.loaded) void this.load();
    if (!on && this.timer) this.stopWatch();
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
      const j = (await this.call('GET', '/api/mcp')) as { servers: Server[]; catalog: CatalogItem[]; loginDir?: string };
      this.servers = j.servers;
      this.catalog = j.catalog;
      this.loginDir = j.loginDir ?? '';
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
    const titleOf = (sv: Server) => sv.alias ?? this.catalog.find((c) => c.name === sv.name)?.title ?? sv.name;
    const where = (sv: Server) => (sv.transport === 'stdio' ? `${tr('comando')} · ${sv.target}` : `${sv.transport.toUpperCase()} · ${sv.target.replace(/^https?:\/\//, '')}`);
    const login = this.canLogin();

    /** Título que vira campo de texto: o nome só vale na tela, os agentes seguem usando o nome técnico. */
    const renamer = (sv: Server) => {
      const input = h('input', { class: 'dash-mcp-rename', type: 'text', attrs: { maxlength: 40, 'aria-label': tr('Nome do conector'), placeholder: sv.name } }) as HTMLInputElement;
      input.value = sv.alias ?? '';
      // O painel não redesenha por baixo de um campo com foco (dashboard.ts): solta o foco antes de fechar o editor.
      const stop = () => { input.blur(); this.editing = ''; this.invalidate(); };
      const save = () => {
        input.blur();
        this.editing = '';
        this.act(sv.name, () => this.call('PATCH', `/api/mcp/${encodeURIComponent(sv.name)}`, { alias: input.value }));
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) save();
        else if (e.key === 'Escape') stop();
      });
      requestAnimationFrame(() => input.focus());
      return h('div', { class: 'dash-mcp-edit' }, input,
        h('button', { class: 'dash-btn dash-btn--primary', type: 'button', text: tr('Salvar'), on: { click: save } }),
        h('button', { class: 'dash-btn', type: 'button', text: tr('Cancelar'), on: { click: stop } }));
    };

    const card = (sv: Server) => {
      const enter = sv.status === 'auth' && login
        ? h('button', { class: 'dash-btn dash-btn--primary', type: 'button', text: tr('Entrar'), title: tr('Abre o Claude Code já no menu de conectores'), on: { click: () => { this.watch(sv.name); this.popup = window.open('about:blank', '_blank'); void login(this.loginDir || '/').then((id) => (id ? this.peek(id, sv.name) : this.stopWatch())); } } })
        : null;
      const test = h('button', { class: 'dash-btn', type: 'button', text: tr('Testar'), title: tr('Confere a conexão agora'), attrs: { disabled: !!this.busy }, on: { click: () => this.act(sv.name, async () => undefined) } });
      const hint = sv.status === 'auth' && this.failed && this.waiting !== sv.name
        ? tr('Não consegui pegar o link de autorização. Clique em Entrar de novo.')
        : sv.status === 'auth'
        ? this.waiting === sv.name
          ? this.authUrl ? tr('Terminal aberto. No menu, escolha {0}, depois "Authenticate", abra o link e autorize. Esta tela confere sozinha.', [sv.name]) : tr('Preparando o login: o link de autorização abre em instantes.')
          : login ? tr('Falta entrar na conta do serviço. Clique em Entrar para abrir o terminal já no menu de conectores.') : tr('Falta entrar na conta do serviço: abra uma conversa com um agente e peça para rodar /mcp, ou entre pelo terminal do Claude Code; o login fica salvo na conta.')
        : sv.status === 'fail' ? tr('Não conectou: {0}', [sv.detail]) : '';
      return h('div', { class: `dash-model dash-mcp-card${sv.status === 'ok' ? ' is-in' : ''}` },
        h('div', { class: 'dash-model__top' }, this.editing === sv.name ? renamer(sv) : h('b', { text: titleOf(sv) }), pill(sv)),
        h('p', { class: 'dash-mcp-target', title: sv.target, text: `${sv.name !== titleOf(sv) ? `${sv.name} · ` : ''}${where(sv)}` }),
        hint ? h('p', { class: `dash-mcp-hint${sv.status === 'fail' ? ' is-bad' : ''}`, text: hint }) : null,
        this.waiting === sv.name && this.authUrl ? this.authSteps() : null,
        h('div', { class: 'dash-model__foot' }, enter, test, h('span', { class: 'dash-grow' }),
          this.editing === sv.name ? null : h('button', { class: 'dash-btn', type: 'button', text: tr('Renomear'), title: tr('Só o nome aqui na tela; os agentes continuam usando "{0}".', [sv.name]), on: { click: () => { this.editing = sv.name; this.invalidate(); } } }),
          remove(sv.name)));
    };

    const ok = this.servers.filter((s) => s.status === 'ok').length;
    const needs = this.servers.filter((s) => s.status === 'auth').length;
    // Os que precisam de você primeiro, depois os com erro, depois os conectados.
    const rank = (s: Server) => (s.status === 'auth' ? 0 : s.status === 'fail' ? 1 : s.status === 'unknown' ? 2 : 3);
    const mine = this.servers.length
      ? h('div', {}, h('p', { class: 'dash-muted dash-mcp-sum', text: [tr('Conectados: {0} de {1}', [ok, this.servers.length]), needs ? tr('Precisam entrar: {0}', [needs]) : ''].filter(Boolean).join(' · ') }),
          h('div', { class: 'dash-models' }, ...[...this.servers].sort((a, b) => rank(a) - rank(b)).map(card)))
      : h('div', { class: 'dash-empty' }, h('h2', { text: tr('Nenhum conector ainda') }), h('p', { text: tr('Conectores dão aos agentes ferramentas novas: documentação atualizada, um navegador para testar o site, os erros de produção, as suas tarefas.') }),
          h('button', { class: 'dash-btn dash-btn--primary', type: 'button', text: tr('+ Adicionar conector'), on: { click: () => { this.open = true; this.invalidate(); } } }));

    return h('div', { class: 'dash-page' }, head,
      this.err ? h('p', { class: 'dash-bad', text: this.err }) : null,
      h('section', { class: 'dash-card' }, mine),
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
