import { ChallengeThemesChart } from './ChallengeThemesChart';
import { TopKeywordsChart } from './TopKeywordsChart';
import { ChallengesHeatmap } from './ChallengesHeatmap';
import { LeadsListCard } from './LeadsListCard';
import { ResponseQualityCards } from './ResponseQualityCards';
import { ResponseQualityFunnel } from './ResponseQualityFunnel';
import { ResponseQualityChart } from './ResponseQualityChart';
import { TopResponsesCard } from './TopResponsesCard';
import { ThemeQualityHeatmap } from './ThemeQualityHeatmap';
import { ChallengesAIInsights } from './ChallengesAIInsights';
import { DashboardCardSelector } from '@/components/admin/dashboard/DashboardCardSelector';
import { useDashboardCardSettings, type CardConfig } from '@/hooks/useDashboardCardSettings';
import type { Lead } from '@/hooks/useLeads';
import { useLeadAnalytics } from '@/hooks/useLeadAnalytics';

const CHALLENGES_CARDS: CardConfig[] = [
  { key: 'quality_kpis', label: 'Quality KPIs', defaultVisible: true },
  { key: 'funnel_distribution', label: 'Funnel / Distribuição', defaultVisible: true },
  { key: 'themes_keywords', label: 'Temas / Keywords', defaultVisible: true },
  { key: 'heatmaps', label: 'Heatmaps', defaultVisible: true },
  { key: 'ai_insights', label: 'AI Insights', defaultVisible: true },
  { key: 'top_responses', label: 'Top Respostas', defaultVisible: true },
  { key: 'leads_list', label: 'Lista de Leads', defaultVisible: true },
];

interface ChallengesTabProps {
  leads: Lead[];
}

export function ChallengesTab({ leads }: ChallengesTabProps) {
  const analytics = useLeadAnalytics(leads);
  const { visibleCards, toggleCard, resetCards, isVisible } = useDashboardCardSettings('challenges', CHALLENGES_CARDS);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-end">
        <DashboardCardSelector cards={CHALLENGES_CARDS} visibleCards={visibleCards} onToggle={toggleCard} onReset={resetCards} />
      </div>

      {isVisible('quality_kpis') && (
        <ResponseQualityCards quality={analytics.responseQuality} />
      )}

      {isVisible('funnel_distribution') && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ResponseQualityFunnel quality={analytics.responseQuality} />
          <ResponseQualityChart quality={analytics.responseQuality} />
        </div>
      )}

      {isVisible('themes_keywords') && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ChallengeThemesChart data={analytics.challengeThemesDistribution} />
          <TopKeywordsChart data={analytics.topKeywords} />
        </div>
      )}

      {isVisible('heatmaps') && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ChallengesHeatmap leads={leads} type="role" />
          <ThemeQualityHeatmap data={analytics.themeQualityMatrix} />
        </div>
      )}

      {isVisible('ai_insights') && (
        <ChallengesAIInsights leads={leads} />
      )}

      {isVisible('top_responses') && (
        <TopResponsesCard topResponses={analytics.topResponses} />
      )}

      {isVisible('leads_list') && (
        <LeadsListCard leads={leads} />
      )}
    </div>
  );
}
