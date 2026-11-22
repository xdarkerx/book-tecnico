/* ═══ Tela "Capa & Cliente": dados da capa, logo do cliente e rodapé de governança ═══ */
(function (BT) {
  const h = BT.h;
  const U = BT.core.utils;

  function render(view) {
    const st = BT.store.state;
    const m = st.meta;
    m.governanca = m.governanca || {};
    const preview = h('div', { class: 'cover-preview' });
    const refreshPreview = U.debounce(() => {
      const tmp = h('div', { html: BT.book.render(st) });
      const book = tmp.querySelector('.book');
      [...book.children].forEach((c) => { if (!c.classList.contains('bcov') && !c.classList.contains('bgbar')) c.remove(); });
      preview.innerHTML = ''; preview.appendChild(book);
    }, 200);

    const set = (key) => (e) => { m[key] = e.target.value; BT.store.touch(); refreshPreview(); document.getElementById('tb-doc').textContent = (m.cliente || 'Book Técnico') + ' › Capa & Cliente'; };
    const field = (label, key, attrs = {}) => h('div', { class: 'fd' + (attrs.span ? ' span-all' : '') }, [h('label', {}, label), h('input', Object.assign({ value: m[key] || '', oninput: set(key) }, attrs, { span: null }))]);
    const gov = (label, key, ph) => h('div', { class: 'fd' }, [h('label', {}, label), h('input', { value: m.governanca[key] || '', placeholder: ph, oninput: (e) => { m.governanca[key] = e.target.value; BT.store.touch(); } })]);

    const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

    const logoIn = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async (e) => {
      const f = e.target.files[0]; if (!f || !U.isImage(f)) return;
      m.logoCliente = await U.compressImage(await U.readAsDataURL(f), 600); BT.store.touch(); render(view);
    } });

    const autoAmb = [...new Set(BT.book.collect(st).map((p) => p.group.provider).filter(Boolean))].map((k) => BT.data.providers[k].label).join(', ');

    view.innerHTML = '';
    view.append(
      h('div', { class: 'crumb' }, 'Book › Capa & Cliente'),
      h('div', { class: 'sec-head' }, [h('div', { class: 'sec-icon' }, '📘'), h('div', { style: { flex: 1 } }, [h('div', { class: 'section-title' }, 'Capa & Cliente'), h('div', { class: 'section-sub' }, 'Informações da capa, período de referência e rodapé de governança do book.')]),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { const k = BT.api.keyOf(BT.store.sessionId); BT.editor.nav.show({ cliente: k.cliente, ano: k.ano }); } }, '🗂 Outros books')]),
      h('div', { class: 'card', style: { marginTop: '18px' } }, [
        h('div', { class: 'fg fg2' }, [
          field('Nome do cliente (como aparece na capa)', 'cliente', { placeholder: 'ex.: SIMPAR, JSL…' }),
          h('div', { class: 'fd' }, [h('label', {}, 'Período · área técnica (identificação do book)'), h('div', { class: 'inp', style: { opacity: '.8' }, title: 'Para outro período ou área, crie um novo book (⧉ próximo mês)' }, `${months[Number(m.mes) - 1] || '—'}/${m.ano || '—'} · ${m.area || '—'}`)]),
          field('Responsável', 'responsavel', { placeholder: 'ex.: Luiz Silva — Tech Lead' }),
          field('Time', 'time', { placeholder: 'ex.: infraCloud' }),

          field('Subtítulo da capa', 'subtitulo', { placeholder: 'Relatório Mensal de Infraestrutura e Operações', span: true }),
          field('Ambientes (deixe vazio para preencher automaticamente)', 'ambientes', { placeholder: autoAmb ? 'Automático: ' + autoAmb : 'ex.: OCI, Azure', span: true })
        ]),
        h('div', { class: 'subt' }, '🏷️ Logo do cliente (opcional)'),
        h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } }, [
          m.logoCliente ? h('img', { src: m.logoCliente, style: { height: '44px', background: '#fff', borderRadius: '6px', padding: '4px 8px' } }) : h('span', { class: 'muted' }, 'Nenhum logo enviado.'),
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => logoIn.click() }, m.logoCliente ? 'Trocar logo' : 'Enviar logo'),
          m.logoCliente ? h('button', { class: 'btn btn-danger btn-sm', onclick: () => { m.logoCliente = ''; BT.store.touch(); render(view); } }, 'Remover') : null,
          logoIn
        ]),
        h('div', { class: 'subt' }, ['🏛️ Rodapé de governança ', h('small', { class: 'muted', style: { fontWeight: 400 } }, '(opcional — aparece no rodapé do book)')]),
        h('div', { class: 'fg fg4' }, [
          gov('Código', 'codigo', '001/1.0-REL-GOV'), gov('Área responsável', 'area', 'Governança'), gov('Tipo de documento', 'tipo', 'Relatório'), gov('Status', 'status', 'Vigente'),
          gov('Vigência', 'vigencia', '01/09/2027'), gov('Classificação', 'classificacao', 'Uso Interno – Controlado'), gov('Versão', 'versao', '1.0'), gov('Total de páginas', 'paginas', '11')
        ]),
        h('div', { class: 'subt' }, '⚙️ Opções'),
        h('label', { class: 'switch' }, [h('input', { type: 'checkbox', checked: !!m.mostrarSumario, onchange: (e) => { m.mostrarSumario = e.target.checked; BT.store.touch(); } }), 'Incluir sumário após a capa'])
      ]),
      h('div', { class: 'subt' }, '👁 Prévia da capa'),
      preview,
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '18px', flexWrap: 'wrap' } }, [
        h('button', { class: 'btn btn-sec btn-sm', onclick: () => BT.importer.cloud.sync() }, '🔄 Sincronizar com a cloud'),
        h('button', { class: 'btn btn-sec btn-sm', onclick: () => BT.importer.wizard.open() }, '📄 Importar arquivo'),

        h('button', { class: 'btn btn-primary btn-sm', onclick: () => BT.exporters.dialog.open() }, '⬇ Exportar')
      ])
    );
    view.querySelectorAll('.fd > select, .fd select').forEach((s) => s.classList.add('inp'));
    refreshPreview();
  }

  BT.editor.cover = { render };
})(window.BT);
