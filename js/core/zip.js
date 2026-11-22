/* ═══ ZIP: leitura (sem bibliotecas) e escrita simples ═══
 * Leitura usa DecompressionStream('deflate-raw') — nativo no Chrome/Edge 103+,
 * Firefox 113+ e Safari 16.4+. Não suporta ZIP64 nem arquivos com senha.
 * Escrita gera ZIP "store" (sem compressão) — usado para o modelo de ZIP.
 */
(function (BT) {
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  const latin1 = new TextDecoder('latin1');
  const decodeName = (bytes) => { try { return utf8.decode(bytes); } catch (e) { return latin1.decode(bytes); } };

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador não descompacta ZIP. Use Chrome, Edge ou Firefox atualizados.');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** Lê um ZIP e devolve [{ path, name, size, read(): Promise<Uint8Array>, file(): Promise<File> }] */
  async function read(fileOrBuffer) {
    const buf = fileOrBuffer instanceof ArrayBuffer ? fileOrBuffer : await fileOrBuffer.arrayBuffer();
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Arquivo ZIP inválido ou corrompido.');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = [];
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Diretório do ZIP inválido.');
      const flags = dv.getUint16(p + 8, true);
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const size = dv.getUint32(p + 24, true);
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const path = decodeName(u8.subarray(p + 46, p + 46 + nlen)).replace(/\\/g, '/');
      p += 46 + nlen + elen + clen;
      if (path.endsWith('/')) continue;
      const entry = {
        path, name: path.split('/').pop(), size, encrypted: !!(flags & 1),
        async read() {
          if (entry.encrypted) throw new Error(`"${path}" está protegido por senha.`);
          const ln = dv.getUint16(local + 26, true), le = dv.getUint16(local + 28, true);
          const start = local + 30 + ln + le;
          const data = u8.subarray(start, start + csize);
          if (method === 0) return data.slice();
          if (method === 8) return inflateRaw(data);
          throw new Error(`Compressão não suportada em "${path}".`);
        },
        async file() { return new File([await entry.read()], entry.name); }
      };
      entries.push(entry);
    }
    return entries;
  }

  // ── Escrita (store) ─────────────────────────────────────
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

  /** files: [{ path, content: string|Uint8Array }] → Blob ZIP */
  function write(files) {
    const enc = new TextEncoder();
    const chunks = [], central = [];
    let offset = 0;
    const d = new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    files.forEach(({ path, content }) => {
      const name = enc.encode(path);
      const data = typeof content === 'string' ? enc.encode(content) : content;
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
      chunks.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    });
    const csize = central.reduce((s, c) => s + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, csize, true); end.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  BT.core.zip = { read, write };
})(window.BT);
