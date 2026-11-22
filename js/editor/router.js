/* ═══ Navegação: 'cover' (capa & cliente) ou id de uma seção ═══ */
(function (BT) {
  const R = {
    go(route) {
      if (route !== 'cover' && !BT.store.findSection(route)) route = 'cover';
      BT.store.setRoute(route);
      R.render();
      document.getElementById('canvas-scroll').scrollTop = 0;
      document.getElementById('app').classList.remove('sb-open');
    },
    render() {
      const view = document.getElementById('view');
      const route = BT.store.state.ui.route;
      if (route !== 'cover' && BT.store.findSection(route)) BT.editor.canvas.render(view, route);
      else BT.editor.cover.render(view);
      const f = BT.store.findSection(route);
      document.getElementById('tb-doc').textContent = (BT.store.state.meta.cliente || 'Book Técnico') + (f ? ' › ' + f.section.title : ' › Capa & Cliente');
    }
  };
  BT.on('store:structure', (e) => { if (!e || e.reason !== 'collapse') R.render(); });
  BT.editor.router = R;
})(window.BT);
