/* ═══ ⚙️ Administrador › Lixeira ═══
 * Books, anos e clientes excluídos: quem excluiu, quando, GUID, quantos dias faltam.
 * Restaurar (com conflito: substituir o atual ou restaurar como cópia) ou excluir definitivamente.
 * Itens com o mesmo nome aparecem lado a lado ("duplicado"), cada um com seu GUID.
 * Servidor: server/trash.js.
 */
(function (BT) {
  const h = BT.h;
  const $ = (id) => document.getElementById(id);
  const ICON = { book: '📘', year: '🗓️', client: '🏢' };
  let data = { items: [], days: 30 }, filter = '', type = '';

  async function render() {
    const box = $('set-trash'); box.innerHTML = '';
    try { data = await BT.api.trash(); } catch (e) { box.appendChild(h('div', { class: 'db-result err' }, e.message)); return; }
    const list = h('div', { class: 'tr-list' });
    const draw = () => {
      list.innerHTML = '';
      const q = filter.toLowerCase();
      const items = data.items.filter((i) => (!type || i.type === type) && (!q || (i.label + ' ' + i.guid + ' ' + i.deletedBy.name).toLowerCase().includes(q)));
      if (!items.length) { list.appendChild(h('div', { class: 'st-empty' }, data.items.length ? 'Nada encontrado com esse filtro.' : '🗑️ A lixeira está vazia.')); return; }
      items.forEach((i) => list.appendChild(row(i)));
    };
    const days = h('input', { class: 'inp inp-sm', type: 'number', min: 1, max: 365, value: data.days, style: { width: '80px' } });
    box.appendChild(h('div', { class: 'card set-card' }, [
      h('div', { class: 'subt', style: { marginTop: 0 } }, '🗑️ Lixeira'),
      h('div', { class: 'set-help' }, 'Books, anos e clientes excluídos ficam aqui. Ao restaurar algo que já existe de novo, você escolhe substituir o atual ou restaurar como cópia.'),
      h('div', { class: 'tr-tools' }, [
        h('input', { class: 'inp inp-sm', type: 'search', placeholder: 'Buscar por nome, GUID ou quem excluiu', 'aria-label': 'Buscar na lixeira', value: filter, oninput: (e) => { filter = e.target.value; draw(); } }),
        h('select', { class: 'inp inp-sm', 'aria-label': 'Tipo', onchange: (e) => { type = e.target.value; draw(); } }, [['', 'Tudo'], ['client', 'Clientes'], ['year', 'Anos'], ['book', 'Books']].map(([v, l]) => h('option', { value: v, selected: v === type }, l))),
        h('span', { class: 'tr-days' }, ['Apagar sozinho após ', days, ' dias ', h('button', { class: 'btn btn-ghost btn-xs', onclick: async () => {
          try { const r = await BT.api.trashSettings(days.value); BT.ui.toast(`Itens da lixeira serão apagados após ${r.days} dia(s).`, { type: 'ok' }); } catch (e) { BT.ui.toast(e.message, { type: 'err' }); }
        } }, 'Salvar')])
      ]),
      list
    ]));
    draw();
  }

  function row(i) {
    const left = Math.max(0, Math.ceil((i.expiresAt - Date.now()) / 86400000));
    const det = i.type === 'client' ? `${i.books.length} book(s)${i.years && i.years.length ? ' · anos ' + i.years.join(', ') : ''}${i.hasConnections ? ' · com conexões de cloud' : ''}`
      : i.type === 'year' ? `${i.books.length} book(s)` : '';
    return h('div', { class: 'tr-item' + (i.activeExists ? ' dup' : '') }, [
      h('div', { class: 'tr-ic', 'aria-hidden': 'true' }, ICON[i.type]),
      h('div', { class: 'tr-main' }, [
        h('div', { class: 'tr-title' }, [h('b', {}, i.label), h('span', { class: 'pill' }, i.typeLabel),
          i.activeExists ? h('span', { class: 'tr-tag warn', title: 'Já existe um ativo com o mesmo nome (GUID diferente)' }, 'duplicado: existe um ativo') : null,
          i.duplicates > 1 ? h('span', { class: 'tr-tag', title: 'O mesmo nome foi excluído mais de uma vez' }, `${i.duplicates}× na lixeira`) : null]),
        h('div', { class: 'tr-meta' }, [`Excluído por `, h('b', {}, i.deletedBy.name), ` em ${new Date(i.deletedAt).toLocaleString('pt-BR')}`, det ? ' · ' + det : '', i.reason ? h('div', { class: 'muted' }, i.reason) : null]),
        h('div', { class: 'tr-guid mono', title: 'GUID' }, 'GUID ' + (i.guid || '—'))
      ]),
      h('div', { class: 'tr-side' }, [
        h('small', { class: left <= 3 ? 'tr-left soon' : 'tr-left' }, left ? `apaga em ${left} dia(s)` : 'apaga hoje'),
        h('div', { class: 'tr-act' }, [
          h('button', { class: 'btn btn-sec btn-xs', onclick: () => restore(i) }, '♻️ Restaurar'),
          h('button', { class: 'btn btn-danger btn-xs', onclick: () => purge(i) }, 'Excluir definitivo')
        ])
      ])
    ]);
  }

  async function restore(i, mode) {
    try {
      const r = await BT.api.trashRestore(i.tid, mode);
      BT.ui.toast(`✓ "${i.label}" restaurado${r.mode === 'copy' ? ' como cópia' : r.mode === 'replace' ? ' (o atual foi para a lixeira)' : ''}`, { type: 'ok', ms: 6000 });
      render();
    } catch (e) {
      if (e.status !== 409 || mode) return BT.ui.toast(e.message, { type: 'err', ms: 7000 });
      const what = i.type === 'client' ? `o cliente "${i.clienteNome}"` : (e.data.conflicts || []).length > 1 ? `${e.data.conflicts.length} books com o mesmo nome` : 'um book com o mesmo nome';
      const m = BT.ui.modal.open({
        title: '♻️ Já existe ' + (i.type === 'client' ? 'esse cliente' : 'esse book'),
        body: [h('p', { class: 'lock-ask' }, `Hoje já existe ${what}. O que fazer com "${i.label}"?`),
          h('ul', { class: 'acc-how' }, [h('li', {}, [h('b', {}, 'Restaurar como cópia: '), `fica ao lado do atual, com o nome "… (restaurado)" e GUID novo.`]), h('li', {}, [h('b', {}, 'Substituir o atual: '), 'o atual vai para a lixeira e o antigo volta no lugar dele.'])])],
        footer: [h('button', { class: 'btn btn-ghost btn-sm', onclick: () => m.close() }, 'Cancelar'),
          h('button', { class: 'btn btn-danger btn-sm', onclick: () => { m.close(); restore(i, 'replace'); } }, 'Substituir o atual'),
          h('button', { class: 'btn btn-primary btn-sm', onclick: () => { m.close(); restore(i, 'copy'); } }, 'Restaurar como cópia')]
      });
    }
  }
  async function purge(i) {
    if (!(await BT.ui.modal.confirm(`Excluir "${i.label}" definitivamente (${i.books.length} book(s))? Não dá para desfazer.`, { okText: 'Excluir definitivo', danger: true }))) return;
    try { await BT.api.trashPurge(i.tid); BT.ui.toast('Excluído definitivamente.', { type: 'ok' }); render(); } catch (e) { BT.ui.toast(e.message, { type: 'err' }); }
  }

  BT.editor.trash = { render };
})(window.BT);
