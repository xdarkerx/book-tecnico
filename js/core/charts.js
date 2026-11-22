/* ═══ Gráficos em SVG (sem bibliotecas) ═══
 * BT.charts.svg({ kind, labels, series:[{name, values}], width, height, showValues, legend, unit })
 *   kind: 'column' | 'bar' | 'line' | 'pie' | 'donut'
 * O SVG é autocontido (estilos inline), então funciona no preview, no PDF, no HTML e,
 * convertido em PNG, no Word.
 */
(function (BT) {
  const PALETTE = ['#5E3FE1', '#86D2EF', '#322490', '#DC5282', '#00a383', '#f0b429', '#8D92A7', '#7c5ef7', '#3c9cc4', '#B7BCD1'];
  const FONT = "Poppins,'Segoe UI',Arial,sans-serif";
  const MONO = "Consolas,'Courier New',monospace";
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n) => (Math.abs(n) >= 1000 ? n.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) : (Math.round(n * 10) / 10).toLocaleString('pt-BR'));
  /** "1.234,5" → 1234.5 · "37.6%" → 37.6 · "500 GB" → 500 */
  const num = (v) => {
    let s = String(v ?? '').trim();
    if (/,\d+\s*\D*$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s.replace(/[^\d.-]/g, ''));
    return isNaN(n) ? 0 : n;
  };
  const trunc = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
  const color = (i, s) => (s && s.color) || PALETTE[i % PALETTE.length];

  /** Escala "bonita" para o eixo Y. */
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const m = v / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  }

  function legendHtml(series, x, y) {
    return series.map((s, i) => `<g transform="translate(${x + i * 130},${y})"><rect width="10" height="10" rx="2" fill="${color(i, s)}"/><text x="15" y="9" font-size="10" fill="#5a6280" font-family="${FONT}">${esc(trunc(s.name, 18))}</text></g>`).join('');
  }

  function column(o) {
    const { labels, series, width: W, height: H } = o;
    const multi = series.length > 1;
    const top = multi && o.legend ? 30 : 16, left = 40, right = 12;
    const rotate = labels.length > 6 || labels.some((l) => String(l).length > 10);
    const bottom = rotate ? 70 : 30;
    const ch = H - top - bottom, cw = W - left - right;
    const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values.map(num))));
    const gw = cw / Math.max(1, labels.length);
    const bw = Math.max(4, Math.min(42, (gw * 0.7) / series.length));
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const y = top + ch - (ch * i) / 4;
      g += `<line x1="${left}" x2="${W - right}" y1="${y}" y2="${y}" stroke="#eceef6"/><text x="${left - 6}" y="${y + 3}" font-size="9" text-anchor="end" fill="#9098b8" font-family="${MONO}">${fmt((max * i) / 4)}</text>`;
    }
    labels.forEach((l, li) => {
      const gx = left + gw * li + (gw - bw * series.length) / 2;
      series.forEach((s, si) => {
        const v = num(s.values[li]); const h = (v / max) * ch;
        const x = gx + si * bw, y = top + ch - h;
        g += `<rect x="${x}" y="${y}" width="${bw - 2}" height="${Math.max(0, h)}" rx="2" fill="${color(si, s)}"/>`;
        if (o.showValues && v) g += `<text x="${x + (bw - 2) / 2}" y="${y - 3}" font-size="9" text-anchor="middle" fill="#3d4466" font-family="${MONO}">${fmt(v)}${esc(o.unit)}</text>`;
      });
      const lx = left + gw * li + gw / 2, ly = top + ch + 12;
      g += rotate
        ? `<text transform="translate(${lx},${ly}) rotate(-35)" font-size="9" text-anchor="end" fill="#5a6280" font-family="${FONT}">${esc(trunc(l, 22))}</text>`
        : `<text x="${lx}" y="${ly + 2}" font-size="9" text-anchor="middle" fill="#5a6280" font-family="${FONT}">${esc(trunc(l, 16))}</text>`;
    });
    if (multi && o.legend) g += legendHtml(series, left, 6);
    return g;
  }

  function line(o) {
    const { labels, series, width: W, height: H } = o;
    const top = series.length > 1 && o.legend ? 30 : 16, left = 40, right = 16, bottom = 30;
    const ch = H - top - bottom, cw = W - left - right;
    const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values.map(num))));
    const step = labels.length > 1 ? cw / (labels.length - 1) : 0;
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const y = top + ch - (ch * i) / 4;
      g += `<line x1="${left}" x2="${W - right}" y1="${y}" y2="${y}" stroke="#eceef6"/><text x="${left - 6}" y="${y + 3}" font-size="9" text-anchor="end" fill="#9098b8" font-family="${MONO}">${fmt((max * i) / 4)}</text>`;
    }
    const every = Math.ceil(labels.length / 12);
    labels.forEach((l, i) => { if (i % every === 0) g += `<text x="${left + step * i}" y="${top + ch + 16}" font-size="9" text-anchor="middle" fill="#5a6280" font-family="${FONT}">${esc(trunc(l, 10))}</text>`; });
    series.forEach((s, si) => {
      const pts = s.values.map((v, i) => [left + step * i, top + ch - (num(v) / max) * ch]);
      const c = color(si, s);
      if (series.length === 1) g += `<path d="M${pts.map((p) => p.join(',')).join(' L')} L${pts[pts.length - 1][0]},${top + ch} L${left},${top + ch} Z" fill="${c}" opacity=".08"/>`;
      g += `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"/>`;
      pts.forEach((p, i) => {
        g += `<circle cx="${p[0]}" cy="${p[1]}" r="2.6" fill="#fff" stroke="${c}" stroke-width="1.6"/>`;
        if (o.showValues && labels.length <= 14 && num(s.values[i])) g += `<text x="${p[0]}" y="${p[1] - 6}" font-size="8.5" text-anchor="middle" fill="#3d4466" font-family="${MONO}">${fmt(num(s.values[i]))}</text>`;
      });
    });
    if (series.length > 1 && o.legend) g += legendHtml(series, left, 6);
    return g;
  }

  /** Barras horizontais com trilho (estilo "distribuição" do book). */
  function bar(o) {
    const s = o.series[0] || { values: [] };
    const total = s.values.reduce((a, v) => a + num(v), 0) || 1;
    const max = Math.max(...s.values.map(num), 1);
    const W = o.width, rowH = 22, labelW = Math.min(220, W * 0.36);
    let g = '';
    o.labels.forEach((l, i) => {
      const v = num(s.values[i]); const y = 8 + i * rowH;
      const tw = W - labelW - 90;
      g += `<text x="0" y="${y + 10}" font-size="10" fill="#3d4466" font-family="${FONT}">${esc(trunc(l, 34))}</text>`;
      g += `<rect x="${labelW}" y="${y + 3}" width="${tw}" height="7" rx="3.5" fill="#eeeef8"/>`;
      g += `<rect x="${labelW}" y="${y + 3}" width="${Math.max(3, (v / max) * tw)}" height="7" rx="3.5" fill="${color(o.series.length > 1 ? 0 : i, o.series.length > 1 ? s : null)}"/>`;
      g += `<text x="${W}" y="${y + 10}" font-size="9.5" text-anchor="end" fill="#8890b0" font-family="${MONO}">${fmt(v)}${esc(o.unit)} (${Math.round((v / total) * 100)}%)</text>`;
    });
    o.height = 16 + o.labels.length * rowH;
    return g;
  }

  function pie(o, donut) {
    const s = o.series[0] || { values: [] };
    const vals = s.values.map(num);
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const H = o.height, R = Math.min(H / 2 - 10, 110), cx = R + 14, cy = H / 2;
    let a0 = -Math.PI / 2, g = '';
    vals.forEach((v, i) => {
      if (!v) return;
      const a1 = a0 + (v / total) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a, r) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
      const [x0, y0] = p(a0, R), [x1, y1] = p(a1, R);
      const d = v === total ? `M${cx - R},${cy} a${R},${R} 0 1,0 ${R * 2},0 a${R},${R} 0 1,0 ${-R * 2},0` : `M${cx},${cy} L${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} Z`;
      g += `<path d="${d}" fill="${color(i)}" stroke="#fff" stroke-width="1.5"/>`;
      if (o.showValues && v / total >= 0.06 && !donut) { const [tx, ty] = p((a0 + a1) / 2, R * 0.62); g += `<text x="${tx}" y="${ty + 3}" font-size="9.5" font-weight="700" text-anchor="middle" fill="#fff" font-family="${MONO}">${Math.round((v / total) * 100)}%</text>`; }
      a0 = a1;
    });
    if (donut) g += `<circle cx="${cx}" cy="${cy}" r="${R * 0.58}" fill="#fff"/><text x="${cx}" y="${cy + 2}" font-size="20" font-weight="800" text-anchor="middle" fill="#171C37" font-family="${FONT}">${fmt(total)}</text><text x="${cx}" y="${cy + 16}" font-size="8" text-anchor="middle" fill="#9098b8" font-family="${MONO}" letter-spacing="1">TOTAL</text>`;
    const lx = cx + R + 30;
    const rows = Math.min(o.labels.length, Math.floor((H - 10) / 18));
    o.labels.slice(0, rows).forEach((l, i) => {
      const y = cy - (rows * 18) / 2 + i * 18 + 4;
      g += `<rect x="${lx}" y="${y}" width="10" height="10" rx="2" fill="${color(i)}"/><text x="${lx + 16}" y="${y + 9}" font-size="10" fill="#3d4466" font-family="${FONT}">${esc(trunc(l, 30))}</text><text x="${o.width}" y="${y + 9}" font-size="9.5" text-anchor="end" fill="#8890b0" font-family="${MONO}">${fmt(vals[i])}${esc(o.unit)} · ${Math.round((vals[i] / total) * 100)}%</text>`;
    });
    return g;
  }

  function svg(spec) {
    const o = Object.assign({ kind: 'column', labels: [], series: [], width: 640, height: 260, showValues: true, legend: true, unit: '' }, spec);
    o.series = (o.series || []).filter((s) => s && Array.isArray(s.values));
    if (!o.labels.length || !o.series.length) return `<svg xmlns="http://www.w3.org/2000/svg" width="${o.width}" height="60" viewBox="0 0 ${o.width} 60"><text x="${o.width / 2}" y="34" font-size="11" text-anchor="middle" fill="#9098b8" font-family="${FONT}">Sem dados para o gráfico</text></svg>`;
    let body;
    if (o.kind === 'bar') body = bar(o);
    else if (o.kind === 'line') body = line(o);
    else if (o.kind === 'pie') body = pie(o, false);
    else if (o.kind === 'donut') body = pie(o, true);
    else body = column(o);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${o.width}" height="${o.height}" viewBox="0 0 ${o.width} ${o.height}" style="max-width:100%;height:auto;display:block">${body}</svg>`;
  }

  const dataUri = (s) => 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(s)));
  BT.charts = { svg, dataUri, num, PALETTE, KINDS: [['column', '📊 Colunas'], ['bar', '📶 Barras'], ['line', '📈 Linha'], ['pie', '🥧 Pizza'], ['donut', '🍩 Rosca']] };
})(window.BT);
