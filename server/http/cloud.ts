// Habblaud Cloud (HABBLAUD_CLOUD=1): telas e API de usuários da porta remota (http/remote.ts).
//
// Sem login: /setup (criar o admin, com o código de instalação que sai no log) e /convite/<token> (aceitar convite).
// Com login: /admin (só admin) e /api/cloud/*. Quem pode o quê no escritório: `allows(req, feature)`, pela lista do
// usuário (cloud/users.ts).
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getLocale, tr } from '../../shared/i18n';
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
  const fields = opts.fields
    .map((f) => `<label for="${f.id}">${esc(f.label)}</label>
  <input id="${f.id}" name="${f.id}" type="${f.type ?? 'text'}" autocomplete="${f.auto ?? 'off'}" autocapitalize="none" autocorrect="off" spellcheck="false" required>`)
    .join('\n  ');
  const body = `<form id="f">
  <h1>Habblaud</h1>
  <p>${esc(opts.intro)}</p>
  ${fields}
  <button id="b" type="submit">${esc(opts.submit)}</button>
  <div id="err" role="alert"></div>
</form>`;
  const script = `const f = document.getElementById('f'), b = document.getElementById('b'), err = document.getElementById('err');
  const ids = ${JSON.stringify(opts.fields.map((x) => x.id))}, extra = ${JSON.stringify(opts.extra ?? {}).replace(/</g, '\\u003c')};
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (f.password2 && f.password2.value !== f.password.value) { err.textContent = ${js(tr('As senhas não conferem.'))}; return; }
    b.disabled = true; err.textContent = '';
    const body = { ...extra };
    for (const id of ids) if (id !== 'password2') body[id] = f[id].value;
    try {
      const r = await fetch(${js(opts.endpoint)}, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
      if (r.ok) { location.replace('/'); return; }
      const j = await r.json().catch(() => ({}));
      err.textContent = j.error || ${js(tr('Não deu certo.'))};
    } catch { err.textContent = ${js(tr('Sem conexão com o Habblaud.'))}; }
    b.disabled = false;
  });`;
  return shell(opts.title, body, script);
}

function featureLabels(): Record<RemoteFeature, string> {
  return {
    permissions: tr('Responder pedidos de permissão'),
    messages: tr('Mandar mensagens aos agentes'),
    terminal: tr('Ver e usar o terminal'),
    spawn: tr('Abrir agentes novos'),
  };
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
  <div class="row" style="justify-content:space-between"><h1>${esc(tr('Usuários'))}</h1><a href="/">${esc(tr('Voltar ao escritório'))}</a></div>
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
      tb.append(el('tr', {}, el('td', { textContent: u.name + (u.id === me ? ' ' + T.you : '') }), el('td', {}, role), perms, el('td', {}, rm)));
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
  return shell(tr('Habblaud · usuários'), body, script);
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
              title: tr('Habblaud · criar admin'),
              intro: tr('Primeiro acesso: crie a conta de admin. O código de instalação aparece no Velix, em Credenciais do app, e no log do container.'),
              fields: [
                { id: 'code', label: tr('Código de instalação') },
                { id: 'name', label: tr('Usuário'), auto: 'username' },
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
          const admin = await store.create(str(body.name), str(body.password), 'admin', []);
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
          sendHtml(res, shell(tr('Habblaud · convite'), `<form><h1>Habblaud</h1><p>${esc(tr('Convite inválido, vencido ou já usado. Peça um novo a quem administra o Habblaud.'))}</p><a href="/login">${esc(tr('Ir para o login'))}</a></form>`, ''));
        } else
          sendHtml(
            res,
            formPage({
              title: tr('Habblaud · convite'),
              intro: tr('Você foi convidado para o Habblaud. Escolha seu usuário e senha.'),
              fields: [
                { id: 'name', label: tr('Usuário'), auto: 'username' },
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
          const user = await store.acceptInvite(str(body.token), str(body.name), str(body.password));
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
    if (path !== '/admin' && !path.startsWith('/api/cloud/')) return false;
    const me = userOf(req);
    const method = req.method ?? 'GET';
    if (!me) {
      req.resume();
      sendJson(res, 401, { error: tr('faça login') });
      return true;
    }
    if (path === '/api/cloud/me') {
      req.resume();
      sendJson(res, 200, { id: me.id, name: me.name, role: me.role, allow: [...allowedOf(me)] });
      return true;
    }
    if (path === '/api/cloud/logout-all' && method === 'POST') {
      req.resume();
      store.bumpEpoch(me.id);
      sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader('', 0, deps.secure(req)) });
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
