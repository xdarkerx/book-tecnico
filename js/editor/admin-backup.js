/* ═══ ⚙️ Administrador › Backup  +  Banco de dados › Excluir um banco ═══
 * Destinos: pasta local, caminho de rede, FTP/FTPS, bucket da Oracle (OCI). Agendamento diário, retenção,
 * senha (criptografia), histórico, "Fazer backup agora", "Baixar" e "Restaurar" a partir de um arquivo.
 * Servidor: server/backup.js.
 */
(function (BT) {
  const h = BT.h;
  const $ = (id) => document.getElementById(id);
  let c = null;
  const field = (label, inp, hint) => h('div', { class: 'fd' }, [h('label', { for: inp.id }, label), inp, hint ? h('small', { class: 'auth-hint' }, hint) : null]);
  const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const when = (t) => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  async function render() {
    const box = $('set-backup'); box.innerHTML = '';
    try { c = await BT.api.backupConfig(); } catch (e) { box.appendChild(h('div', { class: 'db-result err' }, e.message)); return; }
    box.append(runCard(), destCard(), restoreCard());
  }

  function runCard() {
    const last = c.history[0];
    return h('div', { class: 'card set-card' }, [
      h('div', { class: 'subt', style: { marginTop: 0 } }, '🗄️ Backup'),
      h('div', { class: 'set-help' }, 'Guarda books, templates, conexões de cloud, usuários, lixeira e menus padrão. Use uma senha: o arquivo contém credenciais.'),
      last ? h('div', { class: 'db-pill ' + (last.ok ? 'ok' : 'err') }, [h('span', { class: 'dot' }), h('b', {}, `Último: ${when(last.at)}`), h('span', {}, `${last.reason} · ${kb(last.size)}${last.encrypted ? ' · 🔒 criptografado' : ''}`)]) : h('div', { class: 'set-help' }, 'Nenhum backup feito ainda.'),
      h('div', { class: 'db-mongo-act' }, [
        h('button', { class: 'btn btn-primary btn-sm', onclick: (e) => busy(e.currentTarget, async () => {
          const r = await BT.api.backupRun();
          BT.ui.toast(r.ok ? `✓ Backup feito: ${r.name}` : `Backup com falhas: ${r.results.filter((x) => !x.ok).map((x) => x.label + ': ' + x.error).join('; ') || 'nenhum destino ativo'}`, { type: r.ok ? 'ok' : 'err', ms: 8000 });
          render();
        }) }, '💾 Fazer backup agora'),
        h('a', { class: 'btn btn-ghost btn-sm', href: '/api/backup/download' }, '⬇ Baixar um backup')
      ]),
      c.history.length ? h('details', { class: 'set-more' }, [h('summary', {}, `Histórico (${c.history.length})`), h('div', { class: 'acc-table-wrap', style: { marginTop: '8px' } }, h('table', { class: 'acc-table' }, [
        h('thead', {}, h('tr', {}, ['Quando', 'Tipo', 'Tamanho', 'Destinos'].map((t) => h('th', {}, t)))),
        h('tbody', {}, c.history.map((x) => h('tr', {}, [h('td', {}, when(x.at)), h('td', {}, x.reason), h('td', {}, kb(x.size)),
          h('td', {}, x.results.map((r) => h('div', { class: r.ok ? '' : 'acc-off', title: r.ok ? r.where : r.error }, `${r.ok ? '✓' : '✖'} ${r.label}${r.ok ? '' : ': ' + r.error}`)))])))
      ]))]) : null
    ]);
  }

  function destCard() {
    const inp = (obj, key, attrs = {}) => h('input', Object.assign({ class: 'inp inp-sm', id: `bk-${key}-${Math.random().toString(36).slice(2, 6)}`, value: obj[key] == null ? '' : obj[key], oninput: (e) => (obj[key] = attrs.type === 'number' ? Number(e.target.value) : e.target.value) }, attrs));
    const result = {};
    const dest = (id, title, obj, fields, hint) => {
      result[id] = h('div', { class: 'db-result', hidden: true });
      const body = h('div', { class: 'bk-fields', hidden: !obj.enabled }, [hint ? h('div', { class: 'set-help' }, hint) : null, ...fields, h('div', { class: 'db-mongo-act' }, [h('button', { class: 'btn btn-ghost btn-sm', onclick: (e) => busy(e.currentTarget, async () => {
        try { const r = await BT.api.backupTest(id, collect()); show(result[id], true, `✓ Gravou em ${r.where}${r.note ? ' — ' + r.note : ''}`); } catch (x) { show(result[id], false, x.message); }
      }) }, '🔌 Testar destino')]), result[id]]);
      return h('div', { class: 'bk-dest' }, [h('label', { class: 'switch' }, [h('input', { type: 'checkbox', checked: obj.enabled, onchange: (e) => { obj.enabled = e.target.checked; body.hidden = !obj.enabled; } }), h('b', {}, title)]), body]);
    };
    const o = c.oci;
    const ociPar = h('div', { hidden: o.mode !== 'par' }, [field('URL pré-autenticada do bucket', inp(o, 'parUrl', { placeholder: 'https://objectstorage.sa-saopaulo-1.oraclecloud.com/p/…/n/…/b/…/o/', spellcheck: 'false' }), 'Crie em Bucket › Solicitações pré-autenticadas, com acesso a objetos do bucket (leitura e gravação) e listagem. Para apagar os antigos, use uma regra de ciclo de vida no bucket.')]);
    const ociKey = h('div', { hidden: o.mode !== 'key' }, [
      h('div', { class: 'fg fg3' }, [field('Região', inp(o, 'region', { placeholder: 'sa-saopaulo-1' })), field('Namespace', inp(o, 'namespace')), field('Bucket', inp(o, 'bucket'))]),
      h('div', { class: 'fg fg3', style: { marginTop: '8px' } }, [field('OCID da tenancy', inp(o, 'tenancy')), field('OCID do usuário', inp(o, 'user')), field('Fingerprint', inp(o, 'fingerprint'))]),
      h('div', { class: 'fd', style: { marginTop: '8px' } }, [h('label', {}, 'Chave privada (PEM)'), h('textarea', { class: 'inp inp-sm mono', rows: 3, placeholder: '-----BEGIN PRIVATE KEY-----', oninput: (e) => (o.keyPem = e.target.value) }, o.keyPem || '')])
    ]);
    const ociMode = h('select', { class: 'inp inp-sm', id: 'bk-oci-mode', onchange: (e) => { o.mode = e.target.value; ociPar.hidden = o.mode !== 'par'; ociKey.hidden = o.mode !== 'key'; } },
      [['par', 'URL pré-autenticada (mais simples)'], ['key', 'Chave de API (usuário/fingerprint)']].map(([v, l]) => h('option', { value: v, selected: v === o.mode }, l)));
    const s = c.schedule;
    return h('div', { class: 'card set-card' }, [
      h('div', { class: 'subt', style: { marginTop: 0 } }, '📍 Destinos e agendamento'),
      h('div', { class: 'fg fg3' }, [
        field('Senha do backup (criptografia)', inp(c, 'password', { type: 'password', autocomplete: 'new-password', placeholder: 'sem senha = sem criptografia' }), 'Guarde em lugar seguro: sem ela não dá para restaurar.'),
        field('Manter os últimos', inp(c, 'keep', { type: 'number', min: 1, max: 365 }), 'backups em cada destino'),
        h('div', { class: 'fd' }, [h('label', {}, 'Agendamento'), h('label', { class: 'switch' }, [h('input', { type: 'checkbox', checked: s.enabled, onchange: (e) => (s.enabled = e.target.checked) }), 'Todo dia às']), h('input', { class: 'inp inp-sm', type: 'time', value: s.time, style: { marginTop: '6px', maxWidth: '130px' }, oninput: (e) => (s.time = e.target.value) })])
      ]),
      dest('local', 'Pasta local do servidor', c.local, [field('Pasta', inp(c.local, 'path'))]),
      dest('network', 'Caminho de rede', c.network, [field('Caminho', inp(c.network, 'path', { placeholder: '\\\\servidor\\backups\\book-tecnico  ou  /backup-rede' }))], 'Windows: caminho UNC com permissão de escrita para o usuário do serviço. Container: monte o compartilhamento como volume (veja o docker-compose.yml) e use o caminho montado.'),
      dest('ftp', 'FTP / FTPS', c.ftp, [
        h('div', { class: 'fg fg3' }, [field('Servidor', inp(c.ftp, 'host', { placeholder: 'ftp.empresa.com.br' })), field('Porta', inp(c.ftp, 'port', { type: 'number' })), field('Pasta', inp(c.ftp, 'dir'))]),
        h('div', { class: 'fg fg3', style: { marginTop: '8px' } }, [field('Usuário', inp(c.ftp, 'user', { autocomplete: 'off' })), field('Senha', inp(c.ftp, 'password', { type: 'password', autocomplete: 'new-password' })),
          h('div', { class: 'fd' }, [h('label', {}, 'Segurança'), h('label', { class: 'switch' }, [h('input', { type: 'checkbox', checked: c.ftp.secure, onchange: (e) => (c.ftp.secure = e.target.checked) }), 'FTPS (TLS explícito)'])])])
      ]),
      dest('oci', 'Bucket da Oracle (OCI Object Storage)', o, [field('Autenticação', ociMode), h('div', { style: { marginTop: '8px' } }, [ociPar, ociKey]), h('div', { style: { marginTop: '8px', maxWidth: '260px' } }, field('Prefixo (pasta no bucket)', inp(o, 'prefix')))]),
      h('div', { class: 'set-foot' }, h('button', { class: 'btn btn-primary btn-sm', onclick: (e) => busy(e.currentTarget, async () => { try { await BT.api.saveBackupConfig(collect()); BT.ui.toast('Backup configurado ✓', { type: 'ok' }); render(); } catch (x) { BT.ui.toast(x.message, { type: 'err', ms: 7000 }); } }) }, 'Salvar backup'))
    ]);
  }
  const collect = () => ({ password: c.password, keep: c.keep, schedule: c.schedule, local: c.local, network: c.network, ftp: c.ftp, oci: c.oci });
  const show = (el, ok, msg) => { el.hidden = false; el.className = 'db-result ' + (ok ? 'ok' : 'err'); el.textContent = msg; };

  function restoreCard() {
    const file = h('input', { type: 'file', class: 'inp inp-sm', accept: '.btbk,.gz,application/gzip,application/octet-stream' });
    const pw = h('input', { class: 'inp inp-sm', type: 'password', placeholder: 'senha do backup (se criptografado)', autocomplete: 'off' });
    const res = h('div', { class: 'db-result', hidden: true });
    return h('div', { class: 'card set-card danger-zone' }, [
      h('div', { class: 'subt', style: { marginTop: 0 } }, '♻️ Restaurar de um backup'),
      h('div', { class: 'set-help' }, 'Substitui todo o conteúdo do banco em uso pelo do arquivo. Antes, um backup de segurança do estado atual é salvo na pasta local. Todos serão desconectados.'),
      h('div', { class: 'fg fg2' }, [file, pw]),
      h('div', { class: 'db-mongo-act' }, h('button', { class: 'btn btn-danger btn-sm', onclick: (e) => busy(e.currentTarget, async () => {
        const f = file.files[0]; if (!f) return BT.ui.toast('Escolha o arquivo de backup.', { type: 'err' });
        if (!(await BT.ui.modal.confirm(`Restaurar "${f.name}"? Tudo o que está no banco agora será substituído (um backup de segurança será feito antes).`, { okText: 'Restaurar', danger: true }))) return;
        try {
          const r = await BT.api.backupRestore(f, pw.value);
          show(res, true, `✓ Restaurado: ${r.books} book(s), ${r.users} usuário(s) — backup de ${when(r.createdAt)}. Segurança: ${r.safety}`);
          setTimeout(() => location.reload(), 2500);
        } catch (x) { show(res, false, x.message); }
      }) }, 'Restaurar')),
      res
    ]);
  }

  /** Banco de dados › Excluir um banco */
  async function renderDbDelete() {
    const box = $('set-db-delete'); if (!box) return; box.innerHTML = '';
    const info = BT.api.storage || {};
    [['sqlite', 'SQLITE', '🗄️ SQLite'], ['mongo', 'MONGODB', '🍃 MongoDB']].forEach(([kind, word, label]) => {
      const active = info.storage === kind;
      const conf = h('input', { class: 'inp inp-sm mono', placeholder: `digite ${word}`, autocomplete: 'off', 'aria-label': `Digite ${word} para confirmar` });
      box.appendChild(h('div', { class: 'db-del-row' }, [
        h('b', {}, [label, active ? h('span', { class: 'db-badge', style: { position: 'static', marginLeft: '8px' } }, 'Em uso') : null]),
        conf,
        h('button', { class: 'btn btn-danger btn-sm', onclick: (e) => busy(e.currentTarget, async () => {
          if (conf.value.trim().toUpperCase() !== word) return BT.ui.toast(`Digite ${word} para confirmar.`, { type: 'err' });
          if (!(await BT.ui.modal.confirm(`Excluir TODO o banco ${label}${active ? ' (EM USO — o app vai recomeçar vazio)' : ''}? Um backup de segurança é salvo antes.`, { okText: 'Excluir banco', danger: true }))) return;
          try {
            const r = await BT.api.deleteDatabase(kind, conf.value);
            BT.ui.toast(`Banco ${label} excluído. Backup de segurança: ${r.safety}`, { type: 'ok', ms: 9000 });
            if (r.active) setTimeout(() => location.reload(), 2500);
          } catch (x) { BT.ui.toast(x.message, { type: 'err', ms: 8000 }); }
        }) }, 'Excluir')
      ]));
    });
  }

  async function busy(btn, fn) {
    if (btn.disabled) return;
    btn.disabled = true;
    try { await fn(); } catch (e) { BT.ui.toast(e.message, { type: 'err', ms: 7000 }); } finally { btn.disabled = false; }
  }

  BT.editor.backup = { render, renderDbDelete };
})(window.BT);
