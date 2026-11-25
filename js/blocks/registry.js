/* ═══ Registro de tipos de bloco ═══
 *
 * Para criar um novo tipo de bloco, crie js/blocks/<tipo>.js e chame:
 *
 *   BT.blocks.register('meu-tipo', {
 *     label: 'Nome na paleta', icon: '🧩', desc: 'descrição curta', order: 50,
 *     create()            → dados iniciais (objeto)
 *     editor(block, ctx)  → HTMLElement com a UI de edição (ctx.save() persiste)
 *     render(block, ctx)  → string HTML para o book (preview/PDF/HTML)
 *     word(block, ctx)    → (opcional) string HTML compatível com Word
 *     isEmpty(block)      → true se não deve aparecer no book
 *     content: false      → (opcional) bloco "decorativo" (não conta como conteúdo)
 *   });
 *
 * e inclua o <script> no index.html. A paleta e o book passam a usá-lo sozinhos.
 */
(function (BT) {
  const defs = {};

  const R = {
    register(type, def) { defs[type] = Object.assign({ type, order: 100, content: true, isEmpty: () => false }, def); },
    get(type) { return defs[type]; },
    list() { return Object.values(defs).sort((a, b) => a.order - b.order); },

    isEmpty(block) { const d = defs[block.type]; return !d || d.isEmpty(block); },
    isContent(block) { const d = defs[block.type]; return !!d && d.content !== false; },

    /** Bloco aparece no book? (incluído + não vazio) */
    visible(block) { return block.include !== false && !R.isEmpty(block); },

    renderBook(block, ctx) {
      const d = defs[block.type]; if (!d) return '';
      if (ctx.target === 'word' && d.word) return d.word(block, ctx);
      return d.render(block, ctx);
    },

    /** Título opcional exibido acima de blocos (planilha, imagem, texto...). */
    titleInput(block, ctx, placeholder = 'Título do bloco (opcional — aparece no book)') {
      return BT.h('input', {
        class: 'blk-title-in', value: block.data.title || '', placeholder,
        oninput: (e) => { block.data.title = e.target.value; ctx.save(); }
      });
    },
    /** Word não quebra "palavras" longas (OCID, ARN…): põe pontos de quebra invisíveis a cada 16 caracteres.
     *  Recebe texto puro e devolve HTML escapado. No HTML/PDF quem quebra é o CSS (overflow-wrap). */
    wordText(v) {
      return BT.esc(v).replace(/[^\s<>&;]{25,}/g, (w) => w.replace(/(.{16})/g, '$1&#8203;'));
    },
    /** HTML/PDF: marca só os textos longos sem espaço (OCID, ARN…) para quebrarem dentro da célula (CSS .blong). */
    cellText(v) {
      return BT.esc(v).replace(/[^\s<>]{25,}/g, (w) => `<span class="blong">${w}</span>`);
    },
    /** Índices das colunas com algum dado ('', '—' e '-' contam como vazio). Coluna toda vazia não vai para o book. */
    filledColumns(rows, n) {
      const empty = (v) => /^\s*(—|–|-)?\s*$/.test(String(v ?? ''));
      const keep = [];
      for (let i = 0; i < n; i++) if (rows.some((r) => !empty(r[i]))) keep.push(i);
      return keep.length ? keep : [...Array(n).keys()];
    },
    ZEBRA: '#ecebf7',
    titleHtml(block, ctx, cls = 'bh2') {
      const t = (block.data.title || '').trim();
      if (!t) return '';
      if (ctx && ctx.target === 'word') return `<p style="font-family:Consolas,monospace;font-size:9pt;font-weight:bold;color:#5E3FE1;text-transform:uppercase;letter-spacing:1px;margin:14pt 0 5pt">${BT.esc(t)}</p>`;
      return `<div class="${cls}">${BT.esc(t)}</div>`;
    },

    /** Editor de texto rico reutilizável (texto, destaque). */
    richText(html, onChange, placeholder = 'Escreva aqui…') {
      const h = BT.h;
      const area = h('div', { class: 'rt', contenteditable: 'true', 'data-placeholder': placeholder, html: BT.core.sanitizeHtml(html) });
      const exec = (cmd, val) => { area.focus(); document.execCommand(cmd, false, val); emit(); };
      const emit = BT.core.utils.debounce(() => onChange(BT.core.sanitizeHtml(area.innerHTML)), 250);
      const btn = (label, title, fn) => h('button', { type: 'button', title, onmousedown: (e) => { e.preventDefault(); fn(); } }, label);
      const bar = h('div', { class: 'rt-bar' }, [
        btn(h('b', {}, 'B'), 'Negrito (Ctrl+B)', () => exec('bold')),
        btn(h('i', {}, 'I'), 'Itálico (Ctrl+I)', () => exec('italic')),
        btn(h('u', {}, 'U'), 'Sublinhado (Ctrl+U)', () => exec('underline')),
        btn(h('s', {}, 'S'), 'Tachado', () => exec('strikeThrough')),
        h('span', { class: 'sep' }),
        btn('H', 'Subtítulo', () => exec('formatBlock', 'H3')),
        btn('¶', 'Parágrafo', () => exec('formatBlock', 'P')),
        btn('• Lista', 'Lista com marcadores', () => exec('insertUnorderedList')),
        btn('1. Lista', 'Lista numerada', () => exec('insertOrderedList')),
        h('span', { class: 'sep' }),
        btn('🔗', 'Link', () => { const u = prompt('URL do link (https://…)'); if (u) exec('createLink', u); }),
        btn('⌫', 'Limpar formatação', () => exec('removeFormat'))
      ]);
      area.addEventListener('input', emit);
      area.addEventListener('blur', () => onChange(BT.core.sanitizeHtml(area.innerHTML)));
      area.addEventListener('paste', (e) => {
        e.preventDefault();
        const cd = e.clipboardData;
        const htm = cd.getData('text/html');
        const txt = cd.getData('text/plain');
        document.execCommand('insertHTML', false, htm ? BT.core.sanitizeHtml(htm) : BT.core.textToHtml(txt));
        emit();
      });
      return h('div', {}, [bar, area]);
    },

    stripTags: (html) => String(html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()
  };

  BT.blocks = R;
})(window.BT);
