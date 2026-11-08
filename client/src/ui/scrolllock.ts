// Trava de rolagem da página (iPhone): o app é uma tela fixa (client/index.html), mas o Safari ainda desloca a janela quando
// um campo ganha foco, um seletor abre ou o teclado aparece, e depois o app fica "subido", com um vazio embaixo. Devolve a
// rolagem a zero sempre que isso acontece e quando o campo perde o foco.
const reset = (): void => {
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  if (document.scrollingElement && (document.scrollingElement.scrollTop || document.scrollingElement.scrollLeft)) document.scrollingElement.scrollTo(0, 0);
};

export function lockPageScroll(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('scroll', reset, { passive: true });
  document.addEventListener('focusout', () => setTimeout(reset, 60));
  window.visualViewport?.addEventListener('resize', () => setTimeout(reset, 60));
  window.visualViewport?.addEventListener('scroll', () => {
    // O teclado desloca a viewport visual: com o app fixo, o certo é voltar ao topo assim que ele some.
    if ((window.visualViewport?.offsetTop ?? 0) > 0 && !document.activeElement?.matches?.('input, textarea, select, [contenteditable]')) reset();
  });
}
