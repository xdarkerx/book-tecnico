/* ═══ Topologia de rede: modelo comum às clouds (desenhado pelo bloco "topology" do front) ═══
 * networks: [{ id, name, cidr, group, region, subnets: [{ name, cidr, public }], gateways: [{ type, name }] }]
 * hubs:     [{ id, type, name, region }]           (DRG, Transit Gateway…)
 * links:    [{ a, b, type, label }]                 type: attach | peering | internet | vpn | dedicated;  a/b = id, 'internet' ou 'onprem'
 */
function model() {
  const m = { networks: [], hubs: [], links: [] };
  const seen = new Set();
  m.link = (a, b, type, label = '') => {
    if (!a || !b || a === b) return;
    const k = type + '|' + [a, b].sort().join('|') + '|' + label;
    if (seen.has(k)) return; seen.add(k);
    m.links.push({ a, b, type, label });
  };
  m.net = (id) => m.networks.find((n) => n.id === id);
  m.hub = (id, type, name, region) => { if (!m.hubs.some((x) => x.id === id)) m.hubs.push({ id, type, name: name || id, region: region || '' }); };
  return m;
}
/** Resultado no formato das planilhas (sem linhas), com o modelo no campo "topology". */
function sheet(name, m) {
  const out = { networks: m.networks, hubs: m.hubs, links: m.links };
  return { kind: 'topology', name, fields: [], rows: [], topology: out };
}
module.exports = { model, sheet };
