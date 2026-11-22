/* ═══ Bloco: Indicadores (cards de KPI) ═══ */
(function (BT) {
  const h = BT.h;
  BT.blocks.register('kpi', {
    label: 'Indicadores', icon: '📊', desc: 'Cards com números de destaque', order: 50,
    create: () => ({ title: '', items: [{ label: 'Servidores', value: '' }, { label: 'Ativos', value: '' }, { label: 'Incidentes', value: '' }] }),
    isEmpty: (b) => !(b.data.items || []).some((i) => String(i.value).trim()),
    editor(block, ctx) {
      const grid = h('div', { class: 'kpi-edit' });
      const draw = () => {
        grid.innerHTML = '';
        block.data.items.forEach((it, i) => {
          grid.appendChild(h('div', { class: 'kpi-card' }, [
            h('button', { class: 'x', title: 'Remover', onclick: () => { block.data.items.splice(i, 1); ctx.save(); draw(); } }, '✕'),
            h('input', { class: 'kv', value: it.value, placeholder: '0', oninput: (e) => { it.value = e.target.value; ctx.save(); } }),
            h('input', { class: 'kl', value: it.label, placeholder: 'Rótulo', oninput: (e) => { it.label = e.target.value; ctx.save(); } })
          ]));
        });
        grid.appendChild(h('button', { class: 'kpi-add', onclick: () => { block.data.items.push({ label: 'Novo', value: '' }); ctx.save(); draw(); } }, '＋ Indicador'));
      };
      draw();
      return h('div', {}, [BT.blocks.titleInput(block, ctx), grid]);
    },
    render(b, ctx) {
      const items = b.data.items.filter((i) => String(i.value).trim() || String(i.label).trim());
      return BT.blocks.titleHtml(b, ctx) + `<div class="bsg">${items.map((i) => `<div class="bsc_"><div class="bsv">${BT.esc(i.value || '—')}</div><div class="bsl">${BT.esc(i.label)}</div></div>`).join('')}</div>`;
    },
    word(b, ctx) {
      const items = b.data.items.filter((i) => String(i.value).trim() || String(i.label).trim());
      const perRow = Math.min(4, items.length) || 1;
      let rows = '';
      for (let i = 0; i < items.length; i += perRow) {
        rows += '<tr>' + items.slice(i, i + perRow).map((it) =>
          `<td width="${Math.floor(100 / perRow)}%" style="border:1px solid #e8e6f8;border-top:2pt solid #5E3FE1;padding:10pt 6pt;text-align:center;background:#ffffff">
            <p style="margin:0;font-family:Arial;font-size:20pt;font-weight:bold;color:#5E3FE1">${BT.esc(it.value || '—')}</p>
            <p style="margin:4pt 0 0;font-family:Consolas,monospace;font-size:7pt;color:#9098b8;text-transform:uppercase;letter-spacing:1px">${BT.esc(it.label)}</p></td>`).join('') + '</tr>';
      }
      return BT.blocks.titleHtml(b, ctx) + `<table width="100%" cellspacing="6" cellpadding="0" style="border-collapse:separate;margin:6pt 0">${rows}</table>`;
    }
  });
})(window.BT);
