// DevLand Cloud: Contas e Usuários numa janela dentro do escritório (<dialog> modal com a própria página, que fala
// com a API do Cloud). Sem script de terceiros: a página é do mesmo servidor (X-Frame-Options SAMEORIGIN).
import { tr } from '../../../shared/i18n';
import { h, iconButton } from './dom';
import { ICONS } from './icons';

export type CloudPanel = 'contas' | 'usuarios';

const dialogs = new Map<CloudPanel, HTMLDialogElement>();

const PANELS: Record<CloudPanel, { src: () => string; title: () => string }> = {
  contas: { src: () => '/contas?embed', title: () => tr('Contas') },
  usuarios: { src: () => '/admin?embed', title: () => tr('Usuários') },
};

/** Visual do modo Painel para as páginas de Contas e Usuários (server/http/cloud.ts, EMBED_STYLE). */
const PANEL_EMBED_CSS = `
:root { --bg: #1a1a18; --card: #20201e; --line: rgba(255,255,255,.09); --txt: #edece9; --mut: #8f8c86; --gold: #edece9; --gold2: #d6d4cf; --cy: #7aa2ff; }
body { background: #1a1a18 !important; color: #edece9; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', Inter, 'Segoe UI', sans-serif; }
h1, h2 { color: #edece9 !important; text-shadow: none !important; }
h2 { color: #8f8c86 !important; font-weight: 600; }
.card { background: #20201e !important; border: 1px solid rgba(255,255,255,.08) !important; border-radius: 12px !important; box-shadow: none !important; }
.card.on { border-color: rgba(74,222,128,.35) !important; background: #20201e !important; }
button { background: #edece9 !important; color: #111110 !important; border: 0 !important; border-radius: 9px !important; box-shadow: none !important; font-weight: 600; }
button:hover { background: #fff !important; }
button.ghost, button.small.ghost, .seg button { background: #2a2a27 !important; color: #edece9 !important; border: 1px solid rgba(255,255,255,.12) !important; }
.seg { background: #111110 !important; border-color: rgba(255,255,255,.08) !important; }
.seg button[aria-checked=true] { background: #edece9 !important; color: #111110 !important; }
input, select { background: #111110 !important; color: #edece9 !important; border: 1px solid rgba(255,255,255,.13) !important; border-radius: 9px !important; }
input:focus, select:focus { border-color: rgba(74,222,128,.6) !important; box-shadow: 0 0 0 3px rgba(74,222,128,.15) !important; }
input[type=checkbox] { accent-color: #4ade80; }
fieldset label, td label, .chip, .pill, .badge { border-color: rgba(255,255,255,.12) !important; background: transparent !important; color: #c9c7c2 !important; }
fieldset label:has(input:checked), td label:has(input:checked), .chip.on, .pill.on { border-color: rgba(74,222,128,.45) !important; color: #4ade80 !important; background: rgba(74,222,128,.08) !important; }
.av { background: linear-gradient(135deg, #4ade80, #7aa2ff) !important; color: #0b0b0a !important; }
.repo { background: #111110 !important; border-color: rgba(255,255,255,.08) !important; }
a, .job .code, .repo .lock { color: #edece9 !important; }
.job a.btn { background: #edece9 !important; color: #111110 !important; }
.t-github { background: #2a2a27 !important; }
#err.ok, .card li.ok::before { color: #4ade80 !important; }
`;

/** Contas pelo passo a passo (ui/connect-wizard.ts), no lugar da página antiga numa janela. */
let contasHandler: (() => void) | null = null;
export function setContasHandler(fn: () => void): void {
  contasHandler = fn;
}

export function openCloudPanel(root: HTMLElement, kind: CloudPanel): void {
  if (kind === 'contas' && contasHandler) return contasHandler();
  const p = PANELS[kind];
  let dialog = dialogs.get(kind);
  if (!dialog) {
    const frame = h('iframe', { class: 'ui-accounts__frame', attrs: { title: p.title(), src: p.src() } });
    // Modo Painel: a página de dentro (mesma origem) ganha o visual neutro do painel no lugar do verde.
    frame.addEventListener('load', () => {
      const doc = frame.contentDocument;
      if (doc && document.documentElement.classList.contains('is-panel')) doc.head.append(Object.assign(doc.createElement('style'), { textContent: PANEL_EMBED_CSS }));
    });
    const close = iconButton(ICONS.close, tr('Fechar'), () => dialog?.close(), 'ui-icon-btn--sm');
    const d = h('dialog', { class: 'ui-accounts', attrs: { 'aria-label': p.title() } }, h('div', { class: 'ui-accounts__head' }, h('h2', { text: p.title() }), close), frame) as HTMLDialogElement;
    d.addEventListener('click', (e) => {
      if (e.target === d) d.close();
    });
    // A página avisa a altura do conteúdo: no computador a janela acompanha o conteúdo (sem o vazio embaixo).
    window.addEventListener('message', (e: MessageEvent) => {
      const hgt = Number((e.data as { devlandEmbedH?: unknown } | null)?.devlandEmbedH);
      if (e.source !== frame.contentWindow || e.origin !== location.origin || !(hgt > 0) || !window.matchMedia('(min-width: 641px)').matches) return;
      frame.style.height = `${Math.min(Math.ceil(hgt), Math.floor(window.innerHeight * 0.86) - 56)}px`;
    });
    root.append(d);
    dialogs.set(kind, d);
    dialog = d;
  }
  // Recarrega ao abrir: mostra os dados como estão agora.
  (dialog.querySelector('iframe') as HTMLIFrameElement).src = p.src();
  if (!dialog.open) dialog.showModal();
}

export const openAccounts = (root: HTMLElement): void => openCloudPanel(root, 'contas');

/** Link que abre a janela (clique normal); com Ctrl/Cmd/botão do meio segue para o endereço do link. */
export function accountsClick(root: HTMLElement): (e: MouseEvent) => void {
  return (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openAccounts(root);
  };
}
