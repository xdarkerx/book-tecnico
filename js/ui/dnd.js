/* ═══ Helpers de arrastar-e-soltar (HTML5 DnD) ═══
   O "payload" fica em memória porque dataTransfer.getData não é legível
   durante o dragover em todos os navegadores. */
(function (BT) {
  const D = {
    payload: null, // { kind: 'new-block'|'block'|'section'|'group'|'row'|'image'|'col', ... }

    start(e, payload, ghostEl) {
      D.payload = payload;
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', payload.kind); } catch (_) {}
      if (ghostEl) try { e.dataTransfer.setDragImage(ghostEl, 20, 16); } catch (_) {}
    },
    end() { D.payload = null; D.clearLines(); document.querySelectorAll('.dragging,.drop-target,.drag-over').forEach((el) => el.classList.remove('dragging', 'drop-target', 'drag-over')); },

    /** Índice de inserção dentre os filhos (selector) de container, pela posição Y (ou X). */
    indexAt(container, selector, clientY, axis = 'y') {
      const items = [...container.querySelectorAll(':scope > ' + selector)];
      for (let i = 0; i < items.length; i++) {
        const r = items[i].getBoundingClientRect();
        const mid = axis === 'y' ? r.top + r.height / 2 : r.left + r.width / 2;
        if ((axis === 'y' ? clientY : clientY) < mid) return { index: i, ref: items[i] };
      }
      return { index: items.length, ref: null };
    },

    showLine(container, ref, cls = 'blk-drop') {
      D.clearLines();
      const line = BT.h('div', { class: cls + ' dnd-line' });
      ref ? container.insertBefore(line, ref) : container.appendChild(line);
    },
    clearLines() { document.querySelectorAll('.dnd-line').forEach((l) => l.remove()); }
  };
  document.addEventListener('dragend', () => D.end());
  document.addEventListener('drop', () => setTimeout(D.clearLines, 0));
  BT.ui.dnd = D;
})(window.BT);
