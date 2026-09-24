import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { PieChartIcon } from 'lucide-react';
import { tooltip, legenda, serie } from '@/lib/chartTheme';

interface DistributionPieChartProps {
  data: { tipo: string; count: number; percentage: number }[];
  title?: string;
}

export function DistributionPieChart({ data, title = "Distribuição por Modal" }: DistributionPieChartProps) {
  if (data.length === 0) {
    return (
      <div className="bg-card border rounded-xl p-6">
        <div className="flex items-center gap-2 mb-6">
          <PieChartIcon className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        </div>
        <div className="h-[300px] flex items-center justify-center text-muted-foreground">
          Nenhum dado disponível
        </div>
      </div>
    );
  }

  const total = data.reduce((sum, item) => sum + item.count, 0);

  return (
    <div className="bg-card border rounded-xl p-6">
      <div className="flex items-center gap-2 mb-6">
        <PieChartIcon className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      </div>

      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={100}
              paddingAngle={3}
              dataKey="count"
              nameKey="tipo"
              stroke="none"
            >
              {data.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={serie(index)}
                />
              ))}
            </Pie>
            <Tooltip
              {...tooltip}
              formatter={(value: number, name: string) => [
                `${value.toLocaleString('pt-BR')} (${((value / total) * 100).toFixed(1)}%)`,
                name,
              ]}
            />
            <Legend
              {...legenda}
              verticalAlign="bottom"
              height={36}
              formatter={(value) => (
                <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{value}</span>
              )}
            />
            {/* Center label */}
            <text
              x="50%"
              y="50%"
              textAnchor="middle"
              dominantBaseline="middle"
              fill="var(--text-heading)"
              fontSize={24}
              fontWeight="bold"
            >
              {total.toLocaleString('pt-BR')}
            </text>
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
