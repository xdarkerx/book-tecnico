/* ═══ Barramento de eventos (pub/sub) ═══ */
(function (BT) {
  const map = {};
  BT.core.events = {
    on(evt, fn) { (map[evt] = map[evt] || []).push(fn); return () => this.off(evt, fn); },
    off(evt, fn) { map[evt] = (map[evt] || []).filter((f) => f !== fn); },
    emit(evt, payload) { (map[evt] || []).slice().forEach((fn) => { try { fn(payload); } catch (e) { console.error('[evento ' + evt + ']', e); } }); }
  };
  BT.on = BT.core.events.on.bind(BT.core.events);
  BT.emit = BT.core.events.emit.bind(BT.core.events);
})(window.BT);
