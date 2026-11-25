/* ═══ Bloco: Cloud Security Score (pontuação, recomendações e alertas de segurança por cloud) ═══
 * Preenchido à mão, pela sincronização (OCI Cloud Guard, AWS Security Hub, Azure Defender for Cloud)
 * ou pelo ZIP: <cloud>/security-score.csv, security-recomendacoes.csv, security-alertas.csv.
 * data: { title, provider, items: [{ label, value (0–100), source, detail }],
 *         recs: { columns, rows }, alerts: { columns, rows }, note }
 * As colunas de recomendações/alertas seguem o formato de cada cloud (FORMATS).
 */
(function (BT) {
  const h = BT.h;
  const num = (v) => { const n = parseFloat(String(v).replace(',', '.').replace('%', '')); return isFinite(n) ? Math.max(0, Math.min(100, n)) : null; };
  const level = (n) => (n == null ? { c: '#9098b8', t: '—' } : n >= 80 ? { c: '#00a37a', t: 'Bom' } : n >= 60 ? { c: '#d99a00', t: 'Atenção' } : { c: '#d64545', t: 'Crítico' });
  const fmt = (n) => (n == null ? '—' : (Math.round(n * 10) / 10).toString().replace('.', ',') + '%');
  const filled = (b) => (b.data.items || []).filter((i) => num(i.value) != null);
  const rowsOf = (t) => ((t && t.rows) || []).filter((r) => r.some((c) => String(c).trim()));

  // formato de recomendações e alertas de cada cloud (mesmas colunas que a API devolve)
  const FORMATS = {
    oci: { recsTitle: 'Recomendações (Cloud Guard)', recs: ['Recomendação', 'Risco', 'Problemas', 'Compartimento'], alertsTitle: 'Problemas abertos (Cloud Guard)', alerts: ['Problema', 'Risco', 'Recurso', 'Tipo', 'Compartimento', 'Detectado em'] },
    aws: { recsTitle: 'Controles reprovados (Security Hub)', recs: ['Controle', 'Título', 'Severidade', 'Recursos reprovados', 'Região'], alertsTitle: 'Findings críticos e altos (GuardDuty, Inspector…)', alerts: ['Título', 'Produto', 'Severidade', 'Recurso', 'Última ocorrência'] },
    azure: { recsTitle: 'Recomendações (Defender for Cloud)', recs: ['Recomendação', 'Severidade', 'Recursos não íntegros', 'Assinatura'], alertsTitle: 'Alertas de segurança (Defender for Cloud)', alerts: ['Alerta', 'Severidade', 'Recurso', 'Data', 'Status'] },
    gcp: { recsTitle: 'Recomendações (Security Command Center)', recs: ['Achado', 'Categoria', 'Severidade', 'Recurso'], alertsTitle: 'Alertas (Security Command Center)', alerts: ['Alerta', 'Severidade', 'Recurso', 'Data', 'Status'] },
    generic: { recsTitle: 'Recomendações', recs: ['Recomendação', 'Severidade', 'Recurso', 'Status'], alertsTitle: 'Alertas', alerts: ['Alerta', 'Severidade', 'Recurso', 'Data', 'Status'] }
  };
  const fmtOf = (p) => FORMATS[p] || FORMATS.generic;
  /** Tabelas vazias no formato da cloud. */
  const scoreTables = (p) => ({ provider: FORMATS[p] ? p : 'generic', recs: { columns: fmtOf(p).recs.slice(), rows: [] }, alerts: { columns: fmtOf(p).alerts.slice(), rows: [] } });

  // severidade → badge do book
  const SEVCLS = (v) => { const s = String(v).toLowerCase(); return /cr[ií]tic|critical|disaster|desastre/.test(s) ? 'br' : /alta|high/.test(s) ? 'br' : /m[ée]dia|medium|moderate/.test(s) ? 'by' : /baixa|low|minor/.test(s) ? 'bg_' : /info/.test(s) ? 'bx' : ''; };
  const isSevCol = (c) => /severidade|risco|severity|risk/i.test(c);

  /** Editor simples de planilha (colunas fixas pelo formato, linhas livres). */
  function gridEditor(t, ctx, title) {
    const wrap = h('details', { class: 'score-grid', open: rowsOf(t).length > 0 });
    const body = h('div');
    const draw = () => {
      body.innerHTML = '';
      const tb = h('table', { class: 'score-tbl' });
      tb.appendChild(h('tr', {}, [...t.columns.map((c) => h('th', {}, c)), h('th', {}, '')]));
      t.rows.forEach((r, ri) => tb.appendChild(h('tr', {}, [...t.columns.map((_, ci) => h('td', {}, h('input', { class: 'inp inp-sm', value: r[ci] || '', oninput: (e) => { r[ci] = e.target.value; ctx.save(); } }))),
        h('td', {}, h('button', { class: 'btn-icon', title: 'Remover linha', onclick: () => { t.rows.splice(ri, 1); ctx.save(); draw(); } }, '✕'))])));
      body.append(h('div', { class: 'score-tbl-wrap' }, tb),
        h('button', { class: 'btn btn-ghost btn-xs', onclick: () => { t.rows.push(t.columns.map(() => '')); ctx.save(); draw(); wrap.open = true; } }, '＋ Linha'));
    };
    draw();
    wrap.append(h('summary', {}, `${title} (${rowsOf(t).length})`), body);
    return wrap;
  }

  function tableHtml(t, title, ctx) {
    const rows = rowsOf(t); if (!rows.length) return '';
    const sevIdx = t.columns.findIndex(isSevCol);
    if (ctx && ctx.target === 'word') {
      const th = t.columns.map((c) => `<td style="background:#171C37;color:#fff;padding:5pt;font-family:Arial;font-size:7.5pt;font-weight:bold">${BT.esc(c)}</td>`).join('');
      const tr = rows.map((r) => '<tr>' + t.columns.map((_, i) => `<td style="border-bottom:1px solid #eee;padding:5pt;font-family:Arial;font-size:8.5pt">${BT.esc(r[i] || '')}</td>`).join('') + '</tr>').join('');
      return `<p style="font-family:Arial;font-size:9pt;font-weight:bold;color:#5E3FE1;margin:10pt 0 4pt">${BT.esc(title)}</p><table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr>${th}</tr>${tr}</table>`;
    }
    return `<div class="btbl-title">${BT.esc(title)}</div><table class="btbl compact"><thead><tr>${t.columns.map((c) => `<th>${BT.esc(c)}</th>`).join('')}</tr></thead><tbody>${
      rows.map((r) => '<tr>' + t.columns.map((_, i) => { const v = r[i] || ''; return `<td>${i === sevIdx && v && SEVCLS(v) ? `<span class="bk ${SEVCLS(v)}">${BT.esc(v)}</span>` : BT.esc(v)}</td>`; }).join('') + '</tr>').join('')}</tbody></table>`;
  }

  BT.blocks.register('score', {
    label: 'Cloud Security Score', icon: '🛡️', desc: 'Pontuação de segurança, recomendações e alertas por cloud', order: 55,
    create: () => Object.assign({ title: 'Cloud Security Score', items: [{ label: '', value: '', source: '', detail: '' }], note: '' }, scoreTables('generic')),
    isEmpty: (b) => !filled(b).length && !rowsOf(b.data.recs).length && !rowsOf(b.data.alerts).length,
    editor(block, ctx) {
      const d = block.data;
      if (!d.recs || !d.alerts) Object.assign(d, scoreTables(d.provider || 'generic'), { provider: d.provider || 'generic' });
      const list = h('div', { class: 'score-edit' });
      const draw = () => {
        list.innerHTML = '';
        d.items.forEach((it, i) => {
          const set = (k) => (e) => { it[k] = e.target.value; ctx.save(); if (k === 'value') badge.replaceWith(badge = mk()); };
          const mk = () => { const n = num(it.value); const lv = level(n); return h('span', { class: 'score-badge', style: { background: lv.c } }, n == null ? '—' : lv.t); };
          let badge = mk();
          list.appendChild(h('div', { class: 'score-row' }, [
            h('input', { class: 'inp', value: it.label, placeholder: 'Cloud / conta (ex.: AWS · PRD)', oninput: set('label') }),
            h('input', { class: 'inp score-val', value: it.value, placeholder: '0–100', inputmode: 'decimal', oninput: set('value') }),
            badge,
            h('input', { class: 'inp', value: it.source || '', placeholder: 'Fonte (ex.: Security Hub)', oninput: set('source') }),
            h('input', { class: 'inp', value: it.detail || '', placeholder: 'Detalhe (ex.: 120 de 150 controles)', oninput: set('detail') }),
            h('button', { class: 'btn-icon', title: 'Remover', onclick: () => { d.items.splice(i, 1); ctx.save(); draw(); } }, '✕')
          ]));
        });
        list.appendChild(h('button', { class: 'btn btn-ghost btn-xs', onclick: () => { d.items.push({ label: '', value: '', source: '', detail: '' }); ctx.save(); draw(); } }, '＋ Pontuação'));
      };
      draw();
      const grids = h('div');
      const drawGrids = () => { grids.innerHTML = ''; grids.append(gridEditor(d.recs, ctx, '💡 ' + fmtOf(d.provider).recsTitle), gridEditor(d.alerts, ctx, '🚨 ' + fmtOf(d.provider).alertsTitle)); };
      drawGrids();
      const format = h('select', { class: 'inp inp-sm', onchange: async (e) => {
        const p = e.target.value;
        if ((rowsOf(d.recs).length || rowsOf(d.alerts).length) && !(await BT.ui.modal.confirm('Trocar o formato muda as colunas de recomendações e alertas e apaga as linhas atuais. Continuar?', { okText: 'Trocar', danger: true }))) { e.target.value = d.provider; return; }
        Object.assign(d, scoreTables(p)); ctx.save(); drawGrids();
      } }, [['oci', 'OCI'], ['aws', 'AWS'], ['azure', 'Azure'], ['gcp', 'GCP'], ['generic', 'Genérico']].map(([v, l]) => h('option', { value: v, selected: v === (d.provider || 'generic') }, l)));
      return h('div', {}, [BT.blocks.titleInput(block, ctx), list,
        h('div', { class: 'score-fmt' }, [h('span', { class: 'lbl' }, 'Formato de recomendações e alertas'), format]), grids,
        h('input', { class: 'inp', style: { marginTop: '8px' }, value: d.note || '', placeholder: 'Observação (opcional)', oninput: (e) => { d.note = e.target.value; ctx.save(); } })]);
    },
    render(b, ctx) {
      const f = fmtOf(b.data.provider);
      const cards = filled(b).map((i) => {
        const n = num(i.value); const lv = level(n);
        return `<div class="bsc_ bscore"><div class="bsv" style="color:${lv.c}">${fmt(n)}</div>
          <div class="bscore-bar"><span style="width:${n}%;background:${lv.c}"></span></div>
          <div class="bsl">${BT.esc(i.label || 'Score')}</div>
          ${i.source || i.detail ? `<div class="bscore-src">${BT.esc([i.source, i.detail].filter(Boolean).join(' · '))}</div>` : ''}</div>`;
      }).join('');
      return BT.blocks.titleHtml(b, ctx) + (cards ? `<div class="bsg">${cards}</div>` : '')
        + tableHtml(b.data.recs, f.recsTitle, ctx) + tableHtml(b.data.alerts, f.alertsTitle, ctx)
        + (b.data.note ? `<p class="bscore-note">${BT.esc(b.data.note)}</p>` : '');
    },
    word(b, ctx) {
      const f = fmtOf(b.data.provider);
      const rows = filled(b).map((i) => {
        const n = num(i.value); const lv = level(n);
        return `<tr><td style="border:1px solid #e8e6f8;padding:6pt;font-family:Arial;font-size:9pt">${BT.esc(i.label || 'Score')}</td>
          <td style="border:1px solid #e8e6f8;padding:6pt;font-family:Arial;font-size:14pt;font-weight:bold;color:${lv.c};text-align:center">${fmt(n)}</td>
          <td style="border:1px solid #e8e6f8;padding:6pt;font-family:Arial;font-size:9pt;color:${lv.c}">${lv.t}</td>
          <td style="border:1px solid #e8e6f8;padding:6pt;font-family:Arial;font-size:8pt;color:#666">${BT.esc([i.source, i.detail].filter(Boolean).join(' · '))}</td></tr>`;
      }).join('');
      return BT.blocks.titleHtml(b, ctx) + (rows ? `<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:6pt 0">${rows}</table>` : '')
        + tableHtml(b.data.recs, f.recsTitle, ctx) + tableHtml(b.data.alerts, f.alertsTitle, ctx)
        + (b.data.note ? `<p style="font-family:Arial;font-size:8pt;color:#666">${BT.esc(b.data.note)}</p>` : '');
    }
  });

  /** Converte uma planilha de pontuação (API ou ZIP) em itens do bloco. Colunas reconhecidas por nome. */
  function scoreItemsFromSheet(sheet, prefix = '') {
    const f = sheet.fields || [];
    const col = (re) => f.find((x) => re.test(String(x).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()));
    const cVal = col(/^(pontuacao|score|secure ?score|security ?score|nota|percentual|%|valor)$/) || col(/score|pontua|percent|nota/);
    const cMax = col(/^(maximo|max|max ?score)$/);
    const cLab = col(/^(cloud|conta|escopo|account|subscription|assinatura|tenant|tenancy|projeto|project|nome|name|regiao|region)$/);
    const cSrc = col(/^(fonte|source|ferramenta|tool)$/);
    const cDet = col(/^(classificacao|detalhe|detalhes|rating|status|observacao)$/);
    return (sheet.rows || []).map((r) => {
      let v = num(r[cVal]); const mx = parseFloat(r[cMax]);
      if (v != null && isFinite(mx) && mx > 0 && mx !== 100) v = Math.round((parseFloat(String(r[cVal]).replace(',', '.')) / mx) * 1000) / 10;
      return { label: [prefix, cLab ? r[cLab] : ''].filter(Boolean).join(' · '), value: v == null ? '' : String(v), source: cSrc ? r[cSrc] : '', detail: cDet ? r[cDet] : '' };
    }).filter((i) => i.value !== '');
  }
  /** Bloco completo a partir das planilhas da API: score, score_recs, score_alerts. */
  function scoreFromSheets(p, sheets, label) {
    const d = Object.assign({ title: 'Cloud Security Score', items: [], note: '' }, scoreTables(p));
    sheets.forEach((sh) => {
      if (sh.kind === 'score') d.items.push(...scoreItemsFromSheet(sh, label));
      const t = sh.kind === 'score_recs' ? 'recs' : sh.kind === 'score_alerts' ? 'alerts' : null;
      if (t && sh.rows.length) d[t] = { columns: sh.fields.slice(), rows: sh.rows.map((r) => sh.fields.map((f) => String(r[f] ?? ''))) };
    });
    return d;
  }
  Object.assign(BT.blocks, { scoreItemsFromSheet, scoreFromSheets, scoreTables, SCORE_FORMATS: FORMATS });
})(window.BT);
