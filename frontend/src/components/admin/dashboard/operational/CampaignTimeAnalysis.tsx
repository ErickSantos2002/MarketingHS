import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Target, Clock, TrendingUp, Lightbulb } from 'lucide-react';
import { useMemo } from 'react';
import type { Lead } from '@/hooks/useLeads';
import type { EnrichedLead } from '@/hooks/useLeadQualification';

interface CampaignTimeAnalysisProps {
  leads: (Lead | EnrichedLead)[];
}

type Period = 'Madrugada' | 'Manhã' | 'Tarde' | 'Noite';

const getPeriod = (hour: number): Period => {
  if (hour >= 0 && hour < 6) return 'Madrugada';
  if (hour >= 6 && hour < 12) return 'Manhã';
  if (hour >= 12 && hour < 18) return 'Tarde';
  return 'Noite';
};

const getPeriodRange = (period: Period): string => {
  switch (period) {
    case 'Madrugada': return '0h-6h';
    case 'Manhã': return '6h-12h';
    case 'Tarde': return '12h-18h';
    case 'Noite': return '18h-24h';
  }
};

const getPeriodColor = (period: Period): string => {
  switch (period) {
    case 'Madrugada': return 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30';
    case 'Manhã': return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
    case 'Tarde': return 'bg-orange-500/20 text-orange-300 border-orange-500/30';
    case 'Noite': return 'bg-violet-500/20 text-violet-300 border-violet-500/30';
  }
};

interface CampaignAnalysis {
  campaign: string;
  total: number;
  bestPeriod: Period;
  bestPeriodHotRate: number;
  bestPeriodVolume: number;
  overallHotRate: number;
  periodData: Record<Period, { total: number; hot: number; hotRate: number }>;
}

export function CampaignTimeAnalysis({ leads }: CampaignTimeAnalysisProps) {
  const { campaignData, topInsight } = useMemo(() => {
    const campaignMap = new Map<string, {
      total: number;
      hot: number;
      periods: Record<Period, { total: number; hot: number }>;
    }>();

    leads.forEach((lead) => {
      const campaign = lead.utm_campaign;
      if (!campaign || !lead.created_at) return;

      const hour = new Date(lead.created_at).getHours();
      const period = getPeriod(hour);
      const isHot = 'qualification' in lead && lead.qualification === 'hot';

      if (!campaignMap.has(campaign)) {
        campaignMap.set(campaign, {
          total: 0,
          hot: 0,
          periods: {
            'Madrugada': { total: 0, hot: 0 },
            'Manhã': { total: 0, hot: 0 },
            'Tarde': { total: 0, hot: 0 },
            'Noite': { total: 0, hot: 0 },
          },
        });
      }

      const data = campaignMap.get(campaign)!;
      data.total += 1;
      data.periods[period].total += 1;
      if (isHot) {
        data.hot += 1;
        data.periods[period].hot += 1;
      }
    });

    const analyses: CampaignAnalysis[] = [];

    campaignMap.forEach((data, campaign) => {
      const periodData: Record<Period, { total: number; hot: number; hotRate: number }> = {
        'Madrugada': { ...data.periods['Madrugada'], hotRate: 0 },
        'Manhã': { ...data.periods['Manhã'], hotRate: 0 },
        'Tarde': { ...data.periods['Tarde'], hotRate: 0 },
        'Noite': { ...data.periods['Noite'], hotRate: 0 },
      };

      // Calculate hot rates
      Object.keys(periodData).forEach((period) => {
        const p = period as Period;
        if (periodData[p].total > 0) {
          periodData[p].hotRate = Math.round((periodData[p].hot / periodData[p].total) * 100);
        }
      });

      // Find best period (highest hot rate with minimum volume)
      let bestPeriod: Period = 'Manhã';
      let bestHotRate = 0;

      Object.keys(periodData).forEach((period) => {
        const p = period as Period;
        if (periodData[p].total >= 2 && periodData[p].hotRate > bestHotRate) {
          bestHotRate = periodData[p].hotRate;
          bestPeriod = p;
        }
      });

      analyses.push({
        campaign,
        total: data.total,
        bestPeriod,
        bestPeriodHotRate: periodData[bestPeriod].hotRate,
        bestPeriodVolume: periodData[bestPeriod].total,
        overallHotRate: data.total > 0 ? Math.round((data.hot / data.total) * 100) : 0,
        periodData,
      });
    });

    // Sort by total leads
    const sorted = analyses.sort((a, b) => b.total - a.total).slice(0, 10);

    // Generate insight
    let insight = '';
    if (sorted.length > 0) {
      const topCampaign = sorted[0];
      if (topCampaign.bestPeriodHotRate > topCampaign.overallHotRate) {
        const improvement = topCampaign.bestPeriodHotRate - topCampaign.overallHotRate;
        insight = `"${topCampaign.campaign.slice(0, 25)}..." converte ${improvement}% melhor no período da ${topCampaign.bestPeriod.toLowerCase()}`;
      }
    }

    return { campaignData: sorted, topInsight: insight };
  }, [leads]);

  if (campaignData.length === 0) {
    return (
      <Card className="bg-gradient-to-br from-card via-card to-emerald-950/10 border-border/50 shadow-lg">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <div className="p-2 rounded-lg bg-emerald-500/20">
              <Target className="h-5 w-5 text-emerald-400" />
            </div>
            Melhor Horário por Campanha UTM
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[200px] flex items-center justify-center text-muted-foreground">
            Sem dados de campanhas UTM disponíveis
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gradient-to-br from-card via-card to-emerald-950/10 border-border/50 shadow-lg">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <div className="p-2 rounded-lg bg-emerald-500/20">
            <Target className="h-5 w-5 text-emerald-400" />
          </div>
          Melhor Horário por Campanha UTM
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Insight Card */}
        {topInsight && (
          <div className="p-3 rounded-xl bg-gradient-to-r from-accent/10 to-primary/10 border border-accent/20">
            <div className="flex items-center gap-2 text-accent mb-1">
              <Lightbulb className="h-4 w-4" />
              <span className="text-xs font-medium">Insight</span>
            </div>
            <p className="text-sm text-foreground">{topInsight}</p>
          </div>
        )}

        {/* Table with ScrollArea */}
        <ScrollArea className="h-[320px]">
          <div className="rounded-xl border border-border/50 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="font-semibold">Campanha</TableHead>
                  <TableHead className="text-center font-semibold">Melhor Período</TableHead>
                  <TableHead className="text-center font-semibold">Hot Rate</TableHead>
                  <TableHead className="text-center font-semibold">Volume</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaignData.map((item) => (
                  <TableRow key={item.campaign} className="hover:bg-muted/20">
                    <TableCell className="font-medium max-w-[200px] truncate" title={item.campaign}>
                      {item.campaign}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant="outline"
                        className={`${getPeriodColor(item.bestPeriod)} border`}
                      >
                        <Clock className="h-3 w-3 mr-1" />
                        {item.bestPeriod} ({getPeriodRange(item.bestPeriod)})
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <span className="font-semibold text-emerald-400">{item.bestPeriodHotRate}%</span>
                        {item.bestPeriodHotRate > item.overallHotRate && (
                          <TrendingUp className="h-3 w-3 text-emerald-400" />
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        (geral: {item.overallHotRate}%)
                      </span>
                    </TableCell>
                    <TableCell className="text-center text-muted-foreground">
                      {item.bestPeriodVolume} / {item.total}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </ScrollArea>

        {/* Legend */}
        <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground pt-2">
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className={`${getPeriodColor('Madrugada')} border text-xs px-2 py-0`}>
              Madrugada
            </Badge>
            <span>0h-6h</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className={`${getPeriodColor('Manhã')} border text-xs px-2 py-0`}>
              Manhã
            </Badge>
            <span>6h-12h</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className={`${getPeriodColor('Tarde')} border text-xs px-2 py-0`}>
              Tarde
            </Badge>
            <span>12h-18h</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className={`${getPeriodColor('Noite')} border text-xs px-2 py-0`}>
              Noite
            </Badge>
            <span>18h-24h</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
