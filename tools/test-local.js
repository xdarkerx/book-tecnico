/* ═══ Testes do app local (BOOK_LOCAL=1): sem login, histórico com usuário/máquina, banco em caminho escolhido ═══ */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const APP = fs.mkdtempSync(path.join(os.tmpdir(), 'book-local-'));
Object.assign(process.env, { BOOK_LOCAL: '1', BOOK_DATA_DIR: APP });
delete process.env.BOOK_DB_FILE; delete process.env.BOOK_STORAGE; delete process.env.MONGO_URL;
let passed = 0;
const ok = (n) => { passed++; console.log('  ✓ ' + n); };

(async () => {
  const { start, server } = require('../server/index');
  const port = await start({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, p, body) => { const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body && !['GET', 'HEAD'].includes(method) ? JSON.stringify(body) : undefined }); const t = await r.text(); let d; try { d = JSON.parse(t); } catch (e) { d = t; } return { status: r.status, data: d }; };

  const h = (await call('GET', '/api/health')).data;
  assert.ok(h.local && h.local.user && h.local.machine && h.local.dbFile === path.join(APP, 'book-tecnico.sqlite')); ok('health: app local com usuário, máquina e o arquivo do banco em %APPDATA%/BookTecnico');
  const me = (await call('GET', '/api/auth/me')).data;
  assert.strictEqual(me.enabled, false); ok('sem login');
  for (const [m, p] of [['GET', '/api/users'], ['PUT', '/api/auth/config'], ['GET', '/api/logs'], ['GET', '/api/mail/config'], ['GET', '/api/automation'], ['GET', '/api/backup/config'], ['PUT', '/api/settings/mongo'], ['POST', '/api/settings/storage']])
    assert.strictEqual((await call(m, p, {})).status, 404, `${m} ${p}`);
  assert.strictEqual((await call('PUT', '/api/automation/profile?cliente=acme', { sources: [] })).status, 200);
  ok('opções de site fora (usuários, login, logs completos, e-mail, book automático, backup, MongoDB); o perfil da sincronização continua');

  const key = 'cliente=acme&ano=2026&mes=11&area=infracloud';
  const st = { meta: { cliente: 'ACME', mes: '11', ano: '2026', area: 'InfraCloud' }, groups: [] };
  assert.strictEqual((await call('PUT', '/api/book?' + key, st)).status, 200);
  await call('PUT', '/api/book?' + key, st); // gravação seguida: mesma linha
  let ed = (await call('GET', '/api/edits')).data;
  assert.deepStrictEqual([ed.length, ed[0].action, ed[0].book, !!ed[0].user, !!ed[0].machine], [1, 'edit', 'ACME · 11/2026 · InfraCloud', true, true]); ok('histórico: edição com usuário do Windows e máquina (gravações seguidas viram uma linha)');
  assert.ok(!fs.existsSync(path.join(APP, 'book-tecnico.sqlite-wal'))); ok('SQLite sem -wal/-shm (um arquivo só, seguro no OneDrive)');
  assert.ok(!fs.existsSync(path.join(APP, 'logs', `http-${new Date().toISOString().slice(0, 10)}.jsonl`))); ok('sem log de requisições');

  // trocar a pasta do banco (ex.: OneDrive): mover, recusar sobrescrever, usar o existente
  const one = path.join(APP, 'OneDrive', 'BookTecnico');
  const mv = (await call('POST', '/api/local/db', { path: one, mode: 'move' })).data;
  assert.deepStrictEqual([mv.changed, mv.dbFile, mv.counts.books], [true, path.join(one, 'book-tecnico.sqlite'), 1]);
  assert.ok(fs.readdirSync(APP).some((f) => /book-tecnico\.sqlite\.movido-.*\.bak$/.test(f))); ok('mover o banco: books vão junto e o arquivo antigo fica como .bak');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(APP, 'local.json'), 'utf8')).dbFile, path.join(one, 'book-tecnico.sqlite')); ok('caminho escolhido salvo em local.json (vale na próxima abertura)');
  assert.strictEqual((await call('GET', '/api/books?cliente=acme')).data.length, 1);
  ed = (await call('GET', '/api/edits?q=movido')).data;
  assert.ok(ed.length === 1 && /movido para/.test(ed[0].msg)); ok('histórico registra a troca do banco');
  const novo = path.join(APP, 'outra');
  assert.strictEqual((await call('POST', '/api/local/db', { path: novo, mode: 'use' })).status, 400); ok('"usar o banco da pasta" sem banco lá: avisa');
  const nw = (await call('POST', '/api/local/db', { path: novo, mode: 'new' })).data;
  assert.strictEqual(nw.counts.books, 0);
  const back = (await call('POST', '/api/local/db', { path: one, mode: 'use' })).data;
  assert.strictEqual(back.counts.books, 1); ok('banco novo vazio e voltar para o existente (ex.: o que veio de outra máquina pelo OneDrive)');
  assert.strictEqual((await call('POST', '/api/local/db', { path: novo, mode: 'move' })).status, 409); ok('mover para uma pasta que já tem banco: recusa (não sobrescreve)');
  assert.strictEqual((await call('POST', '/api/local/db', { path: 'relativo\pasta', mode: 'move' })).status, 400); ok('caminho relativo: pede o caminho completo');

  server.close();
  await require('../server/storage').close();
  console.log(`\n${passed} testes do app local ok`);
  process.exit(0);
})().catch((e) => { console.error('\n✗ FALHOU:', e); process.exit(1); });
