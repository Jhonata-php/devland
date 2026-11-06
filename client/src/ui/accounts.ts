// Habblaud Cloud: Contas numa janela dentro do escritório (<dialog> modal com a própria página /contas?embed, que fala
// com a API do Cloud). Sem script de terceiros: a página é do mesmo servidor (X-Frame-Options SAMEORIGIN).
import { tr } from '../../../shared/i18n';
import { h, iconButton } from './dom';
import { ICONS } from './icons';

let dialog: HTMLDialogElement | undefined;

export function openAccounts(root: HTMLElement): void {
  if (!dialog) {
    const frame = h('iframe', { class: 'ui-accounts__frame', attrs: { title: tr('Contas'), src: '/contas?embed' } });
    const close = iconButton(ICONS.close, tr('Fechar'), () => dialog?.close(), 'ui-icon-btn--sm');
    dialog = h('dialog', { class: 'ui-accounts', attrs: { 'aria-label': tr('Contas') } }, h('div', { class: 'ui-accounts__head' }, h('h2', { text: tr('Contas') }), close), frame) as HTMLDialogElement;
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog?.close();
    });
    root.append(dialog);
  }
  // Recarrega ao abrir: mostra as contas como estão agora.
  (dialog.querySelector('iframe') as HTMLIFrameElement).src = '/contas?embed';
  if (!dialog.open) dialog.showModal();
}

/** Link que abre a janela (clique normal); com Ctrl/Cmd/botão do meio segue para a página inteira. */
export function accountsClick(root: HTMLElement): (e: MouseEvent) => void {
  return (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openAccounts(root);
  };
}
