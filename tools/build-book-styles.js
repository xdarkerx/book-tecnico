#!/usr/bin/env node
/* Gera js/book/book-styles.js a partir de css/base/variables.css + css/book/*.css.
 * Por quê: aberto via file://, o navegador bloqueia a leitura das folhas CSS por script,
 * e o export HTML precisa embutir o CSS do book. Rode após editar css/book/*.css:
 *     node tools/build-book-styles.js
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const files = ['css/base/variables.css', 'css/book/book.css', 'css/book/print.css'];
const css = files.map((f) => `/* ${f} */\n` + fs.readFileSync(path.join(root, f), 'utf8')).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n\s*\n/g, '\n');
const out = `/* ARQUIVO GERADO por tools/build-book-styles.js — não edite à mão.\n   Fonte: ${files.join(', ')} */\n(function (BT) {\n  BT.book.STYLES = ${JSON.stringify(css)};\n})(window.BT);\n`;
fs.writeFileSync(path.join(root, 'js/book/book-styles.js'), out);
console.log('js/book/book-styles.js atualizado (' + css.length + ' bytes de CSS)');
