#!/usr/bin/env node
/* Testes de casos-limite e robustez: entradas malformadas, tentativas de ataque, concorrência,
 * restaurações incomuns da lixeira, retenção de backup e sincronização de grupos.
 *   npm test   (roda depois de tools/test-server.js) */
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const DATA = process.env.BOOK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'book-edge-'));
delete process.env.BOOK_STORAGE; delete process.env.MONGO_URL; delete process.env.BOOK_TRUST_PROXY;
const { server } = require('../server/index');
const storage = require('../server/storage');
let passed = 0;
const ok = (name) => { passed++; console.log('  ✓ ' + name); };

/** Requisição HTTP crua (para URLs que o fetch normalizaria). */
function raw(port, text) {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1', () => s.end(text));
    let out = ''; s.on('data', (d) => (out += d)); s.on('end', () => resolve(out)); s.on('error', reject);
  });
}

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, p, body, headers = {}) => {
    const r = await fetch(base + p, { method, redirect: 'manual', headers: Object.assign({ 'content-type': 'application/json' }, headers), body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const txt = await r.text(); let data; try { data = JSON.parse(txt); } catch (e) { data = txt; }
    return { status: r.status, data, cookie: ((r.headers.get('set-cookie') || '').match(/bt_auth=[^;]*/) || [''])[0], headers: r.headers };
  };
  const bk = (c, a, m, ar) => `?cliente=${encodeURIComponent(c)}&ano=${a}&mes=${m}&area=${encodeURIComponent(ar)}`;
  const st = (cliente, area, extra = {}) => Object.assign({ meta: { cliente, area }, groups: [] }, extra);

  // ── o que a página carrega existe e está no Git (quem baixa do GitHub recebe tudo) ──
  const root = path.join(__dirname, '..');
  const refs = ['html/scripts.html', 'html/head.html'].flatMap((f) => [...fs.readFileSync(path.join(root, f), 'utf8').matchAll(/(?:src|href)="((?:js|css|assets)\/[^"]+)"/g)].map((m) => m[1]));
  assert.ok(refs.length > 50);
  for (const r of refs) assert.strictEqual((await fetch(base + '/' + r)).status, 200, 'não servido: ' + r);
  ok(`os ${refs.length} scripts e estilos da página são servidos`);
  let tracked = null;
  try { tracked = new Set(require('child_process').execSync('git ls-files', { cwd: root, encoding: 'utf8' }).split('\n')); } catch (e) { /* sem git (ex.: zip baixado) */ }
  if (tracked && tracked.size > 1) {
    const missing = refs.filter((r) => !tracked.has(r));
    assert.deepStrictEqual(missing, [], 'fora do Git (confira o .gitignore): ' + missing.join(', '));
    ok('todos estão no Git (nada ignorado por engano pelo .gitignore)');
  }

  // ── entradas malformadas ────────────────────────────────
  assert.strictEqual((await call('GET', '/api/clients', undefined, { cookie: 'outro=100%; x=%E0%A4%A' })).status, 200); ok('cookie malformado de outro app não derruba a API');
  assert.match(await raw(port, 'GET /%E0%A4%A HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'), /^HTTP\/1\.1 400/); ok('URL com codificação inválida → 400');
  for (const p of ['/js/../../package.json', '/js/%2e%2e/%2e%2e/package.json', '/js/..%5c..%5cpackage.json', '/css/%00.css']) {
    const r = await raw(port, `GET ${p} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
    assert.ok(!/"name":\s*"book-tecnico"/.test(r), 'vazou ' + p);
  }
  ok('caminhos com ../, %2e%2e, barra invertida e byte nulo não vazam arquivos');
  assert.strictEqual((await call('PUT', '/api/book' + bk('A', 2026, '01', 'X'), '{isso não é json')).status, 400); ok('JSON inválido → 400');
  assert.strictEqual((await call('PUT', '/api/book' + bk('A', 2026, '01', 'X'), 'null')).status, 400); ok('corpo "null" → 400');
  assert.strictEqual((await call('PUT', '/api/book' + bk('A', 2026, '01', 'X'), { meta: 'x', groups: [] })).status, 400); ok('meta que não é objeto → 400');
  assert.strictEqual((await call('PUT', '/api/book' + bk('!!!', 2026, '01', 'X'), st('!!!', 'X'))).status, 400); ok('cliente só com símbolos → 400');
  assert.strictEqual((await call('PUT', '/api/book' + bk('A', 26, '01', 'X'), st('A', 'X'))).status, 400); ok('ano com 2 dígitos → 400');
  assert.strictEqual((await call('PUT', '/api/book' + bk('A', 2026, '00', 'X'), st('A', 'X'))).status, 400); ok('mês 00 → 400');
  assert.strictEqual((await call('GET', '/api/rota-que-nao-existe')).status, 404); ok('rota desconhecida → 404');
  assert.strictEqual((await call('DELETE', '/api/health')).status, 404); ok('método errado → 404');
  assert.strictEqual((await call('GET', '/api/logs?kind=inventado')).status, 400); ok('tipo de log desconhecido → 400');
  assert.strictEqual((await call('POST', '/api/lock', { action: 'x', book: 'a/2026/01/b' })).data.disabled, true); ok('bloqueio desligado: ações de lock não quebram');
  const head = await fetch(base + '/api/health', { method: 'HEAD' });
  assert.deepStrictEqual([head.status, (await head.text()).length], [200, 0]); ok('HEAD responde sem corpo');
  assert.strictEqual((await call('PUT', '/api/book' + bk('A', 2026, '01', 'X'), st('A', 'X'), { origin: 'null' })).status, 403); ok('Origin "null" (iframe/arquivo) não grava');
  assert.strictEqual((await call('PUT', '/api/book' + bk('A', 2026, '01', 'X'), st('A', 'X'), { origin: 'http://127.0.0.1.evil.com' })).status, 403); ok('Origin parecido com o host não engana a checagem');

  // ── nomes com acentos e símbolos ────────────────────────
  assert.strictEqual((await call('PUT', '/api/book' + bk('São João & Cia — Ltda.', 2026, '03', 'Banco de Dados'), st('São João & Cia — Ltda.', 'Banco de Dados'))).status, 200);
  const sj = (await call('GET', '/api/clients')).data.find((c) => c.slug === 'sao-joao-cia-ltda');
  assert.ok(sj && sj.nome === 'São João & Cia — Ltda.'); ok('cliente com acentos, & e travessão: slug limpo e nome preservado');
  assert.strictEqual((await call('GET', '/api/book' + bk('SAO JOAO & CIA LTDA', 2026, 3, 'banco-de-dados'))).status, 200); ok('mesmo book encontrado com grafia diferente (slug)');

  // ── concorrência ────────────────────────────────────────
  const writes = Array.from({ length: 25 }, (_, i) => call('PUT', '/api/book' + bk('Conc', 2026, String((i % 12) + 1).padStart(2, '0'), 'Rede'), st('Conc', 'Rede', { n: i })));
  assert.ok((await Promise.all(writes)).every((r) => r.status === 200)); assert.strictEqual((await call('GET', '/api/books?cliente=conc')).data.length, 12); ok('25 gravações simultâneas: nenhuma falha, 12 books (um por mês)');
  const guids = (await call('GET', '/api/books?cliente=conc')).data.map((b) => b.guid);
  assert.strictEqual(new Set(guids).size, 12); ok('cada book mantém um GUID único sob concorrência');
  const g1 = (await call('GET', '/api/book' + bk('Conc', 2026, '01', 'Rede'))).data.guid;
  await call('PUT', '/api/book' + bk('Conc', 2026, '01', 'Rede'), st('Conc', 'Rede', { guid: g1, v: 2 }));
  assert.strictEqual((await call('GET', '/api/book' + bk('Conc', 2026, '01', 'Rede'))).data.guid, g1); ok('salvar de novo não troca o GUID');

  // ── lixeira: casos incomuns ─────────────────────────────
  await call('PUT', '/api/connections?cliente=SoConexao', { nome: 'Só Conexão', providers: { aws: { accessKeyId: 'AK', secretAccessKey: 'S1' } } });
  const del = await call('DELETE', '/api/client?cliente=soconexao');
  assert.strictEqual(del.status, 200);
  let tr = (await call('GET', '/api/trash')).data.items;
  assert.ok(tr[0].type === 'client' && tr[0].hasConnections && !JSON.stringify(tr).includes('S1')); ok('cliente só com conexões vai para a lixeira; segredos não aparecem na lista');
  await call('POST', '/api/trash/restore', { tid: tr[0].tid });
  assert.strictEqual(storage.api.getConnections('soconexao').providers.aws.secretAccessKey, 'S1'); ok('restaurar cliente devolve as conexões com o segredo');
  assert.strictEqual((await call('POST', '/api/trash/restore', { tid: 'nao-existe' })).status, 404); ok('restaurar item inexistente → 404');
  assert.strictEqual((await call('DELETE', '/api/trash?tid=nao-existe')).status, 404); ok('excluir definitivo item inexistente → 404');
  assert.strictEqual((await call('DELETE', '/api/year?cliente=ninguem&ano=2026')).status, 200); assert.ok(!(await call('GET', '/api/trash')).data.items.some((i) => i.label.includes('ninguem'))); ok('excluir ano vazio não cria item vazio na lixeira');
  await call('DELETE', '/api/book' + bk('Conc', 2026, '05', 'Rede'));
  await call('DELETE', '/api/book' + bk('Conc', 2026, '05', 'Rede')).then((r) => assert.strictEqual(r.status, 404)); ok('excluir o mesmo book duas vezes: a 2ª é 404');
  await call('PUT', '/api/book' + bk('Conc', 2026, '05', 'Rede'), st('Conc', 'Rede'));
  await call('DELETE', '/api/book' + bk('Conc', 2026, '05', 'Rede'));
  tr = (await call('GET', '/api/trash')).data.items.filter((i) => i.label.includes('05/2026'));
  assert.deepStrictEqual([tr.length, tr[0].duplicates, tr[0].guid !== tr[1].guid], [2, 2, true]); ok('mesmo book excluído 2 vezes: 2 itens, GUIDs diferentes, marcados como duplicados');
  await call('POST', '/api/trash/restore', { tid: tr[0].tid });
  const c2 = await call('POST', '/api/trash/restore', { tid: tr[1].tid });
  assert.strictEqual(c2.status, 409);
  await call('POST', '/api/trash/restore', { tid: tr[1].tid, mode: 'copy' });
  await call('PUT', '/api/book' + bk('Conc', 2026, '05', 'Rede (restaurado)'), st('Conc', 'Rede (restaurado)'));
  const again = (await call('GET', '/api/books?cliente=conc&ano=2026')).data.filter((b) => b.mes === '05').map((b) => b.area).sort();
  assert.deepStrictEqual(again, ['Rede', 'Rede (restaurado)']); ok('restaurar 2 duplicados: o 2º vira "(restaurado)" sem sobrescrever o 1º');
  await call('DELETE', '/api/book' + bk('Conc', 2026, '05', 'Rede'));
  const t3 = (await call('GET', '/api/trash')).data.items[0].tid;
  await call('PUT', '/api/book' + bk('Conc', 2026, '05', 'Rede'), st('Conc', 'Rede')); // recriado: agora há conflito
  await call('POST', '/api/trash/restore', { tid: t3, mode: 'copy' });
  assert.ok((await call('GET', '/api/books?cliente=conc&ano=2026')).data.some((b) => b.area === 'Rede (restaurado 2)')); ok('cópia quando "(restaurado)" já existe → "(restaurado 2)"');
  assert.strictEqual((await call('PUT', '/api/trash/settings', { days: 0 })).status, 400); assert.strictEqual((await call('PUT', '/api/trash/settings', { days: 'abc' })).status, 400); ok('prazo da lixeira inválido → 400');

  // ── login: brute force e cookies ────────────────────────
  await call('POST', '/api/auth/setup', { username: 'admin', name: 'Admin', password: 'senha-forte-1' });
  const adm = (await call('POST', '/api/auth/login', { username: 'admin', password: 'senha-forte-1' })).cookie;
  await call('PUT', '/api/auth/config', { enabled: true, lock: { enabled: true, responseMinutes: 1 } }, { cookie: adm });
  const spoof = [];
  for (let i = 0; i < 7; i++) spoof.push((await call('POST', '/api/auth/login', { username: 'admin', password: 'errada' + i }, { 'x-forwarded-for': '10.9.9.' + i })).status);
  assert.ok(spoof.slice(5).every((s) => s === 429)); ok('trocar X-Forwarded-For não burla o bloqueio de força bruta');
  assert.strictEqual((await call('POST', '/api/auth/login', { username: 'admin', password: 'senha-forte-1' })).status, 429); ok('bloqueado mesmo com a senha certa até o prazo acabar');
  assert.strictEqual((await call('GET', '/api/clients', undefined, { cookie: 'bt_auth=token-inventado' })).status, 401); ok('token de sessão inventado → 401');
  assert.strictEqual((await call('GET', '/api/clients', undefined, { cookie: 'bt_auth=' })).status, 401); ok('cookie de sessão vazio → 401');
  assert.strictEqual((await call('GET', '/api/clients', undefined, { cookie: adm + '; outro=%' })).status, 200); ok('sessão válida junto com cookie malformado continua funcionando');
  assert.strictEqual((await call('PUT', '/api/users', { username: 'a', password: 'senha-forte-1' }, { cookie: adm })).status, 400); ok('login de 1 caractere → 400');
  assert.strictEqual((await call('PUT', '/api/users', { username: 'x y', password: 'senha-forte-1' }, { cookie: adm })).status, 400); ok('login com espaço → 400');
  assert.strictEqual((await call('PUT', '/api/users', { username: 'ADMIN', password: 'senha-forte-1' }, { cookie: adm })).status, 409); ok('login duplicado (maiúsculas) → 409');

  // ── excluir com books em edição ─────────────────────────
  await call('PUT', '/api/users', { username: 'bia', name: 'Bia', password: 'senha-da-bia-1' }, { cookie: adm });
  const bia = (await call('POST', '/api/auth/login', { username: 'bia', password: 'senha-da-bia-1' })).cookie;
  await call('POST', '/api/lock', { action: 'acquire', book: 'conc/2026/02/rede' }, { cookie: bia });
  assert.strictEqual((await call('DELETE', '/api/client?cliente=conc', undefined, { cookie: adm })).status, 423); ok('não exclui cliente com book aberto por outra pessoa');
  assert.strictEqual((await call('DELETE', '/api/year?cliente=conc&ano=2025', undefined, { cookie: adm })).status, 200); ok('excluir outro ano do mesmo cliente continua liberado');
  assert.strictEqual((await call('DELETE', '/api/book' + bk('Conc', 2026, '02', 'Rede'), undefined, { cookie: adm })).status, 423); ok('não exclui o book que outra pessoa está editando');
  await call('POST', '/api/lock', { action: 'release', book: 'conc/2026/02/rede' }, { cookie: bia });
  assert.strictEqual((await call('DELETE', '/api/client?cliente=conc', undefined, { cookie: adm })).status, 200); ok('depois que ela sai, exclui normalmente');

  // ── backup: retenção preserva os backups de segurança ───
  const bdir = path.join(DATA, 'bk-ret');
  await call('PUT', '/api/backup/config', { keep: 1, local: { enabled: true, path: bdir } }, { cookie: adm });
  fs.mkdirSync(bdir, { recursive: true });
  fs.writeFileSync(path.join(bdir, 'book-tecnico-20200101-000000-antes-de-restaurar.json.gz'), 'x');
  fs.writeFileSync(path.join(bdir, 'nao-mexer.txt'), 'x');
  for (let i = 0; i < 2; i++) { assert.ok((await call('POST', '/api/backup/run', undefined, { cookie: adm })).data.ok); await new Promise((r) => setTimeout(r, 1100)); }
  const left = fs.readdirSync(bdir).sort();
  assert.ok(left.includes('book-tecnico-20200101-000000-antes-de-restaurar.json.gz') && left.includes('nao-mexer.txt') && left.filter((f) => /^book-tecnico-\d{8}-\d{6}\.json\.gz$/.test(f)).length === 1); ok('retenção apaga só backups normais (mantém os de segurança e outros arquivos)');
  const stamp = left.find((f) => /^book-tecnico-\d{8}-\d{6}\.json\.gz$/.test(f)).slice(13, 26);
  const now = new Date(); const localStamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}`;
  assert.strictEqual(stamp.slice(0, 11), localStamp); ok('nome do backup usa o horário do servidor (não UTC)');
  assert.strictEqual((await call('PUT', '/api/backup/config', { schedule: { enabled: true, time: '25:00' } }, { cookie: adm })).status, 400); ok('horário de backup inválido → 400');
  assert.strictEqual((await call('PUT', '/api/backup/config', { ftp: { enabled: true, host: '' } }, { cookie: adm })).status, 400); ok('FTP sem servidor → 400');
  assert.strictEqual((await call('PUT', '/api/backup/config', { oci: { enabled: true, mode: 'par', parUrl: 'http://x' } }, { cookie: adm })).status, 400); ok('URL do bucket inválida → 400');
  const restoreBad = await fetch(base + '/api/backup/restore', { method: 'POST', headers: { cookie: adm, 'content-type': 'application/octet-stream' }, body: Buffer.from('lixo') });
  assert.strictEqual(restoreBad.status, 400); ok('restaurar arquivo que não é backup → 400 (nada é apagado)');
  assert.ok((await call('GET', '/api/clients', undefined, { cookie: adm })).data.length > 0); ok('banco intacto depois da restauração recusada');

  // ── Graph: desativação manual é respeitada ──────────────
  const G = 'aaaaaaaa-0000-0000-0000-000000000001';
  await call('PUT', '/api/auth/config', { groups: { enabled: true, adminGroups: G, denyOthers: true }, graph: { enabled: true, tenantId: 't', clientId: 'c', clientSecret: 's' } }, { cookie: adm });
  const realFetch = global.fetch;
  let members = [{ id: 'o1', displayName: 'Caio', mail: 'caio@x.com', accountEnabled: true }];
  global.fetch = async (url, o) => {
    url = String(url);
    if (url.startsWith(base)) return realFetch(url, o);
    if (url.endsWith('/token')) return new Response(JSON.stringify({ access_token: 't' }));
    if (url.includes('/transitiveMembers')) return new Response(JSON.stringify({ value: members }));
    return new Response('{}', { status: 404 });
  };
  await call('POST', '/api/auth/graph/sync', undefined, { cookie: adm });
  const caio = (await call('GET', '/api/users', undefined, { cookie: adm })).data.find((u) => u.username === 'caio@x.com');
  await call('PUT', '/api/users', { id: caio.id, disabled: true }, { cookie: adm });
  members = [{ id: 'o1', displayName: 'Caio Novo Nome', mail: 'caio@x.com', accountEnabled: true }];
  await call('POST', '/api/auth/graph/sync', undefined, { cookie: adm });
  const caio2 = (await call('GET', '/api/users', undefined, { cookie: adm })).data.find((u) => u.username === 'caio@x.com');
  assert.deepStrictEqual([caio2.name, caio2.disabled], ['Caio Novo Nome', true]); ok('sincronização atualiza o nome mas não reativa quem o admin desativou');
  members = [{ id: 'o1', displayName: 'Caio', mail: 'caio@x.com', accountEnabled: false }];
  await call('POST', '/api/auth/graph/sync', undefined, { cookie: adm });
  global.fetch = realFetch;
  assert.ok((await call('GET', '/api/users', undefined, { cookie: adm })).data.find((u) => u.username === 'admin' && !u.disabled)); ok('admin local nunca é desativado pela sincronização');

  // ── site: URL externa e app desktop ─────────────────────
  assert.strictEqual((await call('PUT', '/api/site/config', { publicUrl: 'https://hack.example' }, { cookie: bia })).status, 403); ok('URL externa: só administrador altera');
  assert.strictEqual((await call('PUT', '/api/site/config', { publicUrl: 'javascript:alert(1)' }, { cookie: adm })).status, 400);
  assert.strictEqual((await call('PUT', '/api/site/config', { publicUrl: 'https://book.exemplo.com/?x=1' }, { cookie: adm })).status, 400); ok('URL externa inválida (esquema estranho, consulta) → 400');
  const sc = (await call('PUT', '/api/site/config', { publicUrl: 'https://book.exemplo.com.br/' }, { cookie: adm })).data;
  assert.strictEqual(sc.publicUrl, 'https://book.exemplo.com.br'); ok('URL externa salva sem a barra final');
  assert.strictEqual((await call('PUT', '/api/site/config', { publicUrl: 'book.exemplo.com.br' }, { cookie: adm })).data.publicUrl, 'https://book.exemplo.com.br'); ok('URL externa sem https:// é completada');
  assert.strictEqual((await call('GET', '/api/site', undefined, { cookie: bia })).data.publicUrl, 'https://book.exemplo.com.br'); ok('usuário comum vê a URL externa (para configurar o app desktop)');
  const ac = (await call('GET', '/api/auth/config', undefined, { cookie: adm })).data;
  assert.strictEqual(ac.acsUrl, 'https://book.exemplo.com.br/api/auth/saml/acs'); ok('SAML usa a URL externa na URL de resposta (ACS)');
  let dl = await call('GET', '/api/desktop/download', undefined, { cookie: bia });
  assert.deepStrictEqual([dl.status, /github\.com\/xdarkerx\/book-tecnico\/releases/.test(dl.headers.get('location'))], [302, true]); ok('download do app: padrão aponta para o release do GitHub');
  assert.strictEqual((await call('GET', '/api/desktop/download')).status, 401); ok('download do app exige login (com login ligado)');
  await call('PUT', '/api/site/config', { desktopUrl: 'https://arquivos.exemplo.com/BookTecnico.exe' }, { cookie: adm });
  dl = await call('GET', '/api/desktop/download', undefined, { cookie: bia });
  assert.strictEqual(dl.headers.get('location'), 'https://arquivos.exemplo.com/BookTecnico.exe'); ok('download do app: link definido pelo admin');
  fs.mkdirSync(path.join(DATA, 'desktop'), { recursive: true }); fs.writeFileSync(path.join(DATA, 'desktop', 'BookTecnico-Setup.exe'), 'MZ-instalador-de-teste');
  dl = await call('GET', '/api/desktop/download', undefined, { cookie: bia });
  assert.deepStrictEqual([dl.status, dl.data, /BookTecnico-Setup\.exe/.test(dl.headers.get('content-disposition'))], [200, 'MZ-instalador-de-teste', true]); ok('download do app: instalador em data/desktop tem prioridade (sem internet)');
  await call('PUT', '/api/site/config', { publicUrl: '', desktopUrl: '' }, { cookie: adm });
  assert.ok(/^http:\/\/127\.0\.0\.1:\d+\/api\/auth\/saml\/acs$/.test((await call('GET', '/api/auth/config', undefined, { cookie: adm })).data.acsUrl)); ok('sem URL externa: SAML volta a usar o endereço do acesso');

  // ── logs ────────────────────────────────────────────────
  await require('../server/logs').flush();
  const lg = (await call('GET', '/api/logs?kind=audit&limit=99999', undefined, { cookie: adm })).data;
  assert.ok(Array.isArray(lg) && lg.length <= 5000); ok('limite de registros por consulta é respeitado');
  const fl = (await call('GET', '/api/logs?kind=audit&from=' + (Date.now() + 86400000), undefined, { cookie: adm })).data;
  assert.strictEqual(fl.length, 0); ok('período no futuro → lista vazia (sem erro)');
  const files = fs.readdirSync(path.join(DATA, 'logs'));
  assert.ok(['http', 'db', 'app', 'audit'].every((k) => files.some((f) => f.startsWith(k + '-')))); ok('os 4 tipos de log são gravados em data/logs');
  assert.ok(!fs.readFileSync(path.join(DATA, 'logs', files.find((f) => f.startsWith('http-'))), 'utf8').includes('senha-forte-1')); ok('senhas nunca aparecem no log HTTP');

  server.close();
  await storage.close();
}

main().then(() => { console.log(`\n${passed} testes de robustez ok`); process.exit(0); })
  .catch((e) => { console.error('\n✗ FALHOU:', e); process.exit(1); });
