import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Lightbulb, Cpu, BookOpen, Wrench, Database, Zap, Target, Users, HelpCircle } from 'lucide-react';
import { eixo, grade, tooltip, serie } from '@/lib/chartTheme';

interface ChallengeThemesChartProps {
  data: Array<{ theme: string; count: number; percentage: number }>;
}

// 9 temas contra 6 cores de série: acima do índice 5 a cor se repete
// (serie(6)=serie(0), serie(7)=serie(1), serie(8)=serie(2)) — três pares
// de temas ficam com a mesma cor. Ver relatório da Tarefa 6.
const THEME_CONFIG: Record<string, { color: string; icon: React.ComponentType<{ className?: string }> }> = {
  'IA/Automação': { color: serie(0), icon: Cpu },
  'Conhecimento': { color: serie(1), icon: BookOpen },
  'Ferramentas': { color: serie(2), icon: Wrench },
  'Dados': { color: serie(3), icon: Database },
  'Execução': { color: serie(4), icon: Zap },
  'Produtividade': { color: serie(5), icon: Target },
  'Estratégia': { color: serie(6), icon: Lightbulb },
  'Equipe': { color: serie(7), icon: Users },
  'Outros': { color: serie(8), icon: HelpCircle },
};

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-background/95 border border-border/50 rounded-xl px-4 py-3 shadow-xl">
        <p className="text-sm font-medium text-foreground">{data.theme}</p>
        <p className="text-sm text-muted-foreground mt-1">
          <span className="font-semibold" style={{ color: data.color }}>{data.count}</span> leads ({data.percentage.toFixed(1)}%)
        </p>
      </div>
    );
  }
  return null;
};

export function ChallengeThemesChart({ data }: ChallengeThemesChartProps) {
  const chartData = useMemo(() => {
    return data.map((item) => ({
      ...item,
      color: THEME_CONFIG[item.theme]?.color || serie(0),
    }));
  }, [data]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <div className="p-2 rounded-lg bg-[--tint-info]">
            <Lightbulb className="h-5 w-5 text-info" />
          </div>
          Temas de Desafios
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[350px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ top: 10, right: 30, left: 100, bottom: 10 }}>
              <defs>
                {Object.entries(THEME_CONFIG).map(([theme, config]) => (
                  <linearGradient key={theme} id={`themeGradient-${theme.replace('/', '-')}`} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor={config.color} stopOpacity={0.8} />
                    <stop offset="100%" stopColor={config.color} stopOpacity={0.5} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid {...grade} horizontal={false} />
              <XAxis type="number" {...eixo} />
              <YAxis
                dataKey="theme"
                type="category"
                width={90}
                {...eixo}
              />
              <Tooltip {...tooltip} content={<CustomTooltip />} />
              <Bar dataKey="count" radius={[0, 8, 8, 0]} maxBarSize={28}>
                {chartData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={`url(#themeGradient-${entry.theme.replace('/', '-')})`}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        
        {/* Theme Icons Legend */}
        <div className="flex flex-wrap gap-3 mt-4 justify-center">
        {Object.entries(THEME_CONFIG).map(([theme, { color, icon: Icon }]) => (
          <div key={theme} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Icon className={`h-3.5 w-3.5`} />
            <span>{theme}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
