/* ═══ Armazenamento em SQLite (nativo do Node — node:sqlite, Node 22.5+) ═══
 * Arquivo: data/book-tecnico.sqlite (ou BOOK_DB_FILE). Sem dependências externas.
 * Tabelas: books (índice + estado JSON), templates, connections, sessions, settings,
 *          kv (coleções simples: users, auth_sessions, locks).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DATA, slug, keyOf, httpError, clientsFrom, prepareBook, clientSlug, clientYear } = require('./common');

const FILE = () => process.env.BOOK_DB_FILE || path.join(DATA, 'book-tecnico.sqlite');
let db = null;

function open() {
  if (db) return db;
  const prev = process.emitWarning; process.emitWarning = () => {}; // silencia o aviso "experimental"
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); }
  catch (e) { throw httpError(501, `SQLite exige Node 22.5+ (este servidor usa ${process.version}). Use o container, atualize o Node ou use o MongoDB.`); }
  finally { process.emitWarning = prev; }
  db = new DatabaseSync(FILE());
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS books (
      key TEXT PRIMARY KEY, cliente_slug TEXT NOT NULL, ano TEXT NOT NULL, mes TEXT NOT NULL, area_slug TEXT NOT NULL,
      cliente TEXT, area TEXT, template TEXT, updated_at INTEGER, created_at INTEGER, state TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS books_cliente ON books (cliente_slug, ano);
    CREATE INDEX IF NOT EXISTS books_updated ON books (updated_at DESC);
    CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, name TEXT, descr TEXT, created_at INTEGER, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS connections (cliente TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, updated_at INTEGER, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS kv (col TEXT NOT NULL, id TEXT NOT NULL, updated_at INTEGER, data TEXT NOT NULL, PRIMARY KEY (col, id));
  `);
  migrateGuid(db);
  return db;
}
/** Bancos de versões anteriores: cria a coluna guid e dá um GUID a cada book. */
function migrateGuid(d) {
  const cols = d.prepare('PRAGMA table_info(books)').all().map((c) => c.name);
  if (!cols.includes('guid')) d.exec('ALTER TABLE books ADD COLUMN guid TEXT');
  const rows = d.prepare("SELECT key, state FROM books WHERE guid IS NULL OR guid = ''").all();
  if (!rows.length) return;
  const up = d.prepare('UPDATE books SET guid = ?, state = ? WHERE key = ?');
  d.exec('BEGIN');
  for (const r of rows) { const st = JSON.parse(r.state); st.guid = st.guid || crypto.randomUUID(); up.run(st.guid, JSON.stringify(st), r.key); }
  d.exec('COMMIT');
}
const q = (sql) => open().prepare(sql);
const row2entry = (r) => ({ key: r.key, guid: r.guid || '', clienteSlug: r.cliente_slug, ano: r.ano, mes: r.mes, areaSlug: r.area_slug, cliente: r.cliente, area: r.area, template: r.template || '', updatedAt: r.updated_at, createdAt: r.created_at });
const IDX_COLS = 'key, guid, cliente_slug, ano, mes, area_slug, cliente, area, template, updated_at, created_at';
/** Várias escritas numa transação só (tudo ou nada). */
function tx(fn) {
  const d = open(); d.exec('BEGIN');
  try { const r = fn(); d.exec('COMMIT'); return r; } catch (e) { d.exec('ROLLBACK'); throw e; }
}

module.exports = {
  kind: 'sqlite',
  get label() { return 'SQLite (' + path.basename(FILE()) + ')'; },
  get location() { return FILE(); },
  ping() { open().prepare('SELECT 1').get(); return true; },
  close() { if (db) { try { db.close(); } catch (e) { /* já fechado */ } db = null; } },
  /** Apaga o banco inteiro (arquivo + WAL). O próximo uso cria um banco vazio. */
  drop() {
    module.exports.close();
    for (const f of [FILE(), FILE() + '-wal', FILE() + '-shm']) { try { fs.unlinkSync(f); } catch (e) { /* não existe */ } }
    return true;
  },
  exists() { return fs.existsSync(FILE()); },

  listBooks(filter = {}) {
    let sql = `SELECT ${IDX_COLS} FROM books WHERE 1=1`; const args = [];
    if (filter.cliente) { sql += ' AND cliente_slug = ?'; args.push(slug(filter.cliente)); }
    if (filter.ano) { sql += ' AND ano = ?'; args.push(String(filter.ano)); }
    return q(sql + ' ORDER BY updated_at DESC').all(...args).map(row2entry);
  },
  listClients() {
    const entries = q(`SELECT ${IDX_COLS} FROM books`).all().map(row2entry);
    const extra = q('SELECT cliente, data FROM connections').all().map((r) => ({ slug: r.cliente, nome: JSON.parse(r.data).nome }));
    return clientsFrom(entries, extra);
  },
  getBook(params) {
    const r = q('SELECT state FROM books WHERE key = ?').get(keyOf(params).id);
    if (!r) throw httpError(404, 'Book não encontrado.');
    return JSON.parse(r.state);
  },
  saveBook(params, st) {
    const e = prepareBook(params, st);
    q(`INSERT INTO books (${IDX_COLS}, state) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(key) DO UPDATE SET guid=excluded.guid, cliente=excluded.cliente, area=excluded.area, template=excluded.template, updated_at=excluded.updated_at, state=excluded.state`)
      .run(e.key, e.guid, e.clienteSlug, e.ano, e.mes, e.areaSlug, e.cliente, e.area, e.template, e.updatedAt, e.createdAt, JSON.stringify(st));
    return { savedAt: st.savedAt, key: e.key };
  },
  deleteBook(params) { q('DELETE FROM books WHERE key = ?').run(keyOf(params).id); },
  deleteClient(cliente) {
    const c = clientSlug(cliente);
    return tx(() => {
      const r = q('DELETE FROM books WHERE cliente_slug = ?').run(c);
      q('DELETE FROM connections WHERE cliente = ?').run(c);
      return { books: Number(r.changes) };
    });
  },
  deleteYear(cliente, ano) {
    const [c, a] = clientYear(cliente, ano);
    return { books: Number(q('DELETE FROM books WHERE cliente_slug = ? AND ano = ?').run(c, a).changes) };
  },

  getSession(sid) { const r = q('SELECT data FROM sessions WHERE sid = ?').get(slug(sid)); return r ? JSON.parse(r.data) : null; },
  saveSession(sid, data) { q('INSERT INTO sessions (sid, updated_at, data) VALUES (?,?,?) ON CONFLICT(sid) DO UPDATE SET updated_at=excluded.updated_at, data=excluded.data').run(slug(sid), Date.now(), JSON.stringify(data)); },
  dumpSessions() { return q('SELECT data FROM sessions').all().map((r) => JSON.parse(r.data)); },

  listTemplates() { return q('SELECT id, name, descr, created_at, state FROM templates ORDER BY name').all().map((r) => ({ id: r.id, name: r.name, desc: r.descr, createdAt: r.created_at, state: JSON.parse(r.state) })); },
  saveTemplate(t) {
    const id = slug(t.id || t.name); if (!id || !t.state) throw httpError(400, 'Template inválido.');
    q('INSERT INTO templates (id, name, descr, created_at, state) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, descr=excluded.descr, state=excluded.state')
      .run(id, t.name || id, t.desc || '', t.createdAt || Date.now(), JSON.stringify(t.state));
    return { id };
  },
  deleteTemplate(id) { q('DELETE FROM templates WHERE id = ?').run(slug(id)); },

  getConnections(cliente) { const r = q('SELECT data FROM connections WHERE cliente = ?').get(slug(cliente)); return r ? JSON.parse(r.data) : { nome: cliente, providers: {} }; },
  saveConnections(cliente, data) { q('INSERT INTO connections (cliente, data) VALUES (?, ?) ON CONFLICT(cliente) DO UPDATE SET data=excluded.data').run(slug(cliente), JSON.stringify(data)); },
  listConnectionClients() { return q('SELECT cliente FROM connections').all().map((r) => r.cliente); },

  getDefaults() { const r = q("SELECT data FROM settings WHERE id = 'global'").get(); return r ? JSON.parse(r.data).defaults : null; },
  saveDefaults(defaults) { q("INSERT INTO settings (id, data) VALUES ('global', ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(JSON.stringify({ defaults })); },

  // ── coleções simples (usuários, sessões de login, bloqueios de edição) ──
  kvGet(col, id) { const r = q('SELECT data FROM kv WHERE col = ? AND id = ?').get(col, String(id)); return r ? JSON.parse(r.data) : null; },
  kvSet(col, id, data) { q('INSERT INTO kv (col, id, updated_at, data) VALUES (?,?,?,?) ON CONFLICT(col, id) DO UPDATE SET updated_at=excluded.updated_at, data=excluded.data').run(col, String(id), Date.now(), JSON.stringify(data)); },
  kvDel(col, id) { q('DELETE FROM kv WHERE col = ? AND id = ?').run(col, String(id)); },
  kvList(col) { return q('SELECT data FROM kv WHERE col = ?').all(col).map((r) => JSON.parse(r.data)); },

  dumpBooks() { return q('SELECT key, state FROM books').all().map((r) => ({ key: r.key, state: JSON.parse(r.state) })); },
  counts() {
    const n = (t) => Number(q(`SELECT COUNT(*) AS n FROM ${t}`).get().n);
    return { books: n('books'), templates: n('templates'), connections: n('connections') };
  }
};
