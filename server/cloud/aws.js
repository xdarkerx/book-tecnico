/* ═══ Conector AWS — assinatura SigV4 nativa (sem SDK) ═══
 * Config (por cliente):
 *   { profile?: 'default', credentialsFile?: '~/.aws/credentials',
 *     accessKeyId?, secretAccessKey?, sessionToken?, regions: 'sa-east-1,us-east-1' }
 * Permissões somente leitura: ec2:Describe*, s3:ListAllMyBuckets, s3:GetBucketLocation, cloudwatch:GetMetricStatistics,
 *   sts:GetCallerIdentity, backup:List*, dlm:Get*, securityhub:GetFindings, iam:ListAccountAliases (ou a política ReadOnlyAccess)
 * Regiões: as informadas na conexão ou, se vazio, todas as regiões habilitadas na conta.
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
/** Regiões a consultar: as da conexão ou, se vazio, todas as habilitadas na conta (DescribeRegions). */
async function regionsOf(creds, cfg) {
  if (U.list(cfg.regions).length) return U.list(cfg.regions);
  try {
    const [xml] = await query(creds, 'ec2', 'us-east-1', 'DescribeRegions', {});
    const list = U.find(xml, 'regionInfo').flatMap((x) => U.all(x, 'item')).filter((r) => !/not-opted-in/.test(U.text(r, 'optInStatus'))).map((r) => U.text(r, 'regionName')).filter(Boolean);
    return list.length ? list : ['us-east-1'];
  } catch (e) { return ['us-east-1']; }
}

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
  const regs = await regionsOf(creds, cfg);
  if (kind === 'backup') return [U.sheet('backup', 'Backup AWS (API)', [...(wantPolicies(opts) ? await backupPlans(creds, regs) : []), ...(wantJobs(opts) ? [...await backupJobs(creds, regs, period(opts)), ...await snapshots(creds, regs, period(opts), { skipAwsBackup: true })] : [])])];
  if (kind === 'servers') {
    const rows = [];
    for (const r of regs) {
      const insts = [];
      for (const page of await query(creds, 'ec2', r, 'DescribeInstances', { MaxResults: '1000' })) insts.push(...U.find(page, 'instancesSet').flatMap((s) => U.all(s, 'item')));
      // SO pelo nome/descrição da imagem (AMI): "Windows Server 2019…", "Amazon Linux 2023…" em vez de "Linux/UNIX"
      const amis = {};
      const ids = [...new Set(insts.map((i) => U.text(i, 'imageId')).filter(Boolean))];
      for (let k = 0; k < ids.length; k += 100) {
        try {
          const params = {}; ids.slice(k, k + 100).forEach((id, n) => (params[`ImageId.${n + 1}`] = id));
          for (const page of await query(creds, 'ec2', r, 'DescribeImages', params))
            for (const im of U.find(page, 'imagesSet').flatMap((x) => U.all(x, 'item'))) amis[U.text(im, 'imageId')] = U.text(im, 'description') || U.text(im, 'name');
        } catch (e) { /* AMI apagada ou sem permissão: fica o platformDetails */ }
      }
      for (const inst of insts) {
        const os = amis[U.text(inst, 'imageId')];
        rows.push({
          'Name': tag(inst, 'Name') || U.text(inst, 'instanceId'), 'Instance ID': U.text(inst, 'instanceId'),
          'Private IP Address': U.text(inst, 'privateIpAddress'), 'Platform Details': (os && os.length <= 80 ? os : '') || U.text(inst, 'platformDetails') || U.text(inst, 'platform') || 'Linux/UNIX',
          'Instance State': U.text(inst, 'instanceState/name'), 'Availability Zone': U.text(inst, 'placement/availabilityZone'),
          'VPC ID': U.text(inst, 'vpcId'), 'Instance Type': U.text(inst, 'instanceType'), 'Tag:Environment': tag(inst, 'Environment') || tag(inst, 'env'), 'Criado em': U.text(inst, 'launchTime').slice(0, 10)
        });
      }
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
    // tamanho de cada bucket: região (GetBucketLocation) + métrica BucketSizeBytes do CloudWatch
    await U.pool(U.find(xml, 'Bucket'), 6, async (b) => {
      const name = U.text(b, 'Name'); let region = 'us-east-1', size = '';
      try {
        const h = sign({ method: 'GET', host: 's3.amazonaws.com', region: 'us-east-1', service: 's3', path: '/' + encodeURIComponent(name), query: { location: '' }, creds }).headers;
        region = U.text(U.parseXml(await (await U.request(`https://s3.amazonaws.com/${encodeURIComponent(name)}?location=`, { headers: h })).text()), 'LocationConstraint') || 'us-east-1';
      } catch (e) { /* sem s3:GetBucketLocation */ }
      try { const bytes = await s3Size(creds, region, name); if (bytes != null) size = gb(bytes); } catch (e) { /* sem cloudwatch:GetMetricStatistics */ }
      rows.push({ 'Name': name, 'Volume Type': 'S3 Bucket', 'Size (GiB)': size, 'Region': region, 'State': 'available', 'Criado em': U.text(b, 'CreationDate').slice(0, 10) });
    });
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
  return [U.sheet('tenant', 'Conta AWS (API)', [{ 'Conta': alias || acc, 'Account ID': acc, 'Alias': alias, 'ARN': U.text(U.find(xml, 'Arn')[0]), 'Regiões': (await regionsOf(creds, cfg)).join(', ') }])];
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
  for (const r of await regionsOf(creds, cfg)) {
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

// opts.backupMode: 'jobs' = só backups feitos no período · 'policies' = só políticas/agendamentos · 'both' (padrão)
const wantJobs = (o) => (o.backupMode || 'both') !== 'policies';
const wantPolicies = (o) => (o.backupMode || 'both') !== 'jobs';
/** GET assinado de uma API REST JSON da AWS (AWS Backup, DLM). */
async function restGet(creds, service, r, path, query = {}) {
  const host = `${service}.${r}.amazonaws.com`;
  const { headers, canonicalQuery } = sign({ method: 'GET', host, region: r, service, path, query, creds });
  return (await U.request(`https://${host}${path}${canonicalQuery ? '?' + canonicalQuery : ''}`, { headers })).json();
}
/** Backups feitos no período pelo AWS Backup (EC2, EBS, RDS, EFS, DynamoDB…). */
async function backupJobs(creds, regs, p) {
  const rows = [];
  const ST = { COMPLETED: 'OK', FAILED: 'Falha', ABORTED: 'Abortado', EXPIRED: 'Expirado', RUNNING: 'Em andamento', CREATED: 'Em andamento', PENDING: 'Em andamento', PARTIAL: 'Parcial' };
  for (const r of regs) {
    try {
      let token = null; let n = 0;
      do {
        const q = Object.assign({ createdAfter: p.from.toISOString(), createdBefore: p.to.toISOString(), maxResults: '1000' }, token ? { nextToken: token } : {});
        const j = await restGet(creds, 'backup', r, '/backup-jobs/', q);
        for (const b of j.BackupJobs || []) {
          const created = typeof b.CreationDate === 'number' ? new Date(b.CreationDate * 1000) : new Date(b.CreationDate);
          rows.push({ 'Item': `${String(b.ResourceArn || '').split(/[:/]/).pop()} (${b.ResourceType || ''})`, 'Situação': ST[b.State] || b.State, 'Ferramenta': `AWS Backup (${b.BackupVaultName || 'cofre'})`,
            'Frequência': b.CreatedBy && b.CreatedBy.BackupPlanId ? 'Agendado (plano)' : 'Sob demanda', 'Retenção': '—', 'Criado em': created.toISOString().slice(0, 10), 'Região': r });
        }
        token = j.NextToken;
      } while (token && ++n < 20);
    } catch (e) { /* sem AWS Backup na região ou sem permissão backup:ListBackupJobs */ }
  }
  return rows;
}
/** bytes → "12,3 GB" (ou MB/TB) */
const gb = (n) => { n = Number(n) || 0; const u = n >= 1e12 ? [1e12, 'TB'] : n >= 1e9 ? [1e9, 'GB'] : [1e6, 'MB']; return (Math.round((n / u[0]) * 10) / 10).toLocaleString('pt-BR') + ' ' + u[1]; };
/** Tamanho do bucket S3 (soma das classes de armazenamento), métrica diária do CloudWatch. */
async function s3Size(creds, region, bucket) {
  let total = null;
  for (const st of ['StandardStorage', 'StandardIAStorage', 'OneZoneIAStorage', 'IntelligentTieringFAStorage', 'GlacierStorage', 'DeepArchiveStorage']) {
    const now = new Date();
    const [xml] = await query(creds, 'monitoring', region, 'GetMetricStatistics', { Namespace: 'AWS/S3', MetricName: 'BucketSizeBytes', 'Dimensions.member.1.Name': 'BucketName', 'Dimensions.member.1.Value': bucket,
      'Dimensions.member.2.Name': 'StorageType', 'Dimensions.member.2.Value': st, StartTime: new Date(now - 3 * 86400000).toISOString(), EndTime: now.toISOString(), Period: '86400', 'Statistics.member.1': 'Average' }, '2010-08-01');
    const pts = U.find(xml, 'member').map((m) => ({ t: U.text(m, 'Timestamp'), v: parseFloat(U.text(m, 'Average')) })).filter((p) => p.t && !isNaN(p.v)).sort((a, b) => a.t.localeCompare(b.t));
    if (pts.length) total = (total || 0) + pts[pts.length - 1].v;
    if (st === 'StandardStorage' && total == null) break; // bucket vazio ou sem métrica: não insiste nas outras classes
  }
  return total;
}
const cronTxt = (e) => { const m = String(e || '').match(/cron\((\S+) (\S+) (\S+) (\S+) (\S+) (\S+)\)/); if (!m) return String(e || ''); const [, mi, hr, dom, , dow] = m; return `${dow !== '?' && dow !== '*' ? 'Semanal (' + dow + ')' : dom !== '*' && dom !== '?' ? 'Mensal (dia ' + dom + ')' : 'Diário'} ${hr.padStart(2, '0')}:${mi.padStart(2, '0')} UTC`; };
/** Políticas: planos do AWS Backup (regras com agenda e retenção) e políticas do Data Lifecycle Manager. */
async function backupPlans(creds, regs) {
  const rows = [];
  for (const r of regs) {
    try {
      for (const p of (await restGet(creds, 'backup', r, '/backup/plans/')).BackupPlansList || []) {
        const plan = (await restGet(creds, 'backup', r, `/backup/plans/${p.BackupPlanId}/`)).BackupPlan || {};
        const rules = plan.Rules || [];
        rows.push({ 'Item': p.BackupPlanName, 'Situação': 'Política ativa', 'Ferramenta': 'Plano do AWS Backup', 'Frequência': rules.map((x) => `${x.RuleName}: ${cronTxt(x.ScheduleExpression)}`).join('; ') || '—',
          'Retenção': [...new Set(rules.map((x) => (x.Lifecycle && x.Lifecycle.DeleteAfterDays ? x.Lifecycle.DeleteAfterDays + ' dias' : '')).filter(Boolean))].join(' / ') || '—', 'Criado em': '', 'Região': r });
      }
    } catch (e) { /* sem AWS Backup na região ou sem permissão backup:ListBackupPlans */ }
    try {
      for (const p of (await restGet(creds, 'dlm', r, '/policies')).Policies || [])
        rows.push({ 'Item': p.Description || p.PolicyId, 'Situação': p.State === 'ENABLED' ? 'Política ativa' : 'Política ' + String(p.State || '').toLowerCase(), 'Ferramenta': 'Data Lifecycle Manager', 'Frequência': p.PolicyType || '—', 'Retenção': '—', 'Criado em': '', 'Região': r });
    } catch (e) { /* sem DLM ou sem permissão dlm:GetLifecyclePolicies */ }
  }
  return rows;
}
/** Backup do período: snapshots EBS (manuais, AWS Backup e Data Lifecycle Manager). */
async function snapshots(creds, regs, p, o = {}) {
  const rows = [];
  const ST = { completed: 'OK', pending: 'Em andamento', error: 'Falha', recoverable: 'Recuperável', recovering: 'Recuperando' };
  for (const r of regs) for (const page of await query(creds, 'ec2', r, 'DescribeSnapshots', { 'Owner.1': 'self', MaxResults: '1000' }))
    for (const s of U.find(page, 'snapshotSet').flatMap((x) => U.all(x, 'item'))) {
      const start = U.text(s, 'startTime');
      if (!inPeriod(start, p)) continue;
      const desc = U.text(s, 'description');
      if (o.skipAwsBackup && /AWS Backup/i.test(desc)) continue; // já aparece nos jobs do AWS Backup
      const how = /AWS Backup/i.test(desc) ? 'AWS Backup (plano)' : tag(s, 'dlm:managed') || /Data Lifecycle/i.test(desc) ? 'Agendado (DLM)' : 'Manual';
      rows.push({ 'Item': tag(s, 'Name') || `${U.text(s, 'volumeId')} (${U.text(s, 'volumeSize')} GiB)`, 'Situação': ST[U.text(s, 'status')] || U.text(s, 'status'), 'Ferramenta': 'Snapshot EBS',
        'Frequência': how, 'Retenção': '—', 'Criado em': start.slice(0, 10), 'Região': r });
    }
  return rows.sort((a, b) => String(b['Criado em']).localeCompare(a['Criado em']));
}

/** Amazon Inspector: vulnerabilidades de pacotes (CVEs) ativas nas instâncias EC2, imagens e funções. Permissão: inspector2:ListFindings. */
async function vulns(cfg) {
  const creds = credentials(cfg);
  const V = require('./vulns');
  const list = []; const errs = []; let ok = 0;
  for (const r of await regionsOf(creds, cfg)) {
    try {
      let token; let n = 0;
      do {
        const body = JSON.stringify(Object.assign({ maxResults: 100, filterCriteria: { findingStatus: [{ comparison: 'EQUALS', value: 'ACTIVE' }], findingType: [{ comparison: 'EQUALS', value: 'PACKAGE_VULNERABILITY' }] } }, token ? { nextToken: token } : {}));
        const host = `inspector2.${r}.amazonaws.com`;
        const { headers } = sign({ method: 'POST', host, region: r, service: 'inspector2', path: '/findings/list', body, headers: { 'content-type': 'application/json' }, creds });
        const j = await (await U.request(`https://${host}/findings/list`, { method: 'POST', headers, body })).json();
        ok++;
        for (const f of j.findings || []) {
          const d = f.packageVulnerabilityDetails || {};
          const res = (f.resources || [])[0] || {};
          const name = (res.tags && (res.tags.Name || res.tags.name)) || String(res.id || '').split('/').pop();
          const pk = (d.vulnerablePackages || [])[0] || {};
          list.push({ cve: d.vulnerabilityId, title: f.title, severity: f.severity, cvss: f.inspectorScore ?? ((d.cvss || [])[0] || {}).baseScore, host: name,
            fix: (f.remediation && f.remediation.recommendation && f.remediation.recommendation.text) || (pk.fixedInVersion ? `Atualizar ${pk.name} para ${pk.fixedInVersion}` : ''), pkg: pk.name ? `${pk.name} ${pk.version || ''}`.trim() : '' });
        }
        token = j.nextToken;
      } while (token && ++n < 50);
    } catch (e) { errs.push(`${r}: ${e.message}`); }
  }
  if (!ok) throw new Error('Amazon Inspector indisponível (ative o Inspector e a permissão inspector2:ListFindings). ' + (errs[0] || ''));
  return [V.aggregate(list, 'Amazon Inspector')];
}

module.exports = { label: 'Amazon Web Services', test, pull, tenant, score, vulns, sign, regionsOf };
