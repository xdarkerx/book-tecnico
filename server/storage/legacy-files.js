/* ═══ Leitura dos dados antigos em ARQUIVOS (versões anteriores do Book Técnico) ═══
 * Só leitura: na inicialização, o que existir em data/ é importado uma vez para o banco ativo
 * (SQLite ou MongoDB). Os arquivos não são apagados — ficam como backup.
 *   data/books/<cliente>/<ano>/<mes>-<area>.json   data/templates/<id>.json
 *   data/connections/<cliente>.json                data/sessions/<sid>.json
 */
const fs = require('fs');
const path = require('path');
const { DATA, readJson } = require('./common');

const dir = (n) => path.join(DATA, n);
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };
const jsonFiles = (d) => (isDir(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.json')) : []);

function dumpBooks() {
  const out = [];
  const root = dir('books');
  if (!isDir(root)) return out;
  for (const c of fs.readdirSync(root)) {
    if (!isDir(path.join(root, c))) continue;
    for (const a of fs.readdirSync(path.join(root, c))) {
      const adir = path.join(root, c, a);
      if (!isDir(adir) || !/^\d{4}$/.test(a)) continue;
      for (const f of jsonFiles(adir)) {
        const m = f.match(/^(\d{2})-(.+)\.json$/); if (!m) continue;
        const state = readJson(path.join(adir, f), null);
        if (state && state.meta && Array.isArray(state.groups)) out.push({ key: `${c}/${a}/${m[1]}/${m[2]}`, state });
      }
    }
  }
  return out;
}

module.exports = {
  kind: 'legacy-files',
  dumpBooks,
  listTemplates: () => jsonFiles(dir('templates')).map((f) => readJson(path.join(dir('templates'), f), null)).filter((t) => t && t.state),
  listConnectionClients: () => jsonFiles(dir('connections')).map((f) => f.slice(0, -5)),
  getConnections: (c) => readJson(path.join(dir('connections'), c + '.json'), { nome: c, providers: {} }),
  dumpSessions: () => jsonFiles(dir('sessions')).map((f) => readJson(path.join(dir('sessions'), f), null)).filter(Boolean),
  hasData() { return dumpBooks().length > 0 || jsonFiles(dir('templates')).length > 0 || jsonFiles(dir('connections')).length > 0; }
};
