/* ═══ Logs e auditoria ═══
 * Quatro tipos, cada um em arquivos diários JSON Lines em data/logs/:
 *   http   requisições (método, caminho, status, tempo, usuário, IP)
 *   db     gravações no banco (operação, alvo, banco, tempo, erro)
 *   app    demais informações (início, trocas de banco, backups, sincronização de grupos, erros)
 *   audit  auditoria (logins, usuários, exclusões, lixeira, restaurações, configurações)
 * Retenção: 90 dias (auditoria: 365). As últimas entradas ficam em memória para a tela abrir rápido.
 * O usuário/IP da requisição atual é descoberto sozinho (AsyncLocalStorage), sem passar por parâmetro.
 */
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const { DATA } = require('./storage/common');
const local = require('./local');

const DIR = path.join(DATA, 'logs');
const KINDS = ['http', 'db', 'app', 'audit'];
const KEEP_DAYS = { http: 90, db: 90, app: 90, audit: 365 };
const RING = 1000;
const ring = Object.fromEntries(KINDS.map((k) => [k, []]));
const ctx = new AsyncLocalStorage();
let queue = Promise.resolve();
fs.mkdirSync(DIR, { recursive: true });

const day = (t = Date.now()) => new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 10); // data local
const file = (kind, d) => path.join(DIR, `${kind}-${d}.jsonl`);
/** Esconde segredos que possam aparecer em caminhos/mensagens. */
const scrub = (s) => String(s).replace(/([?&](sid|token|password|senha|secret)=)[^&\s]*/gi, '$1***').replace(/\/\/[^@/\s]*@/g, '//***@');

function write(kind, entry) {
  // app local: sem log de requisições e de banco; o resto leva o usuário do Windows e a máquina
  if (local.LOCAL && (kind === 'http' || kind === 'db')) return entry;
  const store = ctx.getStore() || {};
  const e = local.LOCAL ? Object.assign({ t: Date.now() }, local.who(), entry)
    : Object.assign({ t: Date.now() }, store.user ? { user: store.user } : {}, store.ip && kind !== 'http' ? { ip: store.ip } : {}, entry);
  if (local.LOCAL && kind === 'audit') history(e.action, e.msg);
  if (e.path) e.path = scrub(e.path);
  if (e.msg) e.msg = scrub(e.msg);
  const r = ring[kind]; r.push(e); if (r.length > RING) r.splice(0, r.length - RING);
  const line = JSON.stringify(e) + '\n';
  queue = queue.then(() => fs.promises.appendFile(file(kind, day(e.t)), line)).catch(() => { /* disco cheio etc.: não derruba o app */ });
  return e;
}

// ── App local: histórico de edições (quem, de qual máquina, o quê, quando), gravado no próprio banco ──
// Assim vai junto com o arquivo do banco (ex.: pelo OneDrive) e cada máquina vê quem mexeu.
const EDIT_WINDOW = 30 * 60000; // várias gravações seguidas do mesmo book viram uma linha a cada 30 min
function history(action, msg, book = '') {
  if (!local.LOCAL) return;
  try {
    const st = require('./storage');
    const w = local.who(); const t = Date.now();
    const id = book && action === 'edit' ? `${book}|${w.user}|${w.machine}|${Math.floor(t / EDIT_WINDOW)}` : `${t}-${Math.random().toString(36).slice(2, 8)}`;
    const r = st.api.kvSet('edits', id, Object.assign({ id, t, action, msg: String(msg || ''), book }, w));
    if (r && r.catch) r.catch(() => {});
  } catch (e) { /* banco indisponível: não derruba o app */ }
}

const L = {
  KINDS, ctx,
  /** Roda fn com o contexto da requisição (usuário, IP) disponível para todos os logs. */
  run(store, fn) { return ctx.run(store, fn); },
  setUser(user) { const s = ctx.getStore(); if (s && user) s.user = user.name || user.username; },
  http: (e) => write('http', e),
  db: (e) => write('db', e),
  app: (level, msg, data) => write('app', Object.assign({ level, msg }, data ? { data } : {})),
  audit: (action, msg, data) => write('audit', Object.assign({ action, msg }, data ? { data } : {})),

  /** Consulta: mais recentes primeiro. filter: { from, to (ms), q (texto), limit } */
  async query(kind, { from, to, q, limit = 300 } = {}) {
    if (!KINDS.includes(kind)) throw Object.assign(new Error('Tipo de log desconhecido.'), { status: 400 });
    await queue;
    to = Number(to) || Date.now(); from = Number(from) || to - 24 * 3600000;
    limit = Math.min(Math.max(Number(limit) || 300, 1), 5000);
    const needle = String(q || '').toLowerCase();
    const out = [];
    for (let t = to; t >= from - 86400000 && out.length < limit; t -= 86400000) {
      let lines;
      try { lines = (await fs.promises.readFile(file(kind, day(t)), 'utf8')).split('\n'); } catch (e) { continue; }
      for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
        if (!lines[i]) continue;
        let e; try { e = JSON.parse(lines[i]); } catch (x) { continue; }
        if (e.t < from || e.t > to) continue;
        if (needle && !JSON.stringify(e).toLowerCase().includes(needle)) continue;
        out.push(e);
      }
    }
    return out;
  },
  recent: (kind, n = 50) => ring[kind].slice(-n).reverse(),
  /** Apaga arquivos mais antigos que a retenção. */
  async prune() {
    let n = 0;
    for (const f of await fs.promises.readdir(DIR).catch(() => [])) {
      const m = f.match(/^(\w+)-(\d{4}-\d{2}-\d{2})\.jsonl$/); if (!m) continue;
      if (Date.now() - Date.parse(m[2]) > (KEEP_DAYS[m[1]] || 90) * 86400000) { await fs.promises.unlink(path.join(DIR, f)).catch(() => {}); n++; }
    }
    return n;
  },
  flush: () => queue,
  /** App local: registra uma edição de book (agrupa as gravações seguidas). */
  edit: (book, msg) => history('edit', msg || 'Editou o book', book),
  /** App local: histórico do banco, mais recente primeiro. filter: { q, limit } */
  async edits({ q, limit = 500 } = {}) {
    const st = require('./storage');
    const needle = String(q || '').toLowerCase();
    const all = (await st.api.kvList('edits')).filter((e) => !needle || JSON.stringify(e).toLowerCase().includes(needle));
    return all.sort((a, b) => b.t - a.t).slice(0, Math.min(Number(limit) || 500, 5000));
  },
  /** App local: mantém só o último ano do histórico. */
  async pruneEdits() {
    if (!local.LOCAL) return 0;
    const st = require('./storage'); let n = 0;
    for (const e of await st.api.kvList('edits')) if (e.id && Date.now() - e.t > 365 * 86400000) { await st.api.kvDel('edits', e.id); n++; }
    return n;
  },
  DIR
};
module.exports = L;
