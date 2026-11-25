/* ═══ Camada de dados: servidor (npm run dev) ou navegador ═══
 *
 *  - Servidor: books, templates e conexões de cloud num banco — SQLite (padrão) ou MongoDB,
 *              escolhido em ⚙️ Configurações — e sincronização com OCI/AWS/Azure/GCP.
 *  - Navegador (index.html aberto direto, sem servidor): IndexedDB, mesma interface,
 *              sem conexões de cloud.
 *
 * Identificação de um book: { cliente, ano, mes, area } → id "cliente/ano/mes/area" (slugs).
 */
(function (BT) {
  const P = BT.core.persistence;
  const slug = (s) => BT.core.utils.slug(s);

  function keyOf(o) {
    if (typeof o === 'string') { const [cliente, ano, mes, area] = o.split('/'); return { cliente, ano, mes, area, id: o }; }
    const k = { cliente: slug(o.cliente), ano: String(o.ano || ''), mes: String(o.mes || '').padStart(2, '0'), area: slug(o.area) };
    k.id = `${k.cliente}/${k.ano}/${k.mes}/${k.area}`;
    return k;
  }
  const qs = (k) => `cliente=${encodeURIComponent(k.cliente)}&ano=${k.ano}&mes=${k.mes}&area=${encodeURIComponent(k.area)}`;

  async function http(method, url, body) {
    const res = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(data.error || `Erro ${res.status}`); e.status = res.status; e.data = data;
      // sessão de login terminou (expirou, foi encerrada por um admin ou por outro usuário que assumiu o book)
      if (res.status === 401 && !url.startsWith('/api/auth/') && BT.auth) BT.auth.expired(e.message);
      throw e;
    }
    return data;
  }

  // ── Servidor ───────────────────────────────────────────
  const server = {
    listClients: () => http('GET', '/api/clients'),
    listBooks: (f = {}) => http('GET', `/api/books?cliente=${encodeURIComponent(f.cliente || '')}&ano=${f.ano || ''}`),
    async getBook(k) { try { return await http('GET', '/api/book?' + qs(keyOf(k))); } catch (e) { if (e.status === 404) return null; throw e; } },
    saveBook: (k, st) => http('PUT', '/api/book?' + qs(keyOf(k)), st),
    deleteBook: (k) => http('DELETE', '/api/book?' + qs(keyOf(k))),
    listTemplates: () => http('GET', '/api/templates'),
    saveTemplate: (t) => http('PUT', '/api/templates', t),
    deleteTemplate: (id) => http('DELETE', '/api/templates?id=' + encodeURIComponent(id)),
    getConnections: (c) => http('GET', '/api/connections?cliente=' + encodeURIComponent(slug(c))),
    saveConnections: (c, data) => http('PUT', '/api/connections?cliente=' + encodeURIComponent(slug(c)), data),
    cloudTest: (c, provider) => http('POST', '/api/cloud/test?cliente=' + encodeURIComponent(slug(c)), { provider }),
    getSettings: () => http('GET', '/api/settings'),
    saveSettings: (s) => http('PUT', '/api/settings', s),
    switchStorage: (storage, migrate) => http('POST', '/api/settings/storage', { storage, migrate }),
    storageStatus: () => http('GET', '/api/settings/storage'),
    // login
    authMe: () => http('GET', '/api/auth/me'),
    login: (username, password) => http('POST', '/api/auth/login', { username, password }),
    logout: () => http('POST', '/api/auth/logout', {}),
    setupAdmin: (u) => http('POST', '/api/auth/setup', u),
    getAuthConfig: () => http('GET', '/api/auth/config'),
    saveAuthConfig: (c) => http('PUT', '/api/auth/config', c),
    listUsers: () => http('GET', '/api/users'),
    saveUser: (u) => http('PUT', '/api/users', u),
    deleteUser: (id) => http('DELETE', '/api/users?id=' + encodeURIComponent(id)),
    endUserSessions: (id) => http('DELETE', '/api/users/sessions?id=' + encodeURIComponent(id)),
    savePrefs: (p) => http('PUT', '/api/auth/prefs', p),
    graphSync: () => http('POST', '/api/auth/graph/sync', {}),
    graphTest: (config) => http('POST', '/api/auth/graph/test', config || {}),
    // lixeira, logs, backup, excluir banco (admin)
    trash: () => http('GET', '/api/trash'),
    trashRestore: (tid, mode) => http('POST', '/api/trash/restore', { tid, mode }),
    trashPurge: (tid) => http('DELETE', '/api/trash?tid=' + encodeURIComponent(tid)),
    trashSettings: (days) => http('PUT', '/api/trash/settings', { days }),
    // site: URL externa e app desktop
    siteInfo: () => http('GET', '/api/site'),
    siteConfig: () => http('GET', '/api/site/config'),
    saveSiteConfig: (c) => http('PUT', '/api/site/config', c),
    logs: (kind, f = {}) => http('GET', '/api/logs?' + new URLSearchParams(Object.assign({ kind }, f))),
    backupConfig: () => http('GET', '/api/backup/config'),
    saveBackupConfig: (c) => http('PUT', '/api/backup/config', c),
    backupRun: () => http('POST', '/api/backup/run', {}),
    backupTest: (dest, config) => http('POST', '/api/backup/test', { dest, config }),
    async backupRestore(file, password) {
      const res = await fetch('/api/backup/restore', { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-backup-password': password || '' }, body: file });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { const e = new Error(data.error || `Erro ${res.status}`); e.status = res.status; throw e; }
      return data;
    },
    deleteDatabase: (storage, confirm) => http('POST', '/api/settings/storage/delete', { storage, confirm }),
    // bloqueio de edição
    lock: (action, book, extra = {}) => http('POST', '/api/lock', Object.assign({ action, book }, extra)),
    lockStatus: (book) => http('GET', '/api/lock?book=' + encodeURIComponent(book)),
    locks: () => http('GET', '/api/locks'),
    saveMongoConfig: (cfg) => http('PUT', '/api/settings/mongo', cfg),
    testMongo: (cfg) => http('POST', '/api/settings/mongo/test', cfg),
    deleteClient: (c) => http('DELETE', '/api/client?cliente=' + encodeURIComponent(slug(c))),
    deleteYear: (c, ano) => http('DELETE', `/api/year?cliente=${encodeURIComponent(slug(c))}&ano=${encodeURIComponent(ano)}`),
    getSession: (sid) => http('GET', '/api/session?sid=' + encodeURIComponent(sid)),
    saveSession: (sid, data) => http('PUT', '/api/session?sid=' + encodeURIComponent(sid), data),
    cloudPull: (c, provider, kinds, extra = {}) => http('POST', '/api/cloud/pull?cliente=' + encodeURIComponent(slug(c)), Object.assign({ provider, kinds }, extra))
  };

  // ── Navegador (IndexedDB) ──────────────────────────────
  const IDX = 'books-index';
  const entry = (k, st) => ({ key: k.id, clienteSlug: k.cliente, ano: k.ano, mes: k.mes, areaSlug: k.area, cliente: st.meta.cliente || k.cliente, area: st.meta.area || k.area, template: st.template || '', updatedAt: st.savedAt || Date.now(), createdAt: st.createdAt || Date.now() });
  const noCloud = () => { throw new Error('Conexões de cloud exigem o servidor: rode "npm run dev" e acesse http://localhost:5173'); };
  const local = {
    async listClients() {
      const map = {};
      for (const e of (await P.get(IDX)) || []) {
        const c = map[e.clienteSlug] = map[e.clienteSlug] || { slug: e.clienteSlug, nome: e.cliente, books: 0, anos: new Set(), areas: new Set(), updatedAt: 0 };
        c.books++; c.anos.add(e.ano); c.areas.add(e.area); if (e.updatedAt > c.updatedAt) { c.updatedAt = e.updatedAt; c.nome = e.cliente; }
      }
      for (const c of (await P.get('clients-extra')) || []) if (!map[c.slug]) map[c.slug] = { slug: c.slug, nome: c.nome, books: 0, anos: new Set(), areas: new Set(), updatedAt: 0 };
      return Object.values(map).map((c) => Object.assign(c, { anos: [...c.anos].sort().reverse(), areas: [...c.areas] })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    },
    async listBooks(f = {}) { return ((await P.get(IDX)) || []).filter((e) => (!f.cliente || e.clienteSlug === slug(f.cliente)) && (!f.ano || e.ano === String(f.ano))).sort((a, b) => b.updatedAt - a.updatedAt); },
    async getBook(k) { return (await P.get('book:' + keyOf(k).id)) || null; },
    async saveBook(k, st) {
      k = keyOf(k); st.savedAt = Date.now(); st.createdAt = st.createdAt || st.savedAt;
      await P.set('book:' + k.id, st);
      const idx = ((await P.get(IDX)) || []).filter((e) => e.key !== k.id); idx.push(entry(k, st)); await P.set(IDX, idx);
      return { savedAt: st.savedAt };
    },
    async deleteBook(k) { k = keyOf(k); await P.del('book:' + k.id); await P.set(IDX, ((await P.get(IDX)) || []).filter((e) => e.key !== k.id)); },
    async deleteYear(c, ano) {
      const all = (await P.get(IDX)) || [], gone = all.filter((e) => e.clienteSlug === slug(c) && e.ano === String(ano));
      for (const e of gone) await P.del('book:' + e.key);
      await P.set(IDX, all.filter((e) => !gone.includes(e)));
      return { books: gone.length };
    },
    async deleteClient(c) {
      const all = (await P.get(IDX)) || [], gone = all.filter((e) => e.clienteSlug === slug(c));
      for (const e of gone) await P.del('book:' + e.key);
      await P.set(IDX, all.filter((e) => !gone.includes(e)));
      await P.set('clients-extra', ((await P.get('clients-extra')) || []).filter((x) => x.slug !== slug(c)));
      return { books: gone.length };
    },
    async getSession() { return null; },
    async saveSession() {},
    async listTemplates() { return (await P.get('templates')) || []; },
    async saveTemplate(t) { const id = slug(t.id || t.name); const l = ((await P.get('templates')) || []).filter((x) => x.id !== id); l.push(Object.assign({}, t, { id, createdAt: Date.now() })); await P.set('templates', l); return { id }; },
    async deleteTemplate(id) { await P.set('templates', ((await P.get('templates')) || []).filter((x) => x.id !== id)); },
    async getConnections(c) { return { nome: c, providers: {} }; },
    async saveConnections(c, data) { const l = ((await P.get('clients-extra')) || []).filter((x) => x.slug !== slug(c)); l.push({ slug: slug(c), nome: data.nome || c }); await P.set('clients-extra', l); },
    async getSettings() {
      const s = (await P.get('settings')) || {};
      return { storage: 'browser', defaults: Object.assign({ template: 'infracloud', disabled: {}, extraGroups: [], comparativo: true }, s.defaults || {}),
        storageInfo: { storage: 'browser', label: 'Navegador (IndexedDB)', lockedByEnv: true, options: [] } };
    },
    async saveSettings(body) { const s = (await P.get('settings')) || {}; s.defaults = Object.assign({}, s.defaults || {}, body.defaults || {}); await P.set('settings', s); return local.getSettings(); },
    switchStorage: () => { throw new Error('SQLite e MongoDB exigem o servidor: rode "npm run dev" ou o container.'); },
    storageStatus: async () => (await local.getSettings()).storageInfo,
    authMe: async () => ({ enabled: false, needsSetup: false, user: null, saml: { enabled: false }, lock: { enabled: false } }),
    locks: async () => [],
    saveMongoConfig: () => { throw new Error('MongoDB exige o servidor.'); },
    testMongo: () => { throw new Error('MongoDB exige o servidor.'); },
    cloudTest: noCloud, cloudPull: noCloud
  };

  const A = {
    mode: 'local',
    keyOf, slug,
    async init() {
      if (/^https?:$/.test(location.protocol)) {
        try { const h = await (await fetch('/api/health', { cache: 'no-store' })).json(); if (h && h.mode === 'server') { A.mode = 'server'; A.providers = h.providers || []; A.storage = h.storage || null; A.version = h.version || ''; } } catch (e) { /* sem servidor */ }
      }
      Object.assign(A, A.mode === 'server' ? server : local);
      if (A.mode === 'local') await migrateOldSessions();
      return A.mode;
    }
  };

  /** Versão anterior guardava "sessões" no IndexedDB: converte em books. */
  async function migrateOldSessions() {
    const old = (await P.get('sessions')) || [];
    const single = await P.get('state');
    if (single) old.push({ id: '__state__', _st: single });
    for (const s of old) {
      const st = s._st || (await P.get('session:' + s.id)); if (!st || !st.meta) continue;
      const m = st.meta;
      const k = keyOf({ cliente: m.cliente || 'sem-cliente', ano: m.ano || new Date().getFullYear(), mes: m.mes || '01', area: m.area || 'infracloud' });
      if (!(await local.getBook(k))) await local.saveBook(k, st);
      if (s.id !== '__state__') await P.del('session:' + s.id);
    }
    if (old.length) { await P.del('sessions'); await P.del('state'); }
  }

  BT.api = A;
})(window.BT);
