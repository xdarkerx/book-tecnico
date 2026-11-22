/* ═══ Sanitização de HTML (texto rico) ═══
   Mantém apenas tags de formatação seguras — o conteúdo vai para o book,
   para o Word e para o HTML exportado. */
(function (BT) {
  const ALLOWED = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'UL', 'OL', 'LI', 'A', 'H3', 'H4', 'BLOCKQUOTE', 'CODE', 'SPAN', 'SUB', 'SUP']);
  const RENAME = { DIV: 'P', H1: 'H3', H2: 'H3', H5: 'H4', H6: 'H4', FONT: 'SPAN' };

  function clean(node, doc) {
    const out = doc.createDocumentFragment();
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) { out.appendChild(doc.createTextNode(child.textContent)); return; }
      if (child.nodeType !== 1) return;
      let tag = child.tagName.toUpperCase();
      if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'META', 'LINK'].includes(tag)) return;
      tag = RENAME[tag] || tag;
      if (!ALLOWED.has(tag)) { out.appendChild(clean(child, doc)); return; }
      const el = doc.createElement(tag);
      if (tag === 'A') {
        const href = child.getAttribute('href') || '';
        if (/^(https?:|mailto:)/i.test(href)) { el.setAttribute('href', href); el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener'); }
      }
      el.appendChild(clean(child, doc));
      out.appendChild(el);
    });
    return out;
  }

  BT.core.sanitizeHtml = function (html) {
    const doc = document.implementation.createHTMLDocument('');
    const box = doc.createElement('div');
    box.innerHTML = String(html || '');
    const res = doc.createElement('div');
    res.appendChild(clean(box, doc));
    return res.innerHTML.replace(/<p><\/p>/g, '').trim();
  };

  /** Converte texto puro (com quebras de linha) em HTML de parágrafos. */
  BT.core.textToHtml = (t) => String(t || '').split(/\n{2,}/).map((p) => '<p>' + BT.esc(p).replace(/\n/g, '<br>') + '</p>').join('');
})(window.BT);
