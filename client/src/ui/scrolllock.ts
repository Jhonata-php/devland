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

/**
 * O app acompanha a área realmente visível (visualViewport): se o iOS desloca ou encolhe a janela (barra de status, teclado,
 * seletor), a camada do app anda junto em vez de ficar "subida" com um vazio embaixo. Só em telas de toque; client/index.html
 * usa as variáveis --vv-top/--vv-left/--vv-h nas camadas fixas.
 */
export function followVisualViewport(): void {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (!vv || !window.matchMedia('(pointer: coarse)').matches) return;
  const root = document.documentElement;
  const apply = (): void => {
    // Leituras absurdas (0 no começo, ou muito menor que a tela) não valem: fica no 100dvh do CSS.
    if (vv.height < 200 || vv.width < 200) return;
    root.style.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`);
    root.style.setProperty('--vv-left', `${Math.round(vv.offsetLeft)}px`);
    root.style.setProperty('--vv-h', `${Math.round(vv.height)}px`);
  };
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  window.addEventListener('orientationchange', () => setTimeout(apply, 200));
  apply();
}

/** Números da tela para diagnóstico (botão em Configurações › Sobre): o usuário manda um print. */
export function viewportReport(): string {
  const vv = window.visualViewport;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.append(probe);
  const cs = getComputedStyle(probe);
  const inset = `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`;
  probe.remove();
  const root = document.documentElement.style;
  const nav = navigator as Navigator & { standalone?: boolean };
  return [
    `inner ${innerWidth}x${innerHeight}  screen ${screen.width}x${screen.height}  dpr ${devicePixelRatio}`,
    `visual ${vv ? `${Math.round(vv.width)}x${Math.round(vv.height)} top ${Math.round(vv.offsetTop)} left ${Math.round(vv.offsetLeft)} escala ${vv.scale}` : 'n/d'}`,
    `rolagem ${scrollX},${scrollY}  doc ${document.scrollingElement?.scrollTop ?? '?'}`,
    `safe-area ${inset}`,
    `vars top ${root.getPropertyValue('--vv-top') || '-'} h ${root.getPropertyValue('--vv-h') || '-'}`,
    `standalone ${nav.standalone ?? matchMedia('(display-mode: standalone)').matches}`,
    `ua ${navigator.userAgent.replace(/^Mozilla\/5.0 /, '').slice(0, 90)}`,
  ].join('\n');
}
