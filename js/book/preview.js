/* ═══ Pré-visualização do book ═══ */
(function (BT) {
  const pv = () => document.getElementById('pv');
  const P = {
    /** opts.selection = Set de ids de seção (pré-visualizar só o que vai ser exportado) */
    open(opts = {}) {
      P.selection = opts.selection || null;
      document.getElementById('book-out').innerHTML = BT.book.render(BT.store.state, opts.selection ? { selection: opts.selection } : {});
      document.querySelector('#pv .pvt').textContent = opts.selection ? `Pré-visualização do que será exportado (${opts.selection.size} seção(ões)) · clique numa seção para editá-la` : 'Pré-visualização · clique numa seção para editá-la';
      pv().classList.add('on');
      pv().scrollTop = 0;
      document.body.style.overflow = 'hidden';
    },
    close() { pv().classList.remove('on'); document.body.style.overflow = ''; },
    init() {
      document.getElementById('pv-close').addEventListener('click', P.close);
      document.getElementById('pv-export').addEventListener('click', () => BT.exporters.dialog.open(P.format || 'pdf', P.selection));
      document.getElementById('book-out').addEventListener('click', (e) => {
        const sec = e.target.closest('.bsec[data-sec]');
        if (sec) { P.close(); BT.editor.router.go(sec.dataset.sec); }
      });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pv().classList.contains('on') && !document.querySelector('.modal-wrap')) P.close(); });
    }
  };
  BT.book.preview = P;
})(window.BT);
