/* ═══ Bloco: Topologia de rede (desenhada a partir da sincronização) ═══
 * data = {
 *   title, provider, account, origin, style: 'tree' (hierárquico, padrão) | 'compact' | 'detailed', styleByUser (escolhido no editor), showSubnets, showGateways, hidden: [ids de redes ocultas], note,
 *   model: {
 *     networks: [{ id, name, cidr, group, region, subnets: [{ name, cidr, public }], gateways: [{ type, name }] }],
 *     hubs:     [{ id, type: 'DRG' | 'Transit Gateway' | …, name, region }],
 *     links:    [{ a, b, type: 'attach' | 'peering' | 'internet' | 'vpn' | 'dedicated', label }]   (a/b = id, 'internet' ou 'onprem')
 *   }
 * }
 * O desenho é SVG: aparece igual no editor, no HTML, no PDF e (como imagem) no Word.
 */
(function (BT) {
  const h = BT.h;
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const FONT = "Inter, 'Segoe UI', Arial, sans-serif";
  const W = 960, PAD = 20, GAP = 22, MAX_SUBNETS = 8, MAX_NETS = 36;
  const COLOR = { oci: '#c74634', aws: '#ff9900', azure: '#0078d4', gcp: '#4285f4', vmware: '#6d8aa6', ovm: '#c74634' };
  const LINK = { attach: ['#5E3FE1', ''], peering: ['#00a383', '6 4'], internet: ['#8D92A7', '2 4'], vpn: ['#DC5282', '7 4'], dedicated: ['#b7860b', ''] };
  const cut = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  /** Monta o SVG. width = largura de exibição (o desenho escala pelo viewBox). */
  function svgDetailed(d, width = W) {
    const m = d.model || {};
    const hidden = new Set(d.hidden || []);
    const nets = (m.networks || []).filter((n) => !hidden.has(n.id)).slice(0, MAX_NETS);
    const ids = new Set(nets.map((n) => n.id));
    // hub (DRG, Transit Gateway) só aparece se alguma rede do desenho estiver ligada a ele
    const hubIds = new Set((m.hubs || []).filter((hb) => (m.links || []).some((l) => (l.a === hb.id && ids.has(l.b)) || (l.b === hb.id && ids.has(l.a)))).map((hb) => hb.id));
    // vários links do mesmo tipo entre os mesmos pontos (ex.: 9 túneis IPSec do DRG) viram UMA linha "VPN ×9"
    const grouped = new Map();
    (m.links || []).filter((l) => [l.a, l.b].every((x) => ids.has(x) || hubIds.has(x) || x === 'internet' || x === 'onprem')).forEach((l) => {
      const k = l.type + '|' + [l.a, l.b].sort().join('|');
      const g = grouped.get(k);
      if (g) g.n++; else grouped.set(k, Object.assign({}, l, { n: 1 }));
    });
    const links = [...grouped.values()].map((l) => {
      if (l.n === 1) return l;
      const base = l.type === 'vpn' ? 'VPN' : l.type === 'peering' ? 'Peering' : String(l.label || '').split(' · ')[0];
      return Object.assign({}, l, { label: base ? `${base} ×${l.n}` : `×${l.n}` });
    });
    const used = new Set(links.flatMap((l) => [l.a, l.b]));
    const hubs = (m.hubs || []).filter((hb) => used.has(hb.id));
    if (!nets.length) return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="60" viewBox="0 0 ${W} 60"><text x="${W / 2}" y="34" font-size="12" text-anchor="middle" fill="#9098b8" font-family="${FONT}">Sem redes para desenhar — sincronize "Redes" desta cloud</text></svg>`;
    const accent = COLOR[d.provider] || '#5E3FE1';
    const showSub = d.showSubnets !== false, showGw = d.showGateways !== false;
    const pos = {}; const parts = []; const lines = [];
    let y = PAD;

    // 1. externos: Internet e On-premises
    const ext = ['internet', 'onprem'].filter((x) => used.has(x));
    if (ext.length) {
      const bw = 170, bh = 38;
      ext.forEach((x, i) => {
        // com hubs no meio, Internet fica à esquerda e On-premises à direita (as linhas não cruzam os hubs)
        const cx = hubs.length ? (x === 'internet' ? W * 0.16 : W * 0.84) : ext.length === 1 ? W / 2 : (i === 0 ? W * 0.3 : W * 0.7);
        pos[x] = { x: cx - bw / 2, y, w: bw, h: bh };
        const label = x === 'internet' ? 'Internet' : 'On-premises / Datacenter';
        parts.push(`<rect x="${cx - bw / 2}" y="${y}" width="${bw}" height="${bh}" rx="19" fill="#f4f5fa" stroke="#b7bcd1"/><text x="${cx}" y="${y + 24}" font-size="12.5" font-weight="600" text-anchor="middle" fill="#3d4466">${label}</text>`);
      });
      y += 38 + 34;
    }
    // 2. hubs (DRG, Transit Gateway…)
    if (hubs.length) {
      const bw = Math.min(220, (W - 2 * PAD - (hubs.length - 1) * GAP) / hubs.length), bh = 44;
      const total = hubs.length * bw + (hubs.length - 1) * GAP; let x = (W - total) / 2;
      hubs.forEach((hb) => {
        pos[hb.id] = { x, y, w: bw, h: bh };
        parts.push(`<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="8" fill="#f4f2ff" stroke="#5E3FE1" stroke-width="1.4"/>
          <text x="${x + bw / 2}" y="${y + 18}" font-size="10" font-weight="700" text-anchor="middle" fill="#5E3FE1" letter-spacing=".06em">${esc(String(hb.type).toUpperCase())}</text>
          <text x="${x + bw / 2}" y="${y + 34}" font-size="11.5" text-anchor="middle" fill="#3d4466">${esc(cut(hb.name, 30))}</text>`);
        x += bw + GAP;
      });
      y += 44 + 40;
    }
    // 3. redes em grade
    const cols = nets.length <= 2 ? nets.length : nets.length === 4 ? 2 : 3;
    const cw = (W - 2 * PAD - (cols - 1) * GAP) / cols;
    const cardH = (n) => {
      const subs = showSub ? Math.min((n.subnets || []).length, MAX_SUBNETS) + ((n.subnets || []).length > MAX_SUBNETS ? 1 : 0) : 0;
      const gws = showGw && (n.gateways || []).length ? gwRows(n, cw).length * 22 + 6 : 0;
      return 52 + (subs ? subs * 17 + 8 : 0) + gws + 8;
    };
    function gwRows(n, w) {
      const rows = [[]]; let x = 12;
      for (const g of n.gateways || []) {
        const tw = Math.min(w - 24, 14 + String(g.name ? `${g.type} · ${g.name}` : g.type).length * 5.6);
        if (x + tw > w - 12 && rows[rows.length - 1].length) { rows.push([]); x = 12; }
        rows[rows.length - 1].push({ g, x, w: tw }); x += tw + 6;
      }
      return rows;
    }
    for (let i = 0; i < nets.length; i += cols) {
      const row = nets.slice(i, i + cols);
      const rh = Math.max(...row.map(cardH));
      // várias linhas: alinhadas à esquerda (os corredores entre as colunas ficam no mesmo lugar)
      const rowW = row.length * cw + (row.length - 1) * GAP; let x = nets.length > cols ? PAD : (W - rowW) / 2;
      row.forEach((n) => {
        pos[n.id] = { x, y, w: cw, h: rh, row: i / cols };
        const sub = [n.cidr, n.region, n.group].filter(Boolean).join(' · ');
        let s = `<rect x="${x}" y="${y}" width="${cw}" height="${rh}" rx="10" fill="#ffffff" stroke="#d8dbe8"/>
          <rect x="${x}" y="${y}" width="5" height="${rh}" rx="2" fill="${accent}"/>
          <text x="${x + 16}" y="${y + 22}" font-size="13" font-weight="700" fill="#1f2547">${esc(cut(n.name, Math.floor(cw / 7.6)))}</text>
          <text x="${x + 16}" y="${y + 39}" font-size="10.5" fill="#6b7194">${esc(cut(sub, Math.floor(cw / 5.8)))}</text>`;
        let yy = y + 52;
        if (showSub && (n.subnets || []).length) {
          s += `<line x1="${x + 12}" y1="${yy - 2}" x2="${x + cw - 12}" y2="${yy - 2}" stroke="#eef0f6"/>`;
          yy += 6;
          n.subnets.slice(0, MAX_SUBNETS).forEach((sb) => {
            const dot = sb.public === true ? '#00a383' : sb.public === false ? '#8D92A7' : '#c9cde0';
            s += `<circle cx="${x + 18}" cy="${yy + 6}" r="3.4" fill="${dot}"/><text x="${x + 28}" y="${yy + 10}" font-size="10.5" fill="#3d4466">${esc(cut(sb.name, Math.floor((cw - 130) / 5.6)))}</text><text x="${x + cw - 12}" y="${yy + 10}" font-size="10.5" text-anchor="end" fill="#6b7194" font-family="Consolas, monospace">${esc(sb.cidr || '')}</text>`;
            yy += 17;
          });
          if (n.subnets.length > MAX_SUBNETS) { s += `<text x="${x + 28}" y="${yy + 10}" font-size="10.5" fill="#9098b8">+ ${n.subnets.length - MAX_SUBNETS} subnet(s)</text>`; yy += 17; }
          yy += 2;
        }
        if (showGw && (n.gateways || []).length) {
          yy += 4;
          gwRows(n, cw).forEach((r) => {
            r.forEach(({ g, x: gx, w: gw }) => { s += `<rect x="${x + gx}" y="${yy}" width="${gw}" height="17" rx="8.5" fill="#f4f5fa" stroke="#e1e4ef"/><text x="${x + gx + gw / 2}" y="${yy + 12}" font-size="9.5" text-anchor="middle" fill="#3d4466">${esc(cut(g.name ? `${g.type} · ${g.name}` : g.type, Math.floor(gw / 5.4)))}</text>`; });
            yy += 22;
          });
        }
        parts.push(s);
        x += cw + GAP;
      });
      y += rh + GAP + 10;
    }
    // 4. ligações: saem por baixo do hub/externo (ou pelo topo da rede) e correm pelos corredores entre as caixas,
    //    para nenhuma linha passar por trás de outra rede; ligações paralelas ficam deslocadas
    const isCard = (id) => ids.has(id);
    const gutters = [PAD / 2, ...Array.from({ length: cols - 1 }, (_, i) => PAD + (i + 1) * (cw + GAP) - GAP / 2), W - PAD / 2];
    const nearGutter = (x1, x2) => gutters.reduce((b, g) => (Math.abs(g - (x1 + x2) / 2) < Math.abs(b - (x1 + x2) / 2) ? g : b), gutters[0]);
    // portas: cada ligação que chega numa caixa ganha um x próprio no topo/base
    const ports = {}; const portOf = (id, li) => { const list = ports[id] || []; const k = list.indexOf(li); const p = pos[id]; return p.x + p.w / 2 + (k - (list.length - 1) / 2) * Math.min(16, (p.w - 20) / Math.max(1, list.length)); };
    links.forEach((l, li) => [l.a, l.b].forEach((x) => { if (pos[x]) (ports[x] = ports[x] || []).push(li); }));
    const above = (id) => !isCard(id); // hubs e externos ficam acima das redes
    const pair = {};
    links.forEach((l, li) => {
      if (!pos[l.a] || !pos[l.b]) return;
      const [color, dash] = LINK[l.type] || LINK.attach;
      const pk = [l.a, l.b].sort().join('|'); const pi = (pair[pk] = (pair[pk] || 0) + 1) - 1; // nº da ligação entre o mesmo par
      const off = pi * 4 + (li % 3) * 3;
      let d = ''; let lx, lyy;
      if (above(l.a) && above(l.b)) {
        // externo ↔ hub: curva entre as duas caixas
        const [U1, D1] = pos[l.a].y < pos[l.b].y ? [l.a, l.b] : [l.b, l.a];
        const x1 = portOf(U1, li), y1 = pos[U1].y + pos[U1].h, x2 = portOf(D1, li), y2 = pos[D1].y;
        d = `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`;
        // rótulo logo acima do hub (cada hub tem o seu lugar; VPN e link dedicado do mesmo hub ficam empilhados)
        lx = x2; lyy = y2 - 5 - pi * 11;
      } else {
        const [S, T] = isCard(l.a) && !isCard(l.b) ? [l.b, l.a] : [l.a, l.b];
        const t = pos[T]; const tx = portOf(T, li); const ty = t.y; const ch = (p) => p.y - 11 - off;
        const pts = [];
        if (isCard(S)) { const sx = portOf(S, li); pts.push([sx, pos[S].y], [sx, ch(pos[S])]); }
        else { const sx = portOf(S, li); pts.push([sx, pos[S].y + pos[S].h]); const first = Math.min(...[...ids].map((id) => pos[id].y)); pts.push([sx, first - 11 - off]); }
        const cur = pts[pts.length - 1];
        if (Math.abs(cur[1] - ch(t)) < 0.5 || (!isCard(S) && t.row === 0)) pts.push([tx, cur[1]]);
        else { const g = nearGutter(cur[0], tx) + (off % 6) - 3; pts.push([g, cur[1]], [g, ch(t)], [tx, ch(t)]); }
        pts.push([tx, ty]);
        d = 'M' + pts.map((p) => p.map((v) => Math.round(v * 10) / 10).join(',')).join(' L');
        const seg = pts.length > 3 ? [pts[pts.length - 3], pts[pts.length - 2]] : [pts[0], pts[1]];
        lx = (seg[0][0] + seg[1][0]) / 2; lyy = (seg[0][1] + seg[1][1]) / 2 - 4;
      }
      lines.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" ${dash ? `stroke-dasharray="${dash}"` : ''} opacity=".9"/>`);
      if (l.label) lines.push(`<text x="${lx}" y="${lyy}" font-size="9.5" text-anchor="middle" fill="${color}" stroke="#ffffff" stroke-width="3" paint-order="stroke">${esc(cut(l.label, 28))}</text>`);
    });
    // 5. legenda
    const leg = [['attach', 'Anexo ao hub'], ['peering', 'Peering'], ['internet', 'Internet'], ['vpn', 'VPN'], ['dedicated', 'Link dedicado']].filter(([k]) => links.some((l) => l.type === k));
    let lx = PAD; const ly = y + 4;
    const legend = leg.map(([k, t]) => { const [c, dsh] = LINK[k]; const s = `<line x1="${lx}" y1="${ly}" x2="${lx + 26}" y2="${ly}" stroke="${c}" stroke-width="2" ${dsh ? `stroke-dasharray="${dsh}"` : ''}/><text x="${lx + 32}" y="${ly + 4}" font-size="10.5" fill="#6b7194">${t}</text>`; lx += 50 + t.length * 6; return s; }).join('');
    const subLeg = showSub ? `<circle cx="${lx + 4}" cy="${ly}" r="3.4" fill="#00a383"/><text x="${lx + 12}" y="${ly + 4}" font-size="10.5" fill="#6b7194">Subnet pública</text><circle cx="${lx + 110}" cy="${ly}" r="3.4" fill="#8D92A7"/><text x="${lx + 118}" y="${ly + 4}" font-size="10.5" fill="#6b7194">Subnet privada</text>` : '';
    const more = (m.networks || []).filter((n) => !hidden.has(n.id)).length - nets.length;
    const moreTxt = more > 0 ? `<text x="${W - PAD}" y="${ly + 4}" font-size="10.5" text-anchor="end" fill="#9098b8">+ ${more} rede(s) fora do desenho</text>` : '';
    const H = y + 18;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${Math.round(H * width / W)}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">${parts.join('')}${lines.join('')}${legend}${subLeg}${moreTxt}</svg>`;
  }

  // ── Estilo compacto (padrão): cartões pequenos com a conectividade em etiquetas; linhas só entre hub e externos ──
  const SHORT = { 'Internet GW': 'IGW', 'NAT GW': 'NAT', 'Service GW': 'SGW', 'VPN GW': 'VGW', 'VPN / ExpressRoute GW': 'VPN GW', 'Azure Firewall': 'Firewall', 'Cloud NAT': 'NAT', 'Cloud VPN': 'VPN', 'Route Server': 'Route Server', 'Bastion': 'Bastion' };
  const TAG = { internet: ['#eef0f6', '#4b5170'], hub: ['#f0ecff', '#5E3FE1'], peering: ['#e6f7f2', '#00845f'], vpn: ['#fdf0f4', '#c23b6c'], dedicated: ['#fff6e0', '#8a6408'], gw: ['#f4f5fa', '#6b7194'] };
  function compact(d, width) {
    const m = d.model || {};
    const hidden = new Set(d.hidden || []);
    const all = (m.networks || []).filter((n) => !hidden.has(n.id));
    const nets = all.slice().sort((a, b) => String(a.region).localeCompare(String(b.region)) || String(a.name).localeCompare(String(b.name))).slice(0, 60);
    const ids = new Set(nets.map((n) => n.id));
    const name = Object.fromEntries((m.networks || []).map((n) => [n.id, n.name]));
    const hubById = Object.fromEntries((m.hubs || []).map((x) => [x.id, x]));
    if (!nets.length) return svgDetailed(d, width);
    const accent = COLOR[d.provider] || '#5E3FE1';
    const CW = 4, gap = 14;
    const cols = Math.min(CW, nets.length);
    const cw = (W - 2 * PAD - (cols - 1) * gap) / cols;
    const parts = [];
    let y = PAD;

    // hubs: quantas redes cada um tem anexadas e as ligações com o on-premises
    const attachedTo = {}; const hubOnprem = {};
    (m.links || []).forEach((l) => {
      const [x, o] = hubById[l.a] ? [l.a, l.b] : hubById[l.b] ? [l.b, l.a] : [null, null];
      if (!x) return;
      if (ids.has(o)) (attachedTo[x] = attachedTo[x] || []).push(o);
      if (o === 'onprem') (hubOnprem[x] = hubOnprem[x] || []).push(l);
    });
    const hubs = (m.hubs || []).filter((x) => (attachedTo[x.id] || []).length);
    if (hubs.length) {
      // hubs (DRG, Transit Gateway) em grade, do mesmo tamanho dos cartões das redes: nome, redes anexadas e
      // a ligação com o on-premises em etiquetas (VPN ×n, FastConnect…) — sem linhas cruzando o desenho
      const hcols = Math.min(cols, hubs.length) || 1;
      const hw = (W - 2 * PAD - (hcols - 1) * gap) / hcols, hh = 58;
      for (let i = 0; i < hubs.length; i += hcols) {
        hubs.slice(i, i + hcols).forEach((hb, j) => {
          const x = PAD + j * (hw + gap);
          const n = attachedTo[hb.id].length;
          const ls = hubOnprem[hb.id] || [];
          const tags = [...new Set(ls.map((l) => l.type))].map((tp) => {
            const k = ls.filter((l) => l.type === tp).length;
            const base = tp === 'vpn' ? 'VPN' : String(ls.find((l) => l.type === tp).label || 'Link dedicado').split(' · ')[0];
            return [tp === 'dedicated' ? 'dedicated' : 'vpn', base + (k > 1 ? ` ×${k}` : '')];
          });
          let s = `<rect x="${x}" y="${y}" width="${hw}" height="${hh}" rx="8" fill="#f8f6ff" stroke="#cfc6f7"/><rect x="${x}" y="${y}" width="4" height="${hh}" rx="2" fill="#5E3FE1"/>
            <text x="${x + 12}" y="${y + 16}" font-size="11.5" font-weight="700" fill="#1f2547"><tspan fill="#5E3FE1" font-size="9" letter-spacing=".05em">${esc(String(hb.type).toUpperCase())}</tspan>  ${esc(cut(hb.name, Math.floor((hw - 50) / 6.6)))}</text>
            <text x="${x + 12}" y="${y + 31}" font-size="9.5" fill="#6b7194">${n} rede${n !== 1 ? 's' : ''} anexada${n !== 1 ? 's' : ''}${tags.length ? ' · on-premises:' : ''}</text>`;
          let tx = 12;
          tags.forEach(([k, t]) => { const [bg, fg] = TAG[k]; const w = 12 + t.length * 5.4; if (tx + w > hw - 8) return; s += `<rect x="${x + tx}" y="${y + 38}" width="${w}" height="15" rx="7.5" fill="${bg}"/><text x="${x + tx + w / 2}" y="${y + 48.8}" font-size="9" font-weight="600" text-anchor="middle" fill="${fg}">${esc(t)}</text>`; tx += w + 4; });
          parts.push(s);
        });
        y += hh + gap;
      }
      y += 6;
    }

    // cartões das redes: nome, CIDR · subnets, e etiquetas de conectividade
    const tagsOf = (n) => {
      const t = [];
      const ls = (m.links || []).filter((l) => l.a === n.id || l.b === n.id);
      const other = (l) => (l.a === n.id ? l.b : l.a);
      if (ls.some((l) => l.type === 'internet')) t.push(['internet', 'Internet']);
      // com vários hubs, a etiqueta diz qual (ex.: "DRG · D_GW_PROD")
      ls.filter((l) => hubById[other(l)]).forEach((l) => { const hb = hubById[other(l)]; const tp = hb.type === 'Transit Gateway' ? 'TGW' : hb.type; t.push(['hub', (m.hubs || []).length > 1 ? `${tp} · ${cut(hb.name, 16)}` : tp]); });
      ls.filter((l) => l.type === 'peering' && name[other(l)]).forEach((l) => t.push(['peering', '↔ ' + cut(name[other(l)], 16)]));
      ls.filter((l) => other(l) === 'onprem').forEach((l) => t.push([l.type === 'dedicated' ? 'dedicated' : 'vpn', String(l.label || 'VPN').split(' · ')[0]]));
      const gw = [...new Set((n.gateways || []).map((g) => SHORT[g.type] || g.type).filter((g) => g !== 'IGW' && g !== 'LPG' && g !== 'VGW'))];
      if (d.showGateways !== false) gw.forEach((g) => t.push(['gw', g]));
      const seen = new Set(); return t.filter(([k, s]) => (seen.has(k + s) ? false : seen.add(k + s)));
    };
    const layout = (n) => { const rows = [[]]; let x = 10; tagsOf(n).forEach(([k, s]) => { const w = 12 + s.length * 5.4; if (x + w > cw - 8 && rows[rows.length - 1].length) { rows.push([]); x = 10; } rows[rows.length - 1].push({ k, s, x, w }); x += w + 4; }); return rows[0].length ? rows : []; };
    // books sincronizados antes do estilo compacto (sem "style") saem sem a lista de subnets
    const showSub = d.showSubnets === true && d.styleByUser; // lista de subnets no compacto: só se o usuário ligou
    const subH = (n) => (showSub ? Math.min((n.subnets || []).length, 6) * 14 + ((n.subnets || []).length > 6 ? 14 : 0) + ((n.subnets || []).length ? 4 : 0) : 0);
    for (let i = 0; i < nets.length; i += cols) {
      const row = nets.slice(i, i + cols);
      const rh = Math.max(...row.map((n) => 40 + subH(n) + layout(n).length * 18 + 6));
      row.forEach((n, j) => {
        const x = PAD + j * (cw + gap);
        const subs = n.subnets || []; const pub = subs.filter((s) => s.public === true).length;
        const line2 = [n.cidr, subs.length ? `${subs.length} subnet${subs.length !== 1 ? 's' : ''}${pub ? ` (${pub} púb.)` : ''}` : ''].filter(Boolean).join(' · ');
        let s = `<rect x="${x}" y="${y}" width="${cw}" height="${rh}" rx="8" fill="#fff" stroke="#d8dbe8"/><rect x="${x}" y="${y}" width="4" height="${rh}" rx="2" fill="${accent}"/>
          <text x="${x + 12}" y="${y + 17}" font-size="11.5" font-weight="700" fill="#1f2547">${esc(cut(n.name, Math.floor(cw / 6.8)))}</text>
          <text x="${x + 12}" y="${y + 32}" font-size="9.5" fill="#6b7194">${esc(cut(line2, Math.floor(cw / 5.2)))}</text>`;
        let yy = y + 40;
        if (showSub && subs.length) {
          subs.slice(0, 6).forEach((sb) => { s += `<circle cx="${x + 15}" cy="${yy + 4}" r="2.8" fill="${sb.public === true ? '#00a383' : '#8D92A7'}"/><text x="${x + 22}" y="${yy + 8}" font-size="9" fill="#3d4466">${esc(cut(sb.name, Math.floor((cw - 100) / 4.8)))}</text><text x="${x + cw - 8}" y="${yy + 8}" font-size="9" text-anchor="end" fill="#6b7194" font-family="Consolas, monospace">${esc(sb.cidr || '')}</text>`; yy += 14; });
          if (subs.length > 6) { s += `<text x="${x + 22}" y="${yy + 8}" font-size="9" fill="#9098b8">+ ${subs.length - 6}</text>`; yy += 14; }
          yy += 4;
        }
        layout(n).forEach((r) => { r.forEach(({ k, s: t, x: tx, w }) => { const [bg, fg] = TAG[k]; s += `<rect x="${x + tx}" y="${yy}" width="${w}" height="15" rx="7.5" fill="${bg}"/><text x="${x + tx + w / 2}" y="${yy + 10.8}" font-size="9" font-weight="600" text-anchor="middle" fill="${fg}">${esc(t)}</text>`; }); yy += 18; });
        parts.push(s);
      });
      y += rh + gap;
    }
    // legenda das etiquetas e redes fora do desenho
    let lx = PAD; const ly = y + 6;
    const leg = [['internet', 'Internet'], ['hub', 'Anexada ao hub'], ['peering', 'Peering'], ['vpn', 'VPN'], ['dedicated', 'Link dedicado'], ['gw', 'Gateway']].map(([k, t]) => { const [bg, fg] = TAG[k]; const w = 14 + t.length * 5.6; const o = `<rect x="${lx}" y="${ly - 9}" width="${w}" height="14" rx="7" fill="${bg}"/><text x="${lx + w / 2}" y="${ly + 1}" font-size="9" text-anchor="middle" fill="${fg}">${t}</text>`; lx += w + 8; return o; }).join('');
    const more = all.length - nets.length;
    const H = ly + 14;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${Math.round(H * width / W)}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">${parts.join('')}${leg}${more > 0 ? `<text x="${W - PAD}" y="${ly + 1}" font-size="9.5" text-anchor="end" fill="#9098b8">+ ${more} rede(s) fora do desenho</text>` : ''}</svg>`;
  }
  // ── Estilo hierárquico (padrão): árvore de cima para baixo, com ícones de equipamento e linhas em ângulo reto ──
  //   raiz (vCenter / a cloud) → hubs (vDS, vSwitch, DRG, Transit Gateway…) → redes (port groups, VCNs, VPCs, VNets)
  const PROV_NAME = { oci: 'Oracle Cloud', aws: 'AWS', azure: 'Microsoft Azure', gcp: 'Google Cloud', vmware: 'vCenter', ovm: 'Oracle VM' };
  // ícones desenhados em SVG (sem imagens externas: saem iguais no PDF e no Word)
  const ICON = {
    // switch em 3D, como nos diagramas de rede (frente, topo e lateral, com as portas)
    switch: (x, y, w, c) => {
      const h = w * 0.26, d = w * 0.16, dark = shade(c, -28), light = shade(c, 30);
      let p = `<path d="M${x},${y + d} L${x + d},${y} L${x + w + d},${y} L${x + w},${y + d} Z" fill="${light}"/>`
        + `<path d="M${x + w},${y + d} L${x + w + d},${y} L${x + w + d},${y + h} L${x + w},${y + h + d} Z" fill="${dark}"/>`
        + `<rect x="${x}" y="${y + d}" width="${w}" height="${h}" fill="${c}"/>`;
      for (let i = 0; i < 8; i++) p += `<rect x="${x + 6 + i * ((w - 12) / 8)}" y="${y + d + h * 0.35}" width="${(w - 12) / 8 - 3}" height="${h * 0.32}" rx="1" fill="${shade(c, -45)}"/>`;
      return p;
    },
    // servidor (vCenter): duas unidades empilhadas
    server: (x, y, w, c) => {
      let p = '';
      for (let i = 0; i < 2; i++) { const yy = y + i * (w * 0.3); p += `<rect x="${x}" y="${yy}" width="${w}" height="${w * 0.26}" rx="4" fill="${c}"/><circle cx="${x + w - 10}" cy="${yy + w * 0.13}" r="3" fill="#7CFFB2"/><rect x="${x + 8}" y="${yy + w * 0.1}" width="${w * 0.45}" height="4" rx="2" fill="${shade(c, 40)}"/>`; }
      return p;
    },
    // nuvem
    cloud: (x, y, w, c) => `<path d="M${x + w * 0.25},${y + w * 0.55} a${w * 0.17},${w * 0.17} 0 0 1 ${w * 0.05},-${w * 0.33} a${w * 0.22},${w * 0.22} 0 0 1 ${w * 0.4},-${w * 0.06} a${w * 0.16},${w * 0.16} 0 0 1 ${w * 0.27},${w * 0.17} a${w * 0.12},${w * 0.12} 0 0 1 -${w * 0.02},${w * 0.24} Z" fill="${c}"/>`,
    // rede (três nós ligados)
    net: (x, y, s, c) => `<g stroke="${c}" stroke-width="1.6" fill="none"><line x1="${x + s / 2}" y1="${y + 3}" x2="${x + 3}" y2="${y + s - 3}"/><line x1="${x + s / 2}" y1="${y + 3}" x2="${x + s - 3}" y2="${y + s - 3}"/><line x1="${x + 3}" y1="${y + s - 3}" x2="${x + s - 3}" y2="${y + s - 3}"/></g><g fill="${c}"><circle cx="${x + s / 2}" cy="${y + 3}" r="3"/><circle cx="${x + 3}" cy="${y + s - 3}" r="3"/><circle cx="${x + s - 3}" cy="${y + s - 3}" r="3"/></g>`
  };
  function shade(hex, amt) {
    const n = parseInt(String(hex).replace('#', ''), 16); if (isNaN(n)) return hex;
    const ch = (v) => Math.max(0, Math.min(255, v + amt));
    return '#' + [ch(n >> 16), ch((n >> 8) & 255), ch(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  function tree(d, width) {
    const m = d.model || {};
    const hidden = new Set(d.hidden || []);
    const nets = (m.networks || []).filter((n) => !hidden.has(n.id)).slice(0, 80);
    if (!nets.length) return svgDetailed(d, width);
    const ids = new Set(nets.map((n) => n.id));
    const hubById = Object.fromEntries((m.hubs || []).map((x) => [x.id, x]));
    const name = Object.fromEntries((m.networks || []).map((n) => [n.id, n.name]));
    const accent = COLOR[d.provider] || '#5E3FE1';
    const SW = '#0b6fa4'; // azul dos switches, como nos diagramas de rede
    // cada rede vai para baixo do 1º hub a que está ligada; sem hub, direto na raiz
    const parentOf = {}; const onprem = {};
    (m.links || []).forEach((l) => {
      const [hb, o] = hubById[l.a] ? [l.a, l.b] : hubById[l.b] ? [l.b, l.a] : [null, null];
      if (!hb) return;
      if (ids.has(o) && !parentOf[o]) parentOf[o] = hb;
      if (o === 'onprem') (onprem[hb] = onprem[hb] || []).push(l);
    });
    const groups = [];
    for (const hb of m.hubs || []) { const kids = nets.filter((n) => parentOf[n.id] === hb.id); if (kids.length) groups.push({ hub: hb, kids }); }
    const loose = nets.filter((n) => !parentOf[n.id]);
    if (loose.length) groups.push({ hub: null, kids: loose });
    // tags de cada rede (internet, peering, VPN, gateways, VMs…)
    const tagsOf = (n) => {
      const t = []; const ls = (m.links || []).filter((l) => l.a === n.id || l.b === n.id); const other = (l) => (l.a === n.id ? l.b : l.a);
      if (ls.some((l) => l.type === 'internet')) t.push(['internet', 'Internet']);
      ls.filter((l) => l.type === 'peering' && name[other(l)]).forEach((l) => t.push(['peering', '↔ ' + cut(name[other(l)], 14)]));
      ls.filter((l) => other(l) === 'onprem').forEach((l) => t.push([l.type === 'dedicated' ? 'dedicated' : 'vpn', String(l.label || 'VPN').split(' · ')[0]]));
      if (d.showGateways !== false) [...new Set((n.gateways || []).map((g) => SHORT[g.type] || g.type).filter((g) => g !== 'IGW' && g !== 'LPG' && g !== 'VGW'))].forEach((g) => t.push(['gw', g]));
      return t.slice(0, 4);
    };
    // medidas: no máximo 2 hubs por faixa (o desenho cresce para baixo, não para os lados — o texto continua legível no PDF)
    const CW = 176, CH = 74, G = 16, HUBW = 120, BG = 48;
    const bands = []; for (let i = 0; i < groups.length; i += 2) bands.push(groups.slice(i, i + 2));
    bands.forEach((b) => b.forEach((gr) => { gr.cols = Math.max(1, Math.min(gr.kids.length, b.length === 1 ? 4 : 2)); gr.w = Math.max(HUBW + 40, gr.cols * CW + (gr.cols - 1) * G); }));
    const bandW = bands.map((b) => b.reduce((s, g) => s + g.w, 0) + (b.length - 1) * BG);
    const SPINE = 10; // tronco à esquerda que liga a raiz às faixas de baixo (longe dos blocos, sem linhas paralelas coladas)
    const Wt = Math.max(640, ...bandW) + 2 * PAD + 60;
    const out = []; const lines = [];
    // raiz
    const rootW = 96, rootX = Wt / 2 - rootW / 2, rootY = PAD;
    const dcs = [...new Set((m.hubs || []).map((x) => x.region).concat(nets.map((n) => n.region)).filter(Boolean))].slice(0, 3);
    const isVM = d.provider === 'vmware' || d.provider === 'ovm';
    out.push(isVM ? ICON.server(rootX + 14, rootY, rootW - 28, '#3d4466') : ICON.cloud(rootX + 6, rootY - 4, rootW - 12, accent));
    out.push(`<text x="${Wt / 2}" y="${rootY + 62}" font-size="13" font-weight="700" text-anchor="middle" fill="#1f2547">${esc(PROV_NAME[d.provider] || 'Rede')}${d.account ? ' · ' + esc(d.account) : ''}</text>`);
    if (dcs.length) out.push(`<text x="${Wt / 2}" y="${rootY + 77}" font-size="10" text-anchor="middle" fill="#6b7194">${esc(dcs.join(' · '))}</text>`);
    const line = (pts, color = '#9aa3c7') => lines.push(`<path d="M${pts.map((p) => p.map((v) => Math.round(v * 10) / 10).join(',')).join(' L')}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round"/>`);
    const card = (n, nx, ry) => {
      const subs = n.subnets || []; const pub = subs.filter((s) => s.public === true).length;
      const l2 = [n.cidr, subs.length ? `${subs.length} subnet${subs.length !== 1 ? 's' : ''}${pub ? ` (${pub} púb.)` : ''}` : ''].filter(Boolean).join(' · ');
      let c = `<rect x="${nx}" y="${ry}" width="${CW}" height="${CH}" rx="9" fill="#fff" stroke="#cfd5e6"/><rect x="${nx}" y="${ry}" width="${CW}" height="4" rx="2" fill="${accent}"/>`
        + ICON.net(nx + 10, ry + 13, 20, accent)
        + `<text x="${nx + 38}" y="${ry + 24}" font-size="11.5" font-weight="700" fill="#1f2547">${esc(cut(n.name, 19))}</text>`
        + `<text x="${nx + 38}" y="${ry + 38}" font-size="9.5" fill="#6b7194">${esc(cut(l2, 27))}</text>`;
      let tx = nx + 8;
      tagsOf(n).forEach(([k, t]) => { const [bg, fg] = TAG[k]; const w = 10 + t.length * 5.1; if (tx + w > nx + CW - 6) return; c += `<rect x="${tx}" y="${ry + 50}" width="${w}" height="15" rx="7.5" fill="${bg}"/><text x="${tx + w / 2}" y="${ry + 60.8}" font-size="8.8" font-weight="600" text-anchor="middle" fill="${fg}">${esc(t)}</text>`; tx += w + 4; });
      out.push(c);
    };
    let y = rootY + 100;
    let firstBus = null;
    bands.forEach((band, bi) => {
      let x = (Wt - bandW[bi]) / 2;
      const busY = y; const hubTop = y + 22; let bandH = 0; const tops = [];
      band.forEach((gr) => {
        const cx = x + gr.w / 2; const col = gr.hub ? SW : '#9aa3c7';
        let childTop;
        if (gr.hub) {
          out.push(ICON.switch(cx - HUBW / 2, hubTop, HUBW - 16, SW));
          out.push(`<text x="${cx}" y="${hubTop + 58}" font-size="10" font-weight="700" text-anchor="middle" fill="${SW}" letter-spacing=".05em">${esc(String(gr.hub.type).toUpperCase())}</text><text x="${cx}" y="${hubTop + 72}" font-size="12" font-weight="600" text-anchor="middle" fill="#1f2547">${esc(cut(gr.hub.name, 26))}</text>`);
          const op = onprem[gr.hub.id] || [];
          if (op.length) { const types = [...new Set(op.map((l) => (l.type === 'dedicated' ? String(l.label || 'Dedicado').split(' · ')[0] : 'VPN')))]; out.push(`<text x="${cx}" y="${hubTop + 86}" font-size="9.5" text-anchor="middle" fill="#c23b6c">⇄ on-premises: ${esc(types.join(', '))}${op.length > 1 ? ` (${op.length})` : ''}</text>`); }
          tops.push(cx);
          childTop = hubTop + 108;
          line([[cx, hubTop + 76 + (op.length ? 14 : 0)], [cx, childTop - 16]], col);
        } else { tops.push(cx); childTop = hubTop + 20; line([[cx, hubTop - 22], [cx, childTop - 16]], col); }
        // redes: linhas de até "cols"; a 1ª ligada ao hub por cima, as de baixo por um tronco à esquerda do bloco
        const rowW = gr.cols * CW + (gr.cols - 1) * G; const x0 = cx - rowW / 2; const sx = x0 - 9;
        const rows = Math.ceil(gr.kids.length / gr.cols);
        for (let r = 0; r < rows; r++) {
          const ry = childTop + r * (CH + 34); const bus = ry - 16;
          const row = gr.kids.slice(r * gr.cols, r * gr.cols + gr.cols);
          const centers = row.map((_, i) => x0 + i * (CW + G) + CW / 2);
          const left = r === 0 ? Math.min(cx, centers[0], rows > 1 ? sx : Infinity) : sx;
          const right = r === 0 ? Math.max(cx, centers[centers.length - 1]) : centers[centers.length - 1];
          line([[left, bus], [right, bus]], col);
          if (r > 0) line([[sx, bus - CH - 34], [sx, bus]], col);
          row.forEach((n, i) => { line([[centers[i], bus], [centers[i], ry]], col); card(n, x0 + i * (CW + G), ry); });
        }
        bandH = Math.max(bandH, childTop - hubTop + rows * (CH + 34));
        x += gr.w + BG;
      });
      // raiz → hubs da faixa: barramento; faixas de baixo descem pelo tronco da esquerda
      const lft = Math.min(...tops, bi === 0 ? Wt / 2 : Infinity), rgt = Math.max(...tops, bi === 0 ? Wt / 2 : -Infinity);
      if (bi === 0) { line([[Wt / 2, rootY + 84], [Wt / 2, busY]]); firstBus = busY; }
      if (bands.length > 1) { line([[SPINE, busY], [lft, busY]]); if (bi > 0) line([[SPINE, firstBus], [SPINE, busY]]); }
      line([[bi === 0 ? lft : Math.min(lft, SPINE), busY], [rgt, busY]]);
      tops.forEach((tx2) => line([[tx2, busY], [tx2, hubTop]], '#9aa3c7'));
      y = hubTop + bandH + 26;
    });
    // legenda
    const ly = y + 4; let lx = PAD;
    const leg = [[SW, 'Switch / hub (vDS, vSwitch, DRG, Transit Gateway…)', 'sw'], [accent, 'Rede (port group, VCN, VPC, VNet)', 'net']];
    let legend = '';
    leg.forEach(([c, t, k]) => { legend += k === 'sw' ? `<rect x="${lx}" y="${ly - 8}" width="16" height="10" rx="2" fill="${c}"/>` : ICON.net(lx, ly - 10, 14, c); legend += `<text x="${lx + 22}" y="${ly + 1}" font-size="10" fill="#6b7194">${esc(t)}</text>`; lx += 34 + t.length * 5.3; });
    const more = (m.networks || []).filter((n) => !hidden.has(n.id)).length - nets.length;
    const H = ly + 16;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${Math.round(H * width / Wt)}" viewBox="0 0 ${Wt} ${H}" font-family="${FONT}">${lines.join('')}${out.join('')}${legend}${more > 0 ? `<text x="${Wt - PAD}" y="${ly + 1}" font-size="10" text-anchor="end" fill="#9098b8">+ ${more} rede(s) fora do desenho</text>` : ''}</svg>`;
  }
  /** Estilo em uso: o escolhido no editor; sem escolha, o padrão da equipe (hierárquico). */
  const styleOf = (d) => (d.styleByUser && d.style) || (BT.data && BT.data.defaults && BT.data.defaults.blocks().topologyStyle) || d.style || 'tree';
  const svg = (d, width = W) => { const st = styleOf(d); return st === 'detailed' ? svgDetailed(d, width) : st === 'compact' ? compact(d, width) : tree(d, width); };

  const count = (d) => ((d.model && d.model.networks) || []).filter((n) => !(d.hidden || []).includes(n.id)).length;

  BT.blocks.register('topology', {
    label: 'Topologia de rede', icon: '🗺️', desc: 'Desenho automático das redes da cloud (preenchido pela sincronização de Redes)', order: 47,
    create: () => ({ title: 'Topologia de rede', provider: '', style: 'tree', hidden: [], model: { networks: [], hubs: [], links: [] } }),
    isEmpty: (b) => !count(b.data),
    svg,
    editor(block, ctx) {
      const d = block.data;
      const preview = h('div', { class: 'chart-preview', style: { overflowX: 'auto' } });
      const list = h('div', { class: 'cprow', style: { maxHeight: '160px', overflowY: 'auto' } });
      const redraw = () => { preview.innerHTML = svg(d, 760); };
      const save = () => { ctx.save(); redraw(); };
      const nets = (d.model && d.model.networks) || [];
      d.hidden = d.hidden || [];
      nets.forEach((n) => list.appendChild(h('label', { class: 'cp' }, [h('input', { type: 'checkbox', checked: !d.hidden.includes(n.id), onchange: (e) => { d.hidden = e.target.checked ? d.hidden.filter((x) => x !== n.id) : [...d.hidden, n.id]; save(); } }), `${n.name}${n.cidr ? ' (' + n.cidr + ')' : ''}`])));
      // compacto (padrão): cartões com etiquetas, subnets só se pedir · detalhado: subnets e linhas até cada rede
      const subOn = () => (styleOf(d) === 'detailed' ? d.showSubnets !== false : d.showSubnets === true && !!d.styleByUser);
      const subChk = h('input', { type: 'checkbox', checked: subOn(), onchange: (e) => { d.style = styleOf(d); d.styleByUser = true; d.showSubnets = e.target.checked; save(); } });
      const styleRow = h('div', { class: 'tone-row', style: { marginTop: '8px' } });
      const drawStyle = () => { styleRow.innerHTML = ''; [['tree', '🌳 Hierárquico'], ['compact', '▦ Compacto'], ['detailed', '🗺️ Detalhado']].forEach(([k, l]) => styleRow.appendChild(h('button', { class: styleOf(d) === k ? 'on' : '', onclick: () => { d.style = k; d.styleByUser = true; subChk.checked = subOn(); drawStyle(); save(); } }, l))); };
      drawStyle();
      redraw();
      return h('div', {}, [
        BT.blocks.titleInput(block, ctx),
        nets.length ? null : h('div', { class: 'muted', style: { margin: '6px 0' } }, 'Preenchido ao sincronizar "🌐 Redes" desta cloud (Sincronizar dados).'),
        styleRow,
        h('div', { class: 'img-opts', style: { marginTop: '8px' } }, [
          h('label', { class: 'switch' }, [subChk, 'Mostrar subnets']),
          h('label', { class: 'switch' }, [h('input', { type: 'checkbox', checked: d.showGateways !== false, onchange: (e) => { d.showGateways = e.target.checked; save(); } }), 'Mostrar gateways'])
        ]),
        nets.length ? h('div', { class: 'lbl', style: { margin: '10px 0 6px' } }, 'Redes no desenho') : null, nets.length ? list : null,
        preview
      ]);
    },
    render: (b, ctx) => BT.blocks.titleHtml(b, ctx) + `<div class="bchart btopo">${svg(b.data, 680)}</div>`,
    word: (b, ctx) => BT.blocks.titleHtml(b, ctx) + `<p style="margin:4pt 0 8pt"><img src="${BT.charts.dataUri(svg(b.data, 640))}" width="620"></p>`
  });
  BT.blocks.topologySvg = svg;
})(window.BT);
