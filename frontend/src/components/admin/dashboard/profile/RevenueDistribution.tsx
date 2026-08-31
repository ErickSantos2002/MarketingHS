import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { DollarSign } from 'lucide-react';

interface RevenueDistributionProps {
  data: Array<{ faturamento: string; count: number; percentage: number }>;
}

const COLORS = ['#10B981', '#34D399', '#6EE7B7', '#A7F3D0', '#D1FAE5', '#ECFDF5', '#F0FDF4'];

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-background/95 backdrop-blur-lg border border-border/50 rounded-xl px-4 py-3 shadow-xl">
        <p className="text-sm font-medium text-foreground">{data.faturamento}</p>
        <p className="text-sm text-muted-foreground mt-1">
          <span className="text-emerald-400 font-semibold">{data.count}</span> leads ({data.percentage.toFixed(1)}%)
        </p>
      </div>
    );
  }
  return null;
};

export function RevenueDistribution({ data }: RevenueDistributionProps) {
  const chartData = useMemo(() => {
    return data.map((item) => ({
      ...item,
      shortLabel: item.faturamento
        .replace('De R$ ', 'R$')
        .replace('Até R$ ', '< R$')
        .replace('Acima de R$ ', '> R$')
        .replace('/ano', '')
        .replace(' milhões', 'M')
        .replace(' milhão', 'M')
        .replace(' mil', 'K'),
    }));
  }, [data]);

  return (
    <Card className="bg-gradient-to-br from-card via-card to-emerald-950/10 border-border/50 shadow-lg overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <div className="p-2 rounded-lg bg-emerald-500/20">
            <DollarSign className="h-5 w-5 text-emerald-400" />
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
                  <stop offset="0%" stopColor="#10B981" stopOpacity={0.8} />
                  <stop offset="100%" stopColor="#34D399" stopOpacity={0.9} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} horizontal={false} />
              <XAxis type="number" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis 
                dataKey="shortLabel" 
                type="category" 
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} 
                axisLine={false} 
                tickLine={false}
                width={70}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--accent))', opacity: 0.1 }} />
              <Bar 
                dataKey="count" 
                radius={[0, 6, 6, 0]}
                maxBarSize={24}
              >
                {chartData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
