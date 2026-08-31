import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp } from 'lucide-react';
import type { EnrichedLead } from '@/hooks/useLeadQualification';

interface SalesReadinessFunnelProps {
  leads: EnrichedLead[];
}

export function SalesReadinessFunnel({ leads }: SalesReadinessFunnelProps) {
  const funnelData = useMemo(() => {
    const total = leads.length;
    const hot = leads.filter(l => l.qualification === 'hot').length;
    const warm = leads.filter(l => l.qualification === 'warm').length;
    const raw = leads.filter(l => l.qualification === 'raw').length;
    
    return [
      { 
        stage: 'Leads Brutos', 
        count: raw, 
        percentage: total > 0 ? (raw / total) * 100 : 0,
        color: '#6B7280',
        width: 100
      },
      { 
        stage: 'Qualificados (Warm)', 
        count: warm, 
        percentage: total > 0 ? (warm / total) * 100 : 0,
        color: '#F59E0B',
        width: total > 0 ? (warm / Math.max(raw, warm, hot, 1)) * 100 : 0
      },
      { 
        stage: 'Prontos p/ Venda (Hot)', 
        count: hot, 
        percentage: total > 0 ? (hot / total) * 100 : 0,
        color: '#10B981',
        width: total > 0 ? (hot / Math.max(raw, warm, hot, 1)) * 100 : 0
      },
    ];
  }, [leads]);

  return (
    <Card className="bg-gradient-to-br from-card via-card to-primary/10 border-border/50 shadow-lg overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <div className="p-2 rounded-lg bg-primary/20">
            <TrendingUp className="h-5 w-5 text-primary" />
          </div>
          Funil de Prontidão
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4 py-4">
          {funnelData.map((stage, index) => (
            <div key={stage.stage} className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{stage.stage}</span>
                <div className="flex items-center gap-2">
                  <span className="font-bold" style={{ color: stage.color }}>
                    {stage.count}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ({stage.percentage.toFixed(1)}%)
                  </span>
                </div>
              </div>
              <div className="relative h-10 rounded-lg bg-muted/20 overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 rounded-lg transition-all duration-1000 ease-out flex items-center justify-center"
                  style={{
                    width: `${Math.max(stage.width, 5)}%`,
                    background: `linear-gradient(90deg, ${stage.color}80 0%, ${stage.color} 100%)`,
                    animationDelay: `${index * 200}ms`
                  }}
                >
                  {stage.width > 20 && (
                    <span className="text-sm font-semibold text-white drop-shadow-lg">
                      {stage.count}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Conversion Rates */}
        <div className="border-t border-border/50 pt-4 mt-4">
          <div className="grid grid-cols-2 gap-4 text-center">
            <div className="p-3 rounded-lg bg-muted/10">
              <div className="text-xs text-muted-foreground mb-1">Raw → Warm</div>
              <div className="text-lg font-bold text-yellow-400">
                {leads.length > 0 
                  ? ((funnelData[1].count / Math.max(funnelData[0].count, 1)) * 100).toFixed(0) 
                  : 0}%
              </div>
            </div>
            <div className="p-3 rounded-lg bg-muted/10">
              <div className="text-xs text-muted-foreground mb-1">Warm → Hot</div>
              <div className="text-lg font-bold text-emerald-400">
                {leads.length > 0 
                  ? ((funnelData[2].count / Math.max(funnelData[1].count, 1)) * 100).toFixed(0) 
                  : 0}%
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
