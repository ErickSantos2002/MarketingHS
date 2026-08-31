import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { PieChartIcon } from 'lucide-react';

interface DistributionPieChartProps {
  data: { tipo: string; count: number; percentage: number }[];
  title?: string;
}

const COLORS = [
  'hsl(var(--accent))',              // dn.ia Red
  'hsl(var(--primary))',              // dn.ia Blue
  'hsl(142, 76%, 36%)',   // Green
  '#ffffff',              // White
  'hsl(280, 87%, 65%)',   // Purple
  'hsl(47, 100%, 50%)',   // Yellow
  'hsl(180, 70%, 45%)',   // Cyan
];

export function DistributionPieChart({ data, title = "Distribuição por Modal" }: DistributionPieChartProps) {
  if (data.length === 0) {
    return (
      <div className="glass-card p-6">
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
    <div className="glass-card p-6">
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
                  fill={COLORS[index % COLORS.length]}
                  style={{
                    filter: 'drop-shadow(0 0 8px rgba(222, 26, 17, 0.3))',
                  }}
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(0, 0%, 10%)',
                border: '1px solid hsl(0, 0%, 20%)',
                borderRadius: '8px',
                boxShadow: '0 10px 40px -10px rgba(222, 26, 17, 0.3)',
              }}
              formatter={(value: number, name: string) => [
                `${value.toLocaleString('pt-BR')} (${((value / total) * 100).toFixed(1)}%)`,
                name,
              ]}
            />
            <Legend
              verticalAlign="bottom"
              height={36}
              formatter={(value) => (
                <span style={{ color: 'hsl(0, 0%, 80%)', fontSize: '12px' }}>{value}</span>
              )}
            />
            {/* Center label */}
            <text
              x="50%"
              y="50%"
              textAnchor="middle"
              dominantBaseline="middle"
              fill="hsl(0, 0%, 100%)"
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
