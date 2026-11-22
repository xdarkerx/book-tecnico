/* ═══ Exportar HTML (arquivo único com o book) ═══ */
(function (BT) {
  /** Lê o CSS do book. Servido via http(s): lê das folhas carregadas.
      Aberto via file:// o navegador bloqueia cssRules → usa a cópia em js/book/book-styles.js. */
  function bookCss() {
    let css = '';
    for (const sheet of document.styleSheets) {
      if (!sheet.href || !/css\/(book|base\/variables)/.test(sheet.href)) continue;
      try { css += [...sheet.cssRules].map((r) => r.cssText).join('\n') + '\n'; } catch (e) { css = ''; break; }
    }
    return css || BT.book.STYLES || '';
  }

  BT.exporters.html = async function (state, selection) {
    const M = BT.book.meta(state, BT.book.collect(state, selection));
    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Book Técnico — ${BT.esc(M.nome)} — ${BT.esc(M.mesRef)}</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800&family=Trispace:wght@300;400;600;700&display=swap" rel="stylesheet">
<style>${bookCss()}
body{margin:0;background:#e9e8f3;padding:30px 12px}.book{max-width:860px;margin:0 auto}
@media print{body{background:#fff;padding:0}#print-root{display:block}}</style></head>
<body><div id="print-root" style="display:block">${BT.book.render(state, { selection })}</div></body></html>`;
    BT.core.utils.download(html, `book-tecnico-${BT.core.utils.slug(M.nome)}-${BT.core.utils.slug(M.mesRef)}.html`, 'text/html;charset=utf-8');
  };
})(window.BT);
