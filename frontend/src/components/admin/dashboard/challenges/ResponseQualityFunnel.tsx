import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronDown, Users, MessageSquare, CheckCircle, Award } from 'lucide-react';
import type { ResponseQuality } from '@/hooks/useLeadAnalytics';

interface ResponseQualityFunnelProps {
  quality: ResponseQuality;
  onStageClick?: (stage: 'total' | 'withResponse' | 'aproveitaveis' | 'highQuality') => void;
}

export function ResponseQualityFunnel({ quality, onStageClick }: ResponseQualityFunnelProps) {
  const stages = [
    {
      id: 'total' as const,
      label: 'Total de Leads',
      count: quality.total,
      percentage: 100,
      icon: Users,
      color: 'from-slate-500 to-slate-400',
      bgColor: 'bg-slate-500/10',
    },
    {
      id: 'withResponse' as const,
      label: 'Com Resposta',
      count: quality.withResponse,
      percentage: quality.responseRate,
      icon: MessageSquare,
      color: 'from-blue-500 to-blue-400',
      bgColor: 'bg-blue-500/10',
    },
    {
      id: 'aproveitaveis' as const,
      label: 'Aproveitáveis',
      count: quality.highQuality + quality.mediumQuality,
      percentage: quality.approvalRate,
      icon: CheckCircle,
      color: 'from-emerald-500 to-emerald-400',
      bgColor: 'bg-emerald-500/10',
    },
    {
      id: 'highQuality' as const,
      label: 'Alta Qualidade',
      count: quality.highQuality,
      percentage: quality.highQualityRate,
      icon: Award,
      color: 'from-amber-500 to-yellow-400',
      bgColor: 'bg-amber-500/10',
    },
  ];

  return (
    <Card className="bg-gradient-to-br from-background to-muted/30 border-border/50">
      <CardHeader>
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <span className="bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
            Funil de Qualidade
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {stages.map((stage, index) => {
          const Icon = stage.icon;
          const widthPercentage = Math.max(stage.percentage, 20);
          
          return (
            <div key={stage.id}>
              <button
                onClick={() => onStageClick?.(stage.id)}
                className={`w-full transition-all duration-300 hover:scale-[1.02] ${stage.bgColor} rounded-lg p-3 cursor-pointer`}
                style={{ width: `${widthPercentage}%`, marginLeft: `${(100 - widthPercentage) / 2}%` }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{stage.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold">{stage.count}</span>
                    <span className="text-xs text-muted-foreground">
                      ({stage.percentage.toFixed(1)}%)
                    </span>
                  </div>
                </div>
                <div className="mt-2 h-1.5 bg-muted/50 rounded-full overflow-hidden">
                  <div 
                    className={`h-full bg-gradient-to-r ${stage.color} transition-all duration-500`}
                    style={{ width: `${stage.percentage}%` }}
                  />
                </div>
              </button>
              
              {index < stages.length - 1 && (
                <div className="flex justify-center py-1">
                  <ChevronDown className="h-4 w-4 text-muted-foreground/50" />
                </div>
              )}
            </div>
          );
        })}
        
        {/* Conversion summary */}
        <div className="mt-4 pt-4 border-t border-border/50">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-xs text-muted-foreground">Resposta → Aproveitável</div>
              <div className="text-sm font-semibold text-blue-500">
                {quality.withResponse > 0 
                  ? (((quality.highQuality + quality.mediumQuality) / quality.withResponse) * 100).toFixed(1) 
                  : 0}%
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Aproveitável → Alta Qual.</div>
              <div className="text-sm font-semibold text-emerald-500">
                {(quality.highQuality + quality.mediumQuality) > 0 
                  ? ((quality.highQuality / (quality.highQuality + quality.mediumQuality)) * 100).toFixed(1) 
                  : 0}%
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Total → Alta Qual.</div>
              <div className="text-sm font-semibold text-amber-500">
                {quality.highQualityRate.toFixed(1)}%
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
