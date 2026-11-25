/* ═══ Importação em lote via ZIP — preenche várias seções de uma vez ═══
 *
 * O ZIP pode conter (em qualquer combinação):
 *   manifest.json            → dados da capa: cliente, mes, ano, area, responsavel, time,
 *                              subtitulo, ambientes, governanca{}, textos{"Seção": "texto"}
 *   logo.png | logo-cliente.*→ logo do cliente na capa
 *   *.book.json              → projeto completo salvo pelo app (usado como base)
 *   oci/servidores.csv       → planilha (pasta = provedor, nome = seção)
 *   aws/storage.xlsx, azure/redes.csv, vmware/rvtools.xlsx, oci/baseline.csv …
 *   operacoes/incidentes.csv → seções sem provedor casam pelo nome (Incidentes, Equipe…)
 *   oci/networking/*.png     → imagens vão para a seção indicada pelas pastas
 *   book/objetivo.txt (.md)  → texto da seção
 * Quando o nome não diz, o conteúdo é analisado (provedor e tipo de export).
 * Antes de aplicar, uma tela de revisão permite ajustar tudo e escolher os itens.
 */
(function (BT) {
  const h = BT.h;
  const U = BT.core.utils;

  const DATA_EXT = /\.(csv|tsv|xlsx|xls|xlsm|json)$/i;
  const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;
  const TXT_EXT = /\.(txt|md|html?)$/i;
  const IGNORE = /(^|\/)(__macosx|\.ds_store|thumbs\.db|desktop\.ini)|(^|\/)\.|(^|\/)(leia-?me|readme|coloque)[^/]*$/i;

  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const tokensOf = (path) => norm(path).replace(/\.[a-z0-9]+$/, '').split(/[^a-z0-9]+/).filter(Boolean);

  const PROVIDERS = { oci: ['oci', 'oracle'], aws: ['aws', 'amazon', 'ec2', 's3'], azure: ['azure', 'microsoft'], gcp: ['gcp', 'google'], vmware: ['vmware', 'rvtools', 'onprem', 'vsphere', 'esxi', 'vcenter'] };
  // seção canônica → palavras que a identificam + mapeador sugerido
  const ALIASES = [
    { title: 'servidores', words: ['servidores', 'servidor', 'servers', 'server', 'vms', 'vm', 'compute', 'instances', 'instancias', 'ec2', 'vinfo', 'rvtools'], mapper: 'servers' },
    { title: 'networking', words: ['networking', 'network', 'networks', 'rede', 'redes', 'vcn', 'vcns', 'vpc', 'vpcs', 'vnet', 'vnets', 'subnets'], mapper: 'network' },
    { title: 'storage', words: ['storage', 'buckets', 'bucket', 'volumes', 'discos', 'disks', 'datastores', 's3'], mapper: 'storage' },
    { title: 'baseline geral', words: ['baseline', 'recursos', 'resources', 'allresources', 'inventario'], mapper: 'baseline' },
    { title: 'backup', words: ['backup', 'backups'], mapper: 'raw' },
    { title: 'seguranca', words: ['seguranca', 'security', 'nsg', 'firewall'], mapper: 'raw' },
    { title: 'objetivo', words: ['objetivo', 'introducao', 'escopo'], mapper: 'raw' }
  ];

  // ── Utilidades sobre um estado "alvo" (pode ainda não estar carregado no store) ──
  const allSections = (T) => T.groups.flatMap((g) => g.sections.map((s) => ({ group: g, section: s })));
  const findSec = (T, id) => allSections(T).find((x) => x.section.id === id);

  function providerFrom(tokens) {
    for (const [k, words] of Object.entries(PROVIDERS)) if (tokens.some((t) => words.includes(t))) return k;
    return '';
  }

  /** Encontra a seção de destino pelos tokens do caminho. */
  function matchSection(T, tokens, provider) {
    const pool = provider ? allSections(T).filter((x) => x.group.provider === provider) : [];
    const everywhere = allSections(T);
    const alias = ALIASES.find((a) => tokens.some((t) => a.words.includes(t)));
    const words = (x) => norm(x.section.title).split(/[^a-z0-9]+/);
    const byTitle = (list, title) => list.find((x) => norm(x.section.title) === title) || list.find((x) => norm(x.section.title).includes(title))
      || (alias ? list.find((x) => words(x).some((w) => alias.words.includes(w))) : null);
    if (alias) {
      const hit = byTitle(pool, alias.title) || (!provider || alias.title === 'baseline geral' ? byTitle(everywhere, alias.title) : null);
      if (hit) return { hit, alias };
    }
    const sig = (x) => norm(x.section.title).split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    const generic = (list) => list.find((x) => sig(x).length && sig(x).every((w) => tokens.includes(w)));
    const hit = generic(pool) || generic(everywhere);
    return { hit: hit || null, alias };
  }

  // ── Leitura e classificação ───────────────────────────────
  async function analyze(entries, T) {
    const files = entries.filter((e) => !IGNORE.test(e.path) && e.size > 0);
    // remove pasta-raiz comum ("export-novembro/oci/..." → "oci/...")
    const firsts = new Set(files.map((f) => f.path.split('/')[0]));
    const strip = firsts.size === 1 && files.every((f) => f.path.includes('/')) ? files[0].path.split('/')[0] + '/' : '';
    const items = [];
    for (const e of files) {
      const rel = e.path.slice(strip.length);
      const tokens = tokensOf(rel);
      const base = norm(e.name);
      const it = { id: BT.uid('zi'), entry: e, path: rel, tokens, include: true, kind: 'ignore', provider: providerFrom(tokens), dest: '', newTitle: '', how: 'new', note: '' };
      try {
        if (/\.book\.json$/i.test(e.name)) {
          it.kind = 'project'; it.project = JSON.parse(new TextDecoder().decode(await e.read()));
        } else if (/^(manifest|capa|meta|book|cliente)\.json$/i.test(base)) {
          it.kind = 'manifest'; it.manifest = JSON.parse(new TextDecoder().decode(await e.read()).replace(/^﻿/, ''));
        } else if (IMG_EXT.test(e.name) && /^logo/.test(base) && !rel.includes('/')) {
          it.kind = 'logo';
        } else if (IMG_EXT.test(e.name)) {
          it.kind = 'image';
        } else if (TXT_EXT.test(e.name)) {
          it.kind = 'text';
        } else if (DATA_EXT.test(e.name)) {
          it.kind = 'data';
          it.parsed = await BT.importer.readFile(await e.file());
        }
      } catch (err) { it.kind = 'error'; it.include = false; it.note = err.message; }
      if (it.kind !== 'ignore') items.push(it);
    }
    return items;
  }

  /** Define destino, mapeador e linhas selecionadas de cada item (re-executável). */
  /** Seção pelo título sugerido (ex.: "Capacidade", "Incidentes"), em qualquer menu. */
  function byDestTitle(T, title) {
    const t = norm(title);
    const all = allSections(T);
    return all.find((x) => norm(x.section.title) === t) || all.find((x) => norm(x.section.title).includes(t)) || null;
  }

  function plan(it, T, keepDest) {
    if (it.destTitle && !keepDest) {
      const hit = byDestTitle(T, it.destTitle);
      it.dest = hit ? hit.section.id : '__new__';
      it.newTitle = hit ? '' : (it.newTitleHint || it.destTitle);
      if (it.kind === 'data') {
        it.mapper = it.forceMapper || 'raw';
        it.how = hit && hit.section.blocks.some((b) => b.type === 'table') ? 'replace' : 'new';
        remap(it);
      }
      return;
    }
    if (it.kind === 'blocks') return;
    if (it.kind === 'data') {
      const p = it.parsed;
      if (!it.provider) it.provider = BT.importer.detect.provider(p.sheets[0].fields, it.path, p.sheets.map((s) => s.name));
      if (!keepDest) {
        // conta nomeada (ex.: AWS · HML): procura só no menu daquela conta
        const scope = it.account ? { groups: T.groups.filter((g) => g.provider === it.provider && g.account === it.account) } : T;
        const { hit, alias } = matchSection(scope, it.tokens, it.provider);
        it.dest = hit ? hit.section.id : '__new__';
        it.newTitle = hit ? '' : prettify(it.entry.name);
        it.mapper = alias && alias.mapper !== 'raw' ? alias.mapper : BT.importer.detect.kind(p.sheets[0].fields, p.sheets.map((s) => s.name));
        // cabeçalhos iguais aos da planilha de destino → mantém colunas como estão
        const table = hit && hit.section.blocks.find((b) => b.type === 'table');
        if (table) {
          const cols = table.data.columns.map((c) => norm(c.name || c));
          const hits = p.sheets[0].fields.filter((f) => cols.includes(norm(f))).length;
          if (hits && hits >= Math.min(cols.length, p.sheets[0].fields.length) * 0.6) it.mapper = 'raw';
        }
        if (!alias && it.mapper !== 'baseline' && hit && !hit.group.provider) it.mapper = 'raw';
        it.how = table ? 'replace' : 'new';
      }
      remap(it);
    } else if (it.kind === 'image' || it.kind === 'text') {
      if (!keepDest) {
        const { hit } = matchSection(T, it.tokens, it.provider);
        it.dest = hit ? hit.section.id : '__new__';
        it.newTitle = hit ? '' : (it.kind === 'image' ? 'Anexos' : prettify(it.entry.name));
      }
    }
  }

  function remap(it) {
    const m = BT.importer.mappers[it.mapper] || BT.importer.mappers.raw;
    const sheets = it.parsed.sheets;
    let si = m.pickSheet ? m.pickSheet(sheets) : -1;
    if (si < 0) si = 0;
    it.sheetIdx = si;
    it.items = sheets.length ? m.map(sheets[si], it.provider || 'generic', it.parsed) : [];
    it.columns = (m.dynamicColumns ? m.dynamicColumns(sheets[si]) : m.columns).map((c) => Object.assign({ badge: false }, c, m.dynamicColumns ? { on: true } : {}));
    it.selected = new Set(it.items.map((x, i) => (m.defaultSelected && !m.defaultSelected(x) ? -1 : i)).filter((i) => i >= 0));
    if (!it.items.length) { it.include = false; it.note = 'sem linhas reconhecidas'; } else if (it.note === 'sem linhas reconhecidas') { it.include = true; it.note = ''; }
  }

  const prettify = (name) => { const s = String(name).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim(); return s.charAt(0).toUpperCase() + s.slice(1); };

  // ── Tela de revisão ───────────────────────────────────────
  async function open(file, ctx = null) {
    let entries;
    try { entries = await BT.core.zip.read(file); }
    catch (e) { return BT.ui.toast(e.message, { type: 'err', ms: 7000 }); }

    let T = ctx ? BT.store.migrate(ctx.base || BT.data.defaultTemplate()) : BT.store.state;
    if (!T) return BT.ui.toast('Abra ou crie um book primeiro.', { type: 'err' });
    const loading = BT.ui.modal.open({ title: '📦 Lendo ZIP…', body: h('div', { class: 'muted' }, `Analisando ${entries.length} arquivo(s) de ${file.name}…`), dismissable: false });
    let items;
    try { items = await analyze(entries, T); } finally { loading.close(); }

    const project = items.find((i) => i.kind === 'project');
    if (project && await BT.ui.modal.confirm(`O ZIP contém um projeto completo (${project.path}). Usar esse projeto como base (menus, seções e conteúdo) e aplicar os demais arquivos por cima?`, { okText: 'Usar projeto' })) {
      if (ctx) T = BT.store.migrate(project.project);
      else { BT.store.load(project.project); T = BT.store.state; }
    }
    items = items.filter((i) => i.kind !== 'project');
    if (!items.length) return BT.ui.toast('Nenhum arquivo aproveitável no ZIP (CSV, XLSX, imagens, textos ou manifest.json).', { type: 'err', ms: 7000 });
    return review(items, ctx, T, `📦 Importar ZIP — ${file.name}`);
  }

  /** Tela de revisão + aplicação. Usada pelo ZIP e pela sincronização com a cloud (API). */
  function review(items, ctx, T, title) {
    T = T || (ctx ? BT.store.migrate(ctx.base || BT.data.defaultTemplate()) : BT.store.state);
    items.forEach((it) => plan(it, T));
    // vários arquivos para a mesma planilha (ex.: baseline de várias clouds) → o 2º em diante acrescenta
    const seenDest = new Set();
    items.filter((it) => it.kind === 'data' && it.include).forEach((it) => {
      const k = it.dest + '|' + it.mapper;
      if (seenDest.has(k) && it.how === 'replace') it.how = 'append';
      seenDest.add(k);
    });

    const manifest = items.find((i) => i.kind === 'manifest');
    const meta = Object.assign({}, ctx ? ctx.meta : {}, {});
    if (manifest) {
      const mf = manifest.manifest || {};
      // valores do manifest preenchem a capa (o cliente digitado na tela inicial tem prioridade)
      ['cliente', 'mes', 'ano', 'area', 'responsavel', 'time', 'subtitulo', 'ambientes'].forEach((k) => {
        if (mf[k] === undefined || mf[k] === '') return;
        if (k === 'cliente' && ctx && ctx.meta.cliente) return;
        meta[k] = String(mf[k]);
      });
      if (mf.mes) meta.mes = String(mf.mes).padStart(2, '0');
      if (mf.governanca) meta.governanca = mf.governanca;
    }
    const opts = { kpi: true, charts: true, note: true, applyManifest: true };

    const m = BT.ui.modal.open({ title, size: 'lg', body: h('div'), footer: [] });
    const body = m.body;
    const footer = m.el.querySelector('.modal-ft') || m.el.appendChild(h('div', { class: 'modal-ft' }));

    function destSelect(it) {
      const sel = h('select', { class: 'inp inp-sm', onchange: (e) => { it.dest = e.target.value; if (it.kind === 'data') { const t = findSec(T, it.dest)?.section.blocks.find((b) => b.type === 'table'); it.how = t ? 'replace' : 'new'; } draw(); } });
      T.groups.forEach((g) => sel.appendChild(h('optgroup', { label: g.icon + ' ' + g.title }, g.sections.map((s) => h('option', { value: s.id, selected: s.id === it.dest }, s.title)))));
      sel.appendChild(h('option', { value: '__new__', selected: it.dest === '__new__' }, '＋ Nova seção: ' + (it.newTitle || '…')));
      return sel;
    }

    function draw() {
      body.innerHTML = '';
      // dados da capa
      if (ctx) {
        const f = (label, key, el) => h('div', { class: 'fd' }, [h('label', {}, label), el || h('input', { class: 'inp inp-sm', value: meta[key] || '', oninput: (e) => (meta[key] = e.target.value) })]);
        const mes = h('select', { class: 'inp inp-sm', onchange: (e) => (meta.mes = e.target.value) }, BT.session.MONTHS.map((n, i) => h('option', { value: String(i + 1).padStart(2, '0'), selected: Number(meta.mes) === i + 1 }, n)));
        body.appendChild(h('div', { class: 'wz-box', style: { marginBottom: '12px' } }, [
          h('h4', {}, ['Novo book', manifest ? h('span', { class: 'pill' }, 'preenchido pelo manifest.json') : null]),
          h('div', { class: 'fg fg4' }, [f('Cliente', 'cliente'), f('Mês', 'mes', mes), f('Ano', 'ano'), f('Área técnica', 'area')])
        ]));
      } else {
        body.appendChild(h('div', { class: 'wz-box', style: { marginBottom: '12px', display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' } }, [
          h('span', {}, ['Aplicando em ', h('b', {}, BT.session.label(Object.assign({}, T.meta)))]),
          manifest ? h('label', { class: 'switch' }, [h('input', { type: 'checkbox', checked: opts.applyManifest, onchange: (e) => (opts.applyManifest = e.target.checked) }), 'Atualizar dados da capa com o manifest.json']) : null
        ]));
      }

      const usable = items.filter((i) => i.kind !== 'error' && !(i.kind === 'data' && !i.items.length));
      const allOn = usable.length && usable.every((i) => i.include);
      body.appendChild(h('div', { class: 'wz-toolbar', style: { marginBottom: '8px' } }, [
        h('button', { class: 'btn btn-sec btn-xs', onclick: () => { usable.forEach((i) => (i.include = true)); draw(); } }, '☑ Selecionar tudo'),
        h('button', { class: 'btn btn-sec btn-xs', onclick: () => { items.forEach((i) => (i.include = false)); draw(); } }, '☐ Nenhum')
      ]));
      const t = h('table', { class: 'wz-table zip-table' });
      t.appendChild(h('tr', {}, [h('th', {}, h('input', { type: 'checkbox', checked: allOn, title: 'Selecionar tudo / nenhum', onchange: (e) => { usable.forEach((i) => (i.include = e.target.checked)); draw(); } })),
        ...['Arquivo', 'Tipo', 'Provedor', 'Destino', 'Como', 'Itens'].map((x) => h('th', {}, x))]));
      items.forEach((it) => {
        const tr = h('tr', { class: it.include ? '' : 'off' });
        const chk = h('input', { type: 'checkbox', checked: it.include, disabled: it.kind === 'error', onchange: (e) => { it.include = e.target.checked; tr.classList.toggle('off', !it.include); updCount(); } });
        const icon = { data: '▦', image: '🖼️', text: '📝', logo: '🏷️', manifest: '📘', error: '⚠️', blocks: '🧩' }[it.kind];
        const fileCell = h('td', { title: it.path }, [h('div', { class: 'zf-name' }, `${icon} ${it.path}`), it.note ? h('small', { class: 'muted' }, it.note) : null]);
        let type = '', prov = '', dest = '', how = '', count = '';
        if (it.kind === 'data') {
          type = h('select', { class: 'inp inp-sm', onchange: (e) => { it.mapper = e.target.value; remap(it); draw(); } },
            Object.values(BT.importer.mappers).filter((x) => x && x.key).sort((a, b) => a.order - b.order).map((x) => h('option', { value: x.key, selected: x.key === it.mapper }, x.label)));
          prov = BT.data.providers[it.provider]?.tool ? BT.data.providers[it.provider].label
            : h('select', { class: 'inp inp-sm', onchange: (e) => { it.provider = e.target.value; remap(it); draw(); } }, BT.data.providerList.map((k) => h('option', { value: k, selected: k === it.provider }, BT.data.providers[k].label)));
          dest = destSelect(it);
          const hasTable = !!findSec(T, it.dest)?.section.blocks.find((b) => b.type === 'table');
          how = h('select', { class: 'inp inp-sm', onchange: (e) => (it.how = e.target.value) }, [['replace', 'Substituir'], ['append', 'Acrescentar'], ['new', 'Nova planilha']]
            .filter(([k]) => hasTable || k === 'new').map(([k, l]) => h('option', { value: k, selected: k === it.how }, l)));
          count = h('button', { class: 'btn btn-ghost btn-xs', title: 'Escolher linhas e colunas', onclick: () => picker(it, draw) }, `${it.selected.size}/${it.items.length} ✎`);
        } else if (it.kind === 'image' || it.kind === 'text') {
          type = it.kind === 'image' ? 'Imagem' : 'Texto'; dest = destSelect(it); how = it.kind === 'image' ? 'Adicionar' : 'Substituir texto';
        } else if (it.kind === 'blocks') {
          type = it.blocks.map((b) => BT.blocks.get(b.type)?.label || b.type).filter((v, i, a) => a.indexOf(v) === i).join(' + ');
          prov = BT.data.providers[it.provider]?.label || ''; dest = destSelect(it); how = 'Atualizar'; count = `${it.blocks.length} bloco(s)`;
        } else if (it.kind === 'logo') { type = 'Logo do cliente'; dest = 'Capa'; }
        else if (it.kind === 'manifest') { type = 'Dados da capa'; dest = 'Capa'; }
        else type = 'Erro';
        [h('td', {}, chk), fileCell, h('td', {}, type), h('td', {}, prov), h('td', {}, dest), h('td', {}, how), h('td', {}, count)].forEach((c) => tr.appendChild(c));
        t.appendChild(tr);
      });
      body.appendChild(h('div', { class: 'wz-table-wrap', style: { maxHeight: '52vh' } }, t));
      body.appendChild(h('div', { class: 'wz-toolbar', style: { marginTop: '12px' } }, [
        h('label', { class: 'switch' }, [h('input', { type: 'checkbox', checked: opts.kpi, onchange: (e) => (opts.kpi = e.target.checked) }), 'Gerar indicadores (KPIs) para dados de cloud']),
        h('label', { class: 'switch' }, [h('input', { type: 'checkbox', checked: opts.charts, onchange: (e) => (opts.charts = e.target.checked) }), 'Gráficos de distribuição']),
        h('label', { class: 'switch' }, [h('input', { type: 'checkbox', checked: opts.note, onchange: (e) => (opts.note = e.target.checked) }), 'Nota com a origem dos dados']),
        countEl
      ]));
      updCount();
    }
    const countEl = h('span', { class: 'wz-count' });
    const applyBtn = h('button', { class: 'btn btn-primary btn-sm', onclick: () => apply() }, 'Aplicar');
    function updCount() { const n = items.filter((i) => i.include).length; countEl.textContent = `${n} de ${items.length} arquivo(s) selecionado(s)`; applyBtn.textContent = ctx ? `✓ Criar book com ${n} arquivo(s)` : `✓ Aplicar ${n} arquivo(s)`; applyBtn.disabled = !n && !ctx; }
    footer.append(h('button', { class: 'btn btn-ghost btn-sm', onclick: () => m.close() }, 'Cancelar'), h('span', { class: 'spacer' }), applyBtn);
    draw();

    // ── Aplicar ─────────────────────────────────────────────
    async function apply() {
      applyBtn.disabled = true; applyBtn.textContent = 'Aplicando…';
      const touched = new Set();
      const filledTables = new Set();
      const newSections = {};
      const zipImageBlock = new Map(); // seção → bloco de imagem usado nesta importação
      const today = U.today();

      const sectionFor = (it) => {
        if (it.dest !== '__new__') return findSec(T, it.dest).section;
        const key = (it.provider || '') + '|' + (it.account || '') + '|' + it.newTitle;
        if (newSections[key]) return newSections[key];
        const cloudP = it.provider && !BT.data.providers[it.provider]?.tool;
        let g = cloudP ? T.groups.find((x) => x.provider === it.provider && (x.account || '') === (it.account || '')) : null;
        if (!g && it.groupHint) g = T.groups.find((x) => norm(x.title).includes(norm(it.groupHint)));
        if (!g && cloudP) { const p = BT.data.providers[it.provider]; g = BT.store.makeGroup({ title: p.label + (it.account ? ' · ' + it.account : ''), icon: p.icon, provider: it.provider, account: it.account || '', separator: true }); T.groups.push(g); }
        if (!g) g = T.groups[T.groups.length - 1] || (T.groups.push(BT.store.makeGroup({ title: 'Book', icon: '📄' })), T.groups[0]);
        const s = BT.store.makeSection({ title: it.newTitle || 'Importados', icon: it.kind === 'image' ? '🖼️' : '📄' });
        g.sections.push(s); g.collapsed = false;
        return (newSections[key] = s);
      };

      try {
        const useManifest = manifest && manifest.include && (ctx || opts.applyManifest);
        if (ctx || useManifest) Object.assign(T.meta, meta);
        if (useManifest) {
          const mf = manifest.manifest || {};
          if (mf.governanca) T.meta.governanca = Object.assign({}, T.meta.governanca, mf.governanca);
          if (mf.textos && typeof mf.textos === 'object') {
            Object.entries(mf.textos).forEach(([name, text]) => {
              const { hit } = matchSection(T, tokensOf(name), providerFrom(tokensOf(name)));
              if (hit) { fillText(hit.section, /<\/?[a-z][\s\S]*>/i.test(text) ? BT.core.sanitizeHtml(text) : BT.core.textToHtml(text)); touched.add(hit.section.id); }
            });
          }
        }

        for (const it of items.filter((i) => i.include)) {
          if (it.kind === 'logo') { T.meta.logoCliente = await U.compressImage(await U.readAsDataURL(await it.entry.file()), 600); continue; }
          if (it.kind === 'data') {
            const sec = sectionFor(it); touched.add(sec.id);
            const cols = it.columns.filter((c) => c.on);
            const list = it.items.filter((_, i) => it.selected.has(i));
            const rows = list.map((x) => cols.map((c) => String(x[c.key] ?? '')));
            const columns = cols.map((c) => ({ name: c.name, badge: !!c.badge }));
            const note = opts.note ? (it.api ? `Fonte: ${BT.data.providers[it.provider].tool ? '' : 'API '}${BT.data.providers[it.provider].label}${it.account ? ' · ' + it.account : ''}${it.periodLabel ? ' · ' + it.periodLabel : ''} · sincronizado em ${today}` : `Fonte: ${it.path} · ${BT.data.providers[it.provider || 'generic'].label} · importado em ${today}`) : '';
            let table = null;
            if (it.how !== 'new') table = sec.blocks.find((b) => b.type === 'table' && !filledTables.has(b.id));
            if (table) BT.importer._applyToTable(table, it.how, columns, rows, note);
            else { table = BT.importer._tableBlock('', columns, rows, note); sec.blocks.push(table); }
            filledTables.add(table.id);
            if (opts.charts && it.how !== 'append') BT.importer.insertCharts(sec, table, BT.importer.distCharts(it.mapper, table.id, cols));
            if (opts.kpi && it.mapper !== 'raw' && it.how !== 'append') {
              const m2 = BT.importer.mappers[it.mapper];
              const kdata = { title: '', items: m2.summary(list) };
              const ti = sec.blocks.indexOf(table);
              const prev = sec.blocks[ti - 1];
              if (prev && prev.type === 'kpi' && (BT.blocks.isEmpty(prev) || it.how === 'replace')) prev.data = kdata;
              else sec.blocks.splice(ti, 0, { id: BT.uid('blk'), type: 'kpi', include: true, data: kdata });
            }
          }
          if (it.kind === 'blocks') {
            // substitui os blocos da mesma origem (ex.: sincronização anterior do Zabbix) na mesma posição
            const sec = sectionFor(it); touched.add(sec.id);
            let at = sec.blocks.findIndex((b) => b.data && b.data.origin === it.origin);
            sec.blocks = sec.blocks.filter((b) => !(b.data && b.data.origin === it.origin) && !(it.replaceEmptyType && b.type === it.replaceEmptyType && BT.blocks.isEmpty(b)));
            if (at < 0 || at > sec.blocks.length) at = 0;
            const fresh = it.blocks.map((b) => Object.assign(BT.core.utils.clone(b), { id: BT.uid('blk'), include: true }));
            fresh.forEach((b) => (b.data.origin = it.origin));
            sec.blocks.splice(at, 0, ...fresh);
          }
          if (it.kind === 'image') {
            const sec = sectionFor(it); touched.add(sec.id);
            const src = await U.compressImage(await U.readAsDataURL(await it.entry.file()));
            let blk = zipImageBlock.get(sec.id) || sec.blocks.find((b) => b.type === 'image' && BT.blocks.isEmpty(b));
            if (!blk) { blk = { id: BT.uid('blk'), type: 'image', include: true, data: { title: '', images: [], layout: 'grid2' } }; sec.blocks.push(blk); }
            zipImageBlock.set(sec.id, blk);
            blk.data.images.push({ src, caption: prettify(it.entry.name), name: it.entry.name });
            blk.data.layout = blk.data.images.length === 1 ? 'full' : blk.data.layout || 'grid2';
          }
          if (it.kind === 'text') {
            const sec = sectionFor(it); touched.add(sec.id);
            const raw = new TextDecoder().decode(await it.entry.read()).replace(/^﻿/, '');
            const html = /\.html?$/i.test(it.entry.name) ? BT.core.sanitizeHtml(raw) : /\.md$/i.test(it.entry.name) ? mdToHtml(raw) : BT.core.textToHtml(raw);
            fillText(sec, html);
          }
        }
      } catch (err) {
        console.error(err);
        applyBtn.disabled = false; updCount();
        return BT.ui.toast('Falha ao aplicar: ' + err.message, { type: 'err', ms: 8000 });
      }

      m.close();
      const firstSec = [...touched][0];
      if (ctx) {
        T.ui = { route: firstSec || 'cover' };
        const { id, state } = await BT.session.create(T.meta, T, ctx.template);
        BT.editor.nav.openLoaded(id, state);
      } else {
        BT.store.commit(null, 'zip-import');
        if (firstSec) BT.editor.router.go(firstSec);
      }
      BT.ui.toast(`✓ ${items.some((i) => i.api) ? 'Dados da cloud aplicados' : 'ZIP aplicado'}: ${items.filter((i) => i.include).length} item(ns) em ${touched.size} seção(ões)`, { type: 'ok', ms: 6000 });
    }
  }

  /** Texto do ZIP substitui o primeiro bloco de texto da seção (ou cria um). */
  function fillText(sec, html) {
    const blk = sec.blocks.find((b) => b.type === 'text');
    if (blk) blk.data.html = html;
    else sec.blocks.push({ id: BT.uid('blk'), type: 'text', include: true, data: { title: '', html } });
  }

  function mdToHtml(md) {
    const inline = (s) => BT.esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>');
    return md.replace(/\r/g, '').split(/\n{2,}/).map((blk) => {
      const lines = blk.split('\n');
      if (lines.every((l) => /^\s*[-*]\s+/.test(l))) return '<ul>' + lines.map((l) => '<li>' + inline(l.replace(/^\s*[-*]\s+/, '')) + '</li>').join('') + '</ul>';
      if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) return '<ol>' + lines.map((l) => '<li>' + inline(l.replace(/^\s*\d+[.)]\s+/, '')) + '</li>').join('') + '</ol>';
      if (/^#{1,6}\s/.test(lines[0])) return '<h3>' + inline(lines[0].replace(/^#+\s*/, '')) + '</h3>' + (lines.length > 1 ? '<p>' + lines.slice(1).map(inline).join('<br>') + '</p>' : '');
      return '<p>' + lines.map(inline).join('<br>') + '</p>';
    }).join('');
  }

  /** Escolher linhas/colunas de um arquivo do ZIP. */
  function picker(it, done) {
    let q = '';
    const box = h('div', { class: 'wz-table-wrap', style: { maxHeight: '50vh' } });
    const colsRow = h('div', { class: 'cprow', style: { marginBottom: '10px' } }, it.columns.map((c) => h('label', { class: 'cp' }, [h('input', { type: 'checkbox', checked: c.on, onchange: (e) => { c.on = e.target.checked; drawT(); } }), c.name])));
    const cnt = h('span', { class: 'wz-count' });
    const vis = () => it.items.map((_, i) => i).filter((i) => !q || it.columns.some((c) => c.on && String(it.items[i][c.key] ?? '').toLowerCase().includes(q)));
    function drawT() {
      const cols = it.columns.filter((c) => c.on);
      const t = h('table', { class: 'wz-table' });
      t.appendChild(h('tr', {}, [h('th', {}, ''), ...cols.map((c) => h('th', {}, c.name))]));
      vis().slice(0, 500).forEach((i) => {
        const on = it.selected.has(i);
        const tr = h('tr', { class: on ? '' : 'off' }, [h('td', {}, h('input', { type: 'checkbox', checked: on, onchange: (e) => { e.target.checked ? it.selected.add(i) : it.selected.delete(i); tr.classList.toggle('off', !e.target.checked); upd(); } })),
          ...cols.map((c) => h('td', {}, String(it.items[i][c.key] ?? '')))]);
        t.appendChild(tr);
      });
      box.innerHTML = ''; box.appendChild(t); upd();
    }
    const upd = () => (cnt.textContent = `${it.selected.size} de ${it.items.length} selecionado(s)`);
    const pm = BT.ui.modal.open({
      title: `Itens de ${it.path}`, size: 'lg',
      body: [colsRow, h('div', { class: 'wz-toolbar', style: { marginBottom: '8px' } }, [
        h('input', { class: 'inp inp-sm', style: { maxWidth: '240px' }, placeholder: '🔍 Filtrar…', oninput: U.debounce((e) => { q = e.target.value.toLowerCase(); drawT(); }, 150) }),
        h('button', { class: 'btn btn-sec btn-xs', onclick: () => { it.items.forEach((_, i) => it.selected.add(i)); drawT(); } }, '☑ Selecionar tudo'),
        h('button', { class: 'btn btn-sec btn-xs', onclick: () => { it.selected.clear(); drawT(); } }, '☐ Nenhum'),
        h('button', { class: 'btn btn-ghost btn-xs', onclick: () => { vis().forEach((i) => it.selected.add(i)); drawT(); } }, '☑ Marcar visíveis'),
        h('button', { class: 'btn btn-ghost btn-xs', onclick: () => { vis().forEach((i) => it.selected.delete(i)); drawT(); } }, '☐ Desmarcar visíveis'),
        cnt]), box],
      onClose: done,
      footer: [h('button', { class: 'btn btn-primary btn-sm', onclick: () => pm.close() }, 'Concluir')]
    });
    drawT();
  }

  // ── Selecionar arquivo / modelo ───────────────────────────
  function pick(ctx) {
    const input = document.getElementById('file-zip');
    input.onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) open(f, ctx); };
    input.click();
  }

  function downloadTemplate() {
    const T = BT.data.defaultTemplate();
    const files = [];
    const csv = (cols) => '﻿' + cols.map((c) => '"' + (c.name || c) + '"').join(';') + '\r\n';
    const slug = U.slug;
    files.push({ path: 'manifest.json', content: JSON.stringify({ cliente: 'Nome do Cliente', mes: '11', ano: String(new Date().getFullYear()), area: 'Infraestrutura', responsavel: 'Nome — Cargo', time: 'infraCloud', subtitulo: 'Relatório Mensal de Infraestrutura e Operações', governanca: { codigo: '', area: '', tipo: 'Relatório', status: 'Vigente', classificacao: 'Uso Interno', versao: '1.0' }, textos: { 'Objetivo': 'Texto do objetivo deste book.', 'OCI/Segurança': 'Resumo da postura de segurança no OCI.' } }, null, 2) });
    T.groups.forEach((g) => {
      const folder = g.provider || slug(g.title);
      g.sections.forEach((s) => {
        const t = s.blocks.find((b) => b.type === 'table');
        if (t && !(g.provider && /servidores|storage|networking/i.test(s.title))) files.push({ path: `${folder}/${slug(s.title)}.csv`, content: csv(t.data.columns) });
        if (s.blocks.some((b) => b.type === 'image')) files.push({ path: `${folder}/${slug(s.title)}/COLOQUE-IMAGENS-AQUI.txt`, content: `Imagens (PNG/JPG) colocadas nesta pasta vão para a seção "${s.title}" do menu "${g.title}".` });
      });
      if (g.provider) files.push({ path: `${folder}/COLOQUE-EXPORTS-AQUI.txt`, content: `Coloque aqui os exports de ${BT.data.providers[g.provider].display} com estes nomes:\n  servidores.csv/.xlsx  → inventário de VMs/instâncias\n  storage.csv           → buckets, volumes, discos\n  redes.csv             → ${g.provider === 'oci' ? 'VCNs' : g.provider === 'azure' ? 'VNets' : 'VPCs/redes'}\n  baseline.csv          → todos os recursos (contagem por tipo)\n  backup.csv, seguranca.csv → planilhas no formato das colunas do book\nO conteúdo é detectado automaticamente; os nomes só indicam o destino.` });
    });
    files.push({ path: 'book/objetivo.txt', content: 'Apresentar a visão técnica e operacional do ambiente do cliente, consolidando inventário, topologia, segurança, incidentes e recomendações técnicas.' });
    files.push({ path: 'LEIA-ME.txt', content: [
      'MODELO DE ZIP — Book Técnico', '',
      'Preencha as pastas e envie o .zip em "Importar ZIP". Tudo é opcional: só o que estiver no ZIP é aplicado.', '',
      '• manifest.json — cliente, mês, ano, área técnica, responsável, governança e textos por seção.',
      '• logo.png (na raiz) — logo do cliente na capa.',
      '• <provedor>/… — pastas oci, aws, azure, gcp, vmware. O nome do arquivo indica a seção (servidores, storage, redes, baseline, backup, seguranca).',
      '• Exports nativos das clouds funcionam: as colunas são reconhecidas automaticamente (RVTools inclusive).',
      '• Planilhas .csv deste modelo trazem só o cabeçalho; preencha mantendo as colunas.',
      '• Imagens: coloque na pasta da seção (ex.: oci/networking/topologia.png).',
      '• Textos: arquivos .txt ou .md com o nome da seção (ex.: book/objetivo.txt).',
      '', 'Antes de aplicar, uma tela de revisão mostra o destino de cada arquivo e permite escolher os itens.'
    ].join('\r\n') });
    U.download(BT.core.zip.write(files), 'modelo-book-tecnico.zip', 'application/zip');
  }

  BT.importer.zip = { open, review, pick, downloadTemplate, _analyze: analyze, _matchSection: matchSection };
})(window.BT);
