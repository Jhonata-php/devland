// Versão do Habblaud: o número na barra superior, o selo "Nova versão" quando o GitHub tem uma release mais
// nova (quem consulta é o servidor, server/updates/checker.ts), o aviso único por versão e a seção "Sobre"
// das configurações (estado da verificação, "Verificar agora", novidades e como atualizar).
import type { Notice, OfficeSnapshot, UpdateStatus } from '../../../shared/types';
import type { UiComponent, UiContext } from './context';
import { h, setAttr, setHidden, setText, setTitle, setVariant } from './dom';
import { viewportReport } from './scrolllock';
import { formatDateTime, relativeTime } from './format';
import { pixelIcon } from './icons';
import { safeLocalStorage } from './prefs';
import { access } from '../net/access';
import { tr } from '../../../shared/i18n';

/** Última versão nova já avisada neste navegador (o aviso sai uma vez por versão). */
export const UPDATE_SEEN_KEY = 'habblaud:update-seen';

export const VERSION_ICONS = {
  up: pixelIcon(['...##...', '..####..', '.######.', '########', '..####..', '..####..', '..####..', '..####..']),
};

/** Versão em uso e o resultado da verificação, do snapshot ao vivo (no timelapse e no ?mock=1 não há versão real). */
export function versionInfo(snap: OfficeSnapshot | null | undefined): { version: string; updates?: UpdateStatus } | null {
  const v = snap?.meta.version;
  if (!v || !/^\d+\.\d+\.\d+/.test(v)) return null;
  return { version: v, updates: snap.meta.updates };
}

/** Só links do próprio GitHub viram link na página. */
export function safeGithubUrl(url: string | undefined): string | undefined {
  return url && /^https:\/\/github\.com\/[^\s"'<>]+$/.test(url) ? url : undefined;
}

export type UpdateTone = 'new' | 'ok' | 'pending' | 'warn' | 'off';

/** Linha de estado da seção "Sobre". */
export function updateStatusLine(version: string, s: UpdateStatus | undefined, now: number): { tone: UpdateTone; text: string } {
  if (!s) return { tone: 'off', text: tr('Este servidor não verifica versões novas.') };
  const checked = s.checkedAt ? ` · verificado ${relativeTime(s.checkedAt, now)}` : '';
  switch (s.state) {
    case 'off':
      return {
        tone: 'off',
        text: s.repo
          ? tr('Verificação de versão nova desligada (HABBLAUD_UPDATE_CHECK=0).')
          : tr('Verificação de versão nova desligada: o package.json não aponta um repositório no GitHub.'),
      };
    case 'pending':
      return { tone: 'pending', text: tr('Verificando se há versão nova…') };
    case 'error':
      if (s.available && s.latest) return { tone: 'new', text: tr('Nova versão disponível: v{0}. A última verificação falhou ({1}).', [s.latest, s.error ?? tr('erro')]) };
      return { tone: 'warn', text: tr('Não deu para verificar agora: {0}{1}.', [s.error ?? tr('erro desconhecido'), s.checkedAt ? tr(' · última verificação {0}', [relativeTime(s.checkedAt, now)]) : '']) };
    case 'ok':
      if (s.available && s.latest) return { tone: 'new', text: tr('Nova versão disponível: v{0}{1}.', [s.latest, s.publishedAt ? tr(', publicada em {0}', [formatDateTime(s.publishedAt)]) : '']) };
      if (!s.latest) return { tone: 'ok', text: tr('Nenhuma versão publicada no GitHub ainda{0}.', [checked]) };
      if (s.latest !== version) return { tone: 'ok', text: tr('Você está à frente da última versão publicada (v{0}){1}.', [s.latest, checked]) };
      return { tone: 'ok', text: tr('Você está na versão mais recente{0}.', [checked]) };
  }
}

/** Dica do número de versão na barra superior. */
export function versionChipTitle(version: string, s: UpdateStatus | undefined, now: number): string {
  if (s?.available && s.latest) return tr('Nova versão do DevLand: v{0} (você usa a v{1}). Clique para ver as novidades e como atualizar.', [s.latest, version]);
  return tr('DevLand v{0}. {1} Clique para ver detalhes.', [version, updateStatusLine(version, s, now).text]);
}

/** Número da versão na barra superior; vira o selo "Nova versão" quando há release mais nova. */
export class VersionChip implements UiComponent {
  readonly el: HTMLButtonElement;
  private text: HTMLElement;

  constructor(
    private ctx: UiContext,
    private settingsBtn: HTMLElement,
  ) {
    const icon = h('span', { class: 'ui-version__icon', attrs: { 'aria-hidden': 'true' } });
    icon.innerHTML = VERSION_ICONS.up;
    this.text = h('span', { class: 'ui-version__text' });
    this.el = h('button', { class: 'ui-version', type: 'button', hidden: true, on: { click: () => ctx.openAbout() } }, icon, this.text);
  }

  render(): void {
    const info = versionInfo(this.ctx.store.liveSnapshot);
    setHidden(this.el, !info);
    const fresh = !!info?.updates?.available && !!info.updates.latest;
    this.settingsBtn.classList.toggle('has-update', fresh);
    const label = fresh ? tr('Configurações (nova versão disponível)') : tr('Configurações');
    setAttr(this.settingsBtn, 'aria-label', label);
    setTitle(this.settingsBtn, label);
    if (!info) return;
    this.el.classList.toggle('is-new', fresh);
    setText(this.text, fresh ? tr('Nova versão') : `v${info.version}`);
    const title = versionChipTitle(info.version, info.updates, this.ctx.now());
    setTitle(this.el, title);
    setAttr(this.el, 'aria-label', title);
  }
}

/** Avisa (uma vez por versão, neste navegador) quando aparece uma versão nova. */
export class UpdateToaster implements UiComponent {
  constructor(
    private ctx: UiContext,
    private push: (n: Notice) => void,
  ) {}

  private shown: string | undefined;

  render(): void {
    if (this.ctx.store.connection !== 'open') return;
    const s = versionInfo(this.ctx.store.liveSnapshot)?.updates;
    if (!s?.available || !s.latest || this.shown === s.latest) return;
    this.shown = s.latest;
    const storage = safeLocalStorage();
    try {
      if (storage?.getItem(UPDATE_SEEN_KEY) === s.latest) return;
      storage?.setItem(UPDATE_SEEN_KEY, s.latest);
    } catch {
      // Sem armazenamento: avisa uma vez por página aberta.
    }
    this.push({ id: `update:${s.latest}`, level: 'success', text: tr('Nova versão do DevLand: v{0}. Veja as novidades e como atualizar em Configurações › Sobre.', [s.latest]), at: this.ctx.now() });
  }
}

/** Seção "Sobre" das configurações. */
export class AboutGroup {
  readonly el: HTMLElement;
  private name: HTMLElement;
  private status: HTMLElement;
  private checkBtn: HTMLButtonElement;
  private diag: HTMLButtonElement;
  private fresh: HTMLElement;
  private notes: HTMLAnchorElement;
  private repo: HTMLAnchorElement;
  private checking = false;
  private failure: string | undefined;
  private applyBtn: HTMLButtonElement;
  private applyNote: HTMLElement;
  private howTo: HTMLElement;
  private cfg: HTMLDetailsElement;
  private cfgUrl: HTMLInputElement;
  private cfgToken: HTMLInputElement;
  private cfgProject: HTMLInputElement;
  private cfgMsg: HTMLElement;
  private cfgBusy = false;
  private autoRow: HTMLElement;
  private autoBox: HTMLInputElement;
  private autoWin: HTMLSelectElement;
  private autoBusy = false;
  private applying = false;
  private applyError: string | undefined;

  constructor(private ctx: UiContext) {
    this.name = h('strong', { class: 'ui-about__version' });
    this.checkBtn = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Verificar agora'), on: { click: () => void this.check() } });
    this.status = h('p', { class: 'ui-about__status', role: 'status' });
    this.notes = h('a', { class: 'ui-link-btn', attrs: { target: '_blank', rel: 'noopener noreferrer' } });
    this.applyBtn = h('button', { class: 'ui-btn ui-btn--sm ui-btn--accent', type: 'button', text: tr('Atualizar agora'), on: { click: () => void this.apply() } });
    this.applyNote = h('p', { class: 'ui-set__hint', role: 'status', hidden: true });
    this.fresh = h(
      'div',
      { class: 'ui-about__new', hidden: true },
      this.notes,
      this.applyBtn,
      this.applyNote,
      (this.howTo = h(
        'p',
        { class: 'ui-set__hint' },
        tr('Para atualizar, na pasta do DevLand: '),
        h('code', { class: 'ui-usage-setup__cmd', text: 'git pull' }),
        tr(' e de novo '),
        h('code', { class: 'ui-usage-setup__cmd', text: 'npm run docker:up' }),
        tr(' (sem Docker: '),
        h('code', { class: 'ui-usage-setup__cmd', text: 'npm run build && npm start' }),
        ').',
      )),
    );
    this.autoBox = h('input', { type: 'checkbox', on: { change: () => void this.saveAuto() } }) as HTMLInputElement;
    this.autoWin = h(
      'select',
      { class: 'ui-about__win', on: { change: () => void this.saveAuto() } },
      h('option', { attrs: { value: 'night' }, text: tr('De madrugada (2h às 5h)') }),
      h('option', { attrs: { value: 'any' }, text: tr('A qualquer hora') }),
    ) as HTMLSelectElement;
    this.autoRow = h(
      'div',
      { class: 'ui-about__auto', hidden: true },
      h('label', { class: 'ui-about__autolabel' }, this.autoBox, h('span', { text: tr('Atualizar sozinho quando sair versão nova') })),
      this.autoWin,
      h('p', { class: 'ui-set__hint', text: tr('O DevLand reinicia na atualização; as conversas abertas voltam sozinhas.') }),
    );
    const field = (label: string, input: HTMLInputElement) => h('label', { class: 'ui-about__field' }, h('span', { class: 'ui-set__hint', text: label }), input);
    this.cfgUrl = h('input', { class: 'ui-rename__input', type: 'url', attrs: { placeholder: 'https://velix.suaempresa.com', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'none' } }) as HTMLInputElement;
    this.cfgToken = h('input', { class: 'ui-rename__input', type: 'password', attrs: { placeholder: 'vlx_…', autocomplete: 'off', spellcheck: 'false' } }) as HTMLInputElement;
    this.cfgProject = h('input', { class: 'ui-rename__input', type: 'text', attrs: { value: 'devland', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'none' } }) as HTMLInputElement;
    this.cfgMsg = h('p', { class: 'ui-set__hint', role: 'status', hidden: true });
    this.cfg = h(
      'details',
      { class: 'ui-about__cfg', hidden: true },
      h('summary', { text: tr('Atualizar por aqui: ligar ao Velix') }),
      h('p', { class: 'ui-set__hint', text: tr('No Velix, crie um token em Configurações › Assistentes de IA (escopo escrita) e cole aqui. Fica guardado só neste servidor.') }),
      field(tr('Endereço do Velix'), this.cfgUrl),
      field(tr('Token de API'), this.cfgToken),
      field(tr('Projeto no Velix'), this.cfgProject),
      h('button', { class: 'ui-btn ui-btn--sm ui-btn--accent', type: 'button', text: tr('Salvar'), on: { click: () => void this.saveCfg() } }),
      this.cfgMsg,
    ) as HTMLDetailsElement;
    this.diag = h('button', { class: 'ui-link-btn', type: 'button', text: tr('Diagnóstico da tela'), on: { click: () => window.alert(viewportReport()) } });
    this.repo = h('a', { class: 'ui-link-btn', text: tr('Código no GitHub'), attrs: { target: '_blank', rel: 'noopener noreferrer' } });
    this.el = h(
      'div',
      { class: 'ui-set-group ui-about', attrs: { id: 'ui-about' } },
      h('h3', { text: tr('Sobre'), tabIndex: -1 }),
      h('div', { class: 'ui-about__head' }, h('span', { class: 'ui-about__name' }, 'DevLand ', this.name), this.checkBtn),
      this.status,
      this.fresh,
      this.autoRow,
      this.cfg,
      h('div', { class: 'ui-about__links' }, this.diag, this.repo),
    );
  }

  render(): void {
    const info = versionInfo(this.ctx.store.liveSnapshot);
    setHidden(this.el, !info);
    if (!info) return;
    const s = info.updates;
    setText(this.name, `v${info.version}`);
    const line = this.failure ? { tone: 'warn' as const, text: this.failure } : updateStatusLine(info.version, s, this.ctx.now());
    setText(this.status, this.checking ? tr('Consultando o GitHub…') : line.text);
    setVariant(this.status, 'is-', this.checking ? 'pending' : line.tone);
    setHidden(this.checkBtn, !s || s.state === 'off');
    this.checkBtn.disabled = this.checking || this.ctx.store.connection !== 'open';

    const fresh = !!s?.available && !!s.latest;
    setHidden(this.fresh, !fresh);
    // Cloud: o admin atualiza por aqui (o servidor pede ao Velix); sem isso, valem as instruções de terminal.
    const canApply = fresh && !!s?.canApply;
    const working = this.applying || !!s?.applyingSince;
    const cloud = !!access().cloud;
    // Cloud sem botão (versão ainda sem como atualizar por aqui): a caixa verde ficaria vazia.
    if (cloud && !canApply) setHidden(this.fresh, true);
    setHidden(this.howTo, canApply || cloud);
    setHidden(this.autoRow, !(s?.canApply && s.auto && access().admin));
    if (s?.auto && !this.autoBusy) {
      this.autoBox.checked = s.auto.enabled;
      this.autoWin.value = s.auto.window;
      setHidden(this.autoWin, !s.auto.enabled);
    }
    setHidden(this.cfg, !(s?.needsImage && s.canConfigure && access().admin));
    setHidden(this.applyBtn, !canApply || working);
    setHidden(this.applyNote, !(canApply && (working || this.applyError)));
    setText(this.applyNote, working ? tr('Atualizando: o DevLand baixa a versão nova e reinicia sozinho em alguns minutos. A página recarrega quando voltar.') : (this.applyError ?? ''));
    if (fresh) {
      setText(this.notes, tr('Ver o que mudou na v{0}', [s!.latest]));
      const url = safeGithubUrl(s!.url);
      setHidden(this.notes, !url);
      if (url) setAttr(this.notes, 'href', url);
    }
    const repoUrl = s?.repo ? safeGithubUrl(`https://github.com/${s.repo}`) : undefined;
    setHidden(this.repo, !repoUrl);
    if (repoUrl) setAttr(this.repo, 'href', repoUrl);
  }

  /** Rola até a seção e a destaca por um instante (clique no número da versão). */
  highlight(): void {
    this.el.scrollIntoView({ block: 'nearest' });
    this.el.classList.remove('is-highlight');
    void this.el.offsetWidth;
    this.el.classList.add('is-highlight');
  }

  private async saveAuto(): Promise<void> {
    if (this.autoBusy) return;
    this.autoBusy = true;
    setHidden(this.autoWin, !this.autoBox.checked);
    await this.ctx.store.setAutoUpdate({ enabled: this.autoBox.checked, window: this.autoWin.value === 'any' ? 'any' : 'night', tz: new Date().getTimezoneOffset() });
    this.autoBusy = false;
    this.ctx.invalidate();
  }

  private async saveCfg(): Promise<void> {
    if (this.cfgBusy) return;
    this.cfgBusy = true;
    setText(this.cfgMsg, tr('Salvando…'));
    setHidden(this.cfgMsg, false);
    const r = await this.ctx.store.configureUpdates({ url: this.cfgUrl.value, token: this.cfgToken.value, project: this.cfgProject.value });
    this.cfgBusy = false;
    if (r.ok) {
      this.cfgToken.value = '';
      setText(this.cfgMsg, tr('Pronto: o botão Atualizar agora aparece quando houver versão nova.'));
    } else setText(this.cfgMsg, tr('Não deu para salvar: {0}', [r.error || tr('sem resposta do servidor')]));
    this.ctx.invalidate();
  }

  private async apply(): Promise<void> {
    if (this.applying) return;
    this.applying = true;
    this.applyError = undefined;
    this.render();
    const r = await this.ctx.store.applyUpdate();
    if (!r.ok) {
      this.applying = false;
      this.applyError = tr('Não deu para atualizar: {0}', [r.error || tr('sem resposta do servidor')]);
    } else {
      // O DevLand reinicia e a página recarrega sozinha; se nada mudar em 3 min, volta o botão.
      setTimeout(() => {
        this.applying = false;
        this.render();
      }, 180_000);
    }
    this.render();
    this.ctx.invalidate();
  }

  private async check(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    this.failure = undefined;
    this.render();
    try {
      if (!(await this.ctx.store.checkUpdates())) this.failure = tr('Não deu para falar com o servidor do DevLand.');
    } catch {
      this.failure = tr('Não deu para falar com o servidor do DevLand.');
    } finally {
      this.checking = false;
      this.render();
      this.ctx.invalidate();
    }
  }
}
