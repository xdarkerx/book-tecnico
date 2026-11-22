/* ═══ Backup, restauração e exclusão de banco ═══
 * Conteúdo: books, templates, conexões de cloud, usuários, lixeira, GUIDs e menus padrão do banco ativo.
 * Arquivo: JSON compactado (gzip). Com senha: criptografado com AES-256-GCM (chave derivada por scrypt):
 *   "BTBK1" + sal(16) + iv(12) + tag(16) + dados   → extensão .btbk   (sem senha: .json.gz)
 * Destinos (vários ao mesmo tempo): pasta local, caminho de rede (\\servidor\pasta ou pasta montada),
 *   FTP/FTPS (biblioteca basic-ftp) e bucket do OCI Object Storage (URL pré-autenticada ou chave de API).
 * Agendamento diário (HH:MM, horário do servidor) e retenção dos últimos N backups em cada destino.
 * Configuração em data/settings.json → backup (senhas mascaradas na API).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Readable } = require('stream');
const storage = require('./storage');
const logs = require('./logs');
const { DATA, httpError } = require('./storage/common');

const MASK = '••••••••';
const MAGIC = Buffer.from('BTBK1');
const DEF = {
  password: '', keep: 7,
  schedule: { enabled: false, time: '02:00' },
  local: { enabled: true, path: path.join(DATA, 'backups') },
  network: { enabled: false, path: '' },
  ftp: { enabled: false, host: '', port: 21, user: '', password: '', dir: '/book-tecnico', secure: false },
  oci: { enabled: false, mode: 'par', parUrl: '', region: '', namespace: '', bucket: '', prefix: 'book-tecnico/', tenancy: '', user: '', fingerprint: '', keyPem: '' }
};
const SECRETS = [['password'], ['ftp', 'password'], ['oci', 'parUrl'], ['oci', 'keyPem']];

function config() {
  const b = storage.readFileSettings().backup || {};
  const c = JSON.parse(JSON.stringify(DEF));
  for (const k of Object.keys(DEF)) if (b[k] !== undefined) c[k] = typeof DEF[k] === 'object' ? Object.assign(c[k], b[k]) : b[k];
  c.history = b.history || []; c.lastScheduled = b.lastScheduled || '';
  return c;
}
const getPath = (o, p) => p.reduce((x, k) => (x ? x[k] : undefined), o);
const setPath = (o, p, v) => { p.slice(0, -1).reduce((x, k) => x[k], o)[p[p.length - 1]] = v; };
function publicConfig() {
  const c = config();
  for (const p of SECRETS) if (getPath(c, p)) setPath(c, p, MASK);
  return c;
}
function saveConfig(body = {}) {
  const old = config(), c = config();
  for (const k of Object.keys(DEF)) if (body[k] !== undefined) c[k] = typeof DEF[k] === 'object' ? Object.assign(c[k], body[k]) : body[k];
  for (const p of SECRETS) if (getPath(c, p) === MASK) setPath(c, p, getPath(old, p)); // mascarado = manter
  c.keep = Math.min(365, Math.max(1, Number(c.keep) || 7));
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(c.schedule.time)) throw httpError(400, 'Horário do backup inválido (use HH:MM).');
  if (c.ftp.enabled && !c.ftp.host) throw httpError(400, 'Informe o servidor FTP.');
  if (c.network.enabled && !c.network.path) throw httpError(400, 'Informe o caminho de rede.');
  if (c.oci.enabled && c.oci.mode === 'par' && !/^https:\/\/.+\/o\/?$/.test(c.oci.parUrl)) throw httpError(400, 'URL pré-autenticada do bucket inválida (termina em /o/).');
  if (c.oci.enabled && c.oci.mode === 'key' && !(c.oci.region && c.oci.namespace && c.oci.bucket && c.oci.tenancy && c.oci.user && c.oci.fingerprint && c.oci.keyPem)) throw httpError(400, 'OCI: preencha região, namespace, bucket, tenancy, usuário, fingerprint e chave.');
  if (c.schedule.enabled && ![c.local, c.network, c.ftp, c.oci].some((d) => d.enabled)) throw httpError(400, 'Ative pelo menos um destino para o backup agendado.');
  const { history, lastScheduled, ...save } = c;
  storage.writeFileSettings({ backup: Object.assign(save, { history: old.history, lastScheduled: old.lastScheduled }) });
  logs.audit('backup.config', 'Configuração de backup alterada');
  return publicConfig();
}

// ── gerar / ler o arquivo ───────────────────────────────
async function snapshot(b = storage.api, kind = storage.kind()) {
  const kv = {};
  for (const c of ['users', ...storage.KV_COPY]) kv[c] = await b.kvList(c);
  const conns = {};
  for (const c of await b.listConnectionClients()) conns[c] = await b.getConnections(c);
  let defaults = null; try { defaults = await b.getDefaults(); } catch (e) { /* sem */ }
  return { format: 'book-tecnico-backup', version: 1, app: require('../package.json').version, createdAt: Date.now(), storage: kind,
    books: await b.dumpBooks(), templates: await b.listTemplates(), connections: conns, defaults, kv };
}
function pack(obj, password) {
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(obj)));
  if (!password) return gz;
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, 32);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(gz), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), ct]);
}
function unpack(buf, password) {
  let gz = buf;
  if (buf.subarray(0, 5).equals(MAGIC)) {
    if (!password) throw httpError(400, 'Este backup é criptografado: informe a senha.');
    const salt = buf.subarray(5, 21), iv = buf.subarray(21, 33), tag = buf.subarray(33, 49);
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(password, salt, 32), iv); d.setAuthTag(tag);
      gz = Buffer.concat([d.update(buf.subarray(49)), d.final()]);
    } catch (e) { throw httpError(400, 'Senha do backup incorreta (ou arquivo corrompido).'); }
  }
  let obj;
  try { obj = JSON.parse(zlib.gunzipSync(gz).toString('utf8')); } catch (e) { throw httpError(400, 'Arquivo não é um backup do Book Técnico.'); }
  if (obj.format !== 'book-tecnico-backup') throw httpError(400, 'Arquivo não é um backup do Book Técnico.');
  return obj;
}
const stamp = (t = new Date()) => t.toLocaleString('sv-SE').replace(/[-:]/g, '').replace(' ', '-').slice(0, 15); // horário do servidor
const fileName = (enc, tag = '') => `book-tecnico-${stamp()}${tag ? '-' + tag : ''}${enc ? '.btbk' : '.json.gz'}`;
const isBackup = (n) => /^book-tecnico-\d{8}-\d{6}.*\.(btbk|json\.gz)$/.test(n);
/** Só os backups normais entram na retenção (os de segurança — antes de restaurar/excluir — nunca são apagados sozinhos). */
const isRegular = (n) => /^book-tecnico-\d{8}-\d{6}\.(btbk|json\.gz)$/.test(n);

// ── destinos ─────────────────────────────────────────────
const folder = (dir) => ({
  async put(name, buf) { await fs.promises.mkdir(dir, { recursive: true }); await fs.promises.writeFile(path.join(dir, name), buf); return path.join(dir, name); },
  async list() { return (await fs.promises.readdir(dir).catch(() => [])).filter(isBackup).sort(); },
  async del(name) { await fs.promises.unlink(path.join(dir, name)); }
});
async function ftp(c, fn) {
  let FTP;
  try { FTP = require('basic-ftp'); } catch (e) { throw httpError(501, 'Biblioteca de FTP não instalada. Rode "npm install" (o container já vem com ela).'); }
  const cl = new FTP.Client(30000);
  try {
    await cl.access({ host: c.host, port: Number(c.port) || 21, user: c.user || 'anonymous', password: c.password || '', secure: !!c.secure });
    if (c.dir) await cl.ensureDir(c.dir);
    return await fn(cl);
  } finally { cl.close(); }
}
const ftpDest = (c) => ({
  put: (name, buf) => ftp(c, async (cl) => { await cl.uploadFrom(Readable.from(buf), name); return `ftp://${c.host}${(c.dir || '').replace(/\/$/, '')}/${name}`; }),
  list: () => ftp(c, async (cl) => (await cl.list()).map((f) => f.name).filter(isBackup).sort()),
  del: (name) => ftp(c, (cl) => cl.remove(name))
});
/** OCI Object Storage: URL pré-autenticada (PAR) ou chave de API (assinatura HTTP). */
function ociDest(c) {
  const prefix = c.prefix || '';
  if (c.mode === 'par') {
    const base = c.parUrl.replace(/\/?$/, '/');
    return {
      async put(name, buf) { const r = await fetch(base + encodeURIComponent(prefix + name), { method: 'PUT', body: buf, headers: { 'content-type': 'application/octet-stream' } }); if (!r.ok) throw new Error(`OCI ${r.status}: ${(await r.text()).slice(0, 200)}`); return `oci://${prefix}${name}`; },
      async list() { const r = await fetch(base + '?prefix=' + encodeURIComponent(prefix)); if (!r.ok) return null; return ((await r.json()).objects || []).map((o) => o.name.slice(prefix.length)).filter(isBackup).sort(); },
      del: null // PAR não permite excluir: use uma regra de ciclo de vida no bucket
    };
  }
  const cfg = require('./cloud/oci').config({ tenancy: c.tenancy, user: c.user, fingerprint: c.fingerprint, region: c.region, keyPem: c.keyPem });
  const host = `objectstorage.${c.region}.oraclecloud.com`;
  const objUrl = (name) => `https://${host}/n/${encodeURIComponent(c.namespace)}/b/${encodeURIComponent(c.bucket)}/o/${encodeURIComponent(prefix + name)}`;
  async function call(method, url, body) {
    const u = new URL(url);
    const headers = { date: new Date().toUTCString(), host: u.host };
    const signing = `(request-target): ${method.toLowerCase()} ${u.pathname}${u.search}\ndate: ${headers.date}\nhost: ${headers.host}`;
    headers.authorization = `Signature version="1",keyId="${cfg.tenancy}/${cfg.user}/${cfg.fingerprint}",algorithm="rsa-sha256",headers="(request-target) date host",signature="${crypto.sign('sha256', Buffer.from(signing), cfg.key).toString('base64')}"`;
    if (body) headers['content-type'] = 'application/octet-stream';
    const r = await fetch(url, { method, headers, body });
    if (!r.ok) throw new Error(`OCI ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r;
  }
  return {
    async put(name, buf) { await call('PUT', objUrl(name), buf); return `oci://${c.bucket}/${prefix}${name}`; },
    async list() { const r = await call('GET', `https://${host}/n/${encodeURIComponent(c.namespace)}/b/${encodeURIComponent(c.bucket)}/o?prefix=${encodeURIComponent(prefix)}`); return ((await r.json()).objects || []).map((o) => o.name.slice(prefix.length)).filter(isBackup).sort(); },
    async del(name) { await call('DELETE', objUrl(name)); }
  };
}
function destinations(c, only) {
  const out = [];
  const add = (id, label, enabled, make) => { if ((only ? only === id : enabled)) out.push({ id, label, make }); };
  add('local', 'Pasta local', c.local.enabled, () => folder(c.local.path || DEF.local.path));
  add('network', 'Caminho de rede', c.network.enabled, () => folder(c.network.path));
  add('ftp', 'FTP', c.ftp.enabled, () => ftpDest(c.ftp));
  add('oci', 'Bucket OCI', c.oci.enabled, () => ociDest(c.oci));
  return out;
}

// ── executar ─────────────────────────────────────────────
let running = null;
async function run(reason = 'manual') {
  if (running) throw httpError(409, 'Já há um backup em andamento.');
  running = (async () => {
    const c = config();
    const t0 = Date.now();
    const buf = pack(await snapshot(), c.password);
    const name = fileName(!!c.password);
    const results = [];
    for (const d of destinations(c)) {
      try {
        const dest = d.make();
        const where = await dest.put(name, buf);
        let pruned = 0;
        if (dest.del) { const all = (await dest.list() || []).filter(isRegular); for (const old of all.slice(0, Math.max(0, all.length - c.keep))) { await dest.del(old); pruned++; } }
        results.push({ id: d.id, label: d.label, ok: true, where, pruned });
      } catch (e) { results.push({ id: d.id, label: d.label, ok: false, error: e.message }); }
    }
    const entry = { at: t0, reason, name, size: buf.length, encrypted: !!c.password, ms: Date.now() - t0, results, ok: results.length > 0 && results.every((r) => r.ok) };
    const s = storage.readFileSettings().backup || {};
    storage.writeFileSettings({ backup: Object.assign({}, s, { history: [entry, ...(s.history || [])].slice(0, 30) }) });
    logs.app(entry.ok ? 'info' : 'error', `Backup ${reason}: ${name} (${Math.round(buf.length / 1024)} KB) — ${results.map((r) => `${r.label}: ${r.ok ? 'ok' : 'falhou (' + r.error + ')'}`).join('; ') || 'nenhum destino ativo'}`);
    logs.audit('backup.run', `Backup ${reason} ${entry.ok ? 'concluído' : 'com falhas'}: ${name}`, { results: results.map((r) => ({ d: r.id, ok: r.ok })) });
    return entry;
  })();
  try { return await running; } finally { running = null; }
}
/** Testa um destino gravando e apagando um arquivo pequeno. */
async function testDestination(id, body) {
  if (body) saveConfig(body);
  const d = destinations(config(), id)[0];
  if (!d) throw httpError(400, 'Destino desconhecido.');
  const dest = d.make();
  const name = fileName(false, 'teste');
  const where = await dest.put(name, Buffer.from('teste'));
  if (dest.del) await dest.del(name);
  return { ok: true, where, note: dest.del ? '' : 'Arquivo de teste gravado. URL pré-autenticada não permite apagar: remova-o ou use regra de ciclo de vida.' };
}
/** Download direto (botão "Baixar backup agora"). */
async function download() { const c = config(); const buf = pack(await snapshot(), c.password); return { name: fileName(!!c.password), buf }; }

/** Substitui todo o conteúdo do banco ativo pelo do backup (faz um backup local de segurança antes). */
async function restore(buf, password) {
  const obj = unpack(buf, password);
  const c = config();
  const safety = pack(await snapshot(), c.password);
  const safetyPath = await folder(c.local.path || DEF.local.path).put(fileName(!!c.password, 'antes-de-restaurar'), safety);
  const kind = storage.kind();
  await storage.backend(kind).drop();
  const b = storage.api;
  let books = 0;
  for (const x of obj.books || []) { const [cliente, ano, mes, area] = x.key.split('/'); x.state._keepSavedAt = true; await b.saveBook({ cliente, ano, mes, area }, x.state); books++; }
  for (const t of obj.templates || []) await b.saveTemplate(t);
  for (const [cl, data] of Object.entries(obj.connections || {})) await b.saveConnections(cl, data);
  for (const u of (obj.kv || {}).users || []) await b.kvSet('users', u.id, u);
  for (const col of storage.KV_COPY) for (const x of (obj.kv || {})[col] || []) await b.kvSet(col, x._id, x);
  if (obj.defaults) await b.saveDefaults(obj.defaults);
  logs.app('warn', `Banco ${kind} restaurado do backup de ${new Date(obj.createdAt).toLocaleString('pt-BR')} (${books} book(s)). Backup de segurança: ${safetyPath}`);
  logs.audit('backup.restore', `Restauração de backup (${books} book(s), criado em ${new Date(obj.createdAt).toLocaleString('pt-BR')})`, { safety: path.basename(safetyPath) });
  return { ok: true, books, templates: (obj.templates || []).length, users: ((obj.kv || {}).users || []).length, createdAt: obj.createdAt, safety: safetyPath };
}

/** Apaga um banco inteiro (inclusive o ativo). Antes, guarda um backup dele na pasta local. */
async function deleteDatabase(kind, confirm) {
  const names = { sqlite: 'SQLITE', mongo: 'MONGODB' };
  if (!names[kind]) throw httpError(400, 'Banco desconhecido.');
  if (String(confirm || '').trim().toUpperCase() !== names[kind]) throw httpError(400, `Para confirmar, digite ${names[kind]}.`);
  const b = storage.backend(kind);
  await b.ping();
  const c = config();
  const safetyPath = await folder(c.local.path || DEF.local.path).put(fileName(!!c.password, 'antes-de-excluir-' + kind), pack(await snapshot(b, kind), c.password));
  await b.drop();
  const active = kind === storage.kind();
  logs.app('warn', `Banco ${kind} excluído${active ? ' (era o banco em uso: o app recomeça vazio)' : ''}. Backup de segurança: ${safetyPath}`);
  logs.audit('db.delete', `Banco ${kind} excluído${active ? ' (em uso)' : ''}`, { safety: path.basename(safetyPath) });
  return { ok: true, active, safety: safetyPath };
}

/** Agendamento: confere a cada minuto. */
function startScheduler() {
  const tick = async () => {
    const c = config();
    if (!c.schedule.enabled) return;
    const now = new Date();
    const today = now.toLocaleDateString('sv-SE');
    const hhmm = now.toTimeString().slice(0, 5);
    if (hhmm < c.schedule.time || c.lastScheduled === today) return;
    storage.writeFileSettings({ backup: Object.assign({}, storage.readFileSettings().backup, { lastScheduled: today }) });
    try { await run('agendado'); } catch (e) { logs.app('error', 'Backup agendado falhou: ' + e.message); }
  };
  const t = setInterval(tick, 60000); t.unref();
  return t;
}

module.exports = { config, publicConfig, saveConfig, run, testDestination, download, restore, deleteDatabase, startScheduler, pack, unpack, snapshot, MASK };
