/* ═══ Lixeira: books, anos e clientes excluídos ═══
 * Excluir não apaga: move para a lixeira com quem excluiu e quando. O administrador pode restaurar
 * ou excluir definitivamente. Itens não restaurados somem sozinhos depois de N dias (padrão 30).
 *
 * Identidade: cada cliente, ano e book tem um GUID.
 *   book    → state.guid (gravado no próprio book)
 *   cliente → entities "client:<slug>"        ano → entities "year:<slug>/<ano>"
 * Excluir e recriar algo com o mesmo nome gera um GUID novo, então a lixeira mostra os dois lado a lado
 * ("duplicado"). Ao restaurar com conflito, o admin escolhe: substituir o atual (que vai para a lixeira)
 * ou restaurar como cópia ("InfraCloud (restaurado)", com GUID novo).
 *
 * Banco: trash { _id: tid, type, guid, label, … , books: [{ key, guid }] }   trash_books { _id: "tid|key", state }
 */
const crypto = require('crypto');
const storage = require('./storage');
const logs = require('./logs');
const { httpError, keyOf, slug } = require('./storage/common');

const db = () => storage.api;
const DAY = 86400000;
const retentionDays = () => Math.min(365, Math.max(1, Number((storage.readFileSettings().trash || {}).days) || 30));
const conflictError = (msg, data) => Object.assign(httpError(409, msg), { data });

// ── GUIDs de cliente e ano ───────────────────────────────
async function guidFor(id, extra = {}) {
  const e = await db().kvGet('entities', id);
  if (e) return e.guid;
  const guid = crypto.randomUUID();
  await db().kvSet('entities', id, Object.assign({ _id: id, guid, createdAt: Date.now() }, extra));
  return guid;
}
const clientGuid = (c, nome) => guidFor('client:' + slug(c), { type: 'client', nome });
const yearGuid = (c, ano) => guidFor(`year:${slug(c)}/${ano}`, { type: 'year' });
async function forget(prefix) { for (const e of await db().kvList('entities')) if (e._id === prefix || e._id.startsWith(prefix + '/')) await db().kvDel('entities', e._id); }

/** Clientes com GUID do cliente e de cada ano (para a tela). */
async function decorateClients(list) {
  for (const c of list) {
    c.guid = await clientGuid(c.slug, c.nome);
    c.yearGuids = {};
    for (const a of c.anos) c.yearGuids[a] = await yearGuid(c.slug, a);
  }
  return list;
}

// ── mover para a lixeira ────────────────────────────────
const who = (me) => (me ? { id: me.user.id, name: me.user.name || me.user.username } : { id: null, name: 'Anônimo (login desligado)' });
const split = (key) => { const [cliente, ano, mes, area] = key.split('/'); return { cliente, ano, mes, area }; };

async function put(item, books) {
  const tid = crypto.randomUUID();
  const now = Date.now();
  Object.assign(item, { _id: tid, tid, deletedAt: now, expiresAt: now + retentionDays() * DAY, books: books.map((b) => ({ key: b.key, guid: b.state.guid || '', area: (b.state.meta || {}).area || split(b.key).area, mes: split(b.key).mes, ano: split(b.key).ano })) });
  for (const b of books) await db().kvSet('trash_books', `${tid}|${b.key}`, { _id: `${tid}|${b.key}`, tid, key: b.key, state: b.state });
  await db().kvSet('trash', tid, item);
  logs.audit('trash.' + item.type, `${item.typeLabel} "${item.label}" movido para a lixeira (${books.length} book(s))`, { tid, guid: item.guid, by: item.deletedBy.name });
  return item;
}

async function deleteBook(params, me) {
  const k = keyOf(params);
  const state = await db().getBook(params);
  const item = await put({ type: 'book', typeLabel: 'Book', guid: state.guid || '', cliente: k.cliente, clienteNome: (state.meta || {}).cliente || k.cliente, ano: k.ano,
    label: `${(state.meta || {}).cliente || k.cliente} · ${k.mes}/${k.ano} · ${(state.meta || {}).area || k.area}`, deletedBy: who(me) }, [{ key: k.id, state }]);
  await db().deleteBook(params);
  return { ok: true, trash: item.tid };
}
async function loadBooks(filter) {
  const out = [];
  for (const e of await db().listBooks(filter)) out.push({ key: e.key, state: await db().getBook(split(e.key)) });
  return out;
}
async function deleteYear(cliente, ano, me) {
  const c = slug(cliente); const a = String(ano || '').replace(/\D/g, '');
  const books = await loadBooks({ cliente: c, ano: a });
  const nome = books[0] ? books[0].state.meta.cliente || c : c;
  const guid = await yearGuid(c, a);
  const item = books.length ? await put({ type: 'year', typeLabel: 'Ano', guid, cliente: c, clienteNome: nome, ano: a, label: `${nome} · ${a}`, deletedBy: who(me) }, books) : null;
  const r = await db().deleteYear(c, a);
  await forget(`year:${c}/${a}`);
  return Object.assign(r, { trash: item && item.tid });
}
async function deleteClient(cliente, me) {
  const c = slug(cliente);
  const books = await loadBooks({ cliente: c });
  const conn = await db().getConnections(c);
  const nome = (books[0] && books[0].state.meta.cliente) || conn.nome || c;
  const hasConn = !!(conn && conn.providers && Object.keys(conn.providers).length) || (await db().listConnectionClients()).includes(c);
  const item = await put({ type: 'client', typeLabel: 'Cliente', guid: await clientGuid(c, nome), cliente: c, clienteNome: nome, label: nome, deletedBy: who(me),
    years: [...new Set(books.map((b) => split(b.key).ano))].sort(), connections: hasConn ? conn : null }, books);
  const r = await db().deleteClient(c);
  await forget('client:' + c); await forget('year:' + c);
  return Object.assign(r, { trash: item.tid });
}

// ── listar / restaurar / excluir de vez ─────────────────
async function list() {
  const items = (await db().kvList('trash')).sort((a, b) => b.deletedAt - a.deletedAt);
  const live = new Set((await db().listBooks({})).map((e) => e.key));
  const liveClients = new Set((await db().listClients()).map((c) => c.slug));
  const byLabel = {};
  items.forEach((i) => { byLabel[i.type + i.label] = (byLabel[i.type + i.label] || 0) + 1; });
  return items.map((i) => {
    const conflicts = i.books.filter((b) => live.has(b.key)).map((b) => b.key);
    const { connections, ...rest } = i; // credenciais não vão para o navegador
    return Object.assign(rest, {
      hasConnections: !!connections,
      conflicts,
      activeExists: i.type === 'client' ? liveClients.has(i.cliente) : conflicts.length > 0,
      duplicates: byLabel[i.type + i.label] // quantas vezes o mesmo nome está na lixeira
    });
  });
}

/** Nome livre para a cópia: "InfraCloud (restaurado)", "(restaurado 2)"… */
async function freeName(base, exists) {
  for (let n = 1; n < 100; n++) { const name = `${base} (restaurado${n > 1 ? ' ' + n : ''})`; if (!(await exists(name))) return name; }
  return `${base} (restaurado ${Date.now()})`;
}

/** mode: undefined (falha com 409 se houver conflito) | 'replace' | 'copy' */
async function restore(tid, mode, me) {
  const item = await db().kvGet('trash', tid);
  if (!item) throw httpError(404, 'Item não está mais na lixeira.');
  const live = new Set((await db().listBooks({})).map((e) => e.key));
  const conflicts = item.books.filter((b) => live.has(b.key)).map((b) => b.key);
  const clientLive = item.type === 'client' && (await db().listClients()).some((c) => c.slug === item.cliente);
  if ((conflicts.length || clientLive) && !mode) {
    throw conflictError(`Já existe ${item.type === 'client' ? 'um cliente' : conflicts.length > 1 ? 'books' : 'um book'} com o mesmo nome. Substituir o atual ou restaurar como cópia?`, { conflicts, clientLive });
  }
  const states = [];
  for (const b of item.books) { const t = await db().kvGet('trash_books', `${tid}|${b.key}`); if (t) states.push({ key: b.key, state: t.state }); }
  let targetCliente = item.clienteNome, restored = 0;

  if (mode === 'copy' && item.type === 'client' && clientLive) {
    const clients = await db().listClients();
    targetCliente = await freeName(item.clienteNome, async (n) => clients.some((c) => c.slug === slug(n)));
  }
  for (const { key, state } of states) {
    const p = split(key);
    const st = JSON.parse(JSON.stringify(state));
    st._keepSavedAt = true;
    if (mode === 'copy' && (live.has(key) || targetCliente !== item.clienteNome)) {
      st.restoredFrom = st.guid; st.guid = crypto.randomUUID();
      if (targetCliente !== item.clienteNome) { st.meta.cliente = targetCliente; p.cliente = targetCliente; }
      else { const area = await freeName(st.meta.area || p.area, async (n) => live.has(keyOf(Object.assign({}, p, { area: n })).id)); st.meta.area = area; p.area = area; }
    } else if (mode === 'replace' && live.has(key)) {
      const cur = await db().getBook(split(key));
      await put({ type: 'book', typeLabel: 'Book', guid: cur.guid || '', cliente: p.cliente, clienteNome: cur.meta.cliente || p.cliente, ano: p.ano,
        label: `${cur.meta.cliente || p.cliente} · ${p.mes}/${p.ano} · ${cur.meta.area || p.area}`, deletedBy: who(me), reason: `Substituído pela restauração de "${item.label}"` }, [{ key, state: cur }]);
    }
    await db().saveBook(p, st);
    restored++;
  }
  // conexões e GUIDs de cliente/ano voltam junto (na cópia, o cliente novo ganha GUID novo)
  if (item.type === 'client') {
    const copied = targetCliente !== item.clienteNome; // cópia ganha identificador novo; senão volta ao original
    const target = copied ? slug(targetCliente) : item.cliente;
    if (item.connections && (mode === 'replace' || copied || !clientLive)) await db().saveConnections(target, Object.assign({}, item.connections, { nome: targetCliente }));
    if (target === item.cliente && !(await db().kvGet('entities', 'client:' + target))) await db().kvSet('entities', 'client:' + target, { _id: 'client:' + target, guid: item.guid, type: 'client', nome: targetCliente, createdAt: Date.now() });
  }
  if (item.type === 'year' && mode !== 'copy' && !(await db().kvGet('entities', `year:${item.cliente}/${item.ano}`))) {
    await db().kvSet('entities', `year:${item.cliente}/${item.ano}`, { _id: `year:${item.cliente}/${item.ano}`, guid: item.guid, type: 'year', createdAt: Date.now() });
  }
  await removeItem(item);
  logs.audit('trash.restore', `${item.typeLabel} "${item.label}" restaurado${mode === 'copy' ? ' como cópia' : mode === 'replace' ? ' substituindo o atual' : ''} (${restored} book(s))`, { tid, guid: item.guid, mode: mode || 'normal' });
  return { ok: true, restored, cliente: targetCliente !== item.clienteNome ? slug(targetCliente) : item.cliente, mode: mode || 'normal' };
}

async function removeItem(item) {
  for (const b of item.books) await db().kvDel('trash_books', `${item.tid}|${b.key}`);
  await db().kvDel('trash', item.tid);
}
async function purge(tid) {
  const item = await db().kvGet('trash', tid);
  if (!item) throw httpError(404, 'Item não está mais na lixeira.');
  await removeItem(item);
  logs.audit('trash.purge', `${item.typeLabel} "${item.label}" excluído definitivamente`, { tid, guid: item.guid });
  return { ok: true };
}
/** Apaga o que passou do prazo (roda a cada 6 h e na inicialização). */
async function purgeExpired() {
  let n = 0;
  for (const i of await db().kvList('trash')) if (i.expiresAt < Date.now()) { await removeItem(i); n++; logs.audit('trash.expire', `${i.typeLabel} "${i.label}" apagado após ${retentionDays()} dias na lixeira`, { tid: i.tid, guid: i.guid }); }
  return n;
}
function setRetention(days) {
  const d = Number(days);
  if (!Number.isFinite(d) || d < 1 || d > 365) throw httpError(400, 'Dias na lixeira: de 1 a 365.');
  storage.writeFileSettings({ trash: { days: Math.round(d) } });
  return { days: Math.round(d) };
}

module.exports = { deleteBook, deleteYear, deleteClient, list, restore, purge, purgeExpired, retentionDays, setRetention, decorateClients, clientGuid, yearGuid };
