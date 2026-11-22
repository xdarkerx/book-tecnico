/* ═══ Mapa de badges (valores → cor) usado em colunas marcadas como "badge" ═══
   r=vermelho, y=amarelo, g=verde/azul claro, b=roxo, x=cinza */
(function (BT) {
  const BKM = {
    'Disaster': 'r', 'High': 'y', 'Alta': 'r', 'Crítico': 'r', 'Critico': 'r', 'Critical': 'r', 'Average': 'x', 'Warning': 'b',
    'Média': 'y', 'Médio': 'y', 'Baixo': 'g', 'Baixa': 'g', 'Normal': 'g', 'Ativo': 'g', 'Inativo': 'x', 'Desligado': 'x',
    'Manutenção': 'y', 'Sim': 'g', 'Não': 'r', 'Parcial': 'y', 'Pendente': 'y', 'Resolvido': 'g', 'Em andamento': 'y',
    'Em tratamento': 'y', 'Aceito': 'b', 'Atenção': 'y', 'Crescendo': 'y', 'Estável': 'g', 'Diminuindo': 'b', 'Alto': 'r',
    'Válida': 'g', 'Expirada': 'r', 'Concluído': 'g', 'Planejado': 'b', 'Running': 'g', 'Stopped': 'x', 'OK': 'g',
    'Novo': 'b', 'Fechado': 'g', 'Muito alta': 'r', 'Muito baixa': 'g', 'Incidente': 'y', 'Requisição': 'b'
  };
  const CLS = { r: 'br', y: 'by', g: 'bg_', b: 'bb', x: 'bx' };
  BT.data.badgeClass = (v) => CLS[BKM[String(v).trim()] || 'x'];
  BT.data.badge = (v) => {
    const s = String(v ?? '').trim();
    return s ? `<span class="bk ${BT.data.badgeClass(s)}">${BT.esc(s)}</span>` : '—';
  };
  /** Cores sólidas equivalentes (para o Word, que não lê classes de forma confiável). */
  BT.data.badgeColors = {
    br: ['#fbe8ef', '#DC5282'], by: ['#fdf3dc', '#b7860b'], bg_: ['#e7f5fb', '#3c9cc4'], bb: ['#ece8fc', '#5E3FE1'], bx: ['#f0f1f5', '#7a809a']
  };
})(window.BT);
