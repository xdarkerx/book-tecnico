/* ═══ Conector Microsoft Defender for Endpoint — vulnerabilidades (CVEs) dos dispositivos ═══
 * Config (por cliente): { tenantId, clientId, clientSecret, deviceGroup?: 'grupo de dispositivos (filtra pelo nome)' }
 * App Registration com a permissão de APLICATIVO "Vulnerability.Read.All" da API "WindowsDefenderATP"
 * (consentimento de administrador). Usa a API de Gerenciamento de Vulnerabilidades (TVM).
 */
const U = require('./util');
const V = require('./vulns');
const API = 'https://api.securitycenter.microsoft.com';
const tokens = new Map();

async function token(cfg) {
  ['tenantId', 'clientId', 'clientSecret'].forEach((k) => { if (!cfg[k]) throw new Error(`Configuração do Defender incompleta: falta "${k}".`); });
  const key = cfg.tenantId + cfg.clientId;
  const t = tokens.get(key);
  if (t && t.exp > Date.now() + 60000) return t.token;
  const j = await (await U.request(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: API + '/.default' })
  })).json();
  tokens.set(key, { token: j.access_token, exp: Date.now() + j.expires_in * 1000 });
  return j.access_token;
}
async function get(cfg, url, maxPages = 50) {
  const tk = await token(cfg);
  const out = []; let u = url.startsWith('http') ? url : API + url; let n = 0;
  while (u && n++ < maxPages) {
    const j = await (await U.request(u, { headers: { authorization: 'Bearer ' + tk }, timeout: 120000 })).json();
    out.push(...(j.value || []));
    u = j['@odata.nextLink'];
  }
  return out;
}

async function test(cfg) {
  const list = await get(cfg, '/api/vulnerabilities/machinesVulnerabilities?$top=1', 1);
  return { message: `Conectado ao Microsoft Defender for Endpoint (API de vulnerabilidades${list.length ? ' com dados' : ', ainda sem vulnerabilidades'}).` };
}

async function pull(cfg) {
  const grp = String(cfg.deviceGroup || '').toLowerCase();
  // uma linha por dispositivo × software × CVE (exportação paginada)
  const rows = (await get(cfg, '/api/machines/SoftwareVulnerabilitiesByMachine?pageSize=50000', 40))
    .filter((r) => r.cveId && (!grp || String(r.rbacGroupName || '').toLowerCase().includes(grp)));
  // CVSS: a exportação não traz; busca nos CVEs mais graves (limitado, por causa do limite de chamadas da API)
  const cvss = {};
  const top = [...new Set(rows.filter((r) => /critical|high/i.test(r.vulnerabilitySeverityLevel)).map((r) => r.cveId))].slice(0, 40);
  await U.pool(top, 2, async (id) => {
    try { const v = await (await U.request(`${API}/api/vulnerabilities/${encodeURIComponent(id)}`, { headers: { authorization: 'Bearer ' + (await token(cfg)) } })).json(); if (v.cvssV3 != null) cvss[id] = v.cvssV3; } catch (e) { /* opcional */ }
  });
  const list = rows.map((r) => ({
    cve: r.cveId, title: '', severity: r.vulnerabilitySeverityLevel, cvss: cvss[r.cveId], host: r.deviceName,
    pkg: [r.softwareVendor, r.softwareName, r.softwareVersion].filter(Boolean).join(' '),
    fix: r.recommendedSecurityUpdate || (r.securityUpdateAvailable ? 'Aplicar a atualização de segurança disponível' : '')
  }));
  const sh = V.aggregate(list, 'Microsoft Defender for Endpoint');
  return [{ kind: 'vulns', name: 'Microsoft Defender', summary: Object.assign({ periodLabel: 'estado atual' }, sh.summary), sheets: { vulns: sh } }];
}

module.exports = { label: 'Microsoft Defender for Endpoint', test, pull };
