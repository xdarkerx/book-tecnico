/* ═══ Bloco: Texto rico ═══ */
(function (BT) {
  BT.blocks.register('text', {
    label: 'Texto', icon: '📝', desc: 'Parágrafos, listas, negrito, links', order: 20,
    create: () => ({ title: '', html: '' }),
    isEmpty: (b) => !BT.blocks.stripTags(b.data.html),
    editor(block, ctx) {
      return BT.h('div', {}, [
        BT.blocks.titleInput(block, ctx),
        BT.blocks.richText(block.data.html, (html) => { block.data.html = html; ctx.save(); }, 'Escreva o texto desta seção…')
      ]);
    },
    render: (b, ctx) => BT.blocks.titleHtml(b, ctx) + `<div class="bxt bblk">${BT.core.sanitizeHtml(b.data.html)}</div>`,
    word: (b, ctx) => BT.blocks.titleHtml(b, ctx) +
      `<div style="font-family:Arial;font-size:10.5pt;color:#3d4466;line-height:150%">${BT.core.sanitizeHtml(b.data.html)}</div>`
  });
})(window.BT);
