/* ═══ Bloco: Divisor visual ═══ */
(function (BT) {
  BT.blocks.register('divider', {
    label: 'Divisor', icon: '➖', desc: 'Linha separadora', order: 80, content: false,
    create: () => ({}),
    editor: () => BT.h('div', { class: 'divider-preview' }),
    render: () => '<hr class="bdiv">',
    word: () => '<p style="border-bottom:1.5pt solid #5E3FE1;margin:12pt 0;font-size:2pt">&nbsp;</p>'
  });
})(window.BT);
