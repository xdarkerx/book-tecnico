/* ═══ Conector VMware vCenter (vSphere Automation REST API) — menu On-Premises do book ═══
 * Config (por cliente): { url: 'https://vcenter.empresa.local', user: 'leitura@vsphere.local', password,
 *                         clusters?: 'Cluster-PRD, Cluster-HML' (só estes; vazio = todos), insecure?: true }
 * Usuário com a função "Somente leitura" no vCenter basta.
 * API nova (/api, vSphere 7.0 U2+) e antiga (/rest, 6.5–7.0): usa a que o vCenter responder.
 * As colunas seguem o export do RVTools (vInfo): os mapeadores do front já entendem.
 */
const U = require('./util');

/** Endereço do vCenter: aceita "vcenter.local", "172.16.0.10", "https://vcenter/ui"… → https://host[:porta] */
function trim(u) {
  let s = String(u || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try { const x = new URL(s); return `${x.protocol}//${x.host}`; }
  catch (e) { throw new Error(`Endereço do vCenter inválido: "${u}". Use, por exemplo, https://vcenter.empresa.local ou https://172.16.0.10`); }
}
const mib = (bytes) => (bytes == null ? '' : String(Math.round(Number(bytes) / 1048576)));
const POWER = { POWERED_ON: 'poweredOn', POWERED_OFF: 'poweredOff', SUSPENDED: 'suspended' };

/** Abre a sessão. Devolve get(path) que já sabe se o vCenter usa /api ou /rest. */
async function session(cfg) {
  if (!cfg.url) throw new Error('Informe a URL do vCenter (ex.: https://vcenter.empresa.local).');
  if (!cfg.user || !cfg.password) throw new Error('Informe o usuário e a senha do vCenter.');
  const base = trim(cfg.url);
  const insecure = !!cfg.insecure;
  // alguns vCenter 7.0 recusam a criação da sessão sem Content-Type (erro 500 "Missing Content-Type header")
  const auth = { authorization: 'Basic ' + Buffer.from(cfg.user + ':' + cfg.password).toString('base64'), 'content-type': 'application/json', accept: 'application/json' };
  // "não existe aqui": a API nova não está neste vCenter (404/405/400/501 ou resposta que não é JSON)
  const notHere = (e) => [400, 404, 405, 501].includes(e.status) || e instanceof SyntaxError;
  let token = null; let style = 'api';
  // API nova (/api): só vale se o inventário também responder. O vCenter 6.7 aceita /api/session,
  // mas /api/vcenter/... dá 405 ("HTTP method GET is not supported") — nesse caso usa a antiga (/rest).
  try {
    const t = await (await U.request(base + '/api/session', { method: 'POST', headers: auth, insecure })).json();
    if (typeof t === 'string' && t) {
      try { await U.request(base + '/api/vcenter/datacenter', { headers: { 'vmware-api-session-id': t, accept: 'application/json' }, insecure }); token = t; }
      catch (e) {
        if (!notHere(e)) throw e;
        U.request(base + '/api/session', { method: 'DELETE', headers: { 'vmware-api-session-id': t }, insecure }).catch(() => {});
      }
    }
  } catch (e) { if (!notHere(e)) throw friendly(e); }
  if (!token) {
    style = 'rest'; // vCenter 6.5, 6.7 e 7.0 até o U1
    try { token = (await (await U.request(base + '/rest/com/vmware/cis/session', { method: 'POST', headers: auth, insecure })).json()).value; }
    catch (e2) {
      // vCenter 5.5/6.0: não tem API REST — o conector usa a SOAP (/sdk)
      if (e2.status === 404) throw Object.assign(new Error('vCenter sem API REST'), { noRest: true });
      throw friendly(e2);
    }
  }
  if (!token) throw new Error('O vCenter não devolveu a sessão.');
  const headers = { 'vmware-api-session-id': token, accept: 'application/json' };
  const get = async (path) => {
    // na API antiga os filtros se chamam filter.clusters, filter.hosts, filter.datacenters
    if (style === 'rest') path = path.replace(/([?&])(clusters|datacenters|hosts)=/g, '$1filter.$2=');
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

async function restTest(cfg) {
  const s = await session(cfg);
  try {
    let ver = '';
    try { const v = await s.get('/appliance/system/version'); ver = v && v.version ? ` ${v.version}` : ''; } catch (e) { /* sem permissão no appliance */ }
    const hosts = (await s.get('/vcenter/host')) || [];
    const vms = (await s.get('/vcenter/vm')) || [];
    return { message: `Conectado ao vCenter${ver} (API ${s.style === 'api' ? 'nova' : 'antiga'}) — ${hosts.length} host(s) ESXi, ${vms.length} VM(s)` };
  } finally { s.close(); }
}

async function restPull(cfg, kind) {
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
async function restTenant(cfg) {
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

// ═══ API SOAP (todas as versões): vCenter antigo, topologia, segurança e snapshots ═══
const SOAP = require('./vsphere-soap');
const TOPO = require('./topology');
const { arr, ref } = SOAP;

/** Inventário pela SOAP, já com o filtro de clusters da conexão. */
async function soapInv(cfg) {
  const inv = await SOAP.inventory(cfg, trim(cfg.url));
  const only = U.list(cfg.clusters).map((x) => x.toLowerCase());
  if (!only.length) return inv;
  const keep = (x) => only.includes(String(x.cluster || x.name || '').toLowerCase());
  return Object.assign({}, inv, { clusters: inv.clusters.filter((c) => only.includes(String(c.name).toLowerCase())), hosts: inv.hosts.filter(keep), vms: inv.vms.filter(keep) });
}
const powerOn = (v) => v['runtime.powerState'] === 'poweredOn';

/** vCenter sem REST (5.5/6.0): os mesmos dados, pela SOAP. */
function soapSheets(inv, kind) {
  if (kind === 'servers') {
    const rows = inv.vms.map((v) => ({ 'VM': v.name, 'Powerstate': v['runtime.powerState'] || '', 'DNS Name': v['guest.hostName'] || '', 'Primary IP Address': v['guest.ipAddress'] || '',
      'OS according to the VMware Tools': v['config.guestFullName'] || '', 'CPUs': v['summary.config.numCpu'] || '', 'Memory': v['summary.config.memorySizeMB'] || '', 'Datacenter': v.datacenter, 'Cluster': v.cluster, 'Host': v.hostName }));
    return [U.sheet('servers', 'VMs do vCenter (API)', rows.sort((a, b) => a.VM.localeCompare(b.VM)))];
  }
  if (kind === 'storage') {
    return [U.sheet('storage', 'Datastores do vCenter (API)', inv.datastores.map((d) => ({ 'Name': d.name, 'Type': `Datastore ${d['summary.type'] || ''}`.trim(), 'Capacity MiB': mib(d['summary.capacity']),
      'In Use MiB': d['summary.capacity'] != null && d['summary.freeSpace'] != null ? mib(d['summary.capacity'] - d['summary.freeSpace']) : '', 'Free MiB': mib(d['summary.freeSpace']), 'Datacenter': d.datacenter, 'Status': d['summary.accessible'] === 'false' ? 'Inacessível' : 'Disponível' })))];
  }
  if (kind === 'network') {
    return [U.sheet('network', 'Redes do vCenter (API)', inv.networks.filter((n) => /Network|Portgroup/.test(n.type)).map((n) => ({ 'Port Group': n.name, 'Tipo': /Distributed/.test(n.type) ? 'Port group distribuído' : /Opaque/.test(n.type) ? 'Rede NSX' : 'Port group padrão', 'Datacenter': n.datacenter })))];
  }
  if (kind === 'baseline') {
    const rows = [];
    const add = (type, list) => list.forEach((x) => rows.push({ resource_type: type, resource_name: x.name, region_name: x.datacenter || '', compartment_name: x.cluster || '' }));
    add('Datacenter', inv.datacenters); add('Cluster', inv.clusters); add('Host ESXi', inv.hosts); add('Virtual Machine', inv.vms);
    return [U.sheet('baseline', 'Recursos do vCenter (API)', rows)];
  }
  throw new Error('Tipo de dado não disponível para o vCenter.');
}
function soapTenant(cfg, inv) {
  const a = inv.about || {};
  return [U.sheet('tenant', 'vCenter (API)', [{ 'vCenter': trim(cfg.url).replace(/^https?:\/\//, ''), 'Versão': [a.version, a.build ? `build ${a.build}` : ''].filter(Boolean).join(' '), 'Datacenters': inv.datacenters.map((d) => d.name).join(', '),
    'Clusters': inv.clusters.map((c) => c.name).join(', '), 'Hosts ESXi': String(inv.hosts.length), 'VMs': `${inv.vms.length} (${inv.vms.filter(powerOn).length} ligadas)` }])];
}

/** Topologia: switches (vDS e vSwitch padrão) como hubs e port groups (com VLAN e VMs) como redes. */
function topology(inv) {
  const m = TOPO.model();
  const vlanOf = (cfg) => {
    const v = cfg && cfg.vlan;
    if (!v) return '';
    if (v.vlanId != null && typeof v.vlanId !== 'object') return Number(v.vlanId) ? `VLAN ${v.vlanId}` : 'sem VLAN';
    if (v.vlanId && typeof v.vlanId === 'object') return 'Trunk';
    return '';
  };
  const dvs = Object.fromEntries(inv.networks.filter((n) => /DistributedVirtualSwitch/.test(n.type)).map((d) => [d.id, d]));
  Object.values(dvs).forEach((d) => m.hub('dvs:' + d.id, 'vDS', d.name, d.datacenter));
  for (const n of inv.networks.filter((x) => /DistributedVirtualPortgroup/.test(x.type))) {
    if (/uplink/i.test(n.name)) continue; // port group dos uplinks do vDS
    const sw = dvs[ref(n['config.distributedVirtualSwitch'])];
    const vms = arr(n.vm).length;
    m.networks.push({ id: n.id, name: n.name, cidr: vlanOf(n['config.defaultPortConfig']), group: sw ? sw.name : '', region: n.datacenter, subnets: [], gateways: [{ type: `${vms} VM${vms !== 1 ? 's' : ''}`, name: '' }] });
    if (sw) m.link(n.id, 'dvs:' + sw.id, 'attach');
  }
  // port groups padrão: estão em cada host; junta por nome (com o vSwitch e quantos hosts têm)
  const std = {};
  for (const h of inv.hosts) for (const pg of arr(h['config.network.portgroup'])) {
    const spec = (pg && pg.spec) || {}; if (!spec.name) continue;
    const k = spec.name;
    const e = std[k] = std[k] || { name: spec.name, vlan: spec.vlanId, vswitch: spec.vswitchName, hosts: new Set(), dc: h.datacenter };
    e.hosts.add(h.name);
  }
  const stdNet = Object.fromEntries(inv.networks.filter((x) => x.type === 'Network').map((x) => [x.name, x]));
  for (const e of Object.values(std)) {
    const hub = 'vss:' + e.vswitch;
    m.hub(hub, 'vSwitch', `${e.vswitch} (padrão)`, e.dc);
    const vms = arr((stdNet[e.name] || {}).vm).length;
    m.networks.push({ id: 'pg:' + e.name, name: e.name, cidr: Number(e.vlan) ? `VLAN ${e.vlan}` : Number(e.vlan) === 4095 ? 'Trunk' : 'sem VLAN', group: e.vswitch, region: e.dc, subnets: [],
      gateways: [{ type: `${vms} VM${vms !== 1 ? 's' : ''}`, name: '' }, { type: `${e.hosts.size} host${e.hosts.size !== 1 ? 's' : ''}`, name: '' }] });
    m.link('pg:' + e.name, hub, 'attach');
  }
  return TOPO.sheet('Topologia do vCenter (API)', m);
}

/** Segurança: versões e suporte, alarmes, VMware Tools, snapshots antigos, datastores cheios, hosts fora do ar e lockdown. */
const SUPPORT = (ver) => {
  const major = parseFloat(ver) || 0;
  if (major >= 8) return ['OK', 'versão com suporte'];
  if (major >= 7) return ['Atenção', 'fim do suporte geral da VMware em 02/10/2025 (só suporte técnico até 2027)'];
  return ['Crítico', 'sem suporte da VMware (fim do suporte geral: 6.5/6.7 em 15/10/2022; 6.0 em 12/03/2020)'];
};
function security(cfg, inv) {
  const rows = []; const now = Date.now();
  const add = (c, d, st) => rows.push({ 'Controle': c, 'Descrição': d, 'Status': st });
  const a = inv.about || {};
  const [vs, vd] = SUPPORT(a.version);
  add('Versão do vCenter', `${a.fullName || 'vCenter ' + (a.version || '?')} — ${vd}`, vs);
  const byVer = {};
  inv.hosts.forEach((h) => { const k = `${h['summary.config.product.version'] || '?'} (build ${h['summary.config.product.build'] || '?'})`; (byVer[k] = byVer[k] || []).push(h.name); });
  for (const [k, hs] of Object.entries(byVer)) { const [st, d] = SUPPORT(k); add('Versão do ESXi', `${hs.length} host(s) em ${k}: ${hs.slice(0, 6).join(', ')}${hs.length > 6 ? '…' : ''} — ${d}`, st); }
  const down = inv.hosts.filter((h) => h['runtime.connectionState'] && h['runtime.connectionState'] !== 'connected');
  const maint = inv.hosts.filter((h) => h['runtime.inMaintenanceMode'] === 'true');
  add('Hosts desconectados', down.length ? down.map((h) => `${h.name} (${h['runtime.connectionState']})`).join(', ') : 'Todos os hosts conectados', down.length ? 'Crítico' : 'OK');
  if (maint.length) add('Hosts em manutenção', maint.map((h) => h.name).join(', '), 'Atenção');
  const lk = inv.hosts.filter((h) => h.lockdownMode);
  if (lk.length) { const off = lk.filter((h) => h.lockdownMode === 'lockdownDisabled'); add('Lockdown mode', off.length ? `${off.length} de ${lk.length} host(s) sem lockdown: ${off.slice(0, 6).map((h) => h.name).join(', ')}` : 'Todos os hosts com lockdown ativo', off.length ? 'Atenção' : 'OK'); }
  // VMware Tools nas VMs ligadas
  const on = inv.vms.filter(powerOn);
  const noTools = on.filter((v) => /NotInstalled/.test(v['guest.toolsVersionStatus2'] || ''));
  const oldTools = on.filter((v) => /NeedUpgrade|TooOld|SupportedOld|Blacklisted/.test(v['guest.toolsVersionStatus2'] || ''));
  const stopped = on.filter((v) => v['guest.toolsRunningStatus'] === 'guestToolsNotRunning' && !/NotInstalled/.test(v['guest.toolsVersionStatus2'] || ''));
  const list = (vs2) => vs2.slice(0, 8).map((v) => v.name).join(', ') + (vs2.length > 8 ? ` +${vs2.length - 8}` : '');
  add('VMware Tools', noTools.length + oldTools.length + stopped.length ? [noTools.length ? `${noTools.length} sem Tools (${list(noTools)})` : '', oldTools.length ? `${oldTools.length} desatualizado(s) (${list(oldTools)})` : '', stopped.length ? `${stopped.length} parado(s) (${list(stopped)})` : ''].filter(Boolean).join(' · ') : `Tools em dia nas ${on.length} VM(s) ligadas`, noTools.length || oldTools.length || stopped.length ? 'Atenção' : 'OK');
  // snapshots: quanto mais antigo, mais disco e mais risco
  const snaps = snapshotsOf(inv);
  const old7 = snaps.filter((x) => now - x.created > 7 * 86400000);
  const old30 = snaps.filter((x) => now - x.created > 30 * 86400000);
  add('Snapshots antigos', old7.length ? `${old7.length} snapshot(s) com mais de 7 dias${old30.length ? ` (${old30.length} com mais de 30)` : ''}: ${old7.slice(0, 6).map((x) => `${x.vm} "${x.name}" (${Math.floor((now - x.created) / 86400000)} d)`).join(', ')}` : `Nenhum snapshot com mais de 7 dias (${snaps.length} no total)`, old30.length ? 'Crítico' : old7.length ? 'Atenção' : 'OK');
  // datastores com pouco espaço
  const ds = inv.datastores.map((d) => ({ name: d.name, free: Number(d['summary.freeSpace']) / (Number(d['summary.capacity']) || 1) })).filter((d) => d.free < 0.15);
  add('Espaço nos datastores', ds.length ? ds.map((d) => `${d.name} (${Math.round(d.free * 100)}% livre)`).join(', ') : 'Todos com 15% ou mais de espaço livre', ds.some((d) => d.free < 0.05) ? 'Crítico' : ds.length ? 'Atenção' : 'OK');
  // alarmes disparados
  const names = Object.fromEntries([...inv.vms, ...inv.hosts, ...inv.datastores, ...inv.clusters, ...inv.datacenters].map((x) => [x.id, x.name]));
  const al = inv.alarms.filter((x) => x.status === 'red' || x.status === 'yellow');
  if (!al.length) add('Alarmes ativos', 'Nenhum alarme disparado no vCenter', 'OK');
  al.sort((x, y) => (x.status === 'red' ? 0 : 1) - (y.status === 'red' ? 0 : 1)).slice(0, 50).forEach((x) =>
    add('Alarme: ' + x.name, `${names[x.entity] || x.entity}${x.time ? ' · desde ' + String(x.time).slice(0, 10) : ''}${x.acknowledged ? ' · reconhecido' : ''}`, x.status === 'red' ? 'Crítico' : 'Atenção'));
  return U.sheet('security', 'Segurança do vCenter (API)', rows);
}
function snapshotsOf(inv) {
  const out = [];
  const walk = (vm, list) => arr(list).forEach((t) => { if (!t) return; out.push({ vm, name: t.name || '', created: Date.parse(t.createTime) || 0, description: t.description || '' }); walk(vm, t.childSnapshotList); });
  inv.vms.forEach((v) => v.snapshot && walk(v.name, v.snapshot.rootSnapshotList));
  return out;
}

/** Backup: política e execuções do backup do VCSA (API REST do appliance) e snapshots feitos no período. */
async function backup(cfg, opts = {}) {
  const rows = []; const warn = [];
  const mode = opts.backupMode || 'both';
  const from = opts.from ? new Date(opts.from + 'T00:00:00') : new Date(Date.now() - 31 * 86400000);
  const to = opts.to ? new Date(opts.to + 'T23:59:59') : new Date();
  const DIAS = { MONDAY: 'seg', TUESDAY: 'ter', WEDNESDAY: 'qua', THURSDAY: 'qui', FRIDAY: 'sex', SATURDAY: 'sáb', SUNDAY: 'dom' };
  let s = null;
  try { s = await session(cfg); } catch (e) { if (!e.noRest) warn.push('Backup do vCenter (VCSA) não veio: ' + e.message); }
  if (s) {
    try {
      // mapas vêm como objeto (API nova) ou [{ key, value }] (API antiga)
      const asMap = (x) => (Array.isArray(x) ? Object.fromEntries(x.map((e) => [e.key, e.value])) : x || {});
      if (mode !== 'jobs') {
        const sch = asMap(await s.get('/appliance/recovery/backup/schedules').catch(() => null));
        for (const [id, sc] of Object.entries(sch)) {
          const r = sc.recurrence_info || {};
          const days = arr(r.days).map((d) => DIAS[d] || d).join(', ') || 'todos os dias';
          rows.push({ 'Item': `vCenter Server (VCSA) — agendamento ${id}`, 'Situação': sc.enable === false ? 'Desativado' : 'Política ativa', 'Ferramenta': 'Backup do VCSA (arquivo)',
            'Frequência': `${days} às ${String(r.hour ?? '').padStart(2, '0')}:${String(r.minute ?? 0).padStart(2, '0')}`, 'Retenção': sc.retention_info && sc.retention_info.max_count ? `${sc.retention_info.max_count} backup(s)` : '—', 'Criado em': '' });
        }
        if (!Object.keys(sch).length) rows.push({ 'Item': 'vCenter Server (VCSA)', 'Situação': 'Sem agendamento', 'Ferramenta': 'Backup do VCSA (arquivo)', 'Frequência': '—', 'Retenção': '—', 'Criado em': '' });
      }
      if (mode !== 'policies') {
        const ST = { SUCCEEDED: 'OK', FAILED: 'Falha', INPROGRESS: 'Em andamento', NONE: '—', BLOCKED: 'Bloqueado' };
        let jobs = [];
        if (s.style === 'api') jobs = Object.entries(asMap(await s.get('/appliance/recovery/backup/job/details').catch(() => null))).map(([id, j]) => Object.assign({ id }, j));
        else for (const id of arr(await s.get('/appliance/recovery/backup/job').catch(() => [])).slice(0, 60)) { try { jobs.push(Object.assign({ id }, await s.get('/appliance/recovery/backup/job/' + encodeURIComponent(id)))); } catch (e) { /* job sem detalhe */ } }
        for (const j of jobs) {
          const start = new Date(j.start_time || j.start || 0);
          if (!(start >= from && start <= to)) continue;
          rows.push({ 'Item': `vCenter Server (VCSA) — ${String(j.type || 'BACKUP').toLowerCase()}`, 'Situação': ST[j.state || j.status] || j.state || j.status || '', 'Ferramenta': 'Backup do VCSA (arquivo)',
            'Frequência': 'Agendado', 'Retenção': '—', 'Criado em': start.toISOString().slice(0, 10) });
        }
      }
    } catch (e) { warn.push('Backup do vCenter (VCSA): ' + e.message); }
    finally { s.close(); }
  }
  // snapshots criados no período (não são backup, mas costumam aparecer na rotina)
  if (mode !== 'policies') {
    try {
      for (const x of snapshotsOf(await soapInv(cfg))) {
        if (!(x.created >= from.getTime() && x.created <= to.getTime())) continue;
        rows.push({ 'Item': `${x.vm} — snapshot "${x.name}"`, 'Situação': 'Snapshot (não é backup)', 'Ferramenta': 'Snapshot do vSphere', 'Frequência': 'Manual', 'Retenção': '—', 'Criado em': new Date(x.created).toISOString().slice(0, 10) });
      }
    } catch (e) { warn.push('Snapshots do vCenter não vieram: ' + e.message); }
  }
  if (!rows.length && warn.length) throw new Error(warn.join(' | '));
  return [U.sheet('backup', 'Backup do vCenter (API)', rows), ...warn.map((message) => ({ kind: 'warning', message }))];
}

// ═══ Entradas do conector ═══
/** Sessão REST, ou null se o vCenter não tiver REST (5.5/6.0). */
async function restOrNull(cfg) { try { return await session(cfg); } catch (e) { if (e.noRest) return null; throw e; } }

async function test(cfg) {
  const s = await restOrNull(cfg);
  if (s) { s.close(); return restTest(cfg); }
  const inv = await soapInv(cfg);
  return { message: `Conectado ao vCenter ${(inv.about && inv.about.version) || ''} (API SOAP, sem REST) — ${inv.hosts.length} host(s) ESXi, ${inv.vms.length} VM(s)` };
}
async function pull(cfg, kind, opts = {}) {
  if (kind === 'backup') return backup(cfg, opts);
  const s = await restOrNull(cfg);
  if (s) s.close();
  const out = s ? await restPull(cfg, kind) : soapSheets(await soapInv(cfg), kind);
  if (kind === 'network') {
    // topologia pela SOAP (switches, VLANs e VMs por rede); sem ela, a sincronização segue com a planilha
    try { out.push(topology(await soapInv(cfg))); } catch (e) { out.push({ kind: 'warning', message: 'Topologia do vCenter não veio: ' + e.message }); }
  }
  return out;
}
async function tenant(cfg) {
  const s = await restOrNull(cfg);
  if (s) { s.close(); return restTenant(cfg); }
  return soapTenant(cfg, await soapInv(cfg));
}
/** Segurança (no lugar do Security Score, que o vCenter não tem). */
async function score(cfg) {
  const inv = await soapInv(cfg);
  return [security(cfg, inv), ...inv.warn.map((message) => ({ kind: 'warning', message }))];
}

// o que o vCenter oferece na sincronização (CVEs não vêm do vCenter; "score" = checagens de segurança)
const KINDS = ['servers', 'storage', 'network', 'baseline', 'tenant', 'backup', 'score'];
module.exports = { label: 'VMware vCenter', test, pull, tenant, score, KINDS };
