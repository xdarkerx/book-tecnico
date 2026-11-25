/* ═══ Conector AWS — assinatura SigV4 nativa (sem SDK) ═══
 * Config (por cliente):
 *   { profile?: 'default', credentialsFile?: '~/.aws/credentials',
 *     accessKeyId?, secretAccessKey?, sessionToken?, regions: 'sa-east-1,us-east-1' }
 * Permissões somente leitura: ec2:Describe*, s3:ListAllMyBuckets, sts:GetCallerIdentity
 */
const crypto = require('crypto');
const U = require('./util');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

/** Assina uma requisição (AWS Signature Version 4). Exportado para teste com o vetor oficial. */
function sign({ method, host, region, service, path = '/', query = {}, body = '', headers = {}, creds, date = new Date() }) {
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const h = Object.assign({}, headers, { host, 'x-amz-date': amzDate });
  if (creds.sessionToken) h['x-amz-security-token'] = creds.sessionToken;
  const payloadHash = sha256(body);
  if (service === 's3') h['x-amz-content-sha256'] = payloadHash;
  const names = Object.keys(h).map((k) => k.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')]));
  const canonicalHeaders = names.map((k) => `${k}:${lower[k]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalQuery = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(query[k])}`).join('&');
  const canonicalRequest = [method, path, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const kSign = ['aws4_request', service, region, day].reduceRight((k, part) => hmac(k, part), 'AWS4' + creds.secretAccessKey);
  // reduceRight aplica day → region → service → aws4_request
  const signature = crypto.createHmac('sha256', kSign).update(toSign).digest('hex');
  h.Authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { headers: h, signature, canonicalQuery };
}

function credentials(cfg) {
  if (cfg.accessKeyId && cfg.secretAccessKey) return { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, sessionToken: cfg.sessionToken };
  const profile = cfg.profile || process.env.AWS_PROFILE || 'default';
  try {
    const ini = U.readIni(cfg.credentialsFile || '~/.aws/credentials')[profile];
    if (ini && ini.aws_access_key_id) return { accessKeyId: ini.aws_access_key_id, secretAccessKey: ini.aws_secret_access_key, sessionToken: ini.aws_session_token };
  } catch (e) { /* sem arquivo */ }
  if (process.env.AWS_ACCESS_KEY_ID) return { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY, sessionToken: process.env.AWS_SESSION_TOKEN };
  throw new Error('Credenciais AWS não encontradas (informe Access Key/Secret ou um profile de ~/.aws/credentials).');
}
const regions = (cfg) => { const r = U.list(cfg.regions); return r.length ? r : ['us-east-1']; };

/** Chamada da Query API (EC2/STS): POST form-urlencoded, resposta XML. Pagina por NextToken. */
async function query(creds, service, region, action, params = {}, version = '2016-11-15') {
  const global = service === 'sts' || service === 'iam';
  const host = global ? `${service}.amazonaws.com` : `${service}.${region}.amazonaws.com`;
  const signRegion = global ? 'us-east-1' : region;
  const pages = []; let token = null;
  do {
    const p = Object.assign({ Action: action, Version: version }, params, token ? { NextToken: token } : {});
    const body = Object.keys(p).sort().map((k) => `${enc(k)}=${enc(p[k])}`).join('&');
    const { headers } = sign({ method: 'POST', host, region: signRegion, service, body, headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' }, creds });
    const res = await U.request(`https://${host}/`, { method: 'POST', headers, body });
    const xml = U.parseXml(await res.text());
    pages.push(xml);
    token = U.text(U.find(xml, 'nextToken')[0] || { text: '' }) || null;
  } while (token && pages.length < 50);
  return pages;
}
const tag = (item, key) => { for (const t of U.all(item, 'tagSet/item')) if (U.text(t, 'key') === key) return U.text(t, 'value'); return ''; };

async function test(cfg) {
  const creds = credentials(cfg);
  const [xml] = await query(creds, 'sts', 'us-east-1', 'GetCallerIdentity', {}, '2011-06-15');
  return { message: `Conectado à conta ${U.text(U.find(xml, 'Account')[0])} (${U.text(U.find(xml, 'Arn')[0])})` };
}

const period = (opts = {}) => ({ from: opts.from ? new Date(opts.from + 'T00:00:00Z') : new Date(Date.now() - 31 * 86400000), to: opts.to ? new Date(opts.to + 'T23:59:59Z') : new Date() });
const inPeriod = (d, p) => { const t = new Date(d); return t >= p.from && t <= p.to; };
async function pull(cfg, kind, opts = {}) {
  const creds = credentials(cfg);
  const regs = regions(cfg);
  if (kind === 'backup') return [U.sheet('backup', 'Snapshots EBS do período (API)', await snapshots(creds, regs, period(opts)))];
  if (kind === 'servers') {
    const rows = [];
    for (const r of regs) for (const page of await query(creds, 'ec2', r, 'DescribeInstances', { MaxResults: '1000' }))
      for (const inst of U.find(page, 'instancesSet').flatMap((s) => U.all(s, 'item'))) {
        rows.push({
          'Name': tag(inst, 'Name') || U.text(inst, 'instanceId'), 'Instance ID': U.text(inst, 'instanceId'),
          'Private IP Address': U.text(inst, 'privateIpAddress'), 'Platform Details': U.text(inst, 'platformDetails') || U.text(inst, 'platform') || 'Linux/UNIX',
          'Instance State': U.text(inst, 'instanceState/name'), 'Availability Zone': U.text(inst, 'placement/availabilityZone'),
          'VPC ID': U.text(inst, 'vpcId'), 'Instance Type': U.text(inst, 'instanceType'), 'Tag:Environment': tag(inst, 'Environment') || tag(inst, 'env'), 'Criado em': U.text(inst, 'launchTime').slice(0, 10)
        });
      }
    return [U.sheet('servers', 'EC2 (API)', rows)];
  }
  if (kind === 'storage') {
    const rows = [];
    for (const r of regs) for (const page of await query(creds, 'ec2', r, 'DescribeVolumes', { MaxResults: '500' }))
      for (const v of U.all(U.child(page, 'DescribeVolumesResponse') || page, 'volumeSet/item'))
        rows.push({ 'Name': tag(v, 'Name') || U.text(v, 'volumeId'), 'Volume Type': 'EBS ' + U.text(v, 'volumeType'), 'Size (GiB)': U.text(v, 'size') + ' GiB', 'Region': U.text(v, 'availabilityZone'), 'State': U.text(v, 'status'), 'Criado em': U.text(v, 'createTime').slice(0, 10) });
    // S3 (global)
    const { headers } = sign({ method: 'GET', host: 's3.amazonaws.com', region: 'us-east-1', service: 's3', creds });
    const xml = U.parseXml(await (await U.request('https://s3.amazonaws.com/', { headers })).text());
    for (const b of U.find(xml, 'Bucket')) rows.push({ 'Name': U.text(b, 'Name'), 'Volume Type': 'S3 Bucket', 'Size (GiB)': '', 'Region': 'global', 'State': 'available', 'Criado em': U.text(b, 'CreationDate').slice(0, 10) });
    return [U.sheet('storage', 'EBS + S3 (API)', rows)];
  }
  if (kind === 'network') {
    const rows = [];
    for (const r of regs) {
      const subnets = {};
      for (const page of await query(creds, 'ec2', r, 'DescribeSubnets', { MaxResults: '1000' }))
        for (const s of U.find(page, 'subnetSet').flatMap((x) => U.all(x, 'item'))) (subnets[U.text(s, 'vpcId')] = subnets[U.text(s, 'vpcId')] || []).push(`${tag(s, 'Name') || U.text(s, 'subnetId')} (${U.text(s, 'cidrBlock')})`);
      for (const page of await query(creds, 'ec2', r, 'DescribeVpcs', { MaxResults: '1000' }))
        for (const v of U.find(page, 'vpcSet').flatMap((x) => U.all(x, 'item')))
          rows.push({ 'VPC Name': tag(v, 'Name') || U.text(v, 'vpcId'), 'CIDR Block': U.text(v, 'cidrBlock'), 'Account ID': U.text(v, 'ownerId'), 'Region': r, 'Subnets': (subnets[U.text(v, 'vpcId')] || []).join('; ') });
    }
    return [U.sheet('network', 'VPCs (API)', rows)];
  }
  if (kind === 'baseline') {
    const rows = [];
    const count = async (r, action, set, type, params = {}) => {
      for (const page of await query(creds, 'ec2', r, action, params))
        for (const it of U.find(page, set).flatMap((x) => U.all(x, 'item'))) rows.push({ resource_type: type, region: r });
    };
    for (const r of regs) {
      await count(r, 'DescribeInstances', 'instancesSet', 'EC2 Instance', { MaxResults: '1000' });
      await count(r, 'DescribeVolumes', 'volumeSet', 'EBS Volume', { MaxResults: '500' });
      await count(r, 'DescribeVpcs', 'vpcSet', 'VPC');
      await count(r, 'DescribeSubnets', 'subnetSet', 'Subnet');
      await count(r, 'DescribeSecurityGroups', 'securityGroupInfo', 'Security Group');
      await count(r, 'DescribeSnapshots', 'snapshotSet', 'EBS Snapshot', { 'Owner.1': 'self', MaxResults: '1000' });
    }
    return [U.sheet('baseline', 'Recursos AWS (API)', rows)];
  }
  return [];
}

const SEV_PT = { CRITICAL: 'Crítica', HIGH: 'Alta', MEDIUM: 'Média', LOW: 'Baixa', MINOR: 'Baixa', INFORMATIONAL: 'Informativa', INFO: 'Informativa' };
const sevPt = (s) => SEV_PT[String(s || '').toUpperCase()] || String(s || '');
/** Geral › Tenant (formato AWS). */
async function tenant(cfg) {
  const creds = credentials(cfg);
  const [xml] = await query(creds, 'sts', 'us-east-1', 'GetCallerIdentity', {}, '2011-06-15');
  let alias = '';
  try { const [ax] = await query(creds, 'iam', 'us-east-1', 'ListAccountAliases', {}, '2010-05-08'); alias = U.text(U.find(ax, 'member')[0] || { text: '' }); } catch (e) { /* sem iam:ListAccountAliases */ }
  const acc = U.text(U.find(xml, 'Account')[0]);
  return [U.sheet('tenant', 'Conta AWS (API)', [{ 'Conta': alias || acc, 'Account ID': acc, 'Alias': alias, 'ARN': U.text(U.find(xml, 'Arn')[0]), 'Regiões': regions(cfg).join(', ') }])];
}
/** Security Hub: findings paginados com filtro. */
async function findings(creds, r, filters, maxPages = 100) {
  const all = []; let token; let n = 0;
  do {
    const body = JSON.stringify(Object.assign({ MaxResults: 100, Filters: filters }, token ? { NextToken: token } : {}));
    const host = `securityhub.${r}.amazonaws.com`;
    const { headers } = sign({ method: 'POST', host, region: r, service: 'securityhub', path: '/findings', body, headers: { 'content-type': 'application/json' }, creds });
    const j = await (await U.request(`https://${host}/findings`, { method: 'POST', headers, body })).json();
    all.push(...(j.Findings || [])); token = j.NextToken;
  } while (token && ++n < maxPages);
  return all;
}
const EQ = (v) => [{ Value: v, Comparison: 'EQUALS' }];
/** Security Hub: % de controles aprovados, controles reprovados (recomendações) e findings críticos/altos de outros serviços (alertas). */
async function score(cfg) {
  const creds = credentials(cfg);
  const scores = []; const recs = {}; const alerts = [];
  for (const r of regions(cfg)) {
    const status = {};
    for (const f of await findings(creds, r, { ProductName: EQ('Security Hub'), RecordState: EQ('ACTIVE'), WorkflowStatus: [{ Value: 'SUPPRESSED', Comparison: 'NOT_EQUALS' }] })) {
      const id = (f.Compliance && f.Compliance.SecurityControlId) || f.GeneratorId; const st = f.Compliance && f.Compliance.Status;
      if (!id || !st) continue;
      if (st === 'FAILED') {
        status[id] = 'FAILED';
        const k = r + '|' + id;
        recs[k] = recs[k] || { 'Controle': id, 'Título': f.Title || '', 'Severidade': sevPt(f.Severity && f.Severity.Label), 'Recursos reprovados': 0, 'Região': r };
        recs[k]['Recursos reprovados']++;
      } else if (st === 'PASSED' && !status[id]) status[id] = 'PASSED';
    }
    const v = Object.values(status); const ok = v.filter((x) => x === 'PASSED').length;
    if (v.length) scores.push({ 'Fonte': 'AWS Security Hub', 'Escopo': r, 'Pontuação': Math.round((ok / v.length) * 100), 'Máximo': 100, 'Classificação': `${ok} de ${v.length} controles aprovados` });
    try {
      for (const f of await findings(creds, r, { ProductName: [{ Value: 'Security Hub', Comparison: 'NOT_EQUALS' }], RecordState: EQ('ACTIVE'), SeverityLabel: [...EQ('CRITICAL'), ...EQ('HIGH')], WorkflowStatus: [...EQ('NEW'), ...EQ('NOTIFIED')] }, 5))
        alerts.push({ 'Título': f.Title || '', 'Produto': f.ProductName || '', 'Severidade': sevPt(f.Severity && f.Severity.Label), 'Recurso': ((f.Resources || [])[0] || {}).Id || '', 'Última ocorrência': String(f.LastObservedAt || f.UpdatedAt || '').slice(0, 10) });
    } catch (e) { /* alertas são opcionais */ }
  }
  if (!scores.length) throw new Error('Security Hub sem controles avaliados nas regiões informadas (habilite o Security Hub e um padrão, ex.: AWS Foundational Security Best Practices).');
  const ord = { 'Crítica': 0, 'Alta': 1, 'Média': 2, 'Baixa': 3 };
  const recList = Object.values(recs).sort((a, b) => (ord[a.Severidade] ?? 9) - (ord[b.Severidade] ?? 9) || b['Recursos reprovados'] - a['Recursos reprovados']);
  return [U.sheet('score', 'Security Hub (API)', scores), U.sheet('score_recs', 'Controles reprovados (Security Hub)', recList), U.sheet('score_alerts', 'Findings críticos/altos', alerts)];
}

/** Backup do período: snapshots EBS (manuais, AWS Backup e Data Lifecycle Manager). */
async function snapshots(creds, regs, p) {
  const rows = [];
  const ST = { completed: 'OK', pending: 'Em andamento', error: 'Falha', recoverable: 'Recuperável', recovering: 'Recuperando' };
  for (const r of regs) for (const page of await query(creds, 'ec2', r, 'DescribeSnapshots', { 'Owner.1': 'self', MaxResults: '1000' }))
    for (const s of U.find(page, 'snapshotSet').flatMap((x) => U.all(x, 'item'))) {
      const start = U.text(s, 'startTime');
      if (!inPeriod(start, p)) continue;
      const desc = U.text(s, 'description');
      const how = /AWS Backup/i.test(desc) ? 'AWS Backup (plano)' : tag(s, 'dlm:managed') || /Data Lifecycle/i.test(desc) ? 'Agendado (DLM)' : 'Manual';
      rows.push({ 'Item': tag(s, 'Name') || `${U.text(s, 'volumeId')} (${U.text(s, 'volumeSize')} GiB)`, 'Situação': ST[U.text(s, 'status')] || U.text(s, 'status'), 'Ferramenta': 'Snapshot EBS',
        'Frequência': how, 'Retenção': '—', 'Teste Restore': '—', 'Criado em': start.slice(0, 10), 'Região': r });
    }
  return rows.sort((a, b) => String(b['Criado em']).localeCompare(a['Criado em']));
}

module.exports = { label: 'Amazon Web Services', test, pull, tenant, score, sign };
