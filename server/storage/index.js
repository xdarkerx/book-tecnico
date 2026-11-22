/* ═══ Armazenamento ativo + configurações globais ═══
 * Dois bancos: "sqlite" (arquivo local, padrão) e "mongo" (MongoDB).
 * Escolha:
 *   1. variável BOOK_STORAGE (sqlite | mongo) — fixa, a tela não troca;
 *   2. data/settings.json → { storage } — trocado em ⚙️ Configurações (com migração).
 * data/settings.json guarda também a conexão do MongoDB definida na tela (MONGO_URL/MONGO_DB têm prioridade)
 * e as configurações globais (que também vão para o banco ativo).
 * Dados de versões antigas em arquivos (data/books, …) são importados uma vez na inicialização.
 * Funções podem ser síncronas (SQLite) ou assíncronas (MongoDB): use sempre await.
 */
const path = require('path');
const { DATA, httpError, writeJson, readJson, maskUrl } = require('./common');

const backends = { sqlite: () => require('./sqlite'), mongo: () => require('./mongo') };
const OPTIONS = [['sqlite', 'SQLite (banco local)'], ['mongo', 'MongoDB']];
const SETTINGS = path.join(DATA, 'settings.json');
const DEF = { template: 'infracloud', disabled: {}, extraGroups: [], comparativo: true };

const readFileSettings = () => readJson(SETTINGS, {});
const writeFileSettings = (patch) => writeJson(SETTINGS, Object.assign(readFileSettings(), patch), 0o600); // pode conter a senha do Mongo
/** "file" (versões antigas) vira "sqlite": os arquivos são importados na inicialização. */
const normalize = (k) => (k === 'file' ? 'sqlite' : backends[k] ? k : null);
const envStorage = () => normalize(process.env.BOOK_STORAGE);
const currentKind = () => envStorage() || normalize(readFileSettings().storage) || 'sqlite';
/** Toda gravação passa por aqui e vira uma linha do log "db" (operação, alvo, banco, tempo, erro). */
const WRITES = new Set(['saveBook', 'deleteBook', 'deleteClient', 'deleteYear', 'saveTemplate', 'deleteTemplate', 'saveConnections', 'saveDefaults', 'kvSet', 'kvDel', 'drop']);
const QUIET = new Set(['locks', 'auth_sessions']); // sinais de vida e sessões: barulho demais
function describe(op, a) {
  if (op === 'kvSet' || op === 'kvDel') return `${a[0]}/${a[1]}`;
  const p = a[0];
  if (p && typeof p === 'object' && p.cliente) return [p.cliente, p.ano, p.mes, p.area].filter(Boolean).join('/');
  if (op === 'saveTemplate') return (p && (p.id || p.name)) || '';
  return a.filter((x) => typeof x === 'string').join('/');
}
const proxies = new WeakMap();
function logged(b) {
  if (proxies.has(b)) return proxies.get(b);
  const p = new Proxy(b, { get(t, prop) {
    const fn = t[prop];
    if (typeof fn !== 'function' || !WRITES.has(prop)) return fn;
    return (...args) => {
      if ((prop === 'kvSet' || prop === 'kvDel') && QUIET.has(args[0])) return fn.apply(t, args);
      const t0 = Date.now();
      const done = (err) => require('../logs').db({ op: prop, target: describe(prop, args), backend: t.kind, ms: Date.now() - t0, ok: !err, error: err ? err.message : undefined });
      try {
        const r = fn.apply(t, args);
        if (r && typeof r.then === 'function') return r.then((x) => { done(); return x; }, (e) => { done(e); throw e; });
        done(); return r;
      } catch (e) { done(e); throw e; }
    };
  } });
  proxies.set(b, p);
  return p;
}
const current = () => logged(backends[currentKind()]());
const mongo = () => backends.mongo();
const applyMongoConfig = () => mongo().configure(readFileSettings().mongo || {});
applyMongoConfig();

/** Coleções simples copiadas na troca de banco e no backup (além de users). Cada item tem _id. */
const KV_COPY = ['trash', 'trash_books', 'entities'];
/** Copia books, templates, conexões e sessões de um armazenamento para outro. */
async function migrate(from, to) {
  let books = 0, templates = 0, conns = 0, sessions = 0;
  for (const b of await from.dumpBooks()) {
    const [cliente, ano, mes, area] = b.key.split('/');
    b.state._keepSavedAt = true;
    await to.saveBook({ cliente, ano, mes, area }, b.state); books++;
  }
  for (const t of await from.listTemplates()) { await to.saveTemplate(t); templates++; }
  for (const c of await from.listConnectionClients()) { await to.saveConnections(c, await from.getConnections(c)); conns++; }
  if (from.dumpSessions && to.saveSession) for (const s of await from.dumpSessions()) { if (s && s.sid) { await to.saveSession(s.sid, s); sessions++; } }
  let users = 0;
  if (from.kvList && to.kvSet) {
    for (const u of await from.kvList('users')) { await to.kvSet('users', u.id, u); users++; }
    for (const c of KV_COPY) for (const x of await from.kvList(c)) if (x && x._id) await to.kvSet(c, x._id, x);
  }
  return { books, templates, connections: conns, sessions, users };
}

const S = {
  get api() { return current(); },
  kind: currentKind,
  info() {
    const b = current();
    return { storage: currentKind(), label: b.label, location: b.location, lockedByEnv: !!envStorage(), options: OPTIONS, mongo: mongo().config() };
  },
  /** Estado do banco ativo: conectado? quantos registros? (não lança erro) */
  async status() {
    const out = S.info();
    try { await current().ping(); out.connected = true; out.counts = await current().counts(); }
    catch (e) { out.connected = false; out.error = e.message; }
    return out;
  },
  async getSettings() {
    let defaults = readFileSettings().defaults || {};
    try { defaults = (await current().getDefaults()) || defaults; } catch (e) { /* banco fora do ar: usa o arquivo */ }
    return { storage: currentKind(), defaults: Object.assign({}, DEF, defaults), storageInfo: await S.status() };
  },
  async saveSettings(body) {
    const s = await S.getSettings();
    const defaults = Object.assign({}, s.defaults, (body && body.defaults) || {});
    writeFileSettings({ defaults });
    await current().saveDefaults(defaults);
    return S.getSettings();
  },
  /** Conexão do MongoDB definida na tela. URL mascarada (***) = manter a senha atual. */
  saveMongoConfig({ url, db } = {}) {
    const old = readFileSettings().mongo || {};
    const next = { url: String(url || '').trim(), db: String(db || '').trim() };
    if (next.url.includes('//***@')) next.url = old.url || '';
    if (next.url && !/^mongodb(\+srv)?:\/\//.test(next.url)) throw httpError(400, 'Endereço inválido: use mongodb://… ou mongodb+srv://…');
    if (next.db && !/^[A-Za-z0-9_-]{1,63}$/.test(next.db)) throw httpError(400, 'Nome do banco inválido (letras, números, _ e -).');
    writeFileSettings({ mongo: next });
    applyMongoConfig();
    return mongo().config();
  },
  async testMongo({ url, db } = {}) {
    let u = String(url || '').trim();
    if (!u || u.includes('//***@')) u = (readFileSettings().mongo || {}).url || process.env.MONGO_URL || '';
    await mongo().test(u || undefined, String(db || '').trim() || undefined);
    return { ok: true, url: maskUrl(u) || mongo().config().url };
  },
  async switchStorage(to, doMigrate = true) {
    if (envStorage()) throw httpError(409, `Armazenamento fixado pela variável BOOK_STORAGE=${envStorage()}.`);
    if (!backends[to]) throw httpError(400, 'Armazenamento desconhecido: use sqlite ou mongo.');
    const fromKind = currentKind();
    if (fromKind === to) return { storage: to, migrated: null };
    const target = logged(backends[to]());
    await target.ping(); // confere a conexão antes de trocar
    const migrated = doMigrate ? await migrate(backends[fromKind](), target) : null;
    writeFileSettings({ storage: to });
    const f = readFileSettings();
    if (f.defaults) await target.saveDefaults(Object.assign({}, DEF, f.defaults));
    return { storage: to, migrated };
  },
  /** Na inicialização: importa (uma vez) os dados antigos em arquivos para o banco ativo, se ele estiver vazio. */
  async bootstrap() {
    const b = current();
    await b.ping();
    const f = readFileSettings();
    if (f.storage === 'file') writeFileSettings({ storage: 'sqlite' });
    if (f.legacyImported || (f.mongoImported && currentKind() === 'mongo')) return null;
    const legacy = require('./legacy-files');
    if (!legacy.hasData()) return null;
    const migrated = (await b.counts()).books === 0 ? await migrate(legacy, b) : null;
    writeFileSettings({ legacyImported: true });
    return migrated;
  },
  /** Fecha as conexões (desligamento do servidor). */
  async close() { for (const k of Object.keys(backends)) { try { await backends[k]().close(); } catch (e) { /* nada */ } } },
  backend: (kind) => (backends[kind] ? logged(backends[kind]()) : null),
  KINDS: Object.keys(backends), KV_COPY, migrate, logged,
  /** data/settings.json (login, SAML, bloqueio de edição também ficam aqui). */
  readFileSettings, writeFileSettings,
  DATA
};
module.exports = S;
