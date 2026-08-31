import { useMemo, useState } from 'react';
import { ChannelKPICards } from './ChannelKPICards';
import { SourcePerformanceTable } from './SourcePerformanceTable';
import { SourceQualificationChart } from './SourceQualificationChart';
import { CampaignPerformanceTable } from './CampaignPerformanceTable';
import { MediumDistributionChart } from './MediumDistributionChart';
import { ChannelInsights } from './ChannelInsights';
import { HourlyConversionChart } from './HourlyConversionChart';
import { CampaignTimeAnalysis } from './CampaignTimeAnalysis';
import { LeadsListSheet } from '@/components/admin/dashboard/LeadsListSheet';
import { DashboardCardSelector } from '@/components/admin/dashboard/DashboardCardSelector';
import { useDashboardCardSettings, type CardConfig } from '@/hooks/useDashboardCardSettings';
import type { EnrichedLead } from '@/hooks/useLeadQualification';

const OPERATIONAL_CARDS: CardConfig[] = [
  { key: 'kpi_channels', label: 'KPI Canais', defaultVisible: true },
  { key: 'time_analysis', label: 'Conversão Horária / Tempo Campanha', defaultVisible: true },
  { key: 'source_table', label: 'Performance Source', defaultVisible: true },
  { key: 'source_charts', label: 'Qualificação Source / Medium', defaultVisible: true },
  { key: 'campaign_table', label: 'Campanhas', defaultVisible: true },
  { key: 'insights', label: 'Insights', defaultVisible: true },
];

interface OperationalTabProps {
  leads: EnrichedLead[];
}

export function OperationalTab({ leads }: OperationalTabProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedLeads, setSelectedLeads] = useState<EnrichedLead[]>([]);
  const [selectedTitle, setSelectedTitle] = useState('');
  const { visibleCards, toggleCard, resetCards, isVisible } = useDashboardCardSettings('operational', OPERATIONAL_CARDS);

  // Calculate source performance with qualification
  const sourcePerformance = useMemo(() => {
    const sources = new Map<string, {
      total: number;
      hot: number;
      warm: number;
      raw: number;
    }>();

    for (const lead of leads) {
      const source = lead.source || 'Direto';
      const current = sources.get(source) || { total: 0, hot: 0, warm: 0, raw: 0 };
      current.total++;
      if (lead.qualification === 'hot') current.hot++;
      else if (lead.qualification === 'warm') current.warm++;
      else current.raw++;
      sources.set(source, current);
    }

    return Array.from(sources.entries())
      .map(([source, data]) => ({
        source,
        ...data,
        hotRate: data.total > 0 ? (data.hot / data.total) * 100 : 0,
      }))
      .sort((a, b) => b.hotRate - a.hotRate);
  }, [leads]);

  // Calculate campaign performance
  const campaignPerformance = useMemo(() => {
    const campaigns = new Map<string, {
      total: number;
      hot: number;
      sources: Map<string, number>;
    }>();

    for (const lead of leads) {
      const campaign = lead.utm_campaign || '';
      if (!campaign) continue;
      
      const current = campaigns.get(campaign) || { total: 0, hot: 0, sources: new Map() };
      current.total++;
      if (lead.qualification === 'hot') current.hot++;
      
      const source = lead.source || 'Direto';
      current.sources.set(source, (current.sources.get(source) || 0) + 1);
      
      campaigns.set(campaign, current);
    }

    return Array.from(campaigns.entries())
      .map(([campaign, data]) => {
        // Find primary source
        let primarySource = 'Direto';
        let maxCount = 0;
        data.sources.forEach((count, source) => {
          if (count > maxCount) {
            maxCount = count;
            primarySource = source;
          }
        });

        return {
          campaign,
          total: data.total,
          hot: data.hot,
          hotRate: data.total > 0 ? (data.hot / data.total) * 100 : 0,
          primarySource,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [leads]);

  // Calculate medium performance
  const mediumPerformance = useMemo(() => {
    const mediums = new Map<string, { total: number; hot: number }>();

    for (const lead of leads) {
      const medium = lead.utm_medium || 'Direto';
      const current = mediums.get(medium) || { total: 0, hot: 0 };
      current.total++;
      if (lead.qualification === 'hot') current.hot++;
      mediums.set(medium, current);
    }

    return Array.from(mediums.entries())
      .map(([medium, data]) => ({
        medium,
        ...data,
        hotRate: data.total > 0 ? (data.hot / data.total) * 100 : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [leads]);

  const handleSourceClick = (source: string, sourceLeads: EnrichedLead[]) => {
    setSelectedTitle(`Source: ${source}`);
    setSelectedLeads(sourceLeads);
    setSheetOpen(true);
  };

  const handleCampaignClick = (campaign: string, campaignLeads: EnrichedLead[]) => {
    setSelectedTitle(`Campanha: ${campaign}`);
    setSelectedLeads(campaignLeads);
    setSheetOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <DashboardCardSelector cards={OPERATIONAL_CARDS} visibleCards={visibleCards} onToggle={toggleCard} onReset={resetCards} />
      </div>

      {isVisible('kpi_channels') && (
        <ChannelKPICards 
          sourcePerformance={sourcePerformance}
          campaignPerformance={campaignPerformance}
        />
      )}

      {isVisible('time_analysis') && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <HourlyConversionChart leads={leads} />
          <CampaignTimeAnalysis leads={leads} />
        </div>
      )}

      {isVisible('source_table') && (
        <SourcePerformanceTable 
          data={sourcePerformance}
          onSourceClick={handleSourceClick}
          leads={leads}
        />
      )}

      {isVisible('source_charts') && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SourceQualificationChart data={sourcePerformance} />
          <MediumDistributionChart data={mediumPerformance} />
        </div>
      )}

      {isVisible('campaign_table') && (
        <CampaignPerformanceTable 
          data={campaignPerformance}
          onCampaignClick={handleCampaignClick}
          leads={leads}
        />
      )}

      {isVisible('insights') && (
        <ChannelInsights 
          sourcePerformance={sourcePerformance}
          mediumPerformance={mediumPerformance}
          totalLeads={leads.length}
        />
      )}

      <LeadsListSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        leads={selectedLeads}
        title={selectedTitle}
      />
    </div>
  );
}
