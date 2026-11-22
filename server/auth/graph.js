/* ═══ Grupos do Microsoft Entra ID → papel no Book Técnico ═══
 * Dois caminhos (configurados em ⚙️ Administrador › Login e acesso › Grupos do Entra ID):
 *  1. No login SAML: o Entra envia os IDs dos grupos (claim "groups"); o papel é recalculado a cada login.
 *     Grupo de administradores → admin; grupo de usuários → usuário; nenhum → acesso negado (opcional).
 *     Se a pessoa estiver em grupos demais (o Entra manda só um link), consulta o Graph para esses grupos.
 *  2. Sincronização periódica (Microsoft Graph, app com client secret + GroupMember.Read.All / User.Read.All):
 *     cria os usuários dos grupos, ajusta o papel e desativa quem saiu dos grupos (só usuários Microsoft;
 *     usuários com senha local nunca são alterados).
 */
const { httpError } = require('../storage/common');
const logs = require('../logs');

const GRAPH = 'https://graph.microsoft.com/v1.0';
const ids = (s) => String(s || '').split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);

/** admin | user | null a partir dos grupos da pessoa. */
function roleFromGroups(groups, g) {
  const mine = new Set((groups || []).map((x) => String(x).toLowerCase()));
  if (ids(g.adminGroups).some((id) => mine.has(id))) return 'admin';
  const users = ids(g.userGroups);
  if (users.length ? users.some((id) => mine.has(id)) : false) return 'user';
  return null;
}

async function token(c) {
  if (!(c.tenantId && c.clientId && c.clientSecret)) throw httpError(400, 'Microsoft Graph: preencha Tenant ID, Client ID e Client secret.');
  const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(c.tenantId)}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: c.clientId, client_secret: c.clientSecret, scope: 'https://graph.microsoft.com/.default' })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw httpError(502, 'Microsoft Graph recusou as credenciais: ' + (j.error_description || j.error || r.status).toString().split('\r')[0]);
  return j.access_token;
}
async function get(tk, url) {
  const r = await fetch(url, { headers: { authorization: 'Bearer ' + tk } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw httpError(502, `Microsoft Graph ${r.status}: ${(j.error && j.error.message) || 'erro'}`);
  return j;
}
async function members(tk, groupId) {
  const out = [];
  let url = `${GRAPH}/groups/${encodeURIComponent(groupId)}/transitiveMembers/microsoft.graph.user?$select=id,displayName,mail,userPrincipalName,accountEnabled&$top=999`;
  for (let n = 0; url && n < 100; n++) { const j = await get(tk, url); out.push(...(j.value || [])); url = j['@odata.nextLink']; }
  return out;
}

/** Grupos configurados dos quais a pessoa faz parte (para o caso de "grupos demais" no SAML). */
async function userGroups(c, g, oid) {
  const tk = await token(c);
  const wanted = [...ids(g.adminGroups), ...ids(g.userGroups)];
  const r = await fetch(`${GRAPH}/users/${encodeURIComponent(oid)}/checkMemberGroups`, { method: 'POST', headers: { authorization: 'Bearer ' + tk, 'content-type': 'application/json' }, body: JSON.stringify({ groupIds: wanted }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw httpError(502, 'Microsoft Graph: não foi possível ler os grupos do usuário.');
  return j.value || [];
}

/** Testa as credenciais e devolve o nome de cada grupo configurado. */
async function test(c, g) {
  const tk = await token(c);
  const out = [];
  for (const id of [...ids(g.adminGroups), ...ids(g.userGroups)]) {
    try { const j = await get(tk, `${GRAPH}/groups/${encodeURIComponent(id)}?$select=id,displayName`); out.push({ id, name: j.displayName, ok: true, role: ids(g.adminGroups).includes(id) ? 'admin' : 'user' }); }
    catch (e) { out.push({ id, ok: false, error: e.message }); }
  }
  return { ok: out.every((x) => x.ok), groups: out };
}

/** Sincroniza: cria/atualiza/desativa usuários Microsoft conforme os grupos. */
async function sync(c, g, store) {
  const tk = await token(c);
  const role = {}; const info = {};
  const take = (list, r) => list.forEach((m) => {
    const login = String(m.mail || m.userPrincipalName || '').toLowerCase(); if (!login) return;
    if (role[login] !== 'admin') role[login] = r;
    info[login] = { oid: m.id, name: m.displayName || login, email: (m.mail || m.userPrincipalName || '').toLowerCase(), enabled: m.accountEnabled !== false };
  });
  let total = 0;
  for (const id of ids(g.adminGroups)) { const m = await members(tk, id); total += m.length; take(m, 'admin'); }
  for (const id of ids(g.userGroups)) { const m = await members(tk, id); total += m.length; take(m, 'user'); }
  if (!total) throw httpError(502, 'Os grupos configurados não retornaram nenhum membro. Nada foi alterado (confira os IDs e as permissões do app).');

  const r = { created: 0, updated: 0, disabled: 0, enabled: 0, members: Object.keys(role).length };
  const users = await store.list();
  const byLogin = Object.fromEntries(users.map((u) => [u.username, u]));
  for (const [login, rl] of Object.entries(role)) {
    const m = info[login]; const u = byLogin[login];
    if (!u) { if (m.enabled) { await store.create({ username: login, name: m.name, email: m.email, role: rl, oid: m.oid }); r.created++; } continue; }
    if (u.provider !== 'saml') continue; // senha local: nunca mexe
    const disable = !m.enabled;
    if (u.role !== rl || u.name !== m.name || (u.disabledBySync && !disable) || (disable && !u.disabled)) {
      if (u.disabledBySync && !disable) r.enabled++;
      if (disable && !u.disabled) r.disabled++; else if (u.role !== rl || u.name !== m.name) r.updated++;
      const manual = !!u.disabled && !u.disabledBySync; // desativado pelo administrador: continua desativado
      await store.update(u, { role: rl, name: m.name, oid: m.oid, disabled: disable || manual, disabledBySync: disable && !manual });
    }
  }
  if (g.denyOthers) for (const u of users) {
    if (u.provider === 'saml' && !role[u.username] && !u.disabled) { await store.update(u, { disabled: true, disabledBySync: true }); r.disabled++; }
  }
  logs.app('info', `Sincronização com o Entra ID: ${r.members} membro(s) nos grupos — ${r.created} criado(s), ${r.updated} atualizado(s), ${r.disabled} desativado(s), ${r.enabled} reativado(s)`);
  if (r.created || r.updated || r.disabled || r.enabled) logs.audit('users.sync', `Grupos do Entra ID sincronizados: ${r.created} criado(s), ${r.updated} atualizado(s), ${r.disabled} desativado(s), ${r.enabled} reativado(s)`);
  return r;
}

module.exports = { roleFromGroups, userGroups, test, sync, ids };
