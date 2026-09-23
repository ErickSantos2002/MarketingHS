// Tema único dos gráficos. Antes, cada gráfico escolhia a própria cor — foi
// assim que o painel acumulou hexadecimal solto. Tudo aqui sai de token, e as
// cores trocam sozinhas com o tema porque são var() lidas pelo SVG.
export const SERIES = [
  'var(--grafico-1)', 'var(--grafico-2)', 'var(--grafico-3)',
  'var(--grafico-4)', 'var(--grafico-5)', 'var(--grafico-6)',
] as const;

export const serie = (i: number) => SERIES[i % SERIES.length];

export const eixo = {
  stroke: 'var(--border-color)',
  tick: { fill: 'var(--text-muted)', fontSize: 12 },
  tickLine: { stroke: 'var(--border-color)' },
  axisLine: { stroke: 'var(--border-color)' },
} as const;

export const grade = {
  stroke: 'var(--border-muted)',
  strokeDasharray: '3 3',
} as const;

export const tooltip = {
  contentStyle: {
    background: 'var(--surface)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-lg)',
    color: 'var(--text-body)',
    fontSize: 12,
  },
  labelStyle: { color: 'var(--text-heading)', fontWeight: 600 },
  cursor: { fill: 'var(--surface-elevated)' },
} as const;

export const legenda = {
  wrapperStyle: { fontSize: 12, color: 'var(--text-muted)' },
} as const;
