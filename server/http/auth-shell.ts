// Moldura das telas de entrada (login e, depois, convite, recuperação de senha e verificação em duas etapas), no estilo
// "terminal hacker": chuva de código ao fundo (canvas), terminal que digita à esquerda, cartão com barra de janela à
// direita e os agentes do escritório (pixel art) andando lá embaixo. No celular o terminal fica em cima e o cartão vira
// uma folha até a borda de baixo. Sem dependências nem arquivos externos (só o logo em /assets/brand, liberado sem login).
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

const R = (x: number, y: number, w: number, h: number, f: string): string => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}"/>`;

/** Um agente em pixel art (16x24), com a cor da camisa; `class` anima o passo. */
function sprite(shirt: string, skin: string, delay: number, speed: number, top: number): string {
  const body = [R(4, 0, 8, 8, skin), R(4, 0, 8, 3, '#2b2018'), R(2, 8, 12, 9, shirt), R(2, 17, 5, 6, '#1b1f33'), R(9, 17, 5, 6, '#1b1f33')].join('');
  return `<svg class="agent" style="--d:${delay}s;--s:${speed}s;bottom:${top}px" viewBox="0 0 16 24" width="44" height="66" shape-rendering="crispEdges">${body}</svg>`;
}

export const AUTH_STYLE = `<style>
  :root { color-scheme: dark; --bg: #050806; --acc: #39ff88; --acc2: #19c76a; --cy: #4de1ff; --txt: #d8f5e4; --mut: #7fa592; --line: rgba(57,255,136,.22); --bad: #ff6b6b; }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body { margin: 0; min-height: 100vh; min-height: 100dvh; background: var(--bg); color: var(--txt); overflow-x: hidden;
         font: 15px/1.5 ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace; }
  .shell { position: relative; isolation: isolate; min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; overflow: hidden; }
  #rain { position: absolute; inset: 0; z-index: -4; width: 100%; height: 100%; opacity: .95; }
  .veil { position: absolute; inset: 0; z-index: -3; background: radial-gradient(ellipse at 28% 45%, rgba(5,8,6,.72), rgba(5,8,6,.15) 75%), linear-gradient(rgba(5,8,6,.05), rgba(5,8,6,.55)); }
  .glow { position: absolute; inset: 0; z-index: -2; background: radial-gradient(circle at 12% 95%, rgba(57,255,136,.22), transparent 45%), radial-gradient(circle at 95% 5%, rgba(77,225,255,.12), transparent 40%); }
  .crt { position: absolute; inset: 0; z-index: 5; pointer-events: none; background: repeating-linear-gradient(transparent 0 2px, rgba(0,0,0,.18) 2px 3px); mix-blend-mode: multiply; }
  .crt::after { content: ''; position: absolute; inset: 0; background: radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.55)); }
  header.top { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: max(18px, calc(env(safe-area-inset-top) + 8px)) 20px 0; }
  .logo { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 17px; letter-spacing: .04em; color: var(--acc); text-shadow: 0 0 14px rgba(57,255,136,.55); }
  .mark { width: 38px; height: 38px; filter: drop-shadow(0 0 10px rgba(57,255,136,.55)); }
  
  .clock { display: none; align-items: center; gap: 8px; font-size: 12px; color: var(--mut); font-variant-numeric: tabular-nums; }
  .clock::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: var(--acc); box-shadow: 0 0 8px var(--acc); animation: pulse 1.6s infinite; }
  main { flex: 1; width: 100%; max-width: 1150px; margin: 0 auto; display: grid; grid-template-columns: minmax(0, 1fr); align-items: center; gap: 24px; padding: 20px 20px 70px; }
  main > * { min-width: 0; }
  .pitch .pill { display: inline-flex; align-items: center; gap: 8px; padding: 4px 12px; border: 1px solid var(--line); border-radius: 4px; background: rgba(57,255,136,.07); font-size: 11px; letter-spacing: .16em; text-transform: uppercase; color: var(--acc); }
  .pill::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #ff4d4d; animation: pulse 1.2s infinite; }
  .pitch h2 { margin: 14px 0 0; max-width: 560px; font-size: 24px; line-height: 1.2; font-weight: 800; letter-spacing: -.01em; }
  .pitch h2 em { font-style: normal; color: var(--acc); text-shadow: 0 0 18px rgba(57,255,136,.5); }
  .term { display: none; margin-top: 26px; max-width: 520px; border: 1px solid var(--line); border-radius: 10px; background: rgba(4,10,6,.72); backdrop-filter: blur(6px); box-shadow: 0 20px 50px -20px rgba(0,0,0,.8), 0 0 40px -18px rgba(57,255,136,.5); }
  .bar { display: flex; align-items: center; gap: 6px; padding: 9px 12px; border-bottom: 1px solid var(--line); font-size: 11px; color: var(--mut); }
  .bar i { width: 9px; height: 9px; border-radius: 50%; background: #ff5f56; }
  .bar i:nth-child(2) { background: #ffbd2e; } .bar i:nth-child(3) { background: #27c93f; }
  .bar span { margin-left: 8px; }
  #tty { margin: 0; padding: 14px 16px 16px; min-height: 170px; font: 13px/1.7 inherit; white-space: pre-wrap; color: var(--txt); }
  #tty .p { color: var(--acc); } #tty .ok { color: var(--acc); } #tty .w { color: var(--cy); } #tty .d { color: var(--mut); }
  #tty::after { content: '█'; color: var(--acc); animation: blink 1s steps(2, start) infinite; }
  .cardwrap { position: relative; }
  .card { border: 1px solid var(--line); border-radius: 12px; background: rgba(5,12,8,.84); box-shadow: 0 30px 80px -20px rgba(0,0,0,.85), 0 0 60px -24px rgba(57,255,136,.55), inset 0 1px 0 rgba(57,255,136,.08);
          backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); animation: rise .5s cubic-bezier(.2,.8,.2,1) both; overflow: hidden; }
  .card .bar { background: rgba(57,255,136,.05); }
  .body { padding: 26px 24px 24px; }
  .card h1 { margin: 0; font-size: 22px; line-height: 1.2; font-weight: 800; color: var(--txt); }
  .card h1::before { content: '> '; color: var(--acc); }
  .card h1 { animation: glitch 3.8s infinite; }
  @keyframes glitch { 0%, 92%, 100% { text-shadow: none; transform: none; } 93% { text-shadow: -2px 0 #ff2d6f, 2px 0 var(--cy); transform: translateX(1px); } 95% { text-shadow: 2px 0 #ff2d6f, -2px 0 var(--cy); transform: translateX(-1px); } 97% { text-shadow: none; } }
  .card .sub { margin: 6px 0 22px; color: var(--mut); font-size: 13px; }
  .alert { display: none; margin-bottom: 14px; padding: 9px 12px; border-radius: 6px; font-size: 13px; border: 1px solid; }
  .alert.on { display: block; }
  .alert.err { background: rgba(255,80,80,.1); color: var(--bad); border-color: rgba(255,107,107,.4); }
  .alert.ok { background: rgba(57,255,136,.1); color: var(--acc); border-color: var(--line); }
  .alert.shake { animation: shake .35s; }
  label.l { display: block; margin: 0 0 6px; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--mut); }
  label.l::before { content: '$ '; color: var(--acc); }
  .field { position: relative; display: flex; align-items: center; gap: 10px; height: 52px; margin-bottom: 16px; padding: 0 12px; border: 1px solid var(--line); border-radius: 8px; background: rgba(0,0,0,.45); transition: border-color .15s, box-shadow .15s; }
  .field:focus-within { border-color: var(--acc); box-shadow: 0 0 0 3px rgba(57,255,136,.14), 0 0 22px -6px rgba(57,255,136,.5); }
  .field svg { flex: none; width: 18px; height: 18px; color: var(--mut); transition: color .15s; }
  .field:focus-within svg { color: var(--acc); }
  .field input { flex: 1; min-width: 0; height: 100%; background: transparent; border: 0; outline: 0; color: var(--txt); font: inherit; font-size: 16px; caret-color: var(--acc); }
  .field input::placeholder { color: rgba(127,165,146,.5); }
  .eye { flex: none; display: grid; place-items: center; width: 34px; height: 34px; margin: 0 -6px 0 0; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--mut); cursor: pointer; }
  .eye:hover { color: var(--acc); background: rgba(57,255,136,.08); }
  .btn { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; height: 52px; margin-top: 22px; border: 1px solid var(--acc); border-radius: 8px; cursor: pointer; font: inherit; font-size: 15px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: #03120a; background: linear-gradient(180deg, var(--acc), var(--acc2)); box-shadow: 0 0 28px -4px rgba(57,255,136,.6); transition: transform .12s, filter .15s, box-shadow .15s; }
  .btn:hover { filter: brightness(1.08); box-shadow: 0 0 38px -2px rgba(57,255,136,.8); }
  .btn:active { transform: scale(.985); }
  .btn:focus-visible, .eye:focus-visible { outline: 2px solid var(--cy); outline-offset: 2px; }
  .btn:disabled { opacity: .7; cursor: wait; }
  .spin { display: none; width: 15px; height: 15px; border: 2px solid rgba(3,18,10,.3); border-top-color: #03120a; border-radius: 50%; animation: spin .7s linear infinite; }
  .busy .spin { display: block; }
  .help { margin: 18px 0 0; text-align: center; font-size: 12px; line-height: 1.7; color: var(--mut); }
  .help a { color: var(--cy); }
  .stage { position: absolute; left: 0; right: 0; bottom: 0; height: 96px; z-index: 1; pointer-events: none; overflow: hidden; border-top: 1px dashed rgba(57,255,136,.18); background: linear-gradient(transparent, rgba(57,255,136,.06)); }
  .agent { position: absolute; left: -40px; animation: roam var(--s) linear infinite; animation-delay: var(--d); filter: drop-shadow(0 0 6px rgba(57,255,136,.35)); }
  .agent:nth-child(even) { animation-name: roam2; }
  footer.bot { position: absolute; left: 20px; bottom: 6px; z-index: 2; font-size: 11px; color: rgba(127,165,146,.6); }
  @keyframes rise { from { opacity: 0; transform: translateY(14px); } }
  @keyframes blink { 50% { opacity: 0; } }
  @keyframes pulse { 50% { opacity: .35; } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes shake { 20%, 60% { transform: translateX(-5px); } 40%, 80% { transform: translateX(5px); } }
  @keyframes roam { from { transform: translateX(0) } to { transform: translateX(calc(100vw + 80px)) } }
  @keyframes roam2 { from { transform: translateX(calc(100vw + 80px)) scaleX(-1) } to { transform: translateX(0) scaleX(-1) } }
  @media (max-width: 767px) {
    main { padding-bottom: 0; align-content: end; gap: 20px; }
    .cardwrap { margin: 0 -20px; }
    .card { border-radius: 18px 18px 0 0; border-bottom: 0; }
    .body { padding-bottom: max(26px, calc(env(safe-area-inset-bottom) + 18px)); }
    .stage, footer.bot { display: none; }
    /* Celular: só a marca no topo e o cartão de entrada; a chuva fica mais fraca e o cartão opaco, para o texto ler bem. */
    .pitch { display: none; }
    #rain { opacity: .5; }
    .card { background: rgba(4, 10, 6, .97); }
    main { min-height: calc(100dvh - 90px); }
  }
  @media (min-width: 768px) {
    header.top { padding: 22px 48px 0; }
    .clock { display: flex; }
    main { grid-template-columns: minmax(0, 1fr) 410px; gap: 80px; padding: 30px 48px 90px; }
    .pitch h2 { margin-top: 22px; font-size: 40px; }
    .term { display: block; }
    .body { padding: 30px 30px 28px; }
    footer.bot { left: 48px; }
  }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
</style>`;

export const ICON = {
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  eye: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6C3.6 8.4 2 12 2 12s3.6 7 10 7a10 10 0 0 0 4-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
};

/** Linhas que o terminal "digita" (as marcas [p] [ok] [w] [d] viram cor). */
const TTY_LINES = [
  '[p]$[/p] habblaud connect --accounts 2',
  '[d]resolvendo contas…[/d]',
  '[ok]✔[/ok] conta A  [d]5h 16% · semana 25%[/d]',
  '[ok]✔[/ok] conta B  [d]5h 0% · semana 0%[/d]',
  '[p]$[/p] habblaud agents --watch',
  '[w]●[/w] Rafaela   [d]trabalhando · wconect-site[/d]',
  '[w]●[/w] Bento     [d]revisando · api[/d]',
  '[ok]●[/ok] Lia      [d]concluiu em 1min 49s[/d]',
  '[p]$[/p] autenticação necessária _',
];

export interface AuthPageOptions {
  /** <title> da aba. */
  title: string;
  /** Título e subtítulo do cartão já vêm dentro de `card`. */
  card: string;
  /** Texto da barra do cartão (ex.: "login — bash"). */
  barTitle?: string;
  /** Script da página (sem a tag). */
  script?: string;
  /** Mais cabeçalhos <head>. */
  extraHead?: string;
}

const RAIN_JS = `
(function () {
  var cv = document.getElementById('rain'); if (!cv) return;
  var cx = cv.getContext('2d'), W, H, cols, drops, size = 16;
  var words = ['agent','spawn()','git push','claude','async','await','0x7f','sudo','ssh','docker','const','=>','{ }','fork()','exit 0','npm run','SELECT *','chmod 600','tail -f','sha256','token','merge','deploy','pty','rm -rf /tmp','$ _','404','200 OK','TODO','bash','curl','grep','node','tsc'];
  var chars = '01{}[]()<>/\\\\;:=+*#$%&ABCDEFabcdef'.split('');
  function fit() { var d = Math.min(window.devicePixelRatio || 1, 2); W = cv.clientWidth; H = cv.clientHeight; cv.width = W * d; cv.height = H * d; cx.setTransform(d, 0, 0, d, 0, 0); cols = Math.ceil(W / size); drops = []; for (var i = 0; i < cols; i++) drops.push({ y: Math.random() * H / size, w: null, i: 0, sp: .35 + Math.random() * .7 }); }
  fit(); addEventListener('resize', fit);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { draw(); return; }
  var last = 0;
  function draw(t) {
    cx.fillStyle = 'rgba(5,8,6,.10)'; cx.fillRect(0, 0, W, H);
    cx.font = size + 'px ui-monospace, Menlo, monospace';
    for (var i = 0; i < cols; i++) {
      var d = drops[i], ch;
      if (d.w === null || d.i >= d.w.length) { d.w = Math.random() < .3 ? words[Math.floor(Math.random() * words.length)] : null; d.i = 0; }
      ch = d.w ? d.w[d.i++] : chars[Math.floor(Math.random() * chars.length)];
      var head = Math.random() > .96;
      cx.fillStyle = head ? '#eafff2' : (d.w ? '#39ff88' : 'rgba(57,255,136,.75)');
      cx.fillText(ch, i * size, d.y * size);
      d.y += d.sp * 2;
      if (d.y * size > H && Math.random() > .975) d.y = Math.random() * -20;
    }
  }
  setInterval(draw, 55);
})();`;

const TTY_JS = `
(function () {
  var el = document.getElementById('tty'); if (!el) return;
  var lines = ${js(JSON.stringify(TTY_LINES))}, L = JSON.parse(lines), html = '', li = 0, ci = 0;
  function color(s) { return s.replace(/\\[(p|ok|w|d)\\]/g, '<span class="$1">').replace(/\\[\\/(p|ok|w|d)\\]/g, '</span>'); }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.innerHTML = L.map(color).join('\\n'); return; }
  function esc(t) { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function step() {
    if (li >= L.length) { setTimeout(function () { html = ''; li = 0; ci = 0; el.innerHTML = ''; step(); }, 5000); return; }
    var raw = L[li];
    if (/^\\[(d|ok|w)\\]/.test(raw) && ci === 0) { html += color(esc(raw)) + '\\n'; el.innerHTML = html; li++; return setTimeout(step, 380); }
    ci++; var part = raw.slice(0, ci);
    var open = (part.match(/\\[(p|ok|w|d)\\]/g) || []).length - (part.match(/\\[\\/(p|ok|w|d)\\]/g) || []).length;
    var shown = color(esc(part)) + (open > 0 ? '</span>'.repeat(open) : '');
    el.innerHTML = html + shown;
    if (ci >= raw.length) { html += color(esc(raw)) + '\\n'; li++; ci = 0; return setTimeout(step, 520); }
    setTimeout(step, 22 + Math.random() * 40);
  }
  step();
})();`;

export function authPage(o: AuthPageOptions): string {
  const agents = [sprite('#e0507a', '#e8b98a', 0, 22, 8), sprite('#4aa3ff', '#c68a5a', -7, 28, 14), sprite('#f4c95d', '#f1d4a8', -14, 25, 6), sprite('#6c5ce7', '#e8b98a', -3, 31, 12)].join('');
  return `<!doctype html>
<html lang="${getLocale()}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#050806">
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
  <canvas id="rain" aria-hidden="true"></canvas>
  <div class="veil"></div><div class="glow"></div><div class="crt"></div>
  <header class="top">
    <div class="logo"><img class="mark" src="/assets/brand/logo-mark@4x.png" alt="" width="36" height="36">${BRAND}</div>
    <span class="clock" id="clock" aria-hidden="true"></span>
  </header>
  <main>
    <section class="pitch">
      <span class="pill">${esc(tr('Escritório ao vivo'))}</span>
      <h2>${esc(tr('Seus agentes de IA trabalhando'))} <em>${esc(tr('ao vivo'))}</em>, ${esc(tr('num só escritório.'))}</h2>
      <div class="term" aria-hidden="true"><div class="bar"><i></i><i></i><i></i><span>agents — zsh</span></div><pre id="tty"></pre></div>
    </section>
    <section class="cardwrap">
      <div class="card"><div class="bar"><i></i><i></i><i></i><span>${esc(o.barTitle ?? 'login — bash')}</span></div><div class="body">${o.card}</div></div>
    </section>
  </main>
  <div class="stage" aria-hidden="true">${agents}</div>
  <footer class="bot">© ${new Date().getFullYear()} ${BRAND}</footer>
</div>
<script>
  (function () { var c = document.getElementById('clock'); if (!c) return; function t() { c.textContent = new Date().toLocaleString(); } t(); setInterval(t, 1000); })();
${RAIN_JS}
${TTY_JS}
${o.script ?? ''}
</script>
</body>
</html>
`;
}
