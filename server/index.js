#!/usr/bin/env node
/* ═══ Servidor do Book Técnico (npm run dev) ═══
 * Sem dependências obrigatórias: Node 22.5+ (SQLite nativo). O driver "mongodb" só é usado com o MongoDB.
 *  - Serve o app (index.html, css/, js/, assets/)
 *  - API REST que grava os books no banco escolhido: SQLite (padrão) ou MongoDB
 *  - Conectores que puxam inventário direto das clouds (server/cloud/*)
 *
 *   PORT=5173 HOST=127.0.0.1 npm run dev
 *
 * Integrações: OCI, AWS, Azure, GCP (inventário) · Zabbix (capacidade) · GLPI (chamados).
 *
 * Por padrão escuta só em 127.0.0.1 (esta máquina). Para a equipe acessar pela rede,
 * use HOST=0.0.0.0 — e lembre que as credenciais de cloud ficam neste servidor.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const localApp = require('./local');
localApp.applyEnv(); // app local (BOOK_LOCAL=1): pasta de dados, SQLite e arquivo do banco antes de carregar o armazenamento
const LOCAL = localApp.LOCAL;
const storage = require('./storage');
const { httpError, clientIp } = require('./storage/common');
const cloud = require('./cloud');
const pages = require('./html-include');
const auth = require('./auth');
const locks = require('./auth/locks');
const logs = require('./logs');
const trash = require('./trash');
const backup = require('./backup');
const mail = require('./mail');
const automation = require('./automation');

const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = path.join(__dirname, '..');
const PUBLIC = ['index.html', 'html', 'css', 'js', 'assets'];
const MAX_BODY = 150 * 1024 * 1024; // books com muitas imagens
const VERSION = require('../package.json').version;

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

// ── helpers ───────────────────────────────────────────────
/** Cabeçalhos de segurança em todas as respostas. */
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};
function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, SECURITY, headers));
  res.end(res.req && res.req.method === 'HEAD' ? undefined : body);
}
/** Bloqueia escrita vinda de outro site (CSRF): o navegador sempre manda Origin em POST/PUT/DELETE. */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;            // curl, scripts e testes
  if (origin === 'null') return false; // página sandbox/arquivo tentando escrever
  try { return new URL(origin).host === req.headers.host; } catch (e) { return false; }
}
function readRaw(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > max) { reject(httpError(413, 'Conteúdo grande demais.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function readBuffer(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > max) { reject(httpError(413, 'Arquivo grande demais.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readBody(req) {
  const raw = await readRaw(req);
  try { return raw ? JSON.parse(raw) : {}; } catch (e) { throw httpError(400, 'JSON inválido.'); }
}
/** Formulário HTML (application/x-www-form-urlencoded) — usado pela resposta SAML. */
async function readForm(req) { return Object.fromEntries(new URLSearchParams(await readRaw(req, 2 * 1024 * 1024))); }
function redirect(res, location, headers = {}) { res.writeHead(302, Object.assign({ Location: location, 'Cache-Control': 'no-store' }, SECURITY, headers)); res.end(); }
/** Página simples de erro de login (SAML volta direto para o servidor, não para o app). */
function loginErrorPage(res, msg) {
  const esc = String(msg).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  send(res, 401, `<!doctype html><meta charset="utf-8"><title>Login</title><body style="font-family:system-ui;max-width:520px;margin:12vh auto;padding:0 16px"><h2>Não foi possível entrar</h2><p>${esc}</p><p><a href="/">Voltar</a></p>`, { 'Content-Type': 'text/html; charset=utf-8' });
}

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html'; } catch (e) { return send(res, 400, 'Endereço inválido', { 'Content-Type': 'text/plain; charset=utf-8' }); }
  if (rel.includes('\0')) return send(res, 400, 'Endereço inválido', { 'Content-Type': 'text/plain; charset=utf-8' });
  if (!PUBLIC.some((p) => rel === p || rel.startsWith(p + '/'))) rel = 'index.html'; // URLs do app (?cliente=...) caem no index
  if (rel === 'index.html') {
    // monta a página com as partes de html/ (menu, header, paleta…)
    try { return send(res, 200, pages.build().replace(/\s*<script src="js\/core\/include\.js"><\/script>/, ''), { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' }); }
    catch (e) { console.error(e); return send(res, 500, 'Erro ao montar a página: ' + e.message, { 'Content-Type': 'text/plain; charset=utf-8' }); }
  }
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep)) return send(res, 403, { error: 'Proibido' });
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Não encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
    send(res, 200, buf, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  });
}

// ── credenciais: nunca devolvemos segredos ao navegador ────
const SECRET = { oci: ['keyPem', 'passphrase'], aws: ['secretAccessKey', 'sessionToken'], azure: ['clientSecret'], gcp: ['serviceAccountJson'], zabbix: ['apiToken', 'password'], glpi: ['appToken', 'userToken', 'password'], wazuh: ['password', 'indexerPassword'], defender: ['clientSecret'] };
const MASK = '••••••••';
// várias contas por provedor: "aws" é a primeira, "aws~xyz" as demais (ex.: PRD e HML)
const provType = (k) => String(k || '').split('~')[0];
function maskConnections(c) {
  const out = JSON.parse(JSON.stringify(c || { providers: {} }));
  for (const [p, cfg] of Object.entries(out.providers || {})) for (const f of SECRET[provType(p)] || []) if (cfg[f]) cfg[f] = MASK;
  return out;
}
function mergeConnections(old, incoming) {
  const out = { nome: incoming.nome || old.nome, providers: {} };
  for (const [p, cfg] of Object.entries(incoming.providers || {})) {
    if (!SECRET[provType(p)] || !cfg || typeof cfg !== 'object') continue;
    const from = typeof cfg._from === 'string' ? cfg._from : p; // conta que mudou de chave (ex.: a primeira foi removida)
    out.providers[p] = Object.assign({}, cfg); delete out.providers[p]._from;
    for (const f of SECRET[provType(p)]) if (cfg[f] === MASK) out.providers[p][f] = (old.providers?.[from] || {})[f] || '';
  }
  return out;
}

// ── login e permissões ────────────────────────────────────
const PUBLIC_API = new Set(['GET /api/health', 'GET /api/auth/me', 'POST /api/auth/login', 'POST /api/auth/logout', 'POST /api/auth/setup',
  'GET /api/auth/saml/login', 'POST /api/auth/saml/acs', 'GET /api/auth/saml/metadata']);
/** Rotas que mudam a configuração do sistema: só administradores (com login ligado). */
const ADMIN_API = new Set(['POST /api/settings/storage', 'PUT /api/settings/mongo', 'POST /api/settings/mongo/test', 'POST /api/settings/storage/delete',
  'GET /api/users', 'PUT /api/users', 'DELETE /api/users', 'DELETE /api/users/sessions', 'GET /api/auth/config', 'PUT /api/auth/config',
  'POST /api/auth/graph/sync', 'POST /api/auth/graph/test',
  'GET /api/trash', 'POST /api/trash/restore', 'DELETE /api/trash', 'PUT /api/trash/settings',
  'GET /api/logs', 'GET /api/mail/config', 'PUT /api/mail/config', 'POST /api/mail/test', 'GET /api/automation/base', 'PUT /api/automation/base', 'PUT /api/automation', 'POST /api/automation/run', 'GET /api/backup/config', 'PUT /api/backup/config', 'POST /api/backup/run', 'POST /api/backup/test', 'GET /api/backup/download', 'POST /api/backup/restore']);
/** App local: rotas de site (login, usuários, MongoDB, backup do servidor, e-mail, book automático, logs completos). */
const SITE_ONLY = /^(GET|PUT|POST|DELETE) \/api\/(users|auth\/(?!me$|prefs$)|mail\/|automation(?!\/profile$)|backup\/|logs$|settings\/mongo|settings\/storage\/delete)|^POST \/api\/settings\/storage$/;
async function guard(req, route) {
  if (LOCAL && SITE_ONLY.test(route)) throw httpError(404, 'Não disponível no app local.');
  const a = await auth.current(req);
  if (!auth.enabled()) return a; // login desligado: tudo liberado (como antes) — inclusive cadastrar os usuários antes de ligar
  if (PUBLIC_API.has(route)) return a;
  if (!a) throw httpError(401, 'Faça login para continuar.');
  if (ADMIN_API.has(route) && a.user.role !== 'admin') throw httpError(403, 'Somente administradores podem fazer isso.');
  return a;
}
const needAuth = (a) => { if (!a) throw httpError(401, 'Faça login para continuar.'); return a; };

// ── API ───────────────────────────────────────────────────
async function api(req, res, url) {
  const q = Object.fromEntries(url.searchParams);
  const route = `${req.method === 'HEAD' ? 'GET' : req.method} ${url.pathname}`; // HEAD = GET sem corpo (monitoramento)
  const me = await guard(req, route);
  if (me) logs.setUser(me.user);
  switch (route) {
    case 'PUT /api/auth/prefs': return send(res, 200, await auth.savePrefs(req, await readBody(req)));
    case 'POST /api/auth/graph/sync': return send(res, 200, await auth.graphSync('manual'));
    case 'POST /api/auth/graph/test': return send(res, 200, await auth.graphTest(await readBody(req)));
    // lixeira (admin)
    case 'GET /api/trash': return send(res, 200, { days: trash.retentionDays(), items: await trash.list() });
    case 'POST /api/trash/restore': { const b = await readBody(req); return send(res, 200, await trash.restore(b.tid, b.mode, me)); }
    case 'DELETE /api/trash': return send(res, 200, await trash.purge(q.tid));
    case 'PUT /api/trash/settings': { const r = trash.setRetention((await readBody(req)).days); logs.audit('config.trash', `Lixeira: itens apagados após ${r.days} dia(s)`); return send(res, 200, r); }
    // logs (admin)
    case 'GET /api/logs': return send(res, 200, await logs.query(q.kind, q));
    // backup (admin)
    // e-mail (admin)
    case 'GET /api/mail/config': return send(res, 200, mail.publicConfig());
    case 'PUT /api/mail/config': return send(res, 200, mail.saveConfig(await readBody(req)));
    case 'POST /api/mail/test': return send(res, 200, await mail.test((await readBody(req)).to));
    // geração automática do book (configuração: admin; perfil da última sincronização: quem sincronizou)
    case 'GET /api/automation/base': return send(res, 200, automation.base());
    case 'PUT /api/automation/base': return send(res, 200, automation.saveBase(await readBody(req)));
    case 'GET /api/automation': return send(res, 200, Object.assign(await automation.get(q.cliente), { running: automation.isRunning(q.cliente), mailConfigured: mail.configured(), baseFolder: automation.base().baseFolder || process.env.BOOK_EXPORT_BASE || '' }));
    case 'PUT /api/automation': return send(res, 200, await automation.save(q.cliente, await readBody(req)));
    case 'PUT /api/automation/profile': return send(res, 200, await automation.saveProfile(q.cliente, await readBody(req)));
    case 'POST /api/automation/run': {
      const b = await readBody(req);
      const month = b.ano && b.mes ? { ano: String(b.ano), mes: String(b.mes).padStart(2, '0') } : undefined;
      if (!/^\d{4}$/.test(month ? month.ano : '2000') || !/^(0[1-9]|1[0-2])$/.test(month ? month.mes : '01')) throw httpError(400, 'Mês inválido.');
      automation.enqueue(q.cliente, { month, by: me && me.user ? { name: me.user.name || me.user.username } : null, send: b.send !== false }); // roda em segundo plano; a tela acompanha
      return send(res, 202, { queued: true });
    }
    case 'GET /api/backup/config': return send(res, 200, backup.publicConfig());
    case 'PUT /api/backup/config': return send(res, 200, backup.saveConfig(await readBody(req)));
    case 'POST /api/backup/run': return send(res, 200, await backup.run('manual'));
    case 'POST /api/backup/test': { const b = await readBody(req); return send(res, 200, await backup.testDestination(b.dest, b.config)); }
    case 'GET /api/backup/download': {
      const f = await backup.download();
      logs.audit('backup.download', `Backup baixado pelo navegador: ${f.name}`);
      return send(res, 200, f.buf, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${f.name}"` });
    }
    case 'POST /api/backup/restore': return send(res, 200, await backup.restore(await readBuffer(req), String(req.headers['x-backup-password'] || '')));
    case 'POST /api/settings/storage/delete': { const b = await readBody(req); return send(res, 200, await backup.deleteDatabase(b.storage, b.confirm)); }
    // login
    case 'GET /api/auth/me': return send(res, 200, await auth.me(req));
    case 'POST /api/auth/login': return send(res, 200, await auth.login(req, res, await readBody(req)));
    case 'POST /api/auth/logout': return send(res, 200, await auth.logout(req, res));
    case 'POST /api/auth/setup': return send(res, 200, await auth.setup(req, res, await readBody(req)));
    case 'GET /api/auth/config': return send(res, 200, Object.assign(auth.publicConfig(), { acsUrl: auth.baseUrl(req) + '/api/auth/saml/acs', entityIdSuggestion: auth.baseUrl(req) }));
    case 'PUT /api/auth/config': return send(res, 200, await auth.saveConfig(await readBody(req)));
    case 'GET /api/auth/saml/login':
      try { return redirect(res, await auth.samlLoginUrl(req)); } catch (e) { return loginErrorPage(res, e.message); }
    case 'POST /api/auth/saml/acs':
      try { await auth.samlAcs(req, res, await readForm(req)); return redirect(res, '/', { 'Set-Cookie': res.getHeader('Set-Cookie') }); }
      catch (e) { console.error('  ⚠ SAML: ' + e.message); return loginErrorPage(res, e.status ? e.message : 'Resposta do Microsoft inválida: ' + e.message); }
    case 'GET /api/auth/saml/metadata': return send(res, 200, await auth.samlMetadata(req), { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': 'attachment; filename="book-tecnico-saml-metadata.xml"' });
    // usuários (admin)
    case 'GET /api/users': return send(res, 200, await auth.listUsers());
    case 'PUT /api/users': return send(res, 200, await auth.saveUser(await readBody(req), me && me.user));
    case 'DELETE /api/users': await auth.deleteUser(q.id, me && me.user); return send(res, 200, { ok: true });
    case 'DELETE /api/users/sessions': await auth.endUserSessions(q.id); return send(res, 200, { ok: true });
    // bloqueio de edição
    case 'GET /api/locks': return send(res, 200, await locks.list(me));
    case 'GET /api/lock': return send(res, 200, locks.active() ? await locks.status(q.book, me) : { locked: false, disabled: true });
    case 'POST /api/lock': {
      const b = await readBody(req);
      if (!locks.active()) return send(res, 200, { locked: false, disabled: true, acquired: true });
      const a = needAuth(me);
      const fn = { acquire: () => locks.acquire(b.book, a), heartbeat: () => locks.heartbeat(b.book, a, !!b.active), release: () => locks.release(b.book, a),
        request: () => locks.request(b.book, a), respond: () => locks.respond(b.book, a, !!b.allow), takeover: () => locks.takeOver(b.book, a) }[b.action];
      if (!fn) throw httpError(400, 'Ação de bloqueio desconhecida.');
      return send(res, 200, await fn());
    }
    case 'GET /api/health': return send(res, 200, Object.assign({ ok: true, mode: 'server', version: VERSION, providers: cloud.list(), storage: storage.info() }, LOCAL ? { local: Object.assign({ dbFile: localApp.dbFile() }, localApp.who()) } : {}));
    // ── app local: arquivo do banco e histórico de edições ──
    case 'GET /api/local': if (!LOCAL) break;
      return send(res, 200, Object.assign({ dbFile: localApp.dbFile(), appDir: localApp.APPDIR, suggestions: localApp.suggestions(), counts: await storage.api.counts() }, localApp.who()));
    case 'POST /api/local/pick-folder': if (!LOCAL) break; return send(res, 200, await localApp.pickFolder((await readBody(req)).start));
    case 'POST /api/local/db': {
      if (!LOCAL) break;
      const b = await readBody(req);
      const r = localApp.setDbFile(b.path, ['move', 'use', 'new'].includes(b.mode) ? b.mode : 'move', () => storage.close());
      if (r.changed) logs.audit('db.file', `Banco ${{ move: 'movido para', use: 'trocado para o que já estava em', new: 'novo criado em' }[r.mode]} ${r.dbFile}`);
      return send(res, 200, Object.assign(r, { counts: await storage.api.counts() }));
    }
    case 'GET /api/edits': if (!LOCAL) break; return send(res, 200, await logs.edits(q));
    // "Sair" do ícone da bandeja (BookTecnico.exe): fecha o banco direitinho antes de encerrar
    case 'POST /api/local/quit': if (!LOCAL) break; send(res, 200, { ok: true }); setTimeout(() => shutdown('Sair'), 100); return;
    case 'GET /api/settings': return send(res, 200, await storage.getSettings());
    case 'PUT /api/settings': return send(res, 200, await storage.saveSettings(await readBody(req)));
    case 'GET /api/settings/storage': return send(res, 200, await storage.status());
    case 'POST /api/settings/storage': {
      const b = await readBody(req); const from = storage.kind();
      const r = await storage.switchStorage(b.storage, b.migrate !== false);
      if (from !== r.storage) { logs.audit('db.switch', `Banco trocado: ${from} → ${r.storage}${r.migrated ? ` (${r.migrated.books} book(s) copiados)` : ''}`); logs.app('info', `Armazenamento agora: ${storage.info().label}`); }
      return send(res, 200, r);
    }
    case 'PUT /api/settings/mongo': { const r = storage.saveMongoConfig(await readBody(req)); logs.audit('db.mongo-config', `Conexão do MongoDB alterada: ${r.url} · ${r.db}`); return send(res, 200, r); }
    case 'POST /api/settings/mongo/test': return send(res, 200, await storage.testMongo(await readBody(req)));
    case 'DELETE /api/client': await locks.assertNoneEditing(q.cliente, null, me); return send(res, 200, await trash.deleteClient(q.cliente, me));
    case 'DELETE /api/year': await locks.assertNoneEditing(q.cliente, q.ano, me); return send(res, 200, await trash.deleteYear(q.cliente, q.ano, me));
    case 'GET /api/session': return send(res, 200, (q.sid && (await storage.api.getSession(q.sid))) || {});
    case 'PUT /api/session': {
      if (!q.sid) throw httpError(400, 'sid obrigatório.');
      const b = await readBody(req);
      const data = { sid: q.sid, book: String(b.book || ''), route: String(b.route || ''), url: String(b.url || '').slice(0, 500), ua: String(req.headers['user-agent'] || '').slice(0, 200), updatedAt: Date.now() };
      await storage.api.saveSession(q.sid, data);
      return send(res, 200, { ok: true });
    }
    case 'GET /api/clients': return send(res, 200, await trash.decorateClients(await storage.api.listClients()));
    case 'GET /api/books': return send(res, 200, await storage.api.listBooks(q));
    case 'GET /api/book': return send(res, 200, await storage.api.getBook(q));
    case 'PUT /api/book': {
      const body = await readBody(req); await locks.assertCanSave(q, me);
      const r = await storage.api.saveBook(q, body);
      if (LOCAL) logs.edit(`${(body.meta && body.meta.cliente) || q.cliente} · ${q.mes}/${q.ano} · ${(body.meta && body.meta.area) || q.area}`);
      return send(res, 200, r);
    }
    case 'DELETE /api/book': await locks.assertCanSave(q, me); return send(res, 200, await trash.deleteBook(q, me));
    case 'GET /api/templates': return send(res, 200, await storage.api.listTemplates());
    case 'PUT /api/templates': return send(res, 200, await storage.api.saveTemplate(await readBody(req)));
    case 'DELETE /api/templates': await storage.api.deleteTemplate(q.id); return send(res, 200, { ok: true });
    case 'GET /api/connections': return send(res, 200, maskConnections(await storage.api.getConnections(q.cliente)));
    case 'PUT /api/connections': {
      const body = await readBody(req);
      await storage.api.saveConnections(q.cliente, mergeConnections(await storage.api.getConnections(q.cliente), body));
      return send(res, 200, { ok: true });
    }
    case 'POST /api/cloud/test': {
      const { provider } = await readBody(req);
      const cfg = (await storage.api.getConnections(q.cliente)).providers?.[provider];
      return send(res, 200, await cloud.test(provType(provider), cfg));
    }
    case 'POST /api/cloud/pull': {
      const { provider, kinds, from, to, severities, onlyWithAlerts, newOnly, backupMode } = await readBody(req);
      const cfg = (await storage.api.getConnections(q.cliente)).providers?.[provider];
      return send(res, 200, await cloud.pull(provType(provider), cfg, kinds, { from, to, severities, onlyWithAlerts: !!onlyWithAlerts, newOnly: !!newOnly, backupMode: ['jobs', 'policies', 'both'].includes(backupMode) ? backupMode : 'both' }));
    }
  }
  throw httpError(404, 'Rota não encontrada: ' + route);
}

const server = http.createServer((req, res) => {
  const ip = clientIp(req);
  logs.run({ ip }, () => handle(req, res, ip).catch((e) => { console.error(e); if (!res.headersSent) send(res, 500, { error: 'Erro interno' }); }));
});
async function handle(req, res, ip) {
  const url = new URL(req.url, 'http://localhost'); // só path/query interessam
  const t0 = Date.now();
  const isApi = url.pathname.startsWith('/api/');
  const isPage = !isApi && !/\.[a-z0-9]+$/i.test(url.pathname); // a página do app (não css/js/imagens)
  if (isApi || isPage) {
    const store = logs.ctx.getStore();
    res.on('finish', () => logs.http({ method: req.method, path: url.pathname + url.search, status: res.statusCode, ms: Date.now() - t0, ip, user: store && store.user, ua: String(req.headers['user-agent'] || '').slice(0, 120) }));
  }
  try {
    if (url.pathname.startsWith('/api/')) {
      // a resposta SAML vem do site da Microsoft (POST de outra origem) — é validada pela assinatura
      if (!['GET', 'HEAD'].includes(req.method) && url.pathname !== '/api/auth/saml/acs' && !sameOrigin(req)) throw httpError(403, 'Requisição de outra origem bloqueada.');
      return await api(req, res, url);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Método não permitido' });
    serveStatic(req, res, url.pathname);
  } catch (e) {
    if (!e.status) console.error(`  ✖ ${req.method} ${url.pathname}: ${e.stack || e.message}`);   // erro inesperado: pilha completa
    else if (e.status >= 500) console.error(`  ⚠ ${req.method} ${url.pathname}: ${e.message}`);
    if (!e.status || e.status >= 500) logs.app('error', `${req.method} ${url.pathname}: ${e.message}`, e.status ? undefined : { stack: String(e.stack || '').split('\n').slice(0, 6).join('\n') });
    if (res.headersSent) return res.end();
    send(res, e.status || 500, Object.assign({ error: e.message || 'Erro interno' }, e.data || {}));
  }
}

server.requestTimeout = 5 * 60 * 1000; // uploads grandes, mas sem conexões penduradas para sempre
server.headersTimeout = 60 * 1000;

/** Desligamento limpo (Ctrl+C, docker stop): para de aceitar conexões e fecha o banco. */
function shutdown(signal) {
  console.log(`\n  ⏻ ${signal}: encerrando…`);
  logs.app('info', `Servidor encerrando (${signal})`);
  const force = setTimeout(() => process.exit(1), 8000); force.unref();
  server.close(async () => { await storage.close(); process.exit(0); });
  if (server.closeIdleConnections) server.closeIdleConnections();
}

/** Sobe o servidor. Devolve a porta em uso. port 0 = qualquer porta livre (o app local usa). */
function start({ port = PORT, host = LOCAL ? '127.0.0.1' : HOST } = {}) {
  storage.bootstrap().then((m) => { if (m) console.log(`  📥 Dados antigos de data/ importados para ${storage.info().label}: ${m.books} book(s), ${m.templates} template(s), ${m.connections} conexão(ões)`); })
    .catch((e) => console.error('  ⚠ Armazenamento indisponível: ' + e.message));
  if (!LOCAL) {
    // só no site: backup do servidor, book automático (agenda) e sincronização de grupos do Entra ID
    backup.startScheduler();
    automation.start(() => server.address().port); // geração automática dos books (agenda por cliente)
    auth.startGraphScheduler();
  }
  const housekeeping = () => { trash.purgeExpired().then((n) => n && logs.app('info', `Lixeira: ${n} item(ns) apagado(s) por prazo`)).catch(() => {}); logs.prune().catch(() => {}); logs.pruneEdits().catch(() => {}); };
  setTimeout(housekeeping, 30000).unref(); setInterval(housekeeping, 6 * 3600000).unref();
  ['SIGINT', 'SIGTERM'].forEach((s) => process.on(s, () => shutdown(s)));
  process.on('unhandledRejection', (e) => console.error('  ✖ Erro não tratado:', e));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const info = storage.info(); const p = server.address().port;
      logs.app('info', `Servidor iniciado (v${VERSION}) em ${host}:${p} — ${info.label}`);
      console.log(`\n  📘 Book Técnico v${VERSION}${LOCAL ? ' (app local)' : ''} rodando em  http://${host === '0.0.0.0' ? 'localhost' : host}:${p}`);
      console.log(`  💾 Armazenamento             ${info.label} — ${info.location}`);
      console.log(`  ☁️  Conectores               ${cloud.list().join(', ')}\n`);
      resolve(p);
    });
  });
}

if (require.main === module) start().catch((e) => { console.error('  ✖ ' + e.message); process.exit(1); });
module.exports = { server, start };
