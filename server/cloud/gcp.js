/* ═══ Conector GCP — conta de serviço (JWT RS256) + APIs REST ═══
 * Config (por cliente): { projectIds: 'proj-a,proj-b', serviceAccountJson?: '{…}' | keyFile?: '~/sa.json' }
 * A conta de serviço precisa de "Viewer" (roles/viewer) nos projetos.
 */
const crypto = require('crypto');
const U = require('./util');
const tokens = new Map();
const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

function account(cfg) {
  const raw = cfg.serviceAccountJson || (cfg.keyFile ? U.readFile(cfg.keyFile) : process.env.GOOGLE_APPLICATION_CREDENTIALS ? U.readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS) : '');
  if (!raw) throw new Error('Informe o JSON da conta de serviço do GCP (ou o caminho do arquivo).');
  const sa = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!sa.client_email || !sa.private_key) throw new Error('JSON de conta de serviço inválido.');
  return sa;
}
async function token(cfg) {
  const sa = account(cfg);
  const t = tokens.get(sa.client_email);
  if (t && t.exp > Date.now() + 60000) return t.token;
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform.read-only', aud: sa.token_uri || 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const jwt = unsigned + '.' + b64u(crypto.sign('sha256', Buffer.from(unsigned), sa.private_key));
  const res = await U.request(sa.token_uri || 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }) });
  const j = await res.json();
  tokens.set(sa.client_email, { token: j.access_token, exp: Date.now() + j.expires_in * 1000 });
  return j.access_token;
}
async function get(cfg, url) {
  const tk = await token(cfg);
  const pages = []; let pageToken = null; let n = 0;
  do {
    const u = url + (pageToken ? (url.includes('?') ? '&' : '?') + 'pageToken=' + encodeURIComponent(pageToken) : '');
    const j = await (await U.request(u, { headers: { authorization: 'Bearer ' + tk } })).json();
    pages.push(j); pageToken = j.nextPageToken;
  } while (pageToken && ++n < 100);
  return pages;
}
/** Itens de uma lista "aggregated" (por zona/região). */
const aggregated = (pages, key) => pages.flatMap((p) => Object.values(p.items || {}).flatMap((z) => z[key] || []));
const projects = (cfg) => { const p = U.list(cfg.projectIds || cfg.projectId); if (!p.length) { try { p.push(account(cfg).project_id); } catch (e) {} } if (!p.filter(Boolean).length) throw new Error('Informe ao menos um projectId do GCP.'); return p.filter(Boolean); };
const C = 'https://compute.googleapis.com/compute/v1/projects/';

async function test(cfg) {
  const ps = projects(cfg);
  await get(cfg, `${C}${ps[0]}/zones?maxResults=1`);
  return { message: `Conectado como ${account(cfg).client_email} — projeto(s): ${ps.join(', ')}` };
}

async function pull(cfg, kind) {
  const rows = [];
  for (const p of projects(cfg)) {
    if (kind === 'servers' || kind === 'baseline') {
      for (const i of aggregated(await get(cfg, `${C}${p}/aggregated/instances`), 'instances')) {
        if (kind === 'baseline') { rows.push({ resource_type: 'Compute Instance', project: p }); continue; }
        const lic = (i.disks || []).flatMap((d) => d.licenses || []).map(U.last)[0] || '';
        rows.push({ 'Name': i.name, 'Internal IP': i.networkInterfaces?.[0]?.networkIP || '', 'Operating System': lic, 'Status': i.status, 'Zone': U.last(i.zone), 'Project': p, 'Machine Type': U.last(i.machineType), 'Labels': Object.entries(i.labels || {}).map(([k, v]) => `${k}=${v}`).join(' ') });
      }
    }
    if (kind === 'storage' || kind === 'baseline') {
      for (const d of aggregated(await get(cfg, `${C}${p}/aggregated/disks`), 'disks'))
        rows.push(kind === 'baseline' ? { resource_type: 'Persistent Disk', project: p } : { 'Name': d.name, 'Type': 'Disco ' + U.last(d.type), 'Size': d.sizeGb + ' GB', 'Zone': U.last(d.zone), 'Project': p, 'Status': d.status });
      for (const b of (await get(cfg, `https://storage.googleapis.com/storage/v1/b?project=${p}`)).flatMap((x) => x.items || []))
        rows.push(kind === 'baseline' ? { resource_type: 'Cloud Storage Bucket', project: p } : { 'Name': b.name, 'Type': 'Bucket · ' + (b.storageClass || ''), 'Size': '', 'Zone': b.location, 'Project': p, 'Status': 'available' });
    }
    if (kind === 'network' || kind === 'baseline') {
      const subnets = aggregated(await get(cfg, `${C}${p}/aggregated/subnetworks`), 'subnetworks');
      for (const n of (await get(cfg, `${C}${p}/global/networks`)).flatMap((x) => x.items || [])) {
        if (kind === 'baseline') { rows.push({ resource_type: 'VPC Network', project: p }); continue; }
        const subs = subnets.filter((s) => s.network === n.selfLink);
        rows.push({ 'Network Name': n.name, 'IP range': subs.map((s) => s.ipCidrRange).join(', ') || n.IPv4Range || '', 'Project': p, 'Subnets': subs.map((s) => `${s.name} (${U.last(s.region)} ${s.ipCidrRange})`).join('; ') });
      }
    }
  }
  const names = { servers: 'Instâncias GCP (API)', storage: 'Discos + Buckets GCP (API)', network: 'Redes VPC GCP (API)', baseline: 'Recursos GCP (API)' };
  return [U.sheet(kind, names[kind], rows)];
}

module.exports = { label: 'Google Cloud Platform', test, pull };
