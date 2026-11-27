#!/usr/bin/env node
/* ═══ App local: sobe o Book Técnico nesta máquina e abre a janela ═══
 * Usado pelo "Book-Tecnico.cmd" (duplo clique). Sem login, só nesta máquina (127.0.0.1), banco SQLite no caminho
 * escolhido em ⚙️ Configurações › Banco de dados (ex.: OneDrive).
 * - Uma instância só: se o app já estiver aberto, só abre outra janela.
 * - Porta fixa (5190, ou a próxima livre, guardada em local.json): o tema e as preferências do navegador continuam.
 * - Janela: Microsoft Edge em modo app (sem barra de endereço); sem o Edge, o navegador padrão.
 */
process.env.BOOK_LOCAL = '1';
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`\n  ✖ O Book Técnico precisa do Node.js 22.5 ou mais novo (este é ${process.version}). Baixe em https://nodejs.org\n`);
  setTimeout(() => process.exit(1), 120000); // a janela fica aberta para ler a mensagem
  return; // (módulo CommonJS: return no topo encerra o script)
}
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const local = require('./local');
local.applyEnv();

const conf = () => { try { return JSON.parse(fs.readFileSync(local.CONF, 'utf8')); } catch (e) { return {}; } };
const save = (patch) => fs.writeFileSync(local.CONF, JSON.stringify(Object.assign(conf(), patch), null, 2));

/** Já tem um Book Técnico local nesta porta? */
async function running(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    const j = await r.json();
    return !!(j && j.local);
  } catch (e) { return false; }
}
const free = (port) => new Promise((res) => { const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(port, '127.0.0.1'); });

function openWindow(url) {
  if (process.env.BOOK_NO_WINDOW === '1') return;
  const run = (cmd, args) => new Promise((res) => { const p = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }); p.once('error', () => res(false)); p.once('spawn', () => { p.unref(); res(true); }); });
  if (process.platform === 'win32') {
    // "start msedge" acha o Edge pelo registro do Windows; sem ele, abre no navegador padrão
    const edge = spawn('cmd', ['/c', 'start', '""', 'msedge', `--app=${url}`], { windowsHide: true, stdio: 'ignore' });
    edge.on('exit', (code) => { if (code) spawn('cmd', ['/c', 'start', '""', url], { windowsHide: true, stdio: 'ignore' }); });
    return;
  }
  run(process.platform === 'darwin' ? 'open' : 'xdg-open', [url]);
}

(async () => {
  const wanted = Number(process.env.PORT) || conf().port || 5190;
  if (await running(wanted)) { console.log('  📘 O Book Técnico já está aberto: abrindo outra janela.'); openWindow(`http://127.0.0.1:${wanted}/`); setTimeout(() => process.exit(0), 1500); return; }
  let port = wanted;
  while (!(await free(port)) && port < wanted + 20) port++;
  if (port !== conf().port) save({ port });
  const { start } = require('./index');
  const p = await start({ port, host: '127.0.0.1' });
  const w = local.who();
  console.log(`  👤 ${w.user} em ${w.machine}`);
  console.log(process.env.BOOK_LAUNCHER === 'exe' ? '  ⚠  Para encerrar: ícone do Book Técnico perto do relógio › Sair.\n' : '  ⚠  Feche esta janela para encerrar o Book Técnico.\n');
  openWindow(`http://127.0.0.1:${p}/`);
})().catch((e) => { console.error('\n  ✖ Não foi possível abrir o Book Técnico: ' + e.message + '\n'); setTimeout(() => process.exit(1), 120000); });
