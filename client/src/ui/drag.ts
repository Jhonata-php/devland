// Janelas arrastáveis no computador: segurar o cabeçalho de uma janela (menus flutuantes e diálogos) e arrastar a
// leva para onde quiser; dois cliques no cabeçalho a devolvem ao lugar original. No celular (tela estreita ou toque)
// as janelas são folhas fixas e nada muda. Um único ouvinte no documento serve para todas, inclusive as criadas depois.
const HEADS = '.ui-popover__head, .ui-accounts__head, .ui-dialog__head';
const PANEL = '.ui-popover, dialog';

function desktop(): boolean {
  return matchMedia('(min-width: 641px) and (pointer: fine)').matches;
}

/** Limita a posição para o cabeçalho continuar à vista (dá para pegar de novo). */
export function clampPos(x: number, y: number, w: number, vw: number, vh: number): { x: number; y: number } {
  return { x: Math.min(Math.max(x, 60 - w), vw - 60), y: Math.min(Math.max(y, 0), vh - 40) };
}

export function enableDraggablePanels(doc: Document = document): void {
  doc.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !desktop()) return;
    const target = e.target as HTMLElement | null;
    const head = target?.closest<HTMLElement>(HEADS);
    if (!head || target?.closest('button, a, input, select, textarea')) return;
    const panel = head.closest<HTMLElement>(PANEL);
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
      if (!moved) {
        moved = true;
        // Posição solta: tira as âncoras do CSS (right/bottom/margem/centralização) e passa a valer left/top.
        panel.style.setProperty('right', 'auto', 'important');
        panel.style.setProperty('bottom', 'auto', 'important');
        panel.style.setProperty('margin', '0', 'important');
        panel.style.setProperty('transform', 'none', 'important');
        panel.style.setProperty('width', `${r.width}px`, 'important');
        panel.classList.add('is-dragged');
      }
      const p = clampPos(ev.clientX - dx, ev.clientY - dy, r.width, innerWidth, innerHeight);
      panel.style.setProperty('left', `${p.x}px`, 'important');
      panel.style.setProperty('top', `${p.y}px`, 'important');
    };
    const up = () => {
      doc.removeEventListener('pointermove', move);
      doc.removeEventListener('pointerup', up);
      doc.body.classList.remove('is-dragging-panel');
    };
    doc.body.classList.add('is-dragging-panel');
    doc.addEventListener('pointermove', move);
    doc.addEventListener('pointerup', up);
  });
  // Dois cliques no cabeçalho: volta ao lugar de antes.
  doc.addEventListener('dblclick', (e) => {
    const head = (e.target as HTMLElement | null)?.closest<HTMLElement>(HEADS);
    const panel = head?.closest<HTMLElement>(PANEL);
    if (!panel?.classList.contains('is-dragged')) return;
    for (const p of ['left', 'top', 'right', 'bottom', 'margin', 'transform', 'width']) panel.style.removeProperty(p);
    panel.classList.remove('is-dragged');
  });
}
