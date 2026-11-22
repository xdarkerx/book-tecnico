/* ═══ Sidebar: menus (grupos) e seções — criar, renomear, reordenar (arrastar), excluir ═══ */
(function (BT) {
  const h = BT.h;
  const S = () => BT.store;
  const D = BT.ui.dnd;

  function render() {
    const tree = document.getElementById('menu-tree');
    const st = S().state;
    const route = st.ui.route;
    tree.innerHTML = '';
    st.groups.forEach((g) => tree.appendChild(groupEl(g, route)));
    document.querySelector('.ni-cover').classList.toggle('on', route === 'cover');
  }

  function groupEl(g, route) {
    const el = h('div', { class: 'ng' + (g.collapsed ? ' collapsed' : '') + (g.include === false ? ' ng-off' : ''), 'data-gid': g.id });
    const hd = h('div', { class: 'ng-hd', draggable: 'true', title: 'Arraste para reordenar o menu' }, [
      h('span', { class: 'ng-caret', onclick: (e) => { e.stopPropagation(); g.collapsed = !g.collapsed; S().commit(null, 'collapse'); } }, '▾'),
      h('span', { class: 'ng-ic', title: g.title }, g.icon),
      h('span', { class: 'ng-title', ondblclick: () => editGroup(g) }, g.title),
      h('span', { class: 'ng-tools' }, [
        h('button', { class: 'mini-btn', title: 'Nova seção neste menu', onclick: (e) => { e.stopPropagation(); addSection(g); } }, '＋'),
        h('button', { class: 'mini-btn', title: 'Opções do menu', onclick: (e) => { e.stopPropagation(); groupMenu(g, e); } }, '⋯')
      ])
    ]);
    hd.addEventListener('click', () => { g.collapsed = !g.collapsed; S().commit(null, 'collapse'); });
    hd.addEventListener('dragstart', (e) => { D.start(e, { kind: 'group', id: g.id }); el.classList.add('dragging'); });
    // soltar seção/bloco no cabeçalho do menu → vai para o fim deste menu
    hd.addEventListener('dragover', (e) => {
      const p = D.payload; if (!p) return;
      if (p.kind === 'section') { e.preventDefault(); e.stopPropagation(); hd.classList.add('drop-target'); }
    });
    hd.addEventListener('dragleave', () => hd.classList.remove('drop-target'));
    hd.addEventListener('drop', (e) => {
      const p = D.payload; if (!p || p.kind !== 'section') return;
      e.preventDefault(); e.stopPropagation();
      g.collapsed = false;
      S().moveSection(p.id, g.id, g.sections.length);
    });

    const body = h('div', { class: 'ng-body' });
    g.sections.forEach((s) => body.appendChild(sectionEl(g, s, route)));
    body.appendChild(h('button', { class: 'ni-add', onclick: () => addSection(g) }, '＋ seção'));
    body.addEventListener('dragover', (e) => {
      const p = D.payload; if (!p || p.kind !== 'section') return;
      e.preventDefault(); e.stopPropagation();
      const { ref } = D.indexAt(body, '.ni', e.clientY);
      D.showLine(body, ref || body.querySelector('.ni-add'), 'drop-line');
    });
    body.addEventListener('drop', (e) => {
      const p = D.payload; if (!p || p.kind !== 'section') return;
      e.preventDefault(); e.stopPropagation();
      D.clearLines();
      const { index } = D.indexAt(body, '.ni', e.clientY);
      S().moveSection(p.id, g.id, index);
    });
    el.append(hd, body);
    return el;
  }

  function sectionEl(g, s, route) {
    const count = s.blocks.filter((b) => BT.blocks.isContent(b) && !BT.blocks.isEmpty(b)).length;
    const el = h('button', { class: 'ni' + (route === s.id ? ' on' : '') + (s.include === false ? ' ni-off' : ''), 'data-sid': s.id, draggable: 'true', title: s.title }, [
      h('span', { class: 'ic' }, s.icon),
      h('span', { class: 'ni-lbl' }, s.title),
      count ? h('span', { class: 'ni-count', title: 'Blocos com conteúdo' }, String(count)) : null,
      h('span', { class: 'ni-tools' }, [h('span', { class: 'mini-btn', role: 'button', title: 'Opções da seção', onclick: (e) => { e.stopPropagation(); sectionMenu(g, s, e); } }, '⋯')])
    ]);
    el.addEventListener('click', () => BT.editor.router.go(s.id));
    el.addEventListener('dblclick', () => editSection(s));
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); sectionMenu(g, s, e); });
    el.addEventListener('dragstart', (e) => { e.stopPropagation(); D.start(e, { kind: 'section', id: s.id }); el.classList.add('dragging'); });
    // soltar um bloco sobre a seção → move o bloco para ela
    el.addEventListener('dragover', (e) => {
      const p = D.payload; if (!p || (p.kind !== 'block' && p.kind !== 'new-block')) return;
      e.preventDefault(); e.stopPropagation(); el.classList.add('drop-target');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
    el.addEventListener('drop', (e) => {
      const p = D.payload; if (!p || (p.kind !== 'block' && p.kind !== 'new-block')) return;
      e.preventDefault(); e.stopPropagation();
      if (p.kind === 'block') { S().moveBlock(p.id, s.id); BT.ui.toast(`Bloco movido para "${s.title}"`, { type: 'ok' }); }
      else { const b = S().addBlock(s.id, p.type); BT.editor.router.go(s.id); BT.editor.canvas.focusBlock(b.id); }
    });
    return el;
  }

  // ── Ações ────────────────────────────────────────────
  async function addSection(g) {
    const r = await BT.ui.modal.editItem({ title: `Nova seção em "${g.title}"`, name: 'Nova seção', icon: '📄' });
    if (!r) return;
    g.collapsed = false;
    const s = S().addSection(g.id, { title: r.name, icon: r.icon, blocks: [{ type: 'text', data: { title: '', html: '' } }] });
    BT.editor.router.go(s.id);
  }
  async function addGroup() {
    const r = await BT.ui.modal.editItem({
      title: 'Novo menu', name: 'Novo menu', icon: '📁',
      extras: [
        { key: 'separator', label: 'Abrir capítulo no book (página divisória)', type: 'checkbox', value: true },
        { key: 'provider', label: 'Provedor de cloud (opcional — usado na importação e nos "Ambientes" da capa)', type: 'select', value: '', options: [['', '— nenhum —'], ...BT.data.providerList.map((k) => [k, BT.data.providers[k].display])] }
      ]
    });
    if (!r) return;
    const g = S().addGroup({ title: r.name, icon: r.icon, separator: r.separator, provider: r.provider, sections: [{ title: 'Nova seção', icon: '📄', blocks: [{ type: 'text', data: { title: '', html: '' } }] }] });
    BT.editor.router.go(g.sections[0].id);
  }
  async function editGroup(g) {
    const r = await BT.ui.modal.editItem({
      title: 'Editar menu', name: g.title, icon: g.icon,
      extras: [
        { key: 'separator', label: 'Abrir capítulo no book (página divisória)', type: 'checkbox', value: g.separator },
        { key: 'subtitle', label: 'Subtítulo do capítulo (opcional)', type: 'text', value: g.subtitle, placeholder: 'ex.: Ambiente produtivo' },
        { key: 'provider', label: 'Provedor de cloud', type: 'select', value: g.provider || '', options: [['', '— nenhum —'], ...BT.data.providerList.map((k) => [k, BT.data.providers[k].display])] }
      ]
    });
    if (r) S().updateGroup(g.id, { title: r.name, icon: r.icon, separator: r.separator, subtitle: r.subtitle, provider: r.provider });
  }
  async function editSection(s) {
    const r = await BT.ui.modal.editItem({ title: 'Editar seção', name: s.title, icon: s.icon });
    if (r) S().updateSection(s.id, { title: r.name, icon: r.icon });
  }

  function groupMenu(g, e) {
    const st = S().state;
    const i = st.groups.indexOf(g);
    BT.ui.contextMenu(e.clientX, e.clientY, [
      { label: '✏️ Renomear / ícone / opções', onClick: () => editGroup(g) },
      { label: '＋ Nova seção', onClick: () => addSection(g) },
      { label: g.include === false ? '👁 Incluir menu no book' : '🚫 Ocultar menu do book', onClick: () => S().updateGroup(g.id, { include: g.include === false }) },
      'hr',
      { label: '↑ Mover para cima', onClick: () => i > 0 && S().moveGroup(g.id, i - 1) },
      { label: '↓ Mover para baixo', onClick: () => i < st.groups.length - 1 && S().moveGroup(g.id, i + 2) },
      'hr',
      {
        label: '🗑 Excluir menu', onClick: async () => {
          if (!(await BT.ui.modal.confirm(`Excluir o menu "${g.title}" e suas ${g.sections.length} seção(ões)?`, { danger: true, okText: 'Excluir' }))) return;
          const undo = S().removeGroup(g.id);
          if (g.sections.some((s) => s.id === st.ui.route)) BT.editor.router.go('cover');
          BT.ui.toast('Menu excluído', { action: undo });
        }
      }
    ]);
  }

  function sectionMenu(g, s, e) {
    const st = S().state;
    BT.ui.contextMenu(e.clientX, e.clientY, [
      { label: '✏️ Renomear / ícone', onClick: () => editSection(s) },
      { label: '⧉ Duplicar seção', onClick: () => { const c = S().duplicateSection(s.id); BT.editor.router.go(c.id); } },
      { label: s.include === false ? '👁 Incluir no book' : '🚫 Ocultar do book', onClick: () => S().updateSection(s.id, { include: s.include === false }) },
      'hr',
      ...st.groups.filter((x) => x !== g).map((x) => ({ label: `↪ Mover para ${x.icon} ${x.title}`, onClick: () => { x.collapsed = false; S().moveSection(s.id, x.id, x.sections.length); } })),
      'hr',
      {
        label: '🗑 Excluir seção', onClick: async () => {
          const undo = S().removeSection(s.id);
          if (st.ui.route === s.id) BT.editor.router.go('cover');
          BT.ui.toast(`Seção "${s.title}" excluída`, { action: () => { undo(); BT.editor.router.go(s.id); } });
        }
      }
    ]);
  }

  function init() {
    const tree = document.getElementById('menu-tree');
    tree.addEventListener('dragover', (e) => {
      const p = D.payload; if (!p || p.kind !== 'group') return;
      e.preventDefault();
      const { ref } = D.indexAt(tree, '.ng', e.clientY);
      D.showLine(tree, ref, 'drop-line');
    });
    tree.addEventListener('drop', (e) => {
      const p = D.payload; if (!p || p.kind !== 'group') return;
      e.preventDefault(); D.clearLines();
      S().moveGroup(p.id, D.indexAt(tree, '.ng', e.clientY).index);
    });
    document.getElementById('btn-add-group').addEventListener('click', addGroup);
    document.querySelector('.ni-cover').addEventListener('click', () => BT.editor.router.go('cover'));
    BT.on('store:structure', render);
    BT.on('store:content', BT.core.utils.debounce(render, 400));
    BT.on('route', render);
  }

  BT.editor.sidebar = { init, render, addGroup, addSection, editSection, sectionMenu };
})(window.BT);
