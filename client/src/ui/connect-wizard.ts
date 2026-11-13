// Conectar conta, passo a passo (DevLand Cloud): 1) escolher o tipo (Claude Code, Codex ou GitHub); 2) entrar pelo link
// (e colar o código, no Claude, ou confirmar o código no site, no Codex e no GitHub); 3) pronto. Usa /api/cloud/connect
// (server/cloud/connect.ts). Substitui a página antiga de Contas dentro de uma janela.
import { tr } from '../../../shared/i18n';
import { h } from './dom';

type Provider = 'claude' | 'codex' | 'github';
interface Job { id: string; provider: Provider; state: 'starting' | 'waiting' | 'done' | 'failed'; url?: string; code?: string; needsPaste: boolean; error?: string }
interface Account { provider: Provider; label: string }

const INFO: Record<Provider, { name: () => string; desc: () => string; letter: string }> = {
  claude: { name: () => 'Claude Code', desc: () => tr('Assinatura do Claude (Pro/Max) ou conta da Anthropic.'), letter: 'C' },
  codex: { name: () => 'Codex', desc: () => tr('Conta do ChatGPT para o Codex.'), letter: 'X' },
  github: { name: () => 'GitHub', desc: () => tr('Para clonar projetos e para os agentes fazerem git push.'), letter: 'G' },
};

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || tr('Não deu certo.'));
  return j as T;
}

export class ConnectWizard {
  readonly el: HTMLElement;
  private readonly box: HTMLElement;
  private step: 1 | 2 | 3 = 1;
  private provider: Provider | null = null;
  private job: Job | null = null;
  private accounts: Account[] = [];
  private available: Record<Provider, boolean> = { claude: true, codex: true, github: true };
  private err = '';
  private polling = 0;

  constructor(private onChange: () => void) {
    this.box = h('div', { class: 'cw-box', role: 'dialog', attrs: { 'aria-modal': 'true', 'aria-label': tr('Conectar conta') } });
    this.el = h('div', { class: 'cw', hidden: true, on: { click: (e) => e.target === this.el && this.close() } }, this.box);
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.el.hidden) this.close();
    });
  }

  open(): void {
    this.step = 1;
    this.provider = null;
    this.job = null;
    this.err = '';
    this.el.hidden = false;
    this.draw();
    void this.loadAccounts();
  }

  close(): void {
    this.el.hidden = true;
    this.polling++;
  }

  private async loadAccounts(): Promise<void> {
    try {
      const r = await call<{ accounts: Account[]; available: Record<Provider, boolean> }>('GET', '/api/cloud/accounts');
      this.accounts = r.accounts;
      this.available = r.available;
    } catch (e) {
      this.err = (e as Error).message;
    }
    this.draw();
  }

  private async start(p: Provider): Promise<void> {
    this.provider = p;
    this.step = 2;
    this.err = '';
    this.job = null;
    this.draw();
    const run = ++this.polling;
    try {
      let job = await call<Job>('POST', '/api/cloud/connect', { provider: p });
      // Redesenha só quando algo muda no pedido: redesenhar a cada consulta (1,5 s) recriava o campo do código e apagava o
      // que a pessoa estava digitando ou colando.
      const keyOf = (j: Job) => `${j.state}|${j.url ?? ''}|${j.code ?? ''}|${j.needsPaste}|${j.error ?? ''}`;
      let shown = '';
      while (run === this.polling && (job.state === 'starting' || job.state === 'waiting')) {
        this.job = job;
        if (keyOf(job) !== shown) {
          shown = keyOf(job);
          this.draw();
        }
        await new Promise((r) => setTimeout(r, 1500));
        job = await call<Job>('GET', `/api/cloud/connect/${job.id}`);
      }
      if (run !== this.polling) return;
      this.job = job;
      this.step = 3;
      await this.loadAccounts();
      this.onChange();
    } catch (e) {
      this.err = (e as Error).message;
      this.step = 3;
    }
    this.draw();
  }

  private head(): HTMLElement {
    const steps = [tr('Tipo'), tr('Entrar'), tr('Pronto')];
    return h('div', { class: 'cw-head' },
      h('div', { class: 'cw-title' }, h('b', { text: tr('Conectar conta') }), h('button', { class: 'cw-x', type: 'button', text: '✕', attrs: { 'aria-label': tr('Fechar') }, on: { click: () => this.close() } })),
      h('ol', { class: 'cw-steps' }, ...steps.map((s, i) => h('li', { class: i + 1 < this.step ? 'is-done' : i + 1 === this.step ? 'is-on' : '' }, h('i', { text: i + 1 < this.step ? '✓' : String(i + 1) }), h('span', { text: s })))));
  }

  private logo(p: Provider): HTMLElement {
    return h('span', { class: `cw-logo is-${p}`, text: INFO[p].letter });
  }

  private draw(): void {
    if (this.el.hidden) return;
    const body = this.step === 1 ? this.pick() : this.step === 2 ? this.login() : this.done();
    this.box.replaceChildren(this.head(), body, this.err ? h('p', { class: 'cw-err', text: this.err }) : '');
  }

  /** Passo 1: o tipo de conta, com as que já estão conectadas. */
  private pick(): HTMLElement {
    return h('div', { class: 'cw-body' },
      h('p', { class: 'cw-sub', text: tr('Escolha o que conectar. As contas valem para toda a instalação: os agentes de todos usam as contas conectadas aqui.') }),
      h('div', { class: 'cw-types' }, ...(['claude', 'codex', 'github'] as const).map((p) => {
        const mine = this.accounts.filter((a) => a.provider === p);
        return h('button', { class: `cw-type${mine.length ? ' is-on' : ''}`, type: 'button', attrs: { disabled: !this.available[p] }, on: { click: () => void this.start(p) } },
          this.logo(p),
          h('span', { class: 'cw-type__txt' }, h('b', { text: INFO[p].name() }), h('small', { text: INFO[p].desc() }),
            mine.length ? h('span', { class: 'cw-type__list' }, ...mine.map((a) => h('em', { text: `✓ ${a.label}` }))) : null,
            !this.available[p] ? h('small', { class: 'cw-muted', text: tr('Não instalado neste servidor.') }) : null),
          h('span', { class: 'cw-type__go', text: mine.length ? tr('Adicionar outra') : tr('Conectar') }));
      })));
  }

  /** Passo 2: abrir o link e (Claude) colar o código, ou (Codex/GitHub) confirmar o código no site. */
  private login(): HTMLElement {
    const p = this.provider!;
    const job = this.job;
    const intro = h('div', { class: 'cw-who' }, this.logo(p), h('div', {}, h('b', { text: INFO[p].name() }), h('small', { text: INFO[p].desc() })));
    if (!job || job.state === 'starting' || !job.url) return h('div', { class: 'cw-body' }, intro, h('div', { class: 'cw-wait' }, h('span', { class: 'cw-spin' }), h('span', { text: tr('Preparando o login…') })));
    const open = h('a', { class: 'cw-btn cw-btn--primary', attrs: { href: job.url, target: '_blank', rel: 'noopener noreferrer' }, text: p === 'claude' ? tr('Abrir a página da Anthropic') : p === 'codex' ? tr('Abrir a página da OpenAI') : tr('Abrir a página do GitHub') });
    if (job.needsPaste) {
      const input = h('input', { class: 'cw-input', attrs: { placeholder: tr('Cole aqui o código que a página mostrou'), autocomplete: 'off', spellcheck: 'false' } });
      const send = h('button', { class: 'cw-btn cw-btn--primary', type: 'button', text: tr('Confirmar'), on: { click: async () => {
        send.disabled = true;
        try {
          await call('POST', `/api/cloud/connect/${job.id}/code`, { code: input.value.trim() });
        } catch (e) {
          this.err = (e as Error).message;
          send.disabled = false;
          this.draw();
        }
      } } });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) send.click();
      });
      return h('div', { class: 'cw-body' }, intro,
        h('ol', { class: 'cw-todo' },
          h('li', {}, h('b', { text: tr('Abra a página e entre na sua conta.') }), open),
          h('li', {}, h('b', { text: tr('Copie o código que aparece no fim e cole aqui.') }), h('div', { class: 'cw-row' }, input, send))));
    }
    const copy = h('button', { class: 'cw-btn', type: 'button', text: tr('Copiar'), on: { click: () => void navigator.clipboard?.writeText(job.code ?? '').then(() => (copy.textContent = tr('Copiado'))) } });
    return h('div', { class: 'cw-body' }, intro,
      h('ol', { class: 'cw-todo' },
        h('li', {}, h('b', { text: tr('Copie este código:') }), h('div', { class: 'cw-row' }, h('code', { class: 'cw-code', text: job.code ?? '' }), copy)),
        h('li', {}, h('b', { text: tr('Abra a página, entre na conta e cole o código.') }), open),
        h('li', {}, h('b', { text: tr('Volte aqui: a conexão termina sozinha.') }), h('div', { class: 'cw-wait' }, h('span', { class: 'cw-spin' }), h('span', { text: tr('Esperando você confirmar no site…') })))));
  }

  /** Passo 3: deu certo ou não. */
  private done(): HTMLElement {
    const ok = this.job?.state === 'done' && !this.err;
    const p = this.provider;
    return h('div', { class: 'cw-body cw-done' },
      h('span', { class: `cw-big ${ok ? 'is-ok' : 'is-bad'}`, text: ok ? '✓' : '!' }),
      h('b', { text: ok ? tr('{0} conectado', [p ? INFO[p].name() : '']) : tr('Não deu para conectar') }),
      h('p', { class: 'cw-sub', text: ok ? tr('Os agentes já podem usar esta conta.') : this.job?.error || this.err || tr('Tente de novo.') }),
      h('div', { class: 'cw-row' },
        h('button', { class: 'cw-btn', type: 'button', text: tr('Conectar outra'), on: { click: () => this.open() } }),
        h('button', { class: 'cw-btn cw-btn--primary', type: 'button', text: tr('Concluir'), on: { click: () => this.close() } })));
  }
}
