/* ═══ Plano B: monta as partes de html/ no navegador ═══
 * Com "npm run dev" o servidor já entrega a página montada e este script não faz nada.
 * Em outro servidor estático (ex.: Live Server), ele busca cada <!-- @include … -->,
 * insere o HTML e carrega os <script> das partes na ordem.
 */
(function () {
  // espera o HTML todo ser lido: os marcadores depois deste <script> ainda não existem agora
  if (document.readyState === 'loading') return document.addEventListener('DOMContentLoaded', run);
  run();
  function run() {
  const comments = [];
  const walk = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_COMMENT);
  while (walk.nextNode()) { const m = walk.currentNode.nodeValue.match(/^\s*@include\s+([\w./-]+)\s*$/); if (m) comments.push([walk.currentNode, m[1]]); }
  if (!comments.length) return;
  if (location.protocol === 'file:') {
    document.body.innerHTML = '<div style="font:15px/1.6 sans-serif;padding:40px;color:#e8eaf5;background:#0e1020;min-height:100vh">' +
      '<h2>Abra pelo servidor ou pela versão montada</h2><p>Esta página é montada a partir das partes da pasta <code>html/</code>, e o navegador não consegue lê-las via <code>file://</code>.</p>' +
      '<p>• Rode <code>npm run dev</code> e acesse <a style="color:#86D2EF" href="http://localhost:5173">http://localhost:5173</a><br>• ou gere a versão de arquivo único com <code>npm run build</code> e abra <code>book-tecnico.html</code></p></div>';
    return;
  }
  async function load(node, url, depth) {
    const html = await (await fetch(url, { cache: 'no-cache' })).text();
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    // partes aninhadas
    const inner = [];
    const w = document.createTreeWalker(tpl.content, NodeFilter.SHOW_COMMENT);
    while (w.nextNode()) { const m = w.currentNode.nodeValue.match(/^\s*@include\s+([\w./-]+)\s*$/); if (m) inner.push([w.currentNode, m[1]]); }
    if (depth < 5) for (const [c, u] of inner) await load(c, u, depth + 1);
    const scripts = [...tpl.content.querySelectorAll('script')];
    scripts.forEach((s) => s.remove());
    node.replaceWith(tpl.content);
    for (const s of scripts) {
      await new Promise((ok) => {
        const el = document.createElement('script');
        if (s.src) { el.src = s.getAttribute('src'); el.onload = el.onerror = ok; } else { el.textContent = s.textContent; ok(); }
        document.body.appendChild(el);
      });
    }
  }
  (async () => { for (const [c, u] of comments) await load(c, u, 0); })();
  }
})();
