// Página GitHub do modo Painel e os gráficos da Visão geral: projetos git (branch, alterações, commits a enviar, link do
// repositório), a conta do GitHub conectada, clonar repositórios (Cloud) e as barras de tokens e commits por dia.
// Dados de GET /api/dash/activity (server/http/app.ts), lidos a cada minuto enquanto o painel está aberto.
import { access } from '../net/access';
import { tr } from '../../../shared/i18n';
import { h } from './dom';
import { formatTokens, relativeTime } from './format';

export interface Project { name: string; path: string; branch: string; dirty: number; ahead: number | null; lastCommitAt: number; lastCommit: string; url?: string; commits: number[] }
export interface Activity { days: { day: string; tokens: number; workMs: number; sessions: number }[]; projects: Project[]; github: { login: string; name: string; avatar: string } | null; ghAvailable: boolean }

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag: string, attrs: Record<string, string | number>) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

/** Rótulo curto do dia (ex.: "09/11"). */
const dayLabel = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;

/**
 * Barras verticais de uma série (uma cor, sem legenda: o título do cartão diz o que é). Cada barra tem uma área de toque
 * da altura toda e a dica com o dia e o valor; o maior valor e o de hoje ganham rótulo direto.
 */
export function barChart(values: number[], labels: string[], color: string, fmt: (n: number) => string, unit: string): HTMLElement {
  const W = 560, H = 160, top = 18, bottom = 22, n = values.length;
  const max = Math.max(1, ...values);
  const step = W / n, bw = Math.max(6, Math.min(26, step - 8));
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'dash-chart__svg', role: 'img', 'aria-label': `${unit}: ${values.map((v, i) => `${labels[i]} ${fmt(v)}`).join(', ')}` });
  for (const f of [0.5, 1]) root.append(svg('line', { x1: 0, x2: W, y1: top + (H - top - bottom) * (1 - f), y2: top + (H - top - bottom) * (1 - f), class: 'dash-chart__grid' }));
  root.append(svg('line', { x1: 0, x2: W, y1: H - bottom, y2: H - bottom, class: 'dash-chart__base' }));
  const tip = h('div', { class: 'dash-chart__tip', hidden: true });
  const best = values.indexOf(max);
  values.forEach((v, i) => {
    const x = i * step + (step - bw) / 2;
    const bh = v ? Math.max(3, (H - top - bottom) * (v / max)) : 0;
    const y = H - bottom - bh;
    const g = svg('g', { class: 'dash-chart__col' });
    if (bh) g.append(svg('path', { d: `M${x},${H - bottom} V${y + 4} Q${x},${y} ${x + 4},${y} H${x + bw - 4} Q${x + bw},${y} ${x + bw},${y + 4} V${H - bottom} Z`, fill: color, class: 'dash-chart__bar' }));
    const hit = svg('rect', { x: i * step, y: 0, width: step, height: H, fill: 'transparent' });
    g.append(hit);
    if (i % 2 === (n - 1) % 2) {
      const t = svg('text', { x: x + bw / 2, y: H - 6, class: 'dash-chart__x', 'text-anchor': 'middle' });
      t.textContent = labels[i]!;
      g.append(t);
    }
    if (v && (i === best || i === n - 1)) {
      const t = svg('text', { x: x + bw / 2, y: y - 5, class: 'dash-chart__val', 'text-anchor': 'middle' });
      t.textContent = fmt(v);
      g.append(t);
    }
    g.addEventListener('pointerenter', () => {
      tip.replaceChildren(h('b', { text: fmt(v) }), h('span', { text: ` ${unit} · ${labels[i]}` }));
      tip.hidden = false;
      tip.style.left = `${((i + 0.5) / n) * 100}%`;
      g.classList.add('is-hover');
    });
    g.addEventListener('pointerleave', () => {
      tip.hidden = true;
      g.classList.remove('is-hover');
    });
    root.append(g);
  });
  return h('div', { class: 'dash-chart' }, root, tip);
}

export class GithubData {
  data: Activity | null = null;
  err = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private loading = false;
  msg = '';
  remote: { name: string; private: boolean; cloned: boolean }[] | null = null;

  constructor(private invalidate: () => void) {}

  key(): string {
    const d = this.data;
    return d ? `${d.projects.map((p) => `${p.path}:${p.dirty}:${p.ahead}:${p.lastCommitAt}`).join(',')}|${d.days.map((x) => x.tokens).join(',')}|${d.github?.login}|${this.msg}|${this.remote?.length}` : `-${this.err}`;
  }

  active(on: boolean): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!on) return;
    void this.load();
    this.timer = setInterval(() => void this.load(), 60_000);
  }

  async load(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const r = await fetch(`/api/dash/activity?tz=${encodeURIComponent(tz)}`, { credentials: 'same-origin', cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      this.data = j;
      this.err = '';
    } catch (e) {
      this.err = (e as Error).message || tr('Não deu certo.');
    }
    this.loading = false;
    this.invalidate();
  }

  private async post(url: string, body: unknown): Promise<unknown> {
    const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j as { error?: string }).error || tr('Não deu certo.'));
    return j;
  }

  /** Os dois gráficos da Visão geral. */
  charts(): HTMLElement | null {
    const d = this.data;
    if (!d) return null;
    const labels = d.days.map((x) => dayLabel(x.day));
    const commits = d.days.map((_, i) => d.projects.reduce((n, p) => n + (p.commits[i] ?? 0), 0));
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    const card = (title: string, total: string, sub: string, chart: HTMLElement) =>
      h('section', { class: 'dash-card dash-chartcard' }, h('div', { class: 'dash-card__head' }, h('h2', { text: title }), h('small', { class: 'dash-muted', text: sub })), h('b', { class: 'dash-chartcard__total', text: total }), chart);
    return h('div', { class: 'dash-cols dash-cols--even' },
      d.days.length ? card(tr('Uso de tokens'), formatTokens(sum(d.days.map((x) => x.tokens))), tr('últimos {0} dias', [d.days.length]), barChart(d.days.map((x) => x.tokens), labels, 'var(--d-s1)', formatTokens, tr('tokens'))) : null,
      card(tr('Commits'), String(sum(commits)), tr('{0} projetos · últimos {1} dias', [d.projects.length, labels.length]), barChart(commits, labels, 'var(--d-s3)', (n) => String(n), tr('commits'))));
  }

  page(header: (title: string, sub: string, ...right: (HTMLElement | null)[]) => HTMLElement, openCloud: () => void, newSession?: (path: string) => void): HTMLElement {
    const d = this.data;
    const head = header(tr('GitHub'), tr('Seus projetos, o que mudou e o que falta enviar.'),
      h('button', { class: 'dash-btn', type: 'button', text: tr('Atualizar'), on: { click: () => void this.load() } }));
    if (!d) return h('div', { class: 'dash-page' }, head, h('section', { class: 'dash-card dash-empty' }, h('p', { text: this.err || tr('Lendo os projetos…') })));
    const admin = access().admin || (access().local && !access().remote);
    const gh = d.github;
    const account = h('section', { class: 'dash-card dash-gh-account' },
      gh?.avatar ? h('img', { class: 'dash-gh-avatar', attrs: { src: gh.avatar, alt: '', width: 48, height: 48, referrerpolicy: 'no-referrer' } }) : h('span', { class: 'dash-gh-avatar dash-gh-avatar--empty' }),
      h('div', { class: 'dash-gh-who' },
        h('b', { text: gh ? gh.name : tr('GitHub não conectado') }),
        h('small', { text: gh ? `@${gh.login} · ${tr('os agentes usam esta conta para git push e PRs')}` : d.ghAvailable ? tr('Conecte para clonar repositórios e para os agentes enviarem código.') : tr('O GitHub CLI (gh) não está instalado neste servidor.') })),
      gh ? h('a', { class: 'dash-btn', attrs: { href: `https://github.com/${gh.login}`, target: '_blank', rel: 'noopener' }, text: tr('Abrir perfil') }) : null,
      access().cloud ? h('button', { class: `dash-btn${gh ? '' : ' dash-btn--primary'}`, type: 'button', text: gh ? tr('Contas') : tr('Conectar GitHub'), on: { click: openCloud } }) : null,
      access().cloud && gh ? h('button', { class: 'dash-btn', type: 'button', text: tr('Clonar repositório'), on: { click: () => void this.loadRemote() } }) : null);

    const totals = d.projects.reduce((t, p) => ({ dirty: t.dirty + (p.dirty ? 1 : 0), ahead: t.ahead + (p.ahead ?? 0), commits: t.commits + p.commits.reduce((a, b) => a + b, 0) }), { dirty: 0, ahead: 0, commits: 0 });
    const stat = (label: string, value: string, hint: string, tone = '') => h('div', { class: `dash-stat ${tone}` }, h('span', { text: label }), h('b', { text: value }), h('small', { text: hint }));
    const now = Date.now();
    const rows = d.projects.map((p) => {
      const spark = h('span', { class: 'dash-spark', attrs: { 'aria-label': tr('{0} commits em 14 dias', [p.commits.reduce((a, b) => a + b, 0)]) } }, ...p.commits.map((c) => h('i', { style: `height:${c ? Math.min(100, 20 + c * 16) : 8}%`, class: c ? 'is-on' : '' })));
      return h('div', { class: 'dash-repo' },
        h('div', { class: 'dash-repo__main' },
          h('div', { class: 'dash-repo__top' }, h('b', { text: p.name }), h('code', { text: p.branch }),
            p.dirty ? h('span', { class: 'dash-badge is-warn', text: tr('{0} alterados', [p.dirty]) }) : null,
            p.ahead ? h('span', { class: 'dash-badge is-blue', text: tr('{0} a enviar', [p.ahead]) }) : null,
            p.ahead === null ? h('span', { class: 'dash-badge', text: tr('sem upstream') }) : null),
          h('small', { text: p.lastCommit ? `${p.lastCommit} · ${relativeTime(p.lastCommitAt, now)}` : tr('sem commits') })),
        spark,
        h('div', { class: 'dash-repo__act' },
          newSession ? h('button', { class: 'dash-btn', type: 'button', text: tr('Abrir agente'), title: tr('Abre o Claude Code nesta pasta'), on: { click: () => newSession(p.path) } }) : null,
          p.url ? h('a', { class: 'dash-btn', attrs: { href: p.url, target: '_blank', rel: 'noopener' }, text: tr('GitHub ↗') }) : null,
          admin && p.url ? h('button', { class: 'dash-btn', type: 'button', text: tr('Puxar'), title: tr('git pull: traz o que está no GitHub (só avança, nunca faz merge)'), on: { click: () => {
            this.msg = tr('Atualizando {0}…', [p.name]);
            this.invalidate();
            this.post('/api/dash/pull', { path: p.path }).then(() => (this.msg = tr('{0} atualizado.', [p.name])), (e: Error) => (this.msg = e.message)).finally(() => void this.load());
          } } }) : null));
    });
    const remote = this.remote ? h('section', { class: 'dash-card' }, h('div', { class: 'dash-card__head' }, h('h2', { text: tr('Repositórios no GitHub') }), h('button', { class: 'dash-link', type: 'button', text: tr('Fechar'), on: { click: () => { this.remote = null; this.invalidate(); } } })),
      h('div', { class: 'dash-list' }, ...this.remote.map((r) => h('div', { class: 'dash-agent dash-agent--static' },
        h('span', { class: 'dash-agent__main' }, h('span', { class: 'dash-agent__top' }, h('b', { text: r.name }), r.private ? h('span', { class: 'dash-badge', text: tr('privado') }) : null)),
        r.cloned ? h('span', { class: 'dash-status is-working', text: tr('Já clonado') }) : h('button', { class: 'dash-btn', type: 'button', text: tr('Clonar'), on: { click: () => {
          this.msg = tr('Clonando {0}…', [r.name]);
          this.invalidate();
          this.post('/api/cloud/github/clone', { repo: r.name }).then((x) => {
            this.msg = tr('Clonado em {0}.', [(x as { dir: string }).dir]);
            r.cloned = true;
          }, (e: Error) => (this.msg = e.message)).finally(() => void this.load());
        } } }))))) : null;

    return h('div', { class: 'dash-page' }, head, account,
      this.msg ? h('p', { class: 'dash-muted', text: this.msg }) : null,
      remote,
      h('section', { class: 'dash-stats' },
        stat(tr('Projetos'), String(d.projects.length), tr('com git nesta máquina')),
        stat(tr('Commits'), String(totals.commits), tr('últimos 14 dias')),
        stat(tr('Com alterações'), String(totals.dirty), tr('arquivos ainda sem commit'), totals.dirty ? 'is-warn' : ''),
        stat(tr('A enviar'), String(totals.ahead), tr('commits sem push'), totals.ahead ? 'is-live' : '')),
      this.charts(),
      h('section', { class: 'dash-card dash-repos' }, h('h2', { text: tr('Projetos') }),
        rows.length ? h('div', { class: 'dash-repo-list' }, ...rows) : h('p', { class: 'dash-muted', text: tr('Nenhum projeto com git ainda. Clone um repositório ou abra um agente numa pasta com git.') })));
  }

  private async loadRemote(): Promise<void> {
    this.msg = tr('Buscando seus repositórios…');
    this.invalidate();
    try {
      const r = await fetch('/api/cloud/github/repos', { credentials: 'same-origin' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      this.remote = j.repos;
      this.msg = '';
    } catch (e) {
      this.msg = (e as Error).message;
    }
    this.invalidate();
  }
}
