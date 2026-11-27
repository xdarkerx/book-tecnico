/* ═══ Geração automática do book (chamada pelo servidor num navegador sem janela) ═══
 * O servidor (server/automation.js) abre o book do mês no Chromium headless e chama, nesta ordem:
 *   await BT.automation.ready()        → espera o book carregar
 *   await BT.automation.sync(perfil)   → mesma sincronização da tela (collect + applyItems), sem revisão, e salva
 *   BT.automation.html() / await BT.automation.word() / await BT.automation.pdf()  → arquivos
 * Assim o book automático sai igual ao feito à mão: mesmo código de sincronização, montagem e exportação.
 */
(function (BT) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function ready(timeout = 60000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (BT.store && BT.store.sessionId && BT.store.state && BT.store.state.meta && BT.store.state.groups) return { book: BT.store.sessionId };
      await sleep(200);
    }
    throw new Error('O book não carregou no navegador da automação.');
  }

  /** Sincroniza com as conexões do cliente usando o perfil da última sincronização manual e aplica direto. */
  async function sync(profile = {}) {
    const key = BT.api.keyOf(BT.store.sessionId);
    const T = BT.store.state;
    const { items, errors } = await BT.importer.cloud.collect(key, profile);
    BT.importer.zip.prepare(items, T);
    const touched = items.length ? await BT.importer.zip.applyItems(T, items, { opts: { kpi: true, charts: true, note: true }, risks: profile.risks }) : new Set();
    // comparativo mensal com o book do mês anterior (liga sozinho se ele existir)
    try { await BT.blocks.get('compare').autoRefresh(T); } catch (e) { /* sem comparativo */ }
    BT.store.commit(null, 'automation');
    await BT.store.saveNow();
    return { items: items.length, sections: touched.size, errors };
  }

  const html = () => BT.exporters.htmlString(BT.store.state);
  const word = () => BT.exporters.wordString(BT.store.state);

  /** Prepara a impressão (o servidor gera o PDF pelo DevTools do Chromium). Espera as imagens. */
  async function pdf() {
    const root = BT.exporters.pdfPrepare(BT.store.state);
    await Promise.all([...root.querySelectorAll('img')].map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))));
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    return true;
  }

  async function leave() { try { if (BT.lock && BT.lock.leave) await BT.lock.leave(); } catch (e) { /* sem bloqueio */ } }

  BT.automation = { ready, sync, html, word, pdf, leave };
})(window.BT);
