/* ═══ Mapeador: storage (buckets, volumes, storage accounts, discos) ═══ */
(function (BT) {
  const C = BT.importer.mappers._common;
  const FIELD_MAP = {
    name: { azure: ['Name', 'Storage Account Name', 'Account Name', 'Resource Name'], oci: ['resource_name', 'Display Name', 'Bucket Name', 'Volume Name', 'Name'], aws: ['Name', 'Bucket Name', 'Volume ID', 'Resource Name'], _default: ['Name', 'Display Name', 'Bucket Name', 'Account Name', 'Volume Name', 'Datastore', 'Resource', 'Nome'] },
    type: { azure: ['Kind', 'Type', 'SKU', 'Account Kind', 'Replication'], oci: ['resource_type', 'Volume Type', 'Storage Tier', 'Tier'], aws: ['Storage Class', 'Volume Type', 'Type'], _default: ['Type', 'Kind', 'Storage Class', 'Volume Type', 'Tier', 'Tipo'] },
    capacity: { azure: ['Capacity (GiB)', 'Size (GiB)', 'Disk Size', 'Size', 'Capacity'], oci: ['resource_info', 'Size in GBs', 'Size (GB)', 'Total Size'], aws: ['Size', 'Size (GiB)', 'Total Size (Bytes)', 'Bucket Size'], vmware: ['Capacity MiB', 'Capacity'], _default: ['Capacity', 'Size', 'Total Size', 'Tamanho', 'Capacidade'] },
    used: { azure: ['Used Capacity (GiB)', 'Used', 'Current Usage'], oci: ['Used (GB)', 'Used Capacity'], aws: ['Used', 'Used Size'], vmware: ['In Use MiB', 'Provisioned MiB'], _default: ['Used', 'Used Capacity', 'Current Usage', 'Utilizado', 'In Use'] },
    region: { azure: ['Location', 'Region', 'Primary Location'], oci: ['Region', 'region_name', 'Availability Domain'], aws: ['Region', 'Location', 'Bucket Region'], _default: ['Location', 'Region', 'Zone', 'Datacenter'] },
    group: { azure: ['Resource Group', 'Resource Group Name'], oci: ['compartment_path', 'Compartment', 'Compartment Name', 'compartment_name'], aws: ['Account ID', 'Owner'], _default: ['Resource Group', 'Compartment', 'Account', 'Cluster', 'Grupo'] },
    status: { azure: ['Status', 'Provisioning State', 'State'], oci: ['Lifecycle State', 'lifecycle_state', 'Status'], aws: ['State', 'Status'], _default: ['Status', 'State', 'Lifecycle State', 'Accessible'] }
  };

  function capacity(v, provider) {
    if (!v) return '';
    v = String(v).trim();
    const sm = v.match(/^size:([\d.]+)$/i);
    if (sm) { const n = parseFloat(sm[1]); return n < 1 ? (n * 1024).toFixed(0) + ' MB' : n.toFixed(1) + ' GB'; }
    const n = parseFloat(v.replace(/[^0-9.]/g, ''));
    if (isNaN(n)) return v;
    if (provider === 'vmware' || /mib/i.test(v)) return (n / 1024).toFixed(0) + ' GB';
    if (/tib|tb/i.test(v)) return n + ' TB';
    if (/gib|gb/i.test(v)) return n.toFixed(0) + ' GB';
    if (/mb/i.test(v)) return (n / 1024).toFixed(1) + ' GB';
    if (n > 1e6) return (n / 1e9).toFixed(1) + ' GB';
    return n + ' GB';
  }
  function status(v) {
    if (!v) return 'Ativo';
    v = String(v).toLowerCase();
    if (/avail|active|succeeded|ok|true|attached|in-use|running/.test(v)) return 'Ativo';
    if (/fail|error|false/.test(v)) return 'Crítico';
    if (/delet|terminat/.test(v)) return 'Inativo';
    return v.charAt(0).toUpperCase() + v.slice(1);
  }

  BT.importer.mappers.storage = {
    key: 'storage', label: 'Storage', icon: '💾', order: 2,
    desc: 'Buckets, volumes, discos, storage accounts, datastores',
    section: 'Storage',
    columns: [
      { key: 'name', name: 'Nome', on: true }, { key: 'type', name: 'Tipo', on: true }, { key: 'capacity', name: 'Capacidade', on: true },
      { key: 'used', name: 'Utilizado', on: true }, { key: 'status', name: 'Status', on: true, badge: true },
      { key: 'region', name: 'Região', on: false }, { key: 'group', name: 'Grupo', on: false }
    ],
    pickSheet(sheets) { return sheets.findIndex((s) => /^vdatastore$/i.test(s.name)); },
    map(sheet, provider) {
      const R = C.resolver(FIELD_MAP, sheet.fields, provider);
      return sheet.rows.map((row) => ({
        name: R.get(row, 'name'), type: R.get(row, 'type').replace(/^.*\./, ''),
        capacity: capacity(R.get(row, 'capacity'), provider), used: capacity(R.get(row, 'used'), provider),
        status: status(R.get(row, 'status')), region: R.get(row, 'region'), group: R.get(row, 'group')
      })).filter((r) => r.name);
    },
    summary(items) {
      const C2 = C.countBy(items, 'type').slice(0, 3);
      return [{ label: 'Recursos de storage', value: String(items.length) }, ...C2.map(([k, v]) => ({ label: k, value: String(v) }))];
    }
  };
})(window.BT);
