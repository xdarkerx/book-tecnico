/* ═══ 🤖 Book automático (por cliente) e ⚙️ Administrador › ✉️ E-mail e automação ═══
 * Cliente: liga/desliga, dia e hora do mês, formatos (PDF/Word/HTML; mais de um vira ZIP), pasta da rede,
 *          caixa(s) de e-mail, assunto/mensagem, "Gerar agora" e o resultado da última geração.
 * Admin: método de envio (SMTP ou Microsoft 365), credenciais, remetente, e-mail de teste e pasta base.
 * Servidor: server/automation.js, server/mail.js.
 */
(function (BT) {
  const h = BT.h;
  const $ = (id) => document.getElementById(id);
  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const fld = (label, el, hint) => h('div', { class: 'fd' }, [h('label', {}, label), el, hint ? h('small', { class: 'auth-hint' }, hint) : null]);
  const when = (t) => (t ? new Date(t).toLocaleString('pt-BR') : '');

  /** Modal do cliente. */
  async function open(client) {
    let c;
    try { c = await BT.api.automation(client.slug); } catch (e) { return BT.ui.toast(e.message, { type: 'err' }); }
    const admin = BT.auth.isAdmin;
    const on = h('input', { type: 'checkbox', checked: c.enabled, disabled: !admin });
    const day = h('input', { class: 'inp', type: 'number', min: 1, max: 28, value: c.day, style: { width: '90px' }, disabled: !admin });
    const hour = h('input', { class: 'inp', type: 'number', min: 0, max: 23, value: c.hour, style: { width: '90px' }, disabled: !admin });
    const fmts = new Set(c.formats);
    const fmtBox = h('div', { class: 'cprow' }, [['pdf', '📄 PDF'], ['word', '📝 Word'], ['html', '🌐 HTML']].map(([k, l]) =>
      h('label', { class: 'cp' }, [h('input', { type: 'checkbox', checked: fmts.has(k), disabled: !admin, onchange: (e) => (e.target.checked ? fmts.add(k) : fmts.delete(k)) }), l])));
    const area = h('input', { class: 'inp', value: c.area || '', placeholder: 'infracloud', disabled: !admin });
    const folder = h('input', { class: 'inp', value: c.folder || '', placeholder: c.baseFolder ? `${c.baseFolder}${c.baseFolder.includes('\\') ? '\\' : '/'}${client.nome}` : '\\\\servidor\\books\\' + client.nome, disabled: !admin });
    const emails = h('input', { class: 'inp', value: c.emails || '', placeholder: 'ti@cliente.com.br, gestor@cliente.com.br', disabled: !admin });
    const subject = h('input', { class: 'inp', value: c.subject || '', placeholder: 'Book Técnico — {cliente} — {mes}', disabled: !admin });
    const message = h('textarea', { class: 'inp', rows: 4, placeholder: 'Olá,\n\nSegue o Book Técnico de {cliente} referente a {mes}.\n\nAtenciosamente,\nEquipe inventCloud', disabled: !admin }, c.message || '');
    const status = h('div');
    const tgt = (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return `${MESES[d.getMonth()]} de ${d.getFullYear()}`; })();

    const drawStatus = (x) => {
      status.innerHTML = '';
      const l = x.last;
      const lines = [];
      if (x.running) lines.push(h('div', { class: 'db-result' }, '⏳ Gerando agora… (abre o book, sincroniza, exporta, salva e envia — pode levar alguns minutos)'));
      if (l) {
        const [y, m] = String(l.month || '').split('-');
        lines.push(h('div', { class: 'db-result ' + (l.ok ? 'ok' : 'err') }, [
          h('b', {}, l.ok ? `✓ Última geração: ${MESES[Number(m) - 1] || ''} de ${y}` : `✕ Última geração falhou (${MESES[Number(m) - 1] || ''} de ${y})`),
          h('div', {}, `${when(l.at)} · ${l.by || ''}${l.ms ? ` · ${Math.round(l.ms / 1000)} s` : ''}`),
          l.ok ? h('div', {}, `Arquivo: ${(l.files || []).join(', ')} (${((l.size || 0) / 1048576).toFixed(1)} MB) em ${l.folder}`) : null,
          l.emailed ? h('div', {}, `Enviado para: ${l.emailed}`) : null,
          l.error ? h('div', {}, l.error) : null,
          (l.warnings || []).length ? h('div', { class: 'auth-hint' }, 'Avisos: ' + l.warnings.join(' | ')) : null
        ]));
      }
      if (!x.profile) lines.push(h('div', { class: 'auth-hint' }, '💡 Ainda não há uma sincronização manual deste cliente: a automação usa as escolhas da última vez que alguém sincronizou (clouds, tipos, Zabbix, backup e riscos). Sincronize um book uma vez para definir.'));
      else lines.push(h('div', { class: 'auth-hint' }, `Usa as escolhas da sincronização de ${when(x.profile.savedAt)}: ${(x.profile.sources || []).join(', ') || 'todas as conexões'} · ${(x.profile.kinds || []).length || 'todos os'} tipo(s) · backup: ${({ both: 'feitos e políticas', jobs: 'só feitos', policies: 'só políticas' })[x.profile.backupMode] || 'feitos e políticas'}${x.profile.risks ? ' · riscos: ' + x.profile.risks.join(', ') : ''}.`));
      if (!x.mailConfigured && (emails.value || '').trim()) lines.push(h('div', { class: 'db-result err' }, '✉️ O envio de e-mail ainda não está configurado (Configurações › Administrador › ✉️ E-mail e automação).'));
      status.append(...lines);
    };
    drawStatus(c);
    let poll = null;
    const refresh = async () => { try { c = await BT.api.automation(client.slug); drawStatus(c); if (!c.running && poll) { clearInterval(poll); poll = null; runBtn.disabled = false; } } catch (e) { /* tenta na próxima */ } };

    const payload = () => ({ enabled: on.checked, day: Number(day.value), hour: Number(hour.value), formats: [...fmts], area: area.value, folder: folder.value, emails: emails.value, subject: subject.value, message: message.value });
    const save = async (quiet) => {
      try { c = Object.assign(c, await BT.api.saveAutomation(client.slug, payload())); if (!quiet) BT.ui.toast('Book automático salvo ✓', { type: 'ok' }); return true; }
      catch (e) { BT.ui.toast(e.message, { type: 'err', ms: 7000 }); return false; }
    };
    const runBtn = h('button', { class: 'btn btn-sec btn-sm', disabled: !admin || c.running, onclick: async () => {
      if (!(await save(true))) return;
      if (!(await BT.ui.modal.confirm(`Gerar agora o book de ${tgt} de ${client.nome}? Ele será criado a partir do último book (se ainda não existir), sincronizado, salvo na pasta${emails.value.trim() ? ' e enviado por e-mail para ' + emails.value.trim() : ''}.`, { okText: 'Gerar agora', title: 'Gerar book' }))) return;
      try { await BT.api.runAutomation(client.slug); runBtn.disabled = true; c.running = true; drawStatus(c); poll = setInterval(refresh, 4000); }
      catch (e) { BT.ui.toast(e.message, { type: 'err', ms: 7000 }); }
    } }, '▶ Gerar agora');

    const m = BT.ui.modal.open({
      title: `🤖 Book automático — ${client.nome}`, size: 'md', onClose: () => poll && clearInterval(poll),
      body: [
        h('div', { class: 'set-help' }, `Todo mês, no dia e hora abaixo, o Book Técnico gera o book do mês anterior (ex.: agora seria ${tgt}): copia os menus e textos do último book, sincroniza com as mesmas escolhas da última sincronização manual, exporta, salva na pasta e envia por e-mail.`),
        h('label', { class: 'switch', style: { margin: '12px 0' } }, [on, 'Gerar o book automaticamente todo mês']),
        h('div', { class: 'fg fg2' }, [fld('Dia do mês (1 a 28)', day), fld('Hora (0 a 23)', hour, 'Horário do servidor.')]),
        h('div', { class: 'lbl', style: { margin: '12px 0 6px' } }, 'Formatos (mais de um → um ZIP com todos)'), fmtBox,
        h('div', { class: 'fg fg2', style: { marginTop: '10px' } }, [
          fld('Área do book', area, 'Vazio = a do book mais recente do cliente.'),
          fld('Pasta de destino (rede)', folder, c.baseFolder ? `Vazio = pasta base + nome do cliente. Caminho relativo fica dentro de ${c.baseFolder}.` : 'Caminho completo (ex.: \\\\servidor\\books\\Cliente) ou defina uma pasta base no admin.')]),
        fld('Enviar por e-mail para', emails, 'Um ou mais e-mails separados por vírgula. Vazio = só salva na pasta.'),
        h('div', { class: 'fg fg2' }, [fld('Assunto', subject, '{cliente} e {mes} são trocados pelo nome e pelo mês.'), h('div')]),
        fld('Mensagem', message),
        h('div', { style: { marginTop: '12px' } }, status),
        !admin ? h('div', { class: 'auth-hint' }, 'Somente administradores alteram a geração automática.') : null
      ],
      footer: [runBtn, h('span', { class: 'spacer' }), h('button', { class: 'btn btn-ghost btn-sm', onclick: () => m.close() }, 'Fechar'),
        admin ? h('button', { class: 'btn btn-primary btn-sm', onclick: async () => { if (await save()) m.close(); } }, 'Salvar') : null]
    });
    if (c.running) { runBtn.disabled = true; poll = setInterval(refresh, 4000); }
  }

  /** Administrador › ✉️ E-mail e automação */
  async function renderAdmin() {
    const box = $('set-mail'); if (!box) return; box.innerHTML = '';
    let c, b;
    try { [c, b] = await Promise.all([BT.api.mailConfig(), BT.api.automationBase()]); } catch (e) { box.appendChild(h('div', { class: 'db-result err' }, e.message)); return; }
    let method = c.method;
    const from = h('input', { class: 'inp', value: c.from, placeholder: 'books@suaempresa.com.br' });
    const host = h('input', { class: 'inp', value: c.smtp.host, placeholder: 'smtp.office365.com' });
    const port = h('input', { class: 'inp', type: 'number', value: c.smtp.port, style: { width: '110px' } });
    const secure = h('input', { type: 'checkbox', checked: c.smtp.secure });
    const user = h('input', { class: 'inp', value: c.smtp.user, autocomplete: 'off' });
    const pass = h('input', { class: 'inp', type: 'password', value: c.smtp.pass, autocomplete: 'new-password' });
    const tenant = h('input', { class: 'inp', value: c.graph.tenantId, placeholder: '00000000-0000-0000-0000-000000000000' });
    const cid = h('input', { class: 'inp', value: c.graph.clientId });
    const secret = h('input', { class: 'inp', type: 'password', value: c.graph.clientSecret, autocomplete: 'new-password' });
    const baseF = h('input', { class: 'inp', value: b.baseFolder || '', placeholder: '\\\\servidor\\books   ou   /exports (no container)' });
    const testTo = h('input', { class: 'inp inp-sm', placeholder: 'seu@email.com', style: { maxWidth: '280px' } });
    const msg = h('div');
    const smtpBox = h('div', {}, [h('div', { class: 'fg fg2' }, [fld('Servidor SMTP', host), fld('Porta', port, '587 (STARTTLS) ou 465 (SSL)')]),
      h('label', { class: 'switch', style: { margin: '8px 0' } }, [secure, 'Conexão SSL direta (porta 465)']),
      h('div', { class: 'fg fg2' }, [fld('Usuário', user), fld('Senha / app password', pass)])]);
    const graphBox = h('div', {}, [h('div', { class: 'set-help' }, ['App Registration no Entra ID com a permissão de ', h('b', {}, 'aplicativo'), ' Microsoft Graph › ', h('code', {}, 'Mail.Send'), ' (com consentimento do admin). O e-mail sai da caixa do remetente acima.']),
      h('div', { class: 'fg fg2' }, [fld('Tenant ID', tenant), fld('Client (application) ID', cid)]), fld('Client secret', secret)]);
    const tabs = h('div', { class: 'cprow', role: 'radiogroup' }, [['smtp', 'SMTP'], ['graph', 'Microsoft 365 (Graph)']].map(([k, l]) =>
      h('label', { class: 'cp' }, [h('input', { type: 'radio', name: 'mail-method', checked: method === k, onchange: () => { method = k; smtpBox.hidden = k !== 'smtp'; graphBox.hidden = k !== 'graph'; } }), l])));
    smtpBox.hidden = method !== 'smtp'; graphBox.hidden = method !== 'graph';
    const save = async () => {
      msg.innerHTML = '';
      try {
        c = await BT.api.saveMailConfig({ method, from: from.value, smtp: { host: host.value, port: Number(port.value), secure: secure.checked, user: user.value, pass: pass.value }, graph: { tenantId: tenant.value, clientId: cid.value, clientSecret: secret.value } });
        await BT.api.saveAutomationBase({ baseFolder: baseF.value });
        pass.value = c.smtp.pass; secret.value = c.graph.clientSecret;
        BT.ui.toast('E-mail e automação salvos ✓', { type: 'ok' }); return true;
      } catch (e) { msg.appendChild(h('div', { class: 'db-result err' }, e.message)); return false; }
    };
    box.append(
      h('div', { class: 'card set-card' }, [
        h('div', { class: 'subt', style: { marginTop: 0 } }, '✉️ Envio de e-mail'),
        h('div', { class: 'set-help' }, 'Usado pelos books automáticos (🤖 Book automático, na página de cada cliente).'),
        h('div', { class: 'lbl', style: { margin: '10px 0 6px' } }, 'Método'), tabs,
        h('div', { style: { marginTop: '10px' } }, fld('Remetente (caixa que envia)', from)),
        h('div', { style: { marginTop: '8px' } }, [smtpBox, graphBox]),
        h('div', { class: 'dk-row', style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '12px' } }, [testTo,
          h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => {
            if (!(await save())) return;
            try { await BT.api.mailTest(testTo.value); BT.ui.toast(`E-mail de teste enviado para ${testTo.value} ✓`, { type: 'ok', ms: 6000 }); }
            catch (e) { msg.innerHTML = ''; msg.appendChild(h('div', { class: 'db-result err' }, e.message)); }
          } }, '✉️ Enviar e-mail de teste')])
      ]),
      h('div', { class: 'card set-card' }, [
        h('div', { class: 'subt', style: { marginTop: 0 } }, '🤖 Pasta base dos books automáticos'),
        h('div', { class: 'set-help' }, 'Cada cliente salva em <pasta base>/<nome do cliente>, ou na pasta definida no próprio cliente. No container, a pasta precisa estar montada (veja BOOK_EXPORT_DIR no README).'),
        fld('Pasta base', baseF)
      ]),
      h('div', { class: 'set-actions' }, [msg, h('button', { class: 'btn btn-primary btn-sm', onclick: save }, 'Salvar')]));
  }

  BT.editor = BT.editor || {};
  BT.editor.automation = { open, renderAdmin };
})(window.BT);
