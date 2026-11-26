/* ═══ Conector OCI — assinatura HTTP (draft-cavage, rsa-sha256) nativa, sem SDK ═══
 * Config (por cliente), uma das formas:
 *   A) { configFile: '~/.oci/config', profile: 'DEFAULT', regions? }
 *   B) { tenancy, user, fingerprint, region, regions?, keyFile?: '~/.oci/key.pem' | keyPem?: '-----BEGIN…', passphrase? }
 * Opcional: compartmentId (raiz da busca; padrão = tenancy inteira)
 * Política somente leitura sugerida:  Allow group BookReaders to inspect all-resources in tenancy
 *                                    Allow group BookReaders to read instances, volumes, vcns, buckets in tenancy
 */
const crypto = require('crypto');
const U = require('./util');

function config(cfg) {
  let c = Object.assign({}, cfg);
  if (cfg.configFile || (!cfg.tenancy && !cfg.keyPem)) {
    const ini = U.readIni(cfg.configFile || '~/.oci/config')[cfg.profile || 'DEFAULT'];
    if (!ini) throw new Error(`Profile "${cfg.profile || 'DEFAULT'}" não encontrado no config OCI.`);
    c = Object.assign({ tenancy: ini.tenancy, user: ini.user, fingerprint: ini.fingerprint, region: ini.region, keyFile: ini.key_file, passphrase: ini.pass_phrase }, cfg);
  }
  ['tenancy', 'user', 'fingerprint', 'region'].forEach((k) => { if (!c[k]) throw new Error(`Configuração OCI incompleta: falta "${k}".`); });
  const pem = c.keyPem || U.readFile(c.keyFile);
  c.key = crypto.createPrivateKey({ key: pem, passphrase: c.passphrase || undefined });
  c.regionList = U.list(c.regions).length ? U.list(c.regions) : [c.region];
  return c;
}

/** Assina e executa uma chamada à API da OCI. */
async function call(c, method, url, body) {
  const u = new URL(url);
  const headers = { date: new Date().toUTCString(), host: u.host };
  const names = ['(request-target)', 'date', 'host'];
  let payload;
  if (body !== undefined) {
    payload = body === '' ? '' : JSON.stringify(body); // '' = POST sem corpo (ex.: Cloud Guard securityScores)
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(Buffer.byteLength(payload));
    headers['x-content-sha256'] = crypto.createHash('sha256').update(payload).digest('base64');
    names.push('x-content-sha256', 'content-type', 'content-length');
  }
  const signing = names.map((n) => (n === '(request-target)' ? `(request-target): ${method.toLowerCase()} ${u.pathname}${u.search}` : `${n}: ${headers[n]}`)).join('\n');
  const signature = crypto.sign('sha256', Buffer.from(signing), c.key).toString('base64');
  headers.authorization = `Signature version="1",keyId="${c.tenancy}/${c.user}/${c.fingerprint}",algorithm="rsa-sha256",headers="${names.join(' ')}",signature="${signature}"`;
  const res = await U.request(url, { method, headers, body: payload });
  const txt = await res.text();
  return { data: txt ? JSON.parse(txt) : null, next: res.headers.get('opc-next-page') };
}
/** Lista paginada (opc-next-page). */
async function listAll(c, url, max = 100) {
  const out = []; let page = null; let n = 0;
  do {
    const sep = url.includes('?') ? '&' : '?';
    const r = await call(c, 'GET', url + (page ? `${sep}page=${encodeURIComponent(page)}` : ''));
    out.push(...(Array.isArray(r.data) ? r.data : r.data?.items || []));
    page = r.next;
  } while (page && ++n < max);
  return out;
}

const iaas = (r) => `https://iaas.${r}.oraclecloud.com/20160918`;

/** Compartimentos ativos com caminho legível (ex.: "prod/db"). */
async function compartments(c) {
  const root = c.compartmentId || c.tenancy;
  const list = await listAll(c, `https://identity.${c.region}.oraclecloud.com/20160918/compartments?compartmentId=${root}&compartmentIdInSubtree=true&accessLevel=ACCESSIBLE&lifecycleState=ACTIVE&limit=1000`);
  const byId = Object.fromEntries(list.map((x) => [x.id, x]));
  const pathOf = (x) => { const p = []; let cur = x; while (cur) { p.unshift(cur.name); cur = byId[cur.compartmentId]; } return p.join('/'); };
  return [{ id: root, path: root === c.tenancy ? '(raiz)' : (byId[root]?.name || root) }, ...list.map((x) => ({ id: x.id, path: pathOf(x) }))];
}

async function test(cfg) {
  const c = config(cfg);
  const comps = await compartments(c);
  return { message: `Conectado à tenancy (${c.region}) — ${comps.length} compartimento(s) acessível(is)` };
}

/** Regiões a consultar: as informadas na conexão ou, se vazio, todas as regiões assinadas da tenancy. */
async function regionsOf(c, cfg) {
  if (String(cfg.regions || '').trim()) return c.regionList;
  try {
    const subs = (await call(c, 'GET', `https://identity.${c.region}.oraclecloud.com/20160918/tenancies/${c.tenancy}/regionSubscriptions`)).data || [];
    const list = subs.filter((s) => !s.status || s.status === 'READY').map((s) => s.regionName).filter(Boolean);
    return list.length ? list : c.regionList;
  } catch (e) { return c.regionList; }
}
const day = (t) => String(t || '').slice(0, 10);
/** bytes → "12,3 GB" (ou MB/TB) */
const gb = (n) => { n = Number(n) || 0; const u = n >= 1e12 ? [1e12, 'TB'] : n >= 1e9 ? [1e9, 'GB'] : [1e6, 'MB']; return (Math.round((n / u[0]) * 10) / 10).toLocaleString('pt-BR') + ' ' + u[1]; };

async function pull(cfg, kind, opts = {}) {
  const c = config(cfg);
  c.regionList = await regionsOf(c, cfg);
  const comps = await compartments(c);
  const rows = [];
  const topo = require('./topology').model();
  if (kind === 'backup') return [U.sheet('backup', 'Backups OCI do período (API)', await backups(c, comps, opts))];

  if (kind === 'baseline') {
    // Resource Search: todos os recursos da tenancy em uma consulta
    for (const r of c.regionList) {
      let page = null; let n = 0;
      do {
        const res = await call(c, 'POST', `https://query.${r}.oraclecloud.com/20180409/resources?limit=1000${page ? '&page=' + encodeURIComponent(page) : ''}`, { type: 'Structured', query: "query all resources where lifeCycleState != 'TERMINATED' && lifeCycleState != 'DELETED'" });
        for (const it of res.data?.items || []) rows.push({ resource_type: it.resourceType, resource_name: it.displayName, region_name: r, compartment_name: comps.find((x) => x.id === it.compartmentId)?.path || '' });
        page = res.next;
      } while (page && ++n < 50);
    }
    return [U.sheet('baseline', 'Recursos OCI (Resource Search)', rows)];
  }

  for (const r of c.regionList) {
    if (kind === 'servers') {
      const images = {};
      await U.pool(comps, 4, async (comp) => {
        const insts = (await listAll(c, `${iaas(r)}/instances?compartmentId=${comp.id}&limit=1000`)).filter((i) => i.lifecycleState !== 'TERMINATED');
        await U.pool(insts, 6, async (i) => {
          let ip = '';
          try {
            const att = (await listAll(c, `${iaas(r)}/vnicAttachments?compartmentId=${comp.id}&instanceId=${i.id}`)).find((a) => a.lifecycleState === 'ATTACHED');
            if (att) ip = (await call(c, 'GET', `${iaas(r)}/vnics/${att.vnicId}`)).data?.privateIp || '';
          } catch (e) { /* sem permissão para VNIC: segue sem IP */ }
          if (i.imageId && images[i.imageId] === undefined) {
            images[i.imageId] = '';
            // SO pelos campos da imagem ("Oracle Linux 9.4", "Windows Server 2019"); o nome da imagem personalizada só se não houver
            try { const im = (await call(c, 'GET', `${iaas(r)}/images/${i.imageId}`)).data || {}; images[i.imageId] = [im.operatingSystem, im.operatingSystemVersion].filter((x) => x && !/^custom$/i.test(x)).join(' ') || im.displayName || ''; } catch (e) {}
          }
          rows.push({ 'Display Name': i.displayName, 'Private IP': ip, 'Image': images[i.imageId] || '', 'Lifecycle State': i.lifecycleState, 'Region': i.region || r,
            'compartment_path': comp.path, 'Shape': i.shape, 'OCPUs': i.shapeConfig?.ocpus ?? '', 'Memory (GB)': i.shapeConfig?.memoryInGBs ?? '', 'Availability Domain': i.availabilityDomain, 'Criado em': day(i.timeCreated) });
        });
      });
    }
    if (kind === 'storage') {
      let ns = null;
      try { ns = (await call(c, 'GET', `https://objectstorage.${r}.oraclecloud.com/n/`)).data; } catch (e) {}
      await U.pool(comps, 4, async (comp) => {
        for (const v of await listAll(c, `${iaas(r)}/volumes?compartmentId=${comp.id}&limit=1000`))
          if (v.lifecycleState !== 'TERMINATED') rows.push({ 'Display Name': v.displayName, 'Volume Type': 'Block Volume', 'Size in GBs': v.sizeInGBs + ' GB', 'Region': r, 'compartment_path': comp.path, 'Lifecycle State': v.lifecycleState, 'Criado em': day(v.timeCreated) });
        if (ns) {
          const buckets = await listAll(c, `https://objectstorage.${r}.oraclecloud.com/n/${ns}/b?compartmentId=${comp.id}&limit=1000`);
          // tamanho aproximado de cada bucket (GetBucket ?fields=approximateSize; sem permissão fica em branco)
          await U.pool(buckets, 6, async (b) => {
            let size = '';
            try { const d = (await call(c, 'GET', `https://objectstorage.${r}.oraclecloud.com/n/${ns}/b/${encodeURIComponent(b.name)}?fields=approximateSize,approximateCount`)).data || {}; if (d.approximateSize != null) size = gb(d.approximateSize); } catch (e) { /* segue sem tamanho */ }
            rows.push({ 'Display Name': b.name, 'Volume Type': 'Object Storage', 'Size in GBs': size, 'Region': r, 'compartment_path': comp.path, 'Lifecycle State': 'AVAILABLE', 'Criado em': day(b.timeCreated) });
          });
        }
      });
    }
    if (kind === 'network') {
      // topologia: gateways de cada VCN, LPGs (peering local), DRGs (anexos, IPSec e FastConnect)
      const opt = (url) => listAll(c, url).catch(() => []);
      const lpgs = []; const drgAtt = []; const ipsec = []; const vcs = [];
      await U.pool(comps, 4, async (comp) => {
        const q = `compartmentId=${comp.id}&limit=1000`;
        for (const d of await opt(`${iaas(r)}/drgs?${q}`)) topo.hub(d.id, 'DRG', d.displayName, r);
        drgAtt.push(...await opt(`${iaas(r)}/drgAttachments?${q}`));
        ipsec.push(...await opt(`${iaas(r)}/ipsecConnections?${q}`));
        vcs.push(...await opt(`${iaas(r)}/virtualCircuits?${q}`));
        const vcns = await listAll(c, `${iaas(r)}/vcns?${q}`);
        if (!vcns.length) return;
        const subnets = await listAll(c, `${iaas(r)}/subnets?${q}`);
        for (const v of vcns) rows.push({ 'VCN Name': v.displayName, 'CIDRs': (v.cidrBlocks || [v.cidrBlock]).filter(Boolean).join(', '), 'compartment_path': comp.path, 'Region': r,
          'Subnets': subnets.filter((s) => s.vcnId === v.id).map((s) => `${s.displayName} (${s.cidrBlock})`).join('; '), 'Criado em': day(v.timeCreated) });
        const [igw, nat, sgw, lpg] = await Promise.all(['internetGateways', 'natGateways', 'serviceGateways', 'localPeeringGateways'].map((t) => opt(`${iaas(r)}/${t}?${q}`)));
        lpgs.push(...lpg);
        for (const v of vcns) {
          const gws = [...igw.filter((g) => g.vcnId === v.id).map((g) => ({ type: 'Internet GW', name: g.displayName })), ...nat.filter((g) => g.vcnId === v.id).map((g) => ({ type: 'NAT GW', name: g.displayName })),
            ...sgw.filter((g) => g.vcnId === v.id).map((g) => ({ type: 'Service GW', name: g.displayName })), ...lpg.filter((g) => g.vcnId === v.id).map((g) => ({ type: 'LPG', name: g.displayName }))];
          topo.networks.push({ id: v.id, name: v.displayName, cidr: (v.cidrBlocks || [v.cidrBlock]).filter(Boolean).join(', '), group: comp.path, region: r,
            subnets: subnets.filter((s) => s.vcnId === v.id).map((s) => ({ name: s.displayName, cidr: s.cidrBlock, public: s.prohibitPublicIpOnVnic === false })), gateways: gws });
          if (igw.some((g) => g.vcnId === v.id && g.isEnabled !== false)) topo.link(v.id, 'internet', 'internet');
        }
      });
      for (const a of drgAtt.filter((x) => x.lifecycleState !== 'DETACHED')) {
        const vcn = a.vcnId || (a.networkDetails && /VCN/i.test(a.networkDetails.type || '') ? a.networkDetails.id : '');
        if (vcn) topo.link(vcn, a.drgId, 'attach');
      }
      for (const p of lpgs) { const peer = lpgs.find((x) => x.id === p.peerId); if (peer) topo.link(p.vcnId, peer.vcnId, 'peering', 'LPG'); }
      for (const x of ipsec) topo.link(x.drgId, 'onprem', 'vpn', 'IPSec · ' + (x.displayName || ''));
      for (const v of vcs) if (v.gatewayId) topo.link(v.gatewayId, 'onprem', 'dedicated', 'FastConnect' + (v.bandwidthShapeName ? ' ' + v.bandwidthShapeName : ''));
    }
  }
  const names = { servers: 'Instâncias OCI (API)', storage: 'Volumes + Buckets OCI (API)', network: 'VCNs OCI (API)' };
  if (kind === 'network') return [U.sheet(kind, names[kind], rows), require('./topology').sheet('Topologia OCI (API)', topo)];
  return [U.sheet(kind, names[kind], rows)];
}

// opts.backupMode: 'jobs' = só backups feitos no período · 'policies' = só políticas/agendamentos · 'both' (padrão)
const wantJobs = (o) => (o.backupMode || 'both') !== 'policies';
const wantPolicies = (o) => (o.backupMode || 'both') !== 'jobs';
/** Backups de volumes e boot volumes criados no período (o book mostra só os do mês) e/ou as políticas de backup. */
async function backups(c, comps, opts) {
  const from = opts.from ? new Date(opts.from + 'T00:00:00Z') : new Date(Date.now() - 31 * 86400000);
  const to = opts.to ? new Date(opts.to + 'T23:59:59Z') : new Date();
  const rows = [];
  const STATE = { AVAILABLE: 'OK', CREATING: 'Em andamento', REQUEST_RECEIVED: 'Em andamento', FAULTY: 'Falha', TERMINATED: 'Expirado', TERMINATING: 'Expirando' };
  const PERIOD = { ONE_HOUR: 'De hora em hora', ONE_DAY: 'Diário', ONE_WEEK: 'Semanal', ONE_MONTH: 'Mensal', ONE_YEAR: 'Anual' };
  for (const r of c.regionList) {
    await U.pool(comps, 4, async (comp) => {
      // políticas de backup criadas pelo cliente (as padrão da Oracle — bronze/prata/ouro — não entram)
      if (wantPolicies(opts)) {
        let pols = [];
        try { pols = await listAll(c, `${iaas(r)}/volumeBackupPolicies?compartmentId=${comp.id}&limit=1000`); } catch (e) { /* sem permissão */ }
        for (const p of pols) {
          const sch = p.schedules || [];
          rows.push({ 'Item': p.displayName, 'Situação': 'Política ativa', 'Ferramenta': 'Política de backup OCI',
            'Frequência': sch.map((s) => `${PERIOD[s.period] || s.period}${s.hourOfDay != null && s.period !== 'ONE_HOUR' ? ' ' + String(s.hourOfDay).padStart(2, '0') + 'h' : ''} (${s.backupType === 'FULL' ? 'completo' : 'incremental'})`).join('; ') || '—',
            'Retenção': [...new Set(sch.map((s) => (s.retentionSeconds ? Math.round(s.retentionSeconds / 86400) + ' dias' : '')).filter(Boolean))].join(' / ') || '—',
            'Criado em': '', 'Região': r, 'Compartimento': comp.path });
        }
      }
      if (!wantJobs(opts)) return;
      for (const [path, what] of [['bootVolumeBackups', 'Boot Volume'], ['volumeBackups', 'Block Volume']]) {
        let list = [];
        try { list = await listAll(c, `${iaas(r)}/${path}?compartmentId=${comp.id}&limit=1000`); } catch (e) { continue; }
        for (const b of list) {
          const created = new Date(b.timeCreated);
          if (!(created >= from && created <= to)) continue;
          const ret = b.expirationTime ? Math.round((new Date(b.expirationTime) - created) / 86400000) + ' dias' : 'Sem expiração';
          rows.push({ 'Item': b.displayName, 'Situação': STATE[b.lifecycleState] || b.lifecycleState, 'Ferramenta': `OCI ${what} Backup (${b.type === 'INCREMENTAL' ? 'incremental' : 'completo'})`,
            'Frequência': b.sourceType === 'SCHEDULED' ? 'Agendado (política)' : 'Manual', 'Retenção': ret, 'Criado em': day(b.timeCreated), 'Região': r, 'Compartimento': comp.path });
        }
      }
    });
  }
  // políticas primeiro, depois os backups do mais novo para o mais antigo
  return rows.sort((a, b) => (a['Situação'] === 'Política ativa' ? 0 : 1) - (b['Situação'] === 'Política ativa' ? 0 : 1) || String(b['Criado em']).localeCompare(a['Criado em']));
}

const SEV_PT = { CRITICAL: 'Crítica', HIGH: 'Alta', MEDIUM: 'Média', LOW: 'Baixa', MINOR: 'Baixa', INFORMATIONAL: 'Informativa', INFO: 'Informativa' };
const sevPt = (s) => SEV_PT[String(s || '').toUpperCase()] || String(s || '');
/** Geral › Tenant (formato OCI). */
async function tenant(cfg) {
  const c = config(cfg);
  const id = `https://identity.${c.region}.oraclecloud.com/20160918`;
  const t = (await call(c, 'GET', `${id}/tenancies/${c.tenancy}`)).data || {};
  const subs = (await call(c, 'GET', `${id}/tenancies/${c.tenancy}/regionSubscriptions`)).data || [];
  const home = (subs.find((s) => s.isHomeRegion) || {}).regionName || c.region;
  return [U.sheet('tenant', 'Tenancy OCI (API)', [{ 'Tenancy': t.name || '', 'OCID': c.tenancy, 'Região principal': home, 'Regiões assinadas': subs.map((s) => s.regionName).join(', '), 'Descrição': t.description || '' }])];
}
/** Cloud Guard: pontuação, recomendações e problemas (alertas) ativos. */
async function score(cfg) {
  const c = config(cfg);
  const CG = `https://cloudguard-cp-api.${c.region}.oci.oraclecloud.com/20200131`;
  const sub = `compartmentId=${c.tenancy}&compartmentIdInSubtree=true&accessLevel=ACCESSIBLE`;
  const out = []; const errs = [];
  // pontuação: POST /securityScores (sem corpo, só compartmentId) — API Cloud Guard 20200131
  let scoreMsg = '';
  const RATING = { EXCELLENT: 'Excelente', GOOD: 'Boa', FAIR: 'Regular', POOR: 'Ruim' };
  try {
    const items = (await call(c, 'POST', `${CG}/securityScores?compartmentId=${c.tenancy}`, '')).data?.items || [];
    const it = items.find((x) => x && x.securityScore != null);
    if (it) {
      let risk = '';
      try { const rs = ((await call(c, 'POST', `${CG}/riskScores?compartmentId=${c.tenancy}`, '')).data?.items || []).find((x) => x && x.riskScore != null); if (rs) risk = ` · risk score ${rs.riskScore}`; } catch (e) { /* opcional */ }
      out.push(U.sheet('score', 'Cloud Guard (API)', [{ 'Fonte': 'OCI Cloud Guard', 'Escopo': 'Tenancy', 'Pontuação': it.securityScore, 'Máximo': 100, 'Classificação': (RATING[it.securityRating] || it.securityRating || '') + risk }]));
    } else scoreMsg = 'o Cloud Guard ainda não calculou a pontuação desta tenancy (a lista veio vazia)';
  } catch (e) { scoreMsg = e.message; }
  if (scoreMsg) errs.push(scoreMsg);
  let comp = {};
  try { comp = Object.fromEntries((await compartments(c)).map((x) => [x.id, x.path])); } catch (e) { /* nomes opcionais */ }
  try {
    const recs = await listAll(c, `${CG}/recommendations?${sub}&lifecycleState=ACTIVE&limit=500`, 10);
    out.push(U.sheet('score_recs', 'Recomendações Cloud Guard', recs.map((r) => ({ 'Recomendação': r.name || r.details || '', 'Risco': sevPt(r.riskLevel), 'Problemas': r.problemCount ?? '', 'Compartimento': comp[r.compartmentId] || r.compartmentId || '' }))));
  } catch (e) { errs.push(e.message); }
  try {
    const probs = await listAll(c, `${CG}/problems?${sub}&lifecycleState=ACTIVE&lifecycleDetail=OPEN&limit=500`, 10);
    out.push(U.sheet('score_alerts', 'Problemas Cloud Guard', probs.map((p) => ({ 'Problema': p.detectorRuleId || '', 'Risco': sevPt(p.riskLevel), 'Recurso': p.resourceName || '', 'Tipo': p.resourceType || '', 'Compartimento': comp[p.compartmentId] || '', 'Detectado em': String(p.timeLastDetected || '').slice(0, 10) }))));
  } catch (e) { errs.push(e.message); }
  if (!out.length) throw new Error('Cloud Guard indisponível: confirme que está habilitado e a política permite "read cloud-guard-family". ' + errs.join(' | '));
  // parte funcionou, parte não: avisa o que faltou (aparece junto dos erros da sincronização)
  if (scoreMsg) out.push({ kind: 'warning', of: 'score', message: 'Pontuação do Cloud Guard não veio: ' + scoreMsg });
  return out;
}

/** Vulnerability Scanning (VSS): o último scan de cada instância, com os CVEs encontrados. Política: "read vss-family". */
async function vulns(cfg) {
  const c = config(cfg);
  const V = require('./vulns');
  const regs = await regionsOf(c, cfg);
  const comps = await compartments(c);
  const latest = new Map(); const errs = []; let ok = 0;
  for (const r of regs) {
    const VSS = `https://vss-cp-api.${r}.oci.oraclecloud.com/20210215`;
    await U.pool(comps, 4, async (cp) => {
      try {
        for (const s of await listAll(c, `${VSS}/hostScanResults?compartmentId=${cp.id}&limit=1000&sortBy=timeStarted&sortOrder=DESC`, 10)) {
          const old = latest.get(s.instanceId);
          if (!old || String(s.timeStarted) > String(old.s.timeStarted)) latest.set(s.instanceId, { s, r, VSS });
        }
        ok++;
      } catch (e) { errs.push(e.message); }
    });
  }
  if (!ok) throw new Error('Vulnerability Scanning indisponível (habilite o serviço e a política "read vss-family"). ' + (errs[0] || ''));
  const list = [];
  await U.pool([...latest.values()], 4, async ({ s, r, VSS }) => {
    let host = s.instanceName || s.instanceId;
    try { host = (await call(c, 'GET', `${iaas(r)}/instances/${s.instanceId}`)).data?.displayName || host; } catch (e) { /* nome opcional */ }
    try {
      const d = (await call(c, 'GET', `${VSS}/hostScanResults/${s.id}`)).data || {};
      for (const p of [...(d.problems || []), ...(d.vulnerabilities || [])])
        list.push({ cve: p.cveReference || p.cveId || p.name, title: p.cveReference ? p.name : String(p.description || '').slice(0, 160), severity: p.severity, cvss: p.cvssScore ?? p.cvss3Score, host, fix: p.recommendation || p.remediation || '', pkg: p.packageName || '' });
    } catch (e) { errs.push(e.message); }
  });
  return [V.aggregate(list, 'OCI Vulnerability Scanning')];
}

module.exports = { label: 'Oracle Cloud Infrastructure', test, pull, tenant, score, vulns, backups, config, _call: call };
