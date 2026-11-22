/* ═══ URL do app ═══
 *   /                                         → lista de clientes
 *   ?cliente=acme                             → anos e books do cliente
 *   ?cliente=acme&ano=2026                    → books do ano
 *   ?cliente=acme&ano=2026&mes=11&area=infracloud[&secao=<id>] → editor do book
 */
(function (BT) {
  const U = {
    get() {
      const p = new URLSearchParams(location.search);
      const o = {}; ['cliente', 'ano', 'mes', 'area', 'secao'].forEach((k) => { if (p.get(k)) o[k] = p.get(k); });
      return o;
    },
    /** Monta a URL (sem perder outros parâmetros desconhecidos). */
    href(params) {
      const p = new URLSearchParams();
      ['cliente', 'ano', 'mes', 'area', 'secao'].forEach((k) => { if (params[k]) p.set(k, params[k]); });
      const s = p.toString();
      return location.pathname + (s ? '?' + s : '');
    },
    go(params, { replace = false } = {}) {
      const url = U.href(params);
      if (url === location.pathname + location.search) return;
      try { history[replace ? 'replaceState' : 'pushState'](params, '', url); } catch (e) { /* file:// em alguns navegadores */ }
    },
    isBook: (p) => !!(p.cliente && p.ano && p.mes && p.area)
  };
  BT.url = U;
})(window.BT);
