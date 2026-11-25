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
      case 'hostgroup.get': return R([{ groupid: '10', name: 'BRITECH' }, { groupid: '11', name: 'OUTRO' }]);
      case 'host.get': return R([{ hostid: '1', host: 'srv-db01', name: 'BRITECH.SRV-DB01', status: '0', interfaces: [{ ip: '10.0.0.1' }] }, { hostid: '2', host: 'srv-web01', name: 'BRITECH.SRV-WEB01', status: '0', interfaces: [{ ip: '10.0.0.2' }] }]);
      case 'event.get': return R([
        { eventid: '1', objectid: 't1', name: 'Alta utilização de memória', severity: '3', clock: String(ts('2026-09-03T10:00:00')) },
        { eventid: '2', objectid: 't1', name: 'Alta utilização de memória', severity: '3', clock: String(ts('2026-09-04T10:00:00')) },
        { eventid: '3', objectid: 't2', name: 'Disco D: espaço em disco criticamente baixo', severity: '4', clock: String(ts('2026-09-05T10:00:00')) },
        { eventid: '4', objectid: 't3', name: 'Zabbix agent is not available', severity: '3', clock: String(ts('2026-09-05T11:00:00')) }]);
      case 'problem.get': return R([{ eventid: '3', objectid: 't2', name: 'Disco D: espaço', severity: '4', r_eventid: '0', clock: String(ts('2026-09-05T10:00:00')) }]);
      case 'trigger.get': return R([
        { triggerid: 't1', description: 'Alta utilização de memória', status: '0', hosts: [{ hostid: '1', name: 'BRITECH.SRV-DB01' }] },
        { triggerid: 't2', description: 'Disco D: espaço em disco criticamente baixo', status: '0', hosts: [{ hostid: '1', name: 'BRITECH.SRV-DB01' }] },
        { triggerid: 't3', description: 'Zabbix agent is not available', status: '0', hosts: [{ hostid: '2', name: 'BRITECH.SRV-WEB01' }] }]);
      case 'item.get':
        if (b.params.search) return R([{ hostid: '1', key_: 'vfs.fs.size[D:,pused]', lastvalue: '93.4', status: '0' }, { hostid: '1', key_: 'vfs.fs.size[C:,pused]', lastvalue: '40', status: '0' }]);
        if (b.params.filter.key_.includes('system.cpu.util')) return R([{ itemid: 'c1', hostid: '1', key_: 'system.cpu.util', lastvalue: '35', status: '0' }, { itemid: 'c2', hostid: '2', key_: 'system.cpu.util', lastvalue: '12', status: '0' }]);
        return R([{ itemid: 'm1', hostid: '1', key_: 'vm.memory.utilization', lastvalue: '88', status: '0' }]);
      case 'trend.get': return R([{ itemid: 'm1', value_avg: '86.2', value_max: '97', num: '60' }, { itemid: 'c1', value_avg: '30', value_max: '70', num: '60' }]);
    }
    return R([]);
  });
  const zbx = require('../server/cloud/zabbix');
  const [zr] = await zbx.pull({ url: 'https://zbx.local/zabbix', apiToken: 'TOK', hostGroups: 'britech' }, 'zabbix', { from: '2026-09-01', to: '2026-09-30' });
  const zs = zr.summary;
  assert.deepStrictEqual([zs.totalHosts, zs.totalAlerts, zs.top5[0].host, zs.top5[0].alerts.mem, zs.top5[0].alerts.disk], [2, 4, 'BRITECH.SRV-DB01', 2, 1]); ok('Zabbix: hosts, alertas e top 5 (falha de coleta não conta como recurso)');
  assert.strictEqual(zs.topMem[0].avg, 86.2); assert.strictEqual(zs.diskIssues[0].fs, 'D:'); ok('Zabbix: média de memória (trends) e disco D: 93,4%');
  const recs = zr.sheets.recommendations.rows;
  assert.ok(recs.some((r) => r.Recurso === 'Memória' && r.Prioridade === 'Média') && recs.some((r) => r.Recurso === 'Disco' && r.Prioridade === 'Alta')); ok('Zabbix: recomendações de RAM e disco geradas');
  assert.ok(/Memória: 1 host\(s\) com média acima de 80%/.test(zs.summary)); ok('Zabbix: resumo executivo');
  assert.strictEqual(zbx.classify('Alto uso de espaço de swap'), 'other'); assert.strictEqual(zbx.classify('C:: Utilização de espaço em disco'), 'disk'); ok('Zabbix: classificação de triggers igual ao book original');

  // GLPI (REST)
  mock((url, o) => {
    if (url.endsWith('/initSession')) { assert.strictEqual(o.headers.Authorization, 'user_token UT'); return { session_token: 'S' }; }
    if (url.endsWith('/killSession')) return {};
    assert.strictEqual(o.headers['Session-Token'], 'S');
    return [
      { id: 12, name: 'Lentidão no ERP', date: '2026-09-20 10:00:00', solvedate: '2026-09-20 14:00:00', status: 5, priority: 4, type: 1, itilcategories_id: 'Infra > Servidores', entities_id: 'BRITech' },
      { id: 11, name: 'Criar usuário', date: '2026-09-02 09:00:00', solvedate: null, status: 2, priority: 3, type: 2, itilcategories_id: 'Acessos', entities_id: 'BRITech' },
      { id: 9, name: 'Antigo aberto', date: '2026-08-10 09:00:00', solvedate: null, status: 4, priority: 2, type: 1, itilcategories_id: 'Rede', entities_id: 'BRITech' }];
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
  assert.deepStrictEqual([ten.kind, ten.rows[0].Nome, ten.rows[0].ID], ['tenant', 'cliente-prd', '111122223333']); ok('AWS tenant: ID da conta e alias');
  const [sc] = await aws.score({ accessKeyId: 'AK', secretAccessKey: 'S', regions: 'sa-east-1' });
  assert.deepStrictEqual([sc.kind, sc.rows[0]['Pontuação'], sc.rows[0]['Classificação']], ['score', '75', '3 de 4 controles aprovados']); ok('AWS Security Hub: controle com qualquer falha conta como reprovado (3/4 = 75%)');
  mock((url) => {
    if (url.includes('oauth2')) return { access_token: 'T', expires_in: 3600 };
    if (url.includes('/tenants?')) return { value: [{ tenantId: 'ten-1', displayName: 'Cliente SA' }] };
    if (url.includes('/subscriptions?')) return { value: [{ subscriptionId: 'sub-1', displayName: 'Produção', state: 'Enabled' }] };
    if (url.includes('secureScores')) return { value: [{ name: 'ascScore', properties: { displayName: 'ASC score', score: { current: 31.5, max: 45, percentage: 0.7 } } }] };
    return { value: [] };
  });
  const azure2 = require('../server/cloud/azure');
  const azCfg = { tenantId: 'ten-1', clientId: 'c', clientSecret: 's' };
  const [azt] = await azure2.tenant(azCfg);
  assert.deepStrictEqual([azt.rows[0].Nome, azt.rows[0].ID, /Cliente SA/.test(azt.rows[0].Detalhes)], ['Produção', 'sub-1', true]); ok('Azure tenant: assinaturas com nome do tenant');
  const [azs] = await azure2.score(azCfg);
  assert.deepStrictEqual([azs.rows[0]['Pontuação'], azs.rows[0].Escopo], ['70', 'sub-1']); ok('Azure Defender Secure Score em %');
  const cloudIdx = require('../server/cloud');
  const g = await cloudIdx.pull('gcp', { projectIds: 'p1', serviceAccountJson: '{}' }, ['score']);
  assert.ok(g.errors[0] && /Security Score nativo/.test(g.errors[0].message)); ok('GCP sem score nativo: erro explicativo, sem quebrar a sincronização');

  global.fetch = realFetch;
  console.log(`\n${passed} testes ok`);
}
main().catch((e) => { console.error('\n✗ FALHOU:', e); process.exit(1); });
