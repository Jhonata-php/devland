// Novo agente (botão na barra do topo): começa uma sessão do Claude Code em segundo plano no Mac, na pasta escolhida e
// com o pedido (POST /api/spawn; server/spawn/spawn.ts). As pastas são os projetos recentes do computador
// (GET /api/spawn/folders: histórico de sessões + salas), para escolher com um toque; "Outra pasta" aceita um caminho
// digitado. O pedido pode levar anexos (POST /api/spawn/attachments, um por arquivo, antes do pedido) e ser ditado
// (ui/dictation.ts, Whisper local no Mac). Pasta que o Claude Code não conhece cai no app (Enter lá).
import { MODEL_IDS, type ModelId } from '../../../shared/models';
import { ROLE_IDS, ROLES, type RoleId } from '../../../shared/roles';
import { roleLabel } from './roles';
import { tr } from '../../../shared/i18n';
import { isDemoId } from '../../../shared/timeline';
import type { AccountInfo, OfficeSnapshot } from '../../../shared/types';
import type { UiContext } from './context';
import { DictationButton, dictationAvailable, insertDictation } from './dictation';
import { h, iconButton, pastedFiles, setHidden, setStyleVar, setText } from './dom';
import { ICONS } from './icons';
import { createAccountChip, updateAccountChip } from './widgets';

export const SPAWN_PROMPT_MAX = 8_000;
export const MAX_FILES = 8;
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
const POLL_MS = 700;
/**
 * Quanto a página espera o pedido abrir: mais que o servidor leva para desistir (fila 30 s + `claude --bg` e `open`,
 * 50 s; server/spawn/spawn.ts), para nunca dizer "não confirmou" de algo que ainda vai abrir.
 */
const WAIT_MS = 90_000;
const LAST_FOLDER_KEY = 'devland.spawn.folder';

interface SpawnInfo {
  id: string;
  status: 'queued' | 'sent' | 'opened' | 'failed';
  error?: string;
  how?: 'cli' | 'app';
  note?: string;
}

export interface FolderOption {
  path: string;
  name: string;
  lastAt: number;
  sessions?: number;
}

/** Pastas das salas, da mais recente para a mais antiga (reserva quando o servidor não manda a lista). */
export function spawnFolders(snap: Pick<OfficeSnapshot, 'rooms' | 'agents'> | null | undefined): string[] {
  if (!snap) return [];
  const last = new Map<string, number>();
  for (const a of snap.agents) last.set(a.roomId, Math.max(last.get(a.roomId) ?? 0, a.lastEventAt ?? 0));
  const paths = [...snap.rooms]
    .filter((r) => !isDemoId(r.id) && /^(\/|[A-Za-z]:[\\/])/.test(r.path ?? ''))
    // Cloud: a raiz /workspace só guarda os projetos clonados, não é um projeto.
    .filter((r) => r.path.replace(/\/+$/, '') !== '/workspace')
    .sort((a, b) => (last.get(b.id) ?? 0) - (last.get(a.id) ?? 0))
    .map((r) => r.path);
  return [...new Set(paths)];
}

/** Caminho curto para a lista: a pasta pessoal vira "~". */
export function shortPath(path: string): string {
  return path.replace(/^\/(Users|home)\/[^/]+(?=\/|$)/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/i, '~');
}

/** "agora", "5 min", "3 h", "2 d" (vazio sem horário). */
export function ago(at: number, now = Date.now()): string {
  if (!at) return '';
  const min = Math.max(0, Math.round((now - at) / 60_000));
  if (min < 1) return tr('agora');
  if (min < 60) return `${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

function fileToBase64(file: Blob): Promise<string> {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => fail(new Error(tr('não deu para ler o arquivo')));
    r.readAsDataURL(file);
  });
}

interface ScheduleView {
  id: string;
  folder: string;
  prompt: string;
  time: string;
  days: number[];
  enabled: boolean;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init });
  } catch {
    throw new Error(tr('o DevLand não respondeu'));
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? tr('erro {0}', [res.status]));
  return body;
}

/** Sobe um arquivo para o depósito de anexos e devolve o id (o "Novo agente" e a caixa de mensagem usam o mesmo). */
export async function uploadAttachment(file: File): Promise<string> {
  const r = await api<{ id: string }>('/api/spawn/attachments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, type: file.type, data: await fileToBase64(file) }),
  });
  return r.id;
}

function readPref(): string {
  try {
    return localStorage.getItem(LAST_FOLDER_KEY) ?? '';
  } catch {
    return '';
  }
}

function writePref(path: string): void {
  try {
    localStorage.setItem(LAST_FOLDER_KEY, path);
  } catch {
    // sem armazenamento: só não lembra
  }
}

interface PendingFile {
  file: File;
  url?: string;
  el: HTMLElement;
}

export class SpawnPanel {
  readonly el: HTMLElement;
  /** Chamado com o agente novo assim que ele aparece no escritório (a página abre a conversa dele). */
  onStarted?: (agentId: string) => void;
  /** Aviso visível (toast) para quando o modal já fechou. */
  onNotice?: (text: string, level: 'success' | 'warn') => void;
  private readonly folderList: HTMLElement;
  private readonly otherBtn: HTMLButtonElement;
  private readonly folder: HTMLInputElement;
  private readonly prompt: HTMLTextAreaElement;
  private readonly fileInput: HTMLInputElement;
  private readonly fileList: HTMLElement;
  private readonly dictate: DictationButton;
  private readonly submitBtn: HTMLButtonElement;
  private readonly status: HTMLElement;
  // Agendar: repetir o pedido nos dias e no horário escolhidos (server/schedule/schedules.ts).
  private readonly repeat: HTMLInputElement;
  private readonly repeatBox: HTMLElement;
  private readonly timeInput: HTMLInputElement;
  private readonly dayRow: HTMLElement;
  private readonly schedList: HTMLElement;
  private days = new Set<number>([1, 2, 3, 4, 5]);
  private anchor?: HTMLElement;
  private busy = false;
  private folders: FolderOption[] = [];
  private selected = '';
  /** Conta escolhida ('' = Automática: o servidor usa a de mais folga). */
  private account = '';
  /** Passo do assistente: 1 quem trabalha (conta ou IA local), 2 projeto, 3 função e pedido. */
  private step = 1;
  private readonly steps: HTMLElement[] = [];
  private readonly stepper: HTMLElement;
  private readonly backBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly engineRow: HTMLElement;
  /** Função do agente ('' = sem função: o DevLand deduz pelos arquivos e pelo projeto). */
  private role: RoleId | '' = '';
  /** Modelo do Claude (vazio = o padrão da conta); some com a IA local, que usa o modelo dela. */
  private model: ModelId | '' = '';
  private readonly modelLabel: HTMLElement;
  private readonly modelRow: HTMLElement;
  private readonly roleRow: HTMLElement;
  private readonly accountRow: HTMLElement;
  private readonly accountLabel: HTMLElement;
  private typing = false;
  private files: PendingFile[] = [];

  constructor(private readonly ctx: UiContext) {
    this.folderList = h('div', { class: 'ui-spawn__folders', role: 'radiogroup', attrs: { 'aria-label': tr('Projetos recentes') } });
    this.otherBtn = h('button', { class: 'ui-spawn__other', type: 'button', on: { click: () => this.showOther(true) } }, tr('+ Outra pasta'));
    this.folder = h('input', {
      class: 'ui-rename__input ui-spawn__path',
      type: 'text',
      hidden: true,
      attrs: { id: 'ui-spawn-folder', placeholder: '/Users/voce/projeto', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'none', 'aria-label': tr('Caminho da pasta') },
    });
    this.prompt = h('textarea', {
      class: 'ui-rename__input ui-spawn__prompt',
      attrs: { id: 'ui-spawn-prompt', rows: 5, maxlength: SPAWN_PROMPT_MAX, placeholder: tr('O que o agente deve fazer (opcional)') },
    });
    this.fileInput = h('input', { type: 'file', hidden: true, attrs: { multiple: true, 'aria-hidden': 'true', tabindex: '-1' } });
    // Colar uma imagem no pedido (print, foto copiada) vira anexo, como pelo botão Anexar.
    this.prompt.addEventListener('paste', (e) => {
      const files = pastedFiles(e);
      if (!files.length) return;
      if (!e.clipboardData?.getData('text')) e.preventDefault();
      this.addFiles(files);
    });
    this.fileInput.addEventListener('change', () => {
      this.addFiles([...(this.fileInput.files ?? [])]);
      this.fileInput.value = '';
    });
    const attachBtn = h('button', { class: 'ui-btn ui-spawn__attach', type: 'button', attrs: { title: tr('Anexar imagens ou arquivos ao pedido') }, on: { click: () => this.fileInput.click() } });
    const clip = h('span', { attrs: { 'aria-hidden': 'true' } });
    clip.innerHTML = ICONS.attach;
    attachBtn.append(clip, h('span', { text: tr('Anexar') }));
    this.dictate = new DictationButton(
      (t) => {
        const { value, caret } = insertDictation(this.prompt.value, this.prompt.selectionStart ?? this.prompt.value.length, this.prompt.selectionEnd ?? this.prompt.value.length, t.text);
        this.prompt.value = value.slice(0, SPAWN_PROMPT_MAX);
        this.prompt.setSelectionRange(caret, caret);
      },
      (text, error) => this.say(text, error),
    );
    setHidden(this.dictate.el, true);
    this.accountLabel = h('p', { class: 'ui-spawn__label', text: tr('Conta') });
    this.accountRow = h('div', { class: 'ui-spawn__accounts', role: 'radiogroup', attrs: { 'aria-label': tr('Conta') } });
    this.roleRow = h('div', { class: 'ui-spawn__accounts ui-spawn__roles', role: 'radiogroup', attrs: { 'aria-label': tr('Função') } });
    this.renderRoles();
    this.modelLabel = h('p', { class: 'ui-spawn__label', text: tr('Modelo') });
    this.modelRow = h('div', { class: 'ui-spawn__accounts ui-spawn__models', role: 'radiogroup', attrs: { 'aria-label': tr('Modelo') } });
    this.renderModels();
    this.fileList = h('ul', { class: 'ui-spawn__files', attrs: { 'aria-label': tr('Anexos') } });
    this.submitBtn = h('button', { class: 'ui-btn ui-perm__btn ui-perm__btn--allow ui-spawn__go', type: 'button', on: { click: () => void this.submit() } }, tr('Começar'));
    this.status = h('p', { class: 'ui-rename__hint ui-spawn__status', attrs: { role: 'status', 'aria-live': 'polite' } });
    this.repeat = h('input', { type: 'checkbox', on: { change: () => this.syncRepeat() } });
    this.timeInput = h('input', { class: 'ui-rename__input ui-spawn__time', type: 'time', attrs: { 'aria-label': tr('Horário'), value: '09:00' } });
    this.timeInput.value = '09:00';
    this.dayRow = h('div', { class: 'ui-spawn__accounts ui-spawn__days', role: 'group', attrs: { 'aria-label': tr('Dias') } });
    this.renderDays();
    this.repeatBox = h('div', { class: 'ui-spawn__repeat', hidden: true }, this.timeInput, this.dayRow);
    this.schedList = h('div', { class: 'ui-spawn__scheds', hidden: true });
    for (const field of [this.folder, this.prompt] as HTMLElement[]) {
      field.addEventListener('keydown', (e: KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void this.submit();
        }
      });
      field.addEventListener('keyup', (e) => e.stopPropagation());
    }
    this.folder.addEventListener('input', () => {
      this.selected = this.folder.value.trim();
      this.renderFolders();
    });
    this.engineRow = h('div', { class: 'ui-spawn__engines', role: 'radiogroup', attrs: { 'aria-label': tr('Quem vai fazer o trabalho?') } });
    this.stepper = h('ol', { class: 'ui-spawn__stepper' }, ...[tr('Quem trabalha'), tr('Projeto'), tr('Pedido')].map((t, i) => h('li', { attrs: { 'data-step': i + 1 } }, h('i', { text: String(i + 1) }), h('span', { text: t }))));
    this.backBtn = h('button', { class: 'ui-btn ui-spawn__back', type: 'button', text: tr('Voltar'), on: { click: () => this.showStep(this.step - 1) } });
    this.nextBtn = h('button', { class: 'ui-btn ui-btn--accent ui-spawn__next', type: 'button', text: tr('Próximo passo'), on: { click: () => this.showStep(this.step + 1) } });
    const close = iconButton(ICONS.close, tr('Fechar'), () => this.hide(), 'ui-icon-btn--sm');
    this.el = h(
      'div',
      { class: 'ui-popover ui-spawn', role: 'dialog', tabIndex: -1, attrs: { 'aria-label': tr('Novo agente'), id: 'ui-spawn', popover: 'auto' } },
      h('div', { class: 'ui-popover__head' }, h('h2', { text: tr('Novo agente') }), close),
      this.stepper,
      h(
        'div',
        { class: 'ui-set-group ui-spawn__body' },
        this.stepEl(1, h('p', { class: 'ui-spawn__label', text: tr('Quem vai fazer o trabalho?') }), this.engineRow, this.accountLabel, this.accountRow),
        this.stepEl(2, h('p', { class: 'ui-spawn__label', attrs: { id: 'ui-spawn-folders-label' }, text: tr('Em qual projeto?') }), this.folderList, this.otherBtn, this.folder),
        this.stepEl(3, h('p', { class: 'ui-spawn__label', text: tr('Função') }),
        this.roleRow,
        this.modelLabel,
        this.modelRow,
        h('label', { class: 'ui-spawn__label', attrs: { for: 'ui-spawn-prompt' }, text: tr('Pedido') }),
        this.prompt,
        h('div', { class: 'ui-spawn__tools' }, this.dictate.el, attachBtn, this.fileInput),
        this.fileList,
        h('p', { class: 'ui-rename__hint', text: tr('Começa na hora uma sessão do Claude Code em segundo plano no computador, na pasta escolhida; as permissões chegam aqui. Pasta que o Claude Code ainda não conhece abre no app do Claude e espera o Enter lá. Anexos vão para a pasta de anexos do DevLand e o pedido leva os caminhos.') }),
        h('label', { class: 'ui-spawn__repeat-toggle' }, this.repeat, ' ', tr('Repetir em dias e horário (agendar)')),
        this.repeatBox,
        this.status,
        this.schedList),
      ),
      h('div', { class: 'ui-spawn__nav' }, this.backBtn, this.nextBtn, this.submitBtn),
    );
    this.showStep(1);
    this.el.addEventListener('toggle', () => {
      this.anchor?.setAttribute('aria-expanded', String(this.isOpen));
      if (!this.isOpen) this.dictate.cancel();
    });
  }

  get isOpen(): boolean {
    try {
      return this.el.matches(':popover-open');
    } catch {
      return this.el.classList.contains('is-open');
    }
  }

  toggle(anchor: HTMLElement): void {
    this.anchor = anchor;
    if (this.isOpen) return this.hide();
    // Primeiro com o que o escritório já sabe; a lista do servidor (histórico) chega logo depois.
    if (!this.folders.length) this.setFolders(spawnFolders(this.ctx.store.snapshot).map((path) => ({ path, name: path.split(/[\\/]/).pop() || path, lastAt: 0 })));
    this.showStep(1);
    this.renderAccounts();
    void this.loadFolders();
    void this.loadLocalModel();
    void this.checkDictation();
    void this.loadSchedules();
    if (!this.busy) setText(this.status, '');
    const r = anchor.getBoundingClientRect();
    this.el.style.top = `${Math.round(r.bottom + 8)}px`;
    this.el.style.right = `${Math.max(8, Math.round(innerWidth - r.right - 4))}px`;
    if (typeof this.el.showPopover === 'function') this.el.showPopover();
    else this.el.classList.add('is-open');
    anchor.setAttribute('aria-expanded', 'true');
    // No celular, focar o campo abriria o teclado por cima da lista de projetos.
    if (!matchMedia('(pointer: coarse)').matches) this.prompt.focus();
  }

  hide(): void {
    this.dictate.cancel();
    if (typeof this.el.hidePopover === 'function' && this.isOpen) this.el.hidePopover();
    this.el.classList.remove('is-open');
    this.anchor?.setAttribute('aria-expanded', 'false');
  }

  /** "Automática" + uma opção por conta do Claude Code; some quando há uma só (não há o que escolher). */
  /** "Automática" + uma ficha por função (ui/roles.ts). */
  private renderRoles(): void {
    const opts: Array<[RoleId | '', string, string]> = [['', tr('Automática'), ''], ...ROLE_IDS.map((id): [RoleId, string, string] => [id, roleLabel(id), ROLES[id].icon])];
    this.roleRow.replaceChildren(
      ...opts.map(([id, name, icon]) => {
        const b = h('button', { class: 'ui-btn ui-spawn__acc ui-func', type: 'button', role: 'radio', attrs: { 'aria-checked': String(this.role === id) }, text: icon ? `${icon} ${name}` : name });
        if (id) setStyleVar(b, '--func', ROLES[id].color);
        b.classList.toggle('is-on', this.role === id);
        b.addEventListener('click', () => {
          this.role = id;
          // Revisão: o pedido é opcional (o servidor usa o roteiro de revisão completo).
          this.prompt.placeholder = id === 'review' ? tr('Opcional: deixe vazio e o agente roda o projeto, testa o fluxo e relata as falhas') : tr('O que o agente deve fazer (opcional)');
          this.renderRoles();
        });
        return b;
      }),
    );
  }

  /** "Padrão da conta" + um apelido por família (Fable, Opus, Sonnet, Haiku); só vale para contas do Claude. */
  private renderModels(): void {
    const names: Record<ModelId, [string, string]> = {
      fable: ['Fable', tr('o mais recente')],
      opus: ['Opus', tr('o mais forte para tarefas difíceis')],
      sonnet: ['Sonnet', tr('equilíbrio entre qualidade e velocidade')],
      haiku: ['Haiku', tr('o mais rápido e barato')],
    };
    const opts: Array<[ModelId | '', string, string]> = [['', tr('Padrão da conta'), tr('o que a conta usa normalmente')], ...MODEL_IDS.map((id): [ModelId, string, string] => [id, names[id][0], names[id][1]])];
    this.modelRow.replaceChildren(
      ...opts.map(([id, name, tip]) => {
        const b = h('button', { class: 'ui-btn ui-spawn__acc', type: 'button', role: 'radio', title: tip, attrs: { 'aria-checked': String(this.model === id) }, text: name });
        b.classList.toggle('is-on', this.model === id);
        b.addEventListener('click', () => {
          this.model = id;
          this.renderModels();
        });
        return b;
      }),
    );
    const local = this.account === 'ollama';
    setHidden(this.modelLabel, local);
    setHidden(this.modelRow, local);
  }

  private stepEl(n: number, ...kids: HTMLElement[]): HTMLElement {
    const el = h('div', { class: 'ui-spawn__step', attrs: { 'data-step': n } }, ...kids);
    this.steps[n - 1] = el;
    return el;
  }

  /** Mostra o passo `n` (1 a 3); o Próximo só anda com o passo atual completo. */
  private showStep(n: number): void {
    if (!this.steps.length) return;
    this.step = Math.max(1, Math.min(3, n));
    this.steps.forEach((el, i) => setHidden(el, i + 1 !== this.step));
    for (const li of this.stepper.children) {
      const k = Number((li as HTMLElement).dataset.step);
      li.classList.toggle('is-on', k === this.step);
      li.classList.toggle('is-done', k < this.step);
    }
    setHidden(this.backBtn, this.step === 1);
    setHidden(this.nextBtn, this.step === 3);
    setHidden(this.submitBtn, this.step !== 3);
    this.nextBtn.disabled = this.step === 2 && !this.selected;
    if (this.step === 3 && !matchMedia('(pointer: coarse)').matches) this.prompt.focus();
  }

  /** Passo 1: conta do Claude ou IA local, em dois cartões. */
  private renderEngines(): void {
    const local = this.account === 'ollama';
    const card = (on: boolean, title: string, sub: string, pick: () => void, disabled = false) => {
      const b = h('button', { class: `ui-spawn__engine${on ? ' is-on' : ''}`, type: 'button', role: 'radio', attrs: { 'aria-checked': String(on), disabled }, on: { click: pick } }, h('b', { text: title }), h('small', { text: sub }));
      return b;
    };
    this.engineRow.replaceChildren(
      card(!local, tr('Conta do Claude'), tr('Claude Code com a sua assinatura: o mais capaz para qualquer tarefa.'), () => { this.account = ''; this.renderAccounts(); }),
      card(local, tr('IA local'), this.localModel ? tr('Roda no seu servidor com {0}: sem gastar o plano, mais lento.', [this.localModel]) : tr('Ative a IA local e baixe um modelo na página IA local.'), () => { this.account = 'ollama'; this.renderAccounts(); }, !this.localModel),
    );
  }

  /** Modelo da conta "IA local" (do /api/ai, só admin); null = sem Ollama ou sem modelo baixado. */
  private localModel: string | null = null;

  private async loadLocalModel(): Promise<void> {
    try {
      const r = await fetch('/api/ai', { credentials: 'same-origin', cache: 'no-store' });
      this.localModel = r.ok ? (((await r.json()) as { agentModel?: string | null }).agentModel ?? null) : null;
    } catch {
      this.localModel = null;
    }
    this.renderAccounts();
  }

  private renderAccounts(): void {
    const list = (this.ctx.store.snapshot?.accounts ?? []).filter((a) => a.provider !== 'codex' && !a.configDir.endsWith('.claude-ollama'));
    if (this.account === 'ollama' && !this.localModel) this.account = '';
    this.renderEngines();
    this.renderModels();
    // Contas do Claude: só com mais de uma e com "Conta do Claude" escolhida.
    const many = list.length > 1 && this.account !== 'ollama';
    setHidden(this.accountLabel, !many);
    setHidden(this.accountRow, !many);
    if (!many) {
      if (this.account !== 'ollama') this.account = '';
      return;
    }
    if (this.account && !list.some((a) => a.id === this.account)) this.account = '';
    const opts: [string, string, AccountInfo | undefined][] = [['', tr('Automática'), undefined], ...list.map((a): [string, string, AccountInfo] => [a.id, a.name, a])];
    this.accountRow.replaceChildren(
      ...opts.map(([id, name, a]) => {
        const chip = createAccountChip('sm');
        if (a) updateAccountChip(chip, a);
        const b = h('button', { class: 'ui-btn ui-spawn__acc', type: 'button', role: 'radio', attrs: { 'aria-checked': String(this.account === id) }, on: { click: () => { this.account = id; this.renderAccounts(); } } }, ...(a ? [chip] : []), h('span', { text: name }));
        b.classList.toggle('is-on', this.account === id);
        return b;
      }),
    );
  }

  private async loadFolders(): Promise<void> {
    try {
      const r = await api<{ folders: FolderOption[] }>('/api/spawn/folders');
      if (Array.isArray(r.folders) && r.folders.length) this.setFolders(r.folders);
    } catch {
      // fica a lista das salas
    }
  }

  private async checkDictation(): Promise<void> {
    setHidden(this.dictate.el, !(await dictationAvailable()));
  }

  private setFolders(list: FolderOption[]): void {
    this.folders = list;
    if (!this.selected) {
      const pref = readPref();
      this.selected = list.some((f) => f.path === pref) ? pref : (list[0]?.path ?? '');
    }
    this.renderFolders();
  }

  private renderFolders(): void {
    const now = Date.now();
    const known = this.folders.some((f) => f.path === this.selected);
    this.folderList.replaceChildren(
      ...this.folders.map((f) => {
        const on = f.path === this.selected && !this.typing;
        const when = ago(f.lastAt, now);
        return h(
          'button',
          {
            class: `ui-spawn__folder${on ? ' is-on' : ''}`,
            type: 'button',
            role: 'radio',
            attrs: { 'aria-checked': String(on), title: f.path },
            on: { click: () => this.pick(f.path) },
          },
          h('span', { class: 'ui-spawn__folder-name', text: f.name }),
          h('span', { class: 'ui-spawn__folder-path', text: shortPath(f.path) }),
          when ? h('span', { class: 'ui-spawn__folder-when', text: when }) : null,
        );
      }),
    );
    if (!this.folders.length) this.showOther(true);
    else if (!known && this.selected && !this.typing) this.showOther(true, this.selected);
    if (this.step === 2) this.nextBtn.disabled = !this.selected;
  }

  private pick(path: string): void {
    this.selected = path;
    this.typing = false;
    setHidden(this.folder, true);
    this.otherBtn.classList.remove('is-on');
    this.renderFolders();
  }

  private showOther(on: boolean, value?: string): void {
    this.typing = on;
    setHidden(this.folder, !on);
    this.otherBtn.classList.toggle('is-on', on);
    if (on) {
      if (value !== undefined) this.folder.value = value;
      this.selected = this.folder.value.trim();
      this.folderList.querySelectorAll('.ui-spawn__folder').forEach((b) => {
        b.classList.remove('is-on');
        b.setAttribute('aria-checked', 'false');
      });
      if (value === undefined) this.folder.focus();
    }
  }

  private addFiles(list: File[]): void {
    for (const file of list) {
      if (this.files.length >= MAX_FILES) {
        this.say(tr('No máximo {0} anexos por pedido.', [MAX_FILES]), true);
        break;
      }
      if (file.size > MAX_FILE_BYTES) {
        this.say(tr('{0} passa de {1} MB.', [file.name, MAX_FILE_BYTES / 1024 / 1024]), true);
        continue;
      }
      if (!file.size) continue;
      const url = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      const item: PendingFile = { file, url, el: h('li', { class: 'ui-spawn__file' }) };
      const thumb = url ? h('img', { class: 'ui-spawn__thumb', attrs: { src: url, alt: '' } }) : h('span', { class: 'ui-spawn__thumb ui-spawn__thumb--doc', attrs: { 'aria-hidden': 'true' }, text: (file.name.split('.').pop() ?? '').slice(0, 4).toUpperCase() || tr('ARQ') });
      const remove = iconButton(ICONS.close, tr('Tirar {0}', [file.name]), () => this.removeFile(item), 'ui-icon-btn--sm ui-spawn__file-x');
      item.el.append(thumb, h('span', { class: 'ui-spawn__file-name', text: file.name, attrs: { title: file.name } }), h('span', { class: 'ui-spawn__file-size', text: formatBytes(file.size) }), remove);
      this.files.push(item);
      this.fileList.append(item.el);
    }
  }

  private removeFile(item: PendingFile): void {
    if (item.url) URL.revokeObjectURL(item.url);
    item.el.remove();
    this.files = this.files.filter((f) => f !== item);
  }

  private clearFiles(): void {
    for (const f of [...this.files]) this.removeFile(f);
  }

  private say(text: string, error = false): void {
    setText(this.status, text);
    this.status.classList.toggle('is-error', error);
  }

  private renderDays(): void {
    const names = [tr('dom'), tr('seg'), tr('ter'), tr('qua'), tr('qui'), tr('sex'), tr('sáb')];
    this.dayRow.replaceChildren(
      ...[1, 2, 3, 4, 5, 6, 0].map((d) =>
        h('button', {
          class: `ui-btn ui-spawn__acc${this.days.has(d) ? ' is-on' : ''}`,
          type: 'button',
          attrs: { 'aria-pressed': String(this.days.has(d)) },
          text: names[d],
          on: { click: () => { if (this.days.has(d)) this.days.delete(d); else this.days.add(d); this.renderDays(); } },
        }),
      ),
    );
  }

  private syncRepeat(): void {
    setHidden(this.repeatBox, !this.repeat.checked);
    setText(this.submitBtn, this.repeat.checked ? tr('Agendar') : tr('Começar'));
  }

  private async loadSchedules(): Promise<void> {
    try {
      const { schedules } = await api<{ schedules: ScheduleView[] }>('/api/schedules');
      const names = [tr('dom'), tr('seg'), tr('ter'), tr('qua'), tr('qui'), tr('sex'), tr('sáb')];
      setHidden(this.schedList, !schedules.length);
      this.schedList.replaceChildren(
        h('p', { class: 'ui-spawn__label', text: tr('Agendados') }),
        ...schedules.map((sc) => {
          const days = sc.days.length === 7 ? tr('todo dia') : sc.days.map((d) => names[d]).join(' ');
          const toggle = h('button', { class: 'ui-btn', type: 'button', text: sc.enabled ? tr('Pausar') : tr('Retomar'), on: { click: () => void this.patchSchedule(sc.id, !sc.enabled) } });
          const del = h('button', { class: 'ui-btn', type: 'button', text: tr('Apagar'), on: { click: () => void this.deleteSchedule(sc.id) } });
          return h(
            'div',
            { class: `ui-spawn__sched${sc.enabled ? '' : ' is-off'}` },
            h('div', { class: 'ui-spawn__sched-text' }, h('strong', { text: `${sc.time} · ${days}` }), h('span', { text: `${sc.folder.split(/[\\/]/).pop() || sc.folder} — ${sc.prompt}` })),
            h('div', { class: 'ui-spawn__sched-tools' }, toggle, del),
          );
        }),
      );
    } catch {
      setHidden(this.schedList, true);
    }
  }

  private async patchSchedule(id: string, enabled: boolean): Promise<void> {
    await api(`/api/schedules/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) }).catch((e: Error) => this.say(e.message, true));
    void this.loadSchedules();
  }

  private async deleteSchedule(id: string): Promise<void> {
    await api(`/api/schedules/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch((e: Error) => this.say(e.message, true));
    void this.loadSchedules();
  }

  private async schedule(folder: string): Promise<void> {
    if (this.files.length) return this.say(tr('Anexos não entram no agendamento: tire os anexos ou comece agora.'), true);
    this.busy = true;
    this.submitBtn.disabled = true;
    try {
      await api('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder, prompt: this.prompt.value, time: this.timeInput.value, days: [...this.days], tz: Intl.DateTimeFormat().resolvedOptions().timeZone, ...(this.account ? { account: this.account } : {}), ...(this.role ? { role: this.role } : {}), ...(this.model && this.account !== 'ollama' ? { model: this.model } : {}) }),
      });
      this.say(tr('Agendado: o agente abre sozinho às {0}.', [this.timeInput.value]));
      this.prompt.value = '';
      this.repeat.checked = false;
      this.syncRepeat();
      void this.loadSchedules();
    } catch (err) {
      this.say(tr('Não agendou: {0}', [(err as Error).message]), true);
    } finally {
      this.busy = false;
      this.submitBtn.disabled = false;
    }
  }

  /** Espera o agente novo aparecer no escritório (até 30 s) e abre a conversa dele. */
  private async openNew(before: Set<string>, folder: string): Promise<void> {
    const norm = (p: string) => p.replace(/[\\/]+$/, '');
    for (let i = 0; i < 60; i++) {
      const snap = this.ctx.store.snapshot;
      const fresh = (snap?.agents ?? []).filter((a) => !before.has(a.id));
      const hit = fresh.find((a) => norm(this.ctx.store.room(a.roomId)?.path ?? '') === norm(folder)) ?? (fresh.length === 1 ? fresh[0] : undefined);
      if (hit) {
        this.onStarted?.(hit.id);
        return;
      }
      await new Promise((ok) => setTimeout(ok, 500));
    }
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    if (this.dictate.busy) return this.say(tr('Espere o ditado terminar.'), true);
    const folder = (this.typing ? this.folder.value : this.selected).trim();
    if (!folder) return this.say(tr('Escolha o projeto.'), true);
    if (this.repeat.checked) return this.schedule(folder);
    this.busy = true;
    this.submitBtn.disabled = true;
    const before = new Set((this.ctx.store.snapshot?.agents ?? []).map((a) => a.id));
    try {
      const ids: string[] = [];
      for (const [i, f] of this.files.entries()) {
        this.say(this.files.length > 1 ? tr('Enviando anexos ({0} de {1})…', [i + 1, this.files.length]) : tr('Enviando o anexo…'));
        const r = await api<{ id: string }>('/api/spawn/attachments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: f.file.name, type: f.file.type, data: await fileToBase64(f.file) }),
        });
        ids.push(r.id);
      }
      this.say(tr('Começando no computador…'));
      let info = await api<SpawnInfo>('/api/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder, prompt: this.prompt.value, ...(this.account ? { account: this.account } : {}), ...(this.role ? { role: this.role } : {}), ...(this.model && this.account !== 'ollama' ? { model: this.model } : {}), ...(ids.length ? { attachments: ids } : {}) }),
      });
      const end = Date.now() + WAIT_MS;
      while ((info.status === 'queued' || info.status === 'sent') && Date.now() < end) {
        await new Promise((ok) => setTimeout(ok, POLL_MS));
        info = await api<SpawnInfo>(`/api/spawn/${encodeURIComponent(info.id)}`);
      }
      if (info.status === 'opened') {
        const running = info.how === 'cli';
        const msg = running
          ? tr('Rodando: a sessão já começou no computador e aparece no escritório em instantes.')
          : info.note
            ? tr('Abri no app do Claude: aperte Enter lá para começar. Não rodou sozinho: {0}.', [info.note])
            : tr('Abri no app do Claude: aperte Enter lá para começar.');
        this.say('');
        this.prompt.value = '';
        this.clearFiles();
        writePref(folder);
        // Deu certo: o modal fecha e o aviso vira toast; a conversa do agente novo abre quando ele aparecer.
        this.hide();
        if (this.onNotice) this.onNotice(msg, !running && info.note ? 'warn' : 'success');
        else this.ctx.announce(msg);
        if (running && this.onStarted) void this.openNew(before, folder);
      } else this.say(info.error ? tr('Não abriu: {0}', [info.error]) : tr('O computador não confirmou a abertura.'), true);
    } catch (err) {
      this.say(tr('Não abriu: {0}', [(err as Error).message]), true);
    } finally {
      this.busy = false;
      this.submitBtn.disabled = false;
    }
  }
}
