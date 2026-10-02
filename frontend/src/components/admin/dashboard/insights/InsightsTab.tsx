import { Sparkles, Target, Users, AlertTriangle, Info } from "lucide-react";
import { useInsightsAnalytics } from "@/hooks/useInsightsAnalytics";
import { AlertsSection } from "./AlertsSection";
import { CampaignRankingTable } from "./CampaignRankingTable";
import { DashboardCardSelector } from "@/components/admin/dashboard/DashboardCardSelector";
import { useDashboardCardSettings, type CardConfig } from "@/hooks/useDashboardCardSettings";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Lead {
  id: string;
  email: string | null;
  utm_campaign: string | null;
  etiqueta?: string | null;
}

// "Heatmap Temporal" (temporal_heatmap) e "Recomendações" (recommendations)
// saíram em 02/10/2026 (raio-x RD, R6) — ver o topo de useInsightsAnalytics.
const INSIGHTS_CARDS: CardConfig[] = [
  { key: 'quick_stats', label: 'Stats Rápidos', defaultVisible: true },
  { key: 'alerts', label: 'Alertas', defaultVisible: true },
  { key: 'campaign_ranking', label: 'Ranking Campanhas', defaultVisible: true },
];

interface InsightsTabProps {
  leads: Lead[];
}

export function InsightsTab({ leads }: InsightsTabProps) {
  const { campaignScores, alerts, summaryStats } = useInsightsAnalytics(leads);
  const { visibleCards, toggleCard, resetCards, isVisible } = useDashboardCardSettings('insights', INSIGHTS_CARDS);

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Header with summary stats */}
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 flex-1">
              <Sparkles className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Insights Automáticos</h2>
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>{summaryStats.totalLeads} leads analisados</span>
              <span>•</span>
              <span>{summaryStats.totalCampaigns} campanhas</span>
              <DashboardCardSelector cards={INSIGHTS_CARDS} visibleCards={visibleCards} onToggle={toggleCard} onReset={resetCards} />
            </div>
          </div>

          {/* Explanation box */}
          <div className="p-4 bg-muted/30 rounded-lg border border-border/50 text-sm text-muted-foreground">
            <p className="leading-relaxed">
              Esta aba aponta onde olhar primeiro. <strong className="text-foreground">Hot</strong> é
              a etiqueta que o próprio sistema grava pela pontuação de Configurações → Lead Scoring,
              não um cálculo da tela. Os alertas mostram campanha com volume e quase nenhum lead hot,
              e e-mail repetido na base.
            </p>
          </div>
        </div>

        {/* Quick Stats */}
        {isVisible('quick_stats') && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="bg-card rounded-lg border border-border/50 p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Users className="h-4 w-4" />
              <span className="text-xs">Leads hot</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {summaryStats.hotLeads.toLocaleString('pt-BR')}
            </div>
          </div>

          <div className="bg-card rounded-lg border border-border/50 p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Target className="h-4 w-4" />
              <span className="text-xs">Hot Rate</span>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="h-3 w-3 opacity-50" />
                </TooltipTrigger>
                <TooltipContent className="max-w-[220px]">
                  <p>% dos leads do recorte com etiqueta hot no banco (pontuação de Lead Scoring).</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {summaryStats.hotRate.toFixed(1)}%
            </div>
          </div>

          <div className="bg-card rounded-lg border border-border/50 p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-xs">Alertas</span>
            </div>
            <div className={`text-2xl font-bold ${summaryStats.alertCount > 0 ? 'text-[--on-tint-warning]' : 'text-[--on-tint-success]'}`}>
              {summaryStats.alertCount}
            </div>
          </div>
        </div>
        )}

        {/* Alerts Section */}
        {isVisible('alerts') && <AlertsSection alerts={alerts} />}

        {isVisible('campaign_ranking') && (
          <CampaignRankingTable campaigns={campaignScores} />
        )}
      </div>
    </TooltipProvider>
  );
}
