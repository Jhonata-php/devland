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

export function openCloudPanel(root: HTMLElement, kind: CloudPanel): void {
  const p = PANELS[kind];
  let dialog = dialogs.get(kind);
  if (!dialog) {
    const frame = h('iframe', { class: 'ui-accounts__frame', attrs: { title: p.title(), src: p.src() } });
    const close = iconButton(ICONS.close, tr('Fechar'), () => dialog?.close(), 'ui-icon-btn--sm');
    const d = h('dialog', { class: 'ui-accounts', attrs: { 'aria-label': p.title() } }, h('div', { class: 'ui-accounts__head' }, h('h2', { text: p.title() }), close), frame) as HTMLDialogElement;
    d.addEventListener('click', (e) => {
      if (e.target === d) d.close();
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
