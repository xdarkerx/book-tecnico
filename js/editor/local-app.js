/* ═══ App local (branch app-local): ⚙️ Configurações › Aplicativo ═══
 * - Banco de dados: o arquivo SQLite (caminho atual, pastas sugeridas como o OneDrive, "Escolher pasta…" do Windows)
 *   e o que fazer ao trocar: mover o banco atual, usar o banco que já está na pasta ou começar um novo.
 * - Histórico de edições: quem (usuário do Windows e máquina) mexeu em qual book e quando. Fica no próprio banco,
 *   então quem abre o mesmo arquivo (ex.: pelo OneDrive) vê as edições das outras máquinas.
 */
(function (BT) {
  const h = BT.h;
  const $ = (id) => document.getElementById(id);
  const fmt = (t) => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  async function renderDb() {
    const box = $('set-localdb'); box.innerHTML = '';
    let info;
    try { info = await BT.api.localInfo(); } catch (e) { box.append(h('div', { class: 'card set-card' }, 'Não foi possível ler as informações do app: ' + e.message)); return; }
    const pathIn = h('input', { class: 'inp mono', value: info.dbFile.replace(/[\\/][^\\/]+$/, ''), placeholder: 'C:\\Users\\voce\\OneDrive\\BookTecnico', spellcheck: 'false', autocomplete: 'off' });
    const status = h('div', { class: 'set-help', 'aria-live': 'polite' });
    const sug = h('div', { class: 'cprow', style: { marginTop: '6px' } }, info.suggestions.map((s) => h('button', { type: 'button', class: 'btn btn-ghost btn-xs', title: s.dir, onclick: () => { pathIn.value = s.dir; } }, '📁 ' + s.label)));
    const pick = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: async () => {
      pick.disabled = true; status.textContent = 'Escolha a pasta na janela do Windows (ela pode abrir atrás desta)…';
      try { const r = await BT.api.localPickFolder(pathIn.value); if (r.path) pathIn.value = r.path; status.textContent = ''; } catch (e) { status.textContent = e.message; }
      pick.disabled = false;
    } }, '📂 Escolher pasta…');
    const go = async (mode) => {
      const label = { move: 'Mover o banco atual para', use: 'Usar o banco que já está em', new: 'Começar um banco vazio em' }[mode];
      if (!(await BT.ui.modal.confirm(`${label}:\n${pathIn.value}\n\nO app passa a ler e gravar os books nesse arquivo.${mode === 'move' ? ' O arquivo antigo fica como cópia de segurança (.bak).' : ''}`, { okText: 'Confirmar', title: '💾 Banco de dados' }))) return;
      try {
        await BT.store.saveNow();
        const r = await BT.api.localSetDb(pathIn.value, mode);
        BT.ui.toast(r.changed ? `Banco agora em ${r.dbFile} (${r.counts.books} book(s))` : 'Esse já é o banco em uso.', { type: 'ok', ms: 6000 });
        if (r.changed) setTimeout(() => location.reload(), 900); // recarrega os clientes e books do novo arquivo
        else renderDb();
      } catch (e) { BT.ui.toast(e.message, { type: 'err', ms: 9000 }); }
    };
    box.append(h('div', { class: 'card set-card' }, [
      h('div', { class: 'subt', style: { marginTop: '0' } }, '💾 Arquivo do banco (SQLite)'),
      h('div', { class: 'db-status' }, [h('div', { class: 'db-pill ok' }, `🗄️ ${info.counts.books} book(s) · ${info.counts.templates || 0} template(s)`), h('code', { style: { wordBreak: 'break-all' } }, info.dbFile)]),
      h('div', { class: 'set-help' }, ['Os books, templates, conexões e o histórico ficam todos neste arquivo. Salve numa pasta do ', h('b', {}, 'OneDrive'), ' para ter cópia na nuvem e abrir em outra máquina (instale o app lá e escolha "Usar o banco que já está na pasta").']),
      h('div', { class: 'subt' }, '📁 Trocar a pasta'),
      h('div', { class: 'fd' }, [h('label', {}, 'Pasta (o arquivo se chama book-tecnico.sqlite)'), h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [h('div', { style: { flex: '1', minWidth: '260px' } }, pathIn), pick])]),
      info.suggestions.length ? sug : null,
      h('div', { class: 'set-foot', style: { flexWrap: 'wrap', gap: '8px' } }, [
        h('button', { class: 'btn btn-primary btn-sm', onclick: () => go('move') }, 'Mover o banco atual para cá'),
        h('button', { class: 'btn btn-sec btn-sm', onclick: () => go('use') }, 'Usar o banco que já está na pasta'),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => go('new') }, 'Começar um banco vazio')]),
      status,
      h('div', { class: 'set-help', style: { marginTop: '10px' } }, '⚠️ Evite abrir o mesmo banco em duas máquinas ao mesmo tempo: o OneDrive guarda a última gravação e pode criar uma cópia com o nome da máquina. Feche o app numa antes de abrir na outra.'),
      h('div', { class: 'set-help' }, `Configuração do app (onde está o banco): ${info.appDir}\\local.json`)
    ]));
  }

  async function renderHistory(q = '') {
    const box = $('set-history'); box.innerHTML = '';
    const search = h('input', { class: 'inp inp-sm', type: 'search', placeholder: 'Filtrar por usuário, máquina ou book…', value: q, style: { maxWidth: '320px' }, onkeydown: (e) => { if (e.key === 'Enter') renderHistory(e.target.value); } });
    const card = h('div', { class: 'card set-card' }, [
      h('div', { class: 'subt', style: { marginTop: '0' } }, '🕘 Histórico de edições'),
      h('div', { class: 'set-help' }, 'Quem editou cada book, de qual máquina e quando (gravações seguidas do mesmo book contam uma vez a cada 30 minutos). Inclui exclusões, restaurações e troca do banco. Fica no próprio banco: as edições feitas em outras máquinas aparecem aqui.'),
      h('div', { style: { display: 'flex', gap: '8px', margin: '8px 0' } }, [search, h('button', { class: 'btn btn-ghost btn-sm', onclick: () => renderHistory(search.value) }, '🔄 Atualizar')])
    ]);
    box.append(card);
    let rows;
    try { rows = await BT.api.edits({ q, limit: 500 }); } catch (e) { card.append(h('div', { class: 'muted' }, e.message)); return; }
    if (!rows.length) { card.append(h('div', { class: 'muted' }, q ? 'Nada encontrado.' : 'Nenhuma edição registrada ainda.')); return; }
    const t = h('table', { class: 'etbl' }, [h('tr', {}, ['Quando', 'Usuário', 'Máquina', 'O quê'].map((c) => h('th', {}, c)))]);
    rows.forEach((r) => t.append(h('tr', {}, [h('td', { style: { whiteSpace: 'nowrap' } }, fmt(r.t)), h('td', {}, r.user || ''), h('td', {}, r.machine || ''), h('td', {}, r.book ? `${r.msg} · ${r.book}` : r.msg)])));
    card.append(h('div', { class: 'tb-wrap', style: { maxHeight: '520px' } }, t));
  }

  BT.editor = BT.editor || {};
  BT.editor.localApp = { renderDb, renderHistory };
})(window.BT);
