// Habblaud Cloud (HABBLAUD_CLOUD=1): telas e API de usuários da porta remota (http/remote.ts).
//
// Sem login: /setup (criar o admin, com o código de instalação que sai no log) e /convite/<token> (aceitar convite).
// Com login: /admin (só admin) e /api/cloud/*. Quem pode o quê no escritório: `allows(req, feature)`, pela lista do
// usuário (cloud/users.ts).
import type { Mailer } from '../mail/smtp';
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
  /** E-mail (SMTP do ambiente) para o "esqueci a senha"; ausente = recurso desligado. */
  mailer?: Mailer;
  /** Falhas de envio (o usuário não vê o motivo, para não revelar quem tem conta). */
  warn?: (msg: string) => void;
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
<style>
  /* Visual DevLand (verde neon sobre preto), igual ao login e ao escritório. Vem por último: troca as cores acima. */
  :root { --bg: #050806; --card: #08130d; --line: rgba(57, 255, 136, .22); --txt: #d8f5e4; --mut: #7fa592; --gold: #39ff88; --gold2: #19c76a; --bad: #ff6b6b; --cy: #4de1ff; }
  body { background: radial-gradient(900px 480px at 50% -10%, rgba(57, 255, 136, .14), transparent 60%), radial-gradient(700px 500px at 100% 100%, rgba(77, 225, 255, .08), transparent 60%),
                     linear-gradient(rgba(57, 255, 136, .035) 1px, transparent 1px) 0 0 / 100% 24px, var(--bg); }
  main { background: rgba(5, 14, 9, .92); border: 1px solid var(--line); border-radius: 16px; box-shadow: 0 24px 70px -20px rgba(0, 0, 0, .8), 0 0 40px -18px rgba(57, 255, 136, .45); position: relative; }
  main::before { content: 'DEVLAND'; position: absolute; top: -13px; left: 20px; padding: 2px 10px; font-size: 12px; font-weight: 800; letter-spacing: .2em; color: #39ff88; background: var(--bg); border: 1px solid var(--line); border-radius: 99px; }
  main::after { content: none; }
  body { grid-template-columns: minmax(0, 1fr); justify-items: center; }
  main { min-width: 0; overflow-wrap: anywhere; }
  .tabs { max-width: 100%; }
  h1, h2 { color: var(--gold); text-shadow: 0 0 18px rgba(57, 255, 136, .35); }
  a { color: var(--cy); }
  th, td { border-bottom: 1px solid var(--line); }
  th { color: var(--mut); font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: .08em; }
  .tabs { border-bottom: 1px solid var(--line); overflow-x: auto; flex-wrap: nowrap; scrollbar-width: none; }
  .tabs::-webkit-scrollbar { display: none; }
  .tabs a { color: var(--mut); border-radius: 8px 8px 0 0; white-space: nowrap; transition: color .15s, background .15s; }
  .tabs a:hover { color: var(--txt); background: rgba(57, 255, 136, .06); }
  .tabs a.on { color: var(--gold); border-bottom-color: var(--gold); background: rgba(57, 255, 136, .08); }
  .card { background: rgba(3, 9, 5, .75); border: 1px solid var(--line); border-radius: 14px; }
  .card.on { border-color: rgba(57, 255, 136, .55); background: rgba(10, 30, 18, .8); }
  select, input { background: #04100a; color: var(--txt); border: 1px solid var(--line); border-radius: 8px; }
  input:focus, select:focus { border-color: var(--gold); box-shadow: 0 0 0 3px rgba(57, 255, 136, .18); outline: none; }
  input[type=checkbox] { accent-color: #39ff88; }
  button { color: #04100a; background: linear-gradient(180deg, #39ff88, #19c76a); border: 0; border-radius: 8px; box-shadow: 0 0 22px -6px rgba(57, 255, 136, .7); }
  button:active { transform: translateY(1px); box-shadow: 0 0 10px -4px rgba(57, 255, 136, .7); }
  button:focus-visible { outline: 2px solid rgba(57, 255, 136, .6); }
  button.ghost, button.small.ghost { background: transparent; color: var(--gold); border: 1px solid var(--line); box-shadow: none; }
  button.ghost:hover { border-color: var(--gold); background: rgba(57, 255, 136, .08); }
  .pill { border-color: var(--line); color: var(--mut); }
  .pill.on { color: #39ff88; border-color: rgba(57, 255, 136, .6); }
  .card li.ok::before { color: #39ff88; }
  .repo { background: rgba(3, 9, 5, .8); border: 1px solid var(--line); border-radius: 10px; }
  .repo .lock, .job .code { color: var(--gold); }
  .job { border-top: 1px solid var(--line); }
  .job a.btn { background: linear-gradient(180deg, #39ff88, #19c76a); color: #04100a; }
  .t-github { background: linear-gradient(160deg, #3b4a42, #17201b); }
  @media (max-width: 640px) {
    main { padding: 16px 12px; margin-top: 14px; }
    th, td { padding: 8px 4px; }
    .row > * { flex: 1 1 auto; }
    .head { flex-wrap: wrap; }
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
function formPage(opts: { title: string; intro: string; fields: { id: string; label: string; type?: string; auto?: string; value?: string; readonly?: boolean }[]; endpoint: string; submit: string; extra?: Record<string, string>; done?: string; foot?: string }): string {
  const icon = (f: { id: string; type?: string }) => (f.type === 'password' ? ICON.lock : ICON.user);
  const fields = opts.fields
    .map((f) => `<label class="l" for="${f.id}">${esc(f.label)}</label>
  <div class="field">${icon(f)}<input id="${f.id}" name="${f.id}" type="${f.type ?? 'text'}" autocomplete="${f.auto ?? 'off'}" autocapitalize="none" autocorrect="off" spellcheck="false"${f.value ? ` value="${esc(f.value)}"` : ''}${f.readonly ? ' readonly' : ''} required></div>`)
    .join('\n  ');
  const card = `<h1>${BRAND}</h1>
<p class="sub">${esc(opts.intro)}</p>
<form id="f" novalidate>
  <div id="err" class="alert err" role="alert"></div>
  ${fields}
  <button id="b" class="btn" type="submit"><span class="spin" aria-hidden="true"></span><span>${esc(opts.submit)}</span></button>
</form>
<p id="done" class="sub" hidden role="status"></p>${opts.foot ? `\n<p class="sub">${opts.foot}</p>` : ''}`;
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
      if (r.ok) {
        ${opts.done ? `f.hidden = true; const d = document.getElementById('done'); d.textContent = ${js(opts.done)}; d.hidden = false; return;` : `location.replace('/'); return;`}
      }
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

/** Estilo das páginas dentro das janelas do app (Contas e Usuários abrem em <dialog> com a página em iframe). */
const EMBED_STYLE = `<style>
  body { display: block; padding: 0; min-height: 0; background: #04100a; font-size: 14px; }
  main::before { display: none; }
  main { border: 0; box-shadow: none; background: none; border-radius: 0; padding: 14px 18px 18px; max-width: none; }
  /* O título já está na barra da janela. */
  main > h1 { display: none; }
  main > p { margin: 0 0 14px; font-size: 13px; }
  h2 { font-size: 13px; margin: 20px 0 8px; text-transform: uppercase; letter-spacing: .1em; text-shadow: none; }
  .card { margin: 10px 0; padding: 14px; }
  table { margin-bottom: 8px; }
  th, td { padding: 10px 6px; }
  fieldset { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 0; }
  fieldset label, td label { display: inline-flex; align-items: center; gap: 8px; margin: 0; padding: 7px 12px; text-transform: none; letter-spacing: 0; font-size: 13px; color: var(--txt); border: 1px solid var(--line); border-radius: 99px; background: rgba(57, 255, 136, .04); cursor: pointer; }
  fieldset label:has(input:checked), td label:has(input:checked) { border-color: rgba(57, 255, 136, .6); background: rgba(57, 255, 136, .12); }
  select { padding: 8px 10px; font-size: 14px; }
  button { font-size: 14px; padding: 10px 16px; margin-top: 12px; width: auto; }
  button.small { padding: 7px 12px; margin: 0; font-size: 13px; }
  .row { margin-top: 12px; }
  [hidden] { display: none !important; }
  .users { display: grid; gap: 10px; }
  .inv #invite { margin-top: 14px; }
  .card.person { margin: 0; padding: 12px 14px; }
  .u { display: flex; align-items: center; gap: 12px; }
  .av { flex: none; width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; font-weight: 800; color: #04100a; background: linear-gradient(160deg, #39ff88, #19c76a); }
  .who { flex: 1; min-width: 0; display: grid; }
  .who b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .who small { color: var(--mut); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge { margin-left: 8px; padding: 1px 8px; font-size: 11px; font-weight: 600; color: var(--cy); border: 1px solid rgba(77, 225, 255, .45); border-radius: 99px; }
  .perms { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line); }
  .perms label { padding: 4px 10px; font-size: 12px; }
  .chip { padding: 4px 10px; font-size: 12px; border-radius: 99px; border: 1px solid var(--line); color: var(--mut); }
  .chip.on { color: #39ff88; border-color: rgba(57, 255, 136, .5); }
  button.danger:hover { border-color: #ff6b6b; color: #ff6b6b; background: rgba(255, 107, 107, .08); }
  .inv .row { display: flex; align-items: center; gap: 10px; margin: 0 0 10px; }
  .inv .row input { flex: 1; min-width: 0; }
  .fl { margin: 0; font-size: 12px; color: var(--mut); }
  .out { display: grid; grid-template-columns: 1fr auto; gap: 8px; margin-top: 12px; align-items: center; }
  .out input { min-width: 0; padding: 9px 10px; font-size: 12px; }
  .out small { grid-column: 1 / -1; color: var(--mut); }
  .sess p { margin: 0 0 4px; font-size: 13px; color: var(--mut); }
  #err { margin-top: 12px; min-height: 18px; font-size: 13px; color: var(--bad); text-align: left; }
  #err.ok { color: #39ff88; }
  @media (max-width: 640px) { main { padding: 10px 14px 24px; } .u { flex-wrap: wrap; } .who { flex: 1 1 60%; } }
</style><script>addEventListener('DOMContentLoaded', function () { var m = document.querySelector('main'); function post() { parent.postMessage({ devlandEmbedH: m.offsetHeight + 4 }, location.origin); } new ResizeObserver(post).observe(m); post(); });</script>`;

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
    sentTo: tr('Convite enviado para {0}.'),
    notSent: tr('Convite criado, mas o e-mail não foi enviado (SMTP desligado ou com erro). Copie o link e envie você mesmo.'),
  };
  const body = `${EMBED_STYLE}<main>
  <h1>${esc(tr('Usuários'))}</h1>
  <p>${esc(tr('Todos veem o escritório inteiro; as permissões dizem o que cada um pode fazer nele.'))}</p>
  <h2>${esc(tr('Pessoas'))}</h2>
  <div id="users" class="users"></div>
  <h2>${esc(tr('Convidar'))}</h2>
  <div class="card inv">
    <div class="row"><label class="fl" for="iemail">${esc(tr('E-mail da pessoa'))}</label><input id="iemail" type="email" autocomplete="off" placeholder="${esc(tr('nome@empresa.com'))}"></div>
    <div class="row"><label class="fl" for="irole">${esc(tr('Papel'))}</label><select id="irole"><option value="user">${esc(t.user)}</option><option value="admin">${esc(t.admin)}</option></select></div>
    <fieldset id="iperms">${FEATURES.map((f) => `<label><input type="checkbox" value="${f}"${f === 'permissions' ? ' checked' : ''}> ${esc(labels[f])}</label>`).join('')}</fieldset>
    <button id="invite" class="small">${esc(tr('Enviar convite por e-mail'))}</button>
    <div id="out" class="out" hidden><input id="link" readonly aria-label="${esc(tr('Link de convite'))}"><button id="copy" class="small ghost" type="button">${esc(tr('Copiar'))}</button><small id="outnote"></small></div>
  </div>
  <h2>${esc(tr('Esta sessão'))}</h2>
  <div class="card sess"><p>${esc(tr('Encerra o seu login em todos os aparelhos (celular, outros navegadores).'))}</p><button id="all" class="small ghost">${esc(tr('Sair de todos os aparelhos'))}</button></div>
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
    const box = $('users'); box.replaceChildren();
    for (const u of users) {
      const role = el('select', {}, el('option', { value: 'user', textContent: T.user }), el('option', { value: 'admin', textContent: T.admin }));
      role.value = u.role;
      role.onchange = () => call('PATCH', '/api/cloud/users/' + u.id, { role: role.value }).then(load, load);
      const rm = el('button', { className: 'small ghost danger', textContent: T.remove });
      rm.onclick = () => { if (confirm(T.confirmRemove.replace('{0}', u.name))) call('DELETE', '/api/cloud/users/' + u.id).then(load, load); };
      const who = el('div', { className: 'who' }, el('b', { textContent: u.name }), el('small', { textContent: u.email || '' }));
      if (u.id === me) who.firstChild.append(el('span', { className: 'badge', textContent: T.you.replace(/[()]/g, '') }));
      const row = el('div', { className: 'u' }, el('span', { className: 'av', textContent: u.name.slice(0, 1).toUpperCase() }), who, role, rm);
      const perms = el('div', { className: 'perms' });
      if (u.role === 'admin') perms.append(el('span', { className: 'chip on', textContent: T.allPerms }));
      else for (const f of F) {
        const cb = el('input', { type: 'checkbox', checked: u.allow.includes(f) });
        cb.onchange = () => call('PATCH', '/api/cloud/users/' + u.id, { allow: F.filter((x, i) => perms.querySelectorAll('input')[i].checked) }).catch(load);
        perms.append(el('label', {}, cb, ' ' + L[f]));
      }
      box.append(el('div', { className: 'card person' }, row, perms));
    }
  }
  $('irole').onchange = () => { $('iperms').hidden = $('irole').value === 'admin'; };
  $('invite').onclick = async () => {
    const allow = [...$('iperms').querySelectorAll('input:checked')].map((i) => i.value);
    const email = $('iemail').value.trim();
    const { path, sent } = await call('POST', '/api/cloud/invites', { role: $('irole').value, allow, email });
    $('link').value = location.origin + path;
    // Com SMTP o link já foi para o e-mail; sem ele (ou se o envio falhou) o admin copia e manda por onde quiser.
    $('out').hidden = !!sent; $('outnote').textContent = T.expires;
    err.textContent = sent ? T.sentTo.replace('{0}', email) : T.notSent; err.className = sent ? 'ok' : '';
    if (sent) $('iemail').value = ''; else $('link').select();
  };
  $('copy').onclick = () => navigator.clipboard?.writeText($('link').value).then(() => { err.textContent = T.copied; err.className = 'ok'; });
  $('all').onclick = async () => { await call('POST', '/api/cloud/logout-all', {}); location.replace('/login'); };
  load().catch(() => {});`;
  return shell(tr('DevLand · usuários'), body, script);
}

function accountsPage(isAdmin: boolean): string {
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
  const body = `${EMBED_STYLE}<main>
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
    forgotEnabled: () => !!deps.mailer,
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
                { id: 'name', label: tr('Nome'), auto: 'name' },
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
      if (path === '/esqueci') {
        req.resume();
        if (!deps.mailer) {
          sendHtml(res, shell(tr('DevLand · esqueci a senha'), `<form><h1>DevLand</h1><p>${esc(tr('O envio de e-mail não está configurado nesta instalação. Peça a quem administra o DevLand para redefinir a sua senha.'))}</p><a href="/login">${esc(tr('Voltar ao login'))}</a></form>`, ''));
        } else
          sendHtml(
            res,
            formPage({
              title: tr('DevLand · esqueci a senha'),
              intro: tr('Digite o e-mail da sua conta. Se ele existir, enviamos um link para escolher uma senha nova (vale por 30 minutos).'),
              fields: [{ id: 'login', label: tr('E-mail'), type: 'email', auto: 'email' }],
              endpoint: '/api/cloud/forgot',
              submit: tr('Enviar link'),
              done: tr('Se esse e-mail tem uma conta, o link já está a caminho. Confira também o spam.'),
              foot: `<a href="/login">${esc(tr('Voltar ao login'))}</a>`,
            }),
          );
        return true;
      }
      if (path === '/api/cloud/forgot') {
        if (method !== 'POST') {
          req.resume();
          sendJson(res, 405, { error: tr('método não permitido') }, { Allow: 'POST' });
          return true;
        }
        guarded(req, res, async (body) => {
          if (!deps.mailer) {
            sendJson(res, 404, { error: tr('O envio de e-mail não está configurado nesta instalação.') });
            return false;
          }
          // Resposta igual exista a conta ou não (não revela quem tem conta); o e-mail sai em segundo plano.
          const user = store.findForReset(str(body.login));
          if (user?.email) {
            const { token } = store.createReset(user.id);
            const link = `${deps.secure(req) ? 'https' : 'http'}://${req.headers.host ?? ''}/redefinir/${token}`;
            void deps.mailer
              .send({
                to: user.email,
                subject: tr('DevLand: redefinir a senha'),
                text: tr('Olá, {0}.\n\nPara escolher uma senha nova no DevLand, abra o link abaixo (vale por 30 minutos e só funciona uma vez):\n\n{1}\n\nSe não foi você que pediu, ignore este e-mail: a sua senha continua a mesma.\n', [user.name, link]),
              })
              .catch((err) => deps.warn?.(tr('Não deu para enviar o e-mail de redefinição: {0}', [err instanceof Error ? err.message : String(err)])));
          }
          sendJson(res, 200, { ok: true });
          return true;
        });
        return true;
      }
      const reset = /^\/redefinir\/([A-Za-z0-9_-]{1,64})$/.exec(path);
      if (reset) {
        req.resume();
        if (!store.resetValid(reset[1])) {
          sendHtml(res, shell(tr('DevLand · redefinir a senha'), `<form><h1>DevLand</h1><p>${esc(tr('Link inválido, vencido ou já usado. Peça um novo.'))}</p><a href="/esqueci">${esc(tr('Pedir um link novo'))}</a></form>`, ''));
        } else
          sendHtml(
            res,
            formPage({
              title: tr('DevLand · senha nova'),
              intro: tr('Escolha a sua senha nova.'),
              fields: [
                { id: 'password', label: tr('Senha (mínimo de 10 caracteres)'), type: 'password', auto: 'new-password' },
                { id: 'password2', label: tr('Repita a senha'), type: 'password', auto: 'new-password' },
              ],
              endpoint: '/api/cloud/reset',
              submit: tr('Salvar senha'),
              extra: { token: reset[1] },
            }),
          );
        return true;
      }
      if (path === '/api/cloud/reset') {
        if (method !== 'POST') {
          req.resume();
          sendJson(res, 405, { error: tr('método não permitido') }, { Allow: 'POST' });
          return true;
        }
        guarded(req, res, async (body) => {
          const user = await store.resetPassword(str(body.token), str(body.password));
          signIn(req, res, user.id);
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
                { id: 'name', label: tr('Nome'), auto: 'name' },
                { id: 'email', label: tr('E-mail'), type: 'email', auto: 'email', value: store.inviteEmail(invite[1]), readonly: !!store.inviteEmail(invite[1]) },
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
      // A página só existe dentro da janela do app (iframe ?embed); aberta direto, leva ao app e abre a janela.
      if (!deps.connect?.()) redirect(res, '/');
      else if (!url.searchParams.has('embed')) redirect(res, '/?painel=contas');
      else sendHtml(res, accountsPage(me.role === 'admin'), true);
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
      if (!url.searchParams.has('embed')) redirect(res, '/?painel=usuarios');
      else sendHtml(res, adminPage());
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
        .then(async (body) => {
          const email = str(body.email).trim();
          if (!email) throw new UserError(tr('Digite o e-mail da pessoa.'));
          const { token, expiresAt } = store.createInvite(role(body.role) ?? 'user', cleanAllow(body.allow), me.id, email);
          const path = `/convite/${token}`;
          let sent = false;
          if (deps.mailer) {
            const link = `${deps.secure(req) ? 'https' : 'http'}://${req.headers.host ?? ''}${path}`;
            try {
              await deps.mailer.send({
                to: email.toLowerCase(),
                subject: tr('Convite para o DevLand'),
                text: tr('Olá!\n\n{0} convidou você para o DevLand, o escritório virtual dos agentes de IA. Para criar a sua conta, abra o link abaixo (vale por 7 dias e só funciona uma vez):\n\n{1}\n\nSe você não esperava este convite, ignore este e-mail.\n', [me.name, link]),
              });
              sent = true;
            } catch (err) {
              deps.warn?.(tr('Não deu para enviar o e-mail do convite: {0}', [err instanceof Error ? err.message : String(err)]));
            }
          }
          sendJson(res, 200, { path, expiresAt, sent });
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
