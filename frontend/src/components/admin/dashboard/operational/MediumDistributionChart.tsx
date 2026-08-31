import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

interface MediumPerformance {
  medium: string;
  total: number;
  hot: number;
  hotRate: number;
}

interface MediumDistributionChartProps {
  data: MediumPerformance[];
}

const COLORS = [
  'hsl(var(--accent))',            // dn.ia red
  'hsl(var(--primary))',            // dn.ia blue
  'hsl(142, 71%, 45%)', // emerald
  'hsl(48, 96%, 53%)',  // yellow
  'hsl(280, 65%, 60%)', // purple
  'hsl(180, 60%, 50%)', // cyan
  'hsl(340, 75%, 55%)', // pink
  'hsl(240, 5%, 65%)',  // gray
];

export function MediumDistributionChart({ data }: MediumDistributionChartProps) {
  // Filter and prepare data
  const chartData = data
    .filter(d => d.medium && d.medium !== 'null')
    .map((item, index) => ({
      name: item.medium || 'Direto',
      value: item.total,
      hot: item.hot,
      hotRate: item.hotRate,
      color: COLORS[index % COLORS.length],
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-popover/95 backdrop-blur-sm border border-border rounded-lg p-3 shadow-xl">
          <p className="font-medium text-foreground mb-1">{data.name}</p>
          <div className="text-sm space-y-0.5">
            <p className="text-muted-foreground">Total: {data.value}</p>
            <p className="text-emerald-400">Hot: {data.hot} ({data.hotRate.toFixed(1)}%)</p>
          </div>
        </div>
      );
    }
    return null;
  };

  const renderCustomLabel = ({ name, percent }: any) => {
    if (percent < 0.05) return null; // Hide labels for small slices
    return `${(percent * 100).toFixed(0)}%`;
  };

  return (
    <Card className="bg-card/50 backdrop-blur-sm border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">Distribuição por Medium</CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={renderCustomLabel}
                outerRadius={80}
                innerRadius={40}
                fill="#8884d8"
                dataKey="value"
                stroke="hsl(var(--background))"
                strokeWidth={2}
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend
                layout="vertical"
                align="right"
                verticalAlign="middle"
                formatter={(value: string) => (
                  <span className="text-xs text-muted-foreground">
                    {value.length > 12 ? value.slice(0, 12) + '...' : value}
                  </span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[280px] flex items-center justify-center text-muted-foreground">
            Nenhum dado de medium disponível
          </div>
        )}
      </CardContent>
    </Card>
  );
}
