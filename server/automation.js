/* ═══ Geração automática do book por cliente ═══
 * Todo mês, no dia/hora escolhidos no cliente, gera o book do MÊS ANTERIOR (já fechado):
 *   1. cria o book do mês a partir do último book do cliente (mesmos menus, seções e textos fixos);
 *   2. abre o app num Chromium sem janela e roda a MESMA sincronização da tela, com as escolhas da última
 *      sincronização manual do cliente (clouds, tipos, Zabbix, backup, riscos) — aplica direto, sem revisão;
 *   3. exporta nos formatos escolhidos (PDF, Word, HTML; mais de um → ZIP);
 *   4. salva na pasta da rede do cliente e envia por e-mail para a(s) caixa(s) do cliente.
 * Configuração por cliente: kv "automation" (id = cliente). Pasta base (admin): settings.json → automation.baseFolder.
 */
const fs = require('fs');
const path = require('path');
const storage = require('./storage');
const { httpError, clientSlug } = require('./storage/common');
const logs = require('./logs');
const mail = require('./mail');
const chromium = require('./chromium');
const { zip } = require('./zipfile');

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const FORMATS = ['pdf', 'word', 'html'];
const EXT = { pdf: 'pdf', word: 'doc', html: 'html' };
let portOf = () => 0;
let running = null; // uma geração por vez
const queue = [];

const db = () => storage.api;
const pad = (n) => String(n).padStart(2, '0');

// ── configuração ─────────────────────────────────────────
function base() { return storage.readFileSettings().automation || {}; }
function saveBase(b = {}) {
  const baseFolder = String(b.baseFolder ?? base().baseFolder ?? '').trim();
  storage.writeFileSettings({ automation: { baseFolder } });
  logs.audit('config.automation', `Pasta base dos books automáticos: ${baseFolder || '(nenhuma)'}`);
  return { baseFolder };
}
const DEF = { enabled: false, day: 3, hour: 7, area: '', formats: ['pdf'], folder: '', emails: '', subject: '', message: '', profile: null, last: null };
async function get(cliente) {
  const c = clientSlug(cliente);
  return Object.assign({ cliente: c }, DEF, (await db().kvGet('automation', c)) || {});
}
async function save(cliente, b = {}, by) {
  const cur = await get(cliente);
  const n = Object.assign({}, cur);
  if (b.enabled != null) n.enabled = !!b.enabled;
  if (b.day != null) { const d = Number(b.day); if (!Number.isInteger(d) || d < 1 || d > 28) throw httpError(400, 'Dia do mês: de 1 a 28.'); n.day = d; }
  if (b.hour != null) { const h = Number(b.hour); if (!Number.isInteger(h) || h < 0 || h > 23) throw httpError(400, 'Hora: de 0 a 23.'); n.hour = h; }
  if (b.formats != null) { const f = [...new Set([].concat(b.formats).filter((x) => FORMATS.includes(x)))]; if (!f.length) throw httpError(400, 'Escolha ao menos um formato (PDF, Word ou HTML).'); n.formats = f; }
  for (const k of ['area', 'folder', 'subject', 'message']) if (b[k] != null) n[k] = String(b[k]).trim().slice(0, k === 'message' ? 4000 : 500);
  if (b.emails != null) { mail.recipients(b.emails); n.emails = String(b.emails).trim(); } // valida os endereços
  if (n.folder && /(^|[\\/])\.\.([\\/]|$)/.test(n.folder)) throw httpError(400, 'Pasta inválida.');
  await db().kvSet('automation', n.cliente, n);
  logs.audit('automation.config', `Geração automática de ${n.cliente}: ${n.enabled ? `ligada (dia ${n.day}, ${pad(n.hour)}h, ${n.formats.join('+')})` : 'desligada'}${n.emails ? ` · e-mail: ${n.emails}` : ''}`, by);
  return n;
}
/** Escolhas da última sincronização manual do cliente (a automação usa as mesmas). */
async function saveProfile(cliente, p = {}) {
  const cur = await get(cliente);
  const prof = {
    sources: Array.isArray(p.sources) ? p.sources.map(String).slice(0, 50) : [], kinds: Array.isArray(p.kinds) ? p.kinds.map(String).slice(0, 20) : [],
    newOnly: !!p.newOnly, backupMode: ['jobs', 'policies', 'both'].includes(p.backupMode) ? p.backupMode : 'both',
    zabbix: { severities: Array.isArray(p.zabbix && p.zabbix.severities) ? p.zabbix.severities.map(Number).filter((n) => n >= 0 && n <= 5) : [0, 1, 2, 3, 4, 5], onlyWithAlerts: !!(p.zabbix && p.zabbix.onlyWithAlerts) },
    risks: Array.isArray(p.risks) ? p.risks.filter((r) => ['critica', 'alta', 'media', 'baixa', 'info'].includes(r)) : undefined, savedAt: Date.now()
  };
  await db().kvSet('automation', cur.cliente, Object.assign(cur, { profile: prof, area: cur.area || String(p.area || '') }));
  return prof;
}

// ── execução ─────────────────────────────────────────────
/** Mês alvo: o anterior a "hoje" (já fechado). */
function targetMonth(now = new Date()) { const d = new Date(now.getFullYear(), now.getMonth() - 1, 1); return { ano: String(d.getFullYear()), mes: pad(d.getMonth() + 1) }; }
const monthKey = (t) => `${t.ano}-${t.mes}`;
const safeName = (s) => String(s).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
function folderOf(cfg, nome) {
  const b = String(base().baseFolder || process.env.BOOK_EXPORT_BASE || '').trim(); // no container: /exports
  const f = String(cfg.folder || '').trim();
  if (f && (path.isAbsolute(f) || /^\\\\/.test(f))) return f;
  if (!b) throw httpError(400, 'Defina a pasta de destino do cliente (ou a pasta base em Configurações › Administrador › ✉️ E-mail e automação).');
  return path.join(b, f || safeName(nome));
}

/** Cria o book do mês alvo a partir do último book anterior do cliente (se ainda não existir). */
async function ensureBook(cfg, t) {
  const all = (await db().listBooks({ cliente: cfg.cliente })).filter((b) => !cfg.area || b.areaSlug === clientSlug(cfg.area));
  const target = all.find((b) => b.ano === t.ano && b.mes === t.mes);
  if (target) return { key: { cliente: target.clienteSlug, ano: t.ano, mes: t.mes, area: target.areaSlug }, created: false, nome: target.cliente };
  const prev = all.filter((b) => `${b.ano}-${b.mes}` < monthKey(t)).sort((a, b) => `${b.ano}-${b.mes}`.localeCompare(`${a.ano}-${a.mes}`))[0];
  if (!prev) throw httpError(400, 'Não há book anterior deste cliente para usar como base. Crie o primeiro book à mão.');
  const st = JSON.parse(JSON.stringify(await db().getBook({ cliente: prev.clienteSlug, ano: prev.ano, mes: prev.mes, area: prev.areaSlug })));
  delete st.guid; delete st.ui; delete st.savedAt; delete st.createdAt; // novo book: novo GUID e datas
  st.meta = Object.assign({}, st.meta, { mes: t.mes, ano: t.ano });
  const key = { cliente: prev.clienteSlug, ano: t.ano, mes: t.mes, area: prev.areaSlug };
  await db().saveBook(key, st);
  logs.audit('automation.book', `Book ${prev.cliente} ${MESES[Number(t.mes) - 1]}/${t.ano} criado a partir de ${prev.mes}/${prev.ano}`);
  return { key, created: true, nome: prev.cliente };
}

/** Gera o book do cliente. o: { month: {ano, mes}, by, send: true }. Devolve o resultado (também gravado em cfg.last). */
async function run(cliente, o = {}) {
  const cfg = await get(cliente);
  const t = o.month || targetMonth();
  const started = Date.now();
  const result = { month: monthKey(t), at: started, ok: false, files: [], folder: '', emailed: '', warnings: [], by: (o.by && o.by.name) || 'Agendamento' };
  let browser = null;
  try {
    const { key, created, nome } = await ensureBook(cfg, t);
    result.book = `${key.cliente}/${key.ano}/${key.mes}/${key.area}`; result.created = created;
    browser = await chromium.launch();
    const page = await browser.page();
    const origin = `http://127.0.0.1:${portOf()}`;
    await page.cookie(origin, 'bt_auto', require('./auth').automationToken());
    await page.goto(`${origin}/?cliente=${encodeURIComponent(key.cliente)}&ano=${key.ano}&mes=${key.mes}&area=${encodeURIComponent(key.area)}`);
    await page.eval('BT.automation.ready()');
    const conns = await db().getConnections(key.cliente);
    if (Object.keys((conns && conns.providers) || {}).length) {
      const s = await page.eval(`BT.automation.sync(${JSON.stringify(cfg.profile || {})})`);
      result.synced = s.items; result.warnings.push(...(s.errors || []));
    } else result.warnings.push('Cliente sem conexões de cloud/Zabbix/GLPI: o book foi gerado sem sincronizar.');
    const fileBase = safeName(`Book Técnico - ${nome} - ${MESES[Number(t.mes) - 1]} de ${t.ano}`);
    const files = [];
    for (const f of cfg.formats) {
      if (f === 'html') files.push({ name: `${fileBase}.html`, data: Buffer.from(await page.eval('BT.automation.html()'), 'utf8') });
      if (f === 'word') files.push({ name: `${fileBase}.doc`, data: Buffer.from(await page.eval('BT.automation.word()'), 'utf8') });
      if (f === 'pdf') { await page.eval('BT.automation.pdf()'); files.push({ name: `${fileBase}.pdf`, data: await page.pdf() }); }
    }
    await page.eval('BT.automation.leave()').catch(() => {});
    page.close();
    const out = files.length > 1 ? { name: `${fileBase}.zip`, data: zip(files) } : files[0];
    // pasta da rede
    const dir = folderOf(cfg, nome);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, out.name), out.data);
    result.folder = dir; result.files = [out.name]; result.size = out.data.length;
    // e-mail
    if (cfg.emails && o.send !== false) {
      const subject = (cfg.subject || 'Book Técnico — {cliente} — {mes}').replace(/\{cliente\}/g, nome).replace(/\{mes\}/g, `${MESES[Number(t.mes) - 1]} de ${t.ano}`);
      const msg = (cfg.message || 'Olá,\n\nSegue o Book Técnico de {cliente} referente a {mes}.\n\nAtenciosamente,\nEquipe inventCloud').replace(/\{cliente\}/g, nome).replace(/\{mes\}/g, `${MESES[Number(t.mes) - 1]} de ${t.ano}`);
      const html = msg.split(/\n/).map((l) => (l ? `<p style="margin:0 0 8px">${l.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</p>` : '')).join('');
      await mail.send({ to: cfg.emails, subject, html, text: msg, attachments: [{ filename: out.name, content: out.data }] });
      result.emailed = cfg.emails;
    }
    result.ok = true;
    logs.audit('automation.run', `Book automático ${nome} ${MESES[Number(t.mes) - 1]}/${t.ano}: ${out.name} em ${dir}${result.emailed ? ` · enviado para ${result.emailed}` : ''}${result.warnings.length ? ` · avisos: ${result.warnings.join(' | ')}` : ''}`, { por: result.by });
  } catch (e) {
    result.error = e.message;
    logs.app('error', `Book automático de ${cfg.cliente} falhou: ${e.message}`);
    logs.audit('automation.fail', `Book automático de ${cfg.cliente} (${monthKey(t)}) falhou: ${e.message}`, { por: result.by });
  } finally {
    if (browser) await browser.close();
    result.ms = Date.now() - started;
    const fresh = await get(cliente);
    const tries = fresh.last && fresh.last.month === result.month && !fresh.last.ok ? (fresh.last.tries || 1) + 1 : 1;
    await db().kvSet('automation', fresh.cliente, Object.assign(fresh, { last: Object.assign(result, { tries }) }));
  }
  return result;
}

/** Fila: uma geração por vez (cada uma abre um navegador). */
function enqueue(cliente, o) {
  return new Promise((resolve) => {
    queue.push({ cliente, o, resolve });
    if (!running) next();
  });
}
async function next() {
  const job = queue.shift(); if (!job) { running = null; return; }
  running = job;
  try { job.resolve(await run(job.cliente, job.o)); } catch (e) { job.resolve({ ok: false, error: e.message }); }
  next();
}

/** Agendamento: a cada 10 min, gera o que estiver no horário (dia ≥ dia escolhido e hora ≥ hora escolhida)
 *  e ainda não foi gerado para o mês anterior. Falhou → tenta de novo (até 3 vezes, uma por hora). */
async function tick(now = new Date(), o = {}) {
  const t = targetMonth(now);
  const due = [];
  for (const cfg of await db().kvList('automation')) {
    if (!cfg || !cfg.enabled) continue;
    if (now.getDate() < cfg.day || (now.getDate() === cfg.day && now.getHours() < cfg.hour)) continue;
    const last = cfg.last;
    if (last && last.month === monthKey(t) && (last.ok || (last.tries || 1) >= 3 || now - last.at < 3600000)) continue;
    if (queue.some((q) => q.cliente === cfg.cliente) || (running && running.cliente === cfg.cliente)) continue;
    // cliente que começou a usar o app depois do mês alvo (nenhum book até ele): não há o que gerar — ignora sem registrar falha
    const books = (await db().listBooks({ cliente: cfg.cliente })).filter((b) => !cfg.area || b.areaSlug === clientSlug(cfg.area));
    if (!books.some((b) => `${b.ano}-${b.mes}` <= monthKey(t))) continue;
    due.push(cfg.cliente);
    if (!o.dry) enqueue(cfg.cliente, { month: t });
  }
  return due; // o.dry: só diz quem está no horário (testes)
}
let timer = null;
function start(getPort) {
  portOf = getPort;
  if (timer) return;
  timer = setInterval(() => tick().catch((e) => logs.app('error', 'Agendador de books: ' + e.message)), 10 * 60000);
  timer.unref && timer.unref();
  setTimeout(() => tick().catch(() => {}), 60000).unref();
}
function setPort(getPort) { portOf = getPort; }

module.exports = { get, save, saveProfile, base, saveBase, run, enqueue, tick, start, setPort, targetMonth, folderOf, FORMATS, _ensureBook: ensureBook, isRunning: (c) => !!(running && running.cliente === clientSlug(c)) };
