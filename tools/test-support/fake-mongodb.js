/* MongoDB em memória — imita o pedaço do driver oficial usado por server/storage/mongo.js (só para npm test). */
const clone = (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o)));
const match = (d, q) => Object.entries(q || {}).every(([k, v]) => (v && typeof v === 'object' && '$exists' in v ? (k in d) === v.$exists : d[k] === v));
/** $set com caminho pontilhado ('state.guid'). */
function setPath(d, k, v) { const parts = k.split('.'); let o = d; parts.slice(0, -1).forEach((p) => { o = o[p] = o[p] || {}; }); o[parts[parts.length - 1]] = v; }
function project(d, p) {
  if (!p) return clone(d);
  const vals = Object.values(p);
  if (vals.every((v) => !v)) { const o = clone(d); Object.keys(p).forEach((k) => delete o[k]); return o; }
  const o = { _id: d._id }; Object.keys(p).forEach((k) => { if (p[k] && k in d) o[k] = clone(d[k]); }); return o;
}
const servers = {};
class Collection {
  constructor() { this.docs = new Map(); }
  async createIndex() { return 'ok'; }
  find(q, opts = {}) {
    let out = [...this.docs.values()].filter((d) => match(d, q)).map((d) => project(d, opts.projection));
    const cur = { sort(s) { const [[k, dir]] = Object.entries(s); out.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * dir); return cur; }, async toArray() { return out; } };
    return cur;
  }
  async findOne(q, opts = {}) { const d = [...this.docs.values()].find((x) => match(x, q)); return d ? project(d, opts.projection) : null; }
  async updateOne(q, u, opts = {}) {
    let d = [...this.docs.values()].find((x) => match(x, q));
    if (!d) { if (!opts.upsert) return { matchedCount: 0 }; d = clone(q); this.docs.set(d._id, d); }
    for (const [k, v] of Object.entries(clone(u.$set))) setPath(d, k, v); return { matchedCount: 1 };
  }
  async deleteOne(q) { const d = [...this.docs.values()].find((x) => match(x, q)); if (d) this.docs.delete(d._id); return { deletedCount: d ? 1 : 0 }; }
  async countDocuments(q) { return [...this.docs.values()].filter((d) => match(d, q)).length; }
  async deleteMany(q) { let n = 0; for (const d of [...this.docs.values()]) if (match(d, q)) { this.docs.delete(d._id); n++; } return { deletedCount: n }; }
}
class Db { constructor() { this.cols = {}; } collection(n) { return (this.cols[n] = this.cols[n] || new Collection()); } async command() { return { ok: 1 }; } async dropDatabase() { this.cols = {}; return true; } }
class MongoClient {
  constructor(url) { this.url = url; }
  async connect() { if (/unreachable/.test(this.url)) throw new Error('connect ECONNREFUSED'); return this; }
  async close() { return true; }
  db(name) { const s = (servers[this.url] = servers[this.url] || {}); return (s[name] = s[name] || new Db()); }
}
module.exports = { MongoClient, _servers: servers };
