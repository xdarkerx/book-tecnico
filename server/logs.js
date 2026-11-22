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
  const store = ctx.getStore() || {};
  const e = Object.assign({ t: Date.now() }, store.user ? { user: store.user } : {}, store.ip && kind !== 'http' ? { ip: store.ip } : {}, entry);
  if (e.path) e.path = scrub(e.path);
  if (e.msg) e.msg = scrub(e.msg);
  const r = ring[kind]; r.push(e); if (r.length > RING) r.splice(0, r.length - RING);
  const line = JSON.stringify(e) + '\n';
  queue = queue.then(() => fs.promises.appendFile(file(kind, day(e.t)), line)).catch(() => { /* disco cheio etc.: não derruba o app */ });
  return e;
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
  DIR
};
module.exports = L;
