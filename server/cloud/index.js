/* ═══ Registro dos conectores de cloud ═══
 * Cada conector exporta: { label, test(cfg) → {ok,message}, pull(cfg, kinds) → [sheet] }
 * kinds: 'servers' | 'storage' | 'network' | 'baseline'
 * Os resultados têm colunas com os mesmos nomes dos exports das consoles,
 * então os mapeadores do front (js/import/mappers) funcionam igual a um CSV.
 */
const connectors = { oci: require('./oci'), aws: require('./aws'), azure: require('./azure'), gcp: require('./gcp'), zabbix: require('./zabbix'), glpi: require('./glpi') };
const TOOLS = ['zabbix', 'glpi']; // monitoramento / chamados: um único "tipo" de dado, com período
const ALL = ['servers', 'storage', 'network', 'baseline'];

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
      try { results.push(...(await c.pull(cfg, kind))); }
      catch (e) { console.error(`[${provider}/${kind}]`, e.message); errors.push({ kind, message: e.message }); }
    }
    return { provider, pulledAt: Date.now(), results, errors };
  }
};
