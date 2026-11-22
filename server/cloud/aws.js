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
  const host = service === 'sts' ? 'sts.amazonaws.com' : `${service}.${region}.amazonaws.com`;
  const signRegion = service === 'sts' ? 'us-east-1' : region;
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

async function pull(cfg, kind) {
  const creds = credentials(cfg);
  const regs = regions(cfg);
  if (kind === 'servers') {
    const rows = [];
    for (const r of regs) for (const page of await query(creds, 'ec2', r, 'DescribeInstances', { MaxResults: '1000' }))
      for (const inst of U.find(page, 'instancesSet').flatMap((s) => U.all(s, 'item'))) {
        rows.push({
          'Name': tag(inst, 'Name') || U.text(inst, 'instanceId'), 'Instance ID': U.text(inst, 'instanceId'),
          'Private IP Address': U.text(inst, 'privateIpAddress'), 'Platform Details': U.text(inst, 'platformDetails') || U.text(inst, 'platform') || 'Linux/UNIX',
          'Instance State': U.text(inst, 'instanceState/name'), 'Availability Zone': U.text(inst, 'placement/availabilityZone'),
          'VPC ID': U.text(inst, 'vpcId'), 'Instance Type': U.text(inst, 'instanceType'), 'Tag:Environment': tag(inst, 'Environment') || tag(inst, 'env')
        });
      }
    return [U.sheet('servers', 'EC2 (API)', rows)];
  }
  if (kind === 'storage') {
    const rows = [];
    for (const r of regs) for (const page of await query(creds, 'ec2', r, 'DescribeVolumes', { MaxResults: '500' }))
      for (const v of U.all(U.child(page, 'DescribeVolumesResponse') || page, 'volumeSet/item'))
        rows.push({ 'Name': tag(v, 'Name') || U.text(v, 'volumeId'), 'Volume Type': 'EBS ' + U.text(v, 'volumeType'), 'Size (GiB)': U.text(v, 'size') + ' GiB', 'Region': U.text(v, 'availabilityZone'), 'State': U.text(v, 'status') });
    // S3 (global)
    const { headers } = sign({ method: 'GET', host: 's3.amazonaws.com', region: 'us-east-1', service: 's3', creds });
    const xml = U.parseXml(await (await U.request('https://s3.amazonaws.com/', { headers })).text());
    for (const b of U.find(xml, 'Bucket')) rows.push({ 'Name': U.text(b, 'Name'), 'Volume Type': 'S3 Bucket', 'Size (GiB)': '', 'Region': 'global', 'State': 'available' });
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

module.exports = { label: 'Amazon Web Services', test, pull, sign };
