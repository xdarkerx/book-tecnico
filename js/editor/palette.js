/* ═══ Paleta: arraste um tipo de bloco para a seção (ou clique para adicionar ao final) ═══ */
(function (BT) {
  const h = BT.h;
  function render() {
    const list = document.getElementById('palette-list');
    list.innerHTML = '';
    BT.blocks.list().forEach((def) => {
      const it = h('button', { class: 'pl-item', draggable: 'true', title: `${def.label} — arraste para a seção ou clique para adicionar`, 'data-type': def.type }, [
        h('span', { class: 'pl-ic' }, def.icon),
        h('span', {}, [h('b', {}, def.label), h('small', {}, def.desc)])
      ]);
      it.addEventListener('dragstart', (e) => BT.ui.dnd.start(e, { kind: 'new-block', type: def.type }));
      it.addEventListener('click', () => BT.editor.canvas.addToCurrent(def.type));
      list.appendChild(it);
    });
  }
  function init() {
    render();
    document.getElementById('pl-import').addEventListener('click', () => BT.importer.wizard.open());
  }
  BT.editor.palette = { init, render };
})(window.BT);
