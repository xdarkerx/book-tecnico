/* ═══ ⚙️ Administrador › Logs e auditoria ═══
 * Abas: Requisições HTTP · Banco de dados · Demais informações · Auditoria.
 * Filtros: período, texto; HTTP pode esconder os "sinais de vida" do bloqueio de edição. Exporta CSV.
 * Servidor: server/logs.js (arquivos diários em data/logs).
 */
(function (BT) {
  const h = BT.h;
  const $ = (id) => document.getElementById(id);
  const TABS = [['http', '🌐 Requisições HTTP'], ['db', '💾 Banco de dados'], ['app', 'ℹ️ Demais informações'], ['audit', '🛡️ Auditoria']];
  const RANGES = [[3600000, 'Última hora'], [86400000, 'Últimas 24 h'], [7 * 86400000, 'Últimos 7 dias'], [30 * 86400000, 'Últimos 30 dias'], [90 * 86400000, 'Últimos 90 dias']];
  let kind = 'audit', range = 86400000, q = '', hideBeats = true, rows = [];

  const ts = (t) => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const COLS = {
    http: [['Quando', (e) => ts(e.t)], ['Método', (e) => e.method], ['Caminho', (e) => e.path, 'mono wrap'], ['Status', (e) => h('span', { class: 'lg-st s' + String(e.status)[0] }, String(e.status))], ['Tempo', (e) => e.ms + ' ms'], ['Usuário', (e) => e.user || '—'], ['IP', (e) => e.ip || '', 'mono']],
    db: [['Quando', (e) => ts(e.t)], ['Operação', (e) => e.op, 'mono'], ['Alvo', (e) => e.target, 'mono wrap'], ['Banco', (e) => e.backend], ['Tempo', (e) => e.ms + ' ms'], ['Resultado', (e) => (e.ok ? h('span', { class: 'lg-st s2' }, 'ok') : h('span', { class: 'lg-st s5', title: e.error }, 'erro: ' + e.error))], ['Usuário', (e) => e.user || '—']],
    app: [['Quando', (e) => ts(e.t)], ['Nível', (e) => h('span', { class: 'lg-lv ' + e.level }, e.level)], ['Mensagem', (e) => [e.msg, e.data && e.data.stack ? h('pre', { class: 'lg-pre' }, e.data.stack) : null], 'wrap'], ['Usuário', (e) => e.user || '—']],
    audit: [['Quando', (e) => ts(e.t)], ['Ação', (e) => h('span', { class: 'lg-act' }, e.action)], ['O que aconteceu', (e) => e.msg, 'wrap'], ['Quem', (e) => e.user || (e.data && e.data.by) || '—'], ['IP', (e) => e.ip || (e.data && e.data.ip) || '', 'mono']]
  };

  async function render() {
    const box = $('set-logs'); box.innerHTML = '';
    const table = h('div', { class: 'acc-table-wrap lg-wrap' });
    const count = h('span', { class: 'muted' });
    const load = async () => {
      table.innerHTML = ''; table.appendChild(h('div', { class: 'st-empty' }, 'Carregando…'));
      try { rows = await BT.api.logs(kind, { from: Date.now() - range, q, limit: 1000 }); }
      catch (e) { table.innerHTML = ''; table.appendChild(h('div', { class: 'db-result err' }, e.message)); return; }
      if (kind === 'http' && hideBeats) rows = rows.filter((e) => !(e.path === '/api/lock' || e.path.startsWith('/api/lock?') || e.path.startsWith('/api/session')));
      count.textContent = `${rows.length} registro(s)${rows.length >= 1000 ? ' (limite — refine o filtro)' : ''}`;
      table.innerHTML = '';
      if (!rows.length) { table.appendChild(h('div', { class: 'st-empty' }, 'Nenhum registro no período.')); return; }
      const cols = COLS[kind];
      table.appendChild(h('table', { class: 'acc-table lg-table' }, [
        h('thead', {}, h('tr', {}, cols.map((c) => h('th', {}, c[0])))),
        h('tbody', {}, rows.map((e) => h('tr', {}, cols.map((c) => h('td', { class: c[2] || '' }, [].concat(c[1](e)))))))
      ]));
    };
    let timer = null;
    const tabs = h('div', { class: 'cx-tabs', role: 'tablist' }, TABS.map(([k, l]) => h('button', { role: 'tab', 'aria-selected': String(k === kind), class: k === kind ? 'on' : '', onclick: () => { kind = k; render(); } }, l)));
    box.appendChild(h('div', { class: 'card set-card' }, [
      h('div', { class: 'subt', style: { marginTop: 0 } }, '📜 Logs e auditoria'),
      h('div', { class: 'set-help' }, 'Guardados em data/logs (um arquivo por dia). Requisições, banco e demais informações: 90 dias; auditoria: 1 ano. Senhas e tokens nunca são registrados.'),
      tabs,
      h('div', { class: 'tr-tools' }, [
        h('input', { class: 'inp inp-sm', type: 'search', value: q, placeholder: 'Filtrar (usuário, caminho, cliente, GUID…)', 'aria-label': 'Filtrar logs', oninput: (e) => { q = e.target.value; clearTimeout(timer); timer = setTimeout(load, 350); } }),
        h('select', { class: 'inp inp-sm', 'aria-label': 'Período', onchange: (e) => { range = Number(e.target.value); load(); } }, RANGES.map(([v, l]) => h('option', { value: v, selected: v === range }, l))),
        kind === 'http' ? h('label', { class: 'switch' }, [h('input', { type: 'checkbox', checked: hideBeats, onchange: (e) => { hideBeats = e.target.checked; load(); } }), 'Ocultar sinais de vida']) : null,
        h('button', { class: 'btn btn-ghost btn-sm', onclick: load }, '↻ Atualizar'),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: csv }, '⬇ CSV'),
        count
      ]),
      table
    ]));
    load();
  }

  function csv() {
    if (!rows.length) return BT.ui.toast('Nada para exportar.');
    const keys = [...new Set(rows.flatMap((e) => Object.keys(e)))];
    const cell = (v) => { const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const out = [keys.join(';'), ...rows.map((e) => keys.map((k) => cell(k === 't' ? new Date(e.t).toISOString() : e[k])).join(';'))].join('\n');
    const a = h('a', { href: URL.createObjectURL(new Blob(['﻿' + out], { type: 'text/csv;charset=utf-8' })), download: `book-tecnico-log-${kind}-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.appendChild(a); a.click(); a.remove();
  }

  BT.editor.logs = { render };
})(window.BT);
