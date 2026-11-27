/* ═══ Navegação antes do editor: Clientes › Ano › Books ═══
 * Cada nível tem URL própria:
 *   ?                                 lista de clientes
 *   ?cliente=acme&ano=2026            books do cliente no ano
 *   ?cliente=acme&ano=2026&mes=11&area=infracloud   abre o editor
 * Criar book: cliente + ano + mês + área técnica + template (InfraCloud, Network, Backup, …).
 */
(function (BT) {
  const h = BT.h;
  const SS = () => BT.session;
  const MONTHS = () => BT.session.MONTHS;
  let root = null;
  let clientsCache = [];

  function ensureRoot() {
    if (!root) { root = h('div', { class: 'start', id: 'start' }); document.body.appendChild(root); }
    root.hidden = false; document.body.classList.add('start-open');
  }
  function hide() { if (root) root.hidden = true; document.body.classList.remove('start-open'); }
  const isOpen = () => root && !root.hidden;

  /** Mostra a navegação no nível indicado pelos parâmetros (cliente / ano). */
  async function show(params = {}, opts = {}) {
    await BT.store.saveNow();
    await BT.lock.leave(); // saiu do book: libera para os outros
    ensureRoot();
    BT.url.go({ cliente: params.cliente, ano: params.cliente ? params.ano : '' }, opts);
    if (params.cliente && !clientsCache.some((c) => c.slug === params.cliente)) { try { clientsCache = await BT.api.listClients(); } catch (e) {} }
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'st-wrap' }, [header(params), h('div', { class: 'nv-body muted' }, 'Carregando…')]));
    const body = params.cliente ? await clientView(params) : await clientsView();
    root.querySelector('.nv-body').replaceWith(body);
  }

  function header(params) {
    const client = clientsCache.find((c) => c.slug === params.cliente);
    const crumbs = [h('a', { href: BT.url.href({}), onclick: (e) => { e.preventDefault(); show({}); } }, 'Clientes')];
    if (params.cliente) crumbs.push(h('span', { 'aria-hidden': 'true' }, '›'), h('a', { href: BT.url.href({ cliente: params.cliente }), onclick: (e) => { e.preventDefault(); show({ cliente: params.cliente }); } }, client ? client.nome : params.cliente));
    if (params.cliente && params.ano) crumbs.push(h('span', { 'aria-hidden': 'true' }, '›'), h('b', {}, params.ano));
    const cur = BT.store.sessionId;
    const server = BT.api.mode === 'server';
    const st = BT.api.storage || {};
    return h('div', { class: 'st-head' }, [
      h('div', { class: 'nv-top' }, [
        h('img', { src: BT.ui.theme.logo(), 'data-logo': true, alt: 'inventCloud', class: 'st-logo' }),
        h('button', { class: 'mode-badge ' + (server ? 'server' : 'local'), title: server ? 'Onde os books são salvos — clique para trocar em Configurações' : 'Aberto sem servidor: books ficam só neste navegador', onclick: () => BT.editor.settings.open() },
          server ? (st.storage === 'mongo' ? '🍃 ' : '🗄️ ') + (st.label || 'Servidor') : '🧭 Navegador · rode npm run dev para salvar no banco'),
        h('span', { class: 'nv-top-sp' }),
        cur ? h('button', { class: 'btn btn-ghost btn-sm', onclick: () => openBook(BT.api.keyOf(cur)) }, '← Voltar ao book aberto') : null,
        BT.auth.chip(),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => BT.editor.settings.open() }, '⚙️ Configurações')
      ]),
      h('nav', { class: 'nv-crumb', 'aria-label': 'Navegação' }, crumbs)
    ]);
  }

  // ── Nível 0: clientes ───────────────────────────────────
  async function clientsView() {
    clientsCache = await BT.api.listClients();
    const ptr = SS().pointer.get();
    const grid = h('div', { class: 'nv-grid' });
    const count = h('span', { class: 'nv-count', 'aria-live': 'polite' });
    let sort = 'recent';
    try { sort = localStorage.getItem('bt-client-sort') || sort; } catch (e) { /* sem localStorage */ }
    const search = h('input', { class: 'inp', type: 'search', placeholder: 'Buscar cliente ou área…   /', 'aria-label': 'Buscar cliente', oninput: () => draw(),
      onkeydown: (e) => {
        if (e.key === 'Enter') { const first = grid.querySelector('.nv-card:not(.nv-add)'); if (first) first.click(); }
        if (e.key === 'Escape') { search.value = ''; draw(); }
      } });
    const sortSel = h('select', { class: 'inp nv-sort', 'aria-label': 'Ordenar clientes', onchange: (e) => { sort = e.target.value; try { localStorage.setItem('bt-client-sort', sort); } catch (x) { /* nada */ } draw(); } },
      [['recent', 'Editados recentemente'], ['name', 'Nome (A–Z)'], ['books', 'Mais books']].map(([v, l]) => h('option', { value: v, selected: v === sort }, l)));
    const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const sorters = {
      recent: (a, b) => b.updatedAt - a.updatedAt || a.nome.localeCompare(b.nome, 'pt-BR'),
      name: (a, b) => a.nome.localeCompare(b.nome, 'pt-BR'),
      books: (a, b) => b.books - a.books || a.nome.localeCompare(b.nome, 'pt-BR')
    };
    function draw() {
      const q = norm(search.value);
      const list = clientsCache.filter((c) => !q || norm(c.nome).includes(q) || c.areas.some((a) => norm(a).includes(q))).sort(sorters[sort] || sorters.recent);
      grid.innerHTML = '';
      count.textContent = q ? `${list.length} de ${clientsCache.length}` : '';
      list.forEach((c) => grid.appendChild(h('div', { class: 'nv-card-wrap' }, [
        h('button', { class: 'nv-card', onclick: () => show({ cliente: c.slug, ano: c.anos[0] || String(new Date().getFullYear()) }) }, [
          h('div', { class: 'nv-card-top' }, [avatar(c.nome), c.updatedAt ? h('small', { class: 'nv-ago' }, ago(c.updatedAt)) : null]),
          h('b', {}, c.nome),
          h('span', {}, c.books ? `${c.books} book${c.books > 1 ? 's' : ''}${c.anos.length ? ' · ' + c.anos.slice(0, 3).join(', ') + (c.anos.length > 3 ? '…' : '') : ''}` : 'Sem books ainda'),
          c.areas.length ? h('div', { class: 'nv-tags' }, c.areas.slice(0, 4).map((a) => h('span', { class: 'pill' }, a))) : null
        ]),
        h('button', { class: 'nv-del', title: `Excluir o cliente ${c.nome} (todos os anos e books)`, 'aria-label': `Excluir o cliente ${c.nome}`, onclick: (e) => { e.stopPropagation(); deleteClient(c); } }, '🗑')
      ])));
      if (q && !list.length) grid.appendChild(h('div', { class: 'st-empty nv-span' }, `Nenhum cliente encontrado para "${search.value}".`));
      grid.appendChild(h('button', { class: 'nv-card nv-add', onclick: newClient }, [h('div', { class: 'nv-av' }, '＋'), h('b', {}, 'Novo cliente')]));
    }
    draw();
    focusSearch = search;
    const last = ptr.id ? BT.api.keyOf(ptr.id) : null;
    const totalBooks = clientsCache.reduce((n, c) => n + c.books, 0);
    const latest = clientsCache.reduce((m, c) => Math.max(m, c.updatedAt || 0), 0);
    const empty = !clientsCache.length;
    return h('div', { class: 'nv-body' }, [
      h('h1', { class: 'st-title' }, 'Clientes'),
      h('div', { class: 'st-sub' }, 'Selecione o cliente para ver os anos e os books técnicos.'),
      empty ? null : h('div', { class: 'nv-stats' }, [
        stat(clientsCache.length, clientsCache.length === 1 ? 'cliente' : 'clientes'),
        stat(totalBooks, totalBooks === 1 ? 'book' : 'books'),
        latest ? stat(ago(latest), 'última edição') : null
      ]),
      last && last.cliente ? h('button', { class: 'nv-continue', onclick: () => openBook(last) }, [h('span', { class: 'nv-continue-ic' }, '↩'), h('span', {}, ['Continuar de onde parou', h('b', {}, `${clientName(last.cliente)} · ${MONTHS()[Number(last.mes) - 1] || ''}/${last.ano} · ${last.area}`)])]) : null,
      empty ? h('div', { class: 'nv-empty' }, [
        h('div', { class: 'nv-empty-ic' }, '📘'),
        h('b', {}, 'Nenhum cliente ainda'),
        h('p', {}, 'Cadastre o primeiro cliente para criar books técnicos mensais.'),
        h('button', { class: 'btn btn-primary', onclick: newClient }, '＋ Novo cliente')
      ]) : h('div', { class: 'nv-tools' }, [h('div', { class: 'nv-search' }, [search, count]), sortSel]),
      empty ? null : grid
    ]);
  }
  let focusSearch = null;
  const stat = (n, l) => h('div', { class: 'nv-stat' }, [h('b', {}, String(n)), h('span', {}, l)]);
  const clientName = (slug) => (clientsCache.find((c) => c.slug === slug) || {}).nome || slug;
  /** Avatar com as iniciais e uma cor estável por cliente. */
  function avatar(nome, big) {
    const ini = String(nome).trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
    let hash = 0; for (const ch of String(nome)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const el = h('div', { class: 'nv-av' + (big ? ' big' : ''), 'aria-hidden': 'true' }, ini);
    el.style.setProperty('--hue', String(hash % 360));
    return el;
  }

  /** Book aberto pertence ao que foi excluído? Fecha e limpa o cookie. */
  function closeIfGone(test) {
    const cur = BT.store.sessionId;
    if (cur && test(BT.api.keyOf(cur))) { BT.store.load(BT.data.blankTemplate(), null); SS().pointer.clear(); }
  }
  /** Com servidor, excluir vai para a lixeira (o administrador restaura). Sem servidor, é definitivo. */
  const trashNote = () => (BT.api.mode === 'server' ? 'Vai para a lixeira: um administrador pode restaurar por até 30 dias.' : 'Não dá para desfazer.');
  async function deleteClient(c) {
    const ok = await BT.ui.modal.confirm(`Excluir o cliente "${c.nome}"? Serão removidos TODOS os anos e books (${c.books} book(s)${c.anos.length ? ': ' + c.anos.join(', ') : ''}) e as conexões de cloud do cliente. ${trashNote()}`, { danger: true, okText: 'Excluir cliente' });
    if (!ok) return;
    try {
      const r = await BT.api.deleteClient(c.slug);
      closeIfGone((k) => k.cliente === c.slug);
      BT.ui.toast(`Cliente ${c.nome} excluído (${r.books} book(s))`, { type: 'ok' });
      clientsCache = [];
      show({});
    } catch (e) { BT.ui.toast(e.message, { type: 'err' }); }
  }
  async function deleteYear(client, ano, n) {
    const ok = await BT.ui.modal.confirm(`Excluir o ano ${ano} de "${client.nome}"? Serão removidos os ${n} book(s) desse ano. ${trashNote()}`, { danger: true, okText: `Excluir ${ano}` });
    if (!ok) return;
    try {
      const r = await BT.api.deleteYear(client.slug, ano);
      closeIfGone((k) => k.cliente === client.slug && k.ano === String(ano));
      BT.ui.toast(`${ano} excluído (${r.books} book(s))`, { type: 'ok' });
      clientsCache = [];
      show({ cliente: client.slug });
    } catch (e) { BT.ui.toast(e.message, { type: 'err' }); }
  }

  async function newClient() {
    const nome = await BT.ui.modal.prompt({ title: '＋ Novo cliente', label: 'Nome do cliente', placeholder: 'ex.: ACME Logística', okText: 'Criar cliente',
      validate: (v) => (!BT.api.slug(v) ? 'Informe o nome do cliente.' : clientsCache.some((c) => c.slug === BT.api.slug(v)) ? 'Já existe um cliente com esse nome.' : '') });
    if (!nome) return;
    try {
      await BT.api.saveConnections(nome, { nome, providers: {} });
      clientsCache = [];
      show({ cliente: BT.api.slug(nome), ano: String(new Date().getFullYear()) });
    } catch (e) { BT.ui.toast(e.message, { type: 'err' }); }
  }

  // ── Nível 1: cliente → anos → books ─────────────────────
  async function clientView(params) {
    if (!clientsCache.length) clientsCache = await BT.api.listClients();
    const client = clientsCache.find((c) => c.slug === params.cliente) || { slug: params.cliente, nome: params.cliente, anos: [], areas: [] };
    const all = await BT.api.listBooks({ cliente: client.slug });
    const nowY = String(new Date().getFullYear());
    const years = [...new Set([...all.map((b) => b.ano), nowY])].sort().reverse();
    const ano = params.ano || years[0];
    if (!params.ano) BT.url.go({ cliente: client.slug, ano }, { replace: true });
    const books = all.filter((b) => b.ano === ano).sort((a, b) => b.mes.localeCompare(a.mes) || a.area.localeCompare(b.area));
    const editing = {}; // quem está editando cada book agora
    if (BT.auth.lockEnabled) { try { (await BT.api.locks()).forEach((l) => { editing[l.book] = l; }); } catch (e) { /* sem informação */ } }

    const tabs = h('div', { class: 'nv-years' }, [
      ...years.map((y) => { const n = all.filter((b) => b.ano === y).length; return h('button', { class: y === ano ? 'on' : '', 'aria-pressed': String(y === ano), title: client.yearGuids && client.yearGuids[y] ? 'GUID do ano: ' + client.yearGuids[y] : null, onclick: () => show({ cliente: client.slug, ano: y }) }, [y, n ? h('small', { class: 'nv-yn' }, String(n)) : null]); }),
      h('button', { class: 'nv-year-add', title: 'Outro ano', 'aria-label': 'Abrir outro ano', onclick: async () => {
        const y = await BT.ui.modal.prompt({ title: 'Outro ano', label: 'Ano (ex.: 2025)', inputmode: 'numeric', okText: 'Abrir', validate: (v) => (/^(19|20)\d{2}$/.test(v) ? '' : 'Informe um ano com 4 dígitos.') });
        if (y) show({ cliente: client.slug, ano: y });
      } }, '＋'),
      books.length ? h('button', { class: 'nv-year-del', title: `Excluir ${ano} (todos os books do ano)`, onclick: () => deleteYear(client, ano, books.length) }, `🗑 Excluir ${ano}`) : null
    ]);

    const list = h('div', { class: 'nv-books' });
    if (!books.length) list.appendChild(h('div', { class: 'nv-empty' }, [h('div', { class: 'nv-empty-ic' }, '🗓️'), h('b', {}, `Nenhum book em ${ano}`), h('p', {}, 'Crie o primeiro book técnico deste ano.'), h('button', { class: 'btn btn-primary btn-sm', onclick: () => newBook({ cliente: client.nome, ano }, all) }, '＋ Novo book')]));
    const byMonth = {};
    books.forEach((b) => (byMonth[b.mes] = byMonth[b.mes] || []).push(b));
    Object.keys(byMonth).sort().reverse().forEach((m) => list.appendChild(h('div', { class: 'nv-month' }, [
      h('div', { class: 'nv-month-h' }, MONTHS()[Number(m) - 1]),
      h('div', { class: 'nv-month-items' }, byMonth[m].map((b) => h('div', { class: 'st-item' + (b.key === BT.store.sessionId ? ' on' : '') }, [
        h('a', { class: 'st-open', title: b.guid ? 'GUID do book: ' + b.guid : null, href: BT.url.href({ cliente: b.clienteSlug, ano: b.ano, mes: b.mes, area: b.areaSlug }), onclick: (e) => { e.preventDefault(); openBook(BT.api.keyOf(b.key)); } }, [
          h('b', {}, [b.area, b.key === BT.store.sessionId ? h('span', { class: 'nv-open-tag' }, 'aberto') : null]), h('span', {}, `${MONTHS()[Number(b.mes) - 1]}/${b.ano}${b.template ? ' · template ' + b.template : ''}`), h('small', {}, 'editado ' + ago(b.updatedAt)),
          editing[b.key] && !editing[b.key].mine ? h('span', { class: 'nv-lock-tag', title: `Desde ${new Date(editing[b.key].since).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` }, `🔒 ${editing[b.key].owner.sameUser ? 'Você (outra aba)' : editing[b.key].owner.name} editando · ativo ${BT.lock.ago(editing[b.key].lastActive)}`) : null
        ]),
        h('button', { class: 'mini-btn', title: 'Criar o próximo mês a partir deste', 'aria-label': 'Criar o próximo mês a partir deste', onclick: () => nextMonth(b) }, '⧉'),
        h('button', { class: 'mini-btn', title: 'Excluir', 'aria-label': `Excluir o book ${b.area} de ${MONTHS()[Number(b.mes) - 1]}`, onclick: async () => {
          if (!(await BT.ui.modal.confirm(`Excluir o book ${b.cliente} · ${MONTHS()[Number(b.mes) - 1]}/${b.ano} · ${b.area}? ${trashNote()}`, { danger: true, okText: 'Excluir' }))) return;
          await SS().remove(b.key); if (b.key === BT.store.sessionId) BT.store.load(BT.data.blankTemplate(), null);
          show({ cliente: client.slug, ano });
        } }, '🗑')
      ])))
    ])));

    return h('div', { class: 'nv-body' }, [
      h('div', { class: 'nv-client-h' }, [
        avatar(client.nome, true),
        h('div', { style: { flex: 1, minWidth: '180px' } }, [h('h1', { class: 'st-title' }, client.nome), h('div', { class: 'st-sub' }, `${all.length} book${all.length === 1 ? '' : 's'} técnico${all.length === 1 ? '' : 's'}${client.areas && client.areas.length ? ' · ' + client.areas.join(', ') : ''}`), client.guid ? h('div', { class: 'nv-guid mono', title: 'Identificador único do cliente' }, 'GUID ' + client.guid) : null]),
        BT.api.mode === 'server' ? h('button', { class: 'btn btn-sec btn-sm', onclick: () => BT.importer.cloud.connections(client.slug, client.nome) }, '🔑 Conexões (clouds · Zabbix · GLPI)') : null,
        BT.api.mode === 'server' && !BT.api.local ? h('button', { class: 'btn btn-sec btn-sm', title: 'Gerar o book todo mês, salvar na pasta da rede e enviar por e-mail', onclick: () => BT.editor.automation.open(client) }, '🤖 Book automático') : null,
        h('button', { class: 'btn btn-ghost btn-sm nv-danger', title: 'Excluir o cliente com todos os anos e books', onclick: () => deleteClient(Object.assign({}, client, { books: all.length, anos: [...new Set(all.map((b) => b.ano))] })) }, '🗑 Excluir cliente'),
        h('button', { class: 'btn btn-primary btn-sm', onclick: () => newBook({ cliente: client.nome, ano }, all) }, '＋ Novo book')
      ]),
      tabs, list
    ]);
  }

  async function nextMonth(b) {
    let m = Number(b.mes) + 1, a = Number(b.ano); if (m > 12) { m = 1; a++; }
    const target = { cliente: b.cliente, ano: String(a), mes: String(m).padStart(2, '0'), area: b.area };
    if (await BT.api.getBook(target)) return BT.ui.toast(`Já existe ${b.area} em ${MONTHS()[m - 1]}/${a}.`, { type: 'err' });
    // padrão = copiar tudo, igual ao book automático (a sincronização do mês substitui o que vem das clouds/ferramentas);
    // "só estrutura" deixa planilhas, imagens e KPIs vazios
    const mode = await new Promise((resolve) => {
      const md = BT.ui.modal.open({
        title: '⧉ Criar o próximo mês', size: 'sm',
        body: [h('p', {}, `Criar ${b.cliente} · ${MONTHS()[m - 1]}/${a} · ${b.area} a partir deste book.`),
          h('div', { class: 'cx-help' }, 'Copiar tudo: mantém equipe, ferramentas, escopo, planilhas e imagens; ao sincronizar, os dados das clouds e ferramentas são substituídos pelos do novo mês (é o que o book automático faz). Só estrutura e textos: planilhas, imagens e KPIs começam vazios.')],
        footer: [h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { md.close(); resolve(null); } }, 'Cancelar'), h('span', { class: 'spacer' }),
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { md.close(); resolve('structure'); } }, 'Só estrutura e textos'),
          h('button', { class: 'btn btn-primary btn-sm', onclick: () => { md.close(); resolve('all'); } }, 'Copiar tudo')]
      });
    });
    if (!mode) return;
    const src = await SS().get(b.key);
    const { id, state } = await SS().create(target, SS().copyState(src, mode), src.template);
    openLoaded(id, state);
  }

  // ── Novo book (template + identificação) ────────────────
  async function newBook(pre = {}, clientBooks = []) {
    const now = new Date();
    const templates = await BT.data.templates.all();
    let defaultTpl = 'infracloud';
    try { defaultTpl = (await BT.api.getSettings()).defaults.template || defaultTpl; } catch (e) {}
    // área vinda da URL (slug) → nome legível + template correspondente (ex.: backup → "Backup")
    let tplId = templates.some((t) => t.id === defaultTpl) ? defaultTpl : 'infracloud';
    if (pre.area) {
      const t = templates.find((x) => BT.api.slug(x.area || x.name) === BT.api.slug(pre.area));
      const a = SS().AREAS.find((x) => BT.api.slug(x) === BT.api.slug(pre.area));
      if (t) tplId = t.id;
      pre.area = (t && t.area) || a || pre.area;
    }
    const F = { cliente: pre.cliente || '', ano: pre.ano || String(now.getFullYear()), mes: pre.mes || String(now.getMonth() + 1).padStart(2, '0'), area: pre.area || '', tpl: tplId, areaTouched: !!pre.area, copyFrom: '', copyMode: 'structure', sync: false };
    if (!clientBooks.length && F.cliente) clientBooks = await BT.api.listBooks({ cliente: F.cliente });
    let conns = null;
    if (BT.api.mode === 'server' && F.cliente) { try { conns = await BT.api.getConnections(F.cliente); } catch (e) {} }
    const configured = conns ? Object.entries(conns.providers || {}).filter(([, c]) => c && c.enabled !== false).map(([p]) => p) : [];

    const areaIn = h('input', { class: 'inp', list: 'dl-areas-nb', value: F.area, placeholder: 'ex.: InfraCloud', oninput: (e) => { F.area = e.target.value; F.areaTouched = true; } });
    const tplGrid = h('div', { class: 'tpl-grid' });
    const drawTpl = () => {
      tplGrid.innerHTML = '';
      templates.forEach((t) => tplGrid.appendChild(h('button', { type: 'button', class: 'tpl' + (t.id === F.tpl ? ' on' : ''), onclick: () => {
        F.tpl = t.id; if (!F.areaTouched && t.area) { F.area = t.area; areaIn.value = t.area; } drawTpl();
      } }, [h('span', { class: 'tpl-ic' }, t.icon), h('b', {}, t.name), h('small', {}, t.desc)])));
    };
    if (!F.area) { F.area = (templates.find((t) => t.id === F.tpl) || {}).area || 'InfraCloud'; areaIn.value = F.area; }
    drawTpl();

    const y = now.getFullYear();
    const copySel = h('select', { class: 'inp inp-sm', onchange: (e) => (F.copyFrom = e.target.value) }, [h('option', { value: '' }, '— não copiar —'), ...clientBooks.map((b) => h('option', { value: b.key }, `${MONTHS()[Number(b.mes) - 1]}/${b.ano} · ${b.area}`))]);
    const fields = h('div', { class: 'fg fg4' }, [
      h('div', { class: 'fd' }, [h('label', {}, 'Cliente'), h('input', { class: 'inp', value: F.cliente, list: 'dl-clientes-nb', readonly: !!pre.cliente, oninput: (e) => (F.cliente = e.target.value) }),
        h('datalist', { id: 'dl-clientes-nb' }, clientsCache.map((c) => h('option', { value: c.nome })))]),
      h('div', { class: 'fd' }, [h('label', {}, 'Ano'), h('select', { class: 'inp', onchange: (e) => (F.ano = e.target.value) }, [y - 2, y - 1, y, y + 1].map((v) => h('option', { value: String(v), selected: String(v) === F.ano }, String(v))))]),
      h('div', { class: 'fd' }, [h('label', {}, 'Mês'), h('select', { class: 'inp', onchange: (e) => (F.mes = e.target.value) }, MONTHS().map((n, i) => h('option', { value: String(i + 1).padStart(2, '0'), selected: Number(F.mes) === i + 1 }, n)))]),
      h('div', { class: 'fd' }, [h('label', {}, 'Área técnica'), areaIn, h('datalist', { id: 'dl-areas-nb' }, SS().AREAS.map((a) => h('option', { value: a })))])
    ]);

    const create = async (fromZip) => {
      const meta = { cliente: F.cliente.trim(), ano: F.ano, mes: F.mes, area: F.area.trim() };
      if (!meta.cliente || !meta.area) return BT.ui.toast('Informe cliente e área técnica.', { type: 'err' });
      const exists = await BT.api.getBook(meta);
      if (exists) {
        if (await BT.ui.modal.confirm(`Já existe o book ${SS().label(meta)}. Abrir o existente?`, { okText: 'Abrir' })) { m.close(); openBook(BT.api.keyOf(meta)); }
        return;
      }
      let base;
      if (F.copyFrom) base = SS().copyState(await SS().get(F.copyFrom), F.copyMode);
      else base = await BT.data.templates.build(F.tpl);
      m.close();
      if (fromZip) return BT.importer.zip.pick({ meta, base, template: F.tpl });
      const { id, state } = await SS().create(meta, base, F.copyFrom ? base.template : F.tpl);
      openLoaded(id, state);
      if (F.sync) setTimeout(() => BT.importer.cloud.sync({ providers: configured }), 300);
    };

    const m = BT.ui.modal.open({
      title: '＋ Novo book técnico', size: 'lg',
      body: [
        fields,
        h('div', { class: 'lbl', style: { margin: '18px 0 8px' } }, 'Template'),
        tplGrid,
        clientBooks.length ? h('div', { class: 'nb-copy' }, [h('span', { class: 'lbl' }, 'Ou copiar de um book anterior'), copySel,
          h('select', { class: 'inp inp-sm', onchange: (e) => (F.copyMode = e.target.value) }, [h('option', { value: 'structure' }, 'Estrutura e textos'), h('option', { value: 'all' }, 'Tudo (inclusive dados)')])]) : null,
        configured.length ? h('label', { class: 'switch', style: { marginTop: '14px' } }, [h('input', { type: 'checkbox', onchange: (e) => (F.sync = e.target.checked) }), `Puxar dados da cloud ao criar (${configured.map((p) => BT.data.providers[p].label).join(', ')})`]) : null
      ],
      footer: [
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => m.close() }, 'Cancelar'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-sec btn-sm', onclick: () => create(true) }, '📦 Criar a partir de ZIP'),
        h('button', { class: 'btn btn-primary btn-sm', onclick: () => create(false) }, 'Criar e editar →')
      ]
    });
  }

  // ── Abrir book ──────────────────────────────────────────
  async function openBook(k, opts = {}) {
    await BT.store.saveNow();
    const key = BT.api.keyOf(k);
    const st = await SS().get(key.id);
    if (!st) {
      BT.ui.toast('Este book ainda não existe — preencha os dados para criá-lo.');
      await show({ cliente: key.cliente, ano: key.ano }, { replace: true });
      const c = clientsCache.find((x) => x.slug === key.cliente);
      return newBook({ cliente: c ? c.nome : key.cliente, ano: key.ano, mes: key.mes, area: key.area });
    }
    if (k.secao) st.ui = Object.assign(st.ui || {}, { route: k.secao });
    openLoaded(key.id, st, opts);
  }

  function openLoaded(id, st, opts = {}) {
    if (BT.auth.lockEnabled) BT.store.readOnly = true; // até confirmar que ninguém está editando
    BT.store.load(st, id);
    BT.lock.enter(id);
    const route = (st.ui && st.ui.route) || 'cover';
    SS().pointer.set(id, route);
    hide();
    BT.url.go(Object.assign({}, BT.api.keyOf(id), { secao: route !== 'cover' ? route : '' }), opts);
    BT.editor.router.go(route);
    BT.emit('session:opened', id);
  }

  function ago(ts) {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'agora'; if (m < 60) return `há ${m} min`;
    const hr = Math.round(m / 60); if (hr < 24) return `há ${hr} h`;
    return 'em ' + new Date(ts).toLocaleDateString('pt-BR');
  }

  // "/" foca a busca de clientes
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || !isOpen() || !focusSearch || !document.contains(focusSearch)) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.querySelector('.modal-wrap')) return;
    e.preventDefault(); focusSearch.focus();
  });

  BT.editor.nav = { show, hide, isOpen, openBook, openLoaded, newBook };
  BT.editor.start = BT.editor.nav; // compatibilidade
})(window.BT);
