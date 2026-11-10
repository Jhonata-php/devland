// Interface do Habblaud (painéis DOM sobre o canvas do escritório).
// Recebe o OfficeStore (dados) e o WorldApi (canvas) e monta: barra superior com uso por conta,
// barra lateral, gaveta de detalhes, feed, avisos, configurações, ajuda e estados de carregamento/vazio.
// DOM incremental: os snapshots (até ~5/s) só marcam a UI como "suja"; tudo é reconciliado uma vez por quadro.
import { access, onAccessChange } from '../net/access';
import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/500.css';
import '@fontsource/pixelify-sans/600.css';
import '@fontsource/pixelify-sans/700.css';
import './styles.css';
import './dashboard.css';

import type { OfficeStore } from '../net/store';
import type { Selection, WorldApi } from '../world/api';
import type { PanelName, TerminalRouter, UiComponent, UiContext } from './context';
import { DayLauncher } from './daystats-launcher';
import { RoomRenamer } from './roomrename';
import { h, iconButton } from './dom';
import { ICONS } from './icons';
import { openPlugins } from './plugins';
import { enableDraggablePanels } from './drag';
import { Drawer } from './drawer';
import { FeedPanel } from './feed';
import { HelpDialog } from './help';
import { HistoryPopover } from './history';
import { Deliveries } from './deliveries';
import { PreviewPanel } from './preview';
import { HoverTip } from './hovertip';
import { hasRunningShells } from './model';
import { hasCodexPermission } from './provider';
import { Notifier } from './notify';
import { ConnectionBanner, EmptyState, Splash } from './overlays';
import { focusPermission, nextPermissionAgent } from './permission';
import { loadPrefs, safeLocalStorage, savePrefs, worldOptionsFrom, type UiPrefs } from './prefs';
import { SettingsPopover } from './settings';
import { openCloudPanel, setContasHandler } from './accounts';
import { ConnectWizard } from './connect-wizard';
import { Sidebar } from './sidebar';
import { SoundControl } from './sound';
import { TERMINAL_UNAVAILABLE_HINT, TerminalPanel } from './terminal';
import { PtyPanel } from './pty';
import { TimelapsePlayer } from './timelapse';
import { Toasts } from './toasts';
import { UpdateToaster } from './version';
import { TopBar } from './topbar';
import { BottomNav } from './bottomnav';
import { ChatsView } from './chats';
import { Dashboard } from './dashboard';
import { UpdateBanner } from './update';
import { WorldChip } from './world/world-chip';
import { WorldDialog } from './world/world-dialog';
import { WorldSocialNotifier } from './world/away-summary';
import { worldGate } from './world/settings-world';
import { worldSectionMode } from './world/world-model';
import { SceneSwitch, type CitySceneHost } from './world/scene-switch';
import { worldSource } from '../net/world';
import { FreeArea } from './viewport';
import { tr } from '../../../shared/i18n';

/** Relógio dos tempos relativos ("há 5 s"). */
const CLOCK_MS = 5_000;
/** Relógio do cronômetro dos shells ("12:31") e do prazo dos pedidos do Codex, ligado só enquanto há um dos dois. */
const SHELL_CLOCK_MS = 1_000;
const NARROW_QUERY = '(max-width: 900px)';

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
}

export function createUI(root: HTMLElement, store: OfficeStore, world: WorldApi, city?: CitySceneHost): void {
  const storage = safeLocalStorage();
  let prefs: UiPrefs = loadPrefs(storage, typeof matchMedia === 'function' && matchMedia('(max-width: 600px)').matches);
  let selection: Selection = world.getSelection();
  let skew = 0;
  const narrowMq = typeof matchMedia === 'function' ? matchMedia(NARROW_QUERY) : null;
  const panels: Record<PanelName, boolean> = {
    sidebar: narrowMq?.matches ? false : prefs.sidebarOpen,
    feed: narrowMq?.matches ? false : prefs.feedOpen,
  };

  const live = h('div', { class: 'ui-sr', role: 'status', attrs: { 'aria-live': 'polite' } });

  let topbar: TopBar;
  let sidebar: Sidebar;
  let drawer: Drawer;
  let settings: SettingsPopover;
  let worldDialog: WorldDialog;
  let help: HelpDialog;
  let area: FreeArea;
  let timelapse: TimelapsePlayer;
  /** A seleção em curso partiu da UI (lista, feed, aviso...), não de um clique no canvas. */
  let uiSelecting = false;
  /** Botão Mundo e a ida e volta da cidade (só quando app.ts monta a cena). */
  let scene: SceneSwitch | null = null;
  const inCity = () => !!scene?.inCity;

  // Tema claro ou escuro da interface (o mapa do escritório não muda): classe no <html>, automático segue o sistema.
  const lightMq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;
  const applyTheme = () => {
    const light = prefs.uiTheme === 'light' || (prefs.uiTheme === 'auto' && !!lightMq?.matches);
    document.documentElement.classList.toggle('theme-light', light);
    document.querySelector?.('meta[name="theme-color"]')?.setAttribute('content', light ? '#f7f6f3' : '#111110');
  };
  lightMq?.addEventListener?.('change', applyTheme);
  applyTheme();
  const ctx: UiContext = {
    store,
    world,
    root,
    get prefs() {
      return prefs;
    },
    updatePrefs(patch) {
      prefs = { ...prefs, ...patch };
      applyTheme();
      savePrefs(storage, prefs);
      world.setOptions(worldOptionsFrom(prefs));
      invalidate();
    },
    now: () => timelapse?.replayTime ?? Date.now() + skew,
    account: (id) => store.snapshot?.accounts.find((a) => a.id === id),
    agent: (id) => store.agent(id),
    selection: () => selection,
    select(sel, opts) {
      // Na cidade o escritório (gaveta, terminal) fica escondido: escolher um agente ou sala volta para ele. Antes de
      // tudo: a área livre só mede a gaveta e a barra lateral sem a classe `is-city`.
      scene?.leaveFor(sel);
      if (sel && opts?.focus) area.setIntent(sel);
      else area.clearIntent();
      // A gaveta passa a contar na área livre ANTES do foco: o mundo centraliza já na parte visível.
      const prev = selection;
      selection = sel;
      area.selectingFromUi();
      applyLayout({ refocus: false });
      uiSelecting = true;
      try {
        world.select(sel, opts);
      } catch (err) {
        selection = prev;
        applyLayout();
        throw err;
      } finally {
        uiSelecting = false;
      }
    },
    focusSelection() {
      if (selection) ctx.select(selection, { focus: true });
    },
    camera(action) {
      if (inCity() && city) {
        if (action === 'overview') city.recenter();
        else city.zoomBy(action === 'zoomIn' ? 1.25 : 1 / 1.25);
        return;
      }
      area.clearIntent();
      if (action === 'overview') world.overview();
      else world.zoomBy(action === 'zoomIn' ? 1.25 : 1 / 1.25);
    },
    invalidate: () => invalidate(),
    togglePanel(name, open) {
      const next = open ?? !panels[name];
      if (panels[name] === next) return;
      panels[name] = next;
      if (!ctx.isNarrow()) ctx.updatePrefs(name === 'sidebar' ? { sidebarOpen: next } : { feedOpen: next });
      applyLayout();
      invalidate();
    },
    isPanelOpen: (name) => panels[name],
    isNarrow: () => !!narrowMq?.matches,
    announce(text) {
      live.textContent = '';
      requestAnimationFrame(() => (live.textContent = text));
    },
    focusSearch() {
      if (!panels.sidebar) ctx.togglePanel('sidebar', true);
      requestAnimationFrame(() => sidebar.focusSearch());
    },
    openHelp: (section) => help.open(section),
    toggleSettings: () => settings.toggle(topbar.settingsBtn),
    toggleWorld: () => worldDialog.toggle(topbar.worldBtn),
    openAbout: () => settings.showAbout(topbar.settingsBtn),
    toggleTimelapse() {
      // O terminal mostra a conversa de agora: não combina com o dia reproduzido.
      if (!timelapse.isOpen && terminal.isOpen) terminal.close();
      timelapse.toggle();
    },
    isTimelapseOpen: () => timelapse.isOpen,
  };

  // ---------------------------------------------------------------- componentes
  const sound = new SoundControl(ctx);
  const notifier = new Notifier(ctx, sound.board);
  topbar = new TopBar(ctx);
  sidebar = new Sidebar(ctx);
  // Terminal interativo (Claude Code de verdade, dentro do navegador): abrir, assumir e encerrar sessões.
  const pty = new PtyPanel(ctx);
  const terminal = new TerminalPanel(ctx, pty);
  // Histórico de sessões (terminal): botão no grupo dos painéis da barra superior.
  const history = new HistoryPopover(ctx, terminal);
  topbar.panelGroup.prepend(history.button);
  // Terminal do agente: o interativo se a sessão roda aqui; senão o de leitura, com "Assumir daqui" para
  // continuar nesta janela (sem o de leitura, o interativo mostra o aviso de "em outro terminal").
  pty.onShow = () => terminal.close();
  const router: TerminalRouter = {
    get openAgentId() {
      return pty.isOpen ? pty.agentId : terminal.agentId;
    },
    get available() {
      return pty.enabled || (!!store.snapshot?.meta.terminal && !store.replaying);
    },
    interactive: (id) => !!pty.ptyOf(id),
    get interactiveEnabled() {
      return pty.enabled;
    },
    newSession: (cwd, account) => pty.newSession(cwd, account).then(() => undefined),
    open(id, opener) {
      const readOnly = !!store.snapshot?.meta.terminal && !store.replaying;
      if (pty.ptyOf(id) || (pty.enabled && !readOnly && ctx.agent(id)?.kind === 'main')) pty.openAgent(id);
      else {
        pty.close();
        terminal.open(id, opener);
      }
    },
    toggle(id, opener) {
      if (router.openAgentId === id) {
        pty.close();
        terminal.close();
      } else router.open(id, opener);
    },
  };
  ctx.terminals = router;
  // Entregas: o que os agentes terminaram (primeiro botão do grupo: é o que mais se usa pelo celular).
  const deliveries = new Deliveries(ctx, terminal);
  topbar.panelGroup.prepend(deliveries.button);
  // Prévia ao vivo do site do projeto (proxy autenticado do servidor).
  const previewPanel = new PreviewPanel(ctx);
  // Agente pediu a prévia (skill do plugin do DevLand): abre aqui, já na porta.
  store.on('notice', (n) => {
    if (n.previewPort && (access().preview || store.mock)) previewPanel.openPort(n.previewPort);
  });
  topbar.panelGroup.prepend(previewPanel.button);
  // Links com ?agent= / ?delivery= (abrem o agente ou a entrega ao carregar).
  const openLink = (url: URL) => {
    const agent = url.searchParams.get('agent');
    const delivery = url.searchParams.get('delivery');
    if (!agent && !delivery) return;
    const go = () => {
      if (delivery) void deliveries.openById(delivery);
      else if (agent && ctx.agent(agent)) ctx.select({ type: 'agent', id: agent }, { focus: true });
    };
    if (store.snapshot) go();
    else {
      const off = store.on('snapshot', () => {
        off();
        setTimeout(go, 300);
      });
    }
    if (url.search && location.search === url.search) window.window.history.replaceState(null, '', location.pathname);
  };
  if (typeof location !== 'undefined') openLink(new URL(location.href));
  // Notificação tocada com o app já aberto: o service worker pede para abrir o agente (sw.js).
  if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
      const url = (e.data as { devlandOpen?: unknown } | null)?.devlandOpen;
      if (typeof url === 'string' && url.startsWith('/')) openLink(new URL(url, location.origin));
    });
  }
  drawer = new Drawer(ctx, terminal, pty);
  const feed = new FeedPanel(ctx);
  const toasts = new Toasts(ctx);
  const updateToaster = new UpdateToaster(ctx, (n) => toasts.push(n));
  // Habblaud World (em desenvolvimento): a janela própria (botão na barra do topo) e os popups de lançamento, só com
  // meta.world ligado. As Configurações só recebem dela a dica do tema em Aparência.
  const hw = worldSource(store);
  worldDialog = new WorldDialog(ctx, hw, topbar.worldBtn);
  settings = new SettingsPopover(ctx, notifier, sound, worldDialog);
  // Chip "🏙️ no mundo" / "⏸ pausado" na barra do topo (conta aprovada; nunca pela porta do celular).
  const worldChip = new WorldChip(ctx, hw, () => worldDialog.show('home'), (n) => toasts.push(n));
  topbar.addStatus(worldChip.el);
  // "Enquanto você estava fora" ao conectar e o aviso de quem bateu na porta (Fase 5; só pelo próprio computador).
  const worldSocial = new WorldSocialNotifier(ctx, hw, {
    active: () => worldSectionMode(hw.meta(), worldGate(ctx, hw)) === 'active',
    toast: (n) => toasts.push(n),
    openWorld: () => worldDialog.show('home'),
  });
  // Botão Mundo: troca o escritório pela cidade (a cena vem de app.ts, carregada sob demanda).
  if (city) {
    scene = new SceneSwitch(ctx, hw, city, () => {
      const on = inCity();
      root.classList.toggle('is-city', on);
      if (on) {
        if (terminal.isOpen) terminal.close();
        if (pty.isOpen) pty.close();
        if (ctx.isNarrow() && panels.sidebar) ctx.togglePanel('sidebar', false);
      }
      invalidate();
    });
    topbar.addSceneButton(scene.button);
    const sw = scene;
    ctx.visitOwnBuilding = () => {
      if (worldDialog.isOpen) worldDialog.close();
      if (settings.isOpen) settings.hide();
      void sw.visitOwn();
    };
  }
  help = new HelpDialog();
  const day = new DayLauncher(ctx, (el) => root.append(el));
  topbar.addPanelButton(day.button);
  // Botão direito numa sala (lista lateral ou escritório): renomear.
  const renamer = new RoomRenamer(ctx);
  ctx.renameRoom = (id, at) => renamer.open(id, at);
  world.onRoomContextMenu?.((id, at) => renamer.open(id, at));
  const empty = new EmptyState(ctx, {
    get enabled() {
      return pty.enabled;
    },
    // Escritório vazio: escolher o projeto no Novo agente (o terminal fixo na raiz /workspace criava uma sala sem projeto).
    open: async () => topbar.toggleSpawn(),
  });
  const banner = new ConnectionBanner(ctx);
  const update = new UpdateBanner(store);
  // PC: arrastar as janelas pelo cabeçalho para organizar a tela (ui/drag.ts).
  if (typeof document !== 'undefined' && typeof matchMedia === 'function') enableDraggablePanels();
  const chats = new ChatsView(ctx, {
    openPreview: () => previewPanel.toggle(),
    ptyOf: (id) => pty.ptyOf(id),
    takeover: (id, model) => pty.takeover(id, model),
    openIn: (path, text) => pty.newSession(path, undefined, text).then(() => undefined),
  });
  // Aviso "fulano entregou": tocar abre a conversa com ele.
  // (no modo Painel, na página Conversas dele)
  deliveries.onOpenChat = (id) => (prefs.view === 'panel' ? dashboard.openChat(id) : chats.openChat(id));
  // PC: botão Conversas no topo (no celular ele fica na barra de baixo). As conversas abrem ao lado, à direita.
  const chatsBtn = iconButton(ICONS.feed, tr('Conversas'), () => chats.toggle(), 'ui-btn-chats');
  chatsBtn.setAttribute('data-label', tr('Conversas'));
  topbar.panelGroup.prepend(chatsBtn);
  // PC: loja de plugins no topo, para quem administra (no celular fica em Ajustes).
  const pluginsBtn = iconButton(ICONS.plugin, tr('Plugins do Claude Code'), () => openPlugins(ctx.root), 'ui-btn-plugins');
  pluginsBtn.setAttribute('data-label', tr('Plugins'));
  topbar.panelGroup.prepend(pluginsBtn);
  const chatsBtnSync: UiComponent = {
    render: () => {
      chatsBtn.classList.toggle('is-on', chats.isOpen);
      pluginsBtn.hidden = !(access().admin || (access().local && !access().remote));
    },
  };
  const bottomNav = new BottomNav(ctx, () => topbar.toggleSpawn(), chats);
  // Modo Painel (sem o mapa): o mesmo DevLand como plataforma de gestão. prefs.view lembra a escolha.
  const dashboard = new Dashboard(ctx, {
    openChat: (id) => chats.openChat(id),
    showChats: (on) => (on ? chats.show() : chats.close()),
    chatsOpen: () => chats.isOpen,
    newAgent: () => topbar.toggleSpawn(),
    canSpawn: () => topbar.canSpawn,
    openSettings: () => ctx.toggleSettings(),
    openPlugins: () => openPlugins(ctx.root),
    openCloud: (kind) => openCloudPanel(ctx.root, kind),
    openDeliveries: () => deliveries.button.click(),
    get newSessionIn() {
      return router.interactiveEnabled ? (path: string) => void router.newSession(path) : undefined;
    },
    get loginConnector() {
      return pty.enabled ? (path: string) => pty.newSession(path, undefined, '/mcp\r') : undefined;
    },
  });
  // Conectar conta passo a passo (Cloud): substitui a página antiga de Contas em todos os botões.
  const wizard = new ConnectWizard(() => invalidate());
  root.append(wizard.el);
  setContasHandler(() => wizard.open());
  // O escritório virou a página Mapa do Painel: só existe o modo Painel.
  const setView = (_view: 'office' | 'panel') => {
    const view = 'panel';
    if (view !== prefs.view) ctx.updatePrefs({ view });
    const panel = true;
    document.documentElement.classList.toggle('is-panel', panel);
    world.setSuspended?.(panel);
    dashboard.show(panel);
    if (panel) {
      if (scene?.inCity) scene.close();
      if (selection !== null) ctx.select(null);
    }
    invalidate();
  };
  ctx.setView = setView;
  const panelBtn = iconButton(ICONS.overview, tr('Modo painel: o DevLand sem o mapa'), () => setView('panel'), 'ui-btn-panel');
  panelBtn.setAttribute('data-label', tr('Painel'));
  topbar.panelGroup.prepend(panelBtn);
  const tip = new HoverTip(ctx);
  const splash = new Splash(ctx);
  timelapse = new TimelapsePlayer(ctx);
  const scrim = h('div', { class: 'ui-scrim', attrs: { 'aria-hidden': 'true' }, on: { click: () => ctx.togglePanel('sidebar', false) } });

  root.classList.add('ui-root');
  root.append(dashboard.el, timelapse.vignette, topbar.el, chats.el, bottomNav.el, sidebar.el, scrim, feed.el, drawer.el, terminal.el, pty.el, timelapse.el, timelapse.badge, toasts.el, banner.el, update.el, empty.el, tip.el, settings.el, worldDialog.el, history.el, deliveries.el, previewPanel.el, help.el, renamer.el, live, splash.el);
  area = new FreeArea(world, { root, topbar: topbar.el, sidebar: sidebar.el, drawer: drawer.el, feed: feed.el }, () => ({
    sidebar: panels.sidebar,
    feed: panels.feed,
    drawer: selection !== null && !drawer.floating,
    narrow: ctx.isNarrow(),
  }));
  drawer.onLayoutChange = () => applyLayout();
  // Página Mapa do Painel: o mundo aparece atrás do menu lateral e da barra do topo; a área livre é o que sobra.
  area.fixed = () => {
    if (!document.documentElement.classList.contains('dash-on-map')) return null;
    const ins = dashboard.mapInsets();
    if (selection !== null && !drawer.floating) {
      const r = drawer.el.getBoundingClientRect();
      if (r.width > 0 && !ctx.isNarrow()) ins.right = Math.max(0, Math.round(innerWidth - r.left));
    }
    return ins;
  };
  dashboard.onMap = (on) => {
    world.setSuspended?.(!on);
    area?.sync();
  };

  // /?painel=contas|usuarios (o /contas e o /admin antigos redirecionam para cá): abre a janela do Cloud já na chegada.
  const painel = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('painel') : null;
  if (painel === 'contas' || painel === 'usuarios') {
    window.history.replaceState(null, '', location.pathname);
    setTimeout(() => openCloudPanel(ctx.root, painel), 0);
  }

  // /?settings: abre as Configurações já na chegada.
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('settings')) {
    window.history.replaceState(null, '', location.pathname);
    setTimeout(() => settings.toggle(topbar.settingsBtn), 0);
  }

  const components: UiComponent[] = [dashboard, topbar, bottomNav, chats, chatsBtnSync, sidebar, drawer, terminal, pty, history, deliveries, previewPanel, feed, toasts, settings, empty, banner, tip, notifier, splash, timelapse, sound, day, updateToaster, worldDialog, worldChip];
  if (scene) components.push(scene);
  root.append(worldSocial.el);
  components.push(worldSocial);

  // ---------------------------------------------------------------- renderização agrupada por quadro
  let rafId = 0;
  let hiddenTimer: ReturnType<typeof setTimeout> | null = null;

  function renderAll(): void {
    rafId = 0;
    for (const c of components) {
      try {
        c.render();
      } catch (err) {
        console.error('[ui] falha ao renderizar', c.constructor.name, err);
      }
    }
  }

  function invalidate(): void {
    if (document.hidden) {
      // Com a aba oculta o navegador congela o rAF: mantém só título e alertas em dia.
      hiddenTimer ??= setTimeout(() => {
        hiddenTimer = null;
        notifier.render();
        toasts.render();
      }, 500);
      return;
    }
    if (!rafId) rafId = requestAnimationFrame(renderAll);
  }

  /** Aplica as classes de layout e informa ao mundo a área livre (sem esperar as transições dos painéis). */
  function applyLayout(opts: { refocus?: boolean } = {}): void {
    root.classList.toggle('has-sidebar', panels.sidebar);
    root.classList.toggle('has-feed', panels.feed);
    root.classList.toggle('has-drawer', selection !== null && !drawer.floating);
    root.classList.toggle('is-narrow', ctx.isNarrow());
    area.sync(opts);
  }

  // ---------------------------------------------------------------- eventos
  store.on('snapshot', (snap) => {
    // Ao vivo, o "agora" da interface segue o relógio do servidor (o aparelho pode estar adiantado ou atrasado).
    // No timelapse, quem manda é o instante reproduzido pelo player (parado quando pausado).
    if (store.connection === 'open' && !store.replaying) skew = snap.serverTime - Date.now();
    invalidate();
  });
  store.on('connection', () => invalidate());
  onAccessChange(() => invalidate());
  world.onSelect((sel) => {
    const prev = selection;
    selection = sel;
    // Clique no canvas (ou agente que saiu): a gaveta espera a janela do duplo clique antes de mexer na câmera.
    if (!uiSelecting) area.selectionChangedExternally(prev, sel);
    applyLayout(uiSelecting ? { refocus: false } : {});
    invalidate();
  });
  narrowMq?.addEventListener('change', (e) => {
    if (e.matches) {
      panels.sidebar = false;
      panels.feed = false;
    } else {
      panels.sidebar = prefs.sidebarOpen;
      panels.feed = prefs.feedOpen;
    }
    applyLayout();
    invalidate();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) invalidate();
  });
  setInterval(() => {
    if (!document.hidden) invalidate();
  }, CLOCK_MS);
  setInterval(() => {
    // Shells rodando (cronômetro) ou pedido do Codex esperando (prazo de segundos).
    if (!document.hidden && (hasRunningShells(store.snapshot) || hasCodexPermission(store.snapshot))) invalidate();
  }, SHELL_CLOCK_MS);

  addEventListener('keydown', (e) => onKey(e));

  function onKey(e: KeyboardEvent): void {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    // Na cidade os atalhos do escritório ficam desligados: Esc fecha o cartão aberto ou volta ao escritório.
    if (inCity()) {
      if (e.key === 'Escape') {
        if (help.isOpen || settings.isOpen || worldDialog.isOpen || history.isOpen || document.querySelector('dialog[open], :not(dialog)[aria-modal="true"]')) return;
        e.preventDefault();
        if (!city?.escape()) scene?.close();
      } else if (e.key === '?' && !isTypingTarget(e.target) && !help.isOpen) {
        e.preventDefault();
        help.open();
      }
      return;
    }
    if (e.key === 'Escape') {
      if (help.isOpen || settings.isOpen || worldDialog.isOpen || history.isOpen) return; // diálogo/popover tratam o próprio Esc
      // O terminal flutua sobre tudo: fecha primeiro (a busca dele, depois ele; a gaveta continua aberta).
      if (terminal.isOpen) {
        terminal.escape();
        e.preventDefault();
      } else if (ctx.isNarrow() && panels.sidebar) {
        ctx.togglePanel('sidebar', false);
        e.preventDefault();
      } else if (selection) {
        ctx.select(null);
        e.preventDefault();
      }
      return;
    }
    if (isTypingTarget(e.target) || help.isOpen || worldDialog.isOpen) return;
    switch (e.key) {
      case '/':
        e.preventDefault();
        ctx.focusSearch();
        break;
      case '?':
        e.preventDefault();
        help.open();
        break;
      case 'f':
      case 'F':
        e.preventDefault();
        if (selection?.type === 'agent') drawer.toggleFollow();
        else ctx.announce(tr('Selecione um agente para seguir.'));
        break;
      case 't':
      case 'T':
        e.preventDefault();
        toggleTerminal();
        break;
      case 'l':
      case 'L':
        if (store.mock) break;
        e.preventDefault();
        ctx.toggleTimelapse();
        break;
      case 'p':
      case 'P': {
        // Próximo pedido de permissão ou pergunta para responder pelo escritório (só leva até ele: nunca aprova).
        e.preventDefault();
        const next = nextPermissionAgent(store.snapshot?.agents ?? [], selection?.type === 'agent' ? selection.id : undefined);
        if (next) focusPermission(ctx, next.id);
        else ctx.announce(tr('Nenhum pedido de permissão ou pergunta para responder agora.'));
        break;
      }
      case 'o':
      case 'O':
        e.preventDefault();
        ctx.camera('overview');
        break;
      case 'm':
      case 'M':
        e.preventDefault();
        day.toggle();
        break;
      case '[':
        e.preventDefault();
        ctx.togglePanel('sidebar');
        break;
      case ']':
        e.preventDefault();
        ctx.togglePanel('feed');
        break;
    }
  }

  /**
   * Atalho T: abre a janela de terminal do agente selecionado (ver `router`) ou fecha a que estiver aberta.
   */
  function toggleTerminal(): void {
    const id = selection?.type === 'agent' ? selection.id : null;
    if (id !== null && pty.enabled && ctx.agent(id)?.kind === 'main') return router.toggle(id);
    if (id === null && pty.isOpen) return pty.close();
    if (terminal.isOpen && (id === null || terminal.agentId === id)) terminal.close();
    else if (id === null) ctx.announce(tr('Selecione um agente para abrir o terminal.'));
    else if (!store.snapshot?.meta.terminal || !access().terminal) ctx.announce(`${TERMINAL_UNAVAILABLE_HINT}.`);
    else if (!ctx.agent(id)) ctx.announce(tr('O agente já saiu do escritório.'));
    else terminal.open(id);
  }

  // ---------------------------------------------------------------- início
  world.setOptions(worldOptionsFrom(prefs));
  applyLayout();
  setView('panel');
  renderAll();
}
