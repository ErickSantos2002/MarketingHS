import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { BarChart3 } from 'lucide-react';

interface SourceBarChartProps {
  data: { source: string; count: number; percentage: number }[];
}

export function SourceBarChart({ data }: SourceBarChartProps) {
  if (data.length === 0) {
    return (
      <div className="glass-card p-6">
        <div className="flex items-center gap-2 mb-6">
          <BarChart3 className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">Distribuição por Source</h3>
        </div>
        <div className="h-[300px] flex items-center justify-center text-muted-foreground">
          Nenhum dado disponível
        </div>
      </div>
    );
  }

  // Take top 8 sources
  const chartData = data.slice(0, 8);

  return (
    <div className="glass-card p-6">
      <div className="flex items-center gap-2 mb-6">
        <BarChart3 className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold text-foreground">Distribuição por Source</h3>
      </div>

      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="sourceBarGradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="hsl(var(--accent))" />
                <stop offset="100%" stopColor="hsl(var(--primary))" />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 20%)" horizontal={false} />
            <XAxis
              type="number"
              stroke="hsl(0, 0%, 50%)"
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              dataKey="source"
              type="category"
              stroke="hsl(0, 0%, 50%)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              width={100}
              tickFormatter={(value) => value.length > 15 ? `${value.slice(0, 15)}...` : value}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(0, 0%, 10%)',
                border: '1px solid hsl(0, 0%, 20%)',
                borderRadius: '8px',
                boxShadow: '0 10px 40px -10px rgba(222, 26, 17, 0.3)',
              }}
              formatter={(value: number) => [value.toLocaleString('pt-BR'), 'Leads']}
              cursor={{ fill: 'hsl(0, 0%, 15%)' }}
            />
            <Bar
              dataKey="count"
              fill="url(#sourceBarGradient)"
              radius={[0, 4, 4, 0]}
              maxBarSize={30}
            >
              {chartData.map((_, index) => (
                <Cell
                  key={`cell-${index}`}
                  style={{
                    filter: 'drop-shadow(0 0 6px rgba(222, 26, 17, 0.2))',
                  }}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
