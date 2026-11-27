/* ═══ Conector VMware vCenter (vSphere Automation REST API) — menu On-Premises do book ═══
 * Config (por cliente): { url: 'https://vcenter.empresa.local', user: 'leitura@vsphere.local', password,
 *                         clusters?: 'Cluster-PRD, Cluster-HML' (só estes; vazio = todos), insecure?: true }
 * Usuário com a função "Somente leitura" no vCenter basta.
 * API nova (/api, vSphere 7.0 U2+) e antiga (/rest, 6.5–7.0): usa a que o vCenter responder.
 * As colunas seguem o export do RVTools (vInfo): os mapeadores do front já entendem.
 */
const U = require('./util');

const trim = (u) => String(u || '').replace(/\/+$/, '').replace(/\/(api|rest|ui)$/, '');
const mib = (bytes) => (bytes == null ? '' : String(Math.round(Number(bytes) / 1048576)));
const POWER = { POWERED_ON: 'poweredOn', POWERED_OFF: 'poweredOff', SUSPENDED: 'suspended' };

/** Abre a sessão. Devolve get(path) que já sabe se o vCenter usa /api ou /rest. */
async function session(cfg) {
  if (!cfg.url) throw new Error('Informe a URL do vCenter (ex.: https://vcenter.empresa.local).');
  if (!cfg.user || !cfg.password) throw new Error('Informe o usuário e a senha do vCenter.');
  const base = trim(cfg.url);
  const insecure = !!cfg.insecure;
  const auth = 'Basic ' + Buffer.from(cfg.user + ':' + cfg.password).toString('base64');
  let token = null; let style = 'api';
  try {
    token = await (await U.request(base + '/api/session', { method: 'POST', headers: { authorization: auth }, insecure })).json();
  } catch (e) {
    if (e.status !== 404) throw friendly(e);
    style = 'rest'; // vCenter 6.5–7.0
    try { token = (await (await U.request(base + '/rest/com/vmware/cis/session', { method: 'POST', headers: { authorization: auth }, insecure })).json()).value; }
    catch (e2) { throw friendly(e2); }
  }
  if (!token) throw new Error('O vCenter não devolveu a sessão.');
  const headers = { 'vmware-api-session-id': token };
  const get = async (path) => {
    const url = base + (style === 'api' ? '/api' : '/rest') + path;
    const j = await (await U.request(url, { headers, insecure, timeout: 120000 })).json();
    return style === 'rest' && j && j.value !== undefined ? j.value : j;
  };
  const close = () => U.request(base + (style === 'api' ? '/api/session' : '/rest/com/vmware/cis/session'), { method: 'DELETE', headers, insecure }).catch(() => {});
  return { get, close, style };
}
function friendly(e) {
  if (e.status === 401) return new Error('vCenter recusou o usuário ou a senha (401).');
  if (e.status === 403) return new Error('Usuário sem permissão no vCenter (403): dê a função "Somente leitura".');
  return e;
}

/** Inventário: datacenters → clusters → hosts → VMs (para saber onde cada VM roda). */
async function inventory(s, cfg) {
  const dcs = (await s.get('/vcenter/datacenter')) || [];
  const clusters = []; const hosts = [];
  for (const dc of dcs) for (const c of (await s.get('/vcenter/cluster?datacenters=' + encodeURIComponent(dc.datacenter))) || []) clusters.push(Object.assign({ dcName: dc.name }, c));
  const only = U.list(cfg.clusters).map((x) => x.toLowerCase());
  const useClusters = only.length ? clusters.filter((c) => only.includes(String(c.name).toLowerCase())) : clusters;
  for (const c of useClusters) for (const h of (await s.get('/vcenter/host?clusters=' + encodeURIComponent(c.cluster))) || []) hosts.push(Object.assign({ clusterName: c.name, dcName: c.dcName }, h));
  if (!only.length) {
    // hosts fora de cluster (standalone)
    for (const dc of dcs) for (const h of (await s.get('/vcenter/host?datacenters=' + encodeURIComponent(dc.datacenter))) || [])
      if (!hosts.some((x) => x.host === h.host)) hosts.push(Object.assign({ clusterName: '', dcName: dc.name }, h));
  }
  const vms = [];
  await U.pool(hosts, 4, async (h) => {
    for (const v of (await s.get('/vcenter/vm?hosts=' + encodeURIComponent(h.host))) || []) vms.push(Object.assign({ hostName: h.name, clusterName: h.clusterName, dcName: h.dcName }, v));
  });
  return { dcs, clusters, useClusters, hosts, vms };
}

async function test(cfg) {
  const s = await session(cfg);
  try {
    let ver = '';
    try { const v = await s.get('/appliance/system/version'); ver = v && v.version ? ` ${v.version}` : ''; } catch (e) { /* sem permissão no appliance */ }
    const hosts = (await s.get('/vcenter/host')) || [];
    const vms = (await s.get('/vcenter/vm')) || [];
    return { message: `Conectado ao vCenter${ver} (API ${s.style === 'api' ? 'nova' : 'antiga'}) — ${hosts.length} host(s) ESXi, ${vms.length} VM(s)` };
  } finally { s.close(); }
}

async function pull(cfg, kind) {
  const s = await session(cfg);
  try {
    const inv = await inventory(s, cfg);
    if (kind === 'servers') {
      const rows = [];
      await U.pool(inv.vms, 8, async (v) => {
        let ip = '', os = '', dns = '';
        // IP e SO pelo VMware Tools; sem Tools (ou VM desligada), o SO da configuração da VM
        try { const g = await s.get(`/vcenter/vm/${encodeURIComponent(v.vm)}/guest/identity`); ip = g.ip_address || ''; os = (g.full_name && (g.full_name.default_message || g.full_name)) || ''; dns = g.host_name || ''; } catch (e) { /* sem VMware Tools */ }
        if (!os) { try { const d = await s.get(`/vcenter/vm/${encodeURIComponent(v.vm)}`); os = String(d.guest_OS || '').replace(/_/g, ' ').toLowerCase(); } catch (e) { /* sem detalhe */ } }
        rows.push({ 'VM': v.name, 'Powerstate': POWER[v.power_state] || v.power_state || '', 'DNS Name': dns, 'Primary IP Address': ip, 'OS according to the VMware Tools': os,
          'CPUs': v.cpu_count ?? '', 'Memory': v.memory_size_MiB ?? '', 'Datacenter': v.dcName, 'Cluster': v.clusterName, 'Host': v.hostName });
      });
      rows.sort((a, b) => a.VM.localeCompare(b.VM));
      return [U.sheet('servers', 'VMs do vCenter (API)', rows)];
    }
    if (kind === 'storage') {
      const rows = [];
      for (const dc of inv.dcs) for (const d of (await s.get('/vcenter/datastore?datacenters=' + encodeURIComponent(dc.datacenter))) || [])
        rows.push({ 'Name': d.name, 'Type': `Datastore ${d.type || ''}`.trim(), 'Capacity MiB': mib(d.capacity), 'In Use MiB': d.capacity != null && d.free_space != null ? mib(d.capacity - d.free_space) : '', 'Free MiB': mib(d.free_space), 'Datacenter': dc.name, 'Status': 'Disponível' });
      return [U.sheet('storage', 'Datastores do vCenter (API)', rows)];
    }
    if (kind === 'network') {
      const T = { STANDARD_PORTGROUP: 'Port group padrão', DISTRIBUTED_PORTGROUP: 'Port group distribuído', OPAQUE_NETWORK: 'Rede NSX' };
      const rows = [];
      for (const dc of inv.dcs) for (const n of (await s.get('/vcenter/network?datacenters=' + encodeURIComponent(dc.datacenter))) || [])
        rows.push({ 'Port Group': n.name, 'Tipo': T[n.type] || n.type || '', 'Datacenter': dc.name });
      return [U.sheet('network', 'Redes do vCenter (API)', rows)];
    }
    if (kind === 'baseline') {
      const rows = [];
      const add = (type, list, name) => list.forEach((x) => rows.push({ resource_type: type, resource_name: x[name], region_name: x.dcName || '', compartment_name: x.clusterName || '' }));
      add('Datacenter', inv.dcs.map((d) => Object.assign({ dcName: d.name }, d)), 'name');
      add('Cluster', inv.useClusters, 'name');
      add('Host ESXi', inv.hosts, 'name');
      add('Virtual Machine', inv.vms, 'name');
      return [U.sheet('baseline', 'Recursos do vCenter (API)', rows)];
    }
    throw new Error('Tipo de dado não disponível para o vCenter.');
  } finally { s.close(); }
}

/** Geral: o vCenter (versão) e a contagem do ambiente. */
async function tenant(cfg) {
  const s = await session(cfg);
  try {
    const inv = await inventory(s, cfg);
    let ver = '';
    try { const v = await s.get('/appliance/system/version'); ver = v ? [v.version, v.build ? `build ${v.build}` : ''].filter(Boolean).join(' ') : ''; } catch (e) { /* sem permissão no appliance */ }
    const on = inv.vms.filter((v) => v.power_state === 'POWERED_ON').length;
    return [U.sheet('tenant', 'vCenter (API)', [{ 'vCenter': trim(cfg.url).replace(/^https?:\/\//, ''), 'Versão': ver, 'Datacenters': inv.dcs.map((d) => d.name).join(', '),
      'Clusters': inv.useClusters.map((c) => c.name).join(', '), 'Hosts ESXi': String(inv.hosts.length), 'VMs': `${inv.vms.length} (${on} ligadas)` }])];
  } finally { s.close(); }
}

// o que o vCenter oferece na sincronização (backup, Security Score e CVEs não vêm do vCenter)
const KINDS = ['servers', 'storage', 'network', 'baseline', 'tenant'];
module.exports = { label: 'VMware vCenter', test, pull, tenant, KINDS };
