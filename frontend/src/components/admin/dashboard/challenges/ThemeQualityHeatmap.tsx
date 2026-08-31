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
    
    const colors = {
      high: [
        'bg-green-500/20',
        'bg-green-500/40',
        'bg-green-500/60',
        'bg-green-500/80',
        'bg-green-500',
      ],
      medium: [
        'bg-yellow-500/20',
        'bg-yellow-500/40',
        'bg-yellow-500/60',
        'bg-yellow-500/80',
        'bg-yellow-500',
      ],
      low: [
        'bg-orange-500/20',
        'bg-orange-500/40',
        'bg-orange-500/60',
        'bg-orange-500/80',
        'bg-orange-500',
      ],
    };
    
    const index = Math.min(Math.floor(intensity * 5), 4);
    return colors[type][index];
  };

  const qualityColumns = [
    { key: 'high' as const, label: 'Alta', color: 'text-green-500' },
    { key: 'medium' as const, label: 'Média', color: 'text-yellow-500' },
    { key: 'low' as const, label: 'Baixa', color: 'text-orange-500' },
  ];

  // Sort by total (high + medium) descending
  const sortedData = [...data].sort((a, b) => (b.high + b.medium) - (a.high + a.medium));

  return (
    <Card className="bg-gradient-to-br from-background to-muted/30 border-border/50">
      <CardHeader>
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <span className="bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
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
