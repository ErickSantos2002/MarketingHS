import { Pause, TrendingUp, Clock, Star, Search } from "lucide-react";
import { Recommendation } from "@/hooks/useInsightsAnalytics";

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
  pause: 'bg-red-500/10 border-red-500/30 text-red-400',
  invest: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
  avoid: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
  prioritize: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
  review: 'bg-purple-500/10 border-purple-500/30 text-purple-400'
};

const impactBadges = {
  high: 'bg-red-500/20 text-red-400',
  medium: 'bg-amber-500/20 text-amber-400',
  low: 'bg-blue-500/20 text-blue-400'
};

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
            <span className="w-3 h-3 rounded-full bg-red-500/50" />
            <span><strong>Pausar:</strong> Problemas graves</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-emerald-500/50" />
            <span><strong>Investir:</strong> Ótima performance</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-amber-500/50" />
            <span><strong>Evitar:</strong> Horário ruim</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-blue-500/50" />
            <span><strong>Priorizar:</strong> Horário bom</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-purple-500/50" />
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
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${impactBadges[rec.impact]}`}>
                      {rec.impact === 'high' ? 'Alto' : rec.impact === 'medium' ? 'Médio' : 'Baixo'}
                    </span>
                  </div>
                  <p className="text-xs opacity-80 leading-relaxed">
                    {rec.description}
                  </p>
                  {rec.metric && (
                    <div className="mt-2 text-xs font-medium opacity-60">
                      📊 {rec.metric}
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
