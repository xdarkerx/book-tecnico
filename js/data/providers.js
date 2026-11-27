/* ═══ Provedores de cloud suportados ═══ */
(function (BT) {
  BT.data.providers = {
    oci:     { key: 'oci',     label: 'OCI',        display: 'Oracle Cloud Infrastructure', icon: '☁️', group: 'Compartimento', color: '#322490' },
    aws:     { key: 'aws',     label: 'AWS',        display: 'Amazon Web Services',         icon: '🔶', group: 'VPC / Conta',   color: '#86D2EF' },
    azure:   { key: 'azure',   label: 'Azure',      display: 'Microsoft Azure',             icon: '⚡', group: 'Resource Group', color: '#5E3FE1' },
    gcp:     { key: 'gcp',     label: 'GCP',        display: 'Google Cloud Platform',       icon: '🌐', group: 'Projeto',        color: '#B7BCD1' },
    vmware:  { key: 'vmware',  label: 'VMware',     display: 'VMware / On-Premises',        icon: '🖥️', group: 'Cluster / Datacenter', color: '#8D92A7' },
    ovm:     { key: 'ovm',     label: 'Oracle VM',  display: 'Oracle VM / On-Premises',     icon: '🟥', group: 'Server Pool',    color: '#c74634' },
    generic: { key: 'generic', label: 'Genérico',   display: 'On-Premise / Outros',         icon: '🏢', group: 'Grupo',          color: '#5E3FE1' },
    // ferramentas (não são clouds): monitoramento e chamados
    zabbix:  { key: 'zabbix',  label: 'Zabbix',     display: 'Zabbix (monitoramento)',      icon: '📡', group: 'Host group',     color: '#d40000', tool: true },
    glpi:    { key: 'glpi',    label: 'GLPI',       display: 'GLPI (chamados)',             icon: '🎫', group: 'Entidade',       color: '#f0b429', tool: true },
    // vulnerabilidades (CVEs) dos servidores
    wazuh:   { key: 'wazuh',   label: 'Wazuh',      display: 'Wazuh (vulnerabilidades)',    icon: '🐺', group: 'Grupo de agentes', color: '#3595f2', tool: true },
    defender: { key: 'defender', label: 'Defender', display: 'Microsoft Defender for Endpoint (vulnerabilidades)', icon: '🛡️', group: 'Grupo de dispositivos', color: '#0078d4', tool: true }
  };
  BT.data.toolList = ['zabbix', 'glpi', 'wazuh', 'defender'];
  BT.data.providerList = ['oci', 'aws', 'azure', 'gcp', 'vmware', 'ovm', 'generic'];
  BT.data.ICONS = ['📄','📋','👥','🔧','🌐','🖥️','🔒','💾','📦','🗄️','⚠️','📡','🚀','📌','☁️','🔶','⚡','🏢','📊','📈','🧩','🛡️','🔑','🧪','🗂️','📁','🧭','🕒','✅','❗','💡','🛠️','🔗','🧱','📝','🏷️'];
})(window.BT);
