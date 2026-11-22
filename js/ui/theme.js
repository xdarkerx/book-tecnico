/* ═══ Tema claro / escuro ═══
 * Segue o sistema até o usuário escolher em ⚙️ Configurações › Preferências › Aparência.
 * A escolha fica no navegador e, com login, também no usuário (acompanha a pessoa).
 * Qualquer botão com [data-theme-toggle] alterna o tema; imagens com [data-logo] trocam o logo.
 * O head.html já aplica o tema antes de pintar a página (sem "piscar").
 */
(function (BT) {
  const KEY = 'bt-theme';
  const LOGO = { dark: 'assets/img/logo-inventcloud-white.svg', light: 'assets/img/logo-inventcloud.svg' };
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : { matches: false };
  const saved = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  const current = () => saved() || (mq.matches ? 'light' : 'dark');

  function apply(t = current()) {
    document.documentElement.dataset.theme = t;
    document.querySelectorAll('img[data-logo]').forEach((i) => { if (!i.src.endsWith(LOGO[t])) i.src = LOGO[t]; });
    document.querySelectorAll('[data-theme-toggle]').forEach((b) => {
      b.textContent = t === 'light' ? '🌙' : '☀️';
      b.title = t === 'light' ? 'Usar tema escuro' : 'Usar tema claro';
      b.setAttribute('aria-label', b.title);
    });
    if (BT.emit) BT.emit('theme:changed', t);
  }
  /** Escolha do usuário: 'light' | 'dark' | 'system'. Com login, fica salva no usuário (vale em qualquer computador). */
  function set(choice, { remote = true } = {}) {
    try { if (choice === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, choice); } catch (e) { /* modo privado */ }
    apply();
    if (remote && BT.api && BT.api.mode === 'server' && BT.auth && BT.auth.user && BT.api.savePrefs) BT.api.savePrefs({ theme: choice }).catch(() => {});
  }
  const choice = () => saved() || 'system';
  function toggle() { set(current() === 'light' ? 'dark' : 'light'); }

  if (mq.addEventListener) mq.addEventListener('change', () => { if (!saved()) apply(); });
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-theme-toggle]')) toggle(); });
  // telas montadas depois (clientes, configurações) recebem o logo/ícone certo
  new MutationObserver(() => {
    const t = document.documentElement.dataset.theme || current();
    if (document.querySelector(`img[data-logo]:not([src$="${LOGO[t]}"]), [data-theme-toggle]:empty`)) apply(t);
  }).observe(document.documentElement, { childList: true, subtree: true });

  BT.ui.theme = { apply, toggle, set, choice, current, logo: () => LOGO[current()] };
  apply();
})(window.BT);
