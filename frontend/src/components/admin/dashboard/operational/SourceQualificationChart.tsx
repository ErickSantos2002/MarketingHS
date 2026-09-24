import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell } from 'recharts';
import { eixo, grade, tooltip, legenda } from '@/lib/chartTheme';

// Hot/Warm/Raw é status de qualificação do lead (getQualificationColor em
// useLeadQualification.tsx), não série arbitrária — a cor tem de bater com
// o resto do app: verde/amarelo/neutro, nessa ordem, sempre.
const COR_HOT = 'var(--color-success-500)';
const COR_WARM = 'var(--color-warning-500)';
const COR_RAW = 'var(--color-slate-400)';

interface SourcePerformance {
  source: string;
  total: number;
  hot: number;
  warm: number;
  raw: number;
  hotRate: number;
}

interface SourceQualificationChartProps {
  data: SourcePerformance[];
}

export function SourceQualificationChart({ data }: SourceQualificationChartProps) {
  // Take top 8 sources by total leads
  const chartData = [...data]
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)
    .map(item => ({
      name: item.source.length > 12 ? item.source.slice(0, 12) + '...' : item.source,
      fullName: item.source,
      Hot: item.hot,
      Warm: item.warm,
      Raw: item.raw,
      total: item.total,
      hotRate: item.hotRate,
    }));

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
          <p className="font-medium text-foreground mb-2">{data.fullName}</p>
          <div className="space-y-1 text-sm">
            <p style={{ color: COR_HOT }}>Hot: {data.Hot} ({((data.Hot / data.total) * 100).toFixed(1)}%)</p>
            <p style={{ color: COR_WARM }}>Warm: {data.Warm} ({((data.Warm / data.total) * 100).toFixed(1)}%)</p>
            <p style={{ color: COR_RAW }}>Raw: {data.Raw} ({((data.Raw / data.total) * 100).toFixed(1)}%)</p>
            <p className="text-muted-foreground mt-2 pt-2 border-t border-border">Total: {data.total}</p>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">Qualificação por Source</CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid {...grade} />
              <XAxis
                dataKey="name"
                interval={0}
                angle={-20}
                textAnchor="end"
                height={50}
                {...eixo}
              />
              <YAxis
                {...eixo}
              />
              <Tooltip {...tooltip} content={<CustomTooltip />} />
              <Legend
                {...legenda}
                wrapperStyle={{ ...legenda.wrapperStyle, paddingTop: '10px' }}
                formatter={(value) => <span className="text-xs text-muted-foreground">{value}</span>}
              />
              <Bar dataKey="Hot" stackId="a" fill={COR_HOT} radius={[0, 0, 0, 0]} />
              <Bar dataKey="Warm" stackId="a" fill={COR_WARM} radius={[0, 0, 0, 0]} />
              <Bar dataKey="Raw" stackId="a" fill={COR_RAW} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[280px] flex items-center justify-center text-muted-foreground">
            Nenhum dado disponível
          </div>
        )}
      </CardContent>
    </Card>
  );
}
