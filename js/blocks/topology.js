/* ═══ Bloco: Topologia de rede (desenhada a partir da sincronização) ═══
 * data = {
 *   title, provider, account, origin, style: 'compact' (padrão) | 'detailed', showSubnets, showGateways, hidden: [ids de redes ocultas], note,
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
  const COLOR = { oci: '#c74634', aws: '#ff9900', azure: '#0078d4', gcp: '#4285f4' };
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
    const links = (m.links || []).filter((l) => [l.a, l.b].every((x) => ids.has(x) || hubIds.has(x) || x === 'internet' || x === 'onprem'));
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
      const off = ((pair[[l.a, l.b].sort().join('|')] = (pair[[l.a, l.b].sort().join('|')] || 0) + 1) - 1) * 4 + (li % 3) * 3;
      let d = ''; let lx, lyy;
      if (above(l.a) && above(l.b)) {
        // externo ↔ hub: curva entre as duas caixas
        const [U1, D1] = pos[l.a].y < pos[l.b].y ? [l.a, l.b] : [l.b, l.a];
        const x1 = portOf(U1, li), y1 = pos[U1].y + pos[U1].h, x2 = portOf(D1, li), y2 = pos[D1].y;
        d = `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`;
        lx = (x1 + x2) / 2 + off * 2; lyy = (y1 + y2) / 2 - 3 + off * 2.5;
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

    // linha de cima: Internet · hubs (com quantas redes anexadas) · On-premises, ligados por linhas com o tipo do link
    const attachedTo = {}; const hubOnprem = {};
    (m.links || []).forEach((l) => {
      const [x, o] = hubById[l.a] ? [l.a, l.b] : hubById[l.b] ? [l.b, l.a] : [null, null];
      if (!x) return;
      if (ids.has(o)) (attachedTo[x] = attachedTo[x] || []).push(o);
      if (o === 'onprem') (hubOnprem[x] = hubOnprem[x] || []).push(l);
    });
    const hubs = (m.hubs || []).filter((x) => (attachedTo[x.id] || []).length);
    const netOnprem = (m.links || []).filter((l) => (l.a === 'onprem' && ids.has(l.b)) || (l.b === 'onprem' && ids.has(l.a)));
    const hasOnprem = hubs.some((x) => hubOnprem[x.id]) || netOnprem.length;
    if (hubs.length || hasOnprem) {
      const nodes = [...hubs.map((x) => ({ id: x.id, t: String(x.type).toUpperCase(), s: cut(x.name, 26), s2: `${attachedTo[x.id].length} rede(s) anexada(s)`, hub: true })), ...(hasOnprem ? [{ id: 'onprem', t: 'ON-PREMISES', s: 'Datacenter / escritórios', s2: '' }] : [])];
      const SP = hasOnprem ? 170 : 40; // espaço entre as caixas: cabe o nome do link (VPN, FastConnect…)
      const bw = Math.min(230, (W - 2 * PAD - (nodes.length - 1) * SP) / nodes.length), bh = 50;
      const total = nodes.length * bw + (nodes.length - 1) * SP; let x = (W - total) / 2;
      const at = {};
      nodes.forEach((nd) => {
        at[nd.id] = x;
        parts.push(`<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="8" fill="${nd.hub ? '#f4f2ff' : '#f4f5fa'}" stroke="${nd.hub ? '#5E3FE1' : '#b7bcd1'}" stroke-width="1.3"/>
          <text x="${x + bw / 2}" y="${y + 16}" font-size="9.5" font-weight="700" text-anchor="middle" fill="${nd.hub ? '#5E3FE1' : '#4b5170'}" letter-spacing=".06em">${esc(nd.t)}</text>
          <text x="${x + bw / 2}" y="${y + 31}" font-size="11.5" text-anchor="middle" fill="#1f2547">${esc(nd.s)}</text>
          ${nd.s2 ? `<text x="${x + bw / 2}" y="${y + 44}" font-size="9.5" text-anchor="middle" fill="#6b7194">${esc(nd.s2)}</text>` : ''}`);
        x += bw + SP;
      });
      // hub → on-prem: uma linha por tipo (VPN / dedicado), com os nomes resumidos
      if (hasOnprem) hubs.forEach((hb) => {
        const ls = hubOnprem[hb.id] || []; if (!ls.length) return;
        const types = [...new Set(ls.map((l) => l.type))];
        types.forEach((tp, i) => {
          const [color, dash] = LINK[tp] || LINK.vpn;
          const yy = y + bh / 2 + (i - (types.length - 1) / 2) * 18 + 4;
          const x1 = at[hb.id] + bw, x2 = at.onprem;
          const [a, b] = x1 < x2 ? [x1, x2] : [at.onprem + bw, at[hb.id]];
          const n = ls.filter((l) => l.type === tp).length;
          const lbl = (tp === 'vpn' ? 'VPN' : String(ls.find((l) => l.type === tp).label || 'Link dedicado').split(' · ')[0]) + (n > 1 ? ` ×${n}` : '');
          parts.push(`<line x1="${a}" y1="${yy}" x2="${b}" y2="${yy}" stroke="${color}" stroke-width="1.8" ${dash ? `stroke-dasharray="${dash}"` : ''}/><text x="${(a + b) / 2}" y="${yy - 4}" font-size="9" text-anchor="middle" fill="${color}" stroke="#fff" stroke-width="3" paint-order="stroke">${esc(cut(lbl, 26))}</text>`);
        });
      });
      y += bh + 22;
    }

    // cartões das redes: nome, CIDR · subnets, e etiquetas de conectividade
    const tagsOf = (n) => {
      const t = [];
      const ls = (m.links || []).filter((l) => l.a === n.id || l.b === n.id);
      const other = (l) => (l.a === n.id ? l.b : l.a);
      if (ls.some((l) => l.type === 'internet')) t.push(['internet', 'Internet']);
      ls.filter((l) => hubById[other(l)]).forEach((l) => t.push(['hub', hubById[other(l)].type === 'Transit Gateway' ? 'TGW' : hubById[other(l)].type]));
      ls.filter((l) => l.type === 'peering' && name[other(l)]).forEach((l) => t.push(['peering', '↔ ' + cut(name[other(l)], 16)]));
      ls.filter((l) => other(l) === 'onprem').forEach((l) => t.push([l.type === 'dedicated' ? 'dedicated' : 'vpn', String(l.label || 'VPN').split(' · ')[0]]));
      const gw = [...new Set((n.gateways || []).map((g) => SHORT[g.type] || g.type).filter((g) => g !== 'IGW' && g !== 'LPG' && g !== 'VGW'))];
      if (d.showGateways !== false) gw.forEach((g) => t.push(['gw', g]));
      const seen = new Set(); return t.filter(([k, s]) => (seen.has(k + s) ? false : seen.add(k + s)));
    };
    const layout = (n) => { const rows = [[]]; let x = 10; tagsOf(n).forEach(([k, s]) => { const w = 12 + s.length * 5.4; if (x + w > cw - 8 && rows[rows.length - 1].length) { rows.push([]); x = 10; } rows[rows.length - 1].push({ k, s, x, w }); x += w + 4; }); return rows[0].length ? rows : []; };
    // books sincronizados antes do estilo compacto (sem "style") saem sem a lista de subnets
    const showSub = d.style === 'compact' && d.showSubnets === true;
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
  const svg = (d, width = W) => (d.style === 'detailed' ? svgDetailed(d, width) : compact(d, width));

  const count = (d) => ((d.model && d.model.networks) || []).filter((n) => !(d.hidden || []).includes(n.id)).length;

  BT.blocks.register('topology', {
    label: 'Topologia de rede', icon: '🗺️', desc: 'Desenho automático das redes da cloud (preenchido pela sincronização de Redes)', order: 47,
    create: () => ({ title: 'Topologia de rede', provider: '', style: 'compact', hidden: [], model: { networks: [], hubs: [], links: [] } }),
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
      const subOn = () => (d.style === 'detailed' ? d.showSubnets !== false : d.style === 'compact' && d.showSubnets === true);
      const subChk = h('input', { type: 'checkbox', checked: subOn(), onchange: (e) => { d.style = d.style || 'compact'; d.showSubnets = e.target.checked; save(); } });
      const styleRow = h('div', { class: 'tone-row', style: { marginTop: '8px' } });
      const drawStyle = () => { styleRow.innerHTML = ''; [['compact', '▦ Compacto'], ['detailed', '🗺️ Detalhado']].forEach(([k, l]) => styleRow.appendChild(h('button', { class: (d.style || 'compact') === k ? 'on' : '', onclick: () => { d.style = k; subChk.checked = subOn(); drawStyle(); save(); } }, l))); };
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
