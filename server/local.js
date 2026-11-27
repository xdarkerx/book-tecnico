/* ═══ Modo aplicativo local (branch app-local) ═══
 * Ligado por BOOK_LOCAL=1 (o launcher "Book Técnico.cmd" já liga). Neste modo:
 *  - sem login: quem edita é o usuário do Windows + o nome da máquina;
 *  - só SQLite, num arquivo que pode ficar em qualquer pasta (ex.: OneDrive);
 *  - histórico simples: quem (usuário e máquina) mexeu em qual book e quando, gravado no próprio banco
 *    (vai junto com o arquivo para as outras máquinas);
 *  - sem as opções de site (login, MongoDB, edição simultânea, backup do servidor, e-mail e book automático).
 * A configuração do app (onde está o banco) fica em %APPDATA%\BookTecnico\local.json, fora do banco.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const LOCAL = process.env.BOOK_LOCAL === '1';
const APPDIR = process.env.BOOK_DATA_DIR || path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'BookTecnico');
const CONF = path.join(APPDIR, 'local.json');
const DB_NAME = 'book-tecnico.sqlite';

const readConf = () => { try { return JSON.parse(fs.readFileSync(CONF, 'utf8')); } catch (e) { return {}; } };
const writeConf = (patch) => { fs.mkdirSync(APPDIR, { recursive: true }); fs.writeFileSync(CONF, JSON.stringify(Object.assign(readConf(), patch), null, 2)); };
/** Arquivo do banco em uso: o escolhido nas configurações ou %APPDATA%\BookTecnico\book-tecnico.sqlite. */
const dbFile = () => readConf().dbFile || path.join(APPDIR, DB_NAME);

/** Quem está usando: usuário do Windows e nome da máquina. */
function who() {
  let user = process.env.USERNAME || process.env.USER || '';
  try { user = os.userInfo().username || user; } catch (e) { /* sem info do usuário */ }
  return { user, machine: os.hostname() };
}

/** Pastas sugeridas: OneDrive da empresa e pessoal (variáveis do Windows), Documentos. */
function suggestions() {
  const out = [];
  const add = (label, dir) => { if (dir && fs.existsSync(dir) && !out.some((x) => x.dir === dir)) out.push({ label, dir: path.join(dir, 'BookTecnico') }); };
  add('OneDrive da empresa', process.env.OneDriveCommercial);
  add('OneDrive', process.env.OneDriveConsumer || process.env.OneDrive);
  add('Documentos', path.join(os.homedir(), 'Documents'));
  return out;
}

/** Caminho digitado → arquivo .sqlite (aceita a pasta ou o arquivo). */
function normalizeTarget(p) {
  let t = String(p || '').trim().replace(/^"|"$/g, '');
  if (!t) throw Object.assign(new Error('Informe a pasta onde salvar o banco.'), { status: 400 });
  t = t.replace(/^%([^%]+)%/, (m, v) => process.env[v] || m).replace(/^~(?=$|[\\/])/, os.homedir());
  if (!path.isAbsolute(t)) throw Object.assign(new Error('Use o caminho completo da pasta (ex.: C:\\Users\\voce\\OneDrive\\BookTecnico).'), { status: 400 });
  return /\.(sqlite|db)$/i.test(t) ? t : path.join(t, DB_NAME);
}

/**
 * Troca o arquivo do banco. mode:
 *  'move' — leva o banco atual para o novo caminho (se lá já houver um banco, recusa);
 *  'use'  — passa a usar o banco que já existe no novo caminho (ex.: o que outra máquina sincronizou pelo OneDrive);
 *  'new'  — começa um banco vazio no novo caminho.
 */
function setDbFile(target, mode, closeDb) {
  const to = normalizeTarget(target);
  const from = dbFile();
  if (path.resolve(to).toLowerCase() === path.resolve(from).toLowerCase()) return { dbFile: from, changed: false };
  const exists = fs.existsSync(to);
  if (mode === 'use' && !exists) throw Object.assign(new Error(`Não há banco em ${to}. Escolha "Mover o banco atual" ou "Começar um banco novo".`), { status: 400 });
  if ((mode === 'move' || mode === 'new') && exists) throw Object.assign(new Error(`Já existe um banco em ${to}. Escolha "Usar o banco que já está lá".`), { status: 409 });
  fs.mkdirSync(path.dirname(to), { recursive: true });
  closeDb(); // fecha o arquivo antes de copiar
  if (mode === 'move' && fs.existsSync(from)) {
    fs.copyFileSync(from, to);
    // o original vira cópia de segurança (não apaga nada)
    try { fs.renameSync(from, from + '.movido-' + new Date().toISOString().slice(0, 10) + '.bak'); } catch (e) { /* fica onde está */ }
    for (const ext of ['-wal', '-shm', '-journal']) { try { fs.unlinkSync(from + ext); } catch (e) { /* não existe */ } }
  }
  writeConf({ dbFile: to });
  process.env.BOOK_DB_FILE = to;
  return { dbFile: to, changed: true, mode };
}

/** Abre a janela "Escolher pasta" do Windows (o navegador não dá o caminho real da pasta). */
function pickFolder(start) {
  if (process.platform !== 'win32') return Promise.resolve({ path: '' });
  const ps = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$f = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$f.Description = 'Pasta onde o Book Técnico vai salvar o banco (ex.: no OneDrive)'",
    '$f.ShowNewFolderButton = $true',
    start ? `$f.SelectedPath = '${String(start).replace(/'/g, "''")}'` : '',
    '$w = New-Object System.Windows.Forms.Form; $w.TopMost = $true',
    "if ($f.ShowDialog($w) -eq 'OK') { [Console]::Out.Write($f.SelectedPath) }"
  ].filter(Boolean).join('; ');
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', ps], { windowsHide: true, timeout: 10 * 60 * 1000 }, (err, stdout) => resolve({ path: err ? '' : String(stdout || '').trim() }));
  });
}

/** Configura as variáveis do processo antes de carregar o servidor. */
function applyEnv() {
  if (!LOCAL) return;
  fs.mkdirSync(APPDIR, { recursive: true });
  process.env.BOOK_DATA_DIR = APPDIR;            // settings.json, logs e conexões antigas
  process.env.BOOK_STORAGE = 'sqlite';           // só SQLite
  process.env.BOOK_DB_FILE = dbFile();
  // um arquivo só (sem -wal/-shm): seguro para o OneDrive sincronizar
  process.env.BOOK_SQLITE_JOURNAL = process.env.BOOK_SQLITE_JOURNAL || 'DELETE';
}

module.exports = { LOCAL, APPDIR, CONF, dbFile, setDbFile, who, suggestions, pickFolder, applyEnv, normalizeTarget };
