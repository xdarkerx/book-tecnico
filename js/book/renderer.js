/* ═══ Renderizador do book (HTML) ═══
 * Usado pelo preview, pelo PDF (impressão) e pelo export HTML.
 * O Word tem um renderizador próprio (js/export/word.js) com layout em tabelas.
 */
(function (BT) {
  const esc = BT.esc;

  /**
   * Monta a lista do que entra no book.
   * selection (opcional): Set de ids de seções escolhidas no diálogo de exportação.
   */
  function collect(state, selection) {
    const out = [];
    state.groups.forEach((g) => {
      if (!selection && g.include === false) return;
      const sections = g.sections
        .filter((s) => (selection ? selection.has(s.id) : s.include !== false))
        .map((s) => ({ section: s, blocks: s.blocks.filter(BT.blocks.visible) }))
        .filter((x) => x.blocks.some((b) => BT.blocks.isContent(b)));
      if (sections.length) out.push({ group: g, sections });
    });
    return out;
  }

  function meta(state, parts) {
    const m = state.meta;
    const provs = [...new Set(parts.filter((p) => p.group.provider).map((p) => (BT.data.providers[p.group.provider]?.label || '') + (p.group.account ? ' ' + p.group.account : '')))];
    return {
      nome: m.cliente || 'CLIENTE',
      mesRef: BT.core.utils.monthLabel(m.mes, m.ano),
      ambientes: m.ambientes || provs.join(', ') || '—',
      responsavel: m.responsavel || '—',
      time: m.time || '',
      area: m.area || '',
      subtitulo: m.subtitulo || '',
      logoCliente: m.logoCliente || '',
      gov: m.governanca || {}
    };
  }

  function govItems(gov) {
    return [['Código', gov.codigo], ['Área', gov.area], ['Tipo', gov.tipo], ['Status', gov.status], ['Classificação', gov.classificacao], ['Vigência', gov.vigencia], ['Versão', gov.versao], ['Páginas', gov.paginas]]
      .filter(([, v]) => v && String(v).trim());
  }

  function render(state, opts = {}) {
    const parts = collect(state, opts.selection);
    const M = meta(state, parts);
    const ctx = { target: 'web', state };
    const html = [];

    // Capa
    html.push('<div class="book-page-rule"></div>');
    html.push(`<div class="bcov">
      <div class="bd1"></div><div class="bd2"></div><div class="bcov-line"></div><div class="bcov-edge"></div>
      <div class="blr"><img src="${BT.data.LOGO_WHITE}" alt="inventCloud">${M.logoCliente ? `<img class="client-logo" src="${M.logoCliente}" alt="">` : ''}</div>
      <div class="bclbl">Book Técnico</div>
      <div class="bcn">${esc(M.nome)}</div>
      ${M.subtitulo ? `<div class="bcs">${esc(M.subtitulo)}</div>` : ''}
      <div class="bmrow">
        <div class="bmi"><div class="bml">Referência</div><div class="bmv">${esc(M.mesRef)}</div></div>
        <div class="bmi"><div class="bml">Ambientes</div><div class="bmv">${esc(M.ambientes)}</div></div>
        <div class="bmi"><div class="bml">Responsável</div><div class="bmv">${esc(M.responsavel)}</div></div>
        ${M.area ? `<div class="bmi"><div class="bml">Área técnica</div><div class="bmv">${esc(M.area)}</div></div>` : ''}
        ${M.time ? `<div class="bmi"><div class="bml">Time</div><div class="bmv">${esc(M.time)}</div></div>` : ''}
      </div>
    </div><div class="bgbar"></div><div class="bbd">`);

    // Sumário
    if (state.meta.mostrarSumario && parts.length) {
      let n = 0;
      html.push('<div class="btoc"><div class="bh1"><div class="bh1ic">🧭</div>Sumário</div>' + parts.map((p) =>
        `<div class="btoc-row grp">${esc(p.group.icon)} ${esc(p.group.title)}</div>` +
        p.sections.map((s) => `<div class="btoc-row"><span class="n">${String(++n).padStart(2, '0')}</span>${esc(s.section.title)}</div>`).join('')).join('') + '</div>');
    }

    // Capítulos (menus) e seções
    parts.forEach(({ group, sections }) => {
      if (group.separator) {
        html.push(`<div class="bwl-sep"><div class="bwl-sep-line"></div><div class="bwl-sep-body">
          <div class="bwl-sep-label">inventCloud · Book Técnico</div>
          <div class="bwl-sep-title">${esc(group.provider ? BT.data.providers[group.provider].display + (group.account ? ' · ' + group.account : '') : group.title)}</div>
          <div class="bwl-sep-sub">${esc(group.subtitle || `Ambiente: ${M.nome} · ${M.mesRef}`)}</div></div></div>`);
      }
      sections.forEach(({ section, blocks }) => {
        html.push(`<div class="bsec" data-sec="${section.id}"><div class="bh1"><div class="bh1ic">${esc(section.icon)}</div>${esc(section.title)}</div>`);
        blocks.forEach((b) => html.push(BT.blocks.renderBook(b, ctx)));
        html.push('</div>');
      });
    });
    if (!parts.length) html.push('<p class="bxt" style="text-align:center;color:#9098b8;padding:40px 0">Nenhuma seção com conteúdo ainda. Preencha as seções ou importe dados de cloud.</p>');
    html.push('</div>');

    // Rodapé + governança
    const gi = govItems(M.gov);
    html.push(`<div class="bpg-footer-wrap"><div class="bpg-footer"><span>inventCloud — Confidencial</span><span>${esc(M.nome)} · ${esc(M.mesRef)}</span><span>Gerado em ${BT.core.utils.today()}</span></div>
      ${gi.length ? `<div class="bpg-gov">${gi.map(([l, v]) => `<div class="bpg-gov-item"><span class="bpg-gov-label">${l}</span><span class="bpg-gov-value">${esc(v)}</span></div>`).join('')}</div>` : ''}</div>`);

    return `<div class="book">${html.join('\n')}</div>`;
  }

  BT.book.collect = collect;
  BT.book.meta = meta;
  BT.book.govItems = govItems;
  BT.book.render = render;
})(window.BT);
