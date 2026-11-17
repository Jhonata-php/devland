// Página "IA local" do modo Painel: instalar o Ollama no servidor, escolher modelos leves que cabem na memória, ver o
// consumo e testar uma pergunta. Conversa com /api/ai (server/ai/local.ts); só admin ou o próprio computador.
import { access } from '../net/access';
import { tr } from '../../../shared/i18n';
import { copyText, h } from './dom';
import { ICONS } from './icons';

interface CatalogModel { id: string; name: string; use: string; sizeGb: number; ramGb: number; code?: boolean; agent?: boolean }
interface ApiTotals { requests: number; errors: number; promptTokens: number; completionTokens: number }
interface ApiTokenInfo { id: string; name: string; token: string; models: string[]; createdAt: number; lastUsedAt?: number; requests: number; promptTokens: number; completionTokens: number; fromEnv?: boolean }
interface ApiUsageInfo {
  total: ApiTotals;
  today: ApiTotals;
  days: { day: string; requests: number; errors: number; tokens: number }[];
  models: { model: string; requests: number; tokens: number }[];
  last: { at: number; model: string; token?: string; status: number; ms: number; promptTokens: number; completionTokens: number; ip: string }[];
}
interface AiStatus {
  system: { platform: string; arch: string; cpus: number; cpuModel: string; load: number; ramTotal: number; ramFree: number; disk: { free: number; total: number } | null };
  ollama: { installed: boolean; own: boolean; running: boolean; version: string | null; package: string | null };
  models: { name: string; size: number }[];
  loaded: { name: string; size: number }[];
  catalog: CatalogModel[];
  agentModel: string | null;
  guard?: string;
  api?: { tokens: ApiTokenInfo[]; usage: ApiUsageInfo };
  recommended: string;
  job: { kind: 'install' | 'pull'; model?: string; status: string; percent?: number; error?: string; done: boolean } | null;
}

const gb = (bytes: number) => `${(bytes / 1e9).toFixed(bytes < 10e9 ? 1 : 0)} GB`;

export class AiPage {
  private st: AiStatus | null = null;
  private err = '';
  private loading = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Conversa com o assistente local: o elemento fica montado entre os redesenhos (a página só o recoloca). */
  private chat: { model: string; msgs: { role: 'user' | 'assistant'; content: string; meta?: string }[]; busy: boolean } = { model: '', msgs: [], busy: false };
  private readonly chatEl: HTMLElement;
  private readonly chatLog: HTMLElement;
  private readonly chatInput: HTMLTextAreaElement;
  private readonly chatSend: HTMLButtonElement;
  private readonly chatModel: HTMLSelectElement;
  /** Janela de teste: a conversa com um modelo, aberta pelo botão Testar de cada modelo. */
  private readonly modal: HTMLElement;
  private readonly testTitle: HTMLElement;
  private readonly testInfo: HTMLElement;
  /** Tokens por segundo medidos em cada modelo (botão Medir velocidade). */
  private speed = new Map<string, number | 'run' | 'err'>();

  constructor(private invalidate: () => void, private header: (title: string, sub: string) => HTMLElement) {
    this.chatLog = h('div', { class: 'dash-ai-log', attrs: { role: 'log', 'aria-live': 'polite' } });
    this.chatInput = h('textarea', { attrs: { rows: 1, placeholder: tr('Pergunte algo ao assistente local…'), 'aria-label': tr('Mensagem para o assistente local') } });
    this.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        this.send();
      }
    });
    this.chatInput.addEventListener('input', () => {
      this.chatInput.style.height = 'auto';
      this.chatInput.style.height = `${Math.min(this.chatInput.scrollHeight, 200)}px`;
    });
    this.chatSend = h('button', { class: 'dash-ai-send', type: 'button', text: '↑', attrs: { 'aria-label': tr('Mandar') }, on: { click: () => this.send() } });
    this.chatModel = h('select', { class: 'dash-ai-model', attrs: { 'aria-label': tr('Modelo') }, on: { change: () => (this.chat.model = this.chatModel.value) } });
    const clear = h('button', { class: 'dash-link', type: 'button', text: tr('Nova conversa'), on: { click: () => {
      this.chat.msgs = [];
      this.drawChat();
    } } });
    this.testTitle = h('b', { text: tr('Assistente local') });
    this.testInfo = h('div', { class: 'dash-ai-info' });
    this.chatEl = h('section', { class: 'dash-card dash-ai-chat' },
      h('div', { class: 'dash-ai-chat__head' },
        h('span', { class: 'dash-ai-av', attrs: { 'aria-hidden': 'true' } }),
        h('div', {}, this.testTitle, h('small', { text: tr('Roda no seu servidor, sem conta e sem enviar nada para fora.') })),
        clear, h('button', { class: 'dash-ai-x', type: 'button', text: '✕', attrs: { 'aria-label': tr('Fechar') }, on: { click: () => this.closeTest() } })),
      this.testInfo,
      this.chatLog,
      h('div', { class: 'dash-ai-compose' }, this.chatInput, this.chatSend));
    this.modal = h('div', { class: 'dash-ai-modal', hidden: true, on: { click: (e) => e.target === this.modal && this.closeTest() } }, this.chatEl);
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.modal.hidden) this.closeTest();
    });
    this.drawChat();
  }

  /** Abre a conversa de teste com o modelo. */
  private openTest(model: string): void {
    if (this.chat.model !== model) this.chat.msgs = [];
    this.chat.model = model;
    this.chatModel.value = model;
    this.modal.hidden = false;
    this.drawInfo();
    this.drawChat();
    requestAnimationFrame(() => this.chatInput.focus());
  }

  /** Os dados do modelo em teste: tamanho, memória, velocidade, uso nos agentes e se está carregado. */
  private drawInfo(): void {
    const st = this.st;
    const m = this.chat.model;
    if (!st || !m) return;
    const c = st.catalog.find((x) => x.id === m || `${x.id}:latest` === m);
    const size = st.models.find((x) => x.name === m)?.size ?? 0;
    const sp = this.speed.get(m);
    this.testTitle.textContent = tr('Testar {0}', [c?.name ?? m]);
    const item = (label: string, value: string) => h('div', { class: 'dash-ai-info__item' }, h('span', { text: label }), h('b', { text: value }));
    const kids: (HTMLElement | null)[] = [
      item(tr('Tamanho'), gb(size)),
      item(tr('Memória'), c ? tr('{0} GB', [c.ramGb]) : '—'),
      item(tr('Velocidade'), typeof sp === 'number' ? tr('{0} tokens/s', [sp]) : sp === 'run' ? tr('medindo…') : '—'),
      item(tr('Agentes'), st.agentModel === m ? tr('usam este') : c?.agent ? tr('serve') : tr('não indicado')),
      item(tr('Agora'), st.loaded.some((x) => x.name === m) ? tr('carregado') : tr('em disco')),
      h('button', { class: 'dash-btn', type: 'button', attrs: { disabled: sp === 'run' }, text: tr('Medir velocidade'), on: { click: () => void this.bench([m]).then(() => this.drawInfo()) } }),
      st.agentModel === m ? null : h('button', { class: 'dash-btn', type: 'button', text: tr('Usar nos agentes'), on: { click: () => this.act(() => this.post('/api/ai/agent-model', { model: m })) } }),
      c?.use ? h('p', { class: 'dash-ai-info__use', text: c.use }) : null,
    ];
    this.testInfo.replaceChildren(...kids.filter((k): k is HTMLElement => !!k));
  }

  private closeTest(): void {
    this.modal.hidden = true;
  }

  private drawChat(): void {
    const bubbles = this.chat.msgs.map((m) => h('div', { class: `dash-ai-msg is-${m.role}` }, h('div', { class: 'dash-ai-msg__text', text: m.content }), m.meta ? h('small', { text: m.meta }) : null));
    if (!bubbles.length) bubbles.push(h('div', { class: 'dash-ai-empty' }, h('b', { text: tr('Converse com o modelo que você baixou') }), h('span', { text: tr('Ex.: "explique este erro", "escreva um teste para esta função", "resuma este texto".') })));
    if (this.chat.busy) bubbles.push(h('div', { class: 'dash-ai-msg is-assistant is-typing' }, h('div', { class: 'dash-ai-msg__text' }, h('i'), h('i'), h('i'))));
    this.chatLog.replaceChildren(...bubbles);
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
    this.chatSend.disabled = this.chat.busy;
  }

  /** Mede a velocidade de cada modelo baixado, um por vez, com uma pergunta curta. */
  private async bench(models: string[]): Promise<void> {
    for (const m of models) this.speed.set(m, 'run');
    this.invalidate();
    for (const m of models) {
      try {
        const r = (await this.post('/api/ai/chat', { model: m, messages: [{ role: 'user', content: tr('Escreva uma frase curta sobre programação.') }] })) as { tokensPerS: number };
        this.speed.set(m, r.tokensPerS);
      } catch {
        this.speed.set(m, 'err');
      }
      if (!this.modal.hidden) this.drawInfo();
      this.invalidate();
    }
  }

  private send(): void {
    const text = this.chatInput.value.trim();
    if (!text || this.chat.busy || !this.chat.model) return;
    this.chat.msgs.push({ role: 'user', content: text });
    this.chatInput.value = '';
    this.chatInput.style.height = 'auto';
    this.chat.busy = true;
    this.drawChat();
    this.post('/api/ai/chat', { model: this.chat.model, messages: this.chat.msgs.map(({ role, content }) => ({ role, content })) }).then((r) => {
      const x = r as { text: string; tokensPerS: number; seconds: number };
      this.chat.msgs.push({ role: 'assistant', content: x.text || '…', meta: tr('{0} · {1} tokens/s · {2} s', [this.chat.model, x.tokensPerS, x.seconds]) });
    }, (e: Error) => {
      this.chat.msgs.push({ role: 'assistant', content: e.message, meta: tr('erro') });
    }).finally(() => {
      this.chat.busy = false;
      this.drawChat();
      this.invalidate();
    });
  }

  /** Muda quando a página precisa redesenhar. */
  key(): string {
    const j = this.st?.job;
    return `${this.err}|${this.st ? `${this.st.ollama.running}|${this.st.models.length}|${this.st.loaded.length}|${Math.round(this.st.system.ramFree / 1e9)}|${j?.status}|${j?.percent}|${j?.done}` : '-'}|${[...this.speed].join(',')}|${this.st?.api?.tokens.length ?? 0}|${this.st?.api?.usage.total.requests ?? 0}|${this.apiOpen}|${[...this.shown]}|${this.copied}|${this.apiForm ? `f${this.apiForm.id ?? ''}` : ''}`;
  }

  /** Liga a atualização (a cada 3 s, mais rápido com download em andamento) enquanto a página está aberta. */
  active(on: boolean): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!on) return;
    void this.load();
    this.timer = setInterval(() => void this.load(), 3000);
  }

  private async load(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      const r = await fetch('/api/ai', { credentials: 'same-origin', cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      this.st = j;
      this.err = '';
    } catch (e) {
      this.err = (e as Error).message || tr('Não deu certo.');
    }
    this.loading = false;
    this.invalidate();
  }

  private async post(url: string, body?: unknown, method = 'POST'): Promise<unknown> {
    const r = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j as { error?: string }).error || tr('Não deu certo.'));
    return j;
  }

  private act(fn: () => Promise<unknown>): void {
    fn().then(() => this.load(), (e: Error) => {
      this.err = e.message;
      this.invalidate();
    });
  }

  private readonly dayFmt = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: '2-digit' });
  private readonly clockFmt = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  private copy(what: string, text: string): void {
    void copyText(text).then(() => {
      this.copied = what;
      this.invalidate();
      setTimeout(() => {
        this.copied = '';
        this.invalidate();
      }, 1500);
    });
  }

  /** Gráfico de uso da IA local (últimos 14 dias, pela API para outros sistemas) e a engrenagem que abre os tokens. */
  private usageCard(st: AiStatus): HTMLElement {
    const api = st.api;
    const u = api?.usage;
    const gear = h('button', { class: 'dash-ai-gear', type: 'button', attrs: { 'aria-label': tr('API e tokens'), title: tr('API e tokens') }, on: { click: () => { this.apiOpen = true; this.invalidate(); } } });
    gear.innerHTML = ICONS.settings;
    gear.append(h('span', { text: tr('API e tokens') }));
    const max = Math.max(1, ...(u?.days.map((d) => d.tokens) ?? [0]));
    const empty = !u || u.total.requests === 0;
    const bars = h('div', { class: 'dash-ai-chart', attrs: { role: 'img', 'aria-label': tr('Tokens por dia, últimos 14 dias') } },
      ...(u?.days ?? []).map((d) => h('div', { class: 'dash-ai-chart__col', attrs: { title: tr('{0}: {1} pedidos · {2} tokens', [this.dayFmt.format(new Date(`${d.day}T12:00:00`)), d.requests, d.tokens.toLocaleString()]) } },
        h('i', { class: d.errors ? 'has-err' : '', style: `height:${d.tokens ? Math.max(4, Math.round((d.tokens / max) * 100)) : 2}%` }))));
    const fmt = (t: ApiTotals) => `${t.requests} · ${(t.promptTokens + t.completionTokens).toLocaleString()}`;
    return h('section', { class: 'dash-card dash-ai-usage' },
      h('div', { class: 'dash-card__head' }, h('h2', { text: tr('Uso da IA local') }), h('small', { class: 'dash-muted', text: tr('Últimos 14 dias, pela API para outros sistemas') }), gear),
      empty
        ? h('p', { class: 'dash-muted', text: api?.tokens.length ? tr('Nenhum pedido ainda. Quando algum sistema usar a API, ele aparece aqui.') : tr('Para outros sistemas usarem a IA local deste servidor, crie um token na engrenagem ⚙.') })
        : h('div', {}, bars,
            h('div', { class: 'dash-ai-chart__axis' }, h('span', { text: this.dayFmt.format(new Date(`${u!.days[0]!.day}T12:00:00`)) }), h('span', { text: tr('tokens por dia') }), h('span', { text: tr('hoje') })),
            h('div', { class: 'dash-ai-stats' },
              h('div', {}, h('small', { text: tr('Hoje') }), h('b', { text: fmt(u!.today) })),
              h('div', {}, h('small', { text: tr('No total') }), h('b', { text: fmt(u!.total) })),
              h('div', {}, h('small', { text: tr('Erros') }), h('b', { text: String(u!.total.errors) })),
              h('div', {}, h('small', { text: tr('Tokens ativos') }), h('b', { text: String(api?.tokens.length ?? 0) }))),
            u!.models.length ? h('ul', { class: 'dash-ai-models' }, ...u!.models.slice(0, 4).map((m) => h('li', {}, h('span', { text: m.model }), h('i', { style: `width:${Math.max(3, Math.round((m.tokens / Math.max(1, u!.models[0]!.tokens)) * 100))}%` }), h('small', { text: tr('{0} pedidos · {1} tokens', [m.requests, m.tokens.toLocaleString()]) })))) : null),
      h('small', { class: 'dash-muted', text: tr('pedidos · tokens (entrada + saída)') }));
  }

  /** Modal "API e tokens": endereço, tokens listados (modelos permitidos e uso de cada um) e os últimos pedidos. */
  private apiModal(st: AiStatus): HTMLElement {
    const api = st.api!;
    const close = () => {
      this.apiOpen = false;
      this.apiForm = null;
      this.invalidate();
    };
    const url = location.origin;
    const installed = st.models.map((m) => m.name);
    const form = this.apiForm;
    const body: (HTMLElement | null)[] = [
      h('div', { class: 'dash-ai-api__row' }, h('small', { class: 'dash-muted', text: tr('Endereço') }), h('code', { text: url }),
        h('button', { class: 'dash-btn', type: 'button', text: this.copied === 'url' ? tr('Copiado') : tr('Copiar'), on: { click: () => this.copy('url', url) } })),
      h('p', { class: 'dash-muted', text: tr('No outro sistema, use este endereço e um dos tokens abaixo (cabeçalho Authorization: Bearer). Caminhos: /v1/models e /v1/chat/completions.') }),
    ];
    if (form) {
      const name = h('input', { class: 'dash-ai-api__name', type: 'text', attrs: { placeholder: tr('Nome do sistema (ex.: Orion)'), maxlength: 60, 'aria-label': tr('Nome') }, on: { input: (e) => { form.name = (e.target as HTMLInputElement).value; } } });
      name.value = form.name;
      const check = (on: boolean, change: (e: Event) => void) => {
        const c = h('input', { type: 'checkbox', on: { change } });
        c.checked = on;
        return c;
      };
      const all = form.models.size === 0;
      const list = [...new Set([...installed, ...form.models])];
      body.push(h('section', { class: 'dash-ai-api__form' },
        h('h3', { text: form.id ? tr('Editar token') : tr('Novo token') }),
        name,
        h('h4', { text: tr('Modelos permitidos') }),
        h('label', { class: 'dash-ai-api__opt' }, check(all, () => { form.models.clear(); this.invalidate(); }), h('span', { text: tr('Todos os modelos') })),
        ...list.map((m) => h('label', { class: 'dash-ai-api__opt' }, check(form.models.has(m), (e) => { (e.target as HTMLInputElement).checked ? form.models.add(m) : form.models.delete(m); this.invalidate(); }), h('span', { text: m }))),
        h('p', { class: 'dash-muted', text: tr('Marque só os modelos que este token pode usar. Sem marcar nenhum, ele vale para todos.') }),
        h('div', { class: 'dash-ai-api__acts' },
          h('button', { class: 'dash-btn dash-btn--primary', type: 'button', text: tr('Salvar'), on: { click: () => {
            const payload = { name: form.name.trim() || tr('Sem nome'), models: [...form.models] };
            this.apiForm = null;
            this.act(() => (form.id ? this.post(`/api/ai/api-tokens/${form.id}`, payload, 'PUT') : this.post('/api/ai/api-tokens', payload)));
          } } }),
          h('button', { class: 'dash-btn', type: 'button', text: tr('Cancelar'), on: { click: () => { this.apiForm = null; this.invalidate(); } } }))));
    } else {
      body.push(h('div', { class: 'dash-ai-api__acts' }, h('button', { class: 'dash-btn dash-btn--primary', type: 'button', text: `+ ${tr('Novo token')}`, on: { click: () => { this.apiForm = { name: '', models: new Set() }; this.invalidate(); } } })));
    }
    body.push(api.tokens.length
      ? h('ul', { class: 'dash-ai-tokens' }, ...api.tokens.map((t) => {
          const shown = this.shown.has(t.id);
          const v = `${t.id}`;
          return h('li', { class: 'dash-ai-token' },
            h('div', { class: 'dash-ai-token__head' }, h('b', { text: t.name }), t.fromEnv ? h('small', { class: 'dash-muted', text: tr('variável DEVLAND_AI_TOKEN') }) : null),
            h('div', { class: 'dash-ai-api__row' },
              h('code', { text: shown ? t.token : `••••••••${t.token.slice(-4)}` }),
              h('button', { class: 'dash-link', type: 'button', text: shown ? tr('Ocultar') : tr('Mostrar'), on: { click: () => { shown ? this.shown.delete(v) : this.shown.add(v); this.invalidate(); } } }),
              h('button', { class: 'dash-btn', type: 'button', text: this.copied === `t${t.id}` ? tr('Copiado') : tr('Copiar'), on: { click: () => this.copy(`t${t.id}`, t.token) } })),
            h('div', { class: 'dash-ai-token__chips' },
              ...(t.models.length ? t.models.map((m) => h('span', { class: 'dash-ai-chip', text: m })) : [h('span', { class: 'dash-ai-chip dash-ai-chip--all', text: tr('Todos os modelos') })])),
            h('small', { class: 'dash-muted', text: `${t.lastUsedAt ? tr('Último uso {0}', [this.clockFmt.format(t.lastUsedAt)]) : tr('Nunca usado')} · ${tr('{0} pedidos · {1} tokens', [t.requests, (t.promptTokens + t.completionTokens).toLocaleString()])}` }),
            t.fromEnv ? null : h('div', { class: 'dash-ai-api__acts' },
              h('button', { class: 'dash-btn', type: 'button', text: tr('Editar'), on: { click: () => { this.apiForm = { id: t.id, name: t.name, models: new Set(t.models) }; this.invalidate(); } } }),
              h('button', { class: 'dash-btn dash-btn--ghost-bad', type: 'button', text: tr('Revogar'), on: { click: () => confirm(tr('Revogar o token {0}? Os sistemas que o usam ficam sem IA.', [t.name])) && this.act(() => this.post(`/api/ai/api-tokens/${t.id}`, undefined, 'DELETE')) } })));
        }))
      : h('p', { class: 'dash-muted', text: tr('Nenhum token ainda. Crie um para liberar a API para outro sistema.') }));
    const last = api.usage.last;
    if (last.length) {
      body.push(h('div', { class: 'dash-ai-api__use' }, h('h3', { text: tr('Últimos pedidos') }),
        h('ul', { class: 'dash-ai-api__calls' }, ...last.slice(0, 8).map((c) => h('li', { class: c.status >= 400 ? 'is-err' : '' },
          h('span', { text: this.clockFmt.format(c.at) }), h('span', { text: c.token ?? '—' }), h('span', { text: c.model || '—' }), h('span', { text: String(c.status) }),
          h('span', { text: tr('{0} tokens · {1} s', [(c.promptTokens + c.completionTokens).toLocaleString(), (c.ms / 1000).toFixed(1)]) }), h('span', { text: c.ip }))))));
    }
    return h('div', { class: 'dash-ai-modal', on: { click: (e) => e.target === e.currentTarget && close() } },
      h('section', { class: 'dash-card dash-ai-apimodal', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': tr('API e tokens') } },
        h('div', { class: 'dash-ai-chat__head' }, h('div', {}, h('b', { text: tr('API e tokens') }), h('small', { text: tr('Deixa outros sistemas usarem a IA local deste servidor. É compatível com a API da OpenAI.') })),
          h('button', { class: 'dash-ai-x', type: 'button', text: '✕', attrs: { 'aria-label': tr('Fechar') }, on: { click: close } })),
        h('div', { class: 'dash-ai-apimodal__body' }, ...body)));
  }

  /** Abre o Novo agente (definido pelo painel). */
  onNewAgent?: () => void;
  /** Mostra também os modelos grandes demais para este servidor. */
  private showAll = false;
  /** Modal "API e tokens" (engrenagem): aberto?, tokens com o valor à mostra, e o formulário de novo token/edição. */
  private apiOpen = false;
  private shown = new Set<string>();
  private copied = '';
  private apiForm: { id?: string; name: string; models: Set<string> } | null = null;

  page(): HTMLElement {
    const head = this.header(tr('IA local'), tr('Modelos de IA no seu próprio servidor: sem conta, sem custo por uso e sem enviar nada para fora.'));
    if (!(access().admin || (access().local && !access().remote))) {
      return h('div', { class: 'dash-page' }, head, h('section', { class: 'dash-card dash-empty' }, h('h2', { text: tr('Só para admins') }), h('p', { text: tr('Peça a um admin para ativar a IA local.') })));
    }
    const st = this.st;
    if (!st) return h('div', { class: 'dash-page' }, head, h('section', { class: 'dash-card dash-empty' }, h('p', { text: this.err || tr('Lendo o servidor…') })));
    const s = st.system;
    const ramGb = s.ramTotal / 1e9;
    const job = st.job;
    const working = !!job && !job.done;
    const nameOf = (id: string) => st.catalog.find((c) => c.id === id || `${c.id}:latest` === id)?.name ?? id;
    const have = new Set(st.models.map((m) => m.name));
    const isIn = (id: string) => have.has(id) || have.has(`${id}:latest`);

    // 1) Ainda sem o motor: um cartão só, com o botão de ativar.
    if (!st.ollama.installed || (job?.kind === 'install' && (!job.done || job.error))) {
      const busy = job?.kind === 'install' && !job.done;
      return h('div', { class: 'dash-page' }, head,
        h('section', { class: 'dash-card dash-ai-hero' },
          h('span', { class: 'dash-ai-av dash-ai-av--big', attrs: { 'aria-hidden': 'true' } }),
          h('h2', { text: busy ? tr('Ativando a IA local…') : tr('Ative a IA local') }),
          h('p', { class: 'dash-muted', text: tr('Instala o motor de IA no servidor (cerca de {0}, uma vez só). Depois você escolhe os modelos e cria agentes que rodam aqui, sem gastar o plano.', [st.ollama.package?.includes('linux') ? '1,5 GB' : '200 MB']) }),
          busy ? h('div', { class: 'dash-bar dash-ai-hero__bar' }, h('div', { class: 'dash-bar__track' }, h('i', { style: `width:${job!.percent ?? 0}%` })), h('small', { text: `${job!.percent ?? 0}%` })) : null,
          job?.kind === 'install' && job.error ? h('p', { class: 'dash-bad', text: job.error }) : null,
          busy ? h('button', { class: 'dash-btn', type: 'button', text: tr('Cancelar'), on: { click: () => this.act(() => this.post('/api/ai/cancel')) } })
            : st.ollama.package ? h('button', { class: 'dash-btn dash-btn--primary', type: 'button', text: tr('Ativar IA local'), on: { click: () => this.act(() => this.post('/api/ai/install')) } })
            : h('p', { class: 'dash-bad', text: tr('Este sistema ainda não tem a IA local.') })));
    }

    // 2) Resumo do servidor, discreto.
    const pct = (a: number, b: number) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0);
    const chip = (label: string, value: string, p: number) => h('div', { class: `dash-ai-meter${p >= 85 ? ' is-warn' : ''}` }, h('span', { text: label }), h('b', { text: value }), h('i', {}, h('u', { style: `width:${p}%` })));
    const meters = h('section', { class: 'dash-ai-meters' },
      h('div', { class: `dash-ai-state${st.ollama.running ? ' is-on' : ''}` }, h('i'), h('span', { text: st.ollama.running ? tr('IA local ligada') : tr('IA local parada') })),
      chip(tr('Memória'), `${gb(s.ramTotal - s.ramFree)} / ${gb(s.ramTotal)}`, pct(s.ramTotal - s.ramFree, s.ramTotal)),
      chip(tr('CPU'), tr('{0} núcleos', [s.cpus]), pct(s.load, s.cpus)),
      s.disk ? chip(tr('Disco livre'), gb(s.disk.free), pct(s.disk.total - s.disk.free, s.disk.total)) : null,
      chip(tr('Em uso agora'), st.loaded.length ? gb(st.loaded.reduce((n, m) => n + m.size, 0)) : tr('nada'), 0));

    // 3) Agentes: qual modelo eles usam e o atalho para criar um.
    const agentCard = st.models.length ? h('section', { class: 'dash-card dash-ai-agents' },
      h('div', { class: 'dash-ai-agents__txt' },
        h('h2', { text: tr('Agentes com IA local') }),
        h('p', { class: 'dash-muted', text: tr('No Novo agente, escolha a conta "IA local". O agente trabalha como os outros (conversa, permissões, escritório), usando o modelo abaixo.') })),
      h('label', { class: 'dash-ai-pick' }, h('span', { text: tr('Modelo dos agentes') }),
        h('select', { on: { change: (e) => this.act(() => this.post('/api/ai/agent-model', { model: (e.target as HTMLSelectElement).value })) } },
          ...st.models.map((m) => h('option', { attrs: { value: m.name, selected: m.name === st.agentModel }, text: nameOf(m.name) })))),
      this.onNewAgent ? h('button', { class: 'dash-btn dash-btn--primary', type: 'button', text: tr('+ Novo agente'), on: { click: () => this.onNewAgent?.() } }) : null) : null;

    // 4) Seus modelos, em cartões com botões de verdade.
    const loadedSet = new Set(st.loaded.map((m) => m.name));
    const speeds = [...this.speed.values()].filter((v): v is number => typeof v === 'number');
    const fastest = speeds.length > 1 ? Math.max(...speeds) : -1;
    const speedOf = (name: string) => {
      const v = this.speed.get(name);
      return v === undefined ? '' : v === 'run' ? tr('medindo…') : v === 'err' ? tr('não respondeu') : tr('{0} tokens/s', [v]);
    };
    const mine = h('div', { class: 'dash-models' }, ...st.models.map((m) => h('div', { class: `dash-model is-in${st.agentModel === m.name ? ' is-agent' : ''}` },
      h('div', { class: 'dash-model__top' }, h('b', { text: nameOf(m.name) }),
        st.agentModel === m.name ? h('span', { class: 'dash-badge is-blue', text: tr('Agentes usam este') }) : null,
        this.speed.get(m.name) === fastest ? h('span', { class: 'dash-badge is-admin', text: tr('Mais rápido') }) : null),
      h('div', { class: 'dash-model__meta' },
        h('span', { class: 'dash-badge', text: gb(m.size) }),
        loadedSet.has(m.name) ? h('span', { class: 'dash-badge is-admin', text: tr('carregado') }) : null,
        speedOf(m.name) ? h('span', { class: 'dash-badge', text: speedOf(m.name) }) : null),
      h('div', { class: 'dash-model__foot' },
        h('button', { class: 'dash-btn dash-btn--primary', type: 'button', text: tr('Testar'), on: { click: () => this.openTest(m.name) } }),
        st.agentModel === m.name ? null : h('button', { class: 'dash-btn', type: 'button', text: tr('Usar nos agentes'), on: { click: () => this.act(() => this.post('/api/ai/agent-model', { model: m.name })) } }),
        h('span', { class: 'dash-grow' }),
        h('button', { class: 'dash-btn dash-btn--ghost-bad', type: 'button', text: tr('Remover'), on: { click: () => confirm(tr('Remover o modelo {0}?', [nameOf(m.name)])) && this.act(() => this.post(`/api/ai/models/${encodeURIComponent(m.name)}`, undefined, 'DELETE')) } })))));

    // 5) Baixar modelos: os que cabem primeiro; os grandes demais só em "Ver todos".
    const pulling = job?.kind === 'pull' ? job : null;
    const fit = (m: CatalogModel) => m.ramGb <= ramGb * 0.8;
    const list = st.catalog.filter((m) => !isIn(m.id) && (this.showAll || fit(m)));
    const hidden = st.catalog.filter((m) => !isIn(m.id) && !fit(m)).length;
    const store = h('div', { class: 'dash-models' }, ...list.map((m) => {
      const mineNow = pulling?.model === m.id && !pulling.done;
      return h('div', { class: `dash-model${fit(m) ? '' : ' is-heavy'}${m.id === st.recommended ? ' is-rec' : ''}` },
        h('div', { class: 'dash-model__top' }, h('b', { text: m.name }),
          m.id === st.recommended ? h('span', { class: 'dash-badge is-admin', text: tr('Recomendado') }) : null,
          m.agent ? h('span', { class: 'dash-badge is-blue', text: tr('para agentes') }) : null),
        h('p', { text: m.use }),
        h('div', { class: 'dash-model__meta' },
          h('span', { class: 'dash-badge', text: `${m.sizeGb.toLocaleString()} GB` }),
          h('span', { class: `dash-badge${fit(m) ? '' : ' is-warn'}`, text: fit(m) ? tr('precisa de {0} GB de memória', [m.ramGb]) : tr('Precisa de {0} GB de memória', [m.ramGb]) })),
        mineNow ? h('div', { class: 'dash-bar' }, h('div', { class: 'dash-bar__track' }, h('i', { style: `width:${pulling!.percent ?? 0}%` })), h('small', { text: tr('Baixando… {0}%', [pulling!.percent ?? 0]) })) : null,
        pulling?.model === m.id && pulling.error ? h('p', { class: 'dash-bad', text: pulling.error }) : null,
        h('div', { class: 'dash-model__foot' },
          h('span', { class: 'dash-grow' }),
          mineNow ? h('button', { class: 'dash-btn', type: 'button', text: tr('Cancelar'), on: { click: () => this.act(() => this.post('/api/ai/cancel')) } })
            : h('button', { class: `dash-btn${m.id === st.recommended ? ' dash-btn--primary' : ''}`, type: 'button', attrs: { disabled: working }, text: tr('Baixar'), on: { click: () => this.act(() => this.post('/api/ai/pull', { model: m.id })) } })));
    }));

    // Assistente: conversa rápida com um modelo baixado.
    if (!this.chat.model || !have.has(this.chat.model)) this.chat.model = st.models[0]?.name ?? '';
    const names = st.models.map((m) => m.name).join('|');
    if (this.chatModel.dataset.names !== names) {
      this.chatModel.dataset.names = names;
      this.chatModel.replaceChildren(...st.models.map((m) => h('option', { attrs: { value: m.name }, text: nameOf(m.name) })));
    }
    this.chatModel.value = this.chat.model;

    return h('div', { class: 'dash-page' }, head,
      this.err ? h('p', { class: 'dash-bad', text: this.err }) : null,
      meters,
      st.api ? this.usageCard(st) : null,
      st.guard ? h('section', { class: 'dash-alert' }, h('b', { text: tr('Proteção de memória') }), h('span', { text: st.guard })) : null,
      agentCard,
      st.models.length ? h('section', { class: 'dash-card' }, h('div', { class: 'dash-card__head' }, h('h2', { text: tr('Seus modelos') }),
        h('button', { class: 'dash-btn', type: 'button', text: tr('Medir velocidade'), attrs: { disabled: [...this.speed.values()].includes('run') }, on: { click: () => void this.bench(st.models.map((m) => m.name)) } })), mine) : null,
      h('section', { class: 'dash-card' }, h('div', { class: 'dash-card__head' }, h('h2', { text: st.models.length ? tr('Baixar mais modelos') : tr('Escolha um modelo para começar') }),
        h('small', { class: 'dash-muted', text: tr('Seu servidor: {0} de memória, {1} núcleos', [gb(s.ramTotal), s.cpus]) })),
        store,
        hidden ? h('button', { class: 'dash-link dash-ai-more', type: 'button', text: this.showAll ? tr('Mostrar só os que cabem neste servidor') : tr('Ver também os {0} modelos maiores (precisam de servidor com mais memória)', [hidden]), on: { click: () => { this.showAll = !this.showAll; this.invalidate(); } } }) : null),
      this.modal,
      this.apiOpen && st.api ? this.apiModal(st) : null,
      st.ollama.own ? h('details', { class: 'dash-ai-adv' }, h('summary', { text: tr('Mais opções') }),
        h('p', { class: 'dash-muted', text: tr('Desativar apaga o motor e todos os modelos baixados, liberando o espaço no disco.') }),
        h('button', { class: 'dash-btn dash-btn--ghost-bad', type: 'button', attrs: { disabled: working }, text: tr('Desativar a IA local'), on: { click: () => confirm(tr('Desativar a IA local e apagar todos os modelos baixados?')) && this.act(() => this.post('/api/ai/uninstall')) } })) : null);
  }
}
