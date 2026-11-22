/* ═══ Menu lateral e paleta de blocos recolhíveis ═══
 * - Menu (sidebar): expandido ou só ícones. Recolhido, um clique abre o menu completo por cima
 *   do editor; escolher uma seção (ou clicar fora) volta para os ícones.
 * - Paleta de blocos: expandida ou só ícones (arrastar e clicar funcionam nos dois modos).
 * A escolha fica salva no navegador (localStorage).
 */
(function (BT) {
  const $ = (id) => document.getElementById(id);
  const KEY = 'bt_ui_panels';
  const narrow = () => window.matchMedia('(max-width:900px)').matches;
  const medium = () => window.matchMedia('(max-width:1180px)').matches;
  let pref = {};
  try { pref = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { pref = {}; }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(pref)); } catch (e) { /* sem storage */ } };

  function applySidebar() {
    const app = $('app');
    app.classList.toggle('sb-mini', !!pref.sbMini && !narrow());
    app.classList.remove('sb-peek');
    const t = $('sb-toggle');
    t.textContent = pref.sbMini ? '⇥' : '⇤';
    t.title = pref.sbMini ? 'Fixar menu expandido' : 'Recolher menu (só ícones)';
  }
  function applyPalette() {
    const p = $('palette');
    // celular/tablet: sempre começa recolhida (aberta, cobriria o editor);
    // telas médias: recolhida se o usuário nunca escolheu
    const compact = narrow() || (pref.plCompact ?? medium());
    p.classList.toggle('compact', compact);
    p.classList.remove('peek');
    $('pl-toggle').title = compact ? 'Expandir blocos' : 'Recolher blocos (só ícones)';
    $('pl-toggle').querySelector('.pl-tg-ic').textContent = compact ? '⇤' : '⇥';
  }

  function setPaletteOpen(open) {
    const p = $('palette');
    p.classList.toggle('compact', !open);
    $('pl-toggle').querySelector('.pl-tg-ic').textContent = open ? '⇥' : '⇤';
    $('pl-toggle').title = open ? 'Recolher blocos' : 'Expandir blocos';
  }

  function init() {
    applySidebar(); applyPalette();
    const app = $('app'), sb = $('sidebar'), pl = $('palette');

    $('sb-toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      if (app.classList.contains('sb-peek')) { pref.sbMini = false; } else pref.sbMini = !pref.sbMini;
      persist(); applySidebar();
    });
    // recolhido: o 1º clique em qualquer lugar do menu abre o menu completo
    sb.addEventListener('click', (e) => {
      if (!app.classList.contains('sb-mini') || app.classList.contains('sb-peek')) return;
      if (e.target.closest('#sb-toggle')) return;
      e.preventDefault(); e.stopPropagation();
      app.classList.add('sb-peek');
    }, true);
    // aberto por cima: escolher uma seção recolhe de novo
    sb.addEventListener('click', (e) => {
      if (app.classList.contains('sb-peek') && e.target.closest('.ni[data-sid], .ni-cover') && !e.target.closest('.mini-btn')) setTimeout(() => app.classList.remove('sb-peek'), 120);
    });
    $('sb-backdrop').addEventListener('click', () => app.classList.remove('sb-peek'));

    $('pl-toggle').addEventListener('click', () => {
      if (pl.classList.contains('peek')) { pl.classList.remove('peek'); return; }
      if (narrow()) { setPaletteOpen(pl.classList.contains('compact')); return; } // no celular não muda a preferência salva
      pref.plCompact = !pl.classList.contains('compact'); persist(); applyPalette();
    });
    // celular: paleta aberta fecha ao tocar fora dela
    document.addEventListener('click', (e) => {
      if (narrow() && !pl.classList.contains('compact') && !pl.contains(e.target) && !e.target.closest('.modal-wrap')) setPaletteOpen(false);
    });

    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { app.classList.remove('sb-peek'); pl.classList.remove('peek'); } });
    document.addEventListener('click', (e) => {
      if (app.classList.contains('sb-peek') && !sb.contains(e.target) && !e.target.closest('.modal-wrap,.ctx-menu')) app.classList.remove('sb-peek');
    });
    let wasNarrow = narrow();
    window.addEventListener('resize', BT.core.utils.debounce(() => {
      applySidebar();
      if (narrow() !== wasNarrow) { wasNarrow = narrow(); applyPalette(); }
    }, 150));
  }

  BT.editor.panels = {
    init,
    afterAdd() { $('palette').classList.remove('peek'); if (narrow()) setPaletteOpen(false); },
    get state() { return Object.assign({}, pref); }
  };
})(window.BT);
