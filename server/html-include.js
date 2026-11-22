/* ═══ Monta o index.html a partir das partes em html/ ═══
 * Troca cada  <!-- @include caminho/arquivo.html -->  pelo conteúdo do arquivo (recursivo).
 * Usado pelo servidor (npm run dev) e pelo build (npm run build → book-tecnico.html).
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const RE = /^([ \t]*)<!--\s*@include\s+([\w./-]+)\s*-->/gm;

function resolve(html, depth = 0) {
  if (depth > 5) throw new Error('@include aninhado demais');
  return html.replace(RE, (_, indent, rel) => {
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(path.join(ROOT, 'html'))) throw new Error('@include fora da pasta html/: ' + rel);
    const part = resolve(fs.readFileSync(file, 'utf8'), depth + 1).replace(/\s+$/, '');
    return part.split('\n').map((l) => (l ? indent + l : l)).join('\n');
  });
}
const build = () => resolve(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
module.exports = { resolve, build };
