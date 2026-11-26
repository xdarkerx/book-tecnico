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
/** Projetos: os da conexão ou, se vazio, todos os projetos ativos que a conta de serviço enxerga. */
async function projectsOf(cfg) {
  if (U.list(cfg.projectIds || cfg.projectId).length) return projects(cfg);
  try {
    const list = (await get(cfg, 'https://cloudresourcemanager.googleapis.com/v1/projects?filter=lifecycleState%3AACTIVE')).flatMap((x) => x.projects || []).map((p) => p.projectId).filter(Boolean);
    if (list.length) return list;
  } catch (e) { /* sem resourcemanager.projects.list: usa o projeto da conta de serviço */ }
  return projects(cfg);
}
/** bytes → "12,3 GB" (ou MB/TB) */
const gb = (n) => { n = Number(n) || 0; const u = n >= 1e12 ? [1e12, 'TB'] : n >= 1e9 ? [1e9, 'GB'] : [1e6, 'MB']; return (Math.round((n / u[0]) * 10) / 10).toLocaleString('pt-BR') + ' ' + u[1]; };
/** Tamanho de cada bucket do projeto (Cloud Monitoring: storage.googleapis.com/storage/total_bytes). */
async function bucketSizes(cfg, p) {
  const out = {};
  try {
    const end = new Date(); const start = new Date(end - 2 * 86400000);
    const q = `filter=${encodeURIComponent('metric.type="storage.googleapis.com/storage/total_bytes"')}&interval.startTime=${start.toISOString()}&interval.endTime=${end.toISOString()}`;
    for (const page of await get(cfg, `https://monitoring.googleapis.com/v3/projects/${p}/timeSeries?${q}`))
      for (const ts of page.timeSeries || []) {
        const b = ts.resource && ts.resource.labels && ts.resource.labels.bucket_name; const pt = (ts.points || [])[0];
        if (b && pt) out[b] = (out[b] || 0) + Number(pt.value.doubleValue ?? pt.value.int64Value ?? 0); // soma as classes de armazenamento
      }
  } catch (e) { /* sem monitoring.timeSeries.list */ }
  return out;
}

async function test(cfg) {
  const ps = await projectsOf(cfg);
  await get(cfg, `${C}${ps[0]}/zones?maxResults=1`);
  return { message: `Conectado como ${account(cfg).client_email} — projeto(s): ${ps.join(', ')}` };
}

const period = (opts = {}) => ({ from: opts.from ? new Date(opts.from + 'T00:00:00Z') : new Date(Date.now() - 31 * 86400000), to: opts.to ? new Date(opts.to + 'T23:59:59Z') : new Date() });
const inPeriod = (d, p) => { const t = new Date(d); return t >= p.from && t <= p.to; };
async function pull(cfg, kind, opts = {}) {
  const rows = [];
  const per = period(opts);
  for (const p of await projectsOf(cfg)) {
    if (kind === 'backup') {
      // políticas: agendamentos de snapshot (resource policies)
      if ((opts.backupMode || 'both') !== 'jobs') for (const rp of aggregated(await get(cfg, `${C}${p}/aggregated/resourcePolicies`), 'resourcePolicies')) {
        const sp = rp.snapshotSchedulePolicy; if (!sp) continue;
        const s = sp.schedule || {};
        const when = s.dailySchedule ? `Diário ${s.dailySchedule.startTime || ''}` : s.hourlySchedule ? `A cada ${s.hourlySchedule.hoursInCycle}h` : s.weeklySchedule ? 'Semanal' : '—';
        rows.push({ 'Item': rp.name, 'Situação': rp.status === 'READY' ? 'Política ativa' : rp.status, 'Ferramenta': 'Agendamento de snapshot', 'Frequência': when.trim(), 'Retenção': sp.retentionPolicy && sp.retentionPolicy.maxRetentionDays ? sp.retentionPolicy.maxRetentionDays + ' dias' : '—', 'Criado em': '' });
      }
      // backup do período: snapshots de disco
      if ((opts.backupMode || 'both') !== 'policies') for (const s of (await get(cfg, `${C}${p}/global/snapshots`)).flatMap((x) => x.items || []))
        if (inPeriod(s.creationTimestamp, per)) rows.push({ 'Item': s.name, 'Situação': s.status === 'READY' ? 'OK' : s.status, 'Ferramenta': 'Snapshot de disco', 'Frequência': s.autoCreated ? 'Agendado (política)' : 'Manual', 'Retenção': '—', 'Criado em': String(s.creationTimestamp).slice(0, 10) });
    }
    if (kind === 'servers' || kind === 'baseline') {
      for (const i of aggregated(await get(cfg, `${C}${p}/aggregated/instances`), 'instances')) {
        if (kind === 'baseline') { rows.push({ resource_type: 'Compute Instance', project: p }); continue; }
        const lic = (i.disks || []).flatMap((d) => d.licenses || []).map(U.last)[0] || '';
        rows.push({ 'Name': i.name, 'Internal IP': i.networkInterfaces?.[0]?.networkIP || '', 'Operating System': lic, 'Status': i.status, 'Zone': U.last(i.zone), 'Project': p, 'Machine Type': U.last(i.machineType), 'Labels': Object.entries(i.labels || {}).map(([k, v]) => `${k}=${v}`).join(' '), 'Criado em': String(i.creationTimestamp || '').slice(0, 10) });
      }
    }
    if (kind === 'storage' || kind === 'baseline') {
      for (const d of aggregated(await get(cfg, `${C}${p}/aggregated/disks`), 'disks'))
        rows.push(kind === 'baseline' ? { resource_type: 'Persistent Disk', project: p } : { 'Name': d.name, 'Type': 'Disco ' + U.last(d.type), 'Size': d.sizeGb + ' GB', 'Zone': U.last(d.zone), 'Project': p, 'Status': d.status, 'Criado em': String(d.creationTimestamp || '').slice(0, 10) });
      const sizes = kind === 'baseline' ? {} : await bucketSizes(cfg, p);
      for (const b of (await get(cfg, `https://storage.googleapis.com/storage/v1/b?project=${p}`)).flatMap((x) => x.items || []))
        rows.push(kind === 'baseline' ? { resource_type: 'Cloud Storage Bucket', project: p } : { 'Name': b.name, 'Type': 'Bucket · ' + (b.storageClass || ''), 'Size': sizes[b.name] != null ? gb(sizes[b.name]) : '', 'Zone': b.location, 'Project': p, 'Status': 'available', 'Criado em': String(b.timeCreated || '').slice(0, 10) });
    }
    if (kind === 'network' || kind === 'baseline') {
      const subnets = aggregated(await get(cfg, `${C}${p}/aggregated/subnetworks`), 'subnetworks');
      for (const n of (await get(cfg, `${C}${p}/global/networks`)).flatMap((x) => x.items || [])) {
        if (kind === 'baseline') { rows.push({ resource_type: 'VPC Network', project: p }); continue; }
        const subs = subnets.filter((s) => s.network === n.selfLink);
        rows.push({ 'Network Name': n.name, 'IP range': subs.map((s) => s.ipCidrRange).join(', ') || n.IPv4Range || '', 'Project': p, 'Subnets': subs.map((s) => `${s.name} (${U.last(s.region)} ${s.ipCidrRange})`).join('; '), 'Criado em': String(n.creationTimestamp || '').slice(0, 10) });
      }
    }
  }
  const names = { servers: 'Instâncias GCP (API)', storage: 'Discos + Buckets GCP (API)', network: 'Redes VPC GCP (API)', baseline: 'Recursos GCP (API)', backup: 'Snapshots GCP do período (API)' };
  return [U.sheet(kind, names[kind], rows)];
}

/** Projetos: nome, ID, número e organização/pasta. */
async function tenant(cfg) {
  const rows = [];
  for (const p of await projectsOf(cfg)) {
    const [j] = await get(cfg, `https://cloudresourcemanager.googleapis.com/v1/projects/${p}`);
    rows.push({ 'Projeto': j.name || p, 'Project ID': j.projectId || p, 'Número': j.projectNumber || '', 'Organização / Pasta': j.parent ? `${j.parent.type} ${j.parent.id}` : '' });
  }
  return [U.sheet('tenant', 'Projetos GCP (API)', rows)];
}

const SEV_PT = { CRITICAL: 'Crítica', HIGH: 'Alta', MEDIUM: 'Média', LOW: 'Baixa', SEVERITY_UNSPECIFIED: '' };
const CLASS_PT = { THREAT: 'Ameaça', VULNERABILITY: 'Vulnerabilidade', MISCONFIGURATION: 'Configuração incorreta', OBSERVATION: 'Observação', SCC_ERROR: 'Erro do SCC', POSTURE_VIOLATION: 'Violação de postura', TOXIC_COMBINATION: 'Combinação de riscos' };
/** Security Command Center: achados ativos. Configurações/vulnerabilidades viram recomendações (agrupadas); ameaças viram alertas.
 *  O GCP não tem pontuação nativa: o bloco traz só recomendações e alertas (e a tela avisa). Permissão: roles/securitycenter.findingsViewer. */
async function score(cfg) {
  const recs = {}; const alerts = []; const errs = [];
  for (const p of await projectsOf(cfg)) {
    try {
      for (const page of await get(cfg, `https://securitycenter.googleapis.com/v1/projects/${p}/sources/-/findings?filter=${encodeURIComponent('state="ACTIVE"')}&pageSize=1000`))
        for (const r of page.listFindingsResults || []) {
          const f = r.finding || {}; const sev = SEV_PT[f.severity] ?? f.severity ?? '';
          if (f.findingClass === 'THREAT') { alerts.push({ 'Alerta': f.category || '', 'Severidade': sev, 'Recurso': String(f.resourceName || '').split('/').pop(), 'Data': String(f.eventTime || '').slice(0, 10), 'Status': 'Ativo', 'Projeto': p }); continue; }
          const k = p + '|' + f.category;
          recs[k] = recs[k] || { 'Achado': f.category || '', 'Categoria': CLASS_PT[f.findingClass] || f.findingClass || '', 'Severidade': sev, 'Recursos afetados': 0, 'Projeto': p };
          recs[k]['Recursos afetados']++;
        }
    } catch (e) { errs.push(`${p}: ${e.message}`); }
  }
  if (errs.length && !Object.keys(recs).length && !alerts.length) throw new Error('Security Command Center indisponível (ative o SCC e dê roles/securitycenter.findingsViewer à conta de serviço). ' + errs.join(' | '));
  const ord = { 'Crítica': 0, 'Alta': 1, 'Média': 2, 'Baixa': 3 };
  return [U.sheet('score_recs', 'Achados do Security Command Center', Object.values(recs).sort((a, b) => (ord[a.Severidade] ?? 9) - (ord[b.Severidade] ?? 9) || b['Recursos afetados'] - a['Recursos afetados'])),
    U.sheet('score_alerts', 'Ameaças do Security Command Center', alerts),
    { kind: 'warning', message: 'O GCP não tem uma pontuação de segurança nativa: o bloco traz os achados e as ameaças do Security Command Center (a pontuação pode ser preenchida à mão).' }];
}

module.exports = { label: 'Google Cloud Platform', test, pull, tenant, score };
