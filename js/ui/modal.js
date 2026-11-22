/* ═══ Modais (genérico, confirmação, texto, edição de nome/ícone) — com foco preso e devolvido ao fechar ═══ */
(function (BT) {
  const h = BT.h;
  const root = () => document.getElementById('modal-root');

  let seq = 0;
  const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function open({ title, size = '', body, footer = [], onClose, dismissable = true }) {
    const wrap = h('div', { class: 'modal-wrap' });
    const before = document.activeElement; // devolve o foco ao fechar
    const close = () => {
      wrap.remove(); document.removeEventListener('keydown', onKey); onClose && onClose();
      // devolve o foco DEPOIS que a tecla atual termina: devolvido no meio de um Enter, o navegador
      // "clicava" no botão que abriu a janela e ela abria de novo (ex.: Novo cliente duas vezes)
      setTimeout(() => { if (before && before.focus && document.contains(before) && !root().lastElementChild) before.focus(); }, 0);
    };
    const onKey = (e) => {
      if (wrap !== root().lastElementChild) return; // só o modal de cima responde
      if (e.key === 'Escape' && dismissable) { e.stopPropagation(); close(); }
      if (e.key === 'Tab') { // mantém o foco dentro do modal
        const f = [...modal.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    const titleId = 'modal-t-' + (++seq);
    const modal = h('div', { class: 'modal ' + size, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId }, [
      h('div', { class: 'modal-hd' }, [h('h3', { id: titleId, text: title }), dismissable ? h('button', { class: 'btn-icon', title: 'Fechar', 'aria-label': 'Fechar', onclick: close }, '✕') : null]),
      h('div', { class: 'modal-bd' }, body),
      footer.length ? h('div', { class: 'modal-ft' }, footer) : null
    ]);
    wrap.appendChild(modal);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap && dismissable) close(); });
    document.addEventListener('keydown', onKey);
    root().appendChild(wrap);
    const first = modal.querySelector('input,textarea,select') || modal.querySelector('.modal-ft .btn-primary, .modal-ft .btn-danger');
    if (first) setTimeout(() => first.focus(), 30);
    return { el: modal, close, body: modal.querySelector('.modal-bd'), footer: modal.querySelector('.modal-ft') };
  }

  function confirm(message, { okText = 'Confirmar', danger = false, title = 'Confirmar' } = {}) {
    return new Promise((resolve) => {
      let done = false;
      const m = open({
        title, body: h('p', { style: { lineHeight: '1.6', color: 'var(--tx2)' }, text: message }),
        onClose: () => { if (!done) resolve(false); },
        footer: [
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => m.close() }, 'Cancelar'),
          h('button', { class: 'btn btn-sm ' + (danger ? 'btn-danger' : 'btn-primary'), onclick: () => { done = true; m.close(); resolve(true); } }, okText)
        ]
      });
    });
  }

  /** Edita título + ícone (menus e seções). Extras: [{key,label,type:'checkbox'|'text', value}] */
  function editItem({ title = 'Editar', name = '', icon = '📄', extras = [] }) {
    return new Promise((resolve) => {
      let chosen = icon; let done = false;
      const nameIn = h('input', { class: 'inp', value: name, placeholder: 'Nome' });
      const iconIn = h('input', { class: 'inp', value: icon, style: { width: '70px', textAlign: 'center', fontSize: '18px' }, maxlength: 4 });
      const grid = h('div', { class: 'icon-grid' }, BT.data.ICONS.map((ic) => h('button', {
        type: 'button', class: ic === icon ? 'on' : '', text: ic,
        onclick: (e) => { chosen = ic; iconIn.value = ic; grid.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); }
      })));
      iconIn.addEventListener('input', () => (chosen = iconIn.value));
      const extraEls = extras.map((x) => {
        if (x.type === 'checkbox') {
          const inp = h('input', { type: 'checkbox', checked: !!x.value });
          return { x, inp, el: h('label', { class: 'switch', style: { marginTop: '10px' } }, [inp, x.label]) };
        }
        if (x.type === 'select') {
          const inp = h('select', { class: 'inp' }, x.options.map(([v, l]) => h('option', { value: v, selected: v === x.value }, l)));
          return { x, inp, el: h('div', { class: 'fd', style: { marginTop: '10px' } }, [h('label', { text: x.label }), inp]) };
        }
        const inp = h('input', { class: 'inp', value: x.value || '', placeholder: x.placeholder || '' });
        return { x, inp, el: h('div', { class: 'fd', style: { marginTop: '10px' } }, [h('label', { text: x.label }), inp]) };
      });
      const save = () => {
        done = true; m.close();
        const out = { name: nameIn.value.trim() || name, icon: (chosen || icon).trim() };
        extraEls.forEach(({ x, inp }) => (out[x.key] = x.type === 'checkbox' ? inp.checked : inp.value));
        resolve(out);
      };
      nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }); // Enter consumido aqui
      const m = open({
        title,
        body: [h('div', { style: { display: 'flex', gap: '8px' } }, [iconIn, nameIn]), grid, ...extraEls.map((e) => e.el)],
        onClose: () => { if (!done) resolve(null); },
        footer: [h('button', { class: 'btn btn-ghost btn-sm', onclick: () => m.close() }, 'Cancelar'), h('button', { class: 'btn btn-primary btn-sm', onclick: save }, 'Salvar')]
      });
    });
  }

  /** Pede um texto (substitui o prompt() do navegador). validate(v) devolve a mensagem de erro ou nada. */
  function prompt({ title = 'Informe', label = '', value = '', placeholder = '', okText = 'OK', validate, inputmode } = {}) {
    return new Promise((resolve) => {
      let done = false;
      const inp = h('input', { class: 'inp', value, placeholder, inputmode: inputmode || null, 'aria-label': label || title });
      const err = h('div', { class: 'field-err', role: 'alert' });
      const ok = () => {
        const v = inp.value.trim();
        const msg = validate ? validate(v) : (v ? '' : 'Preencha o campo.');
        if (msg) { err.textContent = msg; inp.focus(); return; }
        done = true; m.close(); resolve(v);
      };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } }); // Enter consumido aqui
      const m = open({
        title,
        body: [label ? h('label', { class: 'lbl', style: { display: 'block', marginBottom: '6px' } }, label) : null, inp, err],
        onClose: () => { if (!done) resolve(null); },
        footer: [h('button', { class: 'btn btn-ghost btn-sm', onclick: () => m.close() }, 'Cancelar'), h('button', { class: 'btn btn-primary btn-sm', onclick: ok }, okText)]
      });
    });
  }

  BT.ui.modal = { open, confirm, editItem, prompt };
})(window.BT);
