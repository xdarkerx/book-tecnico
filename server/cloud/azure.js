/* ═══ Conector Azure — OAuth client credentials + Azure Resource Manager (REST) ═══
 * Config (por cliente): { tenantId, clientId, clientSecret, subscriptionIds: 'sub1,sub2' }
 * Crie um App Registration (service principal) com a role "Reader" nas assinaturas.
 */
const U = require('./util');
const ARM = 'https://management.azure.com';
const tokens = new Map();

async function token(cfg) {
  ['tenantId', 'clientId', 'clientSecret'].forEach((k) => { if (!cfg[k]) throw new Error(`Configuração Azure incompleta: falta "${k}".`); });
  const key = cfg.tenantId + cfg.clientId;
  const t = tokens.get(key);
  if (t && t.exp > Date.now() + 60000) return t.token;
  const res = await U.request(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: 'https://management.azure.com/.default' })
  });
  const j = await res.json();
  tokens.set(key, { token: j.access_token, exp: Date.now() + j.expires_in * 1000 });
  return j.access_token;
}
/** GET paginado (nextLink). */
async function arm(cfg, pathOrUrl) {
  const tk = await token(cfg);
  const out = []; let url = pathOrUrl.startsWith('http') ? pathOrUrl : ARM + pathOrUrl; let n = 0;
  while (url && n++ < 100) {
    const j = await (await U.request(url, { headers: { authorization: 'Bearer ' + tk } })).json();
    out.push(...(j.value || []));
    url = j.nextLink;
  }
  return out;
}
async function subscriptions(cfg) {
  const ids = U.list(cfg.subscriptionIds || cfg.subscriptionId);
  if (ids.length) return ids;
  return (await arm(cfg, '/subscriptions?api-version=2022-12-01')).map((s) => s.subscriptionId);
}
/** bytes → "12,3 GB" (ou MB/TB) */
const gb = (n) => { n = Number(n) || 0; const u = n >= 1e12 ? [1e12, 'TB'] : n >= 1e9 ? [1e9, 'GB'] : [1e6, 'MB']; return (Math.round((n / u[0]) * 10) / 10).toLocaleString('pt-BR') + ' ' + u[1]; };
const rg = (id) => (String(id).match(/resourceGroups\/([^/]+)/i) || [])[1] || '';

async function test(cfg) {
  const subs = await subscriptions(cfg);
  if (!subs.length) throw new Error('Nenhuma assinatura visível para este service principal (atribua a role Reader).');
  return { message: `Conectado — ${subs.length} assinatura(s): ${subs.join(', ')}` };
}

const period = (opts = {}) => ({ from: opts.from ? new Date(opts.from + 'T00:00:00Z') : new Date(Date.now() - 31 * 86400000), to: opts.to ? new Date(opts.to + 'T23:59:59Z') : new Date() });
const inPeriod = (d, p) => { const t = new Date(d); return t >= p.from && t <= p.to; };
async function pull(cfg, kind, opts = {}) {
  const rows = [];
  const topo = require('./topology').model();
  const p = period(opts);
  for (const sub of await subscriptions(cfg)) {
    const S = `/subscriptions/${sub}`;
    if (kind === 'backup') rows.push(...(await backupJobs(cfg, S, p, opts)));
    if (kind === 'servers') {
      const vms = await arm(cfg, `${S}/providers/Microsoft.Compute/virtualMachines?api-version=2024-03-01`);
      const status = await arm(cfg, `${S}/providers/Microsoft.Compute/virtualMachines?api-version=2024-03-01&statusOnly=true`).catch(() => []);
      const nics = await arm(cfg, `${S}/providers/Microsoft.Network/networkInterfaces?api-version=2023-09-01`).catch(() => []);
      const ipByVm = {};
      for (const n of nics) { const vm = n.properties?.virtualMachine?.id; const ip = n.properties?.ipConfigurations?.[0]?.properties?.privateIPAddress; if (vm && ip && !ipByVm[vm.toLowerCase()]) ipByVm[vm.toLowerCase()] = ip; }
      const powerById = {};
      for (const s of status) { const st = (s.properties?.instanceView?.statuses || []).find((x) => /^PowerState\//.test(x.code)); if (st) powerById[s.id.toLowerCase()] = st.displayStatus || st.code.split('/')[1]; }
      for (const v of vms) {
        const p = v.properties || {}; const img = p.storageProfile?.imageReference || {};
        rows.push({ 'Name': v.name, 'Private IP Address': ipByVm[v.id.toLowerCase()] || '', 'OS Name': [p.storageProfile?.osDisk?.osType, img.offer, img.sku].filter(Boolean).join(' '),
          'Power State': powerById[v.id.toLowerCase()] || '', 'Location': v.location, 'Resource Group': rg(v.id), 'VM Size': p.hardwareProfile?.vmSize || '', 'Environment': v.tags?.Environment || v.tags?.environment || v.tags?.env || '', 'Criado em': String(p.timeCreated || '').slice(0, 10) });
      }
    }
    if (kind === 'storage') {
      // capacidade usada de cada storage account: métrica UsedCapacity do Azure Monitor (última hora com dado)
      await U.pool(await arm(cfg, `${S}/providers/Microsoft.Storage/storageAccounts?api-version=2023-01-01`), 6, async (s) => {
        let size = '';
        try {
          const end = new Date(); const start = new Date(end - 24 * 3600000);
          const m = await arm(cfg, `${s.id}/providers/Microsoft.Insights/metrics?api-version=2023-10-01&metricnames=UsedCapacity&aggregation=Average&interval=PT1H&timespan=${start.toISOString()}/${end.toISOString()}`);
          const pts = ((m[0] && m[0].timeseries && m[0].timeseries[0] && m[0].timeseries[0].data) || []).filter((x) => x.average != null);
          if (pts.length) size = gb(pts[pts.length - 1].average);
        } catch (e) { /* sem permissão de leitura de métricas */ }
        rows.push({ 'Name': s.name, 'Kind': `${s.kind} · ${s.sku?.name || ''}`, 'Capacity': size, 'Location': s.location, 'Resource Group': rg(s.id), 'Status': s.properties?.statusOfPrimary || '', 'Criado em': String(s.properties?.creationTime || '').slice(0, 10) });
      });
      for (const d of await arm(cfg, `${S}/providers/Microsoft.Compute/disks?api-version=2023-04-02`))
        rows.push({ 'Name': d.name, 'Kind': 'Disco ' + (d.sku?.name || ''), 'Capacity': (d.properties?.diskSizeGB ?? '') + ' GiB', 'Location': d.location, 'Resource Group': rg(d.id), 'Status': d.properties?.diskState || '', 'Criado em': String(d.properties?.timeCreated || '').slice(0, 10) });
    }
    if (kind === 'network') {
      const SPECIAL = { gatewaysubnet: 'VPN / ExpressRoute GW', azurefirewallsubnet: 'Azure Firewall', azurebastionsubnet: 'Bastion', routeserversubnet: 'Route Server' };
      for (const n of await arm(cfg, `${S}/providers/Microsoft.Network/virtualNetworks?api-version=2023-09-01`)) {
        const subs = n.properties?.subnets || [];
        const pfx = (s) => s.properties?.addressPrefix || (s.properties?.addressPrefixes || []).join(',');
        rows.push({ 'VNet Name': n.name, 'Address Space': (n.properties?.addressSpace?.addressPrefixes || []).join(', '), 'Resource Group': rg(n.id), 'Location': n.location,
          'Subnets': subs.map((s) => `${s.name} (${pfx(s)})`).join('; ') });
        // topologia: subnets especiais viram gateways; NAT por subnet; peerings entre VNets
        const id = String(n.id).toLowerCase();
        topo.networks.push({ id, name: n.name, cidr: (n.properties?.addressSpace?.addressPrefixes || []).join(', '), group: rg(n.id), region: n.location,
          subnets: subs.filter((s) => !SPECIAL[s.name.toLowerCase()]).map((s) => ({ name: s.name, cidr: pfx(s), public: null })),
          gateways: [...subs.filter((s) => SPECIAL[s.name.toLowerCase()]).map((s) => ({ type: SPECIAL[s.name.toLowerCase()], name: '' })), ...(subs.some((s) => s.properties?.natGateway) ? [{ type: 'NAT GW', name: '' }] : [])] });
        for (const p of n.properties?.virtualNetworkPeerings || [])
          if (/connected/i.test(p.properties?.peeringState || '')) topo.link(id, String(p.properties?.remoteVirtualNetwork?.id || '').toLowerCase(), 'peering', 'Peering');
      }
    }
    if (kind === 'baseline') {
      for (const r of await arm(cfg, `${S}/resources?api-version=2021-04-01`))
        rows.push({ 'TYPE': String(r.type).toLowerCase(), 'NAME': r.name, 'RESOURCE GROUP': rg(r.id), 'LOCATION': r.location });
    }
  }
  const names = { servers: 'VMs Azure (API)', storage: 'Storage Azure (API)', network: 'VNets Azure (API)', baseline: 'Recursos Azure (API)', backup: 'Jobs do Azure Backup no período (API)' };
  if (kind === 'network') {
    // conexões dos gateways (VPN site-to-site, ExpressRoute, VNet-to-VNet) pelo Resource Graph; sem permissão, segue sem elas
    try {
      const res = await graph(cfg, await subscriptions(cfg), `resources | where type =~ 'microsoft.network/virtualnetworkgateways' or type =~ 'microsoft.network/connections' | project id, name, type, properties`);
      const gwVnet = {};
      res.filter((x) => /virtualnetworkgateways/i.test(x.type)).forEach((g) => { const sid = String((((g.properties || {}).ipConfigurations || [])[0] || {}).properties?.subnet?.id || '').toLowerCase(); gwVnet[String(g.id).toLowerCase()] = sid.replace(/\/subnets\/.*$/, ''); });
      res.filter((x) => /connections$/i.test(x.type)).forEach((cn) => {
        const p = cn.properties || {}; const a = gwVnet[String(p.virtualNetworkGateway1?.id || '').toLowerCase()];
        if (!a) return;
        if (/vnet2vnet/i.test(p.connectionType)) { const b = gwVnet[String(p.virtualNetworkGateway2?.id || '').toLowerCase()]; if (b) topo.link(a, b, 'vpn', 'VNet-to-VNet'); }
        else topo.link(a, 'onprem', /expressroute/i.test(p.connectionType) ? 'dedicated' : 'vpn', (/expressroute/i.test(p.connectionType) ? 'ExpressRoute · ' : 'VPN · ') + cn.name);
      });
    } catch (e) { /* sem Resource Graph */ }
    return [U.sheet(kind, names[kind], rows), require('./topology').sheet('Topologia Azure (API)', topo)];
  }
  return [U.sheet(kind, names[kind], rows)];
}

// opts.backupMode: 'jobs' = só backups feitos no período · 'policies' = só políticas/agendamentos · 'both' (padrão)
const wantJobs = (o) => (o.backupMode || 'both') !== 'policies';
const wantPolicies = (o) => (o.backupMode || 'both') !== 'jobs';
/** Backup do período: jobs dos cofres do Recovery Services (Azure Backup) e/ou as políticas dos cofres. */
async function backupJobs(cfg, S, p, opts = {}) {
  const rows = [];
  const RET = (r) => (r && r.retentionDuration ? `${r.retentionDuration.count} ${({ Days: 'dias', Weeks: 'semanas', Months: 'meses', Years: 'anos' })[r.retentionDuration.durationType] || r.retentionDuration.durationType}` : '');
  const ST = { Completed: 'OK', CompletedWithWarnings: 'OK com avisos', Failed: 'Falha', InProgress: 'Em andamento', Cancelled: 'Cancelado' };
  const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' '); // filtro do Azure Backup: "yyyy-mm-dd hh:mm:ss"
  for (const v of await arm(cfg, `${S}/providers/Microsoft.RecoveryServices/vaults?api-version=2023-04-01`).catch(() => [])) {
    if (wantPolicies(opts)) for (const pol of await arm(cfg, `${v.id}/backupPolicies?api-version=2023-04-01`).catch(() => [])) {
      const q = pol.properties || {}; const sch = q.schedulePolicy || {}; const ret = q.retentionPolicy || {};
      const when = sch.scheduleRunFrequency ? `${({ Daily: 'Diário', Weekly: 'Semanal', Hourly: 'De hora em hora' })[sch.scheduleRunFrequency] || sch.scheduleRunFrequency}${(sch.scheduleRunTimes || [])[0] ? ' ' + String(sch.scheduleRunTimes[0]).slice(11, 16) : ''}` : (q.backupManagementType || '—');
      rows.push({ 'Item': pol.name, 'Situação': 'Política ativa', 'Ferramenta': `Política do Azure Backup (${v.name})`, 'Frequência': when,
        'Retenção': [RET(ret.dailySchedule), RET(ret.weeklySchedule), RET(ret.monthlySchedule), RET(ret.yearlySchedule)].filter(Boolean).join(' / ') || '—', 'Criado em': '' });
    }
    if (!wantJobs(opts)) continue;
    const filter = encodeURIComponent(`startTime eq '${fmt(p.from)}' and endTime eq '${fmt(p.to)}'`);
    let jobs = await arm(cfg, `${v.id}/backupJobs?api-version=2023-04-01&$filter=${filter}`).catch(() => null);
    if (!jobs) jobs = await arm(cfg, `${v.id}/backupJobs?api-version=2023-04-01`).catch(() => []);
    for (const j of jobs) {
      const q = j.properties || {};
      if (q.startTime && !inPeriod(q.startTime, p)) continue;
      rows.push({ 'Item': q.entityFriendlyName || j.name, 'Situação': ST[q.status] || q.status || '', 'Ferramenta': `Azure Backup (${v.name})`, 'Frequência': q.operation || '',
        'Retenção': '—', 'Teste Restore': /restore/i.test(q.operation || '') ? 'Sim' : '', 'Criado em': String(q.startTime || '').slice(0, 10) });
    }
  }
  return rows;
}

const SEV_PT = { CRITICAL: 'Crítica', HIGH: 'Alta', MEDIUM: 'Média', LOW: 'Baixa', MINOR: 'Baixa', INFORMATIONAL: 'Informativa', INFO: 'Informativa' };
const sevPt = (s) => SEV_PT[String(s || '').toUpperCase()] || String(s || '');
/** Geral › Tenant (formato Azure): tenant e assinaturas. */
async function tenant(cfg) {
  const tenants = await arm(cfg, '/tenants?api-version=2022-12-01').catch(() => []);
  const t = tenants.find((x) => x.tenantId === cfg.tenantId) || tenants[0] || {};
  const tName = t.displayName || t.defaultDomain || cfg.tenantId;
  const want = new Set(U.list(cfg.subscriptionIds || cfg.subscriptionId));
  const subs = (await arm(cfg, '/subscriptions?api-version=2022-12-01')).filter((s) => !want.size || want.has(s.subscriptionId));
  return [U.sheet('tenant', 'Tenant Azure (API)', subs.map((s) => ({ 'Tenant': tName, 'Tenant ID': cfg.tenantId, 'Assinatura': s.displayName, 'Subscription ID': s.subscriptionId, 'Estado': s.state || '' })))];
}
/** Defender for Cloud: Secure Score, recomendações não íntegras e alertas de segurança. */
async function score(cfg) {
  const rows = []; const recs = {}; const alerts = [];
  // nome das assinaturas para o book ("Produção" em vez do GUID)
  const names = Object.fromEntries((await arm(cfg, '/subscriptions?api-version=2022-12-01').catch(() => [])).map((s) => [s.subscriptionId, s.displayName]));
  for (const sub of await subscriptions(cfg)) {
    const subName = names[sub] || sub;
    const list = await arm(cfg, `/subscriptions/${sub}/providers/Microsoft.Security/secureScores?api-version=2020-01-01`).catch(() => []);
    const s = list.find((x) => x.name === 'ascScore') || list[0];
    if (s && s.properties && s.properties.score) {
      const sc = s.properties.score;
      rows.push({ 'Fonte': 'Microsoft Defender for Cloud', 'Escopo': subName, 'Pontuação': Math.round((sc.percentage != null ? sc.percentage : sc.current / (sc.max || 1)) * 100), 'Máximo': 100, 'Classificação': `${sc.current} de ${sc.max} pontos` });
    }
    for (const a of await arm(cfg, `/subscriptions/${sub}/providers/Microsoft.Security/assessments?api-version=2021-06-01&$expand=metadata`).catch(() => [])) {
      const p = a.properties || {};
      if (!p.status || p.status.code !== 'Unhealthy') continue;
      const k = sub + '|' + p.displayName;
      recs[k] = recs[k] || { 'Recomendação': p.displayName || a.name, 'Severidade': sevPt(p.metadata && p.metadata.severity), 'Recursos não íntegros': 0, 'Assinatura': subName };
      recs[k]['Recursos não íntegros']++;
    }
    for (const a of await arm(cfg, `/subscriptions/${sub}/providers/Microsoft.Security/alerts?api-version=2022-01-01`).catch(() => [])) {
      const p = a.properties || {};
      if (p.status && /dismissed|resolved/i.test(p.status)) continue;
      alerts.push({ 'Alerta': p.alertDisplayName || '', 'Severidade': sevPt(p.severity), 'Recurso': p.compromisedEntity || '', 'Data': String(p.timeGeneratedUtc || '').slice(0, 10), 'Status': p.status || '', 'Assinatura': subName });
    }
  }
  if (!rows.length) throw new Error('Secure Score indisponível: confirme o Defender for Cloud nas assinaturas e a role Reader / Security Reader.');
  const ord = { 'Alta': 0, 'Média': 1, 'Baixa': 2 };
  return [U.sheet('score', 'Defender Secure Score (API)', rows),
    U.sheet('score_recs', 'Recomendações (Defender)', Object.values(recs).sort((a, b) => (ord[a.Severidade] ?? 9) - (ord[b.Severidade] ?? 9) || b['Recursos não íntegros'] - a['Recursos não íntegros'])),
    U.sheet('score_alerts', 'Alertas de segurança (Defender)', alerts)];
}

/** Consulta do Azure Resource Graph (paginada por $skipToken). */
async function graph(cfg, subs, query) {
  const tk = await token(cfg);
  const out = []; let skip = null; let n = 0;
  do {
    const body = JSON.stringify({ subscriptions: subs, query, options: Object.assign({ $top: 1000 }, skip ? { $skipToken: skip } : {}) });
    const j = await (await U.request(ARM + '/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01', { method: 'POST', headers: { authorization: 'Bearer ' + tk, 'content-type': 'application/json' }, body, timeout: 60000 })).json();
    out.push(...(Array.isArray(j.data) ? j.data : []));
    skip = j.$skipToken;
  } while (skip && ++n < 50);
  return out;
}
/** Defender for Cloud: CVEs das máquinas (avaliação de vulnerabilidades do Defender for Servers / MDVM). Role: Reader / Security Reader. */
async function vulns(cfg) {
  const V = require('./vulns');
  const rows = await graph(cfg, await subscriptions(cfg), `securityresources
| where type == "microsoft.security/assessments/subassessments"
| where tostring(properties.additionalData.assessedResourceType) startswith "ServerVulnerability"
| where tostring(properties.status.code) == "Unhealthy"
| project id, properties`);
  const list = rows.flatMap((x) => {
    const p = x.properties || {}; const ad = p.additionalData || {};
    const cves = (ad.cve || []).map((c) => (c && c.title) || c).filter((c) => /^CVE-/i.test(String(c)));
    const rd = p.resourceDetails || {};
    const host = rd.ResourceName || rd.resourceName || (String(rd.id || x.id).match(/(?:virtualMachines|machines)\/([^/]+)/i) || [])[1] || '';
    const base = { title: p.displayName, severity: p.status && p.status.severity, cvss: V.findCvss(ad.cvss), host, fix: p.remediation || '', pkg: (ad.software || ad.softwareDetails || {}).name || '' };
    return (cves.length ? cves : [/^CVE-/i.test(p.id || '') ? p.id : p.displayName]).map((cve) => Object.assign({ cve }, base));
  });
  return [V.aggregate(list, 'Microsoft Defender for Cloud')];
}

module.exports = { label: 'Microsoft Azure', test, pull, tenant, score, vulns };
