/* ═══ Mapeador: inventário de servidores / VMs ═══
   Normaliza exports de OCI, AWS, Azure, GCP e VMware (inclui RVTools vInfo). */
(function (BT) {
  const C = BT.importer.mappers._common;

  const FIELD_MAP = {
    hostname: {
      azure: ['Name', 'VM Name', 'Virtual Machine', 'Resource Name', 'Computer Name'],
      oci: ['Display Name', 'Instance Name', 'VM Name', 'Hostname', 'resource_name'],
      aws: ['Name', 'Tag:Name', 'Instance Name', 'Instance ID', 'Private DNS Name'],
      vmware: ['VM', 'VM Name', 'Name', 'Virtual Machine', 'DNS Name', 'Hostname'],
      gcp: ['Name', 'Instance Name', 'Hostname'],
      _default: ['Name', 'VM Name', 'Display Name', 'Hostname', 'Host Name', 'Computer Name', 'Server Name', 'Instance Name', 'Resource Name', 'Node Name', 'Machine Name', 'Nome', 'Nome VM', 'Nome do Servidor']
    },
    ip: {
      azure: ['Private IP Address', 'Private IP Addresses', 'Private IP', 'IP Address', 'NIC IP'],
      oci: ['Private IP', 'Primary Private IP', 'IP Address', 'Private IP Address', 'Vnic IP'],
      aws: ['Private IP Address', 'Private IPv4 addresses', 'Private IP', 'Internal IP', 'Primary Private IP'],
      vmware: ['Primary IP Address', 'IP Address', 'Primary IP', 'Guest IP Address', 'IP Addresses'],
      gcp: ['Internal IP', 'Internal IP Address', 'Private IP', 'Network IP'],
      _default: ['Private IP', 'IP Address', 'Internal IP', 'IPv4', 'IP', 'Endereco IP', 'Endereço IP', 'IP Privado']
    },
    os: {
      azure: ['OS Name', 'Operating System', 'OS Type', 'Image', 'OS'],
      oci: ['Image', 'Operating System', 'OS', 'Base Image', 'Image OS'],
      aws: ['Platform Details', 'Platform', 'AMI Name', 'Operating System', 'OS'],
      vmware: ['OS according to the VMware Tools', 'OS according to the configuration file', 'Guest OS', 'Operating System', 'OS'],
      gcp: ['Operating System', 'OS', 'Image', 'Source Image'],
      _default: ['OS', 'Guest OS', 'Operating System', 'Image', 'Platform', 'Sistema Operacional', 'SO', 'OS Version', 'OS Name']
    },
    status: {
      azure: ['Power State', 'Status', 'Provisioning State', 'VM State'],
      oci: ['Lifecycle State', 'Status', 'State', 'lifecycle_state'],
      aws: ['Instance State', 'State', 'Status', 'State Name'],
      vmware: ['Powerstate', 'Power State', 'Status', 'VM State'],
      gcp: ['Status', 'State', 'VM Status'],
      _default: ['Power State', 'Lifecycle State', 'State', 'Status', 'VM State', 'Estado', 'Situação']
    },
    region: {
      azure: ['Location', 'Region', 'Azure Region'],
      oci: ['Region', 'region_name', 'Availability Domain', 'AD'],
      aws: ['Region', 'Availability Zone', 'AWS Region'],
      vmware: ['Datacenter', 'Cluster', 'Host', 'Location'],
      gcp: ['Zone', 'Region', 'Location'],
      _default: ['Location', 'Region', 'Zone', 'Datacenter', 'Availability Zone', 'Região', 'Local', 'Site']
    },
    group: {
      azure: ['Resource Group', 'Resource Group Name', 'ResourceGroup', 'RG'],
      oci: ['compartment_path', 'Compartment Path', 'Compartment', 'Compartment Name', 'compartment_name'],
      aws: ['VPC ID', 'VPC', 'Account ID', 'Account'],
      vmware: ['Cluster', 'Datacenter', 'Resource Pool', 'Folder'],
      gcp: ['Project', 'Project ID', 'Network'],
      _default: ['Resource Group', 'Compartment', 'Cluster', 'Project', 'VPC', 'Account', 'Subscription', 'Grupo', 'Projeto']
    },
    size: {
      azure: ['VM Size', 'Size', 'SKU'], oci: ['Shape', 'VM Shape'], aws: ['Instance Type', 'Type'],
      vmware: ['VM Size', 'Configuration'], gcp: ['Machine Type'],
      _default: ['VM Size', 'Shape', 'Instance Type', 'Machine Type', 'Size', 'SKU', 'Flavor', 'Tamanho']
    },
    cpu: {
      azure: ['Number of CPU Cores', 'vCPUs', 'CPU', 'Cores'], oci: ['OCPUs', 'OCPU Count', 'CPU Count', 'vCPUs'],
      aws: ['vCPUs', 'CPU', 'vCPU Count'], vmware: ['CPUs', 'Num CPU', 'CPU Count', 'Number of CPUs', 'vCPUs'], gcp: ['vCPUs', 'CPU'],
      _default: ['vCPUs', 'CPU Count', 'Number of CPUs', 'CPU', 'Cores', 'OCPUs', 'CPUs', 'Processadores']
    },
    ram: {
      azure: ['RAM (GiB)', 'Memory (GiB)', 'Memory GB', 'RAM'], oci: ['Memory (GB)', 'Memory in GBs', 'RAM (GB)'],
      aws: ['Memory (GiB)', 'RAM (GiB)', 'Memory'], vmware: ['Memory', 'Memory (MB)', 'Memory MB', 'RAM (MB)'], gcp: ['Memory (GB)', 'Memory'],
      _default: ['RAM (GiB)', 'Memory (GB)', 'Memory (MB)', 'RAM', 'Memory', 'Memória']
    },
    env: {
      azure: ['Environment', 'Tags', 'Tag-Environment'], oci: ['Defined Tags', 'Free-form Tags', 'Tags'],
      aws: ['Tag:Environment', 'Tag:Env', 'Environment', 'Tags'], vmware: ['Annotation', 'Notes', 'Description'], gcp: ['Labels'],
      _default: ['Environment', 'Env', 'Ambiente', 'Tags', 'Stage']
    }
  };

  function normalizeOS(v, p) {
    if (!v) return '';
    v = String(v).trim();
    if (p === 'aws' && /^windows$/i.test(v)) return 'Windows Server';
    if (p === 'aws' && /^linux(\/unix)?$/i.test(v)) return 'Linux';
    const oci = v.match(/Oracle-Linux-(\d+\.\d+)/i); if (oci) return 'Oracle Linux ' + oci[1];
    const rules = [
      [/windows.*server.*2025/i, 'Windows Server 2025'], [/windows.*server.*2022/i, 'Windows Server 2022'], [/windows.*server.*2019/i, 'Windows Server 2019'],
      [/windows.*server.*2016/i, 'Windows Server 2016'], [/windows.*server.*2012/i, 'Windows Server 2012 R2'], [/windows/i, 'Windows Server'],
      [/ubuntu.*24\.04/i, 'Ubuntu 24.04'], [/ubuntu.*22\.04/i, 'Ubuntu 22.04'], [/ubuntu.*20\.04/i, 'Ubuntu 20.04'], [/ubuntu.*18\.04/i, 'Ubuntu 18.04'], [/ubuntu/i, 'Ubuntu'],
      [/(red.?hat.*9|rhel.?9)/i, 'RHEL 9'], [/(red.?hat.*8|rhel.?8)/i, 'RHEL 8'], [/(red.?hat.*7|rhel.?7)/i, 'RHEL 7'], [/red.?hat|rhel/i, 'RHEL'],
      [/oracle.?linux.*9|ol9/i, 'Oracle Linux 9'], [/oracle.?linux.*8|ol8/i, 'Oracle Linux 8'], [/oracle.?linux.*7|ol7/i, 'Oracle Linux 7'], [/oracle.?linux/i, 'Oracle Linux'],
      [/centos.*7/i, 'CentOS 7'], [/centos/i, 'CentOS'], [/debian.*12/i, 'Debian 12'], [/debian.*11/i, 'Debian 11'], [/debian/i, 'Debian'],
      [/suse|sles/i, 'SUSE Linux'], [/amazon.?linux.*2023/i, 'Amazon Linux 2023'], [/amazon.?linux.*2/i, 'Amazon Linux 2'], [/amazon.?linux/i, 'Amazon Linux']
    ];
    for (const [re, out] of rules) if (re.test(v)) return out;
    return v.length > 35 ? v.slice(0, 35) + '…' : v;
  }

  const AZ = { eastus: 'East US', eastus2: 'East US 2', westus: 'West US', westus2: 'West US 2', centralus: 'Central US', northeurope: 'North Europe', westeurope: 'West Europe', brazilsouth: 'Brazil South', brazilsoutheast: 'Brazil Southeast', eastasia: 'East Asia', southeastasia: 'Southeast Asia', southcentralus: 'South Central US', northcentralus: 'North Central US', uksouth: 'UK South', canadacentral: 'Canada Central' };
  const AWS = { 'us-east-1': 'US East (N. Virginia)', 'us-east-2': 'US East (Ohio)', 'us-west-1': 'US West (N. California)', 'us-west-2': 'US West (Oregon)', 'sa-east-1': 'South America (São Paulo)', 'eu-west-1': 'Europe (Ireland)', 'eu-central-1': 'Europe (Frankfurt)' };
  function normalizeLocation(v, p) {
    if (!v) return '';
    v = String(v).trim();
    if (p === 'azure') return 'Azure – ' + (AZ[v.toLowerCase().replace(/\s/g, '')] || v);
    if (p === 'oci') { const m = v.match(/^([\w]+-[\w]+-\d+)/); return 'OCI – ' + (m ? m[1] : v); }
    if (p === 'aws') { const base = v.replace(/[a-z]$/, ''); return 'AWS – ' + (AWS[base] || AWS[v] || v); }
    if (p === 'gcp') return 'GCP – ' + v.replace(/-[a-z]$/, '');
    return v;
  }
  function normalizeStatus(v) {
    if (!v) return 'Ativo';
    v = String(v).toLowerCase();
    if (/running|poweredon|started|ativo|active|available/.test(v)) return 'Ativo';
    if (/stopped|deallocated|poweredoff|desligado|shutoff/.test(v)) return 'Desligado';
    if (/terminated|deleted|inativo|terminating/.test(v)) return 'Inativo';
    if (/suspended|maintenance|paused/.test(v)) return 'Manutenção';
    return 'Ativo';
  }
  /** Quebra nomes em tokens: "srv-web01.prod" → ["srv","web","prod"] (sem \b, que falha em "web01"). */
  const tokens = (s) => String(s || '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const hasAny = (toks, words) => words.some((w) => toks.includes(w));
  function inferRole(all) {
    const t = tokens(all);
    const txt = String(all || '').toLowerCase();
    // ordem importa: o primeiro que casar vence. Sem pista no nome, fica em branco (melhor do que um palpite errado).
    const rules = [
      [['fw', 'firewall', 'fortigate', 'fortinet', 'paloalto', 'pfsense', 'opnsense', 'checkpoint', 'sophos', 'asa', 'waf'], /palo.?alto|check.?point/, 'Firewall'],
      [['dc', 'adds', 'ldap', 'domain', 'activedirectory'], /active.?directory|domain.?controller/, 'Active Directory'],
      [['jump', 'bastion', 'jumpbox', 'jumpserver'], null, 'Jump / Bastion'],
      [['vpn', 'gateway', 'gw', 'proxy', 'nat', 'lb', 'loadbalancer', 'haproxy', 'f5'], /load.?balancer/, 'Rede / Gateway'],
      [['oke', 'k8s', 'kube', 'kubernetes', 'aks', 'eks', 'gke', 'wk', 'worker', 'master', 'rancher', 'openshift'], null, 'Kubernetes'],
      [['db', 'sql', 'mysql', 'oracle', 'ora', 'postgres', 'pg', 'mongo', 'mongodb', 'mariadb', 'rds', 'database', 'banco', 'bd', 'redis', 'exadata'], null, 'Banco de Dados'],
      [['web', 'iis', 'apache', 'nginx', 'httpd', 'portal', 'front', 'frontend', 'www'], null, 'Web Server'],
      [['app', 'api', 'jboss', 'tomcat', 'weblogic', 'wildfly', 'middleware', 'mw', 'srvapp', 'java', 'backend'], null, 'Aplicação'],
      [['backup', 'bkp', 'veeam', 'bacula', 'commvault'], null, 'Backup'],
      [['zabbix', 'grafana', 'prometheus', 'monitor', 'nagios', 'mon', 'elk', 'kibana', 'splunk'], null, 'Monitoramento'],
      [['file', 'fs', 'nfs', 'smb', 'nas', 'ftp', 'sftp', 'share', 'shares'], null, 'File Server'],
      [['dns', 'dhcp', 'ntp'], null, 'Infraestrutura'],
      [['ad'], null, 'Active Directory'] // "ad" sozinho é ambíguo: só vale se nada acima casou (ex.: FW-AD1 é firewall)
    ];
    for (const [words, re, out] of rules) if (hasAny(t, words) || (re && re.test(txt))) return out;
    return '';
  }
  function inferEnv(all) {
    const t = tokens(all);
    if (hasAny(t, ['dr', 'disaster'])) return 'DR';
    if (hasAny(t, ['hml', 'homolog', 'homologacao', 'staging', 'stg', 'uat'])) return 'Homologação';
    if (hasAny(t, ['dev', 'develop', 'desenv', 'test', 'tst', 'qa'])) return 'Desenvolvimento';
    return 'Produção';
  }

  BT.importer.mappers.servers = {
    key: 'servers', label: 'Servidores / VMs', icon: '🖥️', order: 1,
    desc: 'Hostname, IP, SO, localização, função e status normalizados',
    section: 'Servidores',
    columns: [
      { key: 'hostname', name: 'Hostname', on: true }, { key: 'ip', name: 'IP', on: true }, { key: 'os', name: 'SO', on: true },
      { key: 'location', name: 'Localização', on: true }, { key: 'role', name: 'Função', on: true }, { key: 'status', name: 'Status', on: true, badge: true },
      { key: 'specs', name: 'Specs', on: false }, { key: 'env', name: 'Ambiente', on: false }, { key: 'group', name: 'Grupo', on: false }
    ],
    /** RVTools: usa a aba vInfo quando existir. */
    pickSheet(sheets) { return sheets.findIndex((s) => /^vinfo$/i.test(s.name)); },
    map(sheet, provider) {
      const R = C.resolver(FIELD_MAP, sheet.fields, provider);
      return sheet.rows.filter((row) => !/^(true|sim)$/i.test(String(row.Template || ''))).map((row) => {
        let hostname = R.get(row, 'hostname');
        if (!hostname) { const v = Object.values(row).find((x) => x && !/^[\d.,\s%]+$/.test(String(x))); hostname = v ? String(v).slice(0, 60) : ''; }
        const group = R.get(row, 'group');
        let loc = R.get(row, 'region');
        if (provider === 'vmware') loc = [R.get(row, 'region'), group].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' / ');
        const cpu = R.get(row, 'cpu'), ram = R.get(row, 'ram'), size = R.get(row, 'size');
        const specs = [];
        if (size) specs.push(size);
        if (cpu) specs.push(cpu + (provider === 'oci' ? ' OCPU' : ' vCPU'));
        if (ram) { const n = parseFloat(String(ram).replace(',', '.')); if (!isNaN(n)) specs.push((n > 512 ? Math.round(n / 1024) : n) + ' GB RAM'); }
        const envRaw = R.get(row, 'env');
        return {
          hostname, ip: R.get(row, 'ip').split(/[,;\s]+/)[0], os: normalizeOS(R.get(row, 'os'), provider),
          location: normalizeLocation(loc, provider), role: inferRole(`${hostname} ${envRaw}`),
          status: normalizeStatus(R.get(row, 'status')), specs: specs.join(' / '),
          env: inferEnv(`${hostname} ${envRaw} ${group}`), group
        };
      }).filter((r) => r.hostname);
    },
    summary(items) {
      const ativos = items.filter((i) => i.status === 'Ativo').length;
      const win = items.filter((i) => /windows/i.test(i.os)).length;
      const lin = items.filter((i) => i.os && !/windows/i.test(i.os)).length;
      return [{ label: 'Servidores', value: String(items.length) }, { label: 'Ativos', value: String(ativos) }, { label: 'Desligados', value: String(items.length - ativos) }, { label: 'Windows', value: String(win) }, { label: 'Linux / outros', value: String(lin) }];
    },
    FIELD_MAP
  };
})(window.BT);
