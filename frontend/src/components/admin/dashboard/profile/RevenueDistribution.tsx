import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { DollarSign } from 'lucide-react';
import { eixo, grade, tooltip, serie } from '@/lib/chartTheme';

interface RevenueDistributionProps {
  data: Array<{ faturamento: string; count: number; percentage: number }>;
}

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-popover border border-border rounded-xl px-4 py-3 shadow-lg">
        <p className="text-sm font-medium text-foreground">{data.faturamento}</p>
        <p className="text-sm text-muted-foreground mt-1">
          <span className="font-semibold" style={{ color: data.color }}>{data.count}</span> leads ({data.percentage.toFixed(1)}%)
        </p>
      </div>
    );
  }
  return null;
};

export function RevenueDistribution({ data }: RevenueDistributionProps) {
  const chartData = useMemo(() => {
    return data.map((item, index) => ({
      ...item,
      shortLabel: item.faturamento
        .replace('De R$ ', 'R$')
        .replace('Até R$ ', '< R$')
        .replace('Acima de R$ ', '> R$')
        .replace('/ano', '')
        .replace(' milhões', 'M')
        .replace(' milhão', 'M')
        .replace(' mil', 'K'),
      color: serie(0),
      opacity: data.length > 1 ? 0.4 + (index / (data.length - 1)) * 0.6 : 1,
    }));
  }, [data]);

  return (
    <Card className="bg-card border-border/50 overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <div className="p-2 rounded-lg bg-[--tint-primary]">
            <DollarSign className="h-5 w-5 text-primary" />
          </div>
          Distribuição por Faturamento
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ top: 10, right: 30, left: 80, bottom: 10 }}>
              <defs>
                <linearGradient id="revenueGradient" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={serie(0)} stopOpacity={0.8} />
                  <stop offset="100%" stopColor={serie(0)} stopOpacity={0.9} />
                </linearGradient>
              </defs>
              <CartesianGrid {...grade} horizontal={false} />
              <XAxis type="number" {...eixo} />
              <YAxis
                dataKey="shortLabel"
                type="category"
                width={70}
                {...eixo}
              />
              <Tooltip {...tooltip} content={<CustomTooltip />} />
              <Bar
                dataKey="count"
                radius={[0, 6, 6, 0]}
                maxBarSize={24}
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} fillOpacity={entry.opacity} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
