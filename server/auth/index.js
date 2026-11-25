/* ═══ Login: usuários, senhas, sessões e SAML (Microsoft Entra ID) ═══
 * Desligado por padrão: o app funciona como antes, sem login.
 * Ligado (⚙️ Configurações › Login e acesso), toda a API exige sessão, exceto /api/health e /api/auth/*.
 *
 * Dados (no banco ativo — SQLite ou MongoDB):
 *   users          { id, username, name, email, role: admin|user, provider: local|saml, hash, salt, disabled, createdAt, lastLogin }
 *   auth_sessions  { id: sha256(token), userId, createdAt, lastSeen, expiresAt, ip, ua }
 * Configuração (data/settings.json → auth): { enabled, saml: {...}, lock: { enabled, responseMinutes } }
 *
 * Cookie "bt_auth": token aleatório, HttpOnly, SameSite=Lax (Secure em HTTPS). No banco fica só o hash do token.
 */
const crypto = require('crypto');
const storage = require('../storage');
const logs = require('../logs');
const graph = require('./graph');
const { httpError, clientIp } = require('../storage/common');

const COOKIE = 'bt_auth';
const SESSION_DAYS = 7;
const ROLES = ['admin', 'user'];
const DEF = {
  enabled: false,
  saml: { enabled: false, label: 'Entrar com Microsoft', entryPoint: '', issuer: '', idpCert: '', publicUrl: '', autoCreate: true, defaultRole: 'user', allowedDomains: '' },
  lock: { enabled: false, responseMinutes: 3 },
  // grupos do Entra ID → papel (IDs de objeto dos grupos, separados por vírgula)
  groups: { enabled: false, adminGroups: '', userGroups: '', denyOthers: true },
  // Microsoft Graph (sincronização periódica dos grupos)
  graph: { enabled: false, tenantId: '', clientId: '', clientSecret: '', intervalHours: 6 }
};
const MASK = '••••••••';

// ── configuração ─────────────────────────────────────────
function config() {
  const a = storage.readFileSettings().auth || {};
  return { enabled: !!a.enabled, saml: Object.assign({}, DEF.saml, a.saml), lock: Object.assign({}, DEF.lock, a.lock),
    groups: Object.assign({}, DEF.groups, a.groups), graph: Object.assign({}, DEF.graph, a.graph), graphState: a.graphState || {} };
}
const enabled = () => config().enabled;
const db = () => storage.api;

// ── senhas ───────────────────────────────────────────────
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(password), salt, 64, SCRYPT).toString('hex') };
}
function checkPassword(user, password) {
  if (!user || !user.hash || !user.salt) return false;
  const a = Buffer.from(hashPassword(password, user.salt).hash, 'hex'), b = Buffer.from(user.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function validatePassword(p) {
  if (typeof p !== 'string' || p.length < 8) throw httpError(400, 'A senha precisa ter pelo menos 8 caracteres.');
  if (p.length > 200) throw httpError(400, 'Senha longa demais.');
}

// ── usuários ─────────────────────────────────────────────
const normUser = (u) => String(u || '').trim().toLowerCase();
/** O que pode ir para o navegador (nunca hash/salt). */
const publicUser = (u) => u && { id: u.id, username: u.username, name: u.name || u.username, email: u.email || '', role: u.role, provider: u.provider || 'local', disabled: !!u.disabled, createdAt: u.createdAt, lastLogin: u.lastLogin || null };
async function listUsers() { return (await db().kvList('users')).sort((a, b) => (a.name || a.username).localeCompare(b.name || b.username, 'pt-BR')); }
async function findUser(username) { const n = normUser(username); return (await listUsers()).find((u) => u.username === n) || null; }
async function getUser(id) { return id ? db().kvGet('users', id) : null; }
const activeAdmins = (users) => users.filter((u) => u.role === 'admin' && !u.disabled);

async function saveUser(body, actor) {
  const users = await listUsers();
  const old = body.id ? users.find((u) => u.id === body.id) : null;
  if (body.id && !old) throw httpError(404, 'Usuário não encontrado.');
  const username = normUser(body.username || (old && old.username));
  if (!/^[a-z0-9._@-]{2,80}$/.test(username)) throw httpError(400, 'Usuário inválido: use letras, números, ponto, hífen, _ ou @ (2 a 80).');
  if (users.some((u) => u.username === username && u.id !== (old && old.id))) throw httpError(409, 'Já existe um usuário com esse login.');
  const role = ROLES.includes(body.role) ? body.role : (old ? old.role : 'user');
  const u = Object.assign({}, old || { id: crypto.randomUUID(), provider: 'local', createdAt: Date.now() }, {
    username, role,
    name: String(body.name || (old && old.name) || username).trim().slice(0, 120),
    email: String(body.email != null ? body.email : (old && old.email) || '').trim().slice(0, 200),
    disabled: body.disabled != null ? !!body.disabled : !!(old && old.disabled)
  });
  if (body.password) { validatePassword(body.password); Object.assign(u, hashPassword(body.password)); }
  else if (!old && u.provider === 'local') throw httpError(400, 'Informe uma senha para o novo usuário.');
  // nunca deixar o sistema sem administrador ativo
  const after = users.filter((x) => x.id !== u.id).concat(u);
  if (enabled() && !activeAdmins(after).length) throw httpError(400, 'É preciso manter pelo menos um administrador ativo.');
  if (actor && old && actor.id === old.id && (u.role !== 'admin' || u.disabled) && old.role === 'admin') throw httpError(400, 'Você não pode tirar o seu próprio acesso de administrador.');
  await db().kvSet('users', u.id, u);
  if (u.disabled) await endUserSessions(u.id);
  const changes = !old ? 'criado' : [old.role !== u.role ? `papel ${old.role} → ${u.role}` : '', !!old.disabled !== u.disabled ? (u.disabled ? 'desativado' : 'reativado') : '', body.password ? 'senha trocada' : ''].filter(Boolean).join(', ') || 'dados alterados';
  logs.audit(old ? 'user.update' : 'user.create', `Usuário ${u.username}: ${changes}`, { userId: u.id });
  return publicUser(u);
}
async function deleteUser(id, actor) {
  const users = await listUsers();
  const u = users.find((x) => x.id === id); if (!u) throw httpError(404, 'Usuário não encontrado.');
  if (actor && actor.id === id) throw httpError(400, 'Você não pode excluir o seu próprio usuário.');
  if (enabled() && u.role === 'admin' && !activeAdmins(users.filter((x) => x.id !== id)).length) throw httpError(400, 'É preciso manter pelo menos um administrador ativo.');
  await endUserSessions(id);
  await db().kvDel('users', id);
  logs.audit('user.delete', `Usuário ${u.username} excluído`, { userId: id });
}

// ── sessões ──────────────────────────────────────────────
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('='); if (i <= 0) continue;
    const v = part.slice(i + 1).trim();
    try { out[part.slice(0, i).trim()] = decodeURIComponent(v); } catch (e) { out[part.slice(0, i).trim()] = v; } // cookie de outro app com "%" solto
  }
  return out;
}
const isHttps = (req) => !!(req.socket && req.socket.encrypted) || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
function cookieHeader(req, value, maxAge) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;
}
async function createSession(req, res, user) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const s = { id: sha(token), userId: user.id, createdAt: now, lastSeen: now, expiresAt: now + SESSION_DAYS * 86400000, ip: clientIp(req), ua: String(req.headers['user-agent'] || '').slice(0, 200) };
  await db().kvSet('auth_sessions', s.id, s);
  await db().kvSet('users', user.id, Object.assign({}, user, { lastLogin: now }));
  res.setHeader('Set-Cookie', cookieHeader(req, token, SESSION_DAYS * 86400));
  return s;
}
/** Sessão + usuário da requisição (ou null). Renova lastSeen no máximo 1x por minuto. */
async function current(req) {
  if (req._auth !== undefined) return req._auth;
  req._auth = null;
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const s = await db().kvGet('auth_sessions', sha(token));
  if (!s || s.expiresAt < Date.now()) { if (s) await db().kvDel('auth_sessions', s.id); return null; }
  const u = await getUser(s.userId);
  if (!u || u.disabled) return null;
  if (Date.now() - s.lastSeen > 60000) { s.lastSeen = Date.now(); s.expiresAt = Date.now() + SESSION_DAYS * 86400000; await db().kvSet('auth_sessions', s.id, s); }
  req._auth = { session: s, user: u };
  return req._auth;
}
async function endSession(id) { await db().kvDel('auth_sessions', id); await require('./locks').dropSession(id); }
async function endUserSessions(userId, why) {
  let n = 0;
  for (const s of await db().kvList('auth_sessions')) if (s.userId === userId) { await endSession(s.id); n++; }
  if (n && why) logs.audit('user.logout-forced', why, { userId });
  return n;
}
async function lastSeenByUser() {
  const out = {};
  for (const s of await db().kvList('auth_sessions')) {
    if (s.expiresAt < Date.now()) continue;
    const o = out[s.userId] = out[s.userId] || { lastSeen: 0, sessions: 0 };
    o.sessions++; o.lastSeen = Math.max(o.lastSeen, s.lastSeen);
  }
  return out;
}

// ── tentativas de login (força bruta) ───────────────────
const fails = new Map(); // ip|user → { n, until }
function checkThrottle(key) {
  const f = fails.get(key);
  if (f && f.until > Date.now()) throw httpError(429, `Muitas tentativas. Tente de novo em ${Math.ceil((f.until - Date.now()) / 1000)} s.`);
}
function noteFail(key, limit = 5) {
  const f = fails.get(key) || { n: 0, until: 0 }; f.n++;
  if (f.n >= limit) { f.until = Date.now() + Math.min(15, 2 ** (f.n - limit)) * 60000; }
  fails.set(key, f);
  if (fails.size > 5000) for (const [k, v] of fails) if (v.until < Date.now()) fails.delete(k); // limpa sem zerar quem está bloqueado
}

async function login(req, res, { username, password } = {}) {
  const key = clientIp(req) + '|' + normUser(username);
  const userKey = 'user|' + normUser(username); // também por usuário: tentativas vindas de vários IPs
  checkThrottle(key); checkThrottle(userKey);
  const u = await findUser(username);
  const ok = u && !u.disabled && u.provider !== 'saml' ? checkPassword(u, password) : (hashPassword(String(password || 'x')), false); // tempo parecido com ou sem usuário
  if (!ok) { noteFail(key); noteFail(userKey, 10); logs.audit('login.fail', `Login recusado para "${normUser(username)}"`, { ip: clientIp(req) }); throw httpError(401, 'Usuário ou senha incorretos.'); }
  fails.delete(key); fails.delete(userKey);
  await createSession(req, res, u);
  logs.setUser(u);
  logs.audit('login', `${u.username} entrou (senha)`, { ip: clientIp(req) });
  return { user: publicUser(u) };
}
async function logout(req, res) {
  const a = await current(req);
  if (a) { await endSession(a.session.id); logs.audit('logout', `${a.user.username} saiu`); }
  res.setHeader('Set-Cookie', cookieHeader(req, '', 0));
  return { ok: true };
}
/** Primeiro acesso: cria o administrador (só funciona com zero usuários). */
async function setup(req, res, body = {}) {
  if ((await listUsers()).length) throw httpError(409, 'O administrador já foi criado. Entre com seu usuário.');
  validatePassword(body.password);
  const u = await saveUser({ username: body.username, name: body.name, email: body.email, password: body.password, role: 'admin' });
  await createSession(req, res, await getUser(u.id));
  return { user: u };
}

// ── configuração (somente admin) ─────────────────────────
function publicConfig() {
  const c = config();
  return { enabled: c.enabled, saml: Object.assign({}, c.saml, { configured: !!(c.saml.entryPoint && c.saml.idpCert && c.saml.issuer) }), lock: c.lock,
    groups: c.groups, graph: Object.assign({}, c.graph, { clientSecret: c.graph.clientSecret ? MASK : '' }), graphState: c.graphState };
}
async function saveConfig(body = {}) {
  const c = config();
  const next = { enabled: body.enabled != null ? !!body.enabled : c.enabled, saml: Object.assign({}, c.saml), lock: Object.assign({}, c.lock) };
  if (body.saml) {
    const s = body.saml;
    for (const k of ['label', 'entryPoint', 'issuer', 'idpCert', 'publicUrl', 'allowedDomains']) if (s[k] != null) next.saml[k] = String(s[k]).trim().slice(0, 20000);
    if (s.enabled != null) next.saml.enabled = !!s.enabled;
    if (s.autoCreate != null) next.saml.autoCreate = !!s.autoCreate;
    if (s.defaultRole && ROLES.includes(s.defaultRole)) next.saml.defaultRole = s.defaultRole;
    if (next.saml.entryPoint && !/^https:\/\//.test(next.saml.entryPoint)) throw httpError(400, 'A URL de login do SAML precisa começar com https://');
    if (next.saml.publicUrl && !/^https?:\/\/[^/]+/.test(next.saml.publicUrl)) throw httpError(400, 'Endereço público inválido (ex.: https://book.suaempresa.com).');
    if (next.saml.enabled && !(next.saml.entryPoint && next.saml.idpCert && next.saml.issuer)) throw httpError(400, 'Para ligar o SAML, preencha URL de login, Identificador (Entity ID) e certificado.');
  }
  if (body.lock) {
    if (body.lock.enabled != null) next.lock.enabled = !!body.lock.enabled;
    if (body.lock.responseMinutes != null) {
      const m = Number(body.lock.responseMinutes);
      if (!Number.isFinite(m) || m < 1 || m > 120) throw httpError(400, 'Tempo de resposta: de 1 a 120 minutos.');
      next.lock.responseMinutes = Math.round(m);
    }
  }
  next.groups = Object.assign({}, c.groups); next.graph = Object.assign({}, c.graph); next.graphState = c.graphState;
  if (body.groups) {
    const g = body.groups;
    if (g.enabled != null) next.groups.enabled = !!g.enabled;
    if (g.denyOthers != null) next.groups.denyOthers = !!g.denyOthers;
    for (const k of ['adminGroups', 'userGroups']) if (g[k] != null) next.groups[k] = String(g[k]).trim().slice(0, 4000);
    const bad = [...graph.ids(next.groups.adminGroups), ...graph.ids(next.groups.userGroups)].find((id) => !/^[0-9a-f-]{36}$/.test(id));
    if (bad) throw httpError(400, `"${bad}" não parece o ID de objeto de um grupo (formato 00000000-0000-0000-0000-000000000000).`);
    if (next.groups.enabled && !graph.ids(next.groups.adminGroups).length) throw httpError(400, 'Informe pelo menos um grupo de administradores.');
  }
  if (body.graph) {
    const gr = body.graph;
    if (gr.enabled != null) next.graph.enabled = !!gr.enabled;
    for (const k of ['tenantId', 'clientId']) if (gr[k] != null) next.graph[k] = String(gr[k]).trim();
    if (gr.clientSecret != null && gr.clientSecret !== MASK) next.graph.clientSecret = String(gr.clientSecret).trim();
    if (gr.intervalHours != null) { const h = Number(gr.intervalHours); if (!Number.isFinite(h) || h < 1 || h > 168) throw httpError(400, 'Intervalo da sincronização: de 1 a 168 horas.'); next.graph.intervalHours = Math.round(h); }
    if (next.graph.enabled && !(next.graph.tenantId && next.graph.clientId && next.graph.clientSecret)) throw httpError(400, 'Microsoft Graph: preencha Tenant ID, Client ID e Client secret.');
    if (next.graph.enabled && !next.groups.enabled) throw httpError(400, 'Ligue "Definir o papel pelos grupos" para sincronizar com o Graph.');
  }
  if (next.enabled && !activeAdmins(await listUsers()).length) throw httpError(400, 'Crie um administrador antes de ligar o login.');
  const diff = [c.enabled !== next.enabled ? `login ${next.enabled ? 'ligado' : 'desligado'}` : '', c.saml.enabled !== next.saml.enabled ? `Microsoft ${next.saml.enabled ? 'ligado' : 'desligado'}` : '',
    c.lock.enabled !== next.lock.enabled ? `edição simultânea ${next.lock.enabled ? 'bloqueada' : 'liberada'}` : '', c.groups.enabled !== next.groups.enabled ? `grupos do Entra ${next.groups.enabled ? 'ligados' : 'desligados'}` : ''].filter(Boolean);
  storage.writeFileSettings({ auth: next });
  logs.audit('config.auth', 'Login e acesso alterados' + (diff.length ? ': ' + diff.join(', ') : ''));
  return publicConfig();
}

// ── SAML (Microsoft Entra ID) ────────────────────────────
/** Endereço do app: URL externa (Configurações › Administrador › Site) ou o host da requisição. */
function baseUrl(req) { return require('../site').baseUrl(req, isHttps(req)); }
function samlClient(req) {
  const c = config().saml;
  let SAML;
  try { ({ SAML } = require('@node-saml/node-saml')); } catch (e) { throw httpError(501, 'Biblioteca SAML não instalada. Rode "npm install" (o container já vem com ela).'); }
  if (!c.enabled) throw httpError(404, 'Login Microsoft (SAML) desligado.');
  const cert = c.idpCert.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
  return new SAML({
    entryPoint: c.entryPoint,
    issuer: c.issuer,
    callbackUrl: baseUrl(req) + '/api/auth/saml/acs',
    idpCert: cert,
    audience: c.issuer,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    signatureAlgorithm: 'sha256',
    acceptedClockSkewMs: 5 * 60 * 1000,
    identifierFormat: null,
    disableRequestedAuthnContext: true
  });
}
async function samlLoginUrl(req) { return samlClient(req).getAuthorizeUrlAsync('', req.headers.host, {}); }
/** Resposta do Entra (POST no ACS): valida assinatura, cria/acha o usuário e abre a sessão. */
async function samlAcs(req, res, form) {
  const c = config().saml;
  const { profile } = await samlClient(req).validatePostResponseAsync({ SAMLResponse: form.SAMLResponse || '' });
  if (!profile) throw httpError(401, 'Resposta SAML sem usuário.');
  const claim = (k) => profile[k] || (profile.attributes || {})[k];
  const email = String(claim('http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress') || claim('email') || claim('http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name') || profile.nameID || '').toLowerCase();
  if (!email) throw httpError(401, 'O Entra ID não enviou e-mail/nome do usuário.');
  const domains = c.allowedDomains.split(/[\s,;]+/).map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  if (domains.length && !domains.includes(email.split('@')[1])) throw httpError(403, `O domínio de ${email} não tem acesso a este Book Técnico.`);
  const name = String(claim('http://schemas.microsoft.com/identity/claims/displayname') || [claim('http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname'), claim('http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname')].filter(Boolean).join(' ') || email);
  // papel pelos grupos do Entra ID (recalculado a cada login)
  const full = config();
  let groupRole = null;
  if (full.groups.enabled) {
    let groups = [].concat(claim('http://schemas.microsoft.com/ws/2008/06/identity/claims/groups') || []);
    const oid = claim('http://schemas.microsoft.com/identity/claims/objectidentifier');
    if (!groups.length && claim('http://schemas.microsoft.com/claims/groups.link') && full.graph.enabled && oid) groups = await graph.userGroups(full.graph, full.groups, oid); // grupos demais no token
    groupRole = graph.roleFromGroups(groups, full.groups);
    if (!groupRole && full.groups.denyOthers) { logs.audit('login.fail', `${email} barrado: não está em nenhum grupo autorizado do Entra ID`); throw httpError(403, `${email} não está em nenhum grupo autorizado do Microsoft Entra ID. Peça acesso ao administrador.`); }
  }
  let u = await findUser(email);
  if (!u) {
    if (!c.autoCreate && !groupRole) throw httpError(403, `${email} não está cadastrado. Peça acesso a um administrador.`);
    const id = crypto.randomUUID();
    u = { id, username: normUser(email), name, email, role: groupRole || c.defaultRole, provider: 'saml', disabled: false, createdAt: Date.now() };
    await db().kvSet('users', id, u);
    logs.audit('user.create', `Usuário ${u.username} criado no 1º login Microsoft (papel ${u.role})`, { userId: id });
  }
  if (u.disabled) throw httpError(403, 'Usuário desativado.');
  if (u.provider === 'saml' && (u.name !== name || (groupRole && u.role !== groupRole))) {
    if (groupRole && u.role !== groupRole) logs.audit('user.update', `Usuário ${u.username}: papel ${u.role} → ${groupRole} (grupos do Entra ID)`, { userId: u.id });
    u.name = name; if (groupRole) u.role = groupRole;
    await db().kvSet('users', u.id, u);
  }
  await createSession(req, res, u);
  logs.setUser(u);
  logs.audit('login', `${u.username} entrou (Microsoft)`);
  return u;
}
async function samlMetadata(req) {
  const c = config().saml;
  let SAML;
  try { ({ SAML } = require('@node-saml/node-saml')); } catch (e) { throw httpError(501, 'Biblioteca SAML não instalada.'); }
  const s = new SAML({ issuer: c.issuer || baseUrl(req), callbackUrl: baseUrl(req) + '/api/auth/saml/acs', idpCert: 'x', entryPoint: c.entryPoint || 'https://login.microsoftonline.com/' });
  return s.generateServiceProviderMetadata(null, null);
}

// ── Microsoft Graph: sincronização dos grupos ──────────
const graphStore = {
  list: listUsers,
  async create(x) { const id = crypto.randomUUID(); await db().kvSet('users', id, { id, username: normUser(x.username), name: x.name, email: x.email, role: x.role, oid: x.oid, provider: 'saml', disabled: false, createdAt: Date.now() }); },
  async update(u, patch) {
    const n = Object.assign({}, u, patch);
    if (n.role !== 'admin' && u.role === 'admin' && activeAdmins((await listUsers()).filter((x) => x.id !== u.id)).length === 0) return; // nunca fica sem admin
    await db().kvSet('users', u.id, n);
    if (n.disabled && !u.disabled) await endUserSessions(u.id);
  }
};
let syncing = null;
async function graphSync(reason = 'manual') {
  if (syncing) throw httpError(409, 'Sincronização já em andamento.');
  const c = config();
  if (!c.groups.enabled) throw httpError(400, 'Ligue "Definir o papel pelos grupos" primeiro.');
  syncing = graph.sync(c.graph, c.groups, graphStore);
  let state;
  try { const r = await syncing; state = { at: Date.now(), ok: true, reason, result: r }; return r; }
  catch (e) { state = { at: Date.now(), ok: false, reason, error: e.message }; logs.app('error', 'Sincronização com o Entra ID falhou: ' + e.message); throw e; }
  finally { syncing = null; const a = storage.readFileSettings().auth || {}; storage.writeFileSettings({ auth: Object.assign({}, a, { graphState: state }) }); }
}
function startGraphScheduler() {
  const t = setInterval(() => {
    const c = config();
    if (!c.groups.enabled || !c.graph.enabled) return;
    if (Date.now() - (c.graphState.at || 0) < c.graph.intervalHours * 3600000) return;
    graphSync('agendada').catch(() => { /* já foi para o log */ });
  }, 5 * 60000);
  t.unref();
}
async function graphTest(body) { if (body) await saveConfig(body); const c = config(); return graph.test(c.graph, c.groups); }

/** Preferências pessoais (tema). */
async function savePrefs(req, body = {}) {
  const a = await current(req);
  if (!a) return { ok: true, local: true };
  const prefs = Object.assign({}, a.user.prefs);
  if (['light', 'dark', 'system'].includes(body.theme)) prefs.theme = body.theme;
  await db().kvSet('users', a.user.id, Object.assign({}, a.user, { prefs }));
  return { ok: true, prefs };
}

/** Estado do login para a tela (público). */
async function me(req) {
  const c = config();
  const a = await current(req);
  const users = await listUsers();
  return {
    enabled: c.enabled,
    needsSetup: !users.length,
    user: a ? Object.assign(publicUser(a.user), { prefs: a.user.prefs || {} }) : null,
    saml: { enabled: c.enabled && c.saml.enabled, label: c.saml.label || DEF.saml.label },
    lock: { enabled: c.enabled && c.lock.enabled, responseMinutes: c.lock.responseMinutes }
  };
}

module.exports = {
  COOKIE, config, enabled, publicConfig, saveConfig, current, login, logout, setup, me,
  listUsers: async () => { const seen = await lastSeenByUser(); return (await listUsers()).map((u) => Object.assign(publicUser(u), seen[u.id] || { lastSeen: null, sessions: 0 })); },
  saveUser, deleteUser, endUserSessions, endSession,
  samlLoginUrl, samlAcs, samlMetadata, baseUrl, graphSync, graphTest, startGraphScheduler, savePrefs,
  _hashPassword: hashPassword
};
