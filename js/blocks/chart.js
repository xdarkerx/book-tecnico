/* ═══ Bloco: Gráfico (colunas, barras, linha, pizza, rosca) ═══
 * data = {
 *   title, kind: 'column'|'bar'|'line'|'pie'|'donut', source: 'manual'|'table',
 *   labels:[...], series:[{name, values:[...]}],                       ← dados manuais
 *   table:{ blockId, labelCol, valueCol(-1 = contar linhas), top },     ← ligado a uma planilha
 *   showValues, legend, height, unit, origin?
 * }
 * Ligado a uma planilha, o gráfico se atualiza sozinho quando a planilha muda.
 */
(function (BT) {
  const h = BT.h;
  const C = () => BT.charts;

  /** Lista todas as planilhas do book (para o seletor de origem). */
  function tablesOf(state) {
    const out = [];
    (state.groups || []).forEach((g) => g.sections.forEach((s) => s.blocks.forEach((b) => {
      if (b.type === 'table') out.push({ block: b, label: `${g.title} › ${s.title}${b.data.title ? ' › ' + b.data.title : ''} (${(b.data.columns || []).slice(0, 3).map((c) => c.name).join(', ')}…)` });
    })));
    return out;
  }
  function findTable(state, id) {
    for (const g of state.groups || []) for (const s of g.sections) for (const b of s.blocks) if (b.id === id) return b;
    return null;
  }

  /** Resolve {labels, series} a partir dos dados do bloco. */
  function resolve(d, state) {
    if (d.source !== 'table') return { labels: d.labels || [], series: d.series || [] };
    const t = d.table && findTable(state || BT.store.state, d.table.blockId);
    if (!t) return { labels: [], series: [] };
    const rows = (t.data.rows || []).filter((r) => r.some((v) => String(v || '').trim()));
    const li = Number(d.table.labelCol) || 0, vi = Number(d.table.valueCol ?? -1);
    const agg = {};
    rows.forEach((r) => {
      const k = String(r[li] ?? '').trim() || '—';
      agg[k] = (agg[k] || 0) + (vi < 0 ? 1 : C().num(r[vi]));
    });
    let entries = Object.entries(agg);
    if (d.kind !== 'line') entries.sort((a, b) => b[1] - a[1]);
    const top = Number(d.table.top) || 0;
    if (top && entries.length > top) {
      const rest = entries.slice(top).reduce((s, e) => s + e[1], 0);
      entries = entries.slice(0, top).concat([['Outros', rest]]);
    }
    const colName = vi < 0 ? 'Quantidade' : ((t.data.columns || [])[vi] || {}).name || 'Valor';
    return { labels: entries.map((e) => e[0]), series: [{ name: colName, values: entries.map((e) => Math.round(e[1] * 100) / 100) }] };
  }

  function chartSvg(d, state, width = 640) {
    const r = resolve(d, state);
    return C().svg({ kind: d.kind, labels: r.labels, series: r.series, width, height: Number(d.height) || 260, showValues: d.showValues !== false, legend: d.legend !== false, unit: d.unit || '' });
  }

  BT.blocks.register('chart', {
    label: 'Gráfico', icon: '📊', desc: 'Colunas, barras, linha, pizza ou rosca — manual ou de uma planilha', order: 45,
    create: () => ({ title: '', kind: 'column', source: 'manual', labels: ['Jan', 'Fev', 'Mar'], series: [{ name: 'Série 1', values: ['', '', ''] }], table: { blockId: '', labelCol: 0, valueCol: -1, top: 8 }, showValues: true, legend: true, height: 260, unit: '' }),
    isEmpty: (b) => { const r = resolve(b.data); return !r.labels.length || !r.series.some((s) => s.values.some((v) => C().num(v))); },
    resolve, chartSvg,

    editor(block, ctx) {
      const d = block.data;
      d.table = d.table || { blockId: '', labelCol: 0, valueCol: -1, top: 8 };
      const preview = h('div', { class: 'chart-preview' });
      const panel = h('div');
      const redraw = () => { preview.innerHTML = chartSvg(d, BT.store.state, 640); };
      const save = () => { ctx.save(); redraw(); };

      const kinds = h('div', { class: 'tone-row' });
      const drawKinds = () => { kinds.innerHTML = ''; C().KINDS.forEach(([k, l]) => kinds.appendChild(h('button', { class: d.kind === k ? 'on' : '', onclick: () => { d.kind = k; drawKinds(); save(); } }, l))); };
      drawKinds();

      const srcSel = h('select', { class: 'inp inp-sm', style: { width: 'auto' }, onchange: (e) => { d.source = e.target.value; drawPanel(); save(); } }, [
        h('option', { value: 'manual', selected: d.source !== 'table' }, 'Dados manuais'),
        h('option', { value: 'table', selected: d.source === 'table' }, 'De uma planilha do book')
      ]);

      function drawPanel() {
        panel.innerHTML = '';
        if (d.source === 'table') {
          const tables = tablesOf(BT.store.state);
          if (!tables.length) { panel.appendChild(h('div', { class: 'muted' }, 'Nenhuma planilha no book ainda.')); return; }
          if (!tables.some((t) => t.block.id === d.table.blockId)) d.table.blockId = tables[0].block.id;
          const t = findTable(BT.store.state, d.table.blockId);
          const cols = (t.data.columns || []).map((c, i) => [i, c.name]);
          panel.append(h('div', { class: 'fg fg2' }, [
            h('div', { class: 'fd span-all' }, [h('label', {}, 'Planilha'), h('select', { class: 'inp inp-sm', onchange: (e) => { d.table.blockId = e.target.value; d.table.labelCol = 0; d.table.valueCol = -1; drawPanel(); save(); } }, tables.map((x) => h('option', { value: x.block.id, selected: x.block.id === d.table.blockId }, x.label)))]),
            h('div', { class: 'fd' }, [h('label', {}, 'Agrupar por (rótulos)'), h('select', { class: 'inp inp-sm', onchange: (e) => { d.table.labelCol = Number(e.target.value); save(); } }, cols.map(([i, n]) => h('option', { value: i, selected: i === Number(d.table.labelCol) }, n)))]),
            h('div', { class: 'fd' }, [h('label', {}, 'Valor'), h('select', { class: 'inp inp-sm', onchange: (e) => { d.table.valueCol = Number(e.target.value); save(); } }, [h('option', { value: -1, selected: Number(d.table.valueCol) < 0 }, 'Contar linhas'), ...cols.map(([i, n]) => h('option', { value: i, selected: i === Number(d.table.valueCol) }, 'Somar: ' + n))])]),
            h('div', { class: 'fd' }, [h('label', {}, 'Mostrar no máximo (resto vira "Outros")'), h('input', { class: 'inp inp-sm', type: 'number', min: 0, value: d.table.top || 0, oninput: (e) => { d.table.top = Number(e.target.value) || 0; save(); } })])
          ]));
          return;
        }
        // dados manuais: grade rótulo × séries
        const grid = h('table', { class: 'etbl chart-grid' });
        const hr = h('tr', {}, [h('th', {}, h('div', { class: 'th-wrap' }, h('span', { class: 'th-in' }, 'Rótulo')))]);
        d.series.forEach((s, si) => hr.appendChild(h('th', {}, h('div', { class: 'th-wrap' }, [
          h('input', { class: 'th-in', value: s.name, oninput: (e) => { s.name = e.target.value; save(); } }),
          d.series.length > 1 ? h('button', { class: 'mini-btn', title: 'Remover série', onclick: () => { d.series.splice(si, 1); drawPanel(); save(); } }, '✕') : null
        ]))));
        hr.appendChild(h('th', { class: 'act' }, h('button', { class: 'mini-btn', title: 'Adicionar série', onclick: () => { d.series.push({ name: 'Série ' + (d.series.length + 1), values: d.labels.map(() => '') }); drawPanel(); save(); } }, '＋')));
        grid.appendChild(hr);
        d.labels.forEach((l, li) => {
          const tr = h('tr', {}, [h('td', {}, h('span', { class: 'cell', contenteditable: 'true', text: l, oninput: (e) => { d.labels[li] = e.target.innerText.trim(); save(); } }))]);
          d.series.forEach((s) => tr.appendChild(h('td', {}, h('span', { class: 'cell', contenteditable: 'true', text: s.values[li] ?? '', oninput: (e) => { s.values[li] = e.target.innerText.trim(); save(); } }))));
          tr.appendChild(h('td', { class: 'act' }, h('button', { class: 'row-del', onclick: () => { d.labels.splice(li, 1); d.series.forEach((s) => s.values.splice(li, 1)); drawPanel(); save(); } }, '✕')));
          grid.appendChild(tr);
        });
        panel.append(h('div', { class: 'tb-wrap', style: { maxHeight: '260px' } }, grid),
          h('div', { class: 'tb-foot' }, [
            h('button', { class: 'btn-dashed', onclick: () => { d.labels.push('Novo'); d.series.forEach((s) => s.values.push('')); drawPanel(); save(); } }, '＋ Adicionar rótulo'),
            h('button', { class: 'btn btn-ghost btn-xs', title: 'Colar dados do Excel (1ª coluna = rótulos, demais = séries; 1ª linha = nomes)', onclick: () => pasteInto(d, () => { drawPanel(); save(); }) }, '📋 Colar do Excel')
          ]));
      }

      const opts = h('div', { class: 'img-opts', style: { marginTop: '10px' } }, [
        h('label', { class: 'switch' }, [h('input', { type: 'checkbox', checked: d.showValues !== false, onchange: (e) => { d.showValues = e.target.checked; save(); } }), 'Mostrar valores']),
        h('label', { class: 'switch' }, [h('input', { type: 'checkbox', checked: d.legend !== false, onchange: (e) => { d.legend = e.target.checked; save(); } }), 'Legenda']),
        h('span', { class: 'lbl' }, 'Altura'), h('input', { class: 'inp inp-sm', type: 'number', min: 140, max: 520, step: 20, style: { width: '80px' }, value: d.height || 260, oninput: (e) => { d.height = Number(e.target.value) || 260; save(); } }),
        h('span', { class: 'lbl' }, 'Unidade'), h('input', { class: 'inp inp-sm', style: { width: '70px' }, placeholder: '%, GB…', value: d.unit || '', oninput: (e) => { d.unit = e.target.value; save(); } })
      ]);

      drawPanel(); redraw();
      // planilha de origem mudou → atualiza a prévia
      const off = BT.on('store:content', BT.core.utils.debounce(() => { if (!document.body.contains(preview)) return off(); if (d.source === 'table') redraw(); }, 300));
      return h('div', {}, [BT.blocks.titleInput(block, ctx), kinds, h('div', { class: 'img-opts' }, [h('span', { class: 'lbl' }, 'Origem dos dados'), srcSel]), panel, opts, preview]);
    },

    render: (b, ctx) => BT.blocks.titleHtml(b, ctx) + `<div class="bchart">${chartSvg(b.data, ctx.state, 640)}</div>`,
    word: (b, ctx) => BT.blocks.titleHtml(b, ctx) + `<p style="margin:4pt 0 8pt"><img src="${C().dataUri(chartSvg(b.data, ctx.state, 640))}" width="600"></p>`
  });

  function pasteInto(d, done) {
    const ta = h('textarea', { class: 'inp', style: { minHeight: '180px', fontFamily: 'var(--mono)', fontSize: '11px' }, placeholder: 'Rótulo\tSérie 1\tSérie 2\nJan\t10\t12\nFev\t14\t9' });
    const m = BT.ui.modal.open({
      title: '📋 Colar dados do gráfico', size: 'md', body: [ta],
      footer: [h('button', { class: 'btn btn-ghost btn-sm', onclick: () => m.close() }, 'Cancelar'), h('button', { class: 'btn btn-primary btn-sm', onclick: () => {
        const g = BT.core.utils.parseDelimited(ta.value); if (g.length < 2) return BT.ui.toast('Cole ao menos o cabeçalho e uma linha.');
        const head = g.shift();
        d.labels = g.map((r) => r[0]);
        d.series = head.slice(1).map((n, i) => ({ name: n || 'Série ' + (i + 1), values: g.map((r) => r[i + 1] ?? '') }));
        if (!d.series.length) d.series = [{ name: 'Valor', values: g.map(() => '') }];
        m.close(); done();
      } }, 'Aplicar')]
    });
  }

  /** Cria dados de um gráfico ligado a uma planilha (usado pelas importações). */
  BT.blocks.chartFromTable = (tableBlockId, labelCol, opts = {}) => ({
    id: BT.uid('blk'), type: 'chart', include: true,
    data: Object.assign({ title: '', kind: 'bar', source: 'table', labels: [], series: [], table: { blockId: tableBlockId, labelCol, valueCol: -1, top: 8 }, showValues: true, legend: true, height: 220, unit: '' }, opts, { table: Object.assign({ blockId: tableBlockId, labelCol, valueCol: -1, top: 8 }, opts.table || {}) })
  });
})(window.BT);
