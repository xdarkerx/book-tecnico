/* ═══ ⚙️ Configurações › Login e acesso + Edição simultânea (somente administradores) ═══
 * - Exigir login (usuário/senha) e cadastro de usuários, com última atividade de cada um
 * - Login Microsoft (SAML · Entra ID): URL de login, Entity ID, certificado, domínios permitidos
 * - Grupos do Entra ID → papel (no login e sincronização periódica pelo Microsoft Graph)
 * - Bloquear edição simultânea do mesmo book + tempo para o usuário responder antes de ser desconectado
 * Servidor: server/auth/index.js e server/auth/locks.js.
 */
(function (BT) {
  const h = BT.h;
  let cfg = null, users = [];
  const $ = (id) => document.getElementById(id);
  const sw = (id, label, checked, onchange, disabled) => h('label', { class: 'switch' }, [h('input', { type: 'checkbox', id, checked, disabled, onchange }), label]);
  const field = (label, inp, hint) => h('div', { class: 'fd' }, [h('label', { for: inp.id }, label), inp, hint ? h('small', { class: 'auth-hint' }, hint) : null]);

  async function render() {
    const a = $('set-access-login'), l = $('set-access-lock');
    a.innerHTML = ''; l.innerHTML = '';
    if (BT.api.mode !== 'server' || !BT.auth.isAdmin) return;
    try { [cfg, users] = await Promise.all([BT.api.getAuthConfig(), BT.api.listUsers()]); }
    catch (e) { a.appendChild(h('div', { class: 'db-result err' }, 'Login e acesso: ' + e.message)); return; }
    a.appendChild(loginCard());
    a.appendChild(groupsCard());
    l.appendChild(lockCard());
    drawLockHint();
  }
  const saveBar = (label) => h('div', { class: 'set-foot' }, h('button', { class: 'btn btn-primary btn-sm', onclick: (e) => busySave(e.currentTarget) }, label));
  async function busySave(btn) {
    btn.disabled = true;
    try { await save(); BT.ui.toast('Salvo ✓', { type: 'ok' }); } catch (e) { BT.ui.toast(e.message, { type: 'err', ms: 7000 }); } finally { btn.disabled = false; }
  }

  // ── Login, usuários e SAML ─────────────────────────────
  function loginCard() {
    const admins = users.filter((u) => u.role === 'admin' && !u.disabled).length;
    return h('div', { class: 'card set-card' }, [
      h('div', { class: 'subt', style: { marginTop: 0 } }, '🔐 Login e acesso'),
      sw('acc-enabled', 'Exigir login para usar o Book Técnico', cfg.enabled, (e) => { cfg.enabled = e.target.checked; drawLockHint(); }, !admins && !cfg.enabled),
      h('div', { class: 'set-help' }, !admins ? 'Para ligar o login, cadastre primeiro um usuário administrador abaixo.'
        : cfg.enabled ? 'Ligado: só entra quem tem usuário (senha ou conta Microsoft). Administradores mudam as configurações.'
          : 'Desligado: qualquer pessoa que acessar o endereço do servidor usa o app (como antes).'),

      h('div', { class: 'acc-users-h' }, [h('div', { class: 'subt', style: { margin: 0 } }, '👥 Usuários'), h('button', { class: 'btn btn-sec btn-sm', onclick: () => editUser() }, '＋ Novo usuário')]),
      usersTable(),

      h('div', { class: 'subt' }, '🪟 Login Microsoft (SAML · Entra ID)'),
      samlSection(),
      saveBar('Salvar login e acesso')
    ]);
  }

  // ── Grupos do Entra ID → papel ─────────────────────────
  function groupsCard() {
    const g = cfg.groups, gr = cfg.graph, st = cfg.graphState || {};
    const ta = (id, key, ph) => h('textarea', { class: 'inp inp-sm mono', id, rows: 2, placeholder: ph, oninput: (e) => (g[key] = e.target.value) }, g[key] || '');
    const inp = (id, key, attrs = {}) => h('input', Object.assign({ class: 'inp inp-sm', id, value: gr[key] || '', oninput: (e) => (gr[key] = e.target.value) }, attrs));
    const result = h('div', { class: 'db-result', hidden: true });
    const show = (ok, content) => { result.hidden = false; result.className = 'db-result ' + (ok ? 'ok' : 'err'); result.replaceChildren(...[].concat(content)); };
    const body = h('div', { hidden: !g.enabled }, [
      h('div', { class: 'fg fg2', style: { marginTop: '10px' } }, [
        field('Grupos de administradores (ID de objeto)', ta('grp-admin', 'adminGroups', '00000000-0000-0000-0000-000000000000'), 'Quem estiver em um destes grupos entra como administrador.'),
        field('Grupos de usuários (ID de objeto)', ta('grp-user', 'userGroups', '00000000-0000-0000-0000-000000000000'), 'Separe vários IDs por vírgula.')
      ]),
      h('label', { class: 'switch', style: { marginTop: '10px' } }, [h('input', { type: 'checkbox', checked: g.denyOthers, onchange: (e) => (g.denyOthers = e.target.checked) }), 'Barrar quem não estiver em nenhum desses grupos (e desativar na sincronização)']),
      h('details', { class: 'set-more' }, [h('summary', {}, 'Como enviar os grupos no login (portal Azure)'), h('ol', { class: 'acc-steps', style: { marginTop: '8px' } }, [
        h('li', {}, ['No aplicativo empresarial › ', h('b', {}, 'Logon único › Atributos e Declarações › Adicionar uma declaração de grupo'), '.']),
        h('li', {}, ['Escolha ', h('b', {}, 'Grupos atribuídos ao aplicativo'), ' e o atributo de origem ', h('b', {}, 'ID do grupo'), '.']),
        h('li', {}, ['O ID de objeto de cada grupo está em ', h('b', {}, 'Entra ID › Grupos'), '.'])
      ])]),
      h('div', { class: 'subt' }, '🔄 Sincronização periódica (Microsoft Graph)'),
      h('div', { class: 'set-help' }, 'Cria os usuários dos grupos antes do 1º login, ajusta o papel e desativa quem saiu dos grupos. Usuários com senha local nunca são alterados. Precisa de um App Registration com client secret e permissões de aplicativo GroupMember.Read.All e User.Read.All (com consentimento do administrador).'),
      h('label', { class: 'switch' }, [h('input', { type: 'checkbox', checked: gr.enabled, onchange: (e) => (gr.enabled = e.target.checked) }), 'Sincronizar automaticamente']),
      h('div', { class: 'fg fg3', style: { marginTop: '10px' } }, [
        field('Tenant ID', inp('gr-tenant', 'tenantId', { placeholder: '00000000-…', spellcheck: 'false' })),
        field('Client ID (Application ID)', inp('gr-client', 'clientId', { placeholder: '00000000-…', spellcheck: 'false' })),
        field('Client secret', inp('gr-secret', 'clientSecret', { type: 'password', autocomplete: 'new-password' }))
      ]),
      h('div', { class: 'fd', style: { marginTop: '10px', maxWidth: '220px' } }, [h('label', { for: 'gr-int' }, 'A cada (horas)'), h('input', { class: 'inp inp-sm', id: 'gr-int', type: 'number', min: 1, max: 168, value: gr.intervalHours, oninput: (e) => (gr.intervalHours = Number(e.target.value)) })]),
      h('div', { class: 'db-mongo-act' }, [
        h('button', { class: 'btn btn-ghost btn-sm', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { const r = await BT.api.graphTest({ groups: g, graph: gr }); show(r.ok, r.groups.map((x) => h('div', {}, `${x.ok ? '✓' : '✖'} ${x.ok ? x.name : x.id} — ${x.ok ? (x.role === 'admin' ? 'administradores' : 'usuários') : x.error}`))); } catch (x) { show(false, x.message); } finally { b.disabled = false; } } }, '🔌 Testar e ver os grupos'),
        h('button', { class: 'btn btn-sec btn-sm', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { await save(); const r = await BT.api.graphSync(); show(true, `✓ ${r.members} membro(s): ${r.created} criado(s), ${r.updated} atualizado(s), ${r.disabled} desativado(s), ${r.enabled} reativado(s)`); render(); } catch (x) { show(false, x.message); } finally { b.disabled = false; } } }, '🔄 Sincronizar agora')
      ]),
      st.at ? h('div', { class: 'set-help' }, `Última sincronização: ${new Date(st.at).toLocaleString('pt-BR')} (${st.reason}) — ${st.ok ? `${st.result.created} criado(s), ${st.result.updated} atualizado(s), ${st.result.disabled} desativado(s)` : 'falhou: ' + st.error}`) : null,
      result
    ]);
    return h('div', { class: 'card set-card' }, [
      h('div', { class: 'subt', style: { marginTop: 0 } }, '👥 Grupos do Microsoft Entra ID → papel'),
      h('label', { class: 'switch' }, [h('input', { type: 'checkbox', checked: g.enabled, onchange: (e) => { g.enabled = e.target.checked; body.hidden = !g.enabled; } }), 'Definir administrador / usuário pelos grupos do Entra ID (recalculado a cada login Microsoft)']),
      body,
      saveBar('Salvar grupos')
    ]);
  }

  function usersTable() {
    if (!users.length) return h('div', { class: 'st-empty' }, 'Nenhum usuário. O primeiro que você criar deve ser administrador.');
    const me = BT.auth.user && BT.auth.user.id;
    return h('div', { class: 'acc-table-wrap' }, h('table', { class: 'acc-table' }, [
      h('thead', {}, h('tr', {}, ['Nome', 'Login', 'Papel', 'Entra com', 'Última atividade', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, users.map((u) => h('tr', { class: u.disabled ? 'off' : '' }, [
        h('td', {}, [h('b', {}, u.name), u.id === me ? h('span', { class: 'nv-open-tag' }, 'você') : null, u.disabled ? h('span', { class: 'acc-off' }, 'desativado') : null]),
        h('td', { class: 'mono' }, u.username),
        h('td', {}, u.role === 'admin' ? 'Administrador' : 'Usuário'),
        h('td', {}, u.provider === 'saml' ? 'Microsoft' : 'Senha'),
        h('td', { title: u.lastLogin ? 'Último login: ' + new Date(u.lastLogin).toLocaleString('pt-BR') : '' }, u.lastSeen ? [BT.lock.ago(u.lastSeen), u.sessions > 1 ? h('small', { class: 'muted' }, ` · ${u.sessions} sessões`) : null] : h('span', { class: 'muted' }, u.lastLogin ? 'sem sessão aberta' : 'nunca entrou')),
        h('td', { class: 'acc-act' }, [
          h('button', { class: 'mini-btn', title: 'Editar', 'aria-label': `Editar ${u.name}`, onclick: () => editUser(u) }, '✎'),
          u.sessions && u.id !== me ? h('button', { class: 'mini-btn', title: 'Encerrar as sessões (desconectar)', 'aria-label': `Desconectar ${u.name}`, onclick: () => endSessions(u) }, '⏏') : null,
          u.id !== me ? h('button', { class: 'mini-btn', title: 'Excluir', 'aria-label': `Excluir ${u.name}`, onclick: () => removeUser(u) }, '🗑') : null
        ])
      ])))
    ]));
  }

  async function editUser(u) {
    const isNew = !u; u = u || { role: users.length ? 'user' : 'admin', provider: 'local' };
    const inp = (id, value, attrs = {}) => h('input', Object.assign({ class: 'inp', id, value: value || '' }, attrs));
    const name = inp('usr-name', u.name), login = inp('usr-login', u.username, { autocomplete: 'off', spellcheck: 'false', autocapitalize: 'none' }), email = inp('usr-email', u.email, { type: 'email' });
    const pass = inp('usr-pass', '', { type: 'password', autocomplete: 'new-password', placeholder: isNew ? '' : 'deixe em branco para manter' });
    const role = h('select', { class: 'inp', id: 'usr-role' }, [['user', 'Usuário'], ['admin', 'Administrador']].map(([v, l]) => h('option', { value: v, selected: v === u.role }, l)));
    const disabled = h('input', { type: 'checkbox', checked: !!u.disabled });
    const err = h('div', { class: 'field-err', role: 'alert' });
    const save = async () => {
      err.textContent = '';
      try {
        await BT.api.saveUser({ id: u.id, name: name.value, username: login.value, email: email.value, role: role.value, password: pass.value || undefined, disabled: disabled.checked });
        m.close(); BT.ui.toast(isNew ? 'Usuário criado ✓' : 'Usuário salvo ✓', { type: 'ok' }); render();
      } catch (e) { err.textContent = e.message; }
    };
    const m = BT.ui.modal.open({
      title: isNew ? '＋ Novo usuário' : `Editar ${u.name}`,
      body: [
        h('div', { class: 'fg fg2' }, [field('Nome', name), field('Usuário (login)', login, 'Para quem entra com Microsoft, use o e-mail.')]),
        h('div', { class: 'fg fg2', style: { marginTop: '10px' } }, [field('E-mail', email), field('Papel', role, 'Administradores mudam as configurações e os usuários.')]),
        u.provider === 'saml' ? h('div', { class: 'set-help' }, 'Este usuário entra com a conta Microsoft (sem senha local).')
          : h('div', { style: { marginTop: '10px' } }, field(isNew ? 'Senha' : 'Nova senha', pass, 'Pelo menos 8 caracteres.')),
        isNew ? null : h('label', { class: 'switch', style: { marginTop: '12px' } }, [disabled, 'Desativado (não consegue entrar; sessões abertas são encerradas)']),
        err
      ],
      footer: [h('button', { class: 'btn btn-ghost btn-sm', onclick: () => m.close() }, 'Cancelar'), h('button', { class: 'btn btn-primary btn-sm', onclick: save }, 'Salvar')]
    });
  }
  async function endSessions(u) {
    if (!(await BT.ui.modal.confirm(`Desconectar ${u.name}? As sessões abertas dele(a) são encerradas e os books que estiver editando ficam livres. O que já foi digitado está salvo.`, { okText: 'Desconectar', danger: true }))) return;
    try { await BT.api.endUserSessions(u.id); BT.ui.toast(`${u.name} desconectado(a).`, { type: 'ok' }); render(); } catch (e) { BT.ui.toast(e.message, { type: 'err' }); }
  }
  async function removeUser(u) {
    if (!(await BT.ui.modal.confirm(`Excluir o usuário ${u.name} (${u.username})? Não dá para desfazer.`, { okText: 'Excluir', danger: true }))) return;
    try { await BT.api.deleteUser(u.id); BT.ui.toast('Usuário excluído.', { type: 'ok' }); render(); } catch (e) { BT.ui.toast(e.message, { type: 'err' }); }
  }

  function samlSection() {
    const s = cfg.saml;
    const inp = (id, key, attrs = {}) => h('input', Object.assign({ class: 'inp inp-sm', id, value: s[key] || '', oninput: (e) => (s[key] = e.target.value) }, attrs));
    const copy = (text) => h('button', { class: 'btn btn-ghost btn-xs', type: 'button', onclick: () => { navigator.clipboard && navigator.clipboard.writeText(text).then(() => BT.ui.toast('Copiado ✓', { type: 'ok', ms: 1500 })); } }, 'Copiar');
    const entity = s.issuer || cfg.entityIdSuggestion;
    const fields = h('div', { class: 'acc-saml', hidden: !s.enabled }, [
      h('ol', { class: 'acc-steps' }, [
        h('li', {}, ['No portal Azure: ', h('b', {}, 'Microsoft Entra ID › Aplicativos empresariais › Novo aplicativo › Criar seu próprio aplicativo'), ' (fora da galeria).']),
        h('li', {}, ['Em ', h('b', {}, 'Logon único › SAML'), ', configure:', h('div', { class: 'acc-kv' }, [
          h('span', {}, 'Identificador (Entity ID)'), h('code', {}, entity), copy(entity),
          h('span', {}, 'URL de resposta (ACS)'), h('code', {}, cfg.acsUrl), copy(cfg.acsUrl)
        ]), 'Ou envie o arquivo de metadata: ', h('a', { href: '/api/auth/saml/metadata' }, 'baixar metadata.xml'), '.']),
        h('li', {}, ['Copie a ', h('b', {}, 'URL de Logon'), ' e baixe o ', h('b', {}, 'Certificado (Base64)'), ' e cole abaixo. Em ', h('b', {}, 'Usuários e grupos'), ', dê acesso a quem pode entrar.'])
      ]),
      h('div', { class: 'fg fg2' }, [
        field('URL de logon (Login URL)', inp('saml-entry', 'entryPoint', { placeholder: 'https://login.microsoftonline.com/<tenant>/saml2' })),
        field('Identificador (Entity ID) deste app', inp('saml-issuer', 'issuer', { placeholder: cfg.entityIdSuggestion }), 'O mesmo valor do campo "Identificador" no Azure.')
      ]),
      h('div', { class: 'fd', style: { marginTop: '10px' } }, [h('label', { for: 'saml-cert' }, 'Certificado (Base64)'), h('textarea', { class: 'inp inp-sm mono', id: 'saml-cert', rows: 4, placeholder: '-----BEGIN CERTIFICATE-----\nMIIC8DCC…', oninput: (e) => (s.idpCert = e.target.value) }, s.idpCert || '')]),
      h('div', { class: 'fg fg2', style: { marginTop: '10px' } }, [
        field('Domínios permitidos', inp('saml-domains', 'allowedDomains', { placeholder: 'suaempresa.com.br, outra.com' }), 'Vazio = qualquer conta que o Entra ID aceitar.'),
        h('div', { class: 'fd' }, [h('label', {}, 'Endereço do app'), h('small', { class: 'auth-hint' }, ['Usa a ', h('b', {}, 'URL externa'), ' de Administrador › 🌐 Site e app desktop (atrás de proxy/HTTPS, defina lá).'])])
      ]),
      h('div', { class: 'fg fg2', style: { marginTop: '10px' } }, [
        field('Texto do botão', inp('saml-label', 'label')),
        field('Papel de quem entra pela 1ª vez', h('select', { class: 'inp inp-sm', id: 'saml-role', onchange: (e) => (s.defaultRole = e.target.value) }, [['user', 'Usuário'], ['admin', 'Administrador']].map(([v, l]) => h('option', { value: v, selected: v === s.defaultRole }, l))))
      ]),
      h('label', { class: 'switch', style: { marginTop: '10px' } }, [h('input', { type: 'checkbox', checked: s.autoCreate, onchange: (e) => (s.autoCreate = e.target.checked) }), 'Criar o usuário automaticamente no primeiro login Microsoft (senão, só quem estiver cadastrado aqui, com o e-mail como login)'])
    ]);
    return h('div', {}, [
      sw('saml-on', 'Mostrar "Entrar com Microsoft" na tela de login', s.enabled, (e) => { s.enabled = e.target.checked; fields.hidden = !s.enabled; }),
      fields
    ]);
  }

  // ── Edição simultânea ──────────────────────────────────
  function lockCard() {
    const l = cfg.lock;
    return h('div', { class: 'card set-card' }, [
      h('div', { class: 'subt', style: { marginTop: 0 } }, '🔒 Edição simultânea'),
      sw('lock-on', 'Bloquear o book enquanto outro usuário estiver editando', l.enabled, (e) => { l.enabled = e.target.checked; drawLockHint(); }),
      h('div', { class: 'set-help', id: 'lock-hint' }),
      h('div', { class: 'fd', style: { marginTop: '8px', maxWidth: '260px' } }, [
        h('label', { for: 'lock-min' }, 'Tempo para responder ao pedido (minutos)'),
        h('input', { class: 'inp inp-sm', id: 'lock-min', type: 'number', min: 1, max: 120, value: l.responseMinutes, oninput: (e) => (l.responseMinutes = Number(e.target.value)) })
      ]),
      h('ul', { class: 'acc-how' }, [
        h('li', {}, 'Quem abrir um book que já está aberto vê quem está editando, desde quando e a última atividade (ex.: há 3 h), em modo somente leitura.'),
        h('li', {}, 'Ele pode pedir para editar: quem está com o book recebe um aviso para liberar ou continuar.'),
        h('li', {}, 'Sem resposta no prazo acima, o pedido pode assumir a edição — o outro usuário é desconectado (o que ele digitou fica salvo).'),
        h('li', {}, 'Fechar a aba ou voltar para a lista de clientes libera o book na hora; sem sinal do navegador por ~90 s, ele fica livre sozinho.')
      ]),
      saveBar('Salvar edição simultânea')
    ]);
  }
  function drawLockHint() {
    const el = $('lock-hint'); if (!el) return;
    el.textContent = cfg.lock.enabled && !cfg.enabled ? '⚠ Funciona só com o login ligado (é preciso saber quem está editando).' : '';
  }

  /** Chamado pelo "Salvar configurações". */
  async function save() {
    if (!cfg || BT.api.mode !== 'server' || !BT.auth.isAdmin) return;
    const wasOn = BT.auth.enabled;
    if (cfg.saml.enabled && !cfg.saml.issuer) cfg.saml.issuer = cfg.entityIdSuggestion; // usa o sugerido (mostrado no passo 2)
    const out = await BT.api.saveAuthConfig({ enabled: cfg.enabled, saml: cfg.saml, lock: cfg.lock, groups: cfg.groups, graph: cfg.graph });
    if (out.enabled !== wasOn || !!out.lock.enabled !== !!(BT.auth.info.lock && BT.auth.info.lock.enabled)) {
      BT.ui.toast(out.enabled && !wasOn ? 'Login ligado — entre com seu usuário.' : 'Configurações de acesso aplicadas.', { type: 'ok' });
      await BT.store.saveNow();
      setTimeout(() => location.reload(), 900);
    }
  }

  BT.editor.access = { render, save };
})(window.BT);
