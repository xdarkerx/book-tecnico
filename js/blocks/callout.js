/* ═══ Bloco: Destaque (nota, alerta, risco, ok) ═══ */
(function (BT) {
  const h = BT.h;
  const TONES = { info: ['ℹ️ Nota', '#f4f2ff', '#5E3FE1'], ok: ['✅ Positivo', '#eefaf7', '#00a383'], warn: ['⚠️ Atenção', '#fff8ea', '#b7860b'], risk: ['⛔ Risco', '#fdf0f4', '#DC5282'] };
  BT.blocks.register('callout', {
    label: 'Destaque', icon: '💡', desc: 'Nota, atenção, risco ou ponto positivo', order: 55,
    create: () => ({ tone: 'info', title: '', html: '' }),
    isEmpty: (b) => !BT.blocks.stripTags(b.data.html),
    editor(block, ctx) {
      const row = h('div', { class: 'tone-row' });
      Object.entries(TONES).forEach(([k, [label]]) => row.appendChild(h('button', {
        class: block.data.tone === k ? 'on' : '', onclick: (e) => { block.data.tone = k; ctx.save(); row.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); }
      }, label)));
      return h('div', {}, [row, BT.blocks.titleInput(block, ctx, 'Título do destaque (opcional)'),
        BT.blocks.richText(block.data.html, (html) => { block.data.html = html; ctx.save(); }, 'Conteúdo do destaque…')]);
    },
    render: (b) => `<div class="bcall ${TONES[b.data.tone] ? b.data.tone : 'info'}">${b.data.title ? `<div class="bcall-title">${BT.esc(b.data.title)}</div>` : ''}${BT.core.sanitizeHtml(b.data.html)}</div>`,
    word(b) {
      const [, bg, fg] = TONES[b.data.tone] || TONES.info;
      return `<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:8pt 0"><tr><td style="background:${bg};border-left:3pt solid ${fg};padding:9pt 12pt;font-family:Arial;font-size:10pt;color:#3d4466">
        ${b.data.title ? `<p style="margin:0 0 4pt;font-weight:bold;color:${fg};font-size:8.5pt;text-transform:uppercase">${BT.esc(b.data.title)}</p>` : ''}${BT.core.sanitizeHtml(b.data.html)}</td></tr></table>`;
    }
  });
})(window.BT);
