// Moldura das telas de entrada (login, esqueci a senha, senha nova, convite e criar o admin), no visual de plataforma do
// modo Painel: fundo quente e escuro, formulário à esquerda e, no computador, uma prévia do painel à direita. No celular
// fica só o formulário. Sem dependências nem arquivos externos (só o logo em /assets/brand, liberado sem login).
import { getLocale, tr } from '../../shared/i18n';

import { BRAND } from '../../shared/brand';
export { BRAND };

/** Texto nosso (tr) dentro do HTML: escapa o que o HTML interpretaria. */
function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Dentro do <script>: JSON com "<" escapado, para nenhum texto fechar a tag. */
export function js(text: string): string {
  return JSON.stringify(text).replace(/</g, '\\u003c');
}

export const AUTH_STYLE = `<style>
  :root { color-scheme: dark; --bg: #111110; --panel: #161615; --card: #1a1a18; --line: rgba(255,255,255,.08); --line2: rgba(255,255,255,.14);
          --txt: #edece9; --mut: #8f8c86; --acc: #4ade80; --warn: #f5b84a; --bad: #f87171; --blue: #7aa2ff;
          --font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", Roboto, sans-serif; }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body { margin: 0; min-height: 100vh; min-height: 100dvh; background: var(--bg); color: var(--txt); font: 15px/1.5 var(--font); -webkit-font-smoothing: antialiased; }
  a { color: var(--txt); text-underline-offset: 3px; }
  .shell { min-height: 100vh; min-height: 100dvh; display: grid; grid-template-columns: minmax(0, 1fr); }
  .side { display: flex; flex-direction: column; padding: max(24px, calc(env(safe-area-inset-top) + 12px)) 24px max(24px, env(safe-area-inset-bottom)); }
  .logo { display: flex; align-items: center; gap: 10px; font: 650 19px/1 var(--font); letter-spacing: -.01em; color: var(--txt); text-decoration: none; }
  .logo img { image-rendering: pixelated; }
  .form { flex: 1; width: 100%; max-width: 380px; margin: 0 auto; display: flex; flex-direction: column; justify-content: center; padding: 40px 0; animation: rise .45s cubic-bezier(.2,.8,.2,1) both; }
  h1 { margin: 0; font-size: 28px; line-height: 1.2; font-weight: 650; letter-spacing: -.02em; }
  .sub { margin: 8px 0 28px; color: var(--mut); font-size: 14.5px; }
  .alert { display: none; margin-bottom: 16px; padding: 10px 12px; border-radius: 10px; font-size: 13.5px; border: 1px solid; }
  .alert.on { display: block; }
  .alert.err { background: rgba(248,113,113,.08); color: #fca5a5; border-color: rgba(248,113,113,.3); }
  .alert.ok { background: rgba(74,222,128,.08); color: var(--acc); border-color: rgba(74,222,128,.3); }
  .alert.shake { animation: shake .35s; }
  label.l { display: block; margin: 0 0 7px; font-size: 13px; font-weight: 550; color: var(--txt); }
  .field { position: relative; display: flex; align-items: center; gap: 10px; height: 46px; margin-bottom: 16px; padding: 0 12px; border: 1px solid var(--line2); border-radius: 10px; background: var(--card); transition: border-color .15s, box-shadow .15s; }
  .field:focus-within { border-color: rgba(74,222,128,.6); box-shadow: 0 0 0 4px rgba(74,222,128,.12); }
  .field svg { flex: none; width: 17px; height: 17px; color: var(--mut); }
  .field input { flex: 1; min-width: 0; height: 100%; background: transparent; border: 0; outline: 0; color: var(--txt); font: inherit; font-size: 16px; }
  .field input[readonly] { color: var(--mut); }
  .field input::placeholder { color: #5f5c57; }
  .eye { flex: none; display: grid; place-items: center; width: 32px; height: 32px; margin-right: -6px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: var(--mut); cursor: pointer; }
  .eye:hover { color: var(--txt); background: rgba(255,255,255,.06); }
  .btn { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; height: 46px; margin-top: 8px; border: 0; border-radius: 10px; cursor: pointer; font: inherit; font-size: 15px; font-weight: 600; color: #111110; background: var(--txt); transition: background .15s, transform .12s; }
  .btn:hover { background: #fff; }
  .btn:active { transform: scale(.99); }
  .btn:focus-visible, .eye:focus-visible, a:focus-visible { outline: 2px solid var(--acc); outline-offset: 2px; }
  .btn:disabled { opacity: .6; cursor: wait; }
  .spin { display: none; width: 15px; height: 15px; border: 2px solid rgba(17,17,16,.25); border-top-color: #111110; border-radius: 50%; animation: spin .7s linear infinite; }
  .busy .spin { display: block; }
  .help { margin: 20px 0 0; text-align: center; font-size: 13.5px; line-height: 1.6; color: var(--mut); }
  .help a { color: var(--txt); }
  .foot { display: flex; justify-content: space-between; gap: 12px; font-size: 12.5px; color: var(--mut); }
  .show { display: none; }
  @keyframes rise { from { opacity: 0; transform: translateY(10px); } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes shake { 20%, 60% { transform: translateX(-5px); } 40%, 80% { transform: translateX(5px); } }
  @keyframes pulse { 50% { opacity: .3; } }
  @keyframes float { 50% { transform: translateY(-6px); } }
  @media (min-width: 960px) {
    .shell { grid-template-columns: minmax(440px, 1fr) minmax(0, 1.15fr); }
    .side { padding: 32px 48px; }
    .show { display: flex; flex-direction: column; justify-content: center; gap: 28px; padding: 56px; border-left: 1px solid var(--line); overflow: hidden;
            background: radial-gradient(700px 420px at 80% 0%, rgba(74,222,128,.10), transparent 60%), radial-gradient(600px 400px at 0% 100%, rgba(122,162,255,.08), transparent 60%), var(--panel); }
    .show h2 { margin: 0; max-width: 520px; font-size: 34px; line-height: 1.15; font-weight: 650; letter-spacing: -.025em; }
    .show h2 em { font-style: normal; color: var(--acc); }
    .show p { margin: -12px 0 0; max-width: 480px; color: var(--mut); font-size: 15.5px; }
  }
  /* Prévia do painel (só desenho, sem dados reais). */
  .mock { width: 100%; max-width: 560px; padding: 18px; border: 1px solid var(--line2); border-radius: 18px; background: rgba(26,26,24,.9); box-shadow: 0 40px 90px -30px rgba(0,0,0,.8); animation: float 7s ease-in-out infinite; }
  .mock-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 14px; }
  .mock-stat { padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; background: #1f1f1d; }
  .mock-stat span { display: block; font-size: 11.5px; color: var(--mut); }
  .mock-stat b { font-size: 22px; font-weight: 650; }
  .mock-stat.g b { color: var(--acc); } .mock-stat.w b { color: var(--warn); }
  .mock-row { display: flex; align-items: center; gap: 12px; padding: 10px 8px; border-top: 1px solid var(--line); }
  .mock-av { flex: none; width: 30px; height: 30px; border-radius: 8px; image-rendering: pixelated; }
  .mock-txt { flex: 1; min-width: 0; display: grid; }
  .mock-txt b { font-size: 13px; font-weight: 600; }
  .mock-txt small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--mut); }
  .pill { display: inline-flex; align-items: center; gap: 5px; padding: 1px 8px; border-radius: 99px; font-size: 11px; font-weight: 550; }
  .pill::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .pill.g { color: var(--acc); background: rgba(74,222,128,.1); } .pill.g::before { animation: pulse 1.4s infinite; }
  .pill.w { color: var(--warn); background: rgba(245,184,74,.12); }
  .pill.b { color: var(--blue); background: rgba(122,162,255,.1); }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
</style>`;

export const ICON = {
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  eye: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6C3.6 8.4 2 12 2 12s3.6 7 10 7a10 10 0 0 0 4-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
};

export interface AuthPageOptions {
  /** <title> da aba. */
  title: string;
  /** Título e subtítulo do formulário já vêm dentro de `card`. */
  card: string;
  /** Script da página (sem a tag). */
  script?: string;
  /** Mais cabeçalhos <head>. */
  extraHead?: string;
}

/** Um personagem em pixel art (8x8) para a prévia, como data URI. */
function face(shirt: string, skin: string, hair: string): string {
  const R = (x: number, y: number, w: number, h: number, f: string) => `<rect x='${x}' y='${y}' width='${w}' height='${h}' fill='${f}'/>`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8' shape-rendering='crispEdges'>${R(0, 0, 8, 8, '#262624')}${R(2, 1, 4, 4, skin)}${R(2, 1, 4, 1, hair)}${R(3, 3, 1, 1, '#1b1b1b')}${R(5, 3, 1, 1, '#1b1b1b')}${R(1, 5, 6, 3, shirt)}</svg>`;
  return `data:image/svg+xml,${svg.replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E')}`;
}

function showcase(): string {
  const row = (img: string, name: string, pill: string, cls: string, text: string) =>
    `<div class="mock-row"><img class="mock-av" src="${img}" alt=""><span class="mock-txt"><b>${esc(name)} <span class="pill ${cls}">${esc(pill)}</span></b><small>${esc(text)}</small></span></div>`;
  return `<aside class="show" aria-hidden="true">
    <h2>${esc(tr('Seus agentes de IA,'))} <em>${esc(tr('num só lugar.'))}</em></h2>
    <p>${esc(tr('Acompanhe o Claude Code e o Codex, aprove pedidos, veja o uso das contas e convide o time.'))}</p>
    <div class="mock">
      <div class="mock-stats"><div class="mock-stat g"><span>${esc(tr('Trabalhando'))}</span><b>3</b></div><div class="mock-stat w"><span>${esc(tr('Precisam de você'))}</span><b>1</b></div><div class="mock-stat"><span>${esc(tr('Contas'))}</span><b>2</b></div></div>
      ${row(face('#e0507a', '#e8b98a', '#2b2018'), 'Marina', tr('Trabalhando'), 'g', tr('Criando a tela de perfil'))}
      ${row(face('#4aa3ff', '#c68a5a', '#111'), 'Bento', tr('Precisa de você'), 'w', tr('Aprovar: npm run deploy'))}
      ${row(face('#f4c95d', '#f1d4a8', '#7a4a20'), 'Lia', tr('Concluído'), 'b', tr('Testes passando em 1min 49s'))}
    </div>
  </aside>`;
}

export function authPage(o: AuthPageOptions): string {
  return `<!doctype html>
<html lang="${getLocale()}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#111110">
<title>${esc(o.title)}</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/assets/brand/apple-touch-icon.png?v=2">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="${BRAND}">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
${AUTH_STYLE}
${o.extraHead ?? ''}
</head>
<body>
<div class="shell">
  <main class="side">
    <a class="logo" href="/"><img src="/assets/brand/logo-mark@4x.png" alt="" width="32" height="32">${BRAND}</a>
    <div class="form">${o.card}</div>
    <footer class="foot"><span>© ${new Date().getFullYear()} ${BRAND}</span><span>${esc(tr('Conexão protegida'))}</span></footer>
  </main>
  ${showcase()}
</div>
${o.script ? `<script>\n${o.script}\n</script>` : ''}
</body>
</html>
`;
}

/** Página só de aviso (link vencido, e-mail desligado...), na mesma moldura. */
export function messagePage(title: string, heading: string, text: string, link: { href: string; label: string }): string {
  return authPage({ title, card: `<h1>${esc(heading)}</h1><p class="sub">${esc(text)}</p><a class="btn" href="${esc(link.href)}" style="text-decoration:none">${esc(link.label)}</a>` });
}
