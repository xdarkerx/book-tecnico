/* ═══ Vulnerabilidades (CVEs): formato comum a todas as fontes ═══
 * Clouds (OCI Vulnerability Scanning, AWS Inspector, Defender for Cloud, GCP Security Command Center),
 * Wazuh e Microsoft Defender for Endpoint devolvem achados por servidor; aqui eles viram UMA linha por CVE,
 * com os servidores afetados, para o book não ficar com milhares de linhas.
 */
const U = require('./util');

const SEV = [
  [/^(crit|crít|5$|disaster)/i, 'Crítica'], [/^(high|alta|alto|important|4$)/i, 'Alta'],
  [/^(med|méd|moder|3$)/i, 'Média'], [/^(low|baix|2$|1$)/i, 'Baixa'], [/^(info|none|0$|untriaged)/i, 'Informativa']
];
const ORDER = { 'Crítica': 0, 'Alta': 1, 'Média': 2, 'Baixa': 3, 'Informativa': 4, '': 5 };
function sevPt(s, cvss) {
  const v = String(s == null ? '' : s).trim();
  for (const [re, out] of SEV) if (re.test(v)) return out;
  const n = Number(cvss); // sem severidade: deriva do CVSS (faixas do CVSS v3)
  if (!v && !isNaN(n) && cvss !== '' && cvss != null) return n >= 9 ? 'Crítica' : n >= 7 ? 'Alta' : n >= 4 ? 'Média' : n > 0 ? 'Baixa' : 'Informativa';
  return v;
}
const num = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };

/** Primeiro CVSS (base score) encontrado num objeto de formato desconhecido (ex.: additionalData do Defender). */
function findCvss(o, depth = 0) {
  if (o == null || depth > 4) return null;
  if (typeof o === 'number') return o;
  if (Array.isArray(o)) { for (const x of o) { const v = findCvss(x, depth + 1); if (v != null) return v; } return null; }
  if (typeof o === 'object') {
    for (const k of ['baseScore', 'base', 'score', 'cvss3_score', 'cvssScore']) if (num(o[k]) != null) return num(o[k]);
    for (const v of Object.values(o)) { const r = findCvss(v, depth + 1); if (r != null) return r; }
  }
  return null;
}

/** list: [{ cve, title, severity, cvss, host, fix, pkg }] → sheet "vulns" (uma linha por CVE) + resumo. */
function aggregate(list, source, opts = {}) {
  const by = new Map(); const hosts = new Set();
  for (const v of list) {
    const id = String(v.cve || v.title || '').trim(); if (!id) continue;
    const cvss = num(v.cvss);
    const sev = sevPt(v.severity, cvss);
    const k = id.toUpperCase();
    const e = by.get(k) || { cve: /^CVE-/i.test(id) ? id.toUpperCase() : '', title: '', sev, cvss, hosts: new Set(), fix: '', pkgs: new Set() };
    if (!e.title && v.title && v.title !== id) e.title = String(v.title);
    if (ORDER[sev] < ORDER[e.sev]) e.sev = sev;
    if (cvss != null && (e.cvss == null || cvss > e.cvss)) e.cvss = cvss;
    if (v.host) { e.hosts.add(String(v.host)); hosts.add(String(v.host)); }
    if (v.pkg) e.pkgs.add(String(v.pkg));
    if (!e.fix && v.fix) e.fix = String(v.fix);
    if (!e.cve && !e.title) e.title = id;
    by.set(k, e);
  }
  const rows = [...by.values()]
    .sort((a, b) => ORDER[a.sev] - ORDER[b.sev] || (b.cvss ?? -1) - (a.cvss ?? -1) || b.hosts.size - a.hosts.size)
    .slice(0, opts.max || 1000)
    .map((e) => {
      const hs = [...e.hosts];
      const pk = [...e.pkgs];
      return {
        'CVE': e.cve,
        'Vulnerabilidade': (e.title || (pk.length ? pk.slice(0, 3).join(', ') : '')).slice(0, 220),
        'Severidade': e.sev,
        'CVSS': e.cvss == null ? '' : e.cvss.toFixed(1),
        'Sistemas afetados': hs.length ? `${hs.length} — ${hs.slice(0, 5).join(', ')}${hs.length > 5 ? ` +${hs.length - 5}` : ''}` : '',
        'Ação sugerida': (e.fix || (pk.length ? `Atualizar ${pk.slice(0, 2).join(', ')}` : '')).replace(/\s+/g, ' ').slice(0, 220),
        'Fonte': source
      };
    });
  const bySev = {};
  for (const e of by.values()) bySev[e.sev || 'Sem severidade'] = (bySev[e.sev || 'Sem severidade'] || 0) + 1;
  const sh = U.sheet('vulns', `Vulnerabilidades (${source})`, rows);
  sh.summary = { total: by.size, hosts: hosts.size, bySeverity: bySev, source, truncated: by.size > rows.length };
  return sh;
}

module.exports = { aggregate, sevPt, findCvss };
