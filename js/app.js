/* ═══ Bootstrap do app ═══
 * 1. Detecta o modo: servidor (npm run dev → arquivos em data/) ou navegador (IndexedDB)
 * 2. Lê a URL: ?cliente=…&ano=…&mes=…&area=… abre o book; ?cliente=…&ano=… abre a lista;
 *    sem parâmetros mostra os clientes. Recarregar mantém tudo (URL + cookie + servidor).
 */
(function (BT) {
  const $ = (id) => document.getElementById(id);

  async function start() {
    BT.editor.sidebar.init();
    BT.editor.palette.init();
    BT.book.preview.init();
    wireTopbar(); wireStatus(); wireShortcuts(); wireUnload();
    BT.store.load(BT.data.blankTemplate(), null); // estado vazio até abrir um book

    await BT.api.init();
    if (!(await BT.auth.init())) return; // tela de login aberta: o app começa depois de entrar
    const chip = BT.auth.chip(); if (chip) $('tb-user').appendChild(chip);
    $('sb-ver').textContent = BT.api.version ? 'v' + BT.api.version : '';
    await BT.session.remote.restore();
    await route(BT.url.get(), { replace: true });
    window.addEventListener('popstate', () => route(BT.url.get(), { replace: true }));
  }

  /** Decide a tela a partir da URL. */
  async function route(p, opts) {
    if (BT.url.isBook(p)) {
      const k = BT.api.keyOf(p);
      if (k.id === BT.store.sessionId && !BT.editor.nav.isOpen()) { if (p.secao) BT.editor.router.go(p.secao); return; }
      return BT.editor.nav.openBook(Object.assign(k, { secao: p.secao }), opts);
    }
    return BT.editor.nav.show(p, opts);
  }

  function crumbLabel() {
    const id = BT.store.sessionId, st = BT.store.state;
    if (!id || !st) { $('sess-label').textContent = 'Clientes'; return; }
    const k = BT.api.keyOf(id);
    $('sess-label').textContent = `${st.meta.cliente || k.cliente} › ${k.ano} › ${BT.session.monthShort(k.mes)} · ${st.meta.area || k.area}`;
  }

  function wireTopbar() {
    const cloudAction = (a) => {
      if (a === 'sync') BT.importer.cloud.sync();
      else if (a === 'connections') { if (!BT.store.sessionId) return; BT.importer.cloud.connections(BT.api.keyOf(BT.store.sessionId).cliente, BT.store.state.meta.cliente); }
      else if (a === 'file') BT.importer.wizard.open();
      else if (a === 'zip') BT.importer.zip.pick();
    };
    document.querySelectorAll('#dd-import [data-action]').forEach((b) => b.addEventListener('click', () => cloudAction(b.dataset.action)));
    document.querySelectorAll('#dd-export [data-export]').forEach((b) => b.addEventListener('click', () => {
      const f = b.dataset.export;
      if (f === 'preview') BT.book.preview.open(); else BT.exporters.dialog.open(f);
    }));
    $('btn-session').addEventListener('click', () => { const k = BT.store.sessionId ? BT.api.keyOf(BT.store.sessionId) : {}; BT.editor.nav.show({ cliente: k.cliente, ano: k.ano }); });
    $('btn-menu').addEventListener('click', () => $('app').classList.toggle('sb-open'));
    $('sb-backdrop').addEventListener('click', () => $('app').classList.remove('sb-open'));
    BT.editor.panels.init();
    $('btn-settings').addEventListener('click', () => BT.editor.settings.open());
    document.querySelectorAll('#dd-file [data-action]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.action, P = BT.exporters.project;
      const k = BT.store.sessionId ? BT.api.keyOf(BT.store.sessionId) : {};
      if (a === 'clients') BT.editor.nav.show({ cliente: k.cliente, ano: k.ano });
      else if (a === 'new') BT.editor.nav.show({ cliente: k.cliente, ano: k.ano }).then(() => BT.editor.nav.newBook({ cliente: BT.store.state.meta.cliente || k.cliente, ano: k.ano }));
      else if (a === 'template') P.saveTemplate();
      else if (a === 'zip-template') BT.importer.zip.downloadTemplate();
      else if (a === 'open') P.open();
      else if (a === 'save') P.save();
      else if (a === 'settings') BT.editor.settings.open();
    }));
    $('file-open').addEventListener('change', (e) => { if (e.target.files[0]) BT.exporters.project.load(e.target.files[0]); e.target.value = ''; });
    $('sb-year').textContent = new Date().getFullYear();
    BT.on('store:structure', crumbLabel);
    BT.on('session:opened', crumbLabel);
  }

  function wireStatus() {
    const status = $('tb-status');
    const where = () => {
      if (BT.api.mode !== 'server') return 'Salvo no navegador';
      const k = (BT.api.storage || {}).storage;
      return k === 'mongo' ? 'Salvo no MongoDB' : k === 'sqlite' ? 'Salvo no SQLite' : 'Salvo no servidor';
    };
    const set = (cls, txt, title) => { status.className = 'tb-status ' + cls; status.textContent = txt; status.title = title || txt; };
    let retry = 0, timer = null;
    BT.on('store:saving', () => set('saving', 'Salvando…'));
    BT.on('store:saved', () => { retry = 0; set('ok', where() + ' · ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })); });
    BT.on('store:save-error', (e) => {
      // tenta de novo com espera crescente (5s, 10s, 20s… até 1 min) para não martelar um banco fora do ar
      const wait = Math.min(60000, 5000 * 2 ** retry++);
      set('err', '⚠ Falha ao salvar — nova tentativa em ' + Math.round(wait / 1000) + 's', e && e.message);
      clearTimeout(timer); timer = setTimeout(() => BT.store.scheduleSave(), wait);
    });
  }

  function wireShortcuts() {
    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (e.shiftKey) BT.exporters.project.save();
        else BT.store.saveNow().then(() => BT.ui.toast('Salvo ✓ (Ctrl+Shift+S baixa o .json)', { type: 'ok' }));
      }
      if (mod && e.key.toLowerCase() === 'p' && !$('print-root').innerHTML) { e.preventDefault(); BT.exporters.dialog.open('pdf'); }
    });
  }

  /** Recarregar/fechar: força o último "blur" e grava cópia síncrona + cookie. */
  function wireUnload() {
    const flush = () => { if (document.activeElement && document.activeElement.blur) document.activeElement.dispatchEvent(new Event('blur')); BT.store.flush(); };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  }

  // a página pode ter sido montada depois do DOMContentLoaded (js/core/include.js)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(window.BT);
