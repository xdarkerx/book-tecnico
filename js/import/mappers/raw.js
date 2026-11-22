/* ═══ Mapeador: planilha original (sem normalização) ═══
   Mantém as colunas do arquivo; você escolhe quais entram e renomeia. */
(function (BT) {
  BT.importer.mappers.raw = {
    key: 'raw', label: 'Planilha original', icon: '▦', order: 9,
    desc: 'Usa as colunas do arquivo como estão — escolha e renomeie',
    section: null,
    columns: null, // definidas dinamicamente a partir do arquivo
    dynamicColumns(sheet) { return sheet.fields.map((f, i) => ({ key: f, name: f, on: sheet.fields.length <= 10 || i < 8 })); },
    map(sheet) { return sheet.rows.map((r) => Object.assign({}, r)); },
    summary(items) { return [{ label: 'Registros', value: String(items.length) }]; }
  };
})(window.BT);
