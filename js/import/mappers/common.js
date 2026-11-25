/* ═══ Base dos mapeadores: resolução "fuzzy" de colunas por provedor ═══
 * Cada campo padrão (hostname, ip, os…) tem uma lista de nomes de coluna
 * candidatos por provedor. A normalização cobre case, _ - . e camelCase.
 * Estratégia: (1) igual normalizado → (2) substring → (3) todos os tokens.
 */
(function (BT) {
  function normKey(s) {
    return String(s)
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z]{2,})/g, '$1 $2') // "IPAddress" → "IP Address", mas "CIDRs"/"IPs"/"VMs" (plural) ficam inteiros
      .toLowerCase()
      .replace(/[_\-.\/\\:]+/g, ' ')
      .replace(/[()[\]{}<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Para um campo, retorna as colunas do arquivo que casam, em ordem de prioridade. */
  function candidatesFor(fieldMap, field, fields, provider) {
    const fm = fieldMap[field]; if (!fm) return [];
    const cands = [...(fm[provider] || []), ...(fm._default || [])];
    const norm = fields.map((f) => ({ orig: f, norm: normKey(f) }));
    const out = [];
    const push = (e) => { if (e && !out.includes(e.orig)) out.push(e.orig); };
    cands.forEach((c) => { const nc = normKey(c); norm.filter((r) => r.norm === nc).forEach(push); });
    cands.forEach((c) => { const nc = normKey(c); norm.filter((r) => nc.length > 1 && (r.norm.includes(nc) || nc.includes(r.norm)) && r.norm.length > 1).forEach(push); });
    cands.forEach((c) => {
      const tokens = normKey(c).split(' ').filter((t) => t.length > 1);
      if (!tokens.length) return;
      norm.filter((r) => tokens.every((t) => r.norm.includes(t))).forEach(push);
    });
    return out;
  }

  /** Cria um resolvedor: get(row, field) → primeiro valor não-vazio das colunas candidatas. */
  function resolver(fieldMap, fields, provider) {
    const cache = {};
    Object.keys(fieldMap).forEach((f) => (cache[f] = candidatesFor(fieldMap, f, fields, provider)));
    return {
      columns: cache,
      get(row, field) {
        for (const col of cache[field] || []) {
          const v = row[col];
          if (v !== undefined && v !== null && String(v).trim() !== '' && String(v) !== 'NaN') return String(v).trim();
        }
        return '';
      }
    };
  }

  /** Conta ocorrências (para KPIs). */
  function countBy(arr, key) {
    const m = {};
    arr.forEach((o) => { const k = o[key] || '—'; m[k] = (m[k] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }

  BT.importer.mappers._common = { normKey, candidatesFor, resolver, countBy };
})(window.BT);
