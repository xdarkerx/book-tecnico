/* ═══ Login no navegador ═══
 * Com o login ligado no servidor (⚙️ Configurações › Login e acesso):
 *  - sem sessão → tela de login (usuário/senha e, se configurado, "Entrar com Microsoft");
 *  - nenhum usuário cadastrado → tela de configuração inicial (cria o administrador);
 *  - sessão encerrada no meio do uso (expirou, admin encerrou, outro usuário assumiu o book) → volta à tela de login.
 * A sessão é um cookie HttpOnly do servidor: o JavaScript nunca vê o token.
 */
(function (BT) {
  const h = BT.h;
  const A = {
    info: { enabled: false, user: null, saml: { enabled: false }, lock: { enabled: false } },
    get user() { return A.info.user; },
    get enabled() { return !!A.info.enabled; },
    /** Admin (ou login desligado: todos podem tudo, como antes). */
    get isAdmin() { return !A.info.enabled || !!(A.info.user && A.info.user.role === 'admin'); },
    get lockEnabled() { return !!(A.info.lock && A.info.lock.enabled && A.info.user); },

    /** Padrões de importação do usuário (Configurações › Usuário › Importação padrão).
     *  Com login: ficam no usuário (qualquer computador). Sem login: neste navegador. */
    importDefaults() {
      const DEF = { zabbixSeverities: [0, 1, 2, 3, 4, 5], risks: ['critica', 'alta', 'media', 'baixa', 'info'], newOnly: false, zabbixAllHosts: true, backupMode: 'both' };
      let d = A.info.user && A.info.user.prefs && A.info.user.prefs.importDefaults;
      if (!d) { try { d = JSON.parse(localStorage.getItem('bt-import-defaults') || 'null'); } catch (e) { d = null; } }
      return Object.assign({}, DEF, d || {});
    },
    async saveImportDefaults(d) {
      try { localStorage.setItem('bt-import-defaults', JSON.stringify(d)); } catch (e) { /* sem armazenamento */ }
      if (A.info.user) {
        const r = await BT.api.savePrefs({ importDefaults: d });
        A.info.user.prefs = Object.assign({}, A.info.user.prefs, { importDefaults: (r && r.prefs && r.prefs.importDefaults) || d });
      }
    },

    /** Carrega o estado do login. Devolve false se a tela de login ficou aberta (o app espera). */
    async init() {
      if (BT.api.mode !== 'server') return true;
      try { A.info = await BT.api.authMe(); } catch (e) { return true; }
      const err = new URLSearchParams(location.search).get('login_erro');
      if (A.info.enabled && !A.info.user) { screen(A.info.needsSetup ? 'setup' : 'login', err); return false; }
      const pref = A.info.user && A.info.user.prefs && A.info.user.prefs.theme;
      if (pref && BT.ui.theme && pref !== BT.ui.theme.choice()) BT.ui.theme.set(pref, { remote: false }); // tema salvo no usuário
      return true;
    },
    async logout() {
      try { await BT.store.saveNow(); if (BT.lock) await BT.lock.leave(); await BT.api.logout(); } catch (e) { /* sai mesmo assim */ }
      location.href = '/';
    },
    /** Chamado pela API quando o servidor responde 401. */
    expired(msg) {
      if (!A.info.enabled || document.getElementById('auth')) return;
      if (BT.lock) BT.lock.stop();
      BT.store.readOnly = true;
      screen('login', 'Sua sessão terminou' + (msg && !/login para continuar/i.test(msg) ? ': ' + msg : '. Entre de novo para continuar.'));
    },
    /** Botão do usuário (nome + sair) usado no topo do editor e da tela de clientes. */
    chip() {
      if (!A.info.enabled || !A.info.user) return null;
      const u = A.info.user;
      return h('div', { class: 'user-chip' }, [
        h('span', { class: 'user-av', 'aria-hidden': 'true' }, initials(u.name)),
        h('span', { class: 'user-name hide-sm' }, [h('b', {}, u.name), h('small', {}, u.role === 'admin' ? 'Administrador' : 'Usuário')]),
        h('button', { class: 'btn btn-ghost btn-xs', title: 'Sair', onclick: () => A.logout() }, 'Sair')
      ]);
    }
  };
  const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  /** Tela cheia de login / configuração inicial. */
  function screen(mode, message) {
    let root = document.getElementById('auth');
    if (root) root.remove();
    root = h('section', { class: 'auth', id: 'auth', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'auth-title' });
    document.body.appendChild(root);
    document.body.classList.add('start-open');
    const err = h('div', { class: 'auth-err', role: 'alert' }, message || '');
    const user = h('input', { class: 'inp', id: 'auth-user', autocomplete: 'username', required: true, autocapitalize: 'none', spellcheck: 'false' });
    const pass = h('input', { class: 'inp', id: 'auth-pass', type: 'password', autocomplete: mode === 'setup' ? 'new-password' : 'current-password', required: true });
    const name = h('input', { class: 'inp', id: 'auth-name', autocomplete: 'name' });
    const pass2 = h('input', { class: 'inp', id: 'auth-pass2', type: 'password', autocomplete: 'new-password' });
    const submit = h('button', { class: 'btn btn-primary w-100', type: 'submit' }, mode === 'setup' ? 'Criar administrador e entrar' : 'Entrar');
    const field = (label, inp, hint) => h('div', { class: 'fd' }, [h('label', { for: inp.id }, label), inp, hint ? h('small', { class: 'auth-hint' }, hint) : null]);

    const form = h('form', { class: 'auth-form', onsubmit: async (e) => {
      e.preventDefault(); err.textContent = '';
      if (mode === 'setup' && pass.value !== pass2.value) { err.textContent = 'As senhas não conferem.'; pass2.focus(); return; }
      submit.disabled = true;
      try {
        if (mode === 'setup') await BT.api.setupAdmin({ username: user.value, name: name.value, password: pass.value });
        else await BT.api.login(user.value, pass.value);
        location.reload(); // recomeça já logado (mesma URL: volta ao book que estava aberto)
      } catch (x) { err.textContent = x.message; submit.disabled = false; pass.select(); }
    } }, mode === 'setup' ? [
      h('p', { class: 'auth-sub' }, 'Primeiro acesso: crie o usuário administrador. Depois, em ⚙️ Configurações, você cadastra os outros usuários e o login Microsoft.'),
      field('Seu nome', name), field('Usuário', user, 'ex.: admin ou nome.sobrenome'), field('Senha', pass, 'Pelo menos 8 caracteres'), field('Repita a senha', pass2), err, submit
    ] : [
      field('Usuário', user), field('Senha', pass), err, submit,
      A.info.saml && A.info.saml.enabled ? h('div', { class: 'auth-or' }, h('span', {}, 'ou')) : null,
      A.info.saml && A.info.saml.enabled ? h('a', { class: 'btn btn-sec w-100 auth-ms', href: '/api/auth/saml/login' }, [msLogo(), A.info.saml.label || 'Entrar com Microsoft']) : null
    ]);

    root.appendChild(h('div', { class: 'auth-card card' }, [
      h('img', { src: BT.ui.theme ? BT.ui.theme.logo() : 'assets/img/logo-inventcloud-white.svg', 'data-logo': true, alt: 'inventCloud', class: 'auth-logo' }),
      h('h1', { class: 'auth-title', id: 'auth-title' }, mode === 'setup' ? 'Configuração inicial' : 'Entrar no Book Técnico'),
      form
    ]));
    setTimeout(() => (mode === 'setup' ? name : user).focus(), 30);
  }
  function msLogo() {
    const s = h('span', { class: 'ms-logo', 'aria-hidden': 'true' });
    ['#f25022', '#7fba00', '#00a4ef', '#ffb900'].forEach((c) => { const q = h('i'); q.style.background = c; s.appendChild(q); });
    return s;
  }

  BT.auth = A;
})(window.BT);
