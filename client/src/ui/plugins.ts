// Loja de plugins do Claude Code (Configurações › Plugins): busca no catálogo dos marketplaces configurados e instala
// ou remove em todas as contas (server/plugins/store.ts). Janela no mesmo estilo de Contas/Usuários.
import { tr } from '../../../shared/i18n';
import { h, iconButton, setHidden, setText } from './dom';
import { ICONS } from './icons';

interface PluginEntry {
  id: string;
  name: string;
  description: string;
  marketplace: string;
  version?: string;
  installed: boolean;
}

let dialog: HTMLDialogElement | null = null;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? tr('Não deu certo.'));
  return body;
}

export function openPlugins(root: HTMLElement): void {
  if (!dialog) {
    const search = h('input', { class: 'ui-rename__input ui-plugins__search', type: 'search', attrs: { placeholder: tr('Buscar plugins (ex.: revisão, testes, github)'), 'aria-label': tr('Buscar plugins') } });
    const note = h('p', { class: 'ui-set__hint ui-plugins__note' });
    const list = h('div', { class: 'ui-plugins__list', role: 'list' });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      setText(note, tr('Carregando o catálogo…'));
      try {
        const r = await call<{ plugins: PluginEntry[]; total: number }>(`/api/plugins?q=${encodeURIComponent(search.value.trim())}`);
        setText(note, tr('{0} de {1} plugins dos marketplaces configurados. Plugins rodam código no servidor: instale só os que você conhece.', [r.plugins.length, r.total]));
        list.replaceChildren(
          ...r.plugins.map((p) => {
            const btn = h('button', { class: `ui-btn${p.installed ? '' : ' ui-perm__btn--allow'}`, type: 'button', text: p.installed ? tr('Remover') : tr('Instalar') });
            btn.addEventListener('click', async () => {
              btn.disabled = true;
              setText(btn, p.installed ? tr('Removendo…') : tr('Instalando…'));
              try {
                await call(`/api/plugins/${p.installed ? 'uninstall' : 'install'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id }) });
                setText(note, p.installed ? tr('{0} removido. As sessões novas já vêm sem ele.', [p.name]) : tr('{0} instalado. As sessões novas já vêm com ele.', [p.name]));
                void load();
              } catch (err) {
                setText(note, (err as Error).message);
                btn.disabled = false;
                setText(btn, p.installed ? tr('Remover') : tr('Instalar'));
              }
            });
            return h(
              'div',
              { class: `ui-plugins__item${p.installed ? ' is-on' : ''}`, role: 'listitem' },
              h('div', { class: 'ui-plugins__text' }, h('strong', { text: p.name }), h('small', { text: `${p.marketplace}${p.version ? ` · v${p.version}` : ''}${p.installed ? ` · ${tr('instalado')}` : ''}` }), h('span', { text: p.description })),
              btn,
            );
          }),
        );
        setHidden(list, false);
      } catch (err) {
        setText(note, (err as Error).message);
      }
    };
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), 300);
    });
    search.addEventListener('keydown', (e) => e.stopPropagation());
    const close = iconButton(ICONS.close, tr('Fechar'), () => dialog?.close(), 'ui-icon-btn--sm');
    dialog = h(
      'dialog',
      { class: 'ui-accounts ui-plugins', attrs: { 'aria-label': tr('Plugins do Claude Code') } },
      h('div', { class: 'ui-accounts__head' }, h('h2', { text: tr('Plugins do Claude Code') }), close),
      h('div', { class: 'ui-plugins__body' }, search, note, list),
    ) as HTMLDialogElement;
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog?.close();
    });
    root.append(dialog);
    (dialog as HTMLDialogElement & { __load?: () => Promise<void> }).__load = load;
  }
  dialog.showModal();
  void (dialog as HTMLDialogElement & { __load?: () => Promise<void> }).__load?.();
}
