/* ═══ Dropdowns simples ([data-dd-toggle] dentro de .dropdown) ═══ */
(function (BT) {
  document.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-dd-toggle]');
    document.querySelectorAll('.dropdown.open').forEach((d) => { if (!toggle || !d.contains(toggle)) d.classList.remove('open'); });
    if (toggle) toggle.closest('.dropdown').classList.toggle('open');
    else if (e.target.closest('.dropdown-menu button')) e.target.closest('.dropdown').classList.remove('open');
  });

  /** Menu de contexto flutuante: items = [{label, onClick} | 'hr'] */
  BT.ui.contextMenu = function (x, y, items) {
    document.querySelectorAll('.col-menu').forEach((m) => m.remove());
    const menu = BT.h('div', { class: 'col-menu' }, items.map((it) => it === 'hr' ? BT.h('hr') :
      BT.h('button', { onclick: () => { menu.remove(); it.onClick(); } }, it.label)));
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - r.height - 8) + 'px';
    const off = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', off, true); } };
    setTimeout(() => document.addEventListener('mousedown', off, true), 0);
    return menu;
  };
})(window.BT);
