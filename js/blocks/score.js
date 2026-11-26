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
    azure: { recsTitle: 'Recomendações (Defender for Cloud)', recs: ['Recomendação', 'Severidade', 'Recursos não íntegros', 'Assinatura'], alertsTitle: 'Alertas de segurança (Defender for Cloud)', alerts: ['Alerta', 'Severidade', 'Recurso', 'Data', 'Status', 'Assinatura'] },
    gcp: { recsTitle: 'Achados (Security Command Center)', recs: ['Achado', 'Categoria', 'Severidade', 'Recursos afetados', 'Projeto'], alertsTitle: 'Ameaças (Security Command Center)', alerts: ['Alerta', 'Severidade', 'Recurso', 'Data', 'Status', 'Projeto'] },
    generic: { recsTitle: 'Recomendações', recs: ['Recomendação', 'Severidade', 'Recurso', 'Status'], alertsTitle: 'Alertas', alerts: ['Alerta', 'Severidade', 'Recurso', 'Data', 'Status'] }
  };
  const fmtOf = (p) => FORMATS[p] || FORMATS.generic;
  /** Tabelas vazias no formato da cloud. */
  const scoreTables = (p) => ({ provider: FORMATS[p] ? p : 'generic', recs: { columns: fmtOf(p).recs.slice(), rows: [] }, alerts: { columns: fmtOf(p).alerts.slice(), rows: [] } });

  // severidade → badge do book
  const SEVCLS = (v) => { const s = String(v).toLowerCase(); return /cr[ií]tic|critical|disaster|desastre/.test(s) ? 'br' : /alta|high/.test(s) ? 'br' : /m[ée]dia|medium|moderate/.test(s) ? 'by' : /baixa|low|minor/.test(s) ? 'bg_' : /info/.test(s) ? 'bx' : ''; };
  const isSevCol = (c) => /severidade|risco|severity|risk/i.test(c);
  // níveis de risco que dá para escolher na importação (tela de revisão da sincronização e do ZIP)
  const LEVELS = [['critica', 'Crítica'], ['alta', 'Alta'], ['media', 'Média'], ['baixa', 'Baixa'], ['info', 'Informativa']];
  const levelOf = (v) => {
    const s = String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    return /critic|disaster|desastre/.test(s) ? 'critica' : /alta|high/.test(s) ? 'alta' : /media|medium|moderate/.test(s) ? 'media' : /baixa|low|minor/.test(s) ? 'baixa' : /info/.test(s) ? 'info' : '';
  };
  /** Importação: deixa só as recomendações/alertas dos riscos escolhidos. Linha sem risco reconhecido sempre fica. */
  function filterRisks(data, want) {
    const out = Object.assign({}, data);
    ['recs', 'alerts'].forEach((k) => {
      const t = data[k]; if (!t) return;
      const si = t.columns.findIndex(isSevCol);
      out[k] = Object.assign({}, t, { rows: si < 0 ? t.rows.slice() : t.rows.filter((r) => { const l = levelOf(r[si]); return !l || want.includes(l); }) });
    });
    return out;
  }
  /** Quantas recomendações/alertas há de cada risco (para a tela de revisão). */
  function riskCounts(data) {
    const c = {};
    ['recs', 'alerts'].forEach((k) => {
      const t = data && data[k]; if (!t) return;
      const si = t.columns.findIndex(isSevCol); if (si < 0) return;
      rowsOf(t).forEach((r) => { const l = levelOf(r[si]); if (l) c[l] = (c[l] || 0) + 1; });
    });
    return c;
  }

  // ── o que mostrar no book (data.show) ──
  const SHOW_DEF = { recs: true, alerts: true, charts: false, compare: true, evolution: false };
  const show = (d) => Object.assign({}, SHOW_DEF, d.show || {});

  // ── comparativo: pontuação dos books dos meses anteriores (data.history = [{ label, mes: 'AAAA-MM', value }], data.month = mês do book) ──
  const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const mesLabel = (m) => { const [y, mo] = String(m).split('-'); return `${MES[Number(mo) - 1] || mo}/${String(y).slice(2)}`; };
  const prevMonth = (m) => { const [y, mo] = String(m).split('-').map(Number); const d = new Date(y, mo - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const hist = (d, label) => (d.history || []).filter((x) => x.label === label && d.month && x.mes < d.month && num(x.value) != null);
  /** Pontuação do mês imediatamente anterior e a variação ("▲ +7 pts"). */
  function compare(d, i) {
    if (!show(d).compare || !d.month) return null;
    const prev = hist(d, i.label).find((x) => x.mes === prevMonth(d.month)); const n = num(i.value);
    if (!prev || n == null) return null;
    const p = num(prev.value); const diff = Math.round((n - p) * 10) / 10;
    const arrow = diff > 0 ? `▲ +${fmtN(diff)} pts` : diff < 0 ? `▼ ${fmtN(diff)} pts` : '= sem variação';
    return { text: `${mesLabel(prev.mes)}: ${fmt(p)} · ${arrow}`, color: diff > 0 ? '#00a37a' : diff < 0 ? '#d64545' : '#9098b8' };
  }
  const fmtN = (n) => String(n).replace('.', ',');
  const cmp = (d, i) => { const c = compare(d, i); return c ? `<div class="bscore-cmp" style="color:${c.color}">${BT.esc(c.text)}</div>` : ''; };
  const chart = (data, ctx) => BT.blocks.renderBook({ type: 'chart', include: true, data: Object.assign({ source: 'manual', table: {}, showValues: true, legend: true, height: 220, unit: '' }, data) }, ctx);
  /** Gráfico de evolução (opcional) e gráficos de risco (rosca/colunas). */
  function extras(b, ctx) {
    const d = b.data; const sh = show(d); let out = '';
    if (sh.evolution && d.month) {
      const items = filled(b).filter((i) => hist(d, i.label).length);
      if (items.length) {
        const months = [...new Set(items.flatMap((i) => hist(d, i.label).map((x) => x.mes)))].sort().slice(-5).concat(d.month);
        const series = items.map((i) => ({ name: i.label || 'Score', values: months.map((m) => (m === d.month ? num(i.value) : (hist(d, i.label).find((x) => x.mes === m) || {}).value ?? '')) }));
        out += chart({ title: 'Evolução da pontuação', kind: 'line', labels: months.map(mesLabel), series, unit: '%', legend: series.length > 1, height: 200 }, ctx);
      }
    }
    if (sh.charts) {
      const by = (t) => { const c = {}; const si = t ? t.columns.findIndex(isSevCol) : -1; if (si >= 0) rowsOf(t).forEach((r) => { const l = levelOf(r[si]); if (l) c[l] = (c[l] || 0) + 1; }); return LEVELS.filter(([k]) => c[k]).map(([k, l]) => [l, c[k]]); };
      const f = fmtOf(d.provider);
      const rc = sh.recs ? by(d.recs) : []; const al = sh.alerts ? by(d.alerts) : [];
      if (rc.length) out += chart({ title: `${f.recsTitle} por risco`, kind: 'donut', labels: rc.map((x) => x[0]), series: [{ name: 'Itens', values: rc.map((x) => x[1]) }] }, ctx);
      if (al.length) out += chart({ title: `${f.alertsTitle} por risco`, kind: 'column', labels: al.map((x) => x[0]), series: [{ name: 'Itens', values: al.map((x) => x[1]) }], legend: false }, ctx);
    }
    return out;
  }

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
    const cols = BT.blocks.filledColumns(rows, t.columns.length); // colunas sem nenhum dado não aparecem
    if (ctx && ctx.target === 'word') {
      const th = cols.map((i) => t.columns[i]).map((c) => `<td style="background:#171C37;color:#fff;padding:5pt;font-family:Arial;font-size:7.5pt;font-weight:bold">${BT.esc(c)}</td>`).join('');
      const tr = rows.map((r, ri) => '<tr>' + cols.map((i) => `<td style="background:${ri % 2 ? BT.blocks.ZEBRA : '#ffffff'};border-bottom:1px solid #eee;padding:5pt;font-family:Arial;font-size:8.5pt;vertical-align:top">${BT.blocks.wordText(r[i] || '')}</td>`).join('') + '</tr>').join('');
      return `<p style="font-family:Arial;font-size:9pt;font-weight:bold;color:#5E3FE1;margin:10pt 0 4pt">${BT.esc(title)}</p><table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr>${th}</tr>${tr}</table>`;
    }
    return `<div class="btbl-title">${BT.esc(title)}</div><table class="btbl compact"><thead><tr>${cols.map((i) => `<th>${BT.esc(t.columns[i])}</th>`).join('')}</tr></thead><tbody>${
      rows.map((r) => '<tr>' + cols.map((i) => { const v = r[i] || ''; return `<td>${i === sevIdx && v && SEVCLS(v) ? `<span class="bk ${SEVCLS(v)}">${BT.esc(v)}</span>` : BT.blocks.cellText(v)}</td>`; }).join('') + '</tr>').join('')}</tbody></table>`;
  }

  BT.blocks.register('score', {
    label: 'Cloud Security Score', icon: '🛡️', desc: 'Pontuação de segurança, recomendações e alertas por cloud', order: 55,
    create: () => Object.assign({ title: 'Cloud Security Score', items: [{ label: '', value: '', source: '', detail: '' }], note: '' }, scoreTables('generic')),
    isEmpty: (b) => { const sh = show(b.data); return !filled(b).length && !(sh.recs && rowsOf(b.data.recs).length) && !(sh.alerts && rowsOf(b.data.alerts).length); },
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
      const sh = show(d);
      const toggle = (k, label) => h('label', { class: 'cp' }, [h('input', { type: 'checkbox', checked: sh[k], onchange: (e) => { d.show = Object.assign(show(d), { [k]: e.target.checked }); ctx.save(); } }), label]);
      const showRow = h('div', { class: 'score-show' }, [h('span', { class: 'lbl' }, 'Mostrar no book'), h('div', { class: 'cprow' }, [
        toggle('recs', '💡 Recomendações'), toggle('alerts', '🚨 Problemas / alertas'), toggle('charts', '📊 Gráficos de risco'),
        toggle('compare', '↔️ Comparativo com o mês passado'), toggle('evolution', '📈 Gráfico de evolução')])]);
      const histInfo = h('div', { class: 'set-help', style: { margin: '4px 0 0', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } });
      const drawHist = () => {
        const ms = [...new Set((d.history || []).filter((x) => !d.month || x.mes < d.month).map((x) => x.mes))].sort();
        histInfo.innerHTML = '';
        histInfo.append(ms.length ? `Meses anteriores com pontuação: ${ms.map(mesLabel).join(', ')}.` : 'Sem pontuação de meses anteriores ainda (vem dos books dos meses passados deste cliente).',
          h('button', { class: 'btn btn-ghost btn-xs', type: 'button', onclick: async () => {
            const key = BT.store.sessionId && BT.api.keyOf(BT.store.sessionId); if (!key) return;
            await loadHistory(d, key); ctx.save(); drawHist(); BT.ui.toast('Comparativo atualizado ✓', { type: 'ok' });
          } }, '🔄 Buscar meses anteriores'));
      };
      drawHist();
      return h('div', {}, [BT.blocks.titleInput(block, ctx), list, showRow, histInfo,
        h('div', { class: 'score-fmt' }, [h('span', { class: 'lbl' }, 'Formato de recomendações e alertas'), format]), grids,
        h('input', { class: 'inp', style: { marginTop: '8px' }, value: d.note || '', placeholder: 'Observação (opcional)', oninput: (e) => { d.note = e.target.value; ctx.save(); } })]);
    },
    render(b, ctx) {
      const d = b.data; const f = fmtOf(d.provider); const sh = show(d);
      const cards = filled(b).map((i) => {
        const n = num(i.value); const lv = level(n);
        return `<div class="bsc_ bscore"><div class="bsv" style="color:${lv.c}">${fmt(n)}</div>
          <div class="bscore-bar"><span style="width:${n}%;background:${lv.c}"></span></div>
          <div class="bsl">${BT.esc(i.label || 'Score')}</div>
          ${i.source || i.detail ? `<div class="bscore-src">${BT.esc([i.source, i.detail].filter(Boolean).join(' · '))}</div>` : ''}
          ${cmp(d, i)}</div>`;
      }).join('');
      return BT.blocks.titleHtml(b, ctx) + (cards ? `<div class="bsg">${cards}</div>` : '') + extras(b, ctx)
        + (sh.recs ? tableHtml(d.recs, f.recsTitle, ctx) : '') + (sh.alerts ? tableHtml(d.alerts, f.alertsTitle, ctx) : '')
        + (d.note ? `<p class="bscore-note">${BT.esc(d.note)}</p>` : '');
    },
    word(b, ctx) {
      const d = b.data; const f = fmtOf(d.provider); const sh = show(d);
      const rows = filled(b).map((i) => {
        const n = num(i.value); const lv = level(n);
        return `<tr><td style="border:1px solid #e8e6f8;padding:6pt;font-family:Arial;font-size:9pt">${BT.esc(i.label || 'Score')}</td>
          <td style="border:1px solid #e8e6f8;padding:6pt;font-family:Arial;font-size:14pt;font-weight:bold;color:${lv.c};text-align:center">${fmt(n)}</td>
          <td style="border:1px solid #e8e6f8;padding:6pt;font-family:Arial;font-size:9pt;color:${lv.c}">${lv.t}${(() => { const c = compare(d, i); return c ? `<br><span style="font-size:7.5pt;color:${c.color}">${BT.esc(c.text)}</span>` : ''; })()}</td>
          <td style="border:1px solid #e8e6f8;padding:6pt;font-family:Arial;font-size:8pt;color:#666">${BT.esc([i.source, i.detail].filter(Boolean).join(' · '))}</td></tr>`;
      }).join('');
      return BT.blocks.titleHtml(b, ctx) + (rows ? `<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:6pt 0">${rows}</table>` : '') + extras(b, ctx)
        + (sh.recs ? tableHtml(d.recs, f.recsTitle, ctx) : '') + (sh.alerts ? tableHtml(d.alerts, f.alertsTitle, ctx) : '')
        + (d.note ? `<p style="font-family:Arial;font-size:8pt;color:#666">${BT.esc(d.note)}</p>` : '');
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
  /** Busca a pontuação dos books dos 5 meses anteriores (mesmo cliente e área) e guarda em data.history. */
  async function loadHistory(d, key) {
    const out = [];
    const labels = (d.items || []).map((i) => i.label);
    for (let back = 1; back <= 5; back++) {
      const dt = new Date(Number(key.ano), Number(key.mes) - 1 - back, 1);
      const mes = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      let st = null;
      try { st = await BT.api.getBook({ cliente: key.cliente, ano: String(dt.getFullYear()), mes: mes.slice(5), area: key.area }); } catch (e) { /* sem book naquele mês */ }
      for (const g of (st && st.groups) || []) for (const s2 of g.sections || []) for (const b of s2.blocks || []) {
        if (b.type !== 'score') continue;
        for (const it of (b.data && b.data.items) || []) if (labels.includes(it.label) && num(it.value) != null && !out.some((x) => x.label === it.label && x.mes === mes)) out.push({ label: it.label, mes, value: String(it.value) });
      }
    }
    d.history = out.sort((a2, b2) => a2.mes.localeCompare(b2.mes));
    d.month = `${key.ano}-${String(key.mes).padStart(2, '0')}`;
    return d;
  }
  Object.assign(BT.blocks, { scoreItemsFromSheet, scoreFromSheets, scoreTables, SCORE_FORMATS: FORMATS, RISK_LEVELS: LEVELS, riskLevelOf: levelOf, filterRisks, riskCounts, loadScoreHistory: loadHistory });
})(window.BT);
