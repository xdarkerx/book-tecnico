/* ═══ Bloqueio de edição: um book só é editado por uma pessoa por vez ═══
 * Vale quando o login E a opção "Bloquear edição simultânea" estão ligados (⚙️ Configurações).
 *
 * Fluxo:
 *   1. Ana abre o book → fica com o bloqueio. O navegador dela manda "sinal de vida" a cada ~20 s
 *      (lastSeen) e, quando ela mexe em algo, marca lastActive (é o "última atividade há 3h").
 *   2. Bruno abre o mesmo book → vê "Ana está editando · última atividade há 3h" (somente leitura).
 *   3. Bruno pede para editar → Ana recebe o pedido e pode liberar ou continuar.
 *   4. Se Ana não responder em N minutos (padrão 3), Bruno pode assumir: Ana é deslogada
 *      daquela sessão e Bruno fica com o book. Se Ana disser "continuar", o pedido é recusado.
 *   Aba fechada (sem sinal de vida por 90 s) → o book fica livre sozinho.
 *
 * Banco: coleção "locks" { book, userId, name, sessionId, since, lastSeen, lastActive, request }
 */
const { httpError, keyOf } = require('../storage/common');
const storage = require('../storage');

const STALE_MS = 90 * 1000;
const db = () => storage.api;
const auth = () => require('./index');

function active() { const c = auth().config(); return c.enabled && c.lock.enabled; }
const responseMs = () => auth().config().lock.responseMinutes * 60000;
/** "cliente/ano/mes/area" validado. */
function bookId(book) {
  const [cliente, ano, mes, area] = String(book || '').split('/');
  return keyOf({ cliente, ano, mes, area }).id;
}
const isStale = (l) => !l || Date.now() - l.lastSeen > STALE_MS;
const who = (a) => ({ userId: a.user.id, name: a.user.name || a.user.username, sessionId: a.session.id });

/** Visão do bloqueio para quem pergunta (sem ids de sessão). */
function view(l, a) {
  if (!l || isStale(l)) return { locked: false, mine: false };
  const mine = !!a && l.sessionId === a.session.id;
  const r = l.request;
  return {
    locked: true, mine,
    owner: { name: l.name, userId: l.userId, sameUser: !!a && l.userId === a.user.id },
    since: l.since, lastSeen: l.lastSeen, lastActive: l.lastActive,
    request: r ? {
      name: r.name, at: r.at, status: r.status, byMe: !!a && r.sessionId === a.session.id,
      deadline: r.at + responseMs(),
      canTakeOver: !!a && r.sessionId === a.session.id && r.status === 'pending' && Date.now() >= r.at + responseMs()
    } : null,
    responseMinutes: responseMs() / 60000
  };
}
async function get(id) { const l = await db().kvGet('locks', id); return isStale(l) ? null : l; }

async function status(book, a) { return view(await get(bookId(book)), a); }

async function acquire(book, a) {
  const id = bookId(book);
  const l = await get(id);
  if (l && l.sessionId !== a.session.id) return Object.assign(view(l, a), { acquired: false });
  const now = Date.now();
  const mine = l || Object.assign({ book: id, since: now, lastActive: now }, who(a));
  mine.lastSeen = now;
  await db().kvSet('locks', id, mine);
  return Object.assign(view(mine, a), { acquired: true });
}

/** Sinal de vida do dono. Devolve o pedido pendente (se houver) ou lost=true se o book foi assumido. */
async function heartbeat(book, a, activeNow) {
  const id = bookId(book);
  const l = await db().kvGet('locks', id);
  if (!l || l.sessionId !== a.session.id) {
    if (!l || isStale(l)) return acquire(book, a); // estava livre: retoma
    return Object.assign(view(l, a), { lost: true });
  }
  l.lastSeen = Date.now();
  if (activeNow) l.lastActive = Date.now();
  await db().kvSet('locks', id, l);
  return view(l, a);
}

async function release(book, a) {
  const id = bookId(book);
  const l = await db().kvGet('locks', id);
  if (l && l.sessionId === a.session.id) await db().kvDel('locks', id);
  return { ok: true };
}

async function request(book, a) {
  const id = bookId(book);
  const l = await get(id);
  if (!l) return acquire(book, a);
  if (l.sessionId === a.session.id) return view(l, a);
  if (l.request && l.request.status === 'pending' && l.request.sessionId !== a.session.id) throw httpError(409, `${l.request.name} já pediu para editar este book. Aguarde.`);
  if (!(l.request && l.request.sessionId === a.session.id && l.request.status === 'pending')) {
    l.request = Object.assign({ at: Date.now(), status: 'pending' }, who(a));
    await db().kvSet('locks', id, l);
  }
  return view(l, a);
}

/** Resposta do dono: allow=true passa o book para quem pediu; false recusa. */
async function respond(book, a, allow) {
  const id = bookId(book);
  const l = await get(id);
  if (!l || l.sessionId !== a.session.id || !l.request) throw httpError(409, 'Não há pedido pendente para este book.');
  if (allow) {
    const r = l.request, now = Date.now();
    await db().kvSet('locks', id, { book: id, userId: r.userId, name: r.name, sessionId: r.sessionId, since: now, lastSeen: now, lastActive: now });
    return { ok: true, released: true };
  }
  l.request.status = 'denied';
  await db().kvSet('locks', id, l);
  return view(l, a);
}

/** Assumir: quem pediu, depois do prazo sem resposta. A sessão do dono anterior é encerrada (deslogado). */
async function takeOver(book, a) {
  const id = bookId(book);
  const l = await get(id);
  if (!l) return acquire(book, a);
  const r = l.request;
  const allowed = r && r.sessionId === a.session.id && r.status === 'pending' && Date.now() >= r.at + responseMs();
  if (!allowed) {
    if (r && r.status === 'denied' && r.sessionId === a.session.id) throw httpError(409, `${l.name} recusou o pedido e continua editando.`);
    throw httpError(409, `Aguarde ${l.name} responder (até ${Math.round(responseMs() / 60000)} min depois do pedido).`);
  }
  await auth().endSession(l.sessionId); // desloga o dono ausente (só aquela sessão)
  const now = Date.now();
  const mine = Object.assign({ book: id, since: now, lastSeen: now, lastActive: now }, who(a));
  await db().kvSet('locks', id, mine);
  return Object.assign(view(mine, a), { acquired: true, previous: l.name });
}

/** Quem está editando o quê (lista de books). */
async function list(a) {
  if (!active()) return [];
  const out = [];
  for (const l of await db().kvList('locks')) if (!isStale(l)) out.push(Object.assign({ book: l.book }, view(l, a)));
  return out;
}

/** Salvar um book: se outra sessão tem o bloqueio, recusa (423). Sem bloqueio, pega para si. */
async function assertCanSave(params, a) {
  if (!active() || !a) return;
  const id = keyOf(params).id;
  const l = await get(id);
  if (l && l.sessionId !== a.session.id) throw httpError(423, `${l.name} está editando este book. Suas alterações não foram salvas.`);
  if (!l) await acquire(id, a);
}

/** Excluir cliente/ano: recusa se outra pessoa está com algum book dele aberto (senão o salvamento dela recriaria o book). */
async function assertNoneEditing(cliente, ano, a) {
  if (!active()) return;
  const prefix = require('../storage/common').slug(cliente) + '/' + (ano ? String(ano).replace(/\D/g, '') + '/' : '');
  const busy = (await db().kvList('locks')).filter((l) => !isStale(l) && l.book.startsWith(prefix) && (!a || l.sessionId !== a.session.id));
  if (busy.length) throw httpError(423, `Não dá para excluir agora: ${[...new Set(busy.map((l) => l.name))].join(', ')} está editando ${busy.length > 1 ? busy.length + ' books' : 'um book'} (${busy.map((l) => l.book.split('/').slice(1).join('/')).join(', ')}).`);
}

/** Sessão encerrada (logout, desativado, assumido): solta os bloqueios dela. */
async function dropSession(sessionId) {
  for (const l of await db().kvList('locks')) if (l.sessionId === sessionId) await db().kvDel('locks', l.book);
}

module.exports = { active, status, acquire, heartbeat, release, request, respond, takeOver, list, assertCanSave, assertNoneEditing, dropSession, STALE_MS };
