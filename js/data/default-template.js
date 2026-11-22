/* ═══ Modelo padrão do Book Técnico ═══
   Reproduz a estrutura do book original (menus por cloud + operações).
   Tudo aqui é editável no app: menus, seções, blocos e colunas. */
(function (BT) {
  /** Monta dados de um bloco planilha. badges = índices das colunas com badge. */
  function table(cols, badges = [], rows = [], title = '') {
    return { type: 'table', data: { title, columns: cols.map((name, i) => ({ name, badge: badges.includes(i) })), rows: rows.length ? rows : [cols.map(() => '')], compact: false, note: '' } };
  }
  const text = (html = '', title = '') => ({ type: 'text', data: { title, html } });
  const images = (title = '') => ({ type: 'image', data: { title, images: [], layout: 'grid2' } });

  function providerGroup(key) {
    const p = BT.data.providers[key];
    const net = key === 'oci' ? 'VCN' : key === 'aws' ? 'VPC' : key === 'azure' ? 'VNet' : key === 'gcp' ? 'VPC Network' : 'Rede / Port Group';
    return {
      title: p.label === 'VMware' ? 'VMware / On-Prem' : p.label,
      icon: p.icon, separator: true, provider: key, subtitle: '', collapsed: key !== 'oci',
      sections: [
        { title: 'Servidores', icon: '🖥️', blocks: [table(['Hostname', 'IP', 'SO', 'Localização', 'Função', 'Status'], [5])] },
        { title: 'Networking', icon: '🌐', blocks: [table([net, 'CIDR', p.group]), images('Topologia de rede')] },
        { title: 'Segurança', icon: '🔒', blocks: [text('', 'Postura de segurança'), table(['Controle', 'Descrição', 'Status'], [2])] },
        { title: 'Storage', icon: '💾', blocks: [table(['Nome', 'Tipo', 'Capacidade', 'Utilizado', 'Status'], [4])] },
        { title: 'Backup', icon: '📦', blocks: [table(['Item', 'Situação', 'Ferramenta', 'Frequência', 'Retenção', 'Teste Restore'], [1, 5])] }
      ]
    };
  }

  BT.data.defaultTemplate = function () {
    const now = new Date();
    return {
      meta: {
        cliente: '', mes: String(now.getMonth() + 1).padStart(2, '0'), ano: String(now.getFullYear()),
        responsavel: '', time: 'infraCloud', subtitulo: 'Relatório Mensal de Infraestrutura e Operações',
        ambientes: '', logoCliente: '', mostrarSumario: false,
        governanca: { codigo: '', area: '', tipo: '', status: '', vigencia: '', classificacao: '', versao: '', paginas: '' }
      },
      groups: [
        {
          title: 'Book', icon: '📄', separator: false,
          sections: [
            { title: 'Objetivo', icon: '📋', blocks: [text('<p>Apresentar a visão técnica e operacional do ambiente do cliente, consolidando inventário, topologia, segurança, incidentes e recomendações técnicas.</p>')] },
            { title: 'Equipe', icon: '👥', blocks: [table(['Nome', 'Torre / Equipe', 'Função'])] },
            { title: 'Ferramentas', icon: '🔧', blocks: [table(['Categoria', 'Ferramenta(s)'])] }
          ]
        },
        {
          title: 'Visão Geral', icon: '🌐', separator: true, subtitle: 'Visão geral do ambiente',
          sections: [
            {
              title: 'Baseline Geral', icon: '🌐', blocks: [
                { type: 'kpi', data: { title: 'Servidores por ambiente', items: [{ label: 'OCI', value: '' }, { label: 'AWS', value: '' }, { label: 'Azure', value: '' }, { label: 'GCP', value: '' }, { label: 'On-Prem', value: '' }] } },
                table(['Ambiente', 'Categoria', 'Quantidade'], [], [], 'Baseline de recursos')
              ]
            }
          ]
        },
        providerGroup('oci'), providerGroup('aws'), providerGroup('azure'), providerGroup('gcp'), providerGroup('vmware'),
        {
          title: 'Storage Físico', icon: '🗄️', separator: true, collapsed: true,
          sections: [
            {
              title: 'SAN / NAS / On-Premises', icon: '🗄️', blocks: [
                table(['Storage', 'Host', 'IP', 'Garantia', 'Serial', 'Hw Issues'], [3], [], 'Equipamentos'),
                table(['Nome do Pool', 'Size (TB)', 'Free (TB)', 'Preallocated (GB)', 'Used (%)'], [], [], 'Pools'),
                table(['Tipo de Disco', 'Total', 'Em Uso', 'Hot Spare', 'Com Falha', 'Livres'], [], [], 'Discos'),
                table(['Nome', 'Tamanho (GB)', 'Usado (GB)', 'Pool / Uso', 'Tipo', 'Thin Prov.'], [], [], 'LUNs'),
                table(['Controller / SP', 'IP', 'Máscara', 'Gateway', 'VLAN', 'IQN'], [], [], 'iSCSI')
              ]
            }
          ]
        },
        {
          title: 'Operações', icon: '⚡', separator: true, subtitle: 'Monitoramento · Zabbix · Capacidade e Alertas', collapsed: true,
          sections: [
            { title: 'Incidentes', icon: '⚠️', blocks: [table(['Servidor', 'Descrição', 'Severidade', 'Status', 'Ação Tomada'], [2, 3])] },
            { title: 'Vulnerabilidades', icon: '🛡️', blocks: [table(['Sistema', 'Vulnerabilidade', 'CVSS', 'Status', 'Ação'], [3])] },
            { title: 'Capacidade', icon: '📊', blocks: [{ type: 'monitor', data: { title: '', origin: 'zabbix-capacity', z: null, resumo: '', show: {} } }, images('Gráficos de capacidade')] },
            { title: 'Monitoramento', icon: '📡', blocks: [table(['Host', 'IP', 'CPU média', 'Memória média', 'Maior disco', 'Alertas', 'Status'], [6])] },
            { title: 'Servidores — Recomendações', icon: '🖥️', blocks: [table(['Servidor', 'Recurso', 'Situação', 'Ação sugerida', 'Prioridade'], [4])] },
            { title: 'Melhorias', icon: '🚀', blocks: [table(['Prioridade', 'Área', 'Descrição', 'Responsável', 'Prazo'], [0])] },
            { title: 'Próximos Passos', icon: '📌', blocks: [table(['Prioridade', 'Ação / Compromisso', 'Responsável', 'Prazo', 'Status'], [0, 4])] }
          ]
        }
      ],
      ui: { route: 'cover' }
    };
  };

  BT.data.blankTemplate = function () {
    const t = BT.data.defaultTemplate();
    t.groups = [{ title: 'Book', icon: '📄', sections: [{ title: 'Introdução', icon: '📋', blocks: [] }] }];
    return t;
  };
})(window.BT);
