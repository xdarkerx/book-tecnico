/* ═══ Registro dos conectores de cloud ═══
 * Cada conector exporta: { label, test(cfg) → {ok,message}, pull(cfg, kinds) → [sheet] }
 * kinds: 'servers' | 'storage' | 'network' | 'baseline' | 'backup' (só os do período) | 'tenant' | 'score' | 'vulns'
 * opts: { from, to } período do book; newOnly = servidores/storage/redes só os criados no período (coluna "Criado em")
 * Os resultados têm colunas com os mesmos nomes dos exports das consoles,
 * então os mapeadores do front (js/import/mappers) funcionam igual a um CSV.
 */
const connectors = { oci: require('./oci'), aws: require('./aws'), azure: require('./azure'), gcp: require('./gcp'), zabbix: require('./zabbix'), glpi: require('./glpi'), wazuh: require('./wazuh'), defender: require('./defender') };
// monitoramento / chamados / vulnerabilidades: um único "tipo" de dado, com período
const TOOLS = ['zabbix', 'glpi', 'wazuh', 'defender'];
const ALL = ['servers', 'storage', 'network', 'baseline', 'backup', 'tenant', 'score', 'vulns'];
const NEW_ONLY = ['servers', 'storage', 'network']; // dá para trazer só o que foi criado no mês
// tenant = dados da conta/tenancy/assinatura; score = Cloud Security Score (Cloud Guard, Security Hub, Defender)
// vulns = CVEs do serviço de segurança de cada cloud (VSS, Inspector, Defender for Cloud, SCC)
const EXTRA = { tenant: 'tenant', score: 'score', vulns: 'vulns' };

module.exports = {
  list: () => Object.keys(connectors),
  async test(provider, cfg) {
    const c = connectors[provider];
    if (!c) return { ok: false, message: 'Provedor desconhecido.' };
    if (!cfg || cfg.enabled === false) return { ok: false, message: 'Conexão não configurada para este cliente.' };
    try { return Object.assign({ ok: true }, await c.test(cfg)); }
    catch (e) { return { ok: false, message: e.message }; }
  },
  async pull(provider, cfg, kinds, opts = {}) {
    const c = connectors[provider];
    if (!c) throw Object.assign(new Error('Provedor desconhecido.'), { status: 400 });
    if (!cfg || cfg.enabled === false) throw Object.assign(new Error(`Conexão ${provider.toUpperCase()} não configurada para este cliente.`), { status: 400 });
    if (TOOLS.includes(provider)) {
      try { return { provider, pulledAt: Date.now(), results: await c.pull(cfg, provider, opts), errors: [] }; }
      catch (e) { console.error(`[${provider}]`, e.message); return { provider, pulledAt: Date.now(), results: [], errors: [{ kind: provider, message: e.message }] }; }
    }
    const want = (kinds && kinds.length ? kinds : ALL).filter((k) => ALL.includes(k));
    const results = []; const errors = [];
    for (const kind of want) {
      try {
        if (EXTRA[kind]) {
          if (!c[EXTRA[kind]]) throw new Error(kind === 'score' ? 'Este provedor não tem um Security Score nativo pela API: preencha no bloco ou importe pelo ZIP (arquivo com "score" no nome).' : 'Informações de tenant indisponíveis para este provedor.');
          const got = await c[EXTRA[kind]](cfg);
          // avisos parciais (ex.: recomendações vieram, a pontuação não) vão para a lista de erros da tela
          got.filter((r) => r && r.kind === 'warning').forEach((w) => errors.push({ kind, message: w.message }));
          results.push(...got.filter((r) => !(r && r.kind === 'warning')));
        } else {
          const sheets = await c.pull(cfg, kind, opts);
          if (opts.newOnly && NEW_ONLY.includes(kind)) {
            // só os criados no período; quem não informa data de criação fica de fora (e a tela avisa)
            const from = opts.from || '0000', to = opts.to || '9999';
            for (const sh of sheets) {
              const before = sh.rows.length; let noDate = 0;
              sh.rows = sh.rows.filter((r) => { const d = String(r['Criado em'] || ''); if (!d) { noDate++; return false; } return d >= from && d <= to; });
              sh.name += ' — criados no período';
              if (noDate) errors.push({ kind, message: `${noDate} de ${before} item(ns) sem data de criação na API ficaram de fora (ex.: redes da AWS).` });
            }
          }
          results.push(...sheets);
        }
      }
      catch (e) { console.error(`[${provider}/${kind}]`, e.message); errors.push({ kind, message: e.message }); }
    }
    return { provider, pulledAt: Date.now(), results, errors };
  }
};
