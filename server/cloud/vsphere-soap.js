/* ═══ vSphere Web Services (SOAP, /sdk) — funciona em todas as versões do vCenter (5.5 a 8.x) ═══
 * Usado pelo conector VMware para o que a API REST não traz (ou não existe, nos vCenter antigos):
 * inventário completo, switches e port groups com VLAN (topologia), alarmes, versões do ESXi, VMware Tools,
 * snapshots e datastores. Um inventário por vCenter fica em memória por 2 minutos (uma sincronização
 * chama vários tipos de dado e todos usam a mesma leitura).
 */
const U = require('./util');

const unesc = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(n)).replace(/&amp;/g, '&');
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** XML → árvore { name, attrs, children, text } (atributos guardados com o prefixo, ex.: "xsi:type"). */
function parse(xml) {
  const root = { name: '#', attrs: {}, children: [], text: '' }; const st = [root];
  const re = /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!\[CDATA\[([\s\S]*?)\]\]>|([^<]+)/g;
  xml = String(xml).replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  let m;
  while ((m = re.exec(xml))) {
    if (m[5] !== undefined || m[6] !== undefined) { st[st.length - 1].text += m[5] !== undefined ? m[5] : m[6]; continue; }
    if (m[1]) { if (st.length > 1) st.pop(); continue; }
    const attrs = {};
    (m[3] || '').replace(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (_, k, a, b) => { attrs[k] = unesc(a !== undefined ? a : b); });
    const node = { name: m[2].replace(/^.*:/, ''), attrs, children: [], text: '' };
    st[st.length - 1].children.push(node);
    if (!m[4]) st.push(node);
  }
  return root;
}
const find = (n, name) => { if (!n) return null; if (n.name === name) return n; for (const c of n.children) { const r = find(c, name); if (r) return r; } return null; };
const kids = (n, name) => (n ? n.children.filter((c) => c.name === name) : []);
const txt = (n) => (n ? unesc(n.text).trim() : '');
/** Nó → valor JS. Referência (type="HostSystem") vira { type, value }; ArrayOfX vira lista; repetidos viram lista. */
function toJs(n) {
  if (!n) return undefined;
  const xt = n.attrs['xsi:type'] || '';
  if (/^ArrayOf/.test(xt)) return n.children.map(toJs);
  if (!n.children.length) { const t = unesc(n.text); return n.attrs.type ? { type: n.attrs.type, value: t.trim() } : t; }
  const o = {};
  for (const c of n.children) { const v = toJs(c); if (c.name in o) o[c.name] = [].concat(o[c.name], [v]); else o[c.name] = v; }
  return o;
}
const arr = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);
const ref = (x) => (x && typeof x === 'object' ? x.value : x);

async function call(s, body) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="urn:vim25"><soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`;
  const headers = { 'content-type': 'text/xml; charset=utf-8', soapaction: `"urn:vim25/${s.api || '5.5'}"` };
  if (s.cookie) headers.cookie = s.cookie;
  const res = await U.request(s.url, { method: 'POST', headers, body: xml, insecure: s.insecure, timeout: 180000 });
  const set = res.headers.get('set-cookie');
  if (set) { const c = String(Array.isArray(set) ? set[0] : set).split(';')[0]; if (/vmware_soap_session/i.test(c)) s.cookie = c; }
  const doc = parse(await res.text());
  const fault = find(doc, 'Fault');
  if (fault) throw new Error('vCenter (SOAP): ' + (txt(find(fault, 'faultstring')) || 'erro'));
  const b = find(doc, 'Body');
  return b && b.children[0];
}

/** Abre a sessão SOAP: ServiceContent + Login. */
async function login(cfg, base) {
  const s = { url: base + '/sdk', insecure: !!cfg.insecure, api: '5.5', cookie: '' };
  let r;
  try { r = await call(s, '<RetrieveServiceContent><_this type="ServiceInstance">ServiceInstance</_this></RetrieveServiceContent>'); }
  catch (e) { if (e.status === 404) throw Object.assign(new Error('Este endereço não responde a API do vCenter (/sdk).'), { status: 404 }); throw e; }
  const sc = toJs(find(r, 'returnval'));
  s.sc = { rootFolder: ref(sc.rootFolder), propertyCollector: ref(sc.propertyCollector), viewManager: ref(sc.viewManager), sessionManager: ref(sc.sessionManager) };
  s.about = sc.about || {};
  if (s.about.apiVersion) s.api = s.about.apiVersion;
  try { await call(s, `<Login><_this type="SessionManager">${esc(s.sc.sessionManager)}</_this><userName>${esc(cfg.user)}</userName><password>${esc(cfg.password)}</password></Login>`); }
  catch (e) { throw /InvalidLogin|incorrect user|Cannot complete login/i.test(e.message) ? new Error('vCenter recusou o usuário ou a senha.') : e; }
  return s;
}
const logout = (s) => call(s, `<Logout><_this type="SessionManager">${esc(s.sc.sessionManager)}</_this></Logout>`).catch(() => {});

/** Lê propriedades de todos os objetos dos tipos pedidos: { VirtualMachine: ['name', …] } → [{ id, type, …props }]. */
async function retrieve(s, specs) {
  const types = Object.keys(specs);
  const view = ref(toJs(find(await call(s, `<CreateContainerView><_this type="ViewManager">${esc(s.sc.viewManager)}</_this><container type="Folder">${esc(s.sc.rootFolder)}</container>${types.map((t) => `<type>${t}</type>`).join('')}<recursive>true</recursive></CreateContainerView>`), 'returnval')));
  const propSet = types.map((t) => `<propSet><type>${t}</type>${specs[t].map((p) => `<pathSet>${p}</pathSet>`).join('')}</propSet>`).join('');
  const objectSet = `<objectSet><obj type="ContainerView">${esc(view)}</obj><skip>true</skip><selectSet xsi:type="TraversalSpec"><name>view</name><type>ContainerView</type><path>view</path><skip>false</skip></selectSet></objectSet>`;
  const out = [];
  const take = (rv) => {
    for (const o of kids(rv, 'objects')) {
      const obj = kids(o, 'obj')[0];
      const item = { id: txt(obj), type: obj ? obj.attrs.type : '' };
      for (const p of kids(o, 'propSet')) item[txt(kids(p, 'name')[0])] = toJs(kids(p, 'val')[0]);
      out.push(item);
    }
    return txt(kids(rv, 'token')[0]);
  };
  try {
    let rv = find(await call(s, `<RetrievePropertiesEx><_this type="PropertyCollector">${esc(s.sc.propertyCollector)}</_this><specSet>${propSet}${objectSet}</specSet><options><maxObjects>1000</maxObjects></options></RetrievePropertiesEx>`), 'returnval');
    let token = rv ? take(rv) : '';
    for (let n = 0; token && n < 200; n++) {
      rv = find(await call(s, `<ContinueRetrievePropertiesEx><_this type="PropertyCollector">${esc(s.sc.propertyCollector)}</_this><token>${esc(token)}</token></ContinueRetrievePropertiesEx>`), 'returnval');
      token = rv ? take(rv) : '';
    }
  } finally {
    call(s, `<DestroyView><_this type="ContainerView">${esc(view)}</_this></DestroyView>`).catch(() => {});
  }
  return out;
}
/** Propriedades de objetos específicos (ex.: o nome de cada alarme disparado). */
async function retrieveObjects(s, type, ids, paths) {
  if (!ids.length) return [];
  const objectSet = ids.map((id) => `<objectSet><obj type="${type}">${esc(id)}</obj><skip>false</skip></objectSet>`).join('');
  const rv = find(await call(s, `<RetrievePropertiesEx><_this type="PropertyCollector">${esc(s.sc.propertyCollector)}</_this><specSet><propSet><type>${type}</type>${paths.map((p) => `<pathSet>${p}</pathSet>`).join('')}</propSet>${objectSet}</specSet><options/></RetrievePropertiesEx>`), 'returnval');
  return kids(rv, 'objects').map((o) => { const item = { id: txt(kids(o, 'obj')[0]) }; for (const p of kids(o, 'propSet')) item[txt(kids(p, 'name')[0])] = toJs(kids(p, 'val')[0]); return item; });
}

/** Inventário completo (com cache de 2 min por vCenter + usuário). */
const cache = new Map();
async function inventory(cfg, base) {
  const key = base + '|' + cfg.user;
  const c = cache.get(key);
  if (c && Date.now() - c.at < 120000) return c.promise;
  const promise = load(cfg, base);
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => cache.delete(key));
  return promise;
}
async function load(cfg, base) {
  const s = await login(cfg, base);
  const warn = [];
  try {
    const ents = await retrieve(s, { Datacenter: ['name', 'parent'], Folder: ['name', 'parent'], ClusterComputeResource: ['name', 'parent'], ComputeResource: ['name', 'parent'] });
    const hosts = await retrieve(s, { HostSystem: ['name', 'parent', 'summary.config.product.fullName', 'summary.config.product.version', 'summary.config.product.build', 'runtime.connectionState', 'runtime.inMaintenanceMode', 'config.network.portgroup', 'config.network.vswitch'] });
    const vms = await retrieve(s, { VirtualMachine: ['name', 'runtime.powerState', 'runtime.host', 'guest.ipAddress', 'guest.hostName', 'config.guestFullName', 'summary.config.numCpu', 'summary.config.memorySizeMB', 'config.template', 'guest.toolsRunningStatus', 'guest.toolsVersionStatus2', 'snapshot', 'network'] });
    const datastores = await retrieve(s, { Datastore: ['name', 'parent', 'summary.capacity', 'summary.freeSpace', 'summary.type', 'summary.accessible'] });
    const networks = await retrieve(s, { Network: ['name', 'parent', 'vm'], DistributedVirtualPortgroup: ['name', 'parent', 'vm', 'config.distributedVirtualSwitch', 'config.defaultPortConfig'], DistributedVirtualSwitch: ['name', 'parent', 'summary.numPorts', 'summary.productInfo.version'] });
    // propriedades que não existem nas versões antigas: cada uma separada, sem derrubar o resto
    let lockdown = {};
    try { lockdown = Object.fromEntries((await retrieve(s, { HostSystem: ['config.lockdownMode'] })).map((h) => [h.id, h['config.lockdownMode']])); } catch (e) { /* vCenter 5.5: sem lockdownMode */ }
    let alarms = [];
    try {
      const root = await retrieveObjects(s, 'Folder', [s.sc.rootFolder], ['triggeredAlarmState']);
      const states = arr(root[0] && root[0].triggeredAlarmState);
      const names = Object.fromEntries((await retrieveObjects(s, 'Alarm', [...new Set(states.map((a) => ref(a.alarm)))], ['info.name'])).map((a) => [a.id, a['info.name']]));
      alarms = states.map((a) => ({ name: names[ref(a.alarm)] || ref(a.alarm), entity: ref(a.entity), entityType: a.entity && a.entity.type, status: a.overallStatus, time: a.time, acknowledged: a.acknowledged === 'true' }));
    } catch (e) { warn.push('Alarmes do vCenter não vieram: ' + e.message); }
    // datacenter e cluster de cada objeto pelo caminho de "parent"
    const byId = Object.fromEntries([...ents, ...hosts].map((x) => [x.id, x]));
    const up = (id, type) => { let cur = byId[id]; for (let i = 0; cur && i < 30; i++) { if (cur.type === type) return cur; cur = byId[ref(cur.parent)]; } return null; };
    for (const h of hosts) { h.datacenter = (up(h.id, 'Datacenter') || {}).name || ''; const cl = byId[ref(h.parent)]; h.cluster = cl && cl.type === 'ClusterComputeResource' ? cl.name : ''; h.lockdownMode = lockdown[h.id] || ''; }
    const hostById = Object.fromEntries(hosts.map((h) => [h.id, h]));
    for (const v of vms) { const h = hostById[ref(v['runtime.host'])] || {}; v.hostName = h.name || ''; v.cluster = h.cluster || ''; v.datacenter = h.datacenter || ''; }
    for (const d of [...datastores, ...networks]) d.datacenter = (up(ref(d.parent), 'Datacenter') || {}).name || '';
    return { about: s.about, datacenters: ents.filter((x) => x.type === 'Datacenter'), clusters: ents.filter((x) => x.type === 'ClusterComputeResource'), hosts, vms: vms.filter((v) => v['config.template'] !== 'true'), datastores, networks, alarms, warn };
  } finally { logout(s); }
}

module.exports = { inventory, parse, toJs, arr, ref, _cache: cache };
