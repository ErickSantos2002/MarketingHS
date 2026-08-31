import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Lightbulb, TrendingUp, TrendingDown, AlertCircle, CheckCircle } from 'lucide-react';

interface SourcePerformance {
  source: string;
  total: number;
  hot: number;
  warm: number;
  raw: number;
  hotRate: number;
}

interface MediumPerformance {
  medium: string;
  total: number;
  hot: number;
  hotRate: number;
}

interface ChannelInsightsProps {
  sourcePerformance: SourcePerformance[];
  mediumPerformance: MediumPerformance[];
  totalLeads: number;
}

interface Insight {
  type: 'success' | 'warning' | 'info' | 'alert';
  title: string;
  description: string;
}

export function ChannelInsights({ sourcePerformance, mediumPerformance, totalLeads }: ChannelInsightsProps) {
  const insights: Insight[] = [];

  // High-performing source insight
  const highPerformingSources = sourcePerformance
    .filter(s => s.total >= 5 && s.hotRate >= 30);
  
  if (highPerformingSources.length > 0) {
    const topSource = highPerformingSources[0];
    insights.push({
      type: 'success',
      title: `${topSource.source} tem alta taxa de conversão`,
      description: `Com ${topSource.hotRate.toFixed(0)}% de leads hot, considere aumentar investimento neste canal.`,
    });
  }

  // Low-performing source with high volume
  const lowPerformingHighVolume = sourcePerformance
    .filter(s => s.total >= 20 && s.hotRate < 10);
  
  if (lowPerformingHighVolume.length > 0) {
    const worstSource = lowPerformingHighVolume.sort((a, b) => a.hotRate - b.hotRate)[0];
    insights.push({
      type: 'warning',
      title: `${worstSource.source} tem baixa qualificação`,
      description: `Apenas ${worstSource.hotRate.toFixed(0)}% de hot leads com ${worstSource.total} leads. Revisar segmentação.`,
    });
  }

  // Best medium insight
  const bestMedium = mediumPerformance
    .filter(m => m.total >= 5 && m.medium && m.medium !== 'null')
    .sort((a, b) => b.hotRate - a.hotRate)[0];
  
  if (bestMedium && bestMedium.hotRate >= 20) {
    insights.push({
      type: 'info',
      title: `Medium "${bestMedium.medium}" é o mais eficiente`,
      description: `Taxa de ${bestMedium.hotRate.toFixed(0)}% hot leads. Canal recomendado para escala.`,
    });
  }

  // Concentration risk
  const topSourceShare = sourcePerformance[0]?.total / totalLeads * 100;
  if (topSourceShare > 60) {
    insights.push({
      type: 'alert',
      title: 'Alta concentração em um source',
      description: `${topSourceShare.toFixed(0)}% dos leads vêm de ${sourcePerformance[0].source}. Diversifique canais.`,
    });
  }

  // Few sources with data
  if (sourcePerformance.length <= 2 && totalLeads >= 50) {
    insights.push({
      type: 'info',
      title: 'Poucos canais ativos',
      description: 'Considere expandir para mais canais de aquisição para comparar performance.',
    });
  }

  // If no insights, add a generic one
  if (insights.length === 0) {
    insights.push({
      type: 'info',
      title: 'Coletando dados',
      description: 'Mais insights aparecerão conforme mais leads forem capturados pelos diferentes canais.',
    });
  }

  const getIcon = (type: Insight['type']) => {
    switch (type) {
      case 'success': return <CheckCircle className="h-4 w-4 text-emerald-400" />;
      case 'warning': return <TrendingDown className="h-4 w-4 text-yellow-400" />;
      case 'info': return <TrendingUp className="h-4 w-4 text-primary" />;
      case 'alert': return <AlertCircle className="h-4 w-4 text-accent" />;
    }
  };

  const getBgColor = (type: Insight['type']) => {
    switch (type) {
      case 'success': return 'bg-emerald-500/10 border-emerald-500/20';
      case 'warning': return 'bg-yellow-500/10 border-yellow-500/20';
      case 'info': return 'bg-primary/10 border-primary/20';
      case 'alert': return 'bg-accent/10 border-accent/20';
    }
  };

  return (
    <Card className="bg-card/50 backdrop-blur-sm border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-amber-400" />
          Insights de Canais
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {insights.slice(0, 4).map((insight, index) => (
          <div 
            key={index}
            className={`p-3 rounded-lg border ${getBgColor(insight.type)}`}
          >
            <div className="flex items-start gap-2">
              {getIcon(insight.type)}
              <div className="space-y-0.5">
                <p className="text-sm font-medium">{insight.title}</p>
                <p className="text-xs text-muted-foreground">{insight.description}</p>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
