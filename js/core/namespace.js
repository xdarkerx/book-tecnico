/* ═══ Namespace global do app ═══
   Scripts clássicos (sem ES modules) para o projeto abrir com duplo-clique
   via file:// — cada arquivo registra seu módulo em window.BT. */
window.BT = window.BT || {
  core: {}, data: {}, ui: {}, blocks: {}, importer: { mappers: {} },
  book: {}, exporters: {}, editor: {}
};
