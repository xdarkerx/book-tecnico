/* ═══ Bloqueio de edição no navegador (servidor: server/auth/locks.js) ═══
 * Ligado em ⚙️ Configurações › Edição simultânea (exige login).
 *  - Dono do book: manda "sinal de vida" a cada 20 s (com "ativo" se mexeu em algo). Se alguém pedir o book,
 *    aparece um aviso para liberar ou continuar; sem resposta no prazo, a outra pessoa pode assumir.
 *  - Outra pessoa: vê o book em somente leitura, com quem está editando e a última atividade,
 *    e pode pedir para editar / assumir depois do prazo.
 */
(function (BT) {
  const h = BT.h;
  const BEAT_MS = 20000, POLL_MS = 5000;
  let book = null, mode = 'off'; // off | owner | viewer
  let beat = null, poll = null, tick = null, activeSinceBeat = false, asked = null, lastView = null, askTimer = null;

  const enabled = () => BT.api.mode === 'server' && BT.auth && BT.auth.lockEnabled;
  const banner = () => document.getElementById('lock-banner');
  const minutesLeft = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  /** "há 3 h", "há 12 min", "agora" */
  function ago(ts) {
    if (!ts) return '—';
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'agora'; if (m < 60) return `há ${m} min`;
    const hr = Math.round(m / 60); if (hr < 24) return `há ${hr} h`;
    return `há ${Math.round(hr / 24)} dia(s)`;
  }
  const hhmm = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  function stop() {
    clearInterval(beat); clearInterval(poll); clearInterval(tick);
    beat = poll = tick = null;
    const b = banner(); if (b) b.remove();
    setReadOnly(false);
    mode = 'off';
  }
  function setReadOnly(on) {
    BT.store.readOnly = on;
    document.body.classList.toggle('bk-readonly', on);
    ['view', 'palette'].forEach((id) => { const el = document.getElementById(id); if (el) el.inert = on; });
    document.querySelectorAll('.sb-actions, #dd-import').forEach((el) => { el.inert = on; });
  }

  /** Ao abrir um book: tenta ficar com ele. */
  async function enter(id) {
    if (book && book !== id && mode === 'owner') BT.api.lock('release', book).catch(() => {}); // trocou de book
    stop();
    book = id;
    if (!enabled() || !id) return;
    setReadOnly(true); // até o servidor confirmar
    try {
      const v = await BT.api.lock('acquire', id);
      if (book !== id) return; // abriu outro book no meio do caminho
      if (v.acquired || v.mine) becomeOwner();
      else becomeViewer(v);
    } catch (e) { if (e.status !== 401) { setReadOnly(false); BT.ui.toast('Não foi possível verificar o bloqueio do book: ' + e.message, { type: 'err' }); } }
  }
  /** Ao sair do book (lista de clientes, outro book, logout). */
  async function leave() {
    const id = book, was = mode;
    stop(); book = null;
    if (id && was === 'owner' && enabled()) { try { await BT.api.lock('release', id); } catch (e) { /* expira sozinho */ } }
  }

  // ── dono ────────────────────────────────────────────────
  function becomeOwner() {
    mode = 'owner'; setReadOnly(false); asked = null;
    const b = banner(); if (b) b.remove();
    activeSinceBeat = true;
    beat = setInterval(heartbeat, BEAT_MS);
  }
  async function heartbeat() {
    if (mode !== 'owner' || !book) return;
    try {
      const v = await BT.api.lock('heartbeat', book, { active: activeSinceBeat });
      activeSinceBeat = false;
      if (v.lost) { lost(v.owner && v.owner.name); return; }
      if (v.request && v.request.status === 'pending' && !v.request.byMe && asked !== v.request.at) { asked = v.request.at; askOwner(v); }
    } catch (e) { /* rede: tenta no próximo */ }
  }
  /** Alguém pediu o book: liberar ou continuar? */
  function askOwner(v) {
    const r = v.request;
    const left = h('b', {}, minutesLeft(r.deadline - Date.now()));
    const t = setInterval(() => { left.textContent = minutesLeft(r.deadline - Date.now()); }, 1000);
    const answer = async (allow) => {
      clearInterval(t); m.close();
      try {
        if (allow) { await BT.store.saveNow(); await BT.api.lock('respond', book, { allow: true }); BT.ui.toast(`Book liberado para ${r.name}.`, { type: 'ok' }); await check(); }
        else { await BT.api.lock('respond', book, { allow: false }); BT.ui.toast('Você continua editando.', { type: 'ok' }); }
      } catch (e) { BT.ui.toast(e.message, { type: 'err' }); }
    };
    const m = BT.ui.modal.open({
      title: '✋ Pedido para editar este book',
      dismissable: false,
      body: [
        h('p', { class: 'lock-ask' }, [h('b', {}, r.name), ' quer editar este book agora.']),
        h('p', { class: 'lock-ask muted' }, ['Se você não responder em ', left, ', ', r.name, ' poderá assumir a edição e você será desconectado. O que já foi digitado fica salvo.'])
      ],
      onClose: () => { clearInterval(t); },
      footer: [
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => answer(true) }, `Liberar para ${r.name}`),
        h('button', { class: 'btn btn-primary btn-sm', onclick: () => answer(false) }, 'Continuar editando')
      ]
    });
    askTimer = t; // o próximo sinal de vida fecha o aviso se a outra pessoa assumir
    try { if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification('Book Técnico', { body: `${r.name} quer editar o book que você está editando.` }); } catch (e) { /* sem notificação */ }
  }
  function lost(name) {
    clearInterval(askTimer);
    document.querySelectorAll('.modal-wrap').forEach((w) => { if (w.textContent.includes('Pedido para editar')) w.remove(); });
    BT.ui.toast(`${name || 'Outra pessoa'} assumiu a edição deste book.`, { type: 'err', ms: 8000 });
    check();
  }

  // ── somente leitura ────────────────────────────────────
  function becomeViewer(v) {
    mode = 'viewer'; setReadOnly(true);
    lastView = v; drawBanner(v);
    clearInterval(poll); poll = setInterval(check, POLL_MS);
    clearInterval(tick); tick = setInterval(() => lastView && drawBanner(lastView), 1000);
  }
  /** Consulta o bloqueio de novo; se ficou livre ou passou para mim, reabre o book com o conteúdo atual. */
  async function check() {
    if (!book) return;
    try {
      const v = await BT.api.lockStatus(book);
      if (!v.locked || v.mine) { const id = book; stop(); BT.ui.toast('Agora você pode editar este book.', { type: 'ok' }); return BT.editor.nav.openBook(BT.api.keyOf(id)); }
      if (mode !== 'viewer') becomeViewer(v); else { lastView = v; drawBanner(v); }
    } catch (e) { /* tenta de novo */ }
  }

  /** Redesenha só quando o estado muda (botões estáveis para o clique); o relógio é atualizado no lugar. */
  function drawBanner(v) {
    let b = banner();
    if (!b) { b = h('div', { class: 'lock-banner', id: 'lock-banner', role: 'status' }); const ws = document.querySelector('.workspace'); ws.parentNode.insertBefore(b, ws); }
    const r = v.request;
    const phase = !r ? 'none' : !r.byMe ? 'other-' + r.status : r.status === 'denied' ? 'denied' : Date.now() < r.deadline ? 'waiting' : 'expired';
    const key = [v.owner.name, v.since, ago(v.lastActive), phase, r && r.at].join('|');
    const clock = b.querySelector('[data-clock]');
    if (clock && r) clock.textContent = minutesLeft(r.deadline - Date.now());
    if (b.dataset.key === key) return;
    b.dataset.key = key;
    const who = v.owner.sameUser ? 'Você (em outra aba ou computador)' : v.owner.name;
    const info = h('div', { class: 'lock-info' }, [
      h('b', {}, `🔒 Somente leitura — ${who} está editando este book`),
      h('span', {}, `desde ${hhmm(v.since)} · última atividade ${ago(v.lastActive)}`)
    ]);
    let action = null, note = null;
    if (!r || (!r.byMe && r.status !== 'pending')) {
      action = h('button', { class: 'btn btn-primary btn-sm', onclick: () => ask() }, 'Pedir para editar');
    } else if (!r.byMe) {
      note = h('span', { class: 'lock-note' }, `${r.name} já pediu para editar.`);
    } else if (r.status === 'denied') {
      note = h('span', { class: 'lock-note' }, `${v.owner.name} recusou e continua editando.`);
      action = h('button', { class: 'btn btn-ghost btn-sm', onclick: () => ask() }, 'Pedir de novo');
    } else if (Date.now() < r.deadline) {
      note = h('span', { class: 'lock-note' }, ['Aguardando ', h('b', {}, v.owner.name), ' responder… ', h('b', { class: 'mono', 'data-clock': true }, minutesLeft(r.deadline - Date.now()))]);
      action = h('button', { class: 'btn btn-ghost btn-sm', disabled: true, title: `Disponível se ${v.owner.name} não responder em ${v.responseMinutes} min` }, 'Assumir edição');
    } else {
      note = h('span', { class: 'lock-note' }, `${v.owner.name} não respondeu em ${v.responseMinutes} min.`);
      action = h('button', { class: 'btn btn-danger btn-sm', onclick: () => takeOver(v) }, `Assumir edição (desconecta ${v.owner.name})`);
    }
    b.replaceChildren(info, h('div', { class: 'lock-act' }, [note, action]));
  }
  async function ask() {
    try { const v = await BT.api.lock('request', book); lastView = v; if (v.mine || !v.locked) return check(); drawBanner(v); BT.ui.toast(`Pedido enviado para ${v.owner.name}.`, { type: 'ok' }); }
    catch (e) { BT.ui.toast(e.message, { type: 'err' }); }
  }
  async function takeOver(v) {
    if (!(await BT.ui.modal.confirm(`Assumir a edição deste book? ${v.owner.name} será desconectado(a). O que ele(a) já digitou está salvo.`, { okText: 'Assumir edição', danger: true }))) return;
    try { await BT.api.lock('takeover', book); await check(); }
    catch (e) { BT.ui.toast(e.message, { type: 'err' }); await check(); }
  }

  // atividade do dono (vira "última atividade")
  ['keydown', 'mousedown', 'input', 'paste', 'drop'].forEach((ev) => document.addEventListener(ev, () => { activeSinceBeat = true; }, true));
  // o servidor recusou um salvamento (423): passa a somente leitura
  BT.on('store:locked', () => { if (mode === 'owner') lost(); });
  // fechar a aba: solta o book na hora (senão expira em ~90 s)
  window.addEventListener('pagehide', () => {
    if (mode === 'owner' && book) { try { fetch('/api/lock', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'release', book }) }); } catch (e) { /* expira sozinho */ } }
  });

  BT.lock = { enter, leave, stop, check, get mode() { return mode; }, ago };
})(window.BT);
