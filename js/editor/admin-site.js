/* ═══ ⚙️ Site: URL externa (Administrador) e download do app desktop (Usuário) ═══
 * Servidor: server/site.js — GET /api/site, GET|PUT /api/site/config, GET /api/desktop/download.
 * App desktop: projeto Tauri em desktop/ (janela própria que abre o endereço do servidor).
 */
(function (BT) {
  const h = BT.h;
  const $ = (id) => document.getElementById(id);
  // o app desktop se identifica no user agent (desktop/src-tauri/tauri.conf.json)
  const inDesktop = () => /BookTecnicoDesktop/.test(navigator.userAgent);
  const copyBtn = (text) => h('button', { class: 'btn btn-ghost btn-xs', type: 'button', onclick: async () => {
    try { await navigator.clipboard.writeText(text); BT.ui.toast('Copiado ✓', { type: 'ok', ms: 1500 }); } catch (e) { BT.ui.toast('Não foi possível copiar: selecione e copie à mão.', { type: 'err' }); }
  } }, '📋 Copiar');

  /** Usuário › 💻 App desktop */
  async function renderUser() {
    const box = $('set-desktop'); if (!box) return; box.innerHTML = '';
    if (BT.api.mode !== 'server') { box.appendChild(h('div', { class: 'card set-card' }, [h('div', { class: 'subt', style: { marginTop: 0 } }, '💻 App desktop'), h('div', { class: 'set-help' }, 'Disponível quando o app roda no servidor (npm run dev ou container).')])); return; }
    let info = { publicUrl: '', desktop: {} };
    try { info = await BT.api.siteInfo(); } catch (e) { /* usa o endereço atual */ }
    const addr = info.publicUrl || location.origin;
    const card = h('div', { class: 'card set-card' }, [
      h('div', { class: 'subt', style: { marginTop: 0 } }, '💻 App desktop'),
      h('div', { class: 'set-help' }, 'Instale o Book Técnico como aplicativo do Windows: janela própria, ícone no menu Iniciar e na barra de tarefas, sem as abas e a barra do navegador. Os dados continuam no servidor, o app só abre este site.')
    ]);
    if (inDesktop()) {
      card.append(h('div', { class: 'dk-box' }, [h('b', {}, '✓ Você já está usando o app desktop.'),
        h('div', { class: 'set-help', style: { margin: '6px 0 0' } }, ['Servidor: ', h('code', {}, location.origin)]),
        h('a', { class: 'btn btn-ghost btn-sm', style: { marginTop: '10px' }, href: 'http://tauri.localhost/index.html?trocar=1' }, '🔁 Trocar de servidor')]));
    } else {
      card.append(
        h('div', { class: 'dk-row' }, [
          h('a', { class: 'btn btn-primary', href: '/api/desktop/download', download: '' }, '⬇ Baixar para Windows'),
          h('span', { class: 'set-help', style: { margin: 0 } }, info.desktop.source === 'local' ? `Instalador do servidor: ${info.desktop.file}` : 'Windows 10 ou 11 (64 bits).')
        ]),
        h('ol', { class: 'dk-steps' }, [
          h('li', {}, 'Baixe e execute o instalador (não precisa ser administrador do computador).'),
          h('li', {}, ['Abra o ', h('b', {}, 'Book Técnico'), ' pelo menu Iniciar. Na primeira vez, informe o endereço do servidor:']),
          h('li', { class: 'dk-addr' }, [h('code', {}, addr), copyBtn(addr)]),
          h('li', {}, 'Entre com o mesmo login de sempre. O app lembra o endereço nas próximas vezes.')
        ]),
        h('div', { class: 'set-help' }, 'Se o Windows mostrar "O Windows protegeu o computador", clique em "Mais informações" › "Executar assim mesmo" (o instalador de teste não é assinado digitalmente).'));
    }
    box.appendChild(card);
  }

  /** Administrador › 🌐 Site e app desktop */
  async function renderAdmin() {
    const box = $('set-site'); if (!box) return; box.innerHTML = '';
    let c;
    try { c = await BT.api.siteConfig(); } catch (e) { box.appendChild(h('div', { class: 'db-result err' }, e.message)); return; }
    const pub = h('input', { class: 'inp', id: 'site-public', value: c.publicUrl, placeholder: location.origin, autocomplete: 'off' });
    const dl = h('input', { class: 'inp', id: 'site-desktop', value: c.desktopUrl, placeholder: c.defaultDesktopUrl, autocomplete: 'off' });
    const msg = h('div');
    const save = async () => {
      msg.innerHTML = '';
      try {
        c = await BT.api.saveSiteConfig({ publicUrl: pub.value, desktopUrl: dl.value });
        pub.value = c.publicUrl; dl.value = c.desktopUrl;
        BT.ui.toast('Site salvo ✓', { type: 'ok' });
      } catch (e) { msg.appendChild(h('div', { class: 'db-result err' }, e.message)); }
    };
    box.appendChild(h('div', { class: 'card set-card' }, [
      h('div', { class: 'subt', style: { marginTop: 0 } }, '🌐 URL externa'),
      h('div', { class: 'set-help' }, 'Endereço pelo qual as pessoas acessam o Book Técnico (ex.: atrás de um proxy com HTTPS). Vazio = o endereço usado em cada acesso.'),
      h('div', { class: 'fd' }, [h('label', { for: 'site-public' }, 'URL externa'), pub,
        h('small', { class: 'auth-hint' }, 'Usada no login Microsoft (SAML: Entity ID e URL de resposta), no endereço sugerido do app desktop e nos links do app.')]),
      h('div', { class: 'set-help', style: { marginTop: '8px' } }, ['Endereço atual deste acesso: ', h('code', {}, location.origin), ' ', copyBtn(location.origin)])
    ]));
    box.appendChild(h('div', { class: 'card set-card' }, [
      h('div', { class: 'subt', style: { marginTop: 0 } }, '💻 Instalador do app desktop'),
      h('div', { class: 'set-help' }, ['De onde os usuários baixam o app (Configurações › Usuário › App desktop). ',
        c.localInstaller ? h('b', {}, `Usando o arquivo do servidor: ${c.localInstaller}`) : 'Para usar um arquivo do próprio servidor (sem internet), coloque o .exe ou .msi na pasta data/desktop.']),
      h('div', { class: 'fd' }, [h('label', { for: 'site-desktop' }, 'Link do instalador (opcional)'), dl,
        h('small', { class: 'auth-hint' }, 'Vazio = versão publicada no GitHub. Use para apontar para um compartilhamento interno ou outro site.')])
    ]));
    box.appendChild(h('div', { class: 'set-actions' }, [msg, h('button', { class: 'btn btn-primary btn-sm', onclick: save }, 'Salvar')]));
  }

  BT.editor = BT.editor || {};
  BT.editor.site = { renderUser, renderAdmin, inDesktop };
})(window.BT);
