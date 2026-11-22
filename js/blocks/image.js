/* ═══ Bloco: Imagens (diagramas, prints, gráficos) ═══
 * data = { title, images:[{src, caption, name}], layout:'full'|'grid2'|'grid3' }
 * Aceita: clique, arrastar arquivos, ou colar (Ctrl+V) um print direto no bloco.
 */
(function (BT) {
  const h = BT.h;
  const U = BT.core.utils;

  BT.blocks.register('image', {
    label: 'Imagem', icon: '🖼️', desc: 'Diagramas, prints e gráficos (cole com Ctrl+V)', order: 40,
    create: () => ({ title: '', images: [], layout: 'grid2' }),
    isEmpty: (b) => !(b.data.images || []).length,

    editor(block, ctx) {
      const d = block.data; d.images = d.images || [];
      const grid = h('div', { class: 'ig' });
      const fileIn = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: (e) => { addFiles(e.target.files); e.target.value = ''; } });

      async function addFiles(files) {
        const list = Array.from(files || []).filter(U.isImage);
        if (!list.length) return BT.ui.toast('Selecione arquivos de imagem (até 15 MB).', { type: 'err' });
        for (const f of list) {
          const src = await U.compressImage(await U.readAsDataURL(f));
          d.images.push({ src, caption: '', name: f.name.replace(/\.[^.]+$/, '') });
        }
        ctx.save(); draw();
      }

      function draw() {
        grid.innerHTML = '';
        d.images.forEach((im, i) => {
          const card = h('div', { class: 'ic_' });
          const imgBox = h('div', { class: 'ic-img', draggable: 'true' }, [
            h('img', { src: im.src, alt: im.caption || im.name || '' }),
            h('div', { class: 'ic-tools' }, [
              h('button', { title: 'Mover para trás', onclick: () => move(i, i - 1) }, '◀'),
              h('button', { title: 'Mover para frente', onclick: () => move(i, i + 1) }, '▶'),
              h('button', { class: 'del', title: 'Remover', onclick: () => { const [r] = d.images.splice(i, 1); ctx.save(); draw(); BT.ui.toast('Imagem removida', { action: () => { d.images.splice(i, 0, r); ctx.save(); draw(); } }); } }, '✕')
            ])
          ]);
          imgBox.addEventListener('dragstart', (e) => { BT.ui.dnd.start(e, { kind: 'image', block: block.id, index: i }); card.classList.add('dragging'); });
          card.addEventListener('dragover', (e) => { const p = BT.ui.dnd.payload; if (p && p.kind === 'image' && p.block === block.id) e.preventDefault(); });
          card.addEventListener('drop', (e) => {
            const p = BT.ui.dnd.payload; if (!p || p.kind !== 'image' || p.block !== block.id) return;
            e.preventDefault(); e.stopPropagation(); move(p.index, i);
          });
          card.append(imgBox, h('input', { class: 'cap-in', value: im.caption || '', placeholder: 'Legenda (opcional)', oninput: (e) => { im.caption = e.target.value; ctx.save(); } }));
          grid.appendChild(card);
        });
      }
      function move(from, to) {
        if (to < 0 || to >= d.images.length || from === to) return;
        const [x] = d.images.splice(from, 1); d.images.splice(to, 0, x); ctx.save(); draw();
      }

      const drop = h('div', { class: 'idrop', tabindex: '0', onclick: () => fileIn.click() }, [
        h('div', { class: 'di' }, '🖼️'),
        h('div', { class: 'dt', html: '<strong>Clique</strong>, arraste imagens ou <strong>cole um print</strong> (Ctrl+V)' }),
        h('div', { class: 'df' }, 'PNG · JPG · SVG · WEBP — até 15 MB'),
        fileIn
      ]);
      drop.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); drop.classList.add('ov'); } });
      drop.addEventListener('dragleave', () => drop.classList.remove('ov'));
      drop.addEventListener('drop', (e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); e.stopPropagation(); drop.classList.remove('ov'); addFiles(e.dataTransfer.files); });

      const root = h('div', { tabindex: '-1' });
      root.addEventListener('paste', (e) => {
        const files = Array.from(e.clipboardData.items || []).filter((it) => it.kind === 'file').map((it) => it.getAsFile()).filter(Boolean);
        if (files.length) { e.preventDefault(); addFiles(files); }
      });

      const layout = h('select', { class: 'inp inp-sm', style: { width: 'auto' }, onchange: (e) => { d.layout = e.target.value; ctx.save(); } }, [
        ['full', 'Uma por linha (largura total)'], ['grid2', 'Grade de 2 colunas'], ['grid3', 'Grade de 3 colunas']
      ].map(([v, l]) => h('option', { value: v, selected: d.layout === v }, l)));

      draw();
      root.append(BT.blocks.titleInput(block, ctx), h('div', { class: 'img-opts' }, [h('span', { class: 'lbl' }, 'Layout'), layout]), drop, grid);
      return root;
    },

    render(b, ctx) {
      const d = b.data;
      return BT.blocks.titleHtml(b, ctx) + `<div class="bimgs l-${d.layout || 'grid2'}">` + d.images.map((im) =>
        `<figure class="biitem" style="margin:0"><img src="${im.src}" alt="${BT.esc(im.caption || im.name || '')}">${im.caption ? `<figcaption class="bicap">${BT.esc(im.caption)}</figcaption>` : ''}</figure>`).join('') + '</div>';
    },

    /** Word: grade em tabela, largura em px (o Word ignora max-width). */
    word(b, ctx) {
      const d = b.data;
      const cols = d.layout === 'grid3' ? 3 : d.layout === 'full' ? 1 : 2;
      const w = Math.floor(600 / cols) - 10;
      let rows = '';
      for (let i = 0; i < d.images.length; i += cols) {
        rows += '<tr>' + d.images.slice(i, i + cols).map((im) => {
          const dims = im._w && im._h ? `width="${w}" height="${Math.round(w * im._h / im._w)}"` : `width="${w}"`;
          return `<td width="${Math.floor(100 / cols)}%" valign="top" style="padding:4pt;border:1px solid #e8e6f8"><img src="${im.src}" ${dims} style="display:block">` +
            (im.caption ? `<p style="margin:3pt 0 0;font-family:Arial;font-size:8pt;color:#6a7294">${BT.esc(im.caption)}</p>` : '') + '</td>';
        }).join('') + '</tr>';
      }
      return BT.blocks.titleHtml(b, ctx) + `<table width="100%" cellspacing="4" cellpadding="0" style="border-collapse:separate;margin:6pt 0">${rows}</table>`;
    }
  });
})(window.BT);
