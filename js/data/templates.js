/* ═══ Templates de book ═══
 * Embutidos: InfraCloud (completo), Network, Backup, Em branco.
 * Personalizados: "Arquivo › Salvar como template" (ficam no servidor ou no navegador).
 * Para criar um novo template embutido, adicione uma entrada em BUILTIN com build() → estado.
 */
(function (BT) {
  const t = (cols, badges = [], title = '') => ({ type: 'table', data: { title, columns: cols.map((name, i) => ({ name, badge: badges.includes(i) })), rows: [cols.map(() => '')], compact: false, note: '' } });
  const text = (html = '', title = '') => ({ type: 'text', data: { title, html } });
  const img = (title = '') => ({ type: 'image', data: { title, images: [], layout: 'full' } });
  const kpi = (labels, title = '') => ({ type: 'kpi', data: { title, items: labels.map((label) => ({ label, value: '' })) } });
  const meta = () => BT.data.defaultTemplate().meta;
  const book = (objetivo) => ({
    title: 'Book', icon: '📄', separator: false, sections: [
      { title: 'Objetivo', icon: '📋', blocks: [text(objetivo)] },
      { title: 'Equipe', icon: '👥', blocks: [t(['Nome', 'Torre / Equipe', 'Função'])] },
      { title: 'Ferramentas', icon: '🔧', blocks: [t(['Categoria', 'Ferramenta(s)'])] }
    ]
  });
  const imgs = (title = '') => ({ type: 'image', data: { title, images: [], layout: 'grid2' } });
  const NET = { oci: 'VCN', aws: 'VPC', azure: 'VNet', gcp: 'VPC Network' };
  const CLOUDS = ['oci', 'aws', 'azure', 'gcp'];
  // Menu de cada cloud no mesmo formato do InfraCloud (a sincronização preenche as seções de mesmo nome)
  const cloudGroup = (p, sections) => {
    const P = BT.data.providers[p];
    return { title: P.label, icon: P.icon, separator: true, provider: p, subtitle: '', collapsed: p !== 'oci', sections: sections(P) };
  };

  // Estrutura dos books de Network: escopo e baseline dos equipamentos, capacity, rotina de backup, serviços,
  // endereçamento IP, links de internet, VPNs e melhorias. Mesmo formato do InfraCloud.
  function network() {
    return {
      meta: { ...meta(), time: 'Network', subtitulo: 'Relatório Mensal de Redes' }, ui: { route: 'cover' },
      groups: [
        book('<p>Fornecer uma visão detalhada da infraestrutura de rede do cliente, abordando topologia, configurações, segurança, gerenciamento e manutenção. A documentação visa garantir a padronização e facilitar futuras atualizações, suporte e expansão.</p>'),
        {
          title: 'Visão Geral', icon: '🌐', separator: true, subtitle: 'Escopo e baseline da rede', sections: [
            { title: 'Escopo', icon: '🎯', blocks: [text('<p>Este documento apresenta as informações dos ambientes de rede do cliente.</p>'), img('Topologia de rede')] },
            { title: 'Baseline completo', icon: '🧾', blocks: [t(['Categoria', 'Equipamento', 'Ambiente', 'Fabricante', 'Modelo', 'Versão', 'Monitoria'], [6])] },
            { title: 'Levantamento de datas', icon: '📅', blocks: [t(['Equipamento', 'Ambiente', 'Modelo', 'Licenciamento', 'End of Support', 'End of Life'])] }
          ]
        },
        {
          title: 'Equipamentos', icon: '🧰', separator: true, subtitle: 'Capacity, rotinas e serviços', sections: [
            { title: 'Recursos e capacity', icon: '📊', blocks: [kpi(['Memória', 'CPU', 'Swap']), imgs('Gráficos de CPU e memória')] },
            { title: 'Rotina de backup', icon: '💾', blocks: [text('<p>Os equipamentos possuem rotinas automáticas configuradas pelo administrador. As rotinas seguem os seguintes padrões:</p>'), t(['Horário', 'Descrição'])] },
            { title: 'Serviços', icon: '🛰️', blocks: [t(['Serviço', 'Servidor', 'Criticidade', 'Responsável', 'Monitorado', 'Observações'], [2, 4])] }
          ]
        },
        {
          title: 'Conectividade', icon: '🔗', separator: true, subtitle: 'Endereçamento, links e VPNs', sections: [
            { title: 'Endereçamento IP', icon: '🔢', blocks: [text('<p>O endereçamento IP da rede é documentado para garantir organização, controle e facilidade na administração dos dispositivos conectados.</p>'), t(['Interface / VLAN', 'Nome', 'Faixa de IP', 'Localidade', 'Finalidade'])] },
            { title: 'Links de Internet', icon: '🌍', blocks: [t(['Localidade', 'Operadora', 'Velocidade', 'Endereçamento IP', 'Interface conectada'])] },
            { title: 'VPN Site-to-Site', icon: '🔐', blocks: [t(['Localidade', 'Nome', 'Interface', 'Descrição'])] }
          ]
        },
        ...CLOUDS.map((p) => cloudGroup(p, (P) => [
          { title: 'Networking', icon: '🌐', blocks: [t([NET[p], 'CIDR', P.group]), imgs('Topologia de rede')] }
        ])),
        {
          title: 'Operações', icon: '⚡', separator: true, subtitle: 'Incidentes, melhorias e próximos passos', collapsed: true, sections: [
            { title: 'Incidentes', icon: '⚠️', blocks: [t(['Equipamento', 'Descrição', 'Severidade', 'Status', 'Ação Tomada'], [2, 3])] },
            { title: 'Melhorias', icon: '🚀', blocks: [t(['Descrição', 'Resultado', 'Status', 'Prazo de execução'], [2], 'Levantamento de melhorias')] },
            { title: 'Próximos Passos', icon: '📌', blocks: [t(['Prioridade', 'Ação / Compromisso', 'Responsável', 'Prazo', 'Status'], [0, 4])] }
          ]
        }
      ]
    };
  }

  // Estrutura dos books de Backup: escopo do contrato, arquitetura e repositórios, baseline do mês,
  // status dos jobs, consumo dos buckets, incidentes e conclusão. Mesmo formato do InfraCloud.
  function backup() {
    return {
      meta: { ...meta(), time: 'Backup', subtitulo: 'Relatório Mensal de Backup' }, ui: { route: 'cover' },
      groups: [
        book('<p>Apresentar a visão técnica e operacional do ambiente de backup do cliente, consolidando inventário, execuções, incidentes e recomendações técnicas.</p>'),
        {
          title: 'Visão Geral', icon: '🌐', separator: true, subtitle: 'Escopo, arquitetura e baseline de backup', sections: [
            { title: 'Escopo', icon: '🎯', blocks: [text('<p>Este documento apresenta as informações do ambiente de backup do cliente.</p>'), t(['Item', 'Quantidade'], [], 'Dentro do escopo do contrato')] },
            { title: 'Arquitetura', icon: '🏗️', blocks: [img('Arquitetura de backup'), text('', 'Componentes'), t(['Repositório', 'Tipo / Camada', 'Consumo atual', 'Região', 'Finalidade'], [], 'Repositórios de backup')] },
            { title: 'Baseline de backup', icon: '🧾', blocks: [kpi(['Servidores protegidos', 'Itens protegidos', 'Taxa de sucesso']), t(['Servidor', 'Item protegido (banco / VM / pasta)', 'Política', 'Frequência', 'Retenção'])] }
          ]
        },
        {
          title: 'Execuções', icon: '🗓️', separator: true, subtitle: 'Status dos jobs e consumo', sections: [
            { title: 'Status dos backups', icon: '✅', blocks: [imgs('Status dos jobs'), t(['Job', 'Servidor / Recurso', 'Última execução', 'Resultado', 'Tamanho', 'Duração'], [3])] },
            { title: 'Consumo dos buckets', icon: '🪣', blocks: [imgs('Consumo dos buckets'), t(['Bucket / Repositório', 'Camada', 'Usado', 'Variação no mês'])] }
          ]
        },
        ...CLOUDS.map((p) => cloudGroup(p, () => [
          { title: 'Storage', icon: '💾', blocks: [t(['Nome', 'Tipo', 'Capacidade', 'Utilizado', 'Status'], [4])] },
          { title: 'Backup', icon: '📦', blocks: [t(['Item', 'Situação', 'Ferramenta', 'Frequência', 'Retenção', 'Teste Restore'], [1, 5])] }
        ])),
        {
          title: 'Operações', icon: '⚡', separator: true, subtitle: 'Incidentes, conclusão e próximos passos', collapsed: true, sections: [
            { title: 'Incidentes', icon: '⚠️', blocks: [text('<p>Não houve falhas de backup no período.</p>'), t(['Data', 'Job / Servidor', 'Descrição', 'Severidade', 'Status', 'Ação Tomada'], [3, 4])] },
            { title: 'Testes de restore', icon: '🧪', blocks: [t(['Data', 'Servidor', 'Item restaurado', 'Resultado', 'Tempo (RTO)', 'Observação'], [3])] },
            { title: 'Melhorias', icon: '🚀', blocks: [t(['Prioridade', 'Área', 'Descrição', 'Responsável', 'Prazo'], [0])] },
            { title: 'Conclusão', icon: '🏁', blocks: [text('<p>Durante o período avaliado, o ambiente de backup manteve-se operacional, com resposta eficaz aos eventos identificados.</p>')] },
            { title: 'Próximos Passos', icon: '📌', blocks: [t(['Prioridade', 'Ação / Compromisso', 'Responsável', 'Prazo', 'Status'], [0, 4])] }
          ]
        }
      ]
    };
  }

  const BUILTIN = [
    { id: 'infracloud', name: 'InfraCloud', icon: '☁️', desc: 'Completo: todas as clouds (servidores, rede, segurança, storage, backup) + operações', area: 'InfraCloud', build: () => BT.data.defaultTemplate() },
    { id: 'network', name: 'Network', icon: '🌐', desc: 'Baseline dos equipamentos, datas de suporte, capacity, rotina de backup, serviços, endereçamento IP, links, VPNs e redes das clouds', area: 'Network', build: network },
    { id: 'backup', name: 'Backup', icon: '📦', desc: 'Escopo do contrato, arquitetura e repositórios, baseline, status dos jobs, consumo dos buckets, backup por cloud, incidentes e conclusão', area: 'Backup', build: backup },
    { id: 'blank', name: 'Em branco', icon: '⬜', desc: 'Monte seus próprios menus e seções', area: '', build: () => BT.data.blankTemplate() }
  ];

  BT.data.templates = {
    BUILTIN,
    async all() {
      let custom = [];
      try { custom = await BT.api.listTemplates(); } catch (e) {}
      return [...BUILTIN, ...custom.map((c) => ({ id: c.id, name: c.name, icon: '⭐', desc: c.desc || 'Template personalizado', custom: true, state: c.state }))];
    },
    /** Monta o estado inicial de um book: template + menus padrão definidos em ⚙️ Configurações. */
    async build(id, opts = {}) {
      const tpl = (await this.all()).find((x) => x.id === id) || BUILTIN[0];
      const st = tpl.custom ? BT.core.utils.clone(tpl.state) : tpl.build();
      st.template = tpl.id;
      if (opts.applyDefaults !== false) {
        let cfg = {};
        try { cfg = (await BT.api.getSettings()).defaults || {}; } catch (e) {}
        applyDefaults(st, tpl.id, cfg);
      }
      return BT.store.migrate(st);
    },
    applyDefaults
  };

  /** Remove menus/seções desativados, acrescenta menus extras e o comparativo mensal. */
  function applyDefaults(st, tplId, cfg) {
    const off = new Set((cfg.disabled || {})[tplId] || []);
    st.groups = st.groups.filter((g) => !off.has(g.title)).map((g) => Object.assign(g, { sections: g.sections.filter((s) => !off.has(g.title + '/' + s.title)) })).filter((g) => g.sections.length);
    (cfg.extraGroups || []).forEach((eg) => {
      if (!eg || !eg.title) return;
      st.groups.push({ title: eg.title, icon: eg.icon || '📁', separator: eg.separator !== false, subtitle: eg.subtitle || '',
        sections: (eg.sections || []).filter((x) => x && x.title).map((x) => ({ title: x.title, icon: x.icon || '📄', blocks: [text()] })) });
    });
    if (cfg.comparativo && !st.groups.some((g) => g.sections.some((s) => s.blocks.some((b) => b.type === 'compare')))) {
      const g = st.groups.find((x) => /vis[aã]o geral/i.test(x.title)) || st.groups[0];
      if (g) g.sections.push({ title: 'Comparativo mensal', icon: '📈', blocks: [{ type: 'compare', data: BT.blocks.get('compare') ? BT.blocks.get('compare').create() : {} }] });
    }
  }
})(window.BT);
