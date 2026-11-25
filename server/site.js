/* ═══ Site: URL externa e app desktop (Tauri) ═══
 * data/settings.json → site: { publicUrl, desktopUrl }
 *   publicUrl  — endereço pelo qual os usuários acessam o app (ex.: https://book.empresa.com).
 *                Usado no SAML (ACS / Entity ID), nos links e como servidor sugerido no app desktop.
 *   desktopUrl — de onde baixar o instalador do app desktop. Vazio = release do GitHub.
 * Instalador local: um .exe/.msi em data/desktop/ tem prioridade (funciona sem internet).
 */
const fs = require('fs');
const path = require('path');
const storage = require('./storage');
const { DATA, httpError } = require('./storage/common');
const logs = require('./logs');

const DEFAULT_DESKTOP = 'https://github.com/xdarkerx/book-tecnico/releases/download/desktop-teste/BookTecnico-Setup.exe';
const DESKTOP_DIR = () => path.join(DATA, 'desktop');
const URL_RE = /^https?:\/\/[^\s/?#]+(:\d+)?(\/[^\s?#]*)?$/i;

function config() {
  const s = storage.readFileSettings();
  const site = s.site || {};
  // versões anteriores guardavam o endereço dentro do SAML
  const legacy = (s.auth && s.auth.saml && s.auth.saml.publicUrl) || '';
  return { publicUrl: String(site.publicUrl || legacy || '').replace(/\/+$/, ''), desktopUrl: String(site.desktopUrl || '') };
}

/** Instalador colocado no servidor (data/desktop/*.exe|*.msi), o mais novo. */
function localInstaller() {
  try {
    const files = fs.readdirSync(DESKTOP_DIR()).filter((f) => /\.(exe|msi)$/i.test(f))
      .map((f) => ({ f, t: fs.statSync(path.join(DESKTOP_DIR(), f)).mtimeMs })).sort((a, b) => b.t - a.t);
    return files.length ? path.join(DESKTOP_DIR(), files[0].f) : null;
  } catch (e) { return null; }
}

/** O que a tela de qualquer usuário precisa saber. */
function publicInfo() {
  const c = config(); const local = localInstaller();
  return { publicUrl: c.publicUrl, desktop: { source: local ? 'local' : c.desktopUrl ? 'custom' : 'github', file: local ? path.basename(local) : '' } };
}
/** Configuração completa (admin). */
function adminConfig() { return Object.assign(config(), { defaultDesktopUrl: DEFAULT_DESKTOP, localInstaller: localInstaller() ? path.basename(localInstaller()) : '' }); }

function saveConfig(body = {}) {
  const old = config();
  const next = { publicUrl: old.publicUrl, desktopUrl: old.desktopUrl };
  for (const k of ['publicUrl', 'desktopUrl']) {
    if (body[k] == null) continue;
    let v = String(body[k]).trim().replace(/\/+$/, '');
    // "book.empresa.com" → "https://book.empresa.com" (só para algo com cara de domínio/IP)
    if (v && /^[a-z0-9.-]+(:\d+)?(\/[^\s?#]*)?$/i.test(v) && v.includes('.')) v = 'https://' + v;
    if (v && !URL_RE.test(v)) throw httpError(400, k === 'publicUrl' ? 'URL externa inválida (ex.: https://book.suaempresa.com.br).' : 'Link do instalador inválido (precisa começar com http:// ou https://).');
    if (v.length > 2000) throw httpError(400, 'Endereço longo demais.');
    next[k] = v;
  }
  storage.writeFileSettings({ site: next });
  const diff = [old.publicUrl !== next.publicUrl ? `URL externa: ${next.publicUrl || '(automática)'}` : '', old.desktopUrl !== next.desktopUrl ? `instalador do app: ${next.desktopUrl || '(GitHub)'}` : ''].filter(Boolean);
  if (diff.length) logs.audit('config.site', 'Site alterado: ' + diff.join(', '));
  return adminConfig();
}

/** Para onde mandar o download do app: arquivo local ou URL. */
function desktopDownload() {
  const local = localInstaller();
  if (local) return { file: local, name: path.basename(local) };
  return { redirect: config().desktopUrl || DEFAULT_DESKTOP };
}

/** Endereço base do app: URL externa ou o host da requisição. */
function baseUrl(req, isHttps) {
  const c = config();
  if (c.publicUrl) return c.publicUrl;
  return `${isHttps ? 'https' : 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

module.exports = { config, publicInfo, adminConfig, saveConfig, desktopDownload, baseUrl, DEFAULT_DESKTOP };
