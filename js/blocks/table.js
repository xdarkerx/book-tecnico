/* ═══ Bloco: Planilha (tabela editável estilo Excel) ═══
 * data = { title, columns:[{name, badge}], rows:[[...]], compact, note }
 * - Cabeçalhos editáveis, menu por coluna (badge, ordenar, mover, inserir, remover)
 * - Células editáveis; Enter desce; colar bloco do Excel espalha nas células
 * - Linhas reordenáveis por arrastar (coluna #)
 */
(function (BT) {
  const h = BT.h;
  const U = BT.core.utils;
  const MAX_VIEW = 200;

  /** Ajusta colunas/linhas NO LUGAR (não troca os arrays — o editor mantém referências a eles). */
  function normalize(d) {
    if (!Array.isArray(d.columns)) d.columns = [];
    d.columns.forEach((c, i) => { if (typeof c === 'string') d.columns[i] = { name: c, badge: false }; });
    if (!d.columns.length) d.columns.push({ name: 'Coluna 1', badge: false });
    if (!Array.isArray(d.rows)) d.rows = [];
    const n = d.columns.length;
    d.rows.forEach((r, ri) => {
      if (!Array.isArray(r)) { d.rows[ri] = r = []; }
      if (r.length > n) r.length = n;
      while (r.length < n) r.push('');
      for (let i = 0; i < n; i++) if (r[i] === null || r[i] === undefined) r[i] = ''; else if (typeof r[i] !== 'string') r[i] = String(r[i]);
    });
    return d;
  }
  const rowHasData = (r) => r.some((c) => String(c ?? '').trim() !== '');

  BT.blocks.register('table', {
    label: 'Planilha', icon: '▦', desc: 'Tabela editável — cole do Excel ou importe CSV/XLSX', order: 30,
    create: () => ({ title: '', columns: [{ name: 'Coluna 1', badge: false }, { name: 'Coluna 2', badge: false }, { name: 'Coluna 3', badge: false }], rows: [['', '', '']], compact: false, note: '' }),
    isEmpty: (b) => !normalize(b.data).rows.some(rowHasData),
    normalize,

    editor(block, ctx) {
      const d = normalize(block.data);
      let filter = '';
      let showAll = false;
      const wrap = h('div', { class: 'tb-wrap' });
      const info = h('span', { class: 'tb-info' });

      const save = () => { ctx.save(); updateInfo(); };
      const updateInfo = () => { info.textContent = `${d.rows.length} linha(s) · ${d.columns.length} coluna(s)`; };

      // ── Ações por coluna ─────────────────────────────
      function colMenu(ci, ev) {
        const col = d.columns[ci];
        const sortBy = (dir) => {
          d.rows.sort((a, b) => dir * String(a[ci]).localeCompare(String(b[ci]), 'pt-BR', { numeric: true, sensitivity: 'base' }));
          save(); draw();
        };
        BT.ui.contextMenu(ev.clientX, ev.clientY, [
          { label: (col.badge ? '✓ ' : '') + '◉ Exibir valores como badge (status)', onClick: () => { col.badge = !col.badge; save(); draw(); } },
          'hr',
          { label: '↑ Ordenar A → Z', onClick: () => sortBy(1) },
          { label: '↓ Ordenar Z → A', onClick: () => sortBy(-1) },
          'hr',
          { label: '← Mover para a esquerda', onClick: () => moveCol(ci, ci - 1) },
          { label: '→ Mover para a direita', onClick: () => moveCol(ci, ci + 1) },
          { label: '＋ Inserir coluna à esquerda', onClick: () => insertCol(ci) },
          { label: '＋ Inserir coluna à direita', onClick: () => insertCol(ci + 1) },
          'hr',
          { label: '🗑 Remover coluna', onClick: () => removeCol(ci) }
        ]);
      }
      function moveCol(from, to) {
        if (to < 0 || to >= d.columns.length) return;
        const [c] = d.columns.splice(from, 1); d.columns.splice(to, 0, c);
        d.rows.forEach((r) => { const [v] = r.splice(from, 1); r.splice(to, 0, v); });
        save(); draw();
      }
      function insertCol(at, name) {
        d.columns.splice(at, 0, { name: name || 'Nova coluna', badge: false });
        d.rows.forEach((r) => r.splice(at, 0, ''));
        save(); draw();
        setTimeout(() => { const ins = wrap.querySelectorAll('.th-in'); ins[at] && ins[at].select(); }, 0);
      }
      function removeCol(ci) {
        if (d.columns.length <= 1) return BT.ui.toast('A planilha precisa de ao menos uma coluna.');
        const snap = U.clone(d);
        d.columns.splice(ci, 1); d.rows.forEach((r) => r.splice(ci, 1));
        save(); draw();
        BT.ui.toast('Coluna removida', { action: () => { Object.assign(d, snap); save(); draw(); } });
      }
      function addRow(at) {
        const row = d.columns.map(() => '');
        if (at === undefined) d.rows.push(row); else d.rows.splice(at, 0, row);
        save(); draw();
        return at === undefined ? d.rows.length - 1 : at;
      }
      function focusCell(ri, ci) {
        const el = wrap.querySelector(`.cell[data-r="${ri}"][data-c="${ci}"]`);
        if (el) { el.focus(); const s = window.getSelection(); s.selectAllChildren(el); s.collapseToEnd(); }
      }

      /** Colar bloco (TSV) a partir de uma célula: espalha em linhas/colunas. */
      function pasteGrid(ri, ci, grid) {
        grid.forEach((line, dr) => {
          const r = ri + dr;
          while (d.rows.length <= r) d.rows.push(d.columns.map(() => ''));
          line.forEach((val, dc) => {
            const c = ci + dc;
            while (d.columns.length <= c) { d.columns.push({ name: 'Coluna ' + (d.columns.length + 1), badge: false }); d.rows.forEach((rr) => rr.push('')); }
            d.rows[r][c] = String(val).trim();
          });
        });
        save(); draw();
      }

      // ── Desenho da tabela ────────────────────────────
      function draw() {
        wrap.innerHTML = '';
        const tbl = h('table', { class: 'etbl' });
        const htr = h('tr', {}, [h('th', { class: 'rowh', title: 'Arraste o nº para reordenar linhas' }, '#')]);
        d.columns.forEach((col, ci) => {
          htr.appendChild(h('th', {}, h('div', { class: 'th-wrap' }, [
            h('input', { class: 'th-in', value: col.name, title: 'Nome da coluna (editável)', oninput: (e) => { col.name = e.target.value; save(); } }),
            h('button', { class: 'mini-btn th-badge' + (col.badge ? ' on' : ''), title: col.badge ? 'Coluna exibida como badge' : 'Exibir como badge', onclick: () => { col.badge = !col.badge; save(); draw(); } }, '◉'),
            h('button', { class: 'mini-btn', title: 'Opções da coluna', onclick: (e) => colMenu(ci, e) }, '▾')
          ])));
        });
        htr.appendChild(h('th', { class: 'act' }, h('button', { class: 'mini-btn', title: 'Adicionar coluna', onclick: () => insertCol(d.columns.length) }, '＋')));
        tbl.appendChild(h('thead', {}, htr));

        const tbody = h('tbody');
        const q = filter.toLowerCase();
        let shown = 0, hidden = 0;
        d.rows.forEach((row, ri) => {
          if (q && !row.join(' ').toLowerCase().includes(q)) return;
          if (!showAll && !q && shown >= MAX_VIEW) { hidden++; return; }
          shown++;
          const tr = h('tr', { 'data-r': ri });
          const handle = h('td', { class: 'rowh', draggable: 'true', title: 'Arraste para mover' }, String(ri + 1));
          handle.addEventListener('dragstart', (e) => { BT.ui.dnd.start(e, { kind: 'row', block: block.id, index: ri }, tr); tr.classList.add('dragging'); });
          tr.addEventListener('dragover', (e) => {
            const p = BT.ui.dnd.payload; if (!p || p.kind !== 'row' || p.block !== block.id) return;
            e.preventDefault(); tr.classList.add('row-sel');
          });
          tr.addEventListener('dragleave', () => tr.classList.remove('row-sel'));
          tr.addEventListener('drop', (e) => {
            const p = BT.ui.dnd.payload; if (!p || p.kind !== 'row' || p.block !== block.id) return;
            e.preventDefault(); e.stopPropagation();
            const [moved] = d.rows.splice(p.index, 1); d.rows.splice(ri, 0, moved);
            save(); draw();
          });
          tr.appendChild(handle);
          d.columns.forEach((_, ci) => {
            const cell = h('span', { class: 'cell', contenteditable: 'true', spellcheck: 'false', 'data-r': ri, 'data-c': ci, text: row[ci] });
            cell.addEventListener('input', () => { row[ci] = cell.innerText.replace(/\n$/, ''); ctx.save(); });
            cell.addEventListener('keydown', (e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const next = ri + 1 < d.rows.length ? ri + 1 : addRow();
                focusCell(next, ci);
              }
            });
            cell.addEventListener('paste', (e) => {
              e.preventDefault();
              const txt = e.clipboardData.getData('text/plain');
              if (/[\t\n]/.test(txt.replace(/\n$/, ''))) pasteGrid(ri, ci, U.parseDelimited(txt));
              else document.execCommand('insertText', false, txt);
            });
            tr.appendChild(h('td', {}, cell));
          });
          tr.appendChild(h('td', { class: 'act' }, h('button', {
            class: 'row-del', title: 'Remover linha', onclick: () => {
              const [removed] = d.rows.splice(ri, 1); save(); draw();
              BT.ui.toast('Linha removida', { action: () => { d.rows.splice(ri, 0, removed); save(); draw(); } });
            }
          }, '✕')));
          tbody.appendChild(tr);
        });
        tbl.appendChild(tbody);
        wrap.appendChild(tbl);
        if (hidden) wrap.appendChild(h('div', { style: { padding: '8px' } }, h('button', { class: 'btn btn-ghost btn-xs', onclick: () => { showAll = true; draw(); } }, `Mostrar mais ${hidden} linha(s)`)));
        updateInfo();
      }

      // ── Barra de ações ────────────────────────────────
      const search = h('input', { class: 'inp inp-sm tb-search', placeholder: '🔍 Filtrar linhas', oninput: U.debounce((e) => { filter = e.target.value; draw(); }, 200) });
      const compact = h('input', { type: 'checkbox', checked: !!d.compact, onchange: (e) => { d.compact = e.target.checked; save(); } });
      const more = (e) => BT.ui.contextMenu(e.clientX, e.clientY, [
        { label: '🧹 Remover linhas vazias', onClick: () => { d.rows = d.rows.filter(rowHasData); save(); draw(); } },
        { label: '🧬 Remover linhas duplicadas', onClick: () => { const seen = new Set(); d.rows = d.rows.filter((r) => { const k = r.join('\u0001'); if (seen.has(k)) return false; seen.add(k); return true; }); save(); draw(); } },
        { label: '⬇ Baixar como CSV', onClick: () => downloadCsv(d, block.data.title) },
        { label: '📊 Criar gráfico desta planilha', onClick: () => {
          const f = BT.store.findBlock(block.id); if (!f) return;
          const c = BT.blocks.chartFromTable(block.id, 0, { title: d.title ? 'Distribuição — ' + d.title : '' });
          BT.store.addBlock(f.section.id, 'chart', f.index + 1, c.data);
        } },
        'hr',
        { label: '🗑 Limpar todas as linhas', onClick: async () => { if (await BT.ui.modal.confirm('Remover todas as linhas desta planilha?', { danger: true, okText: 'Limpar' })) { d.rows = [d.columns.map(() => '')]; save(); draw(); } } }
      ]);

      const actions = h('div', { class: 'tb-actions-row' }, [
        h('button', { class: 'btn btn-ghost btn-xs', onclick: () => { const r = addRow(); setTimeout(() => focusCell(r, 0), 0); } }, '＋ Linha'),
        h('button', { class: 'btn btn-ghost btn-xs', onclick: () => insertCol(d.columns.length) }, '＋ Coluna'),
        h('button', { class: 'btn btn-ghost btn-xs', title: 'Colar dados copiados do Excel / Google Sheets', onclick: () => pasteDialog(d, () => { save(); draw(); }) }, '📋 Colar do Excel'),
        h('button', { class: 'btn btn-ghost btn-xs', title: 'Importar CSV/XLSX (com seleção de linhas e colunas)', onclick: () => BT.importer.wizard.open({ targetBlockId: block.id }) }, '⬆ Importar arquivo'),
        search,
        h('label', { class: 'switch' }, [compact, 'Compacta']),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn btn-ghost btn-xs', title: 'Mais opções', onclick: more }, '⋯')
      ]);

      const note = h('input', { class: 'inp inp-sm', value: d.note || '', placeholder: 'Nota de rodapé da tabela (opcional) — ex.: Fonte: export OCI de 01/11', oninput: (e) => { d.note = e.target.value; ctx.save(); } });

      draw();
      return h('div', {}, [
        BT.blocks.titleInput(block, ctx),
        actions, wrap,
        h('div', { class: 'tb-foot' }, [
          h('button', { class: 'btn-dashed', onclick: () => { const r = addRow(); setTimeout(() => focusCell(r, 0), 0); } }, '＋ Adicionar linha'),
        ]),
        h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', marginTop: '8px' } }, [note, info])
      ]);
    },

    render(b, ctx) {
      const d = normalize(b.data);
      const rows = d.rows.filter(rowHasData);
      const cell = (v, col) => (col.badge ? BT.data.badge(v) : (BT.esc(v) || '—'));
      return BT.blocks.titleHtml(b, ctx, 'btbl-title') +
        `<table class="btbl${d.compact ? ' compact' : ''}"><thead><tr>${d.columns.map((c) => `<th>${BT.esc(c.name)}</th>`).join('')}</tr></thead>` +
        `<tbody>${rows.map((r) => `<tr>${r.map((v, i) => `<td>${cell(v, d.columns[i])}</td>`).join('')}</tr>`).join('')}</tbody></table>` +
        (d.note ? `<div class="btbl-note">${BT.esc(d.note)}</div>` : '');
    },

    word(b, ctx) {
      const d = normalize(b.data);
      const rows = d.rows.filter(rowHasData);
      const fs = d.columns.length > 7 || d.compact ? '7.5pt' : '9pt';
      const th = d.columns.map((c) => `<th style="background:#171C37;color:#ffffff;border-bottom:2pt solid #5E3FE1;padding:5pt 6pt;text-align:left;font-family:Consolas,monospace;font-size:7pt;text-transform:uppercase;letter-spacing:.5px">${BT.esc(c.name)}</th>`).join('');
      const body = rows.map((r, ri) => `<tr>${r.map((v, i) => {
        const bg = ri % 2 ? '#fafafe' : '#ffffff';
        let content = BT.esc(v) || '—';
        if (d.columns[i].badge && String(v).trim()) {
          const [cbg, cfg] = BT.data.badgeColors[BT.data.badgeClass(v)];
          content = `<span style="background:${cbg};color:${cfg};font-weight:bold;font-family:Consolas,monospace;font-size:7pt;text-transform:uppercase">&nbsp;${BT.esc(v)}&nbsp;</span>`;
        }
        return `<td style="background:${bg};border-bottom:1px solid #eceef6;padding:4pt 6pt;font-family:Arial;font-size:${fs};color:#3d4466;vertical-align:top">${content}</td>`;
      }).join('')}</tr>`).join('');
      return BT.blocks.titleHtml(b, ctx) +
        `<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;margin:4pt 0 2pt"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>` +
        (d.note ? `<p style="font-family:Consolas,monospace;font-size:7.5pt;color:#8890b0;margin:3pt 0 8pt">${BT.esc(d.note)}</p>` : '<p style="margin:0 0 8pt;font-size:4pt">&nbsp;</p>');
    }
  });

  function downloadCsv(d, title) {
    const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const csv = [d.columns.map((c) => q(c.name)).join(';'), ...d.rows.map((r) => r.map(q).join(';'))].join('\r\n');
    U.download('﻿' + csv, U.slug(title || 'planilha') + '.csv', 'text/csv;charset=utf-8');
  }

  /** Diálogo "Colar do Excel": cola TSV/CSV, escolhe se substitui ou acrescenta. */
  function pasteDialog(d, done) {
    const ta = h('textarea', { class: 'inp', style: { minHeight: '200px', fontFamily: 'var(--mono)', fontSize: '11px' }, placeholder: 'Copie as células no Excel / Google Sheets e cole aqui (Ctrl+V)…' });
    const hdr = h('input', { type: 'checkbox', checked: true });
    const mode = h('select', { class: 'inp inp-sm', style: { width: 'auto' } }, [h('option', { value: 'replace' }, 'Substituir conteúdo'), h('option', { value: 'append' }, 'Acrescentar linhas')]);
    const apply = () => {
      const grid = U.parseDelimited(ta.value);
      if (!grid.length) return BT.ui.toast('Nada para colar.');
      let header = hdr.checked ? grid.shift() : null;
      if (mode.value === 'replace') {
        const n = Math.max(header ? header.length : 0, ...grid.map((r) => r.length));
        d.columns = Array.from({ length: n }, (_, i) => ({ name: (header && header[i]) || d.columns[i]?.name || 'Coluna ' + (i + 1), badge: d.columns[i]?.badge || false }));
        d.rows = grid;
      } else {
        d.rows.push(...grid);
      }
      normalize(d); m.close(); done();
      BT.ui.toast(`${grid.length} linha(s) coladas`, { type: 'ok' });
    };
    const m = BT.ui.modal.open({
      title: '📋 Colar do Excel / Google Sheets', size: 'md',
      body: [ta, h('div', { style: { display: 'flex', gap: '14px', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap' } }, [h('label', { class: 'chk' }, [hdr, 'Primeira linha é o cabeçalho']), mode])],
      footer: [h('button', { class: 'btn btn-ghost btn-sm', onclick: () => m.close() }, 'Cancelar'), h('button', { class: 'btn btn-primary btn-sm', onclick: apply }, 'Aplicar')]
    });
  }
})(window.BT);
