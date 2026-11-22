/* ═══ Mapeador: redes (VCN / VPC / VNet / Port Groups) ═══ */
(function (BT) {
  const C = BT.importer.mappers._common;
  const FIELD_MAP = {
    name: { _default: ['name', 'vcn name', 'display name', 'resource_name', 'nome', 'vpc id', 'vpc name', 'vnet name', 'virtual network name', 'network', 'network name', 'portgroup', 'port group'] },
    cidr: { _default: ['cidrs', 'cidr', 'cidr block', 'cidr_block', 'ipv4 cidr block', 'address space', 'address prefix', 'address prefixes', 'subnetwork ranges', 'ip range', 'vlan'] },
    group: { _default: ['compartment_path', 'compartment path', 'compartment name', 'compartment', 'resource group', 'resource group name', 'account id', 'account', 'owner', 'project', 'project id', 'datacenter', 'cluster', 'switch'] },
    subnets: { _default: ['subnets', 'subnet names', 'subnet', 'subnet id'] },
    gateways: { _default: ['internet_gateway', 'internet gateway', 'igw', 'nat', 'nat gateway', 'drg', 'vpn gateway', 'transit gateway', 'service gateway'] },
    region: { _default: ['region', 'location', 'region_name', 'zone'] }
  };
  BT.importer.mappers.network = {
    key: 'network', label: 'Redes', icon: '🌐', order: 3,
    desc: 'VCN, VPC, VNet, port groups e seus CIDRs',
    section: 'Networking',
    columns: [
      { key: 'name', name: 'Rede', on: true }, { key: 'cidr', name: 'CIDR', on: true }, { key: 'group', name: 'Compartimento / Grupo', on: true },
      { key: 'subnets', name: 'Subnets', on: false }, { key: 'gateways', name: 'Gateways', on: false }, { key: 'region', name: 'Região', on: false }
    ],
    pickSheet(sheets) { return sheets.findIndex((s) => /^vnetwork$|^vport$/i.test(s.name)); },
    map(sheet, provider) {
      const R = C.resolver(FIELD_MAP, sheet.fields, provider);
      const gwCols = R.columns.gateways;
      return sheet.rows.map((row) => ({
        name: R.get(row, 'name'), cidr: R.get(row, 'cidr'), group: R.get(row, 'group'), subnets: R.get(row, 'subnets'), region: R.get(row, 'region'),
        gateways: gwCols.filter((c) => row[c] && String(row[c]) !== 'NaN' && !/^(false|no|não)$/i.test(row[c])).map((c) => c.replace(/_/g, ' ')).join(', ')
      })).filter((r) => r.name);
    },
    summary(items) { return [{ label: 'Redes', value: String(items.length) }, { label: 'Grupos', value: String(new Set(items.map((i) => i.group)).size) }]; }
  };
})(window.BT);
