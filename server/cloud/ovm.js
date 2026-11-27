/* ═══ Conector Oracle VM 3.x (OVM Manager, API REST) — menu On-Premises do book ═══
 * Config (por cliente): { url: 'https://ovmm.empresa.local:7002', user, password,
 *                         pools?: 'Pool-PRD, Pool-HML' (só estes; vazio = todos), insecure?: true }
 * API: https://<ovmm>:7002/ovm/core/wsapi/rest (OVM Manager 3.3 e 3.4), autenticação básica em cada chamada.
 * Colunas genéricas (Name, IP Address, Operating System, Status, Cluster…), que o mapeador entende.
 */
const U = require('./util');

/** URL da API a partir do que o usuário digitar ("ovmm.local", "https://ovmm:7002", ".../ovm/core/wsapi/rest"). */
const base = (cfg) => {
  if (!cfg.url) throw new Error('Informe a URL do OVM Manager (ex.: https://ovmm.empresa.local:7002).');
  let s = String(cfg.url).trim();
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  const u = new URL(s);
  if (!u.port) u.port = '7002'; // porta padrão do OVM Manager
  return `${u.protocol}//${u.host}/ovm/core/wsapi/rest`;
};
function client(cfg) {
  const b = base(cfg); // primeiro a URL, depois usuário e senha (mesma ordem da tela)
  if (!cfg.user || !cfg.password) throw new Error('Informe o usuário e a senha do OVM Manager.');
  const headers = { authorization: 'Basic ' + Buffer.from(cfg.user + ':' + cfg.password).toString('base64'), accept: 'application/json' };
  return async (path) => {
    try { return await (await U.request(b + path, { headers, insecure: !!cfg.insecure, timeout: 120000 })).json(); }
    catch (e) {
      if (e.status === 401) throw new Error('OVM Manager recusou o usuário ou a senha (401).');
      if (e.status === 403) throw new Error('Usuário sem permissão no OVM Manager (403).');
      throw e;
    }
  };
}
// as referências do OVM vêm como { value: id, name, type, uri }
const nameOf = (ref) => (ref && typeof ref === 'object' ? ref.name || ref.value || '' : ref || '');
const idOf = (o) => (o && o.id && typeof o.id === 'object' ? o.id.value : o && o.id) || '';
const list = (x) => (Array.isArray(x) ? x : x && Array.isArray(x.value) ? x.value : []);
const RUN = { RUNNING: 'running', STOPPED: 'stopped', SUSPENDED: 'suspended', STARTING: 'running', STOPPING: 'stopped', ERROR: 'erro' };
const gb = (bytes) => (bytes == null || bytes === '' ? '' : `${Math.round(Number(bytes) / 1073741824)} GB`);

async function inventory(get, cfg) {
  const only = U.list(cfg.pools).map((x) => x.toLowerCase());
  const keep = (poolRef) => !only.length || only.includes(String(nameOf(poolRef)).toLowerCase());
  const [vms, servers, pools] = await Promise.all([get('/Vm'), get('/Server'), get('/ServerPool')]);
  return { vms: list(vms).filter((v) => keep(v.serverPoolId)), servers: list(servers).filter((s) => keep(s.serverPoolId)), pools: list(pools).filter((p) => !only.length || only.includes(String(p.name).toLowerCase())) };
}

async function test(cfg) {
  const get = client(cfg);
  const inv = await inventory(get, cfg);
  let ver = '';
  try { const m = list(await get('/Manager'))[0]; ver = m && (m.managerVersion || m.version) ? ' ' + (m.managerVersion || m.version) : ''; } catch (e) { /* versão é opcional */ }
  return { message: `Conectado ao OVM Manager${ver} — ${inv.pools.length} server pool(s), ${inv.servers.length} servidor(es) OVS, ${inv.vms.length} VM(s)` };
}

async function pull(cfg, kind) {
  const get = client(cfg);
  const inv = await inventory(get, cfg);
  if (kind === 'servers') {
    // IPs: as placas virtuais (o OVM só sabe o IP quando o guest reporta)
    const ips = {};
    try {
      for (const n of list(await get('/VirtualNic'))) {
        const vm = nameOf(n.vmId) && (n.vmId.value || n.vmId);
        const addr = (n.ipAddresses || []).map((a) => (typeof a === 'string' ? a : a.address)).filter((a) => a && !/^(fe80|::)/i.test(a));
        if (vm && addr.length) ips[vm] = (ips[vm] || []).concat(addr);
      }
    } catch (e) { /* sem IPs */ }
    const rows = inv.vms.map((v) => ({
      'Name': v.name, 'IP Address': (ips[idOf(v)] || []).join(', '), 'Operating System': v.osType || '', 'Status': RUN[v.vmRunState] || String(v.vmRunState || '').toLowerCase(),
      'Location': nameOf(v.serverPoolId), 'Cluster': nameOf(v.serverPoolId), 'Host': nameOf(v.serverId), 'CPUs': v.currentCpuCount ?? v.cpuCount ?? '', 'Memory (MB)': v.currentMemory ?? v.memory ?? '',
      'Description': String(v.description || '').slice(0, 200)
    })).sort((a, b) => String(a.Name).localeCompare(String(b.Name)));
    return [U.sheet('servers', 'VMs do Oracle VM (API)', rows)];
  }
  if (kind === 'storage') {
    const fs = {};
    try { for (const f of list(await get('/FileSystem'))) fs[idOf(f)] = f; } catch (e) { /* sem tamanhos */ }
    const rows = list(await get('/Repository')).map((r) => {
      const f = fs[(r.fileSystemId && r.fileSystemId.value) || ''] || {};
      const size = f.size ?? f.totalSize; const free = f.freeSize ?? f.freeBytes;
      return { 'Name': r.name, 'Type': 'Repositório OVM', 'Capacity': gb(size), 'Used': size != null && free != null ? gb(size - free) : '', 'Status': r.locked ? 'Bloqueado' : 'Disponível' };
    });
    return [U.sheet('storage', 'Repositórios do Oracle VM (API)', rows)];
  }
  if (kind === 'network') {
    const rows = list(await get('/Network')).map((n) => ({ 'Network Name': n.name, 'Tipo': (n.roles || []).map((r) => String(r).replace(/_/g, ' ').toLowerCase()).join(', '), 'Descrição': n.description || '' }));
    return [U.sheet('network', 'Redes do Oracle VM (API)', rows)];
  }
  if (kind === 'baseline') {
    const rows = [];
    inv.pools.forEach((p) => rows.push({ resource_type: 'Server Pool', resource_name: p.name }));
    inv.servers.forEach((s) => rows.push({ resource_type: 'Oracle VM Server', resource_name: s.name, compartment_name: nameOf(s.serverPoolId) }));
    inv.vms.forEach((v) => rows.push({ resource_type: 'Virtual Machine', resource_name: v.name, compartment_name: nameOf(v.serverPoolId) }));
    return [U.sheet('baseline', 'Recursos do Oracle VM (API)', rows)];
  }
  throw new Error('Tipo de dado não disponível para o Oracle VM.');
}

/** Geral: OVM Manager (versão), server pools, servidores e VMs. */
async function tenant(cfg) {
  const get = client(cfg);
  const inv = await inventory(get, cfg);
  let ver = '';
  try { const m = list(await get('/Manager'))[0]; ver = (m && (m.managerVersion || m.version)) || ''; } catch (e) { /* opcional */ }
  const on = inv.vms.filter((v) => v.vmRunState === 'RUNNING').length;
  return [U.sheet('tenant', 'OVM Manager (API)', [{ 'OVM Manager': base(cfg).replace(/^https?:\/\//, '').replace(/\/ovm\/.*$/, ''), 'Versão': ver, 'Server Pools': inv.pools.map((p) => p.name).join(', '),
    'Servidores OVS': String(inv.servers.length), 'VMs': `${inv.vms.length} (${on} ligadas)` }])];
}

const KINDS = ['servers', 'storage', 'network', 'baseline', 'tenant'];
module.exports = { label: 'Oracle VM', test, pull, tenant, KINDS, _base: base };
