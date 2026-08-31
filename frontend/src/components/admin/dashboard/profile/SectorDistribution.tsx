import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { Building2 } from 'lucide-react';

interface SectorDistributionProps {
  data: Array<{ sector: string; count: number; percentage: number }>;
}

const COLORS = [
  'hsl(var(--accent))', 'hsl(var(--primary))', '#10B981', '#F7C94B', '#8B5CF6', 
  '#EC4899', '#F59E0B', '#06B6D4', '#84CC16', '#6B7280'
];

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-background/95 backdrop-blur-lg border border-border/50 rounded-xl px-4 py-3 shadow-xl">
        <p className="text-sm font-medium text-foreground">{data.sector}</p>
        <p className="text-sm text-muted-foreground mt-1">
          <span className="text-primary font-semibold">{data.count}</span> leads ({data.percentage.toFixed(1)}%)
        </p>
      </div>
    );
  }
  return null;
};

export function SectorDistribution({ data }: SectorDistributionProps) {
  const chartData = useMemo(() => {
    const topSectors = data.slice(0, 8);
    const othersCount = data.slice(8).reduce((sum, item) => sum + item.count, 0);
    
    if (othersCount > 0) {
      const total = data.reduce((sum, item) => sum + item.count, 0);
      topSectors.push({
        sector: 'Outros',
        count: othersCount,
        percentage: (othersCount / total) * 100,
      });
    }
    
    return topSectors;
  }, [data]);

  const total = chartData.reduce((sum, item) => sum + item.count, 0);

  return (
    <Card className="bg-gradient-to-br from-card via-card to-primary/10 border-border/50 shadow-lg overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <div className="p-2 rounded-lg bg-primary/20">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          Setores Identificados
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] relative">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <defs>
                {COLORS.map((color, index) => (
                  <linearGradient key={`gradient-${index}`} id={`sectorGradient${index}`} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.9} />
                    <stop offset="100%" stopColor={color} stopOpacity={0.6} />
                  </linearGradient>
                ))}
              </defs>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={3}
                dataKey="count"
                nameKey="sector"
                animationBegin={0}
                animationDuration={800}
              >
                {chartData.map((_, index) => (
                  <Cell 
                    key={`cell-${index}`} 
                    fill={`url(#sectorGradient${index})`}
                    stroke="transparent"
                    className="transition-all duration-200 hover:opacity-80"
                  />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend 
                layout="vertical" 
                align="right" 
                verticalAlign="middle"
                iconType="circle"
                iconSize={8}
                formatter={(value) => <span className="text-xs text-muted-foreground">{value}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ paddingRight: '120px' }}>
            <div className="text-center">
              <div className="text-3xl font-bold text-foreground">{total}</div>
              <div className="text-xs text-muted-foreground">Total</div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
