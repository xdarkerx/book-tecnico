/* ═══ Notificações rápidas (com ação "Desfazer") ═══ */
(function (BT) {
  BT.ui.toast = function (msg, { type = '', action, actionText = 'Desfazer', ms = 4500 } = {}) {
    const root = document.getElementById('toast-root');
    const t = BT.h('div', { class: 'toast ' + type }, [BT.h('span', { text: msg })]);
    if (action) t.appendChild(BT.h('button', { onclick: () => { action(); t.remove(); } }, actionText));
    root.appendChild(t);
    setTimeout(() => t.remove(), ms);
  };
})(window.BT);
