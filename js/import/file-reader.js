/* ═══ Leitura de arquivos CSV / XLSX ═══
   Retorna { name, ext, sheets:[{ name, fields:[], rows:[{col:valor}], aoa:[[...]] }] } */
(function (BT) {
  const U = BT.core.utils;
  const MAX = 50 * 1024 * 1024;

  async function read(file) {
    if (file.size > MAX) throw new Error('Arquivo muito grande (máx. 50 MB).');
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'csv' || ext === 'txt' || ext === 'tsv') return readCsv(file, ext);
    if (['xlsx', 'xls', 'xlsm'].includes(ext)) return readXlsx(file, ext);
    if (ext === 'json') return readJson(file);
    throw new Error('Formato não suportado. Use CSV, XLSX ou JSON.');
  }

  async function readCsv(file, ext) {
    let text = await U.readAsText(file);
    text = text.replace(/^﻿/, '');
    let aoa;
    if (window.Papa) aoa = Papa.parse(text, { skipEmptyLines: true }).data;
    else {
      const first = text.split('\n')[0];
      const delim = ext === 'tsv' || first.includes('\t') ? '\t' : (first.split(';').length > first.split(',').length ? ';' : ',');
      aoa = U.parseCSV(text, delim);
    }
    return { name: file.name, ext, sheets: [fromAoa('CSV', aoa)] };
  }

  async function readXlsx(file, ext) {
    if (!window.XLSX) throw new Error('Biblioteca XLSX não carregou (sem internet?). Salve a planilha como CSV e tente novamente.');
    const wb = XLSX.read(await U.readAsArrayBuffer(file), { type: 'array', cellDates: true });
    const sheets = wb.SheetNames.map((n) => {
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: false });
      return fromAoa(n, aoa);
    }).filter((s) => s.rows.length);
    return { name: file.name, ext, sheets };
  }

  async function readJson(file) {
    const data = JSON.parse(await U.readAsText(file));
    const arr = Array.isArray(data) ? data : (Object.values(data).find(Array.isArray) || []);
    const fields = [...new Set(arr.flatMap((o) => Object.keys(o || {})))];
    const rows = arr.map((o) => Object.fromEntries(fields.map((f) => [f, typeof o[f] === 'object' && o[f] !== null ? JSON.stringify(o[f]) : (o[f] ?? '')])));
    return { name: file.name, ext: 'json', sheets: [{ name: 'JSON', fields, rows, aoa: [fields, ...rows.map((r) => fields.map((f) => r[f]))] }] };
  }

  /** Converte array-de-arrays em objetos, detectando a linha de cabeçalho. */
  function fromAoa(name, aoa) {
    aoa = (aoa || []).filter((r) => r && r.some((v) => String(v ?? '').trim() !== ''));
    if (!aoa.length) return { name, fields: [], rows: [], aoa: [] };
    // cabeçalho = primeira linha (entre as 5 primeiras) com mais células preenchidas
    let hi = 0, best = -1;
    aoa.slice(0, 5).forEach((r, i) => { const n = r.filter((v) => String(v).trim()).length; if (n > best) { best = n; hi = i; } });
    const seen = {};
    const fields = aoa[hi].map((f, i) => {
      let k = String(f ?? '').trim() || 'Coluna ' + (i + 1);
      if (seen[k]) k += ' (' + ++seen[k] + ')'; else seen[k] = 1;
      return k;
    });
    const rows = aoa.slice(hi + 1).map((r) => Object.fromEntries(fields.map((f, i) => [f, String(r[i] ?? '').trim()])));
    return { name, fields, rows, aoa: aoa.slice(hi) };
  }

  BT.importer.readFile = read;
})(window.BT);
