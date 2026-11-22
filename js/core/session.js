/* ═══ Book aberto: identificação, cookie, cópia de segurança ═══
 * Um book = cliente + ano + mês + área técnica  (id "cliente/ano/mes/area").
 *  - Conteúdo         → servidor (npm run dev) ou IndexedDB  — ver js/core/api.js
 *  - Book aberto/tela → URL (?cliente=…&ano=…&mes=…&area=…) + cookie 'bt_book' / 'bt_route'
 *  - Cópia síncrona   → localStorage ao recarregar/fechar (protege o que acabou de ser digitado)
 * Cookies têm ~4 KB: guardam só a identificação; o conteúdo vai para o servidor.
 */
(function (BT) {
  const BACKUP = 'book-tecnico:backup';
  const PTR = 'book-tecnico:pointer';
  const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const AREAS = ['InfraCloud', 'Network', 'Backup', 'Banco de Dados', 'Segurança', 'Aplicações / Middleware', 'Monitoramento'];

  const cookie = {
    get(name) { const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : ''; },
    set(name, value, days = 365) { try { document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${days * 86400}; path=/; SameSite=Lax`; } catch (e) {} },
    del(name) { try { document.cookie = `${name}=; max-age=0; path=/`; } catch (e) {} }
  };
  const pointer = {
    get() {
      const id = cookie.get('bt_book');
      if (id) return { id, route: cookie.get('bt_route') };
      try { return JSON.parse(localStorage.getItem(PTR)) || {}; } catch (e) { return {}; }
    },
    set(id, route) {
      cookie.set('bt_book', id); if (route) cookie.set('bt_route', route);
      try { localStorage.setItem(PTR, JSON.stringify({ id, route })); } catch (e) {}
      remote.push({ book: id, route: route || '' });
    },
    clear() { cookie.del('bt_book'); cookie.del('bt_route'); try { localStorage.removeItem(PTR); } catch (e) {} remote.push({ book: '', route: '' }); }
  };

  /** Sessão do navegador também gravada no servidor (arquivos, SQLite ou MongoDB), além do cookie.
   *  Identificada pelo cookie 'bt_sid'. Se o cookie do book se perder, a sessão é recuperada do servidor. */
  const remote = {
    sid() {
      let s = cookie.get('bt_sid');
      if (!s) { s = 'sid' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); cookie.set('bt_sid', s, 400); }
      return s;
    },
    _t: null, _last: null,
    push(data) {
      if (!BT.api || BT.api.mode !== 'server') return;
      remote._last = Object.assign({ url: location.pathname + location.search }, data);
      clearTimeout(remote._t);
      remote._t = setTimeout(() => BT.api.saveSession(remote.sid(), remote._last).catch(() => {}), 800);
    },
    async restore() {
      if (!BT.api || BT.api.mode !== 'server') return null;
      try {
        const s = await BT.api.getSession(remote.sid());
        if (s && s.book && !cookie.get('bt_book')) { cookie.set('bt_book', s.book); if (s.route) cookie.set('bt_route', s.route); }
        return s;
      } catch (e) { return null; }
    }
  };

  const S = {
    MONTHS, AREAS, cookie, pointer, remote,
    monthShort: (m) => (MONTHS[Number(m) - 1] || '—').slice(0, 3),
    label(m) { return `${m.cliente || 'Sem cliente'} · ${MONTHS[Number(m.mes) - 1] || '—'}/${m.ano || '—'}${m.area ? ' · ' + m.area : ''}`; },

    async get(id) {
      let st = await BT.api.getBook(id);
      try {
        const bk = JSON.parse(localStorage.getItem(BACKUP) || 'null');
        if (bk && bk.id === id && bk.state && (!st || (bk.state.savedAt || 0) > (st.savedAt || 0))) st = bk.state;
      } catch (e) {}
      return st;
    },
    async save(id, st) {
      st.savedAt = Date.now();
      await BT.api.saveBook(id, st);
      try { const bk = JSON.parse(localStorage.getItem(BACKUP) || 'null'); if (bk && bk.id === id) localStorage.removeItem(BACKUP); } catch (e) {}
    },
    backupNow(id, st) {
      if (!id || !st) return;
      st.savedAt = Date.now();
      try { localStorage.setItem(BACKUP, JSON.stringify({ id, state: st })); }
      catch (e) { /* cota estourada (muitas imagens): o salvamento normal cobre */ }
    },

    /** Cria um book. meta precisa de cliente, ano, mes, area. */
    async create(meta, base, templateId) {
      const k = BT.api.keyOf(meta);
      if (!k.cliente || !k.area || !/^\d{4}$/.test(k.ano)) throw new Error('Informe cliente, ano, mês e área técnica.');
      const st = BT.store.migrate(base || BT.data.defaultTemplate());
      Object.assign(st.meta, meta);
      st.template = templateId || st.template || '';
      st.createdAt = Date.now();
      st.ui = st.ui && st.ui.route && st.ui.route !== 'cover' ? st.ui : { route: 'cover' };
      await S.save(k.id, st);
      return { id: k.id, state: st };
    },
    async remove(id) { await BT.api.deleteBook(id); if (pointer.get().id === id) pointer.clear(); },

    /** Copia um estado. mode 'structure' limpa planilhas, imagens e KPIs (mantém textos). */
    copyState(src, mode) {
      const st = BT.core.utils.clone(src);
      st.groups.forEach((g) => { g.id = BT.uid('grp'); g.sections.forEach((s) => { s.id = BT.uid('sec'); s.blocks.forEach((b) => {
        b.id = BT.uid('blk');
        if (b.type === 'compare') { b.data.prev = null; b.data.against = null; } // o comparativo é relativo ao mês do book
        if (mode !== 'structure') return;
        if (b.type === 'table') { b.data.rows = [b.data.columns.map(() => '')]; b.data.note = ''; }
        if (b.type === 'image') b.data.images = [];
        if (b.type === 'kpi') b.data.items.forEach((i) => (i.value = ''));
      }); }); });
      st.ui = { route: 'cover' };
      return st;
    }
  };
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
  BT.session = S;
})(window.BT);
