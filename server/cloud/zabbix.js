/* ═══ Conector Zabbix (JSON-RPC) — capacidade, monitoramento e recomendações ═══
 * Config (por cliente):
 *   { url: 'https://zabbix.empresa.com', apiToken? | user + password, hostGroups: 'GRUPO A, GRUPO B',
 *     insecure?: true (certificado autoassinado), cpuWarn: 80, memWarn: 80, diskWarn: 85 }
 * Mesma lógica do book original: classifica triggers em CPU / memória / disco (ignorando
 * falha de coleta, swap, latência de I/O, serviços parados e jobs de backup), médias do
 * período via trends, top hosts, filesystems em alerta, resumo executivo e recomendações.
 */
const U = require('./util');

// ── Classificação de triggers (portada do book original) ──
function classify(name) {
  const n = String(name || '').toLowerCase();
  if (/sem coleta|sem dados? (?:h[aá]|por)|no data|nodata|zabbix agent.*(?:unreachable|down|not available)|agente? (?:zabbix )?(?:inacess[ií]vel|indispon[ií]vel)|host.*(?:unreachable|down)|unreachable/.test(n)) return 'other';
  if (/leitura\/grava[çc][aã]o|read\/write request|disk read\/write|await/.test(n)) return 'other';
  if (/is (?:not|no longer) running|servi[çc]o (?:est[áa] parado|n[ãa]o est[áa] em execu[çc][ãa]o)|service is (?:down|stopped)/.test(n)) return 'other';
  if (/veeam|restore point|backup job|is still running|job is unhealthy/.test(n)) return 'other';
  if (/swap/.test(n)) return 'other';
  if (/alta utiliza[çc][ãa]o (?:d[ea] )?cpu|cpu utili[sz]ation|high cpu utili[sz]ation/.test(n)) return 'cpu';
  if (/alta utiliza[çc][ãa]o de mem[oó]ria|memory utili[sz]ation|high memory utili[sz]ation/.test(n)) return 'mem';
  if (/\bdisk\b|\bdisco\b|storage|file ?system|\bfs\b|vfs\.fs|datadrive|criticamente baixo|espa[çc]o (?:em|de|do|no) disco|espa[çc]o livre|free space|low space|space is (?:critically )?low|space usage/.test(n)) return 'disk';
  return 'other';
}
function diskLabel(text) {
  const td = String(text || '').trim();
  const a = td.match(/\b(?:disco|disk)\s+([a-zA-Z]):+/i); if (a) return a[1].toUpperCase() + ':';
  const b = td.match(/^([A-Za-z0-9_\/][A-Za-z0-9_.\/-]*?):+\s/); if (b) return /^[A-Za-z]$/.test(b[1]) ? b[1].toUpperCase() + ':' : b[1];
  const c = td.match(/(\/[^\s:,]+)/); if (c) return c[1];
  return null;
}

function client(cfg) {
  if (!cfg.url) throw new Error('Informe a URL do Zabbix.');
  const endpoint = cfg.url.replace(/\/+$/, '').replace(/\/[^/]*\.php.*$/, '') + '/api_jsonrpc.php';
  let token = cfg.apiToken || null, version = null, useHeader = true;
  async function rpc(method, params = {}, auth = true) {
    const body = { jsonrpc: '2.0', method, params, id: 1 };
    const headers = { 'content-type': 'application/json-rpc' };
    if (auth && token) { if (useHeader) headers.authorization = 'Bearer ' + token; else body.auth = token; }
    const res = await U.request(endpoint, { method: 'POST', headers, body: JSON.stringify(body), insecure: !!cfg.insecure, timeout: 120000 });
    const j = await res.json();
    if (j.error) throw new Error(`Zabbix ${method}: ${j.error.data || j.error.message}`);
    return j.result;
  }
  return {
    rpc,
    async connect() {
      version = await rpc('apiinfo.version', {}, false);
      const [maj, min] = String(version).split('.').map(Number);
      useHeader = maj > 6 || (maj === 6 && min >= 4); // < 6.4 usa o campo "auth"
      if (!token) {
        if (!cfg.user || !cfg.password) throw new Error('Informe um API token ou usuário/senha do Zabbix.');
        const newApi = maj > 5 || (maj === 5 && min >= 4);
        token = await rpc('user.login', newApi ? { username: cfg.user, password: cfg.password } : { user: cfg.user, password: cfg.password }, false);
      }
      return version;
    }
  };
}

async function groupsAndHosts(z, cfg) {
  const names = U.list(String(cfg.hostGroups || '').replace(/\s*,\s*/g, ','));
  const all = await z.rpc('hostgroup.get', { output: ['groupid', 'name'] });
  const want = String(cfg.hostGroups || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const groups = want.length ? all.filter((g) => want.includes(g.name.toLowerCase())) : all;
  if (want.length && !groups.length) {
    const sug = all.filter((g) => want.some((w) => g.name.toLowerCase().includes(w.split('/')[0]))).slice(0, 8).map((g) => g.name);
    throw new Error(`Host group(s) "${cfg.hostGroups}" não encontrado(s).${sug.length ? ' Parecidos: ' + sug.join(', ') : ''}`);
  }
  const hosts = (await z.rpc('host.get', { groupids: groups.map((g) => g.groupid), output: ['hostid', 'host', 'name', 'status'], selectInterfaces: ['ip'] })).filter((h) => String(h.status) === '0');
  return { groups, hosts, names };
}

async function test(cfg) {
  const z = client(cfg);
  const v = await z.connect();
  const { groups, hosts } = await groupsAndHosts(z, cfg);
  return { message: `Conectado ao Zabbix ${v} — ${groups.length} grupo(s), ${hosts.length} host(s) ativos` };
}

async function batched(list, size, fn) { const out = []; for (let i = 0; i < list.length; i += size) out.push(...(await fn(list.slice(i, i + size)))); return out; }
const fmtDate = (ts) => new Date(ts * 1000).toLocaleDateString('pt-BR');

/** Coleta e resume o período. opts: { from: 'AAAA-MM-DD', to: 'AAAA-MM-DD' } */
async function pull(cfg, kind, opts = {}) {
  const cpuWarn = Number(cfg.cpuWarn) || 80, memWarn = Number(cfg.memWarn) || 80, diskWarn = Number(cfg.diskWarn) || 85;
  const now = new Date();
  const from = opts.from ? new Date(opts.from + 'T00:00:00') : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = opts.to ? new Date(opts.to + 'T23:59:59') : now;
  const tf = Math.floor(from / 1000), tt = Math.floor(to / 1000);
  const periodLabel = `${fmtDate(tf)} – ${fmtDate(tt)}`;

  // severidades escolhidas na sincronização (0 Não classificado … 5 Desastre); vazio = todas
  const sevs = (Array.isArray(opts.severities) ? opts.severities : []).map(Number).filter((n) => n >= 0 && n <= 5);
  const sevOk = (s) => !sevs.length || sevs.includes(Number(s));
  const z = client(cfg);
  await z.connect();
  const { groups, hosts } = await groupsAndHosts(z, cfg);
  const groupids = groups.map((g) => g.groupid);
  const hostIds = hosts.map((h) => h.hostid);
  const hostName = Object.fromEntries(hosts.map((h) => [h.hostid, h.name || h.host]));
  const hostIp = Object.fromEntries(hosts.map((h) => [h.hostid, (h.interfaces || [])[0]?.ip || '']));

  // 1. eventos de problema do período (paginado)
  let events = []; let fromId = null;
  for (let i = 0; i < 40; i++) {
    const p = { groupids, source: 0, object: 0, value: 1, time_from: tf, time_till: tt, output: ['eventid', 'objectid', 'name', 'severity', 'clock'], sortfield: 'eventid', sortorder: 'ASC', limit: 5000 };
    if (fromId) p.eventid_from = fromId;
    if (sevs.length) p.severities = sevs;
    const page = await z.rpc('event.get', p);
    if (!page.length) break;
    events = events.concat(page);
    if (page.length < 5000) break;
    fromId = String(Number(page[page.length - 1].eventid) + 1);
  }
  // 2. problemas ativos agora
  const active = await z.rpc('problem.get', { groupids, source: 0, object: 0, output: ['eventid', 'objectid', 'name', 'severity', 'clock', 'r_eventid'], recent: false, suppressed: false, limit: 5000 }).catch(() => []);
  // 3. triggers → host + classe
  const trig = {};
  const tids = [...new Set([...events, ...active].map((e) => e.objectid))];
  for (const t of await batched(tids, 500, (b) => z.rpc('trigger.get', { triggerids: b, output: ['triggerid', 'description', 'status'], selectHosts: ['hostid', 'name'], expandDescription: true })))
    if (t.hosts && t.hosts.length) trig[t.triggerid] = { hostid: t.hosts[0].hostid, host: t.hosts[0].name, name: t.description, cls: classify(t.description), enabled: String(t.status) !== '1' };
  events = events.filter((e) => (!trig[e.objectid] || trig[e.objectid].enabled) && sevOk(e.severity));
  for (let i = active.length - 1; i >= 0; i--) if (!sevOk(active[i].severity)) active.splice(i, 1);

  // 4. contagens
  const cnt = { all: {}, cpu: {}, mem: {}, disk: {} }; const diskFs = {};
  const bySeverity = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const days = Math.max(1, Math.round((tt - tf) / 86400));
  const perDay = Array.from({ length: days }, (_, i) => { const d = new Date((tf + i * 86400) * 1000); return { label: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`, cpu: 0, mem: 0, disk: 0, other: 0 }; });
  for (const e of events) {
    bySeverity[e.severity] = (bySeverity[e.severity] || 0) + 1;
    const info = trig[e.objectid]; const cls = info ? info.cls : classify(e.name);
    const di = Math.min(days - 1, Math.max(0, Math.floor((Number(e.clock) - tf) / 86400)));
    perDay[di][cls] = (perDay[di][cls] || 0) + 1;
    if (!info || cls === 'other') continue;
    const h = info.host;
    cnt.all[h] = (cnt.all[h] || 0) + 1; cnt[cls][h] = (cnt[cls][h] || 0) + 1;
    if (cls === 'disk') { const l = diskLabel(info.name || e.name) || 'Outro'; diskFs[h] = diskFs[h] || {}; diskFs[h][l] = (diskFs[h][l] || 0) + 1; }
  }

  // 5. CPU / memória: último valor + média/pico do período (trends)
  const pickItems = async (keys) => {
    const items = await batched(hostIds, 100, (b) => z.rpc('item.get', { hostids: b, filter: { key_: keys }, output: ['itemid', 'hostid', 'key_', 'lastvalue', 'status', 'value_type'] }));
    const best = {};
    items.filter((it) => String(it.status) === '0').forEach((it) => { if (!best[it.hostid] || (/idle/.test(best[it.hostid].key_) && !/idle/.test(it.key_))) best[it.hostid] = it; });
    return best;
  };
  const toUsed = (it, v) => (/idle|pfree|pavailable/.test(it.key_) ? Math.max(0, 100 - v) : v);
  const cpuItems = await pickItems(['system.cpu.util', 'system.cpu.utilization', 'system.cpu.util[,idle]']);
  const memItems = await pickItems(['vm.memory.utilization', 'vm.memory.util', 'vm.memory.size[pused]', 'vm.memory.size[pavailable]']);
  const trends = {};
  const allIds = [...Object.values(cpuItems), ...Object.values(memItems)].map((i) => i.itemid);
  for (const t of await batched(allIds, 100, (b) => z.rpc('trend.get', { itemids: b, time_from: tf, time_till: tt, output: ['itemid', 'value_avg', 'value_max', 'num'] }).catch(() => []))) {
    const s = trends[t.itemid] = trends[t.itemid] || { sum: 0, n: 0, peak: 0 };
    const n = Number(t.num) || 1; s.sum += Number(t.value_avg) * n; s.n += n; s.peak = Math.max(s.peak, Number(t.value_max));
  }
  const stat = (it) => {
    if (!it) return { avg: null, peak: null, cur: null };
    const t = trends[it.itemid]; const lv = parseFloat(it.lastvalue);
    const avg = t && t.n ? toUsed(it, t.sum / t.n) : null;
    return { avg: avg == null ? null : round(avg), peak: t ? round(toUsed(it, t.peak)) : null, cur: isNaN(lv) ? null : round(toUsed(it, lv)) };
  };

  // 6. disco: % usado de cada filesystem (vfs.fs.size[*,pused|pfree])
  const fsItems = await batched(hostIds, 100, (b) => z.rpc('item.get', { hostids: b, search: { key_: 'vfs.fs.size[' }, output: ['hostid', 'key_', 'lastvalue', 'status'] }));
  const fsUse = {};
  fsItems.filter((it) => String(it.status) === '0' && /,(pused|pfree)\]$/.test(it.key_)).forEach((it) => {
    const v = parseFloat(it.lastvalue); if (isNaN(v)) return;
    const used = /pfree/.test(it.key_) ? 100 - v : v;
    const fs = (it.key_.match(/vfs\.fs\.size\[([^,\]]+)/) || [])[1] || '?';
    (fsUse[it.hostid] = fsUse[it.hostid] || []).push({ fs, val: round(used) });
  });
  const diskIssues = [];
  for (const [hid, list] of Object.entries(fsUse)) for (const f of list) if (f.val >= diskWarn) diskIssues.push({ host: hostName[hid], fs: f.fs, val: f.val });
  // problemas de disco ativos sem item correspondente
  active.filter((p) => (!p.r_eventid || p.r_eventid === '0') && trig[p.objectid] && trig[p.objectid].cls === 'disk').forEach((p) => {
    const t = trig[p.objectid]; const l = diskLabel(t.name) || t.name;
    if (!diskIssues.some((d) => d.host === t.host && String(d.fs).toLowerCase() === String(l).toLowerCase())) diskIssues.push({ host: t.host, fs: l, val: null });
  });
  diskIssues.sort((a, b) => (b.val ?? 101) - (a.val ?? 101));

  // 7. tabelas por host
  const hostRows = hosts.map((h) => {
    const c = stat(cpuItems[h.hostid]); const m = stat(memItems[h.hostid]);
    const fsMax = (fsUse[h.hostid] || []).reduce((mx, f) => (f.val > (mx?.val ?? -1) ? f : mx), null);
    const n = hostName[h.hostid];
    return { hostid: h.hostid, host: n, ip: hostIp[h.hostid], cpu: c, mem: m, disk: fsMax, alerts: { cpu: cnt.cpu[n] || 0, mem: cnt.mem[n] || 0, disk: cnt.disk[n] || 0 }, total: cnt.all[n] || 0 };
  });
  const capRows = (key) => hostRows.filter((r) => r[key].avg != null || r[key].cur != null)
    .map((r) => ({ host: r.host, avg: r[key].avg, peak: r[key].peak, cur: r[key].cur, count: r.alerts[key] }))
    .sort((a, b) => (b.avg ?? b.cur ?? 0) - (a.avg ?? a.cur ?? 0)).slice(0, 10);
  const top5 = hostRows.filter((r) => r.total > 0).sort((a, b) => b.total - a.total).slice(0, 5).map((r) => ({
    host: r.host, cpuAvg: r.cpu.avg, memAvg: r.mem.avg, diskVal: r.disk ? r.disk.val : null, alerts: r.alerts,
    diskBreakdown: Object.entries(diskFs[r.host] || {}).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
  }));
  const topCpu = capRows('cpu'), topMem = capRows('mem');

  // 8. recomendações (CPU / memória / disco)
  const ACAO = {
    cpu: 'Avaliar upgrade de vCPU ou revisar processos/serviços consumindo mais CPU no host.',
    mem: 'Avaliar aumento de memória (RAM) ou revisar processos com uso elevado.',
    disk: 'Expandir capacidade de disco, arquivar ou limpar dados antigos, ou revisar o limite configurado no trigger.'
  };
  const prio = (val, count) => ((count >= 100 || (val != null && val >= 90)) ? 'Alta' : (count >= 20 || (val != null && val >= 75)) ? 'Média' : 'Baixa');
  const recs = []; const seen = new Set();
  const rec = (host, key, label, val, count, extra = '') => {
    const k = host + '|' + key + '|' + extra; if (seen.has(k)) return; seen.add(k);
    recs.push({ 'Servidor': host, 'Recurso': label, 'Situação': `${val != null ? val.toFixed(1) + '% ' + (key === 'disk' ? 'usado' : 'médio') + ' · ' : ''}${count} alerta${count !== 1 ? 's' : ''} no período${extra ? ' (' + extra + ')' : ''}`, 'Ação sugerida': ACAO[key], 'Prioridade': prio(val, count) });
  };
  hostRows.forEach((r) => {
    if ((r.cpu.avg ?? 0) >= cpuWarn || r.alerts.cpu > 0 && top5.some((t) => t.host === r.host)) rec(r.host, 'cpu', 'CPU', r.cpu.avg ?? r.cpu.cur, r.alerts.cpu);
    if ((r.mem.avg ?? 0) >= memWarn || r.alerts.mem > 0 && top5.some((t) => t.host === r.host)) rec(r.host, 'mem', 'Memória', r.mem.avg ?? r.mem.cur, r.alerts.mem);
  });
  diskIssues.forEach((d) => rec(d.host, 'disk', 'Disco', d.val, cnt.disk[d.host] || 0, d.fs));
  const order = { Alta: 0, 'Média': 1, Baixa: 2 };
  recs.sort((a, b) => order[a.Prioridade] - order[b.Prioridade]);

  // 9. resumo executivo
  let summary = '';
  const memCrit = topMem.filter((r) => (r.avg ?? 0) >= memWarn);
  const memWarnL = topMem.filter((r) => (r.avg ?? 0) >= 60);
  if (memCrit.length) summary += `Memória: ${memCrit.length} host(s) com média acima de ${memWarn}% — ${memCrit.slice(0, 3).map((r) => `${r.host} (${r.avg.toFixed(1)}%)`).join(', ')}. `;
  else if (memWarnL.length) summary += `Memória: ${memWarnL.length} host(s) em zona de atenção (média ≥60%) — ${memWarnL.slice(0, 3).map((r) => `${r.host} (${r.avg.toFixed(1)}%)`).join(', ')}. `;
  const cpuCrit = topCpu.filter((r) => (r.avg ?? 0) >= cpuWarn);
  const cpuW = topCpu.filter((r) => (r.avg ?? 0) >= 60 && (r.avg ?? 0) < cpuWarn);
  if (cpuCrit.length) summary += `CPU: ${cpuCrit.length} host(s) com média acima de ${cpuWarn}% — ${cpuCrit.slice(0, 3).map((r) => `${r.host} (${r.avg.toFixed(1)}%)`).join(', ')}. `;
  else if (cpuW.length) summary += `CPU: ${cpuW.length} host(s) em zona de atenção (60–${cpuWarn}%): ${cpuW.slice(0, 3).map((r) => r.host).join(', ')}. `;
  else summary += 'CPU: média do período dentro dos limites normais. ';
  if (diskIssues.length) summary += `Disco: ${diskIssues.length} filesystem(s)/alerta(s) ativo(s) — ${diskIssues.slice(0, 3).map((d) => (d.val != null ? `${d.host} ${d.fs} (${d.val.toFixed(1)}%)` : `${d.host}: ${d.fs}`)).join(', ')}. Limpeza ou expansão recomendada. `;
  else summary += 'Disco: nenhum filesystem acima do limite no período. ';

  const z_ = {
    group: groups.map((g) => g.name).join(', '), periodLabel, from: opts.from, to: opts.to, days,
    totalHosts: hosts.length, totalAlerts: events.length, bySeverity, severities: sevs,
    activeProblems: active.filter((p) => !p.r_eventid || p.r_eventid === '0').length,
    cpuHigh: hostRows.filter((r) => (r.cpu.cur ?? 0) >= cpuWarn).length,
    diskIssues: diskIssues.slice(0, 25), top5, topCpu, topMem, perDay, summary: summary.trim(),
    fetchedAt: new Date().toLocaleString('pt-BR')
  };
  const pctTxt = (v) => (v == null ? '—' : v.toFixed(1) + '%');
  const status = (r) => (((r.cpu.avg ?? 0) >= 90 || (r.mem.avg ?? 0) >= 90 || (r.disk?.val ?? 0) >= 90) ? 'Crítico' : ((r.cpu.avg ?? 0) >= cpuWarn || (r.mem.avg ?? 0) >= memWarn || (r.disk?.val ?? 0) >= diskWarn) ? 'Atenção' : 'Normal');
  return [{
    kind: 'capacity', name: 'Zabbix', summary: z_,
    sheets: {
      recommendations: U.sheet('raw', 'Recomendações (Zabbix)', recs),
      hosts: U.sheet('raw', 'Hosts monitorados (Zabbix)', hostRows.filter((r) => !opts.onlyWithAlerts || r.total > 0).sort((a, b) => b.total - a.total).map((r) => ({
        'Host': r.host, 'IP': r.ip, 'CPU média': pctTxt(r.cpu.avg), 'Memória média': pctTxt(r.mem.avg), 'Maior disco': r.disk ? `${r.disk.fs} ${pctTxt(r.disk.val)}` : '—', 'Alertas': String(r.total), 'Status': status(r)
      })))
    }
  }];
}
const round = (v) => Math.round(v * 10) / 10;

module.exports = { label: 'Zabbix', test, pull, classify, diskLabel };
