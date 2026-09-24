import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { ThemeQualityData } from '@/hooks/useLeadAnalytics';

interface ThemeQualityHeatmapProps {
  data: ThemeQualityData[];
}

export function ThemeQualityHeatmap({ data }: ThemeQualityHeatmapProps) {
  const maxValue = Math.max(...data.flatMap(d => [d.high, d.medium, d.low]));
  
  const getIntensity = (value: number, type: 'high' | 'medium' | 'low') => {
    if (value === 0) return 'bg-muted/30';
    const intensity = (value / maxValue);
    
    // Alta/Média/Baixa é uma escala ordinal de 3 degraus (boa → ruim); com só
    // 4 cores semânticas no DS, high/medium/low usam success/warning/danger
    // (o trio "farol") para não colidir — orange e yellow, ambos "atenção"
    // pela tabela de tradução, cairiam na mesma cor se traduzidos só pelo
    // matiz. Ver relatório da Tarefa 6.
    const colors = {
      high: [
        'bg-success/20',
        'bg-success/40',
        'bg-success/60',
        'bg-success/80',
        'bg-success',
      ],
      medium: [
        'bg-warning/20',
        'bg-warning/40',
        'bg-warning/60',
        'bg-warning/80',
        'bg-warning',
      ],
      low: [
        'bg-danger/20',
        'bg-danger/40',
        'bg-danger/60',
        'bg-danger/80',
        'bg-danger',
      ],
    };
    
    const index = Math.min(Math.floor(intensity * 5), 4);
    return colors[type][index];
  };

  const qualityColumns = [
    { key: 'high' as const, label: 'Alta', color: 'text-[--on-tint-success]' },
    { key: 'medium' as const, label: 'Média', color: 'text-[--on-tint-warning]' },
    { key: 'low' as const, label: 'Baixa', color: 'text-[--on-tint-danger]' },
  ];

  // Sort by total (high + medium) descending
  const sortedData = [...data].sort((a, b) => (b.high + b.medium) - (a.high + a.medium));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <span className="text-conteudo-heading">
            Qualidade por Tema
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="text-left text-xs font-medium text-muted-foreground pb-3 pr-4">
                  Tema
                </th>
                {qualityColumns.map(col => (
                  <th 
                    key={col.key} 
                    className={`text-center text-xs font-medium pb-3 px-2 ${col.color}`}
                  >
                    {col.label}
                  </th>
                ))}
                <th className="text-center text-xs font-medium text-muted-foreground pb-3 pl-4">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              <TooltipProvider>
                {sortedData.map((row) => (
                  <tr key={row.theme} className="group">
                    <td className="py-1.5 pr-4">
                      <span className="text-sm font-medium text-foreground/90 group-hover:text-foreground transition-colors">
                        {row.theme}
                      </span>
                    </td>
                    {qualityColumns.map(col => (
                      <td key={col.key} className="py-1.5 px-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className={`
                                w-full h-8 rounded flex items-center justify-center
                                text-xs font-medium cursor-default
                                transition-all duration-200 hover:scale-105
                                ${getIntensity(row[col.key], col.key)}
                                ${row[col.key] > 0 ? 'text-foreground' : 'text-muted-foreground/50'}
                              `}
                            >
                              {row[col.key]}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="font-medium">{row.theme}</p>
                            <p className="text-xs text-muted-foreground">
                              {col.label} qualidade: {row[col.key]} leads
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {row.total > 0 ? ((row[col.key] / row.total) * 100).toFixed(1) : 0}% do tema
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </td>
                    ))}
                    <td className="py-1.5 pl-4 text-center">
                      <span className="text-sm font-semibold text-muted-foreground">
                        {row.total}
                      </span>
                    </td>
                  </tr>
                ))}
              </TooltipProvider>
            </tbody>
          </table>
        </div>
        
        {/* Legend */}
        <div className="mt-4 pt-4 border-t border-border/50">
          <div className="flex items-center justify-center gap-6 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span>Intensidade:</span>
              <div className="flex gap-1">
                <div className="w-4 h-4 rounded bg-muted/30" />
                <div className="w-4 h-4 rounded bg-primary/20" />
                <div className="w-4 h-4 rounded bg-primary/40" />
                <div className="w-4 h-4 rounded bg-primary/60" />
                <div className="w-4 h-4 rounded bg-primary/80" />
                <div className="w-4 h-4 rounded bg-primary" />
              </div>
              <span>Mais leads</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
