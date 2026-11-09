// Página "IA local" do modo Painel: instalar o Ollama no servidor, escolher modelos leves que cabem na memória, ver o
// consumo e testar uma pergunta. Conversa com /api/ai (server/ai/local.ts); só admin ou o próprio computador.
import { access } from '../net/access';
import { tr } from '../../../shared/i18n';
import { h } from './dom';

interface CatalogModel { id: string; name: string; use: string; sizeGb: number; ramGb: number; code?: boolean }
interface AiStatus {
  system: { platform: string; arch: string; cpus: number; cpuModel: string; load: number; ramTotal: number; ramFree: number; disk: { free: number; total: number } | null };
  ollama: { installed: boolean; running: boolean; version: string | null; package: string | null };
  models: { name: string; size: number }[];
  loaded: { name: string; size: number }[];
  catalog: CatalogModel[];
  recommended: string;
  job: { kind: 'install' | 'pull'; model?: string; status: string; percent?: number; error?: string; done: boolean } | null;
}

const gb = (bytes: number) => `${(bytes / 1e9).toFixed(bytes < 10e9 ? 1 : 0)} GB`;

export class AiPage {
  private st: AiStatus | null = null;
  private err = '';
  private loading = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private test: { model: string; prompt: string; busy: boolean; out?: string; meta?: string } = { model: '', prompt: tr('Escreva uma função em JavaScript que inverte uma string.'), busy: false };

  constructor(private invalidate: () => void, private header: (title: string, sub: string) => HTMLElement) {}

  /** Muda quando a página precisa redesenhar. */
  key(): string {
    const j = this.st?.job;
    return `${this.err}|${this.st ? `${this.st.ollama.running}|${this.st.models.length}|${this.st.loaded.length}|${Math.round(this.st.system.ramFree / 1e9)}|${j?.status}|${j?.percent}|${j?.done}` : '-'}|${this.test.busy}|${this.test.out?.length}`;
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

  page(): HTMLElement {
    const head = this.header(tr('IA local'), tr('Modelos de IA rodando no seu servidor, sem conta e sem custo por uso. Leves, só com CPU.'));
    if (!(access().admin || (access().local && !access().remote))) {
      return h('div', { class: 'dash-page' }, head, h('section', { class: 'dash-card dash-empty' }, h('h2', { text: tr('Só para admins') }), h('p', { text: tr('Peça a um admin para instalar a IA local.') })));
    }
    const st = this.st;
    if (!st) return h('div', { class: 'dash-page' }, head, h('section', { class: 'dash-card dash-empty' }, h('p', { text: this.err || tr('Lendo o servidor…') })));
    const s = st.system;
    const ramUsed = s.ramTotal - s.ramFree;
    const meter = (label: string, used: number, total: number, text: string) => {
      const pct = total ? Math.min(100, Math.round((used / total) * 100)) : 0;
      return h('div', { class: `dash-stat dash-meter${pct >= 85 ? ' is-warn' : ''}` }, h('span', { text: label }), h('b', { text }),
        h('div', { class: 'dash-bar__track' }, h('i', { style: `width:${pct}%` })), h('small', { text: `${pct}%` }));
    };
    const job = st.job;
    const jobEl = job && (!job.done || job.error) ? h('section', { class: `dash-card dash-job${job.error ? ' is-bad' : ''}` },
      h('div', { class: 'dash-card__head' }, h('h2', { text: job.kind === 'install' ? tr('Instalando o Ollama') : tr('Baixando {0}', [job.model ?? '']) }), h('small', { class: 'dash-muted', text: job.error ? tr('falhou') : `${job.percent ?? 0}%` })),
      job.error ? h('p', { class: 'dash-bad', text: job.error }) : h('div', { class: 'dash-bar' }, h('div', { class: 'dash-bar__track' }, h('i', { style: `width:${job.percent ?? 0}%` })), h('small', { text: job.status }))) : null;
    const working = !!job && !job.done;

    const engine = st.ollama.running
      ? h('div', { class: 'dash-engine is-on' }, h('span', { class: 'dash-engine__dot' }), h('div', {}, h('b', { text: tr('Ollama {0} rodando', [st.ollama.version ?? '']) }), h('small', { text: tr('Só dentro do servidor (127.0.0.1:11434). Os modelos ficam na pasta de dados do DevLand.') })))
      : h('div', { class: 'dash-engine' }, h('span', { class: 'dash-engine__dot' }), h('div', {},
          h('b', { text: st.ollama.installed ? tr('Ollama instalado, parado') : tr('Ollama ainda não está instalado') }),
          h('small', { text: st.ollama.package ? tr('O motor que roda os modelos. Baixa do GitHub do Ollama ({0}) e fica na pasta de dados: sobrevive às atualizações.', [st.ollama.package.includes('linux') ? '~1,5 GB' : '~185 MB']) : tr('Sem pacote pronto para este sistema.') })),
          st.ollama.package && !st.ollama.installed ? h('button', { class: 'dash-btn dash-btn--primary', type: 'button', attrs: { disabled: working }, text: tr('Instalar o Ollama'), on: { click: () => this.act(() => this.post('/api/ai/install')) } }) : null);

    const have = new Set(st.models.map((m) => m.name));
    const ramGb = s.ramTotal / 1e9;
    const catalog = h('div', { class: 'dash-models' }, ...st.catalog.map((m) => {
      const installed = have.has(m.id) || have.has(`${m.id}:latest`);
      const fits = m.ramGb <= ramGb * 0.7;
      return h('div', { class: `dash-model${installed ? ' is-in' : ''}${fits ? '' : ' is-heavy'}` },
        h('div', { class: 'dash-model__top' }, h('b', { text: m.name }), m.id === st.recommended ? h('span', { class: 'dash-badge is-admin', text: tr('Recomendado') }) : null, m.code ? h('span', { class: 'dash-badge', text: tr('código') }) : null),
        h('p', { text: m.use }),
        h('div', { class: 'dash-model__foot' },
          h('small', { class: fits ? 'dash-muted' : 'dash-bad', text: `${m.sizeGb.toLocaleString()} GB · ${tr('{0} GB de RAM', [m.ramGb])}${fits ? '' : ` · ${tr('pesado para este servidor')}`}` }),
          installed ? h('span', { class: 'dash-status is-working', text: tr('Instalado') })
            : h('button', { class: 'dash-btn', type: 'button', attrs: { disabled: working || !st.ollama.installed }, text: tr('Baixar'), on: { click: () => this.act(() => this.post('/api/ai/pull', { model: m.id })) } })));
    }));

    const loadedSet = new Set(st.loaded.map((m) => m.name));
    const mine = st.models.length ? h('div', { class: 'dash-list' }, ...st.models.map((m) => h('div', { class: 'dash-agent dash-agent--static' },
      h('span', { class: 'dash-agent__main' }, h('span', { class: 'dash-agent__top' }, h('b', { text: m.name }), loadedSet.has(m.name) ? h('span', { class: 'dash-status is-working', text: tr('Na memória') }) : null), h('span', { class: 'dash-agent__act', text: gb(m.size) })),
      h('button', { class: 'dash-link dash-link--bad', type: 'button', text: tr('Remover'), on: { click: () => confirm(tr('Remover o modelo {0}?', [m.name])) && this.act(() => this.post(`/api/ai/models/${encodeURIComponent(m.name)}`, undefined, 'DELETE')) } }))))
      : h('p', { class: 'dash-muted', text: tr('Nenhum modelo baixado ainda. Comece pelo recomendado.') });

    if (!this.test.model || !have.has(this.test.model)) this.test.model = st.models[0]?.name ?? '';
    const select = h('select', { attrs: { 'aria-label': tr('Modelo') }, on: { change: (e) => (this.test.model = (e.target as HTMLSelectElement).value) } }, ...st.models.map((m) => h('option', { attrs: { value: m.name, selected: m.name === this.test.model }, text: m.name })));
    const prompt = h('textarea', { attrs: { rows: 3, 'aria-label': tr('Pergunta') }, on: { input: (e) => (this.test.prompt = (e.target as HTMLTextAreaElement).value) } });
    prompt.value = this.test.prompt;
    const run = () => {
      this.test.busy = true;
      this.test.out = undefined;
      this.invalidate();
      this.post('/api/ai/test', { model: this.test.model, prompt: this.test.prompt }).then((r) => {
        const x = r as { text: string; tokensPerS: number; seconds: number };
        this.test.out = x.text;
        this.test.meta = tr('{0} tokens/s · {1} s no total', [x.tokensPerS, x.seconds]);
      }, (e: Error) => {
        this.test.out = e.message;
        this.test.meta = '';
      }).finally(() => {
        this.test.busy = false;
        this.invalidate();
      });
    };
    const tester = st.models.length ? h('section', { class: 'dash-card dash-tester' }, h('h2', { text: tr('Testar') }),
      h('div', { class: 'dash-tester__row' }, select, h('button', { class: 'dash-btn dash-btn--primary', type: 'button', attrs: { disabled: this.test.busy }, text: this.test.busy ? tr('Pensando…') : tr('Perguntar'), on: { click: run } })),
      prompt,
      this.test.out !== undefined ? h('div', { class: 'dash-tester__out' }, h('pre', { text: this.test.out }), this.test.meta ? h('small', { class: 'dash-muted', text: this.test.meta }) : null) : null) : null;

    return h('div', { class: 'dash-page' }, head,
      this.err ? h('p', { class: 'dash-bad', text: this.err }) : null,
      h('section', { class: 'dash-stats' },
        meter(tr('Memória'), ramUsed, s.ramTotal, `${gb(ramUsed)} / ${gb(s.ramTotal)}`),
        meter(tr('CPU'), s.load, s.cpus, tr('{0} núcleos', [s.cpus])),
        s.disk ? meter(tr('Disco'), s.disk.total - s.disk.free, s.disk.total, tr('{0} livres', [gb(s.disk.free)])) : null,
        h('div', { class: 'dash-stat' }, h('span', { text: tr('Na memória agora') }), h('b', { text: st.loaded.length ? gb(st.loaded.reduce((n, m) => n + m.size, 0)) : '0' }), h('small', { text: st.loaded.map((m) => m.name).join(', ') || tr('nenhum modelo carregado') }))),
      h('section', { class: 'dash-card' }, engine),
      jobEl,
      h('div', { class: 'dash-cols' },
        h('section', { class: 'dash-card' }, h('h2', { text: tr('Seus modelos') }), mine),
        tester ?? h('section', { class: 'dash-card' }, h('h2', { text: tr('Como usar') }), h('p', { class: 'dash-muted', text: tr('Instale o Ollama, baixe um modelo e teste aqui. Os agentes e outros programas do servidor usam pelo endereço http://127.0.0.1:11434.') }))),
      h('section', { class: 'dash-card' }, h('div', { class: 'dash-card__head' }, h('h2', { text: tr('Modelos leves') }), h('small', { class: 'dash-muted', text: tr('Recomendado para {0} de RAM', [gb(s.ramTotal)]) })), catalog));
  }
}
