import { Card, CardContent } from '@/components/ui/card';
import { Megaphone, TrendingUp, Target, Zap } from 'lucide-react';

interface SourcePerformance {
  source: string;
  total: number;
  hot: number;
  warm: number;
  raw: number;
  hotRate: number;
}

interface CampaignPerformance {
  campaign: string;
  total: number;
  hot: number;
  hotRate: number;
}

interface ChannelKPICardsProps {
  sourcePerformance: SourcePerformance[];
  campaignPerformance: CampaignPerformance[];
}

export function ChannelKPICards({ sourcePerformance, campaignPerformance }: ChannelKPICardsProps) {
  const uniqueSources = sourcePerformance.length;
  const topSource = sourcePerformance[0];
  const bestHotRateSource = [...sourcePerformance]
    .filter(s => s.total >= 5) // Minimum leads for statistical relevance
    .sort((a, b) => b.hotRate - a.hotRate)[0];
  const topCampaign = campaignPerformance
    .filter(c => c.campaign && c.campaign !== 'null' && c.total >= 3)
    .sort((a, b) => b.hotRate - a.hotRate)[0];

  const kpis = [
    {
      title: 'Sources Únicos',
      value: uniqueSources,
      subtitle: 'canais de aquisição',
      icon: Megaphone,
      iconColor: 'text-primary',
      bgColor: 'bg-primary/10',
    },
    {
      title: 'Top Source',
      value: topSource?.source || '-',
      subtitle: topSource ? `${topSource.total} leads` : 'sem dados',
      icon: TrendingUp,
      iconColor: 'text-emerald-400',
      bgColor: 'bg-emerald-500/10',
    },
    {
      title: 'Melhor Taxa Hot',
      value: bestHotRateSource ? `${bestHotRateSource.hotRate.toFixed(0)}%` : '-',
      subtitle: bestHotRateSource?.source || 'sem dados',
      icon: Target,
      iconColor: 'text-accent',
      bgColor: 'bg-accent/10',
    },
    {
      title: 'Top Campanha',
      value: topCampaign?.campaign?.slice(0, 20) || '-',
      subtitle: topCampaign ? `${topCampaign.hotRate.toFixed(0)}% hot rate` : 'sem dados',
      icon: Zap,
      iconColor: 'text-primary',
      bgColor: 'bg-primary/10',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {kpis.map((kpi) => (
        <Card key={kpi.title} className="bg-card/50 backdrop-blur-sm border-border/50">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground font-medium">{kpi.title}</p>
                <p className="text-xl font-bold truncate max-w-[140px]" title={String(kpi.value)}>
                  {kpi.value}
                </p>
                <p className="text-xs text-muted-foreground truncate max-w-[140px]" title={kpi.subtitle}>
                  {kpi.subtitle}
                </p>
              </div>
              <div className={`p-2 rounded-lg ${kpi.bgColor}`}>
                <kpi.icon className={`h-4 w-4 ${kpi.iconColor}`} />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
