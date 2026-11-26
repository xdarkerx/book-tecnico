/* ═══ E-mail: SMTP ou Microsoft 365 (Graph) — envio dos books automáticos ═══
 * data/settings.json → mail: { method: 'smtp' | 'graph', from,
 *   smtp: { host, port, secure, user, pass }, graph: { tenantId, clientId, clientSecret } }
 * SMTP: qualquer servidor (Microsoft 365, Gmail com app password, servidor próprio), via nodemailer.
 * Microsoft 365: App Registration com permissão de aplicativo Mail.Send; envia como a caixa "from".
 *   Anexos acima de 3 MB vão por sessão de upload (até 150 MB), como pede a API do Graph.
 */
const storage = require('./storage');
const { httpError } = require('./storage/common');
const logs = require('./logs');

const MASK = '••••••••';
const DEF = { method: 'smtp', from: '', smtp: { host: '', port: 587, secure: false, user: '', pass: '' }, graph: { tenantId: '', clientId: '', clientSecret: '' } };
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

function config() {
  const m = storage.readFileSettings().mail || {};
  return { method: m.method === 'graph' ? 'graph' : 'smtp', from: m.from || '', smtp: Object.assign({}, DEF.smtp, m.smtp), graph: Object.assign({}, DEF.graph, m.graph) };
}
const configured = (c = config()) => !!(c.from && (c.method === 'graph' ? c.graph.tenantId && c.graph.clientId && c.graph.clientSecret : c.smtp.host));
function publicConfig() {
  const c = config();
  return Object.assign({}, c, { configured: configured(c), smtp: Object.assign({}, c.smtp, { pass: c.smtp.pass ? MASK : '' }), graph: Object.assign({}, c.graph, { clientSecret: c.graph.clientSecret ? MASK : '' }) });
}
function saveConfig(b = {}) {
  const old = config();
  const n = { method: b.method === 'graph' ? 'graph' : 'smtp', from: String(b.from ?? old.from).trim(), smtp: Object.assign({}, old.smtp), graph: Object.assign({}, old.graph) };
  if (n.from && !EMAIL.test(n.from)) throw httpError(400, 'Remetente inválido (ex.: books@suaempresa.com.br).');
  if (b.smtp) {
    for (const k of ['host', 'user']) if (b.smtp[k] != null) n.smtp[k] = String(b.smtp[k]).trim();
    if (b.smtp.port != null) { const p = Number(b.smtp.port); if (!Number.isInteger(p) || p < 1 || p > 65535) throw httpError(400, 'Porta SMTP inválida.'); n.smtp.port = p; }
    if (b.smtp.secure != null) n.smtp.secure = !!b.smtp.secure;
    if (b.smtp.pass != null && b.smtp.pass !== MASK) n.smtp.pass = String(b.smtp.pass);
  }
  if (b.graph) {
    for (const k of ['tenantId', 'clientId']) if (b.graph[k] != null) n.graph[k] = String(b.graph[k]).trim();
    if (b.graph.clientSecret != null && b.graph.clientSecret !== MASK) n.graph.clientSecret = String(b.graph.clientSecret).trim();
  }
  storage.writeFileSettings({ mail: n });
  logs.audit('config.mail', `E-mail configurado: ${n.method === 'graph' ? 'Microsoft 365' : 'SMTP ' + n.smtp.host} · remetente ${n.from || '(vazio)'}`);
  return publicConfig();
}

/** Destinatários "a@x, b@y; c@z" → lista validada. */
function recipients(s) {
  const list = String(s || '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  const bad = list.find((x) => !EMAIL.test(x));
  if (bad) throw httpError(400, `E-mail inválido: ${bad}`);
  return list;
}

// ── SMTP ──
async function sendSmtp(c, m) {
  let nodemailer;
  try { nodemailer = require('nodemailer'); } catch (e) { throw httpError(501, 'Biblioteca de e-mail (nodemailer) não instalada. Rode "npm install" (o container já vem com ela).'); }
  const t = nodemailer.createTransport({ host: c.smtp.host, port: c.smtp.port, secure: !!c.smtp.secure, auth: c.smtp.user ? { user: c.smtp.user, pass: c.smtp.pass } : undefined, connectionTimeout: 20000 });
  await t.sendMail({ from: c.from, to: m.to.join(', '), subject: m.subject, html: m.html, text: m.text, attachments: (m.attachments || []).map((a) => ({ filename: a.filename, content: a.content })) });
}

// ── Microsoft 365 (Graph) ──
async function graphToken(c) {
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(c.graph.tenantId)}/oauth2/v2.0/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: c.graph.clientId, client_secret: c.graph.clientSecret, scope: 'https://graph.microsoft.com/.default' }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw httpError(502, 'Microsoft 365: falha ao autenticar o App Registration — ' + (j.error_description || j.error || res.status));
  return j.access_token;
}
async function graph(tk, method, url, body, headers = {}) {
  const res = await fetch(url.startsWith('http') ? url : 'https://graph.microsoft.com/v1.0' + url, { method, headers: Object.assign({ authorization: 'Bearer ' + tk }, body !== undefined && !Buffer.isBuffer(body) ? { 'content-type': 'application/json' } : {}, headers), body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) });
  const txt = await res.text(); let j = {}; try { j = txt ? JSON.parse(txt) : {}; } catch (e) { /* sem JSON */ }
  if (!res.ok) throw httpError(502, `Microsoft 365 (${res.status}): ${(j.error && j.error.message) || txt.slice(0, 300)}`);
  return j;
}
async function sendGraph(c, m) {
  const tk = await graphToken(c);
  const user = encodeURIComponent(c.from);
  const message = { subject: m.subject, body: { contentType: 'HTML', content: m.html }, toRecipients: m.to.map((a) => ({ emailAddress: { address: a } })) };
  const atts = m.attachments || [];
  const total = atts.reduce((s, a) => s + a.content.length, 0);
  if (total <= 3 * 1024 * 1024) {
    message.attachments = atts.map((a) => ({ '@odata.type': '#microsoft.graph.fileAttachment', name: a.filename, contentBytes: a.content.toString('base64') }));
    await graph(tk, 'POST', `/users/${user}/sendMail`, { message, saveToSentItems: true });
    return;
  }
  // anexo grande: rascunho → sessão de upload por anexo (blocos múltiplos de 320 KiB) → enviar
  const draft = await graph(tk, 'POST', `/users/${user}/messages`, message);
  for (const a of atts) {
    const s = await graph(tk, 'POST', `/users/${user}/messages/${draft.id}/attachments/createUploadSession`, { AttachmentItem: { attachmentType: 'file', name: a.filename, size: a.content.length } });
    const CHUNK = 320 * 1024 * 12; // ~3,75 MB
    for (let i = 0; i < a.content.length; i += CHUNK) {
      const part = a.content.subarray(i, Math.min(i + CHUNK, a.content.length));
      const res = await fetch(s.uploadUrl, { method: 'PUT', headers: { 'content-length': String(part.length), 'content-range': `bytes ${i}-${i + part.length - 1}/${a.content.length}` }, body: part });
      if (!res.ok) throw httpError(502, `Microsoft 365: falha ao enviar o anexo ${a.filename} (${res.status}).`);
    }
  }
  await graph(tk, 'POST', `/users/${user}/messages/${draft.id}/send`);
}

/** m: { to: [..] | "a@x, b@y", subject, html, text, attachments: [{ filename, content: Buffer }] } */
async function send(m) {
  const c = config();
  if (!configured(c)) throw httpError(400, 'E-mail não configurado: Configurações › Administrador › ✉️ E-mail.');
  const msg = Object.assign({}, m, { to: Array.isArray(m.to) ? m.to : recipients(m.to) });
  if (!msg.to.length) throw httpError(400, 'Informe ao menos um destinatário.');
  const size = (msg.attachments || []).reduce((s, a) => s + a.content.length, 0);
  if (size > 140 * 1024 * 1024) throw httpError(413, `Anexo grande demais para e-mail (${Math.round(size / 1048576)} MB).`);
  if (c.method === 'graph') await sendGraph(c, msg); else await sendSmtp(c, msg);
  logs.audit('mail.send', `E-mail enviado por ${c.method === 'graph' ? 'Microsoft 365' : 'SMTP'} para ${msg.to.join(', ')}: ${msg.subject}${size ? ` (${(size / 1048576).toFixed(1)} MB de anexo)` : ''}`);
  return { ok: true, to: msg.to };
}
async function test(to) {
  return send({ to, subject: 'Book Técnico — e-mail de teste', html: '<p>Este é um e-mail de teste do <b>Book Técnico</b>. Se chegou, o envio dos books automáticos está funcionando.</p>', text: 'E-mail de teste do Book Técnico.' });
}

module.exports = { config, publicConfig, saveConfig, configured, send, test, recipients, _sendGraph: sendGraph };
