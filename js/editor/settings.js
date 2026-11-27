/* ═══ ⚙️ Configurações globais ═══
 * - Template padrão e quais menus/seções de cada template aparecem nos novos books
 * - Menus extras para todos os books
 * - Comparativo mensal por padrão
 * - Armazenamento: SQLite ou MongoDB (com migração, teste e configuração da conexão do Mongo)
 * Dois menus: Usuário (Preferências, Opções de book — todos) e Administrador (Banco, Login e acesso, Edição simultânea,
 *   Backup, Lixeira, Logs). Painéis do admin: access-settings.js, admin-backup.js, admin-trash.js, admin-logs.js
 * Marcação em html/settings.html; aqui só a lógica.
 */
(function (BT) {
  const h = BT.h;
  const $ = (id) => document.getElementById(id);
  let S = null;         // configurações em edição
  let tplCache = [];

  // ── Menus: Usuário (todos) e Administrador ─────────────
  const PANELS = [
    { group: 'Usuário', items: [['prefs', '🎨', 'Preferências'], ['book', '🧭', 'Opções de book'], ['import', '📥', 'Importação padrão']] },
    { group: 'Administrador', admin: true, items: [['defaults', '📋', 'Padrões da equipe'], ['mail', '✉️', 'E-mail e automação'], ['db', '💾', 'Banco de dados'], ['access', '🔐', 'Login e acesso'], ['lock', '🔒', 'Edição simultânea'], ['backup', '🗄️', 'Backup'], ['trash', '🗑️', 'Lixeira'], ['logs', '📜', 'Logs e auditoria']] }
  ];
  // app local: sem login, MongoDB, edição simultânea, backup do servidor nem e-mail/book automático
  const LOCAL_PANELS = [
    PANELS[0],
    { group: 'Aplicativo', admin: true, items: [['defaults', '📋', 'Padrões da equipe'], ['localdb', '💾', 'Banco de dados'], ['history', '🕘', 'Histórico de edições'], ['trash', '🗑️', 'Lixeira']] }
  ];
  const panels = () => (BT.api.local ? LOCAL_PANELS : PANELS);
  const ADMIN_RENDER = { localdb: () => BT.editor.localApp.renderDb(), history: () => BT.editor.localApp.renderHistory(), defaults: () => { drawTeamDefaults(); $('set-save-defaults').onclick = () => save('Padrões da equipe salvos ✓ — valem para os próximos books e importações'); }, mail: () => BT.editor.automation.renderAdmin(), import: () => BT.editor.importDefaults.render(), access: () => BT.editor.access.render(), lock: () => BT.editor.access.render(), backup: () => BT.editor.backup.render(), trash: () => BT.editor.trash.render(), logs: () => BT.editor.logs.render(), db: () => { drawStorage(); BT.editor.backup.renderDbDelete(); } };
  let panel = null;
  const isAdmin = () => BT.auth.isAdmin && BT.api.mode === 'server';

  function drawNav() {
    const nav = $('set-nav'); nav.innerHTML = '';
    panels().filter((g) => !g.admin || isAdmin()).forEach((g) => {
      nav.appendChild(h('div', { class: 'set-nav-g' }, g.group));
      g.items.forEach(([id, ic, label]) => nav.appendChild(h('button', { class: 'set-nav-i' + (id === panel ? ' on' : ''), 'aria-current': id === panel ? 'page' : null, 'data-p': id, onclick: () => show(id) }, [h('span', { class: 'ic', 'aria-hidden': 'true' }, ic), label])));
    });
  }
  function show(id) {
    if (BT.api.local) id = { db: 'localdb', logs: 'history' }[id] || id; // atalhos do site levam aos painéis do app local
    const ok = panels().some((g) => (!g.admin || isAdmin()) && g.items.some((x) => x[0] === id));
    panel = ok ? id : 'prefs';
    try { localStorage.setItem('bt-settings-panel', panel); } catch (e) { /* nada */ }
    document.querySelectorAll('#settings .set-panel').forEach((el) => { el.hidden = el.dataset.panel !== panel; });
    drawNav();
    const on = document.querySelector('#set-nav .set-nav-i.on');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' }); // menu horizontal no celular
    if (ADMIN_RENDER[panel]) ADMIN_RENDER[panel]();
    $('settings').scrollTop = 0;
  }

  function drawTheme() {
    const box = $('set-theme'); box.innerHTML = '';
    const cur = BT.ui.theme.choice();
    [['light', '☀️', 'Claro'], ['dark', '🌙', 'Escuro'], ['system', '🖥️', 'Igual ao sistema']].forEach(([v, ic, l]) => box.appendChild(h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(v === cur), class: 'theme-card t-' + v + (v === cur ? ' on' : ''),
      onclick: () => { BT.ui.theme.set(v); drawTheme(); BT.ui.toast(`Tema: ${l}`, { type: 'ok', ms: 1500 }); }
    }, [h('span', { class: 'theme-prev', 'aria-hidden': 'true' }, [h('i'), h('i'), h('i')]), h('b', {}, [ic + ' ', l])])));
  }

  async function open(which) {
    const root = $('settings');
    root.hidden = false; document.body.classList.add('start-open');
    root.querySelectorAll('[data-set-close]').forEach((b) => (b.onclick = close));
    root.onkeydown = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal-wrap')) close(); };
    chosen = null;
    S = await BT.api.getSettings();
    S.defaults = Object.assign({ template: 'infracloud', disabled: {}, extraGroups: [], comparativo: true }, S.defaults);
    tplCache = await BT.data.templates.all();
    const opts = (sel, val) => { sel.innerHTML = ''; tplCache.forEach((t) => sel.appendChild(h('option', { value: t.id, selected: t.id === val }, `${t.icon} ${t.name}`))); };
    opts($('set-template'), S.defaults.template);
    opts($('set-template-edit'), S.defaults.template);
    $('set-template').onchange = (e) => { S.defaults.template = e.target.value; $('set-template-edit').value = e.target.value; drawTree(); };
    $('set-template-edit').onchange = drawTree;
    $('set-compare').checked = !!S.defaults.comparativo;
    $('set-compare').onchange = (e) => (S.defaults.comparativo = e.target.checked);
    $('set-add-extra').onclick = () => { S.defaults.extraGroups.push({ title: 'Novo menu', icon: '📁', separator: true, sections: [{ title: 'Nova seção' }] }); drawExtras(); };
    $('set-save').onclick = () => save();
    drawTheme(); drawTree(); drawExtras();
    let last = 'prefs'; try { last = localStorage.getItem('bt-settings-panel') || last; } catch (e) { /* nada */ }
    show(which || last);
  }
  function close() { $('settings').hidden = true; if (!document.querySelector('#start:not([hidden])')) document.body.classList.remove('start-open'); }

  async function drawTree() {
    const id = $('set-template-edit').value;
    const st = await BT.data.templates.build(id, { applyDefaults: false });
    const off = new Set(S.defaults.disabled[id] || []);
    const tree = $('set-tree'); tree.innerHTML = '';
    const set = (key, on) => { on ? off.delete(key) : off.add(key); S.defaults.disabled[id] = [...off]; };
    st.groups.forEach((g) => {
      const secs = h('div', { class: 'set-s' }, g.sections.map((s) => h('label', { class: 'chk' }, [h('input', { type: 'checkbox', checked: !off.has(g.title + '/' + s.title), onchange: (e) => set(g.title + '/' + s.title, e.target.checked) }), `${s.icon} ${s.title}`])));
      tree.appendChild(h('div', { class: 'set-g' }, [h('label', { class: 'chk' }, [h('input', { type: 'checkbox', checked: !off.has(g.title), onchange: (e) => { set(g.title, e.target.checked); secs.style.opacity = e.target.checked ? 1 : 0.4; } }), `${g.icon} ${g.title}`]), secs]));
      if (off.has(g.title)) secs.style.opacity = 0.4;
    });
  }

  function drawExtras() {
    const box = $('set-extras'); box.innerHTML = '';
    if (!S.defaults.extraGroups.length) box.appendChild(h('div', { class: 'set-help' }, 'Nenhum menu extra.'));
    S.defaults.extraGroups.forEach((eg, i) => box.appendChild(h('div', { class: 'set-extra' }, [
      h('input', { class: 'inp inp-sm', value: eg.icon || '📁', maxlength: 4, style: { textAlign: 'center' }, oninput: (e) => (eg.icon = e.target.value) }),
      h('input', { class: 'inp inp-sm', value: eg.title, placeholder: 'Nome do menu', oninput: (e) => (eg.title = e.target.value) }),
      h('button', { class: 'mini-btn', title: 'Remover', onclick: () => { S.defaults.extraGroups.splice(i, 1); drawExtras(); } }, '✕'),
      h('textarea', { class: 'inp inp-sm', placeholder: 'Uma seção por linha', oninput: (e) => (eg.sections = e.target.value.split('\n').map((t) => t.trim()).filter(Boolean).map((t) => ({ title: t }))) }, (eg.sections || []).map((s) => s.title).join('\n'))
    ])));
  }

  // ── Armazenamento: SQLite ou MongoDB ────────────────────
  const DB = {
    sqlite: { icon: '🗄️', name: 'SQLite', desc: 'Arquivo local, sem instalar nada. Backup = copiar o arquivo.' },
    mongo: { icon: '🍃', name: 'MongoDB', desc: 'Servidor de banco — ideal para equipe e vários servidores.' }
  };
  let chosen = null;

  function statusLine(info) {
    const box = $('set-storage-now'); box.innerHTML = '';
    if (BT.api.mode !== 'server') {
      box.appendChild(h('div', { class: 'db-pill warn' }, '🧭 Sem servidor — os books ficam só neste navegador. Rode "npm run dev" ou o container para usar SQLite ou MongoDB.'));
      return;
    }
    const st = info.connected === false ? 'err' : 'ok';
    const counts = info.counts ? `${info.counts.books} book(s) · ${info.counts.templates} template(s) · ${info.counts.connections} cliente(s) com conexões` : '';
    box.appendChild(h('div', { class: 'db-pill ' + st }, [
      h('span', { class: 'dot' }), h('b', {}, info.label || '—'),
      h('span', {}, info.connected === false ? 'sem conexão' : 'conectado')
    ]));
    if (info.location) box.appendChild(h('div', { class: 'db-loc mono', title: info.location }, info.location));
    if (counts) box.appendChild(h('div', { class: 'db-counts' }, counts));
    if (info.error) box.appendChild(h('div', { class: 'db-result err' }, info.error));
    if (info.lockedByEnv) box.appendChild(h('div', { class: 'set-help' }, ['Banco fixado no servidor pela variável ', h('code', {}, `BOOK_STORAGE=${info.storage}`), '. Para trocar, altere essa variável (ex.: no docker-compose.yml).']));
  }

  function drawStorage() {
    const info = S.storageInfo || {};
    const server = BT.api.mode === 'server';
    const locked = !server || !!info.lockedByEnv;
    chosen = chosen && chosen !== info.storage ? chosen : info.storage;
    statusLine(info);

    const box = $('set-storage-opts'); box.innerHTML = '';
    (info.options || []).forEach(([v]) => {
      const d = DB[v] || { icon: '💾', name: v, desc: '' };
      const active = v === info.storage;
      box.appendChild(h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(v === chosen), disabled: locked && !active,
        class: 'db-card' + (v === chosen ? ' on' : '') + (active ? ' active' : ''),
        onclick: () => { if (locked) return; chosen = v; drawStorage(); }
      }, [
        h('span', { class: 'db-ic' }, d.icon),
        h('span', { class: 'db-txt' }, [h('b', {}, d.name), h('small', {}, d.desc)]),
        active ? h('span', { class: 'db-badge' }, 'Em uso') : null
      ]));
    });

    // conexão do Mongo: aparece quando o Mongo está em uso ou selecionado
    const m = info.mongo || {};
    const fromEnv = m.fromEnv || {};
    const showMongo = server && (chosen === 'mongo' || info.storage === 'mongo');
    $('set-mongo').hidden = !showMongo;
    if (showMongo) {
      $('set-mongo-url').value = m.url || ''; $('set-mongo-db').value = m.db || '';
      $('set-mongo-url').disabled = !!fromEnv.url; $('set-mongo-db').disabled = !!fromEnv.db;
      $('set-mongo-url').title = fromEnv.url ? 'Definido pela variável MONGO_URL no servidor' : '';
      $('set-mongo-save').hidden = !!(fromEnv.url && fromEnv.db);
    }
    const cfg = () => ({ url: $('set-mongo-url').value.trim(), db: $('set-mongo-db').value.trim() });
    const result = (ok, msg) => { const r = $('set-mongo-result'); r.hidden = false; r.className = 'db-result ' + (ok ? 'ok' : 'err'); r.textContent = msg; };
    $('set-mongo-result').hidden = true;
    $('set-mongo-test').onclick = () => busy($('set-mongo-test'), async () => {
      try { const r = await BT.api.testMongo(cfg()); result(true, `✓ Conectado a ${r.url || 'MongoDB'}`); }
      catch (e) { result(false, e.message); }
    });
    $('set-mongo-save').onclick = () => busy($('set-mongo-save'), async () => {
      try { await BT.api.saveMongoConfig(cfg()); await refreshStorage(); result(true, '✓ Conexão salva'); }
      catch (e) { result(false, e.message); }
    });

    const canSwitch = server && !info.lockedByEnv && chosen !== info.storage;
    $('set-switch-box').hidden = !canSwitch;
    $('set-switch').textContent = `Trocar para ${(DB[chosen] || {}).name || chosen}`;
    $('set-switch').onclick = () => busy($('set-switch'), async () => {
      const to = chosen, mig = $('set-migrate').checked;
      if (!(await BT.ui.modal.confirm(`Trocar o armazenamento para ${DB[to].name}?${mig ? ' Os dados atuais serão copiados para lá.' : ' Os dados atuais NÃO serão copiados.'}`, { okText: 'Trocar' }))) return;
      try {
        if (to === 'mongo' && !$('set-mongo-save').hidden && cfg().url !== (m.url || '')) await BT.api.saveMongoConfig(cfg());
        await BT.store.saveNow();
        const r = await BT.api.switchStorage(to, mig);
        BT.ui.toast(`✓ Agora salvando em ${DB[to].name}${r.migrated ? ` — ${r.migrated.books} book(s), ${r.migrated.templates} template(s), ${r.migrated.connections} conexão(ões) copiados` : ''}`, { type: 'ok', ms: 7000 });
        chosen = null; await refreshStorage();
      } catch (e) { BT.ui.toast(e.message, { type: 'err', ms: 8000 }); }
    });
  }
  async function refreshStorage() {
    try { S.storageInfo = await BT.api.storageStatus(); BT.api.storage = S.storageInfo; } catch (e) { /* mantém o anterior */ }
    drawStorage();
  }
  /** Desabilita o botão e mostra ⏳ enquanto a ação roda. */
  async function busy(btn, fn) {
    if (btn.disabled) return;
    const txt = btn.textContent; btn.disabled = true; btn.textContent = '⏳ ' + txt.replace(/^\S+\s/, '');
    try { await fn(); } finally { btn.disabled = false; if (btn.textContent.startsWith('⏳')) btn.textContent = txt; }
  }

  // ── Padrões da equipe: o que já vem marcado nos books novos e nas importações (BT.data.defaults) ──
  function drawTeamDefaults() {
    const box = $('set-team-defaults'); if (!box || !S) return; box.innerHTML = ''; // S: configurações ainda carregando
    const D = BT.data.defaults;
    const cur = D.load(S.defaults); // de fábrica + o que a equipe já salvou
    const b = S.defaults.blockDefaults = JSON.parse(JSON.stringify(cur.blocks));
    const im = S.defaults.importDefaults = JSON.parse(JSON.stringify(cur.import));
    const chk = (obj, k, label) => h('label', { class: 'cp' }, [h('input', { type: 'checkbox', checked: !!obj[k], onchange: (e) => (obj[k] = e.target.checked) }), label]);
    const inList = (arr, v, label) => h('label', { class: 'cp' }, [h('input', { type: 'checkbox', checked: arr.includes(v), onchange: (e) => { const i = arr.indexOf(v); if (e.target.checked && i < 0) arr.push(v); if (!e.target.checked && i >= 0) arr.splice(i, 1); } }), label]);
    const radio = (obj, k, name, opts) => h('div', { class: 'cprow', role: 'radiogroup' }, opts.map(([v, l]) => h('label', { class: 'cp' }, [h('input', { type: 'radio', name, checked: obj[k] === v, onchange: () => (obj[k] = v) }), l])));
    box.append(
      h('div', { class: 'subt', style: { marginTop: '14px' } }, '✅ O que já vem marcado nos books novos'),
      h('div', { class: 'set-help' }, 'Vale para books criados do zero. Um book copiado (⧉ próximo mês) mantém o que estava no original.'),
      h('div', { class: 'lbl', style: { margin: '10px 0 6px' } }, '📈 Comparativo mensal'),
      h('div', { class: 'cprow' }, [chk(b, 'compareHideUnchanged', 'Ocultar itens sem mudança')]),
      h('div', { class: 'set-help' }, 'O comparativo liga sozinho quando existe o book do mês anterior; sem ele, fica desligado.'),
      h('div', { class: 'lbl', style: { margin: '12px 0 6px' } }, '🛡️ Cloud Security Score (todas as clouds)'),
      h('div', { class: 'cprow' }, [chk(b.scoreShow, 'recs', '💡 Recomendações'), chk(b.scoreShow, 'alerts', '🚨 Problemas / alertas'), chk(b.scoreShow, 'charts', '📊 Gráficos de risco'),
        chk(b.scoreShow, 'compare', '↔️ Comparativo com o mês passado'), chk(b.scoreShow, 'evolution', '📈 Gráfico de evolução')]),
      h('div', { class: 'set-help' }, 'Comparativo e evolução só aparecem quando há pontuação de um mês anterior.'),
      h('div', { class: 'lbl', style: { margin: '12px 0 6px' } }, '🗺️ Topologia de rede'),
      radio(b, 'topologyStyle', 'td-topo', [['compact', '▦ Compacto'], ['detailed', '🗺️ Detalhado']]),
      h('div', { class: 'subt' }, '📥 Importação padrão da equipe'),
      h('div', { class: 'set-help' }, 'O que já vem marcado ao sincronizar e ao revisar uma importação.'),
      h('div', { class: 'lbl', style: { margin: '10px 0 6px' } }, '📡 Zabbix — severidades dos alertas'),
      h('div', { class: 'cprow' }, [[5, '🟥 Desastre'], [4, '🟧 Alta'], [3, '🟨 Média'], [2, '🟦 Atenção'], [1, 'ℹ️ Informação'], [0, '⬜ Não classificado']].map(([v, l]) => inList(im.zabbixSeverities, v, l))),
      h('div', { class: 'cprow', style: { marginTop: '6px' } }, [chk(im, 'zabbixAllHosts', 'Incluir servidores sem nenhum alerta no período (Monitoramento)')]),
      h('div', { class: 'lbl', style: { margin: '12px 0 6px' } }, '🛡️ Segurança — riscos das recomendações e alertas'),
      h('div', { class: 'cprow' }, (BT.blocks.RISK_LEVELS || []).map(([k, l]) => inList(im.risks, k, l))),
      h('div', { class: 'lbl', style: { margin: '12px 0 6px' } }, '🗄️ Backup'),
      radio(im, 'backupMode', 'td-bk', [['policies', 'Só as políticas / agendamentos'], ['jobs', 'Só os backups feitos no mês'], ['both', 'Backups feitos e políticas']]),
      h('div', { class: 'cprow', style: { marginTop: '10px' } }, [h('button', { type: 'button', class: 'btn btn-ghost btn-xs', onclick: () => { S.defaults.blockDefaults = JSON.parse(JSON.stringify(D.FACTORY.blocks)); S.defaults.importDefaults = JSON.parse(JSON.stringify(D.FACTORY.import)); drawTeamDefaults(); } }, '↺ Voltar ao padrão de fábrica')])
    );
  }

  async function save(okMsg) {
    try {
      if (S.defaults.importDefaults && !(S.defaults.importDefaults.zabbixSeverities || []).length) throw new Error('Escolha ao menos uma severidade do Zabbix nos padrões da equipe.');
      await BT.api.saveSettings({ defaults: S.defaults });
      BT.data.defaults.load(S.defaults); // vale já nesta tela
      BT.ui.toast(okMsg || 'Opções de book salvas ✓ — valem para os próximos books', { type: 'ok' });
    } catch (e) { BT.ui.toast(e.message, { type: 'err' }); }
  }

  BT.editor.settings = { open, close, show, refreshStorage: () => refreshStorage() };
})(window.BT);
