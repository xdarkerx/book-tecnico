/* ═══ Canvas: editor de uma seção com blocos arrastáveis ═══
 * - arraste blocos pela alça ⠿ para reordenar (ou para outra seção na sidebar)
 * - arraste tipos da paleta para inserir na posição desejada
 * - solte imagens ou planilhas direto no canvas
 * - cada bloco continua editável depois de criado (texto, planilha, cabeçalhos, imagens…)
 */
(function (BT) {
  const h = BT.h;
  const D = BT.ui.dnd;
  const S = () => BT.store;
  let currentSectionId = null;
  let pendingFocus = null;

  function render(view, sectionId) {
    const f = S().findSection(sectionId);
    if (!f) return;
    currentSectionId = sectionId;
    const { group, section } = f;
    view.innerHTML = '';

    const titleIn = h('input', {
      class: 'sec-title-in', value: section.title, placeholder: 'Título da seção',
      oninput: (e) => { section.title = e.target.value; S().touch(); },
      onchange: () => S().commit(null, 'rename')
    });
    const include = h('input', { type: 'checkbox', checked: section.include !== false, onchange: (e) => S().updateSection(section.id, { include: e.target.checked }) });

    view.append(
      h('div', { class: 'crumb' }, `${group.icon} ${group.title} › ${section.title}`),
      h('div', { class: 'sec-head' }, [
        h('button', { class: 'sec-icon', title: 'Trocar ícone', onclick: () => BT.editor.sidebar.editSection(section) }, section.icon),
        titleIn,
        h('button', { class: 'btn-icon', title: 'Opções da seção', onclick: (e) => BT.editor.sidebar.sectionMenu(group, section, e) }, '⋯')
      ]),
      h('div', { class: 'sec-meta' }, [
        h('label', { class: 'switch' }, [include, 'Incluir esta seção no book']),
        h('span', {}, `${section.blocks.length} bloco(s)`),
        h('span', { class: 'muted' }, 'Arraste ⠿ para reordenar · arraste da paleta para inserir')
      ])
    );

    const list = h('div', { class: 'blocks', 'data-sid': section.id });
    if (!section.blocks.length) list.appendChild(emptyState(section));
    section.blocks.forEach((b, i) => list.appendChild(blockFrame(section, b, i)));
    bindDrop(list, section);
    view.appendChild(list);
    view.appendChild(h('div', { class: 'add-between' }, h('button', { class: 'btn-dashed', style: { marginTop: '14px' }, onclick: (e) => addMenu(e, section, section.blocks.length) }, '＋ Adicionar bloco')));

    if (pendingFocus) { const id = pendingFocus; pendingFocus = null; setTimeout(() => focusBlockNow(id), 30); }
  }

  function emptyState(section) {
    return h('div', { class: 'empty-sec' }, [
      h('div', { class: 'es-ic' }, '🧩'),
      h('b', {}, 'Seção vazia'),
      h('div', {}, 'Arraste um bloco da paleta para cá, solte imagens/planilhas aqui, ou escolha:'),
      h('div', { class: 'es-actions' }, [
        ...BT.blocks.list().filter((d) => ['text', 'table', 'image', 'kpi'].includes(d.type)).map((d) =>
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => addAndFocus(section.id, d.type) }, `${d.icon} ${d.label}`)),
        h('button', { class: 'btn btn-sec btn-sm', onclick: () => BT.importer.wizard.open() }, '☁️ Importar cloud')
      ])
    ]);
  }

  function blockFrame(section, block, index) {
    const def = BT.blocks.get(block.type);
    const el = h('div', { class: 'blk' + (block.include === false ? ' blk-off' : ''), 'data-bid': block.id });
    if (!def) { el.textContent = 'Tipo de bloco desconhecido: ' + block.type; return el; }

    const handle = h('span', { class: 'blk-handle', draggable: 'true', title: 'Arraste para mover (também para outra seção na barra lateral)' }, '⠿⠿');
    handle.addEventListener('dragstart', (e) => { D.start(e, { kind: 'block', id: block.id }, el); el.classList.add('dragging'); });

    const inc = h('input', { type: 'checkbox', checked: block.include !== false, title: 'Incluir no book', onchange: (e) => { block.include = e.target.checked; el.classList.toggle('blk-off', !e.target.checked); S().touch(); } });
    const tools = h('div', { class: 'blk-tools' }, [
      h('label', { class: 'switch', title: 'Incluir este bloco no book' }, [inc, h('span', { class: 'hide-sm' }, 'no book')]),
      h('span', { class: 'sep' }),
      h('button', { class: 'mini-btn', title: 'Mover para cima', onclick: () => index > 0 && S().moveBlock(block.id, section.id, index - 1) }, '↑'),
      h('button', { class: 'mini-btn', title: 'Mover para baixo', onclick: () => index < section.blocks.length - 1 && S().moveBlock(block.id, section.id, index + 2) }, '↓'),
      h('button', { class: 'mini-btn', title: 'Duplicar', onclick: () => { const c = S().duplicateBlock(block.id); focusBlock(c.id); } }, '⧉'),
      h('button', { class: 'mini-btn', title: 'Mais opções', onclick: (e) => blockMenu(e, section, block, index) }, '⋯'),
      h('button', { class: 'mini-btn', title: 'Excluir bloco', onclick: () => removeBlock(block) }, '✕')
    ]);

    const ctx = { save: () => S().touch(), section, block };
    let body;
    try { body = def.editor(block, ctx); } catch (err) { console.error(err); body = h('div', { class: 'muted' }, 'Erro ao abrir o editor deste bloco.'); }

    el.append(h('div', { class: 'blk-toolbar' }, [handle, h('span', { class: 'blk-type' }, `${def.icon} ${def.label}`), tools]), h('div', { class: 'blk-body' }, body));
    el.addEventListener('focusin', () => { document.querySelectorAll('.blk.selected').forEach((b) => b !== el && b.classList.remove('selected')); el.classList.add('selected'); });
    return el;
  }

  function removeBlock(block) {
    const undo = S().removeBlock(block.id);
    const def = BT.blocks.get(block.type);
    BT.ui.toast(`Bloco "${def ? def.label : block.type}" excluído`, { action: undo });
  }

  function blockMenu(e, section, block, index) {
    const others = S().allSections().filter((x) => x.section.id !== section.id);
    BT.ui.contextMenu(e.clientX, e.clientY, [
      { label: '＋ Inserir bloco acima', onClick: () => addMenu(e, section, index) },
      { label: '＋ Inserir bloco abaixo', onClick: () => addMenu(e, section, index + 1) },
      'hr',
      ...(block.type === 'table' ? [{ label: '⬆ Importar arquivo nesta planilha', onClick: () => BT.importer.wizard.open({ targetBlockId: block.id }) }, 'hr'] : []),
      {
        label: '↪ Mover para outra seção…', onClick: () => {
          const sel = h('select', { class: 'inp' }, S().state.groups.map((g) => h('optgroup', { label: g.icon + ' ' + g.title }, g.sections.filter((s) => s.id !== section.id).map((s) => h('option', { value: s.id }, s.icon + ' ' + s.title)))));
          const m = BT.ui.modal.open({
            title: 'Mover bloco para…', body: [sel],
            footer: [h('button', { class: 'btn btn-ghost btn-sm', onclick: () => m.close() }, 'Cancelar'), h('button', { class: 'btn btn-primary btn-sm', onclick: () => { m.close(); S().moveBlock(block.id, sel.value); BT.ui.toast('Bloco movido ✓', { type: 'ok' }); } }, 'Mover')]
          });
        }
      },
      { label: '⧉ Duplicar', onClick: () => S().duplicateBlock(block.id) },
      { label: '✕ Excluir', onClick: () => removeBlock(block) }
    ].filter((x) => x !== undefined && (others.length || !(x.label || '').startsWith('↪'))));
  }

  function addMenu(e, section, index) {
    BT.ui.contextMenu(e.clientX, e.clientY, [
      ...BT.blocks.list().map((d) => ({ label: `${d.icon}  ${d.label}`, onClick: () => addAndFocus(section.id, d.type, index) })),
      'hr',
      { label: '☁️  Importar dados de cloud…', onClick: () => BT.importer.wizard.open() }
    ]);
  }

  function addAndFocus(sectionId, type, index, data) {
    const b = S().addBlock(sectionId, type, index, data);
    if (b) focusBlock(b.id);
    return b;
  }

  /** Foca o bloco após o próximo render. */
  function focusBlock(id) { pendingFocus = id; setTimeout(() => { if (pendingFocus === id) { pendingFocus = null; focusBlockNow(id); } }, 60); }
  function focusBlockNow(id) {
    const el = document.querySelector(`.blk[data-bid="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('selected');
    const f = ['.rt', '.heading-in', '.cell', '.kv', '.idrop', 'input:not([type=checkbox])'].map((q) => el.querySelector(q)).find(Boolean);
    if (f) setTimeout(() => f.focus({ preventScroll: true }), 250);
  }

  // ── Soltar no canvas: blocos, tipos da paleta e arquivos ──
  function bindDrop(list, section) {
    list.addEventListener('dragover', (e) => {
      const p = D.payload;
      const files = !p && e.dataTransfer.types.includes('Files');
      if (!files && (!p || (p.kind !== 'block' && p.kind !== 'new-block'))) return;
      e.preventDefault();
      list.classList.add('drag-over');
      const { ref } = D.indexAt(list, '.blk', e.clientY);
      D.showLine(list, ref);
    });
    list.addEventListener('dragleave', (e) => { if (!list.contains(e.relatedTarget)) { list.classList.remove('drag-over'); D.clearLines(); } });
    list.addEventListener('drop', async (e) => {
      const p = D.payload;
      const { index } = D.indexAt(list, '.blk', e.clientY);
      list.classList.remove('drag-over'); D.clearLines();
      if (p && p.kind === 'new-block') { e.preventDefault(); addAndFocus(section.id, p.type, index); return; }
      if (p && p.kind === 'block') { e.preventDefault(); S().moveBlock(p.id, section.id, index); return; }
      if (!p && e.dataTransfer.files.length) {
        e.preventDefault();
        const files = [...e.dataTransfer.files];
        const imgs = files.filter(BT.core.utils.isImage);
        const sheets = files.filter((f) => /\.(csv|xlsx|xls|xlsm|tsv|json)$/i.test(f.name));
        if (imgs.length) {
          const images = [];
          for (const f of imgs) images.push({ src: await BT.core.utils.compressImage(await BT.core.utils.readAsDataURL(f)), caption: '', name: f.name.replace(/\.[^.]+$/, '') });
          addAndFocus(section.id, 'image', index, { title: '', images, layout: images.length > 1 ? 'grid2' : 'full' });
        }
        if (sheets.length) BT.importer.wizard.open({ file: sheets[0] });
      }
    });
  }

  /** Clique na paleta: adiciona ao final da seção atual. */
  function addToCurrent(type) {
    const route = S().state.ui.route;
    if (!S().findSection(route)) { BT.ui.toast('Abra uma seção na barra lateral para adicionar blocos.'); return; }
    addAndFocus(route, type);
    BT.editor.panels && BT.editor.panels.afterAdd();
  }

  // Colar um print (Ctrl+V) fora de campos de texto → cria bloco de imagem
  document.addEventListener('paste', async (e) => {
    const t = e.target;
    if (t.closest && t.closest('input,textarea,[contenteditable="true"],.modal-wrap,.blk')) return;
    const route = S() && S().state && S().state.ui.route;
    if (!route || !S().findSection(route)) return;
    const files = [...(e.clipboardData?.items || [])].filter((i) => i.kind === 'file' && i.type.startsWith('image/')).map((i) => i.getAsFile());
    if (!files.length) return;
    e.preventDefault();
    const images = [];
    for (const f of files) images.push({ src: await BT.core.utils.compressImage(await BT.core.utils.readAsDataURL(f)), caption: '', name: 'print' });
    addAndFocus(route, 'image', undefined, { title: '', images, layout: 'full' });
    BT.ui.toast('Imagem colada como novo bloco ✓', { type: 'ok' });
  });

  BT.editor.canvas = { render, addToCurrent, focusBlock, get currentSectionId() { return currentSectionId; } };
})(window.BT);
