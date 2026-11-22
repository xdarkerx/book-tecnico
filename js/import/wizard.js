/* ═══ Wizard de importação de cloud ═══
 * 1. Arquivo  → lê CSV/XLSX/JSON, detecta provedor e tipo de export
 * 2. Seleção  → escolhe tipo de mapeamento, colunas (renomear/reordenar) e LINHAS a importar
 * 3. Destino  → seção (ou nova seção), nova planilha / substituir / acrescentar, KPIs, separar por coluna
 */
(function (BT) {
  const h = BT.h;
  const U = BT.core.utils;
  const M = () => BT.importer.mappers;
  const mapperList = () => Object.values(M()).filter((m) => m && m.key).sort((a, b) => a.order - b.order);

  function open(opts = {}) {
    const W = {
      step: 1, file: null, sheetIdx: 0, provider: 'generic', mode: 'servers',
      columns: [], items: [], selected: new Set(), search: '',
      targetBlockId: opts.targetBlockId || null,
      dest: { sectionId: null, newGroupId: '', newTitle: '', how: 'new', addKpi: true, addCharts: true, splitBy: '', title: '', note: true }
    };
    const modal = BT.ui.modal.open({ title: '☁️ Importar dados de cloud', size: 'lg', body: h('div'), footer: [] });
    const body = modal.body;
    const footer = modal.el.querySelector('.modal-ft') || modal.el.appendChild(h('div', { class: 'modal-ft' }));

    const sheet = () => W.file.sheets[W.sheetIdx];
    const mapper = () => M()[W.mode];

    function steps() {
      const s = (n, label) => h('div', { class: 'wz-step' + (W.step === n ? ' on' : W.step > n ? ' done' : '') }, [h('b', {}, W.step > n ? '✓' : String(n)), label]);
      return h('div', { class: 'wz-steps' }, [s(1, 'Arquivo'), s(2, 'Selecionar itens'), s(3, 'Destino no book')]);
    }

    function render() {
      body.innerHTML = ''; footer.innerHTML = '';
      body.appendChild(steps());
      if (W.step === 1) step1(); else if (W.step === 2) step2(); else step3();
    }

    // ── Passo 1: arquivo ─────────────────────────────────
    function step1() {
      const input = h('input', { type: 'file', accept: '.csv,.xlsx,.xls,.xlsm,.tsv,.txt,.json,.zip', hidden: true, onchange: (e) => e.target.files[0] && load(e.target.files[0]) });
      const zone = h('div', { class: 'wz-drop', onclick: () => input.click() }, [
        h('div', { class: 'di' }, '📂'),
        h('div', { html: '<b>Clique</b> ou arraste o export da cloud aqui' }),
        h('div', { class: 'wz-hint', html: 'CSV · XLSX · JSON — até 50 MB · ou um <b>.zip</b> com vários arquivos<br>OCI (inventário/resource search) · AWS (EC2, S3, VPC) · Azure (All resources, VMs) · GCP (Compute) · VMware (RVTools)' }),
        input
      ]);
      zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('ov'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('ov'));
      zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('ov'); e.dataTransfer.files[0] && load(e.dataTransfer.files[0]); });
      body.appendChild(zone);
      footer.append(h('button', { class: 'btn btn-ghost btn-sm', onclick: modal.close }, 'Cancelar'));
    }

    async function load(file) {
      if (/\.zip$/i.test(file.name) && !W.targetBlockId) { modal.close(); BT.importer.zip.open(file); return; }
      body.querySelector('.wz-drop').innerHTML = '<div class="di">⏳</div><div>Lendo arquivo…</div>';
      try {
        W.file = await BT.importer.readFile(file);
        if (!W.file.sheets.length) throw new Error('Nenhum dado encontrado no arquivo.');
        const names = W.file.sheets.map((s) => s.name);
        W.provider = BT.importer.detect.provider(W.file.sheets[0].fields, file.name, names);
        W.mode = W.targetBlockId ? 'raw' : BT.importer.detect.kind(W.file.sheets[0].fields, names);
        pickSheetFor(W.mode);
        remap();
        W.step = 2; render();
      } catch (err) {
        console.error(err);
        BT.ui.toast(err.message || 'Falha ao ler o arquivo.', { type: 'err', ms: 7000 });
        render();
      }
    }

    function pickSheetFor(mode) {
      const m = M()[mode];
      const idx = m && m.pickSheet ? m.pickSheet(W.file.sheets) : -1;
      if (idx >= 0) W.sheetIdx = idx;
      else if (W.sheetIdx >= W.file.sheets.length) W.sheetIdx = 0;
    }

    function remap() {
      const m = mapper();
      W.items = m.map(sheet(), W.provider, W.file);
      W.columns = (m.dynamicColumns ? m.dynamicColumns(sheet()) : m.columns).map((c) => Object.assign({ badge: false }, c));
      W.selected = new Set(W.items.map((it, i) => (m.defaultSelected ? (m.defaultSelected(it) ? i : -1) : i)).filter((i) => i >= 0));
      W.search = '';
    }

    // ── Passo 2: seleção de linhas e colunas ──────────────
    function step2() {
      const m = mapper();
      const side = h('div', { class: 'wz-side' });
      const main = h('div', { class: 'wz-main' });

      // provedor
      side.appendChild(h('div', { class: 'wz-box' }, [
        h('h4', {}, 'Provedor detectado'),
        h('select', { class: 'inp inp-sm', onchange: (e) => { W.provider = e.target.value; remap(); render(); } },
          BT.data.providerList.map((k) => h('option', { value: k, selected: k === W.provider }, BT.data.providers[k].display)))
      ]));
      // aba
      if (W.file.sheets.length > 1) side.appendChild(h('div', { class: 'wz-box' }, [
        h('h4', {}, 'Aba da planilha'),
        h('select', { class: 'inp inp-sm', onchange: (e) => { W.sheetIdx = Number(e.target.value); remap(); render(); } },
          W.file.sheets.map((s, i) => h('option', { value: i, selected: i === W.sheetIdx }, `${s.name} (${s.rows.length})`)))
      ]));
      // colunas
      const colsBox = h('div', { class: 'wz-cols' });
      W.columns.forEach((c, ci) => {
        const row = h('div', { class: 'wz-col', draggable: 'true' }, [
          h('span', { class: 'grip', title: 'Arraste para reordenar' }, '⠿'),
          h('input', { type: 'checkbox', checked: c.on, onchange: (e) => { c.on = e.target.checked; drawTable(); } }),
          h('input', { type: 'text', value: c.name, title: 'Renomear coluna', oninput: (e) => { c.name = e.target.value; drawTable(); } }),
          h('button', { class: 'mini-btn th-badge' + (c.badge ? ' on' : ''), title: 'Exibir como badge', onclick: (e) => { c.badge = !c.badge; e.currentTarget.classList.toggle('on', c.badge); } }, '◉')
        ]);
        row.addEventListener('dragstart', (e) => { BT.ui.dnd.start(e, { kind: 'wzcol', index: ci }); row.classList.add('dragging'); });
        row.addEventListener('dragover', (e) => { if (BT.ui.dnd.payload?.kind === 'wzcol') e.preventDefault(); });
        row.addEventListener('drop', (e) => {
          const p = BT.ui.dnd.payload; if (p?.kind !== 'wzcol') return; e.preventDefault();
          const [x] = W.columns.splice(p.index, 1); W.columns.splice(ci, 0, x); render();
        });
        colsBox.appendChild(row);
      });
      side.appendChild(h('div', { class: 'wz-box' }, [
        h('h4', {}, ['Colunas', h('span', { class: 'grow' }),
          h('button', { class: 'btn btn-ghost btn-xs', onclick: () => { const all = W.columns.every((c) => c.on); W.columns.forEach((c) => (c.on = !all)); render(); } }, 'todas')]),
        colsBox
      ]));

      // tipos de mapeamento
      main.appendChild(h('div', { class: 'wz-modes' }, mapperList().map((mm) => h('button', {
        class: 'wz-mode' + (mm.key === W.mode ? ' on' : ''),
        onclick: () => { W.mode = mm.key; pickSheetFor(mm.key); remap(); render(); }
      }, [h('b', {}, mm.icon + ' ' + mm.label), h('small', {}, mm.desc)]))));

      const stats = h('div', { class: 'wz-stats' }, [
        stat(sheet().rows.length, 'Linhas no arquivo'), stat(W.items.length, 'Itens mapeados'), stat(sheet().fields.length, 'Colunas origem'),
        stat(BT.data.providers[W.provider].label, 'Fonte')
      ]);
      const count = h('span', { class: 'wz-count' });
      const search = h('input', { class: 'inp inp-sm', style: { maxWidth: '240px' }, placeholder: '🔍 Filtrar itens…', value: W.search, oninput: U.debounce((e) => { W.search = e.target.value; drawTable(); }, 180) });
      const visibleIdx = () => {
        const q = W.search.toLowerCase(); const cols = W.columns.filter((c) => c.on);
        return W.items.map((it, i) => i).filter((i) => !q || cols.some((c) => String(W.items[i][c.key] ?? '').toLowerCase().includes(q)));
      };
      const toolbar = h('div', { class: 'wz-toolbar' }, [
        search,
        h('button', { class: 'btn btn-sec btn-xs', title: 'Selecionar todos os itens do arquivo', onclick: () => { W.items.forEach((_, i) => W.selected.add(i)); drawTable(); } }, '☑ Selecionar tudo'),
        h('button', { class: 'btn btn-sec btn-xs', title: 'Desmarcar todos os itens', onclick: () => { W.selected.clear(); drawTable(); } }, '☐ Nenhum'),
        h('button', { class: 'btn btn-ghost btn-xs', onclick: () => { visibleIdx().forEach((i) => W.selected.add(i)); drawTable(); } }, '☑ Marcar visíveis'),
        h('button', { class: 'btn btn-ghost btn-xs', onclick: () => { visibleIdx().forEach((i) => W.selected.delete(i)); drawTable(); } }, '☐ Desmarcar visíveis'),
        h('button', { class: 'btn btn-ghost btn-xs', onclick: () => { W.items.forEach((_, i) => (W.selected.has(i) ? W.selected.delete(i) : W.selected.add(i))); drawTable(); } }, '⇄ Inverter'),
        count
      ]);
      const tableWrap = h('div', { class: 'wz-table-wrap' });
      main.append(stats, toolbar, tableWrap);

      function drawTable() {
        const cols = W.columns.filter((c) => c.on);
        const idx = visibleIdx();
        const LIMIT = 500;
        const allOn = idx.length && idx.every((i) => W.selected.has(i));
        const t = h('table', { class: 'wz-table' });
        t.appendChild(h('tr', {}, [h('th', {}, h('input', { type: 'checkbox', checked: allOn, title: 'Marcar/desmarcar visíveis', onchange: (e) => { idx.forEach((i) => (e.target.checked ? W.selected.add(i) : W.selected.delete(i))); drawTable(); } })),
          ...cols.map((c) => h('th', {}, c.name))]));
        idx.slice(0, LIMIT).forEach((i) => {
          const it = W.items[i];
          const on = W.selected.has(i);
          const tr = h('tr', { class: on ? '' : 'off' }, [h('td', {}, h('input', { type: 'checkbox', checked: on, onchange: (e) => { e.target.checked ? W.selected.add(i) : W.selected.delete(i); tr.classList.toggle('off', !e.target.checked); updCount(); } })),
            ...cols.map((c) => h('td', { title: String(it[c.key] ?? '') }, String(it[c.key] ?? '')))]);
          tr.addEventListener('click', (e) => { if (e.target.tagName !== 'INPUT') tr.querySelector('input').click(); });
          t.appendChild(tr);
        });
        tableWrap.innerHTML = '';
        if (!W.items.length) tableWrap.appendChild(h('div', { style: { padding: '30px', textAlign: 'center', color: 'var(--mt)' } }, 'Nenhum item reconhecido com este tipo de mapeamento. Experimente "Planilha original".'));
        else tableWrap.appendChild(t);
        if (idx.length > LIMIT) tableWrap.appendChild(h('div', { style: { padding: '8px', fontSize: '11px', color: 'var(--mt)' } }, `Exibindo ${LIMIT} de ${idx.length} itens filtrados (a seleção vale para todos).`));
        updCount();
      }
      function updCount() { count.textContent = `${W.selected.size} de ${W.items.length} selecionado(s)`; nextBtn.disabled = !W.selected.size || !W.columns.some((c) => c.on); }

      const nextBtn = h('button', { class: 'btn btn-primary btn-sm', onclick: () => { W.step = 3; initDest(); render(); } }, 'Próximo →');
      footer.append(
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { W.step = 1; render(); } }, '← Outro arquivo'),
        h('span', { class: 'spacer' }),
        h('span', { class: 'muted', style: { fontSize: '11px' } }, W.file.name),
        nextBtn
      );
      body.appendChild(h('div', { class: 'wz-grid' }, [side, main]));
      drawTable();
    }
    const stat = (v, l) => h('div', { class: 'wz-stat' }, [h('div', { class: 'v' }, String(v)), h('div', { class: 'l' }, l)]);

    // ── Passo 3: destino ──────────────────────────────────
    function initDest() {
      const D = W.dest;
      if (W.targetBlockId) { D.how = 'replace'; return; }
      const m = mapper();
      const st = BT.store.state;
      let sec = null;
      if (m.section) {
        const g = st.groups.find((gg) => gg.provider === W.provider) || null;
        const pool = g ? g.sections : BT.store.allSections().map((x) => x.section);
        sec = pool.find((s) => s.title.toLowerCase() === m.section.toLowerCase());
        if (!sec && m.inSourceGroup === false) sec = BT.store.allSections().map((x) => x.section).find((s) => s.title.toLowerCase() === m.section.toLowerCase());
      }
      if (!sec) { const cur = BT.store.findSection(st.ui.route); sec = cur ? cur.section : st.groups[0]?.sections[0]; }
      D.sectionId = sec ? sec.id : '__new__';
      D.newGroupId = st.groups[0]?.id || '';
      D.newTitle = m.section || 'Dados importados';
      D.how = 'new';
      const firstTable = sec && sec.blocks.find((b) => b.type === 'table');
      if (firstTable && BT.blocks.isEmpty(firstTable)) D.how = 'replace';
      D.addKpi = W.mode !== 'raw';
    }

    function step3() {
      const D = W.dest;
      const box = h('div', { class: 'fg', style: { maxWidth: '720px' } });
      const cols = W.columns.filter((c) => c.on);

      if (W.targetBlockId) {
        const f = BT.store.findBlock(W.targetBlockId);
        box.appendChild(h('div', { class: 'wz-box' }, [h('h4', {}, 'Destino'), h('div', {}, `Planilha ${f.block.data.title ? '"' + f.block.data.title + '"' : ''} na seção "${f.section.title}"`)]));
        box.appendChild(radioGroup('Como aplicar', [['replace', 'Substituir o conteúdo da planilha'], ['append', 'Acrescentar as linhas no final']], D.how, (v) => (D.how = v)));
      } else {
        // seção destino
        const sel = h('select', { class: 'inp', onchange: (e) => { D.sectionId = e.target.value; render(); } });
        BT.store.state.groups.forEach((g) => {
          const og = h('optgroup', { label: g.icon + ' ' + g.title });
          g.sections.forEach((s) => og.appendChild(h('option', { value: s.id, selected: s.id === D.sectionId }, s.icon + ' ' + s.title)));
          sel.appendChild(og);
        });
        sel.appendChild(h('option', { value: '__new__', selected: D.sectionId === '__new__' }, '＋ Criar nova seção…'));
        box.appendChild(h('div', { class: 'fd' }, [h('label', {}, 'Seção de destino'), sel]));
        if (D.sectionId === '__new__') {
          box.appendChild(h('div', { class: 'fg fg2' }, [
            h('div', { class: 'fd' }, [h('label', {}, 'No menu'), h('select', { class: 'inp', onchange: (e) => (D.newGroupId = e.target.value) }, BT.store.state.groups.map((g) => h('option', { value: g.id, selected: g.id === D.newGroupId }, g.icon + ' ' + g.title)))]),
            h('div', { class: 'fd' }, [h('label', {}, 'Nome da nova seção'), h('input', { class: 'inp', value: D.newTitle, oninput: (e) => (D.newTitle = e.target.value) })])
          ]));
          D.how = 'new';
        } else {
          const sec = BT.store.findSection(D.sectionId)?.section;
          const t = sec && sec.blocks.find((b) => b.type === 'table');
          const opts = [['new', 'Adicionar como nova planilha no fim da seção']];
          if (t) {
            const name = t.data.title || (t.data.columns || []).slice(0, 3).map((c) => c.name || c).join(', ');
            opts.push(['replace', `Substituir a planilha existente (${name}${BT.blocks.isEmpty(t) ? ' — vazia' : ''})`], ['append', 'Acrescentar linhas à planilha existente (casando colunas pelo nome)']);
          } else if (D.how !== 'new') D.how = 'new';
          box.appendChild(radioGroup('Como inserir', opts, D.how, (v) => { D.how = v; render(); }));
        }
        if (D.how === 'new') box.appendChild(h('div', { class: 'fd' }, [h('label', {}, 'Título da planilha (opcional)'), h('input', { class: 'inp', value: D.title, placeholder: 'ex.: Inventário de servidores OCI', oninput: (e) => (D.title = e.target.value) })]));

        const split = h('select', { class: 'inp', onchange: (e) => (D.splitBy = e.target.value) }, [h('option', { value: '' }, '— Não separar (uma planilha) —'), ...cols.map((c) => h('option', { value: c.key, selected: D.splitBy === c.key }, c.name))]);
        if (D.how === 'new') box.appendChild(h('div', { class: 'fd' }, [h('label', {}, 'Separar em várias planilhas por'), split]));
        box.appendChild(h('label', { class: 'switch' }, [h('input', { type: 'checkbox', checked: D.addKpi, onchange: (e) => (D.addKpi = e.target.checked) }), 'Adicionar indicadores de resumo (KPIs) antes da planilha']));
        if (BT.importer.distCharts(W.mode, null, cols).length) box.appendChild(h('label', { class: 'switch' }, [h('input', { type: 'checkbox', checked: D.addCharts, onchange: (e) => (D.addCharts = e.target.checked) }), 'Adicionar gráficos de distribuição (ligados à planilha)']));
      }
      box.appendChild(h('label', { class: 'switch' }, [h('input', { type: 'checkbox', checked: D.note, onchange: (e) => (D.note = e.target.checked) }), 'Incluir nota com a origem dos dados (arquivo e data)']));
      box.appendChild(h('div', { class: 'wz-stats' }, [stat(W.selected.size, 'Itens'), stat(cols.length, 'Colunas'), stat(BT.data.providers[W.provider].label, 'Fonte')]));
      body.appendChild(box);

      footer.append(
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { W.step = 2; render(); } }, '← Voltar'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-primary btn-sm', onclick: apply }, `✓ Importar ${W.selected.size} item(ns)`)
      );
    }

    function radioGroup(label, options, value, onChange) {
      const name = BT.uid('r');
      return h('div', { class: 'fd' }, [h('label', {}, label), ...options.map(([v, l]) =>
        h('label', { class: 'chk', style: { padding: '4px 0' } }, [h('input', { type: 'radio', name, value: v, checked: v === value, onchange: () => onChange(v) }), l]))]);
    }

    // ── Aplicar no book ───────────────────────────────────
    function apply() {
      const D = W.dest;
      const cols = W.columns.filter((c) => c.on);
      const items = W.items.filter((_, i) => W.selected.has(i));
      const toRows = (list) => list.map((it) => cols.map((c) => String(it[c.key] ?? '')));
      const columns = cols.map((c) => ({ name: c.name, badge: !!c.badge }));
      const note = D.note ? `Fonte: ${W.file.name} · ${BT.data.providers[W.provider].label} · importado em ${U.today()}` : '';
      const kpi = { title: '', items: mapper().summary(items) };
      let gotoId = null;

      if (W.targetBlockId) {
        const f = BT.store.findBlock(W.targetBlockId);
        BT.store.commit(() => applyToTable(f.block, D.how, columns, toRows(items), note), 'import');
        gotoId = f.section.id;
      } else {
        BT.store.commit(() => {
          let sec;
          if (D.sectionId === '__new__') {
            const g = BT.store.findGroup(D.newGroupId) || BT.store.state.groups[0];
            sec = BT.store.makeSection({ title: D.newTitle || 'Dados importados', icon: mapper().icon || '📄' });
            g.sections.push(sec); g.collapsed = false;
          } else sec = BT.store.findSection(D.sectionId).section;
          gotoId = sec.id;

          const kpiBlock = D.addKpi ? { id: BT.uid('blk'), type: 'kpi', include: true, data: kpi } : null;
          const existing = sec.blocks.find((b) => b.type === 'table');

          if ((D.how === 'replace' || D.how === 'append') && existing) {
            applyToTable(existing, D.how, columns, toRows(items), note);
            if (kpiBlock) sec.blocks.splice(sec.blocks.indexOf(existing), 0, kpiBlock);
            if (D.addCharts && D.how === 'replace') BT.importer.insertCharts(sec, existing, BT.importer.distCharts(W.mode, existing.id, cols));
          } else {
            const newBlocks = [];
            if (kpiBlock) newBlocks.push(kpiBlock);
            if (D.splitBy) {
              const groups = {};
              items.forEach((it) => { const k = String(it[D.splitBy] || '—'); (groups[k] = groups[k] || []).push(it); });
              Object.entries(groups).forEach(([k, list]) => newBlocks.push(tableBlock(`${D.title ? D.title + ' · ' : ''}${k}`, columns, toRows(list), note)));
            } else newBlocks.push(tableBlock(D.title, columns, toRows(items), note));
            sec.blocks.push(...newBlocks);
            if (D.addCharts && !D.splitBy) { const tb = newBlocks[newBlocks.length - 1]; BT.importer.insertCharts(sec, tb, BT.importer.distCharts(W.mode, tb.id, cols)); }
          }
          const grp = BT.store.findSection(sec.id).group; grp.collapsed = false;
        }, 'import');
      }
      modal.close();
      if (gotoId) BT.editor.router.go(gotoId);
      BT.ui.toast(`✓ ${items.length} item(ns) importado(s) de ${W.file.name}`, { type: 'ok' });
    }

    render();
    if (opts.file) load(opts.file);
    return modal;
  }

  function tableBlock(title, columns, rows, note) {
    return { id: BT.uid('blk'), type: 'table', include: true, data: { title: title || '', columns: columns.map((c) => Object.assign({}, c)), rows, compact: rows.length > 40 || columns.length > 7, note } };
  }

  function applyToTable(block, how, columns, rows, note) {
    const d = block.data;
    if (how === 'append' && d.columns && d.columns.length) {
      BT.blocks.get('table').normalize(d);
      const names = d.columns.map((c) => String(c.name).toLowerCase());
      columns.forEach((c) => { if (!names.includes(c.name.toLowerCase())) { d.columns.push(Object.assign({}, c)); names.push(c.name.toLowerCase()); d.rows.forEach((r) => r.push('')); } });
      const idx = columns.map((c) => names.indexOf(c.name.toLowerCase()));
      d.rows = d.rows.filter((r) => r.some((v) => String(v).trim()));
      rows.forEach((r) => { const nr = d.columns.map(() => ''); r.forEach((v, i) => (nr[idx[i]] = v)); d.rows.push(nr); });
    } else {
      d.columns = columns.map((c) => Object.assign({}, c));
      d.rows = rows;
      d.compact = rows.length > 40 || columns.length > 7;
    }
    if (note) d.note = note;
  }

  /** Gráficos de distribuição sugeridos por tipo de importação (ligados à planilha). */
  BT.importer.distCharts = function (mode, tableId, cols) {
    const idx = (key) => cols.findIndex((c) => c.key === key && c.on !== false);
    const out = [];
    const add = (key, title, kind = 'bar', extra = {}) => { const i = idx(key); if (i >= 0) out.push(BT.blocks.chartFromTable(tableId, i, Object.assign({ title, kind }, extra))); };
    if (mode === 'servers') { add('os', 'Sistema operacional'); add('location', 'Região / localidade'); add('group', 'Grupo / compartimento'); }
    if (mode === 'storage') add('type', 'Storage por tipo');
    if (mode === 'baseline') { const q = idx('qtd'); const c = idx('categoria'); if (c >= 0 && q >= 0) out.push(BT.blocks.chartFromTable(tableId, c, { title: 'Distribuição de recursos', kind: 'column', height: 260, table: { valueCol: q, top: 12 } })); }
    return out;
  };
  /** Insere gráficos logo após a planilha, substituindo gráficos antigos ligados a ela. */
  BT.importer.insertCharts = function (sec, table, charts) {
    if (!charts.length || !table) return;
    sec.blocks = sec.blocks.filter((b) => !(b.type === 'chart' && b.data.source === 'table' && b.data.table && b.data.table.blockId === table.id));
    sec.blocks.splice(sec.blocks.indexOf(table) + 1, 0, ...charts);
  };

  BT.importer.wizard = { open };
  BT.importer._tableBlock = tableBlock;
  BT.importer._applyToTable = applyToTable;
})(window.BT);
