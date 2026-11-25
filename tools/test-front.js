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
const load = (f) => vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'blocks', f), 'utf8'), { window: { BT } });
load('registry.js'); // registro real (titleHtml, wordText…)
const B = BT.blocks;
const register = B.register; B.register = (t, d) => { defs[t] = d; register(t, d); };
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

// exportação: escolher os riscos de recomendações/alertas
const sec = { data: Object.assign({ title: 'Cloud Security Score', items: [], note: '' }, B.scoreTables('oci')) };
sec.data.recs.rows = [['MFA', 'Crítica', '2', '(raiz)'], ['Patch', 'Média', '10', '(raiz)'], ['API key antiga', 'Baixa', '31', '(raiz)'], ['Sem risco', '', '1', '(raiz)']];
const st = (riscos) => ({ meta: { riscosExport: riscos }, groups: [{ sections: [{ blocks: [Object.assign({ type: 'score' }, sec)] }] }] });
const rowsIn = (h) => (h.match(/<tr>/g) || []).length - 1; // menos o cabeçalho
assert.strictEqual(rowsIn(defs.score.render(sec, { target: 'web', state: st(undefined) })), 4); ok('riscos: sem escolha, todas as linhas aparecem');
const filtered = defs.score.render(sec, { target: 'web', state: st(['critica', 'alta']) });
assert.deepStrictEqual([rowsIn(filtered), /Riscos exibidos: Crítica, Alta — 2 de 4/.test(filtered), filtered.includes('API key antiga')], [2, true, false]); ok('riscos: só Crítica/Alta (+ linha sem risco) e nota "2 de 4" no book');
assert.ok(/Riscos exibidos/.test(defs.score.word(sec, { target: 'word', state: st(['media']) }))); ok('riscos: filtro e nota também no Word');
assert.deepStrictEqual([B.riskLevelOf('HIGH'), B.riskLevelOf('Média'), B.riskLevelOf('Informational'), B.riskLevelOf('Disaster')], ['alta', 'media', 'info', 'critica']); ok('riscos: reconhece português e inglês');
assert.strictEqual(B.hasRiskRows(st()), true); assert.strictEqual(B.hasRiskRows({ groups: [] }), false); ok('riscos: a opção só aparece na exportação quando o book tem recomendações/alertas');

console.log(`\n${passed} testes do front ok`);
