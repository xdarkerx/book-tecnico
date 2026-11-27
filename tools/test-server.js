#!/usr/bin/env node
/* Testes do servidor: API de books (SQLite e MongoDB simulado), login/SAML/bloqueio de edição + conectores de cloud com respostas simuladas.
 *   npm test
 * Não acessa nenhuma cloud nem MongoDB de verdade: fetch e driver são substituídos por versões de teste. */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA = process.env.BOOK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'book-test-'));
delete process.env.BOOK_STORAGE; delete process.env.MONGO_URL; delete process.env.MONGO_DB;
// dados de uma versão antiga (armazenamento em arquivos) — devem ser importados para o SQLite
const put = (rel, obj) => { fs.mkdirSync(path.dirname(path.join(DATA, rel)), { recursive: true }); fs.writeFileSync(path.join(DATA, rel), JSON.stringify(obj)); };
put('books/legado/2025/12-network.json', { meta: { cliente: 'Legado SA', area: 'Network' }, groups: [], savedAt: 1700000000000 });
put('templates/antigo.json', { id: 'antigo', name: 'Antigo', state: { meta: {}, groups: [] } });
put('connections/legado.json', { nome: 'Legado SA', providers: {} });
put('settings.json', { storage: 'file' });

const { server } = require('../server/index');
const storage = require('../server/storage');
const realFetch = global.fetch;
let passed = 0;
const ok = (name) => { passed++; console.log('  ✓ ' + name); };

async function main() {
  // ── Importação dos arquivos antigos ─────────────────────
  const imp = await storage.bootstrap();
  assert.deepStrictEqual([storage.kind(), imp.books, imp.templates, imp.connections], ['sqlite', 1, 1, 1]); ok('dados antigos em arquivos importados para o SQLite (storage "file" vira "sqlite")');
  assert.strictEqual(await storage.bootstrap(), null); ok('importação roda uma vez só');
  assert.strictEqual(storage.api.getBook({ cliente: 'legado', ano: '2025', mes: '12', area: 'network' }).savedAt, 1700000000000); ok('data de edição preservada na importação');

  // ── API de books (SQLite) ───────────────────────────────
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const j = async (method, p, body, headers = {}) => { const r = await realFetch(base + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, headers), body: body && JSON.stringify(body) }); return { status: r.status, data: await r.json(), headers: r.headers }; };

  const health = await j('GET', '/api/health');
  assert.strictEqual(health.data.mode, 'server'); assert.strictEqual(health.data.version, require('../package.json').version); ok('health (com versão do package.json)');
  assert.strictEqual(health.headers.get('x-content-type-options'), 'nosniff'); assert.strictEqual(health.headers.get('x-frame-options'), 'SAMEORIGIN'); ok('cabeçalhos de segurança');
  assert.deepStrictEqual(health.data.storage.options.map((o) => o[0]), ['sqlite', 'mongo']); ok('opções de armazenamento: só SQLite e MongoDB');
  const q = '?cliente=ACME%20Log%C3%ADstica&ano=2026&mes=11&area=InfraCloud';
  assert.strictEqual((await j('GET', '/api/book' + q)).status, 404); ok('book inexistente → 404');
  const st = { meta: { cliente: 'ACME Logística', area: 'InfraCloud' }, groups: [{ title: 'Book', sections: [] }] };
  assert.strictEqual((await j('PUT', '/api/book' + q, st, { origin: 'http://evil.example' })).status, 403); ok('escrita de outra origem bloqueada (CSRF)');
  assert.strictEqual((await j('PUT', '/api/book' + q, st, { origin: base })).status, 200); ok('salvar book (mesma origem)');
  assert.strictEqual((await j('PUT', '/api/book' + q, { meta: {} })).status, 400); ok('book sem groups → 400');
  assert.ok(fs.existsSync(path.join(DATA, 'book-tecnico.sqlite'))); ok('arquivo data/book-tecnico.sqlite criado');
  assert.strictEqual((await j('GET', '/api/book' + q)).data.meta.cliente, 'ACME Logística'); ok('ler book');
  const clients = (await j('GET', '/api/clients')).data;
  assert.deepStrictEqual(clients.map((c) => c.slug), ['acme-logistica', 'legado']); assert.deepStrictEqual(clients[0].anos, ['2026']); ok('listar clientes');
  assert.strictEqual((await j('GET', '/api/books?cliente=acme-logistica&ano=2026')).data.length, 1); ok('listar books do cliente/ano');
  assert.strictEqual((await j('PUT', '/api/book?cliente=../../etc&ano=2026&mes=13&area=x', st)).status, 400); ok('rejeita identificação inválida/traversal');
  await j('PUT', '/api/connections?cliente=acme-logistica', { providers: { aws: { accessKeyId: 'AK', secretAccessKey: 'SEGREDO', regions: 'sa-east-1' } } });
  const masked = (await j('GET', '/api/connections?cliente=acme-logistica')).data;
  assert.strictEqual(masked.providers.aws.secretAccessKey, '••••••••'); ok('segredos mascarados na API');
  await j('PUT', '/api/connections?cliente=acme-logistica', masked);
  assert.strictEqual(storage.api.getConnections('acme-logistica').providers.aws.secretAccessKey, 'SEGREDO'); ok('salvar com máscara preserva o segredo');
  // várias contas no mesmo provedor (PRD e HML)
  await j('PUT', '/api/connections?cliente=acme-logistica', { providers: { aws: { name: 'PRD', accessKeyId: 'AK1', secretAccessKey: 'S-PRD' }, 'aws~hml1': { name: 'HML', accessKeyId: 'AK2', secretAccessKey: 'S-HML' }, 'xpto~1': { a: 1 } } });
  const m2 = (await j('GET', '/api/connections?cliente=acme-logistica')).data;
  assert.strictEqual(m2.providers['aws~hml1'].secretAccessKey, '••••••••'); assert.ok(!m2.providers['xpto~1']); ok('conta extra (aws~…) tem segredos mascarados; provedor desconhecido é descartado');
  // remove a primeira: a HML assume a chave "aws" levando o segredo (_from)
  await j('PUT', '/api/connections?cliente=acme-logistica', { providers: { aws: Object.assign({}, m2.providers['aws~hml1'], { _from: 'aws~hml1' }) } });
  const c3 = storage.api.getConnections('acme-logistica').providers;
  assert.deepStrictEqual([c3.aws.name, c3.aws.secretAccessKey, c3.aws._from, c3['aws~hml1']], ['HML', 'S-HML', undefined, undefined]); ok('remover a primeira conta mantém o segredo da que assume o lugar');
  assert.strictEqual((await j('POST', '/api/cloud/test?cliente=acme-logistica', { provider: 'aws~nada' })).data.ok, false); ok('testar conta inexistente responde sem erro 500');
  assert.strictEqual((await j('DELETE', '/api/book' + q)).status, 200);
  assert.strictEqual((await j('GET', '/api/books?cliente=acme-logistica')).data.length, 0); ok('excluir book');
  await j('PUT', '/api/book?cliente=Beta&ano=2026&mes=10&area=Network', { meta: { cliente: 'Beta', area: 'Network' }, groups: [] });
  await j('PUT', '/api/templates', { name: 'Meu modelo', state: { meta: {}, groups: [] } });
  const st0 = (await j('PUT', '/api/settings', { defaults: { template: 'network', extraGroups: [{ title: 'SAP', sections: [{ title: 'Landscape' }] }] } })).data;
  assert.strictEqual(st0.defaults.template, 'network'); assert.strictEqual(st0.defaults.extraGroups[0].title, 'SAP'); ok('configurações globais salvas');
  assert.strictEqual(storage.api.getDefaults().template, 'network'); ok('configurações globais gravadas no SQLite');
  const stInfo = (await j('GET', '/api/settings/storage')).data;
  assert.deepStrictEqual([stInfo.connected, stInfo.counts.books, stInfo.counts.templates], [true, 2, 2]); ok('status do banco (conectado + contagens)');
  assert.strictEqual((await j('POST', '/api/settings/storage', { storage: 'file' })).status, 400); ok('armazenamento "file" não existe mais');

  // Sessões do navegador gravadas no servidor
  await j('PUT', '/api/session?sid=abc123', { book: 'beta/2026/10/network', route: 'cover' });
  assert.strictEqual((await j('GET', '/api/session?sid=abc123')).data.book, 'beta/2026/10/network'); ok('sessão do navegador salva no servidor');

  // ── MongoDB (driver simulado em memória) ────────────────
  const Module = require('module'); const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? require.resolve('./test-support/fake-mongodb') : origResolve.call(this, req, ...a); };
  process.env.MONGO_URL = 'mongodb://unreachable:1';
  const bad = await j('POST', '/api/settings/storage', { storage: 'mongo', migrate: true });
  assert.strictEqual(bad.status, 503); assert.strictEqual(storage.kind(), 'sqlite'); ok('Mongo fora do ar: troca recusada com mensagem clara');
  delete process.env.MONGO_URL;
  assert.strictEqual((await j('PUT', '/api/settings/mongo', { url: 'http://x' })).status, 400); ok('endereço do Mongo inválido → 400');
  assert.strictEqual((await j('POST', '/api/settings/mongo/test', { url: 'mongodb://unreachable:2' })).status, 503); ok('testar conexão: falha informada');
  assert.ok((await j('POST', '/api/settings/mongo/test', { url: 'mongodb://fake:27017', db: 'book_tecnico' })).data.ok); ok('testar conexão: sucesso');
  const mc = (await j('PUT', '/api/settings/mongo', { url: 'mongodb://user:senha@fake:27017', db: 'book_tecnico' })).data;
  assert.strictEqual(mc.url, 'mongodb://***@fake:27017'); ok('conexão do Mongo salva pela tela (senha mascarada)');
  assert.ok(!JSON.stringify((await j('GET', '/api/settings')).data).includes('senha')); ok('senha do Mongo nunca volta ao navegador');
  await j('PUT', '/api/settings/mongo', { url: 'mongodb://***@fake:27017', db: 'book_tecnico' });
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8')).mongo.url, 'mongodb://user:senha@fake:27017'); ok('salvar com URL mascarada preserva a senha');
  const swm = (await j('POST', '/api/settings/storage', { storage: 'mongo', migrate: true })).data;
  assert.deepStrictEqual([swm.storage, swm.migrated.books, swm.migrated.templates, swm.migrated.connections, swm.migrated.sessions], ['mongo', 2, 2, 2, 1]); ok('troca para MongoDB com migração (books, templates, conexões, sessões)');
  assert.strictEqual((await j('GET', '/api/settings')).data.defaults.extraGroups[0].title, 'SAP'); ok('configurações globais no MongoDB');
  const fm = require('./test-support/fake-mongodb')._servers['mongodb://user:senha@fake:27017'].book_tecnico;
  assert.strictEqual(fm.collection('books').docs.size, 2); assert.ok(fm.collection('settings').docs.get('global')); assert.ok(fm.collection('sessions').docs.get('abc123')); ok('dados gravados nas coleções books, settings e sessions');
  await j('PUT', '/api/book?cliente=Beta&ano=2025&mes=12&area=Network', { meta: { cliente: 'Beta', area: 'Network' }, groups: [] });
  assert.strictEqual((await j('GET', '/api/clients')).data.find((c) => c.slug === 'beta').anos.join(), '2026,2025'); ok('books e anos listados do MongoDB');
  assert.strictEqual((await j('GET', '/api/settings/storage')).data.counts.books, 3); ok('status do MongoDB (contagens)');
  const back = (await j('POST', '/api/settings/storage', { storage: 'sqlite', migrate: true })).data;
  assert.deepStrictEqual([back.storage, back.migrated.books], ['sqlite', 3]); assert.strictEqual(storage.api.listBooks({ cliente: 'beta' }).length, 2); ok('volta para SQLite com migração (MongoDB → SQLite)');
  await j('POST', '/api/settings/storage', { storage: 'mongo', migrate: false });
  assert.strictEqual((await j('DELETE', '/api/year?cliente=beta&ano=2026')).data.books, 1);
  assert.strictEqual((await j('GET', '/api/books?cliente=beta')).data.length, 1); ok('excluir ano remove todos os books do ano');
  await j('PUT', '/api/connections?cliente=Beta', { nome: 'Beta', providers: {} });
  assert.strictEqual((await j('DELETE', '/api/client?cliente=beta')).data.books, 1);
  assert.ok(!(await j('GET', '/api/clients')).data.find((c) => c.slug === 'beta')); ok('excluir cliente remove anos, books e conexões');
  Module._resolveFilename = origResolve;

  // ── Login, usuários e bloqueio de edição ────────────────
  await j('POST', '/api/settings/storage', { storage: 'sqlite', migrate: false });
  const call = async (method, p, body, cookie, headers = {}) => {
    const r = await realFetch(base + p, { method, redirect: 'manual', headers: Object.assign({ 'content-type': 'application/json' }, cookie ? { cookie } : {}, headers), body: body && (typeof body === 'string' ? body : JSON.stringify(body)) });
    const txt = await r.text(); let data; try { data = JSON.parse(txt); } catch (e) { data = txt; }
    const set = r.headers.get('set-cookie') || '';
    return { status: r.status, data, cookie: (set.match(/bt_auth=[^;]*/) || [''])[0], setCookie: set, location: r.headers.get('location') };
  };
  let me0 = (await call('GET', '/api/auth/me')).data;
  assert.deepStrictEqual([me0.enabled, me0.needsSetup, me0.user], [false, true, null]); ok('login desligado por padrão; pede configuração inicial');
  // entradas inválidas: erro claro (400/404), nunca erro interno (500)
  for (const [m, p, body] of [['PUT', '/api/connections?cliente=acme', 'null'], ['PUT', '/api/templates', 'null'], ['POST', '/api/auth/login', '[]'], ['PUT', '/api/session?sid=a', '7'],
    ['PUT', '/api/connections?cliente=acme', { providers: { constructor: {}, oci: 'x', aws: null } }], ['POST', '/api/cloud/pull?cliente=acme', { provider: '__proto__', kinds: 'x' }], ['POST', '/api/cloud/test?cliente=acme', { provider: 'constructor' }]]) {
    const st = (await call(m, p, body)).status;
    assert.ok(st < 500, `${m} ${p} → ${st}`);
  }
  ok('entradas inválidas (corpo "null", provedor "__proto__"/"constructor", kinds em texto) dão erro claro, não 500');
  assert.strictEqual((await call('PUT', '/api/auth/config', { enabled: true })).status, 400); ok('não liga o login sem administrador');
  assert.strictEqual((await call('POST', '/api/auth/setup', { username: 'admin', name: 'Ana Admin', password: 'curta' })).status, 400); ok('senha curta recusada');
  const setup = await call('POST', '/api/auth/setup', { username: 'Admin', name: 'Ana Admin', password: 'senha-forte-1' });
  assert.strictEqual(setup.status, 200); assert.ok(/HttpOnly/.test(setup.setCookie) && /SameSite=Lax/.test(setup.setCookie)); ok('primeiro administrador criado (cookie HttpOnly)');
  const ana = setup.cookie;
  assert.strictEqual((await call('POST', '/api/auth/setup', { username: 'x', password: 'outra-senha-1' })).status, 409); ok('configuração inicial só funciona uma vez');
  assert.strictEqual((await call('PUT', '/api/users', { username: 'temp', password: 'senha-forte-9' })).status, 200); ok('com login desligado, usuários são cadastrados pela tela antes de ligar');
  await call('DELETE', '/api/users?id=' + (await call('GET', '/api/users')).data.find((u) => u.username === 'temp').id);
  assert.strictEqual((await call('PUT', '/api/auth/config', { enabled: true, lock: { enabled: true, responseMinutes: 1 } }, ana)).status, 200); ok('login e bloqueio de edição ligados');
  assert.strictEqual((await call('GET', '/api/clients')).status, 401); assert.strictEqual((await call('GET', '/api/health')).status, 200); ok('com login ligado, a API exige sessão (health continua público)');
  const users0 = JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8'));
  assert.ok(users0.auth.enabled); ok('configuração do login em data/settings.json');
  assert.strictEqual((await call('PUT', '/api/users', { username: 'bruno', name: 'Bruno Lima', password: 'senha-bruno-1' }, ana)).status, 200); ok('admin cria usuário');
  const list0 = (await call('GET', '/api/users', null, ana)).data;
  assert.strictEqual(list0.length, 2); assert.ok(!JSON.stringify(list0).includes('hash') && !JSON.stringify(list0).includes('salt')); ok('lista de usuários sem hash/salt');
  assert.strictEqual((await call('POST', '/api/auth/login', { username: 'bruno', password: 'errada' })).status, 401); ok('senha errada → 401');
  for (let i = 0; i < 5; i++) await call('POST', '/api/auth/login', { username: 'fantasma', password: 'x' });
  assert.strictEqual((await call('POST', '/api/auth/login', { username: 'fantasma', password: 'x' })).status, 429); ok('muitas tentativas → 429 (força bruta)');
  const bruno = (await call('POST', '/api/auth/login', { username: 'BRUNO', password: 'senha-bruno-1' })).cookie;
  assert.ok(bruno); ok('login com usuário/senha (sem diferenciar maiúsculas no usuário)');
  assert.strictEqual((await call('GET', '/api/users', null, bruno)).status, 403); assert.strictEqual((await call('POST', '/api/settings/storage', { storage: 'mongo' }, bruno)).status, 403);
  assert.strictEqual((await call('GET', '/api/logs?kind=audit', null, bruno)).status, 403); assert.strictEqual((await call('GET', '/api/trash', null, bruno)).status, 403); ok('usuário comum não acessa áreas de admin (banco, usuários, logs, lixeira)');
  assert.strictEqual((await call('PUT', '/api/settings', { defaults: { comparativo: true } }, bruno)).status, 200); ok('todos os usuários ajustam as opções de book');
  assert.strictEqual((await call('PUT', '/api/users', { id: list0.find((u) => u.username === 'admin').id, role: 'user' }, ana)).status, 400); ok('admin não remove o próprio acesso de admin');

  const BK = 'legado/2025/12/network';
  const bq = '?cliente=legado&ano=2025&mes=12&area=network';
  const stBook = { meta: { cliente: 'Legado SA', area: 'Network' }, groups: [] };
  assert.strictEqual((await call('POST', '/api/lock', { action: 'acquire', book: BK }, ana)).data.acquired, true); ok('Ana abre o book e fica com o bloqueio');
  const seen = (await call('POST', '/api/lock', { action: 'acquire', book: BK }, bruno)).data;
  assert.deepStrictEqual([seen.acquired, seen.owner.name, typeof seen.lastActive], [false, 'Ana Admin', 'number']); ok('Bruno vê que Ana está editando e a última atividade dela');
  assert.strictEqual((await call('PUT', '/api/book' + bq, stBook, bruno)).status, 423); ok('Bruno não consegue salvar o book bloqueado (423)');
  assert.strictEqual((await call('PUT', '/api/book' + bq, stBook, ana)).status, 200); ok('Ana continua salvando');
  assert.strictEqual((await call('GET', '/api/locks', null, bruno)).data[0].owner.name, 'Ana Admin'); ok('lista de books em edição');
  assert.strictEqual((await call('POST', '/api/lock', { action: 'request', book: BK }, bruno)).data.request.status, 'pending'); ok('Bruno pede para editar');
  assert.strictEqual((await call('POST', '/api/lock', { action: 'heartbeat', book: BK, active: true }, ana)).data.request.name, 'Bruno Lima'); ok('Ana recebe o pedido no sinal de vida');
  assert.strictEqual((await call('POST', '/api/lock', { action: 'takeover', book: BK }, bruno)).status, 409); ok('Bruno não pode assumir antes do prazo');
  assert.strictEqual((await call('POST', '/api/lock', { action: 'respond', book: BK, allow: false }, ana)).data.request.status, 'denied'); ok('Ana recusa e continua editando');
  assert.strictEqual((await call('POST', '/api/lock', { action: 'takeover', book: BK }, bruno)).status, 409); ok('pedido recusado: não dá para assumir');
  await call('POST', '/api/lock', { action: 'request', book: BK }, bruno);
  const lk = storage.api.kvGet('locks', BK); lk.request.at -= 2 * 60000; storage.api.kvSet('locks', BK, lk); // simula 2 min sem resposta
  const tk = (await call('POST', '/api/lock', { action: 'takeover', book: BK }, bruno)).data;
  assert.deepStrictEqual([tk.acquired, tk.previous], [true, 'Ana Admin']); ok('sem resposta no prazo, Bruno assume o book');
  assert.strictEqual((await call('GET', '/api/clients', null, ana)).status, 401); ok('Ana (ausente) foi deslogada');
  assert.strictEqual((await call('PUT', '/api/book' + bq, stBook, bruno)).status, 200); ok('Bruno salva o book');
  const ana2 = (await call('POST', '/api/auth/login', { username: 'admin', password: 'senha-forte-1' })).cookie;
  await call('POST', '/api/lock', { action: 'request', book: BK }, ana2);
  assert.strictEqual((await call('POST', '/api/lock', { action: 'respond', book: BK, allow: true }, bruno)).data.released, true);
  assert.strictEqual((await call('GET', '/api/lock?book=' + encodeURIComponent(BK), null, ana2)).data.mine, true); ok('Bruno libera e o book passa para Ana');
  const lastSeen = (await call('GET', '/api/users', null, ana2)).data.find((u) => u.username === 'bruno');
  assert.ok(lastSeen.lastSeen > 0 && lastSeen.sessions >= 1); ok('admin vê a última atividade de cada usuário');
  await call('POST', '/api/auth/logout', null, ana2);
  assert.strictEqual((await call('GET', '/api/lock?book=' + encodeURIComponent(BK), null, bruno)).data.locked, false); ok('sair (logout) libera os books');
  const brunoId = lastSeen.id;
  const ana3 = (await call('POST', '/api/auth/login', { username: 'admin', password: 'senha-forte-1' })).cookie;
  await call('DELETE', '/api/users/sessions?id=' + brunoId, null, ana3);
  assert.strictEqual((await call('GET', '/api/clients', null, bruno)).status, 401); ok('admin encerra as sessões de um usuário');

  // SAML (Microsoft Entra ID simulado)
  const idp = require('./test-support/saml-idp');
  assert.strictEqual((await call('PUT', '/api/auth/config', { saml: { enabled: true } }, ana3)).status, 400); ok('SAML não liga sem URL, Entity ID e certificado');
  const samlCfg = { enabled: true, entryPoint: 'https://login.microsoftonline.com/tenant/saml2', issuer: 'urn:book-tecnico:teste', idpCert: idp.cert, publicUrl: base, allowedDomains: 'empresa.com' };
  assert.strictEqual((await call('PUT', '/api/auth/config', { saml: samlCfg }, ana3)).status, 200); ok('SAML configurado');
  assert.strictEqual((await call('GET', '/api/auth/me')).data.saml.enabled, true); ok('tela de login sabe que há "Entrar com Microsoft"');
  const go = await call('GET', '/api/auth/saml/login');
  assert.strictEqual(go.status, 302); assert.ok(go.location.startsWith('https://login.microsoftonline.com/tenant/saml2?SAMLRequest=')); ok('"Entrar com Microsoft" redireciona para o Entra ID');
  assert.ok(/AssertionConsumerService[^>]+\/api\/auth\/saml\/acs/.test((await call('GET', '/api/auth/saml/metadata')).data)); ok('metadata do app (SP) para o Entra ID');
  const acs = base + '/api/auth/saml/acs';
  const form = (b64) => 'SAMLResponse=' + encodeURIComponent(b64);
  const formH = { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://login.microsoftonline.com' };
  assert.strictEqual((await call('POST', '/api/auth/saml/acs', form(idp.response({ acs, audience: 'urn:book-tecnico:teste', email: 'carla@empresa.com', name: 'Carla Souza', tamper: true })), null, formH)).status, 401); ok('resposta SAML adulterada é recusada');
  assert.strictEqual((await call('POST', '/api/auth/saml/acs', form(idp.response({ acs, audience: 'outro-app', email: 'carla@empresa.com', name: 'Carla Souza' })), null, formH)).status, 401); ok('resposta SAML para outro app (audience) é recusada');
  assert.strictEqual((await call('POST', '/api/auth/saml/acs', form(idp.response({ acs, audience: 'urn:book-tecnico:teste', email: 'eve@outra.com', name: 'Eve' })), null, formH)).status, 401); ok('domínio fora da lista é recusado');
  const sso = await call('POST', '/api/auth/saml/acs', form(idp.response({ acs, audience: 'urn:book-tecnico:teste', email: 'carla@empresa.com', name: 'Carla Souza' })), null, formH);
  assert.deepStrictEqual([sso.status, sso.location, !!sso.cookie], [302, '/', true]); ok('login Microsoft válido abre a sessão (vinda do site da Microsoft)');
  const carla = (await call('GET', '/api/auth/me', null, sso.cookie)).data.user;
  assert.deepStrictEqual([carla.name, carla.provider, carla.role], ['Carla Souza', 'saml', 'user']); ok('usuário criado automaticamente pelo SAML (papel padrão: usuário)');
  assert.strictEqual((await call('POST', '/api/auth/login', { username: 'carla@empresa.com', password: 'qualquer-coisa' })).status, 401); ok('usuário SAML não entra com senha local');
  // ── Grupos do Entra ID → papel ──────────────────────────
  const G_ADM = 'aaaaaaaa-0000-0000-0000-000000000001', G_USR = 'bbbbbbbb-0000-0000-0000-000000000002';
  assert.strictEqual((await call('PUT', '/api/auth/config', { groups: { enabled: true, adminGroups: 'nao-e-guid' } }, ana3)).status, 400); ok('ID de grupo inválido é recusado');
  assert.strictEqual((await call('PUT', '/api/auth/config', { groups: { enabled: true, adminGroups: G_ADM, userGroups: G_USR, denyOthers: true } }, ana3)).status, 200); ok('grupos do Entra ID configurados');
  const samlAs = (email, name, groups) => call('POST', '/api/auth/saml/acs', form(idp.response({ acs, audience: 'urn:book-tecnico:teste', email, name, groups })), null, formH);
  const dani = await samlAs('dani@empresa.com', 'Dani Rocha', [G_ADM]);
  assert.strictEqual((await call('GET', '/api/auth/me', null, dani.cookie)).data.user.role, 'admin'); ok('grupo de administradores do Entra → admin');
  assert.strictEqual((await samlAs('carla@empresa.com', 'Carla Souza', [G_USR])).status, 302); ok('grupo de usuários do Entra → usuário');
  assert.strictEqual((await samlAs('edu@empresa.com', 'Edu', ['cccccccc-0000-0000-0000-000000000003'])).status, 401); ok('fora dos grupos autorizados: acesso negado');
  await samlAs('dani@empresa.com', 'Dani Rocha', [G_USR]);
  assert.strictEqual((await call('GET', '/api/users', null, ana3)).data.find((u) => u.username === 'dani@empresa.com').role, 'user'); ok('papel recalculado a cada login (saiu do grupo de admins)');

  // Microsoft Graph (simulado): sincronização periódica
  const graphMembers = {
    [G_ADM]: [{ id: 'o1', displayName: 'Fabi Lima', mail: 'fabi@empresa.com', accountEnabled: true }],
    [G_USR]: [{ id: 'o2', displayName: 'Carla Souza', mail: 'carla@empresa.com', accountEnabled: true }, { id: 'o3', displayName: 'Gil Neto', userPrincipalName: 'gil@empresa.com', accountEnabled: true }]
  };
  global.fetch = async (url, opts) => {
    url = String(url);
    if (url.startsWith(base)) return realFetch(url, opts);
    if (url.includes('login.microsoftonline.com') && url.endsWith('/token')) return new Response(JSON.stringify(String(opts.body).includes('client_secret=segredo') ? { access_token: 'tk' } : { error: 'invalid_client', error_description: 'segredo errado' }), { status: String(opts.body).includes('client_secret=segredo') ? 200 : 401 });
    const m = url.match(/groups\/([^/?]+)(\/transitiveMembers)?/);
    if (m && m[2]) return new Response(JSON.stringify({ value: graphMembers[m[1]] || [] }));
    if (m) return new Response(JSON.stringify({ id: m[1], displayName: m[1] === G_ADM ? 'BookTecnico-Admins' : 'BookTecnico-Usuarios' }));
    return new Response('{}', { status: 404 });
  };
  assert.strictEqual((await call('POST', '/api/auth/graph/test', { graph: { tenantId: 't', clientId: 'c', clientSecret: 'errado' } }, ana3)).status, 502); ok('Graph: credencial errada informada');
  const gt = (await call('POST', '/api/auth/graph/test', { graph: { tenantId: 't', clientId: 'c', clientSecret: 'segredo' } }, ana3)).data;
  assert.deepStrictEqual(gt.groups.map((x) => x.name), ['BookTecnico-Admins', 'BookTecnico-Usuarios']); ok('Graph: teste mostra o nome dos grupos');
  assert.strictEqual((await call('GET', '/api/auth/config', null, ana3)).data.graph.clientSecret, '••••••••'); ok('client secret do Graph mascarado');
  await call('PUT', '/api/auth/config', { graph: { enabled: true, intervalHours: 6 } }, ana3);
  const sy = (await call('POST', '/api/auth/graph/sync', null, ana3)).data;
  assert.deepStrictEqual([sy.created, sy.disabled], [2, 1]); ok('Graph: cria quem está nos grupos e desativa quem saiu (Dani)');
  const after = (await call('GET', '/api/users', null, ana3)).data;
  assert.deepStrictEqual([after.find((u) => u.username === 'fabi@empresa.com').role, after.find((u) => u.username === 'dani@empresa.com').disabled, after.find((u) => u.username === 'admin').disabled], ['admin', true, false]); ok('Graph: papéis certos; usuários com senha local não são alterados');
  graphMembers[G_ADM] = []; graphMembers[G_USR] = [];
  assert.strictEqual((await call('POST', '/api/auth/graph/sync', null, ana3)).status, 502); assert.ok(!(await call('GET', '/api/users', null, ana3)).data.find((u) => u.username === 'carla@empresa.com').disabled); ok('Graph: grupos vazios (erro de config) não desativam ninguém');
  global.fetch = realFetch;
  await call('PUT', '/api/auth/config', { groups: { enabled: false }, graph: { enabled: false } }, ana3);

  // ── Lixeira, GUIDs e auditoria ──────────────────────────
  await call('PUT', '/api/book?cliente=Omega&ano=2026&mes=01&area=Network', { meta: { cliente: 'Omega', area: 'Network' }, groups: [] }, ana3);
  await call('PUT', '/api/book?cliente=Omega&ano=2026&mes=02&area=Network', { meta: { cliente: 'Omega', area: 'Network' }, groups: [] }, ana3);
  await call('PUT', '/api/book?cliente=Omega&ano=2025&mes=12&area=Backup', { meta: { cliente: 'Omega', area: 'Backup' }, groups: [] }, ana3);
  const omega = (await call('GET', '/api/clients', null, ana3)).data.find((c) => c.slug === 'omega');
  assert.ok(/^[0-9a-f-]{36}$/.test(omega.guid) && /^[0-9a-f-]{36}$/.test(omega.yearGuids['2026'])); ok('cliente e ano têm GUID');
  const b1 = (await call('GET', '/api/books?cliente=omega&ano=2026', null, ana3)).data.find((b) => b.mes === '01');
  assert.ok(/^[0-9a-f-]{36}$/.test(b1.guid)); ok('book tem GUID');
  assert.strictEqual((await call('DELETE', '/api/book?cliente=omega&ano=2026&mes=01&area=network', null, ana3)).status, 200);
  assert.strictEqual((await call('GET', '/api/books?cliente=omega&ano=2026', null, ana3)).data.length, 1); ok('excluir book tira da lista');
  let tr = (await call('GET', '/api/trash', null, ana3)).data;
  assert.deepStrictEqual([tr.days, tr.items[0].type, tr.items[0].deletedBy.name, tr.items[0].guid], [30, 'book', 'Ana Admin', b1.guid]); ok('lixeira: book com GUID, quem excluiu e prazo de 30 dias');
  await call('PUT', '/api/book?cliente=Omega&ano=2026&mes=01&area=Network', { meta: { cliente: 'Omega', area: 'Network' }, groups: [] }, ana3);
  const nb = (await call('GET', '/api/books?cliente=omega&ano=2026', null, ana3)).data.find((b) => b.mes === '01');
  assert.notStrictEqual(nb.guid, b1.guid); ok('recriar com o mesmo nome gera GUID novo');
  tr = (await call('GET', '/api/trash', null, ana3)).data;
  assert.strictEqual(tr.items[0].activeExists, true); ok('lixeira avisa que existe um ativo com o mesmo nome');
  const tid1 = tr.items[0].tid;
  const conflict = await call('POST', '/api/trash/restore', { tid: tid1 }, ana3);
  assert.deepStrictEqual([conflict.status, conflict.data.conflicts], [409, ['omega/2026/01/network']]); ok('restaurar com conflito pergunta (409)');
  const cp = (await call('POST', '/api/trash/restore', { tid: tid1, mode: 'copy' }, ana3)).data;
  assert.strictEqual(cp.restored, 1);
  const books26 = (await call('GET', '/api/books?cliente=omega&ano=2026', null, ana3)).data;
  assert.ok(books26.some((b) => b.area === 'Network (restaurado)') && books26.length === 3); ok('restaurar como cópia: "Network (restaurado)" ao lado do atual');
  assert.ok(books26.every((b, i, a) => a.findIndex((x) => x.guid === b.guid) === i)); ok('cópia restaurada tem GUID próprio');
  await call('DELETE', '/api/book?cliente=omega&ano=2026&mes=01&area=network', null, ana3);
  await call('PUT', '/api/book?cliente=Omega&ano=2026&mes=01&area=Network', { meta: { cliente: 'Omega', area: 'Network', v: 2 }, groups: [] }, ana3);
  const tid2 = (await call('GET', '/api/trash', null, ana3)).data.items[0].tid;
  await call('POST', '/api/trash/restore', { tid: tid2, mode: 'replace' }, ana3);
  tr = (await call('GET', '/api/trash', null, ana3)).data;
  assert.ok(tr.items[0].reason && tr.items[0].reason.includes('Substituído')); ok('substituir: o atual vai para a lixeira');
  const brunoC = (await call('POST', '/api/auth/login', { username: 'bruno', password: 'senha-bruno-1' })).cookie;
  const busy = await call('DELETE', '/api/year?cliente=omega&ano=2026', null, brunoC);
  assert.deepStrictEqual([busy.status, /Ana Admin está editando/.test(busy.data.error)], [423, true]); ok('não exclui ano com book aberto por outra pessoa (o salvamento dela recriaria o book)');
  for (const l of (await call('GET', '/api/locks', null, ana3)).data) await call('POST', '/api/lock', { action: 'release', book: l.book }, ana3);
  const y = await call('DELETE', '/api/year?cliente=omega&ano=2026', null, brunoC);
  assert.strictEqual(y.status, 200);
  tr = (await call('GET', '/api/trash', null, ana3)).data;
  assert.deepStrictEqual([tr.items[0].type, tr.items[0].books.length, tr.items[0].deletedBy.name, tr.items[0].guid], ['year', 3, 'Bruno Lima', omega.yearGuids['2026']]); ok('excluir ano: vai inteiro para a lixeira com o GUID do ano e quem excluiu');
  await call('DELETE', '/api/client?cliente=omega', null, ana3);
  tr = (await call('GET', '/api/trash', null, ana3)).data;
  assert.deepStrictEqual([tr.items[0].type, tr.items[0].guid], ['client', omega.guid]); ok('excluir cliente: vai para a lixeira com o GUID do cliente');
  await call('PUT', '/api/book?cliente=Omega&ano=2027&mes=01&area=Network', { meta: { cliente: 'Omega', area: 'Network' }, groups: [] }, ana3);
  assert.notStrictEqual((await call('GET', '/api/clients', null, ana3)).data.find((c) => c.slug === 'omega').guid, omega.guid); ok('cliente recriado tem GUID novo (o antigo continua na lixeira)');
  const cTid = tr.items[0].tid;
  await call('POST', '/api/trash/restore', { tid: cTid, mode: 'copy' }, ana3);
  assert.ok((await call('GET', '/api/clients', null, ana3)).data.some((c) => c.nome === 'Omega (restaurado)')); ok('cliente restaurado como cópia: "Omega (restaurado)"');
  const yTid = (await call('GET', '/api/trash', null, ana3)).data.items.find((i) => i.type === 'year').tid;
  assert.strictEqual((await call('DELETE', '/api/trash?tid=' + yTid, null, ana3)).status, 200);
  assert.ok(!(await call('GET', '/api/trash', null, ana3)).data.items.some((i) => i.tid === yTid)); ok('excluir definitivamente');
  const old = storage.api.kvList('trash')[0]; old.expiresAt = Date.now() - 1; storage.api.kvSet('trash', old._id, old);
  assert.strictEqual(await require('../server/trash').purgeExpired(), 1); ok('itens com mais de 30 dias são apagados sozinhos');

  // ── Logs ────────────────────────────────────────────────
  await require('../server/logs').flush();
  const http = (await call('GET', '/api/logs?kind=http&q=trash', null, ana3)).data;
  assert.ok(http.length && http[0].status && http[0].user === 'Ana Admin'); ok('log de requisições HTTP (status, tempo, usuário)');
  const dblog = (await call('GET', '/api/logs?kind=db&q=saveBook', null, ana3)).data;
  assert.ok(dblog.length && dblog[0].backend === 'sqlite' && typeof dblog[0].ms === 'number'); ok('log de gravações no banco (operação, banco, tempo)');
  const audit = (await call('GET', '/api/logs?kind=audit', null, ana3)).data.map((e) => e.action);
  assert.ok(['login', 'login.fail', 'trash.book', 'trash.year', 'trash.client', 'trash.restore', 'trash.purge', 'trash.expire', 'user.create', 'config.auth'].every((a) => audit.includes(a))); ok('auditoria: logins, usuários, exclusões, lixeira e configurações');
  assert.ok((await call('GET', '/api/logs?kind=app', null, ana3)).data.some((e) => /Entra ID/.test(e.msg))); ok('log de demais informações (ex.: sincronização do Entra)');
  assert.ok(!JSON.stringify((await call('GET', '/api/logs?kind=http&q=session', null, ana3)).data).includes('sid=abc')); ok('segredos não aparecem nos logs');

  // ── Backup / restauração / excluir banco ────────────────
  assert.strictEqual((await call('PUT', '/api/backup/config', { password: 'senha-do-backup', keep: 2, network: { enabled: true, path: path.join(DATA, 'rede') } }, ana3)).status, 200);
  assert.strictEqual((await call('GET', '/api/backup/config', null, ana3)).data.password, '••••••••'); ok('senha do backup mascarada');
  const t1 = (await call('POST', '/api/backup/test', { dest: 'network' }, ana3)).data;
  assert.ok(t1.ok); ok('testar destino (caminho de rede)');
  for (let i = 0; i < 3; i++) { const r = (await call('POST', '/api/backup/run', null, ana3)).data; assert.ok(r.ok && r.encrypted); await new Promise((r2) => setTimeout(r2, 1100)); }
  const files = fs.readdirSync(path.join(DATA, 'rede'));
  assert.strictEqual(files.length, 2); assert.ok(files.every((f) => f.endsWith('.btbk'))); ok('backup criptografado na pasta local e no caminho de rede, guardando só os últimos N');
  const bk = fs.readFileSync(path.join(DATA, 'rede', files[1]));
  assert.ok(!bk.includes('Omega')); ok('arquivo de backup não é legível sem a senha');
  const restoreReq = (pw) => realFetch(base + '/api/backup/restore', { method: 'POST', headers: { cookie: ana3, 'content-type': 'application/octet-stream', 'x-backup-password': pw }, body: bk });
  assert.strictEqual((await restoreReq('errada')).status, 400); ok('restaurar com senha errada é recusado');
  await call('PUT', '/api/book?cliente=Zeta&ano=2026&mes=01&area=Network', { meta: { cliente: 'Zeta', area: 'Network' }, groups: [] }, ana3);
  const rs = await (await restoreReq('senha-do-backup')).json();
  assert.ok(rs.ok && rs.books > 0 && fs.existsSync(rs.safety)); ok('restaurar pelo painel (com backup de segurança antes)');
  const ana4 = (await call('POST', '/api/auth/login', { username: 'admin', password: 'senha-forte-1' })).cookie;
  const cl = (await call('GET', '/api/clients', null, ana4)).data.map((c) => c.slug);
  assert.ok(cl.includes('omega') && !cl.includes('zeta')); ok('restauração volta o banco ao estado do backup (usuários incluídos)');
  assert.ok((await call('GET', '/api/trash', null, ana4)).data.items.length > 0); ok('a lixeira também vem no backup');
  // excluir um banco (o MongoDB simulado, que não está em uso)
  Module._resolveFilename = function (req2, ...a) { return req2 === 'mongodb' ? require.resolve('./test-support/fake-mongodb') : origResolve.call(this, req2, ...a); };
  assert.strictEqual((await call('POST', '/api/settings/storage/delete', { storage: 'mongo', confirm: 'errado' }, ana4)).status, 400); ok('excluir banco exige digitar o nome');
  const del = (await call('POST', '/api/settings/storage/delete', { storage: 'mongo', confirm: 'MONGODB' }, ana4)).data;
  assert.ok(del.ok && !del.active && fs.existsSync(del.safety)); ok('excluir MongoDB (backup de segurança antes)');
  Module._resolveFilename = origResolve;
  assert.ok((await call('GET', '/api/logs?kind=audit&q=db.delete', null, ana4)).data.length); ok('exclusão de banco na auditoria');
  const ana3b = ana4;

  // preferências do usuário (tema)
  assert.strictEqual((await call('PUT', '/api/auth/prefs', { theme: 'light' }, ana3b)).data.prefs.theme, 'light');
  assert.strictEqual((await call('GET', '/api/auth/me', null, ana3b)).data.user.prefs.theme, 'light'); ok('tema salvo nas preferências do usuário');
  await call('PUT', '/api/auth/config', { enabled: false, lock: { enabled: false } }, ana3b);
  const sqlDel = (await call('POST', '/api/settings/storage/delete', { storage: 'sqlite', confirm: 'SQLITE' })).data;
  assert.ok(sqlDel.active && (await call('GET', '/api/clients')).data.length === 0); ok('excluir o banco em uso (SQLite) zera os dados');
  await call('PUT', '/api/auth/config', { enabled: false, lock: { enabled: false } }, ana3);
  assert.strictEqual((await call('GET', '/api/clients')).status, 200); ok('login desligado: app volta a abrir sem senha');
  server.close();
  await storage.close();

  // ── Conectores (fetch simulado) ─────────────────────────
  const mock = (handler) => { global.fetch = async (url, opts = {}) => { const r = handler(String(url), opts); return new Response(typeof r === 'string' ? r : JSON.stringify(r), { status: 200, headers: r && r.__headers || {} }); }; };

  // AWS
  mock((url, o) => {
    assert.ok(/AWS4-HMAC-SHA256 Credential=AK\//.test(o.headers.Authorization));
    const body = String(o.body || '');
    if (body.includes('DescribeInstances')) return `<DescribeInstancesResponse><reservationSet><item><instancesSet><item><instanceId>i-1</instanceId><privateIpAddress>10.0.0.5</privateIpAddress><platformDetails>Windows</platformDetails><instanceState><name>running</name></instanceState><placement><availabilityZone>sa-east-1a</availabilityZone></placement><vpcId>vpc-1</vpcId><instanceType>t3.large</instanceType><tagSet><item><key>Name</key><value>srv-web01</value></item></tagSet></item></instancesSet></item></reservationSet></DescribeInstancesResponse>`;
    if (body.includes('DescribeVpcs')) return `<DescribeVpcsResponse><vpcSet><item><vpcId>vpc-1</vpcId><cidrBlock>10.0.0.0/16</cidrBlock><ownerId>123</ownerId></item></vpcSet></DescribeVpcsResponse>`;
    if (body.includes('DescribeSubnets')) return `<DescribeSubnetsResponse><subnetSet><item><subnetId>sub-1</subnetId><vpcId>vpc-1</vpcId><cidrBlock>10.0.1.0/24</cidrBlock></item></subnetSet></DescribeSubnetsResponse>`;
    return '<x/>';
  });
  const aws = require('../server/cloud/aws');
  const [srv] = await aws.pull({ accessKeyId: 'AK', secretAccessKey: 'S', regions: 'sa-east-1' }, 'servers');
  assert.deepStrictEqual([srv.rows[0].Name, srv.rows[0]['Private IP Address'], srv.rows[0]['Instance State']], ['srv-web01', '10.0.0.5', 'running']); ok('AWS servidores (XML EC2)');
  const [net] = await aws.pull({ accessKeyId: 'AK', secretAccessKey: 'S', regions: 'sa-east-1' }, 'network');
  assert.strictEqual(net.rows[0].Subnets, 'sub-1 (10.0.1.0/24)'); ok('AWS VPCs + subnets');

  // OCI (verifica a assinatura com a chave pública)
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  mock((url, o) => {
    const u = new URL(url);
    const m = o.headers.authorization.match(/headers="([^"]+)",signature="([^"]+)"/);
    const signing = m[1].split(' ').map((n) => (n === '(request-target)' ? `(request-target): ${(o.method || 'GET').toLowerCase()} ${u.pathname}${u.search}` : `${n}: ${o.headers[n]}`)).join('\n');
    assert.ok(crypto.verify('sha256', Buffer.from(signing), publicKey, Buffer.from(m[2], 'base64')), 'assinatura OCI inválida');
    if (u.pathname.endsWith('/compartments')) return [{ id: 'c1', name: 'prod', compartmentId: 'ten' }];
    if (u.pathname.endsWith('/instances')) return u.search.includes('c1') ? [{ id: 'i1', displayName: 'srv-db01', lifecycleState: 'RUNNING', shape: 'VM.Standard.E4.Flex', shapeConfig: { ocpus: 2, memoryInGBs: 32 }, imageId: 'img1', availabilityDomain: 'AD-1' }] : [];
    if (u.pathname.endsWith('/vnicAttachments')) return [{ vnicId: 'v1', lifecycleState: 'ATTACHED' }];
    if (u.pathname.includes('/vnics/')) return { privateIp: '10.0.1.10' };
    if (u.pathname.includes('/images/')) return { displayName: 'Oracle-Linux-8.7-2023.09.26-0' };
    if (u.host.startsWith('query.')) return { items: [{ resourceType: 'Instance', displayName: 'srv-db01', compartmentId: 'c1' }, { resourceType: 'Vcn', displayName: 'vcn-prod', compartmentId: 'c1' }] };
    return [];
  });
  const oci = require('../server/cloud/oci');
  const ocfg = { tenancy: 'ten', user: 'usr', fingerprint: 'aa:bb', region: 'sa-saopaulo-1', keyPem: pem };
  const [oi] = await oci.pull(ocfg, 'servers');
  assert.deepStrictEqual([oi.rows[0]['Display Name'], oi.rows[0]['Private IP'], oi.rows[0].compartment_path, oi.rows[0].Image], ['srv-db01', '10.0.1.10', 'prod', 'Oracle-Linux-8.7-2023.09.26-0']); ok('OCI instâncias + IP + compartimento (assinatura verificada)');
  const [ob] = await oci.pull(ocfg, 'baseline');
  assert.strictEqual(ob.rows.length, 2); ok('OCI baseline (Resource Search, POST assinado)');
  // OCI Cloud Guard: recomendações vieram, pontuação não → aviso na sincronização (não some em silêncio)
  const cgCalls = [];
  const cgMock = (score) => mock((url, o) => {
    const u = new URL(url); cgCalls.push((o.method || 'GET') + ' ' + u.pathname);
    if (u.pathname.endsWith('/compartments')) return [{ id: 'c1', name: 'prod', compartmentId: 'ten' }];
    if (u.pathname.endsWith('/regionSubscriptions')) return [{ regionName: 'sa-saopaulo-1', status: 'READY' }, { regionName: 'us-ashburn-1', status: 'READY' }];
    if (u.pathname.endsWith('/securityScores')) { assert.strictEqual(o.method, 'POST'); assert.strictEqual(o.headers['content-length'], '0'); return { items: score ? [{ securityScore: score, securityRating: 'GOOD', dimensionsMap: {} }] : [] }; }
    if (u.pathname.endsWith('/riskScores')) return { items: [{ riskScore: 30, dimensionsMap: {} }] };
    if (u.pathname.endsWith('/summarizeTrend')) return { items: [{ startTimestamp: Date.UTC(2026, 9, 31) / 1000, durationInSeconds: 86400, securityScore: 70, securityRating: 'FAIR' }, { startTimestamp: Date.UTC(2026, 10, 24) / 1000, durationInSeconds: 86400, securityScore: score || 0, securityRating: 'GOOD' }, { startTimestamp: Date.UTC(2026, 9, 2) / 1000, durationInSeconds: 86400, securityScore: 65, securityRating: 'FAIR' }] };
    if (u.pathname.endsWith('/recommendations')) return { items: [{ name: 'Resolve "User does not have MFA enabled"', riskLevel: 'CRITICAL', problemCount: 2, compartmentId: 'ten' }] };
    if (u.pathname.endsWith('/problems')) return { items: [] };
    if (u.host.startsWith('objectstorage.')) { if (u.pathname === '/n/') return '"nsx"'; if (u.pathname.endsWith('/b')) return u.search.includes('c1') ? [{ name: 'bkt-relatorios', timeCreated: '2026-01-01T00:00:00Z' }] : []; if (u.pathname.endsWith('/b/bkt-relatorios')) return { name: 'bkt-relatorios', approximateSize: 123456789012, approximateCount: 10 }; }
    if (u.pathname.endsWith('/volumeBackupPolicies')) return u.search.includes('c1') ? [{ displayName: 'politica-diaria', schedules: [{ period: 'ONE_DAY', hourOfDay: 2, backupType: 'INCREMENTAL', retentionSeconds: 604800 }, { period: 'ONE_WEEK', backupType: 'FULL', retentionSeconds: 2592000 }] }] : [];
    if (u.pathname.endsWith('/bootVolumeBackups')) return u.search.includes('c1') ? [{ displayName: 'srv-db01 boot', lifecycleState: 'AVAILABLE', type: 'INCREMENTAL', sourceType: 'SCHEDULED', timeCreated: '2026-11-10T03:00:00Z', expirationTime: '2026-12-10T03:00:00Z' }, { displayName: 'antigo', lifecycleState: 'AVAILABLE', type: 'FULL', sourceType: 'MANUAL', timeCreated: '2026-09-01T03:00:00Z' }] : [];
    if (u.pathname.endsWith('/volumeBackups')) return u.search.includes('c1') ? [{ displayName: 'vol-dados', lifecycleState: 'FAULTY', type: 'FULL', sourceType: 'MANUAL', timeCreated: '2026-11-20T03:00:00Z' }] : [];
    if (u.pathname.endsWith('/instances')) return u.search.includes('c1') ? [{ id: 'i1', displayName: 'nova', lifecycleState: 'RUNNING', timeCreated: '2026-11-05T10:00:00Z' }, { id: 'i2', displayName: 'antiga', lifecycleState: 'RUNNING', timeCreated: '2025-01-05T10:00:00Z' }] : [];
    return [];
  });
  cgMock(0);
  const cg = await require('../server/cloud').pull('oci', ocfg, ['score']);
  assert.deepStrictEqual([cg.results.map((r) => r.kind), cg.errors.length, /Pontuação do Cloud Guard não veio/.test(cg.errors[0].message)], [['score_recs', 'score_alerts'], 1, true]); ok('OCI: sem pontuação do Cloud Guard → recomendações entram e a tela avisa o motivo');
  cgMock(87); cgCalls.length = 0;
  const cg2 = await require('../server/cloud').pull('oci', ocfg, ['score']);
  assert.deepStrictEqual([cg2.errors.length, cg2.results[0].rows[0]['Pontuação'], cg2.results[0].rows[0]['Classificação']], [0, '87', 'Boa · risk score 30']); ok('OCI: pontuação do Cloud Guard (POST /securityScores, API 20200131) com o risk score');
  assert.ok(cgCalls.includes('POST /20200131/securityScores') && !cgCalls.some((c) => /securityScoreAggregations/.test(c))); ok('OCI: usa o endereço certo da pontuação (não o antigo securityScoreAggregations)');
  assert.ok(!cgCalls.some((c) => /summarizeTrend/.test(c)) && !cg2.results.some((r) => r.kind === 'score_trend')); ok('Cloud Guard: só a pontuação atual (sem histórico/comparativo mensal)');
  // Cloud Guard fora da região da conexão: acha a região de relatório pela configuração (home region)
  const cgHosts = [];
  const cgFetch = (enabled) => { global.fetch = async (url, o = {}) => {
    const u = new URL(String(url)); const J = (b, st = 200) => new Response(JSON.stringify(b), { status: st });
    if (u.host.startsWith('cloudguard-cp-api.')) cgHosts.push(u.host.split('.')[1] + ' ' + u.pathname.split('/').pop());
    if (u.pathname.endsWith('/regionSubscriptions')) return J([{ regionName: 'sa-saopaulo-1', status: 'READY' }, { regionName: 'us-ashburn-1', status: 'READY', isHomeRegion: true }]);
    if (u.pathname.endsWith('/compartments')) return J([]);
    if (u.host.startsWith('cloudguard-cp-api.sa-saopaulo-1') || !enabled) return J({ code: 404, message: 'Authorization failed or requested resource not found' }, 404);
    if (u.pathname.endsWith('/configuration')) return J({ reportingRegion: 'us-ashburn-1', status: 'ENABLED' });
    if (u.pathname.endsWith('/securityScores')) return J({ items: [{ securityScore: 91, securityRating: 'EXCELLENT' }] });
    return J({ items: [] });
  }; };
  cgFetch(true);
  const cg3 = await require('../server/cloud').pull('oci', ocfg, ['score']);
  assert.deepStrictEqual([cg3.errors.length, cg3.results[0].rows[0]['Pontuação'], cgHosts.filter((h) => /securityScores/.test(h))], [0, '91', ['us-ashburn-1 securityScores']]); ok('Cloud Guard: usa a região de relatório (home region) quando a da conexão devolve 404');
  cgFetch(false);
  const cg4 = await require('../server/cloud').pull('oci', ocfg, ['score']);
  assert.ok(/read cloud-guard-family in tenancy/.test(cg4.errors[0].message) && /sa-saopaulo-1 e us-ashburn-1/.test(cg4.errors[0].message)); ok('Cloud Guard: sem acesso, a mensagem diz as regiões tentadas e a política que falta');
  cgMock(87); // volta o mock da OCI para os testes seguintes
  // backup só do período, em todas as regiões assinadas (campo Regiões vazio)
  const ociBk = await require('../server/cloud').pull('oci', Object.assign({}, ocfg, { regions: '' }), ['backup'], { from: '2026-11-01', to: '2026-11-30' });
  const bkRows = ociBk.results[0].rows.filter((r) => r['Situação'] !== 'Política ativa');
  assert.deepStrictEqual([bkRows.length, bkRows.map((r) => r.Item).sort(), bkRows.find((r) => r.Item === 'vol-dados')['Situação'], bkRows.find((r) => r.Item === 'srv-db01 boot')['Retenção'], [...new Set(bkRows.map((r) => r['Região']))].sort()],
    [4, ['srv-db01 boot', 'srv-db01 boot', 'vol-dados', 'vol-dados'], 'Falha', '30 dias', ['sa-saopaulo-1', 'us-ashburn-1']]); ok('OCI: backup só do mês (boot + block volume), situação e retenção, em todas as regiões assinadas');
  const pol = ociBk.results[0].rows.find((r) => r.Item === 'politica-diaria');
  assert.deepStrictEqual([pol['Situação'], pol['Frequência'], pol['Retenção'], pol.Compartimento, 'compartment_path' in pol, 'Teste Restore' in pol], ['Política ativa', 'Diário 02h (incremental); Semanal (completo)', '7 dias / 30 dias', 'prod', false, false]); ok('OCI: políticas de backup com agenda e retenção; sem colunas técnicas nem "Teste Restore" vazio');
  const onlyJobs = (await require('../server/cloud').pull('oci', ocfg, ['backup'], { from: '2026-11-01', to: '2026-11-30', backupMode: 'jobs' })).results[0].rows;
  const onlyPol = (await require('../server/cloud').pull('oci', ocfg, ['backup'], { from: '2026-11-01', to: '2026-11-30', backupMode: 'policies' })).results[0].rows;
  assert.deepStrictEqual([onlyJobs.some((r) => r['Situação'] === 'Política ativa'), onlyJobs.length > 0, onlyPol.every((r) => r['Situação'] === 'Política ativa'), onlyPol.length], [false, true, true, 2]); // 1 política × 2 regiões assinadas ok('backup: "só os feitos", "só as políticas" ou os dois');
  // servidores: só os criados no mês
  const ocfg1 = Object.assign({}, ocfg, { regions: 'sa-saopaulo-1' });
  const nw = await require('../server/cloud').pull('oci', ocfg1, ['servers'], { from: '2026-11-01', to: '2026-11-30', newOnly: true });
  const allSrv = await require('../server/cloud').pull('oci', ocfg1, ['servers'], { from: '2026-11-01', to: '2026-11-30' });
  assert.deepStrictEqual([nw.results[0].rows.map((r) => r['Display Name']), allSrv.results[0].rows.length], [['nova'], 2]); ok('recursos: "só os criados no mês" filtra pela data de criação; "todos" traz tudo');
  const stg = (await require('../server/cloud').pull('oci', ocfg1, ['storage'], {})).results[0].rows.find((r) => r['Display Name'] === 'bkt-relatorios');
  assert.deepStrictEqual([stg['Volume Type'], stg['Size in GBs']], ['Object Storage', '123,5 GB']); ok('OCI: tamanho aproximado dos buckets do Object Storage (em vez de "—")');

  // Azure
  mock((url, o) => {
    if (url.includes('login.microsoftonline.com')) return { access_token: 'TK', expires_in: 3600 };
    assert.strictEqual(o.headers.authorization, 'Bearer TK');
    if (url.includes('statusOnly')) return { value: [{ id: '/subscriptions/s1/resourceGroups/RG-PROD/providers/Microsoft.Compute/virtualMachines/vm1', properties: { instanceView: { statuses: [{ code: 'PowerState/running', displayStatus: 'VM running' }] } } }] };
    if (url.includes('virtualMachines')) return { value: [{ id: '/subscriptions/s1/resourceGroups/RG-PROD/providers/Microsoft.Compute/virtualMachines/vm1', name: 'vm1', location: 'brazilsouth', properties: { hardwareProfile: { vmSize: 'Standard_D2s_v3' }, storageProfile: { osDisk: { osType: 'Windows' }, imageReference: { offer: 'WindowsServer', sku: '2019-Datacenter' } } } }] };
    if (url.includes('networkInterfaces')) return { value: [{ properties: { virtualMachine: { id: '/subscriptions/s1/resourceGroups/RG-PROD/providers/Microsoft.Compute/virtualMachines/vm1' }, ipConfigurations: [{ properties: { privateIPAddress: '172.16.0.4' } }] } }] };
    return { value: [] };
  });
  const az = require('../server/cloud/azure');
  const [av] = await az.pull({ tenantId: 't', clientId: 'c', clientSecret: 's', subscriptionIds: 's1' }, 'servers');
  assert.deepStrictEqual([av.rows[0].Name, av.rows[0]['Private IP Address'], av.rows[0]['Power State'], av.rows[0]['Resource Group']], ['vm1', '172.16.0.4', 'VM running', 'RG-PROD']); ok('Azure VMs + IP + power state');

  // GCP
  const sa = { client_email: 'bot@p.iam.gserviceaccount.com', private_key: pem, project_id: 'proj-1' };
  mock((url, o) => {
    if (url.includes('oauth2')) { assert.ok(String(o.body).includes('jwt-bearer')); return { access_token: 'G', expires_in: 3600 }; }
    if (url.includes('aggregated/instances')) return { items: { 'zones/southamerica-east1-a': { instances: [{ name: 'gce-app01', status: 'RUNNING', zone: '.../zones/southamerica-east1-a', machineType: '.../e2-medium', networkInterfaces: [{ networkIP: '10.10.0.2' }], disks: [{ licenses: ['.../debian-12-bookworm'] }] }] } } };
    return {};
  });
  const gcp = require('../server/cloud/gcp');
  const [gi] = await gcp.pull({ serviceAccountJson: JSON.stringify(sa) }, 'servers');
  assert.deepStrictEqual([gi.rows[0].Name, gi.rows[0]['Internal IP'], gi.rows[0]['Operating System']], ['gce-app01', '10.10.0.2', 'debian-12-bookworm']); ok('GCP instâncias (JWT assinado)');

  // Zabbix (JSON-RPC)
  const ts = (d) => Math.floor(new Date(d).getTime() / 1000);
  mock((url, o) => {
    const b = JSON.parse(o.body);
    const R = (result) => ({ jsonrpc: '2.0', result, id: 1 });
    if (b.method !== 'apiinfo.version') assert.strictEqual(o.headers.authorization, 'Bearer TOK');
    switch (b.method) {
      case 'apiinfo.version': return R('7.0.5');
      case 'hostgroup.get': return R([{ groupid: '10', name: 'CLIENTE' }, { groupid: '11', name: 'OUTRO' }]);
      case 'host.get': return R([{ hostid: '1', host: 'srv-db01', name: 'CLIENTE.SRV-DB01', status: '0', interfaces: [{ ip: '10.0.0.1' }] }, { hostid: '2', host: 'srv-web01', name: 'CLIENTE.SRV-WEB01', status: '0', interfaces: [{ ip: '10.0.0.2' }] }]);
      case 'event.get': return R([
        { eventid: '1', objectid: 't1', name: 'Alta utilização de memória', severity: '3', clock: String(ts('2026-09-03T10:00:00')) },
        { eventid: '2', objectid: 't1', name: 'Alta utilização de memória', severity: '3', clock: String(ts('2026-09-04T10:00:00')) },
        { eventid: '3', objectid: 't2', name: 'Disco D: espaço em disco criticamente baixo', severity: '4', clock: String(ts('2026-09-05T10:00:00')) },
        { eventid: '4', objectid: 't3', name: 'Zabbix agent is not available', severity: '3', clock: String(ts('2026-09-05T11:00:00')) }]);
      case 'problem.get': return R([{ eventid: '3', objectid: 't2', name: 'Disco D: espaço', severity: '4', r_eventid: '0', clock: String(ts('2026-09-05T10:00:00')) }]);
      case 'trigger.get': return R([
        { triggerid: 't1', description: 'Alta utilização de memória', status: '0', hosts: [{ hostid: '1', name: 'CLIENTE.SRV-DB01' }] },
        { triggerid: 't2', description: 'Disco D: espaço em disco criticamente baixo', status: '0', hosts: [{ hostid: '1', name: 'CLIENTE.SRV-DB01' }] },
        { triggerid: 't3', description: 'Zabbix agent is not available', status: '0', hosts: [{ hostid: '2', name: 'CLIENTE.SRV-WEB01' }] }]);
      case 'item.get':
        if (b.params.search) return R([{ hostid: '1', key_: 'vfs.fs.size[D:,pused]', lastvalue: '93.4', status: '0' }, { hostid: '1', key_: 'vfs.fs.size[C:,pused]', lastvalue: '40', status: '0' }]);
        if (b.params.filter.key_.includes('system.cpu.util')) return R([{ itemid: 'c1', hostid: '1', key_: 'system.cpu.util', lastvalue: '35', status: '0' }, { itemid: 'c2', hostid: '2', key_: 'system.cpu.util', lastvalue: '12', status: '0' }]);
        return R([{ itemid: 'm1', hostid: '1', key_: 'vm.memory.utilization', lastvalue: '88', status: '0' }]);
      case 'trend.get': return R([{ itemid: 'm1', value_avg: '86.2', value_max: '97', num: '60' }, { itemid: 'c1', value_avg: '30', value_max: '70', num: '60' }]);
    }
    return R([]);
  });
  const zbx = require('../server/cloud/zabbix');
  const [zr] = await zbx.pull({ url: 'https://zbx.local/zabbix', apiToken: 'TOK', hostGroups: 'cliente' }, 'zabbix', { from: '2026-09-01', to: '2026-09-30' });
  const zs = zr.summary;
  assert.deepStrictEqual([zs.totalHosts, zs.totalAlerts, zs.top5[0].host, zs.top5[0].alerts.mem, zs.top5[0].alerts.disk], [2, 4, 'CLIENTE.SRV-DB01', 2, 1]); ok('Zabbix: hosts, alertas e top 5 (falha de coleta não conta como recurso)');
  assert.strictEqual(zs.topMem[0].avg, 86.2); assert.strictEqual(zs.diskIssues[0].fs, 'D:'); ok('Zabbix: média de memória (trends) e disco D: 93,4%');
  const recs = zr.sheets.recommendations.rows;
  assert.ok(recs.some((r) => r.Recurso === 'Memória' && r.Prioridade === 'Média') && recs.some((r) => r.Recurso === 'Disco' && r.Prioridade === 'Alta')); ok('Zabbix: recomendações de RAM e disco geradas');
  assert.ok(/Memória: 1 host\(s\) com média acima de 80%/.test(zs.summary)); ok('Zabbix: resumo executivo');
  // severidades escolhidas (só Alta = 4) e só servidores com alertas
  const [zr2] = await zbx.pull({ url: 'https://zbx.local/zabbix', apiToken: 'TOK', hostGroups: 'cliente' }, 'zabbix', { from: '2026-09-01', to: '2026-09-30', severities: [4], onlyWithAlerts: true });
  assert.deepStrictEqual([zr2.summary.totalAlerts, zr2.summary.bySeverity[3], zr2.summary.bySeverity[4]], [1, 0, 1]); ok('Zabbix: filtra alertas pelas severidades escolhidas');
  assert.deepStrictEqual(zr2.sheets.hosts.rows.map((r) => r.Host), ['CLIENTE.SRV-DB01']); ok('Zabbix: opção de deixar de fora servidores sem alerta no período');
  assert.strictEqual(zr.sheets.hosts.rows.length, 2); ok('Zabbix: por padrão inclui servidores sem alerta');
  assert.strictEqual(zbx.classify('Alto uso de espaço de swap'), 'other'); assert.strictEqual(zbx.classify('C:: Utilização de espaço em disco'), 'disk'); ok('Zabbix: classificação de triggers igual ao book original');

  // GLPI (REST)
  mock((url, o) => {
    if (url.endsWith('/initSession')) { assert.strictEqual(o.headers.Authorization, 'user_token UT'); return { session_token: 'S' }; }
    if (url.endsWith('/killSession')) return {};
    assert.strictEqual(o.headers['Session-Token'], 'S');
    return [
      { id: 12, name: 'Lentidão no ERP', date: '2026-09-20 10:00:00', solvedate: '2026-09-20 14:00:00', status: 5, priority: 4, type: 1, itilcategories_id: 'Infra > Servidores', entities_id: 'Cliente' },
      { id: 11, name: 'Criar usuário', date: '2026-09-02 09:00:00', solvedate: null, status: 2, priority: 3, type: 2, itilcategories_id: 'Acessos', entities_id: 'Cliente' },
      { id: 9, name: 'Antigo aberto', date: '2026-08-10 09:00:00', solvedate: null, status: 4, priority: 2, type: 1, itilcategories_id: 'Rede', entities_id: 'Cliente' }];
  });
  const glpi = require('../server/cloud/glpi');
  const [gr] = await glpi.pull({ url: 'https://glpi.local', userToken: 'UT', appToken: 'AT' }, 'glpi', { from: '2026-09-01', to: '2026-09-30' });
  assert.deepStrictEqual([gr.summary.total, gr.summary.incidentes, gr.summary.resolvidos, gr.summary.backlog, gr.summary.mttrHoras], [2, 1, 1, 1, 4]); ok('GLPI: chamados do período, backlog e tempo médio de solução');
  assert.strictEqual(gr.sheets.tickets.rows[0].Status, 'Resolvido'); ok('GLPI: planilha de chamados');

  // SigV4 — vetor oficial da AWS (get-vanilla)
  const v = aws.sign({ method: 'GET', host: 'example.amazonaws.com', region: 'us-east-1', service: 'service', creds: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' }, date: new Date('2015-08-30T12:36:00Z') });
  assert.strictEqual(v.signature, '5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31'); ok('SigV4 confere com o vetor oficial da AWS');

  // Tenant e Security Score
  mock((url, o) => {
    const body = String(o.body || '');
    if (body.includes('GetCallerIdentity')) return '<GetCallerIdentityResponse><GetCallerIdentityResult><Account>111122223333</Account><Arn>arn:aws:iam::111122223333:user/book</Arn></GetCallerIdentityResult></GetCallerIdentityResponse>';
    if (body.includes('ListAccountAliases')) return '<ListAccountAliasesResponse><ListAccountAliasesResult><AccountAliases><member>cliente-prd</member></AccountAliases></ListAccountAliasesResult></ListAccountAliasesResponse>';
    if (url.endsWith('/findings')) return { Findings: [
      { Compliance: { SecurityControlId: 'EC2.1', Status: 'PASSED' } }, { Compliance: { SecurityControlId: 'EC2.1', Status: 'FAILED' } },
      { Compliance: { SecurityControlId: 'S3.1', Status: 'PASSED' } }, { Compliance: { SecurityControlId: 'IAM.1', Status: 'PASSED' } }, { Compliance: { SecurityControlId: 'IAM.2', Status: 'PASSED' } }] };
    return '<x/>';
  });
  const [ten] = await aws.tenant({ accessKeyId: 'AK', secretAccessKey: 'S', regions: 'sa-east-1' });
  assert.deepStrictEqual([ten.kind, ten.rows[0].Conta, ten.rows[0]['Account ID'], ten.rows[0].Alias], ['tenant', 'cliente-prd', '111122223333', 'cliente-prd']); ok('AWS Geral › tenant no formato AWS (conta, ID, alias)');
  const [sc, scRecs, scAlerts] = await aws.score({ accessKeyId: 'AK', secretAccessKey: 'S', regions: 'sa-east-1' });
  assert.deepStrictEqual([sc.kind, sc.rows[0]['Pontuação'], sc.rows[0]['Classificação']], ['score', '75', '3 de 4 controles aprovados']); ok('AWS Security Hub: controle com qualquer falha conta como reprovado (3/4 = 75%)');
  assert.deepStrictEqual([scRecs.kind, scRecs.rows.length, scRecs.rows[0].Controle, scRecs.rows[0]['Recursos reprovados'], scAlerts.kind], ['score_recs', 1, 'EC2.1', '1', 'score_alerts']); ok('AWS: controles reprovados viram recomendações; findings viram alertas');
  mock((url) => {
    if (url.includes('oauth2')) return { access_token: 'T', expires_in: 3600 };
    if (url.includes('/tenants?')) return { value: [{ tenantId: 'ten-1', displayName: 'Cliente SA' }] };
    if (url.includes('/subscriptions?')) return { value: [{ subscriptionId: 'sub-1', displayName: 'Produção', state: 'Enabled' }] };
    if (url.includes('/assessments')) return { value: [{ name: 'a1', properties: { displayName: 'MFA para contas', status: { code: 'Unhealthy' }, metadata: { severity: 'High' } } }, { name: 'a2', properties: { displayName: 'MFA para contas', status: { code: 'Unhealthy' }, metadata: { severity: 'High' } } }, { name: 'a3', properties: { displayName: 'Ok', status: { code: 'Healthy' } } }] };
    if (url.includes('/alerts')) return { value: [{ properties: { alertDisplayName: 'Login suspeito', severity: 'High', compromisedEntity: 'vm-01', timeGeneratedUtc: '2026-11-10T10:00:00Z', status: 'Active' } }, { properties: { alertDisplayName: 'Antigo', severity: 'Low', status: 'Dismissed' } }] };
    if (url.includes('secureScores')) return { value: [{ name: 'ascScore', properties: { displayName: 'ASC score', score: { current: 31.5, max: 45, percentage: 0.7 } } }] };
    return { value: [] };
  });
  const azure2 = require('../server/cloud/azure');
  const azCfg = { tenantId: 'ten-1', clientId: 'c', clientSecret: 's' };
  const [azt] = await azure2.tenant(azCfg);
  assert.deepStrictEqual([azt.rows[0].Tenant, azt.rows[0]['Tenant ID'], azt.rows[0].Assinatura, azt.rows[0]['Subscription ID']], ['Cliente SA', 'ten-1', 'Produção', 'sub-1']); ok('Azure Geral › tenant no formato Azure (tenant e assinaturas)');
  const [azs, azRecs, azAlerts] = await azure2.score(azCfg);
  assert.deepStrictEqual([azs.rows[0]['Pontuação'], azs.rows[0].Escopo, azRecs.rows[0].Assinatura], ['70', 'Produção', 'Produção']); ok('Azure Defender Secure Score em %');
  assert.deepStrictEqual([azRecs.rows.length, azRecs.rows[0]['Recursos não íntegros'], azRecs.rows[0].Severidade, azAlerts.rows.length, azAlerts.rows[0].Severidade], [1, '2', 'Alta', 1, 'Alta']); ok('Azure: recomendações não íntegras agrupadas e alertas ativos (descartados ficam de fora)');
  const cloudIdx = require('../server/cloud');
  // ── paridade entre clouds ──
  // GCP: conta de serviço de teste (chave gerada aqui), projetos de todos os acessíveis, tamanho dos buckets e Security Command Center
  const gkey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  const gsa = JSON.stringify({ type: 'service_account', client_email: 'book@proj.iam.gserviceaccount.com', private_key: gkey, project_id: 'proj-sa', token_uri: 'https://oauth2.googleapis.com/token' });
  mock((url) => {
    if (url.includes('oauth2.googleapis.com/token')) return { access_token: 'GT', expires_in: 3600 };
    if (url.includes('cloudresourcemanager.googleapis.com/v1/projects?')) return { projects: [{ projectId: 'proj-a' }, { projectId: 'proj-b' }] };
    if (url.includes('/storage/v1/b?project=proj-a')) return { items: [{ name: 'bkt-a', storageClass: 'STANDARD', location: 'US', timeCreated: '2026-01-01T00:00:00Z' }] };
    if (url.includes('/storage/v1/b?project=')) return { items: [] };
    if (url.includes('monitoring.googleapis.com/v3/projects/proj-a/timeSeries')) return { timeSeries: [{ resource: { labels: { bucket_name: 'bkt-a' } }, points: [{ value: { doubleValue: 2500000000 } }] }, { resource: { labels: { bucket_name: 'bkt-a' } }, points: [{ value: { doubleValue: 500000000 } }] }] };
    if (url.includes('securitycenter.googleapis.com/v1/projects/proj-a/')) return { listFindingsResults: [
      { finding: { category: 'PUBLIC_BUCKET_ACL', findingClass: 'MISCONFIGURATION', severity: 'HIGH', resourceName: '//storage/bkt-a' } },
      { finding: { category: 'PUBLIC_BUCKET_ACL', findingClass: 'MISCONFIGURATION', severity: 'HIGH', resourceName: '//storage/bkt-c' } },
      { finding: { category: 'Malware: Bad Domain', findingClass: 'THREAT', severity: 'CRITICAL', resourceName: '//compute/vm-1', eventTime: '2026-11-20T10:00:00Z' } }] };
    if (url.includes('securitycenter.googleapis.com')) return { listFindingsResults: [] };
    return { items: {} };
  });
  const gcfg = { serviceAccountJson: gsa };
  const gst = (await cloudIdx.pull('gcp', gcfg, ['storage'])).results[0].rows;
  assert.deepStrictEqual([gst.map((r) => r.Project), gst[0].Size], [['proj-a'], '3 GB']); ok('GCP: sem projeto na conexão busca em todos os projetos acessíveis; tamanho do bucket pelo Cloud Monitoring');
  const gsc = await cloudIdx.pull('gcp', gcfg, ['score']);
  const grec = gsc.results.find((r) => r.kind === 'score_recs').rows; const gal = gsc.results.find((r) => r.kind === 'score_alerts').rows;
  assert.deepStrictEqual([grec[0]['Achado'], grec[0]['Recursos afetados'], grec[0].Severidade, gal[0].Alerta, gal[0].Severidade, /pontuação de segurança nativa/.test(gsc.errors[0].message)], ['PUBLIC_BUCKET_ACL', '2', 'Alta', 'Malware: Bad Domain', 'Crítica', true]); ok('GCP: Security Command Center — achados agrupados (recomendações) e ameaças (alertas); avisa que não há pontuação nativa');
  // AWS: todas as regiões habilitadas, SO pela AMI, tamanho do S3 e jobs do AWS Backup
  mock((url, o) => {
    const body = String(o.body || '');
    if (body.includes('Action=DescribeRegions')) return '<r><regionInfo><item><regionName>sa-east-1</regionName><optInStatus>opt-in-not-required</optInStatus></item><item><regionName>me-south-1</regionName><optInStatus>not-opted-in</optInStatus></item></regionInfo></r>';
    if (body.includes('Action=DescribeInstances')) return '<r><reservationSet><item><instancesSet><item><instanceId>i-1</instanceId><imageId>ami-1</imageId><platformDetails>Windows</platformDetails><instanceState><name>running</name></instanceState><tagSet><item><key>Name</key><value>srv-ad01</value></item></tagSet></item></instancesSet></item></reservationSet></r>';
    if (body.includes('Action=DescribeImages')) return '<r><imagesSet><item><imageId>ami-1</imageId><name>Windows_Server-2019-English-Full-Base</name><description>Microsoft Windows Server 2019 with Desktop Experience</description></item></imagesSet></r>';
    if (body.includes('Action=DescribeVolumes')) return '<r/>';
    if (url === 'https://s3.amazonaws.com/') return '<r><Buckets><Bucket><Name>logs-prd</Name><CreationDate>2025-01-01T00:00:00Z</CreationDate></Bucket></Buckets></r>';
    if (url.includes('?location=')) return '<LocationConstraint>sa-east-1</LocationConstraint>';
    if (body.includes('Action=GetMetricStatistics')) return body.includes('StandardStorage') && !body.includes('IAStorage') ? '<r><Datapoints><member><Timestamp>2026-11-25T00:00:00Z</Timestamp><Average>1500000000</Average></member></Datapoints></r>' : '<r/>';
    if (url.includes('/backup-jobs/')) { assert.ok(/createdAfter=2026-11-01/.test(url)); return { BackupJobs: [{ ResourceArn: 'arn:aws:rds:sa-east-1:1:db:banco-prd', ResourceType: 'RDS', State: 'COMPLETED', CreationDate: Date.UTC(2026, 10, 10) / 1000, BackupVaultName: 'cofre', CreatedBy: { BackupPlanId: 'p1' } }] }; }
    if (body.includes('Action=DescribeSnapshots')) return '<r><snapshotSet><item><snapshotId>snap-1</snapshotId><volumeId>vol-1</volumeId><volumeSize>50</volumeSize><status>completed</status><startTime>2026-11-12T00:00:00Z</startTime><description>Created by AWS Backup</description></item><item><snapshotId>snap-2</snapshotId><volumeId>vol-2</volumeId><volumeSize>20</volumeSize><status>completed</status><startTime>2026-11-13T00:00:00Z</startTime><description>manual</description></item></snapshotSet></r>';
    return '<r/>';
  });
  const acfg = { accessKeyId: 'AK', secretAccessKey: 'S' }; // sem regiões
  assert.deepStrictEqual(await require('../server/cloud/aws').regionsOf({ accessKeyId: 'AK', secretAccessKey: 'S' }, acfg), ['sa-east-1']); ok('AWS: sem regiões na conexão busca em todas as habilitadas (ignora as não ativadas)');
  const asrv = (await cloudIdx.pull('aws', acfg, ['servers'])).results[0].rows;
  assert.strictEqual(asrv[0]['Platform Details'], 'Microsoft Windows Server 2019 with Desktop Experience'); ok('AWS: SO pela descrição da AMI (em vez de "Windows"/"Linux/UNIX")');
  const ast = (await cloudIdx.pull('aws', acfg, ['storage'])).results[0].rows.find((r) => r.Name === 'logs-prd');
  assert.deepStrictEqual([ast['Size (GiB)'], ast.Region], ['1,5 GB', 'sa-east-1']); ok('AWS: tamanho dos buckets S3 (CloudWatch) e região do bucket');
  const abk = (await cloudIdx.pull('aws', acfg, ['backup'], { from: '2026-11-01', to: '2026-11-30', backupMode: 'jobs' })).results[0].rows;
  assert.deepStrictEqual(abk.map((r) => r.Item).sort(), ['banco-prd (RDS)', 'vol-2 (20 GiB)']); ok('AWS: backups feitos incluem os jobs do AWS Backup (RDS etc.) sem repetir os snapshots criados por ele');
  // Azure: capacidade usada das storage accounts
  mock((url) => {
    if (url.includes('oauth2')) return { access_token: 'T', expires_in: 3600 };
    if (url.includes('/subscriptions?')) return { value: [{ subscriptionId: 'sub-1', displayName: 'Prod' }] };
    if (url.includes('storageAccounts?')) return { value: [{ id: '/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/stprd', name: 'stprd', kind: 'StorageV2', sku: { name: 'Standard_LRS' }, location: 'brazilsouth', properties: { creationTime: '2025-01-01T00:00:00Z' } }] };
    if (url.includes('/providers/Microsoft.Insights/metrics')) return { value: [{ timeseries: [{ data: [{ average: 1000 }, { average: 250000000000 }] }] }] };
    return { value: [] };
  });
  const azs2 = (await cloudIdx.pull('azure', { tenantId: 't', clientId: 'c', clientSecret: 's' }, ['storage'])).results[0].rows.find((r) => r.Name === 'stprd');
  assert.strictEqual(azs2.Capacity, '250 GB'); ok('Azure: capacidade usada das storage accounts (Azure Monitor)');

  // ── Vulnerabilidades (CVEs) ──
  const V = require('../server/cloud/vulns');
  const agg = V.aggregate([
    { cve: 'CVE-2024-1', severity: 'HIGH', cvss: 7.5, host: 'srv-a', pkg: 'openssl 1.1' },
    { cve: 'cve-2024-1', severity: 'Critical', cvss: 9.1, host: 'srv-b' },
    { cve: 'CVE-2023-9', severity: '', cvss: 5, host: 'srv-a', fix: 'Atualizar o kernel' },
    { cve: '', title: '' }], 'Teste');
  assert.deepStrictEqual(agg.rows.map((r) => [r.CVE, r.Severidade, r.CVSS, r['Sistemas afetados']]), [['CVE-2024-1', 'Crítica', '9.1', '2 — srv-a, srv-b'], ['CVE-2023-9', 'Média', '5.0', '1 — srv-a']]);
  assert.deepStrictEqual([agg.kind, agg.summary.total, agg.summary.hosts, agg.rows[1]['Ação sugerida'], agg.rows[0]['Ação sugerida']], ['vulns', 2, 2, 'Atualizar o kernel', 'Atualizar openssl 1.1']); ok('vulnerabilidades: uma linha por CVE, maior severidade/CVSS, servidores afetados e severidade pelo CVSS quando falta');
  // Zabbix: com só a severidade Alta, a memória (alertas Média) fica sem alerta e não vira recomendação, mesmo com uso alto
  const zrecs2 = zr2.sheets.recommendations.rows;
  assert.ok(!zrecs2.some((r) => r.Recurso === 'Memória') && zrecs2.some((r) => r.Recurso === 'Disco')); ok('Zabbix: servidor sem alerta no período não entra nas recomendações (cliente pode ter pedido para não alertar)');

  // Wazuh 4.8+ (indexer) e até 4.7 (API do manager)
  mock((url, o) => {
    if (url.endsWith('/security/user/authenticate')) { assert.ok(/^Basic /.test(o.headers.authorization)); return { data: { token: 'WT' } }; }
    if (url.includes('/agents?')) return { data: { affected_items: [{ id: '000', name: 'manager' }, { id: '001', name: 'srv-web' }, { id: '002', name: 'srv-db' }] } };
    if (url.includes('/_search')) return { hits: { hits: [
      { _source: { agent: { id: '001', name: 'srv-web' }, vulnerability: { id: 'CVE-2024-3094', severity: 'Critical', score: { base: 10 } }, package: { name: 'xz', version: '5.6.0' } }, sort: [1] },
      { _source: { agent: { id: '002', name: 'srv-db' }, vulnerability: { id: 'CVE-2024-3094', severity: 'Critical', score: { base: 10 } }, package: { name: 'xz', version: '5.6.0' } }, sort: [2] },
      { _source: { agent: { id: '002', name: 'srv-db' }, vulnerability: { id: 'CVE-2022-1', severity: 'Low', score: { base: 2.1 } }, package: { name: 'bash' } }, sort: [3] }] } };
    if (url.includes('/vulnerability/001')) return { data: { affected_items: [{ cve: 'CVE-2021-44228', severity: 'Critical', cvss3_score: 10, name: 'log4j', version: '2.14' }] } };
    if (url.includes('/vulnerability/')) return { data: { affected_items: [] } };
    return { data: {} };
  });
  const wz = require('../server/cloud/wazuh');
  const [wr] = await wz.pull({ url: 'https://wazuh:55000', user: 'u', password: 'p', indexerUrl: 'https://wazuh:9200' }, 'wazuh');
  assert.deepStrictEqual([wr.kind, wr.summary.agents, wr.sheets.vulns.rows[0].CVE, wr.sheets.vulns.rows[0]['Sistemas afetados'], wr.sheets.vulns.rows.length], ['vulns', 2, 'CVE-2024-3094', '2 — srv-web, srv-db', 2]); ok('Wazuh 4.8+: CVEs do indexer agrupados por CVE (agente 000 do manager fica de fora)');
  const [wr2] = await wz.pull({ url: 'https://wazuh:55000', user: 'u', password: 'p' }, 'wazuh');
  assert.deepStrictEqual([wr2.sheets.vulns.rows[0].CVE, wr2.sheets.vulns.rows[0].Severidade, wr2.sheets.vulns.rows[0]['Sistemas afetados']], ['CVE-2021-44228', 'Crítica', '1 — srv-web']); ok('Wazuh até 4.7: CVEs por agente pela API do manager');

  // Microsoft Defender for Endpoint
  mock((url) => {
    if (url.includes('oauth2')) { return { access_token: 'DT', expires_in: 3600 }; }
    if (url.includes('SoftwareVulnerabilitiesByMachine')) return { value: [
      { deviceName: 'pc-01', rbacGroupName: 'Servidores', cveId: 'CVE-2024-38063', vulnerabilitySeverityLevel: 'Critical', softwareVendor: 'microsoft', softwareName: 'windows_server_2019', recommendedSecurityUpdate: 'KB5041578' },
      { deviceName: 'pc-02', rbacGroupName: 'Estações', cveId: 'CVE-2024-38063', vulnerabilitySeverityLevel: 'Critical' },
      { deviceName: 'pc-01', rbacGroupName: 'Servidores', cveId: 'CVE-2023-1', vulnerabilitySeverityLevel: 'Medium' }] };
    if (url.includes('/api/vulnerabilities/CVE-2024-38063')) return { id: 'CVE-2024-38063', cvssV3: 9.8 };
    return { value: [] };
  });
  const df = require('../server/cloud/defender');
  const [dr] = await df.pull({ tenantId: 't', clientId: 'c', clientSecret: 's', deviceGroup: 'servidores' });
  assert.deepStrictEqual(dr.sheets.vulns.rows.map((r) => [r.CVE, r.CVSS, r['Sistemas afetados'], r['Ação sugerida']]), [['CVE-2024-38063', '9.8', '1 — pc-01', 'KB5041578'], ['CVE-2023-1', '', '1 — pc-01', '']]); ok('Defender for Endpoint: CVEs por dispositivo, filtro por grupo e CVSS dos mais graves');

  // CVEs pelas clouds (opção "Vulnerabilidades" da sincronização)
  mock((url) => {
    if (url.includes('inspector2.sa-east-1.amazonaws.com/findings/list')) return { findings: [{ title: 'CVE-2024-6387 - openssh', severity: 'HIGH', inspectorScore: 8.1, packageVulnerabilityDetails: { vulnerabilityId: 'CVE-2024-6387', vulnerablePackages: [{ name: 'openssh', version: '8.9', fixedInVersion: '9.8' }] }, resources: [{ id: 'arn:aws:ec2:sa-east-1:1:instance/i-1', tags: { Name: 'app-prd' } }] }] };
    return {};
  });
  const awv = (await cloudIdx.pull('aws', { accessKeyId: 'AK', secretAccessKey: 'S', regions: 'sa-east-1' }, ['vulns'])).results[0];
  assert.deepStrictEqual([awv.kind, awv.rows[0].CVE, awv.rows[0]['Sistemas afetados'], awv.rows[0]['Ação sugerida'], awv.rows[0].Fonte], ['vulns', 'CVE-2024-6387', '1 — app-prd', 'Atualizar openssh para 9.8', 'Amazon Inspector']); ok('AWS: CVEs do Amazon Inspector (nome da instância pela tag Name)');
  mock((url, o) => {
    if (url.includes('oauth2')) return { access_token: 'T', expires_in: 3600 };
    if (url.includes('/subscriptions?')) return { value: [{ subscriptionId: 'sub-1' }] };
    if (url.includes('Microsoft.ResourceGraph')) { assert.ok(/subassessments/.test(JSON.parse(o.body).query)); return { data: [{ id: '/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm-sql/providers/Microsoft.Security/assessments/x/subAssessments/y',
      properties: { id: 'CVE-2024-21413', displayName: 'Outlook RCE', status: { code: 'Unhealthy', severity: 'High' }, remediation: 'Instalar a atualização', resourceDetails: { id: '/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm-sql' }, additionalData: { assessedResourceType: 'ServerVulnerabilityTvm', cvss: { '3.0': { base: 9.8 } } } } }] }; }
    return { value: [] };
  });
  const zv = (await cloudIdx.pull('azure', { tenantId: 't2', clientId: 'c', clientSecret: 's' }, ['vulns'])).results[0];
  assert.deepStrictEqual([zv.rows[0].CVE, zv.rows[0].CVSS, zv.rows[0]['Sistemas afetados'], zv.rows[0].Severidade], ['CVE-2024-21413', '9.8', '1 — vm-sql', 'Alta']); ok('Azure: CVEs das VMs pelo Defender for Cloud (Resource Graph)');
  mock((url) => {
    if (url.includes('oauth2.googleapis.com/token')) return { access_token: 'GT', expires_in: 3600 };
    if (url.includes('cloudresourcemanager')) return { projects: [{ projectId: 'proj-a' }] };
    if (url.includes('securitycenter')) { assert.ok(decodeURIComponent(url).includes('findingClass="VULNERABILITY"')); return { listFindingsResults: [{ finding: { category: 'OS_VULNERABILITY', severity: 'CRITICAL', resourceName: '//compute/instances/vm-web', vulnerability: { cve: { id: 'CVE-2024-1086', cvssv3: { baseScore: 7.8 } }, offendingPackage: { packageName: 'linux-kernel', packageVersion: '5.15' } } } }] }; }
    return {};
  });
  const gv = (await cloudIdx.pull('gcp', gcfg, ['vulns'])).results[0];
  assert.deepStrictEqual([gv.rows[0].CVE, gv.rows[0].Severidade, gv.rows[0]['Sistemas afetados']], ['CVE-2024-1086', 'Crítica', '1 — vm-web']); ok('GCP: CVEs do Security Command Center');
  mock((url) => {
    if (url.includes('regionSubscriptions')) return [{ regionName: 'sa-saopaulo-1', status: 'READY' }];
    if (url.includes('/compartments?')) return [];
    if (url.includes('/hostScanResults?')) return [{ id: 'hs1', instanceId: 'ocid1.instance.x', timeStarted: '2026-11-01T00:00:00Z' }, { id: 'hs0', instanceId: 'ocid1.instance.x', timeStarted: '2026-10-01T00:00:00Z' }];
    if (url.includes('/instances/ocid1.instance.x')) return { displayName: 'vm-oci' };
    if (url.includes('/hostScanResults/hs1')) return { problems: [{ name: 'openssl', cveReference: 'CVE-2024-5535', severity: 'HIGH', recommendation: 'Atualizar o openssl' }] };
    if (url.includes('/hostScanResults/hs0')) return { problems: [{ name: 'velho', cveReference: 'CVE-2000-1', severity: 'LOW' }] };
    return [];
  });
  const ov = (await cloudIdx.pull('oci', ocfg, ['vulns'])).results[0];
  assert.deepStrictEqual(ov.rows.map((r) => [r.CVE, r.Severidade, r['Sistemas afetados'], r['Ação sugerida']]), [['CVE-2024-5535', 'Alta', '1 — vm-oci', 'Atualizar o openssl']]); ok('OCI: CVEs do último scan de cada instância (Vulnerability Scanning)');
  // ── Topologia de rede (sincronização de Redes) ──
  const nm = (k, v) => `<tagSet><item><key>${k}</key><value>${v}</value></item></tagSet>`;
  mock((url, o) => {
    const b = String(o.body || '');
    if (b.includes('DescribeVpcs')) return `<R><vpcSet><item><vpcId>vpc-a</vpcId><cidrBlock>10.0.0.0/16</cidrBlock>${nm('Name', 'prd')}</item><item><vpcId>vpc-b</vpcId><cidrBlock>10.1.0.0/16</cidrBlock>${nm('Name', 'hml')}</item></vpcSet></R>`;
    if (b.includes('DescribeSubnets')) return `<R><subnetSet><item><subnetId>s1</subnetId><vpcId>vpc-a</vpcId><cidrBlock>10.0.1.0/24</cidrBlock><mapPublicIpOnLaunch>true</mapPublicIpOnLaunch>${nm('Name', 'pub')}</item></subnetSet></R>`;
    if (b.includes('DescribeInternetGateways')) return `<R><internetGatewaySet><item><internetGatewayId>igw-1</internetGatewayId><attachmentSet><item><vpcId>vpc-a</vpcId><state>available</state></item></attachmentSet></item></internetGatewaySet></R>`;
    if (b.includes('DescribeNatGateways')) return `<R><natGatewaySet><item><natGatewayId>nat-1</natGatewayId><vpcId>vpc-a</vpcId><state>available</state></item></natGatewaySet></R>`;
    if (b.includes('DescribeVpcPeeringConnections')) return `<R><vpcPeeringConnectionSet><item><requesterVpcInfo><vpcId>vpc-a</vpcId></requesterVpcInfo><accepterVpcInfo><vpcId>vpc-b</vpcId></accepterVpcInfo><status><code>active</code></status></item></vpcPeeringConnectionSet></R>`;
    if (b.includes('DescribeTransitGateways')) return `<R><transitGatewaySet><item><transitGatewayId>tgw-1</transitGatewayId>${nm('Name', 'tgw-core')}</item></transitGatewaySet></R>`;
    if (b.includes('DescribeTransitGatewayAttachments')) return `<R><transitGatewayAttachments><item><transitGatewayId>tgw-1</transitGatewayId><resourceType>vpc</resourceType><resourceId>vpc-b</resourceId><state>available</state></item></transitGatewayAttachments></R>`;
    if (b.includes('DescribeVpnConnections')) return `<R><vpnConnectionSet><item><vpnConnectionId>vpn-1</vpnConnectionId><transitGatewayId>tgw-1</transitGatewayId><state>available</state>${nm('Name', 'matriz')}</item></vpnConnectionSet></R>`;
    return '<x/>';
  });
  const anet = (await cloudIdx.pull('aws', { accessKeyId: 'AK', secretAccessKey: 'S', regions: 'sa-east-1' }, ['network'])).results;
  const at = anet.find((s) => s.kind === 'topology').topology;
  assert.deepStrictEqual([at.networks.length, at.networks[0].gateways.map((g) => g.type).join(','), at.networks[0].subnets[0].public, at.hubs[0].name], [2, 'Internet GW,NAT GW', true, 'tgw-core']);
  assert.deepStrictEqual(at.links.map((l) => `${l.type}:${l.a}>${l.b}`).sort(), ['attach:vpc-b>tgw-1', 'internet:vpc-a>internet', 'peering:vpc-a>vpc-b', 'vpn:tgw-1>onprem']); ok('AWS: topologia com gateways, peering, Transit Gateway e VPN');
  assert.strictEqual(anet.find((s) => s.kind === 'network').rows.length, 2); ok('AWS: a planilha de VPCs continua igual ao lado da topologia');
  mock((url) => {
    if (url.includes('oauth2')) return { access_token: 'T', expires_in: 3600 };
    if (url.includes('/subscriptions?')) return { value: [{ subscriptionId: 'sub-1' }] };
    if (url.includes('virtualNetworks')) return { value: [
      { id: '/subscriptions/sub-1/resourceGroups/rg-net/providers/Microsoft.Network/virtualNetworks/vnet-hub', name: 'vnet-hub', location: 'brazilsouth', properties: { addressSpace: { addressPrefixes: ['10.10.0.0/16'] }, subnets: [{ name: 'GatewaySubnet', properties: { addressPrefix: '10.10.0.0/27' } }, { name: 'snet-app', properties: { addressPrefix: '10.10.1.0/24', natGateway: { id: 'x' } } }],
        virtualNetworkPeerings: [{ properties: { peeringState: 'Connected', remoteVirtualNetwork: { id: '/subscriptions/sub-1/resourceGroups/rg-net/providers/Microsoft.Network/virtualNetworks/vnet-spoke' } } }] } },
      { id: '/subscriptions/sub-1/resourceGroups/rg-net/providers/Microsoft.Network/virtualNetworks/vnet-spoke', name: 'vnet-spoke', location: 'brazilsouth', properties: { addressSpace: { addressPrefixes: ['10.20.0.0/16'] }, subnets: [] } }] };
    if (url.includes('Microsoft.ResourceGraph')) return { data: [
      { id: '/subscriptions/sub-1/resourceGroups/rg-net/providers/Microsoft.Network/virtualNetworkGateways/vgw', type: 'microsoft.network/virtualnetworkgateways', properties: { ipConfigurations: [{ properties: { subnet: { id: '/subscriptions/sub-1/resourceGroups/rg-net/providers/Microsoft.Network/virtualNetworks/vnet-hub/subnets/GatewaySubnet' } } }] } },
      { id: 'c1', name: 'vpn-matriz', type: 'microsoft.network/connections', properties: { connectionType: 'IPsec', virtualNetworkGateway1: { id: '/subscriptions/sub-1/resourceGroups/rg-net/providers/Microsoft.Network/virtualNetworkGateways/vgw' } } }] };
    return { value: [] };
  });
  const zt = (await cloudIdx.pull('azure', { tenantId: 't3', clientId: 'c', clientSecret: 's' }, ['network'])).results.find((s) => s.kind === 'topology').topology;
  assert.deepStrictEqual([zt.networks[0].gateways.map((g) => g.type).join(','), zt.networks[0].subnets.map((s) => s.name).join(','), zt.links.map((l) => l.type).sort().join(',')], ['VPN / ExpressRoute GW,NAT GW', 'snet-app', 'peering,vpn']); ok('Azure: topologia com GatewaySubnet como gateway, NAT, peering e VPN do gateway');

  // ── VMware vCenter (menu On-Premises) ──
  const vcHits = [];
  const vcFetch = (style) => { global.fetch = async (url, o = {}) => {
    const u = new URL(String(url)); const J = (b, st = 200) => new Response(JSON.stringify(b), { status: st });
    const p = u.pathname; vcHits.push((o.method || 'GET') + ' ' + p + u.search);
    if (style === 'rest' && p.startsWith('/api/')) return J({ error_type: 'NOT_FOUND' }, 404);
    const wrap = (b) => (style === 'rest' ? { value: b } : b);
    if (p.endsWith('/session') && o.method === 'POST') {
      assert.ok(/^Basic /.test(o.headers.authorization));
      // como alguns vCenter 7.0: sem Content-Type, erro 500 com página HTML do Jetty
      if (!o.headers['content-type']) return new Response('<html><head><title>Error 500 javax.servlet.ServletException: Missing Content-Type header</title></head><body><h2>HTTP ERROR 500</h2></body></html>', { status: 500 });
      return J(style === 'rest' ? { value: 'T2' } : 'TOKEN');
    }
    if (o.method === 'DELETE') return J({});
    assert.strictEqual(o.headers['vmware-api-session-id'], style === 'rest' ? 'T2' : 'TOKEN');
    const q = Object.fromEntries(u.searchParams); const path = p.replace(/^\/(api|rest)/, '');
    if (path === '/vcenter/datacenter') return J(wrap([{ datacenter: 'dc-1', name: 'DC-SP' }]));
    if (path === '/vcenter/cluster') return J(wrap([{ cluster: 'domain-c1', name: 'Cluster-PRD' }, { cluster: 'domain-c2', name: 'Cluster-HML' }]));
    if (path === '/vcenter/host') return J(wrap(q.clusters === 'domain-c1' ? [{ host: 'host-1', name: 'esx01' }] : q.clusters === 'domain-c2' ? [{ host: 'host-2', name: 'esx02' }]
      : [{ host: 'host-1', name: 'esx01' }, { host: 'host-2', name: 'esx02' }, { host: 'host-3', name: 'esx03-standalone' }]));
    if (path === '/vcenter/vm' && q.hosts) return J(wrap({ 'host-1': [{ vm: 'vm-1', name: 'SRV-SQL-01', power_state: 'POWERED_ON', cpu_count: 4, memory_size_MiB: 16384 }], 'host-2': [{ vm: 'vm-2', name: 'SRV-APP-HML', power_state: 'POWERED_OFF', cpu_count: 2, memory_size_MiB: 4096 }] }[q.hosts] || []));
    if (path === '/vcenter/vm') return J(wrap([{ vm: 'vm-1' }, { vm: 'vm-2' }]));
    if (path === '/vcenter/vm/vm-1/guest/identity') return J(wrap({ ip_address: '10.0.0.10', full_name: { default_message: 'Microsoft Windows Server 2019 (64-bit)' }, host_name: 'srv-sql-01.local' }));
    if (path === '/vcenter/vm/vm-2/guest/identity') return J({ error_type: 'SERVICE_UNAVAILABLE' }, 503); // VM desligada / sem VMware Tools
    if (path === '/vcenter/vm/vm-2') return J(wrap({ guest_OS: 'RHEL_8_64' }));
    if (path === '/vcenter/datastore') return J(wrap([{ name: 'DS-01', type: 'VMFS', capacity: 1099511627776, free_space: 274877906944 }]));
    if (path === '/vcenter/network') return J(wrap([{ name: 'VLAN10-PRD', type: 'DISTRIBUTED_PORTGROUP' }]));
    if (path === '/appliance/system/version') return J(wrap({ version: '8.0.2', build: '22617221' }));
    return J({ error_type: 'NOT_FOUND' }, 404);
  }; };
  const vcfg = { url: 'https://vcenter.local/', user: 'leitura@vsphere.local', password: 'x' };
  vcFetch('api');
  const vsrv = (await cloudIdx.pull('vmware', vcfg, ['servers'])).results[0].rows;
  const sql = vsrv.find((r) => r.VM === 'SRV-SQL-01'), app = vsrv.find((r) => r.VM === 'SRV-APP-HML');
  assert.deepStrictEqual([vsrv.length, sql['Primary IP Address'], sql['OS according to the VMware Tools'], sql.Powerstate, sql.Cluster, sql.Host, sql.Datacenter, sql.CPUs, sql.Memory],
    [2, '10.0.0.10', 'Microsoft Windows Server 2019 (64-bit)', 'poweredOn', 'Cluster-PRD', 'esx01', 'DC-SP', '4', '16384']);
  assert.deepStrictEqual([app.Powerstate, app['OS according to the VMware Tools'], app['Primary IP Address']], ['poweredOff', 'rhel 8 64', '']); ok('vCenter: VMs com IP e SO do VMware Tools, cluster, host e datacenter (sem Tools: SO da configuração)');
  assert.ok(vcHits.some((h) => /^DELETE \/api\/session/.test(h))); ok('vCenter: encerra a sessão no fim');
  const only = (await cloudIdx.pull('vmware', Object.assign({}, vcfg, { clusters: 'cluster-prd' }), ['servers'])).results[0].rows;
  assert.deepStrictEqual(only.map((r) => r.VM), ['SRV-SQL-01']); ok('vCenter: filtro por cluster');
  const vst = (await cloudIdx.pull('vmware', vcfg, ['storage'])).results[0].rows[0];
  assert.deepStrictEqual([vst.Name, vst['Capacity MiB'], vst['In Use MiB'], vst.Type], ['DS-01', '1048576', '786432', 'Datastore VMFS']); ok('vCenter: datastores com capacidade e uso (formato RVTools)');
  const vall = await cloudIdx.pull('vmware', vcfg, ['network', 'tenant', 'backup', 'score', 'vulns']);
  assert.deepStrictEqual([vall.errors.length, vall.results.map((r) => r.kind).join(','), vall.results[0].rows[0]['Port Group']], [0, 'network,tenant', 'VLAN10-PRD']);
  const vten = vall.results[1].rows[0];
  assert.deepStrictEqual([vten.vCenter, vten['Versão'], vten.Clusters, vten['Hosts ESXi'], vten.VMs], ['vcenter.local', '8.0.2 build 22617221', 'Cluster-PRD, Cluster-HML', '3', '2 (1 ligadas)']);
  ok('vCenter: redes, Geral (versão, clusters, hosts e VMs); backup, Security Score e CVEs ficam de fora sem erro');
  vcFetch('rest'); vcHits.length = 0;
  const vold = (await cloudIdx.pull('vmware', vcfg, ['servers'])).results[0].rows;
  assert.ok(vold.length === 2 && vcHits.some((h) => h.startsWith('POST /rest/com/vmware/cis/session'))); ok('vCenter 6.5–7.0: usa a API antiga (/rest) quando a nova não existe');
  const tst = await cloudIdx.test('vmware', vcfg);
  assert.ok(tst.ok && /API antiga/.test(tst.message) && /3 host/.test(tst.message), tst.message); ok('vCenter: testar conexão mostra a versão da API, hosts e VMs');
  vcFetch('api');
  assert.strictEqual((await cloudIdx.pull('vmware', Object.assign({}, vcfg, { url: '172.16.35.100' }), ['servers'])).results[0].rows.length, 2); ok('vCenter: endereço sem https:// (só IP ou nome) funciona; a sessão vai com Content-Type');
  // falha de acesso: uma linha só, sem página HTML, sem tentar os outros tipos
  global.fetch = async () => new Response('<html><head><title>Error 500 javax.servlet.ServletException: Missing Content-Type header</title></head><body>…</body></html>', { status: 500 });
  const vfail = await cloudIdx.pull('vmware', vcfg, ['servers', 'storage', 'network', 'baseline', 'tenant']);
  assert.strictEqual(vfail.errors.length, 1);
  assert.ok(/^servers, storage, network, baseline, tenant$/.test(vfail.errors[0].kind) && /Missing Content-Type header/.test(vfail.errors[0].message) && !/<html|<title/.test(vfail.errors[0].message), JSON.stringify(vfail.errors));
  ok('vCenter: erro de acesso vira uma linha só (todos os tipos), com o título do erro em vez da página HTML');
  assert.ok(/Endereço do vCenter inválido/.test((await cloudIdx.test('vmware', Object.assign({}, vcfg, { url: 'http://[bad' }))).message)); ok('vCenter: endereço inválido explica o formato esperado');

  // ── Oracle VM 3.x (OVM Manager) → menu On-Premises ──
  const ovmHits = [];
  global.fetch = async (url, o = {}) => {
    const u = new URL(String(url)); const J = (b, st = 200) => new Response(JSON.stringify(b), { status: st });
    ovmHits.push(u.host + u.pathname);
    assert.ok(/^Basic /.test(o.headers.authorization) && o.headers.accept === 'application/json');
    const ref = (value, name) => ({ value, name, type: 'x', uri: 'u' });
    switch (u.pathname.replace('/ovm/core/wsapi/rest', '')) {
      case '/Vm': return J([
        { id: ref('0004fb00006000001', 'SRV-ORA-DB01'), name: 'SRV-ORA-DB01', vmRunState: 'RUNNING', cpuCount: 8, currentCpuCount: 8, memory: 32768, currentMemory: 32768, osType: 'Oracle Linux 7', serverPoolId: ref('p1', 'Pool-PRD'), serverId: ref('s1', 'ovs01') },
        { id: ref('0004fb00006000002', 'SRV-APP-HML'), name: 'SRV-APP-HML', vmRunState: 'STOPPED', cpuCount: 2, memory: 4096, osType: 'Microsoft Windows Server 2016', serverPoolId: ref('p2', 'Pool-HML'), serverId: ref('s2', 'ovs02') }]);
      case '/Server': return J([{ id: ref('s1', 'ovs01'), name: 'ovs01', serverPoolId: ref('p1', 'Pool-PRD') }, { id: ref('s2', 'ovs02'), name: 'ovs02', serverPoolId: ref('p2', 'Pool-HML') }]);
      case '/ServerPool': return J([{ id: ref('p1', 'Pool-PRD'), name: 'Pool-PRD' }, { id: ref('p2', 'Pool-HML'), name: 'Pool-HML' }]);
      case '/VirtualNic': return J([{ id: ref('n1', 'nic'), vmId: ref('0004fb00006000001', 'SRV-ORA-DB01'), ipAddresses: [{ address: '10.1.0.20' }, { address: 'fe80::1' }] }]);
      case '/FileSystem': return J([{ id: ref('fs1', 'fs'), size: 2199023255552, freeSize: 549755813888 }]);
      case '/Repository': return J([{ id: ref('r1', 'REPO-01'), name: 'REPO-01', fileSystemId: ref('fs1', 'fs') }]);
      case '/Network': return J([{ id: ref('net1', 'VM-PRD'), name: 'VM-PRD', roles: ['VIRTUAL_MACHINE'] }]);
      case '/Manager': return J([{ managerVersion: '3.4.6.2105' }]);
    }
    return J({ error: 'x' }, 404);
  };
  const ocfgVm = { url: 'ovmm.local', user: 'admin', password: 'x' };
  const osrv = (await cloudIdx.pull('ovm', ocfgVm, ['servers'])).results[0].rows;
  const db1 = osrv.find((r) => r.Name === 'SRV-ORA-DB01');
  assert.deepStrictEqual([osrv.length, db1['IP Address'], db1['Operating System'], db1.Status, db1.Cluster, db1.Host, db1.CPUs, db1['Memory (MB)']], [2, '10.1.0.20', 'Oracle Linux 7', 'running', 'Pool-PRD', 'ovs01', '8', '32768']);
  assert.ok(ovmHits.every((h) => h.startsWith('ovmm.local:7002/ovm/core/wsapi/rest/'))); ok('Oracle VM: VMs com IP (sem o fe80), SO, estado, server pool e servidor OVS; porta 7002 e caminho da API completados');
  assert.deepStrictEqual((await cloudIdx.pull('ovm', Object.assign({}, ocfgVm, { pools: 'pool-hml' }), ['servers'])).results[0].rows.map((r) => r.Name), ['SRV-APP-HML']); ok('Oracle VM: filtro por server pool');
  const ost = (await cloudIdx.pull('ovm', ocfgVm, ['storage'])).results[0].rows[0];
  assert.deepStrictEqual([ost.Name, ost.Capacity, ost.Used], ['REPO-01', '2048 GB', '1536 GB']); ok('Oracle VM: repositórios com capacidade e uso');
  const oall = await cloudIdx.pull('ovm', ocfgVm, ['network', 'tenant', 'backup', 'score']);
  const oten = oall.results[1].rows[0];
  assert.deepStrictEqual([oall.errors.length, oall.results[0].rows[0]['Network Name'], oten['OVM Manager'], oten['Versão'], oten['Server Pools'], oten.VMs], [0, 'VM-PRD', 'ovmm.local:7002', '3.4.6.2105', 'Pool-PRD, Pool-HML', '2 (1 ligadas)']);
  ok('Oracle VM: redes e Geral (versão, server pools, VMs); backup e Security Score ficam de fora sem erro');
  const otst = await cloudIdx.test('ovm', ocfgVm);
  assert.ok(otst.ok && /3\.4\.6/.test(otst.message) && /2 VM/.test(otst.message), otst.message); ok('Oracle VM: testar conexão mostra versão, pools, servidores e VMs');
  global.fetch = realFetch;
  console.log(`\n${passed} testes ok`);
}
main().catch((e) => { console.error('\n✗ FALHOU:', e); process.exit(1); });
