/* ═══ Conector Wazuh — vulnerabilidades (CVEs) dos agentes ═══
 * Config (por cliente):
 *   { url: 'https://wazuh:55000' (API do manager), user, password,
 *     indexerUrl?: 'https://wazuh-indexer:9200', indexerUser?, indexerPassword?  (Wazuh 4.8+: os CVEs ficam no indexer)
 *     group?: 'grupo de agentes', insecure?: true }
 * Wazuh 4.8 ou mais novo: informe o indexer (índice wazuh-states-vulnerabilities-*).
 * Até o 4.7: basta a API do manager (GET /vulnerability/{agente}).
 */
const U = require('./util');
const V = require('./vulns');

const trim = (u) => String(u || '').replace(/\/+$/, '');
async function login(cfg) {
  if (!cfg.url) throw new Error('Informe a URL da API do Wazuh (ex.: https://wazuh:55000).');
  if (!cfg.user || !cfg.password) throw new Error('Informe o usuário e a senha da API do Wazuh.');
  const auth = 'Basic ' + Buffer.from(cfg.user + ':' + cfg.password).toString('base64');
  const j = await (await U.request(trim(cfg.url) + '/security/user/authenticate', { method: 'POST', headers: { authorization: auth }, insecure: !!cfg.insecure })).json();
  const tk = j.data && j.data.token;
  if (!tk) throw new Error('O Wazuh não devolveu o token de acesso.');
  return { get: async (path) => (await U.request(trim(cfg.url) + path, { headers: { authorization: 'Bearer ' + tk }, insecure: !!cfg.insecure, timeout: 120000 })).json() };
}
async function agents(api, cfg) {
  const out = [];
  for (let off = 0, n = 0; n < 40; n++, off += 500) {
    const j = await api.get(`/agents?limit=500&offset=${off}&select=id,name,status,group${cfg.group ? '&group=' + encodeURIComponent(cfg.group) : ''}`);
    const items = (j.data && j.data.affected_items) || [];
    out.push(...items.filter((a) => a.id !== '000'));
    if (items.length < 500) break;
  }
  return out;
}
function indexer(cfg) {
  const user = cfg.indexerUser || cfg.user; const pass = cfg.indexerPassword || cfg.password;
  const auth = 'Basic ' + Buffer.from(user + ':' + pass).toString('base64');
  return async (path, body) => (await U.request(trim(cfg.indexerUrl) + path, { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body), insecure: !!cfg.insecure, timeout: 120000 })).json();
}

async function test(cfg) {
  const api = await login(cfg);
  const info = await api.get('/');
  const ag = await agents(api, cfg);
  let idx = '';
  if (cfg.indexerUrl) {
    const r = await indexer(cfg)('/wazuh-states-vulnerabilities-*/_count', { query: { match_all: {} } });
    idx = ` · indexer com ${r.count ?? 0} registro(s) de vulnerabilidade`;
  }
  return { message: `Conectado ao Wazuh ${(info.data && info.data.api_version) || ''} — ${ag.length} agente(s)${cfg.group ? ' no grupo ' + cfg.group : ''}${idx}` };
}

async function pull(cfg, kind, opts = {}) {
  const api = await login(cfg);
  const ag = await agents(api, cfg);
  const ids = new Set(ag.map((a) => a.id));
  const list = [];
  if (cfg.indexerUrl) {
    // Wazuh 4.8+: estado atual das vulnerabilidades no indexer, paginado por search_after
    const q = indexer(cfg);
    let after = null;
    for (let n = 0; n < 40; n++) {
      const body = { size: 5000, _source: ['agent.id', 'agent.name', 'vulnerability.id', 'vulnerability.severity', 'vulnerability.score.base', 'vulnerability.description', 'package.name', 'package.version'],
        query: cfg.group ? { terms: { 'agent.id': [...ids] } } : { match_all: {} }, sort: [{ 'vulnerability.id': 'asc' }, { 'agent.id': 'asc' }, { 'package.name': 'asc' }] };
      if (after) body.search_after = after;
      const r = await q('/wazuh-states-vulnerabilities-*/_search', body);
      const hits = (r.hits && r.hits.hits) || [];
      for (const h of hits) {
        const s = h._source || {}; const v = s.vulnerability || {}; const pk = s.package || {};
        list.push({ cve: v.id, title: v.description ? String(v.description).slice(0, 160) : '', severity: v.severity, cvss: v.score && v.score.base, host: (s.agent || {}).name, pkg: pk.name ? `${pk.name} ${pk.version || ''}`.trim() : '', fix: pk.name ? `Atualizar o pacote ${pk.name}` : '' });
      }
      if (hits.length < 5000) break;
      after = hits[hits.length - 1].sort;
    }
  } else {
    // até o 4.7: CVEs por agente na API do manager
    const errs = [];
    await U.pool(ag, 4, async (a) => {
      try {
        for (let off = 0, n = 0; n < 20; n++, off += 500) {
          const j = await api.get(`/vulnerability/${a.id}?limit=500&offset=${off}`);
          const items = (j.data && j.data.affected_items) || [];
          for (const v of items) list.push({ cve: v.cve, title: v.title || '', severity: v.severity, cvss: v.cvss3_score || v.cvss2_score, host: a.name, pkg: v.name ? `${v.name} ${v.version || ''}`.trim() : '', fix: v.condition || (v.name ? `Atualizar o pacote ${v.name}` : '') });
          if (items.length < 500) break;
        }
      } catch (e) { errs.push(e.message); }
    });
    if (errs.length && !list.length) throw new Error('A API do manager não devolveu vulnerabilidades. No Wazuh 4.8 ou mais novo, informe o endereço do indexer na conexão. ' + errs[0]);
  }
  const sh = V.aggregate(list, 'Wazuh');
  return [{ kind: 'vulns', name: 'Wazuh', summary: Object.assign({ periodLabel: 'estado atual', agents: ag.length }, sh.summary), sheets: { vulns: sh } }];
}

module.exports = { label: 'Wazuh', test, pull };
