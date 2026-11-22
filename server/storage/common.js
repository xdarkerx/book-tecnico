/* ═══ Funções comuns aos armazenamentos (SQLite e MongoDB) ═══ */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA = process.env.BOOK_DATA_DIR || path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(DATA, { recursive: true });

function slug(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
function keyOf({ cliente, ano, mes, area }) {
  const k = { cliente: slug(cliente), ano: String(ano || '').replace(/\D/g, '').slice(0, 4), mes: String(mes || '').replace(/\D/g, '').padStart(2, '0').slice(-2), area: slug(area) };
  if (!k.cliente || k.ano.length !== 4 || !/^(0[1-9]|1[0-2])$/.test(k.mes) || !k.area) throw httpError(400, 'Identificação inválida: informe cliente, ano, mes (01-12) e area.');
  k.id = `${k.cliente}/${k.ano}/${k.mes}/${k.area}`;
  return k;
}
/** Entrada leve do índice (listas de clientes e books). */
function entry(st, k, mtime) {
  const m = st.meta || {};
  return { key: k.id || `${k.cliente}/${k.ano}/${k.mes}/${k.area}`, guid: st.guid || '', clienteSlug: k.cliente, ano: k.ano, mes: k.mes, areaSlug: k.area,
    cliente: m.cliente || k.cliente, area: m.area || k.area, template: st.template || '', updatedAt: st.savedAt || mtime || Date.now(), createdAt: st.createdAt || mtime || Date.now() };
}
/** Agrupa entradas por cliente (+ clientes que só têm conexões cadastradas). */
function clientsFrom(entries, extra = []) {
  const map = {};
  for (const e of entries) {
    const c = map[e.clienteSlug] = map[e.clienteSlug] || { slug: e.clienteSlug, nome: e.cliente, books: 0, anos: new Set(), areas: new Set(), updatedAt: 0 };
    c.books++; c.anos.add(e.ano); c.areas.add(e.area);
    if (e.updatedAt > c.updatedAt) { c.updatedAt = e.updatedAt; c.nome = e.cliente; }
  }
  for (const x of extra) if (!map[x.slug]) map[x.slug] = { slug: x.slug, nome: x.nome || x.slug, books: 0, anos: new Set(), areas: new Set(), updatedAt: 0 };
  return Object.values(map).map((c) => Object.assign(c, { anos: [...c.anos].sort().reverse(), areas: [...c.areas].sort() })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}
function writeJson(file, data, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data), mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
}
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; } };
function validateBook(st) { if (!st || typeof st !== 'object' || !Array.isArray(st.groups) || !st.meta || typeof st.meta !== 'object') throw httpError(400, 'Conteúdo do book inválido.'); }

/** Valida o book e carimba savedAt/createdAt (igual em todos os bancos). Devolve a entrada do índice. */
function prepareBook(params, st) {
  const k = keyOf(params);
  validateBook(st);
  st.savedAt = st.savedAt && st._keepSavedAt ? st.savedAt : Date.now();
  delete st._keepSavedAt;
  st.createdAt = st.createdAt || st.savedAt;
  st.guid = st.guid || crypto.randomUUID(); // identidade do book (lixeira, cópias, auditoria)
  return entry(st, k);
}
function clientSlug(cliente) { const c = slug(cliente); if (!c) throw httpError(400, 'Cliente inválido.'); return c; }
function clientYear(cliente, ano) {
  const c = slug(cliente), a = String(ano || '').replace(/\D/g, '');
  if (!c || a.length !== 4) throw httpError(400, 'Cliente/ano inválido.');
  return [c, a];
}
/** IP do cliente. X-Forwarded-For só vale atrás de um proxy confiável (BOOK_TRUST_PROXY=1), senão qualquer um forja. */
function clientIp(req) {
  const fwd = process.env.BOOK_TRUST_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
  return fwd || (req.socket && req.socket.remoteAddress) || '';
}
/** Esconde usuário/senha de uma URL de conexão (mongodb://user:pass@host → mongodb://***@host). */
const maskUrl = (u) => String(u || '').replace(/\/\/[^@/]*@/, '//***@');

module.exports = { DATA, slug, httpError, keyOf, entry, clientsFrom, writeJson, readJson, validateBook, prepareBook, clientSlug, clientYear, maskUrl, clientIp };
