/* ═══ Utilitários gerais ═══ */
(function (BT) {
  const U = {};

  /** Escapa texto para HTML. */
  U.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** ID curto e único. */
  U.uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

  /**
   * Cria elemento DOM: h('div', {class:'x', onclick: fn}, [filhos | texto])
   * Atributos iniciados com "on" viram listeners; "html" define innerHTML (já sanitizado!).
   */
  U.h = function h(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, String(v));
      }
    }
    const add = (c) => {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) return c.forEach(add);
      el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    };
    add(children);
    return el;
  };

  U.debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  U.clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

  U.slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'book';

  /** Baixa um Blob/string como arquivo. */
  U.download = (content, filename, mime = 'application/octet-stream') => {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2500);
  };

  U.readAsDataURL = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  U.readAsText = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); });
  U.readAsArrayBuffer = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsArrayBuffer(file); });

  U.isImage = (f) => f && f.type && f.type.startsWith('image/') && f.size <= 15 * 1024 * 1024;

  /** Reduz imagens muito grandes (mantém o book leve). */
  U.compressImage = (dataUrl, maxW = 1800, quality = 0.88) => new Promise((resolve) => {
    if (!/^data:image\/(png|jpe?g|webp)/i.test(dataUrl)) return resolve(dataUrl);
    const img = new Image();
    img.onload = () => {
      if (img.width <= maxW) return resolve(dataUrl);
      const c = document.createElement('canvas');
      c.width = maxW; c.height = Math.round(img.height * (maxW / img.width));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(/png/i.test(dataUrl) ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });

  /** Interpreta texto colado do Excel/Sheets (TSV) ou CSV simples. */
  U.parseDelimited = (text) => {
    const t = String(text || '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
    if (!t) return [];
    const delim = t.includes('\t') ? '\t' : (t.split('\n')[0].split(';').length > t.split('\n')[0].split(',').length ? ';' : ',');
    return U.parseCSV(t, delim);
  };

  /** Parser CSV com suporte a aspas (fallback quando PapaParse não está disponível). */
  U.parseCSV = (text, delim = ',') => {
    const rows = []; let row = []; let cur = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c !== '\r') cur += c;
    }
    row.push(cur); rows.push(row);
    return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
  };

  U.monthLabel = (m, y) => {
    if (!m || !y) return '—';
    const d = new Date(Number(y), Number(m) - 1, 2);
    const s = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  U.today = () => new Date().toLocaleDateString('pt-BR');

  BT.core.utils = U;
  // atalhos
  BT.esc = U.esc; BT.h = U.h; BT.uid = U.uid;
})(window.BT);
