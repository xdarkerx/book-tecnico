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
load('topology.js');

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

assert.strictEqual(B.cellText(ocid), `<span class="blong">${ocid}</span>`); assert.strictEqual(B.cellText('acme'), 'acme'); ok('HTML/PDF: só textos longos sem espaço podem quebrar (palavras normais ficam inteiras)');

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
assert.ok(/ago\/26: 60%/.test(noPrev)); ok('comparativo: usa o mês anterior mais recente que tiver pontuação (agosto, sem setembro/outubro)');
const pick = defs.score.render({ data: Object.assign({}, cg, { history: [{ label: 'OCI · Tenancy', mes: '2026-08', value: '60' }, { label: 'OCI · Tenancy', mes: '2026-10', value: '65' }], month: '2026-11', compareWith: '2026-08' }) }, { target: 'web', state: {} });
assert.ok(/ago\/26: 60%/.test(pick) && !/out\/26/.test(pick)); ok('comparativo: dá para escolher o mês (agosto em vez de outubro)');
const none = defs.score.render({ data: Object.assign({}, cg, { history: [], month: '2026-11', show: { evolution: true } }) }, { target: 'web', state: {} });
assert.ok(!/bscore-cmp/.test(none) && !/Evolução da pontuação/.test(none)); ok('comparativo e evolução: sem mês anterior, não aparecem');
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
assert.strictEqual(M.network.map({ fields: ['VCN Name', 'CIDRs', 'compartment_path'], rows: [{ 'VCN Name': 'VCN_JUMP', CIDRs: '10.0.0.0/16', compartment_path: 'ACME_JUMP' }] }, 'oci')[0].cidr, '10.0.0.0/16'); ok('rede: CIDR da OCI (coluna "CIDRs") preenche a planilha');
assert.deepStrictEqual(['CIDRs', 'IPAddress', 'privateIpAddress'].map(M._common.normKey), ['cidrs', 'ip address', 'private ip address']); ok('nomes de coluna: plural de sigla ("CIDRs") não é quebrado; camelCase continua');
const roles = M.servers.map({ fields: ['Display Name'], rows: ['ACME-FW-AD1', 'SRV-DC-01', 'SRV-AD-01', 'ACME-WK-005', 'ACME-ACCESS-OKE', 'ACME-PROD-MYSQL', 'ACME-IPO-003'].map((n) => ({ 'Display Name': n })) }, 'oci').map((r) => r.role);
assert.deepStrictEqual(JSON.parse(JSON.stringify(roles)), ['Firewall', 'Active Directory', 'Active Directory', 'Kubernetes', 'Kubernetes', 'Banco de Dados', '']); ok('função: FW com "AD" no nome é Firewall; workers/OKE são Kubernetes; sem pista fica em branco (não "Genérico")');
const roles2 = M.servers.map({ fields: ['Display Name'], rows: ['SRV-ZBX-01', 'ZBX-PROXY-02', 'SRV-NDD-01', 'JIRA-PRD', 'JENKINS01', 'SQL-DR-01', 'SRV-DR'].map((n) => ({ 'Display Name': n })) }, 'oci').map((r) => r.role);
assert.deepStrictEqual(JSON.parse(JSON.stringify(roles2)), ['Zabbix', 'Zabbix', 'Print Server (NDD)', 'Jira', 'Jenkins', 'Banco de Dados (DR)', 'Disaster Recovery']); ok('função: siglas conhecidas (ZBX, NDD, Jira, Jenkins) e DR como complemento');

// planilhas: colunas sem nenhum dado saem do book; linhas com listra
assert.deepStrictEqual(JSON.parse(JSON.stringify(B.filledColumns([['a', '', '—', 'x'], ['b', '-', ' ', '']], 4))), [0, 3]); ok('colunas só com "", "—" ou "-" saem do book (ex.: Utilizado, Teste Restore)');
assert.deepStrictEqual(JSON.parse(JSON.stringify(B.filledColumns([['', ''], ['—', '']], 2))), [0, 1]); ok('planilha toda vazia mantém as colunas (não some o cabeçalho)');
const sec2 = { data: Object.assign({}, B.scoreTables('aws'), { items: [], show: {} }) };
sec2.data.recs.rows = [['S3.1', 'Bloquear acesso', 'Alta', '', '—'], ['EC2.8', 'IMDSv2', 'Média', '', '—']];
const h2 = defs.score.render(sec2, { target: 'web', state: {} });
assert.ok(!/Recursos reprovados|>Região</.test(h2) && /Controle/.test(h2)); ok('Segurança: colunas vazias também saem das recomendações');
assert.ok(new RegExp(B.ZEBRA).test(defs.score.word(sec2, { target: 'word', state: {} }))); ok('Word: linhas alternadas com a cor da listra');

// topologia de rede: redes, hub, internet e on-prem no SVG; vazio some do book; redes ocultas saem do desenho
{
  const T = BT.blocks.get('topology');
  const d = { title: 'Topologia', provider: 'aws', model: { networks: [{ id: 'a', name: 'vpc-prd', cidr: '10.0.0.0/16', subnets: [{ name: 'pub', cidr: '10.0.1.0/24', public: true }], gateways: [{ type: 'Internet GW', name: '' }] }, { id: 'b', name: 'vpc-hml', cidr: '10.1.0.0/16', subnets: [], gateways: [] }],
    hubs: [{ id: 'tgw', type: 'Transit Gateway', name: 'tgw-core' }], links: [{ a: 'a', b: 'internet', type: 'internet' }, { a: 'b', b: 'tgw', type: 'attach' }, { a: 'tgw', b: 'onprem', type: 'vpn', label: 'VPN · matriz' }] } };
  const tr = T.svg(d); // hierárquico (padrão): raiz, switch do hub e redes com ícones
  assert.ok(/<path d="M/.test(tr) && /TRANSIT GATEWAY/.test(tr) && /vpc-prd/.test(tr) && /vpc-hml/.test(tr) && /on-premises: VPN/.test(tr) && />AWS</.test(tr)); ok('topologia hierárquica (padrão): raiz, switch do hub com o on-premises e as redes ligadas por linhas');
  const c = T.svg(Object.assign({}, d, { style: 'compact', styleByUser: true })); // compacto, escolhido no editor
  assert.ok(/vpc-prd/.test(c) && /TRANSIT GATEWAY/.test(c) && /1 rede anexada · on-premises:/.test(c) && />VPN</.test(c) && !/ON-PREMISES/.test(c) && />TGW</.test(c) && />Internet</.test(c) && />NAT</.test(c) === false && !/10\.0\.1\.0\/24/.test(c) && /1 subnet \(1 púb\.\)/.test(c));
  assert.ok(/10\.0\.1\.0\/24/.test(T.svg(Object.assign({}, d, { style: 'compact', styleByUser: true, showSubnets: true })))); ok('topologia compacta: cartões com etiquetas (Internet, TGW), hub com redes anexadas, subnets só se pedir');
  d.style = 'tree'; d.styleByUser = true;
  const s = T.svg(d);
  assert.ok(T.isEmpty({ data: { model: { networks: [] } } }) && !T.isEmpty({ data: d }));
  assert.strictEqual(T.svg(Object.assign({}, d, { style: 'detailed' })), s); ok('topologia: "detalhado" gravado por versões anteriores vira o detalhado de hoje (árvore)');
  const many = JSON.parse(JSON.stringify(d)); for (let i = 0; i < 9; i++) many.model.links.push({ a: 'tgw', b: 'onprem', type: 'vpn', label: 'IPSec · t' + i });
  assert.ok(/on-premises: VPN \(10\)/.test(T.svg(many))); ok('topologia detalhada: vários túneis do mesmo hub viram "VPN (10)" embaixo do hub');
  const ic = T.svg({ provider: 'vmware', model: { networks: [{ id: 'x', name: 'DPG-SQL-PRD', cidr: 'VLAN 20', gateways: [{ type: '7 VMs' }] }], hubs: [], links: [] } });
  assert.ok(/<ellipse/.test(ic) && /\+2/.test(ic)); ok('topologia: ícone de TI pelo nome da rede (banco) e computadores para as VMs');
  const s2 = T.svg(Object.assign({}, d, { hidden: ['b'] }));
  assert.ok(!/vpc-hml/.test(s2) && !/TRANSIT GATEWAY/.test(s2)); ok('topologia: desenha redes, hub, internet e on-prem; rede oculta (e o hub só dela) sai do desenho');
}

// padrões da equipe: book novo recebe as opções; bloco com opção gravada (book copiado/antigo) fica como estava
{
  BT.data = BT.data || {}; load('defaults.js', 'data');
  const D = BT.data.defaults;
  assert.deepStrictEqual(JSON.parse(JSON.stringify([D.import().zabbixSeverities, D.import().zabbixAllHosts, D.import().risks, D.import().backupMode])), [[5, 4], false, ['critica', 'alta'], 'policies']); ok('padrões de fábrica: Zabbix só Desastre e Alta, sem servidores sem alerta, riscos Crítica e Alta, backup só políticas');
  const st = { groups: [{ sections: [{ blocks: [{ type: 'compare', data: { hideUnchanged: false } }, { type: 'score', data: {} }, { type: 'score', data: { show: { alerts: true } } }, { type: 'topology', data: { style: 'detailed' } }] }] }] };
  D.applyToNewBook(st);
  const [cmp, sc, scKept, topo] = st.groups[0].sections[0].blocks.map((b) => b.data);
  assert.deepStrictEqual(JSON.parse(JSON.stringify([cmp.hideUnchanged, sc.show, scKept.show, topo.style])), [true, { recs: true, alerts: false, charts: true, compare: true, evolution: true }, { alerts: true }, 'tree']);
  ok('book novo: comparativo oculta itens sem mudança, Cloud Security só com recomendações e gráficos (alertas desligados), topologia hierárquica');
  D.load({ blockDefaults: { topologyStyle: 'detailed', scoreShow: { alerts: true } }, importDefaults: { backupMode: 'both' } });
  assert.deepStrictEqual([D.blocks().topologyStyle, D.blocks().scoreShow.alerts, D.blocks().scoreShow.recs, D.import().backupMode, D.import().zabbixSeverities.length], ['detailed', true, true, 'both', 2]); ok('padrão da equipe salvo nas configurações substitui o de fábrica (o resto continua)');
  D.load({});
}
// imagens e logo: um book importado não consegue injetar script pelo src (x" onerror="…)
{
  load('sanitize.js', 'core');
  assert.deepStrictEqual(['data:image/png;base64,AA', 'https://x/a.png', 'assets/img/l.svg', 'x" onerror="alert(1)', 'javascript:alert(1)', 'data:text/html,<b>', 'data:image/png;base64,A"x'].map(BT.safeSrc),
    ['data:image/png;base64,AA', 'https://x/a.png', 'assets/img/l.svg', '', '', '', 'data:image/png;base64,A%22x']); ok('imagens: src só aceita imagem (data:, http(s), assets) e não fecha o atributo');
}
// ciclo de vida do SO na planilha de servidores (EOL, EOS e situação do suporte)
{
  const lc = M.servers.lifecycle('Windows Server 2019 Standard');
  assert.deepStrictEqual([lc.eol, lc.eos, M.servers.lifecycle('Oracle Linux 8.9').eos, M.servers.supportOf('01/2020'), M.servers.supportOf('01/2040')], ['01/2024', '01/2029', '05/2032', 'Sem suporte', 'OK']);
  ok('servidores: EOL/EOS do sistema operacional e situação do suporte');
}
// comparativo: busca a pontuação nos books dos meses anteriores
(async () => {
  const books = { '2026-10': { groups: [{ sections: [{ blocks: [{ type: 'score', data: { items: [{ label: 'OCI · Tenancy', value: '80' }, { label: 'Outro', value: '10' }] } }] }] }] }, '2026-09': { groups: [{ sections: [{ blocks: [{ type: 'score', data: { items: [{ label: 'OCI · Tenancy', value: '' }] } }] }] }] } };
  BT.api = { getBook: async (k) => books[`${k.ano}-${k.mes}`] || null };
  const d = { items: [{ label: 'OCI · Tenancy', value: '89' }] };
  await B.loadScoreHistory(d, { cliente: 'acme', ano: '2026', mes: '11', area: 'infracloud' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify([d.month, d.history])), ['2026-11', [{ label: 'OCI · Tenancy', mes: '2026-10', value: '80' }]]); ok('comparativo: busca a pontuação de outubro no book de outubro (ignora vazio e outros itens)');
  console.log(`\n${passed} testes do front ok`);
})().catch((e) => { console.error(e); process.exit(1); });
