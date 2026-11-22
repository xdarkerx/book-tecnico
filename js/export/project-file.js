/* ═══ Projeto: novo, abrir e salvar (.book.json) ═══
   O arquivo .json guarda tudo (menus, seções, blocos, imagens) e pode ser
   reaberto em outro computador ou usado como modelo para o próximo mês. */
(function (BT) {
  const U = BT.core.utils;
  const P = {
    save() {
      const st = BT.store.state;
      const name = `book-${U.slug(st.meta.cliente || 'cliente')}-${st.meta.ano || ''}-${st.meta.mes || ''}.book.json`;
      U.download(JSON.stringify(Object.assign({ app: 'book-tecnico', savedAt: new Date().toISOString() }, st)), name, 'application/json');
      BT.ui.toast('Projeto salvo ✓', { type: 'ok' });
    },
    open() { document.getElementById('file-open').click(); },
    /** Abrir .json cria um book novo (cliente/ano/mês/área do próprio arquivo). */
    async load(file) {
      try {
        const data = JSON.parse(await U.readAsText(file));
        if (!data.groups || !data.meta) throw new Error('Arquivo não é um projeto do Book Técnico.');
        const st = BT.store.migrate(data);
        const now = new Date();
        const meta = { cliente: st.meta.cliente || file.name.replace(/\..*$/, ''), ano: st.meta.ano || String(now.getFullYear()), mes: st.meta.mes || String(now.getMonth() + 1).padStart(2, '0'), area: st.meta.area || 'InfraCloud' };
        if (await BT.api.getBook(meta) && !(await BT.ui.modal.confirm(`Já existe o book ${BT.session.label(meta)}. Substituir pelo conteúdo do arquivo?`, { danger: true, okText: 'Substituir' }))) return;
        const { id, state } = await BT.session.create(meta, st, st.template);
        BT.editor.nav.openLoaded(id, state);
        BT.ui.toast('Projeto aberto: ' + file.name, { type: 'ok' });
      } catch (e) { BT.ui.toast(e.message || 'Arquivo inválido', { type: 'err', ms: 6000 }); }
    },

    /** Salva o book atual como template reutilizável (com ou sem os dados). */
    async saveTemplate() {
      const st = BT.store.state; if (!BT.store.sessionId) return;
      const r = await BT.ui.modal.editItem({ title: '⭐ Salvar como template', name: st.meta.area || 'Meu template', icon: '⭐',
        extras: [{ key: 'desc', label: 'Descrição', type: 'text', value: '', placeholder: 'ex.: Book InfraCloud com seções de SAP' },
          { key: 'keep', label: 'Manter os dados (planilhas, imagens, KPIs) — desmarcado: só estrutura e textos', type: 'checkbox', value: false }] });
      if (!r) return;
      const state = BT.session.copyState(st, r.keep ? 'all' : 'structure');
      state.meta = Object.assign({}, BT.data.defaultTemplate().meta, { subtitulo: st.meta.subtitulo, governanca: Object.assign({}, st.meta.governanca) });
      await BT.api.saveTemplate({ id: r.name, name: r.name, desc: r.desc, state });
      BT.ui.toast(`Template "${r.name}" salvo ✓ — aparece em "Novo book"`, { type: 'ok' });
    }
  };
  BT.exporters.project = P;
})(window.BT);
