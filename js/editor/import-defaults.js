/* ═══ ⚙️ Usuário › 📥 Importação padrão ═══
 * O que já vem marcado ao sincronizar com a cloud / Zabbix e na revisão da importação (sync e ZIP), em todos os books.
 * Com login: fica no usuário (vale em qualquer computador). Sem login: neste navegador. Lógica: BT.auth.importDefaults().
 */
(function (BT) {
  const h = BT.h;
  const ZSEV = [[5, '🟥 Desastre'], [4, '🟧 Alta'], [3, '🟨 Média'], [2, '🟦 Atenção'], [1, 'ℹ️ Informação'], [0, '⬜ Não classificado']];

  function render() {
    const box = document.getElementById('set-import'); if (!box) return; box.innerHTML = '';
    const d = BT.auth.importDefaults();
    const sev = new Set(d.zabbixSeverities.map(Number));
    const risks = new Set(d.risks);
    const chk = (set, v, label) => h('label', { class: 'cp' }, [h('input', { type: 'checkbox', checked: set.has(v), onchange: (e) => (e.target.checked ? set.add(v) : set.delete(v)) }), label]);
    const allHosts = h('input', { type: 'checkbox', checked: d.zabbixAllHosts !== false });
    let newOnly = !!d.newOnly;
    let backupMode = d.backupMode || 'both';
    const msg = h('div');
    const save = async () => {
      msg.innerHTML = '';
      if (!sev.size) return msg.appendChild(h('div', { class: 'db-result err' }, 'Escolha ao menos uma severidade do Zabbix.'));
      try {
        await BT.auth.saveImportDefaults({ zabbixSeverities: [...sev], risks: [...risks], newOnly, zabbixAllHosts: allHosts.checked, backupMode });
        BT.ui.toast(BT.auth.user ? 'Padrões de importação salvos no seu usuário ✓' : 'Padrões de importação salvos neste navegador ✓', { type: 'ok' });
      } catch (e) { msg.appendChild(h('div', { class: 'db-result err' }, e.message)); }
    };
    box.append(
      h('div', { class: 'card set-card' }, [
        h('div', { class: 'subt', style: { marginTop: 0 } }, '📥 Importação padrão'),
        h('div', { class: 'set-help' }, ['O que já vem marcado ao sincronizar e ao revisar uma importação, em todos os books. Dá para mudar em cada importação. ',
          BT.auth.user ? 'Fica salvo no seu usuário (vale em qualquer computador).' : 'Sem login, fica salvo neste navegador.']),
        h('div', { class: 'lbl', style: { margin: '14px 0 8px' } }, '📡 Zabbix — severidades dos alertas'),
        h('div', { class: 'cprow' }, ZSEV.map(([v, l]) => chk(sev, v, l))),
        h('label', { class: 'switch', style: { marginTop: '10px' } }, [allHosts, 'Incluir servidores sem nenhum alerta no período (Monitoramento)']),
        h('div', { class: 'lbl', style: { margin: '18px 0 8px' } }, '🛡️ Segurança — riscos das recomendações e alertas (Cloud Guard, Security Hub, Defender)'),
        h('div', { class: 'cprow' }, (BT.blocks.RISK_LEVELS || []).map(([k, l]) => chk(risks, k, l))),
        h('div', { class: 'lbl', style: { margin: '18px 0 8px' } }, '☁️ Servidores, storage e redes'),
        h('div', { class: 'cprow', role: 'radiogroup' }, [[false, 'Todos os recursos'], [true, 'Só os criados no mês do book']].map(([v, l]) =>
          h('label', { class: 'cp' }, [h('input', { type: 'radio', name: 'imp-scope', checked: newOnly === v, onchange: () => (newOnly = v) }), l]))),
        h('div', { class: 'lbl', style: { margin: '18px 0 8px' } }, '🗄️ Backup'),
        h('div', { class: 'cprow', role: 'radiogroup' }, [['both', 'Backups feitos e políticas'], ['jobs', 'Só os backups feitos no mês'], ['policies', 'Só as políticas / agendamentos']].map(([v, l]) =>
          h('label', { class: 'cp' }, [h('input', { type: 'radio', name: 'imp-bk', checked: backupMode === v, onchange: () => (backupMode = v) }), l]))),
        h('div', { class: 'set-help', style: { marginTop: '8px' } }, 'Os backups feitos são sempre só os do mês do book.')
      ]),
      h('div', { class: 'set-actions' }, [msg, h('button', { class: 'btn btn-primary btn-sm', onclick: save }, 'Salvar')]));
  }

  BT.editor = BT.editor || {};
  BT.editor.importDefaults = { render };
})(window.BT);
