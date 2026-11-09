// Reforço da prévia: quando a mensagem mandada pelo DevLand pede para ver o site ("abre o preview", "mostra como
// ficou"…), o agente recebe junto uma linha dizendo como abrir a prévia no DevLand. Assim até uma sessão aberta antes
// da skill devland-preview faz o certo, sem depender de lembrar dela.
const ASKS_PREVIEW = /\b(preview|previewer|prévia|previa)\b|\b(abr[ae]|mostr[ae]|ver)\b[^.?!\n]{0,30}\b(site|tela|página|pagina|como (fic|est)ou)\b/i;

export const PREVIEW_HINT =
  '\n\n(DevLand: para mostrar o site, suba o servidor de desenvolvimento em segundo plano e rode ' +
  '`curl -s -X POST "http://127.0.0.1:${HABBLAUD_PORT:-4747}/api/preview/open" -H \'Content-Type: application/json\' -d \'{"port": PORTA}\'` ' +
  'com a porta dele: a prévia abre sozinha no DevLand. Não precisa de navegador.)';

export function withPreviewHint(text: string): string {
  return ASKS_PREVIEW.test(text) && !text.includes('/api/preview/open') ? `${text}${PREVIEW_HINT}` : text;
}
