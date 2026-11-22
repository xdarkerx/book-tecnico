/* ═══ Bloco: Título / subtítulo ═══ */
(function (BT) {
  const h = BT.h;
  BT.blocks.register('heading', {
    label: 'Título', icon: '🔠', desc: 'Subtítulo dentro da seção', order: 10, content: false,
    create: () => ({ text: '', level: 2 }),
    isEmpty: (b) => !String(b.data.text || '').trim(),
    editor(block, ctx) {
      return h('div', { class: 'heading-row' }, [
        h('select', { class: 'inp inp-sm', style: { width: '140px' }, onchange: (e) => { block.data.level = Number(e.target.value); ctx.save(); } }, [
          h('option', { value: 2, selected: block.data.level === 2 }, 'Destaque (H2)'),
          h('option', { value: 3, selected: block.data.level === 3 }, 'Simples (H3)')
        ]),
        h('input', { class: 'heading-in', value: block.data.text, placeholder: 'Texto do título', oninput: (e) => { block.data.text = e.target.value; ctx.save(); } })
      ]);
    },
    render: (b) => `<div class="${b.data.level === 3 ? 'bh3' : 'bh2'}">${BT.esc(b.data.text)}</div>`,
    word: (b) => b.data.level === 3
      ? `<h3 style="font-family:Arial;font-size:12pt;color:#171C37;margin:12pt 0 4pt">${BT.esc(b.data.text)}</h3>`
      : `<p style="font-family:Consolas,monospace;font-size:9.5pt;font-weight:bold;color:#5E3FE1;text-transform:uppercase;letter-spacing:1.5px;margin:16pt 0 6pt;border-bottom:1px solid #e4e0fb;padding-bottom:3pt">${BT.esc(b.data.text)}</p>`
  });
})(window.BT);
