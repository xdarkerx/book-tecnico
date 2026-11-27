/* ═══ Mapeador: baseline de recursos (contagem por tipo) ═══
   OCI "resource_type", Azure "All resources" (TYPE), ou qualquer coluna de tipo. */
(function (BT) {
  const OCI = { 'Compute Instance': 'Servidores', 'Instance': 'Servidores', 'Compute Volume': 'Block Volumes', 'Volume': 'Block Volumes', 'Compute Boot Volume': 'Boot Volumes', 'BootVolume': 'Boot Volumes', 'Object Storage': 'Object Storage', 'Bucket': 'Object Storage', 'DB System': 'DB Systems', 'DbSystem': 'DB Systems', 'Autonomous Database': 'Autonomous DB', 'Load Balancer': 'Load Balancers', 'LoadBalancer': 'Load Balancers', 'Network Load Balancer': 'Load Balancers', 'File Storage': 'File Storage', 'FileSystem': 'File Storage', 'OKE Container': 'Kubernetes (OKE)', 'Cluster': 'Kubernetes (OKE)', 'Bastion': 'Bastion', 'WAF': 'WAF', 'KMS Vault': 'KMS Vault', 'Vault': 'KMS Vault', 'Vcn': 'VCNs', 'VCN': 'VCNs', 'Subnet': 'Subnets', 'OAC': 'Analytics (OAC)' };
  const AZURE = { 'Virtual machine': 'Servidores', 'microsoft.compute/virtualmachines': 'Servidores', 'Disk': 'Discos Gerenciados', 'microsoft.compute/disks': 'Discos Gerenciados', 'Storage account': 'Storage Accounts', 'microsoft.storage/storageaccounts': 'Storage Accounts', 'SQL database': 'SQL Databases', 'SQL server': 'SQL Servers', 'Load balancer': 'Load Balancers', 'Virtual network': 'VNets', 'microsoft.network/virtualnetworks': 'VNets', 'Network security group': 'NSGs', 'Public IP address': 'IPs Públicos', 'App Service': 'App Services', 'App Service plan': 'App Service Plans', 'Network Interface': 'Network Interfaces', 'DNS zone': 'DNS Zones', 'Recovery Services vault': 'Recovery Vaults', 'Application Insights': 'App Insights', 'Snapshot': 'Snapshots', 'Key vault': 'Key Vaults' };
  const OTHERS = { 'EC2 Instance': 'Servidores', 'EBS Volume': 'Block Volumes', 'EBS Snapshot': 'Snapshots', 'VPC': 'VPCs', 'Subnet': 'Subnets', 'Security Group': 'Security Groups', 'S3 Bucket': 'Object Storage',
    'Persistent Disk': 'Discos', 'VPC Network': 'Redes VPC', 'Cloud Storage Bucket': 'Object Storage',
    'microsoft.network/networksecuritygroups': 'NSGs', 'microsoft.network/publicipaddresses': 'IPs Públicos', 'microsoft.network/networkinterfaces': 'Network Interfaces', 'microsoft.network/loadbalancers': 'Load Balancers',
    'microsoft.sql/servers': 'SQL Servers', 'microsoft.sql/servers/databases': 'SQL Databases', 'microsoft.web/sites': 'App Services', 'microsoft.web/serverfarms': 'App Service Plans',
    'microsoft.recoveryservices/vaults': 'Recovery Vaults', 'microsoft.keyvault/vaults': 'Key Vaults', 'microsoft.compute/snapshots': 'Snapshots', 'microsoft.network/dnszones': 'DNS Zones',
    'BootVolume': 'Boot Volumes', 'NetworkSecurityGroup': 'NSGs', 'SecurityList': 'Security Lists', 'AutonomousDatabase': 'Autonomous DB', 'PublicIp': 'IPs Públicos', 'Drg': 'DRGs', 'VolumeBackup': 'Backups de volume' };
  // vCenter e Oracle VM (sincronização): mesmas categorias do Baseline Geral
  const ONPREM = { 'Virtual Machine': 'Servidores', 'Host ESXi': 'Hosts ESXi', 'Cluster': 'Clusters', 'Datacenter': 'Datacenters', 'Oracle VM Server': 'Servidores OVS', 'Server Pool': 'Server Pools' };
  const KNOWN = Object.assign({}, OCI, AZURE, OTHERS, ONPREM);

  function typeColumn(fields) {
    const pri = ['resource_type', 'Resource Type', 'TYPE', 'Type', 'ResourceType', 'Tipo', 'Kind', 'Service'];
    for (const p of pri) { const f = fields.find((x) => x.toLowerCase() === p.toLowerCase()); if (f) return f; }
    return fields.find((x) => /type|tipo/i.test(x));
  }

  BT.importer.mappers.baseline = {
    key: 'baseline', label: 'Baseline (contagem)', icon: '📦', order: 4,
    desc: 'Agrupa todos os recursos por tipo e conta — ideal para o "Baseline Geral"',
    section: 'Baseline Geral', inSourceGroup: false,
    columns: [{ key: 'ambiente', name: 'Ambiente', on: true }, { key: 'categoria', name: 'Categoria', on: true }, { key: 'qtd', name: 'Quantidade', on: true }],
    map(sheet, provider, file) {
      const label = BT.data.providers[provider]?.label || 'Ambiente';
      // RVTools: conta VMs/hosts/datastores pelas abas
      if (file && file.sheets.some((s) => /^vinfo$/i.test(s.name))) {
        const get = (n) => file.sheets.find((s) => s.name.toLowerCase() === n);
        const vi = get('vinfo'), vh = get('vhost'), vd = get('vdatastore');
        const out = [];
        if (vi) {
          const vms = vi.rows.filter((r) => !/^(true)$/i.test(String(r.Template || '')));
          const on = vms.filter((r) => /on/i.test(r.Powerstate || r['Power State'] || '')).length;
          out.push({ categoria: 'VMs ligadas', qtd: on, _known: true }, { categoria: 'VMs desligadas', qtd: vms.length - on, _known: true });
        }
        if (vh) out.push({ categoria: 'Hosts ESXi', qtd: vh.rows.length, _known: true });
        if (vd) out.push({ categoria: 'Datastores', qtd: vd.rows.length, _known: true });
        return out.map((o) => Object.assign(o, { ambiente: 'VMware', qtd: String(o.qtd) }));
      }
      const tcol = typeColumn(sheet.fields);
      if (!tcol) return [];
      const counts = {};
      sheet.rows.forEach((r) => {
        const raw = String(r[tcol] || '').trim(); if (!raw) return;
        const cat = KNOWN[raw] || KNOWN[raw.toLowerCase()] || null;
        const key = cat || raw;
        counts[key] = counts[key] || { categoria: key, qtd: 0, _known: !!cat };
        counts[key].qtd++;
      });
      return Object.values(counts).sort((a, b) => (b._known - a._known) || (b.qtd - a.qtd)).map((o) => Object.assign(o, { ambiente: label, qtd: String(o.qtd) }));
    },
    /** Tipos não reconhecidos começam desmarcados. */
    defaultSelected: (item) => item._known !== false,
    summary(items) {
      const total = items.reduce((s, i) => s + (parseInt(i.qtd) || 0), 0);
      return [{ label: 'Recursos', value: String(total) }, ...items.slice(0, 4).map((i) => ({ label: i.categoria, value: i.qtd }))];
    }
  };
})(window.BT);
