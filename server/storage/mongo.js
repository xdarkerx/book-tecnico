/* ═══ Armazenamento em MONGODB ═══
 * Usa o driver oficial (npm install mongodb — já incluso na imagem do container).
 * Conexão: variáveis MONGO_URL / MONGO_DB (têm prioridade) ou ⚙️ Configurações (data/settings.json).
 *   padrão: mongodb://127.0.0.1:27017 · banco book_tecnico
 * Coleções:
 *   books        { _id: "cliente/ano/mes/area", clienteSlug, ano, mes, areaSlug, cliente, area, template, updatedAt, createdAt, state }
 *   templates    { _id: id, name, desc, createdAt, state }
 *   connections  { _id: cliente, nome, providers }      ← credenciais de cloud (somente no servidor)
 *   sessions     { _id: sid, book, route, url, ua, updatedAt }  ← sessões do navegador (além do cookie)
 *   settings     { _id: "global", defaults }            ← ⚙️ Configurações globais
 *   users, auth_sessions, locks  { _id, data }        ← login e bloqueio de edição
 */
const { slug, keyOf, httpError, clientsFrom, prepareBook, clientSlug, clientYear, maskUrl } = require('./common');

const DEFAULT_URL = 'mongodb://127.0.0.1:27017';
const DEFAULT_DB = 'book_tecnico';
let cfg = { url: '', db: '' };       // vindo de ⚙️ Configurações
let client = null, dbp = null;

const URL_ = () => process.env.MONGO_URL || cfg.url || DEFAULT_URL;
const DBNAME = () => process.env.MONGO_DB || cfg.db || DEFAULT_DB;

function driver() {
  try { return require('mongodb'); }
  catch (e) { throw httpError(501, 'Driver do MongoDB não instalado. Rode "npm install" (o container já vem com ele).'); }
}
/** Abre um cliente e confere com ping. Usado na conexão normal e no "Testar conexão". */
async function connect(url, dbName) {
  const { MongoClient } = driver();
  const c = new MongoClient(url, { serverSelectionTimeoutMS: 5000 });
  try { await c.connect(); await c.db(dbName).command({ ping: 1 }); }
  catch (e) {
    try { await c.close(); } catch (x) { /* nada */ }
    // nenhum MongoDB nesta máquina: explica como ter um, em vez de só "ECONNREFUSED"
    const local = /ECONNREFUSED|ECONNRESET|timed out|Server selection/i.test(e.message) && /\/\/([^@/]*@)?(127\.0\.0\.1|localhost)(:27017)?\b/.test(url);
    const hint = local ? ' — não há MongoDB rodando nesta máquina. Use o docker-compose do projeto (já sobe app + MongoDB) ou suba só o banco com: podman run -d --name book-mongo -p 27017:27017 docker.io/library/mongo:7' : '';
    throw httpError(503, `Não foi possível conectar ao MongoDB em ${maskUrl(url)}: ${e.message}${hint}`);
  }
  return c;
}
async function db() {
  if (dbp) return dbp;
  dbp = (async () => {
    client = await connect(URL_(), DBNAME());
    const d = client.db(DBNAME());
    await Promise.all([
      d.collection('books').createIndex({ clienteSlug: 1, ano: 1 }),
      d.collection('books').createIndex({ updatedAt: -1 }),
      d.collection('sessions').createIndex({ updatedAt: -1 })
    ]);
    // books de versões anteriores ganham GUID
    for (const b of await d.collection('books').find({ guid: { $exists: false } }, { projection: { _id: 1, 'state.guid': 1 } }).toArray()) {
      const g = (b.state && b.state.guid) || require('crypto').randomUUID();
      await d.collection('books').updateOne({ _id: b._id }, { $set: { guid: g, 'state.guid': g } });
    }
    return d;
  })();
  dbp.catch(() => { dbp = null; client = null; }); // permite tentar de novo depois de uma falha
  return dbp;
}
async function close() {
  const c = client; client = null; dbp = null;
  if (c && c.close) { try { await c.close(); } catch (e) { /* já fechado */ } }
}
const col = async (n) => (await db()).collection(n);
const IDX = { projection: { state: 0 } };
const toEntry = (d) => ({ key: d._id, guid: d.guid || '', clienteSlug: d.clienteSlug, ano: d.ano, mes: d.mes, areaSlug: d.areaSlug, cliente: d.cliente, area: d.area, template: d.template || '', updatedAt: d.updatedAt, createdAt: d.createdAt });
const upsert = (c, _id, doc) => c.updateOne({ _id }, { $set: doc }, { upsert: true });

module.exports = {
  kind: 'mongo',
  get label() { return `MongoDB (${DBNAME()})`; },
  get location() { return `${maskUrl(URL_())} · ${DBNAME()}`; },
  /** Conexão definida em ⚙️ Configurações. Troca de endereço fecha a conexão atual. */
  configure(next = {}) {
    const n = { url: String(next.url || '').trim(), db: String(next.db || '').trim() };
    if (n.url === cfg.url && n.db === cfg.db) return;
    cfg = n; close();
  },
  config() { return { url: maskUrl(URL_()), db: DBNAME(), fromEnv: { url: !!process.env.MONGO_URL, db: !!process.env.MONGO_DB } }; },
  /** Testa um endereço sem trocar a conexão em uso. */
  async test(url, dbName) { const c = await connect(url || URL_(), dbName || DBNAME()); await c.close(); return true; },
  async ping() { await (await db()).command({ ping: 1 }); return true; },
  close,
  /** Apaga o banco inteiro (dropDatabase). */
  async drop() { await (await db()).dropDatabase(); await close(); return true; },
  async exists() { return true; },

  async listBooks(filter = {}) {
    const q = {};
    if (filter.cliente) q.clienteSlug = slug(filter.cliente);
    if (filter.ano) q.ano = String(filter.ano);
    return (await (await col('books')).find(q, IDX).sort({ updatedAt: -1 }).toArray()).map(toEntry);
  },
  async listClients() {
    const entries = (await (await col('books')).find({}, IDX).toArray()).map(toEntry);
    const extra = (await (await col('connections')).find({}, { projection: { nome: 1 } }).toArray()).map((c) => ({ slug: c._id, nome: c.nome }));
    return clientsFrom(entries, extra);
  },
  async getBook(params) {
    const d = await (await col('books')).findOne({ _id: keyOf(params).id });
    if (!d) throw httpError(404, 'Book não encontrado.');
    return d.state;
  },
  async saveBook(params, st) {
    const e = prepareBook(params, st);
    await upsert(await col('books'), e.key, { guid: e.guid, clienteSlug: e.clienteSlug, ano: e.ano, mes: e.mes, areaSlug: e.areaSlug, cliente: e.cliente, area: e.area, template: e.template, updatedAt: e.updatedAt, createdAt: e.createdAt, state: st });
    return { savedAt: st.savedAt, key: e.key };
  },
  async deleteBook(params) { await (await col('books')).deleteOne({ _id: keyOf(params).id }); },
  async deleteClient(cliente) {
    const c = clientSlug(cliente);
    const r = await (await col('books')).deleteMany({ clienteSlug: c });
    await (await col('connections')).deleteOne({ _id: c });
    return { books: r.deletedCount || 0 };
  },
  async deleteYear(cliente, ano) {
    const [c, a] = clientYear(cliente, ano);
    const r = await (await col('books')).deleteMany({ clienteSlug: c, ano: a });
    return { books: r.deletedCount || 0 };
  },

  async listTemplates() { return (await (await col('templates')).find({}).sort({ name: 1 }).toArray()).map((t) => ({ id: t._id, name: t.name, desc: t.desc, createdAt: t.createdAt, state: t.state })); },
  async saveTemplate(t) {
    const id = slug(t.id || t.name); if (!id || !t.state) throw httpError(400, 'Template inválido.');
    const c = await col('templates');
    const old = await c.findOne({ _id: id }, { projection: { createdAt: 1 } });
    await upsert(c, id, { name: t.name || id, desc: t.desc || '', createdAt: (old && old.createdAt) || t.createdAt || Date.now(), state: t.state });
    return { id };
  },
  async deleteTemplate(id) { await (await col('templates')).deleteOne({ _id: slug(id) }); },

  async getConnections(cliente) {
    const d = await (await col('connections')).findOne({ _id: slug(cliente) });
    return d ? { nome: d.nome, providers: d.providers || {} } : { nome: cliente, providers: {} };
  },
  async saveConnections(cliente, data) { await upsert(await col('connections'), slug(cliente), { nome: data.nome, providers: data.providers || {} }); },
  async listConnectionClients() { return (await (await col('connections')).find({}, { projection: { _id: 1 } }).toArray()).map((d) => d._id); },

  async getSession(sid) { const d = await (await col('sessions')).findOne({ _id: slug(sid) }); if (!d) return null; delete d._id; return d; },
  async saveSession(sid, data) { await upsert(await col('sessions'), slug(sid), data); },
  async dumpSessions() { return (await (await col('sessions')).find({}).toArray()).map((d) => { const o = Object.assign({}, d); o.sid = o.sid || d._id; delete o._id; return o; }); },

  async getDefaults() { const d = await (await col('settings')).findOne({ _id: 'global' }); return d ? d.defaults : null; },
  async saveDefaults(defaults) { await upsert(await col('settings'), 'global', { defaults }); },

  async kvGet(c, id) { const d = await (await col(c)).findOne({ _id: String(id) }); return d ? d.data : null; },
  async kvSet(c, id, data) { await upsert(await col(c), String(id), { data, updatedAt: Date.now() }); },
  async kvDel(c, id) { await (await col(c)).deleteOne({ _id: String(id) }); },
  async kvList(c) { return (await (await col(c)).find({}).toArray()).map((d) => d.data); },

  async dumpBooks() { return (await (await col('books')).find({}).toArray()).map((d) => ({ key: d._id, state: d.state })); },
  async counts() {
    const n = async (c) => (await col(c)).countDocuments({});
    return { books: await n('books'), templates: await n('templates'), connections: await n('connections') };
  },
  /** só para testes */
  _reset() { dbp = null; client = null; }
};
