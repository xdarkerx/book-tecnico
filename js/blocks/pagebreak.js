/* ═══ Bloco: Quebra de página (PDF e Word) ═══ */
(function (BT) {
  BT.blocks.register('pagebreak', {
    label: 'Quebra de página', icon: '📃', desc: 'Força nova página no PDF/Word', order: 90, content: false,
    create: () => ({}),
    editor: () => BT.h('div', { class: 'pagebreak-preview' }, 'nova página'),
    render: () => '<div class="bpb"></div>',
    word: () => '<br clear="all" style="page-break-before:always">'
  });
})(window.BT);
