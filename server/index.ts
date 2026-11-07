// Servidor do Habblaud: observa as sessões abertas do Claude Code (todas as contas),
// mantém o modelo do escritório e transmite via SSE. Sem dependências de runtime.
//   npm run dev    -> tsx server/index.ts --dev (Vite em middleware mode, HMR no mesmo servidor)
//   npm start      -> node dist/server/index.js (serve dist/client)
import { chownSync, existsSync, rmSync } from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { codexDirsRefused, isDefaultDir } from './accounts/detect';
import { AccountsService } from './accounts/service';
import { isTruthy, loadConfig, messagesOffReason, terminalOffReason, worldSocketUrl } from './config';
import { createApiHandler, sendJson } from './http/app';
import { createRequestGuard, isLoopbackHost } from './http/guard';
import { createRemoteGate, isRemoteRequest, loadSecret, RemoteSessions, startRemoteListener, type RemoteFeature, type RemoteListener } from './http/remote';
import { createCloud, userKeyOf } from './http/cloud';
import { UserStore } from './cloud/users';
import { ConnectService } from './cloud/connect';
import { findExecutable } from './claude-bin';
import { agentRunAs } from './spawn/runas';
import { Hub } from './http/sse';
import { createStaticHandler } from './http/static';
import { TerminalStreams } from './http/terminal';
import { createTimelineHandler } from './http/timeline';
import { TIMELINE_DIR, TimelineRecorder } from './history/timeline';
import { DayStatsService } from './history/daystats';
import { describeStateMigration, legacyEnvWarning, migrateLegacyStateDir } from './legacy';
import { errMsg, log } from './log';
import { NameStore } from './model/names';
import { Office } from './model/office';
import { RoomAliases } from './model/room-aliases';
import { createPtyRoutes } from './http/pty';
import { claudeBinFrom, isExecutableFile, loadPty, PtyManager, type ScreenFactory, type SpawnPty } from './pty/manager';
import { loadHeadlessScreen } from './pty/screen';
import { openMainAgent, SessionHistory } from './sources/history';
import { HistorySet, SourceSet } from './sources/source';
import { createPermissionRoutes } from './permissions/http';
import { PermissionRegistry } from './permissions/registry';
import { codexAccountOf } from './codex/http';
import { createCodexQueueRunner, findCodexBin } from './messages/codex';
import { createMessageRoutes } from './messages/http';
import { MessageRegistry } from './messages/registry';
import type { CodexLive } from './sources/codex/live';
import { ClaudeWatcher } from './sources/watcher';
import { discoverCodexDirs } from './sources/codex/accounts';
import { CodexHistory } from './sources/codex/history';
import { CodexSource } from './sources/codex/source';
import { createBuildReader, readBuildInfo } from './build';
import { ensureHabblaudPlugins } from './accounts/plugins';
import { PushService } from './push/service';
import { pickAccountByLoad } from './pty/pick-account';
import { loadLiveAgents, saveLiveAgents, type LiveAgent } from './pty/live-agents';
import { ensureUsageTap } from './accounts/usage-tap';
import { UpdateChecker } from './updates/checker';
import { stageVersion } from './updates/self-update';
import { ghcrLatest, loadVelixFile, parseVelixTarget, saveVelixFile, velixRedeploy, velixTargetFromEnv } from './updates/cloud';
import { getLocale, tr } from '../shared/i18n';
import type { WorldLocale } from '../shared/world/protocol';
import { createCliRunner, createOpener, SpawnService } from './spawn/spawn';
import { runnableClaudeBin } from './claude-bin';
import { fetchOAuthUsage } from './accounts/oauth-usage';
import { AttachmentStore, attachmentsRoot, writeAttachments, type Attachment } from './spawn/attachments';
import { mergeFolders, recentFolders, workspaceFolders } from './spawn/folders';
import { WORKSPACE } from './cloud/connect';
import { isDemoId } from '../shared/timeline';
import { DictationService } from './dictation/dictation';
import { createWhisperTranscriber, findWhisper } from './dictation/whisper';
import { DeliveryIndex } from './deliveries/deliveries';
import { FileFetcher } from './deliveries/fetcher';
import { WorldClient } from './world/client';
import { createWorldRoutes } from './world/http';
import { WorldService } from './world/service';
import { WorldSettingsStore } from './world/settings';
import { OwnerSocial } from './world/social';
import { BuildingTokens } from './world/tokens';
import { BuildingUplink } from './world/uplink';
import { WorldViewer } from './world/viewer';

const config = loadConfig();
const startedAt = Date.now();

// Nome antigo (CodeTown, até a 0.3.2): leva ~/.codetown para ~/.habblaud antes de ler qualquer estado e avisa
// das variáveis CODETOWN_* que não valem mais. No Docker, quem migra é o docker:up.
if (!config.inDocker) {
  const r = migrateLegacyStateDir(config.home);
  const msg = describeStateMigration(r);
  if (msg) (r.error ? log.warn : log.info)(msg);
}
const legacyEnv = legacyEnvWarning(Object.keys(process.env));
if (legacyEnv) log.warn(legacyEnv);

const names = new NameStore(join(config.dataDir, 'names.json'));
names.load();
// Nomes de sala escolhidos pelo usuário (botão direito > Renomear).
const roomAliases = new RoomAliases(join(config.dataDir, 'rooms.json'));
roomAliases.load();

// Office, contas e fontes de agentes se referenciam (avisos de mudança / fontes): ligação tardia.
const late: { connect?: ConnectService; office?: Office; agents?: SourceSet; permissions?: PermissionRegistry; messages?: MessageRegistry; ptys?: PtyManager; ptyOff?: string } = {};
// Versão nova: consulta a release mais recente no GitHub a cada 6 h (HABBLAUD_UPDATE_CHECK=0 desliga).
// Cloud (imagem com HABBLAUD_CLOUD_VERSION): a versão mais recente vem das tags da imagem no GHCR e o admin atualiza
// por um botão que pede ao Velix para reimplantar (HABBLAUD_VELIX_URL/TOKEN/PROJECT; sem elas, só avisa).
const velixFile = join(config.dataDir, 'velix.json');
let velix = config.cloudVersion ? (velixTargetFromEnv(process.env) ?? loadVelixFile(velixFile)) : undefined;
const updates = new UpdateChecker({
  current: config.version,
  repo: config.repo,
  enabled: config.updateCheck,
  file: join(config.dataDir, 'updates.json'),
  source: config.cloudVersion && config.repo ? ghcrLatest(config.repo) : undefined,
  // Atualização nativa: baixa o código da versão nova do GHCR para <dados>/app e reinicia (o entrypoint o usa); o Velix só entra
  // como plano B quando a versão muda as dependências e a conexão com ele foi configurada.
  apply: config.cloudVersion
    ? async () => {
        const latest = updates.status().latest;
        if (latest && config.repo) {
          const r = await stageVersion({ image: config.repo, version: latest, dataDir: config.dataDir, depsHashFile: join(config.rootDir, 'deps.hash') });
          if (r.ok) {
            setTimeout(() => shutdown('update'), 1_500);
            return { ok: true as const };
          }
          if (!r.needsImage || !velix) return r;
        }
        return velix ? velixRedeploy(velix) : { ok: false as const, error: tr('falta configurar a conexão com o Velix') };
      }
    : undefined,
  canApply: () => true,
  autoFile: join(config.dataDir, 'auto-update.json'),
  onChange: () => late.office?.markDirty(),
});
/** Cloud: o admin informa a conexão com o Velix pela tela (Ajustes › Sobre); fica em <dataDir>/velix.json. */
const configureVelix = (raw: unknown): { ok: true } | { ok: false; error: string } => {
  const t = parseVelixTarget(raw);
  if ('error' in t) return { ok: false, error: t.error };
  try {
    saveVelixFile(velixFile, t);
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
  velix = t;
  late.office?.markDirty();
  return { ok: true };
};
updates.load();
updates.loadAuto();
// Habblaud World (server/world/): a conta e o personagem neste computador. Ligado por padrão (server.habblaud.com, ou
// HABBLAUD_WORLD_URL); nada sai do computador antes de a pessoa criar a conta e entrar. HABBLAUD_WORLD=0 esconde tudo
// (rotas 404 e nada na interface); uma HABBLAUD_WORLD_URL recusada deixa o recurso desligado.
const worldStore = new WorldSettingsStore(join(config.dataDir, 'world.json'));
if (config.world.enabled && config.world.url) worldStore.load();
// O social leve do dono (world/social.ts): likes do dia, "enquanto você estava fora", batidas na porta e bloqueados.
const worldSocial = config.world.enabled ? new OwnerSocial({ session: () => worldStore.get()?.deviceId, onChange: () => late.office?.markDirty() }) : undefined;
const world = config.world.enabled
  ? new WorldService({
      config: config.world,
      terminal: config.terminal,
      store: worldStore,
      client: config.world.url ? new WorldClient({ baseUrl: config.world.url, version: config.version }) : undefined,
      onChange: () => late.office?.markDirty(),
      social: worldSocial,
    })
  : undefined;
const accounts = new AccountsService({
  dirs: config.claudeDirs,
  home: config.home,
  env: process.env,
  usageDir: config.usageDir,
  onChange: () => late.office?.markDirty(),
});
const office = new Office({
  names,
  roomAlias: (path) => roomAliases.get(path),
  version: config.version,
  // No modo dev o Vite serve o cliente direto do código-fonte: não há build para comparar.
  build: config.dev ? undefined : createBuildReader(config.rootDir),
  startedAt,
  accounts: (sessions) => accounts.list(sessions),
  sources: () => late.agents?.sources() ?? [],
  accountName: (id) => accounts.find(id)?.detected.name,
  terminal: config.terminal,
  permissions: () => late.permissions?.snapshot() ?? new Map(),
  messages: config.messages ? () => late.messages?.reachable() ?? new Set() : undefined,
  ptys: () => (late.ptys ? { status: late.ptys.status(), list: late.ptys.list() } : { status: { enabled: false, reason: late.ptyOff ?? tr('desligado') }, list: [] }),
  updates: () => updates.status(),
  world: () => world?.meta() ?? { enabled: false, configured: false, state: 'off' },
});
// Fontes de agentes, uma por ferramenta (sources/source.ts): a do Claude Code e, depois dela, a do Codex (quando há
// pastas do Codex; HABBLAUD_CODEX=0 desliga), com o histórico dela no HistorySet abaixo e as contas registradas por
// ela mesma (accounts.setProviderAccounts). `codex` também recebe os eventos dos hooks do Codex (CodexLive).
const claude = new ClaudeWatcher({ accounts, office, inDocker: config.inDocker });
const agents = new SourceSet([claude]);
const codexDirs = config.codex ? discoverCodexDirs(process.env, config.home) : [];
const codex = codexDirs.length ? new CodexSource({ accounts, office, dirs: codexDirs, env: process.env, home: config.home }) : undefined;
if (codex) agents.add(codex);
// Eventos dos hooks do Codex (POST /api/codex/events, mod/habblaud-codex/hook.mjs): vão para a fonte do Codex ao vivo
// (CodexLive); sem ela (nenhuma pasta do Codex ou HABBLAUD_CODEX=0) a rota responde {ok: false}.
const codexLive: CodexLive | undefined = codex;
late.office = office;
late.agents = agents;
// Página que pode responder pelo escritório: Host local na porta local; na remota, só com permissions liberado.
// Porta remota com login: sessões e, no Habblaud Cloud (HABBLAUD_CLOUD=1), os usuários de <dataDir>/users.json.
const cloudStore = config.remote?.cloud ? new UserStore(join(config.dataDir, 'users.json')) : undefined;
const remoteSessions = config.remote
  ? new RemoteSessions(
      loadSecret(join(config.dataDir, 'remote-secret')),
      config.remote,
      Date.now,
      join(config.dataDir, 'remote-revoked.json'),
      cloudStore && userKeyOf(cloudStore),
    )
  : undefined;
/** Atrás do Traefik o TLS termina no proxy: o cookie leva Secure quando ele diz que a conexão era HTTPS. */
const viaHttps = (req: http.IncomingMessage) => req.headers['x-forwarded-proto'] === 'https';
const cloud = cloudStore && remoteSessions ? createCloud({
      store: cloudStore,
      sessions: remoteSessions,
      secure: viaHttps,
      setupCode: process.env.HABBLAUD_SETUP_CODE?.trim() || undefined,
      connect: () => late.connect,
    }) : undefined;
/** O que a requisição remota pode fazer: a lista do usuário (Cloud) ou HABBLAUD_REMOTE_ALLOW. */
const remoteAllows = (req: http.IncomingMessage, f: RemoteFeature): boolean => (cloud ? cloud.allows(req, f) : !!config.remote?.allow.has(f));
const hub = new Hub(office, {
  canAnswer: (req) => (isRemoteRequest(req) ? remoteAllows(req, 'permissions') : isLoopbackHost(req.headers.host)),
});
// Notificações push (push/service.ts): no Cloud e no acesso remoto, para avisar o celular mesmo com o Habblaud fechado.
const push = cloud || config.remote ? new PushService({ dir: join(config.dataDir, 'push'), subject: 'mailto:habblaud@localhost' }) : undefined;
if (push) {
  push.load();
  hub.onNotice((n) => {
    // "Precisa de você" e "concluiu" (o texto do aviso de conclusão começa com ✅); o resto não vira notificação.
    if (n.level !== 'alert' && !(n.level === 'success' && n.text.startsWith('✅'))) return;
    void push.notify({ title: n.level === 'alert' ? tr('Habblaud — precisa de você') : tr('Habblaud — terminou'), body: n.text, tag: n.agentId ?? n.id });
  });
}
// "Meu dia": amostra o escritório a cada segundo e persiste em <dataDir>/stats/ (ver history/daystats.ts).
const stats = new DayStatsService({ dir: join(config.dataDir, 'stats'), snapshot: () => hub.current() });
stats.load();
// O prédio no Habblaud World (world/uplink.ts): só com o servidor do mundo aceito. Conecta sozinho com a conta aprovada, o
// personagem criado, a trava do terminal e sem pausa; o pacote sai só da projeção (shared/world/projection.ts).
const worldTokens = new BuildingTokens({ stats });
const worldUplink =
  world && config.world.url
    ? new BuildingUplink({
        url: worldSocketUrl(config.world.url),
        version: config.version,
        build: () => {
          const b = readBuildInfo(config.rootDir);
          return { commit: b.commit, dirty: b.dirty };
        },
        locale: () => getLocale() as WorldLocale,
        store: worldStore,
        canAct: () => config.terminal,
        agents: () => office.list(),
        subscribe: (cb) => office.onChange(cb),
        booting: () => office.isBooting(),
        tokens: () => worldTokens.read(),
        lastFile: join(config.dataDir, 'world-last-uplink.json'),
        onGoodbye: (reason) => world.goodbye(reason),
        onLeft: () => world.leftElsewhere(),
        onChange: () => office.markDirty(),
      })
    : undefined;
if (world && worldUplink) world.attachUplink(worldUplink);
// A cena Mundo (world/viewer.ts): a cidade pela mesma conexão do prédio, só com a cena aberta no navegador.
const worldViewer = worldUplink ? new WorldViewer() : undefined;
if (worldUplink && worldViewer) {
  worldViewer.attach(worldUplink);
  worldUplink.attachCity(worldViewer);
}
if (worldUplink && worldSocial) {
  worldSocial.attach(worldUplink);
  worldUplink.attachOwner(worldSocial);
}
// Terminal: só existe com bind local (ver terminalOffReason em config.ts).
// Cada agente com o parser da ferramenta dele (o do Claude Code por padrão).
const terminals = config.terminal
  ? new TerminalStreams({ office, transcriptPathOf: (id) => agents.transcriptPathOf(id), parserFor: (id) => agents.parserFor(id) })
  : undefined;
// Histórico do terminal (sessões recentes, abertas ou encerradas, de todas as ferramentas): mesma trava.
const history = config.terminal
  ? new HistorySet([new SessionHistory({ accounts: () => accounts.entries(), openAgentOf: (acc, sid) => openMainAgent(office.list(), acc, sid) })])
  : undefined;
if (history && codex) history.add(new CodexHistory({ accounts: () => accounts.entriesOf('codex'), openAgentOf: (acc, sid) => openMainAgent(office.list(), acc, sid) }));
// Entregas: o fim de cada pedido, lido dos transcripts do histórico (mesma trava do terminal). Os arquivos entregues
// são lidos aqui (Node, ou pasta de conta montada no Docker) ou pelo auxiliar do host.
const deliveries = history
  ? new DeliveryIndex({
      sessions: () => history.list(),
      resolve: (account, sessionId) => {
        const r = history.resolve(account, sessionId);
        return 'path' in r ? r : undefined;
      },
      isBusy: (id) => {
        const st = office.list().find((a) => a.id === id)?.status;
        return st === 'working' || st === 'waiting' || st === 'shell';
      },
      agentName: (id) => office.list().find((a) => a.id === id)?.name,
    })
  : undefined;
const deliveryFiles = deliveries
  ? new FileFetcher({
      direct: !config.inDocker,
      mapHostPath: (p) => {
        for (const e of accounts.entries()) {
          const host = e.detected.configDir.replace(/\/+$/, '');
          if (host && p.startsWith(`${host}/`)) return `${e.dir.replace(/\/+$/, '')}${p.slice(host.length)}`;
        }
        return undefined;
      },
    })
  : undefined;
// Linha do tempo do timelapse: grava cada snapshot novo (com throttle) em <dataDir>/timeline.
const timelineDir = join(config.dataDir, TIMELINE_DIR);
const timeline = config.timeline ? new TimelineRecorder({ dir: timelineDir }) : undefined;
if (timeline) hub.onSnapshot((snap) => timeline.ingest(snap));
// Responder pelo escritório (hook PermissionRequest): age sobre as sessões, então segue a mesma trava.
const permissions = config.terminal
  ? new PermissionRegistry({
      office,
      viewers: () => hub.localSize,
      answerLater: () => !!config.remote?.allow.has('permissions'),
      // Só o Claude Code: a busca da resposta dada no terminal lê o formato do transcript dele.
      transcriptPathOf: (id) => claude.transcriptPathOf(id),
      // Pedidos do hook do Codex: a conta pela pasta CODEX_HOME que ele manda.
      codexAccount: (account, codexHome) => codexAccountOf(accounts.entriesOf('codex'), account, codexHome),
      demoDecide: (id, d) => office.decideDemoPermission(id, d),
      demoDetail: (id) => office.demoPermission(id),
    })
  : undefined;
late.permissions = permissions;
// Mensagens pelo escritório (plugin habblaud-mensagens): entram na sessão como se você as tivesse digitado, então
// seguem a mesma trava (e HABBLAUD_MENSAGENS=0 desliga só elas). Ao Codex vão por `codex queue` (messages/codex.ts):
// fora do Docker o próprio servidor roda o comando (HABBLAUD_CODEX_BIN ou `codex` do PATH); no Docker, o auxiliar do
// host (npm run codex:bridge).
const codexBin = config.messages && !config.inDocker ? findCodexBin(process.env) : undefined;
// Terminal interativo e Novo agente: os dois rodam o Claude Code neste computador, então pedem a mesma liberação,
// HABBLAUD_PTY=1 (aceita os mesmos valores do HABBLAUD_TERMINAL).
const ptyFlag = process.env.HABBLAUD_PTY?.trim();
const ptyOptIn = isTruthy(ptyFlag);
// Novo agente pelo escritório (sessão do Claude Code em segundo plano, ou a tela do app do Claude preenchida): a
// liberação acima mais a trava das mensagens. No Docker, quem roda é o auxiliar do host (npm run codex:bridge).
const spawnOn = config.messages && ptyOptIn;
function pickAccountId(list: { id: string; dir: string }[]): string | undefined {
  const snap = hub.current();
  return pickAccountByLoad(
    list.map((a) => {
      const u = snap.accounts.find((x) => x.id === a.id)?.usage;
      return { id: a.id, connected: !cloud || existsSync(join(a.dir, '.credentials.json')), fiveHour: u?.fiveHour?.utilization, sevenDay: u?.sevenDay?.utilization };
    }),
  );
}
const attachments = spawnOn ? new AttachmentStore() : undefined;
// Anexos gravados na casa de quem roda os agentes (Cloud: o usuário "dev", dono dos arquivos; o servidor roda como root).
function saveAttachments(id: string, files: readonly Attachment[]): string[] {
  const who = agentRunAs();
  if (!who) return writeAttachments(attachmentsRoot(), id, files);
  const root = join(who.home, '.habblaud', 'attachments');
  const paths = writeAttachments(root, id, files);
  for (const p of [join(who.home, '.habblaud'), root, ...new Set(paths.map((f) => dirname(f))), ...paths]) chownSync(p, who.uid, who.gid);
  return paths;
}
const spawnBin = config.inDocker ? undefined : runnableClaudeBin(process.env);
const spawn = spawnOn
  ? new SpawnService({
      writeFiles: saveAttachments,
      ...(config.inDocker ? { attachments } : { opener: createOpener(), cli: spawnBin ? createCliRunner(spawnBin) : undefined, attachments }),
      // Cloud: a conta escolhida na tela; sem escolha ("Automática"), a de mais folga (a mesma regra das sessões novas).
      accountDir: (id) => {
        const list = accounts.entries();
        const a = (id && id !== 'auto' ? list.find((e) => e.id === id) : undefined) ?? (cloud ? list.find((e) => e.id === pickAccountId(list.map((x) => ({ id: x.id, dir: x.dir, isDefault: isDefaultDir(x.dir, config.home) })))) : undefined);
        return a && !isDefaultDir(a.dir, config.home) ? a.dir : undefined;
      },
    })
  : undefined;
// Ditado: no Docker quem transcreve é o auxiliar do host; no Node, o servidor, se achar o Whisper local.
const whisper = config.messages && !config.inDocker ? findWhisper() : undefined;
const dictation = config.messages
  ? new DictationService(whisper && !('missing' in whisper) ? { transcriber: createWhisperTranscriber(whisper) } : {})
  : undefined;
const messages = config.messages
  ? new MessageRegistry({
      office,
      demoAgent: (id) => office.demoAgent(id),
      demoDeliver: (id, text) => office.deliverDemoMessage(id, text),
      codex: {
        run: codexBin ? createCodexQueueRunner(codexBin) : undefined,
        homeOf: (account) => accounts.entriesOf('codex').find((e) => e.id === account)?.detected.configDir,
      },
    })
  : undefined;
late.messages = messages;

// Terminal interativo (abrir/assumir sessões e encerrar agentes): opt-in com HABBLAUD_PTY=1, só com bind local, fora
// do Docker, com node-pty e o executável do claude no PATH.
const claudeBinSetting = process.env.HABBLAUD_CLAUDE_BIN?.trim();
const claudeBin = claudeBinFrom();
let spawnPty: SpawnPty | null = null;
let ptyScreen: ScreenFactory | undefined;
let ptyOff: string | undefined;
if (!ptyOptIn) ptyOff = ptyFlag ? tr('desligado por HABBLAUD_PTY={0}', [ptyFlag]) : tr('desligado (ligue com HABBLAUD_PTY=1)');
else if (config.inDocker) ptyOff = tr('indisponível no Docker (rode com npm start)');
else if (!config.terminal) ptyOff = tr('mesma trava do terminal ({0})', [terminalOffReason(process.env, config.host, config.inDocker)]);
else if (!claudeBin) ptyOff = claudeBinSetting ? tr('HABBLAUD_CLAUDE_BIN não encontrado no PATH ({0})', [claudeBinSetting]) : tr('executável "claude" não encontrado no PATH (defina HABBLAUD_CLAUDE_BIN)');
else if (!isExecutableFile(claudeBin)) ptyOff = tr('o executável do Claude Code não roda: {0} (confira o HABBLAUD_CLAUDE_BIN)', [claudeBin]);
else {
  const loaded = await loadPty();
  spawnPty = loaded.spawn;
  ptyOff = loaded.reason;
  if (spawnPty) {
    const screen = await loadHeadlessScreen();
    ptyScreen = screen.create ?? undefined;
    if (screen.reason) log.warn(tr('Terminal interativo sem a tela completa ({0}): ao reconectar, modos como a colagem entre colchetes podem se perder.', [screen.reason]));
  }
}
const ptys = spawnPty
  ? new PtyManager({
      spawn: spawnPty,
      claudeBin: claudeBin ?? 'claude',
      accounts: () => accounts.entries().map((a) => ({ id: a.id, dir: a.dir, isDefault: isDefaultDir(a.dir, config.home) })),
      // Sessão nova sem conta pedida (Novo, Nova sessão, primeiro agente): a conta conectada com mais folga (o maior uso entre 5 h e
      // semana, o menor vence); sem números, a padrão. Uma conversa em andamento fica na conta dela.
      pickAccount: pickAccountId,
      agent: (id) => {
        const a = office.get(id);
        return a && { id: a.id, kind: a.kind, account: a.account, sessionId: a.sessionId, cwd: office.roomPath(a.roomId) };
      },
      onChange: () => office.markDirty(),
      createScreen: ptyScreen,
    })
  : undefined;
late.ptys = ptys;
late.ptyOff = ptyOff;
// Habblaud Cloud: conectar contas pela web roda os logins num terminal escondido, como o usuário dos agentes.
const agentUser = agentRunAs();
// Cloud: o tap de uso (cartões de 5 h e semana) entra sozinho no statusLine de cada conta do Claude Code.
const usageTapPath = join(config.rootDir, 'scripts', 'statusline-tap.mjs');
if (cloud && agentUser) ensureUsageTap(config.claudeDirs, usageTapPath);
// Cloud: uso de toda conta conectada, mesmo sem sessão (consulta com o login da conta; a cada 3 min).
if (cloud) {
  const pollUsage = () => {
    for (const e of accounts.entries()) void fetchOAuthUsage(e.dir).then((u) => u && accounts.setUsage(e.id, u));
  };
  setTimeout(pollUsage, 5_000).unref();
  setInterval(pollUsage, 180_000).unref();
}
// Cloud: mensagens e permissões pelo escritório dependem de plugins do Claude Code (marketplace = a pasta do Habblaud na imagem).
const pluginsReady: Promise<void> = cloud && agentUser && claudeBin ? ensureHabblaudPlugins(config.claudeDirs, claudeBin, config.rootDir) : Promise.resolve();
if (cloud && spawnPty && claudeBin && agentUser) {
  late.connect = new ConnectService({
    spawn: spawnPty,
    home: agentUser.home,
    env: process.env,
    claudeBin,
    codexBin: findCodexBin(process.env),
    ghBin: findExecutable('gh'),
    onClaudeDir: (dir) => {
      accounts.addDir(dir);
      ensureUsageTap([dir], usageTapPath);
      void ensureHabblaudPlugins([dir], claudeBin, config.rootDir);
    },
    onChange: () => office.markDirty(),
  });
}

if (config.demo) office.setDemo(true);
// As fontes síncronas (a do Claude Code) terminam o boot aqui, antes de o hub começar a transmitir.
void agents.start();
accounts.start();
hub.start();
if (timeline) {
  timeline.start();
  timeline.ingest(hub.current());
}
permissions?.start();
messages?.start();
stats.start();
updates.start();
updates.startAuto();
worldUplink?.start();
const ticker = setInterval(() => {
  try {
    office.tick();
  } catch (err) {
    log.warnOnce(`tick:${errMsg(err)}`, tr('Falha no relógio do escritório: {0}', [errMsg(err)]));
  }
}, 250);

const api = createApiHandler({
  renameRoom: (id, name) => {
    const path = office.roomPath(id);
    if (!path) return undefined;
    roomAliases.set(path, name);
    office.refreshRoomNames();
    return office.roomName(id);
  },
  office,
  hub,
  accounts,
  sources: () => agents.sources(),
  version: config.version,
  inDocker: config.inDocker,
  terminal: config.terminal,
  terminals,
  sessions: history,
  timeline: createTimelineHandler({ dir: timelineDir, recording: !!timeline }),
  permissions: permissions ? createPermissionRoutes(permissions) : undefined,
  messages: messages ? createMessageRoutes(messages, attachments && { store: attachments, save: saveAttachments }) : undefined,
  // Habblaud Cloud: o terminal interativo também pela porta com login, para quem tem a permissão "terminal".
  pty: ptys ? createPtyRoutes(ptys, cloud ? (req) => isRemoteRequest(req) && remoteAllows(req, 'terminal') : undefined) : undefined,
  spawn,
  attachments,
  dictation,
  deliveries,
  files: deliveryFiles,
  spawnFolders: async () => {
    const snap = hub.current();
    const last = new Map<string, number>();
    for (const a of snap.agents) last.set(a.roomId, Math.max(last.get(a.roomId) ?? 0, a.lastEventAt ?? 0));
    const rooms = snap.rooms.filter((r) => !isDemoId(r.id)).map((r) => ({ path: r.path, lastAt: last.get(r.id) ?? 0 }));
    const recent = recentFolders(history ? await history.list().catch(() => []) : [], rooms);
    return cloud ? mergeFolders(recent, workspaceFolders(WORKSPACE)) : recent;
  },
  codexLive,
  stats,
  push,
  updates: config.cloudVersion ? Object.assign(updates, { configure: configureVelix }) : updates,
  remote: config.remote ? { is: isRemoteRequest, allows: remoteAllows, isAdmin: cloud?.isAdmin } : undefined,
  world: world ? createWorldRoutes(world, worldViewer, worldSocial) : undefined,
});

const server = http.createServer();
let closeVite: (() => Promise<void>) | undefined;

function parseUrl(req: http.IncomingMessage): URL {
  try {
    return new URL(req.url ?? '/', 'http://localhost');
  } catch {
    return new URL('/', 'http://localhost');
  }
}

/** Quem atende o que não é /api: o Vite (dev) ou os arquivos de dist/client (produção). */
let fallback: (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => void;
if (config.dev) {
  // Import dinâmico: o bundle de produção nunca carrega o Vite.
  const { createServer } = await import('vite');
  const vite = await createServer({
    configFile: join(config.rootDir, 'vite.config.ts'),
    server: { middlewareMode: true, ws: { server } },
    appType: 'spa',
  });
  closeVite = () => vite.close();
  fallback = (req, res) => vite.middlewares(req, res);
} else {
  const serveStatic = createStaticHandler(join(config.rootDir, 'dist', 'client'));
  fallback = (req, res, url) => serveStatic(req, res, url.pathname);
}

// Host/Origin/Content-Type: barra DNS rebinding e CSRF antes de qualquer rota (inclusive o Vite).
const guard = createRequestGuard({ allowedHosts: config.allowedHosts });

server.on('request', (req, res) => {
  const url = parseUrl(req);
  try {
    if (guard(req, res)) return;
    if (!api(req, res, url)) fallback(req, res, url);
  } catch (err) {
    log.warn(tr('Erro ao responder {0} {1}: {2}', [req.method, url.pathname, errMsg(err)]));
    if (!res.headersSent) sendJson(res, 500, { error: tr('erro interno') });
    else res.destroy();
  }
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') log.error(tr('A porta {0} já está em uso (defina HABBLAUD_PORT para usar outra).', [config.port]));
  else log.error(tr('Erro no servidor HTTP: {0}', [errMsg(err)]));
  process.exit(1);
});

/**
 * Porta remota (celular na rede local): o mesmo app, mas toda requisição passa pelo login (http/remote.ts) antes da
 * API. A porta principal segue só local; quem separa as duas é a porta em que a conexão chegou.
 */
let remoteListener: RemoteListener | undefined;
if (config.remote) {
  const remote = config.remote;
  const gate = createRemoteGate({
    config: remote,
    sessions: remoteSessions!,
    secure: cloud ? viaHttps : !!remote.tls,
    caFile: remote.tls?.caFile,
    cloud: cloud?.gate,
  });
  remoteListener = startRemoteListener(
    remote,
    (req, res) => {
      const url = parseUrl(req);
      try {
        if (guard(req, res)) return;
        if (gate(req, res, url)) return;
        if (cloud?.api(req, res, url)) return;
        if (!api(req, res, url)) fallback(req, res, url);
      } catch (err) {
        log.warn(tr('Erro ao responder (remoto) {0} {1}: {2}', [req.method, url.pathname, errMsg(err)]));
        if (!res.headersSent) sendJson(res, 500, { error: tr('erro interno') });
        else res.destroy();
      }
    },
    log,
    config.allowedHosts,
  );
  remoteListener.server.once('listening', () => {
    if (cloud) {
      log.info(tr('   Habblaud Cloud: login com usuários na porta {0} (HTTP, para ficar atrás do proxy com HTTPS).', [remote.port]));
      const code = cloud.setupCode();
      if (code) log.info(tr('   Habblaud Cloud: primeiro acesso. Abra /setup e use o código de instalação {0}', [code]));
      return;
    }
    const allow = [...remote.allow].join(', ') || tr('só ver');
    const where = config.inDocker ? tr('publicada pelo HABBLAUD_REMOTE_BIND') : remote.host;
    const scheme = remote.tls ? 'HTTPS' : tr('HTTP SEM criptografia (HABBLAUD_REMOTE_INSECURE_HTTP)');
    log.info(tr('   Acesso remoto: ligado na porta {0} ({1}), {2}, com login; libera: {3}.', [remote.port, where, scheme, allow]));
    if (remote.allow.has('spawn') && !spawn) log.warn(tr('   Acesso remoto: "spawn" liberado, mas o Novo agente está desligado (ligue com HABBLAUD_PTY=1).'));
  });
} else if (config.remoteWarning) {
  log.warn(`   ${config.remoteWarning}.`);
}

server.listen(config.port, config.host, () => {
  const host = config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;
  log.info(tr('🏢 Habblaud {0}{1}{2} em http://{3}:{4}', [config.version, config.dev ? ' (dev)' : '', config.inDocker ? ' (docker)' : '', host, config.port]));
  const list = accounts.entries();
  if (!list.length) log.warn(tr('Nenhuma pasta do Claude Code encontrada (defina HABBLAUD_CLAUDE_DIRS).'));
  for (const dir of codexDirsRefused(process.env, config.home)) {
    log.warn(tr('{0} é uma pasta do Codex, não do Claude Code: fica fora das contas do Claude Code.', [dir]));
  }
  for (const a of list) {
    const src = agents.sources().find((s) => s.label === a.id);
    const usage = accounts.usageView(a.id).status;
    log.info(tr('   Conta {0} ({1}): {2} sessão(ões) aberta(s) · uso: {3} · {4}', [a.detected.short, a.id, src?.sessions ?? 0, usage, a.dir]));
  }
  if (codex) {
    const codexAccounts = codex.accountEntries();
    const open = codex.sources().reduce((n, s) => n + s.sessions, 0);
    log.info(tr('   Codex: {0} conta(s), {1} sessão(ões) aberta(s).', [codexAccounts.length, open]));
    for (const a of codexAccounts) {
      log.info(tr('   Conta {0} do Codex ({1}): uso: {2} · {3}', [a.detected.short, a.id, accounts.usageView(a.id).status, a.detected.configDir]));
    }
  } else {
    log.info(tr('   Codex: {0}.', [config.codex ? tr('nenhuma pasta do Codex encontrada (defina HABBLAUD_CODEX_DIRS)') : tr('desligado (HABBLAUD_CODEX=0)')]));
  }
  if (office.isDemo()) log.info(tr('   Modo demonstração ligado (agentes simulados misturados aos reais).'));
  if (config.terminal) log.info(tr('   Terminal: ligado (acesso só local).'));
  else log.info(tr('   Terminal: desligado ({0}).', [terminalOffReason(process.env, config.host, config.inDocker)]));
  log.info(ptys ? tr('   Terminal interativo: ligado ({0}).', [claudeBin]) : tr('   Terminal interativo: {0}.', [ptyOff ?? tr('desligado')]));
  log.info(
    !spawn
      ? tr('   Novo agente: desligado ({0}).', [!ptyOptIn ? tr('ligue com HABBLAUD_PTY=1') : tr('mesma trava das mensagens')])
      : config.inDocker
        ? tr('   Novo agente: ligado, pelo auxiliar do host (deixe npm run codex:bridge rodando no computador).')
        : spawnBin
          ? tr('   Novo agente: ligado ({0} --bg; pasta ainda não confiável abre no app do Claude).', [spawnBin])
          : tr('   Novo agente: ligado, só pelo app do Claude (claude não encontrado no PATH).'),
  );
  log.info(timeline ? tr('   Linha do tempo (timelapse): gravando em {0}.', [timelineDir]) : tr('   Linha do tempo (timelapse): gravação desligada (HABBLAUD_TIMELINE).'));
  log.info(tr('   Responder pelo escritório: {0}.', [config.terminal ? tr('ligado (precisa do mod: npm run mod:install; ou do hook antigo: npm run hooks:install)') : tr('desligado (mesma trava do terminal)')]));
  log.info(
    config.messages
      ? tr('   Mensagens pelo escritório: ligadas (precisa do plugin habblaud-mensagens: npm run mod:install).')
      : tr('   Mensagens pelo escritório: desligadas ({0}).', [messagesOffReason(process.env, config.host, config.inDocker)]),
  );
  if (config.messages) {
    log.info(
      codexBin
        ? tr('   Mensagens ao Codex: pelo codex queue ({0}).', [codexBin])
        : config.inDocker
          ? tr('   Mensagens ao Codex: pelo auxiliar do host (deixe npm run codex:bridge rodando no Mac).')
          : tr('   Mensagens ao Codex: sem o binário do Codex (codex no PATH ou HABBLAUD_CODEX_BIN); o auxiliar npm run codex:bridge também serve.'),
    );
  }
  if (config.world.warning) log.warn(`   ${config.world.warning}.`);
  log.info(
    !world
      ? tr('   Habblaud World: escondido (HABBLAUD_WORLD=0).')
      : !config.world.url
        ? tr('   Habblaud World: desligado (HABBLAUD_WORLD_URL recusada).')
        : tr('   Habblaud World: {0}, conta neste computador: {1}{2}.', [
            config.world.defaultUrl ? tr('{0} (padrão)', [config.world.url]) : config.world.url,
            world.state(),
            config.terminal ? '' : tr(' (só leitura: a trava do terminal está desligada)'),
          ]),
  );
  log.info(
    updates.enabled
      ? config.cloudVersion
        ? tr('   Versão nova: verificando as tags de ghcr.io/{0} a cada 6 h{1}.', [config.repo, velix ? tr(' (botão Atualizar ligado ao Velix)') : tr(' (sem HABBLAUD_VELIX_*: só avisa)')])
        : tr('   Versão nova: verificando as releases de github.com/{0} a cada 6 h.', [config.repo])
      : tr('   Versão nova: verificação desligada ({0}).', [config.repo ? 'HABBLAUD_UPDATE_CHECK' : tr('package.json sem repositório no GitHub')]),
  );
});

// Cloud: a versão baixada (<dados>/app) só vale se o servidor ficar de pé; passado 1 minuto no ar, tira o marcador de "subindo".
if (cloud) setTimeout(() => rmSync(join(config.dataDir, 'app', 'booting'), { force: true }), 60_000).unref();

// Cloud: guarda quem está ativo (a cada 10 s) e retoma essas conversas ao subir; congela a lista ao encerrar, antes de os
// processos morrerem junto com o container.
let persistLive = true;
if (cloud && agentUser && ptys) {
  const liveFile = join(config.dataDir, 'live-agents.json');
  const wasLive = loadLiveAgents(liveFile);
  const liveNow = (): LiveAgent[] => {
    const snap = hub.current();
    const out: LiveAgent[] = [];
    for (const a of snap.agents) {
      const cwd = snap.rooms.find((r) => r.id === a.roomId)?.path;
      if (a.kind === 'main' && a.sessionId && a.status !== 'offline' && cwd && !isDemoId(a.id)) out.push({ account: a.account, sessionId: a.sessionId, cwd });
    }
    return out;
  };
  // Só depois de os plugins estarem instalados: uma sessão que começa antes deles nunca carrega o plugin de mensagens.
  void pluginsReady.then(() =>
    setTimeout(() => {
      const present = new Set(liveNow().map((a) => a.sessionId));
      for (const a of wasLive) {
        if (present.has(a.sessionId)) continue;
        try {
          ptys.resume(a);
          log.info(tr('Retomando a conversa {0} em {1}.', [a.sessionId, a.cwd]));
        } catch (err) {
          log.warn(tr('Não deu para retomar {0}: {1}', [a.sessionId, errMsg(err)]));
        }
      }
    }, 3_000).unref(),
  );
  const liveBootAt = Date.now();
  // Escritório vazio ao subir (nada para retomar, ou a retomada falhou): abre um primeiro agente em /workspace, como o botão
  // "Abrir terminal", para o escritório já abrir funcionando. Só com uma conta do Claude conectada; HABBLAUD_AUTO_AGENT=0 desliga.
  void pluginsReady.then(() =>
    setTimeout(() => {
      if (process.env.HABBLAUD_AUTO_AGENT === '0' || liveNow().length > 0) return;
      if (!config.claudeDirs.some((d) => existsSync(join(d, '.credentials.json')))) return;
      try {
        ptys.create({ cwd: '/workspace' });
        log.info(tr('Escritório vazio: abri um primeiro agente em /workspace.'));
      } catch (err) {
        log.warn(tr('Não deu para abrir o primeiro agente: {0}', [errMsg(err)]));
      }
    }, 30_000).unref(),
  );
  setInterval(() => {
    // Só depois de as conversas retomadas aparecerem (senão a foto perderia quem ainda está voltando).
    if (!persistLive || shuttingDown || Date.now() - liveBootAt < 45_000) return;
    try {
      saveLiveAgents(liveFile, liveNow());
    } catch (err) {
      log.warnOnce('live-agents', tr('Não deu para guardar os agentes ativos: {0}', [errMsg(err)]));
    }
  }, 10_000).unref();
}

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  persistLive = false;
  log.info(tr('Encerrando ({0})…', [signal]));
  clearInterval(ticker);
  stats.stop();
  agents.stop();
  accounts.stop();
  hub.stop();
  terminals?.stop();
  timeline?.stop();
  permissions?.stop();
  messages?.stop();
  ptys?.stopAll();
  updates.stop();
  worldViewer?.stop();
  worldUplink?.stop();
  world?.stop();
  names.flush();
  void closeVite?.();
  remoteListener?.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1_500).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
