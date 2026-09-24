import { Pause, TrendingUp, Clock, Star, Search, BarChart3 } from "lucide-react";
import { Recommendation } from "@/hooks/useInsightsAnalytics";
import { Badge } from "@/components/ui/badge";

interface RecommendationsSectionProps {
  recommendations: Recommendation[];
}

const typeIcons = {
  pause: Pause,
  invest: TrendingUp,
  avoid: Clock,
  prioritize: Star,
  review: Search
};

const typeColors = {
  pause: 'bg-[--tint-danger] border-danger/30 text-[--on-tint-danger]',
  invest: 'bg-[--tint-success] border-success/30 text-[--on-tint-success]',
  avoid: 'bg-[--tint-warning] border-warning/30 text-[--on-tint-warning]',
  prioritize: 'bg-[--tint-info] border-info/30 text-[--on-tint-info]',
  review: 'bg-[--tint-primary] border-primary/30 text-[--on-tint-primary]'
};

const impactBadgeVariants = {
  high: 'destructive',
  medium: 'warning',
  low: 'info'
} as const;

export function RecommendationsSection({ recommendations }: RecommendationsSectionProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground">
        Recomendações Automáticas
      </h3>

      {/* Legenda explicativa */}
      <div className="p-3 bg-muted/30 rounded-lg border border-border/50 text-xs text-muted-foreground">
        <p className="font-medium text-foreground mb-2">Tipos de recomendação:</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-danger/50" />
            <span><strong>Pausar:</strong> Problemas graves</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-success/50" />
            <span><strong>Investir:</strong> Ótima performance</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-warning/50" />
            <span><strong>Evitar:</strong> Horário ruim</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-info/50" />
            <span><strong>Priorizar:</strong> Horário bom</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-primary/50" />
            <span><strong>Revisar:</strong> Ajustar segmentação</span>
          </div>
        </div>
      </div>

      {recommendations.length === 0 ? (
        <div className="bg-muted/20 border border-border/50 rounded-lg p-6 text-center">
          <p className="text-muted-foreground">
            Sem recomendações no momento. Continue coletando dados para insights acionáveis.
          </p>
        </div>
      ) : (
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {recommendations.map((rec) => {
          const Icon = typeIcons[rec.type];
          return (
            <div
              key={rec.id}
              className={`rounded-lg border p-4 ${typeColors[rec.type]}`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-sm">{rec.title}</span>
                    <Badge variant={impactBadgeVariants[rec.impact]}>
                      {rec.impact === 'high' ? 'Alto' : rec.impact === 'medium' ? 'Médio' : 'Baixo'}
                    </Badge>
                  </div>
                  <p className="text-xs opacity-80 leading-relaxed">
                    {rec.description}
                  </p>
                  {rec.metric && (
                    <div className="mt-2 text-xs font-medium opacity-60 flex items-center gap-1">
                      <BarChart3 className="inline h-3.5 w-3.5" />
                      {rec.metric}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
          })}
        </div>
      )}
    </div>
  );
}
