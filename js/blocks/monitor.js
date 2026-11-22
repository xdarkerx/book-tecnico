/* ═══ Bloco: Relatório de capacidade (Zabbix) ═══
 * Preenchido pela sincronização com o Zabbix (servidor). Visual igual ao book de referência:
 * KPIs, Resumo executivo, Top 5 hosts com mais alertas (CPU/MEM/DISCO), Top CPU, Top Memória
 * e filesystems em alerta. O resumo executivo e as partes exibidas são editáveis.
 * data = { title, origin:'zabbix-capacity', z:{…resumo do servidor…}, resumo, show:{kpis,resumo,top5,cpu,mem,disk} }
 */
(function (BT) {
  const h = BT.h;
  const esc = BT.esc;
  const pct = (v) => (v == null || isNaN(v) ? '—' : Number(v).toFixed(1) + '%');
  const SHOW = [['kpis', 'Indicadores'], ['resumo', 'Resumo executivo'], ['top5', 'Top 5 hosts com mais alertas'], ['cpu', 'CPU — top hosts'], ['mem', 'Memória — top hosts'], ['disk', 'Disco — filesystems em alerta']];

  function html(d) {
    const z = d.z || {}; const show = Object.assign({ kpis: true, resumo: true, top5: true, cpu: true, mem: true, disk: true }, d.show);
    let out = '';
    if (show.kpis) {
      const card = (val, label, color) => `<div class="bmon-card" style="flex:1;background:${color}0d;border:1px solid ${color}33;border-radius:10px;padding:12px 14px;text-align:center">
        <div style="font-family:'Trispace',monospace;font-size:20px;font-weight:800;color:${color};line-height:1">${esc(val)}</div>
        <div style="font-size:13px;font-weight:600;color:#3a3a5c;margin-top:5px;text-transform:uppercase;letter-spacing:.5px">${esc(label)}</div></div>`;
      const cpuHigh = z.cpuHigh || 0, diskCnt = (z.diskIssues || []).length;
      out += `<div style="display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap">${card(z.totalHosts ?? '—', 'Hosts ativos', '#5E3FE1')}${card(z.totalAlerts ?? '—', 'Alertas no período', '#322490')}${card(cpuHigh || '✓', 'CPU ≥ 80%', cpuHigh ? '#e05020' : '#0e7a50')}${card(diskCnt || '✓', 'Disco c/ alerta', diskCnt ? '#b5192a' : '#0e7a50')}</div>`;
    }
    if (show.resumo && (d.resumo || z.summary)) out += `<div class="bh2">📝 Resumo Executivo</div><div style="padding:12px 16px;background:#f5f4fc;border-left:4px solid #5E3FE1;border-radius:0 8px 8px 0;margin-bottom:18px"><p style="font-size:13px;color:#3a3a5c;line-height:1.75;margin:0;white-space:pre-wrap">${esc(d.resumo || z.summary)}</p></div>`;
    if (show.top5 && (z.top5 || []).length) {
      const metric = (label, val, color, chipBg, count, breakdown) => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <div style="width:38px;font-size:8px;font-weight:700;color:#8890b0">${label}</div>
        ${val != null ? `<div style="flex:1;background:#eeeef8;border-radius:3px;height:6px;overflow:hidden"><div style="height:100%;width:${Math.min(val, 100)}%;background:${color};border-radius:3px"></div></div>
        <div style="width:44px;text-align:right;font-family:'Trispace',monospace;font-size:10px;font-weight:700;color:${color}">${pct(val)}</div>` : '<div style="flex:1"></div><div style="width:44px;text-align:right;font-size:10px;color:#8890b0">—</div>'}
        <div style="width:66px;text-align:right;font-size:8px;color:#8890b0">${count} alerta${count !== 1 ? 's' : ''}</div></div>
        ${breakdown && breakdown.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin:0 0 8px 46px">${breakdown.map((b) => `<span style="background:${chipBg};color:${color};font-size:8px;font-weight:700;padding:2px 7px;border-radius:9px">${esc(b.label)} · ${b.count} alerta${b.count > 1 ? 's' : ''}</span>`).join('')}</div>` : ''}`;
      out += `<div class="bh2">🏆 Top ${z.top5.length} — Hosts com Mais Alertas (CPU / Memória / Disco) (${esc(z.periodLabel || '')})</div><div style="margin-bottom:18px">` + z.top5.map((t, i) => {
        const a = t.alerts || {}; const tot = (a.cpu || 0) + (a.mem || 0) + (a.disk || 0);
        return `<div class="bmon-card" style="background:#fafafa;border:1px solid #e8e8f0;border-radius:8px;padding:10px 14px;margin-bottom:8px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px"><div style="font-size:12px;font-weight:700;color:#171C37">${i + 1}. ${esc(t.host)}</div><div style="font-size:10px;color:#8890b0">${tot} alerta${tot !== 1 ? 's' : ''} no período</div></div>
          ${a.cpu ? metric('CPU', t.cpuAvg, '#e05020', '#fdece0', a.cpu) : ''}${a.mem ? metric('MEM', t.memAvg, '#5E3FE1', '#eae6fb', a.mem) : ''}${a.disk ? metric('DISCO', t.diskVal, '#DC5282', '#fde8f0', a.disk, t.diskBreakdown) : ''}</div>`;
      }).join('') + '</div>';
    }
    const capBars = (title, rows) => {
      if (!rows || !rows.length) return '';
      const hasAvg = rows.some((r) => r.avg != null);
      return `<div class="bh2">${title}</div><div style="margin-bottom:18px">
        <div style="display:flex;gap:8px;padding:0 0 4px;border-bottom:1px solid #e8e8f0;margin-bottom:8px"><div style="flex:1;font-size:8px;font-weight:700;color:#8890b0;text-transform:uppercase;letter-spacing:.5px">Servidor</div>${hasAvg ? '<div style="width:80px;text-align:right;font-size:8px;font-weight:700;color:#8890b0;text-transform:uppercase">Média período</div>' : ''}<div style="width:80px;text-align:right;font-size:8px;font-weight:700;color:#8890b0;text-transform:uppercase">Última coleta</div></div>
        ${rows.slice(0, 10).map((r, i) => {
          const ref = r.avg ?? r.cur ?? 0; const bar = ref >= 85 ? '#b5192a' : ref >= 70 ? '#e05020' : '#5E3FE1';
          const col = (v, okc) => (v == null ? '#8890b0' : v >= 85 ? '#b5192a' : v >= 70 ? '#e05020' : okc);
          return `<div class="bmon-card" style="margin-bottom:8px"><div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
            <div style="flex:1;min-width:0"><span style="font-size:13px;color:#8890b0;margin-right:4px">${i + 1}.</span><span style="font-size:13px;font-weight:700;color:#171C37">${esc(r.host)}</span>${r.count ? `<span style="font-size:8px;color:#8890b0;margin-left:4px">${r.count} alerta${r.count > 1 ? 's' : ''}</span>` : ''}</div>
            ${hasAvg ? `<div style="width:80px;text-align:right;font-family:'Trispace',monospace;font-size:13px;font-weight:700;color:${col(r.avg, '#5a6280')}">${pct(r.avg)}</div>` : ''}
            <div style="width:80px;text-align:right;font-family:'Trispace',monospace;font-size:13px;font-weight:700;color:${col(r.cur, '#2d7a3a')}">${pct(r.cur)}</div></div>
            <div style="background:#eeeef8;border-radius:3px;height:5px;overflow:hidden"><div style="height:100%;width:${Math.min(ref, 100)}%;background:${bar};border-radius:3px"></div></div></div>`;
        }).join('')}</div>`;
    };
    if (show.cpu) out += capBars(`🔥 CPU — Top Hosts por Consumo (${esc(z.periodLabel || '')})`, z.topCpu);
    if (show.mem) out += capBars(`💾 Memória — Top Hosts por Consumo (${esc(z.periodLabel || '')})`, z.topMem);
    if (show.disk && (z.diskIssues || []).length) {
      out += `<div class="bh2">🗄️ Disco — Filesystems em Alerta</div><table class="btbl compact"><thead><tr><th>Servidor</th><th>Filesystem</th><th>Uso</th><th>Situação</th></tr></thead><tbody>` +
        z.diskIssues.map((d) => `<tr><td>${esc(d.host)}</td><td>${esc(d.fs)}</td><td>${pct(d.val)}</td><td>${BT.data.badge(d.val >= 90 || d.val == null ? 'Crítico' : 'Atenção')}</td></tr>`).join('') + '</tbody></table>';
    }
    if (z.fetchedAt) out += `<div class="btbl-note">Fonte: Zabbix · grupo(s) ${esc(z.group || '')} · ${esc(z.periodLabel || '')} · coletado em ${esc(z.fetchedAt)}</div>`;
    return out;
  }

  /** Versão Word: barras e cards viram tabelas (o Word não entende flexbox). */
  function word(d) {
    const z = d.z || {}; const show = Object.assign({ kpis: true, resumo: true, top5: true, cpu: true, mem: true, disk: true }, d.show);
    const bar = (v, color) => `<table width="100%" cellspacing="0" cellpadding="0"><tr><td width="${Math.max(1, Math.min(100, v || 0))}%" height="5" style="background:${color};font-size:2pt;line-height:2pt;height:4pt;mso-line-height-rule:exactly">&nbsp;</td><td height="5" style="background:#eeeef8;font-size:2pt;line-height:2pt;height:4pt;mso-line-height-rule:exactly">&nbsp;</td></tr></table>`;
    const t2 = (s) => `<p style="font-family:Consolas,monospace;font-size:9pt;font-weight:bold;color:#5E3FE1;text-transform:uppercase;margin:12pt 0 5pt">${s}</p>`;
    let out = '';
    if (show.kpis) {
      const k = [[z.totalHosts ?? '—', 'Hosts ativos'], [z.totalAlerts ?? '—', 'Alertas no período'], [z.cpuHigh || '✓', 'CPU ≥ 80%'], [(z.diskIssues || []).length || '✓', 'Disco c/ alerta']];
      out += `<table width="100%" cellspacing="6"><tr>${k.map(([v, l]) => `<td style="border:1px solid #e0dcf8;background:#f7f6ff;padding:8pt;text-align:center"><p style="margin:0;font-size:16pt;font-weight:bold;color:#5E3FE1;font-family:Arial">${esc(v)}</p><p style="margin:2pt 0 0;font-size:7.5pt;color:#3a3a5c;text-transform:uppercase">${l}</p></td>`).join('')}</tr></table>`;
    }
    if (show.resumo && (d.resumo || z.summary)) out += t2('📝 Resumo executivo') + `<table width="100%"><tr><td style="background:#f5f4fc;border-left:3pt solid #5E3FE1;padding:8pt 10pt;font-family:Arial;font-size:9.5pt;color:#3a3a5c">${esc(d.resumo || z.summary)}</td></tr></table>`;
    if (show.top5 && (z.top5 || []).length) {
      out += t2(`🏆 Top ${z.top5.length} — hosts com mais alertas (${esc(z.periodLabel || '')})`) + '<table width="100%" cellspacing="0" cellpadding="3" style="border-collapse:collapse">' + z.top5.map((t, i) => {
        const a = t.alerts || {};
        const line = (l, v, c, n) => (n ? `<tr><td width="12%" style="font-size:7.5pt;color:#8890b0;font-family:Arial">${l}</td><td width="58%">${bar(v, c)}</td><td width="12%" style="font-size:8pt;font-weight:bold;color:${c};text-align:right;font-family:Consolas">${pct(v)}</td><td width="18%" style="font-size:7pt;color:#8890b0;text-align:right">${n} alertas</td></tr>` : '');
        return `<tr><td colspan="4" style="font-family:Arial;font-size:9.5pt;font-weight:bold;color:#171C37;padding-top:6pt;border-top:1px solid #e8e8f0">${i + 1}. ${esc(t.host)}</td></tr>${line('CPU', t.cpuAvg, '#e05020', a.cpu)}${line('MEM', t.memAvg, '#5E3FE1', a.mem)}${line('DISCO', t.diskVal, '#DC5282', a.disk)}`;
      }).join('') + '</table>';
    }
    const cap = (title, rows) => (rows && rows.length ? t2(title) + '<table width="100%" cellspacing="0" cellpadding="3" style="border-collapse:collapse">' + rows.slice(0, 10).map((r, i) =>
      `<tr><td width="40%" style="font-family:Arial;font-size:9pt;color:#171C37">${i + 1}. <b>${esc(r.host)}</b></td><td width="36%">${bar(r.avg ?? r.cur, (r.avg ?? r.cur ?? 0) >= 85 ? '#b5192a' : (r.avg ?? r.cur ?? 0) >= 70 ? '#e05020' : '#5E3FE1')}</td><td width="12%" style="font-family:Consolas;font-size:8.5pt;text-align:right">${pct(r.avg)}</td><td width="12%" style="font-family:Consolas;font-size:8.5pt;text-align:right">${pct(r.cur)}</td></tr>`).join('') + '</table>' : '');
    if (show.cpu) out += cap(`🔥 CPU — top hosts (média · última coleta)`, z.topCpu);
    if (show.mem) out += cap(`💾 Memória — top hosts (média · última coleta)`, z.topMem);
    if (show.disk && (z.diskIssues || []).length) out += t2('🗄️ Disco — filesystems em alerta') + BT.blocks.get('table').word({ data: { columns: [{ name: 'Servidor' }, { name: 'Filesystem' }, { name: 'Uso' }, { name: 'Situação', badge: true }], rows: z.diskIssues.map((d) => [d.host, d.fs, pct(d.val), d.val >= 90 || d.val == null ? 'Crítico' : 'Atenção']) } }, { target: 'word' });
    return out;
  }

  BT.blocks.register('monitor', {
    label: 'Relatório de capacidade', icon: '📡', desc: 'Zabbix: KPIs, resumo, top hosts CPU/memória/disco', order: 60,
    create: () => ({ title: '', origin: 'zabbix-capacity', z: null, resumo: '', show: {} }),
    isEmpty: (b) => !b.data.z,
    editor(block, ctx) {
      const d = block.data; d.show = Object.assign({ kpis: true, resumo: true, top5: true, cpu: true, mem: true, disk: true }, d.show);
      const prev = h('div', { class: 'mon-prev' });
      const redraw = () => { prev.innerHTML = d.z ? html(d) : '<p style="color:#8890b0;text-align:center;padding:20px">Sem dados ainda. Configure o Zabbix nas conexões do cliente e use 🔄 Sincronizar.</p>'; };
      const z = d.z || {};
      const resumo = h('textarea', { class: 'inp', style: { minHeight: '90px', width: '100%' }, placeholder: 'Resumo executivo (gerado automaticamente — edite à vontade)', oninput: (e) => { d.resumo = e.target.value; ctx.save(); redraw(); } }, d.resumo || z.summary || '');
      redraw();
      return h('div', {}, [
        BT.blocks.titleInput(block, ctx),
        h('div', { class: 'mon-meta' }, d.z ? [h('span', {}, ['Grupo: ', h('b', {}, z.group || '—')]), h('span', {}, ['Período: ', h('b', {}, z.periodLabel || '—')]), h('span', {}, ['Coletado: ', h('b', {}, z.fetchedAt || '—')])] : []),
        h('div', { class: 'cprow', style: { marginBottom: '10px' } }, SHOW.map(([k, l]) => h('label', { class: 'cp' }, [h('input', { type: 'checkbox', checked: d.show[k] !== false, onchange: (e) => { d.show[k] = e.target.checked; ctx.save(); redraw(); } }), l]))),
        h('div', { class: 'fd' }, [h('label', {}, 'Resumo executivo'), resumo]),
        h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } }, [h('button', { class: 'btn btn-ghost btn-xs', onclick: () => BT.importer.cloud.sync({ providers: ['zabbix'] }) }, '🔄 Atualizar do Zabbix')]),
        prev
      ]);
    },
    render: (b, ctx) => BT.blocks.titleHtml(b, ctx) + `<div class="bmon">${html(b.data)}</div>`,
    word: (b, ctx) => BT.blocks.titleHtml(b, ctx) + word(b.data)
  });
})(window.BT);
