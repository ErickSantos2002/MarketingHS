import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Briefcase } from 'lucide-react';
import { getDecisionPowerLevel } from '@/hooks/useLeadQualification';

interface RoleDistributionProps {
  data: Array<{ cargo: string; count: number; percentage: number }>;
}

const LEVEL_COLORS: Record<string, string> = {
  'C-Level': 'hsl(var(--primary))',      // Azul dn.ia (topo da hierarquia)
  'Direção': '#5a4fea',      // Azul-roxo
  'Gerência': '#8B5CF6',     // Roxo (intermediário)
  'Especialista': '#b83d8a', // Vermelho-roxo
  'Analista': 'hsl(var(--accent))',     // Vermelho dn.ia (base)
  'Não identificado': '#6B7280',
};

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-background/95 backdrop-blur-lg border border-border/50 rounded-xl px-4 py-3 shadow-xl">
        <p className="text-sm font-medium text-foreground">{data.cargo}</p>
        <p className="text-xs text-muted-foreground mt-0.5">Nível: {data.level}</p>
        <p className="text-sm text-muted-foreground mt-1">
          <span className="text-primary font-semibold">{data.count}</span> leads ({data.percentage.toFixed(1)}%)
        </p>
      </div>
    );
  }
  return null;
};

export function RoleDistribution({ data }: RoleDistributionProps) {
  const chartData = useMemo(() => {
    return data.slice(0, 10).map((item) => ({
      ...item,
      level: getDecisionPowerLevel(item.cargo),
      shortCargo: item.cargo.length > 20 ? item.cargo.substring(0, 18) + '...' : item.cargo,
    }));
  }, [data]);

  return (
    <Card className="bg-gradient-to-br from-card via-card to-primary/10 border-border/50 shadow-lg overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <div className="p-2 rounded-lg bg-primary/20">
            <Briefcase className="h-5 w-5 text-primary" />
          </div>
          Top 10 Cargos
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ top: 10, right: 30, left: 100, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} horizontal={false} />
              <XAxis type="number" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis 
                dataKey="shortCargo" 
                type="category" 
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} 
                axisLine={false} 
                tickLine={false}
                width={90}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--accent))', opacity: 0.1 }} />
              <Bar dataKey="count" radius={[0, 6, 6, 0]} maxBarSize={24}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={LEVEL_COLORS[entry.level] || '#6B7280'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap gap-2 mt-4 justify-center">
          {Object.entries(LEVEL_COLORS).map(([level, color]) => (
            <div key={level} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
              {level}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
