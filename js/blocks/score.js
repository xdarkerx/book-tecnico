/* ═══ Bloco: Cloud Security Score (pontuação de segurança por cloud/conta) ═══
 * Preenchido à mão, pela sincronização (OCI Cloud Guard, AWS Security Hub, Azure Defender for Cloud)
 * ou por um arquivo do ZIP com "score" no nome (ex.: aws/security-score.csv).
 * data: { title, items: [{ label, value (0–100), source, detail }], note }
 */
(function (BT) {
  const h = BT.h;
  const num = (v) => { const n = parseFloat(String(v).replace(',', '.').replace('%', '')); return isFinite(n) ? Math.max(0, Math.min(100, n)) : null; };
  const level = (n) => (n == null ? { c: '#9098b8', t: '—' } : n >= 80 ? { c: '#00a37a', t: 'Bom' } : n >= 60 ? { c: '#d99a00', t: 'Atenção' } : { c: '#d64545', t: 'Crítico' });
  const fmt = (n) => (n == null ? '—' : (Math.round(n * 10) / 10).toString().replace('.', ',') + '%');
  const filled = (b) => (b.data.items || []).filter((i) => num(i.value) != null);

  BT.blocks.register('score', {
    label: 'Cloud Security Score', icon: '🛡️', desc: 'Pontuação de segurança por cloud/conta (0–100%)', order: 55,
    create: () => ({ title: 'Cloud Security Score', items: [{ label: '', value: '', source: '', detail: '' }], note: '' }),
    isEmpty: (b) => !filled(b).length,
    editor(block, ctx) {
      const list = h('div', { class: 'score-edit' });
      const draw = () => {
        list.innerHTML = '';
        block.data.items.forEach((it, i) => {
          const set = (k) => (e) => { it[k] = e.target.value; ctx.save(); if (k === 'value') badge.replaceWith(badge = mk()); };
          const mk = () => { const n = num(it.value); const lv = level(n); return h('span', { class: 'score-badge', style: { background: lv.c } }, n == null ? '—' : lv.t); };
          let badge = mk();
          list.appendChild(h('div', { class: 'score-row' }, [
            h('input', { class: 'inp', value: it.label, placeholder: 'Cloud / conta (ex.: AWS · PRD)', oninput: set('label') }),
            h('input', { class: 'inp score-val', value: it.value, placeholder: '0–100', inputmode: 'decimal', oninput: set('value') }),
            badge,
            h('input', { class: 'inp', value: it.source || '', placeholder: 'Fonte (ex.: Security Hub)', oninput: set('source') }),
            h('input', { class: 'inp', value: it.detail || '', placeholder: 'Detalhe (ex.: 120 de 150 controles)', oninput: set('detail') }),
            h('button', { class: 'btn-icon', title: 'Remover', onclick: () => { block.data.items.splice(i, 1); ctx.save(); draw(); } }, '✕')
          ]));
        });
        list.appendChild(h('button', { class: 'btn btn-ghost btn-xs', onclick: () => { block.data.items.push({ label: '', value: '', source: '', detail: '' }); ctx.save(); draw(); } }, '＋ Pontuação'));
      };
      draw();
      return h('div', {}, [BT.blocks.titleInput(block, ctx), list,
        h('input', { class: 'inp', style: { marginTop: '8px' }, value: block.data.note || '', placeholder: 'Observação (opcional)', oninput: (e) => { block.data.note = e.target.value; ctx.save(); } })]);
    },
    render(b, ctx) {
      const cards = filled(b).map((i) => {
        const n = num(i.value); const lv = level(n);
        return `<div class="bsc_ bscore"><div class="bsv" style="color:${lv.c}">${fmt(n)}</div>
          <div class="bscore-bar"><span style="width:${n}%;background:${lv.c}"></span></div>
          <div class="bsl">${BT.esc(i.label || 'Score')}</div>
          ${i.source || i.detail ? `<div class="bscore-src">${BT.esc([i.source, i.detail].filter(Boolean).join(' · '))}</div>` : ''}</div>`;
      }).join('');
      return BT.blocks.titleHtml(b, ctx) + `<div class="bsg">${cards}</div>` + (b.data.note ? `<p class="bscore-note">${BT.esc(b.data.note)}</p>` : '');
    },
    word(b, ctx) {
      const rows = filled(b).map((i) => {
        const n = num(i.value); const lv = level(n);
        return `<tr><td style="border:1px solid #e8e6f8;padding:6pt;font-family:Arial;font-size:9pt">${BT.esc(i.label || 'Score')}</td>
          <td style="border:1px solid #e8e6f8;padding:6pt;font-family:Arial;font-size:14pt;font-weight:bold;color:${lv.c};text-align:center">${fmt(n)}</td>
          <td style="border:1px solid #e8e6f8;padding:6pt;font-family:Arial;font-size:9pt;color:${lv.c}">${lv.t}</td>
          <td style="border:1px solid #e8e6f8;padding:6pt;font-family:Arial;font-size:8pt;color:#666">${BT.esc([i.source, i.detail].filter(Boolean).join(' · '))}</td></tr>`;
      }).join('');
      return BT.blocks.titleHtml(b, ctx) + `<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:6pt 0">${rows}</table>` + (b.data.note ? `<p style="font-family:Arial;font-size:8pt;color:#666">${BT.esc(b.data.note)}</p>` : '');
    }
  });

  /** Converte uma planilha (API ou ZIP) em itens do bloco. Colunas reconhecidas por nome. */
  BT.blocks.scoreItemsFromSheet = function (sheet, prefix = '') {
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
  };
})(window.BT);
