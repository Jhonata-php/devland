// Caixa de mensagem: manda um texto ao agente principal pelo Habblaud (POST /api/messages) e o plugin
// habblaud-mensagens o entrega à sessão como se você o tivesse digitado (no Codex, `codex queue` a põe na fila da
// sessão, que a usa quando fica ociosa). Fica na gaveta do agente e no rodapé do
// terminal (só a sessão ao vivo). Enter manda, Shift+Enter quebra a linha; a linha de situação acompanha a entrega
// (GET /api/messages/:id) até ela se resolver. As teclas digitadas aqui não disparam os atalhos globais. O rascunho de
// cada agente fica guardado (só na memória) ao trocar de agente. O microfone (ui/dictation.ts, Whisper local no Mac)
// põe o texto ditado no cursor; aparece quando o ditado funciona daqui. A lógica pura está em ui/composer-model.ts.
import { MESSAGE_MAX } from '../../../shared/messages';
import type { AgentInfo, OutboxMessage, Provider } from '../../../shared/types';
import {
  canSend,
  composerMode,
  composerTip,
  enterSends,
  isSettled,
  LOST_ERROR,
  messageText,
  OFFLINE_ERROR,
  POLL_LIMIT_MS,
  pollDelay,
  sendStatusText,
  timeoutError,
  type ComposerMode,
  type SendState,
} from './composer-model';
import type { UiContext } from './context';
import { DictationButton, dictationAvailable, insertDictation } from './dictation';
import { h, pastedFiles, setAttr, setHidden, setText, setTitle } from './dom';
import { access } from '../net/access';
import { ICONS } from './icons';
import { uploadAttachment } from './spawn';
import { tr } from '../../../shared/i18n';

interface SpeechLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function speechCtor(): (new () => SpeechLike) | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechLike; webkitSpeechRecognition?: new () => SpeechLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export type ComposerVariant = 'drawer' | 'terminal';

export interface ComposerOptions {
  /** Esc dentro da caixa: para onde vai o foco (padrão: só sai da caixa). */
  onEscape?: () => void;
}

export class MessageComposer {
  readonly el: HTMLElement;
  /** Mensagem aceita (na fila da sessão ou entregue): a conversa mostra o card "Na fila" até ela aparecer. */
  onSent?: (agentId: string, text: string) => void;
  /** Agente da caixa (ou a chave da conversa, no terminal do histórico). */
  private agentId = '';
  private mode: ComposerMode = { kind: 'off', text: '' };
  /** Rascunho por agente: é ele que manda no conteúdo da caixa. */
  private drafts = new Map<string, string>();
  /** Último envio de cada agente (a linha de situação). */
  private states = new Map<string, SendState>();
  /** Ferramenta de cada agente que recebeu mensagem (o texto da entrega e do prazo muda no Codex). */
  private providers = new Map<string, Provider>();
  /** Ferramenta do agente da caixa. */
  private provider: Provider = 'claude';
  /** O que a caixa mostra agora ("<agente>|<pronta>"): ao mudar, o conteúdo vem do rascunho. */
  private shown = '';

  private row: HTMLElement;
  private box: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private hint: HTMLElement;
  private tip: HTMLElement | null;
  private status: HTMLElement;
  private dictate: DictationButton;
  /** Linha do ditado (gravando, transcrevendo, idioma, erro). */
  private dictStatus: HTMLElement;
  private dictTimer: ReturnType<typeof setTimeout> | null = null;
  /** Rascunho que recebe o ditado em andamento (o agente pode mudar enquanto o Mac transcreve). */
  private dictKey = '';
  private canDictate = false;
  /** Anexos por agente (fotos, arquivos): sobem ao enviar. */
  private files = new Map<string, File[]>();
  private fileInput: HTMLInputElement;
  private attachBtn: HTMLButtonElement;
  private fileList: HTMLElement;
  /** Ditado pelo navegador (iPhone/Chrome), quando o servidor não tem Whisper (Cloud). */
  private speechBtn: HTMLButtonElement;
  private speech: SpeechLike | null = null;

  constructor(
    private ctx: UiContext,
    private variant: ComposerVariant,
    private opts: ComposerOptions = {},
  ) {
    const term = variant === 'terminal';
    this.box = h('textarea', {
      class: `ui-msg__input${term ? ' ui-term__input' : ''}`,
      attrs: { rows: 1, maxlength: MESSAGE_MAX, autocomplete: 'off', enterkeyhint: 'send' },
    });
    this.box.addEventListener('input', () => {
      this.drafts.set(this.agentId, this.box.value);
      this.resize();
      this.syncButton();
    });
    this.box.addEventListener('focus', () => this.resize());
    this.box.addEventListener('keydown', (e) => this.onKey(e));
    this.sendBtn = h(
      'button',
      {
        class: term ? 'ui-msg__send' : 'ui-btn ui-msg__send',
        type: 'button',
        title: tr('Mandar (Enter)'),
        attrs: { 'aria-label': tr('Mandar a mensagem') },
        on: { click: () => void this.send() },
      },
      term ? '↵' : tr('Enviar'),
    );
    this.dictStatus = h('p', { class: 'ui-msg__status ui-msg__dictation', role: 'status', hidden: true, attrs: { 'aria-live': 'polite' } });
    this.dictate = new DictationButton(
      (t) => this.insertDictated(t.text),
      (text, error) => this.sayDictation(text, error),
      { compact: true, onStart: () => (this.dictKey = this.agentId) },
    );
    this.dictate.el.classList.add('ui-msg__mic');
    setHidden(this.dictate.el, true);
    this.fileInput = h('input', { type: 'file', hidden: true, attrs: { multiple: true, accept: 'image/*,application/pdf,text/*,audio/*,video/*,.zip,.json,.csv,.md', 'aria-hidden': 'true', tabindex: '-1' } });
    // Colar uma imagem na mensagem (só onde há anexos: o Cloud) vira anexo, como pelo botão de clipe.
    this.box.addEventListener('paste', (e) => {
      if (this.attachBtn.hidden) return;
      const pasted = pastedFiles(e);
      if (!pasted.length) return;
      if (!e.clipboardData?.getData('text')) e.preventDefault();
      this.files.set(this.agentId, [...(this.files.get(this.agentId) ?? []), ...pasted].slice(0, 8));
      this.renderFiles();
      this.syncButton();
    });
    this.fileInput.addEventListener('change', () => {
      const cur = this.files.get(this.agentId) ?? [];
      this.files.set(this.agentId, [...cur, ...(this.fileInput.files ?? [])].slice(0, 8));
      this.fileInput.value = '';
      this.renderFiles();
      this.syncButton();
    });
    this.attachBtn = h('button', { class: 'ui-btn ui-msg__attach', type: 'button', title: tr('Anexar foto ou arquivo'), attrs: { 'aria-label': tr('Anexar foto ou arquivo') }, on: { click: () => this.fileInput.click() } });
    const clip = h('span', { attrs: { 'aria-hidden': 'true' } });
    clip.innerHTML = ICONS.attach;
    this.attachBtn.append(clip);
    this.fileList = h('ul', { class: 'ui-msg__files', attrs: { 'aria-label': tr('Anexos') }, hidden: true });
    this.speechBtn = h('button', { class: 'ui-btn ui-msg__mic ui-dictate ui-dictate--compact', type: 'button', title: tr('Ditar'), attrs: { 'aria-label': tr('Ditar'), 'aria-pressed': 'false' }, on: { click: () => this.toggleSpeech() } });
    const mic = h('span', { class: 'ui-dictate__icon', attrs: { 'aria-hidden': 'true' } });
    mic.innerHTML = ICONS.mic;
    this.speechBtn.append(mic);
    setHidden(this.speechBtn, !speechCtor());
    this.row = h('div', { class: `ui-msg__row${term ? ' ui-term__prompt ui-term__prompt--mic' : ''}` });
    if (term) this.row.append(h('span', { class: 'ui-term__caret', text: '>', attrs: { 'aria-hidden': 'true' } }));
    this.row.append(this.box, this.attachBtn, this.speechBtn, this.dictate.el, this.sendBtn, this.fileInput);
    // Clique na "linha do prompt" (fora do botão) põe o cursor na caixa, como num terminal.
    this.row.addEventListener('mousedown', (e) => {
      if (e.target === this.row && !this.box.disabled) {
        e.preventDefault();
        this.box.focus();
      }
    });
    this.hint = h('p', { class: 'ui-msg__hint', hidden: true });
    this.status = h('p', { class: 'ui-msg__status', role: 'status', hidden: true, attrs: { 'aria-live': 'polite' } });
    this.tip = term ? null : h('p', { class: 'ui-msg__tip', text: composerTip() });
    this.el = h('div', { class: `ui-msg ui-msg--${variant}` }, this.hint, this.fileList, this.row, this.dictStatus, this.status, this.tip);
  }

  /**
   * Atualiza a caixa para `agent` (undefined = nenhum: sessão do histórico ou agente que saiu); `key` identifica o
   * rascunho. Devolve o modo: a gaveta esconde a seção quando é 'off'.
   */
  render(agent: AgentInfo | undefined, key = agent?.id ?? ''): ComposerMode['kind'] {
    const store = this.ctx.store;
    const mode = composerMode(agent, {
      enabled: store.mock || !!store.snapshot?.meta.messages,
      local: store.mock || access().messages,
      replaying: store.replaying,
      cloud: !!access().cloud,
      resume: !store.mock && !!this.ctx.terminals?.interactiveEnabled,
    });
    this.mode = mode;
    const ready = mode.kind === 'ready';
    const term = this.variant === 'terminal';
    this.provider = agent?.provider === 'codex' ? 'codex' : 'claude';

    // Troca de agente (ou a caixa passou a valer/deixou de valer): o conteúdo vem do rascunho guardado.
    const shown = `${key}|${ready}`;
    if (shown !== this.shown) {
      // Gravando para outro agente: para sem transcrever (a fala era para aquele).
      this.dictate.cancel();
      this.shown = shown;
      this.agentId = key;
      this.box.value = ready ? (this.drafts.get(key) ?? '') : '';
      this.box.style.height = '';
      if (ready) requestAnimationFrame(() => this.resize());
    }
    this.box.disabled = !ready;
    const name = agent?.name ?? tr('o agente');
    // Celular: o texto longo ocupava três linhas do rodapé do terminal; fica só "Mensagem para <nome>…".
    const phone = typeof matchMedia === 'function' && matchMedia('(max-width: 600px)').matches;
    const placeholder = ready ? (term && !phone ? tr('Mensagem para {0} (Enter manda, Shift+Enter quebra a linha)', [name]) : tr('Mensagem para {0}…', [name])) : mode.text;
    setAttr(this.box, 'placeholder', placeholder);
    setAttr(this.box, 'aria-label', ready ? tr('Mensagem para {0}', [name]) : mode.text);
    setTitle(this.box, ready ? '' : mode.text);
    this.row.classList.toggle('is-disabled', !ready);
    setHidden(this.sendBtn, !ready);
    // Anexos e ditado pelo navegador: só no Cloud (o servidor tem o depósito de anexos; no Mac há o ditado do Whisper).
    setHidden(this.attachBtn, !ready || !access().cloud);
    setHidden(this.speechBtn, !ready || !speechCtor() || this.canDictate);
    this.renderFiles();
    // Consulta em cache (30 s): o Mac pode instalar o Whisper ou parar o auxiliar com a página aberta.
    void dictationAvailable().then((ok) => {
      if (ok === this.canDictate) return;
      this.canDictate = ok;
      this.ctx.invalidate();
    });
    // Transcrevendo: o botão fica até o texto chegar (ele vai para o rascunho de quem ditou).
    setHidden(this.dictate.el, !this.canDictate || (!ready && !this.dictate.busy));
    // Na gaveta, a dica do plugin entra no lugar da caixa; no terminal ela já está no lugar do texto.
    setHidden(this.row, !term && !ready);
    if (this.tip) {
      setHidden(this.tip, !ready);
      setText(this.tip, composerTip(this.provider));
    }
    setHidden(this.hint, term || mode.kind !== 'hint');
    setText(this.hint, mode.kind === 'hint' ? mode.text : '');
    this.syncButton();

    const state = this.states.get(key);
    const text = sendStatusText(state, Date.now(), this.providers.get(key) ?? this.provider);
    setText(this.status, text);
    setHidden(this.status, !text);
    this.status.classList.toggle('is-error', state?.phase === 'failed' || state?.phase === 'rejected');
    this.status.classList.toggle('is-ok', state?.phase === 'delivered');
    return mode.kind;
  }

  // ---------------------------------------------------------------- internos

  private onKey(e: KeyboardEvent): void {
    // Os atalhos globais (F, T, P, /, setas...) não valem dentro da caixa. Com Ctrl/⌘ a tecla segue adiante
    // (Ctrl/⌘+F busca na conversa do terminal; os atalhos globais ignoram essas combinações).
    if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
    if (e.key === 'Escape') {
      // Esc só sai da caixa (o próximo fecha o terminal ou a gaveta).
      e.preventDefault();
      e.stopPropagation();
      if (this.opts.onEscape) this.opts.onEscape();
      else this.box.blur();
      return;
    }
    if (enterSends(e)) {
      e.preventDefault();
      void this.send();
    }
  }

  /** Texto ditado: no cursor, se a caixa ainda é a de quem ditou; senão, no fim do rascunho daquele agente. */
  private insertDictated(text: string): void {
    const key = this.dictKey;
    if (key === this.agentId && !this.box.disabled) {
      const box = this.box;
      const { value, caret } = insertDictation(box.value, box.selectionStart ?? box.value.length, box.selectionEnd ?? box.value.length, text);
      box.value = value.slice(0, MESSAGE_MAX);
      this.drafts.set(key, box.value);
      this.resize();
      this.syncButton();
      box.focus({ preventScroll: true });
      box.setSelectionRange(caret, caret);
    } else {
      const cur = this.drafts.get(key) ?? '';
      this.drafts.set(key, insertDictation(cur, cur.length, cur.length, text).value.slice(0, MESSAGE_MAX));
    }
  }

  private sayDictation(text: string, error = false): void {
    if (this.dictTimer) clearTimeout(this.dictTimer);
    setText(this.dictStatus, text);
    setHidden(this.dictStatus, !text);
    this.dictStatus.classList.toggle('is-error', error);
    // Avisos de sucesso somem sozinhos; "Gravando…" e "Transcrevendo…" ficam até a próxima mudança.
    if (!error && !/…$/.test(text)) this.dictTimer = setTimeout(() => setHidden(this.dictStatus, true), 6_000);
  }

  private renderFiles(): void {
    const list = this.files.get(this.agentId) ?? [];
    setHidden(this.fileList, !list.length);
    this.fileList.replaceChildren(
      ...list.map((f) =>
        h(
          'li',
          { class: 'ui-msg__file' },
          h('span', { text: f.name }),
          h('button', {
            class: 'ui-msg__file-x',
            type: 'button',
            text: '×',
            attrs: { 'aria-label': tr('Tirar o anexo') },
            on: {
              click: () => {
                this.files.set(this.agentId, (this.files.get(this.agentId) ?? []).filter((x) => x !== f));
                this.renderFiles();
                this.syncButton();
              },
            },
          }),
        ),
      ),
    );
  }

  private toggleSpeech(): void {
    // Segundo toque para sempre: no iPhone (app da tela de início) o reconhecimento às vezes não dispara onend e o botão
    // ficava preso em "gravando".
    if (this.speech) {
      const rec = this.speech;
      try {
        rec.stop();
      } catch {
        /* já parado */
      }
      rec.onend?.();
      return;
    }
    const Ctor = speechCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = navigator.language || 'pt-BR';
    rec.interimResults = false;
    rec.continuous = false;
    this.dictKey = this.agentId;
    rec.onresult = (e) => {
      const text = Array.from(e.results).map((r) => r[0]?.transcript ?? '').join(' ');
      if (text.trim()) this.insertDictated(text);
    };
    rec.onerror = (e) => this.sayDictation(e.error === 'not-allowed' ? tr('Sem permissão para usar o microfone.') : tr('Não deu para ouvir: {0}', [e.error]), true);
    // Trava de segurança: sem fim em 60 s (iPhone sem resposta do serviço de voz), solta o botão.
    const guard = setTimeout(() => rec.onend?.(), 60_000);
    rec.onend = () => {
      clearTimeout(guard);
      if (this.speech !== rec) return;
      this.speech = null;
      this.speechBtn.classList.remove('is-recording');
      this.speechBtn.setAttribute('aria-pressed', 'false');
    };
    this.speech = rec;
    this.speechBtn.classList.add('is-recording');
    this.speechBtn.setAttribute('aria-pressed', 'true');
    try {
      rec.start();
    } catch {
      rec.onend?.();
    }
  }

  private syncButton(): void {
    const hasFiles = (this.files.get(this.agentId)?.length ?? 0) > 0;
    this.sendBtn.disabled = this.mode.kind !== 'ready' || !(canSend(this.box.value) || (hasFiles && this.box.value.length <= MESSAGE_MAX)) || this.states.get(this.agentId)?.phase === 'sending';
  }

  /** Cresce com o texto até o limite do CSS (~6 linhas; depois rola). Escondida, mede quando aparecer. */
  private resize(): void {
    const box = this.box;
    if (!box.isConnected || box.offsetParent === null) return;
    box.style.height = 'auto';
    box.style.height = `${box.scrollHeight + box.offsetHeight - box.clientHeight}px`;
  }

  private setState(agentId: string, state: SendState): void {
    this.states.set(agentId, state);
    if (agentId === this.agentId) this.syncButton();
    this.ctx.invalidate();
  }

  /** Manda um texto pronto ao agente desta conversa (sem mexer no rascunho que você está escrevendo). */
  async sendText(text: string): Promise<void> {
    const prev = this.box.value;
    this.box.value = text;
    await this.send();
    this.box.value = prev;
    this.resize();
  }

  private async send(): Promise<void> {
    const agentId = this.agentId;
    const raw = this.box.value;
    const files = this.files.get(agentId) ?? [];
    if (this.mode.kind !== 'ready' || !(canSend(raw) || (files.length && raw.length <= MESSAGE_MAX)) || this.states.get(agentId)?.phase === 'sending') return;
    this.providers.set(agentId, this.provider);
    this.setState(agentId, { phase: 'sending', at: Date.now() });
    // Sessão sem o plugin de mensagens: retoma a sessão num terminal daqui com o texto (sem anexos por esse caminho).
    if (this.mode.kind === 'ready' && this.mode.resume) {
      if (files.length) return this.setState(agentId, { phase: 'rejected', error: tr('Anexos não vão por aqui nesta conversa: mande só o texto.'), at: Date.now() });
      try {
        const res = await fetch('/api/messages/resume', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId, text: messageText(raw) }) });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) return this.setState(agentId, { phase: 'rejected', error: body.error ?? OFFLINE_ERROR, at: Date.now() });
      } catch {
        return this.setState(agentId, { phase: 'rejected', error: OFFLINE_ERROR, at: Date.now() });
      }
      this.drafts.delete(agentId);
      if (this.agentId === agentId) {
        this.box.value = '';
        this.resize();
      }
      this.setState(agentId, { phase: 'delivered', at: Date.now() });
      this.onSent?.(agentId, messageText(raw));
      return;
    }
    let r: { message: OutboxMessage } | { error: string };
    try {
      const ids: string[] = [];
      for (const f of files) ids.push(await uploadAttachment(f));
      r = await this.ctx.store.sendMessage(agentId, messageText(raw), ids);
    } catch (err) {
      if (files.length) {
        this.setState(agentId, { phase: 'rejected', error: (err as Error).message || OFFLINE_ERROR, at: Date.now() });
        return;
      }
      r = { error: OFFLINE_ERROR };
    }
    if ('error' in r) {
      // Recusada: o texto continua na caixa para tentar de novo.
      this.setState(agentId, { phase: 'rejected', error: r.error, at: Date.now() });
      return;
    }
    this.files.delete(agentId);
    this.renderFiles();
    // Na fila: a caixa esvazia (a não ser que você tenha continuado a escrever enquanto o envio ia).
    if ((this.drafts.get(agentId) ?? '') === raw) {
      this.drafts.delete(agentId);
      if (this.agentId === agentId && this.box.value === raw) {
        this.box.value = '';
        this.resize();
      }
    }
    const m = r.message;
    this.setState(agentId, { phase: m.status, id: m.id, error: m.error, at: Date.now() });
    if (m.status !== 'failed') this.onSent?.(agentId, messageText(raw));
    if (!isSettled(m.status)) this.poll(agentId, m.id, Date.now());
  }

  /** Consulta a situação até ela se resolver (ou o prazo acabar). Para quando outro envio toma a linha de situação. */
  private poll(agentId: string, id: string, since: number): void {
    const step = async () => {
      if (this.states.get(agentId)?.id !== id) return;
      let m: OutboxMessage | null | undefined;
      try {
        m = await this.ctx.store.messageStatus(id);
      } catch {
        // Sem conexão agora: tenta de novo na próxima volta.
      }
      const cur = this.states.get(agentId);
      if (cur?.id !== id) return;
      const now = Date.now();
      if (m === null) return this.setState(agentId, { phase: 'failed', id, error: LOST_ERROR, at: now });
      if (m && (m.status !== cur.phase || m.error !== cur.error)) this.setState(agentId, { phase: m.status, id, error: m.error, at: now });
      if (m && isSettled(m.status)) return;
      const elapsed = now - since;
      if (elapsed >= POLL_LIMIT_MS) return this.setState(agentId, { phase: 'failed', id, error: timeoutError(this.providers.get(agentId)), at: now });
      setTimeout(() => void step(), pollDelay(elapsed));
    };
    setTimeout(() => void step(), pollDelay(0));
  }
}
