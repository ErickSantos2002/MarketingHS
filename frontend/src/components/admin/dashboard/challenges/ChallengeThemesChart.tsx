import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Lightbulb, Cpu, BookOpen, Wrench, Database, Zap, Target, Users, HelpCircle } from 'lucide-react';

interface ChallengeThemesChartProps {
  data: Array<{ theme: string; count: number; percentage: number }>;
}

const THEME_CONFIG: Record<string, { color: string; icon: React.ComponentType<{ className?: string }> }> = {
  'IA/Automação': { color: 'hsl(var(--accent))', icon: Cpu },         // Vermelho (tema CORE)
  'Conhecimento': { color: 'hsl(var(--primary))', icon: BookOpen },     // Azul (tema principal)
  'Ferramentas': { color: '#e63946', icon: Wrench },        // Vermelho suave
  'Dados': { color: '#5a7fff', icon: Database },            // Azul suave
  'Execução': { color: '#c1121f', icon: Zap },              // Vermelho escuro
  'Produtividade': { color: '#4d6bfe', icon: Target },      // Azul médio
  'Estratégia': { color: '#8B5CF6', icon: Lightbulb },      // Roxo (blend)
  'Equipe': { color: '#a855f7', icon: Users },              // Roxo claro
  'Outros': { color: '#6B7280', icon: HelpCircle },
};

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-background/95 backdrop-blur-lg border border-border/50 rounded-xl px-4 py-3 shadow-xl">
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
      color: THEME_CONFIG[item.theme]?.color || '#6B7280',
    }));
  }, [data]);

  return (
    <Card className="bg-gradient-to-br from-card via-card to-accent/10 border-border/50 shadow-lg overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <div className="p-2 rounded-lg bg-accent/20">
            <Lightbulb className="h-5 w-5 text-accent" />
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
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} horizontal={false} />
              <XAxis type="number" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis 
                dataKey="theme" 
                type="category" 
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} 
                axisLine={false} 
                tickLine={false}
                width={90}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--accent))', opacity: 0.1 }} />
              <Bar dataKey="count" radius={[0, 8, 8, 0]} maxBarSize={28}>
                {chartData.map((entry, index) => (
                  <Cell 
                    key={`cell-${index}`} 
                    fill={`url(#themeGradient-${entry.theme.replace('/', '-')})`}
                    className="drop-shadow-sm"
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
