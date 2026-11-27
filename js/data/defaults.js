/* ═══ Padrões da equipe (⚙️ Configurações › Opções de book) ═══
 * O que já vem marcado:
 *  - blocks: nos books criados do zero (template). Um book copiado mantém o que estava no original,
 *    e books antigos sem a opção gravada continuam como eram.
 *  - import: na sincronização e na revisão da importação. Se o usuário salvar os padrões dele
 *    (⚙️ Usuário › Importação padrão), valem os dele.
 * Os valores abaixo são o padrão de fábrica; a equipe muda em Configurações e fica em settings.defaults.
 */
(function (BT) {
  const FACTORY = {
    blocks: {
      compareHideUnchanged: true, // Comparativo mensal: "Ocultar itens sem mudança"
      // Cloud Security Score: recomendações e gráficos de risco ligados; problemas/alertas desligados (muitos itens);
      // comparativo e evolução ligados, mas só aparecem quando há pontuação de um mês anterior
      scoreShow: { recs: true, alerts: false, charts: true, compare: true, evolution: true },
      topologyStyle: 'tree' // hierárquico: raiz → switches/hubs → redes, com ícones
    },
    import: {
      zabbixSeverities: [5, 4],   // Desastre e Alta
      zabbixAllHosts: false,      // servidores sem alerta ficam de fora do Monitoramento
      risks: ['critica', 'alta'], // riscos das recomendações e alertas de segurança
      newOnly: false,
      backupMode: 'policies',     // só as políticas / agendamentos
      vulnSeverities: ['Crítica', 'Alta']
    }
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const D = {
    FACTORY,
    team: clone(FACTORY), // carregado do servidor (settings.defaults.blockDefaults / importDefaults)
    /** Junta o padrão da equipe salvo no servidor com o de fábrica. */
    load(defaults = {}) {
      D.team = {
        blocks: Object.assign(clone(FACTORY.blocks), defaults.blockDefaults || {}, { scoreShow: Object.assign({}, FACTORY.blocks.scoreShow, (defaults.blockDefaults || {}).scoreShow || {}) }),
        import: Object.assign(clone(FACTORY.import), defaults.importDefaults || {})
      };
      return D.team;
    },
    blocks: () => D.team.blocks,
    import: () => D.team.import,
    /** Book novo (do zero): grava as opções padrão nos blocos (assim elas ficam no book, mesmo se o padrão mudar depois). */
    applyToNewBook(st) {
      const b = D.blocks();
      (st.groups || []).forEach((g) => (g.sections || []).forEach((s) => (s.blocks || []).forEach((blk) => D.applyToBlock(blk, b))));
      return st;
    },
    applyToBlock(blk, b = D.blocks()) {
      if (!blk || !blk.data) return blk;
      if (blk.type === 'compare') blk.data.hideUnchanged = !!b.compareHideUnchanged;
      if (blk.type === 'score' && !blk.data.show) blk.data.show = Object.assign({}, b.scoreShow);
      if (blk.type === 'topology') blk.data.style = b.topologyStyle || 'tree';
      return blk;
    }
  };
  BT.data.defaults = D;
})(window.BT);
