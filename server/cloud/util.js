/* ═══ Utilidades dos conectores de cloud ═══ */
const fs = require('fs');
const os = require('os');
const path = require('path');

/** Corpo de erro legível: página HTML (ex.: erro do Tomcat/Jetty) vira só o título; espaços colapsados. */
function errText(body) {
  let t = String(body || '');
  if (/<html|<title|<body/i.test(t)) {
    const title = (t.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
    t = title || t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  }
  return t.replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** Requisição HTTPS aceitando certificado autoassinado (Zabbix/GLPI internos). */
function requestInsecure(url, opts = {}) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = (u.protocol === 'http:' ? require('http') : https).request(u, { method: opts.method || 'GET', headers: opts.headers || {}, rejectUnauthorized: false, timeout: opts.timeout || 60000 }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const r = { ok: res.statusCode < 400, status: res.statusCode, headers: { get: (k) => res.headers[k.toLowerCase()] }, text: async () => body, json: async () => JSON.parse(body) };
        if (!r.ok) { const e = new Error(`${res.statusCode} em ${u.host}${u.pathname}: ${errText(body)}`); e.status = res.statusCode; return reject(e); }
        resolve(r);
      });
    });
    req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
    req.on('error', (e) => reject(new Error(`Falha de rede em ${u.host}: ${e.code || e.message}`)));
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/** fetch com timeout e nova tentativa em 429/5xx. Lança erro com status e trecho da resposta. */
async function request(url, opts = {}, tries = 3) {
  if (opts.insecure) return requestInsecure(url, opts);
  for (let i = 0; ; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.timeout || 30000);
    let res;
    try { res = await fetch(url, Object.assign({}, opts, { signal: ctrl.signal })); }
    catch (e) { clearTimeout(t); if (i + 1 < tries) { await sleep(500 * (i + 1)); continue; } throw new Error(`Falha de rede em ${new URL(url).host}: ${e.cause?.code || e.message}`); }
    clearTimeout(t);
    if ((res.status === 429 || res.status >= 500) && i + 1 < tries) { await sleep(800 * (i + 1)); continue; }
    if (!res.ok) {
      const body = errText(await res.text());
      const e = new Error(`${res.status} em ${new URL(url).host}${new URL(url).pathname}: ${body}`); e.status = res.status; throw e;
    }
    return res;
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Executa fn em paralelo limitado (evita estourar rate limit das clouds). */
async function pool(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

/** Lê arquivos INI (~/.aws/credentials, ~/.oci/config). */
function readIni(file) {
  const out = {}; let sec = null;
  const txt = fs.readFileSync(expand(file), 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const l = line.trim(); if (!l || l.startsWith('#') || l.startsWith(';')) continue;
    const m = l.match(/^\[(.+)\]$/); if (m) { sec = out[m[1].replace(/^profile\s+/, '')] = {}; continue; }
    const kv = l.match(/^([^=]+?)\s*=\s*(.*)$/); if (kv && sec) sec[kv[1].trim()] = kv[2].trim();
  }
  return out;
}
const expand = (p) => String(p || '').replace(/^~(?=$|[\/\\])/, os.homedir());
const readFile = (p) => fs.readFileSync(expand(p), 'utf8');
const list = (v) => (Array.isArray(v) ? v : String(v || '').split(/[,;\s]+/)).map((x) => String(x).trim()).filter(Boolean);
const last = (s) => String(s || '').split('/').pop();

/** Parser XML mínimo (respostas da AWS). Retorna árvore {name, children, text}. */
function parseXml(xml) {
  const root = { name: '#root', children: [], text: '' };
  const stack = [root];
  const re = /<(\/?)([\w:.-]+)[^>]*?(\/?)>|([^<]+)/g; let m;
  xml = xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  while ((m = re.exec(xml))) {
    if (m[4] !== undefined) { stack[stack.length - 1].text += m[4]; continue; }
    if (m[1]) { stack.pop(); continue; }
    const node = { name: m[2].replace(/^.*:/, ''), children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!m[3]) stack.push(node);
  }
  return root;
}
const unesc = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
/** Navegação: child(node,'a'), all(node,'a') ; path como 'instancesSet/item' */
function child(node, p) { return p.split('/').reduce((n, name) => n && n.children.find((c) => c.name === name), node); }
function all(node, p) { const parts = p.split('/'); const parent = parts.length > 1 ? child(node, parts.slice(0, -1).join('/')) : node; return parent ? parent.children.filter((c) => c.name === parts[parts.length - 1]) : []; }
const text = (node, p) => unesc((p ? child(node, p) : node)?.text);
/** Busca recursiva por nome. */
function find(node, name, out = []) { for (const c of node.children) { if (c.name === name) out.push(c); find(c, name, out); } return out; }

/** Monta um resultado no formato que o front-end entende (igual a uma aba de planilha). */
function sheet(kind, name, rows) {
  const fields = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return { kind, name, fields, rows: rows.map((r) => Object.fromEntries(fields.map((f) => [f, r[f] === undefined || r[f] === null ? '' : String(r[f])]))) };
}

module.exports = { errText, request, sleep, pool, readIni, expand, readFile, list, last, parseXml, child, all, text, find, sheet };
