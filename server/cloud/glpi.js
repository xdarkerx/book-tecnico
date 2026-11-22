/* ═══ Conector GLPI (API REST) — chamados do período ═══
 * Config (por cliente):
 *   { url: 'https://glpi.empresa.com' (ou .../apirest.php), appToken?, userToken? | user + password,
 *     entity?: 'Nome da entidade (filtra por texto)', insecure?: true }
 * No GLPI: Configurar › Geral › API → habilite a API REST e crie um cliente (App-Token).
 * O token pessoal fica em Preferências › Chaves de acesso remoto (API token).
 */
const U = require('./util');

const STATUS = { 1: 'Novo', 2: 'Em andamento', 3: 'Planejado', 4: 'Pendente', 5: 'Resolvido', 6: 'Fechado' };
const PRIORITY = { 1: 'Muito baixa', 2: 'Baixa', 3: 'Média', 4: 'Alta', 5: 'Muito alta', 6: 'Crítico' };
const TYPE = { 1: 'Incidente', 2: 'Requisição' };

function base(cfg) {
  if (!cfg.url) throw new Error('Informe a URL do GLPI.');
  const u = cfg.url.replace(/\/+$/, '');
  return /apirest\.php$/.test(u) ? u : u + '/apirest.php';
}
async function session(cfg) {
  const api = base(cfg);
  const headers = { 'content-type': 'application/json' };
  if (cfg.appToken) headers['App-Token'] = cfg.appToken;
  if (cfg.userToken) headers.Authorization = 'user_token ' + cfg.userToken;
  else if (cfg.user && cfg.password) headers.Authorization = 'Basic ' + Buffer.from(cfg.user + ':' + cfg.password).toString('base64');
  else throw new Error('Informe o token de usuário (API token) ou usuário/senha do GLPI.');
  const j = await (await U.request(api + '/initSession', { headers, insecure: !!cfg.insecure })).json();
  const h = { 'content-type': 'application/json', 'Session-Token': j.session_token };
  if (cfg.appToken) h['App-Token'] = cfg.appToken;
  return {
    api, headers: h,
    get: async (path) => (await U.request(api + path, { headers: h, insecure: !!cfg.insecure, timeout: 120000 })).json(),
    close: () => U.request(api + '/killSession', { headers: h, insecure: !!cfg.insecure }).catch(() => {})
  };
}

async function test(cfg) {
  const s = await session(cfg);
  try {
    const me = await s.get('/getFullSession');
    return { message: `Conectado ao GLPI como ${me.session?.glpiname || 'usuário'}${me.session?.glpiactive_entity_name ? ' — entidade ' + me.session.glpiactive_entity_name : ''}` };
  } finally { s.close(); }
}

const ddmmyyyy = (d) => (d ? new Date(d.replace(' ', 'T')).toLocaleDateString('pt-BR') : '');

async function pull(cfg, kind, opts = {}) {
  const now = new Date();
  const from = opts.from ? new Date(opts.from + 'T00:00:00') : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = opts.to ? new Date(opts.to + 'T23:59:59') : now;
  const s = await session(cfg);
  const tickets = [];
  try {
    // mais recentes primeiro; para quando passar do início do período
    for (let start = 0, page = 0; page < 40; page++, start += 200) {
      const list = await s.get(`/Ticket?expand_dropdowns=true&range=${start}-${start + 199}&sort=date&order=DESC`);
      if (!Array.isArray(list) || !list.length) break;
      tickets.push(...list);
      const oldest = new Date(String(list[list.length - 1].date || '').replace(' ', 'T'));
      if (list.length < 200 || oldest < from) break;
    }
  } finally { s.close(); }

  const ent = String(cfg.entity || '').toLowerCase();
  const inPeriod = tickets.filter((t) => {
    const d = new Date(String(t.date || '').replace(' ', 'T'));
    if (ent && !String(t.entities_id || '').toLowerCase().includes(ent)) return false;
    return d >= from && d <= to;
  });
  const backlog = tickets.filter((t) => Number(t.status) < 5 && new Date(String(t.date || '').replace(' ', 'T')) < from && (!ent || String(t.entities_id || '').toLowerCase().includes(ent)));

  const count = (arr, f) => arr.reduce((m, t) => { const k = f(t) || '—'; m[k] = (m[k] || 0) + 1; return m; }, {});
  const solved = inPeriod.filter((t) => t.solvedate);
  const hours = solved.map((t) => (new Date(t.solvedate.replace(' ', 'T')) - new Date(t.date.replace(' ', 'T'))) / 3600000).filter((x) => x >= 0);
  const days = Math.max(1, Math.round((to - from) / 86400000));
  const perDay = Array.from({ length: days }, (_, i) => { const d = new Date(from.getTime() + i * 86400000); return { label: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`, abertos: 0, resolvidos: 0 }; });
  inPeriod.forEach((t) => { const i = Math.floor((new Date(t.date.replace(' ', 'T')) - from) / 86400000); if (perDay[i]) perDay[i].abertos++; });
  solved.forEach((t) => { const i = Math.floor((new Date(t.solvedate.replace(' ', 'T')) - from) / 86400000); if (perDay[i]) perDay[i].resolvidos++; });

  const summary = {
    periodLabel: `${from.toLocaleDateString('pt-BR')} – ${to.toLocaleDateString('pt-BR')}`,
    total: inPeriod.length,
    incidentes: inPeriod.filter((t) => Number(t.type) === 1).length,
    requisicoes: inPeriod.filter((t) => Number(t.type) === 2).length,
    resolvidos: inPeriod.filter((t) => Number(t.status) >= 5).length,
    abertos: inPeriod.filter((t) => Number(t.status) < 5).length,
    backlog: backlog.length,
    mttrHoras: hours.length ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10 : null,
    byStatus: count(inPeriod, (t) => STATUS[t.status]), byPriority: count(inPeriod, (t) => PRIORITY[t.priority]),
    byCategory: count(inPeriod, (t) => (typeof t.itilcategories_id === 'string' ? t.itilcategories_id.split(' > ').pop() : '') || 'Sem categoria'),
    byType: count(inPeriod, (t) => TYPE[t.type]), perDay,
    fetchedAt: new Date().toLocaleString('pt-BR')
  };
  const rows = [...inPeriod, ...backlog].map((t) => ({
    'Chamado': '#' + t.id, 'Título': t.name, 'Tipo': TYPE[t.type] || '', 'Categoria': typeof t.itilcategories_id === 'string' ? t.itilcategories_id : '',
    'Prioridade': PRIORITY[t.priority] || '', 'Status': STATUS[t.status] || '', 'Abertura': ddmmyyyy(t.date), 'Solução': ddmmyyyy(t.solvedate)
  }));
  return [{ kind: 'tickets', name: 'GLPI', summary, sheets: { tickets: U.sheet('raw', 'Chamados (GLPI)', rows) } }];
}

module.exports = { label: 'GLPI', test, pull };
