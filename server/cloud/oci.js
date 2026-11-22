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
    payload = JSON.stringify(body);
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

async function pull(cfg, kind) {
  const c = config(cfg);
  const comps = await compartments(c);
  const rows = [];

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
            try { images[i.imageId] = (await call(c, 'GET', `${iaas(r)}/images/${i.imageId}`)).data?.displayName || ''; } catch (e) {}
          }
          rows.push({ 'Display Name': i.displayName, 'Private IP': ip, 'Image': images[i.imageId] || '', 'Lifecycle State': i.lifecycleState, 'Region': i.region || r,
            'compartment_path': comp.path, 'Shape': i.shape, 'OCPUs': i.shapeConfig?.ocpus ?? '', 'Memory (GB)': i.shapeConfig?.memoryInGBs ?? '', 'Availability Domain': i.availabilityDomain });
        });
      });
    }
    if (kind === 'storage') {
      let ns = null;
      try { ns = (await call(c, 'GET', `https://objectstorage.${r}.oraclecloud.com/n/`)).data; } catch (e) {}
      await U.pool(comps, 4, async (comp) => {
        for (const v of await listAll(c, `${iaas(r)}/volumes?compartmentId=${comp.id}&limit=1000`))
          if (v.lifecycleState !== 'TERMINATED') rows.push({ 'Display Name': v.displayName, 'Volume Type': 'Block Volume', 'Size in GBs': v.sizeInGBs + ' GB', 'Region': r, 'compartment_path': comp.path, 'Lifecycle State': v.lifecycleState });
        if (ns) for (const b of await listAll(c, `https://objectstorage.${r}.oraclecloud.com/n/${ns}/b?compartmentId=${comp.id}&limit=1000`))
          rows.push({ 'Display Name': b.name, 'Volume Type': 'Object Storage', 'Size in GBs': '', 'Region': r, 'compartment_path': comp.path, 'Lifecycle State': 'AVAILABLE' });
      });
    }
    if (kind === 'network') {
      await U.pool(comps, 4, async (comp) => {
        const vcns = await listAll(c, `${iaas(r)}/vcns?compartmentId=${comp.id}&limit=1000`);
        if (!vcns.length) return;
        const subnets = await listAll(c, `${iaas(r)}/subnets?compartmentId=${comp.id}&limit=1000`);
        for (const v of vcns) rows.push({ 'VCN Name': v.displayName, 'CIDRs': (v.cidrBlocks || [v.cidrBlock]).filter(Boolean).join(', '), 'compartment_path': comp.path, 'Region': r,
          'Subnets': subnets.filter((s) => s.vcnId === v.id).map((s) => `${s.displayName} (${s.cidrBlock})`).join('; ') });
      });
    }
  }
  const names = { servers: 'Instâncias OCI (API)', storage: 'Volumes + Buckets OCI (API)', network: 'VCNs OCI (API)' };
  return [U.sheet(kind, names[kind], rows)];
}

module.exports = { label: 'Oracle Cloud Infrastructure', test, pull, config, _call: call };
