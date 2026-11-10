// Barra de ferramentas da conversa (modo Painel): trocar o modelo do agente, abrir a prévia do site e enviar o trabalho
// ao GitHub, sem sair da conversa.
//  - Modelo: se o agente roda num terminal do DevLand, digita `/model <apelido>` nele (troca na hora); senão assume a
//    sessão com `claude --resume --model <apelido>` (a mesma conversa continua, no modelo novo).
//  - Prévia: abre a janela de prévia ao vivo (ui/preview.ts).
//  - Enviar: commit das alterações (se houver e você der uma mensagem) e `git push` da branch, ou abrir o PR
//    (/api/dash/push e /api/dash/pr; server/github/projects.ts). Só admin (Cloud) ou o próprio computador.
import { MODEL_IDS, type ModelId } from '../../../shared/models';
import type { AgentInfo } from '../../../shared/types';
import { tr } from '../../../shared/i18n';
import { access } from '../net/access';
import { h, setHidden, setText } from './dom';
import { sendPtyInput } from './ptyapi';

export interface ChatToolsHooks {
  openPreview(): void;
  /** Terminal interativo do DevLand desta sessão, se houver. */
  ptyOf(agentId: string): { id: string } | undefined;
  /** Assume a sessão (encerra a de lá) e continua a conversa aqui no modelo pedido. */
  takeover(agentId: string, model: ModelId): Promise<void>;
  announce(text: string): void;
  /** Manda uma mensagem ao agente desta conversa. */
  sendText(text: string): Promise<void>;
  /** Abre um agente novo na pasta do projeto, já com o pedido digitado. */
  openIn(path: string, text: string): Promise<void>;
}

interface ProjectView {
  files: { status: string; path: string }[];
  prs: { number: number; title: string; branch: string; url: string; checks?: 'ok' | 'fail' | 'pending' | 'none' }[];
  info: { branch: string; dirty: number; ahead: number | null; url?: string } | null;
}

const NAMES: Record<ModelId, string> = { fable: 'Fable', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' };

/** "claude-sonnet-5-5" -> "Sonnet"; nome que não é de nenhuma família fica como veio. */
export function modelName(model: string | undefined): string {
  const m = /(fable|opus|sonnet|haiku)/i.exec(model ?? '');
  return m ? NAMES[m[1]!.toLowerCase() as ModelId] : model || tr('Modelo');
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw Object.assign(new Error(json.error ?? tr('Não deu certo.')), { detail: (json as { detail?: string }).detail });
  return json;
}

export class ChatTools {
  readonly el: HTMLElement;
  private readonly modelBtn: HTMLButtonElement;
  private readonly modelMenu: HTMLElement;
  private readonly pushBtn: HTMLButtonElement;
  private readonly pushBox: HTMLElement;
  private readonly previewBtn: HTMLButtonElement;
  private agent: AgentInfo | undefined;
  private project = '';
  private busy = false;

  constructor(private readonly hooks: ChatToolsHooks) {
    this.modelBtn = h('button', { class: 'ui-btn ui-ctool', type: 'button', attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, title: tr('Trocar o modelo do agente'), on: { click: () => this.toggle(this.modelMenu) } }) as HTMLButtonElement;
    this.modelMenu = h('div', { class: 'ui-ctool__menu', role: 'menu', hidden: true });
    this.previewBtn = h('button', { class: 'ui-btn ui-ctool', type: 'button', text: tr('Prévia'), title: tr('Abre o site do projeto ao lado, ao vivo'), on: { click: () => this.hooks.openPreview() } }) as HTMLButtonElement;
    this.pushBtn = h('button', { class: 'ui-btn ui-ctool', type: 'button', text: tr('Enviar'), title: tr('Enviar o trabalho ao GitHub (push ou PR)'), attrs: { 'aria-haspopup': 'dialog' }, on: { click: () => void this.togglePush() } }) as HTMLButtonElement;
    this.pushBox = h('div', { class: 'ui-ctool__menu ui-ctool__push', role: 'dialog', hidden: true });
    this.el = h(
      'div',
      { class: 'ui-ctools' },
      h('div', { class: 'ui-ctool__wrap' }, this.modelBtn, this.modelMenu),
      this.previewBtn,
      h('div', { class: 'ui-ctool__wrap' }, this.pushBtn, this.pushBox),
    );
    document.addEventListener('click', (e) => {
      if (!this.el.contains(e.target as Node)) this.closeMenus();
    });
    this.renderModelMenu();
  }

  /** Chamado a cada quadro: agente e projeto da conversa aberta. */
  update(agent: AgentInfo | undefined, projectPath: string | undefined): void {
    if (agent?.id !== this.agent?.id) this.closeMenus();
    this.agent = agent;
    this.project = projectPath ?? '';
    const admin = access().admin || (access().local && !access().remote);
    setText(this.modelBtn, `${modelName(agent?.model)} ▾`);
    setHidden(this.modelBtn.parentElement!, !agent || !admin || agent.provider === 'codex');
    setHidden(this.previewBtn, !agent || !this.project);
    setHidden(this.pushBtn.parentElement!, !agent || !admin || !this.project);
  }

  private closeMenus(): void {
    for (const m of [this.modelMenu, this.pushBox]) setHidden(m, true);
    this.modelBtn.setAttribute('aria-expanded', 'false');
  }

  private toggle(menu: HTMLElement): void {
    const open = menu.hidden;
    this.closeMenus();
    setHidden(menu, !open);
    if (menu === this.modelMenu) this.modelBtn.setAttribute('aria-expanded', String(open));
  }

  private renderModelMenu(): void {
    this.modelMenu.replaceChildren(
      ...MODEL_IDS.map((id) => h('button', { class: 'ui-ctool__item', type: 'button', role: 'menuitem', text: NAMES[id], on: { click: () => void this.pick(id) } })),
      h('p', { class: 'ui-ctool__note', text: tr('No terminal do DevLand troca na hora. Em outro terminal, a sessão é assumida aqui e a conversa continua no modelo escolhido.') }),
    );
  }

  private async pick(id: ModelId): Promise<void> {
    const a = this.agent;
    if (!a || this.busy) return;
    this.closeMenus();
    this.busy = true;
    try {
      const pty = this.hooks.ptyOf(a.id);
      if (pty) {
        await sendPtyInput(pty.id, `/model ${id}\r`);
        this.hooks.announce(tr('Modelo trocado para {0}.', [NAMES[id]]));
      } else if (confirm(tr('Trocar para {0}? A sessão é encerrada no outro terminal e a mesma conversa continua aqui no DevLand.', [NAMES[id]]))) {
        await this.hooks.takeover(a.id, id);
      }
    } catch (err) {
      this.hooks.announce((err as Error).message);
    } finally {
      this.busy = false;
    }
  }

  private async togglePush(): Promise<void> {
    const open = this.pushBox.hidden;
    this.closeMenus();
    if (!open) return;
    setHidden(this.pushBox, false);
    this.pushBox.replaceChildren(h('p', { class: 'ui-ctool__note', text: tr('Lendo o projeto…') }));
    try {
      const p = await call<ProjectView>('GET', `/api/dash/project?path=${encodeURIComponent(this.project)}`);
      this.renderPush(p);
    } catch (err) {
      this.pushBox.replaceChildren(h('p', { class: 'ui-ctool__note is-bad', text: (err as Error).message }));
    }
  }

  private renderPush(p: ProjectView): void {
    const info = p.info;
    const dirty = p.files.length;
    const msg = h('input', { class: 'ui-ctool__msg', type: 'text', attrs: { placeholder: tr('Mensagem do commit'), maxlength: 300 } }) as HTMLInputElement;
    const out = h('p', { class: 'ui-ctool__note', role: 'status', hidden: true });
    const say = (text: string, bad = false, href?: string) => {
      setHidden(out, false);
      out.classList.toggle('is-bad', bad);
      out.replaceChildren(href ? h('a', { attrs: { href, target: '_blank', rel: 'noopener noreferrer' }, text }) : document.createTextNode(text));
    };
    const run = async (btn: HTMLButtonElement, job: () => Promise<void>) => {
      btn.disabled = true;
      try {
        await job();
      } catch (err) {
        say((err as Error).message, true);
      } finally {
        btn.disabled = false;
      }
    };
    const main = info && (info.branch === 'main' || info.branch === 'master');
    const push = h('button', { class: 'ui-btn ui-btn--accent', type: 'button', text: dirty ? tr('Salvar e enviar') : tr('Enviar (push)') }) as HTMLButtonElement;
    push.addEventListener('click', () => {
      if (dirty && !msg.value.trim()) return say(tr('Escreva a mensagem do commit.'), true);
      if (main && !confirm(tr('Enviar direto para a branch {0}?', [info!.branch]))) return;
      void run(push, async () => {
        const r = await call<{ branch: string; committed: number }>('POST', '/api/dash/push', { path: this.project, message: msg.value });
        say(r.committed ? tr('Enviado: {0} arquivo(s) salvos e a branch {1} no GitHub.', [r.committed, r.branch]) : tr('Enviado: a branch {0} está no GitHub.', [r.branch]));
      });
    });
    const pr = h('button', { class: 'ui-btn', type: 'button', text: tr('Abrir PR'), title: tr('Envia a branch e abre o pull request'), attrs: { disabled: !!main } }) as HTMLButtonElement;
    pr.addEventListener('click', () =>
      void run(pr, async () => {
        const r = await call<{ url: string }>('POST', '/api/dash/pr', { path: this.project });
        say(tr('PR aberto: {0}', [r.url]), false, r.url);
      }),
    );
    const kind = (st: string) => (st === '??' || st === 'A' ? ['novo', tr('novo')] : st === 'D' ? ['del', tr('removido')] : ['mod', tr('alterado')]) as [string, string];
    const checkDot: Record<string, [string, string]> = { ok: ['ok', tr('CI ok')], fail: ['fail', tr('CI falhou')], pending: ['pending', tr('CI rodando')], none: ['none', ''] };
    const section = (title: string, ...kids: (Node | null)[]) => h('div', { class: 'ui-ctool__sec' }, h('h4', { class: 'ui-ctool__h', text: title }), ...kids.filter((n): n is Node => !!n));
    const prCard = (x: ProjectView['prs'][number]) => {
      const merge = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Mesclar'), title: tr('Mescla este PR na branch principal (merge commit)') }) as HTMLButtonElement;
      merge.addEventListener('click', () => {
        if (!confirm(tr('Mesclar o PR #{0} ({1}) na branch principal?', [x.number, x.title]))) return;
        void run(merge, async () => {
          try {
            await call('POST', '/api/dash/merge', { path: this.project, number: x.number });
          } catch (err) {
            const detail = (err as { detail?: string }).detail;
            say(detail ? `${(err as Error).message}\n${detail}` : (err as Error).message, true);
            const fix = h('button', { class: 'ui-btn ui-btn--accent', type: 'button', text: tr('Pedir ao agente para resolver'), title: tr('Manda o erro ao agente na conversa') }) as HTMLButtonElement;
            fix.addEventListener('click', () => {
              fix.disabled = true;
              void this.hooks
                .sendText(tr('O merge do PR #{0} ({1}, branch {2}) falhou. Motivo do GitHub: {3}\n\nResolva: traga a main para a branch do PR (merge ou rebase), resolva os conflitos, rode os testes e dê push da branch. Não faça merge na main: eu mesclo pelo botão Mesclar do DevLand.', [x.number, x.title, x.branch, detail || tr('conflito ou checagens pendentes')]))
                .then(() => (fix.textContent = tr('Enviado ao agente')));
            });
            out.append(h('div', { class: 'ui-ctool__row' }, fix));
            return;
          }
          card.classList.add('is-done');
          merge.remove();
          say(tr('PR #{0} mesclado.', [x.number]));
        });
      });
      const [cls, label] = checkDot[x.checks ?? 'none'] ?? checkDot.none!;
      const card = h('div', { class: 'ui-ctool__pr' }, h('div', { class: 'ui-ctool__prtext' }, h('a', { attrs: { href: x.url, target: '_blank', rel: 'noopener noreferrer' }, text: `#${x.number} ${x.title}` }), h('small', { text: [x.branch, label].filter(Boolean).join(' · ') })), h('i', { class: `ui-ctool__dot is-${cls}`, attrs: { 'aria-hidden': 'true' } }), merge);
      return card;
    };
    const stats = [dirty ? tr('{0} arquivo(s) com alterações', [dirty]) : tr('sem alterações novas'), info?.ahead ? tr('{0} commit(s) para enviar', [info.ahead]) : ''].filter(Boolean).join(' · ');
    const parts: (Node | null)[] = [
      h('div', { class: 'ui-ctool__row' }, h('span', { class: 'ui-ctool__branch', text: `⎇ ${info?.branch ?? tr('sem branch')}` }), info?.url ? h('a', { attrs: { href: info.url, target: '_blank', rel: 'noopener noreferrer' }, text: tr('Abrir no GitHub') }) : null),
      h('p', { class: 'ui-ctool__note', text: stats }),
      dirty
        ? section(
            tr('Alterações'),
            h('ul', { class: 'ui-ctool__files' }, ...[...p.files.slice(0, 8).map((f) => { const [c, t] = kind(f.status); return h('li', {}, h('b', { class: `ui-ctool__tag is-${c}`, text: t }), h('span', { text: f.path })); }), ...(p.files.length > 8 ? [h('li', { class: 'ui-ctool__more', text: tr('e mais {0}…', [p.files.length - 8])})] : [])]),
            msg,
          )
        : null,
      h('div', { class: 'ui-ctool__row ui-ctool__actions' }, push, pr),
      p.prs.length ? section(tr('Pull requests abertos'), ...p.prs.slice(0, 4).map(prCard)) : null,
      out,
    ];
    this.pushBox.replaceChildren(...parts.filter((n): n is Node => !!n));
  }
}
