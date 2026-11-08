// Diagnóstico da tela (Configurações › Sobre): números da janela para o usuário mandar em print.
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

