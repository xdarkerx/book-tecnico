/* ═══ Testes de regras do front que não dependem do navegador (bloco Cloud Security Score) ═══
 * Carrega js/blocks/score.js num contexto com um BT mínimo e confere as conversões
 * usadas pela sincronização (API) e pelo ZIP.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
const ok = (msg) => { passed++; console.log('  ✓ ' + msg); };

const defs = {};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BT = { h: () => ({}), esc };
const load = (f, dir = 'blocks') => vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', dir, f), 'utf8'), { window: { BT }, btoa, unescape, encodeURIComponent });
load('registry.js'); // registro real (titleHtml, wordText…)
const B = BT.blocks;
const register = B.register; B.register = (t, d) => { defs[t] = d; register(t, d); };
load('charts.js', 'core'); BT.core = { utils: { debounce: (f) => f } }; BT.on = () => () => {};
load('chart.js'); // gráficos do comparativo e dos riscos
load('score.js');

// pontuação: aceita %, vírgula e coluna Máximo
const items = B.scoreItemsFromSheet({ fields: ['Conta', 'Pontuação', 'Máximo', 'Fonte'], rows: [{ Conta: 'Produção', 'Pontuação': '28', 'Máximo': '45', Fonte: 'Defender' }, { Conta: 'HML', 'Pontuação': '72,5%', 'Máximo': '', Fonte: 'X' }, { Conta: 'Vazio', 'Pontuação': '', Fonte: 'X' }] }, 'Azure');
assert.deepStrictEqual(items.map((i) => [i.label, i.value]), [['Azure · Produção', '62.2'], ['Azure · HML', '72.5']]); ok('score: converte "28 de 45" em 62,2%, aceita "72,5%" e ignora linha sem pontuação');
assert.deepStrictEqual(B.scoreItemsFromSheet({ fields: ['Score'], rows: [{ Score: '150' }, { Score: '-3' }] }).map((i) => i.value), ['100', '0']); ok('score: limita a pontuação entre 0 e 100');

// formatos por cloud
assert.deepStrictEqual(Object.keys(B.SCORE_FORMATS), ['oci', 'aws', 'azure', 'gcp', 'generic']);
assert.strictEqual(B.scoreTables('azure').recs.columns[0], 'Recomendação'); assert.strictEqual(B.scoreTables('xpto').provider, 'generic'); ok('score: tabelas vazias no formato de cada cloud (desconhecida → genérico)');

// bloco completo a partir das planilhas da API
const d = B.scoreFromSheets('aws', [
  { kind: 'score', fields: ['Escopo', 'Pontuação'], rows: [{ Escopo: 'sa-east-1', 'Pontuação': '75' }] },
  { kind: 'score_recs', fields: ['Controle', 'Severidade'], rows: [{ Controle: 'S3.1', Severidade: 'Alta' }] },
  { kind: 'score_alerts', fields: ['Título'], rows: [] }], 'AWS · PRD');
assert.deepStrictEqual([d.provider, d.items[0].label, d.recs.rows, d.alerts.columns[0]], ['aws', 'AWS · PRD · sa-east-1', [['S3.1', 'Alta']], 'Título']); ok('score: API vira um bloco (pontuação + recomendações; alertas vazios mantêm o formato da cloud)');

// isEmpty e render
const blk = { data: Object.assign({ title: 'Cloud Security Score', items: [{ label: '', value: '' }], note: '' }, B.scoreTables('aws')) };
assert.strictEqual(defs.score.isEmpty(blk), true);
blk.data.alerts.rows = [['<script>x</script>', 'GuardDuty', 'Crítica', 'i-1', '2026-11-01']];
assert.strictEqual(defs.score.isEmpty(blk), false); ok('score: bloco só com alertas não é vazio (aparece no book)');
const html = defs.score.render(blk, { target: 'preview' });
assert.ok(html.includes('&lt;script&gt;') && !html.includes('<script>x')); ok('score: conteúdo das planilhas é escapado no HTML');
assert.ok(/<span class="bk br">Crítica<\/span>/.test(html)); ok('score: severidade vira etiqueta colorida');
assert.ok(defs.score.word(blk, { target: 'word' }).includes('Findings críticos')); ok('score: exportação Word inclui as planilhas com o título do formato');

// textos longos (OCID) no Word: pontos de quebra invisíveis, sem mudar textos normais
const ocid = 'ocid1.tenancy.oc1..aaaaaaaao4am5ubi7rjjmlfoa5mlyll3nidj6pikuygvil6uegbtstznxb6q';
assert.ok(B.wordText(ocid).includes('&#8203;') && B.wordText(ocid).replace(/&#8203;/g, '') === ocid); ok('Word: OCID ganha pontos de quebra invisíveis (o texto continua igual)');
assert.strictEqual(B.wordText('Servidor de banco de dados'), 'Servidor de banco de dados'); assert.strictEqual(B.wordText('<b>x</b>'), '&lt;b&gt;x&lt;/b&gt;'); ok('Word: texto normal não muda e continua escapado');

assert.strictEqual(B.cellText(ocid), `<span class="blong">${ocid}</span>`); assert.strictEqual(B.cellText('caedu'), 'caedu'); ok('HTML/PDF: só textos longos sem espaço podem quebrar (palavras normais ficam inteiras)');

// importação: escolher os riscos de recomendações/alertas que entram no book
const sd = Object.assign({ title: 'Cloud Security Score', items: [], note: '' }, B.scoreTables('oci'));
sd.recs.rows = [['MFA', 'Crítica', '2', '(raiz)'], ['Patch', 'Média', '10', '(raiz)'], ['API key antiga', 'Baixa', '31', '(raiz)'], ['Sem risco', '', '1', '(raiz)']];
sd.alerts.rows = [['BUCKET_IS_PUBLIC', 'Alta', 'bkt', 'Bucket', 'prod', '2026-11-14'], ['SL_OPEN', 'Baixa', 'sl', 'SecurityList', 'prod', '2026-11-09']];
assert.deepStrictEqual(JSON.parse(JSON.stringify(B.riskCounts(sd))), { critica: 1, media: 1, baixa: 2, alta: 1 }); ok('riscos: conta recomendações e alertas de cada risco (para a tela de revisão)');
const f = B.filterRisks(sd, ['critica', 'alta']);
assert.deepStrictEqual([f.recs.rows.map((r) => r[0]), f.alerts.rows.map((r) => r[0])], [['MFA', 'Sem risco'], ['BUCKET_IS_PUBLIC']]); ok('riscos: só Crítica/Alta entram (linha sem risco sempre entra)');
assert.strictEqual(sd.recs.rows.length, 4); ok('riscos: o filtro não altera os dados originais (dá para refazer a escolha)');
assert.deepStrictEqual([B.riskLevelOf('HIGH'), B.riskLevelOf('Média'), B.riskLevelOf('Informational'), B.riskLevelOf('Disaster')], ['alta', 'media', 'info', 'critica']); ok('riscos: reconhece português e inglês');
const exp = defs.score.render({ data: sd }, { target: 'web', state: { meta: { riscosExport: ['critica'] } } });
assert.ok(exp.includes('API key antiga') && exp.includes('SL_OPEN') && !/Riscos exibidos/.test(exp)); ok('exportação mostra tudo o que está no book (o filtro é só na importação)');

// Cloud Guard: só a pontuação atual, gráficos de risco e o que mostrar
const cg = B.scoreFromSheets('oci', [
  { kind: 'score', fields: ['Escopo', 'Pontuação'], rows: [{ Escopo: 'Tenancy', 'Pontuação': '72' }] },
  { kind: 'score_trend', fields: ['Mês', 'Pontuação'], rows: [{ 'Mês': '2026-10', 'Pontuação': '65' }] },
  { kind: 'score_recs', fields: ['Recomendação', 'Risco', 'Problemas', 'Compartimento'], rows: [{ 'Recomendação': 'MFA', Risco: 'Crítica', Problemas: '2', Compartimento: '(raiz)' }, { 'Recomendação': 'Keys', Risco: 'Baixa', Problemas: '9', Compartimento: '(raiz)' }] },
  { kind: 'score_alerts', fields: ['Problema', 'Risco', 'Recurso', 'Tipo', 'Compartimento', 'Detectado em'], rows: [{ Problema: 'BUCKET_PUBLIC', Risco: 'Alta', Recurso: 'b', Tipo: 'Bucket', Compartimento: 'p', 'Detectado em': '2026-11-01' }] }], 'OCI');
let cgHtml = defs.score.render({ data: Object.assign({}, cg, { history: [{ label: 'OCI · Tenancy', mes: '2026-10', value: '65' }], month: '2026-11' }) }, { target: 'web', state: {} });
assert.ok(!cg.history && cgHtml.includes('72%')); ok('Cloud Guard: a API não traz mais histórico (o comparativo vem dos books anteriores)');
assert.ok(/out\/26: 65% · ▲ \+7 pts/.test(cgHtml) && /bscore-cmp/.test(cgHtml)); ok('comparativo: "out/26: 65% · ▲ +7 pts" no cartão (mês passado)');
assert.ok(!/Evolução da pontuação/.test(cgHtml)); ok('gráfico de evolução: desligado por padrão');
const evo = defs.score.render({ data: Object.assign({}, cg, { history: [{ label: 'OCI · Tenancy', mes: '2026-08', value: '60' }, { label: 'OCI · Tenancy', mes: '2026-10', value: '65' }], month: '2026-11', show: { evolution: true } }) }, { target: 'web', state: {} });
assert.ok(/Evolução da pontuação/.test(evo) && /<svg/.test(evo)); ok('gráfico de evolução: aparece quando ligado');
const noPrev = defs.score.render({ data: Object.assign({}, cg, { history: [{ label: 'OCI · Tenancy', mes: '2026-08', value: '60' }], month: '2026-11' }) }, { target: 'web', state: {} });
assert.ok(!/bscore-cmp/.test(noPrev)); ok('comparativo: só com o mês imediatamente anterior (agosto não conta para novembro)');
const off = defs.score.render({ data: Object.assign({}, cg, { history: [{ label: 'OCI · Tenancy', mes: '2026-10', value: '65' }], month: '2026-11', show: { compare: false } }) }, { target: 'web', state: {} });
assert.ok(!/bscore-cmp/.test(off)); ok('comparativo: pode ser desligado');
assert.ok(/out\/26: 65%/.test(defs.score.word({ data: Object.assign({}, cg, { history: [{ label: 'OCI · Tenancy', mes: '2026-10', value: '65' }], month: '2026-11' }) }, { target: 'word', state: {} }))); ok('Word: comparativo com o mês passado');
assert.ok(!/por risco/.test(cgHtml)); ok('gráficos de risco: desligados por padrão');
cg.show = { charts: true };
cgHtml = defs.score.render({ data: cg }, { target: 'web', state: {} });
assert.ok(/Recomendações \(Cloud Guard\) por risco/.test(cgHtml) && /Problemas abertos \(Cloud Guard\) por risco/.test(cgHtml) && /<svg/.test(cgHtml)); ok('gráficos de risco: recomendações e problemas por risco quando ligados');
assert.ok(/<img src="data:image\/svg\+xml/.test(defs.score.word({ data: cg }, { target: 'word', state: {} }))); ok('Word: gráficos de risco como imagem');
cg.show = { recs: false, alerts: false, charts: false };
cgHtml = defs.score.render({ data: cg }, { target: 'web', state: {} });
assert.ok(!cgHtml.includes('MFA') && !cgHtml.includes('BUCKET_PUBLIC') && cgHtml.includes('72')); ok('ocultar: recomendações e problemas somem do book; a pontuação fica');
assert.strictEqual(defs.score.isEmpty({ data: Object.assign({}, cg, { items: [] }) }), true); ok('ocultar tudo e sem pontuação: o bloco não aparece no book');

// mapeadores: CIDR da OCI ("CIDRs") e função dos servidores pelo nome
BT.importer = { mappers: {} }; BT.data = BT.data || { providers: {} };
for (const f of ['common', 'network', 'servers']) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'import', 'mappers', f + '.js'), 'utf8'), { window: { BT } });
const M = BT.importer.mappers;
assert.strictEqual(M.network.map({ fields: ['VCN Name', 'CIDRs', 'compartment_path'], rows: [{ 'VCN Name': 'VCN_JUMP', CIDRs: '10.0.0.0/16', compartment_path: 'CAEDU_JUMP' }] }, 'oci')[0].cidr, '10.0.0.0/16'); ok('rede: CIDR da OCI (coluna "CIDRs") preenche a planilha');
assert.deepStrictEqual(['CIDRs', 'IPAddress', 'privateIpAddress'].map(M._common.normKey), ['cidrs', 'ip address', 'private ip address']); ok('nomes de coluna: plural de sigla ("CIDRs") não é quebrado; camelCase continua');
const roles = M.servers.map({ fields: ['Display Name'], rows: ['CAEDU-FW-AD1', 'SRV-DC-01', 'SRV-AD-01', 'CAEDU-WK-005', 'CAEDU-ACCESS-OKE', 'CAEDU-PROD-MYSQL', 'CAEDU-IPO-003'].map((n) => ({ 'Display Name': n })) }, 'oci').map((r) => r.role);
assert.deepStrictEqual(JSON.parse(JSON.stringify(roles)), ['Firewall', 'Active Directory', 'Active Directory', 'Kubernetes', 'Kubernetes', 'Banco de Dados', '']); ok('função: FW com "AD" no nome é Firewall; workers/OKE são Kubernetes; sem pista fica em branco (não "Genérico")');

// planilhas: colunas sem nenhum dado saem do book; linhas com listra
assert.deepStrictEqual(JSON.parse(JSON.stringify(B.filledColumns([['a', '', '—', 'x'], ['b', '-', ' ', '']], 4))), [0, 3]); ok('colunas só com "", "—" ou "-" saem do book (ex.: Utilizado, Teste Restore)');
assert.deepStrictEqual(JSON.parse(JSON.stringify(B.filledColumns([['', ''], ['—', '']], 2))), [0, 1]); ok('planilha toda vazia mantém as colunas (não some o cabeçalho)');
const sec2 = { data: Object.assign({}, B.scoreTables('aws'), { items: [], show: {} }) };
sec2.data.recs.rows = [['S3.1', 'Bloquear acesso', 'Alta', '', '—'], ['EC2.8', 'IMDSv2', 'Média', '', '—']];
const h2 = defs.score.render(sec2, { target: 'web', state: {} });
assert.ok(!/Recursos reprovados|>Região</.test(h2) && /Controle/.test(h2)); ok('Segurança: colunas vazias também saem das recomendações');
assert.ok(new RegExp(B.ZEBRA).test(defs.score.word(sec2, { target: 'word', state: {} }))); ok('Word: linhas alternadas com a cor da listra');

// comparativo: busca a pontuação nos books dos meses anteriores
(async () => {
  const books = { '2026-10': { groups: [{ sections: [{ blocks: [{ type: 'score', data: { items: [{ label: 'OCI · Tenancy', value: '80' }, { label: 'Outro', value: '10' }] } }] }] }] }, '2026-09': { groups: [{ sections: [{ blocks: [{ type: 'score', data: { items: [{ label: 'OCI · Tenancy', value: '' }] } }] }] }] } };
  BT.api = { getBook: async (k) => books[`${k.ano}-${k.mes}`] || null };
  const d = { items: [{ label: 'OCI · Tenancy', value: '89' }] };
  await B.loadScoreHistory(d, { cliente: 'caedu', ano: '2026', mes: '11', area: 'infracloud' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify([d.month, d.history])), ['2026-11', [{ label: 'OCI · Tenancy', mes: '2026-10', value: '80' }]]); ok('comparativo: busca a pontuação de outubro no book de outubro (ignora vazio e outros itens)');
  console.log(`\n${passed} testes do front ok`);
})().catch((e) => { console.error(e); process.exit(1); });
