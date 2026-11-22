/* ═══ Persistência local (IndexedDB, com fallback em localStorage) ═══
   IndexedDB comporta imagens grandes — localStorage tem limite de ~5 MB. */
(function (BT) {
  const DB = 'book-tecnico', STORE = 'kv';
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      if (!('indexedDB' in window)) return rej(new Error('sem IndexedDB'));
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    return dbp;
  }

  async function tx(mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(STORE, mode);
      const r = fn(t.objectStore(STORE));
      t.oncomplete = () => res(r && r.result);
      t.onerror = () => rej(t.error);
    });
  }

  BT.core.persistence = {
    async get(key) {
      try { return await tx('readonly', (s) => s.get(key)); }
      catch (e) { const v = localStorage.getItem(DB + ':' + key); return v ? JSON.parse(v) : undefined; }
    },
    async set(key, value) {
      try { await tx('readwrite', (s) => s.put(value, key)); }
      catch (e) { localStorage.setItem(DB + ':' + key, JSON.stringify(value)); }
    },
    async del(key) {
      try { await tx('readwrite', (s) => s.delete(key)); } catch (e) { localStorage.removeItem(DB + ':' + key); }
    }
  };
})(window.BT);
