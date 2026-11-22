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
  const ops = (extra = []) => ({
    title: 'Operações', icon: '⚡', separator: true, subtitle: 'Operação & próximos passos', collapsed: true, sections: [
      { title: 'Incidentes', icon: '⚠️', blocks: [t(['Item', 'Descrição', 'Severidade', 'Status', 'Ação Tomada'], [2, 3])] },
      ...extra,
      { title: 'Melhorias', icon: '🚀', blocks: [t(['Prioridade', 'Área', 'Descrição', 'Responsável', 'Prazo'], [0])] },
      { title: 'Próximos Passos', icon: '📌', blocks: [t(['Prioridade', 'Ação / Compromisso', 'Responsável', 'Prazo', 'Status'], [0, 4])] }
    ]
  });
  const PROVS = [['oci', 'VCNs'], ['aws', 'VPCs'], ['azure', 'VNets'], ['gcp', 'Redes VPC']];

  function network() {
    return {
      meta: meta(), ui: { route: 'cover' },
      groups: [
        book('<p>Apresentar a arquitetura e a operação de rede do ambiente do cliente: topologia, conectividade híbrida, segmentação, segurança de rede e pontos de atenção.</p>'),
        {
          title: 'Topologia', icon: '🧭', separator: true, subtitle: 'Visão geral da rede', sections: [
            { title: 'Diagrama geral', icon: '🗺️', blocks: [img('Topologia de rede'), text('', 'Descrição da arquitetura')] },
            { title: 'Conectividade', icon: '🔗', blocks: [kpi(['Links / túneis', 'Ativos', 'Com falha']), t(['Origem', 'Destino', 'Tipo', 'Banda', 'Redundância', 'Status'], [5], 'VPN · FastConnect · ExpressRoute · Direct Connect · Interconnect')] }
          ]
        },
        ...PROVS.map(([p, rede]) => {
          const P = BT.data.providers[p];
          return {
            title: P.label, icon: P.icon, provider: p, separator: true, collapsed: p !== 'oci', sections: [
              { title: `Redes (${rede})`, icon: '🌐', blocks: [t(['Rede', 'CIDR', P.group, 'Subnets'], [], rede)] },
              { title: 'Subnets', icon: '🧩', blocks: [t(['Subnet', 'CIDR', 'Rede', 'Pública / Privada', 'Route table'], [3])] },
              { title: 'Segurança de rede', icon: '🛡️', blocks: [t(['Regra / Grupo', 'Origem', 'Destino', 'Porta / Protocolo', 'Ação', 'Observação'], [4])] }
            ]
          };
        }),
        {
          title: 'Serviços de rede', icon: '🛰️', separator: true, collapsed: true, sections: [
            { title: 'Load Balancers', icon: '⚖️', blocks: [t(['Nome', 'Tipo', 'IP / DNS', 'Backends', 'Status'], [4])] },
            { title: 'DNS', icon: '📛', blocks: [t(['Zona', 'Tipo', 'Registros', 'Observação'])] },
            { title: 'Firewall & WAF', icon: '🔥', blocks: [t(['Equipamento / Serviço', 'Política', 'Regras', 'Status'], [3]), img('Evidências')] }
          ]
        },
        ops([{ title: 'Mudanças de rede', icon: '🔀', blocks: [t(['Data', 'Mudança', 'Impacto', 'Responsável', 'Status'], [2, 4])] }])
      ]
    };
  }

  function backup() {
    return {
      meta: meta(), ui: { route: 'cover' },
      groups: [
        book('<p>Apresentar a situação da rotina de backup e recuperação do ambiente: cobertura, execução dos jobs, retenção, testes de restore e riscos.</p>'),
        {
          title: 'Visão Geral', icon: '📊', separator: true, subtitle: 'Indicadores de backup', sections: [
            { title: 'Indicadores', icon: '📈', blocks: [kpi(['Taxa de sucesso', 'Jobs executados', 'Falhas', 'Servidores protegidos', 'Volume protegido (TB)']), img('Gráfico de execuções')] },
            { title: 'Política de backup', icon: '📜', blocks: [t(['Ambiente', 'Ferramenta', 'Escopo', 'Frequência', 'Retenção', 'Janela'], [], 'Política vigente')] }
          ]
        },
        {
          title: 'Execuções', icon: '🗓️', separator: true, sections: [
            { title: 'Jobs', icon: '▶️', blocks: [t(['Job', 'Servidor / Recurso', 'Última execução', 'Resultado', 'Tamanho', 'Duração'], [3])] },
            { title: 'Falhas e alertas', icon: '❗', blocks: [t(['Data', 'Job', 'Erro', 'Causa', 'Ação', 'Status'], [5])] }
          ]
        },
        {
          title: 'Cobertura por cloud', icon: '☁️', separator: true, collapsed: true, sections: [
            ...['oci', 'aws', 'azure', 'vmware'].map((p) => ({ title: `Backup ${BT.data.providers[p].label}`, icon: BT.data.providers[p].icon, blocks: [t(['Item', 'Situação', 'Ferramenta', 'Frequência', 'Retenção', 'Teste Restore'], [1, 5])] }))
          ]
        },
        {
          title: 'Recuperação', icon: '🛟', separator: true, collapsed: true, sections: [
            { title: 'Testes de restore', icon: '🧪', blocks: [t(['Data', 'Servidor', 'Item restaurado', 'Resultado', 'RTO obtido', 'Observação'], [3])] },
            { title: 'Retenção & Storage', icon: '🗄️', blocks: [t(['Repositório', 'Tipo', 'Capacidade', 'Usado', 'Livre', 'Status'], [5])] }
          ]
        },
        ops()
      ]
    };
  }

  const BUILTIN = [
    { id: 'infracloud', name: 'InfraCloud', icon: '☁️', desc: 'Completo: todas as clouds (servidores, rede, segurança, storage, backup) + operações', area: 'InfraCloud', build: () => BT.data.defaultTemplate() },
    { id: 'network', name: 'Network', icon: '🌐', desc: 'Topologia, conectividade, VCN/VPC/VNet, subnets, segurança de rede, LB, DNS, firewall', area: 'Network', build: network },
    { id: 'backup', name: 'Backup', icon: '📦', desc: 'Indicadores, política, jobs, falhas, cobertura por cloud, testes de restore e retenção', area: 'Backup', build: backup },
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
