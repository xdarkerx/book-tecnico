#!/usr/bin/env node
/* ═══ Monta o app local para Windows (npm run build:exe) ═══
 * Gera dist/BookTecnico/ e dist/BookTecnico-app-local.zip:
 *   BookTecnico.exe   lançador (ícone na bandeja, Abrir/Sair), compilado com o csc.exe que vem no Windows
 *   runtime/node.exe  o Node.js desta máquina (quem usa o app não precisa instalar nada)
 *   app/              servidor e página (server, js, css, html, assets)
 * Requisitos para montar: Windows com .NET Framework 4 (vem no Windows 10/11) e Node.js 22.5+.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'BookTecnico');
const ZIP = path.join(DIST, 'BookTecnico-app-local.zip');
const APP_FILES = ['index.html', 'package.json', 'html', 'css', 'js', 'assets', 'server'];

if (process.platform !== 'win32') { console.error('  ✖ O executável só é montado no Windows.'); process.exit(1); }
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) { console.error(`  ✖ Precisa do Node.js 22.5+ para embutir (este é ${process.version}).`); process.exit(1); }
const CSC = [process.env.WINDIR + '\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe', process.env.WINDIR + '\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'].find((f) => fs.existsSync(f));
if (!CSC) { console.error('  ✖ csc.exe do .NET Framework 4 não encontrado.'); process.exit(1); }

console.log('  🧹 Limpando dist/BookTecnico');
fs.rmSync(OUT, { recursive: true, force: true });
fs.rmSync(ZIP, { force: true });
fs.mkdirSync(path.join(OUT, 'runtime'), { recursive: true });

console.log('  📦 Copiando o app');
for (const f of APP_FILES) fs.cpSync(path.join(ROOT, f), path.join(OUT, 'app', f), { recursive: true, filter: (src) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(src) });

console.log(`  🟢 Embutindo o Node.js ${process.version}`);
fs.copyFileSync(process.execPath, path.join(OUT, 'runtime', 'node.exe'));
const lic = path.join(path.dirname(process.execPath), 'LICENSE');
if (fs.existsSync(lic)) fs.copyFileSync(lic, path.join(OUT, 'runtime', 'LICENSE-nodejs.txt'));

console.log('  🛠  Compilando BookTecnico.exe');
execFileSync(CSC, ['/nologo', '/target:winexe', '/optimize+', '/codepage:65001', `/win32icon:${path.join(ROOT, 'desktop-local', 'icon.ico')}`,
  `/out:${path.join(OUT, 'BookTecnico.exe')}`, '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', path.join(ROOT, 'desktop-local', 'BookTecnico.cs')], { stdio: 'inherit' });

fs.writeFileSync(path.join(OUT, 'LEIA-ME.txt'), [
  'Book Técnico — app local',
  '',
  '1. Extraia esta pasta inteira (ex.: em Documentos\\BookTecnico). Não rode de dentro do ZIP.',
  '2. Abra o BookTecnico.exe. O app abre numa janela própria e fica um ícone perto do relógio.',
  '3. Para fechar de vez: botão direito no ícone › Sair.',
  '',
  'O banco fica em %APPDATA%\\BookTecnico\\book-tecnico.sqlite. Para salvar no OneDrive:',
  'Configurações › Aplicativo › Banco de dados.',
  'Log do app: %APPDATA%\\BookTecnico\\app.log',
  ''
].join('\r\n'));

console.log('  🗜  Gerando o ZIP');
execFileSync('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -Path '${OUT}' -DestinationPath '${ZIP}' -CompressionLevel Optimal -Force`], { stdio: 'inherit' });
const mb = (f) => (fs.statSync(f).size / 1048576).toFixed(1) + ' MB';
console.log(`\n  ✅ ${path.relative(ROOT, ZIP)} (${mb(ZIP)}) — pasta: ${path.relative(ROOT, OUT)}\n`);
