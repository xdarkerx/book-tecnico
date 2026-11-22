/* ═══ Bloco: Comparativo mensal ═══
 * Compara este book com outro book do mesmo cliente (padrão: mês anterior, mesma área).
 * data = {
 *   title, enabled,                       ← liga/desliga o comparativo (desligado = não aparece no book)
 *   against: { ano, mes, area } | null,   ← null = mês anterior automático
 *   prev: { label, key, fetchedAt, metrics:{ id:{label, value} } } ← foto do outro book (guardada no bloco)
 *   selected: [ids] | null,               ← métricas escolhidas (null = todas)
 *   manual: [{ label, prev, cur }],       ← linhas digitadas à mão
 *   showChart, chartKind ('column'|'bar'), showTable, hideUnchanged, hideIfNoDiff
 * }
 * Métricas automáticas: quantidade de linhas de cada planilha, valores numéricos de indicadores (KPI)
 * e totais do relatório Zabbix (hosts, alertas).
 */
(function (BT) {
  const h = BT.h;
  const num = (v) => BT.charts.num(v);
  const isNum = (v) => String(v ?? '').trim() !== '' && !isNaN(num(v)) && /\d/.test(String(v));

  /** Extrai as métricas comparáveis de um estado de book. */
  function metricsOf(state) {
    const out = {};
    (state.groups || []).forEach((g) => g.sections.forEach((s) => s.blocks.forEach((b, bi) => {
      if (b.include === false) return;
      const where = g.title === s.title ? s.title : `${g.title} › ${s.title}`;
      if (b.type === 'table') {
        const n = (b.data.rows || []).filter((r) => r.some((v) => String(v || '').trim())).length;
        const id = `tbl:${g.title}/${s.title}/${b.data.title || bi}`;
        out[id] = { label: `${where}${b.data.title ? ' › ' + b.data.title : ''} (itens)`, value: n };
      } else if (b.type === 'kpi') {
        (b.data.items || []).forEach((it) => { if (isNum(it.value)) out[`kpi:${g.title}/${s.title}/${it.label}`] = { label: `${it.label}`, value: num(it.value) }; });
      } else if (b.type === 'monitor' && b.data.z) {
        const z = b.data.z;
        if (z.totalHosts != null) out[`zbx:hosts:${s.title}`] = { label: 'Hosts monitorados', value: num(z.totalHosts) };
        if (z.totalAlerts != null) out[`zbx:alerts:${s.title}`] = { label: 'Alertas no período', value: num(z.totalAlerts) };
      }
    })));
    return out;
  }

  const MONTHS = () => BT.session.MONTHS;
  const pad = (m) => String(m).padStart(2, '0');
  const label = (mes, ano) => `${pad(mes)}/${ano}`;
  function prevMonth(mes, ano) { mes = Number(mes); ano = Number(ano); return mes <= 1 ? { mes: '12', ano: String(ano - 1) } : { mes: pad(mes - 1), ano: String(ano) }; }

  function curKey() { return BT.store.sessionId ? BT.api.keyOf(BT.store.sessionId) : null; }
  function targetKey(d) {
    const k = curKey(); if (!k) return null;
    const a = d.against || prevMonth(k.mes, k.ano);
    return { cliente: k.cliente, ano: a.ano, mes: pad(a.mes), area: a.area || k.area };
  }

  /** Busca o outro book e guarda a foto das métricas no bloco. */
  async function refresh(d) {
    const k = targetKey(d); if (!k) throw new Error('Abra um book para comparar.');
    const st = await BT.api.getBook(k);
    if (!st) { d.prev = { label: label(k.mes, k.ano), key: BT.api.keyOf(k).id, missing: true, fetchedAt: Date.now(), metrics: {} }; return false; }
    d.prev = { label: label(k.mes, k.ano), key: BT.api.keyOf(k).id, fetchedAt: Date.now(), metrics: metricsOf(st) };
    return true;
  }

  /** Linhas do comparativo: [{id,label,prev,cur,diff}] */
  function rowsOf(d, state) {
    const cur = metricsOf(state || BT.store.state);
    const prev = (d.prev && d.prev.metrics) || {};
    const ids = [...new Set([...Object.keys(prev), ...Object.keys(cur)])];
    let rows = ids.map((id) => ({ id, label: (cur[id] || prev[id]).label, prev: prev[id] ? prev[id].value : 0, cur: cur[id] ? cur[id].value : 0 }));
    if (d.selected) rows = rows.filter((r) => d.selected.includes(r.id));
    rows = rows.concat((d.manual || []).filter((m) => m.label).map((m, i) => ({ id: 'man:' + i, label: m.label, prev: num(m.prev), cur: num(m.cur), manual: true })));
    rows.forEach((r) => (r.diff = Math.round((r.cur - r.prev) * 100) / 100));
    return rows;
  }
  const visibleRows = (d, state) => rowsOf(d, state).filter((r) => !(d.hideUnchanged && r.diff === 0));
  const curLabel = (state) => { const m = (state || BT.store.state).meta || {}; return m.mes && m.ano ? label(m.mes, m.ano) : 'Atual'; };

  function varBadge(r, word) {
    const pct = r.prev ? ` (${r.diff > 0 ? '+' : ''}${Math.round((r.diff / r.prev) * 1000) / 10}%)` : '';
    const [txt, bg, fg] = r.diff > 0 ? [`▲ +${r.diff}${pct}`, '#e6f4ee', '#0e7a50'] : r.diff < 0 ? [`▼ ${r.diff}${pct}`, '#fdecee', '#b5192a'] : ['= sem mudança', '#f0f0f6', '#7a7f9c'];
    return word ? `<span style="color:${fg};font-weight:bold">${txt}</span>` : `<span class="cmp-var" style="background:${bg};color:${fg}">${txt}</span>`;
  }

  function chartSvg(d, rows, state, width = 640) {
    const r = rows.filter((x) => x.prev || x.cur).slice(0, 14);
    return BT.charts.svg({ kind: d.chartKind || 'column', labels: r.map((x) => x.label.replace(/ \(itens\)$/, '')), series: [{ name: (d.prev && d.prev.label) || 'Anterior', values: r.map((x) => x.prev) }, { name: curLabel(state), values: r.map((x) => x.cur) }], width, height: Number(d.height) || 260, showValues: true, legend: true });
  }

  function summaryText(rows) {
    const ch = rows.filter((r) => r.diff !== 0);
    if (!ch.length) return 'Sem diferenças em relação ao mês de comparação.';
    return `${ch.length} de ${rows.length} indicador(es) mudaram: ${ch.filter((r) => r.diff > 0).length} aumentaram e ${ch.filter((r) => r.diff < 0).length} diminuíram.`;
  }

  BT.blocks.register('compare', {
    label: 'Comparativo mensal', icon: '📈', desc: 'Compara com outro mês (ex.: 10/2026 → 11/2026) — gráfico e variação', order: 47,
    create: () => ({ title: 'Comparativo mensal', enabled: true, against: null, prev: null, selected: null, manual: [], showChart: true, chartKind: 'column', showTable: true, hideUnchanged: false, hideIfNoDiff: false, height: 260 }),
    isEmpty(b) {
      const d = b.data;
      if (d.enabled === false) return true;
      if (!d.prev && !(d.manual || []).length) return true;
      const rows = visibleRows(d);
      if (!rows.length) return true;
      return !!d.hideIfNoDiff && rows.every((r) => r.diff === 0);
    },
    metricsOf, rowsOf,

    editor(block, ctx) {
      const d = block.data;
      d.manual = d.manual || [];
      const save = () => { ctx.save(); redraw(); };
      const k = curKey();

      // ── liga/desliga ──
      const onOff = h('label', { class: 'switch cmp-switch' }, [h('input', { type: 'checkbox', checked: d.enabled !== false, onchange: (e) => { d.enabled = e.target.checked; body.style.display = d.enabled ? '' : 'none'; ctx.save(); } }), h('b', {}, 'Ativar comparativo neste book')]);

      // ── mês de comparação ──
      const status = h('span', { class: 'cmp-status' });
      const monthSel = h('select', { class: 'inp inp-sm' });
      const yearIn = h('input', { class: 'inp inp-sm', style: { width: '76px' }, type: 'number' });
      const auto = h('label', { class: 'chk' }, [h('input', { type: 'checkbox', checked: !d.against, onchange: (e) => { d.against = e.target.checked ? null : Object.assign({}, prevMonth(k ? k.mes : 1, k ? k.ano : 2026)); fillMonth(); load(); } }), 'Mês anterior (automático)']);
      MONTHS().forEach((n, i) => monthSel.appendChild(h('option', { value: pad(i + 1) }, n)));
      const fillMonth = () => {
        const t = targetKey(d) || { mes: '01', ano: '' };
        monthSel.value = t.mes; yearIn.value = t.ano;
        monthSel.disabled = yearIn.disabled = !d.against;
      };
      const changeAgainst = () => { d.against = { mes: monthSel.value, ano: String(yearIn.value) }; load(); };
      monthSel.onchange = changeAgainst; yearIn.onchange = changeAgainst;
      const btn = h('button', { class: 'btn btn-sec btn-sm', onclick: () => load(true) }, '🔄 Atualizar dados');

      async function load(force) {
        if (!force && d.prev && d.prev.key === (targetKey(d) && BT.api.keyOf(targetKey(d)).id)) return redraw();
        status.textContent = 'carregando…';
        try {
          const found = await refresh(d);
          ctx.save();
          if (!found) BT.ui.toast(`Não há book de ${d.prev.label} para este cliente/área — preencha as linhas manuais ou escolha outro mês.`, { ms: 6000 });
        } catch (e) { BT.ui.toast(e.message, { type: 'err' }); }
        redraw();
      }

      // ── opções ──
      const chk = (key, txt) => h('label', { class: 'chk' }, [h('input', { type: 'checkbox', checked: !!d[key], onchange: (e) => { d[key] = e.target.checked; save(); } }), txt]);
      const kindSel = h('select', { class: 'inp inp-sm', onchange: (e) => { d.chartKind = e.target.value; save(); } }, [['column', '📊 Colunas'], ['bar', '📶 Barras'], ['line', '📈 Linha']].map(([v, l]) => h('option', { value: v, selected: (d.chartKind || 'column') === v }, l)));
      const opts = h('div', { class: 'img-opts' }, [chk('showChart', 'Gráfico'), kindSel, chk('showTable', 'Tabela de variação'), chk('hideUnchanged', 'Ocultar itens sem mudança'), chk('hideIfNoDiff', 'Não mostrar no book se nada mudou')]);

      // ── métricas ──
      const metricsBox = h('div', { class: 'cmp-metrics' });
      const manualBox = h('div', { class: 'cmp-manual' });
      const preview = h('div', { class: 'cmp-preview' });

      function redraw() {
        status.innerHTML = d.prev ? (d.prev.missing ? `⚠ sem book em <b>${BT.esc(d.prev.label)}</b>` : `comparando <b>${BT.esc(d.prev.label)}</b> → <b>${BT.esc(curLabel(ctx.state))}</b> · atualizado ${new Date(d.prev.fetchedAt).toLocaleString('pt-BR')}`) : 'ainda não carregado';
        const all = rowsOf(Object.assign({}, d, { selected: null, manual: [] }), ctx.state);
        metricsBox.innerHTML = '';
        if (!all.length) metricsBox.appendChild(h('div', { class: 'set-help' }, 'Nenhuma métrica automática (planilhas, indicadores ou Zabbix) nos dois books.'));
        else {
          metricsBox.appendChild(h('div', { class: 'cmp-mhead' }, [h('span', {}, 'Métricas'), h('button', { class: 'btn btn-ghost btn-xs', onclick: () => { d.selected = null; save(); } }, '☑ Tudo'), h('button', { class: 'btn btn-ghost btn-xs', onclick: () => { d.selected = []; save(); } }, '☐ Nenhum'), h('button', { class: 'btn btn-ghost btn-xs', title: 'Só as que mudaram', onclick: () => { d.selected = all.filter((r) => r.diff !== 0).map((r) => r.id); save(); } }, 'Só as que mudaram')]));
          all.forEach((r) => metricsBox.appendChild(h('label', { class: 'chk cmp-m' }, [
            h('input', { type: 'checkbox', checked: !d.selected || d.selected.includes(r.id), onchange: (e) => { const sel = new Set(d.selected || all.map((x) => x.id)); e.target.checked ? sel.add(r.id) : sel.delete(r.id); d.selected = [...sel]; save(); } }),
            h('span', { class: 'cmp-ml' }, r.label), h('span', { class: 'cmp-mv' }, `${r.prev} → ${r.cur}`), h('span', { html: varBadge(r) })
          ])));
        }
        manualBox.innerHTML = '';
        manualBox.appendChild(h('div', { class: 'cmp-mhead' }, [h('span', {}, 'Linhas manuais'), h('small', {}, 'para números que não estão nas planilhas (ex.: custo, VMs de outra cloud)')]));
        d.manual.forEach((m, i) => manualBox.appendChild(h('div', { class: 'cmp-mrow' }, [
          h('input', { class: 'inp inp-sm', placeholder: 'Métrica', value: m.label, oninput: (e) => { m.label = e.target.value; ctx.save(); drawPreview(); } }),
          h('input', { class: 'inp inp-sm', placeholder: (d.prev && d.prev.label) || 'Anterior', value: m.prev, oninput: (e) => { m.prev = e.target.value; ctx.save(); drawPreview(); } }),
          h('input', { class: 'inp inp-sm', placeholder: curLabel(ctx.state), value: m.cur, oninput: (e) => { m.cur = e.target.value; ctx.save(); drawPreview(); } }),
          h('button', { class: 'mini-btn', onclick: () => { d.manual.splice(i, 1); save(); } }, '✕')
        ])));
        manualBox.appendChild(h('button', { class: 'btn-dashed', onclick: () => { d.manual.push({ label: '', prev: '', cur: '' }); save(); } }, '＋ Linha manual'));
        drawPreview();
      }
      function drawPreview() { preview.innerHTML = BT.blocks.get('compare').render(block, { state: ctx.state, target: 'preview', editing: true }) || ''; }

      const body = h('div', { class: 'cmp-body', style: { display: d.enabled === false ? 'none' : '' } }, [
        BT.blocks.titleInput(block, ctx),
        h('div', { class: 'img-opts' }, [h('span', { class: 'lbl' }, 'Comparar com'), auto, monthSel, yearIn, btn]),
        h('div', { class: 'cmp-st' }, status),
        opts, metricsBox, manualBox, h('div', { class: 'lbl', style: { marginTop: '12px' } }, 'Prévia'), preview
      ]);
      fillMonth();
      if (d.enabled !== false) load(false); else redraw();
      const off = BT.on('store:content', BT.core.utils.debounce(() => { if (!document.body.contains(preview)) return off(); drawPreview(); }, 400));
      return h('div', {}, [onOff, body]);
    },

    render(b, ctx) {
      const d = b.data;
      const rows = visibleRows(d, ctx.state);
      if (!rows.length) return ctx.editing ? '<div class="cmp-empty">Nada para comparar ainda.</div>' : '';
      const pl = BT.esc((d.prev && d.prev.label) || 'Anterior'), cl = BT.esc(curLabel(ctx.state));
      let out = BT.blocks.titleHtml(b, ctx);
      out += `<div class="cmp-sum">📈 <b>${pl} → ${cl}</b> · ${BT.esc(summaryText(rows))}</div>`;
      if (d.showChart !== false) out += `<div class="bchart">${chartSvg(d, rows, ctx.state, 640)}</div>`;
      if (d.showTable !== false) out += `<table class="btbl compact cmp-tbl"><thead><tr><th>Métrica</th><th>${pl}</th><th>${cl}</th><th>Variação</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${BT.esc(r.label)}</td><td>${r.prev}</td><td>${r.cur}</td><td>${varBadge(r)}</td></tr>`).join('')}</tbody></table>`;
      return out;
    },
    word(b, ctx) {
      const d = b.data;
      const rows = visibleRows(d, ctx.state);
      if (!rows.length) return '';
      const pl = BT.esc((d.prev && d.prev.label) || 'Anterior'), cl = BT.esc(curLabel(ctx.state));
      const th = 'style="background:#5E3FE1;color:#fff;font-family:Arial;font-size:8pt;padding:4pt 6pt;text-align:left"', td = 'style="border-bottom:1px solid #e8e6f8;font-family:Arial;font-size:8.5pt;padding:3pt 6pt"';
      let out = BT.blocks.titleHtml(b, ctx);
      out += `<p style="font-family:Arial;font-size:9pt;color:#3a3a5c;margin:4pt 0 6pt"><b>${pl} → ${cl}</b> · ${BT.esc(summaryText(rows))}</p>`;
      if (d.showChart !== false) out += `<p style="margin:4pt 0 8pt"><img src="${BT.charts.dataUri(chartSvg(d, rows, ctx.state, 640))}" width="600"></p>`;
      if (d.showTable !== false) out += `<table width="100%" cellspacing="0" style="border-collapse:collapse"><tr><td ${th}>Métrica</td><td ${th}>${pl}</td><td ${th}>${cl}</td><td ${th}>Variação</td></tr>${rows.map((r) => `<tr><td ${td}>${BT.esc(r.label)}</td><td ${td}>${r.prev}</td><td ${td}>${r.cur}</td><td ${td}>${varBadge(r, true)}</td></tr>`).join('')}</table>`;
      return out;
    }
  });
})(window.BT);
