import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import type { ResponseQuality } from '@/hooks/useLeadAnalytics';
import { tooltip, legenda } from '@/lib/chartTheme';

interface ResponseQualityChartProps {
  quality: ResponseQuality;
}

// Qualidade de resposta é ordinal (alta → sem resposta) e a cor carrega esse
// significado — sucesso/aviso/perigo/neutro —, não é uma série qualquer.
const COLORS = {
  high: 'var(--color-success-500)',
  medium: 'var(--color-warning-500)',
  low: 'var(--color-danger-500)',
  none: 'var(--color-slate-400)',
};

export function ResponseQualityChart({ quality }: ResponseQualityChartProps) {
  const data = [
    { 
      name: 'Alta Qualidade', 
      value: quality.highQuality, 
      color: COLORS.high,
      description: '50+ caracteres'
    },
    { 
      name: 'Média Qualidade', 
      value: quality.mediumQuality, 
      color: COLORS.medium,
      description: '10-49 caracteres'
    },
    { 
      name: 'Baixa Qualidade', 
      value: quality.lowQuality, 
      color: COLORS.low,
      description: '<10 caracteres'
    },
    { 
      name: 'Sem Resposta', 
      value: quality.withoutResponse, 
      color: COLORS.none,
      description: 'Campo vazio'
    },
  ].filter(d => d.value > 0);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const percentage = ((data.value / quality.total) * 100).toFixed(1);
      return (
        <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
          <p className="font-semibold text-foreground">{data.name}</p>
          <p className="text-sm text-muted-foreground">{data.description}</p>
          <p className="text-sm font-medium mt-1">
            {data.value} leads ({percentage}%)
          </p>
        </div>
      );
    }
    return null;
  };

  const renderLegend = (props: any) => {
    const { payload } = props;
    return (
      <div className="flex flex-wrap justify-center gap-3 mt-4">
        {payload.map((entry: any, index: number) => (
          <div key={`legend-${index}`} className="flex items-center gap-1.5">
            <div 
              className="w-3 h-3 rounded-full" 
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-xs text-muted-foreground">{entry.value}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <Card className="bg-gradient-to-br from-background to-muted/30 border-border/50">
      <CardHeader>
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <span className="bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
            Distribuição de Qualidade
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="45%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
                dataKey="value"
                stroke="none"
              >
                {data.map((entry, index) => (
                  <Cell 
                    key={`cell-${index}`} 
                    fill={entry.color}
                    className="transition-all duration-300 hover:opacity-80"
                  />
                ))}
              </Pie>
              <Tooltip {...tooltip} content={<CustomTooltip />} />
              <Legend {...legenda} content={renderLegend} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        
        {/* Stats summary */}
        <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-border/50">
          <div className="text-center">
            <div className="text-2xl font-bold text-success">
              {quality.approvalRate.toFixed(1)}%
            </div>
            <div className="text-xs text-muted-foreground">
              Aproveitabilidade Total
            </div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-primary">
              {quality.averageLength.toFixed(0)}
            </div>
            <div className="text-xs text-muted-foreground">
              Média de Caracteres
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
