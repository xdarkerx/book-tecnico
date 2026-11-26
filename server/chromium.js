/* ═══ Chromium sem janela (headless) pelo DevTools Protocol — sem dependências ═══
 * Usado pela geração automática do book (server/automation.js): abre o próprio app, roda a sincronização
 * e as exportações no navegador e imprime o PDF (Page.printToPDF).
 * Navegador: BOOK_CHROMIUM (caminho) ou o primeiro encontrado: Chromium (container), Chrome ou Edge (Windows/macOS).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const CANDIDATES = [
  process.env.BOOK_CHROMIUM,
  '/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
  path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
].filter(Boolean);

function find() { return CANDIDATES.find((p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }) || null; }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Abre o navegador headless. Devolve { page(), close() }. */
async function launch() {
  const exe = find();
  if (!exe) throw new Error('Navegador para a geração automática não encontrado. No container ele já vem instalado; fora dele, instale o Chrome/Edge ou defina BOOK_CHROMIUM.');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'book-auto-'));
  const args = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage', '--hide-scrollbars',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1280,1600', 'about:blank'];
  if (process.platform === 'linux') args.unshift('--no-sandbox'); // container sem namespaces de usuário
  const proc = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const port = await new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error('O navegador da automação não respondeu em 30 s.')), 30000);
    proc.stderr.on('data', (d) => { buf += d; const m = buf.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//); if (m) { clearTimeout(t); resolve(Number(m[1])); } });
    proc.on('exit', (c) => { clearTimeout(t); reject(new Error(`O navegador da automação fechou (código ${c}). ${buf.slice(-300)}`)); });
  });
  const close = async () => {
    try { proc.kill(); } catch (e) { /* já fechou */ }
    await sleep(500);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* o navegador às vezes segura arquivos por um instante */ }
  };
  async function page() {
    const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', () => j(new Error('Falha ao conectar no navegador da automação.'))); });
    let id = 0; const pend = new Map(); const waiters = [];
    ws.addEventListener('message', (m) => {
      const d = JSON.parse(m.data);
      if (d.id && pend.has(d.id)) { const { res, rej } = pend.get(d.id); pend.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); }
      else if (d.method) for (const w of waiters.splice(0)) if (w.name === d.method) w.res(d.params); else waiters.push(w);
    });
    const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
    const once = (name, timeout = 60000) => new Promise((res, rej) => { const w = { name, res }; waiters.push(w); setTimeout(() => rej(new Error(`Tempo esgotado esperando ${name}`)), timeout); });
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    return {
      send,
      async cookie(url, name, value) { await send('Network.setCookie', { url, name, value, httpOnly: true, sameSite: 'Strict' }); },
      async goto(url) { const loaded = once('Page.loadEventFired', 90000); await send('Page.navigate', { url }); await loaded; },
      /** Avalia uma expressão (pode ser assíncrona) e devolve o valor. Erros da página viram exceção aqui. */
      async eval(expression, timeout = 600000) {
        const r = await Promise.race([send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), sleep(timeout).then(() => { throw new Error('Tempo esgotado na automação.'); })]);
        if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text || 'Erro na página');
        return r.result ? r.result.value : undefined;
      },
      async pdf() {
        const r = await send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, transferMode: 'ReturnAsBase64' });
        return Buffer.from(r.data, 'base64');
      },
      close() { try { ws.close(); } catch (e) { /* já fechado */ } }
    };
  }
  return { page, close, exe };
}

module.exports = { launch, find };
