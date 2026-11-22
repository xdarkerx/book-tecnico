#!/usr/bin/env node
/* Gera book-tecnico.html: o index.html com as partes de html/ já embutidas.
 * Use esse arquivo para abrir o app SEM servidor (duplo-clique), pois o navegador
 * não consegue buscar as partes via file://.        npm run build
 */
const fs = require('fs');
const path = require('path');
const { build } = require('../server/html-include');
const out = path.join(__dirname, '..', 'book-tecnico.html');
const html = build().replace('<script src="js/core/include.js"></script>\n', '');
fs.writeFileSync(out, html);
console.log('book-tecnico.html gerado (' + Math.round(html.length / 1024) + ' KB) — abra direto no navegador.');
