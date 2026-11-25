/* ═══ Conexões (clouds + Zabbix + GLPI) e sincronização via API (requer npm run dev) ═══
 * - Conexões por cliente, guardadas SÓ no servidor (data/connections/<cliente>.json);
 *   o navegador recebe os segredos mascarados.
 * - "Importar chaves": lê arquivos de credencial (~/.oci/config, .pem, CSV de access key da AWS,
 *   ~/.aws/credentials, JSON de conta de serviço GCP, JSON do service principal Azure, JSON com
 *   várias conexões) e preenche os formulários.
 * - Sincronizar: o servidor consulta as clouds (inventário), o Zabbix (capacidade, monitoramento,
 *   recomendações de CPU/RAM/disco) e o GLPI (chamados) e a tela de revisão mostra o destino
 *   de cada item no book antes de aplicar.
 */
(function (BT) {
  const h = BT.h;
  const P = () => BT.data.providers;
  const KINDS = [['servers', '🖥️ Servidores', 'servidores'], ['storage', '💾 Storage', 'storage'], ['network', '🌐 Redes', 'networking'], ['baseline', '📦 Baseline', 'baseline'], ['tenant', '🏷️ Geral (tenant)', 'geral'], ['score', '🛡️ Security Score', 'score']];
  const ORDER = ['oci', 'aws', 'azure', 'gcp', 'zabbix', 'glpi'];

  const FORMS = {
    oci: {
      help: 'Use o arquivo <code>~/.oci/config</code> do servidor (recomendado) <b>ou</b> preencha os dados da API key. Permissão mínima: <code>inspect all-resources</code> + <code>read instances, volumes, virtual-network-family, buckets</code>.',
      fields: [['configFile', 'Arquivo de config (no servidor)', '~/.oci/config'], ['profile', 'Profile', 'DEFAULT'], ['tenancy', 'Tenancy OCID', 'ocid1.tenancy.oc1..'], ['user', 'User OCID', 'ocid1.user.oc1..'], ['fingerprint', 'Fingerprint', 'aa:bb:cc:…'],
        ['region', 'Região principal', 'sa-saopaulo-1'], ['regions', 'Regiões (separadas por vírgula)', 'sa-saopaulo-1, sa-vinhedo-1'], ['keyFile', 'Chave privada — caminho no servidor', '~/.oci/oci_api_key.pem'], ['keyPem', 'ou cole a chave privada (PEM)', '-----BEGIN PRIVATE KEY-----', 'area'], ['passphrase', 'Passphrase da chave (se houver)', '', 'secret'], ['compartmentId', 'Compartimento raiz (opcional)', 'ocid1.compartment.oc1..']]
    },
    aws: {
      help: 'Use um <b>profile</b> de <code>~/.aws/credentials</code> do servidor ou uma Access Key de um usuário/role somente leitura (<code>ReadOnlyAccess</code>).',
      fields: [['profile', 'Profile (no servidor)', 'default'], ['accessKeyId', 'Access Key ID', 'AKIA…'], ['secretAccessKey', 'Secret Access Key', '', 'secret'], ['sessionToken', 'Session token (opcional)', '', 'secret'], ['regions', 'Regiões (separadas por vírgula)', 'sa-east-1, us-east-1']]
    },
    azure: {
      help: 'Crie um <b>App Registration</b> (service principal) com a role <code>Reader</code> nas assinaturas. O JSON do <code>az ad sp create-for-rbac</code> pode ser importado direto.',
      fields: [['tenantId', 'Tenant ID', ''], ['clientId', 'Client (application) ID', ''], ['clientSecret', 'Client secret', '', 'secret'], ['subscriptionIds', 'Subscription IDs (vazio = todas visíveis)', '']]
    },
    gcp: {
      help: 'Use uma <b>conta de serviço</b> com <code>roles/viewer</code>: importe o JSON da chave ou informe o caminho do arquivo no servidor.',
      fields: [['projectIds', 'Project IDs (separados por vírgula)', 'meu-projeto'], ['keyFile', 'JSON da conta de serviço — caminho no servidor', '~/gcp-sa.json'], ['serviceAccountJson', 'ou cole o JSON da conta de serviço', '{ "type": "service_account", … }', 'area']]
    },
    zabbix: {
      help: 'Preenche <b>Capacidade</b> (relatório com resumo executivo, top hosts CPU/memória/disco e gráficos), <b>Monitoramento</b> (hosts) e <b>Servidores — Recomendações</b> (onde aumentar RAM, CPU ou disco). Use um <b>API token</b> (Usuários › Tokens de API) com acesso de leitura aos host groups.',
      fields: [['url', 'URL do Zabbix', 'https://zabbix.empresa.com'], ['hostGroups', 'Host groups (separados por vírgula)', 'BRITECH, BRITECH/SQL'], ['apiToken', 'API token', '', 'secret'], ['user', 'ou usuário', ''], ['password', 'senha', '', 'secret'],
        ['cpuWarn', 'Limite CPU (%) para recomendar', '80'], ['memWarn', 'Limite memória (%)', '80'], ['diskWarn', 'Limite disco (%)', '85'], ['insecure', 'Aceitar certificado autoassinado', '', 'check']]
    },
    glpi: {
      help: 'Preenche <b>Incidentes</b> com os chamados do período (indicadores, gráficos por status/categoria e a planilha). Habilite a API REST em <i>Configurar › Geral › API</i>; o token pessoal fica em <i>Preferências › Chaves de acesso remoto</i>.',
      fields: [['url', 'URL do GLPI', 'https://glpi.empresa.com'], ['appToken', 'App-Token (cliente da API)', '', 'secret'], ['userToken', 'Token de usuário (API token)', '', 'secret'], ['user', 'ou usuário', ''], ['password', 'senha', '', 'secret'],
        ['entity', 'Entidade (filtra pelo nome, opcional)', 'BRITech'], ['insecure', 'Aceitar certificado autoassinado', '', 'check']]
    }
  };

  // várias contas por provedor: "aws" é a primeira, "aws~xyz" as demais (ex.: PRD e HML)
  const typeOf = (k) => String(k).split('~')[0];
  const accountsOf = (providers, p) => Object.keys(providers).filter((k) => k === p || k.startsWith(p + '~')).sort((a, b) => (a === p ? -1 : b === p ? 1 : 0));
  const accName = (providers, k) => {
    const cfg = providers[k] || {};
    if (cfg.name) return cfg.name;
    const list = accountsOf(providers, typeOf(k));
    return list.length > 1 ? 'Conta ' + (list.indexOf(k) + 1) : 'Principal';
  };
  const isOn = (cfg) => cfg && cfg.enabled !== false && Object.keys(cfg).filter((k) => k !== 'enabled' && k !== 'name' && k !== '_from' && cfg[k] !== '' && cfg[k] !== false).length > 0;

  // ── Importar arquivos de chave / credencial ─────────────────
  function parseKeyFile(name, text) {
    const out = {}; const t = text.replace(/^﻿/, '').trim();
    try {
      const j = JSON.parse(t);
      if (j.providers && typeof j.providers === 'object') return j.providers; // JSON com várias conexões
      if (j.type === 'service_account') out.gcp = { serviceAccountJson: t, projectIds: j.project_id || '' };
      else if (j.appId && j.password && j.tenant) out.azure = { clientId: j.appId, clientSecret: j.password, tenantId: j.tenant };
      else if (j.clientId && (j.clientSecret || j.secret) && (j.tenantId || j.tenant)) out.azure = { clientId: j.clientId, clientSecret: j.clientSecret || j.secret, tenantId: j.tenantId || j.tenant, subscriptionIds: j.subscriptionId || '' };
      else if (j.zabbix || /zabbix/i.test(j.url || '')) out.zabbix = Object.assign({ url: j.url, apiToken: j.apiToken || j.token }, j.zabbix || {});
      else if (j.glpi || j.app_token || j.appToken && j.userToken) out.glpi = Object.assign({ url: j.url, appToken: j.app_token || j.appToken, userToken: j.user_token || j.userToken }, j.glpi || {});
      else if (j.AccessKeyId || j.accessKeyId) out.aws = { accessKeyId: j.AccessKeyId || j.accessKeyId, secretAccessKey: j.SecretAccessKey || j.secretAccessKey, sessionToken: j.SessionToken || j.sessionToken || '' };
      return out;
    } catch (e) { /* não é JSON */ }
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(t)) { out.oci = { keyPem: t }; return out; }
    const lines = t.split(/\r?\n/);
    if (/access key id/i.test(lines[0] || '')) {
      const head = BT.core.utils.parseCSV(lines[0])[0].map((x) => x.toLowerCase().trim());
      const row = BT.core.utils.parseCSV(lines.slice(1).join('\n'))[0] || [];
      out.aws = { accessKeyId: row[head.findIndex((x) => x.includes('access key id'))] || '', secretAccessKey: row[head.findIndex((x) => x.includes('secret'))] || '' };
      return out;
    }
    // INI (~/.aws/credentials ou ~/.oci/config): usa o primeiro profile
    const ini = {}; let sec = null;
    lines.forEach((l) => { l = l.trim(); const m = l.match(/^\[(.+)\]$/); if (m) { sec = ini[m[1]] = {}; return; } const kv = l.match(/^([^=#;]+?)\s*=\s*(.*)$/); if (kv && sec) sec[kv[1].trim()] = kv[2].trim(); });
    const first = Object.values(ini)[0] || {};
    if (first.aws_access_key_id) out.aws = { accessKeyId: first.aws_access_key_id, secretAccessKey: first.aws_secret_access_key || '', sessionToken: first.aws_session_token || '', regions: first.region || '' };
    if (first.tenancy && first.fingerprint) out.oci = { tenancy: first.tenancy, user: first.user, fingerprint: first.fingerprint, region: first.region, keyFile: first.key_file || '', configFile: '' };
    return out;
  }

  async function connections(clienteSlug, nome, startTab) {
    if (BT.api.mode !== 'server') return BT.ui.toast('Conexões exigem o servidor: rode "npm run dev".', { type: 'err', ms: 6000 });
    const data = await BT.api.getConnections(clienteSlug);
    data.nome = data.nome || nome; data.providers = data.providers || {};
    let cur = typeOf(startTab || 'oci');
    let curKey = cur; // conta aberta dentro da aba
    const tabs = h('div', { class: 'cx-tabs' });
    const form = h('div');
    const result = h('div');
    const drawTabs = () => {
      tabs.innerHTML = '';
      ORDER.forEach((p, i) => {
        if (i === 4) tabs.appendChild(h('span', { class: 'cx-sep' }));
        tabs.appendChild(h('button', { class: p === cur ? 'on' : '', onclick: () => { cur = p; curKey = p; drawTabs(); drawForm(); } }, [P()[p].icon + ' ' + P()[p].label + (accountsOf(data.providers, p).length > 1 ? ` (${accountsOf(data.providers, p).length})` : ''), h('span', { class: 'dot' + (accountsOf(data.providers, p).some((k) => isOn(data.providers[k])) ? ' ok' : '') })]));
      });
    };
    const drawForm = () => {
      if (!data.providers[curKey]) curKey = cur;
      const cfg = data.providers[curKey] = data.providers[curKey] || { enabled: false };
      result.innerHTML = ''; form.innerHTML = '';
      // contas deste provedor: escolher, adicionar, renomear, remover
      const keys = accountsOf(data.providers, cur);
      const addAccount = () => {
        const k = cur + '~' + Math.random().toString(36).slice(2, 8);
        data.providers[k] = { enabled: true, name: 'Conta ' + (keys.length + 1) };
        curKey = k; drawTabs(); drawForm();
      };
      const removeAccount = async () => {
        const name = accName(data.providers, curKey);
        if (!(await BT.ui.modal.confirm(`Remover a conta "${name}" de ${P()[cur].label}? As credenciais dela são apagadas ao salvar.`, { okText: 'Remover', danger: true, title: 'Remover conta' }))) return;
        const rest = keys.filter((k) => k !== curKey);
        if (curKey === cur && rest.length) {
          // a primeira conta saiu: a próxima assume a chave principal e leva os segredos junto
          const next = rest[0];
          data.providers[cur] = Object.assign({}, data.providers[next], { _from: data.providers[next]._from || next });
          delete data.providers[next];
        } else if (curKey === cur) data.providers[cur] = { enabled: false };
        else delete data.providers[curKey];
        curKey = cur; drawTabs(); drawForm();
      };
      const onLabel = () => `Ativar ${P()[cur].label}${keys.length > 1 ? ' · ' + accName(data.providers, curKey) : ''} para este cliente`;
      form.appendChild(h('div', { class: 'cx-accounts' }, [
        h('span', { class: 'lbl' }, 'Contas'),
        ...keys.map((k) => h('button', { class: 'btn btn-xs ' + (k === curKey ? 'btn-primary' : 'btn-sec'), onclick: () => { curKey = k; drawForm(); } }, [h('span', { class: 'dot' + (isOn(data.providers[k]) ? ' ok' : '') }), h('span', { class: 'acc-name' }, accName(data.providers, k))])),
        h('button', { class: 'btn btn-ghost btn-xs', title: 'Adicionar outra conta deste provedor (ex.: PRD e HML)', onclick: addAccount }, '＋ Adicionar conta')
      ]));
      form.appendChild(h('div', { class: 'cx-account-row' }, [
        h('div', { class: 'fd' }, [h('label', {}, 'Nome da conta (aparece no book)'), h('input', { class: 'inp', value: cfg.name || '', placeholder: 'ex.: PRD, HML', oninput: (e) => { cfg.name = e.target.value.trim(); const b = form.querySelector('.cx-accounts .btn-primary .acc-name'); if (b) b.textContent = accName(data.providers, curKey); const t = form.querySelector('.acc-on'); if (t) t.textContent = onLabel(); } })]),
        h('button', { class: 'btn btn-ghost btn-xs btn-del', title: 'Remover esta conta', onclick: removeAccount }, '🗑 Remover conta')
      ]));
      const on = h('input', { type: 'checkbox', checked: isOn(cfg), onchange: (e) => { cfg.enabled = e.target.checked; drawTabs(); } });
      const touch = () => { if (cfg.enabled === false || !on.checked) { cfg.enabled = true; on.checked = true; drawTabs(); } };
      form.append(
        h('div', { class: 'cx-help', html: FORMS[cur].help }),
        h('label', { class: 'switch', style: { marginBottom: '12px' } }, [on, h('span', { class: 'acc-on' }, onLabel())]),
        h('div', { class: 'fg fg2' }, FORMS[cur].fields.map(([k, label, ph, type]) => {
          if (type === 'check') return h('label', { class: 'switch span-all' }, [h('input', { type: 'checkbox', checked: !!cfg[k], onchange: (e) => { cfg[k] = e.target.checked; touch(); } }), label]);
          return h('div', { class: 'fd' + (type === 'area' ? ' span-all' : '') }, [
            h('label', {}, label),
            type === 'area' ? h('textarea', { class: 'inp', placeholder: ph, oninput: (e) => { cfg[k] = e.target.value; touch(); } }, cfg[k] || '')
              : h('input', { class: 'inp', type: type === 'secret' ? 'password' : 'text', value: cfg[k] || '', placeholder: ph, autocomplete: 'off', oninput: (e) => { cfg[k] = e.target.value; touch(); } })
          ]);
        }))
      );
    };
    const fileIn = h('input', { type: 'file', multiple: true, hidden: true, accept: '.json,.csv,.pem,.txt,.ini,.config,*', onchange: async (e) => {
      const got = [];
      for (const f of e.target.files) {
        try {
          const parsed = parseKeyFile(f.name, await BT.core.utils.readAsText(f));
          Object.entries(parsed).forEach(([p, cfg]) => { if (!FORMS[typeOf(p)]) return; const k = p.includes('~') ? p : (p === cur ? curKey : p); data.providers[k] = Object.assign({}, data.providers[k] || {}, cfg, { enabled: true }); got.push(P()[typeOf(p)].label); });
        } catch (err) { console.warn(err); }
      }
      e.target.value = '';
      if (!got.length) return BT.ui.toast('Nenhuma credencial reconhecida nos arquivos.', { type: 'err' });
      const nc = ORDER.find((p) => got.includes(P()[p].label)) || cur; if (nc !== cur) { cur = nc; curKey = nc; }
      drawTabs(); drawForm();
      BT.ui.toast(`Chaves importadas: ${[...new Set(got)].join(', ')} — confira e clique em Salvar.`, { type: 'ok', ms: 6000 });
    } });
    const save = async () => { await BT.api.saveConnections(clienteSlug, data); drawTabs(); };
    const test = async () => {
      result.innerHTML = '<div class="cx-result">Testando…</div>';
      try { await save(); const r = await BT.api.cloudTest(clienteSlug, curKey); result.innerHTML = ''; result.appendChild(h('div', { class: 'cx-result ' + (r.ok ? 'ok' : 'err') }, (r.ok ? '✓ ' : '✕ ') + r.message)); }
      catch (e) { result.innerHTML = ''; result.appendChild(h('div', { class: 'cx-result err' }, '✕ ' + e.message)); }
    };
    drawTabs(); drawForm();
    const m = BT.ui.modal.open({
      title: `🔑 Conexões — ${data.nome}`, size: 'md',
      body: [tabs, h('div', { class: 'cx-import' }, [
        h('button', { class: 'btn btn-sec btn-xs', onclick: () => fileIn.click() }, '📥 Importar chaves (arquivos)'),
        h('span', { class: 'cx-help', style: { margin: 0 } }, '~/.oci/config, .pem, CSV de access key da AWS, ~/.aws/credentials, JSON da conta de serviço GCP, JSON do service principal Azure'), fileIn]),
        form, result,
        h('div', { class: 'cx-help', style: { marginTop: '12px' } }, '🔒 As credenciais ficam apenas no servidor (pasta data/connections). O navegador recebe os segredos mascarados.')],
      footer: [h('button', { class: 'btn btn-ghost btn-sm', onclick: test }, '⚡ Testar conexão'), h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => m.close() }, 'Fechar'),
        h('button', { class: 'btn btn-primary btn-sm', onclick: async () => { await save(); m.close(); BT.ui.toast('Conexões salvas ✓', { type: 'ok' }); } }, 'Salvar')]
    });
  }

  // ── Itens de revisão a partir das ferramentas ───────────────
  const pct = (v) => (v == null ? '' : v);
  function toolItems(p, res) {
    const items = [];
    const base = { api: true, include: true, provider: p, dest: '', newTitle: '', how: 'new', note: '', groupHint: 'opera' };
    const dataItem = (sheet, destTitle, newTitleHint, label) => Object.assign({}, base, {
      id: BT.uid('zi'), kind: 'data', path: `${P()[p].label} · ${label}`, tokens: [], entry: { name: label, path: '' }, destTitle, newTitleHint, forceMapper: 'raw', periodLabel: res.summary.periodLabel,
      parsed: { name: sheet.name, sheets: [{ name: sheet.name, fields: sheet.fields, rows: sheet.rows, aoa: [] }] }
    });
    const chart = (title, kind, labels, series, extra = {}) => ({ type: 'chart', data: Object.assign({ title, kind, source: 'manual', labels, series, table: {}, showValues: true, legend: true, height: 240, unit: '' }, extra) });
    if (p === 'zabbix') {
      const z = res.summary;
      const SEV = ['Não class.', 'Info', 'Warning', 'Average', 'High', 'Disaster'];
      const sevIdx = [5, 4, 3, 2, 1, 0].filter((i) => z.bySeverity[i]);
      items.push(Object.assign({}, base, {
        id: BT.uid('zi'), kind: 'blocks', path: 'Zabbix · Relatório de capacidade + gráficos', destTitle: 'Capacidade', origin: 'zabbix-capacity', entry: { name: 'Capacidade' },
        blocks: [
          { type: 'monitor', data: { title: '', z, resumo: '', show: {} } },
          chart(`Alertas por dia (${z.periodLabel})`, 'line', z.perDay.map((d) => d.label), [{ name: 'CPU', values: z.perDay.map((d) => d.cpu) }, { name: 'Memória', values: z.perDay.map((d) => d.mem) }, { name: 'Disco', values: z.perDay.map((d) => d.disk) }]),
          chart('Alertas por severidade', 'donut', sevIdx.map((i) => SEV[i]), [{ name: 'Alertas', values: sevIdx.map((i) => z.bySeverity[i]) }], { height: 220 })
        ]
      }));
      items.push(dataItem(res.sheets.hosts, 'Monitoramento', 'Monitoramento', 'Hosts monitorados'));
      items.push(dataItem(res.sheets.recommendations, 'Recomendações', 'Servidores — Recomendações', 'Recomendações de CPU / memória / disco'));
    }
    if (p === 'glpi') {
      const g = res.summary;
      const ent = (o) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]);
      items.push(Object.assign({}, base, {
        id: BT.uid('zi'), kind: 'blocks', path: 'GLPI · Indicadores e gráficos de chamados', destTitle: 'Incidentes', origin: 'glpi-tickets', entry: { name: 'Incidentes' },
        blocks: [
          { type: 'kpi', data: { title: `Chamados (${g.periodLabel})`, items: [{ label: 'Chamados', value: String(g.total) }, { label: 'Incidentes', value: String(g.incidentes) }, { label: 'Requisições', value: String(g.requisicoes) }, { label: 'Resolvidos', value: String(g.resolvidos) }, { label: 'Em aberto', value: String(g.abertos) }, { label: 'Backlog anterior', value: String(g.backlog) }, ...(g.mttrHoras != null ? [{ label: 'Tempo médio (h)', value: String(g.mttrHoras) }] : [])] } },
          chart('Chamados por status', 'donut', ent(g.byStatus).map((e) => e[0]), [{ name: 'Chamados', values: ent(g.byStatus).map((e) => e[1]) }], { height: 220 }),
          chart('Chamados por categoria', 'bar', ent(g.byCategory).slice(0, 10).map((e) => e[0]), [{ name: 'Chamados', values: ent(g.byCategory).slice(0, 10).map((e) => e[1]) }]),
          chart('Abertos × resolvidos por dia', 'line', g.perDay.map((d) => d.label), [{ name: 'Abertos', values: g.perDay.map((d) => d.abertos) }, { name: 'Resolvidos', values: g.perDay.map((d) => d.resolvidos) }])
        ]
      }));
      items.push(dataItem(res.sheets.tickets, 'Incidentes', 'Incidentes', 'Chamados do período'));
    }
    return items;
  }

  /** Puxa dados das conexões configuradas e abre a revisão (mesma do ZIP). */
  async function sync(opts = {}) {
    if (BT.api.mode !== 'server') return BT.ui.toast('Sincronizar exige o servidor: rode "npm run dev".', { type: 'err', ms: 6000 });
    const id = BT.store.sessionId; if (!id) return BT.ui.toast('Abra um book primeiro.');
    const key = BT.api.keyOf(id);
    const conns = await BT.api.getConnections(key.cliente);
    const provs = conns.providers || {};
    const configured = ORDER.flatMap((p) => accountsOf(provs, p)).filter((k) => isOn(provs[k]));
    const multiOf = (p) => configured.filter((k) => typeOf(k) === p).length > 1;
    const labelOf = (k) => P()[typeOf(k)].label + (multiOf(typeOf(k)) ? ' · ' + accName(provs, k) : '');
    if (!configured.length) {
      BT.ui.toast('Nenhuma conexão configurada para este cliente.', { type: 'err' });
      return connections(key.cliente, BT.store.state.meta.cliente);
    }
    const selP = new Set(opts.providers && opts.providers.length ? configured.filter((k) => opts.providers.includes(k) || opts.providers.includes(typeOf(k))) : configured);
    const byTpl = { network: ['network'], backup: ['storage'] };
    const selK = new Set(opts.kinds || byTpl[BT.store.state.template] || ['servers', 'storage', 'network', 'baseline', 'tenant', 'score']);
    // período padrão = mês do book
    const y = Number(key.ano), mo = Number(key.mes);
    const pad = (n) => String(n).padStart(2, '0');
    const per = { from: `${y}-${pad(mo)}-01`, to: `${y}-${pad(mo)}-${pad(new Date(y, mo, 0).getDate())}` };
    const status = h('div', { class: 'cx-help' });
    const chk = (set, v, label, cb) => h('label', { class: 'cp' }, [h('input', { type: 'checkbox', checked: set.has(v), onchange: (e) => { e.target.checked ? set.add(v) : set.delete(v); cb && cb(); } }), label]);
    const kindsBox = h('div'); const periodBox = h('div'); const zbxBox = h('div');
    // Zabbix: severidades a importar e se entram os servidores sem nenhum alerta no período
    const ZSEV = [['5', '🟥 Desastre'], ['4', '🟧 Alta'], ['3', '🟨 Média'], ['2', '🟦 Atenção'], ['1', 'ℹ️ Informação'], ['0', '⬜ Não classificado']];
    const zbxSev = new Set(ZSEV.map((x) => x[0]));
    const zbxAll = h('input', { type: 'checkbox', checked: true });
    zbxBox.append(h('div', { class: 'lbl', style: { margin: '16px 0 8px' } }, 'Zabbix — severidades dos alertas'), h('div', { class: 'cprow' }, ZSEV.map(([v, l]) => chk(zbxSev, v, l))),
      h('label', { class: 'switch', style: { marginTop: '10px' } }, [zbxAll, 'Incluir servidores sem nenhum alerta no período (Monitoramento)']));
    const refresh = () => {
      kindsBox.hidden = ![...selP].some((k) => !P()[typeOf(k)].tool);
      periodBox.hidden = ![...selP].some((k) => P()[typeOf(k)].tool);
      zbxBox.hidden = ![...selP].some((k) => typeOf(k) === 'zabbix');
    };
    const go = async () => {
      if (!zbxBox.hidden && !zbxSev.size) return BT.ui.toast('Escolha ao menos uma severidade do Zabbix.', { type: 'err' });
      btn.disabled = true;
      const items = []; const errors = [];
      for (const k of configured.filter((x) => selP.has(x))) {
        const p = typeOf(k); const label = labelOf(k);
        const account = multiOf(p) ? accName(provs, k) : '';
        status.textContent = `Consultando ${P()[p].display}${account ? ' · ' + account : ''}…`;
        try {
          const extra = p === 'zabbix' ? Object.assign({}, per, { severities: [...zbxSev].map(Number), onlyWithAlerts: !zbxAll.checked }) : per;
          const r = await BT.api.cloudPull(key.cliente, k, [...selK], extra);
          r.errors.forEach((e) => errors.push(`${label}${e.kind !== p ? '/' + e.kind : ''}: ${e.message}`));
          if (P()[p].tool) r.results.forEach((res) => items.push(...toolItems(p, res).map((it) => (account ? Object.assign(it, { path: it.path.replace(P()[p].label, label) }) : it))));
          else {
            // score + recomendações + alertas da mesma conta viram UM bloco Cloud Security Score
            const scoreSheets = r.results.filter((sh) => /^score/.test(sh.kind));
            if (scoreSheets.length) {
              const data = BT.blocks.scoreFromSheets(p, scoreSheets, label);
              items.push({ id: BT.uid('zi'), api: true, kind: 'blocks', include: true, provider: p, account, path: `${label} · Cloud Security Score`, destTitle: 'Segurança', origin: 'score-' + k, replaceEmptyType: 'score', entry: { name: 'Security Score' },
                blocks: [{ type: 'score', data }], dest: '', newTitle: '', how: 'new', note: '' });
            }
          }
          if (!P()[p].tool) r.results.filter((sh) => !/^score/.test(sh.kind)).forEach((sh) => {
            if (sh.kind === 'tenant') {
              // Geral › Tenant da própria cloud/conta (primeira seção do menu)
              items.push({ id: BT.uid('zi'), api: true, kind: 'data', include: true, provider: p, account, path: `${label} · ${sh.name}`, tokens: [p, 'geral'], entry: { name: 'Geral', path: '' },
                destTitle: 'Geral', newTitleHint: 'Geral', forceMapper: 'raw', first: true,
                parsed: { name: sh.name, sheets: [{ name: sh.name, fields: sh.fields, rows: sh.rows, aoa: [] }] }, dest: '', newTitle: '', how: 'new', note: '' });
              return;
            }
            const kind = KINDS.find((x) => x[0] === sh.kind);
            items.push({ id: BT.uid('zi'), api: true, kind: 'data', include: true, provider: p, account, path: `${label} · ${sh.name}`, tokens: [p, kind[2]], entry: { name: kind[1].replace(/^\S+\s/, ''), path: '' },
              parsed: { name: sh.name, sheets: [{ name: sh.name, fields: sh.fields, rows: sh.rows, aoa: [] }] }, dest: '', newTitle: '', how: 'new', note: '' });
          });
        } catch (e) { errors.push(`${label}: ${e.message}`); }
      }
      m.close();
      if (errors.length) BT.ui.toast('Alguns itens falharam: ' + errors.join(' | '), { type: 'err', ms: 14000 });
      if (!items.length) return;
      BT.importer.zip.review(items, null, null, '🔄 Sincronizar — revisar e escolher itens');
    };
    const btn = h('button', { class: 'btn btn-primary btn-sm', onclick: go }, '🔄 Buscar dados');
    kindsBox.append(h('div', { class: 'lbl', style: { margin: '16px 0 8px' } }, 'O que buscar nas clouds'), h('div', { class: 'cprow' }, KINDS.map(([k, l]) => chk(selK, k, l))));
    periodBox.append(h('div', { class: 'lbl', style: { margin: '16px 0 8px' } }, 'Período (Zabbix / GLPI)'), h('div', { class: 'fg fg2', style: { maxWidth: '360px' } }, [
      h('div', { class: 'fd' }, [h('label', {}, 'De'), h('input', { type: 'date', value: per.from, onchange: (e) => (per.from = e.target.value) })]),
      h('div', { class: 'fd' }, [h('label', {}, 'Até'), h('input', { type: 'date', value: per.to, onchange: (e) => (per.to = e.target.value) })])]));
    refresh();
    const m = BT.ui.modal.open({
      title: '🔄 Sincronizar dados', size: 'md',
      body: [h('div', { class: 'lbl', style: { marginBottom: '8px' } }, 'Fontes configuradas'),
        h('div', { class: 'cprow' }, configured.map((k) => chk(selP, k, P()[typeOf(k)].icon + ' ' + labelOf(k), refresh))),
        kindsBox, periodBox, zbxBox,
        h('div', { style: { marginTop: '14px' } }, status),
        h('div', { class: 'cx-help' }, 'Na próxima tela você confere o destino de cada item no book e escolhe as linhas antes de aplicar.')],
      footer: [h('button', { class: 'btn btn-ghost btn-sm', onclick: () => connections(key.cliente, BT.store.state.meta.cliente) }, '🔑 Conexões'), h('span', { class: 'spacer' }), h('button', { class: 'btn btn-ghost btn-sm', onclick: () => m.close() }, 'Cancelar'), btn]
    });
  }

  BT.importer.cloud = { connections, sync, parseKeyFile, toolItems };
})(window.BT);
