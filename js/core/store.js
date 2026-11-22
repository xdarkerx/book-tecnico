/* ═══ Store — estado único do book + operações ═══
 *
 * Formato do estado:
 * {
 *   version: 4,
 *   meta:   { cliente, mes, ano, responsavel, time, subtitulo, ambientes, objetivo,
 *             logoCliente, mostrarSumario, governanca:{...} },
 *   groups: [ { id, title, icon, include, separator, subtitle, provider, collapsed,
 *               sections:[ { id, title, icon, include, blocks:[ {id,type,include,data} ] } ] } ],
 *   ui:     { route: 'cover' | sectionId }
 * }
 *
 * Eventos emitidos:
 *   'store:structure' → mudou a árvore (menus, seções, ordem/qtde de blocos) → re-render
 *   'store:content'   → mudou o conteúdo de um bloco (sem re-render do canvas)
 *   'store:saved'     → persistido
 */
(function (BT) {
  let state = null;
  let sessionId = null;
  let saveTimer = null;
  let dirty = false;

  const S = {
    get state() { return state; },
    get sessionId() { return sessionId; },

    /** Carrega o estado de uma sessão (ver js/core/session.js). */
    load(newState, id) {
      state = migrate(newState);
      if (id !== undefined) sessionId = id;
      BT.emit('store:structure', { reason: 'load' });
      S.scheduleSave();
    },

    /** Somente leitura: o book está sendo editado por outra pessoa (js/core/lock.js). Nada é salvo. */
    readOnly: false,

    scheduleSave() {
      if (!state || !sessionId || S.readOnly) return;
      dirty = true;
      BT.emit('store:saving');
      clearTimeout(saveTimer);
      saveTimer = setTimeout(S.saveNow, 400);
    },

    async saveNow() {
      clearTimeout(saveTimer);
      if (!state || !sessionId || S.readOnly) return;
      try { await BT.session.save(sessionId, state); dirty = false; BT.emit('store:saved'); }
      catch (e) {
        if (e.status === 423) { dirty = false; BT.emit('store:locked', e); return; } // outra pessoa está editando
        if (e.status === 401) return; // login expirou: a tela de login já apareceu
        console.error(e); BT.emit('store:save-error', e);
      }
    },

    /** Chamado ao recarregar/fechar: grava cópia síncrona + dispara o IndexedDB. */
    flush() {
      if (!state || !sessionId || S.readOnly) return;
      BT.session.pointer.set(sessionId, state.ui && state.ui.route);
      if (dirty) { BT.session.backupNow(sessionId, state); S.saveNow(); }
    },

    /** Mudança estrutural: re-renderiza sidebar e canvas. */
    commit(mutator, reason = 'edit') {
      if (mutator) mutator(state);
      BT.emit('store:structure', { reason });
      S.scheduleSave();
    },

    /** Mudança de conteúdo (digitação etc.): só salva. */
    touch() {
      BT.emit('store:content');
      S.scheduleSave();
    },

    // ── Consultas ─────────────────────────────────────────
    allSections() { return state.groups.flatMap((g) => g.sections.map((s) => ({ group: g, section: s }))); },
    findGroup(id) { return state.groups.find((g) => g.id === id); },
    findSection(id) {
      for (const g of state.groups) {
        const i = g.sections.findIndex((s) => s.id === id);
        if (i >= 0) return { group: g, section: g.sections[i], index: i };
      }
      return null;
    },
    findBlock(id) {
      for (const g of state.groups) for (const s of g.sections) {
        const i = s.blocks.findIndex((b) => b.id === id);
        if (i >= 0) return { group: g, section: s, block: s.blocks[i], index: i };
      }
      return null;
    },

    // ── Menus (grupos) ────────────────────────────────────
    addGroup(data = {}) {
      const g = makeGroup(data);
      S.commit((st) => st.groups.push(g), 'add-group');
      return g;
    },
    updateGroup(id, patch) { S.commit(() => Object.assign(S.findGroup(id), patch), 'update-group'); },
    removeGroup(id) {
      const idx = state.groups.findIndex((g) => g.id === id);
      if (idx < 0) return null;
      const [g] = state.groups.splice(idx, 1);
      S.commit(null, 'remove-group');
      return () => S.commit((st) => st.groups.splice(idx, 0, g), 'restore-group');
    },
    moveGroup(id, toIndex) {
      S.commit((st) => {
        const from = st.groups.findIndex((g) => g.id === id);
        if (from < 0) return;
        const [g] = st.groups.splice(from, 1);
        st.groups.splice(toIndex > from ? toIndex - 1 : toIndex, 0, g);
      }, 'move-group');
    },

    // ── Seções ────────────────────────────────────────────
    addSection(groupId, data = {}, index) {
      const g = S.findGroup(groupId);
      const sec = makeSection(data);
      S.commit(() => { if (index === undefined) g.sections.push(sec); else g.sections.splice(index, 0, sec); }, 'add-section');
      return sec;
    },
    updateSection(id, patch, structural = true) {
      const f = S.findSection(id); if (!f) return;
      Object.assign(f.section, patch);
      structural ? S.commit(null, 'update-section') : S.touch();
    },
    removeSection(id) {
      const f = S.findSection(id); if (!f) return null;
      f.group.sections.splice(f.index, 1);
      S.commit(null, 'remove-section');
      return () => S.commit(() => f.group.sections.splice(f.index, 0, f.section), 'restore-section');
    },
    duplicateSection(id) {
      const f = S.findSection(id); if (!f) return;
      const copy = BT.core.utils.clone(f.section);
      copy.id = BT.uid('sec'); copy.title += ' (cópia)';
      copy.blocks.forEach((b) => (b.id = BT.uid('blk')));
      S.commit(() => f.group.sections.splice(f.index + 1, 0, copy), 'dup-section');
      return copy;
    },
    moveSection(id, toGroupId, toIndex) {
      S.commit(() => {
        const f = S.findSection(id); if (!f) return;
        const tg = S.findGroup(toGroupId); if (!tg) return;
        f.group.sections.splice(f.index, 1);
        let idx = toIndex;
        if (f.group === tg && toIndex > f.index) idx--;
        tg.sections.splice(Math.max(0, Math.min(idx, tg.sections.length)), 0, f.section);
      }, 'move-section');
    },

    // ── Blocos ────────────────────────────────────────────
    addBlock(sectionId, type, index, data) {
      const f = S.findSection(sectionId); if (!f) return null;
      const def = BT.blocks.get(type);
      const blk = { id: BT.uid('blk'), type, include: true, data: data || (def ? def.create() : {}) };
      S.commit(() => {
        if (index === undefined || index === null || index > f.section.blocks.length) f.section.blocks.push(blk);
        else f.section.blocks.splice(index, 0, blk);
      }, 'add-block');
      BT.emit('block:added', blk);
      return blk;
    },
    removeBlock(id) {
      const f = S.findBlock(id); if (!f) return null;
      f.section.blocks.splice(f.index, 1);
      S.commit(null, 'remove-block');
      return () => S.commit(() => f.section.blocks.splice(f.index, 0, f.block), 'restore-block');
    },
    duplicateBlock(id) {
      const f = S.findBlock(id); if (!f) return;
      const copy = BT.core.utils.clone(f.block); copy.id = BT.uid('blk');
      S.commit(() => f.section.blocks.splice(f.index + 1, 0, copy), 'dup-block');
      return copy;
    },
    moveBlock(id, toSectionId, toIndex) {
      S.commit(() => {
        const f = S.findBlock(id); if (!f) return;
        const t = S.findSection(toSectionId); if (!t) return;
        f.section.blocks.splice(f.index, 1);
        let idx = toIndex ?? t.section.blocks.length;
        if (f.section === t.section && idx > f.index) idx--;
        t.section.blocks.splice(Math.max(0, Math.min(idx, t.section.blocks.length)), 0, f.block);
      }, 'move-block');
    },
    setRoute(route) {
      state.ui = state.ui || {};
      state.ui.route = route;
      if (sessionId) {
        BT.session.pointer.set(sessionId, route);
        BT.url.go(Object.assign({}, BT.api.keyOf(sessionId), { secao: route !== 'cover' ? route : '' }), { replace: true });
      }
      BT.emit('route', route);
      S.scheduleSave();
    }
  };

  // ── Fábricas ────────────────────────────────────────────
  function makeGroup(d) {
    return Object.assign({ id: BT.uid('grp'), title: 'Novo menu', icon: '📁', include: true, separator: false, subtitle: '', provider: '', collapsed: false, sections: [] }, d, {
      sections: (d.sections || []).map(makeSection)
    });
  }
  function makeSection(d) {
    return Object.assign({ id: BT.uid('sec'), title: 'Nova seção', icon: '📄', include: true, blocks: [] }, d, {
      blocks: (d.blocks || []).map((b) => Object.assign({ id: BT.uid('blk'), include: true, data: {} }, b))
    });
  }
  S.makeGroup = makeGroup;
  S.makeSection = makeSection;

  /** Garante compatibilidade com arquivos salvos por versões anteriores. */
  function migrate(st) {
    st = st || {};
    st.version = 4;
    st.meta = Object.assign({ cliente: '', mes: '', ano: '', area: '', responsavel: '', time: '', subtitulo: 'Relatório Mensal de Infraestrutura e Operações', ambientes: '', objetivo: '', logoCliente: '', mostrarSumario: false, governanca: {} }, st.meta || {});
    st.groups = (st.groups || []).map(makeGroup);
    st.ui = st.ui || { route: 'cover' };
    return st;
  }
  S.migrate = migrate;

  BT.store = S;
})(window.BT);
