// Habblaud Cloud (HABBLAUD_CLOUD=1): telas e API de usuários da porta remota (http/remote.ts).
//
// Sem login: /setup (criar o admin, com o código de instalação que sai no log) e /convite/<token> (aceitar convite).
// Com login: /admin (só admin) e /api/cloud/*. Quem pode o quê no escritório: `allows(req, feature)`, pela lista do
// usuário (cloud/users.ts).
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getLocale, tr } from '../../shared/i18n';
import type { ConnectProvider, ConnectService } from '../cloud/connect';
import { authPage, BRAND, ICON } from './auth-shell';
import { FEATURES, UserError, allowedOf, cleanAllow, type Role, type UserStore } from '../cloud/users';
import {
  LoginThrottle,
  PAGE_STYLE,
  cookieHeader,
  esc,
  readBody,
  remoteUserOf,
  safeEqual,
  sendHtml,
  sendJson,
  type CloudGate,
  type RemoteFeature,
  type RemoteSessions,
} from './remote';

export interface CloudDeps {
  store: UserStore;
  sessions: RemoteSessions;
  secure: (req: IncomingMessage) => boolean;
  throttle?: LoginThrottle;
  /** Conectar contas pela web (Claude, Codex, GitHub); ausente = recurso desligado. */
  connect?: () => ConnectService | undefined;
  /** Código de instalação: HABBLAUD_SETUP_CODE (a loja do Velix sorteia e mostra em "Credenciais") ou aleatório. */
  setupCode?: string;
}

export interface Cloud {
  gate: CloudGate;
  /** Rotas com login (/admin, /api/cloud/*); true quando já respondeu. */
  api(req: IncomingMessage, res: ServerResponse, url: URL): boolean;
  allows(req: IncomingMessage, feature: RemoteFeature): boolean;
  isAdmin(req: IncomingMessage): boolean;
  /** Código para criar o admin; undefined depois de usado. */
  setupCode(): string | undefined;
}

/** 12 letras e números sem os que se confundem, em três grupos (ex.: K7QF-3MZP-WX9D). */
function newSetupCode(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const chars = [...randomBytes(12)].map((b) => abc[b % abc.length]).join('');
  return chars.match(/.{4}/g)!.join('-');
}

const js = (text: string) => JSON.stringify(text).replace(/</g, '\\u003c');

function shell(title: string, body: string, script: string): string {
  return `<!doctype html>
<html lang="${getLocale()}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
${PAGE_STYLE}
<style>
  form.wide, main { max-width: 760px; }
  main { width: 100%; background: #1e2130; border: 2px solid #3a3f58; border-radius: 10px; padding: 24px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 24px; }
  th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #3a3f58; vertical-align: top; }
  td label, fieldset label { display: inline-flex; gap: 4px; align-items: center; margin: 0 10px 4px 0; color: #e8e6df; }
  input[type=checkbox] { width: auto; }
  select { padding: 6px; font: inherit; color: inherit; background: #14161f; border: 2px solid #3a3f58; border-radius: 6px; }
  button.small { width: auto; margin: 0; padding: 6px 10px; font-size: 13px; }
  button.ghost { background: transparent; color: #f4c95d; border: 2px solid #3a3f58; }
  fieldset { border: 0; padding: 0; margin: 12px 0 0; }
  h2 { font-size: 16px; color: #f4c95d; margin: 24px 0 8px; }
  #link { word-break: break-all; color: #e8e6df; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .tabs { display: flex; gap: 4px; flex-wrap: wrap; border-bottom: 2px solid #3a3f58; margin: -8px 0 20px; }
  .tabs a { padding: 8px 12px; color: #9aa0b8; text-decoration: none; border-bottom: 2px solid transparent; margin-bottom: -2px; }
  .tabs a:hover { color: #e8e6df; }
  .tabs a.on { color: #f4c95d; border-bottom-color: #f4c95d; }
  .card { background: #14161f; border: 2px solid #3a3f58; border-radius: 8px; padding: 16px; margin: 16px 0; }
  .card h2 { margin: 0; font-size: 17px; }
  .card p { margin: 4px 0 12px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .head .ttl { flex: 1; min-width: 0; }
  .head .ttl p { margin: 2px 0 0; }
  .card { border-radius: 16px; padding: 16px; transition: opacity .15s; }
  .card.on { border-color: #3d6b4a; background: #172421; }
  .card.off { opacity: .85; }
  .tile { flex: none; width: 46px; height: 46px; border-radius: 13px; display: grid; place-items: center; font-weight: 800; font-size: 20px; color: #fff; }
  .t-claude { background: linear-gradient(160deg, #ffa24a, #e4572a); }
  .t-codex { background: linear-gradient(160deg, #7b97ff, #4a56e2); }
  .t-github { background: linear-gradient(160deg, #565c78, #2a2d3d); }
  .pill { font-size: 12px; padding: 2px 8px; border-radius: 99px; border: 1px solid #3a3f58; color: #9aa0b8; }
  .pill.on { color: #7bd88f; border-color: #7bd88f; }
  .card ul { list-style: none; margin: 0 0 12px; padding: 0; }
  .card li { padding: 6px 0; word-break: break-all; }
  .card li.ok::before { content: '✓ '; color: #7bd88f; }
  .card li.none { color: #9aa0b8; }
  .repos { display: grid; gap: 8px; margin-top: 12px; max-height: 480px; overflow-y: auto; }
  .repo { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; background: #1e2130; border: 1px solid #3a3f58; border-radius: 6px; }
  .repo b { display: block; word-break: break-all; }
  .repo small { color: #9aa0b8; }
  .repo .lock { color: #f4c95d; }
  .repo button.small { flex: none; }
  .job:empty { display: none; }
  .job { border-top: 1px solid #3a3f58; margin-top: 12px; padding-top: 12px; }
  .job .code { font-size: 28px; letter-spacing: 4px; color: #f4c95d; margin: 4px 0 12px; }
  .job a.btn { display: inline-block; padding: 8px 12px; background: #f4c95d; color: #14161f; border-radius: 6px; font-weight: 700; text-decoration: none; margin-bottom: 12px; }
  .job input { margin-bottom: 8px; }
  .job .bad { color: #ff8a80; }
  @media (max-width: 640px) {
    body { padding: 8px; place-items: start center; }
    main { padding: 14px; }
    h1 { font-size: 20px; }
    table { display: block; overflow-x: auto; }
    .tabs a { padding: 8px 10px; }
    .repo { flex-wrap: wrap; }
    .job .code { font-size: 22px; letter-spacing: 2px; }
  }
</style>
</head>
<body>
${body}
<script>
${script}
</script>
</body>
</html>
`;
}

/** Formulário simples que manda JSON e, se der certo, vai para "/". */
function formPage(opts: { title: string; intro: string; fields: { id: string; label: string; type?: string; auto?: string }[]; endpoint: string; submit: string; extra?: Record<string, string> }): string {
  const icon = (f: { id: string; type?: string }) => (f.type === 'password' ? ICON.lock : ICON.user);
  const fields = opts.fields
    .map((f) => `<label class="l" for="${f.id}">${esc(f.label)}</label>
  <div class="field">${icon(f)}<input id="${f.id}" name="${f.id}" type="${f.type ?? 'text'}" autocomplete="${f.auto ?? 'off'}" autocapitalize="none" autocorrect="off" spellcheck="false" required></div>`)
    .join('\n  ');
  const card = `<h1>${BRAND}</h1>
<p class="sub">${esc(opts.intro)}</p>
<form id="f" novalidate>
  <div id="err" class="alert err" role="alert"></div>
  ${fields}
  <button id="b" class="btn" type="submit"><span class="spin" aria-hidden="true"></span><span>${esc(opts.submit)}</span></button>
</form>`;
  const script = `(function () {
  const f = document.getElementById('f'), b = document.getElementById('b'), err = document.getElementById('err');
  const ids = ${JSON.stringify(opts.fields.map((x) => x.id))}, extra = ${JSON.stringify(opts.extra ?? {}).replace(/</g, '\\u003c')};
  function fail(t) { err.textContent = t; err.className = 'alert err on'; void err.offsetWidth; err.className = 'alert err on shake'; }
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (f.password2 && f.password2.value !== f.password.value) return fail(${js(tr('As senhas não conferem.'))});
    b.disabled = true; b.classList.add('busy'); err.className = 'alert err';
    const body = { ...extra };
    for (const id of ids) if (id !== 'password2') body[id] = f[id].value;
    try {
      const r = await fetch(${js(opts.endpoint)}, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
      if (r.ok) { location.replace('/'); return; }
      const j = await r.json().catch(() => ({}));
      fail(j.error || ${js(tr('Não deu certo.'))});
    } catch { fail(${js(tr('Sem conexão com o DevLand.'))}); }
    b.disabled = false; b.classList.remove('busy');
  });
})();`;
  return authPage({ title: opts.title, card, script, barTitle: 'setup — bash' });
}

function featureLabels(): Record<RemoteFeature, string> {
  return {
    permissions: tr('Responder pedidos de permissão'),
    messages: tr('Mandar mensagens aos agentes'),
    terminal: tr('Ver e usar o terminal'),
    spawn: tr('Abrir agentes novos'),
  };
}

/** Abas das páginas do Cloud: o escritório, as contas, os usuários (admin) e as configurações (abrem no escritório). */
function tabs(active: 'accounts' | 'users', isAdmin: boolean): string {
  const tab = (href: string, label: string, on = false) => `<a href="${href}"${on ? ' class="on" aria-current="page"' : ''}>${esc(label)}</a>`;
  return `<nav class="tabs">${tab('/', tr('Escritório'))}${tab('/contas', tr('Contas'), active === 'accounts')}${isAdmin ? tab('/admin', tr('Usuários'), active === 'users') : ''}${tab('/?settings', tr('Configurações'))}</nav>`;
}

function adminPage(): string {
  const labels = featureLabels();
  const t = {
    remove: tr('Remover'),
    confirmRemove: tr('Remover {0}? As sessões dele caem na hora.'),
    admin: tr('Admin'),
    user: tr('Usuário'),
    you: tr('(você)'),
    copied: tr('Link copiado.'),
    expires: tr('Vale por 7 dias e uma vez só.'),
    failed: tr('Não deu certo.'),
    allPerms: tr('todas'),
  };
  const body = `<main>
  ${tabs('users', true)}
  <h1>${esc(tr('Usuários'))}</h1>
  <p>${esc(tr('Todos veem o escritório inteiro; as permissões dizem o que cada um pode fazer nele.'))}</p>
  <table><thead><tr><th>${esc(tr('Nome'))}</th><th>${esc(tr('Papel'))}</th><th>${esc(tr('Permissões'))}</th><th></th></tr></thead><tbody id="users"></tbody></table>
  <h2>${esc(tr('Convidar'))}</h2>
  <div class="row"><select id="irole"><option value="user">${esc(t.user)}</option><option value="admin">${esc(t.admin)}</option></select></div>
  <fieldset id="iperms">${FEATURES.map((f) => `<label><input type="checkbox" value="${f}"${f === 'permissions' ? ' checked' : ''}> ${esc(labels[f])}</label>`).join('')}</fieldset>
  <button id="invite" class="small">${esc(tr('Gerar link de convite'))}</button>
  <p id="out" hidden><span id="link"></span><br><button id="copy" class="small ghost">${esc(tr('Copiar'))}</button> ${esc(t.expires)}</p>
  <h2>${esc(tr('Este aparelho'))}</h2>
  <button id="all" class="small ghost">${esc(tr('Sair de todos os aparelhos'))}</button>
  <div id="err" role="alert"></div>
</main>`;
  const script = `const T = ${JSON.stringify(t).replace(/</g, '\\u003c')}, L = ${JSON.stringify(labels).replace(/</g, '\\u003c')}, F = ${JSON.stringify(FEATURES)};
  const $ = (id) => document.getElementById(id), err = $('err');
  const call = async (method, url, body) => {
    err.textContent = '';
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { err.textContent = j.error || T.failed; throw new Error(); }
    return j;
  };
  const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  async function load() {
    const { users, me } = await call('GET', '/api/cloud/users');
    const tb = $('users'); tb.replaceChildren();
    for (const u of users) {
      const role = el('select', {}, el('option', { value: 'user', textContent: T.user }), el('option', { value: 'admin', textContent: T.admin }));
      role.value = u.role;
      role.onchange = () => call('PATCH', '/api/cloud/users/' + u.id, { role: role.value }).then(load, load);
      const perms = el('td');
      if (u.role === 'admin') perms.textContent = T.allPerms;
      else for (const f of F) {
        const cb = el('input', { type: 'checkbox', checked: u.allow.includes(f) });
        cb.onchange = () => call('PATCH', '/api/cloud/users/' + u.id, { allow: F.filter((x, i) => perms.querySelectorAll('input')[i].checked) }).catch(load);
        perms.append(el('label', {}, cb, ' ' + L[f]));
      }
      const rm = el('button', { className: 'small ghost', textContent: T.remove });
      rm.onclick = () => { if (confirm(T.confirmRemove.replace('{0}', u.name))) call('DELETE', '/api/cloud/users/' + u.id).then(load, load); };
      tb.append(el('tr', {}, el('td', { textContent: u.name + (u.email ? ' · ' + u.email : '') + (u.id === me ? ' ' + T.you : '') }), el('td', {}, role), perms, el('td', {}, rm)));
    }
  }
  $('irole').onchange = () => { $('iperms').hidden = $('irole').value === 'admin'; };
  $('invite').onclick = async () => {
    const allow = [...$('iperms').querySelectorAll('input:checked')].map((i) => i.value);
    const { path } = await call('POST', '/api/cloud/invites', { role: $('irole').value, allow });
    $('link').textContent = location.origin + path; $('out').hidden = false;
  };
  $('copy').onclick = () => navigator.clipboard?.writeText($('link').textContent).then(() => { err.textContent = T.copied; });
  $('all').onclick = async () => { await call('POST', '/api/cloud/logout-all', {}); location.replace('/login'); };
  load().catch(() => {});`;
  return shell(tr('DevLand · usuários'), body, script);
}

function accountsPage(isAdmin: boolean, embed = false): string {
  const t = {
    connect: tr('Conectar'),
    none: tr('Nenhuma conta conectada.'),
    openAnthropic: tr('1. Entrar com a Anthropic'),
    pasteHint: tr('2. Depois de autorizar, a Anthropic mostra um código. Cole aqui:'),
    send: tr('Enviar código'),
    openLink: tr('1. Abrir a página de login'),
    typeCode: tr('2. Digite este código lá:'),
    waiting: tr('Esperando você terminar o login na outra aba...'),
    done: tr('Conta conectada.'),
    failed: tr('O login não deu certo:'),
    starting: tr('Preparando o login...'),
    clone: tr('Clonar'),
    cloned: tr('Já está em /workspace'),
    cloning: tr('Clonando...'),
    clonedTo: tr('Clonado em {0}'),
    failedGeneric: tr('Não deu certo.'),
    unavailable: tr('não instalado neste servidor'),
    private: tr('privado'),
    on: tr('Conectado'),
    off: tr('Não conectado'),
    another: tr('Adicionar outra conta'),
    copy: tr('Copiar'),
    copied: tr('Copiado'),
    search: tr('Buscar projeto...'),
    nothing: tr('Nenhum projeto encontrado.'),
    ready: tr('Pronto'),
  };
  const tiles: Record<string, string> = { claude: 'C', codex: 'X', github: 'G' };
  const section = (id: string, title: string, intro: string) =>
    `<section class="card off" id="${id}-card"><div class="head"><span class="tile t-${id}" aria-hidden="true">${tiles[id]}</span><div class="ttl"><h2>${esc(title)}</h2><p>${esc(intro)}</p></div><span class="pill" id="${id}-pill"></span></div><ul id="${id}-list"></ul>${isAdmin ? `<button class="small" data-connect="${id}">${esc(t.connect)}</button>` : ''}<div id="${id}-job" class="job"></div></section>`;
  const body = `${embed ? '<style>body { display: block; padding: 0; min-height: 0; background: #1e2130; } main { border: 0; border-radius: 0; padding: 4px 12px 20px; max-width: none; } .card { margin: 10px 0; }</style>' : ''}<main>
  ${embed ? '' : tabs('accounts', isAdmin)}
  <h1>${esc(tr('Contas'))}</h1>
  <p>${esc(tr('As contas são da instalação: os agentes de todos usam as contas conectadas aqui.'))}</p>
  ${section('claude', 'Claude Code', tr('Assinatura do Claude (Pro/Max) ou conta da Anthropic.'))}
  ${section('codex', 'Codex', tr('Conta do ChatGPT para o Codex.'))}
  ${section('github', 'GitHub', tr('Para clonar projetos e para os agentes fazerem git push.'))}
  <section class="card" id="repos-box" hidden><div class="head"><h2>${esc(tr('Projetos do GitHub'))}</h2><span class="pill" id="repos-count"></span></div><p>${esc(tr('Clone um projeto para /workspace; ele aparece em Novo agente para escolher.'))}</p><input id="repos-q" type="search" autocomplete="off"><div id="repos" class="repos"></div></section>
  <div id="err" role="alert"></div>
</main>`;
  const script = `const T = ${JSON.stringify(t).replace(/</g, '\\u003c')}, ADMIN = ${isAdmin};
  const $ = (id) => document.getElementById(id), err = $('err');
  const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  const call = async (method, url, body) => {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || T.failedGeneric);
    return j;
  };
  let hasGithub = false;
  async function loadAccounts() {
    if (!ADMIN) { hasGithub = true; return; }
    const { accounts, available } = await call('GET', '/api/cloud/accounts');
    for (const p of ['claude', 'codex', 'github']) {
      const mine = accounts.filter((a) => a.provider === p);
      const ul = $(p + '-list'); ul.replaceChildren(...mine.map((a) => el('li', { className: 'ok', textContent: a.label })));
      if (!mine.length) ul.append(el('li', { className: 'none', textContent: available[p] ? T.none : T.unavailable }));
      const pill = $(p + '-pill'); pill.textContent = mine.length ? T.on : T.off; pill.className = 'pill' + (mine.length ? ' on' : '');
      $(p + '-card').className = 'card ' + (mine.length ? 'on' : 'off');
      const btn = document.querySelector('[data-connect="' + p + '"]');
      if (btn) { btn.hidden = !available[p] || (p !== 'claude' && mine.length > 0); btn.textContent = mine.length ? T.another : T.connect; }
    }
    hasGithub = accounts.some((a) => a.provider === 'github');
  }
  let repoList = [];
  function drawRepos() {
    const q = $('repos-q').value.trim().toLowerCase();
    const shown = repoList.filter((r) => r.name.toLowerCase().includes(q));
    $('repos-count').textContent = String(repoList.length);
    $('repos').replaceChildren(...(shown.length ? shown.map((r) => {
      const [owner, name] = r.name.split('/');
      const b = el('button', { className: 'small' + (r.cloned ? ' ghost' : ''), textContent: r.cloned ? '✓ ' + T.ready : T.clone, disabled: r.cloned });
      b.onclick = async () => {
        b.disabled = true; b.textContent = T.cloning;
        try { const { dir } = await call('POST', '/api/cloud/github/clone', { repo: r.name }); r.cloned = true; b.className = 'small ghost'; b.textContent = '✓ ' + T.ready; sub.textContent = dir; }
        catch (e) { b.disabled = false; b.textContent = T.clone; err.textContent = e.message; }
      };
      const sub = el('small', { textContent: r.cloned ? T.cloned : owner + (r.private ? ' · 🔒 ' + T.private : '') });
      return el('div', { className: 'repo' }, el('div', {}, el('b', { textContent: name }), sub), b);
    }) : [el('p', { textContent: T.nothing })]));
  }
  async function loadRepos() {
    if (!hasGithub) return;
    try {
      const { repos } = await call('GET', '/api/cloud/github/repos');
      repoList = repos; $('repos-box').hidden = false; $('repos-q').placeholder = T.search; $('repos-q').oninput = drawRepos; drawRepos();
    } catch (e) { err.textContent = e.message; }
  }
  function renderJob(box, job) {
    box.replaceChildren();
    if (job.state === 'starting') return box.append(el('p', { textContent: T.starting }));
    if (job.state === 'done') return; // a lista de contas acima já mostra o resultado
    if (job.state === 'failed') return box.append(el('p', { className: 'bad', textContent: T.failed + ' ' + (job.error || '') }));
    const open = el('a', { className: 'btn', href: job.url, target: '_blank', rel: 'noopener noreferrer', textContent: job.needsPaste ? T.openAnthropic : T.openLink });
    if (job.needsPaste) {
      const input = el('input', { placeholder: 'code#state', autocomplete: 'off', spellcheck: false });
      const send = el('button', { className: 'small', textContent: T.send });
      send.onclick = async () => { send.disabled = true; try { await call('POST', '/api/cloud/connect/' + job.id + '/code', { code: input.value }); } catch (e) { err.textContent = e.message; send.disabled = false; } };
      box.append(open, el('p', { textContent: T.pasteHint }), input, send);
    } else {
      const copy = el('button', { className: 'small ghost', textContent: T.copy });
      copy.onclick = () => navigator.clipboard?.writeText(job.code).then(() => { copy.textContent = T.copied; });
      box.append(open, el('p', { textContent: T.typeCode }), el('div', { className: 'code', textContent: job.code }), copy, el('p', { textContent: T.waiting }));
    }
  }
  for (const btn of document.querySelectorAll('[data-connect]')) {
    btn.onclick = async () => {
      const p = btn.dataset.connect, box = $(p + '-job');
      err.textContent = ''; btn.disabled = true;
      try {
        let job = await call('POST', '/api/cloud/connect', { provider: p });
        let shown = '';
        while (job.state === 'starting' || job.state === 'waiting') {
          const key = job.state + (job.url || '') + (job.code || '');
          if (key !== shown) { renderJob(box, job); shown = key; }
          await new Promise((r) => setTimeout(r, 1500));
          job = await call('GET', '/api/cloud/connect/' + job.id);
        }
        renderJob(box, job);
        await loadAccounts(); await loadRepos();
      } catch (e) { err.textContent = e.message; }
      btn.disabled = false;
    };
  }
  loadAccounts().then(loadRepos).catch((e) => { err.textContent = e.message; });`;
  return shell(tr('DevLand · contas'), body, script);
}

function redirect(res: ServerResponse, to: string): void {
  res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' });
  res.end();
}

async function json(req: IncomingMessage): Promise<Record<string, unknown>> {
  try {
    const v: unknown = JSON.parse(await readBody(req));
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const role = (v: unknown): Role | undefined => (v === 'admin' || v === 'user' ? v : undefined);

export function createCloud(deps: CloudDeps): Cloud {
  const { store, sessions } = deps;
  const throttle = deps.throttle ?? new LoginThrottle();
  let code: string | undefined = store.isEmpty() ? (deps.setupCode ?? newSetupCode()) : undefined;

  const signIn = (req: IncomingMessage, res: ServerResponse, uid: string) => {
    const { token, maxAgeS } = sessions.issue(uid);
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(token, maxAgeS, deps.secure(req)) });
  };
  const fail = (res: ServerResponse, err: unknown) => {
    if (res.headersSent) return;
    if (err instanceof UserError) sendJson(res, 400, { error: err.message });
    else sendJson(res, 400, { error: tr('requisição inválida') });
  };
  /** Uma tentativa com freio (código de instalação, convite): as mesmas regras do login. */
  const guarded = (req: IncomingMessage, res: ServerResponse, run: (body: Record<string, unknown>) => Promise<boolean>) => {
    if (throttle.retryAfter() > 0 || !throttle.begin()) {
      req.resume();
      const wait = Math.max(1, throttle.retryAfter());
      return sendJson(res, 429, { error: tr('Muitas tentativas. Tente de novo em {0} s.', [wait]) }, { 'Retry-After': String(wait) });
    }
    let ok = false;
    json(req)
      .then(async (body) => {
        ok = await run(body);
      })
      .catch((err) => fail(res, err))
      .finally(() => throttle.end(ok));
  };
  const userOf = (req: IncomingMessage) => {
    const uid = remoteUserOf(req);
    return uid === undefined ? undefined : store.get(uid);
  };

  const gate: CloudGate = {
    async login(name, password) {
      return (await store.verify(name, password))?.id;
    },
    needsSetup: () => store.isEmpty(),
    publicRoute(req, res, url) {
      const path = url.pathname;
      const method = req.method ?? 'GET';
      if (path === '/setup') {
        req.resume();
        if (!store.isEmpty() || !code) redirect(res, '/login');
        else
          sendHtml(
            res,
            formPage({
              title: tr('DevLand · criar admin'),
              intro: tr('Primeiro acesso: crie a conta de admin. O código de instalação aparece no Velix, em Credenciais do app, e no log do container.'),
              fields: [
                { id: 'code', label: tr('Código de instalação') },
                { id: 'name', label: tr('Usuário'), auto: 'username' },
                { id: 'email', label: tr('E-mail'), type: 'email', auto: 'email' },
                { id: 'password', label: tr('Senha (mínimo de 10 caracteres)'), type: 'password', auto: 'new-password' },
                { id: 'password2', label: tr('Repita a senha'), type: 'password', auto: 'new-password' },
              ],
              endpoint: '/api/cloud/setup',
              submit: tr('Criar admin'),
            }),
          );
        return true;
      }
      if (path === '/api/cloud/setup') {
        if (method !== 'POST') {
          req.resume();
          sendJson(res, 405, { error: tr('método não permitido') }, { Allow: 'POST' });
          return true;
        }
        guarded(req, res, async (body) => {
          if (!store.isEmpty() || !code) {
            sendJson(res, 409, { error: tr('O admin já foi criado. Entre pela tela de login.') });
            return false;
          }
          // O código sorteado aqui é maiúsculo (aceita digitado em minúsculas); o que vem do ambiente vale como está.
          const typed = str(body.code).trim();
          if (!safeEqual(typed, code) && !safeEqual(typed.toUpperCase(), code)) {
            sendJson(res, 401, { error: tr('Código de instalação incorreto.') });
            return false;
          }
          const admin = await store.create(str(body.name), str(body.password), 'admin', [], str(body.email));
          code = undefined;
          signIn(req, res, admin.id);
          return true;
        });
        return true;
      }
      const invite = /^\/convite\/([A-Za-z0-9_-]{1,64})$/.exec(path);
      if (invite) {
        req.resume();
        if (!store.inviteValid(invite[1])) {
          sendHtml(res, shell(tr('DevLand · convite'), `<form><h1>DevLand</h1><p>${esc(tr('Convite inválido, vencido ou já usado. Peça um novo a quem administra o DevLand.'))}</p><a href="/login">${esc(tr('Ir para o login'))}</a></form>`, ''));
        } else
          sendHtml(
            res,
            formPage({
              title: tr('DevLand · convite'),
              intro: tr('Você foi convidado para o DevLand. Escolha seu usuário e senha.'),
              fields: [
                { id: 'name', label: tr('Usuário'), auto: 'username' },
                { id: 'email', label: tr('E-mail'), type: 'email', auto: 'email' },
                { id: 'password', label: tr('Senha (mínimo de 10 caracteres)'), type: 'password', auto: 'new-password' },
                { id: 'password2', label: tr('Repita a senha'), type: 'password', auto: 'new-password' },
              ],
              endpoint: '/api/cloud/invite',
              submit: tr('Criar conta'),
              extra: { token: invite[1] },
            }),
          );
        return true;
      }
      if (path === '/api/cloud/invite') {
        if (method !== 'POST') {
          req.resume();
          sendJson(res, 405, { error: tr('método não permitido') }, { Allow: 'POST' });
          return true;
        }
        guarded(req, res, async (body) => {
          const user = await store.acceptInvite(str(body.token), str(body.name), str(body.password), str(body.email));
          signIn(req, res, user.id);
          return true;
        });
        return true;
      }
      return false;
    },
  };

  const api = (req: IncomingMessage, res: ServerResponse, url: URL): boolean => {
    const path = url.pathname;
    if (path !== '/admin' && path !== '/contas' && !path.startsWith('/api/cloud/')) return false;
    const me = userOf(req);
    const method = req.method ?? 'GET';
    if (!me) {
      req.resume();
      sendJson(res, 401, { error: tr('faça login') });
      return true;
    }
    if (path === '/contas') {
      req.resume();
      if (!deps.connect?.()) redirect(res, '/');
      else sendHtml(res, accountsPage(me.role === 'admin', url.searchParams.has('embed')), true);
      return true;
    }
    if (path === '/api/cloud/me') {
      req.resume();
      sendJson(res, 200, { id: me.id, name: me.name, email: me.email ?? null, role: me.role, allow: [...allowedOf(me)] });
      return true;
    }
    if (path === '/api/cloud/email' && method === 'POST') {
      json(req)
        .then((body) => sendJson(res, 200, { ok: true, email: store.setEmail(me.id, str(body.email)).email }))
        .catch((err) => fail(res, err));
      return true;
    }
    if (path === '/api/cloud/logout-all' && method === 'POST') {
      req.resume();
      store.bumpEpoch(me.id);
      sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader('', 0, deps.secure(req)) });
      return true;
    }
    const connect = deps.connect?.();
    const reply = (p: Promise<unknown>) =>
      p.then((body) => sendJson(res, 200, body)).catch((err: unknown) => sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) }));
    // GitHub: listar e clonar valem para quem pode usar o terminal (os agentes trabalham em /workspace).
    if (path === '/api/cloud/github/repos' || path === '/api/cloud/github/clone') {
      if (!connect || !allowedOf(me).has('terminal')) {
        req.resume();
        sendJson(res, 403, { error: tr('Precisa da permissão de terminal.') });
      } else if (path === '/api/cloud/github/repos') {
        req.resume();
        reply(connect.repos().then((repos) => ({ repos })));
      } else if (method === 'POST') {
        reply(json(req).then(async (body) => ({ dir: await connect.clone(str(body.repo)) })));
      } else {
        req.resume();
        sendJson(res, 405, { error: tr('método não permitido') }, { Allow: 'POST' });
      }
      return true;
    }
    if (me.role !== 'admin') {
      req.resume();
      if (path === '/admin') redirect(res, '/');
      else sendJson(res, 403, { error: tr('Só admin.') });
      return true;
    }
    if (path === '/admin') {
      req.resume();
      sendHtml(res, adminPage());
      return true;
    }
    // Contas da instalação: só admin conecta.
    if (path === '/api/cloud/accounts' || path.startsWith('/api/cloud/connect')) {
      if (!connect) {
        req.resume();
        sendJson(res, 404, { error: tr('Conectar contas pela web está desligado.') });
        return true;
      }
      const job = /^\/api\/cloud\/connect\/([0-9a-f-]{36})(\/code)?$/.exec(path);
      if (path === '/api/cloud/accounts') {
        req.resume();
        const available = { claude: connect.available('claude'), codex: connect.available('codex'), github: connect.available('github') };
        reply(connect.accounts().then((accounts) => ({ accounts, available })));
      } else if (path === '/api/cloud/connect' && method === 'POST') {
        reply(json(req).then((body) => {
          const p = body.provider;
          if (p !== 'claude' && p !== 'codex' && p !== 'github') throw new Error(tr('ferramenta inválida'));
          return connect.start(p as ConnectProvider);
        }));
      } else if (job && !job[2] && method === 'GET') {
        req.resume();
        const v = connect.get(job[1]);
        if (v) sendJson(res, 200, v);
        else sendJson(res, 404, { error: tr('não encontrado') });
      } else if (job && job[2] && method === 'POST') {
        reply(json(req).then((body) => connect.paste(job[1], str(body.code))));
      } else {
        req.resume();
        sendJson(res, 404, { error: tr('não encontrado') });
      }
      return true;
    }
    if (path === '/api/cloud/users' && method === 'GET') {
      req.resume();
      sendJson(res, 200, { users: store.list(), me: me.id });
      return true;
    }
    const one = /^\/api\/cloud\/users\/([0-9a-f-]{36})$/.exec(path);
    if (one && method === 'DELETE') {
      req.resume();
      try {
        store.remove(one[1]);
        sendJson(res, 200, { ok: true });
      } catch (err) {
        fail(res, err);
      }
      return true;
    }
    if (one && method === 'PATCH') {
      json(req)
        .then((body) => {
          const u = store.update(one[1], { role: role(body.role), allow: body.allow === undefined ? undefined : cleanAllow(body.allow) });
          sendJson(res, 200, { ok: true, user: { id: u.id, role: u.role, allow: u.allow } });
        })
        .catch((err) => fail(res, err));
      return true;
    }
    if (path === '/api/cloud/invites' && method === 'POST') {
      json(req)
        .then((body) => {
          const { token, expiresAt } = store.createInvite(role(body.role) ?? 'user', cleanAllow(body.allow), me.id);
          sendJson(res, 200, { path: `/convite/${token}`, expiresAt });
        })
        .catch((err) => fail(res, err));
      return true;
    }
    req.resume();
    sendJson(res, 404, { error: tr('não encontrado') });
    return true;
  };

  return {
    gate,
    api,
    allows: (req, feature) => {
      const me = userOf(req);
      return !!me && allowedOf(me).has(feature);
    },
    isAdmin: (req) => userOf(req)?.role === 'admin',
    setupCode: () => code,
  };
}

/** Material da chave das sessões de um usuário: troca de senha ou "sair de todos" invalida as antigas. */
export function userKeyOf(store: UserStore): (uid: string) => string | undefined {
  return (uid) => {
    const u = store.get(uid);
    return u ? `${u.id}\0${u.epoch}\0${u.passwordHash}` : undefined;
  };
}
