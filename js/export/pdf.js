/* ═══ Exportar PDF (impressão do navegador) ═══
   Copia o book para #print-root e chama window.print(); css/book/print.css cuida do resto. */
(function (BT) {
  /** Coloca o conteúdo (tudo depois da capa) numa tabela com cabeçalho/rodapé vazios:
   *  o navegador repete <thead>/<tfoot> em cada página, criando o respiro no topo
   *  (abaixo da faixa roxa) e no rodapé das páginas seguintes — sem margens de página,
   *  então o navegador não imprime data/URL. */
  function frame(book) {
    const cover = book.querySelector('.bcov');
    const rest = [...book.children].filter((el) => el !== cover && !el.classList.contains('book-page-rule'));
    const td = document.createElement('td');
    rest.forEach((el) => td.appendChild(el));
    const t = document.createElement('table');
    t.className = 'print-frame';
    t.innerHTML = '<thead><tr><td><div class="pf-top"></div></td></tr></thead><tbody><tr></tr></tbody><tfoot><tr><td><div class="pf-bottom"></div></td></tr></tfoot>';
    t.querySelector('tbody tr').appendChild(td);
    book.appendChild(t);
  }
  BT.exporters.pdfFrame = frame;

  BT.exporters.pdf = function (state, selection) {
    const root = document.getElementById('print-root');
    root.innerHTML = BT.book.render(state, { selection });
    root.querySelector('.book').classList.add('printing');
    frame(root.querySelector('.book'));
    const prevTitle = document.title;
    document.title = 'Book Técnico - ' + (state.meta.cliente || 'cliente') + ' - ' + BT.core.utils.monthLabel(state.meta.mes, state.meta.ano);
    const cleanup = () => { root.innerHTML = ''; document.title = prevTitle; window.removeEventListener('afterprint', cleanup); };
    window.addEventListener('afterprint', cleanup);
    // espera as imagens carregarem antes de abrir a impressão
    const imgs = [...root.querySelectorAll('img')];
    Promise.all(imgs.map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; })))).then(() => setTimeout(() => window.print(), 60));
  };
})(window.BT);
