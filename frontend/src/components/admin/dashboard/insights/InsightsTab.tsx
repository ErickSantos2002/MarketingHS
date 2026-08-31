import { Sparkles, TrendingUp, Users, Target, Info } from "lucide-react";
import { useInsightsAnalytics } from "@/hooks/useInsightsAnalytics";
import { AlertsSection } from "./AlertsSection";
import { CampaignRankingTable } from "./CampaignRankingTable";
import { TemporalHeatmap } from "./TemporalHeatmap";
import { RecommendationsSection } from "./RecommendationsSection";
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
  created_at: string | null;
  nome: string | null;
  email: string | null;
  empresa: string | null;
  cargo: string | null;
  faturamento: string | null;
  funcionarios: string | null;
  desafios: string | null;
  tipo: string;
  source: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
}

const INSIGHTS_CARDS: CardConfig[] = [
  { key: 'quick_stats', label: 'Stats Rápidos', defaultVisible: true },
  { key: 'alerts', label: 'Alertas', defaultVisible: true },
  { key: 'campaign_ranking', label: 'Ranking Campanhas', defaultVisible: true },
  { key: 'temporal_heatmap', label: 'Heatmap Temporal', defaultVisible: true },
  { key: 'recommendations', label: 'Recomendações', defaultVisible: true },
];

interface InsightsTabProps {
  leads: Lead[];
}

export function InsightsTab({ leads }: InsightsTabProps) {
  const { 
    campaignScores, 
    temporalMatrix, 
    alerts, 
    recommendations,
    summaryStats 
  } = useInsightsAnalytics(leads);
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
              Esta aba analisa automaticamente seus leads para identificar <strong className="text-foreground">padrões, problemas e oportunidades</strong>. 
              Os insights são baseados em: <strong className="text-foreground">taxa de resposta</strong> ao formulário (campo desafios preenchido), 
              <strong className="text-foreground"> qualificação de leads</strong> (cargo de decisor + faturamento ICP ≥100k/mês) e 
              <strong className="text-foreground"> padrões temporais</strong> (dia/hora de conversão).
            </p>
          </div>
        </div>

        {/* Quick Stats */}
        {isVisible('quick_stats') && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-card rounded-lg border border-border/50 p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <TrendingUp className="h-4 w-4" />
              <span className="text-xs">Taxa de Resposta</span>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="h-3 w-3 opacity-50" />
                </TooltipTrigger>
                <TooltipContent className="max-w-[200px]">
                  <p>% de leads que preencheram o campo 'desafios'. <strong>Ideal: &gt;70%</strong></p>
                </TooltipContent>
              </Tooltip>
            </div>
            <div className={`text-2xl font-bold ${summaryStats.responseRate >= 70 ? 'text-emerald-400' : summaryStats.responseRate >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
              {summaryStats.responseRate.toFixed(1)}%
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
                <TooltipContent className="max-w-[200px]">
                  <p>% de leads qualificados (decisores + faturamento ICP). <strong>Ideal: &gt;25%</strong></p>
                </TooltipContent>
              </Tooltip>
            </div>
            <div className={`text-2xl font-bold ${summaryStats.hotRate >= 25 ? 'text-emerald-400' : summaryStats.hotRate >= 15 ? 'text-amber-400' : 'text-red-400'}`}>
              {summaryStats.hotRate.toFixed(1)}%
            </div>
          </div>
          
          <div className="bg-card rounded-lg border border-border/50 p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Sparkles className="h-4 w-4" />
              <span className="text-xs">Campanhas Grade A</span>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="h-3 w-3 opacity-50" />
                </TooltipTrigger>
                <TooltipContent className="max-w-[200px]">
                  <p>Campanhas com score acima de 80. <strong>Priorize investir nelas!</strong></p>
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="text-2xl font-bold text-blue-400">
              {summaryStats.gradedACampaigns}
            </div>
          </div>
          
          <div className="bg-card rounded-lg border border-border/50 p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Users className="h-4 w-4" />
              <span className="text-xs">Alertas Críticos</span>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="h-3 w-3 opacity-50" />
                </TooltipTrigger>
                <TooltipContent className="max-w-[200px]">
                  <p>Situações que precisam de ação imediata. <strong>Ideal: 0</strong></p>
                </TooltipContent>
              </Tooltip>
            </div>
            <div className={`text-2xl font-bold ${summaryStats.criticalAlerts > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
              {summaryStats.criticalAlerts}
            </div>
          </div>
        </div>
        )}

        {/* Alerts Section */}
        {isVisible('alerts') && <AlertsSection alerts={alerts} />}

        {/* Main Content Grid */}
        {(isVisible('campaign_ranking') || isVisible('temporal_heatmap')) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {isVisible('campaign_ranking') && (
            <div className="lg:col-span-1">
              <CampaignRankingTable campaigns={campaignScores} />
            </div>
          )}
          {isVisible('temporal_heatmap') && (
            <div className="lg:col-span-1">
              <TemporalHeatmap matrix={temporalMatrix} />
            </div>
          )}
        </div>
        )}

        {/* Recommendations */}
        {isVisible('recommendations') && <RecommendationsSection recommendations={recommendations} />}
      </div>
    </TooltipProvider>
  );
}
