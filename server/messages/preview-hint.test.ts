import { describe, expect, it } from 'vitest';
import { PREVIEW_HINT, withPreviewHint } from './preview-hint';

describe('reforço da prévia nas mensagens', () => {
  it('acrescenta a dica quando o pedido é ver o site', () => {
    for (const t of ['abre o preview', 'Certo você pode abrir no previwer?'.replace('previwer', 'previewer'), 'mostra como ficou', 'quero ver o site', 'abre a prévia por favor']) {
      expect(withPreviewHint(t)).toBe(`${t}${PREVIEW_HINT}`);
    }
  });
  it('não mexe no resto', () => {
    for (const t of ['corrige o bug do login', 'roda os testes', 'review do PR']) expect(withPreviewHint(t)).toBe(t);
  });
});
