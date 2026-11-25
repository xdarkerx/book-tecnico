/* ═══ Diálogo de exportação: escolher seções + formato ═══ */
(function (BT) {
  const h = BT.h;
  const FORMATS = [
    ['pdf', '📄 PDF', 'Abre a impressão do navegador → "Salvar como PDF"'],
    ['word', '📝 Word (.doc)', 'Documento editável no Microsoft Word, com imagens'],
    ['html', '🌐 HTML', 'Página única com o book, para enviar ou publicar']
  ];

  function open(defaultFormat = 'pdf', preset = null) {
    const st = BT.store.state;
    const sel = new Set();
    let format = defaultFormat;
    const tree = h('div', { class: 'wz-cols', style: { maxHeight: '46vh' } });

    st.groups.forEach((g) => {
      const secs = g.sections.map((s) => ({ s, has: s.blocks.some((b) => BT.blocks.visible(b) && BT.blocks.isContent(b)) }));
      secs.forEach(({ s, has }) => { if (has && (preset ? preset.has(s.id) : s.include !== false && g.include !== false)) sel.add(s.id); });
      const gChk = h('input', { type: 'checkbox' });
      const items = secs.map(({ s, has }) => {
        const c = h('input', { type: 'checkbox', checked: sel.has(s.id), disabled: !has, onchange: (e) => { e.target.checked ? sel.add(s.id) : sel.delete(s.id); syncG(); } });
        return { c, id: s.id, el: h('label', { class: 'chk', style: { padding: '3px 0 3px 26px', opacity: has ? 1 : 0.45 } }, [c, `${s.icon} ${s.title}`, has ? '' : h('small', { class: 'muted' }, ' (vazia)')]) };
      });
      const syncG = () => { const en = items.filter((i) => !i.c.disabled); gChk.checked = en.length && en.every((i) => i.c.checked); gChk.indeterminate = !gChk.checked && en.some((i) => i.c.checked); };
      gChk.addEventListener('change', () => items.forEach((i) => {
        if (i.c.disabled) return;
        i.c.checked = gChk.checked;
        gChk.checked ? sel.add(i.id) : sel.delete(i.id);
      }));
      tree.appendChild(h('label', { class: 'chk', style: { fontWeight: 700, marginTop: '6px', color: 'var(--tx)' } }, [gChk, `${g.icon} ${g.title}`]));
      items.forEach((i) => tree.appendChild(i.el));
      syncG();
    });

    const fmtBox = h('div', { class: 'wz-modes' });
    const drawFmt = () => {
      fmtBox.innerHTML = '';
      FORMATS.forEach(([k, l, d]) => fmtBox.appendChild(h('button', { class: 'wz-mode' + (k === format ? ' on' : ''), onclick: () => { format = k; drawFmt(); } }, [h('b', {}, l), h('small', {}, d)])));
      tip.hidden = format !== 'pdf';
    };
    const tip = h('div', { class: 'wz-hint', html: '💡 Na janela de impressão: destino <b>Salvar como PDF</b>, papel <b>A4</b>, retrato, e marque <b>Gráficos de fundo</b> (Chrome) / <b>Plano de fundo</b> (Edge).' });
    const toc = h('input', { type: 'checkbox', checked: !!st.meta.mostrarSumario, onchange: (e) => { st.meta.mostrarSumario = e.target.checked; BT.store.touch(); } });
    // Segurança: quais riscos das recomendações/alertas entram (fica salvo no book; vale para PDF, Word, HTML e pré-visualização)
    let risks = null;
    if (BT.blocks.hasRiskRows && BT.blocks.hasRiskRows(st)) {
      const cur = new Set(Array.isArray(st.meta.riscosExport) ? st.meta.riscosExport : BT.blocks.RISK_LEVELS.map((x) => x[0]));
      const save = () => { st.meta.riscosExport = cur.size === BT.blocks.RISK_LEVELS.length ? undefined : [...cur]; BT.store.touch(); };
      risks = h('div', {}, [
        h('div', { class: 'lbl', style: { margin: '16px 0 6px' } }, '🛡️ Segurança — riscos nas recomendações e alertas'),
        h('div', { class: 'cprow' }, BT.blocks.RISK_LEVELS.map(([k, l]) => h('label', { class: 'cp' }, [h('input', { type: 'checkbox', checked: cur.has(k), onchange: (e) => { e.target.checked ? cur.add(k) : cur.delete(k); save(); } }), l]))),
        h('div', { class: 'wz-hint', style: { marginTop: '6px' } }, 'Itens sem risco informado sempre aparecem. A escolha fica salva neste book.')
      ]);
    }

    const go = async () => {
      if (!sel.size) return BT.ui.toast('Selecione ao menos uma seção com conteúdo.', { type: 'err' });
      m.close();
      try {
        if (format === 'pdf') BT.exporters.pdf(st, sel);
        else if (format === 'word') { BT.ui.toast('Gerando Word…'); await BT.exporters.word(st, sel); BT.ui.toast('Word gerado ✓', { type: 'ok' }); }
        else { await BT.exporters.html(st, sel); BT.ui.toast('HTML gerado ✓', { type: 'ok' }); }
      } catch (e) { console.error(e); BT.ui.toast('Falha ao exportar: ' + e.message, { type: 'err', ms: 8000 }); }
    };

    const m = BT.ui.modal.open({
      title: '⬇ Exportar book', size: 'md',
      body: [
        h('div', { class: 'lbl', style: { marginBottom: '8px' } }, 'Formato'), fmtBox, tip,
        h('div', { class: 'lbl', style: { margin: '18px 0 6px', display: 'flex', gap: '8px', alignItems: 'center' } }, ['O que exportar',
          h('button', { class: 'btn btn-ghost btn-xs', onclick: () => { tree.querySelectorAll('input[type=checkbox]:not(:disabled)').forEach((c) => { if (!c.checked) c.click(); }); } }, '☑ Tudo'),
          h('button', { class: 'btn btn-ghost btn-xs', onclick: () => { tree.querySelectorAll('input[type=checkbox]:not(:disabled)').forEach((c) => { if (c.checked) c.click(); }); } }, '☐ Nenhum')]),
        h('div', { class: 'wz-box' }, tree),
        h('label', { class: 'switch', style: { marginTop: '12px' } }, [toc, 'Incluir sumário após a capa']),
        risks
      ],
      footer: [
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => m.close() }, 'Cancelar'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-sec btn-sm', id: 'ex-preview', onclick: () => {
          if (!sel.size) return BT.ui.toast('Selecione ao menos uma seção com conteúdo.', { type: 'err' });
          m.close(); BT.book.preview.format = format; BT.book.preview.open({ selection: new Set(sel) });
        } }, '👁 Pré-visualizar'),
        h('button', { class: 'btn btn-primary btn-sm', onclick: go }, 'Exportar')]
    });
    drawFmt();
  }

  BT.exporters.dialog = { open };
})(window.BT);
