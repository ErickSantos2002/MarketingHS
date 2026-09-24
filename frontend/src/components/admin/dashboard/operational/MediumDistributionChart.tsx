import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { tooltip, legenda, serie } from '@/lib/chartTheme';

interface MediumPerformance {
  medium: string;
  total: number;
  hot: number;
  hotRate: number;
}

interface MediumDistributionChartProps {
  data: MediumPerformance[];
}

export function MediumDistributionChart({ data }: MediumDistributionChartProps) {
  // Filter and prepare data
  const chartData = data
    .filter(d => d.medium && d.medium !== 'null')
    .map((item, index) => ({
      name: item.medium || 'Direto',
      value: item.total,
      hot: item.hot,
      hotRate: item.hotRate,
      color: serie(index),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
          <p className="font-medium text-foreground mb-1">{data.name}</p>
          <div className="text-sm space-y-0.5">
            <p className="text-muted-foreground">Total: {data.value}</p>
            <p style={{ color: 'var(--color-success-500)' }}>Hot: {data.hot} ({data.hotRate.toFixed(1)}%)</p>
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
    <Card>
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
                fill={serie(0)}
                dataKey="value"
                stroke="var(--background)"
                strokeWidth={2}
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip {...tooltip} content={<CustomTooltip />} />
              <Legend
                {...legenda}
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
