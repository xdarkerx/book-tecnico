/* ═══ Exportar Word (.doc em MHTML) ═══
 * O Word tem um motor HTML antigo: não entende flexbox, gradientes, var(--x) nem SVG.
 * Por isso este exportador:
 *  1. gera um HTML próprio com layout em <table> e estilos inline (cores sólidas);
 *  2. converte imagens SVG → PNG e calcula largura/altura;
 *  3. embute as imagens como PNG/JPG (data URI) e salva como .doc (HTML do Word),
 *     o mesmo formato do book original — abre no Word e no LibreOffice.
 */
(function (BT) {
  const esc = BT.esc;
  const U = BT.core.utils;

  function sectionHeader(section) {
    return `<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:16pt 0 8pt"><tr>
      <td style="background:#f7f6ff;border-left:3pt solid #5E3FE1;padding:6pt 10pt;font-family:Arial;font-size:10pt;font-weight:bold;color:#0a0c1a;text-transform:uppercase;letter-spacing:.5px">${esc(section.icon)}&nbsp;&nbsp;${esc(section.title)}</td></tr></table>`;
  }

  function separator(group, M) {
    const title = group.provider && BT.data.providers[group.provider] ? BT.data.providers[group.provider].display + (group.account ? ' · ' + group.account : '') : group.title; // provedor desconhecido (projeto de outra versão): usa o título
    return `<br clear="all" style="page-break-before:always">
      <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 12pt"><tr>
      <td width="6" style="background:#5E3FE1;width:4pt">&nbsp;</td>
      <td style="background:#171C37;padding:14pt 18pt">
        <p style="margin:0;font-family:Consolas,monospace;font-size:7pt;color:#86D2EF;letter-spacing:3px;text-transform:uppercase">inventCloud · Book Técnico</p>
        <p style="margin:4pt 0 0;font-family:Arial;font-size:18pt;font-weight:bold;color:#ffffff">${esc(group.icon)} ${esc(title)}</p>
        <p style="margin:4pt 0 0;font-family:Consolas,monospace;font-size:8pt;color:#a9adc6">${esc(group.subtitle || `${M.nome} · ${M.mesRef}`)}</p>
      </td></tr></table>`;
  }

  function cover(M) {
    const metaCell = (l, v) => `<td valign="top" style="padding:0 10pt 0 0"><p style="margin:0;font-family:Consolas,monospace;font-size:6.5pt;color:#8a8fae;letter-spacing:2px;text-transform:uppercase">${l}</p><p style="margin:3pt 0 0;font-family:Arial;font-size:10pt;font-weight:bold;color:#ffffff">${esc(v)}</p></td>`;
    return `<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr><td style="background:#0a0c1a;padding:36pt 34pt 30pt">
      <table width="100%" cellspacing="0" cellpadding="0"><tr><td><img src="${BT.data.LOGO_WHITE}" width="172" height="32"></td>
      ${BT.safeSrc(M.logoCliente) ? `<td align="right"><img src="${BT.safeSrc(M.logoCliente)}" width="120" data-fit="1"></td>` : ''}</tr></table>
      <p style="margin:40pt 0 0;font-family:Consolas,monospace;font-size:8pt;color:#8a8fae;letter-spacing:5px;text-transform:uppercase">— Book Técnico</p>
      <p style="margin:6pt 0 0;font-family:Arial;font-size:30pt;font-weight:bold;color:#ffffff;line-height:110%">${esc(M.nome)}</p>
      ${M.subtitulo ? `<p style="margin:8pt 0 0;font-family:Consolas,monospace;font-size:10pt;color:#9da2c0">${esc(M.subtitulo)}</p>` : ''}
      <table width="100%" cellspacing="0" cellpadding="0" style="margin-top:34pt;border-top:1px solid #2a2f4a"><tr><td colspan="5" style="font-size:6pt">&nbsp;</td></tr><tr>
        ${metaCell('Referência', M.mesRef)}${metaCell('Ambientes', M.ambientes)}${metaCell('Responsável', M.responsavel)}${M.area ? metaCell('Área técnica', M.area) : ''}${M.time ? metaCell('Time', M.time) : ''}
      </tr></table>
    </td></tr><tr><td style="background:#5E3FE1;font-size:2pt;line-height:3pt">&nbsp;</td></tr></table>`;
  }

  function footer(M) {
    const gi = BT.book.govItems(M.gov);
    let gov = '';
    for (let i = 0; i < gi.length; i += 4) {
      gov += '<tr>' + gi.slice(i, i + 4).map(([l, v]) => `<td width="25%" style="padding:4pt 8pt"><p style="margin:0;font-family:Consolas,monospace;font-size:6pt;color:#8a8fae;text-transform:uppercase">${l}</p><p style="margin:1pt 0 0;font-family:Arial;font-size:8.5pt;font-weight:bold;color:#ffffff">${esc(v)}</p></td>`).join('') + '</tr>';
    }
    return `<p style="margin:18pt 0 0;font-size:2pt">&nbsp;</p><table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border-top:2pt solid #5E3FE1"><tr><td style="background:#0a0c1a;padding:6pt 10pt">
      <table width="100%" cellspacing="0" cellpadding="0"><tr>
        <td style="font-family:Consolas,monospace;font-size:7pt;color:#8a8fae">inventCloud — Confidencial</td>
        <td align="center" style="font-family:Consolas,monospace;font-size:7pt;color:#ffffff;font-weight:bold">${esc(M.nome)} · ${esc(M.mesRef)}</td>
        <td align="right" style="font-family:Consolas,monospace;font-size:7pt;color:#8a8fae">Gerado em ${U.today()}</td></tr></table>
      ${gov ? `<table width="100%" cellspacing="0" cellpadding="0" style="margin-top:4pt;border-top:1px solid #2a2f4a">${gov}</table>` : ''}
    </td></tr></table>`;
  }

  function buildHtml(state, selection) {
    const parts = BT.book.collect(state, selection);
    const M = BT.book.meta(state, parts);
    const ctx = { target: 'word', state };
    const out = [cover(M)];
    if (state.meta.mostrarSumario && parts.length) {
      let n = 0;
      out.push('<br clear="all" style="page-break-before:always">' + sectionHeader({ icon: '🧭', title: 'Sumário' }) + parts.map((p) =>
        `<p style="margin:10pt 0 2pt;font-family:Consolas,monospace;font-size:8.5pt;font-weight:bold;color:#171C37;text-transform:uppercase">${esc(p.group.title)}</p>` +
        p.sections.map((s) => `<p style="margin:0;padding:2pt 0;border-bottom:1px dotted #e3e1f3;font-family:Arial;font-size:10pt;color:#3d4466"><span style="font-family:Consolas,monospace;color:#5E3FE1;font-size:8pt">${String(++n).padStart(2, '0')}</span>&nbsp;&nbsp;${esc(s.section.title)}</p>`).join('')).join(''));
    }
    let first = true;
    parts.forEach(({ group, sections }) => {
      if (group.separator) out.push(separator(group, M));
      else if (first) out.push('<br clear="all" style="page-break-before:always">');
      first = false;
      sections.forEach(({ section, blocks }) => {
        out.push(sectionHeader(section));
        blocks.forEach((b) => out.push(BT.blocks.renderBook(b, ctx)));
      });
    });
    out.push(footer(M));
    return { html: out.join('\n'), M };
  }

  // ── Imagens: SVG→PNG, dimensões, e coleta para o pacote MHTML ──
  function loadImg(src) {
    return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  }
  async function toRaster(src) {
    const img = await loadImg(src);
    if (!img) return null;
    let w = img.naturalWidth || 600, hgt = img.naturalHeight || 400;
    if (/^data:image\/svg/i.test(src) || /^data:image\/(webp|bmp)/i.test(src)) {
      const scale = 2, c = document.createElement('canvas');
      if (!w || !hgt) { w = 600; hgt = 400; }
      c.width = w * scale; c.height = hgt * scale;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return { src: c.toDataURL('image/png'), w, h: hgt };
    }
    return { src, w, h: hgt };
  }

  async function packageImages(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const parts = [];
    const cache = new Map();
    for (const img of tpl.content.querySelectorAll('img')) {
      const src = img.getAttribute('src') || '';
      if (!src.startsWith('data:')) continue;
      let r = cache.get(src);
      if (!r) { r = await toRaster(src); cache.set(src, r); }
      if (!r) { img.remove(); continue; }
      // dimensões: respeita width pedido e calcula altura proporcional
      const reqW = Number(img.getAttribute('width')) || Math.min(r.w, 600);
      const w = Math.min(reqW, r.w * 2);
      img.setAttribute('width', String(Math.round(w)));
      img.setAttribute('height', String(Math.round(w * r.h / r.w)));
      img.setAttribute('src', r.src);
    }
    return { html: tpl.innerHTML, parts };
  }

  /** Documento Word (.doc em HTML) como texto. Usado pelo download e pela geração automática. */
  async function wordDoc(state, selection) {
    const built = buildHtml(state, selection);
    const M = built.M;
    // converte imagens só no corpo (o <template> descartaria <html>/<head>)
    const { html: body } = await packageImages(built.html);
    const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><meta name="ProgId" content="Word.Document"><title>Book Técnico — ${esc(M.nome)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->
<style>
@page WordSection1{size:21cm 29.7cm;margin:1.6cm 1.6cm 1.6cm 1.6cm;mso-page-orientation:portrait}
div.WordSection1{page:WordSection1}
body{font-family:Arial,sans-serif;font-size:10.5pt;color:#3d4466}
p{margin:0 0 6pt}
table{border-collapse:collapse}
ul,ol{margin-top:2pt;margin-bottom:6pt}
a{color:#5E3FE1}
h3{font-family:Arial;font-size:12pt;color:#171C37;margin:10pt 0 4pt}
</style></head>
<body><div class="WordSection1">${body}</div></body></html>`;
    return { doc, M };
  }
  BT.exporters.wordString = async (state, selection) => '\uFEFF' + (await wordDoc(state, selection)).doc;

  BT.exporters.word = async function (state, selection) {
    const { doc, M } = await wordDoc(state, selection);
    U.download(new Blob(['\uFEFF' + doc], { type: 'application/msword;charset=utf-8' }), `book-tecnico-${U.slug(M.nome)}-${U.slug(M.mesRef)}.doc`);
  };
  BT.exporters._wordHtml = buildHtml; // útil para testes
})(window.BT);
